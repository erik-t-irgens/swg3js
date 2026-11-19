// Climbing II, phase 2, maker B's own frame under its new settings (`climb.wallSide` 'shimmy', `climb.wallLimbs` 'held',
// `climb.lookAway` 'reach'): on a wall, `WallClimb.step` then the limbs' placement (`limbsFor`, the holds, `LimbPlace.place`)
// climbing up and down, sideways on the shimmy clips and diagonally; and braced on a lip, `LedgeHang.step` then its limbs
// (`limbsFor`, the look-away's leading hand and the trailing hand's anchor, `place`) with the view turned away and back by
// turns; over a skeleton the game draws, on the real Rapier. What it makes is measured with no collection between and what it
// asks of the engine counted: the engine's own answers are its cost. Run twelve at once by `climbTwoBAlloc.test.ts`; prints
// one line of JSON. The frame is a function of its own reading kept fields, called from a loop kept out of the optimizer
// (wave 2a's lesson), as `wallAllocOwn.ts`'s is.
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { Group, RAPIER, groups } from '../../../src/core/physics.ts';
import { TestBody, box, ground, makePhysics } from './grappleBody.ts';
import { LedgeIn, LEDGE_HANG, type LedgeWorld } from '../../../src/player/ledge.ts';
import { WALL_ON, type WallClimb } from '../../../src/player/wallClimb.ts';
import { LimbPlace } from '../../../src/player/limbPlace.ts';
import { Stamina } from '../../../src/anim/locoClass.ts';
import { climbSmoothBefore, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { WALL_IDS, wallClipName } from '../../../src/anim/wallClips.ts';
import { MixamoPack } from '../../../src/anim/mixamoPack.ts';
import { figureScaleOf } from '../../../src/player/peerHang.ts';
import { glbSkeleton, repoRoot, speciesBodies, targetSkeleton } from './animFixtures.ts';

resetClimbTune();
// Phase 2's look-away (a braced hang looking back by turns) is its own grammar's: the smoothness round's 'cue' asks W for it.
climbSmoothBefore();
let scavenges = 0;
new PerformanceObserver((l) => {
  scavenges += l.getEntries().length;
}).observe({ entryTypes: ['gc'] });
const turn = () => new Promise<void>((r) => setImmediate(r));
const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;

const root = repoRoot(import.meta.url);
const body = speciesBodies(root).find((b) => b.id === 'human_male');
const target = body ? glbSkeleton(body.body) : targetSkeleton();

// ---- the figure, posed once by the up clip (its clean pose put back every frame, as the rig's hook does) ---------------------
const group = new THREE.Group();
const fig = new THREE.Group();
const inner = new THREE.Group();
inner.position.fromArray(target.base.p);
inner.quaternion.fromArray(target.base.q);
fig.add(inner);
group.add(fig);
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
const rig = { root: fig, boneNamed: (n: string) => bones.get(n) ?? null, restSkeleton: () => target, limbPose: null as { restore(): void } | null };
const packDir = join(root, 'public', 'anims', 'mixamo');
const pack = new MixamoPack({
  enabled: () => true,
  index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
  clip: async (file: string) => {
    const b = readFileSync(join(packDir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
  breath: async () => {},
  also: WALL_IDS,
  now: () => performance.now(),
});
console.info = () => {};
const clips = await pack.clipsFor(target as never, 'alloc');
const mixer = new THREE.AnimationMixer(fig);
const climbClip = mixer.clipAction(clips.find((c) => c.name === wallClipName('climbing_up_wall'))!);
climbClip.play();
climbClip.time = 0.85;
mixer.update(0);
const AX = new THREE.Vector3(1, 0, 0);

// ---- the world: a wall 16 m wide and 40 m high, and a lip 2.6 m up with nothing behind it ------------------------------------
const p = await makePhysics();
ground(p, 0);
box(p, [-8, 0, 2], [8, 40, 3]);
box(p, [30, 0, 2], [40, 2.6, 3]);
p.stepOnce();
const world = p.world as unknown as LedgeWorld;
const scale = figureScaleOf(rig as never);
const ALL = groups(Group.all, Group.all);

/** The frame's state: fields, so nothing crosses a call. */
class Run {
  b = new TestBody(p);
  wall: WallClimb = this.b.wall;
  li = new LedgeIn();
  stam = new Stamina(100);
  lp = new LimbPlace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
  /** 1 on the wall (by `way`: 1 up and down, 2 sideways, 3 diagonally), 2 hanging braced, looking away and back by turns. */
  mode = 0;
  way = 0;
  i = 0;
  up = true;
}
const st = new Run();
st.b.jka.forceLevel = 0;
st.li.scale = scale;
st.li.filter = st.b.filter;
st.li.pool = 100;
function frame(): void {
  const s = st;
  const b = s.b;
  const li = s.li;
  li.dt = 1 / 60;
  s.stam.value = 100;
  s.stam.tired = false;
  const turnOf = ((s.i / 120) | 0) % 2 === 0;
  s.i++;
  if (s.mode === 1) {
    if (b.pos.y > 12) s.up = false;
    else if (b.pos.y < 6) s.up = true;
    li.forwardHeld = (s.way === 1 || s.way === 3) && s.up;
    li.backHeld = (s.way === 1 || s.way === 3) && !s.up;
    li.leftHeld = (s.way === 2 || s.way === 3) && turnOf;
    li.rightHeld = (s.way === 2 || s.way === 3) && !turnOf;
    s.wall.step(world, b, li, s.stam, null);
    s.lp.restore();
    const W = s.wall;
    group.position.x = b.pos.x;
    group.position.y = b.pos.y;
    group.position.z = b.pos.z;
    group.rotation.y = W.heading;
    const c = Math.cos(W.heading);
    const sn = Math.sin(W.heading);
    fig.position.x = W.offX * c - W.offZ * sn;
    fig.position.y = W.offY;
    fig.position.z = W.offX * sn + W.offZ * c;
    fig.rotation.x = W.lean;
    group.updateMatrixWorld(true);
    s.lp.filter = li.filter;
    W.limbsFor(s.lp, rig as never, world, null);
    s.lp.place(rig as never, p.world, null);
    return;
  }
  // Hanging braced: the view behind over the right shoulder and back to the wall by turns, two seconds each.
  const L = b.ledge;
  li.forwardHeld = false;
  li.backHeld = false;
  li.leftHeld = false;
  li.rightHeld = false;
  li.jumpPressed = false;
  li.forwardPressed = false;
  li.crouchPressed = false;
  li.viewYaw = turnOf ? L.heading - 2.8 : L.heading;
  L.step(world, b, li, s.stam);
  s.lp.restore();
  group.position.x = b.pos.x;
  group.position.y = b.pos.y;
  group.position.z = b.pos.z;
  group.rotation.y = L.heading;
  const c = Math.cos(L.heading);
  const sn = Math.sin(L.heading);
  fig.position.x = L.offX * c - L.offZ * sn;
  fig.position.y = L.offY;
  fig.position.z = L.offX * sn + L.offZ * c;
  fig.rotation.x = 0;
  group.updateMatrixWorld(true);
  s.lp.filter = li.filter;
  L.limbsFor(s.lp, rig as never, null);
  s.lp.place(rig as never, p.world, null);
}
function run(n: number): void {
  for (let k = 0; k < n; k++) frame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(run)');

const casts = () => st.wall.casts + st.b.ledge.casts + ((st.lp.report() as { casts: number }).casts ?? 0);
async function measure(mode: number, way: number, window: number): Promise<{ bytes: number; casts: number; frames: number; clean: boolean }> {
  st.mode = mode;
  st.way = way;
  run(6000);
  let best = { bytes: Number.POSITIVE_INFINITY, casts: 0, frames: window, clean: false };
  for (let tries = 0; tries < 4; tries++) {
    run(240);
    globalThis.gc!({ type: 'minor' } as never);
    await turn();
    await turn();
    const s0 = scavenges;
    const c0 = casts();
    const y0 = young();
    run(window);
    const y1 = young();
    await turn();
    await turn();
    if (scavenges === s0 && y1 - y0 < best.bytes) best = { bytes: y1 - y0, casts: casts() - c0, frames: window, clean: true };
  }
  return best;
}
// Onto the wall: walked into it with W and the use key held, then up into the middle of the 40 m face.
const b = st.b;
b.place(0, 0, 1);
b.forward.set(0, 0, 1);
b.right.set(-1, 0, 0);
b.run(60, 0.3);
b.key('KeyW', true);
b.key('KeyE', true);
for (let i = 0; i < 240 && st.wall.phase !== WALL_ON; i++) b.frame(1 / 60);
b.key('KeyE', false);
for (let i = 0; i < 600; i++) b.frame(1 / 60);
b.key('KeyW', false);
const climbing = st.wall.phase === WALL_ON;
const upDown = await measure(1, 1, 4800);
const side = await measure(1, 2, 4800);
const diagonal = await measure(1, 3, 4800);
const holds = { taken: st.wall.holds.taken, reaches: st.wall.holds.reaches };
// Off the wall onto the lip: a standing jump at it with W and the use key held.
st.wall.reset('alloc');
b.place(35, 0, 1.2);
b.forward.set(0, 0, 1);
b.right.set(-1, 0, 0);
b.run(60, 0.3);
b.key('KeyW', true);
b.key('KeyE', true);
b.key('Space', true);
b.frame(1 / 60);
b.key('Space', false);
for (let i = 0; i < 240 && b.ledge.phase !== LEDGE_HANG; i++) b.frame(1 / 60);
b.key('KeyW', false);
b.key('KeyE', false);
const hanging = b.ledge.phase === LEDGE_HANG && b.ledge.braced;
const look = await measure(2, 0, 4800);
const looked = b.ledge.phase === LEDGE_HANG;
console.log(JSON.stringify({ upDown, side, diagonal, look, climbing, hanging, looked, holds }));
