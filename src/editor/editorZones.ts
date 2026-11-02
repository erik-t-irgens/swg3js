// The world editor's no-spawn zone tool (Map-maker II's twelfth wave, DESIGN.md §2.13): where nothing of the world's own life
// stands -- no lair, herd or camp, no person of the data's or the owner's own, no person of ours -- drawn as a circle (a
// click; C with the wheel sizes the next), a rectangle (a drag) or an outline (clicks), or made "from a place" of ours (its
// shape copied, the two files kept apart), and written into the world's removal file (`public/placements/removed/<world>.json`,
// its `z:` rows) in the file's frame. A Tools-list entry with no key of its own (armed from the Tools tab or the console).
//
// **A zone picked** (a click on its ring at its middle, the Here tab's Pick up) moves with the gizmo's ground square, C held with
// the wheel grows or shrinks it about its middle, Delete takes it up, Escape lets it go; its name and what it keeps are the
// Selected tab's. Every change is one write and one undo entry. **No-spawn, not no-enter**: a creature from outside may chase
// somebody in.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties. The dev server's alone: reached only through the editor's own dynamic import.

import { centimetres, movedShape, scaledShape, shapePoints } from './editorPlaces.ts';
import { shapeMiddle, type LocationRow, type LocationShape } from '../world/editFiles/locationsFile.ts';
import { ZONE_KEEPS, readZoneShape, zoneKeeps, type RemovalRow, type ZoneKeep, type ZoneShapeRow } from '../story/removals.ts';
import { unzoneChange, zoneChange, zoneSetChange, type RemovalChange } from '../world/removalEdits.ts';
import { cursor, dragAt, gizmoDrag, gizmoLayout, grabAt, H, layoutGizmo, pickAt, ray3, rayAt, worldAxes, type ScreenView } from './gizmo.ts';
import { lakePools, projectAt, projectPoint } from '../ui/editorMarks.ts';
import type { EditorEdits } from './editorEdit.ts';
import type { RowChange } from './undo.ts';
import type { EditRow } from '../world/placementEdits.ts';
import type { ToolDef, ToolDraw, ToolFrame } from './tools.ts';
import type { EditorSection } from '../ui/editorWindow.ts';

/**
 * The zone tool's numbers (ours): `radius` is a zone's default size -- a lair's site and its herd's spread with room to spare,
 * a feel number the owner moves -- and the rest the places tool's own, for a hand that works alike. Live through
 * `__debug.editor({ tune: { zone } })` and the debug menu's `editor` sliders.
 */
export const ZONE_TOOL_TUNE = {
  mode: 'circle' as 'circle' | 'rect' | 'outline',
  radius: 60,
  sizeStep: 1.15,
  sizeRest: 0.6,
  rectLeast: 2,
  closePx: 14,
  hitPx: 14,
  circlePoints: 48,
  /** What a new zone keeps away: all three of `wild`, `people` and `ours` unless set (`keeps` absent means all three). */
  keeps: ['wild', 'people', 'ours'] as ZoneKeep[],
};

/** What the zone tool needs of the editor and the game. */
export interface ZonesHost {
  readonly edits: EditorEdits;
  worldKind(): 'ground' | 'space' | 'copies';
  /** The removal file's rows in force. */
  rows(): readonly RemovalRow[];
  /** The places of ours on this world (for "from a place"). */
  locations(): readonly LocationRow[];
  toRaw(x: number, z: number, out: { x: number; z: number }): void;
  toGame(x: number, z: number, out: { x: number; z: number }): void;
  groundAt(x: number, z: number): number;
  groundCached(x: number, z: number, out: { y: number }): boolean;
  /** How many of the wildlife's sites a zone keeps off (by id), for the lists. */
  keptOff(id: string): number | null;
  /** The eye flown over a point of the game's frame and back from it by `reach`, looking down at it (the Here tab's Go to). */
  goTo(x: number, z: number, reach: number): void;
  say(words: string, ok: boolean): void;
}

interface Outline {
  id: string;
  n: number;
  pts: Float64Array;
  ys: Float64Array;
  cx: number;
  cy: number;
  cz: number;
}

function cm(v: number): number {
  return Math.round(v * 100) / 100;
}

/** The zone tool. */
export class EditorZones {
  armed = false;
  picked: string | null = null;
  private readonly host: ZonesHost;
  private dxz = new Float64Array(12);
  draftN = 0;
  private rectOn = false;
  private rectX = 0.5;
  private rectY = 0.5;
  private rectZ = 0.5;
  private dragging = false;
  private dragX = 0.5;
  private dragZ = 0.5;
  private scale = 1;
  private scaleAt = Number.NaN;
  private writing: Promise<string> | null = null;
  private wasApply = false;
  private wasInverse = false;
  private readonly f: ToolFrame = { apply: false, inverse: false, shift: false, sampled: false, x: 0.5, y: 0.5, z: 0.5, valid: false, dt: 0.016, now: 0.5, sx: 0.5, sy: 0.5, dy: 0.5, lift: false };
  private outlines: Outline[] = [];
  private rowsSeen: readonly RemovalRow[] | null = null;
  private readonly layout = gizmoLayout();
  private readonly drag = gizmoDrag();
  private readonly axes = worldAxes();
  private readonly cur = cursor();
  private readonly ray = ray3();
  private readonly pivot = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly pt = new Float64Array(2);
  private readonly at = { x: 0.5, z: 0.5 };
  private readonly ground = { y: 0.5 };
  private dq = new Float64Array(24);
  /** One point being projected (`projectAt`), kept. */
  private readonly pq = new Float64Array(3);
  last = '';

  constructor(host: ZonesHost) {
    this.host = host;
  }

  get busy(): boolean {
    return !!this.writing || this.dragging || this.rectOn || this.scale !== 1;
  }

  refusal(): string | null {
    if (this.host.worldKind() === 'space') return "a space zone's no-spawn zones keep nothing this pass (space maps are a later pass)";
    return null;
  }

  async arm(): Promise<string> {
    const no = this.refusal();
    if (no) return this.said(no, false);
    this.armed = true;
    return this.said(`the zone tool: ${this.modeWords()} (a click on a zone's ring picks it; the Tools tab lets go)`, true);
  }

  disarm(): void {
    this.armed = false;
    this.giveUp();
  }

  worldGone(): void {
    this.disarm();
    this.picked = null;
    this.draftN = 0;
    this.outlines = [];
    this.rowsSeen = null;
  }

  private giveUp(): void {
    this.dragging = false;
    this.dragX = 0;
    this.dragZ = 0;
    this.rectOn = false;
    this.scale = 1;
    this.scaleAt = Number.NaN;
  }

  private modeWords(): string {
    const m = ZONE_TOOL_TUNE.mode;
    return m === 'circle' ? `a zone by a click, ${Math.round(ZONE_TOOL_TUNE.radius)} m round (C with the wheel sizes it)` : m === 'rect' ? 'a zone by a drag' : 'a zone by clicks (near the first closes it, RMB takes one back)';
  }

  escape(): boolean {
    if (this.dragging || this.rectOn || this.scale !== 1) {
      this.giveUp();
      return true;
    }
    if (this.draftN) {
      this.draftN = 0;
      return true;
    }
    if (this.picked) {
      this.picked = null;
      return true;
    }
    return false;
  }

  step(f: ToolFrame): void {
    const k = this.f;
    k.apply = f.apply;
    k.inverse = f.inverse;
    k.shift = f.shift;
    k.sampled = f.sampled;
    k.x = f.x;
    k.y = f.y;
    k.z = f.z;
    k.valid = f.valid;
    k.dt = f.dt;
    k.now = f.now;
    k.sx = f.sx;
    k.sy = f.sy;
    k.dy = f.dy;
    k.lift = f.lift;
  }

  draw(d: ToolDraw): void {
    if (!this.armed || ZONE_TOOL_TUNE.mode !== 'circle' || this.dragging || this.picked) return;
    d.radius = ZONE_TOOL_TUNE.radius;
    d.ring(0);
  }

  size(notches: number): string | null {
    const step = Math.pow(ZONE_TOOL_TUNE.sizeStep, notches);
    if (this.picked) {
      this.scale *= step;
      this.scaleAt = this.f.now;
      return `${this.picked} at ${Math.round(this.scale * 100)}% (written as the wheel rests)`;
    }
    ZONE_TOOL_TUNE.radius = Math.min(50000, Math.max(1, ZONE_TOOL_TUNE.radius * step));
    return `a zone ${ZONE_TOOL_TUNE.radius.toFixed(0)} m round`;
  }

  deleteKey(): boolean {
    if (!this.armed || !this.picked) return false;
    void this.remove(this.picked);
    return true;
  }

  /** The zones of the file. */
  zoneRows(): RemovalRow[] {
    return this.host.rows().filter((r) => r.id.startsWith('z:') && !!r.shape);
  }

  /**
   * The zones' outlines in the game's frame, made again only when the file's rows are another list. The frame's question
   * holds no closure: a function with an inner closure over `this` makes its context on every call, early return or not (a
   * rectangle's drag measured 19 bytes a frame so), so the making is a method of its own.
   */
  private outlinesNow(): Outline[] {
    const rows = this.host.rows();
    if (rows === this.rowsSeen) return this.outlines;
    return this.makeOutlines(rows);
  }

  private makeOutlines(rows: readonly RemovalRow[]): Outline[] {
    this.rowsSeen = rows;
    const out: Outline[] = [];
    const host = this.host;
    for (const r of rows) {
      if (!r.id.startsWith('z:') || !r.shape) continue;
      const raw = shapePoints(r.shape as LocationShape, ZONE_TOOL_TUNE.circlePoints);
      const n = raw.length;
      const pts = new Float64Array(n * 2);
      const ys = new Float64Array(n);
      const m = shapeMiddle(r.shape as LocationShape);
      host.toGame(m.x, m.z, this.at);
      const cx = this.at.x;
      const cz = this.at.z;
      const g = host.groundAt(cx, cz);
      const cy = Number.isFinite(g) ? g : 0;
      for (let i = 0; i < n; i++) {
        host.toGame(raw[i][0], raw[i][1], this.at);
        pts[i * 2] = this.at.x;
        pts[i * 2 + 1] = this.at.z;
        ys[i] = host.groundCached(this.at.x, this.at.z, this.ground) ? this.ground.y : cy;
      }
      out.push({ id: r.id, n, pts, ys, cx, cy, cz });
    }
    this.outlines = out;
    if (this.picked && !rows.some((r) => r.id === this.picked)) this.picked = null;
    return out;
  }

  overlay(d: ToolDraw, view: ScreenView): void {
    const f = this.f;
    const m = d.marks;
    m.lakesOn = false;
    m.draftOn = false;
    if (!this.armed) return;
    const outlines = this.outlinesNow();
    const press = f.apply && !this.wasApply;
    const release = !f.apply && this.wasApply;
    const pressInverse = f.inverse && !this.wasInverse;
    this.wasApply = f.apply;
    this.wasInverse = f.inverse;
    this.cur.x = f.sx;
    this.cur.y = f.sy;
    rayAt(view, this.cur, this.ray);
    let picked: Outline | null = null;
    for (let i = 0; i < outlines.length; i++) if (outlines[i].id === this.picked) picked = outlines[i];
    const L = this.layout;
    L.on = false;
    if (picked) {
      this.pivot.x = picked.cx + (this.dragging ? this.dragX : 0);
      this.pivot.y = picked.cy;
      this.pivot.z = picked.cz + (this.dragging ? this.dragZ : 0);
      for (let i = 0; i < L.shown.length; i++) L.shown[i] = false;
      L.shown[H.ground] = true;
      layoutGizmo(view, this.pivot, this.axes, 90, L);
      if (!this.dragging) pickAt(L, this.cur, ZONE_TOOL_TUNE.hitPx);
    }
    if (this.scale !== 1 && f.now - this.scaleAt >= ZONE_TOOL_TUNE.sizeRest && !this.writing) {
      const s = this.scale;
      this.scale = 1;
      this.scaleAt = Number.NaN;
      if (picked && Math.abs(s - 1) > 1e-4) void this.scaleZone(picked.id, s);
    }
    if (this.dragging) {
      if (f.apply) {
        if (dragAt(this.drag, L, this.cur, this.ray)) {
          this.dragX = this.drag.mx;
          this.dragZ = this.drag.mz;
        }
      } else if (release) {
        const dx = this.dragX;
        const dz = this.dragZ;
        this.giveUp();
        if (picked && Math.sqrt(dx * dx + dz * dz) >= 0.01) void this.moveZone(picked.id, dx, dz);
      }
    } else if (this.rectOn) {
      if (pressInverse) this.rectOn = false;
      else if (release) {
        this.rectOn = false;
        if (f.valid) void this.writeRect(this.rectX, this.rectZ, f.x, f.z);
      }
    } else if (press && !this.writing) this.pressed(outlines, picked, view);
    else if (pressInverse && ZONE_TOOL_TUNE.mode === 'outline' && this.draftN) this.draftN--;
    this.drawMarks(d, view, outlines, picked);
  }

  private pressed(outlines: Outline[], picked: Outline | null, view: ScreenView): void {
    const f = this.f;
    if (f.sampled) return;
    const L = this.layout;
    if (picked && L.on && L.hot === H.ground && grabAt(this.drag, L, H.ground, view, this.pivot, this.cur, this.ray)) {
      this.dragging = true;
      this.dragX = 0;
      this.dragZ = 0;
      return;
    }
    let hit: Outline | null = null;
    let bestD = ZONE_TOOL_TUNE.hitPx;
    for (const o of outlines) {
      if (!projectPoint(o.cx, o.cy, o.cz, view.vp, view.w, view.h, this.pt)) continue;
      const dd = Math.hypot(this.pt[0] - this.cur.x, this.pt[1] - this.cur.y);
      if (dd <= bestD) {
        bestD = dd;
        hit = o;
      }
    }
    if (hit) {
      this.picked = hit.id;
      this.said(`picked ${hit.id}: drag its square, C with the wheel sizes it, Delete takes it up, Escape lets it go`, true);
      return;
    }
    if (this.picked) {
      this.picked = null;
      return;
    }
    if (!f.valid) return;
    const mode = ZONE_TOOL_TUNE.mode;
    if (mode === 'circle') void this.writeCircle(f.x, f.z, ZONE_TOOL_TUNE.radius);
    else if (mode === 'rect') {
      this.rectOn = true;
      this.rectX = f.x;
      this.rectY = f.y;
      this.rectZ = f.z;
    } else this.clickPoint(f.x, f.y, f.z, view);
  }

  clickPoint(x: number, y: number, z: number, view: ScreenView | null): void {
    const n = this.draftN;
    if (n >= 3 && view && projectPoint(this.dxz[0], this.dxz[2], this.dxz[1], view.vp, view.w, view.h, this.pt)) {
      if (Math.hypot(this.pt[0] - this.cur.x, this.pt[1] - this.cur.y) <= ZONE_TOOL_TUNE.closePx) {
        void this.closeDraft();
        return;
      }
    }
    if (this.dxz.length < (n + 1) * 3) {
      const grown = new Float64Array((n + 1) * 6);
      grown.set(this.dxz);
      this.dxz = grown;
    }
    this.dxz[n * 3] = x;
    this.dxz[n * 3 + 1] = z;
    this.dxz[n * 3 + 2] = y;
    this.draftN = n + 1;
  }

  async closeDraft(): Promise<string> {
    const n = this.draftN;
    if (n < 3) return this.said('an outline has three points at least', false);
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) pts.push([this.dxz[i * 3], this.dxz[i * 3 + 1]]);
    this.draftN = 0;
    return this.writeOutline(pts);
  }

  writeCircle(x: number, z: number, r: number, name: string | null = null): Promise<string> {
    this.host.toRaw(x, z, this.at);
    return this.writeZone({ kind: 'circle', c: [cm(this.at.x), cm(this.at.z)], r: cm(r) }, name, 'a circle');
  }

  writeRect(x0: number, z0: number, x1: number, z1: number, name: string | null = null): Promise<string> {
    const least = ZONE_TOOL_TUNE.rectLeast;
    if (Math.abs(x1 - x0) < least || Math.abs(z1 - z0) < least) return Promise.resolve(this.said(`a rectangle is ${least} m across at least either way: nothing written`, false));
    this.host.toRaw(x0, z0, this.at);
    const ax = cm(this.at.x);
    const az = cm(this.at.z);
    this.host.toRaw(x1, z1, this.at);
    const bx = cm(this.at.x);
    const bz = cm(this.at.z);
    return this.writeZone({ kind: 'rect', min: [Math.min(ax, bx), Math.min(az, bz)], max: [Math.max(ax, bx), Math.max(az, bz)] }, name, 'a rectangle');
  }

  writeOutline(points: readonly (readonly [number, number])[], name: string | null = null): Promise<string> {
    const pts: [number, number][] = points.map(([x, z]) => {
      this.host.toRaw(x, z, this.at);
      return [cm(this.at.x), cm(this.at.z)];
    });
    return this.writeZone({ kind: 'poly', pts }, name, `an outline of ${pts.length} points`);
  }

  /** "From a place": a place of ours' own shape copied into a new zone (its name taken, the two files kept apart). */
  async fromPlace(id: string, keeps: readonly ZoneKeep[] | null = null): Promise<string> {
    const loc = this.host.locations().find((r) => r.id === id);
    if (!loc || !loc.shape) return this.said(`no place of ours ${id} with a shape on this world`, false);
    const shape = readZoneShape(loc.shape);
    if (typeof shape === 'string') return this.said(`${id}'s shape: ${shape}`, false);
    return this.writeZone(shape, loc.name ?? id, `from ${loc.name ?? id}`, keeps);
  }

  /** A zone written from a shape of the raw frame. */
  async writeZone(shape: ZoneShapeRow, name: string | null, what: string, keeps: readonly ZoneKeep[] | null = null): Promise<string> {
    const no = this.refusal();
    if (no) return this.said(no, false);
    const sh = readZoneShape(centimetres(shape as LocationShape));
    if (typeof sh === 'string') return this.said(`the shape: ${sh}`, false);
    const c = zoneChange(this.host.rows(), sh, keeps ?? ZONE_TOOL_TUNE.keeps, name);
    const said = await this.commit(`a no-spawn zone, ${what}`, [c]);
    if (typeof c !== 'string' && !/refus|under way|nothing/i.test(said)) this.picked = c.id;
    return said;
  }

  async moveZone(id: string, dx: number, dz: number): Promise<string> {
    const r = this.host.rows().find((x) => x.id === id);
    if (!r?.shape) return this.said(`no zone ${id}`, false);
    const shape = movedShape(r.shape as LocationShape, dx, dz, (x, z, o) => this.host.toGame(x, z, o), (x, z, o) => this.host.toRaw(x, z, o)) as ZoneShapeRow;
    return this.commit(`${id} moved ${Math.hypot(dx, dz).toFixed(1)} m`, [zoneSetChange(this.host.rows(), id, { shape })]);
  }

  async scaleZone(id: string, f: number): Promise<string> {
    const r = this.host.rows().find((x) => x.id === id);
    if (!r?.shape) return this.said(`no zone ${id}`, false);
    return this.commit(`${id} sized ${Math.round(f * 100)}%`, [zoneSetChange(this.host.rows(), id, { shape: scaledShape(r.shape as LocationShape, f) as ZoneShapeRow })]);
  }

  async setZone(id: string, fields: { name?: string | null; keeps?: readonly ZoneKeep[] | null }): Promise<string> {
    return this.commit(`${id}'s fields`, [zoneSetChange(this.host.rows(), id, fields)]);
  }

  async remove(id: string): Promise<string> {
    if (this.picked === id) this.picked = null;
    return this.commit(`${id} taken up`, [unzoneChange(this.host.rows(), id)]);
  }

  private async commit(label: string, list: (RemovalChange | string)[]): Promise<string> {
    const changes: RowChange[] = [];
    for (const c of list) {
      if (typeof c === 'string') return this.said(c, false);
      changes.push({ file: 'removed', id: c.id, before: c.before as EditRow | null, after: c.after as EditRow | null });
    }
    if (this.writing) return this.said('a write is under way', false);
    const w = this.host.edits.putRows(label, changes);
    this.writing = w;
    try {
      const said = await w;
      return this.said(said, !/refus|under way|nothing/i.test(said));
    } finally {
      if (this.writing === w) this.writing = null;
    }
  }

  private said(words: string, ok: boolean): string {
    this.last = words;
    if (words) this.host.say(words, ok);
    return words;
  }

  private drawMarks(d: ToolDraw, view: ScreenView, outlines: Outline[], picked: Outline | null): void {
    const m = d.marks;
    let pts = 0;
    for (let l = 0; l < outlines.length; l++) pts += outlines[l].n;
    lakePools(m, outlines.length, pts, Math.max(6, this.draftN + 2));
    const vp = view.vp;
    let k = 0;
    m.lakePicked = -1;
    for (let l = 0; l < outlines.length; l++) {
      const o = outlines[l];
      const isPicked = o === picked;
      const ox = isPicked && this.dragging ? this.dragX : 0;
      const oz = isPicked && this.dragging ? this.dragZ : 0;
      const s = isPicked ? this.scale : 1;
      if (isPicked) m.lakePicked = l;
      m.lakeSpans[l] = o.n;
      // A zone is drawn as a place players may not build in is: it is a place nothing stands.
      m.lakeBad[l] = 1;
      // Each point into the kept `pq` and projected from there (`projectAt`): no number of it crosses a call.
      const pq = this.pq;
      for (let i = 0; i < o.n; i++) {
        pq[0] = o.cx + (o.pts[i * 2] - o.cx) * s + ox;
        pq[1] = o.ys[i];
        pq[2] = o.cz + (o.pts[i * 2 + 1] - o.cz) * s + oz;
        m.lakeVis[k + i] = projectAt(pq, 0, vp, view.w, view.h, this.pt) ? 1 : 0;
        m.lakePts[(k + i) * 2] = this.pt[0];
        m.lakePts[(k + i) * 2 + 1] = this.pt[1];
      }
      pq[0] = o.cx + ox;
      pq[1] = o.cy;
      pq[2] = o.cz + oz;
      m.lakeHandleVis[l] = projectAt(pq, 0, vp, view.w, view.h, this.pt) ? 1 : 0;
      m.lakeHandles[l * 2] = this.pt[0];
      m.lakeHandles[l * 2 + 1] = this.pt[1];
      k += o.n;
    }
    m.lakeCount = outlines.length;
    m.lakesOn = outlines.length > 0;
    if (picked && this.layout.on) m.gizmo = this.layout;
    const f = this.f;
    const most = (Math.max(this.draftN, 4) + 2) * 3;
    if (this.dq.length < most) this.dq = new Float64Array(most * 2);
    const dq = this.dq;
    let n = 0;
    if (this.rectOn && f.valid) {
      // The rectangle's four corners and its first again, written straight into the kept draft (a frame of a drag makes nothing).
      for (let i = 0; i < 5; i++) {
        const far = i === 1 || i === 2;
        dq[i * 3] = far ? f.x : this.rectX;
        dq[i * 3 + 1] = far ? f.y : this.rectY;
        dq[i * 3 + 2] = i === 2 || i === 3 ? f.z : this.rectZ;
      }
      n = 5;
    } else if (ZONE_TOOL_TUNE.mode === 'outline' && this.draftN) {
      for (let i = 0; i < this.draftN; i++) {
        dq[n * 3] = this.dxz[i * 3];
        dq[n * 3 + 1] = this.dxz[i * 3 + 2];
        dq[n * 3 + 2] = this.dxz[i * 3 + 1];
        n++;
      }
      if (f.valid) {
        dq[n * 3] = f.x;
        dq[n * 3 + 1] = f.y;
        dq[n * 3 + 2] = f.z;
        n++;
      }
    }
    for (let i = 0; i < n; i++) {
      m.draftVis[i] = projectAt(dq, i * 3, view.vp, view.w, view.h, this.pt) ? 1 : 0;
      m.draftPts[i * 2] = this.pt[0];
      m.draftPts[i * 2 + 1] = this.pt[1];
    }
    m.draftCount = n;
    m.draftOn = n > 0;
  }

  barWords(): string {
    const pick = this.picked ? ` · ${this.picked} picked (drag its square, C with the wheel sizes it, Delete takes it up)` : '';
    return `no-spawn zones: ${this.modeWords()}${pick}${this.writing ? ' · writing' : ''}${this.last && !this.writing ? ` · ${this.last}` : ''}`;
  }

  /** The window's sections: the Tools tab's mode, keeps and "from a place"; the Selected tab's picked zone; the Here tab's list. */
  sections(tab: 'selected' | 'here' | 'tools'): EditorSection[] {
    const out: EditorSection[] = [];
    if (tab === 'tools') {
      const t = ZONE_TOOL_TUNE;
      const keeps = t.keeps.length ? t.keeps : ZONE_KEEPS;
      out.push({
        title: 'No-spawn zones',
        note: `${this.armed ? 'Armed' : 'Let go'}: ${this.modeWords()}. A new zone keeps away ${keeps.join(', ')}. No-spawn, not no-enter.`,
        buttons: [
          { label: this.armed ? 'Let go' : 'Arm', act: 'zone:arm' },
          { label: 'Circle', act: 'zone:mode:circle', off: t.mode === 'circle' },
          { label: 'Rectangle', act: 'zone:mode:rect', off: t.mode === 'rect' },
          { label: 'Outline', act: 'zone:mode:outline', off: t.mode === 'outline' },
          ...(this.draftN >= 3 ? [{ label: 'Close the outline', act: 'zone:close' }] : []),
        ],
        rows: [
          ...ZONE_KEEPS.map((k) => ({ words: `Keeps ${k === 'wild' ? 'the wildlife' : k === 'people' ? "the data's people and his own" : 'the people of ours'}: ${keeps.includes(k) ? 'yes' : 'no'}`, buttons: [{ label: keeps.includes(k) ? 'Leave it' : 'Keep it', act: `zone:keep:${k}` }] })),
          ...this.host.locations().filter((r) => r.shape && r.id !== 'world').slice(0, 30).map((r) => ({ words: `From a place: ${r.name ?? r.id}`, title: r.id, buttons: [{ label: 'Make a zone', act: `zone:from:${r.id}` }] })),
        ],
      });
      return out;
    }
    if (tab === 'selected') {
      const r = this.picked ? this.host.rows().find((x) => x.id === this.picked) : null;
      if (r) {
        const keeps = zoneKeeps(r);
        const kept = this.host.keptOff(r.id);
        out.push({
          title: 'A no-spawn zone',
          note: `${r.shape?.kind ?? ''}${kept === null ? '' : ` · keeps ${kept} site${kept === 1 ? '' : 's'} of the wildlife off`}`,
          fields: [
            { label: 'Zone', value: r.id, act: null },
            { label: 'Its name', value: r.name ?? '', act: 'zone:name' },
          ],
          rows: ZONE_KEEPS.map((k) => ({ words: `Keeps ${k}: ${keeps.includes(k) ? 'yes' : 'no'}`, buttons: [{ label: keeps.includes(k) ? 'Leave it' : 'Keep it', act: `zone:rowkeep:${k}` }] })),
          buttons: [{ label: 'Take it up', act: 'zone:remove', danger: true }, { label: 'Let go', act: 'zone:letgo' }],
        });
      }
      return out;
    }
    const zones = this.zoneRows();
    if (zones.length) out.push({ title: 'No-spawn zones on this world', rows: zones.map((z) => ({ words: `${z.name ?? z.id} (${zoneKeeps(z).join(', ')})`, title: z.id, buttons: [{ label: 'Go to', act: `zone:go:${z.id}` }, { label: 'Pick', act: `zone:pick:${z.id}` }, { label: 'Delete', act: `zone:del:${z.id}`, danger: true }] })) });
    return out;
  }

  /** The eye flown over a zone: over its middle and back from it by its reach (its farthest point from that middle). */
  goTo(id: string): string {
    const o = this.outlinesNow().find((x) => x.id === id);
    if (!o) return this.said(`no zone ${id}`, false);
    let reach = 0;
    for (let i = 0; i < o.n; i++) reach = Math.max(reach, Math.hypot(o.pts[i * 2] - o.cx, o.pts[i * 2 + 1] - o.cz));
    this.host.goTo(o.cx, o.cz, reach);
    return this.said(`over ${this.host.rows().find((r) => r.id === id)?.name ?? id}`, true);
  }

  /** A button or a field of a section; answers whether it was the tool's. */
  async act(a: string, value?: string): Promise<boolean> {
    if (!a.startsWith('zone:')) return false;
    const [, verb, ...rest] = a.split(':');
    const arg = rest.join(':');
    if (verb === 'mode' && (arg === 'circle' || arg === 'rect' || arg === 'outline')) {
      ZONE_TOOL_TUNE.mode = arg;
      this.draftN = 0;
    } else if (verb === 'keep') {
      const k = arg as ZoneKeep;
      const now = ZONE_TOOL_TUNE.keeps.length ? [...ZONE_TOOL_TUNE.keeps] : [...ZONE_KEEPS];
      ZONE_TOOL_TUNE.keeps = now.includes(k) ? now.filter((x) => x !== k) : ZONE_KEEPS.filter((x) => x === k || now.includes(x));
      if (!ZONE_TOOL_TUNE.keeps.length) ZONE_TOOL_TUNE.keeps = [k];
    } else if (verb === 'close') await this.closeDraft();
    else if (verb === 'from') await this.fromPlace(arg);
    else if (verb === 'pick') this.picked = arg;
    else if (verb === 'go') this.goTo(arg);
    else if (verb === 'del') await this.remove(arg);
    else if (verb === 'letgo') this.picked = null;
    else if (verb === 'remove' && this.picked) await this.remove(this.picked);
    else if (verb === 'name' && this.picked) await this.setZone(this.picked, { name: (value ?? '').trim() || null });
    else if (verb === 'rowkeep' && this.picked) {
      const r = this.host.rows().find((x) => x.id === this.picked);
      if (r) {
        const now = [...zoneKeeps(r)];
        const k = arg as ZoneKeep;
        let next = now.includes(k) ? now.filter((x) => x !== k) : ZONE_KEEPS.filter((x) => x === k || now.includes(x));
        if (!next.length) next = [k];
        await this.setZone(this.picked, { keeps: next });
      }
    }
    return true;
  }

  report(): Record<string, unknown> {
    return { armed: this.armed, mode: ZONE_TOOL_TUNE.mode, radius: ZONE_TOOL_TUNE.radius, keeps: ZONE_TOOL_TUNE.keeps, draft: this.draftN, picked: this.picked, zones: this.zoneRows().length, writing: !!this.writing, last: this.last };
  }
}

/** The zone tool as an entry of the Tools list (armed from the Tools tab: no key of its own). */
export function zonesTool(z: EditorZones): ToolDef {
  return {
    id: 'zones',
    action: null,
    label: 'the no-spawn zone tool',
    armed: () => z.armed,
    arm: () => z.arm(),
    disarm: () => z.disarm(),
    step(f) {
      z.step(f);
    },
    draw: (d) => z.draw(d),
    overlay: (d, view) => z.overlay(d, view),
    owns: (b) => b === 'apply' || b === 'inverse',
    size: (n) => z.size(n),
    deleteKey: () => z.deleteKey(),
    escape: () => z.escape(),
    barWords: () => z.barWords(),
    report: () => z.report(),
  };
}
