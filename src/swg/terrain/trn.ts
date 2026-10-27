// .trn terrain templates (ProceduralTerrainAppearanceTemplate) and a height sampler that
// reproduces the client's chunk layout: poles every half tile, chunks padded by two poles
// on each side, and ground made of eight-triangle fans around each tile's centre pole.

import { BoundaryPolygon, BoundaryRectangle, Layer, ShaderGroup, TerrainGenerator, childIndexOf, colourAffectorInfo, createChunkData, parseHeightmapFile, rampKey, remapShaderFamilies, type Affector, type Bitmap, type ChunkData, type ColorRamp } from './generator.ts';
import { PackedFixedPointMap, PackedIntegerMap } from './flora.ts';
import { ChunkReader, chunkChild, formChild, isForm, parseIff, parseIffRoots, type IffForm } from './iff.ts';
import { shaderKey } from './shaderKey.ts';
import { layAsk, type HeightEdits } from './heightEdits.ts';
import type { GroundPaint } from './groundPaint.ts';

export { shaderKey, rampKey, type ColorRamp };

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

/** A lake, pool or lava flow: a polygon (SWG coordinates) filled at one height, drawn with a water shader. */
export interface WaterTable {
  name: string;
  points: { x: number; y: number }[];
  height: number;
  /** The shader as shaderKey gives it ("wter_spec"); '' when the terrain names none. */
  shader: string;
  /** 0 water, 1 lava (BoundaryRectangle v4+, BoundaryPolygon v7+; 0 before). */
  waterType: number;
  /** Metres per repeat of the shader's textures. */
  shaderSize: number;
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
          out.push({ name: b.name, height: b.localWaterTableHeight, points: [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }], shader: shaderKey(b.localWaterTableShaderTemplateName), waterType: b.waterType, shaderSize: b.localWaterTableShaderSize });
        } else if (b instanceof BoundaryPolygon && b.localWaterTable && b.points.length >= 3) {
          out.push({ name: b.name, height: b.localWaterTableHeight, points: b.points.map((p) => ({ x: p.x, y: p.y })), shader: shaderKey(b.localWaterTableShaderTemplateName), waterType: b.waterType, shaderSize: b.localWaterTableShaderSize });
        }
      }
      walk(l.layers);
    }
  };
  walk(generator.layers);
  return out;
}

/** One water shader a terrain uses, with how many local tables draw with it and which water types they are. */
export interface WaterShaderUse {
  /** The shader as shaderKey gives it. */
  shader: string;
  /** Every distinct water type of the tables using it, ascending (0 water, 1 lava). */
  waterTypes: number[];
  /** How many local tables use it (the global table is not counted here). */
  tables: number;
  /** Whether the terrain's global water table is drawn with it. */
  global: boolean;
}

/**
 * Every water shader the terrain uses: the global table's and each active local table's, keyed by
 * shaderKey, with how many tables and which water types. Sorted by shader; names that key to '' are
 * skipped, so the converter, the pack and the game always agree on one spelling.
 */
export function waterShaderUses(template: TerrainTemplate): WaterShaderUse[] {
  const byKey = new Map<string, { shader: string; types: Set<number>; tables: number; global: boolean }>();
  const entry = (key: string) => {
    let e = byKey.get(key);
    if (!e) byKey.set(key, (e = { shader: key, types: new Set<number>(), tables: 0, global: false }));
    return e;
  };
  if (template.useGlobalWaterTable) {
    const key = shaderKey(template.globalWaterTableShaderTemplateName);
    if (key) {
      const e = entry(key);
      e.global = true;
      e.types.add(0);
    }
  }
  for (const w of waterTables(template.generator)) {
    if (!w.shader) continue;
    const e = entry(w.shader);
    e.tables++;
    e.types.add(w.waterType);
  }
  return [...byKey.values()]
    .map((e) => ({ shader: e.shader, waterTypes: [...e.types].sort((a, b) => a - b), tables: e.tables, global: e.global }))
    .sort((a, b) => (a.shader < b.shader ? -1 : a.shader > b.shader ? 1 : 0));
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
  // The engine lays families on every fourth pole from a chunk's corner: two tiles, 8 m on every world.
  generator.familyLattice = 2 * t.tileWidthInMeters;
  generator.legacy = flora.legacyMap;
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

/** Every colour ramp a template's colour affectors name, keyed (`colorramp/tatooine_dirt.tga`). */
export function rampNames(template: TerrainTemplate): string[] {
  return template.generator.rampNames();
}

/**
 * Attach a colour ramp to its name, as `attachBitmap` attaches a bitmap: the affectors naming it
 * read it from the next block generated. Returns false for a ramp with no pixels.
 */
export function attachRamp(template: TerrainTemplate, name: string, ramp: ColorRamp): boolean {
  if (!(ramp.width > 0) || ramp.rgb.length < ramp.width * 3) return false;
  template.generator.rampGroup.set(name, ramp);
  return true;
}

/** A ramp from a decoded image: its first row, as the engine reads it, three bytes a pixel. */
export function rampFromImage(width: number, rgba: Uint8Array, channels = 4): ColorRamp {
  const rgb = new Uint8Array(width * 3);
  for (let i = 0; i < width; i++) {
    rgb[i * 3] = rgba[i * channels];
    rgb[i * 3 + 1] = rgba[i * channels + 1];
    rgb[i * 3 + 2] = rgba[i * channels + 2];
  }
  return { width, rgb };
}

/**
 * How bright a world's colour map runs, which a tint normalised for brightness divides by: what the
 * terrain command measured over the whole map with this generator (`colorReference` in
 * `tools/swg/terrainShaders.mjs`), every `step` metres, counting only the places that are not black,
 * since a world can paint everything outside its play squares black (Kashyyyk's Rryatt trail). The
 * medians are of the bytes as they stand, in the client's own gamma space: the Rec. 709 luminance and
 * each channel apart, each 0..1. Ours as a measure; the colours it measures are the client's.
 */
export interface ColorReference {
  step: number;
  /** How many places were sampled, and how many of them were not black (the only ones counted). */
  points: number;
  nonBlack: number;
  luminance: number;
  rgb: [number, number, number];
}

/**
 * The pack's colour ramps (`terrain/colorramps.json`, the terrain command's to write): `ramps`, each
 * keyed name to `{ width, rgb }` with `rgb` three numbers a pixel, and the world's `reference` when it
 * was measured. Anything else in the file is left for its own reader. `colorRampFile` writes this
 * shape and `readColorRampFile` and `readColorReference` read it back, so the converter and the game
 * cannot drift apart; a pack without the file has no ramps, and a colour affector with no ramp does
 * nothing, as in the client.
 */
export function colorRampFile(ramps: Map<string, ColorRamp>, reference?: ColorReference | null): { ramps: Record<string, { width: number; rgb: number[] }>; reference?: ColorReference | null } {
  const out: Record<string, { width: number; rgb: number[] }> = {};
  for (const key of [...ramps.keys()].sort()) {
    const r = ramps.get(key)!;
    out[rampKey(key)] = { width: r.width, rgb: [...r.rgb.subarray(0, r.width * 3)] };
  }
  return reference === undefined ? { ramps: out } : { ramps: out, reference };
}

/** The world's brightness reference out of the pack's colour ramp file; null for a file that has none, or one not of this shape. */
export function readColorReference(json: unknown): ColorReference | null {
  const r = (json as { reference?: unknown } | null)?.reference as Partial<ColorReference> | null | undefined;
  if (!r || typeof r !== 'object') return null;
  const unit = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;
  if (!unit(r.luminance) || !Array.isArray(r.rgb) || r.rgb.length !== 3 || !r.rgb.every(unit)) return null;
  const step = Number(r.step);
  const points = Number(r.points);
  const nonBlack = Number(r.nonBlack);
  if (!(step > 0) || !Number.isInteger(points) || !Number.isInteger(nonBlack) || nonBlack <= 0 || nonBlack > points) return null;
  return { step, points, nonBlack, luminance: r.luminance as number, rgb: [r.rgb[0], r.rgb[1], r.rgb[2]] };
}

export function readColorRampFile(json: unknown): Map<string, ColorRamp> {
  const out = new Map<string, ColorRamp>();
  const ramps = (json as { ramps?: unknown } | null)?.ramps;
  if (!ramps || typeof ramps !== 'object') return out;
  for (const [key, raw] of Object.entries(ramps as Record<string, unknown>)) {
    const r = raw as { width?: unknown; rgb?: unknown };
    const width = Number(r?.width);
    if (!Number.isInteger(width) || width <= 0 || !Array.isArray(r.rgb) || r.rgb.length < width * 3) continue;
    out.set(rampKey(key), { width, rgb: Uint8Array.from(r.rgb.slice(0, width * 3) as number[]) });
  }
  return out;
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
  // A layer file's environment families are its own and are not matched to the planet's, so any
  // environment affector it carries is counted and then made inert: painting its family id into
  // the planet's map would give that id the planet's meaning.
  generator.noteEnvironment([layer], true);
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
  /** Each pole's choice among its family's alternates (a byte) and the colour map, three bytes a pole. */
  children: Uint8Array;
  colors: Uint8Array;
  excluded: Uint8Array;
  floraCollidable: Uint8Array;
  floraNonCollidable: Uint8Array;
  /** Radial flora, family and choice pairs: the near grass (AFDN) and the far hills' tree cards (AFDF). */
  radialNear: Uint8Array;
  radialFar: Uint8Array;
  /** Environment family id at each pole (0 = none) and the same for seasonal areas. */
  environments: Uint8Array;
  seasonal: Uint8Array;
  /** The colour map before the paint's colours (Map-maker II), only where the paint has colours over the grid. */
  colorsUnpainted?: Uint8Array;
  /** One byte a pole where a road's flat part or a river's bed reached it (Map-maker II's fourth wave, `ChunkData.roadMap`). */
  roads?: Uint8Array;
}

/**
 * What the grass reads at one pole in one lookup (`TerrainSampler.radialPole`): the radial family and choice
 * of the map asked for, whether the generator excluded flora there, the colour map (0xRRGGBB), the ground's
 * height at the point itself (the client's fans) and the ground's normal at the pole, from its neighbours, in
 * the terrain's own space.
 */
export interface RadialPole {
  family: number;
  choice: number;
  excluded: boolean;
  color: number;
  height: number;
  nx: number;
  ny: number;
  nz: number;
}

/** What `TerrainSampler.probe` says about one pole (SWG coordinates; colours packed 0xRRGGBB). */
export interface GroundProbe {
  pole: { x: number; z: number };
  /** The family as laid on the 8 m pattern, and as it was painted before the pattern took it. */
  family: number;
  familyName: string | null;
  painted: number;
  /** The pole's choice byte, the child it picks and that child's shader. */
  choice: number;
  child: number;
  childShader: string | null;
  color: number;
  /** Every colour a colour affector wrote at the pole, in the order they ran. */
  writes: { tag: string; name: string; operation: number; ramp: string | null; desired: number; amount: number; before: number; after: number }[];
}

/** A cached block of poles: heights plus the per-pole maps flora placement reads. */
export interface PoleBlock {
  heights: Float32Array;
  /** Shader family id at each pole (0 = none), the ground texture the client paints there, laid on the 8 m pattern. */
  shaders: Int32Array;
  /** Each pole's choice among its family's alternates, a byte (`childIndexOf` turns it into a child). */
  children: Uint8Array;
  /** The colour map the client tinted the ground with, three bytes a pole, white where nothing painted it. */
  colors: Uint8Array;
  excluded: Uint8Array;
  floraCollidable: Uint8Array;
  floraNonCollidable: Uint8Array;
  /** Radial flora: family and choice pairs, near (AFDN) and far (AFDF); absent on a block a build before them sent. */
  radialNear?: Uint8Array;
  radialFar?: Uint8Array;
  /** Environment family id at each pole (0 = none): which area's environment rows apply there. */
  environments: Uint8Array;
  /** The same for seasonal areas, so the place underneath is still known out of season. */
  seasonal: Uint8Array;
  /**
   * The colour map before the paint's colours were laid over it (Map-maker II), only where the paint has colours over the
   * block: what a stroke's preview lays the paint over (`previewPaint`), so a colour already painted is never laid twice.
   */
  colorsUnpainted?: Uint8Array;
  /**
   * One byte a pole where a road's flat part or a river's bed reached it (Map-maker II's fourth wave): what the scatter
   * brush keeps off (`roadAt`). Absent on a block a build before it sent.
   */
  roads?: Uint8Array;
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
  /**
   * The ground's height edits (Map-maker II, `heightEdits.ts`), laid over every block as it enters the cache
   * (`generateBlock`, `putBlock`) and over every cached block a stroke reaches (`relay`); null lays nothing, and every
   * block is the generator's to the bit. Never read by `generate`, `generateChunk` or `baseHeightAt`: those stay raw.
   */
  heights: HeightEdits | null = null;
  /**
   * The raw heights of every cached block an edit may have moved, by block number: a block any tile touches keeps the
   * generator's own heights beside the laid ones, so every write is from raw (a patched block, one generated afresh and
   * one undone are the same bits) and the two copies of an edge pole always agree. Gone with its block.
   */
  private readonly raws = new Map<number, Float32Array>();
  private readonly lay = layAsk();
  /**
   * The ground's paint (Map-maker II, `groundPaint.ts`), handed to every grid this sampler runs the generator over, so a
   * block made here is the worker's block to the bit; null paints nothing, and every grid is the generator's.
   */
  paint: GroundPaint | null = null;
  /**
   * A paint stroke's preview (the editor's, while its button is held): each cached block it has laid over, as the block
   * stood when the stroke first reached it, by number, so every stamp lays the paint over the same ground. Let go when the
   * stroke's blocks are made again for it (`endPreview`), and with its block.
   */
  private readonly previewBase = new Map<number, { shaders: Int32Array; children: Uint8Array; colors: Uint8Array }>();

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
    const d = this.chunkData(startX, startZ, n, step);
    this.generator.generateChunk(d);
    const g: HeightGrid = { startX, startZ, n, step, heights: d.heightMap, shaders: d.shaderMap, children: d.shaderChild, colors: d.colorMap, excluded: d.excludeMap, floraCollidable: d.floraCollidable, floraNonCollidable: d.floraNonCollidable, radialNear: d.radialNear, radialFar: d.radialFar, environments: d.environmentMap, seasonal: d.seasonalMap };
    if (d.colorUnpainted !== null) g.colorsUnpainted = d.colorUnpainted;
    g.roads = d.roadMap;
    return g;
  }

  /** A grid's maps made ready for this terrain's generator (its groups and its ramps), for a caller that runs the generator itself. */
  chunkData(startX: number, startZ: number, n: number, step: number): ChunkData {
    const g = this.generator;
    const d = createChunkData(startX, startZ, n, step, g.fractalGroup, g.shaderGroup, g.bitmapGroup, g.floraGroup, g.environmentGroup, g.rampGroup, g.radialGroup);
    if (this.paint !== null) d.paint = this.paint;
    return d;
  }

  /**
   * Everything the generator says about the pole a world point maps to, worked out afresh (the
   * covering block generated again, on whatever thread asks, with nothing cached): its family as laid
   * on the 8 m pattern and as painted, its child choice and the child that picks, its colour, and
   * every colour a colour affector wrote there, in order. For the console.
   */
  probe(x: number, z: number): GroundProbe {
    const bw = this.blockWidth;
    const bx = Math.floor(x / bw);
    const bz = Math.floor(z / bw);
    const max = 2 * this.tilesPerBlock;
    const px = ORIGIN_OFFSET + Math.min(max, Math.max(0, Math.floor((x - bx * bw) / this.poleStep)));
    const pz = ORIGIN_OFFSET + Math.min(max, Math.max(0, Math.floor((z - bz * bw) / this.poleStep)));
    const n = this.numberOfPoles;
    const index = pz * n + px;
    const s = this.blockStart(bx, bz);
    const writes: GroundProbe['writes'] = [];
    const d = this.chunkData(s.x, s.z, n, this.poleStep);
    d.colorTrace = (by: Affector, i: number, desired: number, amount: number, before: number, after: number) => {
      if (i !== index) return;
      const what = colourAffectorInfo(by);
      writes.push({ tag: by.tag, name: by.name, operation: what?.operation ?? 0, ramp: what?.ramp ?? null, desired, amount, before, after });
    };
    this.generator.generateChunk(d);
    const painted = this.generator.snapFamilies ? this.paintedFamily(s.x, s.z, n, index) : d.shaderMap[index];
    const family = d.shaderMap[index];
    const choice = d.shaderChild[index];
    const fam = this.generator.shaderGroup.families.get(family);
    const k = index * 3;
    return {
      pole: { x: s.x + px * this.poleStep, z: s.z + pz * this.poleStep },
      family,
      familyName: fam?.name ?? null,
      painted,
      choice,
      child: childIndexOf(fam, choice),
      childShader: fam?.children[childIndexOf(fam, choice)]?.name ?? null,
      color: (d.colorMap[k] << 16) | (d.colorMap[k + 1] << 8) | d.colorMap[k + 2],
      writes,
    };
  }

  /** The family a pole was painted with before the pattern took it: the block generated once more with the snap off. */
  private paintedFamily(startX: number, startZ: number, n: number, index: number): number {
    this.generator.snapFamilies = false;
    try {
      const d = this.chunkData(startX, startZ, n, this.poleStep);
      this.generator.generateChunk(d);
      return d.shaderMap[index];
    } finally {
      this.generator.snapFamilies = true;
    }
  }

  /**
   * Diagnostics for one world point: the height after each top-level layer that touches it, with
   * how far inside that layer's boundaries the point is, plus a height profile along x and z.
   */
  trace(x: number, z: number): string[] {
    const step = this.poleStep;
    const half = 8;
    const n = 2 * half + 1;
    const startX = x - half * step;
    const startZ = z - half * step;
    const d = this.chunkData(startX, startZ, n, step);
    d.probeIndex = half * n + half;
    const lines: string[] = [];
    let last = 0;
    d.trace = (layer, height, depth) => {
      const amount = layer.boundaryAmountAt(x, z);
      const filters = layer.filters.some((f) => f.active) ? layer.filterAmountAt(x, z, half, half, d) : 1;
      const changed = Math.abs(height - last) > 1e-4;
      if (changed || (amount > 0 && filters > 0 && (depth === 0 || layer.affectors.some((a) => a.active && a.affectsHeight())))) {
        lines.push(`${'  '.repeat(depth)}${layer.name}: boundary ${amount.toFixed(3)}${layer.filters.some((f) => f.active) ? `, filters ${filters.toFixed(3)}` : ''}, height ${height.toFixed(3)}${changed ? ` (${height - last >= 0 ? '+' : ''}${(height - last).toFixed(3)})` : ''}; ${layer.describeRules()}`);
      }
      last = height;
    };
    this.generator.generateChunk(d);
    const row = (label: string, pick: (i: number) => number) => `${label}: ${Array.from({ length: n }, (_, i) => pick(i).toFixed(1)).join(' ')}`;
    lines.push(row(`heights along x (${(-half * step).toFixed(0)}..${(half * step).toFixed(0)} m, ${step} m apart)`, (i) => d.heightMap[half * n + i]));
    lines.push(row(`heights along z (${(-half * step).toFixed(0)}..${(half * step).toFixed(0)} m, ${step} m apart)`, (i) => d.heightMap[i * n + half]));
    lines.push(`shader family at the point: ${d.shaderMap[d.probeIndex]}`);
    // The generator's ground is raw: the height edits laid over it where it enters the cache are said beside it.
    if (this.heights?.size) {
      const at = this.heights.bilinear(x, z);
      lines.push(`raw height at the point ${d.heightMap[d.probeIndex].toFixed(3)}, the height edits add ${at.toFixed(3)} there (${(d.heightMap[d.probeIndex] + at).toFixed(3)} edited)`);
      lines.push(row('the edits along x', (i) => this.heights!.bilinear(startX + i * step, z)));
    }
    return lines;
  }

  /** Poles of one block: start = block origin minus the two-pole origin offset. */
  blockStart(blockX: number, blockZ: number): { x: number; z: number } {
    return { x: blockX * this.blockWidth - ORIGIN_OFFSET * this.poleStep, z: blockZ * this.blockWidth - ORIGIN_OFFSET * this.poleStep };
  }

  generateBlock(blockX: number, blockZ: number): PoleBlock {
    let b = this.blockAt(blockX, blockZ);
    if (!b) {
      const s = this.blockStart(blockX, blockZ);
      const g = this.generate(s.x, s.z, this.numberOfPoles, this.poleStep);
      b = { heights: g.heights, shaders: g.shaders, children: g.children, colors: g.colors, excluded: g.excluded, floraCollidable: g.floraCollidable, floraNonCollidable: g.floraNonCollidable, radialNear: g.radialNear, radialFar: g.radialFar, environments: g.environments, seasonal: g.seasonal };
      if (g.colorsUnpainted) b.colorsUnpainted = g.colorsUnpainted;
      if (g.roads) b.roads = g.roads;
      // The height edits laid over it as it enters the cache, its raw heights kept beside (Map-maker II).
      if (this.heights) this.layEntering(blockX, blockZ, b);
      this.blocks.set(`${blockX},${blockZ}`, b);
    }
    return b;
  }

  hasBlock(blockX: number, blockZ: number): boolean {
    return this.blockAt(blockX, blockZ) !== undefined;
  }

  putBlock(blockX: number, blockZ: number, block: PoleBlock): void {
    this.lastBlock = undefined;
    // A block the worker made enters the cache raw: the height edits in force are laid over it here, as they land.
    if (this.heights) this.layEntering(blockX, blockZ, block);
    // A block made again (for a paint, Map-maker II) replaces the one cached, and a preview's ground for it goes with it.
    if (this.previewBase.size) this.previewBase.delete(TerrainSampler.blockNumber(blockX, blockZ));
    this.blocks.set(`${blockX},${blockZ}`, block);
  }

  /**
   * One cached block let go (Map-maker II: made again for a paint where no worker answers), its raw heights and its
   * preview's ground with it; the next ask makes it afresh. Answers whether it was cached.
   */
  forgetBlock(blockX: number, blockZ: number): boolean {
    this.lastBlock = undefined;
    const n = TerrainSampler.blockNumber(blockX, blockZ);
    if (n >= 0) {
      this.raws.delete(n);
      this.previewBase.delete(n);
    }
    return this.blocks.delete(`${blockX},${blockZ}`);
  }

  /** The cached blocks whose poles a rectangle of the raw frame reaches, as block places (a paint's blocks to make again). */
  cachedBlocksIn(x0: number, z0: number, x1: number, z1: number): { bx: number; bz: number }[] {
    const bw = this.blockWidth;
    const step = this.poleStep;
    const np = this.numberOfPoles;
    const pad = ORIGIN_OFFSET * step;
    const span = (np - 1) * step - pad;
    const out: { bx: number; bz: number }[] = [];
    for (let bz = Math.ceil((Math.min(z0, z1) - span) / bw); bz <= Math.floor((Math.max(z0, z1) + pad) / bw); bz++) {
      for (let bx = Math.ceil((Math.min(x0, x1) - span) / bw); bx <= Math.floor((Math.max(x0, x1) + pad) / bw); bx++) if (this.blockAt(bx, bz)) out.push({ bx, bz });
    }
    return out;
  }

  /**
   * A paint stroke's preview (the editor's, Map-maker II): the paint laid in place over every cached block a rectangle of
   * the raw frame reaches, from the block as the stroke first found it (kept by number), so a painted cell shows at once
   * and a stamp laid twice lays the same. A cell erased shows only once the blocks are made again (`endPreview`), since the
   * ground's own family under a cell painted before is in no block. Answers how many blocks it laid. A stamp's work.
   */
  previewPaint(x0: number, z0: number, x1: number, z1: number): number {
    const p = this.paint;
    if (!p) return 0;
    const step = this.poleStep;
    const np = this.numberOfPoles;
    let laid = 0;
    for (const { bx, bz } of this.cachedBlocksIn(x0, z0, x1, z1)) {
      const b = this.blockAt(bx, bz)!;
      const n = TerrainSampler.blockNumber(bx, bz);
      if (n < 0) continue;
      let base = this.previewBase.get(n);
      if (!base) {
        // The colours as the colour affectors left them (`colorsUnpainted`, kept where the block was made under painted
        // colours): the paint's colours are a replace with an amount, and laid again over colours it already painted they
        // would lay twice and jump back as the stroke is let go. The families are laid whole, so painting over them is the same.
        const colours = b.colorsUnpainted ?? b.colors ?? new Uint8Array(np * np * 3).fill(255);
        base = { shaders: b.shaders.slice(), children: (b.children ?? new Uint8Array(np * np)).slice(), colors: colours.slice() };
        this.previewBase.set(n, base);
      }
      b.shaders.set(base.shaders);
      if (b.children) b.children.set(base.children);
      if (b.colors) b.colors.set(base.colors);
      const s = this.blockStart(bx, bz);
      p.layGrid(s.x, s.z, np, step, b.shaders, b.children ?? new Uint8Array(np * np), b.colors ?? null);
      laid++;
    }
    return laid;
  }

  /** A stroke's preview over: the ground it kept let go (the blocks themselves are made again for the stroke). */
  endPreview(): void {
    this.previewBase.clear();
  }

  /** Every cached block's key (`"bx,bz"`), a list made (a paint put in whole asks every one again). */
  cachedBlockKeys(): string[] {
    return [...this.blocks.keys()];
  }

  /** How many blocks a preview holds the ground of (the console's). */
  get previewBlocks(): number {
    return this.previewBase.size;
  }

  /** A block's number, a map key with nothing made (the chunks' own pattern); -1 past 4095 blocks either way. */
  private static blockNumber(bx: number, bz: number): number {
    if (bx < -4095 || bx > 4095 || bz < -4095 || bz > 4095) return -1;
    return (bx + 4096) * 8192 + (bz + 4096);
  }

  /**
   * A block entering the cache (generated here or made by the worker, its heights the generator's): where any tile of the
   * height edits touches its poles, its raw heights kept by its number and the edits laid over them; elsewhere left as it
   * came and any raw copy of an earlier life let go.
   */
  private layEntering(bx: number, bz: number, b: PoleBlock): void {
    const n = TerrainSampler.blockNumber(bx, bz);
    const h = this.heights;
    const step = this.poleStep;
    const np = this.numberOfPoles;
    const x0 = bx * this.blockWidth - ORIGIN_OFFSET * step;
    const z0 = bz * this.blockWidth - ORIGIN_OFFSET * step;
    if (n < 0 || !h || !h.touches(x0, z0, x0 + (np - 1) * step, z0 + (np - 1) * step)) {
      if (n >= 0) this.raws.delete(n);
      return;
    }
    const raw = b.heights.slice();
    this.raws.set(n, raw);
    this.layOne(raw, b.heights, x0, z0);
  }

  /** One block's heights laid from its raw copy (`HeightEdits.layIn`, every sample from raw). */
  private layOne(raw: Float32Array, out: Float32Array, x0: number, z0: number): boolean {
    const h = this.heights;
    if (!h) {
      out.set(raw);
      return false;
    }
    const a = this.lay;
    const step = this.poleStep;
    const np = this.numberOfPoles;
    a.raw = raw;
    a.out = out;
    a.x0 = x0;
    a.dx = step;
    a.z0 = z0;
    a.dz = step;
    a.nx = np;
    a.nz = np;
    const moved = h.layIn(a);
    a.raw = null;
    a.out = null;
    return moved;
  }

  /**
   * Every cached block whose poles a rectangle of the raw frame reaches laid again from its raw heights with the edits in
   * force now (a stroke's stamp, an undo, a file landed or let go): a block with no raw copy yet is raw as it stands and is
   * copied first. Answers how many blocks it laid. A stamp's work, never a frame's; allocates only a first raw copy.
   */
  relay(x0: number, z0: number, x1: number, z1: number): number {
    const bw = this.blockWidth;
    const step = this.poleStep;
    const np = this.numberOfPoles;
    const pad = ORIGIN_OFFSET * step;
    const span = (np - 1) * step - pad;
    const lx = Math.min(x0, x1);
    const hx = Math.max(x0, x1);
    const lz = Math.min(z0, z1);
    const hz = Math.max(z0, z1);
    let laid = 0;
    for (let bz = Math.ceil((lz - span) / bw); bz <= Math.floor((hz + pad) / bw); bz++) {
      for (let bx = Math.ceil((lx - span) / bw); bx <= Math.floor((hx + pad) / bw); bx++) {
        const b = this.blockAt(bx, bz);
        if (!b) continue;
        const n = TerrainSampler.blockNumber(bx, bz);
        if (n < 0) continue;
        let raw = this.raws.get(n);
        if (!raw) {
          // Nothing was ever laid over it (no tile touched it as it entered): its heights are the generator's, and a block no
          // tile touches now keeps no copy (an empty store laid over the cache copies nothing).
          const h = this.heights;
          const x0 = bx * bw - pad;
          const z0 = bz * bw - pad;
          if (!h || !h.touches(x0, z0, x0 + (np - 1) * step, z0 + (np - 1) * step)) continue;
          raw = b.heights.slice();
          this.raws.set(n, raw);
        }
        this.layOne(raw, b.heights, bx * bw - pad, bz * bw - pad);
        laid++;
      }
    }
    return laid;
  }

  /** Every cached block laid again (a store put in after blocks were cached, or let go): `relay` over the whole cache. */
  relayAll(): number {
    let laid = 0;
    for (const key of this.blocks.keys()) {
      const comma = key.indexOf(',');
      const bx = Number(key.slice(0, comma));
      const bz = Number(key.slice(comma + 1));
      const bw = this.blockWidth;
      laid += this.relay(bx * bw, bz * bw, bx * bw + bw - 1, bz * bw + bw - 1);
    }
    return laid;
  }

  /** A cached block's raw heights at a pole of the raw frame (its kept raw copy, else the block as it stands), or null where it is not cached. */
  rawPoleAt(x: number, z: number): number | null {
    const bw = this.blockWidth;
    const bx = Math.floor(x / bw);
    const bz = Math.floor(z / bw);
    const b = this.blockAt(bx, bz);
    if (!b) return null;
    const n = TerrainSampler.blockNumber(bx, bz);
    const raw = (n >= 0 ? this.raws.get(n) : undefined) ?? b.heights;
    return raw[this.indexInBlock(x, z, bx, bz)];
  }

  /** How many blocks keep a raw copy (the console's). */
  get rawCopies(): number {
    return this.raws.size;
  }

  /**
   * The last block looked up, kept so a run of lookups in one block (a chunk's grass asks its block several
   * times a tuft) builds no key: a string a lookup was a sixth of a chunk's placing. Dropped whenever the cache
   * changes, so it can never answer for a block the cache no longer holds.
   */
  private lastBx = Number.NaN;
  private lastBz = Number.NaN;
  private lastBlock: PoleBlock | undefined = undefined;

  /** A cached block, or undefined; never generates. */
  private blockAt(blockX: number, blockZ: number): PoleBlock | undefined {
    if (this.lastBlock && blockX === this.lastBx && blockZ === this.lastBz) return this.lastBlock;
    const b = this.blocks.get(`${blockX},${blockZ}`);
    if (b) {
      this.lastBx = blockX;
      this.lastBz = blockZ;
      this.lastBlock = b;
    }
    return b;
  }

  /** Index of the pole a world point maps to within its block (ProceduralTerrainAppearance::Chunk::_findMapXz). */
  private poleIndex(x: number, z: number): { block: PoleBlock; index: number } {
    const bw = this.blockWidth;
    const bx = Math.floor(x / bw);
    const bz = Math.floor(z / bw);
    const block = this.generateBlock(bx, bz);
    return { block, index: this.indexInBlock(x, z, bx, bz) };
  }

  private indexInBlock(x: number, z: number, bx: number, bz: number): number {
    const bw = this.blockWidth;
    const max = 2 * this.tilesPerBlock;
    const px = ORIGIN_OFFSET + Math.min(max, Math.max(0, Math.floor((x - bx * bw) / this.poleStep)));
    const pz = ORIGIN_OFFSET + Math.min(max, Math.max(0, Math.floor((z - bz * bw) / this.poleStep)));
    return pz * this.numberOfPoles + px;
  }

  /** The cached block a world point lies in, and its pole there, or null when the block is not generated. Never generates. */
  private cachedPole(x: number, z: number): { block: PoleBlock; index: number } | null {
    const bw = this.blockWidth;
    const bx = Math.floor(x / bw);
    const bz = Math.floor(z / bw);
    const block = this.blockAt(bx, bz);
    return block ? { block, index: this.indexInBlock(x, z, bx, bz) } : null;
  }

  /**
   * Everything the grass reads at the pole a world point maps to, from a cached block only, into `out`: the
   * near or far radial family and choice, the exclude flag, the colour, the height at the point (the fans) and
   * the normal at the pole from the poles beside it (central differences, in this terrain's own frame). False,
   * and nothing written, when the block is not generated. One block lookup and nothing allocated.
   */
  radialPole(x: number, z: number, far: boolean, out: RadialPole): boolean {
    const bw = this.blockWidth;
    const bx = Math.floor(x / bw);
    const bz = Math.floor(z / bw);
    const b = this.blockAt(bx, bz);
    if (!b) return false;
    const i = this.indexInBlock(x, z, bx, bz);
    const map = far ? b.radialFar : b.radialNear;
    out.family = map ? map[i * 2] : 0;
    out.choice = map ? map[i * 2 + 1] : 0;
    out.excluded = b.excluded[i] !== 0;
    const c = b.colors;
    out.color = c ? (c[i * 3] << 16) | (c[i * 3 + 1] << 8) | c[i * 3 + 2] : 0xffffff;
    const h = b.heights;
    out.height = sampleFans(h, this.numberOfPoles, this.tilesPerBlock, this.tileWidth, x - bx * bw, z - bz * bw);
    // The pole is never on the block's edge (two poles of pad each side), so all four neighbours are there.
    const n = this.numberOfPoles;
    const s2 = 2 * this.poleStep;
    const dx = (h[i + 1] - h[i - 1]) / s2;
    const dz = (h[i + n] - h[i - n]) / s2;
    const len = Math.hypot(dx, 1, dz);
    out.nx = -dx / len;
    out.ny = 1 / len;
    out.nz = -dz / len;
    return true;
  }

  /**
   * Whether a road's flat part or a river's bed reaches the pole a world point maps to (Map-maker II's fourth wave), from a
   * cached block only: null when it is not generated (or was sent by a build before the byte).
   */
  roadAt(x: number, z: number): boolean | null {
    const p = this.cachedPole(x, z);
    const r = p?.block.roads;
    return p && r ? r[p.index] !== 0 : null;
  }

  /** The child choice (a byte) at the pole a world point maps to, from a cached block only: null when it is not generated. */
  childAt(x: number, z: number): number | null {
    const p = this.cachedPole(x, z);
    return p ? (p.block.children?.[p.index] ?? 0) : null;
  }

  /** The colour map at the pole a world point maps to, packed 0xRRGGBB, from a cached block only: null when it is not generated. */
  colorAt(x: number, z: number): number | null {
    const p = this.cachedPole(x, z);
    const c = p?.block.colors;
    if (!p) return null;
    if (!c) return 0xffffff;
    const k = p.index * 3;
    return (c[k] << 16) | (c[k + 1] << 8) | c[k + 2];
  }

  /** The family, choice byte and colour (0xRRGGBB) at the pole a world point maps to, from a cached block only, into `out`: false when it is not generated. */
  groundAt(x: number, z: number, out: { family: number; choice: number; color: number }): boolean {
    const p = this.cachedPole(x, z);
    if (!p) return false;
    const i = p.index;
    out.family = p.block.shaders[i] ?? 0;
    out.choice = p.block.children?.[i] ?? 0;
    const c = p.block.colors;
    out.color = c ? (c[i * 3] << 16) | (c[i * 3 + 1] << 8) | c[i * 3 + 2] : 0xffffff;
    return true;
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

  /**
   * Environment family at the pole a world point maps to (0 = none). With `season`, a seasonal
   * area covering the point wins over the place underneath. Generates the block when not cached.
   */
  environmentAt(x: number, z: number, season = false): number {
    const { block, index } = this.poleIndex(x, z);
    const s = season ? block.seasonal?.[index] ?? 0 : 0;
    return s || (block.environments?.[index] ?? 0);
  }

  /** Whether the generator excluded flora at a world point (AEXC affectors). */
  excludedAt(x: number, z: number): boolean {
    const { block, index } = this.poleIndex(x, z);
    return block.excluded[index] !== 0;
  }

  /** Drop cached blocks farther than `radius` blocks from the given block. */
  evict(blockX: number, blockZ: number, radius: number): void {
    this.lastBlock = undefined;
    for (const key of this.blocks.keys()) {
      const [x, z] = key.split(',').map(Number);
      if (Math.max(Math.abs(x - blockX), Math.abs(z - blockZ)) > radius) {
        this.blocks.delete(key);
        // Its raw copy goes with it: a block generated again is copied afresh as it enters.
        if (this.raws.size) this.raws.delete(TerrainSampler.blockNumber(x, z));
        if (this.previewBase.size) this.previewBase.delete(TerrainSampler.blockNumber(x, z));
      }
    }
  }

  invalidateAll(): void {
    this.lastBlock = undefined;
    this.blocks.clear();
    this.raws.clear();
    this.previewBase.clear();
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
    this.lastBlock = undefined;
    this.blocks.clear();
    this.raws.clear();
    this.previewBase.clear();
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
