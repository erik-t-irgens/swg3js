// The places of a world, resolved (Map-maker II, DESIGN.md §2.10, its eighth wave): which place of ours holds a point, the
// no-build verdict players' houses and props are refused by, and the line a loading screen draws.
//
// **One index a world and state** (`PlaceIndex`), built when the locations file lands and again when it changes, in the
// game's frame: the rows' raw points carried once through the world's own mirror about its centre (`gx = cx - x`,
// `gz = z - cz`; about (0, 0) on a real-elevation world), so every ask after is two numbers and the typed arrays of
// `zoneShape.ts`. It answers which place holds a point (`placeAt`: the smallest shape holding it, the world row under all,
// which is what the city line, the loading screen and the ninth wave's sky ask) and whether players may build there
// (`noBuildAt`).
//
// **The no-build verdict** is every place of ours with `build: false`, and, where the world row says `cities: 'noBuild'`
// (the game's own no-build data, under the one switch: the owner's, off by default, a world at a time), the game's own
// cities (the pack's `city` rows, by their reach), Core3's no-build areas (its region rows flagged `NOBUILDZONEAREA`) and
// the client's own no-build radius round each placed thing whose template sets one, both read by the `pois` command into
// the pack's `pois.json` (`noBuild`). Each answers in its own words (`zoneWords`): a player is told why. The server checks
// none of it, as with the story's guard: a zone is the placing browser's verdict.
//
// Pure: no three, no page. Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no
// enum, no namespace, no constructor parameter properties.

import { ZoneAsk, ZoneList, smallestAtAsk, zoneAtAsk } from './zoneShape.ts';
import { buildable, drawnOnMap, saidOnEntry, shapeMiddle, type LocationRow, type LocationShape } from './editFiles/locationsFile.ts';
import { blockerName } from './housePlace.ts';

/** A row of a world's places list as the maps read one (the map window's `Poi`): the fields a place of ours carries. */
export interface MapPlace {
  name: string;
  x: number;
  z: number;
  r: number;
  kind: 'city' | 'starport' | 'shuttleport' | 'place' | 'landmark' | 'area' | 'region';
  desc?: string;
  state?: string;
  ours?: true;
  id?: string;
  shape?: LocationShape;
  say?: boolean;
  build?: boolean;
}

/**
 * A place of ours as a row of the places list (`GalaxyMap.loadPoisRaw`): its middle and reach in the raw frame, its kind (a
 * city, a place, a landmark or an area; a zone is never on the map and so never here), its shape, and whether its name is
 * said walking in and players may build in it. Null for a row not drawn on the map.
 */
export function locationPoi(r: LocationRow): MapPlace | null {
  if (!drawnOnMap(r) || !r.shape) return null;
  const m = shapeMiddle(r.shape);
  const kind = r.kind === 'city' || r.kind === 'landmark' || r.kind === 'area' ? r.kind : 'place';
  const out: MapPlace = { name: r.name ?? r.id, x: m.x, z: m.z, r: m.r, kind, ours: true, id: r.id, shape: r.shape, say: saidOnEntry(r), build: buildable(r) };
  if (r.desc) out.desc = r.desc;
  if (r.state) out.state = r.state;
  return out;
}

/** A pack's places with the places of ours laid after them, in the file's order; with none drawn, the very list it was handed. */
export function mergeLocations<P extends MapPlace>(pois: P[], rows: readonly LocationRow[]): P[] {
  let out: P[] | null = null;
  for (const r of rows) {
    const p = locationPoi(r);
    if (!p) continue;
    if (!out) out = [...pois];
    out.push(p as P);
  }
  return out ?? pois;
}

/** The places' numbers that are ours and not a file's. Live through `__debug.locations({ tune })`. */
export const PLACE_TUNE = {
  /** The width of a city's outline on the minimap, CSS pixels at scale 1 (the ninth wave's `gradeTau` joins it). */
  outlinePx: 1.5,
  /** The smallest a game city's reach must be to keep players off under `cities: 'noBuild'`, metres (the city line's own `minR`). */
  cityMinR: 50,
};

/** Move any of those, each held to something that makes sense; the answer is the table as it stands. */
export function tunePlaces(o: Partial<typeof PLACE_TUNE>): typeof PLACE_TUNE {
  const t = PLACE_TUNE as Record<string, number>;
  for (const k of Object.keys(PLACE_TUNE) as (keyof typeof PLACE_TUNE)[]) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) t[k] = Math.max(0, v);
  }
  return PLACE_TUNE;
}

/**
 * One no-build row of the game's own, as the `pois` command writes it into `pois.json` (`noBuild`), in the raw frame: a
 * Core3 no-build area (`from: 'region'`, its name and shape: a circle `x, z, r`, a rectangle `x, z, x2, z2`, a ring `x, z,
 * inner, r`) or the client's own no-build radius round a placed thing (`from: 'radius'`, `x, z, r` and its template `t`).
 */
export interface GameNoBuild {
  from: 'region' | 'radius';
  name?: string;
  shape?: 'circle' | 'rect' | 'ring';
  x: number;
  z: number;
  r?: number;
  x2?: number;
  z2?: number;
  inner?: number;
  t?: string;
  state?: string;
}

/** Why a spot is no-build, for the words: a place of ours, a game city, a Core3 no-build area, a placed thing's radius. */
export type NoBuildWhy = 'ours' | 'city' | 'region' | 'radius';

/** One no-build zone's record: whose it is and what it is called, and its words once they have been said (kept). */
export interface NoBuildRecord {
  why: NoBuildWhy;
  name: string;
  said?: { house: string; prop: string; editor: string };
}

/** A record's words for a house, a thing or the editor, made the first time and kept: a ghost asked every frame makes nothing. */
export function zoneWordsOf(rec: NoBuildRecord, what: 'house' | 'prop' | 'editor'): string {
  const s = rec.said ?? (rec.said = { house: zoneWords(rec, 'house'), prop: zoneWords(rec, 'prop'), editor: zoneWords(rec, 'editor') });
  return s[what];
}

/** The words a refusal is said in: a house's (`house`) or a thing's (`prop`), or the world editor's note (`editor`). */
export function zoneWords(rec: NoBuildRecord, what: 'house' | 'prop' | 'editor'): string {
  if (what === 'editor') {
    if (rec.why === 'radius') return `beside ${rec.name}, whose ground players may not build on`;
    if (rec.why === 'region') return `inside the game's no-build area ${rec.name}, where players may not build`;
    return `inside ${rec.name}, where players may not build`;
  }
  const verb = what === 'house' ? 'build' : 'put things down';
  if (rec.why === 'radius') return `nobody may ${verb} this close to ${rec.name}`;
  if (rec.why === 'region') return `nobody may ${verb} here: the game keeps ${rec.name} clear`;
  return `nobody may ${verb} in ${rec.name}`;
}

/** A raw point into the game's frame about a centre: the world's own mirror (x mirrored, both recentred). */
export function rawToGame(centre: { x: number; z: number }, x: number, z: number, out: { x: number; z: number }): void {
  out.x = centre.x - x;
  out.z = z - centre.z;
}

/**
 * A game city row of the pack (`pois.json`'s `city`), as the verdict reads it. The game hands the merged places list, so a
 * place of ours (`ours`) is in it too and is stepped over: it is a zone by its own `build`, never by the world row's switch.
 */
export interface GameCity {
  name: string;
  x: number;
  z: number;
  r: number;
  kind: string;
  state?: string;
  ours?: true;
}

/** What the index is built from. */
export interface PlaceSources {
  /** The world's locations rows that stand now (`inState`). */
  rows: readonly LocationRow[];
  /** The raw frame's centre: the layout's, (0, 0) on a real-elevation world. */
  centre: { x: number; z: number };
  /** The pack's own rows (`pois.json`), its cities read for the game's no-build. */
  pois?: readonly GameCity[];
  /** The game's own no-build rows (`pois.json`'s `noBuild`) that stand now. */
  noBuild?: readonly GameNoBuild[];
}

/** A label from a region's own name (`mos_eisley` -> `Mos Eisley`). */
function titleOf(key: string): string {
  const words = key.replace(/[_\-]+/g, ' ').trim();
  return words ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : 'a place';
}

/** A shape's points carried into the game's frame, for an outline's or a rectangle's corners, into one list. */
function addShape(L: ZoneList, s: LocationShape, centre: { x: number; z: number }, tag: number): void {
  const at = { x: 0, z: 0 };
  if (s.kind === 'circle') {
    rawToGame(centre, s.c[0], s.c[1], at);
    L.addCircle(at.x, at.z, s.r, tag);
  } else if (s.kind === 'rect') {
    const b = { x: 0, z: 0 };
    rawToGame(centre, s.min[0], s.min[1], at);
    rawToGame(centre, s.max[0], s.max[1], b);
    L.addRect(at.x, at.z, b.x, b.z, tag);
  } else {
    const xz = new Float64Array(s.pts.length * 2);
    for (let i = 0; i < s.pts.length; i++) {
      rawToGame(centre, s.pts[i][0], s.pts[i][1], at);
      xz[i * 2] = at.x;
      xz[i * 2 + 1] = at.z;
    }
    L.addPoly(xz, tag);
  }
}

/** A world's places resolved, in the game's frame. */
export class PlaceIndex {
  /** Every place of ours with a shape (its tag the row's index in `rows`). */
  readonly held = new ZoneList();
  /** Every no-build zone (its tag the record's index in `records`). */
  readonly noBuild = new ZoneList();
  readonly records: NoBuildRecord[] = [];
  rows: readonly LocationRow[] = [];
  /** The world's own row, or null. */
  world: LocationRow | null = null;
  /** Whether the game's own no-build data keeps players off (the world row's `cities: 'noBuild'`). */
  gameNoBuild = false;
  /** How many of each kind of no-build zone, for the console. */
  readonly counts = { ours: 0, city: 0, region: 0, radius: 0 };

  /** Built again from scratch (a file landed, a state taken, the switch moved). */
  build(src: PlaceSources): this {
    this.held.clear();
    this.noBuild.clear();
    this.records.length = 0;
    this.counts.ours = this.counts.city = this.counts.region = this.counts.radius = 0;
    this.rows = src.rows;
    this.world = src.rows.find((r) => r.kind === 'world') ?? null;
    this.gameNoBuild = this.world?.cities === 'noBuild';
    const c = src.centre;
    src.rows.forEach((r, i) => {
      if (!r.shape) return;
      addShape(this.held, r.shape, c, i);
      if (!buildable(r)) {
        addShape(this.noBuild, r.shape, c, this.records.length);
        this.records.push({ why: 'ours', name: r.name ?? r.id });
        this.counts.ours++;
      }
    });
    if (!this.gameNoBuild) return this;
    const at = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    for (const p of src.pois ?? []) {
      // The pack's own cities only: a city of ours merged into the list is a zone by its own `build` (above), and one players
      // may build in stays open under the switch.
      if (p.ours || p.kind !== 'city' || !(p.r >= PLACE_TUNE.cityMinR) || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      rawToGame(c, p.x, p.z, at);
      this.noBuild.addCircle(at.x, at.z, p.r, this.records.length);
      this.records.push({ why: 'city', name: p.name });
      this.counts.city++;
    }
    for (const n of src.noBuild ?? []) {
      if (!Number.isFinite(n.x) || !Number.isFinite(n.z)) continue;
      rawToGame(c, n.x, n.z, at);
      if (n.from === 'radius') {
        if (!(Number(n.r) > 0)) continue;
        this.noBuild.addCircle(at.x, at.z, Number(n.r), this.records.length);
        this.records.push({ why: 'radius', name: blockerName(n.t) });
        this.counts.radius++;
        continue;
      }
      const name = titleOf(n.name ?? '');
      if (n.shape === 'rect' && Number.isFinite(n.x2) && Number.isFinite(n.z2)) {
        rawToGame(c, Number(n.x2), Number(n.z2), b);
        this.noBuild.addRect(at.x, at.z, b.x, b.z, this.records.length);
      } else if (n.shape === 'ring' && Number(n.r) > 0) this.noBuild.addRing(at.x, at.z, Number(n.inner) || 0, Number(n.r), this.records.length);
      else if (Number(n.r) > 0) this.noBuild.addCircle(at.x, at.z, Number(n.r), this.records.length);
      else continue;
      this.records.push({ why: 'region', name });
      this.counts.region++;
    }
    return this;
  }

  /**
   * What a caller asking every frame writes and asks (`noBuildAsked`, `placeAsked`): no number crosses a call, so nothing is
   * boxed whatever the compiler builds in. The plain forms below write it for the caller.
   */
  readonly ask = new ZoneAsk();

  /** The no-build zone the ask's circle touches, or null. Allocates nothing. */
  noBuildAsked(): NoBuildRecord | null {
    if (this.noBuild.count === 0) return null;
    const i = zoneAtAsk(this.noBuild, this.ask);
    return i < 0 ? null : this.records[this.noBuild.tag[i]];
  }

  /** The smallest place of ours holding the ask's point, or null (the world row is under all: `world`). Allocates nothing. */
  placeAsked(): LocationRow | null {
    if (this.held.count === 0) return null;
    const i = smallestAtAsk(this.held, this.ask);
    return i < 0 ? null : this.rows[this.held.tag[i]];
  }

  /** The no-build zone a circle of `r` round a game point touches, or null. */
  noBuildAt(x: number, z: number, r: number): NoBuildRecord | null {
    const q = this.ask;
    q.x = x;
    q.z = z;
    q.r = r;
    return this.noBuildAsked();
  }

  /** The smallest place of ours holding a game point, or null. */
  placeAt(x: number, z: number): LocationRow | null {
    const q = this.ask;
    q.x = x;
    q.z = z;
    q.r = 0;
    return this.placeAsked();
  }

  /**
   * Why nobody may build a house (`house`) or put a thing down (`prop`) in a circle of `r` metres round a game point, or what
   * the world editor notes there (`editor`), in words, or null: the one answer the game's ghost, its console house, its props
   * and the editor's notes all ask (`App.noBuildHere`). The words are the record's own, made once and kept.
   */
  wordsAt(x: number, z: number, r: number, what: 'house' | 'prop' | 'editor'): string | null {
    const q = this.ask;
    q.x = x;
    q.z = z;
    q.r = r;
    const rec = this.noBuildAsked();
    return rec ? zoneWordsOf(rec, what) : null;
  }
}

/** A world's merged places file as the game holds it (`PoisFile`), as far as the index reads one. */
export interface PlacesFileRead {
  locations: readonly LocationRow[];
  pois: readonly GameCity[];
  noBuild: readonly GameNoBuild[];
}

/**
 * The game's one index of a world's places (`App.placesNow`), built again only when what it is built from moves: the merged
 * file (a new object at every landing), the frame's centre (the layout's, or the stand-in (0, 0) of a world with no pack;
 * none until the pack is in), the world states' stamp, and whether the world is a space zone. Compared as they stand, a centre
 * that is not there kept as not there, so a ghost asking every frame makes nothing whether or not the world has a frame yet.
 * Empty until the file lands, with no frame, and in space. `stands` is the world states' own test of a row (`standsIn`).
 */
export class PlaceIndexKeeper {
  readonly index = new PlaceIndex();
  /** How many times the index was built, for the tests and the console. */
  builds = 0;
  private file: PlacesFileRead | null = null;
  private made = false;
  private framed = false;
  /** The centre it was built about (fractions from the start, so a fraction written later is never boxed). */
  private cx = 0.5;
  private cz = 0.5;
  private stamp = -1;
  private space = false;

  now(file: PlacesFileRead | null, centre: { x: number; z: number } | null, stamp: number, space: boolean, stands: (state?: string | null) => boolean): PlaceIndex {
    const framed = centre !== null;
    if (this.made && file === this.file && framed === this.framed && stamp === this.stamp && space === this.space && (!framed || (centre.x === this.cx && centre.z === this.cz))) return this.index;
    this.made = true;
    this.file = file;
    this.framed = framed;
    if (centre) {
      this.cx = centre.x;
      this.cz = centre.z;
    }
    this.stamp = stamp;
    this.space = space;
    this.builds++;
    if (!file || !centre || space) this.index.build({ rows: [], centre: { x: 0, z: 0 } });
    else this.index.build({ rows: file.locations.filter((r) => stands(r.state)), centre, pois: file.pois.filter((p) => stands(p.state)), noBuild: file.noBuild.filter((n) => stands(n.state)) });
    return this.index;
  }
}

/**
 * A world's locations rows after a write landed by difference (the world editor's answer, the dev server's word): the rows as
 * they stood less the ids taken out, then each row put by its id, in place where it stood and after the rest where it is new.
 * The one rule `GalaxyMap.landLocations` and the places tool's test both land by.
 */
export function landedLocations(was: readonly LocationRow[], put: readonly LocationRow[], deleted: readonly string[]): LocationRow[] {
  const gone = new Set(deleted);
  const byId = new Map<string, LocationRow>();
  for (const r of was) if (!gone.has(r.id)) byId.set(r.id, r);
  for (const r of put) byId.set(r.id, r);
  return [...byId.values()];
}

/** A city of ours's outline as the minimap draws it: its shape in the raw frame, `bad` where players may not build in it. */
export interface PlaceOutline {
  shape: LocationShape;
  bad: boolean;
}

/**
 * What the minimap draws of a world's places (`App.refreshPlacesShown`): the outline of every city of ours drawn on the maps
 * (`drawnOnMap`: a city with `map: false` has none) that stands in the world's state now, `bad` where players may not build in
 * it, and the game's own services that stand now. `stands` is the world states' own test of a row (`standsIn`).
 */
export function minimapPlacesOf<S extends { kind: string; x: number; z: number; state?: string }>(file: { locations: readonly LocationRow[]; services: readonly S[] }, stands: (state?: string | null) => boolean): { outlines: PlaceOutline[]; services: S[] } {
  const outlines: PlaceOutline[] = [];
  for (const r of file.locations) if (r.kind === 'city' && r.shape && drawnOnMap(r) && stands(r.state)) outlines.push({ shape: r.shape, bad: !buildable(r) });
  return { outlines, services: file.services.filter((s) => stands(s.state)) };
}

// ---- The loading screen's line. ----

/** A number in [0, 2^32) from a string: the line drawn for a moment. */
function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** One of a list of lines, drawn by a hash of the moment (whole milliseconds): the same moment draws the same line. */
export function pickLine(lines: readonly string[], moment: number): string | null {
  if (!lines.length) return null;
  return lines[hash32(String(Math.floor(moment))) % lines.length];
}

/**
 * The line a loading screen draws for a destination: one of the lines of the smallest place of ours holding it (`at`, the
 * raw point, where it is known), else one of the world row's, else the planet's own description. `rows` are the destination
 * world's locations rows that stand now.
 */
export function loadingLine(rows: readonly LocationRow[], at: { x: number; z: number } | null, moment: number, description: string): string {
  if (at && rows.length) {
    // Only places with lines of their own: one with none leaves the place round it (or the world) to say one.
    const idx = new PlaceIndex().build({ rows: rows.filter((r) => r.kind !== 'world' && r.loading?.length), centre: { x: 0, z: 0 } });
    // About (0, 0) the game's frame is the raw one mirrored in x.
    const place = idx.placeAt(-at.x, at.z);
    const own = place?.loading?.length ? pickLine(place.loading, moment) : null;
    if (own) return own;
  }
  const world = rows.find((r) => r.kind === 'world');
  return (world?.loading?.length ? pickLine(world.loading, moment) : null) ?? description;
}
