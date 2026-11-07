// Everything the world editor draws on the overlay canvas (DESIGN.md §2.0 rule 4, §2.3, §2.6): the aim mark and the
// boxes -- the ghost's, in `ink` where a player would be let put it there and in `warn` where a player would be refused,
// and the box of whatever the aim rests on, in `muted` -- and from the second wave each selected thing's box in `ink` (up
// to `outline.most`, past which one box round them all), the gizmo's handles (X `bad`, Y `good`, Z `accent`, the one under
// the cursor `hot`) and the rectangle a box selection draws, and from the third the brush's ring on the ground (`accent`,
// `bad` while it erases), and from Map-maker II a tool's second ring at its hardness. No WebGL, no program, no text and nothing made a frame: the
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

/**
 * `projectPoint` of the point a kept array holds at `i` (x, y, z at `i`, `i + 1`, `i + 2`): no number of the point crosses the
 * call, since a double handed to a call the compiler leaves out is boxed (the zone tool's rectangle drag measured 240 bytes a
 * frame through `projectPoint` once its draw had been compiled again without that call built in).
 */
export function projectAt(a: Float64Array, i: number, vp: ArrayLike<number>, w: number, h: number, out: Float64Array): boolean {
  const x = a[i];
  const y = a[i + 1];
  const z = a[i + 2];
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
  /**
   * The scatter brush's ring (map-maker wave 3): `RING_STEPS` ground points round the aim on the screen (two a point),
   * each drawn to the next where both are in front of the eye (`ringVis`), in `bad` while a stroke erases.
   */
  ringOn: boolean;
  ringErase: boolean;
  ring: Float64Array;
  ringVis: Uint8Array;
  /**
   * A tool's second ring (Map-maker II's sculpt brush): its hardness, the disc at full weight inside the falloff, drawn
   * fainter in the first ring's colour; `ringErase` reads for both (the sculpt brush's lower and smooth take `bad`).
   */
  ring2On: boolean;
  ring2: Float64Array;
  ring2Vis: Uint8Array;
  /**
   * The water tool's lakes (Map-maker II's fifth wave): every lake of ours' outline on the screen at its surface, the first
   * `lakeSpans[0]` points of `lakePts` (two numbers a point) the first lake's and so on, each drawn point to point (closed)
   * where both are in front of the eye (`lakeVis`), the picked one (`lakePicked`) in `ink` and the rest in `accent`, with a
   * ring at each lake's handle (its middle at its surface, `lakeHandles`). The pools grow when a world's lakes first need
   * more, never in a steady frame.
   */
  lakesOn: boolean;
  lakeCount: number;
  lakePicked: number;
  lakeSpans: Int32Array;
  lakePts: Float64Array;
  lakeVis: Uint8Array;
  lakeHandles: Float64Array;
  lakeHandleVis: Uint8Array;
  /**
   * The places tool's (Map-maker II's eighth wave) outlines ride the lakes' pools: an outline marked here (1) is a place
   * players may not build in, drawn in `bad` unless it is the picked one. The water tool writes nought.
   */
  lakeBad: Uint8Array;
  /** A draft under way (a lake's clicked points, a fall's top), an open line ending at the aim, in `warn`. */
  draftOn: boolean;
  draftCount: number;
  draftPts: Float64Array;
  draftVis: Uint8Array;
  /**
   * The handles of what hangs on the rows (Map-maker II's seventh wave: Map-maker I's handles of invisible things, less the
   * light's): a diamond for an effect, a small ring and a ring at its full-volume radius for a sound, each at its place on the
   * screen (`handlePts`: x, y and the big ring's radius in pixels, three a handle) where it is in front of the eye
   * (`handleVis`), `handleKind` 0 an effect and 1 a sound, `handleState` 0 plain (`accent`), 1 under the cursor (`hot`), 2
   * picked (`ink`); `handlePx` its half size. The pools grow when they first need to, never in a steady frame.
   */
  handlesOn: boolean;
  handleCount: number;
  handlePx: number;
  handlePts: Float64Array;
  handleVis: Uint8Array;
  handleKind: Uint8Array;
  handleState: Uint8Array;
  /**
   * The lights tool's markers (Map-maker II's wave of the rooms' lights): an icon of ours for every light of the room round the
   * camera and every light outdoors near it, at its place on the screen (`lightPts`, two numbers a marker) where it is in front
   * of the eye (`lightVis`): `lightType` 0 a round light (a disc and its rays), 1 a spot (a cone), 2 a directional (an arrow);
   * `lightState` 0 one of the game's own (`muted`), 1 one added (`accent`), 2 under the cursor (`hot`), 3 picked (`ink`), 4 one
   * that lights nothing now (`warn`: switched off, no slot built for it, or standing outdoors); `lightPx` its half size. And the
   * picked light's reach: a ring (`lightShape`, closed, `lightShapeN` points) and, for a spot, the lines from its apex to the
   * ring (`lightRays`, four numbers a line); a directional's way is one line. The pools grow when they first need to.
   */
  lightsOn: boolean;
  lightCount: number;
  lightPx: number;
  lightPts: Float64Array;
  lightVis: Uint8Array;
  lightType: Uint8Array;
  lightState: Uint8Array;
  lightShapeOn: boolean;
  lightShapeN: number;
  lightShape: Float64Array;
  lightShapeVis: Uint8Array;
  lightRayN: number;
  lightRays: Float64Array;
  /**
   * The course tool's courses (the race drawer's first wave): `courseLineN` lines, the first `courseSpans[0]` points of
   * `coursePts` (two numbers a point) the first line's and so on, each drawn point to point where both are in front of the
   * eye (`courseVis`); a line's `courseStyle` says what it is -- 0 a course's spine, 1 the picked course's, 2 a road's edge, 3
   * a shoulder's outer edge (dotted), 4 a node's width line, 5 a gate's window, 6 the picked gate's, 7 the gate under the
   * cursor, 8 a gate seen while editing nodes (faint), 9 a draft under way, 10 a race wall's foot, top or post, 11 the picked
   * track's, 12 a wall being drawn, 13 the picked wall's -- and its 0x80 bit closes it (a gate's window).
   * And the picked course's handles (`courseMarkN`, a place each, `courseMarkPts`): `courseMarkKind` 0 a node's diamond, 1 a
   * grabber at a width line's end; `courseMarkState` 0 plain, 1 under the cursor, 2 picked. The pools grow when a world's
   * courses first need them, never in a steady frame.
   */
  courseOn: boolean;
  courseLineN: number;
  courseSpans: Int32Array;
  courseStyle: Uint8Array;
  coursePts: Float64Array;
  courseVis: Uint8Array;
  courseMarkN: number;
  courseMarkPts: Float64Array;
  courseMarkVis: Uint8Array;
  courseMarkKind: Uint8Array;
  courseMarkState: Uint8Array;
}

/** The course tool's pools grown to hold `lines` lines of `points` points in all and `marks` handles; nothing made when they do already. */
export function coursePools(v: MarksView, lines: number, points: number, marks: number): void {
  if (v.courseSpans.length < lines) {
    const cap = Math.max(lines, v.courseSpans.length * 2, 16);
    v.courseSpans = new Int32Array(cap);
    v.courseStyle = new Uint8Array(cap);
  }
  if (v.courseVis.length < points) {
    const cap = Math.max(points, v.courseVis.length * 2, 256);
    v.coursePts = new Float64Array(cap * 2);
    v.courseVis = new Uint8Array(cap);
  }
  if (v.courseMarkKind.length < marks) {
    const cap = Math.max(marks, v.courseMarkKind.length * 2, 32);
    v.courseMarkPts = new Float64Array(cap * 2);
    v.courseMarkVis = new Uint8Array(cap);
    v.courseMarkKind = new Uint8Array(cap);
    v.courseMarkState = new Uint8Array(cap);
  }
}

/** The lights' marker pools grown to hold `n` markers; nothing made when they do already. */
export function lightPools(v: MarksView, n: number): void {
  if (v.lightType.length >= n) return;
  const cap = Math.max(n, v.lightType.length * 2, 16);
  v.lightPts = new Float64Array(cap * 2);
  v.lightVis = new Uint8Array(cap);
  v.lightType = new Uint8Array(cap);
  v.lightState = new Uint8Array(cap);
}

/** The lakes' pools grown to hold `lakes` lakes of `points` points in all (`MarksView.lakePts`), and a draft of `draft` points; nothing made when they do already. */
export function lakePools(v: MarksView, lakes: number, points: number, draft: number): void {
  if (v.lakeSpans.length < lakes) {
    v.lakeSpans = new Int32Array(lakes * 2);
    v.lakeHandles = new Float64Array(lakes * 4);
    v.lakeHandleVis = new Uint8Array(lakes * 2);
    v.lakeBad = new Uint8Array(lakes * 2);
  }
  if (v.lakeVis.length < points) {
    v.lakePts = new Float64Array(points * 4);
    v.lakeVis = new Uint8Array(points * 2);
  }
  if (v.draftVis.length < draft) {
    v.draftPts = new Float64Array(draft * 4);
    v.draftVis = new Uint8Array(draft * 2);
  }
}

/** How many points the brush's ring is drawn through (`brush.ts`'s `RING_STEPS`, said again so this file imports no rule). */
export const RING_MARKS = 48;

/** A view with nothing to draw. */
export function marksView(): MarksView {
  return {
    fly: true,
    w: 0,
    h: 0,
    aimOn: false,
    aimX: 0,
    aimY: 0,
    ghostOn: false,
    ghostWarn: false,
    ghost: new Float64Array(16),
    hoverOn: false,
    hover: new Float64Array(16),
    hidden: false,
    sel: [],
    selCount: 0,
    selAll: false,
    selUnion: new Float64Array(16),
    gizmo: null,
    rectOn: false,
    rect: new Float64Array(8),
    ringOn: false,
    ringErase: false,
    ring: new Float64Array(RING_MARKS * 2),
    ringVis: new Uint8Array(RING_MARKS),
    ring2On: false,
    ring2: new Float64Array(RING_MARKS * 2),
    ring2Vis: new Uint8Array(RING_MARKS),
    lakesOn: false,
    lakeCount: 0,
    lakePicked: -1,
    lakeSpans: new Int32Array(0),
    lakePts: new Float64Array(0),
    lakeVis: new Uint8Array(0),
    lakeHandles: new Float64Array(0),
    lakeHandleVis: new Uint8Array(0),
    lakeBad: new Uint8Array(0),
    draftOn: false,
    draftCount: 0,
    draftPts: new Float64Array(0),
    draftVis: new Uint8Array(0),
    handlesOn: false,
    handleCount: 0,
    handlePx: 7,
    handlePts: new Float64Array(0),
    handleVis: new Uint8Array(0),
    handleKind: new Uint8Array(0),
    handleState: new Uint8Array(0),
    lightsOn: false,
    lightCount: 0,
    lightPx: 8,
    lightPts: new Float64Array(0),
    lightVis: new Uint8Array(0),
    lightType: new Uint8Array(0),
    lightState: new Uint8Array(0),
    lightShapeOn: false,
    lightShapeN: 0,
    lightShape: new Float64Array(RING_MARKS * 2),
    lightShapeVis: new Uint8Array(RING_MARKS),
    lightRayN: 0,
    lightRays: new Float64Array(16),
    courseOn: false,
    courseLineN: 0,
    courseSpans: new Int32Array(0),
    courseStyle: new Uint8Array(0),
    coursePts: new Float64Array(0),
    courseVis: new Uint8Array(0),
    courseMarkN: 0,
    courseMarkPts: new Float64Array(0),
    courseMarkVis: new Uint8Array(0),
    courseMarkKind: new Uint8Array(0),
    courseMarkState: new Uint8Array(0),
  };
}

/** A course line's colour and alpha by its style (`MarksView.courseStyle`, its 0x80 bit taken off). */
function courseInk(style: number): number {
  // 10 to 13 the race walls (the third wave): a wall's foot, top and posts; the picked track's; the wall being drawn; the picked wall.
  return style === 1 || style === 4 || style === 6 || style === 13 ? COL.ink : style === 7 ? COL.hot : style === 9 || style === 12 || style === 11 ? COL.warn : style === 5 || style === 8 ? COL.good : style === 2 ? COL.accent : COL.muted;
}

/**
 * The course tool's courses (`MarksView.course...`): each line point to point (a shoulder's outer edge every other span, a
 * gate's window closed), then the picked course's diamonds and grabbers. Nothing is made; the width is read here.
 */
function drawCourses(o: MarksOverlay, v: MarksView): void {
  if (!v.courseOn) return;
  const width = EDITOR_TUNE.outline.width;
  const pts = v.coursePts;
  const vis = v.courseVis;
  let k = 0;
  for (let l = 0; l < v.courseLineN; l++) {
    const n = v.courseSpans[l];
    const raw = v.courseStyle[l];
    const style = raw & 0x7f;
    const closed = (raw & 0x80) !== 0;
    const c = courseInk(style);
    const a = style === 0 || style === 8 ? 0.45 : style === 3 ? 0.55 : 0.9;
    const w = style === 1 || style === 6 || style === 7 || style === 13 ? width * 1.25 : style === 3 || style === 8 ? width * 0.75 : width;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      if (style === 3 && (i & 1)) continue;
      const p = k + i;
      const q = k + (i + 1 === n ? 0 : i + 1);
      if (vis[p] && vis[q]) o.line(pts[p * 2], pts[p * 2 + 1], pts[q * 2], pts[q * 2 + 1], w, c, a);
    }
    if (style === 9 || style === 12) for (let i = 0; i < n - 1; i++) if (vis[k + i]) o.ring(pts[(k + i) * 2], pts[(k + i) * 2 + 1], 3, width, c, 0.9);
    k += n;
  }
  const mp = v.courseMarkPts;
  const r = 6;
  for (let i = 0; i < v.courseMarkN; i++) {
    if (!v.courseMarkVis[i]) continue;
    const s = v.courseMarkState[i];
    const c = s === 2 ? COL.ink : s === 1 ? COL.hot : COL.accent;
    const x = mp[i * 2];
    const y = mp[i * 2 + 1];
    if (v.courseMarkKind[i] === 0) {
      o.line(x, y - r, x + r, y, width, c, 0.95);
      o.line(x + r, y, x, y + r, width, c, 0.95);
      o.line(x, y + r, x - r, y, width, c, 0.95);
      o.line(x - r, y, x, y - r, width, c, 0.95);
    } else {
      const g = r * 0.6;
      o.line(x - g, y - g, x + g, y - g, width, c, 0.95);
      o.line(x + g, y - g, x + g, y + g, width, c, 0.95);
      o.line(x + g, y + g, x - g, y + g, width, c, 0.95);
      o.line(x - g, y + g, x - g, y - g, width, c, 0.95);
    }
  }
}

/**
 * The lights tool's markers and the picked light's reach (`MarksView.light...`, Map-maker II's wave of the rooms' lights): a
 * disc with four rays for a round light, a cone for a spot, an arrow for a directional, each in its state's colour. Nothing is
 * made; the width is read here.
 */
function drawLights(o: MarksOverlay, v: MarksView): void {
  if (!v.lightsOn) return;
  const width = EDITOR_TUNE.outline.width;
  if (v.lightShapeOn) {
    const s = v.lightShape;
    const vis = v.lightShapeVis;
    const n = v.lightShapeN;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      if (vis[i] && vis[j]) o.line(s[i * 2], s[i * 2 + 1], s[j * 2], s[j * 2 + 1], width * 0.75, COL.ink, 0.45);
    }
    const r = v.lightRays;
    for (let i = 0; i < v.lightRayN; i++) o.line(r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3], width * 0.75, COL.ink, 0.45);
  }
  const px = v.lightPx;
  const pts = v.lightPts;
  for (let i = 0; i < v.lightCount; i++) {
    if (!v.lightVis[i]) continue;
    const st = v.lightState[i];
    const c = st === 3 ? COL.ink : st === 2 ? COL.hot : st === 4 ? COL.warn : st === 1 ? COL.accent : COL.muted;
    const x = pts[i * 2];
    const y = pts[i * 2 + 1];
    const t = v.lightType[i];
    if (t === 1) {
      // A spot: a cone opening downward from its apex, closed by its mouth.
      o.line(x, y - px, x - px, y + px, width, c, 0.95);
      o.line(x, y - px, x + px, y + px, width, c, 0.95);
      o.line(x - px, y + px, x + px, y + px, width, c, 0.95);
    } else if (t === 2) {
      // A directional: an arrow falling, its head two strokes.
      o.line(x, y - px, x, y + px, width, c, 0.95);
      o.line(x, y + px, x - px * 0.6, y + px * 0.35, width, c, 0.95);
      o.line(x, y + px, x + px * 0.6, y + px * 0.35, width, c, 0.95);
    } else {
      // A round light: a disc and four short rays.
      o.ring(x, y, px * 0.55, width, c, 0.95);
      const a = px * 0.75;
      const b = px * 1.25;
      o.line(x - b, y, x - a, y, width, c, 0.95);
      o.line(x + a, y, x + b, y, width, c, 0.95);
      o.line(x, y - b, x, y - a, width, c, 0.95);
      o.line(x, y + a, x, y + b, width, c, 0.95);
    }
  }
}

/**
 * The handles of what hangs on the rows (`MarksView.handle...`): a diamond for an effect, a small ring and its full-volume
 * ring (faint, from 4 px to the screen's width) for a sound. Nothing is made; the width is read here, never handed in.
 */
function drawHandles(o: MarksOverlay, v: MarksView): void {
  if (!v.handlesOn) return;
  const width = EDITOR_TUNE.outline.width;
  const r = v.handlePx;
  const pts = v.handlePts;
  for (let i = 0; i < v.handleCount; i++) {
    if (!v.handleVis[i]) continue;
    const s = v.handleState[i];
    const c = s === 2 ? COL.ink : s === 1 ? COL.hot : COL.accent;
    const x = pts[i * 3];
    const y = pts[i * 3 + 1];
    if (v.handleKind[i] === 1) {
      o.ring(x, y, r * 0.8, width, c, 0.95);
      const big = pts[i * 3 + 2];
      if (big > 4 && big < v.w) o.ring(x, y, big, width * 0.75, c, 0.35);
    } else {
      o.line(x, y - r, x + r, y, width, c, 0.95);
      o.line(x + r, y, x, y + r, width, c, 0.95);
      o.line(x, y + r, x - r, y, width, c, 0.95);
      o.line(x - r, y, x, y - r, width, c, 0.95);
    }
  }
}

/**
 * The water tool's lakes and its draft (`MarksView.lakes...`, `draft...`). Nothing is made: the line's width is read here,
 * never handed in, since a number handed across a call the compiler leaves out is boxed (the gizmo's frame measured it).
 */
function drawLakes(o: MarksOverlay, v: MarksView): void {
  if (!v.lakesOn && !v.draftOn) return;
  const width = EDITOR_TUNE.outline.width;
  if (v.lakesOn) {
    let k = 0;
    for (let l = 0; l < v.lakeCount; l++) {
      const n = v.lakeSpans[l];
      const c = l === v.lakePicked ? COL.ink : v.lakeBad[l] ? COL.bad : COL.accent;
      const pts = v.lakePts;
      const vis = v.lakeVis;
      for (let i = 0; i < n; i++) {
        const a = k + i;
        const b = k + (i + 1 === n ? 0 : i + 1);
        if (vis[a] && vis[b]) o.line(pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1], width, c, l === v.lakePicked ? 0.95 : 0.75);
      }
      if (v.lakeHandleVis[l]) o.ring(v.lakeHandles[l * 2], v.lakeHandles[l * 2 + 1], 6, width, c, 0.9);
      k += n;
    }
  }
  if (v.draftOn) {
    const pts = v.draftPts;
    const vis = v.draftVis;
    for (let i = 0; i + 1 < v.draftCount; i++) if (vis[i] && vis[i + 1]) o.line(pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3], width, COL.warn, 0.9);
    for (let i = 0; i < v.draftCount - 1; i++) if (vis[i]) o.ring(pts[i * 2], pts[i * 2 + 1], 3, width, COL.warn, 0.9);
  }
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
  if (v.ringOn) {
    // The brush's ring, a segment between each pair of points both in front of the eye.
    const c = v.ringErase ? COL.bad : COL.accent;
    const pts = v.ring;
    const vis = v.ringVis;
    for (let i = 0; i < RING_MARKS; i++) {
      const j = i + 1 === RING_MARKS ? 0 : i + 1;
      if (vis[i] && vis[j]) o.line(pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1], width, c, 0.9);
    }
    // Its second ring, the hardness, fainter and finer in the same colour.
    if (v.ring2On) {
      const p2 = v.ring2;
      const v2 = v.ring2Vis;
      for (let i = 0; i < RING_MARKS; i++) {
        const j = i + 1 === RING_MARKS ? 0 : i + 1;
        if (v2[i] && v2[j]) o.line(p2[i * 2], p2[i * 2 + 1], p2[j * 2], p2[j * 2 + 1], width * 0.75, c, 0.5);
      }
    }
  }
  drawLakes(o, v);
  drawCourses(o, v);
  drawHandles(o, v);
  drawLights(o, v);
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
