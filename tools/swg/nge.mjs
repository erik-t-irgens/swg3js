// The NGE copy's reader: SOE's own server tables, read off the owner's local copy at conversion time, into
// `assets-private/nge/` only (`spawns --nge=<folder>`; the rules are `ngepack.mjs`, which says what all of it is).
//
// It reads data and never code: the tables (`.tab`, tab-separated text with a row of column names and a row of
// types) and, of a mobile's server template (`.tpf`), the one line that names its client body. Quest scripts,
// loot, conversations and text are never opened. Every file it reads is remembered by name and by its bytes'
// hash, so the index can say exactly which copy the overlay came from.
//
// Three roots are taken: the copy's checkout (the folder holding `dsrc`), its `dsrc`, or a server datatables
// folder itself. The tables live under `sku.0/sys.server/compiled/game/datatables` and the zones' area tables
// under `sku.0/sys.shared/compiled/game/datatables`; an extracted import of SOE's own original tree has the very
// same layout and is read the same way.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

const SKU = ['sku.0'];
const SERVER = [...SKU, 'sys.server', 'compiled', 'game'];
const SHARED = [...SKU, 'sys.shared', 'compiled', 'game'];

/** The folders the reader works in, or null where `dir` is none of the three roots it takes. */
export function ngeRoots(dir) {
  const root = resolve(dir);
  const under = (base, kind) => {
    const server = join(base, ...SERVER, 'datatables');
    if (!existsSync(join(server, 'buildout'))) return null;
    const shared = join(base, ...SHARED, 'datatables');
    const mobiles = join(base, ...SERVER, 'object', 'mobile');
    return { root, kind, server, shared: existsSync(shared) ? shared : null, mobiles: existsSync(mobiles) ? mobiles : null };
  };
  const found = under(join(root, 'dsrc'), 'checkout') ?? under(root, 'dsrc');
  if (found) return found;
  if (existsSync(join(root, 'buildout')) && existsSync(join(root, 'mob'))) {
    // A server datatables folder: its shared twin and its templates sit where the tree puts them, if they are there.
    const shared = resolve(root, '..', '..', '..', 'sys.shared', 'compiled', 'game', 'datatables');
    const mobiles = resolve(root, '..', 'object', 'mobile');
    return { root, kind: 'datatables', server: root, shared: existsSync(shared) ? shared : null, mobiles: existsSync(mobiles) ? mobiles : null };
  }
  return null;
}

/**
 * One column's type as the table writes it in its second row (`i[-1]`, `s[none]`, `e(a=0,b=1)[a]`, quoted or
 * not): the default an empty cell takes, if it has one, and an enum's names by number.
 */
export function columnType(spec) {
  const s = String(spec ?? '').trim().replace(/^"|"$/g, '');
  const m = /\[([^\]]*)\]\s*$/.exec(s);
  const def = m && m[1] !== 'required' ? m[1] : undefined;
  const e = /^e\(([^)]*)\)/.exec(s);
  let names = null;
  if (e) {
    names = new Map();
    for (const part of e[1].split(',')) {
      const [name, n] = part.split('=');
      if (name && n !== undefined) names.set(String(Number(n)), name.trim());
    }
  }
  return { def, names };
}

/**
 * A `.tab` table's text as `{ columns, rows }`, each row an object by column name, an empty cell taking its
 * column's default and an enum written as its number read as its name.
 */
export function parseTab(text) {
  const lines = String(text).split(/\r?\n/);
  const columns = (lines[0] ?? '').split('\t');
  const types = (lines[1] ?? '').split('\t').map(columnType);
  const rows = [];
  for (const line of lines.slice(2)) {
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const row = {};
    columns.forEach((c, i) => {
      let v = cells[i] ?? '';
      const t = types[i];
      if (v === '' && t?.def !== undefined) v = t.def;
      else if (t?.names && t.names.has(v.trim())) v = t.names.get(v.trim());
      row[c] = v;
    });
    rows.push(row);
  }
  return { columns, rows };
}

/** A buildout row's objvars, `name|type|value` triples ended by `$`, as a Map of name to `{ type, value }`. */
export function parseObjvars(text) {
  const parts = String(text ?? '').split('|');
  const out = new Map();
  for (let i = 0; i + 2 < parts.length; i += 3) {
    if (parts[i] === '$' || parts[i] === '') break;
    out.set(parts[i], { type: parts[i + 1], value: parts[i + 2] });
  }
  return out;
}

/** A buildout row's scripts, `:` or `,` apart. */
export function parseScripts(text) {
  return String(text ?? '').split(/[,:]/).map((s) => s.trim()).filter(Boolean);
}

/** Every `.tab` under a folder, by its path relative to the folder with `/` and no extension. */
function tablesUnder(dir, base = dir, out = new Map()) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tablesUnder(p, base, out);
    else if (e.name.endsWith('.tab')) out.set(relative(base, p).replace(/\\/g, '/').replace(/\.tab$/, ''), p);
  }
  return out;
}

/**
 * The reader over one copy, or null where `dir` is no root it takes. Each table is read once and kept; every
 * file read joins the copy's identity (`digest`).
 */
export function makeNgeReader(dir) {
  const roots = ngeRoots(dir);
  if (!roots) return null;
  const seen = new Map();
  const cache = new Map();
  const bytes = (abs) => {
    const buf = readFileSync(abs);
    seen.set(relative(roots.root, abs).replace(/\\/g, '/'), createHash('sha1').update(buf).digest('hex'));
    return buf;
  };
  const tab = (abs) => {
    if (cache.has(abs)) return cache.get(abs);
    const t = abs && existsSync(abs) && statSync(abs).isFile() ? parseTab(bytes(abs).toString('latin1')) : null;
    cache.set(abs, t);
    return t;
  };
  const server = (...p) => join(roots.server, ...p);
  let types = null;
  const typeIndex = () => {
    if (types) return types;
    types = { byPath: tablesUnder(server('spawning', 'ground_spawning', 'types')), byStem: new Map() };
    for (const [rel, abs] of types.byPath) {
      const stem = rel.split('/').pop();
      if (!types.byStem.has(stem)) types.byStem.set(stem, abs);
    }
    return types;
  };
  let creatures = null;
  const sharedTemplates = new Map();
  let dress = null;
  let stats = null;
  let weapons = null;

  return {
    roots,
    /** How many files were read, and a SHA-1 over their names and bytes: which copy the overlay came from. */
    identity() {
      const names = [...seen.keys()].sort();
      const h = createHash('sha1');
      for (const n of names) h.update(`${n}\u0000${seen.get(n)}\n`);
      return { files: names.length, sha1: h.digest('hex').slice(0, 16) };
    },
    /** A zone's area rows from the copy's shared table (`area`, `x1`, `z1`, `eventRequired` ...), or null. */
    areas(zone) {
      return roots.shared ? (tab(join(roots.shared, 'buildout', `areas_${zone}.tab`))?.rows ?? null) : null;
    },
    /**
     * One area's buildout rows, each with its `objvars` a Map and its `scripts` a list, or null. `said` is the row
     * as written (template, place, scripts and objvars), which names a row in a table that writes no `objid` at
     * all (some areas' tables have no such column, and every row of theirs reads nought there).
     */
    buildout(zone, area) {
      const t = tab(server('buildout', zone, `${area}.tab`));
      if (!t) return null;
      return t.rows.map((r) => {
        const template = String(r.server_template_crc ?? '').replace(/\\/g, '/');
        return { objid: Number(r.objid) || 0, container: Number(r.container) || 0, cell_index: Number(r.cell_index) || 0, server_template_crc: template, px: r.px, py: r.py, pz: r.pz, qw: r.qw, qx: r.qx, qy: r.qy, qz: r.qz, scripts: parseScripts(r.scripts), objvars: parseObjvars(r.objvars), said: `${template}|${r.cell_index ?? ''}|${r.px}|${r.py}|${r.pz}|${r.qw}|${r.qx}|${r.qy}|${r.qz}|${r.scripts ?? ''}|${r.objvars ?? ''}` };
      });
    },
    /** The creatures a type table stands, flattened through any type table it names in turn, or null where it is none. */
    typeTable(name, isCreature) {
      const idx = typeIndex();
      const n = String(name ?? '').replace(/\\/g, '/').replace(/^.*types\//, '').replace(/\.(tab|iff)$/, '');
      const first = idx.byPath.get(n) ?? idx.byStem.get(n.split('/').pop());
      if (!first) return null;
      const out = [];
      const walk = (abs, seenAbs) => {
        if (seenAbs.has(abs)) return;
        seenAbs.add(abs);
        for (const r of tab(abs)?.rows ?? []) {
          const it = String(r.strItem ?? '').trim();
          if (!it) continue;
          if (isCreature(it)) out.push(it);
          else {
            const next = idx.byPath.get(it) ?? idx.byStem.get(it.split('/').pop());
            if (next) walk(next, seenAbs);
          }
        }
      };
      walk(first, new Set());
      return out;
    },
    /** Every creature of SOE's table by name, with only the columns the overlay uses. */
    creatures() {
      if (creatures) return creatures;
      creatures = new Map();
      const keep = ['creatureName', 'BaseLevel', 'difficultyClass', 'template', 'aggressive', 'invulnerable', 'herd', 'stalker', 'death_blow', 'primary_weapon', 'primary_weapon_speed', 'secondary_weapon', 'socialGroup', 'pvpFaction', 'niche'];
      for (const r of tab(server('mob', 'creatures.tab'))?.rows ?? []) {
        if (!r.creatureName) continue;
        const c = {};
        for (const k of keep) c[k] = r[k] ?? '';
        creatures.set(r.creatureName, c);
      }
      return creatures;
    },
    /** A server template's client body as its `.tpf` names it (`sharedTemplate`), or null. */
    sharedTemplate(template) {
      if (!roots.mobiles) return null;
      const rel = String(template ?? '').replace(/\\/g, '/').replace(/^object\/mobile\//, '').replace(/\.iff$/i, '');
      if (sharedTemplates.has(rel)) return sharedTemplates.get(rel);
      const abs = join(roots.mobiles, `${rel}.tpf`);
      let got = null;
      if (existsSync(abs)) {
        const m = /sharedTemplate\s*=\s*"([^"]+)"/.exec(bytes(abs).toString('latin1'));
        got = m ? m[1].replace(/\\/g, '/') : null;
      }
      sharedTemplates.set(rel, got);
      return got;
    },
    /** The dress lists: a list's name to its templates, a column of each `dressed_species_<letter>` table. */
    dressLists() {
      if (dress) return dress;
      dress = new Map();
      const dir = server('npc_customization');
      if (!existsSync(dir)) return dress;
      for (const name of readdirSync(dir).filter((f) => /^dressed_species_.+\.tab$/.test(f)).sort()) {
        const t = tab(join(dir, name));
        for (const c of t?.columns ?? []) if (c && !dress.has(c)) dress.set(c, t.rows.map((r) => String(r[c] ?? '').trim()).filter(Boolean));
      }
      return dress;
    },
    /** The stat table's row at a level, or the nearest level below that has one. */
    statAt(level) {
      if (!stats) {
        stats = new Map();
        for (const r of tab(server('mob', 'stat_balance.tab'))?.rows ?? []) if (Number.isFinite(Number(r.Level))) stats.set(Number(r.Level), r);
      }
      for (let l = level; l >= 0; l--) if (stats.has(l)) return stats.get(l);
      return null;
    },
    /** SOE's own weapon lists: a word to its weapon templates. */
    aiWeapons() {
      if (weapons) return weapons;
      weapons = new Map();
      for (const r of tab(server('ai', 'ai_weapons.tab'))?.rows ?? []) if (r.weapon_id) weapons.set(r.weapon_id, ['weapon1', 'weapon2', 'weapon3', 'weapon4'].map((k) => String(r[k] ?? '').trim()).filter(Boolean));
      return weapons;
    },
    /** A zone's region rows, or none. */
    regions(zone) {
      return tab(server('region', `region_${zone}.tab`))?.rows ?? [];
    },
    /** A world's spawn lists by name. */
    spawnLists(world) {
      const out = new Map();
      for (const [rel, abs] of tablesUnder(server('spawning', 'spawn_lists', world))) out.set(rel.split('/').pop(), tab(abs)?.rows ?? []);
      return out;
    },
    /** A lair table's rows, or null. */
    lair(name) {
      return tab(server('npc_lair', `${basename(String(name))}.tab`))?.rows ?? null;
    },
    /** A room crew table's people, `{ spawns, room, x, y, z, yaw, mood, respawn }`, or null. `table` is its path under the datatables. */
    crew(table) {
      const t = tab(server(...`${table}.tab`.split('/')));
      if (!t) return null;
      return t.rows.map((r) => ({ spawns: String(r.spawns ?? '').trim(), room: String(r.room ?? '').trim(), x: Number(r.loc_x) || 0, y: Number(r.loc_y) || 0, z: Number(r.loc_z) || 0, yaw: Number(r.yaw) || 0, mood: String(r.mood ?? '').trim(), respawn: Number(r.respawn_time) || 0 }));
    },
  };
}

/**
 * What git makes of a folder the overlay would be written to, for `overlayTarget` (ngepack.mjs): `ignored`,
 * `tracked` (git would take it), `outside` (no repository holds it), or `unknown` (git could not be asked, or
 * answered something else), which is refused.
 *
 * **Asked of the repository that really holds the folder, from where it really is.** The part of the path that
 * exists is carried through any junction or link on the way (`realpathSync.native`) and the rest put back after
 * it, and git is asked from there: a git asked from this checkout about a path in another checkout of the same
 * repository (a worktree's sibling) says only that the path is outside the repository it was asked from, and
 * that read as "no repository holds it" once let a worktree write into a sibling checkout's tracked folder; and a
 * checkout's `assets-private` that is a junction into another checkout is that other checkout's to ignore. Only
 * git's own word that no repository is there (`not a git repository`) is `outside`.
 */
export function gitPlace(p) {
  let near = resolve(p);
  const tail = [];
  while (!existsSync(near)) {
    const up = dirname(near);
    if (up === near) break;
    tail.unshift(basename(near));
    near = up;
  }
  let real;
  try {
    real = realpathSync.native(near);
  } catch {
    return 'unknown';
  }
  const dir = statSync(real).isDirectory() ? real : dirname(real);
  const r = spawnSync('git', ['check-ignore', '-q', '--no-index', join(real, ...tail)], { cwd: dir, encoding: 'utf8' });
  if (r.error) return 'unknown';
  if (r.status === 0) return 'ignored';
  if (r.status === 1) return 'tracked';
  return /not a git repository/i.test(String(r.stderr ?? '')) ? 'outside' : 'unknown';
}
