// Jedi Academy's own sound: what each hilt hums, how it lights and shuts off, and the files
// its animation events name (the swings, the blocks' bounces, the spins, the kicks, the body
// falls and the catch). The saber work in this game is Jedi Academy's, so its sounds come
// across with it.
//
// A hilt is a `.sab` file under `ext_data/sabers/`: a name, a brace block, and one `key value`
// a line, values quoted or bare, with `//` comments and `/* */` blocks around them. One file
// may hold many hilts (`sabers.sab` holds the ones the single-player game hands out). The three
// fields taken here are `soundOn`, `soundLoop` and `soundOff`; everything else belongs to the
// blade, which the game already has.
//
// The extension a name is written with is not always the one in the archives, and it slips both
// ways: `sound/weapons/saber/saberhup%d.wav` is nine `.mp3` files and `sound/weapons/saber/
// saber_catch.mp3` is a `.wav`. Jedi Academy's own loader falls back, so every lookup here
// tries the other extension before calling a file missing.
//
// Where an event's frame falls in its clip is read against `animation.cfg`, and that file is
// the one thing here a mod can quietly change: any `.pk3` dropped in the folder overrides the
// stock archives, and a common animation mod rewrites nineteen of its 1,417 rows, three of them
// walks whose frame count it doubles. The clips the player actually plays were retargeted from
// the stock ranges, so a footstep written against a mod's count lands at the wrong point in the
// walk. Both humanoid files are therefore read from the stock archives only, and every clip's
// frame count is checked against the ones already converted for the player, so a disagreement
// shows as a line in `status` rather than as feet out of step.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openJkaBase, openZip, parseAnimationCfg } from './jka.mjs';
import { jkaClipEvents } from './clipevents.mjs';

export const JKA_SOUND_FORMAT = 2;

const EVENTS_CFG = 'models/players/_humanoid/animevents.cfg';
const ANIMATION_CFG = 'models/players/_humanoid/animation.cfg';
const SABER_DIR = 'ext_data/sabers/';
/** The folder every hum, swing, block, spin and bounce sits in; taken whole. */
const SABER_SOUNDS = 'sound/weapons/saber/';
/** The archives Jedi Academy itself ships; anything else in the folder is a mod. */
const STOCK_ARCHIVE = /^assets\d+\.pk3$/i;

/**
 * A `.sab` file's hilts: `{ id, fields }` each, with the keys lower-cased and the values
 * unquoted. Comments are stripped first, so a commented-out field is not read as one.
 */
export function parseSab(text) {
  const clean = String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const out = [];
  let id = null;
  let fields = null;
  for (const raw of clean.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '{') {
      if (id) fields = {};
      continue;
    }
    if (line === '}') {
      if (id && fields) out.push({ id, fields });
      id = null;
      fields = null;
      continue;
    }
    if (!fields) {
      // A hilt's name stands on its own line before the brace.
      id = line.split(/\s+/)[0];
      continue;
    }
    const m = /^(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    fields[m[1].toLowerCase()] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/** A name written in a `.sab` or an event line, as the archives spell it, or null. */
export function resolveJkaFile(base, name) {
  if (!name) return null;
  const path = name.replace(/\\/g, '/').replace(/^\//, '');
  if (base.has(path)) return path;
  const other = /\.wav$/i.test(path) ? path.replace(/\.wav$/i, '.mp3') : /\.mp3$/i.test(path) ? path.replace(/\.mp3$/i, '.wav') : null;
  if (other && base.has(other)) return other;
  return null;
}

/** Every hilt under `ext_data/sabers/`, with its three sounds resolved to files that exist. */
export function readSabers(base, files, { log = () => {} } = {}) {
  const out = {};
  let missing = 0;
  for (const f of files) {
    let hilts;
    try {
      hilts = parseSab(base.read(f).toString('latin1'));
    } catch {
      continue;
    }
    for (const { id, fields } of hilts) {
      const set = {};
      for (const [key, field] of [['on', 'soundon'], ['loop', 'soundloop'], ['off', 'soundoff']]) {
        const named = fields[field];
        if (!named) continue;
        const file = resolveJkaFile(base, named);
        if (file) set[key] = file;
        else if (!/null/i.test(named)) missing++;
      }
      if (!Object.keys(set).length) continue;
      // Two files may name the same hilt; the later archive's has already won at `read`, so
      // the first spelling wins here and a repeat is left alone.
      out[id.toLowerCase()] ??= { ...set, from: f };
    }
  }
  log(`  sounds: ${Object.keys(out).length} Jedi Academy hilts name a hum${missing ? ` (${missing} named sounds are not in the archives)` : ''}`);
  return out;
}

/**
 * The files a sound event names: one, or the whole numbered set when it writes `%d`. `ranges`
 * is every range the name is drawn from across the event lines, not one: the saber whooshes are
 * written as three lines of three indices each, and taking one range would leave six files
 * behind.
 */
export function eventSoundFiles(base, name, ranges) {
  if (!name) return [];
  if (!name.includes('%d')) {
    const one = resolveJkaFile(base, name);
    return one ? [one] : [];
  }
  const list = ranges && ranges.length ? ranges : [[1, 1]];
  const out = new Set();
  for (const [lo, hi] of list) {
    for (let i = lo; i <= hi; i++) {
      const f = resolveJkaFile(base, name.replace('%d', String(i)));
      if (f) out.add(f);
    }
  }
  return [...out];
}

/**
 * One of the two humanoid config files, read from the stock archives alone (later stock archive
 * wins, as the engine loads them). Null when no stock archive holds it, which is the loose-file
 * install `openJkaBase` also accepts; the caller then falls back to the base's own answer and
 * says so.
 */
export function readStockConfig(baseDir, path) {
  let files = [];
  try {
    files = readdirSync(baseDir).filter((f) => STOCK_ARCHIVE.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return null;
  }
  for (const name of files.reverse()) {
    let zip;
    try {
      zip = openZip(join(baseDir, name));
    } catch {
      continue;
    }
    try {
      if (zip.has(path)) return { data: zip.read(path), archive: name };
    } finally {
      zip.close();
    }
  }
  return null;
}

/**
 * Every Jedi Academy clip the player rig already carries, by name, as `player/manifest.json`
 * records it (`jkaClips`: loop, fps, frames). Null when no player has been converted yet.
 */
export function playedJkaClips(outDir) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(outDir, 'player', 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
  const out = {};
  for (const p of manifest.players ?? []) for (const [name, clip] of Object.entries(p.jkaClips ?? {})) out[name] ??= clip;
  return Object.keys(out).length ? out : null;
}

/**
 * The frame counts the events were written against, against the frame counts of the clips the
 * game actually plays. They come from the same file, so they agree unless the install changed
 * under one of them -- a mod archive overriding `animation.cfg`, or a player converted from a
 * different install than the sounds.
 */
export function checkPlayedFrames(clips, played) {
  const differ = [];
  let checked = 0;
  for (const [name, entry] of Object.entries(clips)) {
    const p = played[name];
    if (!p || typeof p.frames !== 'number') continue;
    checked++;
    if (p.frames !== entry.frames) differ.push({ clip: name, config: entry.frames, played: p.frames });
  }
  return { checked, matched: checked - differ.length, differ };
}

/**
 * The Jedi Academy half of the `sounds` command: its animation events, its hilts and the sound
 * files both name, copied into the pack at their own archive paths. Returns the clip events, so
 * the clip-event file can carry them beside the game's own.
 */
export function convertJkaSounds(jkaDir, outDir, { log = () => {} } = {}) {
  const base = openJkaBase(jkaDir);
  try {
    const soundsDir = join(outDir, 'sounds');
    // The stock archives' copies, never a mod's: see the note at the top of the file.
    const configs = {};
    const readConfig = (path, what) => {
      const stock = readStockConfig(base.base, path);
      if (stock) {
        configs[what] = stock.archive;
        return stock.data.toString('latin1');
      }
      configs[what] = base.where(path) ?? null;
      log(`  sounds: no stock archive holds ${path}; reading it from ${configs[what] ?? 'the install'} instead`);
      return base.read(path).toString('latin1');
    };
    const cfg = parseAnimationCfg(readConfig(ANIMATION_CFG, 'animation'));
    const events = jkaClipEvents(readConfig(EVENTS_CFG, 'events'), cfg, { log });

    // And the proof, rather than the assumption: the clips the player rig plays were retargeted
    // from these same frame ranges, so their frame counts have to agree with the config's.
    const played = playedJkaClips(outDir);
    const clipCheck = played ? checkPlayedFrames(events.clips, played) : null;
    if (clipCheck) {
      log(`  sounds: ${clipCheck.matched} of ${clipCheck.checked} Jedi Academy clips agree with the frame counts the player rig was built with${clipCheck.differ.length ? `; ${clipCheck.differ.map((d) => `${d.clip} config ${d.config}, played ${d.played}`).join(', ')}` : ''}`);
    } else log('  sounds: no converted player to check the Jedi Academy frame counts against');

    const listed = listJka(base.base, [SABER_DIR, SABER_SOUNDS]);

    // The hilts: every `.sab` the archives hold.
    const sabers = readSabers(base, listed.filter((f) => f.endsWith('.sab')), { log });

    // What to copy: the saber folder whole (the hums, swings, blocks, spins, bounces and the
    // fizz and boil the blade makes in rain and water), plus every file the animation events
    // name outside it (the body falls, the melee swings and punches, the rolls and landings).
    const wanted = new Set(listed.filter((f) => f.startsWith(SABER_SOUNDS) && /\.(wav|mp3)$/i.test(f)));
    const namedMissing = [];
    for (const [name, { ranges }] of events.sounds) {
      const files = eventSoundFiles(base, name, ranges);
      if (!files.length) namedMissing.push(name);
      for (const f of files) wanted.add(f);
    }
    for (const hilt of Object.values(sabers)) for (const key of ['on', 'loop', 'off']) if (hilt[key]) wanted.add(hilt[key]);

    const files = {};
    let copied = 0;
    let bytes = 0;
    const dirs = new Set();
    for (const f of [...wanted].sort()) {
      let buf;
      try {
        buf = base.read(f);
      } catch {
        namedMissing.push(f);
        continue;
      }
      files[f] = buf.length;
      bytes += buf.length;
      const dest = join(soundsDir, 'jka', f);
      const dir = dirname(dest);
      if (!dirs.has(dir)) {
        mkdirSync(dir, { recursive: true });
        dirs.add(dir);
      }
      if (existsSync(dest) && statSync(dest).size === buf.length) continue;
      writeFileSync(dest, buf);
      copied++;
    }

    const json = { format: JKA_SOUND_FORMAT, archives: base.archives ?? [], configs, ...(clipCheck ? { clipCheck } : {}), sabers, voices: events.voices, files, missing: [...new Set(namedMissing)].sort() };
    mkdirSync(soundsDir, { recursive: true });
    writeFileSync(join(soundsDir, 'jka.json'), JSON.stringify(json));
    log(`  sounds: ${Object.keys(files).length} Jedi Academy sounds ${(bytes / 1048576).toFixed(1)} MB (${copied} written this run)${namedMissing.length ? `, ${new Set(namedMissing).size} named but not in the archives` : ''} -> ${join(soundsDir, 'jka')}`);
    return { clips: events.clips, voices: events.voices, sabers, files, missing: json.missing, configs, clipCheck, bytes, copied };
  } finally {
    base.close();
  }
}

/**
 * Every name under a folder across the base's archives. `openJkaBase` answers `has` and `read`
 * and keeps its zips to itself, so the listing is read straight from the pk3 files' own central
 * directories; the names are only ever used to ask the base for a file, which still gives the
 * later archive's copy where two hold the same path.
 */
export function listJka(baseDir, prefixes) {
  const out = new Set();
  const lower = prefixes.map((p) => p.toLowerCase());
  let files = [];
  try {
    files = readdirSync(baseDir).filter((f) => f.toLowerCase().endsWith('.pk3'));
  } catch {
    return [];
  }
  for (const f of files) {
    let zip;
    try {
      zip = openZip(join(baseDir, f));
    } catch {
      continue;
    }
    try {
      for (const name of zip.entries.keys()) for (const p of lower) if (name.startsWith(p) && name.length > p.length) out.add(name);
    } finally {
      zip.close();
    }
  }
  return [...out].sort();
}

/**
 * What `status` says about the Jedi Academy sounds. With no `jka.json` at all it stays quiet,
 * unless the clip events carry a Jedi Academy half, which means the sounds those marks name
 * were meant to come across and did not.
 */
export function jkaSoundStatus(dir, readJson) {
  const file = readJson(join(dir, 'sounds', 'jka.json'));
  if (!file) {
    const clipEvents = readJson(join(dir, 'sounds', 'clipEvents.json'));
    if (!clipEvents?.jka) return { line: null, need: null };
    return {
      line: '  sounds: no Jedi Academy sounds (the saber hums and the swings its clips mark have no files)',
      need: "the Jedi Academy clips are there but none of their sounds: re-run with --jka=<Jedi Academy's GameData folder>",
    };
  }
  const differ = file.clipCheck?.differ ?? [];
  const line = `  sounds: ${Object.keys(file.files ?? {}).length} Jedi Academy sounds, ${Object.keys(file.sabers ?? {}).length} hilts${differ.length ? `, ${differ.length} clips whose frame count is not the one the player rig plays (${differ.slice(0, 3).map((d) => d.clip).join(', ')})` : ''}`;
  if ((file.format ?? 0) < JKA_SOUND_FORMAT) return { line, need: 'the Jedi Academy sounds are from an older converter' };
  // A mod archive in the Jedi Academy folder overriding animation.cfg is the usual cause, and it
  // puts a footstep as much as a quarter of a walk cycle out.
  if (differ.length) return { line, need: `${differ.length} Jedi Academy clips are marked against a different frame count than the player rig plays (${differ[0].clip}: ${differ[0].config} against ${differ[0].played}): a mod archive in the Jedi Academy folder overrides animation.cfg, or the player was converted from another install` };
  return { line, need: null };
}
