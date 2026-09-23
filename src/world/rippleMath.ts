// The interactive water's numbers: the arithmetic between the knobs the owner turns and what the
// surface actually does, in metres and seconds. Nothing here touches three, the renderer or the
// field, so a node test sweeps the lot — and that test steps the very recurrence `waterSim.ts`
// runs, because the first cut of this file described a field the game does not run.
//
// The step is
//   h(t+1) = (2·h(t) − h(t−1) + C²·∇²h) · damp
// and two facts about it decide every number below.
//
// **C² is (c·dt/dx)²**: the one place every unit lives. dx is a texel, and the texel changes with
// the detail preset, so a C² stored as a constant meant a different wave term on every detail
// setting — a quality knob quietly changing how the water behaves. Store the speed in metres a
// second and work C² out per preset instead, and that goes away.
//
// **The damping is not only friction.** Write damp as 1 − e: the step is then the wave equation
// plus a −e·h restoring term and a −e·(h − hPrev) drag, so every texel is on a spring of its own as
// well as being coupled to its neighbours. That spring is the larger of the two here. At the tuned
// damping e is 2.7e-3, while C²·K (K is the laplacian's own eigenvalue, 0 for a flat field to 4 at
// the two-texel limit) only reaches 4e-3 for a wave two or three texels long: every ripple a player
// can see is governed by the spring. Two things follow, both measured on the recurrence rather than
// reasoned about:
//
//   - A disturbance mostly **rings where it stands** instead of travelling at c. Released from
//     rest at the tuned numbers its energy has spread about 0.8 m after two seconds, against the
//     2.8 m the same scheme undamped reaches in the same time.
//   - The field is **strongly dispersive**: ω² ≈ e + C²·K, so the phase speed climbs without bound
//     as the wave grows longer while the group speed — the one the eye follows, because it is the
//     speed the crest pattern's energy moves at — falls away toward nothing.
//
// So the speed `waveTerm` is given is the **coupling's** own number and not the speed of a ripple.
// `rippleGroupSpeed` and `fastestRipple` are what to quote, and `ringPeriodSeconds` is what a long
// wave really does. Persistence therefore does two jobs at once: it sets how long a ripple lives
// **and** how fast one travels, because it is the spring constant.
//
// Nothing here is the game's. There is no ripple simulation in the archives to be faithful to, so
// every number below is ours, and `notes.md` beside this pass names each one.

/** Metres a second squared. Standard gravity, for comparing our waves with real ones. */
export const GRAVITY = 9.80665;

/**
 * The largest (c·dt/dx)² the scheme holds. An explicit 2D wave equation is stable while
 * c·dt/dx ≤ 1/√2, that is C² ≤ 0.5; 0.49 keeps a little margin, because at the limit itself the
 * field rings instead of settling. Above it the field does not merely look wrong, it explodes.
 * Damping below 1 only ever makes it more stable, so this cap is safe at every persistence.
 */
export const RIPPLE_STABILITY = 0.49;

/** Metres of surface a field value of 1 stands, at ripple height 1×. */
export const RIPPLE_RELIEF_BASE = 0.5;

/** Persistence 0 and persistence 1, as the per-step damping factor. Above 1 nothing ever settles. */
export const RIPPLE_DAMP_FLOOR = 0.985;
export const RIPPLE_DAMP_SPAN = 0.0145;

/** c·dt/dx: how many texels a wave crosses in one step. The scheme's Courant number. */
export function courantOf(speedMs: number, texelM: number, stepSeconds: number): number {
  if (!Number.isFinite(speedMs) || !(texelM > 0) || !(stepSeconds > 0)) return 0;
  return (Math.max(0, speedMs) * stepSeconds) / texelM;
}

/**
 * The step's C² for a wanted speed on this grid, held under the stability limit. A speed that is
 * not a number at all answers 0 rather than passing a NaN into the uniform: one NaN texel becomes
 * a screen-wide black box once the bloom has blurred it, and the console knob can hand one in.
 */
export function waveTerm(speedMs: number, texelM: number, stepSeconds: number): number {
  const c = courantOf(speedMs, texelM, stepSeconds);
  return Math.min(c * c, RIPPLE_STABILITY);
}

/** The fastest wave this grid can carry. Bigger texels carry more, so a *coarser* preset is faster. */
export function maxWaveSpeed(texelM: number, stepSeconds: number): number {
  if (!(texelM > 0) || !(stepSeconds > 0)) return 0;
  return (Math.sqrt(RIPPLE_STABILITY) * texelM) / stepSeconds;
}

/** The other way round: what speed a stored C² came to on this grid. How the old number was read. */
export function waveSpeedOf(term: number, texelM: number, stepSeconds: number): number {
  if (!Number.isFinite(term) || !Number.isFinite(texelM) || !(stepSeconds > 0)) return 0;
  return (Math.sqrt(Math.max(0, term)) * Math.max(0, texelM)) / stepSeconds;
}

/** Metres of surface a field value of 1 stands, at this ripple height. */
export function reliefFor(height: number): number {
  return RIPPLE_RELIEF_BASE * Math.max(0, height);
}

/**
 * Persistence eased into the per-step damping factor. The useful span is narrow and its top end
 * must stay below 1, or the field never settles and every ripple ever made is still in it.
 */
export function dampingFor(persistence: number): number {
  const p = Math.min(Math.max(persistence, 0), 1);
  return RIPPLE_DAMP_FLOOR + p * RIPPLE_DAMP_SPAN;
}

/**
 * What one step leaves of a ripple's height: **√damp**, not damp.
 *
 * The mode recurrence is z² − damp·(2 − C²·K)·z + damp = 0, whose two roots multiply to `damp`.
 * For damp below 1 those roots are a complex pair at every K the scheme can hold, so each has
 * magnitude √damp — the amplitude keeps √damp a step while the pair's angle carries the swing.
 * Reading the factor off the step's own `· damp` counts the decay twice and halves every life
 * below. It is the same at every wavelength, which a swept measurement confirms rather than
 * merely allowing: 4.31 s at 1.5 m and at 37.5 m alike, at the tuned damping.
 */
export function rippleDecayPerStep(damp: number): number {
  if (!(damp > 0)) return 0;
  if (damp >= 1) return 1;
  return Math.sqrt(damp);
}

/**
 * Seconds for a ripple to fall to half its height, away from the window's edge (the last fourteen
 * texels are damped harder on purpose, so the border is not a wall). This is what "persistence"
 * means in a number the owner can time with a stopwatch.
 */
export function rippleHalfLife(damp: number, stepSeconds: number): number {
  if (!(damp > 0) || !(stepSeconds > 0)) return 0;
  if (damp >= 1) return Number.POSITIVE_INFINITY;
  return (stepSeconds * Math.log(0.5)) / Math.log(rippleDecayPerStep(damp));
}

/**
 * sin(θ/2) for the mode at u = k·dx, θ being the angle one step turns that mode through.
 *
 * Taken through the half angle on purpose. cos θ is √damp·(1 − C²(1 − cos u)), which for every
 * wave that matters here sits within a few hundredths of 1, and `acos` of a cosine that near 1
 * throws away most of its digits. Halved, sin²(θ/2) = (1 − √damp)/2 + √damp·C²·sin²(u/2) is exact
 * in the same arithmetic and shows the two terms plainly: the spring first, the coupling second.
 */
function halfSwing(rootMag: number, term: number, u: number): number {
  const sh = Math.sin(u / 2);
  const v = (1 - rootMag) / 2 + rootMag * Math.max(0, term) * sh * sh;
  return Math.sqrt(Math.min(Math.max(v, 0), 1));
}

/** k·dx for a wave of this length on this grid: radians of phase a texel. 0 to π (two texels). */
function texelPhase(wavelengthM: number, texelM: number): number {
  if (!(wavelengthM > 0) || !(texelM > 0)) return 0;
  return Math.min((2 * Math.PI * texelM) / wavelengthM, Math.PI);
}

/**
 * How fast a wave of this length swings, in radians a second: the field's real dispersion, spring
 * and coupling together. Every other speed below is this divided by something.
 */
export function rippleSwing(
  damp: number, term: number, wavelengthM: number, texelM: number, stepSeconds: number,
): number {
  if (!(damp > 0) || !Number.isFinite(term) || !(stepSeconds > 0)) return 0;
  const u = texelPhase(wavelengthM, texelM);
  if (u <= 0 && damp >= 1) return 0;
  return (2 * Math.asin(halfSwing(rippleDecayPerStep(damp), term, u))) / stepSeconds;
}

/** Seconds for a wave of this length to swing through once. Infinite when it does not swing. */
export function ripplePeriod(
  damp: number, term: number, wavelengthM: number, texelM: number, stepSeconds: number,
): number {
  const w = rippleSwing(damp, term, wavelengthM, texelM, stepSeconds);
  return w > 0 ? (2 * Math.PI) / w : Number.POSITIVE_INFINITY;
}

/**
 * The speed a single crest of this wavelength slides at, ω/k. It is **not** the speed of a ripple:
 * with the spring in the step it climbs without bound as the wave grows longer (37 m/s for a 37.5 m
 * wave at the tuned numbers), which is a pattern sliding, not energy going anywhere.
 */
export function ripplePhaseSpeed(
  damp: number, term: number, wavelengthM: number, texelM: number, stepSeconds: number,
): number {
  const u = texelPhase(wavelengthM, texelM);
  if (!(u > 0) || !(texelM > 0)) return 0;
  const w = rippleSwing(damp, term, wavelengthM, texelM, stepSeconds);
  return (w * wavelengthM) / (2 * Math.PI);
}

/**
 * The speed the eye actually follows: dω/dk, the speed a ripple's energy travels at.
 *
 * Differentiating cos θ = √damp·(1 − C²(1 − cos u)) gives dθ/du = √damp·C²·sin u / sin θ, so in
 * half angles dω/dk is √damp·C²·sin(u/2)·cos(u/2)·dx / (sin(θ/2)·cos(θ/2)·dt). Undamped and for a
 * long wave that reduces to √C²·dx/dt, which is c exactly; with the spring in it, it falls away.
 */
export function rippleGroupSpeed(
  damp: number, term: number, wavelengthM: number, texelM: number, stepSeconds: number,
): number {
  if (!(damp > 0) || !Number.isFinite(term) || !(texelM > 0) || !(stepSeconds > 0)) return 0;
  return groupAtPhase(damp, term, texelPhase(wavelengthM, texelM), texelM, stepSeconds);
}

function groupAtPhase(damp: number, term: number, u: number, texelM: number, stepSeconds: number): number {
  if (!(u > 0)) return 0;
  const a = rippleDecayPerStep(damp);
  const s = halfSwing(a, term, u);
  if (!(s > 0)) return 0;
  const c = Math.sqrt(Math.max(0, 1 - s * s));
  if (!(c > 0)) return 0;
  const num = a * Math.max(0, term) * Math.sin(u / 2) * Math.cos(u / 2) * texelM;
  return num / (s * c * stepSeconds);
}

/**
 * The fastest a ripple's energy can travel on this field, and the wavelength that does it. This is
 * the honest headline: the number to put beside real water, not the speed the knob is set to.
 *
 * The spring holds long waves back and the grid holds short ones back, so the best speed sits at an
 * interior wavelength — about 1.75 m at the tuned numbers, at 0.67 m/s against the 1.42 m/s the
 * coupling alone would give. A coarse sweep over every wavelength the grid can hold, then a golden
 * refine: pure, deterministic and console-only, so its little allocations never reach a frame.
 */
export function fastestRipple(
  damp: number, term: number, texelM: number, stepSeconds: number,
): { speedMs: number; waveM: number } {
  if (!(damp > 0) || !Number.isFinite(term) || !(texelM > 0) || !(stepSeconds > 0)) {
    return { speedMs: 0, waveM: 0 };
  }
  const at = (u: number): number => groupAtPhase(damp, term, u, texelM, stepSeconds);
  const N = 256;
  const floor = Math.PI / (N * 64);
  let bestU = floor;
  let best = at(bestU);
  for (let i = 1; i <= N; i++) {
    const u = (i * Math.PI) / N;
    const g = at(u);
    if (g > best) { best = g; bestU = u; }
  }
  let lo = Math.max(bestU - Math.PI / N, floor);
  let hi = Math.min(bestU + Math.PI / N, Math.PI);
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = hi - phi * (hi - lo);
  let b = lo + phi * (hi - lo);
  let fa = at(a);
  let fb = at(b);
  for (let i = 0; i < 60; i++) {
    if (fa < fb) { lo = a; a = b; fa = fb; b = lo + phi * (hi - lo); fb = at(b); }
    else { hi = b; b = a; fb = fa; a = hi - phi * (hi - lo); fa = at(a); }
  }
  const u = (lo + hi) / 2;
  const g = at(u);
  if (g >= best) return { speedMs: g, waveM: (2 * Math.PI * texelM) / u };
  return { speedMs: best, waveM: (2 * Math.PI * texelM) / bestU };
}

/**
 * The longest the surface can take to swing through once, in seconds: the K = 0 mode, which is the
 * whole window bobbing together with no coupling in it at all. It is set by the damping alone —
 * ω = 2·asin(√((1 − √damp)/2))/dt — and at the tuned persistence it is a hair over a second, which
 * is the period a big disturbance rings at instead of travelling away. Infinite at damp 1 and up.
 */
export function ringPeriodSeconds(damp: number, stepSeconds: number): number {
  if (!(damp > 0) || !(stepSeconds > 0)) return Number.POSITIVE_INFINITY;
  if (damp >= 1) return Number.POSITIVE_INFINITY;
  const w = (2 * Math.asin(halfSwing(rippleDecayPerStep(damp), 0, 0))) / stepSeconds;
  return w > 0 ? (2 * Math.PI) / w : Number.POSITIVE_INFINITY;
}

/** How fast a real deep-water gravity wave of this length travels: c = √(gλ/2π). */
export function realWaveSpeed(wavelengthM: number): number {
  if (!(wavelengthM > 0)) return 0;
  return Math.sqrt((GRAVITY * wavelengthM) / (2 * Math.PI));
}

/** How long a real deep-water wave of this length takes to pass: T = √(2πλ/g). */
export function realWavePeriod(wavelengthM: number): number {
  if (!(wavelengthM > 0)) return 0;
  return Math.sqrt((2 * Math.PI * wavelengthM) / GRAVITY);
}

/**
 * The other direction: the wavelength of a real deep-water gravity wave that travels at this
 * speed, λ = 2πc²/g. Fed a measured group speed it says what size of wave the field is telling the
 * eye it is showing, which is the honest way to ask whether a speed is believable.
 */
export function deepWaterWavelength(speedMs: number): number {
  if (!Number.isFinite(speedMs)) return 0;
  const c = Math.max(0, speedMs);
  return (2 * Math.PI * c * c) / GRAVITY;
}

/** The period of that same wave, in seconds: T = 2πc/g. */
export function deepWaterPeriod(speedMs: number): number {
  if (!Number.isFinite(speedMs)) return 0;
  return (2 * Math.PI * Math.max(0, speedMs)) / GRAVITY;
}

/**
 * The depth of water in which a long wave travels at this speed: h = c²/g. A puddle's ripples
 * really are this slow, which is the other way of asking whether a speed is believable.
 */
export function shallowWaterDepth(speedMs: number): number {
  if (!Number.isFinite(speedMs)) return 0;
  const c = Math.max(0, speedMs);
  return (c * c) / GRAVITY;
}

/**
 * What each knob does, in words that say what to expect rather than what it is called. Frozen and
 * shared, so printing it from the console allocates nothing: `__debug.ripples().help`.
 *
 * The three the menu does not carry (speed, draft, impact) are content tuning rather than taste —
 * a player has no way to judge them and every one of them is ours — so they live here and in the
 * console, and are explained here rather than hidden.
 */
export const RIPPLE_HELP: Readonly<Record<string, string>> = Object.freeze({
  ripples: 'Off, the water keeps its swell, its wind ripples and its shore foam and nothing you do moves it. The cost is fixed per frame: it does not care how much water is on screen, only how many things are standing in it.',
  detail: 'Grid and reach together: how fine the surface is worked out and how far around you it is worked out at all. A ripple of a given size now behaves the same on every setting — it swings at the same rate and carries within a few per cent of the same speed, where before a 6 m wave felt four times the coupling on the coarsest grid that it felt on the finest. What a finer setting does still buy is a smaller ripple: the fastest-carrying wave is only a few texels long, so `carryMs` in the report rises by about half again from the coarsest grid to the finest, which is resolution and not the old bug.',
  height: 'Metres of surface a full swing of the field stands. 1× is half a metre, so a fully submerged hull holds the water down by draft × that. Lower reads as heavy, calm water; higher makes every footfall stand out and is overdone as a rule.',
  persistence: 'The damping per step, and it does two jobs at once. It is how long a ripple lives — a half-life of 0.76 s at 0, 1.49 s at halfway, 4.31 s at the 0.85 it starts at and 23 s at 1 — and it is also the spring pulling each patch of surface back to the flat, which is what decides whether a ripple travels or just rings where it stands. Turning it up therefore makes the water livelier as well as longer-lived: energy carries at about 0.34 m/s at 0, 0.67 at the default and 1.0 at the top.',
  speed: 'Metres a second for the coupling between neighbouring texels, the same at every detail setting. It is not the speed you see a ripple go: the damping puts a spring under every texel as well, and the spring is the stronger of the two at every wavelength you can make out, so a ripple mostly rings in place and its energy carries at roughly half this number at best. `carryMs` in this report is the speed to trust, and `carryWaveM` is the size of wave that travels fastest. The grid caps this one (a coarser detail setting carries a faster wave, not a finer one), and past the cap it is held and says so.',
  draft: 'How far a fully submerged body holds the surface down, in the field\'s own units: multiply by the ripple height in metres for the dip. The footprint is a boundary, not a shove, so the bow wave and the wake fall out of the step rather than being authored.',
  impact: 'How hard something arriving fast punches a crater, in field units a step, while it is still coming down. It is a rate, not a blow: a long fall digs deeper than a short one at the same speed, and something merely bobbing punches nothing.',
});
