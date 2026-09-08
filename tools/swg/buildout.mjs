// Buildout areas: the second place the game puts objects in the world (the first is the .ws
// snapshot). Later-added structures such as the Theed palace live here. Following the
// client's WorldSnapshot::load:
//   datatables/buildout/buildout_scenes.iff      sceneName, adjust_map_coordinates
//   datatables/buildout/areas_<planet>.iff       area, x1, z1, x2, z2, eventRequired, ...
//   datatables/buildout/<planet>/<area>.iff      [objid, container,] shared_template_crc, cell_index,
//                                                px, py, pz, qw, qx, qy, qz, radius, portal_layout_crc [, sx, sy, sz]
// Positions of objects outside cells are relative to the area's (x1, z1); objects in cells
// are relative to their cell. Template names come from the CRC string table.
import { childOf, isForm, parseIff, readCString } from './iff.mjs';
import { parseDatatable } from './datatable.mjs';

const CELL_TEMPLATE = 'object/cell/shared_cell.iff';

/** misc/object_template_crc_string_table.iff: FORM CSTB > FORM 0000 > DATA(count) CRCT(uint32[]) STRT(int32[]) STNG(strings) */
export function parseCrcStringTable(root) {
  if (!isForm(root) || root.type !== 'CSTB') throw new Error(`not a crc string table: ${root.type ?? root.tag}`);
  const v = root.children.find(isForm);
  const count = childOf(v, 'DATA').data.readInt32LE(0);
  const crct = childOf(v, 'CRCT').data;
  const strt = childOf(v, 'STRT').data;
  const stng = childOf(v, 'STNG').data;
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const crc = crct.readUInt32LE(i * 4);
    const off = strt.readInt32LE(i * 4);
    out.set(crc, readCString(stng, off).value.replace(/\\/g, '/'));
  }
  return out;
}

function table(vfs, path) {
  if (!vfs.has(path)) return null;
  const buf = vfs.read(path);
  if (buf.length < 12) return null;
  return parseDatatable(parseIff(buf));
}

/**
 * Every buildout object of a planet as snapshot-style nodes (id, containedBy, template,
 * cellIndex, q [w,x,y,z], pos, radius, portalLayoutCrc). Areas that need an event (Life Day
 * and the like) are skipped.
 */
export function loadBuildouts(vfs, planet) {
  const stats = { areas: 0, objects: 0, eventAreas: 0, unknownTemplates: 0, missingTables: 0 };
  const nodes = [];
  const areasTable = table(vfs, `datatables/buildout/areas_${planet}.iff`);
  if (!areasTable) return { nodes, stats };
  const crcPath = 'misc/object_template_crc_string_table.iff';
  const crcTable = vfs.has(crcPath) ? parseCrcStringTable(parseIff(vfs.read(crcPath))) : new Map();
  let nextId = 1 << 30; // well clear of the snapshot's ids
  areasTable.rows.forEach((area, areaIndex) => {
    const name = area.area;
    if (!name) return;
    if (area.eventRequired) {
      stats.eventAreas++;
      return;
    }
    const rows = table(vfs, `datatables/buildout/${planet}/${name}.iff`);
    if (!rows) {
      stats.missingTables++;
      return;
    }
    stats.areas++;
    const x0 = Number(area.x1) || 0;
    const z0 = Number(area.z1) || 0;
    const v2 = rows.columns.includes('objid');
    const ids = new Map(); // raw objid -> node id (v2)
    const idFor = (raw) => {
      if (!raw) return 0;
      let id = ids.get(raw);
      if (!id) {
        id = nextId++;
        ids.set(raw, id);
      }
      return id;
    };
    let currentBuilding = 0;
    let currentCell = 0;
    for (const r of rows.rows) {
      const crc = Number(r.shared_template_crc) >>> 0;
      const template = crcTable.get(crc);
      if (!template) {
        stats.unknownTemplates++;
        continue;
      }
      const cellIndex = Number(r.cell_index) || 0;
      const portalLayoutCrc = Number(r.portal_layout_crc) >>> 0;
      let id;
      let containedBy;
      if (v2) {
        id = idFor(Number(r.objid));
        containedBy = idFor(Number(r.container));
      } else {
        id = nextId++;
        if (portalLayoutCrc) {
          currentBuilding = id;
          containedBy = 0;
        } else if (template === CELL_TEMPLATE) {
          currentCell = id;
          containedBy = currentBuilding;
        } else if (cellIndex > 0) containedBy = currentCell;
        else containedBy = 0;
      }
      const pos = cellIndex === 0 ? [x0 + Number(r.px), Number(r.py), z0 + Number(r.pz)] : [Number(r.px), Number(r.py), Number(r.pz)];
      nodes.push({ id, containedBy, template, cellIndex, q: [Number(r.qw), Number(r.qx), Number(r.qy), Number(r.qz)], pos, radius: Number(r.radius) || 0, portalLayoutCrc, children: [], area: name });
      stats.objects++;
    }
  });
  return { nodes, stats };
}

/** Append buildout nodes to a parsed snapshot so the same flattening places both. */
export function mergeBuildouts(snap, buildout) {
  const index = new Map(snap.templates.map((t, i) => [t, i]));
  for (const n of buildout.nodes) {
    let ti = index.get(n.template);
    if (ti === undefined) {
      ti = snap.templates.length;
      snap.templates.push(n.template);
      index.set(n.template, ti);
    }
    snap.nodes.push({ id: n.id, containedBy: n.containedBy, templateIndex: ti, cellIndex: n.cellIndex, q: n.q, pos: n.pos, radius: n.radius, portalLayoutCrc: n.portalLayoutCrc, children: [], buildout: n.area });
  }
  return snap;
}
