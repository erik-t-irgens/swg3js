// Climbing II, the feedback round II, maker B's own frames, measured with no collection between, each frame a function of its own
// reading kept fields, called from a loop kept out of the optimizer (wave 2a's lesson): a figure of the game's own rig hanging free
// from free-ladder-1's first rung (tools/swg/tests/climbFigure.ts), and every frame the ledge's hips' sway stepped as a climb feeds
// it (`legsStep` with a free ladder's climb cycle under way: the shimmy legs at its phase and `swayStep`, the body moved along a rung's way), the ledge's limbs handed over (`limbsFor`: the free cue's pull standing the
// figure up, its torso, a free ladder's shimmy legs and the sway handed to the limbs and laid, `LimbPlace.lay`), the limbs placed
// (`LimbPlace.place`) and the clean pose put back (`restore`, as the rig's update does). `FB2L_MODE` 'before' puts the round's
// switches at their other settings and asks none of it (the same frame as phase 4's). `FB2L_SCENE` 'hop' (the fixer's, the
// review's finding) measures a free hop up begun from the cue instead: the body hangs free from free-ladder-1.25's first rung, W
// is held a second (the cue's pull) and Space commits, and then every frame the hop's own clock is set within the carry's window
// (`carryLeave`), so the ledge's step lays the leg kick and `limbsFor` the carried lift's torso, both asked of the one clip in one
// frame (the rig's track cache kept by the clip and the list, `CharacterRig.turnsAt`). Prints one line of JSON. Run twelve at
// once by `climbFb2LedgeAlloc.test.ts`.
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import { figure, figureScale, drawHang } from './climbFigure.ts';

const { climbCourse } = await import('../../../src/anim/climbCourse.ts');
const { climbFb2Before, resetClimbTune, FREE_CUE_PARTS } = await import('../../../src/anim/climbTune.ts');
const { LEDGE_HANG, LEDGE_MOVE, LedgeIn } = await import('../../../src/player/ledge.ts');
const { bodyAt, runUntil, standPiece, tap } = await import('./climbCourseBody.ts');

const BEFORE = process.env.FB2L_MODE === 'before';
const HOP = process.env.FB2L_SCENE === 'hop';
resetClimbTune();
let scavenges = 0;
new PerformanceObserver((l) => {
  scavenges += l.getEntries().length;
}).observe({ entryTypes: ['gc'] });
const turn = () => new Promise<void>((r) => setImmediate(r));
const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;

const s = await standPiece(climbCourse({ extras: true, pieces: [HOP ? 'free-ladder-1.25' : 'free-ladder-1'] }).pieces[0]);
const { b } = bodyAt(s, 'stand', 60);
const F = figure();
b.ledgeScale = figureScale(F);
const draw = b.frame.bind(b);
b.frame = (t: number) => {
  draw(t);
  if (b.ledge.holding) drawHang(b, F, 1 / 60);
};
b.key('KeyE', true);
tap(b, 'Space', 60);
runUntil(b, 60, 2.5, () => b.ledge.phase === LEDGE_HANG);
b.key('KeyE', false);
runUntil(b, 60, 0.5, () => false);
const hanging = b.ledge.phase === LEDGE_HANG;
if (BEFORE) climbFb2Before();
/** The hop scene: the free cue's pull held a second, Space, run on until the hop up carries the cue's lift (`carry`). */
type HopLedge = { heading: number; phase: number; carry: number; carryLeave: number; move: { kind: string; upper: boolean; arc: unknown; time: number } };
const HL = b.ledge as unknown as HopLedge;
let hopped = false;
let carryKept = 0;
let leaveKept = 0.5;
if (HOP && hanging) {
  const h = HL.heading;
  b.forward.set(Math.sin(h), 0, Math.cos(h));
  b.right.set(-Math.cos(h), 0, Math.sin(h));
  b.key('KeyW', true);
  runUntil(b, 60, 1, () => false);
  tap(b, 'Space', 60);
  b.key('KeyW', false);
  runUntil(b, 60, 0.2, () => HL.phase === LEDGE_MOVE && HL.move.upper && HL.carry !== 0);
  hopped = HL.phase === LEDGE_MOVE && HL.move.kind === 'hop' && HL.move.upper && !!HL.move.arc && HL.carry !== 0;
  carryKept = HL.carry;
  leaveKept = HL.carryLeave;
}

/** The frame's state: fields, so nothing crosses a call. */
class Run {
  L = b.ledge as unknown as {
    cueRise: number;
    cueLift: number;
    legId: string;
    legAt: number;
    legW: number;
    steps: number;
    behind: number;
    heading: number;
    offX: number;
    offY: number;
    offZ: number;
    cycSettle: number;
    cycClip: string;
    rigUpper: string;
    upperSeek: number;
    cycDur: number;
    legsStep(b: unknown, i: unknown): void;
    limbsFor(lp: unknown, rig: unknown, toPhys: null): void;
  };
  /** The hop scene's fields (private to the ledge, read and written as the hop's frame has them). */
  H = HL as unknown as { carry: number; liftShare: number; move: { time: number } };
  lp = F.lp;
  rig = F.rig;
  world = b.physics.world;
  i = new LedgeIn();
  q = new Float64Array(4);
  y0 = b.pos.y;
  k = 0;
  laid = 0;
  /** The hop scene: the carry kept at the commit, its window, the kick's clip id; frames that laid the kick and the carried torso. */
  carry = 0.5;
  leave = 0.5;
  kickId = FREE_CUE_PARTS.kick;
  kicks = 0;
  carried = 0;
}
const st = new Run();
st.L.steps = 1;
st.L.behind = 0;
st.i.dt = 1 / 60;
st.carry = carryKept;
st.leave = leaveKept;
function frame(): void {
  const s = st;
  const L = s.L;
  s.k++;
  if (HOP) {
    // The hop's own clock within the carry's window (its torso and lift carried, the kick laid past the hang's ease), the carry
    // kept (`liftOn` lets it go only past the window), the body carried up and down (the sway's feed).
    s.H.move.time = ((s.k & 255) / 256) * s.leave * 0.95;
    s.H.carry = s.carry;
    b.pos.y = s.y0 + ((s.k & 63) < 32 ? (s.k & 31) * 0.01 : (32 - (s.k & 31)) * 0.01);
    L.legsStep(b, s.i);
    if (L.legW > 0 && L.legId === s.kickId) s.kicks++;
  } else if (!BEFORE) {
    // The body carried up and down a rung's way (the sway's feed), the cue's pull standing, the shimmy's legs at a phase.
    b.pos.y = s.y0 + ((s.k & 63) < 32 ? (s.k & 31) * 0.01 : (32 - (s.k & 31)) * 0.01);
    // A free ladder's climb cycle under way (its clip's phase moving), so the ledge's own step lays the shimmy legs and feeds the sway.
    L.cycSettle = 1;
    L.cycClip = 'climb';
    L.rigUpper = 'climb';
    L.upperSeek = (s.k & 127) * 0.01;
    L.cycDur = 1.28;
    L.legsStep(b, s.i);
    L.cueRise = 1;
    L.cueLift = 0.08;
  }
  // The figure lined up on the body as the player's `placeVisual` stands it every frame (the rig's own posing left out: its mixer
  // is the rig's, not the round's), then the hang's limbs.
  // (Written into the objects' own fields and through kept arrays: the harness's own frame hands no number across a call either.)
  const h = s.L.heading;
  const c = Math.cos(h);
  const sn = Math.sin(h);
  const G = F.group.position;
  G.x = b.pos.x;
  G.y = b.pos.y;
  G.z = b.pos.z;
  const Q = s.q;
  Q[0] = 0;
  Q[1] = Math.sin(h / 2);
  Q[2] = 0;
  Q[3] = Math.cos(h / 2);
  F.group.quaternion.fromArray(Q, 0);
  const R = F.root.position;
  R.x = s.L.offX * c - s.L.offZ * sn;
  R.y = s.L.offY;
  R.z = s.L.offX * sn + s.L.offZ * c;
  Q[1] = 0;
  Q[3] = 1;
  F.root.quaternion.fromArray(Q, 0);
  F.group.updateMatrixWorld(true);
  L.limbsFor(s.lp, s.rig, null);
  if (HOP && s.H.liftShare > 0) s.carried++;
  s.lp.place(s.rig as never, s.world as never, null);
  if (s.lp.legsLaid) s.laid++;
  s.lp.restore();
}
function frames(n: number): void {
  for (let k = 0; k < n; k++) frame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(frames)');

interface Meas {
  bytes: number;
  frames: number;
  clean: boolean;
}
async function measure(window: number): Promise<Meas> {
  frames(4000);
  let best: Meas = { bytes: Number.POSITIVE_INFINITY, frames: window, clean: false };
  for (let tries = 0; tries < 4; tries++) {
    frames(240);
    // (Wall time for the optimising compiler, on a thread of its own, as ledgeAllocOwn.ts waits.)
    await new Promise<void>((r) => setTimeout(r, 25));
    globalThis.gc!({ type: 'minor' } as never);
    await turn();
    await turn();
    const s0 = scavenges;
    const y0 = young();
    frames(window);
    const y1 = young();
    await turn();
    await turn();
    if (scavenges === s0 && y1 - y0 < best.bytes) best = { bytes: y1 - y0, frames: window, clean: true };
  }
  return best;
}
const meas = await measure(100000);
console.log(JSON.stringify({ before: BEFORE, hop: HOP, hanging, hopped, laid: st.laid, kicks: st.kicks, carried: st.carried, meas }));
