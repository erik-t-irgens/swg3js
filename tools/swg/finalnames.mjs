// SOE's final names list: the late layer of a Legends install, mounted by name and place.
//
// Every Legends install holds SOE's last seventeen archives (publishes 55 to 59), but the indexes beside
// them are SOE's publish 54 copies, so nothing in them could be read. SOE's own final index names every
// file in them; `manifests/final-names.json` is the difference between the mount that index gives and the
// mount the Legends install's own indexes give, as names and places only (path, archive, offset, lengths,
// compressor, checksum, and SOE's deletions; no content), committed by the owner's decision of 2026-10-18.
// `openVfs` applies it after the indexes, all of it or none (`mountFinalNames`), so a player whose
// archives are SOE's converts SOE's final client from their own install and anybody else converts exactly
// the world they always had.
//
// Everything that keeps a pack in step with that choice is here too: the stamp each command writes into
// the file `status` reads for it (`withLate`), what `status` asks of a stamp (`lateAsk`), the cheap look
// at an install `status` takes instead of opening its archives (`probeInstall`), the test a keep-by-
// presence path asks beside its material stamp (`keptStale`), the maintainer's row checker
// (`verifyFinalNames`) and the check of what a run left unwritten (`rewrittenCheck`).
//
// This module imports nothing of tre.mjs (tre.mjs imports it): the mount hands its own opener, filter
// and apply in, and the row checker is handed `openTre`.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { materialStale } from './surface.mjs';

/** Where the committed list lives. Named by a literal relative URL, so the release's import check sees it. */
export const FINAL_NAMES_URL = new URL('./manifests/final-names.json', import.meta.url);

const RETAIL = JSON.parse(readFileSync(new URL('./manifests/retail.json', import.meta.url), 'utf8'));

/** The list's columns, in the order every row is written. */
export const FINAL_NAMES_COLUMNS = ['kind', 'index', 'path', 'archive', 'offset', 'length', 'stored', 'compressor', 'sha1'];

/** The four indexes a list is made from and gated on, in the order they are replayed. */
export const SKU_TOCS = ['sku0_client.toc', 'sku1_client.toc', 'sku2_client.toc', 'sku3_client.toc'];

const KINDS = new Set(['set', 'gone', 'deleted']);
const INDEXES = new Set(['sku0', 'sku1', 'sku2', 'sku3']);

/**
 * Rows held back by path, each with why, skipped and counted [owner default, the design's D6]. SOE's final
 * index points both terrains at the last hotfix's copies with their Life Day layers switched on (a party on
 * Tatooine flattening a 70 m circle, the snow on Talus); today's copies are byte for byte SOE's own
 * snowless ones, so holding the rows keeps SOE's snowless bytes with no row of ours, and keeps both
 * terrains, their grass pictures and their walk grids out of the run. Snowless until the owner says.
 */
export const FINAL_NAMES_HELD = {
  'terrain/tatooine.trn': "Life Day snow: SOE's final copy switches the season's layers on; today's is SOE's snowless one",
  'terrain/talus.trn': "Life Day snow: SOE's final copy switches the season's layers on; today's is SOE's snowless one",
};

const sha1 = (text) => createHash('sha1').update(text).digest('hex');

/** SHA-256 of a whole file, read in large slices (never loaded whole). */
export function sha256File(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const buf = Buffer.allocUnsafe(8 << 20);
    const h = createHash('sha256');
    for (let at = 0; at < size; ) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, size - at), at);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
      at += n;
    }
    return h.digest('hex');
  } finally {
    closeSync(fd);
  }
}

/**
 * The list's identity: the first 12 hex of the SHA-1 of its text with `\r\n` folded to `\n`, since a checkout
 * with `core.autocrlf` writes the file CRLF where git and a launcher have it LF, and one list must have one key.
 */
export function finalNamesKey(text) {
  return sha1(String(text).replace(/\r\n/g, '\n')).slice(0, 12);
}

/** retail.json's facts about an archive (size, SHA-256), by its name; a hooked list's own facts first. */
function factsOf(list, name) {
  const own = list?.facts?.[name] ?? list?.facts?.[String(name).toLowerCase()];
  if (own) return own;
  return RETAIL.nge_final[String(name).toLowerCase()] ?? null;
}

/**
 * A list read from its text and checked: `format` 1, the nine columns, every row's kind, index and archive
 * index, every archive named in retail.json's `nge_final` with a size and a SHA-256 (or in the list's own
 * `facts`, which only a list loaded through the test hook may carry), `from` and `against` naming the four
 * indexes. A list that fails is no list: it comes back `{ broken: why }` and the mount is today's.
 */
export function parseFinalNames(text, { facts = false } = {}) {
  const key = finalNamesKey(text);
  let list;
  try {
    list = JSON.parse(String(text));
  } catch (err) {
    return { broken: `it is not JSON (${err.message})`, key };
  }
  const why = checkShape(list, { facts });
  if (why) return { broken: why, key };
  list.key = key;
  return list;
}

function checkShape(list, { facts }) {
  if (!list || typeof list !== 'object') return 'it is not an object';
  if (list.format !== 1) return `format ${list.format} is not 1`;
  if (list.facts !== undefined && !facts) return 'it carries facts of its own, which only a test list may';
  if (!Array.isArray(list.columns) || list.columns.join() !== FINAL_NAMES_COLUMNS.join()) return 'its columns are not the nine this reader knows';
  if (!Array.isArray(list.archives) || !list.archives.length || list.archives.some((a) => typeof a !== 'string')) return 'it names no archives';
  for (const a of list.archives) {
    const f = factsOf(list, a);
    if (!f || typeof f.sha256 !== 'string' || typeof f.size !== 'number') return `${a} has no size and SHA-256 in retail.json's nge_final`;
  }
  for (const side of ['from', 'against']) {
    for (const t of SKU_TOCS) if (typeof list[side]?.[t]?.sha256 !== 'string') return `its ${side} does not name ${t}`;
  }
  if (!Array.isArray(list.rows)) return 'it has no rows';
  for (const r of list.rows) {
    if (!Array.isArray(r) || r.length !== FINAL_NAMES_COLUMNS.length) return 'a row is not nine fields';
    const [kind, index, path, archive, offset, length, stored, compressor, hash] = r;
    if (!KINDS.has(kind)) return `a row's kind ${JSON.stringify(kind)} is not set, gone or deleted`;
    if (!INDEXES.has(index)) return `a row's index ${JSON.stringify(index)} is not sku0 to sku3`;
    if (typeof path !== 'string' || !path) return 'a row has no path';
    if (!Number.isInteger(archive) || archive < 0 || archive >= list.archives.length) return `${path}: its archive ${archive} is not in the list`;
    if (![offset, length, stored, compressor].every((n) => Number.isInteger(n) && n >= 0)) return `${path}: its place is not four whole numbers`;
    if (kind === 'set' && (length <= 0 || !/^[0-9a-f]{40}$/.test(hash))) return `${path}: a set row needs a length and a SHA-1`;
    if (kind !== 'set' && length !== 0) return `${path}: a ${kind} row has a length`;
  }
  return null;
}

/**
 * The list a mount uses: `SWG3JS_FINAL_NAMES=<file>` in the environment names a list to load in place of the
 * committed one (the test hook, for the CLI's mount and `status`'s probe alike, and the only way a list may
 * carry `facts`), else the committed file. Never throws: an unreadable list comes back `{ broken }`.
 */
export function loadFinalNames() {
  const hook = process.env.SWG3JS_FINAL_NAMES;
  const file = hook ? hook : FINAL_NAMES_URL;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    return { broken: `it cannot be read (${err.code ?? err.message})`, key: null };
  }
  return parseFinalNames(text, { facts: !!hook });
}

let committed;
/** The list for this process, read once. */
export function finalNamesList() {
  if (committed === undefined) committed = loadFinalNames();
  return committed;
}

/** The archive indexes the list's `set` rows read: the ones whose bytes must be SOE's before a row applies. */
export function readArchives(list) {
  const out = new Set();
  for (const r of list.rows ?? []) if (r[0] === 'set') out.add(r[3]);
  return [...out].sort((a, b) => a - b).map((i) => list.archives[i]);
}

/** The four index hashes of a folder (null for one not there), as `{ name: sha256 }`. */
function indexHashes(tocPathOf) {
  const out = {};
  for (const t of SKU_TOCS) {
    const p = tocPathOf(t);
    out[t] = p && existsSync(p) ? sha256File(p) : null;
  }
  return out;
}

const same = (hashes, side) => SKU_TOCS.every((t) => hashes[t] === side?.[t]?.sha256);
const differing = (hashes, side) => SKU_TOCS.filter((t) => hashes[t] !== side?.[t]?.sha256);

/** Every archive file a folder holds, beside it or under its `tres/`, by lower-case name, as the mount and the probe both find them. */
function archiveFiles(dir) {
  const out = new Map();
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  const tres = names.find((f) => f.toLowerCase() === 'tres');
  if (tres) {
    try {
      for (const f of readdirSync(join(dir, tres))) out.set(f.toLowerCase(), join(dir, tres, f));
    } catch {
      // A tres folder that cannot be read holds nothing.
    }
  }
  for (const f of names) out.set(f.toLowerCase(), join(dir, f));
  return out;
}

/** An archive file's size and the whole millisecond it was last written, or null where it is not there. */
function fileFacts(path) {
  if (!path) return null;
  try {
    const st = statSync(path);
    return { size: st.size, mtime: Math.round(st.mtimeMs) };
  } catch {
    return null;
  }
}

/**
 * The late phase of a mount, run by `openVfs` after its index loop. `tocPaths` maps each index it read (lower
 * case) to its path; `archiveFor`, `allowed` and `apply` are openVfs's own; `has` says whether the index
 * already answers a path. In order: no `sku0_client.toc` read is `none` (a pre-CU install); the four indexes
 * equal to `from` is `final` (SOE's own indexes, nothing to apply); not equal to `against` is `none`; any of
 * the archives the rows read not allowed by the filter, missing, or not SOE's by size and SHA-256 is
 * `refused`, naming each, and no row is applied; otherwise every row but the held ones goes through
 * `apply` (a set with a `read` over the opened archive, marked `late`; a gone or deleted row as a deletion)
 * and the mount is `applied`. All or none: the late archives refer to each other, so half a late layer is a
 * world no SOE client drew, and one server needs one world.
 *
 * A refusal also records what each refused archive was on disk (`seen`: its size and when it was last written,
 * null where it is not there; `dir` is the folder the mount reads), so `status`, which never hashes an archive,
 * asks again for a refused pack only once one of them has moved (`lateAsk`): a byte flipped at SOE's own size is
 * a refusal the probe cannot see, and asked again on the probe's word alone it would be asked for ever.
 */
export function mountFinalNames(list, { tocPaths, archiveFor, allowed, apply, has = () => false, timing = {}, dir = null }) {
  const out = { state: 'none', key: list?.key ?? null, rows: list?.rows?.length ?? 0, applied: 0, newPaths: 0, newer: 0, held: 0, refused: [], seen: {}, why: null };
  if (!list || list.broken) return { ...out, why: `the names list cannot be used: ${list?.broken ?? 'none was given'}` };
  const t0 = performance.now();
  const tocPathOf = (t) => tocPaths.get(t) ?? null;
  if (!tocPathOf('sku0_client.toc')) return { ...out, why: 'no NGE index here (no sku0_client.toc)' };
  const hashes = indexHashes(tocPathOf);
  timing.indexes = performance.now() - t0;
  if (same(hashes, list.from)) return { ...out, state: 'final', why: "this folder's own indexes are SOE's final ones" };
  if (!same(hashes, list.against)) return { ...out, why: `the indexes here are neither SOE's final ones nor the ones the list was made against (${differing(hashes, list.against).join(', ')})` };
  const t1 = performance.now();
  const opened = new Map();
  const files = dir ? archiveFiles(dir) : new Map();
  const refuse = (name, why) => {
    out.refused.push(`${name}: ${why}`);
    out.seen[name.toLowerCase()] = fileFacts(files.get(name.toLowerCase()));
  };
  for (const name of readArchives(list)) {
    const facts = factsOf(list, name);
    let ok = null;
    try {
      ok = allowed(name);
    } catch {
      ok = null;
    }
    if (ok === null) {
      refuse(name, 'missing');
      continue;
    }
    if (!ok) {
      refuse(name, 'left out by --retail-only: not the retail size');
      continue;
    }
    const tre = archiveFor(name);
    if (!tre) {
      refuse(name, 'missing');
      continue;
    }
    if (tre.fileSize !== facts.size) {
      refuse(name, `${tre.fileSize} bytes, SOE's is ${facts.size}`);
      continue;
    }
    if (sha256File(tre.path) !== facts.sha256) {
      refuse(name, "its bytes are not SOE's (SHA-256 differs)");
      continue;
    }
    opened.set(name, tre);
  }
  timing.archives = performance.now() - t1;
  if (out.refused.length) return { ...out, state: 'refused', why: out.refused.join('; ') };
  const t2 = performance.now();
  for (const [kind, , path, ai, offset, length, stored, compressor] of list.rows) {
    if (Object.prototype.hasOwnProperty.call(FINAL_NAMES_HELD, path.toLowerCase())) {
      out.held++;
      continue;
    }
    const name = list.archives[ai];
    if (kind === 'set') {
      const tre = opened.get(name);
      if (has(path)) out.newer++;
      else out.newPaths++;
      apply(path, { archive: tre.path, deleted: false, size: length, late: true, read: () => tre.readBlob(offset, length, stored, compressor) });
    } else {
      apply(path, { archive: name, deleted: true, size: 0, late: true });
    }
    out.applied++;
  }
  timing.apply = performance.now() - t2;
  return { ...out, state: 'applied' };
}

/** The mount's second line: what the late phase did, in a player's words. */
export function lateMountLine(late) {
  const n = (x) => Number(x).toLocaleString('en-US');
  if (!late || late.state === 'off') return null;
  if (late.state === 'applied') return `SOE's final names: ${n(late.applied)} rows applied (${n(late.newPaths)} new files, ${n(late.newer)} newer${late.held ? `; ${late.held} held back: Life Day snow` : ''})`;
  if (late.state === 'final') return "SOE's final names: this folder has SOE's final indexes (Tatooine and Talus carry Life Day's snow, which other players' worlds do not)";
  return `SOE's final names: not applied: ${late.why}; this is the publish 54 world`;
}

// ---------------------------------------------------------------------------------------------------------
// The stamp every command writes, and what is asked of it.

/**
 * Every command that mounts the archives, the file(s) `status` reads its stamp from, and what `status` asks
 * for when the stamp says the pack is of another late world. `<world>` is every converted planet pack,
 * `<zone>` every space zone, `<wardrobe>` every wardrobe folder (`<run>` its own flags), `<species>` every
 * species the index lists; `#players.0` names the record inside the file that carries `late`. Held by `finalNames.test.ts`
 * against `convertPlan.mjs`'s commands, so a command added there must be stamped here or exempted below.
 */
export const LATE_STAMPED = [
  { command: 'snapshot', files: ['<world>/manifest.json'], ask: 'snapshot <swg-dir> all <out> --radius=all --retail-only' },
  { command: 'terrain', files: ['<world>/terrain/shaders.json'], ask: 'terrain <swg-dir> all <out> --retail-only' },
  // The grass reads the shaders its affectors place out of the archives, so a re-issued grass picture on a
  // terrain that did not change is still asked.
  { command: 'radial', files: ['<world>/terrain/radial.json'], ask: 'radial <swg-dir> <out> --retail-only' },
  { command: 'sky', files: ['<world>/sky.json'], ask: 'sky <swg-dir> all <out> --retail-only' },
  { command: 'water', files: ['<world>/water.json'], ask: 'water <swg-dir> all <out> --retail-only' },
  { command: 'pois', files: ['<world>/pois.json'], ask: 'pois <swg-dir> all <out> --retail-only' },
  { command: 'flora', files: ['flora-cards.json'], ask: 'flora <swg-dir> all <out> --retail-only' },
  { command: 'floracollision', files: ['<world>/flora-collision.json'], ask: 'floracollision <swg-dir> <out> --retail-only' },
  { command: 'wardrobe', files: ['wardrobe/<wardrobe>/wardrobe.json'], ask: 'wardrobe <swg-dir> <out> --retail-only<run>' },
  { command: 'creatures', files: ['creatures/manifest.json'], ask: 'creatures <swg-dir> <out> --retail-only' },
  { command: 'player', files: ['player/manifest.json#players.0'], ask: 'player <swg-dir> <out> --retail-only' },
  { command: 'parts', files: ['characters/<player>/parts.json'], ask: 'parts <swg-dir> <out> --retail-only' },
  { command: 'species', files: ['characters/index.json', 'characters/<species>/parts.json'], ask: 'species <swg-dir> <out> --retail-only' },
  { command: 'customization', files: ['characters/customization.json'], ask: 'customization <swg-dir> <out> --retail-only' },
  { command: 'loading', files: ['loading/index.json'], ask: 'loading <swg-dir> <out> --retail-only' },
  // The units are keyed on the late world too (mobiles.mjs `sourceStampOf`), so a run asked for here makes every
  // unit from the other world again and keeps the rest.
  { command: 'mobiles', files: ['mobiles/catalogue.json#options.source'], ask: 'mobiles <swg-dir> <out> --retail-only --skip-existing' },
  { command: 'weapons', files: ['weapons/manifest.json'], ask: 'weapons <swg-dir> <out> --retail-only' },
  { command: 'ships', files: ['ships/manifest.json', 'ships/combat.json'], ask: 'ships <swg-dir> <out> --retail-only' },
  { command: 'space', files: ['<zone>/space.json'], ask: 'space <swg-dir> all <out> --retail-only' },
  { command: 'gallery', files: ['gallery/manifest.json'], ask: 'gallery <swg-dir> <out> --retail-only' },
  { command: 'sounds', files: ['sounds/sounds.json', 'sounds/ships.json', '<world>/sounds.json'], ask: 'sounds <swg-dir> <out> all --retail-only' },
  { command: 'props', files: ['props/manifest.json'], ask: 'props <swg-dir> <out> --retail-only' },
  { command: 'travel', files: ['<world>/travel.json'], ask: 'travel <swg-dir> <out> --retail-only' },
  { command: 'fittings', files: ['<world>/fittings.json'], ask: 'fittings <swg-dir> <out> --retail-only' },
  { command: 'deeds', files: ['deeds.json'], ask: 'deeds <swg-dir> <out> --retail-only' },
  { command: 'spawns', files: ['spawns/manifest.json'], ask: 'spawns <out> --swg=<swg-dir> --retail-only' },
  { command: 'objeffects', files: ['<world>/objeffects.json', 'props/objeffects.json'], ask: 'objeffects <swg-dir> <out> --retail-only' },
  { command: 'doors', files: ['doors/manifest.json', '<world>/doors.json', 'gallery/doors.json'], ask: 'doors <swg-dir> <out> --retail-only' },
  { command: 'conversations', files: ['conversations/speakers.json'], ask: 'conversations <swg-dir> <out> --retail-only' },
];

/** The commands that write no stamp, each with why; `finalNames.test.ts` fails if a list ever touches what they read. */
export const LATE_EXEMPT = {
  music: 'the list has no row under player_music/',
  maps: 'the list has no row under texture/ui_map_ or datatables/buildout/areas_',
  sandbox: 'listed, never asked',
  navgrid: 'reads no archive; asked again by the layout it baked (layoutKey)',
  scenes: 'reads no archive; asked again whenever a world converts again',
  clouds: 'reads no archive; follows the sky it measures',
  'clips-save': 'reads no archive; follows the player pack',
  'clips-apply': 'reads no archive; follows the parts rig',
};

/**
 * Per stamped command, a number a fix raises to ask that command again everywhere a pack carries a lower one
 * [ours]: a keep-by-presence path missed in this wave and found after leaves models stale under a stamp that
 * says `applied`, and raising its number here is the whole of the second chance.
 */
export const LATE_STAMP_VERSION = Object.fromEntries(LATE_STAMPED.map((e) => [e.command, 1]));

/**
 * What a command writes as `late` into the file `status` reads for it: the list's key whatever the state,
 * the state, the rows the list holds, the command's stamp version, and the gate's why when it did not apply;
 * a refusal also what each refused archive was on disk (`seen`), which `lateAsk` holds the probe to.
 * Null for a mount that ran no late phase at all (a stand-in in a test).
 */
export function lateStampOf(vfs, command) {
  const late = vfs?.late;
  if (!late) return null;
  return {
    key: late.key ?? null,
    state: late.state,
    rows: late.rows ?? 0,
    v: LATE_STAMP_VERSION[command] ?? 1,
    ...(late.state === 'applied' || late.state === 'final' ? {} : late.why ? { why: late.why } : {}),
    ...(late.state === 'refused' && late.seen ? { seen: late.seen } : {}),
  };
}

/**
 * `obj` with its `late` stamp written in, over any it carried; a mount with no late phase writes none and takes
 * an old one out, since what it writes stands for no late world it knows of.
 */
export function withLate(obj, vfs, command) {
  const stamp = lateStampOf(vfs, command);
  if (stamp) obj.late = stamp;
  else delete obj.late;
  return obj;
}

/** Which late world a stamp (or a mount's `late`) stands for: SOE's final by the list, by SOE's own indexes, or publish 54's. */
export function lateWorld(stamp) {
  if (stamp?.state === 'applied') return `names:${stamp.key}`;
  if (stamp?.state === 'final') return 'final-index';
  return 'publish54';
}

/**
 * Whether models a record stands for must be converted again although their files are there: older than the
 * material format, or converted from another late world than this mount's, or under a stamp version a fix has
 * since raised. Every keep-by-presence path in cli.mjs asks this and never `materialStale` alone, or a run the
 * late stamp asked for would write the stamp over the very models it was asked to redo. With no mount (status,
 * which reads no archive) only the material format is asked; the late loop asks the rest there.
 */
export function keptStale(record, vfs, command) {
  if (materialStale(record)) return true;
  if (!vfs?.late) return false;
  const here = lateWorld(vfs.late);
  if (lateWorld(record?.late) !== here) return true;
  return here !== 'publish54' && Number(record?.late?.v ?? 0) < (LATE_STAMP_VERSION[command] ?? 1);
}

/**
 * Why `status` asks for a command again by its late stamp, or null. `current` is `{ key, v }` (the committed
 * list's key, that command's stamp version); `probe` what `probeInstall` said of the named install, or null
 * when none was named. An install the list cannot serve is never asked to convert again for nothing.
 *
 * A pack the mount refused is asked again on the probe's `serves` only once an archive it refused has moved
 * (its size or when it was written, against the stamp's `seen`), since the probe reads sizes and the mount
 * also SOE's bytes: a byte flipped at SOE's own size, or an archive this machine cannot open, would otherwise
 * be asked for in every `status` and converted again in every `convert`, refused each time. A refusal
 * stamped before `seen` was written is asked as it always was.
 */
export function lateAsk(stamp, current, probe) {
  const can = probe?.state === 'serves' || probe?.state === 'final';
  if (!stamp) return can ? 'converted before SOE\'s final files (publishes 55 to 59) could be mounted' : null;
  const mounted = stamp.state === 'applied' || stamp.state === 'final';
  if (stamp.key !== current.key && (mounted || can)) return 'converted with an older names list';
  if (mounted && Number(stamp.v ?? 0) < Number(current.v ?? 1)) return "converted before a fix to how it reads SOE's final files";
  if (!mounted && can) {
    if (stamp.state === 'refused' && probe.state === 'serves' && stamp.seen && typeof stamp.seen === 'object' && !refusedMoved(stamp.seen, probe.archives)) return null;
    return "this install can now mount SOE's final files";
  }
  return null;
}

/** Whether any archive a refusal saw (`seen`, by lower-case name) is not what the probe finds there now. */
function refusedMoved(seen, now) {
  return Object.entries(seen).some(([name, was]) => {
    const is = now?.[name] ?? null;
    return !was || !is || is.size !== was.size || is.mtime !== was.mtime;
  });
}

/**
 * What `status` can learn of an install without opening an archive: the four index files' SHA-256 (about
 * 14.6 MB) and the sizes of the archives the rows read. `serves` (the indexes are the ones the list was made
 * against and every archive is SOE's size), `final` (SOE's own indexes), or `no` with why. `serves` also
 * carries each archive's size and when it was written (`archives`, by lower-case name), which is what a
 * refused pack's stamp is held to.
 */
export function probeInstall(dir, list = finalNamesList()) {
  if (!list || list.broken) return { state: 'no', why: `the names list cannot be used: ${list?.broken ?? 'none'}` };
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return { state: 'no', why: `${dir} cannot be read` };
  }
  const tocs = new Map(names.filter((f) => /\.toc$/i.test(f)).map((f) => [f.toLowerCase(), join(dir, f)]));
  if (!tocs.has('sku0_client.toc')) return { state: 'no', why: 'no NGE index here (no sku0_client.toc)' };
  const hashes = indexHashes((t) => tocs.get(t) ?? null);
  if (same(hashes, list.from)) return { state: 'final', why: "this folder's own indexes are SOE's final ones" };
  if (!same(hashes, list.against)) return { state: 'no', why: `its indexes are not the ones the list was made against (${differing(hashes, list.against).join(', ')})` };
  const files = archiveFiles(dir);
  const wrong = [];
  const archives = {};
  for (const name of readArchives(list)) {
    const facts = factsOf(list, name);
    const is = fileFacts(files.get(name.toLowerCase()));
    if (!is) wrong.push(`${name} is missing`);
    else if (is.size !== facts.size) wrong.push(`${name} is ${is.size} bytes, SOE's is ${facts.size}`);
    else archives[name.toLowerCase()] = is;
  }
  if (wrong.length) return { state: 'no', why: wrong.join('; ') };
  return { state: 'serves', why: null, archives };
}

/**
 * The maintainer's row checker: every `set` row read back from the install it names and held to its length
 * and SHA-1, through `openTre`. Answers the rows that do not hold, `{ path, why }`, empty for a true list.
 */
export function verifyFinalNames(dir, list, { openTre }) {
  const bad = [];
  const open = new Map();
  const treOf = (name) => {
    if (!open.has(name)) {
      let path = join(dir, name);
      if (!existsSync(path) && existsSync(join(dir, 'tres', name))) path = join(dir, 'tres', name);
      let tre = null;
      try {
        tre = existsSync(path) ? openTre(path) : null;
      } catch {
        tre = null;
      }
      open.set(name, tre);
    }
    return open.get(name);
  };
  try {
    for (const [kind, , path, ai, offset, length, stored, compressor, hash] of list.rows) {
      if (kind !== 'set') continue;
      const tre = treOf(list.archives[ai]);
      if (!tre) {
        bad.push({ path, why: `${list.archives[ai]} is missing` });
        continue;
      }
      let bytes;
      try {
        bytes = tre.readBlob(offset, length, stored, compressor);
      } catch (err) {
        bad.push({ path, why: `cannot be read (${err.message})` });
        continue;
      }
      if (bytes.length !== length) bad.push({ path, why: `${bytes.length} bytes, the list says ${length}` });
      else if (createHash('sha1').update(bytes).digest('hex') !== hash) bad.push({ path, why: 'its bytes are not the ones the list names (SHA-1 differs)' });
    }
  } finally {
    for (const t of open.values()) t?.close();
  }
  return bad;
}

/**
 * What a world's walk grid was baked from: the first 12 hex of the SHA-1 of its pack's `layout.json` (line endings
 * folded) and the terrain file it names. `navgrid` writes it into `nav.json` and `status` works it out again, so a
 * grid is asked for again exactly when the layout or the terrain under it moved, and never for a world converted
 * again to the same answer. Null where the pack has no layout.
 */
export function layoutKeyOf(packDir) {
  let text;
  try {
    text = readFileSync(join(packDir, 'layout.json'), 'utf8');
  } catch {
    return null;
  }
  const h = createHash('sha1').update(text.replace(/\r\n/g, '\n'));
  let terrain = 'terrain.trn';
  try {
    terrain = JSON.parse(text).terrain ?? terrain;
  } catch {
    // A layout that will not parse is still a layout to key; its terrain is the usual name.
  }
  try {
    h.update('\n \n').update(readFileSync(join(packDir, terrain)));
  } catch {
    h.update('\n \nno terrain');
  }
  return h.digest('hex').slice(0, 12);
}

/**
 * Why a world's walk grid (`nav.json`'s header) must be baked again for what it was baked from, or null: one that
 * names a `layoutKey` other than the pack's own now, or one that names none beside a world `manifest.json` stamped
 * `applied` (the layout was converted with SOE's final files after the grid was baked). A grid with no key over a
 * world converted without them is left alone, so an install the list cannot serve is never asked for its grids.
 * `status` asks it and `navgrid --skip-existing` asks it, so a resumed bake never keeps a grid `status` then asks for.
 */
export function gridLayoutStale(grid, packDir, manifest) {
  if (!grid) return null;
  if (grid.layoutKey) return grid.layoutKey !== layoutKeyOf(packDir) ? 'was baked from another layout or terrain than the pack has now' : null;
  return manifest?.late?.state === 'applied' ? "was baked before the world was converted with SOE's final files" : null;
}

// ---------------------------------------------------------------------------------------------------------
// What a run left unwritten.

/** The models, pictures and buffers whose being left unwritten by a stamped command is a fault. */
const KEPT_EXT = new Set(['.glb', '.png', '.rgba', '.bin']);

/**
 * Which command owns a file under the packs folder, by where it is: null for a folder no command of today
 * writes (what an old `pack` run left at the top), the exempt commands' own files by name. Never exact for a
 * world folder (the snapshot, the flora, the sky, the water, the effects and the doors all write there), so a
 * world's file is named for the commands that may own it.
 */
export function ownerOf(rel, worlds, zones) {
  const parts = rel.split('/');
  const top = parts[0];
  const file = parts[parts.length - 1];
  if (parts.length === 1) return file === 'deeds.json' ? 'deeds' : file === 'flora-cards.json' ? 'flora' : null;
  if (top === 'nge') return 'nge';
  if (worlds.includes(top)) {
    if (file === 'nav.json' || file === 'nav.bin') return 'navgrid';
    if (file === 'map.png' || file === 'map.json') return 'maps';
    if (file === 'clouds.json') return 'clouds';
    if (parts[1] === 'terrain' && /^radial\./.test(file)) return 'radial';
    if (parts[1] === 'terrain') return 'terrain';
    if (parts[1] === 'sky') return 'sky';
    if (parts[1] === 'water') return 'water';
    if (parts[1] === 'particles') return 'snapshot or objeffects';
    if (parts[1] === 'flora') return 'snapshot or flora';
    return 'snapshot';
  }
  if (zones.includes(top)) return 'space';
  const byFolder = {
    wardrobe: 'wardrobe', creatures: 'creatures', player: 'player', characters: 'species, parts or clips-apply', loading: 'loading',
    mobiles: 'mobiles', weapons: 'weapons', ships: 'ships', space_sandbox: 'sandbox', gallery: 'gallery', sounds: 'sounds',
    props: 'props', music: 'music', scenes: 'scenes', clouds: 'clouds', spawns: 'spawns', doors: 'doors', conversations: 'conversations', travel: 'travel',
  };
  return byFolder[top] ?? null;
}

/** Every file under a folder as `[relative path with /, size, mtimeMs]`. */
export function inventoryOf(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const st = statSync(p);
        out.push([relative(root, p).split(sep).join('/'), st.size, Math.round(st.mtimeMs)]);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Every string ending .glb, .png, .rgba or .bin each JSON file under a folder names, as bare file names, lower
 * case, keyed by the folder the JSON stands in (relative to `root`, with /). A JSON names only what stands at or
 * under its own folder: `wardrobe/human_female/wardrobe.json` names a female mesh, and the female mesh an older
 * run left in `wardrobe/human_male/` is named by nothing there.
 */
function namedByJson(root, folder) {
  const byDir = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.json$/i.test(e.name)) {
        const key = relative(root, dir).split(sep).join('/');
        const names = byDir.get(key) ?? new Set();
        const visit = (v) => {
          if (typeof v === 'string') {
            if (/\.(glb|png|rgba|bin)$/i.test(v)) names.add(v.replace(/\\/g, '/').split('/').pop().toLowerCase());
          } else if (Array.isArray(v)) for (const x of v) visit(x);
          else if (v && typeof v === 'object') for (const x of Object.values(v)) visit(x);
        };
        try {
          visit(JSON.parse(readFileSync(p, 'utf8')));
        } catch {
          // A file that will not parse names nothing.
        }
        byDir.set(key, names);
      }
    }
  };
  walk(folder);
  return byDir;
}

/**
 * The maintainer's check after a run (`final-names --rewritten`): every file that existed before it (`before`,
 * an inventory), still exists and was not written since `since`, grouped by its pack folder and extension,
 * the exempt commands' folders and `nge/` left out. A model, picture or buffer no JSON in its pack folder names
 * is reported apart, as left over from an older run; any other one left unwritten in a stamped command's
 * folder is a fault, named for the command that owns the folder. Answers `{ faults, leftOver, kept, ok }`.
 */
export function rewrittenCheck(outDir, { since, before, worlds = [], zones = [] }) {
  const exempt = new Set(Object.keys(LATE_EXEMPT));
  const was = new Map(before.map((r) => [r[0], r]));
  const now = new Map(inventoryOf(outDir).map((r) => [r[0], r]));
  const faults = new Map();
  const leftOver = new Map();
  const kept = new Map();
  const jsonNames = new Map();
  /** Whether a JSON at or above the file's own folder, inside its top folder, names it. */
  const named = (rel, top) => {
    if (!top) return false;
    if (!jsonNames.has(top)) jsonNames.set(top, namedByJson(outDir, join(outDir, top)));
    const byDir = jsonNames.get(top);
    const base = rel.split('/').pop().toLowerCase();
    const dirs = rel.split('/').slice(0, -1);
    for (let n = dirs.length; n >= 1; n--) if (byDir.get(dirs.slice(0, n).join('/'))?.has(base)) return true;
    return false;
  };
  for (const [rel] of was) {
    const cur = now.get(rel);
    if (!cur || cur[2] >= since) continue;
    const owner = ownerOf(rel, worlds, zones);
    if (owner === 'nge' || (owner && exempt.has(owner))) continue;
    const ext = extname(rel).toLowerCase();
    const top = rel.includes('/') ? rel.split('/')[0] : '';
    const group = `${top || '.'} ${ext || '(none)'}`;
    if (!KEPT_EXT.has(ext)) {
      kept.set(group, (kept.get(group) ?? 0) + 1);
      continue;
    }
    if (!owner || !named(rel, top)) {
      leftOver.set(group, (leftOver.get(group) ?? []).concat(rel));
      continue;
    }
    const f = faults.get(group) ?? { owner, files: [] };
    f.files.push(rel);
    faults.set(group, f);
  }
  return { faults, leftOver, kept, ok: faults.size === 0 };
}
