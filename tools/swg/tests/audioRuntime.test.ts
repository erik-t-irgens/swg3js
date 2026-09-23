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
import { ClipEventIndex, ClipWatcher, crossed, type ActiveClip, type ClipHalf } from '../../../src/audio/clipEvents.ts';
import { BodySounds, FOOT_TUNE, resolveSurface, sampleFamily, surfaceWord } from '../../../src/audio/footsteps.ts';
import { SaberSounds, swingGroup, type JkaPack, type SaberWorld } from '../../../src/audio/saberSounds.ts';
import { powerById } from '../../../src/combat/forcePowers.ts';
import { liveSettings } from '../../../src/core/settings.ts';

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

// ---- the feet's own fixtures ----

/** One event at a fraction of a clip, in the shape a pack writes. */
const foot = (f: number) => ({ name: 'footstep', f, kind: 'foot' as const });

/** One action, as a rig reports it; the token is what the watcher remembers it by. */
const clip = (name: string, half: ClipHalf, time: number, duration: number, weight: number): ActiveClip => ({ name, half, time, duration, timeScale: 1, weight, looping: true, token: { name, half } });

/** A rig or animator that plays one clip, whose time the test moves by hand. */
class FakeClips {
  name: string;
  duration: number;
  time: number;
  private readonly token = {};
  constructor(name: string, duration: number, time: number) {
    this.name = name;
    this.duration = duration;
    this.time = time;
  }
  activeClips(out: ActiveClip[]): number {
    out[0] = { name: this.name, half: 'whole', time: this.time, duration: this.duration, timeScale: 1, weight: 1, looping: true, token: this.token };
    return 1;
  }
}

/** The mixer as the feet use it: every call is written down and nothing makes a sound. */
class FakeHost {
  readonly played: { id: string; x?: number; y?: number; z?: number; space?: { building: number; cell: number } }[] = [];
  readonly loops: { id: string; key: number }[] = [];
  readonly stopped: number[] = [];
  readonly moved: { key: number; x: number }[] = [];
  private next = 1;
  readonly grid = { isNear: () => true };
  readonly bank = { available: true, sources: null, template: () => ({}) };
  play(id: string, options: { x?: number; y?: number; z?: number; space?: { building: number; cell: number } } = {}): number {
    // The space is a record the caller keeps and refills, so it is copied out rather than held.
    this.played.push({ id, ...options, space: options.space ? { ...options.space } : undefined });
    return this.next++;
  }
  loop(id: string): number {
    const key = this.next++;
    this.loops.push({ id, key });
    return key;
  }
  stop(key: number): void {
    this.stopped.push(key);
  }
  move(key: number, x: number): void {
    this.moved.push({ key, x });
  }
  setGain(): void {}
  setSpace(): void {}
  isPlaying(key: number): boolean {
    return !this.stopped.includes(key);
  }
  prepare(): void {}
}

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

// ================================ feet, surfaces and voices ================================
// A clip's own event markers read against a playing action, and what a foot landing is taken to
// have landed on. Both are pure: the mistakes they can make are silent feet, doubled feet and a
// step on the wrong surface, and all three read as numbers here.

// ---- which events a step over a clip crossed ----
{
  const hits: number[] = [];
  const events = [foot(0.1), foot(0.6)];
  ok(crossed(events, 0, 0.5, 1, true, false, hits) === 1 && hits[0] === 0, 'a step forwards crosses the events inside it');
  ok(crossed(events, 0.5, 0.5, 1, true, false, hits) === 0, 'a frame of no length crosses nothing, so a paused game never steps');
  ok(crossed(events, 0.1, 0.6, 1, true, false, hits) === 1 && hits[0] === 1, 'the span is open at the start and closed at the end, so an event on a frame boundary fires once rather than twice');
  ok(crossed(events, 0.8, 0.2, 1, true, false, hits) === 1 && hits[0] === 0, "a loop's wrap crosses the end and then the beginning");
  ok(crossed(events, 0.8, 0.7, 1, true, false, hits) === 2 && hits[0] === 0 && hits[1] === 1, 'and a whole turn round the loop crosses both, in the order they happen');
  ok(crossed(events, 0.7, 0.05, 1, false, false, hits) === 0, 'an action started again from nothing fires only what it has passed since');
  ok(crossed(events, 0.5, 0.05, 1, true, true, hits) === 1 && hits[0] === 0, 'played backwards it crosses the same marks the other way');
  // A clip the pack scaled in time: the marks are fractions, so they land at the same share of it.
  ok(crossed(events, 0, 0.3, 2, true, false, hits) === 1, 'a clip of twice the length steps at the same fraction of it, not at the same second');
  ok(crossed(events, 0, 1, 0, true, false, hits) === 0, 'a clip with no length says nothing rather than throwing');
  // A clip shorter than a second: the ends of a wrap are fractions, so the far end is 1 and never
  // the duration in seconds. Read as seconds, every mark past the duration was dropped, and 712 of
  // the 2,350 clips in the first sixty animation packs are shorter than a second.
  const short = [foot(0.2), foot(0.95)];
  ok(crossed(short, 0.45, 0.15, 0.5, true, false, hits) === 2 && hits[0] === 1 && hits[1] === 0, 'a looping clip shorter than a second crosses the marks near its end, which are fractions of it and not seconds');
  ok(crossed(short, 0.15, 0.45, 0.5, true, true, hits) === 2, 'and the same the other way round, played backwards');
  // A mark written on the very first frame.
  const first = [foot(0), foot(0.5)];
  ok(crossed(first, 0.9, 0.1, 1, true, false, hits) === 1 && hits[0] === 0, 'a mark on the first frame is crossed once each time round the loop rather than never');
  ok(crossed(first, 0.1, 0.6, 1, true, false, hits) === 1 && hits[0] === 1, 'and not again in the middle of the same turn');
}

// ---- the pack, in the shape the converter writes ----
{
  const index = new ClipEventIndex();
  index.adopt({
    format: 1,
    clips: { 'appearance/animation/all_b_loc_run.ans': { frames: 20, fps: 30, events: [{ name: 'event_footstep', frame: 2, f: 0.1 }, { name: 'event_vocalize', frame: 10, f: 0.5 }] } },
    jka: { clips: { BOTH_RUN2: { frames: 24, fps: 20, upper: [{ type: 'voice', voice: 'pain25', frame: 3, f: 0.125, chance: 1 }], lower: [{ type: 'footstep', foot: 'l', heavy: false, chance: 1, frame: 8, f: 0.333 }] } } },
    species: { tables: { 'appearance/all_b.lat': { run: 'appearance/animation/all_b_loc_run.ans' } }, species: { human_male: { template: 'object/creature/player/shared_human_male.iff', table: 'appearance/all_b.lat', clientData: 'clientdata/player/client_shared_player_human_m.cdf' } } },
    mobiles: { 'object/mobile/shared_bantha.iff': 'clientdata/creature/client_shared_cr_bantha.cdf' },
  });
  const own = index.eventsFor('appearance/animation/all_b_loc_run.ans', 'whole', null);
  ok(own?.length === 2 && own[0].kind === 'foot' && own[0].name === 'footstep', "a mobile's clip is found by the animation it was baked from, and the event_ prefix is taken off for the client data lookup");
  ok(index.eventsFor('run', 'whole', 'human_male')?.length === 2, "a species clip is found by name through its own animation table, which the species packs do not carry");
  ok(index.eventsFor('run', 'whole', 'wookiee_male') === null, 'and a species with no table of its own finds nothing rather than another skeleton’s clip');
  const lower = index.eventsFor('BOTH_RUN2', 'lower', null);
  ok(lower?.length === 1 && lower[0].kind === 'foot', "Jedi Academy's legs block gives the feet");
  const upper = index.eventsFor('BOTH_RUN2', 'upper', null);
  ok(upper?.length === 1 && upper[0].kind === 'voice' && upper[0].name === '*pain25', 'its torso block gives the voice lines, which are the character’s own set rather than a file');
  const whole = index.eventsFor('BOTH_RUN2', 'whole', null);
  ok(whole?.length === 2 && whole[0].f < whole[1].f, 'and a clip played over the whole body speaks both blocks, in order, so a death’s cry is not lost under its own footsteps');
  ok(index.clientDataForSpecies('human_male') === 'clientdata/player/client_shared_player_human_m.cdf', 'the species map says which client data a body speaks from');
  ok(index.clientDataForTemplate('object/mobile/shared_bantha.iff') === 'clientdata/creature/client_shared_cr_bantha.cdf', 'and the mobile map does the same for a creature, which only its template chain could say');
}

// ---- which action speaks ----
{
  const index = new ClipEventIndex();
  index.adopt({ clips: { walk: { events: [{ name: 'event_footstep', f: 0.5 }] }, run: { events: [{ name: 'event_footstep', f: 0.5 }] }, swing: { events: [{ name: 'event_attackheavy', f: 0.5 }] } } });
  const watcher = new ClipWatcher();
  const heard: string[] = [];
  const sink = (e: { name: string }, c: { name: string }) => heard.push(`${c.name}:${e.name}`);
  // A walk blending into a run: both carry the same foot event at the same fraction.
  const walk = clip('walk', 'whole', 0.4, 1, 0.55);
  const run = clip('run', 'whole', 0.4, 1, 0.45);
  watcher.step([walk, run], 2, index, null, sink);
  walk.time = 0.6;
  run.time = 0.6;
  watcher.step([walk, run], 2, index, null, sink);
  ok(heard.length === 1 && heard[0] === 'walk:footstep', 'a body blending a walk into a run steps once, from whichever of the two carries the weight');
  heard.length = 0;
  // The same clip as the legs' half, with a swing riding the upper body.
  const legs = clip('run', 'lower', 0.4, 1, 1);
  const swing = clip('swing', 'upper', 0.4, 1, 1);
  watcher.step([legs, swing], 2, index, null, sink);
  legs.time = 0.6;
  swing.time = 0.6;
  watcher.step([legs, swing], 2, index, null, sink);
  ok(heard.includes('run:footstep') && heard.includes('swing:attackheavy'), 'the legs step and the torso speaks, which is how the player’s body plays its two halves');
  heard.length = 0;
  // An upper half never steps, however heavy it is.
  const upperWalk = clip('walk', 'upper', 0.4, 1, 1);
  watcher.step([upperWalk], 1, index, null, sink);
  upperWalk.time = 0.6;
  watcher.step([upperWalk], 1, index, null, sink);
  ok(heard.length === 0, 'a clip riding the upper body alone never puts a foot down');
  heard.length = 0;
  // A pose fading out does not grunt on its way.
  const faint = clip('swing', 'whole', 0.4, 1, 0.2);
  watcher.step([faint], 1, index, null, sink);
  faint.time = 0.6;
  watcher.step([faint], 1, index, null, sink);
  ok(heard.length === 0, 'an action under half the weight speaks nothing but its feet');
  heard.length = 0;
  // A new action, and one met again after the body was out of range, pick their clock up in silence.
  const fresh = clip('walk', 'whole', 0.9, 1, 1);
  watcher.step([fresh], 1, index, null, sink);
  ok(heard.length === 0, 'an action met for the first time speaks nothing: its clock is picked up where it stands');
  fresh.time = 0.1;
  watcher.forget();
  watcher.step([fresh], 1, index, null, sink);
  ok(heard.length === 0, 'and a body that walked out of earshot and back fires nothing for the steps it took meanwhile');
  // A jump across most of the clip is not believed.
  heard.length = 0;
  const jumpy = clip('walk', 'whole', 0.01, 1, 1);
  watcher.step([jumpy], 1, index, null, sink);
  jumpy.time = 0.99;
  watcher.step([jumpy], 1, index, null, sink);
  ok(heard.length === 0 && watcher.counts.skippedBigStep === 1, 'a frame that crossed most of a clip (a tab that was away) moves the clock on without firing');
}

// ---- what a foot lands on ----
{
  // The planet's pack names only what has a surface of its own; everything else answers nothing.
  const names = { object: (t: string) => (t === 'catwalk' ? 'wood' : t === 'plaza' ? 'stone' : null), ground: (t: string) => surfaceWord(t, { 'abstract/terrain_surface/sand.iff': { type: 'sand' } }) };
  const world = {
    water: -Infinity,
    room: null as string | null,
    object: null as string | null,
    ground: 'abstract/terrain_surface/sand.iff' as string | null,
    waterTop(): number {
      return this.water;
    },
    roomSurface(): string | null {
      return this.room;
    },
    objectTemplate(): string | null {
      return this.object;
    },
    groundTemplate(): string | null {
      return this.ground;
    },
    space(): null {
      return null;
    },
  };
  const at = (over: Partial<{ inside: boolean; player: boolean; last: string | null; deck: string | null; y: number }> = {}) => resolveSurface({ x: 0, y: over.y ?? 0, z: 0, inside: over.inside ?? false, player: over.player ?? true, last: over.last ?? null, deck: over.deck ?? null }, world, names, FOOT_TUNE);
  ok(at().surface === 'sand' && at().from === 'terrain', 'in the open it is whatever the terrain is painted with there');
  world.object = 'catwalk';
  ok(at().surface === 'wood' && at().from === 'object', 'standing on something, that thing’s own template decides: a catwalk is wood over sand');
  world.object = 'plaza';
  ok(at().surface === 'stone' && at().from === 'object', 'and a paved one is stone, which the pack names outright');
  world.object = 'a_rock';
  ok(at().surface === 'sand' && at().from === 'terrain', 'an object the planet’s pack does not name has no surface of its own, which is the converter’s rule: the ground underneath answers, so a rock in the desert is sand');
  world.object = null;
  world.room = 'carpet';
  ok(at().surface === 'sand' && at({ inside: true }).surface === 'carpet', 'a room’s own surface is used only for a body that is in one');
  // The player's room is the cell the game already tracks; everything else asks by the point.
  ok(at({ inside: true, player: true }).surface === 'carpet', 'without a tracked cell the player falls back on the room the point is in');
  const tracked = { ...world, playerRoom: () => 'metal' };
  ok(resolveSurface({ x: 0, y: 0, z: 0, inside: true, player: true, last: null, deck: null }, tracked, names, FOOT_TUNE).surface === 'metal', 'and with one it takes that room’s floor rather than working the point out again');
  ok(resolveSurface({ x: 0, y: 0, z: 0, inside: true, player: false, last: null, deck: null }, tracked, names, FOOT_TUNE).surface === 'carpet', 'a body that is not the player never takes the player’s room');
  ok(at({ inside: true, deck: 'metal' }).surface === 'metal', 'and a ship’s deck is handed in, since its rooms are a physics world of their own');
  world.water = 0.4;
  ok(at({ player: true }).surface === 'water' && at({ player: false }).surface === 'surf', 'feet under water splash: the player wades and everything else surfs, which is what each one’s own map holds');
  ok(at({ inside: true }).surface === 'water', 'water wins over the room, so wading through a flooded cellar still splashes');
  world.water = 2;
  ok(at().surface === null && at().from === 'water', 'chest deep it is swimming, which has a voice of its own and no feet at all');
  world.water = -Infinity;
  world.ground = null;
  ok(at({ last: 'rock' }).surface === 'rock' && at({ last: 'rock' }).from === 'last', 'off the built ground it keeps whatever it last stood on');
  ok(at().surface === FOOT_TUNE.fallback && at().from === 'default', 'and with nothing at all to go on it falls back on one surface rather than going silent');
  ok(surfaceWord('abstract/terrain_surface/snow.iff', null) === 'snow', 'a surface template with no table to read it by is named after its own file');
}

// ---- the ground's own family grid, as a chunk built it ----
{
  // A chunk at (0, 0), 64 m across, sampled every 2 m, with one sample of overhang on each side.
  const w = 35;
  const fams = new Int32Array(w * w);
  const put = (i: number, j: number, v: number) => (fams[j * w + i] = v);
  put(1, 1, 7); // the chunk's first corner, at (0, 0)
  put(6, 3, 9); // (10, 4)
  const grid = { fams, ox: 0, oz: 0, step: 2, w };
  ok(sampleFamily(grid, 0, 0) === 7, "a chunk's first corner reads the sample the ground was painted from");
  ok(sampleFamily(grid, 10.8, 4.4) === 9 && sampleFamily(grid, 9.4, 3.2) === 9, 'a point between samples takes the nearest, as the ground does');
  ok(sampleFamily(grid, 200, 0) === null && sampleFamily(grid, 0, -40) === null, 'a point the grid does not cover has no answer at all, so the foot keeps what it last stood on');
  ok(sampleFamily(grid, 30, 30) === 0, 'and one it covers but nothing painted is family 0, which is a surface of none rather than a missing chunk');
}

// ---- a body walking, from its clips to the mixer ----
{
  const host = new FakeHost();
  const feet = new BodySounds(host as never, '');
  feet.adoptEvents({
    clientData: {
      'clientdata/player/client_shared_player_human_m.cdf': { events: { footstep: 'clienteffect/e3_player_footstep.cef', footstep_sand: 'sound/fs_out_sand_crunch.snd', footstep_metal: 'sound/fs_in_metal_floor.snd', hitlight: 'sound/voice_hum_m_light.snd' } },
      'clientdata/creature/client_shared_cr_bantha.cdf': { events: { footstep: 'clienteffect/cr_footstep_large.cef', vocalize: 'sound/cr_bantha_vocalize.snd', hitground: 'sound/cr_bantha_fall.snd' }, ambient: 'sound/cr_bantha_idle_breathe.snd' },
    },
    clientEffects: { 'clienteffect/e3_player_footstep.cef': { sounds: ['sound/fs_out_sand_crunch.snd'] }, 'clienteffect/cr_footstep_large.cef': { sounds: ['sound/cr_generic_large_fs_walk.snd'] }, 'clienteffect/e3_creature_footstep_small.cef': { sounds: ['sound/cr_generic_small_fs_walk.snd'] } },
  });
  feet.index.adopt({
    clips: { 'appearance/animation/all_b_loc_run.ans': { events: [{ name: 'event_footstep', f: 0.5 }] }, 'appearance/animation/bantha_walk.ans': { events: [{ name: 'event_footstep', f: 0.5 }] } },
    species: { tables: { table: { run: 'appearance/animation/all_b_loc_run.ans' } }, species: { human_male: { template: 'object/creature/player/shared_human_male.iff', table: 'table', clientData: 'clientdata/player/client_shared_player_human_m.cdf' }, bothan_male: { template: 'object/creature/player/shared_bothan_male.iff', table: 'table', clientData: 'clientdata/player/client_shared_player_human_m.cdf' } } },
    mobiles: { 'object/mobile/shared_bantha.iff': 'clientdata/creature/client_shared_cr_bantha.cdf' },
  });
  const ground = { surface: 'abstract/terrain_surface/sand.iff' as string | null };
  feet.setSurfaceTable({ 'abstract/terrain_surface/sand.iff': { type: 'sand' } });
  feet.attachWorld({
    waterTop: () => -Infinity,
    roomSurface: () => null,
    objectTemplate: () => null,
    groundTemplate: () => ground.surface,
    space: () => null,
  });
  const rig = new FakeClips('run', 1, 0.4);
  const player = { x: 0, y: 0, z: 0, inside: false, deck: null as string | null, space: null as { building: number; cell: number } | null, dead: false, species: 'human_male', activeClips: (out: ActiveClip[]) => rig.activeClips(out) };
  const lists = { player, mobiles: [] as never[], fighters: [] as never[] };
  const ear = { x: 0, y: 0, z: 0 };
  feet.update(1 / 60, ear, lists);
  rig.time = 0.6;
  feet.update(1 / 60, ear, lists);
  ok(host.played.length === 1 && host.played[0].id === 'sound/fs_out_sand_crunch.snd', 'the player walking on sand plays the sand step its own species names');
  ok(feet.log.at(-1)?.from === 'terrain' && feet.log.at(-1)?.surface === 'sand', 'and the report says which of the four sources decided it');
  // The same walk indoors on a metal floor.
  host.played.length = 0;
  feet.attachWorld({ waterTop: () => -Infinity, roomSurface: () => 'metal', objectTemplate: () => null, groundTemplate: () => ground.surface, space: () => null });
  player.inside = true;
  rig.time = 0.4;
  feet.update(1 / 60, ear, lists);
  rig.time = 0.6;
  feet.update(1 / 60, ear, lists);
  ok(host.played.at(-1)?.id === 'sound/fs_in_metal_floor.snd', 'the same body on a room’s metal floor plays its metal step');
  // Aboard a hull there is no streamed building at the point, so the game hands the space over: a
  // step that came out as "outside" would be low-passed while the ear was inside the hull.
  host.played.length = 0;
  player.deck = 'metal';
  player.space = { building: 12, cell: -1 };
  rig.time = 0.4;
  feet.update(1 / 60, ear, lists);
  rig.time = 0.6;
  feet.update(1 / 60, ear, lists);
  ok(host.played.at(-1)?.space?.building === 12, 'a step taken aboard a hull is played in that hull’s own space, so the mixer does not muffle the player’s own boots');
  player.deck = null;
  player.space = null;
  // A Bothan: the archives give it no client data of its own and its template names the human files.
  host.played.length = 0;
  player.species = 'bothan_male';
  player.inside = false;
  rig.time = 0.4;
  feet.update(1 / 60, ear, lists);
  rig.time = 0.6;
  feet.update(1 / 60, ear, lists);
  ok(host.played.at(-1)?.id === 'sound/fs_out_sand_crunch.snd', 'a Bothan, which has no client data of its own, walks on the human files its template names');
  // A creature: one footstep effect for every surface, as the game had it.
  host.played.length = 0;
  lists.player = null as never;
  const anim = new FakeClips('appearance/animation/bantha_walk.ans', 1, 0.4);
  const bantha = { key: 7, label: 'bantha', dead: false, removed: false, ready: true, state: 'idle', inside: false, scale: 1, pos: { x: 2, y: 0, z: 0 }, entry: { id: 'bantha', template: 'object/mobile/shared_bantha.iff', kind: 'creature', appearance: 'bantha', stats: { sizeClass: 'large' } }, animator: anim, animPack: { id: 'bantha', json: { clips: [] } } };
  (lists as { mobiles: unknown[] }).mobiles = [bantha];
  feet.update(0.3, ear, lists);
  anim.time = 0.6;
  feet.update(1 / 60, ear, lists);
  ok(host.played.some((p) => p.id === 'sound/cr_generic_large_fs_walk.snd'), 'a creature steps with its size’s own effect, whatever it is walking on');
  ok(host.loops.some((l) => l.id === 'sound/cr_bantha_idle_breathe.snd'), 'and its idle breath is a looping voice at the body, which the emitter grid looks at four times a second');
  // It turns hostile: it calls out, and goes on calling while it hunts.
  host.played.length = 0;
  bantha.state = 'chase';
  feet.update(0.3, ear, lists);
  feet.update(FOOT_TUNE.call[1] + 1, ear, lists);
  ok(host.played.some((p) => p.id === 'sound/cr_bantha_vocalize.snd'), 'a creature that has turned on something calls out while it hunts');
  // It dies: the fall plays once, and its loop goes.
  host.played.length = 0;
  bantha.dead = true;
  // In frames, not in one jump: the update clamps a step to a quarter second, as the game's own
  // frame does, so a test that asked for a whole second at once would move the clock by a quarter.
  for (let i = 0; i < 8; i++) feet.update(0.2, ear, lists);
  ok(host.played.filter((p) => p.id === 'sound/cr_bantha_fall.snd').length === 1, 'a death hits the ground once, since its own clip marked no fall');
  ok(host.stopped.length >= 1, 'and the body’s idle breath is let go with it');
  // A death whose own clip marks the thud: the mark plays it and the timer is dropped, so a fall
  // marked late in a long clip is not heard twice.
  {
    const marked = new BodySounds(host as never, '');
    marked.adoptEvents({ clientData: { 'clientdata/creature/client_shared_cr_bantha.cdf': { events: { hitground: 'sound/cr_bantha_fall.snd' } } } });
    marked.index.adopt({ clips: { 'appearance/animation/bantha_death.ans': { events: [{ name: 'event_hitground', f: 0.9 }] } }, mobiles: { 'object/mobile/shared_bantha.iff': 'clientdata/creature/client_shared_cr_bantha.cdf' } });
    marked.attachWorld({ waterTop: () => -Infinity, roomSurface: () => null, objectTemplate: () => null, groundTemplate: () => null, space: () => null });
    const death = new FakeClips('appearance/animation/bantha_death.ans', 4, 0.1);
    const body = { ...bantha, dead: false, state: 'idle', animator: death };
    const only = { player: null, mobiles: [body], fighters: [] };
    host.played.length = 0;
    marked.update(1 / 60, ear, only as never);
    body.dead = true;
    for (let i = 0; i < 12; i++) {
      death.time = Math.min(3.9, death.time + 0.2 * 4);
      marked.update(0.2, ear, only as never);
    }
    ok(host.played.filter((p) => p.id === 'sound/cr_bantha_fall.snd').length === 1, 'a death clip that marks its own thud plays it once, from the mark and not from the timer as well');
  }
  const status = feet.status() as { counts: { steps: number; stepsPlayed: number } };
  ok(status.counts.steps >= 4 && status.counts.stepsPlayed >= 4, 'every step counted was a step that reached the mixer, which is how feet are checked in a tab that can hear nothing');
}

// ---- which client data a body speaks from, and what it does when there is none ----
{
  const host = new FakeHost();
  const feet = new BodySounds(host as never, '');
  feet.adoptEvents({
    clientData: {
      'clientdata/npc/client_shared_npc_dressed_ackbar.cdf': { events: { footstep: 'sound/fs_person.snd', vocalize: 'sound/v_ackbar.snd' } },
      'clientdata/player/client_shared_player_human_m.cdf': { events: { footstep: 'sound/fs_human.snd', hitlight: 'sound/v_human_hurt.snd' } },
    },
    clientEffects: { 'clienteffect/e3_creature_footstep_medium.cef': { sounds: ['sound/fs_medium.snd'] } },
  });
  feet.index.adopt({ clips: { walk: { events: [{ name: 'event_footstep', f: 0.5 }] } } });
  feet.attachWorld({ waterTop: () => -Infinity, roomSurface: () => null, objectTemplate: () => null, groundTemplate: () => null, space: () => null });
  const ear = { x: 0, y: 0, z: 0 };
  const body = (id: string, kind: string, template: string) => ({ key: 2, label: id, dead: false, removed: false, ready: true, state: 'idle', inside: false, scale: 1, pos: { x: 0, y: 0, z: 0 }, entry: { id, template, kind, appearance: null, stats: { sizeClass: 'medium' } }, animator: new FakeClips('walk', 1, 0.4), animPack: null });
  const walk = (feet2: BodySounds, b: ReturnType<typeof body>) => {
    const lists = { player: null, mobiles: [b], fighters: [] };
    feet2.update(1 / 60, ear, lists as never);
    b.animator.time = 0.6;
    feet2.update(1 / 60, ear, lists as never);
  };
  // A dressed NPC: the archives put it under `clientdata/npc/` with the `npc_dressed_` prefix, and
  // leaving that folder out sent 2,117 of the catalogue's 2,888 dressed bodies to the human files.
  walk(feet, body('ackbar', 'npc', 'object/mobile/shared_ackbar.iff'));
  ok(host.played.some((p) => p.id === 'sound/fs_person.snd'), 'a dressed NPC is found in the npc folder under the prefix the archives use, rather than falling back on the human files');
  // A droid with nothing of its own: its size's step, and no voice at all.
  host.played.length = 0;
  const droids = new BodySounds(host as never, '');
  droids.adoptEvents({ clientData: { 'clientdata/player/client_shared_player_human_m.cdf': { events: { footstep: 'sound/fs_human.snd', hitground: 'sound/v_human_die.snd' } } }, clientEffects: { 'clienteffect/e3_creature_footstep_medium.cef': { sounds: ['sound/fs_medium.snd'] } } });
  droids.index.adopt({ clips: { walk: { events: [{ name: 'event_footstep', f: 0.5 }] } } });
  droids.attachWorld({ waterTop: () => -Infinity, roomSurface: () => null, objectTemplate: () => null, groundTemplate: () => null, space: () => null });
  const droid = body('a_droid', 'droid', 'object/mobile/shared_a_droid.iff');
  walk(droids, droid);
  ok(host.played.some((p) => p.id === 'sound/fs_medium.snd') && !host.played.some((p) => p.id === 'sound/fs_human.snd'), 'a droid with no client data of its own steps with its size’s effect rather than borrowing a man’s boots');
  // The search is run once per body, not once per event: the sentinel is what makes `noData` a
  // count of speechless bodies and keeps the twenty guesses off every frame.
  for (let i = 0; i < 6; i++) walk(droids, droid);
  const counts = (droids.status() as { counts: { noData: number } }).counts;
  ok(counts.noData === 1, 'a body whose client data was not found remembers that it was not, so the guess list runs once and the count is of bodies rather than of lookups');
}

// ---- a fighter only calls out when it has something to fight ----
{
  const host = new FakeHost();
  const feet = new BodySounds(host as never, '');
  feet.adoptEvents({ clientData: { 'clientdata/player/client_shared_player_human_m.cdf': { events: { vocalize: 'sound/v_shout.snd' } } }, species: { 'object/creature/player/shared_human_male.iff': 'clientdata/player/client_shared_player_human_m.cdf' } });
  feet.index.adopt({ clips: {} });
  feet.attachWorld({ waterTop: () => -Infinity, roomSurface: () => null, objectTemplate: () => null, groundTemplate: () => null, space: () => null });
  const ear = { x: 0, y: 0, z: 0 };
  const fighter = { key: 3, name: 'a fighter', dead: false, hunting: false, species: 'human_male', pos: { x: 0, y: 0, z: 0 }, cell: null, rig: null };
  const lists = { player: null, mobiles: [], fighters: [fighter] };
  for (let i = 0; i < 5; i++) feet.update(0.25, ear, lists as never);
  ok(host.played.length === 0, 'a fighter standing about with nothing to fight never calls out');
  fighter.hunting = true;
  feet.update(0.25, ear, lists as never);
  ok(host.played.some((p) => p.id === 'sound/v_shout.snd'), 'and one that has turned on something calls out at once');
}

// ---------------------------------------------------------------------------------------------
// Lightsabers: which whoosh a style swings with, a move that carries its own marks against one
// that carries none, Jedi Academy's files given templates of their own, the hum following a lit
// blade through rain and water, and the Force powers that last.
// ---------------------------------------------------------------------------------------------

/** A mixer that writes down what it was asked for, with a clock the test winds by hand. */
class SaberFakeHost {
  now = 10;
  advancing = false;
  /** Set true to refuse everything, which is what a full voice pool does. */
  refuse = false;
  readonly played: { id: string; at: number; loop: boolean; gain: number; x?: number; key: number }[] = [];
  readonly stopped: number[] = [];
  readonly moved: { key: number; x: number }[] = [];
  readonly asked: string[] = [];
  readonly templates = new Map<string, unknown>();
  private next = 1;
  readonly bank = {
    available: true,
    template: (id: string): unknown => this.templates.get(id) ?? null,
  };
  play(id: string, options: { x?: number; y?: number; z?: number; loop?: boolean; gain?: number; at?: number } = {}): number {
    if (this.refuse) return 0;
    const key = this.next++;
    this.played.push({ id, at: options.at ?? this.now, loop: !!options.loop, gain: options.gain ?? 1, x: options.x, key });
    return key;
  }
  stop(key: number): void {
    this.stopped.push(key);
  }
  move(key: number, x: number): void {
    this.moved.push({ key, x });
  }
  setGain(): void {}
  isPlaying(key: number): boolean {
    return key > 0 && !this.stopped.includes(key);
  }
  prepare(ids: Iterable<string>): void {
    for (const id of ids) this.asked.push(id);
  }
}

/** Jedi Academy's own set as the converter writes it, cut down to what the checks need. */
const jkaPack = (): JkaPack => ({
  format: 2,
  sabers: {
    single_1: { on: 'sound/weapons/saber/saberon.wav', loop: 'sound/weapons/saber/saberhum4.wav', off: 'sound/weapons/saber/saberoff.wav' },
    dual_1: { loop: 'sound/weapons/saber/saberhum4.wav' },
    jedi: { loop: 'sound/weapons/saber/saberhum1.wav' },
  },
  files: {
    // The names the `.sab` files write are not always the extension the archive holds, and it slips
    // both ways: the ignition is an mp3 written as a wav, and the catch a wav written as an mp3.
    'sound/weapons/saber/saberon.mp3': 13293,
    'sound/weapons/saber/saberoff.mp3': 9741,
    'sound/weapons/saber/saberhum4.wav': 68948,
    'sound/weapons/saber/saberhum1.wav': 76160,
    'sound/weapons/saber/saberhup1.mp3': 6188,
    'sound/weapons/saber/saberhup2.mp3': 7024,
    'sound/weapons/saber/saberhup3.mp3': 6188,
    'sound/weapons/saber/saberhup4.mp3': 8069,
    'sound/weapons/saber/saberhup5.mp3': 7651,
    'sound/weapons/saber/saberhup6.mp3': 7651,
    'sound/weapons/saber/saberhup7.mp3': 8069,
    'sound/weapons/saber/saberhup8.mp3': 8069,
    'sound/weapons/saber/saberhup9.mp3': 9114,
    'sound/weapons/saber/saberblock1.mp3': 8534,
    'sound/weapons/saber/saberhit1.mp3': 11473,
    'sound/weapons/saber/saberhitwall1.mp3': 7283,
    'sound/weapons/saber/saber_catch.wav': 2217,
    'sound/weapons/saber/hitwater.mp3': 12879,
    'sound/weapons/saber/rainfizz1.mp3': 7467,
    'sound/weapons/saber/boiling.wav': 72574,
  },
});

/** A saber sound of its own, with the pack in and the mixer standing in. */
function sabersWith(host: SaberFakeHost, opts: { clips?: ClipEventIndex; world?: SaberWorld; pack?: JkaPack | null } = {}): SaberSounds {
  const s = new SaberSounds();
  s.attach(host as never, { clips: opts.clips ?? null, world: opts.world ?? null });
  s.adopt(opts.pack === undefined ? jkaPack() : opts.pack);
  return s;
}

const blade = {} as object;

// ---- which whoosh a style swings with ----
{
  ok(swingGroup('fast') === 'fast' && swingGroup('medium') === 'medium' && swingGroup('strong') === 'strong', "the three single styles take Jedi Academy's three groups of whooshes in order");
  ok(swingGroup('dual') === 'fast' && swingGroup('staff') === 'medium', 'the dual style swings with the quick group and the staff with the middle one');
}

// ---- a move that marks its own whooshes, against one that marks none ----
{
  const host = new SaberFakeHost();
  const clips = new ClipEventIndex();
  // A kata as Jedi Academy marks it: two whooshes in the torso's block, at its own frames.
  clips.adopt({
    jka: {
      clips: {
        BOTH_A2_SPECIAL: { frames: 41, upper: [{ type: 'sound', sound: 'sound/weapons/saber/saberhup%d.wav', range: [4, 6], frame: 4, frames: 41 }, { type: 'sound', sound: 'sound/weapons/saber/saberhup%d.wav', range: [4, 6], frame: 20, frames: 41 }] },
      },
    },
  });
  const s = sabersWith(host, { clips });
  s.swing('medium', { x: 1, y: 2, z: 3 }, 'BOTH_A2_SPECIAL', 2);
  ok(host.played.length === 2, 'a move whose clip Jedi Academy marked sounds once per mark and not at all at its start');
  const first = host.played[0];
  const second = host.played[1];
  ok(near(first.at - host.now, (4 / 40) * 2, 1e-6) && near(second.at - host.now, (20 / 40) * 2, 1e-6), "each whoosh is laid on the audio clock at its own mark's fraction of the move's real length");
  ok(first.id === second.id && first.id.includes('saberhup') && first.id.includes('4-6'), 'the range the mark names becomes one template with those three files as its samples, picked between as the game does');
  host.played.length = 0;
  // Every ordinary attack of every style carries no mark at all.
  s.swing('strong', { x: 0, y: 0, z: 0 }, 'BOTH_A3_T__B_', 0.7);
  ok(host.played.length === 1 && host.played[0].id === 'jka:swingStrong', 'a move that carries none whooshes exactly once as it starts, from its own style group');
  host.played.length = 0;
  host.now += 1;
  s.swing('medium', { x: 0, y: 0, z: 0 }, 'BOTH_A2_SPECIAL');
  ok(host.played.length === 1 && host.played[0].id === 'jka:swingMedium', 'a marked clip with no length to lay its marks along whooshes once rather than at nothing');
  const counts = (s.status() as { counts: { marked: number; swings: number } }).counts;
  ok(counts.marked === 1 && counts.swings === 2, 'and the report tells the two apart');
  // The same moves are what a sword and a polearm swing through, and they are not lightsabers.
  host.played.length = 0;
  host.now += 1;
  s.follow({ x: 0, y: 0, z: 0 }, []);
  s.swing('medium', null, 'BOTH_A1_T__B_', 0.5);
  ok(host.played.length === 0, 'the player swinging with no blade out makes no saber sound: the move machine runs for every melee weapon');
  const b = {} as object;
  host.now += 1;
  s.follow({ x: 0, y: 0, z: 0 }, [b]);
  s.ignite(b, true, { x: 0, y: 1, z: 0 });
  s.hum(b, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }, 1 / 60);
  host.played.length = 0;
  s.swing('medium', null, 'BOTH_A1_T__B_', 0.5);
  ok(host.played.length === 1 && host.played[0].id === 'jka:swingMedium' && host.played[0].x === 0, 'and with a blade out it whooshes at the blade');
}

// ---- Jedi Academy's files, which have no sound template of their own ----
{
  const host = new SaberFakeHost();
  const s = sabersWith(host);
  s.ignite(blade, true, { x: 0, y: 1, z: 0 });
  const hum = host.bank.template('jka:hum:single_1') as { samples: string[]; loops?: [number, number]; category: number } | null;
  ok(!!hum && hum.samples[0] === '../jka/sound/weapons/saber/saberhum4.wav', "a made-up template points at the file where the converter put it, beside the bank's own samples");
  ok(!!hum && hum.loops?.[0] === -1 && hum.category === 7, "a hum loops for ever and answers to the same layer the game's own lightsaber sounds do");
  const on = host.bank.template('jka:on') as { samples: string[] } | null;
  ok(!!on && on.samples[0].endsWith('saberon.mp3'), 'a name written with the wrong extension finds the file that is really there, as Jedi Academy\'s own loader does');
  host.templates.set('sound/amb_x.snd', { dim: 2 });
  ok(!!host.bank.template('sound/amb_x.snd'), "and everything else still reaches the bank's own 5,597 templates");
  ok(new URL('assets-private/sounds/samples/../jka/sound/weapons/saber/saberhum4.wav', 'http://game/').pathname === '/assets-private/sounds/jka/sound/weapons/saber/saberhum4.wav', 'the sample path resolves to the folder the converter copied Jedi Academy into');
}

// ---- the hum on a lit blade, and what the weather does to it ----
{
  const host = new SaberFakeHost();
  const sky = { rain: 0 };
  const sea = { top: -1e9 };
  // A cave cut under the water table, off to the east: the world's own reader answers no water at
  // all for a point standing in a room, however deep the room's floor is cut, and the fixture is
  // written as the world writes it so that `ask` is exercised rather than restated. It reads the
  // height it is handed, so a caller that stopped passing one would fail here.
  const cave = { x0: 40, x1: 60, y0: -10, y1: 5, z0: -10, z1: 10 };
  const inCave = (x: number, y: number, z: number): boolean =>
    x >= cave.x0 && x <= cave.x1 && y >= cave.y0 && y <= cave.y1 && z >= cave.z0 && z <= cave.z1;
  const world: SaberWorld = {
    listenerSpace: { building: 7, cell: 2 },
    weather: { fx: sky, roofs: { topAt: () => -1e9 } },
    footSurfaces: {
      waterTop: (x: number, y: number, z: number) => (y < sea.top && inCave(x, y, z) ? -Infinity : sea.top),
      space: (x: number, y: number, z: number) => (inCave(x, y, z) ? { building: 3, cell: 1 } : null),
    },
  };
  const s = sabersWith(host, { world });
  const b = {} as object;
  s.follow({ x: 0, y: 0, z: 0 }, [b]);
  s.ignite(b, true, { x: 0, y: 1, z: 0 });
  ok(host.played.some((p) => p.id === 'jka:on' && !p.loop), 'a blade lit plays its ignition once');
  s.hum(b, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }, 1 / 60);
  const loop = host.played.find((p) => p.loop);
  ok(!!loop && loop.id === 'jka:hum:single_1', "the player's own blade hums as the plain hilt does");
  const blades = (s.status() as { blades: { space: number }[] }).blades;
  ok(blades[0].space === 7, "a blade in the player's own hand is in the room the ear is in, so nothing in the hand is ever heard through a wall");
  host.played.length = 0;
  s.hum(b, { x: 1, y: 1, z: 0 }, { x: 1, y: 2, z: 0 }, 1 / 60);
  ok(host.played.length === 0 && host.moved.some((m) => m.key === loop!.key), 'and it follows the blade rather than being started again');
  // Under water the hum gives way to the boil, and comes back when the blade is out of it. The
  // world is what says so; nothing has to tell the blade.
  sea.top = 9;
  host.now += 1;
  s.hum(b, { x: 1, y: 1, z: 0 }, { x: 1, y: 2, z: 0 }, 1 / 60);
  ok(host.stopped.includes(loop!.key) && host.played.some((p) => p.id === 'jka:boil' && p.loop), 'a blade under water boils in place of its hum');
  // The same table, the same depth, but the point is inside a cave cut under it: the reader answers
  // dry for the point, so the blade hums indoors instead of boiling. This is `ask` doing it and not
  // a restatement of its arithmetic, which is what makes it a guard on the height ever being dropped
  // from the call again.
  host.played.length = 0;
  host.now += 1;
  s.hum(b, { x: 50, y: 0, z: 0 }, { x: 50, y: 2, z: 0 }, 1 / 60);
  const own = (s.status() as { blades: { owner: string; underwater: boolean; boiling: boolean; space: number }[] }).blades[0];
  ok(!own.underwater && !own.boiling && host.played.some((p) => p.loop && p.id.startsWith('jka:hum')), 'a lit blade held in a cave cut under a planet\'s water table hums rather than boiling');
  // And a blade that is not the player's, which is the one that also asks which room it is in: one
  // lookup settles both, so it takes that room's sound space and is never under the water there.
  const other = {} as object;
  s.ignite(other, true, { x: 50, y: 1, z: 0 });
  s.hum(other, { x: 50, y: 0, z: 0 }, { x: 50, y: 2, z: 0 }, 1 / 60);
  const theirs = (s.status() as { blades: { owner: string; underwater: boolean; space: number }[] }).blades.find((v) => v.owner === 'other');
  ok(!!theirs && !theirs.underwater && theirs.space === 3, 'a fighter\'s blade in that cave is in the cave\'s own sound space and is not in the water either');
  s.ignite(other, false, { x: 50, y: 1, z: 0 });
  sea.top = -1e9;
  sky.rain = 1;
  host.played.length = 0;
  host.now += 1;
  s.hum(b, { x: 1, y: 1, z: 0 }, { x: 1, y: 2, z: 0 }, 1 / 60);
  host.now += 5;
  s.hum(b, { x: 1, y: 1, z: 0 }, { x: 1, y: 2, z: 0 }, 1 / 60);
  ok(host.played.some((p) => p.id === 'jka:fizz'), 'and one out in the rain hisses');
  // Something that would rather say for itself wins for a second and then lapses back to the world.
  s.weather(b, false, false);
  host.played.length = 0;
  host.now += 0.5;
  s.hum(b, { x: 1, y: 1, z: 0 }, { x: 1, y: 2, z: 0 }, 1 / 60);
  ok(!host.played.some((p) => p.id === 'jka:fizz'), 'a blade told it is not raining on it is not, whatever the sky says');
  s.ignite(b, false, { x: 1, y: 1, z: 0 });
  ok(host.played.some((p) => p.id === 'jka:off'), 'a blade put out plays its shut-off');
  s.hum(b, { x: 1, y: 1, z: 0 }, { x: 1, y: 2, z: 0 }, 1 / 60);
  ok(!host.played.some((p) => p.loop && p.id.startsWith('jka:hum') && p.at > 0 && !host.stopped.includes(p.key)), 'and nothing of it is left humming');
}

// ---- the blade meeting things ----
{
  const host = new SaberFakeHost();
  const s = sabersWith(host);
  s.contact('block', { x: 0, y: 0, z: 0 });
  s.contact('block', { x: 0, y: 0, z: 0 });
  ok(host.played.length === 1, 'two blows of a kind within a frame of each other are one sound, so a blade dragged along a wall does not rattle');
  host.now += 1;
  s.contact('wall', { x: 0, y: 0, z: 0 });
  s.contact('body', { x: 0, y: 0, z: 0 });
  s.contact('catch', { x: 0, y: 0, z: 0 });
  ok(host.played.map((p) => p.id).join(' ') === 'jka:block jka:wall jka:body jka:catch', 'a bolt turned away, a wall, a body and a blade caught out of the air each have their own sound');
  // A parry knows it happened but not where: it sounds at the blade the renderer drew a moment ago,
  // which is in the world even when the body's own place is in a ship's frame.
  const b = {} as object;
  s.follow({ x: 100, y: 0, z: 0 }, [b]);
  s.ignite(b, true, { x: 5, y: 1, z: 0 });
  s.hum(b, { x: 5, y: 1, z: 0 }, { x: 5, y: 2, z: 0 }, 1 / 60);
  host.played.length = 0;
  s.contact('clash');
  ok(host.played.length === 1 && host.played[0].x === 5, "a blow with no place of its own is heard at the player's own blade rather than at the body");
}

// ---- the game's own set, and having neither ----
{
  const host = new SaberFakeHost();
  for (const id of ['sound/wep_idle1_lightsaber.snd', 'sound/wep_activate_lightsaber.snd', 'sound/wep_lightsaber_swing.snd', 'sound/wep_lightsaber_hit_flesh.snd']) host.templates.set(id, { dim: 3 });
  const settings = liveSettings();
  const was = settings.soundSabers;
  settings.soundSabers = 'swg';
  const s = sabersWith(host);
  const b = {} as object;
  s.follow({ x: 0, y: 0, z: 0 }, [b]);
  s.ignite(b, true, { x: 0, y: 0, z: 0 });
  s.hum(b, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 1 / 60);
  ok(host.played.some((p) => p.id === 'sound/wep_activate_lightsaber.snd') && host.played.some((p) => p.id === 'sound/wep_idle1_lightsaber.snd'), "with the game's own sounds chosen, the blade lights and hums from the game's own templates");
  s.contact('catch', { x: 0, y: 0, z: 0 });
  ok(host.played.some((p) => p.id === 'jka:catch'), "and a role the game has nothing for keeps Jedi Academy's file whichever set is chosen");
  settings.soundSabers = was;
  // Nothing converted at all: every call is refused and counted, and none of them throws.
  const bare = new SaberSounds();
  const empty = new SaberFakeHost();
  empty.bank.available = false;
  bare.attach(empty as never, {});
  bare.ignite(b, true, { x: 0, y: 0, z: 0 });
  bare.swing('medium', null, 'BOTH_A1_T__B_', 0.5);
  bare.contact('body', { x: 0, y: 0, z: 0 });
  ok(empty.played.length === 0 && (bare.status() as { counts: { noSound: number } }).counts.noSound > 0, 'with nothing converted the blades are silent, say so, and nothing throws');
}

// ---- the Force powers ----
{
  const host = new SaberFakeHost();
  const s = sabersWith(host);
  s.follow({ x: 1, y: 2, z: 3 });
  const lightning = powerById('lightning')!;
  const jump = powerById('jump')!;
  s.power(jump, 'once');
  ok(host.played.length === 1 && host.played[0].id === 'sound/pl_force_jump.snd', 'a power that fires and is done plays one of the game\'s own sounds where the player is');
  host.played.length = 0;
  for (let i = 0; i < 4; i++) s.holdPower(lightning, true);
  const starts = host.played.filter((p) => p.id.endsWith('_begin.snd')).length;
  const loops = host.played.filter((p) => p.loop).length;
  ok(starts === 1 && loops === 1, 'one that lasts opens once and keeps one loop however many frames it is held for');
  s.holdPower(lightning, false);
  ok(host.played.some((p) => p.id.endsWith('_end.snd')) && host.stopped.length === 1, 'and letting go ends it and takes the loop with it');
  // A loop the mixer refuses (a full pool) must not make the opening sound ask again every frame.
  host.played.length = 0;
  host.refuse = true;
  for (let i = 0; i < 5; i++) s.holdPower(lightning, true);
  host.refuse = false;
  s.holdPower(lightning, true);
  ok(host.played.length === 0, 'a power whose loop the mixer refused does not bang its opening sound out on every frame it is held');
  s.stopPowers();
  ok((s.status() as { powers: unknown[] }).powers.length === 0, 'and a change of class lets go of everything a power was holding open');
}

// ---- a blade that stops being drawn without being put out ----
{
  const host = new SaberFakeHost();
  const s = sabersWith(host);
  const b = {} as object;
  s.ignite(b, true, { x: 4, y: 1, z: 0 });
  s.hum(b, { x: 4, y: 1, z: 0 }, { x: 4, y: 2, z: 0 }, 1 / 60);
  const loop = host.played.find((p) => p.loop)!;
  ok(!!loop && loop.id.startsWith('jka:hum'), 'a blade nobody owns still hums');
  // A mobile walks behind the camera: it is culled as a whole group, so its blade renderer stops
  // being called although the blade is still lit and nothing has said otherwise.
  host.now += 0.3;
  s.tick();
  ok(!host.stopped.includes(loop.key), 'a blade undrawn for a moment keeps its hum: a frame or two is not a disappearance');
  host.now += 1;
  s.tick();
  ok(host.stopped.includes(loop.key), 'one undrawn for longer has its hum let go rather than left hanging where it was last drawn');
  host.played.length = 0;
  host.now += 1;
  s.hum(b, { x: 9, y: 1, z: 0 }, { x: 9, y: 2, z: 0 }, 1 / 60);
  const again = host.played.find((p) => p.loop);
  ok(!!again && again.x === 9, 'and it hums again, where it now is, the moment it is drawn once more -- with no second ignition');
  ok(!host.played.some((p) => p.id === 'jka:on'), 'nothing lights twice for it');
  ok((s.status() as { counts: { lost: number } }).counts.lost === 1, 'the report counts what it swept up');
}

// ---- two blades are two sounds ----
{
  const host = new SaberFakeHost();
  const s = sabersWith(host);
  s.contact('block', { x: 0, y: 0, z: 0 });
  s.contact('block', { x: 0, y: 0, z: 1 });
  ok(host.played.length === 1, 'one blade ringing twice in the same instant and the same place is one sound');
  s.contact('block', { x: 40, y: 0, z: 0 });
  ok(host.played.length === 2, "and another fighter's blade across the room in the same instant is its own");
  host.played.length = 0;
  s.swing('fast', { x: 0, y: 0, z: 0 }, undefined, 0);
  s.swing('fast', { x: 0.5, y: 0, z: 0 }, undefined, 0);
  s.swing('fast', { x: 40, y: 0, z: 0 }, undefined, 0);
  ok(host.played.length === 2, 'the same holds for whooshes: a chain in one place is one, two fighters are two');
}

// ---- a move begun over the top of another ----
{
  const host = new SaberFakeHost();
  const clips = new ClipEventIndex();
  clips.adopt({
    jka: {
      clips: {
        BOTH_A2_SPECIAL: { frames: 41, upper: [{ type: 'sound', sound: 'sound/weapons/saber/saberhup%d.wav', range: [4, 6], frame: 4, frames: 41 }, { type: 'sound', sound: 'sound/weapons/saber/saberhup%d.wav', range: [4, 6], frame: 36, frames: 41 }] },
      },
    },
  });
  const s = sabersWith(host, { clips });
  s.swing('medium', { x: 0, y: 0, z: 0 }, 'BOTH_A2_SPECIAL', 4);
  const [early, late] = host.played;
  ok(host.played.length === 2, 'a kata lays its whooshes out along the move');
  // A quarter of the way through, the move is chained out of: the first whoosh has sounded, the
  // second has not.
  host.now += 1;
  s.cancel();
  ok(!host.stopped.includes(early.key) && host.stopped.includes(late.key), 'a move cut short takes only the whooshes that had not sounded yet, and lets the one already sounding finish');
}

// ---- the blade going into the water ----
{
  const host = new SaberFakeHost();
  const sea = { top: -1e9 };
  const world: SaberWorld = {
    listenerSpace: { building: -1, cell: -1 },
    weather: { fx: { rain: 0 }, roofs: { topAt: () => -1e9 } },
    footSurfaces: { waterTop: () => sea.top, space: () => null },
  };
  const s = sabersWith(host, { world });
  const b = {} as object;
  s.ignite(b, true, { x: 0, y: 1, z: 0 });
  s.hum(b, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }, 1 / 60);
  host.played.length = 0;
  sea.top = 9;
  host.now += 1;
  s.hum(b, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }, 1 / 60);
  ok(host.played.some((p) => p.id === 'jka:water'), 'the blade going into the water is heard meeting it, once, on the frame it does');
  host.played.length = 0;
  host.now += 1;
  s.hum(b, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }, 1 / 60);
  ok(!host.played.some((p) => p.id === 'jka:water'), 'and not again while it stays in it');
}

// ---- whose blade it is, decided again at every ignition ----
{
  const host = new SaberFakeHost();
  const s = sabersWith(host);
  const b = {} as object;
  // The first ignition lands before the kit has said which blades are the player's, which is what
  // happens whenever a blade is lit on a frame the game did not simulate.
  s.ignite(b, true, { x: 0, y: 1, z: 0 });
  s.hum(b, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }, 1 / 60);
  ok(host.played.some((p) => p.loop && p.id === 'jka:hum:jedi'), "a blade of nobody's hums as anybody else's");
  s.ignite(b, false, { x: 0, y: 1, z: 0 });
  s.follow({ x: 0, y: 0, z: 0 }, [b]);
  host.played.length = 0;
  host.now += 1;
  s.ignite(b, true, { x: 0, y: 1, z: 0 });
  s.hum(b, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }, 1 / 60);
  ok(host.played.some((p) => p.loop && p.id === 'jka:hum:single_1'), 'and the same blade lit again once the kit has spoken hums as the player, not as a stranger for ever');
}

// ---- the report is there before anything has made a sound ----
{
  const had = 'window' in globalThis;
  const dbg: Record<string, unknown> = {};
  (globalThis as unknown as { window?: unknown }).window = { __debug: dbg };
  const host = new SaberFakeHost();
  const s = new SaberSounds();
  // Adopted first, so attaching does not go looking for the pack over a network the test has none of.
  s.adopt(jkaPack());
  s.attach(host as never, {});
  const report = typeof dbg.sabers === 'function' ? (dbg.sabers as () => Record<string, unknown>)() : null;
  ok(!!report && !!(report as { roles: unknown }).roles, "the console's own report is hung the moment the mixer is, not on the first blade lit: a saber that is silent can be asked why");
  s.tick();
  ok(typeof dbg.sabers === 'function', 'and it is hung again if the game replaces what it was hung on');
  if (!had) delete (globalThis as unknown as { window?: unknown }).window;
}

// ---------------------------------------------------------------------------------------------
// The room the ear is in: what a wall does to a sound heard through it, what the room's own echo
// is sent, and what is not in the world at all. Every name this section declares is prefixed
// `mix`, so nothing here can collide with the sections above or with one appended after it.
// ---------------------------------------------------------------------------------------------
{
  const mixMade: MixNode[] = [];
  class MixParam {
    value: number;
    writes = 0;
    ramps = 0;
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
      this.ramps++;
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
  class MixNode {
    readonly kind: string;
    readonly outputs: MixNode[] = [];
    constructor(kind: string) {
      this.kind = kind;
      mixMade.push(this);
    }
    connect(to: MixNode) {
      this.outputs.push(to);
      return to;
    }
    disconnect(to?: MixNode) {
      if (!to) this.outputs.length = 0;
      else {
        const i = this.outputs.indexOf(to);
        if (i >= 0) this.outputs.splice(i, 1);
      }
    }
  }
  class MixGain extends MixNode {
    readonly gain = new MixParam(1);
    constructor() {
      super('gain');
    }
  }
  class MixPanner extends MixNode {
    panningModel = 'equalpower';
    distanceModel = 'inverse';
    refDistance = 1;
    rolloffFactor = 1;
    readonly positionX = new MixParam(0);
    readonly positionY = new MixParam(0);
    readonly positionZ = new MixParam(0);
    constructor() {
      super('panner');
    }
  }
  class MixSource extends MixNode {
    buffer: unknown = null;
    readonly playbackRate = new MixParam(1);
    onended: (() => void) | null = null;
    started: { at: number; offset: number } | null = null;
    constructor() {
      super('source');
    }
    start(at = 0, offset = 0) {
      this.started = { at, offset };
    }
    stop() {}
  }
  const mixBuffer = (channels: number, frames: number, rate: number) => ({
    numberOfChannels: channels,
    length: frames,
    sampleRate: rate,
    duration: frames / rate,
    getChannelData: () => new Float32Array(frames),
    copyToChannel: () => {},
  });
  const mixCtx = {
    currentTime: 0,
    sampleRate: 22050,
    destination: new MixNode('destination'),
    listener: { setPosition: () => {}, setOrientation: () => {} },
    createGain: () => new MixGain(),
    createPanner: () => new MixPanner(),
    createConvolver: () => Object.assign(new MixNode('convolver'), { buffer: null as unknown }),
    createBiquadFilter: () => Object.assign(new MixNode('filter'), { type: 'lowpass', frequency: new MixParam(0) }),
    createBufferSource: () => new MixSource(),
    createBuffer: (channels: number, frames: number, rate: number) => mixBuffer(channels, frames, rate),
  };

  const mixSettings: AudioSettings = { soundMaster: 1, soundAmbience: 1, soundEffects: 1, soundVoices: 1, soundFootsteps: 1, soundVehicles: 1, soundInterface: 1, soundMusic: 1, soundHeadphones: false, soundRoomEcho: true, soundInBackground: false, soundSabers: 'jka' };
  const mix = new AudioSystem('', mixSettings);
  mix.installOffline(mixCtx as unknown as BaseAudioContext);
  const mixEchoes = mixMade.filter((n) => n.kind === 'convolver');
  const mixReturns = mixMade.filter((n) => n instanceof MixGain && mixEchoes.some((c) => c.outputs.includes(n))) as MixGain[];
  ok(mixReturns.length === 2 && mixReturns.every((g) => g.gain.value === 1), 'both echoes stand open and are fed by each voice in turn, so a voice that leaves a room rings out instead of being cut off at the doorway');

  mix.bank.adopt({
    format: 1,
    templates: {
      'sound/fire.snd': plain({ category: 0, dim: 3, full: 20 }),
      'sound/bed.snd': plain({ category: 0, dim: 2, full: 8, loops: endless() }),
      'sound/click.snd': plain({ category: 4, dim: 2, full: 8, volume: noVariation(0.9) }),
      // The shape of the two rows of the game's own interface table that are category 2 and carry
      // a distance: on the effects layer, and in the world unless the caller says otherwise.
      'sound/zoom.snd': plain({ category: 2, dim: 2, full: 0.1, volume: noVariation(0.9) }),
      'sound/loop.snd': plain({ category: 0, dim: 3, full: 20, loops: endless() }),
      'sound/zoomloop.snd': plain({ category: 2, dim: 3, full: 20, loops: endless() }),
    },
  });
  mix.bank.provide('sample/a.wav', mixBuffer(1, 11025, 22050) as unknown as AudioBuffer);
  const mixOutside = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, space: { building: -1, cell: -1 } };
  const mixRoom = { ...mixOutside, space: { building: 4, cell: 2 } };
  /** Every send gain feeding echo `i`, newest slot last. */
  const mixSends = (i: number) => mixMade.filter((n) => n instanceof MixGain && n.outputs.includes(mixEchoes[i])) as MixGain[];

  // A fire out on the plain, with the ear out there with it: nothing is sent to either echo.
  mix.play('sound/fire.snd', { x: 3, y: 0, z: 0, space: { building: -1, cell: -1 } });
  mix.update(1 / 60, mixOutside);
  ok(mixSends(0).length === 1 && mixSends(0)[0].gain.value === 0 && mixSends(1)[0].gain.value === 0, 'a sound out of doors is sent to neither echo, whatever the setting says');
  ok((mix.status().echo as { using: number | null }).using === null, 'and the report says the ear is in no room');

  // The same fire, with both it and the ear in a building the game has not named: the ordinary echo.
  const mixFire = mixSends(0)[0];
  const mixHall = mixSends(1)[0];
  mix.stopAll();
  mixCtx.currentTime = 1;
  mix.play('sound/fire.snd', { x: 3, y: 0, z: 0, space: { building: 4, cell: 2 } });
  mix.update(1 / 60, mixRoom);
  ok(near(mixFire.gain.value, mix.tune.echoSend[0], 1e-6) && mixHall.gain.value === 0, "a sound standing in the ear's own room is sent to that room's echo, and to that one alone");

  // Mos Eisley's cantina and the four capitol lobbies: the interior table's room type 7, the long one.
  mix.setRoom(7);
  mixCtx.currentTime = 1.1;
  mix.update(1 / 60, mixRoom);
  ok(near(mixHall.gain.value, mix.tune.echoSend[1], 1e-6) && mixFire.gain.value === 0, 'a tall hall moves the whole voice to the long echo rather than adding it to the short one');
  ok((mix.status().echo as { room: number | null; using: number | null }).using === 1, 'and the report names which of the two is carrying the room');

  // The switch the owner asked for.
  mix.apply({ ...mixSettings, soundRoomEcho: false });
  mixCtx.currentTime = 1.2;
  mix.update(1 / 60, mixRoom);
  ok(mixFire.gain.value === 0 && mixHall.gain.value === 0, 'and turning the room echo off empties both sends');
  mix.apply(mixSettings);
  mixCtx.currentTime = 1.25;
  mix.update(1 / 60, mixRoom);

  // The two echoes are shared by every layer and return straight to the master, so a voice's send
  // has to carry its own layer's gain or a slider turned down would leave its echo playing.
  mix.apply({ ...mixSettings, soundAmbience: 0.25 });
  mixCtx.currentTime = 1.35;
  mix.update(1 / 60, mixRoom);
  ok(near(mixHall.gain.value, mix.tune.echoSend[1] * 0.25, 1e-6), "a layer's slider takes that layer's echo down with it, since the echoes return past the layer gains");
  mix.apply(mixSettings);

  // Heard through a wall: the muffled branch, and nothing of the room about it.
  mixCtx.currentTime = 1.45;
  mix.update(1 / 60, mixOutside);
  const mixVoice = (mix.status().voices as { muffled: boolean; echo: number }[])[0];
  ok(mixVoice.muffled && mixVoice.echo === 0, 'a sound in a room the ear has walked out of is muffled and is sent to no echo: it is not in the room any more');
  ok(mixFire.gain.value === 0 && mixHall.gain.value === 0, 'which the sends themselves say too');

  // An area bed has no place of its own: it is the sound of wherever the ear is, so the room's
  // echo is not for it.
  mix.stopAll();
  mix.setRoom(22);
  mixCtx.currentTime = 2;
  mix.play('sound/bed.snd', { loop: true, space: mixRoom.space });
  mix.update(1 / 60, mixRoom);
  const mixBedSends = mixSends(0);
  ok(mixBedSends[mixBedSends.length - 1].gain.value === 0, 'a bed, which stands wherever the ear does rather than anywhere in the room, is sent to no echo');

  // The interface is not in the world at all: a click must not be heard through the wall filter
  // because the player has stepped indoors, and must never be echoed. Played the way the game
  // plays it, through the interface's own table, so the mark the rule reads is the real one.
  mix.stopAll();
  mixCtx.currentTime = 3;
  mix.ui.attach({ backpack_open: 'sound/click.snd' });
  ok(mix.ui.play('panelOpen'), 'the interface plays its own table');
  mix.update(1 / 60, mixRoom);
  const mixClick = (mix.status().voices as { id: string; gain: number; muffled: boolean; echo: number; space: string }[]).find((v) => v.id === 'sound/click.snd');
  ok(!!mixClick && mixClick.gain === 1 && !mixClick.muffled && mixClick.echo === 0, 'an interface click is heard at its own gain inside a building, unmuffled and dry: it is not in the world');
  ok(mixClick!.space === 'not in the world', 'and the report says so rather than leaving it looking like a sound that has lost its room');

  // A slot is handed from voice to voice, and its muffling is a ramp: the one taking it over must
  // come in at its own value outright, not slide out of the last one's over a fifth of a second.
  mix.stopAll();
  mixCtx.currentTime = 4;
  mix.play('sound/fire.snd', { x: 3, y: 0, z: 0, space: { building: 9, cell: 0 } });
  mix.update(1 / 60, mixRoom);
  // The one slot every positional sound in this section has taken in turn, read from its panner:
  // the dry path, the muffled path and the low-pass at the end of it.
  const mixPan = mixMade.find((n) => n instanceof MixPanner) as MixPanner;
  const mixMuffled = mixPan.outputs.find((o) => o instanceof MixGain && o.outputs.some((x) => x.kind === 'filter')) as MixGain;
  const mixWall = mixMuffled.outputs.find((x) => x.kind === 'filter') as MixNode & { frequency: MixParam };
  const mixDry = mixPan.outputs.find((o) => o instanceof MixGain && o !== mixMuffled && !mixEchoes.some((c) => o.outputs.includes(c))) as MixGain;
  ok(near(mixMuffled.gain.value, DISTANCE_TUNE.muffleGain, 1e-6) && mixWall.frequency.value === DISTANCE_TUNE.muffleHz, 'a sound in another building goes through the low-pass at the muffling frequency');
  ok(!!mixDry && mixDry.gain.value === 0, 'and the dry path is a node of its own, closed while it is muffled, so the two are a crossfade and not a switch');
  mix.stopAll();
  mixCtx.currentTime = 5;
  const mixWrites = mixMuffled.gain.writes;
  mix.play('sound/fire.snd', { x: 3, y: 0, z: 0, space: { building: 4, cell: 2 } });
  mix.update(1 / 60, mixRoom);
  ok(mixMuffled.gain.value === 0 && mixDry.gain.value === 1 && mixMuffled.gain.writes > mixWrites, "the voice that takes the slot over is written dry on the frame it starts, rather than easing out of the last voice's muffling");

  // A loop coming round again is the same voice, not a new one: it must not be snapped out of a
  // crossfade it is part way through (a bed looping while the player walks through a doorway).
  mix.stopAll();
  mixCtx.currentTime = 7;
  mix.play('sound/loop.snd', { x: 3, y: 0, z: 0, space: { building: 4, cell: 2 }, loop: true });
  mix.update(1 / 60, mixRoom);
  const mixStarted = () => (mix.status().counts as { started: number }).started;
  const mixLoops = mixStarted();
  const mixSteady = mixMuffled.gain.writes + mixDry.gain.writes + mixFire.gain.writes;
  mixCtx.currentTime = 7.6;
  mix.update(1 / 60, mixRoom);
  ok(mixStarted() > mixLoops, 'a loop comes round again on its own clock');
  ok(mixMuffled.gain.writes + mixDry.gain.writes + mixFire.gain.writes === mixSteady, 'and nothing about its room is written again, because nothing about it moved');

  // Headphones: the browser loads its head-related impulses the first time a panner is asked for
  // them, so that is done once, when the setting is asked for, and not on the first shot fired.
  const mixPanners = () => mixMade.filter((n) => n instanceof MixPanner) as MixPanner[];
  const mixBefore = mixPanners().length;
  ok(!(mix.status().headphones as { warmedAsked: boolean }).warmedAsked, 'nothing is warmed while the game is on speakers');
  mix.apply({ ...mixSettings, soundHeadphones: true });
  const mixWarm = mixPanners().slice(mixBefore);
  ok(mixWarm.length === 1 && mixWarm[0].panningModel === 'HRTF', 'switching headphones on builds one panner of its own and asks it for the head-related model, before any voice is placed');
  ok((mix.status().headphones as { warmedAsked: boolean; disagreeing: number }).warmedAsked, 'and the report says the warm-up has been asked for, which is as much as script can know: the browser finishes its own load');
  mix.apply({ ...mixSettings, soundHeadphones: false });
  mix.apply({ ...mixSettings, soundHeadphones: true });
  ok(mixPanners().length === mixBefore + 1, 'switching it off and on again costs nothing: the impulses are loaded once for the session');
  mixCtx.currentTime = 6;
  mix.stopAll();
  mix.play('sound/fire.snd', { x: 3, y: 0, z: 0, space: { building: 4, cell: 2 } });
  mix.update(1 / 60, mixRoom);
  ok((mix.status().headphones as { disagreeing: number }).disagreeing === 0 && mixPanners().slice(-1)[0].panningModel === 'HRTF', 'and a voice placed after the switch is placed around the head, with no slot left on the other model');
  mix.apply(mixSettings);

  // Stepping out of a room the game had named. The caller says -1, and the ear's own space still
  // says it is in a building, so the echo stays on and goes back to the ordinary one.
  mix.stopAll();
  mixCtx.currentTime = 10;
  mix.setRoom(7);
  mix.play('sound/fire.snd', { x: 3, y: 0, z: 0, space: mixRoom.space });
  mix.update(1 / 60, mixRoom);
  ok((mix.status().echo as { using: number | null }).using === 1, 'a room the game has named as a tall hall takes the long echo');
  mix.setRoom(-1);
  mixCtx.currentTime = 10.1;
  mix.update(1 / 60, mixRoom);
  ok((mix.status().echo as { room: number | null; using: number | null }).room === null && (mix.status().echo as { using: number | null }).using === 0, 'and stepping out of it goes back to the ordinary one rather than staying in the hall');

  // The room belongs to the world, so it goes when the world does.
  mix.setRoom(7);
  mix.stopAll();
  mixCtx.currentTime = 10.2;
  mix.update(1 / 60, mixOutside);
  ok((mix.status().echo as { room: number | null; using: number | null }).room === null && (mix.status().echo as { using: number | null }).using === null, 'everything let go takes the room with it, so a travel out of a hall does not leave the open world ringing');

  // The override the console has, for comparing the two echoes without walking to the one room
  // that asks for the long one.
  mix.tune.echoRoom = 7;
  mixCtx.currentTime = 10.3;
  mix.play('sound/fire.snd', { x: 3, y: 0, z: 0, space: { building: -1, cell: -1 } });
  mix.update(1 / 60, mixOutside);
  ok((mix.status().echo as { using: number | null; forcedRoom: number | null }).using === 1, 'the console can stand the ear in a tall hall wherever it is, which is how the two echoes are compared');
  ok((mix.status().echo as { forcedRoom: number | null }).forcedRoom === 7, 'and the report says the room was forced rather than named by the game');
  mix.tune.echoRoom = -1;
  mix.stopAll();

  // Not in the world is the caller's word, not the template's category: two rows of the game's own
  // interface table are category 2 and carry a distance, and would go silent indoors on the old
  // rule, which read the pool the category had put the voice in.
  mixCtx.currentTime = 11;
  mix.play('sound/zoom.snd', { ui: true });
  mix.update(1 / 60, mixRoom);
  const mixZoom = (mix.status().voices as { id: string; gain: number; muffled: boolean; echo: number; space: string }[]).find((v) => v.id === 'sound/zoom.snd');
  ok(!!mixZoom && mixZoom.gain === 1 && !mixZoom.muffled && mixZoom.space === 'not in the world', 'an interface row that is not on the interface layer is still not in the world when the caller says so');
  mix.stopAll();
  mixCtx.currentTime = 11.5;
  mix.play('sound/zoom.snd');
  mix.update(1 / 60, mixRoom);
  const mixZoomWorld = (mix.status().voices as { id: string; gain: number; space: string }[]).find((v) => v.id === 'sound/zoom.snd');
  ok(!!mixZoomWorld && mixZoomWorld.gain === 0 && mixZoomWorld.space !== 'not in the world', 'and the same row played as a sound in the world is shut out by the wall, which is what the caller is saying it is not');

  // The four-times-a-second path has to answer the same way, or a looping voice the caller has
  // taken out of the world would be distance-tested after being exempted everywhere else.
  mix.stopAll();
  mixCtx.currentTime = 12;
  mix.loop('sound/zoomloop.snd', { x: 900, y: 0, z: 0, space: { building: -1, cell: -1 }, ui: true });
  mix.loop('sound/loop.snd', { x: 900, y: 0, z: 0, space: { building: -1, cell: -1 } });
  // The grid's own beat is a quarter of a second of frames, not a jump of the clock.
  for (let i = 0; i < 20; i++) {
    mixCtx.currentTime = 12 + (i + 1) / 60;
    mix.update(1 / 60, mixOutside);
  }
  const mixFar = mix.status().voices as { id: string; gain: number }[];
  ok(mixFar.find((v) => v.id === 'sound/loop.snd')!.gain === 0, 'a loop nine hundred metres off is out of earshot on the grid pass');
  ok(mixFar.find((v) => v.id === 'sound/zoomloop.snd')!.gain === 1, 'while one the caller has taken out of the world is heard at its own gain there too, the same answer the frame path gives');

  // A voice played before its emitter was known and moved afterwards has a place from then on.
  mix.stopAll();
  mixCtx.currentTime = 13;
  const mixLate = mix.play('sound/fire.snd', { space: mixRoom.space });
  mix.update(1 / 60, mixRoom);
  ok((mix.status().voices as { space: string }[])[0].space === 'no place', 'a voice played with no point stands wherever the ear does');
  mix.move(mixLate, 3, 0, 0);
  mixCtx.currentTime = 13.1;
  mix.update(1 / 60, mixRoom);
  ok((mix.status().voices as { space: string }[])[0].space === '4:2', 'and moving it to a point gives it one, so it fades with distance and can be echoed like anything else in the room');
}

console.log(`\n${passed} checks passed`);
