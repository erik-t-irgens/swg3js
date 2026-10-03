// The doors that stand in a portal building's doorways: which portal carries one, what it looks like,
// how far it slides and how fast, how near a body must come to open it and what it sounds like.
//
// Every byte of it is in the retail archives and none of it was read before this. A portal side in a
// `.pob` names a door style and, from version 0004 on, where the door hangs (`pob.mjs`): a 3x4
// row-major transform in the building's own frame, whose twelve floats are written whether or not its
// flag is set (all 7,422 retail portal sides read to their last byte so), and the two sides of a
// portal name the same style on all but one. The style is a row of
// `datatables/appearance/door_style.iff`, whose columns are
//
//   doorStyleName, frameAppearance, doorAppearance, doorAppearance2, doorFlip2,
//   doorMoveX, doorMoveY, doorMoveZ, openTime, closeTime, springiness, smoothness,
//   triggerRadius, isForceField, openBeginEffect, openEndEffect, closeBeginEffect, closeEndEffect
//
// Measured over the 281 retail portal files: 2,310 of 7,422 portal sides name a style (about 1,155
// doors in 160 buildings) and 2,128 of those carry the hardpoint; no retail portal names the force
// field. A door model is authored with its origin at the bottom middle of the doorway, the leaf in its
// own X and Y and a few centimetres thick in Z, so the hardpoint puts it in the doorway and `doorMove`
// slides it in its own frame. A style with a second leaf and `doorFlip2` (every one that has a second
// leaf) is a double door whose leaf model is hung twice, the second turned half way round about its
// own up, so the two meet in the middle and slide apart; that reading is ours, made because ten of the
// eighteen such leaf models lie wholly on one side of their origin (x from 0 to 1.1 on the bunker's)
// and the other eight reach at most a little over a metre past it, a lip the other leaf closes over.
//
// Nine rows name a client effect `clienfeffect/...`, a misspelling of the folder (the Naboo filler
// doors and one Imperial double door): the file named is plainly `clienteffect/` with the same name,
// so it is read as that, counted and said, rather than leaving those doors silent for a typo.
//
// The `doors` command (`cli.mjs`) writes each pack's table as `doors.json` beside its manifest, in the
// shape of `floors.json` and `objeffects.json`, and converts the door models once into a folder every
// pack shares (`<out>/doors/`), as the travel rigs are shared. It converts no building.
import { basename } from 'node:path';
import { parseIff } from './iff.mjs';
import { parseDatatable } from './datatable.mjs';
import { parsePob } from './pob.mjs';

/** The shape of a pack's doors.json and of doors/manifest.json; the game's `DOORS_PACK_VERSION` (`src/world/doors.ts`), which a node test holds equal. */
export const DOORS_PACK_VERSION = 1;

/** The client's table of door styles. */
export const DOOR_STYLE_TABLE = 'datatables/appearance/door_style.iff';

/** The four moments a door sounds at, in the table's own column order. */
export const DOOR_MOMENTS = ['openBegin', 'openEnd', 'closeBegin', 'closeEnd'];

/** A door model's id in the shared folder: the appearance's own file name, which no two styles' models share. */
export function doorModelId(appearance) {
  return basename(String(appearance).replace(/\\/g, '/')).replace(/\.[^.]+$/, '').toLowerCase();
}

/** A client effect's path as the table writes it, with the misspelt folder read as the real one; `fixed` counts those. */
export function effectPath(raw, fixed) {
  const p = String(raw ?? '').replace(/\\/g, '/').trim();
  if (!p) return null;
  if (/^clienfeffect\//i.test(p)) {
    if (fixed) fixed.n++;
    return p.replace(/^clienfeffect\//i, 'clienteffect/');
  }
  return p;
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const app = (v) => {
  const s = String(v ?? '').replace(/\\/g, '/').trim();
  return s || null;
};

/**
 * The door style table, by name. Each style keeps its models as appearance paths, its move in the
 * door's own frame as the client wrote it (unmirrored), its two times, its spring and smoothness, its
 * trigger radius, whether it is a force field, and its four client effects.
 */
export function parseDoorStyles(table) {
  const styles = new Map();
  const fixed = { n: 0 };
  for (const r of table.rows ?? []) {
    const name = String(r.doorStyleName ?? '').trim();
    if (!name) continue;
    styles.set(name, {
      name,
      door: app(r.doorAppearance),
      door2: app(r.doorAppearance2),
      flip2: num(r.doorFlip2) !== 0,
      frame: app(r.frameAppearance),
      move: [num(r.doorMoveX), num(r.doorMoveY), num(r.doorMoveZ)],
      open: num(r.openTime, 0.5),
      close: num(r.closeTime, 0.5),
      spring: num(r.springiness, 1),
      smooth: num(r.smoothness, 1),
      trigger: num(r.triggerRadius, 3),
      forceField: num(r.isForceField) !== 0,
      effects: Object.fromEntries(DOOR_MOMENTS.map((m) => [m, effectPath(r[`${m}Effect`], fixed)])),
    });
  }
  return { styles, misspelt: fixed.n };
}

/** The style table out of the archives, or an empty one when the archives have none. */
export function readDoorStyles(vfs) {
  if (!vfs.has(DOOR_STYLE_TABLE)) return { styles: new Map(), misspelt: 0 };
  return parseDoorStyles(parseDatatable(parseIff(vfs.read(DOOR_STYLE_TABLE))));
}

/**
 * A 3x4 row-major transform as the game's frame holds it: the converter mirrors X, so the transform
 * is S M S with S the X mirror -- every element of the first row and the first column but the corner
 * changes sign. A model converted with X mirrored, hung by it, lands where the client hung the
 * unmirrored model by M.
 */
export function mirrorTransform(m) {
  return [m[0], -m[1], -m[2], -m[3], -m[4], m[5], m[6], m[7], -m[8], m[9], m[10], m[11]];
}

/**
 * Where a door hangs when its portal carries no hardpoint (182 of the 2,310 styled sides): the
 * bottom middle of the portal's polygon, its own up the world's, its Z along the polygon's normal and
 * its X across the doorway. In the client's frame, as a hardpoint would be. Null for a polygon too
 * small to have a plane.
 */
export function fallbackHardpoint(verts, indices = null) {
  if (!verts || verts.length < 3) return null;
  let cx = 0;
  let cz = 0;
  let lo = Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    cx += a[0];
    cz += a[2];
    lo = Math.min(lo, a[1]);
  }
  if (indices && indices.length >= 3) {
    // A polygon kept as triangles (`IDTL`) lists its corners in no order round its edge: its normal
    // is its triangles' added up, which no listing order can cancel.
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = verts[indices[t]];
      const b = verts[indices[t + 1]];
      const c = verts[indices[t + 2]];
      if (!a || !b || !c) continue;
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      nx += uy * vz - uz * vy;
      ny += uz * vx - ux * vz;
      nz += ux * vy - uy * vx;
    }
  } else {
    // Newell's normal of an outline in its own order, which a polygon of either winding answers.
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
  }
  cx /= verts.length;
  cz /= verts.length;
  // The normal laid flat: a door stands upright whatever the polygon leans.
  const h = Math.hypot(nx, nz);
  if (!(h > 1e-6) || !Number.isFinite(lo)) return null;
  const zx = nx / h;
  const zz = nz / h;
  // X = up x Z, so X, Y and Z are a right-handed set as every hardpoint's rotation is.
  const xx = zz;
  const xz = -zx;
  return [xx, 0, zx, cx, 0, 1, 0, lo, xz, 0, zz, cz];
}

/**
 * The doors of one portal building, out of its parsed `.pob` and the style table: one per portal
 * geometry any side of which names a style, with the cells on its two sides, its style and where it
 * hangs (in the client's frame). `counts` says what was passed over and why.
 */
export function portalDoors(pob, styles) {
  const counts = { sides: 0, doors: 0, noHardpoint: 0, unplaced: 0, disagree: 0, missingStyle: 0, forceField: 0, disabled: 0 };
  const byGeo = new Map();
  pob.cells.forEach((cell, index) => {
    for (const l of cell.portals ?? []) {
      if (!l.doorStyle) continue;
      counts.sides++;
      let list = byGeo.get(l.geometry);
      if (!list) byGeo.set(l.geometry, (list = []));
      list.push({ cell: index, ...l });
    }
  });
  const doors = [];
  for (const [geometry, sides] of [...byGeo].sort((a, b) => a[0] - b[0])) {
    const first = sides[0];
    if (sides.some((s) => s.doorStyle !== first.doorStyle)) counts.disagree++;
    if (sides.some((s) => s.disabled)) {
      counts.disabled++;
      continue;
    }
    const style = styles.get(first.doorStyle);
    if (!style) {
      counts.missingStyle++;
      continue;
    }
    if (style.forceField) {
      counts.forceField++;
      continue;
    }
    const withHp = sides.find((s) => s.doorHardpoint);
    let m = withHp ? withHp.doorHardpoint : null;
    if (!m) {
      counts.noHardpoint++;
      m = fallbackHardpoint(pob.portals[geometry]?.verts, pob.portals[geometry]?.indices);
      // A portal lying flat (a hatch in a floor) has no upright plane to stand a door in.
      if (!m) {
        counts.unplaced++;
        continue;
      }
    }
    doors.push({ portal: geometry, style: style.name, cells: [first.cell, first.target], m, fallback: !withHp });
    counts.doors++;
  }
  return { doors, counts };
}

/**
 * A pob's doors, read once per path for a whole run: one cantina file is placed on four worlds. The
 * reader's `counts` add up `portalDoors`' over every distinct file it has read.
 */
export function pobDoorReader(vfs, styles) {
  const cache = new Map();
  const counts = { files: 0, sides: 0, doors: 0, noHardpoint: 0, unplaced: 0, disagree: 0, missingStyle: 0, forceField: 0, disabled: 0 };
  const read = (path) => {
    if (cache.has(path)) return cache.get(path);
    let out;
    try {
      out = vfs.has(path) ? portalDoors(parsePob(parseIff(vfs.read(path))), styles) : { error: 'not in the archives' };
    } catch (err) {
      out = { error: err.message };
    }
    cache.set(path, out);
    if (out.counts) {
      counts.files++;
      for (const k of Object.keys(counts)) if (k !== 'files' && typeof out.counts[k] === 'number') counts[k] += out.counts[k];
    }
    return out;
  };
  read.counts = counts;
  return read;
}

const round = (v, places) => {
  const k = 10 ** places;
  return Math.round(v * k) / k;
};

/**
 * One pack's door table: every portal model its manifest carries, each door in the game's frame
 * (`m` mirrored with the meshes when `flipX`), and the styles they use with their models named by id
 * and their move mirrored too. `exists(appearance)` says whether a model is in the archives: a style
 * whose every leaf is missing draws nothing and is left out (three rows name a model the archives do
 * not hold). `soundsOf(cef)` is the client effect's own sounds.
 */
export function packDoorTable(defs, readDoors, styles, { flipX = true, exists = () => true, soundsOf = () => [] } = {}) {
  const models = {};
  const used = new Map();
  const counts = { buildings: 0, withDoors: 0, doors: 0, fallback: 0, unread: 0, noModel: 0 };
  for (const def of defs) {
    if (!def?.id || !/\.pob$/i.test(def.source ?? '') || !def.cells) continue;
    counts.buildings++;
    const read = readDoors(def.source);
    if (read.error) {
      counts.unread++;
      continue;
    }
    const rows = [];
    for (const d of read.doors) {
      const style = styles.get(d.style);
      const leaf = style && ((style.door && exists(style.door)) || (style.door2 && exists(style.door2)));
      if (!leaf) {
        counts.noModel++;
        continue;
      }
      const m = (flipX ? mirrorTransform(d.m) : d.m).map((v) => round(v, 4));
      rows.push({ portal: d.portal, style: d.style, cells: d.cells, m, ...(d.fallback ? { fallback: true } : {}) });
      if (d.fallback) counts.fallback++;
      used.set(d.style, style);
    }
    // Written even when empty, so "this building has none" and "never read" are told apart.
    models[def.id] = rows;
    if (rows.length) {
      counts.withDoors++;
      counts.doors += rows.length;
    }
  }
  const out = {};
  for (const [name, s] of [...used].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const id = (a) => (a && exists(a) ? doorModelId(a) : null);
    const sounds = {};
    for (const moment of DOOR_MOMENTS) {
      const list = s.effects[moment] ? soundsOf(s.effects[moment]) : [];
      if (list.length) sounds[moment] = list;
    }
    out[name] = {
      door: id(s.door),
      door2: id(s.door2),
      flip2: s.flip2,
      frame: id(s.frame),
      move: [flipX ? -s.move[0] : s.move[0], s.move[1], s.move[2]].map((v) => round(v, 4)),
      open: round(s.open, 4),
      close: round(s.close, 4),
      spring: round(s.spring, 4),
      smooth: round(s.smooth, 4),
      trigger: round(s.trigger, 4),
      sounds,
    };
  }
  return { file: { version: DOORS_PACK_VERSION, styles: out, models }, counts, appearances: [...new Set([...used.values()].flatMap((s) => [s.door, s.door2, s.frame]).filter((a) => a && exists(a)))] };
}

/**
 * Why a pack's doors want writing again, or null: there is no table, it is an older shape or will not
 * parse, it was written before the manifest it was built from (a world or the gallery converted again
 * since), or it names a door model the shared folder has not got.
 */
export function doorsStale(table, { tableMtime = 0, manifestMtime = 0, models = null } = {}) {
  if (!table) return 'none';
  if (table.version !== DOORS_PACK_VERSION || !table.models || !table.styles) return 'older';
  if (manifestMtime > tableMtime) return 'stale';
  if (models) {
    for (const s of Object.values(table.styles)) {
      for (const id of [s.door, s.door2, s.frame]) if (id && !models.has(id)) return `no model ${id}`;
    }
  }
  return null;
}
