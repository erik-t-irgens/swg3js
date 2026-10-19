// SOE's final names list (tools/swg/finalnames.mjs, finalnamesBuild.mjs, the late phase of `openVfs`).
//
// The committed list read as the mount reads it and held to its own shape; a whole install written here, two index
// sets and their archives, with the list made from them by the maintainer's own writer and mounted every way the
// gate can answer (applied, final, none, refused for a byte flipped, a missing archive and one the filter leaves out);
// the row checker failing a row that points one byte off; the order of the rows mattering not at all; a held path
// keeping the index's copy. On the owner's install when there is one: the list applies under --retail-only, every set
// row reads at its length and SHA-1 from the player's own archives, and the mount names exactly what SOE's final one
// does. Then the table of what each command stamps against the converter's own commands, the text pin that keeps
// `materialStale(` out of cli.mjs, and the check of what a run left unwritten.
//
// Run: node tools/swg/tests/finalNames.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FINAL_NAMES_COLUMNS, FINAL_NAMES_HELD, LATE_EXEMPT, LATE_STAMPED, SKU_TOCS, finalNamesKey, inventoryOf, keptStale, lateAsk, lateStampOf, lateWorld, loadFinalNames,
  parseFinalNames, probeInstall, readArchives, rewrittenCheck, sha256File, verifyFinalNames,
} from '../finalnames.mjs';
import { buildFinalNames, finalNamesText } from '../finalnamesBuild.mjs';
import { openToc, tocRank } from '../toc.mjs';
import { archiveRank, openTre, openVfs } from '../tre.mjs';
import { STEP_FACTS } from '../convertPlan.mjs';
import { swgDir } from './materialsHarness.ts';
import { TEST, writeToc, writeTre } from './tocWriter.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (what: string) => console.log(`note ${what}`);
const sha1 = (b: Buffer) => createHash('sha1').update(b).digest('hex');

// --- 1. the committed file ------------------------------------------------------------------------------------------
const retail = JSON.parse(readFileSync(new URL('../manifests/retail.json', import.meta.url), 'utf8'));
const committedText = readFileSync(new URL('../manifests/final-names.json', import.meta.url), 'utf8');
{
  const list = parseFinalNames(committedText);
  ok(!list.broken, `the committed list reads (${list.broken ?? `key ${list.key}`})`);
  ok(list.format === 1 && list.columns.join() === FINAL_NAMES_COLUMNS.join(), 'format 1, the nine columns');
  ok(list.rows.every((r: unknown[]) => ['set', 'gone', 'deleted'].includes(r[0] as string) && /^sku[0-3]$/.test(r[1] as string)), 'every row is a set, gone or deleted, from sku0 to sku3');
  const paths = new Set(list.rows.map((r: unknown[]) => String(r[2]).toLowerCase()));
  ok(paths.size === list.rows.length, `every path once, case folded (${list.rows.length} rows)`);
  ok(list.rows.every((r: unknown[]) => Number.isInteger(r[3]) && (r[3] as number) >= 0 && (r[3] as number) < list.archives.length), 'every archive index names one of the list\'s archives');
  ok(list.archives.every((a: string) => retail.nge_final[a.toLowerCase()]?.sha256 && typeof retail.nge_final[a.toLowerCase()].size === 'number'), `every archive (${list.archives.length}) is in retail.json's nge_final with a size and a SHA-256`);
  ok(SKU_TOCS.every((t) => list.from[t].sha256 === retail.nge_final[t].sha256 && list.from[t].size === retail.nge_final[t].size), "`from` is SOE's final four indexes as retail.json records them");
  ok(list.rows.every((r: unknown[]) => (r[0] === 'set' ? (r[5] as number) > 0 && /^[0-9a-f]{40}$/.test(r[8] as string) : r[5] === 0 && r[8] === '')), 'a set row has a length and a SHA-1; a gone or deleted one has neither');
  const order = list.rows.map((r: unknown[]) => [Number(String(r[1]).slice(3)), archiveRank(list.archives[r[3] as number]), list.archives[r[3] as number].toLowerCase(), r[4] as number, String(r[2]).toLowerCase()]);
  const sorted = order.every((o: (string | number)[], i: number) => {
    if (!i) return true;
    const p = order[i - 1];
    for (let k = 0; k < o.length; k++) if (o[k] !== p[k]) return o[k] > p[k];
    return true;
  });
  ok(sorted, "the rows are in SOE's order (index, the archive's place, the archive, the offset)");
  ok(finalNamesKey(committedText) === finalNamesKey(committedText.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')) && list.key === finalNamesKey(committedText), 'the key is the same from the LF text and from the CRLF text');
  ok(!list.rows.some((r: unknown[]) => /^(player_music\/|texture\/ui_map_|datatables\/buildout\/areas_)/i.test(String(r[2]))), 'no row under player_music/, texture/ui_map_ or datatables/buildout/areas_ (the exempt commands read nothing the list moves)');
  ok(!('facts' in list), 'the committed list carries no facts of its own');
  const k = list.rows.reduce((a: Record<string, number>, r: unknown[]) => ((a[r[0] as string] = (a[r[0] as string] ?? 0) + 1), a), {});
  ok(list.rows.length === 9890 && k.set === 9880 && k.gone === 2 && k.deleted === 8 && readArchives(list).length === 17 && list.archives.length === 22, `9,890 rows (9,880 set, 2 gone, 8 deleted) over 22 archives, 17 of them read (${list.rows.length}: ${JSON.stringify(k)})`);
  ok(Object.keys(FINAL_NAMES_HELD).length === 2 && Object.keys(FINAL_NAMES_HELD).every((p) => paths.has(p)), 'the two held paths (the Life Day terrains) are rows of the list');
  ok(parseFinalNames(committedText.replace('"format": 1', '"format": 2')).broken && parseFinalNames('{').broken, 'a list of another format, or one that will not parse, is no list');
  const withFacts = JSON.stringify({ ...JSON.parse(committedText), facts: {} });
  ok(!!parseFinalNames(withFacts).broken && !parseFinalNames(withFacts, { facts: true }).broken, 'facts are refused in a committed list and taken only from the test hook');
}

// --- 2. a synthetic install -----------------------------------------------------------------------------------------
const root = mkdtempSync(join(tmpdir(), 'swg3js-final-names-'));
try {
  const install = join(root, 'install');
  const finalDir = join(root, 'final');
  mkdirSync(install);
  mkdirSync(finalDir);
  // The base archive every index reads, and the late one only SOE's final index names.
  const base = writeTre(join(install, 'test_base_00.tre'), [
    { bytes: TEST('kept') },
    { bytes: TEST('older copy') },
    { bytes: TEST('going away') },
    { bytes: TEST('snowless terrain'), zip: true },
    { bytes: TEST('deleted long ago') },
  ]);
  const late = writeTre(join(install, 'test_late_00.tre'), [
    { bytes: TEST('brand new'), zip: true },
    { bytes: TEST('newer copy') },
    { bytes: TEST('snowy terrain') },
  ]);
  const baseTrees = ['test_base_00.tre'];
  const e = (name: string, tree: number, b: { offset: number; length: number; stored: number; comp: number }) => ({ name, tree, ...b });
  const del = (name: string) => ({ name, tree: 0, offset: 0, length: 0, stored: 0, comp: 0 });
  // The Legends install's own four (what the list is made against).
  writeToc(join(install, 'sku0_client.toc'), baseTrees, [e('appearance/kept.msh', 0, base[0]), e('appearance/newer.msh', 0, base[1]), e('shader/gone.sht', 0, base[2]), e('terrain/tatooine.trn', 0, base[3]), e('misc/dead.iff', 0, base[4]), del('misc/dead.iff')]);
  for (const t of ['sku1_client.toc', 'sku2_client.toc', 'sku3_client.toc']) writeToc(join(install, t), baseTrees, []);
  // SOE's final four: the new file, the newer copy and the snowy terrain from the late archive, the gone shader not named.
  const finalTrees = ['test_base_00.tre', 'test_late_00.tre'];
  writeToc(join(finalDir, 'sku0_client.toc'), finalTrees, [e('appearance/kept.msh', 0, base[0]), e('appearance/newer.msh', 1, late[1]), e('appearance/new.msh', 1, late[0]), e('terrain/tatooine.trn', 1, late[2]), e('misc/dead.iff', 0, base[4]), del('misc/dead.iff')]);
  for (const t of ['sku1_client.toc', 'sku2_client.toc', 'sku3_client.toc']) writeToc(join(finalDir, t), finalTrees, []);
  // retail.json's role for the TEST files: the four final indexes and the archives, by size and SHA-256.
  const facts = (dir: string, names: string[]) => Object.fromEntries(names.map((n) => [n, { size: statSync(join(dir, n)).size, sha256: sha256File(join(dir, n)) }]));
  const ngeFinal = { ...facts(finalDir, SKU_TOCS), ...facts(install, ['test_base_00.tre', 'test_late_00.tre']) };
  const built = buildFinalNames(finalDir, install, { openToc, tocRank, openTre, archiveRank, ngeFinal });
  const list = parseFinalNames(JSON.stringify({ ...built.list, facts: facts(install, ['test_base_00.tre', 'test_late_00.tre']) }), { facts: true });
  ok(!list.broken, `the maintainer's writer makes a list of the TEST install that reads (${list.broken ?? `${list.rows.length} rows`})`);
  const kinds = Object.fromEntries(['set', 'gone', 'deleted'].map((k) => [k, list.rows.filter((r: unknown[]) => r[0] === k).map((r: unknown[]) => r[2])]));
  ok(kinds.set.length === 3 && kinds.gone.join() === 'shader/gone.sht' && kinds.deleted.join() === 'misc/dead.iff' && !list.rows.some((r: unknown[]) => r[2] === 'appearance/kept.msh'), 'it holds the three moved paths, the gone one and the deletion, and nothing the indexes already answer the same way');
  ok(finalNamesText(built.list).split('\n').filter((l) => l.startsWith('["')).length === list.rows.length, 'and it is written one row a line');

  /** Every name the mount answers, with what it reads. */
  const snapshot = (vfs: { list(): string[]; read(p: string): Buffer; stat(p: string): { archive: string; size: number } | null }) =>
    new Map(vfs.list().map((p) => [p, `${vfs.stat(p)?.archive.split(/[\\/]/).pop()}|${sha1(vfs.read(p))}`]));
  const without = snapshot(openVfs(install, { finalNames: false, log: () => {} }));
  // (a) the indexes are the ones the list was made against.
  const a = openVfs(install, { finalNames: list, log: () => {} });
  ok(a.late.state === 'applied' && a.late.applied === list.rows.length - 1 && a.late.held === 1, `applied, every row but the held one (${a.late.state}, ${a.late.applied}, ${a.late.held} held)`);
  ok(a.read('appearance/new.msh').equals(TEST('brand new')) && a.read('appearance/newer.msh').equals(TEST('newer copy')), 'a new path and a newer copy read their exact bytes, one of them deflated');
  ok(!a.has('shader/gone.sht') && !a.has('misc/dead.iff'), 'the gone path and the deleted one are not there');
  ok(a.read('appearance/kept.msh').equals(TEST('kept')), 'a path the list does not name is as the indexes left it');
  ok(a.read('terrain/tatooine.trn').equals(TEST('snowless terrain')) && !a.lateOf('terrain/tatooine.trn'), 'a held path keeps the index\'s copy');
  const v = a.versions('appearance/newer.msh');
  ok(v.length === 2 && /test_base_00/.test(v[0].archive) && /test_late_00/.test(v[1].archive) && v[1].late === true && a.lateOf('appearance/newer.msh'), "versions() lists the index's copy, then the list's");
  ok(a.readIndexed('appearance/newer.msh').equals(TEST('older copy')) && a.readIndexed('appearance/new.msh') === null, 'readIndexed gives the copy the indexes alone gave, null for a path they never named');
  ok(a.late.newPaths === 1 && a.late.newer === 1, 'one new file and one newer copy counted');
  // (f) the rows in any order.
  const reversed = { ...list, rows: [...list.rows].reverse() };
  const r = openVfs(install, { finalNames: reversed, log: () => {} });
  const same = (x: Map<string, string>, y: Map<string, string>) => x.size === y.size && [...x].every(([k, val]) => y.get(k) === val);
  ok(same(snapshot(a), snapshot(r)), 'the rows applied in reverse give the same mount');
  // (b) SOE's own final indexes.
  const finalInstall = join(root, 'final_install');
  mkdirSync(finalInstall);
  for (const f of [...SKU_TOCS.map((t) => [finalDir, t]), [install, 'test_base_00.tre'], [install, 'test_late_00.tre']]) copyFileSync(join(f[0], f[1]), join(finalInstall, f[1]));
  const b = openVfs(finalInstall, { finalNames: list, log: () => {} });
  ok(b.late.state === 'final' && b.late.applied === 0 && same(snapshot(b), snapshot(openVfs(finalInstall, { finalNames: false, log: () => {} }))), 'a folder holding SOE\'s final indexes is `final` and nothing is applied');
  ok(probeInstall(finalInstall, list).state === 'final' && probeInstall(install, list).state === 'serves', 'the probe says `final` there and `serves` on the install the list was made against');
  // (c) some other indexes.
  const other = join(root, 'other');
  mkdirSync(other);
  for (const f of ['test_base_00.tre', 'test_late_00.tre', 'sku1_client.toc', 'sku2_client.toc', 'sku3_client.toc']) copyFileSync(join(install, f), join(other, f));
  writeToc(join(other, 'sku0_client.toc'), baseTrees, [e('appearance/kept.msh', 0, base[0])]);
  const c = openVfs(other, { finalNames: list, log: () => {} });
  ok(c.late.state === 'none' && /sku0_client\.toc/.test(c.late.why) && same(snapshot(c), snapshot(openVfs(other, { finalNames: false, log: () => {} }))), 'other indexes are `none`, naming the index, and the mount is the one without the list');
  ok(probeInstall(other, list).state === 'no', 'and the probe says no');
  // (d) an archive that is not SOE's: one byte flipped at the same size; missing; left out by the filter.
  const flipped = join(root, 'flipped');
  mkdirSync(flipped);
  for (const f of readdirSync(install)) copyFileSync(join(install, f), join(flipped, f));
  const bytes = readFileSync(join(flipped, 'test_late_00.tre'));
  bytes[bytes.length - 3] ^= 0xff;
  writeFileSync(join(flipped, 'test_late_00.tre'), bytes);
  const d = openVfs(flipped, { finalNames: list, log: () => {} });
  ok(d.late.state === 'refused' && /test_late_00\.tre: its bytes are not SOE's/.test(d.late.why), `one byte flipped at the same size is refused, naming the archive (${d.late.why})`);
  ok(same(snapshot(d), snapshot(openVfs(flipped, { finalNames: false, log: () => {} }))), 'and the mount is identical to one without the list');
  ok(probeInstall(flipped, list).state === 'serves', 'the probe, which reads sizes only, cannot see a flipped byte (the mount can, and refuses)');
  {
    // What such a refusal is asked: never again on the probe's word alone (it would be asked in every status and
    // converted again in every convert, refused each time), and again once the refused archive has moved.
    const stamp = lateStampOf(d, 'props')!;
    const was = statSync(join(flipped, 'test_late_00.tre'));
    ok(stamp.state === 'refused' && stamp.seen?.['test_late_00.tre']?.size === was.size && stamp.seen['test_late_00.tre'].mtime === Math.round(was.mtimeMs), 'a refusal stamps what the refused archive was on disk, its size and when it was written');
    const now = { key: list.key, v: 1 };
    ok(lateAsk(stamp, now, probeInstall(flipped, list)) === null, 'a refusal the probe cannot see (a byte flipped at SOE\'s size) is not asked again on its `serves` alone');
    ok(lateAsk({ ...stamp, seen: undefined }, now, probeInstall(flipped, list)) !== null, 'a refusal stamped with nothing seen is asked as it always was');
    copyFileSync(join(install, 'test_late_00.tre'), join(flipped, 'test_late_00.tre'));
    const later = new Date(was.mtimeMs + 10_000);
    utimesSync(join(flipped, 'test_late_00.tre'), later, later);
    ok(/can now mount/.test(lateAsk(stamp, now, probeInstall(flipped, list)) ?? ''), 'and once the archive is written again (mended), it is asked');
    ok(openVfs(flipped, { finalNames: list, log: () => {} }).late.state === 'applied', 'which the mount then applies');
    ok(/can now mount/.test(lateAsk({ ...stamp, seen: { 'test_late_00.tre': null } }, now, probeInstall(flipped, list)) ?? ''), 'an archive missing at the refusal and there now is asked too');
  }
  {
    // An archive of another size than SOE's (a modded or a cut-short one): the probe says no, naming the size, and
    // the mount refuses it.
    const grown = join(root, 'grown');
    mkdirSync(grown);
    for (const f of readdirSync(install)) copyFileSync(join(install, f), join(grown, f));
    writeFileSync(join(grown, 'test_late_00.tre'), Buffer.concat([readFileSync(join(install, 'test_late_00.tre')), Buffer.from([0])]));
    const p = probeInstall(grown, list);
    ok(p.state === 'no' && /test_late_00\.tre is \d+ bytes, SOE's is \d+/.test(p.why ?? ''), `an archive a byte longer than SOE's: the probe says no, naming its size (${p.why})`);
    const g = openVfs(grown, { finalNames: list, log: () => {} });
    ok(g.late.state === 'refused' && /test_late_00\.tre: \d+ bytes, SOE's is \d+/.test(g.late.why), 'and the mount refuses it');
  }
  rmSync(join(flipped, 'test_late_00.tre'));
  const m = openVfs(flipped, { finalNames: list, log: () => {} });
  ok(m.late.state === 'refused' && /test_late_00\.tre: missing/.test(m.late.why) && same(snapshot(m), snapshot(openVfs(flipped, { finalNames: false, log: () => {} }))), 'a missing archive is refused the same way');
  ok(probeInstall(flipped, list).state === 'no', 'and the probe says no for it');
  const f = openVfs(install, { finalNames: list, filter: (n: string) => n !== 'test_late_00.tre', log: () => {} });
  ok(f.late.state === 'refused' && /left out by --retail-only/.test(f.late.why), 'an archive the filter leaves out is refused too');
  // (e) the row checker.
  ok(verifyFinalNames(install, list, { openTre }).length === 0, 'the row checker finds nothing wrong with the true list');
  const at = list.rows.findIndex((row: unknown[]) => row[2] === 'appearance/newer.msh');
  const moved = { ...list, rows: list.rows.map((row: unknown[], i: number) => (i === at ? [...row.slice(0, 4), (row[4] as number) + 1, ...row.slice(5)] : row)) };
  const bad = verifyFinalNames(install, moved, { openTre });
  ok(bad.length === 1 && bad[0].path === 'appearance/newer.msh', `and reports the one row moved a byte, nothing else (${bad.map((x: { path: string; why: string }) => `${x.path}: ${x.why}`).join('; ')})`);
  // A list that is no list leaves the mount as it is and says so.
  const broken = openVfs(install, { finalNames: { broken: 'TEST', key: null }, log: () => {} });
  ok(broken.late.state === 'none' && /cannot be used/.test(broken.late.why) && same(snapshot(broken), without), 'a list that failed its shape check is no list: the mount is today\'s and says why');

  // --- the stamp and what is asked of it ---
  const current = { key: list.key, v: 1 };
  const applied = { key: list.key, state: 'applied', rows: list.rows.length, v: 1 };
  ok(lateAsk(null, current, { state: 'serves' }) !== null && lateAsk(null, current, { state: 'no' }) === null && lateAsk(null, current, null) === null, 'no stamp is asked when the install can mount the list, not when it cannot, and not with no install named');
  ok(lateAsk(applied, current, { state: 'serves' }) === null && lateAsk({ ...applied, key: 'older' }, current, { state: 'serves' }) !== null && lateAsk({ ...applied, v: 0 }, current, { state: 'serves' }) !== null, 'a current stamp is not asked; an older list or a lower stamp version is');
  ok(lateAsk({ key: list.key, state: 'none', v: 1 }, current, { state: 'no' }) === null && lateAsk({ key: list.key, state: 'none', v: 1 }, current, { state: 'serves' }) !== null, 'a stamp that says none is asked only once the install can mount the list');
  ok(lateWorld(applied) === `names:${list.key}` && lateWorld(null) === 'publish54' && lateWorld({ state: 'refused' }) === 'publish54', 'the late worlds: the list, or publish 54');
  ok(!keptStale({ materialFormat: 99 }, { late: { state: 'none' } }, 'travel') && keptStale({ materialFormat: 99 }, { late: applied }, 'travel') && !keptStale({ materialFormat: 99, late: applied }, { late: applied }, 'travel') && keptStale({ materialFormat: 1, late: applied }, { late: applied }, 'travel'), 'a kept model is stale from another late world or an older material format, and kept from the same');
  // Another late world by each road the comparison of worlds alone answers (the stamp version cannot): a list made
  // again under another key, and a late pack kept under a publish 54 mount.
  ok(keptStale({ materialFormat: 99, late: { ...applied, key: 'other1234567' } }, { late: applied }, 'travel'), 'a kept model converted with another names list is stale');
  ok(keptStale({ materialFormat: 99, late: applied }, { late: { state: 'none' } }, 'travel'), 'and so is one converted with the list, kept under a mount without it');
  ok(!keptStale({ materialFormat: 99, late: { ...applied } }, null, 'travel'), 'and with no mount only the material format is asked');
} finally {
  rmSync(root, { recursive: true, force: true });
}

// --- 3. on the owner's install --------------------------------------------------------------------------------------
{
  const swg = swgDir();
  if (!swg) note('no SWG folder (set SWG or name it in .env): the list is not held against an install');
  else {
    const { isRetailByName } = await import('../manifest.mjs');
    const list = loadFinalNames();
    const vfs = openVfs(swg, { filter: (f: string) => isRetailByName(f, statSync(join(swg, f)).size) !== null, log: () => {} });
    // The probe `status` reads first: where it says this install can mount the list, the --retail-only mount every
    // conversion makes must have mounted it, or every conversion here is quietly the publish 54 world (and every
    // material test that compares a stamped pack with the archives would skip it). Only an install the list cannot
    // serve is a note.
    const probe = probeInstall(swg, list);
    if (probe.state === 'no') note(`the list cannot serve this install (${probe.why}); the mount is ${vfs.late.state}: nothing more is checked`);
    else ok(vfs.late.state === (probe.state === 'serves' ? 'applied' : 'final'), `the probe says ${probe.state} of ${swg}, and the --retail-only mount agrees (${vfs.late.state}${vfs.late.why ? `: ${vfs.late.why}` : ''})`);
    if (probe.state !== 'no') {
      const t0 = Date.now();
      const bad = verifyFinalNames(swg, list, { openTre });
      ok(bad.length === 0, `every set row reads at its length and SHA-1 from the install (${Date.now() - t0} ms${bad.length ? `; ${bad.length} bad, first ${bad[0].path}: ${bad[0].why}` : ''})`);
      if (vfs.late.state === 'applied') {
        const plain = openVfs(swg, { filter: (f: string) => isRetailByName(f, statSync(join(swg, f)).size) !== null, log: () => {}, finalNames: false });
        const want = plain.list().length + vfs.late.newPaths - list.rows.filter((r: unknown[]) => r[0] !== 'set' && plain.has(r[2] as string)).length;
        ok(vfs.list().length === want, `the mount has the base names plus the new less the gone (${plain.list().length} + ${vfs.late.newPaths} - gone = ${vfs.list().length})`);
        ok(vfs.list().length === 209017 && plain.list().length === 201956, `209,017 names where the publish 54 mount has 201,956 (${vfs.list().length}, ${plain.list().length})`);
        plain.close();
      }
      // The maintainer's check: the list is exactly the difference of the two mounts, with SOE's own indexes named.
      const tocs = process.env.SWG3JS_FINAL_TOCS;
      if (!tocs) note('SWG3JS_FINAL_TOCS not set: the list is not made again from SOE\'s own indexes (a maintainer\'s check)');
      else {
        const again = buildFinalNames(tocs, swg, { openToc, tocRank, openTre, archiveRank, ngeFinal: retail.nge_final });
        ok(finalNamesKey(finalNamesText(again.list)) === list.key, `made again from SOE's own indexes, the list is the committed one to the byte (${finalNamesKey(finalNamesText(again.list))})`);
      }
    }
    vfs.close();
  }
}

// --- 4. every command stamped or exempt -----------------------------------------------------------------------------
{
  const stamped = new Set(LATE_STAMPED.map((e) => e.command));
  const exempt = new Set(Object.keys(LATE_EXEMPT));
  const commands = Object.keys(STEP_FACTS);
  const neither = commands.filter((c) => !stamped.has(c) && !exempt.has(c));
  const both = commands.filter((c) => stamped.has(c) && exempt.has(c));
  ok(!neither.length && !both.length, `every command the converter's plan knows is stamped or exempt, never both (${commands.length}; ${neither.length ? `neither: ${neither.join(', ')}` : ''}${both.length ? ` both: ${both.join(', ')}` : ''})`);
  ok(stamped.has('radial') && stamped.has('spawns') && exempt.has('navgrid') && exempt.has('maps'), 'radial and spawns stamp; the walk grid and the maps are exempt');
  ok([...stamped].every((c) => commands.includes(c)), 'and nothing is stamped that the plan does not know');
}

// --- 5. the text pin -------------------------------------------------------------------------------------------------
{
  const cli = readFileSync(new URL('../cli.mjs', import.meta.url), 'utf8');
  ok(!cli.includes('materialStale('), "cli.mjs calls materialStale( nowhere: every keep-by-presence path asks keptStale, which asks the late stamp too");
  ok((cli.match(/keptStale\(/g) ?? []).length >= 3, 'and keptStale is asked where the travel models, the fittings and the nests are kept');
}

// --- 6. what a run left unwritten ------------------------------------------------------------------------------------
{
  const out = mkdtempSync(join(tmpdir(), 'swg3js-rewritten-'));
  try {
    const put = (rel: string, text = 'x') => {
      mkdirSync(join(out, rel, '..'), { recursive: true });
      writeFileSync(join(out, rel), text);
    };
    put('props/manifest.json', JSON.stringify({ models: [{ file: 'chair.glb' }, { file: 'table.glb' }] }));
    put('props/chair.glb');
    put('props/table.glb');
    put('props/orphan.glb');
    put('music/song.png');
    put('nge/thing.glb');
    // A JSON names only what stands at or under its own folder: the female wardrobe's names a mesh an older run left in
    // the male wardrobe's folder, which is left over and no fault (the pilot conversion's 798 old female meshes).
    put('wardrobe/human_female/wardrobe.json', JSON.stringify({ items: [{ file: 'x.glb' }] }));
    put('wardrobe/human_female/x.glb');
    put('wardrobe/human_male/wardrobe.json', JSON.stringify({ items: [{ file: 'y.glb' }] }));
    put('wardrobe/human_male/x.glb');
    const old = Date.now() - 60_000;
    const written = ['props/manifest.json', 'props/chair.glb', 'props/table.glb', 'props/orphan.glb', 'music/song.png', 'nge/thing.glb', 'wardrobe/human_female/wardrobe.json', 'wardrobe/human_female/x.glb', 'wardrobe/human_male/wardrobe.json', 'wardrobe/human_male/x.glb'];
    for (const rel of written) utimesSync(join(out, rel), old / 1000, old / 1000);
    const before = inventoryOf(out);
    const since = Date.now() - 1000;
    put('props/chair.glb', 'y');
    put('wardrobe/human_female/x.glb', 'y');
    const result = rewrittenCheck(out, { since, before, worlds: [], zones: [] });
    const faults = [...result.faults.values()];
    ok(faults.length === 1 && faults[0].owner === 'props' && faults[0].files.join() === 'props/table.glb', 'a model a stamped command left unwritten is a fault naming the command; the one rewritten passes');
    ok((result.leftOver.get('props .glb') ?? []).join() === 'props/orphan.glb', 'one no JSON names is reported apart, as left over from an older run');
    ok((result.leftOver.get('wardrobe .glb') ?? []).join() === 'wardrobe/human_male/x.glb' && !faults.some((f) => f.owner === 'wardrobe'), "and so is one only a sibling folder's JSON names: a JSON names what stands at or under its own folder");
    ok(![...result.faults.keys(), ...result.leftOver.keys()].some((k) => /^(music|nge)/.test(k)), 'an exempt folder and nge/ are skipped');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

console.log(`\n${passed} checks passed`);
