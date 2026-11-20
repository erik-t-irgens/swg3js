// Real-body stand-ins for the warm-up (the GPU port's pass 1, wave 4, item 3).
//
// The person warm (`World.warmPersonShapes`, `personKeys.ts`) compiles one stand-in a shape of the people's product behind
// every loading screen, so a person stood after it finds its programs built. Its stand-ins are a triangle on a skeleton of
// one bone with the rung's morph targets and nearest-filtered one-texel maps: on WebGL, where none of that is in a program's
// key, they build the bodies' very programs. WebGPU keys a pipeline on what WebGL never keyed (a skeleton's bone count,
// every texture's sampler state, the attributes' layout, `receiveShadow`), so those stand-ins built 36 pipelines at
// Tatooine's arrival that no body draws with (`A:\swg3js\port\PASS1-census.md`).
//
// Here every stand-in is made off a real body: each distinct way a body met in the world is drawn (its attributes' names,
// array kinds, sizes and normalisation, its index's kind, its bone count, whether it receives and casts, and its material as
// three keys one, a texture by its sampler state and kind) is learnt once, and its stand-in is a triangle of that very
// layout, on a skeleton of that many bones, wearing a copy of that material whose pictures are one-texel twins of the same
// sampler state, kind and colour space (the environment the registry hands it, as it hands the body's). So the pipelines a
// stand-in warms are the bodies' own, for the world's pass and the rooms' alike (their lights differ, and the warm lists
// each), and a body of a way already met finds its pipelines built in every world that follows.
//
// What is learnt: every skinned mesh and every rack weapon (`userData.swgRack`) the world's scene holds when the warm asks
// (the player's figure at the first screen, the crowd at the arrival's sweep, a new world's people at its screens), left
// out: a mesh still morphed (the bake's: its pipeline is its geometry's own), several materials on one mesh, a picture of
// another kind (a cube, an array, a compressed or a video texture), and the stand-ins themselves. At most
// `BODY_STAND_INS_TUNE.cap` ways are learnt a session (ours: a bound on the warm's listing, not on any picture).
//
// The switch `GPU_KEYS.realStandIns` (read at load, moved live by `__debug.gpu({ standIns })`): off, the warm takes
// `personKeys.ts`'s own stand-ins, as before. Never on WebGL (reached only through `start.ts`). Imports nothing of three's
// WebGPU build, so node runs it as it stands.

import * as THREE from 'three';
import { GPU_KEYS } from './gpuKeys.ts';
import { pooledFor } from './bonePool.ts';

/** Ours: how many ways of drawing a body are learnt a session at most (each is a stand-in the warm lists at every screen). */
export const BODY_STAND_INS_TUNE = { cap: 64 };

/** What has been learnt, for `__debug.gpu()`. */
export const BODY_STAND_IN_STATS = {
  /** Ways learnt, each a stand-in. */
  learnt: 0,
  /** Meshes looked at in the scenes walked, all told, and walks made. */
  looked: 0,
  walks: 0,
  /** Meshes left out, by why. */
  left: {} as Record<string, number>,
  /** Ways met past the cap. */
  pastCap: 0,
};

/** Three's reduction of a material property to its key (`RenderObject.getMaterialCacheKey`): these numbers keep their value. */
const ENUM_PROPS = new Set(['side', 'blending', 'combine', 'normalMapType']);
/** What three leaves out of a material's key. */
const SKIP_PROP = /^(is[A-Z]|_)|^(visible|version|uuid|name|opacity|userData|iridescenceThicknessRange)$/;
const protoKeys = new Map<unknown, string[]>();

/** A material's properties as three walks them for its key: its own, then its prototypes' accessors. */
function materialKeys(m: THREE.Material): string[] {
  const own = Object.keys(m);
  let pk = protoKeys.get(m.constructor);
  if (!pk) {
    pk = [];
    let proto = Object.getPrototypeOf(m);
    while (proto) {
      const d = Object.getOwnPropertyDescriptors(proto);
      for (const k in d) if (d[k].get !== undefined) pk.push(k);
      proto = Object.getPrototypeOf(proto);
    }
    protoKeys.set(m.constructor, pk);
  }
  return pk.length ? own.concat(pk) : own;
}

/** Whether a texture is a plain picture a one-texel twin can stand for (not a cube, an array, a volume, compressed, depth or video). */
function plainTexture(t: THREE.Texture): boolean {
  const x = t as unknown as Record<string, unknown>;
  return !x.isCubeTexture && !x.isDataArrayTexture && !x.isData3DTexture && !x.isCompressedTexture && !x.isCompressedArrayTexture && !x.isDepthTexture && !x.isVideoTexture && !x.isFramebufferTexture && !x.isRenderTargetTexture && !x.isStorageTexture;
}

/** A texture's third wrap (three keys it on WebGPU; only a volume's is declared in the types). */
function wrapR(t: THREE.Texture): number | undefined {
  return (t as unknown as { wrapR?: number }).wrapR;
}

/** What of a texture decides how three binds and samples it: its sampler state (three keys it), its colour space, its kind. */
function textureKind(t: THREE.Texture): string {
  const data = (t as THREE.DataTexture).isDataTexture === true;
  return `${t.mapping},${t.channel},${t.magFilter},${t.minFilter},${t.wrapS},${t.wrapT},${wrapR(t)},${t.colorSpace},${data ? `d${t.type},${t.format}` : 'i'}`;
}

/** A material as three keys it on WebGPU, the draw state's own properties included, and its program key's text. */
function materialKey(m: THREE.Material): string | null {
  let out = `${m.type}|`;
  for (const k of materialKeys(m)) {
    if (SKIP_PROP.test(k)) continue;
    const v = (m as unknown as Record<string, unknown>)[k];
    let key: string;
    if (v === null || v === undefined) key = String(v);
    else if (typeof v === 'number') key = ENUM_PROPS.has(k) ? String(v) : v !== 0 ? '1' : '0';
    else if (typeof v === 'object') {
      const t = v as THREE.Texture;
      if (t.isTexture) {
        // The environment is the registry's filtered picture (a target's on WebGPU), which the registry hands the stand-in's
        // copy as it hands the body's: no twin stands for it, so it need not be a plain picture.
        if (k !== 'envMap' && !plainTexture(t)) return null;
        key = `{${textureKind(t)}}`;
      } else key = '{}';
    } else key = String(v);
    out += `${k}=${key};`;
  }
  const cpk = (m as unknown as { customProgramCacheKey?: () => string }).customProgramCacheKey;
  return `${out}|${typeof cpk === 'function' ? cpk.call(m) : ''}`;
}

/** A geometry's attributes as three keys a program and a vertex layout on them: names, array kinds, sizes, normalisation; and its index's kind. */
function layoutKey(g: THREE.BufferGeometry): string | null {
  let out = '';
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    if ((a as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return null;
    out += `${name}:${a.array.constructor.name}:${a.itemSize}:${a.normalized ? 'n' : ''}:${a.gpuType};`;
  }
  return `${out}|${g.index ? g.index.array.constructor.name : 'none'}`;
}

/** Why a mesh is no body to learn from, or '' when it is one. */
function leftWhy(o: THREE.Object3D): string {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || !mesh.geometry || !mesh.material) return 'not a mesh';
  const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true;
  if (Array.isArray(mesh.material)) return skinned || mesh.material.some((m) => m.userData.swgRack === true) ? 'several materials' : 'not a body';
  const u = mesh.material.userData;
  if (!skinned && u.swgRack !== true) return 'not a body';
  if (u.swgStandIn === true || u.swgSelfTest === true || mesh.userData.swgBodyStandIn === true) return 'a stand-in';
  const ma = mesh.geometry.morphAttributes;
  if ((ma.position?.length ?? 0) > 0 || (ma.normal?.length ?? 0) > 0 || (ma.color?.length ?? 0) > 0) return 'morph targets (its geometry its own pipeline)';
  if (skinned && !(mesh as THREE.SkinnedMesh).skeleton) return 'no skeleton';
  return '';
}

/** The way a body is drawn, as one key: or null for one a twin cannot stand for. */
export function bodyKey(mesh: THREE.Mesh): string | null {
  const layout = layoutKey(mesh.geometry);
  if (layout === null) return null;
  const mat = materialKey(mesh.material as THREE.Material);
  if (mat === null) return null;
  const s = mesh as THREE.SkinnedMesh;
  // With the bone pool on (pass 1, wave 4, `bonePool.ts`) three keys every skinned body "pooled", whatever its bones: one way.
  const bones = s.isSkinnedMesh ? (pooledFor(mesh, mesh.material) ? 'pool' : s.skeleton.bones.length) : 0;
  return `${s.isSkinnedMesh ? 'skinned' : 'rigid'}|k${bones}|r${mesh.receiveShadow ? 1 : 0}c${mesh.castShadow ? 1 : 0}|${layout}|${mat}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The twins.

const twinTextures = new Map<string, THREE.Texture>();
const twinGeometries = new Map<string, THREE.BufferGeometry>();
const skeletons = new Map<number, THREE.Bone[]>();

/** A one-texel picture of a texture's very sampler state, colour space and kind: made once a kind, kept for the session. */
function twinTexture(t: THREE.Texture): THREE.Texture {
  const kind = textureKind(t);
  let tw = twinTextures.get(kind);
  if (tw) return tw;
  const d = t as THREE.DataTexture;
  if (d.isDataTexture) {
    const n = d.format === THREE.RedFormat ? 1 : d.format === THREE.RGFormat ? 2 : 4;
    const data = d.type === THREE.FloatType ? new Float32Array(n).fill(1) : d.type === THREE.HalfFloatType ? new Uint16Array(n).fill(0x3c00) : d.type === THREE.UnsignedByteType ? new Uint8Array(n).fill(255) : null;
    tw = data ? new THREE.DataTexture(data, 1, 1, d.format as THREE.PixelFormat, d.type) : new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  } else tw = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tw.name = `body stand-in twin ${kind}`;
  tw.mapping = t.mapping;
  tw.channel = t.channel;
  tw.magFilter = t.magFilter;
  tw.minFilter = t.minFilter;
  tw.wrapS = t.wrapS;
  tw.wrapT = t.wrapT;
  const r = wrapR(t);
  if (r !== undefined) (tw as unknown as { wrapR: number }).wrapR = r;
  tw.colorSpace = t.colorSpace;
  tw.generateMipmaps = false;
  tw.needsUpdate = true;
  twinTextures.set(kind, tw);
  return tw;
}

/** A triangle of a geometry's very layout (its attributes' names, array kinds, sizes and normalisation, its index's kind): made once a layout. */
function twinGeometry(g: THREE.BufferGeometry, key: string): THREE.BufferGeometry {
  let tw = twinGeometries.get(key);
  if (tw) return tw;
  tw = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    const Ctor = a.array.constructor as new (n: number) => THREE.TypedArray;
    const arr = new Ctor(3 * a.itemSize);
    const one = a.normalized ? (arr instanceof Uint8Array ? 255 : arr instanceof Uint16Array ? 65535 : arr instanceof Int8Array ? 127 : arr instanceof Int16Array ? 32767 : 1) : 1;
    if (name === 'position') {
      arr[3] = 0.01;
      arr[7] = 0.01;
    } else if (name === 'normal' && a.itemSize === 3) for (let v = 0; v < 3; v++) arr[v * 3 + 2] = one;
    else if (name === 'skinWeight') for (let v = 0; v < 3; v++) arr[v * a.itemSize] = one;
    const c = new THREE.BufferAttribute(arr, a.itemSize, a.normalized);
    c.gpuType = a.gpuType;
    tw.setAttribute(name, c);
  }
  if (g.index) {
    const Ctor = g.index.array.constructor as new (n: number) => THREE.TypedArray;
    const idx = new Ctor(3);
    idx[1] = 1;
    idx[2] = 2;
    tw.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  twinGeometries.set(key, tw);
  return tw;
}

/** `n` bones in a chain, identity, shared by every stand-in of that count (as a body's parts share their skeleton). */
function bonesOf(n: number): THREE.Bone[] {
  let b = skeletons.get(n);
  if (b) return b;
  b = [];
  for (let i = 0; i < n; i++) {
    const bone = new THREE.Bone();
    bone.name = `stand-in bone ${i}`;
    if (i) b[i - 1].add(bone);
    b.push(bone);
  }
  skeletons.set(n, b);
  return b;
}

/** The body's material copied, each picture a twin of its sampler state (the environment left as the registry hands it). */
function twinMaterial(m: THREE.Material): THREE.Material {
  const c = m.clone();
  const slots = c as unknown as Record<string, unknown>;
  for (const k of Object.keys(slots)) {
    const t = slots[k] as THREE.Texture | null;
    if (!t || !t.isTexture || k === 'envMap') continue;
    slots[k] = twinTexture(t);
  }
  c.name = `body stand-in: ${m.name || m.type}`;
  c.userData.swgStandIn = true;
  return c;
}

/** A stand-in for one way of drawing a body: its layout's triangle, its bone count, its material's twin, its shadows. */
function makeStandIn(mesh: THREE.Mesh, key: string): THREE.Mesh {
  const lk = layoutKey(mesh.geometry)!;
  const geo = twinGeometry(mesh.geometry, lk);
  const mat = twinMaterial(mesh.material as THREE.Material);
  const s = mesh as THREE.SkinnedMesh;
  let out: THREE.Mesh;
  if (s.isSkinnedMesh) {
    const sk = new THREE.SkinnedMesh(geo, mat);
    const bones = bonesOf(s.skeleton.bones.length);
    // The chain hangs under the first stand-in of its count that is made; the skeleton reads world matrices alone.
    if (!bones[0].parent) sk.add(bones[0]);
    sk.bind(new THREE.Skeleton(bones));
    out = sk;
  } else out = new THREE.Mesh(geo, mat);
  out.name = `body stand-in ${BODY_STAND_IN_STATS.learnt}`;
  out.userData.swgBodyStandIn = true;
  out.userData.swgBodyKey = key;
  out.castShadow = mesh.castShadow;
  out.receiveShadow = mesh.receiveShadow;
  out.frustumCulled = false;
  out.updateMatrixWorld(true);
  return out;
}

const learnt = new Map<string, THREE.Mesh>();
const list: THREE.Mesh[] = [];

function leave(why: string): void {
  BODY_STAND_IN_STATS.left[why] = (BODY_STAND_IN_STATS.left[why] ?? 0) + 1;
}

/** Learn every way of drawing a body under `root` not met before. Behind a screen or in a sweep: allocates as it learns. Answers how many were new. */
export function learnBodies(root: THREE.Object3D): number {
  let n = 0;
  BODY_STAND_IN_STATS.walks++;
  root.traverse((o) => {
    const why = leftWhy(o);
    if (why === 'not a mesh' || why === 'not a body') return;
    BODY_STAND_IN_STATS.looked++;
    if (why) {
      leave(why);
      return;
    }
    const mesh = o as THREE.Mesh;
    const key = bodyKey(mesh);
    if (key === null) {
      leave('a picture of another kind, or interleaved attributes');
      return;
    }
    if (learnt.has(key)) return;
    if (learnt.size >= BODY_STAND_INS_TUNE.cap) {
      BODY_STAND_IN_STATS.pastCap++;
      return;
    }
    const s = makeStandIn(mesh, key);
    learnt.set(key, s);
    list.push(s);
    BODY_STAND_IN_STATS.learnt++;
    n++;
  });
  return n;
}

/**
 * The warm's person stand-ins on WebGPU: every way of drawing a body met so far, the scene learnt from first. Null with the
 * switch off: the warm then takes `personKeys.ts`'s own.
 */
export function bodyStandIns(scene: THREE.Object3D | null): THREE.Mesh[] | null {
  if (!GPU_KEYS.realStandIns) return null;
  if (scene) learnBodies(scene);
  return list;
}

/** What `__debug.gpu()` says of them. */
export function bodyStandInsReport(): Record<string, unknown> {
  const byBones: Record<string, number> = {};
  for (const s of list) {
    const k = (s as THREE.SkinnedMesh).isSkinnedMesh ? `${(s as THREE.SkinnedMesh).skeleton.bones.length} bones` : 'rigid';
    byBones[k] = (byBones[k] ?? 0) + 1;
  }
  return {
    on: GPU_KEYS.realStandIns,
    does: "the person warm's stand-ins made off real bodies met in the world: each way a body is drawn (its layout, bone count, shadows and material as three keys them) a triangle of that layout on that many bones, wearing its material's copy with one-texel twins of each picture's sampler state",
    switch: "__debug.gpu({ standIns: false }) live (the warm takes personKeys' one-bone stand-ins), or localStorage['swg.gpu.keys.realStandIns'] = '0' and a reload",
    learnt: BODY_STAND_IN_STATS.learnt,
    cap: BODY_STAND_INS_TUNE.cap,
    pastCap: BODY_STAND_IN_STATS.pastCap,
    byBones,
    walks: BODY_STAND_IN_STATS.walks,
    meshesLooked: BODY_STAND_IN_STATS.looked,
    leftOut: { ...BODY_STAND_IN_STATS.left },
    twins: { textures: twinTextures.size, layouts: twinGeometries.size, boneCounts: skeletons.size },
  };
}

/** For the node tests: nothing learnt, the switch on. */
export function resetBodyStandInsForTests(): void {
  learnt.clear();
  list.length = 0;
  twinTextures.clear();
  twinGeometries.clear();
  skeletons.clear();
  GPU_KEYS.realStandIns = true;
  BODY_STAND_IN_STATS.learnt = 0;
  BODY_STAND_IN_STATS.looked = 0;
  BODY_STAND_IN_STATS.walks = 0;
  BODY_STAND_IN_STATS.pastCap = 0;
  for (const k of Object.keys(BODY_STAND_IN_STATS.left)) delete BODY_STAND_IN_STATS.left[k];
}
