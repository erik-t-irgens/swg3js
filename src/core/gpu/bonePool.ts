// The bone pool (the GPU port's pass 1, wave 4, item 2): on WebGPU every body's bones in one storage buffer, written once a
// frame, so three keys no pipeline on a skeleton's bone count and refreshes no body in full at every draw.
//
// Why: three 0.187 writes a skinned body's bone matrices into a uniform array as long as its skeleton (so the bone count is in
// its program and its key: `RenderObject.getMaterialCacheKey`), and its observer calls every skinned body animated
// (`NodeMaterialObserver.hasAnimation`), so each is refreshed in full, its bones written again, at every draw of every pass and
// cascade. Here the bones are written once a frame for every pass to read, and the program reads them through a slot.
//
// What this file is: the pool itself, three-free beyond `three`'s core, so node runs it as it stands. The patch that makes
// three draw a body through it is `patchBones.ts` (the sixth private patch, "bones").
//  - **A slot** a skeleton: this frame's bones, then last frame's, each its bones' count rounded up to sixteen matrices
//    (`slotSize`), taken from a free list of its size or the pool's top. Every matrix is body space, the anchor-relative rule
//    of the design's section 11: the body root's world matrix inverted, times the bone's world matrix, times its inverse bind
//    matrix, worked in doubles (`rootInv`, `mul`) and written as floats. The root is the parent of the skeleton's top bone.
//  - **Who is written**: every skeleton a draw met last frame (`touch`, from the patch's wrap of three's refresh question),
//    in `frame`, once the frame's one walk of the scene's matrices is done (`PortalRenderer.walkOnce`) and before any pass;
//    current copied to previous first, so a body in motion carries last frame's bones beside this frame's. A body still since
//    its last write is written once more (previous then equal to current) and then skipped. One `writeBuffer` a frame covers
//    every slot written.
//  - **A body met by a draw that this frame's write did not reach** (new, or drawn by no pass last frame): written there and
//    then (`touch`), previous equal to current, so nothing smears on its reappearing; one small write of its own slot.
//  - **A skeleton no draw has met for `keepFrames` frames** lets its slot go; met again it takes a new one, and its render
//    objects are refreshed in full once (the slot is a per-object value, `epoch`).
//  - **What is not touched**: three's skeleton, its bones and their matrices. The CPU's readers (the rest pose, the saddles,
//    the aim, the ragdolls, the cull spheres) and the previews read them as before; on WebGL nothing of this runs.

import * as THREE from 'three';
import { GPU_KEYS } from './gpuKeys.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The pool's numbers (ours; none of feel). */
export const BONE_POOL_TUNE = {
  /** Matrices the buffer holds (4 MB): a 53-bone body takes 128, so about 500 bodies drawn at once. */
  matrices: 65536,
  /** Frames a skeleton may go undrawn before its slot is let go (about two seconds at sixty a frame). */
  keepFrames: 120,
};

/** Matrices at the buffer's head kept as the identity: where a body with no slot reads (a pool full past eviction). */
export const RESERVED = 256;

/** The pool's state: on (the switch, `GPU_KEYS.boneStorage`) and applied (the patch, only where three is the revision). */
export const BONES = { applied: false, why: '' as string };

/** What it has done, for `__debug.gpu()`. */
export const BONE_STATS = {
  /** Skeletons holding a slot now, and slots taken and let go all told. */
  live: 0,
  slotted: 0,
  released: 0,
  evicted: 0,
  /** Draws that found the pool full and no slot to evict (the body read the identity: its rest pose). */
  overflow: 0,
  /** The last frame's: skeletons written, skipped as still, written late by a draw, and the bytes and calls sent. */
  written: 0,
  still: 0,
  late: 0,
  bytes: 0,
  calls: 0,
  /** All told. */
  frames: 0,
  lateAll: 0,
  bytesAll: 0,
  /** Render objects keyed as pooled. */
  pooledObjects: 0,
};

/** A skeleton's place in the pool. */
export interface SkelRec {
  skeleton: THREE.Skeleton;
  /** The object whose world matrix is body space's origin: the parent of the skeleton's top bone (null: the world's). */
  root: THREE.Object3D | null;
  /** Bones. */
  n: number;
  /** Matrices a half of its slot holds (the bones rounded up to sixteen). */
  size: number;
  /** The slot's first matrix (this frame's bones; last frame's at `base + size`), -1 with none. */
  base: number;
  /** Moved each time its slot changes: its render objects read the slot as a per-object value, so each is refreshed once. */
  epoch: number;
  /** The pool frame a draw last met it, and the frame it was last written. */
  drawn: number;
  written: number;
  /** Whether the card's previous half equals its current one. */
  prevSame: boolean;
  /** Its place in `live` (-1 with no slot). */
  at: number;
}

/** A render object keyed as pooled: its skeleton's record and the slot epoch its per-object values were last written under. */
export interface PooledObject {
  rec: SkelRec | null;
  seen: number;
  /**
   * The key its graph is cached under (`patchBones.ts`), worked out at its first ask and handed back at every later one, as
   * three hands back its own `initialCacheKey`: three's delete asks again as it lets the graph go, after the scene's
   * environment moved (or the switch did), and must be told the key the graph was filed under.
   */
  key: unknown;
}

/** The buffer's contents on the CPU: every slot as floats, the card's copy written from it. */
export let mirror = new Float32Array(BONE_POOL_TUNE.matrices * 16);
/** The pool's frame: moved once a frame by `frame`. */
let frameNo = 0;
/** Skeletons holding a slot. */
const live: SkelRec[] = [];
const recOf = new WeakMap<THREE.Skeleton, SkelRec>();
/** Render objects keyed as pooled (`patchBones.ts`'s key). */
const pooledRO = new WeakMap<object, PooledObject>();
/** Free slots by size, and the pool's top (matrices). */
const free = new Map<number, number[]>();
let top = RESERVED;
/** The card's side: writes `count` floats of the mirror from float `at` (null before the patch has its buffer, or in node). */
export const BONE_IO: { write: ((at: number, count: number) => void) | null } = { write: null };

/** Scratch: the root's inverse and one product, in doubles. */
const rootInv = new THREE.Matrix4();
const t = new Float64Array(16);
const ID = new THREE.Matrix4().elements;
/** The frame's dirty span of the mirror (floats). */
let lo = 0;
let hi = 0;

function fillIdentity(from: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const o = (from + i) * 16;
    for (let k = 0; k < 16; k++) mirror[o + k] = k % 5 === 0 ? 1 : 0;
  }
}
fillIdentity(0, RESERVED);

/** Matrices a half of a slot holds for `n` bones (rounded up to sixteen, so slots of nearby counts share a free list). */
export function slotSize(n: number): number {
  return Math.max(16, Math.ceil(n / 16) * 16);
}

/** The object body space is measured from: the parent of the skeleton's top bone, or null. Nothing allocated. */
export function rootOf(skeleton: THREE.Skeleton): THREE.Object3D | null {
  let b: THREE.Object3D | null = skeleton.bones[0] ?? null;
  if (!b) return null;
  while (b.parent && (b.parent as THREE.Bone).isBone) b = b.parent;
  return b.parent;
}

/** Whether the pool is drawn through now (the switch on and the patch applied). */
export function poolOn(): boolean {
  return BONES.applied && GPU_KEYS.boneStorage;
}

/**
 * Whether three draws this object through the pool, with the material it is drawn in: a skinned mesh with a skeleton, while
 * the pool is on, but for a self-test's own and a material that moves its places before skinning would (a displacement map,
 * a position node of its own: the pool's skinning comes after three's own setup, which for a body is its morph alone).
 */
export function pooledWith(object: Any, displacementMap: unknown, positionNode: unknown): boolean {
  return object.isSkinnedMesh === true && !!object.skeleton && poolOn() && object.userData?.swgSelfTest !== true && !displacementMap && (positionNode === null || positionNode === undefined);
}

export function pooledFor(object: Any, material: Any): boolean {
  return pooledWith(object, material?.displacementMap, material?.positionNode);
}

/** Whether a render object was keyed as pooled (the key census and the ledger). */
export function isPooledRO(ro: object): boolean {
  return pooledRO.has(ro);
}

/** A render object keyed as pooled (`patchBones.ts`, as its key is made), with that key. */
export function markPooledRO(ro: object, key: unknown = undefined): void {
  if (pooledRO.has(ro)) return;
  pooledRO.set(ro, { rec: null, seen: -1, key });
  BONE_STATS.pooledObjects++;
}

export function pooledRecord(ro: object): PooledObject | undefined {
  return pooledRO.get(ro);
}

/** A skeleton's record, made the first time it is met. */
export function recFor(skeleton: THREE.Skeleton): SkelRec {
  let r = recOf.get(skeleton);
  if (r) return r;
  const n = skeleton.bones.length;
  r = { skeleton, root: rootOf(skeleton), n, size: slotSize(n), base: -1, epoch: 0, drawn: -2, written: -2, prevSame: false, at: -1 };
  recOf.set(skeleton, r);
  return r;
}

/** The record of a skeleton met already, or undefined. */
export function recordOf(skeleton: THREE.Skeleton | null | undefined): SkelRec | undefined {
  return skeleton ? recOf.get(skeleton) : undefined;
}

/** Let a skeleton's slot go (undrawn too long, evicted, or the switch). */
function release(r: SkelRec): void {
  if (r.base < 0) return;
  let list = free.get(r.size);
  if (!list) free.set(r.size, (list = []));
  list.push(r.base);
  r.base = -1;
  r.epoch++;
  r.written = -2;
  const i = r.at;
  const last = live[live.length - 1];
  live[i] = last;
  last.at = i;
  live.length--;
  r.at = -1;
  BONE_STATS.live--;
  BONE_STATS.released++;
}

/** A slot for a skeleton that has none: a free one of its size, the pool's top, or one evicted from a body no draw met lately. */
function slotFor(r: SkelRec): boolean {
  const need = r.size * 2;
  const list = free.get(r.size);
  let base = -1;
  if (list && list.length) base = list.pop()!;
  else if (top + need <= BONE_POOL_TUNE.matrices && (top + need) * 16 <= mirror.length) {
    base = top;
    top += need;
  } else {
    // Full: the first body of its size no draw met last frame or this one gives its slot up.
    for (let i = 0; i < live.length; i++) {
      const o = live[i];
      if (o.size === r.size && o.drawn < frameNo - 1) {
        base = o.base;
        release(o);
        free.get(r.size)!.pop();
        BONE_STATS.evicted++;
        break;
      }
    }
    if (base < 0) return false;
  }
  r.base = base;
  r.epoch++;
  r.prevSame = false;
  r.at = live.length;
  live.push(r);
  BONE_STATS.live++;
  BONE_STATS.slotted++;
  return true;
}

/**
 * One skeleton's bones into its slot: this frame's in body space, last frame's beside them. `continuous` says the slot was
 * written last frame (its current half is last frame's bones, copied to the previous half first); otherwise previous is set
 * equal to current. Answers whether anything the card holds changed.
 */
export function writeSlot(r: SkelRec, continuous: boolean): boolean {
  const m = mirror;
  const n = r.n;
  const cur = r.base * 16;
  const prev = (r.base + r.size) * 16;
  if (continuous) m.copyWithin(prev, cur, cur + n * 16);
  const root = r.root;
  if (root) rootInv.copy(root.matrixWorld).invert();
  else rootInv.identity();
  const ri = rootInv.elements;
  const bones = r.skeleton.bones;
  const inv = r.skeleton.boneInverses;
  let changed = false;
  for (let j = 0; j < n; j++) {
    const bone = bones[j];
    const w = bone ? bone.matrixWorld.elements : ID;
    const bi = inv[j] ? inv[j].elements : ID;
    // T = root⁻¹ × bone's world, then T × the bone's inverse bind matrix, column by column (three's order), in doubles.
    for (let c = 0; c < 4; c++) {
      const b0 = w[c * 4];
      const b1 = w[c * 4 + 1];
      const b2 = w[c * 4 + 2];
      const b3 = w[c * 4 + 3];
      t[c * 4] = ri[0] * b0 + ri[4] * b1 + ri[8] * b2 + ri[12] * b3;
      t[c * 4 + 1] = ri[1] * b0 + ri[5] * b1 + ri[9] * b2 + ri[13] * b3;
      t[c * 4 + 2] = ri[2] * b0 + ri[6] * b1 + ri[10] * b2 + ri[14] * b3;
      t[c * 4 + 3] = ri[3] * b0 + ri[7] * b1 + ri[11] * b2 + ri[15] * b3;
    }
    const o = cur + j * 16;
    for (let c = 0; c < 4; c++) {
      const b0 = bi[c * 4];
      const b1 = bi[c * 4 + 1];
      const b2 = bi[c * 4 + 2];
      const b3 = bi[c * 4 + 3];
      for (let row = 0; row < 4; row++) {
        const v = Math.fround(t[row] * b0 + t[4 + row] * b1 + t[8 + row] * b2 + t[12 + row] * b3);
        const k = o + c * 4 + row;
        if (m[k] !== v) {
          m[k] = v;
          changed = true;
        }
      }
    }
  }
  if (!continuous) {
    m.copyWithin(prev, cur, cur + n * 16);
    r.prevSame = true;
    return true;
  }
  if (!changed) {
    if (r.prevSame) return false;
    r.prevSame = true;
    return true;
  }
  r.prevSame = false;
  return true;
}

function dirty(r: SkelRec): void {
  const a = r.base * 16;
  const b = (r.base + r.size + r.n) * 16;
  if (hi <= lo) {
    lo = a;
    hi = b;
    return;
  }
  if (a < lo) lo = a;
  if (b > hi) hi = b;
}

/**
 * Once a frame, after the scene's one walk of its matrices and before any pass (`PortalRenderer.walkOnce`): every skeleton a
 * draw met last frame written into its slot, one write to the card for all of them; a skeleton no draw has met for
 * `keepFrames` frames lets its slot go. Nothing allocated.
 */
export function boneFrame(): void {
  frameNo++;
  const f = frameNo;
  lo = 0;
  hi = 0;
  let written = 0;
  let still = 0;
  for (let i = 0; i < live.length; ) {
    const r = live[i];
    if (f - r.drawn > BONE_POOL_TUNE.keepFrames) {
      release(r);
      continue;
    }
    if (r.drawn === f - 1) {
      if (writeSlot(r, r.written === f - 1)) {
        dirty(r);
        written++;
      } else still++;
      r.written = f;
    }
    i++;
  }
  BONE_STATS.written = written;
  BONE_STATS.still = still;
  BONE_STATS.late = 0;
  BONE_STATS.calls = 0;
  BONE_STATS.bytes = 0;
  BONE_STATS.frames++;
  flush();
}

/** The frame's dirty span to the card in one write. */
function flush(): void {
  if (hi <= lo) return;
  const w = BONE_IO.write;
  if (w !== null) w(lo, hi - lo);
  BONE_STATS.calls++;
  BONE_STATS.bytes += (hi - lo) * 4;
  BONE_STATS.bytesAll += (hi - lo) * 4;
  lo = 0;
  hi = 0;
}

/**
 * A draw met a pooled body's render object (the patch's wrap of three's refresh question): its skeleton marked drawn this
 * frame, given a slot where it has none and written now where this frame's write did not reach it (previous equal to current,
 * one small write of its own). Answers true where the render object must be refreshed in full, its per-object values (the
 * slot) being older than its skeleton's slot. Nothing allocated once the skeleton has a record.
 */
export function touch(p: PooledObject, skeleton: THREE.Skeleton): boolean {
  let r = p.rec;
  if (r === null || r.skeleton !== skeleton) {
    r = p.rec = recFor(skeleton);
    // Another skeleton's record counts its epochs from its own start, so the one this object read last says nothing of it
    // (a body rebound to a skeleton of its own bones' count keeps its render object, and would read the old slot).
    p.seen = -1;
  }
  r.drawn = frameNo;
  if (r.written !== frameNo) {
    if (r.base < 0 && !slotFor(r)) {
      BONE_STATS.overflow++;
    } else if (r.base >= 0) {
      writeSlot(r, false);
      r.written = frameNo;
      lo = r.base * 16;
      hi = (r.base + r.size + r.n) * 16;
      BONE_STATS.late++;
      BONE_STATS.lateAll++;
      flush();
    }
  }
  if (p.seen !== r.epoch) {
    p.seen = r.epoch;
    return true;
  }
  return false;
}

/** The first matrix of a skinned object's current bones (0, the identity, with no slot). */
export function slotBase(object: Any): number {
  const r = recordOf(object.skeleton);
  return r !== undefined && r.base >= 0 ? r.base : 0;
}

/** The first matrix of its previous bones. */
export function slotPrev(object: Any): number {
  const r = recordOf(object.skeleton);
  return r !== undefined && r.base >= 0 ? r.base + r.size : 0;
}

/**
 * A skinned object's inverse bind matrix relative to its body's root (its per-object value): three's `bindMatrixInverse`
 * times the root's world matrix, in doubles, so the program takes body space back to the mesh's own: with the body's bones
 * in body space, mesh space comes out exactly as three's world-space arithmetic makes it.
 */
export function unbindInto(object: Any, out: THREE.Matrix4): THREE.Matrix4 {
  const sk = object.skeleton as THREE.Skeleton | undefined;
  const r = sk ? recordOf(sk) : undefined;
  const root = r !== undefined ? r.root : sk ? rootOf(sk) : null;
  if (root) out.multiplyMatrices(object.bindMatrixInverse, root.matrixWorld);
  else out.copy(object.bindMatrixInverse);
  return out;
}

/** Every slot let go (the switch off): each skeleton takes a new one when a draw meets it again. */
export function releaseAll(): number {
  let n = 0;
  while (live.length) {
    release(live[live.length - 1]);
    n++;
  }
  return n;
}

/** What `__debug.gpu()` says of the pool. */
export function bonePoolReport(): Record<string, unknown> {
  const byBones: Record<string, number> = {};
  for (const r of live) byBones[r.n] = (byBones[r.n] ?? 0) + 1;
  return {
    on: GPU_KEYS.boneStorage,
    applied: BONES.applied,
    ...(BONES.why ? { why: BONES.why } : {}),
    does: "every body's bones in one storage buffer, body space, written once a frame after the scene's walk (this frame's then last frame's); three keys no pipeline on the bone count and refreshes no body in full at every draw",
    switch: "__debug.gpu({ bones: false }) live (the bodies' render objects made again, three's own skinning), or localStorage['swg.gpu.keys.boneStorage'] = '0' and a reload",
    skeletons: BONE_STATS.live,
    byBones,
    matrices: { used: top, capacity: BONE_POOL_TUNE.matrices, megabytes: Number(((BONE_POOL_TUNE.matrices * 64) / 1e6).toFixed(2)) },
    lastFrame: { written: BONE_STATS.written, still: BONE_STATS.still, lateByDraw: BONE_STATS.late, bytes: BONE_STATS.bytes, writes: BONE_STATS.calls },
    allTold: { frames: BONE_STATS.frames, slotted: BONE_STATS.slotted, released: BONE_STATS.released, evicted: BONE_STATS.evicted, overflow: BONE_STATS.overflow, lateByDraw: BONE_STATS.lateAll, megabytesSent: Number((BONE_STATS.bytesAll / 1e6).toFixed(1)) },
    renderObjectsPooled: BONE_STATS.pooledObjects,
  };
}

/** For the node tests: a fresh pool (nothing slotted, the frame at nought), the switch on, not applied. */
export function resetBonePoolForTests(matrices = BONE_POOL_TUNE.matrices): void {
  while (live.length) live.pop()!.at = -1;
  free.clear();
  top = RESERVED;
  frameNo = 0;
  lo = 0;
  hi = 0;
  BONE_POOL_TUNE.matrices = matrices;
  mirror = new Float32Array(matrices * 16);
  fillIdentity(0, RESERVED);
  BONE_IO.write = null;
  BONES.applied = false;
  BONES.why = '';
  GPU_KEYS.boneStorage = true;
  for (const k of Object.keys(BONE_STATS) as (keyof typeof BONE_STATS)[]) BONE_STATS[k] = 0;
}

/** The pool's frame number (the tests and the patch). */
export function boneFrameNo(): number {
  return frameNo;
}
