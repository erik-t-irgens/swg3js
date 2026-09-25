// The people who stand somewhere and stay there.
//
// These are not the wildlife and the difference runs all the way through. A lair is a shape with a
// weighted list and a cap, and where its animals stand is drawn from a seed on this side because
// nobody knows where the server put them. A standing person is the opposite: every one of the 4,619
// rows is a real place the real server used, read out of its own screenplays, with its own facing
// and its own respawn in seconds. Nothing here is invented except how near you have to be.
//
// **Half of them are indoors**, and that is the whole reason this is a file of its own rather than
// another branch of the wild pass. A row inside a building carries the room it stands in, and the
// converter has already carried its position out of that room's own frame into the world; what is
// left is to stand it in the right cell, which a lair never has to do.
//
// Pure of three and of rapier: it asks the game for everything, so a node test can be the game.

import * as THREE from 'three';
import type { MobileCatalogue } from './mobiles/catalogue.ts';
import type { MobileEntry } from './mobiles/types.ts';
import type { Mobile } from './mobiles/mobile.ts';

/** One person, as the converter wrote them. Positions are already in the world's own frame. */
export interface StandingRow {
  who: string;
  id: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** The emulator's own id for the cell, or 0 outdoors. Kept for the report, never resolved here. */
  cell: number;
  /** Which room of its building, where the converter could resolve it; absent outdoors. */
  room?: number | null;
  /** Seconds before they come back. The data's own, and four in five of them are five minutes. */
  respawn: number;
  /** Which part of the world's life this is: a cave, a point of interest, a town, a dungeon. */
  where: string;
}

/** What standing people need of the game. */
export interface PeopleDeps {
  catalogue(): MobileCatalogue | null;
  /** Stand one. `inside` is true for a person in a room, which changes how the ground is found. */
  spawn(entry: MobileEntry, at: { x: number; z: number; y?: number; heading?: number }, inside: boolean, seed: number): Mobile | string;
  remove(m: Mobile): void;
  centre(): { x: number; z: number } | null;
  held(): boolean;
  /**
   * Whether the building a room belongs to is really built here yet.
   *
   * A person stood in a cantina before its cell exists has no floor and falls through the world, so
   * the pass waits. Null where the game cannot say, which is taken as "yes" -- an outdoor world
   * with no streaming has no cells to wait for.
   */
  cellReady?(x: number, y: number, z: number): boolean | null;
}

/**
 * Every invented number here. There are only four, because everything else is the server's.
 * Live through `__debug.people`.
 */
export const PEOPLE_TUNE = {
  /** Stood within this, put away past `drop`. Tighter than the lairs': a town is dense. */
  build: 110,
  drop: 190,
  /** Most standing at once, and most stood in one pass. */
  most: 22,
  perPass: 3,
  /** How often the pass runs, in seconds of the world's own clock. */
  everySeconds: 1.5,
  /** How far the player must move before it looks again. */
  moveMetres: 15,
};

interface Stood {
  row: StandingRow;
  body: Mobile | null;
  /** When it died, on the world's own clock; 0 while it is up. */
  diedAt: number;
}

export class StandingPeople {
  private rows: StandingRow[] = [];
  private readonly up = new Map<number, Stood>();
  private since = 0;
  private readonly lastAt = new THREE.Vector3(NaN, NaN, NaN);
  readonly last = { rows: 0, up: 0, indoors: 0, stood: 0, dropped: 0, waiting: 0, refused: '' };

  get ready(): boolean {
    return this.rows.length > 0;
  }

  /** Take the rows a pack carries. Only those that reach a body, and only those really placed. */
  adopt(rows: readonly StandingRow[] | null | undefined): void {
    this.rows = [];
    this.up.clear();
    for (const r of rows ?? []) {
      // A row indoors whose room could not be resolved is a position in a cell and nowhere on a
      // planet: the converter leaves those out, and this refuses any that slip through.
      if (r.cell && (r.room === null || r.room === undefined)) continue;
      this.rows.push(r);
    }
    this.last.rows = this.rows.length;
    this.last.up = 0;
  }

  clear(deps?: PeopleDeps): void {
    if (deps) for (const s of this.up.values()) if (s.body) deps.remove(s.body);
    this.up.clear();
    this.last.up = 0;
    this.last.indoors = 0;
  }

  unload(): void {
    this.rows = [];
    this.up.clear();
    this.last.rows = 0;
    this.last.up = 0;
    this.last.indoors = 0;
  }

  /**
   * One pass.
   *
   * `now` is the world's own clock, which every respawn keys off, so `__debug.advance` drives it.
   */
  step(dt: number, now: number, at: THREE.Vector3, deps: PeopleDeps): void {
    this.last.stood = 0;
    this.last.dropped = 0;
    this.last.waiting = 0;
    if (!this.ready || deps.held()) return;
    const cat = deps.catalogue();
    if (!cat) return;
    this.since += dt;
    const moved = !Number.isFinite(this.lastAt.x) || this.lastAt.distanceTo(at) > PEOPLE_TUNE.moveMetres;
    if (this.since < PEOPLE_TUNE.everySeconds && !moved) return;
    this.since = 0;
    this.lastAt.copy(at);

    // The dead first, so a place somebody cleared fills again on its own time.
    for (const [i, s] of this.up) {
      // **The clock is checked whether or not the body is still here.** Nulling it and then skipping
      // the rest of the loop on a null body is how a dead row waits for ever: the first pass takes
      // the body away, and every pass after that steps over the very record it is waiting on.
      if (s.body && (s.body.dead || s.body.removed)) {
        // Killed is not the same as taken away here either, but the answer is the same both ways: a
        // row is stood again once its own wait is out, and the wait is the server's own number.
        if (s.diedAt === 0) s.diedAt = now;
        s.body = null;
      }
      if (s.diedAt > 0 && now - s.diedAt >= Math.max(1, s.row.respawn)) this.up.delete(i);
    }

    let stood = 0;
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      const away = Math.hypot(r.x - at.x, r.z - at.z);
      const here = this.up.get(i);
      if (here) {
        // Never dropped while still near: somebody you are fighting does not vanish.
        if (away > PEOPLE_TUNE.drop) {
          if (here.body) deps.remove(here.body);
          this.up.delete(i);
          this.last.dropped++;
        }
        continue;
      }
      if (away > PEOPLE_TUNE.build || this.up.size >= PEOPLE_TUNE.most || stood >= PEOPLE_TUNE.perPass) continue;
      const inside = !!r.cell;
      // A person in a room whose building is not built yet waits rather than falling through it.
      if (inside && deps.cellReady?.(r.x, r.y, r.z) === false) {
        this.last.waiting++;
        continue;
      }
      const entry = cat.byId(r.id);
      if (!entry) continue;
      // Indoors the height is the floor's and is given, because the converter worked it out from the
      // room's own frame and the manager's own ground lookup would find the terrain under the
      // building instead. Outdoors no height is given, for the reason the wildlife learned.
      const spot = inside ? { x: r.x, z: r.z, y: r.y, heading: r.heading } : { x: r.x, z: r.z, heading: r.heading };
      const m = deps.spawn(entry, spot, inside, i);
      if (typeof m === 'string') {
        this.last.refused = m;
        continue;
      }
      // They stand where they were put. A person placed by the server is not a wanderer: their home
      // is their own spot, so the brain's roaming keeps them about it rather than walking them off.
      m.homeX = r.x;
      m.homeZ = r.z;
      this.up.set(i, { row: r, body: m, diedAt: 0 });
      stood++;
      this.last.stood++;
    }
    this.count();
  }

  private count(): void {
    this.last.up = this.up.size;
    let inside = 0;
    for (const s of this.up.values()) if (s.row.cell) inside++;
    this.last.indoors = inside;
  }

  /** For the console: who is standing, nearest first. */
  report(at: THREE.Vector3): { who: string; where: string; room: number | null; away: number; up: boolean; dead: boolean }[] {
    const out: { who: string; where: string; room: number | null; away: number; up: boolean; dead: boolean }[] = [];
    for (const s of this.up.values()) {
      out.push({
        who: s.row.who,
        where: s.row.where,
        room: s.row.cell ? (s.row.room ?? null) : null,
        away: Math.round(Math.hypot(s.row.x - at.x, s.row.z - at.z)),
        up: !!s.body,
        dead: s.diedAt > 0,
      });
    }
    return out.sort((a, b) => a.away - b.away);
  }

  /** For the console: the rows nearest a point, standing or not. */
  nearest(at: THREE.Vector3, n = 5): { who: string; where: string; x: number; z: number; indoors: boolean; away: number }[] {
    return this.rows
      .map((r) => ({ who: r.who, where: r.where, x: Math.round(r.x), z: Math.round(r.z), indoors: !!r.cell, away: Math.round(Math.hypot(r.x - at.x, r.z - at.z)) }))
      .sort((a, b) => a.away - b.away)
      .slice(0, n);
  }
}

/** The one for the session. */
export const standingPeople = new StandingPeople();
