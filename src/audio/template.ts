/**
 * One of the game's sound templates as pure state: which sample to start, when, at what pitch and
 * volume, how many times, and with what gaps. No Web Audio and no wall clock -- every time handed
 * in and out is the audio clock's, in seconds, which is the one clock everything inside a template
 * runs on. A node test feeds it a seeded random and fixed times.
 *
 * The template's own fields come from the client's `.snd` files. Fields 0 to 10, 18, 19, 23, 24,
 * 26 and 27 are plain in the data; the variation and order modes (11 to 17, 20, 22, 25) are a
 * READING of how the values are used, since what the client did with them is not in the archives.
 * The reading lives here alone, so it can be changed in one place.
 */

/** 0..1, like Math.random; the tests hand in a seeded one. */
export type Rng = () => number;

export interface Variation {
  /** 0 none, 1 drawn once, 2 drawn for each play, 3 drifting. */
  mode: number;
  range: readonly [number, number];
  /** Seconds between draws while drifting; left out when there is no drift. */
  period?: number;
  /** Seconds each drift takes to arrive. */
  glide?: number;
}

/**
 * A converted `.snd`. The ids are the archive paths (`sound/cr_bantha_hit_heavy.snd`).
 *
 * The converter leaves out every part of a template that is all zero (which is most of most of
 * them, and about a third of the file's bytes), so everything but the five fields the pack always
 * writes is optional here and `DEFAULTS` below says what an absent one means.
 */
export interface SoundTemplate {
  /** 2 non-positional, 3 positional. */
  dim: 2 | 3;
  samples: readonly string[];
  /** 0 ambient, 1 explosion, 2 item, 3 movement, 4 interface, 5 vehicle, 6 vocalization, 7 weapon, 8 music, 9 player music, 10 machine, 13 voice-over. */
  category: number;
  /** 0 highest to 9. */
  priority: number;
  /** Metres within which it plays at full volume. */
  full: number;
  delay?: readonly [number, number];
  fadeIn?: readonly [number, number];
  /** Loop count; below zero, or 99 and up, is for ever. Absent means one play. */
  loops?: readonly [number, number];
  gap?: readonly [number, number];
  fadeOut?: readonly [number, number];
  /** 0 random, 1 random without repeat, 2 in order. */
  order?: number;
  /** 2: the gap is drawn again for every loop. */
  gapMode?: number;
  fadeModes?: readonly [number, number];
  volume?: Variation;
  /** The range is in semitones. */
  pitch?: Variation;
  /** No usable sample: it is kept so a lookup never throws, and nothing is started for it. */
  silent?: boolean;
  /** Music the game places in the world (a cantina band), which plays on the ambience slider. */
  placedMusic?: boolean;
  /**
   * Music the converter kept although the score is left out, because a scene of the game plays it
   * (the hyperspace stages). It is the ship's own noise rather than a score, so it takes the
   * effects slider: the music bus has no slider of its own until the music pass.
   */
  keptMusic?: string;
}

const ZERO: readonly [number, number] = [0, 0];
const ONCE: readonly [number, number] = [1, 1];
const NO_VOLUME: Variation = { mode: 0, range: [1, 1] };
const NO_PITCH: Variation = { mode: 0, range: [0, 0] };

/** What one loop of a template asks the mixer to start. Pooled by the caller; never allocated per frame. */
export interface SoundStart {
  /** Index into the template's samples. */
  sample: number;
  /** Audio-clock time to start it at. */
  at: number;
  /** `playbackRate` for the source. */
  rate: number;
  /** Linear gain before the category, the group and the distance. */
  gain: number;
  fadeIn: number;
  /** Which loop this is, counting from 0. */
  index: number;
}

export function makeStart(): SoundStart {
  return { sample: 0, at: 0, rate: 1, gain: 1, fadeIn: 0, index: 0 };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const draw = (range: readonly [number, number], rng: Rng) => (range[1] === range[0] ? range[0] : range[0] + (range[1] - range[0]) * rng());

/** A loop count of -1 loops for ever, and so does 99 (56 templates carry 99 and nothing carries more). */
export function endless(n: number): boolean {
  return n < 0 || n >= 99;
}

/** Semitones to `playbackRate`. */
export function rateOf(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/**
 * A value that drifts (variation mode 3): every `period` seconds it draws a new target and glides
 * to it over `glide` seconds. Asking for the same time twice gives the same answer.
 */
export class Drift {
  private readonly range: readonly [number, number];
  private readonly period: number;
  private readonly glide: number;
  private readonly rng: Rng;
  private from: number;
  private to: number;
  private start: number;
  private until: number;

  constructor(range: readonly [number, number], period: number, glide: number, rng: Rng, now: number) {
    this.range = range;
    this.period = period;
    this.glide = glide;
    this.rng = rng;
    this.from = draw(range, rng);
    this.to = draw(range, rng);
    this.start = now;
    this.until = now + Math.max(0.05, period);
  }

  at(t: number): number {
    // A tab that comes back after minutes must not walk thousands of draws: past a hundred periods
    // the drift is simply restarted at its target.
    if (t > this.until + this.period * 100) {
      this.from = this.to;
      this.to = draw(this.range, this.rng);
      this.start = t;
      this.until = t + Math.max(0.05, this.period);
    }
    while (t >= this.until) {
      this.from = this.valueAt(this.until);
      this.to = draw(this.range, this.rng);
      this.start = this.until;
      this.until += Math.max(0.05, this.period);
    }
    return this.valueAt(t);
  }

  private valueAt(t: number): number {
    if (this.glide <= 0) return this.to;
    const g = clamp01((t - this.start) / this.glide);
    return this.from + (this.to - this.from) * (g * g * (3 - 2 * g));
  }
}

/**
 * One playing template. The caller asks `nextDue(until, out)` for the loop that should start, and
 * tells it how long that sound runs with `began(seconds)`, which arms the one after it. A template
 * whose samples are not loaded yet simply has nothing armed, and the next call tries again.
 */
export class TemplateRun {
  readonly template: SoundTemplate;
  private readonly rng: Rng;
  /** The audio time the first loop is due (the drawn delay is already in it). */
  readonly begin: number;
  /** How many loops in all; Infinity for a loop that never ends. */
  readonly total: number;
  /** The fade-out drawn for this run, for whoever stops it. */
  readonly fadeOut: number;
  private index = 0;
  private armed: number;
  /** The start `nextDue` last handed out; `began` measures the next loop from it. */
  private handed = 0;
  private waiting = false;
  private last = -1;
  private cursor = 0;
  private readonly fixedGain: number;
  private readonly fixedPitch: number;
  private readonly volDrift: Drift | null;
  private readonly pitchDrift: Drift | null;
  private gap: number;
  private done = false;
  /** The template's own settings with the pack's omissions filled in, read once here. */
  private readonly vol: Variation;
  private readonly pit: Variation;
  private readonly fadeInRange: readonly [number, number];
  private readonly gapRange: readonly [number, number];
  private readonly gapMode: number;
  private readonly order: number;

  constructor(template: SoundTemplate, rng: Rng, now: number) {
    this.template = template;
    this.rng = rng;
    const t = template;
    this.vol = t.volume ?? NO_VOLUME;
    this.pit = t.pitch ?? NO_PITCH;
    this.fadeInRange = t.fadeIn ?? ZERO;
    this.gapRange = t.gap ?? ZERO;
    this.gapMode = t.gapMode ?? 0;
    this.order = t.order ?? 0;
    this.begin = now + draw(t.delay ?? ZERO, rng);
    this.armed = this.begin;
    const loops = Math.round(draw(t.loops ?? ONCE, rng));
    this.total = endless(loops) ? Infinity : Math.max(1, loops);
    this.fadeOut = draw(t.fadeOut ?? ZERO, rng);
    this.gap = draw(this.gapRange, rng);
    // Mode 0 is no variation at all, and every template with it has min equal to max; the midpoint
    // is used so a stray range cannot bias the whole game loud or sharp. Mode 1 draws once here.
    this.fixedGain = this.vol.mode === 1 ? draw(this.vol.range, rng) : (this.vol.range[0] + this.vol.range[1]) / 2;
    this.fixedPitch = this.pit.mode === 1 ? draw(this.pit.range, rng) : (this.pit.range[0] + this.pit.range[1]) / 2;
    this.volDrift = this.vol.mode === 3 ? new Drift(this.vol.range, this.vol.period ?? 0, this.vol.glide ?? 0, rng, this.begin) : null;
    this.pitchDrift = this.pit.mode === 3 ? new Drift(this.pit.range, this.pit.period ?? 0, this.pit.glide ?? 0, rng, this.begin) : null;
  }

  /** Nothing left to start, and nothing playing that this run will start again. */
  get finished(): boolean {
    return this.done || this.index >= this.total;
  }

  /** The audio time the next loop is due, or Infinity when there is none. */
  get dueAt(): number {
    return this.finished || this.waiting ? Infinity : this.armed;
  }

  /** This run loops for ever, so it is a bed rather than a one-shot. */
  get loops(): boolean {
    return this.total === Infinity;
  }

  /** Stop arming loops (the caller fades the sound out over `fadeOut`). */
  stop(): void {
    this.done = true;
  }

  /**
   * Fills `out` with the loop due at or before `until` and returns true, or returns false when
   * none is. The caller must then call `began` with the sound's length, or nothing follows it.
   */
  nextDue(until: number, out: SoundStart): boolean {
    if (this.finished || this.waiting || this.armed > until) return false;
    const at = this.armed;
    out.sample = this.pick();
    out.at = at;
    out.index = this.index;
    out.fadeIn = this.fadeInRange[0] === 0 && this.fadeInRange[1] === 0 ? 0 : draw(this.fadeInRange, this.rng);
    out.gain = clamp01(this.volumeAt(at));
    out.rate = rateOf(this.pitchAt(at));
    this.index++;
    this.handed = at;
    // Nothing more is due until the caller says how long this one runs.
    this.waiting = true;
    return true;
  }

  /** The loop just handed out plays for this many seconds at rate 1: arm the next after it and the gap. */
  began(lengthSeconds: number, rate = 1): void {
    if (!this.waiting) return;
    this.waiting = false;
    // Gap mode 2 draws the gap again for every loop, which is what makes the random one-shot beds
    // come round at an uneven 15 to 30 seconds rather than on a beat.
    if (this.gapMode === 2) this.gap = draw(this.gapRange, this.rng);
    const len = lengthSeconds > 0 ? lengthSeconds / Math.max(0.01, rate) : 0;
    this.armed = this.handed + len + Math.max(0, this.gap);
  }

  /** Volume for a loop starting at this time, before the category and the distance. */
  volumeAt(t: number): number {
    if (this.volDrift) return this.volDrift.at(t);
    if (this.vol.mode === 2) return draw(this.vol.range, this.rng);
    return this.fixedGain;
  }

  /** Pitch shift in semitones for a loop starting at this time. */
  pitchAt(t: number): number {
    if (this.pitchDrift) return this.pitchDrift.at(t);
    if (this.pit.mode === 2) return draw(this.pit.range, this.rng);
    return this.fixedPitch;
  }

  /**
   * Where a loop that has been waiting as a virtual voice should resume: a bed picks up where its
   * own clock has reached rather than starting again from the beginning.
   *
   * A positive answer is seconds into the sample. A negative one means the bed's clock is inside
   * the gap between two loops, and the caller should wait that many seconds before starting it at
   * the top: coming in part way through the sample instead would put a bed's own silence in the
   * wrong place.
   */
  offsetInto(now: number, lengthSeconds: number): number {
    if (lengthSeconds <= 0) return 0;
    const elapsed = now - this.begin;
    if (elapsed <= 0) return 0;
    const gap = Math.max(0, this.gap);
    const round = elapsed % (lengthSeconds + gap);
    return round < lengthSeconds ? round : -(lengthSeconds + gap - round);
  }

  private pick(): number {
    const n = this.template.samples.length;
    if (n <= 1) return 0;
    let i: number;
    if (this.order === 2) {
      i = this.cursor % n;
      this.cursor++;
    } else if (this.order === 1) {
      // Random without repeat: never the sample just played.
      i = Math.min(n - 2, Math.floor(this.rng() * (n - 1)));
      if (this.last >= 0 && i >= this.last) i++;
    } else {
      i = Math.min(n - 1, Math.floor(this.rng() * n));
    }
    this.last = i;
    return i;
  }
}

/** A small deterministic random, so the tests and any replay give the same draws. */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
