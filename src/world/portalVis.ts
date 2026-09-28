// Which rooms of a portal building can be seen this frame, and whether the world can be seen from
// inside one: a flood through the portals on screen rectangles, worked out once a frame before any
// pass is drawn (`PortalRenderer.computeVisibility`), and what the portal renderer draws less of.
//
// The camera's own room is given the whole screen. Every portal of a room that has been reached is put
// into the world with its building's matrix, clipped against the near plane, projected, and its screen
// rectangle intersected with the room's own; what is left is the rectangle the room beyond is seen
// through. A room is flooded again only when its rectangle grows. Reaching cell 0 from inside means the
// world is seen, through the union of those rectangles (`exitRect`). From outside, the same flood starts
// in cell 0 with the whole screen and enters a building only through the doors the renderer would draw.
//
// It is conservative on purpose, and every guard is on the side of drawing more:
//   - the projected polygons are used and never their planes (Mustafar's torn bridge portal stands 3.8 m
//     off its own plane), and no side-of-portal test is made;
//   - every rectangle is padded by `padPx`;
//   - a camera within `near + doorwayNear` of a portal (standing in a doorway) hands the room beyond its
//     own whole rectangle, whatever the portal projects to;
//   - a camera outside its own room's box (padded `boxPad`) marks every room seen and the world seen,
//     which is the old behaviour for that frame;
//   - every other room whose own box holds the camera starts the flood with the whole screen too, since
//     room boxes overlap and a room entered by a teleport is picked by its box, not by a doorway crossed;
//   - a flood that needs more than `maxVisits` room visits does the same.
//
// Pure apart from three's math, so a node test can run it over the real packs' buildings. Nothing in a
// frame allocates: each building keeps a record in a WeakMap, sized once, and each model's topology is
// worked out once.
import * as THREE from 'three';
import type { Portal } from './assetPack.ts';

/** How the renderer culls with the set. `mode: 'all'` is the old behaviour whole; each other switch is one commit's change. */
export interface PortalCullTune {
  /** Work the set out at all (the report reads it); off, nothing below applies. */
  on: boolean;
  /** 'all' draws everything as before; 'rooms' lets the switches below cut. */
  mode: 'all' | 'rooms';
  /** Every projected rectangle is grown by this many drawing-buffer pixels. Ours. */
  padPx: number;
  /** Room visits one building's flood may make before it gives up and marks everything seen. Ours. */
  maxVisits: number;
  /** A camera this much past the near plane from a portal is standing in it. Ours. */
  doorwayNear: number;
  /** How far outside its own room's box the camera may be before the whole building is taken as seen. Ours. */
  boxPad: number;
  /** An exit seen through a rectangle narrower or shorter than this, in pixels, does not count. 0 counts every one. Ours. */
  minExitPx: number;
  /** A door is drawn from this far at least (the old fixed range). */
  rangeBase: number;
  /**
   * ...or from this many times its radius when that is farther, so only a big door (one whose farthest corner
   * is over 14 m from its middle, at 8.5) reaches past the old range. Ours: 8.5 draws the Theed hangar's
   * 58.6 m door from about 300 m. Measured: growing every door's range as well (120 m plus 5 m a metre)
   * pulled a third building into the Mos Eisley street's passes and cost 13 ms there until the bodies
   * stop being drawn in every building's pass (step 2).
   */
  rangePerRadius: number;
  /** ...but never farther than this. Ours. */
  rangeMax: number;
  /** Inside, with no exit reachable: no world pass, no shadow pass, no weather (commit 1b). */
  insideSkip: boolean;
  /** Only the rooms the flood reached are drawn, inside and through doors from outside (commit 1c). */
  seenRooms: boolean;
  /** Inside, the world pass skips the ground, far tiles and placed objects outside the exits' rectangle (commit 1d). */
  exitNarrow: boolean;
  /** A door's range grows with its size, so a big door is seen into from farther away (commit 1c). */
  doorRange: boolean;
}

export const PORTAL_CULL: PortalCullTune = {
  on: true,
  mode: 'rooms',
  padPx: 2,
  maxVisits: 64,
  doorwayNear: 0.5,
  boxPad: 1,
  minExitPx: 0,
  rangeBase: 120,
  rangePerRadius: 8.5,
  rangeMax: 320,
  insideSkip: true,
  seenRooms: true,
  exitNarrow: true,
  doorRange: true,
};

/** The fixed door range the renderer used before a door's range grew with its size. */
export const PORTAL_RANGE = 120;
/**
 * How much farther out than its widest door is drawn from a building's rooms are built: the old 160 m
 * against the old 120 m, kept for a door whose range grew. The sweep that builds rooms runs only every
 * 8 m the player walks and measures from the player rather than the camera, and a room's programs are
 * compiled on the walk to the door, so a door must come into range well after its rooms exist, never
 * with nothing behind it.
 */
export const INTERIOR_LEAD = 40;
/** How many buildings near the camera get a pass of their own through their doors. */
export const MAX_BUILDINGS = 6;
/** Doorways count as reaching this far above their polygon when deciding which side the camera is on. */
export const DOOR_HEADROOM = 4;

/** Whether the cut this switch names is on: the set is worked out, the mode lets it cut, and the switch is on. */
export function cullOn(sw: 'insideSkip' | 'seenRooms' | 'exitNarrow' | 'doorRange', tune: PortalCullTune = PORTAL_CULL): boolean {
  return tune.on && tune.mode === 'rooms' && tune[sw];
}

/**
 * The door range, the one formula every door test shares (the flood's, the renderer's building list and
 * its doors, the streamer's rooms): the old fixed range while the switch is off, else `rangePerRadius`
 * times the doorway's radius, never under `rangeBase` nor over `rangeMax`. It reads the radius from
 * `src[i]` and writes the range to `out[j]`, so no number crosses the call on the paths that run for
 * every door of every building every frame (a number handed to or back from a call that is not inlined
 * is boxed).
 */
export function doorRangeAt(src: Float64Array, i: number, tune: PortalCullTune, out: Float64Array, j: number): void {
  if (!cullOn('doorRange', tune)) {
    out[j] = PORTAL_RANGE;
    return;
  }
  const grown = tune.rangePerRadius * src[i];
  out[j] = grown < tune.rangeBase ? tune.rangeBase : grown > tune.rangeMax ? tune.rangeMax : grown;
}

/** Scratch for `doorRangeOf`: the radius in, the range out. */
const rangeIo = new Float64Array(2);

/** How far from its middle a doorway of this radius is drawn from (`doorRangeAt`, for the paths that are not per frame). */
export function doorRangeOf(radius: number, tune: PortalCullTune = PORTAL_CULL): number {
  rangeIo[0] = radius;
  doorRangeAt(rangeIo, 0, tune, rangeIo, 1);
  return rangeIo[1];
}

/** The parts of a placed portal building the set needs; `Building` is one. */
export interface VisCell {
  index: number;
  bounds: { min: readonly number[]; max: readonly number[] };
}
export interface VisBuilding {
  model: { portals: readonly Portal[]; def: { id?: string; cells?: readonly VisCell[] } };
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
  x: number;
  z: number;
  radius: number;
}

/** One model's rooms and portals, worked out once and shared by every copy of it. */
interface Topo {
  ncell: number;
  nportal: number;
  /** Per cell, its (portal, room beyond) pairs: `adjPortal[adjStart[c] .. adjStart[c + 1])`. Both ways round, deduplicated. */
  adjStart: Int32Array;
  adjPortal: Int32Array;
  adjTarget: Int32Array;
  /** Per portal, whether it joins a room to the world (cell 0). */
  exit: Uint8Array;
  /** Per portal, its vertices `vStart[k] .. vStart[k + 1]` and triangles `triStart[k] .. triStart[k + 1]` (indices local to the portal). */
  vStart: Int32Array;
  triStart: Int32Array;
  tri: Int32Array;
  maxVerts: number;
  /** Per cell, its box in model space (min then max, sorted per axis since some packs store the corners swapped); `hasBox` 0 where none. */
  box: Float64Array;
  hasBox: Uint8Array;
  /** The widest exit's radius in model space, so a building's reach is known without its world record. */
  maxExitRadius: number;
  /** The same, in a typed array, for `doorRangeAt` on the per-frame building list. */
  maxR: Float64Array;
}

/** One placed building's record: its portals in the world, and the flood's working arrays and answers. */
interface Rec {
  topo: Topo;
  /** Where the world copy was made from, so a moved building is made again. */
  mx: number;
  my: number;
  mz: number;
  /** Portal vertices in the world. */
  wv: Float64Array;
  /** Per portal: its middle (x, y, z) and radius in the world. */
  pc: Float64Array;
  seen: Uint8Array;
  rect: Float64Array;
  has: Uint8Array;
  inQ: Uint8Array;
  stack: Int32Array;
  /** Scratch for the rooms besides the camera's own that start a flood (their boxes hold the camera). */
  starts: Int32Array;
  pr: Float64Array;
  prStamp: Int32Array;
  prOk: Uint8Array;
  nearStamp: Int32Array;
  nearOk: Uint8Array;
  doorOk: Uint8Array;
  /** The frame (`PortalVisibility.stamp`) this record was last flooded in. */
  stamp: number;
  visits: number;
  worldSeen: boolean;
  exitRect: Float64Array;
  anySeen: boolean;
  rooms: number;
  /** '' when the flood ran whole; otherwise why everything was taken as seen. */
  fallback: '' | 'box' | 'visits';
}

/** What the set says about this frame, kept and refilled. */
export interface VisResult {
  /** Worked out this frame. */
  valid: boolean;
  /** The building the camera is in, or null outside. */
  inside: VisBuilding | null;
  /** The camera's room in it (0 outside). */
  cell: number;
  /** Inside: whether an exit the renderer would draw is reached. Outside: always true. */
  worldSeen: boolean;
  /** Inside: the union of the reached exits' rectangles, in normalised device coordinates (minX, minY, maxX, maxY); the whole screen outside. */
  exitRect: Float64Array;
  /**
   * The buildings with at least one room seen (inside, the camera's own): the first `drawnCount` of
   * these. Written by index and never shortened, since emptying an array frees its store and the next
   * write makes a new one; what lies past the count is cleared to null.
   */
  drawn: (VisBuilding | null)[];
  drawnCount: number;
  /** Room visits made this frame over every building flooded. */
  visits: number;
  /** '' when every flood ran whole; else the reason the last one to give up gave. */
  fallback: '' | 'box' | 'visits';
}

const topos = new WeakMap<object, Topo>();

/** A model's topology: built on first sight and kept (a model is shared by every copy of it). */
export function topoOf(model: VisBuilding['model']): Topo {
  let t = topos.get(model);
  if (t) return t;
  const portals = model.portals;
  const cells = model.def.cells ?? [];
  let ncell = 1;
  for (const c of cells) ncell = Math.max(ncell, c.index + 1);
  for (const p of portals) for (const l of p.links) ncell = Math.max(ncell, l.from + 1, l.to + 1);
  // Both ways round: a cell that lists a portal the room beyond does not list back still opens onto it.
  const pairs: Set<string>[] = Array.from({ length: ncell }, () => new Set<string>());
  const exit = new Uint8Array(portals.length);
  portals.forEach((p, k) => {
    for (const l of p.links) {
      if (l.from < 0 || l.to < 0) continue;
      if (l.from === 0 || l.to === 0) exit[k] = 1;
      if (l.from === l.to) continue;
      pairs[l.from].add(`${k}:${l.to}`);
      pairs[l.to].add(`${k}:${l.from}`);
    }
  });
  const adjStart = new Int32Array(ncell + 1);
  let total = 0;
  for (let c = 0; c < ncell; c++) {
    adjStart[c] = total;
    total += pairs[c].size;
  }
  adjStart[ncell] = total;
  const adjPortal = new Int32Array(total);
  const adjTarget = new Int32Array(total);
  for (let c = 0, a = 0; c < ncell; c++) {
    for (const s of pairs[c]) {
      const [k, to] = s.split(':').map(Number);
      adjPortal[a] = k;
      adjTarget[a] = to;
      a++;
    }
  }
  const vStart = new Int32Array(portals.length + 1);
  const triStart = new Int32Array(portals.length + 1);
  let nv = 0;
  let nt = 0;
  let maxVerts = 0;
  for (let k = 0; k < portals.length; k++) {
    vStart[k] = nv;
    triStart[k] = nt;
    nv += portals[k].verts.length;
    maxVerts = Math.max(maxVerts, portals[k].verts.length);
    nt += Math.floor(portals[k].indices.length / 3) * 3;
  }
  vStart[portals.length] = nv;
  triStart[portals.length] = nt;
  const tri = new Int32Array(nt);
  let maxExitRadius = 0;
  for (let k = 0; k < portals.length; k++) {
    const p = portals[k];
    const n = Math.floor(p.indices.length / 3) * 3;
    for (let i = 0; i < n; i++) {
      const v = p.indices[i];
      tri[triStart[k] + i] = v >= 0 && v < p.verts.length ? v : 0;
    }
    if (exit[k] && p.verts.length) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const v of p.verts) {
        cx += v.x;
        cy += v.y;
        cz += v.z;
      }
      cx /= p.verts.length;
      cy /= p.verts.length;
      cz /= p.verts.length;
      for (const v of p.verts) maxExitRadius = Math.max(maxExitRadius, Math.hypot(v.x - cx, v.y - cy, v.z - cz));
    }
  }
  const box = new Float64Array(ncell * 6);
  const hasBox = new Uint8Array(ncell);
  for (const c of cells) {
    if (c.index < 0 || c.index >= ncell || !c.bounds) continue;
    const { min, max } = c.bounds;
    if (min.length < 3 || max.length < 3) continue;
    for (let a = 0; a < 3; a++) {
      box[c.index * 6 + a] = Math.min(min[a], max[a]);
      box[c.index * 6 + 3 + a] = Math.max(min[a], max[a]);
    }
    hasBox[c.index] = 1;
  }
  t = { ncell, nportal: portals.length, adjStart, adjPortal, adjTarget, exit, vStart, triStart, tri, maxVerts, box, hasBox, maxExitRadius, maxR: new Float64Array([maxExitRadius]) };
  topos.set(model, t);
  return t;
}

/**
 * How far from its edge a building's rooms must be built for its widest door: that door's range plus
 * `INTERIOR_LEAD`, or nothing while the door range is the old fixed one (the streamer's own 160 m, which
 * is that range plus the lead, then stands). The streamer builds a building's rooms this far out, so a
 * big door drawn from farther away has rooms behind it, compiled, by the time it can be drawn.
 */
export function interiorReachOf(b: VisBuilding, tune: PortalCullTune = PORTAL_CULL): number {
  if (!cullOn('doorRange', tune) || !b.model.portals.length) return 0;
  return doorRangeOf(topoOf(b.model).maxExitRadius, tune) + INTERIOR_LEAD;
}

/**
 * How far from its edge the streamer builds a building's rooms: the old fixed door range plus the lead
 * (160 m), or its widest door's range plus the lead when that is farther (`interiorReachOf`).
 */
export function interiorBuildRange(b: VisBuilding, tune: PortalCullTune = PORTAL_CULL): number {
  return Math.max(PORTAL_RANGE + INTERIOR_LEAD, interiorReachOf(b, tune));
}

/**
 * Whether a point is within a squared reach of a triangle: Ericson's closest point on a triangle, all in
 * scalars. The corners are read out of `wv` at offsets `ia`, `ib` and `ic`, and the point and the squared
 * reach out of `q` (x, y, z, r2), and it answers a boolean: no number crosses the call, so nothing is boxed.
 */
function triWithin(wv: Float64Array, ia: number, ib: number, ic: number, q: Float64Array): boolean {
  const px = q[0];
  const py = q[1];
  const pz = q[2];
  const r2 = q[3];
  const ax = wv[ia];
  const ay = wv[ia + 1];
  const az = wv[ia + 2];
  const bx = wv[ib];
  const by = wv[ib + 1];
  const bz = wv[ib + 2];
  const cx = wv[ic];
  const cy = wv[ic + 1];
  const cz = wv[ic + 2];
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
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz <= r2;
  const bpx = px - bx;
  const bpy = py - by;
  const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz <= r2;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const qx = apx - v * abx;
    const qy = apy - v * aby;
    const qz = apz - v * abz;
    return qx * qx + qy * qy + qz * qz <= r2;
  }
  const cpx = px - cx;
  const cpy = py - cy;
  const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz <= r2;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const qx = apx - w * acx;
    const qy = apy - w * acy;
    const qz = apz - w * acz;
    return qx * qx + qy * qy + qz * qz <= r2;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const qx = bpx - w * (cx - bx);
    const qy = bpy - w * (cy - by);
    const qz = bpz - w * (cz - bz);
    return qx * qx + qy * qy + qz * qz <= r2;
  }
  const sum = va + vb + vc;
  if (!(Math.abs(sum) > 0)) return Math.min(apx * apx + apy * apy + apz * apz, bpx * bpx + bpy * bpy + bpz * bpz, cpx * cpx + cpy * cpy + cpz * cpz) <= r2;
  const v = vb / sum;
  const w = vc / sum;
  const qx = apx - abx * v - acx * w;
  const qy = apy - aby * v - acy * w;
  const qz = apz - abz * v - acz * w;
  return qx * qx + qy * qy + qz * qz <= r2;
}

const tmpLocal = new THREE.Vector3();

export class PortalVisibility {
  readonly result: VisResult = { valid: false, inside: null, cell: 0, worldSeen: true, exitRect: new Float64Array([-1, -1, 1, 1]), drawn: [], drawnCount: 0, visits: 0, fallback: '' };
  private readonly recs = new WeakMap<VisBuilding, Rec>();
  /** Bumped once per `compute`, so a record's cached rectangles and answers are known to be this frame's. */
  private stamp = 0;
  private readonly pv = new Float64Array(16);
  /**
   * This frame's camera, in one typed array rather than fields and handed to nothing as a number: a
   * number passed to or handed back from a call that is not inlined is boxed, and this runs every frame.
   * The eye (x, y, z), the near plane, the padding across and up in device coordinates, and the
   * drawing buffer's width and height.
   */
  private readonly cam = new Float64Array(8);
  /** Scratch for a doorway test: the eye and the squared reach. */
  private readonly q = new Float64Array(4);
  /** Scratch for `doorRangeAt`'s answer. */
  private readonly range = new Float64Array(1);
  /** Scratch for the renderer's door test: its camera's place, as `cam` holds the flood's. */
  private readonly eye = new Float64Array(3);
  /** What `withinReach` measured: the horizontal distance to the building's middle. */
  readonly measured = new Float64Array(1);
  /** Clip-space scratch for one portal's vertices: x, y, w and the near-plane distance (z + w). */
  private clip = new Float64Array(64);
  readonly tune: PortalCullTune;

  constructor(tune: PortalCullTune = PORTAL_CULL) {
    this.tune = tune;
  }

  /** A building's record, made the first time it is asked for. Allocates only then. */
  recOf(b: VisBuilding): Rec {
    let r = this.recs.get(b);
    const e = b.matrix.elements;
    if (r && r.mx === e[12] && r.my === e[13] && r.mz === e[14]) return r;
    const topo = topoOf(b.model);
    const n = topo.ncell;
    const np = topo.nportal;
    if (!r) {
      r = {
        topo,
        mx: 0,
        my: 0,
        mz: 0,
        wv: new Float64Array(topo.vStart[np] * 3),
        pc: new Float64Array(np * 4),
        seen: new Uint8Array(n),
        rect: new Float64Array(n * 4),
        has: new Uint8Array(n),
        inQ: new Uint8Array(n),
        stack: new Int32Array(n),
        starts: new Int32Array(n),
        pr: new Float64Array(np * 4),
        prStamp: new Int32Array(np),
        prOk: new Uint8Array(np),
        nearStamp: new Int32Array(np),
        nearOk: new Uint8Array(np),
        doorOk: new Uint8Array(np),
        stamp: -1,
        visits: 0,
        worldSeen: false,
        exitRect: new Float64Array(4),
        anySeen: false,
        rooms: 0,
        fallback: '',
      };
      this.recs.set(b, r);
    }
    r.mx = e[12];
    r.my = e[13];
    r.mz = e[14];
    r.prStamp.fill(-1);
    r.nearStamp.fill(-1);
    const portals = b.model.portals;
    for (let k = 0; k < np; k++) {
      const p = portals[k];
      const v0 = topo.vStart[k];
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = 0; i < p.verts.length; i++) {
        tmpLocal.copy(p.verts[i]).applyMatrix4(b.matrix);
        const o = (v0 + i) * 3;
        r.wv[o] = tmpLocal.x;
        r.wv[o + 1] = tmpLocal.y;
        r.wv[o + 2] = tmpLocal.z;
        cx += tmpLocal.x;
        cy += tmpLocal.y;
        cz += tmpLocal.z;
      }
      const nv = Math.max(1, p.verts.length);
      cx /= nv;
      cy /= nv;
      cz /= nv;
      let rad = 0;
      for (let i = 0; i < p.verts.length; i++) {
        const o = (v0 + i) * 3;
        rad = Math.max(rad, Math.hypot(r.wv[o] - cx, r.wv[o + 1] - cy, r.wv[o + 2] - cz));
      }
      r.pc[k * 4] = cx;
      r.pc[k * 4 + 1] = cy;
      r.pc[k * 4 + 2] = cz;
      r.pc[k * 4 + 3] = rad;
    }
    if (this.clip.length < topo.maxVerts * 4) this.clip = new Float64Array(topo.maxVerts * 4);
    return r;
  }

  /**
   * Whether the camera stands within a building's radius and its widest door's range of its middle,
   * across the ground: the renderer's building list. `box` measures each axis apart (the old quick
   * reject), otherwise the distance, which is left in `measured[0]` for the list's order. A boolean,
   * so nothing is boxed on the way back.
   */
  withinReach(b: VisBuilding, cam: THREE.Vector3, box: boolean): boolean {
    doorRangeAt(topoOf(b.model).maxR, 0, this.tune, this.range, 0);
    const reach = b.radius + this.range[0];
    const dx = b.x - cam.x;
    const dz = b.z - cam.z;
    if (box) return Math.abs(dx) <= reach && Math.abs(dz) <= reach;
    const d = Math.sqrt(dx * dx + dz * dz);
    this.measured[0] = d;
    return d < reach;
  }

  /**
   * Whether an exit's middle is within its door range of the camera: the renderer's own door test, and
   * the very test the flood makes of every exit (`doorReaches`), so the renderer never stencils a door
   * the flood did not go through.
   */
  doorInRange(b: VisBuilding, k: number, cam: THREE.Vector3): boolean {
    const r = this.recOf(b);
    const e = this.eye;
    e[0] = cam.x;
    e[1] = cam.y;
    e[2] = cam.z;
    return this.doorReaches(r, k, e);
  }

  /** Whether portal `k`'s middle is within its door range of the point `at[0..2]`: the one door test. */
  private doorReaches(r: Rec, k: number, at: Float64Array): boolean {
    const o = k * 4;
    const pc = r.pc;
    doorRangeAt(pc, o + 3, this.tune, this.range, 0);
    const range = this.range[0];
    const dx = pc[o] - at[0];
    const dy = pc[o + 1] - at[1];
    const dz = pc[o + 2] - at[2];
    return dx * dx + dy * dy + dz * dz <= range * range;
  }

  /** Which of the building's portals this frame's flood took as doors in range (1), or null when it was not flooded this frame. */
  doorsOf(b: VisBuilding): Uint8Array | null {
    const r = this.recs.get(b);
    return r && r.stamp === this.stamp && this.result.valid ? r.doorOk : null;
  }

  /** A portal's middle and radius in the world, for the renderer's own door test. */
  portalSphere(b: VisBuilding, k: number, out: THREE.Sphere): THREE.Sphere {
    const r = this.recOf(b);
    out.center.set(r.pc[k * 4], r.pc[k * 4 + 1], r.pc[k * 4 + 2]);
    out.radius = r.pc[k * 4 + 3];
    return out;
  }

  /** Whether this portal joins a room to the world. */
  isExit(b: VisBuilding, k: number): boolean {
    return topoOf(b.model).exit[k] === 1;
  }

  /** The building's rooms as this frame saw them (0 unseen, 1 seen, 2 one room beyond a seen one), or null when it was not flooded this frame. */
  seenOf(b: VisBuilding): Uint8Array | null {
    const r = this.recs.get(b);
    return r && r.stamp === this.stamp && this.result.valid ? r.seen : null;
  }

  /** Whether any room of the building was seen this frame; true when it was not flooded (nothing is known, so nothing is cut). */
  anySeen(b: VisBuilding): boolean {
    const r = this.recs.get(b);
    return !r || r.stamp !== this.stamp || !this.result.valid || r.anySeen;
  }

  /** What one building's flood made of this frame, for the console. */
  describe(b: VisBuilding): { seen: number[]; beyond: number[]; visits: number; fallback: string; worldSeen: boolean; rooms: number; cells: number } | null {
    const r = this.recs.get(b);
    if (!r || r.stamp !== this.stamp) return null;
    const seen: number[] = [];
    const beyond: number[] = [];
    for (let c = 1; c < r.topo.ncell; c++) {
      if (r.seen[c] === 1) seen.push(c);
      else if (r.seen[c] === 2) beyond.push(c);
    }
    return { seen, beyond, visits: r.visits, fallback: r.fallback, worldSeen: r.worldSeen, rooms: r.rooms, cells: r.topo.ncell - 1 };
  }

  /** A seen room's rectangle this frame, in normalised device coordinates; false when it was not seen. */
  rectOf(b: VisBuilding, cell: number, out: Float64Array): boolean {
    const r = this.recs.get(b);
    if (!r || r.stamp !== this.stamp || cell < 0 || cell >= r.topo.ncell || !r.has[cell]) return false;
    for (let i = 0; i < 4; i++) out[i] = r.rect[cell * 4 + i];
    return true;
  }

  /** Nothing is known this frame (the set is off): every reader then cuts nothing. */
  invalidate(): void {
    this.stamp++;
    this.result.valid = false;
  }

  /**
   * Work the set out for this frame. `inside` is the building the camera is in and `cell` its room, or
   * null; `outside` holds the `count` buildings the renderer will draw through their doors from outside
   * (ignored inside). `width` and `height` are the drawing buffer's, for the padding.
   */
  compute(camera: THREE.Camera & { near?: number }, inside: VisBuilding | null, cell: number, outside: readonly VisBuilding[], count: number, width: number, height: number): VisResult {
    const res = this.result;
    this.stamp++;
    const tune = this.tune;
    const e = this.pv;
    const p = camera.projectionMatrix.elements;
    const v = camera.matrixWorldInverse.elements;
    // projView = projection * view, column-major, written out so nothing is made.
    for (let c = 0; c < 4; c++) {
      const v0 = v[c * 4];
      const v1 = v[c * 4 + 1];
      const v2 = v[c * 4 + 2];
      const v3 = v[c * 4 + 3];
      for (let rI = 0; rI < 4; rI++) e[c * 4 + rI] = p[rI] * v0 + p[4 + rI] * v1 + p[8 + rI] * v2 + p[12 + rI] * v3;
    }
    const w = camera.matrixWorld.elements;
    const cam = this.cam;
    cam[0] = w[12];
    cam[1] = w[13];
    cam[2] = w[14];
    cam[3] = typeof camera.near === 'number' && camera.near > 0 ? camera.near : 0.05;
    cam[6] = width > 1 ? width : 1;
    cam[7] = height > 1 ? height : 1;
    cam[4] = (tune.padPx * 2) / cam[6];
    cam[5] = (tune.padPx * 2) / cam[7];
    res.valid = true;
    res.inside = inside;
    res.cell = inside ? cell : 0;
    res.visits = 0;
    res.fallback = '';
    res.drawnCount = 0;
    const er = res.exitRect;
    if (inside) {
      const r = this.recOf(inside);
      this.markDoors(r);
      const t = r.topo;
      // The camera out of its own room's box: its room is wrong, so nothing is known and everything is drawn.
      tmpLocal.set(cam[0], cam[1], cam[2]).applyMatrix4(inside.inverse);
      const pad = tune.boxPad;
      const b = cell * 6;
      const inBox =
        cell > 0 &&
        cell < t.ncell &&
        t.hasBox[cell] === 1 &&
        tmpLocal.x >= t.box[b] - pad &&
        tmpLocal.y >= t.box[b + 1] - pad &&
        tmpLocal.z >= t.box[b + 2] - pad &&
        tmpLocal.x <= t.box[b + 3] + pad &&
        tmpLocal.y <= t.box[b + 4] + pad &&
        tmpLocal.z <= t.box[b + 5] + pad;
      if (!inBox) this.everything(r, 'box', false);
      else {
        // Room boxes overlap (a doorway's two rooms, an alcove cut into a hall), and a room walked
        // into by a teleport is chosen by its box: every other room whose own box holds the camera
        // starts the flood with the whole screen as well, so a camera standing in the room its state
        // did not name never looks at a room that was not drawn.
        let ns = 0;
        const x = tmpLocal.x;
        const y = tmpLocal.y;
        const z = tmpLocal.z;
        for (let c = 1; c < t.ncell; c++) {
          const o = c * 6;
          if (c === cell || !t.hasBox[c] || x < t.box[o] || y < t.box[o + 1] || z < t.box[o + 2] || x > t.box[o + 3] || y > t.box[o + 4] || z > t.box[o + 5]) continue;
          r.starts[ns++] = c;
        }
        this.flood(r, cell, false, ns);
      }
      res.visits += r.visits;
      if (r.fallback) res.fallback = r.fallback;
      res.worldSeen = r.worldSeen;
      for (let i = 0; i < 4; i++) er[i] = r.exitRect[i];
      res.drawn[0] = inside;
      res.drawnCount = 1;
      this.clearDrawn();
      return res;
    }
    res.worldSeen = true;
    er[0] = -1;
    er[1] = -1;
    er[2] = 1;
    er[3] = 1;
    for (let i = 0; i < count; i++) {
      const b = outside[i];
      const r = this.recOf(b);
      this.markDoors(r);
      this.flood(r, 0, true, 0);
      res.visits += r.visits;
      if (r.fallback) res.fallback = r.fallback;
      if (r.anySeen) res.drawn[res.drawnCount++] = b;
    }
    this.clearDrawn();
    return res;
  }

  /** Past the count, nothing is held: a building let go of by the world is not kept alive here. */
  private clearDrawn(): void {
    const d = this.result.drawn;
    for (let i = this.result.drawnCount; i < d.length; i++) d[i] = null;
  }

  /** Which exits are within the range the renderer draws a door from, this frame (`doorReaches`, the renderer's own test). */
  private markDoors(r: Rec): void {
    const t = r.topo;
    for (let k = 0; k < t.nportal; k++) r.doorOk[k] = t.exit[k] === 1 && this.doorReaches(r, k, this.cam) ? 1 : 0;
  }

  /** Nothing can be cut: every room seen, and from inside the world as well through the whole screen. */
  private everything(r: Rec, why: 'box' | 'visits', outside: boolean): void {
    const t = r.topo;
    r.stamp = this.stamp;
    r.fallback = why;
    r.seen.fill(1);
    r.has.fill(1);
    for (let c = 0; c < t.ncell; c++) {
      r.rect[c * 4] = -1;
      r.rect[c * 4 + 1] = -1;
      r.rect[c * 4 + 2] = 1;
      r.rect[c * 4 + 3] = 1;
    }
    r.anySeen = t.ncell > 1;
    r.rooms = t.ncell - 1;
    r.worldSeen = true;
    r.exitRect[0] = -1;
    r.exitRect[1] = -1;
    r.exitRect[2] = 1;
    r.exitRect[3] = 1;
    if (!outside) {
      // From inside the world is taken as seen only through a door the renderer would draw at all.
      let any = false;
      for (let k = 0; k < t.nportal; k++) if (r.doorOk[k]) any = true;
      r.worldSeen = any;
    }
  }

  /** The flood from one room with the whole screen, and from the first `extra` of `r.starts` with it too. */
  private flood(r: Rec, start: number, outside: boolean, extra: number): void {
    const t = r.topo;
    const tune = this.tune;
    r.stamp = this.stamp;
    r.fallback = '';
    r.visits = 0;
    r.worldSeen = false;
    r.anySeen = false;
    r.rooms = 0;
    r.seen.fill(0);
    r.has.fill(0);
    r.inQ.fill(0);
    const ex = r.exitRect;
    ex[0] = Infinity;
    ex[1] = Infinity;
    ex[2] = -Infinity;
    ex[3] = -Infinity;
    const rect = r.rect;
    rect[start * 4] = -1;
    rect[start * 4 + 1] = -1;
    rect[start * 4 + 2] = 1;
    rect[start * 4 + 3] = 1;
    r.has[start] = 1;
    r.inQ[start] = 1;
    r.stack[0] = start;
    let sp = 1;
    for (let i = 0; i < extra; i++) {
      const s = r.starts[i];
      if (r.has[s]) continue;
      rect[s * 4] = -1;
      rect[s * 4 + 1] = -1;
      rect[s * 4 + 2] = 1;
      rect[s * 4 + 3] = 1;
      r.has[s] = 1;
      r.inQ[s] = 1;
      r.stack[sp++] = s;
    }
    const minW = (tune.minExitPx * 2) / this.cam[6];
    const minH = (tune.minExitPx * 2) / this.cam[7];
    while (sp > 0) {
      const c = r.stack[--sp];
      r.inQ[c] = 0;
      if (++r.visits > tune.maxVisits) {
        this.everything(r, 'visits', outside);
        r.visits = tune.maxVisits;
        return;
      }
      const c4 = c * 4;
      const px0 = rect[c4];
      const py0 = rect[c4 + 1];
      const px1 = rect[c4 + 2];
      const py1 = rect[c4 + 3];
      for (let a = t.adjStart[c]; a < t.adjStart[c + 1]; a++) {
        const k = t.adjPortal[a];
        const to = t.adjTarget[a];
        // From outside the world is the start and already has the whole screen; a room seen back out is nothing new.
        if (outside && to === 0) continue;
        // From outside only the doors the renderer draws lead in; from inside only those lead out.
        if ((outside && c === 0) || (!outside && to === 0)) {
          if (!r.doorOk[k]) continue;
        }
        let x0: number;
        let y0: number;
        let x1: number;
        let y1: number;
        if (this.inDoorway(r, k)) {
          x0 = px0;
          y0 = py0;
          x1 = px1;
          y1 = py1;
        } else {
          if (!this.portalRect(r, k)) continue;
          const k4 = k * 4;
          x0 = Math.max(px0, r.pr[k4]);
          y0 = Math.max(py0, r.pr[k4 + 1]);
          x1 = Math.min(px1, r.pr[k4 + 2]);
          y1 = Math.min(py1, r.pr[k4 + 3]);
          if (x0 > x1 || y0 > y1) continue;
        }
        if (to === 0) {
          if (x1 - x0 < minW || y1 - y0 < minH) continue;
          r.worldSeen = true;
          if (x0 < ex[0]) ex[0] = x0;
          if (y0 < ex[1]) ex[1] = y0;
          if (x1 > ex[2]) ex[2] = x1;
          if (y1 > ex[3]) ex[3] = y1;
          continue;
        }
        const t4 = to * 4;
        if (!r.has[to]) {
          r.has[to] = 1;
          rect[t4] = x0;
          rect[t4 + 1] = y0;
          rect[t4 + 2] = x1;
          rect[t4 + 3] = y1;
        } else {
          // Flooded again only when the rectangle it is seen through grows.
          if (x0 >= rect[t4] && y0 >= rect[t4 + 1] && x1 <= rect[t4 + 2] && y1 <= rect[t4 + 3]) continue;
          if (x0 < rect[t4]) rect[t4] = x0;
          if (y0 < rect[t4 + 1]) rect[t4 + 1] = y0;
          if (x1 > rect[t4 + 2]) rect[t4 + 2] = x1;
          if (y1 > rect[t4 + 3]) rect[t4 + 3] = y1;
        }
        if (!r.inQ[to]) {
          r.inQ[to] = 1;
          r.stack[sp++] = to;
        }
      }
    }
    if (outside) r.worldSeen = true;
    if (!r.worldSeen) {
      ex[0] = 0;
      ex[1] = 0;
      ex[2] = 0;
      ex[3] = 0;
    }
    for (let c = 0; c < t.ncell; c++) r.seen[c] = r.has[c];
    if (!outside) r.seen[0] = r.worldSeen ? 1 : 0;
    for (let c = 1; c < t.ncell; c++) {
      if (r.seen[c] !== 1) continue;
      r.anySeen = true;
      r.rooms++;
      for (let a = t.adjStart[c]; a < t.adjStart[c + 1]; a++) {
        const to = t.adjTarget[a];
        if (to > 0 && r.seen[to] === 0) r.seen[to] = 2;
      }
    }
  }

  /**
   * The portal's screen rectangle this frame, padded, into `r.pr`; false when nothing of it is in front
   * of the near plane. Every vertex in front counts, and so does every triangle edge's crossing of the
   * near plane, which is the whole of the triangles' clipped outline.
   */
  private portalRect(r: Rec, k: number): boolean {
    if (r.prStamp[k] === this.stamp) return r.prOk[k] === 1;
    r.prStamp[k] = this.stamp;
    const t = r.topo;
    const e = this.pv;
    const clip = this.clip;
    const v0 = t.vStart[k];
    const nv = t.vStart[k + 1] - v0;
    for (let i = 0; i < nv; i++) {
      const o = (v0 + i) * 3;
      const x = r.wv[o];
      const y = r.wv[o + 1];
      const z = r.wv[o + 2];
      const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const cz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
      clip[i * 4] = cx;
      clip[i * 4 + 1] = cy;
      clip[i * 4 + 2] = cw;
      clip[i * 4 + 3] = cz + cw;
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < nv; i++) {
      if (!(clip[i * 4 + 3] > 0) || !(clip[i * 4 + 2] > 0)) continue;
      const iw = 1 / clip[i * 4 + 2];
      const x = clip[i * 4] * iw;
      const y = clip[i * 4 + 1] * iw;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    for (let q = t.triStart[k]; q < t.triStart[k + 1]; q += 3) {
      for (let s = 0; s < 3; s++) {
        const a = t.tri[q + s];
        const b = t.tri[q + (s === 2 ? 0 : s + 1)];
        const da = clip[a * 4 + 3];
        const db = clip[b * 4 + 3];
        if ((da > 0) === (db > 0)) continue;
        const f = da / (da - db);
        const pw = clip[a * 4 + 2] + f * (clip[b * 4 + 2] - clip[a * 4 + 2]);
        if (!(pw > 1e-9)) continue;
        const x = (clip[a * 4] + f * (clip[b * 4] - clip[a * 4])) / pw;
        const y = (clip[a * 4 + 1] + f * (clip[b * 4 + 1] - clip[a * 4 + 1])) / pw;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    if (!(x0 <= x1) || !(y0 <= y1)) {
      r.prOk[k] = 0;
      return false;
    }
    const k4 = k * 4;
    r.pr[k4] = x0 - this.cam[4];
    r.pr[k4 + 1] = y0 - this.cam[5];
    r.pr[k4 + 2] = x1 + this.cam[4];
    r.pr[k4 + 3] = y1 + this.cam[5];
    r.prOk[k] = 1;
    return true;
  }

  /** Whether the camera stands within `near + doorwayNear` of the portal's polygon: in the doorway. */
  private inDoorway(r: Rec, k: number): boolean {
    if (r.nearStamp[k] === this.stamp) return r.nearOk[k] === 1;
    r.nearStamp[k] = this.stamp;
    r.nearOk[k] = 0;
    const reach = this.cam[3] + this.tune.doorwayNear;
    const o = k * 4;
    const px = this.cam[0];
    const py = this.cam[1];
    const pz = this.cam[2];
    const dx = r.pc[o] - px;
    const dy = r.pc[o + 1] - py;
    const dz = r.pc[o + 2] - pz;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) - r.pc[o + 3] > reach) return false;
    const t = r.topo;
    const v0 = t.vStart[k];
    const wv = r.wv;
    const q = this.q;
    q[0] = px;
    q[1] = py;
    q[2] = pz;
    q[3] = reach * reach;
    for (let i = t.triStart[k]; i < t.triStart[k + 1]; i += 3) {
      if (triWithin(wv, (v0 + t.tri[i]) * 3, (v0 + t.tri[i + 1]) * 3, (v0 + t.tri[i + 2]) * 3, q)) {
        r.nearOk[k] = 1;
        return true;
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// The camera's room.

/**
 * Parameter along a-b where the segment crosses one of the portal's triangles, or null. With
 * `headroom`, a crossing up to that far above the polygon still counts (the doorway is taken to
 * continue upward).
 */
export function crossing(portal: Portal, a: THREE.Vector3, b: THREE.Vector3, headroom = 0): number | null {
  return crosses(portal, a, b, headroom) ? CROSSED.t : null;
}

/** Where the last true `crosses` crossed, along its segment. */
const CROSSED = { t: 0 };

/**
 * `crossing` answering a boolean and leaving the parameter in `CROSSED.t`: a number handed back from a
 * call is boxed wherever the call is not inlined, and the camera's walk asks it of every portal every frame.
 */
function crosses(portal: Portal, a: THREE.Vector3, b: THREE.Vector3, headroom: number): boolean {
  const n = portal.normal;
  const da = n.x * a.x + n.y * a.y + n.z * a.z - portal.d;
  const db = n.x * b.x + n.y * b.y + n.z * b.z - portal.d;
  if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) return false;
  const t = da / (da - db);
  const hit = tmpHit.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  const idx = portal.indices;
  const v = portal.verts;
  if (headroom > 0) {
    let top = -Infinity;
    for (let i = 0; i < v.length; i++) if (v[i].y > top) top = v[i].y;
    if (hit.y > top && hit.y < top + headroom) hit.y = top - 1e-3;
  }
  for (let k = 0; k + 2 < idx.length; k += 3) {
    if (pointInTriangle(hit, v[idx[k]], v[idx[k + 1]], v[idx[k + 2]])) {
      CROSSED.t = t;
      return true;
    }
  }
  return false;
}

const tmpHit = new THREE.Vector3();
const e0 = new THREE.Vector3();
const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();

function pointInTriangle(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): boolean {
  e0.subVectors(c, a);
  e1.subVectors(b, a);
  e2.subVectors(p, a);
  const dot00 = e0.dot(e0);
  const dot01 = e0.dot(e1);
  const dot02 = e0.dot(e2);
  const dot11 = e1.dot(e1);
  const dot12 = e1.dot(e2);
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-12) return false;
  const inv = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const w = (dot00 * dot12 - dot01 * dot02) * inv;
  return u >= -1e-4 && w >= -1e-4 && u + w <= 1 + 1e-4;
}

/** The camera's building and room, kept and refilled. */
export interface CameraCell<B extends VisBuilding = VisBuilding> {
  building: B | null;
  cell: number;
}

const walkFrom = new THREE.Vector3();
const walkA = new THREE.Vector3();
const walkB = new THREE.Vector3();

/**
 * The building and room the camera is in: starting from the player's own room, walk the line from the
 * eye to the camera through whichever portals it crosses. An exit is taken, as it always was, to reach
 * `DOOR_HEADROOM` above its polygon, since a camera above the lintel got there through the door, and
 * is crossed from any room of its building; a portal between two rooms is crossed only from the room
 * the walk is in. Which building comes out is exactly what the walk over exits alone gave before rooms
 * were followed: a room's own crossing changes the room, never the building, and the exits are tried
 * after it as they always were. `near` is scratch for the buildings round the camera, written by index
 * and never shortened (emptying an array frees its store), and left holding nothing.
 */
export function walkCameraCell<B extends VisBuilding>(playerBuilding: B | null, playerCell: number, eye: THREE.Vector3, cam: THREE.Vector3, buildings: Iterable<B>, out: CameraCell<B>, near: (B | null)[]): CameraCell<B> {
  let inside: B | null = playerBuilding;
  let cell = inside ? playerCell : 0;
  let nn = 0;
  for (const b of buildings) if (Math.abs(b.x - cam.x) < b.radius + 30 && Math.abs(b.z - cam.z) < b.radius + 30) near[nn++] = b;
  walkFrom.copy(eye);
  let exits = 0;
  for (let hop = 0; hop < 16 && exits < 4; hop++) {
    let bestT = Infinity;
    let bestB: B | null = null;
    let bestCell = 0;
    const n = inside ? 1 : nn;
    for (let i = 0; i < n; i++) {
      const b = inside ?? (near[i] as B);
      walkA.copy(walkFrom).applyMatrix4(b.inverse);
      walkB.copy(cam).applyMatrix4(b.inverse);
      const portals = b.model.portals;
      for (let k = 0; k < portals.length; k++) {
        const p = portals[k];
        let exitTo = -1;
        let roomTo = -1;
        const links = p.links;
        for (let j = 0; j < links.length; j++) {
          const l = links[j];
          if (l.from === 0 && l.to > 0) exitTo = l.to;
          else if (l.to === 0 && l.from > 0) exitTo = l.from;
          else if (inside && l.from === cell && l.to > 0) roomTo = l.to;
          else if (inside && l.to === cell && l.from > 0) roomTo = l.from;
        }
        if (exitTo >= 0) {
          if (crosses(p, walkA, walkB, DOOR_HEADROOM) && CROSSED.t < bestT) {
            bestT = CROSSED.t;
            bestB = b;
            // Out of the building from inside, into its room behind the door from outside.
            bestCell = inside ? 0 : exitTo;
          }
        } else if (roomTo > 0) {
          if (crosses(p, walkA, walkB, 0) && CROSSED.t < bestT) {
            bestT = CROSSED.t;
            bestB = b;
            bestCell = roomTo;
          }
        }
      }
    }
    if (!bestB) break;
    if (bestCell === 0) {
      inside = null;
      cell = 0;
      exits++;
    } else {
      if (!inside) exits++;
      inside = bestB;
      cell = bestCell;
    }
    const f = bestT + 1e-3 < 1 ? bestT + 1e-3 : 1;
    walkFrom.set(walkFrom.x + (cam.x - walkFrom.x) * f, walkFrom.y + (cam.y - walkFrom.y) * f, walkFrom.z + (cam.z - walkFrom.z) * f);
  }
  for (let i = 0; i < nn; i++) near[i] = null;
  out.building = inside;
  out.cell = inside ? cell : 0;
  return out;
}

// ---------------------------------------------------------------------------------------------
// The exit narrowing's roots.

/** Something the world pass from inside may leave out when its sphere misses the exits' view: its sphere in the world. */
export interface NarrowRoot {
  exitCullSphere?: THREE.Sphere;
}

/** How many roots were offered for the narrowing and how many were refused because a light hangs under them. */
export const NARROW_STATS = { roots: 0, unhideable: 0 };

/**
 * Offer an object to the exit narrowing with its world sphere. A root with a light anywhere under it is
 * never offered: hiding a light changes the light count, and that recompiles every program in the world.
 */
export function markNarrowRoot(o: THREE.Object3D, sphere: THREE.Sphere): boolean {
  let light = false;
  o.traverse((x) => {
    if ((x as THREE.Light).isLight) light = true;
  });
  if (light) {
    NARROW_STATS.unhideable++;
    return false;
  }
  (o as THREE.Object3D & NarrowRoot).exitCullSphere = sphere;
  NARROW_STATS.roots++;
  return true;
}

/**
 * The frustum from the eye through a rectangle of the screen (normalised device coordinates: minX, minY,
 * maxX, maxY), for a camera whose projection times view is `projView`: clip space remapped so the
 * rectangle is the whole of it (x' = sx x + tx w, and the same for y), with the near and far planes left
 * as they were. False, and nothing written, when there is nothing to narrow: the rectangle is empty, or
 * it covers the whole screen.
 *
 * The product and its six planes are written out here rather than through `Matrix4.set` and
 * `Frustum.setFromProjectionMatrix`: neither is inlined whole at this depth, and the numbers handed to
 * the calls they make were boxed on every frame the world pass was narrowed (measured, 48 bytes a frame
 * through `set`, 320 through the planes). Only integers cross `framePlane`.
 */
export function exitFrustum(rect: ArrayLike<number>, projView: THREE.Matrix4, out: THREE.Frustum): boolean {
  const x0 = Math.max(-1, rect[0]);
  const y0 = Math.max(-1, rect[1]);
  const x1 = Math.min(1, rect[2]);
  const y1 = Math.min(1, rect[3]);
  if (!(x1 > x0 && y1 > y0)) return false;
  if (x0 <= -1 && y0 <= -1 && x1 >= 1 && y1 >= 1) return false;
  const sx = 2 / (x1 - x0);
  const tx = -(x1 + x0) / (x1 - x0);
  const sy = 2 / (y1 - y0);
  const ty = -(y1 + y0) / (y1 - y0);
  // Column by column (three stores a matrix column-major): rows 0 and 1 scaled and shifted by row 3.
  const p = projView.elements;
  const e = remapped;
  for (let c = 0; c < 16; c += 4) {
    const w = p[c + 3];
    e[c] = sx * p[c] + tx * w;
    e[c + 1] = sy * p[c + 1] + ty * w;
    e[c + 2] = p[c + 2];
    e[c + 3] = w;
  }
  // Three's own planes, in its own order: right, left, bottom, top, far, near (clip space from -1 to 1).
  const pl = out.planes;
  framePlane(pl[0], e, 0, -1);
  framePlane(pl[1], e, 0, 1);
  framePlane(pl[2], e, 1, 1);
  framePlane(pl[3], e, 1, -1);
  framePlane(pl[4], e, 2, -1);
  framePlane(pl[5], e, 2, 1);
  return true;
}

/** The remapped projection times view, column-major, refilled by every `exitFrustum`. */
const remapped = new Float64Array(16);

/** A frustum plane from a column-major matrix: row 3 plus `sign` times row `row`, normalised. */
function framePlane(plane: THREE.Plane, e: Float64Array, row: number, sign: number): void {
  const x = e[3] + sign * e[row];
  const y = e[7] + sign * e[4 + row];
  const z = e[11] + sign * e[8 + row];
  const w = e[15] + sign * e[12 + row];
  const inv = 1 / Math.sqrt(x * x + y * y + z * z);
  const n = plane.normal;
  n.x = x * inv;
  n.y = y * inv;
  n.z = z * inv;
  plane.constant = w * inv;
}

/**
 * The world pass from inside, narrowed to the exits (commit 1d): every root offered by `markNarrowRoot`
 * among the children of `parents` whose sphere misses the frustum through the exits' rectangle is hidden
 * for that one pass, and exactly those are put back after it. Only what is visible is ever hidden, so a
 * root somebody else holds hidden (a ground under a basement, a tier waiting for its programs) is never
 * touched and stays hidden. Kept arrays, written by index and never shortened.
 */
export class ExitNarrowing {
  /** The containers whose children may be hidden: the scene and the ground's root. */
  readonly parents: THREE.Object3D[] = [];
  /** What the last narrowing tested and left out. */
  readonly stats = { tested: 0, hidden: 0 };
  private readonly hidden: (THREE.Object3D | null)[] = [];
  private count = 0;
  private readonly frustum = new THREE.Frustum();

  /** How many roots are hidden right now (0 but between `hide` and `restore`). */
  get holding(): number {
    return this.count;
  }

  /** Hide what misses the exits' rectangle. Answers how many were hidden; `restore` must follow, in a `finally`. */
  hide(rect: ArrayLike<number>, projView: THREE.Matrix4): number {
    const st = this.stats;
    if (!exitFrustum(rect, projView, this.frustum)) return 0;
    const hidden = this.hidden;
    const parents = this.parents;
    let n = this.count;
    for (let p = 0; p < parents.length; p++) {
      const ch = parents[p].children;
      for (let i = 0; i < ch.length; i++) {
        const o = ch[i] as THREE.Object3D & NarrowRoot;
        const s = o.exitCullSphere;
        if (!s || !o.visible) continue;
        st.tested++;
        if (this.frustum.intersectsSphere(s)) continue;
        o.visible = false;
        hidden[n++] = o;
      }
    }
    st.hidden += n - this.count;
    this.count = n;
    return st.hidden;
  }

  /** Put back exactly what `hide` hid, and hold on to none of it. */
  restore(): void {
    const hidden = this.hidden;
    for (let i = 0; i < this.count; i++) {
      (hidden[i] as THREE.Object3D).visible = true;
      hidden[i] = null;
    }
    this.count = 0;
  }
}
