// The launcher's parts that can be tried with no network: the archive the bootstrap reads (against the
// pack's own writer and, where Windows' tar is there, against that), the install and its swap, the
// folder checks, `status --json` and what the launcher makes of it, the content types, the byte ranges,
// the path checks, what a release refuses to carry, the launcher's own server on this machine, and the
// page's palette against the game's.
//
// Synthetic throughout: nothing here reads a game install, and every folder it makes is a temporary one.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { checkJka, checkOut, checkSwg, formatBytes, isInside, roomFor, FULL_CONVERSION_BYTES } from '../checks.mjs';
import { labelOf, nextStep, planSteps, readStatus, setAside } from '../plan.mjs';
import { mimeOf, parseRange, resolveUnder } from '../serve.mjs';
import { blobHash, distFiles, refusal, releaseFiles, unreachedImports, ustarName, writeTar } from '../pack.mjs';
import { STEP_FACTS } from '../../swg/convertPlan.mjs';
import { splitCommand, statusJson } from '../../swg/statusplan.mjs';
import { isRetailByName } from '../../swg/manifest.mjs';
import { start, gameUrl } from '../main.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const boot = createRequire(import.meta.url)('../bootstrap.cjs');

let checks = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const throws = (fn, re, what) => {
  let err = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  ok(err && re.test(err.message), `${what}${err ? '' : ' (it did not throw)'}`);
};

const scratch = mkdtempSync(join(tmpdir(), 'swg3js launcher test '));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

// ---------------------------------------------------------------------------------------------
// The archive: the pack's writer, the bootstrap's reader.
{
  const longDir = `dist/assets/${'deep/'.repeat(20)}`;
  const entries = [
    { path: 'version.json', data: Buffer.from('{"format":1,"commit":"abc"}') },
    { path: 'dist/index.html', data: Buffer.from('<!doctype html>') },
    { path: `${longDir}file.js`, data: Buffer.from('x'.repeat(1300)) },
    { path: 'empty.txt', data: Buffer.alloc(0) },
  ];
  const tar = writeTar(entries, 1700000000);
  ok(tar.length % 512 === 0, 'the tar is whole 512-byte blocks');
  const back = boot.readTar(tar);
  ok(back.length === 4, `every entry reads back (${back.length})`);
  ok(back.every((e, i) => e.path === entries[i].path && Buffer.compare(e.data, entries[i].data) === 0), 'each with its own path and bytes, in order');
  ok(ustarName(`${longDir}file.js`).prefix.length > 0, 'a path past 100 bytes is split into the ustar prefix');
  ok(boot.readTarGz(gzipSync(tar)).length === 4, 'and the gzip\'d archive reads the same');
  const bad = Buffer.from(tar);
  bad[10] ^= 1;
  throws(() => boot.readTar(bad), /checksum/, 'a header with a wrong checksum is refused');
  throws(() => boot.readTar(writeTar([{ path: '../evil.txt', data: Buffer.from('x') }])), /not allowed/, 'a path that climbs out of the folder is refused');
  throws(() => boot.readTar(writeTar([{ path: '/abs.txt', data: Buffer.from('x') }])), /not relative/, 'an absolute path is refused');
  throws(() => boot.readTar(writeTar([{ path: 'C:/x.txt', data: Buffer.from('x') }])), /not relative/, 'a drive path is refused');
  throws(() => boot.readTar(tar.subarray(0, 1024)), /cut short/, 'an archive cut short is refused');
  ok(boot.safeEntryPath('./a/b/') === 'a/b', 'a folder entry\'s trailing slash and leading ./ are taken off');

  // Windows' own tar (bsdtar, which writes pax headers) or a GNU tar (which writes its own long names):
  // the reader must take either's archives, and either must read the pack's. Run in the scratch folder
  // with relative names, since a GNU tar takes `C:` in a path for a remote host.
  const winTar = process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'tar.exe') : '';
  const tarCmd = winTar && existsSync(winTar) ? winTar : 'tar';
  const tarExe = spawnSync(tarCmd, ['--version'], { encoding: 'utf8' });
  if (tarExe.status === 0) {
    const src = join(scratch, 'tarsrc');
    mkdirSync(join(src, 'a', 'b'), { recursive: true });
    writeFileSync(join(src, 'a', 'b', 'hello.txt'), 'hello');
    writeFileSync(join(src, 'a', `${'n'.repeat(120)}.txt`), 'long');
    const r = spawnSync(tarCmd, ['-cf', 'sys.tar', '-C', 'tarsrc', 'a'], { cwd: scratch, encoding: 'utf8' });
    ok(r.status === 0, `the system's tar (${tarExe.stdout.split('\n')[0].trim()}) made an archive to read${r.status === 0 ? '' : `: ${r.stderr}`}`);
    const read = boot.readTar(readFileSync(join(scratch, 'sys.tar')));
    const files = read.filter((e) => e.type === 'file');
    ok(files.some((e) => e.path === 'a/b/hello.txt' && e.data.toString() === 'hello'), 'an archive from the system\'s own tar reads');
    ok(files.some((e) => e.path === `a/${'n'.repeat(120)}.txt` && e.data.toString() === 'long'), 'with a name past 100 bytes');
    // And the other way: the system's tar lists what the pack writes.
    writeFileSync(join(scratch, 'mine.tar'), tar);
    const listed = spawnSync(tarCmd, ['-tf', 'mine.tar'], { cwd: scratch, encoding: 'utf8' });
    ok(listed.status === 0 && listed.stdout.includes(`${longDir}file.js`), 'the system\'s tar reads the pack\'s archive, long path and all');
  } else console.log('skip the system tar is not here');
}

// ---------------------------------------------------------------------------------------------
// The install and its swap.
{
  const data = join(scratch, 'data');
  mkdirSync(data, { recursive: true });
  const release = (commit, extra = []) => gzipSync(writeTar([{ path: 'version.json', data: Buffer.from(JSON.stringify({ format: 1, commit })) }, { path: boot.LAUNCHER_ENTRY, data: Buffer.from('export function start() {}') }, ...extra]));
  const one = release('one', [{ path: 'dist/index.html', data: Buffer.from('1') }]);
  const v1 = boot.installArchive(data, one, { size: one.length, sha256: boot.sha256(one) });
  ok(v1.commit === 'one' && readFileSync(join(data, 'app', 'dist', 'index.html'), 'utf8') === '1', 'a release installs into app/');
  const two = release('two', [{ path: 'dist/index.html', data: Buffer.from('2') }]);
  boot.installArchive(data, two, { size: two.length, sha256: boot.sha256(two), commit: 'two' });
  ok(readFileSync(join(data, 'app', 'dist', 'index.html'), 'utf8') === '2', 'a newer one replaces it');
  throws(() => boot.installArchive(data, one, { size: one.length, sha256: '0'.repeat(64) }), /SHA-256/, 'a download that does not match its SHA-256 is refused');
  throws(() => boot.installArchive(data, one, { size: one.length + 1, sha256: boot.sha256(one) }), /bytes/, 'and one of the wrong size');
  throws(() => boot.installArchive(data, one, {}), /no SHA-256/, 'a record with no SHA-256 is refused before anything is unpacked');
  throws(() => boot.installArchive(data, one, { size: one.length }), /no SHA-256/, 'and so is one with a size alone');
  throws(() => boot.installArchive(data, one, { sha256: boot.sha256(one) }), /no size/, 'and one with a SHA-256 and no size');
  throws(() => boot.installArchive(data, one, { size: one.length, sha256: 'abc' }), /no SHA-256/, 'and one whose SHA-256 is not 64 hex digits');
  throws(() => boot.installArchive(data, one, { size: one.length, sha256: boot.sha256(one), commit: 'two' }), /release record says/, 'an archive of another commit than its record says is refused');
  throws(() => boot.installArchive(data, gzipSync(writeTar([{ path: 'dist/index.html', data: Buffer.from('3') }])), { unchecked: true }), /version\.json/, 'an archive with no version.json is refused');
  throws(() => boot.installArchive(data, gzipSync(writeTar([{ path: 'version.json', data: Buffer.from('{"format":99,"commit":"x"}') }])), { unchecked: true }), /format 99/, 'and one of a format this bootstrap does not know');
  ok(readFileSync(join(data, 'app', 'dist', 'index.html'), 'utf8') === '2' && JSON.parse(readFileSync(join(data, 'app', 'version.json'), 'utf8')).commit === 'two', 'after every refusal the install is exactly as it was');
  ok(!readdirSync(data).some((n) => /^app\./.test(n)), 'and no half-made folder is left beside it');
  const full = { format: 1, commit: 'c', archive: { name: 'a.tar.gz', size: 10, sha256: 'a'.repeat(64) } };
  ok(boot.recordComplete(full) && !boot.recordComplete({ ...full, commit: '' }) && !boot.recordComplete({ ...full, archive: { ...full.archive, sha256: undefined } }) && !boot.recordComplete({ ...full, archive: { ...full.archive, size: 0 } }) && !boot.recordComplete(null), 'a release record is complete only with its commit, size and SHA-256');
  mkdirSync(join(data, 'app.new-1-2'), { recursive: true });
  mkdirSync(join(data, 'app.old-1-2'), { recursive: true });
  boot.clearLeftovers(data);
  ok(!existsSync(join(data, 'app.new-1-2')) && !existsSync(join(data, 'app.old-1-2')) && existsSync(join(data, 'app')), 'a crashed start\'s leftovers are cleared, the install kept');
  // A start that died between the swap's two renames: no app, the good install as app.old-*, the new
  // one as app.new-*. The good one comes back.
  renameSync(join(data, 'app'), join(data, 'app.old-7-100'));
  mkdirSync(join(data, 'app.new-7-100', 'dist'), { recursive: true });
  writeFileSync(join(data, 'app.new-7-100', 'version.json'), '{"format":1,"commit":"half"}');
  boot.clearLeftovers(data);
  ok(existsSync(join(data, 'app')) && JSON.parse(readFileSync(join(data, 'app', 'version.json'), 'utf8')).commit === 'two' && !readdirSync(data).some((n) => /^app\./.test(n)), 'a swap cut between its renames puts the last good install back rather than clearing it');
  // A local release archive, checked against the record beside it.
  const dir = join(scratch, 'local');
  mkdirSync(dir, { recursive: true });
  const three = release('three');
  writeFileSync(join(dir, 'swg3js-release.tar.gz'), three);
  writeFileSync(join(dir, 'release.json'), JSON.stringify({ format: 1, commit: 'three', archive: { name: 'swg3js-release.tar.gz', size: three.length, sha256: boot.sha256(three) } }));
  const answer = boot.installLocal(data, join(dir, 'swg3js-release.tar.gz'));
  ok(answer.updated && answer.to === 'three' && /SHA-256 checked/.test(answer.note), 'a local archive installs, checked against its release.json');
  writeFileSync(join(dir, 'release.json'), JSON.stringify({ format: 1, commit: 'three', archive: { name: 'swg3js-release.tar.gz', size: three.length, sha256: 'f'.repeat(64) } }));
  throws(() => boot.installLocal(data, join(dir, 'swg3js-release.tar.gz')), /SHA-256/, 'and is refused when that record does not match it');
  writeFileSync(join(dir, 'release.json'), JSON.stringify({ format: 1, commit: 'three', archive: { name: 'swg3js-release.tar.gz', size: three.length, sha256: boot.sha256(three) } }));
  ok(boot.installLocal(data, dir).to === 'three', 'a packed release\'s folder installs the archive its record names');
  writeFileSync(join(dir, 'release.json'), JSON.stringify({ format: 1, commit: 'three', archive: { name: 'swg3js-release.tar.gz' } }));
  throws(() => boot.installLocal(data, join(dir, 'swg3js-release.tar.gz')), /no SHA-256/, 'a record beside it that names it without a SHA-256 is refused, as a download is');
  rmSync(join(dir, 'release.json'));
  ok(/not checked/.test(boot.installLocal(data, join(dir, 'swg3js-release.tar.gz')).note), 'an archive given by hand with no record at all installs, and says it was not checked');
  const o = boot.parseOptions(['--data=C:\\x y', '--from-archive=a.tar.gz', '--offline', '--no-open', '--port=5000']);
  ok(o.data === 'C:\\x y' && o.fromArchive === 'a.tar.gz' && o.offline && !o.open && o.port === 5000, 'the bootstrap\'s own options read');
  const c = boot.childCommand('C:\\app\\tools\\swg\\cli.mjs', ['status', 'x']);
  ok(c.args[0] === boot.RUN_FLAG && c.args[1].endsWith('cli.mjs') && c.args[3] === 'x', 'a child is the exe told which file to run, then its arguments');
}

// ---------------------------------------------------------------------------------------------
// The folder checks.
{
  const swg = join(scratch, 'SWG client');
  mkdirSync(join(swg, 'saves'), { recursive: true });
  ok(!checkSwg('').ok && /Choose/.test(checkSwg('').sentence), 'no SWG folder asks for one');
  ok(!checkSwg(join(scratch, 'nowhere')).ok, 'a folder that is not there is refused');
  ok(!checkSwg(swg).ok && /no \.tre/.test(checkSwg(swg).sentence), 'a folder with no archives says so');
  const parent = join(scratch, 'Games');
  mkdirSync(join(parent, 'SWG'), { recursive: true });
  writeFileSync(join(parent, 'SWG', 'bottom.tre'), '');
  ok(/choose that folder instead/.test(checkSwg(parent).sentence), 'one level too high points at the folder below');
  writeFileSync(join(swg, 'custom_mod.tre'), 'x');
  ok(!checkSwg(swg, () => null).ok && /none of them/.test(checkSwg(swg, () => null).sentence), 'archives that are none of the retail ones are refused');
  writeFileSync(join(swg, 'bottom.tre'), 'x');
  const good = checkSwg(swg, (n) => (n === 'bottom.tre' ? 'set' : null));
  ok(good.ok && good.retail === 1 && good.archives === 2, 'a retail archive makes it a client folder');
  ok(isRetailByName('bottom.tre', 16205884) !== null && isRetailByName('my_own_mod.tre', 5) === null, 'the converter\'s own inventory is what judges an archive');

  const jka = join(scratch, 'Jedi Academy');
  mkdirSync(join(jka, 'GameData', 'base'), { recursive: true });
  ok(checkJka('').optional && !checkJka('').ok, 'no Jedi Academy folder is allowed and said to be optional');
  ok(/GameData/.test(checkJka(jka).sentence) && !checkJka(jka).ok, 'the install folder points at GameData');
  writeFileSync(join(jka, 'GameData', 'base', 'assets0.pk3'), '');
  ok(checkJka(join(jka, 'GameData')).ok, 'GameData with base\\assets0.pk3 is taken');
  ok(checkJka(join(jka, 'GameData', 'base')).ok, 'and so is its base folder');

  const app = join(scratch, 'data', 'app');
  ok(!checkOut('C:\\').ok || process.platform !== 'win32', 'a drive root is refused');
  ok(!checkOut(join(app, 'content'), { appDir: app }).ok, 'a folder inside the install is refused');
  ok(!checkOut(join(swg, 'out'), { swg }).ok, 'a folder inside the game is refused');
  const fresh = checkOut(join(scratch, 'content', 'new'));
  ok(fresh.ok && fresh.empty, 'a folder not yet made is fine, and empty');
  const busy = join(scratch, 'busy');
  mkdirSync(busy);
  writeFileSync(join(busy, 'letter.docx'), 'x');
  ok(!checkOut(busy).ok, 'a folder full of something else is refused');
  const packs = join(scratch, 'packs');
  mkdirSync(join(packs, 'tatooine'), { recursive: true });
  const had = checkOut(packs);
  ok(had.ok && !had.empty, 'a folder of converted content is taken, and not empty');
  const small = join(scratch, 'small');
  mkdirSync(small);
  writeFileSync(join(small, 'galaxy.json'), '{}');
  const smallCheck = checkOut(small);
  ok(smallCheck.ok && smallCheck.empty, 'one that holds only the galaxy file still has the whole conversion ahead of it');
  ok(isInside('C:\\A\\b', 'c:\\a') === (process.platform === 'win32'), 'inside is case-blind on Windows');

  ok(!roomFor(packs, { empty: true }, 1024 ** 3).ok, 'a first conversion with 1 GB free is refused');
  ok(/needs about/.test(roomFor(packs, { empty: true }, 1024 ** 3).sentence), 'saying how much it needs');
  ok(roomFor(packs, { empty: true }, FULL_CONVERSION_BYTES + 1).ok, 'and started with enough');
  ok(roomFor(packs, { empty: false }, 4 * 1024 ** 3).ok, 'a top-up needs only a margin');
  ok(roomFor(packs, {}, null).ok, 'a disk whose free space cannot be read does not block');
  ok(formatBytes(1536 * 1024 ** 2) === '1.5 GB' && formatBytes(2048) === '2 KB', 'sizes read in words');
}

// ---------------------------------------------------------------------------------------------
// status --json and what the launcher makes of it.
{
  const dir = 'C:\\Users\\a b\\my packs';
  const todo = new Map([
    [`snapshot <swg-dir> all ${dir} --radius=all --retail-only`, ['tatooine has no pack', 'naboo has no pack', 'a', 'b', 'c']],
    [`player <swg-dir> ${dir} --retail-only`, ['no player']],
    [`clips-save ${dir}\\player\\human_male.glb ${dir}\\player\\jka.clips --only=BOTH_ && clips-apply ${dir}\\characters\\human_male\\rig.glb ${dir}\\player\\jka.clips`, ['jka clips']],
    [`sounds <swg-dir> ${dir} --retail-only`, ['no bank']],
    [`sounds <swg-dir> ${dir} --retail-only --jka=<jedi-academy-gamedata>`, ['no events']],
  ]);
  ok(JSON.stringify(splitCommand(`maps <swg-dir> ${dir} --retail-only`, dir)) === JSON.stringify(['maps', '@SWG', dir, '--retail-only']), 'a folder with spaces stays one argument');
  const j = statusJson(todo, dir, ['a line']);
  ok(j.format === 1 && !j.done && j.lines[0] === 'a line', 'the JSON carries its format, whether anything is left, and the report');
  ok(j.steps.map((s) => s.command).join(',') === 'snapshot,player,clips-save,clips-apply,sounds,sounds', `the steps keep status's order, a && line as two (${j.steps.map((s) => s.command).join(',')})`);
  ok(j.steps[0].reason === 'tatooine has no pack; naboo has no pack; a; and 2 more', 'a long list of reasons reads as the human report does');
  ok(j.steps[2].args[1] === `${dir}\\player\\human_male.glb`, 'a path under the folder is one argument too');
  ok(j.steps[1].jka === 'takes' && j.steps[5].jka === 'needs' && j.steps[0].jka === null, 'which steps take or need Jedi Academy');
  const empty = statusJson(new Map(), dir);
  ok(empty.done && empty.steps.length === 0, 'nothing to do is done');

  const folders = { swg: 'D:\\SWG', jka: 'E:\\JKA\\GameData', out: dir };
  const plan = planSteps(j, folders);
  ok(plan[0].args[1] === 'D:\\SWG' && plan[0].args.includes('--retail-only'), '@SWG becomes the chosen folder');
  ok(plan[1].args.includes('--jka=E:\\JKA\\GameData'), 'the player is given Jedi Academy when there is one');
  const sounds = plan.filter((s) => s.args[0] === 'sounds');
  ok(sounds.length === 1 && sounds[0].args.includes('--jka=E:\\JKA\\GameData') && /no bank; no events/.test(sounds[0].reason), 'two sounds steps that come out the same are one, with both reasons');
  const noJka = planSteps(j, { ...folders, jka: '' });
  ok(noJka.find((s) => s.args[0] === 'player').args.every((a) => !a.startsWith('--jka')), 'without Jedi Academy the player runs without it');
  ok(noJka.filter((s) => s.skip).length === 1 && /Jedi Academy/.test(noJka.find((s) => s.skip).skip), 'and a step that needs it is marked, not run');
  ok(labelOf(['snapshot']) === 'Planets: objects, terrain, sky and flora' && labelOf(['brand-new']) === 'brand-new', 'steps read in words, and a new command by its name');
  ok(labelOf(['wardrobe', '@SWG', 'x', '--gender=female']) === 'The wardrobe (female)', 'a wardrobe run says which');

  const history = new Map();
  ok(nextStep(plan, history) === plan[0], 'the first step comes first');
  history.set(plan[0].key, { runs: 1, reason: plan[0].reason, failed: false });
  const stuck = [];
  ok(nextStep(plan, history, stuck) === plan[1] && stuck[0] === plan[0], 'a step asked again for the same reasons after it ran is passed over as stuck');
  history.set(plan[0].key, { runs: 1, reason: 'something else', failed: false });
  ok(nextStep(plan, history) === plan[0], 'but one asked again for new reasons runs again');
  history.set(plan[0].key, { runs: 1, reason: 'x', failed: true });
  ok(nextStep(plan, history) === plan[1], 'a step that failed is not run again in the same drive');
  ok(nextStep([], new Map()) === null, 'nothing left is null');

  throws(() => readStatus('{"format":2,"steps":[]}'), /format 2/, 'a status format this launcher does not know is refused');
  ok(readStatus('a warning\n{"format":1,"steps":[],"done":true}').done, 'text before the JSON is passed over');

  // The real converter, on a folder with a space in its name that holds nothing: it needs no archives.
  const out = join(scratch, 'converted content');
  mkdirSync(out, { recursive: true });
  const r = spawnSync(process.execPath, [join(root, 'tools', 'swg', 'cli.mjs'), 'status', out, '--json'], { encoding: 'utf8' });
  ok(r.status === 0, 'status --json runs on an empty folder');
  const real = readStatus(r.stdout);
  ok(real.dir === resolve(out) && !real.done && real.steps[0].command === 'snapshot', 'and asks for the planets first');
  ok(real.steps.every((s) => s.args.includes(resolve(out)) || s.args.some((a) => a.startsWith(resolve(out)))), 'every step names the folder whole');
  // Every step that opens an archive is retail-only. A couple of commands open none at all -- they
  // are built out of packs that are already converted -- and asking those for `--retail-only` would
  // be asking them about something they never look at.
  const ARCHIVE_FREE = new Set(['navgrid', 'scenes', 'clouds']);
  const fromArchives = real.steps.filter((s) => !ARCHIVE_FREE.has(s.command));
  ok(fromArchives.every((s) => s.args.includes('--retail-only')), `every step that reads an archive is retail-only (${fromArchives.length} of ${real.steps.length})`);
  ok(real.steps.filter((s) => ARCHIVE_FREE.has(s.command)).every((s) => !s.args.includes('--retail-only')), 'and the ones that read none do not pretend to care');
  ok(real.lines.some((l) => /tatooine: no pack/.test(l)), 'the human report comes with it');
  const human = spawnSync(process.execPath, [join(root, 'tools', 'swg', 'cli.mjs'), 'status', out], { encoding: 'utf8' });
  ok(human.stdout.includes('to fill the gaps') && !human.stdout.trim().startsWith('{'), 'without --json the report is the human one');
  ok(Array.isArray(real.unreadable) && real.unreadable.length === 0, 'an empty folder has nothing unreadable');

  // A step stopped in the middle of writing its JSON: status takes the file as missing rather than
  // stopping on it, names it, and the drive sets it aside so the step that writes it can run again.
  const cutDir = join(scratch, 'cut short');
  mkdirSync(join(cutDir, 'tatooine'), { recursive: true });
  const cutFile = join(cutDir, 'tatooine', 'manifest.json');
  writeFileSync(cutFile, '{"objects":[{"a":');
  const cutJson = spawnSync(process.execPath, [join(root, 'tools', 'swg', 'cli.mjs'), 'status', cutDir, '--json'], { encoding: 'utf8' });
  ok(cutJson.status === 0, `status --json does not stop on a manifest cut short${cutJson.status === 0 ? '' : `: ${cutJson.stderr.split('\n')[0]}`}`);
  const cut = readStatus(cutJson.stdout);
  ok(cut.unreadable.length === 1 && resolve(cut.unreadable[0]) === resolve(cutFile), 'it names the file it could not read');
  ok(cut.steps.some((s) => s.command === 'snapshot') && cut.lines.some((l) => /tatooine\/manifest\.json: cannot be read/.test(l)), 'asks for the step that writes it, and says why in the report');
  const cutHuman = spawnSync(process.execPath, [join(root, 'tools', 'swg', 'cli.mjs'), 'status', cutDir], { encoding: 'utf8' });
  ok(cutHuman.status === 0 && /cannot be read/.test(cutHuman.stdout), 'and the human report does not stop on it either');
  const said = [];
  const moved = setAside(cut.unreadable, cutDir, (l) => said.push(l), 1234);
  ok(moved.moved === 1 && !moved.failed && !existsSync(cutFile) && existsSync(`${cutFile}.cut-1234`) && said.length === 1, 'the drive renames it beside itself, never deleting it, and says so');
  ok(/outside/.test(setAside([join(scratch, 'elsewhere.json')], cutDir).failed), 'a file outside the converted content is never touched');
  ok(setAside([cutFile], cutDir).moved === 0 && setAside(undefined, cutDir).moved === 0, 'a file already gone, or an older status with no list, moves nothing');
  const after = readStatus(spawnSync(process.execPath, [join(root, 'tools', 'swg', 'cli.mjs'), 'status', cutDir, '--json'], { encoding: 'utf8' }).stdout);
  ok(after.unreadable.length === 0 && after.steps[0].command === 'snapshot', 'after which status asks for the planets as for a folder that never had them');
}

// ---------------------------------------------------------------------------------------------
// Serving: types, ranges, paths.
{
  const want = { 'a.js': 'text/javascript', 'a.mjs': 'text/javascript', 'x.wasm': 'application/wasm', 'm.json': 'application/json', 'ship.glb': 'model/gltf-binary', 'p.png': 'image/png', 's.wav': 'audio/wav', 'i.svg': 'image/svg+xml', 'i.html': 'text/html', 'c.css': 'text/css', 'b.bin': 'application/octet-stream', 'x.unknown': 'application/octet-stream', 'UP.PNG': 'image/png' };
  ok(Object.entries(want).every(([f, t]) => mimeOf(f).startsWith(t)), 'every kind the game fetches has its type, whatever the case');
  const size = 1000;
  ok(parseRange(undefined, size) === null && parseRange('', size) === null, 'no Range is the whole file');
  ok(JSON.stringify(parseRange('bytes=0-99', size)) === '{"start":0,"end":99}', 'a plain range');
  ok(JSON.stringify(parseRange('bytes=900-', size)) === '{"start":900,"end":999}', 'an open-ended range');
  ok(JSON.stringify(parseRange('bytes=-100', size)) === '{"start":900,"end":999}', 'a suffix range');
  ok(JSON.stringify(parseRange('bytes=990-5000', size)) === '{"start":990,"end":999}', 'a range past the end is cut to it');
  ok(parseRange('bytes=1000-', size) === 'unsatisfiable' && parseRange('bytes=-0', size) === 'unsatisfiable', 'a range wholly past the end cannot be met');
  ok(parseRange('bytes=0-1,5-6', size) === null && parseRange('items=0-5', size) === null && parseRange('bytes=9-3', size) === null, 'several ranges, another unit or a backward range are answered whole');
  const base = join(scratch, 'site');
  ok(resolveUnder(base, '/a/b.js') === join(base, 'a', 'b.js'), 'a path under the folder resolves');
  ok(resolveUnder(base, '/../secret') === null && resolveUnder(base, '/..%2f..%2fsecret') === null && resolveUnder(base, '/a/..\\..\\x') === null, 'a path that climbs out does not');
  ok(resolveUnder(base, '/%E0%A4%A') === null && resolveUnder(base, '/a%00b') === null, 'nor a broken escape or a NUL');
  ok(resolveUnder(base, '/sp%20ace.png') === join(base, 'sp ace.png'), 'an escaped space is a space');
  ok(gameUrl(47031, 'ws://10.0.0.2:8787', 'kessel') === 'http://127.0.0.1:47031/?server=ws%3A%2F%2F10.0.0.2%3A8787&word=kessel', 'the game address carries a server and its word');
  ok(gameUrl(47031) === 'http://127.0.0.1:47031/', 'and none when playing alone');
}

// ---------------------------------------------------------------------------------------------
// What a release refuses to carry.
{
  ok(refusal('dist/assets-private/x.json') && refusal('Assets-Private/a.png') && refusal('dist/data.tre') && refusal('x/y.PK3') && refusal('tools/.env'), 'converted content, archives and a machine\'s .env are refused');
  ok(refusal('dist/assets/index-abc.js') === null && refusal('tools/swg/cli.mjs') === null, 'the game\'s own files are not');
  // A build folder as Vite leaves it: index.html, the manifest, its chunks, a worker only a chunk names,
  // and a tracked public file.
  const fake = join(scratch, 'fakeroot');
  const dist = join(fake, 'dist');
  const put = (rel, text) => {
    mkdirSync(dirname(join(dist, rel)), { recursive: true });
    writeFileSync(join(dist, rel), text);
  };
  put('index.html', '<script type="module" src="./assets/index-AbCd1234.js"></script>');
  put('assets/index-AbCd1234.js', 'new Worker(new URL("paintWorker-Zz_9-xYw.js", import.meta.url)); fetch("./assets-private/galaxy.json");');
  put('assets/index-Qq11Ww22.css', 'body{}');
  put('assets/paintWorker-Zz_9-xYw.js', 'self.onmessage = () => {};');
  put('assets/characters/xbot.glb', 'glb');
  put('.vite/manifest.json', JSON.stringify({ 'index.html': { file: 'assets/index-AbCd1234.js', isEntry: true, css: ['assets/index-Qq11Ww22.css'] } }));
  const tracked = new Map([['public/assets/characters/xbot.glb', blobHash(Buffer.from('glb'))], ['package.json', 'x']]);
  const clean = distFiles(dist, tracked);
  ok(clean.problems.length === 0 && clean.files.join(',') === 'assets/characters/xbot.glb,assets/index-AbCd1234.js,assets/index-Qq11Ww22.css,assets/paintWorker-Zz_9-xYw.js,index.html', `a clean build is taken whole, the worker its chunk names included, the manifest left out (${clean.problems.join('; ') || clean.files.join(',')})`);
  // Converted content under any name at all, which is what the old listing packed.
  put('content/galaxy.json', '{}');
  put('content/grenade_fungus_stump.glb', 'glb2');
  const leaked = distFiles(dist, tracked);
  ok(leaked.problems.some((p) => p.includes('content/galaxy.json')) && leaked.problems.some((p) => p.includes('content/grenade_fungus_stump.glb')) && !leaked.files.some((f) => f.startsWith('content/')), 'converted content under a folder of any other name is refused, even a name the code itself fetches');
  rmSync(join(dist, 'content'), { recursive: true });
  put('assets/stray-12345678.glb', 'x');
  ok(distFiles(dist, tracked).problems.some((p) => p.includes('stray-12345678.glb')), 'and a hashed-looking file no chunk names');
  rmSync(join(dist, 'assets', 'stray-12345678.glb'));
  put('assets/characters/xbot.glb', 'changed here');
  ok(distFiles(dist, tracked).problems.some((p) => /not the public\/assets\/characters\/xbot\.glb git holds/.test(p)), 'a public file that is not what git holds is refused');
  put('assets/characters/xbot.glb', 'glb');
  put('untracked-public.png', 'x');
  ok(distFiles(dist, tracked).problems.some((p) => p.includes('untracked-public.png')), 'and one git does not track');
  rmSync(join(dist, 'untracked-public.png'));
  mkdirSync(join(dist, 'assets-private', 'tatooine'), { recursive: true });
  ok(/assets-private/.test(distFiles(dist, tracked).problems.join()), 'a build folder holding assets-private stops the pack');
  rmSync(join(dist, 'assets-private'), { recursive: true });
  rmSync(join(dist, '.vite'), { recursive: true });
  ok(/no Vite manifest/.test(distFiles(dist, tracked).problems.join()), 'and one with no manifest, since nothing then says what the build made');
  // Outside the build, only what git knows.
  mkdirSync(join(fake, 'tools', 'swg'), { recursive: true });
  writeFileSync(join(fake, 'tools', 'swg', 'stray.mjs'), '');
  writeFileSync(join(fake, 'tools', 'swg', 'known.mjs'), '');
  const listed = (() => {
    try {
      return releaseFiles({ root: fake, dist, git: { tracked: new Map([['tools/swg/known.mjs', 'x']]), untracked: new Set() } });
    } catch (e) {
      return e.message;
    }
  })();
  ok(typeof listed === 'string' && /tools\/swg\/known\.mjs is missing|package\.json|README/.test(listed) && !listed.includes('stray.mjs'), 'a converter module git does not know is never listed at all');
  let noGit = null;
  try {
    releaseFiles({ root: fake, dist });
  } catch (e) {
    noGit = e;
  }
  ok(noGit && /not a git checkout/.test(noGit.message), 'and a folder that is not a checkout cannot be packed');
  const packSrc = readFileSync(join(root, 'tools', 'launcher', 'pack.mjs'), 'utf8');
  ok(/--dist is not taken/.test(packSrc) && /--with-untracked is for trying a release on this machine and is never CI/.test(packSrc), 'the pack takes no dist folder of anyone else\'s, and CI never packs untracked files');
}
{
  // The real checkout's list: every relative file its code names is in it. It is handed the smallest
  // build the pack accepts (a page and an empty manifest) rather than none, because with no build at
  // all `releaseFiles` stops at "holds no built game" before it ever looks at what the code names: this
  // test passed that way for two days while every release CI tried to pack was refused for leaving out
  // five files the converter imports, and the launcher stayed on an older game.
  const mini = join(scratch, 'minidist');
  mkdirSync(join(mini, '.vite'), { recursive: true });
  writeFileSync(join(mini, 'index.html'), '<!doctype html>');
  writeFileSync(join(mini, '.vite', 'manifest.json'), '{}');
  let err = null;
  try {
    releaseFiles({ root, dist: mini, untracked: true });
  } catch (e) {
    err = e;
  }
  ok(!err, `the checkout's own list is complete${err ? `: ${err.message}` : ''}`);
  const lib = join(scratch, 'importer');
  mkdirSync(join(lib, 'tools'), { recursive: true });
  writeFileSync(join(lib, 'tools', 'a.mjs'), "import './b.mjs';\nconst x = await import('../src/c.ts');\nnew URL('./d.json', import.meta.url);\nimport './gone.mjs';");
  for (const f of ['tools/b.mjs', 'src/c.ts', 'tools/d.json']) {
    mkdirSync(dirname(join(lib, f)), { recursive: true });
    writeFileSync(join(lib, f), '');
  }
  const missing = unreachedImports([{ path: 'tools/a.mjs', from: join(lib, 'tools', 'a.mjs') }, { path: 'tools/b.mjs', from: join(lib, 'tools', 'b.mjs') }], lib);
  ok(missing.length === 2 && missing[0].startsWith('src/c.ts') && missing[1].startsWith('tools/d.json'), `a named file left out of the list is found, and a name with no file is not (${missing.join('; ')})`);
}

// ---------------------------------------------------------------------------------------------
// The launcher's own server, on this machine only.
{
  const data = join(scratch, 'launcher data');
  const app = join(scratch, 'launcher app');
  mkdirSync(join(app, 'dist', 'assets'), { recursive: true });
  writeFileSync(join(app, 'dist', 'index.html'), '<!doctype html><title>game</title>');
  writeFileSync(join(app, 'dist', 'assets', 'main-1.js'), 'export const x = 1;');
  const out = join(scratch, 'served content');
  mkdirSync(join(out, 'tatooine'), { recursive: true });
  const bytes = Buffer.alloc(5000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
  writeFileSync(join(out, 'tatooine', 'big.glb'), bytes);
  mkdirSync(data, { recursive: true });
  // Typed as a relative path, as a player might: it is made absolute where it is checked, so the
  // converter, which runs in another working folder, is handed the same folder.
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ out: 'served content' }));
  const logs = [];
  const cwd = process.cwd();
  process.chdir(scratch);
  const launcher = await start({ dataDir: data, appDir: app, open: false, port: 0, log: (l) => logs.push(l), update: { note: 'test' }, childCommand: (file, args) => ({ command: process.execPath, args: [file.endsWith('cli.mjs') ? join(root, 'tools', 'swg', 'cli.mjs') : file, ...args] }) });
  process.chdir(cwd);
  const port = launcher.port;
  const get = (path, headers = {}) =>
    new Promise((res, rej) => {
      const req = request({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (r) => {
        const chunks = [];
        r.on('data', (d) => chunks.push(d));
        r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', rej);
      req.end();
    });
  ok(JSON.parse(readFileSync(join(data, 'launcher.json'), 'utf8')).port === port, 'the launcher notes its port for the next start to find');
  const ping = await get('/launcher/api/ping');
  ok(ping.status === 200 && JSON.parse(ping.body).app === 'swg3js-launcher', 'it answers the ping a second start looks for');
  ok((await get('/launcher/api/state')).status === 403, 'its state is refused without the page\'s token');
  const state = await get('/launcher/api/state', { 'x-swg3js-token': launcher.token });
  ok(state.status === 200, 'and given with it');
  ok(JSON.parse(state.body).settings.out === out, 'a folder typed as a relative path is kept absolute');
  ok((await get('/', { host: 'evil.example:80' })).status === 421, 'a request that names another host is refused');
  const page = await get('/launcher/');
  ok(page.status === 200 && page.body.toString().includes(launcher.token), 'the page is served with its token');
  const index = await get('/');
  ok(index.status === 200 && index.headers['content-type'].startsWith('text/html') && /game/.test(index.body), 'the game is served at /');
  const js = await get('/assets/main-1.js');
  ok(js.headers['content-type'].startsWith('text/javascript') && /immutable/.test(js.headers['cache-control']), 'a bundle as JavaScript, kept');
  const whole = await get('/assets-private/tatooine/big.glb');
  ok(whole.status === 200 && whole.headers['content-type'] === 'model/gltf-binary' && whole.body.length === 5000 && whole.headers['accept-ranges'] === 'bytes', 'the converted content is served at /assets-private/');
  const part = await get('/assets-private/tatooine/big.glb', { range: 'bytes=100-199' });
  ok(part.status === 206 && part.body.length === 100 && part.body[0] === 100 && part.headers['content-range'] === 'bytes 100-199/5000', 'a byte range comes back as exactly those bytes');
  ok((await get('/assets-private/tatooine/big.glb', { range: 'bytes=9000-' })).status === 416, 'a range past the end is answered 416');
  ok((await get('/assets-private/..%2f..%2fsettings.json')).status === 403, 'nothing outside the content folder is served');
  ok((await get('/assets-private/tatooine/none.glb')).status === 404, 'a file that is not there is 404');
  await launcher.shutdown({ exit: false });
  ok(!existsSync(join(data, 'launcher.json')), 'on the way out it takes its note away');
}

// ---------------------------------------------------------------------------------------------
// The page wears the game's own palette, name for name and value for value.
{
  const block = (text, from) => {
    const start = text.indexOf(from);
    const end = text.indexOf('/* /palette */', start);
    assert.ok(start >= 0 && end > start);
    const out = new Map();
    for (const m of text.slice(start, end).matchAll(/--([a-z-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
    return out;
  };
  const game = block(readFileSync(join(root, 'src', 'style.css'), 'utf8'), '/* palette:');
  const page = block(readFileSync(join(root, 'tools', 'launcher', 'page.html'), 'utf8'), '/* palette:');
  ok(game.size === 18, 'the game declares eighteen colours');
  ok(page.size === game.size && [...game].every(([k, v]) => page.get(k) === v), 'the launcher page declares the same eighteen with the same values');
  const html = readFileSync(join(root, 'tools', 'launcher', 'page.html'), 'utf8');
  const styleEnd = html.indexOf('/* /palette */');
  const rest = html.slice(styleEnd).replace(/<script[\s\S]*<\/script>/, '');
  const literals = rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [];
  ok(literals.length === 0, `no colour is typed anywhere else on the page${literals.length ? `: ${literals.join(', ')}` : ''}`);
  ok(!/\bui_[a-z]+|\.dds\b|<img|url\(/.test(html), 'and no picture at all is drawn on it, least of all the client\'s own interface');
}

// ---- Every command status can ask for has words on the page and a place in the plan --------------
//
// Two lists that must not fall behind the converter, and both had. The launcher shows a step's own
// command name for anything it has no plain words for, so a player reading the list saw `navgrid` and
// `fittings`; and the converter's driver treats a command with no entry in `STEP_FACTS` as one it has
// never heard of -- no order, nothing it waits for, run alone -- which is safe by luck and not by
// design, since a step with no `needs` may run before the one whose output it reads and then write a
// pack that is quietly wrong.
//
// Both are checked against the converter itself: every `need(` in `cli.mjs` names a command status
// can ask a caller to run, so that is the list, read as text rather than by running anything.
{
  const cli = readFileSync(join(root, 'tools', 'swg', 'cli.mjs'), 'utf8');
  const asked = new Set();
  for (const m of cli.matchAll(/need\(\s*[`'"]([a-z][a-z0-9-]*)/g)) asked.add(m[1]);
  // A `&&` in a to-do line is two steps, and the second one is asked for just as much as the first.
  for (const m of cli.matchAll(/&&\s*([a-z][a-z0-9-]+)\s/g)) if (/^(clips-apply|parts|species|sounds|mobiles)$/.test(m[1])) asked.add(m[1]);
  ok(asked.size >= 20, `the converter asks for ${asked.size} different commands`);

  const planText = readFileSync(join(root, 'tools', 'launcher', 'plan.mjs'), 'utf8');
  const wordsBlock = /const WORDS = \{([\s\S]*?)\n\};/.exec(planText);
  ok(!!wordsBlock, 'the launcher has a table of plain words');
  const worded = new Set();
  for (const m of wordsBlock[1].matchAll(/^\s*'?([a-z][a-z0-9-]*)'?:/gm)) worded.add(m[1]);
  const unworded = [...asked].filter((c) => !worded.has(c)).sort();
  ok(unworded.length === 0, `every command the converter asks for has plain words for the page${unworded.length ? `; missing: ${unworded.join(', ')}` : ` (${worded.size} in the table)`}`);
  // And each of them really reads as words rather than as the command over again.
  const bare = [...asked].filter((c) => labelOf([c]) === c).sort();
  ok(bare.length === 0, `and none of them shows its own command name${bare.length ? `: ${bare.join(', ')}` : ''}`);

  const planned = new Set(Object.keys(STEP_FACTS));
  const unplanned = [...asked].filter((c) => !planned.has(c)).sort();
  ok(unplanned.length === 0, `every one of them has a place in the converter's plan${unplanned.length ? `; missing: ${unplanned.join(', ')}` : ` (${planned.size} steps)`}`);
  // Nothing may claim to wait for a step that is not in the table either, or the wait is ignored.
  const badNeeds = Object.entries(STEP_FACTS).flatMap(([k, f]) => (f.needs ?? []).filter((n) => !planned.has(n)).map((n) => `${k} waits for ${n}`));
  ok(badNeeds.length === 0, `and nothing waits for a step the plan has never heard of${badNeeds.length ? `: ${badNeeds.join('; ')}` : ''}`);
  // Two orders the size of the work depends on: the things that append to a pack's layout must come
  // after the snapshot that rewrites it, and the two that read a finished pack after those.
  const orderOf = (c) => STEP_FACTS[c].order;
  ok(orderOf('travel') > orderOf('snapshot') && orderOf('fittings') > orderOf('snapshot'), 'the travel terminals and the fittings run after the snapshot that would wipe them');
  ok(orderOf('scenes') > orderOf('travel') && orderOf('scenes') > orderOf('fittings'), "and the character screens' places after both, since they read the layout");
  ok(orderOf('deeds') > orderOf('gallery'), 'the deeds run after the gallery, whose models they are checked against');
}

// ---- How big a conversion is, in one place -------------------------------------------------------
//
// The figure was typed into the page and into a sentence in `checks.mjs`, and both fell behind: the
// page said 14 GB and the check 16 while the owner's own folder had passed 16.
{
  const words = formatBytes(FULL_CONVERSION_BYTES);
  ok(checkOut('').sentence.includes(words), `the folder's own sentence names the size from the constant (${words})`);
  const html = readFileSync(join(root, 'tools', 'launcher', 'page.html'), 'utf8');
  const typed = html.match(/about \d+(\.\d+)? ?GB/g) ?? [];
  ok(typed.length === 0, `and no size is typed into the page${typed.length ? `: ${typed.join(', ')}` : ' (it reads the launcher\'s own)'}`);
  ok(/s\.sizes[\s\S]{0,120}placeholder/.test(html), 'which the page takes from the state it is handed');
  ok(FULL_CONVERSION_BYTES >= 17 * 1024 ** 3, 'and the figure is above what a full conversion really comes to');
}

console.log(`\n${checks} checks passed`);
