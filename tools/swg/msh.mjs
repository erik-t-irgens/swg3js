// Static mesh (.msh) reader, following the engine's MeshAppearanceTemplate,
// ShaderPrimitiveSetTemplate and VertexBuffer loaders:
//   FORM MESH > FORM 0004|0005 > FORM APPR (extents, hardpoints, floor) + FORM SPS
//   FORM SPS > FORM 0000|0001 > CNT (int32 shaders) + per shader FORM 000N:
//     NAME (shader path), INFO (int32 primitive count), per primitive FORM 000N:
//       INFO { int32 primitiveType, bool8 hasIndices, bool8 hasSortedIndices }
//       FORM VTXA > FORM 0003 > INFO { uint32 flags, int32 count } + DATA (interleaved vertices)
//       INDX { int32 count, uint16 indices } when hasIndices, SIDX when sorted.
// Vertex layout per VertexBufferFormat flags: position, ooz, normal, pointSize,
// color0, color1 (packed ARGB, little-endian), then texture coordinate sets.
import { childrenOf, find, findAll, isForm, readCString } from './iff.mjs';

const F_POSITION = 1 << 0;
const F_TRANSFORMED = 1 << 1;
const F_NORMAL = 1 << 2;
const F_COLOR0 = 1 << 3;
const F_COLOR1 = 1 << 4;
const F_POINT_SIZE = 1 << 5;

/** ShaderPrimitiveSetPrimitiveType: index into the client's draw table. */
export const PRIMITIVE = {
  pointList: 0, lineList: 1, lineStrip: 2, triangleList: 3, triangleStrip: 4, triangleFan: 5,
  indexedPointList: 6, indexedLineList: 7, indexedLineStrip: 8, indexedTriangleList: 9, indexedTriangleStrip: 10, indexedTriangleFan: 11,
};

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
  const version = vtxa.children.find(isForm);
  if (!version) throw new Error('VTXA without a version form');
  if (version.type === '0001') throw new Error('VTXA version 0001 (float colours, old flags) is not supported yet; please share a dump');
  const info = childrenOf(version, 'INFO')[0];
  const data = childrenOf(version, 'DATA')[0];
  if (!info || !data) throw new Error('VTXA without INFO/DATA');
  const flags = info.data.readUInt32LE(0);
  const count = info.data.readInt32LE(4);
  const d = describeFlags(flags);
  const stride = strideOf(d);
  if (count * stride !== data.data.length) {
    throw new Error(`Vertex data size mismatch: ${count} verts x stride ${stride} = ${count * stride}, DATA is ${data.data.length} bytes (flags 0x${flags.toString(16)} ${JSON.stringify(d)})`);
  }
  const positions = new Float32Array(count * 3);
  const normals = d.normal ? new Float32Array(count * 3) : null;
  const colors = d.color0 ? new Uint8Array(count * 4) : null;
  const firstUv = d.texDims.findIndex((dim) => dim === 2);
  const uvs = firstUv >= 0 ? new Float32Array(count * 2) : null;
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
    if (d.color0) {
      // Packed ARGB written little-endian: bytes on disk are B, G, R, A.
      colors[i * 4] = buf[o + 2];
      colors[i * 4 + 1] = buf[o + 1];
      colors[i * 4 + 2] = buf[o];
      colors[i * 4 + 3] = buf[o + 3];
      o += 4;
    }
    if (d.color1) o += 4;
    for (let j = 0; j < d.texDims.length; j++) {
      if (j === firstUv) {
        uvs[i * 2] = buf.readFloatLE(o);
        uvs[i * 2 + 1] = buf.readFloatLE(o + 4);
      }
      o += d.texDims[j] * 4;
    }
  }
  return { count, positions, normals, colors, uvs, flags: d };
}

function readIndices(indx, vertexCount) {
  const count = indx.data.readInt32LE(0);
  const rest = indx.data.length - 4;
  const wide = rest === count * 4 && !(rest === count * 2) || vertexCount > 65535;
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
  return Uint32Array.from(out);
}

function fanToList(idx) {
  const out = [];
  for (let i = 1; i + 1 < idx.length; i++) out.push(idx[0], idx[i], idx[i + 1]);
  return Uint32Array.from(out);
}

/** The hardpoints of an APPR form (a mesh's, a detail chain's, a component's): name, 3x4 matrix, position. */
export function readHardpoints(appr) {
  const out = [];
  for (const hpnt of findAll(appr, 'HPNT')) {
    const d = hpnt.data;
    if (d.length < 48) continue;
    const m = [];
    for (let i = 0; i < 12; i++) m.push(d.readFloatLE(i * 4));
    out.push({ name: readCString(d, 48).value, matrix: m, position: [m[3], m[7], m[11]] });
  }
  return out;
}

function readBounds(appr) {
  const box = find(appr, 'BOX ');
  if (!box || box.data.length < 24) return null;
  const f = (i) => box.data.readFloatLE(i * 4);
  return { min: [f(0), f(1), f(2)], max: [f(3), f(4), f(5)] };
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

/** Parse a .msh IFF tree into shader groups of triangle primitives plus metadata. */
export function parseMesh(root) {
  if (!isForm(root) || root.type !== 'MESH') throw new Error(`Not a MESH form (got ${root.type ?? root.tag})`);
  const version = root.children.find(isForm);
  const sps = find(root, 'SPS ');
  if (!sps) throw new Error('No SPS form in mesh');
  const appr = find(root, 'APPR');
  const groups = [];
  const warnings = [];
  const candidates = [];
  const walk = (n) => {
    if (!isForm(n)) return;
    if (childrenOf(n, 'NAME').length && findAll(n, 'VTXA').length) candidates.push(n);
    else for (const c of n.children) walk(c);
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
      const primType = primInfo && primInfo.data.length >= 4 ? primInfo.data.readInt32LE(0) : PRIMITIVE.indexedTriangleList;
      let indices = indx ? readIndices(indx, verts.count) : Uint32Array.from({ length: verts.count }, (_, i) => i);
      switch (primType) {
        case PRIMITIVE.triangleList:
        case PRIMITIVE.indexedTriangleList:
          break;
        case PRIMITIVE.triangleStrip:
        case PRIMITIVE.indexedTriangleStrip:
          indices = stripToList(indices);
          break;
        case PRIMITIVE.triangleFan:
        case PRIMITIVE.indexedTriangleFan:
          indices = fanToList(indices);
          break;
        default:
          warnings.push(`skipped primitive type ${primType} in ${shader}`);
          continue;
      }
      primitives.push({ ...verts, indices });
    }
    if (primitives.length) groups.push({ shader, primitives });
  }
  if (!groups.length) throw new Error('No shader groups with triangle data found');
  return {
    version: version ? version.type : '?',
    groups,
    hardpoints: appr ? readHardpoints(appr) : [],
    bounds: appr ? readBounds(appr) : null,
    warnings,
  };
}
