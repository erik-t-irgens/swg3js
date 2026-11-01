// The world editor's water tool (Map-maker II, DESIGN.md §2.7, its fifth wave): lakes of ours put down, moved, raised and
// taken out, and falls between them. The Tools list's entry on Z (`waterTool`).
//
// **What a click does** is the tool's mode (`WATER_TUNE.mode`, the Tools tab's and the console's):
// - **clicks**: each click on the ground is a point of an outline; a click within `closeReach` of the first point (or the
//   Tools tab's Close) closes it and writes the lake at its level (`levelFrom`: the lowest ground under its points, its first
//   point's, or a height typed or sampled with Shift+click, `rise` over it); RMB takes the last point back.
// - **trace**: a click is a seed, and the ground under the level (the seed's ground and `traceRise` more, or the typed height)
//   is flooded from it and its shore walked and simplified (`lakeTrace.ts`) into the lake written.
// - **fall**: the first click is its top (on one lake's edge), the second its bottom (on another's, or the ground): one row of
//   the placements file, the fall model (`fallModel`) scaled per axis to the drop and `fallWidth`, its sprays coming with the
//   model from the props pack's client data at their own size. A fall is a look: nothing swims in it.
//
// **A lake picked** (a click on its handle, the ring at its middle, in any mode; the Here tab's Pick up) moves with the
// gizmo's ground square (dragged, the point grabbed kept under the cursor on the level of its surface), F held with the mouse
// up and down raises it (the placing hand's own rate; the wheel with F held steps `raiseStep`), Delete takes it out, Escape
// lets it go; its look's colour, opacity, ripple and drift and its shader are the Selected tab's fields. **Every change is
// one write and one undo** (the editing's `beginStroke`, `strokeWrite`, `endStroke`), and the world stands it by difference
// as the write's answer lands (`World.landWater`): never anything stood or moved here. A move and a raise are shown on the
// overlay as they are held and written once, as the button or F is let go.
//
// **The curtain**: a lake written where this session has built no lake's programs, or any lava lake, is written behind the
// editor's short curtain (`WaterHost.wantsCurtain`, `curtain`), so its programs and its mask twins are built behind a screen.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties. The dev server's alone: reached only through the editor's own dynamic import.

import { traceLake, outlineArea } from './lakeTrace.ts';
import { WATER_TUNE } from './editorTune.ts';
import { mintWaterId, readWaterLook, type WaterLakeRow, type WaterLookRow } from '../world/editFiles/waterFile.ts';
import { rowFromEditor, type EditorSource } from '../world/permanentEdit.ts';
import { writtenScale, type PlacementLayer, type PlacementRow } from '../story/placements.ts';
import { cursor, dragAt, gizmoDrag, gizmoLayout, grabAt, H, layoutGizmo, pickAt, ray3, rayAt, worldAxes, type ScreenView } from './gizmo.ts';
import { liftDelta } from '../world/placeHold.ts';
import { lakePools, projectPoint } from '../ui/editorMarks.ts';
import type { EditorEdits } from './editorEdit.ts';
import type { RowChange } from './undo.ts';
import type { ToolDef, ToolDraw, ToolFrame } from './tools.ts';

/** What the water tool needs of the editor and the game. */
export interface WaterHost {
  readonly edits: EditorEdits;
  /** What kind of world: only a ground world keeps water. */
  worldKind(): 'ground' | 'space' | 'copies';
  /** The water file's lakes in force (the world's, as the last landing left them). */
  rows(): readonly WaterLakeRow[];
  /** A point of the game's frame in the file's raw frame, and back, into a kept record. */
  toRaw(x: number, z: number, out: { x: number; z: number }): void;
  toGame(x: number, z: number, out: { x: number; z: number }): void;
  /** The ground at a point of the game's frame (the cached ground, else made), NaN for none. */
  groundAt(x: number, z: number): number;
  /** The ground a trace floods, made where it is not cached (a trace's cost). */
  heightAt(x: number, z: number): number;
  /** The global sea's height (-Infinity for none). */
  seaLevel(): number;
  /** Whether a shader key is lava on this world. */
  isLava(shader: string | null): boolean;
  /** Whether a lake put on now must go behind the curtain (`World.lakeWantsCurtain`). */
  wantsCurtain(lava: boolean): boolean;
  /** Work behind the editor's short curtain, the lake's mask twins warmed after it: answers what it said. */
  curtain(detail: string, work: () => Promise<string>): Promise<string>;
  /** A fall model of the props catalogue: its source and its box, or why not. */
  fallSource(thing: string): Promise<{ src: EditorSource; bounds: { min: number[]; max: number[] } } | string>;
  /** The placements file a fall row goes into (the editor's destination), its frame, centre and world. */
  dest(): PlacementLayer;
  centre(): { x: number; z: number } | null;
  frame(): 'raw' | 'game';
  packId(): string;
  /** The camera's heading (a fall whose two ends stand one over the other faces it). */
  cameraYaw(): number;
  /** The rows of ours standing under a lake of ours that have no rooms (a structure of props is under water inside). */
  underNotes(): string[];
  say(words: string, ok: boolean): void;
}

/** One lake as the tool draws and picks it: its id, its outline in the game's frame (x, z pairs), its surface and its middle. */
interface Outline {
  id: string;
  n: number;
  pts: Float64Array;
  h: number;
  cx: number;
  cz: number;
}

/** A level within `nudge` of the sea's raised clear of it (or it reads as the sea and swells): the level and whether it moved. */
export function nudgedLevel(h: number, sea: number, nudge: number): { h: number; nudged: boolean } {
  if (Number.isFinite(sea) && nudge > 0 && Math.abs(h - sea) < nudge) return { h: sea + nudge, nudged: true };
  return { h, nudged: false };
}

/**
 * The level of a clicked outline (`WATER_TUNE.levelFrom`): the lowest ground under its points, its first point's, or the
 * typed height, `rise` over the first two. NaN where the ground under its points is unknown.
 */
export function clickLevel(grounds: readonly number[], from: 'lowest' | 'first' | 'typed', typed: number, rise: number): number {
  if (from === 'typed') return typed;
  if (!grounds.length) return Number.NaN;
  if (from === 'first') return grounds[0] + rise;
  let lo = Infinity;
  for (const g of grounds) if (g < lo) lo = g;
  return Number.isFinite(lo) ? lo + rise : Number.NaN;
}

/**
 * A fall between two points of the game's frame, as the row's numbers: where it stands, its turn about up and its scale per
 * axis, from its model's box (either corner first), so the model's top stands at `top`'s height, its height spans the drop,
 * its width is `width` metres and its depth `depth` times the width's scale; it faces from its top toward its bottom (or the
 * camera's way, `yaw`, where the two stand one over the other), turned `turnDeg` more. Its box's middle on the ground stands
 * `share` of the way from the top's place to the bottom's (`WATER_TUNE.fallAlong`): the model is a hanging sheet, and stood
 * anywhere over a sloped face between the two ends its lower part is inside the slope (stood at the run's middle on a 12 m
 * plateau's 56-degree flank, all but its top two metres were). Null where the drop is under `least`.
 */
export function fallPlacement(
  top: { x: number; y: number; z: number },
  bottom: { x: number; y: number; z: number },
  box: { min: readonly number[]; max: readonly number[] },
  width: number,
  depth: number,
  turnDeg: number,
  yaw: number,
  least: number,
  share = 1,
): { x: number; y: number; z: number; yaw: number; q: [number, number, number, number]; scale: [number, number, number] } | null {
  const drop = top.y - bottom.y;
  if (!(drop >= least) || !(drop > 0)) return null;
  const minX = Math.min(box.min[0], box.max[0]);
  const maxX = Math.max(box.min[0], box.max[0]);
  const minY = Math.min(box.min[1], box.max[1]);
  const maxY = Math.max(box.min[1], box.max[1]);
  const minZ = Math.min(box.min[2], box.max[2]);
  const maxZ = Math.max(box.min[2], box.max[2]);
  const sy = drop / Math.max(1e-3, maxY - minY);
  const sx = width / Math.max(1e-3, maxX - minX);
  const sz = sx * depth;
  const dx = bottom.x - top.x;
  const dz = bottom.z - top.z;
  const along = Math.sqrt(dx * dx + dz * dz) > 0.5 ? Math.atan2(dx, dz) : yaw;
  const a = along + (turnDeg * Math.PI) / 180;
  const f = Math.min(1, Math.max(0, share));
  // The box's middle on the ground, scaled and turned by three's own sense (local (x, z) to (x cos + z sin, -x sin + z cos)),
  // taken off so that middle, and not the model's origin, stands on the point.
  const mx = ((minX + maxX) / 2) * sx;
  const mz = ((minZ + maxZ) / 2) * sz;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = top.x + dx * f - (mx * c + mz * s);
  const z = top.z + dz * f - (-mx * s + mz * c);
  return { x, y: top.y - maxY * sy, z, yaw: a, q: [0, Math.sin(a / 2), 0, Math.cos(a / 2)], scale: [sx, sy, sz] };
}

/**
 * A number to `step` (a centimetre, a millimetre), as the file keeps it: divided by the whole number of steps a metre, so the
 * file reads `749.93` and never `749.9300000000001` (a product by the step leaves the last bit off).
 */
function to(v: number, step: number): number {
  const k = Math.round(1 / step);
  return Math.round(v * k) / k;
}

/** The water tool. */
export class EditorWater {
  armed = false;
  private readonly host: WaterHost;
  /** A clicked outline under way: game-frame x, z and the ground under each. Changed only by `pushDraft` and `cutDraft`. */
  readonly draft: { x: number; z: number; g: number }[] = [];
  /** The draft's points again, three numbers each (x, z, ground), and how many: what the frame draws it from. */
  private dxzg = new Float64Array(12);
  private draftN = 0;

  /** A point added to the draft (a click's, never a steady frame's), the typed copy grown when it is full. */
  private pushDraft(x: number, z: number, g: number): void {
    this.draft.push({ x, z, g });
    const n = this.draft.length;
    if (this.dxzg.length < n * 3) {
      const grown = new Float64Array(n * 6);
      grown.set(this.dxzg);
      this.dxzg = grown;
    }
    this.dxzg[n * 3 - 3] = x;
    this.dxzg[n * 3 - 2] = z;
    this.dxzg[n * 3 - 1] = g;
    this.draftN = n;
  }

  /** The draft cut to its first `n` points (none: given up, closed, the world gone). */
  private cutDraft(n: number): void {
    this.draft.length = Math.min(this.draft.length, Math.max(0, n));
    this.draftN = this.draft.length;
  }
  /** A fall's top, clicked and waiting for its bottom. */
  fallTop: { x: number; y: number; z: number } | null = null;
  /** The lake picked, by id, and what is held on it: a drag of its square (its offset) or F's raise. */
  picked: string | null = null;
  private dragging = false;
  private dragX = 0.5;
  private dragZ = 0.5;
  private raise = 0.5;
  private raising = false;
  private writing: Promise<string> | null = null;
  /** The last frame's buttons and F, for their edges; the cursor's height last frame (Point's raise). */
  private wasApply = false;
  private wasInverse = false;
  private wasLift = false;
  private lastSy = Number.NaN;
  /** This frame's inputs, kept by `step` for `overlay`, which runs from this frame's view. */
  private readonly f: ToolFrame = { apply: false, inverse: false, shift: false, sampled: false, x: 0.5, y: 0.5, z: 0.5, valid: false, dt: 0.016, now: 0.5, sx: 0.5, sy: 0.5, dy: 0.5, lift: false };
  /** The outlines as drawn, made again when the world's rows are another list. */
  private outlines: Outline[] = [];
  private rowsSeen: readonly WaterLakeRow[] | null = null;
  // Kept for the frame: nothing in a steady frame is made.
  private readonly layout = gizmoLayout();
  private readonly drag = gizmoDrag();
  private readonly axes = worldAxes();
  private readonly cur = cursor();
  private readonly ray = ray3();
  private readonly pivot = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly pt = new Float64Array(2);
  private readonly at = { x: 0.5, z: 0.5 };
  /** What the last action came to, for the console and the bar. */
  last = { said: '', kind: '', ms: 0, points: 0, area: 0 };

  constructor(host: WaterHost) {
    this.host = host;
  }

  /** Whether a write or a held move is under way (the automatic fold's quiet). */
  get busy(): boolean {
    return !!this.writing || this.dragging || this.raising;
  }

  /** Why the world refuses the tool, in words, or null. */
  refusal(): string | null {
    const k = this.host.worldKind();
    if (k === 'space') return 'a space zone keeps no water of ours (space maps are a later pass)';
    if (k === 'copies') return "the dungeons' world of copies keeps no water of ours";
    return null;
  }

  /** Z: armed, or refused in words. */
  async arm(): Promise<string> {
    const no = this.refusal();
    if (no) {
      this.host.say(no, false);
      return no;
    }
    this.armed = true;
    const words = `the water tool: ${this.modeWords()} (a click on a lake's ring picks it; Z lets go)`;
    this.host.say(words, true);
    return words;
  }

  /** Z again, Escape, a thing in hand, the world gone: let go, a draft and a held move given up (nothing written). */
  disarm(): void {
    this.armed = false;
    this.giveUpHeld();
  }

  /** The world went: everything dropped (its lakes went with it). */
  worldGone(): void {
    this.disarm();
    this.picked = null;
    this.cutDraft(0);
    this.fallTop = null;
    this.outlines = [];
    this.rowsSeen = null;
  }

  private giveUpHeld(): void {
    this.dragging = false;
    this.raising = false;
    this.raise = 0;
    this.dragX = 0;
    this.dragZ = 0;
  }

  /** A raise begun from nought (F held, or the wheel with it). */
  private beginRaise(): void {
    if (this.raising) return;
    this.raising = true;
    this.raise = 0;
  }

  /** The outline picked now, by a loop (no closure in a frame), or null. */
  private pickedOutline(outlines: readonly Outline[]): Outline | null {
    const id = this.picked;
    if (!id) return null;
    for (let i = 0; i < outlines.length; i++) if (outlines[i].id === id) return outlines[i];
    return null;
  }

  private modeWords(): string {
    const m = WATER_TUNE.mode;
    return m === 'clicks' ? 'a lake by clicks (LMB a point, near the first closes it, RMB takes one back)' : m === 'trace' ? 'a lake traced (LMB a seed in its basin)' : 'a fall (LMB its top, then its bottom; RMB starts again)';
  }

  /** Escape while armed: a draft or a fall's top given up, else the picked lake let go; answers whether it took the key. */
  escape(): boolean {
    if (this.dragging || this.raising) {
      this.giveUpHeld();
      this.host.say('the move given up: nothing written', true);
      return true;
    }
    if (this.draft.length || this.fallTop) {
      this.cutDraft(0);
      this.fallTop = null;
      this.host.say('the draft given up', true);
      return true;
    }
    if (this.picked) {
      this.picked = null;
      return true;
    }
    return false;
  }

  /** One frame's inputs, kept for the overlay (which works from this frame's view). */
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

  /** Whether it takes the mouse with F held: a lake picked and F held raises it, and the camera holds still. */
  holdsMouse(lift: boolean): boolean {
    return this.armed && lift && this.picked !== null && !this.writing;
  }

  /** The wheel with F held on a picked lake: raised or lowered `raiseStep` a notch. Answers what was said, or null. */
  wheel(notches: number, lift: boolean): string | null {
    if (!this.armed || !lift || !this.picked) return null;
    this.beginRaise();
    this.raise += notches * WATER_TUNE.raiseStep;
    return `raised ${this.raise >= 0 ? '+' : ''}${this.raise.toFixed(2)} m (let F go to write it)`;
  }

  /** Delete with a lake picked: it taken out (one write, one undo). Answers whether it took the key. */
  deleteKey(): boolean {
    if (!this.armed || !this.picked) return false;
    void this.remove(this.picked);
    return true;
  }

  /** The outlines made again from the world's rows (on a change of list alone). */
  private outlinesNow(): Outline[] {
    const rows = this.host.rows();
    if (rows === this.rowsSeen) return this.outlines;
    this.rowsSeen = rows;
    const out: Outline[] = [];
    for (const r of rows) {
      const pts = new Float64Array(r.points.length * 2);
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < r.points.length; i++) {
        this.host.toGame(r.points[i][0], r.points[i][1], this.at);
        pts[i * 2] = this.at.x;
        pts[i * 2 + 1] = this.at.z;
        cx += this.at.x;
        cz += this.at.z;
      }
      out.push({ id: r.id, n: r.points.length, pts, h: r.h, cx: cx / Math.max(1, r.points.length), cz: cz / Math.max(1, r.points.length) });
    }
    this.outlines = out;
    if (this.picked && !rows.some((r) => r.id === this.picked)) this.picked = null;
    return out;
  }

  /**
   * The frame, from this frame's view, after the editing's own marks: the press resolved (the picked lake's square grabbed,
   * a lake's ring picked, or the mode's own click), a drag or a raise carried on and written as it is let go, and every
   * lake's outline, its ring, the picked one's square and a draft drawn. Nothing is made in a frame with nothing to say.
   */
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
    const liftUp = !f.lift && this.wasLift;
    this.wasApply = f.apply;
    this.wasInverse = f.inverse;
    this.wasLift = f.lift;
    this.cur.x = f.sx;
    this.cur.y = f.sy;
    rayAt(view, this.cur, this.ray);
    const picked = this.pickedOutline(outlines);
    // The picked lake's square: laid out at its middle on its surface (raised as it is held), the up arrow shown while F is.
    const L = this.layout;
    L.on = false;
    if (picked) {
      this.pivot.x = picked.cx + (this.dragging ? this.dragX : 0);
      this.pivot.y = picked.h + (this.raising ? this.raise : 0);
      this.pivot.z = picked.cz + (this.dragging ? this.dragZ : 0);
      for (let i = 0; i < L.shown.length; i++) L.shown[i] = false;
      L.shown[H.ground] = true;
      L.shown[H.up] = f.lift;
      layoutGizmo(view, this.pivot, this.axes, 90, L);
      if (!this.dragging) pickAt(L, this.cur, WATER_TUNE.hitPx);
    }
    // F held on the picked lake: raised by the mouse at the placing hand's own rate; let go, written.
    if (picked && f.lift && !this.writing) {
      // Fly's movement down the screen (spent for the camera's sake), or Point's cursor's own.
      let dy = f.dy;
      if (!dy && Number.isFinite(this.lastSy)) dy = f.sy - this.lastSy;
      if (dy) {
        this.beginRaise();
        this.raise += liftDelta(dy, f.dt, 1, 'house');
      }
    }
    this.lastSy = f.sy;
    if (liftUp && this.raising) {
      const by = this.raise;
      this.raising = false;
      this.raise = 0;
      if (picked && Math.abs(by) >= 0.001) void this.moveLake(picked.id, 0, 0, by);
    }
    // A drag of the picked lake's square carried on; let go, written.
    if (this.dragging) {
      if (f.apply) {
        if (dragAt(this.drag, L, this.cur, this.ray)) {
          this.dragX = this.drag.mx;
          this.dragZ = this.drag.mz;
        }
      } else if (release) {
        const dx = this.dragX;
        const dz = this.dragZ;
        this.giveUpHeld();
        if (picked && Math.sqrt(dx * dx + dz * dz) >= 0.01) void this.moveLake(picked.id, dx, dz, 0);
      }
    } else if (press && !this.writing) this.pressed(outlines, picked, view);
    else if (pressInverse) this.inversePressed();
    if (f.sampled && f.valid) this.sample(f.x, f.z);
    this.drawMarks(d, view, outlines, picked);
  }

  /** A press: the picked lake's square grabbed, a lake's ring picked, or the mode's own click. */
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
    const hit = this.ringUnder(outlines, view);
    if (hit) {
      this.picked = hit.id;
      this.host.say(`picked the lake ${hit.id} (${hit.h.toFixed(2)} m): drag its square, F raises it, Delete takes it out, Escape lets it go`, true);
      return;
    }
    if (!f.valid) return;
    const mode = WATER_TUNE.mode;
    if (mode === 'clicks') this.clickPoint(f.x, f.z);
    else if (mode === 'trace') void this.traceAt(f.x, f.z, null);
    else if (!this.fallTop) {
      this.fallTop = { x: f.x, y: f.y, z: f.z };
      this.host.say(`the fall's top at ${f.y.toFixed(2)} m: click its bottom`, true);
    } else {
      const top = this.fallTop;
      this.fallTop = null;
      void this.writeFall(top, { x: f.x, y: f.y, z: f.z });
    }
  }

  /** RMB: the draft's last point taken back, or a fall's top given up. */
  private inversePressed(): void {
    if (WATER_TUNE.mode === 'clicks' && this.draft.length) {
      this.cutDraft(this.draft.length - 1);
      this.host.say(`${this.draft.length} point${this.draft.length === 1 ? '' : 's'} in the outline`, true);
    } else if (WATER_TUNE.mode === 'fall' && this.fallTop) {
      this.fallTop = null;
      this.host.say("the fall's top given up", true);
    }
  }

  /** The lake whose ring is under the cursor (nearest within `hitPx`), or null. */
  private ringUnder(outlines: Outline[], view: ScreenView): Outline | null {
    let best: Outline | null = null;
    let bestD = WATER_TUNE.hitPx;
    for (const o of outlines) {
      if (!projectPoint(o.cx, o.h, o.cz, view.vp, view.w, view.h, this.pt)) continue;
      const dx = this.pt[0] - this.cur.x;
      const dy = this.pt[1] - this.cur.y;
      const dd = Math.sqrt(dx * dx + dy * dy);
      if (dd <= bestD) {
        bestD = dd;
        best = o;
      }
    }
    return best;
  }

  /** Shift+click: the ground under the aim as the typed level (`levelFrom` typed). Writes nothing. */
  sample(x: number, z: number): number {
    const g = this.host.groundAt(x, z);
    if (!Number.isFinite(g)) return Number.NaN;
    WATER_TUNE.height = Math.round(g * 1000) / 1000;
    WATER_TUNE.levelFrom = 'typed';
    this.host.say(`a lake's level: ${WATER_TUNE.height.toFixed(2)} m (sampled; a click writes at it)`, true);
    return g;
  }

  /** A click of the outline: a point added, or the outline closed where it is near the first. */
  clickPoint(x: number, z: number): void {
    const d = this.draft;
    if (d.length >= 3) {
      const dx = x - d[0].x;
      const dz = z - d[0].z;
      if (Math.sqrt(dx * dx + dz * dz) <= WATER_TUNE.closeReach) {
        void this.closeDraft();
        return;
      }
    }
    this.pushDraft(x, z, this.host.groundAt(x, z));
    this.host.say(`${d.length} point${d.length === 1 ? '' : 's'} in the outline${d.length >= 3 ? ' (a click near the first closes it)' : ''}`, true);
  }

  /** The clicked outline closed and written at its level. Answers what was said. */
  async closeDraft(): Promise<string> {
    const d = this.draft;
    if (d.length < 3) return 'an outline has three points at least';
    const h = clickLevel(d.map((p) => p.g), WATER_TUNE.levelFrom, WATER_TUNE.height, WATER_TUNE.rise);
    if (!Number.isFinite(h)) return this.said('the ground under the outline is not known: type a level (Shift+click samples one)', false);
    const pts = d.map((p) => [p.x, p.z] as [number, number]);
    this.cutDraft(0);
    return this.writeLake(pts, h, 'a lake (clicked)', 'clicks');
  }

  /**
   * A lake traced from a seed of the game's frame: flooded at `h` (null: the seed's ground and `traceRise` more, or the typed
   * height) and written. Answers what was said.
   */
  async traceAt(x: number, z: number, h: number | null, reach?: number): Promise<string> {
    const t = WATER_TUNE;
    const level = h ?? (t.levelFrom === 'typed' ? t.height : this.host.groundAt(x, z) + t.traceRise);
    if (!Number.isFinite(level)) return this.said('the ground under the seed is not known', false);
    const r = this.traced(x, z, level, reach);
    if (r.why) return this.said(`the trace: ${r.why}`, false);
    return this.writeLake(r.points, level, `a lake (traced, ${r.points.length} points)`, 'trace');
  }

  /** The outline a trace from a seed at a level comes to (the console's `lakes({ trace })` writes nothing with `{ dry }`). */
  traced(x: number, z: number, level: number, reach?: number): { points: [number, number][]; area: number; why: string | null; ms: number; cells: number } {
    const t = WATER_TUNE;
    const t0 = performance.now();
    const r = traceLake((gx, gz) => this.host.heightAt(gx, gz), { x, z, h: level, step: t.traceStep, reach: reach ?? t.traceReach, most: t.mostPoints, tolerance: t.tolerance });
    const ms = Math.round(performance.now() - t0);
    this.last = { said: r.why ?? '', kind: 'trace', ms, points: r.points.length, area: Math.round(r.area) };
    return { points: r.points, area: r.area, why: r.why, ms, cells: r.cells };
  }

  /**
   * A lake written: its outline (the game's frame) into the raw frame to a centimetre, its level (nudged off the sea) to a
   * millimetre, a fresh id from its name, the tool's shader; behind the curtain where `wantsCurtain` says. Answers what was said.
   */
  async writeLake(points: readonly (readonly [number, number])[], h: number, label: string, kind: string, name?: string): Promise<string> {
    const no = this.refusal();
    if (no) return this.said(no, false);
    if (this.writing) return this.said('a write is under way', false);
    if (points.length < 3) return this.said('an outline has three points at least', false);
    const host = this.host;
    const rows = host.rows();
    const taken = new Set(rows.map((r) => r.id));
    const n = name ?? `Lake ${rows.length + 1}`;
    const id = mintWaterId(n, taken);
    const raw: [number, number][] = points.map(([x, z]) => {
      host.toRaw(x, z, this.at);
      return [to(this.at.x, 0.01), to(this.at.z, 0.01)];
    });
    const lv = nudgedLevel(h, host.seaLevel(), WATER_TUNE.seaNudge);
    if (lv.nudged) host.say(`the level is the sea's own: raised ${WATER_TUNE.seaNudge} m over it, or it would read as the sea and swell`, true);
    const shader = WATER_TUNE.shader || null;
    const row: WaterLakeRow = { id, kind: 'lake', name: n, h: to(lv.h, 0.001), points: raw, shader };
    const area = outlineArea(points as [number, number][]);
    this.last = { said: '', kind, ms: this.last.kind === 'trace' ? this.last.ms : 0, points: raw.length, area: Math.round(area) };
    const said = await this.commit(`${label}: ${id}`, [{ file: 'water', id, before: null, after: row }], host.isLava(shader));
    if (this.lastOk) this.picked = id;
    return said;
  }

  /** Whether the last write was taken. */
  lastOk = false;

  /** A lake moved by an offset of the game's frame and raised by `dy` (one write, one undo). Answers what was said. */
  async moveLake(id: string, dx: number, dz: number, dy: number): Promise<string> {
    const host = this.host;
    const row = host.rows().find((r) => r.id === id);
    if (!row) return this.said(`no lake ${id} in this world's water file`, false);
    const points: [number, number][] = row.points.map(([x, z]) => {
      host.toGame(x, z, this.at);
      const gx = this.at.x + dx;
      const gz = this.at.z + dz;
      host.toRaw(gx, gz, this.at);
      return [to(this.at.x, 0.01), to(this.at.z, 0.01)];
    });
    const lv = nudgedLevel(row.h + dy, host.seaLevel(), WATER_TUNE.seaNudge);
    const after: WaterLakeRow = { ...row, points, h: to(lv.h, 0.001) };
    delete after.at;
    const what = dy && !dx && !dz ? `raised ${dy >= 0 ? '+' : ''}${dy.toFixed(2)} m` : `moved ${Math.sqrt(dx * dx + dz * dz).toFixed(1)} m`;
    return this.commit(`the lake ${id} ${what}`, [{ file: 'water', id, before: row, after }], host.isLava(row.shader));
  }

  /** A lake's look or name written (the Selected tab's fields): `look` merged over its own (a field null takes it out). */
  async setLake(id: string, fields: { name?: string | null; shader?: string | null; look?: Record<string, unknown> }): Promise<string> {
    const host = this.host;
    const row = host.rows().find((r) => r.id === id);
    if (!row) return this.said(`no lake ${id} in this world's water file`, false);
    const after: WaterLakeRow = { ...row };
    delete after.at;
    if (fields.name !== undefined) {
      if (fields.name) after.name = fields.name;
      else delete after.name;
    }
    if (fields.shader !== undefined) after.shader = fields.shader || null;
    if (fields.look) {
      const merged: Record<string, unknown> = { ...(row.look ?? {}) };
      for (const [k, v] of Object.entries(fields.look)) {
        if (v === null || v === undefined || v === '') delete merged[k];
        else merged[k] = v;
      }
      const look = readWaterLook(merged);
      if (typeof look === 'string') return this.said(`the look: ${look}`, false);
      if (Object.keys(look).length) after.look = look as WaterLookRow;
      else delete after.look;
    }
    // Lava before or after: either way the lava is made again (the lake joins it or leaves it).
    return this.commit(`the lake ${id}'s look`, [{ file: 'water', id, before: row, after }], host.isLava(after.shader) || host.isLava(row.shader));
  }

  /** A lake taken out of the file (one write, one undo); a lava lake behind the curtain, as its making is. Answers what was said. */
  async remove(id: string): Promise<string> {
    const row = this.host.rows().find((r) => r.id === id);
    if (!row) return this.said(`no lake ${id} in this world's water file`, false);
    if (this.picked === id) this.picked = null;
    return this.commit(`the lake ${id} taken out`, [{ file: 'water', id, before: row, after: null }], this.host.isLava(row.shader));
  }

  /** A fall written between two points of the game's frame: one row of the placements file. Answers what was said. */
  async writeFall(top: { x: number; y: number; z: number }, bottom: { x: number; y: number; z: number }): Promise<string> {
    const host = this.host;
    const t = WATER_TUNE;
    if (this.writing) return this.said('a write is under way', false);
    const got = await host.fallSource(t.fallModel);
    if (typeof got === 'string') return this.said(got, false);
    const p = fallPlacement(top, bottom, got.bounds, t.fallWidth, t.fallDepth, t.fallTurn, host.cameraYaw(), t.fallMin, t.fallAlong);
    if (!p) return this.said(`a fall's top stands at least ${t.fallMin} m over its bottom: this drop is ${(top.y - bottom.y).toFixed(2)} m`, false);
    const id = host.edits.mintIds([got.src.thing ?? 'fall'])[0];
    const ground = host.groundAt(p.x, p.z);
    const row = rowFromEditor(got.src, { x: p.x, y: p.y, z: p.z }, p.q, false, host.centre(), host.frame(), { here: host.packId(), ground: Number.isFinite(ground) ? ground : null, mm: 0.001, turnDigits: 6 }) as PlacementRow;
    row.id = id;
    const sc = writtenScale(p.scale);
    if (sc !== undefined) row.scale = sc;
    this.last = { said: '', kind: 'fall', ms: 0, points: 0, area: 0 };
    return this.commit(`a fall ${(top.y - bottom.y).toFixed(1)} m: ${id}`, [{ file: host.dest(), id, before: null, after: row }], false, true);
  }

  /**
   * One write and one undo entry, behind the curtain where a lake asks for it: a lake put on where the world asks
   * (`wantsCurtain`: this session's first lake), and any change to a lava lake, put, moved or taken out, since each makes the
   * lava again. (An undo or a redo of one goes behind the curtain the app opens for it, `App.landWaterRows`.)
   */
  private async commit(label: string, changes: RowChange[], lava: boolean, fall = false): Promise<string> {
    const host = this.host;
    let ok = false;
    const write = async (): Promise<string> => {
      const es = host.edits.beginStroke(label);
      const no = await host.edits.strokeWrite(es, changes);
      const said = host.edits.endStroke(es);
      if (no) return said || no;
      ok = true;
      const under = fall ? [] : host.underNotes();
      return under.length ? `${said} · under water inside: only a building with rooms is dry (${under.slice(0, 6).join(', ')}${under.length > 6 ? ` and ${under.length - 6} more` : ''})` : said;
    };
    const putsLake = changes.some((c) => c.file === 'water' && c.after);
    const run = async (): Promise<string> => ((putsLake || lava) && host.wantsCurtain(lava) ? host.curtain(label, write) : write());
    this.lastOk = false;
    const w = run();
    this.writing = w;
    try {
      const said = await w;
      this.lastOk = ok;
      return this.said(said, ok);
    } finally {
      if (this.writing === w) this.writing = null;
    }
  }

  private said(words: string, ok: boolean): string {
    this.last.said = words;
    if (words) this.host.say(words, ok);
    return words;
  }

  /** The marks: every lake's outline at its surface (the picked one moved and raised as held), its ring, the square, a draft. */
  private drawMarks(d: ToolDraw, view: ScreenView, outlines: Outline[], picked: Outline | null): void {
    const m = d.marks;
    let pts = 0;
    for (let l = 0; l < outlines.length; l++) pts += outlines[l].n;
    lakePools(m, outlines.length, pts, this.draftN + (this.fallTop ? 1 : 0) + 1);
    const vp = view.vp;
    const w = view.w;
    const h = view.h;
    let k = 0;
    m.lakePicked = -1;
    for (let l = 0; l < outlines.length; l++) {
      const o = outlines[l];
      const isPicked = o === picked;
      const ox = isPicked && this.dragging ? this.dragX : 0;
      const oz = isPicked && this.dragging ? this.dragZ : 0;
      const y = o.h + (isPicked && this.raising ? this.raise : 0);
      if (isPicked) m.lakePicked = l;
      m.lakeSpans[l] = o.n;
      for (let i = 0; i < o.n; i++) {
        const vis = projectPoint(o.pts[i * 2] + ox, y, o.pts[i * 2 + 1] + oz, vp, w, h, this.pt);
        m.lakeVis[k + i] = vis ? 1 : 0;
        m.lakePts[(k + i) * 2] = this.pt[0];
        m.lakePts[(k + i) * 2 + 1] = this.pt[1];
      }
      const hv = projectPoint(o.cx + ox, y, o.cz + oz, vp, w, h, this.pt);
      m.lakeHandleVis[l] = hv ? 1 : 0;
      m.lakeHandles[l * 2] = this.pt[0];
      m.lakeHandles[l * 2 + 1] = this.pt[1];
      k += o.n;
    }
    m.lakeCount = outlines.length;
    m.lakesOn = outlines.length > 0;
    if (picked && this.layout.on) m.gizmo = this.layout;
    this.draftMarks(view, m);
  }

  /** The draft's points (x, y, z each), kept: grown when an outline outgrows it, which is a click's frame and never a steady one. */
  private dq = new Float64Array(12);

  /**
   * A draft's marks: the clicked points (at their ground) or a fall's top, and the aim, written into the kept `dq` (three
   * numbers a point) out of the draft's own typed copy (`dxzg`, written as the draft is) and projected through one call
   * site, in a method of their own handed nothing but the view and the marks: projected in the lakes' method, handed to a
   * call one point at a time or read off the draft's objects, they were boxed, 6 to 27 bytes a frame while an outline was
   * under way, by which of that method's loads the compiler had built in when (measured, `editorAllocOwn.ts water`).
   */
  private draftMarks(view: ScreenView, m: ToolDraw['marks']): void {
    const f = this.f;
    const most = (this.draftN + 2) * 3;
    if (this.dq.length < most) this.dq = new Float64Array(most * 2);
    const dq = this.dq;
    const dx = this.dxzg;
    let n = 0;
    if (WATER_TUNE.mode === 'clicks') {
      for (let i = 0; i < this.draftN; i++) {
        const g = dx[i * 3 + 2];
        dq[n * 3] = dx[i * 3];
        dq[n * 3 + 1] = Number.isFinite(g) ? g : f.y;
        dq[n * 3 + 2] = dx[i * 3 + 1];
        n++;
      }
    } else if (WATER_TUNE.mode === 'fall' && this.fallTop) {
      dq[0] = this.fallTop.x;
      dq[1] = this.fallTop.y;
      dq[2] = this.fallTop.z;
      n = 1;
    }
    if (n > 0 && f.valid) {
      dq[n * 3] = f.x;
      dq[n * 3 + 1] = f.y;
      dq[n * 3 + 2] = f.z;
      n++;
    }
    for (let i = 0; i < n; i++) {
      m.draftVis[i] = projectPoint(dq[i * 3], dq[i * 3 + 1], dq[i * 3 + 2], view.vp, view.w, view.h, this.pt) ? 1 : 0;
      m.draftPts[i * 2] = this.pt[0];
      m.draftPts[i * 2 + 1] = this.pt[1];
    }
    m.draftCount = n;
    m.draftOn = n > 0;
  }

  /** The bar's words while armed. */
  barWords(): string {
    const t = WATER_TUNE;
    const lvl = t.levelFrom === 'typed' ? `at ${t.height.toFixed(2)} m` : t.levelFrom === 'first' ? `at the first point's ground${t.rise ? ` +${t.rise} m` : ''}` : `at the lowest ground${t.rise ? ` +${t.rise} m` : ''}`;
    const mode = t.mode === 'clicks' ? `a lake by clicks ${lvl}${this.draft.length ? ` · ${this.draft.length} points` : ''}` : t.mode === 'trace' ? `a lake traced at the seed's ground +${t.traceRise} m${t.levelFrom === 'typed' ? ` (typed: ${t.height.toFixed(2)} m)` : ''}` : `a fall ${t.fallWidth} m wide${this.fallTop ? ' · its top set, click its bottom' : ''}`;
    const held = this.dragging ? ` · moving ${Math.sqrt(this.dragX * this.dragX + this.dragZ * this.dragZ).toFixed(1)} m` : this.raising ? ` · raising ${this.raise >= 0 ? '+' : ''}${this.raise.toFixed(2)} m` : '';
    const pick = this.picked ? ` · ${this.picked} picked (drag its square, F raises, Delete takes it out)` : '';
    return `water: ${mode}${pick}${held}${this.writing ? ' · writing' : ''}${this.last.said && !this.writing ? ` · ${this.last.said}` : ''}`;
  }

  /** For the console. */
  report(): Record<string, unknown> {
    return { armed: this.armed, mode: WATER_TUNE.mode, levelFrom: WATER_TUNE.levelFrom, height: WATER_TUNE.height, draft: this.draft.length, fallTop: this.fallTop, picked: this.picked, dragging: this.dragging, raising: this.raising ? this.raise : 0, writing: !!this.writing, last: { ...this.last } };
  }
}

/** The water tool as an entry of the Tools list, on Z. */
export function waterTool(w: EditorWater): ToolDef {
  return {
    id: 'water',
    action: 'editorWater',
    label: 'the water tool',
    armed: () => w.armed,
    arm: () => w.arm(),
    disarm: () => w.disarm(),
    step(f) {
      w.step(f);
    },
    // No ring: what a click does is said on the bar, and the lakes are drawn every frame (`overlay`).
    draw() {},
    overlay: (d, view) => w.overlay(d, view),
    owns: (b) => b === 'apply' || b === 'inverse',
    holdsMouse: (lift) => w.holdsMouse(lift),
    wheel: (notches, lift) => w.wheel(notches, lift),
    deleteKey: () => w.deleteKey(),
    escape: () => w.escape(),
    barWords: () => w.barWords(),
    report: () => w.report(),
  };
}
