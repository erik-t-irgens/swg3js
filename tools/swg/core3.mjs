// What the server stood in the world, read out of the owner's own emulator checkout.
//
// The client's archives say what a creature looks like, what it is called and how it moves. They do
// not say **where it lives, how many of it there are, or how hard it is** -- that was the server's,
// and the server did not ship. So the wildlife this game has stood until now has been placed by the
// planet packs' own flora and by an admin standing things from a tab, and every creature's level,
// health and damage has been a guess from its size (`stats.source: 'heuristic'` in the mobiles
// catalogue, with `level: null`).
//
// The owner keeps a checkout of the community's server emulator, whose scripts carry all of it. This
// reads that data. **It reads the data and never the code**: that project is somebody else's work
// under its own licence, so nothing here is copied from it, mirrored from it, or runs any part of it,
// and nothing derived from it is ever committed to this repository -- it goes into git-ignored
// `assets-private/` exactly as everything converted from the game's own archives does. The Lua
// subset its data is written in is read by `lua.mjs`, from the language's own grammar.
//
// **The chain, which is four files deep and worth knowing before changing anything here.** A world's
// regions name spawn groups; a spawn group names lair templates with a weight each; a lair template
// names creatures with a count each; and a creature carries its own level, health, damage and
// temperament. Every link is by name and every name resolves, which is why this can be read without
// running anything.
//
// Three things about the data are not what they look like.
//
//   - **A row's second and third numbers are the ground plane, not a height.** Regions are written
//     `x, y` where that `y` is what this game calls z. A standing person is worse: `spawnMobile` is
//     `(planet, who, respawn, x, HEIGHT, y, heading, cell)`, so the height sits *between* the two
//     ground coordinates. Read in order into (x, y, z) every person in the world ends up lying in a
//     line at head height.
//   - **The coordinates are the snapshot's, so the runtime mirrors them and the converter does not.**
//     This one was got wrong first time round and the way it was got wrong is worth keeping. The
//     numbers agree to the metre with the packs' own city list, which looked like proof that no
//     transform was needed anywhere -- but those city rows are themselves built from these very
//     files (`tools/swg/regions/`), so that check compared this data against itself and could only
//     ever come out at nought. The game's own world space is the mirror of the snapshot's
//     (`LayoutStreamer`: `gx = -(o.x - centre.x)`), so a body placed from these numbers without that
//     mirror stands on the wrong side of the world.
//
//     What settles it is a witness with nothing to do with this data at all: the ground. The people
//     who stand somewhere carry their own height, and the terrain is generated from the client's own
//     rules. Measured over the 541 who stand outdoors on three worlds, the height under them at
//     their own coordinates is right 528 times with a median error of **nought metres**, and under
//     the mirrored ones it is 16 to 53 metres out and right almost nowhere. `heightCheck` does that
//     measurement on every run and writes it into the pack, so the day this stops being true the
//     converter says so instead of the world quietly turning inside out.
//   - **The flag words are the engine's, not the scripts'**, so they are read as the words they are
//     rather than as numbers. That is better: `HERD` and `AGGRESSIVE` say what they mean, and no
//     value from a header this has never seen can be silently wrong.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { findCalls, functionBodies, readLua, readStatements, LuaCall } from './lua.mjs';

/** The shape and tier words a region file declares for itself, which it does in its own `regions.lua`. */
const REGION_CONSTS = { CIRCLE: 1, RECTANGLE: 2, RING: 3 };

/** The worlds the emulator's data covers. Its names are this converter's pack names already. */
export const CORE3_WORLDS = ['corellia', 'dantooine', 'dathomir', 'endor', 'lok', 'naboo', 'rori', 'talus', 'tatooine', 'yavin4'];

/** Every `.lua` under a folder, deepest last, with folders named in `skip` left out. */
function luaFiles(dir, skip = new Set(), out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!skip.has(e.name)) luaFiles(join(dir, e.name), skip, out);
    } else if (e.name.endsWith('.lua')) out.push(join(dir, e.name));
  }
  return out;
}

/**
 * A flag field as the set of words in it.
 *
 * The fields are sums of engine constants, so a value arrives either as one word, as a number where
 * the scripts happen to declare it, or as the `+` the reader could not fold. All three come back as
 * a list of words, and `NONE` is dropped because it is the absence of flags written down.
 */
export function flagWords(value) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') {
      if (v !== 'NONE') out.push(v);
    } else if (typeof v === 'number') {
      if (v !== 0) out.push(String(v));
    } else if (v instanceof LuaCall && v.call === '+') {
      for (const a of v.args) walk(a);
    }
  };
  walk(value);
  return out;
}

/**
 * A standing person's heading, in radians.
 *
 * **It is always degrees**, and the thing that makes that worth a function of its own is that the
 * call which places an *object* in the very same files takes radians instead. A reader that tells
 * them apart by size -- treating anything past a full turn as degrees -- is right for the great
 * majority and wrong for every person whose heading happens to be a small number: minus one, five,
 * minus three. There are 262 of those among 5,698, and each one comes out facing up to 286 degrees
 * from where it should. So the rule is the flat one, and the single call in the whole tree that
 * writes an explicit radian conversion is the only exception, which the reader folds before this
 * ever sees it.
 */
function headingRadians(deg) {
  const r = ((deg % 360) * Math.PI) / 180;
  return Math.round(r * 10000) / 10000;
}

/**
 * Every invented number of the standing people's reader. Live nowhere: the reader runs once, in the
 * converter, and what it decides is written into the packs.
 */
export const STATIC_TUNE = {
  /**
   * How far apart, in metres, two people the data puts on one spot are stood. The first keeps the
   * spot and each after it takes a place on a spiral round it, this far out times the square root
   * of its turn, so eight people on one point stand in a knot about two metres across rather than
   * inside each other -- which is what they did, each body shoving the others off its post.
   */
  stackSpread: 0.8,
  /**
   * How near, in metres across the ground, two people must stand (in the same room, within a metre up
   * or down) to count as one spot: two bodies of the player's own 0.35 m radius, nearer than which
   * they stand inside each other.
   */
  stackNear: 0.7,
  /**
   * The furthest from nought, in metres, a person's height may be and still be a place. Every person
   * the data stands anywhere is between 600 m down and 600 m up; a row past this is one the data
   * wrote wrong (a missing comma turns `85.5, -2090.7` into one number two kilometres down) and is
   * dropped and counted like any other row that will not read.
   */
  heightReach: 1000,
};

/** A value as the text it was written as: the key a row is known by, whatever its numbers come to. */
function exprText(v) {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (v instanceof LuaCall) return `${v.call}(${v.args.map(exprText).join(',')})`;
  return String(v);
}

/** A number in [0, 1) that depends on nothing but `text`: the one source of every draw below. */
export function unitOf(text) {
  return parseInt(createHash('sha1').update(text).digest('hex').slice(0, 8), 16) / 0x100000000;
}

/**
 * A value's number, with each `getRandomNumber` in it drawn by `draw(field)`.
 *
 * **The data scatters, and reading the scatter as its middle stacks people.** A camp of thirteen
 * mercenaries is written as thirteen copies of `getRandomNumber(40) + -65.7`: the server drew a place
 * in a forty-metre box for each of them every time it stood them. Folded to the middle of the box
 * every one of the thirteen stood on the same point, and 216 of the world's people stood inside
 * somebody else. So each draw is made once, here, from the row's own key -- one integer in the
 * range the server's own call would give, `1..n` for one argument and `a..b` for two -- and the
 * same key always draws the same place, so every browser stands the same thirteen in the same box.
 * Null when the value is something this cannot count (a variable, another call).
 */
function numberOf(v, draw, field) {
  if (typeof v === 'number') return v;
  if (!(v instanceof LuaCall)) return null;
  if (v.call === 'getRandomNumber' && v.args.every((a) => typeof a === 'number')) {
    const [a, b] = v.args.length >= 2 ? [v.args[0], v.args[1]] : [1, v.args[0]];
    return a + Math.floor(draw(field) * (b - a + 1));
  }
  if (['+', '-', '*', '/'].includes(v.call) && v.args.length === 2) {
    // Each side draws on its own, so `getRandomNumber(10) + getRandomNumber(10)` is two draws.
    const x = numberOf(v.args[0], draw, `${field}.a`);
    const y = numberOf(v.args[1], draw, `${field}.b`);
    if (x === null || y === null) return null;
    return v.call === '+' ? x + y : v.call === '-' ? x - y : v.call === '*' ? x * y : x / y;
  }
  return null;
}

/** Whether a value holds a draw at all, so a row can say which of its numbers are ours. */
function drawsIn(v) {
  return v instanceof LuaCall && (v.call === 'getRandomNumber' || v.args.some(drawsIn));
}

/**
 * Each world's regions: where things spawn, where they must not, and what the places are called.
 *
 * **An area is a shape and not a place, and this is the one thing about wave 3 that has to be said
 * out loud.** There is not one creature coordinate anywhere in this data: 451 areas, each a circle,
 * a ring or a rectangle with a weighted list of lairs and a cap, and the real server drew a point
 * inside the shape when it felt like it. So the wildlife cannot be "stood where the server stood
 * it" -- nobody knows where that was, including the server, a second later. What is the server's is
 * the *shape*, the *weights*, the *cap* and *which animals*; where each one stands is drawn from a
 * seed on our side, and the pack says `source: 'invented'` about exactly that, on the made-up
 * system's own precedent. The people in wave 4 are the opposite: every one of them is a real place
 * the real server used.
 *
 * A row is `{name, x, y, {shape, ...}, tier, {groups}, cap}` with the last two only on a spawn area.
 * The tier is a bitmask of words; this keeps the three that matter and reports the rest as they are.
 * A name beginning `@` is a string id, so the readable part is what follows the colon.
 */
export function readRegions(scripts) {
  const dir = join(scripts, 'managers', 'planet');
  const out = new Map();
  for (const world of CORE3_WORLDS) {
    const file = join(dir, `${world}_regions.lua`);
    if (!existsSync(file)) continue;
    const { values } = readLua(readFileSync(file, 'utf8'), REGION_CONSTS);
    const rows = values.get(`${world}_regions`);
    if (!Array.isArray(rows)) continue;
    const spawn = [];
    const noSpawn = [];
    const named = [];
    for (const r of rows) {
      if (!Array.isArray(r) || typeof r[0] !== 'string' || typeof r[1] !== 'number' || typeof r[2] !== 'number') continue;
      const shape = shapeOf(r[1], r[2], r[3]);
      if (!shape) continue;
      const tier = flagWords(r[4]);
      const label = r[0].startsWith('@') ? (r[0].split(':')[1] ?? r[0]) : r[0];
      const row = { name: label, ...shape };
      if (tier.includes('NAMEDREGION')) named.push(row);
      // A place that keeps out only the world-wide spawner (`NOWORLDSPAWNAREA`, the rings round every
      // town that have spawns of their own) is marked `world`, so it is not taken for a place where
      // nothing at all may stand; one that keeps out everything is written as it always was.
      if (tier.includes('NOSPAWNAREA')) noSpawn.push(row);
      else if (tier.includes('NOWORLDSPAWNAREA')) noSpawn.push({ ...row, world: true });
      if (tier.includes('SPAWNAREA') && Array.isArray(r[5])) {
        const groups = r[5].filter((g) => typeof g === 'string');
        // The world-wide area, one a world, is its fallback: `world` says which it is.
        if (groups.length) spawn.push({ ...row, groups, cap: typeof r[6] === 'number' ? r[6] : 0, ...(tier.includes('WORLDSPAWNAREA') ? { world: true } : {}) });
      }
    }
    out.set(world, { spawn, noSpawn, named });
  }
  return out;
}

/**
 * Each world's travel points as the server listed them (`managers/planet/planet_manager.lua`, a
 * `planetTravelPoints` table under each world's own): the name its terminals showed, where on the
 * ground it stands (the spot its shuttle lands, about 20 m from the port building's origin), its
 * height, and whether a shuttle leaves the world from it (`starport`) and lands there from another
 * (`incoming`). The names are the game's own -- `Theed Shuttle A`, `Keren Shuttleport South`,
 * `Mos Espa Shuttleport East` -- and are what tells a town's shuttleports apart where the client's
 * archives call them all the same thing. A row's `x, z, y` are ground, height, ground, as everywhere
 * in these scripts, and the ground plane is the snapshot's own frame.
 */
export function readTravelPoints(scripts) {
  const file = join(scripts, 'managers', 'planet', 'planet_manager.lua');
  const out = new Map();
  if (!existsSync(file)) return out;
  const { values } = readLua(readFileSync(file, 'utf8'));
  for (const [world, v] of values) {
    const rows = v && typeof v === 'object' && !Array.isArray(v) ? v.planetTravelPoints : null;
    if (!Array.isArray(rows)) continue;
    const points = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object' || typeof r.name !== 'string' || typeof r.x !== 'number' || typeof r.y !== 'number') continue;
      points.push({ name: r.name, x: r.x, y: typeof r.z === 'number' ? r.z : 0, z: r.y, starport: r.interplanetaryTravelAllowed === 1, incoming: r.incomingTravelAllowed === 1 });
    }
    out.set(world, points);
  }
  return out;
}

/** One region's shape, in this game's own frame: x and z metres, with the size the shape needs. */
function shapeOf(x, y, size) {
  if (!Array.isArray(size) || typeof size[0] !== 'number') return null;
  // The second and third numbers of a row are the ground plane. The emulator calls them x and y.
  if (size[0] === REGION_CONSTS.CIRCLE && typeof size[1] === 'number') return { shape: 'circle', x, z: y, r: size[1] };
  if (size[0] === REGION_CONSTS.RING && typeof size[1] === 'number' && typeof size[2] === 'number') return { shape: 'ring', x, z: y, r: size[2], inner: size[1] };
  if (size[0] === REGION_CONSTS.RECTANGLE && typeof size[1] === 'number' && typeof size[2] === 'number') {
    // A rectangle's own x and y are its near corner and the size holds the far one.
    return { shape: 'rect', x: Math.min(x, size[1]), z: Math.min(y, size[2]), x2: Math.max(x, size[1]), z2: Math.max(y, size[2]) };
  }
  return null;
}

/**
 * Every spawn group: the lairs it can put down, each with a weight, a count and a footprint.
 *
 * A group is one file whose only content is one table. `spawnLimit` of -1 is "as many as the area
 * allows", which is the area's own cap; a difficulty range is the band of lair build-ups the group
 * will use.
 */
export function readSpawnGroups(scripts) {
  const out = new Map();
  for (const file of luaFiles(join(scripts, 'mobile', 'spawn'))) {
    const src = readFileSync(file, 'utf8');
    const { values } = readLua(src);
    for (const [name, v] of values) {
      const list = v && typeof v === 'object' && Array.isArray(v.lairSpawns) ? v.lairSpawns : null;
      if (!list) continue;
      const lairs = [];
      for (const s of list) {
        if (!s || typeof s !== 'object' || typeof s.lairTemplateName !== 'string') continue;
        lairs.push({
          lair: s.lairTemplateName,
          weight: typeof s.weighting === 'number' ? s.weighting : 1,
          count: typeof s.numberToSpawn === 'number' ? s.numberToSpawn : 0,
          size: typeof s.size === 'number' ? s.size : 0,
          limit: typeof s.spawnLimit === 'number' ? s.spawnLimit : -1,
          minDiff: typeof s.minDifficulty === 'number' ? s.minDifficulty : 1,
          maxDiff: typeof s.maxDifficulty === 'number' ? s.maxDifficulty : 1,
        });
      }
      if (lairs.length) out.set(name, lairs);
    }
  }
  return out;
}

/**
 * Every lair template: which creatures stand at it and how many of each.
 *
 * `mobiles` is a list of `{who, howMany}` pairs. The five `buildings*` lists are the nest object at
 * each difficulty, and they are almost always the same one; the nest is kept because a lair is a
 * thing in the world and not only a spawn point. The four folders these come in separate a nest with
 * creatures round it from a wandering herd with no nest at all, from a camp of people, from a stage
 * set; the folder is kept as `kind` so the runtime can tell a herd from a camp.
 */
export function readLairs(scripts) {
  const root = join(scripts, 'mobile', 'lair');
  const out = new Map();
  for (const file of luaFiles(root, new Set(['unused']))) {
    const rel = file.slice(root.length + 1).split(/[\\/]/);
    const kind = rel.length > 1 ? rel[0] : '';
    const { values } = readLua(readFileSync(file, 'utf8'));
    for (const [name, v] of values) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      if (!Array.isArray(v.mobiles)) continue;
      const mobiles = [];
      for (const m of v.mobiles) {
        if (Array.isArray(m) && typeof m[0] === 'string') mobiles.push({ who: m[0], n: typeof m[1] === 'number' ? m[1] : 1 });
      }
      if (!mobiles.length) continue;
      const nest = ['buildingsEasy', 'buildingsMedium', 'buildingsVeryEasy', 'buildingsHard', 'buildingsVeryHard']
        .map((k) => (Array.isArray(v[k]) ? v[k].find((s) => typeof s === 'string') : null))
        .find(Boolean) ?? null;
      // A boss stands with the others at one in fourteen lairs and is the reason to walk up to one.
      const boss = [];
      if (Array.isArray(v.bossMobiles)) {
        for (const m of v.bossMobiles) if (Array.isArray(m) && typeof m[0] === 'string') boss.push({ who: m[0], n: typeof m[1] === 'number' ? m[1] : 1 });
      }
      out.set(name, {
        kind,
        mobiles,
        boss,
        cap: typeof v.spawnLimit === 'number' ? v.spawnLimit : 0,
        nest,
        // The two words a lair says about itself. `buildingType` "none" is a herd with nothing to
        // stand round and "theater" is a camp with a real building; unset means an ordinary nest.
        // `mobType` "npc" means the things at it are people, and unset means they are animals.
        building: typeof v.buildingType === 'string' ? v.buildingType : '',
        people: v.mobType === 'npc',
        mission: v.missionBuilding ?? null,
      });
    }
  }
  return out;
}

/**
 * Every creature the server could stand, with the numbers this game has been guessing at.
 *
 * `level` is the one that matters most: our own catalogue carries none at all and works every
 * creature's health and damage out from how big its model is. Here they are declared, 1 to 336 with
 * a median of 20, along with health, a damage band, what it eats, whether it herds or packs and
 * whether it attacks on sight.
 */
export function readCreatures(scripts) {
  const root = join(scripts, 'mobile');
  const skip = new Set(['lair', 'spawn', 'conversations', 'dressgroup', 'outfits']);
  const out = new Map();
  for (const file of luaFiles(root, skip)) {
    let read;
    try {
      read = readLua(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const [name, v] of read.values) {
      if (!v || typeof v !== 'object' || v.__class !== 'Creature') continue;
      const templates = Array.isArray(v.templates) ? v.templates.filter((t) => typeof t === 'string') : [];
      const template = templates[0] ?? null;
      if (!template) continue;
      // The weapon groups it fights with, first and second: names of lists of weapon templates
      // (`readWeaponGroups`). "none" is the absence of one written down.
      const weapons = [v.primaryWeapon, v.secondaryWeapon].filter((w, i, a) => typeof w === 'string' && w && w !== 'none' && a.indexOf(w) === i);
      const kinds = flagWords(v.creatureBitmask);
      const pvp = flagWords(v.pvpBitmask);
      const mob = flagWords(v.mobType)[0] ?? '';
      out.set(name, {
        who: name,
        template,
        level: typeof v.level === 'number' ? v.level : null,
        hp: typeof v.baseHAM === 'number' ? v.baseHAM : null,
        hpMax: typeof v.baseHAMmax === 'number' ? v.baseHAMmax : null,
        damage: [typeof v.damageMin === 'number' ? v.damageMin : 0, typeof v.damageMax === 'number' ? v.damageMax : 0],
        armour: typeof v.armor === 'number' ? v.armor : 0,
        xp: typeof v.baseXp === 'number' ? v.baseXp : 0,
        mob,
        diet: flagWords(v.diet)[0] ?? '',
        // What it does when it meets you, and how it stands with its own kind.
        aggressive: pvp.includes('AGGRESSIVE'),
        attackable: pvp.includes('ATTACKABLE') || pvp.includes('ENEMY') || pvp.includes('AGGRESSIVE'),
        herd: kinds.includes('HERD'),
        pack: kinds.includes('PACK'),
        stalker: kinds.includes('STALKER'),
        killer: kinds.includes('KILLER'),
        social: typeof v.socialGroup === 'string' ? v.socialGroup : '',
        faction: typeof v.faction === 'string' ? v.faction : '',
        tame: typeof v.tamingChance === 'number' ? v.tamingChance : 0,
        ferocity: typeof v.ferocity === 'number' ? v.ferocity : 0,
        hues: Array.isArray(v.hues) ? v.hues.filter((h) => typeof h === 'number') : [],
        weapon: typeof v.primaryWeapon === 'string' ? v.primaryWeapon : '',
        weapons,
        // Every body the server could stand it as, drawn at each spawn: a list of templates, or a
        // dress group's name (`readDressGroups`), which is itself a list. `template` is the first.
        templates,
        file: basename(file, '.lua'),
      });
    }
  }
  return out;
}

/**
 * The people who stand somewhere and stay there: the whole screenplay tree, not one folder of it.
 *
 * Reading only the folder named for static spawns finds 830 of them. Reading all of it finds several
 * thousand, because most of the world's standing people are in the caves, the points of interest and
 * the towns rather than in the folder named after them, and **half of them are inside a building
 * cell** -- the people in a cantina, a cave or a dungeon, who are the whole of what makes a place feel
 * lived in.
 *
 * They are written in more shapes than one and every shape is read (`staticsOfFile` says which). The
 * height is always the second of the three coordinates, never the last. A file that names its world
 * once and writes `self.planet` in every call has that read off its own table.
 *
 * A call standing inside a conditional is taken anyway and marked, because the condition is quest
 * state this game does not have: somebody who would be there under some circumstance is better
 * standing there than missing. A row whose coordinates are an expression the reader cannot count is
 * dropped and counted rather than guessed at. The scatter the data writes as a random number added
 * to a base is drawn once, from the row's own key (`settleStatics`), and so is the knot the data ties
 * when it stands several people on one point.
 *
 * Returns `{ statics, dropped, pools, skipped }`: the rows per world, how many were dropped per world
 * (`?` for none), the named lists a row's body is drawn from per world, and how many statements of
 * the scripts the Lua reader stepped over.
 */
export function readStatics(scripts) {
  const root = join(scripts, 'screenplays');
  const raw = new Map();
  const pools = new Map();
  const dropped = new Map();
  let skipped = 0;
  for (const file of luaFiles(root)) {
    // Which part of the world's life this file is: a cave, a point of interest, a town, a dungeon.
    // The folder is the only thing that says so, and it is worth keeping -- a person in a cave and a
    // person in a town are the same row and not the same thing.
    const where = file.slice(root.length + 1).split(/[\\/]/)[0];
    const got = staticsOfFile(readFileSync(file, 'utf8'), where);
    skipped += got.skipped;
    // Which file each row came out of, for telling one person the data writes twice from two people
    // it writes on one spot (`untie`). Never written into a row.
    const source = file.slice(root.length + 1).replace(/\\/g, '/');
    for (const r of got.rows) {
      if (!CORE3_WORLDS.includes(r.world)) {
        if (!r.world) dropped.set('?', (dropped.get('?') ?? 0) + 1);
        continue;
      }
      if (!raw.has(r.world)) raw.set(r.world, []);
      raw.get(r.world).push({ ...r, source });
    }
    for (const [world, n] of got.dropped) dropped.set(world || '?', (dropped.get(world || '?') ?? 0) + n);
    for (const [world, key, names] of got.pools) {
      if (!CORE3_WORLDS.includes(world)) continue;
      if (!pools.has(world)) pools.set(world, new Map());
      pools.get(world).set(key, names);
    }
  }
  const statics = new Map();
  for (const world of CORE3_WORLDS) {
    const rows = raw.get(world);
    if (!rows) continue;
    const settled = settleStatics(world, rows);
    statics.set(world, settled.rows);
    if (settled.dropped) dropped.set(world, (dropped.get(world) ?? 0) + settled.dropped);
  }
  return { statics, dropped, pools, skipped };
}

/** A table read from a file, as against an array, a marker or a word. */
const isTable = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof LuaCall);
/** A string the data wrote that says something (the scripts write `""` for "none"). */
const said = (v) => (typeof v === 'string' && v ? v : undefined);
/** A read out of a table (`mob[3]`), by any key, and by a number: the loop over a table of rows. */
const isAnyRead = (v) => v instanceof LuaCall && v.call === '[]';
const isRead = (v) => isAnyRead(v) && typeof v.args[1] === 'number';

/**
 * Every standing person one screenplay file writes, raw: numbers still as the data wrote them, each
 * row with the world it stands on. Pure, so a node test can hand it a file written by hand.
 *
 * The shapes, each measured over the whole tree:
 *
 *   - `spawnMobile(world, who, respawn, x, height, y, heading, cell)`, a call per person, anywhere in
 *     the file (`from: 'call'`);
 *   - a screenplay's `mobiles`, one row per person in the call's own order with the mood after it
 *     (`mobiles`): the points of interest, and every town's named people;
 *   - a town's `stationaryMobiles`, `{respawn, x, height, y, heading, cell, mood}` with no body at
 *     all: the server drew one each time, four in five from the town's `stationaryCommoners` and one
 *     in five from its `stationaryNpcs`, so the row names both lists (`draw`, `pools`);
 *   - a town's `patrolMobiles`, `{points, who, x, height, y, heading, cell, mood, combat}`, walking
 *     the named list of `patrolPoints` (`{x, height, y, cell, linger}`), the body drawn from
 *     `patrolNpcs` or `combatPatrol` where the row names one of those instead of a body;
 *   - a town's `gcwMobs`, `{imperial, rebel, x, height, y, heading, cell, imperialMood, rebelMood,
 *     scanner}`, the guards, a body for each side (`gcw`), or with one body and one mood where the
 *     row is shorter than nine;
 *   - an event's `staticNpcs`, `{who, world, x, height, y, heading, cell}`;
 *   - the Death Watch bunker's three tables: its static spawns, its quest people (who carry their own
 *     world last) and the special spawns its events put in their rooms (`gated`);
 *   - and anywhere, a table naming an `npcTemplate` with `x`, `z` and `y` -- a theme park's or a
 *     task's `spawnData`, a ticket taker's own row -- whose `z` is its height, its world its own
 *     `planetName` or the file's; never one placed in a mission building's room (`vectorCellID`).
 *
 * **Respawns are the server's own seconds, and nought is never.** The server brings a body back only
 * when its timer is above nought (a town's guards and combat patrols are brought back by their town's
 * own five-minute event, and are written with it); a row written with nought -- a bunker's boss, an
 * event's visitor, a trainer -- was stood once and stayed down once killed.
 *
 * A town's rows are the server's static ones (`still`): it stood every one of them with its brain
 * switched off. The stationary and non-combat patrol rows it also made unattackable whatever body it
 * drew (`peaceful`).
 */
export function staticsOfFile(src, where) {
  const rows = [];
  const pools = [];
  const dropped = new Map();
  const drop = (world) => dropped.set(world || '', (dropped.get(world || '') ?? 0) + 1);
  const { values, skipped } = readLua(src);
  // A file that names its world once: a screenplay's `planet`, a theme park's `planetName`.
  let own = '';
  for (const [, v] of values) {
    if (!isTable(v)) continue;
    const p = said(v.planet) ?? said(v.planetName);
    if (p) {
      own = p;
      break;
    }
  }
  const town = where === 'cities';

  // The per-person form: (planet, who, respawn, x, height, y, heading, cell). A call that reads its
  // place out of a table (`mob[3]`) is the loop that stands the file's own `mobiles`, not a person: it
  // is not a row, but the first one says which element of that table's rows is which (`layout`).
  let layout = null;
  if (src.includes('spawnMobile')) {
    for (const c of findCalls(src, ['spawnMobile'])) {
      const a = c.args;
      if ([a[1], a[3], a[4], a[5]].some(isAnyRead)) {
        if (!layout && [a[3], a[4], a[5]].every(isRead)) layout = a.map((v) => (isRead(v) ? { index: v.args[1] - 1 } : typeof v === 'number' || (v instanceof LuaCall && !isAnyRead(v)) ? { value: v } : null));
        continue;
      }
      const world = typeof a[0] === 'string' && CORE3_WORLDS.includes(a[0]) ? a[0] : own;
      if (!world || typeof a[1] !== 'string') {
        drop(world);
        continue;
      }
      rows.push({ world, who: a[1], respawn: a[2], x: a[3], y: a[4], z: a[5], heading: a[6], cell: a[7] ?? 0, gated: c.gated, where, from: 'call' });
    }
  }
  // One element of a `mobiles` row by the call's own argument position: where the loop's call reads
  // it from the row, what it writes there instead, and otherwise the common layout's own place
  // (`{who, respawn, x, height, y, heading, cell, mood}`, which is also what a file with no such call
  // is read as). Most files write exactly that; a few leave the respawn or the facing out of the row
  // and write it in the call, and read in the common layout their people stood kilometres up.
  const element = (r, arg, common, otherwise) => {
    if (!layout) return r[common];
    const l = layout[arg];
    if (l && 'index' in l) return r[l.index];
    if (l && 'value' in l) return l.value;
    // A variable the call names that this cannot follow: the body is still the row's first word.
    return arg === 1 ? r[common] : otherwise;
  };
  const common = !layout || [1, 2, 3, 4, 5, 6, 7].every((arg) => layout[arg] && 'index' in layout[arg] && layout[arg].index === arg - 1);

  for (const [name, v] of values) {
    if (isTable(v)) {
      const world = said(v.planet) ?? own;
      if (Array.isArray(v.mobiles)) {
        for (const r of v.mobiles) {
          if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
          const rowWorld = layout?.[0] && 'index' in layout[0] ? said(r[layout[0].index]) ?? world : world;
          const who = element(r, 1, 0);
          if (typeof who !== 'string') continue;
          rows.push({ world: rowWorld, who, respawn: element(r, 2, 1, 0), x: element(r, 3, 2), y: element(r, 4, 3), z: element(r, 5, 4), heading: element(r, 6, 5, 0), cell: element(r, 7, 6, 0) ?? 0, mood: common ? said(r[7]) : undefined, still: town || undefined, gated: false, where, from: 'mobiles' });
        }
      }
      if (Array.isArray(v.stationaryMobiles) && v.stationaryMobiles.length) {
        const commoners = `${name}.stationaryCommoners`;
        const npcs = `${name}.stationaryNpcs`;
        pools.push([world, commoners, names(v.stationaryCommoners)], [world, npcs, names(v.stationaryNpcs)]);
        for (const r of v.stationaryMobiles) {
          if (!Array.isArray(r)) continue;
          rows.push({ world, who: null, respawn: r[0], x: r[1], y: r[2], z: r[3], heading: r[4], cell: r[5] ?? 0, mood: said(r[6]), still: true, peaceful: true, draw: [[commoners, 0.8], [npcs, 0.2]], gated: false, where, from: 'stationary' });
        }
      }
      if (Array.isArray(v.patrolMobiles) && v.patrolMobiles.length) {
        const walkers = `${name}.patrolNpcs`;
        const fighters = `${name}.combatPatrol`;
        pools.push([world, walkers, names(v.patrolNpcs)], [world, fighters, names(v.combatPatrol)]);
        const points = isTable(v.patrolPoints) ? v.patrolPoints : {};
        for (const r of v.patrolMobiles) {
          if (!Array.isArray(r) || typeof r[1] !== 'string') continue;
          const combat = r[8] === true;
          const drawn = r[1] === 'patrolNpc' ? walkers : r[1] === 'combatPatrol' ? fighters : null;
          const route = Array.isArray(points[r[0]]) ? points[r[0]].filter(Array.isArray).map((p) => ({ x: p[0], y: p[1], z: p[2], cell: p[3] ?? 0, linger: p[4] === true })) : [];
          rows.push({ world, who: drawn ? null : r[1], respawn: combat ? 300 : 0, x: r[2], y: r[3], z: r[4], heading: r[5], cell: r[6] ?? 0, mood: said(r[7]), peaceful: combat ? undefined : true, draw: drawn ? [[drawn, 1]] : undefined, route, gated: false, where, from: 'patrol' });
        }
      }
      if (Array.isArray(v.gcwMobs)) {
        for (const r of v.gcwMobs) {
          if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
          // Shorter than nine is one body for either side; the server's own test.
          if (r.length < 9) {
            rows.push({ world, who: r[0], respawn: 300, x: r[1], y: r[2], z: r[3], heading: r[4], cell: r[5] ?? 0, mood: said(r[6]), still: true, gated: false, where, from: 'gcw' });
          } else if (typeof r[1] === 'string') {
            const gcw = [{ who: r[0], ...(said(r[7]) ? { mood: r[7] } : {}) }, { who: r[1], ...(said(r[8]) ? { mood: r[8] } : {}) }];
            rows.push({ world, who: r[0], respawn: 300, x: r[2], y: r[3], z: r[4], heading: r[5], cell: r[6] ?? 0, mood: said(r[7]), still: true, gcw, gated: false, where, from: 'gcw' });
          }
        }
      }
      if (Array.isArray(v.staticNpcs)) {
        for (const r of v.staticNpcs) {
          if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
          rows.push({ world: said(r[1]) ?? world, who: r[0], respawn: 0, x: r[2], y: r[3], z: r[4], heading: r[5], cell: r[6] ?? 0, gated: false, where, from: 'event' });
        }
      }
    }
  }

  // The Death Watch bunker keeps its people in tables of their own, with its world written only on
  // the quest people: the bunker's is the world of the one of them standing in one of its rooms.
  const quest = values.get('deathWatchQuestNpcs');
  const bunker = (Array.isArray(quest) ? quest.find((r) => Array.isArray(r) && typeof r[6] === 'number' && r[6] && said(r[7])) : null)?.[7] ?? own;
  const bunkerRow = (r, from, gated) => ({ world: from === 'quest' ? said(r[7]) ?? bunker : bunker, who: r[0], respawn: r[1], x: r[2], y: r[3], z: r[4], heading: r[5], cell: r[6] ?? 0, gated, where, from });
  for (const r of values.get('deathWatchStaticSpawns') ?? []) if (Array.isArray(r) && typeof r[0] === 'string') rows.push(bunkerRow(r, 'static', false));
  for (const r of Array.isArray(quest) ? quest : []) if (Array.isArray(r) && typeof r[0] === 'string') rows.push(bunkerRow(r, 'quest', false));
  const special = values.get('deathWatchSpecialSpawns');
  if (isTable(special)) for (const r of Object.values(special)) if (Array.isArray(r) && typeof r[0] === 'string') rows.push(bunkerRow(r, 'special', true));

  // Anywhere else: a table naming an npcTemplate and a place. The server stood every such person with a
  // respawn of one second, whichever script stood them (a theme park's, a task's, a ticket taker's).
  //
  // **Not one whose room is a `vectorCellID`.** That is a person inside a building the server puts
  // down somewhere new each time a mission sends somebody after it (a destructible den, a surveyor's
  // camp): the place is in that building's room, and the building stands nowhere at all until the
  // mission is taken. Read as a person standing still, each stood outdoors at the middle of its world.
  const seen = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object' || v instanceof LuaCall || seen.has(v)) return;
    seen.add(v);
    if (isTable(v) && typeof v.npcTemplate === 'string' && v.x !== undefined && v.y !== undefined && v.z !== undefined) {
      if (v.vectorCellID !== undefined) return;
      rows.push({ world: said(v.planetName) ?? own, who: v.npcTemplate, respawn: 1, x: v.x, y: v.z, z: v.y, heading: v.direction ?? 0, cell: v.cellID ?? 0, mood: said(v.mood), sit: v.position === 'SIT' || undefined, gated: false, where, from: 'giver' });
      return;
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x);
  };
  for (const [, v] of values) walk(v);

  return { rows, pools, dropped, skipped };
}

/** The names in a list the scripts wrote, strings only. */
function names(list) {
  return Array.isArray(list) ? list.filter((s) => typeof s === 'string' && s) : [];
}

/** The golden angle: consecutive turns of a spiral that never line up with one another. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * One world's raw rows made into the rows a pack carries: each given its key, its numbers counted
 * (a scatter drawn from the key), its heading in radians, and the knots untied.
 *
 * **The key is who, where and which room, as written, and nothing else**: a hash of the row's body
 * (or the table it draws from), its three coordinates as the data wrote them -- the scatter as its
 * expression, not as a draw -- and its cell, with a count for rows written exactly alike. So a row
 * keeps its key and its draw whatever order the files are read in or rows are added round it, and a
 * body stood from it is known by the same id in every browser and every run.
 *
 * **The knots**: people the data puts within `STATIC_TUNE.stackNear` of one another in one room are
 * one spot. The first in the file keeps it and each after takes a place on a spiral round it
 * (`nudged`), turned by the first one's own key, so a knot comes out the same every time.
 *
 * **One person written twice is not a knot.** A town's table and a quest's own row can both stand the
 * same named person on the same spot, and nudged apart that is two of one person, one a pace off the
 * other. So the same body on one spot in one room is dropped (and counted in `dropped`) when the two
 * rows come out of different files or different tables of one file; the same body written several
 * times in one table -- a camp of thirteen hired guns -- is that many people, and is untied.
 */
export function settleStatics(world, raw) {
  const seen = new Map();
  const rows = [];
  const origin = new Map();
  let dropped = 0;
  for (const r of raw) {
    const base = [world, r.who ?? r.from, exprText(r.x), exprText(r.y), exprText(r.z), exprText(r.cell ?? 0)].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const key = createHash('sha1').update(`${base}#${n}`).digest('hex').slice(0, 12);
    const draw = (field) => unitOf(`${key}:${field}`);
    const respawn = numberOf(r.respawn, draw, 'respawn');
    const x = numberOf(r.x, draw, 'x');
    const y = numberOf(r.y, draw, 'y');
    const z = numberOf(r.z, draw, 'z');
    const heading = numberOf(r.heading, draw, 'heading');
    const cell = numberOf(r.cell ?? 0, draw, 'cell');
    if ([respawn, x, y, z, heading].some((v) => v === null) || Math.abs(y) > STATIC_TUNE.heightReach) {
      dropped++;
      continue;
    }
    const drawn = [r.respawn, r.x, r.y, r.z, r.heading].some(drawsIn);
    const row = { key, who: r.who, x, y, z, heading: headingRadians(heading), cell: cell || 0, respawn, gated: !!r.gated, where: r.where, from: r.from };
    if (r.mood) row.mood = r.mood;
    if (r.still) row.still = true;
    if (r.peaceful) row.peaceful = true;
    if (r.sit) row.sit = true;
    if (r.draw) row.draw = r.draw;
    if (r.gcw) row.gcw = r.gcw;
    if (r.route?.length) {
      const route = [];
      r.route.forEach((p, i) => {
        const at = [numberOf(p.x, draw, `route${i}.x`), numberOf(p.y, draw, `route${i}.y`), numberOf(p.z, draw, `route${i}.z`), numberOf(p.cell, draw, `route${i}.cell`)];
        if (at.every((v) => v !== null)) route.push({ x: at[0], y: at[1], z: at[2], cell: at[3] || 0, linger: p.linger });
      });
      if (route.length) row.route = route;
    }
    if (drawn) row.drawn = true;
    rows.push(row);
    origin.set(row, `${r.source ?? ''}|${r.from ?? ''}`);
  }
  const untied = untie(rows, origin);
  return { rows: untied.rows, dropped: dropped + untied.twice };
}

/**
 * Stand people the data put on one spot apart from one another, and drop one person the data wrote
 * twice (see `settleStatics`). `origin` says which file and table each row came out of.
 */
function untie(rows, origin) {
  const anchors = [];
  const counts = new Map();
  const kept = [];
  let twice = 0;
  for (const r of rows) {
    const a = anchors.find((s) => s.cell === r.cell && Math.hypot(s.x - r.x, s.z - r.z) < STATIC_TUNE.stackNear && Math.abs(s.y - r.y) < 1);
    if (!a) {
      anchors.push(r);
      kept.push(r);
      continue;
    }
    if (a.who && a.who === r.who && origin.get(a) !== origin.get(r)) {
      twice++;
      continue;
    }
    const k = (counts.get(a) ?? 0) + 1;
    counts.set(a, k);
    const turn = unitOf(`${a.key}:stack`) * Math.PI * 2 + k * GOLDEN;
    const out = STATIC_TUNE.stackSpread * Math.sqrt(k);
    r.x = Math.round((a.x + out * Math.sin(turn)) * 1000) / 1000;
    r.z = Math.round((a.z + out * Math.cos(turn)) * 1000) / 1000;
    r.nudged = true;
    kept.push(r);
  }
  return { rows: kept, twice };
}

/**
 * The dress groups: a name standing for a list of bodies, one of which the server drew each time it
 * stood a creature whose template is that name (a commoner, a thug, a noble, a town's police). Each
 * file declares a list and registers it under a name with `addDressGroup`, which is read as the
 * registration says rather than by the variable's own name.
 */
export function readDressGroups(scripts) {
  return registeredLists(join(scripts, 'mobile', 'dressgroup'), 'addDressGroup');
}

/**
 * The weapon groups: a name standing for the weapon templates a creature naming it may carry, one of
 * which the server gave it (a Tusken's `primitive_weapons` is a stone knife and two wooden staffs).
 * Registered with `addWeapon`, read the same way as the dress groups.
 */
export function readWeaponGroups(scripts) {
  return registeredLists(join(scripts, 'mobile', 'weapon', 'groups'), 'addWeapon');
}

/** Every `register("name", list)` over a folder's files, as name to the list's strings, sorted by name. */
function registeredLists(dir, register) {
  const out = new Map();
  for (const file of luaFiles(dir)) {
    const { values, calls } = readLua(readFileSync(file, 'utf8'));
    for (const c of calls) {
      if (c.call !== register || typeof c.args[0] !== 'string') continue;
      const list = typeof c.args[1] === 'string' ? values.get(c.args[1]) : c.args[1];
      if (Array.isArray(list)) out.set(c.args[0], list.filter((s) => typeof s === 'string'));
    }
  }
  return new Map([...out].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

/**
 * The Corellian corvette's crews and fittings, by room **name** rather than by cell id: the ship is a
 * building the server stood a copy of per group, so its rows name the room (`hall10`, `bridge66`)
 * and whichever copy is used says where that room is. Three crews, one per faction's run, and the
 * objects every copy stands (terminals, keypads, crates). Kept for the corvette's own wave; the rows
 * are `{ who, x, y, z, heading, room, name? }` with the height second as everywhere, and the fittings
 * `{ template, x, y, z, heading, room, name?, fn?, data?, faction? }`.
 *
 * And the three who take a ticket for it (`takers`, `{ who, planet, faction }`): which copy a player is
 * sent to was the taker's faction, Imperial at the Emperor's Retreat, the Alliance's at its base and
 * nobody's at Jabba's palace, and that is a fact of each taker's own file (`ticket_takers/*.lua`) and
 * of nothing the client holds. Each file is two assignments the Lua reader steps over as calls, so the
 * three names are read off the text as the words they are; the takers themselves stand as ordinary
 * rows of `readStatics`.
 */
export function readCorvette(scripts) {
  const dir = join(scripts, 'screenplays', 'dungeon', 'corellian_corvette');
  const file = join(dir, 'corvetteSpawnMaps.lua');
  const out = { rebel: [], imperial: [], neutral: [], statics: [], takers: [] };
  const takers = join(dir, 'ticket_takers');
  if (existsSync(takers)) {
    for (const f of readdirSync(takers).filter((n) => n.endsWith('.lua')).sort()) {
      const text = readFileSync(join(takers, f), 'utf8');
      const who = /npcTemplate\s*=\s*"([^"]+)"/.exec(text)?.[1];
      const planet = /planetName\s*=\s*"([^"]+)"/.exec(text)?.[1];
      const word = /\bfaction\s*=\s*(FACTION\w+|\d+)/.exec(text)?.[1];
      if (!who || !planet || word === undefined) continue;
      out.takers.push({ who, planet, faction: word === 'FACTIONIMPERIAL' ? 'imperial' : word === 'FACTIONREBEL' ? 'rebel' : 'neutral' });
    }
  }
  if (!existsSync(file)) return out;
  const { values } = readLua(readFileSync(file, 'utf8'));
  const crew = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((r) => Array.isArray(r) && typeof r[0] === 'string' && [1, 2, 3, 4].every((i) => typeof r[i] === 'number') && typeof r[5] === 'string')
      .map((r) => ({ who: r[0], x: r[1], y: r[2], z: r[3], heading: headingRadians(r[4]), room: r[5], ...(said(r[6]) ? { name: r[6] } : {}) }));
  out.rebel = crew(values.get('corvetteRebelSpawns'));
  out.imperial = crew(values.get('corvetteImperialSpawns'));
  out.neutral = crew(values.get('corvetteNeutralSpawns'));
  const statics = values.get('corvetteStaticSpawns');
  // A fitting's tenth element names the one faction's copy it stands in, where it stands in only one:
  // two computers at one spot in one room are one for each side's run, and the server stood the one
  // whose faction the copy was stood for. Unnamed, a fitting stands in every copy.
  out.statics = (Array.isArray(statics) ? statics : [])
    .filter((r) => Array.isArray(r) && typeof r[0] === 'string' && [1, 2, 3, 5].every((i) => typeof r[i] === 'number') && typeof r[4] === 'string')
    .map((r) => ({ template: r[0], x: r[1], y: r[2], z: r[3], heading: headingRadians(r[5]), room: r[4], ...(said(r[6]) ? { name: r[6] } : {}), ...(said(r[7]) ? { fn: r[7] } : {}), ...(said(r[8]) ? { data: r[8] } : {}), ...(said(r[9]) ? { faction: r[9] } : {}) }));
  return out;
}

/**
 * Join the server's creature names to this game's own models.
 *
 * Most name an object path, which is the catalogue's own key once `shared_` is put in front of the
 * file name -- the archives keep a shared template beside each one and the catalogue is built from
 * those. About one in eighteen instead names a species, which is a body rather than a template, and
 * those are looked up by the appearance the catalogue records. Anything still unmatched is reported
 * by name rather than dropped in silence.
 *
 * **A creature may be several bodies.** Its templates are a list the server drew from at each spawn,
 * and an entry of that list may be the name of a dress group (`readDressGroups`), which is itself a
 * list: every commoner, thug, noble and town policeman is written that way, and so is every body a
 * town's stationary rows draw. Read as its first template alone such a creature had no body at all
 * -- a group's name is no template -- so 172 of them stood nowhere. Each is now joined through its
 * lists to every body the catalogue has for it (`bodies`, ids of the ready ones, where there is more
 * than one), its own `id` the first of them that is ready, and `dress` names every group behind it.
 *
 * **`bodies` is what a body is drawn from, and `dress` is only which groups those came out of.** A
 * creature may name two groups (the Selonian cultists name the men's and the women's) or a group and
 * templates of its own besides, so drawing from one group would stand only half of what it could be.
 */
export function joinCatalogue(creatures, entries, dressGroups = new Map()) {
  const byTemplate = new Map();
  const byAppearance = new Map();
  const byId = new Map();
  for (const e of entries) {
    if (e.template) byTemplate.set(e.template, e);
    if (e.appearance && !byAppearance.has(e.appearance)) byAppearance.set(e.appearance, e);
    if (e.id) byId.set(e.id, e);
  }
  const bodyOf = (t) => {
    if (t.endsWith('.iff')) {
      const hit = byTemplate.get(t.replace(/(^|\/)([^/]+)\.iff$/, '$1shared_$2.iff'));
      if (hit) return hit;
    }
    // A species rather than a template: the body the catalogue knows by that appearance or that id.
    return byAppearance.get(t) ?? byId.get(t) ?? null;
  };
  const joined = new Map();
  const missing = [];
  for (const [name, c] of creatures) {
    const bodies = [];
    const dress = [];
    for (const t of c.templates?.length ? c.templates : [c.template]) {
      const group = dressGroups.get(t);
      if (group) {
        if (!dress.includes(t)) dress.push(t);
        for (const g of group) {
          const hit = bodyOf(g);
          if (hit && !bodies.includes(hit)) bodies.push(hit);
        }
        continue;
      }
      const hit = bodyOf(t);
      if (hit && !bodies.includes(hit)) bodies.push(hit);
    }
    const hit = bodies.find((b) => b.ready) ?? bodies[0] ?? null;
    if (!hit) {
      missing.push({ who: name, template: c.template });
      continue;
    }
    const ready = bodies.filter((b) => b.ready).map((b) => b.id);
    joined.set(name, {
      ...c,
      id: hit.id,
      ready: !!hit.ready,
      kind: hit.kind,
      group: hit.group,
      label: hit.name,
      ...(ready.length > 1 ? { bodies: ready } : {}),
      ...(dress.length ? { dress } : {}),
    });
  }
  return { joined, missing };
}

/**
 * Which frame the data is in, measured against the ground itself.
 *
 * **The witness must not be anything built from this data**, which is the whole lesson here: matched
 * against the packs' own place names it came out perfect and meant nothing, because those names are
 * built from these same files. The terrain is not: it is generated from the client's own rules, and
 * a person who stands outdoors carries the height they stand at. So the height under each of them is
 * asked of the ground at their own coordinates and at the mirrored ones, and whichever answers with
 * the smaller error is the frame the data is in.
 *
 * `heightAt(x, z)` is the pack's own sampler, which works in the snapshot's space. Anyone standing
 * in a building is skipped: their height is a floor's and the ground below is irrelevant.
 */
export function heightCheck(statics, heightAt) {
  const mine = [];
  const flipped = [];
  for (const p of statics) {
    if (p.cell) continue;
    const a = heightAt(p.x, p.z);
    const b = heightAt(-p.x, p.z);
    if (Number.isFinite(a)) mine.push(Math.abs(a - p.y));
    if (Number.isFinite(b)) flipped.push(Math.abs(b - p.y));
  }
  const med = (a) => {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y);
    return Math.round(s[s.length >> 1] * 10) / 10;
  };
  const within = (a) => a.filter((v) => v <= 2).length;
  const asIs = med(mine);
  const mirrored = med(flipped);
  return {
    outdoors: mine.length,
    asIs,
    mirrored,
    withinAsIs: within(mine),
    withinMirrored: within(flipped),
    // The frame the numbers are in. The runtime still applies the world's own mirror on top of it:
    // the snapshot's space is not the space a body is drawn in.
    reading: !(mirrored < asIs) ? 'snapshot' : 'mirrored',
  };
}

/** A vector turned by a w,x,y,z quaternion, the whole rotation and nothing else. */
function turnBy(q, v) {
  const [w, x, y, z] = q;
  const t = [2 * (y * v.z - z * v.y), 2 * (z * v.x - x * v.z), 2 * (x * v.y - y * v.x)];
  return {
    x: v.x + w * t[0] + (y * t[2] - z * t[1]),
    y: v.y + w * t[1] + (z * t[0] - x * t[2]),
    z: v.z + w * t[2] + (x * t[1] - y * t[0]),
  };
}

/**
 * A person inside a building, carried out of their room's own frame into the snapshot's.
 *
 * `room` is the cell's world transform as the snapshot's flattener gives it, which for a cell is its
 * building's (`q` w, x, y, z and `pos`). **Both halves of a person are in the room's frame**: the
 * emulator writes an object in a cell with its place and its facing relative to that cell, exactly
 * as the client keeps an object's transform relative to its parent. The place was always carried
 * through the room's turn and the facing never was, so every person in a turned building -- and
 * nearly every building is turned; on one world every measurable cell is -- faced off by the
 * building's own yaw. The facing is carried the same way the place is: the way they face, turned by
 * the room, read back as a heading about the vertical, so a building that also pitches or rolls
 * still gives the heading a person on its floor sees.
 *
 * A heading is `atan2(x, z)` of the way a body faces, in the snapshot's frame, which is what an
 * outdoor row already carries and what the runtime's mirror negates.
 */
export function intoRoom(s, room) {
  const at = turnBy(room.q, { x: s.x, y: s.y, z: s.z });
  const facing = turnBy(room.q, { x: Math.sin(s.heading), y: 0, z: Math.cos(s.heading) });
  return {
    x: room.pos[0] + at.x,
    y: room.pos[1] + at.y,
    z: room.pos[2] + at.z,
    heading: Math.round(Math.atan2(facing.x, facing.z) * 10000) / 10000,
    room: room.cellIndex,
    local: [s.x, s.y, s.z],
    localHeading: s.heading,
  };
}

/**
 * How far apart this data and the pack's places say the same named place is.
 *
 * Kept for what it is rather than for what it proves: the pack's place rows are built from these
 * same files, so a disagreement here means the two readers have drifted apart, and agreement means
 * nothing at all about the frame. `heightCheck` is what says which frame the numbers are in.
 */
export function frameCheck(named, pois) {
  const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  // A name that is not unique on both sides is not a pair. Several worlds carry more than one place
  // called the same generic thing, and matching one to another puts them kilometres apart and makes
  // the worst figure meaningless while the reading it decides is still unanimous.
  const poiCount = new Map();
  for (const p of pois) if (p?.name) poiCount.set(key(p.name), (poiCount.get(key(p.name)) ?? 0) + 1);
  const namedCount = new Map();
  for (const r of named) namedCount.set(key(r.name), (namedCount.get(key(r.name)) ?? 0) + 1);
  const byName = new Map();
  for (const p of pois) {
    if (!p?.name) continue;
    const k = key(p.name);
    if (poiCount.get(k) === 1 && namedCount.get(k) === 1) byName.set(k, p);
  }
  let asIs = 0;
  let mirrored = 0;
  const gaps = [];
  for (const r of named) {
    const p = byName.get(key(r.name));
    if (!p || typeof p.x !== 'number' || typeof p.z !== 'number') continue;
    const cx = r.shape === 'rect' ? (r.x + r.x2) / 2 : r.x;
    const cz = r.shape === 'rect' ? (r.z + r.z2) / 2 : r.z;
    const a = Math.hypot(cx - p.x, cz - p.z);
    const b = Math.hypot(-cx - p.x, cz - p.z);
    gaps.push(a);
    if (a <= b) asIs++;
    else mirrored++;
  }
  // The median rather than the worst, and how many landed on top of each other. Matching by name
  // pairs the odd unrelated place that happens to share a word, so one bad pair is expected and the
  // middle of the set is what says whether the frame is right. The reading itself is the vote.
  gaps.sort((x, y) => x - y);
  return {
    pairs: gaps.length,
    asIs,
    mirrored,
    median: gaps.length ? Math.round(gaps[gaps.length >> 1]) : 0,
    within100: gaps.filter((g) => g <= 100).length,
    reading: asIs >= mirrored ? 'as-is' : 'mirrored',
  };
}

// ---------------------------------------------------------------------------------------------
// The conversations: what the server's people say, as a structure and nothing else.
//
// **A conversation of the server's is three things and only one of them is data.** A template
// (`mobile/conversations/**.lua`) declares screens -- a line, whether it ends, and the answers, each
// linking to another screen -- and adds them to itself in order. A handler class in the screenplays
// picks the first screen, rewrites screens on the way and does whatever the conversation does. And the
// words are the client's own string ids, or the emulator's own English, or nothing at all where the
// handler fills them in. So what is kept is the structure -- screen names, links, the client's string
// ids, the gesture a screen names -- and, from the handler, only *where* code acts: whether it picks the
// first screen, edits the answers or sets the words, and which screens it names. The handler's code,
// its conditions and the emulator's own English are never kept: a line or an answer written in the
// emulator's words is kept as null and marked `core3-literal`, so nothing here ever pretends to be text.

/**
 * The factories that build one conversation over and over -- a theme park's every giver and target,
 * every trainer -- by the shape each is kept as. The pets' and the informants' are left out: the
 * informants register under a name the code makes up and are a mission type of the server's own, and
 * a pet's conversation is its owner's commands, which no body in this game takes.
 */
export const CONVERSATION_SHAPES = { createMissionGiverConvoTemplate: 'themepark-giver', createMissionTargetConvoTemplate: 'themepark-target', createTrainerConversationTemplate: 'trainer' };

/** A handler's calls that change a screen's answers, and those that set its words or fill them in. */
const OPTION_CALLS = new Set(['addOption', 'removeOption', 'removeAllOptions']);
const TEXT_CALLS = new Set(['setCustomDialogText', 'setDialogTextStringId', 'setDialogTextTO', 'setDialogTextTT', 'setDialogTextDI', 'setDialogTextDF', 'setDialogTextTU']);
/** The class every handler is made from, whose own methods only follow the links. */
const BASE_HANDLER = 'conv_handler';

/** A table read from a file, as against a list or a marker. */
const isTableValue = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof LuaCall);

/** A line's or an answer's words as kept: a client string id or a key of the tree's own table, or null and why not. */
function conversationText(v) {
  // A value the code hands in (a parameter, a call): filled per conversation, which is logic.
  if (typeof v !== 'string' || v === '') return { text: null };
  if (/^@[A-Za-z0-9_/.-]+:[A-Za-z0-9_.-]+$/.test(v) || /^:[A-Za-z0-9_.-]+$/.test(v)) return { text: v };
  // The emulator's own English: never kept, and marked so nothing plays the line as if it were there.
  return { text: null, needs: 'core3-literal' };
}

/** One screen as a node of the structure. */
function screenNode(s) {
  const custom = typeof s.customDialogText === 'string' && s.customDialogText !== '';
  const say = custom ? { text: null, needs: 'core3-literal' } : conversationText(s.leftDialog);
  const node = { id: s.id, say: say.text, end: s.stopConversation === true || s.stopConversation === 'true', replies: [] };
  if (say.needs) node.needs = say.needs;
  if (typeof s.animation === 'string' && s.animation) node.gesture = s.animation;
  for (const o of Array.isArray(s.options) ? s.options : []) {
    if (!Array.isArray(o)) continue;
    const t = conversationText(o[0]);
    const r = { text: t.text, to: typeof o[1] === 'string' && o[1] ? o[1] : null };
    if (t.needs) r.needs = t.needs;
    node.replies.push(r);
  }
  return node;
}

/**
 * The templates one source declares and registers, read a statement at a time (`readStatements`): each
 * screen as it was when it was added, so a name declared twice is two screens. A template made from
 * another (`X = baseTemplate:new { ... }`) has the screens its base has when it is registered, and its
 * own fields over the base's. `consts` stands each of a factory's parameters for a marker, so a value
 * the caller hands in is read as the code's and not as words.
 */
function conversationTemplates(src, consts = {}) {
  const { statements, skipped } = readStatements(src, consts);
  const values = new Map();
  const templates = new Map();
  const registered = [];
  for (const s of statements) {
    if (s.kind === 'assign') {
      values.set(s.name, s.value);
      const v = s.value;
      if (!isTableValue(v)) continue;
      if (v.__class === 'ConvoTemplate') templates.set(s.name, { initial: typeof v.initialScreen === 'string' ? v.initialScreen : null, handler: v.luaClassHandler ?? null, screens: [], base: null });
      else if (templates.has(v.__class)) {
        const b = templates.get(v.__class);
        templates.set(s.name, { initial: typeof v.initialScreen === 'string' ? v.initialScreen : b.initial, handler: v.luaClassHandler ?? b.handler, screens: null, base: v.__class });
      }
    } else if (s.kind === 'method' && s.method === 'addScreen' && templates.has(s.self)) {
      const scr = typeof s.args[0] === 'string' ? values.get(s.args[0]) : s.args[0];
      const t = templates.get(s.self);
      if (isTableValue(scr) && scr.__class === 'ConvoScreen' && typeof scr.id === 'string' && t.screens) t.screens.push(screenNode(scr));
    } else if (s.kind === 'call' && s.call.call === 'addConversationTemplate') {
      const [name, v] = s.call.args;
      const t = typeof v === 'string' ? templates.get(v) : null;
      if (!t) continue;
      const screens = t.screens ?? templates.get(t.base)?.screens ?? [];
      registered.push({ name, initial: t.initial, handler: t.handler, base: t.base, nodes: screens.map((n) => JSON.parse(JSON.stringify(n))) });
    }
  }
  return { registered, skipped };
}

/** Every `.lua` under a folder, by its own folder's walk. */
function scriptFiles(dir) {
  return luaFiles(dir).sort();
}

/**
 * Every handler class the scripts define (`X = Y:new { ... }`) and every method on one (`function
 * X:method(...)`), as the class each is made from and the tokens of each method's body: what a tree's
 * handler is asked about.
 */
function handlerIndex(scripts) {
  const base = new Map();
  const methods = new Map();
  for (const dir of [join(scripts, 'screenplays'), join(scripts, 'mobile', 'conversations')]) {
    for (const file of scriptFiles(dir)) {
      const src = readFileSync(file, 'utf8');
      if (!src.includes(':new') && !src.includes('function')) continue;
      let read;
      try {
        read = readLua(src);
      } catch {
        continue;
      }
      for (const [name, v] of read.values) if (isTableValue(v) && typeof v.__class === 'string' && !base.has(name)) base.set(name, v.__class);
      for (const f of functionBodies(src)) {
        const at = f.name.indexOf(':');
        if (at < 0) continue;
        const cls = f.name.slice(0, at);
        if (!methods.has(cls)) methods.set(cls, new Map());
        methods.get(cls).set(f.name.slice(at + 1), f.tokens);
      }
    }
  }
  return { base, methods };
}

/**
 * Where a tree's handler acts, read off the names and strings its methods mention and nothing else:
 * whether it picks the first screen (`entry`), edits the answers or decides the links (`options`), sets
 * or fills in the words (`text`), which of the tree's screens it names (`screens`), and the screens its
 * entry code names outright (`entries`). A handler nobody defines is `unread`: its logic is unknown, so
 * the whole tree is the code's.
 */
function handlerLogic(handler, nodes, index) {
  const logic = { entry: false, options: false, text: false, screens: [], entries: [] };
  if (typeof handler !== 'string' || !handler || handler === BASE_HANDLER) return logic;
  if (!index.base.has(handler) && !index.methods.has(handler)) return { ...logic, unread: true };
  const ids = new Set(nodes.map((n) => n.id));
  const screens = new Set();
  const entries = [];
  const seen = new Set();
  for (let c = handler; c && c !== BASE_HANDLER && !seen.has(c); c = index.base.get(c)) {
    seen.add(c);
    for (const [method, tokens] of index.methods.get(c) ?? []) {
      if (method === 'getInitialScreen') logic.entry = true;
      if (method === 'getNextConversationScreen') logic.options = true;
      for (let i = 0; i < tokens.length; i++) {
        const k = tokens[i];
        if (k.kind === 'name' && OPTION_CALLS.has(k.value)) logic.options = true;
        if (k.kind === 'name' && TEXT_CALLS.has(k.value)) logic.text = true;
        if (k.kind === 'string' && ids.has(k.value)) {
          screens.add(k.value);
          if (method === 'getInitialScreen' && tokens[i - 2]?.value === 'getScreen' && !entries.includes(k.value)) entries.push(k.value);
        }
      }
    }
  }
  logic.screens = [...screens].sort();
  logic.entries = entries;
  return logic;
}

/**
 * The heralds the server stood: the people who tell a player where a place is and put a waypoint on
 * it. `multi` are the ones with a conversation of their own and several places to tell of (each a
 * person, where they stand and the places in the order their screens number them, `loc1` to `loc4`),
 * and `directions` the places the other heralds send a player to, each with the client's own string id
 * for its name -- which is how the server named their waypoints, and the only names either list has in
 * the client's words: the server's own name for each of `multi`'s places is its English, and is not
 * kept. A place's price is kept where the server charged one.
 */
function readHeralds(scripts) {
  const out = { multi: [], directions: [] };
  for (const file of scriptFiles(join(scripts, 'screenplays'))) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('multiDestHeraldList')) continue;
    for (const [, v] of readLua(src).values) {
      if (!isTableValue(v) || !Array.isArray(v.multiDestHeraldList)) continue;
      for (const r of v.multiDestHeraldList) {
        if (!isTableValue(r) || typeof r.template !== 'string' || typeof r.planet !== 'string' || typeof r.stringFile !== 'string') continue;
        if (![r.x, r.y, r.z].every((n) => typeof n === 'number')) continue;
        const dests = [];
        for (let n = 1; n <= 9; n++) {
          const x = r[`dest${n}X`];
          const z = r[`dest${n}Y`];
          if (typeof x !== 'number' || typeof z !== 'number') break;
          const d = { x, z };
          const cost = r[`dest${n}Cost`];
          if (typeof cost === 'number' && cost > 0) d.cost = cost;
          // A name the server wrote as a key of the conversation's own table is the client's words.
          const name = r[`dest${n}String`];
          if (typeof name === 'string' && /^:[A-Za-z0-9_.-]+$/.test(name)) d.name = `@conversation/${r.stringFile}${name}`;
          dests.push(d);
        }
        out.multi.push({ who: r.template, world: r.planet, x: r.x, y: typeof r.z === 'number' ? r.z : 0, z: r.y, heading: headingRadians(typeof r.angle === 'number' ? r.angle : 0), cell: typeof r.cell === 'number' ? r.cell : 0, table: `conversation/${r.stringFile}`, dests });
      }
      for (const r of Array.isArray(v.heraldList) ? v.heraldList : []) {
        if (!isTableValue(r) || typeof r.planet !== 'string' || typeof r.stringFile !== 'string' || typeof r.destX !== 'number' || typeof r.destY !== 'number') continue;
        out.directions.push({ world: r.planet, x: r.destX, z: r.destY, name: `@spawning/static_npc/${r.stringFile}:waypoint_name_1` });
      }
    }
  }
  return out;
}

/**
 * Every conversation the server's people could hold, as structure: `{ trees, shapes, instances,
 * heralds }`.
 *
 *   - `trees`, by the name each is registered under: the file it is in, its first screen, its
 *     handler, its screens as nodes (`{ id, say, end, gesture?, replies: [{ text, to }], needs? }`), the
 *     template it is made from where it is, and where its handler acts (`handlerLogic`);
 *   - `shapes`, the conversations a factory builds again for each caller, by the shape's name, with the
 *     factory's parameters (a value a caller hands in is a null, as the handler's are);
 *   - `instances`, every factory call, by the name it registers: its shape, its handler and the words it
 *     passes;
 *   - `heralds` (`readHeralds`).
 *
 * Read with this file's own Lua reader and nothing else, and in statement order so nothing a file
 * declares twice is lost. A line in the emulator's own words is null and `core3-literal`, an answer
 * likewise, and a link to nothing is kept as null.
 */
export function readConversations(scripts) {
  const root = join(scripts, 'mobile', 'conversations');
  const trees = new Map();
  const shapes = new Map();
  const instances = new Map();
  const factories = new Map();
  const files = scriptFiles(root);
  // The factories first, wherever they are defined: a caller may come before its factory in the walk.
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const f of functionBodies(src)) {
      const shape = CONVERSATION_SHAPES[f.name];
      if (!shape) continue;
      const consts = Object.fromEntries(f.params.map((p) => [p, new LuaCall('param', [p])]));
      const { registered } = conversationTemplates(f.body, consts);
      const t = registered[0];
      if (!t) continue;
      const param = (v) => (v instanceof LuaCall && v.call === 'param' ? v.args[0] : null);
      factories.set(f.name, { shape, params: f.params, nameAt: f.params.indexOf(param(t.name)), handlerAt: f.params.indexOf(param(t.handler)), handler: typeof t.handler === 'string' ? t.handler : null });
      shapes.set(shape, { factory: f.name, params: f.params, file: file.slice(root.length + 1).replace(/\\/g, '/'), initial: t.initial || null, nodes: t.nodes });
    }
  }
  const index = handlerIndex(scripts);
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const rel = file.slice(root.length + 1).replace(/\\/g, '/');
    for (const t of conversationTemplates(src).registered) {
      if (typeof t.name !== 'string' || !t.name) continue;
      const handler = typeof t.handler === 'string' ? t.handler : null;
      const tree = { file: rel, initial: t.initial || null, handler, nodes: t.nodes, logic: handlerLogic(handler, t.nodes, index) };
      if (t.base) tree.base = t.base;
      trees.set(t.name, tree);
    }
    for (const s of readStatements(src).statements) {
      if (s.kind !== 'call') continue;
      const f = factories.get(s.call.call);
      if (!f) continue;
      const name = s.call.args[f.nameAt];
      if (typeof name !== 'string' || !name) continue;
      const handler = f.handlerAt >= 0 ? s.call.args[f.handlerAt] : f.handler;
      instances.set(name, { shape: f.shape, handler: typeof handler === 'string' ? handler : null, args: s.call.args.filter((a) => typeof a === 'string') });
    }
  }
  const sorted = (m) => new Map([...m].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
  return { trees: sorted(trees), shapes: sorted(shapes), instances: sorted(instances), heralds: readHeralds(scripts) };
}

/**
 * Who says what: every creature that names a conversation (`conversationTemplate`) or a way of
 * speaking (`reactionStf`, the client's `npc_reaction` table it greets and says goodbye from), by the
 * creature's name, as `{ tree?, diction? }`. A diction is the table's own name (`military`, `slang`).
 * Its own reader, so `readCreatures` and the file it writes stay exactly as they were.
 *
 * A conversation a screenplay hands a body at run time (the junk dealers, the corvette's prisoners) is
 * not here: which body gets it is the code's choice, made as it stands them.
 */
export function readConversationSpeakers(scripts) {
  const root = join(scripts, 'mobile');
  const skip = new Set(['lair', 'spawn', 'conversations', 'dressgroup', 'outfits']);
  const out = new Map();
  for (const file of luaFiles(root, skip)) {
    let read;
    try {
      read = readLua(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const [name, v] of read.values) {
      if (!isTableValue(v) || v.__class !== 'Creature') continue;
      const row = {};
      if (typeof v.conversationTemplate === 'string' && v.conversationTemplate) row.tree = v.conversationTemplate;
      const m = typeof v.reactionStf === 'string' ? /^@npc_reaction\/([A-Za-z0-9_]+)$/.exec(v.reactionStf) : null;
      if (m) row.diction = m[1];
      if (row.tree || row.diction) out.set(name, row);
    }
  }
  return new Map([...out].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}
