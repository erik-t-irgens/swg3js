// What this game reads from the SWGEmu emulator's scripts, kept as a file of our own.
//
// Six commands need things that were the live server's and are in no archive the client shipped:
// the travel terminals, ticket collectors and shuttles a starport stands (`travel`), the other
// children of a building and the props the screenplays put down (`fittings`, and the outdoor half in
// `snapshot`), what a deed makes and what it costs (`deeds`), where the world's creatures and people
// stood (`spawns`), and each mobile's health and damage (`mobiles`). They used to open the owner's own
// Core3 checkout for them, which meant nobody else could have any of it: the launcher has no such
// folder, and a player was never going to be asked to install an emulator to get a travel terminal.
//
// So the answers are kept here instead (`core3ref/`, beside this file), written once by
// `npm run swg -- core3-reference @CORE3` from the owner's checkout. What is kept is only what the
// readers already take out -- names, places, turns, counts and stats -- and never the scripts
// themselves. Every command reads it by default, so a checkout and a launcher convert the very same
// thing; a live folder is read only when a command is given `--core3=<dir>` outright.
//
// The one rule that makes this safe is the one `core3-reference` enforces as it writes: every answer
// is read back out of the file and compared with the live reader's before the file is kept, for every
// question any command can ask, so the reference can never quietly answer differently from the folder
// it came from. Maps and Sets, which JSON cannot hold, are written as `{ "$map": [...] }` and
// `{ "$set": [...] }` and put back on the way in; a plain object that happens to carry either key is
// refused rather than misread.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C3 from './core3.mjs';
import * as D from './deeds.mjs';
import * as F from './fittings.mjs';
import * as S from './spawns.mjs';
import * as T from './travel.mjs';

/** Bumped when the shape of the reference files changes in a way a reader must know about. */
export const CORE3_REF_FORMAT = 1;

/** Where the reference lives: in the checkout, and in every release beside the converter. */
export const CORE3_REF_DIR = fileURLToPath(new URL('./core3ref/', import.meta.url));

/** The answer for a zone no script names: the per-zone readers are asked about any world, the gallery's too. */
const OTHER = '*';

/**
 * Every reader a command calls, by the name the source object answers to. `zone` readers take a
 * world's name and are kept per zone; the rest take nothing but the folder.
 */
export const CORE3_READERS = {
  readTravelBuildings: { file: 'travel-buildings.json', read: (dir) => T.readTravelBuildings(dir) },
  readFittingBuildings: { file: 'fitting-buildings.json', read: (dir) => F.readFittingBuildings(dir) },
  readServerProps: { file: 'server-props.json', zone: true, read: (dir, zone) => F.readServerProps(dir, zone) },
  readDeeds: { file: 'deeds.json', read: (dir) => D.readDeeds(dir) },
  readBuildings: { file: 'deed-buildings.json', read: (dir) => D.readBuildings(dir) },
  scanServerSpawns: { file: 'server-spawns.json', zone: true, read: (dir, zone) => S.scanServerSpawns(dir, zone) },
  core3MobileStats: { file: 'mobile-stats.json', read: (dir) => S.core3MobileStats(dir) },
  readRegions: { file: 'regions.json', read: (dir) => C3.readRegions(dir) },
  readSpawnGroups: { file: 'spawn-groups.json', read: (dir) => C3.readSpawnGroups(dir) },
  readLairs: { file: 'lairs.json', read: (dir) => C3.readLairs(dir) },
  readCreatures: { file: 'creatures.json', read: (dir) => C3.readCreatures(dir) },
  readStatics: { file: 'statics.json', read: (dir) => C3.readStatics(dir) },
};

// ---------------------------------------------------------------------------------------------
// Writing and reading the values.

/** A value as JSON text, with its Maps and Sets tagged. Throws on anything JSON would change silently. */
export function encodeValue(value) {
  // The replacer sees each value once, before it is written; the `{ $map }` it hands back for a Map is
  // written as it stands and never passed through here again, so a plain object carrying either key
  // can only be one the readers made, and it is refused.
  return JSON.stringify(value, (key, v) => {
    if (v instanceof Map) return { $map: [...v] };
    if (v instanceof Set) return { $set: [...v] };
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`${key}: ${v} is not a number JSON can hold`);
    if (typeof v === 'bigint' || typeof v === 'function' || typeof v === 'symbol') throw new Error(`${key}: a ${typeof v} cannot be kept`);
    if (Array.isArray(v) && v.some((x) => x === undefined)) throw new Error(`${key}: an array holding undefined would come back holding null`);
    if (v && typeof v === 'object' && !Array.isArray(v) && ('$map' in v || '$set' in v)) throw new Error(`${key}: an object carrying $map or $set would be misread`);
    return v;
  });
}

/** The value back from `encodeValue`'s text: fresh objects every time, so a caller may change them. */
export function decodeValue(text) {
  return JSON.parse(text, (key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === '$map' && Array.isArray(v.$map)) return new Map(v.$map);
      if (keys.length === 1 && keys[0] === '$set' && Array.isArray(v.$set)) return new Set(v.$set);
    }
    return v;
  });
}

/**
 * Whether two values would read the same to any caller: equal numbers, strings and booleans; arrays
 * of equal length and equal items; Maps and Sets with the same entries in the same order; and plain
 * objects whose keys agree once a key holding `undefined` is taken as absent, which is how JSON writes
 * it and how every reader here is read. The first difference is returned as a path, or null.
 */
export function differs(a, b, path = '$') {
  if (a === b) return null;
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return null;
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map)) return `${path}: a Map on one side only`;
    if (a.size !== b.size) return `${path}: ${a.size} entries against ${b.size}`;
    const ea = [...a];
    const eb = [...b];
    for (let i = 0; i < ea.length; i++) {
      const k = differs(ea[i][0], eb[i][0], `${path}<key ${i}>`);
      if (k) return k;
      const v = differs(ea[i][1], eb[i][1], `${path}<${String(ea[i][0])}>`);
      if (v) return v;
    }
    return null;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set)) return `${path}: a Set on one side only`;
    return differs([...a], [...b], `${path}{}`);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!(Array.isArray(a) && Array.isArray(b))) return `${path}: an array on one side only`;
    if (a.length !== b.length) return `${path}: ${a.length} items against ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = differs(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (a[k] === undefined && b[k] === undefined) continue;
      const d = differs(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return `${path}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`;
}

// ---------------------------------------------------------------------------------------------
// The zones the per-zone readers can answer for.

/** Every `.lua` file under a folder. */
function luaUnder(dir) {
  const out = [];
  const walk = (d) => {
    let names;
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(d, n);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (n.toLowerCase().endsWith('.lua')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/**
 * Every zone a screenplay can name: a quoted first argument to `spawnSceneObject` or `spawnMobile`,
 * and a file's own `planet = "..."`, which is what the readers take `self.planet` and `planet` to
 * be. Anything the readers can answer for is one of these; every other name gets the answer the
 * reference keeps as `*`, which is what the live reader gives a name no script uses.
 */
export function screenplayZones(dir) {
  const zones = new Set();
  const root = join(dir, 'screenplays');
  if (!existsSync(root)) return [];
  for (const file of luaUnder(root)) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(/\b(?:spawnSceneObject|spawnMobile)\s*\(\s*"([^"]+)"/g)) zones.add(m[1]);
    for (const m of text.matchAll(/\bplanet\s*=\s*"([^"]+)"/g)) zones.add(m[1]);
  }
  return [...zones].sort();
}

// ---------------------------------------------------------------------------------------------
// Writing the reference, checked.

/**
 * Reads every reader out of a Core3 scripts folder and writes the reference into `outDir`, then reads
 * each file back and compares it with what the folder gave, for every zone the scripts name and for a
 * name none of them does. Nothing is written over the old reference unless every comparison holds.
 * Returns what it wrote, with a count per reader.
 */
export function writeCore3Reference(dir, { outDir = CORE3_REF_DIR, extraZones = [], log = () => {} } = {}) {
  if (!dir || !existsSync(join(dir, 'object', 'building')) || !existsSync(join(dir, 'screenplays'))) {
    throw new Error(`${dir || '(nothing)'} is not Core3's scripts folder (MMOCoreORB/bin/scripts): it has no object/building and screenplays`);
  }
  const zones = [...new Set([...screenplayZones(dir), ...extraZones])].sort();
  // A name no script uses, to stand for every other: the gallery, a space zone with nothing in it.
  const nowhere = '\u0000none';
  const files = {};
  const counts = {};
  for (const [name, r] of Object.entries(CORE3_READERS)) {
    const t0 = Date.now();
    let value;
    if (r.zone) {
      value = {};
      for (const z of zones) value[z] = r.read(dir, z);
      value[OTHER] = r.read(dir, nowhere);
    } else {
      value = r.read(dir);
    }
    const text = encodeValue(value);
    // Checked against a second, independent read of the folder, so a reader that hands back the same
    // object twice cannot make the comparison trivially true.
    const back = decodeValue(text);
    const fresh = r.zone ? Object.fromEntries([...zones.map((z) => [z, r.read(dir, z)]), [OTHER, r.read(dir, nowhere)]]) : r.read(dir);
    const d = differs(fresh, back);
    if (d) throw new Error(`${name}: the reference would answer differently from the folder (${d}); nothing was written`);
    files[r.file] = text;
    counts[name] = r.zone ? Object.fromEntries(Object.entries(value).map(([z, v]) => [z, sizeOf(v)])) : sizeOf(value);
    log(`  ${name.padEnd(22)} ${(text.length / 1024).toFixed(0).padStart(6)} KB  ${Date.now() - t0} ms`);
  }
  mkdirSync(outDir, { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(outDir, file), `${text}\n`);
  const index = {
    format: CORE3_REF_FORMAT,
    note: "Read from SWGEmu Core3's scripts (MMOCoreORB/bin/scripts, AGPL-3.0, https://github.com/swgemu/Core3) by `npm run swg -- core3-reference`: names, places, turns, counts and stats only, never the scripts. Every file was compared with a fresh read of the folder before it was kept.",
    zones,
    files: Object.fromEntries(Object.entries(CORE3_READERS).map(([name, r]) => [name, r.file])),
    counts,
  };
  writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
  return index;
}

/** How many things a value holds, for the index: a Map's or Set's size, an array's length, an object's keys. */
function sizeOf(v) {
  if (v instanceof Map || v instanceof Set) return v.size;
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') {
    if (Array.isArray(v.objects) || Array.isArray(v.mobiles)) return (v.objects?.length ?? 0) + (v.mobiles?.length ?? 0);
    if (v.statics instanceof Map) return v.statics.size;
    return Object.keys(v).length;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Reading: one object that answers every reader, from the reference or from a folder.

/**
 * The source a command reads Core3's answers from. With a folder (`--core3=<dir>` named outright) it
 * reads that folder live; otherwise it reads the reference kept beside this file. Either way it has
 * one method per reader, taking the same arguments less the folder, and every call hands back fresh
 * objects, since some commands write into what they are given (`fittings` puts a model on each child).
 *
 * `where` says which it is, for a command to print; `missing` is set when there is neither a folder
 * nor a reference, which is a checkout or a release that lost the files, and says so.
 */
export function core3Source({ dir = '', refDir = CORE3_REF_DIR } = {}) {
  if (dir) {
    if (!existsSync(dir)) throw new Error(`--core3=${dir}: no such folder`);
    const src = { kind: 'folder', where: dir, missing: null };
    for (const [name, r] of Object.entries(CORE3_READERS)) src[name] = r.zone ? (zone) => r.read(dir, zone) : () => r.read(dir);
    return src;
  }
  const indexFile = join(refDir, 'index.json');
  const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : null;
  const src = {
    kind: 'reference',
    where: refDir,
    missing: index ? null : `the Core3 reference is not there (${indexFile}); every command that reads it finds nothing`,
  };
  const texts = new Map();
  const textOf = (file) => {
    if (!texts.has(file)) {
      const p = join(refDir, file);
      texts.set(file, existsSync(p) ? readFileSync(p, 'utf8') : null);
    }
    return texts.get(file);
  };
  for (const [name, r] of Object.entries(CORE3_READERS)) {
    src[name] = (zone) => {
      const text = textOf(r.file);
      if (text === null) throw new Error(`the Core3 reference has no ${r.file} (${refDir}); run \`npm run swg -- core3-reference @CORE3\` in a checkout`);
      const all = decodeValue(text);
      if (!r.zone) return all;
      return Object.prototype.hasOwnProperty.call(all, zone) ? all[zone] : all[OTHER];
    };
  }
  return src;
}

/**
 * The source a command's options ask for: `--core3=<dir>` reads that folder, `--core3=none` asks for
 * none at all (null, which `mobiles` takes as "heuristic stats"), and anything else reads the
 * reference. The folder in `.env` is deliberately not read here: it is what `core3-reference` is
 * written from, and a command that used it would convert one thing in the owner's checkout and
 * another in every launcher.
 */
export function core3SourceFor(options = {}) {
  if (options.core3 === 'none') return null;
  return core3Source({ dir: options.core3 ?? '' });
}
