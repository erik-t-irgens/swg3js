// Wave 4's own frame (the ledges: `LedgeHang.sense` on every frame on foot, `LedgeHang.step` and the limbs' placement,
// `limbsFor` then `LimbPlace.place`, every frame a body hangs), over a skeleton the game draws posed by the braced hang's
// clip, on the real Rapier: standing on the ground, in the air in the open, hanging still, shimmying back and forth along a
// 16 m lip, and with the ledges at 'before'. What it makes is measured with no collection between and what it asks of the
// engine counted: the engine's own answers are its cost, so the frame is held to asking as seldom as it says and making
// nothing else. Run twelve at once by `ledgeAlloc.test.ts`; prints one line of JSON.
//
// The frame is a function of its own reading kept fields, called from a loop kept out of the optimizer (wave 2a's lesson).
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { RAPIER } from '../../../src/core/physics.ts';
import { TestBody, box, ground, makePhysics } from './grappleBody.ts';
import { LedgeHang, LedgeIn, LEDGE_HANG, type LedgeWorld } from '../../../src/player/ledge.ts';
import { LimbPlace } from '../../../src/player/limbPlace.ts';
import { Stamina } from '../../../src/anim/locoClass.ts';
import { CLIMB_TUNE, climbTwoBefore } from '../../../src/anim/climbTune.ts';
import { LEDGE_IDS, ledgeClipName } from '../../../src/anim/ledgeClips.ts';
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

// ---- the figure, posed once by the braced idle (its clean pose put back every frame, as the rig's hook does) -------------------
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
  also: LEDGE_IDS,
  now: () => performance.now(),
});
console.info = () => {};
const clips = await pack.clipsFor(target as never, 'alloc');
const mixer = new THREE.AnimationMixer(fig);
const idle = mixer.clipAction(clips.find((c) => c.name === ledgeClipName('braced_hanging_idle'))!);
idle.play();
idle.time = 0.5;
mixer.update(0);

// ---- the world: a 16 m wall whose top is 2.6 m up ---------------------------------------------------------------------------
const p = await makePhysics();
ground(p, 0);
box(p, [-8, 0, 2], [8, 2.6, 3]);
p.stepOnce();
const world = p.world as unknown as LedgeWorld;
const scale = figureScaleOf(rig as never);

/** The frame's state: the body, its ledge, its keys and limbs, which window. Fields, so nothing crosses a call. */
class Run {
  b = new TestBody(p);
  /** The harness's own ledge (what its grab takes the body into). */
  ledge: LedgeHang = this.b.ledge;
  li = new LedgeIn();
  stam = new Stamina(100);
  lp = new LimbPlace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
  /** 0 standing, 1 in the air, 2 hanging (still or shimmying by `way`). */
  mode = 0;
  way = 0;
  i = 0;
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
  if (s.mode !== 2) {
    // On foot (the player's `senseLedge`, every frame): standing on the ground, or in the air in the open.
    li.grounded = s.mode === 0;
    li.wasGrounded = s.mode === 0;
    // Moving forward (+z), facing it: a lip ahead would be grabbed.
    li.forwardHeld = true;
    li.moveX = 0;
    li.moveZ = 1;
    li.heading = 0;
    b.pos.x = 0;
    b.pos.y = s.mode === 0 ? 0 : 4;
    b.pos.z = -4;
    b.vel.x = 0;
    b.vel.y = s.mode === 0 ? 0 : -1;
    b.vel.z = 0;
    s.ledge.sense(world, b, li, s.stam);
    return;
  }
  // Hanging: A or D held by turns, two seconds each, so the body shimmies back and forth along the lip.
  if (s.way !== 0) {
    const left = ((s.i / 120) | 0) % 2 === 0;
    li.leftHeld = left;
    li.rightHeld = !left;
  } else {
    li.leftHeld = false;
    li.rightHeld = false;
  }
  li.forwardHeld = false;
  li.moveZ = 0;
  s.i++;
  s.ledge.step(world, b, li, s.stam);
  // The figure placed (the player's `applyLedgeRoot`), its clean pose put back, then its limbs on the lip.
  s.lp.restore();
  const L = s.ledge;
  group.position.x = b.pos.x;
  group.position.y = b.pos.y;
  group.position.z = b.pos.z;
  group.rotation.y = L.heading;
  const c = Math.cos(L.heading);
  const sn = Math.sin(L.heading);
  fig.position.x = L.offX * c - L.offZ * sn;
  fig.position.y = L.offY;
  fig.position.z = L.offX * sn + L.offZ * c;
  group.updateMatrixWorld(true);
  L.limbsFor(s.lp, rig as never, null);
  s.lp.filter = li.filter;
  s.lp.place(rig as never, p.world, null);
}
function run(n: number): void {
  for (let k = 0; k < n; k++) frame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(run)');

const casts = () => st.ledge.casts + ((st.lp.report() as { casts: number }).casts ?? 0);
async function measure(mode: number, way: number, window: number): Promise<{ bytes: number; casts: number; frames: number; clean: boolean }> {
  st.mode = mode;
  st.way = way;
  run(6000);
  let best = { bytes: Number.POSITIVE_INFINITY, casts: 0, frames: window, clean: false };
  for (let tries = 0; tries < 4; tries++) {
    run(240);
    // Wall time for the optimising compiler, which works on a thread of its own: under a loaded machine its job had not
    // landed after all four tries in one process of several dozen, and code not yet optimised boxes every fraction it
    // reads (since Climbing II's `seenY` the standing path reads two). A path that allocates once optimised still fails.
    await new Promise<void>((r) => setTimeout(r, 25));
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
const stand = await measure(0, 0, 60000);
const air = await measure(1, 0, 7200);
CLIMB_TUNE.ledges = 'before';
const before = await measure(1, 0, 60000);
CLIMB_TUNE.ledges = 'on';
// Into a hang: the body at the wall, a jump with W, until it hangs.
st.mode = 3;
const b = st.b;
b.place(0, 0, 1.2);
b.forward.set(0, 0, 1);
b.right.set(-1, 0, 0);
b.run(60, 0.3);
b.key('KeyW', true);
b.key('Space', true);
b.frame(1 / 60);
b.key('Space', false);
for (let i = 0; i < 180 && !(st.ledge.phase === LEDGE_HANG); i++) b.frame(1 / 60);
b.key('KeyW', false);
const hanging = st.ledge.phase === LEDGE_HANG;
const still = await measure(2, 0, 60000);
const shimmy = await measure(2, 1, 4800);
console.log(JSON.stringify({ stand, air, before, still, shimmy, hanging, braced: st.ledge.braced }));
