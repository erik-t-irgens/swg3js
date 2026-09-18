// The hot air behind a running engine, for the heat haze: how hard each vehicle's engines run, the
// shape of the plume behind each glow, and the noise phase that flows along it. The client drew no
// heat for engines; the shapes here are authored, sized from the glow the garage already puts at
// each nozzle and from the same speed, throttle and boost that size the glow.
//
// Types only from three and the vehicle, and the one value import is the plain heat sources module,
// so a node test reads this file as the game does.
import { plumeNoiseFrequency, type HeatPlumeSink } from '../world/heatSources.ts';
import type { Vehicle, VehicleKind } from './vehicle';

/** One plume: its length and radii in metres (at the nozzle and at the far end), its heat, and how fast its air flows (m/s). */
export interface PlumeShape {
  length: number;
  r0: number;
  r1: number;
  intensity: number;
  flow: number;
}

/** No plume is wider than this: a runaway size must not fill the screen. */
const PLUME_RADIUS_CAP = 6;
/** Below this heat an engine gives no plume at all. */
const ENGINE_HEAT_MIN = 0.02;

const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);

/**
 * How hard the engines run: 0 when the drive is not running; else 0.3 + 0.7 × the share of top
 * speed + 0.3 × the throttle, +0.5 boosting, at most 1.6, and halved while overheated.
 */
export function engineHeatOf(running: boolean, share: number, throttle: number, boosting: boolean, overheated: boolean): number {
  if (!running) return 0;
  let h = 0.3 + 0.7 * clamp01(share) + 0.3 * clamp01(throttle) + (boosting ? 0.5 : 0);
  if (h > 1.6) h = 1.6;
  return overheated ? h * 0.5 : h;
}

/**
 * The hot air behind one engine, by kind, glow size (metres) and heat (0 to 1.6), written into `out`.
 * A ship's is longest and a speeder's shortest, so a chase camera nine metres back looks along a
 * plume rather than sitting in it.
 */
export function enginePlume(kind: VehicleKind, ship: boolean, size: number, heat: number, out: PlumeShape): PlumeShape {
  const s = Number.isFinite(size) && size > 0 ? size : 0;
  const q = Number.isFinite(heat) && heat > 0 ? heat : 0;
  const h = q < 1 ? q : 1;
  if (ship || kind === 'ship') {
    out.r0 = 0.22 * s;
    out.r1 = 2.2 * out.r0;
    out.length = Math.min(12, s * (2 + 4 * h));
    out.intensity = Math.min(1.6, q);
    out.flow = 6 + 24 * h;
  } else if (kind === 'podracer') {
    out.r0 = 0.3 * s;
    out.r1 = 2.5 * out.r0;
    out.length = Math.min(10, s * (3 + 5 * h));
    out.intensity = Math.min(1.6, 1.2 * q);
    out.flow = 5 + 20 * h;
  } else {
    // Speeder bikes, flyers and ground machines with a drive.
    out.r0 = 0.25 * s;
    out.r1 = 2 * out.r0;
    out.length = Math.min(6, s * (1.5 + 3 * h));
    out.intensity = Math.min(1.2, q);
    out.flow = 3 + 12 * h;
  }
  out.r0 = Math.min(out.r0, PLUME_RADIUS_CAP);
  out.r1 = Math.min(out.r1, PLUME_RADIUS_CAP);
  return out;
}

const phaseShape: PlumeShape = { length: 0, r0: 0, r1: 0, intensity: 0, flow: 0 };

/**
 * Advance a vehicle's exhaust phase by this step's flow: `(enginePhase + dt × flow × plumeNoiseFrequency(r1)) % 1`
 * for its current plume. Integrated here, where dt is known, because the flow and the radius change
 * with the throttle: a phase computed as time × flow would jump whenever they do.
 */
export function advanceEnginePhase(v: Vehicle, size: number, dt: number): void {
  enginePlume(v.spec.kind, !!v.spec.ship, size, v.engineHeat, phaseShape);
  const step = dt > 0 && Number.isFinite(dt) ? dt * phaseShape.flow * plumeNoiseFrequency(phaseShape.r1) : 0;
  const next = (v.enginePhase + step) % 1;
  v.enginePhase = Number.isFinite(next) ? (next < 0 ? next + 1 : next) : 0;
}

const shape: PlumeShape = { length: 0, r0: 0, r1: 0, intensity: 0, flow: 0 };

/**
 * Every running engine's plume, from this frame's world matrices (the providers run inside the
 * effects' end of frame, after the scene has drawn). Stops as soon as the sink is full.
 */
export function vehiclePlumes(vehicles: readonly Vehicle[], sink: HeatPlumeSink): void {
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    if (v.engineHeat <= ENGINE_HEAT_MIN || !v.engines.length || !v.group.visible) continue;
    const g = v.group.matrixWorld.elements;
    // The exhaust leaves along the group's -Z (the nose is +Z); the sink normalises it.
    const dx = -g[8];
    const dy = -g[9];
    const dz = -g[10];
    const ship = !!v.spec.ship;
    for (let k = 0; k < v.engines.length; k++) {
      const e = v.engines[k];
      enginePlume(v.spec.kind, ship, e.size, v.engineHeat, shape);
      const m = e.object.matrixWorld.elements;
      if (!sink.push(m[12], m[13], m[14], dx, dy, dz, shape.length, shape.r0, shape.r1, shape.intensity, v.enginePhase + e.seed)) return;
    }
  }
}
