// The sixth of the port's private patches of three (pass 1, wave 4, item 2; `patchTable.ts`): a skinned body drawn on WebGPU
// reads its bones from the bone pool (`bonePool.ts`), one storage buffer written once a frame, in place of three's own skinning,
// which writes each skeleton's bones into a uniform array as long as its skeleton at every draw of every pass. Only where
// `patchApplies` says three is the revision it was read against; its switch is `GPU_KEYS.boneStorage` (read at load from
// `localStorage['swg.gpu.keys.boneStorage']`, moved live by `__debug.gpu({ bones })` or `gpu({ patches: { bones } })`).
//
// Every one of three's methods it reaches is wrapped on the live renderer, its node manager or its node library, never on a
// prototype, and three's own is called whole; none is copied:
//  - `NodeManager.getForRenderCacheKey`, where three takes a render object's key to its graph cache: for a pooled body the key
//    is three's own (`RenderObject.getCacheKey`) worked out with the skeleton read as "pooled" where three writes its bone
//    count, so bodies of every bone count share one graph, and a pooled body never shares one with an unpooled one. Worked
//    out once, at the object's first ask, and handed back at every later one (three's `NodeManager.delete` among them), as
//    three's own `initialCacheKey` is.
//  - `NodeLibrary.fromMaterial`, which hands every material built to its node builder (a classic material's node copy, three's
//    shadow material as the override, three's plain shadow nodes of `patchShadow.ts` included): one built for a pooled body is
//    given a `setupPosition` of its own, which runs three's `NodeMaterial.setupPosition` with the body read as unskinned (so
//    three's morph and the rest stand as three writes them) and then skins through the pool (`poolSkinning`). A body's material
//    moves no place before skinning would (`pooledFor` refuses a displacement map and a position node of its own), so three's
//    order (morph, then skin) is kept.
//  - `NodeManager._createNodeBuilderState`: a pooled graph's observer is told its object is not animated (three's rule refreshes
//    a skinned body in full at every draw, to write its bones), so it is refreshed by three's own comparison: its matrix moved,
//    its material or geometry changed.
//  - `NodeManager.needsRefresh`, three's question at every draw: a pooled body's skeleton is told it was drawn (`touch`, which
//    gives it a slot and writes it there and then where this frame's write did not reach it), and its render object refreshed in
//    full once where its slot moved since its per-object values were written.
// The per-object values (`setupPosition`'s graph): the slot's first matrix this frame and last, three's `bindMatrix`, and the
// inverse bind matrix relative to the body's root (`unbindInto`), so the program takes the pool's body-space bones back to the
// mesh's own space: three's arithmetic, its world-space bones replaced by body-space ones and its unbind by the relative one.

import * as THREE from 'three';
import { Fn, add, attribute, mat3, normalLocal, positionLocal, positionPrevious, reference, storage, tangentLocal, uniform } from 'three/tsl';
import { NodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import { BONES, BONE_IO, isPooledRO, markPooledRO, mirror, pooledFor, pooledRecord, releaseAll, slotBase, slotPrev, touch, unbindInto } from './bonePool.ts';
import { GPU_KEYS } from './gpuKeys.ts';
import { markBonesPrevious, motionBuild } from './motion.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Three's own `NodeMaterial.setupPosition`, which the pooled one runs first. */
const BASE_SETUP: (this: Any, builder: Any) => Any = (NodeMaterial.prototype as Any).setupPosition;

/** What a pooled body's key reads where three reads its skeleton's bone count (`RenderObject.getMaterialCacheKey`). */
const POOLED_SKELETON = Object.freeze({ bones: Object.freeze({ length: 'pooled' }) });

/** Whether the build three is making now is a pooled body's (set as its key is taken, read as its materials are handed over). */
const BUILDING = { pooled: false };
/** Node builders that skinned through the pool: their observers are told the object is not animated. */
const pooledBuilders = new WeakSet<object>();
/** Skinned render objects keyed by three's own key at their first ask (not pooled then), kept so for their life. */
const threeKeyed = new WeakSet<object>();
/** The renderer the patch was installed on (the live switch makes its bodies' render objects again). */
let installedOn: Any = null;

/** The pool's nodes, made once (`installBonePatch`) and shared by every pooled graph, as three's own model matrices are. */
let NODES: { pool: Any; base: Any; prev: Any; unbind: Any } | null = null;

function makeNodes(attr: Any): { pool: Any; base: Any; prev: Any; unbind: Any } {
  return {
    // A runtime-sized array in the program (three writes a storage buffer's length into none), so its size keys nothing.
    pool: storage(attr, 'mat4', attr.count).toReadOnly(),
    base: uniform(0, 'uint').onObjectUpdate(({ object }: Any) => slotBase(object)),
    prev: uniform(0, 'uint').onObjectUpdate(({ object }: Any) => slotPrev(object)),
    // Worked into the uniform's own matrix (nothing allocated) and handed back as it stands.
    unbind: uniform(new THREE.Matrix4()).onObjectUpdate(({ object }: Any, self: Any) => unbindInto(object, self.value)),
  };
}

/**
 * The pool's skinning: the four bones' body-space matrices read from this object's slot, blended by their weights, between
 * three's bind matrix and the inverse relative to the root; the place, the normal and the tangent carried by it, and last
 * frame's place by last frame's bones where three asks for it (motion).
 */
const poolSkinning: (object: Any) => Any = (Fn as Any)(([_object]: Any[], builder: Any) => {
  const n = NODES!;
  const joint = attribute('skinIndex', 'uvec4');
  const weight = attribute('skinWeight', 'vec4');
  // Three's own per-object reference to the drawn mesh's `bindMatrix` (no object named: the one drawn).
  const bind = (reference as Any)('bindMatrix', 'mat4');
  const blendAt = (first: Any): Any => add(n.pool.element(first.add(joint.x)).mul(weight.x), n.pool.element(first.add(joint.y)).mul(weight.y), n.pool.element(first.add(joint.z)).mul(weight.z), n.pool.element(first.add(joint.w)).mul(weight.w));
  // Pass 1, wave 5: the motion output (`motion.ts`) asks for last frame's place too, where it is built.
  if (builder.needsPreviousData() || motionBuild(builder)) {
    const before = n.unbind.mul(blendAt(n.prev)).mul(bind);
    positionPrevious.assign(before.mul(positionPrevious).xyz);
  }
  const skin = n.unbind.mul(blendAt(n.base)).mul(bind);
  positionLocal.assign(skin.mul(positionLocal).xyz);
  if (builder.hasGeometryAttribute('normal')) {
    const turn = mat3(skin);
    normalLocal.assign(turn.mul(normalLocal));
    if (builder.hasGeometryAttribute('tangent')) tangentLocal.assign(turn.mul(tangentLocal));
  }
}, 'void');

/**
 * A node material's own `setupPosition`, given to each material built for a pooled body: three's own with the body read as
 * unskinned for that call (its morph, its displacement, its instancing and its position node as three writes them), then the
 * pool's skinning. Any other object built with the same material takes three's own whole.
 */
function pooledSetupPosition(this: Any, builder: Any): Any {
  const object = builder.object;
  if (!pooledFor(object, this)) return BASE_SETUP.call(this, builder);
  object.isSkinnedMesh = false;
  let out: Any;
  try {
    out = BASE_SETUP.call(this, builder);
  } finally {
    object.isSkinnedMesh = true;
  }
  poolSkinning(object);
  pooledBuilders.add(builder);
  // Pass 1, wave 5: the motion output reads last frame's skinned place, which the skinning hands in where it is built. Told
  // here, as the material is set up: three builds a graph's fragment stage before its vertex stage, so a word left by the
  // skinning's own body (run as the vertex stage is built) came after the motion output had chosen.
  if (motionBuild(builder)) markBonesPrevious(builder);
  return out;
}

/** The patch on a live renderer (`patches.ts`, once `patchApplies` said yes). */
export function installBonePatch(renderer: Any): void {
  installedOn = renderer;
  const attr = new StorageBufferAttribute(mirror, 16);
  attr.name = 'swg bone pool';
  NODES = makeNodes(attr);
  const backend = renderer.backend;
  const queue = backend.device.queue;
  // The card's copy written from the mirror: only once three has made the buffer (at the first pooled draw's bindings, from
  // the mirror as it stands then), never through three's versions (an attribute three re-uploads whole when its version moves).
  BONE_IO.write = (at: number, count: number): void => {
    const buffer = backend.get(attr).buffer;
    if (buffer) queue.writeBuffer(buffer, at * 4, mirror, at, count);
  };
  const N = renderer._nodes;
  // The key three takes to its graph cache, with the bone count read as "pooled": worked out once a render object, at its
  // first ask (its build), and handed back at every later one. Three's own is the object's `initialCacheKey`, fixed when it
  // is made, and its delete asks again to take the graph out of the cache as the last user goes, which is when the scene's
  // environment key has moved (`RenderObjects.get` makes a body's render object again then): worked out afresh there, the
  // key named another graph, the old one stayed filed and a live one was taken out.
  const keyOf = N.getForRenderCacheKey.bind(N);
  N.getForRenderCacheKey = (ro: Any): Any => {
    const kept = pooledRecord(ro);
    if (kept !== undefined) {
      BUILDING.pooled = true;
      return kept.key;
    }
    const o = ro.object;
    // A body first keyed by three's own stays so for its life, whatever the switch says when it is let go.
    if (o.isSkinnedMesh !== true || threeKeyed.has(ro) || !pooledFor(o, ro.material)) {
      if (o.isSkinnedMesh === true) threeKeyed.add(ro);
      BUILDING.pooled = false;
      return keyOf(ro);
    }
    const sk = o.skeleton;
    o.skeleton = POOLED_SKELETON;
    let k: Any;
    try {
      k = ro.getCacheKey();
    } finally {
      o.skeleton = sk;
    }
    markPooledRO(ro, k);
    BUILDING.pooled = true;
    return k;
  };
  // Every material built for a pooled body skins through the pool.
  const lib = renderer.library;
  const fromMaterial = lib.fromMaterial.bind(lib);
  lib.fromMaterial = (m: Any): Any => {
    const nm = fromMaterial(m);
    if (BUILDING.pooled && nm && nm.setupPosition === BASE_SETUP) nm.setupPosition = pooledSetupPosition;
    return nm;
  };
  // A pooled graph is not refreshed in full at every draw.
  const makeState = N._createNodeBuilderState.bind(N);
  N._createNodeBuilderState = (nodeBuilder: Any): Any => {
    const state = makeState(nodeBuilder);
    if (pooledBuilders.has(nodeBuilder) && state?.observer) state.observer.hasAnimation = false;
    return state;
  };
  // At every draw: the skeleton drawn, slotted and written where this frame's write missed it; refreshed once where its slot moved.
  const ask = N.needsRefresh;
  N.needsRefresh = function (this: Any, ro: Any): number {
    const r = ask.call(this, ro);
    const o = ro.object;
    if (o.isSkinnedMesh !== true) return r;
    const p = pooledRecord(ro);
    if (p === undefined) return r;
    return touch(p, o.skeleton) ? 2 : r;
  };
  BONES.applied = true;
  BONES.why = '';
}

/**
 * The switch moved live: every skinned body's render object keyed the other way is let go of, and made again at its next draw
 * (the pipelines it builds there are the measure's); off, every slot is let go. Answers how many render objects were let go.
 */
export function setBonePool(on: boolean): number {
  if (GPU_KEYS.boneStorage === on) return 0;
  GPU_KEYS.boneStorage = on;
  if (!on) releaseAll();
  const set = installedOn?._objects?._renderObjects as Set<Any> | undefined;
  if (!set) return 0;
  const doomed: Any[] = [];
  for (const ro of set) {
    const o = ro.object;
    if (o?.isSkinnedMesh !== true) continue;
    if (isPooledRO(ro) !== pooledFor(o, ro.material)) doomed.push(ro);
  }
  for (const ro of doomed) ro.dispose();
  return doomed.length;
}
