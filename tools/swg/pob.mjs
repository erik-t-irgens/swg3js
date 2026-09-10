// Portal object (.pob) reader: cells with their appearances, portal geometry and which
// portal joins which cells. Cell 0 is the exterior (the world).
//   FORM PRTO > FORM 000N > DATA { int32 portals, int32 cells } + FORM PRTS { per portal: PRTL { int32 n, n x vec3 } (0003 and older)
//                                                                              or FORM IDTL > 0000 > VERT { vec3... } + INDX { int32... } (0004) }
//              + FORM CELS { FORM CELL > FORM 000N > DATA ... + FORM PRTL { 000N chunk } per portal [+ LGHT] }
//   Cell DATA: int32 portals, bool8 canSeeParent, [0004+: cstring name], cstring appearance, [0002+: bool8 hasFloor, cstring floor]
//   Cell portal chunk 000N: [0005: bool8 disabled], [0002+: bool8 passable], int32 geometry, bool8 clockwise, int32 targetCell,
//                           [0003+: cstring doorStyle], [0004+: bool8 hasDoorHardpoint, 12 floats]
import { childrenOf, find, isForm, readCString } from './iff.mjs';

export function parsePob(root) {
  if (!isForm(root) || root.type !== 'PRTO') throw new Error(`Not a portal object (got ${root.type ?? root.tag})`);
  const version = root.children.find(isForm);
  const portals = [];
  const prts = version ? childrenOf(version, 'PRTS')[0] : null;
  if (prts) {
    for (const p of prts.children) {
      if (!isForm(p) && p.tag === 'PRTL') {
        // Polygon outline; the engine fans it into triangles.
        const n = p.data.readInt32LE(0);
        const verts = [];
        for (let i = 0; i < n && 4 + i * 12 + 12 <= p.data.length; i++) {
          const o = 4 + i * 12;
          verts.push([p.data.readFloatLE(o), p.data.readFloatLE(o + 4), p.data.readFloatLE(o + 8)]);
        }
        const indices = [];
        for (let i = 1; i + 1 < verts.length; i++) indices.push(0, i, i + 1);
        portals.push({ verts, indices });
      } else if (isForm(p) && p.type === 'IDTL') {
        const vert = find(p, 'VERT');
        const indx = find(p, 'INDX');
        const verts = [];
        const indices = [];
        if (vert) for (let o = 0; o + 12 <= vert.data.length; o += 12) verts.push([vert.data.readFloatLE(o), vert.data.readFloatLE(o + 4), vert.data.readFloatLE(o + 8)]);
        if (indx) for (let o = 0; o + 4 <= indx.data.length; o += 4) indices.push(indx.data.readInt32LE(o));
        portals.push({ verts, indices });
      }
    }
  }
  const cels = find(root, 'CELS');
  if (!cels) throw new Error('PRTO without CELS');
  const cells = [];
  for (const cell of childrenOf(cels, 'CELL')) {
    const cv = cell.children.find(isForm);
    const data = cv ? childrenOf(cv, 'DATA')[0] : null;
    if (!cv || !data) continue;
    const v = parseInt(cv.type, 10);
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
    const links = [];
    for (const pf of childrenOf(cv, 'PRTL')) {
      const chunk = pf.children.find((c) => !isForm(c));
      if (!chunk) continue;
      const pv = parseInt(chunk.tag, 10);
      const d = chunk.data;
      let q = 0;
      let disabled = false;
      let passable = true;
      if (pv >= 5) disabled = d[q++] !== 0;
      if (pv >= 2) passable = d[q++] !== 0;
      const geometry = d.readInt32LE(q);
      q += 4;
      const clockwise = d[q++] !== 0;
      const target = d.readInt32LE(q);
      links.push({ geometry, target, clockwise, passable, disabled });
    }
    // LGHT: int32 count, then per light int8 type (0 ambient, 1 parallel, 2 point), ARGB diffuse and
    // specular floats, a 3x4 row-major transform, and constant, linear and quadratic attenuation.
    // The exporter's yaw hack (yaw_l(PI)) means a light points down the transform's -Z.
    const lights = [];
    const lg = cv.children.find((c) => !isForm(c) && c.tag === 'LGHT');
    if (lg && lg.data.length >= 4) {
      const d = lg.data;
      const n = d.readInt32LE(0);
      let q = 4;
      for (let i = 0; i < n && q + 1 + 16 * 4 + 12 * 4 + 12 <= d.length; i++) {
        const type = d.readInt8(q);
        q += 1;
        const f = () => {
          const v = d.readFloatLE(q);
          q += 4;
          return v;
        };
        const diffuse = [f(), f(), f(), f()];
        const specular = [f(), f(), f(), f()];
        const m = [];
        for (let k = 0; k < 12; k++) m.push(f());
        const attenuation = [f(), f(), f()];
        lights.push({ type, color: [diffuse[1], diffuse[2], diffuse[3]], specular: [specular[1], specular[2], specular[3]], position: [m[3], m[7], m[11]], direction: [-m[2], -m[6], -m[10]], attenuation });
      }
    }
    cells.push({ name, appearance: app.value.replace(/\\/g, '/'), floor: floor.replace(/\\/g, '/'), portals: links, lights });
  }
  return { cells, portals };
}
