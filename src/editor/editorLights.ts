// The world editor's lights tool (Map-maker II's wave of the rooms' lights, the owner's of 2026-11-02): the rooms' lights shown,
// picked, edited and put down, written into the lights files (`public/placements/lights/<world>.json`, and `lights.json` for
// every copy everywhere: `src/world/editFiles/lightsFile.ts`). The Tools list's entry on `;` (`lightsTool`).
//
// **What it shows**: a marker of ours for every light of the building round the camera (its rooms' own lights the game placed,
// in `muted`, and the lights the files add to this copy, in `accent`), every light standing outdoors near the eye, and every
// light hung on a row, each an icon on the overlay (`MarksView.light...`, never a mesh in the scene); a light that lights nothing
// now (switched off, a spot with no spot slot built, one outdoors) in `warn`. The picked one's reach is drawn as a ring, a
// spot's as its cone.
//
// **Editing a light is the editor's normal object editing**: a click on a marker picks it; a light of ours moves with the
// gizmo's arrows and ground square (the grabbed point kept under the cursor), F held raises it and R held turns it (a spot's
// cone and a directional's way follow the turn, Shift+R tips it) by the placing hand's own rates (`liftDelta`, `turnDelta`),
// the arrows and Page Up/Down nudge it a grid step, Ctrl+D duplicates it beside itself, Delete takes it out, Escape lets it go;
// one of the game's own is picked the same way and edited at the tool's scope (its brightness, colour, reach, off, a shadow
// asked for; Delete switches it off). Every change is one write and one undo (`EditorEdits.putRows`), the world lands it by
// difference as the answer comes (`App.editorBatch`), and the room pool plans the lit room again: uniforms and places alone,
// nothing compiles. While a light is moved the pool carries it where the hand has it (`LightsHost.live`), so what the editor
// shows is what every browser will stand from the file.
//
// **Putting one down**: a preset (the Tools tab's buttons, or the library's Lights source) is put down by the next click where
// the aim meets the world: in a room, a light of that room at the tool's scope (one copy, every copy on this world, every copy
// everywhere); outdoors, an outdoor light (a mark this pass, which lights nothing until the Light and shadow pass's outdoor
// pool, said in words); or, with "hang it on the row" on and a row of ours under the aim, hung on that row (`attach`'s `light`,
// so a lamp prop carries it). Its numbers are the preset's (`LIGHT_PRESETS`, the owner's to move).
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties. The dev server's alone: reached only through the editor's own dynamic import.

import * as THREE from 'three';
import type { CellLight } from '../world/assetPack.ts';
import { lightPools } from '../ui/editorMarks.ts';
import { RING_MARKS } from '../ui/editorMarks.ts';
import type { EditorSection } from '../ui/editorWindow.ts';
import { cursor, dragAt, gizmoDrag, gizmoLayout, grabAt, H, handlesFor, layoutGizmo, pickAt, ray3, rayAt, worldAxes, type ScreenView } from './gizmo.ts';
import type { EditorEdits } from './editorEdit.ts';
import type { RowChange } from './undo.ts';
import type { ToolDef, ToolDraw, ToolFrame } from './tools.ts';
import { PLACE_HOLD_TUNE } from '../world/placeHold.ts';
import { ALL_ID_PREFIX, isCopyKey, mintLightId, specOfRow, type LightRow, type LightScope } from '../world/editFiles/lightsFile.ts';
import { DEFAULT_CONE, DEFAULT_REACH, FLICKER_SHAPES, LIGHT_LIMITS, LIGHT_TYPES, coneOf, lightSpecFields, readLightSpec, type FlickerShape, type LightSpec, type LightType } from '../story/lightSpec.ts';
import { pointLightAt3, pointLightRange, shineOf, type PoolShape, type RoomLightsPlanned } from '../world/roomLights.ts';
import type { AttachedLight } from '../world/rowAttach.ts';

/**
 * The lights tool's own numbers (ours, feel: the owner's, live through `__debug.roomLights({ tune: { tool } })` and the debug
 * menu's sliders under `roomLights`): a marker's half size and how near the cursor picks one, how far from the eye an outdoor
 * light is shown, the gizmo's size, how near the cursor grabs a handle, how many metres a duplicate stands beside its light, and
 * where a light put down stands over the aim's hit.
 */
export const LIGHTS_TOOL_TUNE = {
  markerPx: 8,
  pickPx: 12,
  /** Metres from the eye an outdoor light, or one hung on a row, is shown: a street's length. */
  near: 80,
  gizmoPx: 90,
  hitPx: 10,
  /** A duplicate stands this many metres to the camera's right of its light (0: the grid step). */
  dupStep: 0,
  /** Metres over the hit a light put down stands: off the surface, so a lamp on a table lights it rather than standing in it. */
  lift: 0.3,
};

/** One preset: its id, its name in words, and its light (`lightSpec.ts`). */
export interface LightPreset {
  id: string;
  name: string;
  spec: LightSpec;
}

/**
 * The presets the Tools tab and the library's Lights source offer (ours, feel: the owner's, here; a light put down from one
 * is then his to change on the Selected tab): a candle, a ceiling lamp, a desk spot, a cantina's warm fill, a failing tube
 * and the room's sunlight. Their brightness is the room rule's own (a lamp's value at 3 m: the game's own run 0.2 to 2).
 */
export const LIGHT_PRESETS: LightPreset[] = [
  { id: 'candle', name: 'A candle', spec: { type: 'point', color: [1, 0.62, 0.32], brightness: 0.25, reach: 5, flicker: { shape: 'candle', rate: 5, depth: 0.35 } } },
  { id: 'ceiling-lamp', name: 'A ceiling lamp', spec: { type: 'point', color: [1, 0.92, 0.8], brightness: 1.2, reach: 14 } },
  { id: 'desk-spot', name: 'A desk spot', spec: { type: 'spot', color: [1, 0.9, 0.75], brightness: 1, reach: 8, cone: [20, 32] } },
  { id: 'cantina-fill', name: "A cantina's warm fill", spec: { type: 'point', color: [1, 0.55, 0.3], brightness: 0.6, reach: 22 } },
  { id: 'failing-tube', name: 'A failing tube', spec: { type: 'point', color: [0.75, 0.9, 1], brightness: 0.8, reach: 10, flicker: { shape: 'broken', rate: 1.5, depth: 0.9 } } },
  { id: 'room-sun', name: "The room's sunlight (directional)", spec: { type: 'directional', color: [1, 0.95, 0.85], brightness: 1 } },
];

/** A preset by its id, or null. */
export function presetOf(id: string): LightPreset | null {
  return LIGHT_PRESETS.find((p) => p.id === id) ?? null;
}

/** A building as the tool marks its lights: itself (by identity), its model, its copy key, its template, its frame, its rooms. */
export interface LightsBuilding {
  ref: object;
  model: string;
  copy: string | null;
  template: string;
  /** The room lit now (the camera's). */
  cell: number;
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
  cells: readonly { index: number; name: string; lights?: readonly CellLight[] }[];
  /** Where it stands and how far it reaches along the ground (the game frame's x and z and its radius): past it is outdoors. */
  x?: number;
  z?: number;
  radius?: number;
}

/** What the light the hand is moving now is handed over in: its key ('' for none), its place and way in the building's frame. */
export interface LiveLight {
  key: string;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
}

/** What the lights tool needs of the editor and the game. */
export interface LightsHost {
  readonly edits: EditorEdits;
  worldKind(): 'ground' | 'space' | 'copies';
  /** The lights files' rows in force (this world's, the shared one's), as the last landing left them. */
  rows(): { world: readonly LightRow[]; all: readonly LightRow[] };
  /** The building the camera's room is in, or null. */
  cameraBuilding(): LightsBuilding | null;
  /** The building and room a point of the game's frame stands in, by the editor's own room rule; null outdoors. */
  roomAt(x: number, y: number, z: number): { building: LightsBuilding; cell: number } | null;
  /** A point of the game's frame in the file's raw frame and back (a space zone's are the game's), into a kept record. */
  toRaw(x: number, z: number, out: { x: number; z: number }): void;
  toGame(x: number, z: number, out: { x: number; z: number }): void;
  /** The pool's shape now and the plan the lit room was lit by (and its version, moved by every plan). */
  shape(): Readonly<PoolShape>;
  plan(): RoomLightsPlanned | null;
  planVersion(): number;
  /** The light the hand is moving written into the pool a frame (`key` '' lets go): nothing made. */
  live(l: LiveLight): void;
  /** The lights hung on rows standing now. */
  attached(): readonly AttachedLight[];
  /** A row of ours under the aim (to hang a light on), its file, and its model frame; null for none. */
  rowUnderAim(): { id: string; layer: 'story' | 'world'; row: Record<string, unknown>; matrix: THREE.Matrix4 } | null;
  /** The camera's look along the ground (unit, x and z) and the eye, written into kept records. */
  look(out: { x: number; z: number }): void;
  eye(out: { x: number; y: number; z: number }): void;
  grid(): number;
  say(words: string, ok: boolean): void;
  refresh(): void;
}

/** Where a marker comes from: one of the game's own lights, a row of a room, an outdoor row, a light hung on a row. */
export type MarkerSource = 'game' | 'room' | 'outdoor' | 'attached';

/** The markers as laid out for the building round the camera and near it: kept arrays, grown, written when anything moved. */
interface Markers {
  n: number;
  xyz: Float64Array;
  dir: Float64Array;
  reach: Float64Array;
  angle: Float64Array;
  type: Uint8Array;
  warn: Uint8Array;
  src: MarkerSource[];
  key: string[];
  cell: Int32Array;
  /** A room row's or an outdoor row's own row; null for the game's own and an attached light. */
  row: (LightRow | null)[];
  /** A game light's index in its cell; -1 otherwise. */
  game: Int32Array;
}

function markers(): Markers {
  return { n: 0, xyz: new Float64Array(0), dir: new Float64Array(0), reach: new Float64Array(0), angle: new Float64Array(0), type: new Uint8Array(0), warn: new Uint8Array(0), src: [], key: [], cell: new Int32Array(0), row: [], game: new Int32Array(0) };
}

function grow(m: Markers, n: number): void {
  if (m.type.length >= n) return;
  const cap = Math.max(n, m.type.length * 2, 16);
  m.xyz = new Float64Array(cap * 3);
  m.dir = new Float64Array(cap * 3);
  m.reach = new Float64Array(cap);
  m.angle = new Float64Array(cap);
  m.type = new Uint8Array(cap);
  m.warn = new Uint8Array(cap);
  m.cell = new Int32Array(cap);
  m.game = new Int32Array(cap);
}

/** A number to a centimetre (divided by the steps a metre, so the file reads `1.1`, never `1.1000000000000001`). */
function cm(v: number): number {
  return Math.round(v * 100) / 100;
}

/** A turn's part to six decimals. */
function q6(v: number): number {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

/** A turn (`[w, x, y, z]`) that takes straight down to `dir` (unit), to six decimals; null for straight down itself. */
export function turnToward(dir: { x: number; y: number; z: number }): [number, number, number, number] | null {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dir.x, dir.y, dir.z).normalize());
  const t: [number, number, number, number] = [q6(q.w), q6(q.x), q6(q.y), q6(q.z)];
  const n = Math.sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2] + t[3] * t[3]) || 1;
  const out: [number, number, number, number] = [q6(t[0] / n), q6(t[1] / n), q6(t[2] / n), q6(t[3] / n)];
  return out[0] === 1 && out[1] === 0 && out[2] === 0 && out[3] === 0 ? null : out;
}

/** The file a row of a scope is kept in: the shared one for every copy everywhere, else the world's. */
export function fileOfScope(scope: LightScope): 'lights' | 'lightsAll' {
  return scope === 'all' ? 'lightsAll' : 'lights';
}

/** A row as a write carries it: every field but its time. */
function bare(r: LightRow): LightRow {
  const { at: _at, ...rest } = r;
  return rest as LightRow;
}

/** The lights tool. */
export class EditorLights {
  armed = false;
  private readonly host: LightsHost;
  /** The scope a light put down and an edit are written at: one copy, every copy on this world, every copy everywhere. */
  scope: 'copy' | 'world' | 'all' = 'copy';
  /** The preset a click puts down, or null (a click only picks). */
  adding: LightPreset | null = null;
  /** A light put down hangs on the row of ours under the aim (else a light of the room, or outdoors). */
  hang = false;
  /** The marker picked, by source and key ('' for none). */
  pickedKey = '';
  pickedSrc: MarkerSource | null = null;
  private readonly m = markers();
  /** What the markers were laid out from: refreshed only when one of these moved. */
  private seenRows: object | null = null;
  private seenAll: object | null = null;
  private seenBuilding: object | null = null;
  private seenPlan = -1;
  private seenAttached: object | null = null;
  private seenShape = -1;
  private readonly seenEye = new Float64Array([Number.NaN, Number.NaN]);
  private building: LightsBuilding | null = null;
  // A hand on the picked light: a drag of a handle, F or R held; and what it comes to now (world metres and radians).
  private dragging = false;
  private moveX = 0.5;
  private moveY = 0.5;
  private moveZ = 0.5;
  private yaw = 0.5;
  private tip = 0.5;
  private holding = false;
  private writing = false;
  private wasApply = false;
  private wasLift = false;
  private wasTurn = false;
  private lastSy = Number.NaN;
  private lastSx = Number.NaN;
  private readonly f: ToolFrame = { apply: false, inverse: false, shift: false, sampled: false, x: 0.5, y: 0.5, z: 0.5, valid: false, dt: 0.016, now: 0.5, sx: 0.5, sy: 0.5, dy: 0.5, lift: false, turn: false, dx: 0.5 };
  // Kept for the frame: nothing in a steady frame is made.
  private readonly layout = gizmoLayout();
  private readonly drag = gizmoDrag();
  private readonly axes = worldAxes();
  private readonly cur = cursor();
  private readonly ray = ray3();
  private readonly pivot = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly liveRec: LiveLight = { key: '', x: 0.5, y: 0.5, z: 0.5, dx: 0.5, dy: 0.5, dz: 0.5 };
  private readonly pt = new Float64Array(2);
  private readonly look = { x: 0.5, z: 0.5 };
  private readonly eyeAt = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly at = { x: 0.5, z: 0.5 };
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly qa = new THREE.Quaternion();
  /** The tip's axis, kept apart from the two scratch vectors a caller may be holding a place in. */
  private readonly axisV = new THREE.Vector3();
  private hotIndex = -1;
  /** What the last action came to, for the console and the bar. */
  last = '';

  constructor(host: LightsHost) {
    this.host = host;
    this.hdy = 0;
    this.hdx = 0;
    // Fractions from the start (a field that starts whole boxes every fraction written into it), nought from here.
    this.moveX = 0;
    this.moveY = 0;
    this.moveZ = 0;
    this.yaw = 0;
    this.tip = 0;
  }

  /**
   * A marker's row as its file holds it now (by its id, in its scope's file), never the row the markers were last laid out
   * from: a write of the editor's own lands between frames, and a row read before it is refused as changed since.
   */
  private rowAt(i: number): LightRow | null {
    const was = this.m.row[i];
    if (!was) return null;
    const rows = this.host.rows();
    const list = was.scope === 'all' ? rows.all : rows.world;
    for (const r of list) if (r.id === was.id) return r;
    return null;
  }

  /** Whether a write or a held move is under way (the automatic fold's quiet). */
  get busy(): boolean {
    return this.writing || this.dragging || this.holding;
  }

  /** `;`: armed. Every kind of world has rooms (a space zone's stations, the dungeons' copies). */
  async arm(): Promise<string> {
    this.armed = true;
    const words = `the lights tool: click a light to pick it${this.adding ? `, or put ${this.adding.name.toLowerCase()} down where you click` : ''} (; lets go)`;
    this.host.say(words, true);
    return words;
  }

  /** `;` again, Escape, a thing in hand, the world gone: let go, a held move given up (nothing written). */
  disarm(): void {
    this.armed = false;
    this.giveUpHeld();
  }

  /** The world went: everything dropped. */
  worldGone(): void {
    this.disarm();
    this.pickedKey = '';
    this.pickedSrc = null;
    this.seenRows = null;
    this.seenBuilding = null;
    this.building = null;
    this.m.n = 0;
  }

  private giveUpHeld(): void {
    this.dragging = false;
    this.holding = false;
    this.moveX = 0;
    this.moveY = 0;
    this.moveZ = 0;
    this.yaw = 0;
    this.tip = 0;
    this.liveRec.key = '';
    this.host.live(this.liveRec);
  }

  /** Escape while armed: a held move, else the preset in hand, else the picked light let go; answers whether it took the key. */
  escape(): boolean {
    if (this.dragging || this.holding) {
      this.giveUpHeld();
      this.host.say('given up: nothing written', true);
      return true;
    }
    if (this.adding) {
      this.adding = null;
      this.host.say('nothing to put down: a click picks a light', true);
      return true;
    }
    if (this.pickedKey) {
      this.pickedKey = '';
      this.pickedSrc = null;
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
    k.turn = f.turn === true;
    k.dx = f.dx ?? 0;
  }

  /** No ring round the aim: the markers are the tool's marks. */
  draw(_d: ToolDraw): void {}

  /** Whether the picked light is one of ours the hand can move (a room's or an outdoor row). */
  private movable(): boolean {
    return this.pickedKey !== '' && (this.pickedSrc === 'room' || this.pickedSrc === 'outdoor');
  }

  /** Whether it takes the mouse this frame: F or R held on a light it can move (the camera then holds still). */
  holdsMouse(lift: boolean, turn?: boolean): boolean {
    return this.armed && (lift || turn === true) && this.movable() && !this.writing;
  }

  /** Whether the arrows, Page Up/Down and Ctrl+D are its own this frame: a light picked. */
  claimsKeys(): boolean {
    return this.armed && this.pickedKey !== '';
  }

  /** The arrows and Page Up/Down on the picked light: moved by the step (metres of the game's frame), written at once. */
  nudge(dx: number, dy: number, dz: number): void {
    this.refresh();
    if (!this.movable() || this.writing) return;
    const i = this.pickedIndex();
    if (i < 0) return;
    void this.writeMove(i, dx, dy, dz, 0, 0);
  }

  /** Ctrl+D: the picked light of ours written again beside itself under an id of its own. */
  duplicate(): void {
    this.refresh();
    if (!this.movable() || this.writing) return;
    const i = this.pickedIndex();
    if (i < 0) return;
    void this.duplicateAt(i);
  }

  /** Delete: the picked light of ours taken out of its file, one of the game's own switched off at the tool's scope. */
  deleteKey(): boolean {
    this.refresh();
    if (!this.armed || !this.pickedKey || this.writing) return false;
    const i = this.pickedIndex();
    if (i < 0) return false;
    if (this.m.src[i] === 'game') void this.editGame(i, { off: true });
    else if (this.m.src[i] === 'attached') this.host.say("a light hung on a row comes off with the row's attachments (its handle, Delete)", false);
    else {
      const row = this.rowAt(i);
      if (row) void this.removeRow(row);
    }
    return true;
  }

  /** The marker picked now, by a loop (no closure in a frame), or -1. */
  private pickedIndex(): number {
    const k = this.pickedKey;
    if (!k) return -1;
    const m = this.m;
    for (let i = 0; i < m.n; i++) if (m.key[i] === k && m.src[i] === this.pickedSrc) return i;
    return -1;
  }

  // ---- The markers. ----

  /** The markers laid out again where anything they are made of moved (the rows, the building, the plan, the shape). */
  private refresh(): void {
    const rows = this.host.rows();
    const b = this.host.cameraBuilding();
    const pv = this.host.planVersion();
    const att = this.host.attached();
    const s = this.host.shape();
    const sk = s.spots * 100 + s.spotShadows * 10 + s.pointShadows;
    // The eye flown a tenth of the reach since the last layout: the outdoor lights near it laid out again.
    this.host.eye(this.eyeAt);
    const ex = this.eyeAt.x - this.seenEye[0];
    const ez = this.eyeAt.z - this.seenEye[1];
    const far = LIGHTS_TOOL_TUNE.near * 0.1;
    const flown = ex * ex + ez * ez > far * far;
    if (!flown && rows.world === this.seenRows && rows.all === this.seenAll && (b?.ref ?? null) === this.seenBuilding && pv === this.seenPlan && att === this.seenAttached && sk === this.seenShape) return;
    this.seenEye[0] = this.eyeAt.x;
    this.seenEye[1] = this.eyeAt.z;
    this.seenRows = rows.world;
    this.seenAll = rows.all;
    this.seenBuilding = b?.ref ?? null;
    this.seenPlan = pv;
    this.seenAttached = att;
    this.seenShape = sk;
    this.building = b;
    this.layoutMarkers(rows, b, att, s);
  }

  /** Every marker written: the building's own lights, its rows' lights, the outdoor rows near the eye, the lights hung on rows near. */
  private layoutMarkers(rows: { world: readonly LightRow[]; all: readonly LightRow[] }, b: LightsBuilding | null, att: readonly AttachedLight[], shape: Readonly<PoolShape>): void {
    const m = this.m;
    const list: { src: MarkerSource; key: string; cell: number; game: number; type: number; x: number; y: number; z: number; dx: number; dy: number; dz: number; reach: number; angle: number; warn: boolean; row: LightRow | null }[] = [];
    const v = this.v1;
    const d = this.v2;
    const noSpots = shape.spots + shape.spotShadows === 0;
    const offKeys = new Set<string>();
    if (b) {
      // The game's own, cell by cell (its parallel and its lamps; the fill has no place), and whether an edit switched one off.
      const edits = this.editsFor(rows, b);
      // Narrowest first, as the pool reads them (`RoomLightEdits.forRoom`): the first edit met for a light decides whether it
      // is off, whatever a wider one says, so a light the copy's own row dims is lit here as it is lit in every browser.
      const decided = new Set<string>();
      for (const r of edits) {
        if (r.kind !== 'edit' || r.cell === undefined) continue;
        const one = `${r.cell}\u0000${typeof r.of}\u0000${r.of}`;
        if (decided.has(one)) continue;
        decided.add(one);
        if (r.off) offKeys.add(typeof r.of === 'number' ? `g:${r.cell}:${r.of}` : String(r.of));
      }
      for (const c of b.cells) {
        if (c.index === 0) continue;
        const lights = c.lights ?? [];
        for (let i = 0; i < lights.length; i++) {
          const l = lights[i];
          if (l.type === 0) continue;
          v.set(l.position[0], l.position[1], l.position[2]).applyMatrix4(b.matrix);
          d.set(l.direction[0], l.direction[1], l.direction[2]).transformDirection(b.matrix);
          const key = `g:${c.index}:${i}`;
          list.push({ src: 'game', key, cell: c.index, game: i, type: l.type === 1 ? 2 : 0, x: v.x, y: v.y, z: v.z, dx: d.x, dy: d.y, dz: d.z, reach: l.type === 1 ? 0 : pointLightRange(l.attenuation), angle: 0, warn: offKeys.has(key), row: null });
        }
      }
      // The lights the files add to this copy, narrowest scope first.
      for (const r of edits) {
        if (r.kind !== 'light' || !r.pos || r.cell === undefined) continue;
        const spec = specOfRow(r);
        if (!spec) continue;
        v.set(r.pos[0], r.pos[1], r.pos[2]).applyMatrix4(b.matrix);
        const dir: [number, number, number] = [0, -1, 0];
        shineOf(r.q, dir);
        d.set(dir[0], dir[1], dir[2]).transformDirection(b.matrix);
        const t = spec.type === 'spot' ? 1 : spec.type === 'directional' ? 2 : 0;
        list.push({ src: 'room', key: r.id, cell: r.cell, game: -1, type: t, x: v.x, y: v.y, z: v.z, dx: d.x, dy: d.y, dz: d.z, reach: spec.reach ?? 0, angle: t === 1 ? (coneOf(spec)[1] * Math.PI) / 180 : 0, warn: offKeys.has(r.id) || (t === 1 && noSpots), row: r });
      }
    }
    // Outdoors: every outdoor light near the eye, a mark that lights nothing this pass.
    this.host.eye(this.eyeAt);
    const near = LIGHTS_TOOL_TUNE.near;
    for (const r of rows.world) {
      if (r.scope !== 'outdoor' || !r.pos) continue;
      this.host.toGame(r.pos[0], r.pos[2], this.at);
      const dx = this.at.x - this.eyeAt.x;
      const dz = this.at.z - this.eyeAt.z;
      if (dx * dx + dz * dz > near * near) continue;
      const spec = specOfRow(r);
      if (!spec) continue;
      const dir: [number, number, number] = [0, -1, 0];
      shineOf(r.q, dir);
      const t = spec.type === 'spot' ? 1 : spec.type === 'directional' ? 2 : 0;
      list.push({ src: 'outdoor', key: r.id, cell: 0, game: -1, type: t, x: this.at.x, y: r.pos[1], z: this.at.z, dx: dir[0], dy: dir[1], dz: dir[2], reach: spec.reach ?? 0, angle: t === 1 ? (coneOf(spec)[1] * Math.PI) / 180 : 0, warn: true, row: r });
    }
    // The lights hung on rows near the eye.
    for (const a of att) {
      const e = a.world.elements;
      const dx = e[12] - this.eyeAt.x;
      const dz = e[14] - this.eyeAt.z;
      if (dx * dx + dz * dz > near * near) continue;
      d.set(0, -1, 0).transformDirection(a.world);
      const t = a.spec.type === 'spot' ? 1 : a.spec.type === 'directional' ? 2 : 0;
      list.push({ src: 'attached', key: a.key, cell: 0, game: -1, type: t, x: e[12], y: e[13], z: e[14], dx: d.x, dy: d.y, dz: d.z, reach: a.spec.reach ?? 0, angle: t === 1 ? (coneOf(a.spec)[1] * Math.PI) / 180 : 0, warn: !a.inside || (t === 1 && noSpots), row: null });
    }
    grow(m, list.length);
    m.n = list.length;
    m.src.length = list.length;
    m.key.length = list.length;
    m.row.length = list.length;
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      m.xyz[i * 3] = l.x;
      m.xyz[i * 3 + 1] = l.y;
      m.xyz[i * 3 + 2] = l.z;
      m.dir[i * 3] = l.dx;
      m.dir[i * 3 + 1] = l.dy;
      m.dir[i * 3 + 2] = l.dz;
      m.reach[i] = l.reach;
      m.angle[i] = l.angle;
      m.type[i] = l.type;
      m.warn[i] = l.warn ? 1 : 0;
      m.src[i] = l.src;
      m.key[i] = l.key;
      m.cell[i] = l.cell;
      m.row[i] = l.row;
      m.game[i] = l.game;
    }
    if (this.pickedKey && this.pickedIndex() < 0) {
      this.pickedKey = '';
      this.pickedSrc = null;
    }
  }

  /** Every row of the files reaching a building's copy, narrowest scope first. */
  private editsFor(rows: { world: readonly LightRow[]; all: readonly LightRow[] }, b: LightsBuilding): LightRow[] {
    const out: LightRow[] = [];
    if (b.copy) for (const r of rows.world) if (r.scope === 'copy' && r.copy === b.copy && r.model === b.model) out.push(r);
    for (const r of rows.world) if (r.scope === 'world' && r.model === b.model) out.push(r);
    for (const r of rows.all) if (r.scope === 'all' && r.model === b.model) out.push(r);
    return out;
  }

  // ---- The frame. ----

  /**
   * The frame, from this frame's view, after the editing's own marks: the press resolved (a handle grabbed, a marker picked, a
   * preset put down), a drag, a raise or a turn carried on (the pool shows it where the hand has it) and written as it is let go,
   * and the markers and the picked light's reach and gizmo drawn. Nothing is made in a steady frame.
   */
  overlay(d: ToolDraw, view: ScreenView): void {
    const marks = d.marks;
    marks.lightsOn = false;
    if (!this.armed) return;
    this.refresh();
    const f = this.f;
    const press = f.apply && !this.wasApply;
    const release = !f.apply && this.wasApply;
    const liftUp = !f.lift && this.wasLift;
    const turnUp = !f.turn && this.wasTurn;
    this.wasApply = f.apply;
    this.wasLift = f.lift;
    this.wasTurn = f.turn === true;
    this.cur.x = f.sx;
    this.cur.y = f.sy;
    rayAt(view, this.cur, this.ray);
    const i = this.pickedIndex();
    const movable = i >= 0 && this.movable();
    const m = this.m;
    const L = this.layout;
    L.on = false;
    if (movable) {
      this.pivot.x = m.xyz[i * 3] + this.moveX;
      this.pivot.y = m.xyz[i * 3 + 1] + this.moveY;
      this.pivot.z = m.xyz[i * 3 + 2] + this.moveZ;
      handlesFor(f.turn ? (f.shift ? 'tumble' : 'turn') : f.lift ? 'lift' : 'none', false, L.shown);
      layoutGizmo(view, this.pivot, this.axes, LIGHTS_TOOL_TUNE.gizmoPx, L);
      if (!this.dragging) pickAt(L, this.cur, LIGHTS_TOOL_TUNE.hitPx);
    }
    // F or R held on a light of ours: raised or turned by the mouse at the placing hand's own rates; let go, written.
    if (movable && (f.lift || f.turn) && !this.writing && !this.dragging) {
      this.hdy = f.dy;
      this.hdx = f.dx ?? 0;
      if (!this.hdy && Number.isFinite(this.lastSy)) this.hdy = f.sy - this.lastSy;
      if (!this.hdx && Number.isFinite(this.lastSx)) this.hdx = f.sx - this.lastSx;
      if (this.hdy || this.hdx) {
        this.holding = true;
        this.holdStep();
      }
    }
    this.lastSy = f.sy;
    this.lastSx = f.sx;
    if ((liftUp || turnUp) && this.holding && !f.lift && !f.turn) {
      const dy = this.moveY;
      const yaw = this.yaw;
      const tip = this.tip;
      this.holding = false;
      this.moveY = 0;
      this.yaw = 0;
      this.tip = 0;
      if (i >= 0 && (Math.abs(dy) >= 0.001 || Math.abs(yaw) >= 1e-4 || Math.abs(tip) >= 1e-4)) void this.writeMove(i, 0, dy, 0, yaw, tip);
      else this.letLive();
    }
    // A drag of a handle carried on; let go, written.
    if (this.dragging) {
      if (f.apply) {
        if (dragAt(this.drag, L, this.cur, this.ray)) {
          if (this.drag.handle === H.yaw) this.yaw = this.drag.angle;
          else {
            this.moveX = this.drag.mx;
            this.moveY = this.drag.my;
            this.moveZ = this.drag.mz;
          }
        }
      } else if (release) {
        const dx = this.moveX;
        const dy = this.moveY;
        const dz = this.moveZ;
        const yaw = this.yaw;
        this.dragging = false;
        this.moveX = 0;
        this.moveY = 0;
        this.moveZ = 0;
        this.yaw = 0;
        if (i >= 0 && Math.sqrt(dx * dx + dy * dy + dz * dz) + Math.abs(yaw) >= 0.005) void this.writeMove(i, dx, dy, dz, yaw, 0);
        else this.letLive();
      }
    } else if (press && !this.writing) this.pressed(view);
    if (i >= 0 && (this.dragging || this.holding)) this.carryLive(i);
    this.drawMarkers(marks, view);
    if (movable && L.on) marks.gizmo = L;
  }

  /** The mouse's movement this frame a hold takes (down and across the screen), kept: no number crosses a call. */
  private hdy = 0.5;
  private hdx = 0.5;

  /**
   * One frame of F or R held on the picked light (`hdy`, `hdx` written first): the placing hand's own arithmetic for a prop
   * (`liftDelta` and `turnDelta` in `placeHold.ts`, `PLACE_HOLD_TUNE`), written out here so its answer goes into a field and
   * never comes back across a call (the editing's own hold is written out the same way): F raises, R turns about up, Shift+R
   * tips about the camera's own level across. Nothing is made.
   */
  private holdStep(): void {
    const T = PLACE_HOLD_TUNE;
    const f = this.f;
    const dy = this.hdy;
    if (f.lift) {
      if (!dy) return;
      const v = Math.abs(dy) / Math.max(f.dt, T.dtFloor);
      const span = T.fast - T.knee;
      const t = span > 0 ? (v - T.knee) / span : v > T.knee ? 1 : 0;
      const gain = 1 + (T.most - 1) * Math.min(1, Math.max(0, t));
      const m = -dy * T.liftPerPxProp * gain;
      this.moveY += T.flipLift ? -m : m;
      return;
    }
    // A tip takes the movement down the screen alone; a turn the sideways too where the tune says.
    const side = !f.shift && T.sideways;
    const along = dy - (side ? this.hdx : 0);
    if (!along) return;
    const px = side ? Math.sqrt(this.hdx * this.hdx + dy * dy) : Math.abs(dy);
    const v = px / Math.max(f.dt, T.dtFloor);
    const span = T.fast - T.knee;
    const t = span > 0 ? (v - T.knee) / span : v > T.knee ? 1 : 0;
    const gain = 1 + (T.most - 1) * Math.min(1, Math.max(0, t));
    const rad = (along * T.turnPerPx * gain * Math.PI) / 180;
    if (f.shift) this.tip += T.flipTurn ? -rad : rad;
    else this.yaw += T.flipTurn ? -rad : rad;
  }

  /** A press: a handle of the picked light's gizmo grabbed, a marker picked, a preset put down, or the pick let go. */
  private pressed(view: ScreenView): void {
    const f = this.f;
    const L = this.layout;
    if (this.movable() && L.on && L.hot >= 0 && L.hot !== H.yaw && grabAt(this.drag, L, L.hot, view, this.pivot, this.cur, this.ray)) {
      this.dragging = true;
      return;
    }
    if (this.movable() && L.on && L.hot === H.yaw && grabAt(this.drag, L, H.yaw, view, this.pivot, this.cur, this.ray)) {
      this.dragging = true;
      return;
    }
    const hit = this.markerUnder(view);
    if (hit >= 0) {
      this.pickedKey = this.m.key[hit];
      this.pickedSrc = this.m.src[hit];
      this.host.say(`picked ${this.markerWords(hit)}`, true);
      this.host.refresh();
      return;
    }
    if (this.adding && f.valid) {
      void this.putDown(this.adding, f.x, f.y, f.z);
      return;
    }
    if (this.pickedKey) {
      this.pickedKey = '';
      this.pickedSrc = null;
      this.host.refresh();
    }
  }

  /** The marker under the cursor (nearest within `pickPx`), or -1. */
  private markerUnder(view: ScreenView): number {
    let best = -1;
    let bestD = LIGHTS_TOOL_TUNE.pickPx;
    const m = this.m;
    for (let i = 0; i < m.n; i++) {
      if (!projectXYZ(view, m.xyz, i * 3, this.pt)) continue;
      const dx = this.pt[0] - this.cur.x;
      const dy = this.pt[1] - this.cur.y;
      const dd = Math.sqrt(dx * dx + dy * dy);
      if (dd <= bestD) {
        bestD = dd;
        best = i;
      }
    }
    return best;
  }

  /** The light being moved handed to the pool where the hand has it, in the building's frame (a room's light alone: an outdoor one lights nothing). */
  private carryLive(i: number): void {
    const b = this.building;
    const r = this.liveRec;
    if (!b || this.m.src[i] !== 'room') {
      if (r.key) this.letLive();
      return;
    }
    // Written component by component: three's `set` takes its numbers across a call, which the compiler leaves out of a full
    // method on some compiles and boxes them (two numbers a frame of a hold in one process of two, measured).
    const v = this.v1;
    v.x = this.m.xyz[i * 3] + this.moveX;
    v.y = this.m.xyz[i * 3 + 1] + this.moveY;
    v.z = this.m.xyz[i * 3 + 2] + this.moveZ;
    v.applyMatrix4(b.inverse);
    const d = this.turned(i, this.v2);
    d.transformDirection(b.inverse);
    r.key = this.m.key[i];
    r.x = v.x;
    r.y = v.y;
    r.z = v.z;
    r.dx = d.x;
    r.dy = d.y;
    r.dz = d.z;
    this.host.live(r);
  }

  private letLive(): void {
    if (!this.liveRec.key) return;
    this.liveRec.key = '';
    this.host.live(this.liveRec);
  }

  /** A marker's way turned by the hold's yaw about up and tip about the camera's own across, into `out` (world). */
  private turned(i: number, out: THREE.Vector3): THREE.Vector3 {
    out.x = this.m.dir[i * 3];
    out.y = this.m.dir[i * 3 + 1];
    out.z = this.m.dir[i * 3 + 2];
    this.ry = this.yaw;
    this.rt = this.tip;
    return this.turnedFrom(out, out);
  }

  /** The turn `turnedFrom` takes, in fields (a number handed across a call the compiler leaves out is boxed). */
  private ry = 0.5;
  private rt = 0.5;

  /** A way (world, unit) turned by a yaw about up and a tip about the camera's own level across, into `out`. */
  private turnedFrom(way: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const yaw = this.ry;
    const tip = this.rt;
    if (out !== way) out.copy(way);
    // Written out by hand (three's `applyAxisAngle` hands the angle across a call a frame, which may box it).
    if (yaw) {
      // About up, three's sense: x' = x cos + z sin, z' = z cos - x sin.
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const x = out.x;
      const z = out.z;
      out.x = x * c + z * s;
      out.z = z * c - x * s;
    }
    if (tip) {
      this.host.look(this.look);
      // About the camera's own across, level (look.z, 0, -look.x), by Rodrigues: v cos + (k x v) sin + k (k . v)(1 - cos).
      let kx = this.look.z;
      let kz = -this.look.x;
      const kl = Math.sqrt(kx * kx + kz * kz) || 1;
      kx /= kl;
      kz /= kl;
      const c = Math.cos(tip);
      const s = Math.sin(tip);
      const x = out.x;
      const y = out.y;
      const z = out.z;
      const kv = kx * x + kz * z;
      // k x v with k = (kx, 0, kz): (0 * z - kz * y, kz * x - kx * z, kx * y - 0 * x).
      out.x = x * c + -kz * y * s + kx * kv * (1 - c);
      out.y = y * c + (kz * x - kx * z) * s;
      out.z = z * c + kx * y * s + kz * kv * (1 - c);
    }
    const l = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z) || 1;
    out.x /= l;
    out.y /= l;
    out.z /= l;
    return out;
  }

  // ---- Writing. ----

  /** A row of ours written again moved (world metres) and turned (radians), one action. */
  private async writeMove(i: number, dx: number, dy: number, dz: number, yaw: number, tip: number): Promise<void> {
    const row = this.rowAt(i);
    if (!row || !row.pos) {
      this.letLive();
      return;
    }
    const after: LightRow = { ...bare(row) };
    // From where its file has it now (a write of the editor's own may have landed since the markers were laid out).
    const shine: [number, number, number] = [0, -1, 0];
    shineOf(row.q, shine);
    const base = new THREE.Vector3();
    const way = new THREE.Vector3(shine[0], shine[1], shine[2]);
    if (row.scope === 'outdoor') {
      this.host.toGame(row.pos[0], row.pos[2], this.at);
      base.set(this.at.x, row.pos[1], this.at.z);
    } else {
      const b0 = this.building;
      if (!b0) {
        this.letLive();
        return;
      }
      base.set(row.pos[0], row.pos[1], row.pos[2]).applyMatrix4(b0.matrix);
      way.transformDirection(b0.matrix);
    }
    const nx = base.x + dx;
    const ny = base.y + dy;
    const nz = base.z + dz;
    const turn = yaw !== 0 || tip !== 0;
    this.ry = yaw;
    this.rt = tip;
    const dir = turn ? this.turnedFrom(way, new THREE.Vector3()) : null;
    if (row.scope === 'outdoor') {
      this.host.toRaw(nx, nz, this.at);
      after.pos = [cm(this.at.x), cm(ny), cm(this.at.z)];
      if (dir) {
        const q = turnToward(dir);
        if (q) after.q = q;
        else delete after.q;
      }
    } else {
      const b = this.building;
      if (!b) {
        this.letLive();
        return;
      }
      // Written in the room it lands in, by the editor's own room rule (a row is written in the room it lands in: Map-maker I's
      // second wave), or refused where it would leave the building.
      if (!this.reroom(b, row, nx, ny, nz, after)) {
        this.letLive();
        return;
      }
      const v = new THREE.Vector3(nx, ny, nz).applyMatrix4(b.inverse);
      after.pos = [cm(v.x), cm(v.y), cm(v.z)];
      if (dir) {
        dir.transformDirection(b.inverse);
        const q = turnToward(dir);
        if (q) after.q = q;
        else delete after.q;
      }
    }
    await this.write(turn ? 'turn a light' : 'move a light', [{ file: fileOfScope(row.scope), id: row.id, before: row, after }]);
  }

  /**
   * The room a light of building `b` lands in at a point of the game's frame, by the editor's own room rule (`roomAt`: a room's
   * floor, else its box): a room of the same building; or -- a point in no room's box within the building's reach, as a third of
   * the game's own lamps stand, in the ceiling over their room -- the room it was of. Answers null for a point in another
   * building's room or past the building's reach (outdoors), which a light of a building's rooms never moves to: a light filed
   * in one room and standing in another lit that room's surfaces through the wall.
   */
  landing(b: LightsBuilding, own: number, x: number, y: number, z: number): { cell: number; name: string } | null {
    const at = this.host.roomAt(x, y, z);
    if (at) {
      if (at.building.ref !== b.ref) return null;
      const c = b.cells.find((cc) => cc.index === at.cell);
      return c ? { cell: c.index, name: c.name } : null;
    }
    if (b.x !== undefined && b.z !== undefined && b.radius !== undefined) {
      const dx = x - b.x;
      const dz = z - b.z;
      if (dx * dx + dz * dz > b.radius * b.radius) return null;
    }
    const c = b.cells.find((cc) => cc.index === own);
    return c ? { cell: c.index, name: c.name } : null;
  }

  /** A room row's cell and room written for where it lands (`landing`) into `after`; false (said in words) where it would leave the building. */
  private reroom(b: LightsBuilding, row: LightRow, x: number, y: number, z: number, after: LightRow): boolean {
    const land = this.landing(b, row.cell ?? -1, x, y, z);
    if (!land) {
      this.host.say("not written: a light of a building's rooms stays in that building (it would stand in another building's room or outdoors): take it out and put another down where it should stand", false);
      return false;
    }
    after.cell = land.cell;
    after.room = land.name;
    return true;
  }

  /** One action written (`putRows`), the live hand let go after; answers what was said. */
  private async write(label: string, changes: RowChange[]): Promise<string> {
    this.writing = true;
    try {
      const said = await this.host.edits.putRows(label, changes);
      this.last = said;
      return said;
    } finally {
      this.writing = false;
      this.letLive();
      this.host.refresh();
    }
  }

  /** Every id both files hold now. */
  private taken(): Set<string> {
    const rows = this.host.rows();
    return new Set([...rows.world.map((r) => r.id), ...rows.all.map((r) => r.id)]);
  }

  /** The scope in force for a building: one copy where it has a copy key, else every copy on this world (said). */
  private scopeFor(b: LightsBuilding): 'copy' | 'world' | 'all' {
    if (this.scope === 'copy' && !(b.copy && isCopyKey(b.copy))) return 'world';
    return this.scope;
  }

  /**
   * A preset put down at a point of the game's frame (its place `lift` over the hit): hung on the row of ours under the aim
   * (with `hang` on), else a light of the room it stands in at the tool's scope, else an outdoor light. Answers what was said.
   */
  async putDown(p: LightPreset, x: number, y: number, z: number): Promise<string> {
    const lift = LIGHTS_TOOL_TUNE.lift;
    if (this.hang) {
      const under = this.host.rowUnderAim();
      if (under) {
        const inv = under.matrix.clone().invert();
        const local = new THREE.Vector3(x, y + lift, z).applyMatrix4(inv);
        const list = Array.isArray(under.row.attach) ? (under.row.attach as unknown[]) : [];
        const { at: _at, ...rest } = under.row as Record<string, unknown> & { at?: number };
        const a: Record<string, unknown> = { light: lightSpecFields(p.spec) };
        const at: [number, number, number] = [Math.round(local.x * 1000) / 1000, Math.round(local.y * 1000) / 1000, Math.round(local.z * 1000) / 1000];
        if (at[0] !== 0 || at[1] !== 0 || at[2] !== 0) a.at = at;
        const after = { ...rest, attach: [...list, a] };
        return this.write('hang a light', [{ file: under.layer, id: under.id, before: under.row as never, after: after as never }]);
      }
    }
    // The room the point stands in by the editor's own rule; else, from inside a building, the room the camera is in (a
    // third of the game's own lamps stand outside their cell's box, in the ceiling over it, and a lamp put up there is the
    // room's lamp all the same).
    let room = this.host.roomAt(x, y + lift, z);
    const cam = this.host.cameraBuilding();
    if (!room && cam && cam.cell > 0) room = { building: cam, cell: cam.cell };
    const taken = this.taken();
    if (!room) {
      if (this.host.worldKind() === 'copies') {
        const words = "the dungeons' world of copies has no outdoors: put a light down in a room";
        this.host.say(words, false);
        return words;
      }
      this.host.toRaw(x, z, this.at);
      const id = mintLightId(p.id, taken, false);
      const row: LightRow = { id, kind: 'light', scope: 'outdoor', ...(lightSpecFields(p.spec) as Partial<LightRow>), pos: [cm(this.at.x), cm(y + lift), cm(this.at.z)] } as LightRow;
      const said = await this.write('put a light down outdoors', [{ file: 'lights', id, before: null, after: row }]);
      this.pickedKey = id;
      this.pickedSrc = 'outdoor';
      this.host.say(`${said}: it stands outdoors, a mark that lights nothing until the Light and shadow pass's outdoor pool`, true);
      return said;
    }
    const b = room.building;
    const scope = this.scopeFor(b);
    const cell = b.cells.find((c) => c.index === room.cell);
    if (!cell) return 'no such room';
    const v = new THREE.Vector3(x, y + lift, z).applyMatrix4(b.inverse);
    const id = mintLightId(p.id, taken, scope === 'all');
    const row = {
      id,
      kind: 'light',
      scope,
      ...(scope === 'copy' ? { copy: b.copy } : {}),
      model: b.model,
      cell: room.cell,
      room: cell.name,
      ...lightSpecFields(p.spec),
      pos: [cm(v.x), cm(v.y), cm(v.z)],
    } as unknown as LightRow;
    const said = await this.write(`put ${p.name.toLowerCase()} down`, [{ file: fileOfScope(scope), id, before: null, after: row }]);
    this.pickedKey = id;
    this.pickedSrc = 'room';
    if (p.spec.type === 'spot' && this.host.shape().spots + this.host.shape().spotShadows === 0) this.host.say(`${said}: a spot lights nothing until the Graphics page builds a spot slot (Shadows and distance, Room lamps)`, false);
    if (scope !== this.scope) this.host.say(`${said} at every copy on this world: this building has no copy key of its own (a house put down in play)`, true);
    return said;
  }

  /** The picked light of ours written again beside itself (the camera's right, a step), under an id of its own: one action. */
  private async duplicateAt(i: number): Promise<string> {
    const row = this.rowAt(i);
    if (!row || !row.pos) return 'nothing to duplicate';
    this.host.look(this.look);
    const step = LIGHTS_TOOL_TUNE.dupStep > 0 ? LIGHTS_TOOL_TUNE.dupStep : this.host.grid() || 0.5;
    // The camera's right along the ground: (-look.z, look.x).
    const wx = this.m.xyz[i * 3] - this.look.z * step;
    const wz = this.m.xyz[i * 3 + 2] + this.look.x * step;
    const wy = this.m.xyz[i * 3 + 1];
    const id = mintLightId(row.name ?? row.id.replace(/-\d+$/, ''), this.taken(), row.scope === 'all');
    const after: LightRow = { ...bare(row), id };
    if (row.scope === 'outdoor') {
      this.host.toRaw(wx, wz, this.at);
      after.pos = [cm(this.at.x), cm(wy), cm(this.at.z)];
    } else {
      const b = this.building;
      if (!b) return 'no building';
      // In the room it lands in, a step beside its light (which may be through a doorway), or refused where it would leave.
      if (!this.reroom(b, row, wx, wy, wz, after)) return 'not written: it would stand outside the building';
      const v = new THREE.Vector3(wx, wy, wz).applyMatrix4(b.inverse);
      after.pos = [cm(v.x), cm(v.y), cm(v.z)];
    }
    const said = await this.write('duplicate a light', [{ file: fileOfScope(row.scope), id, before: null, after }]);
    this.pickedKey = id;
    return said;
  }

  /** A row taken out of its file: one action. */
  private async removeRow(row: LightRow): Promise<string> {
    const said = await this.write('take a light out', [{ file: fileOfScope(row.scope), id: row.id, before: row, after: null }]);
    if (this.pickedKey === row.id) {
      this.pickedKey = '';
      this.pickedSrc = null;
    }
    return said;
  }

  /**
   * One of the game's own lights (marker `i`) edited at the tool's scope: the edit row of that scope for it merged with
   * `fields` (a field null takes it out), written, or taken out where nothing is left. One action.
   */
  async editGame(i: number, fields: Record<string, unknown>): Promise<string> {
    const b = this.building;
    if (!b || this.m.src[i] !== 'game') return 'pick one of the game\'s own lights first';
    return this.editAt(b, this.m.cell[i], this.m.game[i], fields);
  }

  /** An edit row for one light (`of`: a game light's index, or a wider light's id) at the tool's scope, merged and written. */
  private async editAt(b: LightsBuilding, cell: number, of: number | string, fields: Record<string, unknown>): Promise<string> {
    const scope = this.scopeFor(b);
    const c = b.cells.find((x) => x.index === cell);
    if (!c) return 'no such room';
    const rows = this.host.rows();
    const file = fileOfScope(scope);
    const pool = scope === 'all' ? rows.all : rows.world;
    const was = pool.find((r) => r.kind === 'edit' && r.scope === scope && r.model === b.model && r.cell === cell && r.of === of && (scope !== 'copy' || r.copy === b.copy)) ?? null;
    const id = was?.id ?? mintLightId(`edit-${c.name}`, this.taken(), scope === 'all');
    const draft: Record<string, unknown> = was ? { ...bare(was) } : { id, kind: 'edit', scope, ...(scope === 'copy' ? { copy: b.copy } : {}), model: b.model, cell, room: c.name, of };
    for (const [k, v] of Object.entries(fields)) {
      if (v === null || v === undefined || v === '') delete draft[k];
      else draft[k] = v;
    }
    if (draft.off === false) delete draft.off;
    if (draft.scale === 1) delete draft.scale;
    const doing = ['off', 'scale', 'color', 'reach', 'shadow'].some((k) => draft[k] !== undefined);
    if (!doing) {
      if (!was) return 'nothing to edit';
      return this.write('clear an edit of a light', [{ file, id: was.id, before: was, after: null }]);
    }
    return this.write('edit a light', [{ file, id, before: was, after: draft as unknown as LightRow }]);
  }

  /** The room's fill (its ambient) at the tool's scope: its colour put in place and its scale (null takes either out). One action. */
  async setFill(fields: { scale?: number | null; color?: [number, number, number] | null }): Promise<string> {
    this.refresh();
    const b = this.building;
    const cell = this.cameraCell();
    if (!b || cell <= 0) return 'stand in a room first: the fill is the room you are in';
    const scope = this.scopeFor(b);
    const c = b.cells.find((x) => x.index === cell);
    if (!c) return 'no such room';
    const rows = this.host.rows();
    const pool = scope === 'all' ? rows.all : rows.world;
    const was = pool.find((r) => r.kind === 'fill' && r.scope === scope && r.model === b.model && r.cell === cell && (scope !== 'copy' || r.copy === b.copy)) ?? null;
    const id = was?.id ?? mintLightId(`fill-${c.name}`, this.taken(), scope === 'all');
    const draft: Record<string, unknown> = was ? { ...bare(was) } : { id, kind: 'fill', scope, ...(scope === 'copy' ? { copy: b.copy } : {}), model: b.model, cell, room: c.name };
    for (const [k, v] of Object.entries(fields)) {
      if (v === null || v === undefined) delete draft[k];
      else draft[k] = v;
    }
    if (draft.scale === 1) delete draft.scale;
    const file = fileOfScope(scope);
    if (draft.scale === undefined && draft.color === undefined) {
      if (!was) return 'nothing to change';
      return this.write("clear a room's fill", [{ file, id: was.id, before: was, after: null }]);
    }
    return this.write("set a room's fill", [{ file, id, before: was, after: draft as unknown as LightRow }]);
  }

  /** The room the camera is in (the lit room), or 0. */
  private cameraCell(): number {
    return this.building?.cell ?? 0;
  }

  /**
   * The picked light of ours (or a light hung on a row) given new fields (`LightSpec`'s, `name`, `note`, `pos` as "x y z" in its
   * own frame, `scope`): its row written again, one action. A type, a cone or a flicker read as the reader reads them.
   */
  async setPicked(fields: Record<string, unknown>): Promise<string> {
    this.refresh();
    const i = this.pickedIndex();
    if (i < 0) return 'pick a light first';
    const src = this.m.src[i];
    if (src === 'game') {
      const g: Record<string, unknown> = {};
      for (const k of ['off', 'scale', 'color', 'reach', 'shadow'] as const) if (k in fields) g[k] = fields[k];
      return this.editGame(i, g);
    }
    if (src === 'attached') return this.setAttached(fields);
    const row = this.rowAt(i);
    if (!row) return 'it is not in its file any more';
    if (typeof fields.scope === 'string' && fields.scope !== row.scope) return this.moveScope(row, fields.scope as LightScope);
    const draft: Record<string, unknown> = { ...bare(row) };
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'scope') continue;
      if (k === 'pos' && typeof v === 'string') {
        const p = v.trim().split(/[\s,]+/).map(Number);
        if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return 'its place is three numbers: x y z';
        draft.pos = [cm(p[0]), cm(p[1]), cm(p[2])];
        // A light of a room typed into another place of its building is written in the room that place is in.
        const b = this.building;
        if (row.scope !== 'outdoor' && b) {
          const w = this.v1.set(p[0], p[1], p[2]).applyMatrix4(b.matrix);
          if (!this.reroom(b, row, w.x, w.y, w.z, draft as unknown as LightRow)) return 'not written: it would stand outside the building';
        }
        continue;
      }
      if (v === null || v === '') delete draft[k];
      else draft[k] = v;
    }
    // A type changed: the fields the new type does not carry left out (the reader refuses a directional's reach), and a spot's cone given its default.
    if (draft.type === 'directional') {
      delete draft.reach;
      delete draft.falloff;
      delete draft.cone;
    } else if (draft.reach === undefined) draft.reach = DEFAULT_REACH;
    if (draft.type !== 'spot') delete draft.cone;
    const spec = readLightSpec(draft);
    if (typeof spec === 'string') {
      this.host.say(`not written: ${spec}`, false);
      return spec;
    }
    const after = { ...draft, ...lightSpecFields(spec) } as unknown as LightRow;
    if (!lightSpecFields(spec).shadow) delete (after as unknown as Record<string, unknown>).shadow;
    if (!lightSpecFields(spec).flicker) delete (after as unknown as Record<string, unknown>).flicker;
    if (!lightSpecFields(spec).cone) delete (after as unknown as Record<string, unknown>).cone;
    if (!lightSpecFields(spec).falloff) delete (after as unknown as Record<string, unknown>).falloff;
    return this.write('change a light', [{ file: fileOfScope(row.scope), id: row.id, before: row, after }]);
  }

  /**
   * A light of a room moved to another scope (one copy, every copy on this world, every copy everywhere): taken out of its file
   * and put in the scope's under the same id (an `all-` one for the shared file), one action. An outdoor light stays outdoors.
   */
  private async moveScope(row: LightRow, scope: LightScope): Promise<string> {
    if (row.scope === 'outdoor' || scope === 'outdoor') return 'an outdoor light stands outdoors: put another down in a room';
    const b = this.building;
    if (scope === 'copy' && !(b?.copy && isCopyKey(b.copy))) return 'this building has no copy key of its own (a house put down in play): every copy on this world is its narrowest';
    const shared = scope === 'all';
    const id = shared === row.id.startsWith(ALL_ID_PREFIX) ? row.id : mintLightId(row.name ?? row.id.replace(/^all-/, '').replace(/-\d+$/, ''), this.taken(), shared);
    const after: Record<string, unknown> = { ...bare(row), id, scope };
    if (scope === 'copy') after.copy = b!.copy;
    else delete after.copy;
    const changes: RowChange[] = [{ file: fileOfScope(row.scope), id: row.id, before: row, after: null }, { file: fileOfScope(scope), id, before: null, after: after as unknown as LightRow }];
    const said = await this.write('move a light to another scope', changes);
    this.pickedKey = id;
    return said;
  }

  /** A light hung on a row given new fields: its row's attachment written again with the light's own fields. One action. */
  private async setAttached(fields: Record<string, unknown>): Promise<string> {
    const i = this.pickedIndex();
    const key = this.m.key[i];
    const a = this.host.attached().find((x) => x.key === key);
    if (!a) return 'it is not hung there any more';
    const row = this.rowOfKey(a.rowKey);
    if (!row) return "its row is not one of this world's files' rows";
    const list = (Array.isArray(row.row.attach) ? [...(row.row.attach as Record<string, unknown>[])] : []) as Record<string, unknown>[];
    const was = list[a.index];
    if (!was || !was.light) return 'its attachment is not a light';
    const draft: Record<string, unknown> = { ...(was.light as Record<string, unknown>) };
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'pos' || k === 'scope' || k === 'name' || k === 'note') continue;
      if (v === null || v === '') delete draft[k];
      else draft[k] = v;
    }
    if (draft.type === 'directional') {
      delete draft.reach;
      delete draft.falloff;
      delete draft.cone;
    } else if (draft.reach === undefined) draft.reach = DEFAULT_REACH;
    if (draft.type !== 'spot') delete draft.cone;
    const spec = readLightSpec(draft);
    if (typeof spec === 'string') return spec;
    list[a.index] = { ...was, light: lightSpecFields(spec) };
    const { at: _at, ...rest } = row.row as Record<string, unknown>;
    return this.write("change a light hung on a row", [{ file: row.layer, id: row.id, before: row.row as never, after: { ...rest, attach: list } as never }]);
  }

  /** A row of the two placement files by its streamer key (`place/<id>`), as the host's row lookup has it. */
  rowOfKey: (key: string) => { id: string; layer: 'story' | 'world'; row: Record<string, unknown> } | null = () => null;

  // ---- The marks. ----

  /** Every marker drawn, the picked one's reach as a ring or a cone, from this frame's view. Nothing is made. */
  private drawMarkers(marks: ToolDraw['marks'], view: ScreenView): void {
    const m = this.m;
    lightPools(marks, m.n);
    marks.lightsOn = true;
    marks.lightCount = m.n;
    marks.lightPx = LIGHTS_TOOL_TUNE.markerPx;
    const picked = this.pickedIndex();
    this.hotIndex = this.dragging || this.holding ? -1 : this.markerUnder(view);
    for (let i = 0; i < m.n; i++) {
      const k = i * 3;
      const moving = i === picked && (this.dragging || this.holding);
      this.pivot.x = m.xyz[k] + (moving ? this.moveX : 0);
      this.pivot.y = m.xyz[k + 1] + (moving ? this.moveY : 0);
      this.pivot.z = m.xyz[k + 2] + (moving ? this.moveZ : 0);
      marks.lightVis[i] = projectPivot(view, this.pivot, this.pt) ? 1 : 0;
      marks.lightPts[i * 2] = this.pt[0];
      marks.lightPts[i * 2 + 1] = this.pt[1];
      marks.lightType[i] = m.type[i];
      marks.lightState[i] = i === picked ? 3 : i === this.hotIndex ? 2 : m.warn[i] ? 4 : m.src[i] === 'game' ? 0 : 1;
    }
    marks.lightShapeOn = false;
    marks.lightRayN = 0;
    if (picked < 0) return;
    const k = picked * 3;
    const moving = this.dragging || this.holding;
    const cx = m.xyz[k] + (moving ? this.moveX : 0);
    const cy = m.xyz[k + 1] + (moving ? this.moveY : 0);
    const cz = m.xyz[k + 2] + (moving ? this.moveZ : 0);
    const reach = m.reach[picked];
    let dir = this.v2;
    if (moving) dir = this.turned(picked, this.v2);
    else {
      dir.x = m.dir[k];
      dir.y = m.dir[k + 1];
      dir.z = m.dir[k + 2];
    }
    const t = m.type[picked];
    if (t === 2) {
      // A directional: one line along its way, three metres.
      this.pivot.x = cx;
      this.pivot.y = cy;
      this.pivot.z = cz;
      const a = projectPivot(view, this.pivot, this.pt);
      const ax = this.pt[0];
      const ay = this.pt[1];
      this.pivot.x = cx + dir.x * 3;
      this.pivot.y = cy + dir.y * 3;
      this.pivot.z = cz + dir.z * 3;
      if (a && projectPivot(view, this.pivot, this.pt)) {
        marks.lightRays[0] = ax;
        marks.lightRays[1] = ay;
        marks.lightRays[2] = this.pt[0];
        marks.lightRays[3] = this.pt[1];
        marks.lightRayN = 1;
        marks.lightShapeOn = true;
        marks.lightShapeN = 0;
      }
      return;
    }
    if (!(reach > 0)) return;
    // A round light's ring is level at its own height; a spot's is the mouth of its cone, `reach` along its way.
    const n = RING_MARKS;
    let ox = cx;
    let oy = cy;
    let oz = cz;
    let r = reach;
    let ux = 1;
    let uy = 0;
    let uz = 0;
    let vx = 0;
    let vy = 0;
    let vz = 1;
    if (t === 1) {
      ox = cx + dir.x * reach;
      oy = cy + dir.y * reach;
      oz = cz + dir.z * reach;
      r = reach * Math.tan(m.angle[picked]);
      // Two axes across the way: way x a world axis it is least along, and way x that.
      if (Math.abs(dir.y) < 0.9) {
        ux = -dir.z;
        uy = 0;
        uz = dir.x;
      } else {
        ux = 0;
        uy = dir.z;
        uz = -dir.y;
      }
      const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      vx = dir.y * uz - dir.z * uy;
      vy = dir.z * ux - dir.x * uz;
      vz = dir.x * uy - dir.y * ux;
    }
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      const cs = Math.cos(a) * r;
      const sn = Math.sin(a) * r;
      this.pivot.x = ox + ux * cs + vx * sn;
      this.pivot.y = oy + uy * cs + vy * sn;
      this.pivot.z = oz + uz * cs + vz * sn;
      marks.lightShapeVis[j] = projectPivot(view, this.pivot, this.pt) ? 1 : 0;
      marks.lightShape[j * 2] = this.pt[0];
      marks.lightShape[j * 2 + 1] = this.pt[1];
    }
    marks.lightShapeN = n;
    marks.lightShapeOn = true;
    if (t === 1) {
      this.pivot.x = cx;
      this.pivot.y = cy;
      this.pivot.z = cz;
      if (projectPivot(view, this.pivot, this.pt)) {
        const ax = this.pt[0];
        const ay = this.pt[1];
        let k2 = 0;
        for (let j = 0; j < n; j += n / 4) {
          if (!marks.lightShapeVis[j]) continue;
          marks.lightRays[k2 * 4] = ax;
          marks.lightRays[k2 * 4 + 1] = ay;
          marks.lightRays[k2 * 4 + 2] = marks.lightShape[j * 2];
          marks.lightRays[k2 * 4 + 3] = marks.lightShape[j * 2 + 1];
          k2++;
        }
        marks.lightRayN = k2;
      }
    }
  }

  // ---- What the window and the console read. ----

  /** A marker in words: what it is, its room, whether it lights now. */
  private markerWords(i: number): string {
    const m = this.m;
    const what = m.type[i] === 1 ? 'spot' : m.type[i] === 2 ? 'directional light' : 'round light';
    const room = this.building?.cells.find((c) => c.index === m.cell[i])?.name;
    if (m.src[i] === 'game') return `the game's own ${what} ${m.game[i]} of ${room ?? `room ${m.cell[i]}`}: the Selected tab edits it at ${this.scope} scope; Delete switches it off`;
    if (m.src[i] === 'attached') return `a ${what} hung on a row: its fields are the Selected tab's; it moves with its row (and its own handle)`;
    if (m.src[i] === 'outdoor') return `an outdoor ${what} (${m.key[i]}): a mark that lights nothing until the Light and shadow pass's outdoor pool`;
    return `the ${what} ${m.key[i]} of ${room ?? `room ${m.cell[i]}`}: drag its gizmo, F raises, R turns, arrows nudge, Ctrl+D duplicates, Delete takes it out`;
  }

  /** Why the picked light lights what it does now, in words: lit (and in which slot), off, no slot, another room, outdoors. */
  private litWords(i: number): string {
    const m = this.m;
    const key = m.key[i];
    const src = m.src[i];
    if (src === 'outdoor') return 'outdoors: a mark that lights nothing until the Light and shadow pass builds an outdoor pool';
    if (src === 'attached' && m.warn[i] && m.type[i] !== 1) return 'hung on a row standing outdoors: lights nothing this pass';
    const p = this.host.plan();
    if (p) {
      if (p.parallel?.key === key) return p.parallel.asked ? "lit: the room's parallel light, without the shadow it asks for (a room's directional casts none: the sun's cascades would take it for one of theirs and light it only near the eye)" : "lit: the room's parallel light";
      for (const l of p.points) if (l.key === key) return l.asked ? 'lit without the shadow it asks for: no casting slot free (Graphics: Shadows and distance, Room light shadows)' : 'lit: a round light of the pool';
      for (const l of p.pointShadows) if (l.key === key) return 'lit, casting a shadow';
      for (const l of p.spots) if (l.key === key) return l.asked ? 'lit without the shadow it asks for: no casting slot free' : 'lit: a spot of the pool';
      for (const l of p.spotShadows) if (l.key === key) return 'lit, casting a shadow';
    }
    if (m.warn[i] && m.type[i] === 1 && this.host.shape().spots + this.host.shape().spotShadows === 0) return 'lights nothing: no spot slot is built (Graphics: Shadows and distance, Room lamps)';
    if (m.warn[i]) return 'switched off at some scope';
    return 'not lit now: the pool lights the room you stand in and the rooms its doorways open on, at most its slots of each kind';
  }

  /** The Tools tab's section: the scope, the presets, the hang switch, the pool's shape and the lit room. */
  toolsSections(): EditorSection[] {
    this.refresh();
    const s = this.host.shape();
    const p = this.host.plan();
    const b = this.building;
    return [
      {
        title: 'Lights',
        note: `Click a light to pick it. ${this.adding ? `A click puts ${this.adding.name.toLowerCase()} down.` : 'Choose a preset to put one down.'} The pool: 8 round lights, ${s.spots + s.spotShadows} spots, ${s.pointShadows + s.spotShadows} casting (Graphics: Shadows and distance). ${b ? `This building: ${b.model}${b.copy ? '' : ' (no copy key: its narrowest scope is every copy on this world)'}.` : 'No building round the camera.'}${p ? ` Lit now: ${p.points.length + p.pointShadows.length} round, ${p.spots.length + p.spotShadows.length} spots${p.left.points + p.left.spots + p.left.shadowsRefused ? `; left out ${p.left.points} round, ${p.left.spots} spots, ${p.left.shadowsRefused} shadows` : ''}.` : ''}`,
        rows: [
          { words: `Scope: ${this.scope === 'copy' ? 'this copy' : this.scope === 'world' ? 'every copy on this world' : 'every copy everywhere'}`, buttons: (['copy', 'world', 'all'] as const).map((sc) => ({ label: sc === 'copy' ? 'This copy' : sc === 'world' ? 'This world' : 'Everywhere', act: `lights:scope:${sc}`, off: this.scope === sc })) },
          { words: 'Put down', buttons: [...LIGHT_PRESETS.map((pr) => ({ label: pr.name, act: `lights:add:${pr.id}`, off: this.adding?.id === pr.id })), { label: 'Nothing (pick only)', act: 'lights:add:', off: !this.adding }] },
          { words: this.hang ? 'A light put down hangs on the row of ours under the aim' : 'A light put down is a light of the room (or outdoors)', buttons: [{ label: this.hang ? 'Put it in the room' : 'Hang it on the row', act: 'lights:hang' }] },
        ],
      },
    ];
  }

  /** The Selected tab's sections: the picked light's fields, and the room's fill. */
  selectedSections(): EditorSection[] {
    // Laid out from the files as they stand (a write's answer lands between frames; the window is drawn on an event).
    this.refresh();
    const out: EditorSection[] = [];
    const i = this.pickedIndex();
    if (i >= 0) out.push(this.pickedSection(i));
    const b = this.building;
    const cell = this.cameraCell();
    if (b && cell > 0) {
      const rows = this.host.rows();
      const c = b.cells.find((x) => x.index === cell);
      const fill = this.editsFor(rows, b).find((r) => r.kind === 'fill' && r.cell === cell) ?? null;
      out.push({
        title: "The room's fill",
        note: `${c?.name ?? `room ${cell}`}: its ambient, at ${this.scope} scope (the narrowest row wins). ${fill ? `Now: ${fill.scope}${fill.scale !== undefined ? `, scale ${fill.scale}` : ''}${fill.color ? `, colour ${hexOfColour(fill.color)}` : ''}.` : 'Not edited.'}`,
        fields: [
          { label: 'Fill scale', value: fill?.scale ?? 1, act: 'lights:fill:scale', kind: 'number' },
          { label: 'Fill colour', value: fill?.color ? hexOfColour(fill.color) : '', act: 'lights:fill:color', kind: 'colour' },
        ],
        buttons: fill ? [{ label: 'Clear the fill at this scope', act: 'lights:fill:clear' }] : [],
      });
    }
    return out;
  }

  private pickedSection(i: number): EditorSection {
    const m = this.m;
    const src = m.src[i];
    if (src === 'game') {
      const b = this.building!;
      const c = b.cells.find((x) => x.index === m.cell[i]);
      const l = c?.lights?.[m.game[i]];
      const e = this.editsFor(this.host.rows(), b).find((r) => r.kind === 'edit' && r.cell === m.cell[i] && r.of === m.game[i]) ?? null;
      return {
        title: 'The light',
        note: `${this.markerWords(i)}. ${this.litWords(i)}. ${l ? `Its own: colour ${hexOfColour(l.color as [number, number, number])}, ${pointLightAt3(l.attenuation).toFixed(2)} at 3 m, reach ${pointLightRange(l.attenuation)} m.` : ''} ${e ? `Edited at ${e.scope} scope.` : 'Not edited.'}`,
        fields: [
          { label: 'Off', value: !!e?.off, act: 'lights:set:off', kind: 'check' },
          { label: 'Brightness ×', value: e?.scale ?? 1, act: 'lights:set:scale', kind: 'number' },
          { label: 'Colour', value: e?.color ? hexOfColour(e.color) : '', act: 'lights:set:color', kind: 'colour' },
          { label: 'Reach (m)', value: e?.reach ?? '', act: 'lights:set:reach', kind: 'number' },
          { label: 'Shadow', value: e?.shadow === true, act: 'lights:set:shadow', kind: 'check' },
        ],
        buttons: e ? [{ label: 'Clear its edit at this scope', act: 'lights:clearEdit' }] : [],
      };
    }
    const row = m.row[i];
    const a = src === 'attached' ? this.host.attached().find((x) => x.key === m.key[i]) : null;
    const spec = row ? specOfRow(row) : (a?.spec ?? null);
    const fields: NonNullable<EditorSection['fields']> = [];
    if (row) fields.push({ label: 'Name', value: row.name ?? '', act: 'lights:set:name', kind: 'text' });
    if (spec) {
      fields.push({ label: 'Colour', value: hexOfColour(spec.color), act: 'lights:set:color', kind: 'colour' });
      fields.push({ label: 'Brightness', value: spec.brightness, act: 'lights:set:brightness', kind: 'number' });
      if (spec.type !== 'directional') {
        fields.push({ label: 'Reach (m)', value: spec.reach ?? DEFAULT_REACH, act: 'lights:set:reach', kind: 'number' });
        fields.push({ label: 'Falloff', value: spec.falloff ?? 2, act: 'lights:set:falloff', kind: 'number' });
      }
      if (spec.type === 'spot') {
        const cone = coneOf(spec);
        fields.push({ label: 'Cone inner (°)', value: cone[0], act: 'lights:set:coneInner', kind: 'number' });
        fields.push({ label: 'Cone outer (°)', value: cone[1], act: 'lights:set:coneOuter', kind: 'number' });
      }
      fields.push({ label: 'Shadow', value: !!spec.shadow, act: 'lights:set:shadow', kind: 'check' });
      fields.push({ label: 'Flicker rate (/s)', value: spec.flicker?.rate ?? 4, act: 'lights:set:flickerRate', kind: 'number' });
      fields.push({ label: 'Flicker depth', value: spec.flicker?.depth ?? 0, act: 'lights:set:flickerDepth', kind: 'number' });
    }
    if (row?.pos) fields.push({ label: row.scope === 'outdoor' ? 'Place (x y z, file frame)' : "Place (x y z, building's frame)", value: row.pos.join(' '), act: 'lights:set:pos', kind: 'text' });
    const rows: NonNullable<EditorSection['rows']> = [];
    if (spec) {
      rows.push({ words: `Type: ${spec.type}`, buttons: LIGHT_TYPES.map((t) => ({ label: t, act: `lights:type:${t}`, off: spec.type === t })) });
      rows.push({ words: `Flicker: ${spec.flicker?.shape ?? 'none'}`, buttons: FLICKER_SHAPES.map((s) => ({ label: s, act: `lights:flicker:${s}`, off: (spec.flicker?.shape ?? 'none') === s })) });
    }
    if (row && row.scope !== 'outdoor') rows.push({ words: `Scope: ${row.scope}`, buttons: (['copy', 'world', 'all'] as const).map((sc) => ({ label: sc === 'copy' ? 'This copy' : sc === 'world' ? 'This world' : 'Everywhere', act: `lights:moveScope:${sc}`, off: row.scope === sc })) });
    return {
      title: 'The light',
      note: `${this.markerWords(i)}. ${this.litWords(i)}.${spec?.shadow && spec.type === 'directional' ? " Its shadow is kept in the file and drawn without one: a room's directional casts none." : spec?.shadow && this.host.shape().pointShadows + this.host.shape().spotShadows === 0 ? ' Its shadow is kept in the file and drawn without one: the Graphics page builds no room light shadow (Shadows and distance, Room light shadows).' : ''}`,
      fields,
      rows,
      buttons: row ? [{ label: 'Duplicate', act: 'lights:dup' }, { label: 'Take it out', act: 'lights:remove', danger: true }] : [],
    };
  }

  /** What a button or a field of the tool's sections does (the window's `sectionAct` for acts beginning `lights:`). */
  act(act: string, value?: string): void {
    this.refresh();
    const parts = act.split(':');
    const what = parts[1];
    const arg = parts[2] ?? '';
    if (what === 'scope') {
      if (arg === 'copy' || arg === 'world' || arg === 'all') this.scope = arg;
      this.host.refresh();
      return;
    }
    if (what === 'add') {
      this.adding = arg ? presetOf(arg) : null;
      this.host.say(this.adding ? `a click puts ${this.adding.name.toLowerCase()} down` : 'a click picks a light', true);
      this.host.refresh();
      return;
    }
    if (what === 'hang') {
      this.hang = !this.hang;
      this.host.refresh();
      return;
    }
    if (what === 'dup') return this.duplicate();
    if (what === 'remove') {
      this.deleteKey();
      return;
    }
    if (what === 'clearEdit') {
      const i = this.pickedIndex();
      if (i >= 0 && this.m.src[i] === 'game') void this.editGame(i, { off: null, scale: null, color: null, reach: null, shadow: null });
      return;
    }
    if (what === 'fill') {
      if (arg === 'clear') void this.setFill({ scale: null, color: null });
      else if (arg === 'scale') void this.setFill({ scale: Number(value) });
      else if (arg === 'color') void this.setFill({ color: value ? colourOfHex(value) : null });
      return;
    }
    if (what === 'type') {
      void this.setPicked({ type: arg as LightType });
      return;
    }
    if (what === 'flicker') {
      const i = this.pickedIndex();
      const spec = i >= 0 ? this.specOfMarker(i) : null;
      void this.setPicked({ flicker: arg === 'none' ? null : { shape: arg as FlickerShape, rate: spec?.flicker?.rate ?? 4, depth: spec?.flicker?.depth || 0.4 } });
      return;
    }
    if (what === 'moveScope') {
      void this.setPicked({ scope: arg });
      return;
    }
    if (what === 'set') void this.setField(arg, value ?? '');
  }

  /** The picked marker's light as it stands, or null. */
  private specOfMarker(i: number): LightSpec | null {
    const row = this.rowAt(i);
    if (row) return specOfRow(row);
    if (this.m.src[i] === 'attached') return this.host.attached().find((x) => x.key === this.m.key[i])?.spec ?? null;
    return null;
  }

  /** One field of the Selected tab written (its words as typed). */
  private async setField(field: string, value: string): Promise<string> {
    const i = this.pickedIndex();
    if (i < 0) return 'pick a light first';
    const num = Number(value);
    const spec = this.specOfMarker(i);
    switch (field) {
      case 'off':
        return this.setPicked({ off: value === 'true' ? true : null });
      case 'shadow':
        return this.setPicked({ shadow: value === 'true' ? true : this.m.src[i] === 'game' ? null : null });
      case 'scale':
        return this.setPicked({ scale: Number.isFinite(num) ? num : null });
      case 'color':
        return this.setPicked({ color: value ? colourOfHex(value) : null });
      case 'reach':
        return this.setPicked({ reach: value === '' ? null : Number.isFinite(num) ? num : null });
      case 'brightness':
        return this.setPicked({ brightness: num });
      case 'falloff':
        return this.setPicked({ falloff: num });
      case 'coneInner':
      case 'coneOuter': {
        const cone = spec ? [...coneOf(spec)] : [...DEFAULT_CONE];
        cone[field === 'coneInner' ? 0 : 1] = num;
        return this.setPicked({ cone });
      }
      case 'flickerRate':
      case 'flickerDepth': {
        const fl = spec?.flicker ?? { shape: 'candle' as FlickerShape, rate: 4, depth: 0.4 };
        return this.setPicked({ flicker: { ...fl, [field === 'flickerRate' ? 'rate' : 'depth']: num } });
      }
      case 'name':
        return this.setPicked({ name: value.trim() || null });
      case 'pos':
        return this.setPicked({ pos: value });
      default:
        return `no field ${field}`;
    }
  }

  /** The bar's words while armed. */
  barWords(): string {
    const i = this.pickedIndex();
    return i >= 0 ? `lights: ${this.markerWords(i)}` : this.adding ? `lights: a click puts ${this.adding.name.toLowerCase()} down (${this.scope} scope)` : 'lights: click a light to pick it, or choose a preset on the Tools tab';
  }

  /** What the console says of it. */
  report(): Record<string, unknown> {
    this.refresh();
    const m = this.m;
    const list: Record<string, unknown>[] = [];
    for (let i = 0; i < m.n; i++) list.push({ src: m.src[i], key: m.key[i], type: m.type[i] === 1 ? 'spot' : m.type[i] === 2 ? 'directional' : 'point', cell: m.cell[i], at: [cm(m.xyz[i * 3]), cm(m.xyz[i * 3 + 1]), cm(m.xyz[i * 3 + 2])], warn: !!m.warn[i] });
    const i = this.pickedIndex();
    return { armed: this.armed, scope: this.scope, adding: this.adding?.id ?? null, hang: this.hang, picked: i >= 0 ? { key: m.key[i], src: m.src[i], lit: this.litWords(i) } : null, building: this.building ? { model: this.building.model, copy: this.building.copy } : null, markers: list, busy: this.busy, last: this.last };
  }

  /** A marker picked by its key (the console's `pick`), refreshed first; answers whether it was found. */
  pickKey(key: string): boolean {
    this.seenRows = null;
    this.refresh();
    const m = this.m;
    for (let i = 0; i < m.n; i++) {
      if (m.key[i] !== key) continue;
      this.pickedKey = key;
      this.pickedSrc = m.src[i];
      return true;
    }
    return false;
  }

  /** The picked light moved and turned as the hand would (the console's `move`): world metres and radians, one write. */
  moveKey(dx: number, dy: number, dz: number, yaw = 0, tip = 0): Promise<void> {
    this.seenRows = null;
    this.refresh();
    const i = this.pickedIndex();
    if (i < 0 || !this.movable()) return Promise.resolve();
    return this.writeMove(i, dx, dy, dz, yaw, tip);
  }

  /** The markers laid out again at the next frame (a landing, the console). */
  stale(): void {
    this.seenRows = null;
  }

  /** The console's duplicate of the picked light: answers what was said once it is written. */
  async duplicateNow(): Promise<string> {
    this.seenRows = null;
    this.refresh();
    const i = this.pickedIndex();
    if (i < 0 || !this.movable()) return 'pick a light of ours first';
    return this.duplicateAt(i);
  }

  /** The console's Delete on the picked light (a game light switched off at the tool's scope): answers what was said once written. */
  async deleteNow(): Promise<string> {
    this.seenRows = null;
    this.refresh();
    const i = this.pickedIndex();
    if (i < 0) return 'pick a light first';
    if (this.m.src[i] === 'game') return this.editGame(i, { off: true });
    if (this.m.src[i] === 'attached') return "a light hung on a row comes off with the row's attachments";
    const row = this.rowAt(i);
    return row ? this.removeRow(row) : 'it is not in its file any more';
  }

  /** The console's look at the picked light's lit words (`litWords`), or null. */
  pickedLit(): string | null {
    const i = this.pickedIndex();
    return i >= 0 ? this.litWords(i) : null;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** A point of a kept array (three numbers at `k`) projected through the view, into `out`: false behind the eye. Nothing is made. */
function projectXYZ(v: ScreenView, a: Float64Array, k: number, out: Float64Array): boolean {
  const m = v.vp;
  const x = a[k];
  const y = a[k + 1];
  const z = a[k + 2];
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (!(cw > 1e-6)) return false;
  out[0] = (cx / cw * 0.5 + 0.5) * v.w;
  out[1] = (0.5 - cy / cw * 0.5) * v.h;
  return true;
}

/** A kept point record projected through the view, into `out`: false behind the eye. Nothing is made. */
function projectPivot(v: ScreenView, p: { x: number; y: number; z: number }, out: Float64Array): boolean {
  const m = v.vp;
  const x = p.x;
  const y = p.y;
  const z = p.z;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (!(cw > 1e-6)) return false;
  out[0] = (cx / cw * 0.5 + 0.5) * v.w;
  out[1] = (0.5 - cy / cw * 0.5) * v.h;
  return true;
}

/** A linear colour as `#rrggbb` (channels held to one; a hot colour past white reads as white). */
export function hexOfColour(c: readonly number[]): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

/** `#rrggbb` as a colour (each channel 0 to 1, to three decimals), or null for anything else. */
export function colourOfHex(s: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const c = (v: number) => Math.round((v / 255) * 1000) / 1000;
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}

/** The lights tool as a Tools-list entry, on its own key (`editorLights`). */
export function lightsTool(t: EditorLights): ToolDef {
  return {
    id: 'lights',
    action: 'editorLights',
    label: 'the lights tool',
    armed: () => t.armed,
    arm: () => t.arm(),
    disarm: () => t.disarm(),
    step: (f) => t.step(f),
    draw: (d) => t.draw(d),
    owns: (button) => button === 'apply',
    overlay: (d, view) => t.overlay(d, view),
    holdsMouse: (lift, turn) => t.holdsMouse(lift, turn),
    claimsKeys: () => t.claimsKeys(),
    nudge: (dx, dy, dz) => t.nudge(dx, dy, dz),
    duplicate: () => t.duplicate(),
    deleteKey: () => t.deleteKey(),
    escape: () => t.escape(),
    barWords: () => t.barWords(),
    report: () => t.report(),
  };
}

/** The pool's numbers a light's console line reads, kept away from three for the tests: a light's at-3 value as the rule has it. */
export { LIGHT_LIMITS };
