import { loadShadersFromURLS, buildProgramFromSources, setupWebGL } from "../../libs/utils.js";
import { flatten, lookAt, ortho, vec3 } from "../../libs/MV.js";
import * as STACK from "../../libs/stack.js";

import * as CUBE from "../../libs/objects/cube.js";
import * as SPHERE from "../../libs/objects/sphere.js";
import * as CYLINDER from "../../libs/objects/cylinder.js";
import * as PYRAMID from "../../libs/objects/pyramid.js";
import * as TORUS from "../../libs/objects/torus.js";

import { node, leaf, find, count_primitives, draw } from "./scenegraph.js";

/** @type {HTMLCanvasElement} */
let canvas;
/** @type {WebGL2RenderingContext} */
let gl;

let program;

const PRIMITIVES = { cube: CUBE, sphere: SPHERE, cylinder: CYLINDER, pyramid: PYRAMID, torus: TORUS };

let scene;
let zoom = 3;           // half the height of the view, in world units
const TILE = 2;         // lado de cada quadrado, em metros
const N = 20;           // 20 x 20 quadrados = 40 m x 40 m
const GROUND_A = [0.60, 0.33, 0.20, 1];
const GROUND_B = [0.52, 0.27, 0.16, 1];

// Cada pedra: posição [x, z] no chão, tamanho [sx, sy, sz] em metros, rotação em Y
const ROCKS = [
    { p: [2.2, 0.3], s: [0.30, 0.20, 0.25], ry: 20 },
    { p: [3.0, -0.8], s: [0.25, 0.18, 0.35], ry: 70 },
    { p: [1.8, 2.5], s: [0.40, 0.25, 0.30], ry: 0 },
    { p: [-2.5, 1.5], s: [0.22, 0.20, 0.22], ry: 45 },
    { p: [-3.5, -2.0], s: [0.35, 0.22, 0.28], ry: 110 },
    { p: [0.5, -3.0], s: [0.28, 0.15, 0.38], ry: -30 },
    { p: [5.0, 3.5], s: [0.32, 0.24, 0.32], ry: 15 },
    { p: [-1.0, 4.5], s: [0.20, 0.16, 0.30], ry: 80 },
    { p: [6.5, -2.5], s: [0.38, 0.22, 0.26], ry: -60 },
    { p: [-5.5, 0.5], s: [0.26, 0.20, 0.34], ry: 35 },
];
const ROCK_COLOURS = [[0.35, 0.22, 0.18, 1], [0.45, 0.30, 0.24, 1], [0.28, 0.20, 0.17, 1]];

function build_rocks() {
    return ROCKS.map((r, i) => {
        const rock = leaf(`rock ${i}`, "sphere", ROCK_COLOURS[i % ROCK_COLOURS.length], {
            t: [r.p[0], r.s[1] / 2, r.p[1]],   // centro a meia altura: a base toca em y = 0
            r: [0, r.ry, 0],
            s: [...r.s]                         // cópia, para cada pedra ter o seu array
        });
        rock.rock = true;                       // marca, para as encontrar mais tarde
        return rock;
    });
}

function build_ground() {
    const tiles = [];
    for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) {
            // centro do quadrado (i, j), com a grelha centrada na origem
            const x = (i - (N - 1) / 2) * TILE;
            const z = (j - (N - 1) / 2) * TILE;
            const colour = (i + j) % 2 == 0 ? GROUND_A : GROUND_B;
            tiles.push(leaf(`tile ${i},${j}`, "cube", colour,
                { t: [x, -0.05, z], s: [TILE, 0.1, TILE] }));
        }
    return node("ground", {}, tiles);
}

// ---------------------------------------------------------------------------
// The scene. An example only, to show how a graph is built: a tile of
// ground and a small turret with an arm, which keys q and e turn. Replace it
// with the ground, the rocks and the rover.
// ---------------------------------------------------------------------------

function build_scene() {
    return node("root", {}, [
        build_ground(), ...build_rocks(), //dúvida nestes 3 pontos
        node("turret", { t: [0, 0, 0] }, [
            leaf("base", "cylinder", [0.8, 0.8, 0.8, 1], { t: [0, 0.25, 0], s: [0.6, 0.5, 0.6] }),
            node("arm", { t: [0, 0.5, 0], r: [0, 0, 30] }, [
                leaf("upper arm", "cube", [0.9, 0.6, 0.1, 1], { t: [0.6, 0, 0], s: [1.2, 0.15, 0.15] })
            ])
        ])
    ]);
}


// ---------------------------------------------------------------------------
// Input. Keys that act while held (driving, steering, the joints) are kept in
// a set, and update() moves things by an amount proportional to the time
// that has passed, so that the speed does not depend on the frame rate or on
// the keyboard's repeat rate. Keys that act once go in on_key().
// ---------------------------------------------------------------------------

const held = new Set();

function on_key(key) {
    switch (key) {
        case '0':       // one view / four views
            break;
        case ' ':       // wireframe / solid / both
            break;
    }
}

// dy > 0 when the wheel is scrolled down (towards the user)
function on_wheel(dy) {
    zoom = Math.max(1, Math.min(60, zoom * (1 + dy / 1000)));
}

// dt: seconds since the last frame
function update(dt) {
    const turret = find(scene, "turret");
    if (held.has('q')) turret.transform.rotation[1] += 45 * dt;
    if (held.has('e')) turret.transform.rotation[1] -= 45 * dt;
}


// ---------------------------------------------------------------------------

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function setup_input() {
    // Single characters are taken in lower case, so that caps lock or shift
    // do not leave a key held forever
    const key_of = event => event.key.length == 1 ? event.key.toLowerCase() : event.key;
    window.addEventListener("keydown", (event) => {
        if (!event.repeat) on_key(key_of(event));
        held.add(key_of(event));
    });
    window.addEventListener("keyup", (event) => held.delete(key_of(event)));
    window.addEventListener("blur", () => held.clear());
    canvas.addEventListener("wheel", (event) => {
        on_wheel(event.deltaY);
        event.preventDefault();     // don't let the page scroll as well
    });
}

function setup(shaders) {
    canvas = document.getElementById("gl-canvas");
    gl = setupWebGL(canvas);

    program = buildProgramFromSources(gl, shaders["flat.vert"], shaders["flat.frag"]);

    CUBE.init(gl);
    SPHERE.init(gl);
    CYLINDER.init(gl);
    PYRAMID.init(gl);
    TORUS.init(gl);

    scene = build_scene();
    console.log("Primitives in the scene: " + count_primitives(scene));

    resize();
    window.addEventListener("resize", resize);
    setup_input();

    gl.clearColor(0.1, 0.1, 0.12, 1.0);
    gl.enable(gl.DEPTH_TEST);

    window.requestAnimationFrame(animate);
}

function draw_primitive(primitive, mv) {
    gl.uniformMatrix4fv(gl.getUniformLocation(program, "u_model_view"), false, flatten(mv));
    gl.uniform4fv(gl.getUniformLocation(program, "u_color"), primitive.colour);
    PRIMITIVES[primitive.geometry].draw(gl, program, gl.TRIANGLES);
}

let last_time;

function animate(time) {
    window.requestAnimationFrame(animate);

    const dt = last_time === undefined ? 0 : (time - last_time) / 1000;
    last_time = time;
    update(dt);

    // One view only, over the whole canvas: an axonometric view, as an
    // example, without distortion whatever the shape of the window
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = canvas.width / canvas.height;
    const V = lookAt(vec3(10, 8, 10), vec3(0, 0, 0), vec3(0, 1, 0));
    const P = ortho(-aspect * zoom, aspect * zoom, -zoom, zoom, -100, 100);

    gl.useProgram(program);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, "u_projection"), false, flatten(P));

    STACK.loadMatrix(V);
    draw(scene, draw_primitive);

    gl.useProgram(null);
}

loadShadersFromURLS(["flat.vert", "flat.frag"]).then(shaders => setup(shaders));
