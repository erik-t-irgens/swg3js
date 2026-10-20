// The NGE overlay's rules: what SOE's own placements for Kashyyyk and Mustafar come to in a pack the game
// already reads, for every player.
//
// **What this is and what it is not.** Core3 places nobody on those worlds; SOE's own server data does. By the
// owner's decision of 2026-10-19 the rows of it every client needs (which creature stands where, how many, over
// which areas, in which rooms) are committed as `tools/swg/ngeref/` (`ngeref.mjs` writes and reads it) and every
// `spawns` reads them by default, so every player who converts gets the same people; `--nge=<folder>` reads the
// owner's live copy instead (`nge.mjs`, the reader), and `--nge=none` leaves them out. Either way this file turns
// what was read into the very shapes the Core3 half writes: a `WildPack` per zone and a `WildManifest` for the
// fleet, under `<out>/nge/`, every name the overlay writes prefixed `nge:` so nothing it holds can ever be read as
// one of Core3's, and every row marked `src: 'nge'`. No model, texture, sound, string, script or quest of the
// game's is read or written: this file names the copy's table paths, its column and objvar names, and the few
// generic spawner scripts and templates a row's kind is told by (`kindOf`), which is format knowledge, as
// `core3.mjs` names Core3's fields. The node test runs it on a miniature tree of TEST names written at run time.
//
// **What the server did, and what is ours.** A placed spawner picked a row of its type table, drew a point in
// its disc of `fltRadius`, stood the creature with the spawner's default behaviour (0 wander, 1 stand guard, 2
// loiter, 3 stop) and waited a delay between its least and most spawn times before the next. The draw is made
// once here from each row's own key (`drawn`), so every browser stands the same body in the same place; a
// spawner standing well above the pack's ground (a walkway in a canopy) stands its people in a knot round
// itself rather than across its disc, where a body drawn off the walkway would perch on nothing and fall,
// and they hold their knot (`still`) since nothing of ours walks a body over a platform's edge. A static NPC
// is one row at the object's place and facing, a corpse a body lying dead, a room crew a place in a named room
// of every copy of its building (the corvette crews' own join, `instances.mjs`), and Mustafar's spawn regions
// are areas the game's own grid lays sites over (`gridSites`). How a creature's level, health and blow are
// worked out from SOE's tables is ours (`ngeMob`), turned into the `game` block by the very rule the Core3 half
// uses (`gameOf`), so the two sources can never disagree about what a level is worth.
//
// Pure: the reader and the cli hand everything in, so a node test runs the whole of it.

import { createHash } from 'node:crypto';
import { isAbsolute, relative } from 'node:path';
import { STATIC_TUNE, heightCheck, unitOf } from './core3.mjs';
import { cellIndexByName, copiesIn } from './instances.mjs';
import { gameOf, packRow, roomsOf, SPAWNS_FORMAT } from './spawnpack.mjs';
import { flattenWithWorldTransforms } from './ws.mjs';

/**
 * The overlay's own shape: bumped when a row, the manifest or the index changes meaning; `status` asks again below
 * it. 2: a row of a table that writes no objid is named by a hash of what it says rather than by the text itself
 * (`rowIds`), so its key moved, and the index says whether it came from the reference or a copy.
 */
export const NGE_FORMAT = 2;

/** Every name the overlay writes begins with this, so a merge can never overwrite or be read as one of Core3's. */
export const NGE_PREFIX = 'nge:';

/** The zones the overlay reads: Kashyyyk's seven and Mustafar, each the pack the game loads for it. Core3 holds none of them. */
export const NGE_ZONES = ['kashyyyk_main', 'kashyyyk_hunting', 'kashyyyk_dead_forest', 'kashyyyk_rryatt_trail', 'kashyyyk_north_dungeons', 'kashyyyk_south_dungeons', 'kashyyyk_pob_dungeons', 'mustafar'];

/**
 * Every number of ours the overlay is converted with. A pack cannot be retuned without converting, so these
 * live here beside the code that uses them rather than in a tune table the game moves.
 */
export const NGE_RULES = {
  /** Seconds before a static NPC comes back: no spawner names one for them, and this is the commonest Core3 respawn. */
  staticRespawn: 300,
  /**
   * How far over the pack's own ground a spawner stands before its people stand in a knot round it rather than
   * across its disc: the runtime's `PERCH_TUNE.lift` (`src/world/mobiles/perch.ts`), written out again rather
   * than imported, since an import of a `src/` file here would make the release's import check demand the
   * runtime's files, and a pack carries no live knob.
   */
  lift: 0.3,
  /** The seconds a creature's primary weapon takes a blow when its row says none: the creatures table's own default. */
  weaponSpeed: 2,
};

/** The golden angle: consecutive turns of a knot that never line up with one another (`untie` in core3.mjs). */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Whether a row is shaped as a spawner (`gated` in `kindOf` when its data names nobody): not a building, and
 * its template's file name or one of its scripts ends `_spawner`. A building that stands a room crew carries a
 * spawner's script too, and is a building.
 */
function spawnerShaped(template, scripts) {
  if (/^object\/building\//.test(String(template ?? '').replace(/\\/g, '/'))) return false;
  return /_spawner$/.test(templateStem(template)) || scripts.some((s) => /_spawner$/.test(s));
}

/**
 * The room crews no building of the copy names for itself, each with the building it stands in (a client
 * template's file name, as the packs' layouts name it). A building whose `spawn_table` objvar names its
 * table decides by the data and needs no line here. Ours, from the templates' own names.
 */
export const CREW_HOSTS = {
  'spawning/dungeon/ep3_myyydril_caverns': 'thm_kash_myyydril_caverns',
  'spawning/dungeon/ep3_avatar_platform': 'dungeon_avatar_platform',
  'spawning/dungeon/som_decrepit_droid_factory': 'decrepit_droid_factory',
  'spawning/dungeon/som_old_republic_facility': 'old_republic_facility',
};
/** Crew tables left out even where a building names them: a scripted encounter's waypoints, a ship with nobody aboard. */
export const CREW_LEFT_OUT = ['spawning/dungeon/som_working_droid_factory', 'spawning/dungeon/som_crash_site_cruiser'];

/**
 * A row's name: `n` and eleven hex figures, never Core3's twelve, so the two can never meet. `id` is the row's
 * own name in its table (`rowIds`).
 */
export function ngeKey(zone, area, copy, id, i) {
  return `n${createHash('sha1').update(`${zone}|${area}|${copy}|${id}|${i}`).digest('hex').slice(0, 11)}`;
}

/**
 * Each row of a buildout table named in that table: its `objid` where the table writes one, else what the row
 * says (`said`: its template, place, turn, scripts and objvars) with a count for twins. Some areas' tables write
 * no `objid` column at all and every row of theirs reads nought there; keyed by that nought, every spawner of
 * such an area shared one set of keys and so drew the same creature at the same offset from its own middle, the
 * same respawn and the same heading. A row named by what it says keeps its name when the table's rows are put
 * in another order, as the crews' rows do. What it says is kept as sixteen hex of its hash, never as the text,
 * which carries the row's scripts and would otherwise be written into the reference beside the converter; a row
 * the reference hands over already carries its name (`id`), worked out here when the reference was written.
 */
export function rowIds(table) {
  const twins = new Map();
  return table.map((r) => {
    if (r.id !== undefined) return String(r.id);
    if (Number(r.objid) > 0) return String(r.objid);
    const said = String(r.said ?? '');
    const twin = twins.get(said) ?? 0;
    twins.set(said, twin + 1);
    return `said:${createHash('sha1').update(said).digest('hex').slice(0, 16)}#${twin}`;
  });
}

/** A template's file name with no folder, no `shared_` and no extension. */
export function templateStem(template) {
  return String(template ?? '').replace(/\\/g, '/').split('/').pop().replace(/^shared_/, '').replace(/\.iff$/i, '');
}

/** A server template's shared twin, `object/mobile/foo.iff` to `object/mobile/shared_foo.iff`, a bare name taken as a mobile's. */
export function sharedOf(template) {
  let p = String(template ?? '').replace(/\\/g, '/').trim();
  if (!p) return '';
  if (!/\.iff$/i.test(p)) p += '.iff';
  if (!p.startsWith('object/')) p = `object/mobile/${p}`;
  const cut = p.lastIndexOf('/');
  const name = p.slice(cut + 1);
  return name.startsWith('shared_') ? p : `${p.slice(0, cut + 1)}shared_${name}`;
}

/**
 * What a buildout row is, by its template, its scripts and its objvars: `area` and `patrol` spawners, a
 * one-person `static`, a `corpse`, a `gated` spawner, a patrol `waypoint`, or `other` (a building, a prop, a
 * navigation point).
 *
 * **Gated is told by shape, never by name**: a row shaped as a spawner (`spawnerShaped`) whose own data names
 * nobody it stands (no `strSpawns`) is stood by a script of the server's -- a quest's, an encounter's, a mine
 * field's -- and never by the data, so it is counted and never stood. The index lists them by their template's
 * own name, read from the copy at run time.
 */
export function kindOf(template, scripts, objvars) {
  const stem = templateStem(template);
  const run = Array.isArray(scripts) ? scripts : [];
  const has = (re) => run.some((s) => re.test(s));
  if (/^patrol_waypoint$/.test(stem)) return 'waypoint';
  if (has(/npc\.celebrity\.corpse_spawner/)) return objvars?.has('spawns') ? 'corpse' : 'other';
  if (has(/npc\.celebrity\.celebrity_spawner/)) return objvars?.has('spawns') ? 'static' : 'other';
  if (!objvars?.has('strSpawns')) return spawnerShaped(template, run) ? 'gated' : 'other';
  if (has(/spawner_patrol/) || stem === 'patrol_spawner') return 'patrol';
  if (has(/spawner_area/) || stem === 'area_spawner') return 'area';
  return 'other';
}

/** A quaternion's turn about the vertical as the way a body faces, `atan2(x, z)` (the layouts' and the rows' own). */
export function yawOfQ(q) {
  if (!Array.isArray(q) || q.length < 4) return 0;
  const [w, x, y, z] = q.map(Number);
  return Math.round(Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y)) * 10000) / 10000;
}

/** Degrees as a heading in radians, the way `core3.mjs` carries a row's (`headingRadians`). */
export function degreesToHeading(deg) {
  const r = (((Number(deg) || 0) % 360) * Math.PI) / 180;
  return Math.round(r * 10000) / 10000;
}

/** An objvar's number, or NaN. */
function ov(objvars, name) {
  const v = objvars?.get(name)?.value;
  return v === undefined || v === '' ? Number.NaN : Number(v);
}

/** An objvar's text, or ''. */
function ovText(objvars, name) {
  return String(objvars?.get(name)?.value ?? '').trim();
}

/**
 * Where one of a spawner's `n` people stands, in the snapshot's frame. `raised` (more than `NGE_RULES.lift`
 * over the ground at the spawner) stands them in a knot round the spawner, the first on it and each after on a
 * spiral `STATIC_TUNE.stackSpread` times the square root of its turn out (`untie`'s own), at the spawner's own
 * height; otherwise a point uniformly in the disc (radius `√u · R`) from the row's own key, at the ground's
 * height there where it is known. `first` is the knot's own key, so every row of one knot turns the same way.
 */
export function spawnerPlace(sp, i, key, first, groundAt) {
  const g = groundAt?.(sp.x, sp.z);
  const raised = Number.isFinite(g) && sp.y - g > NGE_RULES.lift;
  if (raised) {
    if (i === 0) return { x: sp.x, y: sp.y, z: sp.z, raised: true, nudged: false };
    const turn = unitOf(`${first}:stack`) * Math.PI * 2 + i * GOLDEN;
    const out = STATIC_TUNE.stackSpread * Math.sqrt(i);
    return { x: Math.round((sp.x + out * Math.sin(turn)) * 1000) / 1000, y: sp.y, z: Math.round((sp.z + out * Math.cos(turn)) * 1000) / 1000, raised: true, nudged: true };
  }
  const r = Math.max(0, sp.radius) * Math.sqrt(unitOf(`${key}:r`));
  const a = unitOf(`${key}:a`) * Math.PI * 2;
  const x = Math.round((sp.x + r * Math.sin(a)) * 1000) / 1000;
  const z = Math.round((sp.z + r * Math.cos(a)) * 1000) / 1000;
  const h = groundAt?.(x, z);
  return { x, y: Number.isFinite(h) ? Math.round(h * 1000) / 1000 : sp.y, z, raised: false, nudged: false };
}

/**
 * The rows one spawner stands in one copy of its area, raw (before `packRow`): `n` of them, each keyed by
 * zone, area, copy, the spawner's own name in its table (`sp.id`, `rowIds`) and its count. `who` names a
 * creature directly; otherwise `draw` names the type table its person is drawn from each life (`pools`). The
 * behaviour: stand guard and stop stand `still`, loiter and wander step about within `roam` (the disc's
 * radius); a knotted spawner's people stand still whatever it says. The respawn is drawn once per row between
 * the spawner's least and most. A patrol's `route` rides on every row, marked `walks`: the server's own patrol
 * spawner walked the creatures it stood round it, fighters and all, where Core3's towns left their combat
 * walkers at their posts (`walksRound` in src/world/patrols.ts).
 */
export function spawnerRows(sp, { zone, area, copy, groundAt, person, route }) {
  const n = Math.max(1, Math.trunc(sp.count) || 1);
  const out = [];
  const first = ngeKey(zone, area, copy, sp.id, 0);
  for (let i = 0; i < n; i++) {
    const key = i === 0 ? first : ngeKey(zone, area, copy, sp.id, i);
    const at = spawnerPlace(sp, i, key, first, groundAt);
    const lo = Number.isFinite(sp.minTime) ? sp.minTime : Number.isFinite(sp.maxTime) ? sp.maxTime : NGE_RULES.staticRespawn;
    const hi = Number.isFinite(sp.maxTime) ? Math.max(lo, sp.maxTime) : lo;
    const respawn = Math.round((lo + unitOf(`${key}:respawn`) * (hi - lo)) * 10) / 10;
    const heading = Math.round((unitOf(`${key}:heading`) * 2 - 1) * Math.PI * 10000) / 10000;
    const row = { key, who: person.who ?? null, x: at.x, y: at.y, z: at.z, heading, cell: 0, respawn, gated: false, where: sp.kind, from: 'nge' };
    if (person.draw) row.draw = person.draw;
    // Absent, the behaviour is the server's own default for an unset number: nought, wander.
    const b = Number.isFinite(sp.behaviour) ? sp.behaviour : 0;
    if (at.raised || b === 1 || b === 3) row.still = true;
    else if (sp.radius > 0) row.roam = Math.round(sp.radius * 10) / 10;
    if (!at.raised) row.drawn = true;
    if (at.nudged) row.nudged = true;
    if (route?.length) {
      row.route = route;
      row.walks = true;
    }
    out.push(row);
  }
  return out;
}

/**
 * A patrol's route from its named points, in the order its spawner names them, each in its area's copy (the
 * points `pointsByName` holds, corner added). Null and `lost` where a name has no point: a walk that ends at
 * no point is no walk.
 */
export function patrolRoute(names, pointsByName) {
  const route = [];
  for (const name of names) {
    const p = pointsByName.get(name);
    if (!p) return { route: null, lost: true };
    route.push({ x: p.x, y: p.y, z: p.z, cell: 0, linger: false });
  }
  return { route: route.length ? route : null, lost: false };
}

/** The point names a patrol spawner walks, as its objvar writes them (`:` or `,` apart). */
export function patrolNames(objvars) {
  return ovText(objvars, 'strPatrolPointNames').split(/[:,]/).map((s) => s.trim()).filter(Boolean);
}

/** One static NPC or corpse, raw: at the object's place and facing; a corpse lying dead and unattackable. `o.id` is its own name in its table (`rowIds`). */
export function staticRow(o, { zone, who, corpse }) {
  const row = { key: ngeKey(zone, o.area, o.copy, o.id, 0), who, x: o.x, y: o.y, z: o.z, heading: yawOfQ(o.q), cell: 0, respawn: NGE_RULES.staticRespawn, gated: false, where: corpse ? 'corpse' : 'static', from: 'nge' };
  if (corpse) {
    row.mood = 'dead';
    row.peaceful = true;
  }
  return row;
}

/**
 * One room crew in every copy of its building, raw, in the shape the corvette's crews have before `packRow`
 * carries them out of their room (`corvetteCrewRows` in instances.mjs, whose join this is): the place is the
 * table's own, in the room's frame as the client keeps it; the room is found by name in the copy's own cells
 * (`roomIndex`, from the building's model in the pack). A row whose room the model has no cell of that name for
 * is lost and counted, never stood somewhere else. `person(row)` says who stands at a row (`{ who }`, `{ draw }`
 * or null for a row that stands nobody: a quest object, a prop).
 */
export function crewRows(table, crew, copies, roomIndex, { zone, person }) {
  const rows = [];
  let lost = 0;
  let things = 0;
  copies.forEach((copy, ordinal) => {
    // A row is named by what it says (who, which room, where), with a count for twins, so a table whose rows are
    // reordered names every person the same.
    const twins = new Map();
    crew.forEach((r) => {
      const who = person(r);
      if (!who) {
        if (ordinal === 0) things++;
        return;
      }
      const index = roomIndex.get(r.room);
      const cell = index ? copy.cells.get(index) : undefined;
      if (!cell) {
        lost++;
        return;
      }
      const said = `${r.spawns}|${r.room}|${r.x}|${r.y}|${r.z}`;
      const twin = twins.get(said) ?? 0;
      twins.set(said, twin + 1);
      const row = { key: ngeKey(zone, `crew:${table}`, ordinal, said, twin), who: who.who ?? null, x: r.x, y: r.y, z: r.z, heading: degreesToHeading(r.yaw), cell, respawn: Math.max(0, r.respawn || 0), gated: false, where: 'dungeon', from: 'nge' };
      if (who.draw) row.draw = who.draw;
      if (r.mood) row.mood = r.mood;
      rows.push(row);
    });
  });
  return { rows, lost, things };
}

// ------------------------------------------------------------------------------------------- regions

/** A region row's shape in the snapshot's frame, as the grid reads one (`SpawnArea`), or null. */
export function regionShape(r) {
  const g = String(r.geometry ?? '').toLowerCase();
  const a = Number(r.minX_or_centerX);
  const b = Number(r.minZ_or_centerZ);
  const c = Number(r.maxX_or_radius);
  if (![a, b, c].every(Number.isFinite)) return null;
  if (g === 'circle' || g === '1') return { shape: 'circle', x: a, z: b, r: c };
  const d = Number(r.maxZ);
  if (!Number.isFinite(d)) return null;
  return { shape: 'rect', x: Math.min(a, c), z: Math.min(b, d), x2: Math.max(a, c), z2: Math.max(b, d) };
}

/** A region's own name: its string id's key, lower case. */
export function regionName(name) {
  return String(name ?? '').replace(/^@[^:]*:/, '').trim().toLowerCase();
}

/** Whether region shape `outer` holds `inner` whole. */
export function holdsWhole(outer, inner) {
  const corners = inner.shape === 'rect' ? [[inner.x, inner.z], [inner.x2, inner.z], [inner.x, inner.z2], [inner.x2, inner.z2]] : null;
  if (outer.shape === 'rect') {
    const box = inner.shape === 'rect' ? [inner.x, inner.z, inner.x2, inner.z2] : [inner.x - inner.r, inner.z - inner.r, inner.x + inner.r, inner.z + inner.r];
    return outer.x <= box[0] && outer.z <= box[1] && outer.x2 >= box[2] && outer.z2 >= box[3];
  }
  if (corners) return corners.every(([x, z]) => Math.hypot(x - outer.x, z - outer.z) <= outer.r);
  return Math.hypot(inner.x - outer.x, inner.z - outer.z) + inner.r <= outer.r;
}

/**
 * A world's spawn regions as the grid reads them: each spawn region with a list of its own name an area of one
 * group, named for its list; each no-spawn region a place nothing stands, **except one that holds a spawn region
 * whole**, which is dropped and counted (on Mustafar a no-spawn rectangle holds every spawn region whole, and with
 * it kept the grid lays nothing). A region typed anything else (a mission's, a difficulty's) is neither. `lists` is
 * each list's rows by its name, `lairOf(name)` a lair table's rows (null where there is none), `known(name)`
 * whether a creature joined a body.
 */
export function regionAreas(rows, lists, lairOf, known) {
  const spawn = [];
  const noSpawn = [];
  let other = 0;
  for (const r of rows ?? []) {
    const shape = regionShape(r);
    if (!shape) continue;
    const name = regionName(r.regionName);
    const type = String(r.spawnableType ?? '').trim() || 'spawnFalse';
    if (type === 'spawnTrue' && lists.has(name)) spawn.push({ name: `${NGE_PREFIX}${name}`, ...shape, groups: [`${NGE_PREFIX}${name}`], cap: 0 });
    else if (type === 'spawnFalse') noSpawn.push({ name: `${NGE_PREFIX}${name || 'no_spawn'}`, ...shape, groups: [], cap: 0 });
    else other++;
  }
  const kept = noSpawn.filter((n) => !spawn.some((a) => holdsWhole(n, a)));
  const groups = {};
  const lairs = {};
  let lairsLost = 0;
  for (const a of spawn) {
    const list = lists.get(a.name.slice(NGE_PREFIX.length)) ?? [];
    const entries = [];
    for (const row of list) {
      const lair = String(row.strLairType ?? '').trim();
      if (!lair) continue;
      const key = `${NGE_PREFIX}${lair}`;
      if (!lairs[key]) {
        const mobs = [];
        for (const m of lairOf(lair) ?? []) {
          const who = String(m.mobiles ?? '').trim();
          if (!who || !known(who)) continue;
          const limit = Number(m.spawnLimit);
          mobs.push({ who: `${NGE_PREFIX}${who}`, n: limit > 0 ? limit : 1 });
        }
        if (!mobs.length) {
          lairsLost++;
          lairs[key] = null;
          continue;
        }
        // A herd with no building; its cap is what its rows' limits come to, which is what the game's own rule
        // stands a third of (`standingAt`).
        lairs[key] = { kind: 'nge', mobiles: mobs, boss: [], cap: mobs.reduce((s, m) => s + m.n, 0), nest: null, building: 'none', people: false };
      }
      if (!lairs[key]) continue;
      entries.push({ lair: key, weight: Number(row.intWeighting) || 1, count: Number(row.intNumToSpawn) || 0, size: Number(row.intSize) || 0, limit: Number.isFinite(Number(row.intSpawnLimit)) && row.intSpawnLimit !== '' ? Number(row.intSpawnLimit) : -1, minDiff: Number(row.intMinDifficulty) || 0, maxDiff: Number(row.intMaxDifficulty) || 0 });
    }
    if (entries.length) groups[a.name] = entries;
  }
  for (const k of Object.keys(lairs)) if (!lairs[k]) delete lairs[k];
  return { areas: spawn, noSpawn: kept, groups, lairs, dropped: noSpawn.length - kept.length, other, lairsLost };
}

// ---------------------------------------------------------------------------------------- creatures

/** A table cell read as on: a 1, a word that says so. */
function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/**
 * One creature row of SOE's table as the Core3 record `core3StatsFor` and `gameOf` read, so one rule turns
 * both sources into the `game` block. The mapping is ours: the level is `BaseLevel`; health is the stat table's
 * HP at that level for the creature's class (normal, `Elite_` or `Boss_`; the nearest level below where the
 * table has no row for it); a blow is the class's damage a second times the primary weapon's seconds a blow;
 * an `aggressive` radius above nought is the pvp AGGRESSIVE bit and `invulnerable` takes ATTACKABLE away (the
 * server attacks a player of no faction on sight for that bit alone: CLAUDE.md's `KILLER`/`STALKER` lesson);
 * `herd`, `stalker` and a death blow are the creature bits; its weapons are the templates its two weapon words
 * stand for.
 */
export function ngeMob(c, { stat, weaponTemplates }) {
  const level = Math.max(1, Math.trunc(Number(c.BaseLevel) || 1));
  const cls = String(c.difficultyClass ?? '').toUpperCase();
  const prefix = cls === 'ELITE' || cls === '1' ? 'Elite_' : cls === 'BOSS' || cls === '2' ? 'Boss_' : '';
  const s = stat(level);
  const hp = Number(s?.[`${prefix}HP`]) || 0;
  const dps = Number(s?.[`${prefix}damagePerSecond`]) || 0;
  const speed = Number(c.primary_weapon_speed) > 0 ? Number(c.primary_weapon_speed) : NGE_RULES.weaponSpeed;
  const blow = Math.round(dps * speed);
  const aggressive = Number(c.aggressive) > 0;
  const pvp = [...(truthy(c.invulnerable) ? [] : ['ATTACKABLE']), ...(aggressive ? ['AGGRESSIVE'] : [])];
  const blowWord = String(c.death_blow ?? '').trim().toLowerCase();
  const creature = [...(truthy(c.herd) ? ['HERD'] : []), ...(truthy(c.stalker) ? ['STALKER'] : []), ...(blowWord === 'yes' || blowWord === 'instant' || blowWord === '1' || blowWord === '2' ? ['KILLER'] : [])];
  return {
    name: c.creatureName,
    level,
    ham: [hp, hp],
    damage: [blow, blow],
    pvp,
    creature,
    weapons: weaponTemplates(c),
    faction: String(c.pvpFaction ?? '').trim() || null,
    socialGroup: String(c.socialGroup ?? '').trim() || null,
  };
}

/**
 * The weapon words a creature fights with, as the names its manifest carries (`nge:<word>`) and the groups those
 * stand for, out of SOE's own weapon table (`weapon_id`, `weapon1` to `weapon4`), or the word itself where it
 * names a template outright. `unarmed` and `none` are the absence of one written down.
 */
export function weaponWords(c, aiWeapons) {
  const names = [];
  const groups = {};
  for (const w of [c.primary_weapon, c.secondary_weapon]) {
    const word = String(w ?? '').trim();
    if (!word || word === 'none' || word === 'unarmed') continue;
    const list = /\.iff$/i.test(word) ? [word] : (aiWeapons.get(word) ?? []).filter(Boolean);
    if (!list.length) continue;
    const name = `${NGE_PREFIX}${word}`;
    if (!names.includes(name)) names.push(name);
    groups[name] = list;
  }
  return { names, groups };
}

/**
 * Which of this game's bodies a creature stands as: its server template's `.tpf` names its client body
 * (`sharedTemplate`, which a few rows of SOE's own need) and otherwise the plain `shared_` rule gives it; a dress
 * list's name is every template in the list. Joined the way `joinCatalogue` joins Core3's (`core3.mjs`): every
 * body the catalogue has for it, its own `id` the first that is ready, `bodies` the ready ones where there is more
 * than one, `dress` the list it came out of. Null where nothing joins.
 */
export function joinBody(c, { byTemplate, sharedTemplate, dress }) {
  const t = String(c.template ?? '').trim();
  const sharedFor = (x) => sharedTemplate(x) ?? sharedOf(x);
  let candidates = [];
  const lists = [];
  if (/\.iff$/i.test(t)) candidates = [sharedFor(t)];
  else if (dress.has(t)) {
    lists.push(t);
    candidates = dress.get(t).map((x) => sharedFor(/\.iff$/i.test(x) ? x : `${x}.iff`));
  }
  const bodies = [];
  for (const s of candidates) {
    const e = byTemplate.get(s);
    if (e && !bodies.includes(e)) bodies.push(e);
  }
  const hit = bodies.find((b) => b.ready) ?? bodies[0] ?? null;
  if (!hit) return null;
  const ready = bodies.filter((b) => b.ready).map((b) => b.id);
  return { id: hit.id, ready: !!hit.ready, kind: hit.kind, ...(ready.length > 1 ? { bodies: ready } : {}), ...(lists.length ? { dress: lists.map((l) => `${NGE_PREFIX}${l}`) } : {}) };
}

/**
 * The creature a manifest carries for one joined creature: the Core3 half's own fields (`creatureOut` in the
 * cli), filled from SOE's row, and its own numbers (`game`, `gameOf` over `ngeMob`).
 */
export function creatureRecord(c, joined, mob, game, weapons) {
  const niche = String(c.niche ?? '').trim().toLowerCase();
  return {
    id: joined.id,
    level: mob.level,
    hp: mob.ham[0],
    hpMax: mob.ham[1],
    damage: mob.damage,
    armour: 0,
    xp: 0,
    diet: niche === 'herbivore' || niche === 'carnivore' ? niche : '',
    kind: niche || joined.kind || '',
    aggressive: mob.pvp.includes('AGGRESSIVE'),
    attackable: mob.pvp.includes('ATTACKABLE'),
    herd: mob.creature.includes('HERD'),
    pack: false,
    stalker: mob.creature.includes('STALKER'),
    social: mob.socialGroup ?? '',
    faction: mob.faction ?? '',
    tame: 0,
    ferocity: 0,
    hues: [],
    ...(game ? { game } : {}),
    ...(weapons.length ? { weapons } : {}),
    ...(joined.dress ? { dress: joined.dress } : {}),
    ...(joined.bodies ? { bodies: joined.bodies } : {}),
  };
}

// ------------------------------------------------------------------------------------------- frames

/**
 * How far the copy's placed objects stand from the pack's own objects of the same template: each top-level
 * object that is not a spawner, a waypoint or inside a cell, matched to the nearest layout object of its shared
 * template. The pack's layout is the client's own snapshot and buildout and nothing built from the copy, so a
 * median of nought says the copy's rows are in the snapshot's frame. `objects` are `{ template, x, z }`.
 */
export function objectFrame(objects, layoutObjects) {
  const byTemplate = new Map();
  for (const o of layoutObjects ?? []) {
    if (o.contained || !o.template) continue;
    if (!byTemplate.has(o.template)) byTemplate.set(o.template, []);
    byTemplate.get(o.template).push(o);
  }
  const d = [];
  let unmatched = 0;
  for (const o of objects) {
    const cands = byTemplate.get(sharedOf(o.template));
    if (!cands) {
      unmatched++;
      continue;
    }
    let best = Infinity;
    for (const c of cands) best = Math.min(best, Math.hypot(c.x - o.x, c.z - o.z));
    d.push(best);
  }
  d.sort((a, b) => a - b);
  const median = d.length ? Math.round(d[d.length >> 1] * 1000) / 1000 : null;
  return { matched: d.length, unmatched, median, within: d.filter((v) => v <= 0.01).length };
}

// ------------------------------------------------------------------------------------------ the zone

/**
 * One zone's overlay: every row it stands, its areas, its pools and its counts. `input` is what the cli and the
 * reader hand over:
 *
 *   - `zone`, `areas` (the zone's area rows: `area`, `x1`, `z1`, `eventRequired`), `buildout(area)` (an area
 *     table's rows with `objvars` already a Map and `scripts` a list), `typeTable(name)` (a type table's creatures,
 *     flattened, or null), `isCreature(name)`;
 *   - `regions` (the zone's region rows), `lists`, `lairOf` (Mustafar's);
 *   - `crews`: `{ table, rows, host }` for each crew this zone stands, `snap` (an empty snapshot with the zone's
 *     buildouts merged, the converter's own path), `layout` and `manifest` (the zone's pack);
 *   - `joined` (creature name to joined body, `nge:` names), `groundAt(x, z)`.
 *
 * Rows go through `packRow` as every Core3 row does, so a row reaches a body, a room and a route exactly the way
 * theirs do; each then carries `src: 'nge'` and, where it steps about, `roam`.
 */
export function zoneOverlay(input) {
  const { zone, joined, groundAt } = input;
  const counts = { sites: 0, spawners: 0, patrols: 0, statics: 0, corpses: 0, crew: 0, gated: 0, inCell: 0, unresolved: 0, noBody: 0, noRoom: 0, routeLost: 0, crewLost: 0, things: 0, eventAreas: 0 };
  const gated = {};
  const unresolved = new Set();
  const raw = [];
  const pools = new Map();
  const objects = [];
  const written = [];
  // Who stands at a spawner: a creature named outright, else its type table drawn each life.
  const personOf = (name) => {
    const n = String(name ?? '').trim();
    if (!n) return null;
    if (input.isCreature(n)) return { who: `${NGE_PREFIX}${n}` };
    const items = input.typeTable(n);
    if (!items?.length) return null;
    const pool = `${NGE_PREFIX}${templateStem(n)}`;
    if (!pools.has(pool)) pools.set(pool, items.map((c) => `${NGE_PREFIX}${c}`));
    return { draw: [[pool, 1]] };
  };
  const copies = new Map();
  for (const a of input.areas ?? []) {
    if (!a.area) continue;
    if (a.eventRequired) {
      counts.eventAreas++;
      continue;
    }
    const copy = copies.get(a.area) ?? 0;
    copies.set(a.area, copy + 1);
    const table = input.buildout(a.area);
    if (!table) continue;
    const x0 = Number(a.x1) || 0;
    const z0 = Number(a.z1) || 0;
    // Each row's own name in its table, whether the table writes an objid or not (`rowIds`).
    const ids = rowIds(table);
    // The rows of this copy, carried into the snapshot's frame (the corner added to a top-level object). A row the
    // reference hands over says its kind already (`ngeref.mjs`), since its scripts are not kept.
    const rows = table.map((r, i) => ({ ...r, id: ids[i], area: a.area, copy, inCell: (Number(r.container) || 0) !== 0 || (Number(r.cell_index) || 0) !== 0, x: x0 + (Number(r.px) || 0), y: Number(r.py) || 0, z: z0 + (Number(r.pz) || 0), q: [Number(r.qw), Number(r.qx), Number(r.qy), Number(r.qz)], kind: r.kind ?? kindOf(r.server_template_crc, r.scripts, r.objvars) }));
    const points = new Map();
    for (const r of rows) {
      if (r.kind !== 'waypoint' || r.inCell) continue;
      for (const name of [ovText(r.objvars, 'pointName'), ovText(r.objvars, 'strName')]) if (name && !points.has(name)) points.set(name, { x: r.x, y: r.y, z: r.z });
    }
    for (const r of rows) {
      if (r.kind === 'other' && !r.inCell) objects.push({ template: r.server_template_crc, x: r.x, z: r.z });
      if (r.kind === 'other' || r.kind === 'waypoint') continue;
      if (r.kind === 'gated') {
        const stem = templateStem(r.server_template_crc);
        gated[stem] = (gated[stem] ?? 0) + 1;
        counts.gated++;
        continue;
      }
      if (r.inCell) {
        // A placed spawner in a room is a place in a cell and nowhere on a planet: held unplaced, never at a point.
        counts.inCell++;
        continue;
      }
      written.push({ x: r.x, y: r.y, z: r.z });
      if (r.kind === 'static' || r.kind === 'corpse') {
        const who = ovText(r.objvars, 'spawns');
        if (!input.isCreature(who)) {
          counts.unresolved++;
          unresolved.add(who);
          continue;
        }
        raw.push(staticRow({ area: a.area, copy, id: r.id, x: r.x, y: r.y, z: r.z, q: r.q }, { zone, who: `${NGE_PREFIX}${who}`, corpse: r.kind === 'corpse' }));
        counts[r.kind === 'corpse' ? 'corpses' : 'statics']++;
        continue;
      }
      // A spawner, of an area or a patrol.
      const name = ovText(r.objvars, 'strSpawns');
      const person = personOf(name);
      if (!person) {
        counts.unresolved++;
        unresolved.add(name);
        continue;
      }
      let route = null;
      if (r.kind === 'patrol') {
        const got = patrolRoute(patrolNames(r.objvars), points);
        if (got.lost) counts.routeLost++;
        route = got.route;
      }
      const sp = { id: r.id, x: r.x, y: r.y, z: r.z, radius: ov(r.objvars, 'fltRadius') || 0, count: ov(r.objvars, 'intSpawnCount'), behaviour: ov(r.objvars, 'intDefaultBehavior'), minTime: ov(r.objvars, 'fltMinSpawnTime'), maxTime: ov(r.objvars, 'fltMaxSpawnTime'), kind: r.kind === 'patrol' ? 'patrol' : 'spawner' };
      const made = spawnerRows(sp, { zone, area: a.area, copy, groundAt, person, route });
      raw.push(...made);
      counts.sites++;
      counts[r.kind === 'patrol' ? 'patrols' : 'spawners'] += made.length;
    }
  }
  // The room crews, through the copies of each crew's building in the zone's buildouts and its model's own rooms.
  let rooms = new Map();
  if (input.crews?.length && input.snap) {
    const entries = flattenWithWorldTransforms(input.snap);
    rooms = roomsOf(input.snap);
    for (const crew of input.crews) {
      const want = (t) => templateStem(t) === crew.host;
      const id = (input.layout?.objects ?? []).find((o) => !o.contained && want(o.template))?.model;
      const def = id ? (input.manifest?.categories?.layout ?? []).find((d) => d.id === id) : null;
      const list = copiesIn(entries, input.snap.templates, want);
      if (!def?.cells?.length || !list.length) {
        // No model with rooms, or no copy placed: every person of the crew is in no room, and said so.
        counts.crewLost += crew.rows.filter((r) => r.spawns && !r.spawns.startsWith('object/')).length * Math.max(1, list.length);
        continue;
      }
      const got = crewRows(crew.table, crew.rows, list, cellIndexByName(def.cells), {
        zone,
        person: (r) => {
          const who = String(r.spawns ?? '').trim();
          if (!who || who.startsWith('object/')) return null;
          return personOf(who);
        },
      });
      counts.crewLost += got.lost;
      counts.things += got.things;
      raw.push(...got.rows);
    }
  }
  // Every row as the pack carries it: a body, a room and a route reached the way Core3's are.
  const statics = [];
  const poolMap = pools;
  for (const r of raw) {
    const got = packRow(r, { joined, rooms, pools: poolMap });
    if (got.lost) {
      counts[got.lost === 'room' ? 'noRoom' : 'noBody']++;
      continue;
    }
    const row = got.row;
    row.src = 'nge';
    if (r.roam) row.roam = r.roam;
    // Only with the route `packRow` kept: a route lost to a missing room is no round to walk.
    if (r.walks && row.route?.length) row.walks = true;
    if (r.where === 'dungeon') counts.crew++;
    statics.push(row);
  }
  const regions = input.regions?.length ? regionAreas(input.regions, input.lists ?? new Map(), input.lairOf ?? (() => null), (n) => joined.has(`${NGE_PREFIX}${n}`)) : { areas: [], noSpawn: [], groups: {}, lairs: {}, dropped: 0, other: 0, lairsLost: 0 };
  const poolsOut = {};
  for (const row of statics) for (const [pool] of row.draw ?? []) if (!poolsOut[pool] && pools.has(pool)) poolsOut[pool] = pools.get(pool);
  // The placed objects' check is the one the reference recorded when it was written, where the rows came from it
  // (`frameObjects`): it keeps the measurement and not the thousands of objects it was made over.
  const frame = { objects: input.frameObjects ?? objectFrame(objects, input.layout?.objects), ground: heightCheck(written, groundAt ?? (() => Number.NaN)) };
  return { statics, areas: regions.areas, noSpawn: regions.noSpawn, groups: regions.groups, lairs: regions.lairs, pools: poolsOut, counts: { ...counts, rows: statics.length, areas: regions.areas.length, noSpawn: regions.noSpawn.length, dropped: regions.dropped, lairsLost: regions.lairsLost, copies: [...copies.values()].reduce((s, n) => s + n, 0) }, gated, unresolved: [...unresolved].sort(), frame };
}

/** The pack one zone's overlay is written as: a `WildPack` at the spawns format, every row the overlay's. `local` says it came from a live copy rather than the reference. */
export function zonePack(zone, z, local = false) {
  return {
    format: SPAWNS_FORMAT,
    planet: zone,
    local,
    source: { statics: 'nge', areas: 'nge', creaturePlaces: 'invented', scatter: 'drawn' },
    frameCheck: z.frame,
    counts: z.counts,
    areas: z.areas,
    noSpawn: z.noSpawn,
    statics: z.statics,
    pools: z.pools,
  };
}

// -------------------------------------------------------------------------------------- the overlay

/**
 * Each creature joined to a body only when something asks for it (`get`, `has`: the two `packRow` and the
 * pools ask), so the overlay reads the `.tpf` of the creatures it stands and of no other: a Map's two methods by
 * the overlay's own names (`nge:<creature>`).
 */
export function lazyJoin(creatures, ctx) {
  const done = new Map();
  const get = (name) => {
    if (done.has(name)) return done.get(name) ?? undefined;
    let out = null;
    if (String(name).startsWith(NGE_PREFIX)) {
      const c = creatures.get(String(name).slice(NGE_PREFIX.length));
      if (c) out = joinBody(c, ctx);
    }
    done.set(name, out);
    return out ?? undefined;
  };
  return {
    get,
    has: (name) => !!get(name),
    /** Every creature asked for that joined, by its overlay name. */
    joinedNames: () => [...done].filter(([, v]) => v).map(([k]) => k).sort(),
    /** Every creature asked for that SOE's table has and no body of ours joins. */
    bodiless: () => [...done].filter(([k, v]) => !v && creatures.has(String(k).slice(NGE_PREFIX.length))).map(([k]) => k).sort(),
  };
}

/**
 * The crews a zone stands: every table a building of the zone names in its `spawn_table` objvar (the data
 * decides), and every table of ours (`CREW_HOSTS`) whose building the zone's buildouts place, less those left
 * out (`CREW_LEFT_OUT`). `rows` are the zone's buildout rows as the reader gives them.
 */
export function crewsOf(rows) {
  const out = new Map();
  const stems = new Set();
  for (const r of rows) {
    stems.add(templateStem(r.server_template_crc));
    const named = ovText(r.objvars, 'spawn_table');
    if (!named) continue;
    const table = named.replace(/\\/g, '/').replace(/^datatables\//, '').replace(/\.(iff|tab)$/, '');
    if (!CREW_LEFT_OUT.includes(table) && !out.has(table)) out.set(table, templateStem(r.server_template_crc));
  }
  for (const [table, host] of Object.entries(CREW_HOSTS)) if (!out.has(table) && stems.has(host)) out.set(table, host);
  return [...out].map(([table, host]) => ({ table, host }));
}

/**
 * The whole overlay, from a reader (`makeNgeReader` over a live copy, or `ngeRefReader` over the reference beside
 * the converter, which answers every question alike) and what the converted packs hold: the index, the fleet's
 * manifest and a pack per zone. `zones` are the zones whose packs are converted; `packOf(zone)` their `{ layout,
 * manifest, stamp }`; `groundOf(zone)` the pack's own ground; `snapOf(zone)` an empty snapshot with the zone's
 * buildouts merged (null without the archives, and then no crew stands); `clientAreas(zone)` the client's own
 * area rows (null without the archives, and then the copy's shared table's, which agree); `catalogue` the mobiles
 * catalogue.
 */
export function buildNgeOverlay({ reader, zones, packOf, groundOf, snapOf, clientAreas, catalogue, converted }) {
  const local = reader.roots.kind !== 'reference';
  const creatures = reader.creatures();
  const isCreature = (n) => creatures.has(String(n ?? '').trim());
  const byTemplate = new Map();
  for (const e of catalogue?.entries ?? []) if (e.template) byTemplate.set(e.template, e);
  const entryById = new Map((catalogue?.entries ?? []).map((e) => [e.id, e]));
  const joined = lazyJoin(creatures, { byTemplate, sharedTemplate: (t) => reader.sharedTemplate(t), dress: reader.dressLists() });
  const packs = {};
  const zoneIndex = {};
  const groups = {};
  const lairs = {};
  const gated = {};
  const unresolved = new Set();
  let crewLeft = 0;
  for (const zone of zones) {
    const pack = packOf(zone);
    if (!pack) continue;
    const areas = clientAreas?.(zone) ?? reader.areas(zone) ?? [];
    const all = [];
    for (const a of areas) if (a.area && !a.eventRequired) all.push(...(reader.buildout(zone, a.area) ?? []));
    const regions = reader.regions(zone);
    const lists = regions.some((r) => String(r.spawnableType ?? '').trim() === 'spawnTrue') ? reader.spawnLists(zone) : new Map();
    const crews = [];
    for (const c of crewsOf(all)) {
      const rows = reader.crew(c.table);
      if (rows) crews.push({ ...c, rows });
    }
    const snap = crews.length ? snapOf?.(zone) ?? null : null;
    if (crews.length && !snap) crewLeft += crews.length;
    const z = zoneOverlay({
      zone,
      areas,
      buildout: (area) => reader.buildout(zone, area),
      typeTable: (n) => reader.typeTable(n, isCreature),
      isCreature,
      regions,
      lists,
      lairOf: (n) => reader.lair(n),
      crews: snap ? crews : [],
      snap,
      layout: pack.layout,
      manifest: pack.manifest,
      joined,
      groundAt: groundOf?.(zone) ?? (() => Number.NaN),
      frameObjects: reader.frameOf?.(zone) ?? null,
    });
    for (const u of z.unresolved) unresolved.add(u);
    for (const [k, n] of Object.entries(z.gated)) gated[k] = (gated[k] ?? 0) + n;
    Object.assign(groups, z.groups);
    Object.assign(lairs, z.lairs);
    packs[zone] = zonePack(zone, z, local);
    zoneIndex[zone] = { ...z.counts, crews: crews.map((c) => c.table), layout: pack.stamp ?? null, frame: z.frame };
  }
  // The creatures the rows, the pools and the lairs stand, each with its own numbers out of SOE's tables.
  const used = new Set();
  for (const p of Object.values(packs)) {
    for (const r of p.statics) if (r.who) used.add(r.who);
    for (const names of Object.values(p.pools)) for (const n of names) used.add(n);
  }
  for (const l of Object.values(lairs)) for (const m of l.mobiles) used.add(m.who);
  const creaturesOut = {};
  const weaponGroups = {};
  let withGame = 0;
  for (const name of [...used].sort()) {
    const j = joined.get(name);
    const c = creatures.get(name.slice(NGE_PREFIX.length));
    if (!j || !c) continue;
    const words = weaponWords(c, reader.aiWeapons());
    Object.assign(weaponGroups, words.groups);
    const mob = ngeMob(c, { stat: (l) => reader.statAt(l), weaponTemplates: () => Object.values(words.groups).flat() });
    const game = gameOf(mob, entryById.get(j.id));
    if (game) withGame++;
    creaturesOut[name] = creatureRecord(c, j, mob, game, words.names);
  }
  const bodiless = joined.bodiless();
  const sum = (k) => Object.values(zoneIndex).reduce((s, z) => s + (z[k] ?? 0), 0);
  const counts = { rows: sum('rows'), statics: sum('statics'), corpses: sum('corpses'), crew: sum('crew'), spawners: sum('spawners'), patrols: sum('patrols'), sites: sum('sites'), areas: sum('areas'), creatures: Object.keys(creaturesOut).length, withGame, lairs: Object.keys(lairs).length, groups: Object.keys(groups).length, unresolved: unresolved.size + bodiless.length, gated: sum('gated'), dropped: sum('dropped'), routeLost: sum('routeLost'), crewLost: sum('crewLost'), noBody: sum('noBody'), noRoom: sum('noRoom'), inCell: sum('inCell'), crewTablesLeft: crewLeft };
  const manifest = { format: SPAWNS_FORMAT, local, source: 'nge', converted, counts, creatures: creaturesOut, lairs, groups, nests: {}, camps: {}, campModels: {}, dressGroups: {}, weaponGroups };
  const id = reader.identity();
  const index = {
    format: NGE_FORMAT,
    local,
    source: 'nge',
    note: local
      ? "SOE's own placements for Kashyyyk and Mustafar, read from a live copy of SOE's server data at conversion time (spawns --nge=<folder>)."
      : "SOE's own placements for Kashyyyk and Mustafar, read from the reference beside the converter (tools/swg/ngeref), which every converter reads by default.",
    converted,
    copy: { root: reader.roots.root, kind: reader.roots.kind, files: id.files, sha1: id.sha1 },
    catalogue: { converted: catalogue?.converted ?? null, entries: catalogue?.entries?.length ?? 0 },
    counts,
    zones: zoneIndex,
    gated,
    unresolved: [...unresolved].sort(),
    bodiless,
  };
  return { index, manifest, packs };
}

// --------------------------------------------------------------------------------------- the guards

/**
 * The `--nge=<folder>` word, read off the raw command line rather than out of the options the cli splits at
 * every `=` (a path holding one would be cut), and never from `.env`: a value written `@NAME` is refused, since
 * the cli would otherwise put `.env`'s value in its place. Null when there is no such word.
 */
export function ngeArg(argv) {
  for (const w of argv ?? []) {
    if (w === '--nge') return { refuse: 'name the folder: --nge=<the NGE copy> (or --nge=none to leave SOE\'s people for Kashyyyk and Mustafar out; with no --nge the reference beside the converter is read)' };
    if (!String(w).startsWith('--nge=')) continue;
    const value = String(w).slice('--nge='.length);
    if (!value) return { refuse: 'name the folder: --nge=<the NGE copy>' };
    if (value.startsWith('@')) return { refuse: `--nge=${value}: name the folder outright; the NGE copy is never read from .env` };
    return { value };
  }
  return null;
}

/**
 * Where an overlay read from a live copy is written: `<out>/nge`, and only where git ignores it (`ignored`) or it
 * is outside the repository altogether (`outside`); a folder git would take (`tracked`) is refused, since a
 * converted pack is never committed. `ignoredOf(path)` is the cli's `git check-ignore`, handed in.
 */
export function overlayTarget(out, ignoredOf) {
  const dir = `${String(out).replace(/[\\/]+$/, '')}/nge`;
  const says = ignoredOf(dir);
  if (says === 'ignored' || says === 'outside') return { dir };
  return { refuse: `${dir} is not ignored by git, and a converted pack is never committed: write the overlay into the git-ignored assets-private` };
}

/** Whether the NGE copy named is inside this repository, which is refused: the copy is read where it stands and never brought into it. */
export function sourceInside(src, repo) {
  const rel = relative(repo, src);
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * The index `spawns --nge=none` leaves in place of an overlay: SOE's people for Kashyyyk and Mustafar left out by
 * choice, which the game reads as no world listed and `status` as a choice not to ask about again.
 */
export function noneIndex(converted) {
  return { format: NGE_FORMAT, source: 'nge', none: true, note: "SOE's own people for Kashyyyk and Mustafar left out by choice (spawns --nge=none); spawns without it stands them.", converted, zones: {} };
}

/** The command that stands SOE's people again from the reference: the one a launcher runs. */
const REF_COMMAND = 'spawns <out-dir> --swg=<swg-dir> --retail-only';

/**
 * What `status` says of SOE's own people for Kashyyyk and Mustafar, from the index the last `spawns` wrote and what
 * stands now (`now`: the catalogue's `converted`; `layouts`, each zone's layout stamp where its pack is converted
 * and null where it is not; and `reference`, the reference beside the converter, `{ sha1 }`, or null where this
 * checkout or release lost it). Null where there is nothing to say: no index and no zone converted.
 *
 * `ask` is the run to make again and why. Where the people came from the reference -- or are not there at all --
 * it is `need`, a step on the to-do list a launcher runs, since every converter reads the reference by default:
 * asked while no index lists them, while the index is older, was made from another reference, joined another
 * catalogue or other layouts, or misses a zone converted since; never on a file's being there alone. An overlay
 * the owner read from a live copy (`--nge=<folder>`) is asked again by hand only, with that folder, since no
 * launcher ever names one; and one left out by choice (`--nge=none`) is not asked about at all.
 */
export function ngeStatus(index, now) {
  const layouts = now?.layouts ?? {};
  const converted = Object.keys(layouts).filter((z) => layouts[z] !== null && layouts[z] !== undefined);
  const ref = now?.reference ?? null;
  if (!index) {
    if (!converted.length) return null;
    if (!ref) return { line: `  nge: ${converted.join(', ')} converted, and the reference of SOE's own people (tools/swg/ngeref) is missing: they stand nobody`, ask: null };
    return { line: `  nge: SOE's own people for ${converted.join(', ')} are not in the packs (the reference beside the converter is ${ref.sha1})`, ask: { need: true, command: REF_COMMAND, why: `SOE's own people for Kashyyyk and Mustafar (${converted.join(', ')}) are not in the packs (nge/index.json); the reference beside the converter is ${ref.sha1}` } };
  }
  if (index.none) return { line: "  nge: SOE's own people for Kashyyyk and Mustafar left out by choice (spawns --nge=none); spawns without it stands them", ask: null };
  const zones = Object.keys(index.zones ?? {});
  const people = zones.reduce((s, z) => s + (index.zones[z].rows ?? 0), 0);
  const areas = zones.reduce((s, z) => s + (index.zones[z].areas ?? 0), 0);
  const when = String(index.converted ?? '').slice(0, 10) || '?';
  const fromRef = index.copy?.kind === 'reference';
  const line = fromRef
    ? `  nge: SOE's own people for ${zones.join(', ') || 'no zone'}: ${people} people, ${areas} wild areas, from the reference ${index.copy?.sha1 ?? '?'}${ref && ref.sha1 !== index.copy?.sha1 ? ` (the reference beside the converter is ${ref.sha1})` : ''}, ${when}`
    : `  nge: SOE's own people for ${zones.join(', ') || 'no zone'}: ${people} people, ${areas} wild areas, read from a live copy at ${index.copy?.root ?? '?'} (--nge), ${when}`;
  let why = null;
  if (!(index.format >= NGE_FORMAT)) why = 'they are from an older converter';
  else if (fromRef && ref && ref.sha1 !== index.copy?.sha1) why = 'the reference beside the converter changed since';
  else if ((now?.catalogue ?? null) !== (index.catalogue?.converted ?? null)) why = 'the mobiles catalogue was converted again since, and the bodies may join differently';
  else {
    const moved = zones.filter((z) => (layouts[z] ?? null) !== (index.zones[z].layout ?? null));
    const added = converted.filter((z) => !zones.includes(z));
    if (moved.length) why = `the layout of ${moved.join(', ')} moved since`;
    else if (fromRef && added.length) why = `${added.join(', ')} was converted since and has none`;
  }
  if (!why) return { line, ask: null };
  // An overlay from before the reference (W3's, a copy's) is stood again from the reference by default too: a
  // copy's root is named only for an index that says it came from one.
  if (fromRef || !index.copy?.root || !(index.format >= NGE_FORMAT)) return { line, ask: { need: !!ref, command: REF_COMMAND, why } };
  return { line, ask: { need: false, command: `spawns <out-dir> --swg=<swg-dir> --nge=${index.copy.root} --retail-only`, why } };
}

/** A file's stamp, as the index records each zone's layout: the first twelve hex of its bytes' SHA-1. */
export function stampOf(buf) {
  return createHash('sha1').update(buf).digest('hex').slice(0, 12);
}
