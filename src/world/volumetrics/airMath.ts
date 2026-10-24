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

/** The light pass's transmittance from what lies on the way: exp(-k · sum) [demo `land.html:661`]. */
export function lightTransmittance(sum: number, k = AIR_TUNE.light.k): number {
  return Math.exp(-k * (sum > 0 ? sum : 0));
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
 * air's cell, the wind, the storm, the sun and the light's steps; out, the wind vector, the storm's inflow and the
 * dust's height at it, the dust's settling over the frame, the swirl at this cell, the sun across the ground and the
 * light's step. The same lines as `windVector`, `inflowDust`, `dustHeight`, `dustDecayFrame`, `swirlAt`,
 * `lightSunAcross` (`airLight.ts`) and `lightStep`, which `airMath.test.ts` holds this to over random inputs.
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
  decay: number;
  swirl: number;
  sunAcrossX: number;
  sunAcrossZ: number;
  lightStep: number;
}

/** A fresh record, every field a fraction from the start so each is a double from its first write. */
export function newAirFrameNumbers(): AirFrameNumbers {
  return { dt: 0.5, cell: 1.5, windHeading: 0.5, windSpeed: 0.5, storm: 0.5, sunX: 0.5, sunY: 0.5, sunZ: 0.5, lightSteps: 26, windX: 0.5, windZ: 0.5, inflowDust: 0.5, dustHeight: 0.5, decay: 0.5, swirl: 0.5, sunAcrossX: 0.5, sunAcrossZ: 0.5, lightStep: 0.5 };
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
  r.inflowDust = storm > 0 ? storm * D.stormInflow : 0;
  r.dustHeight = D.height + (D.stormHeight - D.height) * (storm < 1 ? storm : 1);
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
  const sun = L.sunScale / Math.tan(el);
  r.lightStep = L.step * (sun < L.sunCap ? sun : L.sunCap) * (L.refSteps / (r.lightSteps > 0 ? r.lightSteps : 1));
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
