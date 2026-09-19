// The velocity product: how far each pixel of a thing that moves on its own has moved on the screen
// since the last frame, for the motion blur to merge with the camera's reprojection of everything
// else.
//
// The game lists what moves (`FxMoverList`, filled by `App.collectMovers` once a frame). Each mover
// is scanned for its opaque meshes; each frame every mesh is checked the way three's projectObject
// checks it (visible up to the scene, on the actor layer, in the frustum), and only the meshes whose
// velocity differs from what the blur would compute from depth are drawn:
//   - what the camera follows (the player, what they ride, fly or stand aboard) draws only its rigid
//     parts that moved relative to it (wings opening, a weapon in a hand); everything else of it is
//     exactly the static result under the static cut, which is pushed past its far side;
//   - other movers draw everything while their root moves, and only such parts while it stands.
// Motion is the root's: a skinned body moves with its root, and last frame's bones are not kept.
//
// The draws go straight to renderer.renderBufferDirect from inside an empty proxy scene's
// onAfterRender, grouped by program with one material per program variant. Two rules hold every draw
// safe: nothing may throw out of that callback (three's render state would stay pushed for the rest
// of the frame), and a mesh is drawn only after it passed the check on an earlier frame, since a
// mesh three never projected has no buffers and drawing it would save a broken vertex array for good.
import * as THREE from 'three';
import { isShadowOnly, type FxProductId } from '../fxRegistry.ts';
import type { FxFrameContext } from './context';
import { FX_CAMERA, NO_PRODUCTS, type FxWarmItem } from './pass';
import { GeometryProduct, geometryMaterialDefaults, type FxGeometryDrawer } from './geometry';
import type { PostFX } from '../postfx';
import { ACTOR_LAYER } from '../../world/portalRender';
import { MOVER_LIMITS, WARM_VARIANTS, classifyMover, drawableSince, moverPriority, movingWeight, shownSince, staticCut, takeByBudget, variantKey, type BudgetTotals, type FxMoverKind, type MoverFacts, type MoverResult, type VariantKeyParts } from './velocityMath.ts';

export type { FxMoverKind } from './velocityMath.ts';

/** Filled by the game once a frame; kept and reused, so nothing is allocated. */
export class FxMoverList {
  readonly roots: THREE.Object3D[] = [];
  readonly carried: boolean[] = [];
  readonly kinds: FxMoverKind[] = [];
  /** The game's own world velocity (m/s) for a mover whose frame-to-frame motion is not its speed (a remote glide), else null. Read during the frame; the caller keeps the vector. */
  readonly velocities: (THREE.Vector3 | null)[] = [];
  /** A subtree of the root left out of its draws, or null: a ship's separate room model while nobody aboard sees it (it only ever shows through the hull, where the depth test fails). */
  readonly skips: (THREE.Object3D | null)[] = [];
  length = 0;

  clear(): void {
    this.length = 0;
  }

  add(root: THREE.Object3D, carried: boolean, kind: FxMoverKind, velocity: THREE.Vector3 | null = null, skip: THREE.Object3D | null = null): void {
    const i = this.length++;
    this.roots[i] = root;
    this.carried[i] = carried;
    this.kinds[i] = kind;
    this.velocities[i] = velocity;
    this.skips[i] = skip;
  }
}

/** A bounding sphere in a root's own frame. */
export interface LocalSphere {
  readonly centre: THREE.Vector3;
  radius: number;
}

/** A figure's sphere in its root's frame: the player group stands at the feet (the eye is 1.5 m above). */
export const FIGURE_SPHERE: LocalSphere = { centre: new THREE.Vector3(0, 1, 0), radius: 2 };

export interface VelocityStats {
  frame: number;
  tracked: number;
  drawnMovers: number;
  draws: number;
  carriedDraws: number;
  waiting: number;
  scans: number;
  cpuMs: number;
  empty: boolean;
  followFar: number;
  cut: [number, number];
  broken: string | null;
  variants: { key: string; warm: boolean; ready: boolean; failed: boolean }[];
  list: { kind: FxMoverKind; name: string; carried: boolean; meshes: number; drawable: number; animated: number; drawn: number; result: MoverResult; speed: number; depth: number; px: number }[];
}

// --- what may be drawn -------------------------------------------------------------------------

/** A material the velocity may stand in for: drawn, opaque, writing depth. Glass copies, glows, trails and blades are not. */
function eligibleMaterial(m: THREE.Material | null | undefined): m is THREE.Material {
  if (!m) return false;
  if (!m.visible || m.userData.invisible) return false;
  if (!m.colorWrite || !m.depthWrite || m.transparent) return false;
  if (m.blending !== THREE.NormalBlending && m.blending !== THREE.NoBlending) return false;
  return !m.userData.noVelocity;
}

/** The morph targets a variant is made for; -1 when a geometry morphs only normals or colours, which no variant covers. */
function morphCount(g: THREE.BufferGeometry): number {
  const ma = g.morphAttributes;
  if (ma.position) return ma.position.length;
  return ma.normal || ma.color ? -1 : 0;
}

/** A mesh the velocity may draw, before its materials are looked at. */
function eligibleMesh(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return false;
  if ((m as THREE.InstancedMesh).isInstancedMesh || (m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) return false;
  if (m.userData.noVelocity) return false;
  const g = m.geometry;
  if (!g || !g.attributes.position || morphCount(g) < 0) return false;
  const s = m as THREE.SkinnedMesh;
  if (s.isSkinnedMesh && !s.skeleton) return false;
  return true;
}

function anyEligibleMaterial(m: THREE.Mesh): boolean {
  const mat = m.material;
  if (!Array.isArray(mat)) return eligibleMaterial(mat);
  const groups = m.geometry.groups;
  for (let i = 0; i < groups.length; i++) if (eligibleMaterial(mat[groups[i].materialIndex ?? 0])) return true;
  return false;
}

// --- spheres ------------------------------------------------------------------------------------

const mBox = new THREE.Box3();
const mPart = new THREE.Box3();
const mInv = new THREE.Matrix4();
const mRel = new THREE.Matrix4();

function measureVisit(o: THREE.Object3D): void {
  if (!eligibleMesh(o) || !anyEligibleMaterial(o)) return;
  const g = o.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  if (!g.boundingBox || g.boundingBox.isEmpty()) return;
  mRel.multiplyMatrices(mInv, o.matrixWorld);
  mPart.copy(g.boundingBox).applyMatrix4(mRel);
  mBox.union(mPart);
}

/**
 * The bounding sphere of every opaque mesh under `root`, in the root's frame, shown or not (a hull's
 * rooms count while hidden): the box's centre, and its half diagonal times `scale` plus `pad`.
 */
export function measureLocalSphere(root: THREE.Object3D, out: LocalSphere, scale = 1, pad = 0.5): LocalSphere {
  root.updateWorldMatrix(true, true);
  mInv.copy(root.matrixWorld).invert();
  mBox.makeEmpty();
  root.traverse(measureVisit);
  if (mBox.isEmpty()) {
    out.centre.set(0, 0, 0);
    out.radius = pad;
    return out;
  }
  mBox.getCenter(out.centre);
  out.radius = mBox.min.distanceTo(mBox.max) * 0.5 * scale + pad;
  return out;
}

const fdV = new THREE.Vector3();

/** View depth of the far side of a sphere given in a root's frame: −(view × root × centre).z + radius × the root's largest scale. */
export function followDepth(view: THREE.Matrix4, rootWorld: THREE.Matrix4, sphere: LocalSphere): number {
  fdV.copy(sphere.centre).applyMatrix4(rootWorld).applyMatrix4(view);
  return -fdV.z + sphere.radius * rootWorld.getMaxScaleOnAxis();
}

// --- the frame's motion history -----------------------------------------------------------------

interface MotionHistory {
  readonly view: THREE.Matrix4;
  readonly prevProjView: THREE.Matrix4;
  /** The frame `view` was recorded on. */
  frame: number;
  /** The frame `prevProjView` was worked out for. */
  at: number;
}
const histories = new WeakMap<FxFrameContext, MotionHistory>();

/**
 * This frame's projection times last frame's view: a change of field of view (aiming) is not motion,
 * so it never smears. The frame context carries it once the spine keeps the previous view; until then
 * it is kept here, one record per context, and a frame whose last frame was not seen reads as still.
 */
export function prevProjViewOf(ctx: FxFrameContext): THREE.Matrix4 {
  const given = (ctx as { prevProjView?: THREE.Matrix4 }).prevProjView;
  if (given) return given;
  let h = histories.get(ctx);
  if (!h) {
    h = { view: new THREE.Matrix4(), prevProjView: new THREE.Matrix4(), frame: -2, at: -2 };
    histories.set(ctx, h);
  }
  if (h.at !== ctx.frame) {
    const prevView = h.frame === ctx.frame - 1 && !ctx.cameraCut ? h.view : ctx.view;
    h.prevProjView.multiplyMatrices(ctx.proj, prevView);
    h.view.copy(ctx.view);
    h.frame = ctx.frame;
    h.at = ctx.frame;
  }
  return h.prevProjView;
}

/** The view depth of the far side of what the camera follows (`ctx.followFar`), 0 when the context does not carry it. */
export function followFarOf(ctx: FxFrameContext): number {
  const f = (ctx as { followFar?: number }).followFar;
  return typeof f === 'number' && Number.isFinite(f) ? Math.max(0, f) : 0;
}

// --- the shaders --------------------------------------------------------------------------------

const VELOCITY_VERT = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
uniform mat4 uPrev;          // rigid: last frame's model matrix; skinned: the root motion R (world to world)
uniform mat4 uCarry;         // world to world: R for what the camera follows, identity otherwise
uniform mat4 uPrevProjView;  // this frame's projection x last frame's view
varying vec4 vNow;
varying vec4 vRef;
varying vec4 vPrev;
varying float vViewZ;
#ifdef VEL_ALPHA
varying vec2 vUv;
#endif
void main() {
  #ifdef VEL_ALPHA
  vUv = uv;                  // raw uv: the converted packs carry no map transforms
  #endif
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #ifndef USE_SKINNING
  vec3 rest = transformed;   // morphed, in the mesh's frame: the previous frame uses this frame's morph weights
  #endif
  #include <skinbase_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vec4 worldNow = modelMatrix * vec4( transformed, 1.0 );
  #ifdef USE_SKINNING
  vec4 worldPrev = uPrev * worldNow;
  #else
  vec4 worldPrev = uPrev * vec4( rest, 1.0 );
  #endif
  vNow = gl_Position;
  vRef = uPrevProjView * ( uCarry * worldNow );
  vPrev = uPrevProjView * worldPrev;
  vViewZ = -mvPosition.z;
}
`;

const VELOCITY_FRAG = /* glsl */ `
uniform vec2 uCut;
uniform float uMoving;
#ifdef VEL_ALPHA
uniform sampler2D uAlphaMap;
uniform float uAlphaTest;
varying vec2 vUv;
#endif
varying vec4 vNow;
varying vec4 vRef;
varying vec4 vPrev;
varying float vViewZ;
void main() {
  #ifdef VEL_ALPHA
  if ( texture2D( uAlphaMap, vUv ).a < uAlphaTest ) discard;   // only this variant: discard costs early depth testing
  #endif
  vec2 now = vNow.xy / vNow.w;
  vec2 ref = vRef.w > 1e-4 ? vRef.xy / vRef.w : now;           // behind last frame's camera: no rigid motion
  vec2 prev = vPrev.w > 1e-4 ? vPrev.xy / vPrev.w : ref;
  float w = max( smoothstep( uCut.x, uCut.y, vViewZ ), uMoving ); // uCut.x < uCut.y always (staticCut)
  vec2 v = ( ( now - ref ) * w + ( ref - prev ) ) * 0.5;        // ndc to uv; now minus then, per frame
  if ( any( isnan( v ) ) || any( isinf( v ) ) ) v = vec2( 0.0 );
  gl_FragColor = vec4( clamp( v, -1.0, 1.0 ), 1.0, uMoving );  // b: covered; a: the moving weight, for the debug view
}
`;

// --- records ------------------------------------------------------------------------------------

interface VelocityShared {
  readonly uPrevProjView: { value: THREE.Matrix4 };
  readonly uCut: { value: THREE.Vector2 };
}

interface VelocityVariant {
  readonly key: string;
  readonly parts: VariantKeyParts;
  readonly material: THREE.ShaderMaterial;
  /** One triangle with this key's attributes, for compiling. */
  readonly dummy: THREE.Mesh;
  readonly warm: boolean;
  /** This frame's draws, a kept bucket. */
  readonly items: DrawRecord[];
  count: number;
  ready: boolean;
  failed: boolean;
  compiling: boolean;
  job: Promise<void> | null;
}

/** One draw: the whole mesh, or one geometry group of an array material. */
interface DrawRecord {
  state: MeshState;
  group: THREE.GeometryGroup | null;
  /** The scene's material for this draw: its `side` is copied per draw. */
  source: THREE.Material;
  /** What decides its program, kept so the variant can be made when the draw is first wanted. */
  readonly parts: VariantKeyParts;
  /**
   * Null until a frame wants the draw: a skinned part of what the camera follows is never drawn (only
   * rigid parts can move relative to it), so its program is not built unless that changes.
   */
  variant: VelocityVariant | null;
  alphaMap: THREE.Texture | null;
  alphaTest: number;
}

/** One mesh of a mover. */
interface MeshState {
  readonly mover: MoverRecord;
  readonly mesh: THREE.Mesh;
  /** mesh.geometry at scan. */
  geometry: THREE.BufferGeometry;
  /** mesh.material at scan (identity). */
  material: THREE.Material | THREE.Material[];
  /** The array's entries at scan, when the material is an array. */
  snapshot: THREE.Material[] | null;
  /** [mesh, its parent, ..., the root's child]; never the root. */
  readonly chain: THREE.Object3D[];
  skinned: boolean;
  /** mesh.matrixWorld last frame. */
  readonly prev: THREE.Matrix4;
  historyFrame: number;
  /** root⁻¹ × mesh.matrixWorld at relFrame. */
  readonly rel: THREE.Matrix4;
  relFrame: number;
  /** First frame of the current run of passing the draw check; -1 when last checked it did not. */
  firstShown: number;
  /** This frame: rel changed. */
  animated: boolean;
  /** This frame: shown now and on an earlier frame. */
  drawable: boolean;
  /** Its geometry was disposed. */
  dead: boolean;
  readonly draws: DrawRecord[];
  /** Draws filled in by the scan in progress. */
  drawCount: number;
}

interface MoverRecord {
  readonly root: THREE.Object3D;
  kind: FxMoverKind;
  carried: boolean;
  velocity: THREE.Vector3 | null;
  /** The subtree the list leaves out (FxMoverList.skips); a change rescans. */
  skip: THREE.Object3D | null;
  /** The first named descendant, for stats. */
  name: string;
  /** ctx.frame it was last listed. */
  seen: number;
  /** ctx.frame of the last scan (-1: never). */
  scanned: number;
  /** 0..rescanFrames-1, so periodic rescans spread over frames. */
  stagger: number;
  /** A check found the scan out of date. */
  stale: boolean;
  states: MeshState[];
  spare: MeshState[];
  /** Geometries this record listens to for disposal. */
  readonly geometries: Set<THREE.BufferGeometry>;
  /** Bounding sphere in the root's frame. */
  readonly local: LocalSphere;
  readonly rootPrev: THREE.Matrix4;
  rootFrame: number;
  /** This frame's root motion: world now to world last frame. */
  readonly R: THREE.Matrix4;
  moved: number;
  speed: number;
  turn: number;
  hidden: boolean;
  inFrustum: boolean;
  depth: number;
  screenRadiusPx: number;
  /** Animated parts this frame. */
  animated: number;
  drawableCount: number;
  result: MoverResult;
  /** Draws counted for the budget, then taken. */
  pending: number;
  priority: number;
  drawn: number;
  warned: boolean;
}

const IDENTITY = new THREE.Matrix4();
const noop = (): void => {};
const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpSphere = new THREE.Sphere();
const savedColor = new THREE.Color();
/** The variant parts of the mesh being scanned; copied when a new variant keeps them. */
const scanParts: VariantKeyParts = { skinned: false, morphs: 0, morphNormals: false, morphColors: false, alpha: false };

/** Whether two matrices differ in their affine part (rotation, scale, translation) by more than `tol`. */
function affineDiffers(a: THREE.Matrix4, b: THREE.Matrix4, tol: number): boolean {
  const x = a.elements;
  const y = b.elements;
  for (let c = 0; c < 4; c++) {
    const o = c * 4;
    if (Math.abs(x[o] - y[o]) > tol || Math.abs(x[o + 1] - y[o + 1]) > tol || Math.abs(x[o + 2] - y[o + 2]) > tol) return true;
  }
  return false;
}

function sameEntries(a: readonly THREE.Material[], b: readonly THREE.Material[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

type DirectDraw = (ctx: FxFrameContext, run: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void) => void;

export class VelocityProduct extends GeometryProduct {
  /** Nothing was drawn this frame: the runner may hand the passes null, and the target holds zeros. */
  empty = true;
  /** Set when the draws failed as a whole; the product then draws nothing until the effects are rebuilt. */
  broken: string | null = null;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly collect: (out: FxMoverList) => void;
  private readonly list = new FxMoverList();
  private readonly shared: VelocityShared = { uPrevProjView: { value: new THREE.Matrix4() }, uCut: { value: new THREE.Vector2(25, 60) } };
  private readonly variants: VelocityVariant[] = [];
  private readonly byKey = new Map<string, VelocityVariant>();
  private readonly dummyGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly dummySkeletons: THREE.Skeleton[] = [];
  /** A 1x1 target with no depth, bound only to compile: any non-null target gives the key a draw into the product makes. */
  private readonly compileTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false, samples: 0 });
  private readonly records = new Map<THREE.Object3D, MoverRecord>();
  private readonly all: MoverRecord[] = [];
  /** The records listed this frame, in list order. */
  private readonly active: MoverRecord[] = [];
  private readonly candidates: MoverRecord[] = [];
  /** takeByBudget's answer per candidate, its scratch order and its totals: kept, so nothing is allocated. */
  private readonly taken: boolean[] = [];
  private readonly order: number[] = [];
  private readonly totals: BudgetTotals = { draws: 0, carriedDraws: 0 };
  private readonly byGeometry = new Map<THREE.BufferGeometry, Set<MoverRecord>>();
  /** Meshes whose draw threw: left out from now on, across rescans. */
  private readonly failedMeshes = new WeakSet<THREE.Mesh>();
  private readonly frustum = new THREE.Frustum();
  private readonly invRoot = new THREE.Matrix4();
  private readonly facts: MoverFacts = { kind: 'player', carried: false, hidden: false, inFrustum: false, historyValid: false, moved: 0, dt: 1 / 60, speed: 0, turn: 0, animated: 0, screenRadiusPx: 0 };
  private readonly scratchGeometries = new Set<THREE.BufferGeometry>();
  private readonly oldStates = new Map<THREE.Mesh, MeshState>();
  private readonly proxy: THREE.Scene;
  private scanRec: MoverRecord | null = null;
  private scanFrame = 0;
  private staggerNext = 0;
  private failures = 0;
  private frame = 0;
  private dt = 1 / 60;
  private draws = 0;
  private carriedDraws = 0;
  private waiting = 0;
  private scans = 0;
  private cpuMs = 0;
  private lastFollowFar = 0;
  /** The target holds a velocity picture a later empty frame has to clear. */
  private dirty = false;
  private disposed = false;

  constructor(postfx: PostFX, collectMovers: (out: FxMoverList) => void) {
    super('velocity', postfx, { format: THREE.RGBAFormat, type: THREE.HalfFloatType, clear: new THREE.Color(0, 0, 0), clearAlpha: 0 });
    this.renderer = postfx.ctx.renderer;
    this.collect = collectMovers;
    this.compileTarget.texture.name = 'fx.velocity.compile';
    this.proxy = new THREE.Scene();
    this.proxy.matrixAutoUpdate = false;
    this.proxy.matrixWorldAutoUpdate = false;
    for (const parts of WARM_VARIANTS) this.variantFor(parts, true);
    // Start every program now; the chain's warm-up compiles the same dummies again, which finds them built.
    for (const v of this.variants) void this.compileVariant(v);
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return NO_PRODUCTS;
  }

  render(ctx: FxFrameContext): void {
    const t0 = performance.now();
    this.draws = 0;
    this.carriedDraws = 0;
    this.waiting = 0;
    this.scans = 0;
    this.empty = true;
    if (this.broken || this.disposed) return;
    this.frame = ctx.frame;
    this.dt = Math.max(ctx.dt, 1e-4);
    this.lastFollowFar = followFarOf(ctx);
    this.list.clear();
    try {
      this.collect(this.list);
    } catch (err) {
      console.warn('velocity: listing the movers failed', err);
      this.list.clear();
    }
    this.refresh();
    this.classify(ctx);
    this.empty = this.draws + this.carriedDraws === 0;
    if (!this.empty) {
      this.bindAndClear(ctx);
      this.shared.uPrevProjView.value.copy(prevProjViewOf(ctx));
      staticCut(this.lastFollowFar, this.shared.uCut.value);
      this.draw(ctx);
      this.dirty = true;
    } else if (this.dirty) {
      // A runner that hands the passes the texture whether or not it was drawn must find zeros in it.
      this.bindAndClear(ctx);
      this.dirty = false;
    }
    this.record();
    this.cpuMs = performance.now() - t0;
  }

  /** Bind the target and clear its colour only: the frame's depth is what makes the draws worth doing. */
  protected bindAndClear(ctx: FxFrameContext): void {
    const r = ctx.renderer;
    r.setRenderTarget(this.target);
    r.getClearColor(savedColor);
    const alpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.setClearColor(savedColor, alpha);
  }

  protected draw(ctx: FxFrameContext): void {
    const drawer = this.drawer as FxGeometryDrawer & { drawDirect?: DirectDraw };
    if (typeof drawer.drawDirect === 'function') {
      drawer.drawDirect(ctx, this.runDraws);
      return;
    }
    // The same thing as the shared drawer's direct draw: an empty scene whose onAfterRender draws.
    const p = this.proxy;
    p.onAfterRender = this.runDraws;
    try {
      ctx.renderer.render(p, ctx.camera);
    } finally {
      p.onAfterRender = noop;
    }
  }

  // --- listing and scanning ---------------------------------------------------------------------

  /** Records found or made for this frame's list, due scans run, the long unseen dropped. */
  private refresh(): void {
    const frame = this.frame;
    const list = this.list;
    const active = this.active;
    active.length = 0;
    for (let i = 0; i < list.length; i++) {
      const root = list.roots[i];
      let rec = this.records.get(root);
      if (!rec) {
        rec = this.newRecord(root);
        this.records.set(root, rec);
        this.all.push(rec);
      }
      if (rec.seen === frame) continue;
      rec.seen = frame;
      rec.kind = list.kinds[i];
      rec.carried = list.carried[i];
      rec.velocity = list.velocities[i];
      const skip = list.skips[i];
      if (rec.skip !== skip) {
        // Boarded or left: the draws are taken again with or without that subtree.
        rec.skip = skip;
        rec.stale = true;
      }
      const due = rec.scanned < 0 || rec.stale || (rec.scanned !== frame && (frame + rec.stagger) % MOVER_LIMITS.rescanFrames === 0);
      if (due && this.scans < MOVER_LIMITS.maxScansPerFrame) {
        this.scan(rec);
        this.scans++;
      }
      active.push(rec);
    }
    if (frame % 30 === 0) this.prune(frame);
  }

  private newRecord(root: THREE.Object3D): MoverRecord {
    return {
      root,
      kind: 'vehicle',
      carried: false,
      velocity: null,
      skip: null,
      name: '',
      seen: -1,
      scanned: -1,
      stagger: this.staggerNext++ % MOVER_LIMITS.rescanFrames,
      stale: false,
      states: [],
      spare: [],
      geometries: new Set(),
      local: { centre: new THREE.Vector3(), radius: 0 },
      rootPrev: new THREE.Matrix4(),
      rootFrame: -1,
      R: new THREE.Matrix4(),
      moved: 0,
      speed: 0,
      turn: 0,
      hidden: false,
      inFrustum: false,
      depth: 0,
      screenRadiusPx: 0,
      animated: 0,
      drawableCount: 0,
      result: 'fresh',
      pending: 0,
      priority: 0,
      drawn: 0,
      warned: false,
    };
  }

  private prune(frame: number): void {
    const all = this.all;
    for (let i = all.length - 1; i >= 0; i--) {
      const rec = all[i];
      if (frame - rec.seen <= MOVER_LIMITS.forgetFrames) continue;
      this.release(rec);
      this.records.delete(rec.root);
      all[i] = all[all.length - 1];
      all.pop();
    }
  }

  /** Stop listening for a record's geometries. */
  private release(rec: MoverRecord): void {
    for (const g of rec.geometries) this.unlisten(g, rec);
    rec.geometries.clear();
    rec.states.length = 0;
    rec.spare.length = 0;
  }

  private listen(g: THREE.BufferGeometry, rec: MoverRecord): void {
    let set = this.byGeometry.get(g);
    if (!set) {
      set = new Set();
      this.byGeometry.set(g, set);
      g.addEventListener('dispose', this.onGeometryDispose);
    }
    set.add(rec);
  }

  private unlisten(g: THREE.BufferGeometry, rec: MoverRecord): void {
    const set = this.byGeometry.get(g);
    if (!set) return;
    set.delete(rec);
    if (set.size === 0) {
      this.byGeometry.delete(g);
      g.removeEventListener('dispose', this.onGeometryDispose);
    }
  }

  /** A geometry was disposed: nothing of it is drawn again until it has been drawn by the scene and rescanned. */
  private readonly onGeometryDispose = (event: { target: THREE.BufferGeometry }): void => {
    const g = event.target;
    const set = this.byGeometry.get(g);
    if (!set) return;
    for (const rec of set) {
      rec.stale = true;
      rec.geometries.delete(g);
      for (const s of rec.states) if (s.geometry === g) s.dead = true;
    }
    this.byGeometry.delete(g);
    g.removeEventListener('dispose', this.onGeometryDispose);
  };

  /** Walk a mover for its opaque meshes, keeping the history of those it already had. */
  private scan(rec: MoverRecord): void {
    const old = this.oldStates;
    old.clear();
    for (const s of rec.states) old.set(s.mesh, s);
    const next = rec.spare;
    next.length = 0;
    rec.spare = rec.states;
    rec.states = next;
    this.scanRec = rec;
    this.scanFrame = this.frame;
    let skinned = false;
    try {
      rec.root.updateWorldMatrix(true, false);
      this.scanTree(rec.root, rec.skip);
    } finally {
      this.scanRec = null;
    }
    rec.spare.length = 0;
    old.clear();
    // Listen to the geometries now in use and let go of those that are not.
    const now = this.scratchGeometries;
    now.clear();
    for (const s of rec.states) {
      now.add(s.geometry);
      if (s.skinned) skinned = true;
    }
    for (const g of rec.geometries) if (!now.has(g)) this.unlisten(g, rec);
    for (const g of now) if (!rec.geometries.has(g)) this.listen(g, rec);
    rec.geometries.clear();
    for (const g of now) rec.geometries.add(g);
    now.clear();
    // A pose leaves the bind box, so a skinned mover's sphere is taken larger.
    measureLocalSphere(rec.root, rec.local, skinned ? 1.25 : 1, 0.5);
    rec.scanned = this.frame;
    rec.stale = false;
  }

  /** Object3D.traverse that leaves out one subtree. */
  private scanTree(o: THREE.Object3D, skip: THREE.Object3D | null): void {
    if (o === skip) return;
    this.scanVisit(o);
    const children = o.children;
    for (let i = 0; i < children.length; i++) this.scanTree(children[i], skip);
  }

  private readonly scanVisit = (o: THREE.Object3D): void => {
    const rec = this.scanRec!;
    if (!rec.name && o.name) rec.name = o.name;
    if (!eligibleMesh(o) || this.failedMeshes.has(o) || !anyEligibleMaterial(o)) return;
    const mesh = o;
    const skinned = !!(mesh as THREE.SkinnedMesh).isSkinnedMesh;
    const prevState = this.oldStates.get(mesh);
    const mat = mesh.material;
    let s: MeshState;
    // The same mesh with the same geometry and materials keeps its history; anything else starts afresh.
    if (prevState && prevState.geometry === mesh.geometry && prevState.material === mat && (!prevState.snapshot || (Array.isArray(mat) && sameEntries(mat, prevState.snapshot)))) {
      s = prevState;
    } else {
      s = {
        mover: rec,
        mesh,
        geometry: mesh.geometry,
        material: mat,
        snapshot: Array.isArray(mat) ? mat.slice() : null,
        chain: [],
        skinned,
        prev: new THREE.Matrix4(),
        historyFrame: -1,
        rel: new THREE.Matrix4(),
        relFrame: -1,
        firstShown: -1,
        animated: false,
        drawable: false,
        dead: false,
        draws: [],
        drawCount: 0,
      };
    }
    if (s.dead) {
      // Drawn again only once the scene has uploaded it anew.
      s.dead = false;
      s.firstShown = -1;
    }
    // The chain from the mesh up to the root, the root left out; a mesh that does not reach it is skipped.
    const chain = s.chain;
    chain.length = 0;
    let node: THREE.Object3D | null = mesh;
    while (node && node !== rec.root) {
      chain.push(node);
      node = node.parent;
    }
    if (node !== rec.root) return;
    // The draws: the whole mesh, or each geometry group whose material is eligible.
    s.drawCount = 0;
    const g = mesh.geometry;
    const parts: VariantKeyParts = scanParts;
    parts.skinned = skinned;
    parts.morphs = morphCount(g);
    parts.morphNormals = !!g.morphAttributes.normal;
    parts.morphColors = !!g.morphAttributes.color;
    if (Array.isArray(mat)) {
      for (let i = 0; i < g.groups.length; i++) {
        const group = g.groups[i];
        const source = mat[group.materialIndex ?? 0];
        if (eligibleMaterial(source)) this.addDraw(s, group, source, parts);
      }
    } else if (eligibleMaterial(mat)) {
      this.addDraw(s, null, mat, parts);
    }
    s.draws.length = s.drawCount;
    if (s.drawCount === 0) return;
    // What first person keeps on the shadow layer (the player's head) is off the actor layer on purpose.
    if (import.meta.env.DEV && !rec.warned && !mesh.layers.isEnabled(ACTOR_LAYER) && !isShadowOnly(mesh.layers.mask)) {
      rec.warned = true;
      console.warn(`velocity: ${mesh.name || mesh.type} under ${rec.name || rec.root.type} is not on the actor layer, so it is never drawn and blurs with the camera only`);
    }
    rec.states.push(s);
  };

  private addDraw(s: MeshState, group: THREE.GeometryGroup | null, source: THREE.Material, parts: VariantKeyParts): void {
    const map = (source as THREE.MeshBasicMaterial).map ?? null;
    const alpha = source.alphaTest > 0 && !!map;
    parts.alpha = alpha;
    // Made (and compiled) now when it may be drawn, so it is ready by then; a skinned part of what the
    // camera follows waits until a frame wants it, which is never while it stays followed.
    const variant = s.skinned && s.mover.carried ? null : this.variantFor(parts, false);
    const i = s.drawCount++;
    let d = s.draws[i];
    if (!d) {
      d = { state: s, group, source, parts: { ...parts }, variant, alphaMap: null, alphaTest: 0 };
      s.draws[i] = d;
    }
    d.group = group;
    d.source = source;
    const own = d.parts;
    own.skinned = parts.skinned;
    own.morphs = parts.morphs;
    own.morphNormals = parts.morphNormals;
    own.morphColors = parts.morphColors;
    own.alpha = parts.alpha;
    d.variant = variant;
    d.alphaMap = alpha ? map : null;
    d.alphaTest = alpha ? source.alphaTest : 0;
  }

  // --- the frame's decisions --------------------------------------------------------------------

  private classify(ctx: FxFrameContext): void {
    const frame = this.frame;
    const dt = this.dt;
    this.frustum.setFromProjectionMatrix(ctx.viewProj, THREE.WebGLCoordinateSystem, ctx.camera.reversedDepth);
    for (let i = 0; i < this.variants.length; i++) this.variants[i].count = 0;
    const pxPerUnit = ctx.height / 2 / Math.max(ctx.tanHalfFov.y, 1e-6);
    const cands = this.candidates;
    cands.length = 0;
    const f = this.facts;
    for (let i = 0; i < this.active.length; i++) {
      const rec = this.active[i];
      this.rootFacts(rec, ctx, frame, dt, pxPerUnit);
      if (!rec.hidden && rec.inFrustum) this.checkMeshes(rec, frame);
      else {
        rec.animated = 0;
        rec.drawableCount = 0;
        for (const s of rec.states) {
          s.drawable = false;
          s.animated = false;
        }
      }
      f.kind = rec.kind;
      f.carried = rec.carried;
      f.hidden = rec.hidden;
      f.inFrustum = rec.inFrustum;
      f.historyValid = rec.rootFrame === frame - 1 && rec.scanned >= 0;
      f.moved = rec.moved;
      f.dt = dt;
      f.speed = rec.speed;
      f.turn = rec.turn;
      f.animated = rec.animated;
      f.screenRadiusPx = rec.screenRadiusPx;
      rec.result = classifyMover(f);
      rec.drawn = 0;
      rec.pending = 0;
      if (rec.result !== 'all' && rec.result !== 'animated') continue;
      rec.pending = this.countDraws(rec);
      rec.priority = rec.carried ? 0 : moverPriority(rec.screenRadiusPx, rec.speed);
      cands.push(rec);
    }
    // What the camera follows under its own cap; the rest larger and faster first, past any that does not fit.
    const totals = takeByBudget(cands, this.taken, this.order, MOVER_LIMITS.maxDraws, MOVER_LIMITS.maxCarriedDraws, this.totals);
    for (let i = 0; i < cands.length; i++) {
      if (this.taken[i]) this.take(cands[i]);
      else cands[i].result = 'budget';
    }
    this.draws = totals.draws;
    this.carriedDraws = totals.carriedDraws;
  }

  /** Where the root is and was, how fast it goes and turns, and where it sits in the view. */
  private rootFacts(rec: MoverRecord, ctx: FxFrameContext, frame: number, dt: number, pxPerUnit: number): void {
    const root = rec.root;
    let hidden = false;
    let inScene = false;
    for (let o: THREE.Object3D | null = root; o; o = o.parent) {
      if (!o.visible) {
        hidden = true;
        break;
      }
      if ((o as THREE.Scene).isScene) inScene = true;
    }
    rec.hidden = hidden || !inScene;
    const now = root.matrixWorld;
    this.invRoot.copy(now).invert();
    if (rec.rootFrame === frame - 1) {
      const e = now.elements;
      const p = rec.rootPrev.elements;
      const dx = e[12] - p[12];
      const dy = e[13] - p[13];
      const dz = e[14] - p[14];
      rec.moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let turn = 0;
      for (let c = 0; c < 3; c++) {
        const o = c * 4;
        const len = Math.hypot(e[o], e[o + 1], e[o + 2]);
        if (len < 1e-9) continue;
        const d = Math.hypot(e[o] - p[o], e[o + 1] - p[o + 1], e[o + 2] - p[o + 2]) / len;
        if (d > turn) turn = d;
      }
      rec.turn = turn / dt;
      const v = rec.velocity;
      if (v) {
        rec.speed = v.length();
        rec.R.makeTranslation(-v.x * dt, -v.y * dt, -v.z * dt);
      } else {
        rec.speed = rec.moved / dt;
        rec.R.multiplyMatrices(rec.rootPrev, this.invRoot);
      }
    } else {
      rec.moved = 0;
      rec.speed = 0;
      rec.turn = 0;
      rec.R.identity();
    }
    const centre = tmpSphere.center.copy(rec.local.centre).applyMatrix4(now);
    const radius = rec.local.radius * now.getMaxScaleOnAxis();
    tmpSphere.radius = radius;
    rec.inFrustum = !rec.hidden && this.frustum.intersectsSphere(tmpSphere);
    rec.depth = -tmpV.copy(centre).applyMatrix4(ctx.view).z;
    rec.screenRadiusPx = rec.depth <= radius ? Infinity : (radius / rec.depth) * pxPerUnit;
  }

  /** Each mesh as three's projectObject would see it, and whether a rigid part moved relative to the root. */
  private checkMeshes(rec: MoverRecord, frame: number): void {
    rec.animated = 0;
    rec.drawableCount = 0;
    const frustum = this.frustum;
    const invRoot = this.invRoot;
    const tol = MOVER_LIMITS.relTolerance;
    for (let i = 0; i < rec.states.length; i++) {
      const s = rec.states[i];
      const m = s.mesh;
      s.drawable = false;
      s.animated = false;
      // Out of date: removed, re-parented, swapped or disposed. Rescanned; nothing of it is drawn meanwhile.
      if (s.dead || m.geometry !== s.geometry || m.material !== s.material || (s.snapshot && !sameEntries(m.material as THREE.Material[], s.snapshot))) {
        rec.stale = true;
        s.firstShown = -1;
        continue;
      }
      let attached = true;
      let visible = true;
      const chain = s.chain;
      for (let k = 0; k < chain.length; k++) {
        const node = chain[k];
        if (node.parent !== (k + 1 < chain.length ? chain[k + 1] : rec.root)) {
          attached = false;
          break;
        }
        if (!node.visible) visible = false;
      }
      if (!attached) {
        rec.stale = true;
        s.firstShown = -1;
        continue;
      }
      const shown = visible && m.layers.isEnabled(ACTOR_LAYER) && (!m.frustumCulled || frustum.intersectsObject(m));
      s.firstShown = shownSince(s.firstShown, shown, frame);
      if (!shown) continue;
      // Shown on an earlier frame too: three has projected it, so its buffers exist.
      s.drawable = drawableSince(s.firstShown, frame);
      if (s.drawable) rec.drawableCount++;
      if (!s.skinned && !rec.velocity) {
        tmpM.multiplyMatrices(invRoot, m.matrixWorld);
        s.animated = s.relFrame === frame - 1 && affineDiffers(tmpM, s.rel, tol);
        s.rel.copy(tmpM);
        s.relFrame = frame;
        if (s.animated) rec.animated++;
      }
    }
  }

  /** The draws a mover would make now, counting those whose program is still being built as waiting. */
  private countDraws(rec: MoverRecord): number {
    const onlyAnimated = rec.result === 'animated';
    let n = 0;
    for (let i = 0; i < rec.states.length; i++) {
      const s = rec.states[i];
      if (!s.drawable || (onlyAnimated && !s.animated)) continue;
      for (let k = 0; k < s.draws.length; k++) {
        const d = s.draws[k];
        // First wanted now: made and compiling from here, waiting until it is linked.
        const v = d.variant ?? (d.variant = this.variantFor(d.parts, false));
        if (v.failed) continue;
        if (!v.ready) {
          this.waiting++;
          continue;
        }
        n++;
      }
    }
    return n;
  }

  private take(rec: MoverRecord): void {
    const onlyAnimated = rec.result === 'animated';
    for (let i = 0; i < rec.states.length; i++) {
      const s = rec.states[i];
      if (!s.drawable || (onlyAnimated && !s.animated)) continue;
      for (let k = 0; k < s.draws.length; k++) {
        const d = s.draws[k];
        const v = d.variant;
        if (!v || !v.ready || v.failed) continue;
        v.items[v.count++] = d;
        rec.drawn++;
      }
    }
  }

  /** Where every listed mover and its meshes are now, for the next frame; hidden and culled ones too. */
  private record(): void {
    const frame = this.frame;
    for (let i = 0; i < this.active.length; i++) {
      const rec = this.active[i];
      rec.rootPrev.copy(rec.root.matrixWorld);
      rec.rootFrame = frame;
      for (let k = 0; k < rec.states.length; k++) {
        const s = rec.states[k];
        s.prev.copy(s.mesh.matrixWorld);
        s.historyFrame = frame;
      }
    }
  }

  // --- drawing ----------------------------------------------------------------------------------

  private readonly runDraws = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void => {
    try {
      for (let v = 0; v < this.variants.length; v++) {
        const variant = this.variants[v];
        if (variant.count === 0) continue;
        const material = variant.material;
        for (let i = 0; i < variant.count; i++) {
          const d = variant.items[i];
          const mesh = d.state.mesh;
          try {
            this.setDrawState(material, d, camera);
            // Three takes a null group as the whole mesh, as its own draws pass it; the typings say otherwise.
            renderer.renderBufferDirect(camera, scene, mesh.geometry, material, mesh, d.group as THREE.GeometryGroup);
          } catch (err) {
            this.failedMeshes.add(mesh);
            d.state.mover.stale = true;
            if (++this.failures <= 5) console.warn(`velocity: ${mesh.name || mesh.type} failed to draw and is left out`, err);
          }
        }
        material.side = THREE.FrontSide;
      }
    } catch (err) {
      this.broken = String((err as Error)?.message ?? err);
      console.error('velocity: the draws failed; object blur is off until the effects are rebuilt', err);
    }
  };

  private setDrawState(material: THREE.ShaderMaterial, d: DrawRecord, camera: THREE.Camera): void {
    const s = d.state;
    const rec = s.mover;
    const mesh = s.mesh;
    const u = material.uniforms;
    const prev = u.uPrev.value as THREE.Matrix4;
    if (s.skinned) prev.copy(rec.R);
    else if (!rec.velocity && s.historyFrame === this.frame - 1 && rec.rootFrame === this.frame - 1) prev.copy(s.prev);
    else prev.multiplyMatrices(rec.R, mesh.matrixWorld);
    (u.uCarry.value as THREE.Matrix4).copy(rec.carried ? rec.R : IDENTITY);
    u.uMoving.value = rec.carried ? 0 : movingWeight(rec.speed);
    if (d.alphaMap) {
      u.uAlphaMap.value = d.alphaMap;
      u.uAlphaTest.value = d.alphaTest;
    }
    material.side = d.source.side;
    mesh.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
    mesh.normalMatrix.getNormalMatrix(mesh.modelViewMatrix);
    material.uniformsNeedUpdate = true;
  }

  // --- variants ---------------------------------------------------------------------------------

  private variantFor(parts: VariantKeyParts, warm: boolean): VelocityVariant {
    const key = variantKey(parts);
    const have = this.byKey.get(key);
    if (have) return have;
    const own: VariantKeyParts = { ...parts };
    const material = this.makeMaterial(own.alpha);
    const variant: VelocityVariant = {
      key,
      parts: own,
      material,
      dummy: this.makeDummy(own, material),
      warm,
      items: [],
      count: 0,
      ready: false,
      failed: false,
      compiling: false,
      job: null,
    };
    this.variants.push(variant);
    this.byKey.set(key, variant);
    // A key first met in play starts compiling at once; its draws wait until it is linked.
    if (!warm) void this.compileVariant(variant);
    return variant;
  }

  private makeMaterial(alpha: boolean): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      name: 'fx.velocity',
      vertexShader: VELOCITY_VERT,
      fragmentShader: VELOCITY_FRAG,
      defines: alpha ? { VEL_ALPHA: '' } : {},
      uniforms: {
        // The same uniform objects in every variant: set once a frame.
        uPrevProjView: this.shared.uPrevProjView,
        uCut: this.shared.uCut,
        uPrev: { value: new THREE.Matrix4() },
        uCarry: { value: new THREE.Matrix4() },
        uMoving: { value: 0 },
        uAlphaMap: { value: null },
        uAlphaTest: { value: 0 },
      },
      // Compiled front-sided; each draw copies its source's side, which three does not key on at draw time.
      side: THREE.FrontSide,
      fog: false,
      lights: false,
    });
    // Test LessEqual, no depth write, nudged forward so the same surface passes in another program.
    geometryMaterialDefaults(m, true);
    // Movers are actors, drawn in every portal pass: the final depth already holds them wherever they show.
    m.stencilWrite = false;
    return m;
  }

  private makeDummy(p: VariantKeyParts, material: THREE.ShaderMaterial): THREE.Mesh {
    const shape = `${+p.skinned}|${p.morphs}|${+p.morphNormals}|${+p.morphColors}`;
    let g = this.dummyGeometries.get(shape);
    if (!g) {
      g = new THREE.BufferGeometry();
      // Normals and uvs like the converted packs, so the key compiled is the one a real mesh makes.
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
      if (p.skinned) {
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(12), 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
      }
      if (p.morphs > 0) {
        const list = () => Array.from({ length: p.morphs }, () => new THREE.Float32BufferAttribute(new Float32Array(9), 3));
        g.morphAttributes.position = list();
        if (p.morphNormals) g.morphAttributes.normal = list();
        if (p.morphColors) g.morphAttributes.color = list();
      }
      this.dummyGeometries.set(shape, g);
    }
    let mesh: THREE.Mesh;
    if (p.skinned) {
      const skinnedMesh = new THREE.SkinnedMesh(g, material);
      const bone = new THREE.Bone();
      skinnedMesh.add(bone);
      const skeleton = new THREE.Skeleton([bone]);
      skinnedMesh.bind(skeleton);
      skeleton.computeBoneTexture();
      this.dummySkeletons.push(skeleton);
      mesh = skinnedMesh;
    } else {
      mesh = new THREE.Mesh(g, material);
    }
    mesh.frustumCulled = false;
    mesh.name = `fx.velocity.dummy ${variantKey(p)}`;
    return mesh;
  }

  /** Build a variant's program without stalling a frame: it becomes ready once linked, or failed. */
  private compileVariant(variant: VelocityVariant): Promise<void> {
    if (variant.ready || variant.failed || this.disposed) return Promise.resolve();
    if (variant.job) return variant.job;
    variant.compiling = true;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    let job: Promise<unknown>;
    r.setRenderTarget(this.compileTarget);
    try {
      job = r.compileAsync(variant.dummy, FX_CAMERA);
    } catch (err) {
      job = Promise.reject(err);
    } finally {
      r.setRenderTarget(prev);
    }
    variant.job = job
      .then(() => {
        // compileAsync resolves once the program reports ready, even when linking failed.
        const props = r.properties.get(variant.material) as { currentProgram?: { getUniforms(): unknown; diagnostics?: { runnable: boolean } }; __version?: number };
        const program = props.currentProgram;
        program?.getUniforms();
        if (!program || program.diagnostics?.runnable === false) throw new Error('the program did not link');
        // The first real draw would otherwise work the program out again with that draw's `side`,
        // which is in the key: a double-sided mesh first would compile a second program mid-frame.
        // This is what three records after its own first draw with the program just built.
        props.__version = variant.material.version;
        variant.ready = true;
      })
      .catch((err) => {
        variant.failed = true;
        console.warn(`velocity: variant ${variant.key} failed to compile; its meshes blur with the camera only`, err);
      })
      .finally(() => {
        variant.compiling = false;
      });
    return variant.job;
  }

  /** Make and compile the variants these roots' meshes need (a dressed fighter or peer); resolves when each is ready or failed. */
  async prepareRoots(roots: readonly THREE.Object3D[]): Promise<void> {
    if (this.disposed || this.broken) return;
    const wanted = new Set<VelocityVariant>();
    const parts: VariantKeyParts = { skinned: false, morphs: 0, morphNormals: false, morphColors: false, alpha: false };
    const visit = (o: THREE.Object3D): void => {
      if (!eligibleMesh(o)) return;
      const g = o.geometry;
      parts.skinned = !!(o as THREE.SkinnedMesh).isSkinnedMesh;
      parts.morphs = morphCount(g);
      parts.morphNormals = !!g.morphAttributes.normal;
      parts.morphColors = !!g.morphAttributes.color;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!eligibleMaterial(m)) continue;
        parts.alpha = m.alphaTest > 0 && !!(m as THREE.MeshBasicMaterial).map;
        wanted.add(this.variantFor(parts, false));
      }
    };
    for (const root of roots) root.traverse(visit);
    await Promise.all([...wanted].map((v) => this.compileVariant(v)));
  }

  // --- the rest of the product ------------------------------------------------------------------

  materials(): FxWarmItem[] {
    // The warm variants only: the rest are prepared when a fighter or a peer is dressed, or first seen.
    const items: FxWarmItem[] = [];
    for (const v of this.variants) if (v.warm) items.push({ material: v.material, object: v.dummy, where: 'target' });
    return items;
  }

  /** Drop every record and listener: a new world, a teleport. */
  reset(): void {
    for (const rec of this.all) this.release(rec);
    this.all.length = 0;
    this.active.length = 0;
    this.candidates.length = 0;
    this.records.clear();
    for (const [g] of this.byGeometry) g.removeEventListener('dispose', this.onGeometryDispose);
    this.byGeometry.clear();
    for (const v of this.variants) {
      v.count = 0;
      v.items.length = 0;
    }
  }

  stats(withList: boolean): VelocityStats {
    let drawnMovers = 0;
    for (const rec of this.active) if (rec.drawn > 0) drawnMovers++;
    const cut = staticCut(this.lastFollowFar, { x: 0, y: 0 });
    const round = (v: number, k = 100) => (Number.isFinite(v) ? Math.round(v * k) / k : v);
    return {
      frame: this.frame,
      tracked: this.records.size,
      drawnMovers,
      draws: this.draws,
      carriedDraws: this.carriedDraws,
      waiting: this.waiting,
      scans: this.scans,
      cpuMs: round(this.cpuMs, 1000),
      empty: this.empty,
      followFar: round(this.lastFollowFar),
      cut: [round(cut.x), round(cut.y)],
      broken: this.broken,
      variants: this.variants.map((v) => ({ key: v.key, warm: v.warm, ready: v.ready, failed: v.failed })),
      list: withList
        ? this.active.map((rec) => ({
            kind: rec.kind,
            name: rec.name,
            carried: rec.carried,
            meshes: rec.states.length,
            drawable: rec.drawableCount,
            animated: rec.animated,
            drawn: rec.drawn,
            result: rec.result,
            speed: round(rec.speed),
            depth: round(rec.depth),
            px: round(rec.screenRadiusPx, 1),
          }))
        : [],
    };
  }

  /** One line for the chain's listing (`FxProduct.summary`; `describe` is taken by the heat product's stats object). */
  summary(): string {
    let drawnMovers = 0;
    for (const rec of this.active) if (rec.drawn > 0) drawnMovers++;
    const broken = this.broken ? `; broken: ${this.broken}` : '';
    return `${this.records.size} movers, ${drawnMovers} drawn, ${this.draws + this.carriedDraws} draws, ${this.waiting} waiting${broken}`;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    for (const v of this.variants) v.material.dispose();
    for (const g of this.dummyGeometries.values()) g.dispose();
    for (const s of this.dummySkeletons) s.dispose();
    this.variants.length = 0;
    this.byKey.clear();
    this.dummyGeometries.clear();
    this.dummySkeletons.length = 0;
    this.compileTarget.dispose();
    // The shared depth texture is detached before the target goes.
    super.dispose();
  }
}
