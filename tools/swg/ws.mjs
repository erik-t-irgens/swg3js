// World snapshot (.ws) reader, following WorldSnapshotReaderWriter:
//   FORM WSNP > FORM 0001 > FORM NODS { FORM NODE ... } + OTNL { int32 n, n names }
//   FORM NODE > FORM 0000 > DATA { int32 networkId, int32 containedBy, int32 templateIndex,
//     int32 cellIndex, quaternion w x y z, vector x y z, float radius, uint32 portalLayoutCrc }
//     followed by child NODE forms (objects inside this building's cells).
import { childrenOf, isForm, readCString } from './iff.mjs';

function readNode(nodeForm) {
  const version = nodeForm.children.find(isForm);
  if (!version) throw new Error('NODE without version form');
  const data = childrenOf(version, 'DATA')[0];
  if (!data) throw new Error('NODE without DATA');
  const d = data.data;
  const node = {
    id: d.readInt32LE(0),
    containedBy: d.readInt32LE(4),
    templateIndex: d.readInt32LE(8),
    cellIndex: d.readInt32LE(12),
    q: [d.readFloatLE(16), d.readFloatLE(20), d.readFloatLE(24), d.readFloatLE(28)],
    pos: [d.readFloatLE(32), d.readFloatLE(36), d.readFloatLE(40)],
    radius: d.readFloatLE(44),
    portalLayoutCrc: d.readUInt32LE(48),
    children: [],
  };
  for (const c of childrenOf(version, 'NODE')) node.children.push(readNode(c));
  return node;
}

export function parseSnapshot(root) {
  if (!isForm(root) || root.type !== 'WSNP') throw new Error(`Not a world snapshot (got ${root.type ?? root.tag})`);
  const version = root.children.find(isForm);
  if (!version) throw new Error('WSNP without version form');
  const nods = childrenOf(version, 'NODS')[0];
  const otnl = childrenOf(version, 'OTNL')[0];
  if (!nods || !otnl) throw new Error(`WSNP ${version.type}: missing NODS or OTNL`);
  const templates = [];
  const n = otnl.data.readInt32LE(0);
  let cursor = 4;
  for (let i = 0; i < n; i++) {
    const { value, next } = readCString(otnl.data, cursor);
    templates.push(value.replace(/\\/g, '/'));
    cursor = next;
  }
  const nodes = childrenOf(nods, 'NODE').map(readNode);
  return { version: version.type, templates, nodes };
}

function rotate(q, v) {
  // q as [w, x, y, z]; standard Hamilton rotation of v.
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

function multiply(a, b) {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [aw * bw - ax * bx - ay * by - az * bz, aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw];
}

/**
 * Every node with its world transform. Contained objects (nested, or flat with
 * containedBy set) are stored relative to their parent building.
 */
export function flattenWithWorldTransforms(snapshot) {
  const byId = new Map();
  const all = [];
  const visit = (node, parentId) => {
    byId.set(node.id, node);
    all.push({ node, parentId: node.containedBy || parentId });
    for (const c of node.children) visit(c, node.id);
  };
  for (const n of snapshot.nodes) visit(n, 0);
  const world = new Map();
  const resolve = (id) => {
    if (world.has(id)) return world.get(id);
    const node = byId.get(id);
    if (!node) return null;
    const parentId = node.containedBy;
    let result = { q: node.q, pos: node.pos };
    if (parentId && parentId !== id) {
      const parent = resolve(parentId);
      if (parent) result = { q: multiply(parent.q, node.q), pos: (() => { const r = rotate(parent.q, node.pos); return [parent.pos[0] + r[0], parent.pos[1] + r[1], parent.pos[2] + r[2]]; })() };
    }
    world.set(id, result);
    return result;
  };
  return all.map(({ node, parentId }) => ({ node, parentId, world: resolve(node.id) }));
}
