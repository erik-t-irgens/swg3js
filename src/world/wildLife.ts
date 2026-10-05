// The world's own wildlife: lairs, herds and camps laid across a planet and stood as the player comes
// near them.
//
// What it is built on is `mobiles/lairs.ts`, which holds every rule and every invented number and is
// pure. This file is the part that cannot be pure: it fetches the pack, keeps what is standing, and
// talks to the mobile manager. It is shaped like `outdoorNav` and `looseProps` deliberately -- one
// singleton, a `load` that a token can overtake, an `adopt` split out so a node test can hand it
// bytes, an `unload`, and a `step` -- because those two are the pattern this world already knows.
//
// **Four things it must get right and would be easy to get wrong.**
//
// It is stepped from `World.stepLiving` and not from `World.update`, because `simTime` is only
// advanced there and `__debug.advance` calls only that one. A respawn clock hung off the other hook
// could never be driven headless, and CLAUDE.md makes that rule explicit.
//
// **The pack's coordinates are the snapshot's and the world's are not.** Every placed object in this
// game goes through `LayoutStreamer`'s own mirror -- `gx = -(x - centre.x)`, `gz = z - centre.z` --
// and these numbers have to go through the same one or every creature stands on the wrong side of
// the planet. The heading is mirrored with it: a reflection in x turns a yaw into its negative, and so
// is every piece of a camp, which its client data places in the camp's own frame.
//
// **A site stands on ground something can walk.** The grid lays a site wherever its cell's draw falls,
// which is sometimes a cliff, a lake or the inside of a rock; the world's outdoor walk grid says which,
// the server's own test of the ground's rise says where it would have stood nothing (`flatEnough`), and
// a site that fails either is moved to the nearest ground that passes both within `siteNudge`, or not
// stood at all. Every browser holds the same grid and the same ground, so every browser moves it to
// the same place.
//
// And it holds when the world holds. An ultra cruise crosses a system at ten kilometres a second
// with the placed-object streamer pinned (`World.streamHold`); a wild pass that ignored that would
// stand and drop several hundred lairs in a few seconds, compiling a shader for each new creature
// on a live frame.

import * as THREE from 'three';
import {
  CAMP_TURN,
  LAIR_TUNE,
  WORLD_BOX,
  bodyAt,
  campLayout,
  clearOfPieces,
  coverage,
  creatureAt,
  flatEnough,
  gridSites,
  inPieces,
  isCamp,
  nestHealth,
  nudgeSite,
  reinforcements,
  respawnWait,
  spreadOf,
  standingAt,
  wanted,
  type CampModel,
  type CampPiece,
  type CreatureDef,
  type GroupEntry,
  type LairDef,
  type LairSite,
  type PlacedPiece,
  type SpawnArea,
} from './mobiles/lairs.ts';
import type { MobileCatalogue } from './mobiles/catalogue.ts';
import type { MobileEntry } from './mobiles/types.ts';
import type { Mobile } from './mobiles/mobile.ts';
import { NEST_MODEL_TUNE, WildCamp, WildNest, nestModels, type NestDeps, type NestEffect } from './wildNest.ts';
import { overridesOf, weaponsOf, type PersonOverrides } from './standingPeople.ts';

/** The spawns packs this game reads: format 1, and format 2, which is format 1 with more beside it. */
export const SPAWNS_READ = [1, 2];

/** Whether a spawns pack's format is one this game reads. */
export function readsSpawns(format: unknown): boolean {
  return typeof format === 'number' && SPAWNS_READ.includes(format);
}

/** A world's own half of the pack: its areas and the people who stand still in it. */
export interface WildPack {
  format: number;
  planet: string;
  areas: SpawnArea[];
  noSpawn: SpawnArea[];
  statics: unknown[];
  /** Format 2: each town's lists a stationary row that names nobody draws its person from. */
  pools?: Record<string, string[]>;
}

/** The fleet's half: what every lair holds and what every creature is. */
export interface WildManifest {
  format: number;
  creatures: Record<string, CreatureDef>;
  lairs: Record<string, LairDef>;
  groups: Record<string, GroupEntry[]>;
  /** Each lair's own model by its template, and (format 2) what its client data hangs on it: its fog, its flies, a camp's fire. */
  nests?: Record<string, { id: string; file: string; effects?: NestEffect[] }>;
  /** Format 2: every weapon group a creature names, as the weapon templates it stands for. */
  weaponGroups?: Record<string, string[]>;
  /** Format 2: a camp's pieces by its template, in the camp's own frame, and each piece's model sized once. */
  camps?: Record<string, CampPiece[]>;
  campModels?: Record<string, CampModel>;
}

/** How one wild body is stood beyond its body and its place: its name in the world and its own creature's numbers. */
export interface WildSpawn {
  /** The one number everything it rolls is drawn from. */
  seed: number;
  /** What the world calls it, which no other body of any site shares: its site's key and its own count there. */
  id: string;
  /** Its own creature's numbers over its body's (`overridesOf`, as a standing person's are). */
  overrides?: PersonOverrides;
  /** Its own creature's weapons, and the groups those names stand for. */
  weapons?: readonly string[];
  weaponGroups?: Readonly<Record<string, readonly string[]>> | null;
  /**
   * How long it stays down once it dies, in seconds: its site's broken wait (`respawnWait`), which is
   * what a server holds its death for so no browser stands it whole again before every other would.
   */
  respawn?: number;
}

/** What the wild world needs of the game. Narrow on purpose, so a node test can be the game. */
export interface WildDeps {
  /** The catalogue, or null before its one boot fetch has landed. */
  catalogue(): MobileCatalogue | null;
  /** Stand one. A string back is the refusal sentence, never an exception. */
  spawn(entry: MobileEntry, at: { x: number; z: number; y?: number; heading?: number }, how: WildSpawn): Mobile | string;
  /** Take one down. */
  remove(m: Mobile): void;
  /** The layout's centre, which the snapshot's numbers are measured from; null before the pack lands. */
  centre(): { x: number; z: number } | null;
  /** True while the world is holding everything still (an ultra cruise), or has no streaming at all. */
  held(): boolean;
  /**
   * What a nest or a camp needs to stand in the world, or null where there is no world to stand it in
   * (a node test). With none, a lair is its creatures and nothing in the middle, which is what it was.
   */
  nest?: NestDeps | null;
  /** The ground under a point, for a nest and a camp's pieces alone: a creature's height is the manager's business. */
  groundAt?(x: number, z: number): number;
  /**
   * Whether the world's outdoor walk grid calls a point in the world's frame walkable; null while the
   * world has no grid (none converted, or still loading), and then a site stands where it was laid.
   */
  walkable?(x: number, z: number): boolean | null;
  /**
   * Whether the ground over the square `reach` metres either way of a point is generated already. When
   * it is not, it is asked for in the background and the answer is false, and the site waits a pass:
   * the searches a site's standing makes ask the ground hundreds of times, and ground not generated yet
   * is generated on the main thread to answer, a millisecond or more a 64 m block. None, and the ground
   * is always there.
   */
  groundReady?(x: number, z: number, reach: number): boolean;
  /**
   * How many seconds more one of the world's seen creatures stays down before anybody stands it again
   * (`Owned.downFor`): a body or a nest every other browser saw die, or saw walk off with a player, is
   * not stood whole here meanwhile. None, and nothing is ever down: the game played alone.
   */
  downFor?(id: string): number;
  /**
   * Put a nest on the wire as one of the world's seen creatures (`NpcNet.addSeen`), with where it stands
   * and how long it stays down once broken. None, and a nest is this browser's own, as it always was.
   */
  shareNest?(nest: WildNest, at: { x: number; y: number; z: number }, respawn: number): void;
}

/** One standing site as the console sees it. */
export interface WildReport {
  key: string;
  lair: string;
  /** Its building level, 1 to 5 (`LAIR_TUNE.levels`). */
  level: number;
  nest: { up: boolean; hp: number; of: number; dead: boolean; effects: number } | 'no model' | false;
  camp: { up: boolean; pieces: number; effects: number } | 'no pieces' | false;
  broken: boolean;
  away: number;
  /** How far its middle was moved onto walkable ground, metres. */
  nudged: number;
  bodies: { who: string; fromNest: number; fromEye: number; dead: boolean; level: number | null }[];
}

/** One site that is standing now. */
interface Standing {
  site: LairSite;
  def: LairDef;
  /** Its middle in the world's frame: the site's own place carried over, moved onto walkable ground where it was not. */
  at: { x: number; z: number };
  bodies: Mobile[];
  /** The nest in the middle, where the lair has one and its model is converted. */
  nest: WildNest | null;
  /** A camp's pieces, where the lair is a camp and its pieces are in the pack. */
  camp: WildCamp | null;
  /** A camp's pieces laid out about its middle (empty for anything else): what its people are stood clear of. */
  pieces: PlacedPiece[];
  /** When it last sent more out, on the world's own clock. */
  helpedAt: number;
  /** When it was broken, on the world's own clock; 0 while it is up. */
  brokeAt: number;
  /** How long it stays broken. */
  wait: number;
  /** How many of its own were really killed here, as against taken away by the game. */
  killed: number;
  /** How many bodies it has stood this life: every one's draw and its name in the world, so no two share one. */
  made: number;
  /** Its bodies are to be stood again on the next pass, its nest or its camp left standing. */
  refill: boolean;
}

/**
 * Every invented number of the running world, as against the pure rules' own. Live through
 * `__debug.wild`.
 */
export const WILD_TUNE = {
  /** How often the pass runs at all, in seconds of the world's own clock. */
  everySeconds: 1.5,
  /** How far the player must move before the pass bothers to look again. */
  moveMetres: 25,
  /**
   * How many sites may be stood in one pass.
   *
   * Two rather than all of them, so an arrival spreads its work over a few seconds instead of
   * standing every site at once: each body is a model to fetch and possibly a shader to build, and
   * this game's whole shape is about never doing that on a live frame. It must be smaller than
   * `LAIR_TUNE.liveLairs` or it never binds at all.
   */
  sitesPerPass: 2,
  /**
   * Whether a broken lair comes back at all. Off, a lair somebody cleared stays cleared for the life
   * of the world, however far the player walks away and back; on again, each comes back when next
   * come near.
   */
  respawns: true,
};

/** The numbers of `LAIR_TUNE` that decide where sites are laid: moving one lays the world out again. */
const LAYOUT_KEYS = ['cell', 'fill', 'gap', 'levels'];

/**
 * Move numbers in one of the tuning tables, live, and answer which moved.
 *
 * A number is only ever replaced by a finite number, a switch by a switch and a pair by two numbers,
 * so a console typo cannot turn a cap into a word; a key the table has not got is ignored. Pairs are
 * written in place, so anything holding the table's own pair sees the change.
 */
export function tuneTable(table: object, t: Record<string, unknown> | null | undefined): string[] {
  const moved: string[] = [];
  if (!t || typeof t !== 'object') return moved;
  const into = table as Record<string, unknown>;
  for (const [key, value] of Object.entries(t)) {
    if (!Object.prototype.hasOwnProperty.call(into, key)) continue;
    const had = into[key];
    if (typeof had === 'number' && typeof value === 'number' && Number.isFinite(value)) into[key] = value;
    else if (typeof had === 'boolean' && typeof value === 'boolean') into[key] = value;
    else if (Array.isArray(had) && Array.isArray(value) && value.length === had.length && value.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      for (let i = 0; i < had.length; i++) had[i] = value[i];
    } else continue;
    moved.push(key);
  }
  return moved;
}

export class WildLife {
  private pack: WildPack | null = null;
  private manifest: WildManifest | null = null;
  private sites: LairSite[] = [];
  private readonly standing = new Map<string, Standing>();
  private token = 0;
  private since = 0;
  private readonly lastAt = new THREE.Vector3(NaN, NaN, NaN);
  /**
   * The sites cleared while respawning was off, by key: never stood again until it is turned back on.
   * `open` is every site less those and less the ones with no walkable ground near them, rebuilt only
   * when either set or the sites change.
   */
  private readonly cleared = new Set<string>();
  /** The sites with no walkable, level enough ground within `siteNudge` of them: never stood on this world. */
  private readonly unwalkable = new Set<string>();
  /** Where each site stood before, in the world's frame, once it was moved onto ground that passes: found once a world. */
  private readonly placed = new Map<string, { x: number; z: number }>();
  private open: LairSite[] = [];
  /** Bumped whenever the sites or either set change; `open` is good while it matches `openAt`. */
  private version = 0;
  private openAt = -1;
  /** The game the last step was given, kept (the world's own object) so a restand can take bodies down. */
  private deps: WildDeps | null = null;
  /**
   * For the console: what the last pass did and what is up now. `waiting` is how many sites the last
   * pass left for a later one because the ground under them was still being generated.
   */
  readonly last = { sites: 0, up: 0, bodies: 0, stood: 0, dropped: 0, waiting: 0, cleared: 0, unwalkable: 0, refused: '' };

  /** Whether there is anything to run at all. */
  get ready(): boolean {
    return !!this.pack && !!this.manifest;
  }

  /**
   * Fetch a world's wild half. A token overtakes an in-flight fetch, so a travel during one cannot
   * commit the old world's lairs into the new one.
   */
  async load(planetId: string, base = ''): Promise<void> {
    const token = ++this.token;
    this.clear();
    this.forgetCleared();
    if (!planetId) return;
    try {
      const [packRes, manRes] = await Promise.all([fetch(`${base}assets-private/${planetId}/spawns.json`), fetch(`${base}assets-private/spawns/manifest.json`)]);
      if (!packRes.ok || !manRes.ok) return;
      const pack = (await packRes.json()) as WildPack;
      const manifest = (await manRes.json()) as WildManifest;
      if (token !== this.token) return;
      this.adopt(pack, manifest);
    } catch {
      /* a world with no wild pack is the world as it was, which is not an error */
    }
  }

  /**
   * Take a pack that is already parsed: the half a node test can drive. Both formats are taken:
   * format 2 carries every field format 1 did, filled the same way, and what it adds is read here
   * where it is the wild world's (each creature's own numbers and weapons, a camp's pieces, a nest's
   * effects) and handed on to the standing people where it is theirs (`peopleRows`, `peopleCreatures`,
   * `peopleExtras`). The world is laid out on the grid (`gridSites`), which keeps its sites out of the
   * places the server said nothing may stand.
   */
  adopt(pack: WildPack | null, manifest: WildManifest | null): void {
    this.pack = readsSpawns(pack?.format) && pack && Array.isArray(pack.areas) ? pack : null;
    this.manifest = readsSpawns(manifest?.format) && manifest?.lairs ? manifest : null;
    this.sites = [];
    this.unwalkable.clear();
    this.placed.clear();
    this.last.unwalkable = 0;
    this.version++;
    if (!this.pack || !this.manifest) return;
    this.sites = gridSites(this.pack.planet, this.pack.areas, this.pack.noSpawn ?? [], this.manifest.groups);
    this.last.sites = this.sites.length;
  }

  unload(): void {
    this.token++;
    this.clear();
    // The models every nest and camp just put away was cloned from go with the world: nothing holds
    // them now, and a camp on the next world is another camp.
    nestModels.clear();
    const own = this.deps?.nest?.models;
    if (own && own !== nestModels) own.clear();
    this.forgetCleared();
    this.pack = null;
    this.manifest = null;
    this.sites = [];
    this.unwalkable.clear();
    this.placed.clear();
    this.last.unwalkable = 0;
    this.version++;
    this.last.sites = 0;
    this.deps = null;
  }

  /**
   * Put every standing body down without touching the pack: what a reload of the rules wants. The
   * bodies go with their records -- dropping only the records left every one of them standing in the
   * world with nothing that would ever take it down again.
   */
  restand(): void {
    const deps = this.deps;
    if (deps) for (const rec of this.standing.values()) for (const m of rec.bodies) deps.remove(m);
    this.clear();
    this.lastAt.set(NaN, NaN, NaN);
    this.since = WILD_TUNE.everySeconds;
  }

  /**
   * Move any of the numbers of `LAIR_TUNE` and `WILD_TUNE`, live; answers which it moved. A change to
   * how sites are laid (`cell`, `fill`, `gap`, `levels`) lays the world out again and stands it afresh,
   * and a change to `siteNudge` tries again every site it had given up on.
   */
  retune(t: Record<string, unknown>): string[] {
    const moved = [...tuneTable(LAIR_TUNE, t), ...tuneTable(WILD_TUNE, t), ...tuneTable(NEST_MODEL_TUNE, t)];
    if (moved.some((k) => LAYOUT_KEYS.includes(k))) {
      this.restand();
      this.adopt(this.pack, this.manifest);
    } else if (moved.some((k) => k === 'siteNudge' || k === 'flatReach' || k === 'flatRise')) {
      this.unwalkable.clear();
      this.placed.clear();
      this.last.unwalkable = 0;
      this.version++;
    }
    return moved;
  }

  /**
   * Whether a broken lair comes back. Turned on again, every one cleared meanwhile is forgotten and
   * stands on the next pass that comes near it.
   */
  setRespawns(on: boolean): void {
    WILD_TUNE.respawns = on;
    if (on) this.forgetCleared();
  }

  private forgetCleared(): void {
    if (!this.cleared.size) return;
    this.cleared.clear();
    this.version++;
    this.last.cleared = 0;
  }

  /** A site cleared while respawning is off: it never stands again until that is turned back on. */
  private clearSite(key: string): void {
    if (this.cleared.has(key)) return;
    this.cleared.add(key);
    this.version++;
    this.last.cleared = this.cleared.size;
  }

  /** The sites a pass may stand: all of them, less any cleared while respawning was off and any with no walkable ground. */
  private openSites(): readonly LairSite[] {
    if (!this.cleared.size && !this.unwalkable.size) return this.sites;
    if (this.openAt !== this.version) {
      this.open = this.sites.filter((s) => !this.cleared.has(s.key) && !this.unwalkable.has(s.key));
      this.openAt = this.version;
    }
    return this.open;
  }

  /** How many bodies all the standing sites hold between them. */
  private liveBodies(): number {
    let n = 0;
    for (const rec of this.standing.values()) n += rec.bodies.length;
    return n;
  }

  private clear(): void {
    // Every nest and every camp goes with it. Each holds a body in the physics world, a group in the
    // scene, its own copies of the models' materials and its effects, and dropping the record without
    // disposing it leaves all of them behind -- which on a world unload is a material still in the
    // portal renderer's set, walked a dozen times a frame for the rest of the session.
    for (const rec of this.standing.values()) {
      rec.nest?.dispose();
      rec.camp?.dispose();
    }
    this.standing.clear();
    this.last.up = 0;
    this.last.bodies = 0;
  }

  /**
   * One step of the wild world.
   *
   * `now` is the world's own clock (`World.simTime`), which is what every respawn keys off, and `dt`
   * is how much of it has passed. Both come from `stepLiving`, so `__debug.advance` drives all of it.
   */
  step(dt: number, now: number, at: THREE.Vector3, deps: WildDeps): void {
    this.deps = deps;
    if (!this.ready || deps.held()) return;
    const cat = deps.catalogue();
    const centre = deps.centre();
    if (!cat || !centre) return;
    // Turned back on by the table rather than the switch: what was cleared meanwhile stands again.
    if (WILD_TUNE.respawns && this.cleared.size) this.forgetCleared();
    this.since += dt;
    const moved = !Number.isFinite(this.lastAt.x) || this.lastAt.distanceTo(at) > WILD_TUNE.moveMetres;
    if (this.since < WILD_TUNE.everySeconds && !moved) {
      // A nest being struck answers on the frame it is struck, not on the next slow pass.
      this.reinforce(now, cat, deps);
      this.reap(now);
      return;
    }
    this.since = 0;
    this.lastAt.copy(at);
    // What this pass did, reset only by a pass that really runs, so the console reads the last one.
    this.last.stood = 0;
    this.last.dropped = 0;
    this.last.waiting = 0;

    // The pass works in the pack's own frame, because that is what the sites are in; the player's
    // place is carried back into it rather than every site being carried forward.
    const mine = { x: centre.x - at.x, z: at.z + centre.z };
    const live = new Set(this.standing.keys());
    const { add, drop } = wanted(this.openSites(), mine, live);
    for (const key of drop) this.put(key, deps);
    let stood = 0;
    // First the nests and camps still standing whose people are due to stand again, then new sites.
    for (const rec of this.standing.values()) {
      if (!rec.refill) continue;
      if (stood >= WILD_TUNE.sitesPerPass) break;
      if (this.standBodies(rec, cat, deps) > 0) {
        rec.refill = false;
        stood++;
      }
    }
    for (const site of add) {
      if (stood >= WILD_TUNE.sitesPerPass) break;
      const done = this.stand(site, cat, centre, deps);
      // One waiting for its ground holds back the ones farther off, or they would take the room the
      // nearest is owed, and it would stand only when something else was put away.
      if (done === 'wait') break;
      if (done) stood++;
    }
    this.reinforce(now, cat, deps);
    this.reap(now);
  }

  /**
   * Stand one site: its lair's own creatures round its middle, and the nest or the camp in the middle.
   * The middle is moved first onto ground something can walk (where the world has a walk grid) and the
   * server would have stood a spawn on (`flatEnough`); a site with none within `siteNudge` is never
   * stood on this world. `'wait'` is a site whose ground is still being generated (`groundReady`).
   */
  private stand(site: LairSite, cat: MobileCatalogue, centre: { x: number; z: number }, deps: WildDeps): boolean | 'wait' {
    const def = this.manifest?.lairs[site.lair];
    if (!def) return false;
    // Never past the most wild bodies there may be at once, whatever the lairs would stand: that
    // number was declared and never read, and a few struck nests could take the count past it.
    if (LAIR_TUNE.liveBodies - this.liveBodies() <= 0) return false;
    // A camp's pieces, laid out about its middle before anybody stands, so its people stand clear of
    // them. The camp's own marker (the point of interest's appearance, a clump of pebbles) is one of
    // them, at its middle, as the client drew it. It stands at the server's own turn, which is none.
    const camp = isCamp(def) && def.nest ? this.manifest?.camps?.[def.nest] : undefined;
    const turn = CAMP_TURN;
    let pieces: PlacedPiece[] = [];
    if (camp?.length) {
      const marker = this.manifest?.nests?.[def.nest!]?.file;
      const all: CampPiece[] = marker ? [{ model: marker, place: [0, 0, 0], angles: [0, 0, 0] }, ...camp] : camp;
      pieces = campLayout(all, this.manifest?.campModels ?? {}, turn);
    }
    const effects = def.nest ? this.manifest?.nests?.[def.nest]?.effects : undefined;
    let middle = intoWorld(site.x, site.z, centre);
    const walk = deps.walkable;
    const ground = deps.groundAt;
    const kept = this.placed.get(site.key);
    // **The ground first.** Everything below asks the ground's height a great many times -- the search
    // for level ground hundreds or thousands of times on a hillside, every camp piece at five points,
    // the manager once for every body it stands -- and ground not generated yet is generated on the
    // main thread to answer, a millisecond or more a block. So the square all of that can reach (a body
    // stands up to its spread out and may be moved as far again onto walkable ground) is asked for
    // first, in the background, and the site waits a pass or two for it rather than stalling a frame.
    if (deps.groundReady && ground) {
      const about = kept ?? middle;
      const reach = (kept ? 0 : LAIR_TUNE.siteNudge) + Math.max(LAIR_TUNE.flatReach, reachOf(pieces, effects), 2 * spreadOf(def)) + 2;
      if (!deps.groundReady(about.x, about.z, reach)) {
        this.last.waiting++;
        return 'wait';
      }
    }
    if (kept) middle = kept;
    else if (walk || ground) {
      // Ground something can walk, where the world has a walk grid, and ground the server would have
      // stood a spawn on (`flatEnough`), where it has a height: the cheap test first, since the ring
      // search asks it of every point it tries.
      const open = (x: number, z: number): boolean => (!walk || walk(x, z) !== false) && (!ground || flatEnough(x, z, ground));
      const found = nudgeSite(middle.x, middle.z, open, LAIR_TUNE.siteNudge);
      if (!found) {
        this.unwalkable.add(site.key);
        this.version++;
        this.last.unwalkable = this.unwalkable.size;
        return false;
      }
      middle = found;
      // Kept once the world has its grid, so a site stood again after the player walks away and back
      // is not searched for again: on steep ground the search asks the ground a few thousand times.
      if (!walk || walk(middle.x, middle.z) !== null) this.placed.set(site.key, middle);
    }
    const rec: Standing = { site, def, at: middle, bodies: [], nest: null, camp: null, pieces, helpedAt: -Infinity, brokeAt: 0, wait: respawnWait(site.seed), killed: 0, made: 0, refill: false };
    this.standBodies(rec, cat, deps);
    if (!rec.bodies.length) return false;
    // The thing in the middle is built behind the creatures rather than before them: a site with its
    // animals up and its mound still arriving is a site, and one that waited for the mound would stand
    // nothing at all on a world with no nests.
    const heightAt = ground ?? (() => 0);
    if (pieces.length && deps.nest) {
      const built = new WildCamp(def.nest ?? 'camp');
      rec.camp = built;
      void built.build(pieces, middle, turn, heightAt, deps.nest, effects).then(
        (made) => {
          // Put away while it was loading: the record is gone and nothing will ever take it down.
          if (!made || this.standing.get(site.key) !== rec) built.dispose();
        },
        () => built.dispose(),
      );
    } else if (!isCamp(def)) {
      const held = def.nest ? this.manifest?.nests?.[def.nest] : null;
      if (held?.file && deps.nest) {
        const nest = new WildNest(def.nest ?? 'nest', nestHealth(site));
        rec.nest = nest;
        // One of the world's seen creatures, under its site's own name: a nest broken on one screen is
        // broken on all of them, and down for the site's own wait. One every other browser has broken
        // stands broken here.
        this.shareNest(rec, deps);
        void nest.build(held.file, { x: middle.x, y: heightAt(middle.x, middle.z), z: middle.z }, deps.nest, held.effects, ground).then(
          (made) => {
            if (!made || this.standing.get(site.key) !== rec) nest.dispose();
          },
          () => nest.dispose(),
        );
      }
    }
    this.standing.set(site.key, rec);
    this.count();
    return true;
  }

  /**
   * Stand a site's people: as many as its lair stands (`standingAt`), within what the most wild bodies
   * at once leaves room for. Answers how many stood.
   */
  private standBodies(rec: Standing, cat: MobileCatalogue, deps: WildDeps): number {
    const room = LAIR_TUNE.liveBodies - this.liveBodies();
    if (room <= 0) return 0;
    const n = Math.min(standingAt(rec.def, rec.site), room);
    // Drawn from the start again (the same animals in the same places) only when nobody of this site
    // is standing: a name is `made`'s count, and one still worn must never be handed out twice.
    if (!rec.bodies.length) rec.made = 0;
    let stood = 0;
    for (let i = 0; i < n; i++) if (this.standOne(rec, cat, deps)) stood++;
    this.last.stood += stood;
    this.count();
    return stood;
  }

  /**
   * Every nest standing put on the wire, now that a server that speaks of the seen ones has taken this
   * browser (it came after they were stood, or back after a drop, which clears the wire). A nest already
   * on it says nothing new. Answers how many.
   */
  shareNests(): number {
    const deps = this.deps;
    if (!deps?.shareNest) return 0;
    let n = 0;
    for (const rec of this.standing.values()) {
      const nest = rec.nest;
      if (!nest || nest.dead) continue;
      this.shareNest(rec, deps);
      n++;
    }
    return n;
  }

  /** A site's nest on the wire as `camp:` and its site's name, and told it is down if every other browser has it so. */
  private shareNest(rec: Standing, deps: WildDeps): void {
    const nest = rec.nest;
    if (!nest || !deps.shareNest) return;
    const id = `camp:${rec.site.key}`;
    if (deps.downFor && deps.downFor(id) > 0) nest.npcEnd('dead');
    nest.shareAs(id);
    deps.shareNest(nest, { x: rec.at.x, y: deps.groundAt?.(rec.at.x, rec.at.z) ?? 0, z: rec.at.z }, rec.wait);
  }

  /**
   * Stand one of a site's bodies: its creature drawn from the lair (`creatureAt`), its spot drawn round
   * the middle and, at a camp, moved clear of the pieces, and its own creature's numbers and weapons
   * over its body's -- a body is shared by every creature drawn as it and carries one creature's
   * numbers, so a camp of level-forty raiders stood as whoever first wore their look.
   *
   * `index` is which of the site's bodies it is; with none it is the next the site has not made. Every
   * browser draws body `n` of a site the same way, which is what lets one stand a body another
   * browser's keeper sent out (`standKnown`). A body every other browser has seen die (or walk off with
   * a player) is not stood whole here before its row's wait is out (`downFor`): its number is spent.
   */
  private standOne(rec: Standing, cat: MobileCatalogue, deps: WildDeps, index = -1): boolean {
    const i = index >= 0 ? index : rec.made++;
    if (index >= 0) rec.made = Math.max(rec.made, index + 1);
    const site = rec.site;
    const id = `${site.key}:${i}`;
    if (deps.downFor && deps.downFor(`wild:${id}`) > 0) return false;
    const who = creatureAt(rec.def, site.seed, i);
    const c = who ? this.manifest?.creatures[who] : null;
    if (!c) return false;
    const entry = cat.byId(c.id);
    if (!entry) return false;
    const spot = bodyAt(site, i, spreadOf(rec.def));
    // The spot's offset from the middle, carried into the world's frame (the mirror is in x), and out
    // of a camp's tents.
    let off = { x: -(spot.x - site.x), z: spot.z - site.z };
    const pieces = rec.pieces;
    if (pieces.length) off = clearOfPieces(off.x, off.z, pieces);
    let world = { x: rec.at.x + off.x, z: rec.at.z + off.z };
    // And onto ground something can walk, as the middle was: a site moved to a lake's shore would
    // otherwise stand half its people back in the water. The nearest walkable spot clear of the pieces
    // within the lair's own spread, or the middle itself, which is walkable.
    const walk = deps.walkable;
    if (walk && walk(world.x, world.z) === false) {
      const at = rec.at;
      world = nudgeSite(world.x, world.z, (x, z) => walk(x, z) !== false && !inPieces(x - at.x, z - at.z, pieces), spreadOf(rec.def)) ?? { x: at.x, z: at.z };
    }
    // **No height is given, and the manager stands it on the terrain.** Outdoors the manager's own
    // lookup (`World.groundAt`) is the terrain alone and never a platform, so this is the ground under
    // the spot. That is right for a lair because of where the spot is: it was just moved clear of the
    // camp's own pieces (`clearOfPieces`) and onto walkable ground, so nothing built stands over it.
    // A raw terrain height under something built would put a body under its floor and the physics
    // would eject it downward, out of the world, which is what the pieces' clearance is for. The
    // standing people are the other case: their rows stand on bridges and platforms, so they hand
    // their row's height over and the manager holds them perched until it is solid (`perch.ts`).
    const m = deps.spawn(entry, { x: world.x, z: world.z, heading: -spot.heading }, {
      seed: site.seed ^ i,
      id,
      overrides: overridesOf(c),
      weapons: weaponsOf(c),
      weaponGroups: this.manifest?.weaponGroups ?? null,
      respawn: rec.wait,
    });
    if (typeof m === 'string') {
      this.last.refused = m;
      return false;
    }
    // **Its home is the middle, not the spot it was put down on.** A mobile's home is where it was
    // stood, and the brain wanders it eight to thirty metres from home every few seconds; a body
    // stood five to fourteen metres out to begin with therefore drifts to forty from the thing it
    // is supposed to be guarding, and going to the lair finds an empty patch of ground. Giving
    // every one of them the site's own middle makes them range about the nest instead, which is
    // what "four or five standing round it" means.
    m.homeX = rec.at.x;
    m.homeZ = rec.at.z;
    rec.bodies.push(m);
    return true;
  }

  /**
   * A body another browser's keeper has and this browser has not stood, under a lair's own name
   * (`wild:<site>:<n>`): a struck nest's own, which only its keeper sends out. Stood here as body `n` of
   * that site -- every browser draws a site's `n`th body the same way -- where the site is standing here,
   * and the rows parked for it put it where it really is. Nothing for a site this browser is not
   * standing: it is too far off to have one, and the rows age out on their own. True when it stood.
   */
  standKnown(id: string): boolean {
    const deps = this.deps;
    const cat = deps?.catalogue();
    if (!deps || !cat || !id.startsWith('wild:')) return false;
    const name = id.slice(5);
    const cut = name.lastIndexOf(':');
    if (cut <= 0) return false;
    const rec = this.standing.get(name.slice(0, cut));
    const n = Number(name.slice(cut + 1));
    if (!rec || !Number.isInteger(n) || n < 0 || n > 4 * LAIR_TUNE.liveBodies) return false;
    if (LAIR_TUNE.liveBodies - this.liveBodies() <= 0) return false;
    // Not a second body under a name one of this site's already wears.
    for (const m of rec.bodies) if (!m.removed && m.npcId === id) return false;
    if (!this.standOne(rec, cat, deps, n)) return false;
    this.count();
    return true;
  }

  /**
   * One of a site's people asked to follow the player: off its site's books without being taken away, the
   * follower set having it now (`src/world/followers.ts`). Counted as the site losing it to the player, as
   * a kill is, so a camp whose last person walks off with you waits its own clock before its people stand
   * again rather than standing a fresh crowd in front of you at once. False for a body no site stood.
   */
  release(m: Mobile): boolean {
    for (const rec of this.standing.values()) {
      const i = rec.bodies.indexOf(m);
      if (i < 0) continue;
      rec.bodies.splice(i, 1);
      rec.killed++;
      this.count();
      return true;
    }
    return false;
  }

  /** Put a site away: every body it stood, the thing in its middle, and the record. */
  private put(key: string, deps: WildDeps): void {
    const rec = this.standing.get(key);
    if (!rec) return;
    // A lair somebody broke while respawning is off stays broken after the player has walked away,
    // or walking off and back would be a respawn by another name.
    if (rec.brokeAt > 0 && !WILD_TUNE.respawns) this.clearSite(key);
    rec.nest?.dispose();
    rec.nest = null;
    rec.camp?.dispose();
    rec.camp = null;
    for (const m of rec.bodies) deps.remove(m);
    this.last.dropped += rec.bodies.length;
    this.standing.delete(key);
    this.count();
  }

  /**
   * A struck nest sends more of its own out, and a broken one never does again.
   *
   * This is the owner's own account of a lair and the whole reason it is worth walking up to one:
   * hitting it makes it worse before it makes it better, and the only way to stop that is to break
   * it. The cooldown and how many come at a time are ours; the ceiling is the server's, which is the
   * one number in its data that says how much of a creature belongs at one nest.
   */
  private reinforce(now: number, cat: MobileCatalogue, deps: WildDeps): void {
    for (const rec of this.standing.values()) {
      const nest = rec.nest;
      if (!nest || !nest.wantsHelp) continue;
      nest.wantsHelp = false;
      // Broken is broken: nothing more comes out of it, ever, which is what killing it is for.
      if (nest.dead) continue;
      const n = Math.min(reinforcements(rec.def, rec.bodies.length, now - rec.helpedAt), LAIR_TUNE.liveBodies - this.liveBodies());
      if (n <= 0) continue;
      rec.helpedAt = now;
      // Drawn from the nest's own seed and its count so far (`standOne`), so two browsers watching one
      // lair being attacked bring the same creatures out in the same places.
      for (let k = 0; k < n; k++) this.standOne(rec, cat, deps);
      this.count();
    }
  }

  /**
   * Forget the dead, and let a site that has lost everything come back on its own clock.
   *
   * A body the manager has taken down (killed, or swept) is dropped from the record here rather
   * than being chased, so nothing holds a reference to a mobile that has gone. The list is compacted in
   * place, since this runs every frame. A nest or a camp comes back as it stands, its people stood
   * again beside it and a broken nest made whole, so its model never vanishes and builds again in view;
   * a herd, which has nothing in its middle, is forgotten and stood afresh from its seed.
   */
  private reap(now: number): void {
    for (const [key, rec] of this.standing) {
      const list = rec.bodies;
      let k = 0;
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        // **Killed is not the same as gone**, and telling them apart is not `dead` alone: disposing a
        // mobile sets `dead` too (`mobile.ts:2077`), so a body the game merely took away reads exactly
        // like one somebody fought. What separates them is the corpse. A creature that really died is
        // dead and still in the world, lying there for its death clip and its timer; one that was
        // taken away is dead and gone in the same instant. So a kill is only counted while the body is
        // still there to see, and a site that lost its creatures any other way stands them again on
        // the next pass rather than sitting broken for ten minutes.
        if (m.dead || m.removed) {
          if (m.dead && !m.removed) rec.killed++;
          continue;
        }
        list[k++] = m;
      }
      if (k !== list.length) {
        list.length = k;
        this.count();
      }
      const standsAlone = !!rec.nest || !!rec.camp;
      if (list.length > 0) {
        // Somebody stands here again (a struck nest's own, sent out after its guards were all killed):
        // it is not broken, nor waiting to be stood again, and its clock starts again only when these
        // are gone too. Left running, it revived the nest and stood a whole guard on top of them, under
        // names they still held.
        rec.refill = false;
        if (rec.brokeAt > 0) {
          rec.brokeAt = 0;
          rec.killed = 0;
        }
      } else if (!rec.refill) {
        if (rec.killed === 0) {
          // Nothing was killed here: its people stand again at once.
          if (standsAlone) rec.refill = true;
          else {
            this.standing.delete(key);
            this.count();
            continue;
          }
        } else if (rec.brokeAt === 0) rec.brokeAt = now;
      }
      // Once its clock is out the site comes back from the same seed: the same animals in the same
      // places, as the same world should. With respawning off the clock never runs out.
      if (list.length === 0 && rec.brokeAt > 0 && WILD_TUNE.respawns && now - rec.brokeAt >= rec.wait) {
        // **One clock, the later of the two.** The site's own runs from its last body's death; a server
        // holds each of its names down from that name's own death (a nest broken after the last guard
        // fell, a body whose word came back a moment late), for the same wait plus the line's delay. A
        // name still down when the site comes back would be stood dead here -- a nest revived broken for
        // a whole cycle, a body skipped and the site one short -- so the site waits out the last of them.
        // The wait is pushed on rather than asked again every frame, since asking makes a name a time.
        const down = this.siteDown(rec);
        if (down > 0) {
          rec.brokeAt = now - rec.wait + down;
          continue;
        }
        if (standsAlone) {
          rec.nest?.revive();
          // A fresh life on the wire as well: said again, so the server holds it alive (or tells this
          // browser it is still down, when this browser's own clock ran out ahead of the server's).
          const deps = this.deps;
          if (deps) this.shareNest(rec, deps);
          rec.brokeAt = 0;
          rec.killed = 0;
          rec.helpedAt = -Infinity;
          rec.refill = true;
        } else {
          this.standing.delete(key);
          this.count();
        }
      }
    }
  }

  /**
   * How many seconds more the longest-held of a site's own names is down for on the server's word
   * (`WildDeps.downFor`): its nest's and every body it may stand. 0 with nothing down, or nothing wired.
   */
  private siteDown(rec: Standing): number {
    const downFor = this.deps?.downFor;
    if (!downFor) return 0;
    const key = rec.site.key;
    let most = downFor(`camp:${key}`);
    const n = Math.max(rec.made, standingAt(rec.def, rec.site));
    for (let i = 0; i < n; i++) most = Math.max(most, downFor(`wild:${key}:${i}`));
    return most;
  }

  private count(): void {
    this.last.up = this.standing.size;
    let n = 0;
    for (const rec of this.standing.values()) n += rec.bodies.length;
    this.last.bodies = n;
  }

  /**
   * For the console: the sites laid nearest this point, standing or not, in the world's own frame.
   *
   * A world lays a few thousand of these over sixteen kilometres and stands only the four you are
   * next to, so "is any of this working" is not a question the view can answer by itself: this is what
   * says where the nearest one is so somebody can go and look at it.
   *
   * Each is where it stands, or stood last, once it has been moved onto walkable ground, and where it
   * was laid before that; `open` is false for one that will never stand on this world (no walkable,
   * level ground near it) or not while respawning is off (cleared), which is what `go` passes by.
   */
  nearest(at: THREE.Vector3, centre: { x: number; z: number } | null, n = 5): { key: string; lair: string; kind: string; x: number; z: number; away: number; up: boolean; open: boolean }[] {
    if (!centre) return [];
    const out = this.sites.map((s) => {
      const w = this.standing.get(s.key)?.at ?? this.placed.get(s.key) ?? intoWorld(s.x, s.z, centre);
      const def = this.manifest?.lairs[s.lair];
      return {
        key: s.key,
        lair: s.lair,
        kind: def ? kindOf(def) : '?',
        x: Math.round(w.x),
        z: Math.round(w.z),
        away: Math.round(Math.hypot(w.x - at.x, w.z - at.z)),
        up: this.standing.has(s.key),
        open: !this.unwalkable.has(s.key) && !this.cleared.has(s.key),
      };
    });
    return out.sort((a, b) => a.away - b.away).slice(0, n);
  }

  /** For the console: the nests' and camps' models held now, and what they weigh (`NestModels.stats`). */
  modelStats(): ReturnType<typeof nestModels.stats> {
    return (this.deps?.nest?.models ?? nestModels).stats();
  }

  /**
   * The share of this world within `LAIR_TUNE.build` of a site, over the whole sixteen-kilometre square
   * (`coverage`, the node test's own function), and how many sites there are of each kind. With the
   * layout's centre and the world's walk grid, the same again for the sites moved onto walkable ground,
   * those with none dropped. The server's flatness test (`flatEnough`), which a site must also pass when
   * it stands, is left out here: asked of every site at once it would generate the whole world's ground
   * on the main thread.
   */
  coverageReport(centre: { x: number; z: number } | null = null, walkable: ((x: number, z: number) => boolean | null) | null = null): {
    sites: number;
    nests: number;
    camps: number;
    herds: number;
    share: number;
    points: number;
    reach: number;
    walked?: { dropped: number; nudged: number; share: number };
  } {
    let nests = 0;
    let camps = 0;
    let herds = 0;
    for (const s of this.sites) {
      const def = this.manifest?.lairs[s.lair];
      if (!def) continue;
      const k = kindOf(def);
      if (k === 'camp') camps++;
      else if (k === 'nest') nests++;
      else herds++;
    }
    const laid = coverage(this.sites, WORLD_BOX, 60, LAIR_TUNE.build);
    const out = { sites: this.sites.length, nests, camps, herds, share: round3(laid.share), points: laid.points, reach: LAIR_TUNE.build };
    if (!centre || !walkable) return out;
    const kept: { x: number; z: number }[] = [];
    let dropped = 0;
    let nudged = 0;
    for (const s of this.sites) {
      const w = intoWorld(s.x, s.z, centre);
      const found = nudgeSite(w.x, w.z, (x, z) => walkable(x, z) !== false, LAIR_TUNE.siteNudge);
      if (!found) {
        dropped++;
        continue;
      }
      if (found.x !== w.x || found.z !== w.z) nudged++;
      // Back into the pack's frame, where the square is measured.
      kept.push({ x: centre.x - found.x, z: found.z + centre.z });
    }
    const walked = coverage(kept, WORLD_BOX, 60, LAIR_TUNE.build);
    return { ...out, walked: { dropped, nudged, share: round3(walked.share) } };
  }

  /**
   * The nest whose collider this is, for `World.hittableAt`: how a bolt or a blade reaches one.
   *
   * Walked rather than kept in a map because there are never more than a handful standing and the
   * map would be one more thing to keep in step with the disposals. A camp's colliders are never an
   * answer: nobody may attack a camp.
   */
  nestAt(handle: number): WildNest | undefined {
    for (const rec of this.standing.values()) if (rec.nest?.handle === handle) return rec.nest;
    return undefined;
  }

  /**
   * The people who stand still, out of the same pack.
   *
   * They ride in the world's half of the pack beside the areas, so they are handed on from here
   * rather than fetched a second time by whoever stands them.
   */
  peopleRows(): readonly unknown[] {
    return this.pack?.statics ?? [];
  }

  /**
   * Every creature those rows name, out of the fleet's half of the same pack: each carries its own
   * numbers there from format 2 on (`game`), which is what a standing person's temper and whether it
   * may be struck are read from rather than from the body it is drawn as. Nothing before it lands.
   */
  peopleCreatures(): Readonly<Record<string, CreatureDef>> | null {
    return this.manifest?.creatures ?? null;
  }

  /**
   * The rest of the same pack a standing person is drawn from and armed out of (format 2): the world
   * as the pack names it (whose side holds its towns), the towns' own lists a stationary row draws its
   * person from, and the fleet's weapon groups. Empty lists before it lands, and on a format-1 pack.
   */
  peopleExtras(): { world: string; pools: Readonly<Record<string, readonly string[]>> | null; weaponGroups: Readonly<Record<string, readonly string[]>> | null } {
    return { world: this.pack?.planet ?? '', pools: this.pack?.pools ?? null, weaponGroups: this.manifest?.weaponGroups ?? null };
  }

  /** The difficulty knob moved: every nest standing takes it, as a body does (`WildNest.applyDifficulty`). */
  applyDifficulty(scale: number): void {
    for (const rec of this.standing.values()) rec.nest?.applyDifficulty(scale);
  }

  /** What one site would stand, without standing it: for the console, and for a check. */
  holds(key: string): { lair: string; kind: string; level: number; creatures: string[] } | null {
    const site = this.sites.find((s) => s.key === key);
    const def = site ? this.manifest?.lairs[site.lair] : null;
    if (!site || !def) return null;
    const who: string[] = [];
    for (let i = 0; i < standingAt(def, site); i++) {
      const c = creatureAt(def, site.seed, i);
      if (c) who.push(c);
    }
    return { lair: site.lair, kind: kindOf(def), level: site.level, creatures: who };
  }

  /**
   * For the console: every site that is standing, nearest first, **and where its bodies really are**.
   *
   * The count alone was not enough, and the gap cost a whole round of guessing. A site can report
   * four bodies standing while every one of them has wandered forty metres into a dune, and from the
   * view that is indistinguishable from nothing having been stood at all. `bodies` therefore says
   * how far each one is from its own nest and from the eye, which separates "they were never stood",
   * "they were stood and taken away" and "they are right there, behind you" in one reading.
   */
  report(at: THREE.Vector3, centre: { x: number; z: number } | null): WildReport[] {
    const out: WildReport[] = [];
    for (const rec of this.standing.values()) {
      const w = rec.at;
      const laid = centre ? intoWorld(rec.site.x, rec.site.z, centre) : w;
      out.push({
        key: rec.site.key,
        lair: rec.site.lair,
        level: rec.site.level,
        // A herd has no nest to stand round, which is worth seeing: it explains an empty middle.
        // Where there is one, its health says whether it is up, being fought, or broken.
        nest: rec.nest ? { up: rec.nest.up, hp: Math.round(rec.nest.hp), of: Math.round(rec.nest.maxHp), dead: rec.nest.dead, effects: rec.nest.effects } : rec.def.nest && !isCamp(rec.def) ? 'no model' : false,
        camp: rec.camp ? { up: rec.camp.up, pieces: rec.camp.pieces, effects: rec.camp.effects } : isCamp(rec.def) ? 'no pieces' : false,
        broken: rec.brokeAt > 0,
        away: Math.round(Math.hypot(w.x - at.x, w.z - at.z)),
        nudged: Math.round(Math.hypot(w.x - laid.x, w.z - laid.z)),
        bodies: rec.bodies.map((m) => ({
          who: m.entry?.id ?? '?',
          fromNest: Math.round(Math.hypot(m.pos.x - w.x, m.pos.z - w.z)),
          fromEye: Math.round(Math.hypot(m.pos.x - at.x, m.pos.z - at.z)),
          dead: m.dead,
          level: m.level ?? null,
        })),
      });
    }
    return out.sort((a, b) => a.away - b.away);
  }
}

/** What kind of site a lair makes, for the console: a nest, a camp, or a herd (a group of people counts as one). */
function kindOf(def: LairDef): 'nest' | 'camp' | 'herd' {
  if (isCamp(def)) return 'camp';
  return def.building === 'none' ? 'herd' : 'nest';
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * How far from a site's middle its camp's pieces and what its client data hangs on it reach, metres:
 * what the ground must already cover about the middle before the site stands.
 */
function reachOf(pieces: readonly PlacedPiece[], effects: readonly NestEffect[] | undefined): number {
  let r = 0;
  for (const p of pieces) r = Math.max(r, Math.hypot(p.cx, p.cz) + p.radius, Math.hypot(p.x, p.z));
  for (const e of effects ?? []) {
    const t = e?.transform;
    if (t && t.length >= 12) r = Math.max(r, Math.hypot(t[3], t[11]));
  }
  return r;
}

/**
 * A point in the pack's frame, in the world's.
 *
 * The same mirror every placed object goes through (`LayoutStreamer`), and the one thing in this
 * file that would put a whole planet's wildlife on the wrong side of the map if it were left out.
 */
export function intoWorld(x: number, z: number, centre: { x: number; z: number }): { x: number; z: number } {
  return { x: -(x - centre.x), z: z - centre.z };
}

/** The one for the session, as `outdoorNav` and the loose props are. */
export const wildLife = new WildLife();

export { LAIR_TUNE, NEST_MODEL_TUNE };
