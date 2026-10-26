// The world editor's gizmo (DESIGN.md §2.6): handles drawn on the overlay canvas round what is selected, picked and dragged
// in screen space, never three's `TransformControls` (a program keyed on whichever pass draws it first, a layer in every
// pass, colours graded by the effects, and a pointer of its own).
//
// **There is no gizmo-mode key**: the held hand key says which handles show (`handlesFor`) -- the yaw ring while R is
// held, the pitch and roll rings with Shift+R, the vertical arrow with F, the scale boxes with C (one in the middle, and a
// box an axis on a prop) -- and with no key held the three move arrows and the ground square. A handle under the cursor
// (within `pick.hitPx`) is drawn `hot`; dragged with the left button, it moves along itself by **what keeps the grabbed
// point under the cursor**: an arrow by the point of its line nearest the cursor's ray, the ground square by where the
// ray meets the level plane through the pivot, a ring by the angle round the pivot on the screen, a scale box by how far
// from the pivot the cursor has gone. In Fly the cursor is the crosshair plus the mouse's travel since the press, the
// camera held still.
//
// Every handle is a fixed size on the screen (`gizmo.px`). Colours [ours]: X `bad`, Y `good`, Z `accent`, the handle
// under the cursor `hot`. **A frame makes nothing**: the layout is written into kept arrays (`GizmoLayout`), the cursor
// and the drag's answer are kept records, and every number a frame works out stays inside the function that works it
// out or rides in a kept record (a number handed across a call the compiler does not build in is boxed: the aim's
// lesson). `editorAllocOwn.ts gizmo` measures a frame of it.
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension,
// no enum, no namespace, no constructor parameter properties.

/** The handles there are. */
export const HANDLES = ['x', 'y', 'z', 'ground', 'up', 'yaw', 'pitch', 'roll', 'scale', 'sx', 'sy', 'sz'] as const;
export type HandleId = (typeof HANDLES)[number];
/** Each handle's index in the layout's arrays. */
export const H: { readonly [K in HandleId]: number } = { x: 0, y: 1, z: 2, ground: 3, up: 4, yaw: 5, pitch: 6, roll: 7, scale: 8, sx: 9, sy: 10, sz: 11 };
const COUNT = HANDLES.length;
/** Points a ring is drawn with. */
export const RING_POINTS = 32;

/** Which hold the hand keys make (`placeHold.ts`'s, and C's scale), or none: what decides which handles show. */
export type HeldKey = 'none' | 'turn' | 'tumble' | 'lift' | 'scale';

/**
 * Which handles show for the key held: none held, the three move arrows and the ground square; R, the yaw ring; Shift+R,
 * the pitch and roll rings; F, the vertical arrow; C, the scale box in the middle and, on a prop (`perAxis`), a box an
 * axis. Written into `out` (true where shown); nothing is made.
 */
export function handlesFor(key: HeldKey, perAxis: boolean, out: boolean[]): boolean[] {
  for (let i = 0; i < COUNT; i++) out[i] = false;
  if (key === 'none') out[H.x] = out[H.y] = out[H.z] = out[H.ground] = true;
  else if (key === 'turn') out[H.yaw] = true;
  else if (key === 'tumble') out[H.pitch] = out[H.roll] = true;
  else if (key === 'lift') out[H.up] = true;
  else {
    out[H.scale] = true;
    if (perAxis) out[H.sx] = out[H.sy] = out[H.sz] = true;
  }
  return out;
}

/** What the camera shows, as the gizmo needs it: a kept record the editor writes once a frame. */
export interface ScreenView {
  /** The camera's projection times its view, three's column-major sixteen. */
  vp: Float64Array;
  /** Its inverse. */
  inv: Float64Array;
  /** The screen, CSS pixels. */
  w: number;
  h: number;
  /** Where the eye is, and the way it looks (unit). */
  ex: number;
  ey: number;
  ez: number;
  fx: number;
  fy: number;
  fz: number;
  /** Pixels a metre covers one metre in front of the eye: half the screen's height over the tangent of half the field. */
  focal: number;
}

/** A view with nothing in it, its fields doubles from the start. */
export function screenView(): ScreenView {
  return { vp: new Float64Array(16), inv: new Float64Array(16), w: 0.5, h: 0.5, ex: 0.5, ey: 0.5, ez: 0.5, fx: 0.5, fy: 0.5, fz: 0.5, focal: 0.5 };
}

/** A point of the world to project, kept: what every projection of a frame is handed. */
const P = new Float64Array(3);

/** `P` projected to the screen, into `out[k]`, `out[k + 1]`; false behind the eye. Nothing is made. */
function projectP(v: ScreenView, out: Float64Array, k: number): boolean {
  const m = v.vp;
  const x = P[0];
  const y = P[1];
  const z = P[2];
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (!(cw > 1e-6)) return false;
  out[k] = (cx / cw * 0.5 + 0.5) * v.w;
  out[k + 1] = (0.5 - cy / cw * 0.5) * v.h;
  return true;
}

/** A point projected to the screen, into `out[k]`, `out[k + 1]`; false behind the eye (the plain form, for the tests and the console). */
export function projectInto(v: ScreenView, x: number, y: number, z: number, out: Float64Array, k: number): boolean {
  P[0] = x;
  P[1] = y;
  P[2] = z;
  return projectP(v, out, k);
}

/** A point of the screen, kept: the cursor, or Fly's crosshair plus the mouse since a press. */
export interface Cursor {
  x: number;
  y: number;
}

/** A cursor with nothing in it. */
export function cursor(): Cursor {
  return { x: 0.5, y: 0.5 };
}

/** A ray, kept: an origin and a unit direction. */
export interface Ray3 {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
}

/** A ray with nothing in it. */
export function ray3(): Ray3 {
  return { ox: 0.5, oy: 0.5, oz: 0.5, dx: 0.5, dy: 0.5, dz: 0.5 };
}

/** The ray from the eye through a point of the screen (`c`, CSS pixels), into `out`. Nothing is made. */
export function rayAt(v: ScreenView, c: Cursor, out: Ray3): Ray3 {
  const nx = (c.x / v.w) * 2 - 1;
  const ny = 1 - (c.y / v.h) * 2;
  const m = v.inv;
  // The far plane's point under the cursor, through the inverse.
  const x = m[0] * nx + m[4] * ny + m[8] + m[12];
  const y = m[1] * nx + m[5] * ny + m[9] + m[13];
  const z = m[2] * nx + m[6] * ny + m[10] + m[14];
  const w = m[3] * nx + m[7] * ny + m[11] + m[15];
  const px = x / w - v.ex;
  const py = y / w - v.ey;
  const pz = z / w - v.ez;
  const l = Math.sqrt(px * px + py * py + pz * pz) || 1;
  out.ox = v.ex;
  out.oy = v.ey;
  out.oz = v.ez;
  out.dx = px / l;
  out.dy = py / l;
  out.dz = pz / l;
  return out;
}

const PLAIN_CURSOR = cursor();

/** `rayAt` with the point as two numbers (the tests' and the console's). */
export function rayThrough(v: ScreenView, sx: number, sy: number, out: Ray3): Ray3 {
  PLAIN_CURSOR.x = sx;
  PLAIN_CURSOR.y = sy;
  return rayAt(v, PLAIN_CURSOR, out);
}

/** The gizmo's three axes in the world: the world's own, or the selection's first thing's own (local), each a unit vector. */
export interface GizmoAxes {
  ax: Float64Array;
}

/** Axes along the world's own three. */
export function worldAxes(): GizmoAxes {
  return { ax: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) };
}

/** The axes of a turn (three's order), into `a`: its own X, Y and Z in the world. Nothing is made. */
export function axesOfTurn(q: { x: number; y: number; z: number; w: number }, a: GizmoAxes): GizmoAxes {
  const x = q.x;
  const y = q.y;
  const z = q.z;
  const w = q.w;
  const e = a.ax;
  e[0] = 1 - 2 * (y * y + z * z);
  e[1] = 2 * (x * y + w * z);
  e[2] = 2 * (x * z - w * y);
  e[3] = 2 * (x * y - w * z);
  e[4] = 1 - 2 * (x * x + z * z);
  e[5] = 2 * (y * z + w * x);
  e[6] = 2 * (x * z + w * y);
  e[7] = 2 * (y * z - w * x);
  e[8] = 1 - 2 * (x * x + y * y);
  return a;
}

/** The gizmo laid out on the screen this frame, kept: every handle's points, written in place. */
export interface GizmoLayout {
  /** Whether it is drawn at all (a pivot in front of the eye). */
  on: boolean;
  /** The pivot on the screen. */
  px: number;
  py: number;
  /** How many metres the handles reach out from the pivot, at its distance. */
  reach: number;
  /** Which handles show this frame. */
  shown: boolean[];
  /** Each arrow's and box's screen end (x, y), by handle index; an arrow runs from the pivot to it. */
  ends: Float64Array;
  /** Whether each handle's end is in front of the eye. */
  inFront: boolean[];
  /** Each ring's points (x, y), `RING_POINTS` of them, one kept array a ring (yaw, pitch, roll). */
  rings: [Float64Array, Float64Array, Float64Array];
  /** The ground square's four corners on the screen. */
  square: Float64Array;
  /** The world direction each handle moves along or turns about, by handle index (x, y, z). */
  dirs: Float64Array;
  /** The handle under the cursor, or -1. */
  hot: number;
}

/** A layout with nothing in it. */
export function gizmoLayout(): GizmoLayout {
  return { on: false, px: 0.5, py: 0.5, reach: 0.5, shown: new Array(COUNT).fill(false), ends: new Float64Array(COUNT * 2), inFront: new Array(COUNT).fill(false), rings: [new Float64Array(2 * RING_POINTS), new Float64Array(2 * RING_POINTS), new Float64Array(2 * RING_POINTS)], square: new Float64Array(8), dirs: new Float64Array(COUNT * 3), hot: -1 };
}

/** Two unit vectors at right angles to a ring's axis, kept. */
const PERP = new Float64Array(6);

/**
 * The gizmo laid out for this frame, into `L`: the pivot projected, each handle shown (`handlesFor`'s answer, which the
 * caller wrote into `L.shown`) placed `px` pixels out along its direction at the pivot's distance (foreshortened as the
 * axis is), the rings `RING_POINTS` points of a circle of that reach, and the ground square a third of it. The move
 * arrows and the scale boxes take `axes` (the world's or the first thing's own); the vertical arrow and the yaw ring the
 * world's up; the pitch and roll rings the view's own level axes, as Shift+R tumbles about them. Nothing is made.
 */
export function layoutGizmo(v: ScreenView, pivot: { x: number; y: number; z: number }, axes: GizmoAxes, px: number, L: GizmoLayout): void {
  P[0] = pivot.x;
  P[1] = pivot.y;
  P[2] = pivot.z;
  L.on = projectP(v, L.ends, 0);
  if (!L.on) return;
  L.px = L.ends[0];
  L.py = L.ends[1];
  // How far ahead of the eye the pivot is, along the look: what turns pixels into metres there.
  const depth = (pivot.x - v.ex) * v.fx + (pivot.y - v.ey) * v.fy + (pivot.z - v.ez) * v.fz;
  if (!(depth > 1e-3) || !(v.focal > 0)) {
    L.on = false;
    return;
  }
  const reach = (px * depth) / v.focal;
  L.reach = reach;
  const a = axes.ax;
  const d = L.dirs;
  // Each handle's direction: the arrows' and the boxes' the axes', the vertical arrow's and the yaw ring's up, the pitch
  // and roll rings' the view's own level right and forward.
  for (let k = 0; k < 3; k++) {
    d[H.x * 3 + k] = a[k];
    d[H.y * 3 + k] = a[3 + k];
    d[H.z * 3 + k] = a[6 + k];
    d[H.sx * 3 + k] = a[k];
    d[H.sy * 3 + k] = a[3 + k];
    d[H.sz * 3 + k] = a[6 + k];
    d[H.up * 3 + k] = k === 1 ? 1 : 0;
    d[H.yaw * 3 + k] = k === 1 ? 1 : 0;
    d[H.ground * 3 + k] = k === 1 ? 1 : 0;
    d[H.scale * 3 + k] = 0;
  }
  const ll = Math.sqrt(v.fx * v.fx + v.fz * v.fz);
  const lfx = ll > 1e-6 ? v.fx / ll : 0;
  const lfz = ll > 1e-6 ? v.fz / ll : -1;
  d[H.pitch * 3] = -lfz;
  d[H.pitch * 3 + 1] = 0;
  d[H.pitch * 3 + 2] = lfx;
  d[H.roll * 3] = lfx;
  d[H.roll * 3 + 1] = 0;
  d[H.roll * 3 + 2] = lfz;
  for (let h = 0; h < COUNT; h++) {
    L.inFront[h] = false;
    if (!L.shown[h]) continue;
    if (h === H.yaw || h === H.pitch || h === H.roll) {
      L.inFront[h] = ringPoints(v, pivot, L, h, L.rings[h === H.yaw ? 0 : h === H.pitch ? 1 : 2]);
      continue;
    }
    if (h === H.scale) {
      L.ends[h * 2] = L.px;
      L.ends[h * 2 + 1] = L.py;
      L.inFront[h] = true;
      continue;
    }
    if (h === H.ground) {
      const s = reach * 0.3;
      const q = L.square;
      P[0] = pivot.x;
      P[1] = pivot.y;
      P[2] = pivot.z;
      let ok = projectP(v, q, 0);
      P[0] = pivot.x + a[0] * s;
      P[1] = pivot.y + a[1] * s;
      P[2] = pivot.z + a[2] * s;
      ok = projectP(v, q, 2) && ok;
      P[0] = pivot.x + (a[0] + a[6]) * s;
      P[1] = pivot.y + (a[1] + a[7]) * s;
      P[2] = pivot.z + (a[2] + a[8]) * s;
      ok = projectP(v, q, 4) && ok;
      P[0] = pivot.x + a[6] * s;
      P[1] = pivot.y + a[7] * s;
      P[2] = pivot.z + a[8] * s;
      L.inFront[h] = projectP(v, q, 6) && ok;
      continue;
    }
    const k = h * 3;
    P[0] = pivot.x + d[k] * reach;
    P[1] = pivot.y + d[k + 1] * reach;
    P[2] = pivot.z + d[k + 2] * reach;
    L.inFront[h] = projectP(v, L.ends, h * 2);
  }
}

/**
 * A ring of `RING_POINTS` points of the layout's reach about handle `h`'s axis through `c`, projected into `out`; false if
 * any is behind the eye. The reach is read off the layout rather than handed over, since a number handed across a call
 * the compiler leaves out is boxed.
 */
function ringPoints(v: ScreenView, c: { x: number; y: number; z: number }, L: GizmoLayout, h: number, out: Float64Array): boolean {
  const d = L.dirs;
  const k = h * 3;
  const r = L.reach;
  const nx = d[k];
  const ny = d[k + 1];
  const nz = d[k + 2];
  // A first perpendicular: n × the world axis it is least along, then n × that.
  let ux: number;
  let uy: number;
  let uz: number;
  if (Math.abs(ny) < 0.9) {
    ux = -nz;
    uy = 0;
    uz = nx;
  } else {
    ux = 0;
    uy = nz;
    uz = -ny;
  }
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
  PERP[0] = ux / ul;
  PERP[1] = uy / ul;
  PERP[2] = uz / ul;
  PERP[3] = ny * PERP[2] - nz * PERP[1];
  PERP[4] = nz * PERP[0] - nx * PERP[2];
  PERP[5] = nx * PERP[1] - ny * PERP[0];
  let all = true;
  for (let i = 0; i < RING_POINTS; i++) {
    const t = (i / RING_POINTS) * Math.PI * 2;
    const cs = Math.cos(t) * r;
    const sn = Math.sin(t) * r;
    P[0] = c.x + PERP[0] * cs + PERP[3] * sn;
    P[1] = c.y + PERP[1] * cs + PERP[4] * sn;
    P[2] = c.z + PERP[2] * cs + PERP[5] * sn;
    if (!projectP(v, out, i * 2)) all = false;
  }
  return all;
}

/** How far a point is from a segment on the screen, pixels (the plain form, for the tests). */
export function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  let t = l2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = px - (ax + vx * t);
  const dy = py - (ay + vy * t);
  return Math.sqrt(dx * dx + dy * dy);
}

/** A segment's four numbers and the cursor, kept: `segDist` reads them and writes its answer into `SEG[6]`. */
const SEG = new Float64Array(7);

/** `segmentDistance` over `SEG` (the cursor at 0, 1; the segment 2..5), its answer into `SEG[6]`. */
function segDist(): void {
  const px = SEG[0];
  const py = SEG[1];
  const ax = SEG[2];
  const ay = SEG[3];
  const vx = SEG[4] - ax;
  const vy = SEG[5] - ay;
  const l2 = vx * vx + vy * vy;
  let t = l2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = px - (ax + vx * t);
  const dy = py - (ay + vy * t);
  SEG[6] = Math.sqrt(dx * dx + dy * dy);
}

/** Whether `SEG[0..1]` is inside a four-cornered polygon on the screen (`pts` x, y four times), either winding. */
function inQuad(pts: Float64Array): boolean {
  const px = SEG[0];
  const py = SEG[1];
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const ax = pts[i * 2];
    const ay = pts[i * 2 + 1];
    const j = i === 3 ? 0 : i + 1;
    const bx = pts[j * 2];
    const by = pts[j * 2 + 1];
    const c = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * The handle under the cursor `c`, within `hitPx` (an arrow by its segment, a ring by its line, a box by its end, the
 * ground square by its inside), the nearest of them; -1 for none. Written into `L.hot` and answered. Nothing is made.
 */
export function pickAt(L: GizmoLayout, c: Cursor, hitPx: number): number {
  L.hot = -1;
  if (!L.on) return -1;
  SEG[0] = c.x;
  SEG[1] = c.y;
  // The nearest so far kept in a typed array and the handle in a local written once: a loop's running best begun from the
  // tagged reach and reassigned a double was boxed on every frame that picked something (measured).
  BEST[0] = hitPx;
  let hot = -1;
  for (let h = 0; h < COUNT; h++) {
    if (!L.shown[h] || !L.inFront[h]) continue;
    let d = 1e30;
    if (h === H.yaw || h === H.pitch || h === H.roll) {
      const ring = L.rings[h === H.yaw ? 0 : h === H.pitch ? 1 : 2];
      for (let i = 0; i < RING_POINTS; i++) {
        const j = i === RING_POINTS - 1 ? 0 : i + 1;
        SEG[2] = ring[i * 2];
        SEG[3] = ring[i * 2 + 1];
        SEG[4] = ring[j * 2];
        SEG[5] = ring[j * 2 + 1];
        segDist();
        if (SEG[6] < d) d = SEG[6];
      }
    } else if (h === H.ground) {
      d = inQuad(L.square) ? 0 : 1e30;
    } else if (h === H.scale || h === H.sx || h === H.sy || h === H.sz) {
      const ex = L.ends[h * 2] - SEG[0];
      const ey = L.ends[h * 2 + 1] - SEG[1];
      d = Math.sqrt(ex * ex + ey * ey);
    } else {
      SEG[2] = L.px;
      SEG[3] = L.py;
      SEG[4] = L.ends[h * 2];
      SEG[5] = L.ends[h * 2 + 1];
      segDist();
      d = SEG[6];
    }
    // Two within reach at once: the nearer, and a tie to the one listed first.
    if (d < BEST[0] || (d === BEST[0] && hot < 0 && d <= hitPx)) {
      BEST[0] = d;
      hot = h;
    }
  }
  L.hot = hot;
  return hot;
}
const BEST = new Float64Array(1);

/** `pickAt` with the point as two numbers (the tests' and the console's). */
export function pickHandle(L: GizmoLayout, cx: number, cy: number, hitPx: number): number {
  PLAIN_CURSOR.x = cx;
  PLAIN_CURSOR.y = cy;
  return pickAt(L, PLAIN_CURSOR, hitPx);
}

/** A drag of a handle in progress, kept: what was grabbed and how, and what it comes to now. */
export interface GizmoDrag {
  handle: number;
  /** The pivot when it was grabbed. */
  ox: number;
  oy: number;
  oz: number;
  /** Where along the handle's line it was grabbed (an arrow), or the level plane's hit (the ground square). */
  t0: number;
  gx: number;
  gz: number;
  /** The angle round the pivot on the screen it was last at (a ring), and which way the ring faces the eye. */
  a0: number;
  facing: number;
  /** How far from the pivot on the screen it was grabbed (a scale box), along its screen direction for an axis's box. */
  d0: number;
  sdx: number;
  sdy: number;
  /** What the drag comes to now: a move (x, y, z, metres), a turn (radians), or a scale (a factor). */
  mx: number;
  my: number;
  mz: number;
  angle: number;
  scale: number;
}

/** A drag with nothing in it, its fields doubles. */
export function gizmoDrag(): GizmoDrag {
  return { handle: -1, ox: 0.5, oy: 0.5, oz: 0.5, t0: 0.5, gx: 0.5, gz: 0.5, a0: 0.5, facing: 1, d0: 0.5, sdx: 0.5, sdy: 0.5, mx: 0.5, my: 0.5, mz: 0.5, angle: 0.5, scale: 1.5 };
}

/** Where along a line through `o` along unit `a` the ray `r` passes nearest, or NaN where the two run alongside (the plain form). */
export function lineParamNearRay(ox: number, oy: number, oz: number, ax: number, ay: number, az: number, r: Ray3): number {
  const wx = ox - r.ox;
  const wy = oy - r.oy;
  const wz = oz - r.oz;
  const b = ax * r.dx + ay * r.dy + az * r.dz;
  const d = ax * wx + ay * wy + az * wz;
  const e = r.dx * wx + r.dy * wy + r.dz * wz;
  const den = 1 - b * b;
  if (den < 1e-6) return Number.NaN;
  return (b * e - d) / den;
}

/** The nearest point's place along the drag's handle's line to the ray, into `D.t` (NaN alongside). Nothing is made. */
const D = { t: 0.5 };
function lineNear(d: GizmoDrag, L: GizmoLayout, r: Ray3): void {
  const k = d.handle * 3;
  const ax = L.dirs[k];
  const ay = L.dirs[k + 1];
  const az = L.dirs[k + 2];
  const wx = d.ox - r.ox;
  const wy = d.oy - r.oy;
  const wz = d.oz - r.oz;
  const b = ax * r.dx + ay * r.dy + az * r.dz;
  const dd = ax * wx + ay * wy + az * wz;
  const e = r.dx * wx + r.dy * wy + r.dz * wz;
  const den = 1 - b * b;
  D.t = den < 1e-6 ? Number.NaN : (b * e - dd) / den;
}

/**
 * A handle grabbed at the cursor `c` (its ray `r`): what the drag measures from, written into `d`. Answers false for a
 * handle that cannot be dragged from there (an arrow seen end on).
 */
export function grabAt(d: GizmoDrag, L: GizmoLayout, handle: number, v: ScreenView, pivot: { x: number; y: number; z: number }, c: Cursor, r: Ray3): boolean {
  d.handle = handle;
  d.ox = pivot.x;
  d.oy = pivot.y;
  d.oz = pivot.z;
  d.mx = 0;
  d.my = 0;
  d.mz = 0;
  d.angle = 0;
  d.scale = 1;
  const k = handle * 3;
  if (handle === H.x || handle === H.y || handle === H.z || handle === H.up) {
    lineNear(d, L, r);
    d.t0 = D.t;
    return D.t === D.t;
  }
  if (handle === H.ground) {
    if (Math.abs(r.dy) < 1e-6) return false;
    const s = (pivot.y - r.oy) / r.dy;
    if (!(s > 0)) return false;
    d.gx = r.ox + r.dx * s;
    d.gz = r.oz + r.dz * s;
    return true;
  }
  if (handle === H.yaw || handle === H.pitch || handle === H.roll) {
    d.a0 = Math.atan2(-(c.y - L.py), c.x - L.px);
    // A ring whose axis points toward the eye turns the way the cursor goes round it on the screen; away, the other way.
    const tx = v.ex - pivot.x;
    const ty = v.ey - pivot.y;
    const tz = v.ez - pivot.z;
    d.facing = L.dirs[k] * tx + L.dirs[k + 1] * ty + L.dirs[k + 2] * tz >= 0 ? 1 : -1;
    return true;
  }
  // A scale box: how far from the pivot on the screen, along the axis's own screen direction for an axis's box.
  const ex = c.x - L.px;
  const ey = c.y - L.py;
  if (handle === H.scale) {
    d.d0 = Math.sqrt(ex * ex + ey * ey);
    return d.d0 > 2;
  }
  const sx = L.ends[handle * 2] - L.px;
  const sy = L.ends[handle * 2 + 1] - L.py;
  const sl = Math.sqrt(sx * sx + sy * sy);
  if (!(sl > 2)) return false;
  d.sdx = sx / sl;
  d.sdy = sy / sl;
  d.d0 = ex * d.sdx + ey * d.sdy;
  return d.d0 > 2;
}

/** `grabAt` with the point as two numbers (the tests'). */
export function beginDrag(d: GizmoDrag, L: GizmoLayout, handle: number, v: ScreenView, pivot: { x: number; y: number; z: number }, cx: number, cy: number, r: Ray3): boolean {
  PLAIN_CURSOR.x = cx;
  PLAIN_CURSOR.y = cy;
  return grabAt(d, L, handle, v, pivot, PLAIN_CURSOR, r);
}

/**
 * What a drag comes to with the cursor at `c` (its ray `r`), into `d` (`mx`, `my`, `mz` for a move, `angle` for a turn,
 * `scale` for a scale): the grabbed point kept under the cursor. Answers false where the cursor's ray no longer meets what
 * the handle moves along (the level plane behind the eye), leaving the last answer. Nothing is made.
 */
export function dragAt(d: GizmoDrag, L: GizmoLayout, c: Cursor, r: Ray3): boolean {
  const h = d.handle;
  const k = h * 3;
  if (h === H.x || h === H.y || h === H.z || h === H.up) {
    lineNear(d, L, r);
    if (D.t !== D.t) return false;
    const m = D.t - d.t0;
    d.mx = L.dirs[k] * m;
    d.my = L.dirs[k + 1] * m;
    d.mz = L.dirs[k + 2] * m;
    return true;
  }
  if (h === H.ground) {
    if (Math.abs(r.dy) < 1e-6) return false;
    const s = (d.oy - r.oy) / r.dy;
    if (!(s > 0)) return false;
    d.mx = r.ox + r.dx * s - d.gx;
    d.my = 0;
    d.mz = r.oz + r.dz * s - d.gz;
    return true;
  }
  if (h === H.yaw || h === H.pitch || h === H.roll) {
    // Summed a step at a time, so a drag round and round the ring turns as far as it went, not back past half a turn.
    const now = Math.atan2(-(c.y - L.py), c.x - L.px);
    let step = now - d.a0;
    while (step > Math.PI) step -= Math.PI * 2;
    while (step < -Math.PI) step += Math.PI * 2;
    d.a0 = now;
    d.angle += step * d.facing;
    return true;
  }
  const ex = c.x - L.px;
  const ey = c.y - L.py;
  const now = h === H.scale ? Math.sqrt(ex * ex + ey * ey) : ex * d.sdx + ey * d.sdy;
  d.scale = Math.max(1e-3, now / d.d0);
  return true;
}

/** `dragAt` with the point as two numbers (the tests'). */
export function dragTo(d: GizmoDrag, L: GizmoLayout, cx: number, cy: number, r: Ray3): boolean {
  PLAIN_CURSOR.x = cx;
  PLAIN_CURSOR.y = cy;
  return dragAt(d, L, PLAIN_CURSOR, r);
}
