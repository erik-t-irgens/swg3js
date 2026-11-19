// Climbing II, phase 3: what a bar is (the owner's "a pole for swinging - swinging between perpendicular poles across a chasm
// like tomb raider", 2026-11-16). A still collider that is long, level and thin: its cross-section under `climb.barThin` over a
// length of at least `climb.barLength`, its long axis within `BAR_LEVEL` of level. Read off the collider's own shape: a box (the
// course's bars), a cylinder or a capsule along its own axis, a round box or cylinder the same, and a mesh or a convex hull (a
// placed row's model) by the box round its own vertices in its own frame (a bar modelled along one of its model's axes; one
// modelled on a slant is not found). And a bar has room under it for a hanging body (`roomUnderBar`, the one test of it, asked
// where the hands would hold it): the grab's (src/player/barSwing.ts's `roomFor`) and the ledges' (src/player/ledge.ts's `cast`,
// whose rays pass a bar while `climb.bars` is 'on' and only a bar: a thin rod with no room under it, a rail along a wall's top or
// a rod at chest height over the ground, is whatever the ledges make of it, as under 'off').
//
// Each collider's own frame's facts are worked out once (the first time it is asked of) and kept by the collider itself in a
// weak map, so a frame asks a map and a few numbers; where it stands and how it is turned are read afresh each time, into kept
// records (nothing is made on a frame but the engine's own first answer for a collider it has not met).
//
// Pure of the page and of the engine: it names the collider's methods, the shape's fields and the world's one shape test
// (rapier's), handed in, and nothing else, so node runs it with the real engine.
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { BAR_FACTS } from '../anim/barClips.ts';

/** How far from level a bar's long axis may lie, degrees (a mechanic of the bar's definition: a rail on a slant is no bar). */
export const BAR_LEVEL = 10;
const LEVEL_SIN = Math.sin((BAR_LEVEL * Math.PI) / 180);
/** The hands' half span on the bar, metres on the human male (the clip's own, about 0.5 wide): how near its ends the hands may go. */
export const BAR_HALF_SPAN = 0.3;

/** rapier's shape types (its `ShapeType`, held to the engine's own by climbBars.test.ts). */
export const SHAPE_CUBOID = 1;
export const SHAPE_CAPSULE = 2;
export const SHAPE_TRIMESH = 6;
export const SHAPE_CONVEX = 9;
export const SHAPE_CYLINDER = 10;
export const SHAPE_ROUND_CUBOID = 12;
export const SHAPE_ROUND_CYLINDER = 14;
export const SHAPE_ROUND_CONVEX = 16;

/** The little of a collider a bar is read off (rapier's `Collider`). */
export interface BarCollider {
  readonly shape: { readonly type: number; halfExtents?: { x: number; y: number; z: number }; halfHeight?: number; radius?: number; borderRadius?: number; vertices?: ArrayLike<number> };
  translation(target?: { x: number; y: number; z: number }): { x: number; y: number; z: number };
  rotation(target?: { x: number; y: number; z: number; w: number }): { x: number; y: number; z: number; w: number };
}

/** A collider's own frame's facts: whether its shape could be a bar, which of its own axes is long, its long half and its cross-section. */
class LocalBar {
  /** 0: no (a ball, a heightfield, a slab), 1: a box along `axis`, 2: along its own y (a cylinder or capsule). */
  kind = 0;
  axis = 0;
  /** Half its length along the long axis, metres. */
  half = 0.5;
  /** Its cross-section across, metres (the larger of the other two full sizes, or the diameter). */
  thick = 0.5;
  /** Where the box round its vertices stands in its own frame (a mesh's: its middle; nought for every other). */
  cx = 0.5;
  cy = 0.5;
  cz = 0.5;
  constructor() {
    this.half = 0;
    this.thick = 0;
    this.cx = 0;
    this.cy = 0;
    this.cz = 0;
  }
}

const LOCAL = new WeakMap<object, LocalBar>();

/** A box's facts: the largest half its long axis, the other two its cross-section. */
function boxFacts(L: LocalBar, hx: number, hy: number, hz: number): void {
  if (hx >= hy && hx >= hz) {
    L.axis = 0;
    L.half = hx;
    L.thick = 2 * Math.max(hy, hz);
  } else if (hy >= hz) {
    L.axis = 1;
    L.half = hy;
    L.thick = 2 * Math.max(hx, hz);
  } else {
    L.axis = 2;
    L.half = hz;
    L.thick = 2 * Math.max(hx, hy);
  }
  L.kind = 1;
}

/** The collider's own frame's facts, worked out the first time and kept. */
function localOf(c: BarCollider): LocalBar {
  let L = LOCAL.get(c);
  if (L) return L;
  L = new LocalBar();
  const s = c.shape;
  const t = s.type;
  if ((t === SHAPE_CUBOID || t === SHAPE_ROUND_CUBOID) && s.halfExtents) {
    const b = t === SHAPE_ROUND_CUBOID ? (s.borderRadius ?? 0) : 0;
    boxFacts(L, s.halfExtents.x + b, s.halfExtents.y + b, s.halfExtents.z + b);
  } else if ((t === SHAPE_CYLINDER || t === SHAPE_ROUND_CYLINDER || t === SHAPE_CAPSULE) && s.halfHeight !== undefined && s.radius !== undefined) {
    const b = t === SHAPE_ROUND_CYLINDER ? (s.borderRadius ?? 0) : 0;
    L.kind = 2;
    L.axis = 1;
    L.half = s.halfHeight + b + (t === SHAPE_CAPSULE ? s.radius : 0);
    L.thick = 2 * (s.radius + b);
  } else if ((t === SHAPE_TRIMESH || t === SHAPE_CONVEX || t === SHAPE_ROUND_CONVEX) && s.vertices && s.vertices.length >= 6) {
    const v = s.vertices;
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i + 2 < v.length; i += 3) {
      if (v[i] < x0) x0 = v[i];
      if (v[i] > x1) x1 = v[i];
      if (v[i + 1] < y0) y0 = v[i + 1];
      if (v[i + 1] > y1) y1 = v[i + 1];
      if (v[i + 2] < z0) z0 = v[i + 2];
      if (v[i + 2] > z1) z1 = v[i + 2];
    }
    const b = t === SHAPE_ROUND_CONVEX ? (s.borderRadius ?? 0) : 0;
    boxFacts(L, (x1 - x0) / 2 + b, (y1 - y0) / 2 + b, (z1 - z0) / 2 + b);
    L.cx = (x0 + x1) / 2;
    L.cy = (y0 + y1) / 2;
    L.cz = (z0 + z1) / 2;
  }
  LOCAL.set(c, L);
  return L;
}

/** A bar's axis in the world: from `a` along the unit `u` for `len` metres, `thick` across; and the collider it is. */
export class BarAxis {
  ax = 0.5;
  ay = 0.5;
  az = 0.5;
  ux = 0.5;
  uy = 0.5;
  uz = 0.5;
  len = 0.5;
  thick = 0.5;
  col: BarCollider | null = null;
  constructor() {
    this.ax = 0;
    this.ay = 0;
    this.az = 0;
    this.ux = 1;
    this.uy = 0;
    this.uz = 0;
    this.len = 0;
    this.thick = 0;
  }
  copy(o: BarAxis): this {
    this.ax = o.ax;
    this.ay = o.ay;
    this.az = o.az;
    this.ux = o.ux;
    this.uy = o.uy;
    this.uz = o.uz;
    this.len = o.len;
    this.thick = o.thick;
    this.col = o.col;
    return this;
  }
}

const TR = { x: 0, y: 0, z: 0 };
const ROT = { x: 0, y: 0, z: 0, w: 1 };

/** Whether `c`'s shape is bar-shaped by the tune's numbers: long and thin (its level is asked where it stands, `barAxisOf`). */
function barShaped(L: LocalBar): boolean {
  return L.kind !== 0 && L.thick <= CLIMB_TUNE.barThin && 2 * L.half >= CLIMB_TUNE.barLength;
}

/**
 * Whether the collider is a bar where it stands, and if so its axis in the world into `out`. Nothing made (the collider's own
 * facts kept from their first asking; its place and turn read into kept records).
 */
export function barAxisOf(c: BarCollider, out: BarAxis): boolean {
  const L = localOf(c);
  if (!barShaped(L)) return false;
  c.rotation(ROT);
  // The long axis's unit in the world: the collider's own axis turned by its turn (t = 2 q.xyz x v; v' = v + w t + q.xyz x t).
  const vx = L.axis === 0 ? 1 : 0;
  const vy = L.axis === 1 ? 1 : 0;
  const vz = L.axis === 2 ? 1 : 0;
  const qx = ROT.x;
  const qy = ROT.y;
  const qz = ROT.z;
  const qw = ROT.w;
  let tx = 2 * (qy * vz - qz * vy);
  let ty = 2 * (qz * vx - qx * vz);
  let tz = 2 * (qx * vy - qy * vx);
  let ux = vx + qw * tx + (qy * tz - qz * ty);
  let uy = vy + qw * ty + (qz * tx - qx * tz);
  let uz = vz + qw * tz + (qx * ty - qy * tx);
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  if (Math.abs(uy) > LEVEL_SIN) return false;
  // Its middle: the collider's place, and a mesh's box's own middle turned with it.
  c.translation(TR);
  let mx = TR.x;
  let my = TR.y;
  let mz = TR.z;
  if (L.cx !== 0 || L.cy !== 0 || L.cz !== 0) {
    tx = 2 * (qy * L.cz - qz * L.cy);
    ty = 2 * (qz * L.cx - qx * L.cz);
    tz = 2 * (qx * L.cy - qy * L.cx);
    mx += L.cx + qw * tx + (qy * tz - qz * ty);
    my += L.cy + qw * ty + (qz * tx - qx * tz);
    mz += L.cz + qw * tz + (qx * ty - qy * tx);
  }
  out.ax = mx - ux * L.half;
  out.ay = my - uy * L.half;
  out.az = mz - uz * L.half;
  out.ux = ux;
  out.uy = uy;
  out.uz = uz;
  out.len = 2 * L.half;
  out.thick = L.thick;
  out.col = c;
  return true;
}

const SCRATCH = new BarAxis();

/** Whether the collider is bar-shaped where it stands (long, level and thin; whether it has room under it is `roomUnderBar`'s). */
export function isBarCollider(c: BarCollider): boolean {
  return barAxisOf(c, SCRATCH);
}

// ---- Climbing II, phase 5: what a pole is -------------------------------------------------------------------------------------

/** How far from upright a pole's long axis may lean, degrees (a mechanic of the pole's definition, as `BAR_LEVEL` is the bar's: a post on a slant is no pole). */
export const POLE_UPRIGHT = 10;
const UPRIGHT_COS = Math.cos((POLE_UPRIGHT * Math.PI) / 180);

/**
 * Climbing II, phase 5: whether the collider is a pole where it stands (src/player/poleClimb.ts): the bar's own facts of its shape
 * (`localOf`: a box, a cylinder or a capsule, a mesh's box), long and thin by `climb.poleThin` and `climb.poleLength`, its long
 * axis within `POLE_UPRIGHT` of upright; and if so its axis in the world into `out`, from its foot (`a`) up the unit `u` for `len`
 * metres, `thick` across. Nothing made (the collider's own facts kept from their first asking).
 */
export function poleAxisOf(c: BarCollider, out: BarAxis): boolean {
  const L = localOf(c);
  if (L.kind === 0 || L.thick > CLIMB_TUNE.poleThin || 2 * L.half < CLIMB_TUNE.poleLength) return false;
  c.rotation(ROT);
  const vx = L.axis === 0 ? 1 : 0;
  const vy = L.axis === 1 ? 1 : 0;
  const vz = L.axis === 2 ? 1 : 0;
  const qx = ROT.x;
  const qy = ROT.y;
  const qz = ROT.z;
  const qw = ROT.w;
  let tx = 2 * (qy * vz - qz * vy);
  let ty = 2 * (qz * vx - qx * vz);
  let tz = 2 * (qx * vy - qy * vx);
  let ux = vx + qw * tx + (qy * tz - qz * ty);
  let uy = vy + qw * ty + (qz * tx - qx * tz);
  let uz = vz + qw * tz + (qx * ty - qy * tx);
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  // (Up the pole, whichever way its own axis runs.)
  if (uy < 0) {
    ux = -ux;
    uy = -uy;
    uz = -uz;
  }
  if (uy < UPRIGHT_COS) return false;
  c.translation(TR);
  let mx = TR.x;
  let my = TR.y;
  let mz = TR.z;
  if (L.cx !== 0 || L.cy !== 0 || L.cz !== 0) {
    tx = 2 * (qy * L.cz - qz * L.cy);
    ty = 2 * (qz * L.cx - qx * L.cz);
    tz = 2 * (qx * L.cy - qy * L.cx);
    mx += L.cx + qw * tx + (qy * tz - qz * ty);
    my += L.cy + qw * ty + (qz * tx - qx * tz);
    mz += L.cz + qw * tz + (qx * ty - qy * tx);
  }
  out.ax = mx - ux * L.half;
  out.ay = my - uy * L.half;
  out.az = mz - uz * L.half;
  out.ux = ux;
  out.uy = uy;
  out.uz = uz;
  out.len = 2 * L.half;
  out.thick = L.thick;
  out.col = c;
  return true;
}

/** Phase 5: whether the collider is a pole where it stands (`poleAxisOf`, its axis thrown away): what the wall climb passes while `climb.poles` is 'on'. */
export function isPoleCollider(c: BarCollider): boolean {
  return poleAxisOf(c, SCRATCH);
}

/** The little of a physics world a bar's room is asked of (rapier's `World`: one shape test, the bar itself left out). */
export interface BarRoomWorld {
  intersectionWithShape(shapePos: { x: number; y: number; z: number }, shapeRot: { x: number; y: number; z: number; w: number }, shape: never, filterFlags?: number, filterGroups?: number, filterExcludeCollider?: never): unknown;
}

/**
 * `roomUnderBar`'s and `barGripNear`'s ask (fields, so no number crosses a call): the point the grip is sought nearest, the grip's
 * place along the bar, the figure's scale, the query's flags and groups.
 */
export class BarRoomAsk {
  px = 0.5;
  py = 0.5;
  pz = 0.5;
  s = 0.5;
  scale = 0.5;
  flags = 0;
  filter = 0;
  constructor() {
    this.px = 0;
    this.py = 0;
    this.pz = 0;
    this.s = 0;
    this.scale = 1;
  }
}

const ROOM_AT = { x: 0, y: 0, z: 0 };
const ROOM_ROT = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Whether a body hanging from the bar `B` with its hands at `ask.s` along it has room under it: the hanging body's capsule
 * (`cap`, the standing capsule) with its middle the clip's own radius (`BAR_FACTS.radius`, scaled) straight under the axis there,
 * clear of everything still but the bar itself (one shape test). The grab's room straight down (`BarSwing.roomFor`) and the
 * ledges' word on whether a bar-shaped collider their ray met is a bar at all (src/player/ledge.ts's `cast`) are this one test.
 */
export function roomUnderBar(world: BarRoomWorld, B: BarAxis, ask: BarRoomAsk, cap: unknown): boolean {
  const s = ask.s;
  ROOM_AT.x = B.ax + B.ux * s;
  ROOM_AT.y = B.ay + B.uy * s - BAR_FACTS.radius * ask.scale;
  ROOM_AT.z = B.az + B.uz * s;
  return world.intersectionWithShape(ROOM_AT, ROOM_ROT, cap as never, ask.flags, ask.filter, B.col as never) === null;
}

/**
 * The grip on bar `B` nearest the ask's point (`px`, `py`, `pz`), held the hands' half span (`BAR_HALF_SPAN`, scaled) in from
 * its ends, into `ask.s`; false where the bar is too short for both hands (the grab's own rule, `BarSwing.consider`).
 */
export function barGripNear(B: BarAxis, ask: BarRoomAsk): boolean {
  const m = BAR_HALF_SPAN * ask.scale;
  if (B.len < 2 * m) return false;
  let s = (ask.px - B.ax) * B.ux + (ask.py - B.ay) * B.uy + (ask.pz - B.az) * B.uz;
  if (s < m) s = m;
  if (s > B.len - m) s = B.len - m;
  ask.s = s;
  return true;
}
