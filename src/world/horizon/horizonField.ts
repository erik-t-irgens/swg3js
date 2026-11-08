// The browser's far-ground bake for one world (DESIGN.md §2.3, §2.13): the header and its sections fetched, decoded in a
// worker of its own behind the loading screen (`horizonDecode.ts`), its textures made at the world's own size and
// uploaded there, and, a frame, the selection run from the camera and the ring's uniforms written. The ring program,
// its uniforms and its two meshes are the session's (`RingSession`), made once and handed each world's textures, so a
// travel builds no ring program. W1: no overlay is laid (the owner's heights, the carve and the paint are W2 and W4's);
// what is drawn is the raw bake, behind a switch that starts at `'tiles'`.
import * as THREE from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';
import { GENERATOR_REVISION } from '../../swg/terrain/generator.ts';
import { GROUND_DRAW_TUNE, type GroundShift } from '../groundTiles.ts';
import type { TintReference } from '../groundMath.ts';
import { COLOUR_MODES } from '../groundTiles.ts';
import { groundTileUniforms, type GroundTileUniforms } from '../terrainTextures.ts';
import type { CourseCarve } from '../../swg/terrain/courseCarve.ts';
import type { HeightEdits } from '../../swg/terrain/heightEdits.ts';
import { DETAIL_SIZE, DETAIL_TILE, layerMeans, normalsRect, pyramidRelay, type DecodedBake, type RgbaRegion, type TileTables } from './horizonDecode.ts';
import { HORIZON_BIN, HORIZON_JSON, readHorizonHeader, type HorizonHeader } from './horizonFile.ts';
import { HORIZON_TUNE, HORIZON_VIEWS, HoleGrid, LEAF, RingSelector, cameraFrustum, newReachRules, newRingSurface, reachRules, ringSurfaceAt, type MinMaxPyramid, type ReachRules, type RingAsk, type RingSurface } from './horizonMath.ts';
import { HeightOverlay, REGEN_STEP, overridesOf, regenPlan, samplesIn, type RawRect, type SampleRect } from './horizonOverlay.ts';
import { makeRingUniforms, patchGeometry, ringMaterial, ringMesh, ringMipOffset, skirtGeometry, type RingUniforms } from './horizonRings.ts';
import { keepUploadRange, type UploadRange } from '../uploadRange.ts';

let standIns: RingUniforms | null = null;

/** The ring program, its uniforms, its meshes and its selection: the session's, never disposed. */
export class RingSession {
  readonly uniforms: RingUniforms = makeRingUniforms();
  readonly ground: GroundTileUniforms = groundTileUniforms();
  readonly selector = new RingSelector();
  readonly patch: THREE.Mesh;
  readonly skirt: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  private readonly patchAttr: THREE.InstancedBufferAttribute;
  private readonly skirtAttr: THREE.InstancedBufferAttribute;
  private readonly patchRange: UploadRange = { start: 0, count: 0 };
  private readonly skirtRange: UploadRange = { start: 0, count: 0 };
  constructor(csm: CSM | null) {
    this.material = ringMaterial(this.uniforms, this.ground, csm);
    const p = patchGeometry(this.selector.patchCap);
    const s = skirtGeometry(this.selector.skirtCap);
    // The selection writes straight into the arrays the meshes upload from.
    this.selector.patches = p.attribute.array as Float32Array;
    this.selector.skirts = s.attribute.array as Float32Array;
    this.patchAttr = p.attribute;
    this.skirtAttr = s.attribute;
    this.patch = ringMesh(p.geometry, this.material, 'horizon rings', HORIZON_TUNE.renderOrder);
    this.skirt = ringMesh(s.geometry, this.material, 'horizon skirts', HORIZON_TUNE.renderOrder);
  }
  /** The selection's counts into the meshes, each attribute's one kept upload range widened. */
  upload(): void {
    const sel = this.selector;
    (this.patch.geometry as THREE.InstancedBufferGeometry).instanceCount = sel.patchCount;
    (this.skirt.geometry as THREE.InstancedBufferGeometry).instanceCount = sel.skirtCount;
    if (sel.patchCount) {
      keepUploadRange(this.patchAttr.updateRanges, this.patchRange, 0, sel.patchCount * 4);
      this.patchAttr.needsUpdate = true;
    }
    if (sel.skirtCount) {
      keepUploadRange(this.skirtAttr.updateRanges, this.skirtRange, 0, sel.skirtCount * 4);
      this.skirtAttr.needsUpdate = true;
    }
  }
}

/** What the world hands the field of its ground: the tiler and the tile arrays' own pixels and masks. */
export interface FieldGround {
  tiler: { rank(f: number): number; layer(f: number, c: number): number; readonly corners: readonly number[] };
  colour: Uint8Array;
  size: number;
  depth: number;
  masks: Uint8Array;
  ms: number;
  reference: TintReference | null;
  /** The colour array and the bump array as the tile program samples them (the detail band's taps). */
}

/** The tables the decode worker composes the albedo from, made from the world's tiler and arrays. */
export function tileTablesOf(g: FieldGround): TileTables {
  const layerOf = new Uint8Array(256 * 256);
  const rankOf = new Float64Array(256);
  for (let f = 0; f < 256; f++) {
    rankOf[f] = g.tiler.rank(f);
    for (let c = 0; c < 256; c++) layerOf[f * 256 + c] = g.tiler.layer(f, c) & 255;
  }
  return {
    layerOf,
    rankOf,
    corners: [...g.tiler.corners],
    means: layerMeans(g.colour, g.size, g.depth),
    masks: g.masks,
    ms: g.ms,
    tintMode: Math.max(0, COLOUR_MODES.indexOf(GROUND_DRAW_TUNE.colour)),
    gainCap: GROUND_DRAW_TUNE.gainCap,
    reference: g.reference,
    add: GROUND_DRAW_TUNE.opposite === 'add',
    painted: GROUND_DRAW_TUNE.masks,
  };
}

function dataTex(data: ArrayBufferView, w: number, h: number, format: THREE.PixelFormat, type: THREE.TextureDataType, mips: boolean, srgb = false): THREE.DataTexture {
  const t = new THREE.DataTexture(data as never, w, h, format, type);
  t.unpackAlignment = 1;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  if (mips) {
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
  } else {
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** A lattice's bilinear at fractional sample (fx, fz), as `bakeLerp` works it (its clamps, the last cell's own corner), allocating nothing. */
function lerpIn(h: Float32Array, nx: number, fx: number, fz: number, nz: number): number {
  const cx = Math.min(Math.max(fx, 0), nx - 1);
  const cz = Math.min(Math.max(fz, 0), nz - 1);
  const ix = Math.min(Math.floor(cx), nx - 2);
  const iz = Math.min(Math.floor(cz), nz - 2);
  const ax = cx - ix;
  const az = cz - iz;
  const k = iz * nx + ix;
  const h0 = h[k] * (1 - ax) + h[k + 1] * ax;
  const h1 = h[k + nx] * (1 - ax) + h[k + nx + 1] * ax;
  return h0 * (1 - az) + h1 * az;
}

/** The fetch the field uses: the pack's own files, through `packFiles.ts` (a 404 remembered for the session). */
export interface FieldFetch {
  json(file: string): Promise<unknown | null>;
  bytes(file: string): Promise<Uint8Array | null>;
}

/**
 * The overlays' stores the world hands the field: the ones its near ground lays (W2), read as each lay is made, never
 * copied (the world hands the terrain itself, whose `heights` and `course` a late file replaces: W2's review).
 */
export interface OverlayStores {
  readonly heights: HeightEdits | null;
  readonly course: CourseCarve | null;
}

/** The live generator's square 2 m grid (`SwgTerrain.generatePoles`: the terrain worker's, with the paint laid), or null. */
export type PoleGenerate = (startX: number, startZ: number, n: number, step: number) => Promise<{ heights: Float32Array; shaders: Int32Array; children: Uint8Array; colors: Uint8Array } | null>;

/** A rectangle to make again and whether its heights moved too (a dropped building's ground does; the paint and Life Day do not). */
export interface RegenAsk extends RawRect {
  heights: boolean;
}

/** Why the far ground draws the far tiles, or null when it draws the rings: what `horizon()` says. */
export type FieldState = { state: 'none'; why: string } | { state: 'refused'; why: string } | { state: 'loading' } | { state: 'ready' };

/**
 * The longest the decode worker is waited for [ours]: a worker that never loads, dies or never answers draws the far
 * tiles, said in words, rather than holding the loading screen or the curtain for good. Tatooine's decode takes about a
 * second on the owner's machine; this is many times it.
 */
export const DECODE_WAIT_MS = 60000;

/** The dome's uniforms the ring's horizon fade reads (`SwgSky.domeUniforms`). */
export type DomeUniforms = Readonly<Record<'uGradient' | 'uGradient2' | 'uGradientMix' | 'uTime' | 'uHasGradient' | 'uHasGradient2' | 'uClear' | 'uHorizonFog', THREE.IUniform>>;

/**
 * The sky's dome uniforms copied into the ring's, a frame: the pictures and colours by value, the four numbers into the
 * one vector's fields (a number written into a uniform's `{ value }` is a number made every frame).
 */
export function copyDome(u: RingUniforms, d: DomeUniforms): void {
  u.uGradient.value = d.uGradient.value as THREE.Texture | null;
  u.uGradient2.value = d.uGradient2.value as THREE.Texture | null;
  const v = u.uRingDome.value;
  v.x = d.uTime.value as number;
  v.y = d.uHasGradient.value as number;
  v.z = d.uHasGradient2.value as number;
  v.w = d.uGradientMix.value as number;
  u.uClear.value.copy(d.uClear.value as THREE.Color);
  u.uHorizonFog.value.copy(d.uHorizonFog.value as THREE.Color);
}

export class HorizonField {
  header: HorizonHeader | null = null;
  state: FieldState = { state: 'loading' };
  pyramid: MinMaxPyramid | null = null;
  readonly textures: THREE.DataTexture[] = [];
  fine: THREE.DataTexture | null = null;
  coarse: THREE.DataTexture | null = null;
  private detailTex: THREE.DataTexture | null = null;
  private means: THREE.DataTexture | null = null;
  private worker: Worker | null = null;
  /** The detail window's middle (raw x, raw z) and whether a new one is asked (a kept array: no object field takes a number). */
  private readonly detailAt = new Float64Array([NaN, NaN]);
  private detailAsked = false;
  /** Let go (`dispose`): a load still on its way stops at its next step and binds nothing. */
  disposed = false;
  /** The selection timed for the console (`horizon()` asks): off until asked, a clock read being a number made. */
  timing = false;
  /** How long the decode worker is waited for (the tests move it). */
  decodeWaitMs = DECODE_WAIT_MS;
  /** What the worker last said that left the rings as they stood (a detail window that failed, the worker gone). */
  note: string | null = null;
  private abortDecode: (() => void) | null = null;
  /** What the decode cost, ms, for the console. */
  decodeMs: DecodedBake['ms'] | null = null;
  fetchMs = 0;
  /** The main thread's own share of a load (the tile tables, the textures made and put on the card), ms. */
  mainMs = 0;
  /** From the bake handed to the worker to its answer, ms (the worker's; the main thread is free meanwhile). */
  decodeWallMs = 0;
  /** How long the arrival waited at its join for the decode, after its other loads were done, ms (`World.loadPack`). */
  joinWaitMs = 0;
  readonly rules: ReachRules = newReachRules();
  readonly ask: RingAsk = { ex: 0, ey: 0, ez: 0, reach: 0, lod0: 1400, levels: 1, morph: 0.3, edgeBand: 64, drop: 2.5, shiftX: 0, shiftZ: 0, cx0: 0, cz0: 0, cx1: 0, cz1: 0 };
  private readonly frustum = new THREE.Frustum();
  private readonly m = new THREE.Matrix4();
  /** The selection's microseconds, the last 64 frames (a rolling median for the console). */
  readonly selectUs = new Float32Array(64);
  private selectAt = 0;
  readonly world: string;
  readonly centre: { x: number; z: number };
  readonly shift: GroundShift;
  /** The fine and coarse heights as laid (the very arrays the height textures hold), and the overlays' raw copies (W2). */
  private fineH: Float32Array | null = null;
  private coarseH: Float32Array | null = null;
  private overlay: HeightOverlay | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  /** What the ring's surface reads (the far cards', `ringSurfaceAt`): the lattices over the laid heights, the square and the drop. */
  readonly surface: RingSurface = newRingSurface();
  /** The overlays so far, for the console (W2). */
  readonly overlays = { tilesLaid: 0, layMs: 0, late: 0, regenAsked: 0, regenDone: 0, regenFailed: 0, cellsMade: 0, uploads: 0, landedInPlay: 0 };
  /** The worker's answers to the overlays by id. */
  private readonly overlayWait = new Map<number, (r: { fine: RgbaRegion; coarse: RgbaRegion } | null) => void>();
  private nextOverlay = 10;
  constructor(world: string, centre: { x: number; z: number }, shift: GroundShift) {
    this.world = world;
    this.centre = centre;
    this.shift = shift;
  }

  /**
   * The bake fetched, held to this build (refused in words otherwise), and decoded in the worker; its textures made and
   * handed to the session's uniforms. Answers whether the rings can be drawn.
   */
  async load(fetch: FieldFetch, ground: FieldGround | null, session: RingSession, renderer: THREE.WebGLRenderer | null, eye: { x: number; z: number }, stores: OverlayStores | null = null): Promise<boolean> {
    const t0 = performance.now();
    if (!ground) {
      this.state = { state: 'refused', why: "the ground's tile arrays are not loaded (swg.ground.tiles '0', or terrain shaders older than version 4): the albedo reads them" };
      return false;
    }
    const json = await fetch.json(HORIZON_JSON);
    if (this.disposed) return false;
    if (!json) {
      this.state = { state: 'none', why: `no bake on disk (npm run swg -- horizon assets-private --only=${this.world})` };
      return false;
    }
    const bin = await fetch.bytes(HORIZON_BIN);
    if (this.disposed) return false;
    if (!bin) {
      this.state = { state: 'none', why: `the bake's ${HORIZON_BIN} is missing (npm run swg -- horizon assets-private --only=${this.world})` };
      return false;
    }
    const read = readHorizonHeader(json, { generator: GENERATOR_REVISION, centre: this.centre, binLength: bin.length }, this.world);
    if ('refused' in read) {
      this.state = { state: 'refused', why: read.refused };
      return false;
    }
    this.header = read.header;
    this.fetchMs = performance.now() - t0;
    const tm = performance.now();
    const tables = tileTablesOf(ground);
    this.mainMs = performance.now() - tm;
    const td = performance.now();
    const d = await this.decode(read.header, bin, tables, eye);
    this.decodeWallMs = performance.now() - td;
    if (!d || this.disposed) return false;
    const tu = performance.now();
    this.decodeMs = d.ms;
    this.pyramid = d.pyramid;
    const h = read.header;
    this.fineH = d.fine;
    this.coarseH = d.coarse;
    this.surface.fine = { x0: h.fine.x0, z0: h.fine.z0, step: h.fine.step, nx: h.fine.nx, nz: h.fine.nz, h: d.fine };
    this.surface.coarse = { x0: h.coarse.x0, z0: h.coarse.z0, step: h.coarse.step, nx: h.coarse.nx, nz: h.coarse.nz, h: d.coarse };
    this.surface.cx = this.centre.x;
    this.surface.cz = this.centre.z;
    this.surface.sx = this.shift.x;
    this.surface.sz = this.shift.z;
    // The owner's heights and the drawn courses laid over the bake before anything is uploaded (§2.3: before the first ring
    // is drawn), each tile's normals and leaves made again from the laid heights.
    if (stores) this.layHeights(stores, d.fineNormal);
    const fine = (this.fine = dataTex(d.fine, h.fine.nx, h.fine.nz, THREE.RedFormat, THREE.FloatType, false));
    const coarse = (this.coarse = dataTex(d.coarse, h.coarse.nx, h.coarse.nz, THREE.RedFormat, THREE.FloatType, false));
    const fn = dataTex(d.fineNormal, h.fine.nx, h.fine.nz, THREE.RGFormat, THREE.UnsignedByteType, true);
    const cn = dataTex(d.coarseNormal, h.coarse.nx, h.coarse.nz, THREE.RGFormat, THREE.UnsignedByteType, true);
    const al = dataTex(d.albedo, h.colour.nx, h.colour.nz, THREE.RGBAFormat, THREE.UnsignedByteType, true, true);
    const cal = dataTex(d.coarseAlbedo, h.coarse.nx, h.coarse.nz, THREE.RGBAFormat, THREE.UnsignedByteType, true, true);
    const detail = (this.detailTex = dataTex(d.detail, DETAIL_SIZE, DETAIL_SIZE, THREE.RedFormat, THREE.UnsignedByteType, false));
    const mf = new Float32Array(256 * 4);
    for (let l = 0; l < 256; l++) {
      mf[l * 4] = tables.means[l * 3];
      mf[l * 4 + 1] = tables.means[l * 3 + 1];
      mf[l * 4 + 2] = tables.means[l * 3 + 2];
      mf[l * 4 + 3] = 1;
    }
    const means = (this.means = dataTex(mf, 256, 1, THREE.RGBAFormat, THREE.FloatType, false));
    this.textures.push(fine, coarse, fn, cn, al, cal, detail, means);
    this.detailAt[0] = this.centre.x - eye.x;
    this.detailAt[1] = eye.z + this.centre.z;
    if (renderer) {
      for (const t of this.textures) renderer.initTexture(t);
      // Let go on the main thread once on the card (the critique's minor 6): the normals and the albedo are the worker's
      // to make again; the heights stay (Light and shadow's march reads them, §2.8).
      for (const t of [fn, cn, al, cal]) t.image = { width: t.image.width, height: t.image.height, data: null } as never;
    }
    this.bind(session);
    this.renderer = renderer;
    this.mainMs += performance.now() - tu;
    this.state = { state: 'ready' };
    return true;
  }

  // ---------------------------------------------------------------- W2: the overlays (DESIGN.md §2.3)

  /**
   * The stores' heights laid over the fine samples from raw (`HeightOverlay`), every tile laid having its normals and the
   * pyramid's leaves made again; before the textures exist (an arrival) into `normals`, the whole lattice's array, and after
   * (a late file) each tile's rectangle uploaded. Answers how many tiles it laid.
   */
  layHeights(stores: OverlayStores, normals: Uint8Array | null = null): number {
    const h = this.header;
    const fine = this.fineH;
    if (!h || !fine) return 0;
    const t0 = performance.now();
    this.overlay ??= new HeightOverlay(h.fine);
    const rects = this.overlay.layAll(fine, stores.heights, stores.course);
    for (const r of rects) this.heightsMoved(r, normals);
    this.overlays.tilesLaid += rects.length;
    this.overlays.layMs += performance.now() - t0;
    return rects.length;
  }

  /** How many horizon tiles keep a raw copy (an overlay touches them). */
  get rawTilesKept(): number {
    return this.overlay?.kept ?? 0;
  }

  /** A late file (heights or a course landed after the arrival): the whole layer laid again, as at an arrival, and uploaded. */
  relayLate(stores: OverlayStores): number {
    if (this.state.state !== 'ready') return 0;
    this.overlays.late++;
    return this.layHeights(stores, null);
  }

  /** The samples of a rectangle moved: their normals (and a sample round them), the pyramid's leaves and, once on the card, the textures. */
  private heightsMoved(r: SampleRect, normals: Uint8Array | null): void {
    const h = this.header!;
    const L = h.fine;
    const fine = this.fineH!;
    const i0 = Math.max(0, r.i0 - 1);
    const j0 = Math.max(0, r.j0 - 1);
    const i1 = Math.min(L.nx - 1, r.i1 + 1);
    const j1 = Math.min(L.nz - 1, r.j1 + 1);
    if (normals) normalsRect(fine, L, i0, j0, i1, j1, normals);
    else if (this.renderer && this.textures.length) {
      const w = i1 - i0 + 1;
      const hh = j1 - j0 + 1;
      const n = normalsRect(fine, L, i0, j0, i1, j1, new Uint8Array(w * hh * 2), i0, j0, w);
      this.upload(this.textures[2], n, i0, j0, w, hh, THREE.RGFormat, THREE.UnsignedByteType);
      const hr = new Float32Array(w * hh);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) hr[(j - j0) * w + (i - i0)] = fine[j * L.nx + i];
      this.upload(this.textures[0], hr, i0, j0, w, hh, THREE.RedFormat, THREE.FloatType);
    }
    if (this.pyramid) {
      const c = this.centre;
      pyramidRelay(this.pyramid, h, fine, this.coarseH!, c, c.x - (L.x0 + r.i1 * L.step), L.z0 + r.j0 * L.step - c.z, c.x - (L.x0 + r.i0 * L.step), L.z0 + r.j1 * L.step - c.z);
    }
  }

  /** A rectangle of texels put on the card in place (`copyTextureToTexture` from a stand-in of the rectangle; mips made again). */
  private upload(dst: THREE.DataTexture, data: ArrayBufferView, i0: number, j0: number, w: number, h: number, format: THREE.PixelFormat, type: THREE.TextureDataType, srgb = false): void {
    const r = this.renderer;
    if (!r || !w || !h || this.disposed) return;
    const src = new THREE.DataTexture(data as never, w, h, format, type);
    src.unpackAlignment = 1;
    if (srgb) src.colorSpace = THREE.SRGBColorSpace;
    r.copyTextureToTexture(src, dst, null, new THREE.Vector2(i0, j0));
    src.dispose();
    this.overlays.uploads++;
  }

  /**
   * What only the generator lays exactly made again (§2.3: the paint, a dropped building's ground, Life Day's layer in
   * season): each rectangle's 2 m grid asked of the live generator, its 4 m poles' families and choices and its cells'
   * colour means handed to the decode worker, which composes their albedo and the coarse texels they reach again, put on the
   * card as they come; a dropped building's heights made raw again there and the stores laid over them. Resolves once every
   * rectangle is done (the arrival waits for it, bounded by `regenWaitMs`; what comes later lands in play).
   */
  async regenerate(asks: readonly RegenAsk[], gen: PoleGenerate, stores: OverlayStores | null): Promise<void> {
    const h = this.header;
    if (!h || this.state.state !== 'ready') return;
    for (const a of asks) {
      const p = regenPlan(h.colour, a);
      if (!p) continue;
      this.overlays.regenAsked++;
      const g = await gen(p.startX, p.startZ, p.n, REGEN_STEP);
      if (this.disposed) return;
      if (!g) {
        this.overlays.regenFailed++;
        continue;
      }
      if (a.heights && this.overlay && this.fineH) {
        const s = samplesIn(h.fine, a);
        if (s) {
          const L = h.fine;
          this.overlay.setRaw(this.fineH, s, (i, j) => {
            const x = (L.x0 + i * L.step - p.startX) / REGEN_STEP;
            const z = (L.z0 + j * L.step - p.startZ) / REGEN_STEP;
            return x === Math.floor(x) && z === Math.floor(z) && x >= 0 && z >= 0 && x < p.n && z < p.n ? g.heights[z * p.n + x] : Number.NaN;
          });
          this.layHeights(stores ?? { heights: null, course: null }, null);
        }
      }
      const ov = overridesOf(h.colour, p, g);
      const answer = await this.overlayAsk(ov.poles, ov.cells, p.i0, p.j0, p.i1, p.j1);
      if (this.disposed) return;
      if (!answer) {
        this.overlays.regenFailed++;
        continue;
      }
      this.upload(this.textures[4], answer.fine.rgba, answer.fine.i0, answer.fine.j0, answer.fine.w, answer.fine.h, THREE.RGBAFormat, THREE.UnsignedByteType, true);
      this.upload(this.textures[5], answer.coarse.rgba, answer.coarse.i0, answer.coarse.j0, answer.coarse.w, answer.coarse.h, THREE.RGBAFormat, THREE.UnsignedByteType, true);
      this.overlays.regenDone++;
      this.overlays.cellsMade += answer.fine.w * answer.fine.h;
    }
    // The detail window made again round where it stands, the painted tiles' own layers in it.
    if (this.worker && asks.length) {
      this.detailAsked = true;
      this.worker.postMessage({ type: 'detail', id: 2, rx: this.detailAt[0], rz: this.detailAt[1] });
    }
  }

  /** One overlay handed to the worker and its albedo awaited (null with no worker, or one that failed or went). */
  private overlayAsk(poles: unknown, cells: unknown, i0: number, j0: number, i1: number, j1: number): Promise<{ fine: RgbaRegion; coarse: RgbaRegion } | null> {
    const w = this.worker;
    if (!w) return Promise.resolve(null);
    const id = this.nextOverlay++;
    return new Promise((resolve) => {
      this.overlayWait.set(id, resolve);
      w.postMessage({ type: 'overlay', id, poles, cells, i0, j0, i1, j1 });
    });
  }

  /**
   * The bake's height at a raw place (`heightIfCached` past the blocks, §2.9): the fine lattice's bilinear inside its extent,
   * the coarse past it, NaN past both (`bakeHeightAt`'s arithmetic, written out: a frame's readers ask it, and a closure a
   * call is an object made). The heights as laid, never dropped.
   */
  heightRaw(rx: number, rz: number): number {
    const h = this.header;
    const f = this.fineH;
    const c = this.coarseH;
    if (!h || !f || !c) return Number.NaN;
    const L = h.fine;
    const fx = (rx - L.x0) / L.step;
    const fz = (rz - L.z0) / L.step;
    if (fx >= 0 && fz >= 0 && fx <= L.nx - 1 && fz <= L.nz - 1) return lerpIn(f, L.nx, fx, fz, L.nz);
    const C = h.coarse;
    const cx = (rx - C.x0) / C.step;
    const cz = (rz - C.z0) / C.step;
    if (cx >= 0 && cz >= 0 && cx <= C.nx - 1 && cz <= C.nz - 1) return lerpIn(c, C.nx, cx, cz, C.nz);
    return Number.NaN;
  }

  /**
   * The drawn ring's surface at a game place (the far cards', §2.9): the hole's square as the selection stands it round
   * chunk (pcx, pcz) with `viewRadius` chunks, and the drop's numbers in force; NaN with no bake.
   */
  surfaceAt(gx: number, gz: number, pcx: number, pcz: number, viewRadius: number): number {
    const s = this.surface;
    const t = HORIZON_TUNE;
    s.sq0 = (pcx - viewRadius - 1) * LEAF + this.shift.x;
    s.sq1 = (pcz - viewRadius - 1) * LEAF + this.shift.z;
    s.sq2 = (pcx + viewRadius + 2) * LEAF + this.shift.x;
    s.sq3 = (pcz + viewRadius + 2) * LEAF + this.shift.z;
    s.drop = t.drop;
    s.fade = t.dropFade;
    s.everywhere = t.dropAt === 'everywhere' ? 1 : 0;
    return ringSurfaceAt(s, gx, gz);
  }

  /**
   * The bake decoded in a worker of its own, answered once: with the decoded bake, or null with the state saying why
   * (the worker could not be made, failed to load, died, sent what does not read, said the bake did not decode, or said
   * nothing within `decodeWaitMs`), so the far tiles are drawn and nothing waits for good. Once decoded the worker stays
   * for the detail window, and what goes wrong with it after is a note: the rings stand as they stood.
   */
  private decode(header: HorizonHeader, bin: Uint8Array, tables: TileTables, eye: { x: number; z: number }): Promise<DecodedBake | null> {
    return new Promise((resolve) => {
      if (this.disposed) {
        resolve(null);
        return;
      }
      let w: Worker;
      try {
        w = new Worker(new URL('./horizonDecodeWorker.ts', import.meta.url), { type: 'module' });
      } catch (err) {
        this.state = { state: 'refused', why: `no decode worker (${String(err)})` };
        resolve(null);
        return;
      }
      this.worker = w;
      let answered = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const fail = (why: string) => {
        if (answered) {
          this.note = why;
          return;
        }
        answered = true;
        if (timer !== null) clearTimeout(timer);
        this.state = { state: 'refused', why };
        w.terminate();
        if (this.worker === w) this.worker = null;
        resolve(null);
      };
      timer = setTimeout(() => fail(`the decode worker said nothing in ${Math.round(this.decodeWaitMs / 1000)} s`), this.decodeWaitMs);
      // Let go while it decodes: answered now (nothing), so whatever awaits the load is not held by a worker gone.
      this.abortDecode = () => {
        if (answered) return;
        answered = true;
        if (timer !== null) clearTimeout(timer);
        resolve(null);
      };
      w.onerror = (e: ErrorEvent) => {
        e.preventDefault?.();
        if (answered) {
          // The worker gone after the decode: the rings stand, the detail window is no longer made again.
          this.note = `the decode worker failed (${e.message || 'no word'}): the detail window stays as it is`;
          if (this.worker === w) this.worker = null;
          this.answerOverlays();
          return;
        }
        fail(`the decode worker failed (${e.message || 'it did not load'})`);
      };
      w.onmessageerror = () => fail('the decode worker sent what does not read');
      w.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; id?: number; d?: DecodedBake; detail?: Uint8Array; message?: string; rx?: number; rz?: number };
        if (m.type === 'decoded' && !answered) {
          answered = true;
          if (timer !== null) clearTimeout(timer);
          resolve(m.d!);
        } else if (m.type === 'detail' && this.detailTex && m.detail) {
          (this.detailTex.image as { data: Uint8Array }).data = m.detail;
          this.detailTex.needsUpdate = true;
          this.detailAsked = false;
        } else if (m.type === 'overlay' && m.id !== undefined) {
          const r = this.overlayWait.get(m.id);
          this.overlayWait.delete(m.id);
          r?.(m as unknown as { fine: RgbaRegion; coarse: RgbaRegion });
        } else if (m.type === 'error') {
          // An overlay that did not compose keeps the albedo that stands (a note); so does a detail window.
          if (m.id !== undefined && m.id >= 10) {
            const r = this.overlayWait.get(m.id);
            this.overlayWait.delete(m.id);
            r?.(null);
            this.note = `an overlay's albedo was not made again (${m.message})`;
          } else if (m.id === 2 || answered) this.note = `the detail window was not made again (${m.message})`;
          else fail(`the bake did not decode (${m.message})`);
        }
      };
      w.postMessage({ type: 'decode', id: 1, header, bin: bin.buffer, tables, centre: this.centre, shift: { x: this.shift.x, z: this.shift.z }, eye: { rx: this.centre.x - eye.x, rz: eye.z + this.centre.z } }, [bin.buffer as ArrayBuffer]);
    });
  }

  /** The world's textures into the session's uniforms (a sampler's value: no program changes). */
  bind(s: RingSession): void {
    const h = this.header;
    if (!h || !this.fine || !this.coarse) return;
    const u = s.uniforms;
    const [fine, coarse, fn, cn, al, cal, detail, means] = this.textures;
    u.uHorizonFineH.value = fine;
    u.uHorizonCoarseH.value = coarse;
    u.uHorizonFineN.value = fn;
    u.uHorizonCoarseN.value = cn;
    u.uHorizonAlbedo.value = al;
    u.uHorizonCoarseAlbedo.value = cal;
    u.uHorizonDetail.value = detail;
    u.uHorizonMeans.value = means;
    u.uHorizonFine.value.set(h.fine.x0, h.fine.z0, h.fine.step, ringMipOffset(h.fine.step));
    u.uHorizonCoarse.value.set(h.coarse.x0, h.coarse.z0, h.coarse.step, ringMipOffset(h.coarse.step));
    u.uHorizonColour.value.set(h.colour.x0, h.colour.z0, h.colour.step, 0);
    u.uHorizonSizes.value.set(h.fine.nx, h.fine.nz, h.coarse.nx, h.coarse.nz);
    u.uHorizonColourN.value.set(h.colour.nx, h.colour.nz, 0, 0);
    u.uHorizonGrid.value.set(this.shift.x, this.shift.z, 0, 0);
  }

  /**
   * A frame: the reach in force from the fog (the caller writes the fog's density into `rules.fogDensity` first: a
   * fraction handed across this call is a number made), the hole's square, the eye, the selection over the camera's
   * frustum, and the uniforms the program reads, each vector's fields written as they stand. Allocates nothing, builds
   * no string, and reads the clock only while the console times the selection (`timing`).
   */
  update(s: RingSession, camera: THREE.PerspectiveCamera, eye: THREE.Vector3, viewRadius: number, pcx: number, pcz: number, hole: HoleGrid, reversed: boolean): void {
    const t = HORIZON_TUNE;
    const r = reachRules(t, viewRadius, reversed, this.rules);
    const a = this.ask;
    a.ex = eye.x;
    a.ey = eye.y;
    a.ez = eye.z;
    a.reach = r.inForce;
    a.lod0 = r.lod0;
    a.levels = r.levels;
    a.morph = t.morph;
    a.edgeBand = t.edgeBand;
    a.drop = t.drop;
    a.shiftX = this.shift.x;
    a.shiftZ = this.shift.z;
    a.cx0 = pcx - viewRadius - 1;
    a.cx1 = pcx + viewRadius + 1;
    a.cz0 = pcz - viewRadius - 1;
    a.cz1 = pcz + viewRadius + 1;
    const u = s.uniforms;
    // Each vector's fields as they stand: `Vector4.set` hands its four numbers across a call.
    const ue = u.uHorizonEye.value;
    ue.x = eye.x;
    ue.y = eye.y;
    ue.z = eye.z;
    ue.w = r.inForce;
    const us = u.uHorizonSquare.value;
    us.x = a.cx0 * LEAF + this.shift.x;
    us.y = a.cz0 * LEAF + this.shift.z;
    us.z = (a.cx1 + 1) * LEAF + this.shift.x;
    us.w = (a.cz1 + 1) * LEAF + this.shift.z;
    const um = u.uHorizonMorph.value;
    um.x = r.lod0;
    um.y = t.morph;
    um.z = t.edgeBand;
    um.w = r.levels - 1;
    const ud = u.uHorizonDrop.value;
    ud.x = t.drop;
    ud.y = t.dropFade;
    ud.z = t.dropAt === 'everywhere' ? 1 : 0;
    ud.w = t.ringSkirt;
    const ul = u.uHorizonLook.value;
    ul.x = t.fogCheap;
    ul.y = t.detailReach;
    ul.z = t.detailFade;
    ul.w = t.detail === 'tile' ? 1 : 0;
    const uf = u.uHorizonFade.value;
    uf.x = t.fade;
    uf.y = t.fadeOn ? 1 : 0;
    uf.z = t.fadeTo === 'sky' ? 0 : t.fadeTo === 'fog' ? 1 : 2;
    uf.w = Math.max(0, HORIZON_VIEWS.indexOf(t.view));
    s.patch.renderOrder = s.skirt.renderOrder = t.renderOrder;
    if (this.timing) {
      const t0 = performance.now();
      cameraFrustum(camera, this.m, this.frustum);
      s.selector.select(this.frustum, a, this.pyramid, hole);
      this.selectUs[this.selectAt++ & 63] = (performance.now() - t0) * 1000;
    } else {
      cameraFrustum(camera, this.m, this.frustum);
      s.selector.select(this.frustum, a, this.pyramid, hole);
    }
    s.upload();
    // The detail window made again round the eye once it has moved a twelfth of the window off its middle (§2.5's strips are W3's).
    const rx = this.centre.x - eye.x;
    const rz = eye.z + this.centre.z;
    const da = this.detailAt;
    const off = Math.max(Math.abs(rx - da[0]), Math.abs(rz - da[1]));
    if (this.worker && !this.detailAsked && off > (DETAIL_SIZE * DETAIL_TILE) / 12) {
      this.detailAsked = true;
      da[0] = rx;
      da[1] = rz;
      this.worker.postMessage({ type: 'detail', id: 2, rx, rz });
    }
  }

  /**
   * The selection's microseconds: the mean over the last 64 frames (a browser's clock is coarse, 0.1 ms or worse, so a
   * frame's own reading is mostly nought or one step; the mean of many is the measure), or, with `bench`, the last
   * frame's selection run again `bench` times on its own inputs and timed whole.
   */
  selectMean(): number {
    let s = 0;
    for (let i = 0; i < 64; i++) s += this.selectUs[i];
    return s / 64;
  }
  benchSelect(s: RingSession, hole: HoleGrid, n: number): number {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) s.selector.select(this.frustum, this.ask, this.pyramid, hole);
    return ((performance.now() - t0) * 1000) / Math.max(1, n);
  }

  /** MB on the card (the formats' arithmetic: heights 4 bytes, normals 2 with mips, albedo 4 with mips) and on the CPU. */
  megabytes(): { card: number; cpu: number } {
    const h = this.header;
    if (!h) return { card: 0, cpu: 0 };
    const mip = 4 / 3;
    const f = h.fine.nx * h.fine.nz;
    const c = h.coarse.nx * h.coarse.nz;
    const col = h.colour.nx * h.colour.nz;
    const card = f * 4 + c * 4 + (f + c) * 2 * mip + (col + c) * 4 * mip + DETAIL_SIZE * DETAIL_SIZE + 256 * 16;
    const pyr = this.pyramid ? this.pyramid.lo.reduce((n, a) => n + a.byteLength * 2, 0) : 0;
    return { card: card / 1048576, cpu: (f * 4 + c * 4 + pyr) / 1048576 };
  }

  /** Every overlay still awaited answered with nothing (the worker gone, the field let go), so no caller waits for good. */
  private answerOverlays(): void {
    const waits = [...this.overlayWait.values()];
    this.overlayWait.clear();
    for (const r of waits) r(null);
  }

  dispose(s: RingSession | null): void {
    this.disposed = true;
    this.answerOverlays();
    this.abortDecode?.();
    this.abortDecode = null;
    this.worker?.terminate();
    this.worker = null;
    if (s) {
      // The stand-ins put back (made once a session), so no freed texture stays bound.
      const fresh = (standIns ??= makeRingUniforms());
      const u = s.uniforms;
      for (const k of ['uHorizonFineH', 'uHorizonCoarseH', 'uHorizonFineN', 'uHorizonCoarseN', 'uHorizonAlbedo', 'uHorizonCoarseAlbedo', 'uHorizonDetail', 'uHorizonMeans'] as const) u[k].value = fresh[k].value;
    }
    for (const t of this.textures) t.dispose();
    this.textures.length = 0;
  }
}
