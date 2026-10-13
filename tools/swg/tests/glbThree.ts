// A converted GLB as three objects under node, the way GLTFLoader makes the parts the leaf cards' rule and the
// sway read: a standard material per glTF material with its name, its cut or its blend, its sides, its vertex
// colours and its `extras` as `userData`; a geometry per primitive with its position, normal, coordinate sets,
// colours and index; the default scene's meshes, then the `lods` scene's. No texture is decoded (node has no
// image decoder): a material with a picture gets an empty `Texture` in its slot, which is all its program key and
// the rule ever ask of it. Not a test itself.
//
// Also the packs on disk: which folders hold flora, every flora GLB, and the placed GLBs that wear a card shader.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { readGlb } from '../glbclips.mjs';

type Json = {
  materials?: { name?: string; alphaMode?: string; alphaCutoff?: number; doubleSided?: boolean; extras?: Record<string, unknown>; pbrMetallicRoughness?: { baseColorTexture?: { index: number } }; extensions?: Record<string, unknown> }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
  nodes?: { mesh?: number; children?: number[]; name?: string }[];
  scenes?: { name?: string; nodes?: number[] }[];
  scene?: number;
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  bufferViews?: { byteOffset?: number; byteLength: number; byteStride?: number }[];
};

const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CTOR: Record<number, { new (n: number): ArrayLike<number> & { [i: number]: number }; BYTES_PER_ELEMENT: number }> = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};

/** One accessor's values, copied out (strides followed). */
function accessorOf(json: Json, bin: Buffer, index: number): { array: ArrayLike<number> & { [i: number]: number }; itemSize: number; normalized: boolean } {
  const a = json.accessors![index];
  const size = SIZE[a.type];
  const Ctor = CTOR[a.componentType];
  const out = new Ctor(a.count * size);
  if (a.bufferView === undefined) return { array: out, itemSize: size, normalized: !!a.normalized };
  const view = json.bufferViews![a.bufferView];
  const bytes = Ctor.BYTES_PER_ELEMENT;
  const stride = view.byteStride ?? size * bytes;
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < size; c++) {
      const o = base + i * stride + c * bytes;
      let v: number;
      switch (a.componentType) {
        case 5120: v = dv.getInt8(o); break;
        case 5121: v = dv.getUint8(o); break;
        case 5122: v = dv.getInt16(o, true); break;
        case 5123: v = dv.getUint16(o, true); break;
        case 5125: v = dv.getUint32(o, true); break;
        default: v = dv.getFloat32(o, true);
      }
      out[i * size + c] = v;
    }
  }
  return { array: out, itemSize: size, normalized: !!a.normalized };
}

const NAMES: Record<string, string> = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', TEXCOORD_1: 'uv1', COLOR_0: 'color', TANGENT: 'tangent' };

/** A converted GLB's default scene and its `lods` scene as three groups, every mesh with its material and geometry. */
export function glbScenes(file: string): { scenes: THREE.Group[]; json: Json } {
  const { json: raw, bin } = readGlb(readFileSync(file));
  const json = raw as Json;
  const materials = (json.materials ?? []).map((m) => {
    const mat = new THREE.MeshStandardMaterial();
    mat.name = m.name ?? '';
    if (m.pbrMetallicRoughness?.baseColorTexture) mat.map = new THREE.Texture();
    const mode = m.alphaMode ?? 'OPAQUE';
    if (mode === 'BLEND') {
      mat.transparent = true;
      mat.depthWrite = false;
    } else if (mode === 'MASK') mat.alphaTest = m.alphaCutoff ?? 0.5;
    mat.side = m.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    if (m.extras) Object.assign(mat.userData, JSON.parse(JSON.stringify(m.extras)));
    if (m.extensions?.KHR_materials_unlit) mat.userData.unlit = true;
    return mat;
  });
  const geometries = new Map<string, THREE.BufferGeometry>();
  const meshOf = (mi: number, name: string): THREE.Object3D => {
    const group = new THREE.Group();
    group.name = name;
    for (const p of json.meshes![mi].primitives) {
      const key = `${JSON.stringify(p.attributes)}|${p.indices}`;
      let g = geometries.get(key);
      if (!g) {
        g = new THREE.BufferGeometry();
        for (const [attr, idx] of Object.entries(p.attributes)) {
          const name3 = NAMES[attr];
          if (!name3) continue;
          const a = accessorOf(json, bin, idx);
          g.setAttribute(name3, new THREE.BufferAttribute(a.array as unknown as THREE.TypedArray, a.itemSize, a.normalized));
        }
        if (p.indices !== undefined) {
          const ix = accessorOf(json, bin, p.indices);
          g.setIndex(new THREE.BufferAttribute(ix.array as unknown as THREE.TypedArray, 1));
        }
        geometries.set(key, g);
      }
      const mat = p.material !== undefined ? materials[p.material] : new THREE.MeshStandardMaterial();
      if (p.attributes.COLOR_0 !== undefined) mat.vertexColors = true;
      group.add(new THREE.Mesh(g, mat));
    }
    return group;
  };
  const sceneOf = (si: number): THREE.Group => {
    const root = new THREE.Group();
    root.name = json.scenes?.[si]?.name ?? '';
    const walk = (ni: number, parent: THREE.Object3D) => {
      const n = json.nodes![ni];
      const o = n.mesh !== undefined ? meshOf(n.mesh, n.name ?? '') : new THREE.Group();
      parent.add(o);
      for (const c of n.children ?? []) walk(c, o);
    };
    for (const ni of json.scenes?.[si]?.nodes ?? []) walk(ni, root);
    return root;
  };
  const main = json.scene ?? 0;
  const scenes = [sceneOf(main)];
  (json.scenes ?? []).forEach((s, i) => {
    if (i !== main) scenes.push(sceneOf(i));
  });
  return { scenes, json };
}

/** The JSON chunk alone; an empty document for a file that is not a GLB (a placed particle effect's). */
export function glbJsonOf(file: string): Json {
  if (!file.toLowerCase().endsWith('.glb')) return {};
  try {
    return readGlb(readFileSync(file)).json as Json;
  } catch {
    return {};
  }
}

/** Every pack folder under `root` with a flora category, and its manifest. */
export function floraPacks(root: string): { pack: string; dir: string; manifest: { categories: Record<string, { id: string; file: string; cells?: unknown[] }[]>; cards?: Record<string, { blend: boolean; emissive: number[] }> } }[] {
  if (!existsSync(root)) return [];
  const out = [];
  for (const pack of readdirSync(root)) {
    const dir = join(root, pack);
    const mf = join(dir, 'manifest.json');
    if (!existsSync(mf)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(mf, 'utf8'));
    } catch {
      continue;
    }
    if (!manifest?.categories?.flora?.length) continue;
    out.push({ pack, dir, manifest });
  }
  return out;
}

/** Whether a glTF material is a card: drawn cut out or blended, not invisible, not unlit. */
export function isCardJson(m: { alphaMode?: string; extras?: Record<string, unknown>; extensions?: Record<string, unknown> } | undefined): boolean {
  return !!m && (m.alphaMode === 'MASK' || m.alphaMode === 'BLEND') && !m.extras?.invisible && !m.extensions?.KHR_materials_unlit;
}
