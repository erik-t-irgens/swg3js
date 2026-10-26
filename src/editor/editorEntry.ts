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
import { PLACEMENT_KEY_PREFIX, placementKey, toGame as placementToGame, type PlacementLayer, type PlacementRow } from '../story/placements.ts';
import { gameToRawX, gameToRawZ, rawToGameX, rawToGameZ } from '../story/waypoints.ts';
import type { DialSet } from '../ui/dials.ts';
import type { HudCanvas } from '../ui/hudCanvas.ts';
import { EditorBar, editorBarView } from '../ui/editorBar.ts';
import { EditorWindow, type HereRow } from '../ui/editorWindow.ts';
import { drawEditorMarks, marksView, projectBox, projectPoint } from '../ui/editorMarks.ts';
import { EditorAim } from './aim.ts';
import { floorUnder, roomWords } from './cameraRoom.ts';
import { PASSABLE_NOTE, buildingNotes, editorRefusal, limitNotes, notesLine, propNotes, refusalWords, type BuildingNotes, type EditWorld } from './devVerdict.ts';
import { editorDialsFor } from './editorDials.ts';
import { ALL_ACTIONS, ctrlRule, editorMutes } from './editorKeys.ts';
import { EditorSession, returnRefusal, type EntryState, type LeaveWay, type ReturnPoint } from './editorSession.ts';
import { EDITOR_TUNE, LIBRARY_TUNE, TUNE_WATCH, liveTuned, tuneEditor } from './editorTune.ts';
import { FlyCam, stepSpeed } from './flyCam.ts';
import { LIBRARY_SOURCES, LibraryKeep, ENTRY_FLAG, entryKey, entryName, fallbackEntries, libraryView, readLibraryIndex, searchLibrary, usedHereKeys, type LibraryEntry, type LibrarySource, type LibraryView } from './libraryModel.ts';
import { attachPointer, endPointerFrame, pointerRecord } from './pointer.ts';

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
    // A console line or a slider that moves the flight's speed or the sky's reach moves what is flown now.
    TUNE_WATCH.moved = (partial) => this.tuned(partial);
  }

  /** A tune moved (`tuneEditor`): the two numbers the editor keeps live beside it taken again where it named them. */
  private tuned(partial: unknown): void {
    const live = liveTuned(partial);
    if (live.speed) this.fly.speed = clampSpeed(EDITOR_TUNE.cam.speed);
    if (live.skyReach) this.skyReach = clampSky(EDITOR_TUNE.aim.skyReach);
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
    if (!this.detach) this.detach = attachPointer(h.canvas, this.pointer, EDITOR_TUNE.pick);
    if (!this.window) this.window = new EditorWindow(h.ui, this.windowHost());
    if (!this.bar) this.bar = new EditorBar(h.ui);
    this.window.show(false);
    void this.loadLibrary();
    this.say('the world editor: F2 to leave, Tab for a cursor', true);
  }

  private leaveBody(ret: ReturnPoint, way: LeaveWay): void {
    this.giveUpHand();
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
      a.look = !this.session.point && input.locked;
      input.mute(ctrlRule(ctrl));
      return;
    }
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
        else this.deleteHovered();
      }
      // A click in Fly is the attack's button, read here and muted below; in Point the pointer layer has it.
      if (!this.session.point && input.pressedAction('attack')) this.pendingClick = true;
    }
    // The speed: = and -, and the wheel in Fly (in Point the game drains it and the editor reads its own over the canvas).
    let notches = 0;
    if (input.pressedAction('noclipFaster')) notches++;
    if (input.pressedAction('noclipSlower')) notches--;
    const wheel = this.session.point ? this.pointer.wheel : input.wheel;
    if (this.session.point) input.wheel = 0;
    if (wheel) {
      if (this.hand && this.aimKind === 'sky') {
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
    a.look = !this.session.point && input.locked;
    input.mute(editorMutes(oldHand));
    if (!oldHand) input.mute(TAKEN);
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
    if (!this.session.point) {
      this.setPoint(true);
      return true;
    }
    return performance.now() - this.session.droppedAt < 300;
  }

  /**
   * The canvas clicked in Point mode (a user gesture, so the lock may be asked here): with nothing in hand and nothing
   * dragged, back to Fly; with something in hand, the frame's step places it.
   */
  canvasClick(): void {
    if (!this.session.on || !this.session.point) return;
    if (this.hand || this.pointer.dragging) return;
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
    // The ghost where it would stand.
    const hand = this.hand;
    let inRoom = false;
    if (hand) {
      const stream = h.world.streamer;
      if (stream) {
        this.tmp.set(hit.x, hit.y, hit.z);
        stream.cameraRoomAt(this.tmp, this.hitRoom, floorUnder);
        inRoom = !!this.hitRoom.building;
      }
      this.ghostPos.set(hit.x, hit.y, hit.z);
      if (!hand.building && hand.bounds) this.ghostPos.y -= lowestOf(hand.bounds, hand.q, this.tmp);
      this.ghostM.compose(this.ghostPos, hand.q, ONE);
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
      this.hoverM.compose(this.tmp.set(hov.x, hov.y, hov.z), hov.q, ONE);
      const e = this.hoverM.elements;
      for (let i = 0; i < 16; i++) this.hoverEls[i] = e[i];
      m.hoverOn = projectBox(hb.min, hb.max, this.hoverEls, vp, w, hh, m.hover);
    } else m.hoverOn = false;
    endPointerFrame(this.pointer);
    // The bar, ten times a second: its words are strings.
    if (now - this.barAt > 0.1) {
      this.barAt = now;
      this.writeBar();
    }
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
    // What was in hand before goes back first (a row picked up stands again).
    this.giveUpHand();
    this.takeGen = gen;
    const bounds = got.bounds;
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
      const said = propNotes(hand.bounds, this.propAt, this.propTurn, this.propDeps, hand.passable, []);
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
      if (!hand.building && hand.bounds) this.ghostPos.y -= lowestOf(hand.bounds, hand.q, this.tmp);
      this.ghostM.compose(this.ghostPos, hand.q, ONE);
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
    const said = await this.host.remove(layer, id);
    this.lastWrite = said;
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
    const v = this.barView;
    const s = this.session;
    const input = this.host.input;
    v.mode = s.point ? 'POINT' : 'FLY';
    v.speed = `${this.fly.speed < 10 ? this.fly.speed.toFixed(1) : Math.round(this.fly.speed)} m/s${s.hold ? ' · held' : ''}`;
    v.hand = this.hand ? `in hand: ${this.hand.name}${this.ghost.shown || !this.hand.bounds ? '' : ' (preparing)'}` : 'nothing in hand';
    v.dest = `→ ${destinationFile(s.dest, this.host.packId())}`;
    v.room = roomWords(this.host.world.cameraRoom);
    v.notes = this.hand ? notesLine(this.notes) : '';
    v.said = this.said;
    v.saidOk = this.saidOk;
    const k = (a: Parameters<Input['pressedAction']>[0]) => input.bindings[a][0] ?? '';
    v.hint = `WASD fly · ${k('editorUp')}/${k('editorDown')} up/down · Shift fast · Alt slow · wheel speed · ${k('editorPoint')} cursor · ${k('editorSearch')} find · click put down · ${k('takeProp')} pick up · ${k('putAway')} delete · ${k('placeLayer')} file · ${k('editorBody')} body here · F2 leave`;
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
      here: () => h.here(h.player.pos, 60),
      goTo: (id: string) => this.say(this.goTo(id), true),
      pickUp: (id: string) => void this.pickUp(id),
      remove: (id: string, layer: string) => void this.remove(id, layer === 'story' ? 'story' : 'world'),
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
      lastWrite: this.lastWrite,
      bar: { writes: this.bar?.writes ?? 0 },
      ...(said.length ? { answered: said } : {}),
    };
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

/** What the editor's key block mutes after reading them in its own sense: the old hand must not read them too. */
const TAKEN = ['takeProp', 'putAway', 'placeLayer', 'noclipFaster', 'noclipSlower'] as const;

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
