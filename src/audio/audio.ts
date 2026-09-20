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
  /**
   * The caller saying this is not a sound in the world but one made at the ear: a panel's click, a
   * confirmation, a warning. It takes no distance, nothing of a wall between it and the ear and
   * nothing of the room. It is asked of the caller rather than read off the template's category,
   * because the game's own interface table is not all of one category: two of its rows carry a
   * distance and sit on the effects layer, and three more carry a distance while being category 4.
   */
  ui?: boolean;
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
  /**
   * INVENTED: how much of a voice standing in the listener's own room is sent to each echo. The
   * client's own amounts are not in the archives; these are a light wash, more of it in the tall
   * halls, and the owner has a switch that turns the whole thing off.
   */
  echoSend: [number, number];
  /** INVENTED: seconds a voice takes to move between the echoes, or out of them at a doorway. */
  echoEase: number;
  /**
   * Not an amount but an override, for comparing the two echoes without walking to the room that
   * asks for the long one: below 0 the room comes from the game (`setRoom`), and any other value
   * stands in for the interior table's own number, so 7 puts every voice in a tall hall wherever
   * the ear is standing.
   */
  echoRoom: number;
  /** INVENTED: seconds a voice refused a slot waits before it asks again. */
  retry: number;
  /** INVENTED: seconds a voice that gives way fades over, so stealing one never clicks. */
  cutFade: number;
}

export const MIXER_TUNE: MixerTune = { writeRate: 30, ramp: 0.03, hideFade: 0.1, lookahead: 0.12, echo: [0.6, 1.8], echoSend: [0.12, 0.28], echoEase: 0.2, echoRoom: -1, retry: 0.25, cutFade: 0.008 };

/**
 * The client's room type, from the interior table's `Room Type` column. Only two values are used in
 * the retail tables: 7 on six rows (the four capitol lobbies, Mos Eisley's cantina and one station
 * greenhouse) and 22 on the other 259. So 7 is the long echo and everything else the short one; a
 * room the game has not named is an ordinary room, which is right for 259 rooms out of 265.
 */
const TALL_HALL_ROOM = 7;
/** No room at all: the open world, and what `setRoom` is given when the ear steps outside. */
const NO_ROOM = -1;

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
  /**
   * The share of the last voice that went through the muffled branch and through each echo. A slot
   * is handed from one voice to the next, and its dry, muffled and send gains are ramps: without
   * these the sound taking a slot over would come in wearing whatever the last one left, and slide
   * out of it over a fifth of a second.
   */
  lastMuffle: number;
  lastSends: number[];
  /** The voice the slot last sounded, so a loop coming round again is not treated as a new one. */
  owner: number;
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
  /**
   * Whether it was given a place at all. A bed, an interface click and a sound asked for with no
   * point stand wherever the ear does: they take no distance and no echo, since the echo is what
   * puts a sound in the room and they are not in it.
   */
  placed: boolean;
  /** The caller said this is a sound made at the ear, not one in the world. See `PlayOptions.ui`. */
  ui: boolean;
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
  /** The interior table's room type for the room the ear stands in; -1 is "not in one, or unnamed". */
  private roomType = NO_ROOM;
  private hidden = false;
  private unlocked = false;
  /** The browser's head-related impulses are loaded once, on the first press rather than mid-fight. */
  private warmedPanning = false;
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
      // Every row the interface plays is marked as such here, whatever category its template
      // carries, so the "not in the world" rule follows the caller and not the data.
      (id) => this.play(id, { gain: 1, ui: true }) !== 0,
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
    // for the tall halls. Both are ours (the client's settings are not in the archives). What
    // reaches them is each voice's own send, which is 0 out of doors and 0 with the setting off, so
    // the return stands open: a voice that leaves the room takes its send down and the echo rings
    // out after it rather than being cut off at the doorway. What an idle convolver costs is a
    // reading and not a measurement: a silent input should stay silent through the graph once the
    // tail has run out, but nothing here has timed it, so the A and B is the sends themselves
    // (`__debug.audio({ mixer: { echoSend: [0, 0] } })`).
    for (const seconds of this.tune.echo) {
      const conv = ctx.createConvolver();
      conv.buffer = this.impulse(seconds);
      const ret = ctx.createGain();
      ret.gain.value = 1;
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
      placed: options.x !== undefined,
      ui: options.ui ?? false,
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
    // A voice moved to a point has a place from here on, whether or not it was given one at the
    // start: a held loop whose emitter was not known on the frame it began (a saber lit before the
    // blade exists) would otherwise never fade with distance and never be echoed.
    p.placed = true;
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
   * Which of the game's own rooms the ear stands in, by the interior table's room type: 7 for the
   * six rows the table marks apart (the four capitol lobbies, Mos Eisley's cantina and one station
   * greenhouse) and 22 for every other room it names. Called by whoever tracks the room; a game
   * that never calls it still gets the ordinary echo wherever the listener's space says it is
   * inside something, which is what 259 of the table's 265 rows ask for anyway.
   */
  setRoom(type: number): void {
    this.roomType = Number.isFinite(type) ? type : NO_ROOM;
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
    // The room goes with the world: nothing names one again until the next world tracks the ear,
    // and a stale room type would leave the open world sounding like the hall it was left in.
    this.roomType = NO_ROOM;
  }

  /** What a hidden tab reads instead of listening. */
  status(): Record<string, unknown> {
    const voices: Record<string, unknown>[] = [];
    let waiting = 0;
    let gridded = 0;
    let muffledVoices = 0;
    let echoingVoices = 0;
    const index = this.echoIndex();
    for (const p of this.playing.values()) {
      if (p.slot < 0 && p.loop) waiting++;
      if (p.gridded) gridded++;
      const worldly = this.worldly(p);
      const muffle = worldly ? muffleShare(this.listener.space, p.space) : 0;
      const echo = worldly && p.placed && muffle <= 0 && index >= 0 ? (this.tune.echoSend[index] ?? 0) * this.groupGain(p.group) : 0;
      if (muffle > 0) muffledVoices++;
      if (echo > 0) echoingVoices++;
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
        // Where it stands in relation to the ear's own room: through a wall, or in the room with it.
        space: worldly ? (p.placed ? `${p.space.building}:${p.space.cell}` : 'no place') : 'not in the world',
        muffled: muffle > 0,
        echo: Number(echo.toFixed(3)),
      });
    }
    voices.sort((a, b) => (b.gain as number) - (a.gain as number));
    return {
      state: this.state,
      unlocked: this.unlocked,
      hidden: this.hidden,
      master: this.masterGain(),
      groups: Object.fromEntries(SOUND_GROUPS.map((g) => [g, this.groupGain(g)])),
      // What the graph is doing rather than what the settings ask for: which model the panners that
      // exist are really using, and what the room rule is really sending.
      panning: this.slots.find((s) => s?.pan)?.pan?.panningModel ?? (this.settings.soundHeadphones ? 'HRTF' : 'equalpower'),
      headphones: {
        on: this.settings.soundHeadphones,
        // A slot whose model disagrees with the setting: this must stay 0, or a voice is being
        // placed by the wrong rule.
        disagreeing: this.slots.filter((s) => s?.pan && s.pan.panningModel !== (this.settings.soundHeadphones ? 'HRTF' : 'equalpower')).length,
        // The warm-up has been pushed through once this session. Whether the browser has finished
        // loading its impulses is its own business and nothing in script can see it, so this says
        // what was asked for and not what is done.
        warmedAsked: this.warmedPanning,
      },
      // The room the ear is in and what that asks of the echoes. `room` is what the game named, and
      // `inside` whether the ear's own space is in a building or aboard a hull; either one puts the
      // echo on, and 7 (the tall halls) is the one that picks the long impulse.
      echo: {
        impulses: this.echoes.length,
        seconds: [...this.tune.echo],
        on: this.settings.soundRoomEcho,
        room: this.roomType === NO_ROOM ? null : this.roomType,
        // The console's override, when one is set: what `room` would have to be for the echo in
        // force. Null is the ordinary case, the room coming from the game.
        forcedRoom: this.tune.echoRoom >= 0 ? this.tune.echoRoom : null,
        inside: this.listener.space.building >= 0,
        using: index < 0 ? null : index,
        send: index < 0 ? 0 : (this.tune.echoSend[index] ?? 0),
        voices: echoingVoices,
        sending: this.slots.some((s) => s?.sends.some((g) => g.gain.value > 0)),
      },
      muffledVoices,
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
    this.warmPanning();
    const model: PanningModelType = this.settings.soundHeadphones ? 'HRTF' : 'equalpower';
    for (const slot of this.slots) if (slot?.pan && slot.pan.panningModel !== model) slot.pan.panningModel = model;
    this.lastGroupWrite = -1;
  }

  /**
   * The first panner asked to place a sound around the head makes the browser load its set of
   * head-related impulses, which is work on the main thread and then on the audio thread. Left to
   * happen on a voice, it would land on whichever sound the player heard first after switching the
   * setting on -- a shot in a fight, most likely. So the moment headphones are asked for, one
   * silent frame of sound is pushed through a panner of its own, and the load is the browser's to
   * finish while nothing is being placed. Done once; switching back and forth costs nothing after
   * that. Switching the setting on during play already forced the load through the loop below,
   * which retunes every slot that exists, so what this really covers is a settings object applied
   * at start, where no slot has been built yet. Whether the browser has finished is not something
   * script can see: the report says the warm-up was asked for, not that it is over.
   */
  private warmPanning(): void {
    const ctx = this.ctx;
    if (!ctx || this.warmedPanning || !this.settings.soundHeadphones) return;
    this.warmedPanning = true;
    try {
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 128, ctx.sampleRate);
      src.connect(pan).connect(gain).connect(this.master ?? ctx.destination);
      src.onended = () => {
        src.disconnect();
        pan.disconnect();
        gain.disconnect();
      };
      src.start(ctx.currentTime);
    } catch {
      /* a context that cannot pan cannot be warmed, and nothing here may throw into a frame */
    }
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
    // The slot may have been another voice's a moment ago, and its dry, muffled and echo gains are
    // ramps: a new voice's are written outright at the same time as its level, rather than sliding
    // out of what the last one left. A loop of this same voice coming round again is not a new
    // voice, and must not snap out of a crossfade it is part way through (a bed looping while the
    // player walks through a doorway).
    this.writeSpace(p, slot, at, slot.owner !== p.key);
    slot.owner = p.key;
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
    // Not in the world: heard wherever the ear is, at the gain it was given. Without this a click
    // is heard through the wall filter the moment the player steps into a building, and one whose
    // row carries a distance (three of the game's own interface rows do) goes silent there, since
    // a placeless sound with a distance is heard only in the ear's own building.
    if (!this.worldly(p)) return 1;
    if (p.flat && p.template.full <= 0) return 1;
    if (p.flat && !p.placed) return p.space.building === this.listener.space.building ? 1 : 0;
    this.counts.distanceTests++;
    return this.audibleAt(p, Math.hypot(p.x - this.listener.x, p.y - this.listener.y, p.z - this.listener.z));
  }

  /**
   * The same answer for a loop that sits in the grid, from the distance the pass has just measured:
   * nothing here measures a distance of its own, which is the whole point of the grid.
   */
  private gridAudible(p: Playing): number {
    // The same first answer as `audibleOf`, so the two paths cannot disagree about a voice that is
    // not in the world: a looping one would otherwise be distance-tested here after being exempted
    // everywhere else.
    if (!this.worldly(p)) return 1;
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
    this.writeSpace(p, slot, now, false);
  }

  /**
   * Where the voice stands in relation to the ear's own room: through the wall, or in the room with
   * it. Both halves are ours -- whether the client muffled anything at all is not in the archives,
   * and neither are its echo settings.
   *
   * - **Through a wall.** The listener inside a building and the source outside it, or the other way
   *   round: the voice moves off the dry path onto the muffled one, which is a low-pass and a drop
   *   in level, and sends nothing to the room's echo, since it is not in the room.
   * - **In the room with you.** A voice that stands somewhere in the ear's own room is sent to
   *   whichever echo that room asks for. A voice with no place of its own -- an area bed, which is
   *   the sound of wherever the ear is -- is not: the echo is what puts a sound somewhere in a
   *   room, and a bed is not anywhere in it. Neither is a voice the caller made at the ear.
   *
   * `snap` writes the values outright rather than ramping to them, which is what a slot handed to a
   * new voice needs: the gains are ramps, and without it the new sound would come in wearing the
   * last one's muffling and slide out of it over a fifth of a second.
   */
  private writeSpace(p: Playing, slot: Slot, when: number, snap: boolean): void {
    const worldly = this.worldly(p);
    const muffle = worldly ? muffleShare(this.listener.space, p.space) : 0;
    if (snap || Math.abs(muffle - slot.lastMuffle) > 1e-3) {
      const dry = 1 - muffle;
      const wet = muffle * this.distance.muffleGain;
      if (snap) {
        // Outright, and with whatever the last voice left still running cancelled first: the
        // voice giving the slot up is fading out on a node of its own and its ramps are still in
        // the queue, so a bare write would be overtaken by them.
        slot.dry.gain.cancelScheduledValues(when);
        slot.muffled.gain.cancelScheduledValues(when);
        slot.dry.gain.setValueAtTime(dry, when);
        slot.muffled.gain.setValueAtTime(wet, when);
      } else {
        slot.dry.gain.setTargetAtTime(dry, when, this.distance.muffleEase);
        slot.muffled.gain.setTargetAtTime(wet, when, this.distance.muffleEase);
      }
      slot.lastMuffle = muffle;
    }
    // Which echo this frame's room asks for, and how much of a voice standing in it goes there.
    // The two echoes are shared by every layer and return straight to the master, so a voice's send
    // carries its own layer's gain: without it, turning Ambience down would leave the cantina's own
    // echo playing at full volume.
    const index = worldly && p.placed && muffle <= 0 ? this.echoIndex() : -1;
    const layer = this.groupGain(p.group);
    for (let i = 0; i < slot.sends.length; i++) {
      const want = i === index ? (this.tune.echoSend[i] ?? 0) * layer : 0;
      if (!snap && Math.abs(want - slot.lastSends[i]) <= 1e-3) continue;
      if (snap) {
        slot.sends[i].gain.cancelScheduledValues(when);
        slot.sends[i].gain.setValueAtTime(want, when);
      } else slot.sends[i].gain.setTargetAtTime(want, when, this.tune.echoEase);
      slot.lastSends[i] = want;
    }
  }

  /**
   * Whether a voice is in the world at all. A sound the caller made at the ear is not, and neither
   * is the music bus: they are heard wherever the ear is, at the gain they were given, with no
   * distance, no wall between them and nothing of the room about them. A click muffled through a
   * wall because the player walked into a cantina reads as a fault in the menu.
   *
   * It asks the caller (`PlayOptions.ui`) rather than the template's category, because the game's
   * own interface table is not all of one category: two of its rows are category 2 and would land
   * on the effects layer, and three more carry a distance, which on a voice with no place of its
   * own means "heard only in the ear's own building" -- silence the moment the player steps
   * indoors.
   */
  private worldly(p: Playing): boolean {
    return !p.ui && p.group !== 'music';
  }

  /**
   * Which of the two room echoes the ear's own room asks for, or -1 for none: out of doors, with
   * the setting off, or when nothing has said where the listener is. A room the game has not named
   * is an ordinary room.
   */
  private echoIndex(): number {
    if (!this.settings.soundRoomEcho) return -1;
    const room = this.roomNow();
    // Inside: either the game has named the room the ear is in, or the ear's own space says it is
    // in a building or aboard a hull. Stepping outside is `setRoom(-1)` and a space of -1, so a
    // caller that names rooms must name the open world too.
    if (room === NO_ROOM && this.listener.space.building < 0) return -1;
    return room === TALL_HALL_ROOM ? 1 : 0;
  }

  /** The room type in force: the console's override where it is set, and the game's otherwise. */
  private roomNow(): number {
    return this.tune.echoRoom >= 0 ? this.tune.echoRoom : this.roomType;
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
    slot = { gain, pan, head, cut, dry, muffled, filter, sends, out, group: null, lastGain: 0, lastWrite: 0, lastMuffle: 0, lastSends: sends.map(() => 0), owner: 0 };
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
