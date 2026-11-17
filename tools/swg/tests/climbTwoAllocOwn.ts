// Climbing II, phase 2's own frame, under its new settings (`climb.grab` 'use', steps crossed by hand): the ledges' and the
// wall climb's sense on foot every frame, with the use key up and held, and the hang's step while shimmying back and forth
// across two steps along a lip, on the real Rapier. What it makes is measured with no collection between and what it asks of
// the engine counted: the engine's own answers are its cost. Run twelve at once by `climbTwoAlloc.test.ts`; prints one line
// of JSON. The frame is a function of its own reading kept fields, called from a loop kept out of the optimizer (wave 2a's
// lesson), as `ledgeAllocOwn.ts`'s is.
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import { TestBody, box, ground, makePhysics } from './grappleBody.ts';
import { LedgeIn, LEDGE_HANG, type LedgeWorld } from '../../../src/player/ledge.ts';
import { Stamina } from '../../../src/anim/locoClass.ts';
import { resetClimbTune } from '../../../src/anim/climbTune.ts';

resetClimbTune();
let scavenges = 0;
new PerformanceObserver((l) => {
  scavenges += l.getEntries().length;
}).observe({ entryTypes: ['gc'] });
const turn = () => new Promise<void>((r) => setImmediate(r));
const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;

// ---- the world: a lip 2.6 m up with a block 1 m wide standing 0.3 m over it in its middle (two steps along it) ------------------
const p = await makePhysics();
ground(p, 0);
box(p, [-8, 0, 2], [-2.5, 2.6, 3]);
box(p, [-2.5, 0, 2], [-1.5, 2.9, 3]);
box(p, [-1.5, 0, 2], [8, 2.6, 3]);
p.stepOnce();
const world = p.world as unknown as LedgeWorld;

/** The frame's state: fields, so nothing crosses a call. */
class Run {
  b = new TestBody(p);
  li = new LedgeIn();
  stam = new Stamina(100);
  /** 0 on the ground, 1 in the air in the open; 2 hanging, shimmying by turns. */
  mode = 0;
  /** The use key held (on foot). */
  use = false;
  i = 0;
}
const st = new Run();
st.b.jka.forceLevel = 0;
st.li.scale = 1;
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
    // On foot (the player's `senseLedge` and `senseWall`, every frame): open ground ahead of the body, the use key up or held.
    li.grounded = s.mode === 0;
    li.wasGrounded = s.mode === 0;
    li.forwardHeld = true;
    li.moveX = 0;
    li.moveZ = -1;
    li.heading = Math.PI;
    li.use = s.use;
    li.busy = false;
    li.blocked = false;
    b.pos.x = 0;
    b.pos.y = s.mode === 0 ? 0 : 4;
    b.pos.z = -4;
    b.vel.x = 0;
    b.vel.y = s.mode === 0 ? 0 : -1;
    b.vel.z = 0;
    b.ledge.sense(world, b, li, s.stam);
    b.wall.sense(world, b, li, s.stam);
    return;
  }
  // Hanging: A or D held by turns, two seconds each, across the two steps along the lip.
  const left = ((s.i / 120) | 0) % 2 === 0;
  li.leftHeld = left;
  li.rightHeld = !left;
  li.forwardHeld = false;
  li.moveZ = 0;
  li.use = false;
  s.i++;
  b.ledge.step(world, b, li, s.stam);
}
function run(n: number): void {
  for (let k = 0; k < n; k++) frame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(run)');

const casts = () => st.b.ledge.casts + st.b.wall.casts;
async function measure(mode: number, use: boolean, window: number): Promise<{ bytes: number; casts: number; frames: number; clean: boolean }> {
  st.mode = mode;
  st.use = use;
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
const stand = await measure(0, false, 60000);
const air = await measure(1, false, 60000);
const standUse = await measure(0, true, 7200);
const airUse = await measure(1, true, 7200);
// Into a hang on the raised block's lip: a standing jump at it with W and E held after the jump.
st.mode = 3;
const b = st.b;
b.place(-2, 0, 1.2);
b.forward.set(0, 0, 1);
b.right.set(-1, 0, 0);
b.run(60, 0.3);
b.key('KeyW', true);
b.key('Space', true);
b.frame(1 / 60);
b.key('Space', false);
b.key('KeyE', true);
for (let i = 0; i < 240 && !(b.ledge.phase === LEDGE_HANG); i++) b.frame(1 / 60);
b.key('KeyW', false);
b.key('KeyE', false);
const hanging = b.ledge.phase === LEDGE_HANG;
const top = b.ledge.lip.ey;
st.li.scale = 1;
const shimmy = await measure(2, false, 4800);
// The lip held stood at both heights over the run (the steps crossed): the rail's points are the evidence.
const R = b.ledge.rail;
let lo = Infinity;
let hi = -Infinity;
for (let k = 0; k < R.n; k++) {
  lo = Math.min(lo, R.y[k]);
  hi = Math.max(hi, R.y[k]);
}
console.log(JSON.stringify({ stand, air, standUse, airUse, shimmy, hanging, top, heights: [lo, hi], holding: b.ledge.holding }));
