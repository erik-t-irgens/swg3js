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

/** A flat quad in the order its corners are given (two triangles, 0-1-2 and 0-2-3), as a doorway or a floor is drawn in Blender. */
export function quad(corners: number[][], material?: number): RawPrim {
  return { positions: corners.flat(), normals: corners.flatMap(() => [0, 0, 1]), indices: [0, 1, 2, 0, 2, 3], ...(material !== undefined ? { material } : {}) };
}

/** The TEST house's rooms in the house's own frame: what its tests hold the import to. */
export const TEST_HOUSE = {
  /** The front doorway (outside to the hall) at z 0, and the inner one (the hall to the parlour) at z -5: 1.2 m wide, 0.1 to 2.2 m up. */
  front: { z: 0, x: 0.6, y0: 0.1, y1: 2.2 },
  inner: { z: -5, x: 0.6, y0: 0.1, y1: 2.2 },
  /** Where the hall's own pieces end toward the street (its front wall's face): the front doorway stands 0.1 m past it. */
  hallFront: -0.1,
  /** A point in each room, a metre up. */
  inHall: [0, 1, -2.5],
  inParlour: [0, 1, -7.5],
  /** The hall's lamp (under its cell, range 16) and the parlour's (under no cell, standing in its box, no range named). */
  hallLamp: { at: [0, 2.6, -2.5], intensity: 10, range: 16, color: [1, 0.9, 0.7] },
  parlourLamp: { at: [0, 2.6, -7.5], intensity: 8, color: [0.8, 0.85, 1] },
  hallAmbient: [0.12, 0.12, 0.14],
  doorStyle: 'cantina_door',
};

/**
 * The TEST house: a shell 8 m by 10 m and 3.2 m to its roof (cell 0, with a real hole where its front doorway is) and two
 * rooms inside it, each walled, floored and ceilinged by its own pieces: the hall (cell 1, behind the front doorway) and the
 * parlour (cell 2, behind the hall through a doorway in their shared wall). Its doorways are `portal:0:1` and `portal:1:2`,
 * its floors `floor:1` (in two halves meeting at an edge, one half drawn upside down, as a careless hand might) and `floor:2`,
 * its front door `door:cantina_door`, a lamp under the hall with a range, a lamp under no cell standing in the parlour with
 * none, and the hall an ambient of its own. Every part where a node puts it (the doorways and two of the floor halves drawn
 * about their own origins and moved, two of them turned, into place), its origin on its doorstep's ground line, as Blender's
 * exporter writes it.
 */
export function testHouse(): RawGltf {
  const walls = 0;
  const floor = 1;
  const roof = 2;
  // One box mesh a material, every piece a node of it at its own place and size (half sizes, Blender's default cube being 2 m).
  const box = (name: string, mesh: number, c: number[], h: number[]) => ({ name, mesh, translation: c, scale: h });
  // A wall across x from -w to w at depth z, 0.1 m thick, from y0 to y1, with a doorway 1.2 m wide and 2.2 m high in its
  // middle where `door`: its left, right and over-the-door pieces.
  const wall = (name: string, z: number, w: number, y0: number, y1: number, door: boolean) => {
    const h = (y1 - y0) / 2;
    if (!door) return [box(name, walls, [0, y0 + h, z], [w, h, 0.05])];
    const side = (w - 0.6) / 2;
    return [
      box(`${name}L`, walls, [-(0.6 + side), y0 + h, z], [side, h, 0.05]),
      box(`${name}R`, walls, [0.6 + side, y0 + h, z], [side, h, 0.05]),
      box(`${name}Top`, walls, [0, 2.2 + (y1 - 2.2) / 2, z], [0.6, (y1 - 2.2) / 2, 0.05]),
    ];
  };
  const room = (z0: number, z1: number, front: boolean, back: boolean, label: string) => {
    const mid = (z0 + z1) / 2;
    const half = (z0 - z1) / 2;
    return [
      box(`${label}Floor`, floor, [0, 0.05, mid], [3.8, 0.05, half]),
      box(`${label}Ceiling`, roof, [0, 3.0, mid], [3.8, 0.05, half]),
      box(`${label}WallL`, walls, [-3.8, 1.55, mid], [0.05, 1.45, half]),
      box(`${label}WallR`, walls, [3.8, 1.55, mid], [0.05, 1.45, half]),
      ...wall(`${label}Front`, z0, 3.8, 0.1, 3.0, front),
      ...wall(`${label}Back`, z1, 3.8, 0.1, 3.0, back),
    ];
  };
  const shellPieces = [
    box('ShellFrontL', walls, [-2.3, 1.6, 0], [1.7, 1.6, 0.1]),
    box('ShellFrontR', walls, [2.3, 1.6, 0], [1.7, 1.6, 0.1]),
    box('ShellFrontTop', walls, [0, 2.7, 0], [0.6, 0.5, 0.1]),
    box('ShellBack', walls, [0, 1.6, -10], [4, 1.6, 0.1]),
    box('ShellLeft', walls, [-4, 1.6, -5], [0.1, 1.6, 5]),
    box('ShellRight', walls, [4, 1.6, -5], [0.1, 1.6, 5]),
    box('ShellRoof', roof, [0, 3.3, -5], [4.2, 0.1, 5.2]),
  ];
  const hallPieces = room(-0.15, -4.95, true, true, 'Hall');
  const parlourPieces = room(-5.05, -9.85, true, false, 'Parlour');
  const nodes: Record<string, unknown>[] = [];
  const add = (n: Record<string, unknown>) => {
    nodes.push(n);
    return nodes.length - 1;
  };
  const kids = (list: Record<string, unknown>[]) => list.map(add);
  const H = TEST_HOUSE;
  const shell = add({ name: 'cell:0:shell' });
  nodes[shell].children = kids(shellPieces);
  const hall = add({ name: 'cell:1:hall', extras: { ambient: H.hallAmbient } });
  nodes[hall].children = [...kids(hallPieces), add({ name: 'Lamp', translation: H.hallLamp.at, extensions: { KHR_lights_punctual: { light: 0 } } })];
  const parlour = add({ name: 'cell:2:parlour' });
  nodes[parlour].children = kids(parlourPieces);
  // The doorways and the floors are placed as Blender writes an object moved into place: their corners about the object's
  // own origin, the node's translation (and on two a turn) putting them where they stand, so the pass must bake the node.
  // The front doorway stands about its own middle; the inner one is drawn lying flat (a plane in Blender's default pose),
  // stood up by a quarter turn about X and moved back to its wall.
  const F = H.front;
  const I = H.inner;
  const frontMid = (F.y0 + F.y1) / 2;
  add({ name: 'portal:0:1', mesh: 3, translation: [0, frontMid, F.z] });
  add({ name: 'portal:1:2', mesh: 4, translation: [0, 0, I.z], rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] });
  add({ name: 'floor:1', mesh: 5 });
  // The hall's second half drawn about its own middle and turned half round about up; the parlour's moved into place.
  add({ name: 'floor:1.001', mesh: 6, translation: [0, 0.1, -3.7], rotation: yawQ(Math.PI) });
  add({ name: 'floor:2', mesh: 7, translation: [0, 0.1, -7.45] });
  add({ name: `door:${H.doorStyle}`, translation: [0, H.front.y0, H.front.z] });
  add({ name: 'Lamp.001', translation: H.parlourLamp.at, extensions: { KHR_lights_punctual: { light: 1 } } });
  const frontLocal = [
    [-F.x, F.y0 - frontMid, 0],
    [F.x, F.y0 - frontMid, 0],
    [F.x, F.y1 - frontMid, 0],
    [-F.x, F.y1 - frontMid, 0],
  ];
  // Lying flat in its own frame: a quarter turn about X takes (x, 0, z) to (x, -z, 0), so its z is minus its height.
  const innerLocal = [
    [-I.x, 0, -I.y0],
    [I.x, 0, -I.y0],
    [I.x, 0, -I.y1],
    [-I.x, 0, -I.y1],
  ];
  return {
    materials: [
      { name: 'Walls', pbrMetallicRoughness: { baseColorFactor: [0.75, 0.68, 0.55, 1], metallicFactor: 0, roughnessFactor: 0.85 }, doubleSided: true },
      { name: 'Floor', pbrMetallicRoughness: { baseColorFactor: [0.42, 0.3, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.7 }, doubleSided: true },
      { name: 'Roof', pbrMetallicRoughness: { baseColorFactor: [0.4, 0.25, 0.18, 1], metallicFactor: 0, roughnessFactor: 0.9 }, doubleSided: true },
    ],
    meshes: [
      { name: 'Cube', primitives: [cube(walls)] },
      { name: 'Cube.001', primitives: [cube(floor)] },
      { name: 'Cube.002', primitives: [cube(roof)] },
      { name: 'Doorway', primitives: [quad(frontLocal)] },
      { name: 'Doorway.001', primitives: [quad(innerLocal)] },
      // The hall's floor in two halves meeting at z -2.5; the second wound face down, as a careless hand might leave it.
      // In the house's frame: A from z -0.1 to -2.5, B from -2.5 to -4.9 (about its middle at -3.7, turned half round, so its
      // corners are the house's own with x and z turned over), the parlour's from -5.1 to -9.8 (about -7.45).
      { name: 'HallFloorA', primitives: [quad([[-3.75, 0.1, -0.1], [3.75, 0.1, -0.1], [3.75, 0.1, -2.5], [-3.75, 0.1, -2.5]])] },
      { name: 'HallFloorB', primitives: [quad([[3.75, 0, -1.2], [3.75, 0, 1.2], [-3.75, 0, 1.2], [-3.75, 0, -1.2]])] },
      { name: 'ParlourFloor', primitives: [quad([[-3.75, 0, 2.35], [3.75, 0, 2.35], [3.75, 0, -2.35], [-3.75, 0, -2.35]])] },
    ],
    nodes,
    scenes: [{ nodes: nodes.map((_, i) => i).filter((i) => !nodes.some((n) => ((n.children as number[] | undefined) ?? []).includes(i))) }],
    extensionsUsed: ['KHR_lights_punctual'],
    extensions: { KHR_lights_punctual: { lights: [{ type: 'point', color: H.hallLamp.color, intensity: H.hallLamp.intensity, range: H.hallLamp.range }, { type: 'point', color: H.parlourLamp.color, intensity: H.parlourLamp.intensity }] } },
  };
}

/** The record the TEST house is imported with: a building, its rooms read off its names. */
export const TEST_HOUSE_RECORD = { id: 'test_house', name: 'TEST house', group: 'TEST', kind: 'building', collision: 'auto', look: 'pbr', ship: false };

// Run as a script: the TEST hut, the TEST plate and the TEST house with their records, into the folder named.
if (process.argv[1] && /blenderGlb\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  const dir = process.argv[2];
  if (!dir) {
    console.log('node tools/swg/tests/blenderGlb.ts <dir>: writes test_hut.glb, test_plate.glb and test_house.glb with their records');
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'test_hut.glb'), writeRawGlb(testHut()));
  writeFileSync(join(dir, 'test_hut.import.json'), `${JSON.stringify(TEST_HUT_RECORD, null, 2)}\n`);
  writeFileSync(join(dir, 'test_plate.glb'), writeRawGlb(testPlate()));
  writeFileSync(join(dir, 'test_plate.import.json'), `${JSON.stringify(TEST_PLATE_RECORD, null, 2)}\n`);
  writeFileSync(join(dir, 'test_house.glb'), writeRawGlb(testHouse()));
  writeFileSync(join(dir, 'test_house.import.json'), `${JSON.stringify(TEST_HOUSE_RECORD, null, 2)}\n`);
  console.log(`wrote the TEST hut, the TEST plate and the TEST house into ${dir}`);
}
