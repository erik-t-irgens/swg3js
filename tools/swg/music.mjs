// The music a player makes: the game's own instrument stems.
//
// **There is no world music here and there never will be.** The owner's decision is that the only
// music in this game is diegetic -- the sound of players playing instruments -- so the background
// score in `music/` (about 460 mp3s) is left exactly where it is, unconverted, and what this reads is
// `player_music/`, which is a different thing entirely.
//
// And it is a better thing. The game shipped its player music as **one track per instrument per
// song**, which is precisely what a band layering up sounds like:
//
//     player_music/sample/song01_khorn_main_lp.wav
//     player_music/sample/song01_drum_flourish03_lp.wav
//
// so a song is `song01` to `song18` or so, an instrument is one of six stems (`drum`, `khorn`,
// `mand`, `nlrg`, `shorn`, `xantha`), and a part is an `intro`, a `main_lp`, an `outro` or one of
// eight `flourish`es. Over 1,200 samples come to about six stems times eleven parts times eighteen
// songs. Nobody has to invent a thing: hold a kloo horn and you play the kloo horn's track of
// whatever song the band is playing, and two players on two instruments layer because the game
// wrote them to.
//
// Which instrument plays which stem **is** in the archives, and the first cut of this said it was
// not. `datatables/performance/performance.iff` has a row per song per instrument, and its
// `mainloop` column names the very sample file that song's part is: twenty rows an instrument, and
// on every one of the fourteen the twenty agree. Guessing from what an instrument looks like got six
// of those fourteen wrong -- the traz is not a drum, the fizz is not a rattle, and the ommni box is
// not a keyboard as far as the game's own music is concerned. It is read now, and the handful of
// instruments the table does not name are the only ones still ours.
//
// Dependency-free but for node's own modules and this folder's readers; shared with
// tools/swg/tests/music.test.ts.

import { parseDatatable } from './datatable.mjs';
import { parseIff } from './iff.mjs';

/** The table that states it, one row per song per instrument. */
const PERFORMANCE_TABLE = 'datatables/performance/performance.iff';

/**
 * The instruments the game's own table does **not** name, and what they play. Ours, one line each.
 *
 * Five of the twenty-seven templates the weapons pack carries have no row in the performance table
 * at all -- the two organs and the Figrin D'an one are decorations the game never let a player
 * perform with -- so if they are to be held and played at all, something has to choose. They take
 * the nalargon's part, which is the keyboard.
 */
export const STEM_OURS = {
  organ_max_rebo: 'nlrg',
  instrument_organ_max_rebo: 'nlrg',
  instrument_organ_figrin_dan: 'nlrg',
};

/**
 * How a template's own id is spelled in the performance table.
 *
 * The table writes them squashed and without the colour variant: `kloo_horn_hue` is `kloohorn`. Two
 * do not fall out of that rule and are named here rather than fudged: the template spells the ommni
 * box with two m's and the table with one, and `downey_box` keeps its shape.
 */
export function performanceName(id) {
  const bare = String(id ?? '')
    .replace(/_hue$/, '')
    .replace(/^instrument_/, '');
  const squashed = bare.replace(/_/g, '');
  return squashed === 'ommnibox' ? 'omnibox' : squashed;
}

/**
 * Which stem each instrument plays, read off the game's own table.
 *
 * The answer is per song and not merely per instrument, which is the one thing a single mapping
 * could never say: the **xantha plays the mandoviol's part for songs 1 to 10 and its own for 11 to
 * 20**, which is exactly why those first ten songs carry five stems and the rest carry six. Told
 * only "the xantha plays xantha", a player holding one is refused half the songs in the game.
 */
export function readStems(vfs) {
  const table = parseDatatable(parseIff(Buffer.from(vfs.read(PERFORMANCE_TABLE))));
  const out = new Map();
  for (const row of table.rows) {
    const inst = row.requiredInstrument;
    if (!inst) continue;
    const song = Number(/song(\d+)_/.exec(String(row.mainloop ?? ''))?.[1]);
    const stem = /song\d+_([a-z]+)_/.exec(String(row.mainloop ?? ''))?.[1];
    if (!stem || !Number.isFinite(song)) continue;
    if (!out.has(inst)) out.set(inst, new Map());
    out.get(inst).set(song, stem);
  }
  return out;
}

/** The six stems the samples are written for, in the order a band reads best in. */
export const STEMS = ['drum', 'nlrg', 'mand', 'khorn', 'shorn', 'xantha'];

/** What each stem is called in words, for whatever shows a band. */
export const STEM_NAMES = { drum: 'drum', nlrg: 'nalargon', mand: 'mandoviol', khorn: 'kloo horn', shorn: 'slitherhorn', xantha: 'xantha' };

/**
 * A sample's song, stem and part, or null when it is not one of the music samples.
 *
 * `song01_drum_flourish03_lp` is song 1, the drum, flourish 3. The trailing `_lp` says the sample
 * loops and is not part of the name of anything.
 *
 * **One song spells its flourishes differently**: song 6's drum writes `song06_drum_1_lp` to `_8_lp`
 * where every other song and every other stem writes `flourish01` to `flourish08`. Eight files, and
 * read strictly they are eight flourishes silently missing from one instrument of one song with
 * nothing to say so -- which is why a bare number is taken as a flourish too.
 */
export function readSampleName(path) {
  const stem = String(path).split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
  const m = /^song(\d+)_([a-z]+)_(intro|main|outro|flourish(\d+)|(\d+))(_lp)?$/.exec(stem);
  if (!m) return null;
  const flourish = m[4] ?? m[5];
  return {
    song: Number(m[1]),
    stem: m[2],
    part: flourish ? 'flourish' : m[3],
    flourish: flourish ? Number(flourish) : 0,
    loops: !!m[6],
    file: String(path),
  };
}

/**
 * Every song in a list of sample paths, as the pack carries it: song number to stem to its parts.
 *
 * A song with no main loop for a stem is not a song that stem can play, and is left out of that
 * stem rather than written half-made -- the whole point is that holding an instrument either gives
 * you a part or does not.
 */
export function readSongs(paths) {
  const songs = new Map();
  const odd = [];
  for (const p of paths) {
    const r = readSampleName(p);
    if (!r) {
      if (/\.(wav|mp3|ogg)$/i.test(p) && !/no_sound/.test(p)) odd.push(p);
      continue;
    }
    const song = songs.get(r.song) ?? new Map();
    songs.set(r.song, song);
    const stem = song.get(r.stem) ?? { intro: null, main: null, outro: null, flourishes: [] };
    song.set(r.stem, stem);
    if (r.part === 'flourish') stem.flourishes[r.flourish - 1] = r.file;
    else stem[r.part] = r.file;
  }
  const out = [];
  for (const [n, byStem] of [...songs].sort((a, b) => a[0] - b[0])) {
    const stems = {};
    for (const [s, parts] of byStem) {
      if (!parts.main) continue;
      stems[s] = { intro: parts.intro, main: parts.main, outro: parts.outro, flourishes: parts.flourishes.filter(Boolean) };
    }
    if (Object.keys(stems).length) out.push({ song: n, stems });
  }
  return { songs: out, odd };
}

/** What the conversion prints and `status` reads. */
export function musicCounts(songs) {
  let parts = 0;
  const stems = new Set();
  let full = 0;
  for (const s of songs) {
    const names = Object.keys(s.stems);
    for (const n of names) {
      stems.add(n);
      const st = s.stems[n];
      parts += 1 + (st.intro ? 1 : 0) + (st.outro ? 1 : 0) + st.flourishes.length;
    }
    if (names.length >= STEMS.length) full++;
  }
  return { songs: songs.length, stems: stems.size, parts, full };
}

/**
 * Which instruments the pack can really be played with, and which it cannot place.
 *
 * `byName` is what `readStems` gave, keyed by the table's own spelling. Each placed instrument gets
 * the stem it plays on most songs and, where the table disagrees with itself across the songs, the
 * songs that differ -- which is the xantha and nothing else in the retail table.
 */
export function instrumentStems(ids, byName = new Map()) {
  const placed = [];
  const unplaced = [];
  for (const id of ids) {
    const rows = byName.get(performanceName(id.replace(/^shared_/, '')));
    if (!rows || !rows.size) {
      const ours = STEM_OURS[id] ?? STEM_OURS[id.replace(/_hue$/, '')] ?? null;
      if (ours) placed.push({ id, stem: ours, ours: true });
      else unplaced.push(id);
      continue;
    }
    // The stem it plays on most songs is its own; anything else is written out per song.
    const tally = new Map();
    for (const s of rows.values()) tally.set(s, (tally.get(s) ?? 0) + 1);
    const stem = [...tally].sort((a, b) => b[1] - a[1])[0][0];
    const songs = {};
    for (const [song, s] of rows) if (s !== stem) songs[song] = s;
    placed.push(Object.keys(songs).length ? { id, stem, songs } : { id, stem });
  }
  return { placed, unplaced };
}
