// Where a pod's and a bike's engine glows stand (the design's §7.2): on the vehicle's own engine points. The glows have
// always taken a def's `thrusters` as their second choice of point (`engineSpotsOf`), and the numbered engine rule never
// matched the gallery's `engine_1` (the underscore), so every pod and bike glowed at the rear of its box, which on a pod
// is behind the cockpit rather than at its engines. `racerThrusters` names the points instead, and the garage keeps them
// on the def at its first spawn, so the spawn and every refit hang the glows on the same points.
//
// The rule belongs to what a vehicle is, never to what it is spawned as: the def is shared by every spawn of it, so a
// hover car spawned as a bike that wrote its points onto the def would move the glows of every hover car spawned as the
// hover car it is. Only a gallery def whose own kind is a pod or a bike is given any (`raceThrustersFor`).
//
// Pure, so node loads it (`tools/swg/tests/raceSpots.test.ts`).
import { ENGINE_TUNE } from './drivetrain.ts';

/** An engine point as the rule reads it: its hardpoint name and its place across (x, +x the pilot's left) and along (z, +z the nose). */
export interface EnginePoint {
  readonly name: string;
  readonly x: number;
  readonly z: number;
}

/** An engine point's name: `engine_1`, `engine2`, never `engine_sound…` or `engine_damage…`. */
export const ENGINE_POINT = /^engine_?\d+$/i;

/**
 * The engine points a vehicle's glows stand on, by name. A pod: per side (+x the left, -x the right), the points within
 * `tolerance` metres of that side's rearmost along the pod, so a pod's exhausts glow and a point forward on the engine
 * (an intake) does not. A bike: every such point. In the order the points came; empty where there are none.
 */
export function racerThrusters(points: readonly EnginePoint[], kind: 'pod' | 'bike', tolerance: number = ENGINE_TUNE.rearTolerance): string[] {
  const named = points.filter((p) => ENGINE_POINT.test(p.name) && Number.isFinite(p.x) && Number.isFinite(p.z));
  if (kind === 'bike') return named.map((p) => p.name);
  const rear = [Infinity, Infinity];
  for (const p of named) {
    const s = p.x >= 0 ? 0 : 1;
    if (p.z < rear[s]) rear[s] = p.z;
  }
  return named.filter((p) => p.z <= rear[p.x >= 0 ? 0 : 1] + tolerance).map((p) => p.name);
}

/** What the decision reads of a def: what it is, and where the garage got it. */
export interface ThrusterDef {
  readonly kind: string;
  readonly source: string;
}

/**
 * A def's race thrusters, or null when it gets none: the pass switched off, a def that is not the gallery's, or one whose
 * own kind is neither a pod nor a bike (a hover car, an aircraft, a walker, a ship), whatever it is spawned as.
 */
export function raceThrustersFor(def: ThrusterDef, points: readonly EnginePoint[], on: boolean): string[] | null {
  if (!on || def.source !== 'gallery') return null;
  if (def.kind !== 'podracer' && def.kind !== 'speederbike') return null;
  return racerThrusters(points, def.kind === 'podracer' ? 'pod' : 'bike');
}

/** What the spawn writes of a def's thrusters: its race thrusters, once, and its glows' points from them when there are any. */
export interface ThrusterNote extends ThrusterDef {
  raceThrusters?: string[];
  thrusters?: string[];
}

/**
 * A def's race thrusters written on it at its first spawn with the pass on (nothing while they are known, or when it gets
 * none): onto the def the spawn was handed and nothing else, so a pod put together from parts, whose def is its own,
 * never writes into either pod's. `points` are read only when the def has none yet. Returns whether it wrote.
 */
export function noteRaceThrusters(def: ThrusterNote, points: () => readonly EnginePoint[], on: boolean): boolean {
  if (def.raceThrusters !== undefined) return false;
  const list = raceThrustersFor(def, def.source === 'gallery' ? points() : [], on);
  if (!list) return false;
  def.raceThrusters = list;
  if (list.length) def.thrusters = list;
  return true;
}

/** How much smaller each glow is drawn on a vehicle with more engine points than the two its size is worked out for. */
export function glowShare(points: number): number {
  return points > 2 ? 1 / Math.sqrt(points / 2) : 1;
}
