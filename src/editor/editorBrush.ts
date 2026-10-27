// The world editor's scatter brush, put together (DESIGN.md §2.8): the glue between the pure rules (`brush.ts`) and the
// editing (`EditorEdits`), made by the editor (`editorEntry.ts`) and handed its frame.
//
// **Its entries** are the library's, chosen by Shift+click (each with a weight, 1 to start, set on the Tools tab), or
// with none chosen the one thing in hand; B arms it with them (each entry's pack in and what it writes worked out once),
// and B again, Escape, or taking anything in hand lets it go. **A stroke** is a button held over the ground -- the left
// paints, the right erases -- with a seed of its own: its stamps come `rate` times a second whatever the frame rate
// (`stampsDue`), each worked out from what stands at that moment and **written at once** as a batch of its own (so the
// next stamp counts and spaces from what the last one stood), and the whole stroke is **one undo entry**
// (`EditorEdits.beginStroke`, `strokeWrite`, `endStroke`). A paint stamp writes ordinary rows into the destination file
// (`rowFromEditor`, its ground, its turn and a scale of its own); an erase stamp takes rows of the brush's entries out of
// the destination file only, so a stroke never reaches into the other file. A stamp waits while another write is out.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace,
// no constructor parameter properties. The dev server's alone: reached only through the editor's own dynamic import.

import * as THREE from 'three';
import { rowFromEditor, type EditorSource } from '../world/permanentEdit.ts';
import { footprintOf } from '../world/permanent.ts';
import { PLACEMENT_KEY_PREFIX, writtenScale, type PlacementLayer, type PlacementRow } from '../story/placements.ts';
import { BRUSH_TUNE, EDITOR_TUNE } from './editorTune.ts';
import { brushRandom, brushTarget, eraseStamp, paintStamp, startClock, stampsDue, type BrushClock, type BrushEntry, type BrushGround, type BrushNear } from './brush.ts';
import { leanTo } from './snapping.ts';
import { entryForRow, entryKey, type LibraryView } from './libraryModel.ts';
import type { EditorEdits, Stroke } from './editorEdit.ts';
import type { RowChange } from './undo.ts';

/**
 * What one entry of the brush writes: the row's source, its model's box, whether it is meant for the water, and whether it
 * is a building -- which the brush stands as the hand stands one, its origin (its doorstep) on the ground at its own size
 * with the plants kept off its patch (`clear`), never by its box's lowest point (a player house's box reaches about 16 m
 * under its doorstep, a foundation meant to be buried, and stood by it the house floated that high) nor at a scale (a
 * building with rooms takes none, and one written would be set aside by its stand after its height was worked out for it).
 */
export interface BrushSource {
  key: string;
  /** The id a row of it is minted from (its thing or its model). */
  id: string;
  src: EditorSource;
  bounds: { min: number[]; max: number[] } | null;
  water: boolean;
  building?: boolean;
  /** For a building, the circle the plants are kept off (the hand's own rule, `clearRadius` of its patch). */
  clear?: number;
}

/** What stands near the disc as the brush asks the game for it: a place, a row of the files where it is one, and its turned box. */
export interface BrushNearThing extends BrushNear {
  /** A row of this world's files: its id, its file and the row. */
  id?: string;
  layer?: PlacementLayer;
  row?: PlacementRow;
  /** Its own box at its scale and its turn (three's `[x, y, z, w]`), for keeping off what stands; null for none. */
  box?: { min: number[]; max: number[] } | null;
  q?: readonly [number, number, number, number];
}

/** What the brush needs of the editor and the game. */
export interface BrushHost {
  readonly edits: EditorEdits;
  /** What a library entry writes, its pack brought in first, or why not. */
  source(key: string): Promise<BrushSource | string>;
  /** Everything standing within `reach` of (`cx`, `cz`): the files' rows (with whether each is one of `keys`) and the placed objects. */
  near(cx: number, cz: number, reach: number, keys: ReadonlySet<string>): BrushNearThing[];
  /** The ground and the water under a point. */
  ground(x: number, z: number): number;
  water(x: number, z: number): number;
  centre(): { x: number; z: number } | null;
  frame(): 'raw' | 'game';
  packId(): string;
  inSpace(): boolean;
  dest(): PlacementLayer;
  cameraYaw(): number;
  say(words: string, ok: boolean): void;
}

const UP = new THREE.Vector3(0, 1, 0);

/** The brush. */
export class EditorBrush {
  /** The chosen entries by library key, with their weights. Kept for the session. */
  readonly set = new Map<string, number>();
  armed = false;
  /** What the armed entries write, in the order chosen. */
  private sources: BrushSource[] = [];
  private entries: BrushEntry[] = [];
  private keys = new Set<string>();
  private armGen = 0;
  /** The stroke under way: paint, erase, or none; its clock and its generator; the seed it began with. */
  mode: 'paint' | 'erase' | null = null;
  private readonly clock: BrushClock = { owed: 0 };
  private rand: () => number = brushRandom(1);
  seed = 0;
  private strokes = 0;
  /** A stamp being written: the next waits for it, and a stroke's end waits for its last. */
  private inFlight: Promise<void> | null = null;
  /** What the last stamp came to, for the console. */
  last = { mode: '', planted: 0, erased: 0, target: 0, counted: 0 };
  private readonly host: BrushHost;
  private readonly q = new THREE.Quaternion();
  private readonly tmp = new THREE.Vector3();
  private readonly lean = { x: 0, y: 0, z: 0, w: 1 };

  constructor(host: BrushHost) {
    this.host = host;
  }

  /** An entry chosen for the brush, or let go of (Shift+click in the library). Answers whether it is chosen now. */
  toggle(key: string): boolean {
    if (this.set.has(key)) this.set.delete(key);
    else this.set.set(key, 1);
    return this.set.has(key);
  }

  /** An entry's weight among the rest (0 leaves it chosen and never drawn). */
  setWeight(key: string, w: number): void {
    if (!this.set.has(key) || !Number.isFinite(w)) return;
    this.set.set(key, Math.max(0, w));
    const i = this.sources.findIndex((s) => s.key === key);
    if (i >= 0) this.entries[i].weight = Math.max(0, w);
  }

  /**
   * B: armed with the chosen entries (or, with none chosen, `fallback`, the thing in hand), each worked out once (its pack
   * brought in). Answers what was said.
   */
  async arm(fallback: string | null): Promise<string> {
    const gen = ++this.armGen;
    if (!this.set.size && fallback) this.set.set(fallback, 1);
    if (!this.set.size) {
      const words = 'the brush paints the library entries Shift+clicked, or what is in hand: choose some first';
      this.host.say(words, false);
      return words;
    }
    if (this.host.inSpace()) {
      const words = 'the brush paints the ground: a space zone has none';
      this.host.say(words, false);
      return words;
    }
    const got: BrushSource[] = [];
    const why: string[] = [];
    for (const key of this.set.keys()) {
      const s = await this.host.source(key);
      if (gen !== this.armGen) return 'given up';
      if (typeof s === 'string') why.push(s);
      else got.push(s);
    }
    if (!got.length) {
      const words = `the brush has nothing to paint with: ${why.join('; ')}`;
      this.host.say(words, false);
      return words;
    }
    this.sources = got;
    this.entries = got.map((s) => ({ key: s.key, weight: this.set.get(s.key) ?? 1, water: s.water }));
    this.keys = new Set(got.map((s) => s.key));
    this.armed = true;
    const words = `the brush: ${got.length} entr${got.length === 1 ? 'y' : 'ies'} (LMB paints, RMB erases, B lets go)${why.length ? `; left out: ${why.join('; ')}` : ''}`;
    this.host.say(words, true);
    return words;
  }

  /** B again, Escape, a thing taken in hand or the world gone: the brush let go, a stroke under way ended (and recorded). */
  disarm(): void {
    this.armGen++;
    this.end();
    this.armed = false;
  }

  /**
   * The frame's ask, one kept record the editor writes before `frame`: `paint` or `erase` held (the buttons), the disc's
   * middle on the ground (`valid` where the aim met something) and the frame's seconds. Its numbers ride the record, since
   * a number handed to a call the compiler leaves out is boxed. Fractions from the start.
   */
  readonly ask = { paint: false, erase: false, cx: 0.5, cz: 0.5, valid: false, dt: 0.016 };

  /**
   * One frame, from `ask`. A stroke begins on the first frame a button is held, stamps as its clock says, and ends the frame
   * neither is held. Makes nothing on a frame with no stroke under way.
   */
  frame(): void {
    if (!this.armed) return;
    const a = this.ask;
    const want = a.erase ? 'erase' : a.paint ? 'paint' : null;
    if (want !== this.mode) {
      this.end();
      if (want) this.begin(want);
    }
    const s = this.stroke;
    if (!this.mode || !s || !a.valid) return;
    const n = stampsDue(this.clock, a.dt, Math.max(0.01, BRUSH_TUNE.rate));
    if (!n || this.inFlight || this.host.edits.writing) return;
    this.inFlight = this.stamp(s, this.mode, a.cx, a.cz).then(
      () => {
        this.inFlight = null;
      },
      () => {
        this.inFlight = null;
      },
    );
  }

  /** The stroke the buttons are making now (`EditorEdits.beginStroke`), or null. */
  private stroke: Stroke | null = null;

  /** A stroke begun: a seed of its own (or the one given), its first frame stamping at once. */
  private begin(mode: 'paint' | 'erase', seed?: number): Stroke {
    this.mode = mode;
    this.strokes++;
    this.seed = seed ?? (((Date.now() & 0xffffffff) ^ Math.imul(this.strokes, 0x9e3779b1)) >>> 0);
    this.rand = brushRandom(this.seed);
    startClock(this.clock);
    const s = this.host.edits.beginStroke(mode === 'paint' ? 'paint' : 'erase');
    this.stroke = s;
    return s;
  }

  /** The stroke ended: once its last stamp has written, the whole of it recorded as one action. */
  private end(): void {
    const s = this.stroke;
    this.mode = null;
    this.stroke = null;
    if (!s) return;
    const edits = this.host.edits;
    const last = this.inFlight;
    if (last) void last.then(() => edits.endStroke(s));
    else edits.endStroke(s);
  }

  /** A whole stroke at a point (the console's): `stamps` stamps, one after another, one undo entry. Answers what was said. */
  async strokeAt(cx: number, cz: number, mode: 'paint' | 'erase', stamps: number, seed?: number): Promise<string> {
    if (!this.armed) return 'the brush is not armed: editor({ brush: { arm: true } }) or B';
    if (this.inFlight) await this.inFlight;
    this.end();
    const s = this.begin(mode, seed);
    // Not the buttons' stroke: a frame between the awaits would end it.
    this.stroke = null;
    this.mode = null;
    let planted = 0;
    let erased = 0;
    for (let i = 0; i < Math.max(1, Math.floor(stamps)); i++) {
      await this.stamp(s, mode, cx, cz);
      planted += this.last.planted;
      erased += this.last.erased;
    }
    const said = this.host.edits.endStroke(s);
    return `${said} (seed ${this.seed}, ${planted} planted, ${erased} taken)`;
  }

  /** One stamp of a stroke at (`cx`, `cz`): worked out from what stands now, and written. */
  private async stamp(stroke: Stroke, mode: 'paint' | 'erase', cx: number, cz: number): Promise<void> {
    const t = BRUSH_TUNE;
    const h = this.host;
    const reach = t.radius + Math.max(0, t.spacing) + 1;
    const near = h.near(cx, cz, reach, this.keys);
    this.last = { mode, planted: 0, erased: 0, target: 0, counted: 0 };
    if (mode === 'erase') {
      const dest = h.dest();
      // Only the destination file's rows of the brush's own entries are the brush's to take.
      const own = near.filter((p) => p.mine && p.row && p.layer === dest);
      const picked = eraseStamp(t, cx, cz, own, this.rand);
      if (!picked.length) return;
      const changes: RowChange[] = picked.map((i) => ({ file: own[i].layer!, id: own[i].id!, before: own[i].row!, after: null }));
      const no = await h.edits.strokeWrite(stroke, changes);
      if (!no) this.last.erased = changes.length;
      return;
    }
    const ground: BrushGround = {
      ground: (x, z) => h.ground(x, z),
      water: (x, z) => h.water(x, z),
      blocked: (x, z) => blockedAt(near, x, z),
    };
    const plants = paintStamp(t, cx, cz, this.entries, near, ground, this.rand, h.cameraYaw());
    // What the disc held of its own and aimed at, said even when the stamp planted nothing (the disc full, or nothing fit).
    let counted = 0;
    for (const n of near) if (n.mine && (n.x - cx) ** 2 + (n.z - cz) ** 2 <= t.radius * t.radius) counted++;
    this.last.counted = counted;
    this.last.target = brushTarget(t);
    if (!plants.length) return;
    const dest = h.dest();
    const centre = h.centre();
    const frame = h.frame();
    const here = h.packId();
    const ids = h.edits.mintIds(plants.map((p) => this.sources[p.entry].id));
    const changes: RowChange[] = [];
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      const s = this.sources[p.entry];
      const q = this.q.setFromAxisAngle(UP, p.yaw);
      // A building is only ever turned about up, as the hand turns one.
      if (t.align && !s.building) {
        const l = this.lean;
        l.x = q.x;
        l.y = q.y;
        l.z = q.z;
        l.w = q.w;
        leanTo(l, p.nx, p.ny, p.nz, t.alignMax, l);
        q.set(l.x, l.y, l.z, l.w);
      }
      // A building at its own size (`BrushSource`); the stamp's scale was drawn all the same, so the seed decides alike.
      const sc = s.building ? 1 : Math.round(p.scale * 10 ** EDITOR_TUNE.write.scaleDigits) / 10 ** EDITOR_TUNE.write.scaleDigits;
      // Stood as the hand stands a thing: a prop or a tree by its box's lowest point on the ground at its scale and turn, a
      // building by its origin on it.
      const low = !s.building && s.bounds ? lowest(s.bounds, sc, q, this.tmp) : 0;
      const row = rowFromEditor(s.src, { x: p.x, y: p.y - low, z: p.z }, [q.x, q.y, q.z, q.w], false, centre, frame, { here, ground: p.y, clear: s.building ? s.clear : undefined, mm: EDITOR_TUNE.write.mm, turnDigits: EDITOR_TUNE.write.turnDigits }) as PlacementRow;
      row.id = ids[i];
      const w = s.building ? undefined : writtenScale([sc, sc, sc]);
      if (w !== undefined) row.scale = w;
      changes.push({ file: dest, id: ids[i], before: null, after: row });
    }
    const no = await h.edits.strokeWrite(stroke, changes);
    if (!no) this.last.planted = changes.length;
  }

  /** For the console and the bar. */
  report(): Record<string, unknown> {
    return {
      armed: this.armed,
      entries: [...this.set.entries()].map(([key, weight]) => ({ key, weight, ready: this.keys.has(key) })),
      stroke: this.mode,
      seed: this.seed,
      last: { ...this.last },
      tune: { ...BRUSH_TUNE },
    };
  }

  /** Whether an entry of the library is chosen for the brush. */
  has(key: string): boolean {
    return this.set.has(key);
  }
}

/** A placed object as `brushNearOf` reads it (the streamer's `PlacedObject`). */
export interface BrushPlaced {
  template: string;
  contained: boolean;
  x: number;
  z: number;
  q: { x: number; y: number; z: number; w: number };
  scale?: { x: number; y: number; z: number };
}

/** What the game hands `brushNearOf` (`EditorEntry.brushNear`): the library, this world's rows standing and the streamer's placed objects. */
export interface BrushNearWorld<O extends BrushPlaced> {
  /** The library as the editor holds it (null before it has loaded), and this world's pack id: what a row is an entry of. */
  view: LibraryView | null;
  here: string;
  /** This world's rows standing now, at their places in the game's frame. */
  rows: Iterable<{ id: string; row: PlacementRow; layer: PlacementLayer; x: number; z: number }>;
  /** The placed object a row stands as, or null. */
  placedOfRow(id: string): O | null;
  /** Every placed object whose place falls in a rectangle of the game's frame, each handed to `visit` (false stops). */
  forEachPlacedIn(rect: { x0: number; z0: number; x1: number; z1: number }, visit: (o: O) => boolean): void;
  /** A placed object's own box, unscaled, or null. */
  boxOf(o: O): { min: number[]; max: number[] } | null;
}

/**
 * What stands near the brush's disc (`BrushHost.near`), by the game's own rules: every row of this world's files standing
 * within `reach` of (`cx`, `cz`), with its id, file, row, its box at its scale and its turn, and whether it is **the brush's
 * own** -- a row whatever its id whose library entry (`entryForRow`, the eyedropper's rule) is one of `keys`, which it counts
 * toward the density and may erase; and every other placed object (none of the files', none in a building's rooms) whose
 * box at its scale reaches the disc, which only spaces the brush and keeps it off. A stamp's work, never a frame's.
 */
export function brushNearOf<O extends BrushPlaced>(w: BrushNearWorld<O>, cx: number, cz: number, reach: number, keys: ReadonlySet<string>): BrushNearThing[] {
  const out: BrushNearThing[] = [];
  const r2 = reach * reach;
  for (const r of w.rows) {
    if ((r.x - cx) ** 2 + (r.z - cz) ** 2 > r2) continue;
    const e = w.view ? entryForRow(w.view, r.row, w.here) : null;
    const o = w.placedOfRow(r.id);
    const b = o ? w.boxOf(o) : null;
    out.push({ x: r.x, z: r.z, mine: !!e && keys.has(entryKey(e)), id: r.id, layer: r.layer, row: r.row, box: b ? scaledBox(b, o?.scale) : null, ...(o ? { q: [o.q.x, o.q.y, o.q.z, o.q.w] as const } : {}) });
  }
  const rect = { x0: cx - reach, z0: cz - reach, x1: cx + reach, z1: cz + reach };
  w.forEachPlacedIn(rect, (o) => {
    if (o.template.startsWith(PLACEMENT_KEY_PREFIX) || o.contained) return true;
    const b = w.boxOf(o);
    const ext = b ? Math.max(Math.abs(b.min[0]), Math.abs(b.max[0]), Math.abs(b.min[2]), Math.abs(b.max[2])) * Math.max(o.scale?.x ?? 1, o.scale?.z ?? 1) : 0;
    const d = Math.sqrt((o.x - cx) ** 2 + (o.z - cz) ** 2);
    if (d - ext > reach) return true;
    out.push({ x: o.x, z: o.z, mine: false, box: b ? scaledBox(b, o.scale) : null, q: [o.q.x, o.q.y, o.q.z, o.q.w] });
    return true;
  });
  return out;
}

/** A box at a scale along its own axes (itself with none). */
export function scaledBox(b: { min: number[]; max: number[] }, s: { x: number; y: number; z: number } | undefined): { min: number[]; max: number[] } {
  if (!s) return b;
  return { min: [b.min[0] * s.x, b.min[1] * s.y, b.min[2] * s.z], max: [b.max[0] * s.x, b.max[1] * s.y, b.max[2] * s.z] };
}

/** Whether a point stands inside anything near's box (its footprint on the ground, turned the way it stands); the brush's own rows are spaced and not boxed. */
export function blockedAt(near: readonly BrushNearThing[], x: number, z: number): boolean {
  const fp = { ex: 1, ez: 0, u0: 0, u1: 0, v0: 0, v1: 0 };
  for (const n of near) {
    if (n.mine || !n.box || !n.q) continue;
    footprintOf(n.box, n.q, fp);
    const dx = x - n.x;
    const dz = z - n.z;
    const u = dx * fp.ex + dz * fp.ez;
    const v = dz * fp.ex - dx * fp.ez;
    if (u >= fp.u0 && u <= fp.u1 && v >= fp.v0 && v <= fp.v1) return true;
  }
  return false;
}

/** How far a box's lowest point stands under its origin, scaled by `s` and turned by `q`. */
function lowest(b: { min: number[]; max: number[] }, s: number, q: THREE.Quaternion, tmp: THREE.Vector3): number {
  let low = Infinity;
  for (let i = 0; i < 8; i++) {
    tmp.set((i & 1 ? b.max[0] : b.min[0]) * s, (i & 2 ? b.max[1] : b.min[1]) * s, (i & 4 ? b.max[2] : b.min[2]) * s).applyQuaternion(q);
    if (tmp.y < low) low = tmp.y;
  }
  return Number.isFinite(low) ? low : 0;
}
