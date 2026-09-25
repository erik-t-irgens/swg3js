/**
 * The sound bank: the converted templates, the samples they name, and the decoded audio held for
 * them. Nothing here is awaited on a visual path -- a loop starts when its buffer is ready and a
 * one-shot asked for before its buffer arrives waits a moment and is then dropped.
 *
 * It must work with nothing converted: with no `sounds/sounds.json` the bank simply holds no
 * templates, `available` is false, and everything that asks for a sound is refused and counted.
 *
 * Decoding: a WAV goes to the worker (Float32 at the file's own rate, transferred back), anything
 * else to the browser's own decoder. The main thread only makes the AudioBuffer and copies the
 * samples in, in slices, so a long bed never costs a whole frame.
 *
 * INVENTED: the memory budget, the number of decodes in flight, the slice size and the wait a
 * one-shot gives its buffer. They sit together in BANK_TUNE, live through `__debug.audio`.
 */
import { parseWav, type WavReply } from './wavWorker.ts';
import type { SoundTemplate } from './template.ts';

export interface BankTune {
  /** INVENTED: bytes of decoded audio held before the least recently used are given back. */
  budget: number;
  /** INVENTED: fetches and decodes running at once. */
  inFlight: number;
  /** INVENTED: bytes copied into AudioBuffers per pump, so a 15 MB bed costs many cheap frames. */
  sliceBytes: number;
  /** INVENTED: seconds a one-shot waits for its buffer before it is dropped. */
  patience: number;
  /**
   * INVENTED: seconds a sample may be outstanding with the worker before the bank gives up on it
   * and reads it on this thread instead. Without a ceiling a lost reply would hold one of the
   * `inFlight` places for ever, and four of them would stop all sound loading for the session.
   */
  workerTimeout: number;
}

export const BANK_TUNE: BankTune = { budget: 192 * 1024 * 1024, inFlight: 4, sliceBytes: 256 * 1024, patience: 0.15, workerTimeout: 5 };

/** The pack shape this runtime reads. The converter writes its own; an older one asks for a rerun. */
export const SOUND_FORMAT_READ = 1;

/** A line of the index per sample, so a sound's length is known before it is decoded. */
export interface SampleInfo {
  bytes: number;
  rate?: number;
  channels?: number;
  seconds?: number;
  /** Frames, only on the three samples that loop part of themselves. */
  loop?: [number, number];
  /** Set when the file cannot be read at all. */
  unreadable?: string;
}

/** What the converter writes at `sounds/sounds.json`. */
export interface SoundIndex {
  format: number;
  templates: Record<string, SoundTemplate>;
  samples?: Record<string, SampleInfo>;
  /** The game's own category names, keyed by the category number. */
  categories?: Record<string, string>;
  /** How many templates the pack holds per category. */
  counts?: Record<string, number>;
  /** Sample paths the archives do not hold, kept so the bank never asks for them twice. */
  missing?: string[];
  /** Samples whose file cannot be read (a zero-filled one), with why. */
  unreadable?: { sample: string; why: string }[];
}

/** What the converter writes at `sounds/sources.json`; only the interface table is read this wave. */
export interface SoundSources {
  interface?: Record<string, string>;
  [table: string]: unknown;
}

interface Entry {
  /** The archive path, which is also the file's path under `sounds/`. */
  sample: string;
  buffer: AudioBuffer | null;
  bytes: number;
  /** Audio time it was last asked for, for the least-recently-used sweep. */
  touched: number;
  /** A voice is playing it: never evicted. */
  playing: number;
  state: 'idle' | 'loading' | 'decoding' | 'filling' | 'ready' | 'failed';
  /** Decoded channels waiting to be copied into the buffer, and how far the copy has got. */
  pending: Float32Array[] | null;
  pendingRate: number;
  filled: number;
  /** The worker could not read it (or was lost): it is fetched again for the browser's decoder. */
  mainThreadOnly: boolean;
}

/**
 * How much may be given back, least recently used first. Pure, so the node test can crowd it:
 * anything playing stays, and the sweep stops as soon as the budget is met.
 */
export function planEviction(entries: readonly { sample: string; bytes: number; touched: number; playing: number; ready: boolean }[], held: number, budget: number): string[] {
  if (held <= budget) return [];
  const free = entries.filter((e) => e.ready && !e.playing).sort((a, b) => a.touched - b.touched);
  const out: string[] = [];
  let left = held;
  for (const e of free) {
    if (left <= budget) break;
    out.push(e.sample);
    left -= e.bytes;
  }
  return out;
}

export class SoundBank {
  /** The pack is there and readable. False until `load` has found it. */
  available = false;
  /** Why it is not, for the headless report. */
  why = 'not loaded yet';
  readonly tune: BankTune;
  /** The tables the converter writes beside the templates (the interface table is read this wave). */
  sources: SoundSources | null = null;
  private readonly baseUrl: string;
  private index: SoundIndex | null = null;
  private ctx: BaseAudioContext | null = null;
  private worker: Worker | null = null;
  /** Once it has failed it is not made again: everything after it is read on this thread. */
  private workerDead = false;
  private readonly entries = new Map<string, Entry>();
  private readonly queue: string[] = [];
  /** The entries being copied into their buffers, so a pump never walks every sample ever asked for. */
  private readonly filling: Entry[] = [];
  /** Samples out with the worker, with the audio time each went, for the timeout. */
  private readonly awaiting = new Map<string, { entry: Entry; at: number }>();
  private flying = 0;
  private held = 0;
  /** Counters a hidden tab reads instead of listening. */
  readonly counts = { asked: 0, missing: 0, failed: 0, evicted: 0, hotEvicted: 0, decoded: 0, workerLost: 0, workerRefused: 0 };
  /** Audio time, handed in by the system so the bank never reads a clock of its own. */
  now = 0;

  constructor(baseUrl: string, tune: BankTune = BANK_TUNE) {
    this.baseUrl = baseUrl;
    this.tune = tune;
  }

  /** The context every buffer is made in; given once the system has one. */
  attach(ctx: BaseAudioContext): void {
    this.ctx = ctx;
  }

  /** For the node test and for a pack fetched elsewhere. */
  adopt(index: SoundIndex): void {
    // A pack from an older converter is refused outright rather than half-read: every other pack in
    // the game is version-checked at the runtime too, and the message names the rerun.
    if ((index.format ?? 0) < SOUND_FORMAT_READ) {
      this.index = null;
      this.available = false;
      this.why = `the sound pack is from an older converter (format ${index.format ?? 0}, this game reads ${SOUND_FORMAT_READ}); run the sounds command again`;
      return;
    }
    this.index = index;
    this.available = true;
    this.why = '';
    const dead = (s: string) => this.entries.set(s, { sample: s, buffer: null, bytes: 0, touched: 0, playing: 0, state: 'failed', pending: null, pendingRate: 0, filled: 0, mainThreadOnly: false });
    for (const s of index.missing ?? []) dead(s);
    for (const u of index.unreadable ?? []) dead(u.sample);
  }

  /** A decoded sample handed straight in, for the offline self test and the node test. */
  provide(sample: string, buffer: AudioBuffer): void {
    const e = this.want(sample);
    const i = this.queue.indexOf(sample);
    if (i >= 0) this.queue.splice(i, 1);
    e.buffer = buffer;
    e.bytes = buffer.numberOfChannels * buffer.length * 4;
    e.state = 'ready';
    this.held += e.bytes;
  }

  /**
   * Fetch the index and the tables. Never throws: with no pack the game runs silently, says why,
   * and every later request is refused and counted rather than guessed at.
   */
  async load(): Promise<boolean> {
    if (this.index) return true;
    try {
      const res = await fetch(`${this.baseUrl}assets-private/sounds/sounds.json`);
      if (!res.ok) {
        this.why = `no sound pack (${res.status}); run the sounds command`;
        return false;
      }
      this.adopt((await res.json()) as SoundIndex);
    } catch (err) {
      this.why = `the sound pack could not be read: ${String((err as Error)?.message ?? err)}`;
      return false;
    }
    try {
      const res = await fetch(`${this.baseUrl}assets-private/sounds/sources.json`);
      if (res.ok) this.sources = (await res.json()) as SoundSources;
    } catch {
      /* the tables are not needed for a sound to play */
    }
    return true;
  }

  template(id: string): SoundTemplate | null {
    return this.offered.get(id) ?? this.index?.templates[id] ?? null;
  }

  /**
   * Templates made outside the game's own pack, hung in front of its lookup.
   *
   * The game's sounds each come from a `.snd`; Jedi Academy's saber files and the player music's
   * stems have none at all, so whoever plays them makes a template and offers it here. It is a Map
   * rather than a write into the index, so nothing a conversion wrote is ever overwritten and a
   * pack reloaded under it keeps every offer.
   */
  private readonly offered = new Map<string, SoundTemplate>();

  offer(id: string, template: SoundTemplate): void {
    this.offered.set(id, template);
  }

  get templateCount(): number {
    return this.index ? Object.keys(this.index.templates).length : 0;
  }

  /** Ask for everything a thing will need (a planet's beds, a species' steps, a weapon's set). */
  prepare(ids: Iterable<string>): void {
    for (const id of ids) {
      const t = this.template(id);
      if (!t || t.silent) continue;
      for (const s of t.samples) this.want(s);
    }
  }

  /**
   * The decoded sound, or null while it is still coming. A buffer whose samples are still being
   * copied in is not handed out: a source started on one would play the zeros that are there yet,
   * and write into a buffer already in use, which Web Audio does not define.
   */
  buffer(sample: string): AudioBuffer | null {
    const e = this.want(sample);
    e.touched = this.now;
    return e.state === 'ready' ? e.buffer : null;
  }

  /**
   * How long a sample runs, in seconds. The index carries it, so a bed's next loop can be armed
   * before anything is decoded and a loop never waits a frame to find out how long it is.
   */
  length(sample: string): number {
    const buffer = this.entries.get(sample)?.buffer;
    if (buffer) return buffer.duration;
    return this.index?.samples?.[sample]?.seconds ?? 0;
  }

  /** A voice took this sample: it is not evicted while it plays. */
  hold(sample: string): void {
    const e = this.entries.get(sample);
    if (e) e.playing++;
  }

  drop(sample: string): void {
    const e = this.entries.get(sample);
    if (e && e.playing > 0) e.playing--;
  }

  /**
   * Called from the system's update: starts what the queue allows, copies pending samples into
   * their buffers a slice at a time, and gives memory back when the budget is past.
   */
  pump(now: number): void {
    this.now = now;
    this.checkWorker(now);
    while (this.flying < this.tune.inFlight && this.queue.length) {
      const sample = this.queue.shift()!;
      const e = this.entries.get(sample);
      if (!e || e.state !== 'idle') continue;
      this.flying++;
      void this.fetchOne(e);
    }
    // Only the entries being copied in, never every sample ever asked for.
    let left = this.tune.sliceBytes;
    for (let i = this.filling.length - 1; i >= 0; i--) {
      const e = this.filling[i];
      if (e.state !== 'filling' || !e.pending) {
        this.filling.splice(i, 1);
        continue;
      }
      left -= this.fill(e, left);
      if (e.state !== 'filling') this.filling.splice(i, 1);
      if (left <= 0) break;
    }
    this.sweep();
  }

  status(): Record<string, unknown> {
    let ready = 0;
    let loading = 0;
    let failed = 0;
    for (const e of this.entries.values()) {
      if (e.state === 'ready') ready++;
      else if (e.state === 'failed') failed++;
      else loading++;
    }
    return {
      available: this.available,
      why: this.why || undefined,
      templates: this.templateCount,
      perCategory: this.index?.counts,
      tables: this.sources ? Object.keys(this.sources) : null,
      samples: { ready, loading, failed, queued: this.queue.length, inFlight: this.flying, filling: this.filling.length, withWorker: this.awaiting.size },
      memoryMB: Number((this.held / 1048576).toFixed(1)),
      budgetMB: Number((this.tune.budget / 1048576).toFixed(0)),
      counts: { ...this.counts },
    };
  }

  /** Everything given back (a travel, a switch of character). Playing voices must be stopped first. */
  forget(): void {
    this.entries.clear();
    this.queue.length = 0;
    this.filling.length = 0;
    this.awaiting.clear();
    this.held = 0;
  }

  private want(sample: string): Entry {
    let e = this.entries.get(sample);
    if (!e) {
      e = { sample, buffer: null, bytes: 0, touched: this.now, playing: 0, state: 'idle', pending: null, pendingRate: 0, filled: 0, mainThreadOnly: false };
      this.entries.set(sample, e);
      this.counts.asked++;
    }
    if (e.state === 'idle' && !this.queue.includes(sample)) this.queue.push(sample);
    return e;
  }

  /**
   * One sample from the pack. The slot in flight is given back at exactly one place per path: on
   * the worker path the reply gives it back, so four long WAVs never all decode at once.
   */
  private async fetchOne(e: Entry): Promise<void> {
    e.state = 'loading';
    let bytes: ArrayBuffer;
    try {
      // The pack keeps every sample under its own archive path (`sample/x.wav`, `voice/sample/…`).
      const res = await fetch(`${this.baseUrl}assets-private/sounds/samples/${e.sample}`);
      if (!res.ok) {
        e.state = 'failed';
        this.counts.missing++;
        this.flying--;
        return;
      }
      bytes = await res.arrayBuffer();
    } catch {
      e.state = 'failed';
      this.counts.failed++;
      this.flying--;
      return;
    }
    e.state = 'decoding';
    if (!e.mainThreadOnly && /\.wav$/i.test(e.sample) && this.decodeInWorker(e, bytes)) return;
    await this.decodeHere(e, bytes);
    this.flying--;
  }

  /** True when this path has taken the entry (and will give the in-flight slot back itself). */
  private decodeInWorker(e: Entry, bytes: ArrayBuffer): boolean {
    const w = this.ensureWorker();
    if (!w) {
      // No worker (an old browser, or a test): the very same reader, on this thread.
      const data = parseWav(bytes);
      if (!data) return false;
      this.received(e, data.channels, data.sampleRate);
      this.flying--;
      return true;
    }
    this.awaiting.set(e.sample, { entry: e, at: this.now });
    w.postMessage({ id: e.sample, bytes }, [bytes]);
    return true;
  }

  /** One reply from the worker. One listener for the worker's life, not one per request. */
  private onWorkerMessage(reply: WavReply): void {
    const out = this.awaiting.get(reply.id);
    if (!out) return;
    this.awaiting.delete(reply.id);
    this.flying--;
    const e = out.entry;
    if (reply.silent) {
      // Genuinely unusable: fifteen of the archives' samples are zero-filled.
      e.state = 'failed';
      this.counts.failed++;
      return;
    }
    if (!reply.ok || !reply.channels) {
      // Not 16-bit PCM, so the browser's own decoder gets it. The bytes went to the worker with the
      // message and cannot come back, so it is fetched again on the main-thread path.
      this.counts.workerRefused++;
      this.retryHere(e);
      return;
    }
    this.received(e, reply.channels, reply.sampleRate ?? 22050);
  }

  /** The worker died or lost a reply: give the in-flight places back and read the rest here. */
  private loseWorker(why: string): void {
    if (!this.awaiting.size && !this.worker) return;
    console.warn(`sound: ${why}; decoding on the main thread from here`);
    for (const { entry } of this.awaiting.values()) {
      this.flying--;
      this.counts.workerLost++;
      this.retryHere(entry);
    }
    this.awaiting.clear();
    try {
      this.worker?.terminate();
    } catch {
      /* already gone */
    }
    this.worker = null;
    this.workerDead = true;
  }

  /** A sample that must go through the browser's decoder instead: fetched again, from the queue. */
  private retryHere(e: Entry): void {
    e.mainThreadOnly = true;
    e.state = 'idle';
    if (!this.queue.includes(e.sample)) this.queue.push(e.sample);
  }

  private checkWorker(now: number): void {
    if (!this.awaiting.size) return;
    for (const [sample, out] of this.awaiting) {
      if (now - out.at < this.tune.workerTimeout) continue;
      // One reply lost would hold an in-flight place for ever; four would stop all sound loading.
      this.awaiting.delete(sample);
      this.flying--;
      this.counts.workerLost++;
      this.retryHere(out.entry);
    }
  }

  private async decodeHere(e: Entry, bytes: ArrayBuffer): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) {
      e.state = 'failed';
      this.counts.failed++;
      return;
    }
    try {
      const buffer = await ctx.decodeAudioData(bytes);
      e.buffer = buffer;
      e.bytes = buffer.numberOfChannels * buffer.length * 4;
      e.state = 'ready';
      this.held += e.bytes;
      this.counts.decoded++;
    } catch {
      e.state = 'failed';
      this.counts.failed++;
    }
  }

  private received(e: Entry, channels: Float32Array[], sampleRate: number): void {
    const ctx = this.ctx;
    if (!ctx || !channels.length || !channels[0].length) {
      e.state = 'failed';
      this.counts.failed++;
      return;
    }
    e.buffer = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
    e.bytes = channels.length * channels[0].length * 4;
    e.pending = channels;
    e.pendingRate = sampleRate;
    e.filled = 0;
    e.state = 'filling';
    this.filling.push(e);
  }

  /** Copies up to `budget` bytes of one entry in; returns how many it copied. */
  private fill(e: Entry, budget: number): number {
    const channels = e.pending!;
    const frames = channels[0].length;
    const perFrame = channels.length * 4;
    const take = Math.max(1, Math.min(frames - e.filled, Math.floor(budget / perFrame)));
    for (let c = 0; c < channels.length; c++) {
      e.buffer!.copyToChannel(channels[c].subarray(e.filled, e.filled + take) as Float32Array<ArrayBuffer>, c, e.filled);
    }
    e.filled += take;
    if (e.filled >= frames) {
      e.pending = null;
      e.state = 'ready';
      this.held += e.bytes;
      this.counts.decoded++;
    }
    return take * perFrame;
  }

  private sweep(): void {
    if (this.held <= this.tune.budget) return;
    const rows = [...this.entries.values()].map((e) => ({ sample: e.sample, bytes: e.bytes, touched: e.touched, playing: e.playing, ready: e.state === 'ready' }));
    for (const sample of planEviction(rows, this.held, this.tune.budget)) {
      const e = this.entries.get(sample)!;
      // A buffer asked for in the last ten seconds is a sign the budget is too small for what is
      // in play: it is still given back, and said so, rather than quietly thrashing.
      if (this.now - e.touched < 10) this.counts.hotEvicted++;
      this.held -= e.bytes;
      this.entries.delete(sample);
      this.counts.evicted++;
    }
  }

  private ensureWorker(): Worker | null {
    if (this.worker || this.workerDead || typeof Worker === 'undefined') return this.worker;
    try {
      this.worker = new Worker(new URL('./wavWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent) => this.onWorkerMessage(ev.data as WavReply);
      this.worker.onerror = (ev) => this.loseWorker(`the WAV worker failed (${ev.message})`);
      this.worker.onmessageerror = () => this.loseWorker('a WAV worker reply could not be read');
    } catch (err) {
      console.warn('sound: no WAV worker, decoding on the main thread', err);
      this.worker = null;
      this.workerDead = true;
    }
    return this.worker;
  }
}
