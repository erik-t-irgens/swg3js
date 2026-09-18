// The runtime noise every heat source samples, and the lava without its converted volume. No imports,
// so a plain node test reads this file as the game does.
//
// The client's heat and lava sampled `texture/noise_volume_lava.dds`: 128³ bytes of smooth, tileable
// noise with mean 0.49 and spread 0.077, whose autocorrelation falls to 0.94, 0.79, 0.46 and about 0.05
// at 1/32, 1/16, 1/8 and 1/4 of its period. That is statistics, not a picture, so a 32³ volume made
// here to the same numbers stands in for it everywhere, with no reconversion and in space as well.

/** Texels per side of the runtime noise volume. */
export const HEAT_NOISE_SIZE = 32;

/** The client's noise volume's mean and spread, as bytes over 255. */
const NOISE_MEAN = 0.49;
const NOISE_SPREAD = 0.077;
/** Lattice cells per side and weight of each octave: six cells, and twelve at 0.3 of the weight. */
const OCTAVES: readonly (readonly [number, number])[] = [
  [6, 1],
  [12, 0.3],
];

/** A seeded 32-bit generator (mulberry32): the same seed gives the same numbers in 0..1 on every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tileable value noise, 6 cells per side plus 12 at 0.3 of the weight, smoothstep-interpolated and wrapped
 * (the lattice wraps, so the last texel steps into the first exactly as any two neighbours do), rescaled to
 * the client's volume's statistics (mean 0.49, spread 0.077) and clamped to bytes. x fastest, then y, then z,
 * the order WebGL's texImage3D takes.
 */
export function heatNoiseData(size = HEAT_NOISE_SIZE, seed = 7): Uint8Array {
  const rand = mulberry32(seed);
  const n = size * size * size;
  const field = new Float32Array(n);
  for (const [cells, amp] of OCTAVES) {
    const lattice = new Float32Array(cells * cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand() * 2 - 1;
    const at = (x: number, y: number, z: number) => lattice[((z % cells) * cells + (y % cells)) * cells + (x % cells)];
    const step = cells / size;
    for (let z = 0; z < size; z++) {
      const fz = z * step;
      const z0 = Math.floor(fz);
      const tz = fz - z0;
      const sz = tz * tz * (3 - 2 * tz);
      for (let y = 0; y < size; y++) {
        const fy = y * step;
        const y0 = Math.floor(fy);
        const ty = fy - y0;
        const sy = ty * ty * (3 - 2 * ty);
        for (let x = 0; x < size; x++) {
          const fx = x * step;
          const x0 = Math.floor(fx);
          const tx = fx - x0;
          const sx = tx * tx * (3 - 2 * tx);
          const x1 = x0 + 1;
          const y1 = y0 + 1;
          const z1 = z0 + 1;
          const a = at(x0, y0, z0) + (at(x1, y0, z0) - at(x0, y0, z0)) * sx;
          const b = at(x0, y1, z0) + (at(x1, y1, z0) - at(x0, y1, z0)) * sx;
          const c = at(x0, y0, z1) + (at(x1, y0, z1) - at(x0, y0, z1)) * sx;
          const d = at(x0, y1, z1) + (at(x1, y1, z1) - at(x0, y1, z1)) * sx;
          const ab = a + (b - a) * sy;
          const cd = c + (d - c) * sy;
          field[(z * size + y) * size + x] += (ab + (cd - ab) * sz) * amp;
        }
      }
    }
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += field[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (field[i] - mean) * (field[i] - mean);
  const spread = Math.sqrt(variance / n) || 1;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, Math.round((((field[i] - mean) / spread) * NOISE_SPREAD + NOISE_MEAN) * 255)));
  return out;
}
