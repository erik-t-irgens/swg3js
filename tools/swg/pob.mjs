// Portal object (.pob) reader: enough to find each cell's appearance. Cell 0 is the exterior.
//   FORM PRTO > FORM 000N > DATA + FORM PRTS + FORM CELS { FORM CELL > FORM 000N > DATA ... }
//   Cell DATA: int32 portals, bool8 canSeeParent, [0004+: cstring name], cstring appearance, [0002+: bool8 hasFloor, cstring floor]
import { childrenOf, find, isForm, readCString } from './iff.mjs';

export function parsePob(root) {
  if (!isForm(root) || root.type !== 'PRTO') throw new Error(`Not a portal object (got ${root.type ?? root.tag})`);
  const cels = find(root, 'CELS');
  if (!cels) throw new Error('PRTO without CELS');
  const cells = [];
  for (const cell of childrenOf(cels, 'CELL')) {
    const version = cell.children.find(isForm);
    const data = version ? childrenOf(version, 'DATA')[0] : null;
    if (!version || !data) continue;
    const v = parseInt(version.type, 10);
    let o = 5; // int32 portals + bool8 canSeeParent
    let name = '';
    if (v >= 4) {
      const r = readCString(data.data, o);
      name = r.value;
      o = r.next;
    }
    const app = readCString(data.data, o);
    o = app.next;
    let floor = '';
    if (v >= 2 && o < data.data.length && data.data[o] !== 0) {
      const f = readCString(data.data, o + 1);
      floor = f.value;
    }
    cells.push({ name, appearance: app.value.replace(/\\/g, '/'), floor: floor.replace(/\\/g, '/') });
  }
  return { cells };
}
