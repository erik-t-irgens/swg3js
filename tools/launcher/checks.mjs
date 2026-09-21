// The launcher's checks on the three folders a player points it at, and on the disk. Each check
// answers with `ok` and one plain sentence a person can act on, because the page shows exactly that
// sentence. They read only names and sizes: nothing here opens an archive.

import { existsSync, readdirSync, statSync, statfsSync } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { isRetailByName } from '../swg/manifest.mjs';

/** What a first full conversion comes to on disk, with room to spare (the owner's is 13 to 14 GB). Ours. */
export const FULL_CONVERSION_BYTES = 16 * 1024 ** 3;
/** The least a conversion into a folder that already holds content is started with. Ours. */
export const TOP_UP_BYTES = 3 * 1024 ** 3;

/** Names that say a folder already holds converted content (any one is enough). */
const CONTENT_MARKS = ['tatooine', 'corellia', 'naboo', 'creatures', 'player', 'weapons', 'ships', 'sounds', 'mobiles', 'characters', 'wardrobe', 'galaxy.json', 'space_tatooine'];
/** The packs that make up most of the size: while none is there, the whole conversion is still ahead. */
const LARGE_MARKS = ['tatooine', 'sounds', 'mobiles', 'wardrobe', 'characters'];

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** A size in words: 1.2 GB, 340 MB. */
export function formatBytes(n) {
  if (!Number.isFinite(n)) return '?';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}

/**
 * The SWG folder: it must hold the client's `.tre` archives, and some of them must be retail ones by
 * the converter's own inventory (`tools/swg/manifests/retail.json`), since every conversion runs with
 * `--retail-only` and a folder of emulator or mod archives alone would convert nothing.
 */
export function checkSwg(dir, retail = isRetailByName) {
  if (!dir) return { ok: false, sentence: 'Choose the folder that holds your Star Wars Galaxies client\'s .tre archives.' };
  if (!isDir(dir)) return { ok: false, sentence: `${dir} is not a folder that exists.` };
  let names = [];
  try {
    names = readdirSync(dir);
  } catch (err) {
    return { ok: false, sentence: `${dir} cannot be read (${err.code ?? err.message}).` };
  }
  const archives = names.filter((n) => /\.tre$/i.test(n));
  if (!archives.length) {
    const below = names.filter((n) => isDir(join(dir, n)) && safeList(join(dir, n)).some((m) => /\.tre$/i.test(m)));
    const hint = below.length ? ` They are in ${join(dir, below[0])}: choose that folder instead.` : '';
    return { ok: false, sentence: `${dir} holds no .tre archives, so it is not a Star Wars Galaxies client folder.${hint}` };
  }
  let retailCount = 0;
  for (const n of archives) {
    let size;
    try {
      size = statSync(join(dir, n)).size;
    } catch {
      continue;
    }
    if (retail(n, size)) retailCount++;
  }
  if (!retailCount) return { ok: false, sentence: `${dir} has ${archives.length} .tre archives but none of them is one the retail game shipped, so a retail-only conversion would find nothing.`, archives: archives.length, retail: 0 };
  return { ok: true, sentence: `Star Wars Galaxies client: ${retailCount} retail archives of ${archives.length}.`, archives: archives.length, retail: retailCount };
}

function safeList(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Jedi Academy: its `GameData` folder (or the `base` folder inside it), which must hold the game's own
 * `assets0.pk3`. Optional: without it the player has no Jedi Academy clips and no saber sounds.
 */
export function checkJka(dir) {
  if (!dir) return { ok: false, optional: true, sentence: 'No Jedi Academy folder: the saber moves, jumps and saber sounds are left out. Choose its GameData folder to add them.' };
  if (!isDir(dir)) return { ok: false, sentence: `${dir} is not a folder that exists.` };
  const base = existsSync(join(dir, 'base', 'assets0.pk3')) ? join(dir, 'base') : existsSync(join(dir, 'assets0.pk3')) ? dir : null;
  if (!base) {
    const hint = isDir(join(dir, 'GameData')) ? ` Choose ${join(dir, 'GameData')} instead.` : '';
    return { ok: false, sentence: `${dir} has no base\\assets0.pk3, so it is not Jedi Academy's GameData folder.${hint}` };
  }
  return { ok: true, sentence: `Jedi Academy: ${base === dir ? 'its base folder' : 'its GameData folder'}.`, base };
}

/** Whether `inner` is `outer` or inside it (case-insensitively on Windows). */
export function isInside(inner, outer) {
  if (!inner || !outer) return false;
  const norm = (p) => {
    const r = resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  const a = norm(inner);
  const b = norm(outer);
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
}

/**
 * Where the converted content goes. It is large, so it is wherever the player says, with four
 * refusals: not a drive's root, not inside the launcher's own install (an update replaces that
 * folder), not inside either game's folder, and not a folder already full of something else. A folder
 * that does not exist yet is fine: the conversion makes it.
 */
export function checkOut(dir, { appDir, dataDir, swg, jka } = {}) {
  if (!dir) return { ok: false, sentence: 'Choose a folder for the converted content (about 14 GB when it is all done).' };
  const full = resolve(dir);
  if (parse(full).root === full || parse(full).root === full + sep) return { ok: false, sentence: 'Choose a folder rather than the root of a drive.' };
  if (appDir && isInside(full, appDir)) return { ok: false, sentence: 'That folder is inside the launcher\'s own install, which every update replaces. Choose another.' };
  if (dataDir && isInside(dataDir, full)) return { ok: false, sentence: 'That folder holds the launcher\'s own files. Choose a folder of its own.' };
  if (swg && (isInside(full, swg) || isInside(swg, full))) return { ok: false, sentence: 'Keep the converted content out of the Star Wars Galaxies folder. Choose another.' };
  if (jka && (isInside(full, jka) || isInside(jka, full))) return { ok: false, sentence: 'Keep the converted content out of the Jedi Academy folder. Choose another.' };
  if (existsSync(full) && !isDir(full)) return { ok: false, sentence: `${full} is a file, not a folder.` };
  if (!existsSync(full)) {
    const parent = nearestExisting(full);
    if (!parent) return { ok: false, sentence: `${full} is on a drive that is not there.` };
    return { ok: true, empty: true, sentence: `The converted content will go in ${full} (it will be made).` };
  }
  const names = safeList(full);
  if (!names.length) return { ok: true, empty: true, sentence: `The converted content will go in ${full}.` };
  // "Empty" for the disk check means nothing large is in yet: a folder holding only the galaxy file
  // still has the whole of the conversion ahead of it.
  const lower = names.map((n) => n.toLowerCase());
  if (lower.some((n) => CONTENT_MARKS.includes(n))) return { ok: true, empty: !lower.some((n) => LARGE_MARKS.includes(n)), sentence: `${full} already holds converted content; a conversion adds what is missing.` };
  return { ok: false, sentence: `${full} already holds other things. Choose an empty folder, or one made for the converted content.` };
}

/** The nearest folder at or above `p` that exists, or null. */
export function nearestExisting(p) {
  let cur = resolve(p);
  for (;;) {
    if (isDir(cur)) return cur;
    const up = dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

/** Free bytes on the disk that holds `p` (or would hold it), or null when it cannot be told. */
export function freeBytes(p) {
  const at = nearestExisting(p);
  if (!at) return null;
  try {
    const s = statfsSync(at);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/**
 * Whether there is room to start: a first conversion into an empty folder needs the whole of it, a
 * top-up of a folder that holds content needs a margin. Answers the numbers and a sentence.
 */
export function roomFor(outDir, { empty = true } = {}, free = freeBytes(outDir)) {
  const need = empty ? FULL_CONVERSION_BYTES : TOP_UP_BYTES;
  if (free === null) return { ok: true, need, free, sentence: `A full conversion needs about ${formatBytes(FULL_CONVERSION_BYTES)}; the free space on that disk could not be read.` };
  if (free < need) return { ok: false, need, free, sentence: `That disk has ${formatBytes(free)} free and the conversion needs about ${formatBytes(need)}. Free some space or choose a folder on another disk.` };
  return { ok: true, need, free, sentence: `${formatBytes(free)} free; the conversion needs about ${formatBytes(need)}.` };
}
