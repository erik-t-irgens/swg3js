// The interactive water's own numbers, as plain node checks.
//
// The first cut of this test had 62 green checks and still let two false claims through, because
// every one of them restated the arithmetic it was checking. So this one **steps the recurrence
// waterSim.ts actually runs** and measures the field: where a disturbance gets to, how fast a
// packet's energy travels, how long a mode takes to swing and when its envelope halves. Every
// claim about how the water behaves is checked against that, not against a formula.
//
// What it pins:
//   - the wave term is a real speed and no longer rides on the quality setting (the bug it was
//     written for: a stored C² meant 1.90 m/s on the lowest detail against 0.95 on the highest);
//   - the damping is a spring as well as friction, so a ripple carries at `carryMs` and not at the
//     coupling's own `speedMs`, and the two differ by more than a factor of two;
//   - the per-step amplitude decay is √damp, not damp, so every half-life is twice what the first
//     cut said it was.
//
// Nothing here is read from the game's own files and no browser is needed. Every number checked is
// ours: there is no ripple simulation in the archives to be faithful to.
import assert from 'node:assert/strict';
import {
  courantOf, dampingFor, deepWaterWavelength, fastestRipple, GRAVITY, maxWaveSpeed, realWavePeriod,
  realWaveSpeed, reliefFor, RIPPLE_DAMP_FLOOR, RIPPLE_DAMP_SPAN, RIPPLE_HELP, RIPPLE_RELIEF_BASE,
  RIPPLE_STABILITY, rippleDecayPerStep, rippleGroupSpeed, rippleHalfLife, ripplePeriod,
  ripplePhaseSpeed, rippleSwing, ringPeriodSeconds, shallowWaterDepth, waveSpeedOf, waveTerm,
} from '../../../src/world/rippleMath.ts';
import {
  configureWaterSim, WATER_SIM_DETAIL, WATER_SIM_DRAFT, WATER_SIM_IMPACT, WATER_SIM_SPEED,
  waterSimDebug, type WaterSimSettings,
} from '../../../src/world/waterSim.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => { assert.ok(cond, msg); passed++; console.log(`ok   ${msg}`); };
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;
const within = (a: number, b: number, share: number) => Math.abs(a - b) <= share * Math.abs(b);

/** The step's own rate, which waterSim.ts fixes at 120 a second whatever the frame rate. */
const DT = 1 / 120;
/** The raw (c·dt/dx)² the speed knob used to hold, before it was a speed. */
const OLD_TERM = 0.001;
/** The default preset's texel, and the damping the default persistence eases to. */
const TEXEL = 0.375;
const DAMP = dampingFor(0.85);

// --- the field itself, stepped ------------------------------------------------------------------

/**
 * The exact recurrence of `waterSim.ts`'s step fragment, on a 1D ring:
 *   h(t+1) = (2·h(t) − h(t−1) + C²·∇²h) · damp
 * The step's laplacian is the five-point one, which for a wave running along an axis reduces
 * exactly to this three-point one, so this is the field's own arithmetic rather than a model of it.
 * Released from rest means h(t−1) = h(t), which is how every splat and poke enters the field.
 */
function ring(n: number, term: number, damp: number, seed: (i: number) => number, prev?: (i: number) => number) {
  let h = new Float64Array(n);
  let hp = new Float64Array(n);
  let hn = new Float64Array(n);
  for (let i = 0; i < n; i++) { h[i] = seed(i); hp[i] = prev ? prev(i) : h[i]; }
  return {
    now: (): Float64Array => h,
    step(): void {
      for (let i = 0; i < n; i++) {
        const lap = h[(i + n - 1) % n] + h[(i + 1) % n] - 2 * h[i];
        hn[i] = (2 * h[i] - hp[i] + term * lap) * damp;
      }
      const t = hp; hp = h; h = hn; hn = t;
    },
  };
}

/** Mean |x| weighted by |h|, in metres from the release point: how far the disturbance has got. */
function spread(h: Float64Array, texelM: number): number {
  const mid = h.length >> 1;
  let num = 0;
  let den = 0;
  for (let i = 0; i < h.length; i++) {
    const a = Math.abs(h[i]);
    num += a * Math.abs(i - mid) * texelM;
    den += a;
  }
  return den > 0 ? num / den : 0;
}

/** How far a disturbance released from rest has spread after this many seconds. */
function spreadAfter(term: number, damp: number, seconds: number, sigmaTexels = 2, n = 4096): number {
  const mid = n >> 1;
  const f = ring(n, term, damp, (i) => {
    const d = i - mid;
    return Math.exp(-(d * d) / (2 * sigmaTexels * sigmaTexels));
  });
  for (let s = 0; s < Math.round(seconds / DT); s++) f.step();
  return spread(f.now(), TEXEL);
}

/**
 * Successive peak heights of one mode at the cell where it starts at a crest. The ring is sized to
 * a whole number of wavelengths: a cosine that does not close on itself has a step in it at the
 * wrap, and that step is a spray of other modes that swings at its own rate and spoils the reading.
 * `Infinity` is the flat field, the K = 0 mode with no coupling in it at all.
 */
function peaksOf(term: number, damp: number, waveTexels: number, seconds: number) {
  const flat = !Number.isFinite(waveTexels) || waveTexels <= 0;
  const n = flat ? 64 : Math.round(waveTexels) * Math.max(1, Math.round(1024 / waveTexels));
  const f = ring(n, term, damp, flat ? () => 1 : (i) => Math.cos((2 * Math.PI * i) / waveTexels));
  const out: { t: number; a: number }[] = [];
  let prev = Math.abs(f.now()[0]);
  let prev2 = 0;
  for (let s = 0; s < Math.round(seconds / DT); s++) {
    f.step();
    const a = Math.abs(f.now()[0]);
    if (prev > prev2 && prev > a) out.push({ t: s * DT, a: prev });
    prev2 = prev;
    prev = a;
  }
  return out;
}

/** The envelope half-life of one mode, fitted to the log of its successive peaks. */
function measuredHalfLife(term: number, damp: number, waveTexels: number, seconds = 30): number {
  const p = peaksOf(term, damp, waveTexels, seconds);
  if (p.length < 3) return Number.POSITIVE_INFINITY;
  let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
  for (const q of p) { const y = Math.log(q.a); sx += q.t; sy += y; sxx += q.t * q.t; sxy += q.t * y; }
  const slope = (p.length * sxy - sx * sy) / (p.length * sxx - sx * sx);
  return Math.log(0.5) / slope;
}

/** The swing period of one mode, from the gaps between its peaks. */
function measuredPeriod(term: number, damp: number, waveTexels: number, seconds = 12): number {
  const p = peaksOf(term, damp, waveTexels, seconds);
  if (p.length < 3) return Number.POSITIVE_INFINITY;
  // Peaks of |h| come twice a swing, so the gap between them is half a period.
  return 2 * ((p[p.length - 1].t - p[0].t) / (p.length - 1));
}

/**
 * How fast a narrow-band packet at this wavelength carries its energy, measured.
 *
 * The packet is launched one way rather than released from rest, by setting the previous state to
 * the same wave a step earlier in phase. Released from rest it would split into two packets going
 * opposite ways, and at these speeds they overlap for the whole run — their combined middle barely
 * moves and the measurement comes out sevenfold low, which is a good way to measure nothing.
 * A 12 m envelope is narrow enough in wavelength that one group speed governs the whole packet.
 */
function measuredCarry(term: number, damp: number, waveM: number): number {
  const n = 16384;
  const mid = n >> 1;
  const sigma = 12 / TEXEL;
  const k = (2 * Math.PI) / waveM;
  const w = rippleSwing(damp, term, waveM, TEXEL, DT);
  const env = (i: number): number => Math.exp(-((i - mid) * (i - mid)) / (2 * sigma * sigma));
  const f = ring(n, term, damp,
    (i) => env(i) * Math.cos(k * (i - mid) * TEXEL),
    (i) => env(i) * Math.cos(k * (i - mid) * TEXEL + w * DT));
  // Weighted by h², which is where the energy is, and signed, since the packet goes one way.
  const middle = (): number => {
    const h = f.now();
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) { const a = h[i] * h[i]; num += a * (i - mid) * TEXEL; den += a; }
    return den > 0 ? num / den : 0;
  };
  const run = (seconds: number): void => { for (let s = 0; s < Math.round(seconds / DT); s++) f.step(); };
  run(2);
  const a = middle();
  run(6);
  return (middle() - a) / 6;
}

// --- the presets, and the texel each one works out to ------------------------------------------

{
  const keys = Object.keys(WATER_SIM_DETAIL).map(Number).sort((a, b) => a - b);
  ok(keys.join(',') === '256,512,768,1024', `four detail presets, keyed by grid (${keys.join(', ')})`);
  const texels = keys.map((k) => WATER_SIM_DETAIL[k].window / WATER_SIM_DETAIL[k].grid);
  ok(near(texels[0], 0.5, 1e-9) && near(texels[1], TEXEL, 1e-9) && near(texels[3], 0.25, 1e-9),
    `their texels are 50, 37.5, 29.2 and 25 cm (${texels.map((t) => (t * 100).toFixed(1)).join(', ')})`);
  ok(texels.every((t, i) => i === 0 || t < texels[i - 1]), 'a higher setting is always a finer texel');
  ok(keys.every((k, i) => i === 0 || WATER_SIM_DETAIL[k].window > WATER_SIM_DETAIL[keys[i - 1]].window),
    'and always a wider window, so the knob is monotone in both');
}

// --- what the old stored term really was, preset by preset -------------------------------------

{
  const speeds = [0.5, TEXEL, 224 / 768, 0.25].map((t) => waveSpeedOf(OLD_TERM, t, DT));
  ok(near(speeds[0], 1.897, 5e-4) && near(speeds[1], 1.423, 5e-4) && near(speeds[2], 1.107, 5e-4) && near(speeds[3], 0.949, 5e-4),
    `a stored ${OLD_TERM} was 1.90, 1.42, 1.11 and 0.95 m/s across the four presets (${speeds.map((s) => s.toFixed(3)).join(', ')})`);
  ok(speeds[0] / speeds[3] > 1.9, 'the lowest detail ran the water twice as fast as the highest, which is the bug');
}

// --- the speed, and the term derived from it ---------------------------------------------------

{
  ok(near(waveTerm(WATER_SIM_SPEED.value, TEXEL, DT), OLD_TERM, 1e-6),
    `the default speed ${WATER_SIM_SPEED.value} m/s reproduces the default detail's old term (${waveTerm(WATER_SIM_SPEED.value, TEXEL, DT).toFixed(8)})`);
  for (const key of Object.keys(WATER_SIM_DETAIL).map(Number)) {
    const p = WATER_SIM_DETAIL[key];
    const t = p.window / p.grid;
    const back = waveSpeedOf(waveTerm(WATER_SIM_SPEED.value, t, DT), t, DT);
    ok(near(back, WATER_SIM_SPEED.value, 1e-9), `grid ${key} carries the same ${back.toFixed(3)} m/s`);
  }
  ok(near(courantOf(1.423, TEXEL, DT), 0.031622, 1e-6),
    `at the tuned speed a wave crosses ${courantOf(1.423, TEXEL, DT).toFixed(5)} of a texel in one step`);
  ok(courantOf(2, 0, DT) === 0 && courantOf(2, 0.5, 0) === 0 && courantOf(-5, 0.5, DT) === 0,
    'a zero texel, a zero step and a speed below nothing each answer 0 rather than a NaN');
}

// --- the wave term really is a speed: step it undamped and watch where it gets to ---------------

{
  // With no damping at all the scheme is the textbook wave equation, and the disturbance it
  // spreads should travel at exactly the speed the knob asks for. This is the check that says the
  // unit conversion is right; the ones below say the damping then takes most of it away.
  const term = waveTerm(1.423, TEXEL, DT);
  for (const t of [2, 5, 10]) {
    const got = spreadAfter(term, 1, t) / t;
    ok(within(got, 1.423, 0.03), `undamped, a disturbance spreads at ${got.toFixed(3)} m/s over ${t} s, which is the 1.423 asked for`);
  }
  // And a preset with a different texel, derived from the same speed, travels at the same rate.
  const coarse = waveTerm(1.423, 0.5, DT);
  const n = 4096;
  const mid = n >> 1;
  const f = ring(n, coarse, 1, (i) => Math.exp(-((i - mid) * (i - mid)) / (2 * 2 * 2)));
  for (let s = 0; s < 600; s++) f.step();
  const got = spread(f.now(), 0.5) / 5;
  ok(within(got, 1.423, 0.03), `and on a 50 cm texel it spreads at ${got.toFixed(3)} m/s, the same speed on a different grid`);
}

// --- the damping is a spring, not only friction -------------------------------------------------

{
  const term = waveTerm(1.423, TEXEL, DT);
  const measured = [2, 5, 10].map((t) => spreadAfter(term, DAMP, t) / t);
  ok(measured.every((m) => m < 0.45 * 1.423),
    `with the tuned damping the same disturbance spreads at ${measured.map((m) => m.toFixed(3)).join(', ')} m/s, nothing like the 1.423 the coupling is set to`);
  ok(spreadAfter(term, 1, 5) / spreadAfter(term, DAMP, 5) > 3,
    'the undamped field carries it more than three times as far in five seconds, which is the whole of the claim that the waves travel at the coupling speed');
  // Why: writing damp as 1 − e, the step gains a −e·h restoring term, and e is the bigger of the
  // two at every wavelength a player can see.
  const e = 1 - DAMP;
  const biggestCoupling = term * 4; // C²·K, K at the two-texel limit
  ok(near(e, 0.002675, 1e-6) && e > biggestCoupling / 2,
    `the spring term is ${e.toFixed(6)} against a coupling that reaches ${biggestCoupling.toFixed(6)} only at the two-texel limit`);
}

// --- what a ripple really carries at, measured against the arithmetic ---------------------------

{
  const term = waveTerm(1.423, TEXEL, DT);
  const carry = fastestRipple(DAMP, term, TEXEL, DT);
  ok(within(carry.speedMs, 0.674, 0.01) && within(carry.waveM, 1.75, 0.05),
    `the fastest a ripple carries is ${carry.speedMs.toFixed(3)} m/s, at a wavelength of ${carry.waveM.toFixed(2)} m`);
  ok(carry.speedMs < 1.423 / 2, 'which is under half the coupling speed, so quoting the coupling speed to the owner overstates it twofold');
  // The group speed is what the eye follows, and a stepped packet agrees with it.
  for (const waveM of [1.75, 4, 8]) {
    const want = rippleGroupSpeed(DAMP, term, waveM, TEXEL, DT);
    const got = measuredCarry(term, DAMP, waveM);
    ok(within(got, want, 0.10),
      `a ${waveM} m packet carries at a measured ${got.toFixed(3)} m/s against the predicted ${want.toFixed(3)}`);
  }
  // The phase speed runs away with the wavelength, which is why it is no answer at all.
  const slow = ripplePhaseSpeed(DAMP, term, 1.5, TEXEL, DT);
  const fast = ripplePhaseSpeed(DAMP, term, 37.5, TEXEL, DT);
  ok(fast > 10 * slow && fast > 30,
    `a crest of a 37.5 m wave slides at ${fast.toFixed(1)} m/s against ${slow.toFixed(1)} for a 1.5 m one, which is a pattern moving and no energy with it`);
  ok(rippleGroupSpeed(DAMP, term, 37.5, TEXEL, DT) < 0.1,
    'while its energy goes almost nowhere, which is the dispersion the first cut of this pass denied');
  ok(rippleGroupSpeed(0, term, 4, TEXEL, DT) === 0 && rippleGroupSpeed(DAMP, term, 4, 0, DT) === 0,
    'and a dead field or a zero texel answers 0 rather than a NaN');
}

// --- how fast the surface swings, measured ------------------------------------------------------

{
  const term = waveTerm(1.423, TEXEL, DT);
  for (const waveTexels of [8, 16, 100]) {
    const waveM = waveTexels * TEXEL;
    const want = ripplePeriod(DAMP, term, waveM, TEXEL, DT);
    const got = measuredPeriod(term, DAMP, waveTexels);
    ok(within(got, want, 0.02),
      `a ${waveM.toFixed(2)} m wave swings every ${got.toFixed(3)} s measured against ${want.toFixed(3)} predicted`);
  }
  const ringS = ringPeriodSeconds(DAMP, DT);
  ok(within(ringS, 1.012, 0.01), `the slowest the surface can swing is ${ringS.toFixed(3)} s, set by the damping alone`);
  // The whole window bobbing together: no coupling in it at all, so only the spring is left.
  const flat = measuredPeriod(term, DAMP, Number.POSITIVE_INFINITY, 6);
  ok(within(flat, ringS, 0.03), `and a field with no shape in it measures ${flat.toFixed(3)} s, the same thing`);
  ok(ringPeriodSeconds(1, DT) === Number.POSITIVE_INFINITY && ringPeriodSeconds(0.9, 0) === Number.POSITIVE_INFINITY,
    'a damping of 1 and a zero step each never come round at all');
}

// --- the detail setting no longer changes how the water behaves ---------------------------------

// The claim is about a wave of a **given size**, which is what the bug was about: with C² stored
// raw, a 6 m wave felt four times as much coupling on the coarsest grid as on the finest.

{
  const waveM = 6;
  const texels = [0.5, TEXEL, 0.25];
  const term = (t: number) => waveTerm(1.423, t, DT);
  /** C²·K, the coupling one wave of this length actually feels on a grid of this texel. */
  const felt = (c2: number, t: number) => c2 * 2 * (1 - Math.cos((2 * Math.PI * t) / waveM));

  const before = texels.map((t) => felt(OLD_TERM, t));
  const after = texels.map((t) => felt(term(t), t));
  ok(before[0] / before[2] > 3.5,
    `a stored C² gave a ${waveM} m wave ${(before[0] / before[2]).toFixed(1)}× the coupling on the coarsest grid that it had on the finest`);
  ok(within(after[0], after[2], 0.02) && within(after[1], after[2], 0.02),
    `derived from a speed it feels the same coupling on all three (${after.map((v) => v.toExponential(3)).join(', ')})`);

  const swings = texels.map((t) => ripplePeriod(DAMP, term(t), waveM, t, DT));
  ok(within(swings[0], swings[2], 0.005) && within(swings[1], swings[2], 0.005),
    `so it swings every ${swings.map((s) => s.toFixed(4)).join(', ')} s on the coarsest, the default and the finest grid`);
  const carries = texels.map((t) => rippleGroupSpeed(DAMP, term(t), waveM, t, DT));
  ok(within(carries[0], carries[2], 0.05),
    `and carries at ${carries.map((c) => c.toFixed(3)).join(', ')} m/s across them, a few per cent apart rather than fourfold`);
  // Measured, not merely predicted: step the same physical wave on two different grids.
  const a = measuredPeriod(term(0.5), DAMP, waveM / 0.5);
  const b = measuredPeriod(term(0.25), DAMP, waveM / 0.25);
  ok(within(a, b, 0.02), `stepped on both grids it measures ${a.toFixed(3)} s and ${b.toFixed(3)} s`);

  // What the detail setting does still change, honestly: the *finest* ripple a grid can hold. The
  // fastest-carrying wave is only a handful of texels long, so a finer grid resolves a smaller,
  // quicker one. That is a resolution difference and not the old bug, where one and the same wave
  // moved at two speeds.
  const best = texels.map((t) => fastestRipple(DAMP, term(t), t, DT));
  ok(best[0].speedMs < best[1].speedMs && best[1].speedMs < best[2].speedMs,
    `the fastest ripple each grid can hold still rises with the grid: ${best.map((b2) => b2.speedMs.toFixed(3)).join(', ')} m/s`);
  ok(best[2].speedMs / best[0].speedMs < 1.7 && best.every((b2) => b2.waveM < 3),
    `by half again rather than fourfold, and always a wave only ${best.map((b2) => b2.waveM.toFixed(2)).join(', ')} m long`);
}

// --- the stability limit ------------------------------------------------------------------------

{
  const cap = maxWaveSpeed(TEXEL, DT);
  ok(near(cap, 31.5, 1e-6), `the default grid carries at most ${cap.toFixed(2)} m/s`);
  ok(maxWaveSpeed(0.5, DT) > cap && maxWaveSpeed(0.25, DT) < cap,
    'a coarser grid carries a faster wave and a finer one carries less, which is the opposite of what a quality knob suggests');
  ok(near(waveTerm(cap, TEXEL, DT), RIPPLE_STABILITY, 1e-9), 'at the cap the term is exactly the stability limit');
  ok(waveTerm(cap * 1000, TEXEL, DT) === RIPPLE_STABILITY, 'and a thousand times the cap is held there, not let through');
  ok(RIPPLE_STABILITY < 0.5, 'which is under the 0.5 where the scheme stops being stable at all');
  // Held at the limit the field must still settle rather than run away, which is the whole point
  // of holding it. Stepped for ten seconds at the cap, nothing may grow.
  const f = ring(512, RIPPLE_STABILITY, DAMP, (i) => (i === 256 ? 1 : 0));
  let worst = 0;
  for (let s = 0; s < 1200; s++) { f.step(); for (const v of f.now()) worst = Math.max(worst, Math.abs(v)); }
  ok(worst <= 1.001 && Number.isFinite(worst), `stepped at the stability limit for ten seconds the field peaks at ${worst.toFixed(3)} and never runs away`);
}

// --- a number that is not a number never reaches the field --------------------------------------

{
  ok(waveTerm(Number.NaN, TEXEL, DT) === 0 && waveTerm(Number.POSITIVE_INFINITY, TEXEL, DT) === 0,
    'a speed that is not a finite number answers a flat 0 term rather than a NaN one, which would be a NaN across the whole field');
  ok(courantOf(Number.NaN, TEXEL, DT) === 0 && waveSpeedOf(Number.NaN, TEXEL, DT) === 0,
    'and so do the two either side of it');
  ok(deepWaterWavelength(Number.NaN) === 0 && shallowWaterDepth(Number.NaN) === 0 && realWaveSpeed(Number.NaN) === 0,
    'as do the real-water comparisons');
  ok(rippleGroupSpeed(DAMP, Number.NaN, 4, TEXEL, DT) === 0 && ripplePeriod(DAMP, Number.NaN, 4, TEXEL, DT) === Number.POSITIVE_INFINITY,
    'and a NaN term carries nothing rather than reporting a NaN speed');
}

// --- height, in metres --------------------------------------------------------------------------

{
  ok(reliefFor(1) === RIPPLE_RELIEF_BASE && RIPPLE_RELIEF_BASE === 0.5, '1× ripple height is half a metre of surface');
  ok(reliefFor(0) === 0 && reliefFor(-4) === 0, 'nothing and less than nothing are both flat');
  ok(near(reliefFor(1) * WATER_SIM_DRAFT.value, 0.275, 1e-9),
    `a body sunk to its waterline holds the surface ${(reliefFor(1) * WATER_SIM_DRAFT.value * 100).toFixed(1)} cm down at the tuned numbers`);
  ok(near(reliefFor(1) * WATER_SIM_IMPACT.value, 0.04, 1e-9), 'and a full-speed arrival punches 4 cm a step while it is still falling');
}

// --- persistence, as a half-life, measured on the field itself ----------------------------------

{
  ok(dampingFor(0) === RIPPLE_DAMP_FLOOR && near(dampingFor(1), RIPPLE_DAMP_FLOOR + RIPPLE_DAMP_SPAN, 1e-12),
    'persistence eases across the damping factor end to end');
  ok(dampingFor(-1) === dampingFor(0) && dampingFor(9) === dampingFor(1), 'outside 0 to 1 it is held, never wrapped');
  ok(dampingFor(1) < 1, 'and the top end stays under 1, or the field never settles');
  ok(near(rippleDecayPerStep(DAMP), Math.sqrt(DAMP), 1e-15) && rippleDecayPerStep(DAMP) > DAMP,
    `one step keeps ${rippleDecayPerStep(DAMP).toFixed(7)} of a ripple, not the ${DAMP.toFixed(7)} the step's own factor reads as`);

  const life = (p: number) => rippleHalfLife(dampingFor(p), DT);
  ok(near(life(0), 0.764, 5e-3), `at 0 a ripple halves in ${life(0).toFixed(2)} s`);
  ok(near(life(0.5), 1.485, 5e-3), `at half way, ${life(0.5).toFixed(2)} s`);
  ok(near(life(0.85), 4.313, 5e-3), `at the 0.85 it starts at, ${life(0.85).toFixed(2)} s`);
  ok(near(life(1), 23.10, 2e-2), `and at 1, ${life(1).toFixed(2)} s`);
  ok(life(1) - life(0.75) > life(0.75) - life(0), 'the last quarter of the slider holds more of the range than the first three');

  // Measured. This is the check the first cut did not have, and it is what says the half-life
  // follows √damp rather than damp: reading the step's own factor halves every figure above.
  const term = waveTerm(1.423, TEXEL, DT);
  for (const waveTexels of [4, 16, 100]) {
    const got = measuredHalfLife(term, DAMP, waveTexels);
    ok(within(got, life(0.85), 0.03),
      `a ${(waveTexels * TEXEL).toFixed(2)} m ripple measures a ${got.toFixed(3)} s half-life against the ${life(0.85).toFixed(3)} s predicted`);
    ok(got > 1.5 * (DT * Math.log(0.5)) / Math.log(DAMP),
      'and is nothing like the half of it that reading the step factor as the decay would give');
  }
  for (const p of [0, 0.5]) {
    const got = measuredHalfLife(term, dampingFor(p), 16, 20);
    ok(within(got, life(p), 0.05), `persistence ${p} measures ${got.toFixed(3)} s against ${life(p).toFixed(3)} predicted`);
  }
  ok(rippleHalfLife(1, DT) === Number.POSITIVE_INFINITY, 'a damping of 1 never settles at all');
  ok(rippleHalfLife(0, DT) === 0 && rippleHalfLife(0.99, 0) === 0, 'no damping and no step each answer 0 rather than a NaN');
  // Persistence is the spring too, so it moves the speed as well as the life.
  const slow = fastestRipple(dampingFor(0), term, TEXEL, DT).speedMs;
  const quick = fastestRipple(dampingFor(1), term, TEXEL, DT).speedMs;
  ok(within(slow, 0.343, 0.02) && within(quick, 1.006, 0.02) && quick > 2.5 * slow,
    `and it is also how fast a ripple carries: ${slow.toFixed(3)} m/s at 0 against ${quick.toFixed(3)} at 1`);
}

// --- what the field is, beside real water --------------------------------------------------------

{
  ok(near(realWaveSpeed(1.5), Math.sqrt((GRAVITY * 1.5) / (2 * Math.PI)), 1e-12) && near(realWaveSpeed(1.5), 1.53, 5e-3),
    `a real 1.5 m deep-water wave travels at ${realWaveSpeed(1.5).toFixed(2)} m/s`);
  ok(near(realWavePeriod(1.5), 0.98, 5e-3), `and passes every ${realWavePeriod(1.5).toFixed(2)} s`);
  const term = waveTerm(1.423, TEXEL, DT);
  const ours = rippleGroupSpeed(DAMP, term, 1.5, TEXEL, DT);
  ok(ours < realWaveSpeed(1.5) / 2,
    `ours carries a 1.5 m wave at ${ours.toFixed(3)} m/s, under half of real water's, which is the honest comparison the owner asked for`);
  const carry = fastestRipple(DAMP, term, TEXEL, DT).speedMs;
  ok(near(deepWaterWavelength(carry), 0.29, 5e-3) && near(shallowWaterDepth(carry), 0.046, 5e-3),
    `and at its fastest it reads as a ${(deepWaterWavelength(carry) * 100).toFixed(0)} cm wave, or a long wave in ${(shallowWaterDepth(carry) * 100).toFixed(0)} cm of water: a puddle`);
  ok(deepWaterWavelength(2) / deepWaterWavelength(1) === 4, 'doubling a speed asks the eye to read a wave four times as long');
  ok(deepWaterWavelength(-3) === 0 && shallowWaterDepth(-3) === 0 && realWavePeriod(-3) === 0, 'a length or a speed below nothing compares with nothing');
}

// --- and the same arithmetic as the console prints it -------------------------------------------

{
  const base: WaterSimSettings = {
    waterRipples: true, waterRippleDetail: 512, waterRippleHeight: 1, waterRipplePersistence: 0.85,
  };
  configureWaterSim(base);
  const d = waterSimDebug() as Record<string, number | boolean | Record<string, unknown>>;
  ok(d.on === false && d.grid === 0, 'the report answers with no field built, from the settings as they stand');
  ok(d.speedMs === 1.423 && d.texelCm === 37.5, `the default reads ${d.speedMs as number} m/s of coupling at ${d.texelCm as number} cm a texel`);
  ok(near(d.waveTerm as number, OLD_TERM, 1e-5), `whose wave term is the old ${d.waveTerm as number}`);
  ok(d.speedCapMs === 31.5 && (d.courant as number) < 0.05, 'well inside what the grid carries');
  ok(near(d.carryMs as number, 0.674, 5e-3) && near(d.carryWaveM as number, 1.75, 0.05),
    `and the number to trust is beside it: ${d.carryMs as number} m/s, at ${d.carryWaveM as number} m`);
  ok(near(d.ringPeriodS as number, 1.012, 5e-3), `with a ${d.ringPeriodS as number} s ring for anything slower`);
  ok(d.reliefM === 0.5 && d.holdDownM === 0.275 && near(d.halfLifeS as number, 4.313, 5e-3),
    `half a metre of relief, 27.5 cm of hold-down and a ${d.halfLifeS as number} s half-life`);
  const comp = d.compare as unknown as { waveM: number; oursMs: number; realMs: number }[];
  ok(comp.length === 5 && comp.every((c) => c.realMs > c.oursMs),
    'every size in the comparison is one real water carries faster than we do');
  ok(d.help === RIPPLE_HELP && Object.isFrozen(RIPPLE_HELP), 'the help is the one frozen table, not a copy made per call');
  for (const k of ['ripples', 'detail', 'height', 'persistence', 'speed', 'draft', 'impact']) {
    ok(typeof RIPPLE_HELP[k] === 'string' && RIPPLE_HELP[k].length > 80, `every knob has a line of its own: ${k}`);
  }
  ok(!/\b1\.4 m a second\b/.test(RIPPLE_HELP.speed) && /carryMs/.test(RIPPLE_HELP.speed),
    'and the speed line sends the reader to the carried speed rather than quoting the coupling as one');

  // A detail change moves the texel and the reach, and near enough nothing else.
  configureWaterSim({ ...base, waterRippleDetail: 256 });
  const low = waterSimDebug() as Record<string, number>;
  configureWaterSim({ ...base, waterRippleDetail: 1024 });
  const high = waterSimDebug() as Record<string, number>;
  ok(low.speedMs === high.speedMs && low.halfLifeS === high.halfLifeS && near(low.ringPeriodS, high.ringPeriodS, 1e-9),
    'the lowest and the highest detail now run the same water at the same coupling, for the same time, ringing at the same rate');
  const sized = (d2: Record<string, number>, waveM: number) =>
    (d2.compare as unknown as { waveM: number; oursMs: number }[]).find((c) => c.waveM === waveM)!.oursMs;
  ok(within(sized(low, 6), sized(high, 6), 0.05),
    `a 6 m wave carries at ${sized(low, 6)} and ${sized(high, 6)} m/s on the coarsest and finest grid, which is the bug gone`);
  ok(low.carryMs < high.carryMs && high.carryMs / low.carryMs < 1.7,
    `while the finest ripple each grid holds still differs (${low.carryMs} against ${high.carryMs} m/s), because a finer grid resolves a smaller, quicker one`);
  ok(low.texelCm === 50 && high.texelCm === 25 && low.windowM === 128 && high.windowM === 256,
    'and differ in the texel and the reach, which is what the setting is for');
  ok(low.speedCapMs > high.speedCapMs, 'the finer grid is the one with less headroom');

  // Height and persistence read straight through.
  configureWaterSim({ ...base, waterRippleHeight: 2, waterRipplePersistence: 0 });
  const loud = waterSimDebug() as Record<string, number>;
  ok(loud.reliefM === 1 && loud.holdDownM === 0.55, 'twice the height is a metre of relief and twice the hold-down');
  ok(near(loud.halfLifeS, 0.764, 5e-3), `and no persistence is a ${loud.halfLifeS} s half-life`);
  ok(loud.carryMs < (d.carryMs as number), 'which carries slower too, because persistence is the spring as well as the friction');

  // A speed past what the grid can carry is held, and the report says so rather than exploding.
  const tuned = WATER_SIM_SPEED.value;
  WATER_SIM_SPEED.value = 500;
  configureWaterSim(base);
  const fast = waterSimDebug() as Record<string, number>;
  ok(fast.waveTerm === RIPPLE_STABILITY && fast.speedMs === 500 && fast.speedCapMs === 31.5,
    'asking for 500 m/s reports the ask, the cap and a term held at the stability limit');
  // And a number that is not one at all is reported as nothing rather than as a NaN.
  WATER_SIM_SPEED.value = Number.NaN;
  const bad = waterSimDebug() as Record<string, number>;
  ok(bad.speedMs === 0 && bad.waveTerm === 0 && Number.isFinite(bad.carryMs),
    'and a NaN speed reports a flat, still field rather than spreading a NaN through the report');
  WATER_SIM_SPEED.value = tuned;
  configureWaterSim(base);
  ok((waterSimDebug() as Record<string, number>).speedMs === 1.423, 'and the tuned speed comes back untouched');
}

console.log(`\n${passed} checks passed`);
