// Lifts: the game's elevators were objects the server spawned in shafts the buildings and ships
// model as cells named for them (elevator1, reactorlift, empelevator); no car is in the model,
// and the shaft has no floor at its upper levels. So the shaft's stops are its doorways: each
// portal out of the shaft opens at a level into a room, and riding the lift is stepping out
// through the doorway of the level picked, into the room beyond. Shafts that open into one
// another (a lobby named for the lift, a shaft split in two) share their stops.
import * as THREE from 'three';

/** What a lift needs of a model: its cells with their portals, and the portal polygons in model space. */
export interface LiftModel {
  cells?: { index: number; name: string; bounds: { min: number[]; max: number[] }; portals?: { geometry: number; target: number; passable?: boolean }[] }[];
  portals?: { v: number[][]; i: number[] }[];
}

/** A room the model names as a lift shaft (a room beside one, "elevator_room", is a room). */
export const LIFT_CELL = /^(?!.*room)(?=.*(elev|lift))/i;

export interface LiftStop {
  /** The doorway's sill height, in model space. */
  level: number;
  /** The room the doorway opens into, and its name. */
  cell: number;
  name: string;
  /** The shaft the doorway is in. */
  shaft: number;
  /** A standing spot just through the doorway, in model space. */
  at: THREE.Vector3;
}

/** Whether a model's cell is a lift shaft. */
export function isLiftCell(model: LiftModel, cell: number): boolean {
  const c = model.cells?.find((x) => x.index === cell);
  return !!c && LIFT_CELL.test(c.name);
}

/**
 * The stops a shaft reaches, lowest first: one per doorway level out of it and out of every
 * shaft it opens into, each with a spot through its doorway. Two doorways within a metre of one
 * another's level into the same room are one stop.
 */
export function liftStops(model: LiftModel, cell: number): LiftStop[] {
  const cells = model.cells ?? [];
  if (!model.portals || !isLiftCell(model, cell)) return [];
  const stops: LiftStop[] = [];
  const seen = new Set<number>();
  const queue = [cell];
  while (queue.length) {
    const shaft = queue.shift()!;
    if (seen.has(shaft)) continue;
    seen.add(shaft);
    const c = cells.find((x) => x.index === shaft);
    // A shaft split in two by name (elevator_e3_up and elevator_e3_down, far apart in a Star
    // Destroyer) is one lift: the server linked them, and so does this.
    const pair = /^(.*)_(up|down)$/i.exec(c?.name ?? '');
    if (pair) for (const other of cells) if (other.index !== shaft && new RegExp(`^${pair[1]}_(up|down)$`, 'i').test(other.name)) queue.push(other.index);
    for (const p of c?.portals ?? []) {
      if (p.passable === false || p.target === 0) continue;
      const target = cells.find((x) => x.index === p.target);
      const poly = model.portals[p.geometry];
      if (!target || !poly || !poly.v.length) continue;
      if (LIFT_CELL.test(target.name)) {
        queue.push(p.target);
        continue;
      }
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
      if (stops.some((s) => s.cell === p.target && Math.abs(s.level - bottom) < 1)) continue;
      stops.push({ level: bottom, cell: p.target, name: target.name, shaft, at });
    }
  }
  return stops.sort((a, b) => a.level - b.level);
}

/** Which stop a height (model space) is at, or -1 between levels. */
export function stopAt(stops: LiftStop[], y: number): number {
  let best = -1;
  let bestD = 1.5;
  stops.forEach((s, i) => {
    const d = Math.abs(s.level - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** A stop's label for the menu: the room's name and its height above the lowest stop. */
export function stopLabel(stops: LiftStop[], i: number): string {
  const s = stops[i];
  const base = stops[0]?.level ?? s.level;
  const up = s.level - base;
  return `${s.name.replace(/_/g, ' ')}${up > 0.5 ? ` · ${up.toFixed(0)} m up` : ''}`;
}
