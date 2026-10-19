// SOE's own people for Kashyyyk and Mustafar, on the owner's install only: the local overlay the converter writes
// with `spawns --nge=<folder>` (`tools/swg/ngepack.mjs`) into `assets-private/nge/`, fetched and laid over the
// world's own wildlife pack here.
//
// **Nobody else ever has it.** The overlay is read off the owner's local copy of SOE's server data at conversion
// time, never committed, never shipped, and no launcher ever asks for it, so for every other player the one thing
// this file does is ask once a session for an index that is not there. Where it is there, a world it lists takes
// its rows and areas **after** Core3's and the heralds' (`mergeOverlay`, `WildLife.overlayRows`): every Core3 row
// and herald keeps its place in the list and so its `stood:` name in every browser, and every name the overlay
// brings is `nge:`-prefixed, so nothing of it can stand for one of Core3's.
//
// **Where a server holds the world** it is left out unless the owner says otherwise (`NGE_OVERLAY_TUNE.where`):
// his rule that every client has the same content (2026-10-04) means bodies only his browser holds, that nobody
// else could see or fight, have no place on a server others share.
//
// Rule for this file (node runs it with type stripping for the tests): every import with its `.ts` extension, no
// enum, no namespace, no constructor parameter properties.

import { PROPS_KEEPER_TUNE } from '../net/propsKept.ts';
import type { WildManifest, WildPack } from './wildLife.ts';

/** Where the local overlay stands: where no server holds the world (`alone`), on a server as well (`always`), or nowhere. */
export type NgeWhere = 'alone' | 'always' | 'never';

/**
 * Every number and switch of the overlay's at run time. `where` is read at the next arrival: `alone` is the
 * default (§10 Q6 of the pass's design, ours), and `localStorage['swg.nge']` (`'0'` or `'always'`) is the
 * owner's to keep, read once at load; `__debug.people({ nge })` moves it in memory. `roamEvery` is how often a
 * person of the overlay that steps about its spot takes a step, seconds: null is the standing people's own
 * (`PEOPLE_TUNE.postEvery`), and a pair of its own is the owner's to try.
 *
 * `arrivalClear` is how far, in metres, anything of the overlay that picks a fight on sight is kept from the
 * place this world brings a player in and back at: the arrival, the spot a teleport stands them on, and so where
 * a death comes round on a world with no cloning facility, which no zone of Kashyyyk's or Mustafar's has. A
 * person is kept off by its own spot and its roam, and by every point of its round; a herd by its middle and its
 * spread (`rowKeptOff`, `nearArrival`); and one already standing there when that place moves is put down. Ours:
 * the data can stand such people beside the very spot the game sets a player down on, and arriving among them
 * killed the player there and again at every coming round. 64 is the brain's farthest sight on a big body
 * (`BRAIN_TUNE.aggroBig`, 48 m) and room to turn round in; nought stands everybody where the data does. Live
 * (`__debug.people({ arrivalClear })`), read at every pass.
 */
export const NGE_OVERLAY_TUNE: { where: NgeWhere; roamEvery: [number, number] | null; arrivalClear: number } = {
  where: 'alone',
  roamEvery: null,
  arrivalClear: 64,
};

/** A point in the world's frame. */
interface At {
  readonly x: number;
  readonly z: number;
}

/**
 * Whether a place lies within `NGE_OVERLAY_TUNE.arrivalClear` and `reach` more metres of where this world brings
 * a player in and back (`arrival`, in the world's frame). Never with no such place, or a clear of nought.
 */
export function nearArrival(x: number, z: number, arrival: At | null | undefined, reach = 0, clear: number = NGE_OVERLAY_TUNE.arrivalClear): boolean {
  if (!arrival || !(clear > 0)) return false;
  const dx = x - arrival.x;
  const dz = z - arrival.z;
  const r = clear + Math.max(0, reach);
  return dx * dx + dz * dz < r * r;
}

/**
 * Whether one of the overlay's people is kept off the place a player comes in and back at (`arrivalClear`): only a
 * row of the overlay's (`src: 'nge'`) whose person this life picks a fight on sight (`aggressive`), where its own
 * spot (`stand`, in the world's frame) and its roam, or any point of its round, lie inside the clear.
 */
export function rowKeptOff(r: { readonly src?: string; readonly roam?: number; readonly route?: readonly At[] }, stand: At, aggressive: boolean, arrival: At | null | undefined, clear: number = NGE_OVERLAY_TUNE.arrivalClear): boolean {
  if (r.src !== 'nge' || !aggressive || !arrival || !(clear > 0)) return false;
  if (nearArrival(stand.x, stand.z, arrival, typeof r.roam === 'number' && r.roam > 0 ? r.roam : 0, clear)) return true;
  for (const p of r.route ?? []) if (nearArrival(p.x, p.z, arrival, 0, clear)) return true;
  return false;
}

/** Whether a creature of the pack's fleet half picks a fight on sight: its own `game` temper, else its record's flag. */
export function picksFights(c: { readonly game?: { readonly aggression?: unknown }; readonly aggressive?: unknown } | null | undefined): boolean {
  if (!c) return false;
  if (c.game && typeof c.game.aggression === 'string') return c.game.aggression === 'aggressive';
  return c.aggressive === true;
}

/** Every name the overlay brings begins with this (`NGE_PREFIX` in tools/swg/ngepack.mjs). */
export const NGE_PREFIX = 'nge:';

/** A stored or typed word for `where`, or null where it is none. `'0'` is the switch off the README names. */
export function whereOf(word: unknown): NgeWhere | null {
  if (word === '0' || word === 'never' || word === false) return 'never';
  if (word === 'always') return 'always';
  if (word === 'alone') return 'alone';
  return null;
}

/** Whether the overlay stands at an arrival: never, always, or where no server holds the world. */
export function overlayStands(where: NgeWhere, serverHolds: boolean): boolean {
  if (where === 'never') return false;
  if (where === 'always') return true;
  return !serverHolds;
}

/**
 * Whether a server others share holds the world an arrival is for, as the overlay asks it, or null while that
 * cannot be said yet. The props keeper's own rule from an arrival (`keeperOf` in `src/net/propsKept.ts`): a
 * server that has taken this browser's claim holds it; a line wanted and not yet answered is waited on for
 * `waitMs`, after which nobody holds it; no line wanted, nobody does. Two answers are its own: a far end that
 * answered as the relay that came before is still a server others share, though it keeps nothing; and a session's
 * first world, whose saved server is connected only after its loading screen (`connectToCome`), is taken as held,
 * since nothing can answer before that screen lifts and the overlay is stood only behind it.
 */
export function serverHoldsFor(line: { readonly authority: string; readonly mode: string }, wanted: boolean, connectToCome: boolean, sinceMs: number, waitMs: number = PROPS_KEEPER_TUNE.waitMs): boolean | null {
  if (line.authority === 'server') return true;
  if (connectToCome) return true;
  if (!wanted) return false;
  if (line.mode === 'relay') return true;
  return sinceMs < waitMs ? null : false;
}

/** The index the converter writes beside the overlay, as far as the game reads it. */
export interface OverlayIndex {
  format?: number;
  local?: boolean;
  source?: string;
  converted?: string;
  zones?: Record<string, { rows?: number; areas?: number }>;
}

/** An empty pack for a world Core3 holds nothing of, named for the world so its rows are keyed by it. */
export function emptyPack(planet: string): WildPack {
  return { format: 2, planet, areas: [], noSpawn: [], statics: [], pools: {} };
}

/** An empty fleet half, for a game with no Core3 manifest at all. */
export function emptyManifest(): WildManifest {
  return { format: 2, creatures: {}, lairs: {}, groups: {}, nests: {}, weaponGroups: {}, camps: {}, campModels: {} };
}

/** The first name the overlay brings that is not `nge:`-prefixed, or null: an overlay naming one is refused whole. */
export function strayName(over: WildPack, overManifest: WildManifest): string | null {
  const bad = (n: unknown): boolean => typeof n !== 'string' || !n.startsWith(NGE_PREFIX);
  const keys = (o: Record<string, unknown> | undefined): string[] => (o ? Object.keys(o) : []);
  for (const table of [overManifest.creatures, overManifest.lairs, overManifest.groups, overManifest.weaponGroups, overManifest.nests, overManifest.camps, over.pools]) {
    for (const k of keys(table as Record<string, unknown> | undefined)) if (bad(k)) return k;
  }
  for (const a of [...(over.areas ?? []), ...(over.noSpawn ?? [])]) {
    if (bad(a.name)) return String(a.name);
    for (const g of a.groups ?? []) if (bad(g)) return g;
  }
  for (const l of Object.values(overManifest.lairs ?? {})) for (const m of l.mobiles ?? []) if (bad(m.who)) return String(m.who);
  for (const list of Object.values(overManifest.groups ?? {})) for (const e of list) if (bad(e.lair)) return String(e.lair);
  for (const raw of over.statics ?? []) {
    const r = raw as { who?: unknown; draw?: unknown };
    if (r.who !== null && r.who !== undefined && bad(r.who)) return String(r.who);
    if (Array.isArray(r.draw)) for (const d of r.draw) if (!Array.isArray(d) || bad(d[0])) return String(Array.isArray(d) ? d[0] : d);
  }
  return null;
}

/**
 * A world's wild pack with the overlay laid over it: the areas and the places nothing may stand appended to
 * Core3's, the overlay's towns' lists, creatures, lairs, groups and weapon groups beside Core3's, and the
 * overlay's people handed back apart (`rows`), to be stood after Core3's and the heralds'. With no Core3 pack
 * the world starts from an empty one named for the overlay's world, so every row is keyed by it and never by
 * nobody's. Handed no overlay it hands back exactly what it was given. An overlay naming anything not
 * `nge:`-prefixed is refused whole (`strayName`): it throws, and the caller stands Core3's alone.
 */
export function mergeOverlay(pack: WildPack | null, manifest: WildManifest | null, over: WildPack | null, overManifest: WildManifest | null): { pack: WildPack | null; manifest: WildManifest | null; rows: readonly unknown[] } {
  if (!over || !overManifest) return { pack, manifest, rows: [] };
  const stray = strayName(over, overManifest);
  if (stray !== null) throw new Error(`the local overlay names ${JSON.stringify(stray)}, which is not ${NGE_PREFIX}-prefixed`);
  const base = pack ?? emptyPack(over.planet);
  const fleet = manifest ?? emptyManifest();
  return {
    pack: {
      ...base,
      areas: [...(base.areas ?? []), ...(over.areas ?? [])],
      noSpawn: [...(base.noSpawn ?? []), ...(over.noSpawn ?? [])],
      pools: { ...(base.pools ?? {}), ...(over.pools ?? {}) },
    },
    manifest: {
      ...fleet,
      creatures: { ...fleet.creatures, ...overManifest.creatures },
      lairs: { ...fleet.lairs, ...overManifest.lairs },
      groups: { ...fleet.groups, ...overManifest.groups },
      nests: { ...(fleet.nests ?? {}), ...(overManifest.nests ?? {}) },
      weaponGroups: { ...(fleet.weaponGroups ?? {}), ...(overManifest.weaponGroups ?? {}) },
      camps: { ...(fleet.camps ?? {}), ...(overManifest.camps ?? {}) },
      campModels: { ...(fleet.campModels ?? {}), ...(overManifest.campModels ?? {}) },
    },
    rows: over.statics ?? [],
  };
}

/**
 * The list a world's standing people are adopted from, in the order that names them (`stood:<world>:<n>`): the
 * world's own rows, the heralds beside them where it has any, the people of ours a rule of the game's stands there
 * (`ours`: the First Brigade in Restuss's ruins, in the list whatever state the world stands in, `restuss.ts`), and
 * the local overlay's after all of them, so neither an overlay nor a state moves any name of anybody else's in any
 * browser.
 */
export function standingList<T>(own: readonly T[], heralds: readonly T[], overlay: readonly T[], ours: readonly T[] = []): readonly T[] {
  const first = own.length ? [...own, ...heralds, ...ours] : own;
  return overlay.length ? [...first, ...overlay] : first;
}

/** A fetch's answer read as JSON only where it is one: a missing file is a 404, or a page another server hands back. */
async function jsonOf(res: Response): Promise<unknown> {
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
  return res.json();
}

/**
 * The overlay as this browser has it: the index fetched once a session (for a player without the overlay, the
 * one request that misses), each world's pack fetched as the world loads, the fleet manifest once. `last` says
 * what the last world that listed it made of it, for the console and the load's line.
 */
export class NgeOverlay {
  private index: OverlayIndex | null = null;
  private pending: Promise<void> | null = null;
  private manifest: WildManifest | null = null;
  private manifestFor = '';
  /** The last world the index listed: what it stood, or why it was left out (`server`, `off`, `refused`, `missing`). */
  readonly last = { world: '', rows: 0, areas: 0, left: '' };

  /** Ask for the index, once a session; a later call waits on the same answer. */
  fetchIndex(base = ''): Promise<void> {
    if (!this.pending) {
      this.pending = (async () => {
        try {
          const got = (await jsonOf(await fetch(`${base}assets-private/nge/index.json`, { cache: 'no-store' }))) as OverlayIndex | null;
          this.index = got && got.local === true && got.source === 'nge' && got.zones && typeof got.zones === 'object' ? got : null;
        } catch {
          this.index = null;
        }
      })();
    }
    return this.pending;
  }

  /** Whether this install has the overlay at all. */
  get present(): boolean {
    return !!this.index;
  }

  /** Whether the index lists a world (its pack id). */
  overlayFor(planetId: string): boolean {
    return !!this.index?.zones && Object.prototype.hasOwnProperty.call(this.index.zones, planetId);
  }

  /** Whether the index lists a world, once the index is in. */
  async listed(planetId: string, base = ''): Promise<boolean> {
    await this.fetchIndex(base);
    return this.overlayFor(planetId);
  }

  /** A listed world's pack and the fleet's manifest, or null where either is missing or is no pack. */
  async load(planetId: string, base = ''): Promise<{ pack: WildPack; manifest: WildManifest } | null> {
    try {
      const stamp = this.index?.converted ?? '';
      const [pack, manifest] = await Promise.all([
        fetch(`${base}assets-private/nge/spawns/${planetId}.json`, { cache: 'no-store' }).then(jsonOf),
        this.manifest && this.manifestFor === stamp ? Promise.resolve(this.manifest) : fetch(`${base}assets-private/nge/spawns/manifest.json`, { cache: 'no-store' }).then(jsonOf),
      ]);
      const p = pack as WildPack | null;
      const m = manifest as WildManifest | null;
      if (!p || !Array.isArray(p.areas) || !m || !m.lairs) return null;
      this.manifest = m;
      this.manifestFor = stamp;
      return { pack: p, manifest: m };
    } catch {
      return null;
    }
  }

  /** Everything this browser holds of it forgotten, so the next load asks again (a node test's fresh start). */
  forget(): void {
    this.index = null;
    this.pending = null;
    this.manifest = null;
    this.manifestFor = '';
    this.last.world = '';
    this.last.rows = 0;
    this.last.areas = 0;
    this.last.left = '';
  }

  /** What `__debug.people()` and `__debug.wild()` say of it. */
  report(): { present: boolean; where: NgeWhere; roamEvery: [number, number] | null; arrivalClear: number; worlds: string[]; last: { world: string; rows: number; areas: number; left: string } } {
    return { present: this.present, where: NGE_OVERLAY_TUNE.where, roamEvery: NGE_OVERLAY_TUNE.roamEvery, arrivalClear: NGE_OVERLAY_TUNE.arrivalClear, worlds: Object.keys(this.index?.zones ?? {}), last: { ...this.last } };
  }
}

/** The one for the session. */
export const ngeOverlay = new NgeOverlay();
