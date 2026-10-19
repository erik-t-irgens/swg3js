// The deeds a player buys a building with, as the game knows them.
//
// The pack (`assets-private/deeds.json`, written by the converter's `deeds` command) is fetched once
// for the session and read through here. Every number in it is the game's or the server's: what each
// deed makes, what the game called it, how many lots it takes, what it cost to keep, which worlds it
// may stand on, and the grid the client drew under it while you placed it.
//
// A pack that is not converted leaves the list empty and the Housing tab says so; nothing else in
// the game changes.
//
// Pure of three and of the DOM: it fetches and it answers questions. The rules that use it are
// `src/world/housePlace.ts`, which is pure of fetching too.

import type { Footprint, Patch } from './housePlace.ts';
import { planetById } from '../data/planets.ts';

/** One deed, as the pack carries it. */
export interface DeedRow {
  id: string;
  /** What the game called it, or words made from its key when the string tables had none. */
  name: string;
  /** False when the name was made up here rather than read out of the game. */
  named: boolean;
  desc: string;
  /** The building template it makes, which is the server's own word and is kept for the record. */
  makes: string;
  /** The model this game draws it with, or null when this game carries none. */
  model: string | null;
  /** The portal layout its building names, even where no model was converted for it. */
  layout: string | null;
  /** How many lots it takes up, as the server counted them. */
  lots: number;
  /** What it cost a day to keep standing. */
  upkeep: number;
  /** The worlds it may stand on; an empty list means the server named none. */
  zones: string[];
  /** The grid the client placed it on, or null where the archives have none. */
  foot: { w: number; h: number; px: number; pz: number; cw: number; ch: number; rows: string[] } | null;
  /** The patch that grid asks for, worked out by the converter and checked against the game's own copy. */
  patch: Patch | null;
  /**
   * A deed of ours (the converter's `OUR_DEEDS`): a client deed Core3 never knew, paired with its building by the two
   * templates' own names. Its lots and upkeep were the server's and are not known, so it carries none and every world.
   */
  ours?: boolean;
}

export interface DeedPack {
  version: number;
  counts: Record<string, number>;
  deeds: DeedRow[];
  /** The converter's late stamp: whether SOE's final files were in the mount it was written from. */
  late?: unknown;
}

/** The shape this build understands. A pack written by an older run is ignored and asked for again. */
export const DEED_PACK_VERSION = 1;

let pending: Promise<DeedPack | null> | null = null;
let rows: DeedRow[] = [];
let byId = new Map<string, DeedRow>();
/** The pack's late stamp once it has landed (null for one with none), undefined before. */
let lateStamp: unknown = undefined;

/**
 * The pack, fetched once for the session. A missing file (or a dev server answering with its index
 * page) is null and the game simply has no deeds.
 */
export function loadDeeds(baseUrl: string): Promise<DeedPack | null> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const res = await fetch(`${baseUrl}assets-private/deeds.json`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      const pack = (await res.json()) as DeedPack;
      if (pack?.version !== DEED_PACK_VERSION || !Array.isArray(pack.deeds)) return null;
      rows = pack.deeds;
      byId = new Map(rows.map((d) => [d.id, d]));
      lateStamp = pack.late ?? null;
      return pack;
    } catch {
      return null;
    }
  })();
  return pending;
}

/** Every deed the pack carries, in the order it was written (by id). */
export function allDeeds(): readonly DeedRow[] {
  return rows;
}

/** The pack's late stamp (whether SOE's final files were in the mount), null for one with none, undefined before it has landed. */
export function deedsLate(): unknown {
  return lateStamp;
}

/** One deed by its id, or null. */
export function deedById(id: string): DeedRow | null {
  return byId.get(id) ?? null;
}

/**
 * The deed a building already standing is taken up by when it is picked up again, for the footprint it was placed
 * on: one that makes its model and carries a footprint, one that may stand on this world first. Null where no deed
 * makes it with a footprint (a building the console put down by its model alone), which is then judged on its
 * model's own box, as it was put down.
 */
export function deedOfModel(model: string, planetId: string, deeds: readonly DeedRow[] = rows): DeedRow | null {
  let any: DeedRow | null = null;
  for (const d of deeds) {
    if (d.model !== model || !d.foot) continue;
    if (!wrongWorld(d, planetId)) return d;
    any ??= d;
  }
  return any;
}

/** The deeds that can really be put down: the ones whose building this game has a model for. */
export function placeableDeeds(): DeedRow[] {
  return rows.filter((d) => !!d.model);
}

/** A deed's footprint in the shape the placing rules take, or null. */
export function footprintOf(d: DeedRow): Footprint | null {
  const f = d.foot;
  if (!f) return null;
  return { width: f.w, height: f.h, pivotX: f.px, pivotZ: f.pz, cellWidth: f.cw, cellHeight: f.ch };
}

/**
 * Why this deed cannot be put down on this world, or null.
 *
 * The worlds are the server's own `allowedZones`, and a deed that names none may stand anywhere --
 * which is what the generic house deeds do, and is the reason an empty list is not a refusal. A world of our own whose
 * ground is real-world elevation (`PlanetDef.dem`) is none of the server's zones, so every deed may stand there: kept
 * to the zones, nothing of the game's could ever go up on a custom world.
 */
export function wrongWorld(d: DeedRow, planetId: string): string | null {
  if (!d.zones.length) return null;
  if (d.zones.includes(planetId)) return null;
  if (planetById(planetId)?.dem) return null;
  const where = d.zones.length === 1 ? d.zones[0] : `${d.zones.slice(0, -1).join(', ')} or ${d.zones[d.zones.length - 1]}`;
  return `this one may only stand on ${where}`;
}

/** What a deed says about itself under its name, in one line. A deed of ours says its lots and upkeep are not known. */
export function deedLine(d: DeedRow): string {
  const size = d.foot ? `${Math.round(d.foot.w * d.foot.cw)} by ${Math.round(d.foot.h * d.foot.ch)} m` : 'no footprint';
  if (d.ours) return `${size} · lots and upkeep: not known (ours)`;
  const lots = d.lots ? `${d.lots} lot${d.lots === 1 ? '' : 's'}` : 'no lots';
  return `${size} · ${lots} · ${d.upkeep} a day`;
}
