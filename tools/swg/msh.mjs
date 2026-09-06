// Static mesh (.msh) reader. Structure, as documented by the community:
//   FORM MESH > FORM 000x > FORM APPR (extents, hardpoints) + FORM SPS (shader primitive sets)
//   SPS > FORM 000x > CNT (u32 shader count) + one FORM per shader:
//     NAME (shader path) + INFO + primitive FORMs, each with INFO, FORM VTXA (INFO + DATA) and INDX.
// Vertex layout follows the client's VertexBufferFormat flags.
import { childrenOf, find, findAll, isForm, readCString } from './iff.mjs';

const F_POSITION = 1 << 0;
const F_TRANSFORMED = 1 << 1;
const F_NORMAL = 1 << 2;
const F_COLOR0 = 1 << 3;
const F_COLOR1 = 1 << 4;
const F_POINT_SIZE = 1 << 5;

export function describeFlags(flags) {
  const sets = (flags >> 8) & 0xf;
  const dims = [];
  for (let i = 0; i < sets; i++) dims.push(((flags >> (12 + i * 2)) & 3) + 1);
  return {
    position: !!(flags & F_POSITION),
    transformed: !!(flags & F_TRANSFORMED),
    normal: !!(flags & F_NORMAL),
    color0: !!(flags & F_COLOR0),
    color1: !!(flags & F_COLOR1),
    pointSize: !!(flags & F_POINT_SIZE),
    texSets: sets,
    texDims: dims,
  };
}

function strideOf(d) {
  let s = 0;
  if (d.position) s += 12;
  if (d.transformed) s += 4;
  if (d.normal) s += 12;
  if (d.pointSize) s += 4;
  if (d.color0) s += 4;
  if (d.color1) s += 4;
  for (const dim of d.texDims) s += dim * 4;
  return s;
}

function readVertexArray(vtxa) {
  const info = find(vtxa, 'INFO');
  const data = find(vtxa, 'DATA');
  if (!info || !data) throw new Error('VTXA without INFO/DATA');
  const flags = info.data.readUInt32LE(0);
  const count = info.data.readUInt32LE(4);
  const d = describeFlags(flags);
  const stride = strideOf(d);
  if (count * stride !== data.data.length) {
    throw new Error(`Vertex data size mismatch: ${count} verts x stride ${stride} = ${count * stride}, DATA is ${data.data.length} bytes (flags 0x${flags.toString(16)} ${JSON.stringify(d)})`);
  }
  const positions = new Float32Array(count * 3);
  const normals = d.normal ? new Float32Array(count * 3) : null;
  const uvs = d.texSets > 0 && d.texDims[0] === 2 ? new Float32Array(count * 2) : null;
  const buf = data.data;
  for (let i = 0; i < count; i++) {
    let o = i * stride;
    if (d.position) {
      positions[i * 3] = buf.readFloatLE(o);
      positions[i * 3 + 1] = buf.readFloatLE(o + 4);
      positions[i * 3 + 2] = buf.readFloatLE(o + 8);
      o += 12;
    }
    if (d.transformed) o += 4;
    if (d.normal) {
      normals[i * 3] = buf.readFloatLE(o);
      normals[i * 3 + 1] = buf.readFloatLE(o + 4);
      normals[i * 3 + 2] = buf.readFloatLE(o + 8);
      o += 12;
    }
    if (d.pointSize) o += 4;
    if (d.color0) o += 4;
    if (d.color1) o += 4;
    if (uvs) {
      uvs[i * 2] = buf.readFloatLE(o);
      uvs[i * 2 + 1] = buf.readFloatLE(o + 4);
    }
  }
  return { count, positions, normals, uvs, flags: d };
}

function readIndices(indx, vertexCount) {
  const count = indx.data.readUInt32LE(0);
  const rest = indx.data.length - 4;
  const wide = rest === count * 4 || vertexCount > 65535;
  const out = wide ? new Uint32Array(count) : new Uint16Array(count);
  for (let i = 0; i < count; i++) out[i] = wide ? indx.data.readUInt32LE(4 + i * 4) : indx.data.readUInt16LE(4 + i * 2);
  return out;
}

function stripToList(idx) {
  const out = [];
  for (let i = 0; i + 2 < idx.length; i++) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    if (a === b || b === c || a === c) continue;
    if (i % 2 === 0) out.push(a, b, c);
    else out.push(b, a, c);
  }
  return out;
}

/** Parse a .msh IFF tree into shader groups of triangle primitives. */
export function parseMesh(root) {
  if (!isForm(root) || root.type !== 'MESH') throw new Error(`Not a MESH form (got ${root.type ?? root.tag})`);
  const sps = find(root, 'SPS ');
  if (!sps) throw new Error('No SPS form in mesh');
  const groups = [];
  // Shader groups are FORMs that contain a NAME chunk and at least one VTXA.
  const candidates = [];
  const walk = (n) => {
    if (isForm(n)) {
      if (childrenOf(n, 'NAME').length && findAll(n, 'VTXA').length) candidates.push(n);
      else for (const c of n.children) walk(c);
    }
  };
  walk(sps);
  for (const g of candidates) {
    const shader = readCString(childrenOf(g, 'NAME')[0].data).value;
    const primitives = [];
    for (const vtxa of findAll(g, 'VTXA')) {
      const holder = findParent(g, vtxa);
      const verts = readVertexArray(vtxa);
      const indx = holder ? childrenOf(holder, 'INDX')[0] : null;
      const primInfo = holder ? childrenOf(holder, 'INFO')[0] : null;
      const primType = primInfo && primInfo.data.length >= 4 ? primInfo.data.readUInt32LE(0) : 3;
      let indices;
      if (indx) {
        indices = readIndices(indx, verts.count);
        if (primType === 4) indices = Uint32Array.from(stripToList(indices));
      } else {
        indices = Uint32Array.from({ length: verts.count }, (_, i) => i);
      }
      primitives.push({ ...verts, indices });
    }
    groups.push({ shader, primitives });
  }
  if (!groups.length) throw new Error('No shader groups with vertex data found');
  return { groups };
}

function findParent(root, target) {
  if (!isForm(root)) return null;
  for (const c of root.children) {
    if (c === target) return root;
    const r = findParent(c, target);
    if (r) return r;
  }
  return null;
}
