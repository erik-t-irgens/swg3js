// A house of the owner's own with rooms, out of the names on its objects (Map-maker II's eleventh wave, DESIGN.md §2.12's
// "the pass derives"). The portal renderer, the room lights, the indoor nav and the doors already handle any pack's cells;
// what is new is reading them off a glTF, and that is this file: pure, the import pass's own (`imports.mjs` walks the
// nodes and hands what it found here), importing only `tools/swg/` modules, so the release's import check has nothing new
// to carry.
//
// **What the owner authors**, on Blender's objects (Blender's `.001` left out of every name):
//
//   cell:<n>:<name>   an empty (or any object) whose descendants are room n's: its own walls, floor, ceiling and things.
//                     Cell 0 is the shell, the house as seen from outside, with real holes where its doorways are; a piece
//                     under no cell is the shell's. Rooms are numbered 1, 2, 3 with none left out, each name beginning with
//                     a letter. A custom property `ambient` ([r, g, b], 0 to 4) is the room's own fill light. Under the
//                     record's collision `auto` a room (or the shell) collides by its own -colonly pieces where it names
//                     any and by its own triangles where it names none, room by room (`imports.mjs`).
//   portal:<a>:<b>    a flat polygon standing in the doorway between rooms a and b (0 the outside), never drawn or collided;
//                     `portal:<a>:<b>!` a window, seen through and never walked through.
//   floor:<n>         room n's walkable floor, plain triangles, never drawn or collided: what a body walks by indoors.
//   door:<style>      an empty at a doorway naming one of the game's door styles (`cantina_door`): the doorway nearest it
//                     takes the door, and the empty's own X axis says which way round the leaf hangs. Only the style's name
//                     is written; its numbers are the player's own gallery pack's (`doors.ts`), never this file's. A
//                     mesh it carries (a placeholder leaf) is its marker and is left out, never drawn or solid.
//   a point light     exported with Punctual Lights ticked: the room it is under, else the smallest room whose box holds
//                     it, lights by it, through the room pool every building's rooms are lit from.
//
// **What a player's own inside is, and why every room has walls of its own**: someone indoors passes through the shell
// (`Group.exterior`, which every indoor query leaves out), exactly as in the game's own buildings, so a room is walled,
// floored and roofed by its own pieces, and the shell is seen from outside and through the doorways only.
//
// **What it derives**: each cell's box (its pieces, its floor and every vertex of its doorways, then `cellPad` round: exits
// stand off their own cell's box by up to half a metre in the game's own buildings, CLAUDE.md), the doorways both ways
// round, the lights by containment with constants the game's own range rule meets (`roomLights.ts`'s `pointLightRange`),
// the floors (plain triangles, wound up, welded at a millimetre: `buildFloor` rebuilds the adjacency), the doors' rows by
// style name, hung where the client's own fallback hangs a door (`fallbackHardpoint`); and it refuses in words a doorway
// that is not flat, one naming a room that does not exist, a room no doorway reaches from outside, and a room walked into
// with nothing of its own that collides. A doorway's triangles are written largest first with none of no area, since the
// game reads a doorway's plane off its first triangle alone (`doorwayTriangles`).
//
// Every number it picks is a flag of the import command (`IMPORT_TUNE` in `imports.mjs`): `cellPad`, `portalFlat`,
// `doorReach`, `lightReach`, `lightScale`. Two are the game's and not ours: `ROOM_LIGHT_RANGE` and `ROOM_LIGHT_BRIGHTEST`.

import { fallbackHardpoint } from './doors.mjs';

/**
 * The reach the game's own range rule can give a room's point light (`world.ts`'s room pool, `roomLights.ts`): the first
 * whole metre where the light falls under a twentieth of its value at 3 m, held to 40. A light falling as the inverse square
 * crosses that at 13.4 m, and nothing falling faster can be written with constants of nought or more, so 14 is the least.
 */
export const ROOM_LIGHT_RANGE = { least: 14, most: 40 };
/**
 * The brightest a room's light can be read by that rule (candela at 3 m, `9 / 0.05`): past it the rule holds its 3 m value
 * at its cap and the range it works out is another, so a light past it is held to it and said.
 */
export const ROOM_LIGHT_BRIGHTEST = 180;
/** A millimetre, the grid the doorways' and the floors' corners are welded on. */
const WELD = 1000;
const round = (v, places) => {
  const k = 10 ** places;
  return Math.round(v * k) / k;
};
const sig6 = (v) => Number(v.toPrecision(6));

/**
 * A room's name read off an object's (Blender's `.001` left out), or null for any other name: `{ kind: 'cell', index, name }`,
 * `{ kind: 'portal', a, b, window }`, `{ kind: 'floor', cell }`, `{ kind: 'door', style }`, or `{ kind: 'bad', why }` for a name
 * that begins as one of those and does not read as it.
 */
export function roomName(raw) {
  const name = String(raw ?? '').replace(/\.\d{3}$/, '');
  if (!/^(cell|portal|floor|door):/i.test(name)) return null;
  let m = /^cell:(\d+)(?::(.*))?$/i.exec(name);
  if (/^cell:/i.test(name)) {
    if (!m) return { kind: 'bad', why: `${name} is not cell:<number>:<name>` };
    const own = (m[2] ?? '').trim();
    if (/^\d/.test(own)) return { kind: 'bad', why: `${name}: a cell whose own name begins with a digit cannot be read back (cell:17:4way would be read as cell 174): give it a name that begins with a letter` };
    if (own.length > 48 || /[\u0000-\u001f\u007f]/.test(own)) return { kind: 'bad', why: `${name}: a room's name is 48 characters at most` };
    const index = Number(m[1]);
    if (!Number.isSafeInteger(index) || index > 255) return { kind: 'bad', why: `${name}: rooms are numbered 0 to 255` };
    return { kind: 'cell', index, name: own || (index === 0 ? 'exterior' : `room${index}`) };
  }
  m = /^portal:(\d+):(\d+)(!?)(?:[: -].*)?$/i.exec(name);
  if (/^portal:/i.test(name)) return m ? { kind: 'portal', a: Number(m[1]), b: Number(m[2]), window: m[3] === '!' } : { kind: 'bad', why: `${name} is not portal:<room>:<room> (a ! after it for a window)` };
  m = /^floor:(\d+)(?:[: -].*)?$/i.exec(name);
  if (/^floor:/i.test(name)) return m ? { kind: 'floor', cell: Number(m[1]) } : { kind: 'bad', why: `${name} is not floor:<room>` };
  m = /^door:([A-Za-z0-9_]{1,64})(?:[: -].*)?$/i.exec(name);
  return m ? { kind: 'door', style: m[1] } : { kind: 'bad', why: `${name} is not door:<style> (the style a name of letters, digits and underscores, as the game's: cantina_door)` };
}

/** Whether a glTF's nodes name any room (`cell:`, `portal:`, `floor:`, `door:`): what makes it a house with rooms. */
export function namesRooms(json) {
  return (json?.nodes ?? []).some((n) => roomName(n?.name) !== null);
}

/** Pieces of one object's primitives (positions and triangle corners) welded into one polygon or mesh: corners within a millimetre are one, and a triangle that comes to less is dropped. */
export function weldTriangles(prims) {
  const at = new Map();
  const verts = [];
  const tris = [];
  for (const p of prims) {
    const local = new Int32Array(p.pos.length / 3);
    for (let i = 0; i < local.length; i++) {
      const x = p.pos[i * 3];
      const y = p.pos[i * 3 + 1];
      const z = p.pos[i * 3 + 2];
      const key = `${Math.round(x * WELD)},${Math.round(y * WELD)},${Math.round(z * WELD)}`;
      let k = at.get(key);
      if (k === undefined) {
        k = verts.length;
        at.set(key, k);
        verts.push([x, y, z]);
      }
      local[i] = k;
    }
    for (let t = 0; t + 2 < p.idx.length; t += 3) {
      const a = local[p.idx[t]];
      const b = local[p.idx[t + 1]];
      const c = local[p.idx[t + 2]];
      if (a === b || b === c || a === c) continue;
      tris.push(a, b, c);
    }
  }
  return { verts, tris };
}

/**
 * Twice the least area a doorway's triangle keeps, in square metres (its two edges' cross product): three corners in a row,
 * which welding at a millimetre keeps as three, come within float noise of nought, and the thinnest sliver anyone draws on
 * purpose (a millimetre wide, a metre long) stands three orders of magnitude over it.
 */
const NO_AREA = 1e-6;

/**
 * A doorway's welded triangles as the game reads them: the game takes a doorway's plane from its first triangle alone
 * (`assetPack.ts`'s portals, and `portalVis.ts`'s `crosses` sees nothing cross a plane of no normal), so a triangle of no
 * area (three corners in a row, a corner on an edge) is left out, and the largest is put first, the rest in their order (a
 * polygon of equal triangles, as Blender draws a quad, keeps its order).
 */
export function doorwayTriangles(verts, tris) {
  const kept = [];
  let best = 0;
  let bestLen = 0;
  let dropped = 0;
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const a = verts[tris[t]];
    const b = verts[tris[t + 1]];
    const c = verts[tris[t + 2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(len > NO_AREA)) {
      dropped++;
      continue;
    }
    if (len > bestLen) {
      bestLen = len;
      best = kept.length;
    }
    kept.push(tris[t], tris[t + 1], tris[t + 2]);
  }
  if (best > 0) kept.unshift(...kept.splice(best, 3));
  return { tris: kept, dropped };
}

/** A welded polygon's plane: its normal (its triangles' added up, which no listing order can cancel), and how far its farthest corner stands off it; null for one with no area. */
export function planeOf(verts, tris) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const a = verts[tris[t]];
    const b = verts[tris[t + 1]];
    const c = verts[tris[t + 2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    nx += uy * vz - uz * vy;
    ny += uz * vx - ux * vz;
    nz += ux * vy - uy * vx;
  }
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (!(len > 1e-9)) return null;
  nx /= len;
  ny /= len;
  nz /= len;
  let d = 0;
  for (const v of verts) d += nx * v[0] + ny * v[1] + nz * v[2];
  d /= verts.length;
  let off = 0;
  for (const v of verts) off = Math.max(off, Math.abs(nx * v[0] + ny * v[1] + nz * v[2] - d));
  return { normal: [nx, ny, nz], d, off };
}

/** The squared distance from a point to a triangle (the nearest point on it, Ericson's regions). */
function triangleDistanceSq(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const add = (u, v, s) => [u[0] + v[0] * s, u[1] + v[1] * s, u[2] + v[2] * s];
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  let q;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    const vc = d1 * d4 - d3 * d2;
    const cp = sub(p, c);
    const d5 = dot(ab, cp);
    const d6 = dot(ac, cp);
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) q = b;
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) q = add(a, ab, d1 / (d1 - d3));
    else if (d6 >= 0 && d5 <= d6) q = c;
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) q = add(a, ac, d2 / (d2 - d6));
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) q = add(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
    else {
      const den = 1 / (va + vb + vc);
      q = add(add(a, ab, vb * den), ac, vc * den);
    }
  }
  const d = sub(p, q);
  return dot(d, d);
}

/**
 * A room's point light's constants (Direct3D's `1 / (c + l d + q d^2)`, which the game's room pool reads) for a range and a
 * brightness: the game's range rule (`roomLights.ts`'s `pointLightRange`: the first whole metre past which the falloff is
 * under a twentieth of its 3 m value) meets `range` for any whole metre from 14 to 40, by a quadratic falloff whose
 * crossing stands half a metre short of it; and the light's value at 3 m is `brightness / 9`, which is three's own reading of
 * a point light of that many candela there. `range` is held to `ROOM_LIGHT_RANGE` and `brightness` above nought and at most
 * `ROOM_LIGHT_BRIGHTEST` by the caller.
 */
export function roomPointAttenuation(range, brightness) {
  const r = Math.round(range);
  const q0 = 19 / ((r - 0.5) * (r - 0.5) - 180);
  const s = 9 / (brightness * (1 + 9 * q0));
  return [sig6(s), 0, sig6(s * q0)];
}

const emptyBox = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const boxOk = (b) => b.min.every(Number.isFinite) && b.max.every(Number.isFinite);
function growPoint(box, x, y, z) {
  if (x < box.min[0]) box.min[0] = x;
  if (y < box.min[1]) box.min[1] = y;
  if (z < box.min[2]) box.min[2] = z;
  if (x > box.max[0]) box.max[0] = x;
  if (y > box.max[1]) box.max[1] = y;
  if (z > box.max[2]) box.max[2] = z;
}
const inBox = (b, p) => p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && p[2] >= b.min[2] && p[2] <= b.max[2];
const volume = (b) => (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);

/**
 * The rooms of one house, out of what the import pass's walk found (`found`):
 *   `cells`   [{ index, name, ambient? }] the `cell:` objects (one index may be named by several objects of one name);
 *   `pieces`  the level-0 pieces as they will stand ([{ pos, cell, solid }]: a piece under no cell is the shell's, -1 here;
 *             `solid` false for one drawn and never collided);
 *   `portals` [{ a, b, window, name, prims: [{ pos, idx }] }];
 *   `floors`  [{ cell, name, prims }];
 *   `doors`   [{ style, name, m }] (`m` the object's whole matrix, column-major);
 *   `lights`  [{ light, m, cell, name }] (`light` the glTF light, `cell` the room it is under, -1 for none).
 * Answers `{ refuse: [...] }` in words, or `{ cells, portals, floors, doors, notes, rooms }`: the manifest's `cells` (each
 * with its padded box, its doorways and its lights) and `portals`, the floors by room for `floors.json`, the doors' rows
 * for `doors.json`, and how many rooms there are past the shell.
 */
export function deriveRooms(found, tune) {
  const refuse = [];
  const notes = [];
  // ---- the rooms named ----
  const named = new Map();
  for (const c of found.cells) {
    const had = named.get(c.index);
    if (had && had.name !== c.name) refuse.push(`cell:${c.index} is named both ${had.name} and ${c.name}: one room, one name (two objects of one room may share it)`);
    else if (!had) named.set(c.index, { name: c.name, ambient: c.ambient ?? null });
    else if (c.ambient && !had.ambient) had.ambient = c.ambient;
  }
  if (!named.has(0)) named.set(0, { name: 'exterior', ambient: null });
  const top = Math.max(...named.keys());
  if (top < 1) refuse.push('it names doorways, floors or doors (portal:, floor:, door:) and no room: name each room cell:<n>:<name>, the shell cell:0');
  for (let i = 1; i <= top; i++) if (!named.has(i)) refuse.push(`rooms are numbered 1, 2, 3 with none left out: there is a cell:${top} and no cell:${i}`);
  const count = top + 1;
  const exists = (i) => Number.isInteger(i) && i >= 0 && i < count && named.has(i);

  // ---- what stands in each ----
  const boxes = Array.from({ length: count }, emptyBox);
  const pieceCount = new Array(count).fill(0);
  // What of each room collides (a piece's `solid`, false for one drawn and never collided): someone indoors passes through
  // the shell, so a room walked into with nothing solid of its own has no floor under them.
  const solidCount = new Array(count).fill(0);
  let shellOrphans = 0;
  for (const p of found.pieces) {
    let c = p.cell;
    if (!(c >= 0)) {
      c = 0;
      shellOrphans++;
    }
    if (!exists(c)) continue;
    pieceCount[c]++;
    if (p.solid !== false) solidCount[c]++;
    const box = boxes[c];
    for (let i = 0; i + 2 < p.pos.length; i += 3) growPoint(box, p.pos[i], p.pos[i + 1], p.pos[i + 2]);
  }
  if (shellOrphans) notes.push(`${shellOrphans} piece(s) under no cell: made the shell's (cell 0), seen from outside and through the doorways only`);
  if (!pieceCount[0]) refuse.push('the shell (cell:0, and every piece under no cell) holds nothing: a house is seen from outside by its shell, with real holes where its doorways are');
  for (let i = 1; i < count; i++) if (named.has(i) && !pieceCount[i]) refuse.push(`room ${i} (${named.get(i).name}) holds nothing: model its own walls, floor and ceiling under it (someone indoors passes through the shell)`);

  // ---- the doorways ----
  const portals = [];
  const links = Array.from({ length: count }, () => []);
  let slivers = 0;
  for (const p of found.portals) {
    const label = p.name || `portal:${p.a}:${p.b}`;
    if (!exists(p.a) || !exists(p.b)) {
      refuse.push(`${label} joins a room that does not exist (${!exists(p.a) ? p.a : p.b}): the rooms are cell:0 to cell:${count - 1}`);
      continue;
    }
    if (p.a === p.b) {
      refuse.push(`${label} joins room ${p.a} to itself: a doorway stands between two rooms (0 the outside)`);
      continue;
    }
    const welded = weldTriangles(p.prims);
    const verts = welded.verts;
    const { tris, dropped } = doorwayTriangles(verts, welded.tris);
    slivers += dropped;
    const plane = verts.length >= 3 && tris.length >= 3 ? planeOf(verts, tris) : null;
    if (!plane) {
      refuse.push(`${label} has no area: a doorway is a flat polygon filling the opening`);
      continue;
    }
    if (plane.off > tune.portalFlat) {
      refuse.push(`${label} is not flat: a corner stands ${plane.off.toFixed(3)} m off its plane, past ${tune.portalFlat} m (--portal-flat=): a doorway is one flat polygon`);
      continue;
    }
    const geometry = portals.length;
    portals.push({ v: verts.map((v) => v.map((x) => round(x, 4))), i: tris, a: p.a, b: p.b, window: p.window, label });
    links[p.a].push({ geometry, target: p.b, passable: !p.window });
    links[p.b].push({ geometry, target: p.a, passable: !p.window });
    for (const v of verts) {
      growPoint(boxes[p.a], v[0], v[1], v[2]);
      growPoint(boxes[p.b], v[0], v[1], v[2]);
    }
  }
  if (slivers) notes.push(`${slivers} doorway triangle(s) of no area (three corners in a row) left out: the game reads a doorway's plane off its first triangle, which is its largest`);

  // ---- the floors: every floor object of a room welded together, so two pieces meeting at an edge are one floor ----
  const floors = {};
  let leaning = 0;
  const floorPrims = new Map();
  for (const f of found.floors) {
    const label = f.name || `floor:${f.cell}`;
    if (!exists(f.cell)) {
      refuse.push(`${label} is the floor of a room that does not exist: the rooms are cell:1 to cell:${count - 1}`);
      continue;
    }
    if (f.cell === 0) {
      notes.push(`${label}: the shell's floor is the ground's, so it was left out`);
      continue;
    }
    const had = floorPrims.get(f.cell);
    if (had) had.prims.push(...f.prims);
    else floorPrims.set(f.cell, { label, prims: [...f.prims] });
  }
  for (const [cell, f] of [...floorPrims].sort((x, y) => x[0] - y[0])) {
    const label = f.label;
    const { verts, tris } = weldTriangles(f.prims);
    const kept = [];
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const a = verts[tris[t]];
      const b = verts[tris[t + 1]];
      const c = verts[tris[t + 2]];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const ny = uz * vx - ux * vz;
      const nx = uy * vz - uz * vy;
      const nz = ux * vy - uy * vx;
      // A face standing on its edge is no floor: walked over it is nothing, and seen from above it has no area.
      if (Math.abs(ny) <= 1e-6 * Math.sqrt(nx * nx + ny * ny + nz * nz) || Math.abs(ny) < 1e-9) {
        leaning++;
        continue;
      }
      // Wound so (b - a) x (c - a) points up, as the converter's floors are.
      if (ny > 0) kept.push(tris[t], tris[t + 1], tris[t + 2]);
      else kept.push(tris[t], tris[t + 2], tris[t + 1]);
    }
    if (!kept.length) {
      notes.push(`${label} has no triangle that faces up: left out`);
      continue;
    }
    floors[cell] = { v: verts.flatMap((v) => [round(v[0], 4), round(v[1], 4), round(v[2], 4)]), t: kept, stride: 3 };
    for (const v of verts) growPoint(boxes[cell], v[0], v[1], v[2]);
  }
  if (leaning) notes.push(`${leaning} floor triangle(s) standing on their edges left out of the floors`);
  for (let i = 1; i < count; i++) if (named.has(i) && !floors[i]) notes.push(`room ${i} (${named.get(i).name}) has no floor:${i}: a body in it steers straight at where it is going`);

  // ---- every room reached from outside ----
  const reached = new Uint8Array(count);
  const walked = new Uint8Array(count);
  const flood = (seen, walkable) => {
    seen[0] = 1;
    const stack = [0];
    while (stack.length) {
      const c = stack.pop();
      for (const l of links[c]) {
        if (seen[l.target] || (walkable && !l.passable)) continue;
        seen[l.target] = 1;
        stack.push(l.target);
      }
    }
  };
  flood(reached, false);
  flood(walked, true);
  for (let i = 1; i < count; i++) {
    if (!named.has(i)) continue;
    if (!reached[i]) refuse.push(`room ${i} (${named.get(i).name}): no doorway leads to it from outside, through any room (a portal:<a>:<b> names the two rooms it joins, 0 the outside)`);
    else if (!walked[i]) notes.push(`room ${i} (${named.get(i).name}) is seen only through a window: nobody walks into it`);
    else if (pieceCount[i] && !solidCount[i]) refuse.push(`room ${i} (${named.get(i).name}) has nothing that collides, so someone who walks in falls through its floor (someone indoors passes through the shell): its pieces are all -nocol, or its record's collision leaves them out (stand-in with no -colonly under this room, or none); let them collide (collision auto or triangles) or give the room a -colonly stand-in of its own that carries its floor`);
  }

  // ---- the boxes, padded ----
  const pad = tune.cellPad;
  for (let i = 0; i < count; i++) {
    if (!boxOk(boxes[i])) continue;
    for (let k = 0; k < 3; k++) {
      boxes[i].min[k] -= pad;
      boxes[i].max[k] += pad;
    }
  }

  // ---- the doors, by style name, each in the doorway nearest it ----
  const doors = [];
  const doorOf = new Map();
  for (const d of found.doors) {
    const label = d.name || `door:${d.style}`;
    const p = [d.m[12], d.m[13], d.m[14]];
    let best = -1;
    let bestD = Infinity;
    portals.forEach((g, k) => {
      for (let t = 0; t + 2 < g.i.length; t += 3) {
        const dd = triangleDistanceSq(p, g.v[g.i[t]], g.v[g.i[t + 1]], g.v[g.i[t + 2]]);
        if (dd < bestD) {
          bestD = dd;
          best = k;
        }
      }
    });
    if (best < 0 || Math.sqrt(bestD) > tune.doorReach) {
      notes.push(`${label} stands ${best < 0 ? 'where there is no doorway' : `${Math.sqrt(bestD).toFixed(2)} m from the nearest doorway, past ${tune.doorReach} m (--door-reach=)`}: left out (put it at the doorway's bottom middle)`);
      continue;
    }
    if (doorOf.has(best)) {
      notes.push(`${label}: ${portals[best].label} has a door already (${doorOf.get(best)}): left out`);
      continue;
    }
    const g = portals[best];
    // Hung where the client's own fallback hangs a door with no hardpoint: the doorway's bottom middle, upright, its Z
    // along the doorway's normal. The empty's own X says which way round: turned half round where it points the other way.
    const m = fallbackHardpoint(g.v, g.i);
    if (!m) {
      notes.push(`${label}: ${g.label} lies flat (a hatch), and a door stands upright in a doorway: left out`);
      continue;
    }
    const ex = [d.m[0], d.m[1], d.m[2]];
    if (ex[0] * m[0] + ex[1] * m[4] + ex[2] * m[8] < 0) for (const k of [0, 4, 8, 2, 6, 10]) m[k] = -m[k];
    doorOf.set(best, label);
    doors.push({ portal: best, style: d.style, cells: [g.a, g.b], m: m.map((v) => round(v, 4)) });
  }

  // ---- the lights, each in its room ----
  const lightsOf = Array.from({ length: count }, () => []);
  let pointsMost = 0;
  for (const c of named.keys()) {
    const a = named.get(c).ambient;
    if (a && c > 0) lightsOf[c].push({ type: 0, color: a.map((v) => round(v, 3)), position: [0, 0, 0], direction: [0, 0, -1], attenuation: [1, 0, 0] });
  }
  for (const l of found.lights) {
    const label = l.name || 'a light';
    const pos = [l.m[12], l.m[13], l.m[14]];
    let room = l.cell >= 1 && exists(l.cell) ? l.cell : -1;
    if (room < 0) {
      let bestV = Infinity;
      for (let i = 1; i < count; i++) {
        if (!boxOk(boxes[i]) || !inBox(boxes[i], pos)) continue;
        const v = volume(boxes[i]);
        if (v < bestV) {
          bestV = v;
          room = i;
        }
      }
    }
    if (room < 0) {
      notes.push(`${label} stands in no room: left out (a room is lit by its own lights, the street by the sky)`);
      continue;
    }
    const def = l.light ?? {};
    const color = (Array.isArray(def.color) && def.color.length >= 3 ? def.color.slice(0, 3) : [1, 1, 1]).map((v) => round(Math.max(0, Number(v) || 0), 3));
    const intensity = typeof def.intensity === 'number' ? def.intensity : 1;
    if (!(intensity > 0)) {
      notes.push(`${label} has no brightness: left out`);
      continue;
    }
    // A light points down its own -Z (glTF).
    const dz = [-l.m[8], -l.m[9], -l.m[10]];
    const dl = Math.sqrt(dz[0] * dz[0] + dz[1] * dz[1] + dz[2] * dz[2]) || 1;
    const direction = dz.map((v) => round(v / dl, 3));
    const position = pos.map((v) => round(v, 2));
    if (def.type === 'directional') {
      notes.push(`${label} is a sun in room ${room}: drawn as the room's one parallel light, at the game's own brightness`);
      lightsOf[room].push({ type: 1, color, position, direction, attenuation: [1, 0, 0] });
      continue;
    }
    if (def.type === 'spot') notes.push(`${label} is a spot light: drawn as a point light (a room's lights are points)`);
    let range = typeof def.range === 'number' && def.range > 0 ? def.range : tune.lightReach;
    if (range < ROOM_LIGHT_RANGE.least) {
      notes.push(`${label} reaches ${range} m: the game's rooms light no nearer than ${ROOM_LIGHT_RANGE.least} m, so it reaches that`);
      range = ROOM_LIGHT_RANGE.least;
    } else if (range > ROOM_LIGHT_RANGE.most) {
      notes.push(`${label} reaches ${range} m: the game's rooms light no farther than ${ROOM_LIGHT_RANGE.most} m, so it reaches that`);
      range = ROOM_LIGHT_RANGE.most;
    }
    let brightness = intensity * tune.lightScale;
    if (brightness > ROOM_LIGHT_BRIGHTEST) {
      notes.push(`${label} is ${round(brightness, 1)} cd: the game's rule reads a room's light to ${ROOM_LIGHT_BRIGHTEST} cd at most, so it is that (--light-scale= moves every light)`);
      brightness = ROOM_LIGHT_BRIGHTEST;
    }
    lightsOf[room].push({ type: 2, color, position, direction, attenuation: roomPointAttenuation(range, brightness) });
    pointsMost = Math.max(pointsMost, lightsOf[room].filter((x) => x.type === 2).length);
  }
  if (pointsMost > 8) notes.push(`a room holds ${pointsMost} point lights: the room pool lights eight at once, the room's own first and then the rooms its doorways open on`);

  if (refuse.length) return { refuse };
  const cells = [];
  for (let i = 0; i < count; i++) {
    const box = boxOk(boxes[i]) ? boxes[i] : { min: [0, 0, 0], max: [0, 0, 0] };
    cells.push({
      index: i,
      name: named.get(i).name,
      bounds: { min: box.min.map((v) => round(v, 4)), max: box.max.map((v) => round(v, 4)) },
      portals: links[i],
      ...(lightsOf[i].length ? { lights: lightsOf[i] } : {}),
    });
  }
  const floorBlocks = {};
  for (const [k, f] of Object.entries(floors)) floorBlocks[k] = { floor: f };
  return { cells, portals: portals.map((g) => ({ v: g.v, i: g.i })), floors: floorBlocks, doors, notes, rooms: count - 1 };
}
