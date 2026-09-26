// Packs a release of the game: the archive swg3js.exe downloads and installs. CI runs it on every push
// to main; it can be run here too, to try a release before it is published
// (`npm run launcher:pack`, then `swg3js.exe --from-archive=launcher-build\release`).
//
//   node tools/launcher/pack.mjs [--out=launcher-build/release] [--commit=<sha>] [--date=<iso>] [--ci] [--with-untracked]
//
// What goes in is named, never a folder taken wholesale. The game is built by the pack itself, into a
// folder of its own emptied first, with the private content's copy off and Vite's manifest on, and the
// built files are the ones Vite says it made (the manifest, and the workers its chunks name) plus the
// files of `public/` git tracks, byte for byte; anything else in that folder fails the pack. Everything
// else comes from git's own list of the checkout, never from a folder's: the converter's modules and
// the few data files it reads (never its tests), the part of the game's source the converter imports,
// the server's modules, the launcher proper, package.json and the README; and a version.json. Then
// every relative import and every relative file name written in any of those modules is followed, and
// a file the checkout has that the list left out fails the pack, so a converter that grows an import
// can never ship broken.
//
// Nothing converted from a game install may ever be in it, and this is where that is made impossible:
// the pack fails if the build folder holds an `assets-private` folder or anything the build did not
// make, if any path in the list has an `assets-private` segment or is a game archive or a game file
// format, and (with --ci) if the checkout has an `assets-private` folder at all, which a clean checkout
// never does. A dist folder made elsewhere is not taken (`--dist` is refused).
//
// --with-untracked also takes the converter's, the server's and the launcher's files git has not been
// told about but does not ignore, to try uncommitted work here; CI refuses it.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const PACK_FORMAT = 1;
/** The archive's name carries its commit, so a new one is uploaded beside the old and the record is switched
    to it last: a launcher reading the release in between finds an archive that matches what it read. */
export const archiveName = (commit) => `swg3js-${String(commit).slice(0, 12).replace(/[^A-Za-z0-9_-]/g, '_')}.tar.gz`;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The only kinds of file a built page is made of. Anything else in the dist folder fails the pack. */
export const DIST_KINDS = new Set(['.html', '.js', '.css', '.wasm', '.json', '.svg', '.png', '.jpg', '.webp', '.ico', '.glb', '.txt', '.woff2', '.webmanifest', '.map']);
/** Game archives and the game's own file formats: never in a release, wherever they sit. */
export const FORBIDDEN_KINDS = new Set(['.tre', '.toc', '.pk3', '.iff', '.msh', '.mgn', '.sht', '.dds', '.ans', '.skt', '.lmg', '.sat', '.apt', '.pob', '.trn', '.lay', '.snd', '.cdf', '.stf', '.ws', '.gla', '.glm', '.clips']);

/** The parts of the game's source the converter imports (it runs them with Node's type stripping). */
const SOURCE_FILES = ['src/swg/terrain/trn.ts', 'src/swg/terrain/generator.ts', 'src/swg/terrain/flora.ts', 'src/swg/terrain/fractal.ts', 'src/swg/terrain/iff.ts', 'src/swg/terrain/shaderKey.ts', 'src/core/fx/cloudMath.ts', 'src/data/scenes.ts', 'src/world/scenePlaces.ts', 'src/data/planets.ts', 'src/world/sceneCapture.ts'];
/** The launcher proper (the bootstrap is built into the exe and is not needed in the release). */
const LAUNCHER_FILES = ['tools/launcher/main.mjs', 'tools/launcher/checks.mjs', 'tools/launcher/plan.mjs', 'tools/launcher/serve.mjs', 'tools/launcher/page.html', 'tools/launcher/README.md'];
/** The converter's data files, beside its modules. */
const CONVERTER_DATA = ['tools/swg/README.md', 'tools/swg/manifests/retail.json', 'tools/swg/regions/regions.json'];

/** Where the pack's own build of the game goes: the only dist folder a release is ever packed from. */
export const PACK_DIST = join(ROOT, 'launcher-build', 'dist');
/** A file name Vite gives what it emits into `assets/`: a name, a dash and an eight-character hash. */
const HASHED = /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

/**
 * What git knows of the checkout: every tracked path with its blob's hash, and (asked for with
 * `untracked`) the untracked paths git does not ignore. Everything outside the built game goes into a
 * release from this list and never from a folder's listing, so a file git has never been told about is
 * never packed by accident, and an ignored one (assets-private, .env) never at all.
 */
export function gitFiles(root = ROOT, { untracked = false } = {}) {
  const r = spawnSync('git', ['ls-files', '-s', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1048576 });
  if (r.status !== 0) throw new Error(`${root} is not a git checkout, and a release is only ever packed from one (${(r.stderr || '').trim()})`);
  const tracked = new Map();
  for (const line of r.stdout.split('\0')) {
    const m = /^\d+ ([0-9a-f]{40,64}) \d+\t(.+)$/.exec(line);
    if (m) tracked.set(m[2], m[1]);
  }
  const extra = new Set();
  if (untracked) {
    const u = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1048576 });
    if (u.status === 0) for (const p of u.stdout.split('\0')) if (p) extra.add(p);
  }
  return { tracked, untracked: extra };
}

/** Git's own hash of a file's bytes (a blob), to tell a public file from a copy changed on this machine. */
export function blobHash(data) {
  return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
}

/**
 * The built game's files, from what Vite itself says it made and never from the folder's listing:
 * index.html, every file its manifest (`.vite/manifest.json`, which the pack's build asks for) names as
 * an entry, a chunk, a style sheet or an asset, every hashed file in `assets/` that one of those names
 * in its own text (the workers, which the manifest leaves out), and the tracked files of `public/`,
 * each byte for byte what git holds. Anything else in the folder fails the pack, because whatever put
 * it there was not the build.
 */
export function distFiles(dist, tracked, root = null) {
  const problems = [];
  const manifestFile = join(dist, '.vite', 'manifest.json');
  if (!existsSync(join(dist, 'index.html'))) return { files: [], problems: [`${dist} holds no built game (index.html)`] };
  if (existsSync(join(dist, 'assets-private'))) return { files: [], problems: [`${dist} holds an assets-private folder: the pack builds the game itself with the private content's copy off`] };
  if (!existsSync(manifestFile)) return { files: [], problems: [`${dist} has no Vite manifest (.vite/manifest.json), so what the build made cannot be told from what else is there`] };
  const all = walk(dist).filter((rel) => rel !== '.vite/manifest.json');
  const present = new Set(all);
  const reached = new Set(['index.html']);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  } catch (err) {
    return { files: [], problems: [`the Vite manifest cannot be read (${err.message})`] };
  }
  for (const e of Object.values(manifest)) for (const f of [e.file, ...(e.css ?? []), ...(e.assets ?? [])]) if (typeof f === 'string') reached.add(f);
  // The workers and anything else a chunk names by its hashed file name, followed until nothing new is named.
  const hashed = all.filter((rel) => HASHED.test(rel));
  const read = new Set();
  for (let grew = true; grew; ) {
    grew = false;
    for (const rel of [...reached]) {
      if (read.has(rel) || !/\.(js|css|html)$/.test(rel) || !present.has(rel)) continue;
      read.add(rel);
      const text = readFileSync(join(dist, ...rel.split('/')), 'utf8');
      for (const h of hashed) if (!reached.has(h) && text.includes(h.slice('assets/'.length))) {
        reached.add(h);
        grew = true;
      }
    }
  }
  for (const rel of reached) if (!present.has(rel)) problems.push(`dist/${rel} is named by the build but is not in ${dist}`);
  // The public folder, which Vite copies whole: only what git tracks, and only as git holds it.
  for (const [path, blob] of tracked) {
    if (!path.startsWith('public/')) continue;
    const rel = path.slice('public/'.length);
    if (!present.has(rel)) continue;
    const file = join(dist, ...rel.split('/'));
    // Git's own hash of the copy, through the checkout's line-ending rules, when the plain one differs:
    // a text file checked out on Windows with CRLF is still the file git holds.
    const same = blobHash(readFileSync(file)) === blob || (root && spawnSync('git', ['hash-object', `--path=${path}`, file], { cwd: root, encoding: 'utf8' }).stdout?.trim() === blob);
    if (!same) problems.push(`dist/${rel} is not the ${path} git holds`);
    else reached.add(rel);
  }
  for (const rel of all) if (!reached.has(rel)) problems.push(`dist/${rel} was not made by the build and is not a tracked public file`);
  const files = all.filter((rel) => reached.has(rel));
  for (const rel of files) if (!DIST_KINDS.has(extname(rel).toLowerCase())) problems.push(`dist/${rel} is not a kind of file a built page is made of`);
  return { files, problems };
}

/** Why a path may not be in a release, or null. */
export function refusal(rel) {
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => p.toLowerCase() === 'assets-private')) return 'is under assets-private';
  if (parts.some((p) => p === '..' || p === '' || p === '.')) return 'is not a plain relative path';
  if (FORBIDDEN_KINDS.has(extname(rel).toLowerCase())) return 'is a game archive or a game file format';
  if (basename(rel).toLowerCase() === '.env') return 'is a machine\'s own settings';
  return null;
}

const list = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

/** Every file under a folder, as paths relative to it with forward slashes. */
function walk(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

/**
 * The release's files as `{ path in the archive, file on disk }`, named one by one. Throws with every
 * reason at once if anything is refused.
 */
export function releaseFiles({ root = ROOT, dist, git = null, untracked = false }) {
  const problems = [];
  const files = [];
  const { tracked, untracked: extra } = git ?? gitFiles(root, { untracked });
  // A path outside the build goes in only when git knows it: tracked, or (a local pack asked with
  // --with-untracked, never CI's) untracked and not ignored.
  const known = (rel) => tracked.has(rel) || extra.has(rel);
  const add = (rel, from = join(root, ...rel.split('/')), { built = false } = {}) => {
    const why = refusal(rel);
    if (why) problems.push(`${rel} ${why}`);
    else if (!built && !known(rel)) problems.push(`${rel} is not a file git knows (commit it${untracked ? '' : ', or pack with --with-untracked to try it here'})`);
    else if (!existsSync(from)) problems.push(`${rel} is missing`);
    else files.push({ path: rel, from });
  };
  // The built game.
  const built = distFiles(dist, tracked, git ? null : root);
  problems.push(...built.problems);
  for (const rel of built.files) add(`dist/${rel}`, join(dist, ...rel.split('/')), { built: true });
  // The converter (its modules, not its tests, and its data) and the server, from git's list.
  const gitList = [...new Set([...tracked.keys(), ...extra])].sort();
  for (const rel of gitList) if (/^tools\/swg\/[^/]+\.mjs$/.test(rel) || /^tools\/swg\/packs\/[^/]+\.json$/.test(rel) || /^server\/[^/]+\.mjs$/.test(rel)) add(rel);
  for (const rel of CONVERTER_DATA) add(rel);
  for (const rel of SOURCE_FILES) add(rel);
  // The launcher proper, and the root files.
  for (const rel of LAUNCHER_FILES) add(rel);
  add('package.json');
  add('README.md');
  if (problems.length) throw new Error(`the release cannot be packed:\n  ${problems.join('\n  ')}`);
  const missing = unreachedImports(files, root);
  if (missing.length) throw new Error(`the release leaves out files its own code names:\n  ${missing.join('\n  ')}`);
  return files;
}

/**
 * Every relative file a module in the release names (an import, a dynamic import, a `new URL`, a
 * `require`) that the checkout has and the release does not. A name that is not a file in the checkout
 * (a folder, a path built at run time, a `.env` a player may keep) is not the release's to carry.
 */
export function unreachedImports(files, root = ROOT) {
  const have = new Set(files.map((f) => f.path));
  const missing = new Set();
  for (const f of files) {
    if (!/\.(mjs|cjs|js|ts)$/.test(f.path) || f.path.startsWith('dist/')) continue;
    const text = readFileSync(f.from, 'utf8');
    const re = /['"`](\.\.?\/[^'"`\s$]+?\.(?:mjs|cjs|js|ts|json|html))['"`]/g;
    let m;
    while ((m = re.exec(text))) {
      const target = relative(root, resolve(root, dirname(f.path), m[1])).split(sep).join('/');
      if (target.startsWith('..')) continue;
      const onDisk = join(root, ...target.split('/'));
      if (!existsSync(onDisk) || !statSync(onDisk).isFile()) continue;
      if (!have.has(target)) missing.add(`${target} (named in ${f.path})`);
    }
  }
  return [...missing].sort();
}

// ---------------------------------------------------------------------------------------------
// The tar writer: ustar, one header per file, folders implied. Dependency-free, so the release is made
// the same way on the build machine and here.

function octal(n, width) {
  return `${n.toString(8).padStart(width - 1, '0')}\0`;
}

/** Splits a path into ustar's name (100) and prefix (155) at a slash, or throws when it cannot fit. */
export function ustarName(path) {
  const bytes = Buffer.byteLength(path);
  if (bytes <= 100) return { name: path, prefix: '' };
  for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1)) {
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`path too long for a tar header: ${path}`);
}

/** One tar entry: a 512-byte header, the data, and padding to 512. */
function tarEntry(path, data, mtime) {
  const header = Buffer.alloc(512);
  const { name, prefix } = ustarName(path);
  header.write(name, 0, 100, 'utf8');
  header.write(octal(0o644, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii');
  header.write(octal(0, 8), 116, 8, 'ascii');
  header.write(octal(data.length, 12), 124, 12, 'ascii');
  header.write(octal(mtime, 12), 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return [header, data, pad];
}

/** A tar of `{ path, data }` entries, in the order given, ended by two empty blocks. */
export function writeTar(entries, mtime = Math.floor(Date.now() / 1000)) {
  const parts = [];
  for (const e of entries) parts.push(...tarEntry(e.path, e.data, mtime));
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

/** Packs the release: the archive and its record, written into `out`. Returns the record. */
export function pack({ dist, out, commit, date, root = ROOT, untracked = false }) {
  const files = releaseFiles({ root, dist, untracked });
  const version = { format: PACK_FORMAT, commit, date, files: files.length + 1 };
  const entries = [{ path: 'version.json', data: Buffer.from(`${JSON.stringify(version, null, 2)}\n`) }, ...files.map((f) => ({ path: f.path, data: readFileSync(f.from) }))];
  const mtime = Math.floor(new Date(date).getTime() / 1000) || Math.floor(Date.now() / 1000);
  const gz = gzipSync(writeTar(entries, mtime), { level: 9 });
  mkdirSync(out, { recursive: true });
  const name = archiveName(commit);
  for (const old of list(out)) if (/^swg3js-.*\.tar\.gz$/.test(old)) rmSync(join(out, old));
  writeFileSync(join(out, name), gz);
  const record = { format: PACK_FORMAT, commit, date, archive: { name, size: gz.length, sha256: createHash('sha256').update(gz).digest('hex') }, files: entries.length };
  writeFileSync(join(out, 'release.json'), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(join(out, 'files.txt'), `${entries.map((e) => e.path).join('\n')}\n`);
  return record;
}

/** The checkout's commit, or a word saying there is none. */
function gitCommit() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const has = (name) => process.argv.includes(`--${name}`);
  try {
    if (has('ci') && existsSync(join(ROOT, 'assets-private'))) throw new Error('the checkout has an assets-private folder; a release is only ever packed from a clean checkout');
    // The game is always built here, into a folder of the pack's own that is emptied first, with the
    // private content's copy off and Vite's manifest on: a dist folder made anywhere else could hold
    // anything, so none is taken.
    if (arg('dist') !== undefined) throw new Error('--dist is not taken: the pack builds the game itself, so that nothing but the build is ever in what it packs');
    const untracked = has('with-untracked');
    if (untracked && has('ci')) throw new Error('--with-untracked is for trying a release on this machine and is never CI\'s');
    const out = resolve(arg('out') ?? join(ROOT, 'launcher-build', 'release'));
    const dist = PACK_DIST;
    rmSync(dist, { recursive: true, force: true });
    const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    console.log(`building the game into ${dist} (the private content's copy is off)`);
    const r = spawnSync(process.execPath, [vite, 'build', '--outDir', dist, '--emptyOutDir', '--manifest'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, SWG3JS_NO_PRIVATE: '1' } });
    if (r.status !== 0) throw new Error('the game did not build');
    const record = pack({ dist, out, untracked, commit: arg('commit') ?? process.env.GITHUB_SHA ?? gitCommit(), date: arg('date') ?? new Date().toISOString() });
    console.log(`packed ${record.files} files: ${join(out, record.archive.name)} (${(record.archive.size / 1048576).toFixed(1)} MB, sha256 ${record.archive.sha256})`);
    console.log(`the record: ${join(out, 'release.json')}; the list of files: ${join(out, 'files.txt')}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
