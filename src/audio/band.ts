// The music players make, and the only music in this game.
//
// The owner's decision is that there is no world score at all: the only music is the sound of
// somebody playing an instrument. That turns out to be what the game itself shipped — its player
// music is **one track per instrument per song** (`player_music/song06_khorn_main_lp`), so a band is
// not a mix anybody has to make. Hold a kloo horn and you play the kloo horn's track; stand beside
// somebody holding a mandoviol and the two tracks are the two halves the game wrote.
//
// Three things about it are worth knowing.
//
// **The samples have no sound template of their own.** Like Jedi Academy's sabers, nothing in
// `player_music/` is a `.snd`, so a template is made here for each part at settings of ours and hung
// in front of the bank's own lookup, with the sample written `../music/samples/<file>` against the
// bank's samples folder. That is the same trick and the same one line as the saber set's.
//
// **A part either exists for your instrument or it does not.** Ten of the twenty songs carry all six
// stems and the rest carry fewer, so holding an instrument whose stem a song has no track for plays
// nothing at all rather than falling back on another instrument's part. That is the honest answer and
// it is what makes holding a particular instrument mean something.
//
// **Everybody's loop starts where the song is, not where they pressed.** A band is only a band if the
// parts line up, so a loop is started at the song's own offset in the shared wall clock rather than
// at nought — the same rule the weather and the nebulae's lightning are shared by, and it needs
// nothing sent between browsers.
//
// The rules below are pure; the mixer-facing half is at the bottom and touches nothing but the
// mixer's own `loop`, `play` and `stop`.

import type { SoundTemplate } from './template.ts';

/** One instrument's track of one song, as the pack carries it. */
export interface StemParts {
  intro: string | null;
  main: string;
  outro: string | null;
  flourishes: string[];
}

export interface MusicPack {
  version: number;
  counts: Record<string, number>;
  stems: string[];
  stemNames: Record<string, string>;
  /**
   * Which stem each instrument in the weapons pack plays: a stem outright, or a stem with the songs
   * the game's own table says it plays something else on (the xantha, and nothing else in retail).
   */
  instruments: Record<string, string | { stem: string; songs?: Record<number, string> }>;
  songs: { song: number; stems: Record<string, StemParts> }[];
}

/** Every number of the band that is ours. Live through `__debug.band`. */
export const BAND_TUNE = {
  /** How loud a player's own instrument is at the ear. */
  gain: 0.85,
  /** How loud a flourish is against the part under it. */
  flourish: 1,
  /** How far off another player's instrument can still be heard, metres. */
  reach: 45,
  /**
   * The radius within which an instrument is at its full volume, metres; past it the mixer's own
   * curve takes over and it is silent at `DISTANCE_TUNE.audible` times this (80 m as both stand).
   *
   * A template is made once and kept, so this is read when a part is first played and moving it
   * afterwards moves only the parts nobody has played yet.
   */
  full: 8,
  /**
   * How long a song's loop is taken to be, seconds, for lining two players up.
   *
   * It is not read off the file: a buffer's length is not known until it has been decoded, and two
   * browsers must agree before either has decoded anything. So the offset is taken modulo this, and
   * a song whose real loop is not a whole number of these drifts within one bar rather than being
   * in a different place for each player. It is what somebody joining another player's performance
   * part way through comes in on; a performance of your own starts at the top, because it starts
   * with its intro.
   */
  bar: 8,
  /**
   * How far ahead of a part's last moment the next one is handed to the mixer, seconds.
   *
   * The seam between two parts must be exact -- a music loop with a frame's gap in it is a stutter
   * once a bar -- and Web Audio honours a start time to the sample, so the next part is **scheduled**
   * at the moment this one ends rather than started when a frame notices. This is only how long
   * before that moment the frame loop has to have got round to it.
   */
  ahead: 0.25,
  /** How long a part is faded out when a performance is stopped part way through, seconds. */
  cut: 0.12,
};

export const MUSIC_PACK_VERSION = 1;

/**
 * Which body animation each instrument is played with: the rig's `music_N` branch.
 *
 * Every species rig already carries all 46 of these clips -- six loops and forty flourishes -- and
 * has since the rigs were first converted. What was missing was anything asking for one.
 *
 * The grouping is the **animation** grouping and is not the stem's: five poses cover the fourteen
 * instruments by how they are held, not by what they sound like, so a traz and a kloo horn share a
 * pose while playing different parts. Two independent sources give the same answer for the ten the
 * game let a player perform with -- the animation table names each branch's own file, and the
 * emulator's performance manager maps the same ten the same way -- so only the five marked here are
 * ours. **`music_6` is never used**: its branch points at the shrug, which is why it has no
 * flourishes at all.
 *
 * It is written here rather than in the pack because the clips need no conversion: an install that
 * has never rerun a converter still plays them.
 */
export const MUSIC_ANIM: Record<string, string> = {
  bandfill: 'music_1',
  bandfill_hue: 'music_1',
  nalargon: 'music_2',
  nalargon_hue: 'music_2',
  organ_max_rebo: 'music_2',
  instrument_organ_max_rebo: 'music_2',
  instrument_organ_figrin_dan: 'music_2',
  slitherhorn: 'music_3',
  slitherhorn_hue: 'music_3',
  fizz: 'music_3',
  fizz_hue: 'music_3',
  fanfar: 'music_3',
  fanfar_hue: 'music_3',
  kloo_horn: 'music_3',
  kloo_horn_hue: 'music_3',
  traz: 'music_3',
  traz_hue: 'music_3',
  flute_droopy: 'music_3',
  flute_droopy_hue: 'music_3',
  ommni_box: 'music_4',
  ommni_box_hue: 'music_4',
  mandoviol: 'music_5',
  mandoviol_hue: 'music_5',
  xantha: 'music_5',
  xantha_hue: 'music_5',
  // Ours: the table names no pose for these four, so each takes the one it is most like.
  valahorn: 'music_3',
  flanged_jessoon: 'music_3',
  downey_box: 'music_4',
};

/** The rig branch an instrument is played with, or null for one with no pose. */
export function animFor(instrumentId: string): string | null {
  return MUSIC_ANIM[instrumentId] ?? null;
}

/**
 * The instruments that stand on the ground rather than being carried.
 *
 * The nalargon is a great horned thing the height of a man, the ommni box and the downey box are
 * cabinets: the game stood all three on the floor and the player walked up to one. Everything else
 * in the list is held, which is why this is a list of three rather than a flag on the rest.
 *
 * They still come through the weapons pack and are still "held" as far as the backpack and the
 * hands are concerned -- that is what puts the model in the world at all. What changes is where the
 * model is while it is being played: on the ground in front of the player instead of in their hand.
 */
export const FLOOR_INSTRUMENTS = new Set([
  'nalargon',
  'nalargon_hue',
  // Max Rebo's organ is a nalargon, which is why it stands with them: the owner's "all of them".
  'organ_max_rebo',
  'instrument_organ_max_rebo',
  'ommni_box',
  'ommni_box_hue',
  'downey_box',
]);

/** Whether an instrument is one of the three that stand on the ground. */
export function standsOnGround(instrumentId: string | null): boolean {
  return !!instrumentId && FLOOR_INSTRUMENTS.has(instrumentId);
}

/** Where a floor instrument stands and how the player stands to it. Ours; live through `__debug.band`. */
export const FLOOR_TUNE = {
  /** How far in front of the player it is set down, metres. */
  ahead: 1.15,
  /** How far it is turned from facing the player, radians: 0 is square on. */
  turn: 0,
};

let pack: MusicPack | null = null;
let pending: Promise<MusicPack | null> | null = null;

/** The pack, fetched once for the session. Null where no music has been converted. */
export function loadMusic(baseUrl: string): Promise<MusicPack | null> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const res = await fetch(`${baseUrl}assets-private/music/music.json`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      const p = (await res.json()) as MusicPack;
      if (p?.version !== MUSIC_PACK_VERSION || !Array.isArray(p.songs)) return null;
      pack = p;
      return p;
    } catch {
      return null;
    }
  })();
  return pending;
}

export function musicPack(): MusicPack | null {
  return pack;
}

/**
 * Which stem an instrument plays, **of a given song**, or null when the pack cannot place it.
 *
 * An exact lookup on the instrument's own id, and deliberately so: the pack is keyed by the very
 * ids the weapons pack carries, because the `music` command reads that pack and resolves every
 * spelling itself (a `_hue` variant is the same instrument in a colour somebody picked, and there
 * are fourteen instruments behind the archives' 28 templates).
 *
 * The song matters for one instrument and the game's own table is what says so: the **xantha plays
 * the mandoviol's part for songs 1 to 10 and its own for 11 to 20**, which is exactly why those
 * first ten songs carry five stems and the rest carry six. Asked without a song, an instrument
 * answers with the stem it plays on most of them.
 */
export function stemFor(instrumentId: string, from: MusicPack | null = pack, song?: number): string | null {
  const entry = from?.instruments[instrumentId];
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  return (song !== undefined ? entry.songs?.[song] : undefined) ?? entry.stem;
}

/** A song by its number, or null. */
export function songOf(n: number, from: MusicPack | null = pack): { song: number; stems: Record<string, StemParts> } | null {
  return from?.songs.find((s) => s.song === n) ?? null;
}

/**
 * Every song this instrument really has a track for, by number.
 *
 * It takes the **instrument** and not a stem, because which stem it plays can differ from song to
 * song: asked by stem, a xantha was told the first ten songs had no part for it when the game gave
 * it the mandoviol's.
 */
export function songsFor(instrumentId: string | null, from: MusicPack | null = pack): number[] {
  if (!instrumentId || !from) return [];
  return from.songs.filter((s) => !!s.stems[stemFor(instrumentId, from, s.song) ?? '']).map((s) => s.song);
}

/**
 * The parts an instrument plays of a song, or null where that song has no track for it.
 *
 * This is the whole of "you must have a specific instrument equipped to get that instrument's
 * track": there is no falling back on another stem, because a nalargon playing the kloo horn's part
 * would be the one thing this is not.
 */
export function partsFor(song: number, stem: string | null, from: MusicPack | null = pack): StemParts | null {
  if (!stem) return null;
  return songOf(song, from)?.stems[stem] ?? null;
}

/** The sound-template id a part is played under: one name a file, so nothing is ever made twice. */
export function musicId(file: string): string {
  return `music:${file.replace(/^samples\//, '').replace(/\.[^.]+$/, '')}`;
}

/**
 * A made template for one part. The settings are ours: nothing in `player_music/` carries a `.snd`,
 * so there is nothing of the game's to copy and these are chosen.
 *
 * **Nothing here loops.** `_lp` in these file names is not a flag: all 880 flourishes in the pack
 * are named `_lp` and every one of them is a single strike, so reading the name as "play for ever"
 * left a flourish sounding at the spot it was struck until the world went away, and eight of them at
 * once over the top of each other. A performance is a **chain** of single plays instead, each one
 * scheduled at the exact moment the last ends, which is both what the owner asked for (intro alone,
 * then the loop; a flourish waits its turn and hands back) and the only way a loop can have a moment
 * in it at which anything may be decided. `loops` is kept for a caller that really wants one.
 *
 * **It is written as a real `SoundTemplate` and is not cast.** The first cut of this was a hand-made
 * object behind `as unknown as SoundTemplate`, and it had six faults the compiler would have caught
 * in one go: scalars where the reader wants a `Variation` or a two-number range (which is what threw
 * -- `volume: 1` made `vol.range[0]` a read off undefined), the sample path one `../` short of where
 * the music really lives, `loop` where the field is `loops` (so a main part played once and then
 * hung), `placedMusic`, which routes a sound onto the **ambience** slider, and four fields the
 * interface does not have at all. Leaving out `volume`, `pitch`, `delay` and the fades is the point:
 * the reader's own defaults are exactly what is wanted, and absent cannot be the wrong shape.
 *
 * The path is two levels up, not one: the bank fetches from `assets-private/sounds/samples/`, the
 * sabers' own `../jka/` reaches `assets-private/sounds/jka/` beside it, and the music is a sibling
 * of `sounds/` rather than a child, at `assets-private/music/samples/`.
 */
export function musicTemplate(file: string, loops: boolean): SoundTemplate {
  const sample = `../../music/${file.startsWith('samples/') ? file : `samples/${file}`}`;
  const t: SoundTemplate = {
    dim: 3,
    samples: [sample],
    // The game's own category 9 is player music, which is what this is, and which the mixer's own
    // table already sends to the music slider.
    category: 9,
    priority: 0,
    // The one radius that matters: how far a band carries. Everything past it is silence, and the
    // whole of the falloff inside it is `distance.ts`, as for every other sound in the game.
    full: BAND_TUNE.full,
  };
  return loops ? { ...t, loops: [-1, -1] } : t;
}

/**
 * Where in its loop a song is, at a moment of the shared clock.
 *
 * Two players who press at different moments must still be in the same place in the bar, so the
 * offset comes off the wall clock and not off when anybody started. Nothing is sent to make it true.
 */
export function songOffset(seconds: number, tune = BAND_TUNE): number {
  const bar = Math.max(0.5, tune.bar);
  return ((seconds % bar) + bar) % bar;
}

/** What one player is playing, as everybody's browser needs to know it. */
export interface Performance {
  /** The song's number. */
  song: number;
  /** The stem their instrument plays. */
  stem: string;
  /** Which flourish they have just struck, and when, or 0. */
  flourish: number;
}

/** Whether two players are in the same band: the same song, and near enough to hear. */
export function inBand(a: Performance | null, b: Performance | null, away: number, tune = BAND_TUNE): boolean {
  if (!a || !b) return false;
  return a.song === b.song && away <= tune.reach;
}

/** What a performance reads as: the song and the instrument, in words. */
export function bandWords(p: Performance | null, names: Record<string, string> = pack?.stemNames ?? {}): string {
  if (!p) return '';
  return `song ${p.song} on the ${names[p.stem] ?? p.stem}`;
}

/** What the band needs of the mixer, so a node test can drive the whole thing with nothing. */
export interface BandDeps {
  /** Start a looping part at a place, and answer its key. */
  loop(id: string, at: { x: number; y: number; z: number }, gain: number, offset: number): number;
  /**
   * Play a part once at a place, and answer its key.
   *
   * `when` is a moment on the **audio** clock to start at, or 0 for now. It is what makes a chain of
   * parts one piece of music rather than a part a frame late: Web Audio honours it to the sample.
   */
  once(id: string, at: { x: number; y: number; z: number }, gain: number, when?: number): number;
  stop(key: number, fade?: number): void;
  /** Move a voice that is already playing, for a performer who walks. */
  move?(key: number, at: { x: number; y: number; z: number }): void;
  /** Hang a made template in front of the bank's own lookup. */
  provide(id: string, template: SoundTemplate): void;
  /** Ask for a part's sample, so its length is known before it is wanted. */
  prepare?(ids: string[]): void;
  /** How long a part is, seconds, or 0 while its sample is still being decoded. */
  duration?(id: string): number;
  /** The audio clock, in seconds: the one a start time is measured against. */
  now?(): number;
  /** The shared clock, in seconds. */
  seconds(): number;
}

/** Which part of a performance is sounding. */
export type SegmentKind = 'intro' | 'main' | 'flourish' | 'outro';

/** One part of a performance, sounding or scheduled to. */
interface Segment {
  kind: SegmentKind;
  /** Which flourish, or 0. */
  n: number;
  id: string;
  key: number;
  startsAt: number;
  /** 0 until the sample has been decoded and its length is known. */
  endsAt: number;
}

/** One performer's line: what they are playing, what is sounding, and what waits its turn. */
interface Line {
  song: number;
  stem: string;
  at: { x: number; y: number; z: number };
  sounding: Segment | null;
  /** The part already handed to the mixer to start the moment this one ends. */
  next: Segment | null;
  /** The flourish waiting its turn, or 0. Never more than one. */
  queued: number;
}

/**
 * Everybody's music: this player's own part, and one part per other player in earshot.
 *
 * It holds one looping voice per performer and nothing else; a performer who stops, walks out of
 * earshot or changes song has their voice stopped and, where they are still playing, a new one
 * started. Every template it will ever need is made the first time that part is played and then
 * kept, so nothing is built on a frame twice.
 */
export class Band {
  private deps: BandDeps | null = null;
  private readonly made = new Set<string>();
  /** One line per performer: the local player is `0`. */
  private readonly lines = new Map<number, Line>();
  /** What this player is playing, or null. */
  mine: Performance | null = null;
  /**
   * Told when this player's own performance moves on to a part, so the body can be posed with it.
   *
   * The animation is the sound's, not the key press's: a flourish struck in the middle of a bar is
   * heard at the top of the next one, and the body has to wait with it or the two come apart.
   */
  onSegment: ((kind: SegmentKind, n: number) => void) | null = null;

  attach(deps: BandDeps): void {
    this.deps = deps;
  }

  /** Make a part's template the first time it is wanted, and answer its id. */
  private idFor(file: string): string {
    const id = musicId(file);
    if (!this.made.has(id)) {
      this.made.add(id);
      // Never a loop: a performance is a chain of single plays, and `_lp` in these names is not a
      // flag. See `musicTemplate`.
      this.deps?.provide(id, musicTemplate(file, false));
    }
    return id;
  }

  /** The audio clock, or the shared one where the mixer has not been asked for its own. */
  private clock(): number {
    return this.deps?.now?.() ?? this.deps?.seconds() ?? 0;
  }

  /** Hand one part to the mixer, to start now or at a moment already decided. */
  private begin(line: Line, kind: SegmentKind, n: number, file: string, when: number): Segment | null {
    const d = this.deps;
    if (!d) return null;
    const id = this.idFor(file);
    const gain = BAND_TUNE.gain * (kind === 'flourish' ? BAND_TUNE.flourish : 1);
    const key = d.once(id, line.at, gain, when || undefined);
    if (!key) return null;
    const startsAt = when || this.clock();
    const length = d.duration?.(id) ?? 0;
    return { kind, n, id, key, startsAt, endsAt: length > 0 ? startsAt + length : 0 };
  }

  /**
   * Start playing, or change what is played. Answers why not, or null.
   *
   * It refuses in words rather than silently: holding the wrong instrument for a song is the
   * commonest thing that will happen and the player has to be told which it is.
   *
   * **The intro plays alone.** It used to be laid over the loop, on the reasoning that a band is
   * already lined up by the clock so a late joiner should play its intro while the others play on;
   * the owner's answer is that a song begins with its intro and then repeats, and they are right --
   * what the old way sounded like was two parts at once. The shared bar is kept where it still means
   * something, which is joining somebody else's performance already in progress (`hear`).
   */
  start(song: number, instrument: string | null, at: { x: number; y: number; z: number }): string | null {
    if (!this.deps) return 'there is no sound yet';
    if (!pack) return 'no music is converted: run the converter\'s `music` command';
    if (!instrument) return 'nothing in your hands to play';
    const stem = stemFor(instrument, pack, song);
    if (!stem) return 'that is not an instrument this game can play';
    const parts = partsFor(song, stem);
    if (!parts) return `song ${song} has no part for the ${pack.stemNames[stem] ?? stem}`;
    this.stopLine(0, 0);
    // Every part of this song is asked for at once, so the chain never reaches a seam whose sample
    // has not been decoded: a length that is not known yet is a part that cannot be scheduled.
    this.deps.prepare?.([parts.main, parts.intro, parts.outro, ...parts.flourishes].filter((f): f is string => !!f).map((f) => this.idFor(f)));
    const line: Line = { song, stem, at: { ...at }, sounding: null, next: null, queued: 0 };
    const first = this.begin(line, parts.intro ? 'intro' : 'main', 0, parts.intro ?? parts.main, 0);
    if (!first) return 'the music would not start';
    line.sounding = first;
    this.lines.set(0, line);
    this.mine = { song, stem, flourish: 0 };
    this.onSegment?.(first.kind, 0);
    return null;
  }

  /**
   * Keep this player's own part at their own place, so walking away from a band is heard as walking
   * away, and somebody else hears you coming.
   *
   * **Every** voice of the line is moved, not only the one sounding: the next part is handed to the
   * mixer up to a quarter of a second early, and one left at the place it was scheduled from is a
   * flourish that plays where you were standing rather than where you are.
   */
  moveMine(at: { x: number; y: number; z: number }): void {
    const line = this.lines.get(0);
    if (!line) return;
    line.at.x = at.x;
    line.at.y = at.y;
    line.at.z = at.z;
    const move = this.deps?.move;
    if (!move) return;
    if (line.sounding) move(line.sounding.key, at);
    if (line.next) move(line.next.key, at);
  }

  /**
   * Ask for a flourish. It waits its turn.
   *
   * It is **queued, not played**: the part sounding now finishes and the flourish is the next thing
   * heard, once, and then the loop again. At most one waits at a time, and asking again while one
   * waits replaces it rather than adding to it -- pressing four of them in a bar plays the fourth,
   * which is what a player means by it. Answers whether this song has that flourish at all.
   */
  flourish(n: number): boolean {
    const mine = this.mine;
    const line = this.lines.get(0);
    if (!this.deps || !mine || !line) return false;
    const parts = partsFor(mine.song, mine.stem);
    if (!parts?.flourishes[n - 1]) return false;
    line.queued = n;
    mine.flourish = n;
    return true;
  }

  /** What is waiting its turn for this player, or 0. */
  queued(): number {
    return this.lines.get(0)?.queued ?? 0;
  }

  /** What this player is hearing of their own performance right now. */
  sounding(): { kind: SegmentKind; n: number } | null {
    const s = this.lines.get(0)?.sounding;
    return s ? { kind: s.kind, n: s.n } : null;
  }

  /** Stop playing: what is sounding is let go and the outro takes its place. */
  stop(at: { x: number; y: number; z: number }): void {
    const mine = this.mine;
    const line = this.lines.get(0);
    if (mine && line && this.deps) {
      const parts = partsFor(mine.song, mine.stem);
      this.stopLine(0, BAND_TUNE.cut);
      if (parts?.outro) {
        const only: Line = { song: mine.song, stem: mine.stem, at: { ...at }, sounding: null, next: null, queued: 0 };
        // The outro is the last thing this line does: it is given a line of its own with no song
        // behind it, so nothing follows it and the tick lets go the moment it has played.
        const seg = this.begin(only, 'outro', 0, parts.outro, 0);
        if (seg) {
          only.sounding = seg;
          this.lines.set(0, only);
        }
        this.onSegment?.('outro', 0);
      }
    } else {
      this.stopLine(0, BAND_TUNE.cut);
    }
    this.mine = null;
  }

  /**
   * One frame of every performance: the seam between one part and the next.
   *
   * There is one decision and it is made here. A part's length is known once its sample has been
   * decoded; a little before it ends the next part is **scheduled** at the exact moment it will,
   * which is the flourish that was waiting if one was, else the loop again. Scheduling rather than
   * starting is the whole of why a bar has no gap in it.
   */
  tick(): void {
    if (!this.deps) return;
    const now = this.clock();
    for (const [id, line] of [...this.lines]) this.step(id, line, now);
  }

  private step(id: number, line: Line, now: number): void {
    const sounding = line.sounding;
    if (!sounding) {
      this.stopLine(id, 0);
      return;
    }
    // A length that was not known when the part was handed over: ask again now it has been decoded.
    if (!sounding.endsAt) {
      const length = this.deps?.duration?.(sounding.id) ?? 0;
      if (length > 0) sounding.endsAt = sounding.startsAt + length;
    }
    if (line.next && now >= line.next.startsAt) {
      line.sounding = line.next;
      line.next = null;
      if (id === 0) {
        this.onSegment?.(line.sounding.kind, line.sounding.n);
        if (this.mine) this.mine.flourish = line.sounding.kind === 'flourish' ? line.sounding.n : 0;
      }
      return;
    }
    if (!sounding.endsAt || line.next) return;
    // The outro is the end of it: when it has played, the line goes.
    if (sounding.kind === 'outro') {
      if (now >= sounding.endsAt) this.stopLine(id, 0);
      return;
    }
    if (now < sounding.endsAt - BAND_TUNE.ahead) return;
    const parts = partsFor(line.song, line.stem);
    if (!parts) {
      this.stopLine(id, 0);
      return;
    }
    // Whatever was waiting, once; else the loop. Taking it off the queue here is what makes "the
    // next one only" true: from this moment a press queues the part after.
    const wanted = line.queued;
    const file = wanted ? parts.flourishes[wanted - 1] : parts.main;
    const seg = this.begin(line, wanted ? 'flourish' : 'main', wanted, file ?? parts.main, sounding.endsAt);
    if (!seg) return;
    line.queued = 0;
    line.next = seg;
  }

  /**
   * What another player is playing, and where they are. `null` stops hearing them.
   *
   * Their own stem is played at their own place, so two people on two instruments really are the
   * two tracks the game wrote; they are joined at the shared offset, since we are coming in part way
   * through something they began, and from there their line chains like anybody's.
   */
  hear(id: number, what: Performance | null, at: { x: number; y: number; z: number } | null, away: number): void {
    if (!this.deps || !id) return;
    const had = this.lines.get(id);
    if (!what || !at || away > BAND_TUNE.reach) {
      this.stopLine(id, BAND_TUNE.cut);
      return;
    }
    const parts = partsFor(what.song, what.stem);
    if (!parts) {
      this.stopLine(id, BAND_TUNE.cut);
      return;
    }
    if (had && had.song === what.song && had.stem === what.stem) {
      had.at.x = at.x;
      had.at.y = at.y;
      had.at.z = at.z;
      if (had.sounding) this.deps.move?.(had.sounding.key, at);
      if (had.next) this.deps.move?.(had.next.key, at);
      return;
    }
    this.stopLine(id, BAND_TUNE.cut);
    const line: Line = { song: what.song, stem: what.stem, at: { ...at }, sounding: null, next: null, queued: 0 };
    const mainId = this.idFor(parts.main);
    const key = this.deps.loop(mainId, at, BAND_TUNE.gain, songOffset(this.deps.seconds()));
    if (!key) return;
    line.sounding = { kind: 'main', n: 0, id: mainId, key, startsAt: this.clock(), endsAt: 0 };
    this.lines.set(id, line);
  }

  private stopLine(id: number, fade: number): void {
    const line = this.lines.get(id);
    if (!line) return;
    this.lines.delete(id);
    if (line.sounding) this.deps?.stop(line.sounding.key, fade);
    if (line.next) this.deps?.stop(line.next.key, 0);
  }

  /** Everybody's music stopped: a world going away, or a character put down. */
  clear(): void {
    for (const id of [...this.lines.keys()]) this.stopLine(id, 0);
    this.mine = null;
  }

  /** What `__debug.band()` prints. */
  report(): { mine: string; sounding: string; queued: number; playing: number; made: number; songs: number; tune: typeof BAND_TUNE } {
    const s = this.lines.get(0)?.sounding;
    return {
      mine: bandWords(this.mine),
      sounding: s ? `${s.kind}${s.n ? ` ${s.n}` : ''}${s.endsAt ? `, ${(s.endsAt - this.clock()).toFixed(1)} s left` : ', length not known yet'}` : '',
      queued: this.queued(),
      playing: this.lines.size,
      made: this.made.size,
      songs: pack?.songs.length ?? 0,
      tune: { ...BAND_TUNE },
    };
  }
}

/** One for the session, as the rest of the audio's own pieces are. */
export const band = new Band();
