// The Course tool's Walls mode (the race drawer's third wave, `A:\swg3js\racedrawer\DESIGN.md` §2.10's binding block, §5):
// race walls drawn freely onto the picked track, each a line of straight edges and circular arcs with a height and a lean.
//
// - A click on the ground adds a point to the wall being drawn (on the carved ground there, or a drawn road's surface); a
//   click near its last point (or Finish the wall) writes it; RMB takes the last point back; V turns the edge being drawn
//   between straight and an arc (a gentle one, its radius its chord's length, bulging to its right).
// - The picked track's walls show their points (diamonds) and their edges' middles (squares): a point dragged moves over the
//   ground (its foot put on the ground there), an edge's middle dragged bends the edge through the cursor (straight within a
//   tenth of a metre of its chord); a click on a wall's line picks the wall. F held raises the picked point's foot, R held
//   leans the wall, C with the wheel steps its height (written as the wheel rests), V turns the picked edge straight or an
//   arc, Delete takes the picked point out (a wall of two points goes with it) or, with none, the picked wall; the arrows
//   nudge the picked point.
//
// Every action is one write and one undo through the tool's own `write` (the track's whole row before and after). A frame
// makes nothing: the walls' places in the game's frame are worked out once a change (and a held edit's at `previewHz`).
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no constructor parameter
// properties. The dev server's alone: reached only through the editor's own dynamic import.

import { WALL_LIMITS, edgeMiddle, edgeSamples, radiusThrough, wallRight, type RaceWall, type WallPoint } from '../race/raceWalls.ts';
import { COURSE_TUNE } from '../race/courseTune.ts';
import type { TrackDef } from '../race/trackFile.ts';
import { projectAt, type MarksView } from '../ui/editorMarks.ts';
import { dragAt, gizmoDrag, gizmoLayout, grabAt, H, type Cursor, type Ray3, type ScreenView } from './gizmo.ts';
import { EDITOR_TUNE } from './editorTune.ts';
import { wallAdded, wallEdgeRadius, wallPointRemoved, wallPointSet, wallRemoved, wallSet, type CourseEdit } from './courseEdit.ts';
import type { ToolFrame } from './tools.ts';

/** What the Walls mode needs of the Course tool. */
export interface WallsOwner {
  /** The picked track as the file holds it, and every track of the file. */
  track(): TrackDef | null;
  tracksNow(): readonly TrackDef[];
  /** One action written (the tool's own `write`). */
  write(label: string, before: TrackDef | null, after: CourseEdit | null): Promise<string>;
  /** Whether a write of the tool's or the editor's is out. */
  busyNow(): boolean;
  /** The ground a point of the raw frame stands on: a drawn road's surface, else the land (NaN for none known). */
  groundY(x: number, z: number): number;
  /** A click off every wall: a course's road picks its track (as the other modes pick). */
  pickRoad(gx: number, gz: number): void;
  toRaw(x: number, z: number, out: { x: number; z: number }): void;
  toGame(x: number, z: number, out: { x: number; z: number }): void;
  say(words: string, ok: boolean): void;
  refresh(): void;
}

/** One wall's places in the game's frame (a change's work): its foot and top lines, its points and its edges' middles. */
interface WallView {
  track: string;
  wall: number;
  picked: boolean;
  /** The foot's and the top's samples, three numbers each, `n` of them. */
  foot: Float64Array;
  top: Float64Array;
  n: number;
  /** Its points and its edges' middles, three numbers each (`m` points, `m - 1` middles). */
  pts: Float64Array;
  mids: Float64Array;
  m: number;
  /** The sample each point stands at (`m` of them): the first, then each edge's end, an arc's samples counted. Made with the view. */
  ks: Int32Array;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

type WallHeld = 'none' | 'point' | 'mid' | 'raise' | 'lean';
const NO_LAYOUT = gizmoLayout();

/** The Walls mode. */
export class CourseWalls {
  private readonly owner: WallsOwner;
  /** The picked wall of the picked track, its point and its edge (an edge's middle), each -1 for none. */
  wall = -1;
  point = -1;
  edge = -1;
  /** The wall being drawn (points of the raw frame), and whether its next edge is an arc. */
  readonly draft: WallPoint[] = [];
  nextArc = false;
  private held: WallHeld = 'none';
  /** What a held edit comes to, shown until its write lands. */
  private live: TrackDef | null = null;
  private liveAt = -Infinity;
  private raise = 0.5;
  private leanBy = 0.5;
  private grabB = 0.5;
  private grabW = 0.5;
  /** C with the wheel: the height's steps not yet written, the wall and the track they were taken on, and when last stepped. */
  private sizeBy = 0.5;
  private sizeAt = -Infinity;
  private sizeWall = -1;
  private sizeOn: TrackDef | null = null;
  private views: WallView[] = [];
  private viewsOf: readonly TrackDef[] | null = null;
  private viewsLive: TrackDef | null = null;
  private viewsPick: string | null = null;
  /** What the views need of the marks' pools: lines, points, handles. */
  lineNeed = 0;
  pointNeed = 0;
  markNeed = 0;
  /** The hover this frame: a handle (its view and index, a middle past `m`) and a wall's line. */
  private hotView = -1;
  private hotIndex = -1;
  private hotK = -1;
  private hotLine = -1;
  private seen: TrackDef | null = null;
  private readonly drag = gizmoDrag();
  private readonly at = { x: 0.5, z: 0.5 };
  private readonly at2 = { x: 0.5, z: 0.5 };
  private readonly pivot = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly pt = new Float64Array(2);
  private readonly p3 = new Float64Array(3);
  /** The draft's points in the game's frame, one more for the aim. */
  private draftG = new Float64Array(12);
  /** The mouse's movement this frame (the tool's own, written before `frame`). */
  dx = 0.5;
  dy = 0.5;
  /** The frame's registers: the hover's running best and a line's nearest. */
  private readonly reg = new Float64Array(2);

  constructor(owner: WallsOwner) {
    this.owner = owner;
    // Fractions as declared (so each field holds a number of its own), nought from the start.
    this.sizeBy = 0;
    this.raise = 0;
    this.leanBy = 0;
    this.dx = 0;
    this.dy = 0;
  }

  /** Whether a held edit or a draft is under way. */
  get busy(): boolean {
    return this.held !== 'none';
  }

  /** Everything let go (a mode, a disarm, the world going). */
  reset(): void {
    this.giveUp();
    this.draft.length = 0;
    this.nextArc = false;
    this.wall = -1;
    this.point = -1;
    this.edge = -1;
    this.sizeBy = 0;
    this.sizeOn = null;
    this.views = [];
    this.viewsOf = null;
  }

  private giveUp(): void {
    this.held = 'none';
    this.live = null;
    this.raise = 0;
    this.leanBy = 0;
  }

  /** The picked wall as the file holds it, or null. */
  private wallOf(t: TrackDef | null): RaceWall | null {
    return t?.walls?.[this.wall] ?? null;
  }

  /**
   * One frame: F and R held, the wheel's steps written as it rests, a drag carried on or let go, a press, and the marks. The
   * press flags are the tool's own (`EditorCourse.overlay`), and the mouse's movement this frame is handed in `dx` and `dy`,
   * fields, since a number handed to a call is a number made.
   */
  frame(f: ToolFrame, view: ScreenView, cur: Cursor, ray: Ray3, press: boolean, release: boolean, pressInverse: boolean, liftUp: boolean, turnUp: boolean): void {
    const dx = this.dx;
    const dy = this.dy;
    const t = this.owner.track();
    if (t !== this.seen) {
      // The file landed another track (a write, an undo, the dev server's word): a pick past its walls let go.
      this.seen = t;
      const w = this.wallOf(t);
      if (!w) {
        this.wall = -1;
        this.point = -1;
        this.edge = -1;
      } else {
        if (this.point >= w.points.length) this.point = -1;
        if (this.edge >= w.points.length - 1) this.edge = -1;
      }
    }
    const busy = this.owner.busyNow();
    if (t && f.lift && !busy && this.point >= 0 && (this.held === 'none' || this.held === 'raise')) {
      if (this.held === 'none') {
        this.held = 'raise';
        this.raise = 0;
      }
      if (dy) this.raise -= (dy * COURSE_TUNE.raiseRate) / 100;
    }
    if (liftUp && this.held === 'raise') this.letGo('a wall point raised', view, cur);
    if (t && f.turn && !busy && this.wall >= 0 && (this.held === 'none' || this.held === 'lean')) {
      if (this.held === 'none') {
        this.held = 'lean';
        this.leanBy = 0;
      }
      this.leanBy += (dx * COURSE_TUNE.bankRate) / 100;
    }
    if (turnUp && this.held === 'lean') this.letGo('a wall leaned', view, cur);
    if (this.sizeBy !== 0) {
      // Given up where the pick left the wall they were taken on or the track's walls were numbered again under them.
      const same = t && this.sizeWall === this.wall && this.sizeOn && (t === this.sizeOn || (t.walls?.length ?? 0) === (this.sizeOn.walls?.length ?? 0));
      if (!same) {
        this.sizeBy = 0;
        this.sizeOn = null;
        this.owner.say("the wheel's height steps given up: the wall they were taken on was let go, or the walls were numbered again", false);
      } else if (f.now - this.sizeAt > 0.4 && this.held === 'none' && !busy) {
        const by = this.sizeBy;
        this.sizeBy = 0;
        this.sizeOn = null;
        const w = this.wallOf(t);
        if (w) void this.owner.write('a wall heightened', t, wallSet(t, this.wall, { high: w.high + by }));
      }
    }
    if (this.held === 'point' || this.held === 'mid') {
      if (f.apply) dragAt(this.drag, NO_LAYOUT, cur, ray);
      else if (release) this.letGo(this.held === 'point' ? 'a wall point moved' : 'a wall edge bent', view, cur);
    } else if (press && !busy) this.pressed(f, view, cur, ray);
    else if (pressInverse && this.draft.length) {
      this.draft.length--;
      this.draftChanged();
      this.owner.say(`${this.draft.length} point${this.draft.length === 1 ? '' : 's'} in the wall being drawn`, true);
    }
    // A held edit's wall shown while held, at `previewHz`.
    if (this.held !== 'none' && t && f.now - this.liveAt >= 1 / Math.max(1, COURSE_TUNE.previewHz)) {
      this.liveAt = f.now;
      const e = this.heldEdit(t, cur);
      if (e && typeof e !== 'string') this.live = e;
    }
  }

  /** What a held edit comes to now (never written here), or null. */
  private heldEdit(t: TrackDef, cur: Cursor): CourseEdit | null {
    const w = this.wallOf(t);
    if (!w) return null;
    const h = this.held;
    if (h === 'raise') {
      const p = w.points[this.point];
      return p && this.raise !== 0 ? wallPointSet(t, this.wall, this.point, { y: p.y + this.raise }) : null;
    }
    if (h === 'lean') return this.leanBy !== 0 ? wallSet(t, this.wall, { lean: w.lean + this.leanBy }) : null;
    const at = this.at;
    this.owner.toRaw(this.drag.gx + this.drag.mx, this.drag.gz + this.drag.mz, at);
    if (h === 'point') {
      const x = at.x + this.grabB;
      const z = at.z + this.grabW;
      const y = this.owner.groundY(x, z);
      return wallPointSet(t, this.wall, this.point, Number.isFinite(y) ? { x, z, y } : { x, z });
    }
    if (h === 'mid') {
      // Bent through the cursor, in the game's frame (an arc's right is the game's, as the walls are built).
      const a = w.points[this.edge];
      const b = w.points[this.edge + 1];
      if (!a || !b) return null;
      const ga = this.at2;
      this.owner.toGame(a.x, a.z, ga);
      const ax = ga.x;
      const az = ga.z;
      this.owner.toGame(b.x, b.z, ga);
      return wallEdgeRadius(t, this.wall, this.edge, radiusThrough(ax, az, ga.x, ga.z, this.drag.gx + this.drag.mx, this.drag.gz + this.drag.mz));
    }
    void cur;
    return null;
  }

  /** Whether a drag let go where it was grabbed (within the editor's click reach on the screen): a click, which only picks. */
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

  /** A held edit let go: written as one action (nothing where it moved nothing, or a drag let go where it was grabbed). */
  private letGo(label: string, view: ScreenView, cur: Cursor): void {
    const t = this.owner.track();
    const drag = this.held === 'point' || this.held === 'mid';
    let e: CourseEdit | null = t && !(drag && this.stillAt(view, cur)) ? this.heldEdit(t, cur) : null;
    if (t && e && typeof e !== 'string' && JSON.stringify(e) === JSON.stringify(t)) e = null;
    this.held = 'none';
    this.raise = 0;
    this.leanBy = 0;
    if (!t || !e) {
      this.live = null;
      return;
    }
    if (typeof e !== 'string') this.live = e;
    void this.owner.write(label, t, e).finally(() => {
      this.live = null;
    });
  }

  /** A press: a handle grabbed, a wall picked by its line, a road's track picked, or the draft's click. */
  private pressed(f: ToolFrame, view: ScreenView, cur: Cursor, ray: Ray3): void {
    if (f.sampled) return;
    const t = this.owner.track();
    if (t && this.hotView >= 0) {
      const v = this.viewsNow()[this.hotView];
      const w = v ? (t.walls?.[v.wall] ?? null) : null;
      if (v && w) {
        this.wall = v.wall;
        const mid = this.hotIndex >= v.m;
        const j = mid ? this.hotIndex - v.m : this.hotIndex;
        this.point = mid ? -1 : j;
        this.edge = mid ? j : -1;
        const arr = mid ? v.mids : v.pts;
        this.pivot.x = arr[j * 3];
        this.pivot.y = arr[j * 3 + 1];
        this.pivot.z = arr[j * 3 + 2];
        if (grabAt(this.drag, NO_LAYOUT, H.ground, view, this.pivot, cur, ray)) {
          if (!mid) {
            this.owner.toRaw(this.drag.gx, this.drag.gz, this.at);
            this.grabB = w.points[j].x - this.at.x;
            this.grabW = w.points[j].z - this.at.z;
          }
          this.held = mid ? 'mid' : 'point';
        }
        this.owner.say(`${w.name}: ${mid ? `edge ${j} (drag its middle to bend it, V straight or an arc)` : `point ${j} (drag it, F raises its foot, Delete takes it out)`}; R leans the wall, C with the wheel its height`, true);
        this.owner.refresh();
        return;
      }
    }
    if (t && this.hotLine >= 0) {
      this.wall = this.hotLine;
      this.point = -1;
      this.edge = -1;
      this.owner.say(`${t.walls![this.wall].name} picked: R leans it, C with the wheel its height, Delete takes it out`, true);
      this.owner.refresh();
      return;
    }
    if (!f.valid) return;
    if (!t) {
      this.owner.pickRoad(f.x, f.z);
      if (!this.owner.track()) this.owner.say("pick a track first: a click on its road, or Pick on the Tools tab's list", false);
      return;
    }
    if (!this.draft.length && (this.wall >= 0 || this.point >= 0)) {
      // A click off every wall lets the pick go; the next begins a wall.
      this.wall = -1;
      this.point = -1;
      this.edge = -1;
      this.owner.refresh();
      return;
    }
    this.click(f.x, f.z);
  }

  /** A click of the wall being drawn (a point of the game's frame): a point added, or the wall written (near its last point). */
  click(gx: number, gz: number): void {
    const d = this.draft;
    this.owner.toRaw(gx, gz, this.at);
    const x = this.at.x;
    const z = this.at.z;
    if (d.length >= 2 && Math.hypot(x - d[d.length - 1].x, z - d[d.length - 1].z) <= COURSE_TUNE.closeReach) {
      void this.finish();
      return;
    }
    const y = this.owner.groundY(x, z);
    if (!Number.isFinite(y)) {
      this.owner.say('the ground under that point is not known yet: fly nearer', false);
      return;
    }
    if (d.length && this.nextArc) {
      // The edge just drawn an arc as gentle as its chord is long, bulging to its right.
      const a = d[d.length - 1];
      d[d.length - 1] = { ...a, r: Math.round(Math.hypot(x - a.x, z - a.z) * 100) / 100 };
    }
    d.push({ x, y, z });
    this.draftChanged();
    this.owner.say(`${d.length} point${d.length === 1 ? '' : 's'} in the wall being drawn${d.length >= 2 ? ' (a click near the last writes it)' : ''}`, true);
  }

  /** The wall being drawn written onto the picked track (Finish the wall, a click near its last point). */
  async finish(): Promise<string> {
    const t = this.owner.track();
    if (!t) return this.said('pick a track first', false);
    if (this.draft.length < 2) return this.said('a wall is two points at least', false);
    const n = t.walls?.length ?? 0;
    const wall: RaceWall = { name: `Wall ${n + 1}`, high: COURSE_TUNE.newWallHigh, lean: COURSE_TUNE.newWallLean, points: this.draft.map((p) => ({ ...p })) };
    this.draft.length = 0;
    this.nextArc = false;
    this.draftChanged();
    const said = await this.owner.write(`${wall.name} drawn on ${t.name}`, t, wallAdded(t, wall));
    const now = this.owner.track();
    if (now && (now.walls?.length ?? 0) === n + 1) {
      this.wall = n;
      this.point = -1;
      this.edge = -1;
    }
    return said;
  }

  private said(words: string, ok: boolean): string {
    this.owner.say(words, ok);
    return words;
  }

  /** V: the edge being drawn, or the picked edge, turned between straight and an arc. Answers whether it took it. */
  toggle(): boolean {
    const t = this.owner.track();
    if (this.draft.length) {
      this.nextArc = !this.nextArc;
      this.owner.say(`the edge being drawn: ${this.nextArc ? 'an arc' : 'straight'}`, true);
      return true;
    }
    const w = this.wallOf(t);
    if (!t || !w || this.edge < 0) return false;
    const a = w.points[this.edge];
    const b = w.points[this.edge + 1];
    if (!a || !b) return false;
    const r = a.r !== undefined ? undefined : Math.round(Math.hypot(b.x - a.x, b.z - a.z) * 100) / 100;
    void this.owner.write(r === undefined ? 'a wall edge straightened' : 'a wall edge made an arc', t, wallEdgeRadius(t, this.wall, this.edge, r));
    return true;
  }

  /** C held with the wheel: the picked wall's height stepped, written a moment after the wheel rests. */
  size(notches: number, now: number): string | null {
    const t = this.owner.track();
    const w = this.wallOf(t);
    if (!t || !w) return null;
    if (this.sizeBy === 0) this.sizeOn = t;
    this.sizeWall = this.wall;
    this.sizeAt = now;
    this.sizeBy += notches * COURSE_TUNE.wallHighStep;
    return `${w.name} ${Math.max(0.5, w.high + this.sizeBy).toFixed(2)} m high (written as the wheel rests)`;
  }

  /** Delete: the picked point taken out (a wall of two points goes with it), or the picked wall. Answers whether it took the key. */
  deleteKey(): boolean {
    const t = this.owner.track();
    const w = this.wallOf(t);
    if (!t || !w) return false;
    if (this.point >= 0) {
      const j = this.point;
      const i = this.wall;
      this.point = -1;
      // A wall of the least points goes whole, and the next wall moves into its index: nothing stays picked.
      if (w.points.length <= WALL_LIMITS.pointsLeast) {
        this.wall = -1;
        this.edge = -1;
      }
      void this.owner.write(`${w.name}'s point ${j} taken out`, t, wallPointRemoved(t, i, j));
      return true;
    }
    const i = this.wall;
    this.wall = -1;
    this.edge = -1;
    void this.owner.write(`${w.name} taken out`, t, wallRemoved(t, i));
    return true;
  }

  /** Escape: a held edit, the draft, a point or edge, then the wall let go, in that order. Answers whether it took the key. */
  escape(): boolean {
    if (this.held !== 'none') {
      this.giveUp();
      this.owner.say('the edit given up: nothing written', true);
      return true;
    }
    if (this.draft.length) {
      this.draft.length = 0;
      this.draftChanged();
      this.owner.say('the wall being drawn given up', true);
      return true;
    }
    if (this.point >= 0 || this.edge >= 0 || this.wall >= 0) {
      if (this.point >= 0 || this.edge >= 0) {
        this.point = -1;
        this.edge = -1;
      } else this.wall = -1;
      this.owner.refresh();
      return true;
    }
    return false;
  }

  /** Whether the arrows and Page Up and Down are its own: a point picked. */
  claimsKeys(): boolean {
    return this.point >= 0;
  }

  /** Whether F or R held takes the mouse: a point picked to raise, a wall picked to lean. */
  holdsMouse(lift: boolean, turn: boolean): boolean {
    return (lift && this.point >= 0) || (turn && this.wall >= 0);
  }

  /** The picked point nudged by metres of the game's frame (one write; x mirrored into the raw frame). */
  nudge(dx: number, dy: number, dz: number): void {
    const t = this.owner.track();
    const p = this.wallOf(t)?.points[this.point];
    if (!t || !p || this.owner.busyNow()) return;
    void this.owner.write('a wall point nudged', t, wallPointSet(t, this.wall, this.point, { x: p.x - dx, z: p.z + dz, y: p.y + dy }));
  }

  // ---- The marks. ----

  /** The walls' views, made again when the file's tracks, the held edit or the picked track is another. */
  private viewsNow(): readonly WallView[] {
    const tracks = this.owner.tracksNow();
    const pick = this.owner.track()?.id ?? null;
    if (tracks === this.viewsOf && this.live === this.viewsLive && pick === this.viewsPick) return this.views;
    this.viewsOf = tracks;
    this.viewsLive = this.live;
    this.viewsPick = pick;
    const out: WallView[] = [];
    let lines = 0;
    let points = 0;
    let marks = 0;
    const g = { x: 0, z: 0 };
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    const r = { x: 0, z: 0 };
    for (const t0 of tracks) {
      const t = this.live && this.live.id === t0.id ? this.live : t0;
      const ws = t.walls ?? [];
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i];
        xs.length = 0;
        ys.length = 0;
        zs.length = 0;
        const m = w.points.length;
        const pts = new Float64Array(m * 3);
        const mids = new Float64Array(Math.max(0, m - 1) * 3);
        const ks = new Int32Array(m);
        for (let j = 0; j < m; j++) {
          const p = w.points[j];
          this.owner.toGame(p.x, p.z, g);
          pts[j * 3] = g.x;
          pts[j * 3 + 1] = p.y + 0.05;
          pts[j * 3 + 2] = g.z;
          if (j + 1 < m) {
            const q = w.points[j + 1];
            const ax = g.x;
            const az = g.z;
            this.owner.toGame(q.x, q.z, g);
            edgeSamples(ax, p.y, az, g.x, q.y, g.z, p.r, COURSE_TUNE.arcStep, j > 0, xs, ys, zs);
            // The edge's last sample is the next point's.
            ks[j + 1] = xs.length - 1;
            edgeMiddle(ax, az, g.x, g.z, p.r, this.at2);
            mids[j * 3] = this.at2.x;
            mids[j * 3 + 1] = (p.y + q.y) / 2 + 0.05;
            mids[j * 3 + 2] = this.at2.z;
          }
        }
        const n = xs.length;
        const foot = new Float64Array(n * 3);
        const top = new Float64Array(n * 3);
        const reach = Math.tan((w.lean * Math.PI) / 180) * w.high;
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (let k = 0; k < n; k++) {
          // The top moved along the wall's right at each sample (the mean of the edges either side of it).
          const ka = k > 0 ? k - 1 : k;
          const kb = k + 1 < n ? k + 1 : k;
          wallRight(xs[kb] - xs[ka], zs[kb] - zs[ka], r);
          foot[k * 3] = xs[k];
          foot[k * 3 + 1] = ys[k] + 0.05;
          foot[k * 3 + 2] = zs[k];
          top[k * 3] = xs[k] + r.x * reach;
          top[k * 3 + 1] = ys[k] + w.high;
          top[k * 3 + 2] = zs[k] + r.z * reach;
          minX = Math.min(minX, xs[k], top[k * 3]);
          maxX = Math.max(maxX, xs[k], top[k * 3]);
          minZ = Math.min(minZ, zs[k], top[k * 3 + 2]);
          maxZ = Math.max(maxZ, zs[k], top[k * 3 + 2]);
        }
        const picked = t.id === pick;
        out.push({ track: t.id, wall: i, picked, foot, top, n, pts, mids, m, ks, minX, maxX, minZ, maxZ });
        // Its foot and top, and a post at each point.
        lines += 2 + m;
        points += 2 * n + 2 * m;
        if (picked) marks += m + Math.max(0, m - 1);
      }
    }
    this.views = out;
    this.lineNeed = lines + 1;
    this.pointNeed = points + this.draft.length + 2;
    this.markNeed = marks;
    return out;
  }

  /** Whether the views are another list than the pools were sized for (the tool asks before it sizes them). */
  need(): void {
    this.viewsNow();
    this.pointNeed = this.pointNeed > this.draft.length + 2 ? this.pointNeed : this.draft.length + 2;
  }

  /**
   * The walls near the eye drawn into the course pools after the courses (`counts` the lines, points and handles written so
   * far, carried on): every wall's foot and top as a lit strip with a post at each point (style 10, the picked track's 11,
   * its picked wall 13), the picked track's points (diamonds) and edges' middles (squares), the wall being drawn (12) to the
   * aim. The hover is worked out here from the projected handles and lines. Nothing is made but on a change of the views.
   */
  draw(m: MarksView, view: ScreenView, cur: Cursor, f: ToolFrame, counts: Int32Array): void {
    const views = this.viewsNow();
    let L = counts[0];
    let P = counts[1];
    let K = counts[2];
    const reach = COURSE_TUNE.drawReach;
    const ex = view.ex;
    const ez = view.ez;
    const R = this.reg;
    R[0] = COURSE_TUNE.hitPx;
    this.hotView = -1;
    this.hotIndex = -1;
    this.hotK = -1;
    this.hotLine = -1;
    for (let vi = 0; vi < views.length; vi++) {
      const v = views[vi];
      const dx = ex < v.minX ? v.minX - ex : ex > v.maxX ? ex - v.maxX : 0;
      const dz = ez < v.minZ ? v.minZ - ez : ez > v.maxZ ? ez - v.maxZ : 0;
      if (dx * dx + dz * dz > reach * reach) continue;
      const pickedWall = v.picked && v.wall === this.wall;
      const style = pickedWall ? 13 : v.picked ? 11 : 10;
      const footStart = P;
      for (let s = 0; s < 2; s++) {
        const arr = s === 0 ? v.foot : v.top;
        const start = P;
        for (let i = 0; i < v.n; i++) {
          m.courseVis[P] = projectAt(arr, i * 3, view.vp, view.w, view.h, this.pt) ? 1 : 0;
          m.coursePts[P * 2] = this.pt[0];
          m.coursePts[P * 2 + 1] = this.pt[1];
          P++;
        }
        m.courseSpans[L] = P - start;
        m.courseStyle[L] = style;
        L++;
      }
      // The picked track's walls are picked by a click near their foot line on the screen.
      if (v.picked) {
        R[1] = 1e30;
        for (let i = 0; i + 1 < v.n; i++) if (m.courseVis[footStart + i] && m.courseVis[footStart + i + 1]) this.lineNear(m.coursePts, footStart + i, footStart + i + 1, cur);
        if (R[1] < R[0]) {
          R[0] = R[1];
          this.hotLine = v.wall;
        }
      }
      // A post at each point: its foot to its top (the top at the point's own sample, the first and every edge's end).
      for (let j = 0; j < v.m; j++) {
        const s = P;
        const k = v.ks[j];
        for (let e = 0; e < 2; e++) {
          m.courseVis[P] = projectAt(e === 0 ? v.foot : v.top, k * 3, view.vp, view.w, view.h, this.pt) ? 1 : 0;
          m.coursePts[P * 2] = this.pt[0];
          m.coursePts[P * 2 + 1] = this.pt[1];
          P++;
        }
        m.courseSpans[L] = P - s;
        m.courseStyle[L] = style;
        L++;
      }
      if (!v.picked) continue;
      // The handles: its points and its edges' middles.
      for (let h = 0; h < v.m * 2 - 1; h++) {
        const mid = h >= v.m;
        const j = mid ? h - v.m : h;
        const vis = projectAt(mid ? v.mids : v.pts, j * 3, view.vp, view.w, view.h, this.pt);
        m.courseMarkVis[K] = vis ? 1 : 0;
        m.courseMarkPts[K * 2] = this.pt[0];
        m.courseMarkPts[K * 2 + 1] = this.pt[1];
        m.courseMarkKind[K] = mid ? 1 : 0;
        m.courseMarkState[K] = pickedWall && ((mid && j === this.edge) || (!mid && j === this.point)) ? 2 : 0;
        if (vis) {
          const hx = this.pt[0] - cur.x;
          const hy = this.pt[1] - cur.y;
          const dd = Math.sqrt(hx * hx + hy * hy);
          // A handle wins over the line it stands on.
          if (dd < R[0] || (this.hotLine >= 0 && dd < COURSE_TUNE.hitPx)) {
            R[0] = dd;
            this.hotView = vi;
            this.hotIndex = h;
            this.hotK = K;
            this.hotLine = -1;
          }
        }
        K++;
      }
    }
    if (this.hotView >= 0 && m.courseMarkState[this.hotK] !== 2) m.courseMarkState[this.hotK] = 1;
    // The wall being drawn, to the aim.
    const dn = this.draft.length;
    if (dn) {
      const s = P;
      for (let i = 0; i < dn; i++) {
        m.courseVis[P] = projectAt(this.draftG, i * 3, view.vp, view.w, view.h, this.pt) ? 1 : 0;
        m.coursePts[P * 2] = this.pt[0];
        m.coursePts[P * 2 + 1] = this.pt[1];
        P++;
      }
      if (f.valid) {
        this.draftG[dn * 3] = f.x;
        this.draftG[dn * 3 + 1] = f.y;
        this.draftG[dn * 3 + 2] = f.z;
        m.courseVis[P] = projectAt(this.draftG, dn * 3, view.vp, view.w, view.h, this.pt) ? 1 : 0;
        m.coursePts[P * 2] = this.pt[0];
        m.coursePts[P * 2 + 1] = this.pt[1];
        P++;
      }
      m.courseSpans[L] = P - s;
      m.courseStyle[L] = 12;
      L++;
    }
    counts[0] = L;
    counts[1] = P;
    counts[2] = K;
  }

  /** The cursor's distance on the screen to the segment between points `a` and `b` of `pts`, into `reg[1]` where nearer. */
  private lineNear(pts: Float64Array, a: number, b: number, cur: Cursor): void {
    const ax = pts[a * 2];
    const ay = pts[a * 2 + 1];
    const dx = pts[b * 2] - ax;
    const dy = pts[b * 2 + 1] - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((cur.x - ax) * dx + (cur.y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - cur.x;
    const py = ay + dy * t - cur.y;
    const d = Math.sqrt(px * px + py * py);
    if (d < this.reg[1]) this.reg[1] = d;
  }

  /** The draft's points in the game's frame (a change's work). */
  private draftChanged(): void {
    const dn = this.draft.length;
    if (this.draftG.length < (dn + 1) * 3) this.draftG = new Float64Array((dn + 1) * 6);
    for (let i = 0; i < dn; i++) {
      const q = this.draft[i];
      this.owner.toGame(q.x, q.z, this.at);
      this.draftG[i * 3] = this.at.x;
      this.draftG[i * 3 + 1] = q.y;
      this.draftG[i * 3 + 2] = this.at.z;
    }
    this.viewsOf = null;
  }

  /** What the bar and the console say of the mode. */
  report(): Record<string, unknown> {
    const t = this.owner.track();
    return { wall: this.wall, point: this.point, edge: this.edge, draft: this.draft.length, nextArc: this.nextArc, held: this.held, walls: t?.walls?.length ?? 0, views: this.views.length };
  }

  /** The picked wall's line for the Selected tab, or null. */
  picked(): { track: TrackDef; wall: RaceWall; index: number } | null {
    const t = this.owner.track();
    const w = this.wallOf(t);
    return t && w ? { track: t, wall: w, index: this.wall } : null;
  }
}
