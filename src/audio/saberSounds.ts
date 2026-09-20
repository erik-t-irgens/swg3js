/**
 * Lightsabers, heard: the hum a lit blade carries, its ignition and shut-off, the whoosh of a
 * swing, what it sounds like when it meets a bolt, a body or a wall, the fizz of rain on it and the
 * boil of it under water -- and the Force powers, which are the same kind of thing and live here so
 * that one place knows how to turn a moment in the fight into one of the game's sounds.
 *
 * Two sets of files can fill those roles, and the player chooses between them in the Sound menu
 * (`soundSabers`): Jedi Academy's, which is the default the owner asked for, and the game's own
 * `wep_*_lightsaber` templates. Only the saber's own roles change with the setting. What Jedi
 * Academy's animations name for themselves -- a kick's punch, a body hitting the ground, the spins
 * -- stays Jedi Academy's either way, because the game has nothing of that kind to swap in.
 *
 * Three things here are worth knowing before changing any of it:
 *
 *  - **Jedi Academy's files have no sound template.** The game's own sounds each come from a `.snd`
 *    the converter reads, and the bank is keyed by those. Jedi Academy's are copied under
 *    `sounds/jka/` as they are, so a template is made for each role here, at the settings the
 *    game's own lightsaber templates carry, and hung in front of the bank's own lookup. The one
 *    seam is `useBank` below.
 *  - **A move's whooshes come from the move.** Jedi Academy marks the frames its specials, katas,
 *    back attacks, spins and kicks sound on, and those marks are in the clip-event pack the feet
 *    already read. A swing whose clip carries marks is scheduled on the audio clock at the marks'
 *    own times; one that carries none (every ordinary attack of every style) whooshes once as it
 *    starts, from its style's group of three. So the two can never double up.
 *  - **Nothing here runs on a clock of its own.** Everything is either an event (a swing, a hit, a
 *    power) or the per-frame call the blade renderer already makes, and the times are the mixer's
 *    audio clock, which is the one clock a hidden tab does not throttle.
 *
 * It must work with no mixer at all: with nothing attached every call below returns at once, which
 * is what the gallery, the ship preview and the node tests do.
 */
import { liveSettings } from '../core/settings.ts';
import type { ClipEventIndex } from './clipEvents.ts';
import type { SoundSpace } from './distance.ts';
import type { SoundTemplate } from './template.ts';

/** Anything with a place: a three.js vector satisfies it, so nothing here imports three. */
export interface SaberPoint {
  x: number;
  y: number;
  z: number;
}

/** What one Force power sounds like; the powers carry their own (`forcePowers.ts`). */
export interface PowerSoundSet {
  /** A tap power: one sound as it fires. */
  once?: string;
  /** A hold or a toggle: one as it comes on, a loop while it lasts, one as it goes. */
  start?: string;
  loop?: string;
  end?: string;
}

/** A power as this file needs to see it, so nothing in `src/audio/` depends on the combat code. */
export interface PowerLike {
  id: string;
  sound?: PowerSoundSet;
}

/**
 * The mixer, as far as the sabers need it. `AudioSystem` satisfies it; the node test hands in a
 * few lines of bookkeeping instead, which is the only way any of this can be checked in a tab that
 * can hear nothing.
 */
export interface SaberHost {
  /** The audio clock. Everything scheduled here is scheduled on it. */
  readonly now: number;
  /** True while simulated seconds are being stepped: the mixer records and starts nothing. */
  readonly advancing?: boolean;
  readonly bank: { available: boolean; template(id: string): unknown };
  play(id: string, options?: { x?: number; y?: number; z?: number; space?: SoundSpace; loop?: boolean; gain?: number; pitch?: number; at?: number }): number;
  stop(key: number, fade?: number): void;
  move(key: number, x: number, y: number, z: number): void;
  setGain(key: number, gain: number): void;
  isPlaying(key: number): boolean;
  prepare(ids: Iterable<string>): void;
}

/**
 * What the world is asked, and only ever about a blade that is lit: which room the ear is in (so a
 * blade in the hand is never treated as being in another room and muffled), whether it is raining
 * over the blade and whether the blade is under water. `World` satisfies it as it stands.
 */
export interface SaberWorld {
  readonly listenerSpace: SoundSpace;
  readonly weather: { fx: { rain: number }; roofs: { topAt(x: number, z: number): number } };
  readonly footSurfaces: { waterTop(x: number, z: number): number; space(x: number, y: number, z: number): SoundSpace | null };
}

export interface SaberTune {
  /** INVENTED: how much louder the hum gets at a full swing, as a share of itself. */
  humSwing: number;
  /** INVENTED: tip speed in metres a second at which that rise is reached. */
  humSwingAt: number;
  /** INVENTED: seconds a hum fades over when the blade goes out, so a shut-off never clicks. */
  humFade: number;
  /** INVENTED: seconds between two drops of rain hissing off one blade, drawn between the two. */
  fizzGap: [number, number];
  /** INVENTED: how often a lit blade asks the world about rain and water, in times a second. */
  weatherRate: number;
  /** INVENTED: seconds a telling from outside holds before the blade asks the world again itself. */
  told: number;
  /** INVENTED: the least seconds between two contacts of the same kind, so a blade dragged along a wall does not rattle. */
  contactGap: number;
  /** INVENTED: the same for swings, which a chain can start very close together. */
  swingGap: number;
  /** INVENTED: metres within which two sounds of one kind are taken for the same blade, so that two fighters never swallow each other's. */
  contactNear: number;
  /** INVENTED: seconds a power's loop fades over when the power ends. */
  powerFade: number;
  /** INVENTED: the most whooshes one move may schedule, so a bad pack cannot fill the voice pool. */
  maxMarks: number;
  /** INVENTED: seconds a lit blade may go undrawn before its hum is let go (a mobile culled, a body dying off screen). */
  lost: number;
  /** INVENTED: seconds a drawn blade of the player's still counts as out, for a swing that asks. */
  bladeFresh: number;
  /** INVENTED: seconds a hum the mixer would not start waits before asking again. */
  humRetry: number;
  /** INVENTED: how fast the hum's swing follows the tip's speed, as a rate a second. */
  humEase: number;
}

/**
 * Ours, every one, and all in one place: `__debug.sabers({ humSwing: 0.4 })` moves them live.
 * The rain gap is the one the owner is most likely to want moved, since how often a blade hisses
 * in the rain is a matter of taste and the game has nothing to say about it.
 */
export const SABER_TUNE: SaberTune = { humSwing: 0.2, humSwingAt: 12, humFade: 0.08, fizzGap: [0.3, 0.8], weatherRate: 4, told: 1, contactGap: 0.06, swingGap: 0.05, contactNear: 3, powerFade: 0.15, maxMarks: 12, lost: 0.5, bladeFresh: 0.25, humRetry: 0.5, humEase: 8 };

/** The last few things asked for, kept for the report and no longer. */
const LOG_KEPT = 32;

/** Which template a style's whoosh comes from, so a swing builds no string. */
const SWING_ROLE = { fast: 'swingFast', medium: 'swingMedium', strong: 'swingStrong' } as const;

/** The five styles the saber fights in, and the two the game's own blades are held as. */
export type SaberStyleName = 'fast' | 'medium' | 'strong' | 'dual' | 'staff';

/** What a blade can strike. */
export type SaberContact = 'block' | 'clash' | 'body' | 'wall' | 'water' | 'bounce' | 'catch';

/**
 * Which three of Jedi Academy's nine whooshes a style swings with. Recalled from Jedi Academy's
 * released source rather than read from its data, which is why it is written down here alone and
 * why the same three groups are what `animevents.cfg`'s own ranges use (1 to 3, 4 to 6, 7 to 9).
 * The dual and staff styles are placed by their speed, which is ours.
 */
export function swingGroup(style: string): 'fast' | 'medium' | 'strong' {
  if (style === 'fast' || style === 'dual') return 'fast';
  if (style === 'strong') return 'strong';
  return 'medium';
}

/** The game's own lightsaber sounds, in the roles Jedi Academy's files fill. */
const SWG_SET: Readonly<Record<string, string | null>> = {
  hum: 'sound/wep_idle1_lightsaber.snd',
  humOther: 'sound/wep_idle2_lightsaber.snd',
  on: 'sound/wep_activate_lightsaber.snd',
  off: 'sound/wep_deactivate_lightsaber.snd',
  // INVENTED: the game has two swing templates and nothing to say which is which, so the split is
  // ours -- the shorter `wep_lightsaber_swing` for the two quicker styles, `wep_swing_lightsaber`
  // for the strong one, which is the heavier of the two by ear.
  swingFast: 'sound/wep_lightsaber_swing.snd',
  swingMedium: 'sound/wep_lightsaber_swing.snd',
  swingStrong: 'sound/wep_swing_lightsaber.snd',
  block: 'sound/wep_lightsaber_deflect_shot.snd',
  clash: 'sound/wep_hit_lightsaber_lightsaber.snd',
  body: 'sound/wep_lightsaber_hit_flesh.snd',
  wall: 'sound/wep_lightsaber_hit.snd',
  water: 'sound/wep_lightsaber_hit_water.snd',
  bounce: 'sound/wep_lightsaber_thrown_hit.snd',
  // INVENTED: the game has no rain on a blade, so a drop hissing off one stands in as the sound of
  // the blade meeting water, which is what it is.
  fizz: 'sound/wep_lightsaber_hit_water.snd',
  // The game has no blade held under water and no blade caught out of the air, so these two keep
  // Jedi Academy's whatever the setting says. The report names them.
  boil: null,
  catch: null,
};

/**
 * Where each role's files sit in Jedi Academy's archives, and how many of each there are. A role
 * with several becomes one template with all of them as its samples, picked between at random,
 * which is exactly the shape the game's own multi-sample templates have.
 *
 * `full` is how far the sound carries at its full level. Every role that has a counterpart among
 * the game's own lightsaber templates takes that template's own figure, so the two sets carry the
 * same distance and the menu changes nothing but the file: 20 for the ignition and the shut-off
 * (`wep_activate_lightsaber`) and for a blade meeting a blade (`wep_hit_lightsaber_lightsaber`), 8
 * for a swing (`wep_lightsaber_swing`) and for a wall (`wep_lightsaber_hit`), 12 for a bolt turned
 * away (`wep_lightsaber_deflect_shot`), a body (`..._hit_flesh`), water (`..._hit_water`) and the
 * thrown blade striking (`wep_lightsaber_thrown_hit`). The three the game has nothing of the kind
 * for are marked INVENTED where they sit.
 */
const JKA_ROLES: readonly { role: string; pattern: string; range?: [number, number]; loop?: boolean; full?: number }[] = [
  { role: 'on', pattern: 'sound/weapons/saber/saberon.wav' },
  { role: 'off', pattern: 'sound/weapons/saber/saberoff.wav' },
  { role: 'swingFast', pattern: 'sound/weapons/saber/saberhup%d.wav', range: [1, 3], full: 8 },
  { role: 'swingMedium', pattern: 'sound/weapons/saber/saberhup%d.wav', range: [4, 6], full: 8 },
  { role: 'swingStrong', pattern: 'sound/weapons/saber/saberhup%d.wav', range: [7, 9], full: 8 },
  { role: 'block', pattern: 'sound/weapons/saber/saberblock%d.wav', range: [1, 9], full: 12 },
  { role: 'clash', pattern: 'sound/weapons/saber/saberblock%d.wav', range: [1, 9], full: 20 },
  { role: 'body', pattern: 'sound/weapons/saber/saberhit%d.wav', range: [1, 3], full: 12 },
  { role: 'wall', pattern: 'sound/weapons/saber/saberhitwall%d.wav', range: [1, 3], full: 8 },
  { role: 'bounce', pattern: 'sound/weapons/saber/saberbounce%d.wav', range: [1, 3], full: 12 },
  // INVENTED: the game has no blade caught out of the air, no blade under water and no rain on a
  // blade, so these three carry a blow's 12 and a swing's 8 rather than a figure of the game's own.
  { role: 'catch', pattern: 'sound/weapons/saber/saber_catch.wav', full: 12 },
  { role: 'water', pattern: 'sound/weapons/saber/hitwater.wav', full: 12 },
  { role: 'fizz', pattern: 'sound/weapons/saber/rainfizz%d.wav', range: [1, 3], full: 8 },
  { role: 'boil', pattern: 'sound/weapons/saber/boiling.wav', loop: true, full: 12 },
];

/**
 * Which of Jedi Academy's hilts a blade hums as. Its own table gives every hilt a hum, and all but
 * a handful name the same one: the player's blade is a plain hilt's (`saberhum4`), the double
 * bladed one the staff hilt's, and anyone else's is the Jedi hilt's (`saberhum1`), which is a hum
 * apart and is what makes a room with two Jedi in it sound like two blades. The choice of hilt is
 * ours; each hum is the one that hilt's own file names.
 */
const HILT_OF = { player: 'single_1', staff: 'dual_1', other: 'jedi' } as const;

/**
 * The id each of those hums is made under, worked out once: `hum` is reached on every frame of
 * every lit blade, and building the string there would be an allocation a frame per blade.
 */
const HUM_ID = { player: `jka:hum:${HILT_OF.player}`, staff: `jka:hum:${HILT_OF.staff}`, other: `jka:hum:${HILT_OF.other}` } as const;

/**
 * The settings a made-up template carries. They are not invented: they are the settings the game's
 * own lightsaber templates carry (category 7, priority 3, and the full-volume radius each role's
 * own `wep_*` template uses), applied to Jedi Academy's file.
 */
const JKA_CATEGORY = 7;
const JKA_PRIORITY = 3;
const JKA_FULL = 20;

/** What the converter writes at `sounds/jka.json`. */
export interface JkaPack {
  format?: number;
  /** Each hilt's ignition, hum and shut-off, as its `.sab` names them. */
  sabers?: Record<string, { on?: string; loop?: string; off?: string }>;
  /** Every file copied, by its archive path, with its size. The only list of what is really there. */
  files?: Record<string, number>;
  voices?: string[];
}

/** One blade's own sound: its hum, what it is standing in, and when it last spoke. */
interface BladeVoice {
  /** The mixer's key for the hum, or 0 while it has none. */
  hum: number;
  /** The id the hum is playing, so a change of set or of hilt swaps it. */
  humId: string;
  /** The boil under water, which stands in for the hum while the blade is submerged. */
  boil: number;
  lit: boolean;
  x: number;
  y: number;
  z: number;
  /** Last frame's tip, for the speed the hum rises with; not a place anything is played at. */
  tx: number;
  ty: number;
  tz: number;
  speed: number;
  /** Whose blade it is, which picks the hilt and whether the ear's own room is used. */
  owner: 'player' | 'other';
  /** Whether it hums as a staff hilt. Decided at the ignition and kept, so the hum never swaps under a lit blade. */
  staff: boolean;
  /** The room it is in; the player's is the ear's own, so a blade in the hand is never muffled. */
  readonly space: SoundSpace;
  raining: boolean;
  underwater: boolean;
  /** Audio time the world was last asked about the weather over this blade, and the next fizz. */
  askedAt: number;
  /** Audio time something outside said what the weather was doing to it, which holds for a second. */
  toldAt: number;
  fizzAt: number;
  /** The earliest audio time a hum the mixer would not start may be asked for again. */
  retryAt: number;
  /**
   * Audio time the blade was last drawn. A renderer can stop being called without the blade ever
   * going out -- a mobile culled as it walks behind the camera, a body that dies off screen -- and
   * a hum nobody is holding would stay where it was for as long as the thing lived: `tick` sweeps
   * on this, and the blade coming back into view starts humming again on its next drawn frame.
   */
  heardAt: number;
}

/** A power's loop while it lasts. */
interface PowerVoice {
  key: number;
  id: string;
}

const NO_SPACE: SoundSpace = { building: -1, cell: -1 };

/**
 * Every lightsaber in the world and every Force power in play, as sound. One of these lives as long
 * as the game does (`sabers` below); the mixer is handed to it once and everything else is called
 * from the blade renderer, the move machine and the Jedi kit.
 */
export class SaberSounds {
  readonly tune: SaberTune = SABER_TUNE;
  /** Counters a tab that can hear nothing reads instead of listening. */
  readonly counts = { hums: 0, ignitions: 0, swings: 0, marked: 0, marks: 0, contacts: 0, fizzes: 0, powers: 0, refused: 0, noSound: 0, lost: 0 };
  /** The last few things asked for, which is how sabers are checked without hearing them. */
  readonly log: { at: number; what: string; sound: string | null; key: number }[] = [];

  private host: SaberHost | null = null;
  private clips: ClipEventIndex | null = null;
  private world: SaberWorld | null = null;
  private baseUrl = '';
  private pack: JkaPack | null = null;
  private packState = 'not fetched';
  /** The templates made for Jedi Academy's files, by the id the mixer asks for them under. */
  private readonly made = new Map<string, SoundTemplate>();
  /** Which id fills each role now, for the set in play; rebuilt when the setting changes. */
  private readonly roles = new Map<string, string | null>();
  private roleSet = '';
  /** The bank whose lookup the made-up templates already hang in front of; never wrapped twice. */
  private patchedBank: object | null = null;
  private prepared = false;
  /**
   * Audio times of the last swing and of the last blow of each kind, each with where it happened:
   * the gap is what keeps a blade dragged along a wall from rattling, which is a thing one blade
   * does in one place, so two fighters a room apart never swallow each other's.
   */
  private lastSwingAt = -1e9;
  private readonly lastSwingWhere: SaberPoint = { x: 0, y: 0, z: 0 };
  private readonly lastContactAt: Record<SaberContact, number> = { block: -1e9, clash: -1e9, body: -1e9, wall: -1e9, water: -1e9, bounce: -1e9, catch: -1e9 };
  private readonly lastContactWhere: Record<SaberContact, SaberPoint> = {
    block: { x: 0, y: 0, z: 0 },
    clash: { x: 0, y: 0, z: 0 },
    body: { x: 0, y: 0, z: 0 },
    wall: { x: 0, y: 0, z: 0 },
    water: { x: 0, y: 0, z: 0 },
    bounce: { x: 0, y: 0, z: 0 },
    catch: { x: 0, y: 0, z: 0 },
  };
  /** Audio time the blades were last swept for hums nobody is holding any more (`tick`). */
  private sweptAt = -1e9;
  private readonly voices = new Map<object, BladeVoice>();
  private readonly powers = new Map<string, PowerVoice>();
  /** Where the player's blades are, so a swing the move machine starts sounds at the blade. */
  private playerAt: SaberPoint | null = null;
  private playerBlades: readonly object[] | null = null;
  /**
   * The player's own lit blade as the renderer last drew it, in world space, and when. It is
   * preferred over the body's place for everything the player's own hands do, because aboard a
   * ship the body's place is in the hull's frame and the drawn blade is always in the world's.
   */
  private readonly bladePoint: SaberPoint = { x: 0, y: 0, z: 0 };
  private bladeSeen = -1e9;
  /** The `__debug` object this class hung its report on, which the game replaces once at startup. */
  private exposedOn: object | null = null;
  /**
   * Scheduled whooshes and the audio time each is to start at, so a move cut short takes with it
   * the ones that have not sounded yet and leaves alone any that already has.
   */
  private readonly scheduled: number[] = [];
  private readonly scheduledAt: number[] = [];

  /** Whether anything can sound at all. */
  get ready(): boolean {
    return !!this.host;
  }

  /** Which set of files is in play: the menu's choice, or the game's own when Jedi Academy's are not converted. */
  get set(): 'jka' | 'swg' {
    const want = liveSettings().soundSabers === 'swg' ? 'swg' : 'jka';
    return want === 'jka' && !this.pack ? 'swg' : want;
  }

  /**
   * The mixer, and the three things that make a blade sound like it is somewhere: the clip events
   * (which say when a move whooshes), the world (the ear's room, the rain and the water) and where
   * the pack is fetched from. Called once, from the game, with everything already built.
   */
  attach(host: SaberHost | null, opts: { clips?: ClipEventIndex | null; world?: SaberWorld | null; baseUrl?: string } = {}): void {
    this.host = host;
    if (opts.clips !== undefined) this.clips = opts.clips;
    if (opts.world !== undefined) this.world = opts.world;
    if (opts.baseUrl !== undefined) this.baseUrl = opts.baseUrl;
    this.prepared = false;
    this.roleSet = '';
    // The report goes up with the mixer, so the lead can ask what the blades are doing before one
    // has made a sound. It is hung again from `tick` if the game replaces `__debug` after this.
    this.expose();
    this.load();
  }

  /** The clip events, when they arrive after the mixer (the node test hands its own in). */
  attachClips(clips: ClipEventIndex | null): void {
    this.clips = clips;
  }

  /** A pack read elsewhere: the node test, and anything that has already fetched it. */
  adopt(pack: JkaPack | null): void {
    this.pack = pack && (pack.files || pack.sabers) ? pack : null;
    this.packState = this.pack ? `${Object.keys(this.pack.files ?? {}).length} Jedi Academy sounds` : 'no jka.json; run the sounds command with --jka';
    this.made.clear();
    this.roleSet = '';
    this.prepared = false;
    if (!this.pack) return;
    this.build();
    // The bank must know the made-up templates before it is asked to fetch anything for them, and
    // the whole set is about a megabyte: it is asked for here, behind whatever loading screen is up,
    // rather than on the first blade lit in a fight.
    this.useBank();
    this.prepareSet();
  }

  /**
   * Fetch Jedi Academy's own set. It is 7 KB and is never awaited on any path: until it lands the
   * blades use the game's own sounds, which need no template of their own, so a saber is never
   * silent for want of it.
   */
  private load(): void {
    if (typeof window === 'undefined' || this.packState !== 'not fetched') return;
    this.packState = 'loading';
    void fetch(`${this.baseUrl}assets-private/sounds/jka.json`)
      .then(async (res) => (res.ok ? ((await res.json()) as JkaPack) : null))
      .catch(() => null)
      .then((pack) => {
        this.adopt(pack);
        if (!pack) console.info("sound: no sounds/jka.json, so the blades use the game's own sounds; run the sounds command with --jka");
      });
  }

  /**
   * A template per role, from the files the pack says are really there. Jedi Academy's own loader
   * falls back between `.wav` and `.mp3` when a name is written with the wrong one (nine of the
   * whooshes are), and so does this, the same way the converter does.
   */
  private build(): void {
    const files = this.pack?.files ?? {};
    const have = (path: string): string | null => {
      if (files[path] !== undefined) return path;
      const other = path.endsWith('.wav') ? `${path.slice(0, -4)}.mp3` : path.endsWith('.mp3') ? `${path.slice(0, -4)}.wav` : null;
      return other && files[other] !== undefined ? other : null;
    };
    for (const row of JKA_ROLES) {
      const samples = this.samplesOf(row.pattern, row.range, have);
      if (!samples.length) continue;
      this.made.set(`jka:${row.role}`, this.template(samples, row.full ?? JKA_FULL, row.loop));
    }
    // The hums: one template per hilt this game uses, since the hums are what tell two blades apart.
    for (const hilt of Object.values(HILT_OF)) {
      const loop = this.pack?.sabers?.[hilt]?.loop;
      const path = loop ? have(loop) : null;
      if (path) this.made.set(`jka:hum:${hilt}`, this.template([path], JKA_FULL, true));
    }
    // The ignition and the shut-off the player's own hilt names, where its file differs from the
    // plain one above.
    const player = this.pack?.sabers?.[HILT_OF.player];
    for (const [role, named] of [
      ['on', player?.on],
      ['off', player?.off],
    ] as const) {
      const path = named ? have(named) : null;
      if (path) this.made.set(`jka:${role}`, this.template([path], JKA_FULL));
    }
  }

  /** A pattern's files, in order: `saberhup%d.wav` over 4 to 6 is three samples of one template. */
  private samplesOf(pattern: string, range: [number, number] | undefined, have: (p: string) => string | null): string[] {
    const out: string[] = [];
    if (!pattern.includes('%d')) {
      const one = have(pattern);
      if (one) out.push(one);
      return out;
    }
    const [lo, hi] = range ?? [1, 1];
    for (let i = lo; i <= hi; i++) {
      const path = have(pattern.replace('%d', String(i)));
      if (path) out.push(path);
    }
    return out;
  }

  /**
   * One made-up template. The sample path is written against the bank's own samples folder, which is
   * where it fetches everything from: Jedi Academy's files are copied beside it under `sounds/jka/`,
   * and a URL takes the step up as any address does.
   */
  private template(samples: readonly string[], full: number, loop = false): SoundTemplate {
    const paths = samples.map((s) => `../jka/${s}`);
    return loop
      ? { dim: 3, samples: paths, category: JKA_CATEGORY, priority: JKA_PRIORITY, full, loops: [-1, -1] }
      : { dim: 3, samples: paths, category: JKA_CATEGORY, priority: JKA_PRIORITY, full };
  }

  /**
   * The seam. Jedi Academy's files have no `.snd` of their own, so the bank knows nothing of them:
   * this hangs the made-up templates in front of the bank's own lookup, which answers everything
   * else exactly as before. It is done once, on the bank the game handed over, and the bank's own
   * method stays as the fall-through -- so `prepare`, `play` and everything that asks the bank a
   * question keeps working for the game's own 5,597 templates.
   */
  private useBank(): void {
    const host = this.host;
    if (!host || this.patchedBank === host.bank) return;
    this.patchedBank = host.bank;
    const bank = host.bank as { template(id: string): unknown };
    const inner = bank.template.bind(bank);
    const made = this.made;
    bank.template = (id: string): unknown => made.get(id) ?? inner(id);
  }

  /** Which id fills a role now. Rebuilt only when the menu's choice changes. */
  private idFor(role: string): string | null {
    const set = this.set;
    if (set !== this.roleSet) {
      this.roleSet = set;
      this.roles.clear();
      this.prepared = false;
    }
    let id = this.roles.get(role);
    if (id === undefined) {
      id = this.resolve(role, set);
      // Nothing is written down until the bank is in: a role looked up while the pack is still
      // coming would be remembered as having no sound at all for the rest of the session.
      if (this.host?.bank.available) this.roles.set(role, id);
    }
    return id;
  }

  private resolve(role: string, set: 'jka' | 'swg'): string | null {
    const host = this.host;
    if (set === 'swg') {
      const id = SWG_SET[role] ?? null;
      // A role the game has nothing for (a blade under water, a blade caught out of the air) keeps
      // Jedi Academy's file whichever set is chosen.
      if (id && host?.bank.template(id)) return id;
      return this.made.has(`jka:${role}`) ? `jka:${role}` : null;
    }
    if (this.made.has(`jka:${role}`)) return `jka:${role}`;
    const id = SWG_SET[role] ?? null;
    return id && host?.bank.template(id) ? id : null;
  }

  /** The hum a blade carries, by whose it is. */
  private humId(owner: 'player' | 'other', staff: boolean): string | null {
    if (this.set === 'swg') return (owner === 'player' ? SWG_SET.hum : SWG_SET.humOther) ?? null;
    const id = owner === 'other' ? HUM_ID.other : staff ? HUM_ID.staff : HUM_ID.player;
    return this.made.has(id) ? id : (SWG_SET.hum ?? null);
  }

  /** Everything the blades will want, asked for once so nothing waits on a fetch mid-fight. */
  private prepareSet(): void {
    const host = this.host;
    if (this.prepared || !host || !host.bank.available) return;
    this.prepared = true;
    const ids: string[] = [];
    for (const role of ['on', 'off', 'swingFast', 'swingMedium', 'swingStrong', 'block', 'clash', 'body', 'wall', 'bounce', 'catch', 'fizz', 'boil', 'water']) {
      const id = this.idFor(role);
      if (id) ids.push(id);
    }
    for (const owner of ['player', 'other'] as const) {
      const id = this.humId(owner, false);
      if (id) ids.push(id);
    }
    const staff = this.humId('player', true);
    if (staff) ids.push(staff);
    host.prepare(ids);
  }

  // ---- the blade ----

  /**
   * The blade renderer's own per-frame call: where the blade is, whether it is out, and how long
   * since the last frame. Everything a blade does to the ear goes through here -- the hum follows
   * it, the rain hisses off it, the water boils round it -- so nothing else has to know that a
   * blade makes any sound at all.
   */
  hum(blade: object, base?: SaberPoint, tip?: SaberPoint, dt = 0): void {
    const host = this.host;
    if (!host) return;
    const v = this.voices.get(blade);
    if (!v || !v.lit) return;
    // The one place that knows a blade is still being drawn. Anything that stops calling this
    // without putting the blade out is swept up by `tick`.
    v.heardAt = this.now;
    if (base && tip) {
      const x = (base.x + tip.x) / 2;
      const y = (base.y + tip.y) / 2;
      const z = (base.z + tip.z) / 2;
      // The tip's speed, which is all the swing the hum knows about: the blade renderer is told how
      // hard the body is swinging, but a fighter's blade is not, and the tip says it for both.
      if (dt > 0) {
        const moved = Math.hypot(tip.x - v.tx, tip.y - v.ty, tip.z - v.tz) / dt;
        // Eased rather than taken outright: a frame's jitter would make the hum flutter.
        v.speed += (moved - v.speed) * Math.min(1, dt * this.tune.humEase);
      }
      v.tx = tip.x;
      v.ty = tip.y;
      v.tz = tip.z;
      v.x = x;
      v.y = y;
      v.z = z;
      if (v.owner === 'player') {
        this.bladePoint.x = x;
        this.bladePoint.y = y;
        this.bladePoint.z = z;
        this.bladeSeen = this.now;
      }
    }
    this.ask(v);
    // The player's own blade is in the ear's own room. A blade in the hand that the world placed in
    // the open while the ear is inside a building would be heard through the muffle, which is the
    // one thing a hum in your own hand must never be.
    if (v.owner === 'player' && this.world) {
      const ear = this.world.listenerSpace;
      v.space.building = ear.building;
      v.space.cell = ear.cell;
    }
    if (v.underwater) {
      // Under water the blade boils instead of humming: the same sound the film gives it and the
      // one Jedi Academy plays.
      this.quiet(v, false);
      v.boil = this.keep(v.boil, this.idFor('boil'), v, 1);
      return;
    }
    if (v.boil) {
      host.stop(v.boil, this.tune.humFade);
      v.boil = 0;
    }
    // The menu's choice changed under a lit blade: the old hum is let go here and the new one comes
    // in on the next frame, so the setting can be tried without putting the blade away.
    const want = this.humId(v.owner, v.staff) ?? '';
    if (want !== v.humId) {
      if (v.hum) {
        host.stop(v.hum, this.tune.humFade);
        v.hum = 0;
      }
      v.humId = want;
    }
    const gain = 1 + this.tune.humSwing * Math.min(1, v.speed / Math.max(0.1, this.tune.humSwingAt));
    v.hum = this.keep(v.hum, v.humId, v, gain);
    if (v.raining) this.fizz(v);
  }

  /** A loop kept where it should be: started if it is not playing, moved and levelled if it is. */
  private keep(key: number, id: string | null, v: BladeVoice, gain: number): number {
    const host = this.host;
    if (!host || !id) return key;
    if (key && host.isPlaying(key)) {
      host.move(key, v.x, v.y, v.z);
      host.setGain(key, gain);
      return key;
    }
    const now = this.now;
    // A hum the mixer would not start (the pack is still coming, or simulated seconds are being
    // stepped) waits a moment rather than asking again on every frame: the mixer writes down every
    // refusal, and a blade held out for a minute would fill its report by itself.
    if (host.advancing || now < v.retryAt) return 0;
    const made = host.play(id, { x: v.x, y: v.y, z: v.z, space: v.space, loop: true, gain });
    if (made) this.counts.hums++;
    else {
      this.counts.refused++;
      v.retryAt = now + this.tune.humRetry;
    }
    return made;
  }

  /**
   * A blade lit or put out. The renderer calls it on the frame the blade's state changes, for the
   * player's blades and everyone else's alike.
   */
  ignite(blade: object, on: boolean, at?: SaberPoint, opts: { owner?: 'player' | 'other'; staff?: boolean; quiet?: boolean } = {}): void {
    const host = this.host;
    if (!host) return;
    this.expose();
    this.useBank();
    this.prepareSet();
    let v = this.voices.get(blade);
    if (!v) {
      if (!on) return;
      v = {
        hum: 0,
        humId: '',
        boil: 0,
        lit: false,
        x: at?.x ?? 0,
        y: at?.y ?? 0,
        z: at?.z ?? 0,
        tx: at?.x ?? 0,
        ty: at?.y ?? 0,
        tz: at?.z ?? 0,
        speed: 0,
        owner: opts.owner ?? this.ownerOf(blade),
        staff: !!opts.staff,
        space: { building: NO_SPACE.building, cell: NO_SPACE.cell },
        raining: false,
        underwater: false,
        askedAt: -1e9,
        toldAt: -1e9,
        fizzAt: 0,
        retryAt: 0,
        heardAt: this.now,
      };
      this.voices.set(blade, v);
    }
    v.heardAt = this.now;
    if (at) {
      v.x = at.x;
      v.y = at.y;
      v.z = at.z;
      v.tx = at.x;
      v.ty = at.y;
      v.tz = at.z;
    }
    // Whose blade it is is decided again at every ignition, not once at the first: which blades are
    // the player's is handed over by the kit, and a blade first lit on a frame the kit had not run
    // on would otherwise be somebody else's for the rest of its life -- the wrong hum, and every
    // swing of the player's dropped for want of a blade that counted as out.
    v.owner = opts.owner ?? this.ownerOf(blade);
    if (opts.staff !== undefined) v.staff = opts.staff;
    if (v.lit === on) return;
    v.lit = on;
    v.humId = this.humId(v.owner, v.staff) ?? '';
    if (on) {
      v.speed = 0;
      // A blade that was already out when the world came back (a travel, a reload) should not bang
      // its ignition out again: `quiet` is what the renderer passes when it snapped the blade on.
      if (!opts.quiet) this.once('on', v.x, v.y, v.z, v.space, 'ignite');
      this.counts.ignitions++;
    } else {
      this.quiet(v, true);
      if (!opts.quiet) this.once('off', v.x, v.y, v.z, v.space, 'shut off');
      this.counts.ignitions++;
    }
  }

  /** Everything a blade is playing let go (it went out, or it is gone). */
  private quiet(v: BladeVoice, boil: boolean): void {
    const host = this.host;
    if (!host) return;
    if (v.hum) {
      host.stop(v.hum, this.tune.humFade);
      v.hum = 0;
    }
    if (boil && v.boil) {
      host.stop(v.boil, this.tune.humFade);
      v.boil = 0;
    }
  }

  /**
   * A sweep, from the one call the game makes every frame whatever else is happening (the blade
   * renderer's own `update`, which the player's blades run through on every drawn frame).
   *
   * A blade is heard because its renderer keeps drawing it, and a renderer can stop being called
   * while the blade is still lit: a mobile culled as it walks behind the camera stops drawing its
   * blade, and so does one that dies off screen, before anything has said the blade went out. The
   * hum would then hang in the air at the last place it was drawn for as long as that mobile lived.
   * Anything not drawn for `lost` seconds therefore has its hum let go here, with the voice left
   * lit, so the blade coming back into view simply starts humming again on its next drawn frame.
   */
  tick(): void {
    const host = this.host;
    if (!host) return;
    const now = this.now;
    if (now - this.sweptAt < this.tune.lost / 2) return;
    this.sweptAt = now;
    // The report is hung here as well as on the first sound: the lead must be able to ask what the
    // blades are doing before any of them has made a noise.
    this.expose();
    for (const v of this.voices.values()) {
      if (!v.hum && !v.boil) continue;
      if (now - v.heardAt <= this.tune.lost) continue;
      this.quiet(v, true);
      this.counts.lost++;
    }
  }

  /** A blade disposed of: its hum goes with it. */
  forget(blade: object): void {
    const v = this.voices.get(blade);
    if (!v) return;
    this.quiet(v, true);
    this.voices.delete(blade);
  }

  /**
   * What the weather is doing to a blade, when the game would rather say than have it asked. With
   * nothing said, a lit blade asks the world itself a few times a second (`ask` below).
   */
  weather(blade: object, raining: boolean, underwater: boolean): void {
    const v = this.voices.get(blade);
    if (!v) return;
    v.raining = raining;
    v.underwater = underwater;
    // Told outright, the blade does not ask the world for itself for a second: a caller that says
    // so every frame is the one that decides, and one that said it once and stopped lapses back to
    // the world rather than holding a blade in rain that stopped an hour ago.
    v.toldAt = this.now;
  }

  /** The world asked about one blade, a few times a second rather than every frame. */
  private ask(v: BladeVoice): void {
    const world = this.world;
    const now = this.now;
    if (!world || now - v.toldAt < this.tune.told || now - v.askedAt < 1 / Math.max(1, this.tune.weatherRate)) return;
    v.askedAt = now;
    // Rain over the blade: it must be raining, and nothing overhead. The roof grid already knows
    // what stands over every point near the player, which is what the rain itself is clipped by.
    const rain = world.weather.fx.rain;
    v.raining = rain > 0 && world.weather.roofs.topAt(v.x, v.z) < v.y;
    const wet = world.footSurfaces.waterTop(v.x, v.z) > v.y;
    // The blade going into the water is a blow like any other, and is the moment that role sounds:
    // under the water it boils instead, which is the hum's business below.
    if (wet && !v.underwater) this.contact('water', v);
    v.underwater = wet;
    if (v.owner !== 'player') {
      const space = world.footSurfaces.space(v.x, v.y, v.z);
      v.space.building = space?.building ?? NO_SPACE.building;
      v.space.cell = space?.cell ?? NO_SPACE.cell;
    }
  }

  /** A drop of rain hissing off a lit blade, now and then while it is out in the open. */
  private fizz(v: BladeVoice): void {
    const now = this.now;
    if (now < v.fizzAt) return;
    const gap = this.tune.fizzGap;
    if (v.fizzAt > 0) {
      this.once('fizz', v.x, v.y, v.z, v.space, 'rain');
      this.counts.fizzes++;
    }
    v.fizzAt = now + gap[0] + Math.random() * Math.max(0, gap[1] - gap[0]);
  }

  // ---- swings ----

  /**
   * A move has begun. A move whose clip Jedi Academy marked (its specials, katas, back attacks,
   * spins and the kicks) sounds at the marks' own times, scheduled on the audio clock; every other
   * move -- which is every ordinary attack of every style -- whooshes once as it starts, from its
   * style's group of three. The clip is asked first, so the two can never both happen.
   *
   * `at` is where it is heard; with none, the player's own blade. `seconds` is how long the move
   * really lasts, speed and all, which only the mover knows: without it a marked clip is treated as
   * an unmarked one and whooshes once, since a mark at a fraction of nothing has no time to be at.
   */
  swing(style: string, at: SaberPoint | null, clip?: string, seconds?: number): void {
    const host = this.host;
    if (!host) return;
    this.expose();
    this.useBank();
    this.prepareSet();
    // The move machine runs for every melee weapon, not only for a blade: a sword or a polearm
    // swings through the same moves and must not whoosh like a lightsaber. The player's own swing
    // is therefore heard only while a blade of the player's was drawn a moment ago, which is what a
    // lit saber means; a swing handed a place of its own (a fighter's) is its caller's to judge.
    if (!at && !this.bladeFresh()) {
      this.counts.noSound++;
      return;
    }
    const p = at ?? this.playerPoint();
    const x = p?.x;
    const y = p?.y;
    const z = p?.z;
    const space = at ? this.spaceAt(x, y, z) : this.playerSpace();
    const length = seconds ?? 0;
    const marks = clip && length > 0 ? this.marksOf(clip) : null;
    if (marks) {
      this.counts.marked++;
      this.schedule(marks, length, x, y, z, space);
      return;
    }
    const now = this.now;
    // Two swings of a chain can begin within a frame of each other; one whoosh is a swing. Two
    // fighters swinging at the same moment in different places are two whooshes.
    if (this.tooSoon(this.lastSwingAt, this.lastSwingWhere, now, this.tune.swingGap, x, y, z)) return;
    this.lastSwingAt = now;
    this.remember(this.lastSwingWhere, x, y, z);
    this.counts.swings++;
    this.once(SWING_ROLE[swingGroup(style)], x, y, z, space, 'swing');
  }

  /** The clip's own sound marks, or null when it carries none. */
  private marksOf(clip: string): readonly { f: number; sound?: string; range?: [number, number] }[] | null {
    const index = this.clips;
    if (!index) return null;
    const list = index.eventsFor(clip, 'whole', null);
    if (!list) return null;
    for (let i = 0; i < list.length; i++) if (list[i].kind === 'sound' && list[i].sound) return list;
    return null;
  }

  /**
   * The move's marks laid out on the audio clock. Nothing waits on a timer: each whoosh is handed
   * to the mixer with the time it is to start at, which Web Audio honours to the sample, so a kata
   * keeps its rhythm whatever the frame rate does.
   */
  private schedule(marks: readonly { f: number; sound?: string; range?: [number, number] }[], seconds: number, x?: number, y?: number, z?: number, space?: SoundSpace): void {
    const host = this.host!;
    const now = this.now;
    let made = 0;
    for (let i = 0; i < marks.length && made < this.tune.maxMarks; i++) {
      const m = marks[i];
      if (!m.sound) continue;
      const id = this.patternId(m.sound, m.range);
      if (!id) {
        this.counts.noSound++;
        continue;
      }
      const startAt = now + m.f * seconds;
      const key = host.play(id, { x, y, z, space, at: startAt });
      if (key) {
        this.scheduled.push(key);
        this.scheduledAt.push(startAt);
        made++;
        this.counts.marks++;
      } else this.counts.refused++;
    }
    // The list is only as long as the moves that are still to sound; anything already played is let
    // go here rather than walked for ever.
    this.sweepScheduled();
    this.note(`marked swing (${made})`, null, 0);
  }

  /**
   * Whatever a move laid out and has not sounded yet, dropped: the saber was put away, thrown or
   * lost, or another move began over the top of it. A whoosh that has already started is left to
   * finish -- cutting it would be a click in the middle of the one sound the swing did make.
   */
  cancel(): void {
    const host = this.host;
    if (!host) return;
    const now = this.now;
    let n = 0;
    for (let i = 0; i < this.scheduled.length; i++) {
      const key = this.scheduled[i];
      if (this.scheduledAt[i] > now) {
        if (host.isPlaying(key)) host.stop(key, 0);
        continue;
      }
      // Still to finish: keep it, so the sweep can let it go when it does.
      if (!host.isPlaying(key)) continue;
      this.scheduled[n] = key;
      this.scheduledAt[n] = this.scheduledAt[i];
      n++;
    }
    this.scheduled.length = n;
    this.scheduledAt.length = n;
  }

  private sweepScheduled(): void {
    const host = this.host!;
    let n = 0;
    for (let i = 0; i < this.scheduled.length; i++) {
      if (!host.isPlaying(this.scheduled[i])) continue;
      this.scheduled[n] = this.scheduled[i];
      this.scheduledAt[n] = this.scheduledAt[i];
      n++;
    }
    this.scheduled.length = n;
    this.scheduledAt.length = n;
  }

  /**
   * One of Jedi Academy's own names turned into something the mixer can play. A name with `%d` and
   * a range is one template with that range's files as its samples, which is how the game's own
   * multi-sample templates work and what Jedi Academy did with the range too. Made once per name
   * and range and then kept.
   */
  private patternId(pattern: string, range?: [number, number]): string | null {
    const lo = range?.[0] ?? 0;
    const hi = range?.[1] ?? 0;
    const id = range ? `jka:${pattern}:${lo}-${hi}` : `jka:${pattern}`;
    if (this.made.has(id)) return id;
    // In the game's own set the whooshes are the game's; everything else Jedi Academy's animations
    // name (a kick's punch, a body hitting the ground, a spin) has no counterpart and stays its own.
    if (this.set === 'swg' && /saberhup/.test(pattern)) {
      const swing = this.idFor(`swing${range && range[0] >= 7 ? 'Strong' : range && range[0] >= 4 ? 'Medium' : 'Fast'}`);
      if (swing) return swing;
    }
    const files = this.pack?.files;
    if (!files) return null;
    const have = (path: string): string | null => {
      if (files[path] !== undefined) return path;
      const other = path.endsWith('.wav') ? `${path.slice(0, -4)}.mp3` : path.endsWith('.mp3') ? `${path.slice(0, -4)}.wav` : null;
      return other && files[other] !== undefined ? other : null;
    };
    const samples = this.samplesOf(pattern, range, have);
    if (!samples.length) return null;
    this.made.set(id, this.template(samples, /saberhup|swing|punch/.test(pattern) ? 8 : 12));
    return id;
  }

  // ---- contact ----

  /**
   * A blade met something: a bolt it turned away, another blade, a body, a wall, water, or its own
   * flight ending back in the hand. One sound each, with a least gap between two of a kind so that
   * a blade dragged along a wall hisses rather than rattles.
   */
  contact(kind: SaberContact, at?: SaberPoint): void {
    const host = this.host;
    if (!host) return;
    this.expose();
    this.useBank();
    this.prepareSet();
    const now = this.now;
    const p = at ?? this.playerPoint();
    // The gap is kept per kind and per place: a blade dragged along a wall hisses once rather than
    // on every frame of the stroke, while a swing that reaches a body and the wall behind it is
    // heard doing both, and two fighters trading blows across a room never swallow each other's.
    if (this.tooSoon(this.lastContactAt[kind], this.lastContactWhere[kind], now, this.tune.contactGap, p?.x, p?.y, p?.z)) return;
    this.lastContactAt[kind] = now;
    this.remember(this.lastContactWhere[kind], p?.x, p?.y, p?.z);
    const space = at ? this.spaceAt(p?.x, p?.y, p?.z) : this.playerSpace();
    this.counts.contacts++;
    this.once(kind, p?.x, p?.y, p?.z, space, kind);
  }

  /**
   * Whether a sound of this kind has just been made in the same place. With no place at all (the
   * world has not said where the player is) the gap alone decides, as it did before.
   */
  private tooSoon(at: number, where: SaberPoint, now: number, gap: number, x?: number, y?: number, z?: number): boolean {
    if (now - at >= gap) return false;
    if (x === undefined || y === undefined || z === undefined) return true;
    const near = this.tune.contactNear;
    return Math.abs(where.x - x) < near && Math.abs(where.y - y) < near && Math.abs(where.z - z) < near;
  }

  private remember(where: SaberPoint, x?: number, y?: number, z?: number): void {
    where.x = x ?? 0;
    where.y = y ?? 0;
    where.z = z ?? 0;
  }

  // ---- the powers ----

  /**
   * A Force power. `phase` is 'once' for a power that fires and is done, 'start' and 'end' for one
   * that lasts: the loop between them follows the player. Which of the game's `pl_force_*` sets a
   * power uses is ours and is written beside the powers themselves.
   */
  power(def: PowerLike | null | undefined, phase: 'once' | 'start' | 'end', at?: SaberPoint): void {
    const host = this.host;
    if (!host || !def?.sound) return;
    this.expose();
    const s = def.sound;
    // A power comes from the body, not from the blade: the blade is where a blow lands, and a power
    // used with the saber lit would otherwise sound from the tip of it.
    const p = at ?? this.powerPoint();
    const space = this.playerSpace();
    if (phase === 'end') {
      const live = this.powers.get(def.id);
      if (live) {
        host.stop(live.key, this.tune.powerFade);
        this.powers.delete(def.id);
      }
      if (s.end) this.play(s.end, p?.x, p?.y, p?.z, space, `${def.id} end`);
      return;
    }
    const one = phase === 'once' ? (s.once ?? s.start) : (s.start ?? s.once);
    if (one) this.play(one, p?.x, p?.y, p?.z, space, `${def.id} ${phase}`);
    this.counts.powers++;
    if (phase !== 'start' || !s.loop) return;
    const live = this.powers.get(def.id);
    if (live && host.isPlaying(live.key)) return;
    // The record is kept whether or not a voice was had: a power whose loop the mixer refused (no
    // free voice, or simulated seconds being stepped) must not ask for its opening sound again on
    // every frame it is held for.
    const key = host.advancing ? 0 : host.play(s.loop, { x: p?.x, y: p?.y, z: p?.z, space, loop: true });
    this.powers.set(def.id, { key, id: s.loop });
  }

  /** A power's loop kept on the player while it lasts. Called each frame by the kit that holds it. */
  holdPower(def: PowerLike | null | undefined, on: boolean): void {
    const host = this.host;
    if (!host || !def?.sound?.loop) return;
    const live = this.powers.get(def.id);
    if (!on) {
      if (live) this.power(def, 'end');
      return;
    }
    if (!live) {
      this.power(def, 'start');
      return;
    }
    const p = this.powerPoint();
    if (p && live.key) host.move(live.key, p.x, p.y, p.z);
  }

  /** Every power's loop let go: the class changed, the player died, the world went. */
  stopPowers(): void {
    const host = this.host;
    if (!host) return;
    for (const live of this.powers.values()) host.stop(live.key, this.tune.powerFade);
    this.powers.clear();
  }

  /** Everything this file holds let go. A world unload, a travel, the select screen. */
  stopAll(): void {
    for (const blade of [...this.voices.keys()]) this.forget(blade);
    this.stopPowers();
    const host = this.host;
    // Here, unlike a move cut short, a whoosh already sounding goes too: the world it was in is on
    // its way out.
    if (host) for (const key of this.scheduled) if (host.isPlaying(key)) host.stop(key, 0);
    this.scheduled.length = 0;
    this.scheduledAt.length = 0;
  }

  // ---- where the player is ----

  /**
   * Where the player's own sounds are heard, and which of the blades in the world are the player's.
   * Handed over by the kit each frame: it costs an identity check, and without it a swing the move
   * machine starts would have nowhere to be.
   */
  follow(at: SaberPoint | null, blades?: readonly object[] | null): void {
    this.playerAt = at;
    if (blades !== undefined) this.playerBlades = blades;
  }

  /**
   * Where the player's own sounds happen: the blade the renderer drew a moment ago, or the body
   * itself when no blade is out. Aboard a ship the body's place is in the hull's frame and would
   * put every sound the player makes somewhere out in the zone, so the drawn blade wins whenever
   * there is one.
   */
  private playerPoint(): SaberPoint | null {
    if (this.bladeFresh()) return this.bladePoint;
    return this.playerAt;
  }

  /**
   * Where the player's own body is: what the kit hands over, which is the figure in world space
   * even aboard a ship, and the drawn blade only when there is no body to be had. A power belongs
   * to the body; a blow belongs to the blade (`playerPoint` above).
   */
  private powerPoint(): SaberPoint | null {
    return this.playerAt ?? (this.bladeFresh() ? this.bladePoint : null);
  }

  /**
   * Whether a blade of the player's was drawn within the last quarter second, which is the one
   * thing that says a lightsaber is out: the renderer draws a lit blade every frame.
   */
  private bladeFresh(): boolean {
    return this.now - this.bladeSeen < this.tune.bladeFresh;
  }

  private ownerOf(blade: object): 'player' | 'other' {
    const own = this.playerBlades;
    if (!own) return 'other';
    for (let i = 0; i < own.length; i++) if (own[i] === blade) return 'player';
    return 'other';
  }

  /** The room the ear is in, which is the room the player's own blade and powers are in. */
  private playerSpace(): SoundSpace | undefined {
    return this.world?.listenerSpace;
  }

  /** The room a point is in, for anything that is not the player's own. */
  private spaceAt(x?: number, y?: number, z?: number): SoundSpace | undefined {
    if (x === undefined || y === undefined || z === undefined) return this.playerSpace();
    return this.world?.footSurfaces.space(x, y, z) ?? undefined;
  }

  // ---- the plumbing ----

  private get now(): number {
    return this.host?.now ?? 0;
  }

  /** One of the set's roles, once. */
  private once(role: string, x?: number, y?: number, z?: number, space?: SoundSpace, what = role): void {
    const id = this.idFor(role);
    if (!id) {
      this.counts.noSound++;
      this.note(what, null, 0);
      return;
    }
    this.play(id, x, y, z, space, what);
  }

  private play(id: string, x?: number, y?: number, z?: number, space?: SoundSpace, what = id): number {
    const host = this.host;
    if (!host) return 0;
    const key = host.play(id, { x, y, z, space });
    if (!key) this.counts.refused++;
    this.note(what, id, key);
    return key;
  }

  private note(what: string, sound: string | null, key: number): void {
    this.log.push({ at: Math.round(this.now * 100) / 100, what, sound, key });
    if (this.log.length > LOG_KEPT) this.log.splice(0, this.log.length - LOG_KEPT);
  }

  /**
   * The console report. It is hung on the game's own `__debug` lazily rather than by the game,
   * because the game builds that object once at startup and would replace anything put there
   * before it: the check is an identity test on an event, never on a frame.
   */
  private expose(): void {
    if (typeof window === 'undefined') return;
    const dbg = (window as unknown as { __debug?: Record<string, unknown> }).__debug;
    if (!dbg || dbg === this.exposedOn) return;
    this.exposedOn = dbg;
    dbg.sabers = (opts: Record<string, unknown> = {}) => {
      for (const [k, v] of Object.entries(opts)) if (k in this.tune) (this.tune as unknown as Record<string, unknown>)[k] = v;
      return this.status();
    };
  }

  /** What a tab that can hear nothing reads instead. */
  status(): Record<string, unknown> {
    const now = this.now;
    const blades: Record<string, unknown>[] = [];
    for (const v of this.voices.values()) {
      blades.push({
        owner: v.owner,
        lit: v.lit,
        // How long since the renderer last drew it: past `tune.lost` its hum has been let go and
        // will come back of itself when the blade is drawn again.
        undrawn: Math.round((now - v.heardAt) * 100) / 100,
        hum: v.humId,
        key: v.hum,
        boiling: v.boil !== 0,
        raining: v.raining,
        underwater: v.underwater,
        tipSpeed: Math.round(v.speed * 10) / 10,
        at: [Math.round(v.x * 10) / 10, Math.round(v.y * 10) / 10, Math.round(v.z * 10) / 10],
        space: v.space.building,
      });
    }
    const roles: Record<string, string | null> = {};
    for (const role of ['on', 'off', 'swingFast', 'swingMedium', 'swingStrong', 'block', 'clash', 'body', 'wall', 'bounce', 'catch', 'fizz', 'boil', 'water']) roles[role] = this.idFor(role);
    return {
      attached: !!this.host,
      set: this.set,
      chosen: liveSettings().soundSabers,
      pack: this.packState,
      jkaTemplates: this.made.size,
      bankKnowsJka: !!this.patchedBank,
      clips: this.clips ? 'yes' : 'no clip events, so every swing whooshes once',
      world: !!this.world,
      roles,
      hums: { player: this.humId('player', false), staff: this.humId('player', true), other: this.humId('other', false) },
      blades,
      powers: [...this.powers.entries()].map(([id, p]) => ({ id, sound: p.id, key: p.key })),
      scheduled: this.scheduled.length,
      counts: { ...this.counts },
      tune: { ...this.tune },
      recent: this.log.slice(-10),
    };
  }
}

/**
 * The one of these the game has. The blade renderer, the move machine, the parries, the marks, the
 * thrown saber and the Jedi kit all speak to it by name; the game hands it the mixer once.
 */
export const sabers = new SaberSounds();

/** Called once by the game, with the mixer, the clip events and the world all built. */
export function attachSaberSounds(host: SaberHost | null, opts: { clips?: ClipEventIndex | null; world?: SaberWorld | null; baseUrl?: string } = {}): void {
  sabers.attach(host, opts);
}
