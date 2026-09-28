// Where the wild things are: the rules for laying lairs, herds and camps across a world.
//
// **What is the server's and what is ours.** The server's data gives the *shape* of each area, the
// weighted list of lairs that may stand in it, how many creatures it allows at once, and which
// animals each lair holds with their own levels, health and damage. It gives no coordinate for a
// single creature anywhere: the real server drew a point near a moving player when it felt like it,
// and a second later that point was gone. So every position here is ours, drawn from a seed, and the
// pack says so of itself (`source.creaturePlaces: 'invented'`).
//
// **Drawn from a seed, not rolled.** Every browser standing the same world must lay the same lairs
// in the same places, because one of them may be keeping a creature that another is drawing. So a
// site's place, which lair stands there and how many guard it all come out of one number made from
// the world and the site's cell, and nothing here ever calls `Math.random`.
//
// **Laid on a grid, not divided by area.** The server drew a lair 32 metres to the close-object range
// from whoever was moving, every five seconds, anywhere a spawn area reached, which is a world where
// you meet something most of the time. Dividing each area into a fixed number of sites could not give
// that: the big areas all hit the cap, a whole quarter of a desert got two dozen, and three quarters of
// every world had nothing within reach. So the world is cut into cells, a share of them hold a site at
// a point drawn inside the cell, and the site belongs to the *smallest* spawn area holding that point,
// the world-wide one where no other does. The server's own rules still decide what may stand there:
// the area's weighted list, the places nothing may stand, and the gap it kept between one spawn and
// anything else.
//
// **What a lair is**, which is the owner's own description of the game and not something the data
// says: a nest that can be knocked down, with four or five of one creature standing round it when
// you arrive. Hitting it brings more out, it has a great deal of health, and killing it stops the
// spawning for good until it comes back on its own clock. The data's other two kinds are the server's:
// a herd or a group loose in the wilderness with nothing to break, and a camp -- a point of interest
// with its tents and its people -- which nobody can knock down. Both stand as many as the server's own
// rule says (`standingAt`), and each of their bodies is drawn from the lair's list on its own.
//
// Pure: no three, no fetch, no clock. Rule for this file (node runs it with type stripping for the
// tests): relative imports only as `import type`, no enum, no namespace, no constructor parameter
// properties.

/** One of the shapes an area can be, in the snapshot's own metres. */
export interface SpawnArea {
  name: string;
  shape: 'circle' | 'ring' | 'rect';
  x: number;
  z: number;
  r?: number;
  inner?: number;
  x2?: number;
  z2?: number;
  groups: string[];
  cap: number;
  /**
   * The world-wide area, one a world (the server's `WORLDSPAWNAREA`), or, on a place nothing may stand,
   * one that keeps out only the world-wide area (`NOWORLDSPAWNAREA`: the rings round every town, which
   * have spawns of their own). The world-wide area's shape is a placeholder: it holds every point no
   * other area does.
   */
  world?: boolean;
}

/** One lair a group may put down, with the weight it is drawn at. */
export interface GroupEntry {
  lair: string;
  weight: number;
  count: number;
  size: number;
  limit: number;
  minDiff: number;
  maxDiff: number;
}

/** What stands at a lair, and what the lair itself is. */
export interface LairDef {
  kind: string;
  mobiles: { who: string; n: number }[];
  boss: { who: string; n: number }[];
  cap: number;
  nest: string | null;
  building: string;
  people: boolean;
}

/** One creature, with the numbers the server gave it. */
export interface CreatureDef {
  id: string;
  level: number | null;
  hp: number | null;
  hpMax: number | null;
  damage: [number, number];
  diet: string;
  kind: string;
  aggressive: boolean;
  herd: boolean;
  pack: boolean;
  social: string;
  /**
   * Its own numbers, worked out by the catalogue's own rule from its own record (pack format 2, the
   * converter's `gameOf`): every body is shared by every creature drawn as it, and the body's catalogue
   * entry carries only one of theirs. Read as data here, so every field is checked where it is used.
   */
  game?: { level?: unknown; hp?: unknown; damage?: unknown; aggression?: unknown; ranged?: unknown; attackable?: unknown; killer?: unknown; stalker?: unknown };
  /** Pack format 2: what it fought with, first and second, as the emulator wrote them. */
  weapons?: unknown;
}

/**
 * Every invented number of the wild world, and the two of the server's it spaces sites by. The data
 * says what may stand where, and all of this says how much of it, how near, and how hard. Live through
 * `__debug.wild`.
 */
export const LAIR_TUNE = {
  /** The side of one cell of the grid the world's sites are laid on, metres. */
  cell: 240,
  /**
   * The share of cells that hold a site. Measured over the real worlds to put a site within `build` of
   * 67 to 80 percent of each, where the old per-area division reached 21 to 27; every cell filled is
   * 83 to 97. The owner's call (D4), and what `liveLairs` and `liveBodies` still bound the cost of.
   */
  fill: 0.6,
  /** How far a site on ground nobody can walk is moved to find some, metres; one with none that near is dropped. */
  siteNudge: 30,
  /**
   * The server's own test of the ground under a spawn (`isSpawningPermittedAt`): refused where the
   * ground over a square `flatReach` metres either way of it rises more than `flatRise` from its lowest
   * to its highest. The walk grid alone passes a hillside a body can climb, and a camp there stood its
   * pieces twenty metres apart in height.
   */
  flatReach: 10,
  flatRise: 15,
  /**
   * The server's own gap between one spawn and anything else, metres, before the lair's own footprint is
   * added (`spawnCheckRange`, 64 by default): no two sites stand nearer than this plus the larger footprint.
   */
  gap: 64,
  /**
   * How often each building level, 1 to 5, is drawn for a site. The server worked it out from the
   * lair's level against the player's, and this game's player has no level, so it is seeded: what a
   * camp's or a herd's head count and a nest's health follow. Ours.
   */
  levels: [0.15, 0.3, 0.3, 0.15, 0.1] as [number, number, number, number, number],
  /** A site nearer than this to the player is stood up; one further than `drop` is put away. */
  build: 200,
  drop: 320,
  /** Most lairs and most wild bodies alive at once, whatever the areas allow. */
  liveLairs: 4,
  liveBodies: 26,
  /** How many stand at a nest when you come upon it. The owner's own count. */
  guards: [4, 5] as [number, number],
  /** How many more come out when it is struck, and the least time between one lot and the next. */
  reinforce: 2,
  reinforceEvery: 6,
  /** How long a broken lair or an emptied camp stays so, in seconds. The band the server's own people respawn in. */
  respawn: [300, 600] as [number, number],
  /** How far a herd's bodies scatter, and how far a nest's guards and a camp's people stand from its middle. */
  herdSpread: 14,
  guardSpread: 9,
};

/**
 * Half the side of every world that has spawn areas, metres, in the snapshot's frame (centred on
 * nought): the ten worlds the server peopled are all sixteen kilometres across. The grid is laid over
 * this square, since the world-wide area's own shape is a placeholder that holds nothing.
 */
export const WORLD_HALF = 8000;

/**
 * The server's own health for a lair by its building level, before its level adds to it, and the most
 * any lair may have (`CreatureManagerImplementation::spawnLair`, `CREATURE_LAIR_MIN` and `_MAX`).
 */
export const LAIR_CONDITION = { levels: [1000, 3000, 6000, 9000, 18000] as readonly number[], max: 64000 };

/**
 * The curve every one of the server's health numbers is carried into this game's by: the square root
 * of what the server had, so a level 80 boss is a few times a level 5 critter rather than a hundred
 * times. A copy of the health half of the converter's `CORE3_MAP` (`tools/swg/mobiles.mjs`), which the
 * node test holds the two to, so a nest and the creatures round it are measured on one scale.
 */
export const CORE3_HEALTH = { base: 30, scale: 8, min: 20, max: 6000 } as const;

/**
 * A seeded stream of numbers in 0 to 1.
 *
 * Deliberately a plain integer hash rather than anything clever: it has to give the same answers in
 * every browser and in a node test for ever, so it must be written down here and never come from a
 * library or a platform.
 */
export function rolls(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One number from a world, a name and an index: the seed a site is drawn from. */
export function seedOf(world: string, area: string, index: number): number {
  let h = 2166136261;
  const text = `${world}/${area}/${index}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The seed of one cell of the grid: the world and the cell, so the same cell draws the same site everywhere. */
export function cellSeed(world: string, i: number, j: number): number {
  return seedOf(world, `cell:${i}`, j);
}

/** Whether a point is inside an area's shape. The world-wide area's shape is a placeholder and is read by `areaAt`, not here. */
export function inside(a: SpawnArea, x: number, z: number): boolean {
  if (a.shape === 'rect') {
    const x2 = a.x2 ?? a.x;
    const z2 = a.z2 ?? a.z;
    return x >= Math.min(a.x, x2) && x <= Math.max(a.x, x2) && z >= Math.min(a.z, z2) && z <= Math.max(a.z, z2);
  }
  const d = Math.hypot(x - a.x, z - a.z);
  const outer = a.r ?? 0;
  const inner = a.shape === 'ring' ? (a.inner ?? 0) : 0;
  return d <= outer && d >= inner;
}

/** How much ground an area covers, square metres: what decides which of two areas holding a point is the smaller. */
export function areaSize(a: SpawnArea): number {
  if (a.shape === 'rect') return Math.abs((a.x2 ?? a.x) - a.x) * Math.abs((a.z2 ?? a.z) - a.z);
  const outer = a.r ?? 0;
  const inner = a.shape === 'ring' ? (a.inner ?? 0) : 0;
  return Math.PI * Math.max(0, outer * outer - inner * inner);
}

/**
 * The area a point's site belongs to: the smallest area holding it that has something to put down,
 * or, where no such area holds it, the world-wide area when the world has one with something to put
 * down. Null where nothing may stand at all. `hasPool` says whether an area's groups name any lair
 * this pack carries.
 */
export function areaAt(areas: readonly SpawnArea[], x: number, z: number, hasPool: (a: SpawnArea) => boolean): SpawnArea | null {
  let best: SpawnArea | null = null;
  let bestSize = Infinity;
  let world: SpawnArea | null = null;
  for (const a of areas) {
    if (a.world) {
      if (!world && hasPool(a)) world = a;
      continue;
    }
    if (!inside(a, x, z) || !hasPool(a)) continue;
    const size = areaSize(a);
    if (size < bestSize) {
      bestSize = size;
      best = a;
    }
  }
  return best ?? world;
}

/**
 * Whether the server would refuse a spawn at a point (`isSpawningPermittedAt`): inside any place
 * nothing may stand, or, for the world-wide area's spawns alone, inside a place that keeps only that
 * one out -- a town's ring, which has spawns of its own.
 */
export function refused(noSpawn: readonly SpawnArea[], x: number, z: number, forWorldArea: boolean): boolean {
  for (const n of noSpawn) {
    if (n.world && !forWorldArea) continue;
    if (inside(n, x, z)) return true;
  }
  return false;
}

/** One of a weighted list, drawn from `roll`. */
export function weighted<T extends { weight: number }>(list: readonly T[], roll: () => number): T | null {
  if (!list.length) return null;
  let total = 0;
  for (const e of list) total += Math.max(0, e.weight);
  if (total <= 0) return list[Math.min(list.length - 1, Math.floor(roll() * list.length))];
  let want = roll() * total;
  for (const e of list) {
    want -= Math.max(0, e.weight);
    if (want <= 0) return e;
  }
  return list[list.length - 1];
}

/** A building level, 1 to 5, drawn from the weights (`LAIR_TUNE.levels`). */
export function levelOf(u: number, weights: readonly number[] = LAIR_TUNE.levels): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (!(total > 0)) return 3;
  let want = u * total;
  for (let i = 0; i < weights.length; i++) {
    want -= Math.max(0, weights[i]);
    if (want < 0) return i + 1;
  }
  return weights.length;
}

/**
 * The lair's own level inside its group's band, drawn as the server drew it: anywhere from the least to
 * the most, and a most of 500 or more is the scripts' "no ceiling", which the server read as five to ten
 * past the least (`SpawnAreaImplementation::tryToSpawn`). `a` and `b` are two draws in 0 to 1.
 */
export function lairLevelOf(entry: Pick<GroupEntry, 'minDiff' | 'maxDiff'>, a: number, b: number): number {
  const lo = entry.minDiff;
  let hi = entry.maxDiff;
  if (hi >= 500) hi = 5 + lo + Math.floor(a * 6);
  const range = Math.max(1, hi - lo);
  return Math.min(hi, lo + Math.floor(b * (range + 1)));
}

/** A site laid on the grid: where it is, which lair stands there, and the seed everything else came from. */
export interface LairSite {
  key: string;
  area: string;
  lair: string;
  x: number;
  z: number;
  seed: number;
  /** The group's footprint for this lair, metres (the server's `size`): what spaces sites apart. */
  size: number;
  /** The building level, 1 to 5 (`LAIR_TUNE.levels`): what a camp's or herd's head count and a nest's health follow. */
  level: number;
  /** The lair's own level inside its group's band (`lairLevelOf`): what a nest's health adds on top. */
  lairLevel: number;
}

/** The two things `gridSites` reads of a tune: how big a cell is and how many hold a site, and the gap and the levels. */
export type GridTune = Pick<typeof LAIR_TUNE, 'cell' | 'fill' | 'gap' | 'levels'>;

/**
 * Every site of a world, laid on a jittered grid.
 *
 * Each cell of `cell` metres holds a site with the chance `fill`, at a point drawn inside the cell,
 * both from the cell's own seed. The site belongs to the smallest area holding its point (`areaAt`),
 * is refused where the server would refuse a spawn (`refused`), draws its lair from that area's
 * weighted list, and draws its building level and its own level. Last, the server's gap: a site nearer
 * another already laid than `gap` plus the larger of their footprints is dropped, in the grid's own
 * order, which every browser walks the same way.
 */
export function gridSites(world: string, areas: readonly SpawnArea[], noSpawn: readonly SpawnArea[], groups: Readonly<Record<string, GroupEntry[]>>, tune: GridTune = LAIR_TUNE, half = WORLD_HALF): LairSite[] {
  const pools = new Map<SpawnArea, GroupEntry[]>();
  let widest = 0;
  for (const a of areas) {
    const pool: GroupEntry[] = [];
    for (const g of a.groups) {
      for (const e of groups[g] ?? []) {
        pool.push(e);
        if (e.size > widest) widest = e.size;
      }
    }
    if (pool.length) pools.set(a, pool);
  }
  const out: LairSite[] = [];
  if (!pools.size || !(tune.cell > 0)) return out;
  const hasPool = (a: SpawnArea): boolean => pools.has(a);
  const cell = tune.cell;
  const lo = Math.floor(-half / cell);
  const hi = Math.ceil(half / cell) - 1;
  // The sites already kept, by cell, for the gap: how many cells out the widest gap can reach.
  const byCell = new Map<string, LairSite>();
  const reach = Math.max(1, Math.ceil((Math.max(0, tune.gap) + widest) / cell));
  for (let i = lo; i <= hi; i++) {
    for (let j = lo; j <= hi; j++) {
      const seed = cellSeed(world, i, j);
      const roll = rolls(seed);
      if (roll() >= tune.fill) continue;
      const x = (i + roll()) * cell;
      const z = (j + roll()) * cell;
      if (x < -half || x > half || z < -half || z > half) continue;
      const area = areaAt(areas, x, z, hasPool);
      if (!area) continue;
      if (refused(noSpawn, x, z, !!area.world)) continue;
      const pick = weighted(pools.get(area)!, roll);
      if (!pick) continue;
      const level = levelOf(roll(), tune.levels);
      const lairLevel = lairLevelOf(pick, roll(), roll());
      const size = Math.max(0, pick.size);
      let near = false;
      for (let di = -reach; di <= reach && !near; di++) {
        for (let dj = -reach; dj <= reach && !near; dj++) {
          const other = byCell.get(`${i + di},${j + dj}`);
          if (other && Math.hypot(other.x - x, other.z - z) < tune.gap + Math.max(size, other.size)) near = true;
        }
      }
      if (near) continue;
      const site: LairSite = { key: `${world}:${i}:${j}`, area: area.name, lair: pick.lair, x, z, seed, size, level, lairLevel };
      byCell.set(`${i},${j}`, site);
      out.push(site);
    }
  }
  return out;
}

/**
 * The share of a world within `reach` of a site: `n` by `n` points over the box, each counted when a
 * site stands within reach of it. The census and the design measured coverage this way over the
 * sixteen-kilometre square, and the node test and `__debug.wild({ coverage: true })` both run this very
 * function, so the three can be read against one another.
 */
export function coverage(sites: readonly { x: number; z: number }[], box: { x0: number; z0: number; x1: number; z1: number }, n = 60, reach: number = LAIR_TUNE.build): { share: number; points: number; near: number } {
  // Sites bucketed by `reach`, so each point looks only at the buckets next to it.
  const buckets = new Map<string, { x: number; z: number }[]>();
  const key = (bx: number, bz: number): string => `${bx},${bz}`;
  for (const s of sites) {
    const k = key(Math.floor(s.x / reach), Math.floor(s.z / reach));
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(s);
  }
  let near = 0;
  const points = n * n;
  const r2 = reach * reach;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = box.x0 + ((i + 0.5) * (box.x1 - box.x0)) / n;
      const z = box.z0 + ((j + 0.5) * (box.z1 - box.z0)) / n;
      const bx = Math.floor(x / reach);
      const bz = Math.floor(z / reach);
      let hit = false;
      for (let dx = -1; dx <= 1 && !hit; dx++) {
        for (let dz = -1; dz <= 1 && !hit; dz++) {
          for (const s of buckets.get(key(bx + dx, bz + dz)) ?? []) {
            if ((s.x - x) * (s.x - x) + (s.z - z) * (s.z - z) <= r2) {
              hit = true;
              break;
            }
          }
        }
      }
      if (hit) near++;
    }
  }
  return { share: points ? near / points : 0, points, near };
}

/** The whole world's square, in the snapshot's frame: the box `coverage` is measured over. */
export const WORLD_BOX = { x0: -WORLD_HALF, z0: -WORLD_HALF, x1: WORLD_HALF, z1: WORLD_HALF } as const;

/**
 * A site's middle moved onto ground something can walk, or null. `open` says whether a point is
 * walkable (the outdoor walk grid, in whatever frame the caller measures in); the point itself is
 * tried first, then rings of points every `step` metres out to `reach`, each ring's points in a fixed
 * order, so every browser holding the same grid moves the same site to the same place.
 */
export function nudgeSite(x: number, z: number, open: (x: number, z: number) => boolean, reach: number, step = 2): { x: number; z: number } | null {
  if (open(x, z)) return { x, z };
  if (!(step > 0)) return null;
  for (let r = step; r <= reach + 1e-9; r += step) {
    const around = Math.max(6, Math.ceil((2 * Math.PI * r) / step));
    for (let k = 0; k < around; k++) {
      const a = (k / around) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (open(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

/**
 * Whether the ground about a point is level enough for the server to have stood a spawn on it: the
 * highest and lowest of nine samples over a square `reach` metres either way differ by no more than
 * `rise` (`getHighestHeightDifference` over the same square). `ground` is the world's own height.
 */
export function flatEnough(x: number, z: number, ground: (x: number, z: number) => number, reach: number = LAIR_TUNE.flatReach, rise: number = LAIR_TUNE.flatRise): boolean {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const h = ground(x + i * reach, z + j * reach);
      if (!Number.isFinite(h)) continue;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
      if (hi - lo > rise) return false;
    }
  }
  return true;
}

/**
 * Whether a lair holds one kind of creature: a nest (the server's `LAIR`, whose `buildingType` is
 * unset), which the owner's own account says is four or five of one creature round it. A camp and a
 * herd draw each body on its own, which is the server's rule (`DynamicSpawnObserver`); a herd has no
 * nest, so the owner's rule never spoke of it.
 */
export function oneKind(def: LairDef): boolean {
  return def.building !== 'none' && def.building !== 'theater';
}

/** Whether a lair is a camp: a point of interest with its pieces and its people, which nobody can knock down. */
export function isCamp(def: LairDef): boolean {
  return def.building === 'theater';
}

/**
 * How many stand at a site when it is first come upon. A nest: the owner's own four or five. A camp or
 * a herd: the server's own rule, a third of the lair's own limit and one more at building level four
 * or five (`spawnInitialMobiles`: `spawnLimit / 3 + (difficulty - 2) / 2` in whole numbers), never
 * fewer than one.
 */
export function standingAt(def: LairDef, site: Pick<LairSite, 'seed' | 'level'>, tune = LAIR_TUNE): number {
  if (oneKind(def)) {
    const roll = rolls(site.seed ^ 0x9e3779b9);
    return tune.guards[0] + Math.floor(roll() * (tune.guards[1] - tune.guards[0] + 1));
  }
  const limit = Math.max(0, Math.trunc(def.cap));
  return Math.max(1, Math.trunc(limit / 3) + Math.trunc((site.level - 2) / 2));
}

/** How far from the middle one of them stands. */
export function spreadOf(def: LairDef, tune = LAIR_TUNE): number {
  return def.nest ? tune.guardSpread : tune.herdSpread;
}

/**
 * The health a nest has, before the difficulty knob: the server's own condition for a lair of its
 * building level, a draw up to its base with a tenth of the base for every level the lair has
 * (`spawnLair`: `random(base) + base / 10 * level`, at most 64,000), carried into this game's health by
 * the very curve every creature's own is (`CORE3_HEALTH`, a square root).
 *
 * **What that curve does to the server's proportions, said plainly**, since it is a choice and not the
 * server's: it keeps their order and square-roots their ratios. A nest the server made eighteen times
 * the creature beside it (a level-3 lair drawn at 18,000 against a pool of 1,000) is about four times
 * it here (1,103 against 283), as a boss the server made a hundred times a critter is under ten times it
 * here, because both pass through the one curve. Taken raw, that nest would be 6,000 (the curve's own
 * ceiling) against 283. At the bottom the server's own draw can put a small lair under the creatures
 * round it, and so can this.
 */
export function nestHealth(site: Pick<LairSite, 'seed' | 'level' | 'lairLevel'>): number {
  const levels = LAIR_CONDITION.levels;
  const base = levels[Math.min(levels.length, Math.max(1, Math.trunc(site.level))) - 1];
  const roll = rolls(site.seed ^ 0x3c6ef372);
  const raw = Math.min(LAIR_CONDITION.max, Math.floor(roll() * (base + 1)) + (base / 10) * Math.max(0, site.lairLevel));
  return Math.min(CORE3_HEALTH.max, Math.max(CORE3_HEALTH.min, Math.round(CORE3_HEALTH.base + CORE3_HEALTH.scale * Math.sqrt(raw))));
}

/**
 * Whether a struck lair should send more out, and how many.
 *
 * It answers 0 while it is on its cooling clock, or when the lair is already holding as many as its
 * own cap allows. The cap is the server's: it is the one number in the data that says how much of
 * one creature belongs at one nest.
 */
export function reinforcements(def: LairDef, alive: number, sinceLast: number, tune = LAIR_TUNE): number {
  if (sinceLast < tune.reinforceEvery) return 0;
  const cap = def.cap > 0 ? def.cap : tune.guards[1] * 3;
  return Math.max(0, Math.min(tune.reinforce, cap - alive));
}

/**
 * Which creature stands as a site's `index`th body. A nest holds one kind, drawn once for the whole
 * nest, with its boss (where it has one) standing first; a camp or a herd draws each body from the
 * lair's weighted list on its own, as the server did.
 */
export function creatureAt(def: LairDef, seed: number, index: number): string | null {
  const list = def.mobiles.length ? def.mobiles : def.boss;
  if (!list.length) return null;
  // The boss, where there is one, stands as the first of them and the rest are the ordinary kind.
  if (index === 0 && def.boss.length) return def.boss[0].who;
  // A nest's one kind is drawn from the seed alone; anything else draws again for every body.
  const roll = rolls(oneKind(def) ? seed ^ 0x85ebca6b : (seed ^ 0x85ebca6b ^ Math.imul(index + 1, 0x27d4eb2d)) >>> 0);
  let total = 0;
  for (const m of list) total += Math.max(1, m.n);
  let want = roll() * total;
  for (const m of list) {
    want -= Math.max(1, m.n);
    if (want <= 0) return m.who;
  }
  return list[list.length - 1].who;
}

/** Where one of a site's bodies stands, drawn round the middle, in the pack's frame. */
export function bodyAt(site: Pick<LairSite, 'x' | 'z' | 'seed'>, index: number, spread: number): { x: number; z: number; heading: number } {
  const roll = rolls(site.seed ^ (index * 0x27d4eb2d));
  const angle = roll() * Math.PI * 2;
  const d = spread * (0.35 + 0.65 * roll());
  return { x: site.x + Math.cos(angle) * d, z: site.z + Math.sin(angle) * d, heading: roll() * Math.PI * 2 };
}

/** How long a broken lair stays broken, drawn inside the band. */
export function respawnWait(seed: number, tune = LAIR_TUNE): number {
  const roll = rolls(seed ^ 0xc2b2ae35);
  return tune.respawn[0] + roll() * (tune.respawn[1] - tune.respawn[0]);
}

/**
 * Which sites should be standing now, nearest first, and which should be put away.
 *
 * `live` is what is up; the answer is what to add and what to drop. Nothing is added past the cap,
 * and a site already up is never dropped merely because a nearer one appeared -- a lair you are
 * fighting does not vanish because you walked toward another one.
 */
export function wanted(sites: readonly LairSite[], at: { x: number; z: number }, live: ReadonlySet<string>, tune = LAIR_TUNE): { add: LairSite[]; drop: string[] } {
  const near: { s: LairSite; d: number }[] = [];
  const drop: string[] = [];
  for (const s of sites) {
    const d = Math.hypot(s.x - at.x, s.z - at.z);
    if (live.has(s.key)) {
      if (d > tune.drop) drop.push(s.key);
      continue;
    }
    if (d <= tune.build) near.push({ s, d });
  }
  near.sort((p, q) => p.d - q.d);
  const room = Math.max(0, tune.liveLairs - (live.size - drop.length));
  return { add: near.slice(0, room).map((x) => x.s), drop };
}

// ------------------------------------------------------------------------------------------ camps

/** One piece of a camp as the pack carries it: its model, and its place and turn in the camp's own frame (the client data's, degrees). */
export interface CampPiece {
  model: string;
  place: readonly number[];
  angles: readonly number[];
}

/** A camp piece's model as the pack sizes it, in the model's own frame (the game's, mirrored with the model). */
export interface CampModel {
  bounds?: { min: readonly number[]; max: readonly number[] };
}

/** A piece laid out about its camp's middle in the world's frame: where its origin is, how far up, its turn, and its footprint. */
export interface PlacedPiece {
  model: string;
  /** Its origin off the camp's middle, metres. */
  x: number;
  z: number;
  /** How far above the ground it stands, as the client data places it (a pot on a crate). */
  lift: number;
  /** Its turn about the vertical, radians, as three turns an object. */
  yaw: number;
  /** The middle of its footprint off the camp's middle, and the radius that holds the whole footprint. */
  cx: number;
  cz: number;
  radius: number;
}

/**
 * A camp's pieces laid out about its middle, in the world's frame, with the camp turned by `turn`.
 *
 * The client data places each piece in the camp's own frame, which is the client's, and the world is
 * that frame mirrored in x, as every placed object is: a place `(x, y, z)` stands at `(-x, y, z)` and a
 * yaw of `a` degrees turns by `-a`, and then the whole camp turns by its own `turn`. Each footprint is
 * the model's box turned with it, held in a circle, which is what keeps a camp's people out of its
 * tents; a piece whose model the pack did not size has none.
 */
export function campLayout(pieces: readonly CampPiece[], models: Readonly<Record<string, CampModel>>, turn: number): PlacedPiece[] {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const out: PlacedPiece[] = [];
  for (const p of pieces) {
    const lx = -(p.place[0] ?? 0);
    const lz = p.place[2] ?? 0;
    // Three's turn about y: x' = x cos + z sin, z' = -x sin + z cos.
    const x = lx * c + lz * s;
    const z = -lx * s + lz * c;
    const yaw = turn - ((p.angles[0] ?? 0) * Math.PI) / 180;
    const b = models[p.model]?.bounds;
    let cx = x;
    let cz = z;
    let radius = 0;
    if (b && b.min.length >= 3 && b.max.length >= 3) {
      const mx = (b.min[0] + b.max[0]) / 2;
      const mz = (b.min[2] + b.max[2]) / 2;
      const yc = Math.cos(yaw);
      const ys = Math.sin(yaw);
      cx = x + mx * yc + mz * ys;
      cz = z - mx * ys + mz * yc;
      radius = Math.hypot(Math.abs(b.max[0] - b.min[0]), Math.abs(b.max[2] - b.min[2])) / 2;
    }
    out.push({ model: p.model, x, z, lift: p.place[1] ?? 0, yaw, cx, cz, radius });
  }
  return out;
}

/**
 * A camp's own turn about its middle: none. The server stood a camp's building at its place and never
 * turned it (`spawnTheater` sets only the position, so the building keeps its template's identity
 * turn), and no turn carried through the mirror into the world's frame is still no turn. `campLayout`
 * and `WildCamp.build` still take a turn, so this is the one line to change for a different rule.
 */
export const CAMP_TURN = 0;

/** Whether a spot off a camp's middle lies inside any of its pieces' footprints, with `margin` round each. */
export function inPieces(x: number, z: number, pieces: readonly PlacedPiece[], margin = 0.6): boolean {
  for (const p of pieces) {
    if (!(p.radius > 0)) continue;
    if (Math.hypot(x - p.cx, z - p.cz) < p.radius + margin) return true;
  }
  return false;
}

/**
 * A spot off a camp's middle moved clear of its pieces: out along the line from each footprint it lies
 * in to that footprint's edge and `margin` beyond, a few times over, since a spot pushed out of one tent
 * can land in the next. A camp's people stood inside a tent's box would be stood on its roof by the
 * ground lookup, or jammed in it.
 */
export function clearOfPieces(x: number, z: number, pieces: readonly PlacedPiece[], margin = 0.6): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const p of pieces) {
      if (!(p.radius > 0)) continue;
      const dx = px - p.cx;
      const dz = pz - p.cz;
      const d = Math.hypot(dx, dz);
      const want = p.radius + margin;
      if (d >= want) continue;
      // Straight out from the footprint's middle; a spot on the middle itself goes out along x.
      const ux = d > 1e-6 ? dx / d : 1;
      const uz = d > 1e-6 ? dz / d : 0;
      px = p.cx + ux * want;
      pz = p.cz + uz * want;
      moved = true;
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}
