// Climbing II, the smoothness round's own frame (maker A: `climb.hangKeys` 'cue', `climb.shelves` 'grab'): hanging on a rung
// (a shallow lip, a wall 0.3 m behind it, another rung 1.25 m above and one 1.5 m below), the way asked by a key held is
// looked for once (the band's own rays, the engine's answers) and then kept, so a steady frame with a cue shown asks nothing and
// makes nothing: still with no key, W held with the hop's cue (the pull-up held), S held with the drop's cue (a hand lowered,
// the head's look) and still again; then W held with the view turned back to a block behind and forward again by turns (the
// behind's cue and the look-away, the way looked for again at each turn: an event, the engine's answers). Measured on the
// real Rapier with no collection between, the cleanest of four windows, the frame a function of its own reading kept fields,
// called from a loop kept out of the optimizer (wave 2a's lesson). Run twelve at once by `climbSmoothAlloc.test.ts`; prints
// one line of JSON.
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import { TestBody, box, ground, makePhysics } from './grappleBody.ts';
import { LedgeIn, LEDGE_HANG, WAYK_DROP, WAYK_HOP, type LedgeWorld } from '../../../src/player/ledge.ts';
import { Stamina } from '../../../src/anim/locoClass.ts';
import { resetClimbTune } from '../../../src/anim/climbTune.ts';

resetClimbTune();
let scavenges = 0;
new PerformanceObserver((l) => {
  scavenges += l.getEntries().length;
}).observe({ entryTypes: ['gc'] });
const turn = () => new Promise<void>((r) => setImmediate(r));
const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;

// ---- the world: a wall 7 m tall, three rungs 0.3 m out of it (tops 2.4, 3.9 and 5.15 m), a block behind ---------------------
const p = await makePhysics();
ground(p, 0);
box(p, [-8, 0, 2], [8, 7, 3]);
box(p, [-8, 2.2, 1.7], [8, 2.4, 2]);
box(p, [-8, 3.7, 1.7], [8, 3.9, 2]);
box(p, [-8, 4.95, 1.7], [8, 5.15, 2]);
// Behind the hang, 1.8 m back from the rungs' faces, a block whose lip stands level with the middle rung: the behind's cue's.
box(p, [-8, 0, -1.1], [8, 3.9, -0.1]);
p.stepOnce();
const world = p.world as unknown as LedgeWorld;

/** The frame's state: fields, so nothing crosses a call. */
class Run {
  b = new TestBody(p);
  li = new LedgeIn();
  stam = new Stamina(100);
  w = false;
  s = false;
  d = false;
  /** W held with the view turned back over the shoulder and to the wall again by turns, two seconds each (the behind's cue). */
  look = false;
  i = 0;
  /** The most the look-away eased in over the window (the evidence it was looked for). */
  looked = 0.5;
}
const st = new Run();
st.b.jka.forceLevel = 0;
st.li.scale = 1;
st.li.filter = st.b.filter;
st.li.pool = 100;
function frame(): void {
  const s = st;
  const li = s.li;
  li.dt = 1 / 60;
  s.stam.value = 100;
  s.stam.tired = false;
  li.leftHeld = false;
  li.rightHeld = s.d;
  li.forwardHeld = s.w || s.look;
  li.backHeld = s.s;
  li.jumpPressed = false;
  li.forwardPressed = false;
  li.crouchPressed = false;
  li.crouchHeld = false;
  const away = s.look && ((s.i / 120) | 0) % 2 === 1;
  s.i++;
  li.viewYaw = away ? s.b.ledge.heading - 2.8 : s.b.ledge.heading;
  li.heading = s.b.ledge.heading;
  s.b.ledge.step(world, s.b, li, s.stam);
  if (s.b.ledge.look > s.looked) s.looked = s.b.ledge.look;
}
function run(n: number): void {
  for (let k = 0; k < n; k++) frame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(run)');

// Onto the middle rung: a standing jump at the lowest with E held, then W held and Space to the middle (a hop's cue taken).
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
b.key('KeyW', true);
b.run(60, 0.3);
b.key('Space', true);
b.frame(1 / 60);
b.key('Space', false);
b.key('KeyW', false);
for (let i = 0; i < 240 && b.ledge.phase !== LEDGE_HANG; i++) b.frame(1 / 60);
const hanging = b.ledge.phase === LEDGE_HANG && Math.abs(b.ledge.lip.ey - 3.9) < 0.01;

const casts = () => st.b.ledge.casts;
async function measure(w: boolean, s: boolean, d: boolean, window: number, look = false): Promise<{ bytes: number; casts: number; frames: number; clean: boolean; kind: number; cue: number }> {
  st.w = w;
  st.s = s;
  st.d = d;
  st.look = look;
  run(600);
  let best = { bytes: Number.POSITIVE_INFINITY, casts: 0, frames: window, clean: false, kind: st.b.ledge.cueKind, cue: st.b.ledge.cue };
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
    if (scavenges === s0 && y1 - y0 < best.bytes) best = { bytes: y1 - y0, casts: casts() - c0, frames: window, clean: true, kind: st.b.ledge.cueKind, cue: st.b.ledge.cue };
  }
  return best;
}
run(4000);
const still = await measure(false, false, false, 100000);
const up = await measure(true, false, false, 100000);
const down = await measure(false, true, false, 100000);
const back = await measure(false, false, false, 100000);
// W held with the view turned back and forward by turns: the way asked moves every two seconds (an event, the look made again).
st.looked = 0;
const look = await measure(false, false, false, 4800, true);
const looked = st.looked;
console.log(JSON.stringify({ hanging, holding: st.b.ledge.phase === LEDGE_HANG, hop: WAYK_HOP, drop: WAYK_DROP, still, up, down, back, look, looked }));
