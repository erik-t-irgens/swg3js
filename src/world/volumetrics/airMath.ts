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
 * How strongly the air lifts the ground's pattern at a texel: `smoothstep(L, L + span, speed) · moves` [demo
 * `land.html:553`], `L` the lift threshold (`liftThreshold`). The shader's line, for the tests.
 */
export function sandLift(speed: number, threshold: number, span: number, moves: number): number {
  return smoothstep(threshold, threshold + span, speed) * moves;
}

/**
 * How fast a moved patch heals toward nought, a second: nothing until it has held `hold` seconds, then up to three of its
 * time constants across `heal` seconds, times the ground's own "heals" (never under 0.02) [demo `land.html:559`]. `age`
 * is in ticks of the 10 Hz clock.
 */
export function sandHealRate(ageTicks: number, hold: number, heal: number, heals: number): number {
  return smoothstep(hold, hold + 1, ageTicks * TICK) * (3 / (heal > 0.1 ? heal : 0.1)) * (heals > 0.02 ? heals : 0.02);
}

/**
 * One frame of the offsets at a texel, in the shader's order, into `s` (`o` the offset, `age` in ticks): `o(x − u·dt)
 * − u·dt` where the air lifts it -- `s` as handed in is the texel read upstream, `o(x − u·dt)`, which the shader reads
 * there and a caller here hands in as it stands -- the age started again where the lift passes `reset` and otherwise
 * grown by the ticks crossed, and past the hold healed by `exp(−rate · dt)`. Float64 arithmetic: the tests run it
 * through the field's float32 store and a half-float one of their own.
 */
export interface SandTexel {
  ox: number;
  oz: number;
  age: number;
}
export function sandStep(s: SandTexel, ux: number, uz: number, lift: number, dt: number, ticks: number, heals: number, t = AIR_TUNE.ground): void {
  s.ox -= ux * dt;
  s.oz -= uz * dt;
  s.age = lift > t.ageReset ? 0 : Math.min(s.age + ticks, t.ageCap);
  const k = sandHealRate(s.age, t.hold, t.heal, heals);
  if (k > 0) {
    const f = Math.exp(-k * dt);
    s.ox *= f;
    s.oz *= f;
  }
}

/**
 * The picture shift the tile ground samples one of its layers at, in the picture's own units (one repeat a 4 m tile):
 * the carried offset `o` (metres, world x and z) turned into the picture's frame -- the picture runs along the
 * terrain's x, which is the world's −x when the pictures are the client's way round (`frameZ` +1) -- times the layer's
 * own "moves", the art dial and the window's edge fade. **A uniform branch**: at a dial of nought nothing is worked out
 * and the shift is exactly nought, so the sample coordinate `uv + shift` is `uv` itself to the texture lookup (which
 * reads +0 and −0 alike). The offset is made finite before it is used. Into `out` (x, y).
 */
export function groundShift(ox: number, oz: number, moves: number, art: number, fade: number, frameZ: number, out: { x: number; y: number }): { x: number; y: number } {
  out.x = 0;
  out.y = 0;
  if (art !== 0) {
    const fx = Number.isFinite(ox) ? ox : 0;
    const fz = Number.isFinite(oz) ? oz : 0;
    const k = 0.25 * art * moves * fade;
    out.x = -frameZ * fx * k;
    out.y = fz * k;
  }
  return out;
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
