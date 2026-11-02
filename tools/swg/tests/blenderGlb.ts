// A glTF in the shape Blender's glTF 2.0 exporter writes at its defaults, built in node out of nothing of the game's: every
// object a node with its own place, turn and size, a linked duplicate a second node on the same mesh, materials
// double-sided, tangents left out, punctual lights where asked. What the import pass's tests read through the pass and the
// game's own `AssetPack`, and what the wave's smoke imports (the TEST hut and the TEST plate). Not a test itself.
//
// Run as a script it writes the TEST hut and the TEST plate into a folder: node tools/swg/tests/blenderGlb.ts <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGlb, readGlb } from '../sceneglb.mjs';
import { encodePng } from '../png.mjs';

/** One primitive as the test writes it: plain arrays, written as the exporter writes them (floats, short indices). */
export interface RawPrim {
  positions: number[];
  normals?: number[];
  uvs?: number[];
  tangents?: number[];
  indices: number[];
  material?: number;
  mode?: number;
}

/** A whole glTF document in the test's words: meshes of `RawPrim`s and pictures as PNG bytes; every other field as glTF has it. */
export interface RawGltf {
  nodes: Record<string, unknown>[];
  meshes: { name?: string; primitives: RawPrim[] }[];
  materials?: Record<string, unknown>[];
  textures?: Record<string, unknown>[];
  images?: { name?: string; png: Uint8Array | Buffer; uri?: string }[];
  scenes?: { name?: string; nodes: number[] }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  extensions?: Record<string, unknown>;
  animations?: unknown[];
}

/** The document written as a GLB, every array in one binary chunk. */
export function writeRawGlb(doc: RawGltf): Buffer {
  const parts: Buffer[] = [];
  const views: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  let length = 0;
  const view = (b: Buffer, target?: number): number => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      parts.push(Buffer.alloc(pad));
      length += pad;
    }
    parts.push(b);
    views.push({ buffer: 0, byteOffset: length, byteLength: b.length, ...(target ? { target } : {}) });
    length += b.length;
    return views.length - 1;
  };
  const acc = (values: number[], type: string, size: number, ints = false, minmax = false): number => {
    const arr = ints ? Uint16Array.from(values) : Float32Array.from(values);
    const a: Record<string, unknown> = { bufferView: view(Buffer.from(arr.buffer), ints ? 34963 : 34962), componentType: ints ? 5123 : 5126, count: values.length / size, type };
    if (minmax) {
      const min = new Array(size).fill(Infinity);
      const max = new Array(size).fill(-Infinity);
      values.forEach((v, i) => {
        min[i % size] = Math.min(min[i % size], v);
        max[i % size] = Math.max(max[i % size], v);
      });
      a.min = min;
      a.max = max;
    }
    accessors.push(a);
    return accessors.length - 1;
  };
  const meshes = doc.meshes.map((m) => ({
    ...(m.name ? { name: m.name } : {}),
    primitives: m.primitives.map((p) => {
      const attributes: Record<string, number> = { POSITION: acc(p.positions, 'VEC3', 3, false, true) };
      if (p.normals) attributes.NORMAL = acc(p.normals, 'VEC3', 3);
      if (p.uvs) attributes.TEXCOORD_0 = acc(p.uvs, 'VEC2', 2);
      if (p.tangents) attributes.TANGENT = acc(p.tangents, 'VEC4', 4);
      return { attributes, indices: acc(p.indices, 'SCALAR', 1, true), ...(p.material !== undefined ? { material: p.material } : {}), ...(p.mode !== undefined ? { mode: p.mode } : {}) };
    }),
  }));
  const images = (doc.images ?? []).map((im) => (im.uri ? { uri: im.uri, ...(im.name ? { name: im.name } : {}) } : { bufferView: view(Buffer.from(im.png)), mimeType: 'image/png', ...(im.name ? { name: im.name } : {}) }));
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'Khronos glTF Blender I/O (a test of ours)' },
    scene: 0,
    scenes: doc.scenes ?? [{ nodes: doc.nodes.map((_, i) => i).filter((i) => !doc.nodes.some((n) => ((n.children as number[] | undefined) ?? []).includes(i))) }],
    nodes: doc.nodes,
    meshes,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: length }],
  };
  if (doc.materials) json.materials = doc.materials;
  if (doc.textures) json.textures = doc.textures;
  if (images.length) json.images = images;
  if (doc.textures?.length) json.samplers = [{ magFilter: 9729, minFilter: 9987 }];
  if (doc.extensionsUsed) json.extensionsUsed = doc.extensionsUsed;
  if (doc.extensionsRequired) json.extensionsRequired = doc.extensionsRequired;
  if (doc.extensions) json.extensions = doc.extensions;
  if (doc.animations) json.animations = doc.animations;
  return buildGlb(json, Buffer.concat(parts));
}

/**
 * The document written as Blender's "glTF Separate" writes it: `<stem>.gltf`, its arrays in `<stem>.bin` beside it, and
 * every picture a PNG of its own in a folder beside them (`pictures`, a name with a space in it, so a picture's address is
 * written encoded as the exporter writes one). Answers the `.gltf`'s path.
 */
export function writeRawGltf(doc: RawGltf, dir: string, stem: string, pictures = 'my textures'): string {
  const { json, bin } = readGlb(writeRawGlb(doc)) as { json: Record<string, unknown> & { images?: Record<string, unknown>[]; bufferViews: { byteOffset?: number; byteLength: number }[]; buffers: Record<string, unknown>[] }; bin: Buffer };
  mkdirSync(join(dir, pictures), { recursive: true });
  (json.images ?? []).forEach((im, i) => {
    const v = json.bufferViews[im.bufferView as number];
    const name = `${(im.name as string | undefined) ?? `picture${i}`}.png`;
    writeFileSync(join(dir, pictures, name), bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
    delete im.bufferView;
    delete im.mimeType;
    im.uri = `${encodeURIComponent(pictures)}/${encodeURIComponent(name)}`;
  });
  json.buffers[0].uri = `${stem}.bin`;
  writeFileSync(join(dir, `${stem}.bin`), bin);
  const file = join(dir, `${stem}.gltf`);
  writeFileSync(file, JSON.stringify(json, null, 2));
  return file;
}

/** Blender's default cube in its own space: 2 m a side about its origin, 24 corners, its faces' normals and coordinates. */
export function cube(material?: number): RawPrim {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, v] of faces) {
    const base = positions.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      positions.push(n[0] + a * u[0] + b * v[0], n[1] + a * u[1] + b * v[1], n[2] + a * u[2] + b * v[2]);
      normals.push(...n);
      uvs.push((a + 1) / 2, (1 - b) / 2);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, uvs, indices, ...(material !== undefined ? { material } : {}) };
}

/** A flat square plate of `size` metres about its origin, facing +Z (a picture on a wall), its coordinates the image's. */
export function plate(size: number, material?: number): RawPrim {
  const h = size / 2;
  return { positions: [-h, -h, 0, h, -h, 0, h, h, 0, -h, h, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], uvs: [0, 1, 1, 1, 1, 0, 0, 0], indices: [0, 1, 2, 0, 2, 3], ...(material !== undefined ? { material } : {}) };
}

/** A plain colour, as a PNG of `n` texels. */
export function solidPng(n: number, rgba: [number, number, number, number]): Buffer {
  const px = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) px.set(rgba, i * 4);
  return encodePng(n, n, px);
}

/**
 * A normal map of our own: a dome in the middle of a flat field, written the glTF way (+X right, +Y up the picture, +Z out
 * of it): lit from the picture's top, a dome read the right way up is bright on its upper half; read upside down it is a
 * dent, bright on its lower half. `n` texels a side.
 */
export function domeNormalPng(n = 128): Buffer {
  const px = new Uint8Array(n * n * 4);
  const c = (n - 1) / 2;
  const R = n * 0.38;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x - c) / R;
      const dy = (c - y) / R;
      const r2 = dx * dx + dy * dy;
      let nx = 0;
      let ny = 0;
      let nz = 1;
      if (r2 < 0.98) {
        nx = dx;
        ny = dy;
        nz = Math.sqrt(1 - r2);
      }
      const i = (y * n + x) * 4;
      px[i] = Math.round((nx * 0.5 + 0.5) * 255);
      px[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      px[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      px[i + 3] = 255;
    }
  }
  return encodePng(n, n, px);
}

/** A quaternion about +Y, [x, y, z, w]. */
export function yawQ(rad: number): number[] {
  return [0, Math.sin(rad / 2), 0, Math.cos(rad / 2)];
}

/**
 * The TEST hut: a floor, four walls with a doorway in the front one, a roof scaled from the default cube and lifted, a linked
 * duplicate post either side of the door (one mesh, two nodes), a sign the hut is never solid at (`-nocol`), plain boxes
 * standing in for its walls and floor as its colliders (`-colonly`, so its doorway stays open and nothing else collides), and
 * a lower level of one box (`_LOD1`). 6 m by 6 m, 3 m to its eaves, its origin on its doorstep's ground line. Every part
 * where a node puts it, as an exporter writes it.
 */
export function testHut(): RawGltf {
  const wall = 0; // material: the walls
  const roof = 1;
  const sign = 2;
  return {
    materials: [
      { name: 'Walls', pbrMetallicRoughness: { baseColorFactor: [0.72, 0.6, 0.45, 1], metallicFactor: 0, roughnessFactor: 0.8 }, doubleSided: true },
      { name: 'Roof', pbrMetallicRoughness: { baseColorFactor: [0.35, 0.22, 0.15, 1], metallicFactor: 0, roughnessFactor: 0.9 }, doubleSided: true },
      { name: 'Sign', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.75, 1], metallicFactor: 0 }, doubleSided: true },
    ],
    meshes: [
      { name: 'Cube', primitives: [cube(wall)] },
      { name: 'Cube.001', primitives: [cube(roof)] },
      { name: 'Post', primitives: [cube(wall)] },
      { name: 'Sign', primitives: [cube(sign)] },
      { name: 'Stand', primitives: [cube(wall)] },
      { name: 'Low', primitives: [cube(wall)] },
    ],
    nodes: [
      { name: 'Floor', mesh: 0, translation: [0, 0.05, -3], scale: [3, 0.05, 3] },
      { name: 'WallBack', mesh: 0, translation: [0, 1.5, -6], scale: [3, 1.5, 0.1] },
      { name: 'WallLeft', mesh: 0, translation: [-3, 1.5, -3], scale: [0.1, 1.5, 3] },
      { name: 'WallRight', mesh: 0, translation: [3, 1.5, -3], scale: [0.1, 1.5, 3] },
      { name: 'WallFrontL', mesh: 0, translation: [-2, 1.5, 0], scale: [1, 1.5, 0.1] },
      { name: 'WallFrontR', mesh: 0, translation: [2, 1.5, 0], scale: [1, 1.5, 0.1] },
      { name: 'Roof', mesh: 1, translation: [0, 3.2, -3], rotation: yawQ(Math.PI / 2), scale: [3.4, 0.2, 3.4] },
      { name: 'PostL', mesh: 2, translation: [-1, 1.2, 0.6], scale: [0.1, 1.2, 0.1] },
      { name: 'PostR', mesh: 2, translation: [1, 1.2, 0.6], scale: [0.1, 1.2, 0.1] },
      { name: 'Sign-nocol', mesh: 3, translation: [0, 2.6, 0.7], scale: [0.6, 0.2, 0.03] },
      { name: 'StandBack-colonly', mesh: 4, translation: [0, 1.6, -6], scale: [3.1, 1.6, 0.15] },
      { name: 'StandLeft-colonly', mesh: 4, translation: [-3, 1.6, -3], scale: [0.15, 1.6, 3.1] },
      { name: 'StandRight-colonly', mesh: 4, translation: [3, 1.6, -3], scale: [0.15, 1.6, 3.1] },
      { name: 'StandFrontL-colonly', mesh: 4, translation: [-2, 1.6, 0], scale: [1.05, 1.6, 0.15] },
      { name: 'StandFrontR-colonly', mesh: 4, translation: [2, 1.6, 0], scale: [1.05, 1.6, 0.15] },
      { name: 'StandFloor-colonly', mesh: 4, translation: [0, 0.05, -3], scale: [3, 0.05, 3] },
      { name: 'Hut_LOD1', mesh: 5, translation: [0, 1.7, -3], scale: [3.2, 1.7, 3.2] },
    ],
  };
}

/** The record the TEST hut is imported with: a building with no rooms, its lower level at 30 m. */
export const TEST_HUT_RECORD = { id: 'test_hut', name: 'TEST hut', group: 'TEST', kind: 'building', collision: 'auto', look: 'pbr', lods: [30], ship: false };

/**
 * The TEST plate: a plate 2 m square standing upright on a short post, facing +Z, wearing the dome normal map with no
 * tangents (as Blender exports one), its grey surface rough so the dome's light is all diffuse.
 */
export function testPlate(): RawGltf {
  return {
    materials: [
      { name: 'Bump', pbrMetallicRoughness: { baseColorFactor: [0.75, 0.75, 0.75, 1], metallicFactor: 0, roughnessFactor: 0.9 }, normalTexture: { index: 0 }, doubleSided: true },
      { name: 'Post', pbrMetallicRoughness: { baseColorFactor: [0.3, 0.3, 0.3, 1], metallicFactor: 0 } },
    ],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ name: 'dome_normal', png: domeNormalPng(128) }],
    meshes: [
      { name: 'Plate', primitives: [plate(2, 0)] },
      { name: 'Post', primitives: [cube(1)] },
    ],
    nodes: [
      { name: 'Plate', mesh: 0, translation: [0, 1.6, 0] },
      { name: 'Post', mesh: 1, translation: [0, 0.3, -0.05], scale: [0.05, 0.3, 0.05] },
    ],
  };
}

export const TEST_PLATE_RECORD = { id: 'test_plate', name: 'TEST plate', group: 'TEST', kind: 'prop', collision: 'auto', look: 'pbr', ship: false };

// Run as a script: the TEST hut and the TEST plate with their records, into the folder named.
if (process.argv[1] && /blenderGlb\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  const dir = process.argv[2];
  if (!dir) {
    console.log('node tools/swg/tests/blenderGlb.ts <dir>: writes test_hut.glb and test_plate.glb with their records');
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'test_hut.glb'), writeRawGlb(testHut()));
  writeFileSync(join(dir, 'test_hut.import.json'), `${JSON.stringify(TEST_HUT_RECORD, null, 2)}\n`);
  writeFileSync(join(dir, 'test_plate.glb'), writeRawGlb(testPlate()));
  writeFileSync(join(dir, 'test_plate.import.json'), `${JSON.stringify(TEST_PLATE_RECORD, null, 2)}\n`);
  console.log(`wrote the TEST hut and the TEST plate into ${dir}`);
}
