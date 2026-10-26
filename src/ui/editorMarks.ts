// Everything the world editor draws on the overlay canvas (DESIGN.md §2.0 rule 4, §2.3, §2.6): the aim mark and the
// boxes -- the ghost's, in `ink` where a player would be let put it there and in `warn` where a player would be refused,
// and the box of whatever the aim rests on, in `muted` -- and from the second wave each selected thing's box in `ink` (up
// to `outline.most`, past which one box round them all), the gizmo's handles (X `bad`, Y `good`, Z `accent`, the one under
// the cursor `hot`) and the rectangle a box selection draws. No WebGL, no program, no text and nothing made a frame: the
// eight corners of a box are projected into a kept array and its twelve edges are lines on the overlay, in the eighteen
// colours (`COL`). Game view (G) draws none of it.
//
// Pure arithmetic and an overlay handed in, so a node test runs every piece of it as the game does. The dev server's
// alone: reached only through the editor's own dynamic import.

import { COL } from '../core/palette.ts';
import { EDITOR_TUNE } from '../editor/editorTune.ts';
import { H, RING_POINTS, type GizmoLayout } from '../editor/gizmo.ts';

/** What the marks need of the overlay: its lines, rings and polygons. */
export interface MarksOverlay {
  line(x1: number, y1: number, x2: number, y2: number, width: number, colour: number, alpha: number): void;
  ring(cx: number, cy: number, r: number, width: number, colour: number, alpha: number): void;
  poly(pts: ArrayLike<number>, n: number, width: number, colour: number, alpha: number, close?: boolean, fill?: boolean): void;
}

/** The twelve edges of a box, as pairs of its corners' indices (corner i's bits: x, y, z, each min or max). */
const EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];

/**
 * A box's eight corners projected to the screen, CSS pixels, into `out` (x, y a corner): the box `min`..`max` (either
 * corner may come first) in a frame `m` (sixteen numbers, three's column-major `elements`), through `vp` (the camera's
 * projection times its view, the same layout) onto a screen `w` by `h`. False where any corner is behind the eye, which
 * draws nothing rather than a box turned inside out. Nothing is made.
 */
export function projectBox(min: ArrayLike<number>, max: ArrayLike<number>, m: ArrayLike<number>, vp: ArrayLike<number>, w: number, h: number, out: Float64Array): boolean {
  for (let i = 0; i < 8; i++) {
    const lx = i & 1 ? max[0] : min[0];
    const ly = i & 2 ? max[1] : min[1];
    const lz = i & 4 ? max[2] : min[2];
    // Into the world by `m`, then through `vp`.
    const x = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
    const y = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
    const z = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
    const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (!(cw > 1e-6)) return false;
    out[i * 2] = (cx / cw * 0.5 + 0.5) * w;
    out[i * 2 + 1] = (0.5 - cy / cw * 0.5) * h;
  }
  return true;
}

/** A point projected to the screen, into `out` (x, y): false behind the eye. */
export function projectPoint(x: number, y: number, z: number, vp: ArrayLike<number>, w: number, h: number, out: Float64Array): boolean {
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
  const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
  const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  if (!(cw > 1e-6)) return false;
  out[0] = (cx / cw * 0.5 + 0.5) * w;
  out[1] = (0.5 - cy / cw * 0.5) * h;
  return true;
}

/** What the marks draw this frame, one kept record the editor writes. */
export interface MarksView {
  /** Fly mode: a crosshair in the middle (Point mode has the cursor). */
  fly: boolean;
  w: number;
  h: number;
  /** Where the aim met something, on the screen. */
  aimOn: boolean;
  aimX: number;
  aimY: number;
  /** The ghost's box, its corners on the screen. */
  ghostOn: boolean;
  ghostWarn: boolean;
  ghost: Float64Array;
  /** The box of what the aim rests on. */
  hoverOn: boolean;
  hover: Float64Array;
  /** Game view: nothing of the editor's is drawn. */
  hidden: boolean;
  /** The selected things' boxes on the screen, the first `selCount` of the pool drawn; past `outline.most`, `selUnion` alone. */
  sel: Float64Array[];
  selCount: number;
  selAll: boolean;
  selUnion: Float64Array;
  /** The gizmo laid out this frame, or null. */
  gizmo: GizmoLayout | null;
  /** A box selection being drawn, its two corners on the screen. */
  rectOn: boolean;
  rect: Float64Array;
}

/** A view with nothing to draw. */
export function marksView(): MarksView {
  return { fly: true, w: 0, h: 0, aimOn: false, aimX: 0, aimY: 0, ghostOn: false, ghostWarn: false, ghost: new Float64Array(16), hoverOn: false, hover: new Float64Array(16), hidden: false, sel: [], selCount: 0, selAll: false, selUnion: new Float64Array(16), gizmo: null, rectOn: false, rect: new Float64Array(8) };
}

/** A selection box at a slot of the pool, made the first time the pool reaches that far (never in a steady frame). */
export function selSlot(v: MarksView, i: number): Float64Array {
  while (v.sel.length <= i) v.sel.push(new Float64Array(16));
  return v.sel[i];
}

/** A box's twelve edges. */
function drawBox(o: MarksOverlay, pts: Float64Array, width: number, colour: number, alpha: number): void {
  for (let e = 0; e < 24; e += 2) {
    const a = EDGES[e] * 2;
    const b = EDGES[e + 1] * 2;
    o.line(pts[a], pts[a + 1], pts[b], pts[b + 1], width, colour, alpha);
  }
}

/** A handle's colour: its axis's, or `hot` while it is under the cursor. */
function handleColour(L: GizmoLayout, h: number): number {
  if (L.hot === h) return COL.hot;
  if (h === H.x || h === H.sx || h === H.pitch) return COL.bad;
  if (h === H.y || h === H.sy || h === H.up || h === H.yaw) return COL.good;
  if (h === H.z || h === H.sz || h === H.roll) return COL.accent;
  return COL.ink;
}

/** The gizmo: each shown handle in front of the eye, as a line and a head, a ring, a square or a box. Nothing is made. */
export function drawGizmo(o: MarksOverlay, L: GizmoLayout, width: number): void {
  if (!L.on) return;
  for (let h = 0; h < L.shown.length; h++) {
    if (!L.shown[h] || !L.inFront[h]) continue;
    const c = handleColour(L, h);
    if (h === H.yaw || h === H.pitch || h === H.roll) {
      // The ring's own kept points, through the overlay's own polygon.
      o.poly(L.rings[h === H.yaw ? 0 : h === H.pitch ? 1 : 2], RING_POINTS, width, c, 0.9, true, false);
      continue;
    }
    if (h === H.ground) {
      o.poly(L.square, 4, width, c, 0.6, true, false);
      continue;
    }
    const ex = L.ends[h * 2];
    const ey = L.ends[h * 2 + 1];
    if (h === H.scale || h === H.sx || h === H.sy || h === H.sz) {
      if (h !== H.scale) o.line(L.px, L.py, ex, ey, width * 0.6, c, 0.6);
      const r = 5;
      o.line(ex - r, ey - r, ex + r, ey - r, width, c, 0.95);
      o.line(ex + r, ey - r, ex + r, ey + r, width, c, 0.95);
      o.line(ex + r, ey + r, ex - r, ey + r, width, c, 0.95);
      o.line(ex - r, ey + r, ex - r, ey - r, width, c, 0.95);
      continue;
    }
    // An arrow: its shaft, and a head of two strokes back from its end.
    o.line(L.px, L.py, ex, ey, width, c, 0.95);
    const dx = ex - L.px;
    const dy = ey - L.py;
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l > 4) {
      const ux = dx / l;
      const uy = dy / l;
      const k = 8;
      o.line(ex, ey, ex - ux * k - uy * k * 0.5, ey - uy * k + ux * k * 0.5, width, c, 0.95);
      o.line(ex, ey, ex - ux * k + uy * k * 0.5, ey - uy * k - ux * k * 0.5, width, c, 0.95);
    }
  }
}

/** Draw the editor's marks: the selection's boxes, the gizmo, a box selection, the hover's box, the ghost's box, the aim's ring and, in Fly, the crosshair. Nothing is made. */
export function drawEditorMarks(o: MarksOverlay, v: MarksView): void {
  if (v.hidden) return;
  const width = EDITOR_TUNE.outline.width;
  if (v.selAll) drawBox(o, v.selUnion, width, COL.ink, 0.9);
  else for (let i = 0; i < v.selCount; i++) drawBox(o, v.sel[i], width, COL.ink, 0.9);
  if (v.gizmo) drawGizmo(o, v.gizmo, EDITOR_TUNE.gizmo.width);
  if (v.rectOn) o.poly(v.rect, 4, 1, COL.accent, 0.9, true, false);
  if (v.hoverOn) drawBox(o, v.hover, width, COL.muted, 0.8);
  if (v.ghostOn) drawBox(o, v.ghost, width, v.ghostWarn ? COL.warn : COL.ink, 0.9);
  if (v.aimOn) o.ring(v.aimX, v.aimY, 4, 1.5, v.ghostWarn ? COL.warn : COL.accent, 0.9);
  if (v.fly) {
    const cx = v.w / 2;
    const cy = v.h / 2;
    o.line(cx - 7, cy, cx - 2, cy, 1.5, COL.ink, 0.85);
    o.line(cx + 2, cy, cx + 7, cy, 1.5, COL.ink, 0.85);
    o.line(cx, cy - 7, cx, cy - 2, 1.5, COL.ink, 0.85);
    o.line(cx, cy + 2, cx, cy + 7, 1.5, COL.ink, 0.85);
  }
}
