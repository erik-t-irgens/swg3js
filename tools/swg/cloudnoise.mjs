// The two noise volumes a cloud raymarch reads, generated rather than converted.
//
// **Nothing here comes out of the archives.** It is generic Perlin-Worley cloud noise, the same on
// every world, and the client never had any: it drew its sky as flat tiling sheets. So this takes no
// `<swg-dir>`, needs no `--retail-only`, and the pack it writes says `source: 'invented'` on the
// same precedent the made-up system already set.
//
// The shape is the one the published technique uses, and it is worth writing down which parts are
// load-bearing.
//
// **Worley noise inverted is a cloud.** Ordinary Worley is the distance to the nearest of a set of
// scattered points, which looks like cell walls; one minus it is a field of round blobs, which is
// what a cumulus is made of. Perlin on its own is too smooth to be cloud and too even to be
// interesting, so the base channel is Perlin **remapped into** Worley -- the billowy shape of one
// with the connected structure of the other.
//
// **Every octave must tile.** The volume is sampled over and over across a sky kilometres wide, so
// a feature point is placed in a grid that wraps: without it, one seam runs across the whole sky
// and nothing about the march can hide it.
//
// **The channels are frequencies, not colours.** The base volume carries the billow in red and
// three rising frequencies of Worley in green, blue and alpha, which the march subtracts from the
// shape to eat its edges away. That is why it is one 128-cube fetch and not four.

/** How big each volume is, and what it costs. Ours; the technique's own numbers are these. */
export const CLOUD_NOISE = {
  /** The base volume: the billow and three erosion frequencies. 128 cubed by four channels is 8 MB. */
  baseSize: 128,
  /** The detail volume, which eats the last few metres of an edge. 32 cubed is 128 KB. */
  detailSize: 32,
  /** Feature points per axis for each of the base volume's four channels. */
  baseFrequencies: [4, 8, 16, 32],
  /** And for the detail volume's three. */
  detailFrequencies: [8, 16, 32],
  /** Octaves in the Perlin the billow is built from. */
  perlinOctaves: 4,
  perlinFrequency: 4,
};

/**
 * A hash from three integers to a number in [0, 1).
 *
 * The integers are already wrapped to the frequency's own grid before they arrive, which is what
 * makes every octave tile. Deterministic and self-contained on purpose: the volumes must come out
 * byte for byte the same on every machine, or one player's sky is not another's.
 */
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

const wrap = (v, n) => ((v % n) + n) % n;

/**
 * Worley noise: the distance to the nearest scattered point, in [0, 1], tiling over `freq` cells.
 *
 * One feature point per cell and the twenty-seven cells around the sample, which is the standard
 * arrangement: with one point per cell the nearest can never be further than a cell away, so the
 * neighbourhood is enough and a wider search buys nothing.
 */
export function worley(x, y, z, freq) {
  const fx = x * freq;
  const fy = y * freq;
  const fz = z * freq;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  let best = 1e9;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const cy = iy + dy;
        const cz = iz + dz;
        // Wrapped for the hash, unwrapped for the distance, which is what makes it tile.
        const h = wrap(cx, freq);
        const k = wrap(cy, freq);
        const l = wrap(cz, freq);
        const px = cx + hash3(h, k, l);
        const py = cy + hash3(h + 131, k + 71, l + 19);
        const pz = cz + hash3(h + 17, k + 251, l + 401);
        const ex = px - fx;
        const ey = py - fy;
        const ez = pz - fz;
        const d = ex * ex + ey * ey + ez * ez;
        if (d < best) best = d;
      }
    }
  }
  // Inverted, so a blob is high and the gaps are low: a cloud, rather than its cell walls.
  return 1 - Math.min(1, Math.sqrt(best));
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** A gradient from a hashed cell, one of twelve, as gradient noise has always used. */
function grad(h, k, l, x, y, z) {
  const g = Math.floor(hash3(h * 3 + 7, k * 5 + 11, l * 7 + 13) * 12) % 12;
  switch (g) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x + z;
    case 5: return -x + z;
    case 6: return x - z;
    case 7: return -x - z;
    case 8: return y + z;
    case 9: return -y + z;
    case 10: return y - z;
    default: return -y - z;
  }
}

/** Tiling gradient noise in [0, 1], over `freq` cells. */
export function perlin(x, y, z, freq) {
  const fx = x * freq;
  const fy = y * freq;
  const fz = z * freq;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  const tx = fade(fx - ix);
  const ty = fade(fy - iy);
  const tz = fade(fz - iz);
  const at = (dx, dy, dz) => grad(wrap(ix + dx, freq), wrap(iy + dy, freq), wrap(iz + dz, freq), fx - ix - dx, fy - iy - dy, fz - iz - dz);
  const x00 = lerp(at(0, 0, 0), at(1, 0, 0), tx);
  const x10 = lerp(at(0, 1, 0), at(1, 1, 0), tx);
  const x01 = lerp(at(0, 0, 1), at(1, 0, 1), tx);
  const x11 = lerp(at(0, 1, 1), at(1, 1, 1), tx);
  const y0 = lerp(x00, x10, ty);
  const y1 = lerp(x01, x11, ty);
  return Math.min(1, Math.max(0, lerp(y0, y1, tz) * 0.5 + 0.5));
}

/** Several octaves of it, each at twice the frequency and half the weight. */
export function perlinFbm(x, y, z, freq, octaves) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = freq;
  for (let o = 0; o < octaves; o++) {
    sum += perlin(x, y, z, f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** Several octaves of Worley, likewise, which is what an erosion channel is. */
export function worleyFbm(x, y, z, freq) {
  return worley(x, y, z, freq) * 0.625 + worley(x, y, z, freq * 2) * 0.25 + worley(x, y, z, freq * 4) * 0.125;
}

/**
 * Take a value out of one range and into another, clamped. The technique's own `remap`, and the one
 * place the billow is made: Perlin remapped so that its low end starts where Worley's does gives a
 * field that billows like Worley and connects like Perlin.
 */
export function remap(v, fromLo, fromHi, toLo, toHi) {
  const t = (v - fromLo) / (fromHi - fromLo || 1);
  return toLo + Math.min(1, Math.max(0, t)) * (toHi - toLo);
}

const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

/**
 * The base volume: the billow in red, three rising frequencies of Worley after it.
 *
 * `onRow` is called with each z slice as it finishes, so a command can say how far along it is: at
 * two million voxels and four channels this is tens of seconds of arithmetic and silence would read
 * as a hang.
 */
export function buildBase(size = CLOUD_NOISE.baseSize, tune = CLOUD_NOISE, onSlice = () => {}) {
  const out = new Uint8Array(size * size * size * 4);
  const [f0, f1, f2, f3] = tune.baseFrequencies;
  for (let z = 0; z < size; z++) {
    const w = z / size;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const p = perlinFbm(u, v, w, tune.perlinFrequency, tune.perlinOctaves);
        const wo = worleyFbm(u, v, w, f0);
        // The billow: Perlin brought into Worley's range, which is what gives a cloud both its
        // round shape and its connected structure.
        const billow = remap(p, 0, 1, wo, 1);
        const i = ((z * size + y) * size + x) * 4;
        out[i] = byte(billow);
        out[i + 1] = byte(worleyFbm(u, v, w, f1));
        out[i + 2] = byte(worleyFbm(u, v, w, f2));
        out[i + 3] = byte(worleyFbm(u, v, w, f3));
      }
    }
    onSlice(z + 1, size);
  }
  return out;
}

/**
 * Where the billow channel actually lies, as two quantiles of the volume just built.
 *
 * **This is the calibration, and it cannot be a constant.** Coverage is a share of sky, and the
 * march turns it into a threshold on the billow; but the billow does not fill [0, 1]. Measured over
 * the real volume it sits between about 0.55 and 0.89, so thresholding at `1 - coverage` is a
 * cliff: a quarter covered gives 57% of the sky, a third gives 88%, and everything past that
 * saturates. Threshold between these two instead and the answer is very nearly linear -- a quarter
 * gives 18%, a third 29%, the storm world 93%.
 *
 * Measured off the bytes rather than off a sample of the generator, and written into the pack, so
 * that changing anything about the noise re-calibrates the march with it instead of quietly
 * breaking the one number nobody would think to check.
 */
export function billowRange(base, size, loQ = 0.02, hiQ = 0.995) {
  const n = size * size * size;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[base[i * 4]]++;
  const at = (q) => {
    let want = q * n;
    for (let v = 0; v < 256; v++) {
      want -= hist[v];
      if (want <= 0) return v / 255;
    }
    return 1;
  };
  return { lo: Math.round(at(loQ) * 1000) / 1000, hi: Math.round(at(hiQ) * 1000) / 1000 };
}

/** The detail volume: three frequencies of Worley, which eat the last few metres of an edge. */
export function buildDetail(size = CLOUD_NOISE.detailSize, tune = CLOUD_NOISE, onSlice = () => {}) {
  const out = new Uint8Array(size * size * size * 4);
  const [f0, f1, f2] = tune.detailFrequencies;
  for (let z = 0; z < size; z++) {
    const w = z / size;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const i = ((z * size + y) * size + x) * 4;
        out[i] = byte(worleyFbm(u, v, w, f0));
        out[i + 1] = byte(worleyFbm(u, v, w, f1));
        out[i + 2] = byte(worleyFbm(u, v, w, f2));
        out[i + 3] = 255;
      }
    }
    onSlice(z + 1, size);
  }
  return out;
}

/**
 * How much sky each threshold really fills, measured by marching the volumes just written.
 *
 * **Why this and not the billow's own ends.** `billowRange` says where the billow channel lies, and
 * a cut placed between its ends gives that share of the *channel* above the cut. Three things then
 * stand between that and the share of sky anybody sees. The base volume's own erosion channels take
 * a bite out of whatever survived the cut and the detail volume takes another, which together eat
 * most of a thin sky: measured, a world asking for a quarter of the sky was getting half a per cent
 * of the deck and nothing at all overhead, and sixteen of the game's eighteen worlds ask for a
 * quarter or less. And in the other direction a ray crosses eight hundred metres of deck, so once
 * there *is* cloud the sky fills much faster than the volume does. Neither is arithmetic; both come
 * out of the volume. So the sweep marches a grid of rays straight up through the deck at a set of
 * cuts, writes down what share of them found cloud, and the game reads that table backwards.
 *
 * Straight up is the honest direction to measure in: it is the shortest way through the deck and so
 * the least cloud any ray will find, and it is the one direction whose answer does not depend on
 * where the camera happens to be standing.
 */
export function coverCurve(base, detail, baseSize, detailSize, march, rule, cuts = COVER_CUTS, rays = 64) {
  const b = [0, 0, 0, 0];
  const d = [0, 0, 0, 0];
  const steps = march.steps;
  const span = march.top - march.bottom;
  const stepLen = span / steps;
  const out = [];
  for (const cut of cuts) {
    let covered = 0;
    for (let ry = 0; ry < rays; ry++) {
      for (let rx = 0; rx < rays; rx++) {
        // Spread over a good few kilometres of ground, which is several periods of the base volume.
        const px = (rx / rays) * march.baseScale * 3;
        const pz = (ry / rays) * march.baseScale * 3;
        let od = 0;
        for (let i = 0; i < steps; i++) {
          const py = march.bottom + (i + 0.5) * stepLen;
          const h = (py - march.bottom) / span;
          rule.volumeTexel(base, baseSize, Math.round((px / march.baseScale) * baseSize), Math.round((py / march.baseScale) * baseSize), Math.round((pz / march.baseScale) * baseSize), b);
          rule.volumeTexel(detail, detailSize, Math.round((px / march.detailScale) * detailSize), Math.round((py / march.detailScale) * detailSize), Math.round((pz / march.detailScale) * detailSize), d);
          od += rule.densityFrom(b, d, h, cut, 2, march) * march.density * stepLen;
        }
        // Half the light stopped is the line between a covered sky and a hazy one.
        if (1 - Math.exp(-od) >= 0.5) covered++;
      }
    }
    out.push({ cut: Math.round(cut * 1000) / 1000, sky: Math.round((covered / (rays * rays)) * 1000) / 1000 });
  }
  return out;
}

/** The thresholds the sweep measures at: fine where the sky is changing fastest. */
export const COVER_CUTS = [0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
