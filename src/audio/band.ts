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
  /** Which stem each instrument in the weapons pack plays. */
  instruments: Record<string, string>;
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
   * How long a song's loop is taken to be, seconds, for lining two players up.
   *
   * It is not read off the file: a buffer's length is not known until it has been decoded, and two
   * browsers must agree before either has decoded anything. So the offset is taken modulo this, and
   * a song whose real loop is not a whole number of these drifts within one bar rather than being
   * in a different place for each player.
   */
  bar: 8,
};

export const MUSIC_PACK_VERSION = 1;

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

/** Which stem an instrument plays, or null when the pack cannot place it. */
export function stemFor(instrumentId: string, from: MusicPack | null = pack): string | null {
  if (!from) return null;
  return from.instruments[instrumentId] ?? null;
}

/** A song by its number, or null. */
export function songOf(n: number, from: MusicPack | null = pack): { song: number; stems: Record<string, StemParts> } | null {
  return from?.songs.find((s) => s.song === n) ?? null;
}

/** Every song this instrument really has a track for, by number. */
export function songsFor(stem: string | null, from: MusicPack | null = pack): number[] {
  if (!stem || !from) return [];
  return from.songs.filter((s) => !!s.stems[stem]).map((s) => s.song);
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
 * `loops` is the file's own `_lp`, which is the one thing the game did say.
 */
export function musicTemplate(file: string, loops: boolean): SoundTemplate {
  const sample = `../music/${file.startsWith('samples/') ? file : `samples/${file}`}`;
  return {
    id: musicId(file),
    samples: [sample],
    // The one radius that matters: how far a band carries. Everything past it is silence, and the
    // whole of the falloff inside it is `distance.ts`, as for every other sound in the game.
    full: 8,
    loop: loops ? 0 : 1,
    loopGap: 0,
    delay: 0,
    fadeIn: 0.05,
    fadeOut: 0.3,
    volume: 1,
    pitch: 0,
    volumeDrift: 0,
    pitchDrift: 0,
    priority: 0,
    category: 0,
    order: 0,
    flat: false,
    // It is music, so it answers to the music slider and nothing else.
    keptMusic: false,
    placedMusic: true,
  } as unknown as SoundTemplate;
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
  /** Play a part once at a place. */
  once(id: string, at: { x: number; y: number; z: number }, gain: number): number;
  stop(key: number, fade?: number): void;
  /** Move a voice that is already playing, for a performer who walks. */
  move?(key: number, at: { x: number; y: number; z: number }): void;
  /** Hang a made template in front of the bank's own lookup. */
  provide(id: string, template: SoundTemplate): void;
  /** The shared clock, in seconds. */
  seconds(): number;
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
  /** One voice per performer: the local player is `0`. */
  private readonly voices = new Map<number, { key: number; song: number; stem: string }>();
  /** What this player is playing, or null. */
  mine: Performance | null = null;

  attach(deps: BandDeps): void {
    this.deps = deps;
  }

  /** Make a part's template the first time it is wanted, and answer its id. */
  private idFor(file: string): string {
    const id = musicId(file);
    if (!this.made.has(id)) {
      this.made.add(id);
      this.deps?.provide(id, musicTemplate(file, /_lp$/.test(file.replace(/\.[^.]+$/, ''))));
    }
    return id;
  }

  /**
   * Start playing, or change what is played. Answers why not, or null.
   *
   * It refuses in words rather than silently: holding the wrong instrument for a song is the
   * commonest thing that will happen and the player has to be told which it is.
   */
  start(song: number, instrument: string | null, at: { x: number; y: number; z: number }): string | null {
    if (!this.deps) return 'there is no sound yet';
    if (!pack) return 'no music is converted: run the converter\'s `music` command';
    if (!instrument) return 'nothing in your hands to play';
    const stem = stemFor(instrument);
    if (!stem) return 'that is not an instrument this game can play';
    const parts = partsFor(song, stem);
    if (!parts) return `song ${song} has no part for the ${pack.stemNames[stem] ?? stem}`;
    this.stopOne(0);
    const key = this.deps.loop(this.idFor(parts.main), at, BAND_TUNE.gain, songOffset(this.deps.seconds()));
    if (!key) return 'the music would not start';
    this.voices.set(0, { key, song, stem });
    this.mine = { song, stem, flourish: 0 };
    // The intro over the top of the loop rather than before it: a band's parts are already lined up
    // by the clock, so a player who joins late plays the intro while everybody else plays on.
    if (parts.intro) this.deps.once(this.idFor(parts.intro), at, BAND_TUNE.gain);
    return null;
  }

  /**
   * Keep this player's own part at their own place, so walking away from a band is heard as walking
   * away. A voice's place is the mixer's to move and this is the one call that does it.
   */
  moveMine(at: { x: number; y: number; z: number }): void {
    const had = this.voices.get(0);
    if (had) this.deps?.move?.(had.key, at);
  }

  /** A flourish over the part, if this song has that one for this instrument. */
  flourish(n: number, at: { x: number; y: number; z: number }): boolean {
    const mine = this.mine;
    if (!this.deps || !mine) return false;
    const parts = partsFor(mine.song, mine.stem);
    const file = parts?.flourishes[n - 1];
    if (!file) return false;
    this.deps.once(this.idFor(file), at, BAND_TUNE.gain * BAND_TUNE.flourish);
    mine.flourish = n;
    return true;
  }

  /** Stop playing: the outro over the top, and the loop let go. */
  stop(at: { x: number; y: number; z: number }): void {
    const mine = this.mine;
    if (mine && this.deps) {
      const parts = partsFor(mine.song, mine.stem);
      if (parts?.outro) this.deps.once(this.idFor(parts.outro), at, BAND_TUNE.gain);
    }
    this.mine = null;
    this.stopOne(0);
  }

  /**
   * What another player is playing, and where they are. `null` stops hearing them.
   *
   * Their own stem is played at their own place, so two people on two instruments really are the
   * two tracks the game wrote; the loop is started at the shared offset, so they line up whoever
   * pressed first.
   */
  hear(id: number, what: Performance | null, at: { x: number; y: number; z: number } | null, away: number): void {
    if (!this.deps || !id) return;
    const had = this.voices.get(id);
    if (!what || !at || away > BAND_TUNE.reach) {
      this.stopOne(id);
      return;
    }
    const parts = partsFor(what.song, what.stem);
    if (!parts) {
      this.stopOne(id);
      return;
    }
    if (had && had.song === what.song && had.stem === what.stem) return;
    this.stopOne(id);
    const key = this.deps.loop(this.idFor(parts.main), at, BAND_TUNE.gain, songOffset(this.deps.seconds()));
    if (key) this.voices.set(id, { key, song: what.song, stem: what.stem });
  }

  private stopOne(id: number): void {
    const had = this.voices.get(id);
    if (!had) return;
    this.voices.delete(id);
    this.deps?.stop(had.key);
  }

  /** Everybody's music stopped: a world going away, or a character put down. */
  clear(): void {
    for (const id of [...this.voices.keys()]) this.stopOne(id);
    this.mine = null;
  }

  /** What `__debug.band()` prints. */
  report(): { mine: string; playing: number; made: number; songs: number; tune: typeof BAND_TUNE } {
    return { mine: bandWords(this.mine), playing: this.voices.size, made: this.made.size, songs: pack?.songs.length ?? 0, tune: { ...BAND_TUNE } };
  }
}

/** One for the session, as the rest of the audio's own pieces are. */
export const band = new Band();
