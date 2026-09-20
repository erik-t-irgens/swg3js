/**
 * The sound a place makes.
 *
 * The game's environment tables give every area, at every weather level, two ambient sounds by day
 * and two by night: a bed that loops for ever (`amb_corellia_coronet_lp`) and a bed of quiet
 * one-shots with long gaps (`amb_corellia_coronet_os`, a bird or a distant call every fifteen to
 * thirty seconds). The sky already blends up to four of those rows at once -- two weather levels,
 * and two areas while the player crosses a boundary -- and this plays exactly the same rows at
 * exactly the same weights, so a storm's own bed rises with the storm's own clouds and a walk from
 * the grassland into the swamp crossfades in sound the way it does in sight.
 *
 * Inside a building the interior table's row for that room takes the area's place, and a placed
 * sound object in the same room takes the row's place, so a cantina's chatter is never doubled.
 *
 * Everything below is either the game's data or marked INVENTED where it is not. The pieces that
 * decide what plays are pure functions with no Web Audio and no clock in them, because the tab this
 * was built in can hear nothing: every judgement of how it sounds is the owner's, and every
 * judgement of whether it is right is a number a node test or `__debug.ambience()` can read.
 */
import { OUTSIDE, type SoundSpace } from './distance.ts';
import { WORLD_SOURCE_TUNE, WorldEmitters, type LoopHost, type WorldSourceTune } from './emitters.ts';

/** One row of the game's interior table, as the converter writes it into `sounds/sources.json`. */
export interface RoomRow {
  pob: string;
  cell: string;
  day: string | null;
  night: string | null;
  music: string | null;
  surface: string;
  /** The client's room type: 7 on Mos Eisley's cantina and the four capitol lobbies, 22 elsewhere. */
  room: number;
}

/** A placed sound object, as the converter writes it into `<planet>/sounds.json`. */
export interface PlacedEmitterDef {
  sound: string;
  /** The object template that named it. */
  template?: string;
  /**
   * Its place in the snapshot's own frame, exactly as `layout.json` writes an object's: unmirrored
   * and uncentred, so a pack whose centre moves needs no rerun. `setFrame` turns it into the game's.
   */
  p?: number[];
  /** The portal layout of the building it stands in, when the snapshot puts it in one. */
  pob?: string;
  /** Which cell of that building, by the portal file's own numbering; absent or 0 is not in a room. */
  cell?: number;
  /** That building's own place, in the snapshot's frame. */
  bp?: number[];
}

/**
 * What the converter writes at `<planet>/sounds.json`. Every part is optional and the whole file
 * may be missing: a planet whose places have not been converted still sounds, from its sky's own
 * rows and the shared interior table, and says so in `__debug.ambience()`.
 */
export interface PlanetSounds {
  format?: number;
  planet?: string;
  /** Which frame the places are in. Only the snapshot's is understood; anything else is left alone. */
  frame?: string;
  emitters?: PlacedEmitterDef[];
  /** Each placed template's portal layout, for the rooms below. */
  pobs?: Record<string, string>;
  /** Each placed template's own surface, for the footsteps in a later wave. */
  surfaces?: Record<string, string>;
  /** This planet's rows of the interior table, keyed `<pob>|<cell name>`. */
  rooms?: Record<string, Partial<RoomRow>>;
}

/** The shape of `<planet>/sounds.json` this reads; a newer pack is used as far as it is understood. */
export const PLANET_SOUNDS_READ = 1;

/** A row of the sky's mix: the ambient sounds it names, and its share of this frame. */
export interface BedRow {
  sounds?: { day: (string | null)[]; night: (string | null)[] } | null;
  weight: number;
}

export interface AmbienceTune {
  /** INVENTED: seconds the day beds and the night beds take to cross over at dawn and dusk. */
  dayFade: number;
  /** INVENTED: seconds a room's bed takes to replace the area's, and to give it back. */
  roomFade: number;
  /** INVENTED: a bed wanted at less than this share is not worth a voice. */
  floor: number;
  /** INVENTED: seconds a bed stays wanted at nothing before its voice is let go. */
  linger: number;
  /** INVENTED: seconds a bed's voice fades out over when it is let go. */
  fadeOut: number;
  /** INVENTED: seconds between tries at a bed whose template turned out not to loop. */
  retry: number;
  /**
   * INVENTED (the owner's decision 5). The storm rows already carry the thunder as their own
   * one-shot bed, and the rain particles name a second thunder of their own; playing both would
   * double it. Off, the rows alone thunder. `__debug.ambience({ weatherParticles: true })` adds the
   * particles' as well.
   */
  weatherParticles: boolean;
}

/**
 * Every number here is ours. The two fades are the pace the rest of the game changes at: the colour
 * grade eases over a second on a doorway, and the client's own dawn takes about twenty seconds of
 * the day at its default length.
 */
export const AMBIENCE_TUNE: AmbienceTune = { dayFade: 20, roomFade: 1, floor: 0.01, linger: 3, fadeOut: 1.5, retry: 1, weatherParticles: false };

/**
 * A sound id as the bank files it. Eleven of the interior table's rooms name their bed with a
 * trailing space on it (the tutorial station's greenhouses, sickbay, docking bays and droid rooms),
 * which the bank has no entry for, and without this those rooms take the frame from the area and
 * then play nothing in it. The converter is the right place to trim it and will; this is the belt,
 * so a pack already on disk mends itself.
 */
const trimId = (id: string | null | undefined): string | null => {
  if (!id) return null;
  const t = id.trim();
  return t ? t : null;
};

/** The interior table indexed by `<pob>|<cell>`; built once per pack. */
export function indexRooms(rows: readonly RoomRow[] | null | undefined): Map<string, RoomRow> {
  const out = new Map<string, RoomRow>();
  for (const r of rows ?? []) {
    if (!r || !r.pob) continue;
    const day = trimId(r.day);
    const night = trimId(r.night);
    const music = trimId(r.music);
    // The row is copied only when a trim changed something, so the usual table shares its own rows.
    const row = day === r.day && night === r.night && music === r.music ? r : { ...r, day, night, music };
    out.set(`${row.pob}|${row.cell}`, row);
  }
  return out;
}

/**
 * The table's row for one room: the room's own, then its building's `default` row, then the table's
 * own `default` row (`sound/default_interior.snd`, which is what every unlisted room sounded like).
 * Null when the table holds none of the three, which is what a pack with no sounds in it gives.
 *
 * With `playable`, the first row of the three whose bed the bank actually holds wins. Twelve of the
 * table's 265 rows name a sound the bank has no entry for; eleven of them are the trailing-space
 * ids `indexRooms` trims, and the three that remain after that (two Jedi enclaves and one Old
 * Republic facility) are not in the retail archives at all. Without this those rooms would take the
 * frame from the area and then play nothing in it.
 */
export function roomRowFor(index: Map<string, RoomRow>, pob: string, cell: string, playable?: (id: string) => boolean): RoomRow | null {
  let first: RoomRow | null = null;
  for (const key of [`${pob}|${cell}`, `${pob}|default`, 'default|default']) {
    const row = index.get(key);
    if (!row) continue;
    first ??= row;
    if (!playable || hasBed(row, playable)) return row;
  }
  return first;
}

/** Whether a row names a bed that can actually be played. */
function hasBed(row: RoomRow | null, playable?: (id: string) => boolean): boolean {
  if (!row) return false;
  if (!playable) return !!(row.day || row.night);
  return !!((row.day && playable(row.day)) || (row.night && playable(row.night)));
}

/**
 * The share of the frame every bed wants. Each row of the sky's mix contributes its own weight,
 * split between its day beds and its night beds by the day fraction, and the whole of the area's
 * side is scaled by what the room has not taken. Several rows usually name the same bed (a planet's
 * clear and light rows share one), so the shares are summed per bed and capped at the whole.
 *
 * Pure: `out` is cleared and refilled, and nothing else is read or written.
 */
export function mixBeds(out: Map<string, number>, rows: readonly BedRow[], count: number, daylight: number, room: RoomRow | null, roomShare: number): void {
  out.clear();
  const day = daylight < 0 ? 0 : daylight > 1 ? 1 : daylight;
  const inside = roomShare < 0 ? 0 : roomShare > 1 ? 1 : roomShare;
  const area = 1 - inside;
  if (area > 0) {
    for (let i = 0; i < count && i < rows.length; i++) {
      const row = rows[i];
      const w = row.weight * area;
      if (!(w > 0) || !row.sounds) continue;
      for (const id of row.sounds.day) addBed(out, id, w * day);
      for (const id of row.sounds.night) addBed(out, id, w * (1 - day));
    }
  }
  if (inside > 0 && room) {
    addBed(out, room.day, inside * day);
    addBed(out, room.night, inside * (1 - day));
  }
}

/** One bed's share added to what it already has. A function of its own, so a frame makes no closure. */
function addBed(out: Map<string, number>, id: string | null | undefined, w: number): void {
  if (!id || !(w > 0)) return;
  const had = out.get(id) ?? 0;
  out.set(id, Math.min(1, had + w));
}

/** One bed playing, or waiting to. */
interface Bed {
  id: string;
  /** Its share of this frame, 0 to 1. */
  want: number;
  key: number;
  /** Seconds it has been wanted at nothing. */
  idle: number;
  /** Seconds until it may be started again after a template that did not loop ran out. */
  wait: number;
}

/** What the world hands over each frame. Nothing here is kept: the numbers are copied out at once. */
export interface AmbienceContext {
  /** The blocks the sky is blending this frame and their weights (at most four). */
  rows: readonly BedRow[];
  rowCount: number;
  /** 0 at night, 1 in full daylight, as the sky reads it. */
  daylight: number;
  /** The interior row for the room the listener stands in, or null in the open. */
  room: RoomRow | null;
  /** Where the ear is: the building and cell, from the game's own numbering. */
  space: SoundSpace;
  /** True on the frames the emitter grid made a pass. */
  pass: boolean;
}

/**
 * The world's ambience: the area's beds, the room's bed, the placed sound objects and the particle
 * effects' own loops. One of these lives as long as the game does; a planet is handed to it with
 * `begin` and taken away with `leave`.
 */
export class Ambience {
  readonly tune: AmbienceTune = { ...AMBIENCE_TUNE };
  readonly sources: WorldEmitters;
  /** Counters a tab that can hear nothing reads instead of listening. */
  readonly counts = { packs: 0, noPack: 0, bedsStarted: 0, bedsRefused: 0, bedsStopped: 0 };

  private readonly host: LoopHost;
  private readonly baseUrl: string;
  private rooms = new Map<string, RoomRow>();
  /** The planet's own rows, which win over the shared table where the pack has them. */
  private planetRooms = new Map<string, RoomRow>();
  /** Moved on by every change to either table; read through `tableVersion`. */
  private tables = 0;
  private readonly beds = new Map<string, Bed>();
  /** Beds the sky's rows name that the bank has no entry for; asked for once each, then reported. */
  private readonly missingBeds = new Set<string>();
  /** Refilled every frame from the mix; a field, so a frame allocates nothing. */
  private readonly want = new Map<string, number>();
  private readonly listener: SoundSpace = { building: OUTSIDE.building, cell: OUTSIDE.cell };
  /** The weather channels' own sounds, by the file of the effect that named each. */
  private readonly weather = new Map<string, { sound: string | null; key: number; weight: number }>();
  private dayMix = 1;
  private roomShare = 0;
  private roomId = '';
  /** The next update takes the hour and the room as they are rather than crossfading into them. */
  private snap = true;
  /** A placed sound object stands in the room the listener is in, so its bed stands for the room's. */
  private covered = false;
  /** Moved on by every `begin` and every `leave`: a pack still in flight then never lands. */
  private token = 0;
  private packId = '';
  private packState = 'none';
  private emittersInPack = 0;
  /** The planet's places as the converter wrote them, held until the layout's centre is known. */
  private pack: PlanetSounds | null = null;
  private centerX = 0;
  private centerZ = 0;
  private hasFrame = false;
  private placed = false;

  constructor(host: LoopHost, baseUrl: string, tune?: Partial<WorldSourceTune>) {
    this.host = host;
    this.baseUrl = baseUrl;
    this.sources = new WorldEmitters(host, { ...WORLD_SOURCE_TUNE, ...tune });
  }

  /**
   * Moved on whenever either interior table changes. Anything that keeps the row it last looked up
   * (the world keeps one while the player stays in a room) compares this and asks again: the shared
   * table arrives some frames after the game starts and a planet's own with its pack, and a row
   * looked up before either landed is the table's fallback, not the room's own.
   */
  get tableVersion(): number {
    return this.tables;
  }

  /** The shared interior table from `sounds/sources.json`, once the bank has it. */
  setRooms(rows: readonly RoomRow[] | null | undefined): void {
    this.rooms = indexRooms(rows);
    this.tables++;
  }

  /** The interior row for a room, the planet's own rows first. Public: the footsteps read the same row. */
  roomRow(pob: string, cell: string): RoomRow | null {
    const can = this.playable;
    return roomRowFor(this.planetRooms, pob, cell, can) ?? roomRowFor(this.rooms, pob, cell, can);
  }

  /**
   * The interior row a room's floor is read from. The same lookup as `roomRow` without the "can the
   * bank play its bed" test: twelve of the table's 265 rows name a bed the bank has no entry for,
   * and for those `roomRow` falls through to a less specific row, whose floor is not this room's.
   */
  roomSurfaceFor(pob: string, cell: string): string | null {
    return (roomRowFor(this.planetRooms, pob, cell) ?? roomRowFor(this.rooms, pob, cell))?.surface ?? null;
  }

  /** Whether the bank holds this sound at all; kept, so asking costs no closure. */
  private readonly playable = (id: string): boolean => !!this.host.bank.template(id);

  /**
   * A planet is loading: start fetching its places. Nothing is awaited on the loading path -- a pack
   * that lands after the player has arrived simply adds its emitters then, and one that is not there
   * at all leaves the planet sounding from its sky rows alone.
   */
  begin(packId: string): void {
    this.leave();
    this.packId = packId;
    this.packState = 'loading';
    const token = this.token;
    void fetch(`${this.baseUrl}assets-private/${packId}/sounds.json`)
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as PlanetSounds;
      })
      .catch(() => null)
      .then((pack) => {
        if (token !== this.token) return;
        this.adopt(pack);
      });
  }

  /**
   * Where this planet's layout is centred, which the emitters' places are read against. The sound
   * pack and the model pack land in either order, so whichever is second does the work.
   */
  setFrame(centerX: number, centerZ: number): void {
    this.centerX = centerX;
    this.centerZ = centerZ;
    this.hasFrame = true;
    this.place();
  }

  /** A pack read elsewhere (the node test, a later wave's own fetch). */
  adopt(pack: PlanetSounds | null): void {
    if (!pack) {
      this.packState = 'none';
      this.counts.noPack++;
      return;
    }
    this.packState = 'loaded';
    this.counts.packs++;
    this.pack = pack;
    this.planetRooms = new Map<string, RoomRow>();
    for (const [key, row] of Object.entries(pack.rooms ?? {})) {
      const [pob, cell] = key.split('|');
      this.planetRooms.set(key, { pob: row.pob ?? pob ?? '', cell: row.cell ?? cell ?? 'default', day: trimId(row.day), night: trimId(row.night), music: trimId(row.music), surface: row.surface ?? 'stone', room: row.room ?? 22 });
    }
    this.tables++;
    this.emittersInPack = (pack.emitters ?? []).length;
    // Every emitter's sample asked for at once, so a town is already decoded when the player walks
    // in. This needs no frame, so it starts whether or not the model pack has landed yet.
    const sounds: string[] = [];
    for (const e of pack.emitters ?? []) if (e?.sound) sounds.push(e.sound);
    this.sources.prepare(sounds);
    this.place();
  }

  /**
   * The emitters put down, once both the pack and the frame are in. Their places are the snapshot's
   * own, so they are mirrored in X and centred exactly as `LayoutStreamer` does it for every other
   * object; anything else and a town's crowds would stand on the far side of it.
   */
  private place(): void {
    const pack = this.pack;
    if (!pack || !this.hasFrame || this.placed) return;
    this.placed = true;
    if (pack.frame && pack.frame !== 'snapshot') {
      console.warn(`sound: ${this.packId}'s places are in an unknown frame (${pack.frame}); they are left out`);
      return;
    }
    if ((pack.format ?? 0) > PLANET_SOUNDS_READ) console.info(`sound: ${this.packId}'s places are from a newer converter (format ${pack.format}); read as far as this game understands them`);
    for (const e of pack.emitters ?? []) {
      if (!e?.sound) continue;
      const x = -((e.p?.[0] ?? 0) - this.centerX);
      const y = e.p?.[1] ?? 0;
      const z = (e.p?.[2] ?? 0) - this.centerZ;
      const inside = !!e.pob || (e.cell ?? 0) > 0;
      // The only false is the cap: a source the mixer would not start yet is kept and started when
      // the bank lands, and one whose template is missing is counted. Stopping the walk for either
      // of those would lose a town's crowds and its cantina bands to one sample, since the
      // converter writes the sound objects first and the humming props after.
      if (!this.sources.addPlaced(e.sound, x, y, z, inside)) break;
    }
  }

  /**
   * Every bed this planet's sky can play, asked for behind the loading screen, so no bed is decoded
   * on a live frame. The room beds of the buildings the pack holds go with them.
   */
  prepare(rows: readonly Pick<BedRow, 'sounds'>[], buildings: readonly string[]): void {
    const ids = new Set<string>();
    for (const row of rows) {
      for (const id of row.sounds?.day ?? []) if (id) ids.add(id);
      for (const id of row.sounds?.night ?? []) if (id) ids.add(id);
    }
    // Every row of every building this pack holds, not just each building's default: 43 of the
    // table's rooms name a bed that differs from their building's, and asking for the default alone
    // left those to be fetched and decoded on the frame the player first walked into them. The
    // whole table names 45 distinct beds, so this costs a handful of samples at most.
    const want = new Set(buildings);
    for (const table of [this.rooms, this.planetRooms]) {
      for (const row of table.values()) {
        if (!want.has(row.pob)) continue;
        if (row.day) ids.add(row.day);
        if (row.night) ids.add(row.night);
      }
    }
    const fallback = this.roomRow('default', 'default');
    if (fallback?.day) ids.add(fallback.day);
    if (fallback?.night) ids.add(fallback.night);
    this.host.prepare(ids);
  }

  /**
   * The frame's work: the day and night crossfade, the room crossfade, what every bed is wanted at,
   * and the sources' own bounded pass. Nothing is allocated: the want map and the bed records are
   * fields, and the sources only look at anything on a grid pass.
   */
  update(dt: number, ctx: AmbienceContext): void {
    const step = Math.max(0, Math.min(0.25, dt));
    // Arriving on a planet there is nothing to cross over from: the hour and the room are taken as
    // they are, or a landing at midnight would spend twenty seconds fading a day bed nobody heard.
    if (this.snap) {
      this.snap = false;
      this.dayMix = ctx.daylight;
      this.roomShare = hasBed(ctx.room, this.playable) ? 1 : 0;
    }
    // The sky's day fraction already eases through dawn; this only keeps fast time (ninety times
    // the clock, from the console) and a travel from whipping the beds across in a frame.
    this.dayMix = ease(this.dayMix, ctx.daylight, step / Math.max(0.01, this.tune.dayFade));
    this.roomId = ctx.room ? `${ctx.room.pob}|${ctx.room.cell}` : '';
    // Whether one of the game's own sound objects stands in the room the listener is in. Looked for
    // on the grid's own beat, since it is a walk of the planet's emitters rather than a lookup.
    if (ctx.pass) this.covered = this.sources.hasEmitterIn(ctx.space);
    // A room whose row names no bed at all is not a room for this: the area keeps the whole frame.
    // A room with a sound object of its own is: the object is the room's sound, and the table's bed
    // is left out below, or a cantina's chatter plays over itself.
    const wantInside = this.covered || hasBed(ctx.room, this.playable) ? 1 : 0;
    this.roomShare = ease(this.roomShare, wantInside, step / Math.max(0.01, this.tune.roomFade));
    if (this.listener.building !== ctx.space.building || this.listener.cell !== ctx.space.cell) {
      this.listener.building = ctx.space.building;
      this.listener.cell = ctx.space.cell;
      // A bed is not in a room of its own: it is the sound of wherever the ear is, so it moves with
      // it, and the crossfade above is what takes the street away rather than the muffling rule.
      for (const bed of this.beds.values()) if (bed.key) this.host.setSpace(bed.key, this.listener);
      for (const ch of this.weather.values()) if (ch.key) this.host.setSpace(ch.key, this.listener);
    }
    mixBeds(this.want, ctx.rows, ctx.rowCount, this.dayMix, this.covered ? null : ctx.room, this.roomShare);
    for (const bed of this.beds.values()) bed.want = 0;
    for (const [sound, w] of this.want) {
      let bed = this.beds.get(sound);
      if (!bed) {
        bed = { id: sound, want: 0, key: 0, idle: 0, wait: 0 };
        this.beds.set(sound, bed);
      }
      bed.want = w;
    }
    for (const bed of this.beds.values()) this.stepBed(bed, step);
    this.sources.update(ctx.pass);
    if (ctx.pass) this.sources.retry();
  }

  /**
   * A weather channel's own sound at its share of the mix. The channel names the sound its effect
   * carries (the rain sheets' thunder); by default nothing is played, because the storm rows already
   * carry a thunder of their own as their one-shot bed.
   */
  weatherChannel(file: string, sound: string | null, weight: number): void {
    // A channel falling at nothing is not a channel: the weather says so both when a storm eases
    // and when it drops the channel altogether, and the second of those arrives after the planet
    // has been left (the sky is dropped after the ambience is), so a record made for it would
    // outlive the planet and show up on the select screen.
    const falling = !!sound && weight > this.tune.floor;
    let ch = this.weather.get(file);
    if (!ch) {
      if (!falling) return;
      ch = { sound: null, key: 0, weight: 0 };
      this.weather.set(file, ch);
    }
    ch.sound = sound;
    ch.weight = weight;
    const on = this.tune.weatherParticles && falling;
    if (!on) {
      if (ch.key) {
        this.host.stop(ch.key, this.tune.fadeOut);
        ch.key = 0;
      }
      if (!falling) this.weather.delete(file);
      return;
    }
    if (!ch.key || !this.host.isPlaying(ch.key)) {
      if (!this.host.bank.available) return;
      // No place: it is the weather at the ear, unpanned, like every bed.
      ch.key = this.host.play(sound!, { loop: true, gain: weight, space: this.listener });
    } else this.host.setGain(ch.key, weight);
  }

  /** Every weather channel let go (the world is going, or the weather was switched off). */
  clearWeather(): void {
    for (const ch of this.weather.values()) if (ch.key) this.host.stop(ch.key, this.tune.fadeOut);
    this.weather.clear();
  }

  /** The planet is going: every bed, emitter and channel let go, and any pack still in flight dropped. */
  leave(): void {
    this.token++;
    for (const bed of this.beds.values()) if (bed.key) this.host.stop(bed.key, this.tune.fadeOut);
    this.beds.clear();
    this.want.clear();
    this.missingBeds.clear();
    this.clearWeather();
    this.sources.clear();
    this.planetRooms = new Map<string, RoomRow>();
    this.tables++;
    this.dayMix = 1;
    this.roomShare = 0;
    this.roomId = '';
    this.snap = true;
    this.covered = false;
    this.packState = 'none';
    this.emittersInPack = 0;
    this.pack = null;
    this.hasFrame = false;
    this.placed = false;
    this.centerX = this.centerZ = 0;
  }

  status(): Record<string, unknown> {
    const beds: Record<string, unknown>[] = [];
    for (const bed of this.beds.values()) beds.push({ sound: bed.id, want: Number(bed.want.toFixed(3)), playing: bed.key !== 0 && this.host.isPlaying(bed.key), key: bed.key });
    beds.sort((a, b) => (b.want as number) - (a.want as number));
    const channels: Record<string, unknown>[] = [];
    for (const [file, ch] of this.weather) channels.push({ effect: file.replace(/^particles\/|\.json$/g, ''), sound: ch.sound, weight: Number(ch.weight.toFixed(3)), playing: ch.key !== 0 });
    return {
      planet: this.packId,
      pack: this.packState,
      emittersInPack: this.emittersInPack,
      emittersPlaced: this.placed,
      daylight: Number(this.dayMix.toFixed(3)),
      insideShare: Number(this.roomShare.toFixed(3)),
      room: this.roomId || null,
      roomCoveredByEmitter: this.covered,
      listener: { building: this.listener.building, cell: this.listener.cell },
      roomTable: { shared: this.rooms.size, planet: this.planetRooms.size },
      beds,
      bedsMissingFromBank: [...this.missingBeds],
      weatherChannels: channels,
      weatherParticleSounds: this.tune.weatherParticles,
      sources: this.sources.status(),
      counts: { ...this.counts },
    };
  }

  private stepBed(bed: Bed, dt: number): void {
    if (bed.wait > 0) bed.wait -= dt;
    if (bed.want > this.tune.floor) {
      bed.idle = 0;
      if (bed.key && this.host.isPlaying(bed.key)) {
        this.host.setGain(bed.key, bed.want);
        return;
      }
      // A bed whose template turned out not to loop for ever (nothing in the retail tables does, but
      // a pack is data and may) is simply started again, a second at a time rather than every frame.
      if (bed.wait > 0 || !this.host.bank.available) return;
      // A bed the bank has no entry for is asked for once and then let be. Six of the sounds the
      // planets' environment rows name are not in the retail archives (an outpost on one planet, and
      // the four trail zones of another, which have no outdoor bed at all), and asking again every
      // second for the life of the planet would fill `__debug.audio().recent` with nothing else.
      if (!this.playable(bed.id)) {
        if (!this.missingBeds.has(bed.id)) {
          this.missingBeds.add(bed.id);
          this.counts.bedsRefused++;
        }
        return;
      }
      bed.key = this.host.play(bed.id, { loop: true, gain: bed.want, space: this.listener });
      bed.wait = this.tune.retry;
      if (bed.key) this.counts.bedsStarted++;
      else this.counts.bedsRefused++;
      return;
    }
    if (!bed.key) {
      // No voice and nothing wanted: the record goes too, or a session that has walked over a
      // hundred area boundaries would walk a hundred dead beds every frame.
      bed.idle += dt;
      if (bed.idle > this.tune.linger) this.beds.delete(bed.id);
      return;
    }
    // Wanted at nothing: turned down at once, and the voice let go once the area has clearly gone,
    // so stepping back over a boundary does not restart a bed from its beginning.
    this.host.setGain(bed.key, 0);
    bed.idle += dt;
    if (bed.idle < this.tune.linger) return;
    this.host.stop(bed.key, this.tune.fadeOut);
    bed.key = 0;
    bed.idle = 0;
    this.counts.bedsStopped++;
  }
}

/** Move `from` toward `to` by at most `step`, so a whole crossfade takes its own tuned seconds. */
function ease(from: number, to: number, step: number): number {
  if (step >= 1) return to;
  const d = to - from;
  if (Math.abs(d) <= step) return to;
  return from + Math.sign(d) * step;
}
