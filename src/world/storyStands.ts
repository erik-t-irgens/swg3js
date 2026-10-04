// The things a story stands in the world, for now its objects: a story object is a thing the world already
// places, picked by its template nearest a point (`{ id, world, template, near, reach, label }`), and E on
// it is what a job may be waiting for (`used:<object>`) or what offers one. No model is ever loaded for
// one: it is the snapshot's own terminal, sign or crate, found among what the world has standing.
//
// Finding one is a walk of the regions round its point, done once and kept: the answer is a place, which
// does not move while the world stands, so a building that streams out and back in again changes nothing.
// A thing not found yet (the pack still on its way, or nothing of that template there) is looked for again
// a little later, and everything is looked for afresh on a new world (`generation`). The people the story
// stands join this from the conversations' wave.
//
// Pure: the world is asked through `StandDeps`, so the node test hands it a world of its own. Every number
// here is ours.

import type { ObjectView } from '../story/view.ts';
import { rawToGameX, rawToGameZ } from '../story/waypoints.ts';

export const STAND_TUNE = {
  /** Metres round an object's point within which the thing of its template is looked for. */
  find: 30,
  /** Milliseconds before a thing not found is looked for again. */
  retry: 2000,
  /** Metres above or below the feet past which a thing in reach across the ground is on another floor. */
  rise: 3,
};

export interface StandDeps {
  /** The placed thing of a template nearest a point in the world's frame, within `reach` metres, or null. */
  placed(template: string, x: number, y: number, z: number, reach: number): { x: number; y: number; z: number } | null;
}

interface Found {
  gen: number;
  at: { x: number; y: number; z: number } | null;
  /** When it was looked for, for a thing not found. */
  when: number;
}

export class StoryStands {
  private readonly found = new Map<string, Found>();
  readonly stats = { looks: 0, found: 0 };

  /** Where a story object stands in the world, found and kept; null while it is not found. */
  where(o: ObjectView, gen: number, centre: { x: number; z: number } | null, y: number, now: number, deps: StandDeps): { x: number; y: number; z: number } | null {
    const had = this.found.get(o.id);
    if (had && had.gen === gen && (had.at || now - had.when < STAND_TUNE.retry)) return had.at;
    // A planet's points are in the raw frame and turned into the world's about its layout centre; a space
    // zone's are in its own frame already.
    const space = o.world.startsWith('space_');
    const cx = centre ? centre.x : 0;
    const cz = centre ? centre.z : 0;
    const x = space ? o.near[0] : rawToGameX(cx, o.near[0]);
    const z = space ? o.near[1] : rawToGameZ(cz, o.near[1]);
    this.stats.looks++;
    const at = deps.placed(o.template, x, y, z, STAND_TUNE.find);
    if (at) this.stats.found++;
    this.found.set(o.id, { gen, at: at ? { x: at.x, y: at.y, z: at.z } : null, when: now });
    return at;
  }

  /**
   * The story object the player could use from where they stand: on this world, found, within its reach
   * across the ground and on the same floor; the nearest when several are. Null when there is none.
   */
  near(objects: readonly ObjectView[], world: string, gen: number, centre: { x: number; z: number } | null, px: number, py: number, pz: number, now: number, deps: StandDeps): ObjectView | null {
    let best: ObjectView | null = null;
    let bestD = Infinity;
    for (const o of objects) {
      if (o.world !== world) continue;
      const at = this.where(o, gen, centre, py, now, deps);
      if (!at || Math.abs(at.y - py) > STAND_TUNE.rise) continue;
      const d = Math.hypot(at.x - px, at.z - pz);
      if (d > o.reach || d >= bestD) continue;
      best = o;
      bestD = d;
    }
    return best;
  }

  /** Everything forgotten (another character). */
  clear(): void {
    this.found.clear();
  }

  report(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [id, f] of this.found) out[id] = f.at ? [Math.round(f.at.x * 10) / 10, Math.round(f.at.y * 10) / 10, Math.round(f.at.z * 10) / 10] : null;
    return { found: out, stats: { ...this.stats }, tune: { ...STAND_TUNE } };
  }
}
