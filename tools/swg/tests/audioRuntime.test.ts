// The sound runtime without a browser: how loud a sound is at a distance and how far it carries,
// one of the game's sound templates played out on a seeded random (delays, loops, gaps, the play
// order, pitch as a rate, the drifting volumes), which voice gives way when the pool is full, the
// four-times-a-second grid every looping sound sits in, the WAV reader, the bank's memory sweep,
// the interface table's wiring, and the two rules that cost the most if they are ever broken: a
// template runs on the audio clock alone, and nothing is started while the game is advanced.
//
// Nothing here makes an AudioContext: a driven tab can hear nothing, so every check reads numbers.
import assert from 'node:assert/strict';
import { DISTANCE_TUNE, audibleRadius, flatGainAt, flatRadius, fullRadius, gainAt, muffleShare } from '../../../src/audio/distance.ts';
import { Drift, TemplateRun, endless, makeStart, rateOf, seededRng, type SoundTemplate, type Variation } from '../../../src/audio/template.ts';
import { VOICE_TUNE, VoiceBudget, keySource, outranks } from '../../../src/audio/voices.ts';
import { EmitterGrid } from '../../../src/audio/emitters.ts';
import { SoundBank, planEviction, type SoundIndex } from '../../../src/audio/bank.ts';
import { isSilentPcm, parseWav } from '../../../src/audio/wavWorker.ts';
import { UI_NO_CALLER, UI_ROWS, UI_THROTTLE, UiSounds, type UiAction } from '../../../src/audio/uiSounds.ts';
import { AudioSystem, GROUP_OF_CATEGORY, SOUND_GROUPS, type AudioSettings } from '../../../src/audio/audio.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const plain = (over: Partial<SoundTemplate> = {}): SoundTemplate => ({
  dim: 3,
  samples: ['sample/a.wav'],
  delay: [0, 0],
  fadeIn: [0, 0],
  loops: [1, 1],
  gap: [0, 0],
  fadeOut: [0, 0],
  category: 7,
  order: 0,
  gapMode: 0,
  fadeModes: [0, 0],
  volume: { mode: 0, range: [1, 1], period: 0, glide: 0 },
  pitch: { mode: 0, range: [0, 0], period: 0, glide: 0 },
  priority: 3,
  full: 15,
  ...over,
});

const noVariation = (value: number): Variation => ({ mode: 0, range: [value, value], period: 0, glide: 0 });

// ---- distance: the one number the game gives, and everything past it that is ours ----
{
  const t = DISTANCE_TUNE;
  ok(near(gainAt(0, 12, t), 1) && near(gainAt(12, 12, t), 1), 'a sound is at full volume anywhere inside its own radius');
  ok(near(gainAt(24, 12, t), 0.5) && near(gainAt(48, 12, t), 0.25), 'past it, loudness is the radius over the distance');
  ok(gainAt(119, 12, t) > 0 && near(gainAt(120, 12, t), 0), 'and it is gone at ten times the radius');
  ok(gainAt(110, 12, t) < 12 / 110, 'the last fifth of the way out fades, so nothing is cut off mid-sound');
  ok(near(audibleRadius(12, t), 120) && near(fullRadius(12, t), 12), 'the radii read back');
  // A footstep (4 m), a creature (12 m), the biggest ship engine (54 m) and the largest explosion.
  ok(near(audibleRadius(4, t), 40) && near(audibleRadius(54, t), 540) && near(audibleRadius(256, t), 2560), 'a footstep carries 40 m, a big engine 540 m and the biggest explosion 2.5 km');
  // A non-positional emitter: its own radius with a floor, then a smooth fall to four times it.
  ok(near(flatRadius(0.1, t), 8) && near(flatGainAt(1.9, 0.1, t), 1) && near(flatGainAt(8, 0.1, t), 0), 'a 2D emitter with a tiny radius is floored at 2 m and gone at four times that');
  ok(flatGainAt(5, 8, t) === 1 && flatGainAt(20, 8, t) > 0 && near(flatGainAt(32, 8, t), 0), 'and one with a real radius is full inside it and gone at four times it');
  ok(muffleShare({ building: -1, cell: -1 }, { building: -1, cell: -1 }) === 0 && muffleShare({ building: 3, cell: 1 }, { building: -1, cell: -1 }) === 1 && muffleShare({ building: -1, cell: -1 }, { building: 3, cell: 2 }) === 1, 'a voice is muffled when it and the ear are not in the same building, either way round');
  ok(muffleShare({ building: 3, cell: 1 }, { building: 3, cell: 7 }) === 0, 'two rooms of one building are not muffled from each other');
}

// ---- the template, played out on a seeded random ----
{
  const start = makeStart();
  // A one-shot: one loop, at the time it was started, and then nothing.
  const run = new TemplateRun(plain(), seededRng(7), 100);
  ok(near(run.begin, 100) && !run.loops, 'a one-shot begins at the time it is given and does not loop');
  ok(run.nextDue(100, start) && near(start.at, 100) && start.index === 0, 'its one loop is due at that time');
  run.began(1.5);
  ok(run.finished && !run.nextDue(1000, start), 'and nothing follows it');

  // Delays are drawn, and the run never reads a clock of its own: the same seed and the same time
  // give the same answer, and a different time only moves it.
  const a = new TemplateRun(plain({ delay: [0, 0.3] }), seededRng(11), 0);
  const b = new TemplateRun(plain({ delay: [0, 0.3] }), seededRng(11), 500);
  ok(a.begin > 0 && a.begin < 0.3 && near(b.begin - 500, a.begin), 'a drawn delay is the same for one seed, and the time handed in is the only clock');

  ok(endless(-1) && endless(99) && endless(120) && !endless(1) && !endless(4), 'a loop count below zero, or 99 and up, is for ever');
  const bed = new TemplateRun(plain({ loops: [-1, -1], gap: [2, 2] }), seededRng(3), 0);
  ok(bed.loops && bed.dueAt === 0, 'a bed loops for ever and its first loop is due at once');
  bed.nextDue(0, start);
  bed.began(4);
  ok(near(bed.dueAt, 6), 'the next loop is due after the sound and its gap');
  // 13 seconds into a 4 second sound with a 2 second gap: one second into its fifth time round.
  ok(near(bed.offsetInto(13, 4), 1), 'a bed that waited as a virtual voice comes in where its own clock has reached');
}

// The converter leaves out every part of a template that is all zero, which is most of most of
// them: an entry with only the five fields the pack always writes must play as a plain one-shot.
{
  const start = makeStart();
  const bare = { dim: 3, samples: ['sample/a.wav'], category: 7, priority: 3, full: 15 } as SoundTemplate;
  const run = new TemplateRun(bare, seededRng(1), 50);
  ok(near(run.begin, 50) && !run.loops && run.total === 1, 'a template written with nothing but its five always-present fields is a single play with no delay');
  ok(run.nextDue(50, start) && near(start.at, 50) && near(start.gain, 1) && near(start.rate, 1) && start.fadeIn === 0, 'and it plays once at full volume, unshifted and without a fade');
  run.began(1);
  ok(run.finished, 'and then it is done');
  // Only the parts that are not zero come through, so a half-written entry must read the same way.
  const half = { dim: 2, samples: ['sample/a.wav', 'sample/b.wav'], category: 0, priority: 2, full: 4, loops: [-1, -1] as [number, number], gap: [3, 3] as [number, number] } as SoundTemplate;
  const bed = new TemplateRun(half, seededRng(1), 0);
  bed.nextDue(0, start);
  bed.began(2);
  ok(bed.loops && near(bed.dueAt, 5), 'a bed given only its loop count and gap still comes round on them');
}

// The gap mode: 2 draws the gap again for every loop, which is what makes the random one-shot beds
// come round unevenly; anything else keeps the one it drew.
{
  const start = makeStart();
  const gaps = (gapMode: number) => {
    const run = new TemplateRun(plain({ loops: [-1, -1], gap: [15, 30], gapMode }), seededRng(5), 0);
    const out: number[] = [];
    let at = 0;
    for (let i = 0; i < 4; i++) {
      run.nextDue(at, start);
      run.began(1);
      out.push(run.dueAt - start.at - 1);
      at = run.dueAt;
    }
    return out;
  };
  const same = gaps(0);
  const drawn = gaps(2);
  ok(same.every((g) => near(g, same[0])) && same[0] >= 15 && same[0] <= 30, 'gap mode 0 keeps the one gap it drew');
  ok(new Set(drawn.map((g) => g.toFixed(4))).size > 1 && drawn.every((g) => g >= 15 && g <= 30), 'gap mode 2 draws a new one every loop, inside the range');
}

// The play order, pitch as a rate, and the volume modes.
{
  const start = makeStart();
  const samples = ['sample/1.wav', 'sample/2.wav', 'sample/3.wav'];
  const picks = (order: number, n: number) => {
    const run = new TemplateRun(plain({ samples, order, loops: [-1, -1] }), seededRng(21), 0);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      run.nextDue(run.dueAt, start);
      run.began(1);
      out.push(start.sample);
    }
    return out;
  };
  ok(picks(2, 7).join('') === '0120120', 'play order 2 runs the samples in order and starts again');
  const noRepeat = picks(1, 40);
  ok(noRepeat.every((s, i) => i === 0 || s !== noRepeat[i - 1]) && new Set(noRepeat).size === 3, 'play order 1 never plays the same sample twice running, and reaches them all');
  ok(picks(0, 40).every((s) => s >= 0 && s < 3), 'play order 0 stays inside the samples');

  ok(near(rateOf(0), 1) && near(rateOf(12), 2) && near(rateOf(-12), 0.5), 'a pitch shift in semitones becomes a playback rate');
  const low = new TemplateRun(plain({ pitch: { mode: 1, range: [-10, -8], period: 0, glide: 0 } }), seededRng(9), 0);
  low.nextDue(0, start);
  ok(start.rate > rateOf(-10.001) && start.rate < rateOf(-7.999), 'the pitch a template draws is what the voice plays at, which is how one creature sounds bigger than another on the same samples');

  // Mode 2 draws again for every play; mode 0 never varies.
  const varying = new TemplateRun(plain({ loops: [-1, -1], volume: { mode: 2, range: [0.75, 1], period: 0, glide: 0 } }), seededRng(4), 0);
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) {
    varying.nextDue(varying.dueAt, start);
    varying.began(1);
    seen.add(start.gain.toFixed(4));
    ok(start.gain >= 0.75 && start.gain <= 1, `volume mode 2 draws inside its range (${start.gain.toFixed(3)})`);
  }
  ok(seen.size > 1, 'and draws a different one each play');
  const steady = new TemplateRun(plain({ loops: [-1, -1], volume: noVariation(0.85) }), seededRng(4), 0);
  steady.nextDue(0, start);
  ok(near(start.gain, 0.85), 'volume mode 0 plays the one value the template carries');
}

// Mode 3: a value that drifts to a new draw every period, over the glide, and then holds.
{
  const d = new Drift([0.2, 0.8], 2, 1, seededRng(31), 0);
  const first = d.at(0);
  const arrived = d.at(1);
  ok(first >= 0.2 && first <= 0.8 && arrived >= 0.2 && arrived <= 0.8, 'a drifting value stays inside its range');
  ok(near(d.at(1.5), arrived) && near(d.at(1.99), arrived), 'once the glide is over it holds exactly where it was drawn');
  ok(!near(d.at(3), arrived, 1e-9), 'and the next period drifts it somewhere else');
  ok(near(d.at(1.5), arrived), 'asking for a time already passed gives the same answer, so nothing jitters');
  // A tab away for an hour must not walk thousands of draws to catch up.
  const t0 = Date.now();
  const far = new Drift([0, 1], 0.05, 0.01, seededRng(2), 0);
  const value = far.at(3600);
  ok(value >= 0 && value <= 1 && Date.now() - t0 < 200, 'and coming back after an hour is immediate');
}

// ---- which voice gives way ----
{
  ok(outranks(0, 0.1, 3, 1) && !outranks(3, 1, 0, 0.1), 'priority wins over loudness');
  ok(outranks(5, 0.9, 5, 0.2) && !outranks(5, 0.2, 5, 0.9), 'at the same priority the louder one wins');

  const budget = new VoiceBudget({ positional: 3, flat: 2, ui: 2 });
  const keys = keySource();
  const k = [keys(), keys(), keys(), keys(), keys()];
  for (let i = 0; i < 3; i++) ok(budget.request({ key: k[i], priority: 5, gain: 0.5, pool: 'positional' }).slot === i, `a free positional slot is taken (${i})`);
  ok(budget.request({ key: k[3], priority: 5, gain: 0.5, pool: 'positional' }).slot < 0, 'an equal newcomer is refused when the pool is full');
  const louder = budget.request({ key: k[3], priority: 5, gain: 0.9, pool: 'positional' });
  ok(louder.slot >= 0 && louder.stolen === k[0], 'a louder one of the same priority takes the quietest voice');
  const urgent = budget.request({ key: k[4], priority: 0, gain: 0.01, pool: 'positional' });
  ok(urgent.slot >= 0 && urgent.stolen !== 0, 'and a higher priority takes a slot however quiet it is');
  ok(!budget.has(urgent.stolen) && budget.has(k[4]), 'whoever gave way no longer holds one');
  // The interface never competes with the world.
  const ui = [keys(), keys()];
  ok(budget.request({ key: ui[0], priority: 0, gain: 1, pool: 'ui' }).slot === 0 && budget.request({ key: ui[1], priority: 0, gain: 1, pool: 'ui' }).slot === 1, 'the interface has slots of its own');
  ok(budget.status().positional === 3 && budget.status().ui === 2, 'and the pools are counted apart');
  const again = budget.request({ key: k[4], priority: 0, gain: 0.5, pool: 'positional' });
  ok(again.slot === budget.slot(k[4]) && again.stolen === 0, 'asking again for a slot already held keeps it and only refreshes the rank');
  budget.release(k[4]);
  ok(!budget.has(k[4]) && budget.status().positional === 2, 'and releasing gives it back');
  // The interface must have slots however busy the world is, and the world must have more voices
  // than anything the game puts in one place; a grant must also allocate nothing.
  const sized = new VoiceBudget(VOICE_TUNE);
  ok(VOICE_TUNE.ui > 0 && VOICE_TUNE.positional > VOICE_TUNE.flat && VOICE_TUNE.positional >= 32, 'the world has far more positional slots than flat ones, and the interface always has its own');
  const many = keySource();
  const held: number[] = [];
  for (let i = 0; i < VOICE_TUNE.positional; i++) {
    const key = many();
    held.push(key);
    sized.request({ key, priority: 5, gain: 0.5, pool: 'positional' });
  }
  ok(sized.status().positional === VOICE_TUNE.positional && sized.request({ key: many(), priority: 0, gain: 1, pool: 'ui' }).slot === 0, 'a world full of voices still leaves the interface its own');
  ok(sized.slot(held[7]) === 7 && sized.poolOf(held[7]) === 'positional', 'a key reads back its pool and slot from the one integer they are packed into');
}

// ---- the grid every looping sound sits in ----
{
  const grid = new EmitterGrid({ cell: 128, far: 384, rate: 4 }, DISTANCE_TUNE);
  const outside = { building: -1, cell: -1 };
  // A bed 30 m away (full 12 m, so heard to 120 m), one 300 m away, and a big one 2 km away.
  grid.add(1, 'sound/near.snd', 30, 0, 0, 12, false, outside);
  grid.add(2, 'sound/mid.snd', 300, 0, 0, 12, false, outside);
  grid.add(3, 'sound/huge.snd', 2000, 0, 0, 256, false, outside);
  ok(!grid.step(0.1, 0, 0, 0) && !grid.step(0.1, 0, 0, 0), 'the grid is not walked every frame');
  ok(grid.step(0.1, 0, 0, 0), 'it runs four times a second');
  ok(grid.near.includes(1) && !grid.near.includes(2), 'a source within earshot is found and one past it is not');
  ok(grid.near.includes(3), 'a source that carries far is found however far the grid reaches, because it is kept apart from it');
  ok(grid.status().far === 1 && grid.status().sources === 3, 'and the report says how many are kept that way');
  grid.setActive(1, false);
  grid.step(0.25, 0, 0, 0);
  ok(!grid.near.includes(1), 'a source switched off is not heard');
  grid.setActive(1, true);
  grid.move(2, 20, 0, 0);
  grid.step(0.25, 0, 0, 0);
  ok(grid.near.includes(2) && grid.near.includes(1), 'one that moves nearer is found in its new cell');
  grid.remove(2);
  grid.step(0.25, 0, 0, 0);
  ok(!grid.near.includes(2) && grid.size === 2, 'and one removed is gone');
  // Cells wrap at 1024, which is 131 km with 128 m cells, so a planet never collides with itself;
  // a collision would only cost an extra distance test, which this shows.
  grid.add(4, 'sound/far.snd', -30, 0, 0, 12, false, outside);
  grid.step(0.25, 0, 0, 0);
  ok(grid.near.includes(4), 'a source at a negative coordinate is filed and found');
}

// ---- the bank: the memory sweep, and working with nothing converted ----
{
  const rows = [
    { sample: 'a', bytes: 40, touched: 1, playing: 0, ready: true },
    { sample: 'b', bytes: 40, touched: 5, playing: 0, ready: true },
    { sample: 'c', bytes: 40, touched: 2, playing: 1, ready: true },
    { sample: 'd', bytes: 40, touched: 0, playing: 0, ready: false },
  ];
  ok(planEviction(rows, 160, 200).length === 0, 'nothing is given back while the budget is met');
  ok(planEviction(rows, 160, 100).join() === 'a,b', 'the least recently used go first, until the budget is met');
  ok(!planEviction(rows, 160, 0).includes('c') && !planEviction(rows, 160, 0).includes('d'), 'a sample a voice is playing, and one still arriving, are never taken');

  const empty = new SoundBank('');
  ok(!empty.available && empty.template('sound/x.snd') === null && empty.templateCount === 0, 'with nothing converted the bank holds nothing and refuses every lookup');
  const index: SoundIndex = { format: 1, templates: { 'sound/x.snd': plain(), 'sound/gone.snd': plain({ silent: true, samples: [] }) }, missing: ['sample/gone.wav'] };
  const bank = new SoundBank('');
  bank.adopt(index);
  ok(bank.available && bank.templateCount === 2 && bank.template('sound/x.snd')?.full === 15, 'an index makes its templates readable');
  ok(bank.template('sound/gone.snd')?.silent === true, 'a template with no usable sample is kept and marked, so a lookup never throws');
  const before = bank.status().counts as { asked: number };
  bank.prepare(['sound/x.snd', 'sound/gone.snd']);
  const after = bank.status().counts as { asked: number };
  ok(after.asked === before.asked + 1, 'preparing asks for the samples of a template that has them and nothing for one that has none');

  // The index carries every sample's length, so a bed's next loop is armed before anything decodes.
  const timed = new SoundBank('');
  timed.adopt({ format: 1, templates: { 'sound/x.snd': plain() }, samples: { 'sample/a.wav': { bytes: 88200, rate: 22050, channels: 1, seconds: 2 } }, missing: ['sample/none.wav'], unreadable: [{ sample: 'sample/zero.wav', why: 'zero-filled' }] });
  ok(near(timed.length('sample/a.wav'), 2) && timed.length('sample/never.wav') === 0, 'a sample\'s length is known from the index, before a byte of it is fetched');
  const counts = timed.status().samples as { failed: number };
  ok(counts.failed === 2, 'a sample the archives do not hold, and one that cannot be read, are marked failed at once and never asked for');
}

// ---- the WAV reader ----
{
  const wav = (channels: number, rate: number, frames: number, fill: (i: number, c: number) => number, loop?: [number, number], format = 1, bits = 16) => {
    const dataBytes = frames * channels * 2;
    const smpl = loop ? 8 + 60 : 0;
    const size = 12 + 8 + 16 + 8 + dataBytes + smpl;
    const buf = new ArrayBuffer(size);
    const v = new DataView(buf);
    const put = (at: number, s: string) => {
      for (let i = 0; i < 4; i++) v.setUint8(at + i, s.charCodeAt(i));
    };
    put(0, 'RIFF');
    v.setUint32(4, size - 8, true);
    put(8, 'WAVE');
    put(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, format, true);
    v.setUint16(22, channels, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * channels * 2, true);
    v.setUint16(32, channels * 2, true);
    v.setUint16(34, bits, true);
    put(36, 'data');
    v.setUint32(40, dataBytes, true);
    for (let f = 0; f < frames; f++) for (let c = 0; c < channels; c++) v.setInt16(44 + (f * channels + c) * 2, fill(f, c), true);
    if (loop) {
      const at = 44 + dataBytes;
      put(at, 'smpl');
      v.setUint32(at + 4, 60, true);
      v.setUint32(at + 8 + 28, 1, true);
      v.setUint32(at + 8 + 36 + 8, loop[0], true);
      v.setUint32(at + 8 + 36 + 12, loop[1], true);
    }
    return buf;
  };

  const mono = parseWav(wav(1, 22050, 8, (i) => (i - 4) * 4096))!;
  ok(mono !== null && mono.sampleRate === 22050 && mono.channels.length === 1 && mono.frames === 8, 'a 16-bit mono file reads back with its own rate, which is what keeps it small');
  ok(near(mono.channels[0][0], -16384 / 32768, 1e-6) && near(mono.channels[0][5], 4096 / 32768, 1e-6), 'and its samples come out as they went in');
  const stereo = parseWav(wav(2, 44100, 4, (i, c) => (c ? 1000 : -1000)))!;
  ok(stereo.channels.length === 2 && stereo.channels[0][0] < 0 && stereo.channels[1][0] > 0, 'a stereo file keeps its channels apart');
  const part = parseWav(wav(1, 22050, 100, () => 1000, [20, 60]))!;
  ok(part.loop !== null && part.loop![0] === 20 && part.loop![1] === 60, 'a file that loops part of itself keeps its points');
  const whole = parseWav(wav(1, 22050, 100, () => 1000, [0, 99]))!;
  ok(whole.loop === null, 'and one whose points cover the whole sound needs none: it simply repeats');
  ok(parseWav(wav(1, 22050, 4, () => 0, undefined, 3, 32)) === null, 'anything that is not 16-bit PCM is handed back to the browser instead');
  ok(parseWav(new ArrayBuffer(8)) === null, 'and a file too short to be one reads as nothing');
  ok(isSilentPcm(parseWav(wav(1, 22050, 8, () => 0))!) && !isSilentPcm(mono), 'a zero-filled sample is recognised, since fifteen of the archives\' are');
}

// ---- the interface table ----
{
  let now = 0;
  const started: string[] = [];
  const ui = new UiSounds(() => now, (id) => (started.push(id), true));
  ok(!ui.ready && !ui.play('confirm') && ui.counts.unresolved === 1, 'with no table every interface action is silent and says so');
  // The table's own row names, read from the game's archives.
  ui.attach({ backpack_open: 'sound/ui_backpack_open.snd', backpack_close: 'sound/ui_backpack_close.snd', button_confirm: 'sound/ui_button_confirm.snd', rollover: 'sound/ui_rollover.snd', select: 'sound/ui_select.snd' });
  ok(ui.ready && ui.play('confirm') && started[0] === 'sound/ui_button_confirm.snd', 'with it, an action plays the row it names');
  ok(ui.soundFor('panelOpen') === 'sound/ui_backpack_open.snd' && ui.soundFor('negative') === null, 'a row the table has resolves and one it does not stays silent');
  ok(ui.play('rollover') && !ui.play('rollover') && ui.counts.throttled === 1, 'a hover cannot chatter');
  now += UI_THROTTLE.rollover! + 0.001;
  ok(ui.play('rollover'), 'and plays again once the gap has passed');
  const report = ui.report();
  ok(report.length === Object.keys(UI_ROWS).length && report.every((r) => typeof r.row === 'string'), 'every action is reported with the row it takes, which is how the wiring is checked headless');
  const rows = new Set(Object.values(UI_ROWS));
  ok(rows.size === Object.keys(UI_ROWS).length, 'and no two actions share a row of the table');
  // An action nothing in the game plays yet must not read as wired just because it has a row.
  ok(report.every((r) => r.wired === !UI_NO_CALLER.includes(r.action)) && report.some((r) => !r.wired), 'and an action nothing plays yet says so, rather than reading as hooked up');
  ok(report.find((r) => r.action === 'confirm')!.played === 1 && report.find((r) => r.action === 'select')!.played === 0, 'the report counts what each action has actually played');

  // The game's own table points more than one row at one sound: `radial_create` is `ui_rollover`,
  // the sample a list hover uses. The throttle must follow the sound, not the action, or the wheel
  // and a hover play the same click twice in a frame.
  let t2 = 0;
  const twice: string[] = [];
  const shared = new UiSounds(() => t2, (id) => (twice.push(id), true));
  shared.attach({ rollover: 'sound/ui_rollover.snd', radial_create: 'sound/ui_rollover.snd' });
  ok(shared.soundFor('rollover') === shared.soundFor('wheelOpen'), 'two actions really do resolve to one sound, as the game\'s table has them');
  ok(shared.play('rollover') && !shared.play('wheelOpen') && twice.length === 1, 'and the second is throttled, because the gap is kept per sound');
  t2 += 1;
  ok(shared.play('wheelOpen') && twice.length === 2, 'once the gap has passed either of them plays again');
}

// ---- the mixer: the layers, and the two rules ----
{
  // Every category a converted template can carry must land on a layer, or a sound would answer to
  // no slider at all.
  ok([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13].every((c) => SOUND_GROUPS.includes(GROUP_OF_CATEGORY[c])), 'every sound category the game uses lands on a layer the menu has');
  ok(GROUP_OF_CATEGORY[0] === 'ambience' && GROUP_OF_CATEGORY[3] === 'footsteps' && GROUP_OF_CATEGORY[4] === 'interface' && GROUP_OF_CATEGORY[5] === 'vehicles' && GROUP_OF_CATEGORY[6] === 'voices' && GROUP_OF_CATEGORY[7] === 'effects', 'and the ones the sliders are named for land where they say');
  ok(GROUP_OF_CATEGORY[8] === 'music' && GROUP_OF_CATEGORY[9] === 'music' && GROUP_OF_CATEGORY[13] === 'voices', 'music stays on its own bus and the spoken lines go with the voices');
  ok(new Set(GROUP_OF_CATEGORY).size === SOUND_GROUPS.length, 'every layer is used by something');

  const settings: AudioSettings = { soundMaster: 0.8, soundAmbience: 1, soundEffects: 1, soundVoices: 1, soundFootsteps: 1, soundVehicles: 1, soundInterface: 0.7, soundMusic: 1, soundHeadphones: false, soundRoomEcho: true, soundInBackground: false, soundSabers: 'jka' };
  const audio = new AudioSystem('', settings);
  audio.install();
  ok(audio.state === 'none', 'with no Web Audio at all the mixer still builds, so nothing else has to know');
  ok(audio.play('sound/x.snd') === 0 && (audio.status().counts as { refusedNoTemplate: number }).refusedNoTemplate === 1, 'asking for a sound with no pack refuses and counts it');
  ok((audio.status().recent as { result: string }[])[0].result === 'no sound pack', 'and says why, which is the first thing to read when nothing sounds');

  audio.bank.adopt({ format: 1, templates: { 'sound/cr_x_vocalize.snd': plain({ category: 6, priority: 5 }), 'sound/amb_x_lp.snd': plain({ category: 0, dim: 2, loops: [-1, -1] }) }, missing: [] });
  const key = audio.play('sound/cr_x_vocalize.snd', { x: 1, y: 2, z: 3 });
  ok(key > 0 && audio.isPlaying(key), 'with the pack in, a sound is taken up');
  const voice = (audio.status().voices as Record<string, unknown>[])[0];
  ok(voice.group === 'voices' && voice.slot === -1 && voice.virtual === true, 'and is listed with its layer, waiting for a voice until the context runs');
  audio.stop(key);
  audio.update(1 / 60, { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, space: { building: -1, cell: -1 } });
  ok(!audio.isPlaying(key), 'stopping it lets it go');

  // The rule that a driven tab must never burst: ten simulated seconds start nothing.
  audio.advancing = true;
  const before = (audio.status().counts as { recorded: number }).recorded;
  ok(audio.play('sound/cr_x_vocalize.snd', { x: 0, y: 0, z: 0 }) === 0, 'nothing is started while the game is advanced');
  ok((audio.status().counts as { recorded: number }).recorded === before + 1 && (audio.status().voiceCount as number) === 0, 'the event is recorded instead, and no voice is left behind');
  audio.advancing = false;

  // Keys are never 0, so "nobody" can be kept as a falsy number.
  const k1 = audio.play('sound/amb_x_lp.snd');
  const k2 = audio.play('sound/amb_x_lp.snd');
  ok(k1 > 0 && k2 > 0 && k1 !== k2, 'every voice gets a key of its own and none is ever 0');
  audio.stopAll();
  ok((audio.status().voiceCount as number) === 0, 'and everything can be let go at once, for a travel or a switch of character');

  // Music the converter keeps because a scene plays it (the hyperspace stages) is the ship's own
  // noise, not a score: it must answer to a slider the player has.
  audio.bank.adopt({ format: 1, templates: { 'sound/scene.snd': plain({ category: 8, keptMusic: 'scene' }), 'sound/band.snd': plain({ category: 8, placedMusic: true }), 'sound/score.snd': plain({ category: 8 }) } });
  const groupOf = (id: string) => {
    audio.play(id, { x: 0, y: 0, z: 0 });
    const voices = audio.status().voices as Record<string, unknown>[];
    const g = voices[voices.length - 1].group;
    audio.stopAll();
    return g;
  };
  ok(groupOf('sound/scene.snd') === 'effects', 'a sound kept from a scene plays on the effects slider, not the music bus the player cannot reach');
  ok(groupOf('sound/band.snd') === 'ambience' && groupOf('sound/score.snd') === 'music', 'a band the game places in the world is ambience, and the score itself stays on its own bus');
}

// ---- a one-shot that never gets a source must still be let go ----
{
  const settings: AudioSettings = { soundMaster: 1, soundAmbience: 1, soundEffects: 1, soundVoices: 1, soundFootsteps: 1, soundVehicles: 1, soundInterface: 1, soundMusic: 1, soundHeadphones: false, soundRoomEcho: false, soundInBackground: false, soundSabers: 'jka' };
  const audio = new AudioSystem('', settings);
  audio.install();
  audio.bank.adopt({ format: 1, templates: { 'sound/one.snd': plain() }, samples: { 'sample/a.wav': { bytes: 44100, seconds: 1 } } });
  const pose = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, space: { building: -1, cell: -1 } };
  for (let i = 0; i < 20; i++) audio.play('sound/one.snd', { x: 0, y: 0, z: 0 });
  for (let i = 0; i < 120; i++) audio.update(1 / 60, pose);
  const counts = audio.status().counts as { started: number };
  ok((audio.status().voiceCount as number) === 0 && counts.started === 0, 'twenty sounds asked for before anyone has clicked start nothing and leave no record behind, so neither the frame nor the report carries them');
  // The same for a run whose clock is kept from the index: the bed must still be armed for later.
  const bed = audio.play('sound/one.snd', { loop: true, x: 0, y: 0, z: 0 });
  for (let i = 0; i < 10; i++) audio.update(1 / 60, pose);
  ok(audio.isPlaying(bed), 'a loop, though, keeps its record and its clock, waiting for the first click');
}

// ---- the grid's pass is what looks at a looping sound, not the frame ----
{
  const settings: AudioSettings = { soundMaster: 1, soundAmbience: 1, soundEffects: 1, soundVoices: 1, soundFootsteps: 1, soundVehicles: 1, soundInterface: 1, soundMusic: 1, soundHeadphones: false, soundRoomEcho: false, soundInBackground: false, soundSabers: 'jka' };
  const audio = new AudioSystem('', settings);
  audio.install();
  audio.bank.adopt({ format: 1, templates: { 'sound/bed.snd': plain({ loops: [-1, -1], full: 12 }) } });
  const at = (x: number) => ({ x, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, space: { building: -1, cell: -1 } });
  audio.loop('sound/bed.snd', { x: 0, y: 0, z: 0 });
  const gain = () => (audio.status().voices as Record<string, unknown>[])[0].gain as number;
  const tested = () => (audio.grid.status() as { tested: number }).tested;
  audio.update(0.3, at(1000));
  ok(gain() === 0 && (audio.status().griddedVoices as number) === 1, 'a bed out of earshot is found by the pass and is silent');
  const was = tested();
  for (let i = 0; i < 10; i++) audio.update(1 / 60, at(0));
  ok(tested() === was && gain() === 0, 'walking up to it between two passes changes nothing: a grid-backed loop is not distance-tested every frame');
  audio.update(0.3, at(0));
  ok(tested() > was && gain() === 1, 'and the next pass finds it and gives it its gain');
  ok((audio.status().counts as { distanceTests: number }).distanceTests === 0, 'nothing in the mixer measured a distance of its own for it: the pass did');
}

// ---- the bank: a half-filled buffer, and a pack from an older converter ----
{
  const bank = new SoundBank('');
  bank.adopt({ format: 0, templates: { 'sound/x.snd': plain() } });
  ok(!bank.available && /older converter/.test(bank.why), 'a pack from an older converter is refused outright and says which command mends it');
  bank.adopt({ format: 1, templates: { 'sound/x.snd': plain() } });
  ok(bank.available && bank.templateCount === 1, 'and one this game reads is taken');
  ok(bank.buffer('sample/a.wav') === null, 'a sample that has not arrived reads as nothing');
}

// ---- the graph itself ----
//
// The mixer builds its nodes through `installOffline`, which the browser's self test points at an
// OfflineAudioContext. Here it is pointed at a context of the test's own, which records what was
// made, what was connected to what and every value written: a driven tab can hear nothing, so this
// is the only way the slot pool, the layer joins, the panner, the muffled branch and the gains a
// voice is actually started at are checked at all.
{
  const made: FakeNode[] = [];
  class FakeParam {
    value: number;
    writes = 0;
    constructor(v: number) {
      this.value = v;
    }
    setValueAtTime(v: number) {
      this.value = v;
      this.writes++;
      return this;
    }
    setTargetAtTime(v: number) {
      this.value = v;
      this.writes++;
      return this;
    }
    linearRampToValueAtTime(v: number) {
      this.value = v;
      this.writes++;
      return this;
    }
    cancelScheduledValues() {
      return this;
    }
  }
  class FakeNode {
    readonly kind: string;
    readonly outputs: FakeNode[] = [];
    constructor(kind: string) {
      this.kind = kind;
      made.push(this);
    }
    connect(to: FakeNode) {
      this.outputs.push(to);
      return to;
    }
    disconnect(to?: FakeNode) {
      if (!to) this.outputs.length = 0;
      else {
        const i = this.outputs.indexOf(to);
        if (i >= 0) this.outputs.splice(i, 1);
      }
    }
  }
  class FakeGain extends FakeNode {
    readonly gain = new FakeParam(1);
    constructor() {
      super('gain');
    }
  }
  class FakePanner extends FakeNode {
    panningModel = 'equalpower';
    distanceModel = 'inverse';
    refDistance = 1;
    rolloffFactor = 1;
    readonly positionX = new FakeParam(0);
    readonly positionY = new FakeParam(0);
    readonly positionZ = new FakeParam(0);
    constructor() {
      super('panner');
    }
  }
  class FakeSource extends FakeNode {
    buffer: unknown = null;
    readonly playbackRate = new FakeParam(1);
    onended: (() => void) | null = null;
    started: { at: number; offset: number } | null = null;
    stopped = false;
    constructor() {
      super('source');
    }
    start(at = 0, offset = 0) {
      this.started = { at, offset };
    }
    stop() {
      this.stopped = true;
    }
  }
  const buffer = (channels: number, frames: number, rate: number) => ({
    numberOfChannels: channels,
    length: frames,
    sampleRate: rate,
    duration: frames / rate,
    getChannelData: () => new Float32Array(frames),
    copyToChannel: () => {},
  });
  const ctx = {
    currentTime: 0,
    sampleRate: 22050,
    destination: new FakeNode('destination'),
    listener: { setPosition: () => {}, setOrientation: () => {} },
    createGain: () => new FakeGain(),
    createPanner: () => new FakePanner(),
    createConvolver: () => Object.assign(new FakeNode('convolver'), { buffer: null as unknown }),
    createBiquadFilter: () => Object.assign(new FakeNode('filter'), { type: 'lowpass', frequency: new FakeParam(0) }),
    createBufferSource: () => new FakeSource(),
    createBuffer: (channels: number, frames: number, rate: number) => buffer(channels, frames, rate),
  };
  const reaches = (from: FakeNode, to: FakeNode) => {
    const seen = new Set<FakeNode>();
    const queue = [from];
    while (queue.length) {
      const n = queue.pop()!;
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const out of n.outputs) queue.push(out);
    }
    return false;
  };

  const settings: AudioSettings = { soundMaster: 0.8, soundAmbience: 0.5, soundEffects: 0.6, soundVoices: 1, soundFootsteps: 1, soundVehicles: 1, soundInterface: 1, soundMusic: 1, soundHeadphones: false, soundRoomEcho: false, soundInBackground: false, soundSabers: 'jka' };
  const audio = new AudioSystem('', settings);
  audio.installOffline(ctx as unknown as BaseAudioContext);
  ok(made.some((n) => n.kind === 'convolver') && made.filter((n) => n.kind === 'convolver').length === 2, 'the two room echoes are built once with the graph, so switching them on later adds no node');
  ok((audio.status().slotsBuilt as number) === 0, 'and no voice slot is built until something plays: a silent game holds no voice nodes at all');
  ok((audio.status().master as number) === 0.8 && (audio.status().groups as Record<string, number>).effects === 0.6, 'the master and the layer gains are the settings');

  audio.bank.adopt({ format: 1, templates: { 'sound/gun.snd': plain({ category: 7, dim: 2, volume: noVariation(0.75) }), 'sound/bird.snd': plain({ category: 0, dim: 3, full: 20 }) } });
  audio.bank.provide('sample/a.wav', buffer(1, 11025, 22050) as unknown as AudioBuffer);
  const pose = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, space: { building: -1, cell: -1 } };
  audio.play('sound/gun.snd');
  audio.update(1 / 60, pose);
  const shot = made.find((n) => n instanceof FakeSource && n.started) as FakeSource | undefined;
  ok(!!shot && shot.started!.at === 0 && shot.started!.offset === 0, 'a one-shot really starts a source, at the time the template says and from the top');
  ok((audio.status().counts as { started: number }).started === 1 && (audio.status().slotsBuilt as number) === 1, 'and one slot was built for it');
  ok(reaches(shot!, ctx.destination as unknown as FakeNode), 'the source reaches the speakers through the slot, its layer and the master');
  // The template asks for 0.75 and the slot carries it; the layer and the master are the two gains
  // beyond it, so a sound is never written pre-multiplied by a slider.
  const slotGain = made.find((n) => n instanceof FakeGain && n.outputs.some((o) => o.kind === 'gain') && shot!.outputs.includes(n)) as FakeGain | undefined;
  ok(!!slotGain && near(slotGain.gain.value, 0.75, 1e-4), 'the slot is set to what the template itself asks for, with the sliders left to their own gains');

  // A second sound on another layer must join a different layer gain, and must not be given the
  // first one's slot while it is playing.
  audio.play('sound/bird.snd', { x: 3, y: 0, z: 0 });
  ctx.currentTime = 0.05;
  audio.update(1 / 60, pose);
  ok((audio.status().slotsBuilt as number) === 2, 'a positional sound takes a slot of its own, apart from the non-positional pool');
  const panner = made.find((n) => n instanceof FakePanner) as FakePanner | undefined;
  ok(!!panner && panner.rolloffFactor === 0, 'its panner only pans: the node\'s own falloff is off, because the whole curve is ours');
  // A voice's parameters are written at most thirty times a second, so the place lands on the next
  // frame past that gap and not on the one that started it.
  ctx.currentTime = 0.12;
  audio.update(1 / 60, pose);
  ok(panner!.positionX.value === 3, 'and the panner is given the sound\'s place in the world');
  ok(panner!.panningModel === 'equalpower', 'with the speakers\' model while Headphones is off');
  audio.apply({ ...settings, soundHeadphones: true });
  ok(panner!.panningModel === 'HRTF' && (audio.status().panning as string) === 'HRTF', 'and the switch moves every slot\'s model live, which is a parameter and not a rebuild');

  // Heard from inside a building while the listener is outside: the muffled branch opens and the
  // dry one closes, which is the rule one call decides for every voice.
  const inside = { ...pose, space: { building: 7, cell: 1 } };
  ctx.currentTime = 0.2;
  audio.update(1 / 60, inside);
  const filter = made.find((n) => n.kind === 'filter') as FakeNode & { frequency: FakeParam };
  ok(!!filter && filter.frequency.value === DISTANCE_TUNE.muffleHz, 'every slot has its low-pass at the muffling frequency from the moment it is built');
  const muffled = made.filter((n) => n instanceof FakeGain && n.outputs.includes(filter)) as FakeGain[];
  ok(muffled.length > 0 && near(muffled[0].gain.value, DISTANCE_TUNE.muffleGain, 1e-4), 'and a voice the listener has walked out on goes through it');

  // A voice that gives way: it must be let go of entirely (a record kept for a voice that will
  // never sound again is walked every frame for the rest of the session and counted in the very
  // numbers this is read by), and it must be faded out on a node of its own rather than cut dead
  // on the gain the voice taking its place is about to write.
  audio.bank.adopt({ format: 1, templates: { 'sound/gun.snd': plain({ category: 7, dim: 2, volume: noVariation(0.75) }), 'sound/urgent.snd': plain({ category: 7, dim: 2, priority: 0 }) } });
  ctx.currentTime = 0.3;
  for (let i = 0; i < VOICE_TUNE.flat; i++) audio.play('sound/gun.snd');
  audio.update(1 / 60, pose);
  const filled = (audio.status().budget as { flat: number }).flat;
  // The eight that started on this frame, which are the ones about to give way.
  const quiet = made.filter((n) => n instanceof FakeSource && n.started?.at === 0.3) as FakeSource[];
  ctx.currentTime = 0.31;
  for (let i = 0; i < VOICE_TUNE.flat; i++) audio.play('sound/urgent.snd');
  audio.update(1 / 60, pose);
  const stolen = (audio.status().budget as { stolen: number }).stolen;
  ok(filled === VOICE_TUNE.flat && stolen === VOICE_TUNE.flat, 'a full pool of quiet voices all give way to a pool of urgent ones');
  ok(quiet.every((s) => s.stopped), 'each one that gave way was stopped');
  ctx.currentTime = 0.32;
  audio.update(1 / 60, pose);
  const pools = audio.status().budget as { flat: number; positional: number; ui: number };
  ok((audio.status().voiceCount as number) === pools.flat + pools.positional + pools.ui, 'and left no record behind: every voice still counted is one that holds a slot');
  const cuts = made.filter((n) => n instanceof FakeGain && n.outputs.some((o) => o.kind === 'panner')) as FakeGain[];
  ok(cuts.length >= 2, 'a slot has two ways in, so a voice that gives way has somewhere to fade out that is not the gain its replacement is writing');
}

// ---- a bed resuming in its own gap waits the gap out ----
{
  const start = makeStart();
  const run = new TemplateRun(plain({ loops: [-1, -1], gap: [2, 2] }), seededRng(3), 0);
  run.nextDue(0, start);
  run.began(4);
  ok(near(run.offsetInto(13, 4), 1), 'thirteen seconds into a four second sound with a two second gap is one second into its fifth time round');
  // 17 s is 5 s into the 6 s round, which is the second of the two seconds of silence.
  ok(near(run.offsetInto(17, 4), -1), 'and a time inside the gap comes back as the seconds left of it, so the bed waits rather than coming in part way through the sample');
}

// ---- the self test in a place that has no offline context ----
{
  const settings: AudioSettings = { soundMaster: 1, soundAmbience: 1, soundEffects: 1, soundVoices: 1, soundFootsteps: 1, soundVehicles: 1, soundInterface: 1, soundMusic: 1, soundHeadphones: false, soundRoomEcho: false, soundInBackground: false, soundSabers: 'jka' };
  const result = await new AudioSystem('', settings).selfTest();
  ok(result.ok === false && typeof result.why === 'string', 'where there is no offline context the self test says so plainly instead of throwing or reading as a broken chain');
}

console.log(`\n${passed} checks passed`);
