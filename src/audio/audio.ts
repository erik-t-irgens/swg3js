/**
 * The mixer. One AudioContext, a master and a gain per layer, a pool of voice slots, and the
 * listener at the camera. Web Audio only; no library.
 *
 * Three rules this file keeps, because breaking any of them was the whole risk of building sound
 * into a game that must never stall:
 *  - **One clock.** A game event starts a sound now; everything inside a template (delays, gaps,
 *    loops, fades, drift) runs on the audio clock. Nothing here reads `setTimeout`, which a hidden
 *    tab throttles to once a minute.
 *  - **Nothing per frame.** Slots, records and vectors are pooled; a voice's parameters are written
 *    at most thirty times a second and only when they moved.
 *  - **Nothing can be heard from a driven tab.** Every judgement of how it sounds is the owner's,
 *    so every helper reports numbers instead: what plays, at what gain, what was refused and why.
 *
 * The browser will not let a context run before the player has clicked, so it is made suspended and
 * unlocked on the first press. Until then the beds keep their own clocks and pick up where they
 * have reached, rather than starting from the beginning.
 */
import { BANK_TUNE, SoundBank, type BankTune } from './bank.ts';
import { DISTANCE_TUNE, OUTSIDE, flatGainAt, gainAt, muffleShare, type DistanceTune, type SoundSpace } from './distance.ts';
import { EmitterGrid, GRID_TUNE } from './emitters.ts';
import { TemplateRun, makeStart, rateOf, seededRng, type SoundStart, type SoundTemplate } from './template.ts';
import { UiSounds, type UiTable } from './uiSounds.ts';
import { VOICE_TUNE, VoiceBudget, keySource, type VoicePool, type VoiceWant } from './voices.ts';

/** The layers the menu gives a slider each. */
export type SoundGroup = 'ambience' | 'effects' | 'voices' | 'footsteps' | 'vehicles' | 'interface' | 'music';

export const SOUND_GROUPS: readonly SoundGroup[] = ['ambience', 'effects', 'voices', 'footsteps', 'vehicles', 'interface', 'music'] as const;

/**
 * Which slider a sound's own category answers to. The categories are the game's (field 10 of every
 * sound template); the grouping is ours, so the owner has one slider per kind of thing rather than
 * fourteen.
 */
export const GROUP_OF_CATEGORY: readonly SoundGroup[] = [
  'ambience', // 0 ambient
  'effects', // 1 explosion
  'effects', // 2 item
  'footsteps', // 3 movement
  'interface', // 4 interface
  'vehicles', // 5 vehicle
  'voices', // 6 vocalization
  'effects', // 7 weapon
  'music', // 8 background music
  'music', // 9 player music
  'effects', // 10 machine
  'effects', // 11
  'ambience', // 12
  'voices', // 13 voice-over
];

/** The sound half of the player's settings. */
export interface AudioSettings {
  soundMaster: number;
  soundAmbience: number;
  soundEffects: number;
  soundVoices: number;
  soundFootsteps: number;
  soundVehicles: number;
  soundInterface: number;
  soundMusic: number;
  soundHeadphones: boolean;
  soundRoomEcho: boolean;
  soundInBackground: boolean;
  soundSabers: string;
}

const SETTING_OF_GROUP: Record<SoundGroup, keyof AudioSettings> = {
  ambience: 'soundAmbience',
  effects: 'soundEffects',
  voices: 'soundVoices',
  footsteps: 'soundFootsteps',
  vehicles: 'soundVehicles',
  interface: 'soundInterface',
  music: 'soundMusic',
};

/** Where the listener is and which way it faces, filled by the game from the camera. */
export interface ListenerPose {
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
  ux: number;
  uy: number;
  uz: number;
  /** The building and cell the listener stands in; the open world is -1. */
  space: SoundSpace;
}

export interface PlayOptions {
  x?: number;
  y?: number;
  z?: number;
  space?: SoundSpace;
  /** Overrides what the template says about looping. */
  loop?: boolean;
  /** An extra linear gain (a weather channel's weight, a held effect fading). */
  gain?: number;
  /** An extra pitch shift in semitones (an engine with the throttle open, a Doppler shift). */
  pitch?: number;
  /** An audio-clock time to start at, to the sample: what player music will lay its parts on. */
  at?: number;
}

export interface MixerTune {
  /** INVENTED: parameter writes a second per voice. */
  writeRate: number;
  /** INVENTED: seconds a parameter ramp takes (`setTargetAtTime`), so nothing steps. */
  ramp: number;
  /** INVENTED: seconds the master takes to fall silent when the tab goes away. */
  hideFade: number;
  /** INVENTED: how far ahead of the audio clock a loop is scheduled. */
  lookahead: number;
  /** INVENTED: the two room echoes' lengths in seconds (ordinary rooms, then the tall halls). */
  echo: [number, number];
  /** INVENTED: seconds a voice refused a slot waits before it asks again. */
  retry: number;
  /** INVENTED: seconds a voice that gives way fades over, so stealing one never clicks. */
  cutFade: number;
}

export const MIXER_TUNE: MixerTune = { writeRate: 30, ramp: 0.03, hideFade: 0.1, lookahead: 0.12, echo: [0.6, 1.8], retry: 0.25, cutFade: 0.008 };

/**
 * The three pools' slots are numbered one after another, so a slot's nodes are found by one index
 * and the positional pool's slot 0 is never the interface pool's slot 0.
 */
const POOL_BASE: Record<VoicePool, number> = { positional: 0, flat: VOICE_TUNE.positional, ui: VOICE_TUNE.positional + VOICE_TUNE.flat };

interface Slot {
  gain: GainNode;
  /**
   * A panner that only pans: the whole falloff is computed in JavaScript, so it stays in one
   * function a node test can sweep, and the node's own distance model is turned off
   * (`rolloffFactor` 0). Its `panningModel` follows the headphones setting, which is the one thing
   * about a voice that may change while it plays.
   */
  pan: PannerNode | null;
  /**
   * Everything into the slot goes through this one node, so a voice that gives way can be moved off
   * `gain` (which the voice taking its place is about to set) onto `cut` and faded out there.
   */
  head: AudioNode;
  /** Where a stolen source is hung for the few milliseconds it takes to fade it out. */
  cut: GainNode;
  dry: GainNode;
  muffled: GainNode;
  filter: BiquadFilterNode;
  /** The two room echoes' sends, built silent and switched on with the room rule. */
  sends: GainNode[];
  out: GainNode;
  /** The group its output is joined to, so it is rejoined only when that changes. */
  group: SoundGroup | null;
  lastGain: number;
  lastWrite: number;
}

interface Playing {
  key: number;
  id: string;
  template: SoundTemplate;
  run: TemplateRun;
  loop: boolean;
  x: number;
  y: number;
  z: number;
  flat: boolean;
  space: SoundSpace;
  gain: number;
  pitch: number;
  group: SoundGroup;
  pool: VoicePool;
  /** The slot it holds, numbered across all three pools; -1 while it waits as a virtual voice. */
  slot: number;
  source: AudioBufferSourceNode | null;
  sample: string;
  rate: number;
  /** Audio time the sound playing now ends. */
  endsAt: number;
  /** Audio time the loop now due was first asked for, for the patience drop. */
  askedAt: number;
  /** The gain the listener would hear it at, before the group and the master. */
  audible: number;
  stopping: boolean;
  starts: number;
  /** It sits in the emitter grid, so it is distance-tested on a pass and not every frame. */
  gridded: boolean;
  /** It was refused a slot and is waiting as a virtual voice: counted once, not once a frame. */
  refused: boolean;
  /** The earliest audio time it may ask the budget again, so a refusal does not re-ask every frame. */
  retryAt: number;
  /** Where it sits in `live`, so it is taken out without searching or allocating. */
  at: number;
}

export class AudioSystem {
  readonly bank: SoundBank;
  readonly grid = new EmitterGrid(GRID_TUNE, DISTANCE_TUNE);
  readonly budget = new VoiceBudget(VOICE_TUNE);
  readonly ui: UiSounds;
  readonly distance: DistanceTune = DISTANCE_TUNE;
  readonly tune: MixerTune = MIXER_TUNE;
  /** INVENTED: a multiplier per sound category, for settling how the game's own volumes read. */
  readonly categoryGain = new Float32Array(14).fill(1);
  /** Set by `__debug.advance`: events are recorded, nothing is started, so a visible tab never bursts. */
  advancing = false;

  /**
   * A `BaseAudioContext` rather than an `AudioContext`, because the self test builds this very
   * graph in an `OfflineAudioContext` and renders it. Only `resume` and `suspend` need the live
   * kind, which `live` below hands back.
   */
  private ctx: BaseAudioContext | null = null;
  private installed = false;
  private offline = false;
  private master: GainNode | null = null;
  private readonly groups = new Map<SoundGroup, GainNode>();
  private readonly echoes: ConvolverNode[] = [];
  private readonly slots: (Slot | null)[] = [];
  private readonly playing = new Map<number, Playing>();
  /** The same records in an array, so a frame's walk allocates no iterator. */
  private readonly voices: Playing[] = [];
  private readonly nextKey = keySource();
  private readonly rng = seededRng(0x5eed1);
  private readonly start: SoundStart = makeStart();
  /** Asked for again every step rather than made: nothing is allocated while the game runs. */
  private readonly want: VoiceWant = { key: 0, priority: 9, gain: 0, pool: 'positional' };
  private readonly finished: number[] = [];
  private settings: AudioSettings;
  private listener: ListenerPose = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, space: OUTSIDE };
  private hidden = false;
  private unlocked = false;
  private lastListenerWrite = 0;
  private lastGroupWrite = -1;
  /** Counters a hidden tab reads instead of listening. */
  readonly counts = { asked: 0, started: 0, refusedNoTemplate: 0, refusedNoSlot: 0, refusedRetries: 0, droppedNoBuffer: 0, recorded: 0, distanceTests: 0 };
  /** The last few sounds asked for, whether they played and why not: the headless check. */
  readonly log: { id: string; at: number; result: string }[] = [];

  private readonly baseUrl: string;

  constructor(baseUrl: string, settings: AudioSettings, tune?: Partial<BankTune>) {
    this.settings = settings;
    this.baseUrl = baseUrl;
    this.bank = new SoundBank(baseUrl, { ...BANK_TUNE, ...tune });
    this.ui = new UiSounds(
      () => this.now,
      (id) => this.play(id, { gain: 1 }) !== 0,
    );
  }

  /** The audio clock. Before the context exists it is 0, and every template's own clock starts there. */
  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  /** The context when it is a live one: only resuming and suspending need that. */
  private get live(): AudioContext | null {
    return this.offline ? null : (this.ctx as AudioContext | null);
  }

  /**
   * Makes the context (suspended) and the fixed part of the graph, and fetches the pack. Called
   * once from the game's constructor, before anything asks to play: every field it reads is
   * assigned above it.
   *
   * The pack is fetched whatever happens to the context, so a browser with no Web Audio at all
   * still reports whether the sounds are converted rather than "not loaded yet".
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    this.loadPack();
    if (typeof AudioContext === 'undefined') return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch (err) {
      console.warn('sound: no audio context', err);
      return;
    }
    this.build(ctx, false);
    this.applySettings();
  }

  /**
   * The same graph in a context that renders rather than plays, for the self test: it is unlocked
   * from the start (there is nobody to click) and its gains are set outright rather than ramped,
   * since a render begins at time 0 and a ramp from 0 would still be climbing.
   */
  installOffline(ctx: BaseAudioContext): void {
    if (this.ctx) return;
    this.build(ctx, true);
    this.unlocked = true;
    this.snapGains();
  }

  private loadPack(): void {
    // Not on a page (the node test) there is nothing to fetch from; in a browser it is fetched
    // whether or not the context could be made, so the report says whether the pack is there
    // rather than "not loaded yet".
    if (typeof window === 'undefined') return;
    void this.bank.load().then((ok) => {
      if (!ok) {
        console.info(`sound: ${this.bank.why}`);
        return;
      }
      console.info(`sound: ${this.bank.templateCount} templates in the bank`);
      this.ui.attach((this.bank.sources?.interface as UiTable | undefined) ?? null);
    });
  }

  private build(ctx: BaseAudioContext, offline: boolean): void {
    this.ctx = ctx;
    this.offline = offline;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    for (const g of SOUND_GROUPS) {
      const node = ctx.createGain();
      node.gain.value = 1;
      node.connect(this.master);
      this.groups.set(g, node);
    }
    // Two room echoes, made once and never reloaded: a short one for ordinary rooms and a long one
    // for the tall halls. Both are ours (the client's settings are not in the archives) and both
    // stay silent until the room rule is switched on.
    for (const seconds of this.tune.echo) {
      const conv = ctx.createConvolver();
      conv.buffer = this.impulse(seconds);
      const ret = ctx.createGain();
      ret.gain.value = 0;
      conv.connect(ret);
      ret.connect(this.master);
      this.echoes.push(conv);
    }
    this.bank.attach(ctx);
  }

  /** The first press: the browser lets the context run from here. Safe to call any number of times. */
  unlock(): void {
    const ctx = this.live;
    if (!ctx || this.unlocked) return;
    this.unlocked = true;
    void ctx.resume().catch(() => {
      this.unlocked = false;
    });
    this.applySettings();
  }

  /** The tab went away or came back. Without "keep playing in the background" it goes silent and stops. */
  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    const ctx = this.live;
    if (!ctx) return;
    if (hidden && !this.settings.soundInBackground) {
      this.master?.gain.setTargetAtTime(0, ctx.currentTime, this.tune.hideFade / 3);
      // The wait for the fade is timed on the audio clock, not `setTimeout`, which is the one thing
      // a hidden tab throttles: a silent source of exactly that length ends when the fade does,
      // whatever the browser is doing with its timers.
      const silence = ctx.createBufferSource();
      silence.buffer = ctx.createBuffer(1, Math.max(1, Math.ceil(ctx.sampleRate * this.tune.hideFade)), ctx.sampleRate);
      silence.connect(this.master ?? ctx.destination);
      silence.onended = () => {
        silence.disconnect();
        if (this.hidden && !this.settings.soundInBackground) void ctx.suspend().catch(() => {});
      };
      try {
        silence.start(ctx.currentTime);
      } catch {
        void ctx.suspend().catch(() => {});
      }
    } else if (!hidden) {
      if (this.unlocked) void ctx.resume().catch(() => {});
      this.applySettings();
    }
  }

  /** A setting moved, or the whole object changed. Only gains move; nothing is rebuilt. */
  apply(settings: AudioSettings): void {
    this.settings = settings;
    this.applySettings();
  }

  /** The interface table the converter writes, once the pack is in. */
  attachUiTable(table: UiTable | null): void {
    this.ui.attach(table);
  }

  /** Ask for what a thing will need. Never awaited on a visual path. */
  prepare(ids: Iterable<string>): void {
    this.bank.prepare(ids);
  }

  /**
   * Start a template. Returns a key, or 0 when nothing started (no pack, no template, no slot). A
   * key is always usable: `stop`, `move` and `setGain` on 0 do nothing.
   */
  play(id: string, options: PlayOptions = {}): number {
    this.counts.asked++;
    const template = this.bank.template(id);
    if (!template || template.silent || !template.samples.length) {
      this.counts.refusedNoTemplate++;
      this.note(id, this.bank.available ? 'no such template' : 'no sound pack');
      return 0;
    }
    if (this.advancing) {
      // Simulated seconds, not played ones: the event is recorded and nothing is started.
      this.counts.recorded++;
      this.note(id, 'recorded (advancing)');
      return 0;
    }
    const key = this.nextKey();
    const now = options.at ?? this.now;
    const flat = template.dim === 2 || options.x === undefined;
    const p: Playing = {
      key,
      id,
      template,
      run: new TemplateRun(template, this.rng, now),
      loop: options.loop ?? false,
      x: options.x ?? 0,
      y: options.y ?? 0,
      z: options.z ?? 0,
      flat,
      // The caller's space is copied, never held: one building's object handed to several voices
      // would move every one of them the first time it was written to.
      space: { building: (options.space ?? OUTSIDE).building, cell: (options.space ?? OUTSIDE).cell },
      gain: options.gain ?? 1,
      pitch: options.pitch ?? 0,
      group: this.groupOf(template),
      pool: template.category === 4 ? 'ui' : flat ? 'flat' : 'positional',
      slot: -1,
      source: null,
      sample: '',
      rate: 1,
      endsAt: 0,
      askedAt: now,
      audible: 1,
      stopping: false,
      starts: 0,
      gridded: false,
      refused: false,
      retryAt: 0,
      at: this.voices.length,
    };
    p.loop = options.loop ?? p.run.loops;
    this.playing.set(key, p);
    this.voices.push(p);
    this.bank.prepare([id]);
    return key;
  }

  /**
   * Which layer a sound answers to. Music the game places in the world (a cantina band) is part of
   * the place, not the score, so it fades with distance and takes the ambience slider; the sounds
   * the converter keeps from a scene (the hyperspace stages) are the ship's own noise and take the
   * effects slider, since the music bus has no slider until the music pass.
   */
  private groupOf(template: SoundTemplate): SoundGroup {
    if (template.placedMusic) return 'ambience';
    if (template.keptMusic) return 'effects';
    return GROUP_OF_CATEGORY[template.category] ?? 'effects';
  }

  /** A looping source that lives in the grid as well, so it is only checked four times a second. */
  loop(id: string, options: PlayOptions = {}): number {
    const key = this.play(id, { ...options, loop: true });
    if (!key) return 0;
    const p = this.playing.get(key)!;
    p.gridded = true;
    this.grid.add(key, id, p.x, p.y, p.z, p.template.full, p.flat, p.space);
    return key;
  }

  stop(key: number, fade?: number): void {
    const p = this.playing.get(key);
    if (!p) return;
    p.stopping = true;
    p.run.stop();
    const ctx = this.ctx;
    const seconds = fade ?? p.run.fadeOut;
    if (p.source && ctx) {
      const slot = this.slots[p.slot];
      if (slot) slot.gain.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.005, seconds) / 3);
      try {
        p.source.stop(ctx.currentTime + Math.max(0.01, seconds));
      } catch {
        /* already stopped */
      }
      p.endsAt = ctx.currentTime + Math.max(0.01, seconds);
    } else {
      this.release(p);
    }
  }

  move(key: number, x: number, y: number, z: number): void {
    const p = this.playing.get(key);
    if (!p) return;
    p.x = x;
    p.y = y;
    p.z = z;
    this.grid.move(key, x, y, z);
  }

  setGain(key: number, gain: number): void {
    const p = this.playing.get(key);
    if (p) p.gain = gain;
  }

  setPitch(key: number, semitones: number): void {
    const p = this.playing.get(key);
    if (p) p.pitch = semitones;
  }

  isPlaying(key: number): boolean {
    return this.playing.has(key);
  }

  /** A voice that moved between the open world and a room (a mount walking through a doorway). */
  setSpace(key: number, space: SoundSpace): void {
    const p = this.playing.get(key);
    if (p) p.space = space;
  }

  /**
   * The frame's work: the listener, the grid's pass, the bank's slices, and every playing template
   * asked whether a loop is due. Called from the game's loop after the camera has moved.
   */
  update(dt: number, pose: ListenerPose): void {
    this.listener = pose;
    const now = this.now;
    this.bank.pump(now);
    // The grid's pass is the beat the looping sounds are looked at on: `step` below does nothing
    // for a grid-backed loop that is waiting for a slot between two passes, which is what keeps a
    // town full of virtual emitters off the frame.
    const pass = this.grid.step(dt, pose.x, pose.y, pose.z);
    this.writeListener(now);
    this.writeGroups(now);
    this.finished.length = 0;
    for (let i = 0; i < this.voices.length; i++) {
      const p = this.voices[i];
      this.step(p, now, pass);
      if (this.over(p, now)) this.finished.push(p.key);
    }
    for (const key of this.finished) {
      const p = this.playing.get(key);
      if (p) this.release(p);
    }
  }

  /** Everything let go: a travel, a switch of character, the world unloading. */
  stopAll(): void {
    while (this.voices.length) this.release(this.voices[this.voices.length - 1]);
    this.grid.clear();
    this.budget.clear();
  }

  /** What a hidden tab reads instead of listening. */
  status(): Record<string, unknown> {
    const voices: Record<string, unknown>[] = [];
    let waiting = 0;
    let gridded = 0;
    for (const p of this.playing.values()) {
      if (p.slot < 0 && p.loop) waiting++;
      if (p.gridded) gridded++;
      voices.push({
        id: p.id,
        group: p.group,
        category: p.template.category,
        priority: p.template.priority,
        loop: p.loop,
        slot: p.slot,
        virtual: p.slot < 0,
        gain: Number(p.audible.toFixed(3)),
        distance: p.flat ? null : Number(Math.hypot(p.x - this.listener.x, p.y - this.listener.y, p.z - this.listener.z).toFixed(1)),
        starts: p.starts,
      });
    }
    voices.sort((a, b) => (b.gain as number) - (a.gain as number));
    return {
      state: this.state,
      unlocked: this.unlocked,
      hidden: this.hidden,
      master: this.masterGain(),
      groups: Object.fromEntries(SOUND_GROUPS.map((g) => [g, this.groupGain(g)])),
      // What the graph is doing rather than what the settings ask for: the room rule is not switched
      // on yet, so the muffled path and the two echoes are built and silent, and say so.
      panning: this.slots.find((s) => s?.pan)?.pan?.panningModel ?? (this.settings.soundHeadphones ? 'HRTF' : 'equalpower'),
      echo: { impulses: this.echoes.length, sending: this.slots.some((s) => s?.sends.some((g) => g.gain.value > 0)) },
      slotsBuilt: this.slots.filter(Boolean).length,
      categoryGain: [...this.categoryGain],
      voices: voices.slice(0, 24),
      voiceCount: voices.length,
      // Loops waiting for a slot, and how many of the voices sit in the grid: the two numbers that
      // say whether the four-times-a-second pass is carrying what it should be.
      waitingLoops: waiting,
      griddedVoices: gridded,
      budget: this.budget.status(),
      grid: this.grid.status(),
      bank: this.bank.status(),
      ui: { ready: this.ui.ready, counts: { ...this.ui.counts } },
      counts: { ...this.counts },
      recent: this.log.slice(-12),
    };
  }

  /**
   * Renders a template through a second mixer of this very class in an offline context and checks
   * that it came out at the gain the template, the category, the layer and the master ask for: the
   * one check of the audio path that works with no click and no pack, in a tab that can hear
   * nothing. It goes through `installOffline`, `play`, `update`, `slotAt`, `join`, `begin` and
   * `writeVoice` -- the same code a real sound takes -- so it can say something about the mixer and
   * not merely that three gains multiply.
   */
  async selfTest(): Promise<Record<string, unknown>> {
    if (typeof OfflineAudioContext === 'undefined') return { ok: false, why: 'no OfflineAudioContext' };
    const rate = 22050;
    const frames = rate;
    const ctx = new OfflineAudioContext(1, frames, rate);
    // A template of the test's own: half a second of a 440 Hz tone at amplitude 0.5, two-dimensional
    // (so it takes a flat slot and is not panned) and on the effects layer, at the volume below.
    const volume = 0.8;
    const id = 'sound/self_test.snd';
    const sample = 'sample/self_test.wav';
    const template: SoundTemplate = { dim: 2, samples: [sample], category: 7, priority: 0, full: 0, volume: { mode: 0, range: [volume, volume] } };
    const sys = new AudioSystem(this.baseUrl, this.settings);
    sys.installOffline(ctx);
    sys.bank.adopt({ format: 1, templates: { [id]: template } });
    const buffer = ctx.createBuffer(1, rate / 2, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin((i / rate) * 440 * Math.PI * 2) * 0.5;
    sys.bank.provide(sample, buffer);
    const key = sys.play(id);
    sys.update(1 / 60, sys.listener);
    const out = await ctx.startRendering();
    const ch = out.getChannelData(0);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
      sum += ch[i] * ch[i];
    }
    // The new mixer is never hidden, so the master it uses is the setting itself, not this one's
    // background mute: the self test must read the same with the tab in the background.
    const expected = 0.5 * volume * (this.categoryGain[7] ?? 1) * this.groupGain('effects') * Math.max(0, Math.min(1, this.settings.soundMaster));
    const silent = ch.subarray(Math.floor(rate * 0.75));
    let tail = 0;
    for (let i = 0; i < silent.length; i++) tail = Math.max(tail, Math.abs(silent[i]));
    const counts = sys.counts;
    return {
      ok: out.length === frames && counts.started === 1 && Math.abs(peak - expected) < 0.02 && tail < 1e-6,
      frames: out.length,
      peak: Number(peak.toFixed(4)),
      expected: Number(expected.toFixed(4)),
      rms: Number(Math.sqrt(sum / ch.length).toFixed(4)),
      tailAfterSound: Number(tail.toFixed(6)),
      // What the mixer itself did, so a zero peak can be told from a sound that never started.
      started: counts.started,
      voiceStarted: key > 0,
      slotsBuilt: (sys.status().slotsBuilt as number) ?? 0,
      refused: { noTemplate: counts.refusedNoTemplate, noSlot: counts.refusedNoSlot, noBuffer: counts.droppedNoBuffer },
      recent: sys.log.slice(-4),
    };
  }

  // ---- the mixing ----

  private masterGain(): number {
    if (this.hidden && !this.settings.soundInBackground) return 0;
    return Math.max(0, Math.min(1, this.settings.soundMaster));
  }

  private groupGain(g: SoundGroup): number {
    const v = this.settings[SETTING_OF_GROUP[g]];
    return typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 1;
  }

  /**
   * The layer gains set outright rather than ramped. A render starts at time 0, so a ramp from 0
   * would still be climbing through the whole of a short sound; only the offline path uses it.
   */
  private snapGains(): void {
    if (!this.master) return;
    this.master.gain.value = this.masterGain();
    for (const g of SOUND_GROUPS) {
      const node = this.groups.get(g);
      if (node) node.gain.value = this.groupGain(g);
    }
    this.lastGroupWrite = this.masterGain();
  }

  private applySettings(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.masterGain(), ctx.currentTime, this.tune.ramp);
    for (const g of SOUND_GROUPS) this.groups.get(g)?.gain.setTargetAtTime(this.groupGain(g), ctx.currentTime, this.tune.ramp);
    // Headphones: the panners change how they place a sound, which costs a convolution a voice and
    // is a parameter, not a rebuild, so nothing is interrupted.
    const model: PanningModelType = this.settings.soundHeadphones ? 'HRTF' : 'equalpower';
    for (const slot of this.slots) if (slot?.pan && slot.pan.panningModel !== model) slot.pan.panningModel = model;
    this.lastGroupWrite = -1;
  }

  private writeGroups(now: number): void {
    // The sliders are written on a change (`apply`); this only catches the background mute, which
    // the visibility hook flips without going through the menu.
    if (!this.ctx || !this.master) return;
    const want = this.masterGain();
    if (Math.abs(want - this.lastGroupWrite) < 1e-3) return;
    this.lastGroupWrite = want;
    this.master.gain.setTargetAtTime(want, now, this.tune.ramp);
  }

  private writeListener(now: number): void {
    const ctx = this.ctx;
    if (!ctx || now - this.lastListenerWrite < 1 / this.tune.writeRate) return;
    this.lastListenerWrite = now;
    const l = ctx.listener as AudioListener & { positionX?: AudioParam; forwardX?: AudioParam };
    const p = this.listener;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, now, this.tune.ramp);
      l.positionY!.setTargetAtTime(p.y, now, this.tune.ramp);
      l.positionZ!.setTargetAtTime(p.z, now, this.tune.ramp);
      l.forwardX!.setTargetAtTime(p.fx, now, this.tune.ramp);
      l.forwardY!.setTargetAtTime(p.fy, now, this.tune.ramp);
      l.forwardZ!.setTargetAtTime(p.fz, now, this.tune.ramp);
      l.upX!.setTargetAtTime(p.ux, now, this.tune.ramp);
      l.upY!.setTargetAtTime(p.uy, now, this.tune.ramp);
      l.upZ!.setTargetAtTime(p.uz, now, this.tune.ramp);
    } else {
      const old = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void };
      old.setPosition(p.x, p.y, p.z);
      old.setOrientation(p.fx, p.fy, p.fz, p.ux, p.uy, p.uz);
    }
  }

  /** One playing template: what it would be heard at, whether a loop is due, and whether it holds a slot. */
  private step(p: Playing, now: number, pass: boolean): void {
    if (p.gridded) {
      // A loop in the grid is distance-tested on a pass, four times a second. Between passes one
      // that holds a slot keeps the gain the pass worked out (and arms its next loop on time), and
      // one still waiting for a slot is not looked at at all.
      if (pass) p.audible = this.gridAudible(p);
      else if (p.slot < 0) return;
    } else {
      p.audible = this.audibleOf(p);
    }
    const want = this.want;
    want.key = p.key;
    want.priority = p.template.priority;
    want.gain = p.audible * p.gain;
    want.pool = p.pool;
    // A loop that has gone out of earshot gives its slot back and keeps its clock as a virtual voice.
    if (p.loop && want.gain <= 0) {
      if (p.slot >= 0) this.silence(p);
      return;
    }
    if (p.run.dueAt <= now + this.tune.lookahead) {
      if (!this.ctx || !this.unlocked) {
        // Nothing may sound before the player has clicked: the run keeps its own clock all the
        // same, from the length the index carries, so a bed comes in where it has reached rather
        // than from the beginning and nothing has to be decoded before the first press.
        const known = this.bank.length(p.template.samples[0]);
        // A bed whose length the index does not carry waits rather than arming a loop of no length,
        // which would come round again on the very next frame for ever.
        if (p.loop && known <= 0) return;
        if (p.run.nextDue(now + this.tune.lookahead, this.start)) {
          p.run.began(this.bank.length(p.template.samples[Math.min(this.start.sample, p.template.samples.length - 1)]) || known, this.start.rate);
        }
        return;
      }
      // Every sample of the template was asked for when it started; the first one standing in says
      // whether the fetch has come back at all.
      const buffer = this.bank.buffer(p.template.samples[0]);
      if (!buffer) {
        // The buffer is still coming. A one-shot gives it a moment, then goes.
        if (!p.loop && now - p.askedAt > this.bank.tune.patience) {
          this.counts.droppedNoBuffer++;
          this.note(p.id, 'dropped: no buffer in time');
          p.run.stop();
          p.stopping = true;
        }
        return;
      }
      if (now < p.retryAt) return;
      const grant = this.budget.request(want);
      if (grant.slot < 0) {
        // Counted once per voice, not once per frame: a loop kept as a virtual voice asks again
        // after the retry wait, and the retries are counted apart so the two numbers read straight.
        if (p.refused) this.counts.refusedRetries++;
        else this.counts.refusedNoSlot++;
        p.refused = true;
        p.retryAt = now + this.tune.retry;
        if (!p.loop) {
          this.note(p.id, 'refused: no voice');
          p.run.stop();
          p.stopping = true;
        }
        return;
      }
      p.refused = false;
      if (grant.stolen) {
        const other = this.playing.get(grant.stolen);
        if (other) this.silence(other, true);
      }
      p.slot = POOL_BASE[p.pool] + grant.slot;
      this.begin(p, buffer, now);
    } else if (p.slot >= 0) {
      this.budget.update(p.key, p.template.priority, want.gain);
      this.writeVoice(p, now);
    }
  }

  private begin(p: Playing, buffer: AudioBuffer, now: number): void {
    // Every way out of this method after the run has been armed must un-arm it and give the slot
    // back: `nextDue` sets the run waiting and `dueAt` is Infinity until `began`, so a voice that
    // slipped away between the two would hold one of the pool's slots for the rest of the session
    // without ever sounding.
    if (!p.run.nextDue(now + this.tune.lookahead, this.start)) {
      this.giveBack(p);
      return;
    }
    const ctx = this.ctx!;
    const slot = this.slotAt(p.slot, p.flat);
    if (!slot) {
      p.run.began(0);
      this.giveBack(p);
      return;
    }
    const sample = p.template.samples[Math.min(this.start.sample, p.template.samples.length - 1)];
    const buf = this.bank.buffer(sample) ?? buffer;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const rate = this.start.rate * rateOf(p.pitch);
    src.playbackRate.value = rate;
    src.connect(slot.gain);
    // A source plays once and is then done with: it lets go of the slot's gain itself, so a game
    // running for hours never leaves a line of dead nodes behind.
    src.onended = () => src.disconnect();
    this.join(slot, p.group);
    let at = Math.max(ctx.currentTime, this.start.at);
    // A bed that waited as a virtual voice comes in where its own clock has reached. A negative
    // answer means its clock is in the gap between two loops, so it waits that out and comes in at
    // the top rather than part way through the sample.
    let offset = p.starts === 0 && p.loop ? p.run.offsetInto(now, buf.duration) : 0;
    if (offset < 0) {
      at += -offset;
      offset = 0;
    }
    const gain = this.start.gain * p.gain * p.audible * (this.categoryGain[p.template.category] ?? 1);
    slot.gain.gain.cancelScheduledValues(at);
    if (this.start.fadeIn > 0) {
      slot.gain.gain.setValueAtTime(0, at);
      slot.gain.gain.linearRampToValueAtTime(gain, at + this.start.fadeIn);
    } else {
      slot.gain.gain.setValueAtTime(gain, at);
    }
    slot.lastGain = gain;
    slot.lastWrite = at;
    try {
      src.start(at, offset);
    } catch {
      p.run.began(0);
      this.giveBack(p);
      return;
    }
    if (p.source) {
      try {
        p.source.stop();
      } catch {
        /* already gone */
      }
    }
    this.bank.drop(p.sample);
    p.source = src;
    p.sample = sample;
    p.rate = rate;
    p.endsAt = at + Math.max(0, buf.duration - offset) / rate;
    p.askedAt = now;
    p.starts++;
    this.bank.hold(sample);
    this.counts.started++;
    p.run.began(buf.duration - offset, rate);
    this.writeVoice(p, now);
  }

  /** The distance and space gain this voice would be heard at, 0 to 1. */
  private audibleOf(p: Playing): number {
    if (p.flat && p.template.full <= 0) return 1;
    if (p.flat && p.x === 0 && p.y === 0 && p.z === 0) return p.space.building === this.listener.space.building ? 1 : 0;
    this.counts.distanceTests++;
    return this.audibleAt(p, Math.hypot(p.x - this.listener.x, p.y - this.listener.y, p.z - this.listener.z));
  }

  /**
   * The same answer for a loop that sits in the grid, from the distance the pass has just measured:
   * nothing here measures a distance of its own, which is the whole point of the grid.
   */
  private gridAudible(p: Playing): number {
    const s = this.grid.source(p.key);
    if (!s) return this.audibleOf(p);
    if (!this.grid.isNear(p.key)) return 0;
    if (p.flat && p.template.full <= 0) return 1;
    return this.audibleAt(p, s.distance);
  }

  private audibleAt(p: Playing, d: number): number {
    if (p.flat) {
      // A non-positional emitter is heard only in the listener's own space, and never panned.
      if (p.space.building !== this.listener.space.building) return 0;
      if (p.template.full <= 0) return 1;
      return flatGainAt(d, p.template.full, this.distance);
    }
    return gainAt(d, p.template.full, this.distance);
  }

  private writeVoice(p: Playing, now: number): void {
    const slot = this.slots[p.slot];
    const ctx = this.ctx;
    if (!slot || !ctx || p.stopping) return;
    if (now - slot.lastWrite < 1 / this.tune.writeRate) return;
    slot.lastWrite = now;
    const gain = p.gain * p.audible * (this.categoryGain[p.template.category] ?? 1);
    if (Math.abs(gain - slot.lastGain) > 1e-3) {
      slot.gain.gain.setTargetAtTime(gain, now, this.tune.ramp);
      slot.lastGain = gain;
    }
    // Where it sits around the head. The node is given the source's world place and nothing else:
    // its own falloff is off, so the whole curve stays in `distance.ts` where a test can sweep it.
    if (slot.pan) this.place(slot.pan, p.x, p.y, p.z, now);
    const muffle = muffleShare(this.listener.space, p.space);
    slot.dry.gain.setTargetAtTime(1 - muffle, now, this.distance.muffleEase);
    slot.muffled.gain.setTargetAtTime(muffle * this.distance.muffleGain, now, this.distance.muffleEase);
  }

  /** A panner's place, through its parameters where the browser has them and the old call otherwise. */
  private place(pan: PannerNode, x: number, y: number, z: number, now: number): void {
    const p = pan as PannerNode & { positionX?: AudioParam };
    if (p.positionX) {
      p.positionX.setTargetAtTime(x, now, this.tune.ramp);
      pan.positionY.setTargetAtTime(y, now, this.tune.ramp);
      pan.positionZ.setTargetAtTime(z, now, this.tune.ramp);
    } else {
      (pan as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
    }
  }

  /**
   * A one-shot is finished when its run has nothing left and whatever it started has ended. It must
   * not need a source to be finished: a sound asked for before the first click never gets one, and
   * neither does one whose voice gave way, and either would leave a record walked for the rest of
   * the session and counted in the very numbers the mixer is read by.
   */
  private over(p: Playing, now: number): boolean {
    if (p.stopping && (!p.source || now >= p.endsAt)) return true;
    if (!p.loop && p.run.finished && (!p.source || now >= p.endsAt)) return true;
    return false;
  }

  /** The slot given back to the pool with nothing sounding on it. */
  private giveBack(p: Playing): void {
    this.budget.release(p.key);
    p.slot = -1;
  }

  /** Give the slot back but keep the record and its clock: a loop out of earshot, or one that gave way. */
  private silence(p: Playing, stolen = false): void {
    if (p.source) {
      // The source is moved off the slot's own gain, which the voice taking its place is about to
      // write, and faded out on the slot's cut node instead: an instantaneous stop clicks.
      const slot = this.slots[p.slot];
      const ctx = this.ctx;
      let until = 0;
      if (slot && ctx) {
        const now = ctx.currentTime;
        until = now + this.tune.cutFade;
        try {
          p.source.disconnect();
          p.source.connect(slot.cut);
          slot.cut.gain.cancelScheduledValues(now);
          slot.cut.gain.setValueAtTime(1, now);
          slot.cut.gain.linearRampToValueAtTime(0, until);
          // Back to 1 a moment later, for whoever gives way on this slot next.
          slot.cut.gain.setValueAtTime(1, until + 0.001);
        } catch {
          until = 0;
        }
      }
      try {
        p.source.stop(until || undefined);
      } catch {
        /* already gone */
      }
      p.source = null;
    }
    this.bank.drop(p.sample);
    p.sample = '';
    if (!stolen) this.budget.release(p.key);
    p.slot = -1;
    p.starts = 0;
  }

  private release(p: Playing): void {
    this.silence(p);
    this.budget.release(p.key);
    this.grid.remove(p.key);
    this.playing.delete(p.key);
    // Swapped out of the list rather than spliced, so letting a voice go allocates nothing.
    const last = this.voices.pop();
    if (last && last !== p) {
      this.voices[p.at] = last;
      last.at = p.at;
    }
  }

  /** A slot is built the first time it is used and then kept, so a silent game costs no nodes. */
  private slotAt(index: number, flat: boolean): Slot | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    let slot = this.slots[index];
    if (slot) return slot;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    let pan: PannerNode | null = null;
    if (!flat) {
      pan = ctx.createPanner();
      pan.panningModel = this.settings.soundHeadphones ? 'HRTF' : 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = 1;
      // 0 turns the node's own falloff off: the gain is ours, and the node only places the sound.
      pan.rolloffFactor = 0;
    }
    const dry = ctx.createGain();
    dry.gain.value = 1;
    const muffled = ctx.createGain();
    muffled.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.distance.muffleHz;
    const out = ctx.createGain();
    out.gain.value = 1;
    // One input node for the slot whatever it is: the panner where there is one, and a plain gain
    // of 1 otherwise, so a stolen voice always has somewhere to fade out that is not `gain`.
    const head: AudioNode = pan ?? ctx.createGain();
    gain.connect(head);
    const cut = ctx.createGain();
    cut.gain.value = 1;
    cut.connect(head);
    head.connect(dry).connect(out);
    head.connect(muffled).connect(filter).connect(out);
    const sends: GainNode[] = this.echoes.map((conv) => {
      const send = ctx.createGain();
      send.gain.value = 0;
      head.connect(send).connect(conv);
      return send;
    });
    slot = { gain, pan, head, cut, dry, muffled, filter, sends, out, group: null, lastGain: 0, lastWrite: 0 };
    this.slots[index] = slot;
    return slot;
  }

  /** The slot's output joins its sound's layer. Only ever changed while the slot is silent. */
  private join(slot: Slot, group: SoundGroup): void {
    if (slot.group === group) return;
    if (slot.group) {
      const old = this.groups.get(slot.group);
      if (old) slot.out.disconnect(old);
    }
    const node = this.groups.get(group);
    if (node) slot.out.connect(node);
    slot.group = group;
  }

  /** Noise with an exponential decay: a room echo of our own, since the client's is not in the archives. */
  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(2, frames, ctx.sampleRate);
    const rng = seededRng(0xecc0);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < frames; i++) data[i] = (rng() * 2 - 1) * Math.pow(1 - i / frames, 3);
    }
    return buf;
  }

  private note(id: string, result: string): void {
    this.log.push({ id, at: Number(this.now.toFixed(2)), result });
    if (this.log.length > 40) this.log.splice(0, this.log.length - 40);
  }
}
