import * as THREE from 'three';
// Bridges the game's terrain to a converted planet's real SWG terrain generator.
// Heights are sampled on the main thread from cached pole grids; grids are produced
// ahead of time by a worker so streaming never stalls on generation.

import { Layer, type EnvironmentFamily } from '../swg/terrain/generator';
import { attachBitmap, bitmapFiles, ORIGIN_OFFSET, parseLayerFile, parseTerrainTemplate, TerrainSampler, UPPER_PAD, waterTables, type PoleBlock, type TerrainTemplate, type WaterTable } from '../swg/terrain/trn';

export interface BuildingLayerSource {
  bytes: ArrayBuffer;
  /** SWG world position and yaw of the building. */
  x: number;
  z: number;
  yaw: number;
}

/** Coarse samples for a far tile: heights and shader family per sample. */
export interface FarGrid {
  heights: Float32Array;
  shaders: Int32Array;
}

interface Pending {
  key: string;
  resolve: (block: PoleBlock) => void;
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
  /** Lakes and pools in game coordinates. */
  readonly waterTables: { name: string; points: { x: number; z: number }[]; height: number }[] = [];

  private constructor(trn: ArrayBuffer, layers: BuildingLayerSource[], bitmaps: { familyId: number; bytes: ArrayBuffer }[], centerX: number, centerZ: number) {
    this.template = parseTerrainTemplate(new Uint8Array(trn));
    for (const b of bitmaps) attachBitmap(this.template, b.familyId, new Uint8Array(b.bytes));
    this.sampler = new TerrainSampler(this.template);
    this.centerX = centerX;
    this.centerZ = centerZ;
    for (const l of layers) {
      const layer: Layer | null = parseLayerFile(new Uint8Array(l.bytes), this.template.generator);
      if (layer) this.sampler.addBuildingLayer(layer, l.x, l.z, l.yaw);
    }
    for (const w of waterTables(this.template.generator)) {
      this.waterTables.push({ name: w.name, height: w.height, points: w.points.map((pt) => ({ x: this.toGameX(pt.x), z: this.toGameZ(pt.y) })) });
    }
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('../swg/terrain/worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent) => this.onMessage(e.data);
        this.worker.onerror = (e) => console.warn('terrain worker error', e.message);
        this.worker.postMessage({
          type: 'init',
          trn: trn.slice(0),
          layers: layers.map((l) => ({ bytes: l.bytes.slice(0), x: l.x, z: l.z, yaw: l.yaw })),
          bitmaps: bitmaps.map((b) => ({ familyId: b.familyId, bytes: b.bytes.slice(0) })),
        });
      } catch (err) {
        console.warn('terrain worker unavailable, generating on the main thread', err);
        this.worker = null;
      }
    }
  }

  /**
   * Build the terrain: parses the template once to learn which bitmap files it needs, fetches
   * them through `fetchBytes` (pack-relative paths), then starts the worker.
   */
  static async create(trn: ArrayBuffer, layers: BuildingLayerSource[], centerX: number, centerZ: number, fetchBytes: (file: string) => Promise<ArrayBuffer | null>): Promise<SwgTerrain> {
    const probe = parseTerrainTemplate(new Uint8Array(trn));
    const bitmaps: { familyId: number; bytes: ArrayBuffer }[] = [];
    for (const b of bitmapFiles(probe)) {
      const bytes = await fetchBytes(b.file);
      if (bytes) bitmaps.push({ familyId: b.familyId, bytes });
      else console.warn(`terrain: bitmap ${b.file} (${b.name}) missing; its filter passes everywhere`);
    }
    return new SwgTerrain(trn, layers, bitmaps, centerX, centerZ);
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
      if (w.height > h && pointInPolygon(gx, gz, w.points)) h = w.height;
    }
    return h;
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
    const finish = (heights: Float32Array, shaders: Int32Array) => {
      const out: FarGrid = { heights: new Float32Array(n * n), shaders: new Int32Array(n * n) };
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          out.heights[j * n + i] = heights[j * n + (n - 1 - i)];
          out.shaders[j * n + i] = shaders[j * n + (n - 1 - i)] ?? 0;
        }
      }
      this.farGrids.set(key, out);
      return out;
    };
    if (sync || !this.worker || !this.workerReady) {
      this.syncGenerations++;
      const g = this.sampler.generate(startX, startZ, n, step);
      return finish(g.heights, g.shaders);
    }
    if (!this.requested.has(key)) {
      this.requested.add(key);
      this.request(key, startX, startZ, n, step, (block) => void finish(block.heights, block.shaders));
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

  private onMessage(msg: { type: string; id?: number; heights?: Float32Array; shaders?: Int32Array; excluded?: Uint8Array; floraCollidable?: Uint8Array; floraNonCollidable?: Uint8Array; environments?: Uint8Array; seasonal?: Uint8Array; info?: unknown; message?: string }): void {
    if (msg.type === 'ready') {
      this.workerReady = true;
      console.info('terrain worker ready', msg.info);
    } else if (msg.type === 'grid' && msg.id !== undefined && msg.heights) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        this.requested.delete(p.key);
        const n = msg.heights.length;
        p.resolve({ heights: msg.heights, shaders: msg.shaders ?? new Int32Array(n), excluded: msg.excluded ?? new Uint8Array(n), floraCollidable: msg.floraCollidable ?? new Uint8Array(n * 2), floraNonCollidable: msg.floraNonCollidable ?? new Uint8Array(n * 2), environments: msg.environments ?? new Uint8Array(n), seasonal: msg.seasonal ?? new Uint8Array(n) });
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
