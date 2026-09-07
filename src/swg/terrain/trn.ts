// .trn terrain templates (ProceduralTerrainAppearanceTemplate) and a height sampler that
// reproduces the client's chunk layout: poles every half tile, chunks padded by two poles
// on each side, and ground made of eight-triangle fans around each tile's centre pole.

import { Layer, TerrainGenerator, createChunkData, type ChunkData } from './generator.ts';
import { ChunkReader, chunkChild, formChild, isForm, parseIff, parseIffRoots, type IffForm } from './iff.ts';

export interface TerrainTemplate {
  name: string;
  mapWidthInMeters: number;
  chunkWidthInMeters: number;
  numberOfTilesPerChunk: number;
  tileWidthInMeters: number;
  useGlobalWaterTable: boolean;
  globalWaterTableHeight: number;
  globalWaterTableShaderSize: number;
  globalWaterTableShaderTemplateName: string;
  environmentCycleTime: number;
  version: number;
  generator: TerrainGenerator;
}

/** Client chunk sampling parameters (ClientProceduralTerrainAppearanceTemplate: originOffset 2, upperPad 2). */
export const ORIGIN_OFFSET = 2;
export const UPPER_PAD = 2;

export function parseTerrainTemplate(bytes: Uint8Array): TerrainTemplate {
  const root = parseIff(bytes);
  if (root.type !== 'PTAT' && root.type !== 'MPTA') throw new Error(`terrain: unexpected root ${root.type}`);
  const v = root.children[0];
  if (!v || !isForm(v)) throw new Error('terrain: missing version form');
  const version = Number.parseInt(v.type, 10);
  if (!(version >= 13 && version <= 15)) throw new Error(`terrain: unsupported version ${v.type}`);
  const data = chunkChild(v, 'DATA');
  if (!data) throw new Error('terrain: missing header');
  const r = new ChunkReader(data.data);
  const t: Partial<TerrainTemplate> = { version };
  t.name = r.string();
  t.mapWidthInMeters = r.float();
  t.chunkWidthInMeters = r.float();
  t.numberOfTilesPerChunk = r.int32();
  t.useGlobalWaterTable = r.int32() !== 0;
  t.globalWaterTableHeight = r.float();
  t.globalWaterTableShaderSize = r.float();
  t.globalWaterTableShaderTemplateName = r.string();
  t.environmentCycleTime = r.float();
  t.tileWidthInMeters = t.chunkWidthInMeters / t.numberOfTilesPerChunk;
  const tgen = formChild(v, 'TGEN');
  if (!tgen) throw new Error('terrain: missing TGEN');
  const generator = new TerrainGenerator();
  generator.load(tgen);
  t.generator = generator;
  return t as TerrainTemplate;
}

/** A building's terrain-modification layer file (.lay): group forms followed by one LAYR root. */
export function parseLayerFile(bytes: Uint8Array, generator: TerrainGenerator): Layer | null {
  const roots = parseIffRoots(bytes);
  const layr = roots.find((n): n is IffForm => isForm(n) && n.type === 'LAYR');
  if (!layr) return null;
  const layer = new Layer();
  layer.load(layr, generator.fractalGroup);
  return layer;
}

/** A generated block of poles at an arbitrary origin and spacing. */
export interface HeightGrid {
  startX: number;
  startZ: number;
  n: number;
  step: number;
  heights: Float32Array;
  shaders: Int32Array;
  excluded: Uint8Array;
}

export class TerrainSampler {
  readonly generator: TerrainGenerator;
  readonly chunkWidth: number;
  readonly tileWidth: number;
  readonly tilesPerChunk: number;
  readonly poleStep: number;
  readonly numberOfPoles: number;
  private readonly chunks = new Map<string, Float32Array>();
  private readonly building: Layer[] = [];
  readonly template: TerrainTemplate;

  constructor(template: TerrainTemplate) {
    this.template = template;
    this.generator = template.generator;
    this.chunkWidth = template.chunkWidthInMeters;
    this.tileWidth = template.tileWidthInMeters;
    this.tilesPerChunk = template.numberOfTilesPerChunk;
    this.poleStep = this.tileWidth * 0.5;
    this.numberOfPoles = 2 * this.tilesPerChunk + ORIGIN_OFFSET + UPPER_PAD;
  }

  /** Run the generator over an arbitrary pole grid (used for chunks and coarse far tiles). */
  generate(startX: number, startZ: number, n: number, step: number): HeightGrid {
    const d: ChunkData = createChunkData(startX, startZ, n, step, this.generator.fractalGroup, this.generator.shaderGroup);
    this.generator.generateChunk(d);
    return { startX, startZ, n, step, heights: d.heightMap, shaders: d.shaderMap, excluded: d.excludeMap };
  }

  /** Poles of one client chunk: start = chunk origin minus the two-pole origin offset. */
  chunkStart(chunkX: number, chunkZ: number): { x: number; z: number } {
    return { x: chunkX * this.chunkWidth - ORIGIN_OFFSET * this.poleStep, z: chunkZ * this.chunkWidth - ORIGIN_OFFSET * this.poleStep };
  }

  generateChunk(chunkX: number, chunkZ: number): Float32Array {
    const key = `${chunkX},${chunkZ}`;
    let h = this.chunks.get(key);
    if (!h) {
      const s = this.chunkStart(chunkX, chunkZ);
      h = this.generate(s.x, s.z, this.numberOfPoles, this.poleStep).heights;
      this.chunks.set(key, h);
    }
    return h;
  }

  hasChunk(chunkX: number, chunkZ: number): boolean {
    return this.chunks.has(`${chunkX},${chunkZ}`);
  }

  putChunk(chunkX: number, chunkZ: number, heights: Float32Array): void {
    this.chunks.set(`${chunkX},${chunkZ}`, heights);
  }

  /** Drop cached chunks farther than `radius` chunks from the given chunk. */
  evict(chunkX: number, chunkZ: number, radius: number): void {
    for (const key of this.chunks.keys()) {
      const [x, z] = key.split(',').map(Number);
      if (Math.max(Math.abs(x - chunkX), Math.abs(z - chunkZ)) > radius) this.chunks.delete(key);
    }
  }

  invalidateAll(): void {
    this.chunks.clear();
  }

  /** Terrain height at a world point, from the tile fans exactly as the client's collision sees them. */
  heightAt(x: number, z: number): number {
    const cw = this.chunkWidth;
    const chunkX = Math.floor(x / cw);
    const chunkZ = Math.floor(z / cw);
    const h = this.generateChunk(chunkX, chunkZ);
    return sampleFans(h, this.numberOfPoles, this.tilesPerChunk, this.tileWidth, x - chunkX * cw, z - chunkZ * cw);
  }

  /** Base terrain height at a point, excluding building modifications (generateHeight_expensive on an empty generator). */
  baseHeightAt(x: number, z: number): number {
    const saved = this.generator.layers;
    this.generator.layers = saved.filter((l) => !this.building.includes(l));
    try {
      const n = 2 + ORIGIN_OFFSET + UPPER_PAD;
      const s = this.poleStep;
      const g = this.generate(x - ORIGIN_OFFSET * s, z - ORIGIN_OFFSET * s, n, s);
      return g.heights[ORIGIN_OFFSET * n + ORIGIN_OFFSET];
    } finally {
      this.generator.layers = saved;
    }
  }

  /**
   * Add a building's modification layer the way the client does: boundaries moved to the
   * building, rotated by its yaw, and every height constant set to the ground height there.
   */
  addBuildingLayer(layer: Layer, x: number, z: number, yaw: number): void {
    layer.setPosition(x, z);
    layer.setRotation(yaw);
    layer.setModificationHeight(this.baseHeightAt(x, z));
    layer.prepare();
    layer.calculateExtent();
    this.generator.addLayer(layer);
    this.building.push(layer);
    this.chunks.clear();
  }

  get buildingLayers(): readonly Layer[] {
    return this.building;
  }
}

/**
 * Height inside one chunk from its pole grid. Each tile is a fan of eight triangles around
 * its centre pole; pick the triangle containing the point and interpolate on its plane.
 */
export function sampleFans(h: Float32Array, n: number, tilesPerChunk: number, tileWidth: number, lx: number, lz: number): number {
  const clampIdx = (v: number) => Math.max(0, Math.min(tilesPerChunk - 1, v));
  const tx = clampIdx(Math.floor(lx / tileWidth));
  const tz = clampIdx(Math.floor(lz / tileWidth));
  // Position inside the tile in pole units, [0, 2].
  let u = (lx - tx * tileWidth) / (tileWidth * 0.5);
  let v = (lz - tz * tileWidth) / (tileWidth * 0.5);
  u = Math.max(0, Math.min(2, u));
  v = Math.max(0, Math.min(2, v));
  const px = ORIGIN_OFFSET + tx * 2;
  const pz = ORIGIN_OFFSET + tz * 2;
  const at = (i: number, j: number) => h[(pz + j) * n + (px + i)];
  // Quadrant corner farthest from the centre and the two rim points that close it.
  const cu = u < 1 ? 0 : 2;
  const cv = v < 1 ? 0 : 2;
  const du = Math.abs(u - 1);
  const dv = Math.abs(v - 1);
  const hc = at(1, 1);
  // Triangle (centre, corner, rim point on the u axis) when |du| >= |dv|, else with the rim point on the v axis.
  let hu: number;
  let hv: number;
  if (du >= dv) {
    hu = at(cu, 1); // rim point straight along u from the centre
    hv = at(cu, cv); // corner
    // barycentric in (centre, rimU, corner): move du along u to rimU, then dv toward the corner
    return hc + (hu - hc) * du + (hv - hu) * dv;
  }
  hv = at(1, cv);
  hu = at(cu, cv);
  return hc + (hv - hc) * dv + (hu - hv) * du;
}
