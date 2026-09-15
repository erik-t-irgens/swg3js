// Minimal GLB writer: one node per mesh, one primitive per shader group,
// optional embedded PNG textures, vertex colours and hardpoint child nodes.
// SWG is left-handed Y-up (Direct3D); SOE's own Maya exporter negates X, so we
// negate X and reverse winding by default to land in right-handed GLTF space.

function align4(n) {
  return (n + 3) & ~3;
}

export function buildGlb(meshes, { flipX = true, textures = new Map(), skin = null, animations = [], keepZones = false } = {}) {
  const buffers = [];
  const bufferViews = [];
  const accessors = [];
  const materials = [];
  const images = [];
  const gltfTextures = [];
  const materialIndex = new Map();
  const imageIndex = new Map();
  const gltfMeshes = [];
  const nodes = [];
  const rootNodes = [];
  let byteLength = 0;

  const pushView = (bytes, target) => {
    const padded = align4(bytes.length);
    const view = { buffer: 0, byteOffset: byteLength, byteLength: bytes.length };
    if (target) view.target = target;
    bufferViews.push(view);
    buffers.push(bytes, Buffer.alloc(padded - bytes.length));
    byteLength += padded;
    return bufferViews.length - 1;
  };

  const pushAccessor = (arr, type, componentType, target, { bounds = false, normalized = false } = {}) => {
    const view = pushView(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), target);
    const n = { MAT4: 16, VEC4: 4, VEC3: 3, VEC2: 2, SCALAR: 1 }[type];
    const acc = { bufferView: view, componentType, count: arr.length / n, type };
    if (normalized) acc.normalized = true;
    if (bounds) {
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

  const imageFor = (tex) => {
    if (!imageIndex.has(tex.path)) {
      const view = pushView(tex.png);
      images.push({ name: tex.path, mimeType: 'image/png', bufferView: view });
      gltfTextures.push({ source: images.length - 1, sampler: 0 });
      imageIndex.set(tex.path, gltfTextures.length - 1);
    }
    return imageIndex.get(tex.path);
  };

  const materialFor = (shader) => {
    if (!materialIndex.has(shader)) {
      const mat = { name: shader, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 }, doubleSided: false };
      const tex = textures.get(shader);
      if (tex?.invisible) {
        // Drawn as nothing; the runtime may hide the mesh outright, the colliders still see it.
        mat.alphaMode = 'BLEND';
        mat.pbrMetallicRoughness.baseColorFactor = [0, 0, 0, 0];
        mat.extras = { invisible: true };
      } else if (tex) {
        mat.pbrMetallicRoughness.baseColorTexture = { index: imageFor(tex) };
        if (tex.metallic !== undefined) mat.pbrMetallicRoughness.metallicFactor = tex.metallic;
        if (tex.roughness !== undefined) mat.pbrMetallicRoughness.roughnessFactor = tex.roughness;
        if (tex.mr) mat.pbrMetallicRoughness.metallicRoughnessTexture = { index: imageFor({ path: `${tex.path}#mr`, png: tex.mr.png }) };
        if (tex.normal) mat.normalTexture = { index: imageFor({ path: tex.normal.path, png: tex.normal.png }) };
        const mode = tex.alphaMode ?? 'OPAQUE';
        if (mode === 'MASK' && tex.hasAlpha) {
          mat.alphaMode = 'MASK';
          mat.alphaCutoff = 0.5;
          mat.doubleSided = true;
        } else if (mode === 'BLEND' && (tex.hasAlpha || tex.opacity !== undefined)) {
          mat.alphaMode = 'BLEND';
          mat.doubleSided = true;
          // Glass with no alpha in its texture: a fixed share of its tint over what is behind.
          if (tex.opacity !== undefined) mat.pbrMetallicRoughness.baseColorFactor[3] = tex.opacity;
        }
        if (tex.glass) {
          // Marked for the runtime (glass casts no shadow); forced glass is smooth and a little reflective too.
          mat.extras = { ...(mat.extras ?? {}), glass: true };
          if (tex.opacity !== undefined) {
            mat.pbrMetallicRoughness.roughnessFactor = Math.min(mat.pbrMetallicRoughness.roughnessFactor, 0.15);
            mat.pbrMetallicRoughness.metallicFactor = Math.max(mat.pbrMetallicRoughness.metallicFactor, 0.2);
          }
        }
      } else {
        mat.pbrMetallicRoughness.baseColorFactor = [0.8, 0.8, 0.8, 1];
      }
      materials.push(mat);
      materialIndex.set(shader, materials.length - 1);
    }
    return materialIndex.get(shader);
  };

  for (const mesh of meshes) {
    const primitives = [];
    // glTF requires every primitive of a mesh to carry the same morph targets in the same order,
    // and the mesh's single weights array drives all of them. A target usually moves only some of
    // the mesh's shader groups (a jaw blend does nothing to the eyes), so take the union here and
    // let each primitive fill in zeros for the ones that miss it.
    const targetNames = [];
    for (const g of mesh.groups) {
      for (const prim of g.primitives) {
        for (const t of prim.targets ?? []) if (!targetNames.includes(t.name)) targetNames.push(t.name);
      }
    }
    // One zero block per vertex count, shared by every primitive that needs a no-op target.
    const zeroAccessor = new Map();
    const zerosFor = (count) => {
      let a = zeroAccessor.get(count);
      if (a === undefined) {
        a = pushAccessor(new Float32Array(count * 3), 'VEC3', 5126, 34962, { bounds: true });
        zeroAccessor.set(count, a);
      }
      return a;
    };
    for (const g of mesh.groups) {
      for (const p of g.primitives) {
        const positions = flipX ? negateX(p.positions) : p.positions;
        const normals = p.normals ? (flipX ? negateX(p.normals) : p.normals) : null;
        const indices = flipX ? reverseWinding(p.indices) : p.indices;
        const attributes = { POSITION: pushAccessor(positions, 'VEC3', 5126, 34962, { bounds: true }) };
        if (normals) attributes.NORMAL = pushAccessor(normals, 'VEC3', 5126, 34962);
        if (p.uvs) attributes.TEXCOORD_0 = pushAccessor(p.uvs, 'VEC2', 5126, 34962);
        if (p.colors) attributes.COLOR_0 = pushAccessor(p.colors, 'VEC4', 5121, 34962, { normalized: true });
        if (p.joints) attributes.JOINTS_0 = pushAccessor(p.joints, 'VEC4', 5123, 34962);
        if (p.weights) attributes.WEIGHTS_0 = pushAccessor(p.weights, 'VEC4', 5126, 34962);
        const idx = indices instanceof Uint16Array ? indices : Uint32Array.from(indices);
        const prim = {
          attributes,
          indices: pushAccessor(idx, 'SCALAR', idx instanceof Uint16Array ? 5123 : 5125, 34963),
          material: materialFor(g.shader),
          mode: 4,
        };
        // Morph targets: the character creator's shape sliders. A target's POSITION accessor
        // needs min/max like any other, and its deltas mirror in X with the mesh they belong to.
        if (targetNames.length) {
          const own = new Map((p.targets ?? []).map((t) => [t.name, t]));
          const count = p.positions.length / 3;
          prim.targets = targetNames.map((name) => {
            const t = own.get(name);
            if (!t) {
              const entry = { POSITION: zerosFor(count) };
              if (normals) entry.NORMAL = zerosFor(count);
              return entry;
            }
            const entry = { POSITION: pushAccessor(flipX ? negateX(t.positions) : t.positions, 'VEC3', 5126, 34962, { bounds: true }) };
            if (normals) entry.NORMAL = t.normals ? pushAccessor(flipX ? negateX(t.normals) : t.normals, 'VEC3', 5126, 34962) : zerosFor(count);
            return entry;
          });
        }
        // Occlusion: which zone combination each triangle belongs to, so the game can hide the
        // skin under a shirt at run time instead of the converter deciding once and for all.
        if (p.zones?.length && keepZones) prim.extras = { zones: Array.from(p.zones) };
        primitives.push(prim);
      }
    }
    const gltfMesh = { name: mesh.name, primitives };
    if (mesh.extras) gltfMesh.extras = { ...mesh.extras };
    if (targetNames.length) {
      // glTF carries morph target names in the mesh's extras, where every loader (three included)
      // looks for them; weights start at zero so a fresh model is the unmorphed shape.
      gltfMesh.weights = targetNames.map(() => 0);
      gltfMesh.extras = { ...(gltfMesh.extras ?? {}), targetNames };
    }
    gltfMeshes.push(gltfMesh);
    const node = { name: mesh.name, mesh: gltfMeshes.length - 1 };
    if (mesh.bounds) node.extras = { bounds: mesh.bounds };
    nodes.push(node);
    const meshNode = nodes.length - 1;
    rootNodes.push(meshNode);
    for (const hp of mesh.hardpoints ?? []) {
      const [x, y, z] = hp.position;
      nodes.push({ name: `hp:${hp.name}`, translation: [flipX ? -x : x, y, z] });
      (nodes[meshNode].children ??= []).push(nodes.length - 1);
    }
  }

  // Skinned models: joint nodes (already in GLTF space), one skin shared by every mesh node,
  // and baked animations as per-frame rotation and translation samplers.
  let skins;
  let gltfAnimations;
  if (skin) {
    const jointNodeIndex = [];
    const meshNodeCount = nodes.length;
    skin.joints.forEach((j) => {
      nodes.push({ name: j.name, translation: j.translation, rotation: [j.rotation[1], j.rotation[2], j.rotation[3], j.rotation[0]] });
      jointNodeIndex.push(nodes.length - 1);
    });
    skin.joints.forEach((j, i) => {
      if (j.parent >= 0) (nodes[jointNodeIndex[j.parent]].children ??= []).push(jointNodeIndex[i]);
      else rootNodes.push(jointNodeIndex[i]);
    });
    const ibm = new Float32Array(skin.inverseBind.length * 16);
    skin.inverseBind.forEach((m, i) => ibm.set(m, i * 16));
    const skeletonRoot = skin.joints.findIndex((j) => j.parent < 0);
    skins = [{ joints: jointNodeIndex, inverseBindMatrices: pushAccessor(ibm, 'MAT4', 5126), skeleton: jointNodeIndex[Math.max(0, skeletonRoot)] }];
    for (let i = 0; i < meshNodeCount; i++) if (nodes[i].mesh !== undefined) nodes[i].skin = 0;
    gltfAnimations = [];
    for (const clip of animations) {
      const input = pushAccessor(clip.times, 'SCALAR', 5126, undefined, { bounds: true });
      const samplers = [];
      const channels = [];
      clip.tracks.forEach((t, i) => {
        samplers.push({ input, output: pushAccessor(t.rotations, 'VEC4', 5126), interpolation: 'LINEAR' });
        channels.push({ sampler: samplers.length - 1, target: { node: jointNodeIndex[i], path: 'rotation' } });
        samplers.push({ input, output: pushAccessor(t.translations, 'VEC3', 5126), interpolation: 'LINEAR' });
        channels.push({ sampler: samplers.length - 1, target: { node: jointNodeIndex[i], path: 'translation' } });
      });
      gltfAnimations.push({ name: clip.name, samplers, channels });
    }
  }

  const json = {
    asset: { version: '2.0', generator: 'swg3js converter' },
    scene: 0,
    scenes: [{ nodes: rootNodes }],
    nodes,
    meshes: gltfMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  if (skins) json.skins = skins;
  if (gltfAnimations && gltfAnimations.length) json.animations = gltfAnimations;
  if (images.length) {
    json.images = images;
    json.textures = gltfTextures;
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
  }
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

function negateX(arr) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i += 3) {
    out[i] = -arr[i];
    out[i + 1] = arr[i + 1];
    out[i + 2] = arr[i + 2];
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
