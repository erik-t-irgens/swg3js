// The night sky (the GPU port's pass 2, wave 3, maker A: `src/sky/night/`): the galaxy's one density held to the map's disc and
// to the band, the band's quadrature against a fine sum, its core toward the map's middle and its units; each system's stars
// (deterministic, counted as a real sky is, sized and coloured); the sky's turn held to the day's own sun over a whole day; the
// towns' glow; the flare's sources from the air; every dial moved through the real tables; the tier read without a record; and
// the graphs built in node from the very density the numbers run.
//
// Run: node tools/swg/tests/nightSky.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GALAXY_SYSTEMS, GALAXY_TUNE, drawnSystems, systemPlace } from '../../../src/data/galaxy.ts';
import {
  BAND_RAY,
  BAND_REFERENCE,
  BAND_SIZE,
  DENSITY_CALLS,
  MILKY_SHAPE,
  MILKY_STATE,
  NUM_OPS,
  SUN_LUX,
  bandDirOf,
  bandRay,
  bandUnit,
  bandUvOf,
  cdOfMag,
  componentShares,
  densityAt,
  densityOf,
  hash2Number,
  numberParams,
  planeColumn,
  planeParams,
  sampleDisc,
  tuneShape,
} from '../../../src/sky/night/galaxyDensity.ts';
import { CATALOGUE, STAR_MOST, cardSize, catalogueOf, faintestOf, limitingMag, magnitudeOfRank, starLight, LIMIT_K } from '../../../src/sky/night/starCatalogue.ts';
import { DAY_AXIS, NOON, QUARTER, SWG_POLE_DEG, dayAngleOf, nightFrameInto, offCircle, tiltFrameInto } from '../../../src/sky/night/skyTurn.ts';
import { CITY_MOST, CityGlow, glowToward } from '../../../src/sky/night/cityGlow.ts';
import { CITY_GLOW, FLARE_AIR, NIGHT_STATE, NIGHT_TUNE, NIGHT_TUNE_RANGE, STAR_COUNTS, countOfTier, nightDialSet, starsDialsFor, tiltOf, tuneNight } from '../../../src/sky/night/nightTune.ts';
import { tierIndexOf } from '../../../src/sky/night/nightTier.ts';
import { AIR_FLARE_IN, FLARE_SEEN, FLARE_SEEN_OPEN, airFlareDiscs, airFlareLights, openFlareSeen } from '../../../src/sky/night/flareSources.ts';
import { PRE_FIXED } from '../../../src/sky/exposure/preExpose.ts';
import ts from 'typescript';
import { nightPlaceOf } from '../../../src/sky/night/nightPlace.ts';
import type { FxSkyLight } from '../../../src/core/fx/lensFlare.ts';
import { makeAirFrame } from '../../../src/sky/air/airApi.ts';
import { DayCycle } from '../../../src/world/daycycle.ts';
import { TIER_NAMES, tierOf, tierValues } from '../../../src/ui/qualityTiers.ts';
import { DEFAULT_SETTINGS } from '../../../src/core/settings.ts';
import { allDials, dialMoved, movedLine, resetDials } from '../../../src/ui/dials.ts';
import { sceneUnits } from '../../../src/sky/air/airTwin.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const text = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const SCENE = sceneUnits();

// ---------------------------------------------------------------- 1. one density: the map's disc drawn out of it
{
  const p = numberParams();
  ok(p.radius === GALAXY_TUNE.discRadius && p.arms === GALAXY_TUNE.discArms && p.thick === GALAXY_TUNE.discThickness, "the density reads the galaxy map's own radius, arms and thickness (GALAXY_TUNE)");
  // The map's disc, many points, counted in cells of radius and angle against the density's own mass in each.
  const n = 60000;
  const drawn = sampleDisc(n, 424242, p);
  const shares = componentShares(p);
  const rings = 6;
  const sectors = 12;
  const reach = 1.1 * p.radius;
  const count = new Float64Array(rings * sectors);
  for (let i = 0; i < n; i++) {
    const x = drawn.pos[i * 3];
    const z = drawn.pos[i * 3 + 2];
    const r = Math.hypot(x, z);
    if (r >= reach) continue;
    const ri = Math.min(rings - 1, Math.floor((r / reach) * rings));
    const si = Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * sectors) % sectors;
    count[ri * sectors + si]++;
  }
  // The density's mass in each cell: the plane's column summed over the cell, and the bulge's Gaussian's, by a fine grid.
  const plane = planeParams(p);
  const want = new Float64Array(rings * sectors);
  const cs = p.coreSize * p.radius;
  const bulgeTotal = p.coreShare * Math.pow(2 * Math.PI, 1.5) * cs * cs * (cs / p.coreFlat);
  let discTotal = 0;
  const grid = 300;
  const cell = (2 * reach) / grid;
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const x = -reach + (i + 0.5) * cell;
      const z = -reach + (j + 0.5) * cell;
      const r = Math.hypot(x, z);
      if (r >= reach) continue;
      const ri = Math.min(rings - 1, Math.floor((r / reach) * rings));
      const si = Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * sectors) % sectors;
      const disc = planeColumn(x, z, plane) * cell * cell;
      // The bulge's column at (x, z): its Gaussian integrated through y.
      const bulge = p.coreShare * Math.exp((-0.5 * r * r) / (cs * cs)) * Math.sqrt(2 * Math.PI) * (cs / p.coreFlat) * cell * cell;
      want[ri * sectors + si] += disc + bulge;
      discTotal += disc;
    }
  }
  ok(Math.abs(bulgeTotal / (bulgeTotal + discTotal) - shares.bulge) < 0.01, `the bulge's share the sampler uses is the density's own (${shares.bulge.toFixed(3)} against ${(bulgeTotal / (bulgeTotal + discTotal)).toFixed(3)})`);
  const all = want.reduce((a, b) => a + b, 0);
  let worst = 0;
  let worstAt = '';
  let chi = 0;
  let cells = 0;
  for (let k = 0; k < want.length; k++) {
    const e = (want[k] / all) * n;
    if (e < 50) continue;
    cells++;
    chi += ((count[k] - e) * (count[k] - e)) / e;
    // A cell's own spread: a draw's count scatters by its square root.
    const z = Math.abs(count[k] - e) / Math.sqrt(e);
    if (z > worst) {
      worst = z;
      worstAt = `ring ${Math.floor(k / sectors)}, sector ${k % sectors}: ${count[k]} against ${e.toFixed(0)}`;
    }
  }
  ok(chi / cells < 2.5, `the map's disc stands where the density says: ${cells} cells, chi-square ${(chi / cells).toFixed(2)} a cell (1 is the draw's own scatter)`);
  ok(worst < 4.5, `no cell of the disc further off the density's share than four and a half of its own spreads (worst ${worst.toFixed(2)}, ${worstAt})`);
  // The layer's thickness: the disc's points' spread in height against the density's own, in a ring away from the bulge.
  let s2 = 0;
  let m = 0;
  let h2 = 0;
  for (let i = 0; i < n; i++) {
    const x = drawn.pos[i * 3];
    const z = drawn.pos[i * 3 + 2];
    const t = Math.hypot(x, z) / p.radius;
    if (t < 0.45 || t > 0.55) continue;
    const y = drawn.pos[i * 3 + 1];
    s2 += y * y;
    m++;
    const h = p.thick * (1.2 - t) * 0.29;
    h2 += h * h;
  }
  const spread = Math.sqrt(s2 / m);
  const wantSpread = Math.sqrt(h2 / m);
  ok(Math.abs(spread / wantSpread - 1) < 0.05, `the disc's points stand as thick as the density's layer at half the radius (${spread.toFixed(2)} against ${wantSpread.toFixed(2)})`);
  // The map draws its disc out of this very sampler (pinned as text: the view needs a page).
  const view = text('src/ui/galaxyView.ts');
  ok(/import \{ sampleDisc \} from '\.\.\/sky\/night\/galaxyDensity\.ts';/.test(view) && /const drawn = sampleDisc\(n, 20030626\);/.test(view) && /new THREE\.BufferAttribute\(drawn\.pos, 3\)/.test(view), "the galaxy map's disc is `sampleDisc`'s points (galaxyView.ts)");
  // Deterministic: the same seed, the same disc.
  const again = sampleDisc(500, 424242, p);
  ok(again.pos.every((v, i) => v === drawn.pos[i]), 'the same seed draws the same disc');
}

// ---------------------------------------------------------------- 2. the band: the same density along a ray
{
  const p = numberParams();
  // The quadrature against a fine even sum of the density's own light, dust and all.
  const fine = (px: number, py: number, pz: number, dx: number, dy: number, dz: number): number => {
    const n = 200000;
    const S = BAND_RAY.reach * p.radius;
    const ds = S / n;
    const d = { emit: 0, warm: 0, dust: 0 };
    let tau = 0;
    let light = 0;
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * ds;
      densityAt(px + dx * s, py + dy * s, pz + dz * s, p, d);
      light += d.emit * Math.exp(-(tau + d.dust * ds * 0.5)) * ds;
      tau += d.dust * ds;
    }
    return light;
  };
  let worst = 0;
  let where = '';
  for (const id of ['tatoo', 'naboo', 'corellian', 'dantooine']) {
    const pl = systemPlace(GALAXY_SYSTEMS.find((s) => s.id === id)!);
    for (const [u, v] of [[0.1, 0.5], [0.3, 0.48], [0.55, 0.52], [0.8, 0.5], [0.2, 0.3], [0.65, 0.8]]) {
      const d = [0, 0, 0];
      bandDirOf(u, v, d);
      const a = bandRay(pl.x, pl.y, pl.z, d[0], d[1], d[2], p).light;
      const b = fine(pl.x, pl.y, pl.z, d[0], d[1], d[2]);
      const e = Math.abs(a - b) / b;
      if (e > worst) {
        worst = e;
        where = `${id} at (${u}, ${v})`;
      }
    }
  }
  ok(worst < 0.03, `the band's ${BAND_RAY.steps} steps hold the density's own sum along every tried ray within 3% (worst ${(worst * 100).toFixed(2)}%, ${where})`);
  // The picture's mapping both ways.
  let mapWorst = 0;
  for (let i = 0; i < 500; i++) {
    const u = (i * 0.6180339887) % 1;
    const v = 0.02 + ((i * 0.381966) % 0.96);
    const d = [0, 0, 0];
    const uv = [0, 0];
    bandDirOf(u, v, d);
    bandUvOf(d[0], d[1], d[2], uv);
    mapWorst = Math.max(mapWorst, Math.abs(uv[0] - u), Math.abs(uv[1] - v), Math.abs(Math.hypot(d[0], d[1], d[2]) - 1));
  }
  ok(mapWorst < 1e-9, `the band's picture maps a direction and back (${mapWorst.toExponential(1)})`);
  ok(BAND_SIZE.width * BAND_SIZE.height * 4 === 8 * 1024 * 1024, "the band's picture is 8 MB (2048 by 1024, two half floats a texel)");
  // Its units: the reference ray reads the reference's surface brightness in the scene's units.
  const unit = bandUnit(SCENE, p);
  const ref = bandRay(BAND_REFERENCE.r, 0, 0, -1, 0, 0, p).light * unit;
  ok(Math.abs(ref / ((cdOfMag(BAND_REFERENCE.peakMag) * SCENE) / SUN_LUX) - 1) < 1e-9, `the band's units put the reference stretch at ${BAND_REFERENCE.peakMag} magnitudes a square arcsecond (${ref.toExponential(3)} in the scene's units)`);
  // The core toward the map's middle: from every drawn system, the brightest of a grid of directions within 30 degrees of it.
  const lines: string[] = [];
  let far = 0;
  for (const sys of drawnSystems()) {
    const pl = systemPlace(sys);
    let best = 0;
    const bd = [0, 0, 0];
    for (let i = 0; i < 72; i++) {
      for (let j = 0; j < 19; j++) {
        const d = [0, 0, 0];
        bandDirOf((i + 0.5) / 72, 0.4 + (j / 18) * 0.2, d);
        const L = bandRay(pl.x, pl.y, pl.z, d[0], d[1], d[2], p).light;
        if (L > best) {
          best = L;
          bd[0] = d[0];
          bd[1] = d[1];
          bd[2] = d[2];
        }
      }
    }
    const l = Math.hypot(pl.x, pl.y, pl.z);
    const ang = (Math.acos(Math.max(-1, Math.min(1, -(bd[0] * pl.x + bd[1] * pl.y + bd[2] * pl.z) / l))) * 180) / Math.PI;
    far = Math.max(far, ang);
    lines.push(`${sys.id} ${ang.toFixed(0)}°`);
  }
  ok(far < 30, `from every system the band's brightest stretch lies toward the map's middle (${lines.join(', ')})`);
  // The band lies along the plane: from Tatooine, a ray along the plane carries far more than one straight up.
  const t = systemPlace(GALAXY_SYSTEMS.find((s) => s.id === 'tatoo')!);
  const along = bandRay(t.x, t.y, t.z, 0, 0, 1, p).light;
  const up = bandRay(t.x, t.y, t.z, 0, 1, 0, p).light;
  ok(along > 4 * up, `the band lies along the galaxy's plane (along it ${(along / up).toFixed(1)} times straight up)`);
}

// ---------------------------------------------------------------- 3. retuning the disc moves the map and the band together
{
  const p0 = numberParams();
  const pl = systemPlace(GALAXY_SYSTEMS.find((s) => s.id === 'naboo')!);
  const disc0 = sampleDisc(400, 7, p0);
  const band0 = bandRay(pl.x, pl.y, pl.z, 1, 0, 0, p0).light;
  const was = GALAXY_TUNE.discArms;
  GALAXY_TUNE.discArms = 5;
  const p1 = numberParams();
  const disc1 = sampleDisc(400, 7, p1);
  const band1 = bandRay(pl.x, pl.y, pl.z, 1, 0, 0, p1).light;
  GALAXY_TUNE.discArms = was;
  ok(disc1.pos.some((v, i) => v !== disc0.pos[i]) && band1 !== band0, `five arms for four move the map's disc and the band alike (the band along +X ${band0.toFixed(2)} to ${band1.toFixed(2)})`);
  const v0 = MILKY_STATE.version;
  const held = tuneShape({ dustShare: 1, nope: 1 });
  ok(MILKY_STATE.version === v0 + 1 && MILKY_SHAPE.dustShare === 0.05 && held.join() === 'shape.dustShare: held to 0.05,shape.nope: no such number', `the shape's numbers are held to their ranges and counted (${held.join('; ')})`);
  tuneShape({ dustShare: 0.012 });
}

// ---------------------------------------------------------------- 4. the graphs are the same function
{
  const before = DENSITY_CALLS.numbers;
  densityAt(100, 0, 100);
  ok(DENSITY_CALLS.numbers === before + 1, 'the numbers go through densityOf');
  const { NIGHT_GRAPHS, NODE_OPS } = await import('../../../src/sky/night/nightGpu.ts');
  const TSL = (await import('three/tsl')) as unknown as Record<string, (...a: unknown[]) => { isNode?: boolean }>;
  // The density over three's shading language: every operation answers a node, the same function's arithmetic.
  const g0 = DENSITY_CALLS.graph;
  const f = (v: number) => TSL.float(v);
  const P = Object.fromEntries(Object.entries(numberParams()).map(([k, v]) => [k, f(v)]));
  const out = { emit: null as unknown, warm: null as unknown, dust: null as unknown };
  densityOf(NODE_OPS, f(100), f(2), f(-300), P as never, out as never);
  ok(DENSITY_CALLS.graph === g0 + 1 && [out.emit, out.warm, out.dust].every((n) => (n as { isNode?: boolean })?.isNode === true), "densityOf over three's shading language builds nodes for the light, the warm share and the dust");
  ok(Object.keys(NUM_OPS).every((k) => typeof (NODE_OPS as unknown as Record<string, unknown>)[k] === 'function') && NODE_OPS !== (NUM_OPS as unknown), 'the card and the numbers are two sets of the same operations over the one function');
  const bake = NIGHT_GRAPHS.bandGraph(NIGHT_GRAPHS.bakeUniforms());
  ok(!!bake.material && !!bake.mesh && /densityOf\(NODE_OPS, x, y, z, p, o\);/.test(text('src/sky/night/nightGpu.ts')), "the band's bake is built (in node) and its loop's step is densityOf over those operations");
  // The hash: integer arithmetic both ways round, the same constants (the card's is the same PCG on u32).
  const gpu = text('src/sky/night/nightGpu.ts');
  ok(/u\.mul\(uint\(747796405\)\)\.add\(uint\(2891336453\)\)/.test(gpu) && /\.mul\(uint\(277803737\)\)/.test(gpu) && /w\.shiftRight\(uint\(22\)\)\.bitXor\(w\)/.test(gpu), "the card's hash is the numbers' PCG, constant for constant");
  const h = new Set<number>();
  for (let i = -50; i < 50; i++) h.add(hash2Number(i, 3));
  ok(h.size === 100 && [...h].every((v) => v >= 0 && v < 1), 'the cells\' hash is a fraction and tells cells apart');
}

// ---------------------------------------------------------------- 5. each system's stars
{
  const tat = systemPlace(GALAXY_SYSTEMS.find((s) => s.id === 'tatoo')!);
  const a = catalogueOf('tatoo', tat);
  ok(a.count === STAR_MOST && a.star.length === STAR_MOST * 4 && a.tint.length === STAR_MOST * 4 && a.size.length === STAR_MOST, `a system's catalogue holds ${STAR_MOST} stars, the brightest first`);
  let sorted = true;
  let unit = 0;
  let lum = 0;
  let size = true;
  for (let i = 0; i < a.count; i++) {
    if (i > 0 && a.star[i * 4 + 3] < a.star[(i - 1) * 4 + 3]) sorted = false;
    unit = Math.max(unit, Math.abs(Math.hypot(a.star[i * 4], a.star[i * 4 + 1], a.star[i * 4 + 2]) - 1));
    lum = Math.max(lum, Math.abs(0.2126 * a.tint[i * 4] + 0.7152 * a.tint[i * 4 + 1] + 0.0722 * a.tint[i * 4 + 2] - 1));
    if (!(a.size[i] >= 2 && a.size[i] <= 3)) size = false;
  }
  ok(sorted && unit < 1e-5 && lum < 1e-3 && size, 'every star a unit direction, sorted brightest first, its colour of luminance one, its card 2 to 3 pixels across');
  ok(a.brightest >= CATALOGUE.brightest - 1e-6 && Math.abs(a.faintest - CATALOGUE.faintest) < 1e-6, `the brightest at ${a.brightest.toFixed(2)} (never past ${CATALOGUE.brightest}), the 12,000th at ${a.faintest.toFixed(2)}`);
  const reach = [2000, 4000, 8000, 12000].map((n) => faintestOf(a, n));
  ok(Math.abs(reach[0] - magnitudeOfRank(2000)) < 1e-5 && reach[0] > 4.9 && reach[0] < 5.2 && reach[2] > 6.3 && reach[3] === a.faintest, `the tiers reach the magnitudes a real sky's counts give (${reach.map((m) => m.toFixed(2)).join(', ')})`);
  // A real sky's counts: tens brighter than 2, hundreds than 4.
  let n2 = 0;
  let n4 = 0;
  for (let i = 0; i < a.count; i++) {
    if (a.star[i * 4 + 3] < 2) n2++;
    if (a.star[i * 4 + 3] < 4) n4++;
  }
  ok(n2 > 30 && n2 < 150 && n4 > 300 && n4 < 1200, `${n2} stars brighter than 2 and ${n4} than 4 (a real sky's are some 80 and 660)`);
  const b = catalogueOf('tatoo', { ...tat });
  const c = catalogueOf('naboo', systemPlace(GALAXY_SYSTEMS.find((s) => s.id === 'naboo')!));
  ok(b === a && c.star.some((v, i) => v !== a.star[i]), 'a system\'s stars are the same each time asked (kept for the session) and each system has its own');
  // The bright ones scatter over the sky, the faint crowd the plane more.
  const lat = (from: number, to: number): number => {
    let s = 0;
    for (let i = from; i < to; i++) s += Math.abs(Math.asin(a.star[i * 4 + 1]));
    return (s / (to - from)) * (180 / Math.PI);
  };
  ok(lat(0, 100) > lat(8000, 12000), `the brightest hundred stand further off the plane than the faintest (${lat(0, 100).toFixed(1)}° against ${lat(8000, 12000).toFixed(1)}° on average)`);
  ok(cardSize(-2, 6000) === 3 && cardSize(6, 6000) === 2 && cardSize(2, 20000) < cardSize(2, 3500), 'a card is wider as it is brighter, and a little wider as it is cooler');
  // The eye's limit (Schaefer's fit) and a star's light.
  ok(Math.abs(limitingMag(2e-4) - 6.55) < 0.02 && Math.abs(limitingMag(5e-3) - 4.25) < 0.02 && limitingMag(8000) < -10, `the eye's limit: ${limitingMag(2e-4).toFixed(2)} at a dark site, ${limitingMag(5e-3).toFixed(2)} under a full moon's sky, ${limitingMag(8000).toFixed(1)} by day`);
  ok(Math.abs(LIMIT_K - 63.0) < 0.05, `the card's limit constant is the fit's (${LIMIT_K.toFixed(2)})`);
  ok(Math.abs(starLight(-26.74, SCENE) - SCENE) < 1e-12 && Math.abs(starLight(0, 1) / starLight(5, 1) - 100) < 1e-9, "a star's light: the sun's at its magnitude, a hundred times per five magnitudes");
}

// ---------------------------------------------------------------- 6. the sky turns with the day's own sun
{
  const day = new DayCycle(0, 1);
  day.swg = true;
  const tilt = new Float64Array(9);
  tiltFrameInto(40, 120, tilt);
  // Orthonormal, right-handed.
  const col = (m: ArrayLike<number>, c: number) => [m[c * 3], m[c * 3 + 1], m[c * 3 + 2]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const x = col(tilt, 0);
  const y = col(tilt, 1);
  const z = col(tilt, 2);
  const cross = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  ok(Math.abs(dot(x, x) - 1) < 1e-12 && Math.abs(dot(y, y) - 1) < 1e-12 && Math.abs(dot(x, y)) < 1e-12 && Math.abs(dot(cross, z) - 1) < 1e-12, 'the tilt frame is orthonormal and right-handed');
  const pole = [-DAY_AXIS.x, -DAY_AXIS.y, -DAY_AXIS.z];
  ok(Math.abs((Math.acos(dot(y, pole)) * 180) / Math.PI - 40) < 1e-9, "the galactic north stands the tilt's degrees off the day's pole");
  ok(Math.abs((Math.asin(pole[1]) * 180) / Math.PI - SWG_POLE_DEG) < 1e-9 && Math.abs(Math.hypot(NOON.x, NOON.y, NOON.z) - 1) < 1e-12 && QUARTER.x === 1, `the day's pole stands ${SWG_POLE_DEG}° over the horizon, as the client pitches its light`);
  // Over a whole day the day's own sun stays on the circle, and stands still among the stars.
  let off = 0;
  let drift = 0;
  let first: number[] | null = null;
  const frame = new Float64Array(9);
  for (let k = 0; k < 96; k++) {
    day.time = (k + 0.37) / 96;
    day.update(0.016, false);
    const s = day.sunDir;
    off = Math.max(off, Math.abs(offCircle(s)));
    nightFrameInto(tilt, s, frame);
    // The sun in the galaxy's frame: the frame's transpose times it.
    const g = [col(frame, 0), col(frame, 1), col(frame, 2)].map((c) => dot(c, [s.x, s.y, s.z]));
    if (!first) first = g;
    drift = Math.max(drift, Math.hypot(g[0] - first[0], g[1] - first[1], g[2] - first[2]));
  }
  ok(off < 1e-9, `the day's sun keeps to the day's circle at every hour (${off.toExponential(1)} off it): its path is a turn about the pole`);
  ok(drift < 1e-9, `the sun stands still among the stars through a whole day (${drift.toExponential(1)}): the sky turns with the day`);
  // The day's angle nought is its highest sun (SWG's noon falls where its stretched day puts it, not at half the clock).
  let top = -2;
  let topAngle = 0;
  for (let k = 0; k < 2000; k++) {
    day.time = k / 2000;
    day.update(0.016, false);
    if (day.sunDir.y > top) {
      top = day.sunDir.y;
      topAngle = dayAngleOf(day.sunDir);
    }
  }
  ok(Math.abs(dayAngleOf(NOON)) < 1e-12 && Math.abs(topAngle) < 0.01, `the day's highest sun stands at the day's angle nought (${topAngle.toFixed(4)} rad), ${((Math.asin(top) * 180) / Math.PI).toFixed(1)}° up`);
}

// ---------------------------------------------------------------- 7. the towns' glow
{
  const g = new CityGlow();
  // A pois.json's rows (the raw frame) about a centre: two towns with a reach, one name without, a landmark.
  g.setRows(
    [
      { name: 'A', x: 1000, z: 0, r: 400, kind: 'city' },
      { name: 'B', x: -3000, z: 500, r: 150, kind: 'city' },
      { name: 'C', x: 0, z: 0, r: 0, kind: 'city' },
      { name: 'D', x: 50, z: 50, r: 300, kind: 'landmark' },
    ],
    { x: 0, z: 0 },
  );
  const at = { camX: 0.5, camZ: 0.5 };
  at.camX = 0;
  at.camZ = 0;
  g.frame(at);
  ok(g.townCount === 2 && g.count === 2, "only cities with a reach glow (cities.ts's own rule), here two");
  // Town A in the game's frame: x mirrored, so it stands toward −X.
  ok(g.out[0] < -0.99 && g.out[2] > g.out[6], 'the nearer, bigger town first, toward its own direction in the game\'s frame (x mirrored)');
  const k = CITY_GLOW.strength * NIGHT_TUNE.cityGlow;
  const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
  ok(rel(g.out[2], (k * (400 / 300) ** 2) / (1 + Math.pow(1000 / CITY_GLOW.near, CITY_GLOW.falloff))) < 1e-6, "a town's light at the horizon: strength × (r / 300)² / (1 + (d / 1 km)^2.5)");
  const toward = glowToward(g.out, 0, -0.995, 0.1, 0);
  const away = glowToward(g.out, 0, 0.995, 0.1, 0);
  const higher = glowToward(g.out, 0, -0.9, 0.43, 0);
  const under = glowToward(g.out, 0, -0.995, -0.1, 0);
  ok(toward > 10 * away && toward > higher && under === 0, 'the glow stands low toward its town, fades round the horizon and up the sky, none under the horizon');
  // Inside a town: all round.
  at.camX = -1000;
  g.frame(at);
  const near = g.out[2];
  ok(rel(near, k * (400 / 300) ** 2) < 1e-6 && g.out[3] > 1.5, 'inside a town its light levels off at its brightest, its glow all round the horizon');
  // Far off it is Walker's law: twice as far, a fifth and a half the light.
  at.camX = -1000 + 20000;
  g.frame(at);
  const far1 = g.out[2];
  at.camX = -1000 + 40000;
  g.frame(at);
  ok(Math.abs(far1 / g.out[2] - Math.pow(2, CITY_GLOW.falloff)) < 0.01, `far off a town's glow falls as the distance to the −${CITY_GLOW.falloff} (Walker's law)`);
  ok(CITY_MOST === 8, 'the card weighs the eight strongest towns');
}

// ---------------------------------------------------------------- 8. the flare's sources from the air
{
  // The flare's kept records as `lensFlare.ts`'s `createSkyLights` makes them (that module takes a parameter property, which
  // node's stripped TypeScript refuses, so its shape is made here).
  const out: FxSkyLight[] = [0, 1].map(() => ({ dir: new THREE.Vector3(0, 1, 0), color: new THREE.Color(1, 1, 1), alpha: 0, discRadius: 0, glowRadius: 0, weight: 0, star: false, skyDistance: Infinity }));
  const f = makeAirFrame();
  const tat = airFlareDiscs('tatooine', { size: 0.6, glowSize: 1.2 }, { size: 0.4, glowSize: 0 });
  // Day: the casting sun high, the second under it.
  f.sunDir.set(0, 0.8, -0.6);
  f.sun2Dir.set(0, 0.78, -0.62);
  f.sun2 = true;
  f.moonDir.set(0, -0.8, 0.6);
  f.lightDir.copy(f.sunDir);
  f.sunHere.setRGB(1.8, 1.7, 1.5);
  f.sun2Here.setRGB(0.6, 0.5, 0.3);
  f.moonHere.setRGB(0, 0, 0);
  AIR_FLARE_IN.skyDistance = 3500;
  const n = airFlareLights(out, f, tat);
  ok(n === 2 && out[0].alpha === 1 && out[1].alpha === 1 && out[0].weight === 1 && Math.abs(out[1].weight - Math.sqrt(0.45)) < 1e-12, "Tatooine by day: the caster and the second sun flare, the second weighted by the root of its strength");
  ok(out[0].color.r === 1 && out[0].color.g < 1 && out[0].dir.y === 0.8 && out[0].skyDistance === 3500, "a source's hue is what the air lets through, its brightest channel one; its place and the sky's distance as handed");
  ok(Math.abs(FLARE_SEEN.radiance[0] - (0.2126 * 1.8 + 0.7152 * 1.7 + 0.0722 * 1.5) / (Math.PI * tat.sunRadius * tat.sunRadius)) < 1e-6, "the pass is handed each source's light a steradian (what reaches the camera over its disc)");
  // Night: the moon the light, the suns out.
  f.lightDir.copy(f.moonDir).normalize();
  f.moonDir.normalize();
  f.lightDir.copy(f.moonDir);
  f.moonDir.set(0, 0.8, 0.6);
  f.lightDir.copy(f.moonDir);
  f.moonHere.setRGB(2e-6, 2e-6, 2.2e-6);
  airFlareLights(out, f, tat);
  ok(out[0].dir.z === 0.6 && out[0].alpha === 1 && out[0].weight === FLARE_AIR.moonWeight && out[1].alpha === 0 && FLARE_SEEN.radiance[1] === 0, 'at night slot 0 follows the moon, at its own weight, and the second sun is dark');
  // A sun under the land: no light.
  f.lightDir.copy(f.sunDir);
  f.sunDir.set(0, -0.3, -0.95);
  f.lightDir.copy(f.sunDir);
  airFlareLights(out, f, tat);
  ok(out[0].alpha === 0 && FLARE_SEEN.radiance[0] === 0, 'a sun under the land sends the flare nothing');
  const one = airFlareDiscs('naboo', null, null);
  ok(airFlareLights(out, f, one) === 1 && one.sunGlow === one.sunRadius * 12, 'a world of one star has one slot; with no SWG glow its glow is twelve discs across');
  // The wave's fixer: the flare's `nightSuns` switch takes the night's flare (the moon's) out under our sky too.
  f.moonDir.set(0, 0.8, 0.6);
  f.lightDir.copy(f.moonDir);
  AIR_FLARE_IN.nightSuns = false;
  airFlareLights(out, f, tat);
  ok(out[0].alpha === 0 && FLARE_SEEN.radiance[0] === 0 && out[1].alpha === 0, 'with nightSuns off the moon sends the flare nothing at night, its slot kept');
  AIR_FLARE_IN.nightSuns = true;
  airFlareLights(out, f, tat);
  ok(out[0].alpha === 1 && FLARE_SEEN.radiance[0] > 0, 'and with it back on the moon flares again');
}

// ---------------------------------------------------------------- 8b. the world's own sources, ground to space (the wave's fixer)
// `World.skyLights` read out of `world.ts` as text and run over stand-in worlds: under our sky over a planet the air writes the
// sources and the pass's seen gate (`FLARE_SEEN`); in a space zone (or a sky with no air) SWG's sprites are the sources and the
// gate must stand open, never keep the last world's sun or moon (the review: a space zone flared or not by the hour the player
// left the ground, and never in a session begun in space). The pass copies `FLARE_SEEN` into its occlusion every frame.
{
  const W = text('src/world/world.ts').split(/\r?\n/);
  const at = W.findIndex((l) => /^  skyLights\(/.test(l));
  let end = at + 1;
  while (end < W.length && W[end] !== '  }') end++;
  ok(at > 0 && end < W.length, "the world's skyLights is read out of world.ts");
  const js = ts.transpileModule(`class WorldLines {\n${W.slice(at, end + 1).join('\n')}\n}\n`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const GPU = { webgpu: true };
  const f = makeAirFrame();
  const AIRS = { frame: f };
  const proceduralCalls = { n: 0 };
  const SwgSkyStandIn = { proceduralFlareLights: () => (proceduralCalls.n++, 0) };
  const WorldLines = new Function('GPU', 'AIR', 'AIR_FLARE_IN', 'airFlareDiscs', 'airFlareLights', 'openFlareSeen', 'SwgSky', `${js}\nreturn WorldLines;`)(GPU, AIRS, AIR_FLARE_IN, airFlareDiscs, airFlareLights, openFlareSeen, SwgSkyStandIn) as new () => Record<string, unknown> & { skyLights(out: FxSkyLight[], nightSuns?: boolean): number };
  const out: FxSkyLight[] = [0, 1].map(() => ({ dir: new THREE.Vector3(0, 1, 0), color: new THREE.Color(1, 1, 1), alpha: 0, discRadius: 0, glowRadius: 0, weight: 0, star: false, skyDistance: Infinity }));
  // A ground world under our sky at night: the moon the light, faint.
  const ground = Object.assign(new WorldLines(), {
    planet: { id: 'tatooine', space: false },
    skyAir: {},
    swgSky: { data: { space: false, sun: { size: 0.6, glowSize: 1.2 }, moon: { size: 0.4, glowSize: 0 } }, flareSkyDistance: 3500, flareLights: () => 0 },
    nebulae: null,
  });
  f.sunDir.set(0, -0.8, -0.6);
  f.moonDir.set(0, 0.8, 0.6);
  f.lightDir.copy(f.moonDir);
  f.moonHere.setRGB(2e-6, 2e-6, 2.2e-6);
  f.sun2 = false;
  const moonDisc = airFlareDiscs('tatooine', { size: 0.6, glowSize: 1.2 }, { size: 0.4, glowSize: 0 }).moonRadius;
  ok(ground.skyLights(out, true) === 2 && out[0].alpha === 1 && FLARE_SEEN.radiance[0] > 0 && FLARE_SEEN.radiance[0] * PRE_FIXED.least < FLARE_AIR.seenFrom && moonDisc > 0, `on the ground at night the air writes the moon's faint light into the gate (${FLARE_SEEN.radiance[0].toExponential(2)} a steradian)`);
  ok(ground.skyLights(out, false) === 2 && out[0].alpha === 0 && FLARE_SEEN.radiance[0] === 0, "the world hands the flare's nightSuns switch to the air's sources: off, the moon does not flare");
  ground.skyLights(out, true);
  // A space zone: SWG's star sprites are the sources (alpha their own), and the gate stands open whatever the ground left.
  let sprites = 0;
  const space = Object.assign(new WorldLines(), {
    planet: { id: 'space_light1', space: 'space_light1' },
    skyAir: null,
    swgSky: {
      data: { space: true },
      flareLights: (o: FxSkyLight[]) => {
        sprites++;
        o[0].alpha = 0.8;
        o[1].alpha = 0;
        return 2;
      },
    },
    nebulae: { flareDim: 1 },
  });
  const n = space.skyLights(out, true);
  ok(n === 2 && sprites === 1 && out[0].alpha === 0.8, "in space the sources are the zone's star sprites, their alpha their own (the WebGL rule)");
  ok(Array.from(FLARE_SEEN.radiance).every((v) => v === FLARE_SEEN_OPEN), 'in space the seen gate stands open in every slot, not at the moon the player left behind');
  // Open means open at every exposure the eye is held to and the player's two stops either way, and inside a 32-bit float.
  const least = FLARE_SEEN_OPEN * PRE_FIXED.least * 0.25;
  const most = FLARE_SEEN_OPEN * PRE_FIXED.most * 4;
  ok(least > NIGHT_TUNE_RANGE.flare.seenTo[1] && most < 3.4e38 && Number.isFinite(Math.fround(most)), `open is past the seen band's highest dial at the least exposure (${least.toExponential(1)} against ${NIGHT_TUNE_RANGE.flare.seenTo[1]}) and a finite float at the most (${most.toExponential(1)})`);
  // A session begun in space: nothing ever wrote the gate before.
  FLARE_SEEN.radiance.fill(0);
  space.skyLights(out, true);
  ok(FLARE_SEEN.radiance[0] === FLARE_SEEN_OPEN, 'a session begun in space has its gate open from its first frame');
  // Back down: the air writes the gate again.
  ground.skyLights(out, true);
  ok(FLARE_SEEN.radiance[0] > 0 && FLARE_SEEN.radiance[0] < 1, "back on the ground the air's own light is in the gate again");
  // A planet whose sky has no air (our sky's row, no tables): SWG's sprites, the gate open as in space.
  const noAir = Object.assign(new WorldLines(), { planet: { id: 'gallery', space: false }, skyAir: null, swgSky: { data: { space: false }, flareLights: () => 1 }, nebulae: null });
  noAir.skyLights(out, true);
  ok(FLARE_SEEN.radiance[0] === FLARE_SEEN_OPEN, "a sky with no air flares by its sprites' alpha, its gate open");
  // On WebGL the world's lines leave the gate alone (no pass reads it there).
  GPU.webgpu = false;
  FLARE_SEEN.radiance.fill(7);
  space.skyLights(out, true);
  ok(FLARE_SEEN.radiance[0] === 7 && FLARE_SEEN.radiance[1] === 7 && sprites === 3, 'on WebGL the space path is the old line: the sprites, nothing written into the gate');
  GPU.webgpu = true;
  const flareGpu = text('src/sky/night/gpuFlare.ts');
  ok(/rad\.x = FLARE_SEEN\.radiance\[0\];\s*rad\.y = MAX_FLARE_SOURCES > 1 \? FLARE_SEEN\.radiance\[1\] : 0;/.test(flareGpu) && /const shown = pick\(slot, \[radiance\.x, radiance\.y\]\)\.mul\(eyeExposureNode\(\)\)\.mul\(band\.z\);/.test(flareGpu), "the pass copies the gate's light into its occlusion every frame, times the eye's exposure and the player's");
  ok(proceduralCalls.n === 0, 'no stand-in path was taken by mistake');
}

// ---------------------------------------------------------------- 9. the dials, the tier, the places
{
  const set = nightDialSet();
  ok(starsDialsFor('stars') === set && starsDialsFor('sky') === null && set.helper === 'stars', "the night's dials belong to `stars`, the helper whose argument the menu's copied line is");
  const dials = allDials(set);
  ok(['tune.stars', 'tune.seeing', 'tune.twinkle', 'tune.twinkleRate', 'tune.milkyWay', 'tune.cityGlow', 'counts.low', 'counts.medium', 'counts.high', 'counts.ultra', 'flare.moonWeight', 'flare.seenFrom', 'flare.seenTo', 'tilt.tatooine.tiltDeg', 'tilt.tatooine.nodeDeg', 'tilt.adventure2.tiltDeg'].every((k) => dials.some((d) => d.key === k)), `the dials: the stars, the eye, the twinkle, the Milky Way, the towns, the counts a tier, the flare and each world's tilt (${dials.length})`);
  ok(NIGHT_TUNE.twinkle === 0.3 && NIGHT_TUNE.milkyWay === 1 && NIGHT_TUNE.stars === 1 && STAR_COUNTS.low === 2000 && STAR_COUNTS.medium === 4000 && STAR_COUNTS.high === 8000 && STAR_COUNTS.ultra === 12000, "the brief's starts: physical stars and band, a subtle twinkle, 2,000 to 12,000 stars by tier");
  // Every dial moves its table through its setter, and the copied line is the helper's argument.
  const v0 = NIGHT_STATE.version;
  for (const d of dials) {
    if (d.kind !== 'number') continue;
    const was = d.get();
    const to = Math.min(d.max, was + d.step * 2);
    d.set(to);
    ok(Math.abs(d.get() - to) < 1e-9, `${d.key} moves through its setter (${was} to ${d.get()})`);
    d.set(was);
  }
  ok(NIGHT_STATE.version > v0, 'every move is counted, so the sky reads the dials again');
  dials.find((d) => d.key === 'tune.milkyWay')!.set(3);
  dials.find((d) => d.key === 'tilt.tatooine.tiltDeg')!.set(55);
  const line = movedLine(set);
  ok(line.startsWith('__debug.stars(') && line.includes('milkyWay: 3') && line.includes('tatooine: { tiltDeg: 55 }'), `the copied line keeps what moved: ${line}`);
  resetDials(set);
  ok(!dials.some((d) => dialMoved(set, d)), 'reset puts every dial back');
  const held = tuneNight({ tune: { twinkle: 4, nope: 1 }, counts: { low: -3 }, tilt: { tatooine: { tiltDeg: 'x' } } });
  ok(held.join(' | ') === 'tune.twinkle: held to 1 | tune.nope: no such dial | counts.low: held to 0 | tilt.tatooine.tiltDeg: not a number', `every number held to its range, with words (${held.join('; ')})`);
  resetDials(set);
  tuneNight({ counts: { low: 2000 }, tune: { twinkle: 0.3 } });
  ok(NIGHT_TUNE_RANGE.counts.ultra[1] === STAR_MOST, 'no tier may ask for more stars than the buffer holds');
  // Two seeded dials a world: the same every session, different world to world.
  const t1 = tiltOf('naboo');
  const t2 = tiltOf('dantooine');
  ok(t1.tiltDeg >= 20 && t1.tiltDeg <= 80 && t1.nodeDeg >= 0 && t1.nodeDeg <= 360 && (t1.tiltDeg !== t2.tiltDeg || t1.nodeDeg !== t2.nodeDeg), `each world's tilt seeded by its name (Naboo ${t1.tiltDeg}°, ${t1.nodeDeg}°; Dantooine ${t2.tiltDeg}°, ${t2.nodeDeg}°)`);
  // The tier read without a record, as `tierOf` reads it.
  let agree = true;
  for (const dpr of [1, 2]) {
    for (const t of TIER_NAMES) {
      const s = { ...DEFAULT_SETTINGS, ...tierValues(t, dpr) };
      const i = tierIndexOf(s, dpr);
      if (TIER_NAMES[i] !== tierOf(s, dpr)) agree = false;
    }
    const custom = { ...DEFAULT_SETTINGS, ...tierValues('high', dpr), grassReach: 0.9 };
    if (tierIndexOf(custom, dpr) !== -1 || tierOf(custom, dpr) !== 'custom') agree = false;
  }
  ok(agree, "the night's tier reader answers as `tierOf` for every tier and a custom set, on screens of one and two pixels a point");
  ok(countOfTier(0) === 2000 && countOfTier(3) === 12000 && countOfTier(-1) === 8000, "a tier's count, a custom set taking High's");
  // Where each world's night is seen from.
  const tp = nightPlaceOf('tatooine');
  const rp = nightPlaceOf('rori');
  const np = nightPlaceOf('naboo');
  const hp = nightPlaceOf('adventure2');
  ok(tp.key === 'tatoo' && rp.key === 'naboo' && np.key === 'naboo' && JSON.stringify(rp.placeOf()) === JSON.stringify(np.placeOf()), "a world's night is its system's: Rori and Naboo share one sky's stars and band");
  ok(hp.key === 'hoth' && Math.hypot(hp.placeOf().x, hp.placeOf().z) > 100 && nightPlaceOf('gallery').key === 'world:gallery', "Hoth's heroic is placed at Hoth's square; a world of no system has a place of its own");
}

// ---------------------------------------------------------------- 10. the world and the game hand it over (pinned as text)
{
  const world = text('src/world/world.ts');
  // (pass 2, wave 4a: the sky's moons and planets are made ready between the night and the sky's build, so both are built with it)
  // (Pass 2, wave 4b: the held bodies are hung between the night and the bodies, with the sky still unbuilt.)
  ok(/await this\.loadNight\(sky, token\);\s*if \(token !== this\.loadToken\) return;\s*(\/\/[^\n]*\n\s*)*await this\.loadHeld\(sky, pack, token\);\s*if \(token !== this\.loadToken\) return;\s*(\/\/[^\n]*\n\s*)*await this\.loadBodies\(sky\);\s*if \(token !== this\.loadToken\) return;\s*this\.gpuSkyReady\(sky\);/.test(world), "the night is hung before the sky is built, behind the loading screen (gpuSkyReady builds it with the dome)");
  ok(/sky\.group\.add\(night\.group\);\s*markActor\(night\.group\);/.test(world) && /await night\.warm\(\);/.test(world) && /night\.drawBake\(\);/.test(world), "it hangs in the sky's group, marked as the group was, its bake compiled and drawn");
  ok(/this\.skyAir\.frame\(this\.day, this\.swgSky, L\);\s*\/\/[^\n]*\n\s*this\.nightFrame\(camPos\);/.test(world) && /private nightFrame\(camPos: THREE\.Vector3\): void \{[\s\S]{0,200}at\.camX = camPos\.x;\s*at\.camZ = camPos\.z;\s*night\.frame\(\);/.test(world), "its frame follows the air's, the camera's place written into its fields");
  // (pass 2, wave 4a: the bodies' Scattered cards go after it, before the sky too)
  ok(/if \(this\.swgSky\) \{\s*\/\/[^\n]*\n\s*if \(GPU\.webgpu\) this\.dropNight\(\);\s*(\/\/[^\n]*\n\s*if \(GPU\.webgpu\) this\.dropBodies\(\);\s*)?this\.swgSky\.dispose\(/.test(world), 'it goes before its sky');
  ok(/if \(GPU\.webgpu && this\.skyAir && this\.swgSky && !this\.swgSky\.data\.space\) \{[\s\S]{0,300}AIR_FLARE_IN\.nightSuns = nightSuns;\s*return airFlareLights\(out, AIR\.frame, discs\);/.test(world), "the flare follows the air's discs and the moon under our sky on WebGPU, the nightSuns switch handed in");
  ok(/return airFlareLights\(out, AIR\.frame, discs\);\s*\}\s*(\/\/[^\n]*\n\s*)+if \(GPU\.webgpu\) openFlareSeen\(\);\s*if \(this\.swgSky\) \{\s*const count = this\.swgSky\.flareLights\(out, nightSuns\);/.test(world), "everywhere else on WebGPU the seen gate stands open, before the sky's own sources as 4ecee44 had them");
  const sky = text('src/world/sky.ts');
  ok(/if \(data\.stars && data\.stars\.count > 0 && !\(GPU\.webgpu && skyOurs\(\) && !space\)\) \{/.test(sky), "SWG's star field is not made under our sky on WebGPU over a planet (WebGL, SWG's sky and space keep it)");
  const main = text('src/main.ts');
  const chain = main.split('\n').find((l) => l.includes('dials: (helper) => vehicleDialsFor(helper)')) ?? '';
  ok(chain.includes('?? starsDialsFor(helper) ??') && /stars: \(o\?: Record<string, unknown>\) => starsConsole\(/.test(main), "the debug menu has the `stars` dials, and `__debug.stars` is the console's helper");
  const passes = text('src/core/gpu/gpuChainPasses.ts');
  ok(/\['lensFlare', null\]/.test(passes) && /if \(CHAIN_PORTED\.has\('lensFlare'\) && flareHere\('lensFlare'\)\) fx\.registerPass\(new GpuLensFlarePass\(renderer\)\);/.test(passes), 'the flare is on the WebGPU chain, under our sky alone');
}

console.log(`\nnightSky: ${checks} checks passed`);
process.exit(0);
