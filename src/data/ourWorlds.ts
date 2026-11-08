// The worlds of yours in the planet list (the race drawer's fourth wave, DESIGN.md §5c), and the one rule every edit file is
// named by: `editKeyOf`, the pack id for every world of the game's (so every file of before is read and written at the very
// path it was) and the world's own id for a world of yours. Everything that reads the pack (models, terrain, layout,
// pictures, sky) keeps reading the pack; only the edit files, the story's places, the player's things and the walk grid's
// key follow the edit key, so a copy writes nothing under its source's name and touches nothing of an existing world.
//
// A world of yours is merged into `PLANETS` after the game's own, in place, as the owner's looks join the catalogue: with no
// worlds file the list is the game's to the object. A new world is a world with no pack of its own (`pack: false`) on a ground
// made in the browser or a converted raster (`dem`), its ground pictures borrowed (`ground`) and its sky borrowed in parts
// (`borrowSky` and `ours.row.sky`); a copy is its source's planet less everything that stands on it but its buildings, its
// pack named as its one zone's (the early Kashyyyk's own shape), so `packIdOf` answers the source's pack.
//
// Pure: imports the planet list and the worlds file's reader. Node runs it with type stripping for the tests.

import { PLANETS, packIdOf, type PlanetDef } from './planets.ts';
import { isWorldId, type WorldRow } from '../world/editFiles/worldsFile.ts';

/**
 * The name every edit file of a world is kept under: a world of yours' own id, else the pack id (`packIdOf`), exactly as
 * every reader and writer of an edit file named it before worlds of yours existed.
 */
export function editKeyOf(planet: Pick<PlanetDef, 'id' | 'zones' | 'ours'>, zoneId?: string): string {
  return planet.ours ? planet.id : packIdOf(planet as PlanetDef, zoneId);
}

/** The same, for a world whose pack id is in hand already (`World.load`'s). */
export function editKeyOfPack(planet: Pick<PlanetDef, 'id' | 'ours'>, packId: string): string {
  return planet.ours ? planet.id : packId;
}

/** Whether a world is a copy of yours: one that takes its source's terrain and buildings and nothing else. */
export function isCopy(planet: Pick<PlanetDef, 'ours'> | null | undefined): boolean {
  return planet?.ours?.kind === 'copy';
}

/**
 * Whether a world stands what is neither terrain nor a building: the people, the creatures and their lairs and camps, the
 * travel terminals, collectors and shuttles, the fittings, the placed sounds, the gates and ways, the seats of ours, the
 * game's places on the map. Every world of the game's does; a copy of yours does not ("just terrain and buildings").
 */
export function standsLife(planet: Pick<PlanetDef, 'ours'> | null | undefined): boolean {
  return !isCopy(planet);
}

/** The pack whose own places file (`pois.json`) a world's places are read from: a copy's source's (its centre alone), else the key. */
export function placesPackOf(key: string, planets: readonly PlanetDef[] = PLANETS): { pack: string; centreOnly: boolean } {
  const p = isWorldId(key) ? planets.find((x) => x.id === key) : undefined;
  if (p?.ours?.kind === 'copy') return { pack: packIdOf(p), centreOnly: true };
  return { pack: key, centreOnly: false };
}

/**
 * A world of the game's a copy names, by the pack it reads (what the Copy button writes, `packIdOf`): one of a planet's zones'
 * packs first, then a planet by its id (a planet with no zones is its own pack; a zoned one its first zone). The order matters
 * once: the early Kashyyyk's one zone's pack is `kashyyyk`, which is also the zoned Kashyyyk's id, and a copy of the early
 * Kashyyyk named by its pack must read that pack and never Kachirho's.
 */
function gameWorld(name: string, game: readonly PlanetDef[]): { planet: PlanetDef; pack: string; zone?: string } | null {
  for (const x of game) {
    if (x.ours) continue;
    const z = x.zones?.find((zz) => zz.pack === name);
    if (z) return { planet: x, pack: z.pack, zone: z.name };
  }
  const p = game.find((x) => x.id === name && !x.ours);
  if (p) return { planet: p, pack: packIdOf(p), zone: p.zones?.[0]?.name };
  return null;
}

/**
 * The pack SOE's ways are read for where the player stands (the gates, the tree lifts, the guides, the launchers, the clone
 * droids, a grid zone's copies) and the dungeons' ways in (`entrancesOf`): a world of the game's own pack, and none on a copy
 * of yours, which stands its source's buildings and none of the ways about them (DESIGN.md §5c, "just terrain and buildings").
 */
export function waysPackOf(planet: Pick<PlanetDef, 'id' | 'zones' | 'ours'>, zoneId?: string): string | null {
  return standsLife(planet) ? packIdOf(planet as PlanetDef, zoneId) : null;
}

/** A new world's seed: FNV-1a over its whole id, so two ids of one length are two grounds (ours). */
export function worldSeedOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return 7000 + ((h >>> 0) % 90001);
}

/** The source's water with a world of yours' colour and opacity laid over it, or none where the source has none. */
function waterOver(src: PlanetDef['water'], row: WorldRow): Pick<PlanetDef, 'water'> {
  if (!src) return {};
  return { water: { ...src, ...(row.water ? { color: row.water.color, opacity: row.water.opacity } : {}) } };
}

/**
 * A promise and a wait: what it answered within `ms`, or `late` where the wait ran out first, the promise itself, which the
 * caller takes when it answers (the boot's worlds file: a read past the wait is landed when it comes, never thrown away).
 */
export async function readWithin<T>(p: Promise<T>, ms: number): Promise<{ value: T | null; late: Promise<T> | null }> {
  const LATE = Symbol('late');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const got = await Promise.race([p, new Promise<typeof LATE>((r) => (timer = setTimeout(() => r(LATE), ms)))]);
  clearTimeout(timer);
  return got === LATE ? { value: null, late: p } : { value: got as T, late: null };
}

/** The pack a copy names by its `of` reads (a world's own, or the zone named), or null for a world it cannot copy. */
export function copySourcePack(of: string, game: readonly PlanetDef[] = PLANETS): string | null {
  const s = gameWorld(of, game);
  return s && !s.planet.space && !s.planet.instances && s.planet.pack !== false ? s.pack : null;
}

/** Degrees to the radians a planet's procedural sun is placed by. */
const RAD = Math.PI / 180;

/** The procedural dome's colours a new world starts from (ours, the gallery's daylight). */
export const NEW_WORLD_DOME = { top: 0x8db9e6, horizon: 0xf4dcae, sun: 0xfff1cf, fog: 0xead2a3 };

/** A new world's test terrain presets (ours): each a whole `terrain` block of the game's own noise, every number a slider. */
export const TERRAIN_PRESETS: Readonly<Record<string, { base: number; amplitude: number; frequency: number; octaves: number; ridged: number; flatten: number; detail: number }>> = {
  hills: { base: 0, amplitude: 40, frequency: 0.0025, octaves: 4, ridged: 0.1, flatten: 1.2, detail: 0.4 },
  dunes: { base: 0, amplitude: 18, frequency: 0.006, octaves: 3, ridged: 0.85, flatten: 1.0, detail: 0.25 },
  mesas: { base: 0, amplitude: 90, frequency: 0.0018, octaves: 4, ridged: 0.5, flatten: 2.4, detail: 0.6 },
  mountains: { base: 0, amplitude: 420, frequency: 0.0009, octaves: 6, ridged: 0.75, flatten: 0.9, detail: 1.2 },
};

/**
 * The planet a worlds row makes, or why it makes none: a new world on a ground made in the browser (`dem.made`) or a
 * converted raster, a copy of a world of the game's. `game` is the game's own list (never a world of yours: a copy of a copy
 * is refused, since the copy it would read is no pack).
 */
export function planetOfWorld(row: WorldRow, game: readonly PlanetDef[]): PlanetDef | string {
  if (game.some((p) => p.id === row.id || p.zones?.some((z) => z.pack === row.id))) return `${row.id} is a world of the game's already`;
  const ours = { kind: row.kind, ...(row.of ? { of: row.of } : {}), row: row as unknown as Readonly<Record<string, unknown>> };
  const extra = row.listed ? {} : { extra: true as const };
  const arrival = row.arrival ? { arrival: { raw: { x: row.arrival.x, z: row.arrival.z }, y: row.arrival.y, ...(row.arrival.heading !== undefined ? { heading: row.arrival.heading } : {}) } } : {};
  const none = { name: 'Nothing', count: 0, color: 0x000000, size: 1, speed: 0, hp: 1, aggressive: false, damage: 0 };
  if (row.kind === 'copy') {
    const src = gameWorld(row.of ?? '', game);
    if (!src) return `${row.of} is no world of the game's`;
    const s = src.planet;
    if (s.space) return `${row.of} is a space zone: a copy is a ground world's terrain and buildings`;
    if (s.instances) return `${row.of} is the world of copies, which is no one world to copy`;
    if (s.pack === false) return `${row.of} has no pack of its own (a real-elevation world): start a new world on its raster instead`;
    // The first sun the row names places the light's path (the day cycle's), as on a new world; the source's own otherwise.
    const firstSun = row.sky?.suns?.[0];
    return {
      id: row.id,
      name: row.name,
      tagline: `A copy of ${s.name}${src.zone && s.zones && s.zones.length > 1 ? `: ${src.zone}` : ''}`,
      description: row.desc ?? `${s.name}'s terrain and buildings, and nothing else of it: a world of yours to edit without touching ${s.name}.`,
      seed: s.seed,
      ...extra,
      gravity: row.gravity ?? s.gravity,
      sky: { ...s.sky, ...(firstSun ? { sunElevation: firstSun.el * RAD, sunAzimuth: firstSun.az * RAD } : {}) },
      fog: { ...s.fog },
      ...waterOver(s.water, row),
      ...(s.swgFogScale !== undefined ? { swgFogScale: s.swgFogScale } : {}),
      light: { ...s.light },
      terrain: { ...s.terrain },
      palette: { ...s.palette },
      props: { ...s.props },
      creatures: none,
      zones: [{ id: 'world', name: src.zone ?? s.name, pack: src.pack }],
      ...(row.arrival ? arrival : !s.zones?.length && s.arrival ? { arrival: s.arrival } : {}),
      ours,
    };
  }
  const size = row.size ?? 4096;
  const start = row.start ?? { kind: 'flat' as const, height: 0 };
  let dem: NonNullable<PlanetDef['dem']>;
  let terrain: PlanetDef['terrain'];
  // A raster start takes that world's water with its raster (Helensar's at 0.5 m, Monument's at 150): a flat or a test
  // terrain has none of its own.
  let water: Pick<PlanetDef, 'water'> = {};
  if (start.kind === 'raster') {
    const r = game.find((p) => p.id === start.of && p.dem && !p.dem.made && !p.ours);
    if (!r?.dem) return `${start.of} is no real-elevation world whose raster a new world can start on`;
    dem = { ...r.dem };
    terrain = { ...r.terrain };
    water = waterOver(r.water, row);
  } else if (start.kind === 'noise') {
    terrain = { base: start.base, amplitude: start.amplitude, frequency: start.frequency, octaves: start.octaves, ridged: start.ridged, flatten: start.flatten, detail: start.detail };
    dem = { url: '', size, lift: 0, feather: 0, made: 'noise' };
  } else {
    terrain = { base: start.height, amplitude: 0, frequency: 0.004, octaves: 1, ridged: 0, flatten: 1, detail: 0 };
    dem = { url: '', size, lift: 0, feather: 0, made: 'flat', height: start.height };
  }
  let ground: PlanetDef['ground'];
  if (row.ground) {
    let rules: NonNullable<PlanetDef['ground']>['rules'] = [];
    if (row.ground.rules) {
      const from = game.find((p) => p.id === row.ground!.rules && p.ground);
      if (!from?.ground) return `${row.ground.rules} has no elevation rules to take`;
      if (from.ground.pack !== row.ground.pack) return `${row.ground.rules}'s rules name ${from.ground.pack}'s families, not ${row.ground.pack}'s`;
      rules = from.ground.rules;
    }
    ground = { pack: row.ground.pack, fallback: row.ground.base, rules };
  }
  const dome = row.sky?.dome ?? NEW_WORLD_DOME;
  const sun = row.sky?.suns?.[0];
  return {
    id: row.id,
    name: row.name,
    tagline: 'A world of yours',
    description: row.desc ?? 'A world made in the world editor.',
    seed: worldSeedOf(row.id),
    ...extra,
    pack: false,
    gravity: row.gravity ?? 20,
    sky: { top: dome.top, horizon: dome.horizon, sunColor: dome.sun, suns: row.sky?.suns ? row.sky.suns.length : 1, sunElevation: sun ? sun.el * RAD : 0.9, sunAzimuth: sun ? sun.az * RAD : 0.7 },
    fog: { color: dome.fog, density: 0.00012 },
    swgFogScale: 0.005,
    light: { sunIntensity: 2.2, ambientSky: 0xbfd6f2, ambientGround: 0x8a7a60, ambientIntensity: 1.0 },
    terrain,
    dem,
    ...water,
    palette: { low: 0x9a9a8a, mid: 0xaaa898, high: 0xcac6b8, slope: 0x7a7468, shore: 0xb8b09a },
    props: { treeDensity: 0, rockDensity: 0, treeStyle: 'none', canopy: 0x000000, trunk: 0x000000, rock: 0x8f8f8f, treeScale: 1 },
    creatures: none,
    ...(row.sky?.colours ? { borrowSky: row.sky.colours } : {}),
    ...(ground ? { ground } : {}),
    ...arrival,
    ours,
  };
}

/** Moved every time the worlds of yours in the list change, so a cache over `PLANETS` can tell (`worldOfPack`). */
let version = 0;
export function planetsVersion(): number {
  return version;
}

/** What the last merge took and refused. */
export const OUR_WORLDS = { merged: [] as string[], refused: [] as { id: string; why: string }[] };

/**
 * The worlds of yours laid into the planet list, in place, after the game's own: every world of yours there before taken out
 * and the rows' worlds put after the game's in the rows' order. With no rows and none there, nothing is touched, so the list
 * is the game's to the object and to the order. A row whose world cannot be made, or whose id a world of the game's has,
 * is refused and named.
 */
export function mergeOurWorlds(rows: readonly WorldRow[], planets: PlanetDef[] = PLANETS): typeof OUR_WORLDS {
  OUR_WORLDS.merged = [];
  OUR_WORLDS.refused = [];
  const had = planets.some((p) => p.ours);
  if (!rows.length && !had) return OUR_WORLDS;
  for (let i = planets.length - 1; i >= 0; i--) if (planets[i].ours) planets.splice(i, 1);
  const game = planets.slice();
  for (const row of rows) {
    const p = planetOfWorld(row, game);
    if (typeof p === 'string') OUR_WORLDS.refused.push({ id: row.id, why: p });
    else {
      planets.push(p);
      OUR_WORLDS.merged.push(p.id);
    }
  }
  version++;
  return OUR_WORLDS;
}

/** The worlds of yours in the list now. */
export function ourWorldsNow(planets: readonly PlanetDef[] = PLANETS): PlanetDef[] {
  return planets.filter((p) => p.ours);
}

/**
 * A world's locations rows with its worlds row's weather laid under them (DESIGN.md §5c: "a chosen kind is a row, never new
 * code"): the climate's weights and the forced kind written into its world row where that row sets none, or a world row of
 * their own where the file has none. The very rows for a world of the game's, and for one of yours that names no weather.
 */
export function layWorldWeather<R extends { id: string; kind: string; climate?: number[]; weather?: string }>(planet: Pick<PlanetDef, 'ours'>, rows: R[]): R[] {
  const w = worldRowOfPlanet(planet)?.weather;
  if (!w || (!w.climate && !w.kind)) return rows;
  const i = rows.findIndex((r) => r.kind === 'world');
  if (i < 0) return [...rows, { id: 'world', kind: 'world', ...(w.climate ? { climate: [...w.climate] } : {}), ...(w.kind ? { weather: w.kind } : {}) } as unknown as R];
  const r = rows[i];
  const laid = { ...r, ...(r.climate === undefined && w.climate ? { climate: [...w.climate] } : {}), ...(r.weather === undefined && w.kind ? { weather: w.kind } : {}) };
  return rows.map((x, k) => (k === i ? laid : x));
}

/**
 * A water look with a world of yours' own colour and opacity laid over it (DESIGN.md §5c): what its sea and lakes, the game's
 * on a copy, are drawn in, and what every lake of ours there starts from. The very look for a world that names none.
 */
export function ourWaterLook<L extends { color: string; opacity: number; source: string }>(look: L, planet: Pick<PlanetDef, 'ours'> | null | undefined): L {
  const own = worldRowOfPlanet(planet)?.water;
  return own ? ({ ...look, color: `#${(own.color >>> 0).toString(16).padStart(6, '0')}`, opacity: own.opacity, source: 'planet' } as L) : look;
}

/** A world of yours' row (its sky's parts, its water), or null for a world of the game's. */
export function worldRowOfPlanet(planet: Pick<PlanetDef, 'ours'> | null | undefined): WorldRow | null {
  return (planet?.ours?.row as unknown as WorldRow | undefined) ?? null;
}
