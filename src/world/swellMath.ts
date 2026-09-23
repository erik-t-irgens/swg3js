// The sea's swell on the CPU: the same eight-wave Gerstner sum the water's vertex program runs,
// from the very uniform arrays that program is given, at the very clock it is given. Nothing here
// is imported and nothing here allocates, so a node test runs exactly what the game runs and the
// springs may call it once per hover point per physics step without making a frame's worth of
// garbage.
//
// # Which of the three heights this answers
//
// The drawn sea is not one height. There are three, and they differ:
//
//   1. **Authored** -- the surface the wave set describes: `sum a_i * sin(k_i * (d_i . p) - w_i t)`,
//      evaluated wherever it is asked, at whatever scale the caller hands in. Nothing samples it,
//      nothing fades it, nothing rounds it off.
//   2. **Drawn** -- where the mesh's vertices actually end up. The vertex program fades the swell by
//      camera distance and by water depth (`swellFade` below mirrors that line), and then the near
//      sea is a 3000 m plane at 200 segments, so the surface between vertices is a bilinear
//      interpolation over a 15 m quad while the waves themselves run 7.5 m to 38 m. Seven of the
//      eight waves are shorter than the 30 m that grid can resolve at all.
//   3. **Shaded** -- what the fragment program evaluates for the normal. It runs the same waves again
//      at a *different* scale (`SWELL_SHADED_CALM`, and no `uWaveHeight` at all), so the shading has
//      never agreed in amplitude with the geometry under it. It moves no vertex and is not a height.
//
// **This module answers the authored height**, at the scale the caller names, and it says so here
// rather than leaving it to be discovered: hand it `uWaveHeight` and it is the swell as authored;
// hand it `swellFade(...)` and it is the authored swell at the *drawn scale*, which is still not the
// drawn surface. It is never the shaded one.
//
// Two things follow, and a caller that floats something on this has to know both.
//
// **The mesh cannot draw what this answers.** Measured over the game's own sea state on its own
// 15 m grid, the bilinear surface the mesh really draws carries about 57 per cent of the authored
// r.m.s. and differs from it by about 0.28 m r.m.s. -- nearly as much as the drawn surface's own
// size. `swellQuadGain` and `swellResolves` below are why, and `notes.md` beside this wave has the
// measurement. So a hull floating on this bobs with the right size and rhythm and does **not** trace
// the crests the picture shows; that disagreement is arithmetic, not a bug, and only the owner's eye
// can say whether it reads badly.
//
// **The phase warp is left out** (the owner's decision, D18). The shader moves every wave's phase at
// a point by one shared `phaseWarp(p)` of two octaves of value noise, roughly +-1.5 rad. Leaving it
// out gives the same sea -- the same reach, the same r.m.s., the same rhythm -- in a different phase:
// measured, the two are 0.85 correlated and differ by about 0.19 m r.m.s. It is also the one part of
// the shader that could not be mirrored honestly even if we wanted it: it is a `fract` hash of a
// float, the card computes it in 32 bits and JavaScript in 64, and on the same points the two
// arithmetics disagree by more than 0.1 rad at 89 per cent of them and by up to 2.8 rad at worst.
// `swellProbe.ts` reads the card's own warp back, for the owner to settle by measurement.
//
// **The sideways term is ignored by `swellHeight`.** The shader's `gerstner` moves a point in xz as
// well as in y (that is what makes a Gerstner crest sharp), so "the height at a world xz" is strictly
// an inverse problem: the surface point standing over a given xz was authored somewhere else. The
// forward sum -- reading the height at the authored point and calling it the height at that xz -- is
// what `swellHeight` does, and against a converged solve it is 0.047 m r.m.s. out, 0.29 m at worst.
// `swellHeightSolved` is the inverse, by fixed point; one step is within 3 mm r.m.s. of converged
// and two within 0.4 mm. Which of the two a caller wants is the caller's; neither pretends the term
// is not there.
//
// Everything in this file is the shader's own arithmetic, so none of the numbers here are ours to
// choose: the constants below are pinned against the GLSL's own text by `tools/swg/tests/swell.test.ts`,
// which fails rather than letting the two drift silently.

/**
 * One wave, exactly as the shader's `uWaves[i]` holds it: a unit direction in the world's xz plane
 * (x, y), the wavenumber k in radians a metre (z), and the amplitude in metres (w). A
 * `THREE.Vector4` is one of these without a cast, which is the point: the caller hands over the live
 * uniform array and nothing is copied.
 */
export interface SwellWave {
  /** The wave's heading, world X. */
  readonly x: number;
  /** The wave's heading, world Z. */
  readonly y: number;
  /** Wavenumber k = 2 pi / wavelength, radians a metre. */
  readonly z: number;
  /** Amplitude in metres, before the scale. */
  readonly w: number;
}

/** A three-slot record the sideways answers are written into, so nothing allocates per call. */
export interface SwellDisplacement {
  /** Metres the surface point is carried along world X. */
  x: number;
  /** Metres the point rises over the mean surface. */
  y: number;
  /** Metres the surface point is carried along world Z. */
  z: number;
}

/**
 * The gravity in the shader's dispersion relation, `omega = sqrt(9.81 k)`, as `seaState` writes it.
 * Not standard gravity (9.80665): it is the number the sea state was generated with, and the periods
 * below have to be worked out with the same one or the mirror's rhythm is not the shader's.
 */
export const SWELL_GRAVITY = 9.81;

/**
 * The vertex program's two fades, mirrored from
 * `uWaveHeight * (1.0 - smoothstep(900.0, 1400.0, dist)) * smoothstep(0.3, 5.0, waterDepth(wp.xz))`.
 * The far one flattens the sea where the mesh is too coarse to carry it; the shallow one dies away
 * at the shore so the waterline holds still.
 */
export const SWELL_FADE = {
  /** Metres from the camera the swell is still whole within. */
  farNear: 900,
  /** Metres from the camera past which the sea is flat. */
  farFar: 1400,
  /** Metres of water under the point that the swell starts to come up at. */
  shallowNear: 0.3,
  /** Metres of water under the point the swell is whole from. */
  shallowFar: 5,
} as const;

/**
 * The fragment program's own scale, `smoothstep(0.15, 3.0, depth)`. It is here to be pinned and to
 * be named, not to be used: the shaded surface has never agreed in amplitude with the geometry (it
 * takes no `uWaveHeight` either), and nothing that floats should read it.
 */
export const SWELL_SHADED_CALM = {
  near: 0.15,
  far: 3,
} as const;

/** The shader's steepness numerator and the epsilon that keeps its divisor off zero. Sideways only. */
export const SWELL_STEEP = 0.55;
export const SWELL_STEEP_EPS = 1e-4;

/**
 * The near sea's quad: a 3000 m plane at 200 segments (`WATER_NEAR` / `WATER_SEGMENTS` in
 * `world.ts`), so 15 m between vertices. Everything below about how much of the swell survives is
 * measured against this.
 */
export const SWELL_SEA_QUAD = 15;

/** GLSL's own `smoothstep`, so the fades are the shader's curve and not an eased guess. */
export function swellSmoothstep(edge0: number, edge1: number, x: number): number {
  if (!(edge1 > edge0)) return x < edge0 ? 0 : 1;
  let t = (x - edge0) / (edge1 - edge0);
  if (!(t > 0)) return 0;
  if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

/**
 * The scale the vertex program gives the swell at a point: the material's own wave height, faded out
 * far from the camera and in the shallows. A caller that wants the height the mesh was *asked* for
 * multiplies its own `swellHeight` by this; a caller that wants the sea as authored passes
 * `uWaveHeight` straight in instead.
 *
 * The depth is the water's surface less the ground under it, in metres, as the shader's own depth
 * window measures it -- a caller with no depth to hand should pass a deep one rather than zero,
 * since zero reads as dry land and flattens the sea.
 */
export function swellFade(waveHeight: number, cameraDistance: number, waterDepth: number): number {
  if (!Number.isFinite(waveHeight) || waveHeight === 0) return 0;
  const far = 1 - swellSmoothstep(SWELL_FADE.farNear, SWELL_FADE.farFar, cameraDistance);
  const shallow = swellSmoothstep(SWELL_FADE.shallowNear, SWELL_FADE.shallowFar, waterDepth);
  return waveHeight * far * shallow;
}

/** How many members of the set both arrays really carry, so a short omega array cannot read undefined. */
function memberCount(waves: readonly SwellWave[], omega: readonly number[]): number {
  return waves.length < omega.length ? waves.length : omega.length;
}

/**
 * The authored swell's height over the mean surface at a world xz and a clock, in metres.
 *
 * This is `disp.y` of the shader's `gerstner` and nothing else: the sum of `a * sin(phase)` over the
 * set, with the phase `k * (d . p) - omega * t` and the steepness left where it belongs, on the
 * sideways term. Positive is up.
 *
 * The height is exactly linear in `scale` -- the shader multiplies each amplitude by it and the sum
 * is linear -- so one reading at scale 1 answers every scale, which is what lets `swellProbe` take
 * one measurement and the caller apply its own fade. (The *sideways* term is not linear in the
 * scale, because the steepness divides by it, so `swellHeightSolved` is given the real scale.)
 *
 * A scale of 0 is a flat material -- every lake -- and answers 0 without touching the set. Anything
 * that is not a number answers 0 as well rather than handing a NaN to a spring: one NaN in a hull's
 * pose is a hull thrown out of the world.
 */
export function swellHeight(waves: readonly SwellWave[], omega: readonly number[], x: number, z: number, time: number, scale: number): number {
  if (!Number.isFinite(scale) || scale === 0) return 0;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(time)) return 0;
  const n = memberCount(waves, omega);
  let h = 0;
  for (let i = 0; i < n; i++) {
    const w = waves[i];
    h += w.w * Math.sin(w.z * (w.x * x + w.y * z) - omega[i] * time);
  }
  return h * scale;
}

/**
 * How fast the authored surface is rising at a point, in metres a second: the height's own derivative
 * in time, `sum a * -omega * cos(phase)`. Nothing in the game needs it to float something (the
 * springs read a height and work the rest out themselves), and it is here because it is the honest
 * answer to "how violent is this" -- over the game's own sea state it reaches about 2 m/s.
 */
export function swellRate(waves: readonly SwellWave[], omega: readonly number[], x: number, z: number, time: number, scale: number): number {
  if (!Number.isFinite(scale) || scale === 0) return 0;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(time)) return 0;
  const n = memberCount(waves, omega);
  let v = 0;
  for (let i = 0; i < n; i++) {
    const w = waves[i];
    v += w.w * -omega[i] * Math.cos(w.z * (w.x * x + w.y * z) - omega[i] * time);
  }
  return v * scale;
}

/**
 * The whole Gerstner displacement of the authored point `(x, z)`: where the surface point over it
 * goes, sideways as well as up, written into `out` so nothing allocates. This is the forward map the
 * shader applies to a vertex, steepness and all.
 *
 * The steepness divisor is the number of members both arrays really carry. That is the same number
 * as the GLSL's `float(${WAVE_COUNT})` **only because both uniform arrays are always that long**:
 * the shader bakes the literal 8 into its program whatever the arrays hold, so a shorter set handed
 * to this function would be scaled the way a shader built for it would scale it and not the way the
 * one in play does. Both are 8 today and the test pins that; this note is here so the difference is
 * on the record rather than discovered.
 */
export function swellDisplacement(waves: readonly SwellWave[], omega: readonly number[], x: number, z: number, time: number, scale: number, out: SwellDisplacement): SwellDisplacement {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  if (!Number.isFinite(scale) || scale === 0) return out;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(time)) return out;
  const n = memberCount(waves, omega);
  for (let i = 0; i < n; i++) {
    const w = waves[i];
    const a = w.w * scale;
    const steep = Math.min(SWELL_STEEP / (w.z * a * n + SWELL_STEEP_EPS), 1);
    const phase = w.z * (w.x * x + w.y * z) - omega[i] * time;
    const c = Math.cos(phase);
    out.x += w.x * (steep * a * c);
    out.z += w.y * (steep * a * c);
    out.y += a * Math.sin(phase);
  }
  return out;
}

/**
 * The inverse: the height of the surface point that really stands over the world xz, found by
 * asking which authored point the sideways term carries there. A plain fixed point -- guess the
 * authored point, displace it, take the miss off the guess -- which converges because the sideways
 * carry is bounded by the amplitudes and small against the wavelengths.
 *
 * Measured on the game's own sea state: one step is within 3 mm r.m.s. of converged, two within
 * 0.4 mm, four within 7 micrometres. The forward sum with no solve at all (`swellHeight`) is 0.047 m
 * r.m.s. out and 0.29 m at worst, which is the price of ignoring the term and is why this exists.
 *
 * It costs `steps + 1` passes over the set where `swellHeight` costs one, so a caller floating
 * something in a physics step should know what it is buying. Nothing allocates.
 */
export function swellHeightSolved(waves: readonly SwellWave[], omega: readonly number[], x: number, z: number, time: number, scale: number, steps: number): number {
  if (!Number.isFinite(scale) || scale === 0) return 0;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(time)) return 0;
  const n = memberCount(waves, omega);
  const rounds = Number.isFinite(steps) && steps > 0 ? Math.min(Math.floor(steps), 16) : 0;
  let qx = x;
  let qz = z;
  for (let s = 0; s < rounds; s++) {
    let dx = 0;
    let dz = 0;
    for (let i = 0; i < n; i++) {
      const w = waves[i];
      const a = w.w * scale;
      const steep = Math.min(SWELL_STEEP / (w.z * a * n + SWELL_STEEP_EPS), 1);
      const c = Math.cos(w.z * (w.x * qx + w.y * qz) - omega[i] * time);
      dx += w.x * (steep * a * c);
      dz += w.y * (steep * a * c);
    }
    qx = x - dx;
    qz = z - dz;
  }
  return swellHeight(waves, omega, qx, qz, time, scale);
}

/**
 * How far the swell can lift the surface over its mean at all: the summed amplitudes times the
 * scale. The CPU twin of `waveReach` in `water.ts`, and the bound every height above is inside --
 * about 1.19 m at scale 1 for the game's own sea state, which reaches about 94 per cent of it over
 * ten minutes at a point, since eight waves rarely crest together.
 */
export function swellReach(waves: readonly SwellWave[], scale: number): number {
  if (!Number.isFinite(scale) || scale === 0) return 0;
  let sum = 0;
  for (let i = 0; i < waves.length; i++) sum += Math.abs(waves[i].w);
  return sum * Math.abs(scale);
}

/** A wave's length in metres from its wavenumber. */
export function swellWavelength(k: number): number {
  return k > 0 ? (2 * Math.PI) / k : Infinity;
}

/**
 * A wave's period in seconds on the shader's own dispersion relation, `omega = sqrt(g k)`. The set's
 * members run about 2.2 s to 4.6 s; the sum of them at a point has no period at all, since eight
 * incommensurate rhythms never come back together -- its mean zero-up-crossing period is about 4.1 s,
 * which is the number to quote for "how often a hull rises".
 */
export function swellPeriod(k: number): number {
  return k > 0 ? (2 * Math.PI) / Math.sqrt(SWELL_GRAVITY * k) : Infinity;
}

/** Whether a mesh at this quad size resolves a wave at all: two samples a wavelength, Nyquist's own rule. */
export function swellResolves(k: number, quadMetres: number): boolean {
  return k > 0 && quadMetres > 0 && k * quadMetres <= Math.PI;
}

/**
 * How much of one wave a mesh at this quad size carries: the r.m.s. of a piecewise-linear
 * reconstruction of a sine sampled at that spacing, over the r.m.s. of the sine itself, averaged over
 * where the samples happen to fall. It works out as `sqrt((2 + cos(k * quad)) / 3)`: 1 for a wave
 * much longer than the quad, and 0.577 for one exactly at Nyquist, so even a wave the grid *does*
 * resolve loses nearly half its size.
 *
 * Past Nyquist (`swellResolves` false) this is only the energy that lands somewhere, not the wave:
 * the mesh draws a wave of another length altogether. Do not read it as fidelity there.
 */
export function swellQuadGain(k: number, quadMetres: number): number {
  if (!(k > 0) || !(quadMetres > 0)) return 1;
  return Math.sqrt((2 + Math.cos(k * quadMetres)) / 3);
}

/**
 * How badly a mesh at this quad size gets one wave wrong: the r.m.s. of (drawn minus true) over the
 * r.m.s. of the true wave, so 0 is exact and 1 is as wrong as drawing nothing at all. At Nyquist it
 * is 0.72; for the game's shortest wave on its own grid it is past 1, which is to say the mesh does
 * that wave more harm than leaving it out would.
 */
export function swellQuadError(k: number, quadMetres: number): number {
  if (!(k > 0) || !(quadMetres > 0)) return 0;
  const a = k * quadMetres;
  const term = 5 / 3 + Math.cos(a) / 3 - (4 * (1 - Math.cos(a))) / (a * a);
  return Math.sqrt(term > 0 ? term : 0);
}
