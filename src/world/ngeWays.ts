// SOE's own ways about Kashyyyk and Mustafar, as the game uses them: where each zone gate lands, which copy of a grid
// zone a group is sent to and where in it, the Kachirho tree lifts, the Rryatt Trail's guides, the way out of a copy,
// and the clone droid a death comes round at. The converter writes them (`tools/swg/ngeways.mjs`) into
// `assets-private/nge/ways.json` from the reference beside it (the owner's ruling of 2026-10-31, under his decision of
// 2026-10-19), and this file reads them once a session and answers in the snapshot's own frame (the raw frame `/loc`
// writes): the caller carries an answer into the game's frame about the right world's layout centre (`toGame`).
//
// **What is the data's and what is ours.** Every place, every line and every rule of the clone mapping is SOE's. Which
// copy a group goes to is ours, the very hash every dungeon's copies use (`copyIndex`), so a whole group is sent to one
// copy with nothing sent between browsers; so are the words the game says, the reach at which a thing is used
// (`WAYS_TUNE`), the way out of a copy whose own people send a group back (its start, `walkOut`), and how a clone
// mapping whose target holds no droid falls through to that target's own rows.
//
// Rule for this file (node runs it with type stripping for the tests): every value import with its `.ts` extension, no
// enum, no namespace, no constructor parameter properties.

import { copyIndex } from './instances.ts';

/** A place in the snapshot's frame. */
export type V3 = readonly [number, number, number];

/** Where a way lands: a place in a zone, or a dungeon a group is sent a copy of. */
export type Landing = { readonly zone: string; readonly at: V3 } | { readonly dungeon: string };

export interface WaysGuide {
  readonly at: V3;
  readonly who: string;
  readonly area: string;
  readonly copy: number;
  readonly moves: readonly { readonly key: string; readonly level: number; readonly to: V3 }[];
}

export interface WaysZone {
  /** Every area of the zone in the table's order, `[name, x1, z1, x2, z2]`: the n-th of a name is copy n. */
  readonly areas: readonly (readonly [string, number, number, number, number])[];
  readonly gates: readonly { readonly at: V3; readonly to: Landing }[];
  readonly lifts: readonly { readonly doors: readonly V3[]; readonly levels: readonly V3[] }[];
  readonly guides: readonly WaysGuide[];
  readonly launchers: readonly { readonly at: V3; readonly dungeon: string; readonly who: string }[];
  readonly clones: readonly { readonly at: V3; readonly area: string; readonly copy: number }[];
}

export interface WaysDungeon {
  readonly zone: string;
  readonly area: string;
  readonly starts: readonly V3[];
  readonly exit: { readonly zone: string; readonly at: V3 } | null;
  /** No gate of its own: its own people send a group back, and ours is the spot they come into it at. */
  readonly walkOut?: boolean;
}

export interface WaysFile {
  readonly format: number;
  readonly zones: Readonly<Record<string, WaysZone>>;
  readonly dungeons: Readonly<Record<string, WaysDungeon>>;
  /** The clone mapping, `[scene, area, cloneScene, cloneArea]`, in the table's order. */
  readonly clone: readonly (readonly [string, string, string, string])[];
  readonly counts?: Readonly<Record<string, number>>;
}

/** What `ways.json` the game understands. */
export const WAYS_READ = 1;

/**
 * Ours, every one: how near a thing must be to be used (`reach`: a lift door, a trail guide, a launcher, a copy's way
 * out where it was come into), how near the converter's own gate must stand to the door SOE's data carries for it to
 * take that door's landing (`gateMatch`: they stand 1 to 3 m apart), and whether the ways are used at all (`on`; off,
 * every gate lands where it always did, at the zone's own arrival). Live through `__debug.ways({ tune })`.
 */
export const WAYS_TUNE = {
  on: true,
  reach: 4,
  gateMatch: 12,
  exitReach: 6,
  /** A move in the same world nearer than this is made at once (a tree lift's level); a farther one under a loading screen. */
  near: 150,
  /**
   * Where the floor under a place of the data's is looked for: from `lift` metres over the data's own height (the data
   * writes the tree lift's ground landing 0.9 m under the deck it is on) down to `drop` under it. A floor found there is
   * stood on; none, the ground.
   */
  lift: 1.5,
  drop: 3,
};

/** Set the live numbers at once (the console's one call), clamped to what makes sense. */
export function tuneWays(o: Partial<typeof WAYS_TUNE> | null | undefined): typeof WAYS_TUNE {
  if (!o) return WAYS_TUNE;
  if (typeof o.on === 'boolean') WAYS_TUNE.on = o.on;
  const set = (k: 'reach' | 'gateMatch' | 'exitReach' | 'near' | 'lift' | 'drop', lo: number, hi: number): void => {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) WAYS_TUNE[k] = Math.max(lo, Math.min(hi, v));
  };
  set('reach', 0.5, 50);
  set('gateMatch', 0.5, 100);
  set('exitReach', 0.5, 50);
  set('near', 0, 5000);
  set('lift', 0, 10);
  set('drop', 0, 50);
  return WAYS_TUNE;
}

/**
 * The height to stand at a place of the data's whose height is its own: on the floor found under it (`top`, the first
 * still surface straight down from `lift` over the data's height within `lift + drop`: a tree lift's deck or level, a
 * walkway, the ground itself), a hair over it; with none found there, on the ground, 0.3 m over it as a teleport stands
 * one. Never the data's height alone: the tree lift's ground landing is written under the deck it stands on, and stood
 * there a body was inside the deck. And never the ground under a floor that is there: the deck stands 2 to 3 m over the
 * terrain, and the first cut, which stood on a floor only where the data stood 3 m over the ground, stood a body
 * under it.
 */
export function wayFloorAt(y: number, ground: number, top: number | null): number {
  if (top !== null && Number.isFinite(top)) return top + 0.05;
  return (Number.isFinite(ground) ? ground : y) + 0.3;
}

/** A dungeon of the ways in words: its name with its underscores as spaces (ours); the zone it stands in names it better where the caller has one. */
export function dungeonWords(name: string): string {
  return String(name ?? '').replace(/_/g, ' ').trim() || 'the copy';
}

/** A point of the world's frame out of the snapshot's, about a layout centre: X mirrored, both recentred. */
export function toGame(at: V3, centre: { readonly x: number; readonly z: number }): [number, number, number] {
  return [-(at[0] - centre.x), at[1], at[2] - centre.z];
}

/** A point of the snapshot's frame out of the world's, about a layout centre (`toGame` the other way). */
export function toRaw(x: number, y: number, z: number, centre: { readonly x: number; readonly z: number }): [number, number, number] {
  return [centre.x - x, y, z + centre.z];
}

/** The copy of an area a point stands in: the smallest area holding it, and its place among the areas of its name. */
export function areaAt(zone: WaysZone | null | undefined, x: number, z: number): { area: string; copy: number } | null {
  if (!zone) return null;
  let best: { area: string; copy: number; size: number } | null = null;
  const seen = new Map<string, number>();
  for (const [name, x1, z1, x2, z2] of zone.areas) {
    const copy = seen.get(name) ?? 0;
    seen.set(name, copy + 1);
    if (x < x1 || x > x2 || z < z1 || z > z2) continue;
    const size = (x2 - x1) * (z2 - z1);
    if (!best || size < best.size) best = { area: name, copy, size };
  }
  return best ? { area: best.area, copy: best.copy } : null;
}

/** Ground distance between a place and a point. */
function flat(at: V3, x: number, z: number): number {
  return Math.hypot(at[0] - x, at[2] - z);
}

/** Distance between a place and a point, the height counted half as much as a step across (a door on a platform above is not this one). */
function near3(at: V3, x: number, y: number, z: number): number {
  return Math.hypot(at[0] - x, (at[1] - y) * 2, at[2] - z);
}

/**
 * Where the gate at a point lands (the converter's own gate, `gates.json`, stands within `gateMatch` of the door or the
 * launcher SOE's data carries there), or null where no door of SOE's stands near it. A launcher at a gate (the Hracca
 * glade's, at the hunting grounds' gate to it) is that gate's way in.
 */
export function gateLanding(ways: WaysFile | null | undefined, zone: string, x: number, z: number, match: number = WAYS_TUNE.gateMatch): Landing | null {
  const w = ways?.zones[zone];
  if (!w) return null;
  let best: Landing | null = null;
  let bestD = match;
  for (const g of w.gates) {
    const d = flat(g.at, x, z);
    if (d <= bestD) {
      bestD = d;
      best = g.to;
    }
  }
  for (const l of w.launchers) {
    const d = flat(l.at, x, z);
    if (d <= bestD) {
      bestD = d;
      best = { dungeon: l.dungeon };
    }
  }
  return best && 'dungeon' in best && !ways!.dungeons[best.dungeon] ? null : best;
}

/** The copy of a dungeon a group (or a character on its own, `id`) is sent to, and where in it: the dungeons' own rule. */
export function copyStart(ways: WaysFile | null | undefined, dungeon: string, id: string): { zone: string; copy: number; at: V3; dungeon: WaysDungeon } | null {
  const d = ways?.dungeons[dungeon];
  if (!d || !d.starts.length) return null;
  const copy = copyIndex(id, dungeon, d.starts.length);
  return copy < 0 ? null : { zone: d.zone, copy, at: d.starts[copy], dungeon: d };
}

/**
 * The tree lift at a point: the lift one of whose doors stands within `reach`, its levels lowest first, and which level
 * the door is on (the level whose height is nearest the door's).
 */
export function liftAt(ways: WaysFile | null | undefined, zone: string, x: number, y: number, z: number, reach: number = WAYS_TUNE.reach): { levels: readonly V3[]; current: number } | null {
  const w = ways?.zones[zone];
  if (!w) return null;
  let best: { levels: readonly V3[]; door: V3 } | null = null;
  let bestD = reach;
  for (const l of w.lifts) {
    for (const d of l.doors) {
      const dd = near3(d, x, y, z);
      if (dd <= bestD) {
        bestD = dd;
        best = { levels: l.levels, door: d };
      }
    }
  }
  if (!best) return null;
  let current = 0;
  for (let i = 1; i < best.levels.length; i++) if (Math.abs(best.levels[i][1] - best.door[1]) < Math.abs(best.levels[current][1] - best.door[1])) current = i;
  return { levels: best.levels, current };
}

/** A tree lift's level in words, lowest first: ours. */
export function liftLevelWords(index: number): string {
  return index === 0 ? 'the ground' : `level ${index}`;
}

/** The trail guide standing within `reach` of a point, or null. */
export function guideAt(ways: WaysFile | null | undefined, zone: string, x: number, y: number, z: number, reach: number = WAYS_TUNE.reach): WaysGuide | null {
  const w = ways?.zones[zone];
  if (!w) return null;
  let best: WaysGuide | null = null;
  let bestD = reach;
  for (const g of w.guides) {
    const d = near3(g.at, x, y, z);
    if (d <= bestD) {
      bestD = d;
      best = g;
    }
  }
  return best;
}

/** A guide's move in words: ours. `level` nought is the trail's own gate. */
export function moveWords(move: { readonly key: string; readonly level: number }): string {
  if (move.level === 0) return 'back to the trail gate';
  if (move.level > 0) return `the trail's level ${move.level}`;
  return 'on along the trail';
}

/** The launcher standing within `reach` of a point whose dungeon is known, or null: a way into a copy of it. */
export function launcherAt(ways: WaysFile | null | undefined, zone: string, x: number, y: number, z: number, reach: number = WAYS_TUNE.reach): { dungeon: string; at: V3 } | null {
  const w = ways?.zones[zone];
  if (!w) return null;
  let best: { dungeon: string; at: V3 } | null = null;
  let bestD = reach;
  for (const l of w.launchers) {
    if (!ways!.dungeons[l.dungeon]) continue;
    const d = near3(l.at, x, y, z);
    if (d <= bestD) {
      bestD = d;
      best = { dungeon: l.dungeon, at: l.at };
    }
  }
  return best;
}

/**
 * The way out of a copy at a point: a dungeon with no gate of its own (`walkOut`) whose start, in any of its copies,
 * stands within `exitReach`. Null anywhere else: a copy with a gate is left by its gate.
 */
export function copyWayOut(ways: WaysFile | null | undefined, zone: string, x: number, y: number, z: number, reach: number = WAYS_TUNE.exitReach): { dungeon: string; exit: { zone: string; at: V3 } } | null {
  if (!ways) return null;
  for (const [name, d] of Object.entries(ways.dungeons)) {
    if (d.zone !== zone || !d.walkOut || !d.exit) continue;
    for (const s of d.starts) if (near3(s, x, y, z) <= reach) return { dungeon: name, exit: d.exit };
  }
  return null;
}

/** What the use key takes at a point, of the ways out in a world: a copy's way out, a trail guide's moves, or a launcher's way in. */
export type WayHere = { readonly kind: 'out'; readonly dungeon: string; readonly exit: { readonly zone: string; readonly at: V3 } } | { readonly kind: 'guide'; readonly guide: WaysGuide } | { readonly kind: 'in'; readonly dungeon: string };

/**
 * Which way the use key takes at a point, in the one order the key and the bar both read: a copy's way out where it was
 * come into, then a trail guide, then a launcher. `leave` says whether a way that takes the player out of where they
 * stand may be offered now (the caller's: no blow within the zone gates' own calm, nobody of theirs lying within reach
 * to be got up), so a fight beside a launcher or at a copy's start cannot end in another place by accident, as it cannot
 * at a gate; a guide only opens its menu and is offered either way. Null where none stands within reach.
 */
export function wayAt(ways: WaysFile | null | undefined, zone: string, x: number, y: number, z: number, leave: boolean): WayHere | null {
  if (!ways) return null;
  if (leave) {
    const out = copyWayOut(ways, zone, x, y, z);
    if (out) return { kind: 'out', dungeon: out.dungeon, exit: out.exit };
  }
  const guide = guideAt(ways, zone, x, y, z);
  if (guide) return { kind: 'guide', guide };
  if (leave) {
    const launch = launcherAt(ways, zone, x, y, z);
    if (launch) return { kind: 'in', dungeon: launch.dungeon };
  }
  return null;
}

/**
 * The start of the copy of a grid zone a point stands in (`areaAt`): the dungeon of this zone whose area it is, else, in
 * a zone that holds one dungeon alone, that dungeon (the Rryatt Trail's later levels are areas of their own, copy for
 * copy the same group's, as the clone mapping reads them), at the point's own copy. Where a death there comes round with
 * nothing else chosen, and what a character reloaded in a copy takes as its spawn. Null outside every copy.
 */
export function copyStartAt(ways: WaysFile | null | undefined, zone: string, x: number, z: number): { readonly dungeon: string; readonly zone: string; readonly copy: number; readonly at: V3 } | null {
  if (!ways) return null;
  const here = areaAt(ways.zones[zone], x, z);
  if (!here) return null;
  const mine = Object.entries(ways.dungeons).filter(([, d]) => d.zone === zone);
  const hit = mine.find(([, d]) => d.area === here.area) ?? (mine.length === 1 ? mine[0] : null);
  if (!hit) return null;
  const [name, d] = hit;
  const at = d.starts[here.copy];
  return at ? { dungeon: name, zone, copy: here.copy, at } : null;
}

/**
 * Where a death at a point comes round, by the clone mapping (`clone`): the rows for the zone and the area the point
 * stands in (a row naming no area is the whole zone's), in the table's order, the first whose target holds a clone droid
 * winning -- the droid of the same copy where the target is this zone and an area of it, the nearest droid of the target
 * zone otherwise. A target that holds none falls through to its own rows (the arena's dead go to the dead forest, which
 * has no droid, and from there to Kachirho's); ours. Null where nothing answers.
 */
export function cloneFor(ways: WaysFile | null | undefined, zone: string, x: number, z: number): { zone: string; at: V3 } | null {
  if (!ways) return null;
  const here = areaAt(ways.zones[zone], x, z);
  const tried = new Set<string>();
  const walk = (scene: string, area: string, copy: number, depth: number): { zone: string; at: V3 } | null => {
    if (depth > 4) return null;
    for (const [s, a, cs, ca] of ways.clone) {
      if (s !== scene || (a && a !== area)) continue;
      const key = `${cs}|${ca}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const target = ways.zones[cs];
      const droids = (target?.clones ?? []).filter((c) => !ca || c.area === ca);
      let hit = cs === scene && ca ? droids.find((c) => c.copy === copy) ?? null : null;
      if (!hit && droids.length) {
        // The nearest of the target zone's droids (in this zone, to the point; in another, its first).
        hit = droids[0];
        if (cs === zone) for (const c of droids) if (flat(c.at, x, z) < flat(hit.at, x, z)) hit = c;
      }
      if (hit) return { zone: cs, at: hit.at };
      const deeper = cs !== scene ? walk(cs, '', 0, depth + 1) : null;
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(zone, here?.area ?? '', here?.copy ?? 0, 0);
}

/** The ways as this browser has them: fetched once a session, null for an install converted before them. */
export class NgeWaysStore {
  private file: WaysFile | null = null;
  private pending: Promise<WaysFile | null> | null = null;

  /** Ask for `nge/ways.json`, once a session; a later call waits on the same answer. */
  fetch(base = ''): Promise<WaysFile | null> {
    if (!this.pending) {
      this.pending = (async () => {
        try {
          const res = await fetch(`${base}assets-private/nge/ways.json`, { cache: 'no-store' });
          if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
          const got = (await res.json()) as WaysFile;
          if (!got || typeof got !== 'object' || !got.zones || !got.dungeons) return null;
          if ((got.format ?? 0) > WAYS_READ) console.info(`ways: nge/ways.json is from a newer converter (format ${got.format}); read as far as this game understands it`);
          this.file = got;
          return got;
        } catch {
          return null;
        }
      })();
    }
    return this.pending;
  }

  /** The ways, once in and while they are on (`WAYS_TUNE.on`); null otherwise. */
  get now(): WaysFile | null {
    return WAYS_TUNE.on ? this.file : null;
  }

  /** The ways whatever the switch says, for the console. */
  get held(): WaysFile | null {
    return this.file;
  }

  /** Hand the ways over outright (a node test's). */
  set(file: WaysFile | null): void {
    this.file = file;
    this.pending = Promise.resolve(file);
  }
}

/** The one for the session. */
export const ngeWays = new NgeWaysStore();
