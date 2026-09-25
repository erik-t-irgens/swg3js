// The world's own wildlife: lairs and herds laid across a planet's spawn areas and stood as the
// player comes near them.
//
// What it is built on is `mobiles/lairs.ts`, which holds every rule and every invented number and is
// pure. This file is the part that cannot be pure: it fetches the pack, keeps what is standing, and
// talks to the mobile manager. It is shaped like `outdoorNav` and `looseProps` deliberately -- one
// singleton, a `load` that a token can overtake, an `adopt` split out so a node test can hand it
// bytes, an `unload`, and a `step` -- because those two are the pattern this world already knows.
//
// **Three things it must get right and would be easy to get wrong.**
//
// It is stepped from `World.stepLiving` and not from `World.update`, because `simTime` is only
// advanced there and `__debug.advance` calls only that one. A respawn clock hung off the other hook
// could never be driven headless, and CLAUDE.md makes that rule explicit.
//
// **The pack's coordinates are the snapshot's and the world's are not.** Every placed object in this
// game goes through `LayoutStreamer`'s own mirror -- `gx = -(x - centre.x)`, `gz = z - centre.z` --
// and these numbers have to go through the same one or every creature stands on the wrong side of
// the planet. The heading is mirrored with it: a reflection in x turns a yaw into its negative.
//
// And it holds when the world holds. An ultra cruise crosses a system at ten kilometres a second
// with the placed-object streamer pinned (`World.streamHold`); a wild pass that ignored that would
// stand and drop several hundred lairs in a few seconds, compiling a shader for each new creature
// on a live frame.

import * as THREE from 'three';
import {
  LAIR_TUNE,
  bodyAt,
  creatureAt,
  lairHealth,
  reinforcements,
  lairSites,
  respawnWait,
  spreadOf,
  standingAt,
  wanted,
  type CreatureDef,
  type GroupEntry,
  type LairDef,
  type LairSite,
  type SpawnArea,
} from './mobiles/lairs.ts';
import type { MobileCatalogue } from './mobiles/catalogue.ts';
import type { MobileEntry } from './mobiles/types.ts';
import type { Mobile } from './mobiles/mobile.ts';
import { WildNest, type NestDeps } from './wildNest.ts';

/** A world's own half of the pack: its areas and the people who stand still in it. */
export interface WildPack {
  format: number;
  planet: string;
  areas: SpawnArea[];
  noSpawn: SpawnArea[];
  statics: unknown[];
}

/** The fleet's half: what every lair holds and what every creature is. */
export interface WildManifest {
  format: number;
  creatures: Record<string, CreatureDef>;
  lairs: Record<string, LairDef>;
  groups: Record<string, GroupEntry[]>;
  nests?: Record<string, { id: string; file: string }>;
}

/** What the wild world needs of the game. Narrow on purpose, so a node test can be the game. */
export interface WildDeps {
  /** The catalogue, or null before its one boot fetch has landed. */
  catalogue(): MobileCatalogue | null;
  /** Stand one. A string back is the refusal sentence, never an exception. */
  spawn(entry: MobileEntry, at: { x: number; z: number; y?: number; heading?: number }, seed: number): Mobile | string;
  /** Take one down. */
  remove(m: Mobile): void;
  /** The layout's centre, which the snapshot's numbers are measured from; null before the pack lands. */
  centre(): { x: number; z: number } | null;
  /** True while the world is holding everything still (an ultra cruise), or has no streaming at all. */
  held(): boolean;
  /**
   * What a nest needs to stand in the world, or null where there is no world to stand it in (a node
   * test). With none, a lair is its creatures and nothing in the middle, which is what it was.
   */
  nest?: NestDeps | null;
  /** The ground under a point, for the nest alone: a creature's height is the manager's business. */
  groundAt?(x: number, z: number): number;
}

/** One standing site as the console sees it. */
export interface WildReport {
  key: string;
  lair: string;
  nest: { up: boolean; hp: number; of: number; dead: boolean } | 'no model' | false;
  broken: boolean;
  away: number;
  bodies: { who: string; fromNest: number; fromEye: number; dead: boolean }[];
}

/** One site that is standing now. */
interface Standing {
  site: LairSite;
  def: LairDef;
  bodies: Mobile[];
  /** The thing in the middle, where the lair has one and its model is converted. */
  nest: WildNest | null;
  /** When it last sent more out, on the world's own clock. */
  helpedAt: number;
  /** When it was broken, on the world's own clock; 0 while it is up. */
  brokeAt: number;
  /** How long it stays broken. */
  wait: number;
  /** How many of its own were really killed here, as against taken away by the game. */
  killed: number;
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
};

export class WildLife {
  private pack: WildPack | null = null;
  private manifest: WildManifest | null = null;
  private sites: LairSite[] = [];
  private readonly standing = new Map<string, Standing>();
  private token = 0;
  private since = 0;
  private readonly lastAt = new THREE.Vector3(NaN, NaN, NaN);
  /** For the console: what the last pass did and what is up now. */
  readonly last = { sites: 0, up: 0, bodies: 0, stood: 0, dropped: 0, refused: '' };

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

  /** Take a pack that is already parsed: the half a node test can drive. */
  adopt(pack: WildPack | null, manifest: WildManifest | null): void {
    this.pack = pack?.format === 1 && Array.isArray(pack.areas) ? pack : null;
    this.manifest = manifest?.format === 1 && manifest.lairs ? manifest : null;
    this.sites = [];
    if (!this.pack || !this.manifest) return;
    const world = this.pack.planet;
    for (const area of this.pack.areas) {
      for (const s of lairSites(world, area, this.manifest.groups)) {
        // A site inside a place the server said nothing may stand is simply not a site. The data
        // carries 780 of those and they are mostly the ground a town is built on.
        if (this.pack.noSpawn.some((n) => insideArea(n, s.x, s.z))) continue;
        this.sites.push(s);
      }
    }
    this.last.sites = this.sites.length;
  }

  unload(): void {
    this.token++;
    this.clear();
    this.pack = null;
    this.manifest = null;
    this.sites = [];
    this.last.sites = 0;
  }

  /** Put every standing body down without touching the pack: what a reload of the rules wants. */
  restand(): void {
    this.clear();
    this.lastAt.set(NaN, NaN, NaN);
    this.since = WILD_TUNE.everySeconds;
  }

  private clear(): void {
    // Every nest goes with it. A nest holds a body in the physics world, a group in the scene and
    // its own copies of the model's materials, and dropping the record without disposing it leaves
    // all three behind -- which on a world unload is a material still in the portal renderer's set,
    // walked a dozen times a frame for the rest of the session.
    for (const rec of this.standing.values()) rec.nest?.dispose();
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
    this.last.stood = 0;
    this.last.dropped = 0;
    if (!this.ready || deps.held()) return;
    const cat = deps.catalogue();
    const centre = deps.centre();
    if (!cat || !centre) return;
    this.since += dt;
    const moved = !Number.isFinite(this.lastAt.x) || this.lastAt.distanceTo(at) > WILD_TUNE.moveMetres;
    if (this.since < WILD_TUNE.everySeconds && !moved) {
      // A nest being struck answers on the frame it is struck, not on the next slow pass.
      this.reinforce(now, cat, centre, deps);
      this.reap(now, deps);
      return;
    }
    this.since = 0;
    this.lastAt.copy(at);

    // The pass works in the pack's own frame, because that is what the sites are in; the player's
    // place is carried back into it rather than every site being carried forward.
    const mine = { x: centre.x - at.x, z: at.z + centre.z };
    const live = new Set(this.standing.keys());
    const { add, drop } = wanted(this.sites, mine, live);
    for (const key of drop) this.put(key, deps);
    let stood = 0;
    for (const site of add) {
      if (stood >= WILD_TUNE.sitesPerPass) break;
      if (this.stand(site, now, cat, centre, deps)) stood++;
    }
    this.reinforce(now, cat, centre, deps);
    this.reap(now, deps);
  }

  /** Stand one site: its lair's own creatures, round the spot the seed drew. */
  private stand(site: LairSite, now: number, cat: MobileCatalogue, centre: { x: number; z: number }, deps: WildDeps): boolean {
    const def = this.manifest?.lairs[site.lair];
    if (!def) return false;
    const n = standingAt(def, site.seed);
    const spread = spreadOf(def);
    const rec: Standing = { site, def, bodies: [], nest: null, helpedAt: -Infinity, brokeAt: 0, wait: respawnWait(site.seed), killed: 0 };
    for (let i = 0; i < n; i++) {
      const who = creatureAt(def, site.seed, i);
      if (!who) continue;
      const c = this.manifest?.creatures[who];
      if (!c) continue;
      const entry = cat.byId(c.id);
      if (!entry) continue;
      const spot = bodyAt(site, i, spread);
      const world = intoWorld(spot.x, spot.z, centre);
      const middle = intoWorld(site.x, site.z, centre);
      // **No height is given on purpose.** The manager works one out itself when it is not told one
      // (`manager.ts:279`), and its answer is the real ground: what is standing there, a floor, a
      // platform, a rock. Handing it the raw terrain height instead puts a body under the floor of
      // anything built on that spot -- a camp's own hut, say -- and the physics then ejects it
      // downward, out of the world, where the manager takes it away as spent. Which looks, from
      // outside, exactly like a lair that stood and then vanished.
      const m = deps.spawn(entry, { x: world.x, z: world.z, heading: -spot.heading }, site.seed ^ i);
      if (typeof m === 'string') {
        this.last.refused = m;
        continue;
      }
      // **Its home is the nest, not the spot it was put down on.** A mobile's home is where it was
      // stood, and the brain wanders it eight to thirty metres from home every few seconds; a body
      // stood five to fourteen metres out to begin with therefore drifts to forty from the thing it
      // is supposed to be guarding, and going to the lair finds an empty patch of ground. Giving
      // every one of them the site's own middle makes them range about the nest instead, which is
      // what "four or five standing round it" means.
      m.homeX = middle.x;
      m.homeZ = middle.z;
      rec.bodies.push(m);
    }
    if (!rec.bodies.length) return false;
    // The nest, where the lair has one and its model is converted. It is built behind the creatures
    // rather than before them: a site with its animals up and its mound still arriving is a site,
    // and one that waited for the mound would stand nothing at all on a world with no nests.
    const file = def.nest ? this.manifest?.nests?.[def.nest]?.file : null;
    if (file && deps.nest) {
      const middle = intoWorld(site.x, site.z, centre);
      const nest = new WildNest(def.nest ?? 'nest', lairHealth(def, this.manifest?.creatures ?? {}));
      rec.nest = nest;
      void nest.build(file, { x: middle.x, y: deps.groundAt?.(middle.x, middle.z) ?? 0, z: middle.z }, deps.nest).then((made) => {
        // Put away while it was loading: the record is gone and nothing will ever take it down.
        if (!made || this.standing.get(site.key) !== rec) nest.dispose();
      });
    }
    this.standing.set(site.key, rec);
    this.last.stood += rec.bodies.length;
    this.count();
    return true;
  }

  /** Put a site away: every body it stood, and the record. */
  private put(key: string, deps: WildDeps): void {
    const rec = this.standing.get(key);
    if (!rec) return;
    rec.nest?.dispose();
    rec.nest = null;
    for (const m of rec.bodies) deps.remove(m);
    this.last.dropped += rec.bodies.length;
    this.standing.delete(key);
    this.count();
  }

  /**
   * Forget the dead, and let a site that has lost everything come back on its own clock.
   *
   * A body the manager has taken down (killed, or swept) is dropped from the record here rather
   * than being chased, so nothing holds a reference to a mobile that has gone.
   */
  /**
   * A struck nest sends more of its own out, and a broken one never does again.
   *
   * This is the owner's own account of a lair and the whole reason it is worth walking up to one:
   * hitting it makes it worse before it makes it better, and the only way to stop that is to break
   * it. The cooldown and how many come at a time are ours; the ceiling is the server's, which is the
   * one number in its data that says how much of a creature belongs at one nest.
   */
  private reinforce(now: number, cat: MobileCatalogue, centre: { x: number; z: number }, deps: WildDeps): void {
    for (const rec of this.standing.values()) {
      const nest = rec.nest;
      if (!nest || !nest.wantsHelp) continue;
      nest.wantsHelp = false;
      // Broken is broken: nothing more comes out of it, ever, which is what killing it is for.
      if (nest.dead) continue;
      const n = reinforcements(rec.def, rec.bodies.length, now - rec.helpedAt);
      if (n <= 0) continue;
      rec.helpedAt = now;
      const spread = spreadOf(rec.def);
      for (let k = 0; k < n; k++) {
        // Drawn from the nest's own seed and the count so far, so two browsers watching one lair
        // being attacked bring the same creatures out in the same places.
        const i = rec.bodies.length + k;
        const who = creatureAt(rec.def, rec.site.seed, i);
        const c = who ? this.manifest?.creatures[who] : null;
        const entry = c ? cat.byId(c.id) : null;
        if (!entry) continue;
        const spot = bodyAt(rec.site, i, spread);
        const world = intoWorld(spot.x, spot.z, centre);
        const middle = intoWorld(rec.site.x, rec.site.z, centre);
        const m = deps.spawn(entry, { x: world.x, z: world.z, heading: -spot.heading }, rec.site.seed ^ i);
        if (typeof m === 'string') {
          this.last.refused = m;
          continue;
        }
        m.homeX = middle.x;
        m.homeZ = middle.z;
        rec.bodies.push(m);
      }
      this.count();
    }
  }

  private reap(now: number, deps: WildDeps): void {
    void deps;
    for (const [key, rec] of this.standing) {
      const before = rec.bodies.length;
      // **Killed is not the same as gone**, and telling them apart is not `dead` alone: disposing a
      // mobile sets `dead` too (`mobile.ts:2077`), so a body the game merely took away reads exactly
      // like one somebody fought. What separates them is the corpse. A creature that really died is
      // dead and still in the world, lying there for its death clip and its timer; one that was
      // taken away is dead and gone in the same instant. So a kill is only counted while the body is
      // still there to see, and a site that lost its creatures any other way stands them again on
      // the next pass rather than sitting broken for ten minutes.
      for (const m of rec.bodies) if (m.dead && !m.removed) rec.killed++;
      rec.bodies = rec.bodies.filter((m) => !m.dead && !m.removed);
      if (rec.bodies.length !== before) this.count();
      if (rec.bodies.length === 0) {
        if (rec.killed === 0) {
          // Nothing was killed here: forget it and let it stand again at once.
          this.standing.delete(key);
          this.count();
          continue;
        }
        if (rec.brokeAt === 0) rec.brokeAt = now;
      }
      // Once its clock is out the site is forgotten, and the next pass that comes near stands it
      // again from the same seed: the same animals in the same places, as the same world should.
      if (rec.brokeAt > 0 && now - rec.brokeAt >= rec.wait) {
        this.standing.delete(key);
        this.count();
      }
    }
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
   * A world lays hundreds of these over sixteen kilometres and stands only the four you are next
   * to, so "is any of this working" is not a question the view can answer by itself: this is what
   * says where the nearest one is so somebody can go and look at it.
   */
  nearest(at: THREE.Vector3, centre: { x: number; z: number } | null, n = 5): { key: string; lair: string; x: number; z: number; away: number; up: boolean }[] {
    if (!centre) return [];
    const out = this.sites.map((s) => {
      const w = intoWorld(s.x, s.z, centre);
      return { key: s.key, lair: s.lair, x: Math.round(w.x), z: Math.round(w.z), away: Math.round(Math.hypot(w.x - at.x, w.z - at.z)), up: this.standing.has(s.key) };
    });
    return out.sort((a, b) => a.away - b.away).slice(0, n);
  }

  /**
   * The nest whose collider this is, for `World.hittableAt`: how a bolt or a blade reaches one.
   *
   * Walked rather than kept in a map because there are never more than a handful standing and the
   * map would be one more thing to keep in step with the disposals.
   */
  nestAt(handle: number): WildNest | undefined {
    for (const rec of this.standing.values()) if (rec.nest?.handle === handle) return rec.nest;
    return undefined;
  }

  /** What one site would stand, without standing it: for the console, and for a check. */
  holds(key: string): { lair: string; creatures: string[] } | null {
    const site = this.sites.find((s) => s.key === key);
    const def = site ? this.manifest?.lairs[site.lair] : null;
    if (!site || !def) return null;
    const who: string[] = [];
    for (let i = 0; i < standingAt(def, site.seed); i++) {
      const c = creatureAt(def, site.seed, i);
      if (c) who.push(c);
    }
    return { lair: site.lair, creatures: who };
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
  report(
    at: THREE.Vector3,
    centre: { x: number; z: number } | null,
  ): WildReport[] {
    const out: WildReport[] = [];
    for (const rec of this.standing.values()) {
      const w = centre ? intoWorld(rec.site.x, rec.site.z, centre) : { x: rec.site.x, z: rec.site.z };
      out.push({
        key: rec.site.key,
        lair: rec.site.lair,
        // A herd has no nest to stand round, which is worth seeing: it explains an empty middle.
        // Where there is one, its health says whether it is up, being fought, or broken.
        nest: rec.nest ? { up: rec.nest.up, hp: Math.round(rec.nest.hp), of: rec.nest.maxHp, dead: rec.nest.dead } : rec.def.nest ? 'no model' : false,
        broken: rec.brokeAt > 0,
        away: Math.round(Math.hypot(w.x - at.x, w.z - at.z)),
        bodies: rec.bodies.map((m) => ({
          who: m.entry?.id ?? '?',
          fromNest: Math.round(Math.hypot(m.pos.x - w.x, m.pos.z - w.z)),
          fromEye: Math.round(Math.hypot(m.pos.x - at.x, m.pos.z - at.z)),
          dead: m.dead,
        })),
      });
    }
    return out.sort((a, b) => a.away - b.away);
  }
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

/** Whether a point is in an area. A copy of the rule in `lairs.ts`, kept local so this imports no more. */
function insideArea(a: SpawnArea, x: number, z: number): boolean {
  if (a.shape === 'rect') {
    const x2 = a.x2 ?? a.x;
    const z2 = a.z2 ?? a.z;
    return x >= Math.min(a.x, x2) && x <= Math.max(a.x, x2) && z >= Math.min(a.z, z2) && z <= Math.max(a.z, z2);
  }
  const d = Math.hypot(x - a.x, z - a.z);
  return d <= (a.r ?? 0) && d >= (a.shape === 'ring' ? (a.inner ?? 0) : 0);
}

/** The one for the session, as `outdoorNav` and the loose props are. */
export const wildLife = new WildLife();

export { LAIR_TUNE };
