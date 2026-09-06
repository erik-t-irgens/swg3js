export type TreeStyle = 'none' | 'palm' | 'pine' | 'round' | 'dead' | 'giant' | 'swamp';

export interface PlanetDef {
  id: string;
  name: string;
  tagline: string;
  description: string;
  seed: number;
  /** Downward acceleration in m/s². Real planets vary; SWG feel is snappier than Earth. */
  gravity: number;
  sky: { top: number; horizon: number; sunColor: number; suns: number; sunElevation: number; sunAzimuth: number };
  fog: { color: number; density: number };
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
];

export function planetById(id: string): PlanetDef {
  const p = PLANETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown planet ${id}`);
  return p;
}
