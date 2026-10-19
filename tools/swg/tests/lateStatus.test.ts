// What `status` asks of SOE's final files (cli.mjs `lateStatus`, finalnames.mjs `lateAsk`, `probeInstall`).
//
// Folders made here (never assets-private), `status --json` run as a child and read. The install `status` probes is
// written here too, TEST bytes in a TOC and an archive, and the list it probes with is handed in through the test
// hook (`SWG3JS_FINAL_NAMES`, whose `facts` stand for retail.json's sizes), so the probe says `serves` with nothing
// real on disk; a second install with other indexes makes it say `no`; `SWG` set to an empty string with no `--swg`
// names no install. It holds: an unstamped pack asked only where the install can mount the list; a current stamp not
// asked; a stamp that says none asked once the install can mount; a refusal asked again only once an archive it
// refused has moved; an older list and a lower stamp version asked; the player, parts and species held to the dances
// only SOE's final body table names, and the creator's table to the Wookiees' hairstyles, while they say `applied`; a
// walk grid with no `layoutKey` asked only beside a world converted with SOE's final files, one keyed on another
// layout asked, one keyed on the layout it has not, and `navgrid --skip-existing` keeping exactly those; the line
// over a folder with nothing converted; what a grid is keyed on.
//
// Run: node tools/swg/tests/lateStatus.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINAL_NAMES_COLUMNS, LATE_STAMP_VERSION, SKU_TOCS, finalNamesKey, layoutKeyOf, sha256File } from '../finalnames.mjs';
import { NAV_BAKE_RULES, NAV_GRID_VERSION, SLOPE_CLIMB_DEGREES } from '../navgrid.mjs';
import { TEST, writeToc, writeTre } from './tocWriter.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'swg3js-late-status-'));
try {
  // The install the list was made against: four indexes, an archive the one set row reads.
  const install = join(root, 'install');
  mkdirSync(install);
  const late = writeTre(join(install, 'test_late_00.tre'), [{ bytes: TEST('late file') }]);
  for (const t of SKU_TOCS) writeToc(join(install, t), ['test_late_00.tre'], t === 'sku0_client.toc' ? [{ name: 'appearance/a.msh', tree: 0, ...late[0] }] : []);
  // Some other install: other indexes, the same archive.
  const other = join(root, 'other');
  mkdirSync(other);
  writeTre(join(other, 'test_late_00.tre'), [{ bytes: TEST('late file') }]);
  for (const t of SKU_TOCS) writeToc(join(other, t), ['test_late_00.tre'], t === 'sku1_client.toc' ? [{ name: 'appearance/b.msh', tree: 0, ...late[0] }] : []);
  const against = Object.fromEntries(SKU_TOCS.map((t) => [t, { size: statSync(join(install, t)).size, sha256: sha256File(join(install, t)) }]));
  const from = Object.fromEntries(SKU_TOCS.map((t) => [t, { size: 1, sha256: '0'.repeat(64) }]));
  const blob = TEST('later file');
  const listText = JSON.stringify({
    format: 1,
    note: 'TEST',
    from,
    against,
    archives: ['test_late_00.tre'],
    columns: FINAL_NAMES_COLUMNS,
    rows: [['set', 'sku0', 'appearance/a.msh', 0, late[0].offset, blob.length, blob.length, 0, createHash('sha1').update(blob).digest('hex')]],
    facts: { 'test_late_00.tre': { size: statSync(join(install, 'test_late_00.tre')).size, sha256: sha256File(join(install, 'test_late_00.tre')) } },
  });
  const listFile = join(root, 'list.json');
  writeFileSync(listFile, listText);
  const key = finalNamesKey(listText);

  // The packs, every one a file `status` reads for a stamped command.
  const packs = join(root, 'packs');
  const json = (rel: string, v: unknown) => {
    mkdirSync(join(packs, rel, '..'), { recursive: true });
    writeFileSync(join(packs, rel), JSON.stringify(v));
  };
  const stamp = (extra: Record<string, unknown> = {}) => ({ key, state: 'applied', rows: 1, v: 1, ...extra });
  json('props/manifest.json', { version: 1, materialFormat: 6, props: [], models: [], skipped: [] });
  json('deeds.json', { version: 1, counts: {}, deeds: [], late: stamp() });
  json('weapons/manifest.json', { weapons: [], skipped: [], materialFormat: 6, late: stamp({ state: 'none', why: 'TEST' }) });
  json('ships/manifest.json', { ships: [], skipped: [], models: [], materialFormat: 6, late: stamp({ key: 'olderkey0000' }) });
  json('creatures/manifest.json', { materialFormat: 6, creatures: [], late: stamp({ v: (LATE_STAMP_VERSION.creatures ?? 1) - 1 }) });
  json('player/manifest.json', { players: [{ id: 'human_male', file: 'player/human_male.glb', clips: ['loop_skill:speed2:dance_32'], late: stamp() }] });
  json('characters/human_male/parts.json', { id: 'human_male', parts: [], clips: ['loop_skill:speed2:dance_36'], late: stamp() });
  // A second species whose parts are stamped applied and carry none of the dances: the species command is asked for it.
  json('characters/bothan_male/parts.json', { id: 'bothan_male', parts: [], clips: ['loop_skill:speed2:dance_32'], late: stamp() });
  json('characters/index.json', { species: [{ id: 'human_male', morphs: [], variables: [] }, { id: 'bothan_male', morphs: [], variables: [] }], late: stamp() });
  json('characters/customization.json', { format: 1, species: { wookiee_male: { groups: [], rows: [] } }, late: stamp() });
  // A refusal the probe cannot see (what the refused archive was on disk is what the probe finds now), and one whose
  // archive has moved since (another size).
  const lateFile = statSync(join(install, 'test_late_00.tre'));
  const seenNow = { 'test_late_00.tre': { size: lateFile.size, mtime: Math.round(lateFile.mtimeMs) } };
  json('gallery/manifest.json', { categories: {}, materialFormat: 6, late: stamp({ state: 'refused', why: "test_late_00.tre: its bytes are not SOE's (SHA-256 differs)", seen: seenNow }) });
  json('loading/index.json', { images: [], late: stamp({ state: 'refused', why: 'test_late_00.tre: 1 bytes', seen: { 'test_late_00.tre': { size: 1, mtime: 0 } } }) });
  // A world converted with SOE's final files and one converted before, each with a grid baked with no layoutKey; one
  // whose grid names the layout and terrain it has now, and one whose grid names another.
  for (const [world, late, keyed] of [['tatooine', stamp(), null], ['naboo', null, null], ['corellia', stamp(), 'now'], ['dantooine', stamp(), 'other']] as const) {
    json(`${world}/manifest.json`, { planet: world, categories: { layout: [] }, materialFormat: 6, ...(late ? { late } : {}) });
    json(`${world}/layout.json`, { planet: world, center: { x: 0, z: 0 }, objects: [{ template: 'object/TEST.iff', model: 'm', x: 0, y: 0, z: 0 }] });
    writeFileSync(join(packs, world, 'terrain.trn'), 'TEST');
    const layoutKey = keyed === 'now' ? layoutKeyOf(join(packs, world)) : keyed === 'other' ? 'otherlayout0' : null;
    json(`${world}/nav.json`, { version: NAV_GRID_VERSION, nx: 4, nz: 4, cell: 2, slopeDegrees: SLOPE_CLIMB_DEGREES, rules: NAV_BAKE_RULES, center: { x: 0, z: 0 }, stats: { buildings: 0, indoor: 0 }, ...(layoutKey ? { layoutKey } : {}) });
  }

  type Step = { command: string; args: string[]; reasons: string[] };
  /** `status --json` on a packs folder, with an install named (or none), through the list hook. */
  const asked = (swg: string | null, folder = packs) => {
    const args = [cli, 'status', folder, '--json', ...(swg ? [`--swg=${swg}`] : [])];
    const run = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1048576, env: { ...process.env, SWG: '', SWG3JS_FINAL_NAMES: listFile } });
    const out = JSON.parse(run.stdout) as { steps: Step[]; lines: string[] };
    return {
      line: out.lines.find((l) => l.includes("SOE's final files")) ?? '',
      why: (command: string, phrase: string) => out.steps.filter((s) => s.command === command).some((s) => s.reasons.some((r) => r.includes(phrase))),
      /** Whether `navgrid` is asked for a world with a reason saying `phrase`. */
      nav: (world: string, phrase: string) => out.steps.some((s) => s.command === 'navgrid' && s.args[1] === world && s.reasons.some((r) => r.includes(phrase))),
      /** The reasons of every ask of `command` that say `phrase`, joined, for a check's words. */
      reasons: (command: string, phrase: string) => out.steps.filter((s) => s.command === command).flatMap((s) => s.reasons).filter((r) => r.includes(phrase)).join(' | '),
    };
  };
  const serves = asked(install);
  const no = asked(other);
  const none = asked(null);
  ok(/this install can mount them/.test(serves.line) && /not mounted on this install/.test(no.line) && /no SWG folder named/.test(none.line), `the line says which: can mount, cannot, or no folder named (${serves.line.trim()} | ${no.line.trim()} | ${none.line.trim()})`);
  const BEFORE = "converted before SOE's final files";
  ok(serves.why('props', BEFORE) && !no.why('props', BEFORE) && !none.why('props', BEFORE), 'an unstamped pack is asked where the install can mount the list, not where it cannot, and not with no install named');
  ok(!serves.why('deeds', 'SOE') && !no.why('deeds', 'SOE'), 'a pack stamped with the current list is not asked');
  ok(!no.why('weapons', 'SOE') && serves.why('weapons', 'this install can now mount'), 'a pack stamped none is not asked, and is once the install can mount the list');
  ok(!serves.why('gallery', 'can now mount') && serves.why('loading', 'this install can now mount'), "a refusal is asked again on the probe's word only once an archive it refused has moved (a byte flipped at SOE's size is never asked for ever)");
  ok(serves.why('ships', 'older names list') && no.why('ships', 'older names list'), 'a pack stamped with an older list is asked');
  ok(serves.why('creatures', 'before a fix'), "a stamp version below the command's is asked");
  const DANCES = 'lack the dances';
  ok(serves.why('player', DANCES), 'a player stamped applied with no dance_33 to 36 is asked');
  ok(serves.why('species', DANCES) && /characters\/bothan_male\/parts\.json/.test(serves.reasons('species', DANCES)) && !/human_male/.test(serves.reasons('species', DANCES)), `a species stamped applied with none of them is asked by the species command, one that carries one is not (${serves.reasons('species', DANCES)})`);
  ok(!serves.why('parts', DANCES), "the player's own parts that carry one are not asked");
  ok(serves.why('customization', 'no hairstyles'), "the creator's table stamped applied with no Wookiee hairstyles is asked");
  ok(serves.nav('tatooine', "baked before the world was converted with SOE") && !serves.nav('naboo', 'SOE'), "a grid with no layoutKey is asked beside a world converted with SOE's final files, and not beside one converted before");
  ok(serves.nav('dantooine', 'another layout or terrain') && !serves.nav('corellia', 'another layout') && !serves.nav('corellia', 'SOE'), "a grid baked from another layout or terrain is asked; one that names the layout and terrain the pack has now is not");

  // The player's own parts with none of the dances: asked by the parts command, and by the species command beside it.
  const packs2 = join(root, 'packs2');
  const json2 = (rel: string, v: unknown) => {
    mkdirSync(join(packs2, rel, '..'), { recursive: true });
    writeFileSync(join(packs2, rel), JSON.stringify(v));
  };
  json2('player/manifest.json', { players: [{ id: 'human_male', file: 'player/human_male.glb', clips: ['loop_skill:speed2:dance_36'], late: stamp() }] });
  json2('characters/human_male/parts.json', { id: 'human_male', parts: [], clips: ['loop_skill:speed2:dance_32'], late: stamp() });
  json2('characters/index.json', { species: [{ id: 'human_male', morphs: [], variables: [] }], late: stamp() });
  const player2 = asked(install, packs2);
  ok(player2.why('parts', DANCES) && player2.why('species', DANCES) && !player2.why('player', DANCES), `the player's own parts stamped applied with none of the dances are asked by parts and species, the player's rig that carries one is not (${player2.reasons('parts', DANCES)})`);

  // A folder with nothing converted in it: the install can mount the list, and nothing is said to be mounted yet.
  const empty = join(root, 'empty');
  mkdirSync(empty);
  const bare = asked(install, empty);
  ok(/this install can mount them/.test(bare.line) && /no pack is converted here yet/.test(bare.line) && !/mounted in every pack/.test(bare.line), `with no pack converted the line says the install can mount the list, never that every pack has it (${bare.line.trim()})`);

  // A folder whose only pack the mount refused for a reason the probe cannot see: the line says the stamp's why.
  const refusedOnly = join(root, 'refused');
  mkdirSync(join(refusedOnly, 'gallery'), { recursive: true });
  writeFileSync(join(refusedOnly, 'gallery', 'manifest.json'), JSON.stringify({ categories: {}, materialFormat: 6, late: stamp({ state: 'refused', why: "test_late_00.tre: its bytes are not SOE's (SHA-256 differs)", seen: seenNow }) }));
  const refusedLine = asked(install, refusedOnly).line;
  ok(/not mounted on this install: test_late_00\.tre: its bytes are not SOE's/.test(refusedLine), `with every pack refused for what the probe cannot see, the line says why from the stamp (${refusedLine.trim()})`);

  // `navgrid --skip-existing` keeps exactly what status does not ask for: the grid that names the layout it has now,
  // never one baked from another or one with no key beside a world converted with SOE's final files.
  const resumed = spawnSync(process.execPath, [cli, 'navgrid', 'all', packs, '--skip-existing'], { encoding: 'utf8', maxBuffer: 64 * 1048576, env: { ...process.env, SWG: '' } }).stdout;
  ok(/corellia: nav\.json is there already/.test(resumed) && /naboo: nav\.json is there already/.test(resumed), 'a resumed bake keeps a grid that names the layout it has now, and one with no key over a world converted without the list');
  ok(/dantooine: re-baking: the nav\.json there was baked from another layout or terrain/.test(resumed) && /tatooine: re-baking: the nav\.json there was baked before the world was converted with SOE/.test(resumed), `and bakes again what status would ask for (${resumed.split('\n').filter((l) => /re-baking|there already/.test(l)).join(' | ')})`);

  // What a grid is keyed on: the layout's text, its line endings folded, and the terrain file it names.
  {
    const w = join(root, 'keyed');
    mkdirSync(w);
    const layoutText = JSON.stringify({ planet: 'TEST', center: { x: 0, z: 0 }, terrain: 'terrain.trn', objects: [{ template: 'object/TEST.iff', x: 1 }] }, null, 1);
    writeFileSync(join(w, 'layout.json'), layoutText);
    writeFileSync(join(w, 'terrain.trn'), 'TEST terrain');
    const k = layoutKeyOf(w);
    writeFileSync(join(w, 'layout.json'), layoutText.replace(/\n/g, '\r\n'));
    ok(layoutKeyOf(w) === k, 'a CRLF copy of the layout keys the same');
    writeFileSync(join(w, 'layout.json'), layoutText.replace('"x": 1', '"x": 2'));
    const moved = layoutKeyOf(w);
    writeFileSync(join(w, 'layout.json'), layoutText);
    writeFileSync(join(w, 'terrain.trn'), 'TEST terrain, moved');
    ok(!!k && moved !== k && layoutKeyOf(w) !== k && layoutKeyOf(w) !== moved, 'a moved object or a moved terrain keys another');
    ok(layoutKeyOf(join(root, 'nowhere')) === null, 'a folder with no layout has no key');
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} checks passed`);
