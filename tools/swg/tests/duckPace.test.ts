// Climbing II's smoothness round, item 4 (`MOVE_TUNE.duckPace`, src/player/duckPace.ts and the roof probe in
// src/player/bodyShape.ts): ducking under things slows the body to the height it is ducked to and wears its clips; where the
// room is too low for the deepest duck but a lying body fits, it lies down and crawls, and gets up again where the room comes
// back. Driven through the game's own movement (the grapple's harness, `TestBody`: Jedi Academy's movement, the controller, the
// slope rule, the step and the body's shape, stepped in the player's order on the real Rapier) frame by frame while moving, at
// 30, 60, 144 and 240 frames a second: a walk and a run under a roof lowering by steps (1.4, 1.15, 1.0, 0.85 m) slowing at
// each step, wearing the crouch's clips at its height, lying down before a 0.55 m slab, crawling under it at the crawl's pace,
// getting up past it and standing again, never pressing its capsule into a roof; under 'before' the feedback round's duck,
// stopped at the slab; no lying down at a wall, a step, stairs, a ramp or a hill; a run straight into a slab lying down at one
// place at every rate, and never with the grappling rope out or in water deeper than the body lies (the round's review). The
// speeds the classes plan (`BodyLoco`)
// eased by the duck's shares, nought leaving every speed to the bit. The hand-overs only the game makes (the player's update,
// its rig state and the classes' frame) pinned as text. The digests with every switch of the round at its other setting are
// climbToday's, climbAfter's, climbFeedbackAfter's and bodyShapeToday's; bodyShape.test.ts is the feedback round's duck.
//
// Run: node tools/swg/tests/duckPace.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TestBody, box, ground, heightChunk, makePhysics, type Physics } from './grappleBody.ts';
import { RAPIER, TRIMESH_FLAGS, cleanTrimesh } from '../../../src/core/physics.ts';
import { MOVE_DIALS } from '../../../src/anim/moveDials.ts';
import { MOVE_SMOOTH_BEFORE, MOVE_TUNE, MOVE_TUNE_SHIPPED, resetMoveTune, tuneMove } from '../../../src/anim/moveTune.ts';
import { climbSmoothBefore, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { BodyLoco, newLocoIn, type LocoRig } from '../../../src/anim/bodyLoco.ts';
import { LOCO_TUNE } from '../../../src/anim/locoTune.ts';
import { BODY_CAPSULE, CROUCH_TALL, DUCK_CLEAR, LYING, STAND_TALL } from '../../../src/player/bodyShape.ts';
import { DuckPace, lieTall } from '../../../src/player/duckPace.ts';
import { JKA, UNIT } from '../../../src/player/jkaMove.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const RATES = [30, 60, 144, 240] as const;
const r2 = (v: number) => v.toFixed(2);
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r/g, '');
resetMoveTune();
resetClimbTune();

// ---- 1. the table ------------------------------------------------------------------------------------------------------------
{
  ok(MOVE_TUNE.duckPace === 'height' && MOVE_SMOOTH_BEFORE.duckPace === 'before', "the pace by height ships on (the owner's ask), its other setting 'before' in MOVE_SMOOTH_BEFORE");
  ok(MOVE_TUNE_SHIPPED.crouchAt === 1.05 && MOVE_TUNE_SHIPPED.crouchBand === 0.05 && MOVE_TUNE_SHIPPED.paceCurve === 1 && MOVE_TUNE_SHIPPED.proneUnder === 0.8 && MOVE_TUNE_SHIPPED.proneAhead === 1.2 && MOVE_TUNE_SHIPPED.riseAt === 1, 'the starts, each with its reason in the table: crouchAt 1.05, crouchBand 0.05, paceCurve 1, proneUnder 0.8, proneAhead 1.2, riseAt 1.0');
  climbSmoothBefore();
  ok(MOVE_TUNE.duckPace === 'before', "`climbSmoothBefore` puts the pace back with the round's climbing");
  resetMoveTune();
  const w = tuneMove({ duckPace: 'fast', proneUnder: 0.1, riseAt: 5 });
  ok(w.some((s) => s.includes("duckPace takes 'height' or 'before'")) && MOVE_TUNE.proneUnder === 0.45 && MOVE_TUNE.riseAt === 1.6, 'a typed value is held to its choices and its range, in words (a room under 0.45 fits no lying body)');
  resetMoveTune();
  const dials = MOVE_DIALS.groups.flatMap((g) => g.dials);
  const keys = dials.map((d) => d.key);
  ok(['duckPace', 'crouchAt', 'crouchBand', 'paceCurve', 'proneUnder', 'proneAhead', 'riseAt'].every((k) => keys.includes(`tune.${k}`)), "every number and the switch is a dial in the debug menu under `move` (\"Ducking's pace\")");
  for (const d of dials) if (d.kind === 'number' && /crouchAt|crouchBand|paceCurve|proneUnder|proneAhead|riseAt/.test(d.key)) d.set(d.max);
  ok(MOVE_TUNE.crouchAt === 1.6 && MOVE_TUNE.paceCurve === 4 && MOVE_TUNE.proneAhead === 3, 'and each slider reaches the tune through `tuneMove`');
  resetMoveTune();
}

// ---- 2. the pace's shares, pure ----------------------------------------------------------------------------------------------
{
  const d = new DuckPace();
  d.step(STAND_TALL, true, false);
  ok(!d.crouch && d.toCrouch === 0 && d.toCrawl === 0 && d.share === 1 && !d.active, 'standing tall: nothing');
  d.step((STAND_TALL + MOVE_TUNE.crouchAt) / 2, true, false);
  ok(!d.crouch && Math.abs(d.toCrouch - 0.5) < 1e-12 && Math.abs(d.share - (1 + (JKA.duckScale - 1) * 0.5)) < 1e-12, 'half way down to `crouchAt`: half way to the crouch\'s pace (paceCurve 1: straight)');
  tuneMove({ paceCurve: 2 });
  d.step((STAND_TALL + MOVE_TUNE.crouchAt) / 2, true, false);
  ok(Math.abs(d.toCrouch - 0.25) < 1e-12, '... a curve of 2 keeps the faster pace longer (a quarter at half way)');
  resetMoveTune();
  d.step(MOVE_TUNE.crouchAt, true, false);
  ok(d.crouch && d.toCrouch === 0 && d.toCrawl === 0, 'at `crouchAt` it wears the crouch\'s clips at the crouch\'s pace');
  d.step(MOVE_TUNE.crouchAt + MOVE_TUNE.crouchBand / 2, true, false);
  ok(d.crouch, '... and keeps them until it rises past the band');
  d.step(MOVE_TUNE.crouchAt + MOVE_TUNE.crouchBand + 0.01, true, false);
  ok(!d.crouch && Math.abs(d.toCrouch - (STAND_TALL - (MOVE_TUNE.crouchAt + MOVE_TUNE.crouchBand + 0.01)) / (STAND_TALL - MOVE_TUNE.crouchAt)) < 1e-12, '... past it the walk\'s again, eased toward the crouch\'s pace by how far down it is');
  d.step(lieTall(), true, false);
  ok(d.crouch && d.toCrawl === 1 && Math.abs(d.share - LOCO_TUNE.prone.forward.normal / LOCO_TUNE.crouch.forward.normal) < 1e-12, `at the lying height (${lieTall()} m: proneUnder less the clearance) the crawl's pace`);
  d.step((CROUCH_TALL + lieTall()) / 2, true, true);
  ok(!d.crouch && Math.abs(d.toCrawl - 0.5) < 1e-12, 'crouched by the key in a tunnel, eased on toward the crawl as deep as it ducks (the key\'s own clips)');
  d.step(0.9, false, false);
  ok(!d.active && d.share === 1, 'off its feet (the air, the water, climbing, riding, prone): nothing');
  tuneMove({ duckPace: 'before' });
  d.step(0.9, true, false);
  ok(!d.active, "under 'before': nothing");
  resetMoveTune();
  tuneMove({ duck: 'off' });
  d.step(0.9, true, false);
  ok(!d.active, 'with the duck off: nothing');
  resetMoveTune();
  ok(Math.abs(lieTall() - (MOVE_TUNE.proneUnder - DUCK_CLEAR)) < 1e-12 && lieTall() >= MOVE_TUNE.duckMost, 'the lying height is the room it lies down under less the clearance, never under the deepest duck');
}

// ---- 3. the classes' speeds eased by the shares (BodyLoco), nought to the bit ---------------------------------------------
{
  const rig: LocoRig = { has: () => true, speedOut: 0, readSpeed() { this.speedOut = 3; return true; } };
  const plan = (over: Record<string, unknown>) => {
    const L = new BodyLoco(LOCO_TUNE);
    const f = newLocoIn();
    f.sprint = LOCO_TUNE.speed.forward.sprint;
    f.pool = LOCO_TUNE.stamina.pool;
    let out = 0;
    for (let i = 0; i < 30; i++) {
      L.keys(1 / 60, false, false, false, rig);
      Object.assign(f, { dt: 1 / 60, mz: 1, mx: 0, standing: true, grounded: true, swimming: false, boost: 1 }, over);
      L.plan(f);
      out = L.speed;
    }
    return { speed: out, posture: L.posture, pick: L.pick?.id ?? '' };
  };
  const plain = plan({});
  const zero = plan({ duckToCrouch: 0, duckToCrawl: 0 });
  ok(Object.is(plain.speed, zero.speed) && plain.speed === LOCO_TUNE.speed.forward.jog, `nought shares: the jog's own ${plain.speed} m/s to the bit`);
  const half = plan({ duckToCrouch: 0.5 });
  ok(Math.abs(half.speed - (LOCO_TUNE.speed.forward.jog + LOCO_TUNE.crouch.forward.normal) / 2) < 1e-12 && half.pick === plain.pick, `half way down: half way from the jog's ${LOCO_TUNE.speed.forward.jog} to the crouch's ${LOCO_TUNE.crouch.forward.normal} m/s (${r2(half.speed)}), still the jog's clip`);
  const crouched = plan({ standing: false, crouched: true });
  const deep = plan({ standing: false, crouched: true, duckToCrawl: 1 });
  ok(crouched.speed === LOCO_TUNE.crouch.forward.normal && Math.abs(deep.speed - LOCO_TUNE.prone.forward.normal) < 1e-12 && deep.posture === crouched.posture && deep.pick === crouched.pick, `ducked to the crouch's height the crouch's clip and pace (${crouched.speed}); at the lying height the crawl's pace (${r2(deep.speed)}) on the crouch's clip`);
  const lying = plan({ standing: false, prone: true, duckToCrawl: 1 });
  ok(lying.speed === LOCO_TUNE.prone.forward.normal, "prone the crawl's own pace, the share never laid on it");
}

// ---- 4. walking and running under a roof lowering by steps, then a slab only a lying body passes ----------------------------
const STEPS = [1.4, 1.15, 1.0, 0.85] as const;
const STEP_LONG = 1.5;
const SLAB = 0.55;
const SLAB_AT = 3 + STEPS.length * STEP_LONG;
const SLAB_END = SLAB_AT + 3;
function lowering(p: Physics): void {
  ground(p, 0);
  let z = 3;
  for (const u of STEPS) {
    box(p, [-3, u, z], [3, u + 0.3, z + STEP_LONG], false);
    z += STEP_LONG;
  }
  box(p, [-3, SLAB, z], [3, SLAB + 0.3, z + 3], false);
}
async function bodyIn(build: (p: Physics) => void): Promise<TestBody> {
  const p = await makePhysics();
  build(p);
  p.stepOnce();
  const b = new TestBody(p);
  b.place(0, 0, 0);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  return b;
}
/** The roof over the feet at z: the underside of the step or the slab there, else none. */
function roofAt(z: number): number {
  if (z >= SLAB_AT && z < SLAB_END) return SLAB;
  const k = Math.floor((z - 3) / STEP_LONG);
  return k >= 0 && k < STEPS.length ? STEPS[k] : Infinity;
}
const laidAt: Record<string, number[]> = {};
for (const run of [true, false]) {
  for (const fps of RATES) {
    resetMoveTune();
    const b = await bodyIn(lowering);
    b.run(fps, 0.3);
    b.key('KeyW', true);
    if (!run) b.key('ShiftLeft', true);
    const v: number[][] = STEPS.map(() => []);
    const crouchUnder: boolean[][] = STEPS.map(() => []);
    const crawl: number[] = [];
    let worstTop = -Infinity;
    let laidZ = Number.NaN;
    let roseZ = Number.NaN;
    let lyingInto = -Infinity;
    const after: number[] = [];
    b.run(fps, 20, () => {
      const z = b.pos.z;
      const speed = Math.hypot(b.vel.x, b.vel.z);
      const roof = roofAt(z);
      if (b.shape.kind !== LYING) worstTop = Math.max(worstTop, b.pos.y + b.shape.tall - roof);
      else lyingInto = Math.max(lyingInto, b.pos.y + 2 * MOVE_TUNE.lyingRadius - roof);
      const k = Math.floor((z - 3) / STEP_LONG);
      // A step's steady stretch: past its first 0.9 m (the duck and the speed have eased) and before the next step. (The last,
      // 0.85 m, is passed lying: the slab past it is within `proneAhead` of its start.)
      if (k >= 0 && k < STEPS.length && z - (3 + k * STEP_LONG) > 0.9 && b.shape.kind !== LYING) {
        v[k].push(speed);
        crouchUnder[k].push(b.duck.crouch);
      }
      if (b.shape.kind === LYING && z > SLAB_AT + 0.5 && z < SLAB_END - 0.5) crawl.push(speed);
      if (b.duck.laid > 0 && !(laidZ === laidZ)) laidZ = z;
      if (b.duck.rose > 0 && !(roseZ === roseZ)) roseZ = z;
      if (z > SLAB_END + 2.5) after.push(speed);
      return z > SLAB_END + 4;
    });
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
    const sp = v.slice(0, 3).map(mean);
    const top = (run ? 1 : JKA.walkScale) * JKA.speed * UNIT;
    const how = `${run ? 'running' : 'walking'} @${fps}`;
    ok(sp.every((s, k) => s > 0 && (k === 0 ? s < top - 0.05 : s < sp[k - 1] + 1e-6)), `${how}: slower under each lower step (${sp.map(r2).join(', ')} m/s, standing ${r2(top)})`);
    ok(crouchUnder[2].length > 0 && crouchUnder[2].every((c) => c) && crouchUnder[0].length > 0 && crouchUnder[0].every((c) => !c), `${how}: walks under the 1.4 m step on the walk's clips and under the 1.0 m step on the crouch's`);
    ok(b.duck.laid === 1 && laidZ < SLAB_AT && laidZ > SLAB_AT - MOVE_TUNE.proneAhead - 1.2, `${how}: lies down once, before the ${SLAB} m slab (at z ${r2(laidZ)}, the slab from ${SLAB_AT})`);
    ok(crawl.length > 0 && Math.abs(mean(crawl) - (run ? LOCO_TUNE.prone.forward.normal : LOCO_TUNE.prone.forward.slow)) < 0.05, `${how}: crawls under it at the crawl's pace (${r2(mean(crawl))} m/s)`);
    ok(b.duck.rose === 1 && roseZ > SLAB_END && roseZ < SLAB_END + 1, `${how}: gets up once past it (z ${r2(roseZ)}, the slab to ${SLAB_END})`);
    ok(b.shape.kind !== LYING && b.shape.tall === STAND_TALL && !b.prone && after.length > 0 && Math.abs(after[after.length - 1] - top) < 0.05, `${how}: and stands again at its own pace (${r2(after[after.length - 1])} m/s)`);
    ok(worstTop <= 0.01 && lyingInto <= 0.01, `${how}: never presses its capsule into a roof (upright ${worstTop.toFixed(3)} m, lying ${lyingInto.toFixed(3)} m)`);
    (laidAt[run ? 'run' : 'walk'] ??= []).push(laidZ);
  }
}
for (const k of ['run', 'walk']) {
  const zs = laidAt[k];
  ok(Math.max(...zs) - Math.min(...zs) < 0.2, `${k}: it lies down at the same place at every rate (z ${zs.map(r2).join(', ')})`);
}

// ---- 5. under 'before' the feedback round's duck: stopped at the slab ------------------------------------------------------
for (const fps of RATES) {
  resetMoveTune();
  tuneMove({ duckPace: 'before' });
  const b = await bodyIn(lowering);
  b.run(fps, 0.3);
  b.key('KeyW', true);
  const sp: number[] = [];
  b.run(fps, 6, () => {
    if (b.pos.z > 3.9 && b.pos.z < 4.4) sp.push(Math.hypot(b.vel.x, b.vel.z));
    return false;
  });
  ok(b.duck.laid === 0 && !b.prone && b.pos.z < SLAB_AT && b.pos.z > SLAB_AT - 1 && !b.duck.active && sp.every((s) => Math.abs(s - JKA.speed * UNIT) < 0.05), `before @${fps}: the walk's own speed under the steps and stopped at the slab (z ${r2(b.pos.z)}), never lying down`);
}
resetMoveTune();

// ---- 6. no lying down where nothing is a roof: a wall, a step, stairs, a ramp, a hill --------------------------------------
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
const nots: [string, (p: Physics) => void][] = [
  ['a wall', (p) => { ground(p, 0); box(p, [-3, 0, 3], [3, 3, 3.5], false); }],
  ['a 0.3 m step up', (p) => { ground(p, 0); box(p, [-3, 0, 3], [3, 0.3, 8], false); }],
  ['stairs of 0.17 m risers', (p) => { ground(p, 0); for (let i = 0; i < 12; i++) box(p, [-2, 0, 2 + i * 0.3], [2, 0.17 * (i + 1), 2 + (i + 1) * 0.3], false); }],
  ['a 20-degree ramp', (p) => ramp(p, 20)],
  ['a 25-degree hill', (p) => heightChunk(p, -32, -32, (_x, z) => (z <= 2 ? 0 : (z - 2) * Math.tan((25 * Math.PI) / 180)))],
  ['a table 0.75 m high with a wall 0.4 m behind its edge', (p) => { ground(p, 0); box(p, [-3, 0.7, 3], [3, 0.75, 3.6], false); box(p, [-3, 0, 4], [3, 3, 4.5], false); }],
];
for (const [what, build] of nots) {
  for (const fps of [30, 240]) {
    resetMoveTune();
    const b = await bodyIn(build);
    b.run(fps, 0.3);
    b.key('KeyW', true);
    let crouched = false;
    b.run(fps, 4, () => {
      if (b.duck.crouch) crouched = true;
      return false;
    });
    ok(b.duck.laid === 0 && !b.prone && (what.startsWith('a table') || !crouched), `walking into ${what} @${fps}: never lies down${what.startsWith('a table') ? '' : ' nor crouches'} (${b.shape.roofSaid || 'nothing asked'})`);
  }
}

// ---- 7. the crouch key held into the slab lies down too, and gets up into the key's crouch ----------------------------------
for (const fps of [30, 240]) {
  resetMoveTune();
  const b = await bodyIn(lowering);
  b.run(fps, 0.3);
  b.key('KeyW', true);
  b.key('ControlLeft', true);
  b.run(fps, 30, () => b.pos.z > SLAB_END + 2);
  ok(b.duck.laid === 1 && b.duck.rose === 1 && !b.prone && b.shape.tall <= CROUCH_TALL + 1e-9 && b.pos.z > SLAB_END + 2, `crouched by the key @${fps}: lies down for the slab and gets up past it into the key's crouch (tall ${r2(b.shape.tall)})`);
}
resetMoveTune();

// ---- 7b. the round's review: a run straight into a slab lies down at one place at every rate, and never where Z is refused ----
// The roof probe reaches this frame's own travel past `proneAhead` and the path box looks as far as it does, so the lie-down is
// on the frame whose move reaches the probe's distance (it was up to two frames' travel later, 0.29 m apart between 30 and 240).
{
  const CRAWL_AT = 4;
  const crawlspace = (p: Physics) => {
    ground(p, 0);
    box(p, [-3, 0.6, CRAWL_AT], [3, 0.9, CRAWL_AT + 3], false);
  };
  const zs: number[] = [];
  let speed = 0;
  for (const fps of RATES) {
    resetMoveTune();
    const b = await bodyIn(crawlspace);
    b.run(fps, 0.3);
    b.key('KeyW', true);
    let laidZ = Number.NaN;
    b.run(fps, 4, () => {
      if (b.pos.z < 2) speed = Math.max(speed, Math.hypot(b.vel.x, b.vel.z));
      if (b.duck.laid > 0 && !(laidZ === laidZ)) laidZ = b.pos.z;
      return laidZ === laidZ;
    });
    b.key('KeyW', false);
    zs.push(laidZ);
  }
  ok(zs.every((z) => z < CRAWL_AT - 1.2) && Math.max(...zs) - Math.min(...zs) < speed / 30, `running into a 0.6 m slab: lies down within a frame's travel at 30 frames a second of the same place at every rate (z ${zs.map(r2).join(', ')}; the run ${r2(speed)} m/s, a frame at 30 ${r2(speed / 30)} m)`);
  // The dart in flight (the rope out): no lying down, as Z refuses ("Not with the grappling rope out."); stopped at the slab.
  for (const fps of [30, 144] as const) {
    resetMoveTune();
    const b = await bodyIn((p) => {
      crawlspace(p);
      box(p, [-6, 0, 60], [6, 30, 61]);
    });
    b.run(fps, 0.3);
    b.key('KeyW', true);
    const h = b.hand();
    const dx = 0 - h.x;
    const dy = 12 - h.y;
    const dz = 60 - h.z;
    const n = Math.hypot(dx, dy, dz);
    b.grapple.fire(0, 12, 60, h, b.vel, b.physics, b.filter, b.body, dx / n, dy / n, dz / n);
    let flying = false;
    b.run(fps, 0.3, () => {
      flying ||= b.grapple.out && !b.grapple.attached;
      return false;
    });
    b.run(fps, 2.5, () => false);
    b.key('KeyW', false);
    ok(flying && b.duck.laid === 0 && !b.prone && b.shape.kind !== LYING && b.pos.z < CRAWL_AT, `the rope out @${fps}: walked into the slab with the dart flying, never laid down (stopped at z ${r2(b.pos.z)}, the slab from ${CRAWL_AT})`);
  }
  // Water deeper than the body lies (0.45 m over the feet from z 1): no lying down, so the stand-up rule never fights it.
  for (const fps of [30, 144] as const) {
    resetMoveTune();
    const b = await bodyIn(crawlspace);
    b.surface = (_x: number, z: number) => (z > 1 ? 0.45 : Number.NEGATIVE_INFINITY);
    b.run(fps, 0.3);
    b.key('KeyW', true);
    b.run(fps, 5, () => false);
    b.key('KeyW', false);
    ok(b.duck.laid === 0 && !b.prone && b.pos.z < CRAWL_AT, `water 0.45 m deep under the slab @${fps}: never laid down (laid ${b.duck.laid}, stopped at z ${r2(b.pos.z)})`);
  }
}
resetMoveTune();

// ---- 8. what only the game hands over, as text -----------------------------------------------------------------------------
{
  const player = read('../../../src/player/player.ts');
  const harness = read('./grappleBody.ts');
  ok(player.includes('const was = { prone: this.prone, kneel: this.kneeling, crouch: this.crouching || this.duck.crouch };') && player.includes("const to = this.prone ? 'prone' : this.kneeling ? 'kneeling' : this.crouching || this.duck.crouch ? 'crouched' : 'standing';"), "the posture's one-shots read a crouch the duck wears as a crouch (none plays crouching on the move)");
  const rise = 'if (!this.prone) this.duck.lying = false;\n    else if (this.duck.lying && this.grounded && lieOn()) this.riseFromDuck(moving, move);';
  ok(player.includes(rise) && harness.includes(rise.replace(/\n {4}/, '\n      ')), 'a body the duck laid down gets up on its own, in the player and the harness alike, before the crouch is read');
  ok(player.includes('if (shapeRulesOn()) this.stepShape(dt, moving, move);\n    else this.setCrouchCollider((this.crouching || this.prone || this.kneeling) && this.grounded);\n    // Item 4: what the height the shape wrote means for the pace and the clips (a body it laid down crouches no more).\n    if (paceOn()) this.stepDuckPace();\n    else if (this.duck.active) this.duck.step(STAND_TALL, false, false);'), "the pace is stepped right after the shape wrote the capsule, and put down under 'before'");
  const lie = ') {\n        this.prone = true;\n        this.kneeling = false;\n        this.duck.lying = true;\n        this.duck.laid++;\n        S.holdLying(f, this.collider);\n      }';
  // (The round's review: never where Z would refuse it, with the rope out or in water deeper than the body lies.)
  ok(player.includes('if (S.lieAhead && !this.prone && !this.grapple.out && !this.grapple.released && !(this.waterDepth > 2 * MOVE_TUNE.lyingRadius)' + lie) && harness.includes('if (S.lieAhead && !this.prone && !this.grapple.out && !this.grapple.released && !(this.depth > 2 * MOVE_TUNE.lyingRadius)' + lie), "the shape's roof probe lays the body down where it wrote the upright capsule, in both, never with the rope out or in water deeper than it lies");
  ok(player.includes('    lo.duckToCrouch = this.duck.toCrouch;\n    lo.duckToCrawl = this.duck.toCrawl;') && player.includes('lo.crouched = this.crouching || this.duck.crouch;') && player.includes('lo.standing = !this.crouching && !this.duck.crouch && !this.prone && !this.kneeling;'), "the classes are handed the duck's shares and its crouch");
  ok(player.includes('c.crouch = this.crouching || this.duck.crouch;') && player.includes('if (!(classes && this.loco.moves && !script) && this.duck.active) c.speedScale *= this.duck.share;') && harness.includes('c.crouch = crouching || this.duck.crouch;') && harness.includes('if (!lies && this.duck.active) c.speedScale *= this.duck.share;'), "the movement crouches with it and, without the classes, takes its share (the harness as the player without the classes)");
  ok(player.includes('else if (this.crouching || this.duck.crouch) {') && player.includes('if (ducks && this.shape.share > 0 && !this.duck.crouch) {'), "the rig wears the crouch's state at its height, and the duck's blended layer only above it");
  ok(player.includes('// Climbing II\'s smoothness round, item 4: nothing of the duck\'s pace carried to the new place.\n    this.duck.reset();'), 'stood somewhere new, nothing of the pace is carried');
  ok(BODY_CAPSULE.r === 0.35, 'the capsule the probe sizes its balls by');
}

console.log(`duckPace: ${checks} checks passed`);
