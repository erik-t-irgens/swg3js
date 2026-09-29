// Which building a thing placed inside a building belongs to, worked out once when a world's layout is
// read, so the streamer can draw a room's furniture with that building's rooms and nowhere else.
//
// A snapshot says a placed object is `contained` and nothing more: which building holds it, and which
// room, were the server's (a cell object's container), and the converter does not write either yet. So
// the host is found here from the building models' own room boxes (`PackModelDef.cells[].bounds`), which
// the manifest carries whether or not a model is loaded: the placed building one of whose rooms, grown by
// `boxPad`, holds the object's origin. Measured over the converted towns no object is held by the rooms
// of two buildings at once, so the building is a sound answer; which room is not (room boxes overlap and
// a third to a half of the furniture sits in more than one), so each object keeps a mask of every room
// its own sphere reaches, and it is drawn whenever any of those is seen. A thing whose sphere reaches one
// of its building's exits (`doorwayPad` spare) is a doorway thing and keeps the old rule -- the actor
// layer, drawn in every pass -- since part of it stands outside.
//
// Pure apart from three's matrices, so a node test runs it over the real packs. Everything here runs when
// a world is read or a thing is put down, never on a frame.
import * as THREE from 'three';
import { PORTAL_CULL } from './portalVis.ts';

/** How furniture is hosted and drawn (commit 2b). */
export interface FurnitureTune {
  /** Furniture is drawn only in its own building's pass, with the rooms it can be in; off, every pass draws it as before. */
  perBuilding: boolean;
  /** How far outside a room's box an object's origin may stand and still be in that room, metres. Ours. */
  boxPad: number;
  /** How near an exit's polygon an object's sphere may come before it counts as standing in the doorway, metres. Ours. */
  doorwayPad: number;
  /**
   * Take the building the snapshot names (step 7: a pack whose layout carries each indoor object's `in` and
   * `cell`) over the rooms' boxes, and add the room it names to the rooms the boxes find. Read when a world is read.
   */
  exactRooms: boolean;
}

export const FURNITURE_TUNE: FurnitureTune = { perBuilding: true, boxPad: 0.5, doorwayPad: 0.3, exactRooms: true };

/**
 * Whether furniture is drawn per building now: the switch, under the portal cull's own (`mode: 'all'`
 * puts every cut back, this one with the rest). The streamer applies it to its groups when it changes
 * (`LayoutStreamer.syncFurniture`) and the portal renderer leaves the building it stands in out of the
 * shadow pass under it.
 */
export function furnitureOn(tune: FurnitureTune = FURNITURE_TUNE): boolean {
  return PORTAL_CULL.on && PORTAL_CULL.mode === 'rooms' && tune.perBuilding;
}

/**
 * What a furniture mesh is to the switch. The indoor copies of one piece of one model in one tier and
 * region used to be one mesh on the actor layer; with the switch they are one mesh per building that holds
 * them (`room`) and one of those in no room box or in a doorway (`whenOn`). Both groupings are built, and
 * the old one (`whenOff`, every indoor copy together, exactly the mesh the old rule made) is what is drawn
 * while the switch is off, so the old way is one flip away and draws what it always drew, not the per-building
 * split on the actor layer, which is a third of a town's furniture meshes over it. A `room` mesh with such a
 * twin (`twinned`) is hidden while the switch is off; one with none (a thing put down in play, whose own mesh
 * of one it always was) is drawn on the actor layer then, as before. `plain` is a mesh no switch moves: it
 * was a building's, and the building was taken up.
 */
export const FURNITURE_ROLE = { room: 0, whenOn: 1, whenOff: 2, plain: 3 } as const;

/**
 * One building's share of one tier's furniture: an instanced mesh of the copies of one piece of one model
 * that stand in that building's rooms, the rooms they can be seen in, and how it is drawn now; or one of the
 * two meshes a switch flip trades between (`role`).
 */
export interface FurnitureGroup {
  mesh: THREE.Object3D;
  /** The rooms its copies can be seen in (`maskSeen`). */
  lo: number;
  hi: number;
  any: boolean;
  /** Its programs exist: the tier has revealed it. Never shown before. */
  ready: boolean;
  /** Drawn in its building's pass only (the switch was on when it was last applied); else on the actor layer, as before. */
  routed: boolean;
  /** Whether it casts a shadow when it is not routed: what the old rule gave it. */
  cast: boolean;
  /** `FURNITURE_ROLE`. */
  role: number;
  /** A `room` mesh whose copies the old grouping's mesh (`whenOff`) draws while the switch is off. */
  twinned: boolean;
}

/** How a furniture mesh is drawn now (`furnitureDraw`): shown or not, on the rooms' layer alone or the actor layer, and whether it casts. */
export interface FurnitureDraw {
  /** Left as it was built: its programs do not exist yet, so it is hidden, on the layers it was compiled for. */
  wait: boolean;
  /** Shown only by the portal renderer, with its building's rooms (`showInterior`). */
  routed: boolean;
  visible: boolean;
  /** On the rooms' layer alone (routed), else on the world's and the actor layer. */
  rooms: boolean;
  castShadow: boolean;
}

/**
 * How one furniture mesh is drawn with the switch `on` (`furnitureOn()`), and `broken` when the portal
 * renderer has hidden it for failing to draw, which nothing shows again. A pure function of the group, so
 * the node test walks every case; the streamer applies it (`LayoutStreamer.applyFurniture`).
 */
export function furnitureDraw(g: FurnitureGroup, on: boolean, broken: boolean, out: FurnitureDraw): FurnitureDraw {
  out.wait = !g.ready;
  out.routed = false;
  out.rooms = false;
  out.castShadow = g.cast;
  if (out.wait) {
    out.visible = false;
    return out;
  }
  if (g.role === FURNITURE_ROLE.whenOn) out.visible = on;
  else if (g.role === FURNITURE_ROLE.whenOff) out.visible = !on;
  else if (g.role === FURNITURE_ROLE.room && on) {
    out.routed = true;
    out.rooms = true;
    out.castShadow = false;
    // The portal renderer shows it, pass by pass.
    out.visible = false;
  } else out.visible = !(g.role === FURNITURE_ROLE.room && g.twinned);
  if (broken) out.visible = false;
  return out;
}

/**
 * The meshes one piece of one model's copies in one tier and region are made into, each with its role: the
 * outdoor copies (role -1, no switch moves them), and of the indoor ones one per building that holds them
 * (`room`), the rest (in no room box, or in a doorway) together, and all of them together as the old rule
 * made them (`whenOff`) whenever any building holds one. With none held, the rest are the old mesh itself
 * and no switch moves them either. `host` is what a copy's `host` names (the building), or null.
 */
export function splitCopies<T extends { contained: boolean; host?: H }, H>(all: readonly T[]): { list: T[]; role: number; host: H | null }[] {
  const outdoor: T[] = [];
  const loose: T[] = [];
  const indoor: T[] = [];
  const byHost = new Map<H, T[]>();
  for (const p of all) {
    if (!p.contained) {
      outdoor.push(p);
      continue;
    }
    indoor.push(p);
    const h = p.host;
    if (h !== undefined && h !== null) {
      let list = byHost.get(h);
      if (!list) byHost.set(h, (list = []));
      list.push(p);
    } else loose.push(p);
  }
  const out: { list: T[]; role: number; host: H | null }[] = [];
  if (outdoor.length) out.push({ list: outdoor, role: -1, host: null });
  const twinned = byHost.size > 0;
  if (loose.length) out.push({ list: loose, role: twinned ? FURNITURE_ROLE.whenOn : -1, host: null });
  for (const [host, list] of byHost) out.push({ list, role: FURNITURE_ROLE.room, host });
  if (twinned) out.push({ list: indoor, role: FURNITURE_ROLE.whenOff, host: null });
  return out;
}

/**
 * Mark a mesh as a room's furniture: its layers move with the switch, so whatever sweep compiles it must
 * build both the world's and the rooms' programs (`World.passesOf`), or the next flip builds one on a live frame.
 */
export function markFurniture(o: THREE.Object3D): void {
  o.userData.furniture = true;
}

/** Whether a mesh is a room's furniture (`markFurniture`). */
export function isFurniture(o: THREE.Object3D): boolean {
  return o.userData.furniture === true;
}

/** An object as the streamer holds it, in the world's frame. */
export interface HostObject {
  model: string;
  x: number;
  y: number;
  z: number;
  q: { x: number; y: number; z: number; w: number };
  contained: boolean;
  /**
   * The building that holds it and its room, as the snapshot itself says (step 7: the cell object that
   * contains it, and that cell's building, written by the converter): the index of the building in the same
   * list, and the room. Absent in a pack converted before, which finds both from the rooms' boxes.
   */
  hostIndex?: number;
  cell?: number;
}

/** The parts of a model's manifest entry hosting reads. */
export interface HostDef {
  bounds?: { min: readonly number[]; max: readonly number[] };
  cells?: readonly { index: number; bounds: { min: readonly number[]; max: readonly number[] }; portals?: readonly { geometry: number; target: number }[] }[];
  portals?: readonly { v: readonly (readonly number[])[]; i: readonly number[] }[];
  particle?: boolean;
}

/** What hosting says of one object: `flags` bits. */
export const HOST_FLAG = {
  /** Its sphere reaches one of its host's exits: drawn in every pass, as before. */
  doorway: 1,
  /** One of its rooms is numbered past 63, beyond the mask: shown whenever any room of its host is. */
  anyRoom: 2,
  /** A room of a second building held its origin too (the nearest room box won). */
  twoHosts: 4,
} as const;

/** A room mask: rooms 1 to 63, two words. */
export interface HostAnswer {
  /** The host building's place in the list it was indexed from, or -1. */
  host: number;
  lo: number;
  hi: number;
  flags: number;
}

/** A hosting building, worked out once: where it stands, its rooms' boxes and its exits' triangles in its own frame. */
interface HostBuilding {
  index: number;
  /** World to model, column-major. */
  inv: Float64Array;
  /** Per room: its cell index, then its box (min x, y, z, max x, y, z), corners sorted since some packs store them swapped. */
  rooms: Int32Array;
  boxes: Float64Array;
  /** The exits' triangles, nine numbers each. */
  exitTris: Float64Array;
}

const GRID = 64;

/**
 * An index of the buildings that can host furniture, over a coarse grid on the ground. Buildings are
 * added as they are read (the layout's own in one go, a house put down in play later) and taken out
 * again by their index.
 */
export class FurnitureIndex {
  private readonly cells = new Map<string, HostBuilding[]>();
  private readonly byIndex = new Map<number, { b: HostBuilding; keys: string[] }>();
  readonly tune: FurnitureTune;

  constructor(tune: FurnitureTune = FURNITURE_TUNE) {
    this.tune = tune;
  }

  /** How many buildings the index holds. */
  get size(): number {
    return this.byIndex.size;
  }

  /** Whether a model can host furniture at all: it has rooms, and portals to draw them through. */
  static hosts(def: HostDef | undefined): boolean {
    return !!def && !def.particle && !!def.cells?.some((c) => c.index > 0 && !!c.bounds) && !!def.portals?.length;
  }

  /** Index one placed building under `index`; false (and nothing kept) for a model that cannot host. */
  add(index: number, o: HostObject, def: HostDef | undefined): boolean {
    if (!FurnitureIndex.hosts(def) || this.byIndex.has(index)) return false;
    const d = def as HostDef;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(o.x, o.y, o.z), new THREE.Quaternion(o.q.x, o.q.y, o.q.z, o.q.w), new THREE.Vector3(1, 1, 1));
    const inv = Float64Array.from(m.clone().invert().elements);
    const rooms: number[] = [];
    const boxes: number[] = [];
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const c of d.cells ?? []) {
      if (c.index <= 0 || !c.bounds || c.bounds.min.length < 3 || c.bounds.max.length < 3) continue;
      rooms.push(c.index);
      // Min x, y, z then max x, y, z, each corner taken as an extent.
      for (let a = 0; a < 3; a++) {
        const mn = Math.min(c.bounds.min[a], c.bounds.max[a]);
        boxes.push(mn);
        lo[a] = Math.min(lo[a], mn);
      }
      for (let a = 0; a < 3; a++) {
        const mx = Math.max(c.bounds.min[a], c.bounds.max[a]);
        boxes.push(mx);
        hi[a] = Math.max(hi[a], mx);
      }
    }
    // The exits: every portal a room lists as leading to the world, or the world lists as leading to a room.
    const exits = new Set<number>();
    for (const c of d.cells ?? []) for (const l of c.portals ?? []) if (c.index === 0 || l.target === 0) exits.add(l.geometry);
    const tris: number[] = [];
    for (const k of exits) {
      const p = d.portals?.[k];
      if (!p) continue;
      for (let i = 0; i + 2 < p.i.length; i += 3) {
        const a = p.v[p.i[i]];
        const b = p.v[p.i[i + 1]];
        const cc = p.v[p.i[i + 2]];
        if (!a || !b || !cc) continue;
        tris.push(a[0], a[1], a[2], b[0], b[1], b[2], cc[0], cc[1], cc[2]);
      }
    }
    const hb: HostBuilding = { index, inv, rooms: Int32Array.from(rooms), boxes: Float64Array.from(boxes), exitTris: Float64Array.from(tris) };
    // Its rooms' footprint on the ground, in the world, padded, onto the grid.
    const pad = this.tune.boxPad + 1;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    const v = new THREE.Vector3();
    for (let c = 0; c < 8; c++) {
      v.set(c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]).applyMatrix4(m);
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      z0 = Math.min(z0, v.z);
      z1 = Math.max(z1, v.z);
    }
    const keys: string[] = [];
    for (let gx = Math.floor((x0 - pad) / GRID); gx <= Math.floor((x1 + pad) / GRID); gx++) {
      for (let gz = Math.floor((z0 - pad) / GRID); gz <= Math.floor((z1 + pad) / GRID); gz++) {
        const key = `${gx},${gz}`;
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(hb);
        keys.push(key);
      }
    }
    this.byIndex.set(index, { b: hb, keys });
    return true;
  }

  /** Take a building out of the index again. */
  remove(index: number): void {
    const e = this.byIndex.get(index);
    if (!e) return;
    this.byIndex.delete(index);
    for (const key of e.keys) {
      const list = this.cells.get(key);
      if (!list) continue;
      const i = list.indexOf(e.b);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) this.cells.delete(key);
    }
  }

  /**
   * The host of one contained object, its candidate rooms and its flags, into `out`. The host is the
   * indexed building one of whose rooms (grown by `boxPad`) holds the object's origin, the smallest such
   * room deciding between two buildings; the rooms are every room of the host whose grown box the
   * object's sphere reaches, and every room whose grown box holds its origin.
   */
  assign(o: HostObject, def: HostDef | undefined, out: HostAnswer): HostAnswer {
    out.host = -1;
    out.lo = 0;
    out.hi = 0;
    out.flags = 0;
    const list = this.cells.get(`${Math.floor(o.x / GRID)},${Math.floor(o.z / GRID)}`);
    if (!list) return out;
    const pad = this.tune.boxPad;
    let best: HostBuilding | null = null;
    let bestVolume = Infinity;
    let holders = 0;
    for (const b of list) {
      const e = b.inv;
      const lx = e[0] * o.x + e[4] * o.y + e[8] * o.z + e[12];
      const ly = e[1] * o.x + e[5] * o.y + e[9] * o.z + e[13];
      const lz = e[2] * o.x + e[6] * o.y + e[10] * o.z + e[14];
      let held = false;
      for (let r = 0; r < b.rooms.length; r++) {
        const x = b.boxes;
        const k = r * 6;
        if (lx < x[k] - pad || ly < x[k + 1] - pad || lz < x[k + 2] - pad || lx > x[k + 3] + pad || ly > x[k + 4] + pad || lz > x[k + 5] + pad) continue;
        held = true;
        const volume = (x[k + 3] - x[k]) * (x[k + 4] - x[k + 1]) * (x[k + 5] - x[k + 2]);
        if (volume < bestVolume) {
          bestVolume = volume;
          best = b;
        }
      }
      if (held) holders++;
    }
    if (!best) return out;
    out.host = best.index;
    if (holders > 1) out.flags |= HOST_FLAG.twoHosts;
    this.roomsIn(best, o, def, -1, out);
    return out;
  }

  /** Whether a building is indexed under `index`. */
  has(index: number): boolean {
    return this.byIndex.has(index);
  }

  /**
   * The same answer when the snapshot says which building and which room (step 7): the host is that building,
   * the room mask is that room and every room of it the boxes find (`roomsIn`), and whether it stands in one of
   * the building's exits is measured as `assign` measures it. A room past 63 takes the `anyRoom` flag, as a
   * box-found one does.
   */
  assignTo(index: number, cell: number, o: HostObject, def: HostDef | undefined, out: HostAnswer): HostAnswer {
    out.host = -1;
    out.lo = 0;
    out.hi = 0;
    out.flags = 0;
    const e = this.byIndex.get(index);
    if (!e) return out;
    out.host = index;
    this.roomsIn(e.b, o, def, cell, out);
    return out;
  }

  /**
   * The rooms of `best` an object can be seen in, and whether it stands in an exit, into `out`: every room whose
   * grown box its sphere reaches or holds its origin, and with `exact` a room number (the snapshot's), that room
   * as well.
   */
  private roomsIn(best: HostBuilding, o: HostObject, def: HostDef | undefined, exact: number, out: HostAnswer): void {
    const pad = this.tune.boxPad;
    // The object's sphere, in the host's frame: its own model's box turned and placed, then brought in.
    const e = best.inv;
    let cx = o.x;
    let cy = o.y;
    let cz = o.z;
    let radius = 0.5;
    const bb = def?.bounds;
    if (bb && bb.min.length >= 3 && bb.max.length >= 3) {
      const mx = (bb.min[0] + bb.max[0]) / 2;
      const my = (bb.min[1] + bb.max[1]) / 2;
      const mz = (bb.min[2] + bb.max[2]) / 2;
      // The box's middle turned by the object's own turn (q v q*), then placed.
      const q = o.q;
      const tx = 2 * (q.y * mz - q.z * my);
      const ty = 2 * (q.z * mx - q.x * mz);
      const tz = 2 * (q.x * my - q.y * mx);
      cx += mx + q.w * tx + (q.y * tz - q.z * ty);
      cy += my + q.w * ty + (q.z * tx - q.x * tz);
      cz += mz + q.w * tz + (q.x * ty - q.y * tx);
      // Extents, never corners: a pack's two corners may be either way round.
      radius = Math.max(0.05, Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) / 2);
    }
    const sx = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
    const sy = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
    const sz = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
    const ox = e[0] * o.x + e[4] * o.y + e[8] * o.z + e[12];
    const oy = e[1] * o.x + e[5] * o.y + e[9] * o.z + e[13];
    const oz = e[2] * o.x + e[6] * o.y + e[10] * o.z + e[14];
    const x = best.boxes;
    const addRoom = (cell: number): void => {
      if (cell < 32) out.lo = (out.lo | (1 << cell)) >>> 0;
      else if (cell < 64) out.hi = (out.hi | (1 << (cell - 32))) >>> 0;
      else out.flags |= HOST_FLAG.anyRoom;
    };
    // The snapshot's own room, where it names one; and with it, always, every room the boxes find, since what
    // the snapshot names is the one room a thing is filed in and not every room it can be seen in: a long table
    // reaches through a doorway into the room beyond, and a few dozen things are filed in a neighbouring cell
    // (the house whose jars are filed in its lift shaft while they stand in the hall), and either drawn only with
    // the room it is filed in would vanish from the room it stands in. So the host is exact and the mask is the
    // box rule's guarantee plus that room.
    if (exact > 0) addRoom(exact);
    for (let r = 0; r < best.rooms.length; r++) {
      const k = r * 6;
      const holdsOrigin = !(ox < x[k] - pad || oy < x[k + 1] - pad || oz < x[k + 2] - pad || ox > x[k + 3] + pad || oy > x[k + 4] + pad || oz > x[k + 5] + pad);
      // The sphere against the grown box: the distance from its middle to the box.
      const dx = Math.max(x[k] - pad - sx, 0, sx - x[k + 3] - pad);
      const dy = Math.max(x[k + 1] - pad - sy, 0, sy - x[k + 4] - pad);
      const dz = Math.max(x[k + 2] - pad - sz, 0, sz - x[k + 5] - pad);
      if (!holdsOrigin && dx * dx + dy * dy + dz * dz > radius * radius) continue;
      addRoom(best.rooms[r]);
    }
    // Standing in a doorway: its sphere, grown by the pad, reaches one of the exits' triangles.
    const reach = radius + this.tune.doorwayPad;
    const t = best.exitTris;
    for (let i = 0; i < t.length; i += 9) {
      if (triDistSq(t, i, sx, sy, sz) <= reach * reach) {
        out.flags |= HOST_FLAG.doorway;
        break;
      }
    }
  }
}

/** Whether a room mask holds room `cell` (1 to 63), or everything past it when the object was flagged `anyRoom`. */
export function maskHas(lo: number, hi: number, cell: number): boolean {
  if (cell <= 0) return false;
  if (cell < 32) return ((lo >>> cell) & 1) === 1;
  if (cell < 64) return ((hi >>> (cell - 32)) & 1) === 1;
  return false;
}

/**
 * Whether any room a mask names is seen in a building's visible set (1 seen, per room). `anyRoom` takes
 * any seen room of the building. Nothing allocated; the mask's set bits are walked.
 */
export function maskSeen(lo: number, hi: number, any: boolean, seen: ArrayLike<number>): boolean {
  const n = seen.length;
  if (any) {
    for (let c = 1; c < n; c++) if (seen[c] === 1) return true;
    return false;
  }
  let m = lo >>> 0;
  while (m !== 0) {
    const c = 31 - Math.clz32(m);
    if (c < n && seen[c] === 1) return true;
    m = (m & ~(1 << c)) >>> 0;
  }
  m = hi >>> 0;
  while (m !== 0) {
    const b = 31 - Math.clz32(m);
    const c = b + 32;
    if (c < n && seen[c] === 1) return true;
    m = (m & ~(1 << b)) >>> 0;
  }
  return false;
}

/** The squared distance from a point to a triangle whose corners are nine numbers at `t[i]`: Ericson's closest point. */
function triDistSq(t: ArrayLike<number>, i: number, px: number, py: number, pz: number): number {
  const ax = t[i];
  const ay = t[i + 1];
  const az = t[i + 2];
  const bx = t[i + 3];
  const by = t[i + 4];
  const bz = t[i + 5];
  const cx = t[i + 6];
  const cy = t[i + 7];
  const cz = t[i + 8];
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
  const bpx = px - bx;
  const bpy = py - by;
  const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const qx = apx - v * abx;
    const qy = apy - v * aby;
    const qz = apz - v * abz;
    return qx * qx + qy * qy + qz * qz;
  }
  const cpx = px - cx;
  const cpy = py - cy;
  const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const qx = apx - w * acx;
    const qy = apy - w * acy;
    const qz = apz - w * acz;
    return qx * qx + qy * qy + qz * qz;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const qx = bpx - w * (cx - bx);
    const qy = bpy - w * (cy - by);
    const qz = bpz - w * (cz - bz);
    return qx * qx + qy * qy + qz * qz;
  }
  const sum = va + vb + vc;
  if (!(Math.abs(sum) > 0)) return Math.min(apx * apx + apy * apy + apz * apz, bpx * bpx + bpy * bpy + bpz * bpz, cpx * cpx + cpy * cpy + cpz * cpz);
  const v = vb / sum;
  const w = vc / sum;
  const qx = apx - abx * v - acx * w;
  const qy = apy - aby * v - acy * w;
  const qz = apz - abz * v - acz * w;
  return qx * qx + qy * qy + qz * qz;
}

/** Every object's host, rooms and flags, over a whole list, and what they came to. */
export interface FurnitureHosts {
  /** Per object, the index of its host building in the same list, or -1 (every object that is not contained is -1). */
  host: Int32Array;
  /** Per object, its candidate rooms: two words, rooms 1 to 31 then 32 to 63. */
  rooms: Uint32Array;
  /** Per object, `HOST_FLAG` bits. */
  flags: Uint8Array;
  /** The index the buildings went into, kept for anything placed later. */
  index: FurnitureIndex;
  /** `exact`: hosted by the snapshot's own building and room (step 7) rather than by the rooms' boxes. */
  stats: { contained: number; hosted: number; noBox: number; twoHosts: number; doorway: number; hosts: number; exact: number };
}

/**
 * Host every contained object of a list: the buildings among the list's own objects that can host are
 * indexed, then each contained object is assigned. `defOf` answers a model's manifest entry.
 */
export function furnitureHosts(objects: readonly HostObject[], defOf: (id: string) => HostDef | undefined, tune: FurnitureTune = FURNITURE_TUNE): FurnitureHosts {
  const index = new FurnitureIndex(tune);
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o.contained) continue;
    index.add(i, o, defOf(o.model));
  }
  const n = objects.length;
  const host = new Int32Array(n).fill(-1);
  const rooms = new Uint32Array(n * 2);
  const flags = new Uint8Array(n);
  const answer: HostAnswer = { host: -1, lo: 0, hi: 0, flags: 0 };
  const stats = { contained: 0, hosted: 0, noBox: 0, twoHosts: 0, doorway: 0, hosts: 0, exact: 0 };
  const used = new Set<number>();
  for (let i = 0; i < n; i++) {
    const o = objects[i];
    if (!o.contained) continue;
    const def = defOf(o.model);
    if (def?.particle) continue;
    stats.contained++;
    // The snapshot's own word where the pack carries it (step 7), the rooms' boxes where it does not.
    const h = o.hostIndex;
    if (tune.exactRooms && typeof h === 'number' && h >= 0 && h < n && typeof o.cell === 'number' && o.cell > 0 && index.has(h)) {
      index.assignTo(h, o.cell, o, def, answer);
      stats.exact++;
    } else index.assign(o, def, answer);
    if (answer.host < 0) {
      stats.noBox++;
      continue;
    }
    host[i] = answer.host;
    rooms[i * 2] = answer.lo;
    rooms[i * 2 + 1] = answer.hi;
    flags[i] = answer.flags;
    stats.hosted++;
    used.add(answer.host);
    if (answer.flags & HOST_FLAG.twoHosts) stats.twoHosts++;
    if (answer.flags & HOST_FLAG.doorway) stats.doorway++;
  }
  stats.hosts = used.size;
  return { host, rooms, flags, index, stats };
}
