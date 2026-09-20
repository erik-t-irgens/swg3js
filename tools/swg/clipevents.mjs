// When something happens inside an animation: the frames the game's own clips mark as a
// footstep, a voice, a blow landing or a body hitting the ground, and the same for Jedi
// Academy's clips, which keep their marks in a text file instead.
//
// SWG (`appearance/animation/*.ans`). A keyframe file is `FORM CKAT > 0001` (compressed) or
// `FORM KFAT > 0003`, and its version form may hold `FORM MSGS`:
//   INFO  int16: how many messages follow
//   MESG  int16 frame count, a C-string name, then that many int16 frame numbers
// It parses to the byte on all 3,308 of the 8,351 retail clips that carry one and the INFO count
// matches the MESG chunks in every file. A clip's frames are numbered 0 to frames - 1, and no
// frame number is beyond the frame count; 1,524 of them sit exactly *on* it, one past the last
// keyframe (489 survive the drop below, 288 of those footsteps), and each of those is marked
// `end: true` so a reader has a rule for it: the last instant of the clip, which is the wrap of
// a looping one. The version form's own INFO opens with the frame rate (a float) and the frame
// count (int32 in KFAT, int16 in CKAT), which is all this file reads of the animation itself:
// the keyframes are never decoded here.
//
// Jedi Academy (`models/players/_humanoid/animevents.cfg`). Two blocks, UPPEREVENTS and
// LOWEREVENTS, and one line each: the animation, the event kind, the frame, then that kind's
// own fields. The frame is counted from the animation's own first frame, not from the start of
// the shared `.gla`: read that way every one of the 519 lines falls inside its animation, and
// only three do read as absolute. The frame counts come from `animation.cfg`, which a mod
// archive dropped into the install can override -- see `jkasound.mjs`, which reads both files
// from the stock archives and checks them against the clips already converted for the player.
//
// Every event is written with its frame and with `f`, the frame over the clip's frame count. A
// reader that knows the clip's own frame rate should prefer `frame / fps` (a Jedi Academy clip's
// rate is written here beside it); `f` is for a reader holding nothing but the playing action's
// duration, and lands within one frame of the mark. A Jedi Academy clip the config plays
// backwards carries `reverse` and has both its frame and its fraction turned round with it, so
// both read as the clip plays.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { childOf, isForm, parseIff, readCString } from './iff.mjs';
import { parseSat, parseLat, parseAnimation, readIff } from './skeletal.mjs';
import { playerBodies } from './mobilescan.mjs';
import { readMobileClientData, readSpeciesClientData } from './soundsources.mjs';
import { nameLocomotion } from './clipnames.mjs';

export const CLIP_EVENTS_FORMAT = 1;

/**
 * The events the runtime is never given. `fireN` (and `fireN_M`) marks the frame a gun's clip
 * looses a shot, which the game's own combat code decides; `hpevent_*` marks a hardpoint effect
 * on a ship or a walker, which the effects already place; `cameracut_*` cuts a cinematic camera
 * and `createwpn`/`destroywpn` put a weapon in a hand and take it away again, none of which any
 * body's client data answers with a sound, so keeping them would only make a lookup miss on
 * every play. Everything else is kept as the file names it, `event_` prefix and all, since the
 * body's client data is looked up by the name with that prefix taken off and the readings of
 * the rest belong to whoever plays them.
 */
export const DROPPED_EVENT = /^(?:fire\d+(?:_\d+)?|hpevent_.+|cameracut_.+|createwpn|destroywpn)$/i;
export const isDroppedEvent = (name) => DROPPED_EVENT.test(name);

/** INVENTED: the rate to read a clip by when its own INFO writes one that is not a rate. */
export const DEFAULT_CLIP_FPS = 30;

/**
 * A keyframe file's frame rate and frame count, without decoding a single channel. Null when
 * the file is not a keyframe animation or its INFO gives no usable frame count, so a clip whose
 * timing cannot be read is left out rather than written against a made-up length.
 */
export function clipTiming(root) {
  if (!isForm(root) || (root.type !== 'CKAT' && root.type !== 'KFAT')) return null;
  const version = root.children.find(isForm);
  const info = version ? childOf(version, 'INFO') : null;
  if (!info || info.data.length < 6) return null;
  const fps = info.data.readFloatLE(0);
  const frames = root.type === 'CKAT' ? info.data.readInt16LE(4) : info.data.length >= 8 ? info.data.readInt32LE(4) : 0;
  if (!(frames > 0)) return null;
  return { fps: Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_CLIP_FPS, frames };
}

/**
 * The messages one keyframe file marks, in the order it writes them, or null when it marks
 * none. Nothing is dropped here: `readClipEvents` decides what the pack keeps.
 *
 * `declared` is the INFO count and `messages` the MESG chunks actually read, and `trailing` the
 * bytes no frame list claimed; all three are zero-difference on every retail file, and
 * `readClipEvents` counts them so a later archive set cannot be mis-read in silence.
 */
export function parseClipMessages(root) {
  if (!isForm(root)) return null;
  const version = root.children.find(isForm);
  const msgs = version ? childOf(version, 'MSGS') : null;
  if (!msgs) return null;
  const info = childOf(msgs, 'INFO');
  const declared = info && info.data.length >= 2 ? info.data.readInt16LE(0) : -1;
  const events = [];
  let messages = 0;
  let trailing = 0;
  let short = 0;
  for (const m of msgs.children ?? []) {
    if (m.tag !== 'MESG' || m.data.length < 2) continue;
    messages++;
    const count = m.data.readInt16LE(0);
    const r = readCString(m.data, 2);
    let o = r.next;
    let read = 0;
    for (; read < count && o + 2 <= m.data.length; read++, o += 2) events.push({ name: r.value, frame: m.data.readInt16LE(o) });
    if (read < count) short++;
    trailing += Math.max(0, m.data.length - o);
  }
  return { declared, messages, trailing, short, events };
}

const round = (x) => Math.round(x * 1e4) / 1e4;

/**
 * One clip's record for the pack: its timing and the events worth playing, each as the frame
 * its file writes and as a fraction of the clip. Null when the clip marks nothing; `untimed`
 * when it marks something but its own INFO gives no frame count to read the marks against, in
 * which case nothing is written for it rather than a fraction of a made-up length.
 *
 * A mark on the frame after the last keyframe (`frame === frames`, 1,524 of them across the
 * retail set) keeps its frame and gets `end: true`: it is the clip's last instant, which on a
 * looping clip is the wrap.
 */
export function clipEventEntry(root) {
  const msgs = parseClipMessages(root);
  if (!msgs || !msgs.events.length) return null;
  const timing = clipTiming(root);
  if (!timing) return { untimed: true, events: [], dropped: msgs.events.filter((e) => isDroppedEvent(e.name)).length, atEnd: 0 };
  const events = [];
  let dropped = 0;
  let atEnd = 0;
  for (const e of msgs.events) {
    if (isDroppedEvent(e.name)) {
      dropped++;
      continue;
    }
    const end = e.frame >= timing.frames;
    if (end) atEnd++;
    events.push({ name: e.name, frame: e.frame, f: round(Math.min(1, e.frame / timing.frames)), ...(end ? { end: true } : {}) });
  }
  return { frames: timing.frames, fps: round(timing.fps), events, dropped, atEnd };
}

/**
 * Every animation file that marks an event. The keys are the archive paths, which is what a
 * converted pack's clip records already carry as its source file, so nothing has to be
 * reconverted for a clip's events to be found.
 */
export function readClipEvents(vfs, { log = () => {} } = {}) {
  const files = [...new Set(vfs.list('appearance/animation/'))].filter((f) => f.endsWith('.ans')).sort();
  const clips = {};
  const names = {};
  let marked = 0;
  let events = 0;
  let dropped = 0;
  let unreadable = 0;
  let untimed = 0;
  let atEnd = 0;
  let malformed = 0;
  for (const f of files) {
    let entry = null;
    try {
      const root = parseIff(vfs.read(f));
      const msgs = parseClipMessages(root);
      // The layout checked on every file rather than the once: an INFO count that does not match
      // the MESG chunks, a frame list that stops short, or bytes no list claimed.
      if (msgs && (msgs.declared !== msgs.messages || msgs.short || msgs.trailing)) malformed++;
      entry = clipEventEntry(root);
    } catch {
      unreadable++;
      continue;
    }
    if (!entry) continue;
    marked++;
    dropped += entry.dropped;
    if (entry.untimed) {
      untimed++;
      continue;
    }
    atEnd += entry.atEnd;
    delete entry.dropped;
    delete entry.atEnd;
    if (!entry.events.length) continue;
    clips[f] = entry;
    for (const e of entry.events) {
      events++;
      names[e.name] = (names[e.name] ?? 0) + 1;
    }
  }
  log(`  sounds: ${marked} of ${files.length} animations mark an event; ${Object.keys(clips).length} clips keep ${events} of them over ${Object.keys(names).length} kinds (${dropped} shot, camera and hardpoint marks left to the code, ${atEnd} on the frame after the last keyframe)${untimed ? `, ${untimed} with no readable frame count` : ''}${malformed ? `, ${malformed} whose message block does not parse to the byte` : ''}${unreadable ? `, ${unreadable} unreadable` : ''}`);
  return { clips, names, marked, events, dropped, atEnd, untimed, malformed, unreadable, total: files.length };
}

/**
 * Which animation file each of a player species' clips plays. The species packs keep clip
 * names, not files, so the names are worked out again from the archives with the same helper
 * the packs were written with; `status` compares them with a pack's own list, so a drift shows
 * as a line rather than as silent feet.
 *
 * Every retail species shares one body table, so the clip-to-file map is written once per table
 * and each species points at its own.
 */
export function speciesClipTables(vfs, { log = () => {} } = {}) {
  const parsed = new Map();
  const loadAnimation = (e) => {
    const key = e.kind === 'file' ? e.file : e.form;
    if (parsed.has(key)) return parsed.get(key);
    let a = null;
    try {
      if (e.kind === 'inline') a = parseAnimation(e.form);
      else if (e.kind === 'file' && vfs.has(e.file)) a = parseAnimation(readIff(vfs, e.file));
    } catch {
      a = null;
    }
    parsed.set(key, a);
    return a;
  };
  const tables = {};
  const species = {};
  for (const body of playerBodies(vfs).values()) {
    let sat;
    try {
      sat = parseSat(parseIff(vfs.read(body.sat)));
    } catch {
      continue;
    }
    // The body's own table, which is the first the appearance lists; the others are the face.
    const table = [...sat.animationTables.values()][0];
    if (!table || !vfs.has(table)) continue;
    if (!tables[table]) {
      let lat;
      try {
        lat = parseLat(readIff(vfs, table));
      } catch {
        continue;
      }
      const clips = {};
      for (const e of nameLocomotion(lat.entries, loadAnimation)) {
        if (e.kind !== 'file' || clips[e.clip]) continue;
        clips[e.clip] = e.file;
      }
      tables[table] = clips;
    }
    species[body.species] = { template: body.template, sat: body.sat, table };
  }
  log(`  sounds: ${Object.keys(species).length} player species over ${Object.keys(tables).length} animation table${Object.keys(tables).length === 1 ? '' : 's'}, ${Object.values(tables).reduce((a, c) => a + Object.keys(c).length, 0)} clip names`);
  return { tables, species };
}

// -------------------------------------------------------------------------------- Jedi Academy

const JKA_BLOCK = /^(UPPER|LOWER|BOTH)EVENTS$/i;

/**
 * `animevents.cfg` as rows. Comments (`//`) are stripped, the block headers choose `upper` or
 * `lower`, and the braces are skipped; a line's fields are left as written, so each kind's
 * reader takes what it wants.
 */
export function parseAnimEvents(text) {
  const rows = [];
  let half = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const block = JKA_BLOCK.exec(line);
    if (block) {
      half = block[1].toLowerCase() === 'upper' ? 'upper' : block[1].toLowerCase() === 'lower' ? 'lower' : 'both';
      continue;
    }
    if (line === '{' || line === '}') continue;
    const p = line.split(/\s+/);
    if (p.length < 3 || !half) continue;
    const frame = Number(p[2]);
    if (!Number.isFinite(frame)) continue;
    rows.push({ half, anim: p[0].toUpperCase(), type: p[1].toUpperCase(), frame, fields: p.slice(3) });
  }
  return rows;
}

/**
 * A sound path as the event lines write it. Three shapes:
 *   plain            sound/player/land1.wav
 *   a numbered set   sound/weapons/saber/saberhup%d.wav  with a low and a high index
 *   the model's own  *pain25.mp3, *death%d.wav -- the character's voice set, not a file
 * The extension written is not always the one in the archives (both ways round: `saberhup%d.wav`
 * is nine .mp3 files and `saber_catch.mp3` is a .wav), so the name is kept as written and the
 * search for the file tries the other extension too.
 */
export function soundEventOf(row) {
  const off = row.type === 'AEV_SOUNDCHAN' ? 1 : 0;
  const path = row.fields[off];
  if (!path) return null;
  const lo = Number(row.fields[off + 1]);
  const hi = Number(row.fields[off + 2]);
  const chance = Number(row.fields[off + 3] ?? row.fields[row.fields.length - 1]);
  const range = Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo && path.includes('%d') ? [lo, hi] : null;
  const out = { chance: Number.isFinite(chance) ? chance : 0 };
  if (path.startsWith('*')) {
    // The model's own voice set: the name without the star and without the extension.
    out.type = 'voice';
    out.voice = path.slice(1).replace(/\.(wav|mp3)$/i, '');
  } else {
    out.type = 'sound';
    out.sound = path.replace(/\\/g, '/');
  }
  if (range) out.range = range;
  return out;
}

/** `footstep_l`, `footstep_r`, `footstep_heavy_l`, `footstep_heavy_r` as a foot and a weight. */
export function footEventOf(row) {
  const kind = String(row.fields[0] ?? '').toLowerCase();
  const chance = Number(row.fields[1]);
  return { type: 'footstep', foot: kind.endsWith('_l') ? 'l' : 'r', heavy: kind.includes('heavy'), chance: Number.isFinite(chance) ? chance : 0 };
}

/**
 * Jedi Academy's clips as the runtime wants them: per animation its frame count, rate and loop
 * frame from `animation.cfg`, and its events under `upper` and `lower` as the two blocks put
 * them. A clip the game plays backwards (a negative frame count) has its marks turned round
 * with it, frame and fraction alike, so both read as the clip plays and cannot disagree.
 *
 * `sounds` collects every index range each sound name is drawn from, not the last one: one name
 * may appear on several lines with different ranges (the saber whooshes are written in threes),
 * and keeping one range would leave the rest of the set uncopied.
 */
export function jkaClipEvents(text, cfg, { log = () => {} } = {}) {
  const rows = parseAnimEvents(text);
  const clips = {};
  const sounds = new Map();
  const voices = new Map();
  let unknown = 0;
  let outside = 0;
  for (const row of rows) {
    const anim = cfg.get(row.anim);
    if (!anim) {
      unknown++;
      continue;
    }
    let event = null;
    if (row.type === 'AEV_SOUND' || row.type === 'AEV_SOUNDCHAN') event = soundEventOf(row);
    else if (row.type === 'AEV_FOOTSTEP') event = footEventOf(row);
    else if (row.type === 'AEV_EFFECT') event = { type: 'effect', effect: row.fields[0], bolt: row.fields[1], chance: Number(row.fields[2]) || 0 };
    if (!event) continue;
    // A frame past the clip's own length is a slip in the file: Jedi Academy never reaches it
    // either, so it is counted and left out rather than clamped onto the last frame.
    if (row.frame < 0 || row.frame >= anim.count) {
      outside++;
      continue;
    }
    const frame = anim.reverse ? anim.count - 1 - row.frame : row.frame;
    const entry = (clips[row.anim] ??= { frames: anim.count, fps: anim.fps, loop: anim.loop, ...(anim.reverse ? { reverse: true } : {}), upper: [], lower: [] });
    entry[row.half === 'lower' ? 'lower' : 'upper'].push({ ...event, frame, f: round(frame / anim.count) });
    if (event.type === 'sound') {
      const set = sounds.get(event.sound) ?? { ranges: [] };
      if (event.range && !set.ranges.some(([lo, hi]) => lo === event.range[0] && hi === event.range[1])) set.ranges.push(event.range);
      sounds.set(event.sound, set);
    }
    if (event.type === 'voice') voices.set(event.voice, (voices.get(event.voice) ?? 0) + 1);
  }
  for (const entry of Object.values(clips)) {
    for (const half of ['upper', 'lower']) {
      if (!entry[half].length) delete entry[half];
      else entry[half].sort((a, b) => a.f - b.f);
    }
  }
  log(`  sounds: Jedi Academy marks ${rows.length} events over ${Object.keys(clips).length} animations (${sounds.size} sound names, ${voices.size} voice sets${unknown ? `, ${unknown} on animations the config does not list` : ''}${outside ? `, ${outside} past their clip's last frame` : ''})`);
  return { clips, sounds, voices: [...voices.keys()].sort(), rows: rows.length, unknown, outside };
}

/** What `status` says about the clip events, and what to run when they are missing or old. */
export function clipEventStatus(dir, readJson, { packs = null } = {}) {
  const file = readJson(join(dir, 'sounds', 'clipEvents.json'));
  if (!file) return { line: '  sounds: no clip events (nothing knows when a foot lands)', need: 'no clip events: no footsteps, creature voices or saber swings' };
  const clips = Object.keys(file.clips ?? {}).length;
  const species = Object.keys(file.species?.species ?? {}).length;
  const jkaClips = Object.keys(file.jka?.clips ?? {}).length;
  // How many animations mark nothing at all is worth saying: a clip with no events is silent
  // by the game's own data, not by a hole in the conversion. An animation that marks only shots,
  // camera cuts or hardpoint effects is silent here too, but for the other reason, so the two
  // are counted apart.
  const c = file.counts ?? {};
  const quiet = (c.animations ?? 0) - (c.marked ?? c.kept ?? clips);
  const onlyShots = (c.marked ?? 0) - (c.kept ?? clips);
  const parts = [
    `${clips} clips with events${c.events ? ` (${c.events} events)` : ''}`,
    quiet > 0 ? `${quiet} animations mark none` : null,
    onlyShots > 0 ? `${onlyShots} only shots` : null,
    `${species} species`,
    `${Object.keys(file.mobiles ?? {}).length} mobile templates joined`,
    jkaClips ? `${jkaClips} Jedi Academy clips` : 'NO JEDI ACADEMY EVENTS',
  ].filter(Boolean);
  // A species pack whose clip names no longer match what the archives make of the same table
  // would take its feet down with it, so the two lists are compared here rather than by ear.
  const drift = [];
  for (const [id, entry] of Object.entries(file.species?.species ?? {})) {
    const pack = packs ? packs(id) : null;
    if (!pack || !Array.isArray(pack.clips)) continue;
    const known = file.species.tables?.[entry.table] ?? {};
    // A pack lists Jedi Academy's clips apart, under `jkaClips`, so none of them is in `clips`
    // today; the guard is here so a pack that ever merged the two lists would not read as drift.
    const missing = pack.clips.filter((c) => !(c in known) && !/^BOTH_/i.test(c));
    if (missing.length) drift.push(`${id}: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}`);
  }
  const line = `  sounds: ${parts.join(', ')}${drift.length ? `, ${drift.length} species whose pack clips are not in the table` : ''}`;
  if ((file.format ?? 0) < CLIP_EVENTS_FORMAT) return { line, need: 'the clip events are from an older converter' };
  if (drift.length) return { line, need: `a species pack's clips no longer match the archives (${drift[0]}): reconvert that species, then the sounds` };
  if (!jkaClips) return { line, need: "the clip events have no Jedi Academy half (no saber swings or body falls): add --jka=<Jedi Academy's GameData folder>" };
  return { line, need: null };
}

/**
 * The `sounds` command's clip-event half: every animation's marks, the species' clip-to-file
 * map, and, when the Jedi Academy half has already run, its clips beside them. It writes
 * `sounds/clipEvents.json`; a run that leaves Jedi Academy out keeps whatever an earlier run
 * with it wrote, so the two halves need not be converted together.
 */
export function convertClipEvents(vfs, outDir, { jka = null, log = () => {} } = {}) {
  const file = join(outDir, 'sounds', 'clipEvents.json');
  const swg = readClipEvents(vfs, { log });
  const species = speciesClipTables(vfs, { log });
  // Which client data each body reads its events out of. Only the files the bank holds are
  // written, which the events the earlier half of the command wrote already list; without that
  // file (a clip-events run on its own) every file that exists is kept.
  let held = null;
  try {
    held = JSON.parse(readFileSync(join(outDir, 'sounds', 'events.json'), 'utf8')).clientData ?? null;
  } catch {
    held = null;
  }
  const mobiles = readMobileClientData(vfs, { keep: held ? (f) => f in held : null, log });
  const bySpecies = readSpeciesClientData(vfs, { log });
  for (const [id, entry] of Object.entries(bySpecies)) {
    if (species.species[id]) species.species[id].clientData = entry.clientData;
    else species.species[id] = { template: entry.template, clientData: entry.clientData };
  }
  let carried = null;
  if (!jka && existsSync(file)) {
    try {
      carried = JSON.parse(readFileSync(file, 'utf8')).jka ?? null;
    } catch {
      carried = null;
    }
    if (carried) log(`  sounds: keeping the ${Object.keys(carried.clips ?? {}).length} Jedi Academy clips an earlier run wrote (no --jka this time)`);
  }
  const jkaPart = jka ? { clips: jka.clips, voices: jka.voices } : carried;
  const counts = { animations: swg.total, marked: swg.marked, kept: Object.keys(swg.clips).length, events: swg.events, dropped: swg.dropped, atEnd: swg.atEnd, untimed: swg.untimed, malformed: swg.malformed, unreadable: swg.unreadable };
  const out = { format: CLIP_EVENTS_FORMAT, counts, clips: swg.clips, names: swg.names, species, mobiles, ...(jkaPart ? { jka: jkaPart } : {}) };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out));
  log(`  sounds: clipEvents.json ${(statSync(file).size / 1024).toFixed(0)} KB -> ${file}`);
  return { file, json: out, swg, species, mobiles, bySpecies };
}
