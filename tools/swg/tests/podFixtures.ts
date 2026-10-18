// What the pod tests share: a converted skinned GLB as three objects under node, the way GLTFLoader makes the parts a
// pod put together from parts reads (src/vehicles/podHybrid.ts) -- bones for the skin's joints, a skinned mesh per
// primitive bound to a skeleton of its own over the same bones, a hardpoint node with the colon taken out of its name
// and the name kept in `userData.name`, a material per glTF material with its name -- and a made-up pod on the pods'
// joint names, whose places and triangles are ours. No texture is decoded (node has no image decoder).
//
// Not a test itself: `podHybrid.test.ts` imports it.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { readGlb } from '../glbclips.mjs';

type Json = {
  nodes: { name?: string; children?: number[]; mesh?: number; skin?: number; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  scenes: { nodes: number[] }[];
  scene?: number;
  skins?: { joints: number[]; inverseBindMatrices?: number }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
  materials?: { name?: string }[];
  accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
};

const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CTOR: Record<number, new (n: number) => THREE.TypedArray> = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NAMES: Record<string, string> = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', TEXCOORD_1: 'uv1', JOINTS_0: 'skinIndex', WEIGHTS_0: 'skinWeight', TANGENT: 'tangent' };

/** One accessor's values, copied out with strides followed. */
function accessor(json: Json, bin: Buffer, i: number): { array: THREE.TypedArray; size: number; normalized: boolean } {
  const a = json.accessors[i];
  const size = SIZE[a.type];
  const out = new CTOR[a.componentType](a.count * size);
  if (a.bufferView === undefined) return { array: out, size, normalized: !!a.normalized };
  const view = json.bufferViews[a.bufferView];
  const bytes = BYTES[a.componentType];
  const stride = view.byteStride ?? size * bytes;
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let k = 0; k < a.count; k++) {
    for (let c = 0; c < size; c++) {
      const o = base + k * stride + c * bytes;
      const t = a.componentType;
      out[k * size + c] = t === 5126 ? dv.getFloat32(o, true) : t === 5125 ? dv.getUint32(o, true) : t === 5123 ? dv.getUint16(o, true) : t === 5122 ? dv.getInt16(o, true) : t === 5121 ? dv.getUint8(o) : dv.getInt8(o);
    }
  }
  return { array: out, size, normalized: !!a.normalized };
}

/** GLTFLoader's node names: spaces to underscores, and none of the characters a property binding reserves. */
const sanitize = (name: string) => name.replace(/\s/g, '_').replace(/[[\]./:]/g, '');

/** A converted skinned GLB as GLTFLoader makes it, with its clips (each track named for its node's name as the loader sanitises it). */
export function loadSkinnedGlb(file: string): { scene: THREE.Group; animations: THREE.AnimationClip[] } {
  const { json: raw, bin } = readGlb(readFileSync(file)) as { json: Json; bin: Buffer };
  const json = raw;
  const joints = new Set<number>((json.skins ?? []).flatMap((s) => s.joints));
  const materials = (json.materials ?? []).map((m) => {
    const mat = new THREE.MeshStandardMaterial();
    mat.name = m.name ?? '';
    return mat;
  });
  const nodes = json.nodes.map((n, i) => {
    let o: THREE.Object3D;
    if (n.mesh !== undefined) {
      const prims = json.meshes![n.mesh].primitives.map((p) => {
        const g = new THREE.BufferGeometry();
        for (const [attr, idx] of Object.entries(p.attributes)) {
          const name = NAMES[attr];
          if (!name) continue;
          const a = accessor(json, bin, idx);
          g.setAttribute(name, new THREE.BufferAttribute(a.array, a.size, a.normalized));
        }
        if (p.indices !== undefined) g.setIndex(new THREE.BufferAttribute(accessor(json, bin, p.indices).array, 1));
        const mesh = n.skin !== undefined ? new THREE.SkinnedMesh(g, p.material !== undefined ? materials[p.material] : new THREE.MeshStandardMaterial()) : new THREE.Mesh(g, materials[p.material ?? 0]);
        // As the garage marks every mesh of a model it loads once for the session.
        mesh.userData.shared = true;
        return mesh;
      });
      if (prims.length === 1) o = prims[0];
      else {
        o = new THREE.Group();
        for (const m of prims) o.add(m);
      }
    } else o = joints.has(i) ? new THREE.Bone() : new THREE.Object3D();
    if (n.name) {
      o.userData.name = n.name;
      o.name = sanitize(n.name);
    }
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => nodes[i].add(nodes[c])));
  const scene = new THREE.Group();
  for (const i of json.scenes[json.scene ?? 0].nodes) scene.add(nodes[i]);
  scene.updateMatrixWorld(true);
  json.nodes.forEach((n, i) => {
    if (n.skin === undefined) return;
    const skin = json.skins![n.skin];
    const bones = skin.joints.map((j) => nodes[j] as THREE.Bone);
    const ibm = skin.inverseBindMatrices !== undefined ? accessor(json, bin, skin.inverseBindMatrices).array : null;
    nodes[i].traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const inverses = bones.map((_, k) => (ibm ? new THREE.Matrix4().fromArray(ibm as unknown as number[], k * 16) : new THREE.Matrix4()));
      m.bind(new THREE.Skeleton(bones, inverses), m.matrixWorld);
    });
  });
  const animations = (raw as unknown as { animations?: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }[] }).animations ?? [];
  const clips = animations.map((an) => {
    const tracks = an.channels.map((c) => {
      const s = an.samplers[c.sampler];
      const times = accessor(json, bin, s.input).array as Float32Array;
      const values = accessor(json, bin, s.output).array as Float32Array;
      const name = `${sanitize(json.nodes[c.target.node].name ?? '')}.${c.target.path === 'translation' ? 'position' : c.target.path === 'rotation' ? 'quaternion' : 'scale'}`;
      return c.target.path === 'rotation' ? new THREE.QuaternionKeyframeTrack(name, times, values) : new THREE.VectorKeyframeTrack(name, times, values);
    });
    return new THREE.AnimationClip(an.name, -1, tracks);
  });
  return { scene, animations: clips };
}

/** The pods' joints by name, child of parent, at places of ours. */
export const MADE_UP_JOINTS: readonly [string, string | null, [number, number, number]][] = [
  ['root', null, [0, 2, 0]],
  ['lft_engine', 'root', [2, 0, 0]],
  ['lft_leg', 'lft_engine', [0, 1.5, 0]],
  ['left_foot', 'lft_leg', [-1.5, -0.5, -6]],
  ['body', 'left_foot', [-0.5, 0.5, -2]],
  ['rght_engine', 'root', [-2, 0, 0]],
  ['rght_leg', 'rght_engine', [0, 1.5, 0]],
  ['rght_foot', 'rght_leg', [1.5, -0.5, -6]],
];

/** A hardpoint of a made-up pod: its name, the joint it hangs from, its place there, and (optionally) a plain node between. */
export interface MadeUpPoint {
  name: string;
  joint: string;
  at: [number, number, number];
  via?: [number, number, number];
}

/** A triangle of a made-up pod: the joint each corner is weighted wholly to, and where its corners stand at rest. */
export interface MadeUpTriangle {
  joints: [string, string, string];
  corners: [number, number, number][];
}

/**
 * A made-up skinned pod as GLTFLoader would make one: the joints above in the order `order` lists them in its skin (the
 * converted pods all list them the same way; another order is what a re-pointing must survive), one skinned mesh (or
 * `meshes` of them, the triangles shared out between them in turn) bound at rest, and its points. `rest` moves joints'
 * rest places for a pod that is not quite the others' skeleton.
 */
export function madeUpPod(opts: { order?: readonly string[]; triangles: MadeUpTriangle[]; points: MadeUpPoint[]; meshes?: number; materials?: THREE.Material[]; rest?: Record<string, [number, number, number]>; rename?: Record<string, string> }): { scene: THREE.Group; animations: THREE.AnimationClip[] } {
  const scene = new THREE.Group();
  const bones = new Map<string, THREE.Bone>();
  for (const [name, parent, at] of MADE_UP_JOINTS) {
    const b = new THREE.Bone();
    b.name = opts.rename?.[name] ?? name;
    b.position.fromArray(opts.rest?.[name] ?? at);
    bones.set(name, b);
    (parent ? bones.get(parent)! : scene).add(b);
  }
  scene.updateMatrixWorld(true);
  const order = opts.order ?? MADE_UP_JOINTS.map((j) => j[0]);
  const skinBones = order.map((n) => bones.get(n)!);
  const meshCount = opts.meshes ?? 1;
  const holder = meshCount > 1 ? new THREE.Group() : scene;
  if (holder !== scene) scene.add(holder);
  for (let k = 0; k < meshCount; k++) {
    const tris = opts.triangles.filter((_, i) => i % meshCount === k);
    const pos: number[] = [];
    const si: number[] = [];
    const sw: number[] = [];
    const index: number[] = [];
    for (const t of tris) {
      for (let c = 0; c < 3; c++) {
        index.push(pos.length / 3);
        pos.push(...t.corners[c]);
        si.push(order.indexOf(t.joints[c]), 0, 0, 0);
        sw.push(1, 0, 0, 0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(index);
    const mesh = new THREE.SkinnedMesh(g, opts.materials?.[k] ?? new THREE.MeshStandardMaterial({ name: `made_up_${k}` }));
    mesh.name = `made_up_l0_${k}`;
    mesh.userData.shared = true;
    holder.add(mesh);
    scene.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(skinBones, skinBones.map((b) => new THREE.Matrix4().copy(b.matrixWorld).invert())), mesh.matrixWorld);
  }
  for (const p of opts.points) {
    const node = new THREE.Object3D();
    node.name = `hp${p.name}`;
    node.userData.name = `hp:${p.name}`;
    node.position.fromArray(p.at);
    const bone = bones.get(p.joint)!;
    if (p.via) {
      const mid = new THREE.Object3D();
      mid.name = 'between';
      mid.position.fromArray(p.via);
      mid.rotation.set(0, 0.5, 0);
      bone.add(mid);
      mid.add(node);
    } else bone.add(node);
  }
  scene.updateMatrixWorld(true);
  return { scene, animations: [] };
}
