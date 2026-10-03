// A machine on its springs, driven for real (src/vehicles/vehicle.ts, HOVER_TUNE).
//
// Two faults the owner met, both in the one function that steps a vehicle on its springs, and both
// proven here with the game's own Vehicle class over a Rapier heightfield, driven the way the game
// drives it: the throttle held and the mouse's heading swinging to a new bearing every few seconds.
//
// The first: a speeder rolled over on the ground. The springs pushed at the four corners of the
// underside while the mass sits at the middle of the box, so once a hull leaned past the angle whose
// tangent is the corner's reach over half the height (32 degrees on a speeder bike) all four corners
// stood on one side of the mass and every spring rolled it further over. The owner's rule is that a
// speeder may go over in the air and never on the ground; the test holds the class to exactly that.
// Every time a hull ends up on its back, it must have left the ground on the way over.
//
// The second: letting go of a pod's boost blew the pod up. The top speed snapped from the boost's to
// the plain one in a single step, and the next step's hit test read the 40 m/s it took off as a crash.
//
// Each fault is shown first under the old rules (HOVER_TUNE's switches put them back), so the test is
// known to reproduce what the owner saw, and then shown gone under the new ones. Nothing here is game
// data: boxes of the game's own vehicle sizes, sine hills, round numbers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Group, Physics, RAPIER, groups } from '../../../src/core/physics.ts';
import { HOVER_TUNE, Vehicle, specFor, type DriveInput, type VehicleKind } from '../../../src/vehicles/vehicle.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const NEW = { ...HOVER_TUNE };
const OLD = { springsAt: 'corner' as const, tipLimit: 0, rightByAngle: false, easeCap: false };
const rules = (r: Partial<typeof HOVER_TUNE>) => Object.assign(HOVER_TUNE, NEW, r);

// --- 1: the class loads under node's type stripping at all ---------------------------------------
{
  const text = src('../../../src/vehicles/vehicle.ts');
  ok(!/constructor\([^)]*\b(readonly|private|public|protected)\s/.test(text), '1: the Vehicle constructor has no parameter property, which type stripping refuses');
  const relative = [...text.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'(\.{1,2}\/[^']*)'/gm)].map((m) => m[1]);
  ok(relative.length >= 6 && relative.every((p) => p.endsWith('.ts')), `1: and every relative value import it makes carries its extension (${relative.length})`);
  ok(/from '\.\/cells\.ts'/.test(text) && !/from '\.\/interior/.test(text), "1: it asks a mesh's cell of cells.ts, not of the rooms, whose loaders node cannot run");
  ok(typeof Vehicle === 'function' && typeof specFor === 'function', '1: so the game\'s own class is what is driven below');
}

// --- the ground ----------------------------------------------------------------------------------
const SIZE = 512;
const SUB = 256;
const STEP = SIZE / SUB;

interface Ground {
  heights: Float32Array;
  at: (x: number, z: number) => number;
}

/** Rolling sine hills `amp` metres high, as a heightfield and as the bilinear height the game reads. */
function hills(amp: number): Ground {
  const f = (x: number, z: number) => amp * Math.sin(x / 23) * Math.cos(z / 31) + amp * 0.5 * Math.sin(x / 9 + z / 13);
  const heights = new Float32Array((SUB + 1) * (SUB + 1));
  for (let xi = 0; xi <= SUB; xi++) for (let zi = 0; zi <= SUB; zi++) heights[xi * (SUB + 1) + zi] = f(-SIZE / 2 + xi * STEP, -SIZE / 2 + zi * STEP);
  const at = (x: number, z: number) => {
    const fx = (x + SIZE / 2) / STEP;
    const fz = (z + SIZE / 2) / STEP;
    const xi = Math.max(0, Math.min(SUB - 1, Math.floor(fx)));
    const zi = Math.max(0, Math.min(SUB - 1, Math.floor(fz)));
    const tx = fx - xi;
    const tz = fz - zi;
    const h = (a: number, b: number) => heights[a * (SUB + 1) + b];
    return (h(xi, zi) * (1 - tx) + h(xi + 1, zi) * tx) * (1 - tz) + (h(xi, zi + 1) * (1 - tx) + h(xi + 1, zi + 1) * tx) * tz;
  };
  return { heights, at };
}

const FLAT = hills(0);

/** A fixed stream of numbers from a seed, so every run drives the same course. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

interface Hull {
  kind: VehicleKind;
  /** Width, height and length of the box, in metres. */
  w: number;
  h: number;
  l: number;
  label: string;
}

/** The game's own sizes: the speeder bike's bounds, the old placeholder box, a STAP's narrow tall frame, a landspeeder and a pod. */
const BIKE: Hull = { kind: 'speederbike', w: 0.91, h: 1.16, l: 4.13, label: 'speeder bike' };
const BOX: Hull = { kind: 'speederbike', w: 1.1, h: 1.0, l: 2.8, label: 'box speeder' };
const STAP: Hull = { kind: 'speederbike', w: 0.6, h: 1.6, l: 2.0, label: 'STAP-shaped' };
const CAR: Hull = { kind: 'flyer', w: 2.0, h: 1.2, l: 4.5, label: 'landspeeder' };
const POD: Hull = { kind: 'podracer', w: 5, h: 2.5, l: 16, label: 'pod' };

async function world(g: Ground, rocks = 0): Promise<Physics> {
  const physics = await Physics.create();
  physics.createHeightfield(-SIZE / 2, -SIZE / 2, SIZE, SUB, g.heights);
  // Rocks, as the world's still things are: in the exterior group, which a hull meets.
  const r = seeded(7);
  for (let i = 0; i < rocks; i++) {
    const x = (r() - 0.5) * 300;
    const z = (r() - 0.5) * 300;
    const s = 0.3 + r() * 1.2;
    const turn = r();
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(s, s * 0.6, s)
        .setTranslation(x, g.at(x, z) + s * 0.2, z)
        .setRotation({ x: 0, y: Math.sin(turn), z: 0, w: Math.cos(turn) })
        .setCollisionGroups(groups(Group.exterior, Group.all)),
    );
  }
  return physics;
}

function spawn(physics: Physics, g: Ground, hull: Hull, mesh: boolean, x = 0, z = 0, heading = 0): { v: Vehicle; scene: THREE.Scene } {
  const spec = specFor(hull.kind, 'test', hull.label, { min: [-hull.w / 2, 0, -hull.l / 2], max: [hull.w / 2, hull.h, hull.l / 2] });
  // A model of one box: the hull's collision is then its own triangles, as a garage model's is.
  const model = new THREE.Group();
  if (mesh) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(hull.w, hull.h, hull.l));
    m.position.y = hull.h / 2;
    model.add(m);
  }
  const scene = new THREE.Scene();
  const v = new Vehicle(spec, model, physics, scene, x, g.at(x, z) + spec.hover + 0.2, z, heading);
  physics.stepOnce();
  return { v, scene };
}

const up = new THREE.Vector3();
const turn = new THREE.Quaternion();
/** Degrees the hull's up stands from the world's. */
function tilt(v: Vehicle): number {
  v.quaternion(turn);
  up.set(0, 1, 0).applyQuaternion(turn);
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(up.y, -1, 1)));
}

interface Drive {
  hull: Hull;
  amp: number;
  fps: number;
  seconds?: number;
  rocks?: number;
  hopEvery?: number;
  mesh?: boolean;
}

interface Driven {
  /** Times the hull went on its back without leaving the ground on the way over: the owner's fault. */
  groundFlips: number;
  /** Times it went over having left the ground on the way: allowed. */
  airFlips: number;
  /** The most it leaned from upright while on its springs and the right way up (degrees). */
  maxTilt: number;
  /** Seconds it was alive (a hull at no health is gone from the game, so the run stops there). */
  alive: number;
  hits: number;
}

/**
 * Drive a hull over the hills the way the game does: the throttle held, the mouse's heading swung to a
 * new bearing every three seconds by up to three radians, a hop now and then. A hull that goes over is
 * turned back as E on it does, and the run goes on.
 */
async function drive(d: Drive): Promise<Driven> {
  const g = hills(d.amp);
  const physics = await world(g, d.rocks ?? 0);
  const { v, scene } = spawn(physics, g, d.hull, d.mesh ?? false);
  const rand = seeded(1);
  const dt = 1 / d.fps;
  const seconds = d.seconds ?? 40;
  const input: DriveInput = { throttle: 1, steer: 0, heading: 0, boost: false, hop: false, up: false, down: false, vertical: 0 };
  const out: Driven = { groundFlips: 0, airFlips: 0, maxTilt: 0, alive: 0, hits: 0 };
  let target = 0;
  // Whether the hull has left the ground since it last stood upright, and whether it was on its back a step ago.
  let airborneSinceUpright = false;
  let wasOver = false;
  let t = 0;
  for (; t < seconds && !v.destroyed; t += dt) {
    if (Math.floor((t + dt) / 3) !== Math.floor(t / 3)) target = v.heading + (rand() * 2 - 1) * 3;
    input.heading = target;
    input.hop = !!d.hopEvery && Math.floor((t + dt) / d.hopEvery) !== Math.floor(t / d.hopEvery);
    v.update(dt, physics, input, g.at);
    physics.step(dt);
    if (v.justHit > 0) out.hits++;
    const a = tilt(v);
    if (a < 45) airborneSinceUpright = false;
    if (v.groundedPoints < 2) airborneSinceUpright = true;
    else if (!v.upsideDown) out.maxTilt = Math.max(out.maxTilt, a);
    if (v.upsideDown && !wasOver) {
      if (airborneSinceUpright) out.airFlips++;
      else out.groundFlips++;
    }
    wasOver = v.upsideDown;
    if (v.flipped) {
      v.rightSelf();
      wasOver = false;
      airborneSinceUpright = false;
    }
  }
  out.alive = t;
  v.dispose(physics, scene);
  physics.world.free();
  return out;
}

// --- 2: a speeder rolled over on the ground, and does not now -----------------------------------
let oldBikeFlips = 0;
{
  rules(OLD);
  const old = await drive({ hull: BIKE, amp: 8, fps: 60 });
  oldBikeFlips = old.groundFlips;
  ok(old.groundFlips >= 5, `2: under the old rules the speeder bike rolls over on the ground on rolling hills (${old.groundFlips} times in 40 s, never leaving it on the way over), which is what the owner saw`);
  const oldBox = await drive({ hull: BOX, amp: 8, fps: 60 });
  const oldStap = await drive({ hull: STAP, amp: 4, fps: 60 });
  ok(oldBox.groundFlips + oldStap.groundFlips > 0, `2: and so does a box speeder or a STAP's narrow frame (${oldBox.groundFlips} and ${oldStap.groundFlips})`);

  rules({});
  let runs = 0;
  let groundFlips = 0;
  let airFlips = 0;
  let worstTilt = 0;
  let worstRun = '';
  for (const hull of [BIKE, BOX, STAP, CAR]) {
    for (const fps of [144, 60, 30, 20]) {
      for (const course of [{ amp: 8 }, { amp: 4, hopEvery: 2.3 }, { amp: 8, mesh: true }]) {
        const r = await drive({ hull, fps, ...course });
        runs++;
        groundFlips += r.groundFlips;
        airFlips += r.airFlips;
        if (r.maxTilt > worstTilt) {
          worstTilt = r.maxTilt;
          worstRun = `${hull.label} at ${fps} fps on ${JSON.stringify(course)}`;
        }
      }
    }
  }
  ok(groundFlips === 0, `2: under the new rules not one of ${runs} drives (four hulls, 144 to 20 fps, hills, hops, mesh hulls) rolls over on the ground`);
  ok(worstTilt < HOVER_TUNE.tipLimit + 15, `2: and on the ground the hull only follows the ground, the most it leaned from upright being ${worstTilt.toFixed(1)} degrees (${worstRun})`);
  console.log(`note ${airFlips} went over in the air, which the rule allows`);

  // Driven into rocks, which a hull meets, until it is wrecked (a hull at no health is gone from the game).
  let rockGround = 0;
  let rockRuns = 0;
  for (const hull of [BIKE, BOX]) {
    for (const fps of [60, 30]) {
      for (const course of [{ amp: 8, rocks: 400 }, { amp: 8, rocks: 400, hopEvery: 2.3, mesh: true }, { amp: 4, rocks: 600, mesh: true }]) {
        const r = await drive({ hull, fps, ...course });
        rockRuns++;
        rockGround += r.groundFlips;
      }
    }
  }
  ok(rockGround === 0, `2: nor do ${rockRuns} drives among rocks, for as long as each hull lasts`);

  // The pod, on gentler ground (at 85 m/s on the steep hills it is in the air most of the time).
  const pod = await drive({ hull: POD, amp: 3, fps: 60 });
  ok(pod.groundFlips === 0, `2: nor a pod, whose banked yaw used to tip it (${pod.airFlips} in the air)`);
}

// --- 3: which part of the fix does it ----------------------------------------------------------
{
  // The springs alone (no guard) are the cause and the cure; the guard alone does not hold a hull whose springs roll it.
  rules({ tipLimit: 0, rightByAngle: false });
  const springs = await drive({ hull: BIKE, amp: 8, fps: 60 });
  ok(springs.groundFlips === 0, '3: the springs pushing at the height of the mass alone keep the bike on its feet (no guard)');
  rules({ springsAt: 'corner' });
  const guard = await drive({ hull: BIKE, amp: 8, fps: 60 });
  // The guard takes away turning the hull already has; springs under the corners add more within the step.
  console.log(`note the guard alone, with the springs left under the corners, lets the bike over ${guard.groundFlips} time(s) where the old rules let it over ${oldBikeFlips}: the springs are the cure, the guard the belt`);
  rules({});
}

/** A hull stood on flat ground, posed by hand: rolled `roll` radians about its nose, at height `y`, turning at `spin`. */
async function posed(hull: Hull, y: number, roll: number, spin = { x: 0, y: 0, z: 0 }): Promise<{ v: Vehicle; physics: Physics; scene: THREE.Scene }> {
  const physics = await world(FLAT);
  const { v, scene } = spawn(physics, FLAT, hull, false);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll);
  v.body.setTranslation({ x: 0, y, z: 0 }, true);
  v.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
  v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  v.body.setAngvel(spin, true);
  return { v, physics, scene };
}

// --- 4: the guard, one step ----------------------------------------------------------------------
{
  // Leaned 48 degrees on flat ground, all four springs on it, rolling further over at 10 rad/s.
  for (const limit of [50, 0]) {
    rules({ tipLimit: limit });
    const { v, physics, scene } = await posed(BIKE, 0.92, THREE.MathUtils.degToRad(48), { x: 0, y: 0, z: 10 });
    const dt = 1 / 60;
    v.update(dt, physics, null, FLAT.at);
    const a = v.body.angvel();
    if (limit) {
      ok(v.groundedPoints === 4 && Math.abs(THREE.MathUtils.radToDeg(v.lean) - 48) < 0.5, '4: a bike leaned 48 degrees on flat ground stands on all four springs');
      const room = THREE.MathUtils.degToRad(limit - 48) / dt;
      ok(Math.abs(a.z - room) < 1e-3, `4: and the 10 rad/s carrying it over is cut to the ${room.toFixed(2)} rad/s that takes it exactly to the ${limit} degree limit in the step`);
    } else ok(Math.abs(a.z - 10) < 1e-6, '4: with the limit at 0 the guard is off and the turning is left as it was');
    v.dispose(physics, scene);
    physics.world.free();
  }
  rules({});
}

// --- 5: the air is the old rule's, and a hull on its back still throws its rider -----------------
{
  // In the air nothing the fix touches runs: no spring reaches the ground and the guard is the ground's.
  const at: number[][] = [];
  for (const r of [OLD, {}]) {
    rules(r);
    const { v, physics, scene } = await posed(BIKE, 60, 0.3, { x: 3, y: 1, z: 2 });
    const input: DriveInput = { throttle: 1, steer: 0.5, heading: null, boost: false, hop: false, up: false, down: false };
    for (let i = 0; i < 40; i++) {
      v.update(1 / 60, physics, input, FLAT.at);
      physics.step(1 / 60);
    }
    const q = v.body.rotation();
    at.push([q.x, q.y, q.z, q.w, v.pos.y, v.groundedPoints]);
    v.dispose(physics, scene);
    physics.world.free();
  }
  ok(at[1][5] === 0 && at[0].every((n, i) => n === at[1][i]), '5: a hull tumbling in the air turns exactly as it did under the old rules, to the last bit');

  rules({});
  for (const [label, roll, y] of [['dropped on its back from 2 m', 175, 2], ['set down on its back', 180, 0.9]] as const) {
    const { v, physics, scene } = await posed(BIKE, y, THREE.MathUtils.degToRad(roll));
    let flippedAt = -1;
    for (let t = 0; t < 3; t += 1 / 60) {
      v.update(1 / 60, physics, null, FLAT.at);
      physics.step(1 / 60);
      if (v.flipped && flippedAt < 0) flippedAt = t;
    }
    ok(flippedAt >= 0.5 && v.flipped && tilt(v) > 150, `5: a bike ${label} is left on its back, and after ${flippedAt.toFixed(2)} s says so, which is what throws its rider`);
    v.dispose(physics, scene);
    physics.world.free();
  }
  {
    const { v, physics, scene } = await posed(BIKE, 2, THREE.MathUtils.degToRad(95));
    let ever = false;
    for (let t = 0; t < 4; t += 1 / 60) {
      v.update(1 / 60, physics, null, FLAT.at);
      physics.step(1 / 60);
      ever ||= v.flipped;
    }
    ok(!ever && tilt(v) < 5, '5: and one that comes down on its side, still the right way up, is stood back up');
    v.dispose(physics, scene);
    physics.world.free();
  }
  const text = src('../../../src/vehicles/vehicle.ts');
  ok(/this\.flipped = this\.overFor > 0\.6;/.test(text), '5: the 0.6 s on its back before the rider is thrown is kept');
  ok(/v === rider && v\.flipped && !v\.invulnerable[\s\S]{0,120}this\.dismountBeside\(v\)/.test(src('../../../src/main.ts')), '5: and the game still throws the rider of a hull that says so');
}

// --- 6: letting go of a pod's boost ---------------------------------------------------------------
interface Boosted {
  top: number;
  hp: number;
  hits: number;
  /** Seconds from letting go until the speed is back within a step's push of the plain top speed. */
  back: number;
  /** The most the speed fell in one step after letting go (m/s). */
  worstFall: number;
  /** The cap the hull was held to at `probe` seconds, and whether its engine was burnt out then. */
  capThen: number;
  limpThen: boolean;
}

async function boost(hull: Hull, fps: number, plan: (t: number) => { boost: boolean; throttle: number }, probe = 19, brake?: number): Promise<Boosted> {
  const physics = await world(FLAT);
  const { v, scene } = spawn(physics, FLAT, hull, false, 0, -200);
  if (brake !== undefined) v.spec.brake = brake;
  const dt = 1 / fps;
  const input: DriveInput = { throttle: 1, steer: 0, heading: null, boost: false, hop: false, up: false, down: false, vertical: 0 };
  const out: Boosted = { top: 0, hp: 0, hits: 0, back: Infinity, worstFall: 0, capThen: NaN, limpThen: false };
  let letGo = -1;
  let last = 0;
  for (let t = 0; t < 20; t += dt) {
    const p = plan(t);
    input.boost = p.boost;
    input.throttle = p.throttle;
    v.update(dt, physics, input, FLAT.at);
    physics.step(dt);
    const speed = Math.hypot(v.body.linvel().x, v.body.linvel().z);
    if (letGo < 0 && v.boosting === false && out.top > v.spec.maxSpeed + 5) letGo = t;
    if (letGo >= 0) out.worstFall = Math.max(out.worstFall, last - speed);
    const plain = v.spec.maxSpeed * (v.overheated > 0 ? 0.6 : 1);
    if (letGo >= 0 && !Number.isFinite(out.back) && speed <= plain + v.spec.accel * dt + 0.5) out.back = t - letGo;
    out.top = Math.max(out.top, speed);
    if (v.justHit > 0) out.hits++;
    if (Number.isNaN(out.capThen) && t >= probe) {
      out.capThen = v.speedCap;
      out.limpThen = v.overheated > 0;
    }
    last = speed;
  }
  out.hp = v.hp;
  v.dispose(physics, scene);
  physics.world.free();
  return out;
}

const letGoAt13 = (t: number) => ({ boost: t > 10 && t < 13, throttle: 1 });
const coastAt13 = (t: number) => ({ boost: t > 10 && t < 13, throttle: t < 13 ? 1 : 0 });
const heldOn = (t: number) => ({ boost: t > 10, throttle: 1 });
{
  rules(OLD);
  const old = await boost(POD, 60, letGoAt13);
  ok(old.top > 120 && old.hp <= 0, `6: under the old rules a pod let off its boost at ${old.top.toFixed(1)} m/s is destroyed by its own speed cap, which is what the owner saw`);
  ok(old.worstFall > 35, `6: the cap took ${old.worstFall.toFixed(1)} m/s off it in one step, which the hit test read as a crash`);
  const oldHeat = await boost(POD, 60, heldOn);
  ok(oldHeat.hp <= 0, '6: and so is one whose boost is held until the engine burns out');

  rules({});
  for (const fps of [60, 30, 20]) {
    const r = await boost(POD, fps, letGoAt13);
    ok(r.hp === 100 && r.hits === 0, `6: a pod let off its boost at ${r.top.toFixed(1)} m/s at ${fps} fps keeps its whole hull and takes no hit`);
    ok(r.back > 0.5 && r.back < 1.5, `6: its speed comes down to the plain top speed over about a second (${r.back.toFixed(2)} s), never by more than ${r.worstFall.toFixed(2)} m/s in a step`);
  }
  for (const fps of [60, 20]) {
    const r = await boost(POD, fps, coastAt13);
    ok(r.hp === 100 && r.hits === 0, `6: let off the boost and the throttle together at ${fps} fps, the coast's own drag is not added to the cap's, and no hit is read (${r.worstFall.toFixed(2)} m/s a step at worst)`);
  }
  // Held from 10 s, the heat tops out at 14 s and the engine limps for three seconds: looked at 16.5 s in.
  const heat = await boost(POD, 60, (t) => ({ boost: t > 10 && t < 14.5, throttle: 1 }), 16.5);
  ok(heat.hp === 100 && heat.hits === 0, '6: a boost held until the engine burns out comes down to the limp without a hit');
  ok(heat.limpThen && Math.abs(heat.capThen - podLimp()) < 1e-6, `6: and is held to the limping top speed once it gets there (${heat.capThen.toFixed(1)} m/s)`);

  const plain = await boost(POD, 60, () => ({ boost: false, throttle: 1 }));
  ok(plain.top <= 85 + 30 / 60 + 0.05 && plain.top > 84, `6: a pod that never boosts is still held to its top speed of 85 m/s (${plain.top.toFixed(2)} at most, a step's push over)`);
  const boosted = await boost(POD, 60, (t) => ({ boost: t > 10, throttle: 1 }));
  ok(boosted.top > 124 && boosted.top <= 125 + (30 * 1.7) / 60 + 0.05, `6: and a boost still opens the boost's top speed at once (${boosted.top.toFixed(2)})`);
  const bike = await boost(BIKE, 60, letGoAt13);
  ok(bike.hp === 100 && bike.hits === 0, "6: a speeder bike's short burst lets go as cleanly as ever");
  // The cap's own cut is never measured as a hit. No hull the game has brakes hard enough to show it
  // inside the frame clamp (a pod's 45 m/s² is 2.25 m/s in a twentieth of a second, under the hit
  // test's 6), so this asks it of a made-up hull that does: 200 m/s² is 10 m/s a step at 20 fps, a
  // hit every step it is let down by unless the cut is taken out of what the next step measures from.
  const hard = await boost(POD, 20, letGoAt13, 19, 200);
  ok(hard.hp === 100 && hard.hits === 0 && hard.worstFall > 6, `6: a hull braking past the hit test's allowance in a step (${hard.worstFall.toFixed(1)} m/s) is let down off its boost with no hit read`);
}

/** A burnt-out pod's top speed: the plain one at the limp's 0.6. */
function podLimp(): number {
  return specFor('podracer', 'p', 'p', { min: [-2.5, 0, -8], max: [2.5, 2.5, 8] }).maxSpeed * 0.6;
}

// --- 7: the knob ----------------------------------------------------------------------------------
{
  const main = src('../../../src/main.ts');
  ok(/hover: \(patch: Partial<typeof HOVER_TUNE> = \{\}\)/.test(main), '7: __debug.hover moves HOVER_TUNE live');
  ok(/HOVER_TUNE\.tipLimit = THREE\.MathUtils\.clamp\(patch\.tipLimit, 0, 180\)/.test(main), '7: and keeps the limit to a real angle');
  ok(/`hover\(\)`/.test(src('../../../README.md')), "7: and has its row in the README's Debugging table");
  ok(NEW.springsAt === 'mass' && NEW.tipLimit === 50 && NEW.rightByAngle && NEW.easeCap, '7: the new rules are what the game starts with');
}
rules({});

console.log(`\n${checks} checks passed`);
