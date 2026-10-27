// The world editor, put together (DESIGN.md §2.2-§2.5, §4): the one module the game reaches, through one dynamic
// `import()` behind `import.meta.env.DEV`, so a build carries none of it. It builds the free camera, the pointer layer,
// the session, the window with its library, the bar, the marks and the ghost over the ports the game hands it
// (`EditorHost`), and answers the game through `EditorApi`, which `main.ts` declares for itself so nothing shipped
// imports this folder.
//
// **The order a frame runs in** (each a hand-over `main.ts` makes, pinned by `editorWiring.test.ts`): `keys` in the key
// block, where the presses are read and recorded and everything the editor borrows is muted; the body's update, where the
// flight moves the anchor; `placeCamera` in place of the orbit; and `afterCamera`, from the camera just placed, where the
// aim, the hover, the ghost and the clicks are resolved -- cast from last frame's camera, the ghost would trail the
// crosshair by a frame's flight.
//
// **What still refuses** is said in words and kept apart (`devVerdict.editorRefusal`); every rule a player meets is
// worked out as a note and the click places all the same. A thing is put down where the aim meets the world: a prop
// with its box's lowest point on the hit, a building with its origin (its doorstep) on it, turned to face the camera as
// it was taken in hand (the turn and raise keys are the next wave's). Every write is the endpoint's one-row put, landed
// as every permanent row is.

import * as THREE from 'three';
import type { Input } from '../core/input.ts';
import type { Physics } from '../core/physics.ts';
import type { ThirdPersonCamera } from '../core/camera.ts';
import type { Player } from '../player/player.ts';
import type { World } from '../world/world.ts';
import type { PropCatalogue } from '../world/propCatalogue.ts';
import type { AssetPack } from '../world/assetPack.ts';
import type { PlacedObject, RoomAnswer } from '../world/layoutStream.ts';
import { ACTOR_LAYER } from '../world/portalRender.ts';
import { EditorGhost, type GhostDeps } from '../world/placeGhost.ts';
import { patchOfBounds, clearRadius, type Patch } from '../world/housePlace.ts';
import { destinationFile, rowFromEditor, type EditorSource } from '../world/permanentEdit.ts';
import { PLACEMENT_KEY_PREFIX, placementKey, scaleOf as scaleOfRow, toGame as placementToGame, type PlacementLayer, type PlacementRow } from '../story/placements.ts';
import { gameToRawX, gameToRawZ, rawToGameX, rawToGameZ } from '../story/waypoints.ts';
import type { DialSet } from '../ui/dials.ts';
import type { HudCanvas } from '../ui/hudCanvas.ts';
import { EditorBar, editorBarView } from '../ui/editorBar.ts';
import { EditorWindow, type HereRow, type SelectedView } from '../ui/editorWindow.ts';
import { drawEditorMarks, marksView, projectBox, projectPoint } from '../ui/editorMarks.ts';
import { EditorAim } from './aim.ts';
import { floorUnder, roomWords } from './cameraRoom.ts';
import { PASSABLE_NOTE, buildingNotes, editorRefusal, limitNotes, notesLine, propNotes, refusalWords, type BuildingNotes, type EditWorld } from './devVerdict.ts';
import { editorDialsFor } from './editorDials.ts';
import { ALL_ACTIONS, ctrlRule, editorMutes } from './editorKeys.ts';
import { EditorSession, returnRefusal, type EntryState, type LeaveWay, type ReturnPoint } from './editorSession.ts';
import { BRUSH_TUNE, EDITOR_TUNE, LIBRARY_TUNE, TUNE_WATCH, liveTuned, tuneEditor } from './editorTune.ts';
import { FlyCam, stepSpeed } from './flyCam.ts';
import { LIBRARY_SOURCES, LibraryKeep, ENTRY_FLAG, entryKey, entryName, fallbackEntries, libraryView, readLibraryIndex, searchLibrary, usedHereKeys, type LibraryEntry, type LibrarySource, type LibraryView } from './libraryModel.ts';
import { attachPointer, endPointerFrame, pointerRecord } from './pointer.ts';
import { EditorEdits, type EditorBatch, type EditorFileState } from './editorEdit.ts';
import type { RowChange } from './undo.ts';
import { entryForRow } from './libraryModel.ts';
import type { BatchEdit } from '../world/placementEdits.ts';
import { EditorBrush, brushNearOf, type BrushNearThing } from './editorBrush.ts';
import { brushRing, meantForWater, ringAsk, type RingGround } from './brush.ts';

/** What the game hands the editor: its objects, and its own half of every rule the editor cannot reach itself. */
export interface EditorHost {
  input: Input;
  player: Player;
  cam: ThirdPersonCamera;
  world: World;
  physics: Physics;
  props: PropCatalogue;
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
  /** What would refuse entering, read now. */
  entryState(): EntryState;
  /** The game's side of entering: the story told every area was left, any fight broken off, a thing in the old hand given up. */
  enterWorld(): void;
  /** Stand the body back at a return point the way the session chose (`leaveWay`) and give it its collider and figure. */
  leaveBody(ret: ReturnPoint, way: LeaveWay): void;
  floorUnder(x: number, y: number, z: number): boolean;
  /** Whether the body keeps its height at a place, nothing under it to stand on or fall to (a space zone, the drawn water). */
  keepsHeight(x: number, y: number, z: number): boolean;
  /** The rows of this world's two files as they stand on disk (`Used here`): what each writes. */
  fileRows(): readonly { pack: string; thing?: string; model?: string; template?: string; from?: string }[];
  /** How many rows a layer's file of this world holds now. */
  fileCount(layer: PlacementLayer): number;
  /** Words on the message line. */
  say(words: string): void;
  /** The world's file key (`packIdOf`). */
  packId(): string;
  /** What kind of world: a ground world, a space zone or the dungeons' copies. */
  worldKind(): 'ground' | 'space' | 'copies';
  /** A row written into a file and stood as every permanent row is; `lifted` names a row picked up and moved. */
  put(row: object, dest: PlacementLayer, lifted: { id: string; layer: PlacementLayer } | null): Promise<{ ok: boolean; why: string; id: string; built: Promise<void> }>;
  /** A row taken out of its file. */
  remove(layer: PlacementLayer, id: string): Promise<string>;
  /** A permanent row taken down into the hand, as it stood; null when nothing stands under the id. */
  lift(id: string): { row: PlacementRow; layer: PlacementLayer; label: string } | null;
  /** A row picked up given back as its file has it. */
  restore(id: string): void;
  /** A permanent row standing, by id: its place in the game's frame, its file and its words. */
  stood(id: string): { x: number; y: number; z: number; layer: PlacementLayer; label: string } | null;
  /** The rows round a place, nearest first. */
  here(at: { x: number; y: number; z: number }, most: number): HereRow[];
  /** A story row's guard over a circle, its words, or null. */
  guarded(x: number, z: number, r: number): string | null;
  /** Whether a props thing's template is a seat or a table (stands passable unless its row says solid). */
  passable(template: string | null): boolean;
  /**
   * One batch of the world editor's (the endpoint's `batch` op), written and landed by difference (`landChanges`): each
   * file it touched with its revision, the rows put as stamped and the ids taken out, the endpoint's time, and what to wait
   * on for what it stood to be built.
   */
  batch(edits: BatchEdit[]): Promise<EditorBatch>;
  /** Git's word on this world's placement files and its track file (the endpoint's `status` op), or why not. */
  status(): Promise<{ branch: string | null; main: string | null; files: EditorFileState[] } | string>;
  /** A row of this world's two files by id, the layer it is in and what it is called; null for none. */
  rowFor(id: string): { row: PlacementRow; layer: PlacementLayer; label: string } | null;
  /** Every row of this world's files standing now, with its place in the game's frame. */
  standingRows(): { id: string; row: PlacementRow; layer: PlacementLayer; x: number; y: number; z: number }[];
  /** Every id this world's two files hold. */
  idsTaken(): Set<string>;
  /** What a standing row's stand set aside of it, in words (a scale on a building with rooms), or null. */
  stoodNote(id: string): string | null;
  /**
   * Fold now (DESIGN.md §2.8): every tier filed again behind a short loading screen, so the permanent rows drawn one by one
   * fold into their tiers. Answers what it came to.
   */
  fold(): Promise<string>;
  /** Whether the game is travelling or has no world (nothing folds by itself then). */
  busy(): boolean;
}

/** One thing in hand: what a row writes, what it is drawn and judged by, and how it is turned. */
interface Hand {
  key: string;
  name: string;
  src: EditorSource;
  bounds: { min: number[]; max: number[] } | null;
  patch: Patch | null;
  building: boolean;
  passable: boolean;
  q: THREE.Quaternion;
  yaw: number;
  /**
   * The size it stands at: a row picked up keeps its own `scale` (the row written back carries it), so its ghost, the
   * lowest point it is stood by and the notes are all at that size; 1 for a fresh entry and for a building with rooms, which
   * stands at its own size this pass. `sBounds` is the box at that size (componentwise, the scale being above nought).
   */
  scale: THREE.Vector3;
  sBounds: { min: number[]; max: number[] } | null;
  /** A row picked up and being moved: written back under its own id. */
  base: PlacementRow | null;
  liftedLayer: PlacementLayer | null;
}

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

/** The editor, as the game sees it. */
export class Editor {
  readonly host: EditorHost;
  readonly fly = new FlyCam();
  readonly session: EditorSession;
  readonly pointer = pointerRecord();
  readonly keep: LibraryKeep;
  private window: EditorWindow | null = null;
  private bar: EditorBar | null = null;
  private readonly barView = editorBarView();
  private readonly marks = marksView();
  private readonly ghost: EditorGhost;
  private readonly aim: EditorAim<PlacedObject>;
  private detach: (() => void) | null = null;
  private hand: Hand | null = null;
  private takeGen = 0;
  private notes: string[] = [];
  private readonly buildingSaid: BuildingNotes = { notes: [], y: Number.NaN, blocker: null, refuses: false };
  private warn = false;
  private notesAt = -Infinity;
  private barAt = -Infinity;
  private writing = false;
  private said = '';
  private saidOk = true;
  private lastWrite = '';
  /** How long the last write took, milliseconds, the endpoint's answer timed (NaN before the first): the file's size note says it. */
  private writeMs = Number.NaN;
  private pendingClick = false;
  private aimKind = 'sky';
  private libView: LibraryView | null = null;
  private libState: 'none' | 'loading' | 'index' | 'fallback' = 'none';
  private libMade = '';
  private libLoading: Promise<void> | null = null;
  // Kept for the frame: nothing in a frame is made.
  private readonly eye = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly ghostM = new THREE.Matrix4();
  private readonly ghostPos = new THREE.Vector3();
  private readonly vp = new THREE.Matrix4();
  private readonly vpInv = new THREE.Matrix4();
  private readonly pt = new Float64Array(2);
  private readonly hitRoom: RoomAnswer = { building: null, cell: 0, byBox: false };
  private readonly askAim = { inside: false, space: false, skyReach: EDITOR_TUNE.aim.skyReach, now: 0 };
  private readonly propAt = { x: 0, y: 0, z: 0 };
  private readonly propTurn = { x: 0, y: 0, z: 0, w: 1 };
  private readonly ghostDeps: GhostDeps;
  private readonly propDeps: { floorAt(x: number, y: number, z: number): number | null; solidAt(x: number, y: number, z: number): boolean; reserved: (x: number, z: number, r: number) => string | null };
  private skyReach = EDITOR_TUNE.aim.skyReach;
  private readonly hoverM = new THREE.Matrix4();
  private readonly hoverEls = new Float64Array(16);

  constructor(host: EditorHost) {
    this.host = host;
    const p = host.player;
    this.session = new EditorSession({
      state: () => host.entryState(),
      body: (out) => {
        out.x = p.pos.x;
        out.y = p.pos.y;
        out.z = p.pos.z;
        out.heading = p.heading;
        out.cell = host.world.cellState?.cell ?? 0;
        out.noclip = p.noclip;
        out.hp = p.hp;
      },
      enter: () => this.enterBody(),
      leave: (ret, way) => this.leaveBody(ret, way),
      floorUnder: (x, y, z) => host.floorUnder(x, y, z),
      keepsHeight: (x, y, z) => host.keepsHeight(x, y, z),
      lock: () => host.input.requestLock(),
      release: () => host.input.releaseLock(),
    });
    let store: Storage | null = null;
    try {
      store = window.localStorage;
    } catch {
      store = null;
    }
    this.keep = new LibraryKeep(store);
    this.ghost = new EditorGhost({
      add: (o) => host.world.scene.add(o),
      remove: (o) => host.world.scene.remove(o),
      prepare: (meshes) => host.world.prepareLikeStreamed(meshes),
      actorLayer: ACTOR_LAYER,
    });
    const w = host.world;
    this.aim = new EditorAim<PlacedObject>(
      {
        // The engine's cast and the world's ground answer their numbers as they always have (their cost, paid already by
        // the camera's own block ray); the editor's own frame hands them on in kept records.
        cast: (r, inside, out) => host.physics.aimHit(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, r.len, inside, out),
        sample: (p) => {
          p.ground = w.terrain.nearHeightIfCached(p.x, p.z) ?? Number.NaN;
          p.water = w.terrain.waterHeightAt(p.x, p.z);
        },
        walk: (rect, visit) => w.streamer?.forEachPlacedIn(rect, visit),
      },
      (o) => w.streamer?.boxOf(o) ?? null,
      (o) => o.template.startsWith(PLACEMENT_KEY_PREFIX),
    );
    this.ghostDeps = {
      heightAt: (x, z) => w.terrain.heightAt(x, z),
      waterAt: (x, z) => w.terrain.waterHeightAt(x, z),
      standing: (x, z, reach) => w.standingNear(x, z, reach),
    };
    this.propDeps = {
      floorAt: (x, y, z) => w.groundAt(x, y + 0.5, z, w.inside),
      solidAt: (x, y, z) => w.solidAt(x, y, z),
      reserved: (x, z, r) => host.guarded(x, z, r),
    };
    // The editing (the second wave's): everything it reads and asks, over the editor and the game.
    const me = this;
    const cast = { toi: 0.5, nx: 0.5, ny: 0.5, nz: 0.5, handle: -1 };
    const roomAsk = new THREE.Vector3();
    const roomAnswer: RoomAnswer = { building: null, cell: 0, byBox: false };
    this.edits = new EditorEdits({
      input: host.input,
      fly: this.fly,
      pointer: this.pointer,
      get point() {
        return me.point;
      },
      inHand: () => !!me.hand,
      hoveredId: () => me.hoveredId(),
      placed: (key) => w.streamer?.placedOf(key) ?? null,
      boxOf: (o) => w.streamer?.boxOf(o) ?? null,
      hasRooms: (key) => w.streamer?.placedHasRooms(key) ?? false,
      copies: (key) => w.streamer?.editorCopies(key) ?? [],
      // Taken away whether or not a streamer stands now: a write's copies are let go once what it stood is built, which can
      // be after a travel has unloaded the world (and its streamer) whose packs they draw.
      dropCopies: (c) => dropCopiesAnyway(w.streamer, c),
      setHidden: (key, hidden) => w.streamer?.setEditorHidden(key, hidden),
      rowFor: (id) => host.rowFor(id),
      standing: () => host.standingRows(),
      idsTaken: () => host.idsTaken(),
      frame: () => (w.planet?.space ? 'game' : 'raw'),
      centre: () => w.placeFrame,
      terrainAt: (x, z) => (w.planet?.space ? Number.NaN : w.terrain.heightAt(x, z)),
      castDown: (x, y, z, reach, inside, out) => {
        if (!host.physics.aimHit(x, y, z, 0, -1, 0, reach, inside, cast)) return false;
        out.y = y - cast.toi;
        out.nx = cast.nx;
        out.ny = cast.ny;
        out.nz = cast.nz;
        return true;
      },
      // The room a row's new place stands in, by the very rule a thing put down there is written by (`place`).
      roomAt: (x, y, z) => {
        const s = w.streamer;
        if (!s) return false;
        roomAsk.set(x, y, z);
        s.cameraRoomAt(roomAsk, roomAnswer, floorUnder);
        return !!roomAnswer.building;
      },
      inSpace: () => !!w.planet?.space,
      packId: () => host.packId(),
      worldMark: () => w.generation,
      hit: () => me.aim.hit,
      batch: (edits) => host.batch(edits),
      status: () => host.status(),
      say: (words, ok) => me.say(words, ok),
      take: (e) => me.take(e),
      entryOfRow: (row) => (me.libView ? entryForRow(me.libView, row, host.packId()) : null),
      entryByKey: (key) => me.libView?.byKey.get(key) ?? null,
      handKey: () => me.hand?.key ?? null,
      hotbar: () => me.keep.hotbar,
      setHotbar: (slot, key) => me.keep.setHotbar(slot, key),
      refreshWindow: () => me.window?.refreshEdits(),
      brushArmed: () => me.brush.armed,
    });
    this.edits.destOf = () => this.session.dest;
    // The scatter brush (the third wave's): its entries out of the library, what stands near its disc, the ground under it.
    this.brush = new EditorBrush({
      edits: this.edits,
      source: async (key) => {
        await me.loadLibrary();
        const e = me.libView?.byKey.get(key);
        if (!e) return `no library entry ${key}`;
        const got = await me.sourceOf(e);
        if (typeof got === 'string') return got;
        // Another world's pack known to the streamer before a row of it stands, as the hand hands it over.
        if (got.src.pack === 'world' && got.src.from) w.streamer?.useFromPack(got.pack);
        // A building stands as the hand stands one: its doorstep on the ground at its own size, its patch's plants kept off.
        const clear = got.building && got.bounds ? clearRadius(patchOfBounds(got.bounds)) : undefined;
        return { key, id: got.src.thing ?? got.src.model ?? 'place', src: got.src, bounds: got.bounds, water: meantForWater(e.m || e.id), building: got.building, clear };
      },
      near: (cx, cz, reach, keys) => me.brushNear(cx, cz, reach, keys),
      ground: (x, z) => (w.planet?.space ? Number.NaN : (w.terrain.nearHeightIfCached(x, z) ?? w.terrain.heightAt(x, z))),
      water: (x, z) => w.terrain.waterHeightAt(x, z),
      centre: () => w.placeFrame,
      frame: () => (w.planet?.space ? 'game' : 'raw'),
      packId: () => host.packId(),
      inSpace: () => !!w.planet?.space,
      dest: () => this.session.dest,
      cameraYaw: () => this.fly.yaw,
      say: (words, ok) => me.say(words, ok),
    });
    // The ring's ground: the near ground already made, never a block made for it in a frame.
    const ringAt = { x: 0.5, z: 0.5, y: 0.5 };
    this.ringGround = {
      at: ringAt,
      sample: () => {
        ringAt.y = w.terrain.nearHeightIfCached(ringAt.x, ringAt.z) ?? Number.NaN;
      },
    };
    // A console line or a slider that moves the flight's speed or the sky's reach moves what is flown now.
    TUNE_WATCH.moved = (partial) => this.tuned(partial);
  }

  /** The editing: the selection, the hand on it, the gizmo, the snaps, copy and paste, undo and redo. */
  readonly edits: EditorEdits;
  /** The scatter brush. */
  readonly brush: EditorBrush;
  /** The brush ring's ground and its ask, kept records. */
  private readonly ringGround: RingGround;
  private readonly ringAsk = ringAsk();
  /** The brush's buttons this frame, read in the key block (Fly's) or off the pointer (Point's). */
  private brushPaint = false;
  private brushErase = false;
  /** Ctrl held this frame (the key block's word): Point's brush buttons read as up too. */
  private ctrlHeld = false;
  /** When something last happened (a key, a button, an edit, a stroke, a flight), seconds: what the automatic fold waits out. */
  private activeAt = 0;
  /** A Fold now under way. */
  private folding = false;

  /**
   * What stands near the brush's disc (`EditorBrush`'s port): this world's rows standing within `reach`, each with its id,
   * file, row, box and whether it is one of the brush's own entries; and the placed objects whose boxes reach the disc,
   * which only space it and keep it off them. A stamp's work, never a frame's.
   */
  private brushNear(cx: number, cz: number, reach: number, keys: ReadonlySet<string>): BrushNearThing[] {
    const h = this.host;
    const s = h.world.streamer;
    // The rules are `brushNearOf`'s, which a node test runs; this hands it the world.
    return brushNearOf<PlacedObject>(
      {
        view: this.libView,
        here: h.packId(),
        rows: h.standingRows(),
        placedOfRow: (id) => s?.placedOf(placementKey(id)) ?? null,
        forEachPlacedIn: (rect, visit) => s?.forEachPlacedIn(rect, visit),
        boxOf: (o) => (s ? s.boxOf(o) : null),
      },
      cx,
      cz,
      reach,
      keys,
    );
  }

  /**
   * A tune moved (`tuneEditor`): the numbers the editor keeps live beside it taken again where it named them -- the
   * flight's speed, the sky's reach, and the snapping's switch, grid and angle (which `[`, `]` and `\` step for the session).
   */
  private tuned(partial: unknown): void {
    const live = liveTuned(partial);
    if (live.speed) this.fly.speed = clampSpeed(EDITOR_TUNE.cam.speed);
    if (live.skyReach) this.skyReach = clampSky(EDITOR_TUNE.aim.skyReach);
    if (live.snap) {
      const s = EDITOR_TUNE.snap;
      this.edits.snapOn = s.on;
      if (s.grid > 0) this.edits.grid = s.grid;
      if (s.angle > 0) this.edits.angle = s.angle;
    }
  }

  // ---- What the game reads. ----

  get on(): boolean {
    return this.session.on;
  }

  get point(): boolean {
    return this.session.on && this.session.point;
  }

  /** The body's place while the editor flies: what stands for the character (the server, the followers). */
  get returnPlace(): { x: number; y: number; z: number } | null {
    return this.session.on ? this.session.ret : null;
  }

  get returnHeading(): number {
    return this.session.ret.heading;
  }

  /** The living stand and are put away by nobody while the eye flies past `livingAbove`, or while the world is held. */
  get holdsLiving(): boolean {
    return this.session.on && (this.session.hold || this.fly.moving > EDITOR_TUNE.livingAbove);
  }

  /** Pause: the living are not stepped at all. */
  get livingStill(): boolean {
    return this.session.on && this.session.hold;
  }

  /** Whether closing the tab asks first (`EDITOR_TUNE.guardUnload`, the hatch at load). */
  get guards(): boolean {
    if (!this.session.on || !EDITOR_TUNE.guardUnload) return false;
    try {
      return window.localStorage.getItem('swg.editor.guard') !== '0';
    } catch {
      return true;
    }
  }

  // ---- On and off. ----

  /** F2: on, refused in words, or off. */
  toggle(): void {
    if (this.session.on) {
      this.session.leave();
      return;
    }
    const why = this.session.enter();
    if (why) this.host.say(`World editor: ${why}`);
  }

  private enterBody(): void {
    const h = this.host;
    h.enterWorld();
    // The anchor goes to where the camera is and the eye takes the camera's look, so the picture does not jump.
    const cam = h.cam.camera;
    cam.updateMatrixWorld();
    this.eye.setFromMatrixPosition(cam.matrixWorld);
    cam.getWorldDirection(this.dir);
    this.fly.lookAlong(this.dir.x, this.dir.y, this.dir.z);
    this.fly.lookOf = h.cam;
    this.fly.stop();
    // The speed and the sky's reach start every session at the tune (the wheel's steps are that session's).
    this.fly.speed = clampSpeed(EDITOR_TUNE.cam.speed);
    this.skyReach = clampSky(EDITOR_TUNE.aim.skyReach);
    h.player.setEditorFlight(this.fly);
    h.player.pos.copy(this.eye);
    h.world.cameraRoomRule = floorUnder;
    // The window too, for a button let go over the editor's own window or off the canvas (`notePointerLost`).
    if (!this.detach) this.detach = attachPointer(h.canvas, this.pointer, EDITOR_TUNE.pick, window);
    this.hookPage();
    if (!this.window) this.window = new EditorWindow(h.ui, this.windowHost());
    if (!this.bar) this.bar = new EditorBar(h.ui);
    this.window.show(false);
    void this.loadLibrary();
    // Git's word on this world's files, as the window opens (and after every write, debounced).
    void this.edits.refreshStatus();
    this.say('the world editor: F2 to leave, Tab for a cursor', true);
  }

  private pageHooked = false;

  /**
   * The page's own events the editing reads, listened for from the editor's first entry: the document's `paste` (Ctrl+V
   * is the browser's own paste, which needs no permission, and the editor never cancels its key), the bookmark Ctrl+D
   * would make in Point mode (under the lock `cancelsKey` already keeps it, D being a move key), the canvas's context menu
   * (the right button orbits) and the middle button's autoscroll (it is the eyedropper). A text field keeps all of it.
   */
  private hookPage(): void {
    if (this.pageHooked) return;
    this.pageHooked = true;
    const typingIn = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    document.addEventListener('paste', (e) => {
      if (!this.session.on || typingIn(e.target)) return;
      const text = e.clipboardData?.getData('text/plain') ?? null;
      const input = this.host.input;
      void this.edits.paste(text, input.isDown('ShiftLeft') || input.isDown('ShiftRight'));
    });
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.session.on && e.ctrlKey && e.code === 'KeyD' && !typingIn(e.target)) e.preventDefault();
      },
      true,
    );
    this.host.canvas.addEventListener('contextmenu', (e) => {
      if (this.session.on) e.preventDefault();
    });
    this.host.canvas.addEventListener('mousedown', (e) => {
      if (this.session.on && e.button === 1) e.preventDefault();
    });
  }

  private leaveBody(ret: ReturnPoint, way: LeaveWay): void {
    this.giveUpHand();
    this.brush.disarm();
    this.marks.ringOn = false;
    this.edits.cancel(false);
    this.host.world.cameraRoomRule = null;
    this.window?.hide();
    this.bar?.hide();
    this.fly.stop();
    // Every action it borrowed is muted until its keys are up, so a held E does not mount a speeder the next frame.
    this.host.input.muteUntilUp(ALL_ACTIONS);
    this.host.leaveBody(ret, way);
  }

  /** The world went with the editor on (a travel, the select screen): off with it, the body stood by whatever moved it. */
  worldGone(): void {
    // The brush is let go first (a stroke under way ends unrecorded with its world's history, below).
    this.brush.disarm();
    this.marks.ringOn = false;
    // Its selection, its history and anything under way go with the world, on or off.
    this.edits.worldGone();
    if (!this.session.on) return;
    this.hand = null;
    this.takeGen++;
    this.ghost.clear();
    this.window?.hide();
    this.bar?.hide();
    this.fly.stop();
    this.session.worldGone();
    this.host.player.setEditorFlight(null);
  }

  // ---- The key block. ----

  /**
   * The editor's keys, read in the frame's key block before anything else reads a key: the presses recorded and the
   * flight's ask written, then everything the editor borrows muted for the rest of the frame (`editorMutes`). While Ctrl
   * is held every action is muted and nothing else is read (`ctrlRule`; the chords are the next wave's). `oldHand` says
   * the Props or Housing tab's own hand holds something, which keeps the click, O, Delete and L.
   */
  keys(dt: number, oldHand: boolean): void {
    if (!this.session.on) return;
    const input = this.host.input;
    const a = this.fly.ask;
    const ctrl = input.isDown('ControlLeft') || input.isDown('ControlRight');
    if (ctrl) {
      a.fwd = 0;
      a.side = 0;
      a.up = 0;
      // A hold or a drag made before Ctrl pauses (`idle`: no mouse, no button edge) and keeps the camera still.
      this.edits.idle();
      a.look = !this.session.point && input.locked && !this.edits.takesMouse;
      // A brush stroke ends: its buttons read as up while Ctrl is held (Point's too, `ctrlHeld`).
      this.brushPaint = false;
      this.brushErase = false;
      this.ctrlHeld = true;
      // The editor's own chords (Ctrl+D, C, X, Z, Shift+Z), read as raw keys; every action muted for the frame.
      if (!oldHand && !(this.window?.library.typing ?? false)) this.edits.chords();
      input.mute(ctrlRule(ctrl));
      return;
    }
    this.ctrlHeld = false;
    if (input.pressedAction('editorPoint')) this.setPoint(!this.session.point);
    if (input.pressedAction('editorHold')) {
      this.session.hold = !this.session.hold;
      this.say(this.session.hold ? 'the world held: the living stand still' : 'the world goes on', true);
    }
    if (input.pressedAction('editorSearch')) {
      this.setPoint(true);
      this.window?.setTab('library');
      this.window?.library.focusFind();
    }
    if (input.pressedAction('editorBody')) this.setReturnHere();
    if (!oldHand) {
      if (input.pressedAction('placeLayer')) {
        const d = this.session.toggleDest();
        this.say(`a click writes into ${destinationFile(d, this.host.packId())}`, true);
      }
      if (input.pressedAction('takeProp')) this.pickUpHovered();
      if (input.pressedAction('putAway')) {
        if (this.hand) this.giveUpHand();
        else if (!this.edits.deleteKey()) this.deleteHovered();
      }
      // A click in Fly is the attack's button, read here and muted below; in Point the pointer layer has it.
      if (!this.session.point && input.pressedAction('attack') && this.hand) this.pendingClick = true;
      // B: the brush armed with the library's chosen entries (or what is in hand), or let go.
      if (input.pressedAction('editorBrush')) void this.toggleBrush();
      // The editing keys (the hand on the selection, the gizmo's buttons, the nudges, the snaps, the hotbar, the eyedropper,
      // game view and the key sheet), read before the mutes take what they borrow; the frame's seconds in its kept clock.
      this.edits.clock.dt = dt;
      this.edits.keys(this.window?.library.typing ?? false);
    }
    // The speed: = and -, and the wheel in Fly (in Point the game drains it and the editor reads its own over the canvas).
    let notches = 0;
    if (input.pressedAction('noclipFaster')) notches++;
    if (input.pressedAction('noclipSlower')) notches--;
    const wheel = this.session.point ? this.pointer.wheel : input.wheel;
    if (this.session.point) input.wheel = 0;
    if (wheel) {
      // With a hand key held on the selection the wheel steps its grid (the angle, the grid, the scale step).
      if (this.edits.takesMouse) this.edits.wheelStep(-wheel);
      else if (this.hand && this.aimKind === 'sky') {
        const t = EDITOR_TUNE.aim;
        this.skyReach = Math.min(t.skyFar, Math.max(t.skyNear, this.skyReach * (1 - wheel * t.skyStep)));
      } else notches -= wheel;
      if (!this.session.point) input.wheel = 0;
    }
    if (notches) this.fly.speed = stepSpeed(this.fly.speed, notches);
    const typing = this.window?.library.typing ?? false;
    a.fwd = typing ? 0 : (input.held('forward') ? 1 : 0) - (input.held('back') ? 1 : 0);
    a.side = typing ? 0 : (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    a.up = typing ? 0 : (input.held('editorUp') ? 1 : 0) - (input.held('editorDown') ? 1 : 0);
    a.fast = input.held('walk');
    // Alt is read before the mutes take it (the freeLook action is the editor's slow flight).
    a.slow = input.held('freeLook');
    // A hold, a drag of the gizmo or an orbit has the mouse: the camera holds still.
    a.look = !this.session.point && input.locked && !this.edits.takesMouse;
    // The brush's buttons in Fly, read before the mutes take them: the attack's paints, the other attack's erases.
    this.brushPaint = this.brush.armed && !oldHand && !this.session.point && input.held('attack');
    this.brushErase = this.brush.armed && !oldHand && !this.session.point && input.held('altAttack');
    input.mute(editorMutes(oldHand));
    if (!oldHand) input.mute(TAKEN);
  }

  /**
   * B: the brush armed with the library's chosen entries (or, with none chosen, the thing in hand), or let go. Armed, the
   * hand is given up, an edit under way given up and nothing is picked: its buttons are its own. Answers what was said.
   */
  async toggleBrush(): Promise<string> {
    if (this.brush.armed) {
      this.brush.disarm();
      this.say('the brush let go', true);
      return 'the brush let go';
    }
    const said = await this.brush.arm(this.hand?.key ?? null);
    if (this.brush.armed) {
      this.giveUpHand();
      this.edits.cancel(false);
      this.edits.sel.clear();
      this.window?.refreshEdits();
      this.window?.library.render();
    }
    return said;
  }

  /**
   * Fold now (DESIGN.md §2.8): anything under way given up, then the game's short loading screen (`EditorHost.fold`). The
   * automatic fold calls the same. Answers what it came to.
   */
  async foldNow(): Promise<string> {
    if (this.folding) return 'a fold is under way';
    this.folding = true;
    try {
      this.edits.cancel(false);
      const said = await this.host.fold();
      this.autoFoldAt = this.host.world.streamer?.unfoldedCount ?? 0;
      this.say(said, /^folded/.test(said));
      return said;
    } finally {
      this.folding = false;
      this.activeAt = performance.now() / 1000;
    }
  }

  /** How many rows were left drawn one by one by the last fold: the automatic fold tries again only once that has moved. */
  private autoFoldAt = -1;
  /** The eye's look last frame, to tell a look round from a still frame. Fractions from the start. */
  private lastYaw = 0.5;
  private lastPitch = 0.5;

  /**
   * Whether anything happened this frame -- a key or a button down, the eye moving or looking round, an edit, a write, a
   * stroke, a thing in hand, a fold -- and, with `EDITOR_TUNE.autoFold` on (it starts off), a fold once `autoFoldIdle`
   * seconds have passed with none while more than `foldHint` rows stand drawn one by one, and again only once that count
   * has moved since the last fold (a fold leaves the rows of tiers not yet loaded as they were). Nothing is made.
   */
  private noteActivity(now: number): void {
    const ed = this.edits;
    const looked = this.fly.yaw !== this.lastYaw || this.fly.pitch !== this.lastPitch;
    this.lastYaw = this.fly.yaw;
    this.lastPitch = this.fly.pitch;
    if (looked || this.host.input.keysDown > 0 || this.pointer.buttons !== 0 || this.fly.moving > 0.05 || ed.busy || ed.writing || ed.stroking || this.hand || this.brush.mode || this.folding) {
      this.activeAt = now;
      return;
    }
    if (!EDITOR_TUNE.autoFold || now - this.activeAt < EDITOR_TUNE.autoFoldIdle || this.host.busy()) return;
    const n = this.host.world.streamer?.unfoldedCount ?? 0;
    if (n <= EDITOR_TUNE.foldHint || n === this.autoFoldAt) return;
    void this.foldNow();
  }

  /** Tab, or the lock lost: Point frees the cursor, Fly takes the mouse again. */
  setPoint(point: boolean): void {
    this.session.setPoint(point);
    this.window?.setPoint(this.session.point);
  }

  /**
   * The pointer lock went without the editor asking: in Fly it drops to Point and the menu stays shut. Answers whether
   * the editor took it (the `pointerlockchange` clause's `lost` needs the editor out of it).
   */
  takesLockLoss(): boolean {
    if (!this.session.on) return false;
    const took = this.session.lockLost(performance.now());
    this.window?.setPoint(this.session.point);
    return took;
  }

  /**
   * Escape with the editor on: a thing in hand given up, else Fly dropped to Point (the browser has the lock anyway), else
   * the menu (answered false). The Escape that dropped the lock a moment ago is the same press.
   */
  escape(): boolean {
    if (!this.session.on) return false;
    if (this.hand) {
      this.giveUpHand();
      return true;
    }
    if (this.brush.armed) {
      this.brush.disarm();
      this.say('the brush let go', true);
      return true;
    }
    // A hold or a drag under way: given up, the rows put back where their files have them, nothing written.
    if (this.edits.cancel()) return true;
    if (this.edits.sel.size) {
      this.edits.sel.clear();
      this.window?.refreshEdits();
      if (!this.session.point) this.setPoint(true);
      return true;
    }
    if (!this.session.point) {
      this.setPoint(true);
      return true;
    }
    return performance.now() - this.session.droppedAt < 300;
  }

  /**
   * The canvas clicked in Point mode (a user gesture, so the lock may be asked here): a plain click (a press and a release
   * that never moved past `pick.dragPx`, which the pointer layer has just said in the same task) on empty ground with
   * nothing picked goes back to Fly; with something picked the frame's own click lets go of it; on a row, a handle or with
   * something in hand the frame has it. Decided from the click alone (`clickGoesToFly`), never from whether a frame has
   * seen the press yet.
   */
  canvasClick(): void {
    if (!this.session.on || !this.session.point) return;
    // With the brush armed a click paints: it never takes the mouse back to Fly.
    if (this.hand || this.brush.armed || !this.pointer.clicked) return;
    if (this.aim.hover || this.edits.handleHot || !this.edits.clickGoesToFly()) return;
    this.pointer.clicked = false;
    this.setPoint(false);
  }

  // ---- The camera and the frame's step. ----

  /** The camera placed at the anchor with the eye's look, written into the orbit's own yaw and pitch so both agree. */
  placeCamera(): void {
    const c = this.host.cam;
    const cam = c.camera;
    c.yaw = this.fly.yaw;
    c.pitch = this.fly.pitch;
    c.aim = false;
    c.orbitDistance = 0;
    cam.position.copy(this.host.player.pos);
    cam.up.set(0, 1, 0);
    this.fly.lookDir(this.tmp);
    this.tmp.add(cam.position);
    cam.lookAt(this.tmp);
    const fov = c.baseFov;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /** After the camera: the aim, the hover, the ghost, the notes, the clicks and the bar. */
  afterCamera(dt: number): void {
    if (!this.session.on) return;
    const h = this.host;
    const cam = h.cam.camera;
    const w = window.innerWidth;
    const hh = window.innerHeight;
    this.eye.setFromMatrixPosition(cam.matrixWorld);
    if (this.session.point && this.pointer.over) {
      this.dir.set((this.pointer.x / w) * 2 - 1, -((this.pointer.y / hh) * 2 - 1), 0.5).unproject(cam).sub(this.eye).normalize();
    } else cam.getWorldDirection(this.dir);
    const now = performance.now() / 1000;
    const space = !!h.world.planet?.space;
    const ask = this.askAim;
    ask.inside = h.world.inside;
    ask.space = space;
    ask.skyReach = this.skyReach;
    ask.now = now;
    const ray = this.aim.ray;
    ray.ox = this.eye.x;
    ray.oy = this.eye.y;
    ray.oz = this.eye.z;
    ray.dx = this.dir.x;
    ray.dy = this.dir.y;
    ray.dz = this.dir.z;
    const kind = this.aim.step(ask, EDITOR_TUNE.aim, EDITOR_TUNE.hover);
    this.aimKind = kind;
    const hit = this.aim.hit;
    const hand = this.hand;
    // The brush: Fly's buttons were read in the key block; Point's are the pointer's over the canvas (left 1, right 4).
    const brush = this.brush;
    if (brush.armed) {
      const ba = brush.ask;
      const pb = this.session.point && this.pointer.over && !hand && !this.ctrlHeld ? this.pointer.buttons : 0;
      ba.paint = this.session.point ? (pb & 1) !== 0 : this.brushPaint;
      ba.erase = this.session.point ? (pb & 4) !== 0 : this.brushErase;
      ba.cx = hit.x;
      ba.cz = hit.z;
      ba.valid = kind !== 'sky';
      ba.dt = dt;
      brush.frame();
    }
    // What happened this frame, for the automatic fold's quiet (`EDITOR_TUNE.autoFoldIdle`).
    this.noteActivity(now);
    // The ghost where it would stand.
    let inRoom = false;
    if (hand) {
      const stream = h.world.streamer;
      if (stream) {
        this.tmp.set(hit.x, hit.y, hit.z);
        stream.cameraRoomAt(this.tmp, this.hitRoom, floorUnder);
        inRoom = !!this.hitRoom.building;
      }
      this.ghostPos.set(hit.x, hit.y, hit.z);
      if (!hand.building && hand.sBounds) this.ghostPos.y -= lowestOf(hand.sBounds, hand.q, this.tmp);
      this.ghostM.compose(this.ghostPos, hand.q, hand.scale);
      this.ghost.place(this.ghostM, inRoom);
      // The notes at the bar's own rate: they ask the world for what stands near, which makes lists.
      if (now - this.notesAt > 0.25) {
        this.notesAt = now;
        this.workNotes(hand);
      }
    }
    // A click: Fly's attack button, or Point's click over the canvas.
    const click = this.pendingClick || (this.session.point && this.pointer.clicked);
    this.pendingClick = false;
    if (click && hand) void this.place();
    // The marks.
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const vp = this.vp.elements;
    const m = this.marks;
    m.fly = !this.session.point;
    m.w = w;
    m.h = hh;
    m.aimOn = kind !== 'sky' && projectPoint(hit.x, hit.y, hit.z, vp, w, hh, this.pt);
    m.aimX = this.pt[0];
    m.aimY = this.pt[1];
    m.ghostWarn = this.warn;
    m.ghostOn = !!hand?.bounds && projectBox(hand.bounds.min, hand.bounds.max, this.ghostM.elements, vp, w, hh, m.ghost);
    const hov = !hand ? this.aim.hover : null;
    const hb = hov ? h.world.streamer?.boxOf(hov) : null;
    if (hov && hb) {
      // At the size it stands (a row the editor scaled).
      this.hoverM.compose(this.tmp.set(hov.x, hov.y, hov.z), hov.q, hov.scale ?? ONE);
      const e = this.hoverM.elements;
      for (let i = 0; i < 16; i++) this.hoverEls[i] = e[i];
      m.hoverOn = projectBox(hb.min, hb.max, this.hoverEls, vp, w, hh, m.hover);
    } else m.hoverOn = false;
    // The editing, from this frame's camera: the view the gizmo is laid out in, then its frame (before the pointer's
    // presses are spent).
    const sv = this.edits.view;
    for (let i = 0; i < 16; i++) sv.vp[i] = vp[i];
    this.vpInv.copy(this.vp).invert();
    const vi = this.vpInv.elements;
    for (let i = 0; i < 16; i++) sv.inv[i] = vi[i];
    sv.w = w;
    sv.h = hh;
    sv.ex = this.eye.x;
    sv.ey = this.eye.y;
    sv.ez = this.eye.z;
    cam.getWorldDirection(this.tmp);
    sv.fx = this.tmp.x;
    sv.fy = this.tmp.y;
    sv.fz = this.tmp.z;
    sv.focal = hh / (2 * Math.tan((cam.fov * Math.PI) / 360));
    // The brush's ring on the ground round the aim, armed and over something (game view hides it with the rest).
    if (brush.armed && kind !== 'sky') {
      const ra = this.ringAsk;
      ra.cx = hit.x;
      ra.cy = hit.y;
      ra.cz = hit.z;
      ra.radius = BRUSH_TUNE.radius;
      ra.w = w;
      ra.h = hh;
      brushRing(ra, this.ringGround, vp, m.ring, m.ringVis);
      m.ringOn = true;
      m.ringErase = brush.mode === 'erase';
    } else m.ringOn = false;
    this.edits.clock.now = now;
    this.edits.frame(m);
    this.moveEyeForEdits();
    endPointerFrame(this.pointer);
    // The bar, ten times a second: its words are strings.
    if (now - this.barAt > 0.1) {
      this.barAt = now;
      this.writeBar();
    }
  }

  /**
   * Home and the orbit move the eye: Home to where the editing put it (looking at the selection), the orbit (RMB held in
   * Fly) about the pivot by the mouse, still looking at it. Nothing is made but on a Home press.
   */
  private moveEyeForEdits(): void {
    const ed = this.edits;
    const p = this.host.player.pos;
    if (ed.focusTo) {
      p.set(ed.focusTo.x, ed.focusTo.y, ed.focusTo.z);
      ed.focusTo = null;
      this.fly.stop();
    }
    const o = ed.orbitAsk;
    if (!o.on) return;
    o.on = false;
    const k = 0.0025 * this.host.cam.sensitivity * EDITOR_TUNE.cam.look;
    // The eye's place about the pivot, turned about up by the mouse's across and tipped by its along, held short of the poles.
    let ox = p.x - o.px;
    let oy = p.y - o.py;
    let oz = p.z - o.pz;
    const r = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
    const yaw = Math.atan2(ox, oz) - o.dx * k;
    const lim = Math.PI / 2 - EDITOR_TUNE.cam.pitchMargin;
    let pitch = Math.asin(Math.max(-1, Math.min(1, oy / r))) + o.dy * k;
    pitch = Math.max(-lim, Math.min(lim, pitch));
    ox = Math.sin(yaw) * Math.cos(pitch) * r;
    oy = Math.sin(pitch) * r;
    oz = Math.cos(yaw) * Math.cos(pitch) * r;
    p.set(o.px + ox, o.py + oy, o.pz + oz);
    this.fly.lookAlong(-ox, -oy, -oz);
    this.fly.stop();
  }

  /** The marks, on the overlay, after the game's own. */
  drawMarks(o: HudCanvas): void {
    if (!this.session.on) return;
    drawEditorMarks(o, this.marks);
  }

  // ---- The hand. ----

  /** A library entry taken in hand: its pack in, its model loaded, its ghost built and prepared. Answers why not. */
  async take(e: LibraryEntry, base: { row: PlacementRow; layer: PlacementLayer } | null = null): Promise<string | null> {
    const gen = ++this.takeGen;
    const h = this.host;
    const stream = h.world.streamer;
    if (!stream) return this.refuse('this world stands nothing: it has no streamer');
    const got = await this.sourceOf(e);
    if (gen !== this.takeGen || !this.session.on) return null;
    if (typeof got === 'string') return this.refuse(got);
    // Another world's pack is handed to the streamer before anything of it is asked (the ghost asks whether the model is
    // flora), as the row standing it would hand it over: its trees are trees from the first question on.
    if (got.src.pack === 'world' && got.src.from) stream.useFromPack(got.pack);
    let model;
    try {
      model = await stream.modelFor(got.model, got.pack);
    } catch (err) {
      return this.refuse(`${entryName(e)} would not load: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (gen !== this.takeGen || !this.session.on || h.world.streamer !== stream) return null;
    const q = new THREE.Quaternion();
    let yaw = this.fly.yaw;
    if (base) {
      const g = placementToGame(base.row, h.world.placeFrame, h.world.planet?.space ? 'game' : 'raw');
      q.set(g.q[0], g.q[1], g.q[2], g.q[3]);
      yaw = 2 * Math.atan2(q.y, q.w);
    } else q.setFromAxisAngle(UP, yaw);
    // What was in hand before goes back first (a row picked up stands again), and the brush is let go: its buttons are the hand's now.
    this.giveUpHand();
    if (this.brush.armed) this.brush.disarm();
    this.takeGen = gen;
    const bounds = got.bounds;
    const sc = base && !got.building ? scaleOfRow(base.row) : ([1, 1, 1] as [number, number, number]);
    this.hand = {
      key: entryKey(e),
      name: entryName(e),
      src: got.src,
      bounds,
      patch: got.building && bounds ? patchOfBounds(bounds) : null,
      building: got.building,
      passable: got.passable,
      q,
      yaw,
      scale: new THREE.Vector3(sc[0], sc[1], sc[2]),
      sBounds: bounds ? { min: [bounds.min[0] * sc[0], bounds.min[1] * sc[1], bounds.min[2] * sc[2]], max: [bounds.max[0] * sc[0], bounds.max[1] * sc[1], bounds.max[2] * sc[2]] } : null,
      base: base?.row ?? null,
      liftedLayer: base?.layer ?? null,
    };
    if (base) this.session.dest = base.layer;
    this.ghost.set(this.hand.key, stream.ghostMeshesOf(model));
    this.notesAt = -Infinity;
    this.say(`in hand: ${this.hand.name}`, true);
    return null;
  }

  /** What an entry writes and where its model is read out of, or why not. */
  private async sourceOf(e: LibraryEntry): Promise<{ src: EditorSource; pack: AssetPack; model: string; bounds: { min: number[]; max: number[] } | null; building: boolean; passable: boolean } | string> {
    const h = this.host;
    if (e.s === 'props') {
      await h.props.load();
      const def = h.props.find(e.id);
      const pack = h.props.pack;
      if (!def || !pack) return `${e.id} is not in the props catalogue`;
      return { src: { kind: 'prop', pack: 'props', thing: def.id, template: def.template }, pack, model: def.model, bounds: pack.find(def.model)?.bounds ?? null, building: false, passable: h.passable(def.template) };
    }
    if (e.s === 'buildings') {
      const pack = await h.world.housesPack();
      const def = pack?.find(e.m);
      if (!pack || !def) return `${e.m} is not in the gallery pack`;
      return { src: { kind: 'building', pack: 'gallery', model: e.m, template: e.t }, pack, model: e.m, bounds: def.bounds, building: true, passable: false };
    }
    const here = h.packId();
    const pack = e.p === here ? h.world.ownPack : await h.world.guestWorld(e.p);
    if (!pack) return `${e.p}'s pack is not converted here`;
    const def = pack.find(e.m) ?? pack.floraDefOf(e.m);
    if (!def) return `${e.m} is not in ${e.p}'s pack`;
    const building = e.s === 'world' && (def.cells?.length ?? 0) > 1;
    return { src: { kind: building ? 'building' : 'prop', pack: 'world', model: e.m, template: e.t, from: e.p === here ? null : e.p }, pack, model: e.m, bounds: def.bounds, building, passable: false };
  }

  /** Nothing in hand: a row picked up stands again as its file has it. */
  giveUpHand(): void {
    const hand = this.hand;
    this.takeGen++;
    this.hand = null;
    this.ghost.clear();
    this.notes.length = 0;
    this.warn = false;
    if (hand?.base) this.host.restore(hand.base.id);
  }

  /** The notes a player's rules would have said here, and whether a player would be refused (the ghost's box in `warn`). */
  private workNotes(hand: Hand): void {
    const h = this.host;
    const hit = this.aim.hit;
    const out = this.notes;
    out.length = 0;
    const kind = this.editWorld();
    const refusal = editorRefusal(kind, hand.building);
    if (refusal) {
      out.push(refusal);
      this.warn = true;
      return;
    }
    if (hand.building && hand.patch && !h.world.planet?.space) {
      const ground = h.world.terrain.heightAt(hit.x, hit.z);
      const lift = Number.isFinite(ground) ? hit.y - ground : 0;
      const b = buildingNotes(hand.patch, hit, hand.yaw, this.ghostDeps, lift, false, this.buildingSaid);
      for (const n of b.notes) out.push(n);
      if (b.blocker) out.push(`(${b.blocker})`);
      this.warn = b.refuses;
    } else if (!hand.building) {
      this.propAt.x = this.ghostPos.x;
      this.propAt.y = this.ghostPos.y;
      this.propAt.z = this.ghostPos.z;
      this.propTurn.x = hand.q.x;
      this.propTurn.y = hand.q.y;
      this.propTurn.z = hand.q.z;
      this.propTurn.w = hand.q.w;
      const said = propNotes(hand.sBounds, this.propAt, this.propTurn, this.propDeps, hand.passable, []);
      for (const n of said) out.push(n);
      this.warn = said.some((n) => n !== PASSABLE_NOTE);
    } else this.warn = false;
    // The files' soft lines: the destination's size, and a flora circle or a guard past the old cap. Notes, never refusals.
    const dest = this.session.dest;
    const clear = hand.base?.clear ?? (hand.patch ? clearRadius(hand.patch) : 0);
    limitNotes(destinationFile(dest, h.packId()), h.fileCount(dest), EDITOR_TUNE.rowsNote, this.writeMs, clear, hand.base?.guard ?? 0, EDITOR_TUNE.circleNote, out);
  }

  /** What kind of world a row would go into. */
  private editWorld(): EditWorld {
    if (!this.host.world.streamer || !this.host.world.placeFrame) return 'none';
    return this.host.worldKind();
  }

  /** A click with something in hand: the row written where the ghost stands, and stood. */
  async place(at?: { x: number; y: number; z: number; yaw?: number }): Promise<string> {
    const hand = this.hand;
    const h = this.host;
    if (!hand) return this.refuse('nothing in hand: take something from the library first');
    if (this.writing) return 'a write is still going';
    const kind = this.editWorld();
    const refusal = editorRefusal(kind, hand.building);
    if (refusal) return this.refuse(refusal);
    const frame = h.world.placeFrame;
    if (at) {
      if (typeof at.yaw === 'number') {
        hand.yaw = at.yaw;
        hand.q.setFromAxisAngle(UP, at.yaw);
      }
      this.ghostPos.set(at.x, at.y, at.z);
      if (!hand.building && hand.sBounds) this.ghostPos.y -= lowestOf(hand.sBounds, hand.q, this.tmp);
      this.ghostM.compose(this.ghostPos, hand.q, hand.scale);
      this.ghost.place(this.ghostM, false);
    }
    const pos = this.ghostPos;
    const space = !!h.world.planet?.space;
    const stream = h.world.streamer;
    let inside = false;
    if (stream) {
      this.tmp.copy(pos);
      stream.cameraRoomAt(this.tmp, this.hitRoom, floorUnder);
      inside = !!this.hitRoom.building;
    }
    const clear = hand.patch ? clearRadius(hand.patch) : undefined;
    const ground = space || inside ? null : h.world.terrain.heightAt(pos.x, pos.z);
    const row = rowFromEditor(hand.src, pos, [hand.q.x, hand.q.y, hand.q.z, hand.q.w], inside, frame, space ? 'game' : 'raw', {
      here: h.packId(),
      clear,
      ground,
      base: hand.base,
      mm: EDITOR_TUNE.write.mm,
      turnDigits: EDITOR_TUNE.write.turnDigits,
    });
    const dest = this.session.dest;
    const lifted = hand.base && hand.liftedLayer ? { id: hand.base.id, layer: hand.liftedLayer } : null;
    const left = this.ghost.leaveBehind();
    this.writing = true;
    let reply;
    const asked = performance.now();
    try {
      reply = await h.put(row, dest, lifted);
    } finally {
      this.writing = false;
    }
    this.writeMs = performance.now() - asked;
    void reply.built.then(
      () => this.ghost.dropLeft(left),
      () => this.ghost.dropLeft(left),
    );
    // An older endpoint's refusal says to restart the dev server (it runs the code it first loaded until it does).
    if (!reply.ok) return this.refuse(refusalWords(reply.why));
    this.lastWrite = `${destinationFile(dest, h.packId())}: ${reply.id}`;
    this.edits.lastWrite = null;
    this.edits.askStatus();
    // A thing put down is an action of the history like any other: undone, the row it made goes (or the row it moved
    // goes back where it stood, in the file it was in).
    const after = h.rowFor(reply.id);
    if (after) {
      const base = hand.base;
      const from = hand.liftedLayer;
      const changes: RowChange[] = base && from && from !== after.layer ? [{ file: from, id: base.id, before: base, after: null }, { file: after.layer, id: reply.id, before: null, after: after.row }] : [{ file: after.layer, id: reply.id, before: base ?? null, after: after.row }];
      this.edits.recordDone({ label: base ? 'move' : 'place', changes });
    }
    this.keep.noteUsed(hand.key);
    const notes = this.notes.length ? ` (notes: ${notesLine(this.notes)})` : '';
    this.say(`put down ${hand.name} as ${reply.id}${notes}`, true);
    // A row picked up and put down is moved: the hand lets go of it. A fresh entry stays in hand for the next click.
    if (hand.base && this.hand === hand) {
      hand.base = null;
      this.hand = null;
      this.ghost.clear();
    }
    this.window?.refreshHere();
    return `put down ${reply.id}`;
  }

  /** The permanent row the aim rests on, by id, or null. */
  private hoveredId(): string | null {
    const o = this.aim.hover;
    if (!o || !o.template.startsWith(PLACEMENT_KEY_PREFIX)) return null;
    return o.template.slice(PLACEMENT_KEY_PREFIX.length);
  }

  /** O: the row the aim rests on taken down into the hand, to be put down somewhere else (or given back by Escape). */
  private pickUpHovered(): void {
    const id = this.hoveredId();
    if (!id) {
      this.say('nothing of the files under the aim to pick up', false);
      return;
    }
    void this.pickUp(id);
  }

  /** A row by id into the hand. Answers why not. */
  async pickUp(id: string): Promise<string | null> {
    const h = this.host;
    const lifted = h.lift(id);
    if (!lifted) return this.refuse(`${id} is not standing`);
    const r = lifted.row;
    const here = h.packId();
    const e: LibraryEntry =
      r.pack === 'props'
        ? { s: 'props', p: 'props', id: r.thing ?? '', m: '', n: lifted.label, g: '', t: null, sz: [0, 0, 0], tri: 0, pic: null, f: 0 }
        : r.pack === 'gallery'
          ? { s: 'buildings', p: 'gallery', id: r.model ?? '', m: r.model ?? '', n: lifted.label, g: '', t: r.template ?? null, sz: [0, 0, 0], tri: 0, pic: null, f: ENTRY_FLAG.building }
          : { s: 'world', p: r.from ?? here, id: r.model ?? '', m: r.model ?? '', n: lifted.label, g: '', t: r.template ?? null, sz: [0, 0, 0], tri: 0, pic: null, f: 0 };
    const why = await this.take(e, { row: r, layer: lifted.layer });
    if (why) h.restore(id);
    return why;
  }

  /** Delete with nothing in hand: the row the aim rests on taken out of its file. */
  private deleteHovered(): void {
    const id = this.hoveredId();
    if (!id) {
      this.say('nothing of the files under the aim to delete', false);
      return;
    }
    const s = this.host.stood(id);
    if (!s) return;
    void this.remove(id, s.layer);
  }

  async remove(id: string, layer: PlacementLayer): Promise<string> {
    const before = this.host.rowFor(id);
    const said = await this.host.remove(layer, id);
    this.lastWrite = said;
    this.edits.lastWrite = null;
    this.edits.askStatus();
    // Gone from its file: an action of the history (undone, it is put back under its own id).
    if (before && !this.host.rowFor(id)) this.edits.recordDone({ label: 'delete', changes: [{ file: before.layer, id, before: before.row, after: null }] });
    this.edits.sel.keepOnly((x) => !!this.host.rowFor(x));
    this.say(said, !/refus|not|could/.test(said));
    this.window?.refreshHere();
    return said;
  }

  /**
   * N: the return point moved to where the aim meets the ground or a floor, its room (by number) by the camera's rule there.
   * The water is not ground (the body would be stood on its bed), nor is a row's box with nothing solid under its face.
   */
  private setReturnHere(): void {
    const k = this.aimKind;
    const hit = this.aim.hit;
    const why = returnRefusal(k, k === 'box' && this.host.floorUnder(hit.x, hit.y, hit.z));
    if (why) {
      this.say(why, false);
      return;
    }
    const stream = this.host.world.streamer;
    let cell = 0;
    if (stream) {
      this.tmp.set(hit.x, hit.y + 0.5, hit.z);
      stream.cameraRoomAt(this.tmp, this.hitRoom, floorUnder);
      cell = this.hitRoom.building ? this.hitRoom.cell : 0;
    }
    this.session.setReturn(hit.x, hit.y + 0.05, hit.z, this.fly.yaw + Math.PI, cell);
    this.say('the body will stand here when you leave', true);
  }

  /** Fly the eye to a place: a permanent row by id, or a point `[x, z]` of the file's frame. */
  goTo(where: string | [number, number]): string {
    const h = this.host;
    if (typeof where === 'string') {
      const s = h.stood(where);
      if (!s) return `${where} is not standing`;
      h.player.pos.set(s.x, s.y + 6, s.z + 10);
      this.fly.lookAlong(0, -0.5, -1);
      this.fly.stop();
      return `at ${s.label}`;
    }
    const c = h.world.placeFrame;
    const space = !!h.world.planet?.space;
    const x = space || !c ? where[0] : rawToGameX(c.x, where[0]);
    const z = space || !c ? where[1] : rawToGameZ(c.z, where[1]);
    const ground = space ? 0 : h.world.terrain.heightAt(x, z);
    h.player.pos.set(x, (Number.isFinite(ground) ? ground : 0) + 12, z);
    this.fly.stop();
    return `at ${where[0]}, ${where[1]}`;
  }

  // ---- Words. ----

  private say(words: string, ok: boolean): void {
    this.said = words;
    this.saidOk = ok;
    this.barAt = -Infinity;
  }

  private refuse(why: string): string {
    this.say(why, false);
    return why;
  }

  private writeBar(): void {
    const bar = this.bar;
    if (!bar) return;
    // Game view (G): the bar too, to judge how a place looks.
    if (this.edits.gameView) {
      bar.hide();
      return;
    }
    const v = this.barView;
    const s = this.session;
    const input = this.host.input;
    const ed = this.edits;
    const first = ed.sel.first;
    const fr = first ? this.host.rowFor(first) : null;
    v.sel = fr ? `${ed.sel.size} picked: ${fr.label} (${fr.row.id}, ${destinationFile(fr.layer, this.host.packId())}, ${fr.row.x.toFixed(2)} ${fr.row.y.toFixed(2)} ${fr.row.z.toFixed(2)}${fr.row.scale !== undefined ? `, scale ${JSON.stringify(fr.row.scale)}` : ''})${ed.writing ? ' · writing' : ''}` : ed.writing ? 'writing' : '';
    v.files = filesLine(ed, this.host.packId(), s.dest) + ` · snap ${ed.snapOn ? `${ed.grid} m · ${ed.angle}°` : 'off'} · ${ed.localAxes ? 'local' : 'world'} axes`;
    // Rows drawn one by one past the hint: what they cost, and the way to fold them (DESIGN.md §2.8).
    const stream = this.host.world.streamer;
    const unf = stream?.unfoldedCount ?? 0;
    if (this.folding) v.files += ' · folding…';
    else if (unf > EDITOR_TUNE.foldHint) v.files += ` · ${unf} rows drawn one by one (about ${(stream?.unfoldedMs ?? 0).toFixed(1)} ms a frame): Fold now on the Tools tab${EDITOR_TUNE.autoFold ? ', or wait' : ''}`;
    v.keys = ed.keySheet ? keySheet(input) : '';
    v.mode = s.point ? 'POINT' : 'FLY';
    v.speed = `${this.fly.speed < 10 ? this.fly.speed.toFixed(1) : Math.round(this.fly.speed)} m/s${s.hold ? ' · held' : ''}`;
    const hs = this.hand?.scale;
    const br = this.brush;
    v.hand = this.hand
      ? `in hand: ${this.hand.name}${hs && (hs.x !== 1 || hs.y !== 1 || hs.z !== 1) ? ` (scale ${hs.x === hs.y && hs.y === hs.z ? hs.x : `${hs.x} ${hs.y} ${hs.z}`})` : ''}${this.ghost.shown || !this.hand.bounds ? '' : ' (preparing)'}`
      : br.armed
        ? `brush: ${br.set.size} entr${br.set.size === 1 ? 'y' : 'ies'} · ${BRUSH_TUNE.radius} m · ${BRUSH_TUNE.density} a 100 m²${br.mode ? ` · ${br.mode === 'paint' ? 'painting' : 'erasing'}` : ' · LMB paints, RMB erases, B lets go'}`
        : 'nothing in hand';
    v.dest = `→ ${destinationFile(s.dest, this.host.packId())}`;
    v.room = roomWords(this.host.world.cameraRoom);
    v.notes = this.hand ? notesLine(this.notes) : '';
    v.said = this.said;
    v.saidOk = this.saidOk;
    const k = (a: Parameters<Input['pressedAction']>[0]) => input.bindings[a][0] ?? '';
    v.hint = `WASD fly · ${k('editorUp')}/${k('editorDown')} up/down · Shift fast · Alt slow · wheel speed · ${k('editorPoint')} cursor · ${k('editorSearch')} find · click pick/put down · ${k('placeTurn')}/${k('placeLift')}/${k('editorScale')} held turn/raise/scale · ${k('takeProp')} pick up · ${k('putAway')} delete · ${k('placeLayer')} file · ${k('editorBrush')} brush · ${k('editorKeys')} keys · F2 leave`;
    bar.show(v);
  }

  // ---- The library. ----

  /** The library read: the index if the `library` pass has run, else the packs the game already reads. */
  loadLibrary(): Promise<void> {
    if (this.libLoading) return this.libLoading;
    this.libState = 'loading';
    this.libLoading = (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}assets-private/library/library.json`, { cache: 'no-store' });
        const type = res.headers.get('content-type') ?? '';
        if (res.ok && type.includes('json')) {
          const idx = readLibraryIndex(await res.json());
          if (idx) {
            this.libView = libraryView(idx.entries);
            this.libMade = idx.made;
            this.libState = 'index';
            this.window?.library.render();
            return;
          }
        }
      } catch {
        /* no index: the fallback below */
      }
      await this.fallbackLibrary();
    })();
    return this.libLoading;
  }

  private async fallbackLibrary(): Promise<void> {
    const h = this.host;
    try {
      await h.props.load();
    } catch {
      /* no props pack */
    }
    const gallery = await h.world.housesPack().catch(() => null);
    const own = h.world.ownPack;
    const entries = fallbackEntries({
      props: h.props.all.map((p) => ({ id: p.id, model: p.model, name: p.name ?? null, group: p.group, template: p.template, size: p.size, icon: p.icon ?? null })),
      gallery: gallery ? { sections: [{ id: 'houses', items: gallery.category('layout').filter((d) => (d.cells?.length ?? 0) > 1).map((d) => ({ model: d.id, label: d.id })) }] } : null,
      world: own ? { id: h.packId(), manifest: { categories: { layout: own.category('layout'), flora: own.category('flora') } } } : null,
    });
    this.libView = libraryView(entries);
    this.libState = 'fallback';
    this.window?.library.render();
  }

  private libraryStatus(): string {
    const v = this.libView;
    if (this.libState === 'loading' || !v) return 'reading the library…';
    const pics = v.entries.reduce((n, e) => n + (e.pic ? 1 : 0), 0);
    if (this.libState === 'fallback') return `${v.entries.length} entries, no index: npm run swg -- library assets-private (initials meanwhile)`;
    return `${v.entries.length} entries, ${pics} with a picture`;
  }

  private windowHost() {
    const h = this.host;
    return {
      view: () => this.libView,
      keep: this.keep,
      pictureUrl: (pic: string) => `${import.meta.env.BASE_URL}assets-private/${pic}`,
      defaultPack: (source: LibrarySource) => {
        const planet = h.world.planet;
        if (source === 'flora' && !h.world.ownPack) return planet?.ground?.pack ?? planet?.borrowSky ?? h.packId();
        return h.packId();
      },
      take: (e: LibraryEntry) => void this.take(e),
      held: () => this.hand?.key ?? '',
      status: () => this.libraryStatus(),
      usedHere: () => (this.libView ? usedHereKeys(this.libView, h.fileRows(), h.packId()) : []),
      // Shift+click: the brush's entries (armed, it works them out again with the change).
      brushToggle: (key: string) => {
        const on = this.brush.toggle(key);
        if (this.brush.armed) {
          this.brush.disarm();
          if (this.brush.set.size) void this.brush.arm(null);
          else this.say('the brush let go: nothing left to paint with', true);
        }
        this.window?.refreshEdits();
        return on;
      },
      brushed: (key: string) => this.brush.has(key),
      here: () => h.here(h.player.pos, 60),
      goTo: (id: string) => this.say(this.goTo(id), true),
      pickUp: (id: string) => void this.pickUp(id),
      remove: (id: string, layer: string) => void this.remove(id, layer === 'story' ? 'story' : 'world'),
      isPicked: (id: string) => this.edits.sel.has(id),
      pick: (ids: string[], mode: 'set' | 'add' | 'take') => {
        this.edits.sel.pick(ids, mode);
        this.window?.refreshEdits();
      },
      selected: () => this.selectedView(),
      setField: (f: Record<string, unknown>) => void this.edits.setField(f),
      setPlace: (p: Record<string, unknown>) => void this.edits.setPlace(p),
      history: () => ({ at: this.edits.history.at, actions: this.edits.history.actions.map((a) => `${a.label} (${a.changes.length} row${a.changes.length === 1 ? '' : 's'})`) }),
      historyTo: (n: number) => void this.edits.historyTo(n),
      tools: () => ({
        snapOn: this.edits.snapOn,
        grid: this.edits.grid,
        angle: this.edits.angle,
        gridSteps: [...EDITOR_TUNE.snap.gridSteps],
        angleSteps: [...EDITOR_TUNE.snap.angleSteps],
        local: this.edits.localAxes,
        gameView: this.edits.gameView,
        hold: this.session.hold,
        files: this.edits.fileStates.filter((f) => f.state !== 'none').map((f) => `${f.path.replace(/^public\//, '')}: ${STATE_WORDS[f.state]}`),
        branch: this.edits.branch ?? '',
        fold: (() => {
          const r = h.world.streamer?.unfoldedReport();
          return { rows: r?.rows ?? 0, ms: r?.estMs ?? 0, folded: r?.folded ?? 0, folding: this.folding, auto: EDITOR_TUNE.autoFold, hint: EDITOR_TUNE.foldHint };
        })(),
        brush: {
          armed: this.brush.armed,
          entries: [...this.brush.set].map(([key, weight]) => {
            const e = this.libView?.byKey.get(key);
            return { key, name: e ? entryName(e) : key, weight };
          }),
          switches: BRUSH_SWITCHES.map(([key, words]) => ({ key, words, on: BRUSH_TUNE[key] })),
        },
      }),
      setTool: (t: Record<string, unknown>) => this.setTool(t),
      refreshStatus: () => void this.edits.refreshStatus(),
      dialSet: () => editorDialsFor('editor') as DialSet,
    };
  }

  /** A tool set from the window or the console: snapping, the grid, the angle, the axes, game view, the world held. */
  private setTool(t: Record<string, unknown>): void {
    const ed = this.edits;
    if (typeof t.snapOn === 'boolean') ed.snapOn = t.snapOn;
    if (typeof t.grid === 'number' && t.grid > 0) ed.grid = t.grid;
    if (typeof t.angle === 'number' && t.angle > 0) ed.angle = t.angle;
    if (typeof t.local === 'boolean') ed.localAxes = t.local;
    if (typeof t.gameView === 'boolean') ed.gameView = t.gameView;
    if (typeof t.hold === 'boolean') this.session.hold = t.hold;
    // The third wave's: Fold now and the automatic fold, the brush armed, its entries' weights and its switches.
    if (t.fold === true) void this.foldNow().then(() => this.window?.refreshEdits());
    if (typeof t.autoFold === 'boolean') EDITOR_TUNE.autoFold = t.autoFold;
    if (t.brushArm === true && !this.brush.armed) void this.toggleBrush().then(() => this.window?.refreshEdits());
    if (t.brushArm === false && this.brush.armed) {
      this.brush.disarm();
      this.say('the brush let go', true);
    }
    if (Array.isArray(t.brushWeight) && typeof t.brushWeight[0] === 'string') this.brush.setWeight(t.brushWeight[0], Number(t.brushWeight[1]));
    if (typeof t.brushRemove === 'string') {
      this.brush.set.delete(t.brushRemove);
      // Armed, the brush works its entries out again without the one let go (or is let go with none left).
      if (this.brush.armed) {
        this.brush.disarm();
        if (this.brush.set.size) void this.brush.arm(null);
      }
      this.window?.library.render();
    }
    const sw = t.brushSwitch;
    if (Array.isArray(sw) && typeof sw[1] === 'boolean') {
      const k = BRUSH_SWITCHES.find(([key]) => key === sw[0]);
      if (k) BRUSH_TUNE[k[0]] = sw[1];
    }
  }

  /** The first picked row as the Selected tab shows it, or null. */
  private selectedView(): SelectedView | null {
    const ed = this.edits;
    const first = ed.sel.first;
    const r = first ? this.host.rowFor(first) : null;
    if (!r) return null;
    const h = this.host;
    const w = h.world;
    const g = placementToGame(r.row, w.placeFrame, w.planet?.space ? 'game' : 'raw');
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(g.q[0], g.q[1], g.q[2], g.q[3]), 'YXZ');
    const o = w.streamer?.placedOf(placementKey(r.row.id)) ?? null;
    const b = o ? w.streamer?.boxOf(o) : null;
    const sc = scaleOfRow(r.row);
    const size = b ? `${(Math.abs(b.max[0] - b.min[0]) * sc[0]).toFixed(2)} × ${(Math.abs(b.max[1] - b.min[1]) * sc[1]).toFixed(2)} × ${(Math.abs(b.max[2] - b.min[2]) * sc[2]).toFixed(2)} m` : 'no box';
    const ground = w.planet?.space || r.row.inside ? Number.NaN : w.terrain.heightAt(g.x, g.z);
    const stood = this.host.stoodNote(first as string);
    return {
      count: ed.sel.size,
      id: r.row.id,
      label: r.label,
      file: destinationFile(r.layer, h.packId()),
      model: r.row.pack === 'props' ? `props: ${r.row.thing ?? ''}` : `${r.row.pack}: ${r.row.model ?? ''}${r.row.from ? ` (from ${r.row.from})` : ''}`,
      template: r.row.template ?? '',
      x: r.row.x,
      y: r.row.y,
      z: r.row.z,
      yaw: (e.y * 180) / Math.PI,
      pitch: (e.x * 180) / Math.PI,
      roll: (e.z * 180) / Math.PI,
      scale: r.row.scale === undefined ? '1' : Array.isArray(r.row.scale) ? r.row.scale.join(' ') : String(r.row.scale),
      clear: r.row.clear === undefined ? '' : String(r.row.clear),
      guard: r.row.guard === undefined ? '' : String(r.row.guard),
      solid: r.row.solid ?? (r.row.pack === 'props' ? !h.passable(r.row.thing ? h.props.find(r.row.thing)?.template ?? null : null) : true),
      state: r.row.state ?? '',
      name: r.row.name ?? '',
      note: r.row.note ?? '',
      size,
      height: Number.isFinite(ground) ? `${(r.row.y - ground).toFixed(2)} m` : r.row.inside ? 'in a room' : '—',
      note2: stood ?? '',
    };
  }

  // ---- The console. ----

  dials(helper: string): DialSet | null {
    return editorDialsFor(helper);
  }

  /** `__debug.editor(o)`. */
  async debug(o?: Record<string, unknown>): Promise<unknown> {
    const h = this.host;
    const said: string[] = [];
    if (o && typeof o === 'object') {
      if (o.tune !== undefined) said.push(...tuneEditor(o.tune));
      if (o.on === true && !this.session.on) {
        const why = this.session.enter();
        if (why) said.push(why);
      }
      if (o.on === false && this.session.on) this.session.leave();
      if (o.mode === 'point' || o.mode === 'fly') this.setPoint(o.mode === 'point');
      if (typeof o.speed === 'number') this.fly.speed = Math.min(EDITOR_TUNE.cam.max, Math.max(EDITOR_TUNE.cam.min, o.speed));
      if (o.dest === 'story' || o.dest === 'world') this.session.dest = o.dest;
      if (typeof o.hold === 'boolean') this.session.hold = o.hold;
      if (o.body === true) this.setReturnHere();
      if (o.go !== undefined) said.push(this.goTo(o.go as string | [number, number]));
      // The eye put at a point of the game's frame, and turned to look at another.
      if (Array.isArray(o.at) && o.at.length === 3 && this.session.on) {
        h.player.pos.set(Number(o.at[0]), Number(o.at[1]), Number(o.at[2]));
        this.fly.stop();
      }
      if (Array.isArray(o.look) && o.look.length === 3) {
        const p = h.player.pos;
        this.fly.lookAlong(Number(o.look[0]) - p.x, Number(o.look[1]) - p.y, Number(o.look[2]) - p.z);
      }
      if (typeof o.take === 'string') {
        await this.loadLibrary();
        const e = this.libView?.byKey.get(o.take);
        if (!e) said.push(`no library entry ${o.take}: library({ search }) names them`);
        else {
          const why = await this.take(e);
          if (why) said.push(why);
        }
      }
      if (o.give === true) this.giveUpHand();
      if (o.place === true) said.push(await this.place());
      else if (o.place && typeof o.place === 'object') said.push(await this.place(o.place as { x: number; y: number; z: number; yaw?: number }));
      if (typeof o.remove === 'string') {
        const s = h.stood(o.remove);
        said.push(s ? await this.remove(o.remove, s.layer) : `${o.remove} is not standing`);
      }
      // The editing (the second wave's): what is picked, and every action on it, each written at once.
      const ed = this.edits;
      if (o.select === 'none') ed.sel.clear();
      else if (o.select === 'like') said.push(ed.selectLike());
      else if (Array.isArray(o.select)) {
        const ids = o.select.filter((id): id is string => typeof id === 'string' && !!h.rowFor(id));
        ed.sel.pick(ids, 'set');
        if (ids.length !== o.select.length) said.push(`${o.select.length - ids.length} of those ids are in neither file`);
      }
      if (o.select !== undefined) this.window?.refreshEdits();
      if (o.snap && typeof o.snap === 'object') {
        const s = o.snap as Record<string, unknown>;
        this.setTool({ ...(typeof s.on === 'boolean' ? { snapOn: s.on } : {}), ...(typeof s.grid === 'number' ? { grid: s.grid } : {}), ...(typeof s.angle === 'number' ? { angle: s.angle } : {}) });
      }
      if (o.axes === 'local' || o.axes === 'world') ed.localAxes = o.axes === 'local';
      if (o.view === 'game' || o.view === 'editor') ed.gameView = o.view === 'game';
      if (Array.isArray(o.move) && o.move.length === 3) said.push(await ed.step('move', Number(o.move[0]) || 0, Number(o.move[1]) || 0, Number(o.move[2]) || 0));
      if (typeof o.turn === 'number') said.push(await ed.stepHold('turn', o.turn));
      if (typeof o.raise === 'number') said.push(await ed.stepHold('lift', o.raise));
      if (typeof o.scale === 'number') said.push(o.scale > 0 ? await ed.stepHold('scale', o.scale) : 'a scale is a factor above nought');
      if (o.ground === true || o.ground === 'lean') said.push(await ed.ground(o.ground === 'lean'));
      if (o.dup === true) said.push(await ed.duplicate());
      if (o.copy === true) said.push(await ed.copy(false));
      if (o.cut === true) said.push(await ed.copy(true));
      if (o.paste === true) said.push(await ed.paste(null, false));
      if (o.delete === true) said.push(await ed.deleteSelected(true));
      if (typeof o.undo === 'number') said.push(await ed.undo(o.undo));
      if (typeof o.redo === 'number') said.push(await ed.redo(o.redo));
      if (typeof o.historyTo === 'number') said.push(await ed.historyTo(o.historyTo));
      if (o.set && typeof o.set === 'object') {
        const s = o.set as Record<string, unknown>;
        const place: Record<string, unknown> = {};
        const fields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(s)) {
          if (['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'scale'].includes(k)) place[k] = v;
          else fields[k] = v;
        }
        if (Object.keys(place).length) said.push(await ed.setPlace(place));
        if (Object.keys(fields).length) said.push(await ed.setField(fields));
      }
      if (o.status === true) said.push(await ed.refreshStatus());
      // The third wave's: Fold now, and the brush.
      if (o.fold === true) said.push(await this.foldNow());
      if (o.brush && typeof o.brush === 'object') said.push(...(await this.brushDebug(o.brush as Record<string, unknown>)));
    }
    const p = h.player.pos;
    const c = h.world.placeFrame;
    const space = !!h.world.planet?.space;
    const r = this.session.on ? this.session.ret : this.session.lastReturn;
    const hit = this.aim.hit;
    return {
      on: this.session.on,
      mode: this.session.point ? 'point' : 'fly',
      anchor: { game: [round(p.x), round(p.y), round(p.z)], file: space || !c ? [round(p.x), round(p.y), round(p.z)] : [round(gameToRawX(c.x, p.x)), round(p.y), round(gameToRawZ(c.z, p.z))] },
      camera: [round(h.cam.camera.position.x), round(h.cam.camera.position.y), round(h.cam.camera.position.z)],
      figureShown: h.player.group.visible,
      speed: round(this.fly.speed),
      moving: round(this.fly.moving),
      room: roomWords(h.world.cameraRoom),
      byBox: h.world.cameraRoom.byBox,
      return: r ? { x: round(r.x), y: round(r.y), z: round(r.z), heading: round(r.heading), room: r.cell > 0 ? `room ${r.cell}` : 'outside', noclip: r.noclip } : null,
      lastLeave: this.session.lastLeave,
      hold: this.session.hold,
      aim: { kind: this.aimKind, at: [round(hit.x), round(hit.y), round(hit.z)], hover: this.hoveredId() },
      hand: this.hand ? { key: this.hand.key, name: this.hand.name, building: this.hand.building, ghost: { shown: this.ghost.shown, ready: this.ghost.ready, meshes: this.ghost.meshes.length, inRoom: this.ghost.inRoom } } : null,
      dest: destinationFile(this.session.dest, h.packId()),
      notes: [...this.notes],
      warn: this.warn,
      said: this.said,
      lastWrite: this.edits.lastWrite ?? this.lastWrite,
      edits: this.edits.report(),
      unfolded: h.world.streamer?.unfoldedReport() ?? null,
      autoFold: { on: EDITOR_TUNE.autoFold, idle: EDITOR_TUNE.autoFoldIdle, hint: EDITOR_TUNE.foldHint, quietFor: round(performance.now() / 1000 - this.activeAt), folding: this.folding },
      brush: this.brush.report(),
      bar: { writes: this.bar?.writes ?? 0 },
      ...(said.length ? { answered: said } : {}),
    };
  }

  /**
   * `editor({ brush })`: its numbers (named on it, or under `tune`: every one of `BRUSH_TUNE`), the entries it paints with (`entries`, library
   * keys, replacing the chosen set; `weights`, key to weight), arming (`arm`, true or false) and a whole stroke at a point of
   * the file's own frame (`stroke: { at: [x, z], mode, stamps, seed }`), one undo entry. Answers what was said.
   */
  private async brushDebug(b: Record<string, unknown>): Promise<string[]> {
    const said: string[] = [];
    const br = this.brush;
    if (b.tune !== undefined) said.push(...tuneEditor({ brush: b.tune }));
    // Its numbers and switches named straight on it as well (`editor({ brush: { radius: 8, density: 2 } })`).
    const direct: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(b)) if (Object.prototype.hasOwnProperty.call(BRUSH_TUNE, k)) direct[k] = v;
    if (Object.keys(direct).length) said.push(...tuneEditor({ brush: direct }));
    if (Array.isArray(b.entries)) {
      await this.loadLibrary();
      br.set.clear();
      for (const k of b.entries) {
        if (typeof k !== 'string') continue;
        if (!this.libView?.byKey.has(k)) said.push(`no library entry ${k}`);
        else br.set.set(k, 1);
      }
      if (br.armed) br.disarm();
      this.window?.library.render();
    }
    if (b.weights && typeof b.weights === 'object') for (const [k, v] of Object.entries(b.weights as Record<string, unknown>)) br.setWeight(k, Number(v));
    if (b.arm === true && !br.armed) {
      said.push(await br.arm(this.hand?.key ?? null));
      if (br.armed) this.giveUpHand();
    }
    if (b.arm === false && br.armed) {
      br.disarm();
      said.push('the brush let go');
    }
    const st = b.stroke as Record<string, unknown> | undefined;
    if (st && typeof st === 'object') {
      const at = Array.isArray(st.at) && st.at.length === 2 ? [Number(st.at[0]), Number(st.at[1])] : null;
      const w = this.host.world;
      const c = w.placeFrame;
      const space = !!w.planet?.space;
      // The stroke's middle given in the file's own frame (a `/loc` line on a planet), or at the aim.
      const cx = at ? (space || !c ? at[0] : rawToGameX(c.x, at[0])) : this.aim.hit.x;
      const cz = at ? (space || !c ? at[1] : rawToGameZ(c.z, at[1])) : this.aim.hit.z;
      const mode = st.mode === 'erase' ? 'erase' : 'paint';
      const stamps = typeof st.stamps === 'number' ? Math.max(1, Math.min(200, Math.floor(st.stamps))) : 1;
      said.push(await br.strokeAt(cx, cz, mode, stamps, typeof st.seed === 'number' ? st.seed >>> 0 : undefined));
    }
    return said;
  }

  /** `__debug.library(o)`. */
  async library(o?: Record<string, unknown>): Promise<unknown> {
    await this.loadLibrary();
    const v = this.libView;
    if (!v) return { index: 'none' };
    const counts: Record<string, number> = {};
    for (const s of LIBRARY_SOURCES) counts[s] = 0;
    let pics = 0;
    for (const e of v.entries) {
      counts[e.s]++;
      if (e.pic) pics++;
    }
    const out: Record<string, unknown> = { index: this.libState === 'index' ? 'current' : this.libState, made: this.libMade, entries: v.entries.length, counts, pictures: pics };
    if (o && typeof o === 'object') {
      const source = (LIBRARY_SOURCES as readonly string[]).includes(o.source as string) ? (o.source as LibrarySource) : null;
      if (typeof o.search === 'string' || source || typeof o.world === 'string') {
        const found = searchLibrary(v, source, typeof o.search === 'string' ? o.search : '', typeof o.world === 'string' ? o.world : null);
        out.found = found.length;
        out.first = found.slice(0, 20).map((e) => ({ key: entryKey(e), name: entryName(e), group: e.g, picture: !!e.pic }));
      }
      if (o.recent === true) out.recent = [...this.keep.recent];
      if (typeof o.fav === 'string') out.favourite = this.keep.toggleFavourite(o.fav);
      if (o.favourites === true) out.favourites = [...this.keep.favourites];
    }
    out.page = LIBRARY_TUNE.page;
    return out;
  }
}

/** A file's state in words, as the bar says it (DESIGN.md §2.12). */
const STATE_WORDS: Record<EditorFileState['state'], string> = {
  none: 'no file',
  untracked: 'saved, not committed (untracked: stops a local release pack)',
  modified: 'saved, not committed',
  committed: 'committed',
  main: 'on main',
};

/**
 * The files line of the bar: the destination's file and every other file of this world that exists, each as git last
 * said it is (asked after every write, debounced, and from the window's Refresh); rows reach players once their file is
 * committed and merged to main.
 */
function filesLine(ed: EditorEdits, pack: string, dest: PlacementLayer): string {
  const want = `public/placements/${dest}/${pack}.json`;
  const parts: string[] = [];
  for (const f of ed.fileStates) {
    if (f.kind === 'track') continue;
    if (f.path !== want && f.state === 'none') continue;
    parts.push(`${f.path.replace(/^public\/placements\//, '')}: ${STATE_WORDS[f.state] ?? f.state}`);
  }
  if (!parts.length) return ed.writing ? 'writing' : `${dest}/${pack}.json: not asked yet`;
  return (ed.writing ? 'writing · ' : '') + parts.join(' · ');
}

/** A key's code as a cap on the key sheet. */
function capOf(code: string | undefined): string {
  if (!code) return '—';
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Mouse0$/, 'LMB').replace(/^Mouse1$/, 'MMB').replace(/^Mouse2$/, 'RMB').replace(/^Bracket(Left|Right)$/, (_m, s: string) => (s === 'Left' ? '[' : ']')).replace(/^Backslash$/, '\\').replace(/^Slash$/, '/');
}

/** The key sheet (H): every key of the editor's, as bound now, a line each. */
function keySheet(input: Input): string {
  const k = (a: Parameters<Input['pressedAction']>[0]) => capOf(input.bindings[a][0]);
  return [
    'WORLD EDITOR KEYS',
    `WASD fly · ${k('editorUp')} up · ${k('editorDown')} down · Shift fast · Alt slow · wheel speed · ${k('editorPoint')} cursor (Point) and back`,
    `click pick · Shift+click add or take away · drag in Point: a box (Shift adds, Alt takes away) · ${k('editorFocus')} look at it`,
    `${k('placeTurn')} held turn · Shift+${k('placeTurn')} held (not flying) tip and roll · ${k('placeLift')} held raise · ${k('editorScale')} held scale · wheel with one: its grid`,
    `gizmo: drag an arrow, the square or a ring · ${k('editorNeighbour')} held while dragging: flush to a neighbour · RMB held (Fly): orbit`,
    `${k('editorNudgeFwd')}${k('editorNudgeBack')}${k('editorNudgeLeft')}${k('editorNudgeRight')} nudge a grid step · ${k('editorNudgeUp')}/${k('editorNudgeDown')} up and down · ${k('editorGround')} to the ground (Shift: lean)`,
    `${k('editorGridDown')} ${k('editorGridUp')} grid (Shift: angle) · ${k('editorSnap')} snapping on and off`,
    `Ctrl+D duplicate · Ctrl+C copy · Ctrl+X cut · Ctrl+V paste at the aim (Shift: turned to you) · Ctrl+Z undo · Ctrl+Shift+Z redo`,
    `${k('putAway')} delete · ${k('takeProp')} pick up into the hand · MMB another of that · 1-9 hotbar (Shift+1-9 set) · ${k('placeLayer')} file`,
    `${k('editorBrush')} brush armed and let go (Shift+click entries in the library first) · LMB held paints · RMB held erases · Tools tab: Fold now`,
    `${k('editorGameView')} game view · ${k('editorKeys')} this sheet · ${k('editorBody')} body here · ${k('editorHold')} hold the world · Esc give up / clear · F2 leave`,
  ].join('\n');
}

/**
 * The brush's switches, as the Tools tab shows them (the sliders take its numbers; a switch's line would be a boolean,
 * which the debug menu's dials do not carry): each a key of `BRUSH_TUNE` and its words.
 */
const BRUSH_SWITCHES: readonly (readonly ['randomYaw' | 'align' | 'heightOn' | 'keepOffWater' | 'keepOffStanding', string])[] = [
  ['randomYaw', 'Random turn'],
  ['align', 'Lean to the ground'],
  ['heightOn', 'Height filter'],
  ['keepOffWater', 'Off the water'],
  ['keepOffStanding', 'Off what stands'],
];

/** What the editor's key block mutes after reading them in its own sense: the old hand must not read them too. */
const TAKEN = ['takeProp', 'putAway', 'placeLayer', 'noclipFaster', 'noclipSlower'] as const;

/**
 * The editor's copies of placements taken away (`LayoutStreamer.editorCopies`): through the streamer standing now where
 * there is one (which forgets them), and out of the scene and their instance buffers let go in any case, so copies a world
 * left behind never draw in the next one on a freed pack.
 */
function dropCopiesAnyway(stream: { dropEditorCopies(c: readonly THREE.InstancedMesh[]): void } | null | undefined, copies: readonly THREE.InstancedMesh[]): void {
  if (stream) stream.dropEditorCopies(copies);
  for (const c of copies) {
    if (!c.parent) continue;
    c.removeFromParent();
    c.dispose();
  }
}

/** How far a box's lowest point stands under its origin once turned by `q` (a prop is stood on that point). */
function lowestOf(b: { min: number[]; max: number[] }, q: THREE.Quaternion, tmp: THREE.Vector3): number {
  let low = Infinity;
  for (let i = 0; i < 8; i++) {
    tmp.set(i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]).applyQuaternion(q);
    if (tmp.y < low) low = tmp.y;
  }
  return low;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}


/** The flight's speed held to the tune's least and most. */
function clampSpeed(v: number): number {
  const t = EDITOR_TUNE.cam;
  return Math.min(t.max, Math.max(t.min, v));
}

/** How far a thing in hand stands in the sky, held to the tune's nearest and farthest. */
function clampSky(v: number): number {
  const t = EDITOR_TUNE.aim;
  return Math.min(t.skyFar, Math.max(t.skyNear, v));
}

/** The editor made over the game's own ports: what `main.ts`'s one dynamic import calls. */
export function makeEditor(host: EditorHost): Editor {
  return new Editor(host);
}
