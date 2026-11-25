// The cloud map's pure twin (pass 3, wave 1, the design's 2.1 as the owner's layers remade it): one function of the world,
// the shared clock and the world's day, the same in every browser, that `cloudMapGpu.ts` runs on compute into both rings
// and this file runs in JavaScript, so a read-back can be held to it and the twin can stand in for the card before it lands.
//
// What is here:
//   - the integer hash every seed is (PCG, Jarzynski and Olano's `pcg` of 2020, written from the paper's method), the same
//     bits in a browser's JavaScript and in WGSL's u32, since a float sine hash differs between Apple and NVIDIA;
//   - each layer's texel: its cover (cells for its cellular types, continuous noise for the rest, blended by its types'
//     weights where its mix noise lays them), its mix value, its wetness and its cells' tops, and the regional term of a
//     place that forces its weather (a locations row's `weather`);
//   - the rings' plan: each layer's two squares centred on the camera and snapped to their own texels in the layer's
//     drifting frame, and each lattice's place split into a wrapped integer and a fraction worked in doubles, so the card
//     never holds a place measured from far away in a 32-bit number;
//   - the closed forms the design asks for: the schedule's level eased from its step (never `stepLevel`, whose history and
//     snap after a jump would leave a late joiner a level apart), and the drift integrated from the one wind aloft knot by
//     knot (`wind.ts`'s aloft rule over `windAt`'s heading walk), from one fixed moment, so every browser has the same.
//
// Pure: no three, no DOM. The frame's path (`CloudSchedule.at`, `CloudDrift.at`, `planRings`) allocates nothing: every
// answer is written into a field or a kept array (CLAUDE.md: a number handed back from a call the compiler leaves out is a
// number made). The ring's whole evaluation (`evalRing`) is the tests' and the check's, and allocates its output only.
import {
  CLOUD_LAYER_MAX,
  CLOUD_LAYER_VEC4,
  CLOUD_MAP_RINGS,
  CLOUD_TYPE_VEC4,
  CLOUD_DRIFT_WRAP,
  mixWeights,
} from './cloudLayers.ts';
import { ANCHOR_STEPS, BRIDGE_STEPS, LEVEL_RATE, MOVE_CHANCE, STEP_SECONDS } from '../../world/weatherSchedule.ts';

// ------------------------------------------------------------------------------------------------ the dials

/**
 * The map's dials (the design's `CLOUD_MAP_TUNE`), each with its start and reason. Live: written into the map's uniform at
 * every frame (`packMapTune`), so a slider moves the next frame's map. Feel is the owner's.
 */
export const CLOUD_MAP_TUNE = {
  /** How far a cell's cloud may sit from its square's middle, a share of the square: 0.7 breaks the grid without two cells landing on one spot. */
  cellJitter: 0.7,
  /** Cells present at cover times this: 1.6 has every cell up by a cover of 0.63, so a broken deck is still made of heaps. */
  cellPresence: 1.6,
  /** A cell's radius at no cover and at full, in squares: a fair-weather heap is a third of its square, a full deck's three quarters. */
  cellRadiusMin: 0.3,
  cellRadiusMax: 0.75,
  /** How much one cell's size differs from the next, a share: half, so some heaps are small and some large. */
  cellSizeJitter: 0.5,
  /** The least a cell's top stands, a share of the layer's thickness: tops between 45% and the whole, so a field of heaps is ragged. */
  cellTopMin: 0.45,
  /** A cell's life, seconds (0 lives for ever): half an hour, a real cumulus's, so heaps grow and fade while they drift. */
  cellLife: 1800,
  /** The shares of its life a cell takes to grow and to fade: a fifth to build, three tenths to fade. */
  cellGrow: 0.2,
  cellDecay: 0.3,
  /** The continuous noise's largest feature, in cells: two and a half, so a sheet's holes and thickenings are several km. */
  sheetScale: 2.5,
  /** How hard the sheet's and the mix's noise is stretched toward even (1 as it comes): about 2.2 lays cover near its share of the ground. */
  sheetContrast: 2.2,
  mixContrast: 2.4,
  /** The edge band where cover meets clear sky, in the noise's units, at a layer's edge 0 and its widening at 1. */
  edgeMin: 0.03,
  edgeSpan: 0.22,
  /** The level at which the wet types begin to rain and the level at which they rain their most (the schedule's 0 to 4). */
  wetFrom: 1.5,
  wetFull: 3.5,
  /** A place's region: its edge's width (m), the cover its rain or snow lays at its heart, the wetness least there, how much clear a dust storm makes of the low layers, and the height (m over the ground) under which a layer is low. */
  regionEdge: 2000,
  regionCover: 0.85,
  regionWet: 0.6,
  regionDustClear: 0.8,
  regionDustBelow: 3000,
  // ---- the look wave, round 1: the map's two cheap shape lines (the plan's rank 7a, §1 items 1 and 2)
  /**
   * How far a cell's top falls from its middle to its rim, a share of its top: 0.6, a dome (at 1 a half sphere), so a heap's
   * top is rounded rather than a flat lid; 0 one top over the whole cell, as wave 1 laid it.
   */
  cellDome: 0.6,
  /**
   * How much the turrets on a cell's top differ, a share of its top: 0.3, each turret (a value noise of four to a cell) at its
   * own height, the cauliflower's; 0 none.
   */
  cellTurrets: 0.3,
  /**
   * Clusters and holes: how much a slow noise (two octaves on the mix's lattice, features of the layer's mix scale, 6 km to
   * start, about four cumulus cells; stretched by `sheetContrast`) grows the cells in one place and shrinks them away in another, and thickens and thins a sheet's cover
   * about its own: 0.5, heaps in groups with clear sky between; 0 an even field, as wave 1 laid it.
   */
  clusters: 0.5,
};
export type CloudMapTune = typeof CLOUD_MAP_TUNE;

/** The tune's ranges (the debug menu's sliders and `__debug.clouds({ tune })`'s clamps). */
export const CLOUD_MAP_TUNE_RANGE: Record<keyof CloudMapTune, [number, number]> = {
  cellJitter: [0, 1],
  cellPresence: [0.5, 4],
  cellRadiusMin: [0.05, 1],
  cellRadiusMax: [0.1, 1.1],
  cellSizeJitter: [0, 1],
  cellTopMin: [0, 1],
  cellLife: [0, 14400],
  cellGrow: [0.01, 0.5],
  cellDecay: [0.01, 0.5],
  sheetScale: [0.5, 8],
  sheetContrast: [1, 4],
  mixContrast: [1, 4],
  edgeMin: [0.005, 0.3],
  edgeSpan: [0, 0.5],
  wetFrom: [0, 4],
  wetFull: [0.5, 4],
  regionEdge: [100, 10000],
  regionCover: [0, 1],
  regionWet: [0, 1],
  regionDustClear: [0, 1],
  regionDustBelow: [0, 20000],
  cellDome: [0, 1],
  cellTurrets: [0, 0.9],
  clusters: [0, 1],
};

/**
 * The look wave, round 1: the turrets' lattice against the cells' (a power of two: the place stays exact, `fbm`'s way), and
 * the salts of the turrets and of the clusters' two octaves. Not dials: the noise's frame.
 */
export const TURRET_SHIFT = 2;
export const SALT_TURRETS = 7;
export const SALT_CLUSTERS = 8;

/** The sheet's octaves and the mix's: shader structure, not dials (a change would build another program). */
export const SHEET_OCTAVES = 4;
export const MIX_OCTAVES = 2;

/** The regions the map takes at once (a place forcing its weather): the nearest this many. */
export const CLOUD_REGION_MAX = 8;
/** A region's kind on the card. */
export const REGION_RAIN = 1;
export const REGION_DUST = 2;
export const REGION_SNOW = 3;

// ------------------------------------------------------------------------------------------------ the hash

/** PCG's output for one 32-bit input (the paper's `pcg_hash`): every seed of the map, the same bits in WGSL's u32. */
export function pcg(v: number): number {
  const state = (Math.imul(v | 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) | 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** A hash's 24 high bits as a number in [0, 1), exactly as the card makes it. */
export function unit(h: number): number {
  return (h >>> 8) / 16777216;
}

/** A lattice point's hash: its two 16-bit coordinates in one word, mixed with a salt. */
export function hash2(ix: number, iz: number, salt: number): number {
  const key = ((ix & 0xffff) | ((iz & 0xffff) << 16)) >>> 0;
  return pcg((key ^ salt) >>> 0);
}

/** A layer's salt for one use (0 cells, 1 to 4 the sheet's octaves, 5 to 6 the mix's): its seed's 24 bits and the use. */
export function saltOf(seed: number, which: number): number {
  return pcg(((seed & 0xffffff) * 16 + which) >>> 0);
}

// ------------------------------------------------------------------------------------------------ the noises

/** Value noise at a lattice cell (ix, iz) and a place in it (fx, fz), smoothstepped, 0 to 1. */
export function valueNoise(ix: number, iz: number, fx: number, fz: number, salt: number): number {
  const ix1 = (ix + 1) & 0xffff;
  const iz1 = (iz + 1) & 0xffff;
  const a = unit(hash2(ix, iz, salt));
  const b = unit(hash2(ix1, iz, salt));
  const c = unit(hash2(ix, iz1, salt));
  const d = unit(hash2(ix1, iz1, salt));
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const ab = a + (b - a) * sx;
  const cd = c + (d - c) * sx;
  return ab + (cd - ab) * sz;
}

/**
 * fBm of `octaves` value noises from a lattice place given as a wrapped integer `iw` and a running fraction `g` on each axis
 * (the place is iw + g lattice units): octave k reads at 2^k times the place, its integer part `(iw << k) + floor(2^k g)`
 * wrapped to 16 bits, so a place far from anywhere is exact. 0 to 1, normalised.
 */
export function fbm(iwx: number, gx: number, iwz: number, gz: number, octaves: number, seed: number, saltFirst: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let scale = 1;
  for (let k = 0; k < octaves; k++) {
    const ux = gx * scale;
    const uz = gz * scale;
    const fx = Math.floor(ux);
    const fz = Math.floor(uz);
    const ix = ((iwx << k) + fx) & 0xffff;
    const iz = ((iwz << k) + fz) & 0xffff;
    sum += amp * valueNoise(ix, iz, ux - fx, uz - fz, saltOf(seed, saltFirst + k));
    norm += amp;
    amp *= 0.5;
    scale *= 2;
  }
  return sum / norm;
}

/** A noise stretched toward even about its middle (`contrast`), clamped to 0 to 1. */
export function ranked(n: number, contrast: number): number {
  const v = (n - 0.5) * contrast + 0.5;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const smooth01 = (a: number, b: number, x: number): number => {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------------------------------------ the rings' plan

/**
 * Per layer and ring, what the card's compute and the twin read (`RING_FLOATS` numbers), worked in doubles:
 *
 *  r0 = (offX, offZ, cellStep, sheetStep)   the camera's place in the ring past its centre corner, metres (0 to a texel),
 *                                            and a texel in each lattice's units
 *  r1 = (cellIwX, cellFX, cellIwZ, cellFZ)   the ring's centre corner in the cell lattice: wrapped integer and fraction
 *  r2 = (sheetIwX, sheetFX, sheetIwZ, sheetFZ)
 *  r3 = (mixIwX, mixFX, mixIwZ, mixFZ)
 *  r4 = (mixStep, ringHalf, texel, 0)
 *  r5 = (baseX, baseZ, 0, 0)                 pass 3, wave 2 (maker B): the centre corner's lattice index modulo the ring's
 *                                            size on each axis, where the card's wrapped ring keeps it (`ringStoreOf`)
 *
 * Pass 3, wave 2 (maker B): the card keeps each ring WRAPPED in the layer's drifting frame: the texel of lattice index K (on
 * each axis) is stored at K modulo the ring's size, so a texel keeps its place in the world while the ring's centre snaps
 * on (nothing is moved when the camera or the drift crosses a texel), and the ring can be refreshed in parts (`CLOUD_MAP_PARTS`)
 * with no texel ever read from the wrong place but the strip just come into the ring. The twin keeps the ring as it always
 * did, centred (canonical index i is the texel `i − size/2` from the centre corner); `unwrapRing` turns the card's into it.
 */
export const RING_VEC4 = 6;
export const RING_FLOATS = RING_VEC4 * 4;
/** The plan's layout: layer l's near ring at l·2·RING_FLOATS, its far ring after it. */
export const PLAN_FLOATS = CLOUD_LAYER_MAX * 2 * RING_FLOATS;

/**
 * The frame's numbers the map reads besides the stack and the plan, a kept record: the cells' life as a wrapped integer and
 * a fraction of the shared seconds over it, the ground's y, and the regions (`CLOUD_REGION_MAX` of (relX, relZ, radius,
 * kind) relative to the camera) and how many.
 */
export class CloudMapFrame {
  lifeI = 0;
  lifeF = 0.5;
  groundY = 0.5;
  regions = new Float64Array(CLOUD_REGION_MAX * 4);
  regionCount = 0;
}

/**
 * Each layer's two rings for a camera at world (`cam.camX`, `cam.camZ`) and each layer's drift (x, z from `drift`, four numbers a layer,
 * the full drift in metres, never wrapped), from the packed stack (cell size, mix scale), into `out` (`PLAN_FLOATS`).
 * Allocates nothing.
 */
export function planRings(stack: Float32Array, layers: number, cam: { readonly camX: number; readonly camZ: number }, drift: Float64Array, T: { readonly sheetScale: number }, out: Float64Array, idx?: Float64Array): void {
  const V = CLOUD_LAYER_VEC4 * 4;
  // The camera and the sheet's scale read off their records (doubles handed to a call the compiler leaves out are made).
  const camX = cam.camX;
  const camZ = cam.camZ;
  const sheetScale = T.sheetScale;
  for (let l = 0; l < CLOUD_LAYER_MAX; l++) {
    for (let ring = 0; ring < 2; ring++) {
      const o = (l * 2 + ring) * RING_FLOATS;
      if (l >= layers) {
        for (let k = 0; k < RING_FLOATS; k++) out[o + k] = 0;
        continue;
      }
      const R = ring === 0 ? CLOUD_MAP_RINGS.near : CLOUD_MAP_RINGS.far;
      const texel = R.span / R.size;
      // The camera in the layer's frame (the clouds have moved by the drift: a cloud at q stands at q + drift).
      const qx = camX - drift[l * 4];
      const qz = camZ - drift[l * 4 + 1];
      const cx = Math.floor(qx / texel) * texel;
      const cz = Math.floor(qz / texel) * texel;
      const cell = stack[l * V + 16];
      const mixS = stack[l * V + 17];
      const sheet = cell * sheetScale;
      out[o] = qx - cx;
      out[o + 1] = qz - cz;
      out[o + 2] = texel / cell;
      out[o + 3] = texel / sheet;
      // Each lattice's split of the centre corner (x and z over the cells, the sheet, the mix): the wrapped integer and the
      // fraction, written out here (a double handed to a helper the compiler leaves out is a number made a call).
      for (let s = 0; s < 6; s++) {
        const u = ((s & 1) === 0 ? cx : cz) / (s < 2 ? cell : s < 4 ? sheet : mixS);
        const i = Math.floor(u);
        out[o + 4 + s * 2] = ((i % 65536) + 65536) % 65536;
        out[o + 5 + s * 2] = u - i;
      }
      out[o + 16] = texel / mixS;
      out[o + 17] = R.span / 2;
      out[o + 18] = texel;
      out[o + 19] = 0;
      // Pass 3, wave 2 (maker B): where the wrapped ring keeps the centre corner (its lattice index modulo the size), and the
      // index itself into `idx` (never to the card: it is measured from far away) for the run's jump check.
      const N = R.size;
      const kx = Math.floor(qx / texel);
      const kz = Math.floor(qz / texel);
      out[o + 20] = ((kx % N) + N) % N;
      out[o + 21] = ((kz % N) + N) % N;
      out[o + 22] = 0;
      out[o + 23] = 0;
      if (idx) {
        idx[(l * 2 + ring) * 2] = kx;
        idx[(l * 2 + ring) * 2 + 1] = kz;
      }
    }
  }
}

/**
 * Pass 3, wave 2 (maker B): the map refreshed in parts, a budget and not a look: the card rewrites every `near`-th row of the
 * near ring and every `far`-th of the far ring a frame (a quarter and an eighth: up to three quarters of the map's time saved),
 * each row's turn coming round in as many frames. A texel's content is a function of the world and the moment alone, and the
 * wrapped ring keeps it in place, so a part a few frames old differs only by those frames' change (a cell's life, the level's
 * ease): nothing jumps. The whole ring is written at once where a part would leave too much behind (an arrival, the stack or
 * the places changed, the ring jumping more than a texel, a read-back). Read when the map is made (the computes' sizes).
 */
export const CLOUD_MAP_PARTS = { near: 4, far: 8 } as const;

/**
 * The storage index (0 to `n` − 1, on one axis) of a ring's canonical index `i` (the texel `i − n/2` from the centre corner)
 * where the centre corner's lattice index modulo `n` is `base`. The card's compute is its inverse line for line (`relOfStore`).
 */
export function ringStoreOf(i: number, base: number, n: number): number {
  return (((i - n / 2 + base) % n) + n) % n;
}

/** The texel's offset from the centre corner (−n/2 to n/2 − 1) of storage index `s` on one axis (`ringStoreOf`'s inverse). */
export function relOfStore(s: number, base: number, n: number): number {
  return ((((s - base + n / 2) % n) + n) % n) - n / 2;
}

/**
 * The offset the card's face adds to a place relative to the camera before it reads a ring (`cloudMapGpu.ts`' `offV`), on one
 * axis: the camera's place past the centre corner plus where the wrapped ring keeps that corner, less half the ring (the
 * face's `+ 0.5`). With the sampler repeating, `(rel + this) / span + 0.5` lands on the stored texel of the place. `axis` 0 x, 1 z.
 */
export function faceOffsetOf(plan: Float64Array, layer: number, ring: number, axis: number): number {
  const o = (layer * 2 + ring) * RING_FLOATS;
  const R = ring === 0 ? CLOUD_MAP_RINGS.near : CLOUD_MAP_RINGS.far;
  const texel = R.span / R.size;
  return plan[o + axis] + (plan[o + 20 + axis] - R.size / 2) * texel;
}

/** One layer's ring as the card keeps it (wrapped: `ringStoreOf`) turned into the twin's centred layout. Allocates its output. */
export function unwrapRing(stored: Uint8Array, plan: Float64Array, layer: number, ring: number): Uint8Array {
  const N = ring === 0 ? CLOUD_MAP_RINGS.near.size : CLOUD_MAP_RINGS.far.size;
  const o = (layer * 2 + ring) * RING_FLOATS;
  const bx = plan[o + 20];
  const bz = plan[o + 21];
  const out = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    const sj = ringStoreOf(j, bz, N);
    for (let i = 0; i < N; i++) {
      const si = ringStoreOf(i, bx, N);
      const a = (sj * N + si) * 4;
      const b = (j * N + i) * 4;
      out[b] = stored[a];
      out[b + 1] = stored[a + 1];
      out[b + 2] = stored[a + 2];
      out[b + 3] = stored[a + 3];
    }
  }
  return out;
}

/**
 * A wrapped ring read as the card's face reads it (bilinear, the sampler repeating), at a place relative to the camera, into
 * `out`: the test's mirror of the face's near read through `faceOffsetOf`. Nought past the ring's half.
 */
export function sampleWrapped(stored: Uint8Array, plan: Float64Array, layer: number, ring: number, relX: number, relZ: number, out: Float64Array): void {
  const R = ring === 0 ? CLOUD_MAP_RINGS.near : CLOUD_MAP_RINGS.far;
  const N = R.size;
  for (let c = 0; c < 4; c++) out[c] = 0;
  if (Math.abs(relX) > R.span / 2 || Math.abs(relZ) > R.span / 2) return;
  const u = ((relX + faceOffsetOf(plan, layer, ring, 0)) / R.span + 0.5) * N - 0.5;
  const v = ((relZ + faceOffsetOf(plan, layer, ring, 1)) / R.span + 0.5) * N - 0.5;
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const fu = u - i0;
  const fv = v - j0;
  const w = (k: number): number => ((k % N) + N) % N;
  for (let c = 0; c < 4; c++) {
    const at = (i: number, j: number): number => stored[(w(j) * N + w(i)) * 4 + c] / 255;
    const a = at(i0, j0);
    const b = at(i0 + 1, j0);
    const d = at(i0, j0 + 1);
    const e = at(i0 + 1, j0 + 1);
    out[c] = (a + (b - a) * fu) * (1 - fv) + (d + (e - d) * fu) * fv;
  }
}

// ------------------------------------------------------------------------------------------------ one texel

/** What a texel evaluation hands back, in a kept record (the twin's frame path writes it; nothing crosses a call). */
export class TexelOut {
  cover = 0.5;
  mix = 0.5;
  wet = 0.5;
  top = 0.5;
}

/** The weights' scratch. */
const wScratch = new Float32Array(3);

/**
 * A layer's map at a place given by a ring's plan and an offset from the ring's centre corner in texels (`tx`, `tz`: a
 * texel's middle is i + 0.5 − size/2), into `out`. `stack` the packed stack, `types` the packed types, `T` the tune.
 * The card's compute (`cloudMapGpu.ts`) is this, line for line.
 */
export function evalTexel(
  stack: Float32Array,
  types: Float32Array,
  plan: Float64Array,
  frame: CloudMapFrame,
  T: CloudMapTune,
  layer: number,
  ring: number,
  tx: number,
  tz: number,
  out: TexelOut,
): void {
  const V = CLOUD_LAYER_VEC4 * 4;
  const s = layer * V;
  const o = (layer * 2 + ring) * RING_FLOATS;
  const count = stack[s + 7];
  if (!(count > 0)) {
    out.cover = 0;
    out.mix = 0;
    out.wet = 0;
    out.top = 1;
    return;
  }
  const seed = stack[s + 19];
  const cover = stack[s + 11];
  // No cover and no place forcing its weather: nothing to lay (a layer at a level that holds none of it costs a texel's write).
  if (!(cover > 0) && frame.regionCount === 0) {
    out.cover = 0;
    out.mix = 0;
    out.wet = 0;
    out.top = 1;
    return;
  }
  const edge = stack[s + 3];
  const texel = plan[o + 18];
  // The mix and the weights.
  let m = 0;
  if (count > 1) {
    const step = plan[o + 16];
    m = ranked(fbm(plan[o + 12], plan[o + 13] + tx * step, plan[o + 14], plan[o + 15] + tz * step, MIX_OCTAVES, seed, 5), T.mixContrast);
  }
  mixWeights(count, stack[s + 8], stack[s + 9], stack[s + 10], m, wScratch);
  const t0 = stack[s + 4];
  const t1 = stack[s + 5];
  const t2 = stack[s + 6];
  const TV = CLOUD_TYPE_VEC4 * 4;
  const cells = wScratch[0] * types[t0 * TV + 4] + wScratch[1] * types[t1 * TV + 4] + wScratch[2] * types[t2 * TV + 4];
  const wetShare = wScratch[0] * types[t0 * TV + 9] + wScratch[1] * types[t1 * TV + 9] + wScratch[2] * types[t2 * TV + 9];
  // The look wave, round 1: clusters and holes. A slow noise on the mix's lattice grows the cells' radius here and shrinks it
  // away there (`kc`: smooth across the field, so no cell is cut), and moves a sheet's cover about its own (`covL`: by the
  // nearer of its distances to none and to whole, so a clear sky and an overcast stay as they are and the mean holds).
  let kc = 1;
  let covL = cover;
  if (T.clusters > 0) {
    const step = plan[o + 16];
    const nc = ranked(fbm(plan[o + 12], plan[o + 13] + tx * step, plan[o + 14], plan[o + 15] + tz * step, 2, seed, SALT_CLUSTERS), T.sheetContrast);
    const sg = nc * 2 - 1;
    kc = 1 + T.clusters * sg;
    if (kc < 0) kc = 0;
    covL = cover + T.clusters * sg * (cover < 1 - cover ? cover : 1 - cover);
  }
  // The continuous sheet.
  let cs = 0;
  if (cells < 1) {
    const step = plan[o + 3];
    const n = ranked(fbm(plan[o + 8], plan[o + 9] + tx * step, plan[o + 10], plan[o + 11] + tz * step, SHEET_OCTAVES, seed, 1), T.sheetContrast);
    const w = T.edgeMin + T.edgeSpan * edge;
    const th = (1 - covL) * (1 + 2 * w) - w;
    cs = smooth01(th - w, th + w, n);
  }
  // The cells: the cover the highest dome over the place, the top every dome's own weighed by its square (so it is
  // continuous where two cells meet; the highest alone jumped between them and two cards could disagree on a tie).
  let cc = 0;
  let ctop = 1;
  let tw = 0;
  let tsum = 0;
  if (cells > 0) {
    const step = plan[o + 2];
    const gx = plan[o + 5] + tx * step;
    const gz = plan[o + 7] + tz * step;
    const fx0 = Math.floor(gx);
    const fz0 = Math.floor(gz);
    const ix = (plan[o + 4] + fx0) & 0xffff;
    const iz = (plan[o + 6] + fz0) & 0xffff;
    const fx = gx - fx0;
    const fz = gz - fz0;
    const salt = saltOf(seed, 0);
    let presence = cover * T.cellPresence;
    presence = presence > 1 ? 1 : presence;
    const rho0 = T.cellRadiusMin + (T.cellRadiusMax - T.cellRadiusMin) * Math.sqrt(cover);
    const life = T.cellLife;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = (ix + dx) & 0xffff;
        const cz = (iz + dz) & 0xffff;
        let h = hash2(cx, cz, salt);
        let env = 1;
        if (life > 0) {
          const ph = frame.lifeF + unit(h);
          const pf = Math.floor(ph);
          const e = (frame.lifeI + pf) & 0xffff;
          const phi = ph - pf;
          env = smooth01(0, T.cellGrow, phi) * (1 - smooth01(1 - T.cellDecay, 1, phi));
          h = pcg((h + e) >>> 0);
        }
        // One hash's four bytes: the jitter across, the jitter along, whether the cell is up, its size (`cellBytes`); its top
        // from a second only where it is up.
        const a = pcg(h);
        if (((a >>> 16) & 255) * (1 / 256) + 1 / 512 >= presence) continue;
        const px = dx + 0.5 + ((a & 255) * (1 / 256) + 1 / 512 - 0.5) * T.cellJitter;
        const pz = dz + 0.5 + (((a >>> 8) & 255) * (1 / 256) + 1 / 512 - 0.5) * T.cellJitter;
        const e2 = pcg(a);
        let rho = rho0 * (1 - T.cellSizeJitter * 0.5 + T.cellSizeJitter * ((a >>> 24) * (1 / 256) + 1 / 512)) * env * kc;
        rho = rho > 1.1 ? 1.1 : rho;
        if (!(rho > 1e-4)) continue;
        const ddx = fx - px;
        const ddz = fz - pz;
        const q = (ddx * ddx + ddz * ddz) / (rho * rho);
        const v = 1 - q;
        if (v > cc) cc = v;
        if (v > 0) {
          const w2 = v * v;
          tw += w2;
          // The look wave, round 1: the dome, its top falling from the middle to `1 − cellDome` of itself at the rim.
          tsum += w2 * (T.cellTopMin + (1 - T.cellTopMin) * unit(e2) * Math.sqrt(env)) * (1 - T.cellDome + T.cellDome * Math.sqrt(v));
        }
      }
    }
    // Toward the whole thickness where no dome stands, smoothly (a dome's last tenth of its height share).
    ctop = (tsum + 0.01) / (tw + 0.01);
    // The look wave, round 1: the turrets, a value noise of four to a cell on the cells' own lattice, each at its own height.
    if (T.cellTurrets > 0) {
      const ux = gx * (1 << TURRET_SHIFT);
      const uz = gz * (1 << TURRET_SHIFT);
      const tfx = Math.floor(ux);
      const tfz = Math.floor(uz);
      const tix = ((plan[o + 4] << TURRET_SHIFT) + tfx) & 0xffff;
      const tiz = ((plan[o + 6] << TURRET_SHIFT) + tfz) & 0xffff;
      ctop = ctop * (1 - T.cellTurrets * valueNoise(tix, tiz, ux - tfx, uz - tfz, saltOf(seed, SALT_TURRETS)));
    }
  }
  let cov = cs + (cc - cs) * cells;
  let top = 1 + (ctop - 1) * cells;
  let wet = cov * wetShare * stack[s + 18];
  // The regions: world-fixed, so a place forced to rain holds its rain clouds while the layer drifts over it.
  const rc = frame.regionCount;
  if (rc > 0) {
    // The texel's middle relative to the camera: (tx + 0.5) texels past the ring's centre corner, less the camera's own place
    // past that corner.
    const px = (tx + 0.5) * texel - plan[o];
    const pz = (tz + 0.5) * texel - plan[o + 1];
    for (let r = 0; r < rc; r++) {
      const R = frame.regions;
      const ddx = px - R[r * 4];
      const ddz = pz - R[r * 4 + 1];
      const dist = Math.sqrt(ddx * ddx + ddz * ddz);
      const rad = R[r * 4 + 2];
      const kind = R[r * 4 + 3];
      const k = 1 - smooth01(rad - T.regionEdge, rad + T.regionEdge, dist);
      if (!(k > 0)) continue;
      if (kind === REGION_DUST) {
        if (stack[s] < frame.groundY + T.regionDustBelow) {
          cov = cov * (1 - k * T.regionDustClear);
          wet = wet * (1 - k);
        }
      } else {
        const want = cov > T.regionCover ? cov : T.regionCover;
        cov = cov + k * (want - cov);
        const ws = wetShare > T.regionWet ? wetShare : T.regionWet;
        const wantWet = cov * ws > wet ? cov * ws : wet;
        wet = wet + k * (wantWet - wet);
      }
    }
  }
  if (top < 0) top = 0;
  out.cover = cov < 0 ? 0 : cov > 1 ? 1 : cov;
  out.mix = m;
  out.wet = wet < 0 ? 0 : wet > 1 ? 1 : wet;
  out.top = top > 1 ? 1 : top;
}

/**
 * The far ring's samples a texel, on its diagonal (-¼, ¼) and (¼, -¼): two, not four, since the far ring is read only past
 * 29 km where a texel is a few pixels, and four cost the map a third of its time (measured on the 5080: 0.041 of 0.065 ms).
 */
export const FAR_SAMPLES = 2;

/**
 * A whole ring of one layer as the card stores it (RGBA8: each channel × 255 rounded), the far ring two samples a texel as
 * the card takes it. The tests' and the check's; allocates its output.
 */
export function evalRing(stack: Float32Array, types: Float32Array, plan: Float64Array, frame: CloudMapFrame, T: CloudMapTune, layer: number, ring: number, out?: Uint8Array): Uint8Array {
  const R = ring === 0 ? CLOUD_MAP_RINGS.near : CLOUD_MAP_RINGS.far;
  const N = R.size;
  const px = out ?? new Uint8Array(N * N * 4);
  const t = new TexelOut();
  const h = N / 2;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let c = 0;
      let m = 0;
      let w = 0;
      let tp = 0;
      if (ring === 0) {
        evalTexel(stack, types, plan, frame, T, layer, ring, i - h, j - h, t);
        c = t.cover;
        m = t.mix;
        w = t.wet;
        tp = t.top;
      } else {
        for (let k = 0; k < FAR_SAMPLES; k++) {
          const sx = k === 0 ? -0.25 : 0.25;
          const sz = k === 0 ? 0.25 : -0.25;
          evalTexel(stack, types, plan, frame, T, layer, ring, i - h + sx, j - h + sz, t);
          c += t.cover * 0.5;
          m += t.mix * 0.5;
          w += t.wet * 0.5;
          tp += t.top * 0.5;
        }
      }
      const o = (j * N + i) * 4;
      px[o] = Math.round(c * 255);
      px[o + 1] = Math.round(m * 255);
      px[o + 2] = Math.round(w * 255);
      px[o + 3] = Math.round(tp * 255);
    }
  }
  return px;
}

/**
 * A ring's stored texels read as the card's linear sampler reads them, at a place relative to the camera (metres), into
 * `out` (four numbers 0 to 1). `rgba` one layer's ring (`evalRing`'s or a read-back), `plan` the frame's. Nought outside.
 */
export function sampleRing(rgba: Uint8Array, plan: Float64Array, layer: number, ring: number, relX: number, relZ: number, out: Float64Array): void {
  const R = ring === 0 ? CLOUD_MAP_RINGS.near : CLOUD_MAP_RINGS.far;
  const N = R.size;
  const o = (layer * 2 + ring) * RING_FLOATS;
  const u = ((relX + plan[o]) / R.span + 0.5) * N - 0.5;
  const v = ((relZ + plan[o + 1]) / R.span + 0.5) * N - 0.5;
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const fu = u - i0;
  const fv = v - j0;
  for (let c = 0; c < 4; c++) out[c] = 0;
  if (i0 < -1 || j0 < -1 || i0 > N - 1 || j0 > N - 1) return;
  for (let c = 0; c < 4; c++) {
    const at = (i: number, j: number): number => {
      const ii = i < 0 ? 0 : i > N - 1 ? N - 1 : i;
      const jj = j < 0 ? 0 : j > N - 1 ? N - 1 : j;
      return rgba[(jj * N + ii) * 4 + c] / 255;
    };
    const a = at(i0, j0);
    const b = at(i0 + 1, j0);
    const d = at(i0, j0 + 1);
    const e = at(i0 + 1, j0 + 1);
    out[c] = (a + (b - a) * fu) * (1 - fv) + (d + (e - d) * fu) * fv;
  }
}

/** The tune into the card's layout (`MAP_TUNE_FLOATS`): five vec4, in the order `cloudMapGpu.ts` reads them. */
export const MAP_TUNE_FLOATS = 6 * 4;
export function packMapTune(T: CloudMapTune, f: CloudMapFrame, out: Float32Array): void {
  out[0] = T.cellJitter;
  out[1] = T.cellPresence;
  out[2] = T.cellRadiusMin;
  out[3] = T.cellRadiusMax;
  out[4] = T.cellSizeJitter;
  out[5] = T.cellTopMin;
  out[6] = T.cellGrow;
  out[7] = T.cellDecay;
  out[8] = T.sheetContrast;
  out[9] = T.mixContrast;
  out[10] = T.edgeMin;
  out[11] = T.edgeSpan;
  out[12] = T.regionEdge;
  out[13] = T.regionCover;
  out[14] = T.regionWet;
  out[15] = T.regionDustClear;
  out[16] = T.regionDustBelow;
  out[17] = T.cellLife > 0 ? 1 : 0;
  out[18] = f.lifeI;
  out[19] = f.lifeF;
  // The look wave, round 1: the domes, the turrets, the clusters.
  out[20] = T.cellDome;
  out[21] = T.cellTurrets;
  out[22] = T.clusters;
  out[23] = 0;
}

// ------------------------------------------------------------------------------------------------ the level, in closed form

/** The weather's hash (`weatherSchedule.ts`'s `rand3`), through kept records: the frame's form, no number across a call. */
const RQ = new Int32Array(3);
const RR = new Float64Array(1);
function mixQ(h: number, v: number): number {
  h = Math.imul(h ^ (v | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h;
}
function rand3Q(): void {
  const h = mixQ(mixQ(mixQ(0x9e3779b9, RQ[0]), RQ[1]), RQ[2]);
  RR[0] = (h >>> 0) / 4294967296;
}

/**
 * The schedule's level in closed form (the design's 2.1): at shared second τ, the level of the step before eased toward the
 * step's own at the weather's own rate (`LEVEL_RATE`, a level in 40 s) from the step's start, exactly as the weather's
 * continuous level stands whenever nothing is held (a step moves one level at most and lasts 300 s, so the ease is always
 * done before the next). Every browser at the same τ has the same level, whenever it joined. Two steps' levels are kept.
 */
export class CloudSchedule {
  seed = 0;
  weights: number[] = [1];
  /** The answer: the level at the last `at`. */
  level = 0.5;
  /** The τ asked (a field: the frame's form). */
  tau = 0.5;
  private stepKept = Number.NaN;
  private here = 0;
  private before = 0;
  private ls = 0;
  private lsStep = 0.5;
  private lp = 0;

  /** The last four steps' levels worked out: [step] and [level], written round (the walk's own memo). */
  private readonly memoStep = new Float64Array(4).fill(Number.NaN);
  private readonly memoLevel = new Int32Array(4);
  private memoAt = 0;

  setWorld(seed: number, weights: readonly number[]): void {
    this.seed = seed | 0;
    this.weights = weights.slice();
    this.stepKept = Number.NaN;
    this.memoStep.fill(Number.NaN);
  }

  /**
   * The level at `this.tau` into `this.level`, and the next step's worked out every frame into the memo: so the walk is hot
   * and optimised (one worked out only when a step turns, every 300 s, ran unoptimised and made its numbers: the wind's lesson,
   * `windMath.ts`'s `levelAhead`), and the next step's level is kept before it is asked for. Allocates nothing.
   */
  at(): void {
    const tau = this.tau;
    const step = Math.floor(tau / STEP_SECONDS);
    // The step's levels read through the memo every frame (four comparisons), so the memo's path is hot when a step turns.
    this.lsStep = step - 1;
    this.walkKept();
    this.before = this.ls;
    this.lsStep = step;
    this.walkKept();
    this.here = this.ls;
    this.stepKept = step;
    // Clamped by Math.min and Math.max, never a conditional write of 0 or 1 (that makes the local a boxed value: CLAUDE.md).
    const f = Math.min(1, Math.max(0, (tau - step * STEP_SECONDS) * LEVEL_RATE));
    this.level = this.before + f * (this.here - this.before);
    // The step ahead, every frame.
    this.lsStep = step + 1;
    this.walk();
    this.keep();
  }

  /** The step asked and its level (`levelAsked`'s: the frame's form, no number across a call). */
  askStep = 0.5;
  asked = 0;

  /** The level at `askStep` into `asked` (from the memo when it holds it). */
  levelAsked(): void {
    this.lsStep = this.askStep;
    this.walkKept();
    this.asked = this.ls;
  }

  /** `walk` at `lsStep` through the memo: a step kept is read, another worked out and kept. */
  private walkKept(): void {
    const s = this.lsStep;
    const m = this.memoStep;
    for (let i = 0; i < 4; i++) {
      if (m[i] === s) {
        this.ls = this.memoLevel[i];
        return;
      }
    }
    this.walk();
    this.keep();
  }

  /** `ls` at `lsStep` into the memo (in place where the step is kept already). */
  private keep(): void {
    const s = this.lsStep;
    const m = this.memoStep;
    for (let i = 0; i < 4; i++) {
      if (m[i] === s) {
        this.memoLevel[i] = this.ls;
        return;
      }
    }
    const at = this.memoAt;
    m[at] = s;
    this.memoLevel[at] = this.ls;
    this.memoAt = (at + 1) & 3;
  }

  /** The level at a whole step (the tests' form, held to the weather's own `levelAtStep`). */
  levelAtStep(step: number): number {
    this.lsStep = step;
    this.walk();
    return this.ls;
  }

  /** `levelAtStep(seed, weights, lsStep)` into `ls`, through the kept hash records. */
  private walk(): void {
    const step = this.lsStep;
    const W = this.weights;
    const a = Math.floor(step / ANCHOR_STEPS);
    RQ[0] = this.seed;
    RQ[1] = a;
    RQ[2] = 1;
    rand3Q();
    this.pick();
    let level = this.lp;
    RQ[1] = a + 1;
    rand3Q();
    this.pick();
    const next = this.lp;
    const steps = step - a * ANCHOR_STEPS;
    for (let k = 1; k <= steps; k++) {
      const s = a * ANCHOR_STEPS + k;
      const left = ANCHOR_STEPS - k;
      const dist = next - level;
      if (Math.abs(dist) > left || (k > ANCHOR_STEPS - BRIDGE_STEPS && dist !== 0)) {
        level += Math.sign(dist);
        continue;
      }
      RQ[1] = s;
      RQ[2] = 2;
      rand3Q();
      const r = RR[0];
      if (r >= MOVE_CHANCE) continue;
      const cand = level + (r < MOVE_CHANCE / 2 ? 1 : -1);
      if (cand < 0 || cand >= W.length || Math.abs(next - cand) > left) continue;
      const wOld = W[level];
      const accept = wOld > 0 ? Math.min(1, W[cand] / wOld) : 1;
      RQ[2] = 3;
      rand3Q();
      if (RR[0] < accept) level = cand;
    }
    this.ls = level;
  }

  private pick(): void {
    const W = this.weights;
    let total = 0;
    for (let i = 0; i < W.length; i++) total += W[i];
    let x = RR[0] * total;
    let out = W.length - 1;
    for (let i = 0; i < W.length; i++) {
      x -= W[i];
      if (x < 0) {
        out = i;
        break;
      }
    }
    this.lp = out;
  }
}

// ------------------------------------------------------------------------------------------------ the drift, in closed form

/**
 * The moment every world's drift is summed from (shared seconds): the first of January 2026, a fixed moment before any
 * clock this game will share. The sum from it to a moment now is about 100,000 of the schedule's steps (a few tens of
 * milliseconds behind a loading screen, growing by a twelfth a month); every later step is one more on a step's turn.
 */
export const DRIFT_EPOCH = Date.UTC(2026, 0, 1) / 1000;

/** The step starts the drift keeps behind it (a clock walked back, the console's asked moment): eight, 40 minutes. */
export const KEPT_STEPS = 8;

/** Gauss–Legendre's six points on [−1, 1] and their weights (the quadrature of each piece of a step). */
const GL_X = [-0.9324695142031521, -0.6612093864662645, -0.2386191860831969, 0.2386191860831969, 0.6612093864662645, 0.9324695142031521];
const GL_W = [0.1713244923791704, 0.3607615730481386, 0.467913934572691, 0.467913934572691, 0.3607615730481386, 0.1713244923791704];

/**
 * The one wind aloft integrated in closed form (the design's 2.1): its heading `windAt`'s walk (the weather's value noise over
 * `wanderPeriod` seconds times 4π, the wobble left out since it is under a player's own setting), its speed the world's
 * travel at the schedule's level (`levelSpeeds`, one a whole level, already times the aloft factor and floored as
 * `wind.ts`'s aloft rule does), eased between levels as the schedule's level is. Summed knot by knot: a step of the
 * schedule (300 s, within one knot of the heading's walk) at a time, each in two pieces (the level's ease, then the rest),
 * each piece by six-point Gauss–Legendre; from `DRIFT_EPOCH` at the world's arrival, and one step more at each step's turn.
 * Every browser sums the same pieces in the same order, so every browser has the same drift.
 *
 * `at()` writes the drift at `tau` (metres, x and z) and the wind there (m/s). Allocates nothing on the frame's path.
 */
export class CloudDrift {
  /** In: the world's schedule (its seed and weights), the speeds by whole level, the walk's period. */
  readonly sched = new CloudSchedule();
  speeds = new Float64Array(5);
  period = 1200;
  /** In: the moment asked. */
  tau = 0.5;
  /** Out: the drift and the wind at `tau`. */
  x = 0.5;
  z = 0.5;
  vx = 0.5;
  vz = 0.5;
  /** Steps summed since the world was set, and the milliseconds the first sum took (the console's). */
  steps = 0;
  primeMs = 0.5;
  /** The drift at the start of step `k`. */
  private k = Number.NaN;
  private kx = 0.5;
  private kz = 0.5;
  /** The heading's walk's two knots kept for the knot `knot`. */
  private knot = Number.NaN;
  private ka = 0.5;
  private kb = 0.5;
  /** A step's level before and after, and its first piece's sum (the ease's 40 s, the same whatever τ is within the step). */
  private pk = Number.NaN;
  private lvB = 0.5;
  private lvH = 0.5;
  private p0x = 0.5;
  private p0z = 0.5;
  /** A piece's ends and sum (fields: no number across a call). */
  private a0 = 0.5;
  private a1 = 0.5;
  private sx = 0.5;
  private sz = 0.5;
  /** The integrand's point and answer. */
  private t = 0.5;
  private wx = 0.5;
  private wz = 0.5;

  /** A world: its schedule's seed and weights and its aloft speeds by whole level. Sums from the epoch at the next `at`. */
  setWorld(seed: number, weights: readonly number[], speeds: ArrayLike<number>, period = 1200): void {
    this.sched.setWorld(seed, weights);
    this.speeds = new Float64Array(5);
    for (let i = 0; i < 5; i++) this.speeds[i] = speeds[Math.min(i, speeds.length - 1)] ?? 0;
    this.period = period;
    this.k = Number.NaN;
    this.kept.fill(Number.NaN);
    this.knot = Number.NaN;
    this.pk = Number.NaN;
  }

  /** The wind at `t` (the step `pk`'s levels and the knot's values in force), into `wx`, `wz`. */
  private wind(): void {
    const t = this.t;
    const u = t / this.period;
    const i = Math.floor(u);
    if (i !== this.knot) {
      this.knot = i;
      RQ[0] = this.sched.seed;
      RQ[1] = i;
      RQ[2] = 11;
      rand3Q();
      this.ka = RR[0];
      RQ[1] = i + 1;
      rand3Q();
      this.kb = RR[0];
    }
    const f = u - i;
    const s = f * f * (3 - 2 * f);
    const h = (this.ka + (this.kb - this.ka) * s) * Math.PI * 4;
    // The level at t within the step: eased from the step's start.
    const st = this.pk * STEP_SECONDS;
    const e = Math.min(1, Math.max(0, (t - st) * LEVEL_RATE));
    const L = this.lvB + e * (this.lvH - this.lvB);
    const lo = Math.floor(L);
    const hi = lo + 1 < 5 ? lo + 1 : lo;
    const fl = L - lo;
    const sp = this.speeds[lo] + fl * (this.speeds[hi] - this.speeds[lo]);
    this.wx = Math.sin(h) * sp;
    this.wz = Math.cos(h) * sp;
  }

  /** The integral of the wind over [a0, a1] (within one step `pk`) into `sx`, `sz`. */
  private piece(): void {
    const a = this.a0;
    const b = this.a1;
    const m = (a + b) * 0.5;
    const r = (b - a) * 0.5;
    let x = 0;
    let z = 0;
    for (let i = 0; i < 6; i++) {
      this.t = m + r * GL_X[i];
      this.wind();
      x += GL_W[i] * this.wx;
      z += GL_W[i] * this.wz;
    }
    this.sx = x * r;
    this.sz = z * r;
  }

  /** The step `stepIn` works on (a field: no number across a call). */
  private kIn = 0.5;

  /** Step `kIn`'s levels and its first piece's sum, kept. */
  private stepIn(): void {
    // Worked out whole every frame (the levels from the schedule's memo, the ease's piece of six winds), so this path is hot
    // and optimised when a step turns: run only then, it ran unoptimised and made its numbers (the wind's lesson).
    const k = this.kIn;
    this.sched.askStep = k - 1;
    this.sched.levelAsked();
    this.lvB = this.sched.asked;
    this.sched.askStep = k;
    this.sched.levelAsked();
    this.lvH = this.sched.asked;
    this.pk = k;
    const st = k * STEP_SECONDS;
    this.a0 = st;
    this.a1 = st + 1 / LEVEL_RATE;
    this.piece();
    this.p0x = this.sx;
    this.p0z = this.sz;
  }

  /** The drift and the wind at `tau` into `x`, `z`, `vx`, `vz`. Sums from the epoch the first time; allocates nothing after. */
  at(): void {
    // Math.max: a module's constant and a field's double meeting in a conditional made the local a boxed value (a number a call).
    const tau = Math.max(this.tau, DRIFT_EPOCH);
    const step = Math.floor(tau / STEP_SECONDS);
    // A moment a few steps back (a clock walked back a little, the console's asked moment): the step's start taken from the
    // kept sums, the very numbers summed on the way, so nothing is summed again from the epoch and the answer is the same.
    if (step < this.k && this.k === this.k) {
      const m = this.kept;
      for (let i = 0; i < KEPT_STEPS; i++) {
        if (m[i * 3] === step) {
          this.k = step;
          this.kx = m[i * 3 + 1];
          this.kz = m[i * 3 + 2];
          break;
        }
      }
    }
    if (!(this.k === this.k) || step < this.k) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      this.k = Math.floor(DRIFT_EPOCH / STEP_SECONDS);
      this.kx = 0;
      this.kz = 0;
      this.pk = Number.NaN;
      this.advTo = step;
      this.advance();
      this.primeMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    } else {
      // Every frame, nought steps but at a step's turn (so the sum's path is hot when it turns).
      this.advTo = step;
      this.advance();
    }
    // Within the step: the ease's piece (whole once past it) and the rest up to τ.
    this.kIn = step;
    this.stepIn();
    const st = step * STEP_SECONDS;
    const easeEnd = st + 1 / LEVEL_RATE;
    let x = this.kx;
    let z = this.kz;
    if (tau <= easeEnd) {
      this.a0 = st;
      this.a1 = tau;
      this.piece();
      x += this.sx;
      z += this.sz;
    } else {
      x += this.p0x;
      z += this.p0z;
      this.a0 = easeEnd;
      this.a1 = tau;
      this.piece();
      x += this.sx;
      z += this.sz;
    }
    this.x = x;
    this.z = z;
    this.t = tau;
    this.wind();
    this.vx = this.wx;
    this.vz = this.wz;
    // The epoch's own clamp: before it the drift runs on at the epoch's wind.
    if (this.tau < DRIFT_EPOCH) {
      this.x += this.vx * (this.tau - DRIFT_EPOCH);
      this.z += this.vz * (this.tau - DRIFT_EPOCH);
    }
  }

  /** The last `KEPT_STEPS` step starts summed: [step, x, z] each, written round. */
  private readonly kept = new Float64Array(KEPT_STEPS * 3).fill(Number.NaN);
  private keptAt = 0;

  /** The step `advance` sums up to (a field: no number across a call). */
  private advTo = 0.5;

  /** Whole steps summed from `k` up to (not including) `advTo`, each its two pieces; each step's start kept as it is reached. */
  private advance(): void {
    const to = this.advTo;
    while (this.k < to) {
      const k = this.k;
      this.kIn = k;
      this.stepIn();
      const st = k * STEP_SECONDS;
      this.a0 = st + 1 / LEVEL_RATE;
      this.a1 = st + STEP_SECONDS;
      this.piece();
      this.kx += this.p0x + this.sx;
      this.kz += this.p0z + this.sz;
      this.k = k + 1;
      this.steps++;
      if (to - this.k < KEPT_STEPS) {
        const i = this.keptAt;
        this.kept[i * 3] = this.k;
        this.kept[i * 3 + 1] = this.kx;
        this.kept[i * 3 + 2] = this.kz;
        this.keptAt = (i + 1) % KEPT_STEPS;
      }
    }
  }
}

/** A double's positive remainder (the drift handed to the card modulo `CLOUD_DRIFT_WRAP`). */
export function wrapDrift(v: number): number {
  const r = v % CLOUD_DRIFT_WRAP;
  return r < 0 ? r + CLOUD_DRIFT_WRAP : r;
}

/** The diurnal swing at a day's time (0 midnight, 0.5 noon): 1 at mid-afternoon (15:00), −1 at 03:00. */
export function hourSwing(time: number): number {
  return Math.cos(2 * Math.PI * (time - 0.625));
}

/** The level's wetness: nought under `wetFrom`, one at `wetFull`, smoothstepped. */
export function levelWet(level: number, T: CloudMapTune): number {
  return smooth01(T.wetFrom, T.wetFull > T.wetFrom ? T.wetFull : T.wetFrom + 0.01, level);
}
