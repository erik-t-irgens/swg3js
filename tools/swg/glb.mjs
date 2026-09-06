// Minimal GLB writer: one node per mesh, one primitive per shader group, no textures yet.

function align4(n) {
  return (n + 3) & ~3;
}

export function buildGlb(meshes, { flipZ = false } = {}) {
  const buffers = [];
  const bufferViews = [];
  const accessors = [];
  const materials = [];
  const materialIndex = new Map();
  const gltfMeshes = [];
  const nodes = [];
  let byteLength = 0;

  const pushView = (arr, target) => {
    const bytes = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const padded = align4(bytes.length);
    const view = { buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target };
    bufferViews.push(view);
    buffers.push(bytes, Buffer.alloc(padded - bytes.length));
    byteLength += padded;
    return bufferViews.length - 1;
  };

  const pushAccessor = (arr, type, componentType, target, withBounds) => {
    const view = pushView(arr, target);
    const n = type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1;
    const acc = { bufferView: view, componentType, count: arr.length / n, type };
    if (withBounds) {
      const min = Array(n).fill(Infinity);
      const max = Array(n).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) {
        min[i % n] = Math.min(min[i % n], arr[i]);
        max[i % n] = Math.max(max[i % n], arr[i]);
      }
      acc.min = min;
      acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  const materialFor = (name) => {
    if (!materialIndex.has(name)) {
      materials.push({ name, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true });
      materialIndex.set(name, materials.length - 1);
    }
    return materialIndex.get(name);
  };

  for (const mesh of meshes) {
    const primitives = [];
    for (const g of mesh.groups) {
      for (const p of g.primitives) {
        const positions = flipZ ? flip(p.positions) : p.positions;
        const normals = p.normals ? (flipZ ? flip(p.normals) : p.normals) : null;
        const indices = flipZ ? reverseWinding(p.indices) : p.indices;
        const attributes = { POSITION: pushAccessor(positions, 'VEC3', 5126, 34962, true) };
        if (normals) attributes.NORMAL = pushAccessor(normals, 'VEC3', 5126, 34962, false);
        if (p.uvs) attributes.TEXCOORD_0 = pushAccessor(p.uvs, 'VEC2', 5126, 34962, false);
        const idx = indices instanceof Uint16Array ? indices : Uint32Array.from(indices);
        primitives.push({ attributes, indices: pushAccessor(idx, 'SCALAR', idx instanceof Uint16Array ? 5123 : 5125, 34963, false), material: materialFor(g.shader), mode: 4 });
      }
    }
    gltfMeshes.push({ name: mesh.name, primitives });
    nodes.push({ name: mesh.name, mesh: gltfMeshes.length - 1 });
  }

  const json = {
    asset: { version: '2.0', generator: 'swg3js converter' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gltfMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPadded = align4(jsonBytes.length);
  const bin = Buffer.concat(buffers);
  const total = 12 + 8 + jsonPadded + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.write('glTF', 0, 'latin1');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPadded, 12);
  out.write('JSON', 16, 'latin1');
  jsonBytes.copy(out, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded);
  const binStart = 20 + jsonPadded;
  out.writeUInt32LE(bin.length, binStart);
  out.write('BIN\0', binStart + 4, 'latin1');
  bin.copy(out, binStart + 8);
  return out;
}

function flip(arr) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i += 3) {
    out[i] = arr[i];
    out[i + 1] = arr[i + 1];
    out[i + 2] = -arr[i + 2];
  }
  return out;
}

function reverseWinding(idx) {
  const out = idx.slice();
  for (let i = 0; i + 2 < out.length; i += 3) {
    const t = out[i + 1];
    out[i + 1] = out[i + 2];
    out[i + 2] = t;
  }
  return out;
}
