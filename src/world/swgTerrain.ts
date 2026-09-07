// Bridges the game's terrain to a converted planet's real SWG terrain generator.
// Heights are sampled on the main thread from cached pole grids; grids are produced
// ahead of time by a worker so streaming never stalls on generation.

import { Layer } from '../swg/terrain/generator';
import { ORIGIN_OFFSET, parseLayerFile, parseTerrainTemplate, TerrainSampler, UPPER_PAD, type TerrainTemplate } from '../swg/terrain/trn';

export interface BuildingLayerSource {
  bytes: ArrayBuffer;
  /** SWG world position and yaw of the building. */
  x: number;
  z: number;
  yaw: number;
}

interface Pending {
  key: string;
  resolve: (heights: Float32Array) => void;
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
  private readonly farGrids = new Map<string, Float32Array>();
  /** How many chunk grids were generated synchronously on the main thread (diagnostics). */
  syncGenerations = 0;

  private constructor(trn: ArrayBuffer, layers: BuildingLayerSource[], centerX: number, centerZ: number) {
    this.template = parseTerrainTemplate(new Uint8Array(trn));
    this.sampler = new TerrainSampler(this.template);
    this.centerX = centerX;
    this.centerZ = centerZ;
    for (const l of layers) {
      const layer: Layer | null = parseLayerFile(new Uint8Array(l.bytes), this.template.generator);
      if (layer) this.sampler.addBuildingLayer(layer, l.x, l.z, l.yaw);
    }
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('../swg/terrain/worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent) => this.onMessage(e.data);
        this.worker.onerror = (e) => console.warn('terrain worker error', e.message);
        this.worker.postMessage({ type: 'init', trn: trn.slice(0), layers: layers.map((l) => ({ bytes: l.bytes.slice(0), x: l.x, z: l.z, yaw: l.yaw })) });
      } catch (err) {
        console.warn('terrain worker unavailable, generating on the main thread', err);
        this.worker = null;
      }
    }
  }

  static create(trn: ArrayBuffer, layers: BuildingLayerSource[], centerX: number, centerZ: number): SwgTerrain {
    return new SwgTerrain(trn, layers, centerX, centerZ);
  }

  get waterLevel(): number {
    return this.template.useGlobalWaterTable ? this.template.globalWaterTableHeight : -Infinity;
  }

  get tileWidth(): number {
    return this.template.tileWidthInMeters;
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
    const cw = this.sampler.chunkWidth;
    const cx = Math.floor(x / cw);
    const cz = Math.floor(z / cw);
    if (!this.sampler.hasChunk(cx, cz)) this.syncGenerations++;
    return this.sampler.heightAt(x, z);
  }

  /** Whether a game-space corner lies on a tile centre pole, which decides the ground triangulation. */
  isTileCentre(gx: number, gz: number): boolean {
    const tw = this.tileWidth;
    const half = tw * 0.5;
    const mod = (v: number) => ((v % tw) + tw) % tw;
    return Math.abs(mod(this.toSwgX(gx)) - half) < 1e-3 && Math.abs(mod(this.toSwgZ(gz)) - half) < 1e-3;
  }

  /** SWG chunk keys covering a game-space square (with a one-pole margin for normals). */
  private chunksCovering(gx0: number, gz0: number, size: number): { cx: number; cz: number }[] {
    const cw = this.sampler.chunkWidth;
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
    for (const { cx, cz } of this.chunksCovering(gx0, gz0, size)) {
      if (this.sampler.hasChunk(cx, cz)) continue;
      if (sync || !this.worker || !this.workerReady) {
        this.sampler.generateChunk(cx, cz);
        this.syncGenerations++;
        continue;
      }
      ready = false;
      const key = `c:${cx},${cz}`;
      if (this.requested.has(key)) continue;
      this.requested.add(key);
      const s = this.sampler.chunkStart(cx, cz);
      this.request(key, s.x, s.z, this.sampler.numberOfPoles, this.sampler.poleStep, (heights) => {
        if (!this.sampler.hasChunk(cx, cz)) this.sampler.putChunk(cx, cz, heights);
      });
    }
    return ready;
  }

  /**
   * Coarse samples for a far tile: `res + 3` columns and rows across `size` metres, one step
   * beyond the tile on each side (the layout Terrain.buildGrid expects), generated directly at
   * that spacing. Returns null until the worker has produced it.
   */
  farGrid(gx0: number, gz0: number, size: number, res: number, sync: boolean): Float32Array | null {
    const key = SwgTerrain.farKey(gx0, gz0, size, res);
    const cached = this.farGrids.get(key);
    if (cached) return cached;
    const step = size / res;
    // Generated in SWG space, where X runs the other way: column i of the result is game x = gx0 + (i - 1) * step.
    const n = res + 3;
    const startX = this.toSwgX(gx0 + (res + 1) * step);
    const startZ = this.toSwgZ(gz0 - step);
    const finish = (heights: Float32Array) => {
      const out = new Float32Array(n * n);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) out[j * n + i] = heights[j * n + (n - 1 - i)];
      }
      this.farGrids.set(key, out);
      return out;
    };
    if (sync || !this.worker || !this.workerReady) {
      this.syncGenerations++;
      return finish(this.sampler.generate(startX, startZ, n, step).heights);
    }
    if (!this.requested.has(key)) {
      this.requested.add(key);
      this.request(key, startX, startZ, n, step, (heights) => void finish(heights));
    }
    return null;
  }

  private static farKey(gx0: number, gz0: number, size: number, res: number): string {
    return `f:${gx0},${gz0},${size},${res}`;
  }

  releaseFarGrid(gx0: number, gz0: number, size: number, res: number): void {
    this.farGrids.delete(SwgTerrain.farKey(gx0, gz0, size, res));
  }

  /** Forget chunk grids farther than `chunkRadius` SWG chunks from a game-space point. */
  evict(gx: number, gz: number, chunkRadius: number): void {
    const cw = this.sampler.chunkWidth;
    this.sampler.evict(Math.floor(this.toSwgX(gx) / cw), Math.floor(this.toSwgZ(gz) / cw), chunkRadius);
  }

  private request(key: string, startX: number, startZ: number, n: number, step: number, resolve: (heights: Float32Array) => void): void {
    const id = this.nextId++;
    this.pending.set(id, { key, resolve });
    this.worker!.postMessage({ type: 'generate', id, startX, startZ, n, step });
  }

  private onMessage(msg: { type: string; id?: number; heights?: Float32Array; info?: unknown; message?: string }): void {
    if (msg.type === 'ready') {
      this.workerReady = true;
      console.info('terrain worker ready', msg.info);
    } else if (msg.type === 'grid' && msg.id !== undefined && msg.heights) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        this.requested.delete(p.key);
        p.resolve(msg.heights);
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
