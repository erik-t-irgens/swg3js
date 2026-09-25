// The music players make: the sample names, the songs they come to, which instrument plays which
// track, and the band that lines two players up.
//
// The real archives' own sample list is read where the pack is converted, because the one thing that
// would quietly ruin this is a naming shape the reader does not know — which has already happened
// once, in one song, for eight files.
//
// Run: node tools/swg/tests/music.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STEMS, STEM_OF, instrumentStems, musicCounts, readSampleName, readSongs } from '../music.mjs';
import { BAND_TUNE, Band, bandWords, inBand, musicId, musicTemplate, partsFor, songOffset, songsFor, stemFor, type MusicPack } from '../../../src/audio/band.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

// ---------------------------------------------------------------- the sample names

{
  const r = readSampleName('player_music/sample/song01_khorn_main_lp.wav')!;
  ok(r.song === 1 && r.stem === 'khorn' && r.part === 'main' && r.loops, 'a main loop reads as its song, its instrument and its part');
  const f = readSampleName('player_music/sample/song12_mand_flourish07_lp.wav')!;
  ok(f.part === 'flourish' && f.flourish === 7, 'and a flourish reads as which flourish it is');
  const i = readSampleName('player_music/sample/song03_drum_intro.wav')!;
  ok(i.part === 'intro' && !i.loops, 'an intro does not loop, and says so by not being named as one');
  ok(readSampleName('player_music/sample/no_sound.wav') === null, 'and the silent placeholder is not a part of anything');
  ok(readSampleName('sound/footstep_dirt.wav') === null, 'nor is a sound from anywhere else');
}

{
  // The shape that cost eight files: **one** song writes its drum flourishes as a bare number.
  const bare = readSampleName('player_music/sample/song06_drum_3_lp.wav')!;
  ok(bare.part === 'flourish' && bare.flourish === 3, "song 6's drum writes its flourishes as bare numbers, and they are still flourishes");
  const named = readSampleName('player_music/sample/song06_khorn_flourish03_lp.wav')!;
  ok(named.flourish === bare.flourish, 'and the same flourish of the same song on another instrument is the same number');
}

// ---------------------------------------------------------------- the songs

{
  const { songs } = readSongs([
    'player_music/sample/song01_khorn_intro.wav',
    'player_music/sample/song01_khorn_main_lp.wav',
    'player_music/sample/song01_khorn_outro.wav',
    'player_music/sample/song01_khorn_flourish01_lp.wav',
    'player_music/sample/song01_khorn_flourish02_lp.wav',
    'player_music/sample/song01_drum_main_lp.wav',
    // A stem with no main loop is not a part anybody can play.
    'player_music/sample/song01_mand_flourish01_lp.wav',
    'player_music/sample/song02_nlrg_main_lp.wav',
  ]);
  ok(songs.length === 2, 'two songs');
  const one = songs[0];
  ok(one.song === 1 && Object.keys(one.stems).sort().join() === 'drum,khorn', 'with only the stems that really have a main loop');
  ok(!one.stems.mand, 'a stem with flourishes and no loop is left out rather than written half-made');
  ok(one.stems.khorn.flourishes.length === 2 && !!one.stems.khorn.intro && !!one.stems.khorn.outro, 'and a whole track carries its intro, its outro and its flourishes');
  ok(!one.stems.drum.intro && one.stems.drum.flourishes.length === 0, 'while a bare one carries just its loop');
  const c = musicCounts(songs);
  ok(c.songs === 2 && c.stems === 3 && c.parts === 7, `and the counts add up (${JSON.stringify(c)})`);
}

{
  const { odd } = readSongs(['player_music/sample/something_else.wav', 'player_music/sample/no_sound.wav']);
  ok(odd.length === 1 && odd[0].includes('something_else'), 'a sample the reader does not know is reported rather than dropped in silence');
}

// ---------------------------------------------------------------- which instrument plays what

{
  const { placed, unplaced } = instrumentStems(['kloo_horn', 'kloo_horn_hue', 'mandoviol', 'traz', 'fanfar', 'not_an_instrument']);
  ok(placed.find((p) => p.id === 'kloo_horn')?.stem === 'khorn', 'the six instruments the samples are named for play their own tracks');
  ok(placed.find((p) => p.id === 'kloo_horn_hue')?.stem === 'khorn', 'and a colour variant plays the same one, since it is the same instrument');
  ok(placed.find((p) => p.id === 'fanfar')?.stem === 'khorn', 'an instrument the samples are not named for is put with the one it is most like');
  ok(unplaced.length === 1 && unplaced[0] === 'not_an_instrument', 'and one that cannot be placed is said out loud rather than given somebody else\'s part');
  ok(STEMS.length === 6 && new Set(Object.values(STEM_OF)).size === 6, 'six stems, and every one of them is somebody\'s');
}

// ---------------------------------------------------------------- the band

const fixture: MusicPack = {
  version: 1,
  counts: {},
  stems: ['khorn', 'mand'],
  stemNames: { khorn: 'kloo horn', mand: 'mandoviol' },
  instruments: { kloo_horn: 'khorn', mandoviol: 'mand', nalargon: 'nlrg' },
  songs: [
    { song: 1, stems: { khorn: { intro: 'samples/a_intro.wav', main: 'samples/a_main_lp.wav', outro: 'samples/a_outro.wav', flourishes: ['samples/a_f1_lp.wav'] }, mand: { intro: null, main: 'samples/b_main_lp.wav', outro: null, flourishes: [] } } },
    { song: 2, stems: { khorn: { intro: null, main: 'samples/c_main_lp.wav', outro: null, flourishes: [] } } },
  ],
};

{
  ok(stemFor('kloo_horn', fixture) === 'khorn', 'an instrument names its stem');
  ok(stemFor('a_rock', fixture) === null, 'and something that is not one names none');
  ok(songsFor('khorn', fixture).join() === '1,2', 'a kloo horn has a part in both songs');
  ok(songsFor('mand', fixture).join() === '1', 'and a mandoviol in only the one that wrote it a track');
  ok(songsFor('nlrg', fixture).length === 0, 'an instrument with no track in any song has nothing to play');
  ok(partsFor(1, 'khorn', fixture)?.main === 'samples/a_main_lp.wav', "a part is the instrument's own");
  ok(partsFor(2, 'mand', fixture) === null, 'and a song with no track for that instrument has none: there is no falling back on somebody else\'s');
}

{
  ok(musicTemplate('samples/a_main_lp.wav', true).samples[0] === '../music/samples/a_main_lp.wav', "a made template points at the music folder beside the bank's own samples");
  ok(musicTemplate('a_main_lp.wav', true).samples[0] === '../music/samples/a_main_lp.wav', 'however the file was written');
  ok(musicId('samples/a_main_lp.wav') === 'music:a_main_lp', 'and one name a file, so nothing is ever made twice');
  const loop = musicTemplate('samples/a_main_lp.wav', true) as unknown as { loop: number };
  const once = musicTemplate('samples/a_intro.wav', false) as unknown as { loop: number };
  ok(loop.loop === 0 && once.loop === 1, "the file's own _lp is what says it loops, which is the one thing the game did say");
}

{
  // Two players who press at different moments must land in the same place in the bar.
  const a = songOffset(100.25);
  const b = songOffset(100.25 + BAND_TUNE.bar * 3);
  ok(Math.abs(a - b) < 1e-9, 'the offset is the same a whole number of bars later, so two players line up whoever pressed first');
  for (const t of [-5, 0, 0.1, 999.9]) {
    const o = songOffset(t);
    assert.ok(o >= 0 && o < BAND_TUNE.bar, `the offset stays inside a bar at ${t}`);
  }
  passed++;
  console.log('ok   and it is always inside one bar, even before the clock started');
}

function driven() {
  const loops: { id: string; gain: number; offset: number }[] = [];
  const onces: string[] = [];
  const stopped: number[] = [];
  const provided: string[] = [];
  let next = 1;
  const b = new Band();
  b.attach({
    loop: (id, _at, gain, offset) => {
      loops.push({ id, gain, offset });
      return next++;
    },
    once: (id) => {
      onces.push(id);
      return next++;
    },
    stop: (key) => stopped.push(key),
    provide: (id) => provided.push(id),
    seconds: () => 40,
  });
  return { b, loops, onces, stopped, provided };
}

const here = { x: 0, y: 0, z: 0 };

{
  // The fixture has to be the pack the band reads; `loadMusic` is the only other way in and it fetches.
  const d = driven();
  ok(d.b.start(1, 'kloo_horn', here) === 'no music is converted: run the converter\'s `music` command', 'with no pack the band says so rather than playing silence');
}

{
  // Put the fixture in by the same door `loadMusic` uses.
  const globalThisAny = globalThis as unknown as { fetch: unknown };
  const had = globalThisAny.fetch;
  globalThisAny.fetch = async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => fixture });
  const { loadMusic } = await import('../../../src/audio/band.ts');
  await loadMusic('');
  globalThisAny.fetch = had;
  ok(!!stemFor('kloo_horn'), 'the pack loads');
}

{
  const d = driven();
  ok(d.b.start(1, 'kloo_horn', here) === null, 'a kloo horn plays song 1');
  ok(d.loops.length === 1 && d.loops[0].id === 'music:a_main_lp', 'and it is that instrument\'s own loop that starts');
  ok(d.loops[0].offset === songOffset(40), 'started where the song is, not where the press was');
  ok(d.onces[0] === 'music:a_intro', 'with the intro over the top, so a player joining late does not hold the band up');
  ok(d.provided.length === 2, 'and a template made for each part, once');
  ok(d.b.mine?.stem === 'khorn', 'and the band knows what it is playing');
}

{
  const d = driven();
  ok(d.b.start(2, 'mandoviol', here)?.includes('no part for the mandoviol') === true, 'a song with no track for your instrument says which instrument it is');
  ok(d.loops.length === 0, 'and plays nothing at all rather than somebody else\'s part');
  ok(d.b.start(1, null, here) === 'nothing in your hands to play', 'and empty hands play nothing');
  ok(d.b.start(1, 'a_rock', here)?.includes('not an instrument') === true, 'as does something that is not an instrument');
}

{
  const d = driven();
  d.b.start(1, 'kloo_horn', here);
  ok(d.b.flourish(1, here), 'a flourish this song has for this instrument plays');
  ok(d.onces[d.onces.length - 1] === 'music:a_f1_lp', 'and it is the right one');
  ok(!d.b.flourish(5, here), 'and one it has not does nothing at all');
  d.b.stop(here);
  ok(d.onces[d.onces.length - 1] === 'music:a_outro' && d.stopped.length === 1, 'stopping plays the outro and lets the loop go');
  ok(d.b.mine === null, 'and nothing is playing afterwards');
}

{
  const d = driven();
  d.b.start(1, 'kloo_horn', here);
  const was = d.loops.length;
  d.b.start(2, 'kloo_horn', here);
  ok(d.loops.length === was + 1 && d.stopped.length === 1, 'changing song lets the old loop go and starts the new one');
}

{
  const d = driven();
  d.b.hear(7, { song: 1, stem: 'mand', flourish: 0 }, here, 10);
  ok(d.loops.length === 1 && d.loops[0].id === 'music:b_main_lp', "another player's own instrument is what is heard from them");
  d.b.hear(7, { song: 1, stem: 'mand', flourish: 0 }, here, 10);
  ok(d.loops.length === 1, 'and hearing the same thing again starts nothing more');
  d.b.hear(7, { song: 1, stem: 'mand', flourish: 0 }, here, BAND_TUNE.reach + 5);
  ok(d.stopped.length === 1, 'walking out of earshot stops them');
  d.b.hear(7, null, null, 0);
  ok(d.stopped.length === 1, 'and stopping somebody already stopped does nothing');
}

{
  const d = driven();
  d.b.hear(7, { song: 2, stem: 'mand', flourish: 0 }, here, 5);
  ok(d.loops.length === 0, 'a player playing a song their instrument has no track for is heard as nothing, which is what they are playing');
}

{
  const d = driven();
  d.b.start(1, 'kloo_horn', here);
  d.b.hear(7, { song: 1, stem: 'mand', flourish: 0 }, here, 5);
  ok(d.loops.length === 2, 'two players on two instruments are two tracks: that is the whole of a band');
  ok(d.loops[0].offset === d.loops[1].offset, 'and both started at the same place in the bar, so they line up');
  d.b.clear();
  ok(d.stopped.length === 2 && d.b.report().playing === 0, 'and a world going away stops all of it');
}

{
  ok(inBand({ song: 1, stem: 'khorn', flourish: 0 }, { song: 1, stem: 'mand', flourish: 0 }, 10), 'the same song near enough to hear is one band');
  ok(!inBand({ song: 1, stem: 'khorn', flourish: 0 }, { song: 2, stem: 'mand', flourish: 0 }, 10), 'two different songs are not');
  ok(!inBand({ song: 1, stem: 'khorn', flourish: 0 }, { song: 1, stem: 'mand', flourish: 0 }, BAND_TUNE.reach + 1), 'and neither is the same song too far off');
  ok(bandWords({ song: 3, stem: 'khorn', flourish: 0 }, { khorn: 'kloo horn' }).includes('kloo horn'), 'and a performance reads in words');
}

// ---------------------------------------------------------------- the real pack

{
  const file = join('assets-private', 'music', 'music.json');
  if (!existsSync(file)) {
    note('no music pack here (npm run swg -- music @SWG assets-private --retail-only)');
  } else {
    const p = JSON.parse(readFileSync(file, 'utf8')) as MusicPack;
    ok(p.version === 1 && p.songs.length > 0, `the pack carries ${p.songs.length} songs`);
    const full = p.songs.filter((s) => Object.keys(s.stems).length >= STEMS.length).length;
    for (const s of p.songs) {
      for (const [stem, parts] of Object.entries(s.stems)) {
        assert.ok(parts.main, `song ${s.song} ${stem} has a loop`);
        assert.ok(STEMS.includes(stem), `song ${s.song} ${stem} is one of the six`);
      }
    }
    passed++;
    console.log('ok   every track in the real pack has a loop and is one of the six instruments');
    note(`${full} of the ${p.songs.length} songs carry all six; the rest carry fewer, so holding an instrument really does decide whether you have a part`);
    const placed = Object.keys(p.instruments).length;
    note(placed ? `${placed} instruments are placed on a track` : 'no instrument is placed yet: the weapons pack wants converting again for the instrument class');
  }
}

console.log(`\n${passed} checks passed`);
