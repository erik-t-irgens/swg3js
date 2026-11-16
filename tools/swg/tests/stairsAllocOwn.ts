// The stairs wave's own frame: the classes with one step a stair (`BodyLoco.plan` and `legs`, handed measured stairs and a
// rig with the cycles' facts), the sampler measuring the stairs (`StairSense.step`), and the feet with the hips steady, the
// stride, the clearance and the hold (`FootIk.step`, handed the stairs by `stairFeetOf`), over a skeleton the game draws on
// the real Rapier: standing still on flat ground, walking up a staircase, and walking up a 20 degree slope. What it makes
// is measured with no collection between and what it asks of the engine counted: the engine's own answers are its cost, so
// the frame is held to asking as seldom as it says and making nothing else. Run twelve at once by `stairsAlloc.test.ts`;
// prints one line of JSON.
//
// The frame is a function of its own reading kept fields, called from a loop kept out of the optimizer (wave 2a's lesson).
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import * as THREE from 'three';
import { Physics, RAPIER, TRIMESH_FLAGS, cleanTrimesh, Group, groups } from '../../../src/core/physics.ts';
import { FootIk, stairFeetOf } from '../../../src/player/footIk.ts';
import { StairSense } from '../../../src/player/stairSense.ts';
import { BodyLoco, newLocoIn, type LocoRig } from '../../../src/anim/bodyLoco.ts';
import { LOCO_TUNE } from '../../../src/anim/locoTune.ts';
import type { StairCycleFacts } from '../../../src/anim/stairCycle.ts';
import { glbSkeleton, repoRoot, speciesBodies, targetSkeleton } from './animFixtures.ts';

let scavenges = 0;
new PerformanceObserver((l) => {
  scavenges += l.getEntries().length;
}).observe({ entryTypes: ['gc'] });
const turn = () => new Promise<void>((r) => setImmediate(r));
const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;

const root = repoRoot(import.meta.url);
const body = speciesBodies(root).find((b) => b.id === 'human_male');
const target = body ? glbSkeleton(body.body) : targetSkeleton();

function figure(): { root: THREE.Group; rig: { root: THREE.Group; boneNamed(n: string): THREE.Bone | null; restSkeleton(): typeof target; legPose: { restore(): void } | null } } {
  const r = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.fromArray(target.base.p);
  inner.quaternion.fromArray(target.base.q);
  r.add(inner);
  const bones = new Map<string, THREE.Bone>();
  const made: THREE.Bone[] = [];
  target.joints.forEach((j) => {
    const b = new THREE.Bone();
    b.name = j.name;
    b.position.fromArray(j.restP);
    b.quaternion.fromArray(j.restQ);
    made.push(b);
    bones.set(j.name, b);
    (j.parent < 0 ? inner : made[j.parent]).add(b);
  });
  return { root: r, rig: { root: r, boneNamed: (n) => bones.get(n) ?? null, restSkeleton: () => target, legPose: null } };
}
function box(p: Physics, min: number[], max: number[]): void {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const c = cleanTrimesh(new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]), new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]))!;
  const d = RAPIER.ColliderDesc.trimesh(c.vertices, c.indices, TRIMESH_FLAGS);
  d.setCollisionGroups(groups(Group.exterior, Group.all));
  p.world.createCollider(d);
}

const p = await Physics.create();
p.world.createCollider(RAPIER.ColliderDesc.cuboid(200, 1, 200).setTranslation(0, -1, 0)).setCollisionGroups(groups(Group.terrain, Group.all));
// A staircase of 0.28/0.17 along +x from 2 m, and a 20 degree ramp along +z from 2 m (its own lane).
for (let i = 0; i < 12; i++) box(p, [2 + i * 0.28, 0, -2], [2 + (i + 1) * 0.28, (i + 1) * 0.17, 2]);
box(p, [2 + 12 * 0.28, 0, -2], [9, 12 * 0.17, 2]);
{
  const k = Math.tan((20 * Math.PI) / 180);
  const c = cleanTrimesh(new Float32Array([-2, 0, 8, 2, 0, 8, -2, 8 * k, 16, 2, 8 * k, 16, -2, 0, 16, 2, 0, 16]), new Uint32Array([0, 2, 1, 1, 2, 3, 0, 4, 2, 1, 3, 5]))!;
  const d = RAPIER.ColliderDesc.trimesh(c.vertices, c.indices, TRIMESH_FLAGS);
  d.setCollisionGroups(groups(Group.exterior, Group.all));
  p.world.createCollider(d);
}
p.stepOnce();
const ALL = groups(Group.all, Group.all);

const facts = { name: 'mx_ascending_stairs~trimmed', len: 1.367, steps: 2, at: new Float64Array([0.2, 0.933]), side: new Int8Array([0, 1]), off: new Float64Array([0.219, 0.208]), mid: new Float64Array([0.087, 0.087]), run: false, fwd: 0.246, rise: 0.237, seam: 0, seamVel: 1 } as unknown as StairCycleFacts;
const rig: LocoRig = { has: () => true, speedOut: 0, readSpeed() { return false; }, stairFacts: () => facts } as LocoRig;

/** The frame's state: the path walked (x, y, z), which frame, the records. Fields, so nothing crosses a call. */
class Walk {
  xs = new Float64Array(1);
  ys = new Float64Array(1);
  zs = new Float64Array(1);
  i = 0;
  n = 1;
  feet = new FootIk(LOCO_TUNE.ik, () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
  stairs = new StairSense();
  loco = new BodyLoco(LOCO_TUNE);
  lo = newLocoIn();
  fig = figure();
  vx = 0.5;
  vz = 0.5;
  heading = 0.5;
  time = 0.5;
}
const st = new Walk();
function frame(): void {
  const i = st.i;
  const dt = 1 / 60;
  const lo = st.lo;
  const s = st.stairs;
  // The classes: last frame's stairs, the plan, the move, the stairs again, the distance and the clip's time, the legs.
  st.loco.keys(dt, false, false, true, rig);
  lo.dt = dt;
  lo.mz = st.vx > 0 || st.vz > 0 ? 1 : 0;
  lo.mx = 0;
  lo.grounded = true;
  lo.standing = true;
  lo.stairs = s.way;
  lo.stairKnown = s.known;
  lo.stairTread = s.tread;
  lo.stairRiser = s.riser;
  lo.stairNext = s.next;
  st.loco.plan(lo);
  const a = s.at;
  a.x = st.xs[i];
  a.y = st.ys[i];
  a.z = st.zs[i];
  a.vx = st.vx;
  a.vz = st.vz;
  a.dt = dt;
  a.filter = ALL;
  a.reads = st.vx > 0 || st.vz > 0;
  a.measure = true;
  s.step(p.world, LOCO_TUNE.stairs);
  lo.stairKnown = s.known;
  lo.stairTread = s.tread;
  lo.stairRiser = s.riser;
  lo.stairNext = s.next;
  lo.stairMoved = st.vx / 60;
  lo.legTime = st.time;
  lo.ground = st.vx + st.vz;
  st.loco.legs(rig, lo, false);
  st.time += dt * st.loco.rate;
  if (st.time > 1.367) st.time -= 1.367;
  // The figure placed, and the feet with the hips steady, the stride, the clearance and the hold.
  st.fig.rig.legPose?.restore();
  const r = st.fig.root;
  r.position.x = st.xs[i];
  r.position.y = st.ys[i];
  r.position.z = st.zs[i];
  r.rotation.y = st.heading;
  r.updateMatrixWorld(true);
  const fi = st.feet.in;
  fi.dt = dt;
  fi.on = true;
  fi.stairClip = s.way !== 0;
  fi.px = st.xs[i];
  fi.py = st.ys[i];
  fi.pz = st.zs[i];
  fi.heading = st.heading;
  fi.filter = ALL;
  const stepping = st.loco.stepFacts !== null;
  fi.stride = stepping ? st.loco.step.stride : 1;
  fi.clear = stepping ? LOCO_TUNE.stairs.clear : 0;
  fi.pin = stepping && LOCO_TUNE.stairs.pin === 'sole';
  stairFeetOf(s, fi);
  st.feet.step(st.fig.rig as never, p.world, null);
  st.i = i + 1 === st.n ? 0 : i + 1;
}
function run(n: number): void {
  for (let k = 0; k < n; k++) frame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(run)');

const WINDOW = 60000;
async function measure(xs: Float64Array, ys: Float64Array, zs: Float64Array, vx: number, vz: number, heading: number, window = WINDOW): Promise<{ bytes: number; casts: number; frames: number; clean: boolean; stepped: boolean }> {
  st.xs = xs;
  st.ys = ys;
  st.zs = zs;
  st.n = xs.length;
  st.i = 0;
  st.vx = vx;
  st.vz = vz;
  st.heading = heading;
  st.time = 0;
  st.feet = new FootIk(LOCO_TUNE.ik, () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
  st.stairs = new StairSense();
  st.loco = new BodyLoco(LOCO_TUNE);
  st.lo = newLocoIn();
  st.lo.scale = 1;
  st.lo.sprint = LOCO_TUNE.speed.forward.sprint;
  st.lo.pool = 100;
  st.fig = figure();
  run(Math.ceil(30000 / st.n) * st.n);
  let stepped = false;
  const passes = Math.ceil(window / st.n);
  let best = { bytes: Number.POSITIVE_INFINITY, casts: 0, frames: st.n * passes, clean: false, stepped: false };
  for (let tries = 0; tries < 4; tries++) {
    st.i = 0;
    run(st.n);
    stepped = stepped || st.loco.stepFacts !== null;
    globalThis.gc!({ type: 'minor' } as never);
    await turn();
    await turn();
    const s0 = scavenges;
    const c0 = st.feet.casts + st.stairs.casts;
    const y0 = young();
    run(st.n * passes);
    const y1 = young();
    await turn();
    await turn();
    if (scavenges === s0 && y1 - y0 < best.bytes) best = { bytes: y1 - y0, casts: st.feet.casts + st.stairs.casts - c0, frames: st.n * passes, clean: true, stepped };
  }
  return best;
}
// Standing still on flat ground; walking 0.5 m/s along +x up the staircase and its landing; walking 0.5 m/s up the ramp.
const stand = await measure(new Float64Array(300).fill(-3), new Float64Array(300), new Float64Array(300), 0, 0, Math.PI / 2);
const n = 600;
const wx = new Float64Array(n);
const wy = new Float64Array(n);
const wz = new Float64Array(n);
for (let k = 0; k < n; k++) {
  const x = 1 + (k / 60) * 0.5;
  wx[k] = x;
  wy[k] = x < 2 ? 0 : Math.min(12, Math.floor((x - 2) / 0.28) + 1) * 0.17;
}
const stairs = await measure(wx, wy, wz, 0.5, 0, Math.PI / 2, 7200);
const k20 = Math.tan((20 * Math.PI) / 180);
const sx = new Float64Array(n);
const sy = new Float64Array(n);
const sz = new Float64Array(n);
for (let k = 0; k < n; k++) {
  const z = 7 + (k / 60) * 0.5;
  sx[k] = 0;
  sz[k] = z;
  sy[k] = z < 8 ? 0 : (z - 8) * k20;
}
const slope = await measure(sx, sy, sz, 0, 0.5, 0, 7200);

/** The classes alone on measured stairs, up and down at a walk and a jog (no sampler, no feet, no engine): what they make
 *  is theirs alone. (A closure in wave 3's `stairPick` made that function's context every frame, 40 bytes, which the
 *  measures above fold into the engine's answers.) */
class Classes {
  loco = new BodyLoco(LOCO_TUNE);
  lo = newLocoIn();
  time = 0.5;
  next = 0.5;
  way = 1;
  walk = true;
}
const cl = new Classes();
function classesFrame(): void {
  const dt = 1 / 60;
  const lo = cl.lo;
  cl.loco.keys(dt, !cl.walk, false, cl.walk, rig);
  lo.dt = dt;
  lo.mz = 1;
  lo.mx = 0;
  lo.grounded = true;
  lo.standing = true;
  lo.stairs = cl.way;
  lo.stairKnown = true;
  lo.stairTread = 0.28;
  lo.stairRiser = 0.17;
  lo.stairNext = cl.next;
  cl.loco.plan(lo);
  const mv = cl.loco.speed * dt;
  cl.next -= mv;
  if (cl.next < 0) cl.next += 0.28;
  lo.stairNext = cl.next;
  lo.stairMoved = mv;
  lo.legTime = cl.time;
  lo.ground = cl.loco.speed;
  cl.loco.legs(rig, lo, false);
  cl.time += dt * cl.loco.rate;
  if (cl.time >= 1.367) cl.time -= 1.367;
}
function runClasses(n: number): void {
  for (let k = 0; k < n; k++) classesFrame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(runClasses)');
// The worst of the four ways, each its cleanest window.
const classes = { bytes: 0, casts: 0, frames: 20000, clean: true, stepped: true };
for (const walk of [true, false]) {
  for (const way of [1, -1]) {
    cl.loco = new BodyLoco(LOCO_TUNE);
    cl.lo = newLocoIn();
    cl.lo.scale = 1;
    cl.lo.sprint = LOCO_TUNE.speed.forward.sprint;
    cl.lo.pool = 100;
    cl.time = 0;
    cl.next = 0.2;
    cl.way = way;
    cl.walk = walk;
    runClasses(30000);
    let best = Number.POSITIVE_INFINITY;
    for (let tries = 0; tries < 4; tries++) {
      globalThis.gc!({ type: 'minor' } as never);
      await turn();
      await turn();
      const s0 = scavenges;
      const y0 = young();
      runClasses(classes.frames);
      const y1 = young();
      await turn();
      await turn();
      if (scavenges === s0 && y1 - y0 < best) best = y1 - y0;
    }
    if (best === Number.POSITIVE_INFINITY) classes.clean = false;
    else if (best > classes.bytes) classes.bytes = best;
    if (cl.loco.stepFacts === null) classes.stepped = false;
  }
}
console.log(JSON.stringify({ stand, stairs, slope, classes }));
