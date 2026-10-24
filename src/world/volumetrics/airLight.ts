// The light pass toward the sun (the design's §2.8, the demo's `land.html:640-664`), as plain arithmetic: from a point of
// the window, `steps` steps toward the sun across the ground, each `step` metres, summing the dust on the way; the
// transmittance is exp(-k · sum). Out of the window the storm's dust is on the way. The shader is `LIGHT_FRAGMENT`
// (`airShaders.ts`); this is the same march written once more so the node test holds it to the demo's numbers, and what
// the field asks of it each frame that steps (the sun's direction across the ground, the step's length).
//
// The step is the demo's 0.64 · min(3.5, 0.75 / tan elevation), lengthened by 26 / steps so the reach in metres holds as
// the steps change (`lightStep`, `airMath.ts`): a low sun reaches far across the ground, a high one a short way.
//
// Pure: no three.
import { lightStep, lightTransmittance } from './airMath.ts';
import { AIR_TUNE } from './airTune.ts';

/** What one march is asked: the sun across the ground, the step, how many, the dust's share, the k, the inflow, the window. */
export interface LightMarch {
  /** Toward the sun across the ground, unit in XZ (window u along +X, v along +Z). */
  sunX: number;
  sunZ: number;
  /** Metres a step. */
  step: number;
  steps: number;
  /** How much a unit of dust takes from the sun on the way. */
  dustK: number;
  k: number;
  /** The dust out of the window (the storm's). */
  inflow: number;
  /** The window's size, metres. */
  size: number;
}

/**
 * The march from window uv (u, v): the transmittance toward the sun. `dustAt(u, v)` answers the dust (its density) at
 * a point inside the window. The shader's loop exactly: steps 1 to `steps`, out of the window the inflow.
 */
export function marchLight(dustAt: (u: number, v: number) => number, u: number, v: number, m: LightMarch): number {
  let sum = 0;
  const du = (m.sunX * m.step) / m.size;
  const dv = (m.sunZ * m.step) / m.size;
  for (let k = 1; k <= m.steps; k++) {
    const qu = u + du * k;
    const qv = v + dv * k;
    const d = qu < 0 || qv < 0 || qu > 1 || qv > 1 ? m.inflow : dustAt(qu, qv);
    sum += d * m.dustK;
  }
  return lightTransmittance(sum, m.k);
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
