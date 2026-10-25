// The fourth wave's arithmetic on the CPU (the design's §2.16): what the particles' and the rain's programs do to one
// particle, written once so the node tests hold the shaders to it (`airParticleShaders.ts`' scalar functions run as
// script beside these) and so the console and the tests can say what a number does with no card. Every rule here is a
// line of a program; nothing here decides anything in play (rule 3).
//
// Pure: no three.

/** How much of the way to the air's speed a thing takes over a frame of `dt`: `1 − e^(−dt/τ)`, alike at any frame rate. */
export function pullShare(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / (tau > 1e-3 ? tau : 1e-3));
}

/**
 * The orographic lift (the design's §2.16): air blown against a slope or a wall rises, and sinks in its lee: `k ·
 * dot(v_air, ∇(ground + wall top))`, the gradient taken over a fixed span (four taps half the span either side, whatever
 * the air's cell), held to ±`most`. `airOroLift` in the programs.
 */
export function oroLift(vx: number, vz: number, gx: number, gz: number, k: number, most: number): number {
  const w = k * (vx * gx + vz * gz);
  return w < -most ? -most : w > most ? most : w;
}

/** The vortex lift: a swirl tighter than `from` a second lofts what it carries, `k · (|curl| − from)`, held under `most`. `airVortLift` in the programs. */
export function vortLift(curl: number, k: number, from: number, most: number): number {
  const a = curl < 0 ? -curl : curl;
  const w = k * (a > from ? a - from : 0);
  return w < most ? w : most;
}

/**
 * The gradient of a height field `h` (metres over x and z, read by `at`) over a span of `span` metres about (x, z), and
 * the orographic lift it gives the air (vx, vz): the programs' four taps, for the tests.
 */
export function oroLiftAt(at: (x: number, z: number) => number, x: number, z: number, vx: number, vz: number, span: number, k: number, most: number): number {
  const s = span > 1e-3 ? span : 1e-3;
  const gx = (at(x + s / 2, z) - at(x - s / 2, z)) / s;
  const gz = (at(x, z + s / 2) - at(x, z - s / 2)) / s;
  return oroLift(vx, vz, gx, gz, k, most);
}

/** A fine streak's length: its speed over `trail` seconds, held between `min` and `most` metres. `airStreakLength` in the programs. */
export function streakLength(speed: number, trail: number, min: number, most: number): number {
  const l = speed * trail;
  return l < min ? min : l > most ? most : l;
}

/** One coordinate of a particle stepped by a frame: in float32 when `f32`, as the card stores it. */
export function stepCoord(x: number, v: number, dt: number, f32: boolean): number {
  return f32 ? Math.fround(x + Math.fround(v * dt)) : x + v * dt;
}

/**
 * A slow drift carried for `seconds` at `fps` frames a second from `start` metres, in float32 as the card keeps a
 * position: how far it went. Relative to the window's corner (a start inside the window) it goes its own speed at every
 * frame rate; relative to the world's origin 8 km out, a step under half a float's spacing there is lost every frame.
 */
export function driftOver(start: number, v: number, seconds: number, fps: number): number {
  const dt = Math.fround(1 / fps);
  const frames = Math.round(seconds * fps);
  let x = Math.fround(start);
  for (let i = 0; i < frames; i++) x = stepCoord(x, v, dt, true);
  return x - Math.fround(start);
}

/**
 * A leaf on the ground, a frame: lying it counts its rest and stays; once the air over it passes `liftLeaf` of the
 * sand's lift threshold it is lifted again (its rest back to nought); past its rest and a second's fade it is gone. The
 * programs' own rule (`KICK_UPDATE_FRAGMENT`).
 */
export interface LeafRest {
  /** Seconds lying (nought: flying). */
  rest: number;
  /** The air's speed over it, m/s. */
  air: number;
  /** The sand's lift threshold, m/s, and the share that lifts a leaf. */
  threshold: number;
  liftLeaf: number;
  /** Seconds a leaf lies before it fades. */
  leafRest: number;
  dt: number;
  /** Out: the leaf was lifted this frame, or is gone. */
  lifted: boolean;
  gone: boolean;
}

export function leafRestIn(r: LeafRest): void {
  r.lifted = false;
  r.gone = false;
  if (!(r.rest > 0)) return;
  if (r.air > r.threshold * r.liftLeaf) {
    r.rest = 0;
    r.lifted = true;
    return;
  }
  r.rest += r.dt;
  if (r.rest > r.leafRest + 1) r.gone = true;
}

/**
 * The air past which the wind alone picks a kind up off the ground (`kickPickThreshold` in the program): the sand's lift
 * threshold, a leaf at `liftLeaf` of it, a fine streak at `streakLift` of it, a puff at the whole of it.
 */
export function pickThreshold(kind: number, threshold: number, liftLeaf: number, streakLift: number): number {
  return threshold * (kind === 0 ? liftLeaf : kind === 3 ? streakLift : 1);
}

/**
 * A drop's height relative to the rain's anchor once it has risen past the box's top (the camera coming down faster than
 * the drops fall): wrapped to the box's foot, as it is wrapped across (`rainRise` in the program); any other as it is.
 */
export function rainRise(y: number, below: number, above: number): number {
  const span = below + above > 1e-3 ? below + above : 1e-3;
  return y > above ? y - span * Math.ceil((y - above) / span) : y;
}

/** The share of the rain pool drawn:`fx.rain · weatherDensity · outside` (the weather's own falling strength), held to [0, 1]. */
export function fallShare(falling: number, density: number, outside: number): number {
  const s = falling * density * outside;
  return s > 0 ? (s < 1 ? s : 1) : 0;
}

/** Whether a slot is drawn at a share: its own hash under it (`airRand` of the slot), so no CPU work per drop. */
export function slotDrawn(rand: number, share: number): boolean {
  return rand < share;
}

/** A coordinate wrapped across the box of half-width `reach` about the anchor (the programs' `mod`). */
export function wrapBox(x: number, reach: number): number {
  const w = 2 * reach;
  const m = (x + reach) - w * Math.floor((x + reach) / w);
  return m - reach;
}

/**
 * The game's own rain and snow sheets' factor (`Weather.rainSheetScale`): `1 − thin` while ours draws, and exactly 1
 * otherwise -- the master off, our rain off, nothing of ours drawing -- so the sheets are today's.
 */
export function sheetFactor(oursDraws: boolean, thin: number): number {
  if (!oursDraws) return 1;
  const t = thin > 0 ? (thin < 1 ? thin : 1) : 0;
  return 1 - t;
}

/**
 * The rain's colour (the design's §2.16): `(L.ambient · L.ambientScale + L.main · L.mainScale · sunUp · (1 − overcast)) ·
 * bright`, `sunUp` a smoothstep from nought to `sunUpTo` of the sun direction's height; the sky's own scales, never
 * numbers of ours. Into `out` (linear rgb).
 */
export interface RainLight {
  ambient: readonly [number, number, number];
  ambientScale: number;
  main: readonly [number, number, number];
  mainScale: number;
  sunY: number;
  overcast: number;
  sunUpTo: number;
  bright: number;
}

export function rainColourIn(L: RainLight, out: [number, number, number]): [number, number, number] {
  const to = L.sunUpTo > 1e-4 ? L.sunUpTo : 1e-4;
  let t = L.sunY / to;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const up = t * t * (3 - 2 * t);
  const o = L.overcast > 0 ? (L.overcast < 1 ? L.overcast : 1) : 0;
  const k = L.mainScale * up * (1 - o);
  for (let i = 0; i < 3; i++) out[i] = (L.ambient[i] * L.ambientScale + L.main[i] * k) * L.bright;
  return out;
}

/** The rain's backlight against the sun: `base + lift · max(0, μ)^power`, μ the cosine between the view and the sun. */
export function backlight(mu: number, base: number, lift: number, power: number): number {
  return base + lift * Math.pow(mu > 0 ? mu : 0, power);
}
