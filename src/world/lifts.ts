// Lifts: the game's elevators were objects the server spawned in shafts the buildings and ships
// model as cells named for them (elevator1, reactorlift, empelevator); no car is in the model,
// and the shaft has no floor at its upper levels. So the shaft's stops are its doorways: each
// portal out of the shaft cell opens at a level, and riding the lift is stepping out through
// the doorway of the next level up (or down, from the top), into the room beyond.
import * as THREE from 'three';

/** What a lift needs of a model: its cells with their portals, and the portal polygons in model space. */
export interface LiftModel {
  cells?: { index: number; name: string; bounds: { min: number[]; max: number[] }; portals?: { geometry: number; target: number; passable?: boolean }[] }[];
  portals?: { v: number[][]; i: number[] }[];
}

/** A room the model names as a lift shaft. */
export const LIFT_CELL = /elev|lift/i;

export interface LiftStop {
  /** The doorway's sill height, in model space. */
  level: number;
  /** The room the doorway opens into. */
  cell: number;
  /** A standing spot just through the doorway, in model space. */
  at: THREE.Vector3;
}

/** Whether a model's cell is a lift shaft. */
export function isLiftCell(model: LiftModel, cell: number): boolean {
  const c = model.cells?.find((x) => x.index === cell);
  return !!c && LIFT_CELL.test(c.name);
}

/** The stops of a shaft cell, lowest first: one per doorway level, with a spot through each doorway. */
export function liftStops(model: LiftModel, cell: number): LiftStop[] {
  const c = model.cells?.find((x) => x.index === cell);
  if (!c || !model.portals) return [];
  const stops: LiftStop[] = [];
  for (const p of c.portals ?? []) {
    if (p.passable === false) continue;
    const poly = model.portals[p.geometry];
    const target = model.cells?.find((x) => x.index === p.target);
    if (!poly || !poly.v.length || !target || p.target === 0) continue;
    const centre = new THREE.Vector3();
    let bottom = Infinity;
    for (const v of poly.v) {
      centre.x += v[0];
      centre.y += v[1];
      centre.z += v[2];
      bottom = Math.min(bottom, v[1]);
    }
    centre.divideScalar(poly.v.length);
    // Through the doorway: a step towards the room beyond, level with the sill.
    const into = new THREE.Vector3((target.bounds.min[0] + target.bounds.max[0]) / 2 - centre.x, 0, (target.bounds.min[2] + target.bounds.max[2]) / 2 - centre.z);
    if (into.lengthSq() < 1e-4) into.set(0, 0, 1);
    into.normalize();
    const at = centre.clone().addScaledVector(into, 0.8);
    at.y = bottom + 0.15;
    // Two doorways on one level (a shaft open both sides) are one stop.
    if (stops.some((s) => Math.abs(s.level - bottom) < 1)) continue;
    stops.push({ level: bottom, cell: p.target, at });
  }
  return stops.sort((a, b) => a.level - b.level);
}

/** The stop to ride to from height `y` (model space): the next up, or from the top the next down; null with fewer than two. */
export function nextStop(stops: LiftStop[], y: number): LiftStop | null {
  if (stops.length < 2) return null;
  let i = stops.findIndex((s) => Math.abs(s.level - y) < 1.5);
  if (i < 0) {
    // Between levels (fallen down the shaft): the nearest below counts as the current one.
    i = 0;
    for (let k = 0; k < stops.length; k++) if (stops[k].level <= y + 0.5) i = k;
  }
  return stops[i + 1] ?? stops[i - 1] ?? null;
}
