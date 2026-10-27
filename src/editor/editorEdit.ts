// The world editor's editing (DESIGN.md §2.6, §5): what is picked, the hand on it, the gizmo, the snaps, the nudges,
// copy and paste, delete, undo and redo, game view and the key sheet -- the glue between the pure rules (`selection.ts`,
// `gizmo.ts`, `snapping.ts`, `undo.ts`, `clipboard.ts`, `placeHold.ts`'s `applyHoldMany`) and the game, made by the editor
// (`editorEntry.ts`) and handed its frame at the two points the editor has one: the key block (`keys`, which reads and
// records presses, takes the mouse a hold or a drag uses and mutes nothing of its own) and the step after the camera
// (`frame`, from the camera just placed: the gizmo laid out and picked, a drag or a hold applied, the clicks, the marks).
//
// **Every action writes through at once** as one batch (`EditorHost.batch`, the endpoint's `batch` op), one undo entry
// however many rows and files it touched, and up to `batchMost` edits a request (an action past it goes as consecutive
// batches, one undo entry still). While a hold or a drag is under way **nothing is written**: what is picked is drawn by
// copies of its own drawn meshes (`LayoutStreamer.editorCopies`, on the same geometry, materials and instancing, so they
// build nothing) at where it is going, its own meshes hidden, and the copies stay until the rows written are stood and
// built, so there is no gap. A batch the endpoint refuses changes nothing it had not already written and puts the scene
// back to what the files say, in the endpoint's own words.
//
// **The hand on the selection** is the owner's two keys [owner]: R held turns it about its pivot with the mouse, F held
// raises it, Shift+R tips and rolls it (a prop's, about the camera's own level axes) **only while no move key is held**
// (with one held Shift is the fast flight and R turns), and C held scales it (one number, `exp(cam.scalePerPx * px)`);
// the camera holds still while a key is held. The whole frame's change is worked out once (`applyHoldMany` on one probe
// standing at the pivot, whose turn, rise and scale are the action's totals) and given to every picked row about the
// pivot, so snapping the totals keeps a selection's shape: the turn to `snap.angle`, the rise to the grid, the scale to
// `snap.scaleStep`, and a move by putting the pivot on the grid in the file's own frame (`snapPlace`).
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace,
// no constructor parameter properties. The dev server's alone: reached only through the editor's own dynamic import.

import * as THREE from 'three';
import type { Input } from '../core/input.ts';
import type { PlacedObject } from '../world/layoutStream.ts';
import { PLACEMENT_LIMITS, scaleOf, toGame, mintPlacementId, placementKey, type EditFileKind, type PlacementLayer, type PlacementRow } from '../story/placements.ts';
import { rowMoved, followClear } from '../world/permanentEdit.ts';
import { clearRadius, patchOfBounds } from '../world/housePlace.ts';
import { applyHoldManyIn, manyHoldAsk, manyHoldState, tumbleAxes, type HeldThing, type ManyHoldKind } from '../world/placeHold.ts';
import type { BatchEdit, EditRow } from '../world/placementEdits.ts';
import { EDITOR_TUNE } from './editorTune.ts';
import { CHORD_CODES, HOTBAR_ACTIONS, ctrlChord, shiftTips } from './editorKeys.ts';
import { Selection, boxMode, inBox, likeThis, pivotOf, worldBox, type PivotThing } from './selection.ts';
import { H, axesOfTurn, cursor, dragAt, gizmoDrag, gizmoLayout, grabAt, handlesFor, layoutGizmo, pickAt, ray3, rayAt, screenView, worldAxes, type Cursor, type HeldKey, type ScreenView } from './gizmo.ts';
import { alikeToQuarter, droppedY, leanTo, nudgeAxis, snapFlush, snapPlace, snapValue, stepThrough, surfaceUnder, terrainNormal, type MovedAxes, type SurfaceHit, type WorldBox } from './snapping.ts';
import { History, chunkEdits, doEdits, noteAnswered, takeAnswered, type EditAction, type RowChange } from './undo.ts';
import { clipText, copyRows, pasteAt, pasteSource, pastedRow, type ClipSet } from './clipboard.ts';
import { entryForRow, type LibraryEntry } from './libraryModel.ts';
import { refusalWords } from './devVerdict.ts';
import { projectBox, selSlot, type MarksView } from '../ui/editorMarks.ts';

/** One file a batch touched, as the page landed it: its rows are its kind's (a placement row, a tile of heights). */
export interface EditorBatchFile {
  rev: string;
  rows: number;
  put: EditRow[];
  deleted: string[];
}

/** What one batch came to: its words when refused, each file it touched (by kind), the endpoint's own time, and when what it stood is built. */
export interface EditorBatch {
  ok: boolean;
  why: string;
  files: Partial<Record<EditFileKind, EditorBatchFile>>;
  ms: number;
  built: Promise<void>;
}

/** What git says of one of this world's files (the endpoint's status op). */
export interface EditorFileState {
  kind: string;
  path: string;
  state: 'none' | 'untracked' | 'modified' | 'committed' | 'main';
}

/** What the editing needs of the editor and the game: everything it reads and asks, handed in. */
export interface EditEditor {
  readonly input: Input;
  readonly fly: { yaw: number; pitch: number; lookDir(out: { x: number; y: number; z: number }): unknown; lookAlong(x: number, y: number, z: number): void; stop(): void };
  readonly pointer: { x: number; y: number; over: boolean; buttons: number; pressed: number; released: number; dragging: boolean; clicked: boolean; downX: number; downY: number };
  /** Point mode: the cursor free. */
  readonly point: boolean;
  /** Whether something is in the hand (the library's, or a row picked up). */
  inHand(): boolean;
  /** The permanent row the aim rests on, by id, or null. */
  hoveredId(): string | null;
  /** The placed object a key is filed under, its model box and whether it is a building with rooms. */
  placed(key: string): PlacedObject | null;
  boxOf(o: PlacedObject): { min: number[]; max: number[] } | null;
  hasRooms(key: string): boolean;
  /** The editor's live copies of a placement, and its own meshes hidden or shown again. */
  copies(key: string): THREE.InstancedMesh[];
  dropCopies(c: readonly THREE.InstancedMesh[]): void;
  setHidden(key: string, hidden: boolean): void;
  /** A row of this world's files by id, its layer and what it is called; null for none. */
  rowFor(id: string): { row: PlacementRow; layer: PlacementLayer; label: string } | null;
  /** Every row of this world's files that stands now, with its place in the game's frame. */
  standing(): { id: string; row: PlacementRow; layer: PlacementLayer; x: number; y: number; z: number }[];
  /** Every id both files hold now. */
  idsTaken(): Set<string>;
  /** The frame the files are written in, and the centre rows are written about. */
  frame(): 'raw' | 'game';
  centre(): { x: number; z: number } | null;
  /** The ground under a point (NaN for none known), and what stands still under a point within a reach, its height and normal. */
  terrainAt(x: number, z: number): number;
  castDown(x: number, y: number, z: number, reach: number, inside: boolean, out: { y: number; nx: number; ny: number; nz: number }): boolean;
  /**
   * Whether a point of the game's frame stands in a building's room, by the rule wave 1's placing asks (the camera's own:
   * the smallest room whose box holds it with its own floor under it): what a row moved, pasted or duplicated there is
   * written as (`inside`), as one put down there would be.
   */
  roomAt(x: number, y: number, z: number): boolean;
  inSpace(): boolean;
  packId(): string;
  /** Which world is up, as the world's own count of loads (a world gone and come back is another): the history's key. */
  worldMark(): number;
  /** The aim's hit, this frame. */
  hit(): { x: number; y: number; z: number };
  /** One batch written and landed. */
  batch(edits: BatchEdit[]): Promise<EditorBatch>;
  /** Git's word on this world's files. */
  status(): Promise<{ branch: string | null; main: string | null; files: EditorFileState[] } | string>;
  /** Words on the bar. */
  say(words: string, ok: boolean): void;
  /** A library entry taken in hand; the library's entry a row writes; the library's entry by key; the hand's own key. */
  take(e: LibraryEntry): Promise<string | null>;
  entryOfRow(row: PlacementRow): LibraryEntry | null;
  entryByKey(key: string): LibraryEntry | null;
  handKey(): string | null;
  hotbar(): (string | null)[];
  setHotbar(slot: number, key: string | null): void;
  /** The window drawn again (a selection changed, a write landed). */
  refreshWindow(): void;
  /**
   * Whether a tool of the Tools list is armed (the scatter brush, the sculpt brush, `tools.ts`): its buttons are its own,
   * so no click picks, boxes or orbits meanwhile, and the selection takes no hold (C with the wheel sizes the tool).
   */
  toolArmed?(): boolean;
}

/**
 * A brush stroke (`beginStroke`): the action its stamps wrote, as answered, recorded once as it ends; what went and what was
 * refused; and the world it was begun in (`worldNow`), so a stamp after the world went writes nothing.
 */
export interface Stroke {
  a: EditAction;
  edits: number;
  batches: number;
  ms: number;
  files: Set<string>;
  refused: string;
  ended: boolean;
  world: number;
}

/** One picked row being moved: where it started, where it is going, and the copies drawn for it meanwhile. */
interface Live {
  id: string;
  key: string;
  layer: PlacementLayer;
  row: PlacementRow;
  label: string;
  /** Where it started, in the game's frame (three's order), and its scale. */
  base: HeldThing;
  /** Where it is going, worked out afresh each frame from the totals. */
  now: HeldThing;
  /** A building with rooms: it takes no scale (the stand sets one aside). */
  rooms: boolean;
  box: { min: number[]; max: number[] } | null;
  copies: THREE.InstancedMesh[];
}

/** An edit under way: what it is called, its rows, its pivot, and its totals. */
interface LiveEdit {
  label: string;
  /** Where it came from: a held key, a drag of the gizmo, or a single step (a nudge, End, a field). */
  via: 'hold' | 'drag' | 'step';
  lives: Live[];
  pivot: { x: number; y: number; z: number };
  /** The totals: a probe at the pivot, which the hand turns, raises and scales (`applyHoldMany`). */
  probe: HeldThing;
  /** A move (the gizmo's arrows and square, a nudge), metres of the game's frame, and which axes it moved. */
  mx: number;
  my: number;
  mz: number;
  moved: MovedAxes;
  /** A drag's own turn (a ring) about a world axis, radians, and a scale along one of the first's own axes (-1 none). */
  ringAxis: number;
  ringAngle: number;
  axisScale: number;
  axisF: number;
  /** V held: the move taken flush to a neighbour. */
  flush: { x: number; y: number; z: number };
  /** The neighbours' boxes, gathered the first frame V is held in this edit (nothing else moves while it is under way). */
  near: WorldBox[] | null;
}

const ONE_V = new THREE.Vector3(1, 1, 1);

function held(t: HeldThing): HeldThing {
  return { x: t.x, y: t.y, z: t.z, turn: { x: t.turn.x, y: t.turn.y, z: t.turn.z, w: t.turn.w }, sx: t.sx, sy: t.sy, sz: t.sz };
}

/** The editing. */
export class EditorEdits {
  readonly sel = new Selection();
  readonly history = new History(EDITOR_TUNE.undoMost);
  /** Snapping, for the session: on or off, the grid's step (metres) and the angle's (degrees). */
  snapOn = EDITOR_TUNE.snap.on;
  grid = EDITOR_TUNE.snap.grid;
  angle = EDITOR_TUNE.snap.angle;
  /** World or local axes for the gizmo's arrows (the bar's button). */
  localAxes = false;
  /** Game view (G): every mark and the bar hidden. The key sheet (H). */
  gameView = false;
  keySheet = false;
  /** The clipboard kept in memory. */
  clip: ClipSet | null = null;
  /** A batch in flight: nothing else is written until it answers. */
  writing = false;
  /** The last write: what it was, how many edits, and what it came to. */
  lastWrite: { label: string; edits: number; batches: number; ms: number; files: string[]; said: string } | null = null;
  /** Git's last word on this world's files. */
  fileStates: EditorFileState[] = [];
  branch: string | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ed: EditEditor;
  private live: LiveEdit | null = null;
  private readonly hold = manyHoldState();
  /** The hold's ask, kept and written in place a frame (`applyHoldManyIn`). */
  private readonly holdAsk = manyHoldAsk();
  /**
   * The frame's clock, which the caller writes before `keys` (`dt`, seconds) and `frame` (`now`, seconds): kept, since a
   * number handed to a call the compiler leaves out is boxed, and both are called every frame. Fractions from the start.
   */
  readonly clock = { now: 0.5, dt: 0.0166 };
  /** This frame's hold, as the key block read it: what is held and the mouse it took. */
  private holdKind: ManyHoldKind | null = null;
  // Fractions from the start (each written before it is read): a field that starts whole boxes every fraction written after.
  private holdDX = 0.5;
  private holdDY = 0.5;
  private holdDt = 0.016;
  /** A drag of the gizmo in progress, and Fly's cursor for it (the crosshair plus the mouse since the press). */
  private readonly drag = gizmoDrag();
  private dragging = false;
  private readonly flyCursor: Cursor = cursor();
  /** The cursor this frame's gizmo is picked and dragged by, kept. */
  private readonly cur: Cursor = cursor();
  private leftDown = false;
  private leftPressed = false;
  private leftReleased = false;
  private middlePressed = false;
  private orbitDX = 0.5;
  private orbitDY = 0.5;
  private orbiting = false;
  private lastPX = Number.NaN;
  private lastPY = Number.NaN;
  /** A box selection being drawn (Point mode, from empty ground). */
  private boxing = false;
  private boxX0 = 0.5;
  private boxY0 = 0.5;
  /** A delete past `askAbove` asked once, until when. */
  private askedDelete = 0;
  private askedCount = 0;
  // Kept for the frame: nothing in a frame is made.
  readonly view: ScreenView = screenView();
  private readonly layout = gizmoLayout();
  private readonly axes = worldAxes();
  private readonly ray = ray3();
  private readonly shown: boolean[] = new Array(12).fill(false);
  private readonly pivot = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly lo: [number, number, number] = [0, 0, 0];
  private readonly hi: [number, number, number] = [0, 0, 0];
  private readonly axesView = { fx: 0, fz: 0, rx: 0, rz: 0 };
  private readonly look = { x: 0, y: 0, z: 0 };
  private readonly unionLo: [number, number, number] = [0, 0, 0];
  private readonly unionHi: [number, number, number] = [0, 0, 0];
  private readonly unionEls = new Float64Array(16);
  private selKeys: string[] = [];
  private selVersion = -1;
  /** The one probe a hold turns, raises and scales, as the list `applyHoldMany` takes (kept, so a frame makes no list). */
  private readonly probes: HeldThing[] = [];
  /** Whether the selection takes a scale along each axis, worked out when it changes. */
  private perAxisNow = false;
  /**
   * Whether Shift+R may tip and roll the selection: never while a building is picked (DESIGN.md §2.6, "tips and rolls
   * (props)"; a building is only ever turned about up, as the placing hand turns one), worked out when it changes.
   */
  private tumbleOk = true;
  /** A frame of Ctrl held (`idle`): nothing of it is a click, a box or a pick. */
  private quiet = false;
  /** The grid's snap of the pivot moved, kept. */
  private readonly snapIn = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly snapOut = { x: 0.5, y: 0.5, z: 0.5 };

  constructor(ed: EditEditor) {
    this.ed = ed;
  }

  /** The world went: its history, its selection and anything under way let go (nothing is written). The clipboard stays, to paste into the next. */
  worldGone(): void {
    this.cancel(false);
    // A stroke under way goes with its world's history, unrecorded.
    for (const s of this.strokes) s.ended = true;
    this.strokes.clear();
    this.sel.clear();
    this.history.clear();
    this.fileStates = [];
    this.worldNow = this.ed.worldMark();
  }

  /** The world the history and the selection are of: a world left with the editor off is found out at the next use. */
  private worldNow = -1;

  /** Whether the world is still the one the history is of; if not, everything of the last one let go. Answers whether it was. */
  private sameWorld(): boolean {
    const mark = this.ed.worldMark();
    if (mark === this.worldNow) return true;
    this.worldGone();
    return false;
  }

  /** Where the last copy came from (words only). */
  private clipFromWorld = '';

  /** Whether a tool is armed (its buttons are its own, and the selection takes no hold meanwhile). */
  private armed(): boolean {
    return this.ed.toolArmed ? this.ed.toolArmed() : false;
  }

  /** Whether a hold, a drag or an orbit has the mouse this frame (the camera holds still). */
  get takesMouse(): boolean {
    return this.holdKind !== null || this.dragging || this.orbiting;
  }

  /** Whether anything is under way (a hold, a drag, a box being drawn). */
  get busy(): boolean {
    return !!this.live || this.boxing;
  }

  /** Whether a gizmo handle is under the cursor (a click there is the gizmo's, not a way back to Fly). */
  get handleHot(): boolean {
    return this.layout.on && this.layout.hot >= 0;
  }

  // ---- The key block: presses read and recorded, the mouse a hold, a drag or an orbit uses taken. ----

  /**
   * The chords, while Ctrl is held: read as raw keys, every action muted for the frame meanwhile (the editor's block mutes
   * them; this only reads). Ctrl+V is the browser's paste and comes through the document's own `paste` event.
   */
  chords(): void {
    this.sameWorld();
    const input = this.ed.input;
    const shift = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    for (const code of CHORD_CODES) {
      if (!input.justPressed(code)) continue;
      const c = ctrlChord(code, shift);
      if (c === 'dup') void this.duplicate();
      else if (c === 'copy') void this.copy(false);
      else if (c === 'cut') void this.copy(true);
      else if (c === 'undo') void this.undo(1);
      else if (c === 'redo') void this.redo(1);
    }
  }

  /**
   * A frame with Ctrl held, in place of `keys`: the hold, the drag and the orbit given none of the mouse and no button's
   * edge, so a hold or a drag made before Ctrl simply pauses (read off the last frame's mouse, it was played again every
   * frame Ctrl stayed down, and a stale release clicked the selection every frame). Point's cursor is read afresh when
   * Ctrl comes up, and the mouse a hold or a drag has is taken here too, so the camera still holds still.
   */
  idle(): void {
    this.holdDX = 0;
    this.holdDY = 0;
    this.leftPressed = false;
    this.leftReleased = false;
    this.middlePressed = false;
    this.orbitDX = 0;
    this.orbitDY = 0;
    this.lastPX = Number.NaN;
    this.quiet = true;
    if (this.takesMouse && !this.ed.point) {
      this.ed.input.mouseDX = 0;
      this.ed.input.mouseDY = 0;
    }
  }

  /**
   * Whether a plain click in Point (no drag, nothing in hand, over no row and no handle: the caller's tests) takes the mouse
   * back to Fly: only with nothing picked and nothing under way, since the same click with something picked lets go of it
   * (the frame's own click, which reads the very press). Decided at the click and never by whether a frame has seen the
   * press yet: the page's click comes in the same task as the release, before or after any frame, and asked of the box
   * the press began it went to Fly only when the press and the release fell in one frame.
   */
  clickGoesToFly(): boolean {
    return !this.live && !this.dragging && !this.writing && this.sel.size === 0;
  }

  /**
   * The editing keys, read with Ctrl up, before the mutes take what the editor borrows (the frame's seconds in
   * `clock.dt`, written first). `typing`: a text field has the keyboard.
   */
  keys(typing: boolean): void {
    const dt = this.clock.dt;
    this.sameWorld();
    this.refreshKeys();
    const input = this.ed.input;
    const point = this.ed.point;
    const shift = input.held('walk');
    // The hold: R turns (Shift+R tips while no move key is held, and never a building), F raises, C scales; R wins when
    // several are held.
    const moving = input.held('forward') || input.held('back') || input.held('left') || input.held('right');
    const turn = input.held('placeTurn');
    const lift = input.held('placeLift');
    const scale = input.held('editorScale');
    // No hold while a tool is armed (Map-maker II §2.3): C with the wheel sizes the tool, whatever is picked, and the picked
    // rows take their holds again once it is put down.
    const canHold = this.sel.size > 0 && !this.ed.inHand() && !typing && !this.armed();
    this.holdKind = !canHold ? null : turn ? (shiftTips(shift, moving) && this.tumbleOk ? 'tumble' : 'turn') : lift ? 'lift' : scale ? 'scale' : null;
    // The mouse this frame: Fly's movement (spent here, so the camera holds still), Point's cursor's own.
    let dx = 0;
    let dy = 0;
    if (point) {
      const px = this.ed.pointer.x;
      const py = this.ed.pointer.y;
      if (Number.isFinite(this.lastPX)) {
        dx = px - this.lastPX;
        dy = py - this.lastPY;
      }
      this.lastPX = px;
      this.lastPY = py;
    } else {
      dx = input.mouseDX;
      dy = input.mouseDY;
      this.lastPX = Number.NaN;
    }
    this.holdDX = dx;
    this.holdDY = dy;
    this.holdDt = dt;
    // The buttons: Fly's are the attack's (left) and the other trigger's (middle), Point's the pointer's own.
    if (point) {
      const p = this.ed.pointer;
      this.leftPressed = (p.pressed & 1) !== 0;
      this.leftReleased = (p.released & 1) !== 0;
      this.leftDown = (p.buttons & 1) !== 0;
      this.middlePressed = (p.pressed & 2) !== 0;
      this.orbiting = false;
    } else {
      this.leftPressed = input.pressedAction('attack');
      const was = this.leftDown;
      this.leftDown = input.held('attack');
      this.leftReleased = was && !this.leftDown;
      this.middlePressed = input.pressedAction('altFire');
      // RMB held in Fly orbits the selection about its pivot (with the brush armed it erases instead).
      this.orbiting = this.sel.size > 0 && !this.ed.inHand() && !this.armed() && input.held('altAttack');
      if (this.dragging) {
        this.flyCursor.x += dx;
        this.flyCursor.y += dy;
      }
    }
    this.orbitDX = this.orbiting ? dx : 0;
    this.orbitDY = this.orbiting ? dy : 0;
    if (this.takesMouse && !point) {
      input.mouseDX = 0;
      input.mouseDY = 0;
    }
    if (typing) return;
    // The grid, the angle and the snap's switch.
    if (input.pressedAction('editorGridDown') || input.pressedAction('editorGridUp')) {
      const dir = input.pressedAction('editorGridUp') ? 1 : -1;
      if (shift) this.angle = stepThrough(EDITOR_TUNE.snap.angleSteps, this.angle, dir);
      else this.grid = stepThrough(EDITOR_TUNE.snap.gridSteps, this.grid, dir);
      this.ed.say(shift ? `angle snap ${this.angle}°` : `grid ${this.grid} m`, true);
    }
    if (input.pressedAction('editorSnap')) {
      this.snapOn = !this.snapOn;
      this.ed.say(this.snapOn ? `snapping on: ${this.grid} m, ${this.angle}°` : 'snapping off', true);
    }
    if (input.pressedAction('editorGameView')) this.gameView = !this.gameView;
    if (input.pressedAction('editorKeys')) this.keySheet = !this.keySheet;
    for (let i = 0; i < HOTBAR_ACTIONS.length; i++) {
      if (!input.pressedAction(HOTBAR_ACTIONS[i])) continue;
      if (shift) this.setHotbar(i + 1);
      else void this.useHotbar(i + 1);
    }
    if (this.middlePressed) void this.eyedropper();
    if (this.ed.inHand() || this.writing || this.live) return;
    // One-shot steps on the selection.
    if (this.sel.size) {
      const along = (input.pressedAction('editorNudgeFwd') ? 1 : 0) - (input.pressedAction('editorNudgeBack') ? 1 : 0);
      const across = (input.pressedAction('editorNudgeRight') ? 1 : 0) - (input.pressedAction('editorNudgeLeft') ? 1 : 0);
      const up = (input.pressedAction('editorNudgeUp') ? 1 : 0) - (input.pressedAction('editorNudgeDown') ? 1 : 0);
      if (along || across) {
        this.ed.fly.lookDir(this.look);
        const a = nudgeAxis(this.look.x, this.look.z, along, across, EDITOR_TUNE.nudge.cameraRelative, { x: 0, z: 0 });
        void this.step('nudge', a.x * this.grid, 0, a.z * this.grid);
      } else if (up) void this.step('nudge', 0, up * this.grid, 0);
      if (input.pressedAction('editorGround')) void this.ground(shift);
      if (input.pressedAction('editorFocus')) this.focus();
    }
  }

  /**
   * The wheel with a hand key held: one notch (`dir` +1 up) steps what the key holds by its grid -- the turn by the angle
   * step (up clockwise, as the mouse goes), the rise by the grid, the scale by the scale step.
   */
  wheelStep(dir: number): void {
    const L = this.live;
    if (!L || L.via !== 'hold' || !dir) return;
    const p = L.probe;
    if (this.holdKind === 'turn') {
      const a = (-dir * this.angle * Math.PI) / 180;
      const hs = Math.sin(a / 2);
      const hw = Math.cos(a / 2);
      const x = hw * p.turn.x + hs * p.turn.z;
      const y = hw * p.turn.y + hs * p.turn.w;
      const z = hw * p.turn.z - hs * p.turn.x;
      const w = hw * p.turn.w - hs * p.turn.y;
      p.turn.x = x;
      p.turn.y = y;
      p.turn.z = z;
      p.turn.w = w;
    } else if (this.holdKind === 'lift') p.y += dir * this.grid;
    else if (this.holdKind === 'scale') p.sx = p.sy = p.sz = Math.max(EDITOR_TUNE.snap.scaleStep, p.sx + dir * EDITOR_TUNE.snap.scaleStep);
  }

  /** Delete (with nothing in hand): the selection taken out of its files, asking once past `askAbove`. Answers whether it took the key. */
  deleteKey(): boolean {
    if (!this.sel.size) return false;
    void this.deleteSelected(false);
    return true;
  }

  // ---- The frame, after the camera. ----

  /**
   * This frame's view, the gizmo, the hold or the drag, the clicks and the marks, from the camera just placed (`vp`, its
   * inverse, the eye, the look, the focal length), into `marks`, the moment in `clock.now` (written first). Nothing in a
   * frame is made, a hold's frame included (measured in twelve processes, `editorEdits.test.ts`).
   */
  frame(marks: MarksView): void {
    const now = this.clock.now;
    const v = this.view;
    const ed = this.ed;
    this.sameWorld();
    this.refreshKeys();
    // The pivot: an edit's own, fixed while it is under way, else the selection's now.
    const live = this.live;
    let hasPivot = false;
    if (live) {
      this.pivot.x = live.pivot.x;
      this.pivot.y = live.pivot.y;
      this.pivot.z = live.pivot.z;
      hasPivot = true;
    } else hasPivot = this.selectionPivot(this.pivot);
    // The hold: a key held with something picked (begun only once the last write has answered).
    if (this.holdKind && hasPivot && !this.dragging) {
      if (!this.live && !this.writing) this.begin(this.holdKind === 'tumble' ? 'tip' : this.holdKind, 'hold');
      const L = this.live;
      if (L && L.via === 'hold') {
        // The view's level axes only for a tip and roll, which alone turns about them (asked every frame, their measure
        // made a number a frame for every other hold).
        if (this.holdKind === 'tumble') {
          this.ed.fly.lookDir(this.look);
          tumbleAxes(this.look.x, this.look.z, 0, this.axesView);
        }
        this.probes[0] = L.probe;
        const a = this.holdAsk;
        a.which = this.holdKind;
        a.dx = this.holdDX;
        a.dy = this.holdDY;
        a.dt = this.holdDt;
        a.sens = 1;
        a.axes = this.axesView;
        a.things = this.probes;
        a.pivot = L.pivot;
        a.scalePerPx = EDITOR_TUNE.cam.scalePerPx;
        a.now = now;
        applyHoldManyIn(this.hold, a);
      }
    } else if (this.live?.via === 'hold' && !this.holdKind) {
      this.hold.which = null;
      void this.commit();
    }
    // The orbit: RMB held in Fly, the eye turned about the pivot and looking at it.
    if (this.orbiting && hasPivot && (this.orbitDX || this.orbitDY)) this.orbit();
    // The gizmo: which handles show for the key held, laid out on the screen, picked under the cursor.
    const key: HeldKey = !this.holdKind ? 'none' : this.holdKind === 'tumble' ? 'tumble' : this.holdKind;
    const gz = this.layout;
    gz.on = false;
    // No gizmo while a tool is armed: its buttons are the tool's, and a press on a handle would drag the picked rows under
    // the stroke (the rows stay picked, drawn by their boxes, and take the gizmo again once the tool is put down).
    if (hasPivot && !ed.inHand() && this.sel.size && !this.armed()) {
      handlesFor(key, this.perAxis(), this.shown);
      for (let i = 0; i < this.shown.length; i++) gz.shown[i] = this.shown[i];
      // The arrows on the world's axes or the first row's own (the bar's button); the scale boxes always on the row's own,
      // since a box's scale is written along the row's own axis (`placeOne`), and laid on the world's the box dragged
      // and the axis stretched part on any row not square to the world.
      if ((this.localAxes || key === 'scale') && this.sel.size) {
        const o = this.placedFirst();
        if (o) axesOfTurn(o.q, this.axes);
        else this.resetAxes();
      } else this.resetAxes();
      layoutGizmo(v, this.pivot, this.axes, EDITOR_TUNE.gizmo.px, gz);
      if (!this.dragging) {
        const c = this.cur;
        c.x = ed.point ? ed.pointer.x : v.w / 2;
        c.y = ed.point ? ed.pointer.y : v.h / 2;
        if (!ed.point || ed.pointer.over) pickAt(gz, c, EDITOR_TUNE.pick.hitPx);
        else gz.hot = -1;
      }
    }
    // A press on a handle grabs it; a release lets go and writes. The rings, the up arrow and the scale boxes show only
    // while their key is held, whose hold is under way from the first frame the key is down: a press on one of them gives
    // that hold up (nothing written, nothing of it kept: the mouse that took the cursor onto the handle turned it too) and
    // grabs the handle, or none of them could ever be dragged.
    if (this.leftPressed && gz.on && gz.hot >= 0 && !this.writing && !this.dragging) {
      if (this.live?.via === 'hold') this.cancel(false);
      if (!this.live) this.grab(gz.hot);
    }
    if (this.dragging) {
      const c = this.cur;
      c.x = ed.point ? ed.pointer.x : this.flyCursor.x;
      c.y = ed.point ? ed.pointer.y : this.flyCursor.y;
      rayAt(v, c, this.ray);
      if (dragAt(this.drag, gz, c, this.ray)) this.takeDrag();
      if (this.leftReleased || !this.leftDown) {
        this.dragging = false;
        void this.commit();
      }
    }
    // A box selection: Point, a drag from empty ground (one left behind by a click that went to Fly is let go).
    if (!ed.point) this.boxing = false;
    const armed = this.armed();
    if (ed.point && !this.dragging) {
      const p = ed.pointer;
      if (this.leftPressed && !this.quiet && !armed && !ed.inHand() && gz.hot < 0 && !ed.hoveredId()) {
        this.boxing = true;
        this.boxX0 = p.x;
        this.boxY0 = p.y;
      }
      if (this.boxing && (this.leftReleased || !this.leftDown)) {
        this.boxing = false;
        if (p.dragging || Math.abs(p.x - this.boxX0) + Math.abs(p.y - this.boxY0) > EDITOR_TUNE.pick.dragPx) this.boxSelect(this.boxX0, this.boxY0, p.x, p.y);
      }
    }
    // A click with nothing in hand and nothing grabbed: the selection (Shift adds or takes away).
    const clicked = ed.point ? ed.pointer.clicked : this.leftReleased && !this.wasDrag;
    if (clicked && !this.quiet && !armed && !ed.inHand() && !this.dragging && !this.live && gz.hot < 0) {
      const shift = ed.input.isDown('ShiftLeft') || ed.input.isDown('ShiftRight');
      if (this.sel.click(ed.hoveredId(), shift)) ed.refreshWindow();
    }
    this.wasDrag = this.dragging;
    if (this.live) this.placeLive();
    this.drawSelection(marks);
    marks.gizmo = gz.on ? gz : null;
    marks.rectOn = this.boxing && ed.point;
    if (marks.rectOn) {
      const r = marks.rect;
      r[0] = this.boxX0;
      r[1] = this.boxY0;
      r[2] = ed.pointer.x;
      r[3] = this.boxY0;
      r[4] = ed.pointer.x;
      r[5] = ed.pointer.y;
      r[6] = this.boxX0;
      r[7] = ed.pointer.y;
    }
    marks.hidden = this.gameView;
    this.quiet = false;
  }
  private wasDrag = false;

  /** The gizmo's axes back to the world's own. */
  private resetAxes(): void {
    const e = this.axes.ax;
    e[0] = 1;
    e[1] = 0;
    e[2] = 0;
    e[3] = 0;
    e[4] = 1;
    e[5] = 0;
    e[6] = 0;
    e[7] = 0;
    e[8] = 1;
  }

  /** The selection's keys worked out again when it changed, ids naming nothing in either file let go. */
  private refreshKeys(): void {
    if (this.sel.version === this.selVersion) return;
    this.selVersion = this.sel.version;
    this.selKeys = this.sel.ids.map((id) => placementKey(id));
    // Per-axis scale boxes: one prop picked, with no rooms.
    const r = this.sel.size === 1 ? this.ed.rowFor(this.sel.ids[0]) : null;
    this.perAxisNow = !!r && r.row.kind === 'prop' && !this.ed.hasRooms(this.selKeys[0]);
    // Tip and roll: props alone.
    this.tumbleOk = this.sel.ids.every((id) => this.ed.rowFor(id)?.row.kind !== 'building');
  }

  private placedFirst(): PlacedObject | null {
    return this.selKeys.length ? this.ed.placed(this.selKeys[0]) : null;
  }

  /** Per-axis scale boxes: one prop picked, with no rooms (worked out when the selection changes). */
  private perAxis(): boolean {
    return this.perAxisNow;
  }

  /**
   * The pivot of what is picked and standing, into `out`; false for nothing standing. The keys are asked again first (a
   * version check, nothing a steady frame pays for): a selection changed and acted on in one call -- the console's
   * `{ select, turn }`, with no frame between -- turned the new rows about the old selection's pivot and wrote them there.
   */
  private selectionPivot(out: { x: number; y: number; z: number }): boolean {
    this.refreshKeys();
    let n = 0;
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    let fx = 0;
    let fy = 0;
    let fz = 0;
    for (let i = 0; i < this.selKeys.length; i++) {
      const o = this.ed.placed(this.selKeys[i]);
      if (!o) continue;
      if (n === 0) {
        fx = o.x;
        fy = o.y;
        fz = o.z;
      }
      n++;
      const b = this.ed.boxOf(o);
      if (b) {
        const sc = o.scale ?? ONE_V;
        worldBox(b.min, b.max, sc.x, sc.y, sc.z, o.q, o, this.lo, this.hi);
      } else {
        this.lo[0] = this.hi[0] = o.x;
        this.lo[1] = this.hi[1] = o.y;
        this.lo[2] = this.hi[2] = o.z;
      }
      if (this.lo[0] < x0) x0 = this.lo[0];
      if (this.lo[1] < y0) y0 = this.lo[1];
      if (this.lo[2] < z0) z0 = this.lo[2];
      if (this.hi[0] > x1) x1 = this.hi[0];
      if (this.hi[2] > z1) z1 = this.hi[2];
    }
    if (!n) return false;
    if (n === 1) {
      out.x = fx;
      out.y = fy;
      out.z = fz;
    } else {
      out.x = (x0 + x1) / 2;
      out.y = y0;
      out.z = (z0 + z1) / 2;
    }
    return true;
  }

  /** The selected things' boxes into the marks: the live ones where an edit is under way, else as they stand. */
  private drawSelection(marks: MarksView): void {
    const v = this.view;
    const most = Math.max(1, EDITOR_TUNE.outline.most);
    const live = this.live;
    const count = live ? live.lives.length : this.selKeys.length;
    marks.selAll = count > most;
    marks.selCount = 0;
    const ul = this.unionLo;
    const uh = this.unionHi;
    ul[0] = ul[1] = ul[2] = Infinity;
    uh[0] = uh[1] = uh[2] = -Infinity;
    for (let i = 0; i < count; i++) {
      let b: { min: number[]; max: number[] } | null;
      if (live) {
        const l = live.lives[i];
        b = l.box;
        if (!b) continue;
        this.p.set(l.now.x, l.now.y, l.now.z);
        this.q.set(l.now.turn.x, l.now.turn.y, l.now.turn.z, l.now.turn.w);
        this.s.set(l.now.sx, l.now.sy, l.now.sz);
      } else {
        const o = this.ed.placed(this.selKeys[i]);
        if (!o) continue;
        b = this.ed.boxOf(o);
        if (!b) continue;
        this.p.set(o.x, o.y, o.z);
        this.q.copy(o.q);
        if (o.scale) this.s.copy(o.scale);
        else this.s.set(1, 1, 1);
      }
      if (marks.selAll) {
        worldBox(b.min, b.max, this.s.x, this.s.y, this.s.z, this.q, this.p, this.lo, this.hi);
        for (let k = 0; k < 3; k++) {
          if (this.lo[k] < ul[k]) ul[k] = this.lo[k];
          if (this.hi[k] > uh[k]) uh[k] = this.hi[k];
        }
        continue;
      }
      this.m.compose(this.p, this.q, this.s);
      if (projectBox(b.min, b.max, this.m.elements, v.vp, v.w, v.h, selSlot(marks, marks.selCount))) marks.selCount++;
    }
    if (marks.selAll) {
      const e = this.unionEls;
      e.fill(0);
      e[0] = e[5] = e[10] = e[15] = 1;
      marks.selAll = Number.isFinite(ul[0]) && projectBox(ul, uh, e, v.vp, v.w, v.h, marks.selUnion);
    }
  }

  // ---- Beginning, carrying and ending an edit. ----

  /**
   * An edit begun on what is picked: each row's place now taken as where it starts, copies of its drawn meshes hung in
   * its place (its own meshes hidden), the pivot fixed. Rows not standing (their tier not loaded) are moved all the same
   * and drawn by nothing until they stand.
   */
  private begin(label: string, via: LiveEdit['via']): LiveEdit | null {
    const ed = this.ed;
    const lives: Live[] = [];
    const centre = ed.centre();
    const frame = ed.frame();
    for (const id of this.sel.ids) {
      const r = ed.rowFor(id);
      if (!r) continue;
      const key = placementKey(id);
      const g = toGame(r.row, centre, frame);
      const sc = scaleOf(r.row);
      const rooms = ed.hasRooms(key);
      const base: HeldThing = { x: g.x, y: g.y, z: g.z, turn: { x: g.q[0], y: g.q[1], z: g.q[2], w: g.q[3] }, sx: rooms ? 1 : sc[0], sy: rooms ? 1 : sc[1], sz: rooms ? 1 : sc[2] };
      const o = ed.placed(key);
      const copies = ed.copies(key);
      if (copies.length) ed.setHidden(key, true);
      lives.push({ id, key, layer: r.layer, row: r.row, label: r.label, base, now: held(base), rooms, box: o ? ed.boxOf(o) : null, copies });
    }
    if (!lives.length) return null;
    const pv = { x: 0, y: 0, z: 0 };
    if (!this.selectionPivot(pv)) {
      pv.x = lives[0].base.x;
      pv.y = lives[0].base.y;
      pv.z = lives[0].base.z;
    }
    this.hold.which = null;
    this.live = {
      label,
      via,
      lives,
      pivot: pv,
      probe: { x: pv.x, y: pv.y, z: pv.z, turn: { x: 0, y: 0, z: 0, w: 1 }, sx: 1, sy: 1, sz: 1 },
      mx: 0,
      my: 0,
      mz: 0,
      moved: { x: false, y: false, z: false },
      ringAxis: -1,
      ringAngle: 0,
      axisScale: -1,
      axisF: 1,
      flush: { x: 0, y: 0, z: 0 },
      near: null,
    };
    return this.live;
  }

  /** A handle grabbed: an edit begun as a drag, Fly's cursor at the crosshair. */
  private grab(handle: number): void {
    const v = this.view;
    const c = this.cur;
    c.x = this.ed.point ? this.ed.pointer.x : v.w / 2;
    c.y = this.ed.point ? this.ed.pointer.y : v.h / 2;
    rayAt(v, c, this.ray);
    if (!grabAt(this.drag, this.layout, handle, v, this.pivot, c, this.ray)) return;
    const label = handle === H.yaw || handle === H.pitch || handle === H.roll ? 'turn' : handle === H.scale || handle === H.sx || handle === H.sy || handle === H.sz ? 'scale' : 'move';
    if (!this.begin(label, 'drag')) return;
    this.flyCursor.x = c.x;
    this.flyCursor.y = c.y;
    this.dragging = true;
  }

  /** What the drag comes to, into the edit's totals. */
  private takeDrag(): void {
    const L = this.live;
    if (!L) return;
    const d = this.drag;
    const h = d.handle;
    if (h === H.x || h === H.y || h === H.z || h === H.up || h === H.ground) {
      L.mx = d.mx;
      L.my = d.my;
      L.mz = d.mz;
      const k = h * 3;
      const dirs = this.layout.dirs;
      L.moved.x = h === H.ground || Math.abs(dirs[k]) > 1e-6;
      L.moved.y = h !== H.ground && Math.abs(dirs[k + 1]) > 1e-6;
      L.moved.z = h === H.ground || Math.abs(dirs[k + 2]) > 1e-6;
      // V held: flush to the nearest neighbour.
      if (this.ed.input.held('editorNeighbour')) this.flushTo(L);
      else L.flush.x = L.flush.y = L.flush.z = 0;
    } else if (h === H.yaw || h === H.pitch || h === H.roll) {
      L.ringAxis = h;
      L.ringAngle = d.angle;
    } else if (h === H.scale) {
      L.probe.sx = L.probe.sy = L.probe.sz = d.scale;
    } else {
      L.axisScale = h === H.sx ? 0 : h === H.sy ? 1 : 2;
      L.axisF = d.scale;
    }
  }

  /** V held during a move: the moving selection's box taken flush to the nearest neighbour's, within `snap.neighbourPx` there. */
  private flushTo(L: LiveEdit): void {
    const v = this.view;
    const depth = (L.pivot.x - v.ex) * v.fx + (L.pivot.y - v.ey) * v.fy + (L.pivot.z - v.ez) * v.fz;
    const within = depth > 0 && v.focal > 0 ? (EDITOR_TUNE.snap.neighbourPx * depth) / v.focal : 0;
    L.flush.x = L.flush.y = L.flush.z = 0;
    if (!(within > 0) || L.lives.length !== 1) return;
    const l = L.lives[0];
    if (!l.box) return;
    this.placeOne(L, l);
    const mb = this.movingBox;
    worldBox(l.box.min, l.box.max, l.now.sx, l.now.sy, l.now.sz, l.now.turn, l.now, mb.lo, mb.hi);
    // The neighbours, gathered once an edit (the first frame V is held): a press, not a frame's work.
    if (!L.near) {
      const yaw = 2 * Math.atan2(l.now.turn.y, l.now.turn.w);
      const near: WorldBox[] = [];
      for (const s of this.ed.standing()) {
        if (s.id === l.id) continue;
        if ((s.x - l.now.x) ** 2 + (s.z - l.now.z) ** 2 > 400 * 400) continue;
        const key = placementKey(s.id);
        const o = this.ed.placed(key);
        const b = o ? this.ed.boxOf(o) : null;
        if (!o || !b || !alikeToQuarter(yaw, 2 * Math.atan2(o.q.y, o.q.w))) continue;
        const nlo: [number, number, number] = [0, 0, 0];
        const nhi: [number, number, number] = [0, 0, 0];
        const sc = o.scale ?? ONE_V;
        worldBox(b.min, b.max, sc.x, sc.y, sc.z, o.q, o, nlo, nhi);
        near.push({ lo: nlo, hi: nhi });
      }
      L.near = near;
    }
    snapFlush(mb, L.near, within, L.flush);
  }
  private readonly movingBox: { lo: [number, number, number]; hi: [number, number, number] } = { lo: [0, 0, 0], hi: [0, 0, 0] };

  /** One live row's place now, from the edit's totals. */
  private placeOne(L: LiveEdit, l: Live): void {
    const pv = L.pivot;
    const probe = L.probe;
    const snap = this.snapOn;
    // The turn: the probe's (the hand's total), its angle about up on the angle grid; or a ring's about its axis.
    let rx = probe.turn.x;
    let ry = probe.turn.y;
    let rz = probe.turn.z;
    let rw = probe.turn.w;
    if (L.ringAxis >= 0) {
      const k = L.ringAxis * 3;
      const dirs = this.layout.dirs;
      let a = L.ringAngle;
      if (snap && L.ringAxis === H.yaw) a = (snapValue((a * 180) / Math.PI, this.angle) * Math.PI) / 180;
      const hs = Math.sin(a / 2);
      rx = dirs[k] * hs;
      ry = dirs[k + 1] * hs;
      rz = dirs[k + 2] * hs;
      rw = Math.cos(a / 2);
    } else if (snap && L.label === 'turn' && Math.abs(rx) < 1e-9 && Math.abs(rz) < 1e-9) {
      const a = (snapValue((2 * Math.atan2(ry, rw) * 180) / Math.PI, this.angle) * Math.PI) / 180;
      ry = Math.sin(a / 2);
      rw = Math.cos(a / 2);
    }
    // The scale: uniform (the probe's, on `snap.scaleStep`), or along one of the first's own axes.
    let f = probe.sx;
    if (snap && f !== 1) f = Math.max(EDITOR_TUNE.snap.scaleStep, snapValue(f, EDITOR_TUNE.snap.scaleStep));
    const b = l.base;
    let ox = (b.x - pv.x) * f;
    let oy = (b.y - pv.y) * f;
    let oz = (b.z - pv.z) * f;
    // Turned about the pivot by the turn (v + 2w(r × v) + 2 r × (r × v)).
    const tx = 2 * (ry * oz - rz * oy);
    const ty = 2 * (rz * ox - rx * oz);
    const tz = 2 * (rx * oy - ry * ox);
    const nx = ox + rw * tx + (ry * tz - rz * ty);
    const ny = oy + rw * ty + (rz * tx - rx * tz);
    const nz = oz + rw * tz + (rx * ty - ry * tx);
    ox = nx;
    oy = ny;
    oz = nz;
    // The rise and the move.
    let lift = probe.y - pv.y;
    if (snap && lift) lift = snapValue(lift, this.grid);
    let mx = L.mx + L.flush.x;
    let my = L.my + L.flush.y + lift;
    let mz = L.mz + L.flush.z;
    if (snap && (L.moved.x || L.moved.y || L.moved.z) && !(L.flush.x || L.flush.y || L.flush.z)) {
      // The pivot put on the grid in the file's own frame, and the whole selection moved with it.
      const from = this.snapIn;
      from.x = pv.x + L.mx;
      from.y = pv.y + L.my;
      from.z = pv.z + L.mz;
      const to = snapPlace(from, L.moved, this.grid, this.ed.centre(), this.ed.frame(), this.snapOut);
      mx = to.x - pv.x;
      my = to.y - pv.y + lift;
      mz = to.z - pv.z;
    }
    const n = l.now;
    n.x = pv.x + ox + mx;
    n.y = pv.y + oy + my;
    n.z = pv.z + oz + mz;
    // Its own turn composed in the world's frame: r * q.
    const q = b.turn;
    n.turn.x = rw * q.x + rx * q.w + ry * q.z - rz * q.y;
    n.turn.y = rw * q.y - rx * q.z + ry * q.w + rz * q.x;
    n.turn.z = rw * q.z + rx * q.y - ry * q.x + rz * q.w;
    n.turn.w = rw * q.w - rx * q.x - ry * q.y - rz * q.z;
    if (l.rooms) {
      n.sx = n.sy = n.sz = 1;
    } else {
      n.sx = b.sx * f;
      n.sy = b.sy * f;
      n.sz = b.sz * f;
      if (L.axisScale >= 0) {
        let fa = L.axisF;
        if (snap) fa = Math.max(EDITOR_TUNE.snap.scaleStep, snapValue(fa, EDITOR_TUNE.snap.scaleStep));
        if (L.axisScale === 0) n.sx *= fa;
        else if (L.axisScale === 1) n.sy *= fa;
        else n.sz *= fa;
      }
      // Held inside the reader's backstops: C drags compound (three shrinks at the snap's least are 0.000125), and a scale
      // past them was cut to nought on the way out and refused by the endpoint as a field it does not write.
      // Written out, not through `scaleHeld`: a number handed back across a call the compiler leaves out is boxed.
      const lo = PLACEMENT_LIMITS.scaleMin;
      const hi = PLACEMENT_LIMITS.scaleMax;
      if (n.sx < lo) n.sx = lo;
      else if (n.sx > hi) n.sx = hi;
      if (n.sy < lo) n.sy = lo;
      else if (n.sy > hi) n.sy = hi;
      if (n.sz < lo) n.sz = lo;
      else if (n.sz > hi) n.sz = hi;
    }
  }

  /** Every live row placed from the totals, its copies' one matrix written. Nothing is made. */
  private placeLive(): void {
    const L = this.live;
    if (!L) return;
    for (let i = 0; i < L.lives.length; i++) {
      const l = L.lives[i];
      this.placeOne(L, l);
      if (!l.copies.length) continue;
      this.p.set(l.now.x, l.now.y, l.now.z);
      this.q.set(l.now.turn.x, l.now.turn.y, l.now.turn.z, l.now.turn.w);
      this.s.set(l.now.sx, l.now.sy, l.now.sz);
      this.m.compose(this.p, this.q, this.s);
      for (let k = 0; k < l.copies.length; k++) {
        l.copies[k].setMatrixAt(0, this.m);
        l.copies[k].instanceMatrix.needsUpdate = true;
      }
    }
  }

  /** An edit under way given up: its copies taken away and its rows' own meshes shown again; nothing is written. */
  cancel(say = true): boolean {
    const L = this.live;
    this.dragging = false;
    this.boxing = false;
    this.hold.which = null;
    if (!L) return false;
    this.live = null;
    for (const l of L.lives) {
      this.ed.dropCopies(l.copies);
      this.ed.setHidden(l.key, false);
    }
    if (say) this.ed.say(`${L.label} given up: nothing was written`, true);
    return true;
  }

  /** The edit under way written: each row put again where it is going, one batch (or consecutive ones), one undo entry. */
  private async commit(): Promise<string> {
    const L = this.live;
    if (!L) return 'nothing under way';
    // Every row placed from the totals as they stand now (a step or a console line commits with no frame between), then
    // the edit is no longer under way.
    this.placeLive();
    this.live = null;
    const ed = this.ed;
    const centre = ed.centre();
    const frame = ed.frame();
    const space = ed.inSpace();
    const changes: RowChange[] = [];
    let byHand = 0;
    let pastNote = 0;
    // A building with rooms moved with the rest keeps every row's room as it was: what stood in its rooms moved with it,
    // and its rooms do not stand at their new place until the write has.
    const rigid = L.lives.some((l) => l.rooms);
    for (const l of L.lives) {
      const n = l.now;
      const moved = Math.abs(n.x - l.base.x) + Math.abs(n.y - l.base.y) + Math.abs(n.z - l.base.z) > 1e-6 || Math.abs(n.turn.x - l.base.turn.x) + Math.abs(n.turn.y - l.base.turn.y) + Math.abs(n.turn.z - l.base.turn.z) + Math.abs(n.turn.w - l.base.turn.w) > 1e-9 || n.sx !== l.base.sx || n.sy !== l.base.sy || n.sz !== l.base.sz;
      if (!moved) continue;
      const sameScale = n.sx === l.base.sx && n.sy === l.base.sy && n.sz === l.base.sz;
      let clear: number | null | undefined;
      if (!sameScale && l.box) {
        const fc = followClear(l.row.clear, this.ruleClear(l.row, l.box, [l.base.sx, l.base.sy, l.base.sz]), this.ruleClear(l.row, l.box, [n.sx, n.sy, n.sz]));
        clear = fc.clear;
        if (fc.byHand) byHand++;
      }
      if (!sameScale && pastScaleNote(n.sx, n.sy, n.sz)) pastNote++;
      const inside = this.insideAt(l.row, n.x, n.y, n.z, rigid);
      const ground = space || inside ? null : ed.terrainAt(n.x, n.z);
      const after = rowMoved(l.row, { x: n.x, y: n.y, z: n.z, q: [n.turn.x, n.turn.y, n.turn.z, n.turn.w] }, [n.sx, n.sy, n.sz], centre, frame, { mm: EDITOR_TUNE.write.mm, turnDigits: EDITOR_TUNE.write.turnDigits, scaleDigits: EDITOR_TUNE.write.scaleDigits, ground, inside, ...(clear !== undefined ? { clear } : {}) });
      changes.push({ file: l.layer, id: l.id, before: l.row, after });
    }
    const keep = L.lives;
    if (!changes.length) {
      for (const l of keep) {
        ed.dropCopies(l.copies);
        ed.setHidden(l.key, false);
      }
      return 'nothing moved';
    }
    const said = await this.write({ label: L.label, changes }, keep);
    const notes: string[] = [];
    if (byHand) notes.push(`${byHand} kept the flora clearing set by hand`);
    if (pastNote) notes.push(`${pastNote} scaled past ${EDITOR_TUNE.scaleNote.low} or ${EDITOR_TUNE.scaleNote.high}`);
    if (notes.length && !this.lastWrite?.said) ed.say(`${said} (${notes.join('; ')})`, true);
    return said;
  }

  /**
   * Whether a row is written as standing in a room at a new place of the game's frame: as it was where a building with
   * rooms moved with it (`rigid`), for a building itself, or in a space zone; else the editor's own rule there
   * (`roomAt`), as a thing put down there would be. Kept as it was, a prop dragged into a building stayed a world-pass
   * thing (drawn from inside only through the doorways) and one dragged out stayed in no room (drawn through every wall).
   */
  private insideAt(row: PlacementRow, x: number, y: number, z: number, rigid: boolean): boolean {
    if (rigid || row.kind === 'building' || this.ed.inSpace()) return !!row.inside;
    return this.ed.roomAt(x, y, z);
  }

  /** The flora a row keeps off by the placing rule at a size: a building's patch, nothing for a prop. */
  private ruleClear(row: PlacementRow, box: { min: number[]; max: number[] }, s: readonly [number, number, number]): number {
    if (row.kind !== 'building') return 0;
    return clearRadius(patchOfBounds({ min: [box.min[0] * s[0], box.min[1] * s[1], box.min[2] * s[2]], max: [box.max[0] * s[0], box.max[1] * s[1], box.max[2] * s[2]] }));
  }

  /**
   * An action written: its edits as consecutive batches of at most `batchMost`, recorded in the history with the rows the
   * endpoint answered. `copies` stand for the rows being moved until what was written is built, then go; refused, the
   * rows' own meshes come back and the words are said. Answers what was said.
   */
  private async write(a: EditAction, copies: readonly Live[] = []): Promise<string> {
    const ed = this.ed;
    const release = () => {
      for (const l of copies) {
        ed.dropCopies(l.copies);
        ed.setHidden(l.key, false);
      }
    };
    if (this.writing) {
      release();
      ed.say('a write is still going', false);
      return 'a write is still going';
    }
    const sent = await this.send(a);
    if (sent.done) this.history.record(a);
    void sent.built.then(release, release);
    if (!sent.done) release();
    this.lastWrite = { label: a.label, edits: sent.edits, batches: sent.done, ms: Math.round(sent.ms), files: sent.files, said: sent.refused };
    this.askStatus();
    ed.refreshWindow();
    if (sent.refused) {
      const words = `${a.label} refused: ${refusalWords(sent.refused)}`;
      ed.say(words, false);
      return words;
    }
    const words = `${a.label}: ${a.changes.length} row${a.changes.length === 1 ? '' : 's'} written`;
    ed.say(words, true);
    return words;
  }

  /**
   * An action's edits written as consecutive batches of at most `batchMost`, and the rows the endpoint answered laid over
   * its `after`s (a refusal part way keeps what went, so it can be undone): nothing recorded and nothing said. What it came
   * to: the batches that went, the endpoint's words where one was refused, its time, the files touched, the edits sent and
   * when what it stood is built.
   */
  private async send(a: EditAction): Promise<{ done: number; refused: string; ms: number; files: string[]; edits: number; built: Promise<void> }> {
    const ed = this.ed;
    const edits = doEdits(a);
    const chunks = chunkEdits(edits, EDITOR_TUNE.batchMost);
    this.writing = true;
    let ms = 0;
    const answered: Partial<Record<EditFileKind, Map<string, EditRow>>> = {};
    const files = new Set<string>();
    let built: Promise<void> = Promise.resolve();
    let refused = '';
    let done = 0;
    try {
      for (const chunk of chunks) {
        const res = await ed.batch(chunk);
        if (!res.ok) {
          refused = res.why;
          break;
        }
        done++;
        ms += res.ms;
        built = built.then(() => res.built);
        // Every kind of file it touched, the rows each put by id (a later batch's over an earlier's).
        for (const kind of noteAnswered(answered, res.files)) files.add(kind);
      }
    } finally {
      this.writing = false;
    }
    // What was written is the action, kept with the rows as answered.
    if (done) takeAnswered([a], 'after', answered);
    return { done, refused, ms, files: [...files], edits: edits.length, built };
  }

  // ---- A brush stroke: each stamp written as it comes, the whole stroke one action. ----

  /** The strokes begun and not yet ended (`beginStroke`), so a world going drops them unrecorded. */
  private readonly strokes = new Set<Stroke>();

  /** A stroke begun (the brush's LMB or RMB pressed): its stamps are written as they come and recorded as one action as it ends. */
  beginStroke(label: string): Stroke {
    this.sameWorld();
    const s: Stroke = { a: { label, changes: [] }, edits: 0, batches: 0, ms: 0, files: new Set(), refused: '', ended: false, world: this.worldNow };
    this.strokes.add(s);
    return s;
  }

  /** Whether a stroke is under way. */
  get stroking(): boolean {
    return this.strokes.size > 0;
  }

  /**
   * One stamp of a stroke written (its new rows, or the rows it takes out), the endpoint's answers kept in the stroke's
   * action; nothing recorded until it ends. Answers the endpoint's words where it refused (the stroke keeps what went
   * before), '' where it took them. Nothing is written while another write is out, or once the stroke has ended or its
   * world gone: the caller asks again, or not at all.
   */
  async strokeWrite(s: Stroke, changes: RowChange[]): Promise<string> {
    if (s.ended || !changes.length) return '';
    if (s.world !== this.worldNow || !this.sameWorld()) return 'the world went';
    if (this.writing) return 'a write is still going';
    const a: EditAction = { label: s.a.label, changes };
    const sent = await this.send(a);
    s.batches += sent.done;
    s.ms += sent.ms;
    for (const f of sent.files) s.files.add(f);
    if (sent.done) {
      for (const c of a.changes) s.a.changes.push(c);
      s.edits += sent.edits;
    }
    if (sent.refused) s.refused = sent.refused;
    return sent.refused;
  }

  /** A stroke ended (its button let go, the brush let go): what it wrote recorded as one action, and said. Ending it again does nothing. */
  endStroke(s: Stroke): string {
    if (s.ended) return '';
    s.ended = true;
    this.strokes.delete(s);
    if (s.world !== this.worldNow) return '';
    if (s.a.changes.length) this.history.record(s.a);
    this.lastWrite = { label: s.a.label, edits: s.edits, batches: s.batches, ms: Math.round(s.ms), files: [...s.files], said: s.refused };
    this.askStatus();
    this.ed.refreshWindow();
    const n = s.a.changes.length;
    const words = s.refused ? `${s.a.label} refused part way (${n} row${n === 1 ? '' : 's'} written before): ${refusalWords(s.refused)}` : `${s.a.label}: ${n} row${n === 1 ? '' : 's'} written`;
    this.ed.say(words, !s.refused);
    return words;
  }

  /**
   * An action the editor wrote by another way (a thing in hand put down through the endpoint's one-row ops), recorded in
   * the history with its rows as the files now hold them, so it is undone like any other.
   */
  recordDone(a: EditAction): void {
    this.sameWorld();
    this.history.record(a);
    this.ed.refreshWindow();
  }

  // ---- Single steps on the selection. ----

  /** A nudge (or the console's move): the selection moved by `dx, dy, dz` metres of the game's frame, written at once. */
  async step(label: string, dx: number, dy: number, dz: number): Promise<string> {
    if (!this.sel.size || this.live || this.writing) return 'nothing picked, or an edit under way';
    const L = this.begin(label, 'step');
    if (!L) return 'nothing picked stands in the files';
    L.mx = dx;
    L.my = dy;
    L.mz = dz;
    L.moved.x = dx !== 0;
    L.moved.y = dy !== 0;
    L.moved.z = dz !== 0;
    return this.commit();
  }

  /** The console's turn (degrees about up), rise (metres) and scale (a factor) of the selection, each written at once. */
  async stepHold(kind: 'turn' | 'lift' | 'scale', amount: number): Promise<string> {
    if (!this.sel.size || this.live || this.writing) return 'nothing picked, or an edit under way';
    const L = this.begin(kind, 'step');
    if (!L) return 'nothing picked stands in the files';
    if (kind === 'turn') {
      const a = (amount * Math.PI) / 180;
      L.probe.turn.y = Math.sin(a / 2);
      L.probe.turn.w = Math.cos(a / 2);
    } else if (kind === 'lift') L.probe.y = L.pivot.y + amount;
    else L.probe.sx = L.probe.sy = L.probe.sz = amount;
    return this.commit();
  }

  /** End: each picked row dropped so its lowest point stands on what is under it; with Shift its up leaned toward the surface's. */
  async ground(lean: boolean): Promise<string> {
    if (!this.sel.size || this.live || this.writing) return 'nothing picked, or an edit under way';
    const L = this.begin('to the ground', 'step');
    if (!L) return 'nothing picked stands in the files';
    const ed = this.ed;
    const hit: SurfaceHit = { y: 0, nx: 0, ny: 1, nz: 0 };
    const ground: SurfaceHit = { y: Number.NaN, nx: 0, ny: 1, nz: 0 };
    const under: SurfaceHit = { y: 0, nx: 0, ny: 1, nz: 0 };
    for (const l of L.lives) {
      const b = l.base;
      let lowest = 0;
      if (l.box) {
        worldBox(l.box.min, l.box.max, b.sx, b.sy, b.sz, b.turn, { x: 0, y: 0, z: 0 }, this.lo, this.hi);
        lowest = this.lo[1];
      }
      const bottom = b.y + lowest;
      const cast = ed.castDown(b.x, bottom - 0.02, b.z, 500, !!l.row.inside, hit) ? hit : null;
      const open = !l.row.inside && !ed.inSpace();
      ground.y = open ? ed.terrainAt(b.x, b.z) : Number.NaN;
      if (open && Number.isFinite(ground.y)) {
        const e = 0.5;
        terrainNormal(ed.terrainAt(b.x - e, b.z), ed.terrainAt(b.x + e, b.z), ed.terrainAt(b.x, b.z - e), ed.terrainAt(b.x, b.z + e), e, ground);
      }
      // Sunk under the ground: up onto it; else the higher of the ground and what stands under it.
      if (!surfaceUnder(bottom, cast, ground, open, under)) continue;
      const y = droppedY(under.y, lowest);
      if (!Number.isFinite(y)) continue;
      // Each row its own: written straight into its live place, the totals left at nought.
      l.base = held(l.base);
      l.base.y = y;
      if (lean) leanTo(l.base.turn, under.nx, under.ny, under.nz, EDITOR_TUNE.snap.normalMaxDeg, l.base.turn);
    }
    // The bases moved: what is written is each base as it now is (the edit's totals stay at nought).
    const before = L.lives.map((l) => l.row);
    const changes: RowChange[] = [];
    const centre = ed.centre();
    const frame = ed.frame();
    const rigid = L.lives.some((l) => l.rooms);
    for (let i = 0; i < L.lives.length; i++) {
      const l = L.lives[i];
      const n = l.base;
      // Dropped onto a floor or out of a room's height, it is in the room it lands in.
      const inside = this.insideAt(l.row, n.x, n.y, n.z, rigid);
      const after = rowMoved(l.row, { x: n.x, y: n.y, z: n.z, q: [n.turn.x, n.turn.y, n.turn.z, n.turn.w] }, [n.sx, n.sy, n.sz], centre, frame, { mm: EDITOR_TUNE.write.mm, turnDigits: EDITOR_TUNE.write.turnDigits, scaleDigits: EDITOR_TUNE.write.scaleDigits, ground: inside || ed.inSpace() ? null : ed.terrainAt(n.x, n.z), inside });
      if (after.y === before[i].y && after.q.every((v, k) => v === before[i].q[k]) && !!after.inside === !!before[i].inside) continue;
      l.now = held(n);
      changes.push({ file: l.layer, id: l.id, before: l.row, after });
    }
    this.live = null;
    this.placeLiveFrom(L);
    if (!changes.length) {
      for (const l of L.lives) {
        ed.dropCopies(l.copies);
        ed.setHidden(l.key, false);
      }
      return 'already on the ground';
    }
    return this.write({ label: lean ? 'to the ground, leaned' : 'to the ground', changes }, L.lives);
  }

  /** The copies of an edit placed at each row's `now`, the edit no longer under way. */
  private placeLiveFrom(L: LiveEdit): void {
    for (const l of L.lives) {
      if (!l.copies.length) continue;
      this.p.set(l.now.x, l.now.y, l.now.z);
      this.q.set(l.now.turn.x, l.now.turn.y, l.now.turn.z, l.now.turn.w);
      this.s.set(l.now.sx, l.now.sy, l.now.sz);
      this.m.compose(this.p, this.q, this.s);
      for (const c of l.copies) {
        c.setMatrixAt(0, this.m);
        c.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /** Home: the eye flown to look at the selection from where it fits the screen (`selectionPivot` asks the keys again first). */
  focus(): string {
    if (!this.selectionPivot(this.pivot)) return 'nothing picked stands';
    let r = 2;
    for (const key of this.selKeys) {
      const o = this.ed.placed(key);
      const b = o ? this.ed.boxOf(o) : null;
      if (!o || !b) continue;
      const sc = o.scale ?? ONE_V;
      worldBox(b.min, b.max, sc.x, sc.y, sc.z, o.q, o, this.lo, this.hi);
      r = Math.max(r, Math.abs(this.hi[0] - this.pivot.x), Math.abs(this.lo[0] - this.pivot.x), this.hi[1] - this.pivot.y, Math.abs(this.hi[2] - this.pivot.z), Math.abs(this.lo[2] - this.pivot.z));
    }
    this.ed.fly.lookDir(this.look);
    const d = r * 2.5 + 2;
    const at = { x: this.pivot.x - this.look.x * d, y: this.pivot.y + r * 0.6 - this.look.y * d, z: this.pivot.z - this.look.z * d };
    this.focusTo = at;
    this.ed.fly.lookAlong(this.pivot.x - at.x, this.pivot.y + r * 0.3 - at.y, this.pivot.z - at.z);
    this.ed.fly.stop();
    return 'looking at what is picked';
  }

  /** Where Home last put the eye (the editor moves the anchor there). */
  focusTo: { x: number; y: number; z: number } | null = null;

  /** RMB held in Fly: the eye turned about the pivot by this frame's mouse (read off the fields, never handed over), looking at it. */
  private orbit(): void {
    const o = this.orbitAsk;
    o.on = true;
    o.dx = this.orbitDX;
    o.dy = this.orbitDY;
    o.px = this.pivot.x;
    o.py = this.pivot.y;
    o.pz = this.pivot.z;
  }

  /** An orbit asked this frame, kept (the editor moves the anchor and the look). */
  readonly orbitAsk = { on: false, dx: 0.5, dy: 0.5, px: 0.5, py: 0.5, pz: 0.5 };

  // ---- Picking. ----

  /** A box drawn on the screen: what stands with its middle inside it picked (Shift adds, Alt takes away). */
  private boxSelect(x0: number, y0: number, x1: number, y1: number): void {
    const input = this.ed.input;
    const mode = boxMode(input.isDown('ShiftLeft') || input.isDown('ShiftRight'), input.isDown('AltLeft') || input.isDown('AltRight'));
    const v = this.view;
    const things = this.ed.standing();
    const lo: [number, number, number] = [0, 0, 0];
    const hi: [number, number, number] = [0, 0, 0];
    const ids = inBox(things, { x0, y0, x1, y1 }, (t, out) => {
      const o = this.ed.placed(placementKey(t.id));
      const b = o ? this.ed.boxOf(o) : null;
      if (o && b) {
        const sc = o.scale ?? ONE_V;
        worldBox(b.min, b.max, sc.x, sc.y, sc.z, o.q, o, lo, hi);
        return projectMiddle(v, (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2, out);
      }
      return projectMiddle(v, t.x, t.y, t.z, out);
    });
    if (this.sel.pick(ids, mode)) this.ed.refreshWindow();
    this.ed.say(`${this.sel.size} picked`, true);
  }

  /** Every row of the same thing as the first picked: within `likeReach` of it, or in the files. */
  selectLike(): string {
    const first = this.sel.first;
    const r = first ? this.ed.rowFor(first) : null;
    if (!r) return 'pick one first';
    const rows = this.ed.standing().map((s) => ({ id: s.id, pack: s.row.pack, thing: s.row.thing, model: s.row.model, from: s.row.from, x: s.x, z: s.z }));
    const at = this.ed.placed(placementKey(first as string));
    const reach = EDITOR_TUNE.likeReach;
    const ids = likeThis(rows, { pack: r.row.pack, thing: r.row.thing, model: r.row.model, from: r.row.from }, reach > 0 && at ? { x: at.x, z: at.z } : null, reach);
    this.sel.pick(ids, 'set');
    this.ed.refreshWindow();
    return `${ids.length} like ${r.label} picked`;
  }

  // ---- Duplicate, copy, paste, delete. ----

  /** New ids for rows of these models, unique across both files and each other. */
  /** Ids minted from each base, unique across both files and each other (a key filed once: DESIGN.md §10 risk 4). */
  mintIds(bases: readonly string[]): string[] {
    const taken = this.ed.idsTaken();
    return bases.map((b) => {
      const id = mintPlacementId(b, taken);
      taken.add(id);
      return id;
    });
  }

  /** Ctrl+D: the selection copied in place (offset `dupOffset`), the copies picked. */
  async duplicate(): Promise<string> {
    if (!this.sel.size || this.live || this.writing) return 'nothing picked, or an edit under way';
    const rows = this.sel.ids.map((id) => this.ed.rowFor(id)).filter((r): r is NonNullable<typeof r> => !!r);
    if (!rows.length) return 'nothing picked stands in the files';
    const ids = this.mintIds(rows.map((r) => r.row.thing ?? r.row.model ?? 'place'));
    const off = EDITOR_TUNE.dupOffset;
    const centre = this.ed.centre();
    const frame = this.ed.frame();
    const space = this.ed.inSpace();
    const rigid = rows.some((r) => this.ed.hasRooms(placementKey(r.row.id)));
    const changes: RowChange[] = rows.map((r, i) => {
      const { at: _at, ...rest } = r.row;
      const after: PlacementRow = { ...rest, id: ids[i] };
      if (off) {
        // Offset, it stands somewhere else: the room and the ground there are its own.
        after.x = Math.round((after.x + off) * 1000) / 1000;
        const g = toGame(after, centre, frame);
        const inside = this.insideAt(after, g.x, g.y, g.z, rigid);
        if (inside) {
          after.inside = true;
          delete after.ground;
        } else {
          delete after.inside;
          const ground = space ? Number.NaN : this.ed.terrainAt(g.x, g.z);
          if (Number.isFinite(ground)) after.ground = Math.round(ground * 1000) / 1000;
          else delete after.ground;
        }
      }
      return { file: r.layer, id: ids[i], before: null, after };
    });
    const said = await this.write({ label: 'duplicate', changes });
    if (this.lastWrite && !this.lastWrite.said) {
      this.sel.pick(ids, 'set');
      this.ed.refreshWindow();
    }
    return said;
  }

  /** Ctrl+C (and Ctrl+X): the selection copied relative to its pivot, into memory and onto the system clipboard as JSON. */
  async copy(cut: boolean): Promise<string> {
    if (!this.sel.size) return 'nothing picked';
    const centre = this.ed.centre();
    const frame = this.ed.frame();
    const placed = this.sel.ids
      .map((id) => this.ed.rowFor(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => {
        const g = toGame(r.row, centre, frame);
        return { row: r.row, x: g.x, y: g.y, z: g.z, q: g.q as [number, number, number, number] };
      });
    if (!placed.length) return 'nothing picked stands in the files';
    const pv = { x: 0, y: 0, z: 0 };
    if (!this.selectionPivot(pv)) {
      pv.x = placed[0].x;
      pv.y = placed[0].y;
      pv.z = placed[0].z;
    }
    this.clip = copyRows(placed, pv, this.ed.packId());
    this.clipFromWorld = this.ed.packId();
    let sys = '';
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) await navigator.clipboard.writeText(clipText(this.clip));
      else sys = ' (kept here: the page may not write the clipboard)';
    } catch {
      sys = ' (kept here: the page may not write the clipboard)';
    }
    const said = `${placed.length} copied${sys}`;
    if (cut) return this.deleteSelected(true, said);
    this.ed.say(said, true);
    return said;
  }

  /** A paste: the document's own paste event's text when it is the editor's, else the memory, stood at the aim's hit (Shift: turned to the camera). */
  async paste(eventText: string | null, shift: boolean): Promise<string> {
    if (this.live || this.writing) return 'an edit is under way';
    const set = pasteSource(eventText, this.clip);
    if (!set) {
      this.ed.say('nothing to paste: copy something first (Ctrl+C)', false);
      return 'nothing to paste';
    }
    const at = this.ed.hit();
    let turn = 0;
    if (shift) turn = this.ed.fly.yaw;
    const placed = pasteAt(set, at, turn);
    const ids = this.mintIds(placed.map((p) => p.row.thing ?? p.row.model ?? 'place'));
    const centre = this.ed.centre();
    const frame = this.ed.frame();
    const dest = this.destOf();
    const here = this.ed.packId();
    // A set holding a building pasted whole keeps each row's room as it was copied (its rooms stand only once written).
    const rigid = set.rows.some((r) => r.kind === 'building');
    const changes: RowChange[] = placed.map((p, i) => {
      // A world model keeps the world it came from (written absent where that is this world).
      const base: PlacementRow = { ...pastedRow(p.row, set.world, here), id: ids[i], x: 0, y: 0, z: 0 } as PlacementRow;
      const inside = this.insideAt(base, p.x, p.y, p.z, rigid);
      const after = rowMoved(base, { x: p.x, y: p.y, z: p.z, q: p.q }, scaleOf(p.row), centre, frame, { mm: EDITOR_TUNE.write.mm, turnDigits: EDITOR_TUNE.write.turnDigits, scaleDigits: EDITOR_TUNE.write.scaleDigits, ground: inside || this.ed.inSpace() ? null : this.ed.terrainAt(p.x, p.z), inside });
      return { file: dest, id: ids[i], before: null, after };
    });
    const said = await this.write({ label: 'paste', changes });
    if (this.lastWrite && !this.lastWrite.said) {
      this.sel.pick(ids, 'set');
      this.ed.refreshWindow();
    }
    return said;
  }

  /** Which file a paste goes into: the editor's destination. */
  destOf: () => PlacementLayer = () => 'world';

  /** Delete: the selection taken out of its files, asking once past `askAbove` (a second press within three seconds). */
  async deleteSelected(force: boolean, prefix = ''): Promise<string> {
    if (!this.sel.size || this.live || this.writing) return 'nothing picked, or an edit under way';
    const rows = this.sel.ids.map((id) => this.ed.rowFor(id)).filter((r): r is NonNullable<typeof r> => !!r);
    if (!rows.length) return 'nothing picked stands in the files';
    const now = Date.now();
    if (!force && rows.length > EDITOR_TUNE.askAbove && !(now < this.askedDelete && this.askedCount === rows.length)) {
      this.askedDelete = now + 3000;
      this.askedCount = rows.length;
      const words = `delete ${rows.length} rows? press Delete again to take them out of their files`;
      this.ed.say(words, false);
      return words;
    }
    this.askedDelete = 0;
    for (const r of rows) this.ed.setHidden(placementKey(r.row.id), true);
    const changes: RowChange[] = rows.map((r) => ({ file: r.layer, id: r.row.id, before: r.row, after: null }));
    const said = await this.write({ label: 'delete', changes });
    if (this.lastWrite?.said) for (const r of rows) this.ed.setHidden(placementKey(r.row.id), false);
    else this.sel.clear();
    const words = prefix ? `${prefix}; ${said}` : said;
    this.ed.say(words, !this.lastWrite?.said);
    return words;
  }

  // ---- Undo and redo. ----

  /** Ctrl+Z: back `n` actions. */
  undo(n: number): Promise<string> {
    return this.historyTo(this.history.at - Math.max(1, Math.floor(n)));
  }

  /** Ctrl+Shift+Z: forward `n` actions. */
  redo(n: number): Promise<string> {
    return this.historyTo(this.history.at + Math.max(1, Math.floor(n)));
  }

  /** The history moved to `n` actions done (History's click goes back or forward to any point), written as batches. */
  async historyTo(n: number): Promise<string> {
    if (!this.sameWorld()) return 'a new world: nothing to undo here yet';
    if (this.live || this.writing) return 'an edit is under way';
    // A brush's stroke under way (a button held): its tiles or rows are the stroke's until it is written, and an undo landed
    // over them would be written over again by the stroke's own write.
    if (this.stroking) return 'a stroke is under way';
    const to = Math.max(0, Math.min(this.history.actions.length, n));
    if (to === this.history.at) {
      const words = to === 0 ? 'nothing to undo' : 'nothing to redo';
      this.ed.say(words, false);
      return words;
    }
    const plan = this.history.editsTo(to);
    const chunks = chunkEdits(plan.edits, EDITOR_TUNE.batchMost);
    this.writing = true;
    const answered: Partial<Record<EditFileKind, Map<string, EditRow>>> = {};
    let refused = '';
    let ms = 0;
    try {
      for (const chunk of chunks) {
        const res = await this.ed.batch(chunk);
        if (!res.ok) {
          refused = res.why;
          break;
        }
        ms += res.ms;
        noteAnswered(answered, res.files);
      }
    } finally {
      this.writing = false;
    }
    const back = to < this.history.at;
    this.lastWrite = { label: back ? 'undo' : 'redo', edits: plan.edits.length, batches: chunks.length, ms: Math.round(ms), files: Object.keys(answered), said: refused };
    this.askStatus();
    this.ed.refreshWindow();
    if (refused) {
      const words = `${back ? 'undo' : 'redo'} refused: ${refusalWords(refused)}`;
      this.ed.say(words, false);
      return words;
    }
    this.history.landAt(to, plan, answered);
    this.sel.keepOnly((id) => !!this.ed.rowFor(id));
    const what = (back ? plan.undo : plan.redo).map((a) => a.label).join(', ');
    const words = `${back ? 'undone' : 'done again'}: ${what}`;
    this.ed.say(words, true);
    return words;
  }

  // ---- The hotbar and the eyedropper. ----

  /** 1 to 9: the hotbar slot's thing taken in hand. */
  private async useHotbar(slot: number): Promise<void> {
    const key = this.ed.hotbar()[slot - 1];
    const e = key ? this.ed.entryByKey(key) : null;
    if (!e) {
      this.ed.say(`hotbar ${slot} is empty: Shift+${slot} sets it to what is in hand or picked`, false);
      return;
    }
    const why = await this.ed.take(e);
    if (why) this.ed.say(why, false);
  }

  /** Shift with 1 to 9: the slot set to what is in hand, else to what is picked first. */
  private setHotbar(slot: number): void {
    let key = this.ed.handKey();
    if (!key && this.sel.first) {
      const r = this.ed.rowFor(this.sel.first);
      const e = r ? this.ed.entryOfRow(r.row) : null;
      key = e ? entryKeyOf(e) : null;
    }
    this.ed.setHotbar(slot, key);
    this.ed.say(key ? `hotbar ${slot}: ${key}` : `hotbar ${slot} emptied`, true);
  }

  /** The middle button: another of what the aim rests on taken in hand ("give me another of that"). */
  async eyedropper(): Promise<string> {
    const id = this.ed.hoveredId();
    const r = id ? this.ed.rowFor(id) : null;
    const e = r ? this.ed.entryOfRow(r.row) : null;
    if (!e) {
      this.ed.say('the eyedropper takes another of a row of the files: aim at one', false);
      return 'nothing of the files under the aim';
    }
    const why = await this.ed.take(e);
    if (why) this.ed.say(why, false);
    return why ?? `in hand: another ${r?.label ?? ''}`;
  }

  // ---- The inspector. ----

  /**
   * A row's own fields set on **every** picked row alike (the Selected tab, the console's `set`): its name, note, state,
   * solidity, flora clearing and guard, one action however many rows.
   */
  async setField(fields: Partial<Record<'name' | 'note' | 'state' | 'solid' | 'clear' | 'guard', unknown>>): Promise<string> {
    this.sameWorld();
    if (!this.sel.size || this.live || this.writing) return 'pick one first';
    const changes: RowChange[] = [];
    for (const id of this.sel.ids) {
      const r = this.ed.rowFor(id);
      if (!r) continue;
      const { at: _at, ...rest } = r.row;
      const after: PlacementRow = { ...rest } as PlacementRow;
      for (const [k, v] of Object.entries(fields)) {
        if (k === 'name' || k === 'note' || k === 'state') {
          if (v === '' || v === null) delete after[k];
          else if (typeof v === 'string') after[k] = v;
        } else if (k === 'solid') {
          if (v === null) delete after.solid;
          else if (typeof v === 'boolean') after.solid = v;
        } else if (k === 'clear' || k === 'guard') {
          if (v === null || v === '') delete after[k];
          else if (typeof v === 'number' && v >= 0) after[k] = v;
        }
      }
      changes.push({ file: r.layer, id: r.row.id, before: r.row, after });
    }
    if (!changes.length) return 'nothing picked stands in the files';
    return this.write({ label: `set ${Object.keys(fields).join(', ')}`, changes });
  }

  /**
   * The **first** picked row's place, turn and scale set outright (the Selected tab's fields, which show the first): written
   * as an action. A place in the file's frame; a scale held inside the reader's backstops and said past the note's, its
   * flora clearing kept in step unless set by hand (`followClear`), and none at all on a building with rooms, which stands
   * at its own size this pass.
   */
  async setPlace(p: { x?: number; y?: number; z?: number; yaw?: number; pitch?: number; roll?: number; scale?: number | [number, number, number] }): Promise<string> {
    this.sameWorld();
    const first = this.sel.first;
    const r = first ? this.ed.rowFor(first) : null;
    if (!r || this.live || this.writing) return 'pick one first';
    const { at: _at, ...rest } = r.row;
    const after: PlacementRow = { ...rest } as PlacementRow;
    if (typeof p.x === 'number') after.x = p.x;
    if (typeof p.y === 'number') after.y = p.y;
    if (typeof p.z === 'number') after.z = p.z;
    if (typeof p.yaw === 'number' || typeof p.pitch === 'number' || typeof p.roll === 'number') {
      const e = new THREE.Euler(((p.pitch ?? 0) * Math.PI) / 180, ((p.yaw ?? 0) * Math.PI) / 180, ((p.roll ?? 0) * Math.PI) / 180, 'YXZ');
      const q = new THREE.Quaternion().setFromEuler(e);
      // The file's own frame: on a planet the turn is mirrored as the reader mirrors it back.
      after.q = this.ed.frame() === 'raw' ? [q.w, q.x, -q.y, -q.z] : [q.w, q.x, q.y, q.z];
    }
    const notes: string[] = [];
    if (p.scale !== undefined) {
      const key = placementKey(r.row.id);
      let s: [number, number, number];
      if (typeof p.scale === 'number' && p.scale > 0) s = [p.scale, p.scale, p.scale];
      else if (Array.isArray(p.scale) && p.scale.length === 3 && p.scale.every((v) => typeof v === 'number' && v > 0)) s = [p.scale[0], p.scale[1], p.scale[2]];
      else return 'a scale is a number above nought, or three';
      if (this.ed.hasRooms(key)) return `${r.label} is a building with rooms: it stands at its own size this pass`;
      const held: [number, number, number] = [scaleHeld(s[0]), scaleHeld(s[1]), scaleHeld(s[2])];
      if (held.some((v, i) => v !== s[i])) notes.push(`held to the reader's ${PLACEMENT_LIMITS.scaleMin} to ${PLACEMENT_LIMITS.scaleMax}`);
      if (pastScaleNote(held[0], held[1], held[2])) notes.push(`past ${EDITOR_TUNE.scaleNote.low} or ${EDITOR_TUNE.scaleNote.high}`);
      const written = held[0] === held[1] && held[1] === held[2] ? (held[0] === 1 ? undefined : held[0]) : held;
      if (written === undefined) delete after.scale;
      else after.scale = written;
      // The flora it keeps off follows its size as a hold's scale does, unless it was set by hand.
      const o = this.ed.placed(key);
      const box = o ? this.ed.boxOf(o) : null;
      if (box) {
        const fc = followClear(r.row.clear, this.ruleClear(r.row, box, scaleOf(r.row)), this.ruleClear(r.row, box, held));
        if (fc.clear === null) delete after.clear;
        else after.clear = Math.min(PLACEMENT_LIMITS.circle, fc.clear);
        if (fc.byHand) notes.push('kept the flora clearing set by hand');
      }
    }
    const said = await this.write({ label: 'set the place', changes: [{ file: r.layer, id: r.row.id, before: r.row, after }] });
    if (notes.length && !this.lastWrite?.said) {
      const words = `${said} (scale ${notes.join('; ')})`;
      this.ed.say(words, true);
      return words;
    }
    return said;
  }

  // ---- What git says. ----

  /** Git asked again a moment after a write (debounced), never in a frame. */
  askStatus(): void {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      void this.refreshStatus();
    }, Math.max(0, EDITOR_TUNE.statusDebounceMs));
  }

  /** Git's word on this world's files, now. */
  async refreshStatus(): Promise<string> {
    const s = await this.ed.status();
    if (typeof s === 'string') return s;
    this.fileStates = s.files;
    this.branch = s.branch;
    this.ed.refreshWindow();
    return `on ${s.branch ?? 'no branch'}: ${s.files.map((f) => `${f.path.replace(/^public\//, '')} ${f.state}`).join(', ')}`;
  }

  // ---- The console's view. ----

  report(): Record<string, unknown> {
    return {
      selected: [...this.sel.ids],
      snap: { on: this.snapOn, grid: this.grid, angle: this.angle },
      axes: this.localAxes ? 'local' : 'world',
      view: this.gameView ? 'game' : 'editor',
      keySheet: this.keySheet,
      under: this.live ? { label: this.live.label, via: this.live.via, rows: this.live.lives.length } : null,
      history: { at: this.history.at, actions: this.history.actions.map((a) => `${a.label} (${a.changes.length})`) },
      clipboard: this.clip ? { rows: this.clip.rows.length, from: this.clipFromWorld } : null,
      lastWrite: this.lastWrite,
      files: this.fileStates.map((f) => ({ path: f.path, state: f.state })),
      branch: this.branch,
    };
  }
}

/** A scale held inside the reader's backstops (`PLACEMENT_LIMITS.scaleMin` to `scaleMax`); a scale that is no number is 1. */
export function scaleHeld(s: number): number {
  if (!(s > 0)) return s === s ? PLACEMENT_LIMITS.scaleMin : 1;
  return s < PLACEMENT_LIMITS.scaleMin ? PLACEMENT_LIMITS.scaleMin : s > PLACEMENT_LIMITS.scaleMax ? PLACEMENT_LIMITS.scaleMax : s;
}

/** Whether any of a row's three scales stands past `EDITOR_TUNE.scaleNote`'s low or high: a note on the bar, never a refusal. */
function pastScaleNote(sx: number, sy: number, sz: number): boolean {
  const n = EDITOR_TUNE.scaleNote;
  return sx < n.low || sy < n.low || sz < n.low || sx > n.high || sy > n.high || sz > n.high;
}

/** A library entry's key (`libraryModel.entryKey`), here without importing the library's whole module. */
function entryKeyOf(e: LibraryEntry): string {
  return e.s === 'world' || e.s === 'flora' ? `${e.s}:${e.p}:${e.id}` : `${e.s}:${e.id}`;
}

/** A point of the world projected into `out`; false behind the eye. */
function projectMiddle(v: ScreenView, x: number, y: number, z: number, out: Float64Array): boolean {
  const m = v.vp;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (!(cw > 1e-6)) return false;
  out[0] = (cx / cw * 0.5 + 0.5) * v.w;
  out[1] = (0.5 - cy / cw * 0.5) * v.h;
  return true;
}

/** The library entry a row writes, for the editor's port (`entryOfRow`): the library's own rule. */
export { entryForRow };
