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
//   - **The frame needs no mirroring at all**, which is the opposite of what every other outside
//     source in this converter has needed. Measured against the packs' own city list, four of
//     Tatooine's towns agree to the metre with no transform; the client's own tables would have
//     needed X negated. `frameCheck` measures it again on every run rather than trusting this note.
//   - **The flag words are the engine's, not the scripts'**, so they are read as the words they are
//     rather than as numbers. That is better: `HERD` and `AGGRESSIVE` say what they mean, and no
//     value from a header this has never seen can be silently wrong.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { findCalls, readLua, LuaCall } from './lua.mjs';

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

/** `getRandomNumber(n)` and a sum containing one, folded to the middle of the range it scatters over. */
function middleOf(v) {
  if (typeof v === 'number') return v;
  if (v instanceof LuaCall && v.call === 'getRandomNumber' && typeof v.args[0] === 'number') return (v.args[0] + 1) / 2;
  if (v instanceof LuaCall && v.call === '+') {
    let sum = 0;
    for (const a of v.args) {
      const n = middleOf(a);
      if (n === null) return null;
      sum += n;
    }
    return sum;
  }
  return null;
}

/**
 * Each world's regions: where things spawn, where they must not, and what the places are called.
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
      if (tier.includes('NOSPAWNAREA') || tier.includes('NOWORLDSPAWNAREA')) noSpawn.push(row);
      if (tier.includes('SPAWNAREA') && Array.isArray(r[5])) {
        const groups = r[5].filter((g) => typeof g === 'string');
        if (groups.length) spawn.push({ ...row, groups, cap: typeof r[6] === 'number' ? r[6] : 0 });
      }
    }
    out.set(world, { spawn, noSpawn, named });
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
      out.set(name, { kind, mobiles, cap: typeof v.spawnLimit === 'number' ? v.spawnLimit : 0, nest, mission: v.missionBuilding ?? null });
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
      const template = Array.isArray(v.templates) ? v.templates.find((t) => typeof t === 'string') : null;
      if (!template) continue;
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
        file: basename(file, '.lua'),
      });
    }
  }
  return out;
}

/**
 * The people who stand somewhere and stay there.
 *
 * They are placed two ways and both are read. Most are a call per person, and a few worlds instead
 * keep one table of rows and loop over it; the two carry the same seven numbers in the same order,
 * so they come out as one list. **The height is the second of the three coordinates**, not the last.
 *
 * A call standing inside a conditional is taken anyway and marked, because the condition is quest
 * state this game does not have: somebody who would be there under some circumstance is better
 * standing there than missing. A row whose coordinates are an expression the reader cannot fold is
 * dropped and counted rather than guessed at, except for the scatter the data writes as a random
 * number added to a base, which is folded to the middle of its range.
 */
export function readStatics(scripts) {
  const out = new Map();
  const add = (world, row) => {
    if (!out.has(world)) out.set(world, []);
    out.get(world).push(row);
  };
  const dropped = new Map();
  const dir = join(scripts, 'screenplays', 'static_spawns');
  for (const file of luaFiles(dir)) {
    const src = readFileSync(file, 'utf8');
    // The per-person form: (planet, who, respawn, x, height, y, heading, cell).
    for (const c of findCalls(src, ['spawnMobile'])) {
      const a = c.args;
      const world = a[0];
      const who = a[1];
      if (typeof world !== 'string' || typeof who !== 'string') continue;
      const nums = [a[2], a[3], a[4], a[5], a[6], a[7]].map(middleOf);
      if (nums.some((n) => n === null)) {
        dropped.set(world, (dropped.get(world) ?? 0) + 1);
        continue;
      }
      const [respawn, x, height, y, heading, cell] = nums;
      add(world, { who, x, y: height, z: y, heading, cell: cell || 0, respawn, gated: c.gated });
    }
    // The one-table form: a screenplay with its own world and a list of rows.
    const { values } = (() => {
      try {
        return readLua(src);
      } catch {
        return { values: new Map() };
      }
    })();
    for (const [, v] of values) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      if (typeof v.planet !== 'string' || !Array.isArray(v.mobiles)) continue;
      for (const r of v.mobiles) {
        if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
        const nums = [r[1], r[2], r[3], r[4], r[5], r[6]].map(middleOf);
        if (nums.slice(0, 5).some((n) => n === null)) {
          dropped.set(v.planet, (dropped.get(v.planet) ?? 0) + 1);
          continue;
        }
        const [respawn, x, height, y, heading, cell] = nums;
        add(v.planet, { who: r[0], x, y: height, z: y, heading, cell: cell || 0, respawn, gated: false });
      }
    }
  }
  return { statics: out, dropped };
}

/**
 * Join the server's creature names to this game's own models.
 *
 * Most name an object path, which is the catalogue's own key once `shared_` is put in front of the
 * file name -- the archives keep a shared template beside each one and the catalogue is built from
 * those. About one in eighteen instead names a species, which is a body rather than a template, and
 * those are looked up by the appearance the catalogue records. Anything still unmatched is reported
 * by name rather than dropped in silence.
 */
export function joinCatalogue(creatures, entries) {
  const byTemplate = new Map();
  const byAppearance = new Map();
  const byId = new Map();
  for (const e of entries) {
    if (e.template) byTemplate.set(e.template, e);
    if (e.appearance && !byAppearance.has(e.appearance)) byAppearance.set(e.appearance, e);
    if (e.id) byId.set(e.id, e);
  }
  const joined = new Map();
  const missing = [];
  for (const [name, c] of creatures) {
    const t = c.template;
    let hit = null;
    if (t.endsWith('.iff')) {
      hit = byTemplate.get(t.replace(/(^|\/)([^/]+)\.iff$/, '$1shared_$2.iff')) ?? null;
    }
    // A species rather than a template: the body the catalogue knows by that appearance or that id.
    if (!hit) hit = byAppearance.get(t) ?? byId.get(t) ?? null;
    if (!hit) {
      missing.push({ who: name, template: t });
      continue;
    }
    joined.set(name, { ...c, id: hit.id, ready: !!hit.ready, kind: hit.kind, group: hit.group, label: hit.name });
  }
  return { joined, missing };
}

/**
 * Check the frame against the pack's own places, every run.
 *
 * Nothing else in this converter reads an outside source whose coordinates need no transform, so the
 * claim that these need none is exactly the kind that has to be measured rather than remembered.
 * The world's own named areas are matched by name against the pack's places, and the answer is how
 * far apart the two say the same place is -- as read, and with X negated. If the mirrored reading
 * ever wins, the run says so and the numbers are wrong.
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
