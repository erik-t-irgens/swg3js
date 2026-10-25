// The wisps' noise (the third wave, the design's §2.14): a 64³ tileable Perlin-Worley noise of ours, one byte a texel,
// made at run time from a fixed seed, so it is the same in every browser, shipped nowhere and never the client's. The
// march reads it as a repeating, mipmapped 3D texture, carried by each layer's own air in two phases, and erodes the dust
// by it (`wispKeep`).
//
// **Made in slices.** The whole volume is 262,144 texels of gradient noise and cellular distance, about a tenth of a
// second; behind a loading screen it is made outright, and during the master's in-play warm a layer at a time (a couple
// of milliseconds a frame), and only uploaded once whole (`noiseSlice`, the field's) -- never part made. Made only with
// the master on, and once a session.
//
// **The expected keep.** As it makes the noise it counts its bytes into a histogram, from which the erosion's expected
// keep at sixteen erosions is worked out (`keepTable`): what `keepColumn` divides by to hold the dust's mean opacity. It
// is worked out again whenever `erodeFull` moves, from the same histogram (no texel read again).
//
// Pure: no three; the field uploads the bytes.

/** The noise's size a side: 64 texels, a repeat of 20 m at the wisps' default scale (31 cm a texel). */
export const NOISE_SIZE = 64;
/** Layers a slice makes during the in-play warm: one, about 2 ms. */
export const NOISE_LAYERS_A_FRAME = 1;
/** Entries of the expected-keep table, erosions 0 to 1 evenly. */
export const KEEP_TABLE = 16;

/** The noise being made: its bytes, how many layers are done, and the histogram of what was made. */
export interface NoiseVolume {
  bytes: Uint8Array;
  layers: number;
  histogram: Uint32Array;
  /** Each octave's lattice gradients (a period of 8 and of 16 cells) and its cells' feature points. */
  grad8: Float32Array;
  grad16: Float32Array;
  pts8: Float32Array;
  pts16: Float32Array;
}

/** A small LCG of a fixed seed, the same every session (the gusts' noise's own kind). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A unit gradient a lattice point of an `n`-cell periodic lattice, and a feature point a cell. */
function lattice(n: number, rnd: () => number): { grad: Float32Array; pts: Float32Array } {
  const grad = new Float32Array(n * n * n * 3);
  const pts = new Float32Array(n * n * n * 3);
  for (let i = 0; i < n * n * n; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    let l = 0;
    do {
      x = rnd() * 2 - 1;
      y = rnd() * 2 - 1;
      z = rnd() * 2 - 1;
      l = x * x + y * y + z * z;
    } while (l < 0.05 || l > 1);
    l = Math.sqrt(l);
    grad[i * 3] = x / l;
    grad[i * 3 + 1] = y / l;
    grad[i * 3 + 2] = z / l;
    pts[i * 3] = rnd();
    pts[i * 3 + 1] = rnd();
    pts[i * 3 + 2] = rnd();
  }
  return { grad, pts };
}

/** A volume to make, nothing made yet: the seed is fixed, so every session's noise is the same. */
export function newNoiseVolume(): NoiseVolume {
  const rnd = lcg(0x5eed1e5);
  const a = lattice(8, rnd);
  const b = lattice(16, rnd);
  return { bytes: new Uint8Array(NOISE_SIZE * NOISE_SIZE * NOISE_SIZE), layers: 0, histogram: new Uint32Array(256), grad8: a.grad, grad16: b.grad, pts8: a.pts, pts16: b.pts };
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Gradient noise at (x, y, z) in lattice cells of an `n`-cell periodic lattice, about -1 to 1. */
function perlin(x: number, y: number, z: number, n: number, g: Float32Array): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  let sum = 0;
  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);
  for (let c = 0; c < 8; c++) {
    const ox = c & 1;
    const oy = (c >> 1) & 1;
    const oz = (c >> 2) & 1;
    const ix = (((xi + ox) % n) + n) % n;
    const iy = (((yi + oy) % n) + n) % n;
    const iz = (((zi + oz) % n) + n) % n;
    const k = ((iz * n + iy) * n + ix) * 3;
    const d = g[k] * (fx - ox) + g[k + 1] * (fy - oy) + g[k + 2] * (fz - oz);
    const wx = ox ? u : 1 - u;
    const wy = oy ? v : 1 - v;
    const wz = oz ? w : 1 - w;
    sum += d * wx * wy * wz;
  }
  return sum;
}

/** Cellular noise at (x, y, z) in cells of an `n`-cell periodic grid, a feature point a cell: 1 at a point, falling to 0 a cell away. */
function worley(x: number, y: number, z: number, n: number, p: Float32Array): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;
        const cz = zi + dz;
        const ix = ((cx % n) + n) % n;
        const iy = ((cy % n) + n) % n;
        const iz = ((cz % n) + n) % n;
        const k = ((iz * n + iy) * n + ix) * 3;
        const qx = cx + p[k] - x;
        const qy = cy + p[k + 1] - y;
        const qz = cz + p[k + 2] - z;
        const d = qx * qx + qy * qy + qz * qz;
        if (d < best) best = d;
      }
    }
  }
  const d = Math.sqrt(best);
  return d < 1 ? 1 - d : 0;
}

/**
 * The noise at texel (i, j, k), 0 to 1: gradient noise of two octaves (8 and 16 cells over the 64) remapped by a
 * cellular one of two octaves -- the Perlin-Worley of cloud renderers, billowy cells with soft gradient edges -- so the
 * erosion opens rounded holes and curls rather than salt and pepper. Tiles across its wrap on every axis.
 */
export function noiseAt(v: NoiseVolume, i: number, j: number, k: number): number {
  const s8 = 8 / NOISE_SIZE;
  const s16 = 16 / NOISE_SIZE;
  const p = 0.5 + 0.7 * (perlin(i * s8, j * s8, k * s8, 8, v.grad8) + 0.5 * perlin(i * s16, j * s16, k * s16, 16, v.grad16));
  const w = 0.65 * worley(i * s8, j * s8, k * s8, 8, v.pts8) + 0.35 * worley(i * s16, j * s16, k * s16, 16, v.pts16);
  // remap(perlin, worley - 1, 1, 0, 1): the cells cut the gradient noise's low ground away.
  const pc = p < 0 ? 0 : p > 1 ? 1 : p;
  const r = (pc - (w - 1)) / (2 - w);
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

/**
 * Make `count` more layers (k slices) of the volume, counting each byte into the histogram; answers whether it is whole.
 * A layer is 4,096 texels, about 2 ms.
 */
export function noiseLayers(v: NoiseVolume, count: number): boolean {
  const n = NOISE_SIZE;
  const end = Math.min(n, v.layers + Math.max(1, Math.floor(count)));
  for (let k = v.layers; k < end; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const b = Math.round(noiseAt(v, i, j, k) * 255);
        v.bytes[(k * n + j) * n + i] = b;
        v.histogram[b]++;
      }
    }
  }
  v.layers = end;
  return end >= n;
}

/**
 * The erosion's keep at a noise value `n` (0 to 1) and an erosion `e`: the cut `clamp((n − e) / (1 − e))` brought in over
 * the first `erodeFull` of erosion, so it is one exactly at `e` 0 (fresh dust whole) and the threshold erosion past it,
 * which opens holes. The march's line and the mirror's.
 */
export function wispKeep(n: number, e: number, erodeFull: number): number {
  if (!(e > 0)) return 1;
  const ee = e < 1 ? e : 1;
  const cut0 = (n - ee) / (1 - ee > 1e-3 ? 1 - ee : 1e-3);
  const cut = cut0 > 0 ? (cut0 < 1 ? cut0 : 1) : 0;
  const ef = erodeFull > 1e-3 ? erodeFull : 1e-3;
  const k0 = ee / ef;
  const k = k0 < 1 ? k0 : 1;
  return 1 + (cut - 1) * k;
}

/** The expected keep at sixteen erosions `i / 15`, from the histogram (the mean of `wispKeep` over the noise's own bytes), into `out`. */
export function keepTable(histogram: Uint32Array, erodeFull: number, out: Float32Array): Float32Array {
  let total = 0;
  for (let b = 0; b < 256; b++) total += histogram[b];
  for (let i = 0; i < KEEP_TABLE; i++) {
    const e = i / (KEEP_TABLE - 1);
    let sum = 0;
    for (let b = 0; b < 256; b++) if (histogram[b]) sum += histogram[b] * wispKeep(b / 255, e, erodeFull);
    out[i] = total > 0 ? sum / total : 1;
  }
  return out;
}

/**
 * The erosion at a march sample (the march's line): `erode` times a weight that is 0.4 at the patch's mean height and one
 * a spread or more above or below it (the owner's "less full vertically"), times the age term -- `smoothstep(0, ageWisp,
 * age)`, asked only while `ageWisp` is above nought (a uniform branch, never equal edges), one otherwise.
 */
export function wispErosion(erode: number, hy: number, mu: number, sigma: number, age: number, ageWisp: number): number {
  let ag = 1;
  if (ageWisp > 0) {
    const t0 = age / ageWisp;
    const t = t0 > 0 ? (t0 < 1 ? t0 : 1) : 0;
    ag = t * t * (3 - 2 * t);
  }
  const s = sigma > 1e-6 ? sigma : 1e-6;
  const a0 = Math.abs(hy - mu) / s;
  const a = a0 < 1 ? a0 : 1;
  return erode * (0.4 + 0.6 * a) * ag;
}

/**
 * A sample's density after the wisps (the march's line): the density as it came, by `Object.is`, while `erode` is nought
 * (the whole term a uniform branch); else times the keep, and with `keepColumn` above nought divided by the expected keep
 * mixed in by it, never by less than `keepFloor`.
 */
export function wispDensity(dens: number, n: number, erode: number, e: number, erodeFull: number, keepColumn: number, keepFloor: number, table: Float32Array): number {
  if (!(erode > 0)) return dens;
  let keep = wispKeep(n, e, erodeFull);
  if (keepColumn > 0) {
    const ee = e < 1 ? e : 1;
    const m = 1 + (expectedKeep(table, ee) - 1) * keepColumn;
    keep /= m > keepFloor ? m : keepFloor;
  }
  return dens * keep;
}

/** The expected keep at an erosion `e` (0 to 1) from the table, read as the march reads it: linear between its entries. */
export function expectedKeep(table: Float32Array, e: number): number {
  const x = (e > 0 ? (e < 1 ? e : 1) : 0) * (KEEP_TABLE - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = table[i];
  const b = table[i + 1 < KEEP_TABLE ? i + 1 : i];
  return a + (b - a) * f;
}

/**
 * The two phases of the flow noise (the flow-map scheme), in a kept record: in, the clock's seconds and the period; out,
 * each phase's time as a share of the period (`p0`, `p1`, half a period apart) and the weight of phase one (`cross`):
 * nought where phase zero is halfway, one where it restarts, so a phase's restart carries no weight and the two
 * cross-fade continuously. Each phase restarts its offset at nought, so the pattern never stretches past one period.
 */
export interface WispPhase {
  time: number;
  period: number;
  p0: number;
  p1: number;
  cross: number;
}

export function newWispPhase(): WispPhase {
  return { time: 0.5, period: 1.5, p0: 0.5, p1: 0.5, cross: 0.5 };
}

export function wispPhaseIn(r: WispPhase): void {
  const T = r.period > 1e-3 ? r.period : 1e-3;
  const t = Number.isFinite(r.time) ? r.time : 0;
  const a = t / T;
  r.p0 = a - Math.floor(a);
  const b = a + 0.5;
  r.p1 = b - Math.floor(b);
  const c = 1 - 2 * r.p0;
  r.cross = c < 0 ? -c : c;
}
