// How far the world loads around whoever plays, held from the console past what the Graphics page
// allows (`__debug.reach`).
//
// The page keeps its sliders to ranges that run well on an ordinary machine: placed objects at 0.4 to
// 1.6 times the game's own tier ranges, 3 to 9 ground chunks of 64 m and 3 to 9 far tiles of 512 m.
// The plumbing under them clamps nothing (`World.setReach` and `LayoutStreamer.setReach` are plain
// multipliers), so the console can ask for more -- every building on a planet, the ground detailed a
// kilometre out -- at a cost the answer says in numbers. What the console asks for is **held**: a
// slider moved afterwards changes the setting and leaves a held axis where the console put it, so a
// test of a long reach is not quietly undone by somebody touching the page. Releasing hands each axis
// back to the setting.
//
// Pure: no three and nothing that touches the page, so a node test runs it as the game does.

import { PLACED_TIERS } from './placedTiers.ts';

/** One reach: placed objects as a multiple of the tiers' ranges, ground chunks and far tiles each way. */
export interface Reach {
  objects: number;
  terrain: number;
  far: number;
}

/** What the console holds: an axis it has not asked for is null and follows the setting. */
export interface ReachHold {
  objects: number | null;
  terrain: number | null;
  far: number | null;
}

/** The settings' three numbers, as they are named there. */
export interface ReachSettings {
  objectReach: number;
  terrainRadius: number;
  farRadius: number;
}

/**
 * The Graphics page's own top of each slider (`menu.ts`'s Distance and detail section; the node test
 * reads that file and fails if the two disagree). Past them a reach is the console's and the answer
 * warns about what it costs.
 */
export const MENU_REACH_TOP: Reach = { objects: 1.6, terrain: 9, far: 9 };

/**
 * The least each axis may be, which is what keeps a typo from emptying the world rather than a limit
 * on how far it may reach (there is none). Ours: a twentieth of the tiers' ranges is still a street,
 * and one chunk and one far tile each way is the smallest ground the streaming still covers.
 */
export const REACH_FLOOR: Reach = { objects: 0.05, terrain: 1, far: 1 };

export function emptyHold(): ReachHold {
  return { objects: null, terrain: null, far: null };
}

/** Whether anything at all is held. */
export function holding(h: ReachHold): boolean {
  return h.objects !== null || h.terrain !== null || h.far !== null;
}

/** The reach in force: each held axis, else the setting's. */
export function reachInForce(h: ReachHold, s: ReachSettings): Reach {
  return { objects: h.objects ?? s.objectReach, terrain: h.terrain ?? s.terrainRadius, far: h.far ?? s.farRadius };
}

/** What the console may pass for one axis: a number to hold, null to hand it back, anything else left alone. */
export type ReachAsk = number | null | undefined;

/**
 * The console's ask laid onto the hold. A number holds its axis (raised to the floor, and the ground's
 * two counted in whole chunks and tiles, as the world counts them), null hands the axis back, and
 * anything else -- an axis not named, a word, a NaN -- leaves it as it was. The answer is what was
 * refused, in words, which is empty when everything was taken.
 */
export function askReach(h: ReachHold, ask: { objects?: ReachAsk; terrain?: ReachAsk; far?: ReachAsk; release?: boolean }): string[] {
  const refused: string[] = [];
  if (ask.release) {
    h.objects = null;
    h.terrain = null;
    h.far = null;
  }
  const one = (key: keyof Reach, v: unknown): void => {
    if (v === undefined) return;
    if (v === null) {
      h[key] = null;
      return;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      refused.push(`${key}: ${String(v)} is not a number`);
      return;
    }
    const floor = REACH_FLOOR[key];
    const n = key === 'objects' ? v : Math.round(v);
    h[key] = Math.max(floor, n);
    if (n < floor) refused.push(`${key}: ${v} is under the least it may be, so it is ${floor}`);
  };
  one('objects', ask.objects);
  one('terrain', ask.terrain);
  one('far', ask.far);
  return refused;
}

/**
 * What a reach costs, in words, for each axis past the page's own top: the answer carries these so a
 * long reach says what it is doing to the frame rather than leaving it to be found out.
 */
export function reachWarnings(r: Reach): string[] {
  const out: string[] = [];
  if (r.objects > MENU_REACH_TOP.objects) {
    out.push(`objects at ${r.objects}x load ${(r.objects / MENU_REACH_TOP.objects).toFixed(1)} times as far as the page allows: the biggest buildings load from ${Math.round(PLACED_TIERS[0].range * r.objects)} m, every model new to it is compiled through the queue as it streams in, and memory grows with what stands`);
  }
  if (r.terrain > MENU_REACH_TOP.terrain) {
    const chunks = (2 * r.terrain + 1) ** 2;
    out.push(`ground detail at ${r.terrain} chunks each way is ${chunks} chunks (${((chunks / (2 * MENU_REACH_TOP.terrain + 1) ** 2)).toFixed(1)} times the page's most), every one carrying its own plants; plants past their own reach are hidden still, and flora({ reach: false }) lifts that`);
  }
  if (r.far > MENU_REACH_TOP.far) out.push(`far ground at ${r.far} tiles each way reaches ${(r.far * 0.512).toFixed(1)} km; the camera's far plane is 9 km, so tiles past it are built and never seen`);
  return out;
}

/** The sentence said when a slider moves an axis the console is holding; '' when it is not held. */
export function heldAxisNote(h: ReachHold, key: keyof ReachSettings): string {
  const axis: keyof Reach = key === 'objectReach' ? 'objects' : key === 'terrainRadius' ? 'terrain' : 'far';
  const v = h[axis];
  if (v === null) return '';
  const name = axis === 'objects' ? 'Object reach' : axis === 'terrain' ? 'Ground detail radius' : 'Far ground radius';
  return `${name} is held at ${v} from the console; __debug.reach({ release: true }) hands it back to this setting`;
}
