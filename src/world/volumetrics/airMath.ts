// The rules the air's shaders run, as plain arithmetic: what a node test can hold to the demos' own formulas and to
// the game's own numbers, and what the CPU side of the pass calls itself (the engines, the queues, the grains). A rule
// written twice, here and in a shader, is checked against itself by `__debug.air({ selfTest: true })` in the browser.
//
// Every function here takes and answers plain numbers or writes a kept record the caller hands it; nothing allocates.
// Pure: no three.
import { AIR_TUNE } from './airTune.ts';

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);

/** GLSL's smoothstep. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** How strongly a force at height `y` (metres over the ground) reaches a slab centred at `centre`: nought under 0.02 [demo `land.html:776`]. */
export function slabWeight(centre: number, y: number, reach: number): number {
  const r = reach > 1e-6 ? reach : 1e-6;
  const d = (centre - y) / r;
  const w = Math.exp(-d * d);
  return w < 0.02 ? 0 : w;
}

/** The dust's decay over a step: it settles as 1 / (1 + dt / settle) [demo `land.html:1850`]. */
export function dustDecay(dt: number, settle: number): number {
  return 1 / (1 + dt / (settle > 1e-6 ? settle : 1e-6));
}

/**
 * The dust's decay over a frame of `dt`: the demo's decay at its own fixed step `h` (a sixtieth), raised to the frame's
 * share of that step, `(1 + h / settle)^(-dt / h)`. The dust is carried every frame, so taken per frame as the demo's
 * form it would settle 1% faster at 60 frames than at 240 over twenty seconds; as this, a run of frames of any length
 * settles exactly as the same time in fixed steps does [ours, the design's "a decay stepped at a fixed rate"].
 */
export function dustDecayFrame(dt: number, settle: number, h = 1 / 60): number {
  const s = settle > 1e-6 ? settle : 1e-6;
  const t = dt > 0 && Number.isFinite(dt) ? dt : 0;
  return Math.pow(1 + h / s, -t / h);
}

/** The swirl's force a unit of vorticity at a cell of `cell` metres: the demo's per-texel force held per metre [ours]. */
export function swirlAt(cell: number, swirl = AIR_TUNE.solver.swirl, at = AIR_TUNE.solver.swirlCell): number {
  return (swirl * at) / (cell > 1e-6 ? cell : 1e-6);
}

/** A splat's radius in metres, never under one cell. */
export function splatRadius(r: number, cell: number): number {
  return r > cell ? r : cell;
}

/** The wind vector in world XZ, m/s: `(sin h, cos h)` times the speed and the tune's scale, the direction the weather builds for the water. */
export function windVector(heading: number, speed: number, out: { x: number; z: number }, scale = AIR_TUNE.wind.scale): { x: number; z: number } {
  const s = Number.isFinite(speed) ? speed * scale : 0;
  out.x = Math.sin(heading) * s;
  out.z = Math.cos(heading) * s;
  return out;
}

/** What a velocity sample outside the window reads: the wind times the slab's share. */
export function inflowVelocity(windX: number, windZ: number, share: number, out: { x: number; z: number }): { x: number; z: number } {
  out.x = windX * share;
  out.z = windZ * share;
  return out;
}

/** What a dust sample outside the window reads: the storm's dust (a density); smoke outside is none. */
export function inflowDust(stormLevel: number, inflow = AIR_TUNE.dust.stormInflow): number {
  return stormLevel > 0 ? stormLevel * inflow : 0;
}

/** Ground steeper than this sheds nothing whatever its family says: 1 - smoothstep(from, to, slope) [ours]. */
export function slopeGate(slopeDegrees: number, from = AIR_TUNE.dust.slopeFrom, to = AIR_TUNE.dust.slopeTo): number {
  return 1 - smoothstep(from, to, slopeDegrees);
}

/** The speed the wind must pass before sand lifts: `min(W · 1.05 + 1.5, 13)` [demo `land.html:1895`] (the second wave's ground reads it). */
export function liftThreshold(windSpeed: number, over = 1.05, add = 1.5, cap = 13): number {
  return Math.min(windSpeed * over + add, cap);
}

/** How far the dust thins with height over the ground: exp(-h / H), H rising from `height` toward `stormHeight` with the storm. */
export function dustProfile(h: number, storm: number, height = AIR_TUNE.dust.height, stormHeight = AIR_TUNE.dust.stormHeight): number {
  if (!(h >= 0)) return 0;
  const H = height + (stormHeight - height) * clamp01(storm);
  return Math.exp(-h / H);
}

/** The dust's height scale at a storm's level. */
export function dustHeight(storm: number, height = AIR_TUNE.dust.height, stormHeight = AIR_TUNE.dust.stormHeight): number {
  return height + (stormHeight - height) * clamp01(storm);
}

/** The forward scatter: 0.55 + 1.6 · max(mu, 0)^6 [demo `land.html:1162`]. */
export function phase(mu: number, base = AIR_TUNE.volume.phaseBase, lift = AIR_TUNE.volume.phaseLift, power = AIR_TUNE.volume.phasePower): number {
  const m = mu > 0 ? mu : 0;
  return base + lift * Math.pow(m, power);
}

/**
 * A step of the light pass's march toward the sun, metres: `0.64 · min(3.5, 0.75 / tan elevation)` [demo
 * `land.html:648`, `:1552`], lengthened by 26 / steps so the reach in metres holds as the steps change [ours].
 */
export function lightStep(elevation: number, steps: number, t = AIR_TUNE.light): number {
  const el = elevation > 0.05 ? elevation : 0.05;
  const sun = Math.min(t.sunCap, t.sunScale / Math.tan(el));
  return t.step * sun * (t.refSteps / (steps > 0 ? steps : 1));
}

/**
 * How much the game's own storm sheets are thinned: `1 - thin` while the volume draws the storm (it drew last frame
 * and the weather's dust is above nought), and exactly 1 otherwise, so with the volume off or refusing the sheets are
 * today's to the bit.
 */
export function stormSheetFactor(volumeDrawing: boolean, stormDust: number, thin: number): number {
  if (!volumeDrawing || !(stormDust > 0) || !(thin > 0)) return 1;
  return 1 - (thin < 1 ? thin : 1);
}

/** What the fixed clock steps a frame: how many steps, and the time left over. Written into `out`. */
export function fixedSteps(acc: number, dt: number, rate: number, most: number, out: { steps: number; acc: number }): { steps: number; acc: number } {
  const c = { acc, dt, rate, most, steps: 0 };
  fixedStepsIn(c);
  out.steps = c.steps;
  out.acc = c.acc;
  return out;
}

/** The fixed clock as the field keeps it: what it has banked, this frame's `dt`, its rate and most steps, and what it took. */
export interface FixedClock {
  acc: number;
  dt: number;
  rate: number;
  most: number;
  steps: number;
}

/** `fixedSteps` over a kept record, so no number crosses the call (the field's frame). */
export function fixedStepsIn(c: FixedClock): void {
  const step = 1 / c.rate;
  const dt = c.dt;
  let a = c.acc + (dt > 0 && Number.isFinite(dt) ? dt : 0);
  // A hitch carries no more than the steps a frame may take, so a long frame never banks a backlog.
  if (a > step * c.most) a = step * c.most;
  let n = 0;
  while (a >= step && n < c.most) {
    a -= step;
    n++;
  }
  c.steps = n;
  c.acc = a;
}

/**
 * The numbers the field works out once a frame, in a kept record so none crosses a call: in, the frame's `dt`, the
 * air's cell, the wind, the storm, the sun and the light's steps; out, the wind vector, the storm's inflow (laid at the
 * storm's weight, from wave 2b), the storm's own mean height, its weight and its spread, the dust's settling over
 * the frame, the swirl at this cell, the sun across the ground and the light's step. The same lines as `windVector`,
 * `inflowDust`, `dustHeight`, `stormWeight`, `stormSigma`, `dustDecayFrame`, `swirlAt`, `lightSunAcross` (`airLight.ts`)
 * and `lightStep`, which `airMath.test.ts` holds this to over random inputs.
 */
export interface AirFrameNumbers {
  dt: number;
  cell: number;
  windHeading: number;
  windSpeed: number;
  storm: number;
  sunX: number;
  sunY: number;
  sunZ: number;
  lightSteps: number;
  windX: number;
  windZ: number;
  inflowDust: number;
  dustHeight: number;
  stormWeight: number;
  stormSigma: number;
  decay: number;
  swirl: number;
  sunAcrossX: number;
  sunAcrossZ: number;
  lightStep: number;
  /** The sun's elevation, radians, held at its least (0.05): the light's slant and rise are worked out from it. */
  sunElevation: number;
}

/** A fresh record, every field a fraction from the start so each is a double from its first write. */
export function newAirFrameNumbers(): AirFrameNumbers {
  return { dt: 0.5, cell: 1.5, windHeading: 0.5, windSpeed: 0.5, storm: 0.5, sunX: 0.5, sunY: 0.5, sunZ: 0.5, lightSteps: 26, windX: 0.5, windZ: 0.5, inflowDust: 0.5, dustHeight: 0.5, stormWeight: 0.5, stormSigma: 0.5, decay: 0.5, swirl: 0.5, sunAcrossX: 0.5, sunAcrossZ: 0.5, lightStep: 0.5, sunElevation: 0.5 };
}

export function airFrameNumbersIn(r: AirFrameNumbers): void {
  const W = AIR_TUNE.wind;
  const D = AIR_TUNE.dust;
  const S = AIR_TUNE.solver;
  const L = AIR_TUNE.light;
  const ws = Number.isFinite(r.windSpeed) ? r.windSpeed * W.scale : 0;
  r.windX = Math.sin(r.windHeading) * ws;
  r.windZ = Math.cos(r.windHeading) * ws;
  const storm = r.storm > 0 && Number.isFinite(r.storm) ? r.storm : 0;
  r.dustHeight = D.height + (D.stormHeight - D.height) * (storm < 1 ? storm : 1);
  r.stormWeight = r.dustHeight / (D.height > 1e-3 ? D.height : 1e-3);
  r.stormSigma = HALF_NORMAL * r.dustHeight;
  r.inflowDust = storm > 0 ? storm * D.stormInflow * r.stormWeight : 0;
  const settle = D.settle > 1e-6 ? D.settle : 1e-6;
  const h = 1 / 60;
  const dt = r.dt > 0 && Number.isFinite(r.dt) ? r.dt : 0;
  r.decay = Math.pow(1 + h / settle, -dt / h);
  r.swirl = (S.swirl * S.swirlCell) / (r.cell > 1e-6 ? r.cell : 1e-6);
  const across = Math.sqrt(r.sunX * r.sunX + r.sunZ * r.sunZ);
  r.sunAcrossX = across > 1e-6 ? r.sunX / across : 0;
  r.sunAcrossZ = across > 1e-6 ? r.sunZ / across : 1;
  const sy = r.sunY > 1 ? 1 : r.sunY < -1 ? -1 : r.sunY;
  const el0 = Math.asin(sy);
  const el = el0 > 0.05 ? el0 : 0.05;
  r.sunElevation = el;
  const sun = L.sunScale / Math.tan(el);
  r.lightStep = L.step * (sun < L.sunCap ? sun : L.sunCap) * (L.refSteps / (r.lightSteps > 0 ? r.lightSteps : 1));
}

// ---------------------------------------------------------------------------------------------- the dents' kinds

/** Kind 0: a round bowl with a raised lip (pits, ruts, craters). Kind 1: a footprint, toe and heel along +x. */
export const DENT_KIND = { bowl: 0, foot: 1 } as const;

// ---------------------------------------------------------------------------------------------- the 10 Hz clock

/** The clock every accumulating write of the ground counts on (the offsets' age, the dents' stamps and fade): what it has banked, this frame's `dt`, and the ticks it crossed. */
export interface TickClock {
  acc: number;
  dt: number;
  ticks: number;
}

/** A tenth of a second: the clock's tick. */
export const TICK = 0.1;

/**
 * The ticks this frame crossed, into `c.ticks` (no number crosses the call): a tick every tenth of a second of the
 * frames' own time, whatever the frame rate, so what is counted or stamped a tick is the same at 30 and at 240 frames.
 * A hitch is held to ten ticks, so a long frame never banks a backlog.
 */
export function tickClockIn(c: TickClock): void {
  const dt = c.dt > 0 && Number.isFinite(c.dt) ? c.dt : 0;
  let a = c.acc + dt;
  if (a > TICK * 10) a = TICK * 10;
  // Counted with a whisker spare, so a run of frames that sums to exactly a tenth crosses it however the sums round.
  const n = Math.floor((a + 1e-9) / TICK);
  c.ticks = n;
  c.acc = a - n * TICK;
  if (c.acc < 0) c.acc = 0;
}

// ---------------------------------------------------------------------------------------------- the ground [demo]

/**
 * How strongly the air lifts the sand at a texel: `smoothstep(L, L + span, speed) · moves` [demo `land.html:553`], `L`
 * the lift threshold (`liftThreshold`). From wave 2b the carry takes it with `moves` one (how much shows over each
 * layer is the pixel's, `sandOverlay`); the shader's line, for the tests.
 */
export function sandLift(speed: number, threshold: number, span: number, moves: number): number {
  return smoothstep(threshold, threshold + span, speed) * moves;
}

// ---------------------------------------------------------------------------------------------- the blowing sand

/**
 * The blowing sand's two phases (wave 2b, the design's §2.7): each is the second wave's own carry, restarted
 * every `cycle` seconds with its overshoot kept, phase B half a cycle after A, so neither phase's offset grows past
 * `carry · cycle` and neither restart is seen (its weight is nought there). Kept apart rather than as one growing time,
 * so nothing is lost however long the session; the cycles are counted, and each phase's picture moves only at its own
 * restart (`sandJitter`). In: `dt`, `cycle`; kept: `tA`, `tB`, `kA`, `kB`; out: `restartA`, `restartB` (1 where the phase
 * started again this frame, its time then the overshoot).
 */
export interface SandPhase {
  dt: number;
  cycle: number;
  tA: number;
  tB: number;
  kA: number;
  kB: number;
  restartA: number;
  restartB: number;
}

/** A fresh clock: phase A at its start, phase B half a cycle on; every field a fraction from the start, so each is a double from its first write. */
export function newSandPhase(cycle = AIR_TUNE.sand.cycle): SandPhase {
  const c = { dt: 0.5, cycle: 0.5, tA: 0.5, tB: 0.5, kA: 0, kB: 0, restartA: 0, restartB: 0 };
  c.cycle = cycle;
  c.tA = 0;
  c.tB = cycle * 0.5;
  return c;
}

/** One frame of the two phases, into the record (no number crosses the call). */
export function sandPhaseIn(c: SandPhase): void {
  const T = c.cycle > 1e-3 ? c.cycle : 1e-3;
  const dt = c.dt > 0 && Number.isFinite(c.dt) ? c.dt : 0;
  c.restartA = 0;
  c.restartB = 0;
  let a = c.tA + dt;
  let b = c.tB + dt;
  while (a >= T) {
    a -= T;
    c.restartA = 1;
    c.kA++;
  }
  while (b >= T) {
    b -= T;
    c.restartB = 1;
    c.kB++;
  }
  c.tA = a;
  c.tB = b;
}

/** The plastic number, whose R2 sequence spreads a phase's picture evenly over its restarts. */
const PLASTIC = 1.324717957244746;

/**
 * Where a phase's picture stands after `n` restarts (an R2 sequence, `frac(0.5 + n · (1/g, 1/g²))`), into `out`: each
 * phase's own moves only at its own restart, when its weight is nought, so the same streaks never form again in one place.
 */
export function sandJitter(n: number, out: { x: number; y: number }): { x: number; y: number } {
  const x = 0.5 + n / PLASTIC;
  const y = 0.5 + n / (PLASTIC * PLASTIC);
  out.x = x - Math.floor(x);
  out.y = y - Math.floor(y);
  return out;
}

/**
 * How fast the sand blows at a texel, m/s of carry, from the two phases' offsets themselves: each phase's `|o| / t`
 * weighted by its cross-fade, whose weight over its own time is bounded (`2/T` in a phase's first half, `2(1 − f)/t` in
 * its second), so the estimate is continuous and never jumps at a restart. A phase's offset that is not a number reads
 * nought. The ground's shader's lines, for the tests.
 */
export function sandStrength(oAx: number, oAz: number, oBx: number, oBz: number, tA: number, tB: number, cycle: number): number {
  const invT = 1 / (cycle > 1e-3 ? cycle : 1e-3);
  const fA = tA * invT;
  const fB = tB * invT;
  const kA = fA < 0.5 ? 2 * invT : (2 * (1 - fA)) / (tA > 1e-6 ? tA : 1e-6);
  const kB = fB < 0.5 ? 2 * invT : (2 * (1 - fB)) / (tB > 1e-6 ? tB : 1e-6);
  const ax = Number.isFinite(oAx) ? oAx : 0;
  const az = Number.isFinite(oAz) ? oAz : 0;
  const bx = Number.isFinite(oBx) ? oBx : 0;
  const bz = Number.isFinite(oBz) ? oBz : 0;
  return Math.sqrt(ax * ax + az * az) * kA + Math.sqrt(bx * bx + bz * bz) * kB;
}

/**
 * The two phases' samples of the picture blended so their contrast holds (the variance-preserving blend, the picture's
 * mean a half known exactly since it is ours): each phase weighted by where it is in its cycle, nought at its restart.
 * `fA` phase A's place in its cycle, 0 to 1. The ground's shader's line, for the tests and the self test.
 */
export function sandBlend(pa: number, pb: number, fA: number): number {
  const wA = 1 - Math.abs(2 * fA - 1);
  const wB = 1 - wA;
  return 0.5 + (wA * (pa - 0.5) + wB * (pb - 0.5)) / Math.sqrt(wA * wA + wB * wB);
}

/**
 * The blowing sand's alpha at a pixel before its coverage: the art dial times the opacity (the wet ground's share
 * already in it) times the strength, cut into grains by the blended picture's red (`grains` ± `soft`) and into patches by
 * its green (a half ± `patches`). The ground's shader's lines, for the self test.
 */
export function sandAlpha(art: number, opacity: number, strength: number, px: number, py: number, s = AIR_TUNE.sand): number {
  const soft = s.soft > 1e-3 ? s.soft : 1e-3;
  const patches = s.patches > 1e-3 ? s.patches : 1e-3;
  return art * opacity * strength * smoothstep(s.grains - soft, s.grains + soft, px) * smoothstep(0.5 - patches, 0.5 + patches, py);
}

/**
 * The blowing sand laid over a colour channel: `mix(c, colour, alpha · coverage)`, `alpha` the sand's strength there
 * (the art dial already in it) and `coverage` how much of the layer under the pixel blows. A uniform branch on the dial
 * round the whole term, and nothing written where nothing blows: at a dial, an alpha or a coverage of nought (or one that
 * is not a number) the colour is answered as it came, to the bit (the design's §4.1 item 5).
 */
export function sandOverlay(c: number, alpha: number, coverage: number, colour: number, art: number): number {
  if (art === 0) return c;
  const a = alpha * coverage;
  if (!(a > 0)) return c;
  return c * (1 - a) + colour * a;
}

// ---------------------------------------------------------------------------------------------- the dust's shape

/**
 * The numbers the dust's laws take each frame, worked out once on the CPU (the design's §2.14): in, `dt`; out, the rise's
 * relaxation over the frame `e = exp(−dt/τ)` and its integral `i = τ(1 − e)` (τ = 1 / drag), the fall, the spread's
 * floor and ceiling squared, what it grows by over the frame (`2 · spreadRate · dt`) and the age's cap. Every line is
 * exact for any `dt`, so a patch reaches the same height at every frame rate.
 */
export interface DustLaw {
  dt: number;
  e: number;
  i: number;
  fall: number;
  min2: number;
  max2: number;
  grow: number;
  ageCap: number;
}

export function newDustLaw(): DustLaw {
  return { dt: 0.5, e: 0.5, i: 0.5, fall: 0.5, min2: 0.5, max2: 0.5, grow: 0.5, ageCap: 0.5 };
}

export function dustLawIn(r: DustLaw): void {
  const D = AIR_TUNE.dust;
  const dt = r.dt > 0 && Number.isFinite(r.dt) ? r.dt : 0;
  const drag = D.drag > 1e-6 ? D.drag : 1e-6;
  const tau = 1 / drag;
  const e = Math.exp(-dt * drag);
  r.e = e;
  r.i = tau * (1 - e);
  r.fall = D.fall;
  const lo = D.spreadMin > 1e-3 ? D.spreadMin : 1e-3;
  const hi = D.spreadMax > lo ? D.spreadMax : lo;
  r.min2 = lo * lo;
  r.max2 = hi * hi;
  r.grow = 2 * (D.spreadRate > 0 ? D.spreadRate : 0) * dt;
  r.ageCap = D.ageCap > 0 ? D.ageCap : 0;
}

/** One texel of the dust: its density and the shape it carries, premultiplied by it (D·μ, D·(σ² + μ²), D·w, D·age). */
export interface ShapeTexel {
  d: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * The dust pass's six laws at one texel, in the shader's order (after the backtrace and the settling, before the
 * splats), in place: the rise relaxes toward the fall, the mean moves by its exact integral, the ground reflects it (a
 * patch that landed stops falling), the spread grows linearly to its ceiling, the age grows to its cap, and all is
 * premultiplied by the density again. A density under 1e-5 reads the rest shape. The density is not touched (the
 * settling did that). Float64 arithmetic: the tests run it through the field's float32 store and a half-float one.
 */
export function dustShapeStep(t: ShapeTexel, law: DustLaw): void {
  const D = t.d;
  let mu = 0;
  let q = law.min2;
  let w = 0;
  let age = 0;
  if (D >= 1e-5) {
    const inv = 1 / D;
    mu = t.r * inv;
    q = t.g * inv;
    w = t.b * inv;
    age = t.a * inv;
  }
  const wf = w + law.fall;
  let w2 = -law.fall + wf * law.e;
  let m2 = mu + (-law.fall * law.dt + wf * law.i);
  if (m2 < 0) {
    w2 = w2 > 0 ? w2 : 0;
    m2 = -m2;
  }
  let s2 = q - mu * mu;
  if (s2 < law.min2) s2 = law.min2;
  if (s2 < law.max2) {
    s2 += law.grow;
    if (s2 > law.max2) s2 = law.max2;
  }
  const a2 = age + law.dt < law.ageCap ? age + law.dt : law.ageCap;
  t.r = D * m2;
  t.g = D * (s2 + m2 * m2);
  t.b = D * w2;
  t.a = D * a2;
}

/**
 * The floor the dust pass writes through: nought under every channel that is never negative (the density, the colour,
 * D·μ, the second moment, D·age), and never under D·w, which is negative while the dust falls -- held at nought each
 * frame the fall would start again from nought and nearly vanish, by an amount that depends on the frame rate. Anything
 * that is not a finite number reads nought, as the pass's `finite4` makes it. In place.
 */
export function shapeFloor(t: ShapeTexel): void {
  if (!(t.d > 0 && t.d < Infinity)) t.d = 0;
  if (!(t.r > 0 && t.r < Infinity)) t.r = 0;
  if (!(t.g > 0 && t.g < Infinity)) t.g = 0;
  if (!(t.a > 0 && t.a < Infinity)) t.a = 0;
  if (!Number.isFinite(t.b)) t.b = 0;
}

/** sqrt(2π), the normal's own. */
const ROOT_TWO_PI = Math.sqrt(2 * Math.PI);

/**
 * The folded Gaussian a patch is drawn as at `h` metres over the ground: `N(h; μ, σ) + N(h; −μ, σ)`, the ground
 * reflecting the dust rather than swallowing it, nought under the ground; it integrates to one over `h ≥ 0`, so a unit of
 * density keeps the first wave's column optical depth (0.55 · D · H₀) wherever its mass sits.
 */
export function foldedProfile(h: number, mu: number, sigma: number): number {
  if (!(h >= 0)) return 0;
  const s = sigma > 1e-4 ? sigma : 1e-4;
  const k = 0.5 / (s * s);
  const a = h - mu;
  const b = h + mu;
  return (Math.exp(-a * a * k) + Math.exp(-b * b * k)) / (s * ROOT_TWO_PI);
}

/** The storm's own mean height, metres: `height` calm rising to `stormHeight` in a full storm (the first wave's). */
export function stormHeightAt(storm: number, d = AIR_TUNE.dust): number {
  const s = storm > 0 && Number.isFinite(storm) ? (storm < 1 ? storm : 1) : 0;
  return d.height + (d.stormHeight - d.height) * s;
}

/**
 * The weight the storm's dust is laid at, `H(storm) / H₀`: the first wave drew every unit of dust with a height scale
 * that rose with the storm, so a unit of storm dust carried a column of `0.55 · D · H(storm)`; laid at H₀ alone a full
 * storm would thin tenfold. Its shed and its inflow are laid at this weight, and a unit of storm dust keeps that column.
 */
export function stormWeight(storm: number, d = AIR_TUNE.dust): number {
  return stormHeightAt(storm, d) / (d.height > 1e-3 ? d.height : 1e-3);
}

/** sqrt(π/2): a half-normal of spread σ has a mean height of σ / this. */
export const HALF_NORMAL = Math.sqrt(Math.PI / 2);

/** The storm's dust's spread, metres: the half-normal of the storm's own mean height (2.26 m calm, 15 m in a full storm). */
export function stormSigma(storm: number, d = AIR_TUNE.dust): number {
  return HALF_NORMAL * stormHeightAt(storm, d);
}

/**
 * What the first wave's march drew for the storm's dust at `h` metres over the ground, for the read-back density `read`
 * of this wave (laid at the storm's weight): `(read · H₀ / H(storm)) · 0.55 · exp(−h / H(storm))`, the first wave's own
 * line (`dust · exp(-hy / H) · extinction`, `airVolume.ts` at the second wave's commit) over its own density. The storm's
 * column is the same by the weight; its density at eye height in a full storm is 0.72 of this by the shapes' own
 * difference (a number for the owner).
 */
export function w1StormDensity(read: number, h: number, storm: number, d = AIR_TUNE.dust): number {
  const H = stormHeightAt(storm, d);
  const unit = (read * d.height) / H;
  return unit * d.extinction * Math.exp(-(h > 0 ? h : 0) / H);
}

/** The same storm drawn this wave at `h` metres: `read · H₀ · f(h) · 0.55`, `f` the half-normal of its spread. */
export function stormDensity(read: number, h: number, storm: number, d = AIR_TUNE.dust): number {
  return read * d.height * foldedProfile(h, 0, stormSigma(storm, d)) * d.extinction;
}

/**
 * Where a lift peaks, in closed form from the laws (the band the march looks in): in, the source's height `mu0`, spread
 * `sigma0` and rise `w0`; out, when (`t`), how high (`mu`), how thick then (`sigma`) and the band's top over it (`top`,
 * `bandSigmas` of its spread over its height). A rise relaxes toward the fall, so it peaks when its speed reaches nought,
 * `t = τ · ln((w0 + fall) / fall)`; with nothing rising it peaks where it is laid.
 */
export interface LiftPeak {
  mu0: number;
  sigma0: number;
  w0: number;
  t: number;
  mu: number;
  sigma: number;
  top: number;
}

export function newLiftPeak(): LiftPeak {
  return { mu0: 0.5, sigma0: 0.5, w0: 0.5, t: 0.5, mu: 0.5, sigma: 0.5, top: 0.5 };
}

export function liftPeakIn(r: LiftPeak): void {
  const D = AIR_TUNE.dust;
  const drag = D.drag > 1e-6 ? D.drag : 1e-6;
  const tau = 1 / drag;
  const fall = D.fall;
  const w0 = Number.isFinite(r.w0) ? r.w0 : 0;
  const mu0 = Number.isFinite(r.mu0) ? r.mu0 : 0;
  const s0 = Number.isFinite(r.sigma0) && r.sigma0 > 0 ? r.sigma0 : 0;
  let t = 0;
  let mu = mu0;
  if (w0 > 0) {
    if (fall > 1e-9) {
      t = tau * Math.log((w0 + fall) / fall);
      // At the peak exp(−t/τ) is fall / (w0 + fall), so the mean's integral comes to τ · w0.
      mu = mu0 - fall * t + tau * w0;
    } else {
      t = Infinity;
      mu = mu0 + w0 * tau;
    }
  }
  const lo = D.spreadMin > 1e-3 ? D.spreadMin : 1e-3;
  const hi = D.spreadMax > lo ? D.spreadMax : lo;
  let s2 = s0 * s0;
  if (s2 < lo * lo) s2 = lo * lo;
  if (s2 < hi * hi) {
    s2 += 2 * (D.spreadRate > 0 ? D.spreadRate : 0) * (Number.isFinite(t) ? t : 1e9);
    if (s2 > hi * hi) s2 = hi * hi;
  }
  r.t = t;
  r.mu = mu;
  r.sigma = Math.sqrt(s2);
  r.top = mu + AIR_TUNE.volume.bandSigmas * r.sigma;
}

/**
 * The march's near fade on a sample `t` metres from the lens: `smoothstep(from, to, t)`, so dust within `from` of the
 * lens is not drawn and is back in full by `to`. **A uniform branch round the whole term**: taken only while `to > from`
 * (GLSL leaves `smoothstep` undefined for equal edges, and HLSL's form divides by their difference), so with both at
 * nought the density is answered as it came, to the bit.
 */
export function nearFade(dens: number, t: number, from: number, to: number): number {
  if (!(to > from)) return dens;
  return dens * smoothstep(from, to, t);
}

/**
 * The storm's dust along a ray past the window, in closed form (the march's `farDepth`, its mirror): the optical depth of
 * a density `D` (already times H₀, the extinction and the amount) standing as the half-normal of spread `sigma` over the
 * window's mean ground `G`, along `t0..t1` of the ray from height `cy` rising `dy` a metre. Nought under the ground (the
 * profile's own rule); a ray that barely rises takes the profile at its start. `∫ f dt = (erf(b/σ√2) − erf(a/σ√2)) / |dy|`.
 */
export function farHalfNormalDepth(t0: number, t1: number, cy: number, dy: number, D: number, G: number, sigma: number): number {
  if (!(t1 > t0) || !(D > 0)) return 0;
  const s = sigma > 1e-3 ? sigma : 1e-3;
  const y0 = cy + dy * t0 - G;
  const y1 = cy + dy * t1 - G;
  if (Math.abs(dy) < 1e-4) return D * foldedProfile(y0, 0, s) * (t1 - t0);
  const a = y0 > 0 ? y0 : 0;
  const b = y1 > 0 ? y1 : 0;
  const k = 1 / (Math.SQRT2 * s);
  return (D * Math.abs(erfApprox(b * k) - erfApprox(a * k))) / Math.abs(dy);
}

/**
 * The storm's colour eased toward the window's own (the design's §2.14), in a kept record: in, the frame's `dt`, the
 * seconds `ease` it takes, the colour now (`r`, `g`, `b`, linear) and the target (`tr`, `tg`, `tb`); out, the colour moved
 * by `1 − exp(−3 dt / ease)` of the way, so it is within a twentieth of the target `ease` seconds on at any frame rate.
 */
export interface StormEase {
  dt: number;
  ease: number;
  r: number;
  g: number;
  b: number;
  tr: number;
  tg: number;
  tb: number;
}

export function newStormEase(): StormEase {
  return { dt: 0.5, ease: 3.5, r: 0.6, g: 0.45, b: 0.3, tr: 0.6, tg: 0.45, tb: 0.3 };
}

export function stormEaseIn(c: StormEase): void {
  const dt = c.dt > 0 && Number.isFinite(c.dt) ? c.dt : 0;
  const e = c.ease > 1e-3 ? c.ease : 1e-3;
  const k = 1 - Math.exp((-3 * dt) / e);
  c.r += (c.tr - c.r) * k;
  c.g += (c.tg - c.g) * k;
  c.b += (c.tb - c.b) * k;
}

/**
 * Abramowitz and Stegun's erf (7.1.26), within 1.5e-7: what the shaders and the mirror both use for the folded
 * Gaussian's tail (the storm's column past the light's steps, and past the window along the view).
 */
export function erfApprox(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = x < 0 ? -x : x;
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

// ---------------------------------------------------------------------------------------------- the Force's fronts

/** The kinds of front, as the table holds them. */
export const FRONT_KIND = { push: 0, pull: 1, repulse: 2 } as const;

/**
 * Where a front is at age `age` (the design's §2.15): in, its `kind`, `reach` and `age`; out, its radius `r` and its
 * share of its way `s`. `r = from + (to − from) · ease(s)`: a push and a repulse ease out (fast, then slowing), a pull in.
 */
export interface FrontAt {
  kind: number;
  reach: number;
  age: number;
  r: number;
  s: number;
}

export function newFrontAt(): FrontAt {
  return { kind: 0, reach: 0.5, age: 0.5, r: 0.5, s: 0.5 };
}

/** A front's time to cross its way, seconds, by kind. */
export function frontTime(kind: number, f = AIR_TUNE.force): number {
  const t = kind === FRONT_KIND.push ? f.pushTime : kind === FRONT_KIND.pull ? f.pullTime : f.repulseTime;
  return t > 1e-3 ? t : 1e-3;
}

export function frontRadiusIn(r: FrontAt): void {
  const F = AIR_TUNE.force;
  const kind = r.kind;
  const reach = r.reach;
  // `frontTime` written out: a number handed back across a call the compiler does not build in is a number made, and
  // this runs for every front on every frame and step.
  const t0 = kind === FRONT_KIND.push ? F.pushTime : kind === FRONT_KIND.pull ? F.pullTime : F.repulseTime;
  let s = r.age / (t0 > 1e-3 ? t0 : 1e-3);
  s = s > 0 ? (s < 1 ? s : 1) : 0;
  let from = 0;
  let to = 0;
  let e = 0;
  if (kind === FRONT_KIND.push) {
    from = F.pushFrom;
    to = reach;
    e = 1 - Math.pow(1 - s, F.pushEase);
  } else if (kind === FRONT_KIND.pull) {
    from = reach * F.pullFrom;
    to = F.pullTo;
    e = Math.pow(s, F.pullEase);
  } else {
    from = F.repulseFrom;
    to = reach;
    e = 1 - Math.pow(1 - s, F.repulseEase);
  }
  r.r = from + (to - from) * e;
  r.s = s;
}

/** Where a front starts, metres from the player: a push's and a repulse's near, a pull's at its reach. */
export function frontFrom(kind: number, reach: number, f = AIR_TUNE.force): number {
  return kind === FRONT_KIND.push ? f.pushFrom : kind === FRONT_KIND.pull ? reach * f.pullFrom : f.repulseFrom;
}

/** Half the angle a front sweeps, radians: a ring all round, an arc either side of the aim. */
export function frontHalfArc(kind: number, f = AIR_TUNE.force): number {
  return kind === FRONT_KIND.repulse ? Math.PI : (f.arc * Math.PI) / 180;
}

/**
 * Pressed ground darker by its dent [demo `land.html:939`]: `c · (1 − clamp(depth · scale, 0, most))`, the depth
 * (metres, finite) times the prints' dial. A uniform branch round the whole term: at a dial of nought `c` is answered
 * as it came, to the bit.
 */
export function dentDarken(c: number, depth: number, art: number, scale = AIR_TUNE.ground.darkenScale, most = AIR_TUNE.ground.darkening): number {
  if (art === 0) return c;
  const d = (Number.isFinite(depth) ? depth : 0) * art;
  const k = d * scale;
  return c * (1 - (k < 0 ? 0 : k > most ? most : k));
}

/**
 * A normal bent by a dent [demo `land.html:927-933`]: the slope of the depth across `2t` metres (`dx`, `dz` the
 * differences of the depth a texel either side, finite), times the dial, added to the normal's x and z and the whole
 * made a unit again. A uniform branch: at a dial of nought, or where the ground is flat, the normal is answered as it
 * came, to the bit (a `normalize` round an unchanged normal would move its last bits). Into `out`.
 */
export function dentNormal(nx: number, ny: number, nz: number, dx: number, dz: number, t: number, art: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  out.x = nx;
  out.y = ny;
  out.z = nz;
  if (art === 0) return out;
  const sx = ((Number.isFinite(dx) ? dx : 0) * art) / (2 * t);
  const sz = ((Number.isFinite(dz) ? dz : 0) * art) / (2 * t);
  if (sx === 0 && sz === 0) return out;
  const x = nx + sx;
  const z = nz + sz;
  const len = Math.sqrt(x * x + ny * ny + z * z);
  if (!(len > 1e-9)) return out;
  out.x = x / len;
  out.y = ny / len;
  out.z = z / len;
  return out;
}

/**
 * The dust's shadow on the ground (the second wave): the sun's direct light at a pixel times `1 − art · share · (1 −
 * T) · fade`, `T` the light pass's transmittance there (finite, held to 0..1). A uniform branch: at a dial of nought
 * the light is answered as it came, to the bit.
 */
export function dustShade(light: number, transmittance: number, art: number, fade: number, share = AIR_TUNE.ground.shade): number {
  if (art === 0) return light;
  const T = Number.isFinite(transmittance) ? (transmittance < 0 ? 0 : transmittance > 1 ? 1 : transmittance) : 1;
  const k = 1 - art * share * (1 - T) * fade;
  if (k === 1) return light;
  return light * k;
}

/**
 * The light toward the sun at the ground as the ground's shade reads it from wave 2b: the light pass writes an
 * optical depth, `exp(−τ)`, and a depth it cannot read (not a number, or below nought) is no shade at all (one).
 */
export function shadeTransmittance(tau: number): number {
  return Number.isFinite(tau) && tau > 0 ? Math.exp(-tau) : 1;
}

// ---------------------------------------------------------------------------------------------- the dust's colour

/** The luminance histogram `lighterTone` counts into: a module's own, so a world's load makes nothing for it. */
const TONE_HISTOGRAM = new Uint32Array(256);

/**
 * The lighter tones of a picture (wave 2b, the design's §2.14): every `stride`th byte from `from` to `to` (RGBA
 * texels; `averageColor`'s own walk), a 256-bin histogram of each sample's luminance byte, the cut where the samples at
 * or above it are at least `1 − tone` of them, and the mean of those samples' sRGB, each channel over 255, into `out`
 * (`n` the samples taken). At `tone` 0 the cut is the darkest sample and every sample is taken, in the walk's own order,
 * so the mean is `averageColor`'s to the bit. Two passes, no sort.
 */
export function lighterTone(bytes: ArrayLike<number>, from: number, to: number, stride: number, tone: number, out: { r: number; g: number; b: number; n: number }): void {
  const hist = TONE_HISTOGRAM;
  hist.fill(0);
  let total = 0;
  for (let i = from; i < to; i += stride) {
    const l = Math.round(0.2126 * bytes[i] + 0.7152 * bytes[i + 1] + 0.0722 * bytes[i + 2]);
    hist[l > 255 ? 255 : l < 0 ? 0 : l]++;
    total++;
  }
  const share = tone > 0 ? (tone < 1 ? tone : 1) : 0;
  const need = Math.max(1, (1 - share) * total);
  let cut = 255;
  let above = 0;
  for (let b = 255; b >= 0; b--) {
    above += hist[b];
    cut = b;
    if (above >= need) break;
  }
  let r = 0;
  let g = 0;
  let bl = 0;
  let n = 0;
  for (let i = from; i < to; i += stride) {
    const l = Math.round(0.2126 * bytes[i] + 0.7152 * bytes[i + 1] + 0.0722 * bytes[i + 2]);
    if ((l > 255 ? 255 : l < 0 ? 0 : l) < cut) continue;
    r += bytes[i];
    g += bytes[i + 1];
    bl += bytes[i + 2];
    n++;
  }
  out.n = n;
  out.r = n > 0 ? r / n / 255 : 0;
  out.g = n > 0 ? g / n / 255 : 0;
  out.b = n > 0 ? bl / n / 255 : 0;
}

/**
 * The dust pass's colour at a texel, its mirror (the design's §2.14): the colour raster's bytes (the family's lighter
 * tones as sRGB) decoded, times the drawn ground's own tint of the tint raster's bytes in its own mode
 * (`srgbDecode(tintGamma(...))`, the tile program's `groundDecode(groundTintOf(...))`), blended toward one by `share`
 * (`dust.tint`); a tint of one where the tint raster's alpha is nought (no chunk, no colour map). `decode` and `tint` are
 * the caller's (groundMath's, so this module needs nothing of the ground's). Into `out`, linear.
 */
export function tintedColourIn(col: ArrayLike<number>, at: number, tint: ArrayLike<number>, tintAt: number, share: number, decode: (c: number) => number, tintOf: (c: [number, number, number], out: [number, number, number]) => [number, number, number], scratch: { c: [number, number, number]; t: [number, number, number] }, out: [number, number, number]): [number, number, number] {
  const known = tint[tintAt + 3] > 0;
  if (known) {
    scratch.c[0] = tint[tintAt] / 255;
    scratch.c[1] = tint[tintAt + 1] / 255;
    scratch.c[2] = tint[tintAt + 2] / 255;
    tintOf(scratch.c, scratch.t);
  }
  for (let ch = 0; ch < 3; ch++) {
    const base = decode(col[at + ch] / 255);
    const t = known ? decode(scratch.t[ch]) : 1;
    out[ch] = base * (1 + (t - 1) * share);
  }
  return out;
}

/** One tick of the dents' fade at a texel: `exp(−0.1 · ticks · max(heals, 0.02) / fade)` [demo `land.html:727`, on the tick]. */
export function dentFade(ticks: number, heals: number, fade = AIR_TUNE.prints.fade): number {
  return Math.exp(-((TICK * ticks) / (fade > 0.1 ? fade : 0.1)) * (heals > 0.02 ? heals : 0.02));
}

// ---------------------------------------------------------------------------------------------- the engine [demo]

/** The free jet's reach: 1.2 + 0.32 · exit, metres [demo `land.html:1437`]. */
export function engineReach(exit: number, e = AIR_TUNE.engine): number {
  return e.reachBase + e.reachPerSpeed * exit;
}

/** The jet's speed, held under the cap's share [demo `land.html:1438`]. */
export function engineSpeed(exit: number, cap = AIR_TUNE.solver.cap, e = AIR_TUNE.engine): number {
  return Math.min(exit, cap * e.capShare);
}

/** The nozzle's radius: 0.3 + 0.012 · exit, metres [demo `land.html:1439`]. */
export function nozzleRadius(exit: number, e = AIR_TUNE.engine): number {
  return e.nozzleBase + e.nozzlePerSpeed * exit;
}

/** The free jet's speed `d` metres along its axis: vEff / (1 + d / (0.3 · reach)) [demo `land.html:1453`]. */
export function jetSpeedAt(vEff: number, d: number, reach: number): number {
  return vEff / (1 + d / (0.3 * reach));
}

/** The free jet's radius `d` metres along: r0 + 0.16 · d [demo `land.html:1454`]. */
export function jetRadiusAt(r0: number, d: number, e = AIR_TUNE.engine): number {
  return r0 + e.widen * d;
}

/** The impact's speed where the axis meets the ground `t` metres along: vEff / (1 + t / (0.3 · reach)) · √(-dy) [demo `land.html:1484`]. */
export function impactSpeed(vEff: number, t: number, reach: number, dy: number): number {
  if (!(dy < 0)) return 0;
  return (vEff / (1 + t / (0.3 * reach))) * Math.sqrt(-dy);
}

/** The spread's bite under a nozzle `h` metres over the ground at `speed`: clamp(1 - (h - 0.5) / 3.4) · (0.35 + speed / 12) [demo `land.html:1717`]. */
export function spreadBite(h: number, speed: number, e = AIR_TUNE.engine): number {
  const ge = clamp01(1 - (h - e.spreadLow) / e.spreadSpan);
  return ge * (e.spreadBase + Math.abs(speed) / e.spreadSpeed);
}

/** A hovering hull's downwash exit speed: its base times 1 - smoothstep(0, fade, |speed|) [ours]. */
export function downwashExit(base: number, speed: number, fade = AIR_TUNE.engine.downwashFade): number {
  return base * (1 - smoothstep(0, fade, Math.abs(speed)));
}

/** An engine's exit speed from its kind's and its heat (0 to 1.6), held under the cap [ours, the demo's top]. */
export function exitSpeed(kindExit: number, heat: number, cap = AIR_TUNE.engine.exitCap): number {
  const h = heat > 0 && Number.isFinite(heat) ? heat : 0;
  return Math.min(cap, kindExit * h);
}

// ---------------------------------------------------------------------------------------------- the grains

/** The fixed interval a machine's shed is judged on: a twentieth of a second, the interval `emitDust` asks for. */
export const SHED_BASIS = 0.05;

/**
 * How many motes a machine throws over `interval` seconds where the ground sheds `shed` (the response's dust, 0 to 1),
 * given today's `count` for that interval and the machine's motes a second before today's rounding (`perSecond`):
 * today's count where the ground sheds fully (sand, ash), and elsewhere the ground's share of the motes a fixed
 * twentieth of a second throws, taken down to whole motes and then spread over the interval. Judged on the fixed
 * twentieth and never on the interval itself: `emitDust`'s interval is however many frames summed to a twentieth or
 * more (0.0556 s at 144 frames a second, 0.0667 at 30), and judged on that, a fast wide machine on rock threw a mote a
 * window at 144 and none at 60. So the tenth that rock and paving shed comes to none at any frame rate (a twentieth's
 * share is under one mote at the fastest and widest, 164 a second), and mud, wet sand and a liquid none at all.
 * `World.emitDust` asks it only with the volumetrics' dust on; with it off the count is today's as it stands. (The
 * grains' fall itself is `Dust`'s own step, which the node test drives through the real pool.)
 */
export function sheddingCount(count: number, perSecond: number, interval: number, shed: number): number {
  if (shed >= 1) return count;
  const s = shed > 0 ? shed : 0;
  const rate = perSecond > 0 && Number.isFinite(perSecond) ? perSecond : 0;
  const whole = Math.floor(rate * SHED_BASIS * s);
  if (!(whole > 0)) return 0;
  const span = interval > 0 && Number.isFinite(interval) ? interval : SHED_BASIS;
  return Math.round((whole * span) / SHED_BASIS);
}

/** The grains a blast throws: `grains.blast` at a thermal detonator's radius, by radius over its [demo `land.html:1604-1610`]. */
export function blastGrains(radius: number, g = AIR_TUNE.grains, b = AIR_TUNE.blast): number {
  const r = radius > 0 && Number.isFinite(radius) ? radius : 0;
  return Math.round(g.blast * (r / b.radiusRef));
}
