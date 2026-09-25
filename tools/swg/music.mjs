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
// What is **not** in the archives is which of the fourteen instrument templates plays which of the
// six stems. That mapping is ours (`STEM_OF`), it is written down here rather than guessed at in the
// game, and the ones it cannot place are said out loud rather than silently dropped.
//
// Dependency-free but for node's own modules; shared with tools/swg/tests/music.test.ts.

/**
 * Which stem each instrument plays, and why.
 *
 * Six stems and fourteen instruments, so some share. The six are named for real instruments -- the
 * kloo horn, the mandoviol, the nalargon, the slitherhorn, the xantha and a drum -- and every one of
 * those six takes its own; the rest are put with the one they are most like, which is a judgement
 * and is marked as one. A player holding two instruments that share a stem is playing the same part
 * as a player holding the other, which is exactly what a band of two kloo horns would sound like.
 */
export const STEM_OF = {
  // The six the samples are named for.
  kloo_horn: 'khorn',
  mandoviol: 'mand',
  nalargon: 'nlrg',
  slitherhorn: 'shorn',
  xantha: 'xantha',
  traz: 'drum',
  // And the rest, by what they are: a judgement of ours, one line each.
  bandfill: 'drum', // a struck box: the drum's part
  fizz: 'drum', // a rattle
  fanfar: 'khorn', // a horn
  valahorn: 'khorn', // a horn
  kloo_horn_hue: 'khorn',
  flute_droopy: 'shorn', // a wind instrument, like the slitherhorn
  flanged_jessoon: 'shorn',
  ommni_box: 'nlrg', // a keyed box, like the nalargon
  downey_box: 'nlrg',
  organ_max_rebo: 'nlrg', // the Max Rebo organ is a keyboard
  instrument_organ_max_rebo: 'nlrg',
  instrument_organ_figrin_dan: 'nlrg',
};

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

/** Which instruments the pack can really be played with, and which it cannot place. */
export function instrumentStems(ids) {
  const placed = [];
  const unplaced = [];
  for (const id of ids) {
    const key = id.replace(/^shared_/, '').replace(/_hue$/, '');
    const stem = STEM_OF[key] ?? STEM_OF[id] ?? null;
    if (stem) placed.push({ id, stem });
    else unplaced.push(id);
  }
  return { placed, unplaced };
}
