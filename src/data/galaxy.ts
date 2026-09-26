// Where each world hangs in the galaxy, and which worlds share a system.
//
// The client's archives hold no galaxy POSITIONS at all: there is a picture of the galaxy
// (`texture/galaxy_map.dds`) and a kiosk hologram, but nothing that places a world on either, and
// the one table that looks like it might (`system_locations`) holds five placeholder rows. So the
// squares below are canon, read off the published galaxy grid rather than out of
// the game, and everything the map draws from them is OURS: the grid squares, the middle the map is
// centred on, how far apart the squares stand, and the small nudge that keeps two systems in one
// square from sitting on top of each other. Each system says how sure we are of its square, and the
// map says so beside it.
//
// The only game data the galaxy map uses is the shuttle routes, which the converter writes into the
// owner's own pack as `galaxy.json` and which are read here as a file, never typed into this code.
//
// Pure: no three, no DOM. The node test imports it.

import { PLANETS, spaceZoneOf, type PlanetDef } from './planets.ts';
import type { Destination, HyperspaceCatalogue, SpacePack } from '../space/spaceData.ts';

/** How sure we are of where a system hangs. `ours` and `invented` are said on the map. */
export type GalaxyConfidence = 'good' | 'fair' | 'ours' | 'invented';

export interface GalaxyWorldDef {
  /** A PLANETS id: a ground world, or the space zone itself in a system with nothing under it. */
  planet: string;
  /** Said on the panel where this world cannot be jumped to at all. */
  noOrbit?: string;
}

export interface GalaxySystemDef {
  id: string;
  name: string;
  /** The canon grid square ("M-11"), or null for a place the grid does not cover. */
  grid: string | null;
  /** Where a system with no grid square stands, in grid columns and rows. Ours. */
  at?: { col: number; row: number };
  confidence: GalaxyConfidence;
  /** Said on the panel under the system's name. */
  note?: string;
  /** The space zone flown in this system (a PLANETS id), or null where there is no orbit to fly. */
  zone: string | null;
  worlds: GalaxyWorldDef[];
}

/**
 * The systems, with the canon grid square of each. Nothing here comes from the client's files.
 *
 * Lok's square is ours: the world is canon (the Karthakk system, Outer Rim) but no published grid
 * gives it a square, so it is placed near Naboo's arm and marked as ours on the map. Deep Space is
 * ours entirely: the game kept it off any map, so it stands west of the grid, in the Unknown Regions.
 */
export const GALAXY_SYSTEMS: GalaxySystemDef[] = [
  { id: 'corellian', name: 'Corellian system', grid: 'M-11', confidence: 'good', zone: 'space_corellia', worlds: [{ planet: 'corellia' }, { planet: 'talus' }] },
  { id: 'naboo', name: 'Naboo system', grid: 'O-17', confidence: 'good', zone: 'space_naboo', worlds: [{ planet: 'naboo' }, { planet: 'rori' }] },
  { id: 'tatoo', name: 'Tatoo system', grid: 'R-16', confidence: 'good', zone: 'space_tatooine', worlds: [{ planet: 'tatooine' }] },
  { id: 'kashyyyk', name: 'Kashyyyk system', grid: 'P-9', confidence: 'good', zone: 'space_kashyyyk', worlds: [{ planet: 'kashyyyk' }] },
  { id: 'dathomir', name: 'Dathomir system', grid: 'O-6', confidence: 'good', zone: 'space_dathomir', worlds: [{ planet: 'dathomir' }] },
  { id: 'yavin', name: 'Yavin system', grid: 'P-6', confidence: 'good', zone: 'space_yavin4', worlds: [{ planet: 'yavin4' }] },
  { id: 'endor', name: 'Endor system', grid: 'H-16', confidence: 'good', zone: 'space_endor', worlds: [{ planet: 'endor' }] },
  { id: 'dantooine', name: 'Dantooine system', grid: 'L-4', confidence: 'fair', zone: 'space_dantooine', worlds: [{ planet: 'dantooine' }] },
  { id: 'karthakk', name: 'Karthakk system', grid: 'N-18', confidence: 'ours', note: 'Placed by us: the world is canon, its square is not.', zone: 'space_lok', worlds: [{ planet: 'lok' }] },
  { id: 'kessel', name: 'Kessel system', grid: 'T-10', confidence: 'good', zone: 'space_light1', worlds: [{ planet: 'space_light1' }] },
  { id: 'ord_mantell', name: 'Ord Mantell system', grid: 'L-7', confidence: 'good', zone: 'space_ord_mantell', worlds: [{ planet: 'space_ord_mantell' }] },
  { id: 'mustafar', name: 'Mustafar system', grid: 'L-19', confidence: 'good', zone: null, worlds: [{ planet: 'mustafar', noOrbit: 'There is no orbit over Mustafar to fly: it is reached by travelling there.' }] },
  { id: 'deep_space', name: 'Deep Space', grid: null, at: { col: -2, row: 12 }, confidence: 'invented', note: 'Made up: the Unknown Regions, west of the grid.', zone: 'space_heavy1', worlds: [{ planet: 'space_heavy1' }] },
  // The sandbox is a world of our own with no place in the galaxy; it is drawn only once it exists.
  { id: 'sandbox', name: 'Sandbox', grid: null, at: { col: -2, row: 16 }, confidence: 'invented', note: 'Made up: a quiet corner of our own.', zone: 'space_sandbox', worlds: [{ planet: 'space_sandbox' }] },
];

/** PLANETS entries that belong to no system on purpose: the development gallery is not a place in the galaxy. */
export const GALAXY_LEFT_OUT: readonly string[] = ['gallery'];

/**
 * Invented: how the galaxy is laid out, in the map's own units (one unit is one metre to three, and
 * nothing here is a distance in the galaxy). The middle is the middle of the grid, which is roughly
 * where the Deep Core sits; a square is 100 units across, the disc a little wider than the grid, and
 * the nudge and the lift keep two systems in one square apart. Every number is live through
 * `__debug.galaxy({ square, jitter, lift, centreCol, centreRow, discRadius, discArms, discStars, discThickness })`.
 */
export const GALAXY_TUNE = {
  /** How far apart two neighbouring grid squares stand. */
  square: 100,
  /** How far a system is nudged from its square's middle, in squares. */
  jitter: 0.22,
  /** How far above or below the galactic plane a system may sit, in squares. */
  lift: 0.3,
  /** The column and row the map is centred on (the middle of the grid). */
  centreCol: 13,
  centreRow: 13,
  /** The star disc the systems stand in: how far it reaches, how many arms it winds into, how many stars, and how thick it is. */
  discRadius: 1900,
  discArms: 4,
  discStars: 6000,
  discThickness: 70,
};

const COLUMNS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A grid square ("M-11") as a column index (A is 0) and a row number (1 up), or null when it reads as neither. */
export function gridSquare(grid: string): { col: number; row: number } | null {
  const m = /^([A-Za-z])\s*-?\s*(\d{1,2})$/.exec(grid.trim());
  if (!m) return null;
  const col = COLUMNS.indexOf(m[1].toUpperCase());
  const row = Number(m[2]);
  if (col < 0 || !Number.isFinite(row) || row < 1) return null;
  return { col, row };
}

/** A small, repeatable number in 0..1 from a name and a salt: the nudge that keeps two systems apart. */
function hash01(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Where a system stands, in the map's units: its square's middle against the middle of the grid, with
 * a nudge and a lift of its own. X runs east across the grid, Z south down it, Y out of the plane.
 */
export function systemPlace(sys: GalaxySystemDef): { x: number; y: number; z: number } {
  const sq = sys.grid ? gridSquare(sys.grid) : null;
  const col = sq ? sq.col + 0.5 : (sys.at?.col ?? 0) + 0.5;
  const row = sq ? sq.row - 0.5 : (sys.at?.row ?? 0) - 0.5;
  const t = GALAXY_TUNE;
  return {
    x: (col - t.centreCol + (hash01(sys.id, 1) - 0.5) * 2 * t.jitter) * t.square,
    y: (hash01(sys.id, 2) - 0.5) * 2 * t.lift * t.square,
    z: (row - t.centreRow + (hash01(sys.id, 3) - 0.5) * 2 * t.jitter) * t.square,
  };
}

/** Every PLANETS id a system covers: its worlds, and the zone flown in it. */
export function idsOf(sys: GalaxySystemDef): string[] {
  const out = sys.worlds.map((w) => w.planet);
  if (sys.zone && !out.includes(sys.zone)) out.push(sys.zone);
  return out;
}

/** The system a planet or space zone belongs to, or null (the gallery, and anything new). */
export function systemOf(planetId: string): GalaxySystemDef | null {
  return GALAXY_SYSTEMS.find((s) => idsOf(s).includes(planetId)) ?? null;
}

/** A system's worlds that this build of the game actually has, with their PLANETS entries. */
export function worldsOf(sys: GalaxySystemDef): { def: GalaxyWorldDef; planet: PlanetDef }[] {
  const out: { def: GalaxyWorldDef; planet: PlanetDef }[] = [];
  for (const w of sys.worlds) {
    const planet = PLANETS.find((p) => p.id === w.planet);
    if (planet) out.push({ def: w, planet });
  }
  return out;
}

/** The systems the map draws: the ones with a world this build has (the sandbox appears when it does). */
export function drawnSystems(): GalaxySystemDef[] {
  return GALAXY_SYSTEMS.filter((s) => worldsOf(s).length > 0);
}

// ---- Where a jump to a world comes out ----

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');

/**
 * True when a destination's name or id names this world (a station called after it). Matched on the
 * whole name as a run of words, so a world whose name is two words ("Ord Mantell", "Yavin IV") can
 * match at all, and so that a name is never found inside a longer word.
 */
function namesWorld(d: Destination, planet: PlanetDef): boolean {
  const want = ` ${words(planet.name).join(' ')} `;
  return ` ${words(d.name).join(' ')} `.includes(want) || ` ${words(d.id).join(' ')} `.includes(want);
}

/**
 * Where a jump to a world comes out, from the catalogue the System Map uses: the orbit's launch point
 * for the world the zone hangs over, the station named after it for a second world in the same system
 * (Talus in the Corellian system, Rori in Naboo's), and for a system that is only a zone, the place its
 * own arrival uses. Null when there is nowhere to jump to: no zone, no pack, or nothing in it.
 */
export function destinationFor(sys: GalaxySystemDef, world: PlanetDef, catalogue: HyperspaceCatalogue): Destination | null {
  if (!sys.zone) return null;
  const entry = catalogue.systems.find((s) => s.id === sys.zone);
  if (!entry || !entry.destinations.length) return null;
  const list = entry.destinations;
  // The world the zone hangs over takes the zone's own arrival; a second world in the same system
  // (one with no orbit of its own) takes the station named after it. A STATION is looked for before
  // anything else: a zone lists its hyperspace points before its stations, and the game names some
  // of a system's points after the neighbouring world (Corellia's fifth point carries Talus's name),
  // so taking the first destination of any kind that names the world lands kilometres off its
  // station. Only when no station names it does any other kind of place count.
  const isZonesOwn = world.id === sys.zone || spaceZoneOf(world)?.id === sys.zone;
  if (!isZonesOwn) {
    const named = list.find((d) => d.kind === 'station' && namesWorld(d, world)) ?? list.find((d) => namesWorld(d, world));
    if (named) return named;
  }
  const launch = list.find((d) => d.kind === 'launch');
  if (launch) return launch;
  const point = entry.pack?.arrival?.point;
  const arrival = point ? list.find((d) => d.id === point) : undefined;
  return arrival ?? list[0];
}

/** The space zone a world is reached through, when the game has one (Talus and Rori share their neighbour's). */
export function zoneFor(sys: GalaxySystemDef, world: PlanetDef): string | null {
  if (world.space) return world.id;
  return spaceZoneOf(world)?.id ?? sys.zone;
}

// ---- The picture each world wears: the planet texture its own orbit already carries ----

/**
 * The pack's own picture of a world, as a path inside that pack: the planet whose appearance is named
 * for the world (or for the system), else the largest body that is not a moon. Null where the archives
 * have no picture of it (Talus, Rori and Mustafar have none), and the map tints a plain globe instead.
 */
export function planetTextureOf(pack: SpacePack | null, keys: readonly string[]): string | null {
  if (!pack?.planets?.length) return null;
  const base = (p: { appearance: string }) => p.appearance.replace(/^.*\//, '').replace(/\.[^.]*$/, '').toLowerCase();
  for (const key of keys) {
    const want = `planet_${key.toLowerCase()}`;
    const hit = pack.planets.find((p) => base(p) === want && p.texture);
    if (hit?.texture) return hit.texture;
  }
  let best: { texture: string | null; size: number } | null = null;
  for (const p of pack.planets) {
    if (!p.texture || base(p).includes('_moon')) continue;
    if (!best || (p.size ?? 0) > best.size) best = { texture: p.texture, size: p.size ?? 0 };
  }
  return best?.texture ?? null;
}

// ---- The shuttle routes, read from the owner's own pack ----

export interface GalaxyFile {
  version: number;
  planets: { id: string; width: number | null }[];
  routes: { from: string; to: string; price: number }[];
  /** The price of travelling within one world, kept apart from the routes between them. */
  local: Record<string, number>;
}

/** A line the map draws between two systems, with the cheapest fare found between their worlds. */
export interface GalaxyRoute {
  from: string;
  to: string;
  price: number;
}

/** The planet a route's name belongs to: a PLANETS id, or the pack of one of its zones. */
export function planetOfRouteId(id: string): PlanetDef | null {
  return PLANETS.find((p) => p.id === id) ?? PLANETS.find((p) => p.zones?.some((z) => z.pack === id)) ?? null;
}

/** Which system a route's pack id belongs to, or null for one this build has no world for. */
export function systemOfPack(id: string): string | null {
  const planet = planetOfRouteId(id);
  return planet ? (systemOf(planet.id)?.id ?? null) : null;
}

/**
 * The systems a list of route packs reaches.
 *
 * It takes the packs rather than reading the route file, and that is the whole point of it: which
 * worlds can be flown to from where you stand is a directed question with a fare, a starport rule
 * and a "this build has no such world" rule, and all three already live in `ridesFrom`. Working it
 * out a second time here would light a line on the map that the panel beside it refuses to sell.
 */
export function systemsOfWorlds(packs: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const p of packs) {
    const sys = systemOfPack(p);
    if (sys) out.add(sys);
  }
  return out;
}

/**
 * The routes as lines between systems: a route whose ends are in one system (Corellia to Talus) draws
 * nothing, a name no world of ours has is left out, and a pair that appears both ways is one line at
 * the lower fare. An unconverted pack (no file) draws no routes at all.
 */
export function systemRoutes(file: GalaxyFile | null): GalaxyRoute[] {
  const byPair = new Map<string, GalaxyRoute>();
  for (const r of file?.routes ?? []) {
    const a = planetOfRouteId(r.from);
    const b = planetOfRouteId(r.to);
    if (!a || !b) continue;
    const sa = systemOf(a.id);
    const sb = systemOf(b.id);
    if (!sa || !sb || sa.id === sb.id) continue;
    const key = sa.id < sb.id ? `${sa.id}|${sb.id}` : `${sb.id}|${sa.id}`;
    const price = Math.round(Number(r.price) || 0);
    const had = byPair.get(key);
    if (!had) byPair.set(key, { from: sa.id < sb.id ? sa.id : sb.id, to: sa.id < sb.id ? sb.id : sa.id, price });
    else if (price > 0 && (had.price <= 0 || price < had.price)) had.price = price;
  }
  return [...byPair.values()].sort((x, y) => (x.from === y.from ? (x.to < y.to ? -1 : 1) : x.from < y.from ? -1 : 1));
}

let galaxyFile: Promise<GalaxyFile | null> | null = null;

/**
 * `assets-private/galaxy.json`, fetched once for the session: the shuttle routes the `maps` command
 * writes. A missing file (or a dev server answering with its index page) is null, and the map simply
 * draws no routes; a file that arrives after a conversion needs a reload, as the other packs do.
 */
export function loadGalaxyFile(baseUrl: string): Promise<GalaxyFile | null> {
  if (galaxyFile) return galaxyFile;
  galaxyFile = (async () => {
    try {
      const res = await fetch(`${baseUrl}assets-private/galaxy.json`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      const raw = (await res.json()) as Partial<GalaxyFile>;
      if (!raw || !Array.isArray(raw.routes)) return null;
      return { version: Number(raw.version) || 0, planets: raw.planets ?? [], routes: raw.routes, local: raw.local ?? {} };
    } catch {
      return null;
    }
  })();
  void galaxyFile.then((f) => {
    if (!f) galaxyFile = null;
  });
  return galaxyFile;
}
