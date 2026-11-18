// Climbing II, Smoothness II's own frames (maker A), measured on the real Rapier with no collection between, the cleanest of
// four windows, each frame a function of its own reading kept fields, called from a loop kept out of the optimizer (wave 2a's
// lesson): a timed hop's frames (item 1, `climb.hopFlight` 'timed': up a rung and down again, each move's frames inside it
// summed, the hop's start and end being events), the drop's clocks (item 1's drops' rule, a drop played and landed over and
// over), the follow the chase camera is handed while climbing (item 7, a target swept round), and the game's own camera with
// a wall's pull-in let out eased (`blockOut`, item 7) against the same camera with it nought. Run twelve at once by
// `smooth2Alloc.test.ts`; prints one line of JSON.
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import * as THREE from 'three';
import { TestBody, box, ground, makePhysics } from './grappleBody.ts';
import { LedgeIn, LEDGE_HANG, LEDGE_MOVE, LEDGE_NONE, type LedgeWorld } from '../../../src/player/ledge.ts';
import { Stamina } from '../../../src/anim/locoClass.ts';
import { CLIMB_TUNE, resetClimbTune as resetShipped, climbSmooth3Before } from '../../../src/anim/climbTune.ts';
// (Smoothness III's switches at their other setting too: this suite holds Smoothness II's climbing.)
const resetClimbTune = (): void => {
  resetShipped();
  climbSmooth3Before();
};
import { LEDGE_ROLES } from '../../../src/anim/ledgeClips.ts';
import { handMoment } from '../../../src/anim/handTimes.ts';
import { ClimbCamFollow } from '../../../src/player/climbCam.ts';
import { ThirdPersonCamera } from '../../../src/core/camera.ts';

resetClimbTune();
if (process.env.S2_HOPS === 'before') CLIMB_TUNE.hopFlight = 'before';
let scavenges = 0;
new PerformanceObserver((l) => {
  scavenges += l.getEntries().length;
}).observe({ entryTypes: ['gc'] });
const turn = () => new Promise<void>((r) => setImmediate(r));
const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;

// ---- the world: a wall 7 m tall, two rungs 0.3 m out of it (tops 2.4 and 3.9 m) ---------------------------------------------
const p = await makePhysics();
ground(p, 0);
box(p, [-8, 0, 2], [8, 7, 3]);
box(p, [-8, 2.2, 1.7], [8, 2.4, 2]);
box(p, [-8, 3.7, 1.7], [8, 3.9, 2]);
p.stepOnce();
const world = p.world as unknown as LedgeWorld;

/** The frame's state: fields, so nothing crosses a call. */
class Run {
  b = new TestBody(p);
  li = new LedgeIn();
  stam = new Stamina(100);
  w = false;
  s = false;
  jump = false;
  i = 0;
  // The drop's clocks.
  grounded = false;
  // The follow and the camera.
  F = new ClimbCamFollow();
  cam = new ThirdPersonCamera(16 / 9);
  target = new THREE.Vector3();
  input = { locked: false, mouseDX: 0, mouseDY: 0, wheel: 0 };
  blocked = false;
  blocker = (): number | null => (this.blocked ? 1.2 : null);
  x = 0.5;
}
const st = new Run();
st.x = 0;
st.b.jka.forceLevel = 0;
st.li.scale = 1;
st.li.filter = st.b.filter;
st.li.pool = 100;
function hopFrame(): void {
  const s = st;
  const li = s.li;
  li.dt = 1 / 60;
  s.stam.value = 100;
  s.stam.tired = false;
  li.leftHeld = false;
  li.rightHeld = false;
  li.forwardHeld = s.w;
  li.backHeld = s.s;
  li.jumpPressed = s.jump;
  li.forwardPressed = false;
  li.crouchPressed = false;
  li.crouchHeld = false;
  li.viewYaw = s.b.ledge.heading;
  li.heading = s.b.ledge.heading;
  s.b.ledge.step(world, s.b, li, s.stam);
}
function hops(n: number): void {
  for (let k = 0; k < n; k++) hopFrame();
}
const DROP = LEDGE_ROLES.braced.drop;
const L0 = st.b.ledge as unknown as { dropId: string; dropClock: number; dropTL: number; dropTT: number; dropDur: number; dropRate: number; dropLanded: boolean; dropHeldFor: number; phase: number; dropClocks(dt: number, g: boolean, falling: boolean): void };
const DTL = handMoment(DROP, 'leave');
const DTT = handMoment(DROP, 'touch');
function dropFrame(): void {
  const s = st;
  const L = L0;
  if (!L.dropId) {
    L.dropId = DROP;
    L.dropClock = 0;
    L.dropTL = DTL;
    L.dropTT = DTT;
    L.dropDur = 1.3;
    L.dropRate = 0.5;
    L.dropLanded = false;
    L.dropHeldFor = 0;
    s.i = 0;
  }
  s.i++;
  s.grounded = s.i > 70;
  L.dropClocks(1 / 60, s.grounded, true);
}
function drops(n: number): void {
  for (let k = 0; k < n; k++) dropFrame();
}
function followFrame(): void {
  const s = st;
  s.i++;
  s.x += 0.01;
  if (s.x > 6.283185307179586) s.x -= 6.283185307179586;
  const F = s.F;
  F.tx = Math.sin(s.x) * 2;
  F.ty = 1.5 + Math.cos(s.x * 3) * 0.2;
  F.tz = Math.cos(s.x) * 2;
  F.dt = 1 / 60;
  F.climbing = (s.i & 255) < 200;
  F.ease = 0.12;
  F.bvx = 0;
  F.bvy = 0;
  F.bvz = 0;
  F.stepIn();
}
function follows(n: number): void {
  for (let k = 0; k < n; k++) followFrame();
}
/** The camera's letting out alone (its own method, `letOut`): the game's camera frame round it is today's, which boxes a number
 * now and then in some processes by the order its code was compiled in, with the letting out or without (measured, both ways
 * alike), and is not this round's to measure. */
const C = st.cam as unknown as { orbitWant: number; orbitDt: number; blockOut: number; letOut(): boolean };
function camFrame(): void {
  const s = st;
  s.i++;
  // A wall in the way for 40 frames of every 128 (the orbit pulled to 1.2 m), the orbit's own 5 m otherwise.
  C.orbitWant = (s.i & 127) < 40 ? 1.2 : 5 + Math.sin(s.i * 0.003) * 0.2;
  C.orbitDt = 1 / 60;
  C.letOut();
}
function cams(n: number): void {
  for (let k = 0; k < n; k++) camFrame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(hops)');
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(drops)');
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(follows)');
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(cams)');

interface Part {
  bytes: number;
  frames: number;
  clean: boolean;
}
async function measure(run: (n: number) => void, window: number): Promise<Part> {
  run(4000);
  let best: Part = { bytes: Number.POSITIVE_INFINITY, frames: window, clean: false };
  for (let tries = 0; tries < 4; tries++) {
    run(240);
    globalThis.gc!({ type: 'minor' } as never);
    await turn();
    await turn();
    const s0 = scavenges;
    const y0 = young();
    run(window);
    const y1 = young();
    await turn();
    await turn();
    if (scavenges === s0 && y1 - y0 < best.bytes) best = { bytes: y1 - y0, frames: window, clean: true };
  }
  return best;
}

// ---- the hops: onto the low rung, then up and down by the keys, each move's own frames measured ----------------------------
const b = st.b;
b.place(0, 0, 0.9);
b.forward.set(0, 0, 1);
b.right.set(-1, 0, 0);
b.run(60, 0.3);
b.key('KeyE', true);
b.key('Space', true);
b.frame(1 / 60);
b.key('Space', false);
for (let i = 0; i < 240 && b.ledge.phase !== LEDGE_HANG; i++) b.frame(1 / 60);
b.key('KeyE', false);
const hanging = b.ledge.phase === LEDGE_HANG;
/** Frames until the hang (or `most`). */
function untilHang(most: number): void {
  for (let i = 0; i < most && b.ledge.phase !== LEDGE_HANG; i++) hopFrame();
}
/** The frames left of a timed move from now, at 60 a second (its clock's own pieces: to the leave, the flight, to the end). */
function framesLeft(): number {
  const m = b.ledge.move;
  const t = m.time;
  const pre = t < m.tL ? m.tL - t : 0;
  const fly = (m.tT - (t > m.tL ? t : m.tL)) / m.fr;
  const post = m.T - (t > m.tT ? t : m.tT);
  return Math.floor((pre + (fly > 0 ? fly : 0) + post) * 60);
}
const hop: Part = { bytes: 0, frames: 0, clean: true };
let hopDirty = 0;
let timedMoves = 0;
let hopsMade = 0;
async function oneHop(up: boolean): Promise<void> {
  untilHang(240);
  // The cue held to its full (W up, S down), then Space.
  st.w = up;
  st.s = !up;
  for (let i = 0; i < 120 && b.ledge.cue < 0.99; i++) hopFrame();
  st.jump = true;
  hopFrame();
  st.jump = false;
  st.w = false;
  st.s = false;
  if (b.ledge.phase !== LEDGE_MOVE) return;
  hopsMade++;
  if (b.ledge.move.timed) timedMoves++;
  hops(2);
  const n = b.ledge.move.timed ? framesLeft() - 3 : Math.floor(((b.ledge.move.T - b.ledge.move.time) / 1) * 60) - 3;
  if (n < 20) return;
  globalThis.gc!({ type: 'minor' } as never);
  await turn();
  await turn();
  const s0 = scavenges;
  const y0 = young();
  hops(n);
  const y1 = young();
  await turn();
  await turn();
  // (A window a collection fell in says nothing and is left out: under a machine's load one now and then is; the part is
  // clean while most of its windows are, hopDirty counting the others.)
  if (scavenges !== s0) {
    hopDirty++;
    return;
  }
  hop.bytes += y1 - y0;
  hop.frames += n;
}
for (let k = 0; k < 60; k++) await oneHop(k % 2 === 0);
untilHang(240);
// (Warm: the first twenty hops' frames are counted again from nought once the code has settled.)
hop.bytes = 0;
hop.frames = 0;
hop.clean = true;
hopDirty = 0;
for (let k = 0; k < 40; k++) await oneHop(k % 2 === 0);
hop.clean = hopDirty <= 20 && hop.frames > 0;
const hopsHanging = b.ledge.phase === LEDGE_HANG || b.ledge.phase === LEDGE_MOVE;

// ---- the drop's clocks, the follow, the camera with and without the eased letting out ---------------------------------------
st.i = 0;
const L = b.ledge;
// (The drop's clocks run only with the ledges let go of.)
(L as unknown as { phase: number }).phase = LEDGE_NONE;
const drop = await measure(drops, 100000);
st.i = 0;
const follow = await measure(follows, 100000);
const camMode = 'eased';
C.blockOut = CLIMB_TUNE.camOut;
const cam = await measure(cams, 100000);
console.log(JSON.stringify({ hanging, hopsHanging, hopsMade, timedMoves, hop, drop, follow, camMode, cam }));
