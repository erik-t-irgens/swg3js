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
import { DETAIL_TILE, STRIP_TILES, clipRect, freshRects, layerMeans, normalsRect, poleTiles, pyramidRelay, windowPlace, windowTiles, wrapPieces, type DecodedBake, type IndexRect, type RgbaRegion, type TileTables, type WindowPlace } from './horizonDecode.ts';
import { HORIZON_BIN, HORIZON_JSON, readHorizonHeader, type HorizonHeader } from './horizonFile.ts';
import { PlainColours, plainAlbedoRect, type MadeGroundSpec, type PlainGround } from './horizonDem.ts';
import { HORIZON_TUNE, HORIZON_VIEWS, HoleGrid, LEAF, PATCH, RingSelector, bakeHeightAt, cameraFrustum, newReachRules, newRingSurface, reachRules, ringLevelOf, ringSurfaceAt, type MinMaxPyramid, type ReachRules, type RingAsk, type RingSurface } from './horizonMath.ts';
import { HORIZON_TILE, HeightOverlay, REGEN_STEP, overridesOf, regenPlan, samplesIn, type RawRect, type SampleRect } from './horizonOverlay.ts';
import { PAINT_TILE, paintTileOf } from '../../swg/terrain/groundPaint.ts';
import { makeRingUniforms, patchGeometry, ringMaterial, ringMesh, ringMipOffset, skirtGeometry, type RingUniforms } from './horizonRings.ts';
import { SHAPE_BLOCK, SHAPE_EMPTY, SHAPE_SIDE, ShapeWindow, type ShapeSource } from './shapeWindow.ts';
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

/**
 * Every how many texels each way a layer's mean is read off the tile arrays' own pixels: two (the third wave's self test
 * found every fourth texel left one layer of Tatooine's three levels off the card's own top mip).
 */
export const MEANS_STRIDE = 2;

/**
 * How many levels of sRGB the card's own top mip may stand off a layer's exact mean: the card rounds each level of its
 * sRGB chain to a byte, which leaves it three levels off on one of Tatooine's 38 layers (the third wave's measurement,
 * both backends); every other layer stood within the design's two.
 */
export const MEANS_CARD_MOST = 3;

/** A linear value as an sRGB byte (the self test's own: the card's top mip and the means compared as levels). */
function srgbLevel(v: number): number {
  return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055));
}

/**
 * The self test's verdict on the layer means, anchored to the card (the review round: held only against themselves, a
 * fault inside `layerMeans` moved both and still passed): every layer's exact mean (every texel, `exact`) and the means
 * the albedo is composed from (`means`, every other texel) each within `MEANS_CARD_MOST` levels of the card's own top mip
 * (`card`, RGBA a layer). `overTwo` names the layers past the design's two, the card's rounding cases; `strideWorst` says
 * what reading every other texel cost, for the record.
 */
export function meansVerdict(card: Float32Array, means: Float32Array, exact: Float32Array, depth: number): { within: boolean; worstLevels: number; worstLayer: number; exactWorst: number; strideWorst: number; overTwo: number[] } {
  let worstLevels = 0;
  let worstLayer = -1;
  let exactWorst = 0;
  let strideWorst = 0;
  const overTwo: number[] = [];
  for (let l = 0; l < depth; l++) {
    let layerWorst = 0;
    for (let c = 0; c < 3; c++) {
      const k = srgbLevel(card[l * 4 + c]);
      const m = srgbLevel(means[l * 3 + c]);
      const e = srgbLevel(exact[l * 3 + c]);
      layerWorst = Math.max(layerWorst, Math.abs(k - m));
      exactWorst = Math.max(exactWorst, Math.abs(k - e));
      strideWorst = Math.max(strideWorst, Math.abs(m - e));
    }
    if (layerWorst > worstLevels) {
      worstLevels = layerWorst;
      worstLayer = l;
    }
    if (layerWorst > 2) overTwo.push(l);
  }
  const within = depth > 0 && exactWorst <= MEANS_CARD_MOST && worstLevels <= MEANS_CARD_MOST;
  return { within, worstLevels, worstLayer, exactWorst, strideWorst, overTwo };
}

/**
 * The ground knobs the tile tables read (`tileTablesOf`: the tint's mode and gain cap, the opposite rule, the masks, and
 * through the tiler the order, the children and their corner), as one key: a console's ground knob asks the far ground to
 * compose again only when this moved (a view, the shine, the clouds or the way round move none of what it composes).
 */
export function tableKnobs(t: typeof GROUND_DRAW_TUNE = GROUND_DRAW_TUNE): string {
  return `${t.colour}|${t.gainCap}|${t.opposite}|${t.masks}|${t.order}|${t.children}|${t.childCorner.join()}`;
}

/**
 * The tables the decode worker composes the albedo from, made from the world's tiler and arrays; `means` handed in where
 * they were worked out already (a retune: no knob moves the arrays' pixels, so the load's means stand).
 */
export function tileTablesOf(g: FieldGround, means: Float32Array = layerMeans(g.colour, g.size, g.depth, MEANS_STRIDE)): TileTables {
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
    means,
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

/**
 * The heights atlas the ring's vertex stage reads with `texelFetch` (the third wave's sampler budget): the fine lattice's
 * rows from row nought, the coarse lattice's after them, each from column nought, so a fine rectangle put on the card later
 * lands at its own indices (`heightsMoved`).
 */
export function heightsAtlas(fine: Float32Array, fnx: number, fnz: number, coarse: Float32Array, cnx: number, cnz: number, shape = 0): Float32Array {
  const L = atlasLayout(fnx, fnz, cnx, cnz, shape);
  const w = L.w;
  const out = new Float32Array(w * L.h);
  for (let j = 0; j < fnz; j++) out.set(fine.subarray(j * fnx, (j + 1) * fnx), j * w);
  for (let j = 0; j < cnz; j++) out.set(coarse.subarray(j * cnx, (j + 1) * cnx), (fnz + j) * w);
  // The shape window's block (wave 3b), beside the coarse rows, empty until its blocks are made.
  for (let j = 0; j < shape; j++) out.fill(SHAPE_EMPTY, (L.row + j) * w + L.col, (L.row + j) * w + L.col + shape);
  return out;
}

/**
 * The heights atlas's size and where the shape window's block stands in it (wave 3b): beside the coarse rows (whose width
 * leaves the room on every world of 16 km), the atlas grown to hold it where it does not; with no window, the atlas of before.
 */
export function atlasLayout(fnx: number, fnz: number, cnx: number, cnz: number, shape: number): { w: number; h: number; col: number; row: number } {
  if (!shape) return { w: Math.max(fnx, cnx), h: fnz + cnz, col: 0, row: 0 };
  return { w: Math.max(fnx, cnx + shape), h: fnz + Math.max(cnz, shape), col: cnx, row: fnz };
}

/** A texture's own array let go once it is on the card (its size kept, for the uploads and the console). */
function letGo(t: THREE.DataTexture): void {
  t.image = { width: t.image.width, height: t.image.height, data: null } as never;
}

/** The composition window's texture: RGBA16UI, `S` a side, read by `texelFetch` alone. */
function windowTex(data: Uint16Array, S: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data as never, S, S, THREE.RGBAIntegerFormat, THREE.UnsignedShortType);
  t.internalFormat = 'RGBA16UI';
  t.unpackAlignment = 1;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** The tint window's texture: the colour map's bytes as they stand (no colour space), filtered between cell centres, wrapping. */
function tintTex(data: Uint8Array, T: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data as never, T, T, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.unpackAlignment = 1;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
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
/** A course's piece waiting to be laid: a rectangle of the raw frame inside one horizon tile, and that tile's key. */
interface CoursePiece extends RawRect {
  key: number;
}

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

/** The shape window's blocks put on the card a frame at most (4 KB each), and past how many due the whole block goes at once [ours]. */
export const SHAPE_UPLOADS_PER_FRAME = 24;
export const SHAPE_WHOLE_PAST = 96;
/**
 * Past how many due blocks a window of `blocks` a side goes on the card whole: `SHAPE_WHOLE_PAST` of the window of 1,024's
 * 1,024 blocks, the same share of any other's (h6a's review: the whole upload grows with the window's area, and at 2,048 a
 * diagonal step of one block empties 127 slots, past 96, which put the 16 MB window on the card whole in a live frame for
 * about half a megabyte of blocks). A whole number (a shift), so the frame's test makes nothing.
 */
export function shapeWholePast(blocks: number): number {
  return (SHAPE_WHOLE_PAST * blocks * blocks) >> 10;
}

/** How many times a composition window ask that failed in the worker is asked again before the field gives it up [ours]. */
export const WINDOW_RETRIES = 3;
/** The kinds of window ask (`windowKind`). */
const ASK_STRIP = 1;
const ASK_WHOLE = 2;
const ASK_RETUNE = 3;

/** What the decode worker answers (`horizonDecodeWorker.ts`), every kind's fields optional. */
interface WorkerAnswer {
  type: string;
  id?: number;
  d?: DecodedBake;
  message?: string;
  place?: WindowPlace;
  window?: Uint16Array;
  tint?: Uint8Array;
  tileRects?: IndexRect[];
  cellRects?: IndexRect[];
  tiles?: Uint16Array[];
  cells?: Uint8Array[];
  albedo?: Uint8Array;
  coarseAlbedo?: Uint8Array;
  heights?: Float32Array;
}

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
  /** The heights atlas (the fine lattice's rows, then the coarse's), the fine normals, the two albedos. */
  heights: THREE.DataTexture | null = null;
  private fineN: THREE.DataTexture | null = null;
  private albedo: THREE.DataTexture | null = null;
  private coarseAlbedo: THREE.DataTexture | null = null;
  /** The composition window and its tint window (the third wave), and where they stand on the card. */
  private winTex: THREE.DataTexture | null = null;
  private tintTex: THREE.DataTexture | null = null;
  readonly place: WindowPlace = { ox: 0, oz: 0, S: 0, ci0: 0, cj0: 0, T: 0 };
  /**
   * A window asked of the worker and not yet answered (a strip, a whole one, a retune), by id: one at a time. The window
   * asks take the even ids and the overlays the odd ones past the decode's 1 (the review round: counted from 3 and 10, a
   * window's error past its seventh ask was read as an overlay's, and the window never asked again).
   */
  private windowAsked = 0;
  private nextWindow = 2;
  /** The window's counts for the console: strips made, wholes made, texels uploaded by strips, the last strip's worker time. */
  readonly windowWork = { strips: 0, wholes: 0, retunes: 0, texels: 0, takeMs: 0, stripMs: 0 };
  private session: RingSession | null = null;
  private worker: Worker | null = null;
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
  readonly ask: RingAsk = { ex: 0, ey: 0, ez: 0, reach: 0, lod0: 1400, levels: 1, morph: 0.3, edgeBand: 64, drop: 2.5, shiftX: 0, shiftZ: 0, cx0: 0, cz0: 0, cx1: 0, cz1: 0, finest: 0, r1: 0.5, r2: 0.5, pad: 0.5 };
  /**
   * Wave 3b: the shape window's side in samples, set before `load` (nought: none, the atlas of before), the window, where
   * its block stands in the atlas, and the kept stand-in each made block goes on the card through (never bound).
   */
  shapeSide = 0;
  shapeStep = 2;
  shape: ShapeWindow | null = null;
  private shapeCol = 0;
  private shapeRow = 0;
  private shapeSrc: THREE.DataTexture | null = null;
  private shapeWhole: THREE.DataTexture | null = null;
  private readonly shapeAt = new THREE.Vector2();
  /** For the console: blocks put on the card, and whole windows. */
  readonly shapeWork = { blocks: 0, wholes: 0 };
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
  /** The world's ground the tables are made from (its tiler is refreshed in place), for a retune. */
  private ground: FieldGround | null = null;
  /** The window made again whole at the next chance (a whole window that failed), and the tables made again (a ground knob moved). */
  private windowStale = false;
  private retuneWanted = false;
  /** The kind of the window ask in flight (`ASK_STRIP`, `ASK_WHOLE`, `ASK_RETUNE`): what a failure of it asks for again. */
  private windowKind = 0;
  /** Window asks failed since one last landed: each asked again, up to `WINDOW_RETRIES`, then given up (a note) until a new cause. */
  private windowFails = 0;
  /**
   * The window's tiles and the tint window's cells a regenerate made again (index space, unclipped), waiting for the next
   * ask: a strip makes them again where the window holds them (a whole window or a retune makes everything). The first
   * `regenSent` of them went with the ask in flight and are struck off when it lands; one that fails leaves them waiting.
   */
  private readonly regenTiles: IndexRect[] = [];
  private readonly regenCells: IndexRect[] = [];
  private regenSent = 0;
  /** The layer means the load's tables read, kept: no knob moves the arrays' pixels, so a retune reuses them. */
  private means: Float32Array | null = null;
  /** Where the next window is asked to stand (kept: a frame that asks none makes nothing). */
  private readonly nextPlace: WindowPlace = { ox: 0, oz: 0, S: 0, ci0: 0, cj0: 0, T: 0 };
  /** The eye's raw place a frame, the distance last read and the window's side for it (fields: a frame hands no number across a call). */
  /** The eye's raw place this frame (written first thing in `update`): read by the far tree cards' field beside it. */
  readonly eyeRaw = new Float64Array(2);
  private reachSeen = 0.5;
  private wantS = 0;
  /** What the ring's surface reads (the far cards', `ringSurfaceAt`): the lattices over the laid heights, the square and the drop. */
  readonly surface: RingSurface = newRingSurface();
  /** The overlays so far, for the console (W2). */
  readonly overlays = { tilesLaid: 0, layMs: 0, late: 0, regenAsked: 0, regenDone: 0, regenFailed: 0, cellsMade: 0, uploads: 0, landedInPlay: 0 };
  /** The worker's answers to the overlays by id. */
  private readonly overlayWait = new Map<number, (r: { fine: RgbaRegion; coarse: RgbaRegion } | null) => void>();
  private nextOverlay = 3;
  /** A made world's shape-window blocks awaited of the decode worker, by id (`madePoles`). */
  private readonly polesWait = new Map<number, (r: { heights: Float32Array } | null) => void>();

  // ---------------------------------------------------------------- W4: the edits followed live (DESIGN.md §6)
  /** The clock the live steps read (the tests move it); read only while something waits, a clock read being a number made. */
  now: () => number = () => performance.now();
  /**
   * What the live edits came to, for the console (`horizon()`): relays laid (`relays`, the samples they wrote), flagged
   * copies that made mips (`mips`), a course's pieces laid and waiting, the paint's tiles made again, named again while on
   * their way (`merged`, asked once) or after their grid came back (`again`, asked once more).
   */
  readonly live = { relays: 0, samples: 0, mips: 0, coursePieces: 0, courseWaiting: 0, courseMerged: 0, paintTiles: 0, merged: 0, again: 0, regenWaiting: 0 };
  /** The textures whose mips a region upload leaves stale (the fine normals, the albedos), each with its 1-texel stand-in and whether its mips are stale. */
  private readonly mipped: THREE.DataTexture[] = [];
  private readonly mipStale: boolean[] = [];
  private readonly mipTexel: ({ src: THREE.DataTexture; at: THREE.Vector2 } | null)[] = [];
  private mipsStale = 0;
  private mipsAt = Number.NEGATIVE_INFINITY;
  /** The edit is over (a stroke's end, a course's pieces all laid, a paint's tiles all made): the mips made at the next step whatever the time. */
  private mipsOwed = false;
  /** The tiles a relay laid (`HeightOverlay.layRect`'s answer, kept). */
  private readonly laidTiles: SampleRect[] = [];
  /**
   * A course's change, cut into pieces by horizon tile and laid nearest the eye first within `liveMs` a frame; the stores
   * they read. One piece a tile at most (W4's review round): a held drag hands over its edges' old and new rectangles at
   * every preview tick, and a rectangle meeting a tile that already waits grows that tile's piece (`courseByTile`).
   */
  private readonly coursePieces: CoursePiece[] = [];
  private readonly courseByTile = new Map<number, CoursePiece>();
  private liveStores: OverlayStores | null = null;
  /** The paint's 512 m tiles to make again, in order; each one's state: 1 waiting, 2 its grid asked, 3 composed; named again while 3, made once more. */
  private readonly paintQueue: number[] = [];
  private readonly paintState = new Map<number, number>();
  private readonly paintAgain = new Set<number>();
  private paintRunning = false;
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
    this.means = tables.means;
    this.mainMs = performance.now() - tm;
    const td = performance.now();
    this.ground = ground;
    const d = await this.decode((w) => w.postMessage({ type: 'decode', id: 1, header: read.header, bin: bin.buffer, tables, centre: this.centre, shift: { x: this.shift.x, z: this.shift.z }, eye: { rx: this.centre.x - eye.x, rz: eye.z + this.centre.z }, S: windowTiles(HORIZON_TUNE.detailReach) }, [bin.buffer as ArrayBuffer]));
    this.decodeWallMs = performance.now() - td;
    if (!d || this.disposed) return false;
    return this.stand(read.header, d, session, renderer, stores);
  }

  /** Whether this field's ground names no family (`horizonDem.ts`' plain world): its albedo is the palette's and it has no composition window. */
  plain: PlainGround | null = null;
  private plainColours: PlainColours | null = null;
  /** A plain world's fine albedo while its arrival lays its edits (before the textures exist), else null. */
  private plainFirst: Uint8Array | null = null;

  /**
   * A world with no converted terrain's rings made in the decode worker behind the arrival's screen (the horizon pass's h6b,
   * `horizonDem.ts`), from there on the field a bake's: `ground` (the lent ground's tile arrays) composes its albedo; null, a
   * world that names no ground, takes its palette's and keeps its composition window empty. Answers whether the rings stand.
   */
  async loadMade(spec: MadeGroundSpec, ground: FieldGround | null, session: RingSession, renderer: THREE.WebGLRenderer | null, eye: { x: number; z: number }, stores: OverlayStores | null = null): Promise<boolean> {
    const tm = performance.now();
    const tables = ground ? tileTablesOf(ground) : null;
    this.means = tables ? tables.means : null;
    this.mainMs = performance.now() - tm;
    this.ground = ground;
    this.plain = tables ? null : spec.plain;
    this.plainColours = this.plain ? new PlainColours(this.plain) : null;
    // The rings stand on this world's raw frame about (0, 0): a world with a tiler has been bound so already, and a plain one
    // has no `bindTiles` to say so over the last world's layout centre.
    session.ground.uGroundFrame.value.x = 0;
    session.ground.uGroundFrame.value.y = 0;
    const td = performance.now();
    const d = await this.decode((w) => w.postMessage({ type: 'make', id: 1, spec, tables, centre: this.centre, shift: { x: this.shift.x, z: this.shift.z }, eye: { rx: this.centre.x - eye.x, rz: eye.z + this.centre.z }, S: windowTiles(HORIZON_TUNE.detailReach) }, spec.source ? [spec.source.raw] : []));
    this.decodeWallMs = performance.now() - td;
    if (!d || !d.header || this.disposed) return false;
    this.header = d.header;
    return this.stand(d.header, d, session, renderer, stores);
  }

  /** The decoded (or made) bake stood: the surface's lattices, the overlays laid, the textures made and bound. */
  private stand(h: HorizonHeader, d: DecodedBake, session: RingSession, renderer: THREE.WebGLRenderer | null, stores: OverlayStores | null): boolean {
    const tu = performance.now();
    this.decodeMs = d.ms;
    this.pyramid = d.pyramid;
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
    this.plainFirst = this.plain ? d.albedo : null;
    if (stores) this.layHeights(stores, d.fineNormal);
    this.plainFirst = null;
    // Wave h6a: the ranges' window side and the bake's own step, written once (the rules' kept record).
    this.rules.side = this.shapeSide || SHAPE_SIDE;
    this.rules.bakeStep = h.fine.step;
    // The shape window's block beside the coarse rows (wave 3b), empty until its blocks are made in play.
    const lay = atlasLayout(h.fine.nx, h.fine.nz, h.coarse.nx, h.coarse.nz, this.shapeSide);
    if (this.shapeSide) {
      this.shape = new ShapeWindow(this.shapeSide, this.shapeStep);
      this.shapeCol = lay.col;
      this.shapeRow = lay.row;
      this.shapeSrc = new THREE.DataTexture(new Float32Array(SHAPE_BLOCK * SHAPE_BLOCK) as never, SHAPE_BLOCK, SHAPE_BLOCK, THREE.RedFormat, THREE.FloatType);
      this.shapeSrc.unpackAlignment = 1;
    }
    const heights = (this.heights = dataTex(heightsAtlas(d.fine, h.fine.nx, h.fine.nz, d.coarse, h.coarse.nx, h.coarse.nz, this.shapeSide), lay.w, lay.h, THREE.RedFormat, THREE.FloatType, false));
    const fn = (this.fineN = dataTex(d.fineNormal, h.fine.nx, h.fine.nz, THREE.RGFormat, THREE.UnsignedByteType, true));
    const al = (this.albedo = dataTex(d.albedo, h.colour.nx, h.colour.nz, THREE.RGBAFormat, THREE.UnsignedByteType, true, true));
    const cal = (this.coarseAlbedo = dataTex(d.coarseAlbedo, h.coarse.nx, h.coarse.nz, THREE.RGBAFormat, THREE.UnsignedByteType, true, true));
    this.textures.push(heights, fn, al, cal);
    if (renderer) {
      for (const t of this.textures) renderer.initTexture(t);
      // Let go on the main thread once on the card (the critique's minor 6): the normals, the albedo and the windows are
      // the worker's to make again; the heights' own arrays stay (Light and shadow's march reads them, §2.8), the atlas
      // put on the card from them is let go too.
      for (const t of this.textures) letGo(t);
      // W4 (§2.13): no region upload makes mips after this first whole one (three's `copyTextureToTexture` makes the whole
      // chain whenever the destination asks for it); a flagged 1-texel copy makes them, at most every `mipsEvery`.
      for (const t of [fn, al, cal]) {
        t.generateMipmaps = false;
        this.mipped.push(t);
        this.mipStale.push(false);
        this.mipTexel.push(null);
      }
    }
    this.renderer = renderer;
    this.bind(session);
    this.takeWindow(d.place, d.window, d.tint);
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
    // The shape window's blocks taken again (wave 3b): the near ground's own are laid again under the late file.
    this.shape?.forget();
    this.mipsOwed = true;
    return this.layHeights(stores, null);
  }

  /**
   * W4 (DESIGN.md §6): the heights under a rectangle of the raw frame laid again as they are made (a sculpt stroke's stamp,
   * an undo, a heights file landed): the fine samples it holds (grown by `grow` metres, a course's widening) laid from raw with
   * the stores as they stand (`HeightOverlay.layRect`), their normals and a sample round them, the pyramid's leaves and the
   * card's texels made again (no mips: `stepMips`), and the shape window's blocks there laid again (`ShapeWindow.relayRect`).
   * `end` says the edit is over (its mips made at the next step). Answers the samples it wrote. A stamp's work.
   */
  relay(x0: number, z0: number, x1: number, z1: number, stores: OverlayStores, grow = 0, end = false): number {
    if (this.state.state !== 'ready' || this.disposed) return 0;
    const h = this.header;
    const fine = this.fineH;
    if (!h || !fine) return 0;
    this.overlay ??= new HeightOverlay(h.fine);
    const r = samplesIn(h.fine, { x0: Math.min(x0, x1) - grow, z0: Math.min(z0, z1) - grow, x1: Math.max(x0, x1) + grow, z1: Math.max(z0, z1) + grow });
    let n = 0;
    // A tile at a time (W4's review round): a union of two edits far apart (a landed file's, an undo's) is laid, normalled
    // and put on the card tile by tile, never as one box over the untouched tiles between them.
    if (r) {
      for (const t of this.overlay.layRect(fine, stores.heights, stores.course, r, this.laidTiles)) {
        this.heightsMoved(t, null);
        n += (t.i1 - t.i0 + 1) * (t.j1 - t.j0 + 1);
      }
    }
    this.shape?.relayRect(x0, z0, x1, z1);
    this.live.relays++;
    this.live.samples += n;
    if (end) this.mipsOwed = true;
    return n;
  }

  /**
   * W4: a course's change (its edges' dirty rectangles in the raw frame, `CourseCarve.rects`) cut into pieces of at most a
   * horizon tile each, grown by the far-grid widening (half the bake's step), and laid over the bake nearest the eye first
   * within `liveMs` a frame (`stepCourse`). The stores read as each piece is laid.
   */
  courseLater(rects: readonly RawRect[], n: number, stores: OverlayStores): number {
    if (this.state.state !== 'ready' || this.disposed || !this.header) return 0;
    this.liveStores = stores;
    const L = this.header.fine;
    const span = HORIZON_TILE * L.step;
    const grow = L.step / 2;
    const before = this.coursePieces.length;
    for (let k = 0; k < n; k++) {
      const r = rects[k];
      const lx = Math.min(r.x0, r.x1) - grow;
      const hx = Math.max(r.x0, r.x1) + grow;
      const lz = Math.min(r.z0, r.z1) - grow;
      const hz = Math.max(r.z0, r.z1) + grow;
      if (!(lx <= hx && lz <= hz)) continue;
      // Pieces by the horizon tiles of the lattice's own origin (a kilometre-long edge is several frames' work, never one).
      for (let tz = Math.floor((lz - L.z0) / span); tz <= Math.floor((hz - L.z0) / span); tz++) {
        for (let tx = Math.floor((lx - L.x0) / span); tx <= Math.floor((hx - L.x0) / span); tx++) {
          const px0 = Math.max(lx, L.x0 + tx * span);
          const px1 = Math.min(hx, L.x0 + (tx + 1) * span);
          const pz0 = Math.max(lz, L.z0 + tz * span);
          const pz1 = Math.min(hz, L.z0 + (tz + 1) * span);
          if (!(px0 <= px1 && pz0 <= pz1)) continue;
          // One piece a tile: a tile already waiting grows its piece (each is laid from raw with the stores as they stand
          // when it is laid, so the grown piece lays both rectangles as they now are).
          const key = (tz + 32768) * 65536 + (tx + 32768);
          const p = this.courseByTile.get(key);
          if (p) {
            p.x0 = Math.min(p.x0, px0);
            p.z0 = Math.min(p.z0, pz0);
            p.x1 = Math.max(p.x1, px1);
            p.z1 = Math.max(p.z1, pz1);
            this.live.courseMerged++;
          } else {
            const np: CoursePiece = { x0: px0, z0: pz0, x1: px1, z1: pz1, key };
            this.coursePieces.push(np);
            this.courseByTile.set(key, np);
          }
        }
      }
    }
    this.live.courseWaiting = this.coursePieces.length;
    return this.coursePieces.length - before;
  }

  /**
   * W4: a frame's share of a course's change, nearest the eye first, within `liveMs` (one piece at the least); once nothing
   * waits, its mips owed. Nothing read, nothing made, while none waits.
   */
  private stepCourse(): void {
    const q = this.coursePieces;
    if (q.length === 0) return;
    const stores = this.liveStores;
    if (!stores) {
      q.length = 0;
      this.courseByTile.clear();
      return;
    }
    const t0 = this.now();
    const ex = this.eyeRaw[0];
    const ez = this.eyeRaw[1];
    do {
      let best = 0;
      let bd = Number.POSITIVE_INFINITY;
      for (let k = 0; k < q.length; k++) {
        const r = q[k];
        const dx = (r.x0 + r.x1) * 0.5 - ex;
        const dz = (r.z0 + r.z1) * 0.5 - ez;
        const d = dx * dx + dz * dz;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      const r = q[best];
      q[best] = q[q.length - 1];
      q.length--;
      this.courseByTile.delete(r.key);
      this.relay(r.x0, r.z0, r.x1, r.z1, stores, 0, false);
      this.live.coursePieces++;
    } while (q.length > 0 && this.now() - t0 < HORIZON_TUNE.liveMs);
    this.live.courseWaiting = q.length;
    if (q.length === 0) this.mipsOwed = true;
  }

  /**
   * W4: one block of the near ground's cache laid again (the race drawer's budgeted relay of a course's change, a block at a
   * time): the shape window's block there taken again from it, which the field's own piece may have copied before it was laid.
   */
  shapeRelay(x0: number, z0: number, x1: number, z1: number): void {
    if (this.state.state === 'ready') this.shape?.relayRect(x0, z0, x1, z1);
  }

  /**
   * W4: the paint's 512 m tiles made again as they land (a stroke let go, an undo, a file landed): each asked of the live
   * generator once however many landings name it before its grid comes back (the terrain asks a grid older than the paint
   * over it again itself, `staleGrid`'s rule), and once more if one names it after (its grid may predate that paint); their
   * albedo and the composition window's tiles made again (`regenerate`'s own path, a tile at a time). Answers how many were
   * queued anew.
   */
  paintTiles(keys: Iterable<number>, gen: PoleGenerate, stores: OverlayStores | null): number {
    if (this.state.state !== 'ready' || this.disposed) return 0;
    let queued = 0;
    for (const k of keys) {
      const st = this.paintState.get(k);
      if (st === undefined) {
        this.paintState.set(k, 1);
        this.paintQueue.push(k);
        queued++;
      } else if (st === 3) {
        this.paintAgain.add(k);
        this.live.again++;
      } else this.live.merged++;
    }
    this.live.regenWaiting = this.paintState.size;
    if (queued && !this.paintRunning) void this.runPaint(gen, stores);
    return queued;
  }

  /** The paint's tiles made again one at a time, in the order they were named. */
  private async runPaint(gen: PoleGenerate, stores: OverlayStores | null): Promise<void> {
    this.paintRunning = true;
    try {
      while (this.paintQueue.length && !this.disposed) {
        const key = this.paintQueue.shift()!;
        this.paintState.set(key, 2);
        const t = paintTileOf(key);
        const ask: RegenAsk = { x0: t.tx * PAINT_TILE, z0: t.tz * PAINT_TILE, x1: (t.tx + 1) * PAINT_TILE, z1: (t.tz + 1) * PAINT_TILE, heights: false };
        await this.regenOne(ask, gen, stores, () => this.paintState.set(key, 3));
        this.paintState.delete(key);
        this.live.paintTiles++;
        if (this.paintAgain.delete(key)) {
          this.paintState.set(key, 1);
          this.paintQueue.push(key);
        }
        this.live.regenWaiting = this.paintState.size;
      }
    } finally {
      this.paintRunning = false;
      this.mipsOwed = true;
      this.live.regenWaiting = this.paintState.size;
    }
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
      if (this.fineN) this.upload(this.fineN, n, i0, j0, w, hh, THREE.RGFormat, THREE.UnsignedByteType);
      const hr = new Float32Array(w * hh);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) hr[(j - j0) * w + (i - i0)] = fine[j * L.nx + i];
      // The fine lattice's rows stand from the atlas's row nought, column nought: a rectangle lands at its own indices.
      if (this.heights) this.upload(this.heights, hr, i0, j0, w, hh, THREE.RedFormat, THREE.FloatType);
    }
    // A plain world's colours are its palette's by height and slope, so they move with the heights (the colour lattice is the
    // fine one on a world about (0, 0): `horizonDem.ts`).
    if (this.plainColours) {
      if (this.plainFirst) plainAlbedoRect(this.plainColours, fine, L, i0, j0, i1, j1, this.plainFirst);
      else if (this.albedo) {
        const w = i1 - i0 + 1;
        const hh = j1 - j0 + 1;
        this.upload(this.albedo, plainAlbedoRect(this.plainColours, fine, L, i0, j0, i1, j1, new Uint8Array(w * hh * 4), i0, j0, w), i0, j0, w, hh, THREE.RGBAFormat, THREE.UnsignedByteType, true);
      }
    }
    if (this.pyramid) {
      const c = this.centre;
      pyramidRelay(this.pyramid, h, fine, this.coarseH!, c, c.x - (L.x0 + r.i1 * L.step), L.z0 + r.j0 * L.step - c.z, c.x - (L.x0 + r.i0 * L.step), L.z0 + r.j1 * L.step - c.z);
    }
  }

  /**
   * A rectangle of texels put on the card in place (`copyTextureToTexture` from a stand-in of the rectangle, never bound),
   * making no mips (W4: `stepMips` makes them, at most every `mipsEvery`).
   */
  private upload(dst: THREE.DataTexture, data: ArrayBufferView, i0: number, j0: number, w: number, h: number, format: THREE.PixelFormat, type: THREE.TextureDataType, srgb = false): void {
    const r = this.renderer;
    if (!r || !w || !h || this.disposed) return;
    const src = new THREE.DataTexture(data as never, w, h, format, type);
    src.unpackAlignment = 1;
    if (srgb) src.colorSpace = THREE.SRGBColorSpace;
    r.copyTextureToTexture(src, dst, null, new THREE.Vector2(i0, j0));
    src.dispose();
    this.overlays.uploads++;
    // W4: its mips stale until the next flagged copy, which writes this rectangle's first texel back where it now stands.
    const k = this.mipped.indexOf(dst);
    if (k < 0) return;
    const per = (data as unknown as { length: number }).length / (w * h);
    let tx = this.mipTexel[k];
    if (!tx) {
      const one = dst.type === THREE.FloatType ? new Float32Array(per) : new Uint8Array(per);
      const t1 = new THREE.DataTexture(one as never, 1, 1, format, type);
      t1.unpackAlignment = 1;
      if (srgb) t1.colorSpace = THREE.SRGBColorSpace;
      tx = this.mipTexel[k] = { src: t1, at: new THREE.Vector2() };
    }
    const d1 = tx.src.image.data as unknown as { [i: number]: number };
    const d0 = data as unknown as { [i: number]: number };
    for (let c = 0; c < per; c++) d1[c] = d0[c];
    tx.at.set(i0, j0);
    if (!this.mipStale[k]) {
      this.mipStale[k] = true;
      this.mipsStale++;
    }
  }

  /**
   * W4: the stale mips made, at most every `mipsEvery` while an edit is held and at the next step once it is over: one
   * flagged 1-texel copy a texture (its last uploaded rectangle's first texel written back where it stands, the destination
   * asking for mips for that call alone). Nothing read, nothing made, while none is stale.
   */
  private stepMips(): void {
    if (this.mipsStale === 0) return;
    const t = this.now();
    if (!this.mipsOwed && t - this.mipsAt < HORIZON_TUNE.mipsEvery) return;
    this.mipsAt = t;
    this.mipsOwed = false;
    const r = this.renderer;
    for (let k = 0; k < this.mipped.length; k++) {
      if (!this.mipStale[k]) continue;
      this.mipStale[k] = false;
      const tx = this.mipTexel[k];
      if (!r || !tx || this.disposed) continue;
      const dst = this.mipped[k];
      dst.generateMipmaps = true;
      r.copyTextureToTexture(tx.src, dst, null, tx.at);
      dst.generateMipmaps = false;
      this.live.mips++;
    }
    this.mipsStale = 0;
  }

  /** W4: the edit is over: the stale mips made at the next step whatever the time (a stroke's end, a late file, a paint's tiles all made). */
  editEnd(): void {
    this.mipsOwed = true;
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
      await this.regenOne(a, gen, stores);
      if (this.disposed) return;
    }
    // W4: the albedos' mips made at the next step (their rectangles went up with none).
    this.mipsOwed = true;
  }

  /**
   * One rectangle made again from the live generator (`regenerate`'s step, and the paint's live tiles, W4): its grid asked,
   * `generated` told once it is back (the paint's queue names a tile named again after that), its overrides composed in the
   * decode worker and put on the card.
   */
  private async regenOne(a: RegenAsk, gen: PoleGenerate, stores: OverlayStores | null, generated?: () => void): Promise<void> {
    const h = this.header;
    if (!h || this.state.state !== 'ready') return;
    {
      const p = regenPlan(h.colour, a);
      if (!p) return;
      this.overlays.regenAsked++;
      const g = await gen(p.startX, p.startZ, p.n, REGEN_STEP);
      if (this.disposed) return;
      generated?.();
      if (!g) {
        this.overlays.regenFailed++;
        return;
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
      // The composition window's tiles the overlay's poles reach and the tint cells it made again, for the next strip (the
      // review round: never the whole window again, which is a resize's or a retune's). Queued whether or not its albedo
      // came back, since the worker keeps the overlay's poles and cells from the moment it reads them.
      this.regenTiles.push(poleTiles(ov.poles));
      this.regenCells.push({ x0: ov.cells.i0, z0: ov.cells.j0, w: ov.cells.w, h: ov.cells.h });
      this.windowFails = 0;
      if (!answer) {
        this.overlays.regenFailed++;
        return;
      }
      if (this.albedo) this.upload(this.albedo, answer.fine.rgba, answer.fine.i0, answer.fine.j0, answer.fine.w, answer.fine.h, THREE.RGBAFormat, THREE.UnsignedByteType, true);
      if (this.coarseAlbedo) this.upload(this.coarseAlbedo, answer.coarse.rgba, answer.coarse.i0, answer.coarse.j0, answer.coarse.w, answer.coarse.h, THREE.RGBAFormat, THREE.UnsignedByteType, true);
      this.overlays.regenDone++;
      this.overlays.cellsMade += answer.fine.w * answer.fine.h;
    }
  }

  /** One overlay handed to the worker and its albedo awaited (null with no worker, or one that failed or went). */
  private overlayAsk(poles: unknown, cells: unknown, i0: number, j0: number, i1: number, j1: number): Promise<{ fine: RgbaRegion; coarse: RgbaRegion } | null> {
    const w = this.worker;
    if (!w) return Promise.resolve(null);
    const id = this.nextOverlay;
    this.nextOverlay += 2;
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
   * W5 (§1b Q10): the eye's height over the bake's ground under it (`heightRaw`'s arithmetic written out, nought where the
   * bake has none) and the distance from the eye to the bake's farthest coarse corner, written into the rules' record
   * (`eyeOver`, `bakeMost`), a frame's: nothing handed back, nothing made. Reads `eyeRaw`, which the frame wrote first.
   */
  private eyeGround(eye: THREE.Vector3): void {
    const r = this.rules;
    const h = this.header;
    const f = this.fineH;
    const c = this.coarseH;
    r.eyeOver = 0;
    r.bakeMost = 0;
    if (!h || !f || !c) return;
    const rx = this.eyeRaw[0];
    const rz = this.eyeRaw[1];
    const L = h.fine;
    const C = h.coarse;
    const fx = (rx - L.x0) / L.step;
    const fz = (rz - L.z0) / L.step;
    const cx = (rx - C.x0) / C.step;
    const cz = (rz - C.z0) / C.step;
    // The lattice's bilinear written out (`lerpIn`'s, a number handed back from a call is a number made): the fine
    // inside its extent, the coarse past it, nothing past both.
    let a: Float32Array | null = null;
    let n = 0;
    let m = 0;
    let ax = 0.5;
    let az = 0.5;
    if (fx >= 0 && fz >= 0 && fx <= L.nx - 1 && fz <= L.nz - 1) {
      a = f;
      n = L.nx;
      m = L.nz;
      ax = fx;
      az = fz;
    } else if (cx >= 0 && cz >= 0 && cx <= C.nx - 1 && cz <= C.nz - 1) {
      a = c;
      n = C.nx;
      m = C.nz;
      ax = cx;
      az = cz;
    }
    if (a !== null) {
      const i = Math.min(Math.floor(ax), n - 2);
      const k = Math.min(Math.floor(az), m - 2);
      const u = ax - i;
      const v = az - k;
      const o = k * n + i;
      const g = (a[o] * (1 - u) + a[o + 1] * u) * (1 - v) + (a[o + n] * (1 - u) + a[o + n + 1] * u) * v;
      if (eye.y > g) r.eyeOver = eye.y - g;
    }
    const x1 = C.x0 + (C.nx - 1) * C.step;
    const z1 = C.z0 + (C.nz - 1) * C.step;
    const dx = Math.max(Math.abs(rx - C.x0), Math.abs(rx - x1));
    const dz = Math.max(Math.abs(rz - C.z0), Math.abs(rz - z1));
    r.bakeMost = Math.sqrt(dx * dx + dz * dz);
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
    // Wave 3b (its review): the cards stand on what the ring draws there. Where the vertex stage reads the shape window
    // (`uHorizonShape.w`), every vertex height is the window's mixed into the bake's by its share, and the lattice is the
    // level `ringLevelOf` gives at the eye's distance (the last frame's eye, the bake's height for the rise, as the vertex
    // stage asks it): the 2 m triangles under the 2 m range, the 4 m ones under the 4 m range, level 0's past them.
    const sh = this.shape;
    const r = this.rules;
    s.shape = sh !== null && sh.placed && r.finest < 0 ? sh : null;
    s.shapeFade = Math.max(1, t.shapeFade);
    let q = LEAF / PATCH;
    if (s.shape !== null && s.fine && s.coarse) {
      const a = this.ask;
      const dx = gx - a.ex;
      const dy = bakeHeightAt(s.fine, s.coarse, this.centre.x - gx, gz + this.centre.z) - a.ey;
      const dz = gz - a.ez;
      const w = ringLevelOf(Math.sqrt(dx * dx + dy * dy + dz * dz), r.lod0, t.morph, r.r2, r.r1, r.finest, r.mf);
      if (w < 0) q = (LEAF / PATCH) * Math.pow(2, Math.floor(w));
    }
    return ringSurfaceAt(s, gx, gz, q);
  }

  /** What the far cards' surface last read of the shape (`shapeMoved`): the finest level, its ranges, the fade, and whether the window was whole. */
  private cardFinest = 0;
  private cardR1 = 0.5;
  private cardR2 = 0.5;
  private cardFade = 0.5;
  private cardWhole = 0;

  /**
   * Whether the far cards standing on the rings must be stood again for the shape (wave 3b's review, beside `ringHoleMoved`):
   * the finer levels' ranges or the window's fade moved (the Terrain shape detail, its finest, the switch), or the window
   * came whole (an arrival's or a teleport's fill, a move's new blocks, a late heights file), so a card stood on the bake
   * before its blocks were made stands on them. Numbers compared, nothing made; a frame's.
   */
  shapeMoved(): boolean {
    const r = this.rules;
    const sh = this.shape;
    const whole = sh !== null && sh.placed && sh.made === sh.blocks * sh.blocks ? 1 : 0;
    const fade = HORIZON_TUNE.shapeFade;
    const moved = r.finest !== this.cardFinest || r.r1 !== this.cardR1 || r.r2 !== this.cardR2 || fade !== this.cardFade || (whole === 1 && this.cardWhole === 0);
    this.cardFinest = r.finest;
    this.cardR1 = r.r1;
    this.cardR2 = r.r2;
    this.cardFade = fade;
    this.cardWhole = whole;
    return moved;
  }

  /**
   * The bake decoded in a worker of its own, answered once: with the decoded bake, or null with the state saying why
   * (the worker could not be made, failed to load, died, sent what does not read, said the bake did not decode, or said
   * nothing within `decodeWaitMs`), so the far tiles are drawn and nothing waits for good. Once decoded the worker stays
   * for the detail window, and what goes wrong with it after is a note: the rings stand as they stood.
   */
  private decode(post: (w: Worker) => void): Promise<DecodedBake | null> {
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
          // The worker gone after the decode: the rings stand, the composition window is no longer made again.
          this.note = `the decode worker failed (${e.message || 'no word'}): the composition window stays as it is`;
          if (this.worker === w) this.worker = null;
          this.answerOverlays();
          return;
        }
        fail(`the decode worker failed (${e.message || 'it did not load'})`);
      };
      w.onmessageerror = () => fail('the decode worker sent what does not read');
      w.onmessage = (e: MessageEvent) => {
        const m = e.data as WorkerAnswer;
        if (m.type === 'decoded' && !answered) {
          answered = true;
          if (timer !== null) clearTimeout(timer);
          resolve(m.d!);
        } else if ((m.type === 'window' || m.type === 'strip' || m.type === 'retune') && m.id === this.windowAsked) {
          this.windowAsked = 0;
          if (!this.disposed) this.windowLanded(m);
        } else if (m.type === 'overlay' && m.id !== undefined) {
          const r = this.overlayWait.get(m.id);
          this.overlayWait.delete(m.id);
          r?.(m as unknown as { fine: RgbaRegion; coarse: RgbaRegion });
        } else if (m.type === 'poles' && m.id !== undefined) {
          const r = this.polesWait.get(m.id);
          this.polesWait.delete(m.id);
          r?.(m.heights ? { heights: m.heights } : null);
        } else if (m.type === 'error') {
          // An overlay that did not compose keeps the albedo that stands (a note); so does a detail window, which is asked again.
          if (m.id !== undefined && m.id !== 0 && m.id === this.windowAsked) this.windowFailed(m.message ?? 'no word');
          else if (m.id !== undefined && this.polesWait.has(m.id)) {
            const r = this.polesWait.get(m.id);
            this.polesWait.delete(m.id);
            r?.(null);
          } else if (m.id !== undefined && this.overlayWait.has(m.id)) {
            const r = this.overlayWait.get(m.id);
            this.overlayWait.delete(m.id);
            r?.(null);
            this.note = `an overlay's albedo was not made again (${m.message})`;
          } else if (answered) {
            this.note = `the composition window was not made again (${m.message})`;
          } else fail(`the bake did not decode (${m.message})`);
        }
      };
      post(w);
    });
  }

  /** Whether the decode worker stands to answer (a made world's shape window, `horizonDem.ts`' `madeShapeTerrain`). */
  get workerUp(): boolean {
    return this.worker !== null;
  }

  /** The near ground's heights over a raw-frame grid, made by the decode worker from the raster it holds (h6b): null with no worker. */
  madePoles(startX: number, startZ: number, n: number, step: number): Promise<{ heights: Float32Array } | null> {
    const w = this.worker;
    if (!w) return Promise.resolve(null);
    const id = this.nextOverlay;
    this.nextOverlay += 2;
    return new Promise((resolve) => {
      this.polesWait.set(id, resolve);
      w.postMessage({ type: 'poles', id, startX, startZ, n, step });
    });
  }

  /** The world's textures into the session's uniforms (a sampler's value: no program changes). */
  bind(s: RingSession): void {
    const h = this.header;
    if (!h || !this.heights || !this.fineN || !this.albedo || !this.coarseAlbedo) return;
    this.session = s;
    const u = s.uniforms;
    u.uHorizonHeights.value = this.heights;
    u.uHorizonFineN.value = this.fineN;
    u.uHorizonAlbedo.value = this.albedo;
    u.uHorizonCoarseAlbedo.value = this.coarseAlbedo;
    this.bindWindow();
    u.uHorizonFine.value.set(h.fine.x0, h.fine.z0, h.fine.step, ringMipOffset(h.fine.step));
    u.uHorizonCoarse.value.set(h.coarse.x0, h.coarse.z0, h.coarse.step, ringMipOffset(h.coarse.step));
    u.uHorizonColour.value.set(h.colour.x0, h.colour.z0, h.colour.step, 0);
    u.uHorizonSizes.value.set(h.fine.nx, h.fine.nz, h.coarse.nx, h.coarse.nz);
    u.uHorizonColourN.value.set(h.colour.nx, h.colour.nz, 0, 0);
    u.uHorizonGrid.value.set(this.shift.x, this.shift.z, 0, 0);
  }

  // ---------------------------------------------------------------- the third wave: the composition window

  /** The window's textures and where they stand into the session's uniforms (a sampler's value and two vectors: no program changes). */
  private bindWindow(): void {
    const s = this.session;
    if (!s || !this.winTex || !this.tintTex) return;
    const u = s.uniforms;
    const p = this.place;
    u.uHorizonWindow.value = this.winTex;
    u.uHorizonTint.value = this.tintTex;
    u.uHorizonWin.value.set(p.ox, p.oz, p.S, p.T);
    u.uHorizonWinC.value.set(p.ci0, p.cj0, 0, 0);
  }

  /**
   * A whole window put on the card where it stands (the decode's, a resize's, a remake's, a retune's): into the textures it
   * has where their sizes hold, else into new ones (the old disposed once the new are bound), then bound.
   */
  private takeWindow(p: WindowPlace, window: Uint16Array, tint: Uint8Array): void {
    const t0 = performance.now();
    const old = [this.winTex, this.tintTex];
    if (this.winTex && this.tintTex && this.place.S === p.S && this.place.T === p.T) {
      this.winTex.image = { data: window, width: p.S, height: p.S } as never;
      this.winTex.needsUpdate = true;
      this.tintTex.image = { data: tint, width: p.T, height: p.T } as never;
      this.tintTex.needsUpdate = true;
      old.length = 0;
    } else {
      this.winTex = windowTex(window, p.S);
      this.tintTex = tintTex(tint, p.T);
    }
    Object.assign(this.place, p);
    const r = this.renderer;
    if (r) {
      r.initTexture(this.winTex!);
      r.initTexture(this.tintTex!);
      letGo(this.winTex!);
      letGo(this.tintTex!);
    }
    this.bindWindow();
    for (const t of old) t?.dispose();
    this.windowWork.wholes++;
    // The main thread's share of putting a whole window on the card (the console's; a whole window is a resize's or a retune's).
    this.windowWork.takeMs = Math.round((performance.now() - t0) * 10) / 10;
  }

  /** A rectangle's data put on the card where it wraps round a toroidal texture (`wrapPieces`), its source read by region. */
  private uploadPieces(dst: THREE.DataTexture, r: IndexRect, data: ArrayBufferView, size: number, format: THREE.PixelFormat, type: THREE.TextureDataType): void {
    const ren = this.renderer;
    if (!ren || !r.w || !r.h) return;
    const src = new THREE.DataTexture(data as never, r.w, r.h, format, type);
    src.unpackAlignment = 1;
    const box = new THREE.Box2();
    const at = new THREE.Vector2();
    for (const p of wrapPieces(r, size)) {
      box.min.set(p.sx, p.sz);
      box.max.set(p.sx + p.w, p.sz + p.h);
      at.set(p.dx, p.dz);
      ren.copyTextureToTexture(src, dst, box, at);
      this.windowWork.texels += p.w * p.h;
    }
    src.dispose();
  }

  /** What the worker answered a window ask with: a strip's rectangles put on the card, or a whole window, then where it now stands. */
  private windowLanded(m: WorkerAnswer): void {
    // What went with this ask is made: struck off what waits, and the failures counted afresh.
    if (this.regenSent) {
      this.regenTiles.splice(0, this.regenSent);
      this.regenCells.splice(0, this.regenSent);
      this.regenSent = 0;
    }
    this.windowFails = 0;
    if (m.type === 'strip' && m.place && m.tileRects && m.cellRects && m.tiles && m.cells && this.winTex && this.tintTex && m.place.S === this.place.S) {
      const t0 = performance.now();
      m.tileRects.forEach((r, i) => this.uploadPieces(this.winTex!, r, m.tiles![i], m.place!.S, THREE.RGBAIntegerFormat, THREE.UnsignedShortType));
      m.cellRects.forEach((r, i) => this.uploadPieces(this.tintTex!, r, m.cells![i], m.place!.T, THREE.RGBAFormat, THREE.UnsignedByteType));
      Object.assign(this.place, m.place);
      this.bindWindow();
      this.windowWork.strips++;
      this.windowWork.stripMs = Math.round((performance.now() - t0) * 100) / 100;
      return;
    }
    if (m.type === 'retune' && m.albedo && m.coarseAlbedo && this.albedo && this.coarseAlbedo) {
      // The albedos composed again whole under the ground's knobs as they stand: put on the card whole, mips made again.
      for (const [t, data] of [[this.albedo, m.albedo], [this.coarseAlbedo, m.coarseAlbedo]] as const) {
        t.image = { data, width: t.image.width, height: t.image.height } as never;
        t.needsUpdate = true;
        if (this.renderer) {
          // A whole upload makes the chain (W4: the textures keep `generateMipmaps` false between, for the region uploads).
          t.generateMipmaps = true;
          this.renderer.initTexture(t);
          t.generateMipmaps = false;
          letGo(t);
          // Its chain is whole and fresh: a flagged copy still owed would write a texel kept from before over it (W4's
          // review round), so it owes none.
          const k = this.mipped.indexOf(t);
          if (k >= 0 && this.mipStale[k]) {
            this.mipStale[k] = false;
            this.mipsStale--;
          }
        }
      }
      this.windowWork.retunes++;
    }
    if ((m.type === 'window' || m.type === 'retune') && m.place && m.window && m.tint) this.takeWindow(m.place, m.window, m.tint);
  }

  /**
   * The window asked of the worker, round the eye at the side the ground detail distance in force asks: a retune (the
   * ground's knobs moved), a whole window (its side moved, or one that failed), or a strip of what the eye's move brought
   * into it and what a regenerate made again where the window holds it. One ask at a time; a frame that asks nothing
   * makes nothing.
   */
  private askWindow(): void {
    const w = this.worker;
    const h = this.header;
    // A plain world's window holds nothing and stays so (no tables to make one from, no paint to lay).
    if (!w || !h || this.windowAsked || !this.place.S || this.plainColours !== null) return;
    // The side the distance in force asks, worked out again only when the distance moved.
    const reach = HORIZON_TUNE.detailReach;
    if (reach !== this.reachSeen) {
      this.reachSeen = reach;
      this.wantS = windowTiles(reach);
      // A new side is a new cause: an ask given up is asked again.
      this.windowFails = 0;
    }
    if (this.windowFails > WINDOW_RETRIES) return;
    const S = this.wantS;
    const er = this.eyeRaw;
    // Where the window would stand round the eye (windowPlace's own tiles, written out: a frame that asks nothing makes nothing).
    const ox = Math.floor(er[0] / DETAIL_TILE) - S / 2;
    const oz = Math.floor(er[1] / DETAIL_TILE) - S / 2;
    if (!this.retuneWanted && !this.windowStale && !this.regenTiles.length && S === this.place.S && Math.abs(ox - this.place.ox) <= STRIP_TILES && Math.abs(oz - this.place.oz) <= STRIP_TILES) return;
    const p = windowPlace(er[0], er[1], S, h.colour, this.nextPlace);
    if (this.retuneWanted && this.ground) {
      this.retuneWanted = false;
      this.windowStale = false;
      this.regenSent = this.regenTiles.length;
      this.windowKind = ASK_RETUNE;
      this.windowAsked = this.nextWindow;
      this.nextWindow += 2;
      // The load's means (the review round: no knob moves the arrays' pixels, so only the tiler's tables and the knobs are made again).
      w.postMessage({ type: 'retune', id: this.windowAsked, tables: tileTablesOf(this.ground, this.means ?? undefined), place: { ...p } });
      return;
    }
    if (S !== this.place.S || this.windowStale) {
      this.windowStale = false;
      this.regenSent = this.regenTiles.length;
      this.windowKind = ASK_WHOLE;
      this.windowAsked = this.nextWindow;
      this.nextWindow += 2;
      w.postMessage({ type: 'window', id: this.windowAsked, place: { ...p } });
      return;
    }
    const tiles = freshRects(this.place.ox, this.place.oz, p.ox, p.oz, S);
    const cells = freshRects(this.place.ci0, this.place.cj0, p.ci0, p.cj0, p.T);
    // What a regenerate made again, where the window will hold it (the strip path: never the whole window again).
    this.regenSent = this.regenTiles.length;
    for (let i = 0; i < this.regenSent; i++) {
      clipRect(this.regenTiles[i], p.ox, p.oz, S, tiles);
      clipRect(this.regenCells[i], p.ci0, p.cj0, p.T, cells);
    }
    if (!tiles.length && !cells.length) {
      // Nothing of it in the window and the eye not moved: struck off with nothing asked.
      this.regenTiles.length = this.regenCells.length = this.regenSent = 0;
      return;
    }
    this.windowKind = ASK_STRIP;
    this.windowAsked = this.nextWindow;
    this.nextWindow += 2;
    w.postMessage({ type: 'strip', id: this.windowAsked, place: { ...p }, tiles, cells });
  }

  /**
   * A window ask the worker could not make (its error naming the ask in flight): the window on the card stands (a note),
   * and the ask is made again at the next chance -- a retune wanted again, a whole window marked stale, a strip's
   * regenerated rectangles left waiting (its move asks itself again, the eye still past `STRIP_TILES`) -- up to
   * `WINDOW_RETRIES` times in a row, then given up until a new cause (a retune, a regenerate, a new side).
   */
  private windowFailed(message: string): void {
    this.windowAsked = 0;
    this.regenSent = 0;
    this.windowFails++;
    const again = this.windowFails <= WINDOW_RETRIES;
    if (again && this.windowKind === ASK_RETUNE) this.retuneWanted = true;
    else if (again && this.windowKind === ASK_WHOLE) this.windowStale = true;
    this.windowKind = 0;
    this.note = again ? `the composition window was not made again (${message}): asked again (${this.windowFails} of ${WINDOW_RETRIES})` : `the composition window was not made again (${message}): given up after ${WINDOW_RETRIES} tries`;
  }

  /** The ground's knobs moved (the tint, the masks' switches, the alternates, the order, the corner): the albedo and the window composed again. */
  retune(): void {
    if (this.state.state !== 'ready') return;
    this.retuneWanted = true;
    this.windowFails = 0;
  }

  /**
   * The console's self test (`horizon({ selfTest: true })`): each layer's mean the albedo is composed from (worked out on
   * the CPU from the arrays' own pixels) against the arrays' own top mip as the card makes it, drawn into a float target a
   * texel a layer, as sRGB bytes; and the ring program's active samplers as the driver counts them, against its units.
   * Builds one small program of its own (a self test's, never the game's).
   */
  selfTest(renderer: THREE.WebGLRenderer, ground: GroundTileUniforms, material: THREE.Material): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const g = this.ground;
    const arr = ground.uGround.value as THREE.DataArrayTexture;
    const img = arr.image as { width: number; depth: number };
    if (g && img?.width && img.depth) {
      const means = layerMeans(g.colour, g.size, g.depth, MEANS_STRIDE);
      const depth = img.depth;
      const top = Math.floor(Math.log2(img.width));
      const target = new THREE.WebGLRenderTarget(depth, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
      const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { uArr: { value: arr }, uTop: { value: top } },
        vertexShader: 'void main() { gl_Position = vec4( position.xy * 2.0, 0.0, 1.0 ); }',
        fragmentShader: 'precision highp sampler2DArray;\nuniform sampler2DArray uArr;\nuniform float uTop;\nout vec4 fc;\nvoid main() { fc = vec4( textureLod( uArr, vec3( 0.5, 0.5, floor( gl_FragCoord.x ) ), uTop ).rgb, 1.0 ); }',
        depthTest: false,
        depthWrite: false,
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      const scene = new THREE.Scene();
      scene.add(quad);
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const was = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, cam);
      const px = new Float32Array(depth * 4);
      renderer.readRenderTargetPixels(target, 0, 0, depth, 1, px);
      renderer.setRenderTarget(was);
      // The means the albedo is composed from (every other texel each way, `tileTablesOf`'s) and every texel's, each held to
      // the card's own top mip (`meansVerdict`: the card rounds each level of its sRGB chain to a byte, three levels off the
      // exact mean on one of Tatooine's layers, both backends), and to each other within a level.
      const v = meansVerdict(px, means, layerMeans(g.colour, g.size, g.depth, 1), depth);
      out.means = { layers: depth, topMip: top, worstLevels: v.worstLevels, worstLayer: v.worstLayer, within: v.within, everyTexelWorst: v.exactWorst, strideWorst: v.strideWorst, overTwo: v.overTwo };
      target.dispose();
      mat.dispose();
      quad.geometry.dispose();
    } else out.means = { skipped: 'no tile arrays held' };
    // The ring program's active samplers as the driver counts them (three hands each one unit).
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const prog = (renderer.properties.get(material) as { currentProgram?: { program: WebGLProgram } }).currentProgram?.program;
    if (prog) {
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
      const samplers: string[] = [];
      let units = 0;
      const kinds = new Set<number>([gl.SAMPLER_2D, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_3D, gl.SAMPLER_CUBE, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_2D_ARRAY_SHADOW, gl.SAMPLER_CUBE_SHADOW, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D, gl.INT_SAMPLER_2D_ARRAY, gl.UNSIGNED_INT_SAMPLER_2D_ARRAY, gl.INT_SAMPLER_3D, gl.UNSIGNED_INT_SAMPLER_3D]);
      for (let i = 0; i < n; i++) {
        const a = gl.getActiveUniform(prog, i);
        if (!a || !kinds.has(a.type)) continue;
        samplers.push(a.size > 1 ? `${a.name}x${a.size}` : a.name);
        units += a.size;
      }
      out.samplers = { units, most: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number, names: samplers };
    } else out.samplers = { skipped: 'the ring program is not built yet (switch the rings on and look at the far ground once)' };
    return out;
  }

  /**
   * A frame: the reach in force from the fog (the caller writes the fog's density into `rules.fogDensity` first: a
   * fraction handed across this call is a number made), the hole's square, the eye, the selection over the camera's
   * frustum, and the uniforms the program reads, each vector's fields written as they stand. Allocates nothing, builds
   * no string, and reads the clock only while the console times the selection (`timing`).
   */
  update(s: RingSession, camera: THREE.PerspectiveCamera, eye: THREE.Vector3, viewRadius: number, pcx: number, pcz: number, hole: HoleGrid, reversed: boolean): void {
    const t = HORIZON_TUNE;
    // The eye's raw place into a kept array (a number handed across a call the compiler leaves out is a number made).
    this.eyeRaw[0] = this.centre.x - eye.x;
    this.eyeRaw[1] = eye.z + this.centre.z;
    // W5 (§1b Q10): the eye's height over the bake's ground and the bake's reach from it, into the rules' kept record (the
    // eye handed whole: its height handed across the call would be a number made).
    this.eyeGround(eye);
    const r = reachRules(t, viewRadius, reversed, this.rules, this.shape !== null);
    const a = this.ask;
    a.finest = r.finest;
    a.r1 = r.r1;
    a.r2 = r.r2;
    a.pad = r.finest < 0 ? t.shapePad : 0;
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
    ul.z = t.detailReach * Math.min(1, Math.max(0, t.detailFadeShare));
    ul.w = t.detail === 'tile' ? 1 : 0;
    const uf = u.uHorizonFade.value;
    uf.x = t.fade;
    uf.y = t.fadeOn ? 1 : 0;
    uf.z = t.fadeTo === 'sky' ? 0 : t.fadeTo === 'fog' ? 1 : 2;
    uf.w = Math.max(0, HORIZON_VIEWS.indexOf(t.view));
    // The rings' shape up close (wave 3b): the finer levels' ranges, and the shape window read where it stands.
    const sh = this.shape;
    const ush = u.uHorizonShape.value;
    ush.x = r.r2 > 0 ? r.r2 : 1;
    ush.y = r.r1 > 0 ? r.r1 : 1;
    ush.z = r.finest;
    ush.w = sh !== null && r.finest < 0 && sh.placed ? 1 : 0;
    // The morph share the ranges were placed with (`shapeRanges` holds it to [0.01, 0.9]), never the tune's raw number.
    u.uHorizonShapeAt.value.w = r.mf;
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
    // The shape window kept round the eye (wave 3b) while the finer levels are drawn: its blocks made nearest first, put on
    // the card as they come, the uniforms its place in the same frame as a move empties what moved.
    if (sh !== null && r.finest < 0) this.stepShape(sh, u);
    // The composition window kept round the eye: its strips once the eye is `STRIP_TILES` tiles off its middle or an overlay
    // made poles again, whole when the distance's side moved, a retune when the ground's knobs moved (nothing asked, nothing made).
    if (this.worker && !this.windowAsked) this.askWindow();
    this.stepLive();
  }

  /**
   * W4: a frame's share of the edits followed live: a course's change laid a frame's share at a time, and the mips its
   * uploads left stale made at most every `mipsEvery` (nothing read, nothing made, while nothing waits). The frame's own call.
   */
  stepLive(): void {
    this.stepCourse();
    this.stepMips();
  }

  /** The shape window a frame: stood round the eye, its due blocks put on the card (all at once after a far move), its uniforms written. */
  private stepShape(sh: ShapeWindow, u: RingUniforms): void {
    sh.eye[0] = this.eyeRaw[0];
    sh.eye[1] = this.eyeRaw[1];
    sh.stepEye();
    const uw = u.uHorizonShapeWin.value;
    uw.x = sh.gi0;
    uw.y = sh.gj0;
    uw.z = this.shapeCol;
    uw.w = this.shapeRow;
    const ua = u.uHorizonShapeAt.value;
    ua.x = sh.step;
    ua.y = sh.side;
    // The edge fade the program divides by: never under one sample (nought would read 0/0 on the window's edge row).
    ua.z = Math.max(1, HORIZON_TUNE.shapeFade);
    const r = this.renderer;
    const dst = this.heights;
    if (!r || !dst || this.disposed) {
      sh.whole = false;
      sh.moved = false;
      sh.dropDirty();
      return;
    }
    if (sh.whole || sh.dirty > shapeWholePast(sh.blocks)) {
      // The whole block at once (a far move, the arrival's first fill): the window's array is laid out as the card's block is.
      sh.whole = false;
      sh.moved = false;
      sh.dropDirty();
      // The whole window's stand-in over the window's own array, made once a window (wave 3b's review: one made a whole
      // upload was a texture made in a frame, at every far move).
      let whole = this.shapeWhole;
      if (whole === null || (whole.image.data as unknown) !== sh.heights) {
        whole?.dispose();
        whole = this.shapeWhole = new THREE.DataTexture(sh.heights as never, sh.side, sh.side, THREE.RedFormat, THREE.FloatType);
        whole.unpackAlignment = 1;
      }
      this.shapeAt.set(this.shapeCol, this.shapeRow);
      r.copyTextureToTexture(whole, dst, null, this.shapeAt);
      this.shapeWork.wholes++;
      return;
    }
    const src = this.shapeSrc!;
    const data = src.image.data as unknown as Float32Array;
    const B = sh.blocks;
    const n = sh.side;
    // A move's emptied slots all in its own frame (the uniform says where the window stands now); made blocks a few a frame.
    const most = sh.moved ? B * B : SHAPE_UPLOADS_PER_FRAME;
    sh.moved = false;
    for (let k = 0; k < most; k++) {
      const slot = sh.takeDirty();
      if (slot < 0) break;
      const c0 = (slot % B) * SHAPE_BLOCK;
      const r0 = Math.floor(slot / B) * SHAPE_BLOCK;
      for (let j = 0; j < SHAPE_BLOCK; j++) for (let i = 0; i < SHAPE_BLOCK; i++) data[j * SHAPE_BLOCK + i] = sh.heights[(r0 + j) * n + c0 + i];
      this.shapeAt.set(this.shapeCol + c0, this.shapeRow + r0);
      r.copyTextureToTexture(src, dst, null, this.shapeAt);
      this.shapeWork.blocks++;
    }
  }

  /** The shape window's source (the world's near ground), once the bake is in; nothing made without one. */
  useShape(source: ShapeSource | null): void {
    if (this.shape) this.shape.source = source;
  }

  /**
   * Wave h6a: the shape window made again at another side (the Graphics page's Terrain shape window moved in play, behind
   * the far ground's short curtain): the heights atlas laid again from the laid fine and coarse heights the field keeps with
   * the new window's empty block beside the coarse rows, put on the card whole (a texture's size, never a program), the
   * session's sampler handed it, the old let go; the new window empty, its source the old one's, filled in play as at an
   * arrival. Answers whether anything was made (nothing for the side in force, a field not ready, or no window before).
   */
  resizeShape(side: number): boolean {
    const h = this.header;
    const fine = this.fineH;
    const coarse = this.coarseH;
    if (this.state.state !== 'ready' || this.disposed || !h || !fine || !coarse || !this.shapeSide || side === this.shapeSide || !(side > 0)) return false;
    const source = this.shape?.source ?? null;
    this.shape?.dispose();
    this.shapeWhole?.dispose();
    this.shapeWhole = null;
    this.shapeSide = side;
    this.rules.side = side;
    const lay = atlasLayout(h.fine.nx, h.fine.nz, h.coarse.nx, h.coarse.nz, side);
    const sh = (this.shape = new ShapeWindow(side, this.shapeStep));
    sh.source = source;
    this.shapeCol = lay.col;
    this.shapeRow = lay.row;
    const old = this.heights;
    const heights = (this.heights = dataTex(heightsAtlas(fine, h.fine.nx, h.fine.nz, coarse, h.coarse.nx, h.coarse.nz, side), lay.w, lay.h, THREE.RedFormat, THREE.FloatType, false));
    if (this.renderer) {
      this.renderer.initTexture(heights);
      letGo(heights);
    }
    const i = old ? this.textures.indexOf(old) : -1;
    if (i >= 0) this.textures[i] = heights;
    else this.textures.push(heights);
    if (this.session) this.session.uniforms.uHorizonHeights.value = heights;
    old?.dispose();
    return true;
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

  /**
   * MB on the card (the formats' arithmetic: the heights atlas 4 bytes, the fine normals 2 with mips, the albedos 4 with
   * mips, the composition window 8 and its tint window 4) and on the CPU; `window` the two windows' share of the card;
   * `shape` the shape window's share of the CPU (its heights, and the raw grids kept beside the terrain worker's blocks).
   */
  megabytes(): { card: number; cpu: number; window: number; shape: number } {
    const h = this.header;
    if (!h) return { card: 0, cpu: 0, window: 0, shape: 0 };
    const mip = 4 / 3;
    const f = h.fine.nx * h.fine.nz;
    const c = h.coarse.nx * h.coarse.nz;
    const col = h.colour.nx * h.colour.nz;
    const lay = atlasLayout(h.fine.nx, h.fine.nz, h.coarse.nx, h.coarse.nz, this.shapeSide);
    const atlas = lay.w * lay.h;
    const win = this.place.S * this.place.S * 8 + this.place.T * this.place.T * 4;
    const card = atlas * 4 + f * 2 * mip + (col + c) * 4 * mip + win;
    const pyr = this.pyramid ? this.pyramid.lo.reduce((n, a) => n + a.byteLength * 2, 0) : 0;
    // Wave h6a: the shape window's own heights (its block of the atlas on the card, its array on the CPU), apart; on the CPU
    // with the raw grid kept beside each block the terrain worker made (W4's `raws`, about 5 KB each: h6a's review, some 20 MB
    // of a window of 2,048 against 4 of 1,024).
    const shape = this.shapeSide * this.shapeSide * 4 + (this.shape ? this.shape.rawBytes() : 0);
    return { card: card / 1048576, cpu: (f * 4 + c * 4 + pyr + shape) / 1048576, window: win / 1048576, shape: shape / 1048576 };
  }

  /** Every overlay still awaited answered with nothing (the worker gone, the field let go), so no caller waits for good. */
  private answerOverlays(): void {
    const waits = [...this.overlayWait.values()];
    this.overlayWait.clear();
    for (const r of waits) r(null);
    const poles = [...this.polesWait.values()];
    this.polesWait.clear();
    for (const r of poles) r(null);
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
      for (const k of ['uHorizonHeights', 'uHorizonFineN', 'uHorizonAlbedo', 'uHorizonCoarseAlbedo', 'uHorizonWindow', 'uHorizonTint'] as const) u[k].value = fresh[k].value;
      u.uHorizonWin.value.copy(fresh.uHorizonWin.value);
      // The shape window read no more (wave 3b): the stand-in atlas holds none of it.
      u.uHorizonShape.value.w = 0;
    }
    this.shape?.dispose();
    this.shape = null;
    this.shapeSrc?.dispose();
    this.shapeSrc = null;
    this.shapeWhole?.dispose();
    this.shapeWhole = null;
    for (const t of this.textures) t.dispose();
    this.textures.length = 0;
    this.winTex?.dispose();
    this.tintTex?.dispose();
    this.winTex = this.tintTex = null;
    this.session = null;
    // W4: the live edits' queues and the mips' 1-texel stand-ins let go.
    for (const t of this.mipTexel) t?.src.dispose();
    this.mipped.length = this.mipStale.length = this.mipTexel.length = 0;
    this.mipsStale = 0;
    this.coursePieces.length = 0;
    this.courseByTile.clear();
    this.paintQueue.length = 0;
    this.paintState.clear();
    this.paintAgain.clear();
    this.liveStores = null;
  }
}
