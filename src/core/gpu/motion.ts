// One motion buffer (the GPU port's pass 1, wave 5; the design's section 7): with the effects on, every material's draw into
// the scene target also writes how far its pixel moved on the screen since the last frame, into a second output of the
// scene target (`motion`, RGBA16F), which wave 6's edge smoothing reads, and later the blur, the depth of field, the clouds,
// the fog cells and the screen-space light.
//
// What it writes, in three's own convention (`VelocityNode`: this frame's place in normalised device coordinates less last
// frame's, x and y, y up; three's `Reprojection.getHistoryUV` turns it into a history picture's place as `uv - v.xy * (0.5,
// -0.5)`), unjittered, in red and green; in blue the view distance this frame less last frame's, in metres (wave 6: the edge
// smoothing's depth test reads it, nought for the sky); and the reactive mark in alpha. A blend state has one rule for
// a target's colour and one for its alpha, so the reactive mark, which a see-through draw takes the larger of, is the alpha,
// and the motion, which it keeps, is the colour.
//
// How each thing's place last frame is had, none of it a place measured from the world's middle in a 32-bit number on the
// card (the design's section 11):
//   - **still things**: one matrix a frame, last frame's projection times last frame's view times this frame's inverse view,
//     worked in doubles here (`motionFrame`), applied to the view-space place three already draws with (`positionView`); the
//     two views' product is the camera's change, small however far out the camera stands, and nothing of an object's own;
//   - **what moves** (everything three refreshes because its world matrix moved: what `App.collectMovers` lists and anything
//     else that moves): its own change in this frame's view space, the view times its last world matrix times its inverse
//     now times the view's inverse, worked in doubles at the object's refresh (`moverDelta`), an object uniform three writes
//     only at a full refresh; with the frame it was worked for beside it (`moverStamp`), so the card takes it only on that
//     frame and a thing that stopped (which three does not refresh) reads as still with nothing written;
//   - **bodies**: the bone pool's previous half (`bonePool.ts`, `patchBones.ts`'s skinning hands in last frame's skinned place
//     where this output is built), its change from this frame's place turned into view space by the model-view's turn alone;
//   - **a material that moves its vertices by the clock or the camera** (sway, grass, the wind, the sea's swell and the far
//     rings' morph) hands in its own place last frame (`motionPrevious`), the far rings' today, the others with their remakes;
//   - **a mesh the game lays on the CPU each frame** (the grapple's rope, a rope hanging as a chain, another player's rope: their
//     vertices are written in place under a matrix that never moves, `laidMotion`): each vertex's place last frame less this
//     frame's, worked here once a frame from a kept copy of its positions and carried in an attribute of its own geometry, so
//     only a small difference reaches the card and the attribute's name keys its graph apart from the same material's others;
//   - **the sky** (`markMotion(material, 'sky')`): the camera's turn alone, its place taken as a direction.
// A see-through material (one three blends: `seeThrough`, three's own rule) keeps the motion behind it and marks itself
// reactive by how much it covers (its alpha; an additive one by its brightest channel), its motion output's colour blended
// nought and one and its alpha by the larger.
//
// Nothing here is loaded on the WebGL path. The patch that makes three draw it is `patchMotion.ts`.

import * as THREE from 'three';
import { BlendMode, Node } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { isStill } from './stillMark.ts';
import { unjitteredProjection } from './taa/taaJitter.ts';
import { SEE_NAME, seeBlendOf, seeOutputs } from '../../sky/air/airSee.ts';
import type { SeeKind } from '../../sky/air/airHazeMath.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { attribute, clamp, float, mat3, max, mix, modelViewMatrix, mrt, output, positionLocal, positionPrevious, positionView, renderGroup, select, uniform, varying, vec2, vec4 } = TSL as Any;

/** A switch read once at load: on unless this browser's storage says '0'; storage that throws, or none (node), reads as on. */
function readSwitch(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem('swg.gpu.motion') !== '0';
  } catch {
    return true;
  }
}

/**
 * The switch (`localStorage['swg.gpu.motion'] = '0'` and a reload leaves it off at load; `__debug.gpu({ motion: false })` moves
 * it live, which makes the effects chain again with a scene target of one output). Read where a chain's scene target is made.
 */
export const GPU_MOTION = { on: readSwitch() };

/** Whether the patch applied (`patchMotion.ts`, only where three is the revision it was read against), and why not. */
export const MOTION = { applied: false, why: '' as string };

/** Whether a new chain's scene target carries the motion output. */
export function motionWanted(): boolean {
  return GPU_MOTION.on && MOTION.applied;
}

/** What it has done, for `__debug.gpu()` and the census. */
export const MOTION_STATS = {
  /** Frames worked (`motionFrame`). */
  frames: 0,
  /** Scene targets made with the output. */
  targets: 0,
  /** Pipelines three made for a draw into a motion target, and of those the see-through ones. */
  pipelines: 0,
  seeThrough: 0,
  /** The see-through ones by material, the first few named (the census's "extra see-through pipelines"). */
  seeThroughNames: [] as string[],
  /** Graphs built, by what their motion output does. */
  built: { own: 0, behind: 0, sky: 0, bones: 0, handed: 0, laid: 0 },
  /** Moving objects' records made, and their changes worked (a full refresh's, once a frame an object). */
  records: 0,
  deltas: 0,
  /** Meshes the game lays on the CPU registered (`laidMotion`), and frames one of them was worked on. */
  laid: 0,
  laidFrames: 0,
};

// ---------------------------------------------------------------- the frame: the camera's change, in doubles

/** This frame's projection, unjittered: the game's own while the edge smoothing nudges the camera (wave 6, `taa/taaJitter.ts`). */
const P_NOW = new THREE.Matrix4();
/** Last frame's projection times last frame's view times this frame's inverse view: a view-space place to last frame's clip. */
const D_PREV = new THREE.Matrix4();
/** This frame's view and its inverse (the camera's world matrix), kept for the movers' changes. */
const V_NOW = new THREE.Matrix4();
const C_NOW = new THREE.Matrix4();
/** Last frame's, rolled at each frame. */
const V_LAST = new THREE.Matrix4();
const P_LAST = new THREE.Matrix4();
/** Scratch. */
const T1 = new THREE.Matrix4();
const T2 = new THREE.Matrix4();
let frameNo = 0;
let haveLast = false;

/** A vector a material's graph reads, its last-frame copy and the copy of it seen at the last frame. */
interface PrevRec {
  src: { value: Any };
  prev: Any;
  last: Any;
}
const prevRecs: PrevRec[] = [];
const prevBySource = new Map<object, PrevRec>();

/**
 * Once a game frame, before any pass draws (`PortalRenderer.render`): the camera's change since the last frame, worked in
 * doubles, and every last-frame copy a material reads rolled on. The first frame reads as still. Nothing allocated.
 */
export function motionFrame(camera: THREE.Camera): void {
  frameNo++;
  MOTION_STATS.frames++;
  P_NOW.copy(unjitteredProjection(camera));
  V_NOW.copy(camera.matrixWorldInverse);
  C_NOW.copy(camera.matrixWorld);
  if (!haveLast) {
    P_LAST.copy(P_NOW);
    V_LAST.copy(V_NOW);
    haveLast = true;
  }
  // The two views' product first (each carries the camera's place; the product only its change), then the projection.
  T1.multiplyMatrices(V_LAST, C_NOW);
  D_PREV.multiplyMatrices(P_LAST, T1);
  P_LAST.copy(P_NOW);
  V_LAST.copy(V_NOW);
  for (let i = 0; i < prevRecs.length; i++) {
    const r = prevRecs[i];
    r.prev.copy(r.last);
    r.last.copy(r.src.value);
  }
  // What the game laid on the CPU since the last frame (`laidMotion`); one whose mesh is gone is let go.
  for (let i = laidRecs.length - 1; i >= 0; i--) {
    const r = laidRecs[i];
    const mesh = r.mesh.deref();
    if (mesh === undefined) {
      laidRecs[i] = laidRecs[laidRecs.length - 1];
      laidRecs.pop();
      continue;
    }
    rollLaid(r, mesh);
  }
}

// ---------------------------------------------------------------- what the game lays on the CPU: each vertex's change

/** The attribute a laid mesh's geometry carries: each vertex's place last frame less this frame's, in the mesh's own space. */
export const LAID_ATTRIBUTE = 'swgMotionLaid';

/** A mesh whose positions the game writes in place each frame, with what they held at the last frame. */
interface LaidRec {
  /** Held weakly: a rope let go (another player gone, a course taken down) is forgotten here when it is collected. */
  mesh: WeakRef<THREE.Mesh>;
  /** The position attribute's own array, which the game lays. */
  src: Float32Array;
  /** What it held at the last frame. */
  last: Float32Array;
  /** Last frame's place less this frame's: the attribute's array. */
  delta: Float32Array;
  attr: THREE.BufferAttribute;
  /** It was drawn at the last frame, with the draw range it has now: only then is its last place this one's. */
  shown: boolean;
  count: number;
}
const laidRecs: LaidRec[] = [];

/**
 * A mesh whose vertices the game lays on the CPU each frame in its own space, under a matrix that does not carry that motion
 * (a rope's strip: `RopeRibbon`, `ChainRibbon`), registered once as it is made, before its first draw: its geometry gets the
 * attribute the motion output reads (`LAID_ATTRIBUTE`, in three's key, so its graph is its own), and each frame its change is
 * worked from a kept copy. `positions` is the array of its position attribute that the game writes. The first frame it is drawn,
 * the first after it was hidden or taken out of the scene, and a frame its draw range changed (a ring added, a hand put on the
 * rope, so a vertex is not last frame's) read as still, never as a jump.
 */
export function laidMotion(mesh: THREE.Mesh, positions: Float32Array): void {
  const g = mesh.geometry;
  if (g.getAttribute(LAID_ATTRIBUTE) !== undefined) return;
  const delta = new Float32Array(positions.length);
  const attr = new THREE.BufferAttribute(delta, 3);
  g.setAttribute(LAID_ATTRIBUTE, attr);
  laidRecs.push({ mesh: new WeakRef(mesh), src: positions, last: new Float32Array(positions.length), delta, attr, shown: false, count: -1 });
  MOTION_STATS.laid++;
}

/** One laid mesh brought to this frame (`motionFrame`). Nothing allocated. */
function rollLaid(r: LaidRec, mesh: THREE.Mesh): void {
  if (!mesh.visible || mesh.parent === null || !motionWanted()) {
    r.shown = false;
    return;
  }
  const count = mesh.geometry.drawRange.count;
  const src = r.src;
  const last = r.last;
  const d = r.delta;
  const n = src.length;
  if (!r.shown || count !== r.count) {
    for (let k = 0; k < n; k++) {
      d[k] = 0;
      last[k] = src[k];
    }
  } else {
    for (let k = 0; k < n; k++) {
      const s = src[k];
      d[k] = last[k] - s;
      last[k] = s;
    }
  }
  r.shown = true;
  r.count = count;
  r.attr.needsUpdate = true;
  MOTION_STATS.laidFrames++;
}

/** The frame number `motionFrame` keeps (the tests). */
export function motionFrameNo(): number {
  return frameNo;
}

/** The frame's matrices, for the tests and the console: copies into `out`. */
export function motionMatrices(out: { pNow: THREE.Matrix4; dPrev: THREE.Matrix4 }): void {
  out.pNow.copy(P_NOW);
  out.dPrev.copy(D_PREV);
}

/**
 * A uniform reading last frame's value of a vector a material's graph reads (`{ value }`, a `Vector2`, `3` or `4`): a copy
 * kept here and rolled at each frame, one a source however many graphs ask (`motionPrevious`'s helpers).
 */
export function previousUniform(src: { value: Any }): Any {
  let r = prevBySource.get(src);
  if (!r) {
    r = { src, prev: src.value.clone(), last: src.value.clone() };
    prevBySource.set(src, r);
    prevRecs.push(r);
  }
  return uniform(r.prev).setGroup(renderGroup);
}

// ---------------------------------------------------------------- what moves: its own change, at its refresh

/** An object three refreshed in full: its world matrix at the last frame it was refreshed and the one before, and its change. */
interface MoverRec {
  now: THREE.Matrix4;
  /** Made the first time it moves (most things refreshed once, at their first draw, never move). */
  prev: THREE.Matrix4 | null;
  /** The frame `now` was taken on. */
  frame: number;
  /** It moved between that frame and the one before it (the two taken on consecutive frames). */
  moving: boolean;
  /** Its change in this frame's view space: view × last world × world now⁻¹ × view⁻¹ (made with `prev`). */
  w: THREE.Matrix4 | null;
}
const movers = new WeakMap<object, MoverRec>();
/** What a thing the bundles hold still reads: it never moves (`stillMark.ts`), so it keeps no record. */
const STILL_REC: MoverRec = { now: new THREE.Matrix4(), prev: null, frame: -1, moving: false, w: null };

/** Whether a matrix holds these sixteen numbers, element by element. */
function same(a: THREE.Matrix4, y: ArrayLike<number>): boolean {
  const x = a.elements;
  for (let i = 0; i < 16; i++) if (x[i] !== y[i]) return false;
  return true;
}

/**
 * An object's record brought to this frame: taken once a frame, at the first of its refreshes (three refreshes an object in
 * full when its world matrix moved since its last draw, and at its first). Its last frame's matrix is known only where it was
 * taken on the frame before; otherwise (its first frame, the first frame it moves after standing, a frame it comes back after
 * being hidden) it reads as still, never as a jump from where it last stood. Allocates only the first time an object is met.
 */
function moverRecord(object: Any): MoverRec {
  if (isStill(object)) return STILL_REC;
  const f = frameNo;
  let r = movers.get(object);
  if (r === undefined) {
    r = { now: new THREE.Matrix4().copy(object.matrixWorld), prev: null, frame: f, moving: false, w: null };
    movers.set(object, r);
    MOTION_STATS.records++;
    return r;
  }
  if (r.frame === f) return r;
  const continuous = r.frame === f - 1;
  r.frame = f;
  if (same(r.now, object.matrixWorld.elements)) {
    r.moving = false;
    return r;
  }
  if (r.prev === null) {
    r.prev = new THREE.Matrix4();
    r.w = new THREE.Matrix4();
  }
  r.prev.copy(r.now);
  r.now.copy(object.matrixWorld);
  r.moving = continuous;
  if (r.moving) {
    // world now⁻¹, then last world × it (a change near the identity, its translation the difference of two places, exact in
    // doubles), then into this frame's view: view × that × view⁻¹.
    T1.copy(r.now).invert();
    T2.multiplyMatrices(r.prev, T1);
    T1.multiplyMatrices(V_NOW, T2);
    r.w!.multiplyMatrices(T1, C_NOW);
    MOTION_STATS.deltas++;
  }
  return r;
}

/** The object uniform's update: its change this frame (the identity where it is still). Written into `out`; nothing allocated. */
export function moverDelta(object: Any, out: THREE.Matrix4): void {
  const r = moverRecord(object);
  if (r.moving) out.copy(r.w!);
  else out.identity();
}

/** The frame the change was worked for (nought where it is still): the card takes the change only on that frame. */
export function moverStamp(object: Any): number {
  const r = moverRecord(object);
  return r.moving ? r.frame : 0;
}

// ---------------------------------------------------------------- the materials' marks

export type MotionKind = 'sky';

const kinds = new WeakMap<object, MotionKind>();
const providers = new WeakMap<object, () => Any>();

/** A material whose motion is the camera's turn alone (the sky's dome, a sphere about the camera). */
export function markMotion<M extends object>(material: M, kind: MotionKind): M {
  kinds.set(material, kind);
  return material;
}

/**
 * A material that moves its vertices by the clock or the camera hands in its place last frame, in the object's own space as
 * its `positionNode` hands three the place now (a node built in the vertex stage, carried to the fragment).
 */
export function motionPrevious<M extends object>(material: M, previous: () => Any): M {
  providers.set(material, previous);
  return material;
}

/** A stand-in's marks given to the material it stands in for (`fallback.ts`: three builds the original's key and graph). */
export function adoptMotion(original: object, standIn: object): void {
  const k = kinds.get(standIn);
  if (k !== undefined) kinds.set(original, k);
  const p = providers.get(standIn);
  if (p !== undefined) providers.set(original, p);
}

/**
 * Whether three blends a material's colour: its own rule (`WebGPUPipelineUtils.createRenderPipeline`'s `materialBlending`),
 * which reads only the material's blending and transparency, both in the pipeline's key.
 */
export function seeThrough(m: Any): boolean {
  return m.blending !== THREE.NoBlending && (m.blending !== THREE.NormalBlending || m.transparent !== false);
}

/** What a material's motion output does, read off the material three keys the draw on (the classic one, never its node copy). */
export interface MotionPlan {
  /** 'own': it writes its motion; 'behind': it keeps the motion behind it and marks itself reactive; 'none': it writes nothing at all. */
  writes: 'own' | 'behind' | 'none';
  /**
   * How its last place is had: still or moved (`rigid`, the object's change on top), skinned by the pool, handed in by its
   * material, laid on the CPU (each vertex's change in its geometry, the object's change on top), or the sky.
   */
  previous: 'rigid' | 'bones' | 'handed' | 'laid' | 'sky' | '-';
  /** What its reactive mark reads: nought, its alpha, or its brightest channel times its alpha (additive). */
  reactive: 'none' | 'alpha' | 'additive' | 'additive premultiplied';
  /** The motion output's blend: overwritten, or kept with the larger reactive. */
  blend: 'none' | 'keep, larger reactive';
}

/**
 * The plan for one draw (the node test lists one per kind of material): `material` the one three keys and blends the draw on,
 * `pooled` whether the pool skins it with last frame's bones handed in, `laid` whether its geometry carries each vertex's change
 * laid on the CPU (`laidMotion`; the attribute's name is in three's key, so two draws filed under one graph agree on it).
 */
export function motionPlan(material: Any, pooled: boolean, laid = false): MotionPlan {
  if (material.colorWrite === false) return { writes: 'none', previous: '-', reactive: 'none', blend: seeThrough(material) ? 'keep, larger reactive' : 'none' };
  if (seeThrough(material)) {
    const add = material.blending === THREE.AdditiveBlending;
    return { writes: 'behind', previous: '-', reactive: add ? (material.premultipliedAlpha === true ? 'additive premultiplied' : 'additive') : 'alpha', blend: 'keep, larger reactive' };
  }
  const k = kinds.get(material);
  if (k === 'sky') return { writes: 'own', previous: 'sky', reactive: 'none', blend: 'none' };
  if (pooled) return { writes: 'own', previous: 'bones', reactive: 'none', blend: 'none' };
  if (laid) return { writes: 'own', previous: 'laid', reactive: 'none', blend: 'none' };
  if (providers.has(material)) return { writes: 'own', previous: 'handed', reactive: 'none', blend: 'none' };
  return { writes: 'own', previous: 'rigid', reactive: 'none', blend: 'none' };
}

/** Whether a build's geometry carries the laid change (`laidMotion`). */
function laidGeometry(builder: Any): boolean {
  return builder?.geometry?.attributes?.[LAID_ATTRIBUTE] !== undefined;
}

// ---------------------------------------------------------------- the graph

/** Node builders whose skinning handed in last frame's place (`patchBones.ts`, where this output is built). */
const bonesBuilders = new WeakSet<object>();

/** Whether a build is one this output is part of: the renderer's multi-output node is ours (`patchMotion.ts` sets it with the target). */
export function motionBuild(builder: Any): boolean {
  return MRT_NODE !== null && builder?.renderer?.getMRT?.() === MRT_NODE;
}

/** The pool's skinning handed this build last frame's skinned place in `positionPrevious`. */
export function markBonesPrevious(builder: Any): void {
  bonesBuilders.add(builder);
}

/** The frame's uniforms, made once and shared by every graph (three's own model matrices are shared the same way). */
let NODES: { pNow: Any; dPrev: Any; frame: Any; w: Any; stamp: Any } | null = null;

function nodes(): { pNow: Any; dPrev: Any; frame: Any; w: Any; stamp: Any } {
  if (NODES) return NODES;
  NODES = {
    // In the shared render group, written once a render by reference: the frame's matrices are worked once a frame here.
    pNow: uniform(P_NOW).setGroup(renderGroup),
    dPrev: uniform(D_PREV).setGroup(renderGroup),
    frame: uniform(0, 'uint').setGroup(renderGroup).onRenderUpdate(() => frameNo),
    // In the object group, written by three only at an object's full refresh (its world matrix moved, its first draw).
    w: uniform(new THREE.Matrix4()).onObjectUpdate(({ object }: Any, self: Any) => {
      moverDelta(object, self.value);
    }),
    stamp: uniform(0, 'uint').onObjectUpdate(({ object }: Any) => moverStamp(object)),
  };
  return NODES;
}

/** This frame's place less last frame's, in normalised device coordinates (nought where either is behind its camera). */
function ndcLess(cur: Any, prev: Any): Any {
  const ok = cur.w.greaterThan(1e-6).and(prev.w.greaterThan(1e-6));
  return select(ok, cur.xy.div(cur.w).sub(prev.xy.div(prev.w)), vec2(0, 0));
}

/**
 * The motion output of a surface: its place in normalised device coordinates less last frame's, and in blue its view distance
 * this frame less last frame's (a perspective clip's w is the view distance), in metres, nought where either is behind its camera
 * (wave 6: the edge smoothing's depth test takes last frame's distance of the surface found here as this frame's less it).
 */
function surfaceMotion(cur: Any, prev: Any): Any {
  const ok = cur.w.greaterThan(1e-6).and(prev.w.greaterThan(1e-6));
  return vec4(ndcLess(cur, prev), select(ok, cur.w.sub(prev.w), float(0)), 0);
}

/** The reactive mark of a see-through material: how much of what is behind it the draw covers. */
function reactiveOf(material: Any): Any {
  const o = vec4(output);
  const a = clamp(o.a, 0, 1);
  if (material.blending !== THREE.AdditiveBlending) return a;
  const bright = max(o.r, max(o.g, o.b));
  return clamp(material.premultipliedAlpha === true ? bright : bright.mul(o.a), 0, 1);
}

/** The motion output's graph for one build (`builder.material` the classic material three keys the draw on). */
function motionGraph(builder: Any): Any {
  const material = builder.material;
  const plan = motionPlan(material, bonesBuilders.has(builder), laidGeometry(builder));
  if (plan.writes === 'behind') {
    MOTION_STATS.built.behind++;
    // The colour blended nought and one keeps what is behind; the alpha takes the larger reactive.
    return vec4(0, 0, 0, reactiveOf(material));
  }
  if (plan.writes === 'none') return vec4(0, 0, 0, 0);
  const n = nodes();
  const pv = positionView;
  if (plan.previous === 'sky') {
    MOTION_STATS.built.sky++;
    // A direction: the translation of last frame's view against this one's drops out, the camera's turn stays.
    return vec4(ndcLess(n.pNow.mul(vec4(pv, 0)), n.dPrev.mul(vec4(pv, 0))), 0, 0);
  }
  MOTION_STATS.built.own++;
  let before: Any = pv;
  if (plan.previous === 'bones') {
    MOTION_STATS.built.bones++;
    // Last frame's skinned place less this frame's, in the mesh's own space, turned into view space by the model-view's turn
    // alone (its upper three rows and columns carry no place): nothing measured from the world's middle.
    before = pv.add(mat3(modelViewMatrix).mul(positionPrevious.sub(positionLocal)));
  } else if (plan.previous === 'handed') {
    MOTION_STATS.built.handed++;
    const handed = varying(providers.get(material)!(), 'swgMotionPrevious');
    before = pv.add(mat3(modelViewMatrix).mul(handed.sub(positionLocal)));
  } else if (plan.previous === 'laid') {
    MOTION_STATS.built.laid++;
    // Each vertex's change laid on the CPU, in the mesh's own space, turned into view space by the model-view's turn alone.
    before = pv.add(varying(mat3(modelViewMatrix).mul(attribute(LAID_ATTRIBUTE, 'vec3')), 'swgMotionLaidView'));
  }
  // The object's own change this frame, taken only where it was worked for this very frame.
  const on = select(n.stamp.equal(n.frame), float(1), float(0));
  const moved = mix(before, n.w.mul(vec4(before, 1)).xyz, on);
  return surfaceMotion(n.pNow.mul(vec4(pv, 1)), n.dPrev.mul(vec4(moved, 1)));
}

/** The motion output: a node whose graph is worked out per build, from the material and object being built. */
class MotionNode extends Node {
  static get type(): string {
    return 'SwgMotionNode';
  }
  constructor() {
    super('vec4');
  }
  setup(builder: Any): Any {
    return motionGraph(builder);
  }
}

// ---------------------------------------------------------------- the multi-output node and its blends

/** The motion output kept (nought and one on its colour) with the larger reactive (the alpha's max). */
const KEEP_BEHIND: Any = (() => {
  const b = new BlendMode(THREE.CustomBlending) as Any;
  b.blendSrc = THREE.ZeroFactor;
  b.blendDst = THREE.OneFactor;
  b.blendEquation = THREE.AddEquation;
  b.blendSrcAlpha = THREE.OneFactor;
  b.blendDstAlpha = THREE.OneFactor;
  b.blendEquationAlpha = THREE.MaxEquation;
  return b;
})();
const OVERWRITE: Any = new BlendMode(THREE.NoBlending);
const AS_MATERIAL: Any = new BlendMode(THREE.MaterialBlending);

/**
 * Whether the pipeline three is making now is a see-through material's (`patchMotion.ts`'s wrap of
 * `WebGPUPipelineUtils.createRenderPipeline`, set for the synchronous part of the call in which three reads each output's blend),
 * and how it goes into our sky's see-through layer (pass 2, wave 1, `src/sky/air/airSee.ts`).
 */
export const PIPELINE_NOW = { seeThrough: false, see: 'solid' as SeeKind };

/** The renderer's multi-output node while a motion target is drawn into: made once (`motionMrt`). */
let MRT_NODE: Any = null;

/**
 * The multi-output node: the colour as three names it (the scene target's first texture, `fx.scene`, blended as its material
 * blends) and `motion`, cleared to nought, overwritten by what writes its own motion and kept with the larger reactive by
 * what is see-through (three reads each output's blend off the render context's node as it makes a pipeline).
 */
export function motionMrt(): Any {
  if (MRT_NODE) return MRT_NODE;
  // Pass 2, wave 1: our sky's see-through layer rides this node (`airSee.ts`): the colour target's own entry and the layer's,
  // each inert into a target that carries no layer (SWG's sky, the motion off), where the colour is drawn exactly as before.
  const node = mrt({ motion: new MotionNode(), ...seeOutputs(SCENE_COLOUR_NAME) }) as Any;
  node.setClearColor('motion', 0x000000, 0);
  node.setClearColor(SEE_NAME, 0x000000, 1);
  node.getBlendMode = (name: string): Any => (name === 'motion' ? (PIPELINE_NOW.seeThrough ? KEEP_BEHIND : OVERWRITE) : name === SEE_NAME ? seeBlendOf(PIPELINE_NOW.see) : AS_MATERIAL);
  MRT_NODE = node;
  return node;
}

/** The scene target's colour texture's name (`PostFX` names it), the entry three merges the renderer's node over. */
const SCENE_COLOUR_NAME = 'fx.scene';

/** The blends the pipeline reads, for the node test. */
export const MOTION_BLENDS = { keepBehind: KEEP_BEHIND, overwrite: OVERWRITE, asMaterial: AS_MATERIAL };

// ---------------------------------------------------------------- the targets

/** Scene targets that carry the motion output: the renderer's multi-output node follows a target set to one of these. */
const targets = new WeakSet<object>();
/** Each such target's colour texture to its motion texture (the view reads it off the frame's context). */
const motionOf = new WeakMap<object, THREE.Texture>();

/** A new chain's scene target made with the output (`GpuChain.sceneTarget`): its second texture named for the node's output. */
export function markMotionTarget(t: THREE.RenderTarget): void {
  const m = t.textures[1];
  m.name = 'motion';
  targets.add(t);
  motionOf.set(t.texture, m);
  newest = t;
  MOTION_STATS.targets++;
}

/** The newest scene target made with the output (the console's and a prover's read-back: its second texture is the buffer). */
let newest: THREE.RenderTarget | null = null;
export function motionTargetNow(): THREE.RenderTarget | null {
  return newest;
}

export function isMotionTarget(t: unknown): boolean {
  return t !== null && t !== undefined && targets.has(t as object);
}

/** The motion texture beside a scene target's colour texture, or null. */
export function motionTextureOf(colour: THREE.Texture | null): THREE.Texture | null {
  return colour ? (motionOf.get(colour) ?? null) : null;
}

/**
 * A node material whose whole fragment is its own (`fragmentNode`: the step's programs, `gpuPrograms.ts`, and a part left out at
 * load): three writes the multi-output node only round a material's colour (`NodeMaterial.setup`), so where this output is
 * built the fragment's colour is named and the node merged in as three merges it, and every target of the pipeline is written.
 */
export function withMotionOutput<M extends object>(m: M): M {
  (m as Any).setupOutput = function (this: Any, builder: Any, outputNode: Any): Any {
    const out = Object.getPrototypeOf(this).setupOutput.call(this, builder, outputNode);
    if (this.fragmentNode === null || !motionBuild(builder) || out?.isOutputStructNode === true) return out;
    const target = builder.renderer.getRenderTarget();
    if (target === null) return out;
    output.assign(out);
    return mrt({ [target.texture.name]: output }).merge(MRT_NODE);
  };
  return m;
}

/**
 * The console's view of the buffer (`__debug.gpu({ view: 'motion' })`, drawn by the output pass in place of the picture,
 * `gpuChain.ts`'s `motionViewGraph`): the motion as colour (red rightward, green upward, mid grey for none, full at `pixels`
 * pixels a frame), the reactive mark as brightness (half bright unmarked, full bright marked). A tool to look with, no look.
 */
export const MOTION_VIEW = { on: false, pixels: 16 };

/** What `__debug.gpu()` says of it. */
export function motionReport(): Record<string, unknown> {
  return {
    on: GPU_MOTION.on,
    applied: MOTION.applied,
    ...(MOTION.why ? { why: MOTION.why } : {}),
    does: "with the effects on, every draw into the scene target writes its pixel's motion since the last frame into a second output (RGBA16F: this frame's place in normalised device coordinates less last frame's in red and green, three's convention, unjittered; the view distance this frame less last frame's in blue, metres; the reactive mark in alpha): still things by the camera's change worked once a frame in doubles, what moved by its own change worked at its refresh, bodies by the bone pool's last half, a rope laid on the CPU by each vertex's change, the sky by the camera's turn; see-through things keep the motion behind them and mark themselves reactive",
    switch: "__debug.gpu({ motion: false }) live (the effects chain is made again, its scene target of one output), or localStorage['swg.gpu.motion'] = '0' and a reload; __debug.gpu({ view: 'motion' }) draws the buffer, 'off' the picture again",
    frames: MOTION_STATS.frames,
    targets: MOTION_STATS.targets,
    pipelines: { made: MOTION_STATS.pipelines, seeThrough: MOTION_STATS.seeThrough, seeThroughNamed: [...MOTION_STATS.seeThroughNames] },
    graphs: { ...MOTION_STATS.built },
    movers: { records: MOTION_STATS.records, changesWorked: MOTION_STATS.deltas },
    laid: { meshes: laidRecs.length, registered: MOTION_STATS.laid, framesWorked: MOTION_STATS.laidFrames, does: "a mesh the game lays on the CPU each frame (a rope's strip) carries each vertex's place last frame less this frame's in an attribute of its own, worked here once a frame" },
  };
}

/** The census's part (`__debug.gpu({ keys })`): the pipelines made for a motion target, the see-through ones named. */
export function motionCensus(): Record<string, unknown> {
  return {
    on: motionWanted(),
    pipelinesMade: MOTION_STATS.pipelines,
    seeThrough: MOTION_STATS.seeThrough,
    seeThroughNamed: [...MOTION_STATS.seeThroughNames],
    note: "a see-through pipeline's motion output blends otherwise than an opaque one's, but its key already differs by the material's blending and transparency, so no pipeline is added for it",
  };
}

/** For the node tests: a fresh frame state (the first frame next), the switch on, not applied. */
export function resetMotionForTests(): void {
  frameNo = 0;
  haveLast = false;
  P_NOW.identity();
  D_PREV.identity();
  V_NOW.identity();
  C_NOW.identity();
  V_LAST.identity();
  P_LAST.identity();
  prevRecs.length = 0;
  prevBySource.clear();
  laidRecs.length = 0;
  MOTION_STATS.laid = 0;
  MOTION_STATS.laidFrames = 0;
  MOTION.applied = false;
  MOTION.why = '';
  GPU_MOTION.on = true;
  PIPELINE_NOW.seeThrough = false;
  MOTION_STATS.frames = 0;
  MOTION_STATS.targets = 0;
  MOTION_STATS.pipelines = 0;
  MOTION_STATS.seeThrough = 0;
  MOTION_STATS.seeThroughNames.length = 0;
  MOTION_STATS.records = 0;
  MOTION_STATS.deltas = 0;
  for (const k of Object.keys(MOTION_STATS.built) as (keyof typeof MOTION_STATS.built)[]) MOTION_STATS.built[k] = 0;
}
