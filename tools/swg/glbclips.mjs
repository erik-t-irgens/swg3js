// Reading a converted GLB back and swapping its animation clips, so retargeted animations can be
// re-imported into an existing player model without reconverting it from the archives.
// GLB: 12-byte header, a JSON chunk, a BIN chunk. New clips go into accessors appended to BIN.

function align4(n) {
  return (n + 3) & ~3;
}

/** Split a GLB into its JSON document and binary buffer. */
export function readGlb(buf) {
  if (buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a GLB file');
  const jsonLength = buf.readUInt32LE(12);
  if (buf.toString('latin1', 16, 20) !== 'JSON') throw new Error('GLB without a JSON chunk first');
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength));
  const binStart = 20 + jsonLength;
  let bin = Buffer.alloc(0);
  if (binStart + 8 <= buf.length && buf.toString('latin1', binStart + 4, binStart + 8) === 'BIN\0') {
    const binLength = buf.readUInt32LE(binStart);
    bin = buf.subarray(binStart + 8, binStart + 8 + binLength);
  }
  return { json, bin };
}

/** Assemble a GLB from a JSON document and its binary buffer. */
export function writeGlb(json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPadded = align4(jsonBytes.length);
  const binPadded = align4(bin.length);
  const total = 12 + 8 + jsonPadded + 8 + binPadded;
  const out = Buffer.alloc(total);
  out.write('glTF', 0, 'latin1');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPadded, 12);
  out.write('JSON', 16, 'latin1');
  jsonBytes.copy(out, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded);
  const binStart = 20 + jsonPadded;
  out.writeUInt32LE(binPadded, binStart);
  out.write('BIN\0', binStart + 4, 'latin1');
  bin.copy(out, binStart + 8);
  return out;
}

/**
 * The skin's joints in the converter's shape ({ name, parent, rotation [w,x,y,z], translation }),
 * in skin order, plus each joint's node index.
 */
export function skinJoints(json) {
  const skin = json.skins?.[0];
  if (!skin) throw new Error('the GLB has no skin');
  const nodeToJoint = new Map(skin.joints.map((n, i) => [n, i]));
  const parentOf = new Map();
  json.nodes.forEach((node, i) => {
    for (const c of node.children ?? []) parentOf.set(c, i);
  });
  const joints = skin.joints.map((n) => {
    const node = json.nodes[n];
    const r = node.rotation ?? [0, 0, 0, 1];
    let p = parentOf.get(n);
    // Parents outside the skin (a scene root) count as none.
    while (p !== undefined && !nodeToJoint.has(p)) p = parentOf.get(p);
    return { name: node.name ?? `joint${n}`, parent: p === undefined ? -1 : nodeToJoint.get(p), rotation: [r[3], r[0], r[1], r[2]], translation: node.translation ?? [0, 0, 0], node: n };
  });
  return joints;
}

/**
 * Replace animations: those `drop(name)` accepts are removed, `clips` (the converter's clip shape,
 * tracks in skin joint order) are appended. Returns the new GLB.
 */
export function replaceClips(buf, clips, drop = () => false) {
  const { json, bin } = readGlb(buf);
  const joints = skinJoints(json);
  const parts = [bin];
  let byteLength = align4(bin.length);
  if (byteLength > bin.length) parts.push(Buffer.alloc(byteLength - bin.length));
  json.bufferViews ??= [];
  json.accessors ??= [];
  const pushAccessor = (arr, type, bounds = false) => {
    const bytes = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const padded = align4(bytes.length);
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length });
    parts.push(bytes);
    if (padded > bytes.length) parts.push(Buffer.alloc(padded - bytes.length));
    byteLength += padded;
    const n = { VEC4: 4, VEC3: 3, SCALAR: 1 }[type];
    const acc = { bufferView: json.bufferViews.length - 1, componentType: 5126, count: arr.length / n, type };
    if (bounds) {
      let min = Infinity;
      let max = -Infinity;
      for (const v of arr) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      acc.min = [min];
      acc.max = [max];
    }
    json.accessors.push(acc);
    return json.accessors.length - 1;
  };
  const kept = (json.animations ?? []).filter((a) => !drop(a.name ?? ''));
  for (const clip of clips) {
    const input = pushAccessor(clip.times, 'SCALAR', true);
    const samplers = [];
    const channels = [];
    clip.tracks.forEach((t, i) => {
      const node = joints[i].node;
      samplers.push({ input, output: pushAccessor(t.rotations, 'VEC4'), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node, path: 'rotation' } });
      samplers.push({ input, output: pushAccessor(t.translations, 'VEC3'), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node, path: 'translation' } });
    });
    kept.push({ name: clip.name, samplers, channels });
  }
  json.animations = kept;
  json.buffers = [{ byteLength }];
  return writeGlb(json, Buffer.concat(parts));
}
