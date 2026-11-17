// Wave 4, item B's own frame (the wall climb: `WallClimb.sense` on every frame on foot, `WallClimb.step` and the limbs'
// placement, `limbsFor` then `LimbPlace.place`, every frame a body is on a wall; and the hands' bracing, `HandBrace.step`
// then `apply` and the limbs' placement, every frame on foot and adrift), over a skeleton the game draws posed by the up
// clip, on the real Rapier: walking free (the move never cut short), with the climb at 'before', on a wall held still,
// climbing up and down and sideways along a 40 m wall, and the bracing standing still, running along a wall pressed into
// it, drifting over a surface in space, and at 'before'. What it makes is measured with no collection between and what it
// asks of the engine counted: the engine's own answers are its cost, so the frame is held to asking as seldom as it says
// and making nothing else. Run twelve at once by `wallAlloc.test.ts`; prints one line of JSON.
//
// The frame is a function of its own reading kept fields, called from a loop kept out of the optimizer (wave 2a's lesson).
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { Group, RAPIER, groups } from '../../../src/core/physics.ts';
import { TestBody, box, ground, makePhysics } from './grappleBody.ts';
import { LedgeIn, type LedgeWorld } from '../../../src/player/ledge.ts';
import { WALL_ON, type WallClimb } from '../../../src/player/wallClimb.ts';
import { LimbPlace } from '../../../src/player/limbPlace.ts';
import { BraceIn, HandBrace } from '../../../src/player/brace.ts';
import { Stamina } from '../../../src/anim/locoClass.ts';
import { CLIMB_TUNE, climbTwoBefore } from '../../../src/anim/climbTune.ts';
import { WALL_IDS, wallClipName } from '../../../src/anim/wallClips.ts';
import { MixamoPack } from '../../../src/anim/mixamoPack.ts';
import { figureScaleOf } from '../../../src/player/peerHang.ts';
import { glbSkeleton, repoRoot, speciesBodies, targetSkeleton } from './animFixtures.ts';

// Climbing II, phase 2: these scenes hold today's climbing (a lip grabbed by moving at it, a wall climbed by W pressed
// into it, the hang's keys as they were): every phase 2 switch at its 'before' setting, here and after every reset (the new
// controls are climbControls.test.ts's).
climbTwoBefore();

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

// ---- the world: a wall 16 m wide and 40 m high, a passage-free street, and a floor in space under the drift ------------------
const p = await makePhysics();
ground(p, 0);
box(p, [-8, 0, 2], [8, 40, 3]);
// A plate 0.9 m under a body drifting at y 100 (the brace's space).
p.world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 400).setTranslation(30, 98.6, 0));
p.stepOnce();
const world = p.world as unknown as LedgeWorld;
const scale = figureScaleOf(rig as never);
const ALL = groups(Group.all, Group.all);

/** The frame's state: the body, its climb, its keys and limbs, its bracing, which window. Fields, so nothing crosses a call. */
class Run {
  b = new TestBody(p);
  wall: WallClimb = this.b.wall;
  li = new LedgeIn();
  stam = new Stamina(100);
  lp = new LimbPlace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
  brace = new HandBrace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
  bi = new BraceIn();
  /** 0 walking free, 1 on the wall (still, or moving by `way`: 1 up and down, 2 sideways), 2 bracing (by `way`: 0 still, 1 a wall, 2 space). */
  mode = 0;
  way = 0;
  i = 0;
  z = 0.5;
  up = true;
}
const st = new Run();
st.b.jka.forceLevel = 0;
st.li.scale = scale;
st.li.filter = st.b.filter;
st.li.pool = 100;
st.z = 0;
st.bi.scale = scale;
st.bi.filter = ALL;
function frame(): void {
  const s = st;
  const b = s.b;
  const li = s.li;
  li.dt = 1 / 60;
  s.stam.value = 100;
  s.stam.tired = false;
  if (s.mode === 0) {
    // On foot (the player's `senseWall`, every frame), walking free: the move never cut short.
    li.grounded = true;
    li.wasGrounded = true;
    li.forwardHeld = true;
    li.blocked = false;
    li.moveX = 0;
    li.moveZ = 1;
    s.wall.sense(world, b, li, s.stam);
    return;
  }
  if (s.mode === 1) {
    // On the wall: still, up and down by turns (up to 12 m, down to 6: the two speeds differ, so turns by time would walk it
    // off the wall's foot), or sideways by turns, two seconds each.
    const turnOf = ((s.i / 120) | 0) % 2 === 0;
    if (b.pos.y > 12) s.up = false;
    else if (b.pos.y < 6) s.up = true;
    li.forwardHeld = s.way === 1 && s.up;
    li.backHeld = s.way === 1 && !s.up;
    li.leftHeld = s.way === 2 && turnOf;
    li.rightHeld = s.way === 2 && !turnOf;
    s.i++;
    s.wall.step(world, b, li, s.stam, null);
    // The figure placed (the player's `applyWallRoot`), its clean pose put back, then its hands and feet on the face.
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
  // Bracing: standing still, running along the wall pressed into it (back and forth so it stays beside it), or adrift.
  const bi = s.bi;
  bi.dt = 1 / 60;
  bi.heading = 0;
  bi.freeL = true;
  bi.freeR = true;
  bi.busy = false;
  if (s.way === 2) {
    bi.onFeet = false;
    bi.space = true;
    bi.x = 30;
    bi.y = 100;
    bi.z = s.z;
    bi.vx = 0;
    bi.vy = 0;
    bi.vz = 0.8;
    bi.moveX = 0;
    bi.moveZ = 0;
    s.z += 0.8 / 60;
    if (s.z > 300) s.z = -300;
  } else {
    bi.onFeet = true;
    bi.space = false;
    // The wall's face at z 2, its normal -z: the body 0.45 m off it running along x, its keys pushing into it; or (way 3)
    // running in the open 20 m off it, nothing within reach (the fix round's: a look only every `WALL_LOOK` seconds).
    bi.x = s.z;
    bi.y = 0;
    bi.z = s.way === 3 ? -20 : 1.55;
    bi.heading = Math.PI / 2;
    bi.vx = s.way === 1 || s.way === 3 ? 5 : 0;
    bi.vy = 0;
    bi.vz = 0;
    bi.moveX = s.way === 1 ? 0.8 : s.way === 3 ? 1 : 0;
    bi.moveZ = s.way === 1 ? 0.6 : 0;
    if (s.way === 1 || s.way === 3) {
      s.z += 5 / 60;
      if (s.z > 6) s.z = -6;
    }
  }
  s.brace.step(p.world, bi, null);
  s.lp.restore();
  group.position.x = bi.x;
  group.position.y = bi.y;
  group.position.z = bi.z;
  group.rotation.y = bi.heading;
  fig.position.x = 0;
  fig.position.y = 0;
  fig.position.z = 0;
  fig.quaternion.x = 0;
  fig.quaternion.y = 0;
  fig.quaternion.z = 0;
  fig.quaternion.w = 1;
  if (!s.brace.busy) return;
  group.updateMatrixWorld(true);
  s.brace.apply(s.lp);
  s.lp.filter = ALL;
  s.lp.place(rig as never, p.world, null);
}
function run(n: number): void {
  for (let k = 0; k < n; k++) frame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(run)');

const casts = () => st.wall.casts + st.brace.casts + ((st.lp.report() as { casts: number }).casts ?? 0);
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
const free = await measure(0, 0, 60000);
CLIMB_TUNE.wall = 'before';
const before = await measure(0, 0, 60000);
CLIMB_TUNE.wall = 'on';
// Onto the wall: the body walked into it with W held until it climbs, then up into the middle of the 40 m face.
const b = st.b;
b.place(0, 0, 1);
b.forward.set(0, 0, 1);
b.right.set(-1, 0, 0);
b.run(60, 0.3);
b.key('KeyW', true);
for (let i = 0; i < 240 && st.wall.phase !== WALL_ON; i++) b.frame(1 / 60);
for (let i = 0; i < 600; i++) b.frame(1 / 60);
b.key('KeyW', false);
const climbing = st.wall.phase === WALL_ON;
const still = await measure(1, 0, 60000);
const upDown = await measure(1, 1, 4800);
const side = await measure(1, 2, 4800);
const braceStill = await measure(2, 0, 60000);
const braceWall = await measure(2, 1, 4800);
const braceSpace = await measure(2, 2, 4800);
const braceOpen = await measure(2, 3, 4800);
CLIMB_TUNE.brace.rule = 'before';
const braceBefore = await measure(2, 1, 60000);
CLIMB_TUNE.brace.rule = 'on';
console.log(JSON.stringify({ free, before, still, upDown, side, braceStill, braceWall, braceSpace, braceOpen, braceBefore, climbing, y: b.pos.y }));
