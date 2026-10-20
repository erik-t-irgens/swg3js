// The terrain's far grids found by number (`SwgTerrain`): a lookup on a frame's path -- the cached ground under the
// cascades' fast movers, the weather's own ground, a far lattice point a racing hull reads -- built the grid's string key
// on every call (`f:<x>,<z>,<size>,<res>`, four numbers turned into text and joined), which is garbage a frame for
// every caller that asks off the built blocks. The grids are filed here a second time beside the string-keyed map that
// owns them, by their tiling (a short list, walked) and their cell along each axis (a small integer pair packed into one
// small integer, which the engine keeps unboxed), so a lookup makes nothing. A corner whose cell does not fit, or a
// tiling that is not whole numbers, is not filed and answers `undefined`, which sends the caller to its string key;
// each entry keeps its corner and a lookup checks it, so two corners can never answer for each other.
//
// Pure: no three, nothing of the page; node loads it (`farGridIndex.test.ts`, and the perf test's frame).

/** Cells further than this from the origin along an axis are not filed (a far tile 64 m across reaches 65 km). */
const CELL_MOST = 1023;

interface Entry<T> {
  gx0: number;
  gz0: number;
  grid: T;
}

interface Tiling<T> {
  size: number;
  res: number;
  cells: Map<number, Entry<T>>;
  /**
   * Two corners met in one cell (corners not on one lattice, which one world's shift never makes): from then on the
   * tiling answers nothing and every lookup takes the string key, so a corner is never answered for by another.
   */
  mixed: boolean;
}

export class FarGridIndex<T> {
  private readonly tilings: Tiling<T>[] = [];

  /** The small integer a corner is filed under in a tiling of `size`, or -1 where it does not fit. */
  private static cell(gx0: number, gz0: number, size: number): number {
    const cx = Math.floor(gx0 / size);
    const cz = Math.floor(gz0 / size);
    if (cx < -CELL_MOST || cx > CELL_MOST || cz < -CELL_MOST || cz > CELL_MOST) return -1;
    return (cx + CELL_MOST) * (2 * CELL_MOST + 1) + (cz + CELL_MOST);
  }

  /** The tiling of `size` and `res`, made when `make` and it has none; null where they are not whole numbers above nought. */
  private tilingOf(size: number, res: number, make: boolean): Tiling<T> | null {
    const list = this.tilings;
    for (let i = 0; i < list.length; i++) if (list[i].size === size && list[i].res === res) return list[i];
    if (!make || !Number.isInteger(size) || !Number.isInteger(res) || size <= 0 || res <= 0) return null;
    const t: Tiling<T> = { size, res, cells: new Map(), mixed: false };
    list.push(t);
    return t;
  }

  /** Whether a grid of this corner and tiling is one the index files (else its string key is the only way to it). */
  files(gx0: number, gz0: number, size: number, res: number): boolean {
    return Number.isInteger(size) && Number.isInteger(res) && size > 0 && res > 0 && FarGridIndex.cell(gx0, gz0, size) >= 0;
  }

  /**
   * The grid at this corner and tiling: the grid, null where the index files such a corner and holds none, or undefined
   * where it does not file it (the caller asks its string key). Makes nothing.
   */
  get(gx0: number, gz0: number, size: number, res: number): T | null | undefined {
    const list = this.tilings;
    let t: Tiling<T> | null = null;
    for (let i = 0; i < list.length; i++) {
      if (list[i].size === size && list[i].res === res) {
        t = list[i];
        break;
      }
    }
    if (!(size > 0) || !(res > 0) || size !== Math.floor(size) || res !== Math.floor(res)) return undefined;
    const key = FarGridIndex.cell(gx0, gz0, size);
    if (key < 0) return undefined;
    if (!t) return null;
    if (t.mixed) return undefined;
    const e = t.cells.get(key);
    if (e === undefined) return null;
    return e.gx0 === gx0 && e.gz0 === gz0 ? e.grid : undefined;
  }

  /** File a grid made at this corner and tiling (one the index does not file is left to the string key alone). */
  set(gx0: number, gz0: number, size: number, res: number, grid: T): void {
    if (!this.files(gx0, gz0, size, res)) return;
    const t = this.tilingOf(size, res, true);
    if (!t) return;
    const key = FarGridIndex.cell(gx0, gz0, size);
    const e = t.cells.get(key);
    if (e !== undefined && (e.gx0 !== gx0 || e.gz0 !== gz0)) t.mixed = true;
    t.cells.set(key, { gx0, gz0, grid });
  }

  /** Take a grid out, as its string key is taken out. */
  delete(gx0: number, gz0: number, size: number, res: number): void {
    if (!this.files(gx0, gz0, size, res)) return;
    const t = this.tilingOf(size, res, false);
    if (!t) return;
    const key = FarGridIndex.cell(gx0, gz0, size);
    const e = t.cells.get(key);
    if (e && e.gx0 === gx0 && e.gz0 === gz0) t.cells.delete(key);
  }

  /** Forget every grid. */
  clear(): void {
    this.tilings.length = 0;
  }

  /** How many grids it holds, for the tests. */
  get size(): number {
    let n = 0;
    for (const t of this.tilings) n += t.cells.size;
    return n;
  }
}
