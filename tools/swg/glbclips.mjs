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

/** One accessor's values as a Float32Array, de-normalising the integer component types. */
function readAccessor(json, bin, index) {
  const acc = json.accessors[index];
  if (!acc) throw new Error(`accessor ${index} is missing`);
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  if (!n) throw new Error(`accessor ${index}: unsupported type ${acc.type}`);
  const view = json.bufferViews[acc.bufferView];
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const count = acc.count * n;
  const out = new Float32Array(count);
  // A bufferView may interleave, but animation data never does, so a straight read is enough.
  switch (acc.componentType) {
    case 5126:
      for (let i = 0; i < count; i++) out[i] = bin.readFloatLE(base + i * 4);
      break;
    case 5123:
      for (let i = 0; i < count; i++) out[i] = acc.normalized ? bin.readUInt16LE(base + i * 2) / 65535 : bin.readUInt16LE(base + i * 2);
      break;
    case 5122:
      for (let i = 0; i < count; i++) out[i] = acc.normalized ? Math.max(bin.readInt16LE(base + i * 2) / 32767, -1) : bin.readInt16LE(base + i * 2);
      break;
    case 5121:
      for (let i = 0; i < count; i++) out[i] = acc.normalized ? bin[base + i] / 255 : bin[base + i];
      break;
    case 5120:
      for (let i = 0; i < count; i++) out[i] = acc.normalized ? Math.max(bin.readInt8(base + i) / 127, -1) : bin.readInt8(base + i);
      break;
    default:
      throw new Error(`accessor ${index}: unsupported componentType ${acc.componentType}`);
  }
  return out;
}

/** Sample a VEC4 rotation track at `t`, interpolating the shorter way round between keys. */
function sampleRotation(times, values, t) {
  const n = times.length;
  if (!n) return [0, 0, 0, 1];
  let i = 0;
  while (i < n - 1 && times[i + 1] < t) i++;
  if (i >= n - 1) return [values[(n - 1) * 4], values[(n - 1) * 4 + 1], values[(n - 1) * 4 + 2], values[(n - 1) * 4 + 3]];
  const span = times[i + 1] - times[i];
  const f = span > 1e-9 ? Math.min(Math.max((t - times[i]) / span, 0), 1) : 0;
  const a = [values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3]];
  const b = [values[(i + 1) * 4], values[(i + 1) * 4 + 1], values[(i + 1) * 4 + 2], values[(i + 1) * 4 + 3]];
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) out[k] = a[k] * (1 - f) + b[k] * s * f;
  const len = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  return [out[0] / len, out[1] / len, out[2] / len, out[3] / len];
}

/** Sample a VEC3 track at `t`. */
function sampleVec3(times, values, t) {
  const n = times.length;
  if (!n) return [0, 0, 0];
  let i = 0;
  while (i < n - 1 && times[i + 1] < t) i++;
  if (i >= n - 1) return [values[(n - 1) * 3], values[(n - 1) * 3 + 1], values[(n - 1) * 3 + 2]];
  const span = times[i + 1] - times[i];
  const f = span > 1e-9 ? Math.min(Math.max((t - times[i]) / span, 0), 1) : 0;
  return [0, 1, 2].map((k) => values[i * 3 + k] * (1 - f) + values[(i + 1) * 3 + k] * f);
}

/**
 * Read animations back out of a GLB in the converter's clip shape, the inverse of replaceClips.
 *
 * Channels are matched to skin joints by the node they target, and every joint gets a full track
 * whether or not the clip animates it -- joints the clip leaves alone hold their bind pose, which
 * is what the converter's own clips do. Channels that share one input accessor (everything this
 * converter writes) are copied straight across; anything else is resampled onto the union of its
 * own key times, so clips authored elsewhere survive the round trip.
 */
export function extractClips(buf, keep = () => true) {
  const { json, bin } = readGlb(buf);
  const joints = skinJoints(json);
  const nodeToJoint = new Map(joints.map((j, i) => [j.node, i]));
  const out = [];
  for (const anim of json.animations ?? []) {
    const name = anim.name ?? '';
    if (!keep(name)) continue;
    // Gather this clip's channels per joint.
    const rot = new Map();
    const trn = new Map();
    const inputs = new Set();
    for (const ch of anim.channels ?? []) {
      const joint = nodeToJoint.get(ch.target?.node);
      if (joint === undefined) continue;
      const sampler = anim.samplers[ch.sampler];
      if (!sampler) continue;
      inputs.add(sampler.input);
      if (ch.target.path === 'rotation') rot.set(joint, sampler);
      else if (ch.target.path === 'translation') trn.set(joint, sampler);
    }
    if (!rot.size && !trn.size) continue;
    // One shared timeline is the common case; otherwise take every key time any channel uses.
    let times;
    if (inputs.size === 1) {
      times = readAccessor(json, bin, [...inputs][0]);
    } else {
      const all = new Set();
      for (const i of inputs) for (const t of readAccessor(json, bin, i)) all.add(Math.round(t * 1e6) / 1e6);
      times = Float32Array.from([...all].sort((a, b) => a - b));
    }
    const frames = times.length;
    const tracks = joints.map((joint, j) => {
      const rotations = new Float32Array(frames * 4);
      const translations = new Float32Array(frames * 3);
      const rs = rot.get(j);
      const ts = trn.get(j);
      const rTimes = rs ? readAccessor(json, bin, rs.input) : null;
      const rVals = rs ? readAccessor(json, bin, rs.output) : null;
      const tTimes = ts ? readAccessor(json, bin, ts.input) : null;
      const tVals = ts ? readAccessor(json, bin, ts.output) : null;
      // A channel already on this clip's timeline is copied as it stands: resampling it would
      // renormalise the quaternions and drift the pose a little on every round trip.
      const rExact = rs && rTimes.length === frames;
      const tExact = ts && tTimes.length === frames;
      if (rExact) rotations.set(rVals.subarray(0, frames * 4));
      if (tExact) translations.set(tVals.subarray(0, frames * 3));
      if (rExact && tExact) return { rotations, translations };
      for (let f = 0; f < frames; f++) {
        if (rExact && tExact) break;
        const t = times[f];
        // The converter stores rotations w-first; glTF stores them x,y,z,w.
        if (!rExact) {
          const q = rs ? sampleRotation(rTimes, rVals, t) : [joint.rotation[1], joint.rotation[2], joint.rotation[3], joint.rotation[0]];
          rotations[f * 4] = q[0];
          rotations[f * 4 + 1] = q[1];
          rotations[f * 4 + 2] = q[2];
          rotations[f * 4 + 3] = q[3];
        }
        if (!tExact) {
          const v = ts ? sampleVec3(tTimes, tVals, t) : joint.translation;
          translations[f * 3] = v[0];
          translations[f * 3 + 1] = v[1];
          translations[f * 3 + 2] = v[2];
        }
      }
      return { rotations, translations };
    });
    out.push({ name, times, tracks });
  }
  return { clips: out, joints: joints.map((j) => j.name) };
}
