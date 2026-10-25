// The light pass toward the sun (the design's §2.8), as plain arithmetic: from a point of the window, `steps` steps
// toward the sun across the ground, each `step` metres, at each the dust there and the shape it carries, summing the
// optical depth the march itself would see along the slant for four heights over the point's own ground. The shader is
// `LIGHT_FRAGMENT` (`airShaders.ts`); this is the same march written once more so the node test holds it to the march's
// own extinction, and what the field asks of it each frame that steps (the sun's direction across the ground, the step).
//
// **From wave 2b, at the dust's own height and in optical depth.** The first wave's pass summed the dust at the
// ground's density all the way along a rise of 12.5 m toward the sun and wrote `exp(−0.16 · Σ 0.55 · dust)`, whatever the
// sun's elevation or the lit dust's height: a level patch of D 1 lit 0.10 at any height, where the march's own extinction
// lets 0.67 reach 1.8 m up at noon -- most of why the dust read too dark (research-amend-dust §2.2). Now each step reads
// the patch's folded profile (`foldedProfile`) at the ray's own height there, `h + (k − ½) · rise − (ground_k − ground_0)`,
// the step taken at its middle, and the ray's metres along the slant count: `τ(h) = selfShadow · Σ 0.55 · D_k · H₀ ·
// f_k · step / cos(el)`. Past the steps' reach the storm's tall inflow is finished in closed form (its half-normal's tail,
// an `erfc`, along the slant: `/ sin(el)`). Out of the window the storm's dust is on the way, standing on the point's own
// ground. Written as optical depths (an RGBA16F target, a height a channel), so the march interpolates in height and
// takes `exp(−τ)` itself, and the ground's shade reads `τ(0)`.
//
// The step is the demo's 0.64 · min(3.5, 0.75 / tan elevation), lengthened by 26 / steps so the reach in metres holds as
// the steps change (`lightStep`, `airMath.ts`): a low sun reaches far across the ground, a high one a short way.
//
// Pure: no three.
import { erfApprox, foldedProfile, lightStep } from './airMath.ts';
import { AIR_TUNE } from './airTune.ts';

/** What one march is asked: the sun across the ground, the step, its slant and rise, how many, the self-shadow, the inflow, the window, the heights. */
export interface LightMarch {
  /** Toward the sun across the ground, unit in XZ (window u along +X, v along +Z). */
  sunX: number;
  sunZ: number;
  /** Metres a step across the ground, and along the slant toward the sun (`step / cos el`) and up it (`step · tan el`). */
  step: number;
  slant: number;
  rise: number;
  steps: number;
  /** `selfShadow · 0.55 · H₀`: what a unit of the folded profile takes a metre. */
  k: number;
  /** The storm's dust out of the window (its weighted density) and its spread, metres. */
  inflow: number;
  stormSigma: number;
  /** 1 / sin(el): the slant a metre of height is, for the tail. */
  invSin: number;
  /** The window's size, metres. */
  size: number;
  /** The four heights over the point's ground, metres, lowest first. */
  heights: readonly [number, number, number, number];
}

/** What the march reads at a point inside the window: the dust's density, the mean height and spread it carries, and the ground there. */
export interface LightSample {
  d: number;
  mu: number;
  sigma: number;
  ground: number;
}

/** The light's own numbers for an elevation and a step count (the tests' and the console's), into `m`. */
export function lightMarchFor(elevation: number, steps: number, m: LightMarch): LightMarch {
  const el = elevation > 0.05 ? elevation : 0.05;
  const step = lightStep(el, steps);
  m.step = step;
  m.slant = step / Math.cos(el);
  m.rise = step * Math.tan(el);
  m.steps = steps;
  m.invSin = 1 / Math.sin(el);
  return m;
}

/** What the field hands `lightMarchIn` each frame that steps: the march's own record and the sun's elevation, radians. */
export interface LightMarchAsk extends LightMarch {
  elevation: number;
}

/**
 * `lightMarchFor` over `m.elevation` and `m.steps`, as the field calls it on the frame: the elevation handed across the
 * call was a number made on every frame that stepped (16 bytes, measured), so it rides in the record, and `lightStep`'s
 * arithmetic is written out here for the same reason. The same numbers to the bit.
 */
export function lightMarchIn(m: LightMarchAsk): void {
  const el = m.elevation > 0.05 ? m.elevation : 0.05;
  const L = AIR_TUNE.light;
  const steps = m.steps;
  const sun = Math.min(L.sunCap, L.sunScale / Math.tan(el));
  const step = L.step * sun * (L.refSteps / (steps > 0 ? steps : 1));
  m.step = step;
  m.slant = step / Math.cos(el);
  m.rise = step * Math.tan(el);
  m.invSin = 1 / Math.sin(el);
}

/**
 * The march from window uv (u, v): the optical depth toward the sun at each of the four heights, into `out`.
 * `sample(u, v, s)` answers the dust and the ground at a point inside the window. The shader's loop exactly: the steps
 * at their middles, out of the window the inflow standing on the point's own ground, then the tail.
 */
export function lightDepthAt(sample: (u: number, v: number, s: LightSample) => void, u: number, v: number, m: LightMarch, out: [number, number, number, number]): [number, number, number, number] {
  const s: LightSample = { d: 0, mu: 0, sigma: 1, ground: 0 };
  sample(u, v, s);
  const g0 = s.ground;
  const du = (m.sunX * m.step) / m.size;
  const dv = (m.sunZ * m.step) / m.size;
  const sMin = AIR_TUNE.dust.spreadMin;
  for (let j = 0; j < 4; j++) {
    const h0 = m.heights[j];
    let sum = 0;
    for (let k = 1; k <= m.steps; k++) {
      const x = k - 0.5;
      const qu = u + du * x;
      const qv = v + dv * x;
      let d: number;
      let mu: number;
      let sigma: number;
      let g: number;
      if (qu < 0 || qv < 0 || qu > 1 || qv > 1) {
        d = m.inflow;
        mu = 0;
        sigma = m.stormSigma;
        g = g0;
      } else {
        sample(qu, qv, s);
        d = s.d;
        mu = s.d >= 1e-5 ? s.mu : 0;
        sigma = s.d >= 1e-5 ? s.sigma : sMin;
        g = s.ground;
      }
      sum += d * foldedProfile(h0 + x * m.rise - (g - g0), mu, sigma);
    }
    let tau = m.k * sum * m.slant;
    if (m.inflow > 0) {
      const hEnd = h0 + m.steps * m.rise;
      tau += m.k * m.inflow * (1 - erfApprox(hEnd / (Math.SQRT2 * (m.stormSigma > 1e-3 ? m.stormSigma : 1e-3)))) * m.invSin;
    }
    out[j] = tau;
  }
  return out;
}

/**
 * The optical depth toward the sun at `h` metres over the ground, from the four heights the pass wrote: piecewise linear
 * between them, held at the lowest's below it and the highest's above it (the march's own reading).
 */
export function lightDepthAtHeight(tau: readonly number[], heights: readonly number[], h: number): number {
  if (!(h > heights[0])) return tau[0];
  for (let j = 1; j < 4; j++) {
    if (h <= heights[j]) {
      const span = heights[j] - heights[j - 1];
      const f = (h - heights[j - 1]) / (span > 1e-3 ? span : 1e-3);
      return tau[j - 1] + (tau[j] - tau[j - 1]) * f;
    }
  }
  return tau[3];
}

/** The sun's direction across the ground from a direction toward it, into `out`; straight overhead reads +Z, as the field writes it. */
export function lightSunAcross(sunX: number, sunZ: number, out: { x: number; z: number }): { x: number; z: number } {
  const l = Math.sqrt(sunX * sunX + sunZ * sunZ);
  if (l > 1e-6) {
    out.x = sunX / l;
    out.z = sunZ / l;
  } else {
    out.x = 0;
    out.z = 1;
  }
  return out;
}

/** The sun's elevation from the up part of a unit direction toward it, radians. */
export function lightElevation(sunY: number): number {
  return Math.asin(sunY > 1 ? 1 : sunY < -1 ? -1 : sunY);
}

/** How far across the ground the march reaches toward a sun at `elevation`, metres: the step times the steps. */
export function lightReach(elevation: number, steps: number, t = AIR_TUNE.light): number {
  return lightStep(elevation, steps, t) * steps;
}
