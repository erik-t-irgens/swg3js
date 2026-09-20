/**
 * Every looping sound in the world sits in this one grid and is checked against the listener four
 * times a second, not every frame: the placed emitters a planet holds, a particle effect's loop, a
 * creature's idle breath, an engine, a blade's hum. A check is a squared distance against the
 * source's own audible radius. Nothing is allocated while it runs.
 *
 * A source whose audible radius is larger than a few cells (a big machine, an explosion's bed) is
 * kept in a short list of its own and looked at on every pass, so a 2.5 km radius never makes the
 * grid walk half a planet's cells.
 *
 * Below the grid sits `WorldEmitters`: the world's own looping sources, which are the game's placed
 * sound objects and the loops a particle effect's emitters name. Each is one voice that lives as
 * long as the planet does; the grid decides four times a second which of them are close enough to
 * be worth a slot, and the mixer keeps the rest as virtual voices on their own clocks.
 */
import { audibleRadius, flatRadius, type DistanceTune, DISTANCE_TUNE, OUTSIDE, type SoundSpace } from './distance.ts';
import type { SoundSources } from './bank.ts';

export interface GridTune {
  /** INVENTED: the cell edge, metres. */
  cell: number;
  /** INVENTED: a source reaching farther than this goes in the far list instead of the grid. */
  far: number;
  /** INVENTED: passes a second. */
  rate: number;
}

export const GRID_TUNE: GridTune = { cell: 128, far: 384, rate: 4 };

export interface LoopSource {
  key: number;
  /** The template id (`sound/amb_cantina_large_lp.snd`). */
  sound: string;
  x: number;
  y: number;
  z: number;
  /** The template's full-volume radius. */
  full: number;
  /** A 2D template: unpanned, and heard only in the listener's own space. */
  flat: boolean;
  space: SoundSpace;
  /** Off while whatever owns it is idle (a weather channel at weight 0, a parked engine). */
  active: boolean;
  /** How far it is heard at all, from `full`. */
  reach: number;
  /** Which cell it is filed under; -1 for the far list. */
  cell: number;
  /** The last pass's distance to the listener, for the report and for ranking. */
  distance: number;
  /**
   * The pass on which it was last found within earshot. Compared with the grid's pass count rather
   * than kept as a flag, so a source the listener has walked away from (and which is therefore no
   * longer looked at at all) reads as out of earshot without anything having to clear it.
   */
  nearPass: number;
}

const packCell = (ix: number, iy: number, iz: number) => ((ix & 1023) << 20) | ((iy & 1023) << 10) | (iz & 1023);

export class EmitterGrid {
  readonly tune: GridTune;
  private readonly distance: DistanceTune;
  private readonly sources = new Map<number, LoopSource>();
  private readonly cells = new Map<number, number[]>();
  private readonly far: number[] = [];
  /** The handles within earshot after the last pass. Read, never kept. */
  readonly near: number[] = [];
  private since = 0;
  /** Passes run, and how many sources each looked at: the headless cost. */
  readonly counts = { passes: 0, tested: 0, near: 0 };

  constructor(tune: GridTune = GRID_TUNE, distance: DistanceTune = DISTANCE_TUNE) {
    this.tune = tune;
    this.distance = distance;
  }

  get size(): number {
    return this.sources.size;
  }

  source(key: number): LoopSource | undefined {
    return this.sources.get(key);
  }

  /** Every source, for the report; the caller must not keep the iterator. */
  all(): IterableIterator<LoopSource> {
    return this.sources.values();
  }

  add(key: number, sound: string, x: number, y: number, z: number, full: number, flat: boolean, space: SoundSpace): LoopSource {
    const reach = flat ? flatRadius(full, this.distance) : audibleRadius(full, this.distance);
    const s: LoopSource = { key, sound, x, y, z, full, flat, space: { building: space.building, cell: space.cell }, active: true, reach, cell: -1, distance: Infinity, nearPass: -1 };
    this.sources.set(key, s);
    this.file(s);
    return s;
  }

  /** Whether the last pass found this source within earshot. The one thing a pass is for. */
  isNear(key: number): boolean {
    const s = this.sources.get(key);
    return !!s && s.nearPass === this.counts.passes;
  }

  /**
   * Every source's reach and cell worked out again. The cell edge and the audible radius are read
   * when a source is filed, so moving either of them live (`__debug.audio({ grid: { cell } })`)
   * would otherwise orphan everything already in the grid.
   */
  rebuild(): void {
    const keys = [...this.sources.keys()];
    this.cells.clear();
    this.far.length = 0;
    this.near.length = 0;
    for (const key of keys) {
      const s = this.sources.get(key)!;
      s.reach = s.flat ? flatRadius(s.full, this.distance) : audibleRadius(s.full, this.distance);
      s.nearPass = -1;
      this.file(s);
    }
  }

  move(key: number, x: number, y: number, z: number): void {
    const s = this.sources.get(key);
    if (!s) return;
    s.x = x;
    s.y = y;
    s.z = z;
    const cell = this.cellOf(s);
    if (cell !== s.cell) {
      this.unfile(s);
      this.file(s);
    }
  }

  setActive(key: number, on: boolean): void {
    const s = this.sources.get(key);
    if (s) s.active = on;
  }

  remove(key: number): void {
    const s = this.sources.get(key);
    if (!s) return;
    this.unfile(s);
    this.sources.delete(key);
  }

  clear(): void {
    this.sources.clear();
    this.cells.clear();
    this.far.length = 0;
    this.near.length = 0;
  }

  /**
   * Advances the pass clock and, when a pass is due, refills `near`. Returns true on a pass, so
   * the caller does its own once-a-pass work (asking the budget for slots) on the same beat.
   */
  step(dt: number, lx: number, ly: number, lz: number): boolean {
    this.since += dt;
    const period = 1 / Math.max(0.5, this.tune.rate);
    if (this.since < period) return false;
    this.since = 0;
    this.near.length = 0;
    this.counts.passes++;
    const cell = Math.max(1, this.tune.cell);
    const ix = Math.floor(lx / cell);
    const iy = Math.floor(ly / cell);
    const iz = Math.floor(lz / cell);
    const reach = Math.min(3, Math.ceil(this.tune.far / cell));
    for (let a = -reach; a <= reach; a++) {
      for (let b = -reach; b <= reach; b++) {
        for (let c = -reach; c <= reach; c++) {
          const list = this.cells.get(packCell(ix + a, iy + b, iz + c));
          if (!list) continue;
          for (let i = 0; i < list.length; i++) this.test(list[i], lx, ly, lz);
        }
      }
    }
    for (let i = 0; i < this.far.length; i++) this.test(this.far[i], lx, ly, lz);
    this.counts.near = this.near.length;
    return true;
  }

  status(): Record<string, unknown> {
    let active = 0;
    for (const s of this.sources.values()) if (s.active) active++;
    return { sources: this.sources.size, active, near: this.near.length, cells: this.cells.size, far: this.far.length, passes: this.counts.passes, tested: this.counts.tested };
  }

  private test(key: number, lx: number, ly: number, lz: number): void {
    const s = this.sources.get(key);
    if (!s) return;
    this.counts.tested++;
    const dx = s.x - lx;
    const dy = s.y - ly;
    const dz = s.z - lz;
    const d2 = dx * dx + dy * dy + dz * dz;
    s.distance = Math.sqrt(d2);
    if (!s.active || d2 > s.reach * s.reach) return;
    s.nearPass = this.counts.passes;
    this.near.push(key);
  }

  private cellOf(s: LoopSource): number {
    if (s.reach > this.tune.far) return -1;
    const cell = Math.max(1, this.tune.cell);
    return packCell(Math.floor(s.x / cell), Math.floor(s.y / cell), Math.floor(s.z / cell));
  }

  private file(s: LoopSource): void {
    s.cell = this.cellOf(s);
    if (s.cell < 0) {
      this.far.push(s.key);
      return;
    }
    let list = this.cells.get(s.cell);
    if (!list) {
      list = [];
      this.cells.set(s.cell, list);
    }
    list.push(s.key);
  }

  private unfile(s: LoopSource): void {
    if (s.cell < 0) {
      const i = this.far.indexOf(s.key);
      if (i >= 0) this.far.splice(i, 1);
      return;
    }
    const list = this.cells.get(s.cell);
    if (!list) return;
    const i = list.indexOf(s.key);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) this.cells.delete(s.cell);
  }
}

/**
 * The part of the mixer the world's own sources use. It is written out rather than imported as a
 * class so that a node test can drive every source below with a few lines of bookkeeping, and so
 * that nothing here can reach into the mixer's own state.
 */
export interface LoopHost {
  readonly grid: EmitterGrid;
  readonly bank: { available: boolean; sources: SoundSources | null; template(id: string): unknown };
  play(id: string, options?: { x?: number; y?: number; z?: number; space?: SoundSpace; loop?: boolean; gain?: number; pitch?: number }): number;
  loop(id: string, options?: { x?: number; y?: number; z?: number; space?: SoundSpace; gain?: number; pitch?: number }): number;
  stop(key: number, fade?: number): void;
  move(key: number, x: number, y: number, z: number): void;
  setGain(key: number, gain: number): void;
  setSpace(key: number, space: SoundSpace): void;
  isPlaying(key: number): boolean;
  prepare(ids: Iterable<string>): void;
}

export interface WorldSourceTune {
  /** INVENTED: the most placed emitters one planet may hold at once, so a town cannot fill the mixer. */
  cap: number;
  /** INVENTED: how many sources look for the room they stand in on one grid pass. */
  spaceTries: number;
  /** INVENTED: passes a source keeps looking for its room before it settles for the open world. */
  spaceGiveUp: number;
}

/**
 * INVENTED, all three. The busiest planet places 919 of them (108 objects put down for their sound
 * alone and 811 props that hum), so the cap is above that and low enough that a pack with a mistake
 * in it cannot swamp the voice pools; a source over the cap costs nothing but its record, since the
 * grid looks at them four times a second and only the near ones ever hold a voice. Looking for the room a source stands in costs one walk of the streamed
 * buildings, so it is done for a few near sources a pass and given up on after ten seconds.
 */
export const WORLD_SOURCE_TUNE: WorldSourceTune = { cap: 1024, spaceTries: 4, spaceGiveUp: 40 };

/** One looping sound the world holds: a placed sound object, or a particle effect's own loop. */
interface WorldLoop {
  sound: string;
  /** The mixer's key, or 0 while the bank has nothing to start it from. */
  key: number;
  x: number;
  y: number;
  z: number;
  /** The building and cell it sits in; -1 is the open world. */
  readonly space: SoundSpace;
  /**
   * The snapshot put it inside a building, so the building under it is looked for whenever it is
   * within earshot. It stays true for the life of the source: the game numbers a building by the
   * object the streamer made for it, and the streamer makes a new one every time the tile comes
   * back, so an answer taken once and kept would name a building that no longer exists after the
   * first walk out of the town and back.
   */
  pending: boolean;
  /** It has been in a room at least once, so it is no longer looking for its first answer. */
  found: boolean;
  tries: number;
}

/**
 * The world's looping sources. A source is added once, when the planet loads or when an effect is
 * placed, and then simply exists: the grid decides whether it is close enough to be worth a slot,
 * the mixer keeps its clock while it is not, and nothing here runs per frame except one bounded
 * walk on a grid pass for the sources the snapshot put inside a building, which keep track of the
 * room they stand in.
 */
export class WorldEmitters {
  readonly tune: WorldSourceTune;
  /** The building and cell under a point, or null when nothing has been streamed there yet. Set by the world. */
  spaceAt: ((x: number, y: number, z: number) => SoundSpace | null) | null = null;
  /** Counters a tab that can hear nothing reads instead. */
  readonly counts = { placed: 0, attached: 0, refused: 0, missing: 0, overCap: 0, resolved: 0, gaveUp: 0 };
  /** The sounds the bank turned out not to hold at all, for the report; each is named once. */
  readonly missing = new Set<string>();

  private readonly host: LoopHost;
  private readonly placed: WorldLoop[] = [];
  private readonly attached = new Map<object, WorldLoop>();
  /** Sources still looking for their room, walked a few at a time. */
  private readonly pending: WorldLoop[] = [];
  private cursor = 0;
  /** Something here has no voice because the bank had nothing to start it from; `retry` clears it. */
  private silent = false;

  constructor(host: LoopHost, tune: WorldSourceTune = WORLD_SOURCE_TUNE) {
    this.host = host;
    this.tune = tune;
  }

  get size(): number {
    return this.placed.length + this.attached.size;
  }

  /** Every sound the sources name, so the bank can fetch them behind a loading screen. */
  prepare(sounds: Iterable<string>): void {
    this.host.prepare(sounds);
  }

  /**
   * One of the game's placed sound objects. `inside` says the snapshot put it in a building, so its
   * room is looked for whenever it is near enough for that building to have been streamed; anything
   * in the open is filed outside at once and never looked for again.
   *
   * False means only that the cap is reached and no further emitter will be taken, which is the one
   * answer a caller placing a whole planet's worth can act on. A source the mixer would not start
   * (the bank has still to land, the template is not in it, the game is stepping simulated seconds)
   * is taken all the same and kept silent: `retry` starts it when the bank is in, and dropping the
   * rest of the pack over one such source would lose a town's crowds to one missing sample.
   */
  addPlaced(sound: string, x: number, y: number, z: number, inside: boolean): boolean {
    if (this.placed.length >= this.tune.cap) {
      this.counts.overCap++;
      return false;
    }
    const loop = this.make(sound, x, y, z, inside);
    this.placed.push(loop);
    this.counts.placed++;
    return true;
  }

  /** A looping sound a particle effect's emitter names, which follows the effect while it plays. */
  attach(owner: object, sound: string, x: number, y: number, z: number, inside: boolean): void {
    if (this.attached.has(owner)) return;
    const loop = this.make(sound, x, y, z, inside);
    this.attached.set(owner, loop);
    this.counts.attached++;
  }

  moveAttached(owner: object, x: number, y: number, z: number): void {
    const loop = this.attached.get(owner);
    if (!loop) return;
    loop.x = x;
    loop.y = y;
    loop.z = z;
    if (loop.key) this.host.move(loop.key, x, y, z);
  }

  detach(owner: object): void {
    const loop = this.attached.get(owner);
    if (!loop) return;
    this.attached.delete(owner);
    this.drop(loop);
  }

  /**
   * On a grid pass: start anything the bank could not start before, and let a few near sources look
   * for the room they stand in. Called from the world's own update with the grid's pass flag, so it
   * costs nothing on the frames between passes.
   */
  update(pass: boolean): void {
    if (!pass || !this.pending.length) return;
    const tries = Math.max(1, this.tune.spaceTries);
    let looked = 0;
    // At most one turn round the ring a pass, and at most `spaceTries` real lookups in it: a source
    // out of earshot is skipped without spending a try, or a town with sixty sources inside it and
    // ten of them near would take a minute to ask about the ten.
    for (let scanned = this.pending.length; scanned > 0 && looked < tries && this.pending.length; scanned--) {
      if (this.cursor >= this.pending.length) this.cursor = 0;
      const loop = this.pending[this.cursor];
      // Only a source the listener can hear is worth looking for: the building it stands in is not
      // streamed until someone is near it, and a source out of earshot is not played either way.
      // One with no voice at all has not been started yet (the bank had nothing); it waits too,
      // rather than spending its tries where nothing could be found.
      if (!loop.key || !this.host.grid.isNear(loop.key)) {
        this.cursor++;
        continue;
      }
      looked++;
      const found = this.spaceAt?.(loop.x, loop.y, loop.z) ?? null;
      loop.tries++;
      if (found) {
        // Asked again for the life of the planet, not once: the number a building is known by
        // belongs to the object the streamer made for it, and walking out of the town and back
        // makes a new one. Only a changed answer is written down, so the usual pass costs the one
        // lookup and nothing else.
        if (loop.space.building !== found.building || loop.space.cell !== found.cell) {
          loop.space.building = found.building;
          loop.space.cell = found.cell;
          if (loop.key) this.host.setSpace(loop.key, loop.space);
          this.counts.resolved++;
        }
        loop.found = true;
        this.cursor++;
      } else if (loop.found) {
        // Its building has been streamed out from under it. The number it holds names an object
        // that is gone, so it belongs to no room the ear can be in either: it is left as it is and
        // asked again, which is what puts it back in its room when the tile comes back.
        this.cursor++;
      } else if (loop.tries >= this.tune.spaceGiveUp) {
        // Nothing under it after ten seconds within earshot and never anything since it was placed:
        // it is taken to stand in the open, which is what it sounds like anyway, and it is never
        // looked for again.
        this.settle(loop);
        this.counts.gaveUp++;
      } else this.cursor++;
    }
  }

  /**
   * Whether one of the game's own sound objects stands in this very room and is close enough to be
   * heard. The interior table and the snapshot often both give a room a sound -- the cantinas are
   * the plain case -- and playing the two together plays the same chatter over itself, so the
   * placed one, which is the more particular of the two, wins. Walked on a grid pass, not a frame.
   */
  hasEmitterIn(space: SoundSpace): boolean {
    if (space.building < 0) return false;
    for (const loop of this.placed) {
      // A source that has never found a room is still filed outside, so the building compare below
      // leaves it out on its own; nothing here asks whether it is still looking.
      if (!loop.key) continue;
      if (loop.space.building !== space.building) continue;
      // A room's own sound object, or one standing in the building at large (its cell unknown).
      if (loop.space.cell >= 0 && space.cell >= 0 && loop.space.cell !== space.cell) continue;
      if (this.host.grid.isNear(loop.key)) return true;
    }
    return false;
  }

  /**
   * A source the bank could not start when it was added (the pack had not landed yet): tried again.
   * The flag means a planet whose sources all started walks nothing at all here.
   */
  retry(): void {
    if (!this.silent || !this.host.bank.available) return;
    this.silent = false;
    for (const loop of this.placed) if (!loop.key && !this.missing.has(loop.sound)) this.start(loop);
    for (const loop of this.attached.values()) if (!loop.key && !this.missing.has(loop.sound)) this.start(loop);
  }

  /** The planet is going: every voice let go, every record dropped. */
  clear(): void {
    for (const loop of this.placed) this.drop(loop);
    for (const loop of this.attached.values()) this.drop(loop);
    this.placed.length = 0;
    this.attached.clear();
    this.pending.length = 0;
    this.cursor = 0;
    this.silent = false;
    this.missing.clear();
  }

  status(): Record<string, unknown> {
    let playing = 0;
    let near = 0;
    let silent = 0;
    for (const loop of this.placed) {
      if (!loop.key) {
        silent++;
        continue;
      }
      if (this.host.isPlaying(loop.key)) playing++;
      if (this.host.grid.isNear(loop.key)) near++;
    }
    let effects = 0;
    for (const loop of this.attached.values()) if (loop.key && this.host.grid.isNear(loop.key)) effects++;
    let looking = 0;
    let inRooms = 0;
    for (const loop of this.pending) {
      if (loop.found) inRooms++;
      else looking++;
    }
    return { placed: this.placed.length, placedNear: near, placedLive: playing, placedSilent: silent, effectLoops: this.attached.size, effectsNear: effects, inARoom: inRooms, lookingForARoom: looking, missingSounds: [...this.missing], counts: { ...this.counts } };
  }

  private make(sound: string, x: number, y: number, z: number, inside: boolean): WorldLoop {
    const loop: WorldLoop = { sound, key: 0, x, y, z, space: { building: OUTSIDE.building, cell: OUTSIDE.cell }, pending: inside, found: false, tries: 0 };
    this.start(loop);
    if (inside) this.pending.push(loop);
    return loop;
  }

  private start(loop: WorldLoop): void {
    if (!this.host.bank.available) {
      this.silent = true;
      return;
    }
    loop.key = this.host.loop(loop.sound, { x: loop.x, y: loop.y, z: loop.z, space: loop.space });
    if (loop.key) return;
    this.counts.refused++;
    // The bank is in and it still would not start. Either the bank does not hold that template at
    // all, which no amount of asking again will mend, or the mixer is running simulated seconds
    // (`__debug.advance` records rather than plays), which the next pass's retry gets.
    if (this.host.bank.template(loop.sound)) this.silent = true;
    else if (!this.missing.has(loop.sound)) {
      this.missing.add(loop.sound);
      this.counts.missing++;
    }
  }

  private settle(loop: WorldLoop): void {
    loop.pending = false;
    const i = this.pending.indexOf(loop);
    if (i >= 0) this.pending.splice(i, 1);
    if (this.cursor > i && i >= 0) this.cursor--;
  }

  private drop(loop: WorldLoop): void {
    if (loop.key) this.host.stop(loop.key, 0.1);
    loop.key = 0;
  }
}
