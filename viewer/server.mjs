// The space body viewer's server, as the middleware of its Vite (`viewer/vite.config.ts`, `npm run viewer`): the old
// viewer's own `serve.mjs` (the Feature-requests folder's, port 5195) brought into the repo whole, its answers the same, so
// the page reads and saves exactly as it did. The viewer's code itself is served by Vite from the repo: the page's own
// files from `viewer/`, its modules from `src/sky/look/` and `src/sky/system/`, three from the game's own `node_modules`.
//
// It serves, read only, the owner's imported meshes and pictures in place (never copied), the survey's notes and sky list,
// each space zone's small converted sky.json, a ground world's colour ramp, and the converted packs the game's air reads
// (`/assets-private/`, as the game's dev server serves them). POST /save writes the file of choices and keeps the one
// before it as <name>.prev.json; POST /picture adds one PNG or JPEG the owner chose in the page to the imported folder,
// never over a file already there; POST /save-game writes the game's own bodies file (`gameBodies.mjs`). Every path is
// the owner's, from the process environment or the repo's `.env` (`viewerPaths`), never written into the repo but the
// game's bodies file, which he commits as he does his maps.
//
// Dependency-free and pure of Vite, so node's tests run it as it stands (`tools/swg/tests/viewerServer.test.ts`).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gameBodiesFile, gamePictureName, shippedPictures } from './gameBodies.mjs';
import { firstRunCopy, keepOrder, keyPictures, resolvePictures } from './choices.mjs';
import { ourWorldRows } from './ourWorlds.mjs';

/**
 * The viewer's paths and switches, from `env` (the process environment over the repo's `.env`; the names are the old
 * viewer's own, so one setting means the same in both):
 *   SBV_PORT      the port (5194 by default: the old viewer keeps 5195 while the owner compares them)
 *   SBV_SHARE     "lan" to open it to the home network (the owner's Mac), as the old viewer did; unset, this PC alone
 *   SBV_NAMES     more names it may be opened by while shared, comma separated
 *   SBV_SAVE      a file of choices of this machine's own, written with its picture names (unset since pass 2, wave 6: the
 *                 repo's `viewer/choices/space-bodies.json`, its pictures by their keys, `choices.mjs`; its first run copies in
 *                 the old viewer's own, `../Feature-requests/space-body-viewer/space-bodies.json` beside the repo, never
 *                 changing it); the one before it is kept beside it as <name>.prev.json
 *   SBV_CHOICES, SBV_OLD_CHOICES   the repo's file and the old one it first copies, moved (a test's scratch "machine")
 *   SBV_IMPORTED  his folder of .fbx, .png and .jpg files (default: `../Feature-requests/WebGPU Port - Imported Textures`)
 *   SBV_SURVEY    the survey folder holding textures.json and game-side/skybodies.txt (default: `../../imported`)
 *   SBV_PACKS     the converted packs, read only (default: the repo's own `assets-private`)
 *   SBV_LOOKS     the private table of his looks (the pictures and meshes of his imports, `looks.js`'s private half): a
 *                 JSON file (default: `imports-private/sky/looks-private.json`, then `looks-private.json` in his imported
 *                 folder, then the old viewer's `looks.js` beside his file of choices, read in place)
 *   SBV_GAME      the game's bodies file Save to game writes (default: the repo's `public/sky/bodies.json`)
 * "Beside the repo" is beside its main checkout (`home`, `mainCheckoutOf`), so the defaults find his things from a linked
 * worktree too (he tests the port in one, whose own folder stands elsewhere: the fixer of pass 2, wave 4a); the packs, the
 * private table's first place and the game's bodies file are the running checkout's own.
 */
export function viewerPaths(env, root, home = mainCheckoutOf(root)) {
  const at = (v, fallback) => (v !== undefined && v !== '' ? path.resolve(root, v) : fallback);
  const share = String(env.SBV_SHARE || '').toLowerCase();
  if (share !== '' && share !== 'lan') throw new Error(`SBV_SHARE is "lan" or unset, not "${env.SBV_SHARE}"`);
  const rawPort = env.SBV_PORT;
  let port = 5194;
  if (rawPort !== undefined && rawPort !== '') {
    port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`SBV_PORT must be a whole number from 1024 to 65535, not "${rawPort}"`);
  }
  // Pass 2, wave 6 (maker K): the file of choices is the repo's own, `viewer/choices/space-bodies.json` in the running
  // checkout (he commits it as he does his maps), its imported picture names written as their keys (`choices.mjs`); the
  // first run copies his old file in from beside the main checkout (`firstFrom`), never changing it. `SBV_SAVE` still names
  // another file, written with its names as before (`keyed` false).
  // (`SBV_CHOICES` and `SBV_OLD_CHOICES` move the repo's file and the old one it is first copied from, for a test's scratch
  // "machine" or a checkout laid out otherwise; unset, the two places above)
  const oldSave = at(env.SBV_OLD_CHOICES, path.resolve(home, '..', 'Feature-requests', 'space-body-viewer', 'space-bodies.json'));
  const own = env.SBV_SAVE !== undefined && env.SBV_SAVE !== '';
  const save = own ? path.resolve(root, env.SBV_SAVE) : at(env.SBV_CHOICES, path.resolve(root, 'viewer', 'choices', 'space-bodies.json'));
  const imported = at(env.SBV_IMPORTED, path.resolve(home, '..', 'Feature-requests', 'WebGPU Port - Imported Textures'));
  return {
    root,
    port,
    shared: share === 'lan',
    names: String(env.SBV_NAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    save,
    prev: save.replace(/\.json$/i, '') + '.prev.json',
    keyed: !own,
    firstFrom: own ? null : oldSave,
    imported,
    survey: at(env.SBV_SURVEY, path.resolve(home, '..', '..', 'imported')),
    packs: at(env.SBV_PACKS, path.resolve(root, 'assets-private')),
    // (the old viewer's looks.js stands beside his old file of choices, wherever the file now is)
    looks: env.SBV_LOOKS ? [path.resolve(root, env.SBV_LOOKS)] : [path.resolve(root, 'imports-private', 'sky', 'looks-private.json'), path.join(imported, 'looks-private.json'), path.join(path.dirname(own ? save : oldSave), 'looks.js')],
    game: at(env.SBV_GAME, path.resolve(root, 'public', 'sky', 'bodies.json')),
    // (skies of his own worlds) his worlds file, read only, for the worlds of his the System tab can stand on
    worlds: at(env.SBV_WORLDS, path.resolve(root, 'public', 'placements', 'worlds', 'all.json')),
    credit: typeof env.SBV_CREDIT === 'string' && env.SBV_CREDIT.trim() ? env.SBV_CREDIT.trim() : null,
  };
}

/**
 * The repo's main checkout: the folder holding git's common folder (a linked worktree's own `.git` is a file pointing there),
 * or `root` itself where git cannot say (not a checkout, no git on the path).
 */
export function mainCheckoutOf(root) {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  const dir = r.status === 0 ? String(r.stdout || '').trim() : '';
  return dir && path.basename(dir).toLowerCase() === '.git' ? path.dirname(path.resolve(dir)) : root;
}

/**
 * Who the game's credits line names (`SBV_CREDIT`, else the repo's own git user's name: the owner's, on his machine), or ''
 * where neither says.
 */
export function creditName(P) {
  if (P.credit) return P.credit;
  const r = spawnSync('git', ['config', 'user.name'], { cwd: P.root, encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout || '').trim() : '';
}

/** While shared: this PC's own IPv4 addresses, its name (and name.local, as a Mac finds it), and any names given. */
export function lanNames(P) {
  if (!P.shared) return [];
  return [
    ...Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address),
    os.hostname().toLowerCase(),
    `${os.hostname().toLowerCase()}.local`,
    ...P.names,
  ];
}

const MAX_SAVE = 8 * 1024 * 1024;
const MAX_ZONE_SKY = 512 * 1024;
const MAX_PICTURE = 64 * 1024 * 1024;
const MAX_WORLD_SKY = 8 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.fbx': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.dds': 'application/octet-stream',
  '.bin': 'application/octet-stream',
};
/** What the imported folder serves: its meshes and its pictures. */
const IMPORTED_EXT = new Set(['.png', '.jpg', '.jpeg', '.fbx']);

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}
function sendJSON(res, status, value) {
  send(res, status, JSON.stringify(value), TYPES['.json']);
}
async function sendFile(res, file, cache) {
  let st;
  try {
    st = await fsp.stat(file);
    if (!st.isFile()) throw new Error('not a file');
  } catch {
    return send(res, 404, 'Not found');
  }
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': st.size,
    'Cache-Control': cache ? 'private, max-age=3600' : 'no-store',
    'Last-Modified': st.mtime.toUTCString(),
  });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// ---- adding a picture (the old server's rules, word for word) ----
const PICTURE_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9 _-]{0,98}[A-Za-z0-9])?\.(png|jpg|jpeg)$/;
const DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
function plainPictureName(name) {
  if (typeof name !== 'string' || !PICTURE_NAME.test(name)) return false;
  return !DEVICE_NAME.test(name.slice(0, name.lastIndexOf('.')));
}
function pictureType(buf) {
  if (buf.length >= 16 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
    && buf.toString('latin1', 12, 16) === 'IHDR') return 'png';
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  return null;
}
const EXT_TYPE = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg' };
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

async function readBody(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The private table of his looks, read fresh at every ask: a JSON file, or the old viewer's `looks.js` read in place. */
export async function readPrivateLooks(P) {
  for (const file of P.looks) {
    if (!fs.existsSync(file)) continue;
    if (file.endsWith('.json')) {
      const t = JSON.parse(await fsp.readFile(file, 'utf8'));
      if (!isPlainObject(t) || !isPlainObject(t.parts)) throw new Error(`${file} is not a table of looks ({ meshes, halos, rings, parts })`);
      return { from: file, table: t };
    }
    // The old viewer's looks.js, read where it stands (a plain module of names and numbers with no imports of its own):
    // its private half taken off its exports, exactly as `privateTableOf` makes the JSON.
    const url = new URL('file:///' + file.replace(/\\/g, '/'));
    url.searchParams.set('t', String((await fsp.stat(file)).mtimeMs));
    const mod = await import(url.href);
    return { from: file, table: privateTableOf(mod) };
  }
  return null;
}

/**
 * A private table from a module of the old `looks.js`'s shape: the meshes, halos and rings it names (all but the two the
 * shipped part keeps, the sphere every generated look stands on and the flat card) and every look it makes, as made.
 * A made look made again is itself (`makeLook` fills only what is missing), so the parts are the made looks.
 */
export function privateTableOf(mod) {
  const meshes = {};
  for (const [k, v] of Object.entries(mod.MESHES || {})) if (k !== 'planet_01_mesh' && k !== 'sheet') meshes[k] = v;
  return { version: 1, meshes, halos: { ...(mod.HALOS || {}) }, rings: { ...(mod.RINGS || {}) }, parts: typeof mod.defaultLooks === 'function' ? mod.defaultLooks() : {} };
}

/**
 * The middleware: every answer of the old server at its old address, and the new ones. `P` is `viewerPaths`'s; `log` the
 * server's console line (the old server's words).
 */
export function viewerMiddleware(P, log = (s) => console.log(s)) {
  // Pass 2, wave 6 (maker K): his old file of choices copied into the repo's at the first start (never changed or deleted).
  const first = firstRunCopy(P);
  if (first) log(first);
  const HOST = '127.0.0.1';
  const HOSTS = new Set([`${HOST}:${P.port}`, `localhost:${P.port}`, ...lanNames(P).map((n) => `${n}:${P.port}`)]);
  const knownHost = (req) => HOSTS.has(String(req.headers.host || '').toLowerCase());
  const sameOrigin = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    const o = String(origin).toLowerCase();
    return o.startsWith('http://') && HOSTS.has(o.slice('http://'.length));
  };
  const SURVEY_FILES = {
    'textures.json': path.join(P.survey, 'textures.json'),
    'skybodies.txt': path.join(P.survey, 'game-side', 'skybodies.txt'),
  };

  async function importedFile(name) {
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) return null;
    if (!IMPORTED_EXT.has(path.extname(name).toLowerCase())) return null;
    let names;
    try { names = await fsp.readdir(P.imported); } catch { return null; }
    return names.includes(name) ? path.join(P.imported, name) : null;
  }
  async function listImported() {
    let names;
    try { names = await fsp.readdir(P.imported); } catch { return []; }
    const out = [];
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      if (!IMPORTED_EXT.has(path.extname(name).toLowerCase())) continue;
      const st = await fsp.stat(path.join(P.imported, name));
      if (!st.isFile()) continue;
      out.push({ name, size: st.size });
    }
    return out;
  }

  async function addPicture(req, res, url) {
    if (!sameOrigin(req)) return send(res, 403, 'Pictures are only added from the viewer itself');
    const ctype = String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
    if (ctype !== 'image/png' && ctype !== 'image/jpeg') return send(res, 415, 'A PNG or JPEG picture only (image/png or image/jpeg)');
    const name = url.searchParams.get('name') || '';
    if (!plainPictureName(name)) {
      return send(res, 400, `"${name.slice(0, 120)}" is not a plain file name: letters, digits, spaces, _ and - only, starting and ending with a letter or digit, at most 100 of them, then .png, .jpg or .jpeg`);
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_PICTURE) { req.resume(); return send(res, 413, 'Too large: a picture may be at most 64 MB', undefined, { Connection: 'close' }); }
    const buf = await readBody(req, MAX_PICTURE);
    if (!buf) return send(res, 413, 'Too large: a picture may be at most 64 MB', undefined, { Connection: 'close' });
    const type = pictureType(buf);
    if (!type) return send(res, 422, 'Not a PNG or JPEG: its first bytes are not a picture\'s');
    if (EXT_TYPE[path.extname(name).toLowerCase()] !== type) {
      return send(res, 422, `It is a ${type === 'png' ? 'PNG' : 'JPEG'}, but the name ends in ${path.extname(name)}: name it .${type === 'png' ? 'png' : 'jpg'}`);
    }
    let names;
    try { names = await fsp.readdir(P.imported); } catch { return send(res, 500, 'The imported folder is not there: ' + P.imported); }
    const lower = name.toLowerCase();
    const already = names.find((n) => n.toLowerCase() === lower);
    if (already) return send(res, 409, `"${already}" is already in the imported folder, and a file there is never replaced: give the new one another name`);
    const target = path.join(P.imported, name);
    let fh;
    try {
      fh = await fsp.open(target, 'wx');
    } catch (e) {
      if (e.code === 'EEXIST') return send(res, 409, `"${name}" is already in the imported folder, and a file there is never replaced: give the new one another name`);
      throw e;
    }
    try {
      await fh.writeFile(buf);
      await fh.close();
    } catch (e) {
      await fh.close().catch(() => {});
      await fsp.unlink(target).catch(() => {});
      throw e;
    }
    const at = new Date().toISOString();
    log(`[picture] added ${name} (${type.toUpperCase()}, ${buf.length} bytes) -> ${P.imported} at ${at}`);
    sendJSON(res, 200, { ok: true, name, bytes: buf.length, type, at });
  }

  async function save(req, res) {
    if (!sameOrigin(req)) return send(res, 403, 'Saving is only allowed from the viewer itself');
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, 'JSON only');
    const buf = await readBody(req, MAX_SAVE);
    if (!buf) return send(res, 413, 'Too large');
    let data;
    try {
      data = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      return send(res, 400, 'Not JSON: ' + e.message);
    }
    if (!isPlainObject(data) || !isPlainObject(data.looks) || !isPlainObject(data.uses)) {
      return send(res, 400, 'Expected { looks: {...}, uses: {...} }');
    }
    for (const key of ['places', 'zones', 'pictures']) {
      if (data[key] !== undefined && !isPlainObject(data[key])) return send(res, 400, `Expected ${key} to be { ... } when it is there`);
    }
    const looks = Object.keys(data.looks).length;
    const places = Object.keys(data.uses).length;
    const own = data.places ? Object.keys(data.places).length : 0;
    const zones = data.zones ? Object.keys(data.zones).length : 0;
    const pictures = data.pictures ? Object.keys(data.pictures).length : 0;
    // Pass 2, wave 6 (maker K): the repo's file keeps his imported pictures by their keys alone, its records in the order the
    // file already has them, so a save on another machine changes only what changed (`choices.mjs`).
    let before = null;
    if (P.keyed && fs.existsSync(P.save)) {
      try {
        before = JSON.parse(await fsp.readFile(P.save, 'utf8'));
      } catch {
        before = null;
      }
    }
    // (the fixer of wave 6: his meshes keyed too, and his files' names in a look's note, against this machine's folder)
    const text = JSON.stringify(P.keyed ? keepOrder(keyPictures(data, (await listImported()).map((f) => f.name)), before) : data, null, 2) + '\n';
    const tmp = P.save + '.tmp';
    await fsp.mkdir(path.dirname(P.save), { recursive: true });
    await fsp.writeFile(tmp, text, 'utf8');
    if (fs.existsSync(P.save)) await fsp.copyFile(P.save, P.prev);
    await fsp.rename(tmp, P.save);
    const at = new Date().toISOString();
    log(`[save] version ${data.version ?? 1}: ${looks} looks, ${places} places, ${own} places' own settings, ${zones} zone suns, ${pictures} added pictures, ${text.length} bytes -> ${P.save} at ${at}`);
    sendJSON(res, 200, { ok: true, bytes: text.length, at, file: path.basename(P.save) });
  }

  /**
   * Save to game: the page's choices made into the game's own bodies file (`gameBodies.mjs`: numbers only, his own photos
   * only those he marked to ship, a credits line) and written where `SBV_GAME` says, with each photo marked to ship copied
   * beside it into `pictures/` (only those, and never over a different file of the same name without saying so).
   */
  async function saveGame(req, res) {
    if (!sameOrigin(req)) return send(res, 403, 'Saving is only allowed from the viewer itself');
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, 'JSON only');
    const buf = await readBody(req, MAX_SAVE);
    if (!buf) return send(res, 413, 'Too large');
    let data;
    try {
      data = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      return send(res, 400, 'Not JSON: ' + e.message);
    }
    if (!isPlainObject(data) || !isPlainObject(data.looks) || !isPlainObject(data.uses)) return send(res, 400, 'Expected { looks: {...}, uses: {...} }');
    const made = gameBodiesFile({ ...data, credit: creditName(P) }, { at: new Date().toISOString() });
    const dir = path.dirname(P.game);
    await fsp.mkdir(dir, { recursive: true });
    const copied = [];
    for (const name of shippedPictures(made)) {
      const from = await importedFile(name);
      if (!from) continue;
      const to = path.join(dir, 'pictures', gamePictureName(name));
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.copyFile(from, to);
      copied.push(gamePictureName(name));
    }
    const text = JSON.stringify(made, null, 1) + '\n';
    const tmp = P.game + '.tmp';
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, P.game);
    const at = new Date().toISOString();
    log(`[save to game] ${Object.keys(made.looks).length} generated looks, ${Object.keys(made.uses).length} places, ${Object.keys(made.systems).length} systems, ${Object.keys(made.air).length} air dial sets, ${copied.length} photos, ${text.length} bytes -> ${P.game} at ${at}`);
    sendJSON(res, 200, { ok: true, bytes: text.length, at, file: P.game, looks: Object.keys(made.looks).length, uses: Object.keys(made.uses).length, systems: Object.keys(made.systems).length, air: Object.keys(made.air).length, pictures: copied, credits: made.credits });
  }

  async function zoneSkyFile(zone) {
    if (!/^space_[a-z0-9_]+$/.test(zone)) return null;
    const file = path.join(P.packs, zone, 'sky.json');
    try {
      const st = await fsp.stat(file);
      if (!st.isFile() || st.size > MAX_ZONE_SKY) return null;
    } catch {
      return null;
    }
    return file;
  }
  const rampCache = new Map();
  async function worldRampOf(world) {
    if (!/^[a-z0-9_]+$/.test(world) || world.startsWith('space_')) return null;
    if (rampCache.has(world)) return rampCache.get(world);
    let out = null;
    const file = path.join(P.packs, world, 'sky.json');
    try {
      const st = await fsp.stat(file);
      if (st.isFile() && st.size <= MAX_WORLD_SKY) {
        const sky = JSON.parse(await fsp.readFile(file, 'utf8'));
        const blocks = Array.isArray(sky.blocks) ? sky.blocks : [];
        const b = blocks.find((x) => x && x.weatherIndex === 0) || blocks[0];
        if (b && b.ramp && typeof b.ramp.rgba === 'string' && +b.ramp.rows > 0) {
          out = { planet: typeof sky.planet === 'string' ? sky.planet : world, dayNightSplit: +sky.dayNightSplit || null, block: String(b.name || ''), rows: +b.ramp.rows, rgba: b.ramp.rgba };
        }
      }
    } catch {
      out = null;
    }
    rampCache.set(world, out);
    return out;
  }
  /** A file of a converted pack, read only, for the game's air (its sky.json and the gradient pictures the fit reads). */
  async function packFile(rel) {
    const parts = rel.split('/');
    if (parts.length < 2 || parts.some((s) => !s || s === '.' || s === '..' || s.includes('\\') || s.includes('\0'))) return null;
    if (!/^[a-z0-9_]+$/.test(parts[0])) return null;
    const file = path.resolve(P.packs, ...parts);
    if (!file.startsWith(path.resolve(P.packs) + path.sep)) return null;
    return file;
  }

  return async function viewerServe(req, res, next) {
    try {
      const url = new URL(req.url, `http://${HOST}:${P.port}`);
      const p = decodeURIComponent(url.pathname);
      const ours = p === '/save' || p === '/save-game' || p === '/picture' || p === '/api/files' || p === '/api/our-worlds' || p === '/space-bodies.json' || p === '/private/looks.json'
        || p.startsWith('/assets/') || p.startsWith('/survey/') || p.startsWith('/pack/') || p.startsWith('/assets-private/');
      if (!ours) return next();
      if (!knownHost(req)) return send(res, 403, `Open the viewer as http://${HOST}:${P.port}/`);
      if (req.method === 'POST' && p === '/save') return await save(req, res);
      if (req.method === 'POST' && p === '/save-game') return await saveGame(req, res);
      if (req.method === 'POST' && p === '/picture') return await addPicture(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      if (p === '/api/files') return sendJSON(res, 200, { folder: P.imported, files: await listImported() });
      // (skies of his own worlds) his worlds file's rows (id, name, the sky each borrows), read as it stands; none without one
      if (p === '/api/our-worlds') return sendJSON(res, 200, { rows: fs.existsSync(P.worlds) ? ourWorldRows(await fsp.readFile(P.worlds, 'utf8')) : [] });
      if (p === '/space-bodies.json') {
        if (!fs.existsSync(P.save)) return send(res, 204, '');
        if (!P.keyed) return await sendFile(res, P.save, false);
        // Pass 2, wave 6 (maker K): each key made this machine's picture of that name; a key with none here stays a key.
        const got = resolvePictures(JSON.parse(await fsp.readFile(P.save, 'utf8')), (await listImported()).map((f) => f.name));
        if (got.leftPictures) log(`[choices] ${got.leftPictures} of the file's pictures are not in this machine's imported folder: their looks show their generated twins`);
        // (the fixer of wave 6) and his meshes, kept by key too
        if (got.leftMeshes) log(`[choices] ${got.leftMeshes} of the file's meshes are not in this machine's imported folder: kept as their keys`);
        return sendJSON(res, 200, got.file);
      }
      if (p === '/private/looks.json') {
        const got = await readPrivateLooks(P);
        if (!got) return send(res, 204, '');
        return sendJSON(res, 200, { from: got.from, ...got.table });
      }
      if (p.startsWith('/assets/')) {
        const file = await importedFile(p.slice('/assets/'.length));
        if (!file) return send(res, 404, 'Not in the imported folder');
        return await sendFile(res, file, true);
      }
      if (p.startsWith('/survey/')) {
        const file = SURVEY_FILES[p.slice('/survey/'.length)];
        if (!file) return send(res, 404, 'Not a survey file the viewer reads');
        return await sendFile(res, file, false);
      }
      if (p.startsWith('/assets-private/')) {
        const file = await packFile(p.slice('/assets-private/'.length));
        if (!file) return send(res, 404, 'Not a file of a converted pack');
        return await sendFile(res, file, false);
      }
      const rm = p.match(/^\/pack\/([^/]+)\/skyramp\.json$/);
      if (rm) {
        const ramp = await worldRampOf(rm[1]);
        if (!ramp) return send(res, 404, 'No colour ramp for that world');
        return sendJSON(res, 200, ramp);
      }
      const zm = p.match(/^\/pack\/([^/]+)\/sky\.json$/);
      if (zm) {
        const file = await zoneSkyFile(zm[1]);
        if (!file) return send(res, 404, 'Not a space zone\'s sky.json');
        return await sendFile(res, file, false);
      }
      return send(res, 404, 'Not found');
    } catch (e) {
      console.error('[error]', req.method, req.url, e);
      if (!res.headersSent) send(res, 500, 'Server error: ' + e.message);
      else res.destroy();
    }
  };
}

/** The lines the old server printed at start, for the owner's eye in the terminal. */
export function startWords(P) {
  const lines = [`Space body viewer: http://127.0.0.1:${P.port}/`];
  if (P.shared) {
    lines.push('  SHARED with the home network: open one of these on the other machine (one machine editing at a time):');
    for (const n of lanNames(P)) lines.push(`    http://${n}:${P.port}/`);
  }
  lines.push(`  imported folder (read; pictures you add from the page are written here, never over a file): ${P.imported}${fs.existsSync(P.imported) ? '' : '  (NOT FOUND)'}`);
  lines.push(`  survey (read only): ${P.survey}${fs.existsSync(P.survey) ? '' : '  (NOT FOUND)'}`);
  lines.push(`  converted packs (read only): ${P.packs}${fs.existsSync(P.packs) ? '' : "  (NOT FOUND: every zone's sun is white, and the game's air has no world to read)"}`);
  lines.push(`  choices saved to: ${P.save}${fs.existsSync(P.save) ? '' : '  (NOT FOUND)'}${P.keyed ? " (the repo's file: commit it as you do your maps; your pictures' names are kept out of it as keys)" : ''}`);
  // Said loudly (the fixer of pass 2, wave 4a): a viewer opened on the wrong file shows none of his looks and saves apart.
  if (!fs.existsSync(P.save)) {
    lines.push('  ** NO FILE OF CHOICES THERE: the page starts from its defaults, and its first Save writes a new file there.');
    if (P.keyed) lines.push(`  ** Your older choices are copied in at the first start from ${P.firstFrom} where that file is there (it was not); or set SBV_SAVE in .env to their file.`);
    else lines.push('  ** If you have saved choices before, they are elsewhere: set SBV_SAVE (and SBV_IMPORTED) in .env to their folder.');
  }
  const looks = P.looks.find((f) => fs.existsSync(f));
  lines.push(`  his looks' private table: ${looks ?? 'none (every look of his pictures shows its generated twin)'}`);
  lines.push(`  Save to game writes: ${P.game}`);
  return lines;
}
