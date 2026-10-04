// The things a story stands in the world: its objects and its people.
//
// A story object is a thing the world already places, picked by its template nearest a point (`{ id, world,
// template, near, reach, label }`), and E on it is what a job may be waiting for (`used:<object>`) or what
// offers one. No model is ever loaded for one: it is the snapshot's own terminal, sign or crate, found among
// what the world has standing. Finding one is a walk of the regions round its point, done once and kept: the
// answer is a place, which does not move while the world stands, so a building that streams out and back in
// again changes nothing. A thing not found yet (the pack still on its way, or nothing of that template there)
// is looked for again a little later, and everything is looked for afresh on a new world (`generation`).
//
// **The cast** are the story's named people (the view's `cast`, every one whose `stand` holds): each is stood
// by this browser, for this browser's player alone, when the player comes within `castNear` of where the
// story puts them on the world they stand on, and taken down past `castFar`, when the story stops standing
// them, or on another world. They are stood through the world's own prepared path (`World.standMobile` with
// `cast`), so a body is out of sight until its programs are built and nothing compiles on a live frame. A
// person who gives their name mid-conversation is renamed where they stand. One in a room is stood on that
// room's floor once a building near the point with a cell of that name has streamed in.
//
// Pure: the world is asked through `StandDeps` and `CastDeps`, so the node test hands it a world of its own.
// Every number here is ours.

import type { CastView, ObjectView } from '../story/view.ts';
import { rawToGameX, rawToGameZ } from '../story/waypoints.ts';

export const STAND_TUNE = {
  /** Metres round an object's point within which the thing of its template is looked for. */
  find: 30,
  /** Milliseconds before a thing not found is looked for again. */
  retry: 2000,
  /** Metres above or below the feet past which a thing in reach across the ground is on another floor. */
  rise: 3,
  /** Metres across the ground within which a cast member is stood. */
  castNear: 120,
  /** Metres past which one stood is taken down again (more than `castNear`, so walking the edge does not stand and drop them). */
  castFar: 180,
  /** Milliseconds before a cast member the world would not stand (no floor yet, the budget full) is asked for again. */
  castRetry: 3000,
};

/** A body stood for a cast member, as standing it needs to know it. */
export interface CastBody {
  readonly removed: boolean;
  label: string;
  rename(name: string): void;
}

/** What standing the cast asks of the world. */
export interface CastDeps {
  /** Stand one at a point in the world's frame (with the floor's height when in a room), facing `heading` (radians); null when the world would not. */
  stand(c: CastView, x: number, z: number, y: number | null, heading: number, name: string): CastBody | null;
  /** Take one back down. */
  unstand(b: CastBody): void;
  /** The floor's height where a cast member in a room stands, or null while its building has not streamed in. */
  roomFloor(c: CastView, x: number, z: number): number | null;
  /** The words a name stands for. */
  text(name: CastView['name']): string;
}

interface Stood {
  body: CastBody;
  gen: number;
}

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
  /** The cast stood, by id. */
  private readonly stood = new Map<string, Stood>();
  /** When the world last would not stand a cast member, by id. */
  private readonly refusedAt = new Map<string, number>();
  readonly stats = { looks: 0, found: 0, castStood: 0, castDown: 0, castRefused: 0, renamed: 0 };

  /**
   * Stand the cast near the player and take down the rest, a few times a second: `px`, `pz` are the player in
   * the world's frame, `centre` the layout centre a planet's raw places are turned about. Nothing is made on a
   * pass that changes nothing.
   */
  stepCast(cast: readonly CastView[], world: string, gen: number, centre: { x: number; z: number } | null, px: number, pz: number, now: number, deps: CastDeps): void {
    const cx = centre ? centre.x : 0;
    const cz = centre ? centre.z : 0;
    // Down first: another world, a cast member the story no longer stands, too far, or a body gone.
    for (const [id, s] of this.stood) {
      let c: CastView | null = null;
      for (const x of cast) if (x.id === id) c = x;
      let gone = !c || s.gen !== gen || c.world !== world || s.body.removed;
      if (c && !gone) {
        const space = c.world.startsWith('space_');
        const x = space ? c.at[0] : rawToGameX(cx, c.at[0]);
        const z = space ? c.at[1] : rawToGameZ(cz, c.at[1]);
        gone = Math.hypot(x - px, z - pz) > STAND_TUNE.castFar;
      }
      if (!gone) {
        // A name given mid-conversation is the name they go by from now on.
        const name = deps.text(c!.name);
        if (s.body.label !== name) {
          s.body.rename(name);
          this.stats.renamed++;
        }
        continue;
      }
      if (!s.body.removed && s.gen === gen) deps.unstand(s.body);
      this.stood.delete(id);
      this.stats.castDown++;
    }
    for (const c of cast) {
      if (c.world !== world || this.stood.has(c.id)) continue;
      const space = c.world.startsWith('space_');
      const x = space ? c.at[0] : rawToGameX(cx, c.at[0]);
      const z = space ? c.at[1] : rawToGameZ(cz, c.at[1]);
      if (Math.hypot(x - px, z - pz) > STAND_TUNE.castNear) continue;
      const was = this.refusedAt.get(c.id);
      if (was !== undefined && now - was < STAND_TUNE.castRetry) continue;
      let y: number | null = null;
      if (c.room) {
        y = deps.roomFloor(c, x, z);
        if (y === null) {
          this.refusedAt.set(c.id, now);
          continue;
        }
      }
      // A planet's heading is in the raw frame, which mirrors X: turned into the world's as its places are.
      const heading = ((space ? c.heading : -c.heading) * Math.PI) / 180;
      const body = deps.stand(c, x, z, y, heading, deps.text(c.name));
      if (!body) {
        this.refusedAt.set(c.id, now);
        this.stats.castRefused++;
        continue;
      }
      this.refusedAt.delete(c.id);
      this.stood.set(c.id, { body, gen });
      this.stats.castStood++;
    }
  }

  /** The cast member a body was stood for, or null for anybody else. */
  castOf(body: unknown): string | null {
    for (const [id, s] of this.stood) if (s.body === body) return id;
    return null;
  }

  /** The body stood for a cast member, or null. */
  bodyOf(id: string): CastBody | null {
    return this.stood.get(id)?.body ?? null;
  }

  /** Every cast member taken down (another character), through `unstand` while the world they stood in is up. */
  clearCast(unstand: ((b: CastBody) => void) | null, gen?: number): void {
    for (const s of this.stood.values()) if (unstand && !s.body.removed && (gen === undefined || s.gen === gen)) unstand(s.body);
    this.stood.clear();
    this.refusedAt.clear();
  }

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

  /** Every object's place forgotten (another character, another world); the cast is `clearCast`'s. */
  clear(): void {
    this.found.clear();
  }

  report(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [id, f] of this.found) out[id] = f.at ? [Math.round(f.at.x * 10) / 10, Math.round(f.at.y * 10) / 10, Math.round(f.at.z * 10) / 10] : null;
    const cast: Record<string, string> = {};
    for (const [id, s] of this.stood) cast[id] = s.body.label;
    return { found: out, cast, stats: { ...this.stats }, tune: { ...STAND_TUNE } };
  }
}
