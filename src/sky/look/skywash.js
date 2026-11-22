// The air in front of a body seen from the ground (looks run 2, item 7). By day the sky's light is the
// air between us and everything beyond it lit by the sun, so it lies in front of a moon as much as in
// front of the black of space: a moon's unlit side takes the sky's own colour (it vanishes into the blue,
// as our moon's does at noon), and its lit side is washed pale by the same light laid over it. The air
// also takes some of the body's own light away on the way (more toward the horizon, where the path
// through the air is longest, and more of the blue than the red, so a low moon yellows).
//
// One function, `skyWash`, so it can be replaced: the place view calls it for each body each frame and
// hands its answer to the body's materials (build.js: the body's own light times `trans`, plus `light`
// where the body hides the sky). Pass 2 of the game does the same with its real air later; this is the
// viewer's stand-in, read from the place view's own sky (the colour the sky dome draws in that direction).
// Pure: no three and no page. Colours are linear, as the renderer works in them.
import { F as AF, transmittanceAt } from './airProfile.js';

/**
 * The air's numbers, each a starting value to be moved by eye (feel is the owner's):
 *   inFront   how much of the sky's colour in the body's direction lies in front of it (1: all of it, as
 *             the sky's light is all in-scatter, with only black space behind the air)
 *   depth     the air's thickness straight up, per channel (red, green, blue): how much of a body's own
 *             light it takes, e^-(depth x air mass); about a clear day's (more in the blue)
 *   dayDim    how much dimmer a body's own light looks by full day, the eye being set for the bright sky
 *             (0: as by night; the owner's ask, a moon "pretty dim, like our own moon is IRL, during the
 *             daytime")
 *   thick     (the atmosphere brief's wave B) the air's thickness against its own (1): how much of a body's
 *             light it takes, as a share of its optical depth (0: none taken; 2: twice the air)
 *   sun       (wave B) how much of the drawn sun's own glow lies in front of a body beside it (1: all of it, as
 *             the glow is the air's light round the sun, between us and anything beyond; 0: none, as before)
 * Each is a slider over the stage (the Day wash box), a step of the history, kept in the file off its start.
 */
export const WASH = { inFront: 1, depth: [0.1, 0.15, 0.28], dayDim: 0.25, thick: 1, sun: 1 };

/**
 * (wave B) The drawn sun's glow seen in direction `d` (unit), for the wash in front of a body: each sun `s` of `suns`
 * (kept records: its direction x, y, z; `glowTan` and `discTan`, the tangent of its glow's and its disc's half-size
 * as drawn; `glow` and `disc`, each { r, g, b } linear already times its opacity) adds its glow's radial profile at the
 * body's angle from it, and its disc's beyond the sun's own edge (the fringe is glow; the disc itself lies behind a
 * body in front of it). Profiles are the stops the place view draws them with (`GLOW`, `DISC`). Adds into `out`.
 */
export function sunGlowAt(d, suns, n, out, share = 1, GLOW = SUN_GLOW_STOPS, DISC = SUN_DISC_STOPS) {
  if (!(share > 0)) return out;
  for (let i = 0; i < n; i++) {
    const s = suns[i];
    const c = Math.min(1, Math.max(-1, d.x * s.x + d.y * s.y + d.z * s.z));
    if (c <= 0) continue;
    const tanT = Math.sqrt(Math.max(0, 1 - c * c)) / c;
    const tg = s.glowTan > 0 ? tanT / s.glowTan : 2, td = s.discTan > 0 ? tanT / s.discTan : 2;
    const a = profileAt(GLOW, tg);
    // the disc's fringe beyond its bright edge (0.2 of its square's half), faded in so no step shows
    const b = profileAt(DISC, td) * smooth(td, 0.2, 0.3);
    out.r += (s.glow.r * a + s.disc.r * b) * share;
    out.g += (s.glow.g * a + s.disc.g * b) * share;
    out.b += (s.glow.b * a + s.disc.b * b) * share;
  }
  return out;
}
/** A radial profile's value at `t` (0 the centre, 1 the square's edge): the stops linearly between, as a canvas draws them. */
export function profileAt(stops, t) {
  if (!(t < 1)) return 0;
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, a1] = stops[i];
    if (t <= t1) { const [t0, a0] = stops[i - 1]; return a0 + ((a1 - a0) * (t - t0)) / Math.max(1e-9, t1 - t0); }
  }
  return 0;
}
/** The place view's own sun stops (placeview.js draws its sun with these): [t, alpha]. */
export const SUN_DISC_STOPS = [[0, 1], [0.16, 1], [0.2, 0.5], [0.26, 0.1], [0.5, 0.015], [1, 0]];
export const SUN_GLOW_STOPS = [[0, 0.6], [0.1, 0.38], [0.25, 0.18], [0.45, 0.07], [0.75, 0.015], [1, 0]];

const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The sky's colour in direction `d` ({ x, y, z }, y up, unit), as the place view's sky dome draws it:
 * horizon to zenith, the sun's glow round the sun, and drawn as the game does (`game` 1) its ramp's fog
 * at the horizon up to its clear colour overhead. `sky` holds the dome's uniforms' values ({ r, g, b }
 * colours, `sunDir`, `glowAmt`, `game`, `zenithAt`). Writes `out` ({ r, g, b }) and returns it.
 */
export function skyColour(d, sky, out) {
  const up = Math.pow(Math.max(d.y, 0), 0.55);
  const s = sky.sunDir, sl = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z) || 1;
  const glow = Math.pow(Math.max((d.x * s.x + d.y * s.y + d.z * s.z) / sl, 0), 18) * sky.glowAmt;
  let r = sky.horizon.r + (sky.zenith.r - sky.horizon.r) * up + sky.sunGlow.r * glow;
  let g = sky.horizon.g + (sky.zenith.g - sky.horizon.g) * up + sky.sunGlow.g * glow;
  let b = sky.horizon.b + (sky.zenith.b - sky.horizon.b) * up + sky.sunGlow.b * glow;
  const k = sky.game || 0;
  if (k > 0) {
    const t = smooth(d.y, 0, sky.zenithAt || 0.5);
    r += (sky.gHorizon.r + (sky.gZenith.r - sky.gHorizon.r) * t - r) * k;
    g += (sky.gHorizon.g + (sky.gZenith.g - sky.gHorizon.g) * t - g) * k;
    b += (sky.gHorizon.b + (sky.gZenith.b - sky.gHorizon.b) * t - b) * k;
  }
  out.r = r; out.g = g; out.b = b;
  return out;
}

/** The air mass toward an elevation of sin `sy` above the horizon (Kasten and Young's, held finite under it). */
export function airMass(sy) {
  const el = Math.asin(Math.max(-1, Math.min(1, sy))) * (180 / Math.PI);
  const e = Math.max(el, -1);
  return 1 / (Math.max(0, Math.sin(e * Math.PI / 180)) + 0.50572 * Math.pow(e + 6.07995, -1.6364));
}

/**
 * (the atmosphere brief's wave A, item 7) The same wash from the air itself, for a body whose air is Scattered: the
 * sky's light in front of it is the dome's own (what lies behind and in front of it is that one sky), and the share of
 * its light that comes through is the transmittance of the ground world's own air record from the ground toward it
 * (airProfile.js's table: `tabs`, the world's), so the body's air and ours are one model and nothing is laid on twice.
 * A Painted body keeps skyWash's, unchanged. Allocates nothing.
 */
export function airWash(d, sky, tabs, out, w = WASH) {
  skyColour(d, sky, out.light);
  out.light.r *= w.inFront; out.light.g *= w.inFront; out.light.b *= w.inFront;
  const rec = tabs.rec;
  transmittanceAt(rec, tabs, rec[AF.bottom] + 0.002, d.y, _airT);
  const dim = 1 - w.dayDim * Math.min(1, Math.max(0, sky.daylight || 0));
  // (wave B) the thickness slider: the optical depth times it (1: the air as it is; the power of 1 is exact)
  const k = w.thick ?? 1;
  out.trans.r = (k === 1 ? _airT[0] : Math.pow(_airT[0], k)) * dim;
  out.trans.g = (k === 1 ? _airT[1] : Math.pow(_airT[1], k)) * dim;
  out.trans.b = (k === 1 ? _airT[2] : Math.pow(_airT[2], k)) * dim;
  return out;
}
const _airT = [0, 0, 0];

/**
 * The air in front of a body in direction `d`: `out.light` ({ r, g, b }, what the air adds) and
 * `out.trans` ({ r, g, b }, the share of the body's own light that comes through). `sky` as skyColour's,
 * with `daylight` (0 night to 1 full day). `w` the numbers (WASH by default). Allocates nothing.
 */
export function skyWash(d, sky, out, w = WASH) {
  skyColour(d, sky, out.light);
  out.light.r *= w.inFront; out.light.g *= w.inFront; out.light.b *= w.inFront;
  // (wave B) the thickness slider times the air mass (1: as before)
  const m = airMass(d.y) * (w.thick ?? 1);
  const dim = 1 - w.dayDim * Math.min(1, Math.max(0, sky.daylight || 0));
  out.trans.r = Math.exp(-w.depth[0] * m) * dim;
  out.trans.g = Math.exp(-w.depth[1] * m) * dim;
  out.trans.b = Math.exp(-w.depth[2] * m) * dim;
  return out;
}
