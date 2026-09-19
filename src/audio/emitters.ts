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
 * This wave has no sources in it: the grid, its cadence and its report exist, and the world's
 * emitters, particles and engines join later.
 */
import { audibleRadius, flatRadius, type DistanceTune, DISTANCE_TUNE, type SoundSpace } from './distance.ts';

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
