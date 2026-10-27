// The ground's paint (Map-maker II, DESIGN.md §2.5), the part the generator lays: a world's painted families (each with
// the alternate it forces, or the pole's own) and its painted colours, in cells on a lattice of the terrain's own frame,
// kept in tiles of 512 m by number. One object each thread holds alike -- the main thread's sampler and the terrain
// worker's, the worker's fed by messages (`message`, `take`) -- so a block made on either is the same ground.
//
// **Where it is laid** (`generator.ts`): inside the generator, after every snap of the families onto the client's 8 m
// pattern (so every shader filter, which decides most of the plants on half the worlds, reads the paint) and once more at
// the end; the colours after the last layer, by the client's own replace-with-amount (`replaceColour`). With `follow` off
// only the end lay is made, so every plant stays where the world's own families put it.
//
// **Cells of 4 m** (the owner's choice, 2026-10-26: "I want fine control"), the finest the ground's tile program draws: a
// 4 m tile takes its four corners' families. A cell is a corner of the lattice, at a multiple of the cell in the terrain's
// own frame, and a pole takes the cell nearest it, a tie going to the corner above, as the snap ties. The cell is a value
// a file carries (`cell`), so a file of 8 m cells reads and draws as one.
//
// **The snap reads the ground's own corners.** The snap lays every pole from its 8 m corner, and a corner the paint wrote
// would carry the paint onto the 4 m corner beside it that nobody painted (the tie goes up), drawing a painted 4 m line as
// an 8 m staircase. So the paint is taken off before every snap (`unlayFamilies`: each pole put back as it was, where
// nothing painted it again since) and laid after it: the final map is the ground's own snap with the paint over it.
//
// **Families of other worlds** (Map-maker II's third wave): a palette entry of another pack lays the family that world's
// group lent this one (`ShaderGroup.lend`, a fresh id, in the palette's order on every thread), which the caller's `lend`
// hands `resolve`; the paint itself only ever holds ids, so a grid laid on either thread is the same ground.
//
// **The plants** (Map-maker II's fourth wave, DESIGN.md §2.6): a third layer of cells, each a recipe's index and an amount,
// laid after the last layer over the generator's four flora maps (`floraInto`). A recipe says, for each of the four classes
// (the static flora's trees and plants, the radial flora's grass and far cards), keep, clear, remove one family, add a
// family at a density by the client's own test (the pole's coordinate hash's first float against the amount times the
// density, the next float the choice: painting the very family a world planted gives back its own planting), or thin
// (keep a share, by a roll of its own). The amount is laid bilinearly onto the poles from the four cells round each, a
// recipe at a time in its index's order, so a feathered edge is the engine's own feathered amount. A pole a road's flat
// part or a river's bed reached (the generator's `roadMap`) is never painted unless the recipe says `roads`. The same
// arithmetic answers one point (`floraPoint`): a real-elevation world's planter, whose world has no generator, and
// Mustafar's, whose trees are its baked map.
//
// Pure; imports only the generator, which names this file by a type alone (no cycle at run time), and the flora's own
// coordinate hash and generator. Rule for this file (node runs it with type stripping): every import with its `.ts`
// extension, no enum, no namespace, no constructor parameter properties. Shipped: the release carries it
// (`tools/launcher/pack.mjs`'s source list), and it imports nothing but shipped files.

import { childChoiceAt, childIndexOf, replaceColour, type ChunkData, type ShaderFamily, type ShaderGroup } from './generator.ts';
import { FastRandomGenerator, hashFloat, hashTuple } from './flora.ts';

/** A paint tile's width, metres, on every world: 64 m blocks eight to a side. */
export const PAINT_TILE = 512;
/** The cell a new file is painted at, metres (the owner's, Q4). */
export const PAINT_CELL = 4;
/** The cells a file may say: the finest the tile program draws, the client's own pattern, and a coarse one. */
export const PAINT_CELLS: readonly number[] = [4, 8, 16];
/** The most entries a palette holds: a family cell is one byte, nought the world's own. */
export const PAINT_PALETTE_MOST = 255;

/** A palette entry: a family by the pack it comes from and its name, and, with `child`, the alternate it forces. */
export interface PaintPaletteEntry {
  pack: string;
  name: string;
  child?: number;
}

/** The four classes a flora recipe paints, in the order its tables hold them: the static flora's two maps, then the radial flora's two. */
export const FLORA_CLASSES = ['trees', 'plants', 'grass', 'far'] as const;
export type FloraClass = (typeof FLORA_CLASSES)[number];
/** What a recipe does to a class: its op byte in the resolved tables. */
export const FLORA_OPS = { keep: 0, clear: 1, remove: 2, add: 3, thin: 4 } as const;
/** The most recipes a file holds: a flora cell names one in a byte, nought none. */
export const FLORA_RECIPES_MOST = 255;

/** A flora family by the pack whose table holds it and its name there. */
export interface FloraFamilyName {
  pack: string;
  name: string;
}

/** What a recipe does to one class: keep it (the default), clear it, take one family off, add one at a density, or thin it to a share. */
export type FloraClassSpec = 'keep' | 'clear' | { remove: FloraFamilyName } | { add: FloraFamilyName; density?: number } | { thin: number };

/** A flora recipe (an entry of the paint file's `recipes` row): a spec a class, and whether it paints a road's or a river's poles too. */
export interface FloraRecipe {
  trees?: FloraClassSpec;
  plants?: FloraClassSpec;
  grass?: FloraClassSpec;
  far?: FloraClassSpec;
  roads?: boolean;
}

/** A flora table as the recipes resolve against it: its families by id, each with its name and its own density. */
export interface FloraFamilies {
  readonly families: ReadonlyMap<number, { readonly name: string; readonly density: number }>;
}

/** One point's class as the recipes leave it (`floraPoint`): its family (nought none) and its choice byte. */
export interface FloraPointOut {
  family: number;
  choice: number;
}

/** A paint tile's number, a map key with nothing made (the height edits' pattern); -1 past 4095 tiles either way. */
export function paintTileNumber(tx: number, tz: number): number {
  if (tx < -4095 || tx > 4095 || tz < -4095 || tz > 4095) return -1;
  return (tx + 4096) * 8192 + (tz + 4096);
}

/** A tile's place from its number. */
export function paintTileOf(n: number): { tx: number; tz: number } {
  return { tx: Math.floor(n / 8192) - 4096, tz: (n % 8192) - 4096 };
}

/** What the paint wrote over since the last snap (`layFamilies` with `record`): each pole, what it held and what was laid. */
export interface PaintUnder {
  idx: Int32Array;
  was: Int32Array;
  val: Int32Array;
  count: number;
}

/**
 * A family with the world row's own weights for its alternates (`weights`), for picking an alternate as the world draws
 * it: the tiler's and the forced alternate's one rule. The family itself where no weights are named for it.
 */
export function weightedFamily(family: ShaderFamily | undefined, weights: readonly number[] | undefined): ShaderFamily | undefined {
  if (!family || !weights || !weights.length) return family;
  return { ...family, children: family.children.map((c, i) => ({ name: c.name, weight: Number.isFinite(weights[i]) && (weights[i] as number) >= 0 ? (weights[i] as number) : c.weight })) };
}

/**
 * The choice byte that forces a child: the smallest byte `childIndexOf` turns into that child (every child of non-zero
 * weight has one), or -1 for a child no byte reaches (out of range, or of weight nought).
 */
export function choiceForChild(family: ShaderFamily | undefined, child: number): number {
  if (!family || !(child >= 0)) return -1;
  for (let b = 0; b < 256; b++) if (childIndexOf(family, b) === child) return b;
  return -1;
}

/** The message a thread's paint is fed by (the worker's `paint`, and its `init`): copies, never the cells themselves. */
export interface GroundPaintMessage {
  cell: number;
  follow: boolean;
  familyOf: Int32Array;
  choiceOf: Int16Array;
  /** Tiles put (`cells`) or taken out (null), by number. */
  fam: { key: number; cells: Uint8Array | null }[];
  col: { key: number; cells: Uint8Array | null }[];
  /** The flora tiles put or taken out, and the recipes as resolved here (Map-maker II's fourth wave); absent on a message of before. */
  flo?: { key: number; cells: Uint8Array | null }[];
  recOp?: Uint8Array;
  recFam?: Int32Array;
  recNum?: Float64Array;
  recRoads?: Uint8Array;
  /** Every tile let go first: the message carries the whole paint. */
  reset: boolean;
}

/** The ground's paint: its cells by tile, its palette resolved to this world's family ids. */
export class GroundPaint {
  /** The cell, metres, and how many cells a tile has a side. */
  readonly cell: number;
  readonly n: number;
  /** Whether the world's plants follow the paint (the world row's `follow`): laid after every snap, or only at the end. */
  follow = true;
  /** Family tiles: one byte a cell, the palette index (nought: the world's own), row by row along z. */
  readonly fam = new Map<number, Uint8Array>();
  /** Colour tiles: four bytes a cell, red, green, blue and how much (nought: the world's own colour). */
  readonly col = new Map<number, Uint8Array>();
  /** Flora tiles (the fourth wave): two bytes a cell, the recipe's index (nought: none) and how much of it (0 to 255). */
  readonly flo = new Map<number, Uint8Array>();
  /**
   * The recipes resolved against the world's flora tables, four a recipe (trees, plants, grass, far cards): each class's op
   * (`FLORA_OPS`), its family's id, its number (an add's density, a thin's kept share), and whether the recipe paints a
   * road's poles. Index 0 is nobody's: a cell of recipe nought paints nothing.
   */
  readonly recOp = new Uint8Array((FLORA_RECIPES_MOST + 1) * 4);
  readonly recFam = new Int32Array((FLORA_RECIPES_MOST + 1) * 4);
  readonly recNum = new Float64Array((FLORA_RECIPES_MOST + 1) * 4);
  readonly recRoads = new Uint8Array(FLORA_RECIPES_MOST + 1);
  /** Each palette index's family id in this world's group (nought: nothing laid, the world's own shows). */
  readonly familyOf = new Int32Array(PAINT_PALETTE_MOST + 1);
  /** The choice byte each palette index forces, or -1 for the pole's own (`childChoiceAt`). */
  readonly choiceOf = new Int16Array(PAINT_PALETTE_MOST + 1).fill(-1);
  /** The painted tiles' bounds, in tiles; worked out again when a tile is put or taken out. */
  private tx0 = 1;
  private tx1 = 0;
  private tz0 = 1;
  private tz1 = 0;
  /** A grid's columns' and rows' cells, kept: a lay makes nothing past its first growth. */
  private colCell = new Int32Array(64);
  private rowCell = new Int32Array(64);
  private colFrac = new Float64Array(64);
  private rowFrac = new Float64Array(64);
  /** The last tile looked up, kept so a run of lookups in one tile builds nothing. */
  private lastKey = -2;
  private lastTile: Uint8Array | undefined = undefined;

  constructor(cell = PAINT_CELL) {
    this.cell = PAINT_CELLS.includes(cell) ? cell : PAINT_CELL;
    this.n = PAINT_TILE / this.cell;
  }

  /** Whether nothing is painted. */
  get empty(): boolean {
    return this.fam.size === 0 && this.col.size === 0 && this.flo.size === 0;
  }

  /** A flora tile put (or taken out: null), by its place. */
  setFloraTile(tx: number, tz: number, cells: Uint8Array | null): void {
    const key = paintTileNumber(tx, tz);
    if (key < 0) return;
    if (cells) this.flo.set(key, cells);
    else this.flo.delete(key);
    this.boundsAgain();
  }

  /** A flora tile by its place, made empty where there is none (the brush's). */
  floraTile(tx: number, tz: number, make: boolean): Uint8Array | null {
    const key = paintTileNumber(tx, tz);
    if (key < 0) return null;
    let t = this.flo.get(key);
    if (!t && make) {
      t = new Uint8Array(this.n * this.n * 2);
      this.flo.set(key, t);
      this.boundsAgain();
    }
    return t ?? null;
  }

  /** A family tile put (or taken out: null), by its place. */
  setFamilyTile(tx: number, tz: number, cells: Uint8Array | null): void {
    const key = paintTileNumber(tx, tz);
    if (key < 0) return;
    if (cells) this.fam.set(key, cells);
    else this.fam.delete(key);
    this.boundsAgain();
  }

  /** A colour tile put (or taken out: null), by its place. */
  setColourTile(tx: number, tz: number, cells: Uint8Array | null): void {
    const key = paintTileNumber(tx, tz);
    if (key < 0) return;
    if (cells) this.col.set(key, cells);
    else this.col.delete(key);
    this.boundsAgain();
  }

  /** A family tile by its place, made empty where there is none (the brush's). */
  familyTile(tx: number, tz: number, make: boolean): Uint8Array | null {
    const key = paintTileNumber(tx, tz);
    if (key < 0) return null;
    let t = this.fam.get(key);
    if (!t && make) {
      t = new Uint8Array(this.n * this.n);
      this.fam.set(key, t);
      this.boundsAgain();
    }
    return t ?? null;
  }

  /** A colour tile by its place, made empty where there is none (the brush's). */
  colourTile(tx: number, tz: number, make: boolean): Uint8Array | null {
    const key = paintTileNumber(tx, tz);
    if (key < 0) return null;
    let t = this.col.get(key);
    if (!t && make) {
      t = new Uint8Array(this.n * this.n * 4);
      this.col.set(key, t);
      this.boundsAgain();
    }
    return t ?? null;
  }

  /** The painted tiles' bounds worked out again, and the lookup's memory dropped. */
  boundsAgain(): void {
    this.lastKey = -2;
    this.lastTile = undefined;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const m of [this.fam, this.col, this.flo]) {
      for (const key of m.keys()) {
        const tx = Math.floor(key / 8192) - 4096;
        const tz = (key % 8192) - 4096;
        if (tx < x0) x0 = tx;
        if (tx > x1) x1 = tx;
        if (tz < z0) z0 = tz;
        if (tz > z1) z1 = tz;
      }
    }
    if (x0 > x1) {
      this.tx0 = 1;
      this.tx1 = 0;
      this.tz0 = 1;
      this.tz1 = 0;
      return;
    }
    this.tx0 = x0;
    this.tx1 = x1;
    this.tz0 = z0;
    this.tz1 = z1;
  }

  /**
   * The palette resolved to this world's families: each entry of `pack` (this world's own, or the pack a real-elevation
   * world lends from) by its name in `group`, the alternate it forces by `weights` (the world row's, keyed by family id)
   * where it names one. An entry of another pack (Map-maker II's third wave) is the family `lend` answers for it -- its id
   * in `group`, where that world's family was lent in -- or lays nothing, said in the words `lend` answers; with no `lend`
   * it lays nothing. Answers the entries it could not resolve, in words.
   */
  resolve(entries: readonly PaintPaletteEntry[], group: ShaderGroup, pack: string, weights?: ReadonlyMap<number, readonly number[]>, lend?: (pack: string, name: string) => number | string): string[] {
    const missing: string[] = [];
    this.familyOf.fill(0);
    this.choiceOf.fill(-1);
    for (let i = 0; i < entries.length && i < PAINT_PALETTE_MOST; i++) {
      const e = entries[i];
      const at = i + 1;
      let f: ShaderFamily | undefined;
      if (e.pack !== pack) {
        const id = lend ? lend(e.pack, e.name) : "another world's family, and none is lent here";
        if (typeof id === 'string') {
          missing.push(`${e.pack}:${e.name} (${id})`);
          continue;
        }
        f = group.families.get(id);
      } else f = group.byName(e.name);
      if (!f) {
        missing.push(`${e.pack}:${e.name} (no family of that name)`);
        continue;
      }
      this.familyOf[at] = f.id;
      if (e.child !== undefined) {
        const b = choiceForChild(weightedFamily(f, weights?.get(f.id)), e.child);
        if (b < 0) missing.push(`${e.pack}:${e.name} alternate ${e.child} (no choice reaches it: it lays its family with the pole's own alternate)`);
        else this.choiceOf[at] = b;
      }
    }
    return missing;
  }

  /** Whether a rectangle of the terrain's frame meets a painted tile, a cell of margin round it. */
  touches(x0: number, z0: number, x1: number, z1: number): boolean {
    if (this.tx0 > this.tx1) return false;
    const m = this.cell;
    return !(x1 < this.tx0 * PAINT_TILE - m || x0 > (this.tx1 + 1) * PAINT_TILE + m || z1 < this.tz0 * PAINT_TILE - m || z0 > (this.tz1 + 1) * PAINT_TILE + m);
  }

  /** The tile of a map at a tile place, by number, the last one kept. */
  private tileAt(map: Map<number, Uint8Array>, tx: number, tz: number): Uint8Array | undefined {
    const key = paintTileNumber(tx, tz);
    if (key === this.lastKey && map === this.lastMap) return this.lastTile;
    this.lastKey = key;
    this.lastMap = map;
    this.lastTile = key < 0 ? undefined : map.get(key);
    return this.lastTile;
  }
  private lastMap: Map<number, Uint8Array> | null = null;

  /** The palette index at a cell (its place in cells), nought for none. */
  familyCell(cx: number, cz: number): number {
    const n = this.n;
    const tx = Math.floor(cx / n);
    const tz = Math.floor(cz / n);
    const t = this.tileAt(this.fam, tx, tz);
    return t ? t[(cz - tz * n) * n + (cx - tx * n)] : 0;
  }

  /** The cell a coordinate of the terrain's frame takes: its nearest corner, a tie going to the corner above. */
  cellOf(v: number): number {
    return Math.floor(v / this.cell + 0.5);
  }

  /** The family painted at a point of the terrain's frame (its nearest cell's), nought where none is. */
  familyAtRaw(x: number, z: number): number {
    if (this.fam.size === 0) return 0;
    return this.familyOf[this.familyCell(this.cellOf(x), this.cellOf(z))];
  }

  /** The palette index painted at a point of the terrain's frame, nought where none is. */
  entryAtRaw(x: number, z: number): number {
    if (this.fam.size === 0) return 0;
    return this.familyCell(this.cellOf(x), this.cellOf(z));
  }

  /** The choice byte at a point the paint lays a family on: the one its entry forces, else the pole's own. */
  choiceAtRaw(x: number, z: number): number {
    const e = this.entryAtRaw(x, z);
    const c = e ? this.choiceOf[e] : -1;
    return c >= 0 ? c : childChoiceAt(x, z);
  }

  /**
   * The families laid onto a grid the generator runs (its families and choices): every pole whose nearest cell is painted
   * with an entry this world resolved takes that family, and the alternate the entry forces or the pole's own. With
   * `record`, what each pole held is kept (`d.paintUnder`) so the next snap reads the ground's own corners.
   */
  layFamilies(d: ChunkData, record: boolean): void {
    if (this.fam.size === 0) return;
    const n = d.numberOfPoles;
    const step = d.distanceBetweenPoles;
    const sx = d.startX;
    const sz = d.startZ;
    const span = (n - 1) * step;
    if (!this.touches(Math.min(sx, sx + span), Math.min(sz, sz + span), Math.max(sx, sx + span), Math.max(sz, sz + span))) return;
    let under: PaintUnder | null = null;
    if (record) {
      under = d.paintUnder;
      if (!under || under.idx.length < n * n) {
        under = { idx: new Int32Array(n * n), was: new Int32Array(n * n), val: new Int32Array(n * n), count: 0 };
        d.paintUnder = under;
      }
    }
    this.cellsAlong(sx, step, n, false);
    this.cellsAlong(sz, step, n, true);
    const map = d.shaderMap;
    const kids = d.shaderChild;
    const cc = this.colCell;
    const rc = this.rowCell;
    for (let z = 0; z < n; z++) {
      const cz = rc[z];
      const wz = sz + z * step;
      for (let x = 0; x < n; x++) {
        const e = this.familyCell(cc[x], cz);
        if (e === 0) continue;
        const fam = this.familyOf[e];
        if (fam === 0) continue;
        const i = z * n + x;
        if (under) {
          const k = under.count++;
          under.idx[k] = i;
          under.was[k] = map[i];
          under.val[k] = fam;
        }
        map[i] = fam;
        const c = this.choiceOf[e];
        kids[i] = c >= 0 ? c : childChoiceAt(sx + x * step, wz);
      }
    }
  }

  /**
   * The families the paint laid since the last snap taken back off, each pole put back as it was unless something painted
   * it since (it no longer holds the paint's family): what the snap then lays on the pattern is the ground's own.
   */
  unlayFamilies(d: ChunkData): void {
    const u = d.paintUnder;
    if (!u || u.count === 0) return;
    const map = d.shaderMap;
    for (let k = u.count - 1; k >= 0; k--) {
      const i = u.idx[k];
      if (map[i] === u.val[k]) map[i] = u.was[k];
    }
    u.count = 0;
  }

  /**
   * The painted colours laid over a grid the generator ran (`layColoursOn`), the colour map as it stood before them kept
   * beside it (`d.colorUnpainted`) wherever they reach the grid: a stroke's preview lays the paint over that copy, since
   * the client's replace-with-amount laid twice over a colour already painted is not the colour painted once.
   */
  layColours(d: ChunkData): void {
    d.colorUnpainted = null;
    if (this.col.size === 0) return;
    const n = d.numberOfPoles;
    const span = (n - 1) * d.distanceBetweenPoles;
    const sx = d.startX;
    const sz = d.startZ;
    if (!this.touches(Math.min(sx, sx + span), Math.min(sz, sz + span), Math.max(sx, sx + span), Math.max(sz, sz + span))) return;
    // Kept only where a colour was really laid, so a grid no colour reaches is the generator's to the array.
    const before = d.colorMap.slice();
    if (this.layColoursOn(sx, sz, n, d.distanceBetweenPoles, d.colorMap) > 0) d.colorUnpainted = before;
  }

  /**
   * The painted colours laid over a grid's colour map: each pole takes its four nearest cells bilinearly, their amounts
   * weighed with them (a cell of nought adds nothing), and the colour they come to laid over the pole's own by the
   * client's replace-with-amount at that amount. Answers how many poles it laid.
   */
  layColoursOn(sx: number, sz: number, n: number, step: number, colors: Uint8Array): number {
    if (this.col.size === 0) return 0;
    const span = (n - 1) * step;
    if (!this.touches(Math.min(sx, sx + span), Math.min(sz, sz + span), Math.max(sx, sx + span), Math.max(sz, sz + span))) return 0;
    this.cellsBelow(sx, step, n, false);
    this.cellsBelow(sz, step, n, true);
    const cc = this.colCell;
    const rc = this.rowCell;
    const cf = this.colFrac;
    const rf = this.rowFrac;
    const q = PAINT_SAMPLE;
    let laid = 0;
    for (let z = 0; z < n; z++) {
      const cz = rc[z];
      const fz = rf[z];
      for (let x = 0; x < n; x++) {
        if (!this.colourBetween(cc[x], cz, cf[x], fz, q)) continue;
        replaceColour(colors, (z * n + x) * 3, q.r, q.g, q.b, q.amount);
        laid++;
      }
    }
    return laid;
  }

  /**
   * The painted colour over a point of the terrain's frame laid on `rgb` (three bytes, written in place) by the same
   * arithmetic a grid's poles take: what a real-elevation world's samples, which no generator makes, are painted by.
   * Answers whether any paint reached it.
   */
  colourAtRaw(x: number, z: number, rgb: Uint8Array): boolean {
    if (this.col.size === 0) return false;
    const c = this.cell;
    const fx = x / c;
    const fz = z / c;
    const cx = Math.floor(fx);
    const cz = Math.floor(fz);
    const q = PAINT_SAMPLE;
    if (!this.colourBetween(cx, cz, fx - cx, fz - cz, q)) return false;
    replaceColour(rgb, 0, q.r, q.g, q.b, q.amount);
    return true;
  }

  /** The colour cell at a cell place, into `q` (its bytes and amount), false where none is painted. */
  private colourCell(cx: number, cz: number, at: number): number {
    const n = this.n;
    const tx = Math.floor(cx / n);
    const tz = Math.floor(cz / n);
    const t = this.tileAt(this.col, tx, tz);
    if (!t) return -1;
    const k = ((cz - tz * n) * n + (cx - tx * n)) * 4;
    if (t[k + 3] === 0) return -1;
    COL_BYTES[at * 4] = t[k];
    COL_BYTES[at * 4 + 1] = t[k + 1];
    COL_BYTES[at * 4 + 2] = t[k + 2];
    COL_BYTES[at * 4 + 3] = t[k + 3];
    return at;
  }

  /**
   * The four cells round a place (`cx`, `cz` the lower corner, `fx`, `fz` the share toward the next) taken bilinearly into
   * `q`: the amount their weights come to, and the colour as their amounts weigh it, rounded to bytes. False where none
   * of the four is painted.
   */
  private colourBetween(cx: number, cz: number, fx: number, fz: number, q: PaintSample): boolean {
    let wa = 0;
    let wr = 0;
    let wg = 0;
    let wb = 0;
    for (let k = 0; k < 4; k++) {
      const w = (k & 1 ? fx : 1 - fx) * (k & 2 ? fz : 1 - fz);
      if (w <= 0) continue;
      if (this.colourCell(cx + (k & 1), cz + (k >> 1), k) < 0) continue;
      const a = COL_BYTES[k * 4 + 3] * w;
      wa += a;
      wr += a * COL_BYTES[k * 4];
      wg += a * COL_BYTES[k * 4 + 1];
      wb += a * COL_BYTES[k * 4 + 2];
    }
    if (!(wa > 0)) return false;
    q.r = Math.round(wr / wa);
    q.g = Math.round(wg / wa);
    q.b = Math.round(wb / wa);
    q.amount = wa / 255;
    return true;
  }

  /** Each column's (or row's) nearest cell along an axis, into the kept arrays. */
  private cellsAlong(start: number, step: number, n: number, rows: boolean): void {
    this.grow(n);
    const out = rows ? this.rowCell : this.colCell;
    for (let i = 0; i < n; i++) out[i] = this.cellOf(start + i * step);
  }

  /** Each column's (or row's) lower cell and its share toward the next, into the kept arrays. */
  private cellsBelow(start: number, step: number, n: number, rows: boolean): void {
    this.grow(n);
    const out = rows ? this.rowCell : this.colCell;
    const frac = rows ? this.rowFrac : this.colFrac;
    const c = this.cell;
    for (let i = 0; i < n; i++) {
      const v = (start + i * step) / c;
      const f = Math.floor(v);
      out[i] = f;
      frac[i] = v - f;
    }
  }

  private grow(n: number): void {
    if (this.colCell.length >= n) return;
    this.colCell = new Int32Array(n);
    this.rowCell = new Int32Array(n);
    this.colFrac = new Float64Array(n);
    this.rowFrac = new Float64Array(n);
  }

  /**
   * A grid's families, choices and colours with the paint laid over them in place (the editor's preview over a cached
   * block, laid from the block as the stroke found it): the end lay of the generator, the same arithmetic.
   */
  layGrid(sx: number, sz: number, n: number, step: number, shaders: Int32Array, children: Uint8Array, colors: Uint8Array | null): void {
    if (this.fam.size) {
      this.cellsAlong(sx, step, n, false);
      this.cellsAlong(sz, step, n, true);
      const cc = this.colCell;
      const rc = this.rowCell;
      for (let z = 0; z < n; z++) {
        const cz = rc[z];
        for (let x = 0; x < n; x++) {
          const e = this.familyCell(cc[x], cz);
          if (e === 0) continue;
          const fam = this.familyOf[e];
          if (fam === 0) continue;
          const i = z * n + x;
          shaders[i] = fam;
          const c = this.choiceOf[e];
          children[i] = c >= 0 ? c : childChoiceAt(sx + x * step, sz + z * step);
        }
      }
    }
    if (colors) this.layColoursOn(sx, sz, n, step, colors);
  }

  // ---- the plants (Map-maker II's fourth wave) ----------------------------------------------------------------------

  /**
   * The recipes resolved against the world's flora tables (`flora` the static flora's group, the trees' and the plants';
   * `radial` the radial group, the grass's and the far cards'): each class's op, its family by name in the table of `pack`
   * (this world's own; on a real-elevation world the pack its ground is lent from), an add's density (the family's own
   * where the recipe names none) and a thin's share. A class naming a family of another pack, one its table has not got or
   * one past a byte keeps the class as it is and is answered in words.
   */
  resolveRecipes(entries: readonly FloraRecipe[], flora: FloraFamilies | null, radial: FloraFamilies | null, pack: string): string[] {
    const missing: string[] = [];
    this.recOp.fill(0);
    this.recFam.fill(0);
    this.recNum.fill(0);
    this.recRoads.fill(0);
    for (let i = 0; i < entries.length && i < FLORA_RECIPES_MOST; i++) {
      const r = entries[i];
      const at = i + 1;
      this.recRoads[at] = r.roads === true ? 1 : 0;
      for (let c = 0; c < 4; c++) {
        const spec = r[FLORA_CLASSES[c]];
        const k = at * 4 + c;
        if (spec === undefined || spec === 'keep') continue;
        if (spec === 'clear') {
          this.recOp[k] = FLORA_OPS.clear;
          continue;
        }
        if ('thin' in spec) {
          this.recOp[k] = FLORA_OPS.thin;
          this.recNum[k] = Math.min(1, Math.max(0, spec.thin));
          continue;
        }
        const named = 'add' in spec ? spec.add : spec.remove;
        const table = c < 2 ? flora : radial;
        const id = familyIdOf(table, named, pack);
        if (typeof id === 'string') {
          missing.push(`recipe ${at} ${FLORA_CLASSES[c]}: ${named.pack}:${named.name} (${id})`);
          continue;
        }
        this.recFam[k] = id;
        if ('add' in spec) {
          this.recOp[k] = FLORA_OPS.add;
          const own = table!.families.get(id)!.density;
          this.recNum[k] = spec.density !== undefined && Number.isFinite(spec.density) ? Math.max(0, spec.density) : own;
        } else this.recOp[k] = FLORA_OPS.remove;
      }
    }
    return missing;
  }

  /**
   * The recipes laid over the four flora maps of a grid the generator ran, after its last layer: each pole takes the
   * recipes of the four cells round it, each by the amount its cells' weights come to, in its index's order; a pole a
   * road or a river marked (`roadMap`) only by a recipe that says `roads`. Nothing where no flora tile reaches the grid.
   */
  floraInto(d: ChunkData): void {
    if (this.flo.size === 0) return;
    const n = d.numberOfPoles;
    const step = d.distanceBetweenPoles;
    const sx = d.startX;
    const sz = d.startZ;
    const span = (n - 1) * step;
    if (!this.floTouches(Math.min(sx, sx + span), Math.min(sz, sz + span), Math.max(sx, sx + span), Math.max(sz, sz + span))) return;
    this.cellsBelow(sx, step, n, false);
    this.cellsBelow(sz, step, n, true);
    const cc = this.colCell;
    const rc = this.rowCell;
    const cf = this.colFrac;
    const rf = this.rowFrac;
    const roads = d.roadMap;
    const maps = FLORA_MAPS;
    maps[0] = d.floraCollidable;
    maps[1] = d.floraNonCollidable;
    maps[2] = d.radialNear;
    maps[3] = d.radialFar;
    for (let z = 0; z < n; z++) {
      const cz = rc[z];
      const fz = rf[z];
      const wz = sz + z * step;
      for (let x = 0; x < n; x++) {
        const k = this.floraBetween(cc[x], cz, cf[x], fz);
        if (k === 0) continue;
        const i = z * n + x;
        const road = roads !== undefined && roads[i] !== 0;
        const wx = sx + x * step;
        for (let j = 0; j < k; j++) {
          const r = FLO_R[j];
          if (road && this.recRoads[r] === 0) continue;
          const a = FLO_A[j];
          for (let c = 0; c < 4; c++) {
            const op = this.recOp[r * 4 + c];
            if (op !== 0) this.floraClass(op, r * 4 + c, a, wx, wz, c, maps[c]!, i * 2);
          }
        }
      }
    }
    maps[0] = maps[1] = maps[2] = maps[3] = null;
  }

  /**
   * The recipes laid over one point's class (a real-elevation world's planter, whose world runs no generator; Mustafar's
   * trees, which come from its baked map): `family` and `choice` (a byte) as the world has them there, and whether a road
   * reaches it, the recipes of the four cells round the point by their amounts, by the very arithmetic a grid's poles take.
   * Answers into `out`.
   */
  floraPoint(c: number, x: number, z: number, family: number, choice: number, road: boolean, out: FloraPointOut): FloraPointOut {
    const pair = FLORA_PAIR;
    pair[0] = family;
    pair[1] = choice;
    if (this.flo.size !== 0 && c >= 0 && c < 4) {
      const cell = this.cell;
      const fx = x / cell;
      const fz = z / cell;
      const cx = Math.floor(fx);
      const cz = Math.floor(fz);
      const k = this.floraBetween(cx, cz, fx - cx, fz - cz);
      for (let j = 0; j < k; j++) {
        const r = FLO_R[j];
        if (road && this.recRoads[r] === 0) continue;
        const op = this.recOp[r * 4 + c];
        if (op !== 0) this.floraClass(op, r * 4 + c, FLO_A[j], x, z, c, pair, 0);
      }
    }
    out.family = pair[0];
    out.choice = pair[1];
    return out;
  }

  /** Whether any flora cell inside a rectangle of the terrain's frame is painted (an amount above nought). */
  floraIn(x0: number, z0: number, x1: number, z1: number): boolean {
    if (this.flo.size === 0) return false;
    const cell = this.cell;
    const n = this.n;
    for (let cz = Math.floor(Math.min(z0, z1) / cell); cz <= Math.ceil(Math.max(z0, z1) / cell); cz++) {
      const tz = Math.floor(cz / n);
      for (let cx = Math.floor(Math.min(x0, x1) / cell); cx <= Math.ceil(Math.max(x0, x1) / cell); cx++) {
        const tx = Math.floor(cx / n);
        const t = this.tileAt(this.flo, tx, tz);
        if (!t) continue;
        const o = ((cz - tz * n) * n + (cx - tx * n)) * 2;
        if (t[o] !== 0 && t[o + 1] !== 0) return true;
      }
    }
    return false;
  }

  /**
   * Whether a recipe that does anything to the trees or the plants reaches a point of the terrain's frame (a cell round it
   * painted with one, at a weight above nought): where a real-elevation world's planter owns the ground, so the procedural
   * props it stood before the paint are left out there and kept everywhere else (`World.chunkProps`). Allocates nothing.
   */
  floraOwnsStatic(x: number, z: number): boolean {
    if (this.flo.size === 0) return false;
    const cell = this.cell;
    const fx = x / cell;
    const fz = z / cell;
    const cx = Math.floor(fx);
    const cz = Math.floor(fz);
    const k = this.floraBetween(cx, cz, fx - cx, fz - cz);
    for (let j = 0; j < k; j++) {
      const r = FLO_R[j];
      if (this.recOp[r * 4] !== 0 || this.recOp[r * 4 + 1] !== 0) return true;
    }
    return false;
  }

  /** Whether a rectangle of the terrain's frame meets a painted flora tile, a cell of margin round it (the public `floTouches`). */
  floraTouches(x0: number, z0: number, x1: number, z1: number): boolean {
    return this.flo.size !== 0 && this.floTouches(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));
  }

  /** Whether any resolved recipe does anything to a class (0 trees, 1 plants, 2 grass, 3 far cards). */
  recipesTouch(c: number): boolean {
    for (let r = 1; r <= FLORA_RECIPES_MOST; r++) if (this.recOp[r * 4 + c] !== 0) return true;
    return false;
  }

  /** Whether a rectangle of the terrain's frame meets a painted flora tile, a cell of margin round it. */
  private floTouches(x0: number, z0: number, x1: number, z1: number): boolean {
    if (!this.touches(x0, z0, x1, z1)) return false;
    const m = this.cell;
    for (let tz = Math.floor((z0 - m) / PAINT_TILE); tz <= Math.floor((z1 + m) / PAINT_TILE); tz++) {
      for (let tx = Math.floor((x0 - m) / PAINT_TILE); tx <= Math.floor((x1 + m) / PAINT_TILE); tx++) if (this.tileAt(this.flo, tx, tz)) return true;
    }
    return false;
  }

  /**
   * The four flora cells round a place (`cx`, `cz` the lower corner, `fx`, `fz` the share toward the next) gathered into
   * the kept lists, a recipe at a time: each distinct recipe and the amount its cells' bilinear weights come to (each cell's
   * amount over 255), in the recipes' index order. Answers how many.
   */
  private floraBetween(cx: number, cz: number, fx: number, fz: number): number {
    const n = this.n;
    let k = 0;
    for (let q = 0; q < 4; q++) {
      const w = (q & 1 ? fx : 1 - fx) * (q & 2 ? fz : 1 - fz);
      if (!(w > 0)) continue;
      const x = cx + (q & 1);
      const z = cz + (q >> 1);
      const tx = Math.floor(x / n);
      const tz = Math.floor(z / n);
      const t = this.tileAt(this.flo, tx, tz);
      if (!t) continue;
      const o = ((z - tz * n) * n + (x - tx * n)) * 2;
      const r = t[o];
      const a = t[o + 1];
      if (r === 0 || a === 0) continue;
      let j = 0;
      while (j < k && FLO_R[j] !== r) j++;
      if (j === k) {
        // Kept in the recipes' order as they come (at most four).
        let at = k++;
        while (at > 0 && FLO_R[at - 1] > r) {
          FLO_R[at] = FLO_R[at - 1];
          FLO_A[at] = FLO_A[at - 1];
          at--;
        }
        FLO_R[at] = r;
        FLO_A[at] = (w * a) / 255;
      } else FLO_A[j] += (w * a) / 255;
    }
    return k;
  }

  /**
   * One class of one recipe at one pole (a map's two bytes at `o`), at `amount`: a clear and a remove where the pole's own
   * roll falls under the amount, an add by the client's own test (`AffectorFloraStatic`, `AffectorFloraDynamic`: the
   * coordinate hash's first float against the amount times the density, the next float the choice), a thin where the roll
   * falls under the amount times the share it takes away. The roll is the pole's coordinate hash salted by the class, so
   * a feathered edge clears, removes and thins by a pattern of its own beside the adds'.
   */
  private floraClass(op: number, k: number, amount: number, wx: number, wz: number, c: number, map: Uint8Array, o: number): void {
    if (op === FLORA_OPS.add) {
      const rng = FLORA_RNG;
      rng.setSeed(hashTuple(wx, wz));
      if (rng.randomFloat() > amount * this.recNum[k]) return;
      map[o] = this.recFam[k];
      map[o + 1] = Math.floor(rng.randomFloat() * 255);
      return;
    }
    if (map[o] === 0) return;
    const roll = hashFloat((hashTuple(wx, wz) ^ FLORA_SALT[c]) >>> 0);
    if (op === FLORA_OPS.clear) {
      if (roll >= amount) return;
    } else if (op === FLORA_OPS.remove) {
      if (map[o] !== this.recFam[k] || roll >= amount) return;
    } else if (op === FLORA_OPS.thin) {
      if (roll >= amount * (1 - this.recNum[k])) return;
    } else return;
    map[o] = 0;
    map[o + 1] = 0;
  }

  /**
   * The message another thread's paint is fed by: the cell, `follow`, the palette and the recipes as resolved here, and the
   * tiles named (every tile with `reset`), each copied. A paint with no flora sends none of the flora's fields.
   */
  message(famKeys: Iterable<number> | null, colKeys: Iterable<number> | null, reset: boolean, floKeys: Iterable<number> | null = null): GroundPaintMessage {
    const fam: { key: number; cells: Uint8Array | null }[] = [];
    const col: { key: number; cells: Uint8Array | null }[] = [];
    for (const key of reset ? this.fam.keys() : (famKeys ?? [])) fam.push({ key, cells: this.fam.get(key)?.slice() ?? null });
    for (const key of reset ? this.col.keys() : (colKeys ?? [])) col.push({ key, cells: this.col.get(key)?.slice() ?? null });
    const m: GroundPaintMessage = { cell: this.cell, follow: this.follow, familyOf: this.familyOf.slice(), choiceOf: this.choiceOf.slice(), fam, col, reset };
    const flo: { key: number; cells: Uint8Array | null }[] = [];
    for (const key of reset ? this.flo.keys() : (floKeys ?? [])) flo.push({ key, cells: this.flo.get(key)?.slice() ?? null });
    if (flo.length || this.flo.size || this.recipesSet()) {
      m.flo = flo;
      m.recOp = this.recOp.slice();
      m.recFam = this.recFam.slice();
      m.recNum = this.recNum.slice();
      m.recRoads = this.recRoads.slice();
    }
    return m;
  }

  /** Whether any recipe is resolved to do anything. */
  private recipesSet(): boolean {
    for (let i = 0; i < this.recOp.length; i++) if (this.recOp[i] !== 0) return true;
    return false;
  }

  /** A message taken (`message`'s other half): the palette, the recipes and `follow` as sent, the tiles put or taken out. */
  take(m: GroundPaintMessage): void {
    this.follow = m.follow;
    this.familyOf.set(m.familyOf);
    this.choiceOf.set(m.choiceOf);
    if (m.recOp && m.recOp.length === this.recOp.length) this.recOp.set(m.recOp);
    if (m.recFam && m.recFam.length === this.recFam.length) this.recFam.set(m.recFam);
    if (m.recNum && m.recNum.length === this.recNum.length) this.recNum.set(m.recNum);
    if (m.recRoads && m.recRoads.length === this.recRoads.length) this.recRoads.set(m.recRoads);
    if (m.reset) {
      this.fam.clear();
      this.col.clear();
      this.flo.clear();
    }
    const n = this.n;
    for (const t of m.fam) {
      if (t.cells && t.cells.length === n * n) this.fam.set(t.key, t.cells);
      else this.fam.delete(t.key);
    }
    for (const t of m.col) {
      if (t.cells && t.cells.length === n * n * 4) this.col.set(t.key, t.cells);
      else this.col.delete(t.key);
    }
    for (const t of m.flo ?? []) {
      if (t.cells && t.cells.length === n * n * 2) this.flo.set(t.key, t.cells);
      else this.flo.delete(t.key);
    }
    this.boundsAgain();
  }
}

/**
 * A flora family's id in a table by its pack and name, or why not: a family of another pack than the one the world plants
 * from (another world's trees are the scatter brush's), one the table has not got, or one past the flora maps' byte.
 */
export function familyIdOf(table: FloraFamilies | null, named: FloraFamilyName, pack: string): number | string {
  if (named.pack !== pack) return `another world's flora: only ${pack}'s can be painted here, and the scatter brush places other worlds' trees`;
  if (!table) return `${pack} has no flora table here`;
  for (const [id, f] of table.families) if (f.name === named.name) return id > 0 && id < 256 ? id : `its id ${id} does not fit the flora maps' byte`;
  return 'no family of that name';
}

/** The four maps a grid's flora lay writes into, kept (never held past a lay). */
const FLORA_MAPS: (Uint8Array | null)[] = [null, null, null, null];
/** The recipes a pole's four cells name and the amount each comes to, kept. */
const FLO_R = new Int32Array(4);
const FLO_A = new Float64Array(4);
/** One point's class's two bytes, kept, for `floraPoint`. */
const FLORA_PAIR = new Uint8Array(2);
/** The add test's generator, kept and seeded a pole. */
const FLORA_RNG = new FastRandomGenerator(1);
/** A salt a class, so each class's clear, remove and thin roll by a pattern of its own. */
const FLORA_SALT = new Int32Array([0x2545f491, 0x6a09e667 | 0, 0x3c6ef372, 0x510e527f]);

/** One colour sample of the paint: its bytes and its amount. */
interface PaintSample {
  r: number;
  g: number;
  b: number;
  amount: number;
}

/** The kept sample and the four cells' bytes a lay reads into, so a lay makes nothing. */
const PAINT_SAMPLE: PaintSample = { r: 0, g: 0, b: 0, amount: 0.5 };
const COL_BYTES = new Uint8Array(16);
