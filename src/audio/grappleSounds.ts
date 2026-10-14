/**
 * The grappling hook, heard (the design's §3.13): a launcher's clank as it fires, three clicks as it bites, a
 * ratchet as the held reel winds in or pays out, a rumble while F hauls, a whoosh as the boost lets go, a body
 * falling against a wall in a slam, and the wind at speed (off until the owner has heard it). Every one is picked
 * from the game's bank by its name and its measured shape; nobody has listened to any of them yet.
 *
 * The rules of the house this keeps:
 *  - **The hook counts, this plays.** The hook (`grapple.ts`) only counts what it did -- a fire, a bite, a ratchet
 *    due, a boost, a slam -- and this plays one sound for each count that moved since the last frame, one for one.
 *    Nothing else in the game plays the ratchet, so how often it sounds is the hook's own capped count and no more:
 *    the held reel at most `tickMax` a second, the dart's flight and the haul never (the mixer has 40 positional
 *    slots, and a play per half metre of any rope moving would have taken all of them).
 *  - **Nothing waits on a fetch.** Every id is asked for behind the loading screen (`renew` at each arrival, then
 *    once the bank is in), and a one-shot whose buffer is late is the mixer's to drop, as every one-shot's is.
 *  - **Nothing is made a frame** with nothing to play: the counters are compared, the loops' wanted states are two
 *    booleans, and the place handed over is one kept record. The game calls `step` every frame, the select screen
 *    included, for a player who may never fire, so it is handed the body's velocity as the record it is (a speed
 *    worked out by the caller was a fresh number handed across a call every frame, 16 bytes) and reads the speed only
 *    while the wind is wanted; and whether Jedi Academy's whoosh is there is asked once for each pack the sabers adopt,
 *    never every frame (a pack without it built a name to look up on every frame for the life of the session).
 *  - **Nothing can be heard from a driven tab**, so what was asked for is kept (`log`) with what became of it, and
 *    the ratchets of the last second are counted (`__debug.grapple().sounds`).
 */
import type { SoundSpace } from './distance.ts';
import type { SoundTemplate } from './template.ts';
import { GRAPPLE_TUNE } from '../player/grapple.ts';
import { len3, windGainFor } from '../player/grappleMath.ts';

/** Which of the bank's templates fills each role. The boost is a template of ours over Jedi Academy's melee whooshes. */
export const GRAPPLE_SOUND = {
  /** 3D, a launcher's clank, 0.9 s: at the left hand. */
  fire: 'sound/item_maggrapple.snd',
  /** Three short clicks: at the hand and not the anchor, which may be 100 m off and out of earshot. */
  bite: 'sound/item_magnets.snd',
  /** 3D, a 0.229 s ratchet: the held reel only, pitched up reeling in and down paying out. */
  ratchet: 'sound/item_ratchet.snd',
  /** 2D, a 3.9 s rumble: looped while F hauls, faded out over `haulFade` as it is let go. */
  haul: 'sound/pt_sfx_grapple.snd',
  /** A body falling: at the slam's contact. */
  slam: 'sound/pl_all_bodyfall.snd',
  /** The speed wind, looped while the body flies fast on or off the rope; `windGain` 0 keeps it off. */
  wind: 'sound/wtr_gusting_windstrm_hvy_lp.snd',
  /** The boost's whoosh, made of Jedi Academy's melee whooshes where they were converted. */
  boost: 'grapple:boost',
  /** The game's own unarmed swing, the boost's stand-in with no Jedi Academy pack. */
  boostGame: 'sound/pl_swing_unarmed.snd',
} as const;

/** Every id the hook may ask for: what an arrival asks the bank for behind its loading screen. */
export const GRAPPLE_SOUND_IDS: readonly string[] = [GRAPPLE_SOUND.fire, GRAPPLE_SOUND.bite, GRAPPLE_SOUND.ratchet, GRAPPLE_SOUND.haul, GRAPPLE_SOUND.slam, GRAPPLE_SOUND.wind, GRAPPLE_SOUND.boost, GRAPPLE_SOUND.boostGame];

/** Jedi Academy's own melee whooshes, the ones its fists' animations name (`sound/weapons/melee/swing%d.wav`, 1 to 4). */
const JKA_WHOOSHES = ['sound/weapons/melee/swing1.wav', 'sound/weapons/melee/swing2.wav', 'sound/weapons/melee/swing3.wav', 'sound/weapons/melee/swing4.wav'];

/**
 * The settings the boost's template carries when the game's own unarmed swing cannot be read for them: its own
 * (category 7, priority 3, full to 12 m), so the boost is heard as far as a punch is.
 */
const WHOOSH_SETTINGS = { category: 7, priority: 3, full: 12 };

/** The mixer as this needs it; the game's `AudioSystem` satisfies it as it stands. */
export interface GrappleSoundHost {
  readonly bank: { available: boolean; template(id: string): unknown; offer(id: string, template: SoundTemplate): void };
  play(id: string, options?: { x?: number; y?: number; z?: number; space?: SoundSpace; gain?: number; pitch?: number }): number;
  loop(id: string, options?: { x?: number; y?: number; z?: number; space?: SoundSpace; gain?: number; pitch?: number }): number;
  stop(key: number, fade?: number): void;
  setGain(key: number, gain: number): void;
  isPlaying(key: number): boolean;
  prepare(ids: Iterable<string>): void;
}

/** Jedi Academy's files as the sabers know them; the game's `SaberSounds` satisfies it. */
export interface GrappleJkaSource {
  /** Jedi Academy's own file for a path in its archives, or null (the `.wav`/`.mp3` fall-back included). */
  jkaFile(path: string): string | null;
  /** What those files are read from: another object only when another pack is adopted, null before one is. */
  readonly jkaFiles: object | null;
}

/** What of the hook the sounds read; the game's `Grapple` satisfies it. */
export interface GrappleSoundSource {
  readonly counts: { readonly fires: number; readonly bites: number; readonly ratchets: number; readonly boosts: number; readonly slams: number };
  readonly ratchetIn: boolean;
  readonly attached: boolean;
  readonly out: boolean;
  readonly released: boolean;
  readonly keys: { readonly haul: boolean };
  readonly lastSlam: { readonly x: number; readonly y: number; readonly z: number };
  readonly clock: number;
}

/** How many of the last requests are kept for the console. */
const LOG_KEPT = 16;

export class GrappleSounds {
  private host: GrappleSoundHost | null = null;
  /** Jedi Academy's files (the sabers' pack says which are there), or null with none to ask. */
  private jka: GrappleJkaSource | null = null;
  private prepared = false;
  private boostMade = false;
  /** The pack the boost was last decided for: it is decided once a pack, never asked again of the same one. */
  private boostFor: object | null = null;
  /** The hook's counts as last played, so each that moved plays one sound for each step it moved. */
  private readonly seen = { fires: 0, bites: 0, ratchets: 0, boosts: 0, slams: 0 };
  private haulKey = 0;
  private hauling = false;
  private windKey = 0;
  private winding = false;
  /** The place and the space every play is handed, written in place. */
  private readonly opts: { x: number; y: number; z: number; space: SoundSpace | undefined; pitch: number; gain: number } = { x: 0, y: 0, z: 0, space: undefined, pitch: 0, gain: 1 };
  /** The last requests, with the mixer's key (0: nothing started, which a driven tab always answers). */
  readonly log: { what: string; id: string; key: number; at: number }[] = [];
  /** The hook's clock at the last ratchets, so the console can say how many fell in the last second. */
  private readonly ratchetTimes = new Float64Array(32).fill(Number.NEGATIVE_INFINITY);
  private ratchetNext = 0;
  readonly counts = { asked: 0, started: 0 };

  /** The mixer, and how to find Jedi Academy's files; called once by the game. */
  attach(host: GrappleSoundHost | null, jka: GrappleJkaSource | null): void {
    this.host = host;
    this.jka = jka;
    this.prepared = false;
    this.boostFor = null;
  }

  /** An arrival: everything is asked for again behind its loading screen, since the bank may have let some go. */
  renew(): void {
    this.prepared = false;
  }

  /**
   * One frame: whatever the hook counted since the last one, played where it happened (`hand` the rope point, the
   * slam at its contact), in the ear's own room (`space`, the player's own sounds are never muffled by the walls
   * round them); the haul's loop up while F hauls and `live` (the frame is simulated); the wind with the speed of
   * `vel`, the body's own velocity record, read only while the wind is wanted.
   */
  step(g: GrappleSoundSource, hand: { x: number; y: number; z: number }, vel: { readonly x: number; readonly y: number; readonly z: number }, space: SoundSpace, live: boolean): void {
    const host = this.host;
    const c = g.counts;
    const s = this.seen;
    if (!host) {
      s.fires = c.fires;
      s.bites = c.bites;
      s.ratchets = c.ratchets;
      s.boosts = c.boosts;
      s.slams = c.slams;
      return;
    }
    this.ready(host);
    const o = this.opts;
    o.space = space;
    o.pitch = 0;
    o.gain = 1;
    o.x = hand.x;
    o.y = hand.y;
    o.z = hand.z;
    while (s.fires < c.fires) {
      s.fires++;
      this.once(host, 'fire', GRAPPLE_SOUND.fire, g.clock);
    }
    while (s.bites < c.bites) {
      s.bites++;
      this.once(host, 'bite', GRAPPLE_SOUND.bite, g.clock);
    }
    if (s.ratchets < c.ratchets) {
      o.pitch = g.ratchetIn ? GRAPPLE_TUNE.reelPitch : -GRAPPLE_TUNE.reelPitch;
      while (s.ratchets < c.ratchets) {
        s.ratchets++;
        this.once(host, 'ratchet', GRAPPLE_SOUND.ratchet, g.clock);
        this.ratchetTimes[this.ratchetNext] = g.clock;
        this.ratchetNext = (this.ratchetNext + 1) % this.ratchetTimes.length;
      }
      o.pitch = 0;
    }
    while (s.boosts < c.boosts) {
      s.boosts++;
      this.once(host, 'boost', this.boostMade ? GRAPPLE_SOUND.boost : GRAPPLE_SOUND.boostGame, g.clock);
    }
    if (s.slams < c.slams) {
      o.x = g.lastSlam.x;
      o.y = g.lastSlam.y;
      o.z = g.lastSlam.z;
      while (s.slams < c.slams) {
        s.slams++;
        this.once(host, 'slam', GRAPPLE_SOUND.slam, g.clock);
      }
    }
    // The haul's rumble, started once as F starts hauling and faded as it stops. A loop a driven tab is refused is
    // not asked for again every frame: what is wanted is a state, kept apart from whether the mixer has a voice for it.
    const haul = live && g.attached && g.keys.haul;
    if (haul !== this.hauling) {
      this.hauling = haul;
      if (haul) this.haulKey = this.loopOf(host, 'haul', GRAPPLE_SOUND.haul, g.clock, 1);
      else if (this.haulKey) {
        host.stop(this.haulKey, GRAPPLE_TUNE.haulFade);
        this.haulKey = 0;
      }
    }
    // The wind: off at `windGain` 0, which is how it ships, and then no speed is worked out at all.
    const gain = live && (g.out || g.released) && GRAPPLE_TUNE.windGain > 0 ? windGainFor(len3(vel.x, vel.y, vel.z), GRAPPLE_TUNE) : 0;
    const wind = gain > 0;
    if (wind !== this.winding) {
      this.winding = wind;
      if (wind) this.windKey = this.loopOf(host, 'wind', GRAPPLE_SOUND.wind, g.clock, gain);
      else if (this.windKey) {
        host.stop(this.windKey);
        this.windKey = 0;
      }
    } else if (wind && this.windKey) host.setGain(this.windKey, gain);
  }

  /** Everything let go: a travel or the select screen stops every voice, and these keys go with them. */
  forget(): void {
    this.haulKey = 0;
    this.hauling = false;
    this.windKey = 0;
    this.winding = false;
  }

  /** How many ratchets fell in the second up to the hook's clock `now`. */
  ratchetsLastSecond(now: number): number {
    let n = 0;
    for (let i = 0; i < this.ratchetTimes.length; i++) if (now - this.ratchetTimes[i] < 1 + 1e-9) n++;
    return n;
  }

  /** Whether each id is a template the bank can play now, and whether the boost is Jedi Academy's or the game's own. */
  status(): { prepared: boolean; boost: string; templates: Record<string, boolean> } {
    const host = this.host;
    const templates: Record<string, boolean> = {};
    for (const id of GRAPPLE_SOUND_IDS) templates[id] = !!host?.bank.template(id);
    return { prepared: this.prepared, boost: this.boostMade ? 'jka' : 'game', templates };
  }

  /** The boost's own template once Jedi Academy's pack is in, and every id asked for once the bank is. */
  private ready(host: GrappleSoundHost): void {
    if (!host.bank.available) return;
    // Decided once for each pack the sabers adopt (it may never come: then the game's own swing stands in), and never
    // asked again of the same pack: a pack without the whooshes would otherwise be asked, and a name built to ask it
    // with, on every frame of the session.
    const files = this.jka ? this.jka.jkaFiles : null;
    if (files !== this.boostFor) {
      this.boostFor = files;
      if (files) this.makeBoost(host);
    }
    if (this.prepared) return;
    this.prepared = true;
    host.prepare(GRAPPLE_SOUND_IDS);
  }

  /** The boost's own template over Jedi Academy's melee whooshes, where the pack just adopted has them. */
  private makeBoost(host: GrappleSoundHost): void {
    const jka = this.jka;
    if (!jka) return;
    const samples: string[] = [];
    for (const path of JKA_WHOOSHES) {
      const file = jka.jkaFile(path);
      if (file) samples.push(`../jka/${file}`);
    }
    if (!samples.length) return;
    const own = host.bank.template(GRAPPLE_SOUND.boostGame) as Partial<SoundTemplate> | null;
    host.bank.offer(GRAPPLE_SOUND.boost, {
      dim: 3,
      samples,
      category: own?.category ?? WHOOSH_SETTINGS.category,
      priority: own?.priority ?? WHOOSH_SETTINGS.priority,
      full: own?.full ?? WHOOSH_SETTINGS.full,
    });
    this.boostMade = true;
    // Asked for again, the boost with them.
    this.prepared = false;
  }

  private once(host: GrappleSoundHost, what: string, id: string, at: number): number {
    this.counts.asked++;
    const key = host.play(id, this.opts);
    if (key) this.counts.started++;
    this.note(what, id, key, at);
    return key;
  }

  private loopOf(host: GrappleSoundHost, what: string, id: string, at: number, gain: number): number {
    this.counts.asked++;
    const o = this.opts;
    o.gain = gain;
    const key = host.loop(id, o);
    o.gain = 1;
    if (key) this.counts.started++;
    this.note(what, id, key, at);
    return key;
  }

  private note(what: string, id: string, key: number, at: number): void {
    this.log.push({ what, id, key, at });
    if (this.log.length > LOG_KEPT) this.log.splice(0, this.log.length - LOG_KEPT);
  }
}

/** The one the game hangs on its mixer. */
export const grappleSounds = new GrappleSounds();
