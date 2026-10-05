import * as THREE from 'three';
// Bridges the game's terrain to a converted planet's real SWG terrain generator.
// Heights are sampled on the main thread from cached pole grids; grids are produced
// ahead of time by a worker so streaming never stalls on generation.

import type { EnvironmentFamily, Layer } from '../swg/terrain/generator.ts';
import { attachBitmap, attachRamp, bitmapFiles, ORIGIN_OFFSET, parseLayerFile, parseTerrainTemplate, rampNames, readColorRampFile, TerrainSampler, UPPER_PAD, waterTables, type ColorRamp, type GroundProbe, type PoleBlock, type TerrainTemplate } from '../swg/terrain/trn.ts';

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
}

/** Where the pack keeps the colour ramps the colour affectors read (the terrain command's to write, `colorRampFile`'s shape). */
export const COLOR_RAMP_FILE = 'terrain/colorramps.json';

interface Pending {
  key: string;
  resolve: (block: PoleBlock) => void;
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
  /** How many chunk grids were generated synchronously on the main thread (diagnostics). */
  syncGenerations = 0;
  /** Lakes, pools and lava flows in game coordinates. */
  readonly waterTables: SwgWaterTable[] = [];
  /** The colour ramps the terrain's colour affectors name, and which of them the pack carried. */
  readonly ramps: { named: string[]; loaded: number };

  private constructor(trn: ArrayBuffer, layers: BuildingLayerSource[], bitmaps: { familyId: number; bytes: ArrayBuffer }[], ramps: Map<string, ColorRamp>, centerX: number, centerZ: number) {
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
    this.centerX = centerX;
    this.centerZ = centerZ;
    for (const l of layers) {
      const layer: Layer | null = parseLayerFile(new Uint8Array(l.bytes), this.template.generator);
      if (layer) this.sampler.addBuildingLayer(layer, l.x, l.z, l.yaw);
    }
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
    if (typeof Worker !== 'undefined') {
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
  static async create(trn: ArrayBuffer, layers: BuildingLayerSource[], centerX: number, centerZ: number, fetchBytes: (file: string) => Promise<ArrayBuffer | null>): Promise<SwgTerrain> {
    const probe = parseTerrainTemplate(new Uint8Array(trn));
    const bitmaps: { familyId: number; bytes: ArrayBuffer }[] = [];
    for (const b of bitmapFiles(probe)) {
      const bytes = await fetchBytes(b.file);
      if (bytes) bitmaps.push({ familyId: b.familyId, bytes });
      else console.warn(`terrain: bitmap ${b.file} (${b.name}) missing; its filter passes everywhere`);
    }
    // A pack converted before the ramps were written has none, and every ramp affector then does
    // nothing, as the client's does for an image it cannot load: the colour map is the constants'.
    let ramps = new Map<string, ColorRamp>();
    if (rampNames(probe).length) {
      const bytes = await fetchBytes(COLOR_RAMP_FILE);
      if (bytes) {
        try {
          ramps = readColorRampFile(JSON.parse(new TextDecoder().decode(bytes)));
        } catch (err) {
          console.warn(`terrain: ${COLOR_RAMP_FILE} could not be read; the colour ramps do nothing`, err);
        }
      }
    }
    return new SwgTerrain(trn, layers, bitmaps, ramps, centerX, centerZ);
  }

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
    const tx = Math.floor(gx / farSize);
    const tz = Math.floor(gz / farSize);
    const grid = this.farGrids.get(SwgTerrain.farKey(tx * farSize, tz * farSize, farSize, farRes));
    if (!grid) return null;
    const step = farSize / farRes;
    const n = farRes + 3;
    // Column i is game x = gx0 + (i - 1) * step; row j likewise in z.
    const fx = THREE.MathUtils.clamp((gx - tx * farSize) / step + 1, 0, n - 1.001);
    const fz = THREE.MathUtils.clamp((gz - tz * farSize) / step + 1, 0, n - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h = grid.heights;
    return (h[j * n + i] * (1 - u) + h[j * n + i + 1] * u) * (1 - v) + (h[(j + 1) * n + i] * (1 - u) + h[(j + 1) * n + i + 1] * u) * v;
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
    const finish = (g: { heights: Float32Array; shaders: Int32Array; children: Uint8Array; colors: Uint8Array }) => {
      const out: FarGrid = { heights: new Float32Array(n * n), shaders: new Int32Array(n * n), children: new Uint8Array(n * n), colors: new Uint8Array(n * n * 3) };
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
        }
      }
      this.farGrids.set(key, out);
      return out;
    };
    if (sync || !this.worker || !this.workerReady) {
      this.syncGenerations++;
      return finish(this.sampler.generate(startX, startZ, n, step));
    }
    if (!this.requested.has(key)) {
      this.requested.add(key);
      this.request(key, startX, startZ, n, step, (block) => void finish(block));
    }
    return null;
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
   * since an uncached block costs the main thread one to four milliseconds.
   */
  colorIfCached(gx: number, gz: number): number | null {
    return this.sampler.colorAt(this.toSwgX(gx), this.toSwgZ(gz));
  }

  /** The child choice (a byte) at a game-space point, from a cached block only (null when it is not generated). */
  childIfCached(gx: number, gz: number): number | null {
    return this.sampler.childAt(this.toSwgX(gx), this.toSwgZ(gz));
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
    this.farGrids.delete(SwgTerrain.farKey(gx0, gz0, size, res));
  }

  /** Forget pole blocks farther than `blockRadius` blocks from a game-space point. */
  evict(gx: number, gz: number, blockRadius: number): void {
    const bw = this.sampler.blockWidth;
    this.sampler.evict(Math.floor(this.toSwgX(gx) / bw), Math.floor(this.toSwgZ(gz) / bw), blockRadius);
  }

  private request(key: string, startX: number, startZ: number, n: number, step: number, resolve: (block: PoleBlock) => void): void {
    const id = this.nextId++;
    this.pending.set(id, { key, resolve });
    this.worker!.postMessage({ type: 'generate', id, startX, startZ, n, step });
  }

  private onMessage(msg: { type: string; id?: number; heights?: Float32Array; shaders?: Int32Array; children?: Uint8Array; colors?: Uint8Array; excluded?: Uint8Array; floraCollidable?: Uint8Array; floraNonCollidable?: Uint8Array; environments?: Uint8Array; seasonal?: Uint8Array; info?: unknown; message?: string }): void {
    if (msg.type === 'ready') {
      this.workerReady = true;
      console.info('terrain worker ready', msg.info);
    } else if (msg.type === 'grid' && msg.id !== undefined && msg.heights) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        this.requested.delete(p.key);
        const n = msg.heights.length;
        p.resolve({ heights: msg.heights, shaders: msg.shaders ?? new Int32Array(n), children: msg.children ?? new Uint8Array(n), colors: msg.colors ?? new Uint8Array(n * 3).fill(255), excluded: msg.excluded ?? new Uint8Array(n), floraCollidable: msg.floraCollidable ?? new Uint8Array(n * 2), floraNonCollidable: msg.floraNonCollidable ?? new Uint8Array(n * 2), environments: msg.environments ?? new Uint8Array(n), seasonal: msg.seasonal ?? new Uint8Array(n) });
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
    this.sampler.invalidateAll();
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
