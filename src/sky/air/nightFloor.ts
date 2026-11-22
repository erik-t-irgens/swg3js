// The night floor (the GPU port's pass 2, wave 1; the wave's small question 2), until wave 2's eye adaptation retires it.
//
// The air makes nights physically dark: with the sun under the horizon the twin's light is the moon's, a few millionths of
// the sun's, and the sky view's is little more. Nothing adapts to that before wave 2, so until then today's night stands as
// a floor under the air's, in two parts. **By night** each light the twin writes (the main light, the hemisphere's halves,
// the fill) and the fog colour the rain and the wet look read are held at no less than SWG's own of that hour (`AIR.swg`,
// which the air's maker keeps before the twin writes over it) times the floor's share, channel by channel, so the night is
// today's; the sky's dome likewise (`airSky.ts`). **At every hour** the main light and the hemisphere's two halves keep at
// least today's night brightness (SWG's own at the night's middle, `AIR.swgNight`, times the share) in the colour they
// have: by day the air is far brighter than that and nothing moves, but through the twilight, where the first part has let
// go by the sun's height and the air's light is still a twentieth of today's night, the reddened low sun and its sky are
// held up to the night's level rather than dropping the world into the darkest hour of the day (the wave's review: dawn
// and dusk 8 times darker than the night either side of them). Named `NIGHT_FLOOR` so wave 2 takes it out whole.
//
// Pure: no three, no DOM; the node test runs it. Nothing allocated.

/**
 * The floor's dials (the debug menu's sky dials and `__debug.sky({ floor })`):
 *   - `share`: how much of today's night stands as the floor. 1 is today's night brightness in full, the wave's default
 *     (question 2's answer: "the twin holds today's night brightness as a floor"); 0 is the air's physical night.
 *   - `dayAt` and `nightAt`: the sine of the sun's elevation at which today's colours of the hour begin to be held (above it
 *     nought) and are held whole (below it). 0.05 (about 3 degrees up) and -0.1 (about 6 degrees down, the end of civil
 *     twilight) let the dusk keep the air's own reddening and today's night colours come in as the twilight goes; the
 *     night's brightness holds through the band whatever they say.
 */
export const NIGHT_FLOOR = { share: 1, dayAt: 0.05, nightAt: -0.1 };

/**
 * The column of SWG's ramps (`DayCycle.colorIndex`) that is the night's middle: the normalised day's 0.75, where SWG's own
 * path has the moon at its highest and `__debug.sky('night')` stands. The floor's night brightness is read there.
 */
export const NIGHT_INDEX = 192;

/**
 * The floor's kept numbers: [the sun's sine, the weight, a light's scale, today's scale, the held scale, the night's
 * brightness]. A frame hands its numbers through these and never across a call (a number handed to or back from a call the
 * compiler leaves out is a number made, CLAUDE.md), so `applyNightFloor` allocates nothing whichever of its helpers is built in.
 */
const K = new Float64Array(6);

/** The weight at `K[0]`'s sun, into `K[1]`. */
function weightIn(): void {
  const a = NIGHT_FLOOR.dayAt;
  const b = NIGHT_FLOOR.nightAt;
  const span = a - b;
  const sunY = K[0];
  let t = span > 1e-9 ? (a - sunY) / span : sunY < a ? 1 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const s = t * t * (3 - 2 * t);
  const share = NIGHT_FLOOR.share > 0 ? NIGHT_FLOOR.share : 0;
  K[1] = s * share;
}

/** How much of today's colours of the hour stand at a sun whose elevation's sine is `sunY`: nought by day, the share by night, smooth between. */
export function nightFloorWeight(sunY: number): number {
  K[0] = sunY;
  weightIn();
  return K[1];
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The fields of `SwgSky.lighting` the floor holds up (each light as a colour and its scale, as the world turns them into lights, and the fog's colour). */
export interface FloorLighting {
  main: Rgb;
  mainScale: number;
  ambient: Rgb;
  ambientScale: number;
  bounce: Rgb;
  bounceScale: number;
  fill: Rgb;
  fillScale: number;
  fog: Rgb;
}

/**
 * One light held at its floor: `c · K[2]` (the air's) against `f · K[3] · K[1]` (today's times the weight), channel by channel
 * the larger, written back as a colour and, into `K[4]`, a scale, the way the world reads them (the scale the larger of the two
 * luminances, the colour the held light over it).
 */
function holdIn(c: Rgb, f: Rgb): void {
  const s = K[2];
  const k = K[3] * K[1];
  const fr = f.r * k;
  const fg = f.g * k;
  const fb = f.b * k;
  const ar = c.r * s;
  const ag = c.g * s;
  const ab = c.b * s;
  const r = ar > fr ? ar : fr;
  const g = ag > fg ? ag : fg;
  const b = ab > fb ? ab : fb;
  if (r === ar && g === ag && b === ab) {
    K[4] = s;
    return;
  }
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (!(lum > 1e-12)) {
    c.r = c.g = c.b = 0;
    K[4] = 0;
    return;
  }
  c.r = r / lum;
  c.g = g / lum;
  c.b = b / lum;
  K[4] = lum;
}

/**
 * One light's brightness held at no less than the night's (`n · K[5]`, the night's luminance at the share, in scale units)
 * in its own colour `c` at scale `K[4]`, the held scale back into `K[4]`: a light the air leaves black takes the night's
 * colour. Its hue is never moved where it has one, so the twilight keeps the air's reddening.
 */
function brightIn(c: Rgb, n: Rgb): void {
  const want = K[5];
  if (!(want > 0)) return;
  const lc = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const have = K[4] * lc;
  if (have >= want) return;
  if (lc > 1e-9) {
    K[4] = want / lc;
    return;
  }
  const ln = 0.2126 * n.r + 0.7152 * n.g + 0.0722 * n.b;
  if (!(ln > 1e-12)) return;
  c.r = n.r / ln;
  c.g = n.g / ln;
  c.b = n.b / ln;
  K[4] = want;
}

/** The night's brightness of a light at the share, in scale units: its scale times its colour's luminance, into `K[5]`. */
function nightIn(n: Rgb, scale: number): void {
  const share = NIGHT_FLOOR.share > 0 ? NIGHT_FLOOR.share : 0;
  K[5] = scale * (0.2126 * n.r + 0.7152 * n.g + 0.0722 * n.b) * share;
}

/**
 * The floor laid under the lighting the twin wrote (`L`, `SwgSky.lighting`'s fields), from SWG's own of the hour (`swg`, the air's
 * maker's `AIR.swg`) and of the night's middle (`night`, `AIR.swgNight`), at the sun's direction `sun` (its `y` the sine of its
 * elevation; the vector itself is handed, so no number crosses the call). By day nothing changes (the weight nought, the air
 * brighter than the night); with the share at nought nothing at any hour. Allocates nothing: every number goes through `K`.
 */
export function applyNightFloor(L: FloorLighting, swg: FloorLighting, night: FloorLighting, sun: { readonly y: number }): void {
  if (!(NIGHT_FLOOR.share > 0)) return;
  K[0] = sun.y;
  weightIn();
  // Today's colours of the hour, by the sun's height (nought by day): the four lights, then the fog's colour.
  K[2] = L.mainScale;
  K[3] = swg.mainScale;
  if (K[1] > 0) holdIn(L.main, swg.main);
  else K[4] = K[2];
  // Today's night brightness, at every hour, in the light's own colour (the main light and the hemisphere's halves: the
  // fill is a second sun's alone on our sky, black on a world of one star, and stays so by day).
  nightIn(night.main, night.mainScale);
  brightIn(L.main, night.main);
  L.mainScale = K[4];
  K[2] = L.ambientScale;
  K[3] = swg.ambientScale;
  if (K[1] > 0) holdIn(L.ambient, swg.ambient);
  else K[4] = K[2];
  nightIn(night.ambient, night.ambientScale);
  brightIn(L.ambient, night.ambient);
  L.ambientScale = K[4];
  K[2] = L.bounceScale;
  K[3] = swg.bounceScale;
  if (K[1] > 0) holdIn(L.bounce, swg.bounce);
  else K[4] = K[2];
  nightIn(night.bounce, night.bounceScale);
  brightIn(L.bounce, night.bounce);
  L.bounceScale = K[4];
  if (!(K[1] > 0)) return;
  K[2] = L.fillScale;
  K[3] = swg.fillScale;
  holdIn(L.fill, swg.fill);
  L.fillScale = K[4];
  // The fog's colour the rain, the particles' fog and the wet look read (`uWetSky`): held by night as the lights are, so the
  // night's rain and wet streets are today's, not the black of the air's moonlit horizon.
  const k = K[1];
  const fr = swg.fog.r * k;
  const fg = swg.fog.g * k;
  const fb = swg.fog.b * k;
  if (L.fog.r < fr) L.fog.r = fr;
  if (L.fog.g < fg) L.fog.g = fg;
  if (L.fog.b < fb) L.fog.b = fb;
}
