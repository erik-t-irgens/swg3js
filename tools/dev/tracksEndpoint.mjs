// The track editor's endpoint on the dev server, `POST /__dev/tracks`: the file and the HTTP, and nothing else. Who
// may ask and what an ask does are `src/race/trackEdits.ts`'s, which node runs as it stands; this reads the request,
// reads the world's track file, hands it to those rules and writes what they say, the file whole, through the very
// writer the placements editor uses (`writeWhole` in `placementsEndpoint.mjs`): into a dot-named file beside it first,
// then put in place with a rename, so the watcher (which says nothing for a dot name) and a release pack (which would
// refuse one) never see half a file, and the dot-named one is gone afterwards on every path.
//
// It exists only in the dev server: `vite.config.ts` loads it at the first ask with an import whose name it works
// out, so neither it nor anything it imports is a dependency of the config, and editing any of them never restarts
// the dev server -- which also means the dev server runs the code it first loaded until it is restarted. Nothing
// packs this folder, and the launcher answers no POST at all.
//
// Asks are answered one at a time, the placements editor's queue being its own: each reads the file, changes one
// track and writes it back, and two at once would each write back the other's file as it read it.

import fs from 'node:fs';
import path from 'node:path';
import { TRACKS_ENDPOINT_TUNE, TRACK_EDITOR_HEADER, applyTrackOp, refuseTrackRequest } from '../../src/race/trackEdits.ts';
import { worldKinds, writeWhole } from './placementsEndpoint.mjs';

export { worldKinds };

/** Where a world's track file is written, or null for a path that would leave the tracks folder. */
export function trackFileFor(dir, world) {
  const folder = path.resolve(dir);
  const file = path.resolve(dir, `${world}.json`);
  return file.startsWith(folder + path.sep) && path.dirname(file) === folder ? file : null;
}

/** A file's text, or null for one that is not there. */
async function readText(file) {
  if (!file) return null;
  try {
    return await fs.promises.readFile(file, 'utf8');
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
 * One ask, answered in its turn. `opts.dir` is the tracks folder (`public/tracks`); `opts.notify({ world })` is said
 * for the file written, which the dev server hands every page as `tracks:changed`. The rest is for a test: `tune`,
 * `now` and `worlds`.
 */
export function handle(req, res, opts) {
  const run = queue.then(() => serve(req, res, opts));
  queue = run.catch(() => {});
  return run;
}

async function serve(req, res, { dir, notify = () => {}, tune = TRACKS_ENDPOINT_TUNE, now = Date.now, worlds = worldKinds() }) {
  const h = req.headers ?? {};
  const length = h['content-length'] !== undefined ? Number(h['content-length']) : null;
  const refused = refuseTrackRequest(
    { method: req.method, remoteAddress: req.socket?.remoteAddress ?? null, origin: h.origin ?? null, host: h.host ?? null, dev: h[TRACK_EDITOR_HEADER] ?? null, contentType: h['content-type'] ?? null, length },
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
  // The world is checked by the rules as well; it is only looked at here to know which file to read.
  const world = op && typeof op.world === 'string' && worlds.has(op.world) && /^[a-z0-9_]{1,40}$/.test(op.world) ? op.world : null;
  const file = world ? trackFileFor(dir, world) : null;
  let current;
  try {
    current = await readText(file);
  } catch (err) {
    return answer(res, 500, { ok: false, why: `the file could not be read: ${err?.message ?? err}` });
  }
  const out = applyTrackOp(op, current, { worlds, now: now() });
  if (out.status !== 200) return answer(res, out.status, out.body);
  if (out.write !== undefined) {
    try {
      if (!file) throw new Error(`no file for ${world}`);
      await writeWhole(file, out.write, tune, fs.promises, 1);
    } catch (err) {
      return answer(res, 500, { ok: false, why: `the file could not be written: ${err?.message ?? err}` });
    }
    notify({ world });
  }
  return answer(res, 200, out.body);
}
