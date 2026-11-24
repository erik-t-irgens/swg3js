// The cloud map's pure twin and its closed forms (pass 3, wave 1, maker M): the layer contract's packing, the integer hash,
// the schedule's level eased in closed form (held to the weather's own walk and to the wind's own closed form), the drift
// summed from the one wind aloft (its derivative the wind, no seam at a step's turn, the same for a late joiner), and the
// map's texels (a function of the world and not of the camera, moved by exactly the drift, cover following the dial, the
// regions' term, the far ring the near ring's function).
//
// Run: node tools/swg/tests/cloudMap.test.ts
import assert from 'node:assert/strict';
import {
  CLOUD_BAND_FLOATS,
  CLOUD_LAYER_MAX,
  CLOUD_LAYER_VEC4,
  CLOUD_MAP_RINGS,
  CLOUD_STACK_FLOATS,
  CLOUD_TYPES,
  CLOUD_TYPE_FLOATS,
  CLOUD_TYPE_TUNE,
  COVER_FLOATS,
  cleanLayer,
  coverAtLevel,
  mixCuts,
  mixWeights,
  newCloudLayer,
  newStackFrame,
  packBands,
  packCovers,
  packStack,
  packStackFrame,
  packTypes,
  type CloudLayer,
} from '../../../src/sky/clouds/cloudLayers.ts';
import {
  CLOUD_MAP_TUNE,
  CloudDrift,
  CloudMapFrame,
  CloudSchedule,
  DRIFT_EPOCH,
  PLAN_FLOATS,
  REGION_DUST,
  REGION_RAIN,
  RING_FLOATS,
  TexelOut,
  evalRing,
  evalTexel,
  hash2,
  pcg,
  planRings,
  sampleRing,
  unit,
  wrapDrift,
} from '../../../src/sky/clouds/cloudMap.ts';
import { climateFor, levelAtStep, seedOf, LEVEL_RATE, STEP_SECONDS } from '../../../src/world/weatherSchedule.ts';
import { WindPattern, PACK_FLOATS, headingWalk, worldWindOf } from '../../../src/world/windMath.ts';
import { WIND_PROFILES, WIND_TUNE, windWorldOf } from '../../../src/world/wind.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---------------------------------------------------------------------------------------------- the hash

{
  // PCG written again with BigInt, a different arithmetic, so the 32-bit wrap of the twin's is held.
  const ref = (v: number): number => {
    const M = (1n << 32n) - 1n;
    const state = (BigInt(v >>> 0) * 747796405n + 2891336453n) & M;
    const word = (((state >> ((state >> 28n) + 4n)) ^ state) * 277803737n) & M;
    return Number(((word >> 22n) ^ word) & M);
  };
  let same = 0;
  for (let i = 0; i < 4000; i++) {
    const v = i < 2000 ? i * 2654435761 : (i * 40503) ^ 0xdeadbeef;
    if (pcg(v) === ref(v)) same++;
  }
  ok(same === 4000, `pcg is the paper's hash to the bit in 4,000 inputs, the big ones included (${same})`);
  ok(unit(0xffffffff) < 1 && unit(0) === 0, 'a hash read as a number lies in [0, 1)');
  const a = hash2(65535, 3, 7);
  const b = hash2(-1, 3, 7);
  ok(a === b, 'a lattice coordinate wraps at 16 bits (65,535 and −1 hash alike)');
}

// ---------------------------------------------------------------------------------------------- the layer's packing

{
  const L = cleanLayer({ name: 'mix', types: ['stratocumulus', 'cumulus', 'cirrus'], shares: [2, 1, 1], cover: [0, 0.25, 0.5, 0.75, 1], base: 900, thickness: 1200 }, null);
  const cuts = [0, 0];
  mixCuts(L, cuts);
  ok(Math.abs(cuts[0] - 0.5) < 1e-9 && Math.abs(cuts[1] - 0.75) < 1e-9, `a mix's cuts are its cumulative shares (${cuts.join(', ')})`);
  const w = [0, 0, 0];
  let worst = 0;
  for (let m = 0; m <= 1; m += 0.01) {
    mixWeights(3, cuts[0], cuts[1], 0.08, m, w);
    worst = Math.max(worst, Math.abs(w[0] + w[1] + w[2] - 1), -Math.min(w[0], w[1], w[2]));
  }
  ok(worst < 1e-9, 'the type weights sum to one and none is negative across the mix value');
  mixWeights(3, cuts[0], cuts[1], 0.08, 0.1, w);
  ok(w[0] > 0.999, 'under the first cut the first type alone');
  mixWeights(3, cuts[0], cuts[1], 0.08, 0.95, w);
  ok(w[2] > 0.999, 'past the last cut the third type alone');
  ok(Math.abs(coverAtLevel(L, 2.5) - 0.625) < 1e-12, 'the cover eases between whole levels');
  const f = newStackFrame();
  f.groundY = 120;
  f.level = 2;
  f.hour = 0;
  f.wet = 0.3;
  f.drift[0] = 1000;
  f.drift[1] = 2000;
  f.drift[2] = 3;
  f.drift[3] = 4;
  const out = new Float32Array(CLOUD_STACK_FLOATS);
  const n = packStack([L, newCloudLayer('cirrus')], f, out);
  ok(n === 2, 'two layers packed');
  ok(out[0] === 1020 && out[1] === 2220, 'its base and top are world y (the ground plus its own)');
  ok(out[4] === 1 && out[5] === 2 && out[6] === 8 && out[7] === 3, 'its types are their indices and its count three');
  ok(Math.abs(out[11] - 0.5) < 1e-7, "its cover is the level's");
  ok(out[12] === 1000 && out[15] === 4, 'its drift and wind as handed');
  ok(out[CLOUD_LAYER_VEC4 * 4 * 2] === 0 && out[CLOUD_STACK_FLOATS - 1] === 0, 'the slots past the stack are nought');
  const off = cleanLayer({ name: 'off', on: false }, null);
  packStack([off], f, out);
  ok(out[7] === 0, 'a layer off is packed with count nought');
  // Bands: three layers, two overlapping, one apart.
  const a = cleanLayer({ name: 'a', types: ['cumulus'], base: 1000, thickness: 1500, cover: [0.5, 0.5, 0.5, 0.5, 0.5] }, null);
  const b = cleanLayer({ name: 'b', types: ['altocumulus'], base: 2000, thickness: 800, cover: [0.5, 0.5, 0.5, 0.5, 0.5] }, null);
  const c = cleanLayer({ name: 'c', types: ['cirrus'], base: 8000, thickness: 1000, cover: [0.5, 0.5, 0.5, 0.5, 0.5] }, null);
  f.groundY = 0;
  const cnt = packStack([c, a, b], f, out);
  const bands = new Float32Array(CLOUD_BAND_FLOATS);
  const nb = packBands(out, cnt, bands);
  ok(nb === 2 && bands[0] === 1000 && bands[1] === 2800 && bands[4] === 8000 && bands[5] === 9000, `the bands sort and merge the overlapping layers (${Array.from(bands.slice(0, 8)).join(', ')})`);
  const types = new Float32Array(CLOUD_TYPE_FLOATS);
  packTypes(types);
  ok(types[2 * 12 + 4] === 1 && types[8 * 12 + 4] === 0, "the types' table carries cumulus's cells and cirrus's none");
  // Nothing refused: a cumulus at 8 km, overlapping, a type unknown dropped in words.
  const notes: string[] = [];
  const odd = cleanLayer({ name: 'high heaps', types: ['cumulus', 'nonsense'], base: 8000, cover: [2, -1, 0.5, 0.5, 0.5], thickness: 99999 }, null, notes);
  ok(odd.base === 8000 && odd.types.length === 1 && odd.cover[0] === 1 && odd.cover[1] === 0 && odd.thickness === 20000 && notes.length === 1, 'a cumulus at 8 km is kept; only the safety clamps act; an unknown type is said and left');
  ok(CLOUD_TYPES.length === 11, 'eleven types');
}

// ---------------------------------------------------------------------------------------------- the fixer's packing: shares by level, skipped slots, band tops

{
  // A deck of fair cumulus giving way to nimbostratus (Naboo's low deck's form) and a clear one.
  const deck = cleanLayer({ name: 'Low deck', types: ['cumulus', 'nimbostratus'], shares: [[1, 1, 0.7, 0.3, 0.1], [0, 0, 0.3, 0.7, 0.9]], cover: [0.3, 0.45, 0.55, 0.75, 0.95], base: 1100, thickness: 3000, diurnal: 0.2 }, null);
  const clear = cleanLayer({ name: 'clear', types: ['altocumulus'], cover: [0, 0, 0, 0.4, 0.4], base: 4000 }, null);
  const f = newStackFrame();
  f.groundY = 50;
  f.hour = -0.3;
  f.wet = 0.2;
  const out = new Float32Array(CLOUD_STACK_FLOATS);
  const kept = new Float32Array(CLOUD_STACK_FLOATS);
  const covers = new Float64Array(CLOUD_LAYER_MAX * COVER_FLOATS);
  const topsA = new Float64Array(CLOUD_LAYER_MAX);
  // The frame's form (kept arrays) is packStack's numbers at every level, the fractional ones too, with regions or none.
  let worst = 0;
  let worstTop = 0;
  for (const regions of [0, 2]) {
    for (let lv = 0; lv <= 4; lv += 0.25) {
      f.level = lv;
      f.regions = regions;
      const n = packStack([deck, clear], f, out);
      topsA.set(f.bandTop);
      f.bandTop.fill(0);
      // The still parts packed at another level, as the run packs them when the stack changes, then the frame's own.
      f.level = 4 - lv;
      packStack([deck, clear], f, kept);
      packCovers([deck, clear], covers);
      f.level = lv;
      packStackFrame(n, covers, f, kept);
      for (let i = 0; i < n * CLOUD_LAYER_VEC4 * 4; i++) worst = Math.max(worst, Math.abs(out[i] - kept[i]));
      for (let i = 0; i < n; i++) worstTop = Math.max(worstTop, Math.abs(topsA[i] - f.bandTop[i]));
    }
  }
  ok(worst === 0 && worstTop === 0, `the frame's form packs packStack's numbers to the bit at every level, cuts and counts and band tops included (${worst}, ${worstTop})`);
  // The cuts move with the level: all cumulus on a fair day, mostly nimbostratus in the storm, eased between.
  f.regions = 0;
  f.level = 0;
  packStack([deck, clear], f, out);
  ok(out[8] === 1 && out[9] === 1, 'at level 0 the deck is all its first type (its cut at the whole)');
  f.level = 4;
  packStack([deck, clear], f, out);
  ok(Math.abs(out[8] - 0.1) < 1e-6, `at level 4 its first type holds a tenth (${out[8]})`);
  f.level = 2.5;
  packStack([deck, clear], f, out);
  ok(Math.abs(out[8] - 0.5) < 1e-6, `between levels the cut is eased (${out[8]})`);
  // A layer clear now is skipped (count 0, no band) unless a place forces its weather.
  const V = CLOUD_LAYER_VEC4 * 4;
  f.level = 1;
  f.regions = 0;
  packStack([deck, clear], f, out);
  ok(out[7] === 2 && out[V + 7] === 0, 'a layer clear at the level now is packed with count 0 (the map leaves its slot, the march its band)');
  const bands = new Float32Array(CLOUD_BAND_FLOATS);
  ok(packBands(out, 2, bands, f.bandTop) === 1, 'and it lays no band');
  f.regions = 1;
  packStack([deck, clear], f, out);
  ok(out[V + 7] === 1 && packBands(out, 2, bands, f.bandTop) === 2, 'with a place forcing its weather its slot is laid and its band walked');
  // The band reaches the tallest type present: the heaps' 1.5 km on a fair day, the rain deck's 3 km once it comes.
  f.regions = 0;
  f.level = 1;
  packStack([deck], f, out);
  ok(Math.abs(f.bandTop[0] - (50 + 1100 + 1500)) < 1e-6 && out[1] === 50 + 1100 + 3000, `on a fair day the deck's band tops out at its heaps (${f.bandTop[0]}), its slot keeping the whole deck`);
  f.level = 1.25;
  packStack([deck], f, out);
  ok(Math.abs(f.bandTop[0] - (50 + 1100 + 3000)) < 1e-6, 'as soon as the rain type has a share the band reaches its top');
  packBands(out, 1, bands, f.bandTop);
  ok(bands[1] === 50 + 1100 + 3000 && packBands(out, 1, bands) === 1 && bands[1] === out[1], 'the bands read the tops handed, the whole thickness without');
  // Each type's thickness is on the card (p2.w): its column in a mix.
  const types = new Float32Array(CLOUD_TYPE_FLOATS);
  packTypes(types);
  ok(types[CLOUD_TYPES.indexOf('cumulus') * 12 + 11] === CLOUD_TYPE_TUNE.cumulus.thickness && types[CLOUD_TYPES.indexOf('cumulonimbus') * 12 + 11] === CLOUD_TYPE_TUNE.cumulonimbus.thickness, "each type's thickness is its p2.w");
}

// ---------------------------------------------------------------------------------------------- the level

{
  const seed = seedOf('naboo');
  const weights = climateFor('naboo', 5);
  const S = new CloudSchedule();
  S.setWorld(seed, weights);
  let same = 0;
  const n = 400;
  for (let i = 0; i < n; i++) {
    const step = 5_900_000 + i * 7;
    if (S.levelAtStep(step) === levelAtStep(seed, weights, step)) same++;
  }
  ok(same === n, `the twin's walk is the weather's own at ${n} steps`);
  // Eased from the step's start: the step before's level at the start, the step's own 40 s in.
  const step = 5_900_123;
  const lb = levelAtStep(seed, weights, step - 1);
  const lh = levelAtStep(seed, weights, step);
  S.tau = step * STEP_SECONDS;
  S.at();
  const atStart = S.level;
  S.tau = step * STEP_SECONDS + 1 / LEVEL_RATE + 1;
  S.at();
  ok(atStart === lb && S.level === lh, `at a step's start the level before (${lb}), 41 s in the step's own (${lh})`);
  // Held to the wind's own closed form (its pattern's scheduled level).
  const rows = [{ weatherIndex: 0, windSpeedScale: 1, cameraEffect: null }, { weatherIndex: 2, windSpeedScale: 2, cameraEffect: { kind: 'rain' } }];
  const world = worldWindOf(rows as never, 5);
  const P = new WindPattern(seed, weights, world, WIND_PROFILES, windWorldOf('naboo'), WIND_TUNE as never, new Float32Array(PACK_FLOATS));
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const tau = 1_770_000_000 + i * 37.3;
    S.tau = tau;
    S.at();
    P.scheduledLevelIn(tau);
    worst = Math.max(worst, Math.abs(S.level - P.lv));
  }
  ok(worst < 1e-12, `the closed-form level is the wind's own at 2,000 moments (worst ${worst})`);
}

// ---------------------------------------------------------------------------------------------- the drift

{
  const seed = seedOf('tatooine');
  const weights = climateFor('tatooine', 5);
  const speeds = [6, 7, 9, 11, 14];
  const D = new CloudDrift();
  D.setWorld(seed, weights, speeds);
  const now = 1_795_000_000.25; // a moment in late 2026
  D.tau = now;
  D.at();
  ok(D.primeMs < 2000, `the sum from the epoch takes ${D.primeMs.toFixed(1)} ms (${D.steps} steps)`);
  // The derivative is the wind.
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    const t = now + i * 61.7;
    D.tau = t - 0.5;
    D.at();
    const x0 = D.x;
    const z0 = D.z;
    D.tau = t + 0.5;
    D.at();
    const x1 = D.x;
    const z1 = D.z;
    D.tau = t;
    D.at();
    const ex = Math.abs(x1 - x0 - D.vx);
    const ez = Math.abs(z1 - z0 - D.vz);
    worst = Math.max(worst, ex, ez);
  }
  ok(worst < 0.05, `the drift's change over a second is the wind (worst ${worst.toFixed(4)} m against winds of metres a second)`);
  // The heading is the walk's.
  D.tau = now;
  D.at();
  const h = headingWalk(seed, now, 1200);
  const sp = Math.sqrt(D.vx * D.vx + D.vz * D.vz);
  ok(Math.abs(D.vx / sp - Math.sin(h)) < 1e-9 && Math.abs(D.vz / sp - Math.cos(h)) < 1e-9, "the wind's heading is windAt's walk");
  // No seam at a step's turn.
  const st = Math.ceil(now / STEP_SECONDS) * STEP_SECONDS;
  D.tau = st - 1e-4;
  D.at();
  const bx = D.x;
  D.tau = st + 1e-4;
  D.at();
  ok(Math.abs(D.x - bx) < 0.01, `no seam at a step's turn (${Math.abs(D.x - bx).toExponential(2)} m over 0.2 ms)`);
  // A late joiner: one browser here since an hour ago, stepped on, the other summed afresh at the moment: the same drift.
  const A = new CloudDrift();
  A.setWorld(seed, weights, speeds);
  for (let t = now - 3600; t <= now + 0.01; t += 7.77) {
    A.tau = t;
    A.at();
  }
  A.tau = now;
  A.at();
  const B = new CloudDrift();
  B.setWorld(seed, weights, speeds);
  B.tau = now;
  B.at();
  ok(Math.abs(A.x - B.x) < 1e-3 && Math.abs(A.z - B.z) < 1e-3, `a browser joined late has the same drift as one there an hour (${Math.abs(A.x - B.x).toExponential(2)} m apart, drift ${(Math.sqrt(B.x * B.x + B.z * B.z) / 1000).toFixed(0)} km)`);
  ok(DRIFT_EPOCH === Date.UTC(2026, 0, 1) / 1000, 'the epoch is the first of January 2026');
  ok(wrapDrift(-1) === 65535 && wrapDrift(65536.5) === 0.5, 'the drift handed to the card wraps at 65,536 m');
}

// ---------------------------------------------------------------------------------------------- the map

const T = { ...CLOUD_MAP_TUNE, cellLife: 0 };
const types = new Float32Array(CLOUD_TYPE_FLOATS);
packTypes(types);
function stackOf(layers: CloudLayer[], drift: number[][] = []): { stack: Float32Array; n: number } {
  const f = newStackFrame();
  f.groundY = 0;
  f.level = 0;
  f.hour = 0;
  f.wet = 1;
  for (let i = 0; i < drift.length; i++) {
    f.drift[i * 4] = wrapDrift(drift[i][0]);
    f.drift[i * 4 + 1] = wrapDrift(drift[i][1]);
  }
  const stack = new Float32Array(CLOUD_STACK_FLOATS);
  const n = packStack(layers, f, stack);
  return { stack, n };
}
const frame = new CloudMapFrame();

{
  // Cover follows the dial, for a sheet and for cells.
  for (const type of ['stratus', 'cumulus'] as const) {
    const fr: number[] = [];
    for (const c of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const L = cleanLayer({ name: type, types: [type], cover: [c, c, c, c, c] }, null);
      const { stack, n } = stackOf([L]);
      const plan = new Float64Array(PLAN_FLOATS);
      const drift = new Float64Array(CLOUD_LAYER_MAX * 4);
      planRings(stack, n, { camX: 1234.5, camZ: -987.25 }, drift, T, plan);
      const px = evalRing(stack, types, plan, frame, T, 0, 0);
      let covered = 0;
      for (let i = 0; i < px.length; i += 4) covered += px[i] / 255;
      fr.push(covered / (px.length / 4));
    }
    let rising = true;
    for (let i = 1; i < fr.length; i++) if (!(fr[i] > fr[i - 1])) rising = false;
    ok(rising, `${type}: the mean cover rises with the dial (${fr.map((v) => v.toFixed(2)).join(', ')} at 0.1 to 0.9)`);
  }
}

{
  // A function of the world, not of the camera: a texel's middle at the same world place from two cameras has one value.
  const L = cleanLayer({ name: 'mix', types: ['stratocumulus', 'cumulus'], shares: [1, 1], cover: [0.5, 0.5, 0.5, 0.5, 0.5] }, null);
  const { stack, n } = stackOf([L], [[123456.7, -98765.4]]);
  const drift = new Float64Array(CLOUD_LAYER_MAX * 4);
  drift[0] = 123456.7;
  drift[1] = -98765.4;
  const pa = new Float64Array(PLAN_FLOATS);
  const pb = new Float64Array(PLAN_FLOATS);
  planRings(stack, n, { camX: 10.3, camZ: 20.9 }, drift, T, pa);
  planRings(stack, n, { camX: 10.3 + 3 * 125 + 17.2, camZ: 20.9 - 5 * 125 + 40.1 }, drift, T, pb);
  const ta = new TexelOut();
  const tb = new TexelOut();
  let worst = 0;
  const N = CLOUD_MAP_RINGS.near.size;
  for (let k = 0; k < 400; k++) {
    const i = 40 + ((k * 37) % 400);
    const j = 40 + ((k * 53) % 400);
    evalTexel(stack, types, pa, frame, T, 0, 0, i - N / 2, j - N / 2, ta);
    // The same texel from camera b: three texels on in x, five back in z.
    evalTexel(stack, types, pb, frame, T, 0, 0, i - N / 2 - 3, j - N / 2 + 5, tb);
    worst = Math.max(worst, Math.abs(ta.cover - tb.cover), Math.abs(ta.mix - tb.mix), Math.abs(ta.top - tb.top));
  }
  ok(worst < 1e-6, `a texel at one world place reads alike from two cameras (worst ${worst.toExponential(2)})`);
  // Moved by exactly the drift: the clouds at world p with drift d are those at p + Δ with drift d + Δ.
  const d2 = new Float64Array(drift);
  d2[0] += 4000;
  d2[1] -= 2000;
  const pc = new Float64Array(PLAN_FLOATS);
  planRings(stack, n, { camX: 10.3 + 4000, camZ: 20.9 - 2000 }, d2, T, pc);
  worst = 0;
  for (let k = 0; k < 400; k++) {
    const i = 40 + ((k * 37) % 400);
    const j = 40 + ((k * 53) % 400);
    evalTexel(stack, types, pa, frame, T, 0, 0, i - N / 2, j - N / 2, ta);
    evalTexel(stack, types, pc, frame, T, 0, 0, i - N / 2, j - N / 2, tb);
    worst = Math.max(worst, Math.abs(ta.cover - tb.cover));
  }
  ok(worst < 1e-6, `the map moves by exactly its drift (worst ${worst.toExponential(2)})`);
  // The near ring's place in the sampler: a texel's middle reads its own value.
  const ring = evalRing(stack, types, pa, frame, T, 0, 0);
  const s = new Float64Array(4);
  const texel = CLOUD_MAP_RINGS.near.span / N;
  const i = 300;
  const j = 200;
  const rx = (i - N / 2 + 0.5) * texel - pa[0];
  const rz = (j - N / 2 + 0.5) * texel - pa[1];
  sampleRing(ring, pa, 0, 0, rx, rz, s);
  ok(Math.abs(s[0] - ring[(j * N + i) * 4] / 255) < 1e-9, "the sampler reads a texel's own value at its middle");
  // The far ring is the near's function: its texel's mean over the same ground within a few hundredths.
  const far = evalRing(stack, types, pa, frame, T, 0, 1);
  const NF = CLOUD_MAP_RINGS.far.size;
  let meanFar = 0;
  let meanNear = 0;
  for (let fj = NF / 2 - 16; fj < NF / 2 + 16; fj++) for (let fi = NF / 2 - 16; fi < NF / 2 + 16; fi++) meanFar += far[(fj * NF + fi) * 4] / 255;
  meanFar /= 32 * 32;
  for (let k = 0; k < ring.length; k += 4) meanNear += ring[k] / 255;
  meanNear /= ring.length / 4;
  ok(Math.abs(meanFar - meanNear) < 0.08, `the far ring over the near ring's ground has its mean cover (${meanFar.toFixed(3)} against ${meanNear.toFixed(3)})`);
}

{
  // The regional term: a rain place lays cover over it, a dust place clears a low layer under it.
  const L = cleanLayer({ name: 'cu', types: ['cumulus'], cover: [0.2, 0.2, 0.2, 0.2, 0.2], base: 1000 }, null);
  const { stack, n } = stackOf([L]);
  const plan = new Float64Array(PLAN_FLOATS);
  planRings(stack, n, { camX: 0, camZ: 0 }, new Float64Array(CLOUD_LAYER_MAX * 4), T, plan);
  const fr = new CloudMapFrame();
  fr.groundY = 0;
  fr.regions[0] = 0;
  fr.regions[1] = 0;
  fr.regions[2] = 3000;
  fr.regions[3] = REGION_RAIN;
  fr.regionCount = 1;
  const t = new TexelOut();
  evalTexel(stack, types, plan, fr, T, 0, 0, 0, 0, t);
  ok(t.cover >= T.regionCover - 1e-6 && t.wet > 0.3, `a place forced to rain lays its rain clouds over it (cover ${t.cover.toFixed(2)}, wet ${t.wet.toFixed(2)})`);
  fr.regions[3] = REGION_DUST;
  const L2 = cleanLayer({ name: 'cu', types: ['stratus'], cover: [1, 1, 1, 1, 1], base: 500 }, null);
  const s2 = stackOf([L2]);
  planRings(s2.stack, s2.n, { camX: 0, camZ: 0 }, new Float64Array(CLOUD_LAYER_MAX * 4), T, plan);
  evalTexel(s2.stack, types, plan, fr, T, 0, 0, 0, 0, t);
  ok(t.cover < 0.3, `a dust storm's place leaves the low sky bare (cover ${t.cover.toFixed(2)})`);
  fr.regionCount = 0;
  evalTexel(s2.stack, types, plan, fr, T, 0, 0, 0, 0, t);
  ok(t.cover > 0.95, 'and with no place the full sheet stands');
}

{
  // A plan's lattice places stay small whatever the drift: no number on the card is measured from far away.
  const L = newCloudLayer('cumulus');
  const { stack, n } = stackOf([L]);
  const plan = new Float64Array(PLAN_FLOATS);
  const drift = new Float64Array(CLOUD_LAYER_MAX * 4);
  drift[0] = 9.7e8;
  drift[1] = -4.2e8;
  planRings(stack, n, { camX: 5000, camZ: -6000 }, drift, T, plan);
  let big = 0;
  for (let k = 0; k < 2 * RING_FLOATS; k++) big = Math.max(big, Math.abs(plan[k]));
  ok(big <= 128000, `a ring's plan holds wrapped integers under 2^16 and fractions, never the far place (largest ${big})`);
}

console.log(`\ncloudMap: ${checks} checks passed`);
