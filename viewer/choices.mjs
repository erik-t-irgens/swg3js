// The owner's file of choices in the repo (the GPU port's pass 2, wave 6, maker K; his ask of 23 November: his Mac could not
// save, since the file's default stood beside the main checkout's parent, in a folder only his PC has). The file now lives in
// the repo outside `public/`, `viewer/choices/space-bodies.json`, which he commits as he does his maps, so every machine he
// pulls on reads and saves the same choices. Two things make that safe:
//   - his imported pictures' names never go into it: each look's picture (`tex`, a layer's or its flow map's) and each added
//     picture's entry (`pictures`) is written as `#` and its `pictureKey` (`src/sky/look/placeholders.js`' hash of the file's
//     name), and read back against the machine's own imported folder; a key with no picture of that name there stays a key,
//     which the page draws as the look's generated twin (`twinOfLook` reads the key) and writes back as it came;
//   - the first run copies his old file in (the Feature-requests one), its names made keys, and never changes or deletes it.
// `SBV_SAVE` still names another file, read and written with its names as before (a file of one machine's own).
//
// Dependency-free, so the viewer's server and node's tests read it as it stands (`viewerChoices.test.ts`).

import fs from 'node:fs';
import path from 'node:path';

/** A picture's key in the shared file: `#` and eight hex digits. */
export const PICTURE_TOKEN = /^#[0-9a-f]{8}$/;

/** `placeholders.js`' `pictureKey`, the same to the bit (FNV-1a, 32 bits, eight hex digits; `viewerChoices.test.ts` holds them equal). */
export function pictureKey(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Whether `s` is a plain name of an imported picture (no folder, a picture's ending). */
function isPictureName(s) {
  return typeof s === 'string' && /\.(png|jpe?g)$/i.test(s) && !s.includes('/') && !s.includes('\\');
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * (The fixer of pass 2, wave 6) The meshes that ship with the game (`looks.js`' `MESHES`: the sphere every generated look stands
 * on and the flat card): kept by name. Every other mesh a look names is one of his imports (an `.fbx` of his folder, its id the
 * file's name less `.fbx`), kept by its key like a picture.
 */
const SHIPPED_MESHES = new Set(['planet_01_mesh', 'sheet']);

/** A key token inside free words: `#` and eight hex digits standing alone. */
const TOKEN_IN_TEXT = /#[0-9a-f]{8}(?![0-9a-f])/g;

/**
 * A deep copy of `v` with every `tex` string, every `mesh` string and every `note` string, and at the top every key of
 * `pictures`, handed through `swap(s, kind)` (`kind` 'picture', 'mesh' or 'note').
 */
function swapPictures(v, swap, top = true) {
  if (Array.isArray(v)) return v.map((x) => swapPictures(x, swap, false));
  if (!isObj(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (top && k === 'pictures' && isObj(x)) {
      const p = {};
      for (const [name, entry] of Object.entries(x)) p[swap(name, 'picture')] = swapPictures(entry, swap, false);
      out[k] = p;
    } else if (k === 'tex' && typeof x === 'string') out[k] = swap(x, 'picture');
    else if (k === 'mesh' && typeof x === 'string') out[k] = swap(x, 'mesh');
    else if (k === 'note' && typeof x === 'string') out[k] = swap(x, 'note');
    else out[k] = swapPictures(x, swap, false);
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The words of a note with every name of `names` (this machine's imported files, with their endings or without) made its
 * key, the longest names first, each only where it stands as a whole word (the checker of wave 6 found two of his pictures
 * named in looks' notes).
 */
function keyNamesIn(text, names) {
  const words = new Set();
  for (const n of names) {
    if (typeof n !== 'string' || !n) continue;
    words.add(n);
    const base = n.replace(/\.(png|jpe?g|fbx)$/i, '');
    if (base.length >= 4) words.add(base);
  }
  let out = text;
  for (const w of [...words].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(?<![A-Za-z0-9_.-])${escapeRe(w)}(?![A-Za-z0-9_])`, 'g');
    out = out.replace(re, '#' + pictureKey(w));
  }
  return out;
}

/**
 * The file as the repo keeps it: every imported picture's name made its key, every mesh of his imports (one whose `.fbx` is in
 * `names`, this machine's imported folder, never the two the game ships) made the key of its id, and every name of `names` in
 * a look's note made its key; a key stays a key, and a mesh word that names no file of the folder stays as it is. `names` may
 * be left out, keying the pictures alone.
 */
export function keyPictures(data, names = []) {
  const meshes = new Set();
  for (const n of names) if (typeof n === 'string' && /\.fbx$/i.test(n)) meshes.add(n.slice(0, -4));
  return swapPictures(data, (s, kind) => {
    if (kind === 'picture') return isPictureName(s) ? '#' + pictureKey(s) : s;
    if (kind === 'mesh') {
      // a mesh may name one of its sections after a `#` (`<id>#<section>`): the id keyed, the section kept
      const cut = s.indexOf('#');
      const id = cut > 0 ? s.slice(0, cut) : s;
      return meshes.has(id) && !SHIPPED_MESHES.has(id) ? '#' + pictureKey(id) + (cut > 0 ? s.slice(cut) : '') : s;
    }
    return names.length ? keyNamesIn(s, names) : s;
  });
}

/**
 * The file as this machine reads it: each key made the name in `names` (this machine's imported folder) whose key it is: a
 * picture's file name, a mesh's id (its file's name less `.fbx`), a name in a note with its ending or without, as it was
 * written; a key with none there stays a key. Answers the file and how many keys it resolved and left.
 */
export function resolvePictures(data, names) {
  const byKey = new Map();
  const meshByKey = new Map();
  const wordByKey = new Map();
  for (const n of names) {
    if (typeof n !== 'string' || !n) continue;
    if (isPictureName(n) && !byKey.has(pictureKey(n))) byKey.set(pictureKey(n), n);
    if (/\.fbx$/i.test(n)) {
      const id = n.slice(0, -4);
      if (!meshByKey.has(pictureKey(id))) meshByKey.set(pictureKey(id), id);
    }
    if (!wordByKey.has(pictureKey(n))) wordByKey.set(pictureKey(n), n);
    const base = n.replace(/\.(png|jpe?g|fbx)$/i, '');
    if (base.length >= 4 && !wordByKey.has(pictureKey(base))) wordByKey.set(pictureKey(base), base);
  }
  let resolved = 0;
  let left = 0;
  let leftPictures = 0;
  let leftMeshes = 0;
  const file = swapPictures(data, (s, kind) => {
    if (kind === 'note') {
      return s.replace(TOKEN_IN_TEXT, (t) => {
        const w = wordByKey.get(t.slice(1));
        if (w) resolved++;
        else left++;
        return w ?? t;
      });
    }
    if (kind === 'mesh' && /^#[0-9a-f]{8}#/.test(s)) {
      // a keyed mesh with its section after it
      const id = meshByKey.get(s.slice(1, 9));
      if (id) {
        resolved++;
        return id + s.slice(9);
      }
      left++;
      leftMeshes++;
      return s;
    }
    if (!PICTURE_TOKEN.test(s)) return s;
    const n = (kind === 'mesh' ? meshByKey : byKey).get(s.slice(1));
    if (n) {
      resolved++;
      return n;
    }
    left++;
    if (kind === 'mesh') leftMeshes++;
    else leftPictures++;
    return s;
  });
  return { file, resolved, left, leftPictures, leftMeshes };
}

/**
 * The file's records in the order the file on disk already has them (`before`, the last save's), what is new after them in the
 * page's order: a page on a machine with fewer of his pictures builds its looks in another order (each missing one's twin comes
 * first), and the repo's file would change on every machine's save though nothing in it did. Answers the file reordered.
 */
export function keepOrder(data, before) {
  if (!isObj(data) || !isObj(before)) return data;
  const out = { ...data };
  for (const k of ['looks', 'uses', 'places', 'zones', 'pictures']) {
    const now = data[k];
    const was = before[k];
    if (!isObj(now) || !isObj(was)) continue;
    const o = {};
    for (const id of Object.keys(was)) if (Object.prototype.hasOwnProperty.call(now, id)) o[id] = now[id];
    for (const id of Object.keys(now)) if (!Object.prototype.hasOwnProperty.call(o, id)) o[id] = now[id];
    out[k] = o;
  }
  return out;
}

/**
 * The first run (the viewer's server at its start): where the repo's file of choices is not yet there and his old file is,
 * the old file is read, its names made keys and written as the repo's file; the old file is never written, moved or deleted.
 * Answers what was done, in words, or null where nothing was.
 */
export function firstRunCopy(P) {
  if (!P.keyed || !P.firstFrom || fs.existsSync(P.save) || !fs.existsSync(P.firstFrom)) return null;
  const data = JSON.parse(fs.readFileSync(P.firstFrom, 'utf8'));
  // (the fixer of wave 6) the names of this machine's imported folder, so a note naming one of them is keyed too
  let names = [];
  try {
    names = P.imported ? fs.readdirSync(P.imported).filter((n) => /\.(png|jpe?g|fbx)$/i.test(n)) : [];
  } catch {
    names = [];
  }
  const keyed = keyPictures(data, names);
  fs.mkdirSync(path.dirname(P.save), { recursive: true });
  const text = JSON.stringify(keyed, null, 2) + '\n';
  const tmp = P.save + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, P.save);
  return `[choices] first run: ${P.firstFrom} copied into ${P.save} (its imported picture names written as their keys; the old file is left as it was)`;
}
