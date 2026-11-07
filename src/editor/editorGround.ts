// The Course tool's Ground mode (the race drawer's wave 3b, `A:\swg3js\racedrawer\DESIGN.md` §5b): the picked track's own
// ground shapes (a hole, a mound, a ramp, a trench), each anchored to its road and laid in the carve in the road's own frame.
//
// - A click on the picked track's road puts down a shape of the tune's kind and size there (`COURSE_TUNE.shapeKind` and its
//   kin), on the nearest path, square to the road; a click on a shape's handle picks it; a click off every shape lets go.
// - The picked shape's handle dragged moves it along and across its road (it keeps its path); F held changes its depth or
//   height, R held turns it, C with the wheel scales its length and width (written as the wheel rests), Delete takes it out.
//
// Every action is one write and one undo through the tool's own `write`. A frame makes nothing: the shapes' outlines in the
// game's frame are worked out once a change (and a held edit's at `previewHz`).
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no constructor parameter
// properties. The dev server's alone: reached only through the editor's own dynamic import.

import { COURSE_TUNE } from '../race/courseTune.ts';
import type { GroundShape } from '../race/courseGround.ts';
import { courseSpines, type TrackDef } from '../race/trackFile.ts';
import { nearestOn, spineAt, spineNear, spinePoint, type Spine } from '../race/coursePath.ts';
import { locateAlong } from '../race/courseGates.ts';
import { projectAt, type MarksView } from '../ui/editorMarks.ts';
import { dragAt, gizmoDrag, gizmoLayout, grabAt, H, type Cursor, type Ray3, type ScreenView } from './gizmo.ts';
import { EDITOR_TUNE } from './editorTune.ts';
import { shapeAdded, shapeAt, shapeRemoved, shapeSet, type CourseEdit } from './courseEdit.ts';
import type { ToolFrame } from './tools.ts';

/** What the Ground mode needs of the Course tool. */
export interface GroundOwner {
  track(): TrackDef | null;
  tracksNow(): readonly TrackDef[];
  write(label: string, before: TrackDef | null, after: CourseEdit | null): Promise<string>;
  busyNow(): boolean;
  /** The ground a point of the raw frame stands on (NaN for none known): where an outline is drawn. */
  groundY(x: number, z: number): number;
  pickRoad(gx: number, gz: number): void;
  toRaw(x: number, z: number, out: { x: number; z: number }): void;
  toGame(x: number, z: number, out: { x: number; z: number }): void;
  say(words: string, ok: boolean): void;
  refresh(): void;
}

/** Points along each side of a shape's outline. */
const SIDE = 6;
type GroundHeld = 'none' | 'move' | 'raise' | 'turn';
const NO_LAYOUT = gizmoLayout();

/** Whether two shapes are the same shape, field for field (the wheel's steps' guard: nothing made). */
export function sameShape(a: GroundShape | undefined, b: GroundShape | undefined): boolean {
  if (!a || !b) return false;
  return a.kind === b.kind && a.path === b.path && a.e === b.e && a.t === b.t && a.off === b.off && a.turn === b.turn && a.l === b.l && a.w === b.w && a.h === b.h && a.soft === b.soft && a.back === b.back;
}

/** The Ground mode. */
export class CourseGround {
  private readonly owner: GroundOwner;
  /** The picked shape of the picked track, -1 for none. */
  shape = -1;
  private held: GroundHeld = 'none';
  private live: TrackDef | null = null;
  private liveAt = -Infinity;
  private raise = 0.5;
  private turnBy = 0.5;
  /** C with the wheel: the scale's notches not yet written, the shape and the track they were taken on, and when last stepped. */
  private sizeBy = 0.5;
  private sizeAt = -Infinity;
  private sizeShape = -1;
  private sizeOn: TrackDef | null = null;
  /** The outlines (the game's frame, three numbers a point, `SIDE * 4 + 1` points a shape) and handles (three a shape) of the picked track. */
  private outline = new Float64Array(0);
  private handles = new Float64Array(0);
  private count = 0;
  private viewsOf: TrackDef | null = null;
  private viewsLive: TrackDef | null = null;
  lineNeed = 0;
  pointNeed = 0;
  markNeed = 0;
  private hot = -1;
  private hotK = -1;
  private seen: TrackDef | null = null;
  private readonly drag = gizmoDrag();
  private readonly at = { x: 0.5, z: 0.5 };
  private readonly pivot = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly pt = new Float64Array(2);
  private readonly p3 = new Float64Array(3);
  private readonly reg = new Float64Array(1);
  dx = 0.5;
  dy = 0.5;

  constructor(owner: GroundOwner) {
    this.owner = owner;
    this.raise = 0;
    this.turnBy = 0;
    this.sizeBy = 0;
    this.dx = 0;
    this.dy = 0;
  }

  get busy(): boolean {
    return this.held !== 'none';
  }

  /** Everything let go (a mode, a disarm, the world going). */
  reset(): void {
    this.giveUp();
    this.shape = -1;
    this.sizeBy = 0;
    this.sizeOn = null;
    this.viewsOf = null;
  }

  private giveUp(): void {
    this.held = 'none';
    this.live = null;
    this.raise = 0;
    this.turnBy = 0;
  }

  /** One frame: F and R held, the wheel's steps written as it rests, a drag carried on or let go, a press. */
  frame(f: ToolFrame, view: ScreenView, cur: Cursor, ray: Ray3, press: boolean, release: boolean, liftUp: boolean, turnUp: boolean): void {
    const t = this.owner.track();
    if (t !== this.seen) {
      this.seen = t;
      if (!t?.course?.ground?.[this.shape]) this.shape = -1;
    }
    const busy = this.owner.busyNow();
    const s = t?.course?.ground?.[this.shape];
    if (s && f.lift && !busy && (this.held === 'none' || this.held === 'raise')) {
      if (this.held === 'none') {
        this.held = 'raise';
        this.raise = 0;
      }
      if (this.dy) this.raise -= (this.dy * COURSE_TUNE.raiseRate) / 100;
    }
    if (liftUp && this.held === 'raise') this.letGo(`shape ${this.shape} ${s && (s.kind === 'hole' || s.kind === 'trench') ? 'deepened' : 'raised'}`, view, cur);
    if (s && f.turn && !busy && (this.held === 'none' || this.held === 'turn')) {
      if (this.held === 'none') {
        this.held = 'turn';
        this.turnBy = 0;
      }
      this.turnBy += (this.dx * COURSE_TUNE.bankRate) / 100;
    }
    if (turnUp && this.held === 'turn') this.letGo(`shape ${this.shape} turned`, view, cur);
    if (this.sizeBy !== 0) {
      // The steps belong to the very shape they were taken on (the review round): the same index, as many shapes, and that shape
      // as it stood then, field for field (an undo that took one shape out and put another in leaves the count as it was).
      const same = t && this.sizeShape === this.shape && this.sizeOn && (t === this.sizeOn || ((t.course?.ground?.length ?? 0) === (this.sizeOn.course?.ground?.length ?? 0) && sameShape(t.course?.ground?.[this.shape], this.sizeOn.course?.ground?.[this.shape])));
      if (!same) {
        this.sizeBy = 0;
        this.sizeOn = null;
        this.owner.say("the wheel's size steps given up: the shape they were taken on was let go, or the shapes were numbered again", false);
      } else if (f.now - this.sizeAt > 0.4 && this.held === 'none' && !busy && s) {
        const k = Math.pow(1 + COURSE_TUNE.shapeStepShare, this.sizeBy);
        this.sizeBy = 0;
        this.sizeOn = null;
        void this.owner.write(`shape ${this.shape} sized`, t, shapeSet(t, this.shape, { l: s.l * k, w: s.w * k }));
      }
    }
    if (this.held === 'move') {
      if (f.apply) dragAt(this.drag, NO_LAYOUT, cur, ray);
      else if (release) this.letGo(`shape ${this.shape} moved`, view, cur);
    } else if (press && !busy) this.pressed(f, view, cur, ray);
    if (this.held !== 'none' && t && f.now - this.liveAt >= 1 / Math.max(1, COURSE_TUNE.previewHz)) {
      this.liveAt = f.now;
      const e = this.heldEdit(t);
      if (e && typeof e !== 'string') this.live = e;
    }
  }

  /** What a held edit comes to now (never written here), or null. */
  private heldEdit(t: TrackDef): CourseEdit | null {
    const s = t.course?.ground?.[this.shape];
    if (!s) return null;
    if (this.held === 'raise') return this.raise !== 0 ? shapeSet(t, this.shape, { h: Math.max(0, s.h + this.raise) }) : null;
    if (this.held === 'turn') {
      let turn = s.turn + this.turnBy;
      turn -= 360 * Math.round(turn / 360);
      return this.turnBy !== 0 ? shapeSet(t, this.shape, { turn }) : null;
    }
    if (this.held === 'move') {
      this.owner.toRaw(this.drag.gx + this.drag.mx, this.drag.gz + this.drag.mz, this.at);
      const sp = this.spineOf(t, s.path);
      const near = spineNear();
      if (!sp || !nearestOn(sp, this.at.x, this.at.z, near)) return null;
      return shapeSet(t, this.shape, { e: near.e, t: near.t, off: near.o });
    }
    return null;
  }

  private spineOf(t: TrackDef, path: string): Spine | null {
    const p = t.course?.paths.findIndex((q) => q.id === path) ?? -1;
    return p >= 0 ? (courseSpines(t)[p] ?? null) : null;
  }

  /** Whether a drag let go where it was grabbed (a click, which only picks). */
  private stillAt(view: ScreenView, cur: Cursor): boolean {
    const p = this.p3;
    p[0] = this.drag.gx;
    p[1] = this.drag.oy;
    p[2] = this.drag.gz;
    if (!projectAt(p, 0, view.vp, view.w, view.h, this.pt)) return false;
    const dx = this.pt[0] - cur.x;
    const dy = this.pt[1] - cur.y;
    const r = EDITOR_TUNE.pick.dragPx;
    return dx * dx + dy * dy <= r * r;
  }

  private letGo(label: string, view: ScreenView, cur: Cursor): void {
    const t = this.owner.track();
    const drag = this.held === 'move';
    let e: CourseEdit | null = t && !(drag && this.stillAt(view, cur)) ? this.heldEdit(t) : null;
    if (t && e && typeof e !== 'string' && JSON.stringify(e) === JSON.stringify(t)) e = null;
    this.held = 'none';
    this.raise = 0;
    this.turnBy = 0;
    if (!t || !e) {
      this.live = null;
      return;
    }
    if (typeof e !== 'string') this.live = e;
    void this.owner.write(label, t, e).finally(() => {
      this.live = null;
    });
  }

  private pressed(f: ToolFrame, view: ScreenView, cur: Cursor, ray: Ray3): void {
    if (f.sampled) return;
    const t = this.owner.track();
    if (t && this.hot >= 0 && t.course?.ground?.[this.hot]) {
      this.shape = this.hot;
      const h = this.handles;
      this.pivot.x = h[this.hot * 3];
      this.pivot.y = h[this.hot * 3 + 1];
      this.pivot.z = h[this.hot * 3 + 2];
      if (grabAt(this.drag, NO_LAYOUT, H.ground, view, this.pivot, cur, ray)) this.held = 'move';
      const s = t.course.ground[this.hot];
      this.owner.say(`shape ${this.hot}: a ${s.kind} ${s.l} by ${s.w} m, ${s.h} m ${s.kind === 'hole' || s.kind === 'trench' ? 'deep' : 'high'} (drag it, F its ${s.kind === 'hole' || s.kind === 'trench' ? 'depth' : 'height'}, R turns, C with the wheel sizes, Delete)`, true);
      this.owner.refresh();
      return;
    }
    if (!f.valid) return;
    if (!t) {
      this.owner.pickRoad(f.x, f.z);
      if (!this.owner.track()) this.owner.say("pick a track first: a click on its road, or Pick on the Tools tab's list", false);
      return;
    }
    if (this.shape >= 0) {
      this.shape = -1;
      this.owner.refresh();
      return;
    }
    this.owner.toRaw(f.x, f.z, this.at);
    const s = shapeAt(t, this.at.x, this.at.z);
    if (typeof s === 'string') {
      this.owner.say(s, false);
      return;
    }
    void this.owner.write(`a ${s.kind} put down`, t, shapeAdded(t, s)).then((w) => {
      const now = this.owner.track();
      if (now?.course?.ground?.length) this.shape = now.course.ground.length - 1;
      return w;
    });
  }

  /** C held with the wheel: the picked shape's length and width scaled, written as the wheel rests. */
  size(notches: number, now: number): string | null {
    const t = this.owner.track();
    const s = t?.course?.ground?.[this.shape];
    if (!t || !s) return null;
    if (this.sizeBy === 0) this.sizeOn = t;
    this.sizeShape = this.shape;
    this.sizeAt = now;
    this.sizeBy += notches;
    const k = Math.pow(1 + COURSE_TUNE.shapeStepShare, this.sizeBy);
    return `shape ${this.shape} ${(s.l * k).toFixed(1)} by ${(s.w * k).toFixed(1)} m (written as the wheel rests)`;
  }

  /** Delete: the picked shape taken out. */
  deleteKey(): boolean {
    const t = this.owner.track();
    if (!t || !t.course?.ground?.[this.shape]) return false;
    const i = this.shape;
    this.shape = -1;
    void this.owner.write(`shape ${i} taken out`, t, shapeRemoved(t, i));
    return true;
  }

  /** Escape: a held edit, then the pick. */
  escape(): boolean {
    if (this.held !== 'none') {
      this.giveUp();
      this.owner.say('the edit given up: nothing written', true);
      return true;
    }
    if (this.shape >= 0) {
      this.shape = -1;
      this.owner.refresh();
      return true;
    }
    return false;
  }

  holdsMouse(lift: boolean, turn: boolean): boolean {
    return this.shape >= 0 && (lift || turn);
  }

  // ---- The marks. ----

  /** The picked track's shapes' outlines and handles in the game's frame, made again when the track or the held edit is another. */
  need(): void {
    const t0 = this.owner.track();
    const t = this.live && t0 && this.live.id === t0.id ? this.live : t0;
    if (t === this.viewsOf && this.live === this.viewsLive) return;
    this.viewsOf = t;
    this.viewsLive = this.live;
    const shapes = t?.course?.ground ?? [];
    const n = shapes.length;
    const per = SIDE * 4 + 1;
    if (this.outline.length < n * per * 3) this.outline = new Float64Array(n * per * 3);
    if (this.handles.length < n * 3) this.handles = new Float64Array(n * 3);
    const spines = t ? courseSpines(t) : [];
    const ids = t?.course?.paths.map((p) => p.id) ?? [];
    const P = spinePoint();
    const at = { e: 0, t: 0 };
    const g = { x: 0, z: 0 };
    let k = 0;
    for (let i = 0; i < n; i++) {
      const s = shapes[i];
      const sp = spines[ids.indexOf(s.path)];
      if (!sp) continue;
      const E = sp.edges.length;
      const e = Math.min(s.e, E - 1);
      const s0 = sp.start[e] + (s.e > E - 1 ? 1 : s.t) * sp.edges[e].len;
      const th = (s.turn * Math.PI) / 180;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const hl = s.l / 2;
      const hw = s.w / 2;
      // A point of the shape's own frame (u along, v across) on the ground, through the road's frame (`s`, `o`).
      const put = (u: number, v: number, into: Float64Array, o: number): void => {
        const a = u * c - v * sn;
        const off = u * sn + v * c + s.off;
        locateAlong(sp, s0 + a, at);
        spineAt(sp, at.e, at.t, P);
        const x = P.x + P.tz * off;
        const z = P.z - P.tx * off;
        this.owner.toGame(x, z, g);
        const y = this.owner.groundY(x, z);
        into[o] = g.x;
        into[o + 1] = (Number.isFinite(y) ? y : P.y) + 0.1;
        into[o + 2] = g.z;
      };
      const base = k * per * 3;
      const corners = [
        [-hl, -hw],
        [hl, -hw],
        [hl, hw],
        [-hl, hw],
      ];
      let q = 0;
      for (let side = 0; side < 4; side++) {
        const [ua, va] = corners[side];
        const [ub, vb] = corners[(side + 1) % 4];
        for (let j = 0; j < SIDE; j++) {
          const f = j / SIDE;
          put(ua + (ub - ua) * f, va + (vb - va) * f, this.outline, base + q * 3);
          q++;
        }
      }
      put(corners[0][0], corners[0][1], this.outline, base + q * 3);
      put(0, 0, this.handles, k * 3);
      k++;
    }
    this.count = k;
    this.lineNeed = k;
    this.pointNeed = k * per;
    this.markNeed = k;
  }

  /** The picked track's shapes drawn into the course pools after the courses (`counts` the lines, points and handles so far). */
  draw(m: MarksView, view: ScreenView, cur: Cursor, counts: Int32Array): void {
    let L = counts[0];
    let P = counts[1];
    let K = counts[2];
    const per = SIDE * 4 + 1;
    const R = this.reg;
    R[0] = COURSE_TUNE.hitPx;
    this.hot = -1;
    for (let i = 0; i < this.count; i++) {
      const start = P;
      for (let j = 0; j < per; j++) {
        m.courseVis[P] = projectAt(this.outline, (i * per + j) * 3, view.vp, view.w, view.h, this.pt) ? 1 : 0;
        m.coursePts[P * 2] = this.pt[0];
        m.coursePts[P * 2 + 1] = this.pt[1];
        P++;
      }
      m.courseSpans[L] = P - start;
      m.courseStyle[L] = i === this.shape ? 13 : 11;
      L++;
      const vis = projectAt(this.handles, i * 3, view.vp, view.w, view.h, this.pt);
      m.courseMarkVis[K] = vis ? 1 : 0;
      m.courseMarkPts[K * 2] = this.pt[0];
      m.courseMarkPts[K * 2 + 1] = this.pt[1];
      m.courseMarkKind[K] = 1;
      m.courseMarkState[K] = i === this.shape ? 2 : 0;
      if (vis) {
        const hx = this.pt[0] - cur.x;
        const hy = this.pt[1] - cur.y;
        const dd = Math.sqrt(hx * hx + hy * hy);
        if (dd < R[0]) {
          R[0] = dd;
          this.hot = i;
          this.hotK = K;
        }
      }
      K++;
    }
    if (this.hot >= 0 && m.courseMarkState[this.hotK] !== 2) m.courseMarkState[this.hotK] = 1;
    counts[0] = L;
    counts[1] = P;
    counts[2] = K;
  }

  report(): Record<string, unknown> {
    const t = this.owner.track();
    return { shape: this.shape, held: this.held, shapes: t?.course?.ground?.length ?? 0, sizeBy: this.sizeBy };
  }
}
