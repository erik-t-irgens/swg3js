// The placement editor's endpoint on the dev server, `POST /__dev/placements`: the files and the HTTP, and
// nothing else. Who may ask and what an ask does are `src/world/placementEdits.ts`'s, which node runs as it
// stands; this reads the request, reads the world's two files of permanent placements (and every other kind of
// edit file a batch names: Map-maker II's heights and the kinds after them, `kindsRead`), hands them to those
// rules and writes what they say, each file whole: into a dot-named file beside it first, then put in place
// with a rename, so the watcher (which says nothing for a dot name) and a release pack (which would refuse
// one) never see half a file, and the dot-named one is gone afterwards on every path, a rename that failed
// included.
//
// It exists only in the dev server: `vite.config.ts` loads it at the first ask with an import whose name it
// works out, so neither it nor anything it imports is a dependency of the config, and editing any of them
// never restarts the dev server -- which also means the dev server runs the code it first loaded until it is
// restarted. Nothing packs this folder, and the launcher answers no POST at all.
//
// Asks are answered one at a time: each reads both files, changes one row and writes them back, and two at
// once would each write back the other's file as it read it.
//
// The world editor's two asks (DESIGN.md §2.11): a **batch** (every row an action changed, in every file it touched,
// checked all or nothing by the rules and written file by file, each through its own dot-named copy, so a rename refused
// part way leaves the files before it written and the answer says so), and **status** (each of a world's placement
// files and its track file as git sees it: untracked, saved and not committed, committed, or the same on main). Every
// file written is told to the page with its revision, twelve hex of the SHA-1 of its text (`revisionOf`), after the
// answer has gone, so the page drops the word about a file it has just landed. Git is only ever asked, read-only, and
// every call carries `--no-optional-locks` (`git`), so the editor never writes the index under the owner's own git:
// committing is the owner's.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { PLACEMENTS_ENDPOINT_TUNE, EDITOR_HEADER, applyPlacementOp, fileStateOf, refuseRequest, statusAsk, statusFiles } from '../../src/world/placementEdits.ts';
import { EDIT_FILE_KINDS, editFileWorld } from '../../src/story/placementPath.ts';
import { PLANETS, packIdOf } from '../../src/data/planets.ts';

/**
 * A row's deflated bytes (a tile of heights' deltas: deflate-raw, base64) inflated by node's own zlib, or null for bytes
 * that do not inflate: what the rules check a tile with before they write it (`PlacementCtx.inflate`).
 */
export function inflateRow(b64) {
  try {
    if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
    return new Uint8Array(zlib.inflateRawSync(Buffer.from(b64, 'base64')));
  } catch {
    return null;
  }
}

/** A file's revision: twelve hex of the SHA-1 of its text as written. The dev server's watcher names a file it saw the same way. */
export function revisionOf(text) {
  return createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 12);
}

/**
 * One read-only ask of git in `cwd`: its output, and its exit code (a code that is not nought is an answer, not a fault:
 * `diff --quiet` says "differs" that way). Every call goes through here and carries `--no-optional-locks`, so nothing the
 * editor asks ever writes the index under the owner's own git.
 */
export function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['--no-optional-locks', ...args], { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      resolve({ code, out: String(stdout ?? '') });
    });
  });
}

/**
 * What git says of each of `paths` (relative to `cwd`, forward slashes): the branch, the ref main is read from (local
 * `main`, else `origin/main`, else none), and for each path whether it exists, whether HEAD has it, its porcelain code
 * and whether it is the same on main, classified by `fileStateOf`. Read-only throughout.
 */
export async function gitStates(cwd, paths) {
  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim() || null;
  let main = null;
  for (const ref of ['main', 'origin/main']) {
    if ((await git(cwd, ['rev-parse', '--verify', '--quiet', ref])).code === 0) {
      main = ref;
      break;
    }
  }
  const status = await git(cwd, ['status', '--porcelain=v1', '-z', '--', ...paths]);
  const codes = new Map();
  for (const entry of status.out.split('\0')) {
    if (entry.length < 4) continue;
    codes.set(entry.slice(3).replace(/\\/g, '/'), entry.slice(0, 2));
  }
  const inHead = new Set((await git(cwd, ['ls-tree', '--name-only', 'HEAD', '--', ...paths])).out.split(/\r?\n/).filter(Boolean));
  const files = [];
  for (const p of paths) {
    const exists = fs.existsSync(path.resolve(cwd, p));
    const head = inHead.has(p);
    const porcelain = codes.get(p) ?? null;
    let sameAsMain = null;
    if (main && exists && head && !porcelain) sameAsMain = (await git(cwd, ['diff', '--quiet', main, '--', p])).code === 0;
    files.push({ path: p, exists, inHead: head, porcelain, sameAsMain, state: fileStateOf({ exists, inHead: head, porcelain, sameAsMain }) });
  }
  return { branch, main, files };
}

/** Every world a file may be for, by pack id, with what kind it is: each planet, each of its zones, each space zone. */
export function worldKinds() {
  const out = new Map();
  for (const p of PLANETS) {
    const kind = p.instances ? 'copies' : p.space ? 'space' : 'ground';
    out.set(p.id, kind);
    for (const z of p.zones ?? []) out.set(packIdOf(p, z.id), kind);
  }
  return out;
}

/**
 * Where a kind's file for a world is written, or null for a path that would leave its kind's folder: the folder is
 * `<dir>/<kind>`, and the file must be directly in it, named for the world (or `all`, for a kind every world shares).
 */
export function fileFor(dir, layer, world) {
  const folder = path.resolve(dir, layer);
  const file = path.resolve(dir, layer, `${editFileWorld(layer, world)}.json`);
  return file.startsWith(folder + path.sep) && path.dirname(file) === folder ? file : null;
}

/** The kinds of file an ask reads: both row layers always, and every other kind a batch's edits name. */
export function kindsRead(op) {
  const out = ['story', 'world'];
  if (op && op.op === 'batch' && Array.isArray(op.edits)) {
    for (const e of op.edits) {
      const k = e && typeof e === 'object' ? e.file : null;
      if (typeof k === 'string' && EDIT_FILE_KINDS.includes(k) && !out.includes(k)) out.push(k);
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = (err) => err && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES');

/**
 * A file taken away, tried `renameTries` times `renameWaitMs` apart while Windows says another program holds it
 * (an indexer or a virus scanner reading what was just written is the usual one). A file that is not there is
 * no fault; any other failure is thrown once the tries are spent.
 */
async function unlinkHeld(file, tune, fsx) {
  for (let i = 0; ; i++) {
    try {
      await fsx.unlink(file);
      return;
    } catch (err) {
      if (err && err.code === 'ENOENT') return;
      if (!busy(err) || i + 1 >= tune.renameTries) throw err;
      await sleep(tune.renameWaitMs);
    }
  }
}

/**
 * A file written whole, or taken away (`text` null). Written into `.<name>.tmp` beside it, then renamed over
 * it, tried `renameTries` times `renameWaitMs` apart while Windows says another program holds it; the dot-named
 * file is taken away afterwards whatever happened, with the same tries, since whatever refused the rename is
 * usually holding the copy too, and one that still cannot be taken away is said aloud on the dev server's
 * console with where it is (left behind, it is an untracked file under `public/` that stops a local release
 * pack). The folder is made when it is missing. `fsx` is node's own promises API, or a stand-in a test hands
 * over. `prune` is how many folders above a file taken away are taken away too once nothing is left in them: two
 * for a placements layer (the layer's and the placements'), one for the tracks' (`tools/dev/tracksEndpoint.mjs`).
 */
export async function writeWhole(file, text, tune = PLACEMENTS_ENDPOINT_TUNE, fsx = fs.promises, prune = 2) {
  if (text === null) {
    await unlinkHeld(file, tune, fsx);
    // A layer's folder left with nothing in it goes too, and the placements folder after it, so a dressing
    // tried and taken back leaves nothing behind at all. A folder with anything in it is left alone.
    const folders = [path.dirname(file), path.dirname(path.dirname(file))].slice(0, Math.max(0, prune));
    for (const folder of folders) {
      try {
        await fsx.rmdir(folder);
      } catch {
        break;
      }
    }
    return;
  }
  const dir = path.dirname(file);
  const temp = path.join(dir, `.${path.basename(file)}.tmp`);
  await fsx.mkdir(dir, { recursive: true });
  try {
    await fsx.writeFile(temp, text, 'utf8');
    for (let i = 0; ; i++) {
      try {
        await fsx.rename(temp, file);
        return;
      } catch (err) {
        if (!busy(err) || i + 1 >= tune.renameTries) throw err;
        await sleep(tune.renameWaitMs);
      }
    }
  } finally {
    // Gone already after a rename (not there is no fault); after a failure it is taken away here, so nothing is
    // left for a pack to find, and one that will not go is named rather than left to be found.
    try {
      await unlinkHeld(temp, tune, fsx);
    } catch (err) {
      console.warn(`placements: ${temp} could not be taken away (${err?.code ?? err?.message ?? err}): delete it by hand, or a local release pack refuses the tree`);
    }
  }
}

/** A file's text, or null for one that is not there. */
async function readText(file, fsx = fs.promises) {
  if (!file) return null;
  try {
    return await fsx.readFile(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/** The body, up to `most` bytes; past that it is refused rather than read on. */
function readBody(req, most) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > most) {
        over = true;
        reject(Object.assign(new Error('too long'), { tooLong: true }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function answer(res, status, body) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (status === 405) res.setHeader('Allow', 'POST');
  res.end(JSON.stringify(body));
}

let queue = Promise.resolve();

/**
 * One ask, answered in its turn. `opts.dir` is the placements folder (`public/placements`), whose `story/` and
 * `world/` hold the two layers; `opts.notify({ kind, layer, world, rev })` is said for every file written, once the
 * answer has gone, which the dev server hands every page as `placements:changed`; `opts.root` is the checkout git is
 * asked in (the status op), by default the folder two above `dir`. The rest is for a test: `tune`, `now` and `worlds`.
 */
export function handle(req, res, opts) {
  const run = queue.then(() => serve(req, res, opts));
  queue = run.catch(() => {});
  return run;
}

async function serve(req, res, { dir, root = path.resolve(dir, '..', '..'), notify = () => {}, tune = PLACEMENTS_ENDPOINT_TUNE, now = Date.now, worlds = worldKinds() }) {
  const h = req.headers ?? {};
  const length = h['content-length'] !== undefined ? Number(h['content-length']) : null;
  const refused = refuseRequest(
    { method: req.method, remoteAddress: req.socket?.remoteAddress ?? null, origin: h.origin ?? null, host: h.host ?? null, dev: h[EDITOR_HEADER] ?? null, contentType: h['content-type'] ?? null, length },
    tune,
  );
  if (refused) {
    req.resume?.();
    return answer(res, refused.status, { ok: false, why: refused.why });
  }
  let body;
  try {
    body = await readBody(req, tune.bodyMax);
  } catch (err) {
    req.resume?.();
    return answer(res, err?.tooLong ? 413 : 400, { ok: false, why: err?.tooLong ? `an ask is ${tune.bodyMax} bytes at most` : 'the ask could not be read' });
  }
  let op;
  try {
    op = JSON.parse(body);
  } catch {
    return answer(res, 400, { ok: false, why: 'an ask is JSON' });
  }
  const t0 = performance.now();
  // The status op: git asked, read-only, of a world's files. Nothing is written.
  if (op && op.op === 'status') {
    const asked = statusAsk(op, { worlds });
    if ('status' in asked) return answer(res, asked.status, { ok: false, why: asked.why });
    try {
      const list = statusFiles(asked.world);
      const states = await gitStates(root, list.map((f) => f.path));
      const files = list.map((f, i) => ({ kind: f.kind, ...states.files[i] }));
      return answer(res, 200, { ok: true, op: 'status', world: asked.world, branch: states.branch, main: states.main, files, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      return answer(res, 500, { ok: false, why: `git could not be asked: ${err?.message ?? err}` });
    }
  }
  // The world is checked by the rules as well; it is only looked at here to know which files to read: both row layers,
  // and every other kind of file a batch's edits name.
  const world = op && typeof op.world === 'string' && worlds.has(op.world) && /^[a-z0-9_]{1,40}$/.test(op.world) ? op.world : null;
  const files = {};
  for (const k of kindsRead(op)) files[k] = world ? fileFor(dir, k, world) : null;
  const current = {};
  try {
    for (const k of Object.keys(files)) current[k] = await readText(files[k]);
  } catch (err) {
    return answer(res, 500, { ok: false, why: `the files could not be read: ${err?.message ?? err}` });
  }
  const out = applyPlacementOp(op, current, { worlds, now: now(), hash: revisionOf, inflate: inflateRow });
  if (out.status !== 200) return answer(res, out.status, out.body);
  const written = [];
  try {
    for (const w of out.writes) {
      const file = files[w.layer];
      if (!file) throw new Error(`${w.layer} has no file for ${world}`);
      await writeWhole(file, w.text, tune);
      written.push({ kind: w.layer, layer: w.layer, world, rev: w.text === null ? '' : revisionOf(w.text) });
    }
  } catch (err) {
    // A rename refused part way: the files before it are written, and the answer names them, so the page reads them again.
    const done = written.map((w) => files[w.layer]).filter(Boolean).map((f) => path.relative(root, f).replace(/\\/g, '/'));
    answer(res, 500, { ok: false, why: `the file could not be written: ${err?.message ?? err}${done.length ? ` (written before it: ${done.join(', ')})` : ''}` });
    for (const w of written) notify(w);
    return;
  }
  if (out.body && out.body.op === 'batch') out.body.ms = Math.round(performance.now() - t0);
  // The answer first, then the word: the page lands the answer and drops the word about what it landed.
  answer(res, 200, out.body);
  for (const w of written) notify(w);
}
