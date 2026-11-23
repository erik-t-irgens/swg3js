// `__debug.stars()` (the GPU port's pass 2, wave 3, maker A): the night sky's report and its dials from the console.
//
//   - `stars()`: what this world's night draws (its system and place, the stars a tier draws and how faint they reach, the
//     band's bake, the sky's turn, the towns), the dials as they stand and the line that keeps any moved;
//   - `stars({ tune, counts, tilt, flare })`: the dials moved, exactly as the debug menu's `stars` sliders move them;
//   - `stars({ shape })`: the galaxy's shape (`MILKY_SHAPE`), which the map's disc and the band both read (the band bakes
//     again at the next frame, the map's disc at its next build);
//   - `await stars({ band: true })`: the band's picture read back (never in a frame) and held to the density's own sums along a
//     few of its texels' directions, and where its brightest stretch lies against the map's middle;
//   - `stars({ off: true })`: the night not drawn (the prover's A/B on one screen), `{ off: false }` puts it back.
//
// No three's WebGPU build here: the world's night is reached through its interface.
import type { GpuNightSky } from '../../core/gpuSwitch.ts';
import { movedLine } from '../../ui/dials.ts';
import { BAND_SIZE, MILKY_SHAPE, bandDirOf, bandRay, bandUnit, numberParams, tuneShape } from './galaxyDensity.ts';
import { CITY_GLOW, FLARE_AIR, NIGHT_TUNE, STAR_COUNTS, nightDialSet, tiltOf, tuneNight } from './nightTune.ts';
import { AIR_UNITS } from '../air/airApi.ts';
import { nightPlaceOf } from './nightPlace.ts';
import { DITHER_TUNE, ditherReport, tuneDither } from './ditherTune.ts';

/** What the console's helper reads of the game. */
export interface StarsHost {
  webgpu: boolean;
  ours: boolean;
  space: boolean;
  planet: string | null;
  night: GpuNightSky | null;
}

/** The band's read-back held to the density's sums at a few texels, and its brightest texel against the map's middle. */
async function bandCheck(night: GpuNightSky, planet: string): Promise<Record<string, unknown>> {
  const pic = await night.readBand();
  const W = BAND_SIZE.width;
  const H = BAND_SIZE.height;
  let best = 0;
  let at = 0;
  for (let i = 0; i < W * H; i++) {
    if (pic[i * 2] > best) {
      best = pic[i * 2];
      at = i;
    }
  }
  const dir = [0, 0, 0];
  bandDirOf(((at % W) + 0.5) / W, (Math.floor(at / W) + 0.5) / H, dir);
  const place = nightPlaceOf(planet).placeOf();
  const toMiddle = [-place.x, -place.y, -place.z];
  const l = Math.hypot(toMiddle[0], toMiddle[1], toMiddle[2]) || 1;
  const angle = (Math.acos(Math.max(-1, Math.min(1, (dir[0] * toMiddle[0] + dir[1] * toMiddle[1] + dir[2] * toMiddle[2]) / l))) * 180) / Math.PI;
  // A few texels against the density's own sum along their directions (the numbers' twin of the card's bake).
  const p = numberParams();
  const unit = bandUnit(AIR_UNITS.scene, p);
  const rows: Record<string, unknown>[] = [];
  let worst = 0;
  for (const [tu, tv] of [[0.13, 0.5], [0.37, 0.49], [0.5, 0.52], [0.71, 0.5], [0.9, 0.3], [0.25, 0.75], [0.6, 0.1]]) {
    const x = Math.floor(tu * W);
    const y = Math.floor(tv * H);
    const d = [0, 0, 0];
    bandDirOf((x + 0.5) / W, (y + 0.5) / H, d);
    const s = bandRay(place.x, place.y, place.z, d[0], d[1], d[2], p);
    const want = s.light * unit;
    const got = pic[(y * W + x) * 2];
    const err = want > 0 ? Math.abs(got - want) / want : Math.abs(got);
    if (err > worst) worst = err;
    rows.push({ texel: [x, y], card: got, numbers: want, warmCard: Number(pic[(y * W + x) * 2 + 1].toFixed(3)), warmNumbers: Number(s.warm.toFixed(3)), error: Number(err.toFixed(4)) });
  }
  return { brightest: best, brightestDir: dir.map((v) => Number(v.toFixed(3))), degreesFromTheMapsMiddle: Number(angle.toFixed(1)), texels: rows, worstError: Number(worst.toFixed(4)) };
}

/** The helper itself: words, the report and the dials, or a promise of them with `band`. */
export function starsConsole(host: StarsHost, o?: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>> {
  const said: string[] = [];
  if (o && typeof o === 'object') {
    if ('tune' in o || 'counts' in o || 'tilt' in o || 'flare' in o) said.push(...tuneNight(o));
    if (o.shape !== undefined) said.push(...(o.shape && typeof o.shape === 'object' ? tuneShape(o.shape as Record<string, unknown>) : ['shape: not a record']));
    // The prover's switch: the night not drawn, for an A/B on one screen (a picture, a timing).
    if (typeof o.off === 'boolean' && host.night) host.night.off = o.off;
    // Pass 2, wave 4b (maker B): the screen's dither (`ditherTune.ts`), levels of 255 either way; 0 none.
    if (o.dither !== undefined) said.push(...tuneDither(o.dither));
  }
  const dials = {
    tune: { ...NIGHT_TUNE },
    counts: { ...STAR_COUNTS },
    flare: { ...FLARE_AIR },
    tilt: host.planet ? { [host.planet]: { ...tiltOf(host.planet) } } : {},
    shape: { ...MILKY_SHAPE },
    townGlow: { ...CITY_GLOW },
    keep: movedLine(nightDialSet()) || 'nothing moved',
    dither: { ...ditherReport(), keep: DITHER_TUNE.amount === 1 ? 'at its start' : `__debug.stars({ dither: ${DITHER_TUNE.amount} })` },
  };
  const why = !host.webgpu
    ? "WebGPU's: WebGL keeps SWG's star field"
    : !host.ours
      ? "under our sky alone (the Sky row): SWG's sky keeps SWG's star field"
      : host.space
        ? "a planet's: a space zone keeps its own skybox and stars"
        : !host.night
          ? 'no night made yet for this sky'
          : null;
  const base = { ...(said.length ? { said } : {}), ...(why ? { why } : {}), ...(host.night ? host.night.report() : {}), dials };
  if (o && typeof o === 'object' && o.band === true && host.night && host.planet) {
    const night = host.night;
    const planet = host.planet;
    return bandCheck(night, planet).then((band) => ({ ...base, bandCheck: band }));
  }
  return base;
}
