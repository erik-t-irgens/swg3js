// Climbing II, the feedback round's own frame (`climb.grabFree` 'share'): a grab under way asks, every frame, whether the hang
// takes the keys yet (`grabFreed`: its share, the move keys, the presses kept, the look-away's view), and nothing is asked; the
// grab's carry is the same frame as today's. Measured on the real Rapier with no collection between, against the same grab's
// frame under 'whole' (today's), the grab held under way (its clip's end put out of reach) so every frame is the check and the
// carry and nothing else. Run twelve at once by `climbFeedbackAlloc.test.ts`; prints one line of JSON. The frame is a function
// of its own reading kept fields, called from a loop kept out of the optimizer (wave 2a's lesson), as `ledgeAllocOwn.ts`'s is.
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import { TestBody, box, ground, makePhysics } from './grappleBody.ts';
import { LedgeIn, LEDGE_MOVE, type LedgeWorld } from '../../../src/player/ledge.ts';
import { Stamina } from '../../../src/anim/locoClass.ts';
import { CLIMB_TUNE, resetClimbTune, tuneClimb } from '../../../src/anim/climbTune.ts';

resetClimbTune();
let scavenges = 0;
new PerformanceObserver((l) => {
  scavenges += l.getEntries().length;
}).observe({ entryTypes: ['gc'] });
const turn = () => new Promise<void>((r) => setImmediate(r));
const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;

// ---- the world: a braced lip 2.4 m up ------------------------------------------------------------------------------------------
const p = await makePhysics();
ground(p, 0);
box(p, [-8, 0, 2], [8, 2.4, 3]);
p.stepOnce();
const world = p.world as unknown as LedgeWorld;

/** The frame's state: fields, so nothing crosses a call. */
class Run {
  b = new TestBody(p);
  li = new LedgeIn();
  stam = new Stamina(100);
  i = 0;
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
  // Nothing asked: no key, the view on the wall (the look-away's threshold asked and not met).
  li.leftHeld = false;
  li.rightHeld = false;
  li.forwardHeld = false;
  li.backHeld = false;
  li.jumpPressed = false;
  li.forwardPressed = false;
  li.crouchPressed = false;
  li.viewYaw = s.b.ledge.heading + ((s.i & 1) === 0 ? 0.2 : -0.2);
  s.i++;
  s.b.ledge.step(world, s.b, li, s.stam);
}
function run(n: number): void {
  for (let k = 0; k < n; k++) frame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(run)');

// Into a grab on the lip: a standing jump at it with W and E held after the jump, to the grab's first frame.
const b = st.b;
b.place(0, 0, 1.2);
b.forward.set(0, 0, 1);
b.right.set(-1, 0, 0);
b.run(60, 0.3);
b.key('KeyW', true);
b.key('Space', true);
b.frame(1 / 60);
b.key('Space', false);
b.key('KeyE', true);
for (let i = 0; i < 240 && !(b.ledge.phase === LEDGE_MOVE && b.ledge.move.kind === 'grab'); i++) b.frame(1 / 60);
b.key('KeyW', false);
b.key('KeyE', false);
const grabbing = b.ledge.phase === LEDGE_MOVE && b.ledge.move.kind === 'grab';
// The grab held under way: its clip's end out of reach, so every frame is the share's check and the carry.
b.ledge.move.T = 1e9;
st.li.heading = b.ledge.heading;

const casts = () => st.b.ledge.casts;
async function measure(rule: 'share' | 'whole', window: number): Promise<{ bytes: number; casts: number; frames: number; clean: boolean }> {
  tuneClimb({ grabFree: rule, grabFreeAt: 0 });
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
const whole = await measure('whole', 100000);
const share = await measure('share', 100000);
console.log(JSON.stringify({ grabbing, still: b.ledge.phase === LEDGE_MOVE && b.ledge.move.kind === 'grab', freed: b.ledge.grabsFreed, rule: CLIMB_TUNE.grabFree, whole, share }));
