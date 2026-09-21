'use strict';
// The launcher's bootstrap: the one script built into swg3js.exe. It is meant never to need replacing,
// so it does as little as it can and everything that changes lives in the downloaded release:
//
//   1. If another launcher is already running, it opens that one's page and leaves.
//   2. It asks GitHub for the rolling `latest` release of main, and if the release's commit is not the
//      one installed, downloads the archive, checks its SHA-256 against the release's own record,
//      unpacks it into a fresh folder and only then swaps it in, so an interrupted download or a full
//      disk never leaves a broken install. With no network it starts what it has.
//   3. It runs the launcher proper, `tools/launcher/main.mjs` inside the release, on the Node that is
//      built into this very exe, and hands it what it needs (where the data is, how to run a child).
//
// Children (the converter, the relay) are this same exe started with `--swg3js-run <file> <args...>`:
// in that mode the bootstrap loads the named file from the release and nothing else. So nothing here or
// anywhere in the release needs Node, npm or git to be installed.
//
// A single-executable application's own `require` reaches only Node's built-ins, and its `import()`
// reaches nothing on disk. A `require` made with `module.createRequire` does load a CommonJS file from
// disk, and that file's `import()` is the ordinary one, which loads the release's ES modules, top-level
// await, TypeScript type stripping and all. That one small file is written by this script into the data
// folder (`loader.cjs`), so the bootstrap depends on nothing in the release but `main.mjs`'s `start`.
//
// It also exports its pieces (the archive reader, the hashing, the install) so the node test can try
// them; it only acts on its own when it is the main script of the exe (`node:sea`'s `isSea()`).
//
// Everything here is ours. The only network calls are to GitHub's API and to the release's own files.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const http = require('node:http');
const childProcess = require('node:child_process');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

/** Where the releases are published, and the one rolling tag that always names main's newest. */
const REPO = 'erik-t-irgens/swg3js';
const TAG = 'latest';
/** The release's own record of itself, uploaded beside the archive (and last, so it never names an archive not yet there). */
const RELEASE_INFO = 'release.json';
/** The highest release format this bootstrap can install. A newer one needs a newer exe, and it says so. */
const PACK_FORMAT = 1;
/** This bootstrap's own version, shown on the launcher page. */
const BOOT_VERSION = 1;
/** The file inside the release that is the launcher proper. */
const LAUNCHER_ENTRY = 'tools/launcher/main.mjs';
/** The argument that turns this exe into a runner for one of the release's own scripts. */
const RUN_FLAG = '--swg3js-run';
/** How long to wait for GitHub before starting what is installed. */
const API_TIMEOUT_MS = 15000;
/** A download that receives nothing for this long is given up on. */
const STALL_MS = 60000;

// ---------------------------------------------------------------------------------------------
// The archive reader: a gzip'd tar, read whole into memory (the release is tens of megabytes).

/** Reads a NUL-terminated ASCII field out of a tar header. */
function field(buf, start, length) {
  const end = buf.indexOf(0, start);
  return buf.toString('utf8', start, end >= 0 && end < start + length ? end : start + length);
}

/** Reads an octal number field (as tar writes sizes and modes); a base-256 size is refused as too large. */
function octal(buf, start, length) {
  if (buf[start] & 0x80) throw new Error('tar entry too large');
  const text = field(buf, start, length).trim();
  return text ? parseInt(text, 8) : 0;
}

/** Whether a tar header block's checksum is right (the sum of its bytes with the checksum field as spaces). */
function checksumOk(block) {
  const want = octal(block, 148, 8);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : block[i];
  return sum === want;
}

/**
 * A relative path from an archive, made safe: forward slashes, no leading slash or drive, no `..`
 * and no empty or `.` segments. Anything else is refused outright rather than cleaned, because an
 * archive that tries to write outside its folder is not one to install.
 */
function safeEntryPath(name) {
  const clean = name.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!clean || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) throw new Error(`archive path is not relative: ${name}`);
  const parts = clean.split('/').filter((p, i, all) => !(p === '' && i === all.length - 1));
  for (const p of parts) if (p === '' || p === '.' || p === '..') throw new Error(`archive path is not allowed: ${name}`);
  return parts.join('/');
}

/**
 * The entries of an uncompressed tar: `{ path, type: 'file' | 'dir', data }`. Reads ustar (with its
 * prefix field), the POSIX `x` extended header's `path`, and GNU's `L` long name; skips global headers
 * and anything that is neither a file nor a folder. Every header's checksum is checked.
 */
function readTar(buf) {
  const out = [];
  let off = 0;
  let longName = null;
  let ended = false;
  while (off + 512 <= buf.length) {
    const block = buf.subarray(off, off + 512);
    if (block.every((b) => b === 0)) {
      ended = true;
      break;
    }
    if (!checksumOk(block)) throw new Error(`tar header checksum wrong at byte ${off}`);
    const size = octal(block, 124, 12);
    const type = String.fromCharCode(block[156] || 48);
    const dataStart = off + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) throw new Error('tar archive is cut short');
    const data = buf.subarray(dataStart, dataEnd);
    off = dataStart + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      if (m) longName = m[1];
      continue;
    }
    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (type === 'g') continue;
    let name = field(block, 0, 100);
    const magic = field(block, 257, 6);
    if (magic.startsWith('ustar')) {
      const prefix = field(block, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    if (longName !== null) {
      name = longName;
      longName = null;
    }
    if (type === '0' || type === '\0' || type === '7') out.push({ path: safeEntryPath(name), type: 'file', data });
    else if (type === '5') out.push({ path: safeEntryPath(name), type: 'dir', data: null });
  }
  // Every tar ends in an empty block; one that stops before it was cut short.
  if (!ended) throw new Error('tar archive is cut short');
  return out;
}

/** A gzip'd tar's entries. */
function readTarGz(gz) {
  return readTar(zlib.gunzipSync(gz));
}

/** Whether a release record names its commit and its archive's name, size and SHA-256. */
function recordComplete(info) {
  const a = info && info.archive;
  return !!(info && typeof info.commit === 'string' && info.commit && a && typeof a.name === 'string' && a.name && Number.isSafeInteger(a.size) && a.size > 0 && typeof a.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(a.sha256));
}

/** SHA-256 of a buffer, in hex. */
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------------------------
// The install: unpack into a fresh folder, check it, then swap it in.

/** Reads a JSON file, or null. */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** What is installed now (`app/version.json`), or null. */
function installedVersion(dataDir) {
  return readJson(path.join(dataDir, 'app', 'version.json'));
}

/**
 * Unpacks a release archive into `<dataDir>/app`. The archive is unpacked into `app.new-*` first and
 * checked (it must carry `version.json` of a format this bootstrap knows, and the launcher proper);
 * only then is the old `app` moved aside and the new one moved in, and the old one removed. If
 * anything fails the old install is left exactly as it was. Returns the new `version.json`.
 *
 * `expect` is the release's record of the archive: its `sha256` (64 hex digits) and `size` must both be
 * there and both match, or nothing is unpacked at all, and a `commit` given must be the one the archive's
 * own version.json names. Only an archive the player handed over by hand with no record beside it is
 * installed unchecked, and only when the caller says so outright (`unchecked: true`).
 */
function installArchive(dataDir, gz, expect = {}) {
  if (!expect.unchecked) {
    if (typeof expect.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(expect.sha256)) throw new Error('the release record carries no SHA-256 to check the download against');
    if (!Number.isSafeInteger(expect.size) || expect.size <= 0) throw new Error('the release record carries no size for the download');
  }
  if (expect.size !== undefined && gz.length !== expect.size) throw new Error(`the download is ${gz.length} bytes, the release says ${expect.size}`);
  if (expect.sha256 && sha256(gz) !== expect.sha256.toLowerCase()) throw new Error('the download does not match the release\'s SHA-256');
  const entries = readTarGz(gz);
  const stamp = `${process.pid}-${Date.now()}`;
  const fresh = path.join(dataDir, `app.new-${stamp}`);
  const app = path.join(dataDir, 'app');
  const old = path.join(dataDir, `app.old-${stamp}`);
  fs.mkdirSync(fresh, { recursive: true });
  try {
    for (const e of entries) {
      const target = path.join(fresh, ...e.path.split('/'));
      if (!target.startsWith(fresh + path.sep)) throw new Error(`archive path escapes its folder: ${e.path}`);
      if (e.type === 'dir') fs.mkdirSync(target, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, e.data);
      }
    }
    const version = readJson(path.join(fresh, 'version.json'));
    if (!version || typeof version.format !== 'number') throw new Error('the archive has no version.json');
    if (version.format > PACK_FORMAT) throw new Error(`the archive is format ${version.format}; this launcher installs up to ${PACK_FORMAT}`);
    if (expect.commit !== undefined && version.commit !== expect.commit) throw new Error(`the archive is ${String(version.commit).slice(0, 12)}, the release record says ${String(expect.commit).slice(0, 12)}`);
    if (!fs.existsSync(path.join(fresh, ...LAUNCHER_ENTRY.split('/')))) throw new Error(`the archive has no ${LAUNCHER_ENTRY}`);
    let moved = false;
    if (fs.existsSync(app)) {
      fs.renameSync(app, old);
      moved = true;
    }
    try {
      fs.renameSync(fresh, app);
    } catch (err) {
      if (moved) fs.renameSync(old, app);
      throw err;
    }
    removeQuietly(old);
    return version;
  } catch (err) {
    removeQuietly(fresh);
    throw err;
  }
}

function removeQuietly(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a folder another program still holds is left for the next start to clear */
  }
}

/**
 * Clears the half-finished folders an earlier start may have left (a crash mid-unpack, a held folder).
 * A start that died between the swap's two renames left no `app` at all and the last good install as
 * `app.old-*`: that one is put back as `app` first (the newest, if there are several), and only then is
 * the rest cleared, so a crash at the worst moment never costs the install a player could still start.
 */
function clearLeftovers(dataDir) {
  let names = [];
  try {
    names = fs.readdirSync(dataDir);
  } catch {
    return;
  }
  const app = path.join(dataDir, 'app');
  if (!fs.existsSync(app)) {
    const when = (n) => Number(/-(\d+)$/.exec(n)?.[1] ?? 0);
    const olds = names.filter((n) => /^app\.old-/.test(n) && fs.existsSync(path.join(dataDir, n, 'version.json'))).sort((a, b) => when(b) - when(a));
    for (const n of olds) {
      try {
        fs.renameSync(path.join(dataDir, n), app);
        break;
      } catch {
        /* held by another program: try the next, and leave this one for the next start */
      }
    }
    try {
      names = fs.readdirSync(dataDir);
    } catch {
      return;
    }
  }
  for (const n of names) if (/^app\.(new|old)-/.test(n)) removeQuietly(path.join(dataDir, n));
}

// ---------------------------------------------------------------------------------------------
// GitHub.

const HEADERS = { 'User-Agent': 'swg3js-launcher', Accept: 'application/vnd.github+json' };

/** The `latest` release's own record and its archive's download address, or null when there is none. */
async function latestRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, { headers: HEADERS, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const release = await res.json();
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const infoAsset = assets.find((a) => a.name === RELEASE_INFO);
  if (!infoAsset) return null;
  const infoRes = await fetch(infoAsset.browser_download_url, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!infoRes.ok) throw new Error(`the release record answered ${infoRes.status}`);
  const info = await infoRes.json();
  const archive = assets.find((a) => a.name === info?.archive?.name);
  if (!archive) throw new Error('the release names an archive it does not carry');
  return { info, url: archive.browser_download_url, page: release.html_url };
}

/** Downloads to a `.part` file, giving up if nothing arrives for a minute, and returns the bytes. */
async function download(url, file, onProgress = () => {}) {
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), STALL_MS);
  const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal: ctrl.signal });
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    throw new Error(`the download answered ${res.status}`);
  }
  const total = Number(res.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const chunks = [];
  let got = 0;
  try {
    for await (const chunk of res.body) {
      clearTimeout(timer);
      timer = setTimeout(() => ctrl.abort(), STALL_MS);
      chunks.push(Buffer.from(chunk));
      got += chunk.length;
      onProgress(got, total);
    }
  } finally {
    clearTimeout(timer);
  }
  const buf = Buffer.concat(chunks);
  fs.writeFileSync(file, buf);
  return buf;
}

/**
 * Brings the install up to the `latest` release, or says why it did not. Never throws: with no
 * network, a GitHub that says no, or a download that does not check out, the install is left as it
 * was and the answer says so in words.
 */
async function update(dataDir, log = () => {}) {
  const before = installedVersion(dataDir);
  const answer = { checked: new Date().toISOString(), from: before?.commit ?? null, to: before?.commit ?? null, updated: false, note: '' };
  let latest;
  try {
    latest = await latestRelease();
  } catch (err) {
    answer.note = `Could not reach GitHub (${err.message}); starting what is installed.`;
    return answer;
  }
  if (!latest) {
    answer.note = 'There is no published release yet.';
    return answer;
  }
  answer.latest = latest.info.commit;
  if (latest.info.format > PACK_FORMAT) {
    answer.note = `The newest release needs a newer launcher. Download swg3js.exe again from ${latest.page}.`;
    return answer;
  }
  if (before && before.commit === latest.info.commit) {
    answer.note = 'Up to date.';
    return answer;
  }
  // A record that cannot vouch for its archive is not one to download by: installArchive would refuse
  // it too, but this says so before a download of tens of megabytes rather than after.
  if (!recordComplete(latest.info)) {
    answer.note = `The newest release's record has no commit, size or SHA-256, so nothing was downloaded; ${before ? 'the installed version is unchanged' : 'nothing is installed yet'}.`;
    return answer;
  }
  try {
    log(`downloading ${latest.info.archive.name} (${Math.round(latest.info.archive.size / 1048576)} MB) for ${String(latest.info.commit).slice(0, 7)}`);
    let shown = 0;
    const part = path.join(dataDir, 'download', `${latest.info.archive.name}.part`);
    const gz = await download(latest.url, part, (got, total) => {
      const pct = total ? Math.floor((got / total) * 10) : 0;
      if (pct > shown) {
        shown = pct;
        log(`  ${pct * 10}%`);
      }
    });
    const version = installArchive(dataDir, gz, { size: latest.info.archive.size, sha256: latest.info.archive.sha256, commit: latest.info.commit });
    removeQuietly(part);
    answer.to = version.commit;
    answer.updated = true;
    answer.note = before ? `Updated from ${String(before.commit).slice(0, 7)} to ${String(version.commit).slice(0, 7)}.` : `Installed ${String(version.commit).slice(0, 7)}.`;
  } catch (err) {
    answer.note = `The update did not install (${err.message}); ${before ? 'the installed version is unchanged' : 'nothing is installed yet'}.`;
  }
  return answer;
}

/**
 * Installs a release archive from this machine instead of from GitHub: for trying a release before
 * it is published, and for a machine with no network. When a `release.json` sits beside the archive
 * its SHA-256 and size are checked, exactly as a download's are.
 */
function installLocal(dataDir, given) {
  const before = installedVersion(dataDir);
  // A folder is a packed release as `npm run launcher:pack` leaves it: its record names the archive.
  let archive = given;
  if (fs.statSync(given).isDirectory()) {
    const named = readJson(path.join(given, RELEASE_INFO))?.archive?.name;
    if (!named) throw new Error(`${given} has no ${RELEASE_INFO} naming an archive`);
    archive = path.join(given, named);
  }
  const gz = fs.readFileSync(archive);
  const info = readJson(path.join(path.dirname(archive), RELEASE_INFO));
  // A record beside the archive that names it is held to exactly what a download is (its size, its
  // SHA-256 and its commit, all there and all matching); an archive handed over with no record is the
  // player's own choice and is the one thing installed unchecked, which the note says.
  const expect = info?.archive?.name === path.basename(archive) ? { size: info.archive.size, sha256: info.archive.sha256, commit: info.commit } : { unchecked: true };
  const version = installArchive(dataDir, gz, expect);
  return {
    checked: new Date().toISOString(),
    from: before?.commit ?? null,
    to: version.commit,
    updated: true,
    local: archive,
    note: `Installed ${String(version.commit).slice(0, 7)} from ${archive}${expect.unchecked ? ' (no release.json beside it, so not checked)' : ' (SHA-256 checked)'}.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Running the release's own scripts.

const LOADER_SOURCE = `'use strict';
// Written by swg3js.exe. A require made from this file's place loads it from disk, and its import() is
// the ordinary one, which the exe's own embedded script does not have.
const { pathToFileURL } = require('node:url');
module.exports = (file) => import(pathToFileURL(file).href);
`;

/** Writes the loader (if it is not already exactly this) and returns a function that imports a file. */
function importer(dataDir) {
  const file = path.join(dataDir, 'loader.cjs');
  let current = null;
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    current = null;
  }
  if (current !== LOADER_SOURCE) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, LOADER_SOURCE);
  }
  return createRequire(file)(file);
}

/** How the launcher proper starts one of the release's scripts as a child: this exe, told which file. */
function childCommand(file, args) {
  return { command: process.execPath, args: [RUN_FLAG, file, ...args] };
}

// ---------------------------------------------------------------------------------------------
// The data folder, the log and one launcher at a time.

function defaultDataDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'swg3js');
}

function makeLog(dataDir) {
  const dir = path.join(dataDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'launcher.log');
  try {
    if (fs.statSync(file).size > 5 * 1048576) fs.renameSync(file, path.join(dir, 'launcher.old.log'));
  } catch {
    /* no log yet */
  }
  const log = (line) => {
    const text = `${new Date().toISOString()} ${line}`;
    console.log(line);
    try {
      fs.appendFileSync(file, `${text}\n`);
    } catch {
      /* a log that cannot be written must not stop the launcher */
    }
  };
  log.file = file;
  return log;
}

/** Whether a launcher from this data folder is already answering, and on which port. */
function runningLauncher(dataDir) {
  const note = readJson(path.join(dataDir, 'launcher.json'));
  if (!note || !note.port) return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: note.port, path: '/launcher/api/ping', timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).app === 'swg3js-launcher' ? note.port : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** Opens an address in the player's default browser. */
function openBrowser(url) {
  try {
    if (process.platform === 'win32') childProcess.spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else childProcess.spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* the address is printed as well */
  }
}

/** The bootstrap's own options: `--data=`, `--from-archive=`, `--offline`, `--no-open`, `--port=`. */
function parseOptions(argv) {
  const o = { data: null, fromArchive: null, offline: false, open: true, port: null };
  for (const a of argv) {
    if (a.startsWith('--data=')) o.data = a.slice(7);
    else if (a.startsWith('--from-archive=')) o.fromArchive = a.slice(15);
    else if (a === '--offline') o.offline = true;
    else if (a === '--no-open') o.open = false;
    else if (a.startsWith('--port=')) o.port = Number(a.slice(7)) || null;
  }
  return o;
}

/** Keeps a console window open long enough to be read when something went wrong. */
function holdWindow() {
  if (!process.stdin.isTTY) return Promise.resolve();
  console.log('Press Enter to close this window.');
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => resolve());
  });
}

async function main() {
  // A child: run the named file from the release with the arguments after it, as `node <file> ...` would.
  if (process.argv[2] === RUN_FLAG) {
    const file = path.resolve(process.argv[3] || '');
    const rest = process.argv.slice(4);
    process.argv = [process.execPath, file, ...rest];
    const dataDir = process.env.SWG3JS_DATA || path.join(os.tmpdir(), 'swg3js');
    await importer(dataDir)(file);
    return;
  }

  const opts = parseOptions(process.argv.slice(2));
  const dataDir = path.resolve(opts.data || process.env.SWG3JS_DATA || defaultDataDir());
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.SWG3JS_DATA = dataDir;
  const log = makeLog(dataDir);
  log(`swg3js launcher (bootstrap ${BOOT_VERSION}, Node ${process.version}); data in ${dataDir}`);

  const already = await runningLauncher(dataDir);
  if (already) {
    const url = `http://127.0.0.1:${already}/launcher/`;
    log(`the launcher is already running: ${url}`);
    if (opts.open) openBrowser(url);
    return;
  }

  clearLeftovers(dataDir);
  let answer;
  if (opts.fromArchive) {
    try {
      answer = installLocal(dataDir, path.resolve(opts.fromArchive));
    } catch (err) {
      answer = { checked: new Date().toISOString(), updated: false, note: `The archive did not install (${err.message}).` };
    }
  } else if (opts.offline) {
    // Started again by the launcher after its own update: that update is the news, not "not checked".
    let news = null;
    try {
      news = process.env.SWG3JS_UPDATED ? JSON.parse(process.env.SWG3JS_UPDATED) : null;
    } catch {
      news = null;
    }
    delete process.env.SWG3JS_UPDATED;
    answer = news || { checked: null, updated: false, note: 'Not checked for updates (--offline).' };
  } else answer = await update(dataDir, log);
  log(answer.note);

  const version = installedVersion(dataDir);
  const entry = path.join(dataDir, 'app', ...LAUNCHER_ENTRY.split('/'));
  if (!version || !fs.existsSync(entry)) {
    log(answer.checked && /Could not reach/.test(answer.note) ? 'Nothing is installed, so there is nothing to start. Connect to the internet and run swg3js.exe again.' : 'Nothing is installed, so there is nothing to start. Run swg3js.exe again once a release is published, or start it with --from-archive=<a release archive>.');
    await holdWindow();
    process.exitCode = 1;
    return;
  }
  const launcher = await importer(dataDir)(entry);
  await launcher.start({
    dataDir,
    appDir: path.join(dataDir, 'app'),
    exePath: process.execPath,
    bootVersion: BOOT_VERSION,
    packFormat: PACK_FORMAT,
    update: answer,
    open: opts.open,
    port: opts.port,
    log,
    childCommand,
    openBrowser,
    // The page's "Check for updates": the same update, then this exe started again on the new code.
    checkForUpdate: () => update(dataDir, log),
    // Called by the launcher proper once it has closed its port and let go of everything: a fresh
    // start of this exe on the code just installed, told what the update did so its page can say so.
    restart: (args = [], news = null) => {
      const env = { ...process.env, SWG3JS_UPDATED: news ? JSON.stringify(news) : '' };
      const child = childProcess.spawn(process.execPath, ['--offline', `--data=${dataDir}`, ...args], { detached: true, stdio: 'ignore', env });
      child.unref();
    },
  });
}

module.exports = { readTar, readTarGz, safeEntryPath, sha256, recordComplete, installArchive, installLocal, clearLeftovers, parseOptions, childCommand, LOADER_SOURCE, PACK_FORMAT, RUN_FLAG, LAUNCHER_ENTRY };

let isSea = false;
try {
  isSea = require('node:sea').isSea();
} catch {
  isSea = false;
}
if (isSea) {
  const child = process.argv[2] === RUN_FLAG;
  main().catch(async (err) => {
    // A child's error is the script's own, printed as Node would print it; the launcher's own is said
    // in words and the window held open long enough to read it.
    if (child) {
      console.error(err && err.stack ? err.stack : err);
      process.exit(1);
    }
    console.error(`The launcher stopped: ${err && err.stack ? err.stack : err}`);
    await holdWindow();
    process.exit(1);
  });
}
