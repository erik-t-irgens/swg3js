// SOE's own people for Kashyyyk and Mustafar, kept as a file of our own beside the converter: the rows every
// player's `spawns` stands them from, read by default, as `core3ref/` is for Core3's.
//
// **Why it is in the repository.** Core3 places nobody on Kashyyyk's seven zones or on Mustafar; SOE's own server
// data does, and the owner keeps a copy of it. By his decision of 2026-10-19 the data every client needs and no
// client has -- which creature stands where, facing which way, how many, over which areas, in which rooms -- is
// committed and ships to every player, so everyone who converts gets the same people; the game's content (models,
// textures, sounds, strings) never is, and nothing of the copy's code or text is. So this folder holds only the
// fields `spawns` reads out of the copy (`ngepack.mjs` says what each is for), as names, numbers and places: no
// script, no row of a table it does not read, no quest, no conversation, no loot.
//
// **How it is made.** `npm run swg -- nge-reference <the copy>` reads the copy with the very reader `--nge=<folder>`
// uses (`nge.mjs`), keeps what the overlay asks of it (`extractNgeReference`), builds the overlay twice over the
// converted packs on this machine -- once from a fresh read of the copy and once from the reference just written,
// read back through the reader every converter uses (`ngeRefReader`) -- and keeps the reference only when the two
// agree in every row, name, count and number. Run it when the copy changes, and commit what it writes.
//
// What the reference cannot carry it records: the copy's placed objects are read only to measure that its rows are
// in the snapshot's frame, so that measurement is made once here and written into the index (`frames`), and the
// thousands of objects themselves are left behind.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { differs } from './core3ref.mjs';
import { CREW_HOSTS, NGE_ZONES, crewsOf, kindOf, rowIds, templateStem } from './ngepack.mjs';

/** Bumped when the shape of the reference's files changes in a way its reader must know about. */
export const NGE_REF_FORMAT = 1;

/** Where the reference lives: in the checkout, and in every release beside the converter. */
export const NGE_REF_DIR = fileURLToPath(new URL('./ngeref/', import.meta.url));

/** A buildout row's kind as one letter, and back. */
const LETTER = { area: 'a', patrol: 'p', static: 's', corpse: 'c', gated: 'g', waypoint: 'w', other: 'o' };
const KIND = Object.fromEntries(Object.entries(LETTER).map(([k, v]) => [v, k]));

/** The objvars a row of each kind is read for (`zoneOverlay`), and the one any row may carry for a crew (`crewsOf`). */
const SPAWNER_VARS = ['strSpawns', 'fltRadius', 'intSpawnCount', 'intDefaultBehavior', 'fltMinSpawnTime', 'fltMaxSpawnTime'];
const VARS = { a: SPAWNER_VARS, p: [...SPAWNER_VARS, 'strPatrolPointNames'], s: ['spawns'], c: ['spawns'], w: ['pointName', 'strName'], g: [], o: [] };

/** The creature columns the overlay reads (`nge.mjs`'s own list), written once in the index and each creature a row of them. */
export const CREATURE_COLUMNS = ['creatureName', 'BaseLevel', 'difficultyClass', 'template', 'aggressive', 'invulnerable', 'herd', 'stalker', 'death_blow', 'primary_weapon', 'primary_weapon_speed', 'secondary_weapon', 'socialGroup', 'pvpFaction', 'niche'];
/** The stat table's columns the overlay reads (`ngeMob`), at a level. */
export const STAT_COLUMNS = ['Level', 'HP', 'damagePerSecond', 'Elite_HP', 'Elite_damagePerSecond', 'Boss_HP', 'Boss_damagePerSecond'];
/** A spawn list's columns (`regionAreas`), and a lair's. */
const LIST_COLUMNS = ['strLairType', 'intWeighting', 'intNumToSpawn', 'intSize', 'intSpawnLimit', 'intMinDifficulty', 'intMaxDifficulty'];
const LAIR_COLUMNS = ['mobiles', 'spawnLimit'];
/** A region's columns (`regionShape`, `regionAreas`), its name kept as `regionName` reads it. */
const REGION_COLUMNS = ['regionName', 'geometry', 'minX_or_centerX', 'minZ_or_centerZ', 'maxX_or_radius', 'maxZ', 'spawnableType'];

/** The buildings a crew of ours stands in, by their template's file name: a row of theirs is kept for `crewsOf`. */
const HOSTS = new Set(Object.values(CREW_HOSTS));

/** A server template's name as `sharedTemplate` keys it (`nge.mjs`). */
function templateKey(template) {
  return String(template ?? '').replace(/\\/g, '/').replace(/^object\/mobile\//, '').replace(/\.iff$/i, '');
}

/** A number as a row carries it: what `Number(x) || 0` makes of the table's text. */
function num(v) {
  return Number(v) || 0;
}

/** A quaternion as a row carries it, every part a number JSON can hold. */
function quat(r) {
  const q = [Number(r.qw), Number(r.qx), Number(r.qy), Number(r.qz)];
  if (!q.every(Number.isFinite)) throw new Error(`a turn that is not four numbers (${q.join(', ')})`);
  return q;
}

/** The text a cell holds, or '' for none. */
const text = (v) => (v === undefined || v === null ? '' : String(v));

/**
 * One buildout row as the reference keeps it, or null where nothing the overlay does reads it: `i` its name in its
 * table (`rowIds`, a number where it is an objid), `k` its kind's letter, `c` 1 in a room, `t` its template's file
 * name where a count or a crew reads it, `p` its place and `q` its turn where a row stands somebody there, `o` the
 * objvars read for its kind. A placed object that is no crew's building is left out: only the frame check read
 * those, and that is recorded once in the index.
 */
export function referenceRow(r, id) {
  const kind = kindOf(r.server_template_crc, r.scripts, r.objvars);
  const inCell = (Number(r.container) || 0) !== 0 || (Number(r.cell_index) || 0) !== 0;
  const stem = templateStem(r.server_template_crc);
  const crew = HOSTS.has(stem) || r.objvars.has('spawn_table');
  if (kind === 'other' && !crew) return null;
  if (kind === 'waypoint' && inCell) return null;
  const k = LETTER[kind];
  // An objid is kept as a number only where a number holds it exactly; anything else stays the text it is.
  const out = { i: /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && String(Number(id)) === id ? Number(id) : id, k };
  if (inCell) out.c = 1;
  if (kind === 'gated' || crew) out.t = stem;
  if (!inCell && kind !== 'other' && kind !== 'gated') out.p = [num(r.px), num(r.py), num(r.pz)];
  if (!inCell && (kind === 'static' || kind === 'corpse')) out.q = quat(r);
  // The objvars its kind is read for, in `VARS`' order, null where the row has none: a number kept as one (`ov`
  // reads it with `Number`, and an empty cell as none), a patrol's points as a list (`patrolNames` splits them so),
  // and every other value as the text it is.
  if (!inCell && VARS[k].length) {
    const o = VARS[k].map((name) => {
      if (!r.objvars.has(name)) return null;
      const v = text(r.objvars.get(name).value);
      if (NUMBER_VARS.has(name) && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
      if (name === 'strPatrolPointNames') return v.split(/[:,]/).map((s) => s.trim()).filter(Boolean);
      return v;
    });
    while (o.length && o[o.length - 1] === null) o.pop();
    if (o.length) out.o = o;
  }
  if (r.objvars.has('spawn_table')) out.st = text(r.objvars.get('spawn_table').value);
  return out;
}

/** The objvars `ov` reads as numbers. */
const NUMBER_VARS = new Set(['fltRadius', 'intSpawnCount', 'intDefaultBehavior', 'fltMinSpawnTime', 'fltMaxSpawnTime']);

/** A reference row as the reader hands it to `zoneOverlay` and `crewsOf`: the shape `nge.mjs` reads a table into. */
function rowOut(r) {
  const p = r.p ?? [0, 0, 0];
  const q = r.q ?? [1, 0, 0, 0];
  const vars = new Map();
  (r.o ?? []).forEach((value, i) => {
    if (value !== null) vars.set(VARS[r.k][i], { type: '', value: Array.isArray(value) ? value.join(':') : String(value) });
  });
  if (r.st !== undefined) vars.set('spawn_table', { type: '', value: r.st });
  return {
    objid: 0,
    container: r.c ? 1 : 0,
    cell_index: 0,
    server_template_crc: r.t ?? '',
    px: p[0],
    py: p[1],
    pz: p[2],
    qw: q[0],
    qx: q[1],
    qy: q[2],
    qz: q[3],
    scripts: [],
    objvars: vars,
    said: '',
    id: String(r.i),
    kind: KIND[r.k],
  };
}

/**
 * Everything the overlay asks of the copy, out of a reader over it (`makeNgeReader`), as the reference's files: a
 * file per zone (its area rows, every area table's rows it reads, its regions and spawn lists) and one of tables
 * every zone shares (the creatures, type tables, shared templates, dress lists, stats, weapons, lairs and crews the
 * zones name, and no other). It asks the copy for exactly what `buildNgeOverlay` can ask of it, so nothing it keeps
 * depends on which packs are converted on this machine.
 */
export function extractNgeReference(reader, zones = NGE_ZONES) {
  const creatures = reader.creatures();
  const isCreature = (n) => creatures.has(String(n ?? '').trim());
  const wantCreature = new Set();
  const wantType = new Set();
  const person = (name) => {
    const n = String(name ?? '').trim();
    if (!n || n.startsWith('object/')) return;
    if (isCreature(n)) wantCreature.add(n);
    else wantType.add(n);
  };
  const lairNames = new Set();
  const crewTables = new Set();
  const zoneFiles = {};
  const counts = {};
  for (const zone of zones) {
    const areaRows = reader.areas(zone) ?? [];
    const areas = areaRows.map((a) => ({ area: text(a.area), x1: text(a.x1), z1: text(a.z1), eventRequired: text(a.eventRequired) }));
    const buildouts = {};
    const raw = new Map();
    const kinds = {};
    for (const a of areaRows) {
      const name = text(a.area);
      if (!name || raw.has(name)) continue;
      const table = reader.buildout(zone, name);
      raw.set(name, table);
      if (!table) continue;
      const ids = rowIds(table);
      const rows = [];
      table.forEach((r, i) => {
        const kept = referenceRow(r, ids[i]);
        if (!kept) return;
        rows.push(kept);
        kinds[kept.k] = (kinds[kept.k] ?? 0) + 1;
        // Who it stands: the first objvar of a spawner and of a static (`VARS`).
        const who = kept.o?.[0];
        if ((kept.k === 'a' || kept.k === 'p') && typeof who === 'string') person(who);
        if ((kept.k === 's' || kept.k === 'c') && typeof who === 'string' && isCreature(who)) wantCreature.add(who.trim());
      });
      buildouts[name] = rows;
    }
    // The crews the zone's areas name, read off every area a copy of which stands (an event's alone stands nobody).
    const all = [];
    for (const name of new Set(areaRows.filter((a) => a.area && !a.eventRequired).map((a) => text(a.area)))) all.push(...(raw.get(name) ?? []));
    for (const c of crewsOf(all)) crewTables.add(c.table);
    // Every region a grid reads (a spawn region with a list of its own name, or one where nothing may stand): one
    // of any other kind, or with no shape, is read for nothing.
    const regionRows = reader.regions(zone) ?? [];
    const spawnable = regionRows.some((r) => String(r.spawnableType ?? '').trim() === 'spawnTrue');
    const lists = spawnable ? reader.spawnLists(zone) : new Map();
    const regions = [];
    const listsOut = {};
    for (const r of regionRows) {
      const type = String(r.spawnableType ?? '').trim() || 'spawnFalse';
      const name = String(r.regionName ?? '').replace(/^@[^:]*:/, '').trim().toLowerCase();
      if (type !== 'spawnFalse' && !(type === 'spawnTrue' && lists.has(name))) continue;
      regions.push(REGION_COLUMNS.map((c) => (c === 'regionName' ? name : text(r[c]))));
      if (type === 'spawnTrue' && !listsOut[name]) {
        listsOut[name] = lists.get(name).map((row) => LIST_COLUMNS.map((c) => text(row[c])));
        for (const row of lists.get(name)) {
          const lair = String(row.strLairType ?? '').trim();
          if (lair) lairNames.add(lair);
        }
      }
    }
    zoneFiles[zone] = { zone, areas, buildouts, regions, lists: listsOut };
    counts[zone] = { areas: areas.length, tables: Object.keys(buildouts).length, rows: Object.values(buildouts).reduce((s, r) => s + r.length, 0), kinds, regions: regions.length, lists: Object.keys(listsOut).length };
  }
  // The crews every zone names, by table: the people of each, and a row that stands nobody kept as nobody.
  const crews = {};
  for (const table of [...crewTables].sort()) {
    const rows = reader.crew(table);
    if (!rows) continue;
    crews[table] = rows.map((r) => {
      const who = String(r.spawns ?? '').trim();
      if (!who || who.startsWith('object/')) return [''];
      person(who);
      return [r.spawns, r.room, r.x, r.y, r.z, r.yaw, r.mood, r.respawn];
    });
  }
  // The type tables named, flattened as the reader flattens them, and their creatures.
  const types = {};
  for (const name of [...wantType].sort()) {
    const list = reader.typeTable(name, isCreature);
    if (!list?.length) continue;
    types[name] = list;
    for (const c of list) wantCreature.add(c);
  }
  // The lairs the spawn lists name, and their creatures.
  const lairs = {};
  for (const name of [...lairNames].sort()) {
    const rows = reader.lair(name);
    if (!rows) continue;
    lairs[basename(name)] = rows.map((m) => LAIR_COLUMNS.map((c) => text(m[c])));
    for (const m of rows) if (isCreature(m.mobiles)) wantCreature.add(String(m.mobiles).trim());
  }
  // Each creature, its body's templates as its server template names them, its dress list, its level's stats and
  // its weapons' lists.
  const creaturesOut = {};
  const shared = {};
  const dress = {};
  const stats = {};
  const weapons = {};
  const dressLists = reader.dressLists();
  const ai = reader.aiWeapons();
  const sharedOf = (t) => {
    const key = templateKey(t);
    if (Object.prototype.hasOwnProperty.call(shared, key)) return;
    const got = reader.sharedTemplate(t);
    shared[key] = got ?? null;
  };
  for (const name of [...wantCreature].sort()) {
    const c = creatures.get(name);
    if (!c) continue;
    creaturesOut[name] = CREATURE_COLUMNS.slice(1).map((col) => text(c[col]));
    const t = String(c.template ?? '').trim();
    if (/\.iff$/i.test(t)) sharedOf(t);
    else if (dressLists.has(t)) {
      dress[t] = dressLists.get(t);
      for (const x of dressLists.get(t)) sharedOf(/\.iff$/i.test(x) ? x : `${x}.iff`);
    }
    const level = Math.max(1, Math.trunc(Number(c.BaseLevel) || 1));
    if (!Object.prototype.hasOwnProperty.call(stats, level)) {
      const s = reader.statAt(level);
      stats[level] = s ? STAT_COLUMNS.map((col) => num(s[col])) : null;
    }
    for (const w of [c.primary_weapon, c.secondary_weapon]) {
      const word = String(w ?? '').trim();
      if (word && ai.has(word)) weapons[word] = ai.get(word);
    }
  }
  // A shared template the copy has no `.tpf` for is read as the plain rule's: nothing to keep.
  for (const k of Object.keys(shared)) if (shared[k] === null) delete shared[k];
  const tables = { creatures: creaturesOut, types, shared, dress, stats, weapons, lairs, crews };
  const sizes = { creatures: Object.keys(creaturesOut).length, types: Object.keys(types).length, shared: Object.keys(shared).length, dress: Object.keys(dress).length, stats: Object.keys(stats).length, weapons: Object.keys(weapons).length, lairs: Object.keys(lairs).length, crews: Object.keys(crews).length };
  return { zones: zoneFiles, tables, counts: { zones: counts, tables: sizes } };
}

/**
 * A SHA-1 over each file's name and text, sixteen hex: the reference's identity, which `status` and the packs compare.
 * Every line ending is folded to LF first, as the final names list's key is (`finalNamesKey`): the files are written
 * with LF, and a checkout whose git turns them into CRLF (`core.autocrlf`, which the owner's checkouts have) holds the
 * same reference, which must keep the same identity.
 */
export function referenceHash(files) {
  const h = createHash('sha1');
  for (const name of Object.keys(files).sort()) h.update(`${name}\u0000${createHash('sha1').update(String(files[name]).replace(/\r\n/g, '\n')).digest('hex')}\n`);
  return h.digest('hex').slice(0, 16);
}

/** The reference's files as text: one per zone and the shared tables, each a line of JSON. */
export function referenceFiles(extracted) {
  const files = { 'tables.json': `${JSON.stringify(extracted.tables)}\n` };
  for (const [zone, z] of Object.entries(extracted.zones)) files[`${zone}.json`] = `${JSON.stringify(z)}\n`;
  return files;
}

/** The reference's own index, read, or null where there is none. */
export function readReferenceIndex(dir = NGE_REF_DIR) {
  try {
    return JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * A reader over the reference, answering every question the overlay asks the copy (`makeNgeReader`'s methods) out of
 * the files in `dir`, or null where there is no reference there. Every answer is a fresh object, since the overlay
 * spreads what it is handed into rows of its own. `roots.kind` is `reference`, and `identity` the reference's own
 * hash, which every pack converted from it records.
 */
export function ngeRefReader(dir = NGE_REF_DIR) {
  const index = readReferenceIndex(dir);
  if (!index || !index.files) return null;
  const read = (file) => {
    const p = join(dir, file);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  };
  const tables = read(index.files.tables);
  if (!tables) return null;
  const zones = new Map();
  const zoneOf = (zone) => {
    if (!zones.has(zone)) zones.set(zone, index.files.zones?.[zone] ? read(index.files.zones[zone]) : null);
    return zones.get(zone);
  };
  const cols = index.creatureColumns ?? CREATURE_COLUMNS;
  const statCols = index.statColumns ?? STAT_COLUMNS;
  let creatures = null;
  return {
    roots: { root: 'tools/swg/ngeref', kind: 'reference' },
    index,
    identity: () => ({ files: Object.keys(index.files.zones ?? {}).length + 1, sha1: index.sha1 }),
    areas: (zone) => (zoneOf(zone)?.areas ?? null)?.map((a) => ({ ...a })) ?? null,
    buildout: (zone, area) => {
      const rows = zoneOf(zone)?.buildouts?.[area];
      return rows ? rows.map(rowOut) : null;
    },
    typeTable: (name) => {
      const list = tables.types[String(name ?? '').trim()];
      return list ? [...list] : null;
    },
    creatures: () => {
      if (!creatures) {
        creatures = new Map();
        for (const [name, row] of Object.entries(tables.creatures)) {
          const c = { [cols[0]]: name };
          cols.slice(1).forEach((col, i) => (c[col] = row[i]));
          creatures.set(name, c);
        }
      }
      return creatures;
    },
    sharedTemplate: (template) => tables.shared[templateKey(template)] ?? null,
    dressLists: () => new Map(Object.entries(tables.dress).map(([k, v]) => [k, [...v]])),
    statAt: (level) => {
      const row = tables.stats[level];
      return row ? Object.fromEntries(statCols.map((col, i) => [col, row[i]])) : null;
    },
    aiWeapons: () => new Map(Object.entries(tables.weapons).map(([k, v]) => [k, [...v]])),
    regions: (zone) => (zoneOf(zone)?.regions ?? []).map((r) => Object.fromEntries(REGION_COLUMNS.map((col, i) => [col, r[i]]))),
    spawnLists: (zone) => new Map(Object.entries(zoneOf(zone)?.lists ?? {}).map(([name, rows]) => [name, rows.map((r) => Object.fromEntries(LIST_COLUMNS.map((col, i) => [col, r[i]])))])),
    lair: (name) => {
      const rows = tables.lairs[basename(String(name))];
      return rows ? rows.map((r) => Object.fromEntries(LAIR_COLUMNS.map((col, i) => [col, r[i]]))) : null;
    },
    crew: (table) => {
      const rows = tables.crews[table];
      if (!rows) return null;
      return rows.map((r) => (r.length === 1 ? { spawns: '', room: '', x: 0, y: 0, z: 0, yaw: 0, mood: '', respawn: 0 } : { spawns: r[0], room: r[1], x: r[2], y: r[3], z: r[4], yaw: r[5], mood: r[6], respawn: r[7] }));
    },
    /** The frame check made when the reference was written, which the reference keeps in place of the objects it measured. */
    frameOf: (zone) => index.frames?.[zone] ?? null,
  };
}

/** A built overlay as two sources must agree on it: the identity of where it came from, and when, left out. */
export function comparable(built) {
  const strip = (o) => {
    const { local: _l, converted: _c, note: _n, copy: _p, ...rest } = o ?? {};
    return rest;
  };
  return { index: strip(built.index), manifest: strip(built.manifest), packs: Object.fromEntries(Object.entries(built.packs).map(([z, p]) => [z, strip(p)])) };
}

/**
 * Write the reference from a copy, checked. `reader` and `fresh` are two readers over the copy (the second never
 * asked anything before the comparison, so a reader that hands back the same object twice cannot make it trivially
 * true); `build(reader, archives)` builds the overlay over this machine's converted packs, with the archives or
 * without; `modes` the ways it is built and compared. The frames the copy's own build measured are kept in the
 * index; the files are written to a folder of their own first, read back through `ngeRefReader`, and built again;
 * only when every mode's two builds agree is anything written over the old reference.
 */
export function writeNgeReference({ reader, fresh, build, modes = [false], zones = NGE_ZONES, outDir = NGE_REF_DIR, made = new Date().toISOString(), log = () => {} }) {
  const extracted = extractNgeReference(reader, zones);
  const first = build(reader, modes[0]);
  const frames = {};
  for (const [zone, z] of Object.entries(first.index.zones)) frames[zone] = z.frame?.objects ?? null;
  const missing = zones.filter((z) => !first.packs[z]);
  if (missing.length) throw new Error(`not every zone is converted on this machine (${missing.join(', ')}), so the reference cannot be checked against them; convert them first`);
  const files = referenceFiles(extracted);
  const sha1 = referenceHash(files);
  const id = reader.identity();
  const index = {
    format: NGE_REF_FORMAT,
    note: "SOE's own server data for Kashyyyk and Mustafar: which creature stands where, facing which way, how many, over which areas and in which rooms, as names, numbers and places only. Committed and shipped to every player by the owner's decision of 2026-10-19; no model, texture, sound, string, script or quest of the game's. Written by `npm run swg -- nge-reference <the copy>`, every answer compared with a fresh read of the copy before it was kept.",
    made,
    sha1,
    source: { kind: reader.roots.kind, files: id.files, sha1: id.sha1 },
    zones,
    files: { tables: 'tables.json', zones: Object.fromEntries(zones.map((z) => [z, `${z}.json`])) },
    creatureColumns: CREATURE_COLUMNS,
    statColumns: STAT_COLUMNS,
    frames,
    // What the overlay built over this machine's packs came to, with the crews' rows that stand nobody (an object,
    // or a name that is no creature and no table: `things`), which its own counts leave to each zone.
    counts: { ...extracted.counts, overlay: { ...first.index.counts, things: Object.values(first.index.zones).reduce((s, z) => s + (z.things ?? 0), 0) } },
  };
  // Written to a folder of its own and read back as every converter reads it, then built again and compared.
  const staging = `${outDir.replace(/[\\/]+$/, '')}.new`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const [name, t] of Object.entries(files)) writeFileSync(join(staging, name), t);
  writeFileSync(join(staging, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
  try {
    const ref = ngeRefReader(staging);
    if (!ref) throw new Error('the reference written could not be read back');
    for (const mode of modes) {
      const a = comparable(build(fresh, mode));
      const b = comparable(build(ref, mode));
      const d = differs(a, b);
      if (d) throw new Error(`the reference would stand ${mode ? 'with the archives' : 'without the archives'} otherwise than the copy does (${d}); nothing was written`);
      log(`  ${mode ? 'with the archives' : 'without the archives'}: ${a.index.counts.rows} people, ${a.index.counts.areas} wild areas, ${a.index.counts.creatures} creatures, the same from the copy and from the reference`);
    }
    mkdirSync(outDir, { recursive: true });
    for (const name of readdirSync(outDir)) if (name.endsWith('.json') && !Object.prototype.hasOwnProperty.call(files, name) && name !== 'index.json') rmSync(join(outDir, name));
    for (const [name, t] of Object.entries(files)) writeFileSync(join(outDir, name), t);
    writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return { index, bytes: Object.values(files).reduce((s, t) => s + Buffer.byteLength(t), 0) };
}
