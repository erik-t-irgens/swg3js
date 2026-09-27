// The people who stand somewhere and stay there.
//
// These are not the wildlife and the difference runs all the way through. A lair is a shape with a
// weighted list and a cap, and where its animals stand is drawn from a seed on this side because
// nobody knows where the server put them. A standing person is the opposite: every row is a real
// place the real server used, read out of its own screenplays, with its own facing and its own
// respawn in seconds. Nothing here is invented except how near you have to be, how many stand at
// once, how much nearer somebody must be to take another's place and how far one steps about its
// spot.
//
// **What a town's row says about the one standing there is the server's, and is kept.** Pack format 2
// says which rows the town stood with its brain off (`still`: they never wander) and which it made
// unattackable whatever body it drew (`peaceful`: part of the furniture), and each row's own creature
// carries its temper and whether it may be struck. The body's catalogue entry is one creature's out of
// every one drawn as that body, so read alone it had a town's guards, jawas and trainers taking the
// tempers of whoever else once wore their bodies: the towns opened fire on anybody walking in.
//
// **Half of them are indoors**, and that is the whole reason this is a file of its own rather than
// another branch of the wild pass. A row inside a building carries the room it stands in, and the
// converter has already carried its position and its facing out of that room's own frame into the
// snapshot's (`intoRoom` in `tools/swg/core3.mjs`; a pack written before the facing was carried faces
// everybody in a turned building off by that building's yaw, and `status` asks for it again); what is
// left is to stand it in the right cell, which a lair never has to do.
//
// **The rows are in the snapshot's frame and the world is not.** Every placed object goes through
// `LayoutStreamer`'s mirror -- `gx = -(x - centre.x)`, `gz = z - centre.z` -- and so do these, once,
// on the first pass that knows the layout's centre, with the heading negated beside them (a mirror
// in x turns a yaw into its negative). Until that was done every one of the 4,619 stood on the
// wrong side of its planet: outdoors on empty ground, and indoors nowhere at all, since a cantina's
// floor is not where its mirror image is. It escaped notice because the console's `go` walked the
// player to the same wrong spot and always found somebody standing there.
//
// Pure of three and of rapier: it asks the game for everything, so a node test can be the game.

import * as THREE from 'three';
import type { MobileCatalogue } from './mobiles/catalogue.ts';
import type { MobileEntry } from './mobiles/types.ts';
import type { Mobile } from './mobiles/mobile.ts';
import type { Post } from './mobiles/brain.ts';
import type { Aggression } from '../combat/kit.ts';
import { intoWorld, tuneTable } from './wildLife.ts';

/**
 * One person, as the converter wrote them: x and z in the snapshot's frame, as every placed object
 * is. The height is the snapshot's too, which is the world's, since the mirror is in x alone.
 */
export interface StandingRow {
  who: string;
  id: string;
  x: number;
  y: number;
  z: number;
  /** The way they face, `atan2(x, z)` in the snapshot's frame, indoors as well as out (see the head of this file). */
  heading: number;
  /** The emulator's own id for the cell, or 0 outdoors. Kept for the report, never resolved here. */
  cell: number;
  /** Which room of its building, where the converter could resolve it; absent outdoors. */
  room?: number | null;
  /**
   * Seconds before they come back. The data's own, and four in five of them are five minutes. **Nought
   * is never**: the server ran a body's timer only when it was above nought, so a row written with
   * nought (a bunker's boss, a trainer, an event's visitor) stays down once killed.
   */
  respawn: number;
  /** Which part of the world's life this is: a cave, a point of interest, a town, a dungeon. */
  where: string;
  /** Pack format 2: the town stood it with its brain off, so it never wanders from its spot. */
  still?: boolean;
  /** Pack format 2: the town made it unattackable whatever body it drew (its stationary crowd, its strolling patrols). */
  peaceful?: boolean;
  /**
   * Its own creature's temper and whether that creature may be struck at all, out of the pack's fleet
   * half (format 2's `game`), put on the row when it is taken (`adopt`). A body is shared by every
   * creature drawn as it and its catalogue entry carries only one of their tempers, which is how a
   * town's trainer could stand as a body somebody's hired gun once wore.
   */
  temper?: Aggression;
  strikeable?: boolean;
}

/** What a creature the rows name is by its own numbers, as far as standing it needs: format 2's `game`. */
export interface PeopleCreature {
  game?: { aggression?: unknown; attackable?: unknown };
}

const TEMPERS: readonly Aggression[] = ['passive', 'skittish', 'defensive', 'aggressive'];

/**
 * Whether a standing person is part of the furniture: stands where they were stood, takes no
 * damage, never dies, never picks a fight and never wanders.
 *
 * **Read, not invented.** The emulator's own row carries the pvp status bitmask the server ran them
 * with, and a body with no ATTACKABLE bit is one no player could ever have struck: a vendor, a
 * trainer, a quest-giver, a shopkeeper. Measured over all 4,619 standing people in the game there
 * are exactly 518 of them, and the number matches `aggression: passive` one for one, which is two
 * independent fields of the same data agreeing.
 *
 * A catalogue built without a checkout carries no `core3` block at all; then nobody is essential and
 * every one of them behaves as they did before this existed, which is the honest default.
 */
export function standsStill(entry: MobileEntry | null | undefined): boolean {
  const pvp = entry?.stats?.core3?.pvp;
  if (!Array.isArray(pvp)) return false;
  return !pvp.some((bit) => /attackable/i.test(bit));
}

/** What standing people need of the game. */
export interface PeopleDeps {
  catalogue(): MobileCatalogue | null;
  /**
   * Stand one. `at` is in the world's own frame. `inside` is true for a person in a room, which
   * changes how the ground is found, `essential` for one the server marked unattackable (see
   * `standsStill`), and `temper` its own creature's temper where the row knows it, over its body's.
   */
  spawn(entry: MobileEntry, at: { x: number; z: number; y?: number; heading?: number }, inside: boolean, seed: number, essential: boolean, temper?: Aggression): Mobile | string;
  remove(m: Mobile): void;
  /**
   * How many bytes the model memory budget is short of standing `entry` now (nought when it fits), and
   * how many putting one body down would give back. Both or neither: with them a full budget is a
   * reason to put somebody farther off down, as a full cap is; without them it refuses as it did.
   */
  short?(entry: MobileEntry): number;
  frees?(m: Mobile): number;
  /** The layout's centre, which the rows are measured from; null before the pack lands, and then nothing stands. */
  centre(): { x: number; z: number } | null;
  held(): boolean;
  /**
   * Whether the building a room belongs to is really built here yet, asked in the world's frame.
   *
   * A person stood in a cantina before its cell exists has no floor and falls through the world, so
   * the pass waits. Null where the game cannot say, which is taken as "yes" -- an outdoor world
   * with no streaming has no cells to wait for.
   */
  cellReady?(x: number, y: number, z: number): boolean | null;
}

/**
 * Every invented number here; everything else is the server's. Live through `__debug.people`.
 */
export const PEOPLE_TUNE = {
  /** Stood within this, put away past `drop`. Tighter than the lairs': a town is dense. */
  build: 110,
  drop: 190,
  /** Most standing at once, nearest first, and most stood in one pass. `most` is the owner's number. */
  most: 40,
  perPass: 3,
  /**
   * With the cap full, how much nearer a row in range must be than the farthest person standing
   * before that person is put down to make room for it, metres. Without it the cap was nearest first
   * only for a player who stood still: people stood on the way in were kept until they were `drop`
   * behind, so walking into a town left the room you walked into empty while the street behind you
   * stood. The margin is what keeps two people at nearly the same distance from swapping places on
   * every pass as the player shuffles about.
   */
  swapMargin: 20,
  /** How often the pass runs, in seconds of the world's own clock. */
  everySeconds: 1.5,
  /** How far the player must move before it looks again. */
  moveMetres: 15,
  /**
   * How far a person may step about the spot the data put them on, metres, and how often, seconds.
   * The brain's own wander is eight to thirty metres every three to eight seconds, which is an animal
   * ranging over open ground; a person at a counter went walking off it into the street.
   */
  postRadius: 3,
  postEvery: [8, 20] as [number, number],
  /**
   * Whether the dead come back at all. Off, a person killed stays killed for the life of the world,
   * whether or not the player walks away and back; on again, each comes back on its own clock. One
   * the game merely took away rather than killed comes back on its clock either way.
   */
  respawns: true,
};

interface Stood {
  row: StandingRow;
  body: Mobile | null;
  /** When it died or was taken away, on the world's own clock; 0 while it is up. */
  diedAt: number;
  /**
   * Whether it was really killed, as against taken away by the game (fallen out of the world, say).
   * Only a kill is remembered while respawning is off: see the dead loop in `step`.
   */
  killed: boolean;
}

export class StandingPeople {
  private rows: StandingRow[] = [];
  /** Whether the rows have been carried into the world's frame yet (see the head of this file). */
  private framed = false;
  private readonly up = new Map<number, Stood>();
  private since = 0;
  private readonly lastAt = new THREE.Vector3(NaN, NaN, NaN);
  /**
   * The rows in range this pass and how far each is, kept rather than made per pass, and the one
   * comparator that sorts them: the cap is filled nearest first, not in the file's order, which had
   * forty people standing fifty to seventy metres off while the ones beside the player never stood.
   */
  private readonly near: number[] = [];
  private away = new Float64Array(0);
  private readonly nearer = (a: number, b: number): number => this.away[a] - this.away[b];
  private readonly farther = (a: number, b: number): number => this.away[b] - this.away[a];
  /** Kept lists for making room in the memory budget (`makeMemory`): who could go, and who does. */
  private readonly spare: number[] = [];
  private readonly chosen: number[] = [];
  /**
   * `up` is the bodies standing, `down` the dead waiting to come back; `stood`, `dropped`, `swapped`
   * (put down to make room for somebody nearer) and `waiting` are what the last pass that really ran
   * did, and are left alone by a step that returns before it looks -- reset at the top of every
   * step, they read nought almost always.
   */
  readonly last = { rows: 0, up: 0, down: 0, indoors: 0, stood: 0, dropped: 0, swapped: 0, waiting: 0, refused: '' };

  get ready(): boolean {
    return this.rows.length > 0;
  }

  /**
   * Take the rows a pack carries. Only those that reach a body, and only those really placed. Each
   * is copied, since the pass carries its own into the world's frame and the pack's are left as the
   * pack wrote them.
   *
   * `creatures` is the pack's fleet half, where each row's own creature carries its temper and
   * whether it may be struck (format 2); a row whose creature says neither stands as its body does.
   */
  adopt(rows: readonly StandingRow[] | null | undefined, creatures?: Readonly<Record<string, PeopleCreature>> | null): void {
    this.rows = [];
    this.up.clear();
    this.framed = false;
    for (const r of rows ?? []) {
      // A row indoors whose room could not be resolved is a position in a cell and nowhere on a
      // planet: the converter leaves those out, and this refuses any that slip through.
      if (r.cell && (r.room === null || r.room === undefined)) continue;
      const row: StandingRow = { ...r };
      const game = creatures && Object.prototype.hasOwnProperty.call(creatures, r.who) ? creatures[r.who]?.game : undefined;
      if (game && TEMPERS.includes(game.aggression as Aggression)) row.temper = game.aggression as Aggression;
      if (game && typeof game.attackable === 'boolean') row.strikeable = game.attackable;
      this.rows.push(row);
    }
    this.away = new Float64Array(this.rows.length);
    this.near.length = 0;
    this.lastAt.set(NaN, NaN, NaN);
    this.last.rows = this.rows.length;
    this.last.up = 0;
    this.last.down = 0;
  }

  clear(deps?: PeopleDeps): void {
    if (deps) for (const s of this.up.values()) if (s.body) deps.remove(s.body);
    this.up.clear();
    this.last.up = 0;
    this.last.down = 0;
    this.last.indoors = 0;
  }

  unload(): void {
    this.rows = [];
    this.framed = false;
    this.up.clear();
    this.away = new Float64Array(0);
    this.near.length = 0;
    this.last.rows = 0;
    this.last.up = 0;
    this.last.down = 0;
    this.last.indoors = 0;
  }

  /** Every row carried into the world's frame, once: the mirror every placed object goes through. */
  private frame(centre: { x: number; z: number }): void {
    for (const r of this.rows) {
      const w = intoWorld(r.x, r.z, centre);
      r.x = w.x;
      r.z = w.z;
      r.heading = -r.heading;
    }
    this.framed = true;
  }

  /**
   * One pass.
   *
   * `now` is the world's own clock, which every respawn keys off, so `__debug.advance` drives it.
   */
  step(dt: number, now: number, at: THREE.Vector3, deps: PeopleDeps, force = false): void {
    if (!this.ready || (deps.held() && !force)) return;
    const cat = deps.catalogue();
    if (!cat) return;
    const centre = deps.centre();
    if (!centre) return;
    if (!this.framed) this.frame(centre);
    this.since += dt;
    const moved = force || !Number.isFinite(this.lastAt.x) || this.lastAt.distanceTo(at) > PEOPLE_TUNE.moveMetres;
    if (this.since < PEOPLE_TUNE.everySeconds && !moved) return;
    this.since = 0;
    this.lastAt.copy(at);
    this.last.stood = 0;
    this.last.dropped = 0;
    this.last.swapped = 0;
    this.last.waiting = 0;

    // The dead first, so a place somebody cleared fills again on its own time.
    for (const [i, s] of this.up) {
      // **The clock is checked whether or not the body is still here.** Nulling it and then skipping
      // the rest of the loop on a null body is how a dead row waits for ever: the first pass takes
      // the body away, and every pass after that steps over the very record it is waiting on.
      if (s.body && (s.body.dead || s.body.removed)) {
        // **Killed is not the same as taken away**, and `dead` alone cannot tell them apart: disposing
        // a mobile sets `dead` too, so a body the game took away (fallen out of the world, say) reads
        // exactly like one somebody fought. The corpse does: a body really killed is dead and still in
        // the world for its death clip and its timer, which is far longer than a pass, while one taken
        // away is dead and gone in the same instant (`WildLife.reap` reads it the same way). Both come
        // back once the row's own wait is out, which is the server's number; only a kill is kept down
        // while respawning is off, or a person the game merely lost would stay lost for good.
        if (s.diedAt === 0) {
          s.diedAt = now;
          s.killed = !s.body.removed;
        }
        s.body = null;
      }
      if (s.diedAt > 0 && !staysDown(s) && now - s.diedAt >= Math.max(1, s.row.respawn)) this.up.delete(i);
    }

    // Then who is too far off to keep, and who is near enough to stand.
    const near = this.near;
    near.length = 0;
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      const away = Math.hypot(r.x - at.x, r.z - at.z);
      this.away[i] = away;
      const here = this.up.get(i);
      if (here) {
        // Past `drop` everyone goes. Nearer than that a body is only ever put down to make room for
        // somebody nearer still, and never one in a fight (`farthestFree`): somebody you are
        // fighting does not vanish.
        if (away > PEOPLE_TUNE.drop) {
          if (here.body) {
            deps.remove(here.body);
            this.last.dropped++;
          }
          // Somebody killed who stays down (respawning off, or a row that never came back) is
          // remembered however far the player goes, or walking away and back would be a respawn by
          // another name.
          if (staysDown(here)) here.body = null;
          else this.up.delete(i);
        }
        continue;
      }
      if (away <= PEOPLE_TUNE.build) near.push(i);
    }
    near.sort(this.nearer);

    let live = 0;
    for (const s of this.up.values()) if (s.body) live++;
    let stood = 0;
    for (const i of near) {
      // Three a pass in play, so walking into a town brings them a few at a time and nothing
      // compiles in a lump on a live frame. Behind the loading screen that is exactly backwards --
      // there is no live frame to spare and the whole point is to have them standing before it lifts
      // -- so a forced pass stands everything in range at once and the warm-up compiles the lot.
      if (!force && stood >= PEOPLE_TUNE.perPass) break;
      const r = this.rows[i];
      const inside = !!r.cell;
      // A person in a room whose building is not built yet waits rather than falling through it.
      if (inside && deps.cellReady?.(r.x, r.y, r.z) === false) {
        this.last.waiting++;
        continue;
      }
      const entry = cat.byId(r.id);
      if (!entry) continue;
      // **The model memory budget full, the farthest standing make room too**, as they do for the cap
      // below: people farther off than this row by the margin and in no fight, farthest first, and only
      // as many as give back what this one needs. Nobody at all when all of them together would not
      // -- a row that cannot fit would otherwise put people down for nothing on every pass, and they
      // would stand again behind it. Without this a crowd stood on the way in held the budget and
      // every nearer person, the cantina's whole room among them, was refused for as long as it stood.
      const short = deps.short?.(entry) ?? 0;
      if (short > 0) live -= this.makeMemory(i, short, deps);
      // **The cap full, the farthest standing makes room**, if it is enough farther off than this
      // row and in no fight. Found before this one is stood and put down only once it has been, so
      // a refusal never costs anybody their place. The rows are nearest first, so once one finds
      // nobody to take the place of, every row after it would find nobody too.
      let makeRoom = -1;
      if (live >= PEOPLE_TUNE.most) {
        makeRoom = this.farthestFree(this.away[i] + PEOPLE_TUNE.swapMargin);
        if (makeRoom < 0) break;
      }
      // Indoors the height is the floor's and is given, because the converter worked it out from the
      // room's own frame and the manager's own ground lookup would find the terrain under the
      // building instead. Outdoors no height is given, for the reason the wildlife learned.
      const spot = inside ? { x: r.x, z: r.z, y: r.y, heading: r.heading } : { x: r.x, z: r.z, heading: r.heading };
      // Part of the furniture when the town made it so whatever body it drew, or when its own creature
      // may not be struck; its body's catalogue entry answers only for a row whose creature says
      // nothing. Its own creature's temper goes with it, since the body's is some other creature's.
      const essential = r.peaceful === true || (r.strikeable !== undefined ? !r.strikeable : standsStill(entry));
      const m = deps.spawn(entry, spot, inside, i, essential, r.temper);
      if (typeof m === 'string') {
        this.last.refused = m;
        continue;
      }
      if (makeRoom >= 0) {
        const out = this.up.get(makeRoom);
        if (out?.body) deps.remove(out.body);
        this.up.delete(makeRoom);
        live--;
        this.last.swapped++;
      }
      // They stand where they were put. A person placed by the server is not a wanderer: their home
      // is their own spot, and their post keeps them on it (`keepPost`) rather than roaming the
      // street the way the brain roams an animal about its range.
      m.homeX = r.x;
      m.homeZ = r.z;
      m.post = postFor(r);
      this.up.set(i, { row: r, body: m, diedAt: 0, killed: false });
      stood++;
      live++;
      this.last.stood++;
    }
    this.count();
  }

  /**
   * Put down, farthest first, the fewest people farther than row `i` by the margin and in no fight who
   * between them give back `short` bytes of the model memory budget, and answer how many. Nought, with
   * nobody put down, when all of them together would not. Uses the kept scratch lists, so a pass that
   * makes room allocates nothing.
   */
  private makeMemory(i: number, short: number, deps: PeopleDeps): number {
    if (!deps.frees) return 0;
    const beyond = this.away[i] + PEOPLE_TUNE.swapMargin;
    const c = this.spare;
    c.length = 0;
    for (const [k, s] of this.up) {
      const b = s.body;
      if (!b || b.dead || b.removed || b.engaged || this.away[k] <= beyond) continue;
      c.push(k);
    }
    c.sort(this.farther);
    const chosen = this.chosen;
    chosen.length = 0;
    let got = 0;
    for (const k of c) {
      if (got >= short) break;
      const f = deps.frees(this.up.get(k)!.body!);
      if (f <= 0) continue;
      got += f;
      chosen.push(k);
    }
    if (got < short) return 0;
    for (const k of chosen) {
      const s = this.up.get(k)!;
      if (s.body) deps.remove(s.body);
      this.up.delete(k);
      this.last.swapped++;
    }
    return chosen.length;
  }

  /**
   * The row of the farthest person standing past `beyond` who may be put down to make room: alive,
   * and in no fight and holding no grudge (`Mobile.engaged`). -1 for nobody. Walks the forty standing
   * and allocates nothing but the loop's own entries, once per person a full pass stands.
   */
  private farthestFree(beyond: number): number {
    let best = -1;
    let bestAway = beyond;
    for (const [k, s] of this.up) {
      const b = s.body;
      if (!b || b.dead || b.removed || b.engaged) continue;
      const away = this.away[k];
      if (away > bestAway) {
        bestAway = away;
        best = k;
      }
    }
    return best;
  }

  private count(): void {
    let up = 0;
    let down = 0;
    let inside = 0;
    for (const s of this.up.values()) {
      if (s.body) up++;
      else down++;
      if (s.body && s.row.cell) inside++;
    }
    this.last.up = up;
    this.last.down = down;
    this.last.indoors = inside;
  }

  /**
   * Whether the dead come back. Turned on again, every one already waiting comes back once its own
   * clock is out, which for somebody killed long ago is on the next pass.
   */
  setRespawns(on: boolean): void {
    PEOPLE_TUNE.respawns = on;
  }

  /**
   * Move any of the numbers above, live; answers which it moved. A number, a pair or a switch is
   * only ever replaced by one of its own kind, so a console typo cannot turn the cap into a word.
   */
  retune(t: Record<string, unknown>): string[] {
    return tuneTable(PEOPLE_TUNE, t);
  }

  /** For the console: who is standing, nearest first, in the world's own frame. */
  report(at: THREE.Vector3): { who: string; where: string; room: number | null; away: number; up: boolean; dead: boolean }[] {
    const out: { who: string; where: string; room: number | null; away: number; up: boolean; dead: boolean }[] = [];
    for (const s of this.up.values()) {
      out.push({
        who: s.row.who,
        where: s.row.where,
        room: s.row.cell ? (s.row.room ?? null) : null,
        away: Math.round(Math.hypot(s.row.x - at.x, s.row.z - at.z)),
        up: !!s.body,
        dead: s.killed,
      });
    }
    return out.sort((a, b) => a.away - b.away);
  }

  /**
   * For the console: the rows nearest a point, standing or not, in the world's own frame. Nothing
   * until a pass has known the layout's centre, since before that a row is a number in another frame.
   */
  nearest(at: THREE.Vector3, n = 5): { who: string; where: string; x: number; y: number; z: number; heading: number; indoors: boolean; room: number | null; away: number; up: boolean }[] {
    if (!this.framed) return [];
    return this.rows
      .map((r, i) => ({
        who: r.who,
        where: r.where,
        x: Math.round(r.x * 10) / 10,
        y: Math.round(r.y * 10) / 10,
        z: Math.round(r.z * 10) / 10,
        heading: Math.round(r.heading * 1000) / 1000,
        indoors: !!r.cell,
        room: r.cell ? (r.room ?? null) : null,
        away: Math.round(Math.hypot(r.x - at.x, r.z - at.z)),
        up: !!this.up.get(i)?.body,
      }))
      .sort((a, b) => a.away - b.away)
      .slice(0, n);
  }
}

/**
 * The post a row stands at: `still` for one the town stood with its brain switched off (its named
 * people and its guards, which the server never let wander and walked home after a fight), `near` for
 * everyone else, who steps about their spot.
 */
function postFor(r: StandingRow): Post {
  return { kind: r.still ? 'still' : 'near', heading: r.heading, tune: PEOPLE_TUNE };
}

/**
 * Whether somebody killed stays down rather than coming back on their clock: while respawning is
 * switched off, and always for a row the server wrote with a respawn of nought, which it never brought
 * back. One the game merely took away (fallen out of the world) is never kept down.
 */
function staysDown(s: Stood): boolean {
  return s.killed && (!PEOPLE_TUNE.respawns || !(s.row.respawn > 0));
}

/** The one for the session. */
export const standingPeople = new StandingPeople();
