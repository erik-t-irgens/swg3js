// The room pool's lights, worked out apart from the pool (`World.updateInteriorLights` hands them out), so a node test runs the
// very rule a room is lit by (Map-maker II's eleventh wave, whose imported houses are lit by it): which cells' lights light
// the room someone stands in and in what order (the room's own first, then each room its doorways open on, in its doorways'
// order, a room two doorways open on twice), the ambient (a floor of the world's, and every room's own fill added to it in
// that order), the first parallel light, and each point light's brightness at 3 m and its range by the game's own rule.
//
// The rule is the game's, read off the client's lights' Direct3D constants (`1 / (c + l d + q d^2)`): a light's value at 3 m,
// and its range, the first whole metre past which it falls under a twentieth of that, held to 40. Nothing here is ours but
// the cap (`INTERIOR_LIGHT_CAP`, the pool's size) and the floor the caller hands in.
//
// Rule for this file (node runs it with type stripping for the tests): every value import with its `.ts` extension, no
// constructor parameter properties, nothing that touches the page at load.
import type { CellLight } from './assetPack.ts';

/** How many point lights the room pool lights at once: the pool's own lights, made once and never added to. */
export const INTERIOR_LIGHT_CAP = 8;

/** A point light's value at 3 m by its constants, held at a twentieth (`1 / max(0.05, c + 3 l + 9 q)`). */
export function pointLightAt3(att: readonly number[]): number {
  const c = att[0];
  const li = att[1];
  const q = att[2];
  return 1 / Math.max(0.05, c + 3 * li + 9 * q);
}

/**
 * A point light's range by the game's rule: Direct3D falloff `1 / (c + l d + q d^2)` matched at 3 m to three's `I / d^2`,
 * cut at the first whole metre where it fades below 5% of that, and 40 where it never does.
 */
export function pointLightRange(att: readonly number[]): number {
  const c = att[0];
  const li = att[1];
  const q = att[2];
  const at3 = 1 / Math.max(0.05, c + 3 * li + 9 * q);
  for (let d = 1; d <= 40; d++) {
    if (1 / (c + li * d + q * d * d) < at3 * 0.05) return d;
  }
  return 40;
}

/** A cell as the room pool reads it: its index, the rooms its doorways open on, its own lights. */
export interface RoomLightCell {
  index: number;
  portals?: readonly { target: number }[];
  lights?: readonly CellLight[];
}

/** One point light the pool lights: the cell it is of, the light, its value at 3 m and its range. */
export interface RoomPoint {
  cell: number;
  light: CellLight;
  at3: number;
  range: number;
}

/** What lights a room: the ambient, the one parallel light (the first met), and the point lights, at most the pool's. */
export interface RoomLightPlan {
  ambient: [number, number, number];
  parallel: CellLight | null;
  points: RoomPoint[];
}

/**
 * The lights of the room `cell` of a building's `cells` and the rooms its doorways open on, in the pool's order; null for a
 * room the building has not got. `ambientFloor` is where the ambient starts (rooms are never pitch black), every room's own
 * fill (a type-0 light) added to it in the order met; the first parallel light (type 1) is the room's; every other light is a
 * point, up to `cap`.
 */
export function roomLightPlan(cells: readonly RoomLightCell[], cell: number, ambientFloor: number, cap = INTERIOR_LIGHT_CAP): RoomLightPlan | null {
  const current = cells.find((c) => c.index === cell);
  if (!current) return null;
  const order = [cell, ...(current.portals ?? []).map((p) => p.target).filter((t) => t > 0 && t !== cell)];
  const ambient: [number, number, number] = [ambientFloor, ambientFloor, ambientFloor];
  let parallel: CellLight | null = null;
  const points: RoomPoint[] = [];
  for (const index of order) {
    const c = cells.find((x) => x.index === index);
    for (const l of c?.lights ?? []) {
      if (l.type === 0) {
        ambient[0] += l.color[0];
        ambient[1] += l.color[1];
        ambient[2] += l.color[2];
        continue;
      }
      if (l.type === 1) {
        if (!parallel) parallel = l;
        continue;
      }
      if (points.length >= cap) continue;
      points.push({ cell: index, light: l, at3: pointLightAt3(l.attenuation), range: pointLightRange(l.attenuation) });
    }
  }
  return { ambient, parallel, points };
}
