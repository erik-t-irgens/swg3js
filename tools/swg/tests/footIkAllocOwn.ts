// Wave 3's own frame (the feet's placement, the stairs' sampler and the drawn body's ease: `FootIk.step`,
// `StairSense.step`, `DrawnHeight.step`, the three calls the player's update makes every frame a body is on its feet),
// over a skeleton the game draws on the real Rapier: standing still on flat ground, walking over a staircase, and with every
// rule at 'before'. What it makes is measured with no collection between and what it asks of the engine counted: the
// engine's own answers are its cost, so the frame is held to asking as seldom as it says and making nothing else. Run
// twelve at once by `footIkAlloc.test.ts`; prints one line of JSON.
//
// The frame is a function of its own reading kept fields, called from a loop kept out of the optimizer (wave 2a's lesson).
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import * as THREE from 'three';
import { Physics, RAPIER, TRIMESH_FLAGS, cleanTrimesh, Group, groups } from '../../../src/core/physics.ts';
import { FootIk } from '../../../src/player/footIk.ts';
import { StairSense } from '../../../src/player/stairSense.ts';
import { DrawnHeight, DrawnIn } from '../../../src/anim/drawnHeight.ts';
import { LOCO_TUNE } from '../../../src/anim/locoTune.ts';
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
for (let i = 0; i < 6; i++) box(p, [2 + i * 0.3, 0, -2], [2 + (i + 1) * 0.3, (i + 1) * 0.2, 2]);
box(p, [3.8, 0, -2], [5.8, 1.2, 2]);
p.stepOnce();
const ALL = groups(Group.all, Group.all);

/** The frame's state: the path walked, which frame, the three records. Fields, so nothing crosses a call. */
class Walk {
  xs = new Float64Array(1);
  ys = new Float64Array(1);
  i = 0;
  n = 1;
  feet = new FootIk(LOCO_TUNE.ik, () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
  stairs = new StairSense();
  drawn = new DrawnHeight();
  di = new DrawnIn();
  fig = figure();
  vx = 0.5;
}
const st = new Walk();
function frame(): void {
  const i = st.i;
  // The rig's own hook before its mixer (here no mixer: the rest pose is the clip's).
  st.fig.rig.legPose?.restore();
  const r = st.fig.root;
  r.position.x = st.xs[i];
  r.position.y = st.ys[i];
  r.updateMatrixWorld(true);
  const fi = st.feet.in;
  fi.dt = 1 / 60;
  fi.on = true;
  fi.stairClip = false;
  fi.px = st.xs[i];
  fi.py = st.ys[i];
  fi.pz = 0;
  fi.heading = 1.5707963267948966;
  fi.filter = ALL;
  st.feet.step(st.fig.rig as never, p.world, null);
  const a = st.stairs.at;
  a.x = st.xs[i];
  a.y = st.ys[i];
  a.z = 0;
  a.vx = st.vx;
  a.vz = 0;
  a.dt = 1 / 60;
  a.filter = ALL;
  a.reads = st.vx > 0;
  st.stairs.step(p.world, LOCO_TUNE.stairs);
  const di = st.di;
  di.dt = 1 / 60;
  di.dx = st.vx / 60;
  di.dy = i > 0 ? st.ys[i] - st.ys[i - 1] : 0;
  di.dz = 0;
  di.askedY = 0;
  di.nx = 0;
  di.ny = 1;
  di.nz = 0;
  di.grounded = true;
  st.drawn.step(di, LOCO_TUNE.stairs);
  st.i = i + 1 === st.n ? 0 : i + 1;
}
function run(n: number): void {
  for (let k = 0; k < n; k++) frame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(run)');

const WINDOW = 60000;
async function measure(xs: Float64Array, ys: Float64Array, vx: number, rules: 'shipped' | 'before', window = WINDOW): Promise<{ bytes: number; casts: number; frames: number; clean: boolean }> {
  LOCO_TUNE.ik.rule = rules === 'before' ? 'before' : 'placed';
  LOCO_TUNE.stairs.rule = rules === 'before' ? 'before' : 'stairs';
  st.xs = xs;
  st.ys = ys;
  st.n = xs.length;
  st.i = 0;
  st.vx = vx;
  st.feet = new FootIk(LOCO_TUNE.ik, () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
  st.stairs = new StairSense();
  st.drawn = new DrawnHeight();
  st.fig = figure();
  run(Math.ceil(30000 / st.n) * st.n);
  const passes = Math.ceil(window / st.n);
  let best = { bytes: Number.POSITIVE_INFINITY, casts: 0, frames: st.n * passes, clean: false };
  for (let tries = 0; tries < 4; tries++) {
    st.i = 0;
    run(st.n);
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
    if (scavenges === s0 && y1 - y0 < best.bytes) best = { bytes: y1 - y0, casts: st.feet.casts + st.stairs.casts - c0, frames: st.n * passes, clean: true };
  }
  return best;
}
// Standing still on flat ground; walking 1 m/s along +x up the staircase and its landing, the capsule on the tread under it.
const stand = await measure(new Float64Array(300).fill(-3), new Float64Array(300), 0, 'shipped');
const n = 360;
const wx = new Float64Array(n);
const wy = new Float64Array(n);
for (let k = 0; k < n; k++) {
  const x = -0.5 + k / 60;
  wx[k] = x;
  wy[k] = x < 2 ? 0 : x < 3.8 ? Math.min(6, Math.floor((x - 2) / 0.3) + 1) * 0.2 : 1.2;
}
// A walk casts the engine's own answers (about a kilobyte each), so its window is short enough to hold them with no collection.
const walk = await measure(wx, wy, 1, 'shipped', 7200);
const before = await measure(wx, wy, 1, 'before');
console.log(JSON.stringify({ stand, walk, before, metres: (n / 60) * 1 }));
