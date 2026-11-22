// The galaxy's one density function (the GPU port's pass 2, wave 3; the design's 2.7 and 3): how many stars and how much dust
// stand at a point of the galaxy map's own frame, read by the map's disc of points (`src/ui/galaxyView.ts`, which draws its
// points out of it) and by the Milky Way baked into each system's night sky (`nightGpu.ts`, which integrates it along every
// direction from the system's place). One function, written once over a small set of operations (`DensityOps`): handed
// numbers it answers numbers (the map, the stars' catalogue, the node test), handed three's shading language it builds the
// bake's graph. So the band in the sky is the disc on the map, and retuning the disc (`GALAXY_TUNE`'s radius, arms and
// thickness, `__debug.galaxy`) moves both.
//
// The frame is the map's: x runs east across the grid, z south down it, y out of the galactic plane (`systemPlace`), one
// unit a map unit. Every number of the shape is ours (the archives hold a picture of the galaxy and nothing that says how its
// stars stand), in `MILKY_SHAPE` with its reason, live through `__debug.stars({ shape })`.
//
// Pure: no three, no DOM; the node test imports it.

import { GALAXY_TUNE } from '../../data/galaxy.ts';

/**
 * The shape's numbers past `GALAXY_TUNE`'s radius, arms and thickness, each a start of ours:
 *   - `wind` 3.1: how many radians an arm turns from the middle to the rim, the map's own spiral (`t * 3.1` before);
 *   - `discScale` 0.5: the disc's exponential length as a share of the radius, so the rim keeps a sixth of the middle's
 *     stars, as the map's old draw (`t = u^0.65`) left it;
 *   - `armShare` 0.6 and `armSharp` 2: how much of the disc's light the arms gather and how narrow they are (a phase's
 *     `((1 + cos) / 2)^2`: about 0.3 radian either side at four arms, the old draw's scatter);
 *   - `coreShare` 0.8, `coreSize` 0.1, `coreFlat` 1.6: the bulge's peak over the disc's middle, its size as a share of the
 *     radius and how much flatter than round it is, which keeps it near a third of the disc's stars, the way a barred
 *     spiral's bulge stands;
 *   - `clumpShare` 0.45 and `clumpSize` 0.035: the star clouds, a value noise over cells of about 66 units that moves the
 *     disc's density by up to that share, so the band is patchy rather than a smooth stripe;
 *   - `dustShare` 0.012 and `dustThin` 0.45: the dust's opacity a unit at the disc's middle (a path of 500 units through
 *     the plane at Tatooine's radius is about three optical depths, the dark rift down the band's middle) and its layer's
 *     height over the stars'.
 */
export const MILKY_SHAPE = {
  wind: 3.1,
  discScale: 0.5,
  armShare: 0.6,
  armSharp: 2,
  coreShare: 0.8,
  coreSize: 0.1,
  coreFlat: 1.6,
  clumpShare: 0.45,
  clumpSize: 0.035,
  dustShare: 0.012,
  dustThin: 0.45,
};

/** The ranges `tuneShape` holds each number of the shape to. */
export const MILKY_SHAPE_RANGE: Readonly<Record<keyof typeof MILKY_SHAPE, readonly [number, number]>> = {
  wind: [0, 8],
  discScale: [0.1, 2],
  armShare: [0, 1],
  armSharp: [0.5, 8],
  coreShare: [0, 4],
  coreSize: [0.02, 0.4],
  coreFlat: [1, 4],
  clumpShare: [0, 0.9],
  clumpSize: [0.01, 0.2],
  dustShare: [0, 0.05],
  dustThin: [0.1, 1],
};

/** A count the shape's moves are told by, so a baked band knows it is out of date without comparing every number. */
export const MILKY_STATE = { version: 0 };

/** Move the shape's numbers (`__debug.stars({ shape })`), each held to its range; words for anything held or refused. */
export function tuneShape(o: Record<string, unknown>): string[] {
  const said: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    const r = (MILKY_SHAPE_RANGE as Record<string, readonly [number, number]>)[k];
    if (!r) {
      said.push(`shape.${k}: no such number`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      said.push(`shape.${k}: not a number`);
      continue;
    }
    const held = v < r[0] ? r[0] : v > r[1] ? r[1] : v;
    if (held !== v) said.push(`shape.${k}: held to ${held}`);
    (MILKY_SHAPE as Record<string, number>)[k] = held;
  }
  MILKY_STATE.version++;
  return said;
}

/**
 * The operations the density is written over: numbers (`NUM_OPS`) or three's shading language (`nightGpu.ts`). `hash2`
 * answers a cell's own number in [0, 1) from two whole numbers, by integer arithmetic both ways round, so the map, the
 * catalogue and the card draw the same star clouds.
 */
export interface DensityOps<N> {
  k(v: number): N;
  add(a: N, b: N): N;
  sub(a: N, b: N): N;
  mul(a: N, b: N): N;
  div(a: N, b: N): N;
  exp(a: N): N;
  cos(a: N): N;
  sqrt(a: N): N;
  min(a: N, b: N): N;
  max(a: N, b: N): N;
  pow(a: N, b: N): N;
  atan2(y: N, x: N): N;
  floor(a: N): N;
  smoothstep(e0: N, e1: N, x: N): N;
  mix(a: N, b: N, t: N): N;
  hash2(ix: N, iz: N): N;
}

/** The shape's numbers as the density reads them, whatever they are (numbers, or a graph's uniforms). */
export interface DensityParams<N> {
  /** `GALAXY_TUNE`'s disc: radius, arms and thickness. */
  radius: N;
  arms: N;
  thick: N;
  wind: N;
  discScale: N;
  armShare: N;
  armSharp: N;
  /** One over the mean of an arm's profile over its phase (`armNorm`), so the arms move the disc's light and keep its sum. */
  armNorm: N;
  coreShare: N;
  coreSize: N;
  coreFlat: N;
  clumpShare: N;
  clumpSize: N;
  dustShare: N;
  dustThin: N;
}

/** What the density answers at a point: the stars' light, the share of it that is warm (old) light, and the dust's opacity. */
export interface DensityOut<N> {
  emit: N;
  warm: N;
  dust: N;
}

/** The 32-bit PCG step (Jarzynski and Olano, JCGT 2020), an unsigned whole number in and out. */
export function pcgNumber(u: number): number {
  const v = (Math.imul(u >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((v >>> ((v >>> 28) + 4)) ^ v) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

/** A cell's hash in [0, 1), the PCG step twice over the two whole numbers (their bits, as the card's `u32` takes them). */
export function hash2Number(ix: number, iz: number): number {
  return pcgNumber(((ix | 0) + pcgNumber(iz | 0)) >>> 0) / 4294967296;
}

/** The operations over plain numbers. */
export const NUM_OPS: DensityOps<number> = {
  k: (v) => v,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  exp: Math.exp,
  cos: Math.cos,
  sqrt: Math.sqrt,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  atan2: Math.atan2,
  floor: Math.floor,
  smoothstep: (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  },
  mix: (a, b, t) => a + (b - a) * t,
  hash2: hash2Number,
};

/** Counted by the density at each build or call, so the node test can see both paths go through it. */
export const DENSITY_CALLS = { numbers: 0, graph: 0 };

/**
 * The density at a point (x, y, z) of the map's frame, into `out`: the disc (an exponential in the radius, tapered past
 * 0.85 of it, a Gaussian layer as thick as the map's disc and thinning toward the rim, the arms' phase gathering its light,
 * the star clouds moving it), the bulge (a flattened Gaussian about the middle) and the dust (the disc's own shape in a
 * thinner layer, along the arms). The one function the map's disc, the stars and the band read.
 */
export function densityOf<N>(o: DensityOps<N>, x: N, y: N, z: N, p: DensityParams<N>, out: DensityOut<N>): DensityOut<N> {
  if (o === (NUM_OPS as unknown)) DENSITY_CALLS.numbers++;
  else DENSITY_CALLS.graph++;
  const one = o.k(1);
  const r = o.sqrt(o.add(o.mul(x, x), o.mul(z, z)));
  const t = o.div(r, p.radius);
  const tc = o.min(t, one);
  // The disc: exponential in the radius, its rim tapered.
  const edge = o.sub(one, o.smoothstep(o.k(0.85), o.k(1.1), t));
  const disc = o.mul(o.exp(o.div(o.sub(o.k(0), t), p.discScale)), edge);
  // Its layer: as thick as the map's disc (the map drew a slab of `thick · (1.2 − t)`, whose spread is 0.29 of that).
  const h = o.mul(o.mul(p.thick, o.sub(o.k(1.2), tc)), o.k(0.29));
  const yh = o.div(y, h);
  const vert = o.exp(o.mul(o.k(-0.5), o.mul(yh, yh)));
  // The arms: a phase about each arm's own spiral (an arm at angle k · 2π / arms + wind · t, the map's draw).
  const theta = o.atan2(z, x);
  const phase = o.mul(p.arms, o.sub(theta, o.mul(p.wind, t)));
  const arm = o.pow(o.mul(o.add(one, o.cos(phase)), o.k(0.5)), p.armSharp);
  const arms = o.add(o.sub(one, p.armShare), o.mul(o.mul(p.armShare, arm), p.armNorm));
  // The star clouds: a value noise in the plane, the cell's hash smoothed between its four corners.
  const cell = o.mul(p.clumpSize, p.radius);
  const cx = o.div(x, cell);
  const cz = o.div(z, cell);
  const ix = o.floor(cx);
  const iz = o.floor(cz);
  const fx = o.sub(cx, ix);
  const fz = o.sub(cz, iz);
  const sx = o.mul(o.mul(fx, fx), o.sub(o.k(3), o.mul(o.k(2), fx)));
  const sz = o.mul(o.mul(fz, fz), o.sub(o.k(3), o.mul(o.k(2), fz)));
  const h00 = o.hash2(ix, iz);
  const h10 = o.hash2(o.add(ix, one), iz);
  const h01 = o.hash2(ix, o.add(iz, one));
  const h11 = o.hash2(o.add(ix, one), o.add(iz, one));
  const noise = o.mix(o.mix(h00, h10, sx), o.mix(h01, h11, sx), sz);
  const clump = o.add(one, o.mul(p.clumpShare, o.sub(o.mul(noise, o.k(2)), one)));
  const plane = o.mul(o.mul(disc, arms), clump);
  // The bulge: a flattened Gaussian about the middle.
  const cs = o.mul(p.coreSize, p.radius);
  const yf = o.mul(y, p.coreFlat);
  const q = o.div(o.add(o.mul(r, r), o.mul(yf, yf)), o.mul(cs, cs));
  const bulge = o.mul(p.coreShare, o.exp(o.mul(o.k(-0.5), q)));
  out.emit = o.add(o.mul(plane, vert), bulge);
  // The warm share: the bulge's old light whole, the disc's between the arms half, the arms' young light none.
  out.warm = o.add(bulge, o.mul(o.mul(o.mul(disc, clump), vert), o.mul(o.sub(one, p.armShare), o.k(0.5))));
  // The dust: the disc's own shape along the arms, in a thinner layer.
  const yd = o.div(yh, p.dustThin);
  out.dust = o.mul(o.mul(p.dustShare, plane), o.exp(o.mul(o.k(-0.5), o.mul(yd, yd))));
  return out;
}

/** The mean over a phase of an arm's profile `((1 + cos) / 2)^sharp`, worked numerically once a shape (1 / it is `armNorm`). */
export function armMean(sharp: number): number {
  const n = 720;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.pow((1 + Math.cos(((i + 0.5) / n) * Math.PI * 2)) * 0.5, sharp);
  return s / n;
}

/** The shape's numbers as plain numbers, read from `GALAXY_TUNE` and `MILKY_SHAPE` as they stand, into `out`. */
export function numberParams(out?: DensityParams<number>): DensityParams<number> {
  const g = GALAXY_TUNE;
  const s = MILKY_SHAPE;
  const p = out ?? ({} as DensityParams<number>);
  p.radius = Math.max(1, g.discRadius);
  p.arms = Math.max(1, Math.round(g.discArms));
  p.thick = Math.max(1, g.discThickness);
  p.wind = s.wind;
  p.discScale = s.discScale;
  p.armShare = s.armShare;
  p.armSharp = s.armSharp;
  p.armNorm = 1 / armMean(s.armSharp);
  p.coreShare = s.coreShare;
  p.coreSize = s.coreSize;
  p.coreFlat = s.coreFlat;
  p.clumpShare = s.clumpShare;
  p.clumpSize = s.clumpSize;
  p.dustShare = s.dustShare;
  p.dustThin = s.dustThin;
  return p;
}

/** The density at a point in numbers (the map's, the catalogue's and the tests'): a fresh record unless one is handed in. */
export function densityAt(x: number, y: number, z: number, p: DensityParams<number> = numberParams(), out?: DensityOut<number>): DensityOut<number> {
  return densityOf(NUM_OPS, x, y, z, p, out ?? { emit: 0, warm: 0, dust: 0 });
}

// ---------------------------------------------------------------- the map's disc, drawn out of the density

/** A small seeded generator (the map's own, `galaxyView.ts`'s before): a fraction in [0, 1). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A standard normal number from two fractions (Box and Muller). */
function normal(rnd: () => number): number {
  const u = Math.max(1e-12, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/** What the disc's draw hands back: places (x, y, z a point) and the share of the radius each stands at. */
export interface DiscPoints {
  pos: Float32Array;
  t: Float32Array;
  /** How many of each kind were drawn, and how many tries the plane's draw took. */
  disc: number;
  bulge: number;
  tries: number;
}

/**
 * `n` points drawn out of the density (the map's disc): each from the bulge or the disc by their shares of the whole, the
 * bulge's as its Gaussian is, the disc's place in the plane by rejection against the plane's own column (the disc, the
 * arms and the clouds times the layer's thickness) and its height from the layer's Gaussian there. So the points stand
 * where `densityOf` says the stars stand, which the node test holds by counting them in cells against the function.
 */
export function sampleDisc(n: number, seed = 20030626, p: DensityParams<number> = numberParams()): DiscPoints {
  const rnd = seeded(seed);
  const pos = new Float32Array(n * 3);
  const tt = new Float32Array(n);
  const shares = componentShares(p);
  const plane = planeParams(p);
  const R = p.radius;
  const reach = 1.1 * R;
  // The plane's column's largest value, from a scan (a little over, so the rejection never clips a peak).
  let most = 0;
  const scan = 96;
  for (let i = 0; i < scan; i++) {
    for (let j = 0; j < scan; j++) {
      const x = ((i + 0.5) / scan) * 2 * reach - reach;
      const z = ((j + 0.5) / scan) * 2 * reach - reach;
      const c = planeColumn(x, z, plane);
      if (c > most) most = c;
    }
  }
  most *= 1.15;
  let disc = 0;
  let bulge = 0;
  let tries = 0;
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    if (rnd() < shares.bulge) {
      const cs = p.coreSize * R;
      x = normal(rnd) * cs;
      z = normal(rnd) * cs;
      y = (normal(rnd) * cs) / p.coreFlat;
      bulge++;
    } else {
      for (;;) {
        tries++;
        x = (rnd() * 2 - 1) * reach;
        z = (rnd() * 2 - 1) * reach;
        if (rnd() * most <= planeColumn(x, z, plane)) break;
      }
      const t = Math.min(1, Math.sqrt(x * x + z * z) / R);
      y = normal(rnd) * p.thick * (1.2 - t) * 0.29;
      disc++;
    }
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    tt[i] = Math.sqrt(x * x + z * z) / R;
  }
  return { pos, t: tt, disc, bulge, tries };
}

/** The shape's numbers with the bulge left out: what the plane's column reads. */
export function planeParams(p: DensityParams<number>): DensityParams<number> {
  return { ...p, coreShare: 0 };
}

/** Kept for `planeColumn`, which the draws call some hundred thousand times. */
const COLUMN_OUT: DensityOut<number> = { emit: 0, warm: 0, dust: 0 };

/**
 * The plane's column at (x, z): the disc's light summed through its layer (its value in the plane times the layer's
 * √(2π) h). `plane` is the shape with the bulge left out (`planeParams`): the density at y nought gives the plane's value,
 * and the column is that times the layer.
 */
export function planeColumn(x: number, z: number, plane: DensityParams<number>): number {
  densityOf(NUM_OPS, x, 0, z, plane, COLUMN_OUT);
  const t = Math.min(1, Math.sqrt(x * x + z * z) / plane.radius);
  return COLUMN_OUT.emit * plane.thick * (1.2 - t) * 0.29 * Math.sqrt(2 * Math.PI);
}

/** The bulge's and the disc's shares of all the stars (the bulge's Gaussian's sum against the plane's columns summed). */
export function componentShares(p: DensityParams<number>): { bulge: number; disc: number } {
  const cs = p.coreSize * p.radius;
  const bulgeSum = p.coreShare * Math.pow(2 * Math.PI, 1.5) * cs * cs * (cs / p.coreFlat);
  const plane = planeParams(p);
  const reach = 1.1 * p.radius;
  const n = 160;
  const cell = (2 * reach) / n;
  let discSum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) discSum += planeColumn(-reach + (i + 0.5) * cell, -reach + (j + 0.5) * cell, plane) * cell * cell;
  }
  const all = bulgeSum + discSum;
  return { bulge: all > 0 ? bulgeSum / all : 0, disc: all > 0 ? discSum / all : 1 };
}

// ---------------------------------------------------------------- the band: the density along a ray

/**
 * The band's quadrature, the one the card's bake runs (`nightGpu.ts`) and the numbers' twin below: `steps` steps out to
 * `reach` times the disc's radius, laid by the square of their place (`s = reach · R · u²`, each sampled at its middle),
 * so the layer near the eye, which a ray out of the plane crosses within a few tens of units, has most of them.
 */
export const BAND_RAY = { steps: 128, reach: 2.4 };

/** What one ray of the band sums: its light (in the density's own units times units of length) and its warm share. */
export interface BandSum {
  light: number;
  warm: number;
}

/**
 * The band's light along one direction (dx, dy, dz, unit) from a place (px, py, pz), in numbers: the density's light summed
 * along the ray, each step's dimmed by the dust in front of it (the opacity summed to the step's middle), and the warm share
 * of it. The card's bake is this loop in three's shading language over the same `densityOf`.
 */
export function bandRay(px: number, py: number, pz: number, dx: number, dy: number, dz: number, p: DensityParams<number> = numberParams(), out: BandSum = { light: 0, warm: 0 }): BandSum {
  const n = BAND_RAY.steps;
  const S = BAND_RAY.reach * p.radius;
  const d: DensityOut<number> = { emit: 0, warm: 0, dust: 0 };
  let tau = 0;
  let light = 0;
  let warm = 0;
  for (let i = 0; i < n; i++) {
    const u0 = i / n;
    const u1 = (i + 1) / n;
    const um = (u0 + u1) * 0.5;
    const ds = S * (u1 * u1 - u0 * u0);
    const sm = S * um * um;
    densityOf(NUM_OPS, px + dx * sm, py + dy * sm, pz + dz * sm, p, d);
    const T = Math.exp(-(tau + d.dust * ds * 0.5));
    light += d.emit * T * ds;
    warm += d.warm * T * ds;
    tau += d.dust * ds;
  }
  out.light = light;
  out.warm = light > 0 ? warm / light : 0;
  return out;
}

// ---------------------------------------------------------------- the band's picture: its mapping, and its units

/** The band's picture: 2048 by 1024 texels of two half floats (light and warm share), 8 MB, longitude across, latitude down. */
export const BAND_SIZE = { width: 2048, height: 1024 } as const;

/**
 * The direction (unit, the map's frame) a texel centre of the band's picture stands for, into `out` [x, y, z]: `u` across
 * is the longitude from −π (u 0) round to π, `v` down is the latitude from the galactic north (v 0, the picture's first
 * row, which a WebGPU target keeps at the top) to the south.
 */
export function bandDirOf(u: number, v: number, out: Float64Array | number[]): void {
  const lon = (u - 0.5) * 2 * Math.PI;
  const lat = (0.5 - v) * Math.PI;
  const c = Math.cos(lat);
  out[0] = c * Math.cos(lon);
  out[1] = Math.sin(lat);
  out[2] = c * Math.sin(lon);
}

/** The band picture's coordinates of a unit direction (`bandDirOf`'s inverse), into `out` [u, v]. */
export function bandUvOf(x: number, y: number, z: number, out: Float64Array | number[]): void {
  out[0] = Math.atan2(z, x) / (2 * Math.PI) + 0.5;
  out[1] = 0.5 - Math.asin(y > 1 ? 1 : y < -1 ? -1 : y) / Math.PI;
}

/**
 * The band's light units. Its brightest stretch, toward the middle from a place `BAND_REFERENCE.r` units out (Tatooine's
 * radius, near enough), is `BAND_REFERENCE.peakMag` magnitudes a square arcsecond: 20.0, the Milky Way's star clouds toward
 * Sagittarius under a dark sky. A place nearer the middle sees a brighter band and one further out a fainter, as physics
 * gives them; `NIGHT_TUNE.milkyWay` scales it all (the owner's dial, 1 the physical brightness).
 */
export const BAND_REFERENCE = { r: 500, peakMag: 20.0 };

/** A luminance in candelas a square metre at a surface brightness of `mag` magnitudes a square arcsecond (V). */
export function cdOfMag(mag: number): number {
  return 10.8e4 * Math.pow(10, -0.4 * mag);
}

/**
 * The sun's illuminance at the top of the air, lux: what the air's units stand for (`AIR_UNITS.scene` is the top-of-air sun's
 * light in the scene's units), so a luminance in candelas is `AIR_UNITS.scene / SUN_LUX` of the scene's units.
 */
export const SUN_LUX = 128000;

/** The density's sum along the reference ray, for the band's units (`bandUnit`). */
export function referenceSum(p: DensityParams<number> = numberParams()): number {
  return bandRay(BAND_REFERENCE.r, 0, 0, -1, 0, 0, p).light;
}

/** The band's units: what one of the density's sums is in the scene's radiance, for the scene's units `sceneUnits`. */
export function bandUnit(sceneUnits: number, p: DensityParams<number> = numberParams()): number {
  const ref = referenceSum(p);
  return ref > 0 ? (cdOfMag(BAND_REFERENCE.peakMag) * sceneUnits) / SUN_LUX / ref : 0;
}
