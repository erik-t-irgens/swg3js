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
import { ACTOR_LAYER, INTERIOR_LAYER } from '../world/portalRender.ts';
import { packIdOfRoot } from '../world/layoutStream.ts';
import { EditorGhost, type GhostDeps } from '../world/placeGhost.ts';
import { patchOfBounds, clearRadius, type Patch } from '../world/housePlace.ts';
import { destinationFile, rowFromEditor, type EditorSource } from '../world/permanentEdit.ts';
import { PLACEMENT_KEY_PREFIX, placementKey, scaleOf as scaleOfRow, toGame as placementToGame, type PlacementLayer, type PlacementRow } from '../story/placements.ts';
import { gameToRawX, gameToRawZ, rawToGameX, rawToGameZ } from '../story/waypoints.ts';
import type { DialSet } from '../ui/dials.ts';
import type { HudCanvas } from '../ui/hudCanvas.ts';
import { EditorBar, editorBarView } from '../ui/editorBar.ts';
import { EditorWindow, type HereRow, type SculptToolsView, type SelectedView } from '../ui/editorWindow.ts';
import { drawEditorMarks, marksView, projectBox, projectPoint } from '../ui/editorMarks.ts';
import { EditorAim } from './aim.ts';
import { floorUnder, roomWords } from './cameraRoom.ts';
import { PASSABLE_NOTE, buildingNotes, editorRefusal, limitNotes, notesLine, propNotes, refusalWords, type BuildingNotes, type EditWorld } from './devVerdict.ts';
import { editorDialsFor } from './editorDials.ts';
import { ALL_ACTIONS, ctrlRule, editorMutes } from './editorKeys.ts';
import { EditorSession, returnRefusal, type EntryState, type LeaveWay, type ReturnPoint } from './editorSession.ts';
import { BRUSH_TUNE, EDITOR_TUNE, LIBRARY_TUNE, SCULPT_TUNE, TUNE_WATCH, liveTuned, registerExtraTune, tuneEditor, tuneSculpt } from './editorTune.ts';
import { EditorSculpt, sculptTool, type SculptHost } from './editorSculpt.ts';
import { SCULPT_FALLOFFS, SCULPT_MODES, type SculptMode } from './sculpt.ts';
import { GROUND_PAINT_TUNE, GROUND_REWRITE_TUNE } from '../world/groundRewrite.ts';
import { EditorPaint, hexOf, paintTool, recipeWords, washInto, type PaintHost } from './editorPaint.ts';
import { FLORA_PAINT_TUNE, PAINT_TUNE, tuneFloraPaint, tunePaint } from './editorTune.ts';
import { FLORA_CLASSES, type FloraClass, type FloraClassSpec, type FloraRecipe } from '../swg/terrain/groundPaint.ts';
import { LAKE_LOOK_DIALS, RIVER_DIALS, WASH_DIALS, placesToolDials } from './editorDials.ts';
import { LOCATION_DIALS } from '../world/locationsDials.ts';
import { PAINT_LAYERS, type PaintLayer } from './groundBrush.ts';
import { TINT_MODES, type PaintWorldRow } from '../world/editFiles/paintFile.ts';
import { readWash, type WashSpec } from '../world/demWash.ts';
import type { PaintToolsView, PlantsToolsView } from '../ui/editorWindow.ts';
import { GROUND_DRAW_TUNE } from '../world/groundTiles.ts';
import { lentFamilyKey } from '../swg/terrain/generator.ts';
import { groundPacksOf, packOfFamily } from '../world/lentGround.ts';
import { deflateBase64 } from '../world/editFiles/browserCodec.ts';
import { standingFoot } from '../world/layoutStream.ts';
import { FlyCam, stepSpeed } from './flyCam.ts';
import { LIBRARY_SOURCES, LibraryKeep, ENTRY_FLAG, entryKey, entryName, fallbackEntries, libraryView, readLibraryIndex, searchLibrary, usedHereKeys, type LibraryEntry, type LibrarySource, type LibraryView } from './libraryModel.ts';
import { attachPointer, endPointerFrame, pointerRecord } from './pointer.ts';
import { EditorEdits, type EditorBatch, type EditorFileState } from './editorEdit.ts';
import type { RowChange } from './undo.ts';
import { entryForRow } from './libraryModel.ts';
import type { BatchEdit } from '../world/placementEdits.ts';
import { EditorBrush, brushNearOf, scatterTool, type BrushNearThing } from './editorBrush.ts';
import { brushRing, meantForWater, ringAsk, type RingGround } from './brush.ts';
import { ToolList, toolFrame, type ToolDef, type ToolDraw } from './tools.ts';
import { EditorWater, waterTool, type WaterHost } from './editorWater.ts';
import { WATER_CHOICES, WATER_TUNE, tuneWater, PLACES_TOOL_CHOICES, PLACES_TOOL_TUNE, tunePlacesTool } from './editorTune.ts';
import { EditorPlaces, placeAreaSnippet, placesTool, skyOfRow, wholeSkyOf, type PlacesHost, type SkyFields } from './editorPlaces.ts';
import { buildable, drawnOnMap, saidOnEntry, shapeArea, shapeMiddle, type LocationRow, type LocationShape } from '../world/editFiles/locationsFile.ts';
import { LAKE_TUNE, RIVER_STEEP, RIVER_TUNE, tuneRiverTune } from '../world/ourWater.ts';
import type { WaterRiverRow } from '../world/editFiles/waterFile.ts';
import { outlineArea } from './lakeTrace.ts';
import type { WaterToolsView, LakeView, PlaceView, PlacesToolsView } from '../ui/editorWindow.ts';
import { EditorLooks } from './editorLooks.ts';
import { attachAtHit, markRow, withAttachment } from './lookPick.ts';
import { ATTACH_TUNE, rowMatrix, type RowAttachments } from '../world/rowAttach.ts';
import { LOOK_TUNE } from '../world/rowMaterials.ts';
import { attachOfEntry, isAttachEntry } from './libraryModel.ts';
import { parseDonor, readAttachments, readLooks, type RowAttach } from '../story/placements.ts';
import { pieceOfKey } from '../world/interiors.ts';

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
  fileRows(): readonly { pack?: string; thing?: string; model?: string; template?: string; from?: string }[];
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
  /**
   * Another world's ground family lent this world in play (Map-maker II's third wave), behind the editor's short curtain:
   * null once lent, else why not, in words.
   */
  lendGround(pack: string, name: string): Promise<string | null>;
  /**
   * A real-elevation world's plants made ready for its flora paint (Map-maker II's fourth wave): the lent pack's flora models
   * the recipes name loaded, the planter, the grass and the far cards stood, behind the editor's short curtain. Null once
   * ready, else why not, in words.
   */
  floraReady(): Promise<string | null>;
  /**
   * A lake of ours written behind the editor's short curtain (Map-maker II's fifth wave): the work (the write, whose answer
   * stands the lake by difference behind the screen), then the effects' own warm-up (the lake's mask twins, which no sweep
   * compiles), then the curtain's sweep. Answers what the work said, or why it could not run.
   */
  lakeCurtain(detail: string, work: () => Promise<string>): Promise<string>;
  /**
   * A write behind the editor's short curtain (Map-maker II's seventh wave: a borrowed material, which may need a program of
   * its own): the work, whose answer stands the row by difference behind the screen, then the curtain's sweep. Answers what
   * the work said.
   */
  curtain?(detail: string, work: () => Promise<string>): Promise<string>;
  /** The dye picker's palettes (the seventh wave's tint): the wardrobe's garment palettes and the creator's table. */
  pickerPalettes?(): Promise<{ wardrobe: Record<string, number[][]> | null; table: unknown }>;
  /**
   * A no-build zone over a circle of `r` metres about a game point, in the editor's words ("inside <name>, where players may
   * not build"), or null (Map-maker II's eighth wave): the places' own verdict, which a player's ghost refuses by.
   */
  zoneNote?(x: number, z: number, r: number): string | null;
  /** This world's places of ours as the last landing left them, and its locations file as last read (Map-maker II's eighth wave). */
  locations?(): { rows: readonly LocationRow[]; bytes: number | null; problem: string | null };
  /** The same rows alone, one list until the next landing and a kept empty one before any: what a frame asks (nothing made). */
  locationRows?(): readonly LocationRow[];
  /**
   * The interior layout files' wave: a furnished building row's template furniture as rows of its own, in the file's frame
   * and with no ids (each with the base its id is minted from and its piece's index in the file), and whether any would stand
   * out of a model not yet loaded where its row stands it (the editor's curtain then); or why not, in words.
   */
  ownFurniture?(id: string): { rows: { base: string; index: number; row: Omit<PlacementRow, 'id'> }[]; fresh: boolean } | string;
  /** How a building row's furniture stands here, in words: its file's and how many pieces, its own, or none ('' for no building). */
  furnitureNote?(id: string): string;
  /**
   * The ids of the rows of a building's own file standing in its rooms, marks included, by the very rule a thing put down
   * there is hosted (`carriedRowIds`): what a building whose furniture is its own carries and takes with it. Asked of an edit.
   */
  hostedRows?(key: string): string[];
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
  /**
   * An effect or a sound out of the library (Map-maker II's seventh wave): hung where the aim meets a row of the files (with
   * "attach to what it lands on" on), else stood as a mark. No model and no ghost; an effect shown at the aim (`ATTACH_TUNE.preview`).
   */
  attach?: RowAttach;
  /** The owner a picked-up row's looks are held under while its ghost wears them (let go with the ghost and what it left behind). */
  lookOwner?: object;
}

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

/** A lake of ours on the Here tab is listed under this prefix and its id, so its buttons reach the water tool. */
const LAKE_ROW = 'lake:';
function isLakeRow(id: string): boolean {
  return id.startsWith(LAKE_ROW);
}

/**
 * A piece of a furnished building's template furniture, by the id its streamer key carries (`<building id>.f<n>`, the
 * interior layout files' wave): its building's row id and its index in the file, or null for an id that is no piece's (a
 * row's id holds no `.`, so no row is ever read as one).
 */
function pieceOfId(id: string): { building: string; index: number } | null {
  const p = pieceOfKey(placementKey(id));
  return p && p.building.startsWith(PLACEMENT_KEY_PREFIX) ? { building: p.building.slice(PLACEMENT_KEY_PREFIX.length), index: p.index } : null;
}

/** What O and Delete say of a piece of a building's template furniture: it is the file's until made the building's own. */
const PIECE_FIRST = "a piece of a building's own furniture out of the client's file: click it (or pick it on the Here tab) to make that building's furniture its own rows first";

/** A place of ours on the Here tab (Map-maker II's eighth wave), so its buttons reach the places tool. */
const PLACE_ROW = 'place:';
function isPlaceRow(id: string): boolean {
  return id.startsWith(PLACE_ROW);
}

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
  /** The look picker's click (Fly's attack, read in the key block), resolved after the camera. */
  private lookClick = false;
  /** That press still held: the editing hears no click off its release (`edits.idle()` until the button is up). */
  private lookRelease = false;
  /** The cursor handed to the handles' frame in a kept record (fractions from the start: a number never crosses the call). */
  private readonly lookCur = { x: 0.5, y: 0.5 };
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
  private readonly propDeps: { floorAt(x: number, y: number, z: number): number | null; solidAt(x: number, y: number, z: number): boolean; reserved: (x: number, z: number, r: number) => string | null; zone: (x: number, z: number, r: number) => string | null };
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
      // A no-build zone (Map-maker II's eighth wave), in the editor's words: noted, never refused.
      zone: (x, z, r) => host.zoneNote?.(x, z, r) ?? null,
    };
    this.propDeps = {
      floorAt: (x, y, z) => w.groundAt(x, y + 0.5, z, w.inside),
      solidAt: (x, y, z) => w.solidAt(x, y, z),
      reserved: (x, z, r) => host.guarded(x, z, r),
      zone: (x, z, r) => host.zoneNote?.(x, z, r) ?? null,
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
      // The rows standing in a building's rooms (the interior layout files' wave): a building whose furniture is its own carries them.
      hostedRows: (key) => host.hostedRows?.(key) ?? [],
      ownPiece: (id, shift) => me.ownPieceAsked(id, shift),
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
      toolArmed: () => me.tools.toolArmed(),
      // The middle button an armed tool owns (the paint brush's pick of the family under the aim): the eyedropper's otherwise.
      toolMiddle: () => {
        const t = me.tools.armedTool;
        if (!t || !t.owns('middle') || !t.middle) return false;
        t.middle();
        return true;
      },
      // What hangs on a row (the seventh wave) carried with an edit under way and put back as it ends; a mark's place.
      follow: (key, m) => w.rowAttach.follow(key, m),
      unfollow: (key) => w.rowAttach.restore(key),
      markAt: (key, out) => {
        const m = w.rowAttach.rowMatrixOf(key);
        if (!m) return false;
        out.x = m.elements[12];
        out.y = m.elements[13];
        out.z = m.elements[14];
        return true;
      },
    });
    this.edits.destOf = () => this.session.dest;
    // The looks and attachments (Map-maker II's seventh wave).
    this.looks = new EditorLooks({
      input: host.input,
      point: () => me.point,
      pointer: () => me.pointer,
      rowFor: (id) => host.rowFor(id),
      picked: () => me.edits.sel.ids,
      pickOnly: (id) => {
        if (id) me.edits.sel.pick([id], 'set');
        else me.edits.sel.clear();
        me.window?.refreshEdits();
      },
      putRows: (label, changes) => me.edits.putRows(label, changes),
      say: (words, ok) => me.say(words, ok),
      stream: () => w.streamer,
      attachments: () => w.rowAttach as unknown as RowAttachments<unknown>,
      frame: () => (w.planet?.space ? 'game' : 'raw'),
      centre: () => w.placeFrame,
      curtain: (detail, work) => (host.curtain ? host.curtain(detail, work) : work()),
      grid: () => me.edits.grid,
      refresh: () => me.window?.refreshEdits(),
    });
    // The scatter brush (the third wave's): its entries out of the library, what stands near its disc, the ground under it.
    this.brush = new EditorBrush({
      edits: this.edits,
      source: async (key) => {
        await me.loadLibrary();
        const e = me.libView?.byKey.get(key);
        if (!e) return `no library entry ${key}`;
        // An effect or a sound (the seventh wave) has no model to plant: it is hung with the hand.
        if (isAttachEntry(e)) return `${entryName(e)} is an effect or a sound: take it in hand and click to hang it (the brush plants things with a model)`;
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
      // The roads and rivers the generator marked (Map-maker II's fourth wave), from the cached ground: the brush keeps off them.
      road: (x, z) => w.roadIfCached(x, z),
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
    // The Tools list (Map-maker II's groundwork): the scatter brush its first entry, exactly as built, on B.
    this.tools.add(scatterTool(this.brush, () => this.brush.arm(this.hand?.key ?? null)));
    // The sculpt brush (Map-maker II's first wave), on K: the world's height edits, raised, lowered, flattened and smoothed.
    this.sculpt = new EditorSculpt(this.sculptHost());
    this.tools.add(sculptTool(this.sculpt));
    // The world asks which tiles a stroke under way holds before it lays a write's answer or the file read again over them.
    const sculpt = this.sculpt;
    w.heightsHeld = (tx, tz) => sculpt.holds(tx, tz);
    GROUND_REWRITE_TUNE.frameMs = SCULPT_TUNE.frameMs;
    GROUND_REWRITE_TUNE.floraHz = SCULPT_TUNE.floraHz;
    // The paint brush (Map-maker II's second wave), on U: the world's ground families and colours, painted inside the
    // generator so the world's own plants follow them. The middle button takes the family under the aim.
    this.paint = new EditorPaint(this.paintHost());
    this.tools.add(paintTool(this.paint, () => ({ x: me.aim.hit.x, z: me.aim.hit.z, valid: me.aimKind !== 'sky' })));
    const paint = this.paint;
    w.paintHeldTile = (key, layer) => paint.holds(key, layer);
    GROUND_REWRITE_TUNE.paintMs = PAINT_TUNE.previewMs;
    GROUND_PAINT_TUNE.rasterWaitMs = PAINT_TUNE.rasterWaitMs;
    // The water tool (Map-maker II's fifth wave), on Z: lakes of ours by clicks or traced at a level, picked, moved, raised
    // and taken out, and falls between them; every change one write, stood by difference as its answer lands.
    this.water = new EditorWater(this.waterHost());
    this.tools.add(waterTool(this.water));
    // The places tool (Map-maker II's eighth wave), on P: cities, places and zones of ours drawn as circles, rectangles or
    // outlines into the world's locations file; every change one write, landed by difference as its answer comes.
    this.places = new EditorPlaces(this.placesHost());
    this.tools.add(placesTool(this.places));
    // Its numbers of feel as sliders in the debug menu's `locations` set, beside the places' own (`locationDialSet`).
    LOCATION_DIALS.tool = placesToolDials();
    // The picked lake's look as the debug menu's sliders, each written into the water file a moment after it rests.
    LAKE_LOOK_DIALS.host = {
      look: () => {
        const id = this.water.picked;
        const l = id ? (w.lakeLookOf(id) ?? w.riverLookOf(id)) : null;
        return id && l ? { id, opacity: l.opacity, ripple: l.ripple, drift: l.drift } : null;
      },
      set: (partial) => this.lakeLookDial(partial),
    };
    // The rivers' own numbers as the debug menu's sliders (the sixth wave): a moved slope limit makes every river again.
    RIVER_DIALS.host = { tune: (partial) => this.tuneRivers(partial) };
    // The wash's numbers as the debug menu's sliders, each written into the world row (debounced) as it moves.
    WASH_DIALS.host = {
      wash: () => (w.paintWorld.wash ?? null) as ReturnType<NonNullable<typeof WASH_DIALS.host>['wash']>,
      set: (partial) => this.washDial(partial),
    };
    // A tool's rings, drawn from this frame's camera (`vp`, written before any tool draws) round the aim: the record's
    // radius at the ring's slot, into the marks' kept arrays. Nothing is made.
    const marks = this.marks;
    const ringAsk = this.ringAsk;
    const ringGround = this.ringGround;
    const vp = this.vp;
    this.toolDraw = {
      marks,
      radius: 0.5,
      ring(slot) {
        ringAsk.radius = this.radius;
        if (slot === 0) {
          brushRing(ringAsk, ringGround, vp.elements, marks.ring, marks.ringVis);
          marks.ringOn = true;
        } else {
          brushRing(ringAsk, ringGround, vp.elements, marks.ring2, marks.ring2Vis);
          marks.ring2On = true;
        }
      },
    };
    // A console line or a slider that moves the flight's speed or the sky's reach moves what is flown now.
    TUNE_WATCH.moved = (partial) => this.tuned(partial);
    // The looks' and the attachments' numbers (the world's own objects) reached by the editor's tune and sliders.
    registerExtraTune('look', LOOK_TUNE as unknown as Record<string, unknown>);
    registerExtraTune('attach', ATTACH_TUNE as unknown as Record<string, unknown>);
  }

  /** The editing: the selection, the hand on it, the gizmo, the snaps, copy and paste, undo and redo. */
  readonly edits: EditorEdits;
  /** The looks and attachments (Map-maker II's seventh wave): a row's materials, its effects and sounds, the marks. */
  readonly looks: EditorLooks;
  /**
   * Whether an effect or a sound put down hangs on the row the aim meets (a row of the files with a model) or stands as a
   * mark of its own: on, the Tools tab's switch and `editor({ attachOnto })`.
   */
  attachOnto = true;
  /** The scatter brush. */
  readonly brush: EditorBrush;
  /** The sculpt brush (Map-maker II). */
  readonly sculpt: EditorSculpt;
  /** The paint brush (Map-maker II's second wave). */
  readonly paint: EditorPaint;
  /** The water tool (Map-maker II's fifth wave). */
  readonly water: EditorWater;
  /** The places tool (Map-maker II's eighth wave). */
  readonly places: EditorPlaces;
  /** The pack the paint palette's family list shows (Map-maker II's third wave): '' for this world's own. */
  private paintBrowse = '';
  /**
   * The flora recipe being built on the Tools tab (Map-maker II's fourth wave): a class at a time its op and the family an
   * add or a remove names, and whether it paints roads too. Kept for the session.
   */
  private readonly recipeDraft: Record<FloraClass, { op: string; family: string }> & { roads: boolean } = {
    trees: { op: 'keep', family: '' },
    plants: { op: 'keep', family: '' },
    grass: { op: 'keep', family: '' },
    far: { op: 'keep', family: '' },
    roads: false,
  };

  /** The draft as a recipe (an add or a remove with no family named keeps its class, and says so), the tune's density and thin share in it. */
  private draftRecipe(): { recipe: FloraRecipe; unnamed: string[] } {
    const pack = this.host.world.paintPack();
    const r: FloraRecipe = {};
    const unnamed: string[] = [];
    for (const c of FLORA_CLASSES) {
      const d = this.recipeDraft[c];
      let s: FloraClassSpec | undefined;
      if (d.op === 'clear') s = 'clear';
      else if (d.op === 'thin') s = { thin: FLORA_PAINT_TUNE.thin };
      else if (d.op === 'add' || d.op === 'remove') {
        if (!d.family) unnamed.push(c);
        else if (d.op === 'add') s = FLORA_PAINT_TUNE.density > 0 ? { add: { pack, name: d.family }, density: FLORA_PAINT_TUNE.density } : { add: { pack, name: d.family } };
        else s = { remove: { pack, name: d.family } };
      }
      if (s) r[c] = s;
    }
    if (this.recipeDraft.roads) r.roads = true;
    return { recipe: r, unnamed };
  }

  /** The world's flora tables a recipe names families in: the converted terrain's, or a real-elevation world's lent table's. */
  private floraTables(): { flora: { families: ReadonlyMap<number, { name: string }> }; radial: { families: ReadonlyMap<number, { name: string }> } } | null {
    const w = this.host.world;
    const g = (w.terrain.swg ?? w.terrain.demLent)?.template.generator;
    return g ? { flora: g.floraGroup, radial: g.radialGroup } : null;
  }

  /** The plants layer as the Tools tab shows it (Map-maker II's fourth wave), or null where the world has no flora tables. */
  private plantsView(): PlantsToolsView | null {
    const w = this.host.world;
    const tables = this.floraTables();
    if (!tables) return null;
    const names = (m: ReadonlyMap<number, { name: string }>): string[] => [...new Set([...m.values()].map((f) => f.name))].sort((a, b) => a.localeCompare(b));
    const trees = names(tables.flora.families);
    const radial = names(tables.radial.families);
    const labels: Record<FloraClass, string> = { trees: 'Trees', plants: 'Plants', grass: 'Grass', far: 'Far cards' };
    const recipes = w.paintRecipes.map((r, i) => ({ at: i + 1, words: recipeWords(r), chosen: PAINT_TUNE.layer === 'plants' && FLORA_PAINT_TUNE.recipe === i + 1, paints: !w.floraMissing.some((s) => s.startsWith(`recipe ${i + 1} `)) }));
    const draft = FLORA_CLASSES.map((c) => ({ cls: c, label: labels[c], op: this.recipeDraft[c].op, family: this.recipeDraft[c].family, families: c === 'trees' || c === 'plants' ? trees : radial }));
    const notes: string[] = [];
    notes.push(w.paintWorld.follow === false ? "The world's own plants keep their places under painted families; a recipe paints the plants themselves wherever it is laid." : "The world's own plants follow the painted families; a recipe is laid over them after, wherever it is laid.");
    if (w.planet?.dem) notes.push(`On this real-elevation world every plant is the paint's: ${w.terrain.demLentPack ?? 'the lent pack'}'s trees, plants, grass and far cards, planted as that world plants them; a chunk with no flora cell keeps the props it always stood.`);
    notes.push('Roads and rivers stay clear unless a recipe says so. The walk grid follows only a re-bake.');
    return { recipes, draft, roads: this.recipeDraft.roads, note: notes.join(' ') };
  }
  /** Other installed worlds' families as read for that list, by pack, or why not (a pack still being read is absent). */
  private readonly browsed = new Map<string, { name: string; pictures: (string | null)[] }[] | string>();

  /** The palette's family list turned to a pack (this world's own, or another installed world's to lend from), read once. */
  private browsePack(pack: string): void {
    const w = this.host.world;
    this.paintBrowse = pack === w.paintPack() ? '' : pack;
    if (!this.paintBrowse || this.browsed.has(pack)) return;
    void w.packFamilies(pack).then((r) => {
      this.browsed.set(pack, r);
      this.window?.refreshEdits();
    });
  }

  /** What the paint brush needs of the game: the world's paint and its rebuild, its families, the file's rows. */
  private paintHost(): PaintHost {
    const h = this.host;
    const w = h.world;
    const me = this;
    const pole = { family: 0, choice: 0, color: 0 };
    return {
      get edits() {
        return me.edits;
      },
      worldKind: () => h.worldKind(),
      notPaintable: () => {
        if (w.terrain.swg) return null;
        if (w.terrain.demShader) return null;
        if (w.planet?.dem) return "this real-elevation world's ground names no family yet: name a base family in its paint file (groundPaint({ world: { base: { pack: 'lok', name: '<family>' } } }), families('lok') lists them) and travel here again";
        return "this world's ground has no families to paint";
      },
      paint: () => w.ensurePaint(),
      entries: () => w.paintEntries,
      addEntry: (e) => {
        w.paintEntries = [...w.paintEntries, e];
        const g = w.paintGroup();
        if (g) w.resolvePaint(g);
        return w.paintEntries.length;
      },
      keepEntries: (n) => {
        if (w.paintEntries.length <= n) return;
        w.paintEntries = w.paintEntries.slice(0, n);
        const g = w.paintGroup();
        if (g) w.resolvePaint(g);
      },
      pack: () => w.paintPack(),
      families: () => {
        const g = w.paintGroup();
        const own = w.paintPack();
        return [...(g?.families.values() ?? [])].map((f) => ({ id: f.id, name: f.name, pack: packOfFamily(g, f.id, own), children: f.children }));
      },
      lent: (pack, name) => w.lentHere(pack, name),
      lend: (pack, name) => h.lendGround(pack, name),
      familyAt: (x, z) => {
        const s = w.terrain.swg;
        if (s) return s.groundIfCached(x, z, pole) ? { family: pole.family, choice: pole.choice } : null;
        const f = w.terrain.familyAt(x, z);
        return f ? { family: f, choice: 0 } : null;
      },
      colourAt: (x, z) => {
        const s = w.terrain.swg;
        if (s) return s.colorIfCached(x, z);
        const c = w.terrain.colourIdAt(x, z);
        return c < 0 ? null : c;
      },
      toRaw: (x, z, out) => {
        const s = w.terrain.swg;
        out.x = s ? s.toSwgX(x) : -x;
        out.z = s ? s.toSwgZ(z) : z;
      },
      preview: (r, fx, fz) => {
        const a = w.rawToGame(r.x0, r.z0);
        const b = w.rawToGame(r.x1, r.z1);
        w.paintPreview(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), fx, fz);
      },
      release: (r, famKeys, colKeys, floKeys) => w.paintRelease(r.x0, r.z0, r.x1, r.z1, famKeys, colKeys, floKeys),
      // The flora recipes (Map-maker II's fourth wave), held as the palette is: in memory ahead of the file, resolved at once.
      recipes: () => w.paintRecipes,
      addRecipe: (r) => {
        w.ensurePaint();
        w.paintRecipes = [...w.paintRecipes, r];
        const g = w.paintGroup();
        if (g) w.resolvePaint(g);
        return w.paintRecipes.length;
      },
      keepRecipes: (n) => {
        if (w.paintRecipes.length <= n) return;
        w.paintRecipes = w.paintRecipes.slice(0, n);
        const g = w.paintGroup();
        if (g) w.resolvePaint(g);
      },
      recipeMissing: (at) => {
        const m = w.floraMissing.filter((s) => s.startsWith(`recipe ${at} `));
        return m.length ? m.join('; ') : null;
      },
      floraReady: () => h.floraReady(),
      floraIsReady: () => w.demFloraReady(),
      fileRow: (id) => w.paintRows.get(id) ?? null,
      fileSize: () => ({ rows: w.paintRows.size, bytes: w.paintRows.bytes }),
      worldRow: () => w.paintWorld,
      beginWork: () => w.beginGroundWork(),
      noteStamp: () => w.noteStamp(),
      say: (words, ok) => me.say(words, ok),
    };
  }

  /**
   * The paint file's world row written (the Tools tab's switches and weights, the console's `groundPaint({ world })`): one
   * batch of the one row, one undo entry, the row taken by the world as the answer lands (`World.landPaint`). Fields given
   * as undefined or null are taken out of the row (the code's own default answers for them again). Answers what was said.
   */
  async writePaintWorld(partial: Record<string, unknown>, label = 'the paint\'s world row'): Promise<string> {
    const w = this.host.world;
    const no = this.paint.refusal();
    if (no && !(w.planet?.dem && ('base' in partial || 'packs' in partial || 'wash' in partial))) return no;
    const row: Record<string, unknown> = { ...w.paintWorld, ...partial, id: 'world' };
    for (const k of Object.keys(row)) if (row[k] === undefined || row[k] === null) delete row[k];
    delete row.at;
    const before = w.paintRows.get('world') ?? null;
    const es = this.edits.beginStroke(label);
    const err = await this.edits.strokeWrite(es, [{ file: 'paint', id: 'world', before: before ? { ...before } : null, after: row as unknown as PaintWorldRow }]);
    const said = this.edits.endStroke(es);
    this.window?.refreshEdits();
    return err ? said || err : said;
  }

  /** The wash's dials (the debug menu's sliders): moved into the world row in memory at once, written a moment after the last move. */
  private washTimer: ReturnType<typeof setTimeout> | null = null;
  washDial(partial: Record<string, unknown>): string[] {
    const w = this.host.world;
    const was = w.paintWorld.wash;
    if (!was) return ['no wash is named: groundPaint({ world: { wash: { base: [r, g, b] } } }) names one'];
    const next = washInto(was, partial);
    if (typeof next === 'string') return [next];
    w.applyPaintWorld({ ...w.paintWorld, wash: next }, true);
    if (this.washTimer) clearTimeout(this.washTimer);
    // The write is this world's: a travel inside the wait drops it (`worldGone` clears the timer, and the generation is
    // asked again as it fires), or the next world's file would be written a world row it never had.
    const gen = w.generation;
    this.washTimer = setTimeout(() => {
      this.washTimer = null;
      if (w.generation !== gen) return;
      void this.writePaintWorld({ wash: w.paintWorld.wash }, 'the wash');
    }, 600);
    return [];
  }

  /** The picked lake's look sliders: the numbers gathered, written once they rest (a travel inside the wait drops them). */
  private lakeLookTimer: ReturnType<typeof setTimeout> | null = null;
  private lakeLookOwed: Record<string, number> = {};
  lakeLookDial(partial: Record<string, number>): string[] {
    const id = this.water.picked;
    if (!id) return ['no lake is picked: pick one with the water tool (Z), a click on its ring'];
    Object.assign(this.lakeLookOwed, partial);
    if (this.lakeLookTimer) clearTimeout(this.lakeLookTimer);
    const w = this.host.world;
    const gen = w.generation;
    this.lakeLookTimer = setTimeout(() => {
      this.lakeLookTimer = null;
      const look = this.lakeLookOwed;
      this.lakeLookOwed = {};
      if (w.generation !== gen || this.water.picked !== id) return;
      void this.water.setLake(id, { look }).then(() => this.window?.refreshEdits());
    }, 600);
    return [];
  }

  /** What the sculpt brush needs of the game: the world's height edits and their rebuild, what stands, the file's rows. */
  private sculptHost(): SculptHost {
    const h = this.host;
    const w = h.world;
    const me = this;
    const foot = standingFoot();
    const tmp = new THREE.Vector3();
    const q = new THREE.Quaternion();
    return {
      get edits() {
        return me.edits;
      },
      worldKind: () => h.worldKind(),
      store: () => w.ensureHeights(),
      // The raw height at a pole of the raw frame: a converted world's cached block's raw copy (the block made ready where it
      // is not cached, a stamp's rare cost), a real-elevation world's ground with no edit laid on.
      rawAt: (px, pz) => {
        const x = px * 2;
        const z = pz * 2;
        const s = w.terrain.swg;
        if (!s) return w.terrain.groundRawAt(-x, z);
        let r = s.sampler.rawPoleAt(x, z);
        if (r === null) {
          s.heightAt(s.toGameX(x), s.toGameZ(z));
          r = s.sampler.rawPoleAt(x, z);
        }
        return r ?? Number.NaN;
      },
      toRaw: (x, z, out) => {
        const s = w.terrain.swg;
        out.x = s ? s.toSwgX(x) : -x;
        out.z = s ? s.toSwgZ(z) : z;
      },
      toGame: (x, z, out) => {
        const s = w.terrain.swg;
        out.x = s ? s.toGameX(x) : -x;
        out.z = s ? s.toGameZ(z) : z;
      },
      changed: (r, end, fx, fz) => {
        if (!(r.x0 <= r.x1)) {
          if (end) w.endHeightsStroke();
          return;
        }
        const s = w.terrain.swg;
        const ax = s ? s.toGameX(r.x0) : -r.x0;
        const bx = s ? s.toGameX(r.x1) : -r.x1;
        const az = s ? s.toGameZ(r.z0) : r.z0;
        const bz = s ? s.toGameZ(r.z1) : r.z1;
        w.heightsChanged(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), end, fx, fz);
      },
      feet: (x0, z0, x1, z1, visit) => w.streamer?.forEachStandingFoot(x0, z0, x1, z1, foot, visit),
      standing: () => h.standingRows(),
      lowestOf: (id) => {
        const o = w.streamer?.placedOf(placementKey(id)) ?? null;
        const b = o ? w.streamer?.boxOf(o) : null;
        if (!o || !b) return null;
        const s = o.scale;
        const sb = s ? { min: [b.min[0] * s.x, b.min[1] * s.y, b.min[2] * s.z], max: [b.max[0] * s.x, b.max[1] * s.y, b.max[2] * s.z] } : b;
        q.copy(o.q);
        return lowestOf(sb, q, tmp);
      },
      fileRow: (id) => w.heightRows.get(id) ?? null,
      // As the file stands now, the editor's own writes included (`HeightRows`), never only as it was last read.
      fileSize: () => ({ tiles: w.heightRows.size, bytes: w.heightRows.bytes }),
      deflate: (bytes) => deflateBase64(bytes),
      beginWork: () => w.beginGroundWork(),
      noteStamp: () => w.noteStamp(),
      say: (words, ok) => me.say(words, ok),
    };
  }
  /** What the water tool needs of the game: the world's lakes and its frames, its ground, its sea, the curtain, the props. */
  private waterHost(): WaterHost {
    const h = this.host;
    const w = h.world;
    const me = this;
    return {
      get edits() {
        return me.edits;
      },
      worldKind: () => h.worldKind(),
      rows: () => w.ourLakeRows,
      rivers: () => w.ourRiverRows,
      toRaw: (x, z, out) => {
        const s = w.terrain.swg;
        out.x = s ? s.toSwgX(x) : -x;
        out.z = s ? s.toSwgZ(z) : z;
      },
      toGame: (x, z, out) => {
        const s = w.terrain.swg;
        out.x = s ? s.toGameX(x) : -x;
        out.z = s ? s.toGameZ(z) : z;
      },
      groundAt: (x, z) => w.terrain.nearHeightIfCached(x, z) ?? w.terrain.heightAt(x, z),
      heightAt: (x, z) => w.terrain.heightAt(x, z),
      seaLevel: () => w.terrain.waterLevel,
      isLava: (shader) => w.lakeShaderIsLava(shader),
      wantsCurtain: (lava) => w.lakeWantsCurtain(lava),
      curtain: (detail, work) => h.lakeCurtain(detail, work),
      fallSource: async (thing) => {
        await h.props.load();
        const def = h.props.find(thing);
        const pack = h.props.pack;
        if (!def || !pack) return `${thing} is not in the props catalogue`;
        const b = pack.find(def.model)?.bounds;
        if (!b) return `${thing}'s model has no box`;
        return { src: { kind: 'prop', pack: 'props', thing: def.id, template: def.template }, bounds: b };
      },
      dest: () => this.session.dest,
      centre: () => w.placeFrame,
      frame: () => (w.planet?.space ? 'game' : 'raw'),
      packId: () => h.packId(),
      cameraYaw: () => this.fly.yaw,
      underNotes: () => w.rowsUnderLakes(h.standingRows().map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, rooms: s.row.kind === 'building' && (w.streamer?.placedHasRooms(placementKey(s.id)) ?? false) }))),
      say: (words, ok) => me.say(words, ok),
    };
  }

  /** What the places tool needs of the game: the locations file's rows as last landed, the world's frames, its ground. */
  private placesHost(): PlacesHost {
    const h = this.host;
    const w = h.world;
    const me = this;
    const none: readonly LocationRow[] = [];
    return {
      get edits() {
        return me.edits;
      },
      worldKind: () => h.worldKind(),
      rows: () => h.locationRows?.() ?? none,
      // The file's raw frame about the world's place frame: the layout's centre, or (0, 0) on a world with no pack.
      toRaw: (x, z, out) => {
        const c = w.placeFrame;
        out.x = (c?.x ?? 0) - x;
        out.z = z + (c?.z ?? 0);
      },
      toGame: (x, z, out) => {
        const c = w.placeFrame;
        out.x = (c?.x ?? 0) - x;
        out.z = z - (c?.z ?? 0);
      },
      groundAt: (x, z) => w.terrain.nearHeightIfCached(x, z) ?? w.terrain.heightAt(x, z),
      groundCached: (x, z, out) => {
        const g = w.terrain.nearHeightIfCached(x, z);
        if (g === null || g === undefined) return false;
        out.y = g;
        return true;
      },
      say: (words, ok) => me.say(words, ok),
    };
  }

  /** The Tools list (Map-maker II §2.3): one armed at a time, the scatter brush first. */
  readonly tools = new ToolList();
  /** What an armed tool is handed each frame and what it draws with, kept records. */
  private readonly toolStep = toolFrame();
  private readonly toolDraw: ToolDraw;
  /** The brush ring's ground and its ask, kept records. */
  private readonly ringGround: RingGround;
  private readonly ringAsk = ringAsk();
  /** An armed tool's buttons this frame, read in the key block (Fly's) or off the pointer (Point's): the left applies, the right the inverse. */
  private brushPaint = false;
  private brushErase = false;
  /** The left button pressed this frame with Shift held (Fly's, read in the key block): a tool's sample, which writes nothing. */
  private toolShiftPress = false;
  /** Ctrl held this frame (the key block's word): Point's brush buttons read as up too. */
  private ctrlHeld = false;
  /** Fly's mouse movement down the screen an armed tool took this frame with F held, and whether F is held (the key block's). */
  private toolDY = 0.5;
  private toolLift = false;
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
    // The sculpt brush's two rebuild numbers are the ground's own (`GROUND_REWRITE_TUNE`), whichever helper moved them.
    GROUND_REWRITE_TUNE.frameMs = Math.max(0, SCULPT_TUNE.frameMs);
    GROUND_REWRITE_TUNE.floraHz = Math.max(0.01, SCULPT_TUNE.floraHz);
    // And the paint brush's two (Map-maker II's second wave): its preview's share and a textured real-elevation world's wait.
    GROUND_REWRITE_TUNE.paintMs = Math.max(0, PAINT_TUNE.previewMs);
    GROUND_PAINT_TUNE.rasterWaitMs = Math.max(0, PAINT_TUNE.rasterWaitMs);
    const live = liveTuned(partial);
    if (live.speed) this.fly.speed = clampSpeed(EDITOR_TUNE.cam.speed);
    if (live.skyReach) this.skyReach = clampSky(EDITOR_TUNE.aim.skyReach);
    if (live.snap) {
      const s = EDITOR_TUNE.snap;
      this.edits.snapOn = s.on;
      if (s.grid > 0) this.edits.grid = s.grid;
      if (s.angle > 0) this.edits.angle = s.angle;
    }
    // The seventh wave's: a tint's strength moved is every tinted copy's colour worked out again (a uniform: nothing compiles),
    // the strength held to [0, 1]; the effect in hand shown again at a moved preview size.
    const o = partial && typeof partial === 'object' ? (partial as Record<string, unknown>) : null;
    const lk = o?.look && typeof o.look === 'object' ? (o.look as Record<string, unknown>) : null;
    if (lk && 'tintStrength' in lk) {
      LOOK_TUNE.tintStrength = Math.max(0, Math.min(1, LOOK_TUNE.tintStrength));
      this.host.world.rowLooks.retint();
    }
    const at = o?.attach && typeof o.attach === 'object' ? (o.attach as Record<string, unknown>) : null;
    if (at && 'preview' in at && this.hand?.attach?.fx) this.host.world.rowAttach.previewSet(this.hand.attach.fx, ATTACH_TUNE.preview);
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
    this.tools.disarmAll();
    this.marks.ringOn = false;
    this.marks.ring2On = false;
    this.edits.cancel(false);
    this.looks.letGo();
    this.marks.handlesOn = false;
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
    // A sculpt stroke under way is dropped unwritten (its world's store went with the world), then whatever tool is armed
    // is let go (a stroke under way ends unrecorded with its world's history, below).
    this.sculpt.worldGone();
    this.paint.worldGone();
    this.water.worldGone();
    this.places.worldGone();
    this.tools.disarmAll();
    // The wash's write still waiting for its dials to rest goes with its world, never into the next world's file.
    if (this.washTimer) clearTimeout(this.washTimer);
    this.washTimer = null;
    if (this.lakeLookTimer) clearTimeout(this.lakeLookTimer);
    this.lakeLookTimer = null;
    this.lakeLookOwed = {};
    this.marks.ringOn = false;
    this.marks.ring2On = false;
    // The palette's family list turned back to the next world's own (`paintView` also reads a browsed pack that is the
    // world's own as its own, for a travel made with the editor off, which reaches no `worldGone`).
    this.paintBrowse = '';
    // Its selection, its history and anything under way go with the world, on or off; so do the looks' picker and the
    // attachment picked by its handle (the seventh wave).
    this.edits.worldGone();
    this.looks.letGo();
    this.marks.handlesOn = false;
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
      // A tool's stroke ends: its buttons read as up while Ctrl is held (Point's too, `ctrlHeld`).
      this.brushPaint = false;
      this.brushErase = false;
      this.toolShiftPress = false;
      this.toolDY = 0;
      this.toolLift = false;
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
        // An armed tool takes Delete first (the water tool's picked lake), then the selection, then what is under the aim.
        else if (!(this.tools.armedTool?.deleteKey?.() ?? false) && !this.looks.deleteKey() && !this.edits.deleteKey()) this.deleteHovered();
      }
      // A click in Fly is the attack's button, read here and muted below; in Point the pointer layer has it.
      if (!this.session.point && input.pressedAction('attack') && this.hand) this.pendingClick = true;
      // The look picker's click in Fly (the seventh wave): the surface under the crosshair gives its look.
      if (!this.session.point && input.pressedAction('attack') && !this.hand && this.looks.picking) this.lookClick = this.lookRelease = true;
      // A tool's key arms it (any other let go first) or lets it go: B the scatter brush, with the library's chosen entries
      // (or what is in hand), K the sculpt brush (Map-maker II's first wave).
      for (const t of this.tools.list) if (t.action && input.pressedAction(t.action)) void this.toggleTool(t.id);
      // The editing keys (the hand on the selection, the gizmo's buttons, the nudges, the snaps, the hotbar, the eyedropper,
      // game view and the key sheet), read before the mutes take what they borrow; the frame's seconds in its kept clock.
      this.edits.clock.dt = dt;
      this.edits.keys(this.window?.library.typing ?? false);
      // The press that gave the look picker its surface in Fly is no click on the selection when it is let go, frames later
      // (the press is resolved as it comes; the editing reads a click off the release): quiet until the button is up.
      if (this.lookRelease) {
        this.edits.idle();
        if (this.session.point || !input.held('attack')) this.lookRelease = false;
      }
      // A picked attachment's hand (the seventh wave): R, F and C held with the mouse, the nudges. Nothing with rows picked.
      if (!this.hand && !(this.window?.library.typing ?? false) && !this.tools.armedTool) this.looks.keys();
    }
    // The speed: = and -, and the wheel in Fly (in Point the game drains it and the editor reads its own over the canvas).
    let notches = 0;
    if (input.pressedAction('noclipFaster')) notches++;
    if (input.pressedAction('noclipSlower')) notches--;
    const wheel = this.session.point ? this.pointer.wheel : input.wheel;
    if (this.session.point) input.wheel = 0;
    const armedTool = this.tools.armedTool;
    // F held for an armed tool that takes the mouse with it (the water tool raising a picked lake): the camera holds still.
    const liftHeld = !oldHand && input.held('placeLift');
    const toolMouse = !oldHand && !!armedTool?.holdsMouse?.(liftHeld);
    if (wheel) {
      // With a hand key held on the selection the wheel steps its grid (the angle, the grid, the scale step); never while a
      // tool is armed (the selection takes no hold then), when C held with the wheel sizes the tool that has a size, and F
      // held with it steps the tool's raise (the water tool's picked lake).
      if (this.edits.takesMouse && !armedTool) this.edits.wheelStep(-wheel);
      else if (armedTool?.size && input.held('editorScale')) {
        const said = armedTool.size(-wheel);
        if (said) this.say(said, true);
      } else if (armedTool?.wheel && liftHeld && armedTool.wheel(-wheel, true) !== null) {
        // Taken: the tool said so on its bar.
      } else if (this.hand && this.aimKind === 'sky') {
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
    // A hold, a drag of the gizmo or an orbit has the mouse: the camera holds still. So does a tool raising with F held,
    // which takes Fly's movement down the screen for itself (`toolDY`), spent here before the camera reads it.
    this.toolDY = 0;
    this.toolLift = liftHeld;
    if (toolMouse && !this.session.point) {
      this.toolDY = input.mouseDY;
      input.mouseDX = 0;
      input.mouseDY = 0;
    }
    a.look = !this.session.point && input.locked && !this.edits.takesMouse && !this.looks.takesMouse && !toolMouse;
    // An armed tool's buttons in Fly, read before the mutes take them: the attack's applies (paints, raises), the other
    // attack's the inverse (erases, lowers). Shift with a press of the left samples and writes nothing (the Shift rule).
    const toolOn = !!armedTool && !oldHand && !this.session.point;
    const shift = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    this.toolShiftPress = toolOn && shift && input.pressedAction('attack');
    this.brushPaint = toolOn && input.held('attack') && !(shift && armedTool?.id !== 'brush');
    this.brushErase = toolOn && input.held('altAttack');
    input.mute(editorMutes(oldHand));
    if (!oldHand) input.mute(TAKEN);
  }

  /**
   * A tool's key (B the scatter brush, K the sculpt brush): armed, any other let go first (`ToolList.arm`), or let go.
   * Armed, the hand is given up and an edit under way given up: its buttons are its own. What is picked stays picked and
   * takes its holds again once the tool is put down (Map-maker II §2.3; the scatter brush let the selection go as it armed
   * before the list, which the design's rule overturns). Answers what was said.
   */
  async toggleTool(id: string): Promise<string> {
    const t = this.tools.byId(id);
    if (!t) return `no tool called ${id}`;
    if (t.armed()) {
      t.disarm();
      const words = `${t.label} let go`;
      this.say(words, true);
      this.window?.refreshEdits();
      return words;
    }
    const said = await this.tools.arm(id);
    if (t.armed()) {
      this.giveUpHand();
      this.edits.cancel(false);
      this.window?.refreshEdits();
      this.window?.library.render();
    }
    return said;
  }

  /** B: the scatter brush armed with the library's chosen entries (or, with none chosen, the thing in hand), or let go. */
  toggleBrush(): Promise<string> {
    return this.toggleTool('brush');
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
    if (looked || this.host.input.keysDown > 0 || this.pointer.buttons !== 0 || this.fly.moving > 0.05 || ed.busy || ed.writing || ed.stroking || this.hand || this.brush.mode || this.sculpt.mode || this.paint.mode || this.water.busy || this.places.busy || this.folding) {
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
    // A tool armed (the scatter brush, the sculpt brush): let go, a stroke under way ended as its button let go would; a tool
    // with something of its own under way (the water tool's draft, its picked lake) gives that up first.
    const armed = this.tools.armedTool;
    if (armed?.escape?.()) {
      this.window?.refreshEdits();
      return true;
    }
    if (armed) {
      this.tools.disarmAll();
      this.say(`${armed.label} let go`, true);
      this.window?.refreshEdits();
      return true;
    }
    // A hold or a drag under way: given up, the rows put back where their files have them, nothing written.
    if (this.edits.cancel()) return true;
    // The look picker armed, or an attachment picked by its handle (the seventh wave): let go.
    if (this.looks.letGo()) {
      this.window?.refreshEdits();
      return true;
    }
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
    // With a tool armed a click is the tool's: it never takes the mouse back to Fly.
    if (this.hand || this.tools.toolArmed() || !this.pointer.clicked) return;
    if (this.aim.hover || this.edits.handleHot || this.looks.hover >= 0 || this.looks.picking || this.looks.attachSel || !this.edits.clickGoesToFly()) return;
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
    // The armed tool: Fly's buttons were read in the key block; Point's are the pointer's over the canvas (left 1, right 4).
    const tool = this.tools.armedTool;
    if (tool) {
      const f = this.toolStep;
      const point = this.session.point;
      const pb = point && this.pointer.over && !hand && !this.ctrlHeld ? this.pointer.buttons : 0;
      const shift = this.host.input.isDown('ShiftLeft') || this.host.input.isDown('ShiftRight');
      // Shift with a press of the left samples and writes nothing (every brush but the scatter brush, which was built without it).
      const sampleOn = tool.id !== 'brush';
      f.shift = shift;
      f.sampled = sampleOn && (point ? shift && (this.pointer.pressed & 1) !== 0 && pb !== 0 : this.toolShiftPress);
      f.apply = point ? (pb & 1) !== 0 && !(sampleOn && shift) : this.brushPaint;
      f.inverse = point ? (pb & 4) !== 0 : this.brushErase;
      f.x = hit.x;
      f.y = hit.y;
      f.z = hit.z;
      f.valid = kind !== 'sky';
      f.dt = dt;
      f.now = now;
      // The cursor on the screen (Point's pointer, Fly's middle), Fly's movement a tool took with F held, and F.
      f.sx = point ? this.pointer.x : w / 2;
      f.sy = point ? this.pointer.y : hh / 2;
      f.dy = point ? 0 : this.toolDY;
      f.lift = this.toolLift && !this.ctrlHeld;
      tool.step(f);
    }
    // What happened this frame, for the automatic fold's quiet (`EDITOR_TUNE.autoFoldIdle`).
    this.noteActivity(now);
    // The ghost where it would stand.
    let inRoom = false;
    if (hand?.attach) {
      // An effect or a sound in hand (the seventh wave): no ghost and no notes; an effect shown where the aim meets the world.
      this.ghostPos.set(hit.x, hit.y + ATTACH_TUNE.lift, hit.z);
      this.ghostM.makeTranslation(this.ghostPos.x, this.ghostPos.y, this.ghostPos.z);
      h.world.rowAttach.previewMove(this.ghostM);
    } else if (hand) {
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
    // The look picker's click (the seventh wave): the surface under the aim gives the picked rows its picture or material, and
    // the editing hears no click this frame (it would pick the row clicked on).
    const lookClick = !hand && !!this.looks.picking && (this.lookClick || (this.session.point && this.pointer.clicked && this.pointer.over));
    this.lookClick = false;
    if (lookClick) {
      this.edits.idle();
      if (this.session.point) this.pointer.clicked = false;
      void this.looks.pickFrom(this.surfaceAt(this.eye, this.dir, kind === 'sky' ? this.skyReach : this.aim.answer.t + 1));
    }
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
    // The armed tool's rings on the ground round the aim, armed and over something (game view hides them with the rest).
    m.ringOn = false;
    m.ring2On = false;
    m.ringErase = false;
    if (tool && tool.armed() && kind !== 'sky') {
      const ra = this.ringAsk;
      ra.cx = hit.x;
      ra.cy = hit.y;
      ra.cz = hit.z;
      ra.w = w;
      ra.h = hh;
      tool.draw(this.toolDraw);
    }
    this.edits.clock.now = now;
    // The attachments' handles (the seventh wave) laid out from this frame's view first, so the editing's click below reads
    // the handle under the cursor now (a mark's picks the mark; a hung attachment's picks no row).
    const lc = this.lookCur;
    lc.x = this.session.point ? this.pointer.x : w / 2;
    lc.y = this.session.point ? this.pointer.y : hh / 2;
    this.looks.frame(sv, lc, m);
    this.edits.frame(m);
    // A click on a hung attachment's handle picks it; a click anywhere else lets a picked one go.
    if (this.edits.clickedNow) {
      if (this.looks.hoveredAttachment()) this.looks.click();
      else if (this.looks.attachSel) {
        this.looks.attachSel = null;
        this.window?.refreshEdits();
      }
    }
    // An armed tool's own marks every frame, after the editing's (the water tool's lakes, and its picked lake's square in
    // place of the selection's gizmo), from this frame's view; none with no such tool armed.
    m.lakesOn = false;
    m.draftOn = false;
    if (tool && tool.armed() && tool.overlay) tool.overlay(this.toolDraw, sv);
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
    // An effect or a sound (the seventh wave) goes in hand with no model; with the look picker armed, a model's entry offers
    // its materials to choose from on the Selected tab and nothing goes in hand.
    if (!base && isAttachEntry(e)) return this.takeAttachment(e);
    if (!base && this.looks.picking) {
      const got = await this.sourceOf(e);
      if (typeof got === 'string') return this.refuse(got);
      const said = await this.looks.offerEntry(entryName(e), got.pack, packIdOfRoot(got.pack.root), got.model);
      if (said) this.say(said, true);
      return null;
    }
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
    // What was in hand before goes back first (a row picked up stands again), and any tool is let go: its buttons are the hand's now.
    this.giveUpHand();
    this.tools.disarmAll();
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
    // A row picked up wears its looks in hand (the seventh wave): its donors loaded, its copies held for the hand's own owner.
    const look = base ? stream.lookOf(base.row.mats) : undefined;
    let owner: object | undefined;
    if (look) {
      await stream.loadLook(look);
      if (gen !== this.takeGen || !this.session.on || h.world.streamer !== stream || !this.hand) return null;
      owner = {};
      this.hand.lookOwner = owner;
    }
    this.ghost.set(this.hand.key, stream.ghostMeshesOf(model, look, owner));
    this.notesAt = -Infinity;
    this.say(`in hand: ${this.hand.name}`, true);
    return null;
  }

  /**
   * An effect or a sound out of the library taken in hand (the seventh wave): no model and no ghost. A click hangs it on the
   * row of the files the aim meets (with "attach to what it lands on" on) or stands it as a mark of its own; an effect is
   * shown at the aim at `ATTACH_TUNE.preview` of its size.
   */
  private takeAttachment(e: LibraryEntry): string | null {
    const a = attachOfEntry(e);
    if (!a) return this.refuse(`${entryName(e)} is no effect or sound`);
    this.giveUpHand();
    this.tools.disarmAll();
    const attach: RowAttach = 'fx' in a ? { fx: a.fx } : { snd: a.snd };
    if (attach.fx && ATTACH_TUNE.size !== 1) attach.size = ATTACH_TUNE.size;
    this.hand = {
      key: entryKey(e),
      name: entryName(e),
      src: { kind: 'prop', pack: 'props' },
      bounds: null,
      patch: null,
      building: false,
      passable: true,
      q: new THREE.Quaternion(),
      yaw: this.fly.yaw,
      scale: new THREE.Vector3(1, 1, 1),
      sBounds: null,
      base: null,
      liftedLayer: null,
      attach,
    };
    if (attach.fx) this.host.world.rowAttach.previewSet(attach.fx, ATTACH_TUNE.preview);
    this.notes.length = 0;
    this.warn = false;
    this.say(`in hand: ${this.hand.name}: a click ${this.attachOnto ? 'hangs it on the row the aim meets, else stands it as a mark' : 'stands it as a mark'}`, true);
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
    // The effect shown at the aim, and the copies the ghost of a row picked up wore (the seventh wave), let go.
    if (hand?.attach) this.host.world.rowAttach.previewClear();
    if (hand?.lookOwner) this.host.world.streamer?.releaseLook(hand.lookOwner);
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
    if (hand.attach) return this.placeAttachment(hand, hand.attach, at);
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
    // A new building with the Tools tab's "Furnish the buildings I place" off is written empty (`furnish: false`).
    const src = hand.building && !EDITOR_TUNE.furnish ? { ...hand.src, furnish: false as const } : hand.src;
    const row = rowFromEditor(src, pos, [hand.q.x, hand.q.y, hand.q.z, hand.q.w], inside, frame, space ? 'game' : 'raw', {
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
    // What the ghost left behind wears its looks' copies until the row it put down is built: held for an owner of its own.
    const leftOwner = hand.lookOwner && left.length ? {} : null;
    if (leftOwner && hand.lookOwner) h.world.streamer?.shareLook(hand.lookOwner, leftOwner);
    const leftStream = h.world.streamer;
    this.writing = true;
    let reply;
    const asked = performance.now();
    try {
      reply = await h.put(row, dest, lifted);
    } finally {
      this.writing = false;
    }
    this.writeMs = performance.now() - asked;
    const dropLeft = (): void => {
      this.ghost.dropLeft(left);
      if (leftOwner) leftStream?.releaseLook(leftOwner);
    };
    void reply.built.then(dropLeft, dropLeft);
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
      if (hand.lookOwner) h.world.streamer?.releaseLook(hand.lookOwner);
    }
    this.window?.refreshHere();
    return `put down ${reply.id}`;
  }

  /**
   * An effect or a sound in hand put down (the seventh wave): hung on the row of the files under the aim (a mark under the
   * cursor first, then the row the aim rests on) where "attach to what it lands on" is on, at the hit in that row's own
   * model frame, one write of the row put again; else stood as a mark of its own where the aim meets the world, one write
   * of a new row. Either is one undo entry; the hand keeps it for the next click.
   */
  private async placeAttachment(hand: Hand, a: RowAttach, at?: { x: number; y: number; z: number }): Promise<string> {
    const h = this.host;
    const w = h.world;
    const space = !!w.planet?.space;
    const frame = space ? 'game' : 'raw';
    const hit = at ?? this.aim.hit;
    if (!at && this.aimKind === 'sky') return this.refuse('aim at something to hang it on, or at the ground for a mark');
    // The row under the aim: one whose attachment's handle the cursor rests on first (a second effect on a row already
    // carrying one lands on the handle of the first), else the row the aim rests on.
    const id = this.attachOnto && !at ? (this.looks.hovered()?.id ?? this.hoveredId()) : null;
    const onto = id ? h.rowFor(id) : null;
    let said: string;
    if (onto) {
      const g = placementToGame(onto.row, w.placeFrame, frame);
      rowMatrix(onto.row, g, this.attachBase);
      const hung: RowAttach = { ...a };
      const p = attachAtHit(this.attachBase, hit, ATTACH_TUNE.lift);
      if (p[0] || p[1] || p[2]) hung.at = p;
      const next = withAttachment(onto.row, hung);
      if (typeof next === 'string') return this.refuse(next);
      said = await this.edits.putRows(a.fx ? 'hang an effect' : 'hang a sound', [{ file: onto.layer, id: onto.row.id, before: onto.row, after: next }]);
      if (/ written$/.test(said)) this.say((said = `${hand.name} hung on ${onto.label}`), true);
    } else {
      const stream = w.streamer;
      let inside = false;
      this.tmp.set(hit.x, hit.y + ATTACH_TUNE.lift, hit.z);
      if (stream) {
        stream.cameraRoomAt(this.tmp, this.hitRoom, floorUnder);
        inside = !!this.hitRoom.building;
      }
      const ground = space || inside ? null : w.terrain.heightAt(this.tmp.x, this.tmp.z);
      const row = markRow([a], this.tmp, w.placeFrame, frame, inside, Number.isFinite(ground ?? Number.NaN) ? ground : null);
      const [mid] = this.edits.mintIds(['mark']);
      const dest = this.session.dest;
      said = await this.edits.putRows('stand a mark', [{ file: dest, id: mid, before: null, after: { ...row, id: mid } as PlacementRow }]);
      if (/ written$/.test(said)) this.say((said = `${hand.name} stood as mark ${mid}`), true);
    }
    if (hand.key) this.keep.noteUsed(hand.key);
    this.window?.refreshHere();
    return said;
  }
  /** A row's matrix, read for a hang (kept: a click's work, never a frame's). */
  private readonly attachBase = new THREE.Matrix4();
  private raycaster: THREE.Raycaster | null = null;

  /**
   * The material of the nearest drawn surface along a ray within `far` (the look picker's click: a click's work, never a
   * frame's): the world's pass, a building's rooms and the actors, each piece only where it and everything above it is shown
   * and its material is drawn (the window openings' invisible walls are not surfaces). Null for none.
   */
  private surfaceAt(eye: THREE.Vector3, dir: THREE.Vector3, far: number): THREE.Material | null {
    const rc = (this.raycaster ??= new THREE.Raycaster());
    rc.set(eye, dir);
    rc.near = 0;
    rc.far = Number.isFinite(far) && far > 0 ? far : 1000;
    rc.camera = this.host.cam.camera;
    rc.layers.set(0);
    rc.layers.enable(INTERIOR_LAYER);
    rc.layers.enable(ACTOR_LAYER);
    // Meshes shown now alone (a sprite, a point cloud and a line are no surface, and a sprite cannot be cast against without
    // the camera); a click's work, never a frame's.
    const meshes: THREE.Object3D[] = [];
    this.host.world.scene.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o);
    });
    let hits: THREE.Intersection[] = [];
    try {
      hits = rc.intersectObjects(meshes, false);
    } catch (err) {
      console.warn('the look picker could not cast into the scene', err);
      return null;
    }
    for (const hit of hits) {
      const mesh = hit.object as THREE.Mesh;
      const raw = mesh.material;
      const mat = Array.isArray(raw) ? raw[hit.face?.materialIndex ?? 0] : raw;
      if (!mat || mat.userData?.invisible || !mat.visible) continue;
      return mat;
    }
    return null;
  }

  /** The permanent row the aim rests on, by id, or null; a mark whose handle the cursor rests on first (the seventh wave). */
  private hoveredId(): string | null {
    const mark = this.looks.hoveredMark();
    if (mark) return mark;
    // A handle of an attachment hung on a row: the click picks that attachment, never the row behind it.
    if (this.looks.hoveredAttachment()) return null;
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
    if (pieceOfId(id)) return void this.say(PIECE_FIRST, false);
    void this.pickUp(id);
  }

  /**
   * Whether an id the selection was asked to take is a piece of a furnished building's template furniture (`<id>.f<n>`, the
   * interior layout files' wave): if so the building's furniture is made its own (`ownPiece`) and the row the piece became
   * picked once written, and the selection takes nothing now. What a click, the Here tab and the console's `select` ask.
   */
  ownPieceAsked(id: string, shift: boolean): boolean {
    const p = pieceOfId(id);
    if (!p) return false;
    void this.ownPiece(p.building, p.index, shift ? 'add' : 'set').then(() => this.window?.refreshEdits());
    return true;
  }

  /** A make-own under way: one at a time. */
  private owning = false;

  /**
   * A furnished building row's template furniture made its own (the owner's words of 2026-11-01: "if I edit the furniture in
   * one place it won't affect other copies or spawns of that same building"): one action writing every piece as an ordinary
   * row of the building's file standing in its room, and the building's row `furnish: false`, so one undo puts the file's
   * furniture back; behind the editor's curtain where a piece's row would stand out of a model not yet loaded. Then the row
   * piece `index` became is picked (`mode`). Every other copy of the building, and every one put down after, keeps the
   * file's furniture. Answers what was said.
   */
  async ownPiece(buildingId: string, index: number, mode: 'set' | 'add' = 'set'): Promise<string> {
    const h = this.host;
    if (this.owning || this.writing) return this.refuse('a write is still going');
    const b = h.rowFor(buildingId);
    if (!b || b.row.kind !== 'building') return this.refuse(`${buildingId} is no building of the files`);
    // A piece of the props folder is written as the props catalogue's thing: the catalogue in hand first.
    await h.props.load().catch(() => null);
    const got = h.ownFurniture?.(buildingId);
    if (!got) return this.refuse('this game cannot make a building\'s furniture its own');
    if (typeof got === 'string') return this.refuse(got);
    const ids = this.edits.mintIds(got.rows.map((r) => r.base));
    const { at: _at, ...rest } = b.row;
    const changes: RowChange[] = [
      { file: b.layer, id: b.row.id, before: b.row, after: { ...rest, furnish: false } as PlacementRow },
      ...got.rows.map((r, i): RowChange => ({ file: b.layer, id: ids[i], before: null, after: { ...r.row, id: ids[i] } as PlacementRow })),
    ];
    this.owning = true;
    let said: string;
    try {
      const work = () => this.edits.putRows('make its furniture its own', changes);
      said = got.fresh && h.curtain ? await h.curtain(`${b.label}'s furniture as rows of its own`, work) : await work();
    } finally {
      this.owning = false;
    }
    if (!/ written$/.test(said)) return this.refuse(said);
    const i = got.rows.findIndex((r) => r.index === index);
    if (i >= 0) this.edits.sel.pick([ids[i]], mode);
    const words = `${b.label}'s furniture is its own now: ${got.rows.length} row${got.rows.length === 1 ? '' : 's'} in its rooms, which no other copy shares (one undo puts the file's furniture back)`;
    this.say(words, true);
    return words;
  }

  /** A row by id into the hand. Answers why not. */
  async pickUp(id: string): Promise<string | null> {
    const h = this.host;
    if (pieceOfId(id)) return this.refuse(PIECE_FIRST);
    // A mark has no model to hold (the seventh wave): it is picked by its handle and moved with the gizmo, the hold or the nudges.
    if (h.rowFor(id)?.row.kind === 'mark') return this.refuse(`${id} is a mark: click its handle and move it with the gizmo, R and F held or the arrows`);
    // A building whose furniture is its own rows (the interior layout files' wave): the hand holds one row, and its rows
    // would be left standing where it stood with nothing round them. The gizmo, the holds and the arrows carry them.
    const carried = this.edits.carries(id);
    if (carried > 0) return this.refuse(`${id}'s furniture is ${carried} row${carried === 1 ? '' : 's'} of its own in its rooms, which the hand would leave behind: pick it and move it with the gizmo, R and F held or the arrows, which carry them`);
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
    if (pieceOfId(id)) return void this.say(PIECE_FIRST, false);
    const s = this.host.stood(id);
    if (!s) return;
    void this.remove(id, s.layer);
  }

  async remove(id: string, layer: PlacementLayer): Promise<string> {
    if (pieceOfId(id)) return this.refuse(PIECE_FIRST);
    // A building whose furniture is its own takes its rows out with it, one action and one undo, as the selection's Delete
    // does (asking once past `askAbove`, a second press within three seconds): taken out alone it left them standing.
    if (this.edits.carries(id) > 0) {
      const said = await this.edits.deleteRows([id], false);
      this.lastWrite = said;
      this.window?.refreshHere();
      return said;
    }
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
    const tool = this.tools.armedTool;
    const onto = this.hand?.attach && this.attachOnto ? (this.looks.hovered()?.id ?? this.hoveredId()) : null;
    const ontoLabel = onto ? this.host.rowFor(onto)?.label : null;
    const looks = this.looks;
    v.hand = this.hand?.attach
      ? `in hand: ${this.hand.name}: ${ontoLabel ? `hangs on ${ontoLabel}` : 'stands a mark where it lands'}`
      : this.hand
        ? `in hand: ${this.hand.name}${hs && (hs.x !== 1 || hs.y !== 1 || hs.z !== 1) ? ` (scale ${hs.x === hs.y && hs.y === hs.z ? hs.x : `${hs.x} ${hs.y} ${hs.z}`})` : ''}${this.ghost.shown || !this.hand.bounds ? '' : ' (preparing)'}`
        : tool
          ? (tool.barWords?.() ?? tool.label)
          : looks.picking
            ? `taking a ${looks.picking.take === 'texture' ? 'picture' : 'material'} for ${looks.picking.of}: click a surface or choose a library entry (Escape lets go)`
            : looks.attachSel
              ? `attachment ${looks.attachSel.i + 1} of ${this.host.rowFor(looks.attachSel.id)?.label ?? looks.attachSel.id}: ${capOf(input.bindings.placeTurn[0])}/${capOf(input.bindings.placeLift[0])}/${capOf(input.bindings.editorScale[0])} held turn/raise/size · arrows nudge · ${capOf(input.bindings.putAway[0])} takes it off`
              : 'nothing in hand';
    v.dest = `→ ${destinationFile(s.dest, this.host.packId())}`;
    v.room = roomWords(this.host.world.cameraRoom);
    v.notes = this.hand ? notesLine(this.notes) : '';
    v.said = this.said;
    v.saidOk = this.saidOk;
    const k = (a: Parameters<Input['pressedAction']>[0]) => input.bindings[a][0] ?? '';
    v.hint = `WASD fly · ${k('editorUp')}/${k('editorDown')} up/down · Shift fast · Alt slow · wheel speed · ${k('editorPoint')} cursor · ${k('editorSearch')} find · click pick/put down · ${k('placeTurn')}/${k('placeLift')}/${k('editorScale')} held turn/raise/scale · ${k('takeProp')} pick up · ${k('putAway')} delete · ${k('placeLayer')} file · ${k('editorBrush')} brush · ${k('editorSculpt')} sculpt · ${k('editorPaint')} paint · ${k('editorWater')} water · ${k('editorPlaces')} places · ${k('editorKeys')} keys · F2 leave`;
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
      // The lakes of ours first (a world has few), then the rows round the camera (Map-maker II's fifth wave).
      // The places of ours (Map-maker II's eighth wave), then the lakes of ours (a world has few), then the rows round the
      // camera (Map-maker II's fifth wave).
      here: () => [...this.placeHereRows(), ...this.lakeHereRows(), ...h.here(h.player.pos, 60)],
      goTo: (id: string) => this.say(isPlaceRow(id) ? this.goToPlace(id.slice(PLACE_ROW.length)) : isLakeRow(id) ? this.goToLake(id.slice(LAKE_ROW.length)) : this.goTo(id), true),
      pickUp: (id: string) => {
        if (isPlaceRow(id)) void this.pickPlace(id.slice(PLACE_ROW.length));
        else if (isLakeRow(id)) void this.pickLake(id.slice(LAKE_ROW.length));
        else void this.pickUp(id);
      },
      remove: (id: string, layer: string) => {
        if (isPlaceRow(id)) void this.places.remove(id.slice(PLACE_ROW.length)).then(() => this.window?.refreshEdits());
        else if (isLakeRow(id)) void this.water.remove(id.slice(LAKE_ROW.length)).then(() => this.window?.refreshEdits());
        else void this.remove(id, layer === 'story' ? 'story' : 'world');
      },
      isPicked: (id: string) => (isPlaceRow(id) ? this.places.picked === id.slice(PLACE_ROW.length) : isLakeRow(id) ? this.water.picked === id.slice(LAKE_ROW.length) : this.edits.sel.has(id)),
      pick: (ids: string[], mode: 'set' | 'add' | 'take') => {
        // A piece of a building's template furniture (the Here tab lists them): its building's furniture made its own first.
        const piece = mode === 'take' ? undefined : ids.find((i) => pieceOfId(i));
        if (piece) {
          this.ownPieceAsked(piece, mode === 'add');
          return;
        }
        const lakes = ids.filter(isLakeRow);
        if (lakes.length) this.water.picked = mode === 'take' ? null : lakes[lakes.length - 1].slice(LAKE_ROW.length);
        const places = ids.filter(isPlaceRow);
        if (places.length) this.places.picked = mode === 'take' ? null : places[places.length - 1].slice(PLACE_ROW.length);
        this.edits.sel.pick(ids.filter((i) => !isLakeRow(i) && !isPlaceRow(i)), mode);
        this.window?.refreshEdits();
      },
      place: () => this.placeView(),
      setPlaceRow: (f: Record<string, unknown>) => {
        const id = this.places.picked;
        if (!id) return;
        if (f.copy === true) return void this.copyPlaceSnippet(id);
        void this.places.setPlace(id, f as Parameters<EditorPlaces['setPlace']>[1]).then(() => this.window?.refreshEdits());
      },
      lake: () => this.lakeView(),
      setLake: (f: Record<string, unknown>) => {
        const id = this.water.picked;
        if (!id) return;
        void this.water.setLake(id, f as { name?: string | null; shader?: string | null; look?: Record<string, unknown>; width?: number; velocity?: number; fallFrom?: number | null }).then(() => this.window?.refreshEdits());
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
        list: this.tools.report((a) => capOf(this.host.input.bindings[a][0])),
        brush: {
          armed: this.brush.armed,
          entries: [...this.brush.set].map(([key, weight]) => {
            const e = this.libView?.byKey.get(key);
            return { key, name: e ? entryName(e) : key, weight };
          }),
          switches: BRUSH_SWITCHES.map(([key, words]) => ({ key, words, on: BRUSH_TUNE[key] })),
        },
        sculpt: this.sculptView(),
        paint: this.paintView(),
        water: this.waterView(),
        places: this.placesView(),
        attach: { onto: this.attachOnto },
        // The interior layout files' wave: whether a building put down stands its template's furniture.
        furnish: EDITOR_TUNE.furnish,
      }),
      setTool: (t: Record<string, unknown>) => this.setTool(t),
      refreshStatus: () => void this.edits.refreshStatus(),
      dialSet: () => editorDialsFor('editor') as DialSet,
      // The seventh wave's looks and attachments on the Selected tab.
      look: (act: 'tint' | 'texture' | 'material' | 'clear' | 'choose', of: string, value?: string) => void this.lookAct(act, of, value),
      lookPalettes: () => this.lookPalettes(),
      attachment: (act: 'pick' | 'at' | 'size' | 'remove', i: number, value?: string) => void this.attachmentAct(act, i, value),
    };
  }

  /** A look act from the Selected tab (every picked row): a tint set or taken off, the picker armed, an offered material chosen, a look cleared. */
  private async lookAct(act: 'tint' | 'texture' | 'material' | 'clear' | 'choose', of: string, value?: string): Promise<void> {
    const l = this.looks;
    let said = '';
    if (act === 'tint') said = await l.setLook(of, { tint: value ? value : null }, value ? 'tint' : 'take a tint off');
    else if (act === 'clear') said = await l.setLook(of, { tint: null, map: null, like: null }, 'clear a look');
    else if (act === 'texture' || act === 'material') said = l.armPick(of, act);
    else if (act === 'choose' && value) said = await l.choose(value);
    if (said) this.say(said, !/refus|not|first|cannot|would/.test(said));
    this.window?.refreshEdits();
  }

  /** The tint picker's palettes, read once a session: the wardrobe's garment palettes and the creator's table. */
  private lookPaletteRead: Promise<import('../ui/editorWindow.ts').LookPickerSource | null> | null = null;
  private lookPalettes(): Promise<import('../ui/editorWindow.ts').LookPickerSource | null> {
    const read = this.host.pickerPalettes;
    if (!read) return Promise.resolve(null);
    this.lookPaletteRead ??= (async () => {
      const { garmentPalettes, creatorPalettes, allGarmentColours } = await import('../ui/dyePicker.ts');
      const { wardrobe, table } = await read();
      const garments = garmentPalettes(wardrobe);
      const creator = creatorPalettes(table as Parameters<typeof creatorPalettes>[0], wardrobe);
      return { garments, creator, eyes: [], all: wardrobe ? allGarmentColours(garments, wardrobe) : [] };
    })().catch(() => null);
    return this.lookPaletteRead;
  }

  /** An attachment act from the Selected tab, on the first picked row: picked, moved to a place, sized, or taken off. */
  private async attachmentAct(act: 'pick' | 'at' | 'size' | 'remove', i: number, value?: string): Promise<void> {
    const id = this.edits.sel.first ?? this.looks.attachSel?.id ?? null;
    if (!id) return;
    const l = this.looks;
    let said = '';
    if (act === 'pick') {
      l.pickAttachment(id, i);
      this.edits.sel.clear();
      said = `attachment ${i + 1} picked: R, F or C held with the mouse turns, raises or sizes it; the arrows nudge it; Delete takes it off`;
    } else if (act === 'remove') said = await l.removeAttachment(id, i);
    else {
      const a = this.host.rowFor(id)?.row.attach?.[i];
      if (!a) return;
      if (act === 'at') {
        const p = (value ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
        if (p.length !== 3 || !p.every(Number.isFinite)) return void this.say('a place is three numbers: x y z in its model\'s frame', false);
        const was = a.at ?? [0, 0, 0];
        said = await l.moveAttachment(id, i, { dx: p[0] - was[0], dy: p[1] - was[1], dz: p[2] - was[2] }, 'place an attachment');
      } else {
        const n = Number(value);
        if (!(n > 0)) return void this.say('a size is a number above nought', false);
        said = await l.moveAttachment(id, i, { size: n / (a.size ?? 1) }, 'size an attachment');
      }
    }
    if (said) this.say(said, !/refus|not|first|cannot/.test(said));
    this.window?.refreshEdits();
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
    // The Tools list's own buttons: a tool armed (any other let go first) or let go.
    if (typeof t.tool === 'string') void this.toggleTool(t.tool).then(() => this.window?.refreshEdits());
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
    // The interior layout files' wave: whether a building put down from now on stands its template's furniture (live: what
    // stands already keeps its own row's word, which the Selected tab's Furnished turns).
    if (typeof t.furnish === 'boolean' && t.furnish !== EDITOR_TUNE.furnish) {
      EDITOR_TUNE.furnish = t.furnish;
      this.say(t.furnish ? 'a building put down stands its own furniture, as the client stood it' : 'a building put down from now on stands empty (furnish: false on its row)', true);
    }
    // The seventh wave's: whether an effect or a sound put down hangs on the row the aim meets.
    if (typeof t.attachOnto === 'boolean') {
      this.attachOnto = t.attachOnto;
      this.say(t.attachOnto ? 'an effect or a sound put down hangs on the row the aim meets (else stands a mark)' : 'an effect or a sound put down stands as a mark of its own', true);
    }
    // The water tool's (Map-maker II's fifth wave): what a click does, where a level comes from, a typed level, the draft
    // closed or given up, the lake picked let go or taken out.
    const wt: Record<string, unknown> = {};
    if (typeof t.waterMode === 'string') wt.mode = t.waterMode;
    if (typeof t.waterLevelFrom === 'string') wt.levelFrom = t.waterLevelFrom;
    // The sixth wave's: where a river's points stand, what a steep reach becomes (`RIVER_TUNE.steep`, which makes every
    // river again), and the river under way written.
    if (typeof t.waterRiverHeights === 'string') wt.riverHeights = t.waterRiverHeights;
    if (typeof t.riverSteep === 'string' && (RIVER_STEEP as readonly string[]).includes(t.riverSteep) && t.riverSteep !== RIVER_TUNE.steep) {
      RIVER_TUNE.steep = t.riverSteep as typeof RIVER_TUNE.steep;
      this.say(`a river's reach past ${RIVER_TUNE.slopeMax}° is now ${RIVER_TUNE.steep === 'effects' ? "water with the game's fall effects" : RIVER_TUNE.steep === 'fall' ? 'a fall (not water; the tool writes a fall row with a river)' : 'not water ("a fall goes here")'}: ${this.host.world.retuneRivers('shape')}`, true);
    }
    if (t.waterRiverFinish === true) void this.water.finishRiver().then(() => this.window?.refreshEdits());
    if (typeof t.waterHeight === 'number' && Number.isFinite(t.waterHeight)) {
      wt.height = t.waterHeight;
      wt.levelFrom = 'typed';
    }
    if (Object.keys(wt).length) {
      const no = tuneWater(wt);
      if (no.length) this.say(no.join('; '), false);
    }
    if (t.waterClose === true) void this.water.closeDraft().then(() => this.window?.refreshEdits());
    if (t.waterGiveUp === true) this.water.escape();
    if (t.waterPick === null) this.water.picked = null;
    if (typeof t.waterRemove === 'string') void this.water.remove(t.waterRemove).then(() => this.window?.refreshEdits());
    // The places tool's (Map-maker II's eighth wave): what a click draws, the kind a new place is written as, a circle's
    // radius, the outline closed or given up, the place picked let go or taken out, and the world row's switch and lines.
    const pt: Record<string, unknown> = {};
    if (typeof t.placesMode === 'string') pt.mode = t.placesMode;
    if (typeof t.placesKind === 'string') pt.kind = t.placesKind;
    if (typeof t.placesRadius === 'number' && Number.isFinite(t.placesRadius)) pt.radius = t.placesRadius;
    if (Object.keys(pt).length) {
      const no = tunePlacesTool(pt);
      if (no.length) this.say(no.join('; '), false);
    }
    if (t.placesClose === true) void this.places.closeDraft().then(() => this.window?.refreshEdits());
    if (t.placesGiveUp === true) this.places.escape();
    if (t.placesPick === null) this.places.picked = null;
    if (typeof t.placesRemove === 'string') void this.places.remove(t.placesRemove).then(() => this.window?.refreshEdits());
    if (typeof t.placesCities === 'boolean') void this.places.setWorld({ cities: t.placesCities }).then(() => this.window?.refreshEdits());
    if (typeof t.placesWorldLoading === 'string') void this.places.setWorld({ loading: t.placesWorldLoading.split('\n') }).then(() => this.window?.refreshEdits());
    // The world row's own sky (the ninth wave), as one box of JSON standing for the whole of it.
    if (typeof t.placesWorldSky === 'string') {
      const sky = wholeSkyOf(t.placesWorldSky);
      if (typeof sky === 'string') this.say(sky, false);
      else void this.places.setWorld({ sky, skyWhole: true }).then(() => this.window?.refreshEdits());
    }
    // The sculpt brush's (Map-maker II's first wave): its mode, flatten's ways and target and height, its falloff, its switches.
    const st: Record<string, unknown> = {};
    if (typeof t.sculptMode === 'string') st.mode = t.sculptMode;
    if (typeof t.sculptFlat === 'string') st.flatMode = t.sculptFlat;
    if (typeof t.sculptTarget === 'string') st.target = t.sculptTarget;
    if (typeof t.sculptFalloff === 'string') st.falloff = t.sculptFalloff;
    if (typeof t.sculptHeight === 'number' && Number.isFinite(t.sculptHeight)) {
      st.height = t.sculptHeight;
      st.target = 'typed';
    }
    const ss = t.sculptSwitch;
    if (Array.isArray(ss) && typeof ss[1] === 'boolean' && SCULPT_SWITCHES.some(([key]) => key === ss[0])) st[ss[0] as string] = ss[1];
    if (Object.keys(st).length) {
      const no = tuneSculpt(st, GROUND_REWRITE_TUNE);
      if (no.length) this.say(no.join('; '), false);
    }
    // The paint brush's (Map-maker II's second wave): its layer, an entry chosen, a family (and an alternate) added and chosen,
    // its colour, and the world row's switches, tint, weights, base and wash, each written into the file.
    if (t.paintLayer === 'family' || t.paintLayer === 'colour' || t.paintLayer === 'plants') PAINT_TUNE.layer = t.paintLayer;
    // The plants layer's recipe (Map-maker II's fourth wave): built a class at a time, chosen, or one of the recipes chosen.
    const fc = t.floraClass;
    if (Array.isArray(fc) && (FLORA_CLASSES as readonly unknown[]).includes(fc[0]) && ['keep', 'clear', 'thin', 'add', 'remove'].includes(fc[1] as string)) this.recipeDraft[fc[0] as FloraClass].op = fc[1] as string;
    const ff = t.floraFamily;
    if (Array.isArray(ff) && (FLORA_CLASSES as readonly unknown[]).includes(ff[0]) && typeof ff[1] === 'string') this.recipeDraft[ff[0] as FloraClass].family = ff[1];
    if (typeof t.floraRoads === 'boolean') this.recipeDraft.roads = t.floraRoads;
    if (t.floraUse === true) {
      const d = this.draftRecipe();
      if (d.unnamed.length) this.say(`name a family for the ${d.unnamed.join(' and ')} first`, false);
      else void this.paint.chooseRecipe(d.recipe).then(() => this.window?.refreshEdits());
    }
    if (typeof t.floraRecipe === 'number') {
      const r = this.host.world.paintRecipes[t.floraRecipe - 1];
      if (r) void this.paint.chooseRecipe(r).then(() => this.window?.refreshEdits());
    }
    if (typeof t.paintEntry === 'number' && t.paintEntry >= 1 && t.paintEntry <= this.host.world.paintEntries.length) {
      PAINT_TUNE.entry = t.paintEntry;
      PAINT_TUNE.layer = 'family';
    }
    const pa = t.paintAdd as { pack?: unknown; name?: unknown; child?: unknown } | undefined;
    if (pa && typeof pa.name === 'string') {
      const child = typeof pa.child === 'number' ? pa.child : undefined;
      // A family of another world (Map-maker II's third wave) is lent behind the curtain first; the tab is drawn again after.
      if (typeof pa.pack === 'string' && pa.pack !== this.host.world.paintPack()) void this.paint.chooseFrom(pa.pack, pa.name, child).then(() => this.window?.refreshEdits());
      else this.paint.choose(pa.name, child);
    }
    // The pack the palette's family list shows (this world's own, or another installed world's to lend from).
    if (typeof t.paintBrowse === 'string') this.browsePack(t.paintBrowse);
    if (typeof t.paintColour === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.paintColour)) {
      PAINT_TUNE.colour = t.paintColour.toLowerCase();
      PAINT_TUNE.layer = 'colour';
    }
    const pw = t.paintWorld;
    if (pw && typeof pw === 'object' && !Array.isArray(pw)) void this.writePaintWorld(pw as Record<string, unknown>).then((s) => this.say(s, true));
    // One family's alternates' weights from the Tools tab, laid over the row's others (the console's `world.weights` is the whole table).
    const pwt = t.paintWeight;
    if (Array.isArray(pwt) && typeof pwt[0] === 'string' && Array.isArray(pwt[1])) {
      const weights = { ...(this.host.world.paintWorld.weights ?? {}), [pwt[0]]: (pwt[1] as unknown[]).map(Number) };
      void this.writePaintWorld({ weights }, 'an alternate\'s weight').then((s) => this.say(s, true));
    }
  }

  /** The paint brush as the Tools tab shows it: its layer, its palette with pictures, the world's families, the world row. */
  private paintView(): PaintToolsView {
    const w = this.host.world;
    const pics = w.paintPictures();
    const own = w.paintPack();
    // A palette entry of another world is filed by its pack and name (`lentFamilyKey`), this world's own by its name.
    const picsOf = (pack: string, name: string): (string | null)[] => pics.get(pack === own ? name.toLowerCase() : lentFamilyKey(pack, name)) ?? [];
    const entries = w.paintEntries.map((e, i) => {
      const kids = picsOf(e.pack, e.name);
      return { at: i + 1, name: e.pack === own ? e.name : `${e.pack}'s ${e.name}`, child: e.child ?? null, picture: kids[e.child ?? 0] ?? kids[0] ?? null, chosen: PAINT_TUNE.layer === 'family' && PAINT_TUNE.entry === i + 1, lays: (w.groundPaint?.familyOf[i + 1] ?? 0) !== 0 || !w.groundPaint };
    });
    const group = w.paintGroup();
    const fams = [...(group?.families.values() ?? [])].filter((f) => !group?.lent.has(f.id)).sort((a, b) => a.name.localeCompare(b.name));
    // The family list: this world's own, or (Map-maker II's third wave) another installed world's to lend from, read once.
    // A pack browsed on another world that is this world's own (a travel to it) is this world's own list.
    const browse = this.paintBrowse === own ? '' : this.paintBrowse;
    const read = browse ? this.browsed.get(browse) : undefined;
    const families = browse
      ? Array.isArray(read)
        ? [...read].sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ pack: browse, name: f.name, pictures: f.pictures, lent: w.lentHere(browse, f.name) }))
        : []
      : fams.map((f) => ({ pack: own, name: f.name, pictures: pics.get(f.name.toLowerCase()) ?? [], lent: true }));
    const packs = [{ id: own, words: `${own} (this world)`, on: !browse }, ...groundPacksOf().filter((p) => p !== own).map((p) => ({ id: p, words: p, on: browse === p }))];
    const browseNote = !browse ? '' : read === undefined ? `reading ${browse}'s ground pictures...` : typeof read === 'string' ? read : `${browse}'s families: the first choice of one lends it this world's ground behind a short curtain (its pictures put in the ground's array), after which it paints at once; a lent one is marked.`;
    const row = w.paintWorld;
    const t = GROUND_DRAW_TUNE;
    const chosen = w.paintEntries[PAINT_TUNE.entry - 1];
    const fam = chosen ? (chosen.pack === own ? fams.find((f) => f.name === chosen.name) : group?.families.get(group.lentId(chosen.pack, chosen.name))) ?? null : null;
    const key = fam && chosen ? `${chosen.pack}:${fam.name}` : '';
    const weights = fam ? { key, name: fam.name, values: row.weights?.[key] ?? fam.children.map((c) => c.weight), own: fam.children.map((c) => c.weight) } : null;
    const p = w.groundPaint;
    const f = w.paintFileInfo;
    const rows = w.paintRows.size;
    const file = `public/placements/paint/${this.host.packId()}.json: ${rows} row${rows === 1 ? '' : 's'}${w.paintRows.bytes ? `, about ${(w.paintRows.bytes / 1024).toFixed(1)} KB` : ''}, ${p?.cell ?? f.cell} m cells${f.problem ? ` (not read: ${f.problem})` : ''}`;
    const notes: string[] = [];
    const no = this.paint.refusal();
    if (no) notes.push(no);
    if (w.paintMissing.length) notes.push(`laying nothing here: ${w.paintMissing.join('; ')}`);
    return {
      armed: this.paint.armed,
      layer: PAINT_TUNE.layer,
      plants: this.plantsView(),
      entries,
      families,
      packs,
      browseNote,
      colour: PAINT_TUNE.colour,
      switches: [
        { key: 'follow', words: row.follow === false ? 'Plants keep their places' : 'Plants follow the paint', on: row.follow !== false },
        { key: 'alternates', words: t.children ? 'Alternates on' : 'Alternates off (first picture only)', on: t.children },
        { key: 'masks', words: t.masks ? 'Border masks on' : 'Border masks off', on: t.masks },
        { key: 'clouds', words: t.clouds.on ? 'Cloud shadows on' : 'Cloud shadows off', on: t.clouds.on },
      ],
      tint: t.colour,
      tints: [...TINT_MODES],
      opposite: t.opposite,
      weights,
      dem: w.planet?.dem ? { base: row.base ? `${row.base.pack}:${row.base.name}` : '', wash: !!row.wash } : null,
      file,
      note: notes.join(' '),
    };
  }

  /**
   * `__debug.groundPaint(o)`: the palette, the cells painted by layer, the revision and the grids asked for again, the
   * preview's blocks, the world row in force; `{ tune }`, `{ arm: 'family' | 'colour' }` (or `false`), `{ choose: name |
   * { name, child } }`, `{ at: [x, z] }` the family, child and colour painted and the world's own beneath, `{ stroke: { layer,
   * entry, erase, x, z, r, seconds } }` a stroke run exactly as held and written, `{ world: {...} }` the world row written,
   * `{ wash: {...} }` the wash's dials -- a place given in the file's own frame (a `/loc` line on a planet), the aim where none is.
   */
  async paintDebug(o?: Record<string, unknown>): Promise<unknown> {
    const w = this.host.world;
    const said: string[] = [];
    const c = w.placeFrame;
    const space = !!w.planet?.space;
    const gameOf = (x: number, z: number): { x: number; z: number } => (space || !c ? { x, z } : { x: rawToGameX(c.x, x), z: rawToGameZ(c.z, z) });
    let at: Record<string, unknown> | null = null;
    if (o && typeof o === 'object') {
      if (o.tune !== undefined) said.push(...tunePaint(o.tune, { rewrite: GROUND_REWRITE_TUNE, paint: GROUND_PAINT_TUNE }));
      if (o.arm === 'family' || o.arm === 'colour' || o.arm === 'plants') {
        PAINT_TUNE.layer = o.arm;
        said.push(this.paint.armed ? `the paint brush: ${o.arm}` : await this.toggleTool('paint'));
      } else if (o.arm === false && this.paint.armed) said.push(await this.toggleTool('paint'));
      else if (o.arm !== undefined) said.push(`arm is one of ${PAINT_LAYERS.join(', ')}, or false`);
      if (typeof o.choose === 'string') said.push(this.paint.choose(o.choose, undefined));
      else if (o.choose && typeof o.choose === 'object') {
        const ch = o.choose as { pack?: unknown; name?: unknown; child?: unknown };
        const child = typeof ch.child === 'number' ? ch.child : undefined;
        // Another world's family (Map-maker II's third wave): lent behind the curtain first where it is not.
        if (typeof ch.name === 'string') said.push(typeof ch.pack === 'string' ? await this.paint.chooseFrom(ch.pack, ch.name, child) : this.paint.choose(ch.name, child));
      }
      if (typeof o.entry === 'number') {
        if (o.entry >= 1 && o.entry <= w.paintEntries.length) PAINT_TUNE.entry = o.entry;
        else said.push(`entry is a palette place from 1 to ${w.paintEntries.length}`);
      }
      if (typeof o.colour === 'string') said.push(...tunePaint({ colour: o.colour }));
      if (o.world && typeof o.world === 'object' && !Array.isArray(o.world)) said.push(await this.writePaintWorld(o.world as Record<string, unknown>));
      if (o.wash && typeof o.wash === 'object' && !Array.isArray(o.wash)) said.push(...this.washDial(o.wash as Record<string, unknown>));
      if (Array.isArray(o.at) && o.at.length === 2) at = this.paintAt(gameOf(Number(o.at[0]), Number(o.at[1])), [Number(o.at[0]), Number(o.at[1])]);
      const st = o.stroke as Record<string, unknown> | undefined;
      if (st && typeof st === 'object') {
        const layer: PaintLayer = st.layer === 'colour' ? 'colour' : 'family';
        if (typeof st.entry === 'number' && st.entry >= 1 && st.entry <= w.paintEntries.length) PAINT_TUNE.entry = st.entry;
        if (typeof st.colour === 'string') tunePaint({ colour: st.colour });
        const g = typeof st.x === 'number' && typeof st.z === 'number' ? gameOf(st.x, st.z) : { x: this.aim.hit.x, z: this.aim.hit.z };
        const r = typeof st.r === 'number' ? st.r : PAINT_TUNE.radius;
        const seconds = typeof st.seconds === 'number' ? Math.max(0, Math.min(60, st.seconds)) : 1;
        said.push(await this.paint.strokeAt(layer, st.erase === true, g.x, g.z, r, seconds));
      }
    }
    const p = w.groundPaint;
    let fam = 0;
    let col = 0;
    if (p) {
      for (const t of p.fam.values()) for (let i = 0; i < t.length; i++) if (t[i]) fam++;
      for (const t of p.col.values()) for (let i = 3; i < t.length; i += 4) if (t[i]) col++;
    }
    const swg = w.terrain.swg;
    return {
      palette: w.paintEntries.map((e, i) => `${i + 1}: ${e.pack}:${e.name}${e.child !== undefined ? ` (alternate ${e.child})` : ''}${p && !p.familyOf[i + 1] ? ' (lays nothing here)' : ''}`),
      cells: { family: fam, colour: col, cell: p?.cell ?? w.paintFileInfo.cell, tiles: { family: p?.fam.size ?? 0, colour: p?.col.size ?? 0 } },
      follow: p ? p.follow : w.paintWorld.follow !== false,
      worker: swg ? { ...swg.paintWork } : null,
      previewBlocks: swg?.sampler.previewBlocks ?? 0,
      landed: { ...w.paintLandWork },
      dirty: w.groundDirtyCount,
      world: w.paintWorld,
      // Whether the ground is drawn by the tile program (a converted world's, or a real-elevation world whose row names a base), and its wash.
      tiled: w.terrain.tiled,
      wash: !!w.terrain.demWash,
      file: { ...w.paintFileInfo, skipped: w.paintFileInfo.skipped.length, rowsNow: w.paintRows.size, bytesNow: w.paintRows.bytes },
      laidAtArrival: w.paintLaidAtArrival,
      missing: w.paintMissing,
      armed: this.paint.armed,
      paint: this.paint.report(),
      tune: { ...PAINT_TUNE },
      rebuild: { paintMs: GROUND_REWRITE_TUNE.paintMs, rasterWaitMs: GROUND_PAINT_TUNE.rasterWaitMs },
      // What this world lends of other worlds (Map-maker II's third wave): asked with `packs`.
      ...(o && o.packs ? { lending: w.lendingReport() } : {}),
      ...(at ? { at } : {}),
      ...(said.length ? { answered: said } : {}),
    };
  }

  /**
   * `__debug.floraPaint(o)` (Map-maker II's fourth wave): the recipes (and any class that paints nothing here), the flora
   * cells painted, the chunks replanted on the landings, and on a real-elevation world the lent plants loaded and what the
   * paint's source answered; `{ tune }` the plants layer's numbers; `{ arm: true }` (or false) the paint brush on its plants
   * layer; `{ recipe: n | {...} }` a recipe chosen (one given whole is appended where none is the same); `{ at: [x, z] }` the
   * four flora maps there, painted and the world's own; `{ stroke: { recipe, erase, x, z, r, seconds } }` a stroke run exactly
   * as held and written -- a place given in the file's own frame (a `/loc` line on a planet), the aim where none is.
   */
  async floraPaintDebug(o?: Record<string, unknown>): Promise<unknown> {
    const w = this.host.world;
    const said: string[] = [];
    const c = w.placeFrame;
    const space = !!w.planet?.space;
    const gameOf = (x: number, z: number): { x: number; z: number } => (space || !c ? { x, z } : { x: rawToGameX(c.x, x), z: rawToGameZ(c.z, z) });
    let at: Record<string, unknown> | null = null;
    if (o && typeof o === 'object') {
      if (o.tune !== undefined) said.push(...tuneFloraPaint(o.tune));
      if (o.arm === true) {
        PAINT_TUNE.layer = 'plants';
        said.push(this.paint.armed ? 'the paint brush: plants' : await this.toggleTool('paint'));
      } else if (o.arm === false && this.paint.armed) said.push(await this.toggleTool('paint'));
      if (typeof o.recipe === 'number') {
        const r = w.paintRecipes[o.recipe - 1];
        said.push(r ? await this.paint.chooseRecipe(r) : `recipe is a place from 1 to ${w.paintRecipes.length}, or a recipe`);
      } else if (o.recipe !== undefined) said.push(await this.paint.chooseRecipe(o.recipe));
      if (Array.isArray(o.at) && o.at.length === 2) at = this.floraAt(gameOf(Number(o.at[0]), Number(o.at[1])), [Number(o.at[0]), Number(o.at[1])]);
      const st = o.stroke as Record<string, unknown> | undefined;
      if (st && typeof st === 'object') {
        if (typeof st.recipe === 'number') {
          const r = w.paintRecipes[st.recipe - 1];
          if (r) said.push(await this.paint.chooseRecipe(r));
          else said.push(`recipe is a place from 1 to ${w.paintRecipes.length}`);
        } else if (st.recipe !== undefined) said.push(await this.paint.chooseRecipe(st.recipe));
        const g = typeof st.x === 'number' && typeof st.z === 'number' ? gameOf(st.x, st.z) : { x: this.aim.hit.x, z: this.aim.hit.z };
        const r = typeof st.r === 'number' ? st.r : FLORA_PAINT_TUNE.radius;
        const seconds = typeof st.seconds === 'number' ? Math.max(0, Math.min(60, st.seconds)) : 1;
        said.push(await this.paint.strokeAt('plants', st.erase === true, g.x, g.z, r, seconds));
      }
    }
    const p = w.groundPaint;
    let cells = 0;
    if (p) for (const t of p.flo.values()) for (let i = 1; i < t.length; i += 2) if (t[i]) cells++;
    return {
      recipes: w.paintRecipes.map((r, i) => `${i + 1}: ${recipeWords(r)}`),
      missing: w.floraMissing,
      cells: { painted: cells, tiles: p?.flo.size ?? 0, cell: p?.cell ?? w.paintFileInfo.cell },
      follow: p ? p.follow : w.paintWorld.follow !== false,
      stands: w.floraReport(),
      armed: this.paint.armed && PAINT_TUNE.layer === 'plants',
      paint: this.paint.report(),
      tune: { ...FLORA_PAINT_TUNE },
      ...(at ? { at } : {}),
      ...(said.length ? { answered: said } : {}),
    };
  }

  /**
   * The four flora maps at a game point (the console's `at`): what the paint's cells say there, the maps as built (the cached
   * block's pole, a converted world's), and the world's own (the block made again with the paint taken off); on a
   * real-elevation world the paint's source's answer, its own world having none.
   */
  private floraAt(g: { x: number; z: number }, file: number[]): Record<string, unknown> {
    const w = this.host.world;
    const r = w.gameToRaw(g.x, g.z);
    const out: Record<string, unknown> = { file, game: [round(g.x), round(g.z)] };
    const swg = w.terrain.swg;
    const tables = this.floraTables();
    const nameOf = (cls: number, id: number): string => (id ? `${id} ${(cls < 2 ? tables?.flora : tables?.radial)?.families.get(id)?.name ?? '?'}` : '(none)');
    const four = (b: { floraCollidable: Uint8Array; floraNonCollidable: Uint8Array; radialNear?: Uint8Array; radialFar?: Uint8Array }, i: number): Record<string, string> => ({
      trees: nameOf(0, b.floraCollidable[i * 2]),
      plants: nameOf(1, b.floraNonCollidable[i * 2]),
      grass: nameOf(2, b.radialNear?.[i * 2] ?? 0),
      far: nameOf(3, b.radialFar?.[i * 2] ?? 0),
    });
    if (swg) {
      const s = swg.sampler;
      const bx = Math.floor(r.x / s.blockWidth);
      const bz = Math.floor(r.z / s.blockWidth);
      const start = s.blockStart(bx, bz);
      const n = s.numberOfPoles;
      const px = Math.round((Math.floor(r.x / s.poleStep) * s.poleStep - start.x) / s.poleStep);
      const pz = Math.round((Math.floor(r.z / s.poleStep) * s.poleStep - start.z) / s.poleStep);
      const i = pz * n + px;
      if (s.hasBlock(bx, bz)) {
        const b = s.generateBlock(bx, bz);
        out.built = four(b, i);
        out.road = b.roads ? b.roads[i] !== 0 : null;
      }
      const held = s.paint;
      s.paint = null;
      try {
        out.own = four(s.generate(start.x, start.z, n, s.poleStep), i);
      } finally {
        s.paint = held;
      }
    } else if (w.demFlora) {
      const src = w.demFlora.source;
      const pole = { family: 0, choice: 0, excluded: false, color: 0, height: 0, nx: 0, ny: 1, nz: 0 };
      const t = src.floraAt(r.x, r.z, true).family;
      const pl = src.floraAt(r.x, r.z, false).family;
      src.radialPoleIfCached(g.x, g.z, false, pole);
      const gr = pole.family;
      src.radialPoleIfCached(g.x, g.z, true, pole);
      out.built = { trees: nameOf(0, t), plants: nameOf(1, pl), grass: nameOf(2, gr), far: nameOf(3, pole.family) };
      out.own = 'a real-elevation world plants nothing of its own';
    }
    return out;
  }

  /**
   * What the paint says at a game point (the console's `at`): the entry, family and alternate painted there and its colour
   * cell laid over white, the ground as built (family, choice, colour), and the world's own beneath (the generator run with
   * the paint taken off, or a real-elevation world's rules asked with none).
   */
  private paintAt(g: { x: number; z: number }, file: number[]): Record<string, unknown> {
    const w = this.host.world;
    const r = w.gameToRaw(g.x, g.z);
    const p = w.groundPaint;
    const e = p ? p.entryAtRaw(r.x, r.z) : 0;
    const entry = e ? w.paintEntries[e - 1] : null;
    const px = new Uint8Array([255, 255, 255]);
    const painted = p ? p.colourAtRaw(r.x, r.z, px) : false;
    const group = w.paintGroup();
    // A family another world lent this one says its pack (Map-maker II's third wave).
    const name = (id: number) => `${id} ${group?.lent.has(id) ? `${group.lent.get(id)!.pack}:` : ''}${group?.families.get(id)?.name ?? '(none)'}`;
    const out: Record<string, unknown> = {
      file,
      game: [round(g.x), round(g.z)],
      painted: entry ? { entry: e, family: `${entry.pack}:${entry.name}`, alternate: entry.child ?? 'the pole\'s own', choice: p!.choiceAtRaw(r.x, r.z) } : null,
      colour: painted ? hexOf((px[0] << 16) | (px[1] << 8) | px[2]) : null,
    };
    const swg = w.terrain.swg;
    if (swg) {
      const pole = { family: 0, choice: 0, color: 0 };
      if (swg.groundIfCached(g.x, g.z, pole)) out.built = { family: name(pole.family), choice: pole.choice, colour: hexOf(pole.color) };
      const held = swg.sampler.paint;
      swg.sampler.paint = null;
      try {
        const own = swg.probe(g.x, g.z);
        out.own = { family: name(own.family), child: own.child, colour: hexOf(own.color) };
      } finally {
        swg.sampler.paint = held;
      }
    } else if (w.terrain.demShader) {
      const s = w.terrain.demShader;
      const held = s.paint;
      s.paint = null;
      try {
        out.own = { family: name(s.familyAt(g.x, g.z, (x, z) => w.terrain.heightAt(x, z))) };
      } finally {
        s.paint = held;
      }
      const f = w.terrain.familyAt(g.x, g.z);
      if (f) out.built = { family: name(f) };
    }
    return out;
  }

  /** The sculpt brush as the Tools tab shows it: its mode, flatten's ways, target and height, its falloff, its switches and its file. */
  private sculptView(): SculptToolsView {
    const t = SCULPT_TUNE;
    const w = this.host.world;
    const f = w.heightsFileInfo;
    const tiles = w.heightEdits?.size ?? 0;
    // The file as it stands now, the editor's own writes included (`HeightRows`), its size about what its text comes to.
    const bytes = w.heightRows.bytes;
    const file = `public/placements/heights/${this.host.packId()}.json: ${tiles} tile${tiles === 1 ? '' : 's'}${bytes ? `, about ${(bytes / 1024).toFixed(1)} KB` : ''}${f.problem ? ` (not read: ${f.problem})` : ''}`;
    const notes: string[] = [];
    if (tiles) notes.push('The walk grid follows the sculpted ground once navgrid is run again for this world (status asks for it): until then a body walks the grid baked before it.');
    if (this.sculpt.refusal()) notes.push(this.sculpt.refusal() as string);
    return {
      armed: this.sculpt.armed,
      mode: t.mode,
      flatMode: t.flatMode,
      target: t.target,
      height: t.target === 'sampled' ? t.sampled : t.height,
      falloff: t.falloff,
      falloffs: [...SCULPT_FALLOFFS],
      switches: SCULPT_SWITCHES.map(([key, words]) => ({ key, words, on: t[key] })),
      file,
      note: notes.join(' '),
    };
  }

  /**
   * `__debug.sculpt(o)`: the store (its tiles and bytes, the file as last read), the armed mode and target, the dirty chunks
   * waiting, the last stroke's stamps, chunks rewritten and milliseconds; `{ tune }`, `{ arm: mode }` (or `false`),
   * `{ at: [x, z] }` the raw height, the edit and the ground there, and `{ stroke: { mode, x, z, r, seconds } }` a stroke run
   * exactly as held and written -- a place given in the file's own frame (a `/loc` line on a planet), the aim where none is.
   */
  async sculptDebug(o?: Record<string, unknown>): Promise<unknown> {
    const w = this.host.world;
    const said: string[] = [];
    const c = w.placeFrame;
    const space = !!w.planet?.space;
    const gameOf = (x: number, z: number): { x: number; z: number } => (space || !c ? { x, z } : { x: rawToGameX(c.x, x), z: rawToGameZ(c.z, z) });
    let at: Record<string, unknown> | null = null;
    if (o && typeof o === 'object') {
      if (o.tune !== undefined) said.push(...tuneSculpt(o.tune, GROUND_REWRITE_TUNE));
      if (typeof o.arm === 'string') {
        if (!(SCULPT_MODES as readonly string[]).includes(o.arm)) said.push(`arm is one of ${SCULPT_MODES.join(', ')}`);
        else {
          SCULPT_TUNE.mode = o.arm as SculptMode;
          if (!this.sculpt.armed) said.push(await this.toggleTool('sculpt'));
          else said.push(`the sculpt brush: ${o.arm}`);
        }
      }
      if (o.arm === false && this.sculpt.armed) said.push(await this.toggleTool('sculpt'));
      if (Array.isArray(o.at) && o.at.length === 2) {
        const g = gameOf(Number(o.at[0]), Number(o.at[1]));
        const r = w.gameToRaw(g.x, g.z);
        const sw = w.terrain.swg;
        const raw = sw ? (sw.sampler.rawPoleAt(Math.round(r.x / 2) * 2, Math.round(r.z / 2) * 2) ?? Number.NaN) : w.terrain.groundRawAt(g.x, g.z);
        const edit = w.heightEdits?.bilinear(r.x, r.z) ?? 0;
        at = { file: [Number(o.at[0]), Number(o.at[1])], game: [round(g.x), round(g.z)], raw: round(raw), edit: round(edit), ground: round(w.terrain.heightAt(g.x, g.z)) };
      }
      const st = o.stroke as Record<string, unknown> | undefined;
      if (st && typeof st === 'object') {
        const mode = (SCULPT_MODES as readonly string[]).includes(st.mode as string) ? (st.mode as SculptMode) : 'raise';
        const g = typeof st.x === 'number' && typeof st.z === 'number' ? gameOf(st.x, st.z) : { x: this.aim.hit.x, z: this.aim.hit.z };
        const r = typeof st.r === 'number' ? st.r : SCULPT_TUNE.radius;
        const seconds = typeof st.seconds === 'number' ? Math.max(0, Math.min(60, st.seconds)) : 1;
        said.push(await this.sculpt.strokeAt(mode, g.x, g.z, r, seconds));
      }
    }
    const store = w.heightEdits;
    return {
      store: { tiles: store?.size ?? 0, version: store?.version ?? 0, file: { ...w.heightsFileInfo, skipped: w.heightsFileInfo.skipped.length, rowsNow: w.heightRows.size, bytesNow: w.heightRows.bytes } },
      tiles: store?.size ?? 0,
      laidAtArrival: w.heightsLaidAtArrival,
      rawCopies: w.terrain.swg?.sampler.rawCopies ?? 0,
      armed: this.sculpt.armed,
      sculpt: this.sculpt.report(),
      dirty: w.groundDirtyCount,
      lastStroke: { ...w.groundWork, ms: round(w.groundWork.ms) },
      tune: { ...SCULPT_TUNE },
      rebuild: { ...GROUND_REWRITE_TUNE },
      ...(at ? { at } : {}),
      ...(said.length ? { answered: said } : {}),
    };
  }

  // ---- The water tool (Map-maker II's fifth wave). ----

  /** The lakes and rivers of ours as the Here tab lists them (`lake:<id>`, either kind), nearest the camera first. */
  private lakeHereRows(): HereRow[] {
    const p = this.host.player.pos;
    const rows = this.host.world.ourWaterRows.map((r) => {
      const m = this.lakeMiddle(r.id)!;
      const d = Math.hypot(m.x - p.x, m.y - p.y, m.z - p.z);
      const what = r.kind === 'river' ? `a river, ${r.points.length} points, ${r.width} m wide` : `a lake, ${r.h.toFixed(2)} m`;
      return { d, row: { id: `${LAKE_ROW}${r.id}`, layer: 'water', label: `${r.name ?? r.id} (${what})`, away: `${Math.round(d)} m`, stood: true, bad: null } as HereRow };
    });
    rows.sort((a, b) => a.d - b.d);
    return rows.map((x) => x.row);
  }

  /** A raw point of the water file in the game's frame (the world's own mirror about its centre, or about (0, 0)). */
  private waterHostFrame(x: number, z: number, out: { x: number; z: number }): void {
    const s = this.host.world.terrain.swg;
    out.x = s ? s.toGameX(x) : -x;
    out.z = s ? s.toGameZ(z) : z;
  }

  /** A lake's middle in the game's frame and its level (a river's: its spine's middle point and its height there), or null. */
  private lakeMiddle(id: string): { x: number; y: number; z: number; r: number } | null {
    const row = this.host.world.ourWaterRows.find((r) => r.id === id);
    if (!row) return null;
    const at = { x: 0.5, z: 0.5 };
    let cx = 0;
    let cz = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of row.points) {
      this.waterHostFrame(p[0], p[1], at);
      cx += at.x;
      cz += at.z;
      x0 = Math.min(x0, at.x);
      x1 = Math.max(x1, at.x);
      z0 = Math.min(z0, at.z);
      z1 = Math.max(z1, at.z);
    }
    const n = Math.max(1, row.points.length);
    const across = Math.max(x1 - x0, z1 - z0);
    const r = Number.isFinite(across) ? across : 10;
    if (row.kind === 'river') {
      const m = row.points[Math.floor((row.points.length - 1) / 2)];
      this.waterHostFrame(m[0], m[1], at);
      return { x: at.x, y: m[2], z: at.z, r };
    }
    return { x: cx / n, y: row.h, z: cz / n, r };
  }

  /** Go to a lake: the eye over its middle and back from it, looking down at it. Answers what was said. */
  private goToLake(id: string): string {
    const m = this.lakeMiddle(id);
    if (!m) return `no lake or river ${id}`;
    const back = Math.min(400, Math.max(20, m.r * 0.6));
    this.host.player.pos.set(m.x, m.y + back * 0.6, m.z + back);
    this.fly.lookAlong(0, -back * 0.6, -back);
    this.fly.stop();
    return `over the ${this.host.world.ourRiverRows.some((r) => r.id === id) ? 'river' : 'lake'} ${id}`;
  }

  /** A lake picked from the Here tab (or the console): the water tool armed if it is not, and the lake picked in it. */
  private async pickLake(id: string): Promise<string> {
    const row = this.host.world.ourWaterRows.find((r) => r.id === id);
    if (!row) return `no lake or river ${id}`;
    if (!this.water.armed) await this.toggleTool('water');
    this.water.picked = id;
    this.window?.refreshEdits();
    return `picked the ${row.kind} ${id}`;
  }

  /** The river picked as the Selected tab shows it (the sixth wave): its fields, its length and its steep reaches. */
  private riverView(row: WaterRiverRow): LakeView {
    const w = this.host.world;
    const t = w.rivers.find((r) => r.ours?.id === row.id) ?? null;
    let length = 0;
    const at = { x: 0.5, z: 0.5 };
    const at2 = { x: 0.5, z: 0.5 };
    for (let i = 1; i < row.points.length; i++) {
      this.waterHostFrame(row.points[i - 1][0], row.points[i - 1][1], at);
      this.waterHostFrame(row.points[i][0], row.points[i][1], at2);
      length += Math.hypot(at2.x - at.x, at2.z - at.z);
    }
    const s = t?.river;
    const steep = s && s.stretches.length ? `Past ${s.limit}° in ${s.stretches.length} place${s.stretches.length === 1 ? '' : 's'} (the steepest ${Math.max(...s.stretches.map((x) => x.slope)).toFixed(1)}°): ${s.steep === 'effects' ? "water, with the game's fall effects there" : s.steep === 'fall' ? 'not water: a fall row is written there as a river is written' : 'not water: a fall goes here'}.` : '';
    const m = this.lakeMiddle(row.id);
    return {
      id: row.id,
      name: row.name ?? '',
      h: m ? Math.round(m.y * 1000) / 1000 : 0,
      points: row.points.length,
      area: '',
      shader: row.shader ?? '',
      color: row.look?.color ?? '',
      opacity: row.look?.opacity !== undefined ? String(row.look.opacity) : '',
      ripple: row.look?.ripple !== undefined ? String(row.look.ripple) : '',
      drift: row.look?.drift !== undefined ? String(row.look.drift) : '',
      note: t ? `${s?.reaches.length ?? 0} reach${s?.reaches.length === 1 ? '' : 'es'} drawn.` : 'It is not drawn (this world keeps no river here).',
      river: { width: String(row.width), velocity: String(row.velocity), fallFrom: row.fallFrom !== undefined ? String(row.fallFrom) : '', length: `${Math.round(length)} m`, steep },
    };
  }

  /** The lake (or river) picked as the Selected tab shows it, or null. */
  private lakeView(): LakeView | null {
    const id = this.water.picked;
    if (!id) return null;
    const w = this.host.world;
    const river = w.ourRiverRows.find((r) => r.id === id);
    if (river) return this.riverView(river);
    const row = w.ourLakeRows.find((r) => r.id === id);
    if (!row) return null;
    const at = { x: 0.5, z: 0.5 };
    const pts = row.points.map(([x, z]) => {
      this.waterHostFrame(x, z, at);
      return [at.x, at.z] as [number, number];
    });
    const area = outlineArea(pts);
    const notes: string[] = [];
    if (w.lakeShaderIsLava(row.shader)) notes.push('Its shader is lava: it is drawn with the lava.');
    const report = w.lakesReport() as { lakes: { id: string; drawn: boolean }[] };
    if (!report.lakes.find((l) => l.id === id)?.drawn && !w.lakeShaderIsLava(row.shader)) notes.push('It is not drawn (its outline may cross itself).');
    return {
      id,
      name: row.name ?? '',
      h: row.h,
      points: row.points.length,
      area: area > 1e6 ? `${(area / 1e6).toFixed(3)} km²` : `${Math.round(area)} m²`,
      shader: row.shader ?? '',
      color: row.look?.color ?? '',
      opacity: row.look?.opacity !== undefined ? String(row.look.opacity) : '',
      ripple: row.look?.ripple !== undefined ? String(row.look.ripple) : '',
      drift: row.look?.drift !== undefined ? String(row.look.drift) : '',
      note: notes.join(' '),
    };
  }

  /** The water tool as the Tools tab shows it. */
  private waterView(): WaterToolsView {
    const w = this.host.world;
    const t = WATER_TUNE;
    const info = w.waterFileInfo;
    const n = w.ourLakeRows.length;
    const nr = w.ourRiverRows.length;
    const file = `public/placements/water/${this.host.packId()}.json: ${n} lake${n === 1 ? '' : 's'}${nr ? `, ${nr} river${nr === 1 ? '' : 's'}` : ''}${info.bytes ? `, about ${(info.bytes / 1024).toFixed(1)} KB as last read` : ''}${info.problem ? ` (not read: ${info.problem})` : ''}`;
    const notes: string[] = [];
    const no = this.water.refusal();
    if (no) notes.push(no);
    if (n || nr) notes.push(`The walk grid follows the ${nr ? (n ? 'lakes and rivers' : 'rivers') : 'lakes'} once navgrid is run again for this world (status asks for it).`);
    const soe = w.rivers.filter((r) => r.soe).length;
    if (soe) notes.push(`This world's terrain has ${soe} wet river${soe === 1 ? '' : 's'} of its own, drawn as water (not the file's: the tool does not edit them).`);
    if (this.water.last.said) notes.push(this.water.last.said);
    return { armed: this.water.armed, mode: t.mode, levelFrom: t.levelFrom, height: t.height, riverHeights: t.riverHeights, steep: RIVER_TUNE.steep, draft: this.water.draft.length, fallTop: !!this.water.fallTop, picked: this.water.picked, lakes: n, rivers: nr, file, note: notes.join(' ') };
  }

  /**
   * `__debug.lakes(o)` (the dev server's half): the world's lakes (`World.lakesReport`) with what stands under them with no
   * rooms, the tool's own state; `{ tune }` the tool's numbers and the lakes' own (`LAKE_TUNE`'s cell, floraUnder,
   * roofDepth), `{ arm: 'clicks' | 'trace' | 'fall' }` (or false), `{ at: [x, z] }` the surface and its table, `{ trace: { x,
   * z, h, reach, dry } }` a trace from a seed (written unless `dry`), `{ clicks: [[x, z], ...], h, name }` a lake written from
   * points, `{ fall: { from: [x, y, z], to: [x, y, z], model, width } }` a fall written, `{ pick: id }`, `{ move: { id, dx, dz,
   * dy } }`, `{ look: { id, color, opacity, ripple, drift, shader, name } }` and `{ remove: id }` -- every place in the file's
   * own frame (a `/loc` line on a planet), the aim where none is given.
   */
  async lakesDebug(o?: Record<string, unknown>): Promise<unknown> {
    const w = this.host.world;
    const said: string[] = [];
    const c = w.placeFrame;
    const space = !!w.planet?.space;
    const gameOf = (x: number, z: number): { x: number; z: number } => (space || !c ? { x, z } : { x: rawToGameX(c.x, x), z: rawToGameZ(c.z, z) });
    const placeOf = (v: unknown): { x: number; z: number } | null => (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? gameOf(v[0], v[1]) : null);
    let at: Record<string, unknown> | null = null;
    let traced: Record<string, unknown> | null = null;
    if (o && typeof o === 'object') {
      if (o.tune && typeof o.tune === 'object') {
        const tune: Record<string, unknown> = { ...(o.tune as Record<string, unknown>) };
        for (const k of Object.keys(LAKE_TUNE) as (keyof typeof LAKE_TUNE)[]) {
          if (!(k in tune)) continue;
          const v = tune[k];
          delete tune[k];
          if (typeof v === typeof LAKE_TUNE[k]) (LAKE_TUNE as Record<string, unknown>)[k] = v;
          else said.push(`${k} takes a ${typeof LAKE_TUNE[k]}`);
        }
        if (Object.keys(tune).length) said.push(...tuneWater(tune));
      }
      if (typeof o.arm === 'string') {
        if (!(WATER_CHOICES.mode as readonly string[]).includes(o.arm)) said.push(`arm is one of ${WATER_CHOICES.mode.join(', ')}`);
        else {
          tuneWater({ mode: o.arm });
          said.push(this.water.armed ? `the water tool: ${o.arm}` : await this.toggleTool('water'));
        }
      }
      if (o.arm === false && this.water.armed) said.push(await this.toggleTool('water'));
      const a = placeOf(o.at);
      if (a) at = { ...w.lakeAt(a.x, a.z), game: [round(a.x), round(a.z)] };
      const tr = o.trace as Record<string, unknown> | undefined;
      if (tr && typeof tr === 'object') {
        const g = typeof tr.x === 'number' && typeof tr.z === 'number' ? gameOf(tr.x, tr.z) : { x: this.aim.hit.x, z: this.aim.hit.z };
        const reach = typeof tr.reach === 'number' && tr.reach > 0 ? tr.reach : undefined;
        const h = typeof tr.h === 'number' ? tr.h : null;
        if (tr.dry === true) {
          const level = h ?? w.terrain.heightAt(g.x, g.z) + WATER_TUNE.traceRise;
          const r = this.water.traced(g.x, g.z, level, reach);
          traced = { level: round(level), points: r.points.length, area: Math.round(r.area), km2: round(r.area / 1e6), cells: r.cells, ms: r.ms, why: r.why };
        } else said.push(await this.water.traceAt(g.x, g.z, h, reach));
      }
      if (Array.isArray(o.clicks)) {
        const pts = (o.clicks as unknown[]).map(placeOf).filter((p): p is { x: number; z: number } => !!p).map((p) => [p.x, p.z] as [number, number]);
        const h = typeof o.h === 'number' ? o.h : Math.min(...pts.map(([x, z]) => w.terrain.heightAt(x, z))) + WATER_TUNE.rise;
        said.push(await this.water.writeLake(pts, h, 'a lake (console)', 'clicks', typeof o.name === 'string' ? o.name : undefined));
      }
      const fa = o.fall as Record<string, unknown> | undefined;
      if (fa && typeof fa === 'object') {
        const three = (v: unknown): { x: number; y: number; z: number } | null => {
          if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number')) return null;
          const g = gameOf(v[0] as number, v[2] as number);
          return { x: g.x, y: v[1] as number, z: g.z };
        };
        const from = three(fa.from);
        const to = three(fa.to);
        if (!from || !to) said.push('fall takes { from: [x, y, z], to: [x, y, z] } in the file\'s frame');
        else {
          if (typeof fa.model === 'string') tuneWater({ fallModel: fa.model });
          if (typeof fa.width === 'number') tuneWater({ fallWidth: fa.width });
          said.push(await this.water.writeFall(from, to));
        }
      }
      if (typeof o.pick === 'string') said.push(await this.pickLake(o.pick));
      if (o.pick === null) this.water.picked = null;
      const mv = o.move as Record<string, unknown> | undefined;
      if (mv && typeof mv === 'object' && typeof mv.id === 'string') {
        // dx along the file's own x: the game's frame mirrors x on a planet.
        const dxFile = typeof mv.dx === 'number' ? mv.dx : 0;
        const dz = typeof mv.dz === 'number' ? mv.dz : 0;
        const dy = typeof mv.dy === 'number' ? mv.dy : 0;
        said.push(await this.water.moveLake(mv.id, space ? dxFile : -dxFile, dz, dy));
      }
      const lk = o.look as Record<string, unknown> | undefined;
      // With no id, the lake picked (the line the look's sliders copy out names none).
      if (lk && typeof lk === 'object' && typeof lk.id !== 'string' && this.water.picked) lk.id = this.water.picked;
      if (lk && typeof lk === 'object' && typeof lk.id === 'string') {
        const look: Record<string, unknown> = {};
        for (const k of ['color', 'opacity', 'ripple', 'drift']) if (k in lk) look[k] = lk[k];
        const fields: { name?: string | null; shader?: string | null; look?: Record<string, unknown> } = { look };
        if ('name' in lk) fields.name = typeof lk.name === 'string' ? lk.name : null;
        if ('shader' in lk) fields.shader = typeof lk.shader === 'string' ? lk.shader : null;
        said.push(await this.water.setLake(lk.id, fields));
      }
      if (typeof o.remove === 'string') said.push(await this.water.remove(o.remove));
    }
    const h = this.host;
    const under = w.rowsUnderLakes(h.standingRows().map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, rooms: s.row.kind === 'building' && (w.streamer?.placedHasRooms(placementKey(s.id)) ?? false) })));
    return {
      ...w.lakesReport(),
      under,
      tool: this.water.report(),
      toolTune: { ...WATER_TUNE },
      ...(at ? { at } : {}),
      ...(traced ? { traced } : {}),
      ...(said.length ? { answered: said } : {}),
    };
  }

  /**
   * `__debug.rivers(o)` (the dev server's half, Map-maker II's sixth wave): the world's rivers (`World.riversReport`: the
   * terrain's own and ours, each reach's run and wind, its steep stretches, its bodies, effects and index) and the tool's
   * river numbers; `{ tune }` moves `RIVER_TUNE` (its shape -- `slopeMax`, `steep`, `bucket`, `spacingMin` -- makes every river
   * again; `flow` rewrites every reach's wind) and the tool's own (`riverWidth`, `riverVelocity`, `riverRise`, `riverHeights`),
   * `{ arm: true }` the water tool in its river mode (false lets it go), `{ at: [x, z] }` the surface, the river and its run
   * there, `{ write: { points: [[x, z], ...] or [[x, z, h], ...], width, velocity, name } }` a river written (each point on
   * its ground by the tool's rule, or at `h` as given), `{ pick }`, `{ move: { id, dx, dz, dy } }`, `{ set: { id, width,
   * velocity, fallFrom, name, shader, color, opacity, ripple, drift } }` and `{ remove }` -- every place in the file's own
   * frame (a `/loc` line on a planet).
   */
  async riversDebug(o?: Record<string, unknown>): Promise<unknown> {
    const w = this.host.world;
    const said: string[] = [];
    const c = w.placeFrame;
    const space = !!w.planet?.space;
    const gameOf = (x: number, z: number): { x: number; z: number } => (space || !c ? { x, z } : { x: rawToGameX(c.x, x), z: rawToGameZ(c.z, z) });
    let at: Record<string, unknown> | null = null;
    if (o && typeof o === 'object') {
      if (o.tune && typeof o.tune === 'object') said.push(...this.tuneRivers(o.tune as Record<string, unknown>));
      if (o.arm === true) {
        tuneWater({ mode: 'river' });
        said.push(this.water.armed ? 'the water tool: river' : await this.toggleTool('water'));
      }
      if (o.arm === false && this.water.armed) said.push(await this.toggleTool('water'));
      if (Array.isArray(o.at) && typeof o.at[0] === 'number' && typeof o.at[1] === 'number') {
        const g = gameOf(o.at[0], o.at[1]);
        at = { ...w.riverAt(g.x, g.z), game: [round(g.x), round(g.z)] };
      }
      const wr = o.write as Record<string, unknown> | undefined;
      if (wr && typeof wr === 'object' && Array.isArray(wr.points)) {
        const raw = (wr.points as unknown[]).filter((p): p is number[] => Array.isArray(p) && p.length >= 2 && p.every((n) => typeof n === 'number'));
        const given = raw.length > 0 && raw.every((p) => p.length >= 3);
        const pts = raw.map((p) => {
          const g = gameOf(p[0], p[1]);
          return [g.x, g.z, given ? p[2] : w.terrain.heightAt(g.x, g.z)] as [number, number, number];
        });
        const before = { width: WATER_TUNE.riverWidth, velocity: WATER_TUNE.riverVelocity };
        if (typeof wr.width === 'number') tuneWater({ riverWidth: wr.width });
        if (typeof wr.velocity === 'number') tuneWater({ riverVelocity: wr.velocity });
        said.push(await this.water.writeRiver(pts, 'a river (console)', typeof wr.name === 'string' ? wr.name : undefined, given));
        tuneWater({ riverWidth: before.width, riverVelocity: before.velocity });
      }
      if (typeof o.pick === 'string') said.push(await this.pickLake(o.pick));
      const mv = o.move as Record<string, unknown> | undefined;
      if (mv && typeof mv === 'object' && typeof mv.id === 'string') {
        // dx along the file's own x: the game's frame mirrors x on a planet.
        const dxFile = typeof mv.dx === 'number' ? mv.dx : 0;
        said.push(await this.water.moveLake(mv.id, space ? dxFile : -dxFile, typeof mv.dz === 'number' ? mv.dz : 0, typeof mv.dy === 'number' ? mv.dy : 0));
      }
      const st = o.set as Record<string, unknown> | undefined;
      if (st && typeof st === 'object' && !(typeof st.id === 'string') && this.water.picked) st.id = this.water.picked;
      if (st && typeof st === 'object' && typeof st.id === 'string') {
        const fields: { name?: string | null; shader?: string | null; look?: Record<string, unknown>; width?: number; velocity?: number; fallFrom?: number | null } = {};
        if ('name' in st) fields.name = typeof st.name === 'string' ? st.name : null;
        if ('shader' in st) fields.shader = typeof st.shader === 'string' ? st.shader : null;
        if (typeof st.width === 'number') fields.width = st.width;
        if (typeof st.velocity === 'number') fields.velocity = st.velocity;
        if ('fallFrom' in st) fields.fallFrom = typeof st.fallFrom === 'number' ? st.fallFrom : null;
        const look: Record<string, unknown> = {};
        for (const k of ['color', 'opacity', 'ripple', 'drift']) if (k in st) look[k] = st[k];
        if (Object.keys(look).length) fields.look = look;
        said.push(await this.water.setLake(st.id, fields));
      }
      if (typeof o.remove === 'string') said.push(await this.water.remove(o.remove));
    }
    return {
      ...w.riversReport(),
      tool: this.water.report(),
      toolTune: { riverWidth: WATER_TUNE.riverWidth, riverVelocity: WATER_TUNE.riverVelocity, riverRise: WATER_TUNE.riverRise, riverHeights: WATER_TUNE.riverHeights },
      ...(at ? { at } : {}),
      ...(said.length ? { answered: said } : {}),
    };
  }

  /** `rivers({ tune })`: the rivers' own numbers (`RIVER_TUNE`, a shape change making every river again) and the tool's river numbers. */
  tuneRivers(tune: Record<string, unknown>): string[] {
    // The retune is called inside `tuneRiverTune`, before it answers: what it says goes into a list made first.
    const said: string[] = [];
    said.push(...tuneRiverTune(tune, (what) => said.push(this.host.world.retuneRivers(what))));
    const tool: Record<string, unknown> = {};
    for (const k of ['riverWidth', 'riverVelocity', 'riverRise', 'riverHeights']) if (k in tune) tool[k] = tune[k];
    if (Object.keys(tool).length) said.push(...tuneWater(tool));
    return said;
  }

  // ---- The places tool (Map-maker II's eighth wave). ----

  /** This world's locations file's rows as last landed, and the file as last read (none without a host that keeps them). */
  private locationRows(): readonly LocationRow[] {
    return this.host.locationRows?.() ?? [];
  }

  /** A place's middle in the game's frame, its reach and the ground there (made once, never in a frame), or null. */
  private placeMiddle(id: string): { x: number; y: number; z: number; r: number } | null {
    const row = this.locationRows().find((r) => r.id === id);
    if (!row?.shape) return null;
    const m = shapeMiddle(row.shape);
    const c = this.host.world.placeFrame;
    const x = (c?.x ?? 0) - m.x;
    const z = m.z - (c?.z ?? 0);
    const t = this.host.world.terrain;
    const g = t.nearHeightIfCached(x, z) ?? t.heightAt(x, z);
    return { x, y: Number.isFinite(g) ? g : 0, z, r: m.r };
  }

  /** The places of ours as the Here tab lists them (`place:<id>`), nearest the camera first; the world row is the Tools tab's. */
  private placeHereRows(): HereRow[] {
    const p = this.host.player.pos;
    const c = this.host.world.placeFrame;
    const rows: { d: number; row: HereRow }[] = [];
    for (const r of this.locationRows()) {
      if (!r.shape) continue;
      const m = shapeMiddle(r.shape);
      const d = Math.hypot((c?.x ?? 0) - m.x - p.x, m.z - (c?.z ?? 0) - p.z);
      const what = `${r.kind}${buildable(r) ? '' : ', no building'}${drawnOnMap(r) ? '' : ', not on the map'}${r.state ? `, ${r.state}` : ''}`;
      rows.push({ d, row: { id: `${PLACE_ROW}${r.id}`, layer: 'locations', label: `${r.name ?? r.id} (${what})`, away: `${Math.round(d)} m`, stood: true, bad: null } });
    }
    rows.sort((a, b) => a.d - b.d);
    return rows.map((x) => x.row);
  }

  /** Go to a place: the eye over its middle and back from it by its reach, looking down at it. Answers what was said. */
  private goToPlace(id: string): string {
    const m = this.placeMiddle(id);
    if (!m) return `no place ${id}`;
    const back = Math.min(1200, Math.max(30, m.r * 0.9));
    this.host.player.pos.set(m.x, m.y + back * 0.7, m.z + back);
    this.fly.lookAlong(0, -back * 0.7, -back);
    this.fly.stop();
    return `over ${this.locationRows().find((r) => r.id === id)?.name ?? id}`;
  }

  /** A place picked from the Here tab (or the console): the places tool armed if it is not, and the place picked in it. */
  private async pickPlace(id: string): Promise<string> {
    const row = this.locationRows().find((r) => r.id === id);
    if (!row?.shape) return `no place ${id}`;
    if (!this.places.armed) await this.toggleTool('places');
    this.places.picked = id;
    this.window?.refreshEdits();
    return `picked ${row.name ?? id}`;
  }

  /** A place's story area snippet copied (to the clipboard where the page may, and to the console either way). */
  private copyPlaceSnippet(id: string): string {
    const row = this.locationRows().find((r) => r.id === id);
    if (!row?.shape) return `no place ${id}`;
    const text = placeAreaSnippet(row, this.host.packId());
    console.log(text);
    void navigator.clipboard?.writeText(text).catch(() => {});
    this.say(`${row.name ?? id} as a story area copied (and on the console)`, true);
    return text;
  }

  /** A shape in words, for the Selected tab. */
  private shapeWords(s: LocationShape): string {
    const area = shapeArea(s);
    const a = area > 1e6 ? `${(area / 1e6).toFixed(2)} km²` : `${Math.round(area)} m²`;
    if (s.kind === 'circle') return `a circle ${Math.round(s.r)} m round · ${a}`;
    if (s.kind === 'rect') return `a rectangle ${Math.round(s.max[0] - s.min[0])} × ${Math.round(s.max[1] - s.min[1])} m · ${a}`;
    return `an outline of ${s.pts.length} points · ${a}`;
  }

  /** The place picked as the Selected tab shows it, or null. */
  private placeView(): PlaceView | null {
    const id = this.places.picked;
    if (!id) return null;
    const row = this.locationRows().find((r) => r.id === id);
    if (!row?.shape) return null;
    const notes: string[] = [];
    if (!buildable(row)) notes.push('Players may put no house or prop down in it (the editor notes it and refuses nothing).');
    // Said and outlined only while drawn: a place on no map reaches neither the city line nor the minimap.
    if (!drawnOnMap(row)) notes.push('It is not drawn on the maps, so its name is never said and no outline is drawn.');
    else {
      if (saidOnEntry(row)) notes.push('Its name is said on the minimap walking into it.');
      if (row.kind === 'city') notes.push('Its outline is drawn on the minimap.');
    }
    return {
      id,
      name: row.name ?? '',
      kind: row.kind,
      shape: this.shapeWords(row.shape),
      map: drawnOnMap(row),
      say: saidOnEntry(row),
      build: buildable(row),
      own: { map: row.map !== undefined, say: row.say !== undefined, build: row.build !== undefined },
      desc: row.desc ?? '',
      note: row.note ?? '',
      loading: (row.loading ?? []).join('\n'),
      state: row.state ?? '',
      snippet: placeAreaSnippet(row, this.host.packId()),
      words: notes.join(' '),
      // Its sky (the ninth wave): its family among the sky in force's, its weather kind and its grade look's own fields.
      sky: {
        env: row.env ?? '',
        weather: row.weather ?? '',
        grade: { ...(row.grade ?? {}) },
        families: this.host.world.weather.familyNames(),
      },
    };
  }

  /** The places tool as the Tools tab shows it. */
  private placesView(): PlacesToolsView {
    const t = PLACES_TOOL_TUNE;
    const got = this.host.locations?.() ?? { rows: [], bytes: null, problem: null };
    const places = got.rows.filter((r) => r.shape).length;
    const world = got.rows.find((r) => r.id === 'world') ?? null;
    const file = `public/placements/locations/${this.host.packId()}.json: ${places} place${places === 1 ? '' : 's'}${world ? ' and the world row' : ''}${got.bytes ? `, about ${(got.bytes / 1024).toFixed(1)} KB as last read` : ''}${got.problem ? ` (not read: ${got.problem})` : ''}`;
    const notes: string[] = [];
    const no = this.places.refusal();
    if (no) notes.push(no);
    if (this.places.last.said) notes.push(this.places.last.said);
    return {
      armed: this.places.armed,
      mode: t.mode,
      kind: t.kind,
      radius: Math.round(t.radius * 100) / 100,
      draft: this.places.draftN,
      picked: this.places.picked,
      cities: world?.cities === 'noBuild',
      worldLoading: (world?.loading ?? []).join('\n'),
      // The world row's own sky as one box of JSON (the ninth wave), and the families its `env` may name.
      worldSky: Object.keys(skyOfRow(world)).length ? JSON.stringify(skyOfRow(world)) : '',
      families: this.host.world.weather.familyNames(),
      file,
      note: notes.join(' '),
    };
  }

  /**
   * `__debug.locations(o)` (the dev server's half): the places tool's own state and the file as read; `{ tool }` its numbers
   * (`PLACES_TOOL_TUNE`), `{ arm: 'circle' | 'rect' | 'outline' }` (or false), `{ write: { shape, kind, name, map, say, build,
   * loading, desc, note } }` a place written (its shape in the file's own frame, as a story writes one), `{ pick }`, `{ move:
   * { id, dx, dz } }` (the file's frame), `{ size: { id, by } }`, `{ set: { id, ...fields } }` (the ninth wave's `env`,
   * `weather` and `grade` among them), `{ remove }`, `{ cities: 'noBuild' | 'off' }`, `{ worldLoading: [lines] }` and `{ worldSky:
   * { env, weather, grade, climate, fog, wind, clouds } }` the world row, `{ snippet: id }` a place as a story area.
   */
  async locationsDebug(o?: Record<string, unknown>): Promise<unknown> {
    const said: string[] = [];
    let snippet: string | null = null;
    if (o && typeof o === 'object') {
      if (o.tool && typeof o.tool === 'object') said.push(...tunePlacesTool(o.tool));
      if (typeof o.arm === 'string') {
        if (!(PLACES_TOOL_CHOICES.mode as readonly string[]).includes(o.arm)) said.push(`arm is one of ${PLACES_TOOL_CHOICES.mode.join(', ')}`);
        else {
          tunePlacesTool({ mode: o.arm });
          said.push(this.places.armed ? `the places tool: ${o.arm}` : await this.toggleTool('places'));
        }
      }
      if (o.arm === false && this.places.armed) said.push(await this.toggleTool('places'));
      const wr = o.write as Record<string, unknown> | undefined;
      if (wr && typeof wr === 'object') {
        const { shape, ...fields } = wr;
        if (!shape || typeof shape !== 'object') said.push('write takes { shape: { kind: "circle", c: [x, z], r } (or a rect or a poly), kind, name, ... } in the file\'s frame');
        else said.push(await this.places.writePlace(shape as LocationShape, fields as Partial<LocationRow>, 'a place (console)'));
      }
      if (typeof o.pick === 'string') said.push(await this.pickPlace(o.pick));
      if (o.pick === null) this.places.picked = null;
      const mv = o.move as Record<string, unknown> | undefined;
      if (mv && typeof mv === 'object' && typeof mv.id === 'string') {
        // dx along the file's own x: the game's frame mirrors it.
        const dx = typeof mv.dx === 'number' ? mv.dx : 0;
        const dz = typeof mv.dz === 'number' ? mv.dz : 0;
        said.push(await this.places.movePlace(mv.id, -dx, dz));
      }
      const sz = o.size as Record<string, unknown> | undefined;
      if (sz && typeof sz === 'object' && typeof sz.id === 'string' && typeof sz.by === 'number' && sz.by > 0) said.push(await this.places.scalePlace(sz.id, sz.by));
      const st = o.set as Record<string, unknown> | undefined;
      if (st && typeof st === 'object' && typeof st.id !== 'string' && this.places.picked) st.id = this.places.picked;
      if (st && typeof st === 'object' && typeof st.id === 'string') {
        const { id, ...fields } = st;
        said.push(await this.places.setPlace(id as string, fields as Parameters<EditorPlaces['setPlace']>[1]));
      }
      if (typeof o.remove === 'string') said.push(await this.places.remove(o.remove));
      if (o.cities === 'noBuild' || o.cities === 'off') said.push(await this.places.setWorld({ cities: o.cities === 'noBuild' }));
      if (Array.isArray(o.worldLoading)) said.push(await this.places.setWorld({ loading: (o.worldLoading as unknown[]).filter((l): l is string => typeof l === 'string') }));
      // The world row's own sky (the ninth wave), laid over what it has: each field null takes it away, a group's key null that key.
      if (o.worldSky && typeof o.worldSky === 'object') said.push(await this.places.setWorld({ sky: o.worldSky as SkyFields }));
      if (typeof o.snippet === 'string') snippet = this.copyPlaceSnippet(o.snippet);
    }
    const got = this.host.locations?.() ?? { rows: [], bytes: null, problem: null };
    return {
      tool: this.places.report(),
      toolTune: { ...PLACES_TOOL_TUNE },
      file: { rows: got.rows.length, bytes: got.bytes, problem: got.problem },
      ...(snippet ? { snippet } : {}),
      ...(said.length ? { answered: said } : {}),
    };
  }

  /** The first picked row as the Selected tab shows it, or null. */
  private selectedView(): SelectedView | null {
    const ed = this.edits;
    // With an attachment picked by its handle (and no row), its row is shown.
    const first = ed.sel.first ?? this.looks.attachSel?.id ?? null;
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
      // The seventh wave: a mark, its model's materials with their looks, the picker, what is offered, its attachments.
      mark: r.row.kind === 'mark',
      // The interior layout files' wave: a building's furniture, its file's or none, and how it stands here.
      furnished: r.row.kind === 'building' ? r.row.furnish !== false : null,
      furniture: r.row.kind === 'building' ? (this.host.furnitureNote?.(r.row.id) ?? '') : '',
      materials: this.materialsView(first as string),
      picking: this.looks.picking ? `click a surface (or choose a library entry) to take its ${this.looks.picking.take === 'texture' ? 'picture' : 'material'} for ${this.looks.picking.of === '*' ? 'every material' : this.looks.picking.of}; Escape lets go` : '',
      offered: this.looks.choice,
      attachments: (r.row.attach ?? []).map((a, i) => ({
        i,
        words: a.fx ? `effect ${a.fx}` : `sound ${a.snd}`,
        at: (a.at ?? [0, 0, 0]).join(' '),
        size: a.fx ? String(a.size ?? 1) : '',
        picked: this.looks.attachSel?.id === r.row.id && this.looks.attachSel.i === i,
      })),
    };
  }

  /** A row's model's materials for the Selected tab, each with its look in words, its tint and a little picture; null with none loaded. */
  private materialsView(id: string): SelectedView['materials'] {
    const got = this.looks.materialsOf(id);
    if (!got) return null;
    return got.items.map((m) => {
      const l = got.mats.find((x) => x.of === m.name) ?? null;
      return { name: m.name, look: EditorLooks.lookWords(l), tint: l?.tint ?? '', picture: this.swatchOf(m.material) };
    });
  }

  /** A material's little picture (its colour picture drawn small, or its colour), made once a material. */
  private readonly swatches = new WeakMap<THREE.Material, HTMLCanvasElement>();
  private swatchOf(m: THREE.Material): HTMLCanvasElement | null {
    const had = this.swatches.get(m);
    if (had) return had;
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const g = c.getContext('2d');
    if (!g) return null;
    const s = m as THREE.MeshStandardMaterial;
    const img = s.map?.image as CanvasImageSource | undefined;
    let drawn = false;
    if (img) {
      try {
        g.drawImage(img, 0, 0, 32, 32);
        drawn = true;
      } catch {
        drawn = false;
      }
    }
    if (!drawn) {
      const col = s.color ?? new THREE.Color(1, 1, 1);
      g.fillStyle = `#${col.getHexString()}`;
      g.fillRect(0, 0, 32, 32);
    }
    c.title = m.name;
    this.swatches.set(m, c);
    return c;
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
        // A piece of a building's template furniture: its building's furniture made its own first, the row it becomes picked.
        const piece = o.select.find((id): id is string => typeof id === 'string' && !!pieceOfId(id));
        if (piece) {
          this.ownPieceAsked(piece, false);
          said.push(`making the furniture of ${pieceOfId(piece)?.building} its own (the row ${piece} becomes is picked once written)`);
        }
        const ids = o.select.filter((id): id is string => typeof id === 'string' && !!h.rowFor(id));
        ed.sel.pick(ids, 'set');
        if (ids.length !== o.select.length) said.push(`${o.select.length - ids.length} of those ids are in neither file`);
      }
      if (o.select !== undefined) this.window?.refreshEdits();
      // The interior layout files' wave: a piece of a building's template furniture (`<building id>.f<n>`) made its building's
      // own and the row it became picked, waited for (the `select` route above does the same without waiting).
      if (typeof o.own === 'string') {
        const p = pieceOfId(o.own);
        said.push(p ? await this.ownPiece(p.building, p.index) : `${o.own} is no piece of a building's template furniture (<building id>.f<n>)`);
        this.window?.refreshEdits();
      }
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
          else if (k !== 'mats' && k !== 'attach') fields[k] = v;
        }
        if (Object.keys(place).length) said.push(await ed.setPlace(place));
        if (Object.keys(fields).length) said.push(await ed.setField(fields));
        // The seventh wave's: the picked rows' looks and attachments replaced whole, read by the reader's own rule first.
        if (s.mats !== undefined) {
          const mats = s.mats === null ? null : readLooks(s.mats);
          if (mats === null && s.mats !== null) said.push('mats is a list of { of, tint, map, like } the reader would not take');
          else said.push(await this.looks.setAllLooks(mats ?? null));
        }
        if (s.attach !== undefined) {
          const list = s.attach === null ? null : readAttachments(s.attach);
          if (list === null && s.attach !== null) said.push('attach is a list of { fx | snd, at, q, size } the reader would not take');
          else said.push(await this.looks.setAllAttachments(list ?? null));
        }
      }
      // The seventh wave's looks: `look: { of, tint }`, `{ of, take: 'texture' | 'material', from }` (or with no `from`, the
      // picker armed), `{ of, clear: true }`, `{ choose: ref }` (an offered material).
      if (o.look && typeof o.look === 'object' && !Array.isArray(o.look)) said.push(await this.lookDebug(o.look as Record<string, unknown>));
      // An effect or a sound stood as a mark (`mark: { fx | snd, at, size }`, `at` the game's frame, else the aim).
      if (o.mark && typeof o.mark === 'object') said.push(await this.markDebug(o.mark as Record<string, unknown>));
      // One attachment of a row (`attachment: { id, i, pick, move: [dx, dy, dz], turn (degrees), size (a factor), remove }`).
      if (o.attachment && typeof o.attachment === 'object') said.push(await this.attachmentDebug(o.attachment as Record<string, unknown>));
      if (typeof o.attachOnto === 'boolean') this.setTool({ attachOnto: o.attachOnto });
      if (o.status === true) said.push(await ed.refreshStatus());
      // The third wave's: Fold now, and the brush.
      if (o.fold === true) said.push(await this.foldNow());
      if (o.brush && typeof o.brush === 'object') said.push(...(await this.brushDebug(o.brush as Record<string, unknown>)));
      // Map-maker II's Tools list: a tool armed (or let go) by its id, as its key would; null lets whatever is armed go.
      if (typeof o.tool === 'string') said.push(await this.toggleTool(o.tool));
      else if (o.tool === null && this.tools.disarmAll()) said.push('every tool let go');
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
      // How many permanent rows stand folded into their tiers (the seventh wave's smoke reads it across an attachment's move).
      folded: h.world.streamer?.unfoldedReport().folded ?? 0,
      autoFold: { on: EDITOR_TUNE.autoFold, idle: EDITOR_TUNE.autoFoldIdle, hint: EDITOR_TUNE.foldHint, quietFor: round(performance.now() / 1000 - this.activeAt), folding: this.folding },
      brush: this.brush.report(),
      // The Tools list (Map-maker II's groundwork): every tool, its key as bound now and which is armed.
      tools: this.tools.report((a) => capOf(this.host.input.bindings[a][0])),
      // The interior layout files' wave: whether a building put down stands its template's furniture (the Tools tab's switch).
      furnish: EDITOR_TUNE.furnish,
      bar: { writes: this.bar?.writes ?? 0 },
      // The seventh wave's: the picker, the attachment picked, the copies the looks made, what hangs on the rows.
      looks: {
        ...this.looks.report(),
        // The first picked row's materials by name (what a look's `of` names) with the look each wears, or null with none loaded.
        materials: (() => {
          const id = this.edits.sel.first ?? this.looks.attachSel?.id;
          const got = id ? this.looks.materialsOf(id) : null;
          return got ? got.items.map((m) => ({ name: m.name, picture: m.map, look: EditorLooks.lookWords(got.mats.find((x) => x.of === m.name) ?? null) })) : null;
        })(),
        copies: h.world.rowLooks.report(),
        tintStrength: LOOK_TUNE.tintStrength,
      },
      attachments: { ...h.world.rowAttach.report(), onto: this.attachOnto },
      ...(said.length ? { answered: said } : {}),
    };
  }

  /** `editor({ look })`: a material's look on every picked row, by the console. Answers what was said. */
  private async lookDebug(l: Record<string, unknown>): Promise<string> {
    const looks = this.looks;
    if (typeof l.choose === 'string') return looks.choose(l.choose);
    const of = typeof l.of === 'string' ? l.of : '*';
    if (l.clear === true) return looks.setLook(of, { clear: true }, 'clear a look');
    if (l.tint !== undefined) {
      if (l.tint !== null && (typeof l.tint !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(l.tint))) return 'a tint is #rrggbb, or null to take it off';
      return looks.setLook(of, { tint: l.tint as string | null }, 'tint');
    }
    if (l.take === 'texture' || l.take === 'material') {
      if (typeof l.from === 'string') {
        if (!parseDonor(l.from)) return 'from names <pack>:<model>/<material>';
        return looks.setLook(of, l.take === 'texture' ? { map: l.from } : { like: l.from }, l.take === 'texture' ? 'borrow a picture' : 'borrow a material');
      }
      return looks.armPick(of, l.take);
    }
    if (l.take === null) return looks.setLook(of, { map: null, like: null }, 'take a borrowed look off');
    return 'look: { of, tint } | { of, take: "texture" | "material", from } | { of, clear: true } | { choose }';
  }

  /** `editor({ mark })`: an effect or a sound stood as a mark at a point of the game's frame (or the aim). */
  private async markDebug(m: Record<string, unknown>): Promise<string> {
    const raw = typeof m.fx === 'string' ? { fx: m.fx, ...(typeof m.size === 'number' ? { size: m.size } : {}) } : typeof m.snd === 'string' ? { snd: m.snd } : null;
    const list = raw ? readAttachments([raw]) : null;
    if (!list || !list.length) return 'mark: { fx: "<pack>:<file>.json" | snd: "<template>.snd", at: [x, y, z], size }';
    const at = Array.isArray(m.at) && m.at.length === 3 ? { x: Number(m.at[0]), y: Number(m.at[1]), z: Number(m.at[2]) } : undefined;
    const kind = this.editWorld();
    const refusal = editorRefusal(kind, false);
    if (refusal) return refusal;
    return this.placeAttachment({ name: list[0].fx ?? list[0].snd ?? 'mark', key: '' } as Hand, list[0], at ?? { x: this.aim.hit.x, y: this.aim.hit.y, z: this.aim.hit.z });
  }

  /** `editor({ attachment })`: one attachment of a row picked, moved, turned, sized or taken off by the console. */
  private async attachmentDebug(a: Record<string, unknown>): Promise<string> {
    const id = typeof a.id === 'string' ? a.id : (this.edits.sel.first ?? this.looks.attachSel?.id ?? '');
    const i = typeof a.i === 'number' ? Math.max(0, Math.floor(a.i)) : 0;
    const row = this.host.rowFor(id);
    if (!row?.row.attach?.[i]) return `${id || 'nothing picked'} has no attachment ${i + 1}`;
    const looks = this.looks;
    if (a.remove === true) return looks.removeAttachment(id, i);
    if (a.pick === true) {
      looks.pickAttachment(id, i);
      this.edits.sel.clear();
      this.window?.refreshEdits();
      return `attachment ${i + 1} of ${row.label} picked`;
    }
    const mv = Array.isArray(a.move) && a.move.length === 3 ? a.move.map(Number) : [0, 0, 0];
    const turn = typeof a.turn === 'number' ? (a.turn * Math.PI) / 180 : 0;
    const size = typeof a.size === 'number' && a.size > 0 ? a.size : 1;
    return looks.moveAttachment(id, i, { dx: mv[0] || 0, dy: mv[1] || 0, dz: mv[2] || 0, turn, size }, 'move an attachment');
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
      // Through the Tools list, so another armed tool is let go first.
      said.push(await this.tools.arm('brush'));
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
    `${k('editorSculpt')} sculpt brush armed and let go · LMB held raises (or flattens, smooths: Tools tab) · RMB held lowers · C held with the wheel sizes it · Shift+click samples the height`,
    `${k('editorPaint')} paint brush armed and let go · LMB held paints the chosen family or colour (Tools tab) · RMB held erases · Shift+click or the middle button takes what is under it · C held with the wheel sizes it`,
    `${k('editorWater')} water tool armed and let go · LMB a lake's point, a seed to trace, or a fall's ends (Tools tab) · RMB takes one back · a click on a lake's ring picks it: drag its square, ${k('placeLift')} held raises, ${k('putAway')} takes it out`,
    `${k('editorPlaces')} places tool armed and let go · LMB a circle (C held with the wheel sizes it), a rectangle's drag or an outline's point (Tools tab) · RMB takes one back · a click on a place's ring picks it: drag its square, C with the wheel sizes it, ${k('putAway')} takes it out`,
    `${k('editorGameView')} game view · ${k('editorKeys')} this sheet · ${k('editorBody')} body here · ${k('editorHold')} hold the world · Esc give up / clear · F2 leave`,
  ].join('\n');
}

/**
 * The brush's switches, as the Tools tab shows them (the sliders take its numbers; a switch's line would be a boolean,
 * which the debug menu's dials do not carry): each a key of `BRUSH_TUNE` and its words.
 */
const BRUSH_SWITCHES: readonly (readonly ['randomYaw' | 'align' | 'heightOn' | 'keepOffWater' | 'keepOffStanding' | 'keepOffRoads', string])[] = [
  ['randomYaw', 'Random turn'],
  ['align', 'Lean to the ground'],
  ['heightOn', 'Height filter'],
  ['keepOffWater', 'Off the water'],
  ['keepOffStanding', 'Off what stands'],
  ['keepOffRoads', 'Off roads and rivers'],
];

/** The sculpt brush's switches, as the Tools tab shows them: each a key of `SCULPT_TUNE` and its words. */
const SCULPT_SWITCHES: readonly (readonly ['keepOff' | 'carry', string])[] = [
  ['keepOff', 'Off what stands'],
  ['carry', 'Carry what stands on it'],
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
