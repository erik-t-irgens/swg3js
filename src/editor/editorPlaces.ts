// The world editor's places tool (Map-maker II, DESIGN.md §2.10, its eighth wave): cities, places, landmarks, areas and zones
// of ours drawn on a world as circles, rectangles or outlines, written into its locations file
// (`public/placements/locations/<world>.json`). The Tools list's entry on P (`placesTool`).
//
// **What a click does** is the tool's mode (`PLACES_TOOL_TUNE.mode`, the Tools tab's and the console's):
// - **circle**: a click writes a circle of `radius` at the aim (the ring round the aim shows it; C held with the wheel sizes it).
// - **rect**: a drag writes a rectangle from where the button went down to where it came up (shorter than `rectLeast` either
//   way: a slip, nothing written); RMB while dragging gives it up.
// - **outline**: each click is a point; a click within `closePx` of the first (or the Tools tab's Close) writes it; RMB takes
//   the last point back.
//
// **A place picked** (a click on its handle, the ring at its middle, in any mode; the Here tab's Pick up) moves with the
// gizmo's ground square (dragged, the point grabbed kept under the cursor), C held with the wheel grows or shrinks it about
// its middle (written `sizeRest` seconds after the last notch), Delete takes it out, Escape lets it go; its name, kind,
// whether it is drawn, said and built in, its loading lines and its words are the Selected tab's. **Every change is one write
// and one undo** (the editing's `beginStroke`, `strokeWrite`, `endStroke`), and the game lands it by difference as the
// write's answer comes (`App.landLocationRows`): nothing is stood here. An outline is drawn at the ground under each point
// the world has built (never a block made for it in a frame), and a place players may not build in is drawn in `bad`.
//
// **The world row** (id `world`): its `cities` switch (the game's own cities, Core3's no-build areas and the client's no-build
// radii kept clear of players' houses and props) and its loading lines, written from the Tools tab and the console.
//
// **The sky per place** (the ninth wave, DESIGN.md §2.11): a place's family (one of the sky in force's, by name), its forced
// weather kind and its colour-grade look are the Selected tab's (`setPlace`'s `SkyFields`); the world row's own sky (the same
// three under every place's, and its climate, fog, wind and clouds) is the Tools tab's box of JSON and the console's
// `worldSky`. Each is one write and one undo, read by the file's own reader before it is sent.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties. The dev server's alone: reached only through the editor's own dynamic import.

import { PLACES_TOOL_TUNE } from './editorTune.ts';
import { LOCATION_LIMITS, buildable, mintLocationId, readLocationRow, readLocationShape, shapeMiddle, type LocationKind, type LocationRow, type LocationShape } from '../world/editFiles/locationsFile.ts';
import { cursor, dragAt, gizmoDrag, gizmoLayout, grabAt, H, layoutGizmo, pickAt, ray3, rayAt, worldAxes, type ScreenView } from './gizmo.ts';
import { lakePools, projectAt, projectPoint } from '../ui/editorMarks.ts';
import type { EditorEdits } from './editorEdit.ts';
import type { RowChange } from './undo.ts';
import type { ToolDef, ToolDraw, ToolFrame } from './tools.ts';

/** What the places tool needs of the editor and the game. */
export interface PlacesHost {
  readonly edits: EditorEdits;
  /** What kind of world: only a ground world draws places of ours this pass. */
  worldKind(): 'ground' | 'space' | 'copies';
  /** The locations file's rows in force (every state's), as the last landing left them. */
  rows(): readonly LocationRow[];
  /** A point of the game's frame in the file's raw frame, and back, into a kept record. */
  toRaw(x: number, z: number, out: { x: number; z: number }): void;
  toGame(x: number, z: number, out: { x: number; z: number }): void;
  /** The ground at a point of the game's frame (the cached ground, else made): asked once a place, never in a frame. NaN for none. */
  groundAt(x: number, z: number): number;
  /** The ground the world has built at a point, written into `out.y`; false where none is built (nothing made). */
  groundCached(x: number, z: number, out: { y: number }): boolean;
  say(words: string, ok: boolean): void;
}

/** One place as the tool draws and picks it: its outline in the game's frame (x, z pairs) at the ground, its middle, whether `bad`. */
interface Outline {
  id: string;
  n: number;
  pts: Float64Array;
  ys: Float64Array;
  /** Whether each point's height is the built ground's (1) or the middle's stand-in (0, asked again on the refresh). */
  known: Uint8Array;
  cx: number;
  cy: number;
  cz: number;
  bad: boolean;
}

/** A number to a centimetre, as the file keeps it (divided by the steps a metre: the file reads `749.93`, never `749.9300000000001`). */
function cm(v: number): number {
  return Math.round(v * 100) / 100;
}

/** A shape's every coordinate and its radius to the centimetre (anything that is not a shape handed back as it came, for the reader to refuse). */
export function centimetres(s: LocationShape): LocationShape {
  if (!s || typeof s !== 'object') return s;
  const p = (v: unknown): unknown => (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [cm(v[0]), cm(v[1])] : v);
  if (s.kind === 'circle') return { kind: 'circle', c: p(s.c) as [number, number], r: typeof s.r === 'number' ? cm(s.r) : s.r };
  if (s.kind === 'rect') return { kind: 'rect', min: p(s.min) as [number, number], max: p(s.max) as [number, number] };
  if (s.kind === 'poly' && Array.isArray(s.pts)) return { kind: 'poly', pts: s.pts.map((q) => p(q) as [number, number]) };
  return s;
}

/** A kind's word as a name begins ("City 3"). */
function kindWord(kind: LocationKind): string {
  return kind === 'city' ? 'City' : kind === 'landmark' ? 'Landmark' : kind === 'area' ? 'Area' : kind === 'zone' ? 'Zone' : 'Place';
}

/**
 * A shape's outline as points of the raw frame: a circle's `n` points round its rim, a rectangle's four corners, an outline's
 * own points. Pure.
 */
export function shapePoints(s: LocationShape, n: number): [number, number][] {
  if (s.kind === 'circle') {
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push([s.c[0] + Math.cos(a) * s.r, s.c[1] + Math.sin(a) * s.r]);
    }
    return out;
  }
  if (s.kind === 'rect') return [[s.min[0], s.min[1]], [s.max[0], s.min[1]], [s.max[0], s.max[1]], [s.min[0], s.max[1]]];
  return s.pts.map((p) => [p[0], p[1]] as [number, number]);
}

/**
 * A shape moved by an offset of the game's frame: each of its points carried into the game's frame, moved and carried back
 * (a rectangle's corners put in order again: the game's frame mirrors x on a planet). Rounded to the centimetre. Pure but for
 * the frames handed in.
 */
export function movedShape(s: LocationShape, dx: number, dz: number, toGame: (x: number, z: number, out: { x: number; z: number }) => void, toRaw: (x: number, z: number, out: { x: number; z: number }) => void): LocationShape {
  const at = { x: 0, z: 0 };
  const move = (p: readonly [number, number]): [number, number] => {
    toGame(p[0], p[1], at);
    toRaw(at.x + dx, at.z + dz, at);
    return [cm(at.x), cm(at.z)];
  };
  if (s.kind === 'circle') return { kind: 'circle', c: move(s.c), r: s.r };
  if (s.kind === 'rect') {
    const a = move(s.min);
    const b = move(s.max);
    return { kind: 'rect', min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
  }
  return { kind: 'poly', pts: s.pts.map(move) };
}

/** A shape grown (or shrunk) by `f` about its own middle, in its own frame (the scale is the same in either). Pure. */
export function scaledShape(s: LocationShape, f: number): LocationShape {
  const m = shapeMiddle(s);
  const at = (p: readonly [number, number]): [number, number] => [cm(m.x + (p[0] - m.x) * f), cm(m.z + (p[1] - m.z) * f)];
  if (s.kind === 'circle') return { kind: 'circle', c: [s.c[0], s.c[1]], r: cm(Math.max(LOCATION_LIMITS.radiusLeast, s.r * f)) };
  if (s.kind === 'rect') return { kind: 'rect', min: at(s.min), max: at(s.max) };
  return { kind: 'poly', pts: s.pts.map(at) };
}

/**
 * A place of ours as a story area, ready to paste into a story's `areas/` folder (`storyAreaSnippet`'s shape, the area the
 * place's own shape, in the raw frame a story is written in). Pure.
 */
export function placeAreaSnippet(row: LocationRow, world: string): string {
  const shape = row.shape ? JSON.stringify(row.shape).replace(/,/g, ', ').replace(/:/g, ': ') : '{}';
  return `{\n  "id": ${JSON.stringify(`${row.id}-area`.slice(0, 64))},\n  "world": ${JSON.stringify(world)},\n  "shape": ${shape},\n  "label": ${JSON.stringify(row.name ?? row.id)},\n}\n`;
}

/**
 * A row's sky fields as the Selected tab, the Tools tab and the console write them (the ninth wave): `env` a family's name,
 * `weather` a forced kind, `grade`, `wind` and `clouds` laid over the row's own key by key, `climate` and `fog` whole (the
 * last four the world row's alone, which the file's reader says of a place). Null (or an empty name) takes a field away, and
 * a key null takes that key away; a group left with nothing is taken away.
 */
export interface SkyFields {
  env?: string | null;
  weather?: string | null;
  grade?: Record<string, number | null> | null;
  climate?: number[] | null;
  fog?: Record<string, number> | null;
  wind?: Record<string, number | null> | null;
  clouds?: Record<string, number | null> | null;
}

/** The sky fields' names, in the file's order. */
export const SKY_FIELDS: readonly (keyof SkyFields)[] = ['env', 'weather', 'grade', 'climate', 'fog', 'wind', 'clouds'];

/** A row's draft with sky fields laid on it (`SkyFields`' rules), in place. Pure: the reader checks what comes of it. */
export function skyInto(draft: Record<string, unknown>, f: SkyFields): void {
  if ('env' in f) {
    const v = typeof f.env === 'string' ? f.env.trim() : '';
    if (v) draft.env = v;
    else delete draft.env;
  }
  if ('weather' in f) {
    if (f.weather) draft.weather = f.weather;
    else delete draft.weather;
  }
  for (const k of ['grade', 'wind', 'clouds'] as const) {
    if (!(k in f)) continue;
    const v = f[k];
    if (v === null || v === undefined || typeof v !== 'object') {
      if (v === null || v === undefined) delete draft[k];
      else draft[k] = v;
      continue;
    }
    const was = draft[k] && typeof draft[k] === 'object' && !Array.isArray(draft[k]) ? (draft[k] as Record<string, unknown>) : {};
    const out: Record<string, unknown> = { ...was };
    for (const [key, n] of Object.entries(v)) {
      if (n === null) delete out[key];
      else out[key] = n;
    }
    if (Object.keys(out).length) draft[k] = out;
    else delete draft[k];
  }
  if ('climate' in f) {
    if (Array.isArray(f.climate) && f.climate.length) draft.climate = [...f.climate];
    else if (f.climate === null || (Array.isArray(f.climate) && !f.climate.length)) delete draft.climate;
    else draft.climate = f.climate;
  }
  if ('fog' in f) {
    if (f.fog && typeof f.fog === 'object') draft.fog = { ...f.fog };
    else if (f.fog === null || f.fog === undefined) delete draft.fog;
    else draft.fog = f.fog;
  }
}

/**
 * A row's sky fields as one object of JSON (the Tools tab's world row): the ones it sets, in the file's order. Pure.
 */
export function skyOfRow(row: LocationRow | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!row) return out;
  for (const k of SKY_FIELDS) if (row[k] !== undefined) out[k] = row[k];
  return out;
}

/**
 * The world row's sky as the Tools tab's box writes it: one object of JSON standing for the whole of it (written with
 * `setWorld`'s `skyWhole`, so a field it leaves out is taken away and a group it gives stands in place of the row's own).
 * Empty text is none of it. The fields, or why the text does not read. Pure.
 */
export function wholeSkyOf(text: string): SkyFields | string {
  if (!text.trim()) return {};
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return `the world's sky does not read as JSON (${(e as Error).message})`;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return "the world's sky is one object: { env, weather, grade, climate, fog, wind, clouds }";
  for (const k of Object.keys(v as Record<string, unknown>)) if (!(SKY_FIELDS as readonly string[]).includes(k)) return `the world's sky has no ${k} (${SKY_FIELDS.join(', ')})`;
  return v as SkyFields;
}

/** The places tool. */
export class EditorPlaces {
  armed = false;
  private readonly host: PlacesHost;
  /** An outline's clicked points under way (x, z and the ground under each, three numbers a point), and how many. */
  private dxzy = new Float64Array(12);
  draftN = 0;
  /** A rectangle's first corner, while its drag is held. */
  private rectOn = false;
  private rectX = 0.5;
  private rectY = 0.5;
  private rectZ = 0.5;
  /** The place picked, by id, and what is held on it: a drag of its square (its offset), a size waiting to be written. */
  picked: string | null = null;
  private dragging = false;
  private dragX = 0.5;
  private dragZ = 0.5;
  private scale = 1;
  private scaleAt = Number.NaN;
  private writing: Promise<string> | null = null;
  private wasApply = false;
  private wasInverse = false;
  private readonly f: ToolFrame = { apply: false, inverse: false, shift: false, sampled: false, x: 0.5, y: 0.5, z: 0.5, valid: false, dt: 0.016, now: 0.5, sx: 0.5, sy: 0.5, dy: 0.5, lift: false };
  /** The outlines as drawn, made again when the rows are another list; their unknown heights asked again on a clock. */
  private outlines: Outline[] = [];
  private rowsSeen: readonly LocationRow[] | null = null;
  /** When the stand-in heights were last asked again (a fraction from the start: a field that holds one must start as one). */
  private refreshAt = 0.5;
  // Kept for the frame: nothing in a steady frame is made.
  private readonly layout = gizmoLayout();
  private readonly drag = gizmoDrag();
  private readonly axes = worldAxes();
  private readonly cur = cursor();
  private readonly ray = ray3();
  private readonly pivot = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly pt = new Float64Array(2);
  /**
   * A point to project, kept, so no number of it crosses the call (`projectAt`): a double handed to `projectPoint` is boxed
   * whenever the compiler leaves that call out, which an outline under way did in about one process in a hundred (6.5 bytes
   * a frame, named by the sampling heap profiler in `draftMarks`).
   */
  private readonly pq = new Float64Array(3);
  private readonly at = { x: 0.5, z: 0.5 };
  private readonly ground = { y: 0.5 };
  private dq = new Float64Array(24);
  /** What the last action came to, for the console and the bar. */
  last = { said: '', kind: '' };
  /** Whether the last write was taken. */
  lastOk = false;

  constructor(host: PlacesHost) {
    this.host = host;
  }

  /** Whether a write or a held move is under way (the automatic fold's quiet). */
  get busy(): boolean {
    return !!this.writing || this.dragging || this.rectOn || this.scale !== 1;
  }

  /** Why the world refuses the tool, in words, or null. */
  refusal(): string | null {
    const k = this.host.worldKind();
    if (k === 'space') return "a space zone's places are drawn nowhere this pass (space maps are a later pass)";
    if (k === 'copies') return "the dungeons' world of copies keeps no places of ours";
    return null;
  }

  /** P: armed, or refused in words. */
  async arm(): Promise<string> {
    const no = this.refusal();
    if (no) {
      this.host.say(no, false);
      return no;
    }
    this.armed = true;
    const words = `the places tool: ${this.modeWords()} (a click on a place's ring picks it; P lets go)`;
    this.host.say(words, true);
    return words;
  }

  /** P again, Escape, a thing in hand, the world gone: let go, a draft and a held move given up (nothing written). */
  disarm(): void {
    this.armed = false;
    this.giveUpHeld();
  }

  /** The world went: everything dropped. */
  worldGone(): void {
    this.disarm();
    this.picked = null;
    this.draftN = 0;
    this.outlines = [];
    this.rowsSeen = null;
  }

  private giveUpHeld(): void {
    this.dragging = false;
    this.dragX = 0;
    this.dragZ = 0;
    this.rectOn = false;
    this.scale = 1;
    this.scaleAt = Number.NaN;
  }

  private modeWords(): string {
    const m = PLACES_TOOL_TUNE.mode;
    return m === 'circle' ? `a ${PLACES_TOOL_TUNE.kind} by a click, ${Math.round(PLACES_TOOL_TUNE.radius)} m round (C with the wheel sizes it)` : m === 'rect' ? `a ${PLACES_TOOL_TUNE.kind} by a drag` : `a ${PLACES_TOOL_TUNE.kind} by clicks (LMB a point, near the first closes it, RMB takes one back)`;
  }

  /** Escape while armed: a held move, a draft, else the picked place let go; answers whether it took the key. */
  escape(): boolean {
    if (this.dragging || this.rectOn || this.scale !== 1) {
      this.giveUpHeld();
      this.host.say('given up: nothing written', true);
      return true;
    }
    if (this.draftN) {
      this.draftN = 0;
      this.host.say('the outline given up', true);
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

  /** The ring round the aim: a circle's radius to come, in circle mode with nothing held. */
  draw(d: ToolDraw): void {
    if (!this.armed || PLACES_TOOL_TUNE.mode !== 'circle' || this.dragging || this.picked) return;
    d.radius = PLACES_TOOL_TUNE.radius;
    d.ring(0);
  }

  /**
   * C held with the wheel: a picked place grown or shrunk about its middle (written `sizeRest` seconds after the last notch),
   * else the radius a click writes. Answers what was said.
   */
  size(notches: number): string | null {
    const step = Math.pow(PLACES_TOOL_TUNE.sizeStep, notches);
    if (this.picked) {
      this.scale *= step;
      this.scaleAt = this.f.now;
      return `${this.picked} at ${Math.round(this.scale * 100)}% (written as the wheel rests)`;
    }
    PLACES_TOOL_TUNE.radius = Math.min(50000, Math.max(0.5, PLACES_TOOL_TUNE.radius * step));
    return `a circle ${PLACES_TOOL_TUNE.radius.toFixed(PLACES_TOOL_TUNE.radius < 10 ? 1 : 0)} m round`;
  }

  /** Delete with a place picked: it taken out (one write, one undo). Answers whether it took the key. */
  deleteKey(): boolean {
    if (!this.armed || !this.picked) return false;
    void this.remove(this.picked);
    return true;
  }

  /** The outlines made again from the rows (on a change of the list alone): every place but the world row, at its ground. */
  private outlinesNow(): Outline[] {
    const rows = this.host.rows();
    if (rows === this.rowsSeen) return this.outlines;
    this.rowsSeen = rows;
    const out: Outline[] = [];
    const host = this.host;
    for (const r of rows) {
      if (!r.shape) continue;
      const raw = shapePoints(r.shape, PLACES_TOOL_TUNE.circlePoints);
      const n = raw.length;
      const pts = new Float64Array(n * 2);
      const ys = new Float64Array(n);
      const known = new Uint8Array(n);
      const m = shapeMiddle(r.shape);
      host.toGame(m.x, m.z, this.at);
      const cx = this.at.x;
      const cz = this.at.z;
      const g = host.groundAt(cx, cz);
      const cy = Number.isFinite(g) ? g : 0;
      for (let i = 0; i < n; i++) {
        host.toGame(raw[i][0], raw[i][1], this.at);
        pts[i * 2] = this.at.x;
        pts[i * 2 + 1] = this.at.z;
        if (host.groundCached(this.at.x, this.at.z, this.ground)) {
          ys[i] = this.ground.y;
          known[i] = 1;
        } else ys[i] = cy;
      }
      out.push({ id: r.id, n, pts, ys, known, cx, cy, cz, bad: !buildable(r) });
    }
    this.outlines = out;
    if (this.picked && !rows.some((r) => r.id === this.picked)) this.picked = null;
    return out;
  }

  /** Twice a second, every outline point standing on a stand-in height asked of the built ground again (nothing made). */
  private refreshHeights(outlines: Outline[]): void {
    // The moment read off the frame's own record: a number handed across a call the compiler leaves out is boxed.
    const now = this.f.now;
    if (now - this.refreshAt < 0.5 && now >= this.refreshAt) return;
    this.refreshAt = now;
    for (let l = 0; l < outlines.length; l++) {
      const o = outlines[l];
      for (let i = 0; i < o.n; i++) {
        if (o.known[i]) continue;
        if (this.host.groundCached(o.pts[i * 2], o.pts[i * 2 + 1], this.ground)) {
          o.ys[i] = this.ground.y;
          o.known[i] = 1;
        }
      }
    }
  }

  /** The outline picked now, by a loop (no closure in a frame), or null. */
  private pickedOutline(outlines: readonly Outline[]): Outline | null {
    const id = this.picked;
    if (!id) return null;
    for (let i = 0; i < outlines.length; i++) if (outlines[i].id === id) return outlines[i];
    return null;
  }

  /** A row of the file by its id, or undefined. */
  rowOf(id: string): LocationRow | undefined {
    return this.host.rows().find((r) => r.id === id);
  }

  /**
   * The frame, from this frame's view, after the editing's own marks: the press resolved (the picked place's square grabbed,
   * a place's ring picked, or the mode's own click), a drag or a size carried on and written as it is let go or rests, and
   * every place's outline, its ring, the picked one's square and a draft drawn. Nothing is made in a steady frame.
   */
  overlay(d: ToolDraw, view: ScreenView): void {
    const f = this.f;
    const m = d.marks;
    m.lakesOn = false;
    m.draftOn = false;
    if (!this.armed) return;
    const outlines = this.outlinesNow();
    this.refreshHeights(outlines);
    const press = f.apply && !this.wasApply;
    const release = !f.apply && this.wasApply;
    const pressInverse = f.inverse && !this.wasInverse;
    this.wasApply = f.apply;
    this.wasInverse = f.inverse;
    this.cur.x = f.sx;
    this.cur.y = f.sy;
    rayAt(view, this.cur, this.ray);
    const picked = this.pickedOutline(outlines);
    const L = this.layout;
    L.on = false;
    if (picked) {
      this.pivot.x = picked.cx + (this.dragging ? this.dragX : 0);
      this.pivot.y = picked.cy;
      this.pivot.z = picked.cz + (this.dragging ? this.dragZ : 0);
      for (let i = 0; i < L.shown.length; i++) L.shown[i] = false;
      L.shown[H.ground] = true;
      layoutGizmo(view, this.pivot, this.axes, 90, L);
      if (!this.dragging) pickAt(L, this.cur, PLACES_TOOL_TUNE.hitPx);
    }
    // A size waiting: written once the wheel has rested.
    if (this.scale !== 1 && f.now - this.scaleAt >= PLACES_TOOL_TUNE.sizeRest && !this.writing) {
      const s = this.scale;
      this.scale = 1;
      this.scaleAt = Number.NaN;
      if (picked && Math.abs(s - 1) > 1e-4) void this.scalePlace(picked.id, s);
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
        this.giveUpHeld();
        if (picked && Math.sqrt(dx * dx + dz * dz) >= 0.01) void this.movePlace(picked.id, dx, dz);
      }
    } else if (this.rectOn) {
      if (pressInverse) {
        this.rectOn = false;
        this.host.say('the rectangle given up', true);
      } else if (release) {
        this.rectOn = false;
        if (f.valid) void this.writeRect(this.rectX, this.rectZ, f.x, f.z);
      }
    } else if (press && !this.writing) this.pressed(outlines, picked, view);
    else if (pressInverse) this.inversePressed();
    this.drawMarks(d, view, outlines, picked);
  }

  /** A press: the picked place's square grabbed, a place's ring picked, or the mode's own click. */
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
      const r = this.rowOf(hit.id);
      this.host.say(`picked ${r?.name ?? hit.id} (${r?.kind ?? 'place'}): drag its square, C with the wheel sizes it, Delete takes it out, Escape lets it go`, true);
      return;
    }
    // A click away from the picked place lets it go first, rather than drawing a place where it lands.
    if (this.picked) {
      this.host.say(`${this.picked} let go`, true);
      this.picked = null;
      return;
    }
    if (!f.valid) return;
    const mode = PLACES_TOOL_TUNE.mode;
    if (mode === 'circle') void this.writeCircle(f.x, f.z, PLACES_TOOL_TUNE.radius);
    else if (mode === 'rect') {
      this.rectOn = true;
      this.rectX = f.x;
      this.rectY = f.y;
      this.rectZ = f.z;
    } else this.clickPoint(f.x, f.y, f.z, view);
  }

  /** RMB: the outline's last point taken back. */
  private inversePressed(): void {
    if (PLACES_TOOL_TUNE.mode === 'outline' && this.draftN) {
      this.draftN--;
      this.host.say(`${this.draftN} point${this.draftN === 1 ? '' : 's'} in the outline`, true);
    }
  }

  /** The place whose ring is under the cursor (nearest within `hitPx`), or null. */
  private ringUnder(outlines: Outline[], view: ScreenView): Outline | null {
    let best: Outline | null = null;
    let bestD = PLACES_TOOL_TUNE.hitPx;
    for (const o of outlines) {
      if (!projectPoint(o.cx, o.cy, o.cz, view.vp, view.w, view.h, this.pt)) continue;
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

  /** A click of the outline: a point added, or the outline closed where it lands within `closePx` of the first on the screen. */
  clickPoint(x: number, y: number, z: number, view: ScreenView | null): void {
    const n = this.draftN;
    if (n >= 3 && view && projectPoint(this.dxzy[0], this.dxzy[2], this.dxzy[1], view.vp, view.w, view.h, this.pt)) {
      const dx = this.pt[0] - this.cur.x;
      const dy = this.pt[1] - this.cur.y;
      if (Math.sqrt(dx * dx + dy * dy) <= PLACES_TOOL_TUNE.closePx) {
        void this.closeDraft();
        return;
      }
    }
    if (this.dxzy.length < (n + 1) * 3) {
      const grown = new Float64Array((n + 1) * 6);
      grown.set(this.dxzy);
      this.dxzy = grown;
    }
    this.dxzy[n * 3] = x;
    this.dxzy[n * 3 + 1] = z;
    this.dxzy[n * 3 + 2] = y;
    this.draftN = n + 1;
    this.host.say(`${this.draftN} point${this.draftN === 1 ? '' : 's'} in the outline${this.draftN >= 3 ? ' (a click near the first closes it)' : ''}`, true);
  }

  /** The outline under way closed and written. Answers what was said. */
  async closeDraft(): Promise<string> {
    const n = this.draftN;
    if (n < 3) return this.said('an outline has three points at least', false);
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) pts.push([this.dxzy[i * 3], this.dxzy[i * 3 + 1]]);
    this.draftN = 0;
    return this.writeOutline(pts);
  }

  /** The points under way, for the console and the Tools tab. */
  get draftPoints(): number {
    return this.draftN;
  }

  /** A circle written at a point of the game's frame. Answers what was said. */
  writeCircle(x: number, z: number, r: number, fields: Partial<LocationRow> = {}): Promise<string> {
    this.host.toRaw(x, z, this.at);
    return this.writePlace({ kind: 'circle', c: [cm(this.at.x), cm(this.at.z)], r: cm(r) }, fields, 'a circle');
  }

  /** A rectangle written between two corners of the game's frame (a slip under `rectLeast` either way writes nothing). */
  writeRect(x0: number, z0: number, x1: number, z1: number, fields: Partial<LocationRow> = {}): Promise<string> {
    const least = PLACES_TOOL_TUNE.rectLeast;
    if (Math.abs(x1 - x0) < least || Math.abs(z1 - z0) < least) return Promise.resolve(this.said(`a rectangle is ${least} m across at least either way: nothing written`, false));
    this.host.toRaw(x0, z0, this.at);
    const ax = cm(this.at.x);
    const az = cm(this.at.z);
    this.host.toRaw(x1, z1, this.at);
    const bx = cm(this.at.x);
    const bz = cm(this.at.z);
    return this.writePlace({ kind: 'rect', min: [Math.min(ax, bx), Math.min(az, bz)], max: [Math.max(ax, bx), Math.max(az, bz)] }, fields, 'a rectangle');
  }

  /** An outline written from points of the game's frame. */
  writeOutline(points: readonly (readonly [number, number])[], fields: Partial<LocationRow> = {}): Promise<string> {
    const pts: [number, number][] = points.map(([x, z]) => {
      this.host.toRaw(x, z, this.at);
      return [cm(this.at.x), cm(this.at.z)];
    });
    return this.writePlace({ kind: 'poly', pts }, fields, `an outline of ${pts.length} points`);
  }

  /**
   * A place written from a shape of the raw frame: a fresh id from its name (`<Kind> <n>` by default), the tool's kind, the
   * fields given laid over it, checked by the file's own reader before it is sent. Answers what was said.
   */
  async writePlace(shape: LocationShape, fields: Partial<LocationRow>, what: string): Promise<string> {
    const no = this.refusal();
    if (no) return this.said(no, false);
    if (this.writing) return this.said('a write is under way', false);
    // To the centimetre, as the file keeps every point (a shape handed in by the console carries what it was given).
    const sh = readLocationShape(centimetres(shape));
    if (typeof sh === 'string') return this.said(`the shape: ${sh}`, false);
    const rows = this.host.rows();
    const kind = (fields.kind && fields.kind !== 'world' ? fields.kind : PLACES_TOOL_TUNE.kind) as LocationKind;
    const name = fields.name ?? `${kindWord(kind)} ${rows.filter((r) => r.kind === kind).length + 1}`;
    const id = mintLocationId(name, new Set(rows.map((r) => r.id)));
    const draft: Record<string, unknown> = { ...fields, id, kind, name, shape: sh };
    delete draft.at;
    const row = readLocationRow(draft);
    if (typeof row === 'string') return this.said(`the place: ${row}`, false);
    this.last = { said: '', kind: PLACES_TOOL_TUNE.mode };
    const said = await this.commit(`${what}: ${name} (${id})`, [{ file: 'locations', id, before: null, after: row }]);
    if (this.lastOk) this.picked = id;
    return said;
  }

  /** A place moved by an offset of the game's frame (one write, one undo). */
  async movePlace(id: string, dx: number, dz: number): Promise<string> {
    const row = this.rowOf(id);
    if (!row || !row.shape) return this.said(`no place ${id} in this world's locations file`, false);
    const after: LocationRow = { ...row, shape: movedShape(row.shape, dx, dz, (x, z, o) => this.host.toGame(x, z, o), (x, z, o) => this.host.toRaw(x, z, o)) };
    delete after.at;
    return this.commit(`${row.name ?? id} moved ${Math.sqrt(dx * dx + dz * dz).toFixed(1)} m`, [{ file: 'locations', id, before: row, after }]);
  }

  /** A place grown or shrunk about its middle (one write, one undo). */
  async scalePlace(id: string, f: number): Promise<string> {
    const row = this.rowOf(id);
    if (!row || !row.shape) return this.said(`no place ${id} in this world's locations file`, false);
    const shape = readLocationShape(scaledShape(row.shape, f));
    if (typeof shape === 'string') return this.said(`the shape: ${shape}`, false);
    const after: LocationRow = { ...row, shape };
    delete after.at;
    return this.commit(`${row.name ?? id} sized ${Math.round(f * 100)}%`, [{ file: 'locations', id, before: row, after }]);
  }

  /**
   * A place's fields written (the Selected tab's, the console's): its name, kind, words, its three switches (null takes one
   * back to its kind's own), its loading lines (a list; empty takes them away), its state, or a new shape. Answers what was said.
   */
  async setPlace(id: string, fields: { name?: string | null; kind?: string; desc?: string | null; note?: string | null; map?: boolean | null; say?: boolean | null; build?: boolean | null; loading?: string[] | null; state?: string | null; shape?: LocationShape } & SkyFields): Promise<string> {
    const row = this.rowOf(id);
    if (!row) return this.said(`no place ${id} in this world's locations file`, false);
    const draft: Record<string, unknown> = { ...row };
    delete draft.at;
    skyInto(draft, fields);
    for (const k of ['name', 'desc', 'note', 'state'] as const) {
      if (!(k in fields)) continue;
      const v = fields[k];
      if (typeof v === 'string' && v.trim()) draft[k] = v.trim();
      else delete draft[k];
    }
    if (typeof fields.kind === 'string') {
      if (id === 'world' || fields.kind === 'world') return this.said("a place's kind is city, place, landmark, area or zone", false);
      draft.kind = fields.kind;
    }
    for (const k of ['map', 'say', 'build'] as const) {
      if (!(k in fields)) continue;
      const v = fields[k];
      if (typeof v === 'boolean') draft[k] = v;
      else delete draft[k];
    }
    if ('loading' in fields) {
      const lines = (fields.loading ?? []).map((l) => l.trim()).filter(Boolean);
      if (lines.length) draft.loading = lines;
      else delete draft.loading;
    }
    if (fields.shape) draft.shape = fields.shape;
    const after = readLocationRow(draft);
    if (typeof after === 'string') return this.said(`${row.name ?? id}: ${after}`, false);
    const skyOnly = Object.keys(fields).length > 0 && Object.keys(fields).every((k) => (SKY_FIELDS as readonly string[]).includes(k));
    return this.commit(`${row.name ?? id}'s ${skyOnly ? 'sky' : 'fields'}`, [{ file: 'locations', id, before: row, after }]);
  }

  /**
   * The world row's own fields (the Tools tab's, the console's): `cities` (true: the game's own cities, no-build areas and
   * radii kept clear of players' building; false takes the switch off) and its loading lines. A world row with nothing left
   * is taken out. Answers what was said.
   */
  async setWorld(fields: { cities?: boolean; loading?: string[] | null; sky?: SkyFields; skyWhole?: boolean }): Promise<string> {
    const no = this.refusal();
    if (no) return this.said(no, false);
    const was = this.rowOf('world') ?? null;
    const draft: Record<string, unknown> = was ? { ...was } : { id: 'world', kind: 'world' };
    delete draft.at;
    if (fields.cities === true) draft.cities = 'noBuild';
    else if (fields.cities === false) delete draft.cities;
    if ('loading' in fields) {
      const lines = (fields.loading ?? []).map((l) => l.trim()).filter(Boolean);
      if (lines.length) draft.loading = lines;
      else delete draft.loading;
    }
    // The world's own sky (the ninth wave): its family, weather kind and grade under every place's, and its climate, fog,
    // wind and clouds; given whole (the Tools tab's box), what it leaves out is taken away first.
    if (fields.sky) {
      if (fields.skyWhole) for (const k of SKY_FIELDS) delete draft[k];
      skyInto(draft, fields.sky);
    }
    const keeps = Object.keys(draft).some((k) => k !== 'id' && k !== 'kind');
    if (!keeps) {
      if (!was) return this.said('the world row says nothing yet: nothing written', true);
      return this.commit("the world row taken out (it said nothing more)", [{ file: 'locations', id: 'world', before: was, after: null }]);
    }
    const after = readLocationRow(draft);
    if (typeof after === 'string') return this.said(`the world row: ${after}`, false);
    const what = fields.cities === true ? "the game's own cities kept clear of players' building" : fields.cities === false ? "the game's own cities open to players' building again" : fields.sky ? "the world's own sky" : "the world's loading lines";
    return this.commit(what, [{ file: 'locations', id: 'world', before: was, after }]);
  }

  /** A place taken out of the file (one write, one undo). */
  async remove(id: string): Promise<string> {
    const row = this.rowOf(id);
    if (!row) return this.said(`no place ${id} in this world's locations file`, false);
    if (this.picked === id) this.picked = null;
    return this.commit(`${row.name ?? id} taken out`, [{ file: 'locations', id, before: row, after: null }]);
  }

  /** One write and one undo entry. */
  private async commit(label: string, changes: RowChange[]): Promise<string> {
    const host = this.host;
    let ok = false;
    const write = async (): Promise<string> => {
      const es = host.edits.beginStroke(label);
      const no = await host.edits.strokeWrite(es, changes);
      const said = host.edits.endStroke(es);
      if (no) return said || no;
      ok = true;
      return said || label;
    };
    this.lastOk = false;
    const w = write();
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

  /** The marks: every place's outline at the ground (the picked one moved and sized as held), its ring, the square, a draft. */
  private drawMarks(d: ToolDraw, view: ScreenView, outlines: Outline[], picked: Outline | null): void {
    const m = d.marks;
    let pts = 0;
    for (let l = 0; l < outlines.length; l++) pts += outlines[l].n;
    lakePools(m, outlines.length, pts, Math.max(6, this.draftN + 2));
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
      const s = isPicked ? this.scale : 1;
      if (isPicked) m.lakePicked = l;
      m.lakeSpans[l] = o.n;
      m.lakeBad[l] = o.bad ? 1 : 0;
      const pq = this.pq;
      for (let i = 0; i < o.n; i++) {
        pq[0] = o.cx + (o.pts[i * 2] - o.cx) * s + ox;
        pq[1] = o.ys[i];
        pq[2] = o.cz + (o.pts[i * 2 + 1] - o.cz) * s + oz;
        const vis = projectAt(pq, 0, vp, w, h, this.pt);
        m.lakeVis[k + i] = vis ? 1 : 0;
        m.lakePts[(k + i) * 2] = this.pt[0];
        m.lakePts[(k + i) * 2 + 1] = this.pt[1];
      }
      pq[0] = o.cx + ox;
      pq[1] = o.cy;
      pq[2] = o.cz + oz;
      const hv = projectAt(pq, 0, vp, w, h, this.pt);
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

  /**
   * A draft's marks into the kept `dq` (three numbers a point), projected through one call site: an outline's clicked points
   * and the aim, or a rectangle's four corners closed.
   */
  private draftMarks(view: ScreenView, m: ToolDraw['marks']): void {
    const f = this.f;
    const most = (Math.max(this.draftN, 4) + 2) * 3;
    if (this.dq.length < most) this.dq = new Float64Array(most * 2);
    const dq = this.dq;
    let n = 0;
    if (this.rectOn && f.valid) {
      const y0 = this.rectY;
      const y1 = f.y;
      dq[0] = this.rectX;
      dq[1] = y0;
      dq[2] = this.rectZ;
      dq[3] = f.x;
      dq[4] = y0;
      dq[5] = this.rectZ;
      dq[6] = f.x;
      dq[7] = y1;
      dq[8] = f.z;
      dq[9] = this.rectX;
      dq[10] = y1;
      dq[11] = f.z;
      dq[12] = this.rectX;
      dq[13] = y0;
      dq[14] = this.rectZ;
      n = 5;
    } else if (PLACES_TOOL_TUNE.mode === 'outline' && this.draftN) {
      const dx = this.dxzy;
      for (let i = 0; i < this.draftN; i++) {
        dq[n * 3] = dx[i * 3];
        dq[n * 3 + 1] = dx[i * 3 + 2];
        dq[n * 3 + 2] = dx[i * 3 + 1];
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

  /** The bar's words while armed. */
  barWords(): string {
    const t = PLACES_TOOL_TUNE;
    const mode = t.mode === 'circle' ? `a ${t.kind} by a click, ${Math.round(t.radius)} m round` : t.mode === 'rect' ? `a ${t.kind} by a drag${this.rectOn ? ' · let go to write it' : ''}` : `a ${t.kind} by clicks${this.draftN ? ` · ${this.draftN} points` : ''}`;
    const held = this.dragging ? ` · moving ${Math.sqrt(this.dragX * this.dragX + this.dragZ * this.dragZ).toFixed(1)} m` : this.scale !== 1 ? ` · sized ${Math.round(this.scale * 100)}%` : '';
    const pick = this.picked ? ` · ${this.picked} picked (drag its square, C with the wheel sizes it, Delete takes it out)` : '';
    return `places: ${mode}${pick}${held}${this.writing ? ' · writing' : ''}${this.last.said && !this.writing ? ` · ${this.last.said}` : ''}`;
  }

  /** For the console. */
  report(): Record<string, unknown> {
    return { armed: this.armed, mode: PLACES_TOOL_TUNE.mode, kind: PLACES_TOOL_TUNE.kind, radius: PLACES_TOOL_TUNE.radius, draft: this.draftN, rect: this.rectOn, picked: this.picked, dragging: this.dragging, sizing: this.scale !== 1 ? this.scale : 1, writing: !!this.writing, last: { ...this.last } };
  }
}

/** The places tool as an entry of the Tools list, on P. */
export function placesTool(p: EditorPlaces): ToolDef {
  return {
    id: 'places',
    action: 'editorPlaces',
    label: 'the places tool',
    armed: () => p.armed,
    arm: () => p.arm(),
    disarm: () => p.disarm(),
    step(f) {
      p.step(f);
    },
    draw: (d) => p.draw(d),
    overlay: (d, view) => p.overlay(d, view),
    owns: (b) => b === 'apply' || b === 'inverse',
    size: (notches) => p.size(notches),
    deleteKey: () => p.deleteKey(),
    escape: () => p.escape(),
    barWords: () => p.barWords(),
    report: () => p.report(),
  };
}
