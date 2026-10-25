// The blowing sand's picture (the volumetrics' third wave, the design's §2.7): a tileable 256 × 256 value noise of ours,
// made at run time from a fixed seed, the same in every browser, never committed and never the client's (the interface
// rule, and the brief's "of ours"). Red is the grain clumps (lattices every 8, 16 and 32 texels), green the coarse
// patches (64 and 128), blue a third noise kept for the streaks' break-up (16 and 64), alpha 255; every lattice period
// divides 256, so it tiles exactly. Each channel is stretched to a mean of a half and a spread of 0.166 once the picture
// is whole (research-amend-ground §2.4's measure), so the grains' and the patches' cuts mean the same on every picture.
//
// About 11 ms to make whole, which is a hitch on a live frame: behind a loading screen it is made outright
// (`makeSandPicture`), and in the master's in-play warm a slice of rows a frame (`sandPictureRows`), uploaded only once
// whole (the field's swap waits for it).
//
// Pure: no three, nothing of the page.

/** Texels across the picture (and down it): every lattice period below divides it. */
export const SAND_SIZE = 256;

/** The rows the in-play warm makes a frame: eight frames for the whole picture, about 1.5 ms each. */
export const SAND_ROWS_A_FRAME = 32;

/** The spread each channel is stretched to (research-amend-ground §2.4: the picture's measured deviation). */
const SPREAD = 0.166;

/** One channel's octaves: a lattice period in texels and its weight. */
interface Octave {
  period: number;
  weight: number;
  lattice: Float32Array;
}

/** The picture being made: its octaves, the raw sums a row at a time, the running moments, and the bytes once whole. */
export interface SandPicture {
  readonly channels: readonly (readonly Octave[])[];
  /** Three channels a texel, the octaves' weighted sums before the stretch. */
  readonly raw: Float32Array;
  /** RGBA bytes, written once every row is made. */
  readonly bytes: Uint8Array;
  /** Each channel's sum and sum of squares over the rows made so far. */
  readonly moments: Float64Array;
  rows: number;
  whole: boolean;
}

/** A small LCG (the gusts' own kind, `airField.ts`), the same every session. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function octave(period: number, weight: number, next: () => number): Octave {
  const n = SAND_SIZE / period;
  const lattice = new Float32Array(n * n);
  for (let i = 0; i < lattice.length; i++) lattice[i] = next();
  return { period, weight, lattice };
}

/** A picture with nothing made yet: its lattices drawn from the fixed seed. */
export function newSandPicture(): SandPicture {
  const next = lcg(0x5a17d00d);
  const channels = [
    [octave(8, 0.5, next), octave(16, 0.3, next), octave(32, 0.2, next)],
    [octave(64, 0.6, next), octave(128, 0.4, next)],
    [octave(16, 0.5, next), octave(64, 0.5, next)],
  ];
  return { channels, raw: new Float32Array(SAND_SIZE * SAND_SIZE * 3), bytes: new Uint8Array(SAND_SIZE * SAND_SIZE * 4), moments: new Float64Array(6), rows: 0, whole: false };
}

/** One octave's smooth value noise at texel (x, y), wrapping. */
function valueAt(o: Octave, x: number, y: number): number {
  const p = o.period;
  const n = SAND_SIZE / p;
  const fx = x / p;
  const fy = y / p;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  let tx = fx - ix;
  let ty = fy - iy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const x0 = ix % n;
  const y0 = iy % n;
  const x1 = (x0 + 1) % n;
  const y1 = (y0 + 1) % n;
  const L = o.lattice;
  const a = L[y0 * n + x0] + (L[y0 * n + x1] - L[y0 * n + x0]) * tx;
  const b = L[y1 * n + x0] + (L[y1 * n + x1] - L[y1 * n + x0]) * tx;
  return a + (b - a) * ty;
}

/**
 * Make `rows` more rows of the picture from `from` (the in-play warm's slice), into its raw sums; when the last row is
 * made the picture is stretched into its bytes and is whole. Answers whether it is whole.
 */
export function sandPictureRows(pic: SandPicture, from: number, rows: number): boolean {
  if (pic.whole) return true;
  const end = Math.min(SAND_SIZE, from + rows);
  const raw = pic.raw;
  const m = pic.moments;
  for (let y = from; y < end; y++) {
    for (let x = 0; x < SAND_SIZE; x++) {
      const k = (y * SAND_SIZE + x) * 3;
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (const o of pic.channels[c]) v += o.weight * valueAt(o, x, y);
        raw[k + c] = v;
        m[c * 2] += v;
        m[c * 2 + 1] += v * v;
      }
    }
  }
  if (end > pic.rows) pic.rows = end;
  if (pic.rows < SAND_SIZE) return false;
  const count = SAND_SIZE * SAND_SIZE;
  const mean = [0, 0, 0];
  const scale = [1, 1, 1];
  for (let c = 0; c < 3; c++) {
    mean[c] = m[c * 2] / count;
    const variance = m[c * 2 + 1] / count - mean[c] * mean[c];
    const sd = Math.sqrt(variance > 1e-12 ? variance : 1e-12);
    scale[c] = SPREAD / sd;
  }
  const bytes = pic.bytes;
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) {
      const v = 0.5 + (raw[i * 3 + c] - mean[c]) * scale[c];
      bytes[i * 4 + c] = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255);
    }
    bytes[i * 4 + 3] = 255;
  }
  pic.whole = true;
  return true;
}

/** The whole picture at once (behind a loading screen, and the tests'). */
export function makeSandPicture(): SandPicture {
  const pic = newSandPicture();
  sandPictureRows(pic, 0, SAND_SIZE);
  return pic;
}
