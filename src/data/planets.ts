import { GRAND_CANYON_LOK } from '../world/demShader.ts';
export type TreeStyle = 'none' | 'palm' | 'pine' | 'round' | 'dead' | 'giant' | 'swamp';

/**
 * A world's own arrival (`PlanetDef.arrival`, worked out by `src/world/arrival.ts`), kept here rather than imported,
 * since this file ships with the server and the release carries only what it names.
 */
export interface WorldArrival {
  /** The place in the client's raw frame, as `/loc`, a story's `near` and a placement row write it. */
  readonly raw: { readonly x: number; readonly z: number };
  /** The height a body stands at there, absolute, never measured against the ground. */
  readonly y: number;
  /** Radians in the game's frame, a body facing `(sin, cos)`; absent, the way an arrival always faced. */
  heading?: number;
  /**
   * A room to arrive in (`src/world/arrival.ts`): the building of this template standing nearest the raw place, its room
   * of this name in the client's own portal layout, and a place in the building's own frame (the client's: x across, y up,
   * z along) to stand at in it, absent for the room's own floor under its middle. The raw place and height are then only
   * where the world streams round until the building is in.
   */
  readonly room?: { readonly template: string; readonly cell: string; readonly at?: readonly [number, number, number] };
  /**
   * The world's port lands people here (`portArrivesHome` in `src/world/arrival.ts`): a port's own place on this world
   * (the map's teleport, the galaxy tab, a ticket put down on foot) comes out at this arrival, at its own height, rather
   * than on the ground at the port building's origin.
   */
  readonly port?: boolean;
}

/** One terrain of a planet the game split into separate zones (Kashyyyk), each its own converted pack. */
export interface PlanetZone {
  id: string;
  name: string;
  /** Pack directory under assets-private/ (the snapshot's name). */
  pack: string;
}

export interface PlanetDef {
  id: string;
  name: string;
  tagline: string;
  description: string;
  seed: number;
  /**
 * Take another pack's sky: its skybox, sun, moons, celestial bodies, star field, cloud layers and
 * colour ramp, with nothing else of that world. For a planet whose ground is real-world elevation
 * and which therefore has no pack of its own, so would otherwise stand under the procedural dome
 * in `sky` below. Naming the pack rather than taking the whole thing is the point: its terrain
 * would replace these heights and its buildings would arrive at their own coordinates, which on
 * other ground means a city hanging off the side of a mountain.
 */
  borrowSky?: string;
  /**
 * Ground textures for a planet whose heights are real-world elevation. The families come from an
 * installed pack and the rules decide where each goes, evaluated against this planet's own
 * ground rather than the pack's. `__debug.families(pack)` lists what a pack has to offer, and
 * demShader.ts holds the rule shape and a worked set for the Grand Canyon.
 *
 * Only the pack's shader table and its texture files are taken. Its terrain is not attached and
 * its layout is not placed, so nothing of that world's heights or buildings comes with them.
 */
  ground?: import('../world/demShader.ts').GroundRules;
  /** Zones with their own terrain; the first is where travel lands. Absent for single-terrain planets. */
  zones?: PlanetZone[];
  /**
   * A space zone: the system it is. When a planet's id, the zone is that planet's orbit (Land and Eject
   * go down to it, `planetBelow`); Kessel, Ord Mantell and Deep Space carry names of their own and have
   * nothing below. No ground, no gravity, flown in a ship. Everything that treats a world as space tests
   * this being truthy.
   */
  space?: string;
  /**
   * A zone of the copies the server stood one of per group (`dungeon1`: the Corellian corvette and the
   * heroic instances). Never on the travel or galaxy lists and never a world a character starts on; it
   * is reached only through a dungeon's own way in (`src/world/instances.ts`), and nobody stands in it
   * but in the copy the player is in.
   */
  instances?: boolean;
  /**
   * A ground terrain the archives hold that the game never offered as a world of its own (a heroic's map, an older or
   * unreleased planet, a developer's test), converted for looking at: kept off the galaxy map (`GALAXY_LEFT_OUT`) and
   * out of the creator's start list, and reached by `__debug.travel('<id>')` and the map's list of every world.
   */
  extra?: true;
  /**
   * Where this world brings a player in and back when nothing else says -- a travel with no place of its own, a
   * character new to it, a death with no cloning facility near (`src/world/arrival.ts`): a raw place, an absolute
   * height and a heading in the game's frame, turned into the game's frame by the world's own places file. Only a
   * world with no zones; absent, the flattest dry spot near the layout centre (`World.spawnPoint`).
   */
  arrival?: WorldArrival;
  /**
   * `false` for a world that declares no pack of its own (today every real-elevation world): nothing under
   * `assets-private/<id>/` is ever asked for it (`src/world/packFiles.ts`), since every such ask would be a file the
   * game knows is not there. Absent, a world's pack is asked for as it always was; a world given content later (the
   * map maker) drops the `false` and every one of its files is asked for again.
   */
  pack?: false;
  /** Downward acceleration in m/s². Real planets vary; SWG feel is snappier than Earth. */
  gravity: number;
  sky: { top: number; horizon: number; sunColor: number; suns: number; sunElevation: number; sunAzimuth: number };
  fog: { color: number; density: number };
  /** Multiplier on the planet's own sky fog density (the client's value reads far too thick here). */
  swgFogScale?: number;
  light: { sunIntensity: number; ambientSky: number; ambientGround: number; ambientIntensity: number };
  terrain: {
    base: number;
    amplitude: number;
    frequency: number;
    octaves: number;
    /** 0..1 blend toward ridged noise (dune crests, mountain ridges). */
    ridged: number;
    /** >1 flattens lowlands, <1 exaggerates them. */
    flatten: number;
    /** Small high-frequency bumps in metres. */
    detail: number;
  };
  /**
   * A world of yours (the race drawer's fourth wave, `public/placements/worlds/all.json`, merged after the game's own by
   * `src/data/ourWorlds.ts`): what it is, the world it copies, and the row it was made from, read by the sky's parts and
   * the water's colour. Never on a world of the game's, so every one of them is what it was.
   */
  ours?: { kind: 'new' | 'copy'; of?: string; row: Readonly<Record<string, unknown>> };
  dem?: {
    /** Folder holding base16.raw and base.json. */
    url: string;
    /**
     * A ground of ours made in the browser in place of a raster (a world of yours): `flat` at `height`, or `noise`, the
     * planet's own `terrain` numbers over the whole square. Absent for a raster.
     */
    made?: 'flat' | 'noise';
    /** A flat made ground's height, absolute. */
    height?: number;
    /** Metres a side. Match `--extent`; the whole map when it covers the whole map. */
    size: number;
    /** Added to every height, for sitting a real elevation near this planet's own ground level. */
    lift: number;
    /** Metres of blend to the planet's own noise at the raster's edge. 0 when it covers the map. */
    feather?: number;
    /**
     * Metres of fractal relief added under the raster's sample spacing. A 10 m DEM holds the shape
     * of a valley and nothing of its surface, so a little noise below that scale is the difference
     * between ground and a smooth grey shell. It goes into the heightfield, so it is walked on too.
     */
    detail?: number;
  };
  water?: { level: number; color: number; opacity: number };
  palette: { low: number; mid: number; high: number; slope: number; shore: number };
  props: {
    treeDensity: number;
    rockDensity: number;
    treeStyle: TreeStyle;
    canopy: number;
    trunk: number;
    rock: number;
    treeScale: number;
  };
  creatures: { name: string; count: number; color: number; size: number; speed: number; hp: number; aggressive: boolean; damage: number };
}

export const PLANETS: PlanetDef[] = [
  {
    id: 'tatooine',
    name: 'Tatooine',
    tagline: 'Twin suns, endless dunes',
    description: 'A harsh desert world in the Outer Rim. Home to moisture farmers, Tusken Raiders, Jabba the Hutt, and more scum and villainy than anywhere else in the galaxy.',
    seed: 1977,
    gravity: 22,
    sky: { top: 0x8db9e6, horizon: 0xf4dcae, sunColor: 0xfff1cf, suns: 2, sunElevation: 0.9, sunAzimuth: 0.7 },
    fog: { color: 0xead2a3, density: 0.0032 },
    swgFogScale: 0.1,
    light: { sunIntensity: 2.6, ambientSky: 0xbfd6f2, ambientGround: 0xd9b57a, ambientIntensity: 1.0 },
    terrain: { base: 0, amplitude: 16, frequency: 0.0038, octaves: 4, ridged: 0.6, flatten: 1.1, detail: 0.35 },
    palette: { low: 0xd8b073, mid: 0xe7c78d, high: 0xf2dcaa, slope: 0xb48d56, shore: 0xe7c78d },
    props: { treeDensity: 0, rockDensity: 0.55, treeStyle: 'none', canopy: 0x000000, trunk: 0x000000, rock: 0x8f7355, treeScale: 1 },
    creatures: { name: 'Bantha', count: 8, color: 0x6b5334, size: 2.3, speed: 2, hp: 260, aggressive: false, damage: 0 },
  },
  {
    id: 'naboo',
    name: 'Naboo',
    tagline: 'Rolling green hills and lakes',
    description: 'A lush Mid Rim world of grassy plains, waterfalls and the elegant city of Theed. The Gungans live beneath its lakes.',
    seed: 1999,
    gravity: 20,
    sky: { top: 0x5d9fe3, horizon: 0xd2e7f8, sunColor: 0xfff6e0, suns: 1, sunElevation: 1.0, sunAzimuth: 2.2 },
    fog: { color: 0xc4dcef, density: 0.0024 },
    swgFogScale: 0.05,
    light: { sunIntensity: 2.4, ambientSky: 0xa9c8ee, ambientGround: 0x6c8a4a, ambientIntensity: 0.9 },
    terrain: { base: 3, amplitude: 24, frequency: 0.0028, octaves: 5, ridged: 0, flatten: 1.35, detail: 0.5 },
    water: { level: 0, color: 0x2e7fbb, opacity: 0.75 },
    palette: { low: 0x74a64b, mid: 0x4f8c3a, high: 0x9db76c, slope: 0x7c6a4e, shore: 0xd9c98f },
    props: { treeDensity: 1.0, rockDensity: 0.2, treeStyle: 'round', canopy: 0x3f7d32, trunk: 0x6a4a2a, rock: 0x8d8a80, treeScale: 1.2 },
    creatures: { name: 'Kaadu', count: 10, color: 0x7aa86b, size: 1.3, speed: 4.5, hp: 90, aggressive: false, damage: 0 },
  },
  {
    id: 'corellia',
    name: 'Corellia',
    tagline: 'Temperate homeworld of pilots',
    description: 'A Core World of forests, rivers and industry. Birthplace of Han Solo and Wedge Antilles, and of the finest shipwrights in the galaxy.',
    seed: 1138,
    gravity: 20,
    sky: { top: 0x4d8fd6, horizon: 0xc9dcee, sunColor: 0xfff8ea, suns: 1, sunElevation: 0.85, sunAzimuth: 3.6 },
    fog: { color: 0xbccfe0, density: 0.0026 },
    light: { sunIntensity: 2.3, ambientSky: 0xa4c0e8, ambientGround: 0x5f7a4a, ambientIntensity: 0.9 },
    terrain: { base: 4, amplitude: 32, frequency: 0.0025, octaves: 5, ridged: 0.25, flatten: 1.2, detail: 0.5 },
    water: { level: 0, color: 0x2a6fa8, opacity: 0.78 },
    palette: { low: 0x5f9a47, mid: 0x4a7f3a, high: 0x8a9a75, slope: 0x6f6a60, shore: 0xc8ba85 },
    props: { treeDensity: 0.9, rockDensity: 0.35, treeStyle: 'pine', canopy: 0x2f6b34, trunk: 0x5d4330, rock: 0x7f7f7a, treeScale: 1.1 },
    creatures: { name: 'Durni', count: 10, color: 0x8a7a5a, size: 0.9, speed: 5, hp: 50, aggressive: false, damage: 0 },
  },
  {
    id: 'dantooine',
    name: 'Dantooine',
    tagline: 'Wide golden plains',
    description: 'A quiet agricultural world of lavender grass and open savannah, with the ruins of an ancient Jedi enclave.',
    seed: 4001,
    gravity: 19,
    sky: { top: 0x6ea6df, horizon: 0xe9e1cf, sunColor: 0xfff3d6, suns: 1, sunElevation: 0.7, sunAzimuth: 1.1 },
    fog: { color: 0xd8d1bd, density: 0.0022 },
    light: { sunIntensity: 2.5, ambientSky: 0xb5cbe8, ambientGround: 0x8f8a4f, ambientIntensity: 0.9 },
    terrain: { base: 1, amplitude: 12, frequency: 0.003, octaves: 4, ridged: 0, flatten: 1.6, detail: 0.3 },
    water: { level: -4, color: 0x3d7fa6, opacity: 0.7 },
    palette: { low: 0xb9ab53, mid: 0x9ea34e, high: 0xc5bd7a, slope: 0x8a7a55, shore: 0xcfc38a },
    props: { treeDensity: 0.25, rockDensity: 0.3, treeStyle: 'round', canopy: 0x6f8f3a, trunk: 0x6b5238, rock: 0x9a917f, treeScale: 1.4 },
    creatures: { name: 'Bol', count: 8, color: 0x5e4d3a, size: 2.6, speed: 2.5, hp: 300, aggressive: false, damage: 0 },
  },
  {
    id: 'lok',
    name: 'Lok',
    tagline: 'Volcanic, lawless, brutal',
    description: 'A scorched volcanic world ruled by the pirate Nym. Sulphur haze hangs over jagged ridges and lava fields.',
    seed: 6660,
    gravity: 21,
    sky: { top: 0x8a5a3a, horizon: 0xe0a26a, sunColor: 0xffd7a3, suns: 1, sunElevation: 0.8, sunAzimuth: 4.4 },
    fog: { color: 0xd39a66, density: 0.0038 },
    light: { sunIntensity: 2.6, ambientSky: 0xd9a070, ambientGround: 0x6a5040, ambientIntensity: 1.15 },
    terrain: { base: 2, amplitude: 48, frequency: 0.0032, octaves: 5, ridged: 0.8, flatten: 1.0, detail: 0.7 },
    palette: { low: 0x6a5244, mid: 0x8a6a56, high: 0xa89383, slope: 0x4a3a33, shore: 0x8a6a56 },
    props: { treeDensity: 0, rockDensity: 1.0, treeStyle: 'none', canopy: 0x000000, trunk: 0x000000, rock: 0x3d3230, treeScale: 1 },
    creatures: { name: 'Kimogila', count: 6, color: 0x5f6b3a, size: 3.2, speed: 3, hp: 420, aggressive: true, damage: 24 },
  },
  {
    id: 'endor',
    name: 'Endor',
    tagline: 'Forest moon of giants',
    description: 'A forest moon of colossal trees and misty valleys, home of the Ewoks and the ruins of the second Death Star shield generator.',
    seed: 1983,
    gravity: 18,
    sky: { top: 0x6b9ec9, horizon: 0xd6e6e2, sunColor: 0xfff9e6, suns: 1, sunElevation: 0.75, sunAzimuth: 2.9 },
    fog: { color: 0xb9cfc6, density: 0.0048 },
    light: { sunIntensity: 2.0, ambientSky: 0x9fbfd0, ambientGround: 0x3f5a3a, ambientIntensity: 0.9 },
    terrain: { base: 2, amplitude: 28, frequency: 0.003, octaves: 5, ridged: 0.15, flatten: 1.2, detail: 0.6 },
    water: { level: -6, color: 0x2f6f8a, opacity: 0.8 },
    palette: { low: 0x3f6e33, mid: 0x4f7f3a, high: 0x6f8a55, slope: 0x5a4d3d, shore: 0x8a7a55 },
    props: { treeDensity: 1.5, rockDensity: 0.25, treeStyle: 'giant', canopy: 0x2c5a2e, trunk: 0x5a4030, rock: 0x6f6f66, treeScale: 1.0 },
    creatures: { name: 'Boar-wolf', count: 10, color: 0x4a3a2a, size: 1.4, speed: 5.5, hp: 120, aggressive: true, damage: 12 },
  },
  {
    id: 'dathomir',
    name: 'Dathomir',
    tagline: 'Red world of the Nightsisters',
    description: 'A rugged, blood-red planet of mesas and dead forests where the Nightsisters practise their dark magicks and rancors roam.',
    seed: 6661,
    gravity: 21,
    sky: { top: 0x6a4a5a, horizon: 0xd88a6a, sunColor: 0xffcfa8, suns: 1, sunElevation: 0.6, sunAzimuth: 5.2 },
    fog: { color: 0xc98a72, density: 0.0034 },
    light: { sunIntensity: 2.1, ambientSky: 0xb98a8a, ambientGround: 0x5a3a2a, ambientIntensity: 0.85 },
    terrain: { base: 3, amplitude: 34, frequency: 0.0029, octaves: 5, ridged: 0.45, flatten: 1.1, detail: 0.6 },
    water: { level: -5, color: 0x4a5a3a, opacity: 0.85 },
    palette: { low: 0x8a4a35, mid: 0xa25f3f, high: 0xc08a5f, slope: 0x5a2f24, shore: 0x9a6a4a },
    props: { treeDensity: 0.6, rockDensity: 0.5, treeStyle: 'dead', canopy: 0x3a2a24, trunk: 0x4a342a, rock: 0x6a4a3a, treeScale: 1.3 },
    creatures: { name: 'Rancor', count: 5, color: 0x6b4d3a, size: 4.2, speed: 3.5, hp: 900, aggressive: true, damage: 38 },
  },
  {
    id: 'yavin4',
    name: 'Yavin IV',
    tagline: 'Jungle moon of the Rebellion',
    description: 'A humid jungle moon of towering Massassi temples, once the secret base of the Rebel Alliance.',
    seed: 1977 + 4,
    gravity: 19,
    sky: { top: 0x5a8fc0, horizon: 0xd9e4c8, sunColor: 0xfff6d8, suns: 1, sunElevation: 0.95, sunAzimuth: 0.3 },
    fog: { color: 0xc2d0a8, density: 0.0044 },
    light: { sunIntensity: 2.2, ambientSky: 0xa5c0c8, ambientGround: 0x3f5a2a, ambientIntensity: 0.9 },
    terrain: { base: 2, amplitude: 22, frequency: 0.0034, octaves: 5, ridged: 0.1, flatten: 1.3, detail: 0.5 },
    water: { level: -3, color: 0x3a7a6a, opacity: 0.8 },
    palette: { low: 0x4f8a3a, mid: 0x3f7a30, high: 0x7a9a4a, slope: 0x6a5a40, shore: 0xa89a6a },
    props: { treeDensity: 1.5, rockDensity: 0.3, treeStyle: 'round', canopy: 0x2f6a2c, trunk: 0x5a4a30, rock: 0x7a7a6a, treeScale: 1.5 },
    creatures: { name: 'Mawgax', count: 10, color: 0x7a5a3a, size: 1.2, speed: 4, hp: 100, aggressive: true, damage: 9 },
  },
  {
    id: 'talus',
    name: 'Talus',
    tagline: 'Green world of the Corellian system',
    description: 'A Corellian sister world of grassland, lakes and gentle hills, quietly caught between Rebel and Imperial ambitions.',
    seed: 2004,
    gravity: 20,
    sky: { top: 0x5a9ade, horizon: 0xd0e4f3, sunColor: 0xfff7e6, suns: 1, sunElevation: 0.9, sunAzimuth: 1.7 },
    fog: { color: 0xc0d6e6, density: 0.0026 },
    light: { sunIntensity: 2.4, ambientSky: 0xa9c8ee, ambientGround: 0x5f8a4a, ambientIntensity: 0.9 },
    terrain: { base: 4, amplitude: 18, frequency: 0.003, octaves: 5, ridged: 0, flatten: 1.4, detail: 0.4 },
    water: { level: 1, color: 0x2f7fb0, opacity: 0.75 },
    palette: { low: 0x6faa4f, mid: 0x5a9542, high: 0x9ab27a, slope: 0x7a6a50, shore: 0xd0c48a },
    props: { treeDensity: 0.7, rockDensity: 0.25, treeStyle: 'round', canopy: 0x3f8a3a, trunk: 0x6a4a2a, rock: 0x8a8a80, treeScale: 1.1 },
    creatures: { name: 'Kahmurra', count: 10, color: 0x8fa07a, size: 1.0, speed: 4, hp: 70, aggressive: false, damage: 0 },
  },
  {
    id: 'rori',
    name: 'Rori',
    tagline: 'Swampy moon of Naboo',
    description: 'A marshy, fog-shrouded moon of Naboo, dotted with Gungan settlements and swamp-dwelling creatures.',
    seed: 2005,
    gravity: 18,
    sky: { top: 0x7a9a8a, horizon: 0xc8d6b8, sunColor: 0xfff2d0, suns: 1, sunElevation: 0.65, sunAzimuth: 3.2 },
    fog: { color: 0xb2c2a0, density: 0.0062 },
    light: { sunIntensity: 1.8, ambientSky: 0x9fb8a8, ambientGround: 0x4a5a3a, ambientIntensity: 0.9 },
    terrain: { base: 3, amplitude: 9, frequency: 0.0036, octaves: 4, ridged: 0, flatten: 1.2, detail: 0.35 },
    water: { level: 2, color: 0x4a6a4a, opacity: 0.85 },
    palette: { low: 0x5a7a3a, mid: 0x6a8a45, high: 0x8a9a60, slope: 0x5a5a3a, shore: 0x6a6a45 },
    props: { treeDensity: 1.1, rockDensity: 0.15, treeStyle: 'swamp', canopy: 0x3a6a35, trunk: 0x4a3a2a, rock: 0x6a6a5a, treeScale: 1.2 },
    creatures: { name: 'Torton', count: 6, color: 0x5a6b4a, size: 2.6, speed: 1.5, hp: 320, aggressive: false, damage: 0 },
  },
  {
    id: 'mustafar',
    name: 'Mustafar',
    tagline: 'Rivers of fire',
    description: 'A volcanic hell of lava rivers, black rock and mining platforms, where the Empire hides what it does not want found.',
    seed: 2005,
    // The Mensix Mining Facility's landing deck, where the game brought visitors in: the deck's own middle (cell 0's
    // floor, 230.06 high) with a body's standing height on it, facing the door into the landing deck room; the
    // heading is ours and the owner's to change (`__debug.arrival({ heading })`). It is the facility's starport's own
    // landing too (SOE's starports table puts its arrivals 8 m from it, raw (-2470.5, 230.4, 1622.1)), so a port's place on
    // Mustafar comes out here (`port`): the places list's row stands at the building's origin, over the valley floor.
    arrival: { raw: { x: -2478.1, z: 1620.0 }, y: 230.4, heading: -0.37, port: true },
    gravity: 22,
    sky: { top: 0x3a1f1c, horizon: 0xc2522a, sunColor: 0xffb070, suns: 1, sunElevation: 0.55, sunAzimuth: 3.6 },
    fog: { color: 0x5a2a20, density: 0.0046 },
    light: { sunIntensity: 1.9, ambientSky: 0xb0523a, ambientGround: 0x3a1a14, ambientIntensity: 1.2 },
    terrain: { base: 2, amplitude: 40, frequency: 0.0034, octaves: 5, ridged: 0.85, flatten: 1.0, detail: 0.7 },
    water: { level: -4, color: 0xff5a1a, opacity: 0.95 },
    palette: { low: 0x2a2224, mid: 0x3d3234, high: 0x5a4a48, slope: 0x1e1819, shore: 0x6a2a14 },
    props: { treeDensity: 0, rockDensity: 1.1, treeStyle: 'none', canopy: 0x000000, trunk: 0x000000, rock: 0x2b2426, treeScale: 1 },
    creatures: { name: 'Lava Flea', count: 8, color: 0x6a3a22, size: 1.2, speed: 5, hp: 110, aggressive: true, damage: 10 },
  },
  {
    id: 'kashyyyk',
    name: 'Kashyyyk',
    tagline: 'Wroshyr forests of the Wookiees',
    description: 'The Wookiee homeworld: kilometre-tall wroshyr trees, the tree-city of Kachirho, hunting grounds and the shadowed forest floor below.',
    seed: 2005,
    gravity: 19,
    sky: { top: 0x5f93c4, horizon: 0xd9e4d6, sunColor: 0xfff5dc, suns: 1, sunElevation: 0.8, sunAzimuth: 2.6 },
    fog: { color: 0xb5c9b8, density: 0.0044 },
    light: { sunIntensity: 2.0, ambientSky: 0x9bb8c8, ambientGround: 0x3c5636, ambientIntensity: 0.9 },
    terrain: { base: 2, amplitude: 26, frequency: 0.003, octaves: 5, ridged: 0.1, flatten: 1.2, detail: 0.6 },
    water: { level: -5, color: 0x2f6f7a, opacity: 0.8 },
    palette: { low: 0x3d6b33, mid: 0x4c7c3a, high: 0x6c8a52, slope: 0x5a4a3a, shore: 0x8a7a55 },
    props: { treeDensity: 1.6, rockDensity: 0.2, treeStyle: 'giant', canopy: 0x2a5a2c, trunk: 0x5a3f2e, rock: 0x6c6c62, treeScale: 1.3 },
    creatures: { name: 'Webweaver', count: 8, color: 0x4a3a2a, size: 1.6, speed: 5, hp: 150, aggressive: true, damage: 14 },
    zones: [
      { id: 'main', name: 'Kachirho', pack: 'kashyyyk_main' },
      { id: 'hunting', name: 'Etyyy, the Hunting Grounds', pack: 'kashyyyk_hunting' },
      // The client's own name for the dead forest (`planet_n`), which is what its gate in Kachirho reads.
      { id: 'dead_forest', name: 'Kkowir Forest', pack: 'kashyyyk_dead_forest' },
      { id: 'rryatt_trail', name: 'Rryatt Trail', pack: 'kashyyyk_rryatt_trail' },
      // Named for what each holds, in the game's own words (`zone_n`'s areas): the north zone is twelve Trandoshan
      // slave camps (the client's "Blackscale Processing Camp") and the four copies of the Arena, the south zone the
      // copies of Hracca and of Bocctyyy, and the pob zone the Myyydril caverns' copies beside the Avatar Platform's.
      // The south zone was called the dead forest's own name, and the dead forest was not.
      { id: 'north_dungeons', name: 'Blackscale Processing Camp and the Arena', pack: 'kashyyyk_north_dungeons' },
      { id: 'south_dungeons', name: 'Hracca and Bocctyyy', pack: 'kashyyyk_south_dungeons' },
      { id: 'pob_dungeons', name: 'Myyydril Caverns and the Avatar Platform', pack: 'kashyyyk_pob_dungeons' },
    ],
  },
  {
    id: 'canyon',
    name: 'Granyon',
    tagline: 'Grandeur like nowhere in the galaxy.',
    description: 'Crevasse',
    seed: 6660,
    gravity: 21,
    sky: { top: 0x8a5a3a, horizon: 0xe0a26a, sunColor: 0xffd7a3, suns: 1, sunElevation: 0.8, sunAzimuth: 4.4 },
    fog: { color: 0xd39a66, density: 0.00038 },
    light: { sunIntensity: 2.6, ambientSky: 0xd9a070, ambientGround: 0x6a5040, ambientIntensity: 1.15 },
    terrain: { base: 2, amplitude: 48, frequency: 0.0032, octaves: 5, ridged: 0.8, flatten: 1.0, detail: 0.7 },
    dem: { url: '/dem/canyon', size: 32768, lift: -719.7274780273438, feather: 600, detail: .4 },
    pack: false,
    water: { level: 100, color: 0x2c4a52, opacity: 0.86 },
    palette: { low: 0xd8b073, mid: 0xe7c78d, high: 0xf2dcaa, slope: 0xb48d56, shore: 0xe7c78d },
    props: { treeDensity: 0, rockDensity: 0.55, treeStyle: 'none', canopy: 0x000000, trunk: 0x000000, rock: 0x8f7355, treeScale: 1 },
    creatures: { name: 'Bantha', count: 8, color: 0x6b5334, size: 2.3, speed: 2, hp: 260, aggressive: false, damage: 0 },
    ground: GRAND_CANYON_LOK,
    borrowSky: 'lok',
  },
  {
    // Ground from USGS 3DEP around Seattle: Puget Sound, Bainbridge, Lake Washington and the
    // first rise of the Cascades. The source is 1/3 arc-second -- about 7 m across and 10 m
    // north-south at this latitude -- so everything below the fractal detail is invention.
    id: 'seattle',
    name: 'Rainier',
    tagline: 'A drowned coast under cloud',
    description: 'Deep cold water between forested ridges, the sea reaching far inland through a country that was carved by ice and never quite drained.',
    borrowSky: 'dantooine',
    seed: 1138,
    gravity: 21,
    sky: { top: 0x6f8296, horizon: 0xb9c2c6, sunColor: 0xe8eef2, suns: 1, sunElevation: 0.42, sunAzimuth: 2.9 },
    fog: { color: 0xaeb9bf, density: 0.00042 },
    light: { sunIntensity: 1.5, ambientSky: 0x9fb3c4, ambientGround: 0x55604f, ambientIntensity: 1.25 },
    terrain: { base: 0, amplitude: 60, frequency: 0.0030, octaves: 4, ridged: 0.4, flatten: 1.0, detail: 0.4 },
    dem: { url: '/dem/seattle', size: 32768, lift: 15.707568168640137, feather: 0, detail: 1 },
    pack: false,
    water: { level: 25, color: 0x2c4a52, opacity: 0.86 },
    palette: { low: 0x5f9a47, mid: 0x4a7f3a, high: 0x8a9a75, slope: 0x6f6a60, shore: 0xc8ba85 },
    props: { treeDensity: 0.9, rockDensity: 0.12, treeStyle: 'pine', canopy: 0x2c4028, trunk: 0x4a3828, rock: 0x6c6a63, treeScale: 1.3 },
    creatures: { name: 'Elk', count: 10, color: 0x6b513a, size: 2.0, speed: 6, hp: 180, aggressive: false, damage: 0 },
  },
  {
    id: 'monument',
    name: 'Monument',
    dem: { url: '/dem/monument', size: 16288, lift: -1490.344970703125, feather: 0, detail: 1 },
    pack: false,
    tagline: 'Monument Valley',
    description: 'An old land from another world',
    seed: 4242,
    gravity: 22,
    sky: { top: 0x8db9e6, horizon: 0xf4dcae, sunColor: 0xfff1cf, suns: 2, sunElevation: 0.9, sunAzimuth: 0.7 },
    fog: { color: 0xead2a3, density: 0.00012 },
    swgFogScale: 0.005,
    light: { sunIntensity: 1.0, ambientSky: 0xbfd6f2, ambientGround: 0xd9b57a, ambientIntensity: 1.0 },
    terrain: { base: 0, amplitude: 16, frequency: 0.0038, octaves: 4, ridged: 0.6, flatten: 1.1, detail: 0.35 },
    water: { level: 150, color: 0x2f6f8a, opacity: 0.8 },
    palette: { low: 0xd8b073, mid: 0xe7c78d, high: 0xf2dcaa, slope: 0xb48d56, shore: 0xe7c78d },
    props: { treeDensity: 0, rockDensity: 0.55, treeStyle: 'none', canopy: 0x000000, trunk: 0x000000, rock: 0x8f7355, treeScale: 1 },
    creatures: { name: 'Bantha', count: 8, color: 0x6b5334, size: 2.3, speed: 2, hp: 260, aggressive: false, damage: 0 },
    borrowSky: 'tatooine',
  },
  {
    id: 'helens',
    name: 'Helensar',
    dem: { url: '/dem/helens', size: 24576, lift: -299.8861083984375, feather: 0, detail: 1 },
    pack: false,
    tagline: 'An erupted goliath',
    description: 'An old land from another world',
    seed: 4001,
    gravity: 22,
    sky: { top: 0x8db9e6, horizon: 0xf4dcae, sunColor: 0xfff1cf, suns: 2, sunElevation: 0.9, sunAzimuth: 0.7 },
    fog: { color: 0xead2a3, density: 0.00012 },
    swgFogScale: 0.005,
    light: { sunIntensity: 2.6, ambientSky: 0xbfd6f2, ambientGround: 0xd9b57a, ambientIntensity: 1.0 },
    terrain: { base: 0, amplitude: 16, frequency: 0.0038, octaves: 4, ridged: 0.6, flatten: 1.1, detail: 1 },
    water: { level: .5, color: 0x2f6f8a, opacity: 0.8 },
    palette: { low: 0x6faa4f, mid: 0x5a9542, high: 0x9ab27a, slope: 0x7a6a50, shore: 0xd0c48a },
    props: { treeDensity: 0.7, rockDensity: 0.25, treeStyle: 'none', canopy: 0x3f8a3a, trunk: 0x6a4a2a, rock: 0x8a8a80, treeScale: 1.1 },
    creatures: { name: 'Bantha', count: 8, color: 0x6b5334, size: 2.3, speed: 2, hp: 260, aggressive: false, damage: 0 },
    borrowSky: 'corellia',
  },
];

/** The pack directory a planet (or one of its zones) loads from. */
export function packIdOf(planet: PlanetDef, zoneId?: string): string {
  if (!planet.zones?.length) return planet.id;
  return (planet.zones.find((z) => z.id === zoneId) ?? planet.zones[0]).pack;
}

/** The development gallery: flat ground under Tatooine's sky, for looking at every animation, house, vehicle and weapon. */
PLANETS.push({
  id: 'gallery',
  name: 'Gallery',
  tagline: 'Every animation, house, vehicle and weapon, in rows',
  description: 'A flat development world: the animations of both games on a grid of player models, every player house, vehicle and weapon, each with its name over it. Built by the converter\'s gallery command.',
  seed: 4242,
  gravity: 20,
  sky: { top: 0x8db9e6, horizon: 0xf4dcae, sunColor: 0xfff1cf, suns: 2, sunElevation: 0.9, sunAzimuth: 0.7 },
  fog: { color: 0xead2a3, density: 0.0012 },
  swgFogScale: 0.05,
  light: { sunIntensity: 2.6, ambientSky: 0xbfd6f2, ambientGround: 0xd9b57a, ambientIntensity: 1.0 },
  terrain: { base: 0, amplitude: 0, frequency: 0.004, octaves: 1, ridged: 0, flatten: 1, detail: 0 },
  palette: { low: 0xd8b073, mid: 0xe7c78d, high: 0xf2dcaa, slope: 0xb48d56, shore: 0xe7c78d },
  props: { treeDensity: 0, rockDensity: 0, treeStyle: 'none', canopy: 0x000000, trunk: 0x000000, rock: 0x8f7355, treeScale: 1 },
  creatures: { name: 'Bantha', count: 0, color: 0x6b5334, size: 2.3, speed: 2, hp: 260, aggressive: false, damage: 0 },
});

/**
 * The instances zone (`dungeon1`, converted as a world by `snapshot`): sixteen copies of each of the
 * corvette's three runs and ten of each heroic, hung over ground the client never drew. A group is sent
 * to one copy by a dungeon's own way in and leaves where it came in; it is no place to travel to. The
 * sky numbers are a space system's, so the shared day's planet list gains no new sun to keep apart.
 */
PLANETS.push({
  id: 'dungeon1',
  name: 'Instances',
  tagline: 'The copies the game stood for each group',
  description: 'The Corellian corvette, the Star Destroyer, the Tomb of Exar Kun, Axkva Min\'s prison, IG-88\'s arena and the meatlump hideout, each one copy per group, reached only through their own ways in.',
  seed: 5201,
  gravity: 20,
  instances: true,
  sky: { top: 0x000000, horizon: 0x000000, sunColor: 0xffffff, suns: 1, sunElevation: 0.9, sunAzimuth: 1.2 },
  fog: { color: 0x000000, density: 0 },
  swgFogScale: 0,
  light: { sunIntensity: 2.2, ambientSky: 0x9fb0c8, ambientGround: 0x303848, ambientIntensity: 0.8 },
  terrain: { base: 0, amplitude: 0, frequency: 0.004, octaves: 1, ridged: 0, flatten: 1, detail: 0 },
  palette: { low: 0x14202e, mid: 0x3f4a5a, high: 0x9fa6b0, slope: 0x14202e, shore: 0x3f4a5a },
  props: { treeDensity: 0, rockDensity: 0, treeStyle: 'none', canopy: 0x000000, trunk: 0x000000, rock: 0x000000, treeScale: 1 },
  creatures: { name: 'Nothing', count: 0, color: 0x000000, size: 1, speed: 0, hp: 1, aggressive: false, damage: 0 },
});

/**
 * The ground terrains the game never offered as worlds (`PlanetDef.extra`, the converter's `EXTRA_WORLDS`), each its own
 * converted pack: the heroics' maps with their copies standing side by side and nobody in them, an older or unreleased
 * planet, the developers' tests. Their sky, ground and weather are the pack's own; the numbers here are only what a world
 * with no pack would draw, and each sun is an existing planet's, so the shared day's planet list gains none to keep apart.
 */
function extraWorld(o: Pick<PlanetDef, 'id' | 'name' | 'tagline' | 'description' | 'seed'> & { sunOf: string; palette: PlanetDef['palette']; zones?: PlanetZone[]; arrival?: WorldArrival }): PlanetDef {
  const sun = PLANETS.find((p) => p.id === o.sunOf)!;
  return {
    id: o.id,
    name: o.name,
    tagline: o.tagline,
    description: o.description,
    seed: o.seed,
    extra: true,
    gravity: 20,
    sky: { ...sun.sky },
    fog: { ...sun.fog },
    ...(sun.swgFogScale !== undefined ? { swgFogScale: sun.swgFogScale } : {}),
    light: { ...sun.light },
    terrain: { base: 0, amplitude: 0, frequency: 0.004, octaves: 1, ridged: 0, flatten: 1, detail: 0 },
    palette: o.palette,
    props: { treeDensity: 0, rockDensity: 0, treeStyle: 'none', canopy: 0x000000, trunk: 0x000000, rock: 0x8f8f8f, treeScale: 1 },
    creatures: { name: 'Nothing', count: 0, color: 0x000000, size: 1, speed: 0, hp: 1, aggressive: false, damage: 0 },
    ...(o.zones ? { zones: o.zones } : {}),
    ...(o.arrival ? { arrival: o.arrival } : {}),
  };
}

PLANETS.push(
  extraWorld({
    id: 'adventure2',
    name: 'Hoth: Echo Base',
    tagline: 'The Battle of Echo Base, nine times over',
    description: 'The ice world of the heroic Battle of Echo Base: the Rebel base dug into the glacier and the snowfields round it. The game stood one copy per group; here all nine stand side by side, with nobody in them.',
    seed: 1980,
    sunOf: 'talus',
    palette: { low: 0xdfe7ee, mid: 0xeef3f7, high: 0xffffff, slope: 0xa9b6c2, shore: 0xdfe7ee },
    // In the Main Hangar (`r15`, its name in the base's own portal layout) of the copy of the base nearest the layout's
    // centre, where its heroic began: the room is found when the base is in and stood on its own floor. The raw place is
    // that room's middle in that copy (the base at raw -5006.8, 0.1, the room's box in the model's frame), measured, so
    // the world streams round it; arriving at the layout's centre stood the player 753 m off it in the snow.
    arrival: { raw: { x: -5247.6, z: 546.0 }, y: 105.9, room: { template: 'object/building/heroic/shared_echo_base.iff', cell: 'r15' } },
  }),
  extraWorld({
    id: 'adventure1',
    name: 'Heroic: Tusken army',
    tagline: 'The heroic against the Tusken army, twelve times over',
    description: 'The desert of the heroic against the Tusken army. The game stood one copy per group; here all twelve stand side by side, with nobody in them.',
    seed: 1981,
    sunOf: 'tatooine',
    palette: { low: 0xd8b073, mid: 0xe7c78d, high: 0xf2dcaa, slope: 0xb48d56, shore: 0xe7c78d },
  }),
  // The archives' early Kashyyyk in one piece. Its pack is `kashyyyk`, the archives' own name for the terrain, which is
  // Kashyyyk's own id, so it is a planet of one zone whose pack that is: a planet split into zones never loads its own id.
  extraWorld({
    id: 'kashyyyk_early',
    name: 'Old Kashyyyk',
    tagline: 'Kashyyyk in one piece, before it was split into zones',
    description: 'An early terrain of the Wookiee world in one piece, from before the game split it into zones: its ground, sky and plants, with nothing built on it.',
    seed: 2006,
    sunOf: 'kashyyyk',
    palette: { low: 0x3d6b33, mid: 0x4c7c3a, high: 0x6c8a52, slope: 0x5a4a3a, shore: 0x8a7a55 },
    zones: [{ id: 'world', name: 'the one terrain', pack: 'kashyyyk' }],
  }),
  extraWorld({
    id: 'tuskan_raid_encounter',
    name: 'Tusken raid encounter',
    tagline: 'The ground of an encounter with Tusken raiders',
    description: 'The terrain of an encounter with Tusken raiders: its desert ground, sky and plants, with nothing standing on it.',
    seed: 1982,
    sunOf: 'tatooine',
    palette: { low: 0xd8b073, mid: 0xe7c78d, high: 0xf2dcaa, slope: 0xb48d56, shore: 0xe7c78d },
  }),
  extraWorld({
    id: 'taanab',
    name: 'Taanab',
    tagline: 'A planet the game never released',
    description: 'The terrain of Taanab, a planet the game never released: its ground, sky and plants, with nothing built on it.',
    seed: 1983,
    sunOf: 'naboo',
    palette: { low: 0x74a64b, mid: 0x4f8c3a, high: 0x9db76c, slope: 0x7c6a4e, shore: 0xd9c98f },
  }),
  extraWorld({
    id: 'otoh_gunga',
    name: 'Otoh Gunga',
    tagline: 'The Gungans\' sea floor, with nothing of its own drawn',
    description: 'The terrain of Otoh Gunga, the Gungans\' city under Naboo\'s lakes: 32 km of ground falling to a kilometre below the water. The archives hold none of its ground pictures, grass or sky, so it wears a plain stand-in ground of ours and Naboo\'s sky, and no city stands on it.',
    seed: 1999 + 1,
    sunOf: 'naboo',
    palette: { low: 0x2e5a5a, mid: 0x3f6a62, high: 0x6f8a7a, slope: 0x4a5a52, shore: 0x8a8a6a },
  }),
  // The old newbie tutorial's terrain, where the server stood a hall for each new player in code: the hall, and the NGE's
  // Tansarii Point Station, stand there as permanent placement rows of ours (`public/placements/world/tutorial.json`),
  // with nobody in them and no quest, 1.5 km apart.
  extraWorld({
    id: 'tutorial',
    name: 'The old tutorial',
    tagline: 'The newbie hall, and Tansarii Point Station beside it',
    description: 'The terrain the old tutorial stood its hall on, black as the space the tutorial was set in, with the hall standing at its middle and the NGE\'s Tansarii Point Station 1.5 km east: places to walk, with nobody in them and no quest.',
    seed: 2003,
    sunOf: 'corellia',
    palette: { low: 0x6f6f6f, mid: 0x7f7f7f, high: 0x9f9f9f, slope: 0x5f5f5f, shore: 0x8f8f8f },
    // Where the emulator put a new player: in the hall's first room (`r1`) at (0, 0, -3) in the hall's own frame (Core3's
    // `PlayerManagerImplementation`), which for the hall's row at raw (0, 3.5, 0), unturned, is raw (0, -3) on its floor at
    // 3.5. The room is entered when the hall is in. It used to be outside the hangar door, 428 m off.
    arrival: { raw: { x: 0, z: -3 }, y: 3.8, heading: 0, room: { template: 'object/building/general/shared_newbie_hall.iff', cell: 'r1', at: [0, 0, -3] } },
  }),
  // The developers' own test terrains, each converted as it stands; what each holds is what its terrain makes, and a
  // terrain the archives hold no sky for wears another world's (the converter's `SKY_LENT`).
  ...([
    ['09', 'a 4 km map, ground from -5 to 100 m in two families, with a little flora', ''],
    ['simple', 'flat ground in two families with eight bridge pieces its buildout table places', 'Corellia'],
    ['floratest', 'a gentle 4 km map, ground from 3 to 7 m, planted to try the flora', 'Corellia'],
    ['rivertest', 'a 4 km map, ground from -20 to 122 m in two families', 'Corellia'],
    ['terrain_test', 'a 4 km map, ground from 0 to 100 m in four families, with flora', ''],
    ['watertabletest', 'a 4 km map, ground from 0 to 50 m', 'Corellia'],
    ['creature_test', 'a 4 km map of low hills, ground from 10 to 41 m', 'Corellia'],
    ['godclient_test', 'an 8 km map, ground from -68 to 81 m in four families', 'Corellia'],
    ['cinco_city_test_m5', 'a 16 km map, ground from -60 to 337 m in seventeen families, with flora', 'Corellia'],
    ['endor_asommers', 'a 16 km map, ground from -50 to 389 m in sixteen families', 'Endor'],
    ['umbra', 'a small 4 km map, ground from 0 to 25 m in one family', 'Corellia'],
    ['10', 'flat 4 km ground in one family, with nothing growing or standing on it', 'Corellia'],
    ['11', 'flat 4 km ground in one family, with a little flora', 'Corellia'],
    ['test_wearables', 'flat 4 km ground in one family, with a little flora, where the clothes were tried', 'Corellia'],
    ['character_farm', 'flat 16 km ground in one family with nothing on it, named for making characters in bulk', 'Corellia'],
    ['runtimerules', 'the engine\'s own file of run-time terrain rules, 4 km of ground from 0 to 37 m with no ground family at all, drawn in the game\'s plain stand-in colours', 'Corellia'],
  ] as const).map(([id, what, lent], i) =>
    extraWorld({
      id,
      name: `Test: ${id}`,
      tagline: "A developers' test terrain",
      description: `One of the developers' own test terrains in the archives, converted as it stands: ${what}.${lent ? ` The archives hold no sky for it, so it wears ${lent}'s.` : ''}`,
      seed: 7000 + i,
      sunOf: 'corellia',
      // `simple`'s buildout stands two of its bridge pieces on the flat ground at its layout centre, where an arrival
      // looked for there stood the body inside one and dropped it through the ground onto the pieces 19 m below, which
      // the table placed for some other ground: it arrives 57 m north of them on the open flat (ours), facing them.
      ...(id === 'simple' ? { arrival: { raw: { x: 9, z: 30 }, y: 0.3, heading: Math.PI } } : {}),
      palette: { low: 0x6f8a5a, mid: 0x7f8f6a, high: 0xa9b29a, slope: 0x6a6258, shore: 0xb8ad88 },
    }),
  ),
);

/**
 * The space zones (the converter's `space` command, one pack each): the orbit of a planet, with
 * its stations, asteroid fields and the planet itself hanging in the sky. No ground (the
 * procedural terrain sits three kilometres down, out of sight and reach), no gravity, no fog.
 */
const SPACE_ZONES: { id: string; planet: string }[] = [
  { id: 'space_tatooine', planet: 'tatooine' },
  { id: 'space_naboo', planet: 'naboo' },
  { id: 'space_corellia', planet: 'corellia' },
  { id: 'space_dantooine', planet: 'dantooine' },
  { id: 'space_lok', planet: 'lok' },
  { id: 'space_endor', planet: 'endor' },
  { id: 'space_dathomir', planet: 'dathomir' },
  { id: 'space_yavin4', planet: 'yavin4' },
  { id: 'space_kashyyyk', planet: 'kashyyyk' },
];
for (const z of SPACE_ZONES) {
  const parent = PLANETS.find((p) => p.id === z.planet);
  if (!parent) continue;
  PLANETS.push({
    id: z.id,
    name: `${parent.name} orbit`,
    tagline: 'The system above: stations, asteroid fields, the planet below',
    description: `The space above ${parent.name}: its station, its asteroid fields and the planet hanging in the sky. Flown in a ship; a ship climbing past the sky over ${parent.name} is offered the way up, and one here the way down.`,
    seed: parent.seed + 7,
    gravity: 0,
    space: parent.id,
    sky: { top: 0x000000, horizon: 0x000000, sunColor: 0xffffff, suns: 1, sunElevation: 0.9, sunAzimuth: 1.2 },
    fog: { color: 0x000000, density: 0 },
    swgFogScale: 0,
    light: { ...parent.light },
    terrain: { base: -3000, amplitude: 0, frequency: 0.004, octaves: 1, ridged: 0, flatten: 1, detail: 0 },
    palette: { low: 0x000000, mid: 0x000000, high: 0x000000, slope: 0x000000, shore: 0x000000 },
    props: { treeDensity: 0, rockDensity: 0, treeStyle: 'none', canopy: 0x000000, trunk: 0x000000, rock: 0x000000, treeScale: 1 },
    creatures: { name: 'Nothing', count: 0, color: 0x000000, size: 1, speed: 0, hp: 1, aggressive: false, damage: 0 },
  });
}

/**
 * The space systems that are no planet's orbit (the converter's `space` command converts them like the
 * orbits): nothing below them to land on. Their `space` is a name of their own, never a planet's id, so
 * `planetBelow` finds nothing. The palette only colours the loading screen's fallback globe (the ground
 * is never built in space).
 */
const SYSTEMS: { id: string; system: string; name: string; tagline: string; description: string; seed: number; palette: PlanetDef['palette'] }[] = [
  {
    id: 'space_light1',
    system: 'kessel',
    name: 'Kessel',
    tagline: 'Spice mines and a maze of rocks',
    description: 'The Kessel system: bands and clusters of asteroids round the spice world and its moons. Reached by hyperspace; its four jump points are placed by us, since the game kept them on its servers.',
    seed: 5101,
    palette: { low: 0x2a2638, mid: 0x6f6a86, high: 0xb9b4c9, slope: 0x2a2638, shore: 0x6f6a86 },
  },
  {
    id: 'space_ord_mantell',
    system: 'ord_mantell',
    name: 'Ord Mantell',
    tagline: 'A station in a belt of iron',
    description: 'Ord Mantell: a lone station in the Masulivis Belt, among mining and cargo lanes. Its one jump point is the Nova Orion point the game gave the same sector.',
    seed: 5102,
    palette: { low: 0x1d3a3f, mid: 0x4f8a8c, high: 0xa9d2cf, slope: 0x1d3a3f, shore: 0x4f8a8c },
  },
  {
    id: 'space_heavy1',
    system: 'deep_space',
    name: 'Deep Space',
    tagline: 'The Unknown Regions, and a Star Destroyer',
    description: 'Deep Space, in the Unknown Regions: a Star Destroyer hangs near the first jump point with wreckage beside it. Its places are made up (the game kept them on its servers): the jump points, the fields and where the Star Destroyer sits.',
    seed: 5103,
    palette: { low: 0x1a1426, mid: 0x4a3a6a, high: 0x9a8cc0, slope: 0x1a1426, shore: 0x4a3a6a },
  },
  {
    // Not a place in the game at all: a system of our own to fly in, written from a seed by the
    // converter's `sandbox` command out of what the client already has. Without that pack the zone
    // is listed and says it is not converted, as any other unconverted zone does.
    id: 'space_sandbox',
    system: 'sandbox',
    name: 'Sandbox',
    tagline: 'A system of our own, to fly fast in',
    description: 'A made-up system: a sun, a few planets far enough out to fly toward, and asteroid fields between them. Nothing in it is from the game; every place and size in it is ours, and it is 250 km across, which is as far as an ultra-fast cruise will carry you before it turns you round.',
    seed: 5104,
    palette: { low: 0x14202e, mid: 0x3f6a86, high: 0x9fc6d8, slope: 0x14202e, shore: 0x3f6a86 },
  },
  // The NGE's new-player flight aboard the Millennium Falcon: three copies of one zone the server sent new players to, a
  // planet in the sky and nothing else of the client's in them (no station, field or jump point), reached by the
  // developer's travel and kept off the galaxy map, with no quest.
  ...[1, 2, 3].map((n) => ({
    id: n === 1 ? 'space_npe_falcon' : `space_npe_falcon_${n}`,
    system: n === 1 ? 'npe_falcon' : `npe_falcon_${n}`,
    name: n === 1 ? 'The Falcon\'s flight' : `The Falcon's flight ${n}`,
    tagline: 'The NGE\'s new-player flight aboard the Millennium Falcon',
    description: 'The space the NGE flew a new player through aboard the Millennium Falcon: its sky and the planet in it, with nothing else of the game\'s and no quest. The game stood three copies of it.',
    seed: 5105 + n,
    palette: { low: 0x1a1426, mid: 0x4a3a6a, high: 0x9a8cc0, slope: 0x1a1426, shore: 0x4a3a6a },
  })),
];
for (const s of SYSTEMS) {
  PLANETS.push({
    id: s.id,
    name: s.name,
    tagline: s.tagline,
    description: s.description,
    seed: s.seed,
    gravity: 0,
    // Truthy: everything that treats a world as space sees a space zone; no planet has this id.
    space: s.system,
    sky: { top: 0x000000, horizon: 0x000000, sunColor: 0xffffff, suns: 1, sunElevation: 0.9, sunAzimuth: 1.2 },
    fog: { color: 0x000000, density: 0 },
    swgFogScale: 0,
    light: { sunIntensity: 2.2, ambientSky: 0x9fb0c8, ambientGround: 0x303848, ambientIntensity: 0.8 },
    terrain: { base: -3000, amplitude: 0, frequency: 0.004, octaves: 1, ridged: 0, flatten: 1, detail: 0 },
    palette: s.palette,
    props: { treeDensity: 0, rockDensity: 0, treeStyle: 'none', canopy: 0x000000, trunk: 0x000000, rock: 0x000000, treeScale: 1 },
    creatures: { name: 'Nothing', count: 0, color: 0x000000, size: 1, speed: 0, hp: 1, aggressive: false, damage: 0 },
  });
}

/** The space zone above a planet, when the game has one. */
export function spaceZoneOf(planet: PlanetDef): PlanetDef | null {
  return PLANETS.find((p) => p.space === planet.id) ?? null;
}

/** The planet a space zone is the orbit of, or null (a ground planet, or a system with nothing below: Kessel, Ord Mantell, Deep Space). */
export function planetBelow(zone: PlanetDef): PlanetDef | null {
  return PLANETS.find((p) => p.id === zone.space && !p.space) ?? null;
}

export function planetById(id: string): PlanetDef {
  const p = PLANETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown planet ${id}`);
  return p;
}
