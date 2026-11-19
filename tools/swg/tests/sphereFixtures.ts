// Climbing II, Smoothness II, items 3 and 4: the rest mesh of a converted species' body read straight out of its GLBs (its
// vertices, each vertex's heaviest joint, its joints' bind frames), as `sphereSourceOf` reads three's own skinned meshes in
// the game, so node measures the very spheres the game does (src/player/bodySpheres.ts's `measureSpheres`).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { SphereSource } from '../../../src/player/bodySpheres.ts';

interface Gltf {
  nodes: { name?: string; extras?: { name?: string }; children?: number[]; mesh?: number; skin?: number }[];
  skins?: { joints: number[]; inverseBindMatrices?: number }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
}

const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function read(g: Gltf, bin: Buffer, a: number): number[][] {
  const acc = g.accessors[a];
  const view = g.bufferViews[acc.bufferView ?? 0];
  const n = SIZE[acc.type];
  const bytes = BYTES[acc.componentType];
  const stride = view.byteStride ?? n * bytes;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[][] = [];
  for (let i = 0; i < acc.count; i++) {
    const row: number[] = [];
    for (let c = 0; c < n; c++) {
      const o = base + i * stride + c * bytes;
      let v: number;
      switch (acc.componentType) {
        case 5126: v = bin.readFloatLE(o); break;
        case 5121: v = bin.readUInt8(o); if (acc.normalized) v /= 255; break;
        case 5123: v = bin.readUInt16LE(o); if (acc.normalized) v /= 65535; break;
        case 5125: v = bin.readUInt32LE(o); break;
        case 5120: v = bin.readInt8(o); break;
        default: v = bin.readInt16LE(o);
      }
      row.push(v);
    }
    out.push(row);
  }
  return out;
}

/** The body's rest mesh out of these GLBs (each the species' body parts, sharing the first one's skeleton by joint name). */
export function glbSphereSource(files: readonly string[]): SphereSource {
  let names: string[] = [];
  let parents: number[] = [];
  let bind: number[] = [];
  const positions: number[] = [];
  const joint: number[] = [];
  for (const file of files) {
    const buf = readFileSync(file);
    const jl = buf.readUInt32LE(12);
    const g = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8')) as Gltf;
    const bl = buf.readUInt32LE(20 + jl);
    const bin = buf.subarray(28 + jl, 28 + jl + bl);
    const skin = (g.skins ?? [])[0];
    if (!skin) continue;
    const jn = skin.joints.map((j) => g.nodes[j].extras?.name ?? g.nodes[j].name ?? `joint${j}`);
    if (names.length === 0) {
      names = jn;
      const parentOf = new Array<number>(g.nodes.length).fill(-1);
      g.nodes.forEach((nd, i) => (nd.children ?? []).forEach((c) => (parentOf[c] = i)));
      const at = new Map(skin.joints.map((n, i) => [n, i]));
      parents = skin.joints.map((n) => {
        for (let p = parentOf[n]; p >= 0; p = parentOf[p]) if (at.has(p)) return at.get(p)!;
        return -1;
      });
      const ibm = skin.inverseBindMatrices !== undefined ? read(g, bin, skin.inverseBindMatrices) : skin.joints.map(() => new THREE.Matrix4().elements);
      const m = new THREE.Matrix4();
      for (const e of ibm) {
        m.fromArray(e).invert();
        bind.push(...m.elements);
      }
    }
    const map = jn.map((n) => names.indexOf(n));
    for (const nd of g.nodes) {
      if (nd.mesh === undefined) continue;
      for (const prim of g.meshes[nd.mesh].primitives) {
        const P = read(g, bin, prim.attributes.POSITION);
        const J = read(g, bin, prim.attributes.JOINTS_0);
        const W = read(g, bin, prim.attributes.WEIGHTS_0);
        for (let i = 0; i < P.length; i++) {
          let best = -1;
          let bw = 0;
          for (let c = 0; c < 4; c++) if (W[i][c] > bw) {
            bw = W[i][c];
            best = J[i][c];
          }
          positions.push(P[i][0], P[i][1], P[i][2]);
          joint.push(best >= 0 && best < map.length ? map[best] : -1);
        }
      }
    }
  }
  return { positions, joint, names, parents, bind };
}

/** A species' body GLBs (every part the pack marks `body`), or none. */
export function speciesBodyFiles(root: string, id: string): string[] {
  const dir = `${root}/assets-private/characters/${id}/`;
  try {
    const m = JSON.parse(readFileSync(dir + 'parts.json', 'utf8')) as { parts: { file: string; body?: boolean }[] };
    return m.parts.filter((p) => p.body).map((p) => dir + p.file);
  } catch {
    return [];
  }
}
