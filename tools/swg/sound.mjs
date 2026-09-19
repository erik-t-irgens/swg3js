// Sound templates (.snd), the samples they name, and the bank the game loads.
//
// A template is `FORM SD2D > 0003` (a sound with no place in the world) or
// `FORM SD3D > [FORM SD2D > 0003] + 0001` (one that has a place; the 0001 chunk is
// always empty, so everything lives in the shared chunk). The retail archives hold
// 7,171 templates: 3,115 whose first root form is SD2D and 4,056 SD3D, of which 528
// (all SD2D, all voice-over or tutorial lines) are followed by a stray empty 0001
// chunk at the top level, which parseIff refuses ("expected one root FORM, got 2").
// So the reader takes the first root form and ignores what follows it.
//
// The 0003 chunk is an int32 sample count, that many C-string sample paths, then
// exactly 28 four-byte fields (112 bytes) in every one of the 7,171 files. The
// meanings below are read off how the values vary by name prefix and by category;
// the ones that are certain from the data are marked, the rest are readings and are
// written through to the pack unchanged so the game can change its mind in one place.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { find, parseIff, readCString } from './iff.mjs';
import { readClientData, readClientEffects, readSceneSounds, readSoundTables, soundsOfClientData } from './soundsources.mjs';

/** Bumped whenever the pack's shape changes, so `status` can ask for a rerun. */
export const SOUND_FORMAT = 1;

/**
 * Field 10. The numbers are the client's; the names are ours, read from which
 * prefixes fall in which category (amb 0, exp 1, item 2 and 10, fs 3, ui 4, veh and
 * eng 5, cr 6, wep and cbt 7, music 8, every player_music template 9, vo 13).
 */
export const CATEGORIES = {
  0: 'ambient',
  1: 'explosion',
  2: 'item',
  3: 'movement',
  4: 'interface',
  5: 'vehicle',
  6: 'vocalization',
  7: 'weapon',
  8: 'music',
  9: 'playerMusic',
  10: 'machine',
  11: 'unused',
  12: 'musicSting',
  13: 'voiceOver',
};

/** Background music (8) and the instrument parts (9) are not ported: they are the two largest sets and nothing plays them. */
export const MUSIC_CATEGORIES = new Set([8, 9]);

// Invented numbers. Nothing in the archives fixes either; both are this converter's own,
// and a converter has no live knob, so they are named here rather than buried in the code.
/** Invented: the most samples one template may name before the file is taken to be something else. */
const MAX_SAMPLES = 4096;
/**
 * Invented: how many frames short of the end a sampler chunk's loop may stop and still count as
 * "loops the whole file". Two frames of slack covers the WAVs whose loop end is written one frame
 * short; anything further in is kept as real loop points.
 */
const LOOP_WHOLE_SLACK = 2;

const slash = (s) => s.replace(/\\/g, '/');

/** Every top-level node of an IFF file as a byte range, so a file with two roots can be read. */
export function iffRoots(buf) {
  const out = [];
  let o = 0;
  while (o + 8 <= buf.length) {
    const tag = buf.toString('latin1', o, o + 4);
    const size = buf.readUInt32BE(o + 4);
    out.push({ tag, type: tag === 'FORM' ? buf.toString('latin1', o + 8, o + 12) : null, start: o, end: Math.min(o + 8 + size, buf.length) });
    o += 8 + size;
  }
  return out;
}

const f32 = (buf, o) => buf.readFloatLE(o);
const i32 = (buf, o) => buf.readInt32LE(o);

/**
 * One sound template. `dim` is 3 when the sound has a place in the world.
 * Certain from the data: delay, fadeIn, loops, gap, fadeOut, category, volume, pitch,
 * priority and full. Readings: order, gapMode, fadeModes and the two variation modes
 * (their values and where they occur are certain; what the client did with them is not
 * in the archives). Field 12 is 0 in every file and is not written.
 */
export function parseSoundTemplate(buf) {
  const roots = iffRoots(buf);
  if (!roots.length || roots[0].tag !== 'FORM') throw new Error('not a sound template');
  const type = roots[0].type;
  if (type !== 'SD2D' && type !== 'SD3D') throw new Error(`not a sound template: ${type}`);
  const root = parseIff(buf.subarray(roots[0].start, roots[0].end));
  const chunk = find(root, '0003');
  if (!chunk) throw new Error('sound template has no 0003 chunk');
  const d = chunk.data;
  const count = i32(d, 0);
  if (count < 0 || count > MAX_SAMPLES) throw new Error(`sound template names ${count} samples`);
  const samples = [];
  let o = 4;
  for (let i = 0; i < count; i++) {
    const r = readCString(d, o);
    samples.push(slash(r.value));
    o = r.next;
  }
  if (d.length - o < 112) throw new Error(`sound template has ${d.length - o} bytes of settings, expected 112`);
  const at = o;
  const v = (i) => at + i * 4;
  return {
    dim: type === 'SD3D' ? 3 : 2,
    samples,
    delay: [f32(d, v(0)), f32(d, v(1))],
    fadeIn: [f32(d, v(2)), f32(d, v(3))],
    loops: [i32(d, v(4)), i32(d, v(5))],
    gap: [f32(d, v(6)), f32(d, v(7))],
    fadeOut: [f32(d, v(8)), f32(d, v(9))],
    category: i32(d, v(10)),
    // 0 random, 1 random without repeating (a reading), 2 in the order written.
    order: i32(d, v(11)),
    // 2 on the random one-shot beds: the gap is drawn again for each loop (a reading).
    gapMode: i32(d, v(13)),
    fadeModes: [i32(d, v(14)), i32(d, v(15))],
    // mode: 0 none, 1 drawn once, 2 drawn for each play, 3 drifting over `period` seconds (a reading).
    volume: { mode: i32(d, v(16)), range: [f32(d, v(18)), f32(d, v(19))], period: f32(d, v(17)), glide: f32(d, v(20)) },
    // The pitch range is in semitones: footsteps a semitone either way, creatures two.
    pitch: { mode: i32(d, v(21)), range: [f32(d, v(23)), f32(d, v(24))], period: f32(d, v(22)), glide: f32(d, v(25)) },
    // 0 is highest: interface 0, music 1, ambience 2, weapons 3, vehicles 4, creatures 5, footsteps 6, items 7 and 8.
    priority: i32(d, v(26)),
    // Metres within which the sound plays at full volume. How it falls off beyond that is the client's and is not in the archives.
    full: f32(d, v(27)),
  };
}

/**
 * A RIFF WAV's `fmt `, `data` and `smpl` chunks. Every WAV in the archives is 16-bit
 * PCM; the loop chunk's fields are the RIFF sampler chunk's (nine uint32, then 24 bytes
 * per loop of which the third and fourth words are the first and last frame).
 */
export function readWav(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') {
    // A file the archives hold as zeros cannot be used; the caller marks its templates silent.
    const empty = buf.length >= 4 && buf.readUInt32LE(0) === 0;
    return { ok: false, why: empty ? 'zero-filled' : 'not a RIFF WAV' };
  }
  const out = { ok: true, format: 0, channels: 0, rate: 0, bits: 0, dataOffset: 0, dataLength: 0, loop: null };
  let o = 12;
  while (o + 8 <= buf.length) {
    const id = buf.toString('latin1', o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    const body = o + 8;
    if (id === 'fmt ' && size >= 16) {
      out.format = buf.readUInt16LE(body);
      out.channels = buf.readUInt16LE(body + 2);
      out.rate = buf.readUInt32LE(body + 4);
      out.bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      out.dataOffset = body;
      out.dataLength = Math.min(size, buf.length - body);
    } else if (id === 'smpl' && size >= 36 + 24) {
      const loops = buf.readUInt32LE(body + 28);
      if (loops > 0) out.loop = { start: buf.readUInt32LE(body + 36 + 8), end: buf.readUInt32LE(body + 36 + 12) };
    }
    o = body + size + (size & 1);
  }
  const bytesPerFrame = Math.max(1, (out.channels * out.bits) / 8);
  out.frames = Math.floor(out.dataLength / bytesPerFrame);
  out.seconds = out.rate ? out.frames / out.rate : 0;
  if (!out.rate || !out.frames) return { ok: false, why: 'no audio in the file' };
  return out;
}

// MPEG audio frame header tables, for the MP3 samples (the music the world places and the
// Kashyyyk beds). Layer III only, which is every MP3 in the archives.
const MP3_RATES = [[11025, 12000, 8000], [null, null, null], [22050, 24000, 16000], [44100, 48000, 32000]];
const MP3_BITRATES = {
  // MPEG 1 Layer III, then MPEG 2 and 2.5 Layer III, in kbit/s by the header's four-bit index.
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};

/**
 * An MP3's first frame header, and the Xing/Info frame count when the encoder wrote one.
 * The runtime budgets memory and resumes virtual loops by a sample's length, so a sample
 * with no length at all reads as zero seconds; every MP3 gets a real one here, marked
 * `estimated` when it came from the bit rate rather than from a frame count.
 */
export function readMp3(buf) {
  let o = 0;
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    // ID3v2: a syncsafe 28-bit size, and a footer of its own when bit 4 of the flags is set.
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    o = 10 + size + (buf[5] & 0x10 ? 10 : 0);
  }
  for (; o + 4 <= buf.length; o++) {
    if (buf[o] !== 0xff || (buf[o + 1] & 0xe0) !== 0xe0) continue;
    const verBits = (buf[o + 1] >> 3) & 3;
    const layer = (buf[o + 1] >> 1) & 3;
    if (verBits === 1 || layer !== 1) continue; // reserved version, or not layer III
    const rate = MP3_RATES[verBits][(buf[o + 2] >> 2) & 3];
    const bitrate = MP3_BITRATES[verBits === 3 ? 1 : 2][(buf[o + 2] >> 4) & 15];
    if (!rate || !bitrate) continue;
    const channels = ((buf[o + 3] >> 6) & 3) === 3 ? 1 : 2;
    const perFrame = verBits === 3 ? 1152 : 576;
    // The Xing/Info tag sits in the first frame's side-information gap, which is fixed per version.
    const tagAt = o + 4 + (verBits === 3 ? (channels === 1 ? 17 : 32) : channels === 1 ? 9 : 17);
    let frames = 0;
    if (tagAt + 12 <= buf.length) {
      const tag = buf.toString('latin1', tagAt, tagAt + 4);
      if ((tag === 'Xing' || tag === 'Info') && buf.readUInt32BE(tagAt + 4) & 1) frames = buf.readUInt32BE(tagAt + 8);
    }
    const seconds = frames ? (frames * perFrame) / rate : ((buf.length - o) * 8) / (bitrate * 1000);
    return { ok: true, rate, channels, seconds, bitrate, estimated: !frames };
  }
  return { ok: false, why: 'no MPEG audio frame' };
}

/**
 * The archive path of a sample a template names. Twenty-seven templates name their sample
 * by the absolute path it had on the machine that built it
 * (`d:/swg/ep3/.../built/game/sample/amb_kashyyyk_droid_cave.wav`), the same shape the
 * flip-book shaders use; the file itself is under `sample/`, `voice/sample/` or `music/`,
 * so the tails from those folders are tried, the deepest first, when the path as written is
 * not there. Twenty-two of the twenty-seven are found that way, among them three of
 * Kashyyyk's ambience beds. The path as written is returned when nothing is found, so it
 * shows up in `missing` rather than disappearing.
 */
export function resolveSample(vfs, name) {
  const p = slash(name).replace(/^\//, '');
  if (vfs.has(p)) return p;
  // Every place such a folder starts. The scan steps one character past each hit rather than
  // past the whole match, so `voice/sample/x.wav` offers both itself and its `sample/` tail.
  const starts = [];
  const re = /(?:^|\/)((?:voice\/)?(?:sample|music)\/)/g;
  for (let m = re.exec(p); m; m = re.exec(p)) {
    starts.push(m.index + m[0].length - m[1].length);
    re.lastIndex = m.index + 1;
  }
  for (let i = starts.length - 1; i >= 0; i--) {
    const tail = p.slice(starts[i]);
    if (vfs.has(tail)) return tail;
  }
  return p;
}

/** What the runtime needs to know about one sample file, for its memory budget. */
function describeSample(path, buf) {
  const entry = { bytes: buf.length };
  if (/\.wav$/i.test(path)) {
    const wav = readWav(buf);
    if (!wav.ok) return { ...entry, unreadable: wav.why };
    entry.rate = wav.rate;
    entry.channels = wav.channels;
    entry.seconds = Math.round(wav.seconds * 1000) / 1000;
    // Only the files that loop part of themselves need their points kept; the rest loop whole.
    if (wav.loop && (wav.loop.start > 0 || wav.loop.end < wav.frames - LOOP_WHOLE_SLACK)) entry.loop = [wav.loop.start, wav.loop.end];
    return entry;
  }
  if (/\.mp3$/i.test(path)) {
    const mp3 = readMp3(buf);
    if (!mp3.ok) return { ...entry, format: 'mp3', unreadable: mp3.why };
    entry.format = 'mp3';
    entry.rate = mp3.rate;
    entry.channels = mp3.channels;
    entry.seconds = Math.round(mp3.seconds * 1000) / 1000;
    // From the bit rate rather than a frame count: right for a constant bit rate, near enough
    // for a budget either way, and said so rather than passed off as measured.
    if (mp3.estimated) entry.estimated = true;
    return entry;
  }
  return entry;
}

const round = (x, n = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : 0);
const pair = (p) => [round(p[0]), round(p[1])];

/** A template as the pack writes it: the fields above, rounded, with the parts that are all zero left out. */
export function templateEntry(t) {
  const e = { dim: t.dim, samples: t.samples, category: t.category, priority: t.priority, full: round(t.full) };
  if (t.delay[0] || t.delay[1]) e.delay = pair(t.delay);
  if (t.fadeIn[0] || t.fadeIn[1]) e.fadeIn = pair(t.fadeIn);
  if (t.fadeOut[0] || t.fadeOut[1]) e.fadeOut = pair(t.fadeOut);
  if (t.loops[0] !== 1 || t.loops[1] !== 1) e.loops = [t.loops[0], t.loops[1]];
  if (t.gap[0] || t.gap[1]) e.gap = pair(t.gap);
  if (t.order) e.order = t.order;
  if (t.gapMode) e.gapMode = t.gapMode;
  if (t.fadeModes[0] || t.fadeModes[1]) e.fadeModes = t.fadeModes;
  if (t.volume.mode || t.volume.range[0] !== 1 || t.volume.range[1] !== 1) e.volume = { mode: t.volume.mode, range: pair(t.volume.range), ...(t.volume.period ? { period: round(t.volume.period), glide: round(t.volume.glide) } : {}) };
  if (t.pitch.mode || t.pitch.range[0] || t.pitch.range[1]) e.pitch = { mode: t.pitch.mode, range: pair(t.pitch.range), ...(t.pitch.period ? { period: round(t.pitch.period), glide: round(t.pitch.glide) } : {}) };
  return e;
}

/**
 * Every sound a pack already converted under `<out-dir>` names, and which file names it:
 * a planet's environment rows (`sky.json`), the bolts (`projectiles.json`), the wing forms
 * and the sabers (a pack's `manifest.json`), a system's jump (`space.json`). They are read
 * as text, because a sound path is a sound path wherever in the JSON it sits, and a pack
 * whose shape changes later still gets scanned. An out-dir that holds no packs yields
 * nothing and costs nothing.
 */
export function packSoundNames(outDir) {
  const out = new Map();
  let packs;
  try {
    packs = readdirSync(outDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const pack of packs) {
    if (!pack.isDirectory() || pack.name === 'sounds') continue;
    let files;
    try {
      files = readdirSync(join(outDir, pack.name));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      let text;
      try {
        text = readFileSync(join(outDir, pack.name, f), 'utf8');
      } catch {
        continue;
      }
      for (const s of text.match(/(?:sound|voice|music|player_music)\/[\w./-]+\.snd/gi) ?? []) {
        const p = s.toLowerCase();
        if (!out.has(p)) out.set(p, `${pack.name}/${f}`);
      }
    }
  }
  return out;
}

function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  return statSync(file).size;
}

/**
 * The `sounds` command: every sound template the game may play, the samples they name,
 * the client data that says which sound belongs to which event, and the tables that
 * place sounds in rooms, on doors, on melee weapons, on a ship's power and its flyby.
 *
 * `only` narrows the run to templates whose path holds that text (a quick check;
 * `samples: false` writes the JSON without copying any audio). Either one writes a narrowed
 * `sounds.json` over whatever was there, which `status` then asks to have run again in full.
 */
export function convertSounds(vfs, outDir, { only = null, samples: copySamples = true, log = () => {} } = {}) {
  const soundsDir = join(outDir, 'sounds');

  const sources = readSoundTables(vfs, { log });
  const clientData = readClientData(vfs, { log });
  // Five creature voices are written without their extension (`sound/cr_dappled_gualama_attack_hvy`);
  // every one of them is in the archives as that name plus `.snd`, so the extension is put back here,
  // where the archives are in hand. Without it those creatures are mute and nothing says why.
  let repaired = 0;
  for (const entry of Object.values(clientData)) {
    for (const [name, value] of Object.entries(entry.events ?? {})) {
      if (!value || /\.[a-z0-9]{2,4}$/i.test(value) || !vfs.has(`${value}.snd`)) continue;
      entry.events[name] = `${value}.snd`;
      repaired++;
    }
  }
  if (repaired) log(`  sounds: ${repaired} event sounds written without their extension, put back`);
  // Every client effect, not only the ones the first readers reach: the file is small and
  // a later feature that needs one (a gun's miss, a door) then needs no reconversion.
  const clientEffects = readClientEffects(vfs, null, { log });
  const scenes = readSceneSounds(vfs, { log });
  // Music the game places in the world (the cantina bands, the organs, an event's theme) is a
  // thing in a room that fades with distance, so it is ported although its category is music:
  // a sound object's own looping sound (ASND) is what says so.
  const placedMusic = new Set();
  for (const entry of Object.values(clientData)) if (entry.ambient) placedMusic.add(entry.ambient);
  // The jump's three stage sounds are category 8 and are not music: they are the ship's own
  // noise, named by `scene/hyperspace.iff` the same way the jump's timings are. Any scene but
  // the music manager's (which holds the combat score and nothing else) is taken the same way.
  const sceneMusic = new Set();
  for (const [file, names] of Object.entries(scenes)) {
    if (/game_music_manager/.test(file)) continue;
    for (const n of names) if (n.endsWith('.snd')) sceneMusic.add(n);
  }

  const templatePaths = [...new Set(vfs.list('.snd'))].filter((p) => p.endsWith('.snd')).sort();
  const templates = {};
  const counts = {};
  const failed = [];
  let ported = 0;
  let leftOut = 0;
  let placed = 0;
  let fromScene = 0;
  const musicLeftOut = new Set();
  const wanted = new Set();
  for (const path of templatePaths) {
    let t;
    try {
      t = parseSoundTemplate(vfs.read(path));
    } catch (err) {
      failed.push({ template: path, why: err.message });
      continue;
    }
    counts[t.category] = (counts[t.category] ?? 0) + 1;
    const music = MUSIC_CATEGORIES.has(t.category);
    // Only music is ever rescued: everything else is ported anyway, and a bed that happens to be
    // some object's own looping sound must not be marked as the music the world places.
    const kept = !music ? null : placedMusic.has(path) ? 'placed' : sceneMusic.has(path) ? 'scene' : null;
    if (music && !kept) {
      leftOut++;
      musicLeftOut.add(path);
      continue;
    }
    if (only && !path.includes(only)) continue;
    const entry = templateEntry(t);
    entry.samples = t.samples.map((s) => resolveSample(vfs, s));
    if (kept === 'placed') {
      entry.placedMusic = true;
      placed++;
    } else if (kept === 'scene') {
      // Not on the Ambience slider: the runtime plays these where the scene plays them.
      entry.keptMusic = 'scene';
      fromScene++;
    }
    templates[path] = entry;
    ported++;
    for (const s of entry.samples) wanted.add(s);
  }

  // The samples: copied as they are, into the pack under their archive path. A copy that
  // is already there at the same size is left alone, so a second run costs nothing.
  const sampleInfo = {};
  const missing = [];
  const unreadable = [];
  let copied = 0;
  let bytes = 0;
  const dirs = new Set();
  for (const s of [...wanted].sort()) {
    if (!vfs.has(s)) {
      missing.push(s);
      continue;
    }
    const buf = vfs.read(s);
    const info = describeSample(s, buf);
    sampleInfo[s] = info;
    bytes += buf.length;
    if (info.unreadable) {
      unreadable.push({ sample: s, why: info.unreadable });
      continue;
    }
    if (!copySamples) continue;
    const dest = join(soundsDir, 'samples', s);
    const dir = dirname(dest);
    if (!dirs.has(dir)) {
      mkdirSync(dir, { recursive: true });
      dirs.add(dir);
    }
    if (existsSync(dest) && statSync(dest).size === buf.length) continue;
    writeFileSync(dest, buf);
    copied++;
  }
  // A template whose every sample is missing or unusable is kept and marked, so a lookup never throws.
  let silent = 0;
  for (const [path, e] of Object.entries(templates)) {
    if (e.samples.some((s) => sampleInfo[s] && !sampleInfo[s].unreadable)) continue;
    e.silent = true;
    silent++;
  }

  // Some of the names the game writes differ from the file only in where the underscores fall:
  // one planet's environment rows ask for `amb_kashyyk_ryratt_trail_lvl01` where the archives
  // hold `..._lvl_01`, and another's for `amb_dathomir_outpost2_lp` against `..._outpost_2_lp`.
  // A name with the punctuation taken out that matches exactly one template is that template;
  // where two would match, nothing is claimed and the name is reported as a hole instead.
  const byLetters = new Map();
  const letters = (p) => p.replace(/[_\-\s]/g, '');
  for (const p of Object.keys(templates)) {
    const k = letters(p);
    byLetters.set(k, byLetters.has(k) ? null : p);
  }
  const aliases = {};
  const alias = (p) => {
    if (aliases[p]) return aliases[p];
    const hit = byLetters.get(letters(p));
    if (hit) aliases[p] = hit;
    return hit ?? null;
  };
  log(`  sounds: ${ported} templates ported (${placed} of them music the world places, ${fromScene} music a scene plays; ${leftOut} music and player-music left out${failed.length ? `, ${failed.length} unreadable` : ''}), ${Object.keys(sampleInfo).length} samples ${(bytes / 1048576).toFixed(1)} MB${copySamples ? ` (${copied} written this run)` : ' (not written)'}${missing.length ? `, ${missing.length} named but not in the archives` : ''}${silent ? `, ${silent} templates silent` : ''}`);
  if (only || !copySamples) log('  sounds: this is a narrowed run; sounds.json now holds only what it asked for, so run the command without --only and --no-samples before playing');

  const sourcesSize = writeJson(join(soundsDir, 'sources.json'), { format: SOUND_FORMAT, ...sources });

  // Where a named sound ends up. `dangling` is a name with no file in the archives at all,
  // which the game has to fall back for; `leftOutButNamed` is a file that is there and was
  // left out as music although something names it, which is a rule to check rather than a
  // surprise. Both are worth printing rather than discovering later as silence.
  const dangling = new Set();
  const leftOutButNamed = new Set();
  const check = (p) => {
    if (!p || !p.endsWith('.snd') || templates[p] || only) return;
    if (alias(p)) return;
    (musicLeftOut.has(p) || vfs.has(p) ? leftOutButNamed : dangling).add(p);
  };
  for (const entry of Object.values(clientData)) for (const p of soundsOfClientData(entry)) check(p);
  for (const e of Object.values(clientEffects)) for (const p of e.sounds ?? []) check(p);
  for (const names of Object.values(scenes)) for (const p of names) check(p);
  for (const r of sources.rooms) for (const p of [r.day, r.night, r.music]) check(p);
  for (const p of Object.values(sources.interface)) check(p);
  for (const r of sources.melee) for (const p of [r.attack, r.hit]) check(p);
  for (const r of sources.ranged) for (const p of [r.muzzle, r.hit, r.nothing, r.ricochet]) check(p);
  for (const g of Object.values(sources.shipPower)) for (const p of Object.values(g)) check(p);
  for (const g of Object.values(sources.shipHits)) for (const p of Object.values(g)) check(p);
  for (const p of Object.values(sources.flyby)) check(p);
  // The names the packs already converted carry (a planet's environment rows, the bolts, the
  // wing forms, a saber's idle, a system's jump): the game will ask for these, and a hole in
  // one of them is silence in the world with nothing to point at. They are JSON under the same
  // out-dir, so no archive is read for this and a missing pack simply contributes nothing.
  const fromPacks = new Map();
  let packScore = 0;
  for (const [p, where] of packSoundNames(outDir)) {
    check(p);
    if (templates[p] || aliases[p] || only) continue;
    // A planet's environment rows name their region's score as well as their beds; that the
    // bank has no score in it is the rule, not a hole, so those are counted rather than listed.
    if (musicLeftOut.has(p)) packScore++;
    else fromPacks.set(p, where);
  }
  const aliasCount = Object.keys(aliases).length;
  if (aliasCount) {
    log(`  sounds: ${aliasCount} names the game writes differ from the file only in their punctuation, and are written as aliases:`);
    for (const [asked, real] of Object.entries(aliases).sort()) log(`    ${asked} -> ${real}`);
  }
  if (dangling.size) log(`  sounds: ${dangling.size} named sounds have no template in the archives`);
  if (leftOutButNamed.size) log(`  sounds: ${leftOutButNamed.size} more are in the archives but not in the bank (left out as music, or unreadable)`);
  if (fromPacks.size || packScore) {
    log(`  sounds: ${fromPacks.size} sounds the converted packs name are not in the bank${packScore ? ` (and ${packScore} more that are the background score)` : ''}${fromPacks.size ? ':' : ''}`);
    for (const [p, where] of [...fromPacks].sort()) log(`    ${p}  (${where})`);
  }

  const eventsSize = writeJson(join(soundsDir, 'events.json'), {
    format: SOUND_FORMAT,
    clientData,
    clientEffects,
    scenes,
    dangling: [...dangling].sort(),
    leftOutButNamed: [...leftOutButNamed].sort(),
    packGaps: Object.fromEntries([...fromPacks].sort()),
  });

  // Written last, because the aliases are only known once everything that asks for a sound has
  // been read. The runtime loads this one file for a lookup, so the aliases belong in it.
  const soundsSize = writeJson(join(soundsDir, 'sounds.json'), {
    format: SOUND_FORMAT,
    categories: CATEGORIES,
    counts,
    templates,
    aliases,
    samples: sampleInfo,
    missing,
    unreadable,
    failed,
    ...(only ? { only } : {}),
    ...(copySamples ? {} : { samplesWritten: false }),
  });

  log(`  sounds: sounds.json ${(soundsSize / 1048576).toFixed(2)} MB, sources.json ${(sourcesSize / 1024).toFixed(0)} KB, events.json ${(eventsSize / 1024).toFixed(0)} KB -> ${soundsDir}`);
  return { templates: ported, placedMusic: placed, sceneMusic: fromScene, leftOut, failed, samples: Object.keys(sampleInfo).length, bytes, copied, missing, unreadable, silent, repaired, aliases, dangling: [...dangling], leftOutButNamed: [...leftOutButNamed], packGaps: [...fromPacks.keys()], packScore, scenes, clientData: Object.keys(clientData).length, clientEffects: Object.keys(clientEffects).length, sources, counts };
}

/**
 * What the sound bank under `<out-dir>` holds, and what to run when it is missing or
 * older than the converter. `readJson` is the caller's reader (null when the file is absent).
 */
export function soundStatus(dir, readJson) {
  const sounds = readJson(join(dir, 'sounds', 'sounds.json'));
  if (!sounds) return { line: '  sounds: none (the game is silent)', need: 'no sound bank: no ambience, footsteps, weapons or engines' };
  const templates = Object.keys(sounds.templates ?? {}).length;
  const samples = Object.keys(sounds.samples ?? {}).length;
  const bytes = Object.values(sounds.samples ?? {}).reduce((a, s) => a + (s.bytes ?? 0), 0);
  const events = readJson(join(dir, 'sounds', 'events.json'));
  const sources = readJson(join(dir, 'sounds', 'sources.json'));
  const parts = [
    `${templates} templates`,
    `${samples} samples (${(bytes / 1048576).toFixed(0)} MB)`,
    events ? `${Object.keys(events.clientData ?? {}).length} client data files, ${Object.keys(events.clientEffects ?? {}).length} client effects` : 'NO EVENTS',
    sources ? `${(sources.rooms ?? []).length} room rows, ${Object.keys(sources.interface ?? {}).length} interface sounds` : 'NO SOURCES',
  ];
  const line = `  sounds: ${parts.join(', ')}`;
  if ((sounds.format ?? 0) < SOUND_FORMAT) return { line, need: 'the sound bank is from an older converter' };
  if (sounds.samplesWritten === false) return { line, need: 'the sound bank holds no audio (it was written with --no-samples)' };
  if (sounds.only) return { line, need: `the sound bank holds only the templates matching "${sounds.only}"` };
  if (!events) return { line, need: 'the sound bank has no events.json (nothing knows which sound belongs to which event)' };
  if (!sources) return { line, need: 'the sound bank has no sources.json (no room, door, interface or melee sounds)' };
  return { line, need: null };
}

/** Read a pack's JSON file, or null. Shared by the command and by `status`. */
export function readPackJson(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
