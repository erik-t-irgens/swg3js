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
