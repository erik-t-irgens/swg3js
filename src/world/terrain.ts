import * as THREE from 'three';
import type { PlanetDef } from '../data/planets';
import { FBM, hash2 } from './noise.ts';
import type { DemPatch } from './demTerrain';
import type { DemShader } from './demShader';
import type { FarGrid, SwgTerrain } from './swgTerrain';
import { sampleFamily, type FamilyGrid } from '../audio/footsteps.ts';
import { groundChunkOrigin, NO_SHIFT, tileCode, tileLayers, type GroundShift, type GroundTiler } from './groundTiles.ts';

export const CHUNK_SIZE = 64;
/** How far under its true height a far tile's ground is drawn, so the near chunks win where they overlap; what stands on it (the far tree cards) stands that much lower too. */
export const FAR_TILE_DROP = 2.5;

/** What a chunk's ground is built by when the pack's ground is drawn the client's way: the tiler, and the cells it counted by how many layers their tile holds. */
export type ChunkTiler = GroundTiler & { readonly census: Float64Array };

/**
 * The physics ground under a chunk's mesh: its heights put at the very corner the mesh starts at (`buildChunk`'s
 * `origin`, `groundChunkOrigin`), never its bucket's, or on the twelve odd-centred worlds the floor stands up to
 * 13 m off the drawn ground. The world adds every chunk's heightfield through this and `groundAlign.test.ts` asks
 * a real Rapier one made by it.
 */
export function chunkHeightfield<C>(physics: { createHeightfield(originX: number, originZ: number, size: number, subdivs: number, heights: Float32Array): C }, chunk: { origin: { x: number; z: number }; heights: Float32Array }): C {
  return physics.createHeightfield(chunk.origin.x, chunk.origin.z, CHUNK_SIZE, CHUNK_RES, chunk.heights);
}

/** Level ground of height h within radius r, blended smoothly at the edge. */
export interface FlattenZone { x: number; z: number; r: number; h: number }

/** A known ground height from game data (an object's origin), pulling the terrain toward it nearby. */
export interface Anchor { x: number; z: number; y: number; r: number }

const ANCHOR_CELL = 256;
const reachOf = (a: Anchor) => a.r * 2.5 + 40;
export const CHUNK_RES = 32;

/**
 * INVENTED: how many chunks' shader-family grids are kept at the least, for reading what the ground is
 * made of under a foot (and for the moving air's rasters). A grid is 35 x 35 int32s, about 4.9 KB. They
 * are the same arrays the ground meshes were built from, held rather than copied; a chunk's goes when the
 * chunk does (`forgetChunkFamilies`), and past the cap the oldest go first. Never fewer than can stand at
 * once (`familyKeepFor`, which the world writes as `familyKeep`): the stream keeps a chunk until it is
 * past the view radius and one more, 225 chunks at the default six, so a cap of 192 alone -- with the
 * grids of chunks long gone still holding places in it -- let the oldest grids of chunks still standing
 * go, the ones nearest where the player had been longest, and the feet and the air read that ground as
 * unknown until the chunk was built again. Live through `__debug.footsteps({ familyChunks: n })`, which
 * reports how many are held beside it.
 */
export const FAMILY_TUNE = { familyChunks: 192 };

/** How many chunks can stand at once at a view radius: the stream drops one only past the radius and one more. */
export function familyKeepFor(viewRadius: number): number {
  const r = Math.max(0, Math.floor(viewRadius)) + 1;
  return (2 * r + 1) * (2 * r + 1);
}

/**
 * A chunk's two indices as one small integer, which a map takes as a key with nothing made (the far grids' and the
 * regions' pattern), or -1 past 4095 chunks either way on an axis (262 km, past anything the game has).
 */
export function familyChunkNumber(cx: number, cz: number): number {
  if (cx < -4095 || cx > 4095 || cz < -4095 || cz > 4095) return -1;
  return (cx + 4096) * 8192 + (cz + 4096);
}

// The grid itself and the lookup into it live beside the footsteps that read them, where a test of what
// is underfoot reads them without a terrain; a rule about what is underfoot that nothing can check is the
// kind that quietly goes wrong. (This module loads in node too now: `groundAlign.test.ts` builds chunks.)

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();
/** One pole's family, choice and colour, written by `SwgTerrain.groundIfCached` for every sample a chunk reads. */
const groundPole = { family: 0, choice: 0, color: 0xffffff };
/** A tile's four corners, SW, SE, NW, NE: their families and their choices, refilled for each tile. */
const cornerFams = new Int32Array(4);
const cornerChoices = new Uint8Array(4);

export class Terrain {
  private readonly fbm: FBM;
  private readonly detail: FBM;
  private readonly low: THREE.Color;
  private readonly mid: THREE.Color;
  private readonly high: THREE.Color;
  private readonly slope: THREE.Color;
  private readonly shore: THREE.Color;
  minH: number;
  /** Below this the world is considered left (falling through): players reset, creatures respawn. */
  floor: number;
  maxH: number;
  waterLevel: number;
  readonly flattenZones: FlattenZone[] = [];
  /** Real SWG terrain for this planet when a converted pack provides it; replaces the noise below. */
  swg: SwgTerrain | null = null;
  /**
   * Set when the pack's ground is drawn the client's way (terrain shaders version 4, `terrainTextures.ts`):
   * every chunk and far tile is then built with each triangle's tile layers, mask codes and tint
   * (`groundTiles.ts`) in place of its corners' families and weights. Null builds the ground as it always was.
   */
  tiler: ChunkTiler | null = null;
  private readonly anchorCells = new Map<string, Anchor[]>();
  private anchorCount = 0;

  // Written out rather than a parameter property, which node's type stripping cannot run (the flora's node test reaches this file).
  readonly planet: PlanetDef;

  constructor(planet: PlanetDef) {
    this.planet = planet;
    this.fbm = new FBM(planet.seed);
    this.detail = new FBM(planet.seed * 31 + 7);
    this.low = new THREE.Color(planet.palette.low);
    this.mid = new THREE.Color(planet.palette.mid);
    this.high = new THREE.Color(planet.palette.high);
    this.slope = new THREE.Color(planet.palette.slope);
    this.shore = new THREE.Color(planet.palette.shore);
    this.minH = planet.terrain.base - planet.terrain.amplitude;
    this.floor = this.minH - 30;
    this.maxH = planet.terrain.base + planet.terrain.amplitude;
    this.waterLevel = planet.water ? planet.water.level : -Infinity;
  }

  /** Switch to the planet's real terrain generator. Heights, water and colour bands follow it from now on. */
  attachSwg(swg: SwgTerrain): void {
    this.swg = swg;
    this.waterLevel = swg.waterLevel;
    // Colour bands span the heights SWG worlds actually use rather than the noise planet's range.
    this.minH = Math.max(this.waterLevel, -20);
    this.maxH = this.minH + 140;
    // Real planets go far below zero (Naboo's sea sits 200 m under the Theed plateau).
    this.floor = -700;
  }

  /** Water surface at a point: lakes and pools count as well as the global water level. */
  waterHeightAt(x: number, z: number): number {
    return this.swg ? this.swg.waterAt(x, z) : this.waterLevel;
  }

  detachSwg(): void {
    this.swg?.dispose();
    this.swg = null;
    this.tiler = null;
    // The families belong to that generator's own shader group; nothing may read them against another.
    this.chunkFamilies.clear();
    this.waterLevel = this.planet.water ? this.planet.water.level : -Infinity;
    this.floor = this.planet.terrain.base - this.planet.terrain.amplitude - 30;
  }

  /**
   * Make sure the ground under a chunk can be sampled. With SWG terrain this means its pole
   * grids are cached; when they are not, they are queued on the worker (or generated at once
   * when `sync`) and false is returned so the caller retries next frame.
   */
  prepareChunk(cx: number, cz: number, sync: boolean): boolean {
    if (!this.swg) return true;
    const step = CHUNK_SIZE / CHUNK_RES;
    const o = this.chunkOrigin(cx, cz);
    return this.swg.prepareArea(o.x - step, o.z - step, CHUNK_SIZE + 2 * step, sync);
  }

  /** Where this world's near ground stands against the 64 m buckets: the layout centre's remainder each way (`groundTiles.ts`), nought on a world with no converted terrain. */
  get groundShift(): GroundShift {
    return this.swg?.groundShift ?? NO_SHIFT;
  }

  /** The game-space corner a chunk's ground mesh and heightfield start at: its bucket's, moved onto the client's height points. */
  chunkOrigin(cx: number, cz: number): { x: number; z: number } {
    return groundChunkOrigin(cx, cz, this.groundShift, CHUNK_SIZE);
  }

  /**
   * Whether the ground over a game-space square can be sampled without generating anything on the main
   * thread. With SWG terrain, the pole grids missing under it are queued on the worker and false is
   * returned, so the caller asks again later; with none it is always true.
   */
  prepareArea(gx0: number, gz0: number, size: number): boolean {
    return this.swg ? this.swg.prepareArea(gx0, gz0, size, false) : true;
  }

  /** Ground height from data already generated, or null when nothing covers the point yet. */
  heightIfCached(x: number, z: number, farSize: number, farRes: number): number | null {
    if (this.swg) return this.swg.heightIfCached(x, z, farSize, farRes);
    return this.heightAt(x, z);
  }

  /**
   * `heightIfCached` without the far grid (a built block only; the procedural ground everywhere, which costs nothing to
   * ask). A real-world patch answers first wherever it lies, its feather blended onto the cached ground under it and
   * nothing where that ground is not built yet, so a pod raced over a patch laid on a converted world rides the patch;
   * with no converted world under it, `heightAt` already answers the patch.
   */
  nearHeightIfCached(x: number, z: number): number | null {
    if (this.dem && this.swg) {
      const swg = this.swg;
      let missing = false;
      const h = this.dem.heightAt(x, z, () => {
        const under = swg.nearHeightIfCached(x, z);
        if (under === null) missing = true;
        return under ?? 0;
      });
      if (h !== null) return missing ? null : this.demDetail > 0 ? h + this.detail.fbm(x * 0.11, z * 0.11, 3) * this.demDetail : h;
    }
    if (this.swg) return this.swg.nearHeightIfCached(x, z);
    return this.heightAt(x, z);
  }

  /** The far grid's own sample at a lattice point (`SwgTerrain.farSampleAt`); null with no SWG terrain, whose ground is all near. */
  farSampleAt(i: number, j: number, farSize: number, farRes: number): number | null {
    return this.swg ? this.swg.farSampleAt(i, j, farSize, farRes) : null;
  }

  /** A patch of real-world ground laid over this planet, or null. See demTerrain.ts. */
  dem: DemPatch | null = null;
  /** Metres of fractal relief added under the DEM's own sample spacing. */
  demDetail = 0;
  /**
   * Which ground family to paint at a point, for a planet whose heights are real-world elevation.
   * Where a converted world answers this from its own terrain template, a DEM planet answers it
   * from rules in the planet entry: see demShader.ts. Set, it replaces the template's say entirely,
   * which is the point -- the template's filters were authored against another world's ground.
   */
  demShader: DemShader | null = null;
  /** The borrowed pack's families by name, kept so the rules can be reworked without reloading it. */
  demFamilies: ReadonlyMap<string, number> | null = null;

  /** Bound once: the rules call it a few times a sample and a fresh closure each time would show. */
  private readonly heightSampler = (x: number, z: number): number => this.heightAt(x, z);

  /** This planet's own ground at a point, ignoring any patch: the far end of the patch's feather. */
  private groundBeneathDem(x: number, z: number): number {
    return this.swg ? this.swg.heightAt(x, z) : this.rawHeightAt(x, z);
  }

  heightAt(x: number, z: number): number {
    // Inside a DEM patch the real ground wins, feathered out to the planet's own at the edge.
    // Put before everything else so the mesh, the heightfield and every query agree: they all
    // come through here, and `buildGrid` calls it once per sample for both.
    if (this.dem) {
      const h = this.dem.heightAt(x, z, () => this.groundBeneathDem(x, z));
      // Fractal relief below what the raster can hold. A 10 m source carries the shape of a mesa
      // and nothing of the ground between, so this is what stops it reading as a smooth shell.
      if (h !== null) return this.demDetail > 0 ? h + this.detail.fbm(x * 0.11, z * 0.11, 3) * this.demDetail : h;
    }
    if (this.swg) return this.swg.heightAt(x, z);
    let h = this.rawHeightAt(x, z);
    for (const zone of this.flattenZones) {
      const d = Math.hypot(x - zone.x, z - zone.z);
      if (d >= zone.r) continue;
      let t = 1 - d / zone.r;
      t = t * t * (3 - 2 * t);
      h += (zone.h - h) * t;
    }
    if (this.anchorCount > 0) {
      const list = this.anchorCells.get(`${Math.floor(x / ANCHOR_CELL)},${Math.floor(z / ANCHOR_CELL)}`);
      if (list) {
        let sumW = 0;
        let sumY = 0;
        let maxT = 0;
        for (const a of list) {
          const reach = reachOf(a);
          const d = Math.hypot(x - a.x, z - a.z);
          if (d >= reach) continue;
          let t = 1 - d / reach;
          t = t * t * (3 - 2 * t);
          const w = t * (a.r + 4);
          sumW += w;
          sumY += w * a.y;
          if (t > maxT) maxT = t;
        }
        if (sumW > 0) h += (sumY / sumW - h) * maxT;
      }
    }
    return h;
  }

  /** Register a ground-height anchor; it influences terrain within reachOf(a). */
  addAnchor(a: Anchor): void {
    const reach = reachOf(a);
    const x0 = Math.floor((a.x - reach) / ANCHOR_CELL);
    const x1 = Math.floor((a.x + reach) / ANCHOR_CELL);
    const z0 = Math.floor((a.z - reach) / ANCHOR_CELL);
    const z1 = Math.floor((a.z + reach) / ANCHOR_CELL);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = `${cx},${cz}`;
        const list = this.anchorCells.get(key);
        if (list) list.push(a);
        else this.anchorCells.set(key, [a]);
      }
    }
    this.anchorCount++;
  }

  /** Terrain height before any flattening. */
  rawHeightAt(x: number, z: number): number {
    if (this.swg) return this.swg.heightAt(x, z);
    const t = this.planet.terrain;
    const f = t.frequency;
    let v = this.fbm.fbm(x * f, z * f, t.octaves);
    if (t.ridged > 0) {
      const r = this.fbm.ridged(x * f * 0.7 + 100, z * f * 0.7 + 100, 4);
      v = v * (1 - t.ridged) + (r * 2 - 1) * t.ridged;
    }
    if (t.flatten !== 1) v = Math.sign(v) * Math.pow(Math.abs(v), t.flatten);
    const d = t.detail > 0 ? this.detail.fbm(x * 0.09, z * 0.09, 2) * t.detail : 0;
    return t.base + v * t.amplitude + d;
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 0.5;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return out.set(-dx, 1, -dz).normalize();
  }

  /** Large-scale density field used for vegetation clumping, in [0, 1]. */
  densityAt(x: number, z: number): number {
    return this.detail.fbm(x * 0.012 + 50, z * 0.012 - 50, 2) * 0.5 + 0.5;
  }

  /** The palette's ground colour at a point (a real planet's ground textures are asked separately). */
  groundColorAt(x: number, z: number, out: THREE.Color): THREE.Color {
    this.colorAt(this.heightAt(x, z), 1, x, z, out);
    return out;
  }

  private colorAt(h: number, ny: number, x: number, z: number, out: THREE.Color): void {
    // Flat ground (no height range) takes the middle of the palette rather than dividing by nothing.
    const span = this.maxH - this.minH;
    const t = span > 1e-6 ? Math.min(1, Math.max(0, (h - this.minH) / span)) : 0.5;
    if (t < 0.5) tmpA.copy(this.low).lerp(this.mid, t * 2);
    else tmpA.copy(this.mid).lerp(this.high, (t - 0.5) * 2);

    if (this.planet.water) {
      const shoreT = Math.min(1, Math.max(0, 1 - (h - this.waterLevel) / 2.5));
      tmpA.lerp(this.shore, shoreT * shoreT);
    }

    const steep = Math.min(1, Math.max(0, (0.72 - ny) / 0.32));
    tmpA.lerp(this.slope, steep);

    const grain = 0.9 + 0.14 * hash2(Math.floor(x * 2), Math.floor(z * 2), this.planet.seed);
    out.copy(tmpA).multiplyScalar(grain);
  }

  /**
   * A chunk's ground: its mesh and the heights its physics heightfield is made from, both starting at
   * `origin` (`chunkOrigin`), which is where the heightfield must be put.
   */
  buildChunk(cx: number, cz: number): { geometry: THREE.BufferGeometry; heights: Float32Array; origin: { x: number; z: number } } {
    const origin = this.chunkOrigin(cx, cz);
    const r = this.buildGrid(origin.x, origin.z, CHUNK_SIZE, CHUNK_RES, { skirt: 8, wantHeights: true });
    // The family of every sample the ground was painted from, kept for what is underfoot. It is the
    // array the mesh was built from, held rather than copied, and the oldest chunk's goes when the
    // map is full: a body walking a planet all day keeps a bounded handful.
    if (r.families) {
      const key = `${cx},${cz}`;
      this.chunkFamilies.delete(key);
      const grid: FamilyGrid = { fams: r.families, ox: origin.x, oz: origin.z, step: CHUNK_SIZE / CHUNK_RES, w: CHUNK_RES + 3 };
      this.chunkFamilies.set(key, grid);
      // Filed a second time by number, so the moving air's strips can ask on a frame with no key built (`familyIdAt`).
      const n = familyChunkNumber(cx, cz);
      if (n >= 0) this.familyByNumber.set(n, grid);
      while (this.chunkFamilies.size > Math.max(FAMILY_TUNE.familyChunks, this.familyKeep)) {
        const oldest = this.chunkFamilies.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        const gone = this.chunkFamilies.get(oldest);
        this.chunkFamilies.delete(oldest);
        const comma = oldest.indexOf(',');
        const on = familyChunkNumber(Number(oldest.slice(0, comma)), Number(oldest.slice(comma + 1)));
        if (on >= 0 && this.familyByNumber.get(on) === gone) this.familyByNumber.delete(on);
      }
    }
    return { geometry: r.geometry, heights: r.heights!, origin };
  }

  /** The chunks' family grids, newest last; a planet's own, so a travel takes them with the terrain. */
  private readonly chunkFamilies = new Map<string, FamilyGrid>();
  /** How many grids are kept at the least: every chunk that can stand at once (`familyKeepFor`), written by the world. */
  familyKeep = 0;

  /**
   * The shader family the ground is painted with at a point, 0 for none and null where no chunk has
   * been built yet. It reads the nearest sample of the chunk under the point -- never the terrain
   * sampler, whose main-thread cache is mostly empty and would generate a whole block to answer.
   */
  familyAt(x: number, z: number): number | null {
    const g = this.chunkFamilies.get(`${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`);
    return g ? sampleFamily(g, x, z) : null;
  }

  /** The chunks' family grids by number (`familyChunkNumber`), beside the string-keyed map that owns them. */
  private readonly familyByNumber = new Map<number, FamilyGrid>();

  /**
   * A chunk taken down (the world's `disposeChunk`): its family grid goes with it, so the grids held are the chunks that
   * stand. Kept past their chunks, they filled the cap and the oldest grids of chunks still standing were let go first:
   * circling a place within the view's reach, the chunks round it never went and were never built again, and their
   * ground read as unknown to the feet and the moving air for as long as they stood (measured: a whole window of the
   * air's raster unknown on Tatooine's dunes after two laps of teleports 350 m round it).
   */
  forgetChunkFamilies(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const g = this.chunkFamilies.get(key);
    if (!g) return;
    this.chunkFamilies.delete(key);
    const n = familyChunkNumber(cx, cz);
    if (n >= 0 && this.familyByNumber.get(n) === g) this.familyByNumber.delete(n);
  }

  /**
   * `familyAt` with no key built: the family at a point, 0 for none painted and -1 where no chunk is built (null's
   * place, so the answer is always a small integer). The moving air's strips ask it for many cells a frame.
   */
  familyIdAt(x: number, z: number): number {
    const n = familyChunkNumber(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    if (n < 0) return -1;
    const g = this.familyByNumber.get(n);
    if (!g) return -1;
    const i = Math.round((x - g.ox) / g.step) + 1;
    const j = Math.round((z - g.oz) / g.step) + 1;
    if (i < 0 || j < 0 || i >= g.w || j >= g.w) return -1;
    return g.fams[j * g.w + i] ?? 0;
  }

  /**
   * What the ground is made of at a point: the surface template the shader family names
   * (`abstract/terrain_surface/sand.iff`), or null where no chunk covers it, the planet has no
   * converted terrain, or the family names none (Mustafar's do not).
   */
  surfaceAt(x: number, z: number): string | null {
    const swg = this.swg;
    if (!swg) return null;
    const family = this.familyAt(x, z);
    if (!family) return null;
    return swg.template.generator.shaderGroup.families.get(family)?.surface || null;
  }

  /** How many chunks' families are held, for the console. */
  get familyChunks(): number {
    return this.chunkFamilies.size;
  }

  /**
   * Coarse distant tile, dropped slightly so near chunks win where they overlap. With SWG
   * terrain the samples come from the worker; null means not generated yet (retry later).
   */
  buildFarTile(tx: number, tz: number, size: number, res: number, sync = true): THREE.BufferGeometry | null {
    // Moved with the near ground (`groundChunkOrigin`), so its quads stay square with the chunks' edges and the
    // cut leaves no sliver open between them, and its samples stand on poles.
    const o = groundChunkOrigin(tx, tz, this.groundShift, size);
    let hs: FarGrid | undefined;
    if (this.swg) {
      const grid = this.swg.farGrid(o.x, o.z, size, res, sync);
      if (!grid) return null;
      hs = grid;
    }
    const geometry = this.buildGrid(o.x, o.z, size, res, { skirt: 0, yOffset: -FAR_TILE_DROP, wantHeights: false }, hs).geometry;
    if (geometry.userData.fullIndex) return geometry;
    // Remember the full index so quads under detailed chunks can be cut out (World.refreshFarTile).
    geometry.userData = { fullIndex: geometry.getIndex()!.array.slice(), n: res, ox: o.x, oz: o.z, step: size / res };
    return geometry;
  }

  releaseFarTile(tx: number, tz: number, size: number, res: number): void {
    const o = groundChunkOrigin(tx, tz, this.groundShift, size);
    this.swg?.releaseFarGrid(o.x, o.z, size, res);
  }

  /** Drop cached SWG grids far from a point (in game chunks). */
  evict(center: THREE.Vector3, chunkRadius: number): void {
    this.swg?.evict(center.x, center.z, Math.ceil((chunkRadius * CHUNK_SIZE) / this.swg.sampler.blockWidth) + 2);
  }

  /**
   * The ground drawn the client's way: one vertex a corner a triangle, as the textured ground always was (the
   * identity index keeps the far tiles' cut on its six entries a quad), each carrying its triangle's tile whole --
   * the array layers bottom first and the overlays' mask codes (`tileLayers`), worked out once a cell from its
   * tile's four corner poles -- its own place in that tile, and the colour map at its own pole. A near chunk's
   * cell lies in the 4 m tile the terrain's own grid puts it in (the mesh stands on the poles, so a tile's
   * corners are samples of the grid, its margin included); a far tile's 16 m quad is a tile of its own.
   */
  private tiledAttributes(
    geo: THREE.BufferGeometry,
    g: { ox: number; oz: number; n: number; step: number; w: number; skirt: number; gridCount: number; skirtSource: Int32Array; positions: Float32Array; normals: Float32Array; indices: number[]; fams: Int32Array; kids: Uint8Array; cols: Uint8Array; tiler: ChunkTiler; swg: SwgTerrain },
  ): void {
    const { ox, oz, n, step, w, gridCount, skirtSource, positions, normals, indices, fams, kids, cols, tiler, swg } = g;
    const tw = swg.tileWidth;
    const own = step >= tw - 1e-6;
    const T = own ? step : tw;
    // Each column's and row's tile edge on the terrain's west and south side.
    const x0 = new Float64Array(n);
    const z0 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x0[i] = own ? swg.toSwgX(ox + (i + 1) * step) : tw * Math.floor(swg.toSwgX(ox + (i + 0.5) * step) / tw);
      z0[i] = own ? swg.toSwgZ(oz + i * step) : tw * Math.floor(swg.toSwgZ(oz + (i + 0.5) * step) / tw);
    }
    const clampIndex = (v: number) => (v < 0 ? 0 : v >= w ? w - 1 : v);
    const sampleAt = (tx: number, tz: number) => clampIndex(Math.round((swg.toGameZ(tz) - oz) / step) + 1) * w + clampIndex(Math.round((swg.toGameX(tx) - ox) / step) + 1);
    const cells = n * n;
    const cellLayers = new Uint8Array(cells * 4);
    const cellCodes = new Uint8Array(cells * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        const sw = sampleAt(x0[i], z0[j]);
        const se = sampleAt(x0[i] + T, z0[j]);
        const nw = sampleAt(x0[i], z0[j] + T);
        const ne = sampleAt(x0[i] + T, z0[j] + T);
        cornerFams[0] = fams[sw];
        cornerFams[1] = fams[se];
        cornerFams[2] = fams[nw];
        cornerFams[3] = fams[ne];
        cornerChoices[0] = kids[sw];
        cornerChoices[1] = kids[se];
        cornerChoices[2] = kids[nw];
        cornerChoices[3] = kids[ne];
        const count = tileLayers(cornerFams, cornerChoices, tiler, cellLayers, cellCodes, c * 4, c * 3);
        if (!own) tiler.census[count]++;
      }
    }
    const gridTris = cells * 6;
    const cellOf = (t: number): number => {
      if (t < gridTris) return Math.floor(t / 6);
      const s = Math.floor((t - gridTris) / 12);
      const k = s % n;
      switch (Math.floor(s / n)) {
        case 0:
          return k;
        case 1:
          return (n - 1) * n + k;
        case 2:
          return k * n;
        default:
          return k * n + n - 1;
      }
    };
    const tc = indices.length;
    const dp = new Float32Array(tc * 3);
    const dn = new Float32Array(tc * 3);
    const dl = new Uint8Array(tc * 4);
    const db = new Uint8Array(tc * 4);
    const dt = new Uint8Array(tc * 3);
    const toHalves = (v: number) => {
      const h = Math.round((2 * v) / T);
      return h < 0 ? 0 : h > 2 ? 2 : h;
    };
    for (let t = 0; t < tc; t += 3) {
      const c = cellOf(t);
      const ci = c % n;
      const cj = Math.floor(c / n);
      for (let k = 0; k < 3; k++) {
        const v = indices[t + k];
        const o = t + k;
        dp[o * 3] = positions[v * 3];
        dp[o * 3 + 1] = positions[v * 3 + 1];
        dp[o * 3 + 2] = positions[v * 3 + 2];
        dn[o * 3] = normals[v * 3];
        dn[o * 3 + 1] = normals[v * 3 + 1];
        dn[o * 3 + 2] = normals[v * 3 + 2];
        for (let q = 0; q < 4; q++) dl[o * 4 + q] = cellLayers[c * 4 + q];
        db[o * 4] = cellCodes[c * 3];
        db[o * 4 + 1] = cellCodes[c * 3 + 1];
        db[o * 4 + 2] = cellCodes[c * 3 + 2];
        // A skirt's vertex stands where its edge's does, so it takes that one's place and colour.
        const src = v < gridCount ? v : Math.max(0, skirtSource[v - gridCount]);
        const vi = src % (n + 1);
        const vj = Math.floor(src / (n + 1));
        db[o * 4 + 3] = tileCode(toHalves(swg.toSwgX(ox + vi * step) - x0[ci]), toHalves(swg.toSwgZ(oz + vj * step) - z0[cj]));
        const s = ((vj + 1) * w + vi + 1) * 3;
        dt[o * 3] = cols[s];
        dt[o * 3 + 1] = cols[s + 1];
        dt[o * 3 + 2] = cols[s + 2];
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(dn, 3));
    geo.setAttribute('aGroundLayers', new THREE.BufferAttribute(dl, 4));
    geo.setAttribute('aGroundBlend', new THREE.BufferAttribute(db, 4));
    geo.setAttribute('aGroundTint', new THREE.BufferAttribute(dt, 3, true));
    const identity = new Uint32Array(tc);
    for (let i = 0; i < tc; i++) identity[i] = i;
    geo.setIndex(new THREE.BufferAttribute(identity, 1));
    geo.computeBoundingSphere();
    if (g.skirt === 0) geo.userData = { fullIndex: identity.slice(), n, ox, oz, step };
  }

  private buildGrid(ox: number, oz: number, size: number, n: number, opts: { skirt: number; yOffset?: number; wantHeights: boolean }, samples?: FarGrid): { geometry: THREE.BufferGeometry; heights: Float32Array | null; families: Int32Array | null } {
    const step = size / n;
    const yOff = opts.yOffset ?? 0;
    const w = n + 3;
    let hs: Float32Array;
    // Shader family per sample when the planet has real terrain: the ground texture painted there.
    let fams: Int32Array | null = null;
    // And, for the ground drawn the client's way, each sample's choice among its family's alternates and its colour.
    const tiler = this.swg ? this.tiler : null;
    let kids: Uint8Array | null = null;
    let cols: Uint8Array | null = null;
    if (samples && samples.heights.length === w * w) {
      hs = samples.heights;
      fams = samples.shaders;
      if (tiler) {
        kids = samples.children;
        cols = samples.colors;
      }
    } else {
      hs = new Float32Array(w * w);
      const swg = this.swg;
      // A DEM planet has no template to ask, so its rules stand in: the ground is painted whenever
      // either one can name a family.
      const rules = this.demShader;
      if (swg || rules) fams = new Int32Array(w * w);
      if (swg && tiler) {
        kids = new Uint8Array(w * w);
        cols = new Uint8Array(w * w * 3);
      }
      for (let j = 0; j < w; j++) {
        for (let i = 0; i < w; i++) {
          const x = ox + (i - 1) * step;
          const z = oz + (j - 1) * step;
          const k = j * w + i;
          hs[k] = this.heightAt(x, z);
          if (!fams) continue;
          if (rules) {
            // Asked of the terrain's own heightAt, so the rules see exactly the ground the mesh and
            // the collider were built from, fractal detail and all.
            fams[k] = rules.familyAt(x, z, this.heightSampler);
            if (cols) cols.fill(255, k * 3, k * 3 + 3);
            continue;
          }
          if (!swg) continue;
          // From the cached block in one lookup; a block not cached (never, after `prepareChunk`) is generated as before.
          if (kids && cols && swg.groundIfCached(x, z, groundPole)) {
            fams[k] = groundPole.family;
            kids[k] = groundPole.choice;
            cols[k * 3] = (groundPole.color >> 16) & 255;
            cols[k * 3 + 1] = (groundPole.color >> 8) & 255;
            cols[k * 3 + 2] = groundPole.color & 255;
          } else {
            fams[k] = swg.shaderAt(x, z);
            if (cols) cols.fill(255, k * 3, k * 3 + 3);
          }
        }
      }
    }

    let physHeights: Float32Array | null = null;
    if (opts.wantHeights) {
      // Physics copy: column-major, column = x index, row = z index.
      physHeights = new Float32Array((n + 1) * (n + 1));
      for (let xi = 0; xi <= n; xi++) {
        for (let zi = 0; zi <= n; zi++) physHeights[xi * (n + 1) + zi] = hs[(zi + 1) * w + (xi + 1)];
      }
    }

    const gridCount = (n + 1) * (n + 1);
    const skirtCount = opts.skirt > 0 ? 4 * (n + 1) : 0;
    const skirtSource = new Int32Array(skirtCount).fill(-1);
    const vcount = gridCount + skirtCount;
    const positions = new Float32Array(vcount * 3);
    const normals = new Float32Array(vcount * 3);
    const colors = new Float32Array(vcount * 3);
    let p = 0;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const hi = (j + 1) * w + (i + 1);
        const h = hs[hi];
        const dx = (hs[hi + 1] - hs[hi - 1]) / (2 * step);
        const dz = (hs[hi + w] - hs[hi - w]) / (2 * step);
        const len = Math.hypot(dx, 1, dz);
        const nx = -dx / len;
        const ny = 1 / len;
        const nz = -dz / len;
        const x = ox + i * step;
        const z = oz + j * step;
        positions[p] = x;
        positions[p + 1] = h + yOff;
        positions[p + 2] = z;
        normals[p] = nx;
        normals[p + 1] = ny;
        normals[p + 2] = nz;
        this.colorAt(h, ny, x, z, tmpB);
        colors[p] = tmpB.r;
        colors[p + 1] = tmpB.g;
        colors[p + 2] = tmpB.b;
        p += 3;
      }
    }

    // SWG ground is fans around each tile's centre pole: split every cell along the diagonal
    // that touches a centre pole so collision and rendering match the original game exactly.
    const swg = this.swg;
    const fanAligned = !!swg && Math.abs(step - swg.tileWidth * 0.5) < 1e-6;
    const indices: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        if (fanAligned && (swg!.isTileCentre(ox + i * step, oz + j * step) || swg!.isTileCentre(ox + (i + 1) * step, oz + (j + 1) * step))) indices.push(a, c, d, a, d, b);
        else indices.push(a, c, b, b, c, d);
      }
    }

    if (opts.skirt > 0) {
      // Skirts hang from each edge so coarse far tiles never show through gaps.
      const edges: number[][] = [[], [], [], []];
      for (let i = 0; i <= n; i++) {
        edges[0].push(i);
        edges[1].push(n * (n + 1) + i);
        edges[2].push(i * (n + 1));
        edges[3].push(i * (n + 1) + n);
      }
      let sv = gridCount;
      for (const edge of edges) {
        const start = sv;
        for (const src of edge) {
          skirtSource[sv - gridCount] = src;
          positions[sv * 3] = positions[src * 3];
          positions[sv * 3 + 1] = positions[src * 3 + 1] - opts.skirt;
          positions[sv * 3 + 2] = positions[src * 3 + 2];
          normals[sv * 3] = normals[src * 3];
          normals[sv * 3 + 1] = normals[src * 3 + 1];
          normals[sv * 3 + 2] = normals[src * 3 + 2];
          colors[sv * 3] = colors[src * 3] * 0.8;
          colors[sv * 3 + 1] = colors[src * 3 + 1] * 0.8;
          colors[sv * 3 + 2] = colors[src * 3 + 2] * 0.8;
          sv++;
        }
        for (let k = 0; k < n; k++) {
          const a = edge[k], b = edge[k + 1], c = start + k, d = start + k + 1;
          indices.push(a, b, c, b, d, c, a, c, b, b, c, d);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    if (fams && tiler && kids && cols && swg) {
      this.tiledAttributes(geo, { ox, oz, n, step, w, skirt: opts.skirt, gridCount, skirtSource, positions, normals, indices, fams, kids, cols, tiler, swg });
      return { geometry: geo, heights: physHeights, families: fams };
    }
    if (fams) {
      // Textured ground: every triangle carries the families of its three corners and each vertex
      // its corner weight, so the fragment shader can blend three ground textures across it. That
      // needs one vertex per corner per triangle; the identity index keeps far-tile quad culling
      // (World.refreshFarTile) working on the same six entries per quad.
      const family = (v: number) => (v < gridCount ? fams![(Math.floor(v / (n + 1)) + 1) * w + (v % (n + 1)) + 1] : skirtSource[v - gridCount] >= 0 ? fams![(Math.floor(skirtSource[v - gridCount] / (n + 1)) + 1) * w + (skirtSource[v - gridCount] % (n + 1)) + 1] : 0);
      const tc = indices.length;
      const dp = new Float32Array(tc * 3);
      const dn = new Float32Array(tc * 3);
      const dc = new Float32Array(tc * 3);
      const df = new Float32Array(tc * 3);
      const db = new Float32Array(tc * 3);
      for (let t = 0; t < tc; t += 3) {
        const f0 = family(indices[t]), f1 = family(indices[t + 1]), f2 = family(indices[t + 2]);
        for (let k = 0; k < 3; k++) {
          const src = indices[t + k];
          const o = (t + k) * 3;
          dp[o] = positions[src * 3];
          dp[o + 1] = positions[src * 3 + 1];
          dp[o + 2] = positions[src * 3 + 2];
          dn[o] = normals[src * 3];
          dn[o + 1] = normals[src * 3 + 1];
          dn[o + 2] = normals[src * 3 + 2];
          dc[o] = colors[src * 3];
          dc[o + 1] = colors[src * 3 + 1];
          dc[o + 2] = colors[src * 3 + 2];
          df[o] = f0;
          df[o + 1] = f1;
          df[o + 2] = f2;
          db[o + k] = 1;
        }
      }
      geo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(dn, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(dc, 3));
      geo.setAttribute('aFamily', new THREE.BufferAttribute(df, 3));
      geo.setAttribute('aBary', new THREE.BufferAttribute(db, 3));
      const identity = new Uint32Array(tc);
      for (let i = 0; i < tc; i++) identity[i] = i;
      geo.setIndex(new THREE.BufferAttribute(identity, 1));
      geo.computeBoundingSphere();
      if (opts.skirt === 0) geo.userData = { fullIndex: identity.slice(), n, ox, oz, step };
      return { geometry: geo, heights: physHeights, families: fams };
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return { geometry: geo, heights: physHeights, families: fams };
  }
}