// The rope chain round, maker A (items 1 and 2): the chain itself (src/player/ropeChain.ts), driven as the game drives it (the
// physics' steps a frame worked out from an accumulator exactly as `Physics.stepsAhead` does, then `RopeChains.frame`), on the very
// `HangingRope` the game stands, with no body at all.
//  - Its constants are the game's: its step the physics' `FIXED_DT`, its query flags the stairs' `STILL_FLAGS`.
//  - Under 'straight' nothing is made or stepped (a frame lets every chain go and lays nothing).
//  - Stepped on the physics' own steps, a free rope's chain is the same to the bit at 30, 60, 144 and 240 frames a second at every
//    whole second; a held rope's (its pin on the swing's grip, the swing scripted on the steps and recorded step by step as the
//    swing records it) the same to the bit at 30, 60, 144 and 240 (the fixer: each step pinned on the swing's very step).
//  - Play stood still (no update writes the steps, the frame's remainder moves on), the chain is laid at the very points the last
//    frame laid (the fixer: the review found it laid between its last two steps at the moving remainder, up to 30 mm a frame).
//  - Let alone it settles to a vertical line under its anchor; in a steady 10 m/s wind it leans as `ropeWind` says (atan of
//    ropeWind times the wind's speed over gravity); over a ground it never goes under the ground and its tail lies there.
//  - Held, the drawn line runs from the anchor and passes through both drawn hands exactly (the upper first), the span above holds
//    the swing's length, and climbing moves the pin along the chain; let go, the tail swings on.
//  - The points slider lays it again at the new count, its length kept; nothing of a frame reads anything but its own arrays.
//
// Run: node tools/swg/tests/climbRopeChain.test.ts
import assert from 'node:assert/strict';
import { FIXED_DT } from '../../../src/core/physics.ts';
import { STILL_FLAGS } from '../../../src/player/stairSense.ts';
import { CLIMB_TUNE, climbRopeLookBefore, resetClimbTune, tuneClimb } from '../../../src/anim/climbTune.ts';
import { HangingRope, SWING_REC } from '../../../src/player/hangingRope.ts';
import { CHAIN_FLAGS, CHAIN_RADIUS, CHAIN_STEP, RopeChains, type ChainAsk } from '../../../src/player/ropeChain.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

ok(CHAIN_STEP === FIXED_DT, `the chain's step is the physics' own (${CHAIN_STEP})`);
ok(CHAIN_FLAGS === STILL_FLAGS, `its queries ask for what stands still as the climbing's do (${CHAIN_FLAGS})`);

/** A frame clock as the physics' accumulator spends it (`Physics.stepsAhead`, then `step`). */
class Clock {
  acc = 0;
  steps(dt: number): number {
    let a = this.acc + dt;
    let n = 0;
    while (a >= FIXED_DT && n < 4) {
      a -= FIXED_DT;
      n++;
    }
    this.acc = n === 4 ? 0 : a;
    return n;
  }
}

/** A swing scripted on the physics' steps (the rope held: its angle, its speed, the hands' way down and the stretch, by the step). */
function swingAt(r: HangingRope, k: number, climb: boolean): void {
  const t = k * FIXED_DT;
  r.th = 0.6 * Math.sin(1.3 * t);
  r.om = 0.6 * 1.3 * Math.cos(1.3 * t);
  r.thDraw = r.th;
  r.gripS = climb ? Math.max(0.5, 3 - 0.4 * t) : 3;
  r.e = 0.05;
  r.held = true;
  r.lay();
}

/**
 * The fixer: the swing's frame of `n` steps from step `k` on, as src/player/ropeSwing.ts records it for the chain (its state before
 * the frame's steps in slot 0 and after each in the next: `HangingRope.swingRec`), the rope left at the last.
 */
function swingFrame(r: HangingRope, k: number, n: number, climb: boolean): void {
  for (let i = 0; i <= n; i++) {
    swingAt(r, k + i, climb);
    const o = SWING_REC * i;
    r.swingRec[o] = r.th;
    r.swingRec[o + 1] = r.om;
    r.swingRec[o + 2] = r.gripS;
    r.swingRec[o + 3] = r.e;
    r.swingRec[o + 4] = r.fx;
    r.swingRec[o + 5] = r.fz;
  }
  r.swingSteps = n;
}

/** One run: a rope from (0, 10, 0), `seconds` long at `fps`, the chain's points at each whole second. */
function run(fps: number, seconds: number, how: 'free' | 'held' | 'climb' | 'wind', ground: number | null = null): { at: Float64Array[]; C: RopeChains; r: HangingRope } {
  const r = new HangingRope('test', 0, 10, 0, 8);
  const C = new RopeChains();
  if (ground !== null) C.ground = { at: (q: ChainAsk) => ((q.h = ground), true) };
  if (how === 'free') {
    r.th = 0.4;
    r.om = 0;
    r.thDraw = 0.4;
    r.lay();
  }
  if (how === 'wind') {
    C.wind.x = 1;
    C.wind.z = 0;
    C.wind.speed = 10;
  }
  // (A held rope's give already in it before the first frame: the frames carry the swing's state, never its give's jump at a grab.)
  if (how === 'held' || how === 'climb') r.e = 0.05;
  const clock = new Clock();
  const at: Float64Array[] = [];
  let k = 0;
  // The chain laid before the first frame (as the course's rope is, at rest), then the frames.
  C.steps = 0;
  C.frame([r]);
  const frames = Math.round(seconds * fps);
  let total = 0;
  for (let f = 1; f <= frames; f++) {
    const n = clock.steps(1 / fps);
    // The swing steps its `n` steps (as the player's update does, recording each for the chain), the chain is told how many and
    // steps after it.
    if (how === 'held' || how === 'climb') {
      swingFrame(r, k, n, how === 'climb');
      k += n;
    }
    C.steps = n;
    C.behind = clock.acc;
    C.frame([r]);
    // (Read at each whole second of the physics' own steps: a frame clock's sum of 1/144 drifts a step off a whole second.)
    const was = total;
    total += n;
    if (n > 0 && Math.floor(total / 60) > Math.floor(was / 60) && total % 60 === 0) {
      const c = r.chain!;
      const p = new Float64Array(3 * c.n);
      for (let i = 0; i < c.n; i++) {
        p[3 * i] = c.px[i];
        p[3 * i + 1] = c.py[i];
        p[3 * i + 2] = c.pz[i];
      }
      at.push(p);
    }
  }
  return { at, C, r };
}

const RATES = [30, 60, 144, 240];
/** The largest difference between two runs' points at the whole seconds both reached (a frame clock may fall a step short of the last). */
const most = (a: Float64Array[], b: Float64Array[]): number => {
  let m = 0;
  const n = Math.min(a.length, b.length);
  if (n < a.length - 1 || n < b.length - 1 || n === 0) return Infinity;
  for (let s = 0; s < n; s++) for (let i = 0; i < a[s].length; i++) m = Math.max(m, Math.abs(a[s][i] - b[s][i]));
  return m;
};

// 'straight': nothing made, nothing stepped.
resetClimbTune();
climbRopeLookBefore();
{
  const r = new HangingRope('test', 0, 10, 0, 8);
  const C = new RopeChains();
  C.steps = 2;
  C.frame([r]);
  ok(r.chain === null && C.steps === 0 && C.frames === 0, "under 'straight' a frame makes no chain and steps nothing (the rope is drawn as phase 5 drew it)");
}

resetClimbTune();
// The free rope: the same to the bit at every rate, every whole second.
{
  const runs = RATES.map((fps) => run(fps, 30, 'free'));
  const d = runs.map((x) => most(runs[1].at, x.at));
  ok(d.every((v) => v === 0), `a free rope's chain is the same to the bit at 30, 60, 144 and 240 frames a second at every whole second of 30 s (largest difference ${Math.max(...d)} m)`);
  const c = runs[1].r.chain!;
  let off = 0;
  for (let i = 1; i < c.n; i++) off = Math.max(off, Math.hypot(c.px[i], c.pz[i]));
  const end = c.py[c.n - 1];
  ok(off < 0.01, `let go of at 0.4 rad and left alone, it settles to a vertical line under its anchor within 30 s (every point within ${off.toFixed(4)} m of the vertical)`);
  ok(Math.abs(10 - end - 8) < 0.03, `... its 8 m hanging to ${(10 - end).toFixed(3)} m under the anchor (its links held to their length within a few centimetres in all at the shipped substeps)`);
}
// The held rope: the same to the bit at every rate (the fixer: each of the chain's steps pinned on that very step of the swing's,
// so 30, two steps a frame, is the same to the bit too; the first cut pinned a step on a curve through the frame's two ends).
{
  const runs = RATES.map((fps) => run(fps, 10, 'held'));
  const d = runs.map((x) => most(runs[1].at, x.at));
  ok(d[0] === 0 && d[2] === 0 && d[3] === 0, `a held rope's chain (its pin on a scripted swing, its record written as the swing writes it) is the same to the bit at 30, 60, 144 and 240 frames a second at every whole second (${d[0]}, ${d[2]}, ${d[3]})`);
}
// The held rope: the span above the hands holds the swing's length, the drawn line passes through the hands, and climbing moves the pin.
{
  const { C, r } = run(60, 6, 'climb');
  const c = r.chain!;
  const g = r.gripS + r.e;
  ok(c.pinOn && Math.abs(c.pinS - g) < 1e-12, `climbing, the pin moves along the chain with the hands (${c.pinS.toFixed(3)} m down it, the hands ${g.toFixed(3)})`);
  const span = Math.hypot(c.pinX - r.ax, c.pinY - r.ay, c.pinZ - r.az);
  ok(Math.abs(span - c.pinS) < 1e-9, `the span above the hands is the swing's own length: the anchor to the pin ${span.toFixed(4)} m, its place along the chain ${c.pinS.toFixed(4)} m`);
  // Two drawn hands of the caller's, one a little above the grip and off the line, one under it.
  const sn = Math.sin(r.thDraw);
  const gx = r.ax + g * sn * r.fx;
  const gy = r.ay - g * Math.cos(r.thDraw);
  const gz = r.az + g * sn * r.fz;
  C.hand[0] = gx + 0.03;
  C.hand[1] = gy - 0.12;
  C.hand[2] = gz;
  C.hand[3] = gx - 0.02;
  C.hand[4] = gy + 0.1;
  C.hand[5] = gz + 0.01;
  C.hands = 2;
  C.handsRope = r;
  C.steps = 0;
  C.frame([r]);
  const A = c.gripA;
  const B = c.gripB;
  const dist = (m: number, x: number, y: number, z: number) => Math.hypot(c.draw[3 * m] - x, c.draw[3 * m + 1] - y, c.draw[3 * m + 2] - z);
  ok(A >= 1 && B === A + 1, `the drawn line takes both hands as points of its own, in order down the rope (at ${A} and ${B} of ${c.drawCount})`);
  ok(dist(A, gx - 0.02, gy + 0.1, gz + 0.01) === 0 && dist(B, gx + 0.03, gy - 0.12, gz) === 0, 'the drawn line passes through both hands exactly, the upper first');
  ok(dist(0, r.ax, r.ay, r.az) === 0, 'and begins at the anchor');
  ok(C.hands === 0 && C.handsRope === null, "and the frame puts the caller's hands down (the next frame names them again, or the grip stands for both)");
}
// Let go: the tail swings on (its points keep the speed the pin gave them).
{
  const r = new HangingRope('test', 0, 10, 0, 8);
  const C = new RopeChains();
  const clock = new Clock();
  C.steps = 0;
  C.frame([r]);
  let k = 0;
  for (let f = 0; f < 240; f++) {
    const n = clock.steps(1 / 60);
    swingFrame(r, k, n, false);
    k += n;
    C.steps = n;
    C.behind = clock.acc;
    C.frame([r]);
  }
  // (The fixer: play stood still, the remainder moving on with no update writing the steps: laid at the very points.)
  {
    const c = r.chain!;
    const was = Array.from(c.draw.subarray(0, 3 * c.drawCount));
    let moved = 0;
    for (let f = 1; f < 40; f++) {
      C.behind = (f % 7) / 7 / 60;
      C.frame([r]);
      if (c.draw.subarray(0, was.length).some((v, i) => v !== was[i])) moved++;
    }
    ok(moved === 0 && C.drawnBehind === clock.acc, `held mid-swing, play stood still (the remainder moving on, no update writing the steps): the chain is laid at the very points the last frame laid (${moved} frames moved)`);
  }
  r.held = false;
  const c = r.chain!;
  const e = c.n - 1;
  const v0 = Math.hypot(c.px[e] - c.qx[e], c.py[e] - c.qy[e], c.pz[e] - c.qz[e]);
  let moved = 0;
  const x0 = c.px[e];
  const z0 = c.pz[e];
  for (let f = 0; f < 30; f++) {
    C.steps = clock.steps(1 / 60);
    C.frame([r]);
    moved = Math.max(moved, Math.hypot(c.px[e] - x0, c.pz[e] - z0));
  }
  ok(!c.pinOn && v0 > 0 && moved > 0.05, `let go mid-swing, the pin is let go and the tail swings on with the speed it had (its end ${moved.toFixed(2)} m on in half a second)`);
}
// The wind: a steady 10 m/s wind leans a free rope by the drag's own angle.
{
  const { r } = run(60, 30, 'wind');
  const c = r.chain!;
  const e = c.n - 1;
  const lean = (Math.atan2(c.px[e] - r.ax, r.ay - c.py[e]) * 180) / Math.PI;
  const want = (Math.atan2(CLIMB_TUNE.ropeWind * 10, CLIMB_TUNE.swingGravity) * 180) / Math.PI;
  ok(Math.abs(lean - want) < 2, `a steady 10 m/s wind leans a free rope ${lean.toFixed(1)} degrees, as ropeWind ${CLIMB_TUNE.ropeWind} says (${want.toFixed(1)}), its way the wind's`);
}
// The ground: a rope longer than the drop lies on it, never under it.
{
  const r0 = run(60, 15, 'free', 3);
  const c = r0.r.chain!;
  let low = Infinity;
  let lying = 0;
  for (let i = 0; i < c.n; i++) {
    low = Math.min(low, c.py[i]);
    if (c.touch[i]) lying++;
  }
  ok(low >= 3 + CHAIN_RADIUS - 1e-9 && lying >= 2, `over a ground 7 m under its anchor an 8 m rope lies on it and never under it (its lowest point ${(low - 3).toFixed(4)} m over the ground, ${lying} points lying)`);
}
// The points slider: laid again at the new count, its length kept.
{
  const { C, r } = run(60, 3, 'free');
  tuneClimb({ ropePoints: 40 });
  C.steps = 0;
  C.frame([r]);
  const c = r.chain!;
  let L = 0;
  for (let i = 0; i + 1 < c.n; i++) L += Math.hypot(c.px[i + 1] - c.px[i], c.py[i + 1] - c.py[i], c.pz[i + 1] - c.pz[i]);
  ok(c.n === 40 && Math.abs(L - c.len) < 0.05, `the points slider moved to 40 lays the chain again at 40 points, its length kept (${L.toFixed(3)} m of ${c.len.toFixed(3)})`);
}
resetClimbTune();
console.log(`climbRopeChain: ${checks} checks passed`);
