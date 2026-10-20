// The reference of SOE's own people for Kashyyyk and Mustafar (`tools/swg/ngeref/`, `ngeref.mjs`): committed and read
// by every converter by default, by the owner's decision of 2026-10-19. This holds the files themselves -- every zone
// there, its index honest about them, nothing in them but names, numbers and places -- that every name a row stands
// reaches a creature or a table the reference holds, that two builds of it name every row alike, and that `spawns`
// reads it with no flag while `--nge=none` leaves it out and leaves the Core3 half byte for byte as it was. It prints
// counts, never rows.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NGE_FORMAT, NGE_PREFIX, NGE_ZONES, buildNgeOverlay, sharedOf } from '../ngepack.mjs';
import { NGE_REF_DIR, NGE_REF_FORMAT, ngeRefReader, readReferenceIndex, referenceHash } from '../ngeref.mjs';
import { standingList } from '../../../src/world/ngeOverlay.ts';
import { stoodName, type StandingRow } from '../../../src/world/standingPeople.ts';
import { cleanId, seenId } from '../../../server/ownership.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const index = readReferenceIndex(NGE_REF_DIR);

// ------------------------------------------------------------------------------------------- the files
{
  ok(!!index && index.format === NGE_REF_FORMAT, `the reference is there beside the converter, at its own format (${index?.format})`);
  ok(NGE_ZONES.every((z) => index.zones.includes(z) && index.files.zones[z] && existsSync(join(NGE_REF_DIR, index.files.zones[z]))), `every zone of Kashyyyk and Mustafar has its file (${index.zones.length})`);
  const listed = ['index.json', index.files.tables, ...Object.values(index.files.zones) as string[]].sort();
  const there = readdirSync(NGE_REF_DIR).sort();
  ok(there.join(',') === listed.join(','), `the folder holds exactly the files its index lists and nothing else (${there.length})`);
  const files = Object.fromEntries(listed.filter((f) => f !== 'index.json').map((f) => [f, readFileSync(join(NGE_REF_DIR, f), 'utf8')]));
  ok(referenceHash(files) === index.sha1, `the index's own hash is the hash of the files as they stand (${index.sha1})`);
  // A checkout whose git writes text files CRLF (`core.autocrlf`, the owner's) holds the same reference: one identity
  // whichever line endings this checkout has, and the files are written with LF.
  const ending = (to: string) => Object.fromEntries(Object.entries(files).map(([f, t]) => [f, t.replace(/\r\n/g, '\n').replace(/\n/g, to)]));
  ok(referenceHash(ending('\r\n')) === index.sha1 && referenceHash(ending('\n')) === index.sha1, 'and the same with every line ending CRLF or LF, as git may check the files out either way');
  const bytes = Object.values(files).reduce((s, t) => s + Buffer.byteLength(t), 0);
  ok(bytes < 2 * 1024 * 1024, `and they come to ${(bytes / 1024).toFixed(0)} KB, the fields the overlay reads and no more`);
  ok(/2026-10-19/.test(index.note) && index.source && typeof index.source.sha1 === 'string' && !('root' in index.source), 'the index says what it is, by whose decision, and which copy it was read from by its hash alone, naming no folder of anybody\'s');
  // Nothing but rows: no string longer than a name, nothing a script or a line of text is written with.
  const strings: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        strings.push(k);
        walk(x);
      }
    }
  };
  for (const t of Object.values(files)) walk(JSON.parse(t));
  const long = strings.filter((s) => s.length > 96);
  const odd = strings.filter((s) => !/^[A-Za-z0-9_#./:-]*$/.test(s));
  // A dotted name that is no file -- a script's (`systems.spawning.spawner_area`) -- is code, not a row.
  const script = strings.filter((s) => /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(s) && !/\.(iff|tab)$/i.test(s));
  ok(long.length === 0 && odd.length === 0 && script.length === 0, `every one of its ${strings.length} strings is a name, a template's path, a key or a number's text: ${long.length} longer than a name, ${odd.length} with a space or a script's characters, ${script.length} naming a script`);
}

// ------------------------------------------------------------------------------------------- the names
// Every name a row stands is a creature the reference holds or a type table of them, every type table's every member
// a creature, and whatever is neither is counted in the index, never lost unsaid: a placed row's name among the
// overlay's own `unresolved`, a crew's row that stands nobody (an object, or a name that is no creature and no table,
// which the overlay takes for a thing in the room) among its `things`.
const ref = ngeRefReader(NGE_REF_DIR)!;
const creatures = ref.creatures();
const tables = JSON.parse(readFileSync(join(NGE_REF_DIR, index.files.tables), 'utf8'));
{
  const isCreature = (n: string) => creatures.has(String(n).trim());
  const isType = (n: string) => !!tables.types[String(n).trim()];
  let named = 0;
  const neither = new Set<string>();
  for (const zone of NGE_ZONES) {
    const z = JSON.parse(readFileSync(join(NGE_REF_DIR, index.files.zones[zone]), 'utf8'));
    for (const rows of Object.values(z.buildouts) as { k: string; c?: number; o?: unknown[] }[][]) {
      for (const r of rows) {
        if (r.c || !['a', 'p', 's', 'c'].includes(r.k) || typeof r.o?.[0] !== 'string') continue;
        named++;
        const who = (r.o[0] as string).trim();
        if (!(isCreature(who) || ((r.k === 'a' || r.k === 'p') && isType(who)))) neither.add(who);
      }
    }
  }
  let crew = 0;
  let nobody = 0;
  for (const rows of Object.values(tables.crews) as unknown[][][]) {
    for (const r of rows) {
      crew++;
      if (r.length === 1 || !(isCreature(r[0] as string) || isType(r[0] as string))) nobody++;
    }
  }
  const members = (Object.values(tables.types) as string[][]).flat();
  ok(members.length > 0 && members.every(isCreature), `every type table's member is a creature the reference holds (${members.length} over ${Object.keys(tables.types).length} tables)`);
  ok(neither.size === index.counts.overlay.unresolved, `every name a placed row stands (${named}) reaches a creature or a type table, or is counted unresolved in the index (${neither.size} names against its ${index.counts.overlay.unresolved})`);
  if (index.counts.overlay.crew > 0) ok(nobody === index.counts.overlay.things, `and of the crews' ${crew} rows, the ${nobody} that stand nobody are the things the index counts in their rooms (${index.counts.overlay.things})`);
  else console.log('note the reference was written without the archives, so its crews were not built and their rows are not counted');
  ok(Object.keys(tables.creatures).length === index.counts.tables.creatures && index.counts.overlay.creatures <= Object.keys(tables.creatures).length, `the index counts the creatures the reference holds (${Object.keys(tables.creatures).length}; ${index.counts.overlay.creatures} stood with a body when it was written)`);
}

// ------------------------------------------------------------------------------------------- nothing nobody names
// The reference keeps only what every client needs: worked out again here from its own rows -- every name a placed
// row and a crew's row stands, every member of a type table one of those names, every lair a spawn list names and
// every member of those -- the creatures it holds are exactly the ones they reach, and the type tables, lairs, stat
// levels, weapons, dress lists and bodies it keeps are each one something it holds names. A writer that copied the
// copy's whole creature table, or a stat level nobody stands at, fails here.
{
  const cols: string[] = index.creatureColumns.slice(1);
  const col = (name: string) => cols.indexOf(name);
  const isCreature = (n: string) => Object.prototype.hasOwnProperty.call(tables.creatures, n);
  const reachC = new Set<string>();
  const reachT = new Set<string>();
  const reachL = new Set<string>();
  const person = (name: unknown) => {
    const n = String(name ?? '').trim();
    if (!n || n.startsWith('object/')) return;
    if (isCreature(n)) reachC.add(n);
    else reachT.add(n);
  };
  for (const zone of NGE_ZONES) {
    const z = JSON.parse(readFileSync(join(NGE_REF_DIR, index.files.zones[zone]), 'utf8'));
    for (const rows of Object.values(z.buildouts) as { k: string; o?: unknown[] }[][]) {
      for (const r of rows) {
        const who = r.o?.[0];
        if (typeof who !== 'string') continue;
        if (r.k === 'a' || r.k === 'p') person(who);
        else if ((r.k === 's' || r.k === 'c') && isCreature(who.trim())) reachC.add(who.trim());
      }
    }
    // A lair is kept under its name's last part, as the writer and the reader both take it (`basename`).
    for (const list of Object.values(z.lists) as string[][][]) for (const row of list) if (String(row[0] ?? '').trim()) reachL.add(basename(String(row[0]).trim()));
  }
  for (const rows of Object.values(tables.crews) as unknown[][][]) for (const r of rows) if (r.length > 1) person(r[0]);
  for (const [name, members] of Object.entries(tables.types) as [string, string[]][]) if (reachT.has(name)) for (const m of members) reachC.add(m);
  for (const [name, rows] of Object.entries(tables.lairs) as [string, string[][]][]) if (reachL.has(name)) for (const m of rows) if (isCreature(String(m[0]).trim())) reachC.add(String(m[0]).trim());
  const held = Object.keys(tables.creatures).sort();
  const reached = [...reachC].sort();
  const extra = held.filter((n) => !reachC.has(n));
  ok(held.join('\n') === reached.join('\n'), `the creatures it holds are exactly the ones its rows, type tables, crews and lairs reach (${held.length} held, ${reached.length} reached, ${extra.length} that nothing names)`);
  ok(Object.keys(tables.types).every((t) => reachT.has(t)) && Object.keys(tables.lairs).every((l) => reachL.has(l)), `every type table it keeps is one a row stands, and every lair one a spawn list names (${Object.keys(tables.types).length} tables, ${Object.keys(tables.lairs).length} lairs)`);
  const levels = new Set(held.map((n) => String(Math.max(1, Math.trunc(Number(tables.creatures[n][col('BaseLevel')]) || 1)))));
  const words = new Set(held.flatMap((n) => [tables.creatures[n][col('primary_weapon')], tables.creatures[n][col('secondary_weapon')]].map((w: string) => String(w ?? '').trim())));
  ok(Object.keys(tables.stats).sort().join(',') === [...levels].sort().join(',') && Object.keys(tables.weapons).every((w) => words.has(w)), `the stat levels it keeps are exactly its creatures' (${levels.size}), and every weapon list one a creature holds (${Object.keys(tables.weapons).length})`);
  const templates = held.map((n) => String(tables.creatures[n][col('template')] ?? '').trim());
  const shapeKey = (t: string) => t.replace(/\\/g, '/').replace(/^object\/mobile\//, '').replace(/\.iff$/i, '');
  const bodies = new Set<string>();
  for (const t of templates) {
    if (/\.iff$/i.test(t)) bodies.add(shapeKey(t));
    else for (const x of (tables.dress[t] ?? []) as string[]) bodies.add(shapeKey(/\.iff$/i.test(x) ? x : `${x}.iff`));
  }
  ok(Object.keys(tables.dress).every((d) => templates.includes(d)) && Object.keys(tables.shared).every((s) => bodies.has(s)), `every dress list it keeps is one a creature wears, and every body template one a creature or a dress list names (${Object.keys(tables.dress).length} lists, ${Object.keys(tables.shared).length} bodies)`);
}

// The packs a build is made over here: a stub pack per zone, and a catalogue with a body for every template a
// creature's server template, dress list or `.tpf` asks for (the converter's own join, `joinBody`).
const stubPack = { layout: { objects: [] }, manifest: { categories: { layout: [] } }, stamp: null };
const stubCatalogue = (() => {
  const entries = new Map<string, { id: string; template: string; kind: string; ready: boolean }>();
  const add = (t: string) => {
    const s = ref.sharedTemplate(t) ?? sharedOf(t);
    if (!entries.has(s)) entries.set(s, { id: `test_body_${entries.size}`, template: s, kind: 'npc', ready: true });
  };
  for (const c of creatures.values()) {
    const t = String(c.template ?? '').trim();
    if (/\.iff$/i.test(t)) add(t);
    else for (const x of ref.dressLists().get(t) ?? []) add(/\.iff$/i.test(x) ? x : `${x}.iff`);
  }
  // `failed` and `options` beside the entries: the least a catalogue `status` reads.
  return { converted: 'test_catalogue', entries: [...entries.values()], failed: [], options: {} };
})();
const buildFrom = (reader: ReturnType<typeof ngeRefReader>) => buildNgeOverlay({ reader, zones: NGE_ZONES, packOf: () => stubPack, groundOf: () => () => Number.NaN, snapOf: null, clientAreas: null, catalogue: stubCatalogue, converted: 'test_now' });

// ------------------------------------------------------------------------------------------- the keys
// Two builds of the same reference over the same packs are one build: the same keys, in the same order. That alone
// proves only that the build is the same function twice; what two players' browsers share a body by is its name,
// which for a row of the overlay is its own key (`stoodName`), so below a build over a catalogue with bodies missing --
// a machine whose mobiles run converted fewer, which drops every row whose creature joins none of them -- still names
// every row it keeps exactly as the full build does, where by its place in the list every row after the first one
// dropped would name another body.
{
  const a = buildFrom(ngeRefReader(NGE_REF_DIR));
  const b = buildFrom(ngeRefReader(NGE_REF_DIR));
  const keysOf = (built: typeof a) => NGE_ZONES.map((z) => standingList([], [], (built.packs[z]?.statics ?? []) as { key: string }[]).map((r) => r.key).join(',')).join('|');
  const all = Object.values(a.packs).flatMap((p) => (p.statics as { key: string }[]).map((r) => r.key));
  ok(all.length > 1000 && keysOf(a) === keysOf(b), `two builds of the same reference over the same packs hold every row under the same key, in the same order (${all.length} rows over ${Object.keys(a.packs).length} zones)`);
  // The names every browser stands them under, by key, as a world's list is adopted (`standingList`, `stoodName`).
  const namesOf = (built: typeof a): Map<string, string> => {
    const out = new Map<string, string>();
    for (const z of NGE_ZONES) standingList([], [], (built.packs[z]?.statics ?? []) as StandingRow[]).forEach((r, i) => out.set(`${z}|${r.key}`, stoodName(z, r, i)));
    return out;
  };
  const fewer = { ...stubCatalogue, entries: stubCatalogue.entries.filter((_, i) => i % 7 !== 3) };
  const c = buildNgeOverlay({ reader: ngeRefReader(NGE_REF_DIR), zones: NGE_ZONES, packOf: () => stubPack, groundOf: () => () => Number.NaN, snapOf: null, clientAreas: null, catalogue: fewer, converted: 'test_now' });
  const full = namesOf(a);
  const short = namesOf(c);
  const moved = [...short].filter(([k, name]) => full.get(k) !== name);
  // How far a place in the list would have carried it: rows named by place that would have named another body.
  let byPlace = 0;
  for (const z of NGE_ZONES) {
    const fullList = ((a.packs[z]?.statics ?? []) as { key: string }[]).map((r) => r.key);
    ((c.packs[z]?.statics ?? []) as { key: string }[]).forEach((r, i) => {
      if (fullList[i] !== r.key) byPlace++;
    });
  }
  ok(short.size > 0 && short.size < full.size && moved.length === 0, `a machine whose catalogue joins fewer bodies drops ${full.size - short.size} of ${full.size} rows and names every one it keeps as the full build does (${moved.length} moved; by place in the list ${byPlace} would have named another body)`);
  // Every one of those names is one a relay takes as a seen body's, the relay before this wave included (its id is
  // at most 48 plain characters), so sharing them needs no restart.
  const refusedNames = [...full.values()].filter((n) => cleanId(n) !== n || !seenId(n));
  ok(full.size > 0 && refusedNames.length === 0, `and every name is one the relay takes for a seen body (${refusedNames.length} refused; the longest ${Math.max(...[...full.values()].map((n) => n.length))} characters)`);
  ok(new Set(all).size === all.length && all.every((k) => /^n[0-9a-f]{11}$/.test(k)), 'and no two rows share a key, every one n and eleven hex figures, never a Core3 key');
  ok(a.index.copy.kind === 'reference' && a.index.copy.sha1 === index.sha1 && a.index.local === false && a.index.format === NGE_FORMAT, "an overlay built from it says it came from the reference, by the reference's own hash");
  const stray = Object.keys(a.manifest.creatures).filter((k) => !k.startsWith(NGE_PREFIX));
  ok(stray.length === 0 && a.index.counts.unresolved === index.counts.overlay.unresolved, `every name it brings is nge:-prefixed, and it leaves unresolved what the index says (${a.index.counts.unresolved})`);
}

// Every creature joins a body of this machine's own catalogue, where one is converted.
{
  const cat = join(REPO, 'assets-private', 'mobiles', 'catalogue.json');
  if (existsSync(cat)) {
    const built = buildNgeOverlay({ reader: ngeRefReader(NGE_REF_DIR), zones: NGE_ZONES, packOf: () => stubPack, groundOf: () => () => Number.NaN, snapOf: null, clientAreas: null, catalogue: JSON.parse(readFileSync(cat, 'utf8')), converted: 'test_now' });
    ok(built.index.bodiless.length === 0 && built.index.counts.noBody === 0, `every creature the reference names joins a body of the catalogue on this machine (${built.index.counts.creatures} creatures; ${built.index.bodiless.length} bodiless, ${built.index.counts.noBody} rows with no body)`);
  } else console.log('note no mobiles catalogue on this machine: the bodies are joined only to the stand-in above');
}

// ------------------------------------------------------------------------------------------- the converter
// `spawns` with no flag reads the reference; `--nge=none` leaves it out, and leaves every file of the Core3 half
// exactly what the run with it writes.
{
  const cli = join(REPO, 'tools', 'swg', 'cli.mjs');
  const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: REPO, encoding: 'utf8', env: { ...process.env, SWG: '' } });
  const setUp = (): string => {
    const out = mkdtempSync(join(tmpdir(), 'test_ngeref_out_'));
    mkdirSync(join(out, 'mobiles'), { recursive: true });
    writeFileSync(join(out, 'mobiles', 'catalogue.json'), JSON.stringify(stubCatalogue));
    for (const z of NGE_ZONES) {
      mkdirSync(join(out, z), { recursive: true });
      writeFileSync(join(out, z, 'layout.json'), JSON.stringify(stubPack.layout));
      writeFileSync(join(out, z, 'manifest.json'), JSON.stringify(stubPack.manifest));
    }
    return out;
  };
  const files = (dir: string, base = dir, list: string[] = []): string[] => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) files(p, base, list);
      else list.push(relative(base, p).replace(/\\/g, '/'));
    }
    return list.sort();
  };
  // The one line that is the run's moment, which two runs can never share.
  const bytesOf = (p: string) => readFileSync(p, 'utf8').replace(/"converted": "[^"]*"/g, '"converted": "test"');
  const withRef = setUp();
  const without = setUp();
  const a = run(['spawns', withRef]);
  const b = run(['spawns', without, '--nge=none']);
  ok(a.status === 0 && b.status === 0, `spawns runs with no flag and with --nge=none${a.status || b.status ? `: ${a.stdout}${a.stderr}${b.stdout}${b.stderr}` : ''}`);
  const idx = JSON.parse(readFileSync(join(withRef, 'nge', 'index.json'), 'utf8'));
  // Without the archives the dungeons' crews are left out (their copies and rooms are found there), so the run is held
  // to the very build of the reference over the same packs, made here.
  const here = buildFrom(ngeRefReader(NGE_REF_DIR));
  ok(idx.copy.kind === 'reference' && idx.copy.sha1 === index.sha1 && NGE_ZONES.every((z) => z in idx.zones) && idx.counts.rows === here.index.counts.rows && idx.counts.rows > 1000 && /from the reference beside the converter/.test(a.stdout), `with no flag it stands SOE's people from the reference on every zone (${idx.counts.rows} people over ${Object.keys(idx.zones).length} zones, the crews left for a run with the archives), and says so`);
  const none = JSON.parse(readFileSync(join(without, 'nge', 'index.json'), 'utf8'));
  ok(none.none === true && Object.keys(none.zones).length === 0 && files(join(without, 'nge')).join(',') === 'index.json', '--nge=none leaves them out, with an index that says so and lists no world');
  const core = (dir: string) => files(dir).filter((f) => !f.startsWith('nge/'));
  const same = core(withRef).join(',') === core(without).join(',') && core(withRef).every((f) => bytesOf(join(withRef, f)) === bytesOf(join(without, f)));
  ok(same && core(withRef).includes('spawns/manifest.json'), `and every file outside nge/ is the same byte for byte either way, the Core3 half's fleet manifest among them (${core(withRef).length} files, its one line of the run's own moment set aside)`);
  // `status`: nothing asked of a pack converted with them or without them by choice; spawns asked, with no --nge, of
  // one converted before them.
  const stepsOf = (dir: string) => {
    const st = run(['status', dir, '--json']);
    assert.equal(st.status, 0, `status ran: ${st.stderr.slice(0, 400)}`);
    return JSON.parse(st.stdout).steps as { args: string[]; reasons: string[] }[];
  };
  const spawnsAsked = (dir: string) => stepsOf(dir).filter((s) => s.args[0] === 'spawns');
  ok(spawnsAsked(withRef).length === 0 && spawnsAsked(without).length === 0, 'status asks no spawns of packs converted with them, nor of packs that left them out by choice');
  const before = setUp();
  const asked = spawnsAsked(before);
  ok(asked.length === 1 && asked[0].args.every((x) => !/--nge/.test(x)) && asked[0].reasons.some((r) => /Kashyyyk and Mustafar/.test(r)), 'and asks spawns, with no --nge, of packs converted before them, saying why');
  for (const d of [withRef, without, before]) rmSync(d, { recursive: true, force: true });
}

console.log(`\n${passed} checks passed`);
