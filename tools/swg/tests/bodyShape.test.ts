// Climbing II's feedback round, items 3 and 4 (src/player/bodyShape.ts, under `MOVE_TUNE`): prone lies down, and the body
// ducks under what stands over it, without the key. Driven through the game's own movement (the grapple's harness,
// `TestBody`: Jedi Academy's movement, the controller, the slope rule and the step, stepped in the player's order on the real
// Rapier) frame by frame while moving, at 30, 60, 144 and 240 frames a second: a body walking and running under beams at
// several heights ducking with no key and never pressing its capsule's top into them, staying ducked under a long low roof,
// the crouch key ducking further in a tunnel, a jump and a step off an edge under a slab keeping the capsule out of it, no
// duck on a ramp, a hill or stairs, none in the air or with the placing hand full, the path box asked once a stretch of travel;
// a lying body passing under the brief's 0.5 m slab a crouch cannot, crawling onto steps never into them, lying along a
// hillside, turned beside a wall (slid out, never in it, at the radius slider's ends too), a turn refused in a narrow way,
// prone refused in a gap too short, kept down under a slab, refused with the rope out and in water deeper than it lies; a peer
// lying as a lying sensor through the real `RemoteBodies` path. With both switches at their other setting
// the harness never asks the shape anything and prone is today's. The hand-overs only the game makes (the player's update,
// the rig's layer and bends, the game's placing hand) are pinned as text.
//
// Run: node tools/swg/tests/bodyShape.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { TestBody, box, ground, heightChunk, makePhysics, type Physics } from './grappleBody.ts';
import { RAPIER, TRIMESH_FLAGS, cleanTrimesh, Physics as GamePhysics } from '../../../src/core/physics.ts';
import { MOVE_TUNE, MOVE_TUNE_SHIPPED, moveBefore, resetMoveTune, shapeRulesOn, tuneMove } from '../../../src/anim/moveTune.ts';
import { MOVE_DIALS } from '../../../src/anim/moveDials.ts';
import { BODY_CAPSULE, BodyShape, CROUCH_TALL, DUCK_CLEAR, LYING, LYING_LENGTH, STAND_TALL, ShapeIn, type ShapeWorld } from '../../../src/player/bodyShape.ts';
import { RemoteBodies } from '../../../src/net/remoteBodies.ts';
import { CLIMB_TUNE, climbFeedbackBefore, resetClimbTune } from '../../../src/anim/climbTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const RATES = [30, 60, 144, 240] as const;
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r/g, '');
const r3 = (v: number) => v.toFixed(3);

resetMoveTune();
resetClimbTune();

/** A body standing at the origin facing +z, in a world `build` made, the world stepped once (a query sees nothing before). */
async function bodyIn(build: (p: Physics) => void): Promise<{ b: TestBody; p: Physics }> {
  const p = await makePhysics();
  build(p);
  p.stepOnce();
  const b = new TestBody(p);
  b.place(0, 0, 0);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  return { b, p };
}

/** How far the upright capsule's top ball reaches into a box (under nought: how far it stays off it). */
function topInBox(b: TestBody, min: number[], max: number[]): number {
  const c = [b.pos.x, b.pos.y + b.shape.tall - BODY_CAPSULE.r, b.pos.z];
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const d = c[i] < min[i] ? min[i] - c[i] : c[i] > max[i] ? c[i] - max[i] : 0;
    s += d * d;
  }
  return BODY_CAPSULE.r - Math.sqrt(s);
}

/** The lying capsule's turn for a heading (the shape's own arithmetic, for the tests' own contact). */
function lyingTurn(h: number): { x: number; y: number; z: number; w: number } {
  const s1 = Math.SQRT1_2;
  return { x: Math.cos(h / 2) * s1, y: s1 * Math.sin(h / 2), z: -s1 * Math.sin(h / 2), w: s1 * Math.cos(h / 2) };
}
/** How deep the lying capsule stands in a collider (under nought: in it). */
function lyingIn(b: TestBody, col: RAPIER.Collider): number {
  const r = MOVE_TUNE.lyingRadius;
  const shape = new RAPIER.Capsule(LYING_LENGTH / 2 - r, r);
  const c = col.contactShape(shape, { x: b.pos.x, y: b.pos.y + r, z: b.pos.z }, lyingTurn(b.shape.lyingYaw), 0);
  return c ? c.distance : 1;
}

// ---- 1. the table ----------------------------------------------------------------------------------------------------------
{
  ok(MOVE_TUNE.proneShape === 'lying' && MOVE_TUNE.duck === 'on', "the new settings ship on (the owner's ask): prone lies down, the body ducks");
  ok(MOVE_TUNE.lyingRadius === 0.2 && MOVE_TUNE.duckAhead === 0.6 && MOVE_TUNE.duckMost === 0.75, "the starts: lyingRadius 0.2 (the brief's 0.22 less the 0.02 that brings its 0.5 m slab within the capsule and the controller's two 0.04 m skins), duckAhead 0.6, duckMost 0.75 (the brief's)");
  ok(MOVE_TUNE_SHIPPED.duckRate === 3 && MOVE_TUNE_SHIPPED.duckBend === 40 && MOVE_TUNE_SHIPPED.duckNeck === 20, 'and ours, each with its reason in the table: duckRate 3, duckBend 40, duckNeck 20');
  const w = tuneMove({ duck: 'sideways', duckMost: 0.2, nothing: 1 });
  ok(w.some((s) => s.includes("duck takes 'on' or 'off'")) && w.some((s) => s.includes('duckMost held to 0.7')) && w.includes('no nothing') && MOVE_TUNE.duckMost === 0.7, 'a typed value is held to its choices and its range, in words (the deepest duck never under the capsule\'s own ball)');
  resetMoveTune();
  const keys = MOVE_DIALS.groups.flatMap((g) => g.dials.map((d) => d.key));
  ok(['proneShape', 'lyingRadius', 'duck', 'duckAhead', 'duckMost', 'duckRate', 'duckBend', 'duckNeck'].every((k) => keys.includes(`tune.${k}`)), 'every number and switch is a dial in the debug menu under `move`');
  for (const g of MOVE_DIALS.groups) for (const d of g.dials) if (d.kind === 'number') d.set(d.max);
  ok(MOVE_TUNE.duckAhead === 2 && MOVE_TUNE.duckRate === 12 && MOVE_TUNE.lyingRadius === 0.35, "and each slider reaches the tune through `tuneMove` (every one moved to its top)");
  resetMoveTune();
  moveBefore();
  ok(!shapeRulesOn() && MOVE_TUNE.proneShape === 'crouch' && MOVE_TUNE.duck === 'off', "`moveBefore` puts both switches to their other setting: today's capsule");
  resetMoveTune();
  climbFeedbackBefore();
  ok(MOVE_TUNE.duck === 'off' && MOVE_TUNE.proneShape === 'crouch' && CLIMB_TUNE.grabFree === 'whole', "`climbFeedbackBefore` (which `climbTwoBefore`, climbToday's and climbAfter's 'before', calls) puts this round's body switches back too");
  resetMoveTune();
  resetClimbTune();
}

// ---- 2. ducking under a beam, walking and running, at every rate ----------------------------------------------------------
const UNDERS = [1.5, 1.3, 1.1, 0.9] as const;
const ducked = new Map<string, number>();
for (const under of UNDERS) {
  for (const run of [false, true]) {
    for (const fps of RATES) {
      const bmin = [-3, under, 4];
      const bmax = [3, under + 0.3, 4.4];
      const { b } = await bodyIn((p) => {
        ground(p, 0);
        box(p, bmin, bmax, false);
      });
      let worst = -Infinity;
      let least = Infinity;
      let shareAt = 0;
      let bendAt = 0;
      let keyFree = true;
      b.key('KeyW', true);
      if (!run) b.key('ShiftLeft', true);
      b.run(fps, 4, () => {
        worst = Math.max(worst, topInBox(b, bmin, bmax));
        if (b.shape.tall < least) {
          least = b.shape.tall;
          shareAt = b.shape.share;
          bendAt = b.shape.bend;
        }
        if (b.input.held('crouch')) keyFree = false;
      });
      const way = run ? 'running' : 'walking';
      ok(b.pos.z > bmax[2] + 2 && keyFree, `${way} under a beam ${under} m up at ${fps} fps: through and past it with no key (z ${r3(b.pos.z)})`);
      ok(worst < -0.02, `... never pressing its capsule's top into it (it stays ${r3(-worst)} m off)`);
      ok(least <= under - DUCK_CLEAR + 1e-6 && least >= MOVE_TUNE.duckMost - 1e-6, `... ducked to ${r3(least)} m under it, no lower than the deepest duck`);
      ok(b.shape.tall === STAND_TALL && b.shape.share === 0 && b.shape.bend === 0, '... and standing again past it');
      const wantShare = Math.min(1, (STAND_TALL - least) / (STAND_TALL - CROUCH_TALL));
      const wantBend = least < CROUCH_TALL ? Math.min(1, (CROUCH_TALL - least) / (CROUCH_TALL - MOVE_TUNE.duckMost)) : 0;
      ok(Math.abs(shareAt - wantShare) < 1e-9 && Math.abs(bendAt - wantBend) < 1e-9, `... the pose's crouch share ${r3(shareAt)} and bend ${r3(bendAt)} by how far under standing and the crouch the capsule is`);
      ducked.set(`${under} ${run} ${fps}`, least);
    }
  }
}
for (const under of UNDERS) {
  for (const run of [false, true]) {
    const at = RATES.map((fps) => ducked.get(`${under} ${run} ${fps}`)!);
    const spread = Math.max(...at) - Math.min(...at);
    ok(spread < 0.02, `under ${under} m ${run ? 'running' : 'walking'} the duck is alike at every rate (${at.map(r3).join(', ')}: within ${r3(spread)} m)`);
  }
}

// ---- 3. staying ducked under a long low roof; the crouch key further in a tunnel ------------------------------------------
for (const fps of RATES) {
  const { b } = await bodyIn((p) => {
    ground(p, 0);
    box(p, [-3, 1.2, 3], [3, 1.5, 9], false);
  });
  b.key('KeyW', true);
  b.key('ShiftLeft', true);
  for (let i = 0; i < fps * 6 && b.pos.z < 5.5; i++) b.frame(1 / fps);
  b.key('KeyW', false);
  b.key('ShiftLeft', false);
  b.run(fps, 1);
  ok(b.pos.z > 4 && b.pos.z < 8 && b.shape.tall <= 1.2 - DUCK_CLEAR + 1e-6 && b.shape.room < 1.3, `${fps} fps: stood still under a 1.2 m roof the body stays ducked (${r3(b.shape.tall)} m, the room over it ${r3(b.shape.room)} m): rising is asked of the room`);
}
for (const fps of RATES) {
  const tmin = [-3, 0.9, 3];
  const tmax = [3, 1.2, 7];
  const { b } = await bodyIn((p) => {
    ground(p, 0);
    box(p, tmin, tmax, false);
  });
  b.run(fps, 0.2);
  b.key('ControlLeft', true);
  b.frame(1 / fps);
  const keyed = b.shape.tall;
  b.key('KeyW', true);
  let least = Infinity;
  let worst = -Infinity;
  for (let i = 0; i < fps * 10 && b.pos.z < 5; i++) {
    b.frame(1 / fps);
    least = Math.min(least, b.shape.tall);
    worst = Math.max(worst, topInBox(b, tmin, tmax));
  }
  b.key('KeyW', false);
  b.key('ControlLeft', false);
  b.run(fps, 0.5);
  const stays = b.shape.tall;
  b.key('KeyW', true);
  for (let i = 0; i < fps * 10 && b.pos.z < 8.5; i++) b.frame(1 / fps);
  b.key('KeyW', false);
  b.run(fps, 1);
  ok(keyed === CROUCH_TALL && least <= 0.9 - DUCK_CLEAR + 1e-6 && worst < -0.02, `${fps} fps: crouched by the key (${r3(keyed)} m) the body ducks further in a 0.9 m tunnel (${r3(least)} m), never into it`);
  ok(stays <= 0.9 - DUCK_CLEAR + 1e-6 && b.pos.z > 8 && b.shape.tall === STAND_TALL, `... the key let go inside it stays down (${r3(stays)} m), and stands again past its end`);
}

// ---- 3b. ducked, off the feet: a jump and a step off an edge under the roof grow only into the room over the feet ---------------
// The review of the round: off its feet the capsule went to standing at once, so a jump under a 1.1 m slab stood it up 0.6 m
// inside the slab and the body jittered under the floor for good; stepping off an edge under a roof did the same at 30.
/** How deep a capsule this tall at these feet stands in a box (under nought: in it), its contact as the engine works it. */
function capsuleInBox(b: TestBody, p: Physics, col: RAPIER.Collider): number {
  const half = b.shape.tall / 2 - BODY_CAPSULE.r;
  const shape = new RAPIER.Capsule(half, BODY_CAPSULE.r);
  const k = col.contactShape(shape, { x: b.pos.x, y: b.pos.y + BODY_CAPSULE.r + half, z: b.pos.z }, { x: 0, y: 0, z: 0, w: 1 }, 0);
  void p;
  return k ? k.distance : 1;
}
for (const under of [1.1, 1.3]) {
  for (const fps of RATES) {
    let slab!: RAPIER.Collider;
    const { b, p } = await bodyIn((q) => {
      ground(q, 0);
      slab = box(q, [-3, under, 2], [3, under + 0.3, 8], false);
    });
    b.key('KeyW', true);
    b.key('ShiftLeft', true);
    for (let i = 0; i < fps * 6 && b.pos.z < 4.5; i++) b.frame(1 / fps);
    b.key('KeyW', false);
    b.key('ShiftLeft', false);
    b.run(fps, 0.5);
    const still = b.shape.tall;
    let deepest = 1;
    let tallest = 0;
    let lowest = Infinity;
    b.key('Space', true);
    b.frame(1 / fps);
    b.key('Space', false);
    b.run(fps, 1.2, () => {
      deepest = Math.min(deepest, capsuleInBox(b, p, slab));
      tallest = Math.max(tallest, b.shape.tall);
      lowest = Math.min(lowest, b.pos.y);
    });
    ok(still < under && deepest > -0.005 && tallest <= still + 1e-9 && lowest > -0.01 && Math.abs(b.pos.y - 0.04) < 0.01 && b.shape.tall < under, `${fps} fps: ducked under a slab ${under} m up (${r3(still)} m), a jump keeps the capsule out of it (never taller than it was, ${r3(tallest)} m; closest ${r3(deepest)} m) and the feet on the floor after (${r3(b.pos.y)}; never under it)`);
  }
}
for (const fps of RATES) {
  let roof!: RAPIER.Collider;
  const { b, p } = await bodyIn((q) => {
    ground(q, -0.6);
    box(q, [-3, -0.6, -5], [3, 0, 5], false);
    roof = box(q, [-3, 1.1, 1], [3, 1.4, 12], false);
  });
  b.key('KeyW', true);
  b.key('ShiftLeft', true);
  let deepest = 1;
  b.run(fps, 5, () => (deepest = Math.min(deepest, capsuleInBox(b, p, roof))));
  ok(deepest > -0.005 && b.pos.z > 9 && b.pos.y < -0.5, `${fps} fps: ducked under a roof, stepping off a 0.6 m edge under it keeps the capsule out of the roof (closest ${r3(deepest)} m), and it walks on below (z ${r3(b.pos.z)})`);
}

// ---- 4. no duck where nothing is over the way: a ramp, a hill, stairs, the air, the placing hand ----------------------------
function ramp(p: Physics, deg: number): void {
  ground(p, 0);
  const t = Math.tan((deg * Math.PI) / 180);
  const H = 6;
  const L = H / t;
  const W = 4;
  const X = 2;
  const v = new Float32Array([-W, 0, X, -W, 0, X + L, -W, H, X + L, W, 0, X, W, 0, X + L, W, H, X + L]);
  const idx = new Uint32Array([0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3, 0, 2, 1, 3, 4, 5]);
  const clean = cleanTrimesh(v, idx)!;
  p.world.createCollider(RAPIER.ColliderDesc.trimesh(clean.vertices, clean.indices, TRIMESH_FLAGS));
}
const flats: [string, (p: Physics) => void][] = [
  ['a 30-degree ramp (a closed model)', (p) => ramp(p, 30)],
  ['a 25-degree hill (a heightfield)', (p) => heightChunk(p, -32, -32, (_x, z) => (z <= 2 ? 0 : (z - 2) * Math.tan((25 * Math.PI) / 180)))],
  ['stairs of 0.17 m risers', (p) => {
    ground(p, 0);
    for (let i = 0; i < 12; i++) box(p, [-2, 0, 2 + i * 0.3], [2, 0.17 * (i + 1), 2 + (i + 1) * 0.3], false);
  }],
];
for (const [what, build] of flats) {
  for (const run of [false, true]) {
    for (const fps of RATES) {
      const { b } = await bodyIn(build);
      let least = Infinity;
      let top = -Infinity;
      b.key('KeyW', true);
      if (!run) b.key('ShiftLeft', true);
      b.run(fps, 2.5, () => {
        least = Math.min(least, b.shape.tall);
        top = Math.max(top, b.pos.y);
      });
      ok(least === STAND_TALL && top > 1.5, `${run ? 'running' : 'walking'} up ${what} at ${fps} fps: never ducked (its least ${r3(least)} m; up to ${r3(top)} m)`);
    }
  }
}
for (const fps of [30, 240]) {
  const { b } = await bodyIn((p) => {
    ground(p, 0);
    box(p, [-3, 1.3, 2.2], [3, 1.6, 2.6], false);
  });
  b.key('KeyW', true);
  b.key('Space', true);
  let airLeast = Infinity;
  b.run(fps, 0.6, () => {
    if (!b.grounded) airLeast = Math.min(airLeast, b.shape.tall);
  });
  ok(airLeast === STAND_TALL, `${fps} fps: jumping, no duck (the capsule stands in the air: ${r3(airLeast)} m)`);
}
for (const fps of [30, 240]) {
  const { b } = await bodyIn((p) => {
    ground(p, 0);
    box(p, [-3, 1.3, 4], [3, 1.6, 4.4], false);
  });
  b.placingHand = true;
  let least = Infinity;
  b.key('KeyW', true);
  b.run(fps, 3, () => (least = Math.min(least, b.shape.tall)));
  ok(least === STAND_TALL && b.pos.z < 4, `${fps} fps: with the placing hand full the duck waits, and the beam stops the body as today (z ${r3(b.pos.z)})`);
}

// ---- 4b. the path box asked at a rate: once a stretch of travel, not once a frame ---------------------------------------------
// The review of the round: the box was asked every frame the body moved on its feet, about 380 bytes a frame of the engine's
// answers that today's walk never made. Its clear answer stands while the body is inside what the box covered.
for (const fps of RATES) {
  for (const run of [false, true]) {
    const { b } = await bodyIn((p) => ground(p, 0));
    b.key('KeyW', true);
    if (!run) b.key('ShiftLeft', true);
    b.run(fps, 0.5);
    const asked = b.shape.boxAsked;
    const kept = b.shape.boxKept;
    const z0 = b.pos.z;
    b.run(fps, 3);
    const n = b.shape.boxAsked - asked;
    const k = b.shape.boxKept - kept;
    const metres = b.pos.z - z0;
    ok(n + k === fps * 3 && n <= Math.ceil(metres / 0.2) + 2, `${fps} fps ${run ? 'running' : 'walking'} straight in the open: the path box asked ${n} times over ${r3(metres)} m (${fps * 3} frames: its clear answer kept for ${k})`);
  }
}
{
  // A beam stood across the way ahead mid-run (something new since the box was last asked clear, which no still thing of a
  // world is) is found at the next ask, within the box's margin of travel, and ducked under in time.
  for (const fps of [60, 240]) {
    const { b, p } = await bodyIn((q) => ground(q, 0));
    b.key('KeyW', true);
    b.run(fps, 0.8);
    const z = b.pos.z;
    const bmin = [-3, 1.2, z + 2.4];
    const bmax = [3, 1.5, z + 2.8];
    box(p, bmin, bmax, false);
    p.stepOnce();
    let worst = -Infinity;
    let least = Infinity;
    b.run(fps, 2, () => {
      worst = Math.max(worst, topInBox(b, bmin, bmax));
      least = Math.min(least, b.shape.tall);
    });
    ok(b.pos.z > bmax[2] + 1 && worst < -0.02 && least <= 1.2 - DUCK_CLEAR + 1e-6, `${fps} fps: a beam stood across the way ahead mid-run is ducked under all the same (to ${r3(least)} m, ${r3(-worst)} m off it)`);
  }
}

// ---- 5. the switches at their other setting: today's ----------------------------------------------------------------------
for (const fps of [30, 240]) {
  moveBefore();
  const { b } = await bodyIn((p) => {
    ground(p, 0);
    box(p, [-3, 1.3, 4], [3, 1.6, 4.4], false);
  });
  b.key('KeyW', true);
  b.run(fps, 3);
  b.key('KeyW', false);
  b.key('KeyZ', true);
  b.run(fps, 0.2);
  ok(b.pos.z < 4 && b.shape.asks === 0 && b.shape.tall === STAND_TALL && !b.prone, `${fps} fps, both switches at their other setting: the beam stops the body, the shape is never asked anything, and the harness has no prone of its own (today's)`);
  resetMoveTune();
}
{
  tuneMove({ proneShape: 'crouch' });
  const { b } = await bodyIn((p) => ground(p, 0));
  b.run(60, 0.2);
  b.key('KeyZ', true);
  b.run(60, 0.1);
  ok(b.prone && b.shape.kind !== LYING && b.colliderOffsetY === BODY_CAPSULE.r + BODY_CAPSULE.crouch, "with 'crouch' (the duck on) the shape a prone body wears is today's crouch shell, its middle 0.50 m up");
  resetMoveTune();
  tuneMove({ duck: 'off' });
  const { b: c } = await bodyIn((p) => ground(p, 0));
  c.run(60, 0.2);
  c.key('KeyZ', true);
  c.run(60, 0.1);
  ok(c.prone && c.shape.kind === LYING && Math.abs(c.colliderOffsetY - MOVE_TUNE.lyingRadius) < 1e-9, "... and with 'lying' (the duck off) the lying capsule, each switch on its own");  resetMoveTune();
}

// ---- 6. lying: under a slab a crouch cannot pass, kept down, getting up out from under ------------------------------------
for (const fps of RATES) {
  const smin = [-3, 0.55, 3];
  const smax = [3, 0.85, 6];
  const { b, p } = await bodyIn((q) => {
    ground(q, 0);
    box(q, smin, smax, false);
  });
  b.key('KeyZ', true);
  b.frame(1 / fps);
  b.key('KeyZ', false);
  ok(b.prone && b.shape.kind === LYING && Math.abs(b.colliderOffsetY - MOVE_TUNE.lyingRadius) < 1e-9, `${fps} fps: Z lies the body down: a capsule along it, its middle the lying radius up (${r3(b.colliderOffsetY)} m)`);
  b.key('KeyW', true);
  for (let i = 0; i < fps * 10 && b.pos.z < 4.5; i++) b.frame(1 / fps);
  b.key('KeyW', false);
  ok(b.pos.z >= 4.5, `... and crawls in under a slab 0.55 m up (z ${r3(b.pos.z)})`);
  const wordsAt = b.ledgeWords.length;
  b.key('Space', true);
  b.frame(1 / fps);
  b.key('Space', false);
  b.run(fps, 0.2);
  ok(b.prone && b.shape.kind === LYING && b.ledgeWords.slice(wordsAt).includes('No room to stand up here.'), '... where getting up is refused in words and the body stays down');
  b.key('KeyW', true);
  for (let i = 0; i < fps * 12 && b.pos.z < 7.4; i++) b.frame(1 / fps);
  b.key('KeyW', false);
  b.key('Space', true);
  b.frame(1 / fps);
  b.key('Space', false);
  b.run(fps, 0.2);
  ok(!b.prone && b.shape.kind !== LYING && b.pos.z > 6.5, `... and out from under it, gets up (z ${r3(b.pos.z)})`);
  void p;
  // A crouch cannot pass.
  const { b: c } = await bodyIn((q) => {
    ground(q, 0);
    box(q, smin, smax, false);
  });
  c.key('ControlLeft', true);
  c.key('KeyW', true);
  c.run(fps, 6);
  ok(c.pos.z < 3, `${fps} fps: a crouched body is stopped at the same slab (z ${r3(c.pos.z)})`);
}
{
  // The slab at 0.5 m, the brief's own: a lying capsule of 0.4 m (radius 0.2) and the controller's 0.04 m off the ground and
  // off the slab come to 0.48 m, so it crawls through at every rate (the review of the round: at the brief's 0.22, which needs
  // 0.52 m, it passed at 30 and 60 and stopped at 144 and 240); a crouch cannot. And through it the lying capsule is put where
  // the body is before every move (`syncLying`).
  for (const fps of RATES) {
    const { b } = await bodyIn((q) => {
      ground(q, 0);
      box(q, [-3, 0.5, 3], [3, 0.8, 6], false);
    });
    b.key('KeyZ', true);
    b.frame(1 / fps);
    b.key('KeyZ', false);
    const synced = b.shape.synced;
    b.key('KeyW', true);
    for (let i = 0; i < fps * 12 && b.pos.z < 7.5; i++) b.frame(1 / fps);
    b.key('KeyW', false);
    ok(b.pos.z >= 7.5 && b.shape.kind === LYING && b.shape.synced > synced, `${fps} fps: a lying body crawls right through under a slab 0.5 m up (to z ${r3(b.pos.z)}), its collider put where it lies before every move (${b.shape.synced - synced} moves)`);
    const { b: c } = await bodyIn((q) => {
      ground(q, 0);
      box(q, [-3, 0.5, 3], [3, 0.8, 6], false);
    });
    c.key('ControlLeft', true);
    c.key('KeyW', true);
    c.run(fps, 6);
    ok(c.pos.z < 3, `${fps} fps: ... where a crouched body is stopped (z ${r3(c.pos.z)})`);
  }
  // Just under what the capsule and its two skins stand (a little over twice the radius) the controller's own way of meeting a
  // gap smaller than its offset decides by the length of a frame's step, as it does for the upright crouched capsule today
  // (measured: under a slab 1.05 m up today's crouch is through at 30 and 60 and stopped at 144 and 240): not this round's.
  const band: string[] = [];
  for (const fps of RATES) {
    const { b } = await bodyIn((q) => {
      ground(q, 0);
      box(q, [-3, 0.46, 3], [3, 0.76, 6], false);
    });
    b.key('KeyZ', true);
    b.frame(1 / fps);
    b.key('KeyZ', false);
    b.key('KeyW', true);
    for (let i = 0; i < fps * 12 && b.pos.z < 7.5; i++) b.frame(1 / fps);
    band.push(`${fps}: ${r3(b.pos.z)}`);
  }
  note(`under a slab 0.46 m up (inside the controller's own offset of the capsule) a lying body ends at z ${band.join(', ')}: the controller's, by frame rate, as today's crouch is a hair over its own height`);
}

// ---- 6b. lying onto a step and up a hillside: never into the floor, never perched on an end --------------------------------
// The review of the round: with no sync a lying crawl onto a 0.1 m step at 240 frames a second sank 0.14 m under the floor,
// popped 0.6 m up and crawled on inside the step; and a level capsule on a hillside rested on its uphill end, the body 0.1 to
// 0.3 m off the ground.
for (const curb of [0.1, 0.15]) {
  for (const fps of RATES) {
    const { b, p } = await bodyIn((q) => {
      ground(q, 0);
      box(q, [-3, 0, 2], [3, curb, 12], false);
    });
    b.run(fps, 0.3);
    b.key('KeyZ', true);
    b.frame(1 / fps);
    b.key('KeyZ', false);
    b.run(fps, 0.5);
    b.key('KeyW', true);
    let deepest = 1;
    let low = Infinity;
    let high = -Infinity;
    b.run(fps, 8, () => {
      const q = b.collider.rotation();
      const shape = new RAPIER.Capsule(b.shape.half, b.shape.radius);
      const at = { x: b.pos.x, y: b.pos.y + b.shape.offsetY, z: b.pos.z };
      p.world.intersectionsWithShape(at, q, shape, (col) => {
        if (col.handle === b.collider.handle) return true;
        const k = col.contactShape(shape, at, q, 0);
        if (k && k.distance < deepest) deepest = k.distance;
        return true;
      });
      if (b.pos.z > 0.5 && b.pos.z < 4) {
        low = Math.min(low, b.pos.y);
        high = Math.max(high, b.pos.y);
      }
    });
    b.key('KeyW', false);
    ok(b.shape.kind === LYING && b.pos.z > 7 && Math.abs(b.pos.y - (curb + 0.04)) < 0.01 && deepest > -0.01 && low > -0.01 && high < curb + 0.1, `${fps} fps: a lying body crawls onto a ${curb} m step and on along it (ends z ${r3(b.pos.z)}, feet ${r3(b.pos.y)}), its feet between ${r3(low)} and ${r3(high)} over the crossing and never in the floor or the step (deepest ${r3(deepest)} m)`);
  }
}
for (const deg of [8, 20]) {
  for (const facing of [0, Math.PI / 2]) {
    for (const fps of [30, 240]) {
      const h = (_x: number, z: number) => z * Math.tan((deg * Math.PI) / 180);
      const { b } = await bodyIn((q) => heightChunk(q, -32, -32, h));
      b.heading = facing;
      b.headingWanted = facing;
      b.forward.set(Math.sin(facing), 0, Math.cos(facing));
      b.right.set(-Math.cos(facing), 0, Math.sin(facing));
      b.run(fps, 0.5);
      b.key('KeyZ', true);
      b.frame(1 / fps);
      b.key('KeyZ', false);
      b.run(fps, 0.5);
      const gap = b.pos.y - h(b.pos.x, b.pos.z);
      // The controller's 0.04 m off the ground is along the ground's up, so over a hillside the feet stand 0.04 over its cosine:
      // what a capsule lying along the slope with its side the radius off it leaves (no lift over the plane's up, and the
      // controller pushed the capsule out of the hillside: 0.055 m on 20 degrees).
      const want = 0.04 / Math.cos((deg * Math.PI) / 180);
      const tilt = facing === 0 ? deg : 0;
      ok(b.shape.kind === LYING && Math.abs(gap - want) < 0.003 && Math.abs((b.shape.lyingTilt * 180) / Math.PI - tilt) < 0.05, `${fps} fps: lying on a ${deg}-degree hillside ${facing === 0 ? 'facing up it' : 'across it'}, the feet ${r3(gap)} m over it (the controller's 0.04 m along the slope's up: ${r3(want)}), the capsule tipped ${r3((b.shape.lyingTilt * 180) / Math.PI)} degrees along it, never perched on an end`);
    }
  }
}

// ---- 7. lying: turned beside a wall, slid out and never in it; a turn refused in a narrow way --------------------------------
for (const fps of RATES) {
  let wall!: RAPIER.Collider;
  const { b } = await bodyIn((q) => {
    ground(q, 0);
    wall = box(q, [0.4, 0, -5], [1.0, 2, 5], false);
  });
  b.key('KeyZ', true);
  b.frame(1 / fps);
  b.key('KeyZ', false);
  b.headingWanted = Math.PI / 2;
  let deepest = 1;
  b.run(fps, 1.5, () => (deepest = Math.min(deepest, lyingIn(b, wall))));
  ok(Math.abs(b.heading - Math.PI / 2) < 1e-3 && b.pos.x < -0.45 && deepest > -1e-3, `${fps} fps: a lying body turned to face a wall beside it is slid out along it as it turns (to x ${r3(b.pos.x)}), never in it (closest ${r3(deepest)} m)`);
}
{
  // The contact asked with the skin as its reach: a turn the intersection test refuses where the contact, asked with none, finds
  // no touch (a hair's gap, as the engine's two tests part) is slid by the skin rather than refused (a stand-in world: the
  // turned capsule meets something until slid, and the contact answers only within its reach).
  const shape = new BodyShape({ capsule: (h, r) => new RAPIER.Capsule(h, r), ball: (r) => new RAPIER.Ball(r), cuboid: (x, y, z) => new RAPIER.Cuboid(x, y, z) });
  let reach = -1;
  const met = {
    contactShape: (_s: unknown, _p: unknown, _q: unknown, pred: number) => {
      reach = pred;
      return pred >= 0.01 ? { distance: 0.005, normal1: { x: -1, y: 0, z: 0 } } : null;
    },
  };
  const world = {
    intersectionWithShape: (p: { x: number }) => (p.x === 0 ? met : null),
    castShape: () => null,
  } as unknown as ShapeWorld;
  const f = new ShapeIn();
  f.scale = 1;
  shape.writeLying({ setHalfHeight() {}, setRadius() {}, setRotationWrtParent() {}, setTranslationWrtParent() {}, setTranslation() {}, setRotation() {} }, 0, 0, 0, 0, 1);
  f.heading = 0.4;
  shape.turnLyingIn(world, f, { setHalfHeight() {}, setRadius() {}, setRotationWrtParent() {}, setTranslationWrtParent() {}, setTranslation() {}, setRotation() {} });
  ok(reach >= 0.01 && Math.abs(shape.lyingYaw - 0.4) < 1e-12 && shape.slideX < 0 && shape.last === 'the turn slid out of what it met', `a turn met at a hair's gap asks the contact with the skin as its reach (${reach} m) and is slid by it (${r3(shape.slideX)} m), never refused for want of a touch`);
}
for (const radius of [0.15, 0.3]) {
  // At the slider's ends too, at the longest and the shortest frame: a frame's turn refused whole is tried by halves, and
  // asked of the contact with the skin as its reach (the review's fixing round: a 0.3 m capsule stood refused at 30, a
  // 0.2 m one stuck at 58 degrees at 144).
  for (const fps of [30, 144]) {
    tuneMove({ lyingRadius: radius });
    let wall!: RAPIER.Collider;
    const { b } = await bodyIn((q) => {
      ground(q, 0);
      wall = box(q, [0.4, 0, -5], [1.0, 2, 5], false);
    });
    b.key('KeyZ', true);
    b.frame(1 / fps);
    b.key('KeyZ', false);
    b.headingWanted = Math.PI / 2;
    let deepest = 1;
    b.run(fps, 1.5, () => (deepest = Math.min(deepest, lyingIn(b, wall))));
    ok(Math.abs(b.heading - Math.PI / 2) < 1e-3 && b.pos.x < -0.45 && deepest > -1e-3, `radius ${radius}, ${fps} fps: turned to face the wall it is slid out along it (to x ${r3(b.pos.x)}), never in it`);
    resetMoveTune();
  }
}
for (const fps of RATES) {
  let left!: RAPIER.Collider;
  let right!: RAPIER.Collider;
  const { b } = await bodyIn((q) => {
    ground(q, 0);
    left = box(q, [0.45, 0, -5], [1.0, 2, 5], false);
    right = box(q, [-1.0, 0, -5], [-0.45, 2, 5], false);
  });
  b.key('KeyZ', true);
  b.frame(1 / fps);
  b.key('KeyZ', false);
  b.headingWanted = Math.PI / 2;
  let deepest = 1;
  b.run(fps, 1.5, () => (deepest = Math.min(deepest, lyingIn(b, left), lyingIn(b, right))));
  ok(b.heading < Math.PI / 3 && deepest > -1e-3 && b.shape.last.startsWith('a turn refused'), `${fps} fps: in a way 0.9 m wide the turn across it is refused (held at ${r3((b.heading * 180) / Math.PI)} degrees), never into either wall`);
}

// ---- 8. lying refused: a gap too short, the rope out, water deeper than it lies ---------------------------------------------
{
  const { b } = await bodyIn((q) => {
    ground(q, 0);
    box(q, [-2, 0, 0.6], [2, 2, 1.0], false);
    box(q, [-2, 0, -1.0], [2, 2, -0.6], false);
  });
  b.key('KeyZ', true);
  b.run(60, 0.1);
  ok(!b.prone && b.shape.kind !== LYING && b.ledgeWords.includes('No room to lie down here.'), 'prone in a gap 1.2 m long is refused in words (the lying body is 1.8 m)');
}
{
  const { b } = await bodyIn((q) => ground(q, 0));
  b.hook(0, 3, 5, 0, -1, 0, null, 6);
  b.key('KeyZ', true);
  b.run(60, 0.1);
  const player = read('../../../src/player/player.ts');
  ok(!b.prone && b.shape.kind !== LYING && player.includes("if (this.grapple.out || this.grapple.released) S.said = S.last = 'Not with the grappling rope out.';"), 'with the grappling rope out Z lies nobody down: the hook mutes the postures, and lying down is refused in words besides (its collider sync stands the capsule upright)');
}
{
  const { b } = await bodyIn((q) => ground(q, 0));
  b.surface = () => 0.6;
  b.run(60, 0.1);
  b.key('KeyZ', true);
  b.run(60, 0.1);
  ok(!b.prone && b.ledgeWords.includes('Too deep to lie down here.'), 'prone in water 0.6 m deep is refused in words (deeper than the lying body is tall)');
}

// ---- 9. a peer lying, through the real `RemoteBodies` path -------------------------------------------------------------------
{
  const physics = await GamePhysics.create();
  const bodies = new RemoteBodies().bind(physics);
  const group = new THREE.Object3D();
  group.position.set(5, 0, 5);
  group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const view: Record<string, unknown> = { id: 7, name: 'peer', shown: true, group, rig: null, ship: null, shipBox: null, hp: 100, maxHp: 100, down: false, saber: false, saberColor: 0, low: true, lying: true };
  bodies.peerAdded(view as never);
  bodies.peerMoved(view as never);
  physics.stepOnce();
  const f = [...bodies.byCollider.values()][0] as unknown as { collider: RAPIER.Collider; halfHeight: number; radiusToward(at: THREE.Vector3): number; lying: boolean };
  const col = f.collider;
  const lyingHalf = LYING_LENGTH / 2 - MOVE_TUNE.lyingRadius;
  ok(f.lying && Math.abs(col.radius() - MOVE_TUNE.lyingRadius) < 1e-6 && Math.abs(col.halfHeight() - lyingHalf) < 1e-6 && Math.abs(f.halfHeight - MOVE_TUNE.lyingRadius) < 1e-9, `a peer whose state is a prone one is a lying sensor here (radius ${r3(col.radius())}, straight half ${r3(col.halfHeight())}), aimed at its middle ${r3(f.halfHeight)} m up`);
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(col.rotation().x, col.rotation().y, col.rotation().z, col.rotation().w));
  ok(Math.abs(axis.y) < 1e-6 && Math.abs(Math.abs(axis.x) - 1) < 1e-6, `... lying along their heading (its axis ${r3(axis.x)}, ${r3(axis.y)}, ${r3(axis.z)} for a peer facing +x)`);
  ok(Math.abs(f.radiusToward(new THREE.Vector3(9, 0, 5)) - (MOVE_TUNE.lyingRadius + lyingHalf)) < 1e-6 && Math.abs(f.radiusToward(new THREE.Vector3(5, 0, 9)) - MOVE_TUNE.lyingRadius) < 1e-6, '... and a blow reaches it along its length, not across it');
  view.lying = false;
  bodies.peerMoved(view as never);
  ok(!f.lying && Math.abs(col.radius() - 0.35) < 1e-6 && Math.abs(col.halfHeight() - 0.15) < 1e-6 && Math.abs(f.halfHeight - 0.5) < 1e-9, '... and up again, the low upright capsule it was (reshaped in place)');
  tuneMove({ proneShape: 'crouch' });
  view.lying = true;
  bodies.peerMoved(view as never);
  ok(!f.lying && Math.abs(col.radius() - 0.35) < 1e-6 && Math.abs(f.halfHeight - 0.5) < 1e-9, "under 'crouch' a prone peer is today's low upright capsule");
  resetMoveTune();
}

// ---- 10. what only the game hands over, as text --------------------------------------------------------------------------
{
  const player = read('../../../src/player/player.ts');
  const harness = read('./grappleBody.ts');
  const rig = read('../../../src/player/rig.ts');
  const main = read('../../../src/main.ts');
  const world = read('../../../src/world/world.ts');
  ok(player.includes('if (shapeRulesOn()) this.stepShape(dt, moving, move);\n    else this.setCrouchCollider((this.crouching || this.prone || this.kneeling) && this.grounded);'), "the player's update decides the capsule by the shape with either switch on, else by today's crouch rule, in the one place");
  ok(harness.includes('if (rules) this.stepShape(dt, moving, move, crouching);\n    else this.setCrouchCollider(crouching && this.grounded);'), '... and the harness in the same place');
  ok(/this\.torsoTwist = Math\.atan2\(Math\.sin\(back\), Math\.cos\(back\)\) \* LOCO_TUNE\.turn\.torso;\n    \}\n    \/\/ The feedback round, item 3:[^\n]*\n    if \(this\.shape\.kind === LYING\) this\.turnLying\(\);/.test(player), "the lying turn is asked right after the player's heading is decided");
  ok(/this\.prone = lyingRule \? this\.proneAsk\(!this\.prone, input\) : !this\.prone;/.test(player) && /this\.prone = lyingRule \? this\.proneAsk\(!this\.prone, input\) : !this\.prone;/.test(harness), "Z asks for room under 'lying' in the player and the harness alike");
  ok(/if \(this\.shape\.kind === LYING\) su\.ruled = false;/.test(player) && /if \(this\.shape\.kind === LYING\) slopeAt\.r = this\.shape\.radius;/.test(player), "the step's and the slope rule's capsule readers take the lying one");
  ok(/const ducks = MOVE_TUNE\.duck === 'on' && this\.shape\.kind !== LYING;\n    if \(ducks && this\.shape\.share > 0\) \{\n      rig\.duckWant = this\.shape\.share;\n      rig\.duckMoving = moving;/.test(player), "the crouch's share is handed to the rig before its update");
  ok(/if \(duckBend > 0\) pitch \+= \(duckBend \* MOVE_TUNE\.duckBend \* Math\.PI\) \/ 180;\n    rig\.twistTorso\([^\n]*, pitch\);\n    if \(duckBend > 0\) rig\.bendNeck\(\(duckBend \* MOVE_TUNE\.duckNeck \* Math\.PI\) \/ 180\);/.test(player), '... the spine bent through the twist and the neck after it, before the camera reads the head');
  ok(/this\.stepDuck\(dt\);[^\n]*\n[\s\S]{0,700}this\.limbPose\?\.restore\(\);\n    this\.legPose\?\.restore\(\);\n    this\.mixer\.update\(dt\);/.test(rig) && /private stepDuck\(dt: number\): void \{\n[^\n]*\n    if \(!\(this\.duckWant > 0 \|\| this\.duckIdleShare > 0 \|\| this\.duckWalkShare > 0\)\) return;/.test(rig), "the rig lays the duck's layer before its mixer (weights only), stepping nothing while nothing is asked or easing out");
  ok(/this\.cleanLookBone\(this\.lookBones\.head\);\n    \}\n[\s\S]{0,200}const dn = this\.duckNeckTurn;\n    if \(dn\.on && dn\.bone\) \{\n      if \(dn\.bone\.quaternion\.equals\(dn\.turned\)\) dn\.bone\.quaternion\.copy\(dn\.clean\);/.test(rig), "... and puts the neck's bend back after the look's own, the last laid first, so nothing is written over a clip");
  ok(/const arms = this\.armBones\(\);\n\s*const tracks = src\.tracks\.filter\(\(t\) => !arms\.has\(/.test(rig), "the layer leaves the arms' tracks to the state's clip (what the hands hold keeps its pose)");
  ok(main.includes('this.player.handPlacing = () => this.placing !== null || this.propPlacing !== null;'), 'the game hands the player its placing hand');
  ok(/radiusToward\(at\?: THREE\.Vector3\): number \{\n    const c = this\.capsule;\n    return c && c\.reachToward && at \? c\.reachToward\(at\) : 0\.35;/.test(world) && player.includes('reachToward(at: THREE.Vector3): number {'), "the world's player target reaches for a lying body along its length (`Player.reachToward`)");
  ok(/MOVE_TUNE\.duck === 'on' \? this\.shape\.eyeFor\(posture\) : posture;/.test(player), 'the third-person orbit comes down with a ducked capsule (first person reads the head)');
  // The review's fixes as the player and the harness hand them over (every behaviour test above runs the harness).
  const lyingSync = /const lyingSync = this\.shape\.kind === LYING && su\.ruled;\n    if \(this\.shape\.kind === LYING\) su\.ruled = false;/;
  const syncAfter = /else this\.stepUp\.sync\(this\.collider\);\n    if \(lyingSync\) this\.shape\.syncLying\(this\.collider, su\);/;
  ok(lyingSync.test(player) && lyingSync.test(harness) && syncAfter.test(player) && syncAfter.test(harness), "a lying collider is put where the body is before the move where the step would reach it, right after the step's own sync, in the player and the harness alike");
  const plane = /f\.filter = this\.(moveFilter\(\)|filter);\n    this\.groundPlaneInto\(f\);\n    (if \(lying\) S\.holdLying\(f, this\.collider\);|S\.turnLyingIn\(w, f, this\.collider\);)/g;
  ok((player.match(plane) ?? []).length === 2 && (harness.match(plane) ?? []).length === 2, "the ground's plane is handed to the shape before its frame and before the lying turn, in both");
  const into = /private groundPlaneInto\(f: ShapeIn\): void \{\n    f\.nx = this\.slope\.planeNx;\n    f\.ny = this\.slope\.planeNy;\n    f\.nz = this\.slope\.planeNz;\n  \}/;
  ok(into.test(player) && into.test(harness), "... the slope rule's last plane, in both");
}

console.log(`bodyShape: ${checks} checks passed`);
