// Where the wild things are: the rules for laying lairs and herds across a world's spawn areas.
//
// **What is the server's and what is ours.** The server's data gives the *shape* of each area, the
// weighted list of lairs that may stand in it, how many creatures it allows at once, and which
// animals each lair holds with their own levels, health and damage. It gives no coordinate for a
// single creature anywhere: the real server drew a point inside the shape when it felt like it, and
// a second later that point was gone. So every position here is ours, drawn from a seed, and the
// pack says so of itself (`source.creaturePlaces: 'invented'`).
//
// **Drawn from a seed, not rolled.** Every browser standing the same world must lay the same lairs
// in the same places, because one of them may be keeping a creature that another is drawing. So a
// site's place, which lair stands there and how many guard it all come out of one number made from
// the world, the area and the site's index, and nothing here ever calls `Math.random`.
//
// **What a lair is**, which is the owner's own description of the game and not something the data
// says: a nest that can be knocked down, with four or five of one creature standing round it when
// you arrive. Hitting it brings more out, it has a great deal of health, and killing it stops the
// spawning for good until it comes back on its own clock. The 608 entries the data marks as having
// nothing to stand round are the other half: a herd loose in the wilderness with no nest to break.
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
}

/**
 * Every invented number of the wild world. None of it is in the server's data: the data says what
 * may stand where, and all of this says how much of it, how near, and how hard. Live through
 * `__debug.wild`.
 */
export const LAIR_TUNE = {
  /** Metres between one site and the next. A world is not wall-to-wall nests. */
  spacing: 220,
  /** Most sites one area is ever divided into, however big it is. */
  perArea: 24,
  /** A site nearer than this to the player is stood up; one further than `drop` is put away. */
  build: 200,
  drop: 320,
  /** Most lairs and most wild bodies alive at once, whatever the areas allow. */
  liveLairs: 4,
  liveBodies: 26,
  /** How many stand at a lair when you come upon it. The owner's own count. */
  guards: [4, 5] as [number, number],
  /** How many more come out when it is struck, and the least time between one lot and the next. */
  reinforce: 2,
  reinforceEvery: 6,
  /** A lair's health, as a multiple of what one of its own creatures has. It should take a while. */
  healthOf: 8,
  /** The least and most a lair may have, so a nest of vermin is not made of paper. */
  healthRange: [900, 9000] as [number, number],
  /** How long a broken lair stays broken, in seconds. The band the server's own people respawn in. */
  respawn: [300, 600] as [number, number],
  /** A herd with no nest: how many stand together, and how far they scatter. */
  herd: [3, 6] as [number, number],
  herdSpread: 14,
  /** How far a guard stands from its own nest. */
  guardSpread: 9,
};

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

/** One number from a world, an area and an index: the seed a site is drawn from. */
export function seedOf(world: string, area: string, index: number): number {
  let h = 2166136261;
  const text = `${world}/${area}/${index}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** How wide an area is across, in metres: what decides how many sites it is divided into. */
export function areaSpan(a: SpawnArea): number {
  if (a.shape === 'rect') return Math.max(Math.abs((a.x2 ?? a.x) - a.x), Math.abs((a.z2 ?? a.z) - a.z));
  return (a.r ?? 0) * 2;
}

/** A point inside an area, drawn from `roll`. A ring keeps its hole; a rectangle is its own box. */
export function pointIn(a: SpawnArea, roll: () => number): { x: number; z: number } {
  if (a.shape === 'rect') {
    const x2 = a.x2 ?? a.x;
    const z2 = a.z2 ?? a.z;
    return { x: a.x + roll() * (x2 - a.x), z: a.z + roll() * (z2 - a.z) };
  }
  const outer = a.r ?? 0;
  const inner = a.shape === 'ring' ? (a.inner ?? 0) : 0;
  // Square-rooted so the points are spread evenly over the area rather than crowding the middle.
  const t = roll();
  const radius = Math.sqrt(inner * inner + t * (outer * outer - inner * inner));
  const angle = roll() * Math.PI * 2;
  return { x: a.x + Math.cos(angle) * radius, z: a.z + Math.sin(angle) * radius };
}

/** Whether a point is inside an area. Used to keep a site out of the places nothing may stand. */
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

/** A site laid in an area: where it is, which lair stands there, and the seed everything else came from. */
export interface LairSite {
  key: string;
  area: string;
  lair: string;
  x: number;
  z: number;
  seed: number;
}

/**
 * Every site an area is divided into.
 *
 * How many is the area's own size over `spacing`, capped: a small newbie ring gets one, a whole
 * quarter of a world gets two dozen. The server's cap is a count of *creatures* and runs to two
 * thousand in one area, so it cannot be used for this directly -- it is what stops a live area
 * filling up, not what decides how many nests a desert holds.
 */
export function lairSites(world: string, a: SpawnArea, groups: Record<string, GroupEntry[]>, tune = LAIR_TUNE): LairSite[] {
  const span = areaSpan(a);
  const n = Math.max(1, Math.min(tune.perArea, Math.round(span / tune.spacing)));
  const pool: GroupEntry[] = [];
  for (const g of a.groups) for (const e of groups[g] ?? []) pool.push(e);
  if (!pool.length) return [];
  const out: LairSite[] = [];
  for (let i = 0; i < n; i++) {
    const seed = seedOf(world, a.name, i);
    const roll = rolls(seed);
    const at = pointIn(a, roll);
    const pick = weighted(pool, roll);
    if (!pick) continue;
    out.push({ key: `${world}:${a.name}:${i}`, area: a.name, lair: pick.lair, x: at.x, z: at.z, seed });
  }
  return out;
}

/** How many stand at a site when it is first come upon: a lair's guard, or a herd. */
export function standingAt(def: LairDef, seed: number, tune = LAIR_TUNE): number {
  const roll = rolls(seed ^ 0x9e3779b9);
  const band = def.nest ? tune.guards : tune.herd;
  return band[0] + Math.floor(roll() * (band[1] - band[0] + 1));
}

/** How far from the middle one of them stands. */
export function spreadOf(def: LairDef, tune = LAIR_TUNE): number {
  return def.nest ? tune.guardSpread : tune.herdSpread;
}

/**
 * A lair's own health: a multiple of what one of its creatures has, held inside a band.
 *
 * It is a multiple rather than a number so that a nest of something dangerous is harder to break
 * than a nest of vermin, which is what makes walking up to one a decision.
 */
export function lairHealth(def: LairDef, creatures: Record<string, CreatureDef>, tune = LAIR_TUNE): number {
  let best = 0;
  for (const m of [...def.mobiles, ...def.boss]) {
    const c = creatures[m.who];
    if (c?.hp && c.hp > best) best = c.hp;
  }
  if (!best) best = 200;
  return Math.round(Math.min(tune.healthRange[1], Math.max(tune.healthRange[0], best * tune.healthOf)));
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

/** Which creature stands at a site: one of the lair's own, drawn so that a nest holds one kind. */
export function creatureAt(def: LairDef, seed: number, index: number): string | null {
  const list = def.mobiles.length ? def.mobiles : def.boss;
  if (!list.length) return null;
  // A lair holds one kind, which is the owner's own account of it; a list of several is drawn once
  // for the whole nest and not once per body.
  const roll = rolls(seed ^ 0x85ebca6b);
  let total = 0;
  for (const m of list) total += Math.max(1, m.n);
  let want = roll() * total;
  let chosen = list[0].who;
  for (const m of list) {
    want -= Math.max(1, m.n);
    if (want <= 0) {
      chosen = m.who;
      break;
    }
  }
  // The boss, where there is one, stands as the first of them and the rest are the ordinary kind.
  if (index === 0 && def.boss.length) return def.boss[0].who;
  return chosen;
}

/** Where one of a site's bodies stands, drawn round the middle. */
export function bodyAt(site: LairSite, index: number, spread: number): { x: number; z: number; heading: number } {
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
