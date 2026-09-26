// The music players make: the sample names, the songs they come to, which instrument plays which
// track, and the band that lines two players up.
//
// The real archives' own sample list is read where the pack is converted, because the one thing that
// would quietly ruin this is a naming shape the reader does not know — which has already happened
// once, in one song, for eight files.
//
// Run: node tools/swg/tests/music.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { STEMS, STEM_OURS, instrumentStems, musicCounts, performanceName, readSampleName, readSongs } from '../music.mjs';
import { BAND_TUNE, Band, FLOOR_INSTRUMENTS, MUSIC_ANIM, animFor, bandWords, inBand, musicId, musicTemplate, partsFor, songOffset, songsFor, standsOnGround, stemFor, type MusicPack } from '../../../src/audio/band.ts';
import { TemplateRun, makeStart } from '../../../src/audio/template.ts';
import { isFlourishClip, isMusicLoop, loopsEmote, performOf } from '../../../src/core/emotes.ts';

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
  // How a template's own id is spelled in the game's own table: squashed, without the colour, and
  // two that do not fall out of the rule and are named rather than fudged.
  ok(performanceName('kloo_horn_hue') === 'kloohorn', "a colour variant is the same instrument, spelled the table's way");
  ok(performanceName('ommni_box') === 'omnibox', 'the template spells the box with two m and the table with one');
  ok(performanceName('instrument_organ_max_rebo') === 'organmaxrebo', 'and the prefix some templates carry comes off');
}

{
  // The table, as the real one is shaped: a row per song per instrument naming the very sample file.
  const byName = new Map([
    ['kloohorn', new Map([[1, 'khorn'], [2, 'khorn']])],
    ['traz', new Map([[1, 'shorn'], [2, 'shorn']])],
    // The one instrument whose answer is not a single stem: the xantha takes the mandoviol's part
    // for the first half of the songs and its own for the second, which is why those songs carry
    // five stems and the rest six.
    ['xantha', new Map([[1, 'mand'], [2, 'xantha'], [3, 'xantha']])],
  ]);
  const { placed, unplaced } = instrumentStems(['kloo_horn', 'kloo_horn_hue', 'traz', 'xantha', 'organ_max_rebo', 'not_an_instrument'], byName);
  ok(placed.find((p) => p.id === 'kloo_horn')?.stem === 'khorn', 'an instrument plays what the table says it plays');
  ok(placed.find((p) => p.id === 'kloo_horn_hue')?.stem === 'khorn', 'and a colour variant plays the same, since it is the same instrument');
  // Guessed from what it looks like the traz was a drum. The table says otherwise on all twenty of
  // its rows, and six of the fourteen were wrong that way.
  ok(placed.find((p) => p.id === 'traz')?.stem === 'shorn', "the traz is not a drum, whatever it looks like: the table is read and not the shape of the thing");
  const x = placed.find((p) => p.id === 'xantha');
  ok(x?.stem === 'xantha' && x?.songs?.[1] === 'mand', 'the xantha plays its own part on most songs and the mandoviol\'s on the ones the table says');
  ok(placed.find((p) => p.id === 'organ_max_rebo')?.ours === true, 'an instrument the table never names takes one of ours, and is marked as ours');
  ok(unplaced.length === 1 && unplaced[0] === 'not_an_instrument', "and one that is neither is said out loud rather than given somebody else's part");
  ok(STEMS.length === 6 && new Set(Object.values(STEM_OURS)).size >= 1, 'six stems, and the ones we chose for ourselves are the only ones written by hand');
}

// ---------------------------------------------------------------- the band

const fixture: MusicPack = {
  version: 1,
  counts: {},
  stems: ['khorn', 'mand'],
  stemNames: { khorn: 'kloo horn', mand: 'mandoviol' },
  instruments: { kloo_horn: 'khorn', mandoviol: 'mand', nalargon: 'nlrg', xantha: { stem: 'mand', songs: { 2: 'khorn' } } },
  songs: [
    { song: 1, stems: { khorn: { intro: 'samples/a_intro.wav', main: 'samples/a_main_lp.wav', outro: 'samples/a_outro.wav', flourishes: ['samples/a_f1_lp.wav', 'samples/a_f2_lp.wav', 'samples/a_f3_lp.wav'] }, mand: { intro: null, main: 'samples/b_main_lp.wav', outro: null, flourishes: [] } } },
    { song: 2, stems: { khorn: { intro: null, main: 'samples/c_main_lp.wav', outro: null, flourishes: [] } } },
  ],
};

{
  ok(stemFor('kloo_horn', fixture) === 'khorn', 'an instrument names its stem');
  ok(stemFor('a_rock', fixture) === null, 'and something that is not one names none');
  ok(songsFor('kloo_horn', fixture).join() === '1,2', 'a kloo horn has a part in both songs');
  ok(songsFor('mandoviol', fixture).join() === '1', 'and a mandoviol in only the one that wrote it a track');
  ok(songsFor('nalargon', fixture).length === 0, 'an instrument with no track in any song has nothing to play');
  // The whole reason `songsFor` takes the instrument and not a stem: asked by stem, an instrument
  // whose part changes from song to song is refused half the songs it can really play.
  ok(stemFor('xantha', fixture, 1) === 'mand' && stemFor('xantha', fixture, 2) === 'khorn', 'an instrument whose part changes by song answers per song');
  ok(songsFor('xantha', fixture).join() === '1,2', 'and has a part in both of them, one on each stem');
  ok(partsFor(1, 'khorn', fixture)?.main === 'samples/a_main_lp.wav', "a part is the instrument's own");
  ok(partsFor(2, 'mand', fixture) === null, 'and a song with no track for that instrument has none: there is no falling back on somebody else\'s');
}

{
  // The bank fetches a sample from `assets-private/sounds/samples/`, and the music is a sibling of
  // `sounds/` rather than a child of it, so the way out is two levels and not one. The sabers' own
  // made templates say `../jka/`, which is right for them and wrong here: `assets-private/sounds/jka/`
  // really is beside the samples folder. One `../` too few is a 404 on every note.
  ok(musicTemplate('samples/a_main_lp.wav', true).samples[0] === '../../music/samples/a_main_lp.wav', 'a made template reaches out of the bank\'s samples folder and into the music one');
  ok(musicTemplate('a_main_lp.wav', true).samples[0] === '../../music/samples/a_main_lp.wav', 'however the file was written');
  ok(musicId('samples/a_main_lp.wav') === 'music:a_main_lp', 'and one name a file, so nothing is ever made twice');
  const loop = musicTemplate('samples/a_main_lp.wav', true);
  const once = musicTemplate('samples/a_intro.wav', false);
  ok(loop.loops?.[0] === -1 && loop.loops?.[1] === -1, "the file's own _lp is what says it loops, which is the one thing the game did say");
  ok(once.loops === undefined, 'and a part that is not a loop leaves the field out, which the reader takes as one play');
  ok(loop.category === 9 && !loop.placedMusic, "it is the game's own player music, so it answers to the music slider and not the ambience one");
  ok(loop.dim === 3, 'and it has a place in the world, so it is heard from where the player stands');
}

{
  // The check the whole suite was missing, and the reason a crash sat under twenty passing
  // assertions: nothing ever built a run out of one of these. The first cut was a hand-made object
  // behind `as unknown as SoundTemplate` whose `volume: 1` was a number where the reader wants a
  // variation, so the very first line of `TemplateRun` that read it threw. Building one here is one
  // line and it cannot be got wrong again.
  const run = new TemplateRun(musicTemplate('samples/a_main_lp.wav', true), () => 0.5, 0);
  ok(run.loops, 'a made loop really loops when the reader is given it');
  ok(run.begin === 0, 'and begins at once: no delay, because the field is absent and absent means none');
  const start = makeStart();
  ok(run.nextDue(1, start), 'and is due at once');
  ok(start.gain === 1 && start.rate === 1, "at its own volume and its own pitch, which are the reader's defaults");
  ok(Number.isFinite(start.at) && Number.isFinite(start.fadeIn), 'and every number it hands the mixer is a number');
  const plain = new TemplateRun(musicTemplate('samples/a_intro.wav', false), () => 0.5, 0);
  ok(!plain.loops, 'while an intro plays once');
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

/**
 * A band with a mixer of nothing behind it, and a clock the test winds by hand.
 *
 * Every part is two seconds long, so a whole performance can be walked through a bar at a time.
 * `run(seconds)` moves the clock in small steps and ticks, which is the frame loop.
 */
function driven() {
  const loops: { id: string; gain: number; offset: number }[] = [];
  const onces: { id: string; gain: number; when: number }[] = [];
  const stopped: number[] = [];
  const provided: { id: string; loops: boolean }[] = [];
  const moved: { key: number; x: number }[] = [];
  const segments: string[] = [];
  let next = 1;
  let clock = 100;
  const LENGTH = 2;
  const b = new Band();
  b.attach({
    loop: (id, _at, gain, offset) => {
      loops.push({ id, gain, offset });
      return next++;
    },
    once: (id, _at, gain, when) => {
      onces.push({ id, gain, when: when ?? 0 });
      return next++;
    },
    stop: (key) => stopped.push(key),
    move: (key, at) => moved.push({ key, x: at.x }),
    provide: (id, t) => provided.push({ id, loops: !!t.loops }),
    duration: () => LENGTH,
    now: () => clock,
    seconds: () => 40,
  });
  b.onSegment = (kind, n) => segments.push(n ? `${kind} ${n}` : kind);
  /** Move the clock on, ticking as a frame loop would. */
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      clock += 1 / 30;
      b.tick();
    }
  };
  return { b, loops, onces, stopped, provided, moved, segments, run, length: LENGTH, at: () => clock };
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

// ---------------------------------------------------------------- the shape of a performance

{
  // The intro **alone**, and the loop after it. It used to be laid over the loop and the two were
  // heard at once, which is the thing the owner reported first.
  const d = driven();
  ok(d.b.start(1, 'kloo_horn', here) === null, 'a kloo horn plays song 1');
  ok(d.loops.length === 0, 'nothing is started as a forever loop: a performance is a chain of single plays');
  ok(d.onces.length === 1 && d.onces[0].id === 'music:a_intro', 'the intro is the only thing playing when a song begins');
  ok(d.segments.join(',') === 'intro', 'and the body is posed for the intro and nothing else');
  ok(d.provided.every((p) => !p.loops), 'no part is made as a looping template, whatever its file is called');
  ok(d.b.mine?.stem === 'khorn', 'and the band knows what it is playing');

  // The loop takes over at the moment the intro ends, and is scheduled rather than started late.
  d.run(d.length + 0.2);
  ok(d.onces.length === 2 && d.onces[1].id === 'music:a_main_lp', 'when the intro ends the loop is what follows it');
  ok(Math.abs(d.onces[1].when - (100 + d.length)) < 0.05, 'handed to the mixer with the exact moment the intro ends, so the seam has nothing in it');
  ok(d.segments.join(',') === 'intro,main', 'and the body changes with it');
  d.run(d.length);
  ok(d.onces.length === 3 && d.onces[2].id === 'music:a_main_lp', 'and the loop comes round again by itself');
}

{
  const d = driven();
  ok(d.b.start(2, 'mandoviol', here)?.includes('no part for the mandoviol') === true, 'a song with no track for your instrument says which instrument it is');
  ok(d.onces.length === 0, 'and plays nothing at all rather than somebody else\'s part');
  ok(d.b.start(1, null, here) === 'nothing in your hands to play', 'and empty hands play nothing');
  ok(d.b.start(1, 'a_rock', here)?.includes('not an instrument') === true, 'as does something that is not an instrument');
}

// ---------------------------------------------------------------- a flourish waits its turn

{
  const d = driven();
  d.b.start(1, 'kloo_horn', here);
  d.run(d.length + 0.2); // past the intro, into the loop
  const was = d.onces.length;
  ok(d.b.flourish(1), 'a flourish this song has for this instrument is taken');
  ok(d.onces.length === was, 'and nothing sounds on the press: it waits for the part that is playing to finish');
  ok(d.b.queued() === 1, 'it is what is waiting');
  ok(!d.b.flourish(5), 'and one this song has not is refused');
  ok(d.b.queued() === 1, 'which leaves what was waiting where it was');

  // Asking again replaces: four presses in a bar are one flourish, the last one.
  d.b.flourish(2);
  d.b.flourish(3);
  ok(d.b.queued() === 3, 'asking again replaces what was waiting rather than adding to it');

  d.run(d.length);
  ok(d.onces[d.onces.length - 1].id === 'music:a_f3_lp', 'the last one asked for is the one that plays');
  ok(d.b.queued() === 0, 'and the queue is empty from the moment it is taken, so a press now is for the part after');
  ok(d.segments[d.segments.length - 1] === 'flourish 3', 'the body is posed for the flourish when the flourish sounds, not when it was asked for');

  d.run(d.length);
  ok(d.onces[d.onces.length - 1].id === 'music:a_main_lp', 'a flourish plays once and hands back to the loop');
  ok(d.segments[d.segments.length - 1] === 'main', 'and the body goes back with it');
}

{
  // One flourish straight into another, which is what queueing during a flourish means.
  const d = driven();
  d.b.start(1, 'kloo_horn', here);
  d.run(d.length + 0.2);
  d.b.flourish(1);
  d.run(d.length);
  ok(d.onces[d.onces.length - 1].id === 'music:a_f1_lp', 'the first flourish is playing');
  d.b.flourish(2);
  d.run(d.length);
  ok(d.onces[d.onces.length - 1].id === 'music:a_f2_lp', 'and one asked for during it follows it straight on');
  d.run(d.length);
  ok(d.onces[d.onces.length - 1].id === 'music:a_main_lp', 'then the loop, since nothing else was asked for');
}

{
  const d = driven();
  d.b.start(1, 'kloo_horn', here);
  d.run(d.length + 0.2);
  d.b.stop(here);
  ok(d.onces[d.onces.length - 1].id === 'music:a_outro' && d.stopped.length > 0, 'stopping lets what is playing go and plays the outro in its place');
  ok(d.b.mine === null, 'and nothing is being played afterwards');
  const after = d.onces.length;
  d.run(d.length * 3);
  ok(d.onces.length === after, 'the outro is the end of it: nothing follows an outro');
}

{
  const d = driven();
  d.b.start(1, 'kloo_horn', here);
  d.run(0.5);
  const was = d.stopped.length;
  d.b.start(2, 'kloo_horn', here);
  ok(d.stopped.length === was + 1, 'changing song lets the old part go');
  ok(d.onces[d.onces.length - 1].id === 'music:c_main_lp', 'and starts the new one (song 2 has no intro for this instrument)');
}

// ---------------------------------------------------------------- the three that stand on the ground

{
  ok(standsOnGround('nalargon') && standsOnGround('ommni_box') && standsOnGround('downey_box'), 'the three the owner named stand on the ground');
  ok(!standsOnGround('kloo_horn') && !standsOnGround(null), 'and a horn is carried, as is nothing at all');
  // Every one of those names must be an instrument the pack really carries: a name that has drifted
  // is a nalargon held out at arm's length again, with nothing anywhere to say so.
  const packFile = join('assets-private', 'music', 'music.json');
  if (!existsSync(packFile)) note('no music pack here, so the floor instruments are not checked against real ids');
  else {
    const ids = Object.keys((JSON.parse(readFileSync(packFile, 'utf8')) as MusicPack).instruments);
    for (const id of FLOOR_INSTRUMENTS) assert.ok(ids.includes(id), `${id} is an instrument the pack really carries`);
    passed++;
    console.log(`ok   all ${FLOOR_INSTRUMENTS.size} of the instruments that stand on the ground are in the pack under those names`);
  }
}

// ---------------------------------------------------------------- it follows the player

{
  const d = driven();
  d.b.start(1, 'kloo_horn', here);
  // Far enough into the intro that the loop after it has already been handed over.
  d.run(d.length - BAND_TUNE.ahead / 2);
  d.moved.length = 0;
  d.b.moveMine({ x: 30, y: 0, z: 0 });
  ok(d.moved.length === 2 && d.moved.every((m) => m.x === 30), 'walking moves the part sounding **and** the one already scheduled, or a flourish plays where you were standing');
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
  // Your own performance is a chain of single plays, because it has a shape: an intro, then a loop
  // with a moment in it where a flourish may take its turn. Somebody else's is joined part way
  // through something they began, so it comes in on the shared bar and is simply looped.
  ok(d.onces.length === 1 && d.loops.length === 1, 'two players on two instruments are two tracks: that is the whole of a band');
  ok(d.loops[0].offset === songOffset(40), "and the one joined part way through comes in where the song is, not where we happened to walk up");
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

// ---------------------------------------------------------------- the poses a performer plays

{
  ok(isMusicLoop('loop_skill:speed2:music_3'), 'a performance loop is the skill loop\'s third branch, as a dance is');
  ok(!isMusicLoop('loop_skill:speed2:dance_3') && !isMusicLoop('skill_action_1:music_3'), 'and neither a dance nor a flourish is one');
  ok(performOf('loop_skill:speed2:music_3') === 'music_3' && performOf('loop_skill:speed2:dance_18') === 'dance_18', 'a performance names its own style, whichever kind it is');
  ok(loopsEmote('loop_skill:speed2:music_3'), 'it loops until the player moves -- the one line that makes it loop on every other screen too');
  ok(isFlourishClip('skill_action_7:music_5'), 'and a flourish is a flourish whatever it is over');
}

{
  // Five poses cover the fourteen instruments by how each is held, which is not how they sound: a
  // traz and a kloo horn share a pose and play different parts. `music_6` is the shrug and is never
  // anybody's.
  const groups = new Set(Object.values(MUSIC_ANIM));
  ok(groups.size === 5, `five poses over the instruments (${[...groups].sort().join(', ')})`);
  ok(!groups.has('music_6'), 'and never the sixth branch, which is the shrug and has no flourishes at all');
  ok(animFor('kloo_horn') === animFor('kloo_horn_hue'), 'a colour variant is played the same way, being the same instrument');
  ok(animFor('kloo_horn') !== animFor('mandoviol'), 'a horn and a stringed thing are not');
  ok(animFor('not_an_instrument') === null, 'and something that is not an instrument has no pose');
}

{
  // The clips really are in the rigs, and have been since they were first converted -- nothing
  // needed converting again for this, only something asking for them.
  const dir = join('assets-private', 'characters');
  const species = existsSync(dir) ? readdirSync(dir).filter((s) => existsSync(join(dir, s, 'parts.json'))) : [];
  if (!species.length) note('no species packs here, so the poses are not checked against a real rig');
  else {
    let worst = '';
    let missing = 0;
    for (const s of species) {
      const raw = readFileSync(join(dir, s, 'parts.json'), 'utf8');
      for (const group of new Set(Object.values(MUSIC_ANIM))) {
        const loop = `loop_skill:speed2:${group}`;
        if (!raw.includes(`"${loop}"`)) {
          missing++;
          worst = `${s} has no ${loop}`;
        }
      }
    }
    ok(!missing, `every pose an instrument needs is in all ${species.length} species rigs${worst ? ` (${worst})` : ''}`);
  }
}

// -------------------------------------------- the two halves meeting, over the real weapons pack
//
// The converter is the one place that decides which instrument plays what, and the game looks a
// stem up by the instrument's **own id** with no normalising of its own -- so if the pack ever
// carries an id the table cannot place, an instrument is held and plays silence with nothing to
// say why. There are fourteen instruments behind the archives' 28 templates (a plain one and a
// `_hue` one for most, and an `instrument_` prefix on two), and this is what proves the table
// covers every spelling of them that a real pack hands over.
{
  const weaponsFile = join('assets-private', 'weapons', 'manifest.json');
  const musicFile = join('assets-private', 'music', 'music.json');
  if (!existsSync(weaponsFile)) {
    note('no weapons pack here, so the join is not checked (npm run swg -- weapons @SWG assets-private --retail-only)');
  } else {
    const w = JSON.parse(readFileSync(weaponsFile, 'utf8')) as { weapons: { id: string; class: string }[] };
    const held = w.weapons.filter((e) => e.class === 'instrument').map((e) => e.id);
    if (!held.length) {
      note('the weapons pack carries no instrument: it wants converting again, which is what puts them on the rack');
    } else if (!existsSync(musicFile)) {
      note('no music pack here, so the join is not checked');
    } else {
      // Read out of the **converted pack**, which is what the game reads, rather than worked out
      // again here: the mapping comes off the game's own performance table now, and the table is in
      // the archives rather than in this file, so re-deriving it would need an archive mount and
      // would be a second opinion besides.
      const p = JSON.parse(readFileSync(musicFile, 'utf8')) as MusicPack;
      const missing = held.filter((id) => !stemFor(id, p));
      ok(!missing.length, `every one of the ${held.length} instruments the weapons pack carries is placed on a track (${new Set(held.map((id) => stemFor(id, p))).size} of the six stems used)`);
      if (missing.length) note(`the music pack was written before these arrived: ${missing.slice(0, 6).join(', ')} — run the music command again after the weapons one`);
      // And the one instrument the table splits by song really is split in the pack, or ten of the
      // twenty songs are refused to whoever holds it.
      const split = held.filter((id) => typeof p.instruments[id] === 'object');
      note(split.length ? `${split.join(', ')} play a different part on some songs, which the table says and the pack keeps` : 'no instrument in this pack changes its part by song: an old pack, or a table that no longer says so');
      for (const id of held) ok(songsFor(id, p).length > 0, `a ${id} has a part in at least one song (${songsFor(id, p).length} of ${p.songs.length})`);
    }
  }
}

console.log(`\n${passed} checks passed`);
