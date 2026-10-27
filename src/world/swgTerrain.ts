import * as THREE from 'three';
// Bridges the game's terrain to a converted planet's real SWG terrain generator.
// Heights are sampled on the main thread from cached pole grids; grids are produced
// ahead of time by a worker so streaming never stalls on generation.

import { TERRAIN_GROUND_TUNE, type EnvironmentFamily, type Layer, type ShaderGroup } from '../swg/terrain/generator.ts';
import { layAsk, type HeightEdits } from '../swg/terrain/heightEdits.ts';
import { PAINT_TILE, paintTileNumber, paintTileOf, type GroundPaint } from '../swg/terrain/groundPaint.ts';
import { attachBitmap, attachRamp, bitmapFiles, ORIGIN_OFFSET, parseLayerFile, parseTerrainTemplate, rampNames, readColorRampFile, readColorReference, TerrainSampler, UPPER_PAD, waterTables, type ColorRamp, type ColorReference, type GroundProbe, type PoleBlock, type RadialPole, type TerrainTemplate } from '../swg/terrain/trn.ts';
import { groundChunkAt, groundShift, type GroundShift } from './groundTiles.ts';
import { gameRibbon, terrainRibbons, type GameRibbon } from '../swg/terrain/ribbons.ts';
import { FarGridIndex } from './farGridIndex.ts';

export interface BuildingLayerSource {
  bytes: ArrayBuffer;
  /** SWG world position and yaw of the building. */
  x: number;
  z: number;
  yaw: number;
}

/**
 * Coarse samples for a far tile: heights, shader family, child choice and colour per sample (colour
 * three bytes a sample), in the game's column order, each the generator's answer at the sample's own
 * place on a grid of its own 16 m apart. That is not the near ground's answer there, and nothing
 * drawn from these may assume it is:
 *   - the families are what a 16 m grid paints, and the slope and shader filters read that coarse
 *     grid, so they differ from the near ground's at the same place on 25% of Tatooine's samples,
 *     whose far samples all sit on 8 m pattern corners;
 *   - the pattern cannot lay them on its corners where the layout centre puts the samples off them
 *     (every world but Tatooine: Naboo's centre is 7 m along the pattern, Talus's 5 m, Kashyyyk's 2 m),
 *     which costs about 1 to 8 points more: a far family differs from the near ground's family at the
 *     sample's nearest corner at 2.1% of Naboo's samples and 13.5% of Talus's, where it differs from a
 *     2 m grid's at its own place at 1.2% and 5.4%;
 *   - each child choice is drawn from the sample's own place, which on those worlds is a place no
 *     near pole has: the same spread of alternates, not the same alternate.
 * A far tile drawn the client's way must sample on the corners itself, which moving the mesh by the
 * centre's remainder mod 2 does not do (that puts the samples on poles, not on corners).
 */
export interface FarGrid {
  heights: Float32Array;
  shaders: Int32Array;
  children: Uint8Array;
  colors: Uint8Array;
  /** The far radial map, family and choice pairs a sample: the far hills' tree cards (`farCards.ts`), from the same coarse grid. */
  radialFar: Uint8Array;
}

/** Where the pack keeps the colour ramps the colour affectors read (the terrain command's to write, `colorRampFile`'s shape). */
export const COLOR_RAMP_FILE = 'terrain/colorramps.json';

/** What the terrain worker answers (`workerCore.ts`): its readiness, a grid with the paint's revision it was made at, a fault. */
export interface TerrainReply {
  type: string;
  id?: number;
  rev?: number;
  heights?: Float32Array;
  shaders?: Int32Array;
  children?: Uint8Array;
  colors?: Uint8Array;
  excluded?: Uint8Array;
  floraCollidable?: Uint8Array;
  floraNonCollidable?: Uint8Array;
  radialNear?: Uint8Array;
  radialFar?: Uint8Array;
  environments?: Uint8Array;
  seasonal?: Uint8Array;
  /** The colours before the paint's (Map-maker II), only where the paint has colours over the grid. */
  colorsUnpainted?: Uint8Array;
  info?: unknown;
  message?: string;
}

interface Pending {
  key: string;
  resolve: (block: PoleBlock) => void;
  /** The grid asked for, so a reply older than the paint over it is asked for again as it was (Map-maker II). */
  startX: number;
  startZ: number;
  n: number;
  step: number;
}

/** A lake, pool or lava flow in game coordinates, with the terrain's shader key, water type and shader size. */
export interface SwgWaterTable {
  name: string;
  points: { x: number; z: number }[];
  height: number;
  /** The shader as shaderKey gives it ("wter_spec"); '' when the terrain names none. */
  shader: string;
  /** 0 water, 1 lava. */
  waterType: number;
  /** Metres per repeat of the shader's textures. */
  shaderSize: number;
  /** The outline's bounds in game coordinates, so a point far off is passed over without the polygon test. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * SWG terrain for one planet. Game coordinates are the layout centre mirrored in X:
 * gx = -(swgX - cx), gz = swgZ - cz.
 */
export class SwgTerrain {
  readonly template: TerrainTemplate;
  readonly sampler: TerrainSampler;
  readonly centerX: number;
  readonly centerZ: number;
  private worker: Worker | null = null;
  private workerReady = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly requested = new Set<string>();
  private readonly farGrids = new Map<string, FarGrid>();
  /** The same grids by number (`farGridIndex.ts`), so a lookup on a frame's path builds no string key: filed and taken out beside `farGrids`. */
  private readonly farIndex = new FarGridIndex<FarGrid>();
  /** A far grid by its corner and tiling: by number where the index files it, else by its string key. Makes nothing on the first way. */
  private farGridAt(gx0: number, gz0: number, size: number, res: number): FarGrid | null {
    const g = this.farIndex.get(gx0, gz0, size, res);
    if (g !== undefined) return g;
    return this.farGrids.get(SwgTerrain.farKey(gx0, gz0, size, res)) ?? null;
  }
  /** How many chunk grids were generated synchronously on the main thread (diagnostics). */
  syncGenerations = 0;
  /** Lakes, pools and lava flows in game coordinates. */
  readonly waterTables: SwgWaterTable[] = [];
  /** The terrain's ribbons (strips of water or lava down a slope, `ribbons.ts`) in game coordinates. */
  readonly ribbons: GameRibbon[] = [];
  /** The colour ramps the terrain's colour affectors name, and which of them the pack carried. */
  readonly ramps: { named: string[]; loaded: number };
  /** How bright the world's colour map runs (the terrain command's measure, beside the ramps), or null where the pack has none. */
  readonly colorReference: ColorReference | null;
  /** Where the ground's mesh stands against the 64 m buckets so its vertices fall on the poles (`groundTiles.ts`). */
  readonly groundShift: GroundShift;

  private constructor(trn: ArrayBuffer, layers: BuildingLayerSource[], bitmaps: { familyId: number; bytes: ArrayBuffer }[], ramps: Map<string, ColorRamp>, centerX: number, centerZ: number, colorReference: ColorReference | null = null, heights: HeightEdits | null = null, paint: GroundPaint | null = null, tableOnly = false, paintResolve: ((group: ShaderGroup) => void) | null = null, lend: ((group: ShaderGroup, tileWidth: number) => void) | null = null) {
    this.colorReference = colorReference;
    this.groundShift = groundShift(centerX, centerZ);
    this.template = parseTerrainTemplate(new Uint8Array(trn));
    for (const b of bitmaps) attachBitmap(this.template, b.familyId, new Uint8Array(b.bytes));
    const named = rampNames(this.template);
    const sent: { name: string; width: number; rgb: ArrayBuffer }[] = [];
    for (const name of named) {
      const ramp = ramps.get(name);
      if (!ramp || !attachRamp(this.template, name, ramp)) continue;
      sent.push({ name, width: ramp.width, rgb: ramp.rgb.slice().buffer });
    }
    this.ramps = { named, loaded: sent.length };
    this.sampler = new TerrainSampler(this.template);
    // The world's height edits (Map-maker II), held from before any block is cached: every block and far grid takes them
    // as it enters a cache, and the generator and its worker never see them.
    this.sampler.heights = heights;
    // The world's ground paint (Map-maker II), the same way: held from before any block is cached, and the worker's copy of
    // it posted with its `init` below, so every grid either thread makes is painted alike.
    this.sampler.paint = paint;
    this.tableOnly = tableOnly;
    this.centerX = centerX;
    this.centerZ = centerZ;
    for (const l of layers) {
      const layer: Layer | null = parseLayerFile(new Uint8Array(l.bytes), this.template.generator);
      if (layer) this.sampler.addBuildingLayer(layer, l.x, l.z, l.yaw);
    }
    // Other worlds' families lent this terrain's group (Map-maker II's third wave), after the building layers, in the
    // palette's order: the worker is handed them with its `init` below and gives each the same id.
    if (lend) lend(this.template.generator.shaderGroup, this.template.tileWidthInMeters);
    // The paint's palette resolved against this terrain's own families (a building's layer file may have added some), before
    // the worker is handed it below: both threads lay the same ids.
    if (paint && paintResolve) paintResolve(this.template.generator.shaderGroup);
    for (const w of waterTables(this.template.generator)) {
      const points = w.points.map((pt) => ({ x: this.toGameX(pt.x), z: this.toGameZ(pt.y) }));
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const p of points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      this.waterTables.push({ name: w.name, height: w.height, points, shader: w.shader, waterType: w.waterType, shaderSize: w.shaderSize, minX, maxX, minZ, maxZ });
    }
    // The terrain's ribbons (Mustafar's lava falls), in the game's frame: drawn only where a setting asks (`World`), and
    // never a water table, so nothing that asks the water here (the feet, the swim, the lava's harm) meets one.
    for (const r of terrainRibbons(this.template.generator)) this.ribbons.push(gameRibbon(r, (x) => this.toGameX(x), (z) => this.toGameZ(z)));
    // A table read for its families alone (a real-elevation world's lent ground, the console's family list) starts no worker:
    // nothing ever asks it for a grid, and nothing would stop one.
    if (typeof Worker !== 'undefined' && !tableOnly) {
      try {
        this.worker = new Worker(new URL('../swg/terrain/worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent) => this.onMessage(e.data);
        this.worker.onerror = (e) => console.warn('terrain worker error', e.message);
        this.worker.postMessage(
          {
            type: 'init',
            trn: trn.slice(0),
            layers: layers.map((l) => ({ bytes: l.bytes.slice(0), x: l.x, z: l.z, yaw: l.yaw })),
            bitmaps: bitmaps.map((b) => ({ familyId: b.familyId, bytes: b.bytes.slice(0) })),
            ramps: sent,
            roadsClearFlora: TERRAIN_GROUND_TUNE.roadsClearFlora,
            lifeDay: TERRAIN_GROUND_TUNE.lifeDay,
            paint: paint && !paint.empty ? paint.message(null, null, true) : null,
            rev: this.paintRev,
            // Only where a family was lent, so every other world's `init` is the message it always was.
            ...(this.template.generator.shaderGroup.lent.size ? { lent: this.template.generator.shaderGroup.lentList() } : {}),
          },
          sent.map((r) => r.rgb),
        );
      } catch (err) {
        console.warn('terrain worker unavailable, generating on the main thread', err);
        this.worker = null;
      }
    }
  }

  /**
   * Build the terrain: parses the template once to learn which bitmap files it needs, fetches
   * them through `fetchBytes` (pack-relative paths), and the colour ramps when the pack carries
   * them, then starts the worker.
   */
  static async create(trn: ArrayBuffer, layers: BuildingLayerSource[], centerX: number, centerZ: number, fetchBytes: (file: string) => Promise<ArrayBuffer | null>, opts: { heights?: HeightEdits | null; paint?: GroundPaint | null; paintResolve?: (group: ShaderGroup) => void; tableOnly?: boolean; lend?: (group: ShaderGroup, tileWidth: number) => void } = {}): Promise<SwgTerrain> {
    const probe = parseTerrainTemplate(new Uint8Array(trn));
    const bitmaps: { familyId: number; bytes: ArrayBuffer }[] = [];
    // A table read for its families alone fetches no bitmap: nothing generates a grid over it.
    for (const b of opts.tableOnly ? [] : bitmapFiles(probe)) {
      const bytes = await fetchBytes(b.file);
      if (bytes) bitmaps.push({ familyId: b.familyId, bytes });
      else console.warn(`terrain: bitmap ${b.file} (${b.name}) missing; its filter passes everywhere`);
    }
    // A pack converted before the ramps were written has none, and every ramp affector then does
    // nothing, as the client's does for an image it cannot load: the colour map is the constants'.
    let ramps = new Map<string, ColorRamp>();
    let reference: ColorReference | null = null;
    // The file is read for its brightness reference even on a world that names no ramp: the ground's tint is
    // normalised by it whatever painted the colour map.
    const bytes = await fetchBytes(COLOR_RAMP_FILE);
    if (bytes) {
      try {
        const json = JSON.parse(new TextDecoder().decode(bytes));
        if (rampNames(probe).length) ramps = readColorRampFile(json);
        reference = readColorReference(json);
      } catch (err) {
        console.warn(`terrain: ${COLOR_RAMP_FILE} could not be read; the colour ramps do nothing`, err);
      }
    }
    return new SwgTerrain(trn, layers, bitmaps, ramps, centerX, centerZ, reference, opts.heights ?? null, opts.paint ?? null, !!opts.tableOnly, opts.paintResolve ?? null, opts.lend ?? null);
  }

  /** Whether this is a table read for its families alone (no worker, no bitmaps): `create`'s `tableOnly`. */
  readonly tableOnly: boolean;

  // ---- Map-maker II: the ground's paint -------------------------------------------------------------------------------

  /** The ground's paint this terrain's grids are made with, or null. */
  get paint(): GroundPaint | null {
    return this.sampler.paint;
  }

  /**
   * The paint's revision: stepped each time the paint is posted to the worker. Every grid the worker answers carries the
   * revision it was made at, and each 512 m paint tile keeps the revision that last touched it (`tileRev`): a grid older
   * than any tile it reaches is asked for again rather than put (a block asked for before a stroke was let go and answered
   * after it, DESIGN.md §2.5).
   */
  private paintRev = 0;
  private readonly tileRev = new Map<number, number>();
  /** Told of every grid made again for a paint, once it is in the cache: a block's game-frame square, or a far grid's place. */
  onRepainted: ((kind: 'block' | 'far', gx0: number, gz0: number, gx1: number, gz1: number) => void) | null = null;
  /** What the paint's work came to (the console's): grids asked for again, replies older than their tiles asked for once more. */
  readonly paintWork = { posted: 0, asked: 0, stale: 0, landed: 0, preview: 0 };

  /**
   * A paint put in (or let go: null), a file read late or read again whole: the sampler takes it, the worker is handed the
   * whole of it, and every cached block and far grid is made again with it. Answers how many grids were asked for again.
   */
  useGroundPaint(paint: GroundPaint | null, repaint = true): number {
    this.sampler.paint = paint;
    this.postPaint(null, null, true);
    // A paint of nothing (the editor's first stroke's empty one) paints no grid: none is asked for again.
    return repaint ? this.repaintAll() : 0;
  }

  /**
   * The paint as it stands handed to the worker (the tiles named, or the whole of it with `reset`), its revision stepped,
   * and every 512 m tile named marked with it. Nothing goes where there is no worker: the main thread's sampler holds the
   * very object the editor paints.
   */
  postPaint(famKeys: Iterable<number> | null, colKeys: Iterable<number> | null, reset: boolean): number {
    const rev = ++this.paintRev;
    const p = this.sampler.paint;
    if (reset) {
      for (const k of this.tileRev.keys()) this.tileRev.set(k, rev);
      if (p) for (const m of [p.fam, p.col]) for (const k of m.keys()) this.tileRev.set(k, rev);
    } else {
      for (const k of famKeys ?? []) this.tileRev.set(k, rev);
      for (const k of colKeys ?? []) this.tileRev.set(k, rev);
    }
    if (this.worker) {
      const group = this.template.generator.shaderGroup;
      // The lent families with every post (Map-maker II's third wave): a family lent in play reaches the worker's group before
      // any grid is asked for again with it.
      this.worker.postMessage(group.lent.size ? { type: 'paint', rev, paint: p ? p.message(famKeys, colKeys, reset) : null, lent: group.lentList() } : { type: 'paint', rev, paint: p ? p.message(famKeys, colKeys, reset) : null });
      this.paintWork.posted++;
    }
    return rev;
  }

  /**
   * The lent families handed to the worker as they stand (Map-maker II's third wave: a family lent in play behind the
   * editor's curtain), at the revision in force and with no tile named, so nothing it has made goes stale. Nothing goes
   * where there is no worker or nothing is lent.
   */
  postLent(): void {
    const group = this.template.generator.shaderGroup;
    if (!this.worker || !group.lent.size) return;
    const p = this.sampler.paint;
    this.worker.postMessage({ type: 'paint', rev: this.paintRev, paint: p ? p.message([], [], false) : null, lent: group.lentList() });
    this.paintWork.posted++;
  }

  /**
   * Every cached block and far grid a rectangle of the raw frame reaches asked for again with the paint in force (a stroke
   * let go, a file landed, an undo): every 512 m tile it reaches marked at the newest revision first, so nothing older is
   * ever put over it. Answers how many grids were asked for.
   */
  repaint(x0: number, z0: number, x1: number, z1: number): number {
    const p = this.sampler.paint;
    const m = (p?.cell ?? 8) + this.sampler.poleStep;
    const lx = Math.min(x0, x1) - m;
    const hx = Math.max(x0, x1) + m;
    const lz = Math.min(z0, z1) - m;
    const hz = Math.max(z0, z1) + m;
    const rev = this.paintRev;
    for (let tz = Math.floor(lz / PAINT_TILE); tz <= Math.floor(hz / PAINT_TILE); tz++) {
      for (let tx = Math.floor(lx / PAINT_TILE); tx <= Math.floor(hx / PAINT_TILE); tx++) {
        const k = paintTileNumber(tx, tz);
        if (k >= 0) this.tileRev.set(k, rev);
      }
    }
    let asked = 0;
    for (const { bx, bz } of this.sampler.cachedBlocksIn(lx, lz, hx, hz)) {
      this.regenBlock(bx, bz);
      asked++;
    }
    // Over a list of the far grids made first: where no worker answers, a far grid is made again at once and filed anew
    // under its key, at the map's end, and walked over the map itself the walk met it again for ever (a repaint before the
    // worker said it was ready froze the page).
    for (const key of [...this.farGrids.keys()]) {
      const g = this.farGrids.get(key);
      if (!g) continue;
      const fm = this.farMeta.get(g);
      if (!fm) continue;
      const fx0 = Math.min(fm.x0, fm.x0 + (fm.n - 1) * fm.dx);
      const fx1 = Math.max(fm.x0, fm.x0 + (fm.n - 1) * fm.dx);
      const fz1 = fm.z0 + (fm.n - 1) * fm.step;
      if (fx1 < lx || fx0 > hx || fz1 < lz || fm.z0 > hz) continue;
      this.regenFar(key);
      asked++;
    }
    this.sampler.endPreview();
    return asked;
  }

  /**
   * Every cached grid a tile the paint holds reaches asked for again (the palette moved, the world row's `follow` or
   * weights moved). Answers how many grids were asked for.
   */
  repaintTiles(): number {
    const p = this.sampler.paint;
    if (!p) return 0;
    let asked = 0;
    for (const m of [p.fam, p.col]) {
      for (const key of m.keys()) {
        const { tx, tz } = paintTileOf(key);
        asked += this.repaint(tx * PAINT_TILE, tz * PAINT_TILE, (tx + 1) * PAINT_TILE, (tz + 1) * PAINT_TILE);
      }
    }
    return asked;
  }

  /**
   * Rows of the paint file landed on this terrain's paint (`World.landPaint`, the tiles already put in or taken out): the
   * worker handed the whole paint and every tile it holds made again where the palette moved, else the tiles that moved
   * alone; and the raw rectangle of the tiles that moved (`moved`, null for none) made again either way, since a tile taken
   * out is in no tile the paint still holds (an undo of a stroke that added the palette's entry, a file read again without
   * its palette). Answers how many grids were asked for.
   */
  landPaint(paletteMoved: boolean, famKeys: Iterable<number>, colKeys: Iterable<number>, moved: { x0: number; z0: number; x1: number; z1: number } | null): number {
    let asked = 0;
    if (paletteMoved) {
      this.postPaint(null, null, true);
      asked += this.repaintTiles();
    } else this.postPaint(famKeys, colKeys, false);
    if (moved) asked += this.repaint(moved.x0, moved.z0, moved.x1, moved.z1);
    return asked;
  }

  /** Every cached grid asked for again (a paint put in or let go whole). */
  private repaintAll(): number {
    let asked = 0;
    for (const key of this.sampler.cachedBlockKeys()) {
      const comma = key.indexOf(',');
      this.regenBlock(Number(key.slice(0, comma)), Number(key.slice(comma + 1)));
      asked++;
    }
    for (const key of [...this.farGrids.keys()]) {
      this.regenFar(key);
      asked++;
    }
    this.sampler.endPreview();
    return asked;
  }

  /** The newest revision any paint tile a raw rectangle reaches was marked at (0: none). */
  private revFor(x0: number, z0: number, x1: number, z1: number): number {
    if (!this.tileRev.size) return 0;
    const m = (this.sampler.paint?.cell ?? 8) + this.sampler.poleStep;
    let most = 0;
    for (let tz = Math.floor((Math.min(z0, z1) - m) / PAINT_TILE); tz <= Math.floor((Math.max(z0, z1) + m) / PAINT_TILE); tz++) {
      for (let tx = Math.floor((Math.min(x0, x1) - m) / PAINT_TILE); tx <= Math.floor((Math.max(x0, x1) + m) / PAINT_TILE); tx++) {
        const r = this.tileRev.get(paintTileNumber(tx, tz));
        if (r !== undefined && r > most) most = r;
      }
    }
    return most;
  }

  /** A cached block made again for the paint: asked of the worker (replacing the cached one as it lands), or here at once. */
  private regenBlock(bx: number, bz: number): void {
    const key = `p:${bx},${bz}`;
    const notify = () => {
      const s = this.sampler.blockStart(bx, bz);
      const span = (this.sampler.numberOfPoles - 1) * this.sampler.poleStep;
      const a = this.toGameX(s.x + span);
      const b = this.toGameX(s.x);
      this.onRepainted?.('block', Math.min(a, b), this.toGameZ(s.z), Math.max(a, b), this.toGameZ(s.z + span));
    };
    if (!this.worker || !this.workerReady) {
      this.sampler.forgetBlock(bx, bz);
      this.sampler.generateBlock(bx, bz);
      this.syncGenerations++;
      this.paintWork.landed++;
      notify();
      return;
    }
    if (this.requested.has(key)) return;
    this.requested.add(key);
    this.paintWork.asked++;
    const s = this.sampler.blockStart(bx, bz);
    this.request(key, s.x, s.z, this.sampler.numberOfPoles, this.sampler.poleStep, (block) => {
      this.sampler.putBlock(bx, bz, block);
      this.paintWork.landed++;
      notify();
    });
  }

  /** A cached far grid made again for the paint, replacing the cached one as it lands, and the world told. */
  private regenFar(key: string): void {
    const g = this.farGrids.get(key);
    const fm = g ? this.farMeta.get(g) : undefined;
    const place = this.farPlace.get(key);
    if (!g || !fm || !place) return;
    const { gx0, gz0, size, res } = place;
    const notify = () => this.onRepainted?.('far', gx0, gz0, gx0 + size, gz0 + size);
    const rkey = `pf:${key}`;
    if (!this.worker || !this.workerReady) {
      this.farGrids.delete(key);
      this.farIndex.delete(gx0, gz0, size, res);
      this.farGrid(gx0, gz0, size, res, true);
      this.paintWork.landed++;
      notify();
      return;
    }
    if (this.requested.has(rkey)) return;
    this.requested.add(rkey);
    this.paintWork.asked++;
    const step = size / res;
    const n = res + 3;
    const startX = this.toSwgX(gx0 + (res + 1) * step);
    const startZ = this.toSwgZ(gz0 - step);
    this.request(rkey, startX, startZ, n, step, (block) => {
      // Only while the grid it replaces is still the one cached (a far tile let go meanwhile asks afresh when it is wanted).
      if (!this.farGrids.has(key)) return;
      this.finishFar(key, gx0, gz0, size, res, block);
      this.paintWork.landed++;
      notify();
    });
  }

  /** Each far grid's place in the game's frame, by its key, so a grid can be asked for again as it was. */
  private readonly farPlace = new Map<string, { gx0: number; gz0: number; size: number; res: number }>();

  /**
   * The paint laid in place over the cached blocks under a game-frame rectangle (the editor's preview while a stroke is
   * held, `TerrainSampler.previewPaint`). Answers how many blocks it laid. A stamp's work.
   */
  previewPaint(gx0: number, gz0: number, gx1: number, gz1: number): number {
    const x0 = this.toSwgX(Math.max(gx0, gx1));
    const x1 = this.toSwgX(Math.min(gx0, gx1));
    const n = this.sampler.previewPaint(x0, this.toSwgZ(Math.min(gz0, gz1)), x1, this.toSwgZ(Math.max(gz0, gz1)));
    this.paintWork.preview += n;
    return n;
  }

  /** The height edits laid over this ground, or null. */
  get heights(): HeightEdits | null {
    return this.sampler.heights;
  }

  /**
   * A store of height edits put in (or let go: null) after the ground was made, a file that landed late: every cached block
   * and far grid laid again from raw with it. Answers how many grids it laid. What a chunk already built from them shows is
   * the world's to rebuild (`World.heightsChanged`).
   */
  useHeights(store: HeightEdits | null): number {
    this.sampler.heights = store;
    let n = this.sampler.relayAll();
    for (const g of this.farGrids.values()) if (this.layFar(g)) n++;
    return n;
  }

  /**
   * Every cached block and far grid whose samples a rectangle of the game's frame reaches, laid again from raw with the
   * edits in force (a stroke's stamp, an undo, a file landed): the rectangle turned into the raw frame (x mirrored). Answers
   * how many blocks and grids it laid. A stamp's work, never a frame's.
   */
  relayRect(gx0: number, gz0: number, gx1: number, gz1: number): { blocks: number; far: number } {
    const x0 = this.toSwgX(gx1);
    const x1 = this.toSwgX(gx0);
    const z0 = this.toSwgZ(gz0);
    const z1 = this.toSwgZ(gz1);
    const blocks = this.sampler.relay(x0, z0, x1, z1);
    let far = 0;
    for (const g of this.farGrids.values()) {
      const m = this.farMeta.get(g);
      if (!m) continue;
      const fx0 = Math.min(m.x0, m.x0 + (m.n - 1) * m.dx);
      const fx1 = Math.max(m.x0, m.x0 + (m.n - 1) * m.dx);
      const fz1 = m.z0 + (m.n - 1) * m.step;
      if (fx1 < x0 || fx0 > x1 || fz1 < z0 || m.z0 > z1) continue;
      if (this.layFar(g)) far++;
    }
    return { blocks, far };
  }

  /**
   * One far grid laid from its raw samples with the edits in force: where none of its samples takes a delta it keeps no raw
   * copy (and one it kept is put back). Answers whether it laid anything.
   */
  private layFar(g: FarGrid): boolean {
    const m = this.farMeta.get(g);
    if (!m) return false;
    const h = this.sampler.heights;
    const span = (m.n - 1) * m.step;
    const fx0 = Math.min(m.x0, m.x0 + (m.n - 1) * m.dx);
    if (!m.raw) {
      if (!h || !h.touches(fx0, m.z0, fx0 + span, m.z0 + span)) return false;
      m.raw = g.heights.slice();
    }
    if (!h) {
      g.heights.set(m.raw);
      return true;
    }
    const a = this.farLay;
    a.raw = m.raw;
    a.out = g.heights;
    a.x0 = m.x0;
    a.dx = m.dx;
    a.z0 = m.z0;
    a.dz = m.step;
    a.nx = m.n;
    a.nz = m.n;
    h.layIn(a);
    a.raw = null;
    a.out = null;
    return true;
  }

  /** Each far grid's place in the raw frame (its first column's x, the step along x in the game's column order, its first row's z, the step and the size) and, once an edit reached it, its raw heights. */
  private readonly farMeta = new WeakMap<FarGrid, { x0: number; dx: number; z0: number; step: number; n: number; raw: Float32Array | null }>();
  private readonly farLay = layAsk();

  get waterLevel(): number {
    return this.template.useGlobalWaterTable ? this.template.globalWaterTableHeight : -Infinity;
  }

  get tileWidth(): number {
    return this.template.tileWidthInMeters;
  }

  toGameX(x: number): number {
    return this.centerX - x;
  }

  toGameZ(z: number): number {
    return z - this.centerZ;
  }

  /** Water surface height at a game-space point: the global table or any lake covering it (-Infinity when dry). */
  waterAt(gx: number, gz: number): number {
    let h = this.waterLevel;
    for (const w of this.waterTables) {
      if (w.height > h && gx >= w.minX && gx <= w.maxX && gz >= w.minZ && gz <= w.maxZ && pointInPolygon(gx, gz, w.points)) h = w.height;
    }
    return h;
  }

  /** The highest table covering a game-space point, or null (dry, or only the global sea). */
  waterTableAt(gx: number, gz: number): SwgWaterTable | null {
    let best: SwgWaterTable | null = null;
    for (const w of this.waterTables) {
      if (best && w.height <= best.height) continue;
      if (gx < w.minX || gx > w.maxX || gz < w.minZ || gz > w.maxZ) continue;
      if (pointInPolygon(gx, gz, w.points)) best = w;
    }
    return best;
  }

  toSwgX(gx: number): number {
    return this.centerX - gx;
  }

  toSwgZ(gz: number): number {
    return this.centerZ + gz;
  }

  /** Height at a game-space point; generates the covering chunk synchronously if it is not cached. */
  heightAt(gx: number, gz: number): number {
    const x = this.toSwgX(gx);
    const z = this.toSwgZ(gz);
    const bw = this.sampler.blockWidth;
    if (!this.sampler.hasBlock(Math.floor(x / bw), Math.floor(z / bw))) this.syncGenerations++;
    return this.sampler.heightAt(x, z);
  }

  /**
   * Height at a game-space point from grids already generated: the pole block when cached,
   * else the far tile's coarse samples, else null. Never generates anything.
   */
  heightIfCached(gx: number, gz: number, farSize: number, farRes: number): number | null {
    const x = this.toSwgX(gx);
    const z = this.toSwgZ(gz);
    const bw = this.sampler.blockWidth;
    if (this.sampler.hasBlock(Math.floor(x / bw), Math.floor(z / bw))) return this.sampler.heightAt(x, z);
    // The far tiles stand where the near ground does (`groundChunkOrigin`), moved by the world's shift.
    const s = this.groundShift;
    const gx0 = groundChunkAt(gx, s.x, farSize) * farSize + s.x;
    const gz0 = groundChunkAt(gz, s.z, farSize) * farSize + s.z;
    const grid = this.farGridAt(gx0, gz0, farSize, farRes);
    if (!grid) return null;
    const step = farSize / farRes;
    const n = farRes + 3;
    // Column i is game x = gx0 + (i - 1) * step; row j likewise in z.
    const fx = THREE.MathUtils.clamp((gx - gx0) / step + 1, 0, n - 1.001);
    const fz = THREE.MathUtils.clamp((gz - gz0) / step + 1, 0, n - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h = grid.heights;
    return (h[j * n + i] * (1 - u) + h[j * n + i + 1] * u) * (1 - v) + (h[(j + 1) * n + i] * (1 - u) + h[(j + 1) * n + i + 1] * u) * v;
  }

  /** `heightIfCached` without the far grid: the pole block's height where it is cached, else null. Never generates anything. */
  nearHeightIfCached(gx: number, gz: number): number | null {
    const x = this.toSwgX(gx);
    const z = this.toSwgZ(gz);
    const bw = this.sampler.blockWidth;
    return this.sampler.hasBlock(Math.floor(x / bw), Math.floor(z / bw)) ? this.sampler.heightAt(x, z) : null;
  }

  /**
   * The far grid's own sample at lattice point (i, j), game x `groundShift.x + i·step` and z likewise, with no
   * interpolation, or null while its grid is not made: what a race-driven hull's look-ahead reads once a point and
   * keeps (`raceMath.ts`, `LatticeRing`).
   */
  farSampleAt(i: number, j: number, farSize: number, farRes: number): number | null {
    const step = farSize / farRes;
    const s = this.groundShift;
    const gx = s.x + i * step;
    const gz = s.z + j * step;
    const cx = groundChunkAt(gx, s.x, farSize);
    const cz = groundChunkAt(gz, s.z, farSize);
    const grid = this.farGridAt(cx * farSize + s.x, cz * farSize + s.z, farSize, farRes);
    if (!grid) return null;
    const n = farRes + 3;
    const col = Math.min(n - 1, Math.max(0, i - cx * farRes + 1));
    const row = Math.min(n - 1, Math.max(0, j - cz * farRes + 1));
    const h = grid.heights[row * n + col];
    return Number.isFinite(h) ? h : null;
  }

  /** Whether a game-space corner lies on a tile centre pole, which decides the ground triangulation. */
  isTileCentre(gx: number, gz: number): boolean {
    const tw = this.tileWidth;
    const half = tw * 0.5;
    const mod = (v: number) => ((v % tw) + tw) % tw;
    return Math.abs(mod(this.toSwgX(gx)) - half) < 1e-3 && Math.abs(mod(this.toSwgZ(gz)) - half) < 1e-3;
  }

  /** Pole blocks covering a game-space square (with a one-pole margin for normals). */
  private blocksCovering(gx0: number, gz0: number, size: number): { cx: number; cz: number }[] {
    const cw = this.sampler.blockWidth;
    const m = this.sampler.poleStep;
    const xs = [this.toSwgX(gx0 - m), this.toSwgX(gx0 + size + m)].sort((a, b) => a - b);
    const zs = [this.toSwgZ(gz0 - m), this.toSwgZ(gz0 + size + m)].sort((a, b) => a - b);
    const out: { cx: number; cz: number }[] = [];
    for (let cz = Math.floor(zs[0] / cw); cz <= Math.floor(zs[1] / cw); cz++) {
      for (let cx = Math.floor(xs[0] / cw); cx <= Math.floor(xs[1] / cw); cx++) out.push({ cx, cz });
    }
    return out;
  }

  /**
   * True when every pole grid under a game chunk is cached. Otherwise queues the missing grids
   * on the worker (or generates them now when `sync` is set) and returns whether they are ready.
   */
  prepareArea(gx0: number, gz0: number, size: number, sync: boolean): boolean {
    let ready = true;
    for (const { cx, cz } of this.blocksCovering(gx0, gz0, size)) {
      if (this.sampler.hasBlock(cx, cz)) continue;
      if (sync || !this.worker || !this.workerReady) {
        this.sampler.generateBlock(cx, cz);
        this.syncGenerations++;
        continue;
      }
      ready = false;
      const key = `c:${cx},${cz}`;
      if (this.requested.has(key)) continue;
      this.requested.add(key);
      const s = this.sampler.blockStart(cx, cz);
      this.request(key, s.x, s.z, this.sampler.numberOfPoles, this.sampler.poleStep, (block) => {
        if (!this.sampler.hasBlock(cx, cz)) this.sampler.putBlock(cx, cz, block);
      });
    }
    return ready;
  }

  /**
   * Coarse samples for a far tile: `res + 3` columns and rows across `size` metres, one step
   * beyond the tile on each side (the layout Terrain.buildGrid expects), generated directly at
   * that spacing. Returns null until the worker has produced it.
   */
  farGrid(gx0: number, gz0: number, size: number, res: number, sync: boolean): FarGrid | null {
    const key = SwgTerrain.farKey(gx0, gz0, size, res);
    const cached = this.farGrids.get(key);
    if (cached) return cached;
    const step = size / res;
    // Generated in SWG space, where X runs the other way: column i of the result is game x = gx0 + (i - 1) * step.
    const n = res + 3;
    const startX = this.toSwgX(gx0 + (res + 1) * step);
    const startZ = this.toSwgZ(gz0 - step);
    if (sync || !this.worker || !this.workerReady) {
      this.syncGenerations++;
      return this.finishFar(key, gx0, gz0, size, res, this.sampler.generate(startX, startZ, n, step));
    }
    if (!this.requested.has(key)) {
      this.requested.add(key);
      this.request(key, startX, startZ, n, step, (block) => void this.finishFar(key, gx0, gz0, size, res, block));
    }
    return null;
  }

  /** A far grid's samples turned into the game's column order and filed (in place of any cached under its key). */
  private finishFar(key: string, gx0: number, gz0: number, size: number, res: number, g: { heights: Float32Array; shaders: Int32Array; children: Uint8Array; colors: Uint8Array; radialFar?: Uint8Array }): FarGrid {
    const step = size / res;
    const n = res + 3;
    const startX = this.toSwgX(gx0 + (res + 1) * step);
    const startZ = this.toSwgZ(gz0 - step);
    const out: FarGrid = { heights: new Float32Array(n * n), shaders: new Int32Array(n * n), children: new Uint8Array(n * n), colors: new Uint8Array(n * n * 3), radialFar: new Uint8Array(n * n * 2) };
    const far = g.radialFar;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const to = j * n + i;
        const from = j * n + (n - 1 - i);
        out.heights[to] = g.heights[from];
        out.shaders[to] = g.shaders[from] ?? 0;
        out.children[to] = g.children[from] ?? 0;
        out.colors[to * 3] = g.colors[from * 3] ?? 255;
        out.colors[to * 3 + 1] = g.colors[from * 3 + 1] ?? 255;
        out.colors[to * 3 + 2] = g.colors[from * 3 + 2] ?? 255;
        if (far) {
          out.radialFar[to * 2] = far[from * 2];
          out.radialFar[to * 2 + 1] = far[from * 2 + 1];
        }
      }
    }
    // Its place in the raw frame (column i is raw x = startX + (n - 1 - i) step, row j raw z = startZ + j step), and the
    // height edits laid over it as it enters the cache (Map-maker II): every 16 m sample stands on a pole.
    this.farMeta.set(out, { x0: startX + (n - 1) * step, dx: -step, z0: startZ, step, n, raw: null });
    if (this.sampler.heights) this.layFar(out);
    this.farGrids.set(key, out);
    this.farIndex.set(gx0, gz0, size, res, out);
    this.farPlace.set(key, { gx0, gz0, size, res });
    return out;
  }

  /** Shader family painted at a game-space point (0 = none). */
  shaderAt(gx: number, gz: number): number {
    return this.sampler.shaderAt(this.toSwgX(gx), this.toSwgZ(gz));
  }

  /** The environment families the terrain paints, by id: the areas the environment table names. */
  get environmentFamilies(): ReadonlyMap<number, EnvironmentFamily> {
    return this.template.generator.environmentGroup.families;
  }

  /**
   * Environment family at a game-space point (0 = none), generating the covering block if it is
   * not cached. With `season`, a seasonal area there wins over the place underneath.
   */
  environmentAt(gx: number, gz: number, season = false): number {
    const x = this.toSwgX(gx);
    const z = this.toSwgZ(gz);
    const bw = this.sampler.blockWidth;
    // Generating a block here costs a millisecond or more, so it counts as a stall like heightAt's.
    if (!this.sampler.hasBlock(Math.floor(x / bw), Math.floor(z / bw))) this.syncGenerations++;
    return this.sampler.environmentAt(x, z, season);
  }

  /** The same from a cached block only: null when the block covering the point is not generated yet. */
  environmentIfCached(gx: number, gz: number, season = false): number | null {
    const x = this.toSwgX(gx);
    const z = this.toSwgZ(gz);
    const bw = this.sampler.blockWidth;
    if (!this.sampler.hasBlock(Math.floor(x / bw), Math.floor(z / bw))) return null;
    return this.sampler.environmentAt(x, z, season);
  }

  /**
   * The colour map at a game-space point, packed 0xRRGGBB (white where nothing painted it), from a
   * cached block only: null when the block covering the point is not generated yet. Never generates,
   * since an uncached block costs the main thread two to four and a half milliseconds once the pack carries
   * the colour ramps (the affectors then paint every pole; about half a millisecond of that). The ramps stay
   * attached on this thread all the same: a block it generates is the one cached, and one made without them
   * would answer here, and to the ground built from it, with colours the worker's blocks do not have.
   */
  colorIfCached(gx: number, gz: number): number | null {
    return this.sampler.colorAt(this.toSwgX(gx), this.toSwgZ(gz));
  }

  /** The child choice (a byte) at a game-space point, from a cached block only (null when it is not generated). */
  childIfCached(gx: number, gz: number): number | null {
    return this.sampler.childAt(this.toSwgX(gx), this.toSwgZ(gz));
  }

  /**
   * The family, the choice and the colour (0xRRGGBB) of the pole under a game-space point, written into `out`
   * in one lookup, from a cached block only: false when the block is not generated. What a chunk built for the
   * client's tiles reads at each of its samples.
   */
  groundIfCached(gx: number, gz: number, out: { family: number; choice: number; color: number }): boolean {
    return this.sampler.groundAt(this.toSwgX(gx), this.toSwgZ(gz), out);
  }

  /**
   * What the grass reads at the pole under a game-space point, from a cached block only (`TerrainSampler.radialPole`):
   * the near or far radial family and choice, the exclude flag, the colour, the ground's height at the point and
   * its normal there turned into the game's frame (x mirrored). False when the block is not generated. Never
   * generates and allocates nothing: a chunk's grass asks this once a tuft.
   */
  radialPoleIfCached(gx: number, gz: number, far: boolean, out: RadialPole): boolean {
    if (!this.sampler.radialPole(this.toSwgX(gx), this.toSwgZ(gz), far, out)) return false;
    out.nx = -out.nx;
    return true;
  }

  /** Everything the generator says about the pole under a game-space point, worked out afresh on this thread. For the console. */
  probe(gx: number, gz: number): GroundProbe {
    return this.sampler.probe(this.toSwgX(gx), this.toSwgZ(gz));
  }

  /**
   * Game-space centre of the first active area painting a family, seasonal or not, with a radius
   * that stays inside it. Null when no active area names it. An area with no boundaries is the
   * whole map. For the console's "take me to this area".
   */
  environmentAreaCentre(name: string): { x: number; z: number; radius: number } | null {
    const key = name.toLowerCase();
    for (const a of this.template.generator.environmentAreas()) {
      if (!a.active || a.name.toLowerCase() !== key) continue;
      const half = this.template.mapWidthInMeters / 2;
      const r = a.extent ?? { x0: -half, y0: -half, x1: half, y1: half };
      const cx = (r.x0 + r.x1) / 2;
      const cz = (r.y0 + r.y1) / 2;
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
      return { x: this.toGameX(cx), z: this.toGameZ(cz), radius: Math.min(Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0)) / 2 };
    }
    return null;
  }

  private static farKey(gx0: number, gz0: number, size: number, res: number): string {
    return `f:${gx0},${gz0},${size},${res}`;
  }

  releaseFarGrid(gx0: number, gz0: number, size: number, res: number): void {
    const key = SwgTerrain.farKey(gx0, gz0, size, res);
    this.farGrids.delete(key);
    this.farPlace.delete(key);
    this.farIndex.delete(gx0, gz0, size, res);
  }

  /** Forget pole blocks farther than `blockRadius` blocks from a game-space point. */
  evict(gx: number, gz: number, blockRadius: number): void {
    const bw = this.sampler.blockWidth;
    this.sampler.evict(Math.floor(this.toSwgX(gx) / bw), Math.floor(this.toSwgZ(gz) / bw), blockRadius);
  }

  private request(key: string, startX: number, startZ: number, n: number, step: number, resolve: (block: PoleBlock) => void): void {
    const id = this.nextId++;
    this.pending.set(id, { key, resolve, startX, startZ, n, step });
    this.worker!.postMessage({ type: 'generate', id, startX, startZ, n, step });
  }

  /**
   * Whether a grid the worker made at revision `rev` is older than the paint over it (Map-maker II): any 512 m paint tile it
   * reaches marked at a newer revision. Nought tiles marked, nothing is ever older.
   */
  private staleGrid(p: Pending, rev: number): boolean {
    if (!this.tileRev.size) return false;
    const span = (p.n - 1) * p.step;
    return rev < this.revFor(p.startX, p.startZ, p.startX + span, p.startZ + span);
  }

  /**
   * A stand-in for the worker, for a node test (which has none): every message this terrain posts goes to it, and its
   * replies come back through `handleReply`, exactly as the worker's do. Taken as ready.
   */
  useWorkerForTest(w: { postMessage(m: unknown): void; terminate(): void }): void {
    this.worker = w as unknown as Worker;
    this.workerReady = true;
  }

  /** A worker's reply handled as the worker's own `onmessage` hands it over. */
  handleReply(msg: TerrainReply): void {
    this.onMessage(msg);
  }

  private onMessage(msg: TerrainReply): void {
    if (msg.type === 'ready') {
      this.workerReady = true;
      console.info('terrain worker ready', msg.info);
    } else if (msg.type === 'grid' && msg.id !== undefined && msg.heights) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        // Made before the paint over it moved (Map-maker II): asked for again as it was, never put.
        if (this.staleGrid(p, typeof msg.rev === 'number' ? msg.rev : 0)) {
          this.paintWork.stale++;
          const id = this.nextId++;
          this.pending.set(id, p);
          this.worker?.postMessage({ type: 'generate', id, startX: p.startX, startZ: p.startZ, n: p.n, step: p.step });
          return;
        }
        this.requested.delete(p.key);
        const n = msg.heights.length;
        const block: PoleBlock = { heights: msg.heights, shaders: msg.shaders ?? new Int32Array(n), children: msg.children ?? new Uint8Array(n), colors: msg.colors ?? new Uint8Array(n * 3).fill(255), excluded: msg.excluded ?? new Uint8Array(n), floraCollidable: msg.floraCollidable ?? new Uint8Array(n * 2), floraNonCollidable: msg.floraNonCollidable ?? new Uint8Array(n * 2), radialNear: msg.radialNear ?? new Uint8Array(n * 2), radialFar: msg.radialFar ?? new Uint8Array(n * 2), environments: msg.environments ?? new Uint8Array(n), seasonal: msg.seasonal ?? new Uint8Array(n) };
        if (msg.colorsUnpainted) block.colorsUnpainted = msg.colorsUnpainted;
        p.resolve(block);
      }
    } else if (msg.type === 'error') {
      console.warn('terrain worker:', msg.message);
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.requested.clear();
    this.farGrids.clear();
    this.farPlace.clear();
    this.farIndex.clear();
    this.sampler.invalidateAll();
    this.onRepainted = null;
  }
}

/** Client sampling pads, re-exported for callers that build their own grids. */
export const SWG_ORIGIN_OFFSET = ORIGIN_OFFSET;
export const SWG_UPPER_PAD = UPPER_PAD;

function pointInPolygon(x: number, z: number, pts: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
