// Climbing II, Smoothness III's own frames (maker A), measured on the real Rapier with no collection between, each frame a
// function of its own reading kept fields, called from a loop kept out of the optimizer (wave 2a's lesson): an arc's hop up a
// rung and the drop down again on its own two parts (items 1 and 4b: `climb.hopFlight` 'arc', `climb.dropMove` 'drop'), each
// move's frames inside it summed (the move's start and end being events: the search, the room under the target, `targetRoom`
// 'fit', is an event's). `S3_MODE` 'timed' puts this round's switches at their other setting (Smoothness II's timed hop and its
// side hop down) for the comparison. Run twelve at once by `smooth3Alloc.test.ts`; prints one line of JSON.
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import { TestBody, box, ground, makePhysics } from './grappleBody.ts';
import { LedgeIn, LEDGE_HANG, LEDGE_MOVE, type LedgeWorld } from '../../../src/player/ledge.ts';
import { Stamina } from '../../../src/anim/locoClass.ts';
import { climbSmooth3Before, resetClimbTune } from '../../../src/anim/climbTune.ts';

resetClimbTune();
const MODE = process.env.S3_MODE === 'timed' ? 'timed' : 'arc';
if (MODE === 'timed') climbSmooth3Before();
let scavenges = 0;
new PerformanceObserver((l) => {
  scavenges += l.getEntries().length;
}).observe({ entryTypes: ['gc'] });
const turn = () => new Promise<void>((r) => setImmediate(r));
const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;

// ---- the world: a wall 7 m tall, two rungs 0.3 m out of it (tops 2.4 and 3.9 m: 1.5 m apart, a hop, past a ladder's reach) ----
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
}
const st = new Run();
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
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(hops)');

interface Part {
  bytes: number;
  frames: number;
  clean: boolean;
}
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
function untilHang(most: number): void {
  for (let i = 0; i < most && b.ledge.phase !== LEDGE_HANG; i++) hopFrame();
}
/** The frames left of the move from now, at 60 a second (an arc's: to the leave, the flight, to the end; a timed one's alike). */
function framesLeft(): number {
  const m = b.ledge.move;
  const t = m.time;
  const pre = t < m.tL ? m.tL - t : 0;
  const fly = m.arc ? m.F - m.fly : (m.tT - (t > m.tL ? t : m.tL)) / m.fr;
  const post = m.T - (t > m.tT ? t : m.tT);
  return Math.floor((pre + (fly > 0 ? fly : 0) + post) * 60);
}
const hop: Part = { bytes: 0, frames: 0, clean: true };
let dirty = 0;
let arcs = 0;
let parts = 0;
let made = 0;
async function oneHop(up: boolean): Promise<void> {
  untilHang(240);
  st.w = up;
  st.s = !up;
  for (let i = 0; i < 120 && b.ledge.cue < 0.99; i++) hopFrame();
  st.jump = true;
  hopFrame();
  st.jump = false;
  st.w = false;
  st.s = false;
  if (b.ledge.phase !== LEDGE_MOVE) return;
  made++;
  if (b.ledge.move.arc) arcs++;
  if (b.ledge.move.parts === 2) parts++;
  hops(2);
  const n = framesLeft() - 3;
  if (n < 20) return;
  // (The phase 3 fix round's: wall time for the optimising compiler, on a thread of its own, as ledgeAllocOwn.ts waits: in a
  // chained run on a loaded machine one process's arc measured 450 bytes a frame against its fellows' 344, clean run alone.)
  await new Promise<void>((r) => setTimeout(r, 25));
  globalThis.gc!({ type: 'minor' } as never);
  await turn();
  await turn();
  const s0 = scavenges;
  const y0 = young();
  hops(n);
  const y1 = young();
  await turn();
  await turn();
  if (scavenges !== s0) {
    dirty++;
    return;
  }
  hop.bytes += y1 - y0;
  hop.frames += n;
}
for (let k = 0; k < 60; k++) await oneHop(k % 2 === 0);
untilHang(240);
hop.bytes = 0;
hop.frames = 0;
dirty = 0;
arcs = 0;
parts = 0;
made = 0;
for (let k = 0; k < 40; k++) await oneHop(k % 2 === 0);
hop.clean = dirty <= 20 && hop.frames > 0;
const still = b.ledge.phase === LEDGE_HANG || b.ledge.phase === LEDGE_MOVE;
console.log(JSON.stringify({ mode: MODE, hanging, still, made, arcs, parts, hop }));
