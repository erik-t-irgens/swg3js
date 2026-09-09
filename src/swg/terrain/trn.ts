// .trn terrain templates (ProceduralTerrainAppearanceTemplate) and a height sampler that
// reproduces the client's chunk layout: poles every half tile, chunks padded by two poles
// on each side, and ground made of eight-triangle fans around each tile's centre pole.

import { BoundaryPolygon, BoundaryRectangle, Layer, ShaderGroup, TerrainGenerator, createChunkData, parseHeightmapFile, remapShaderFamilies, type Bitmap, type ChunkData } from './generator.ts';
import { PackedFixedPointMap, PackedIntegerMap } from './flora.ts';
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
  /** Static flora placement: collidable (trees, rocks) and non-collidable (plants) tiles. */
  flora: {
    collidable: FloraTiling;
    nonCollidable: FloraTiling;
    radial: FloraTiling;
    farRadial: FloraTiling;
    /** Older files sample flora from the generated chunk instead of the baked map. */
    legacyMap: boolean;
    /** Baked collidable flora per 16 m tile (version 15): family id and ground height. */
    collidableMap: PackedIntegerMap | null;
    collidableHeightMap: PackedFixedPointMap | null;
  };
}

export interface FloraTiling {
  minimumDistance: number;
  maximumDistance: number;
  tileSize: number;
  tileBorder: number;
  seed: number;
}

/** A lake or pool: a polygon (SWG coordinates) filled with water at one height. */
export interface WaterTable {
  name: string;
  points: { x: number; y: number }[];
  height: number;
}

/** Every local water table in the layer tree (rivers excluded). */
export function waterTables(generator: TerrainGenerator): WaterTable[] {
  const out: WaterTable[] = [];
  const walk = (layers: Layer[]) => {
    for (const l of layers) {
      if (!l.active) continue;
      for (const b of l.boundaries) {
        if (!b.active) continue;
        if (b instanceof BoundaryRectangle && b.localWaterTable) {
          const r = b.rect;
          out.push({ name: b.name, height: b.localWaterTableHeight, points: [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }] });
        } else if (b instanceof BoundaryPolygon && b.localWaterTable && b.points.length >= 3) {
          out.push({ name: b.name, height: b.localWaterTableHeight, points: b.points.map((p) => ({ x: p.x, y: p.y })) });
        }
      }
      walk(l.layers);
    }
  };
  walk(generator.layers);
  return out;
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
  if (version === 13) {
    // Fields dropped after version 13.
    r.string();
    r.string();
    r.float();
    r.string();
    r.float();
    r.string();
    r.float();
    r.string();
    r.float();
    r.int32();
    r.string();
  }
  const none = (): FloraTiling => ({ minimumDistance: 0, maximumDistance: 0, tileSize: 0, tileBorder: 0, seed: 0 });
  const tiling = (): FloraTiling => (r.remaining >= 20 ? { minimumDistance: r.float(), maximumDistance: r.float(), tileSize: r.float(), tileBorder: r.float(), seed: r.uint32() } : none());
  const flora: TerrainTemplate['flora'] = { collidable: tiling(), nonCollidable: tiling(), radial: tiling(), farRadial: tiling(), legacyMap: version < 15, collidableMap: null, collidableHeightMap: null };
  if (version >= 15 && r.remaining >= 1) flora.legacyMap = r.bool8();
  const tgen = formChild(v, 'TGEN');
  if (!tgen) throw new Error('terrain: missing TGEN');
  const generator = new TerrainGenerator();
  generator.load(tgen);
  t.generator = generator;
  const pimp = formChild(v, 'PIMP');
  const pfpm = formChild(v, 'PFPM');
  if (pimp && pfpm) {
    try {
      flora.collidableMap = new PackedIntegerMap(pimp);
      flora.collidableHeightMap = new PackedFixedPointMap(pfpm);
    } catch (err) {
      generator.unknownTags.set(`flora map: ${(err as Error).message}`, 1);
    }
  }
  t.flora = flora;
  return t as TerrainTemplate;
}

/** Pack-relative file name the converter uses for a terrain bitmap ("terrain/<name>.hmap"). */
export function bitmapFileFor(bitmapName: string): string {
  const base = bitmapName.replace(/\\/g, '/').split('/').pop() ?? bitmapName;
  return `terrain/${base.replace(/\.[^.]*$/, '')}.hmap`;
}

/** Every bitmap family of a template with the pack file it expects. */
export function bitmapFiles(template: TerrainTemplate): { familyId: number; name: string; file: string }[] {
  return [...template.generator.bitmapGroup.families].map(([familyId, f]) => ({ familyId, name: f.bitmapName, file: bitmapFileFor(f.bitmapName) }));
}

/** Attach a converted bitmap ("HMAP" bytes) to its family. Returns false when the bytes are not a heightmap. */
export function attachBitmap(template: TerrainTemplate, familyId: number, bytes: Uint8Array): boolean {
  const image: Bitmap | null = parseHeightmapFile(bytes);
  if (!image) return false;
  template.generator.bitmapGroup.setImage(familyId, image);
  return true;
}

/** A building's terrain-modification layer file (.lay): group forms followed by one LAYR root. */
export function parseLayerFile(bytes: Uint8Array, generator: TerrainGenerator): Layer | null {
  const roots = parseIffRoots(bytes);
  const layr = roots.find((n): n is IffForm => isForm(n) && n.type === 'LAYR');
  if (!layr) return null;
  const layer = new Layer();
  layer.load(layr, generator.fractalGroup);
  // The file's own shader families: match them to the planet's by name (the same file is used
  // on several planets), adding any the planet lacks.
  const sgrp = roots.find((n): n is IffForm => isForm(n) && n.type === 'SGRP');
  if (sgrp) {
    const local = new ShaderGroup();
    local.load(sgrp);
    const map = new Map<number, number>();
    for (const fam of local.families.values()) {
      if (!fam.name || fam.name === 'null') continue;
      const id = generator.shaderGroup.ensure(fam);
      if (id !== fam.id) map.set(fam.id, id);
    }
    if (map.size) remapShaderFamilies(layer, map);
  }
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
  floraCollidable: Uint8Array;
  floraNonCollidable: Uint8Array;
}

/** A cached block of poles: heights plus the per-pole maps flora placement reads. */
export interface PoleBlock {
  heights: Float32Array;
  /** Shader family id at each pole (0 = none), the ground texture the client paints there. */
  shaders: Int32Array;
  excluded: Uint8Array;
  floraCollidable: Uint8Array;
  floraNonCollidable: Uint8Array;
}

export class TerrainSampler {
  readonly generator: TerrainGenerator;
  readonly chunkWidth: number;
  readonly tileWidth: number;
  readonly tilesPerChunk: number;
  readonly poleStep: number;
  /**
   * Poles are cached in blocks of several client chunks: the generator gives identical heights
   * for any grid on the pole lattice, and pruning the layer tree once per 64 m instead of once
   * per 8 m chunk is several times cheaper.
   */
  readonly blockWidth: number;
  readonly tilesPerBlock: number;
  readonly numberOfPoles: number;
  private readonly blocks = new Map<string, PoleBlock>();
  private readonly building: Layer[] = [];
  readonly template: TerrainTemplate;

  constructor(template: TerrainTemplate, blockWidth = 64) {
    this.template = template;
    this.generator = template.generator;
    this.chunkWidth = template.chunkWidthInMeters;
    this.tileWidth = template.tileWidthInMeters;
    this.tilesPerChunk = template.numberOfTilesPerChunk;
    this.poleStep = this.tileWidth * 0.5;
    const chunksPerBlock = Math.max(1, Math.round(blockWidth / this.chunkWidth));
    this.blockWidth = chunksPerBlock * this.chunkWidth;
    this.tilesPerBlock = chunksPerBlock * this.tilesPerChunk;
    this.numberOfPoles = 2 * this.tilesPerBlock + ORIGIN_OFFSET + UPPER_PAD;
  }

  /** Run the generator over an arbitrary pole grid (used for blocks and coarse far tiles). */
  generate(startX: number, startZ: number, n: number, step: number): HeightGrid {
    const d: ChunkData = createChunkData(startX, startZ, n, step, this.generator.fractalGroup, this.generator.shaderGroup, this.generator.bitmapGroup, this.generator.floraGroup);
    this.generator.generateChunk(d);
    return { startX, startZ, n, step, heights: d.heightMap, shaders: d.shaderMap, excluded: d.excludeMap, floraCollidable: d.floraCollidable, floraNonCollidable: d.floraNonCollidable };
  }

  /** Poles of one block: start = block origin minus the two-pole origin offset. */
  blockStart(blockX: number, blockZ: number): { x: number; z: number } {
    return { x: blockX * this.blockWidth - ORIGIN_OFFSET * this.poleStep, z: blockZ * this.blockWidth - ORIGIN_OFFSET * this.poleStep };
  }

  generateBlock(blockX: number, blockZ: number): PoleBlock {
    const key = `${blockX},${blockZ}`;
    let b = this.blocks.get(key);
    if (!b) {
      const s = this.blockStart(blockX, blockZ);
      const g = this.generate(s.x, s.z, this.numberOfPoles, this.poleStep);
      b = { heights: g.heights, shaders: g.shaders, excluded: g.excluded, floraCollidable: g.floraCollidable, floraNonCollidable: g.floraNonCollidable };
      this.blocks.set(key, b);
    }
    return b;
  }

  hasBlock(blockX: number, blockZ: number): boolean {
    return this.blocks.has(`${blockX},${blockZ}`);
  }

  putBlock(blockX: number, blockZ: number, block: PoleBlock): void {
    this.blocks.set(`${blockX},${blockZ}`, block);
  }

  /** Index of the pole a world point maps to within its block (ProceduralTerrainAppearance::Chunk::_findMapXz). */
  private poleIndex(x: number, z: number): { block: PoleBlock; index: number } {
    const bw = this.blockWidth;
    const bx = Math.floor(x / bw);
    const bz = Math.floor(z / bw);
    const block = this.generateBlock(bx, bz);
    const max = 2 * this.tilesPerBlock;
    const px = ORIGIN_OFFSET + Math.min(max, Math.max(0, Math.floor((x - bx * bw) / this.poleStep)));
    const pz = ORIGIN_OFFSET + Math.min(max, Math.max(0, Math.floor((z - bz * bw) / this.poleStep)));
    return { block, index: pz * this.numberOfPoles + px };
  }

  /** Static flora family at a world point (0 = none) and its child choice in [0, 1]. */
  floraAt(x: number, z: number, collidable: boolean): { family: number; choice: number } {
    const { block, index } = this.poleIndex(x, z);
    const map = collidable ? block.floraCollidable : block.floraNonCollidable;
    return { family: map[index * 2], choice: map[index * 2 + 1] / 255 };
  }

  /** Shader family painted at the pole a world point maps to (0 = none). */
  shaderAt(x: number, z: number): number {
    const { block, index } = this.poleIndex(x, z);
    return block.shaders[index] ?? 0;
  }
  /** Whether the generator excluded flora at a world point (AEXC affectors). */
  excludedAt(x: number, z: number): boolean {
    const { block, index } = this.poleIndex(x, z);
    return block.excluded[index] !== 0;
  }

  /** Drop cached blocks farther than `radius` blocks from the given block. */
  evict(blockX: number, blockZ: number, radius: number): void {
    for (const key of this.blocks.keys()) {
      const [x, z] = key.split(',').map(Number);
      if (Math.max(Math.abs(x - blockX), Math.abs(z - blockZ)) > radius) this.blocks.delete(key);
    }
  }

  invalidateAll(): void {
    this.blocks.clear();
  }

  /** Terrain height at a world point, from the tile fans exactly as the client's collision sees them. */
  heightAt(x: number, z: number): number {
    const bw = this.blockWidth;
    const bx = Math.floor(x / bw);
    const bz = Math.floor(z / bw);
    const h = this.generateBlock(bx, bz).heights;
    return sampleFans(h, this.numberOfPoles, this.tilesPerBlock, this.tileWidth, x - bx * bw, z - bz * bw);
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
    this.blocks.clear();
  }

  get buildingLayers(): readonly Layer[] {
    return this.building;
  }
}

/**
 * Height inside one block from its pole grid. Each tile is a fan of eight triangles around
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
