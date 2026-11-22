// The air's twin on the main thread (the GPU port's pass 2, wave 1, the design's 2.1): the very sums the tables work on
// the card, done on kept arrays for what the main thread must know of the air -- the sun's light at the camera, the sky's
// light on the ground (the hemisphere), the ground's bounce, the second sun's (the fill), the colour at the horizon and a
// fog-equivalent for the rain and wet surfaces -- and written into `SwgSky.lighting`'s fields, so everything that read the
// ramps' lighting (rain, wetness, kick-up, the cloud feed, the grade) reads the air's on WebGPU. Nothing is allocated in a
// frame: every number is a field or an element of an array made once.
//
// The method is Hillaire's 2020 sky ("A Scalable and Production Ready Sky and Atmosphere Rendering Technique"), its
// transmittance by Bruneton's 2017 mapping, as the MIT ports the design names carry it (pmndrs/sky, Dennis Smolek;
// webgpu-sky-atmosphere, Lukas Herzberger: CREDITS.md). Written here from the method, in our record's units.
//
// Two small tables stand in for the card's two slow ones. **The column densities** (32 by 16, Bruneton's mapping): each
// texel the Rayleigh, Mie and ozone densities summed along its ray to the top of the air, one table a world, since every
// row of a world shares its heights; an optical depth is those three times the record's coefficients, so a row's, a
// blend's and a dial's transmittance are all exact from the one table. **The multiple-scattering share** (16 by 8), which
// is not linear in the coefficients: each weather row's is made by the fit's worker (`airFit.ts`), and a frame blends the
// mix's rows' by weight only when the weights move.
//
// Pure: nothing of the page or of three's WebGPU build, so the node tests run it as the game does.
import { F, LUMA_B, LUMA_G, LUMA_R, newAirRecord, setVisibility, worldRecord, type AirRecord } from './airParams.ts';
import { multiScatterUv, transmittanceUv } from './airApi.ts';

/**
 * The twin's column-density table: Bruneton's mapping at the card's own transmittance size, so the twin's transmittance
 * reads as the card's does (at 32 by 16 the light half a degree over the horizon read a fifth off the direct sum: the depth
 * there turns fastest with the angle). Made once a world (some 20 ms behind the loading screen); a frame only reads it.
 */
export const TWIN_DEPTH = { width: 256, height: 64 } as const;
/**
 * The twin's multiple-scattering table (the card's is 32 by 32): 32 across the sun's angle, where the share turns fastest
 * at twilight (16 across read the twilight sky 30% to twice the reference sum), 16 up.
 */
export const TWIN_PSI = { width: 32, height: 16 } as const;
/** Floats in each (three a texel). */
export const DEPTH_FLOATS = TWIN_DEPTH.width * TWIN_DEPTH.height * 3;
export const PSI_FLOATS = TWIN_PSI.width * TWIN_PSI.height * 3;

/** Steps of the sums (the card's tables take their own: `airTables.ts`). */
export const TWIN_STEPS = {
  /** Along a ray to the top of the air for its column densities. */
  depth: 40,
  /** Along each of the multiple-scattering sphere's rays. */
  psi: 16,
  /** The sphere's directions for the multiple scattering. */
  psiDirs: 32,
  /** Along a view ray for the sky's radiance. */
  view: 24,
  /** Along each ray of the hemisphere's quadrature. */
  hemi: 12,
} as const;

/** A nearly full moon sends back this share of the sun's illuminance (0.25 lux of some 110,000): SWG's moon until wave 5's phases. */
export const MOON_SHARE = 2.3e-6;

const PI = Math.PI;
const INV_4PI = 1 / (4 * PI);
const RAYLEIGH_K = 3 / (16 * PI);
const MIE_K = 3 / (8 * PI);

/**
 * The scene's light units as `world.ts` turns the lighting fields into lights (`applySwgLighting`): the sun's intensity
 * is `SWG_MAIN_LIGHT` times `mainScale`, the hemisphere's `SWG_AMBIENT` times the world's `AMBIENT_SCALE`, its ground half
 * the bounce mixed `bounceToSky` toward the sky's colour, the fill `SWG_FILL` times `fillScale`. Held to `world.ts`'s own
 * numbers by `airTwin.test.ts`, which reads them out of its text.
 */
export const AIR_LIGHT = { main: 2.4, ambient: 1.3 * 0.8, bounceToSky: 0.35, fill: 1.0 } as const;

// ---------------------------------------------------------------- the medium

/** Whether a ray from `r` km from the centre with zenith cosine `mu` meets the ground ahead. */
export function hitsGround(r: number, mu: number, bottom: number): boolean {
  return mu < 0 && r * r * (mu * mu - 1) + bottom * bottom >= 0;
}

/** Distance along a ray to where it leaves the air (to the top, or to the ground when it meets it). */
export function rayLength(r: number, mu: number, bottom: number, top: number): number {
  if (hitsGround(r, mu, bottom)) {
    const s = Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + bottom * bottom));
    const d = -r * mu - s;
    return d > 0 ? d : 0;
  }
  const disc = r * r * (mu * mu - 1) + top * top;
  const d = -r * mu + Math.sqrt(disc > 0 ? disc : 0);
  return d > 0 ? d : 0;
}

/** The medium at a height `h` km above the surface, into `m`: [rayleigh density, mie density, ozone density]. */
function densities(rec: AirRecord, h: number, m: Float64Array): void {
  const hh = h > 0 ? h : 0;
  m[0] = Math.exp(-hh / rec[F.rayH]);
  m[1] = Math.exp(-hh / rec[F.mieH]);
  const o = 1 - Math.abs(hh - rec[F.ozC]) / rec[F.ozW];
  m[2] = o > 0 ? o : 0;
}

/** Rayleigh's phase for the cosine `c` between the light's way and the view's. */
export function rayleighPhase(c: number): number {
  return RAYLEIGH_K * (1 + c * c);
}

/** Mie's, Cornette and Shanks' form of Henyey and Greenstein's, for a phase `g`. */
export function miePhase(c: number, g: number): number {
  const g2 = g * g;
  const den = 1 + g2 - 2 * g * c;
  return (MIE_K * (1 - g2) * (1 + c * c)) / ((2 + g2) * den * Math.sqrt(den));
}

// ---------------------------------------------------------------- the column densities

const mScratch = new Float64Array(3);
const uvScratch = new Float64Array(2);
const rmScratch = new Float64Array(2);
const dScratch = new Float64Array(3);

/**
 * The densities summed along a ray from `r` with zenith cosine `mu` to the top of the air, into `out` at `at` as
 * [Rayleigh, Mie, ozone] km: the transmittance table's sum before its coefficients. `steps` segments laid by the square of
 * their place (`t = len · u²`), each taken at its middle, so the first metres, where the haze's 1.2 km layer lies, have
 * most of them: forty even steps over a hundred kilometres first sample the haze at 1.25 km up and miss a sixth of it. A
 * ray into the ground is summed to the top through it, as Bruneton's table holds it; whoever reads it asks `hitsGround`.
 */
export function columnDepths(rec: AirRecord, r: number, mu: number, steps: number, out: Float64Array | Float32Array, at: number): void {
  const bottom = rec[F.bottom];
  const top = rec[F.top];
  const disc = r * r * (mu * mu - 1) + top * top;
  const len = Math.max(0, -r * mu + Math.sqrt(disc > 0 ? disc : 0));
  let tr = 0;
  let tm = 0;
  let to = 0;
  let prev = 0;
  for (let i = 0; i < steps; i++) {
    const u = (i + 1) / steps;
    const e = len * u * u;
    const dt = e - prev;
    const t = prev + 0.5 * dt;
    prev = e;
    const rr = Math.sqrt(t * t + 2 * r * mu * t + r * r);
    densities(rec, rr - bottom, mScratch);
    tr += mScratch[0] * dt;
    tm += mScratch[1] * dt;
    to += mScratch[2] * dt;
  }
  out[at] = tr;
  out[at + 1] = tm;
  out[at + 2] = to;
}

/** A record's optical depth (red, green, blue) from its three column densities `d` at `di`, into `out` at `at`. */
export function depthsToOptical(rec: AirRecord, d: Float64Array | Float32Array, di: number, out: Float64Array, at: number): void {
  const mieExt = rec[F.mieS] + rec[F.mieA];
  out[at] = rec[F.rayR] * d[di] + mieExt * d[di + 1] + rec[F.ozR] * d[di + 2];
  out[at + 1] = rec[F.rayG] * d[di] + mieExt * d[di + 1] + rec[F.ozG] * d[di + 2];
  out[at + 2] = rec[F.rayB] * d[di] + mieExt * d[di + 1] + rec[F.ozB] * d[di + 2];
}

/** The optical depth along a ray to the top of the air, summed directly (the reference the tables are held to). */
export function opticalDepth(rec: AirRecord, r: number, mu: number, steps: number, out: Float64Array, at: number): void {
  columnDepths(rec, r, mu, steps, dScratch, 0);
  depthsToOptical(rec, dScratch, 0, out, at);
}

/** The (r, mu) of the twin's column-density texel (i, j): the mapping's inverse at the twin's size (`airApi.ts`'s at the card's). */
function depthRMuAt(i: number, j: number, rec: AirRecord, out: Float64Array): void {
  const xMu = i / (TWIN_DEPTH.width - 1);
  const xR = j / (TWIN_DEPTH.height - 1);
  const bottom = rec[F.bottom];
  const top = rec[F.top];
  const H = Math.sqrt(top * top - bottom * bottom);
  const rho = H * xR;
  const r = Math.sqrt(rho * rho + bottom * bottom);
  const dMin = top - r;
  const dMax = rho + H;
  const d = dMin + xMu * (dMax - dMin);
  const mu = d === 0 ? 1 : (H * H - rho * rho - d * d) / (2 * r * d);
  out[0] = r;
  out[1] = mu < -1 ? -1 : mu > 1 ? 1 : mu;
}

/** A world's column-density table at the twin's size, into `out` (`DEPTH_FLOATS`): one a world, whatever its rows. */
export function buildDepthTable(rec: AirRecord, out: Float64Array | Float32Array, steps: number = TWIN_STEPS.depth): void {
  const W = TWIN_DEPTH.width;
  for (let j = 0; j < TWIN_DEPTH.height; j++) {
    for (let i = 0; i < W; i++) {
      depthRMuAt(i, j, rec, rmScratch);
      columnDepths(rec, rmScratch[0], rmScratch[1], steps, out, (j * W + i) * 3);
    }
  }
}

/**
 * A bilinear read of a three-channel table of `W` by `H` at texture coordinates (u, v) on texel centres, into `out` at
 * `at` (the card's linear filter, clamped to the edge).
 */
function bilinear(tab: Float64Array | Float32Array, W: number, H: number, u: number, v: number, out: Float64Array, at: number): void {
  let x = u * W - 0.5;
  let y = v * H - 0.5;
  x = x < 0 ? 0 : x > W - 1 ? W - 1 : x;
  y = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = x0 + 1 < W ? x0 + 1 : x0;
  const y1 = y0 + 1 < H ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const a = (y0 * W + x0) * 3;
  const b = (y0 * W + x1) * 3;
  const c = (y1 * W + x0) * 3;
  const d = (y1 * W + x1) * 3;
  for (let k = 0; k < 3; k++) {
    const top = tab[a + k] + (tab[b + k] - tab[a + k]) * fx;
    const bot = tab[c + k] + (tab[d + k] - tab[c + k]) * fx;
    out[at + k] = top + (bot - top) * fy;
  }
}

/**
 * The transmittance from a point `r` toward a light of zenith cosine `mu` (red, green, blue), from a column-density table,
 * into `out` at `at`: nought where the planet stands in the way.
 */
export function lightTransmittance(rec: AirRecord, depth: Float64Array | Float32Array, r: number, mu: number, out: Float64Array, at: number): void {
  if (hitsGround(r, mu, rec[F.bottom])) {
    out[at] = out[at + 1] = out[at + 2] = 0;
    return;
  }
  transmittanceUv(r, mu, rec[F.bottom], rec[F.top], uvScratch, TWIN_DEPTH.width, TWIN_DEPTH.height);
  bilinear(depth, TWIN_DEPTH.width, TWIN_DEPTH.height, uvScratch[0], uvScratch[1], dScratch, 0);
  depthsToOptical(rec, dScratch, 0, out, at);
  out[at] = Math.exp(-out[at]);
  out[at + 1] = Math.exp(-out[at + 1]);
  out[at + 2] = Math.exp(-out[at + 2]);
}

/** The multiple-scattering share at a point `r` with the light at zenith cosine `muS`, from a table, into `out` at `at`. */
export function psiAt(rec: AirRecord, psi: Float64Array | Float32Array, r: number, muS: number, out: Float64Array, at: number): void {
  multiScatterUv(r, muS, rec[F.bottom], rec[F.top], uvScratch, TWIN_PSI.width, TWIN_PSI.height);
  bilinear(psi, TWIN_PSI.width, TWIN_PSI.height, uvScratch[0], uvScratch[1], out, at);
}

// ---------------------------------------------------------------- the frame's own reads, by registers

/**
 * The registers the frame's sums hand their numbers through: a double handed to a call the compiler does not build in is
 * a number made (CLAUDE.md), so the twin's frame never hands one: [0] a point's distance from the centre and [1] the
 * zenith cosine of a light there, for the reads below; [2] and [3] a table's coordinates; [4] the view ray's origin and
 * [5..7] its direction, for `viewRadianceReg`. The public functions above take numbers, for the builders and the tests.
 */
const REG = new Float64Array(8);
const regDepth = new Float64Array(3);

/** `bilinear` reading its coordinates from `REG[2]`, `REG[3]`. */
function bilinearReg(tab: Float64Array | Float32Array, W: number, H: number, out: Float64Array, at: number): void {
  let x = REG[2] * W - 0.5;
  let y = REG[3] * H - 0.5;
  x = x < 0 ? 0 : x > W - 1 ? W - 1 : x;
  y = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = x0 + 1 < W ? x0 + 1 : x0;
  const y1 = y0 + 1 < H ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const a = (y0 * W + x0) * 3;
  const b = (y0 * W + x1) * 3;
  const c = (y1 * W + x0) * 3;
  const d = (y1 * W + x1) * 3;
  for (let k = 0; k < 3; k++) {
    const t0 = tab[a + k] + (tab[b + k] - tab[a + k]) * fx;
    const t1 = tab[c + k] + (tab[d + k] - tab[c + k]) * fx;
    out[at + k] = t0 + (t1 - t0) * fy;
  }
}

/** `lightTransmittance` with its point and light from `REG[0]`, `REG[1]` (the mapping written in, at the twin's size). */
function transmitReg(rec: AirRecord, depth: Float64Array | Float32Array, out: Float64Array, at: number): void {
  const r = REG[0];
  const mu = REG[1];
  const bottom = rec[F.bottom];
  const top = rec[F.top];
  if (mu < 0 && r * r * (mu * mu - 1) + bottom * bottom >= 0) {
    out[at] = out[at + 1] = out[at + 2] = 0;
    return;
  }
  const W = TWIN_DEPTH.width;
  const Hh = TWIN_DEPTH.height;
  const H = Math.sqrt(top * top - bottom * bottom);
  const rr = r > bottom ? (r < top ? r : top) : bottom;
  const rho2 = rr * rr - bottom * bottom;
  const rho = Math.sqrt(rho2 > 0 ? rho2 : 0);
  const disc = rr * rr * (mu * mu - 1) + top * top;
  let d = -rr * mu + Math.sqrt(disc > 0 ? disc : 0);
  d = d > 0 ? d : 0;
  const dMin = top - rr;
  const dMax = rho + H;
  let xMu = dMax > dMin ? (d - dMin) / (dMax - dMin) : 0;
  xMu = xMu < 0 ? 0 : xMu > 1 ? 1 : xMu;
  let xR = rho / H;
  xR = xR < 0 ? 0 : xR > 1 ? 1 : xR;
  REG[2] = 0.5 / W + xMu * (1 - 1 / W);
  REG[3] = 0.5 / Hh + xR * (1 - 1 / Hh);
  bilinearReg(depth, W, Hh, regDepth, 0);
  const mieExt = rec[F.mieS] + rec[F.mieA];
  out[at] = Math.exp(-(rec[F.rayR] * regDepth[0] + mieExt * regDepth[1] + rec[F.ozR] * regDepth[2]));
  out[at + 1] = Math.exp(-(rec[F.rayG] * regDepth[0] + mieExt * regDepth[1] + rec[F.ozG] * regDepth[2]));
  out[at + 2] = Math.exp(-(rec[F.rayB] * regDepth[0] + mieExt * regDepth[1] + rec[F.ozB] * regDepth[2]));
}

/** `psiAt` with its point and light from `REG[0]`, `REG[1]`. */
function psiReg(rec: AirRecord, psi: Float64Array | Float32Array, out: Float64Array, at: number): void {
  const bottom = rec[F.bottom];
  const W = TWIN_PSI.width;
  const H = TWIN_PSI.height;
  let x = 0.5 + 0.5 * REG[1];
  let y = (REG[0] - bottom) / (rec[F.top] - bottom);
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  y = y < 0 ? 0 : y > 1 ? 1 : y;
  REG[2] = 0.5 / W + x * (1 - 1 / W);
  REG[3] = 0.5 / H + y * (1 - 1 / H);
  bilinearReg(psi, W, H, out, at);
}

const ltR = new Float64Array(3);
const psR = new Float64Array(3);

/**
 * `viewRadiance` for the frame's sums: its origin and direction from `REG[4..7]`, to the ray's end (the top, or the
 * ground), every number kept in locals or registers and every phase written in.
 */
function viewRadianceReg(rec: AirRecord, depth: Float64Array | Float32Array, psi: Float64Array | Float32Array, lights: AirLights, steps: number, out: Float64Array, at: number): void {
  const r = REG[4];
  const dx = REG[5];
  const dy = REG[6];
  const dz = REG[7];
  const bottom = rec[F.bottom];
  const top = rec[F.top];
  let len: number;
  if (dy < 0 && r * r * (dy * dy - 1) + bottom * bottom >= 0) {
    const g2 = r * r * (dy * dy - 1) + bottom * bottom;
    len = -r * dy - Math.sqrt(g2 > 0 ? g2 : 0);
  } else {
    const t2 = r * r * (dy * dy - 1) + top * top;
    len = -r * dy + Math.sqrt(t2 > 0 ? t2 : 0);
  }
  len = len > 0 ? len : 0;
  const mieS = rec[F.mieS];
  const mieT = mieS + rec[F.mieA];
  // Pass 2, wave 4a: the haze's scattering by channel (its colour), its extinction (`mieT`) grey; at 1, 1, 1 each is `mieS` to the bit.
  const mS0 = mieS * rec[F.mieTintR];
  const mS1 = mieS * rec[F.mieTintG];
  const mS2 = mieS * rec[F.mieTintB];
  const g = rec[F.mieG];
  const g2 = g * g;
  const rayH = rec[F.rayH];
  const mieH = rec[F.mieH];
  const ozC = rec[F.ozC];
  const ozW = rec[F.ozW];
  let L0 = 0;
  let L1 = 0;
  let L2 = 0;
  let T0 = 1;
  let T1 = 1;
  let T2 = 1;
  let prev = 0;
  const n = lights.count;
  for (let i = 0; i < steps; i++) {
    const u = (i + 1) / steps;
    const e1 = len * u * u;
    const dt = e1 - prev;
    const t = prev + 0.5 * dt;
    prev = e1;
    const px = t * dx;
    const py = r + t * dy;
    const pz = t * dz;
    const rr = Math.sqrt(px * px + py * py + pz * pz);
    const hh = rr - bottom > 0 ? rr - bottom : 0;
    const dR = Math.exp(-hh / rayH);
    const dM = Math.exp(-hh / mieH);
    const oz = 1 - Math.abs(hh - ozC) / ozW;
    const dO = oz > 0 ? oz : 0;
    const sR0 = rec[F.rayR] * dR;
    const sR1 = rec[F.rayG] * dR;
    const sR2 = rec[F.rayB] * dR;
    const sM0 = mS0 * dM;
    const sM1 = mS1 * dM;
    const sM2 = mS2 * dM;
    const e0 = sR0 + mieT * dM + rec[F.ozR] * dO;
    const ec1 = sR1 + mieT * dM + rec[F.ozG] * dO;
    const e2 = sR2 + mieT * dM + rec[F.ozB] * dO;
    let S0 = 0;
    let S1 = 0;
    let S2 = 0;
    for (let k = 0; k < n; k++) {
      if (!lights.live[k]) continue;
      const lx = lights.dir[k * 3];
      const ly = lights.dir[k * 3 + 1];
      const lz = lights.dir[k * 3 + 2];
      const c = dx * lx + dy * ly + dz * lz;
      const pR = RAYLEIGH_K * (1 + c * c);
      const den = 1 + g2 - 2 * g * c;
      const pM = (MIE_K * (1 - g2) * (1 + c * c)) / ((2 + g2) * den * Math.sqrt(den));
      REG[0] = rr;
      REG[1] = (px * lx + py * ly + pz * lz) / rr;
      transmitReg(rec, depth, ltR, 0);
      psiReg(rec, psi, psR, 0);
      S0 += lights.top[k * 3] * (ltR[0] * (sR0 * pR + sM0 * pM) + psR[0] * (sR0 + sM0));
      S1 += lights.top[k * 3 + 1] * (ltR[1] * (sR1 * pR + sM1 * pM) + psR[1] * (sR1 + sM1));
      S2 += lights.top[k * 3 + 2] * (ltR[2] * (sR2 * pR + sM2 * pM) + psR[2] * (sR2 + sM2));
    }
    const st0 = Math.exp(-e0 * dt);
    const st1 = Math.exp(-ec1 * dt);
    const st2 = Math.exp(-e2 * dt);
    L0 += T0 * S0 * (e0 > 1e-12 ? (1 - st0) / e0 : dt);
    L1 += T1 * S1 * (ec1 > 1e-12 ? (1 - st1) / ec1 : dt);
    L2 += T2 * S2 * (e2 > 1e-12 ? (1 - st2) / e2 : dt);
    T0 *= st0;
    T1 *= st1;
    T2 *= st2;
  }
  out[at] = L0;
  out[at + 1] = L1;
  out[at + 2] = L2;
}

// ---------------------------------------------------------------- the multiple-scattering table

/**
 * `n` directions spread evenly over the sphere (a Fibonacci spiral), as x, y, z in `out`: the multiple scattering's rays.
 * The card's table lays its own count by the same spiral (`airTables.ts`).
 */
export function sphereDirections(n: number, out: Float64Array): void {
  const golden = PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const s = Math.sqrt(Math.max(0, 1 - y * y));
    const a = golden * i;
    out[i * 3] = Math.cos(a) * s;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.sin(a) * s;
  }
}

const t3 = new Float64Array(3);

/**
 * Hillaire's multiple-scattering share at a point `r` km from the centre with the light at zenith cosine `muS`, into `out`
 * at `at` (per unit of the light's illuminance, the isotropic phase at the point included): the second order of light
 * the sphere of rays round the point gathers (each scattered once toward it, isotropically, with the ground's bounce at a
 * ray's end), over one less the share `f_ms` the medium hands on at each further order, `L2 / (1 - f_ms)`.
 */
export function psiOf(rec: AirRecord, depth: Float64Array | Float32Array, r: number, muS: number, dirs: Float64Array, nDirs: number, steps: number, out: Float64Array, at: number): void {
  const bottom = rec[F.bottom];
  const top = rec[F.top];
  const sx = Math.sqrt(Math.max(0, 1 - muS * muS));
  const sy = muS;
  const mieS = rec[F.mieS];
  const mieT = mieS + rec[F.mieA];
  // Pass 2, wave 4a: the haze's scattering by channel (its colour), its extinction grey; at 1, 1, 1 each is `mieS` to the bit.
  const mS0 = mieS * rec[F.mieTintR];
  const mS1 = mieS * rec[F.mieTintG];
  const mS2 = mieS * rec[F.mieTintB];
  let L0 = 0;
  let L1 = 0;
  let L2 = 0;
  let f0 = 0;
  let f1 = 0;
  let f2 = 0;
  for (let k = 0; k < nDirs; k++) {
    const dx = dirs[k * 3];
    const dy = dirs[k * 3 + 1];
    const dz = dirs[k * 3 + 2];
    const len = rayLength(r, dy, bottom, top);
    const ground = hitsGround(r, dy, bottom);
    let T0 = 1;
    let T1 = 1;
    let T2 = 1;
    let prev = 0;
    for (let i = 0; i < steps; i++) {
      const u = (i + 1) / steps;
      const e1 = len * u * u;
      const dt = e1 - prev;
      const t = prev + 0.5 * dt;
      prev = e1;
      const px = t * dx;
      const py = r + t * dy;
      const pz = t * dz;
      const rr = Math.sqrt(px * px + py * py + pz * pz);
      densities(rec, rr - bottom, mScratch);
      const sR0 = rec[F.rayR] * mScratch[0];
      const sR1 = rec[F.rayG] * mScratch[0];
      const sR2 = rec[F.rayB] * mScratch[0];
      const e0 = sR0 + mieT * mScratch[1] + rec[F.ozR] * mScratch[2];
      const ec1 = sR1 + mieT * mScratch[1] + rec[F.ozG] * mScratch[2];
      const e2 = sR2 + mieT * mScratch[1] + rec[F.ozB] * mScratch[2];
      lightTransmittance(rec, depth, rr, (px * sx + py * sy) / rr, t3, 0);
      const s0 = sR0 + mS0 * mScratch[1];
      const s1 = sR1 + mS1 * mScratch[1];
      const s2 = sR2 + mS2 * mScratch[1];
      const st0 = Math.exp(-e0 * dt);
      const st1 = Math.exp(-ec1 * dt);
      const st2 = Math.exp(-e2 * dt);
      const g0 = e0 > 1e-12 ? (1 - st0) / e0 : dt;
      const g1 = ec1 > 1e-12 ? (1 - st1) / ec1 : dt;
      const g2 = e2 > 1e-12 ? (1 - st2) / e2 : dt;
      L0 += T0 * s0 * t3[0] * INV_4PI * g0;
      L1 += T1 * s1 * t3[1] * INV_4PI * g1;
      L2 += T2 * s2 * t3[2] * INV_4PI * g2;
      f0 += T0 * s0 * g0;
      f1 += T1 * s1 * g1;
      f2 += T2 * s2 * g2;
      T0 *= st0;
      T1 *= st1;
      T2 *= st2;
    }
    if (ground) {
      // The ground's bounce at the ray's end: Lambert's, lit by the light through the air down to it.
      const gx = len * dx;
      const gy = r + len * dy;
      const gz = len * dz;
      const gr = Math.sqrt(gx * gx + gy * gy + gz * gz);
      const muG = (gx * sx + gy * sy) / gr;
      if (muG > 0) {
        lightTransmittance(rec, depth, gr, muG, t3, 0);
        L0 += (T0 * rec[F.groundR] * t3[0] * muG) / PI;
        L1 += (T1 * rec[F.groundG] * t3[1] * muG) / PI;
        L2 += (T2 * rec[F.groundB] * t3[2] * muG) / PI;
      }
    }
  }
  // Each ray's light reaches the point through its isotropic phase over the ray's share of the sphere: the mean.
  const inv = 1 / nDirs;
  const m0 = f0 * inv;
  const m1 = f1 * inv;
  const m2 = f2 * inv;
  out[at] = (L0 * inv) / (1 - (m0 < 0.99 ? m0 : 0.99));
  out[at + 1] = (L1 * inv) / (1 - (m1 < 0.99 ? m1 : 0.99));
  out[at + 2] = (L2 * inv) / (1 - (m2 < 0.99 ? m2 : 0.99));
}

/** A record's multiple-scattering table at the twin's size, into `out` (`PSI_FLOATS`), from its world's column densities. */
export function buildPsiTable(rec: AirRecord, depth: Float64Array | Float32Array, out: Float64Array | Float32Array, nDirs: number = TWIN_STEPS.psiDirs, steps: number = TWIN_STEPS.psi): void {
  const W = TWIN_PSI.width;
  const H = TWIN_PSI.height;
  const dirs = new Float64Array(nDirs * 3);
  sphereDirections(nDirs, dirs);
  const tmp = new Float64Array(3);
  const bottom = rec[F.bottom];
  const top = rec[F.top];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      // The texel centres' own (the card's `texelToUnit` at the twin's size), so a read at a centre is that texel's sum.
      const muS = (i / (W - 1)) * 2 - 1;
      const r = Math.min(bottom + (j / (H - 1)) * (top - bottom) + 0.001, top - 0.001);
      psiOf(rec, depth, r, muS, dirs, nDirs, steps, tmp, 0);
      const o = (j * W + i) * 3;
      out[o] = tmp[0];
      out[o + 1] = tmp[1];
      out[o + 2] = tmp[2];
    }
  }
}

// ---------------------------------------------------------------- the sky's radiance

/**
 * The lights a view ray is lit by, in the frame the sums are worked in (the camera at the planet's top, +Y up): three,
 * each a unit direction and its illuminance at the top of the air (red, green, blue). Kept and rewritten.
 */
export class AirLights {
  count = 0;
  readonly dir = new Float64Array(9);
  readonly top = new Float64Array(9);
  /** Whether each lights anything at all this frame (a light deep under the horizon is left out of the sums). */
  readonly live = new Uint8Array(3);
}

/** A light deeper than this under the planet's horizon (its zenith cosine at the camera) sends nothing a sum would see. */
export const LIGHT_FLOOR_MU = -0.35;

const lt = new Float64Array(3);
const ps = new Float64Array(3);

/**
 * The sky's radiance toward a view direction (dx, dy, dz) from a point `r` km from the centre, lit by `lights`, summed by
 * `steps` (squared spacing, so the near air has most of them), into `out` at `at` (rgb); `transmittance` (if given) takes
 * the ray's own transmittance at its end. `maxT` stops the ray short (km; the haze's slices); the ground ends it and adds
 * no light of its own (the land is drawn). Single scattering by Rayleigh's and Mie's phases with each light's
 * transmittance from the table, plus the multiple scattering's share from its table, each step integrated exactly over
 * its length through its own extinction.
 */
export function viewRadiance(
  rec: AirRecord,
  depth: Float64Array | Float32Array,
  psi: Float64Array | Float32Array,
  r: number,
  dx: number,
  dy: number,
  dz: number,
  lights: AirLights,
  steps: number,
  maxT: number,
  out: Float64Array,
  at: number,
  transmittance: Float64Array | null,
): void {
  const bottom = rec[F.bottom];
  const top = rec[F.top];
  let len = rayLength(r, dy, bottom, top);
  if (maxT < len) len = maxT;
  const mieS = rec[F.mieS];
  const mieT = mieS + rec[F.mieA];
  // Pass 2, wave 4a: the haze's scattering by channel (its colour), its extinction grey; at 1, 1, 1 each is `mieS` to the bit.
  const mS0 = mieS * rec[F.mieTintR];
  const mS1 = mieS * rec[F.mieTintG];
  const mS2 = mieS * rec[F.mieTintB];
  const g = rec[F.mieG];
  let L0 = 0;
  let L1 = 0;
  let L2 = 0;
  let T0 = 1;
  let T1 = 1;
  let T2 = 1;
  let prev = 0;
  const n = lights.count;
  for (let i = 0; i < steps; i++) {
    const u = (i + 1) / steps;
    const e1 = len * u * u;
    const dt = e1 - prev;
    const t = prev + 0.5 * dt;
    prev = e1;
    const px = t * dx;
    const py = r + t * dy;
    const pz = t * dz;
    const rr = Math.sqrt(px * px + py * py + pz * pz);
    densities(rec, rr - bottom, mScratch);
    const sR0 = rec[F.rayR] * mScratch[0];
    const sR1 = rec[F.rayG] * mScratch[0];
    const sR2 = rec[F.rayB] * mScratch[0];
    const sM0 = mS0 * mScratch[1];
    const sM1 = mS1 * mScratch[1];
    const sM2 = mS2 * mScratch[1];
    const e0 = sR0 + mieT * mScratch[1] + rec[F.ozR] * mScratch[2];
    const ec1 = sR1 + mieT * mScratch[1] + rec[F.ozG] * mScratch[2];
    const e2 = sR2 + mieT * mScratch[1] + rec[F.ozB] * mScratch[2];
    let S0 = 0;
    let S1 = 0;
    let S2 = 0;
    for (let k = 0; k < n; k++) {
      if (!lights.live[k]) continue;
      const lx = lights.dir[k * 3];
      const ly = lights.dir[k * 3 + 1];
      const lz = lights.dir[k * 3 + 2];
      const muL = (px * lx + py * ly + pz * lz) / rr;
      const c = dx * lx + dy * ly + dz * lz;
      const pR = rayleighPhase(c);
      const pM = miePhase(c, g);
      lightTransmittance(rec, depth, rr, muL, lt, 0);
      psiAt(rec, psi, rr, muL, ps, 0);
      S0 += lights.top[k * 3] * (lt[0] * (sR0 * pR + sM0 * pM) + ps[0] * (sR0 + sM0));
      S1 += lights.top[k * 3 + 1] * (lt[1] * (sR1 * pR + sM1 * pM) + ps[1] * (sR1 + sM1));
      S2 += lights.top[k * 3 + 2] * (lt[2] * (sR2 * pR + sM2 * pM) + ps[2] * (sR2 + sM2));
    }
    const st0 = Math.exp(-e0 * dt);
    const st1 = Math.exp(-ec1 * dt);
    const st2 = Math.exp(-e2 * dt);
    L0 += T0 * S0 * (e0 > 1e-12 ? (1 - st0) / e0 : dt);
    L1 += T1 * S1 * (ec1 > 1e-12 ? (1 - st1) / ec1 : dt);
    L2 += T2 * S2 * (e2 > 1e-12 ? (1 - st2) / e2 : dt);
    T0 *= st0;
    T1 *= st1;
    T2 *= st2;
  }
  out[at] = L0;
  out[at + 1] = L1;
  out[at + 2] = L2;
  if (transmittance) {
    transmittance[0] = T0;
    transmittance[1] = T1;
    transmittance[2] = T2;
  }
}

// ---------------------------------------------------------------- the hemisphere's quadrature

/**
 * The upper hemisphere's rays for the sky's light on a level surface: four rings by Gauss and Legendre over the zenith
 * cosine (each ring's weight its share of `∫ L μ dμ`) and seven azimuths over the half circle the sun's plane mirrors (the
 * ends counted half), so `E = Σ w · L`; a sky of one radiance everywhere gives π times it. Made once.
 */
const GL4 = [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526];
const GL4W = [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538];
const HEMI_AZ = 7;
export const HEMI_RAYS = 4 * HEMI_AZ;
export const HEMI_DIRS = new Float64Array(HEMI_RAYS * 3);
export const HEMI_WEIGHTS = new Float64Array(HEMI_RAYS);
{
  let k = 0;
  for (let i = 0; i < 4; i++) {
    const mu = 0.5 * (GL4[i] + 1);
    const wMu = 0.5 * GL4W[i] * mu;
    const s = Math.sqrt(1 - mu * mu);
    for (let j = 0; j < HEMI_AZ; j++) {
      const phi = (j / (HEMI_AZ - 1)) * PI;
      // The trapezoid over [0, π], doubled for the mirrored half: 2π in all.
      const wPhi = (((j === 0 || j === HEMI_AZ - 1 ? 0.5 : 1) * PI) / (HEMI_AZ - 1)) * 2;
      HEMI_DIRS[k * 3] = Math.cos(phi) * s;
      HEMI_DIRS[k * 3 + 1] = mu;
      HEMI_DIRS[k * 3 + 2] = Math.sin(phi) * s;
      HEMI_WEIGHTS[k] = wMu * wPhi;
      k++;
    }
  }
}

/** How many frames one cycle of the sums is spread over (AirTwin.sumSlice). */
export const SUM_SLICES = 5;

/** Azimuths the horizon's colour is averaged over (the half circle, ends counted half), at this elevation above the eye's level. */
const HORIZON_AZ = 7;
export const HORIZON_ELEVATION = (1.5 * PI) / 180;

// ---------------------------------------------------------------- the twin

/** What the twin hands out a frame (kept; scene units, linear rgb in typed arrays). */
export class AirTwinOut {
  /** Each light's illuminance reaching the camera: the casting sun, the second sun, the moon. */
  readonly sunHere = new Float64Array(3);
  readonly sun2Here = new Float64Array(3);
  readonly moonHere = new Float64Array(3);
  /** The sky's light on a level surface facing up (the hemisphere's upper half), and the ground's bounce on one facing down. */
  readonly skyUp = new Float64Array(3);
  readonly groundDown = new Float64Array(3);
  /** The sky's radiance at the horizon averaged round it (the fog colour), and at the zenith. */
  readonly horizon = new Float64Array(3);
  readonly zenith = new Float64Array(3);
  /** The visibility in force (km) and its fog-equivalent density per metre. */
  visibilityKm = 40.5;
  fogDensity = 0.5;
  /** The caller's for the lighting fields: the steer in force (0 to 1), and whether the moon is the world's light (night). */
  steer = 0.5;
  night = false;
  /** How many times the hemisphere was summed again. */
  sums = 0;
  constructor() {
    this.steer = 0;
  }
}

/** Where each number of the twin's inputs sits (`AirTwin.inp`, written by the caller before `frame`). */
export const IN = { sx: 0, sy: 1, sz: 2, mx: 3, my: 4, mz: 5, s2x: 6, s2y: 7, s2z: 8, heightKm: 9 } as const;

/**
 * The twin's state for one world: the blended record, the world's column densities and the blended multiple scattering,
 * the lights in the sums' frame, and what was last summed, so a frame whose sun, height and air did not move works out
 * the lights through the air alone (a quarter of a microsecond) and one that did sums the hemisphere again (some 20).
 * Its inputs are written into `inp` (and `sun2`) and its tops into `sunTop`, `sun2Top`, `moonTop` before each `frame`,
 * since a number handed across a call is a number made.
 */
export class AirTwin {
  /** The record in force this frame (the mix's rows blended): what the card's tables are made from too. */
  readonly record: AirRecord = newAirRecord();
  /** The world's column densities, and the multiple-scattering share blended from the rows'. */
  readonly depth = new Float64Array(DEPTH_FLOATS);
  readonly psi = new Float64Array(PSI_FLOATS);
  readonly lights = new AirLights();
  readonly out = new AirTwinOut();
  /** The frame's inputs (`IN`): the sun's, the moon's and the second sun's directions (world unit vectors, +Y up) and the camera's height over the surface, km. */
  readonly inp = new Float64Array(10);
  /** Whether the second sun is (a world of two stars). */
  sun2 = false;
  /** The light at the top of the air of each (scene units, rgb), the caller's. */
  readonly sunTop = new Float64Array(3);
  readonly sun2Top = new Float64Array(3);
  readonly moonTop = new Float64Array(3);
  /** What was summed last: the sun's, the second sun's and the moon's zenith cosines, the height, and the air's count. */
  private lastMuS = 0.5;
  private lastMuM = 0.5;
  private lastMu2 = 0.5;
  private lastH = 0.5;
  private lastVersion = -1;
  /** Bumped by whoever moves the record or its tables (`blendRows`, `useRecord`, `useDepth`). */
  version = 0;
  private readonly rgb = new Float64Array(3);
  private readonly ray = new Float64Array(3);

  constructor() {
    this.lastMuS = 0;
    this.lastMuM = 0;
    this.lastMu2 = 0;
    this.lastH = 0;
    this.inp[IN.sy] = 1;
    this.inp[IN.my] = -1;
    this.inp[IN.s2y] = 1;
    this.inp[IN.heightKm] = 0.01;
  }

  /** The world's column densities in force (one table a world). */
  useDepth(depth: Float64Array | Float32Array): void {
    for (let i = 0; i < DEPTH_FLOATS; i++) this.depth[i] = depth[i];
    this.version++;
  }

  /** One record and its multiple scattering in force outright (a world of one row, a fallback, the tests). */
  useRecord(rec: AirRecord, psi: Float64Array | Float32Array): void {
    for (let f = 0; f < rec.length; f++) this.record[f] = rec[f];
    for (let i = 0; i < PSI_FLOATS; i++) this.psi[i] = psi[i];
    this.version++;
  }

  /**
   * The mix's rows blended by weight into the record and the multiple scattering (`n` of each): the record's numbers as
   * the weather blends them (numbers, never colours), the multiple scattering's share by the same weights. The sun's
   * colour is put back to luminance one. Allocates nothing.
   */
  blendRows(recs: readonly AirRecord[], psis: readonly (Float64Array | Float32Array)[], weights: ArrayLike<number>, n: number): void {
    let total = 0;
    for (let i = 0; i < n; i++) total += weights[i] > 0 ? weights[i] : 0;
    const inv = total > 0 ? 1 / total : 0;
    const rec = this.record;
    for (let f = 0; f < rec.length; f++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += recs[i][f] * (weights[i] > 0 ? weights[i] : 0);
      rec[f] = total > 0 ? s * inv : recs[0][f];
    }
    const lum = LUMA_R * rec[F.sunR] + LUMA_G * rec[F.sunG] + LUMA_B * rec[F.sunB];
    if (lum > 0) {
      rec[F.sunR] /= lum;
      rec[F.sunG] /= lum;
      rec[F.sunB] /= lum;
    }
    for (let k = 0; k < PSI_FLOATS; k++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += psis[i][k] * (weights[i] > 0 ? weights[i] : 0);
      this.psi[k] = total > 0 ? s * inv : psis[0][k];
    }
    this.version++;
  }

  /**
   * One frame, from `inp`, `sun2` and the tops: the lights through the air at the camera, and the hemisphere and the
   * horizon summed again where the sun, the moon, the height or the air moved enough to see. Allocates nothing.
   */
  frame(): void {
    const rec = this.record;
    const o = this.out;
    const inp = this.inp;
    const sun2 = this.sun2;
    const hk = inp[IN.heightKm];
    const r = rec[F.bottom] + (hk > 0.001 ? hk : 0.001);
    const sy = inp[IN.sy];
    const my = inp[IN.my];
    const s2y = inp[IN.s2y];
    REG[0] = r;
    REG[1] = sy;
    transmitReg(rec, this.depth, this.rgb, 0);
    o.sunHere[0] = this.sunTop[0] * this.rgb[0];
    o.sunHere[1] = this.sunTop[1] * this.rgb[1];
    o.sunHere[2] = this.sunTop[2] * this.rgb[2];
    REG[0] = r;
    REG[1] = my;
    transmitReg(rec, this.depth, this.rgb, 0);
    o.moonHere[0] = this.moonTop[0] * this.rgb[0];
    o.moonHere[1] = this.moonTop[1] * this.rgb[1];
    o.moonHere[2] = this.moonTop[2] * this.rgb[2];
    if (sun2) {
      REG[0] = r;
      REG[1] = s2y;
      transmitReg(rec, this.depth, this.rgb, 0);
      o.sun2Here[0] = this.sun2Top[0] * this.rgb[0];
      o.sun2Here[1] = this.sun2Top[1] * this.rgb[1];
      o.sun2Here[2] = this.sun2Top[2] * this.rgb[2];
    } else o.sun2Here[0] = o.sun2Here[1] = o.sun2Here[2] = 0;
    const ext = rec[F.rayG] + rec[F.mieS] + rec[F.mieA];
    o.visibilityKm = ext > 0 ? 3.912 / ext : 1e6;
    // The exponential-squared fog that falls to 2% at the visibility: (ρ v)² = −ln 0.02.
    o.fogDensity = 1.9778 / (o.visibilityKm * 1000);
    const dS = sy - this.lastMuS;
    const dM = my - this.lastMuM;
    const d2 = s2y - this.lastMu2;
    const dH = hk - this.lastH;
    if ((dS < 0 ? -dS : dS) > 1e-3 || (dM < 0 ? -dM : dM) > 1e-3 || (sun2 && (d2 < 0 ? -d2 : d2) > 1e-3) || (dH < 0 ? -dH : dH) > 0.05 || this.version !== this.lastVersion) {
      this.lastMuS = sy;
      this.lastMuM = my;
      this.lastMu2 = s2y;
      this.lastH = hk;
      this.lastVersion = this.version;
      this.wanted = true;
    }
    // The sums, a slice a frame (`SUM_SLICES`, about a hundred steps each): begun where they are wanted and none is under
    // way, published when the last slice lands. The first ever is summed whole, so nothing is read before it.
    this.rNow = r;
    if (o.sums === 0 && this.slice < 0) this.sumNow();
    else {
      if (this.slice < 0 && this.wanted) this.beginSum();
      if (this.slice >= 0) this.sumSlice();
    }
    // The ground under the camera: Lambert's, lit by the lights through the air and the sky's own light.
    const cs = sy > 0 ? sy : 0;
    const cm = my > 0 ? my : 0;
    const c2 = sun2 && s2y > 0 ? s2y : 0;
    o.groundDown[0] = (o.skyUp[0] + o.sunHere[0] * cs + o.moonHere[0] * cm + o.sun2Here[0] * c2) * rec[F.groundR];
    o.groundDown[1] = (o.skyUp[1] + o.sunHere[1] * cs + o.moonHere[1] * cm + o.sun2Here[1] * c2) * rec[F.groundG];
    o.groundDown[2] = (o.skyUp[2] + o.sunHere[2] * cs + o.moonHere[2] * cm + o.sun2Here[2] * c2) * rec[F.groundB];
  }

  /**
   * The lights in the sums' frame, from `inp`: turned about the vertical so the casting sun's azimuth is +X (the sky view's
   * and the hemisphere's mirror is the sun's vertical plane), each left out where it stands too deep under the horizon.
   */
  lightsIn(): void {
    const L = this.lights;
    const inp = this.inp;
    const sun2 = this.sun2;
    const sx = inp[IN.sx];
    const sz = inp[IN.sz];
    const h = Math.sqrt(sx * sx + sz * sz);
    const cx = h > 1e-9 ? sx / h : 1;
    const cz = h > 1e-9 ? sz / h : 0;
    // The turn taking (cx, cz) to (1, 0): x' = x cx + z cz, z' = -x cz + z cx.
    L.count = 3;
    L.dir[0] = sx * cx + sz * cz;
    L.dir[1] = inp[IN.sy];
    L.dir[2] = -sx * cz + sz * cx;
    L.dir[3] = inp[IN.s2x] * cx + inp[IN.s2z] * cz;
    L.dir[4] = inp[IN.s2y];
    L.dir[5] = -inp[IN.s2x] * cz + inp[IN.s2z] * cx;
    L.dir[6] = inp[IN.mx] * cx + inp[IN.mz] * cz;
    L.dir[7] = inp[IN.my];
    L.dir[8] = -inp[IN.mx] * cz + inp[IN.mz] * cx;
    for (let k = 0; k < 3; k++) {
      L.top[k] = this.sunTop[k];
      L.top[3 + k] = sun2 ? this.sun2Top[k] : 0;
      L.top[6 + k] = this.moonTop[k];
    }
    L.live[0] = inp[IN.sy] > LIGHT_FLOOR_MU ? 1 : 0;
    L.live[1] = sun2 && inp[IN.s2y] > LIGHT_FLOOR_MU ? 1 : 0;
    // The moon sends 2.3 millionths of the sun's light: summed only once the sun is under the eye's level, where it starts to tell.
    L.live[2] = inp[IN.my] > LIGHT_FLOOR_MU && inp[IN.sy] < 0 && (this.moonTop[0] > 0 || this.moonTop[1] > 0 || this.moonTop[2] > 0) ? 1 : 0;
  }

  /** The sky's radiance toward a direction in the sums' frame (the sun's azimuth +X), from the camera at `heightKm` (the proofs'). */
  radianceIn(dx: number, dy: number, dz: number, heightKm: number, steps: number, out: Float64Array): void {
    const r = this.record[F.bottom] + (heightKm > 0.001 ? heightKm : 0.001);
    viewRadiance(this.record, this.depth, this.psi, r, dx, dy, dz, this.lights, steps, Infinity, out, 0, null);
  }

  /** The camera's distance from the centre for the sums (a field: a number across a call is a number made), and the cycle's own. */
  private rNow = 0.5;
  private rSum = 0.5;
  /** The slice of the sums under way (-1 none), whether the air or the lights moved since the last began, and the slices' running sums. */
  private slice = -1;
  private wanted = false;
  private readonly acc = new Float64Array(9);

  /** The sums asked whole, now, from the camera at `rNow` (the first frame's, the tests', a jump's). */
  sumNow(): void {
    this.beginSum();
    while (this.slice >= 0) this.sumSlice();
  }

  /** A new cycle of the sums: the lights as they stand now, the camera where it stands, the running sums at nought. */
  private beginSum(): void {
    this.wanted = false;
    this.lightsIn();
    this.rSum = this.rNow;
    for (let k = 0; k < 9; k++) this.acc[k] = 0;
    this.slice = 0;
  }

  /**
   * One slice of the hemisphere's light, the horizon's colour and the zenith's, summed from the cycle's camera (through the
   * registers); the last publishes them. Slices 0 to 2 are the hemisphere's 28 rays (10, 9, 9), 3 and 4 the horizon's 7
   * (4, then 3 and the zenith): each about a hundred steps.
   */
  private sumSlice(): void {
    const r = this.rSum;
    const rec = this.record;
    const ray = this.ray;
    const acc = this.acc;
    const s = this.slice;
    if (s <= 2) {
      const from = s === 0 ? 0 : s === 1 ? 10 : 19;
      const to = s === 0 ? 10 : s === 1 ? 19 : HEMI_RAYS;
      for (let k = from; k < to; k++) {
        REG[4] = r;
        REG[5] = HEMI_DIRS[k * 3];
        REG[6] = HEMI_DIRS[k * 3 + 1];
        REG[7] = HEMI_DIRS[k * 3 + 2];
        viewRadianceReg(rec, this.depth, this.psi, this.lights, TWIN_STEPS.hemi, ray, 0);
        const w = HEMI_WEIGHTS[k];
        acc[0] += ray[0] * w;
        acc[1] += ray[1] * w;
        acc[2] += ray[2] * w;
      }
    } else {
      const from = s === 3 ? 0 : 4;
      const to = s === 3 ? 4 : HORIZON_AZ;
      for (let j = from; j < to; j++) {
        REG[4] = r;
        REG[5] = HORIZON_DIRS[j * 3];
        REG[6] = HORIZON_DIRS[j * 3 + 1];
        REG[7] = HORIZON_DIRS[j * 3 + 2];
        viewRadianceReg(rec, this.depth, this.psi, this.lights, TWIN_STEPS.view, ray, 0);
        const w = HORIZON_WEIGHTS[j];
        acc[3] += ray[0] * w;
        acc[4] += ray[1] * w;
        acc[5] += ray[2] * w;
      }
      if (s === 4) {
        REG[4] = r;
        REG[5] = 0;
        REG[6] = 1;
        REG[7] = 0;
        viewRadianceReg(rec, this.depth, this.psi, this.lights, TWIN_STEPS.view, ray, 0);
        acc[6] = ray[0];
        acc[7] = ray[1];
        acc[8] = ray[2];
      }
    }
    if (s < SUM_SLICES - 1) {
      this.slice = s + 1;
      return;
    }
    const o = this.out;
    o.skyUp[0] = acc[0];
    o.skyUp[1] = acc[1];
    o.skyUp[2] = acc[2];
    o.horizon[0] = acc[3];
    o.horizon[1] = acc[4];
    o.horizon[2] = acc[5];
    o.zenith[0] = acc[6];
    o.zenith[1] = acc[7];
    o.zenith[2] = acc[8];
    o.sums++;
    this.slice = -1;
  }
}

/** The horizon's rays (the half circle at `HORIZON_ELEVATION`) and their weights, made once. */
const HORIZON_DIRS = new Float64Array(HORIZON_AZ * 3);
const HORIZON_WEIGHTS = new Float64Array(HORIZON_AZ);
{
  const ce = Math.cos(HORIZON_ELEVATION);
  const se = Math.sin(HORIZON_ELEVATION);
  for (let j = 0; j < HORIZON_AZ; j++) {
    const phi = (j / (HORIZON_AZ - 1)) * PI;
    HORIZON_DIRS[j * 3] = Math.cos(phi) * ce;
    HORIZON_DIRS[j * 3 + 1] = se;
    HORIZON_DIRS[j * 3 + 2] = Math.sin(phi) * ce;
    HORIZON_WEIGHTS[j] = (j === 0 || j === HORIZON_AZ - 1 ? 0.5 : 1) / (HORIZON_AZ - 1);
  }
}

// ---------------------------------------------------------------- the scene's units

/** Tatooine's noon on SWG's path: its main light's peak, 67.5 degrees up (`daycycle.ts`'s `SWG_LIGHT_ELEVATION`). */
export const TATOOINE_NOON_ELEVATION = (67.5 * PI) / 180;
/** The camera the units are set at: a few metres over the surface. */
export const UNITS_HEIGHT_KM = 0.01;

/**
 * Today's clear Tatooine noon's key light, in the scene's luminance: the main light as the world makes it from SWG's ramps
 * on WebGL and under SWG's sky, `SWG_MAIN_LIGHT` 2.4 times the clear noon row's main scale (1.156) on a colour of luminance
 * 0.686, which is 1.903 (read off the running game at Mos Eisley at 12:00, the weather clear and the hour held, by the
 * wave's review and its measurer alike: an intensity of 2.775 on that colour). The design's "a clear Tatooine noon stays at
 * today's 2.4" is this light; the first cut set the sun's own luminance to 2.4, a quarter over it, and with the brighter sky
 * and bounce physics gives beside it the noon read 1.85 times today's on an up-facing white surface.
 */
export const TODAY_NOON_KEY = 1.903;

/**
 * The factor that turns the air's physical light into the scene's (`AIR_UNITS.scene`): a clear Tatooine noon's sun,
 * through Tatooine's air at its starting visibility, lights the world at today's key light there (`TODAY_NOON_KEY`) in
 * luminance. Worked once by the direct sum (no table), so it is one number for the session whatever the dials do afterwards.
 */
export function sceneUnits(visibilityKm = 40): number {
  const rec = worldRecord('tatooine');
  setVisibility(rec, visibilityKm);
  const tauOut = new Float64Array(3);
  opticalDepth(rec, rec[F.bottom] + UNITS_HEIGHT_KM, Math.sin(TATOOINE_NOON_ELEVATION), 400, tauOut, 0);
  const lum = rec[F.sunStrength] * (LUMA_R * rec[F.sunR] * Math.exp(-tauOut[0]) + LUMA_G * rec[F.sunG] * Math.exp(-tauOut[1]) + LUMA_B * rec[F.sunB] * Math.exp(-tauOut[2]));
  return TODAY_NOON_KEY / lum;
}

// ---------------------------------------------------------------- into the lighting

/** A colour the lighting fields hold (`THREE.Color`'s numbers). */
interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The fields of `SwgSky.lighting` the twin writes (the rest are the sky's: alphas, shadows, wind, the leaf cards' rows). */
export interface TwinLighting {
  main: Rgb;
  mainScale: number;
  ambient: Rgb;
  ambientScale: number;
  bounce: Rgb;
  bounceScale: number;
  fill: Rgb;
  fillScale: number;
  fog: Rgb;
  fogDensity: number;
}

/** The bounce the lighting writes, kept (never a number across a call). */
const bounceRgb = new Float64Array(3);
/** Each light's unit (the main, the hemisphere's two halves, the fill), SWG's scales of the hour and the air's, kept. */
const LIGHT_UNITS = new Float64Array([AIR_LIGHT.main, AIR_LIGHT.ambient, 1, AIR_LIGHT.fill]);
const swgScales = new Float64Array(4);
const scales = new Float64Array(4);

/**
 * The twin's frame into the lighting fields, in the scene's light units as `world.ts` turns them into lights
 * (`AIR_LIGHT`): the main light is whichever body lights the world (`t.night` the moon, as the day's `lightDir` picks), the
 * hemisphere's upper half the sky's light on a level surface, its lower half the ground's bounce (written so that, mixed
 * `bounceToSky` toward the sky's colour as the world mixes it, it comes out the bounce), the fill the second sun's (black
 * on a world of one star), the fog the horizon's colour at the visibility's density. `t.steer` (0 to 1) bends each light
 * toward SWG's of the hour (`swg`), the owner's dial: 0 leaves the air's alone. Allocates nothing, and calls nothing: with
 * the four lights' split in a helper, V8 built the helper into two of its four calls in this module and the other two made
 * 32 B a frame between them (the sampling heap profiler and `--trace-turbo-inlining`), so it is one loop written out.
 */
export function writeTwinLighting(t: AirTwinOut, swg: TwinLighting, L: TwinLighting): void {
  const st = t.steer;
  const s = st > 0 ? (st < 1 ? st : 1) : 0;
  const k = 1 - s;
  const key = t.night ? t.moonHere : t.sunHere;
  // The world mixes the bounce `bounceToSky` toward the sky's colour (L.ambient × L.ambientScale): the bounce written here
  // is what makes that mix the ground's own, held at nought where the sky alone is more than the ground gives back.
  const m = AIR_LIGHT.bounceToSky;
  for (let j = 0; j < 3; j++) {
    const v = (t.groundDown[j] / AIR_LIGHT.ambient - (t.skyUp[j] / AIR_LIGHT.ambient) * m) / (1 - m);
    bounceRgb[j] = v > 0 ? v : 0;
  }
  swgScales[0] = swg.mainScale;
  swgScales[1] = swg.ambientScale;
  swgScales[2] = swg.bounceScale;
  swgScales[3] = swg.fillScale;
  for (let i = 0; i < 4; i++) {
    // Light i: 0 the main, 1 the hemisphere's sky, 2 its ground, 3 the fill; its rgb, its unit and its fields.
    const src = i === 0 ? key : i === 1 ? t.skyUp : i === 2 ? bounceRgb : t.sun2Here;
    const c = i === 0 ? L.main : i === 1 ? L.ambient : i === 2 ? L.bounce : L.fill;
    const sc = i === 0 ? swg.main : i === 1 ? swg.ambient : i === 2 ? swg.bounce : swg.fill;
    const r = src[0];
    const g = src[1];
    const b = src[2];
    const lum = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    if (!(lum > 1e-12)) {
      c.r = 0;
      c.g = 0;
      c.b = 0;
      scales[i] = 0;
    } else {
      c.r = r / lum;
      c.g = g / lum;
      c.b = b / lum;
      scales[i] = lum / LIGHT_UNITS[i];
    }
    if (s > 0) {
      c.r = c.r * k + sc.r * s;
      c.g = c.g * k + sc.g * s;
      c.b = c.b * k + sc.b * s;
      scales[i] = scales[i] * k + swgScales[i] * s;
    }
  }
  L.mainScale = scales[0];
  L.ambientScale = scales[1];
  L.bounceScale = scales[2];
  L.fillScale = scales[3];
  L.fog.r = t.horizon[0] * k + swg.fog.r * s;
  L.fog.g = t.horizon[1] * k + swg.fog.g * s;
  L.fog.b = t.horizon[2] * k + swg.fog.b * s;
  L.fogDensity = t.fogDensity;
}
/**
 * The steer's per-channel gain on what the air adds (the sky's radiance and the haze's light), into `out` (x, y, z): at
 * `t.steer` 0 one; at 1 SWG's fog colour of the hour over the air's horizon, channel by channel (held within a twentieth
 * and twenty times), so the air's shape keeps and its colour is SWG's.
 */
export function steerGain(t: AirTwinOut, swgFog: Rgb, out: { x: number; y: number; z: number }): void {
  const st = t.steer;
  const s = st > 0 ? (st < 1 ? st : 1) : 0;
  const k = 1 - s;
  const h = t.horizon;
  let q = h[0] > 1e-9 ? swgFog.r / h[0] : 1;
  out.x = k + s * (q < 0.05 ? 0.05 : q > 20 ? 20 : q);
  q = h[1] > 1e-9 ? swgFog.g / h[1] : 1;
  out.y = k + s * (q < 0.05 ? 0.05 : q > 20 ? 20 : q);
  q = h[2] > 1e-9 ? swgFog.b / h[2] : 1;
  out.z = k + s * (q < 0.05 ? 0.05 : q > 20 ? 20 : q);
}
