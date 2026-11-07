// The world editor's Course tool (the race drawer's first wave, `A:\swg3js\racedrawer\DESIGN.md` §2.9, §2.11): a race
// course drawn node by node on the ground, edited by its handles, and its gates placed and edited. The Tools list's entry on
// the apostrophe (`courseTool`, `editorCourse`). From the race drawer's second wave a course carves the ground under it
// (`courseCarve.ts`): a held edit carves live (`preview`), a write carries our rows on the ground it moved and counts (or
// clears) the sculpt's touch-ups it left, and Fit to land, Fit a bridge and Clear old touch-ups are acts of their own.
//
// **Its modes** (the Tools tab's buttons, `course({ arm })`):
// - **draw**: LMB on the ground adds a node, a click near the first node closes and writes a circuit, a click near the last
//   (or Finish) writes a sprint; RMB takes the last node back; V turns the edge being drawn between a curve and a straight. A
//   node takes the land under it, or a drawn road's surface where it is dropped on one. With a course picked, a draft begun on
//   its road is a **shortcut** joined to that road at its start, and joined at its end where it is finished on a road.
// - **edit**: every node of the picked course a diamond and a line across the road at its width with a grabber at each end.
//   A diamond dragged moves its node over the ground (its height kept); F held with the mouse raises it; a grabber dragged
//   along its line widens the road and up or down banks it (R held with the mouse banks it too); C with the wheel steps the
//   shoulder; a click on the road between two nodes puts one in there; Delete takes the picked node out; V turns the edge
//   leaving it; the arrows and Page Up and Down nudge it a grid step. A click on another course's road picks that course.
// - **gates**: the picked course's gates drawn as the run draws them, one picked by a click near its outline: its ground
//   square dragged (the point grabbed kept under the cursor), F held raises it and R held turns it (each pinning it where it
//   is put), C with the wheel widens it (a following gate keeps following at its own width), the arrows nudge it, Delete takes
//   it out. Place gates again and Follow are the Tools tab's.
//
// **Every action is one write and one undo entry**: the track's whole row before and after, through the editing's stroke
// (`beginStroke`, `strokeWrite`, `endStroke`) into the world's track file (`public/tracks/<world>.json`, the batch's
// `tracks` kind), the course settled as it is written (`courseEdit.ts`: rounded as the writer rounds, near nodes merged,
// joins and following gates placed again). A held edit is kept in memory (`live`) and written once on release; refused, the
// course is what the file says and the refusal is said, with the restart's words for an endpoint from before the tracks.
//
// **A frame makes nothing**: the courses' places in the game's frame are worked out once a change (`views`, and a held edit's
// course again at `previewHz`), and a frame only projects them into the marks' kept arrays, every sample within `drawNear` of
// the eye and every fourth past it, nothing past `drawReach`.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties. The dev server's alone: reached only through the editor's own dynamic import.

import { courseSpines, readTrack, trackHash, type CourseNode, type TrackDef } from '../race/trackFile.ts';
import { rightOf, spineAt, spinePoint, type Spine } from '../race/coursePath.ts';
import { CourseCarve, deckAsk, type CarveSample } from '../swg/terrain/courseCarve.ts';
import { HEIGHT_POLE, HEIGHT_TILE_POLES, type HeightEdits } from '../swg/terrain/heightEdits.ts';
import { tileIdOf, type HeightTileRow } from '../world/editFiles/heightsFile.ts';
import type { PlacementLayer, PlacementRow } from '../story/placements.ts';
import { tileBytes } from './editorSculpt.ts';
import { SCULPT_TUNE } from './editorTune.ts';
import { bakeGate, gateCorners, GATE_STRIDE } from '../race/gates.ts';
import { COURSE_TUNE, tuneCourse } from '../race/courseTune.ts';
import { toGame } from '../story/placements.ts';
import { olderTracksEndpoint, TRACKS_OLDER_ENDPOINT } from '../world/placementEdits.ts';
import { coursePools, projectAt } from '../ui/editorMarks.ts';
import { cursor, dragAt, gizmoDrag, gizmoLayout, grabAt, H, ray3, rayAt, type ScreenView } from './gizmo.ts';
import { EDITOR_TUNE } from './editorTune.ts';
import type { EditorEdits } from './editorEdit.ts';
import type { RowChange } from './undo.ts';
import type { ToolDef, ToolDraw, ToolFrame } from './tools.ts';
import type { EditorSection } from '../ui/editorWindow.ts';
import {
  addShortcut,
  courseCrossings,
  courseCtx,
  courseFromGates,
  fitToLand,
  courseNotes,
  deleteNode,
  drawTrack,
  gateDeleted,
  gateFollowed,
  gateMoved,
  gateNudged,
  gateRaised,
  gateTurned,
  gateWidened,
  insertNode,
  keepsNumbering,
  mintTrack,
  moveNode,
  onRoad,
  pathIndex,
  placeGatesAgain,
  setCourse,
  setNode,
  setTrack,
  toggleCurve,
  type CourseCtx,
  type CourseEdit,
  type NodeFields,
} from './courseEdit.ts';

/** What the Course tool needs of the editor and the game. */
export interface CourseHost {
  readonly edits: EditorEdits;
  /** What kind of world: a course is carved into ground, so a space zone and the copies refuse the tool. */
  worldKind(): 'ground' | 'space' | 'copies';
  /** Whether the race pass reads the track file now (with it off no track is read, so none can be edited). */
  raceOn(): boolean;
  /** This world's track file as read: its tracks, or null where it is not read (the race pass off, a world still arriving). */
  tracks(): readonly TrackDef[] | null;
  /** A point of the game's frame in the file's raw frame, and back, into a kept record. */
  toRaw(x: number, z: number, out: { x: number; z: number }): void;
  toGame(x: number, z: number, out: { x: number; z: number }): void;
  /** The layout's centre the raw frame is written about (null: nought). */
  centre(): { x: number; z: number } | null;
  /** The land under a point of the file's (raw) frame: the generator's ground and the sculpt's delta there; NaN for none known. */
  land(x: number, z: number): number;
  /** The same where the ground is built already, else NaN (what the notes read: never a block made for them). */
  landKnown(x: number, z: number): number;
  /** The water's surface over a point of the raw frame (-Infinity for none). */
  water(x: number, z: number): number;
  /** The editor's grid step (m): what the arrows nudge by. */
  grid(): number;
  /** The world's file key. */
  packId(): string;
  /**
   * Which world the editor is in (the world's generation, `EditorEdits`' own mark): a draft, a pick and the views kept from
   * another world are given up at the tool's next use, since a world left with the editor off sends the tool no `worldGone`.
   */
  worldMark(): number;
  say(words: string, ok: boolean): void;
  /** The window drawn again (a pick or a write moved what its sections show). */
  refresh(): void;
  // ---- The race drawer's second wave: the carve. Each optional, so a host without them (the first wave's) carves nothing. ----
  /**
   * The world's drawn courses carved again from `tracks` (the file's, a held edit laid over), `preview` while a drag is held
   * (live, a budget at a time) and false to put the file's back (a drag given up or refused); the focus a point of the game's
   * frame (NaN: the eye).
   */
  carve?(tracks: readonly TrackDef[], fx: number, fz: number, preview: boolean): void;
  /**
   * The world's drawn courses as it last landed them (a landing's list, never a held drag's preview): what a drag given up,
   * refused or let go with nothing to write is carved back to. Without it the file's tracks are, and nothing where the file
   * is not read (the race switch off, a world still arriving): handed none, the world un-carves every course it holds.
   */
  carved?(): readonly TrackDef[];
  /** The ground with nothing drawn carved and no edit laid (the generator's) at a point of the raw frame; NaN for none known. */
  rawGround?(x: number, z: number): number;
  /** Rows of ours standing now (what a course action carries), at their places in the game's frame. */
  standing?(): CourseCarryRow[];
  /** How far a standing row's own box's lowest point stands under its origin (negative under it), or null with no box. */
  lowestOf?(id: string): number | null;
  /** The world's height edits, or null (what a moved stretch's touch-ups are read from). */
  heights?(): HeightEdits | null;
  /** The heights file's row for a tile as the file holds it now, or null. */
  heightRow?(id: string): HeightTileRow | null;
  /** Bytes deflated (deflate-raw) and written as base64. */
  deflate?(bytes: Uint8Array): Promise<string>;
  /**
   * What stands on a road, for the notes: every placed object's foot within a raw-frame rectangle that `on` says meets the
   * road (asked at its middle and its reach, raw frame), counted by whose (`LayoutStreamer.forEachStandingFoot`); and whether
   * a solid row stands over a point of the raw frame between two heights (a crossing's bridge), with its top's height there,
   * or NaN.
   */
  feetIn?(x0: number, z0: number, x1: number, z1: number, on: (x: number, z: number, r: number) => boolean): { game: number; ours: number; players: number };
  solidTopAt?(x: number, z: number, low: number, high: number): number;
  /**
   * What a course's road keeps away (§2.11's note): of the world's people, the posts whose stand, roam or round a store of the
   * track alone keeps by its no-spawn zones, and of the wildlife, the sites a laying without this track's own zones lays that
   * they keep off. A change's work (a laying, 30 to 40 ms measured on the converted worlds), which the tool asks once a road.
   */
  keptAway?(store: CourseCarve): { posts: number; sites: number };
  /** A model of the library stood as a permanent row over a crossing (Fit a bridge): the thing in hand, else the brush's first entry. */
  fitBridge?(ask: BridgeAsk): Promise<{ ok: boolean; words: string }>;
}

/** A row of ours standing, as a course action's carry reads it: its id, file and row, its place in the game's frame. */
export interface CourseCarryRow {
  id: string;
  layer: PlacementLayer;
  row: PlacementRow;
  x: number;
  y: number;
  z: number;
}

/** A bridge to fit over a crossing (the raw frame): its middle, the upper road's way and surface, the gap's span and the road's width. */
export interface BridgeAsk {
  x: number;
  z: number;
  /** The upper road's surface at the middle and at each end of the span, and its way (a unit vector of the raw frame). */
  deck: number;
  deckA: number;
  deckB: number;
  ux: number;
  uz: number;
  /** The gap's span along the upper road (the lower road and its margins, m) and the upper road's width there. */
  span: number;
  width: number;
}

/** What a held edit is. */
type Held = 'none' | 'node' | 'width' | 'raise' | 'bank' | 'gate' | 'gateRaise' | 'gateTurn';

export type CourseMode = 'draw' | 'edit' | 'gates';
export const COURSE_MODES: readonly CourseMode[] = ['draw', 'edit', 'gates'];

/** A course's places in the game's frame, worked out once a change: what a frame projects. */
interface CourseView {
  id: string;
  /** Per path: the spine's samples, its edges and its shoulders' outer edges, three numbers a point, and how many. */
  paths: { spine: Float64Array; left: Float64Array; right: Float64Array; outL: Float64Array; outR: Float64Array; n: number }[];
  /** Per node of every path in order: the node and the two ends of its width line, nine numbers a node; which path and node. */
  nodes: Float64Array;
  nodeRef: Int32Array;
  /** Every gate's window, twelve numbers a gate (bottom left, bottom right, top right, top left), and the grid's place. */
  gates: Float64Array;
  gateN: number;
  /** Its box on the ground (game frame), for the draw's reach. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const NO_TRACKS: readonly TrackDef[] = [];
/** How long an ask that waits for a second stands (ms): the Gates view's own window for a first save (`App.trackArmed`). */
const ASK_AGAIN_MS = 15000;

/** The Course tool. */
export class EditorCourse {
  armed = false;
  mode: CourseMode = 'draw';
  private readonly host: CourseHost;
  /** The picked course (its track's id), node (path and index) and gate. */
  picked: string | null = null;
  pickedPath = 0;
  pickedNode = -1;
  pickedGate = -1;
  /** The draft under way: points of the file's (raw) frame with their heights and the edge leaving each; a shortcut's join. */
  readonly draft: { x: number; z: number; y: number; c: 'smooth' | 'straight' }[] = [];
  private draftJoin: string | null = null;
  /** The draft's points in the game's frame, three numbers each, kept for the frame. */
  private draftG = new Float64Array(12);
  /** A held edit: what it is, the course it holds in memory, and its grab. */
  private held: Held = 'none';
  /** The course as a held edit leaves it (written once on release), or null. */
  live: TrackDef | null = null;
  private liveAt = -Infinity;
  private grabSide = 1;
  private grabX = 0.5;
  private grabY = 0.5;
  private lineUX = 0.5;
  private lineUY = 0.5;
  private grabB = 0.5;
  private grabW = 0.5;
  private raise = 0.5;
  private bankBy = 0.5;
  private turnBy = 0.5;
  private sizeBy = 0.5;
  private sizeAt = -Infinity;
  /**
   * What C with the wheel stepped: the track, the mode, the path and the node's or gate's index, and the track's row as it
   * numbered them (`sizeBase`). The steps are written as the wheel rests only while the pick has named that index on every
   * frame since and the course still numbers it as it did (`keepsNumbering`), so neither a node picked meanwhile nor one put
   * in, taken out or placed again before it (an edit of the tool's, an undo, the dev server's word) takes another's steps.
   */
  private sizeTrack: string | null = null;
  private sizeMode: CourseMode = 'edit';
  private sizePath = 0;
  private sizeIndex = -1;
  private sizeBase: TrackDef | null = null;
  /** Where the width grabber was grabbed on its level plane, in the file's (raw) frame: the width moves by the cursor's travel from it. */
  private grab0x = 0.5;
  private grab0z = 0.5;
  /** Kept points of the game's frame (a grabbed point, a grabber and the same a metre up) for the screen, three numbers each. */
  private readonly p3 = new Float64Array(6);
  private readonly pt2 = new Float64Array(2);
  /** Draw its course from its gates asked once: a second ask of the same track within `ASK_AGAIN_MS` writes it. */
  private fromAsked: { id: string; until: number } | null = null;
  /** The world this tool's draft, pick and views are of (the host's mark), and whether one has been seen. */
  private seenWorld = 0;
  private worldSeen = false;
  private writing: Promise<string> | null = null;
  private wasApply = false;
  private wasInverse = false;
  private wasLift = false;
  private wasTurn = false;
  /** The cursor's last place on the screen: Point hands a tool no mouse movement, so F and R held read the cursor's travel. */
  private lastSy = Number.NaN;
  private lastSx = Number.NaN;
  /** This frame's inputs, kept by `step` for `overlay`. */
  private readonly f: ToolFrame = { apply: false, inverse: false, shift: false, sampled: false, x: 0.5, y: 0.5, z: 0.5, valid: false, dt: 0.016, now: 0.5, sx: 0.5, sy: 0.5, dy: 0.5, lift: false, turn: false, dx: 0.5 };
  /** The courses' views, made again when the file's tracks or the held course are another list. */
  private views: CourseView[] = [];
  private viewsOf: readonly TrackDef[] | null = null;
  private viewsLive: TrackDef | null = null;
  private seenTracks: readonly TrackDef[] | null = null;
  private viewPoints = 0;
  private viewNodes = 0;
  private viewGates = 0;
  /** The hover this frame: a node's index in the picked view (its diamond or a grabber) and a gate's. */
  private hotNode = -1;
  private hotGrab = 0;
  private hotGate = -1;
  // Kept for the frame: nothing in a steady frame is made.
  private readonly cur = cursor();
  private readonly ray = ray3();
  private readonly drag = gizmoDrag();
  private readonly pt = new Float64Array(2);
  private readonly at = { x: 0.5, z: 0.5 };
  private readonly at2 = { x: 0.5, z: 0.5 };
  private readonly gridPivot = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly spt = spinePoint();
  /** The frame's registers (the hover's running best, a gate's nearest edge), fractions from the start. */
  private readonly reg = new Float64Array(4);
  /** What the last action came to, for the console and the bar; the notes of the picked course. */
  last = { said: '', ok: true };
  notes: string[] = [];

  constructor(host: CourseHost) {
    this.host = host;
  }

  /** Whether a write or a held edit is under way (the automatic fold's quiet). */
  get busy(): boolean {
    return !!this.writing || this.held !== 'none';
  }

  /**
   * Why the world refuses the tool, in words, or null. The race pass switched on after an arrival read nothing at that
   * arrival, so its file is read again by hand (`track({ reload: true })`) before anything is drawn over it.
   */
  refusal(): string | null {
    const k = this.host.worldKind();
    if (k === 'space') return 'a course is carved into ground: space is a later pass';
    if (k === 'copies') return "no course is drawn in the dungeons' world of copies";
    if (!this.host.raceOn()) return 'the race pass is switched off, so no track is read: race({ on: true }), then track({ reload: true })';
    if (!this.host.tracks()) return "this world's track file is not read yet: track({ reload: true })";
    return null;
  }

  /**
   * Whether the world is the one this tool's draft, pick and views are of. Another (left with the editor off, which sends the
   * tool no `worldGone`) gives them up first, so a draft clicked on one world is never written into the next world's file.
   */
  private sameWorld(): boolean {
    const m = this.host.worldMark();
    if (this.worldSeen && m === this.seenWorld) return true;
    const had = this.worldSeen;
    this.worldSeen = true;
    this.seenWorld = m;
    if (had) this.worldGone();
    return !had;
  }

  /** The apostrophe: armed, or refused in words. */
  async arm(): Promise<string> {
    this.sameWorld();
    const no = this.refusal();
    if (no) {
      this.host.say(no, false);
      return no;
    }
    this.armed = true;
    const words = `the Course tool: ${this.modeWords()} (' lets go)`;
    this.host.say(words, true);
    return words;
  }

  /** Let go: a draft and a held edit given up (nothing written). */
  disarm(): void {
    this.armed = false;
    this.giveUpHeld();
  }

  /** The world went: everything dropped, and the world now standing taken as the one the tool is of. */
  worldGone(): void {
    this.disarm();
    this.draft.length = 0;
    this.draftJoin = null;
    this.picked = null;
    this.pickedNode = -1;
    this.pickedGate = -1;
    this.fromAsked = null;
    this.views = [];
    this.viewsOf = null;
    this.viewsLive = null;
    // The touch-ups the last action left were measured on the world that went: cleared on the next, they wrote that world's
    // tile ids and poles into this one's heights file (the owner's own sculpt deltas zeroed, a tile deleted outright).
    this.touchLeft = [];
    this.touchWorld = Number.NaN;
    this.carried.rows = 0;
    this.carried.touchLeft = 0;
    this.carried.touchTiles = 0;
    this.carried.cleared = 0;
    this.notes = [];
    this.seenWorld = this.host.worldMark();
    this.worldSeen = true;
  }

  /** The track file landed (the tool's own write, an undo, the dev server's word): the views made again at the next frame. */
  landed(): void {
    this.viewsOf = null;
    // The touch-ups were measured against the course the action wrote: once the file holds another (an undo, a redo, the
    // dev server's word), they may lie under the road again, so the notes stop naming them and the button goes off.
    if (this.touchLeft.length) {
      const nl = this.touchFor.indexOf('\n');
      const id = this.touchFor.slice(0, nl);
      const k = this.tracks().find((x) => x.id === id);
      if (!k || `${id}\n${trackHash(k)}` !== this.touchFor) {
        this.touchLeft = [];
        this.touchFor = '';
        this.carried.touchLeft = 0;
        this.carried.touchTiles = 0;
      }
    }
    const t = this.track();
    if (this.picked && !t) {
      this.picked = null;
      this.pickedNode = -1;
      this.pickedGate = -1;
    }
    if (t) this.notes = this.notesOf(t);
  }

  /**
   * A held edit given up, and with it the shoulder or width steps C with the wheel has not yet written, unless `keepSize`:
   * a drag let go keeps them (they are written as the wheel rests, to what they were stepped on), where Escape, a mode, a
   * disarm and a world going give them up too.
   */
  private giveUpHeld(keepSize = false): void {
    this.held = 'none';
    // A drag carved live and given up (Escape, a mode, a disarm, the world going): the file's courses carved back.
    if (this.carvedLive && !keepSize) this.carveBack();
    this.live = null;
    this.raise = 0;
    this.bankBy = 0;
    this.turnBy = 0;
    if (keepSize) return;
    this.sizeBy = 0;
    this.sizeAt = -Infinity;
    this.sizeTrack = null;
    this.sizeBase = null;
  }

  private modeWords(): string {
    const m = this.mode;
    return m === 'draw'
      ? 'drawing (LMB a node, near the first closes a circuit, near the last finishes a sprint, RMB takes one back, V a curve or a straight)'
      : m === 'edit'
        ? "editing (drag a node's diamond, its width line's grabbers, F raises, R banks, C with the wheel its shoulder, a click on the road puts a node in)"
        : 'gates (a click near one picks it: drag its square, F raises, R turns, C with the wheel widens, Delete takes it out)';
  }

  /** A mode chosen (the Tools tab's buttons, the console's `arm`). */
  setMode(m: CourseMode): string {
    this.mode = m;
    this.giveUpHeld();
    if (m !== 'draw') {
      this.draft.length = 0;
      this.draftJoin = null;
    }
    const words = `the Course tool: ${this.modeWords()}`;
    this.host.say(words, true);
    return words;
  }

  /** The file's tracks now (none while it is not read). */
  private tracks(): readonly TrackDef[] {
    return this.host.tracks() ?? NO_TRACKS;
  }

  /** The picked track as the file holds it, or null (a frame asks it: a loop, never a closure handed to `find`). */
  track(): TrackDef | null {
    const id = this.picked;
    if (!id) return null;
    const tr = this.tracks();
    for (let i = 0; i < tr.length; i++) if (tr[i].id === id) return tr[i];
    return null;
  }

  /** What an edit is judged with: the tune's rules, the land and the water under a point of the raw frame. */
  ctx(): CourseCtx {
    const c = courseCtx((x, z) => this.host.land(x, z));
    c.water = (x, z) => this.host.water(x, z);
    // Where the world carves (the race drawer's second wave), a gate under a crossing is held under its deck.
    if (this.host.carve) c.decks = true;
    return c;
  }

  /** What the notes are judged with: the land only where the ground is built (never a block made for a note), and the water. */
  private notesCtx(): CourseCtx {
    const c = courseCtx((x, z) => this.host.landKnown(x, z));
    c.water = (x, z) => this.host.water(x, z);
    return c;
  }

  /** The notes of a course: its shape's (the first wave's) and, where the world carves, what its carve does (the second wave's). */
  notesOf(t: TrackDef): string[] {
    const out = courseNotes(t, this.notesCtx());
    if (this.host.carve) out.push(...this.carveNotes(t));
    return out;
  }

  /**
   * What a course's carve does, in words, never a refusal (§2.11): each crossing and its clearance (under `clearanceNote`
   * said so), a crossing with no solid row over it (Fit a bridge), a bridge whose top stands off the deck past `deckLip`, a
   * hairpin whose legs overlap at different heights (an underpass by the rule), what of the game's, ours and the players'
   * stands on the road, and the touch-ups the last change left standing where the road was. A change's work.
   */
  private carveNotes(t: TrackDef): string[] {
    const out: string[] = [];
    if (!t.course) return out;
    const tune = COURSE_TUNE;
    for (const c of courseCrossings(t)) {
      const at = `near (${Math.round(c.x)}, ${Math.round(c.z)})`;
      if (c.hairpin) {
        out.push(`the legs of ${c.upper}'s hairpin overlap ${c.clearance.toFixed(1)} m apart in height ${at}: the lower is carved through`);
        continue;
      }
      out.push(`${c.upper} crosses over ${c.lower} ${at} with ${c.clearance.toFixed(1)} m of clearance${c.clearance < tune.clearanceNote ? ` (under ${tune.clearanceNote} m: a pod's box is 3 m tall)` : ''}`);
      const top = this.host.solidTopAt ? this.host.solidTopAt(c.x, c.z, c.low + 0.5, c.deck + 5) : Number.NaN;
      if (!Number.isFinite(top)) out.push(`no solid row stands over the crossing ${at}: the gap is a gap (Fit a bridge)`);
      else if (Math.abs(top - c.deck) > tune.deckLip) out.push(`the bridge over the crossing ${at} stands ${(top - c.deck).toFixed(2)} m off the deck (more than ${tune.deckLip} m)`);
      else {
        // §2.11: off the deck "at either abutment" (a flat bridge over a road that climbs across the gap stands proud of it at
        // one end, which the race box meets as a scrape), each end read a pole inside the gap against the road there.
        for (const [x, z, road, which] of [[c.xA, c.zA, c.deckA, 'its first'], [c.xB, c.zB, c.deckB, 'its far']] as const) {
          const end = this.host.solidTopAt!(x, z, c.low + 0.5, Math.max(road, c.deck) + 5);
          if (Number.isFinite(end) && Math.abs(end - road) > tune.deckLip) out.push(`the bridge over the crossing ${at} stands ${(end - road).toFixed(2)} m off the deck at ${which} end (more than ${tune.deckLip} m)`);
        }
      }
    }
    const store = new CourseCarve();
    store.set([t]);
    const kept = this.keptAwayOf(t, store);
    if (kept && kept.posts + kept.sites > 0) {
      const parts: string[] = [];
      if (kept.posts) parts.push(`${kept.posts} of the people's post${kept.posts === 1 ? '' : 's'}`);
      if (kept.sites) parts.push(`${kept.sites} wild site${kept.sites === 1 ? '' : 's'}`);
      out.push(`the road keeps ${parts.join(' and ')} away (no-spawn, never no-enter)`);
    }
    const meets = this.feetOn(t, store);
    if (meets && meets.game + meets.ours + meets.players > 0) {
      const parts: string[] = [];
      if (meets.game) parts.push(`${meets.game} of the game's objects`);
      if (meets.ours) parts.push(`${meets.ours} of ours`);
      if (meets.players) parts.push(`${meets.players} of the players' things`);
      out.push(`the road meets ${parts.join(', ')} (they stand where they stood: the carve keeps off nothing placed)`);
    }
    if (this.carried.touchLeft > 0) out.push(`${this.carried.touchLeft} pole${this.carried.touchLeft === 1 ? '' : 's'} of sculpt touch-ups left standing where the road was (${this.carried.touchTiles} tile${this.carried.touchTiles === 1 ? '' : 's'}): Clear old touch-ups`);
    return out;
  }

  /**
   * The last answer to what a course's road keeps away, kept by what it was asked of: the world (its mark), the answerer, the
   * track and its road (its kind, its `clear` and its course's text). The answer is a laying of the world's wild sites, 30 to
   * 40 ms measured on the converted worlds, and the notes are worked out at every landing and every pick (twice for one of the
   * tool's own writes: as the write's answer comes back and as the next frame sees the tracks land), so asked afresh it cost
   * every landing that much and every write twice that; kept, a landing that moves no road of this course (a gate, its name,
   * another track, an undo of either) asks nothing again. Another course's road or the removal file moved meanwhile is
   * read at this road's next change (a note, never a refusal).
   */
  private readonly kept = { mark: Number.NaN, fn: null as ((store: CourseCarve) => { posts: number; sites: number }) | null, id: '', road: '', posts: 0, sites: 0 };

  /** What a course's road keeps away of the people's posts and the wild sites (the notes), asked of the world once a road (`kept`); null where the host cannot say. */
  private keptAwayOf(t: TrackDef, store: CourseCarve): { posts: number; sites: number } | null {
    const fn = this.host.keptAway;
    if (!fn) return null;
    const k = this.kept;
    const mark = this.host.worldMark();
    const road = JSON.stringify([t.kind, t.clear, t.course ?? null]);
    if (k.fn === fn && k.mark === mark && k.id === t.id && k.road === road) return k;
    const got = fn.call(this.host, store);
    k.fn = fn;
    k.mark = mark;
    k.id = t.id;
    k.road = road;
    k.posts = got.posts;
    k.sites = got.sites;
    return k;
  }

  /**
   * What of the game's, ours and the players' stands on a course's road (§2.11's note: the carve keeps off nothing placed):
   * a store of the track alone, every foot in its box asked at its middle and at its reach's four sides. A change's work.
   */
  private feetOn(t: TrackDef, store: CourseCarve): { game: number; ours: number; players: number } | null {
    if (!this.host.feetIn || !t.course) return null;
    const box = store.extent();
    if (!box) return null;
    const on = (x: number, z: number, r: number): boolean =>
      store.roadAt(x, z, 2) || (r > 0 && (store.roadAt(x + r, z, 2) || store.roadAt(x - r, z, 2) || store.roadAt(x, z + r, 2) || store.roadAt(x, z - r, 2)));
    return this.host.feetIn(box.x0, box.z0, box.x1, box.z1, on);
  }

  /** Fit to land (§2.11): the picked path's nodes set to the land under them, and nodes put in where the land leaves the road's line. One action. */
  async fitLand(id?: string): Promise<string> {
    const t = id ? this.tracks().find((x) => x.id === id) ?? null : this.track();
    if (!t || !t.course) return this.said('pick a course first', false);
    return this.write(`${t.name} fitted to the land`, t, fitToLand(t, t.course.paths[Math.min(this.pickedPath, t.course.paths.length - 1)]?.id, this.ctx()));
  }

  /**
   * Fit a bridge (§2.11): the thing in hand (else the scatter brush's first entry) stood as a permanent row over the picked
   * course's crossing nearest the aim, through the editor's own put path (`CourseHost.fitBridge`): centred on it, turned along
   * the upper road, scaled along its length to span the gap and its margins, its walkable top on the deck. The course untouched.
   */
  async fitBridge(id?: string): Promise<string> {
    const t = id ? this.tracks().find((x) => x.id === id) ?? null : this.track();
    if (!t || !t.course) return this.said('pick a course first', false);
    if (!this.host.fitBridge) return this.said('the bridge is fitted by the world editor', false);
    const cs = courseCrossings(t).filter((c) => !c.hairpin);
    if (!cs.length) return this.said(`${t.name} crosses itself nowhere (raise one crossing's node over the other road)`, false);
    let pick = cs[0];
    if (this.f.valid) {
      this.host.toRaw(this.f.x, this.f.z, this.at);
      let best = Infinity;
      for (const c of cs) {
        const d = Math.hypot(c.x - this.at.x, c.z - this.at.z);
        if (d < best) {
          best = d;
          pick = c;
        }
      }
    }
    const margin = t.course.margin;
    const said = await this.host.fitBridge({ x: pick.x, z: pick.z, deck: pick.deck, deckA: pick.deckA, deckB: pick.deckB, ux: pick.ux, uz: pick.uz, span: pick.span + 2 * margin + 4, width: pick.width });
    this.notes = this.notesOf(t);
    return this.said(said.words, said.ok);
  }

  // ---- The keys and the frame. ----

  /** Escape: a held edit given up, then a draft, then the pick; answers whether it took the key. */
  escape(): boolean {
    if (this.held !== 'none') {
      this.giveUpHeld();
      this.host.say('the edit given up: nothing written', true);
      return true;
    }
    if (this.draft.length) {
      this.draft.length = 0;
      this.draftJoin = null;
      this.host.say('the draft given up', true);
      return true;
    }
    if (this.pickedGate >= 0 || this.pickedNode >= 0) {
      this.pickedGate = -1;
      this.pickedNode = -1;
      this.host.refresh();
      return true;
    }
    if (this.picked) {
      this.picked = null;
      this.host.refresh();
      return true;
    }
    return false;
  }

  /** V: the edge being drawn, or the edge leaving the picked node, turned between a curve and a straight. Answers whether it took it. */
  toggle(): boolean {
    if (!this.armed) return false;
    if (this.mode === 'draw' && this.draft.length) {
      const last = this.draft[this.draft.length - 1];
      last.c = last.c === 'smooth' ? 'straight' : 'smooth';
      this.host.say(`the edge being drawn: ${last.c === 'smooth' ? 'a curve' : 'a straight'}`, true);
      return true;
    }
    if (this.mode === 'draw') {
      COURSE_TUNE.curve = COURSE_TUNE.curve === 'smooth' ? 'straight' : 'smooth';
      this.host.say(`a new edge: ${COURSE_TUNE.curve === 'smooth' ? 'a curve' : 'a straight'}`, true);
      return true;
    }
    const t = this.track();
    if (this.mode === 'edit' && t && this.pickedNode >= 0) {
      void this.write('a curve or a straight', t, toggleCurve(t, this.pathId(t), this.pickedNode, this.ctx()));
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

  /** Whether it takes the mouse with F or R held: a picked node or gate is raised, banked or turned, and the camera holds still. */
  holdsMouse(lift: boolean, turn?: boolean): boolean {
    if (!this.armed || this.writing) return false;
    const picked = (this.mode === 'edit' && this.pickedNode >= 0) || (this.mode === 'gates' && this.pickedGate >= 0);
    return picked && (lift || turn === true);
  }

  /**
   * C held with the wheel: the picked node's shoulder stepped, or the picked gate widened, written a moment after the wheel
   * rests, to the node or gate the steps were taken on (`sizeStale`): steps taken on another, or on a course numbered again
   * since, are given up and said, and these start their count again.
   */
  size(notches: number): string | null {
    if (!this.armed) return null;
    const t = this.track();
    if (!t) return null;
    const index = this.mode === 'edit' ? this.pickedNode : this.mode === 'gates' ? this.pickedGate : -1;
    if (index < 0 || (this.mode === 'gates' && !t.gates[index])) return null;
    if (this.sizeBy !== 0) {
      const why = this.sizeStale(t);
      if (why) this.dropSize(why);
    }
    // A run of steps begun: the track's row as it numbers what they are taken on.
    if (this.sizeBy === 0) this.sizeBase = t;
    this.sizeTrack = t.id;
    this.sizeMode = this.mode;
    this.sizePath = this.pickedPath;
    this.sizeIndex = index;
    this.sizeAt = this.f.now;
    if (this.mode === 'edit') {
      this.sizeBy += notches * COURSE_TUNE.shoulderStep;
      const n = this.nodeOf(t);
      return n ? `shoulder ${Math.max(0, n.sh + this.sizeBy).toFixed(2)} m (written as the wheel rests)` : null;
    }
    this.sizeBy += notches * COURSE_TUNE.gateWidthStep;
    return `gate ${index} ${(t.gates[index].w + this.sizeBy).toFixed(1)} m wide (written as the wheel rests)`;
  }

  /** The wheel's steps not yet written given up, said where there were any, with why (`sizeStale`'s answer). */
  private dropSize(why: 'picked' | 'renumbered' | 'gone'): void {
    if (this.sizeBy !== 0) {
      const node = this.sizeMode === 'edit';
      const thing = node ? 'node' : 'gate';
      const because =
        why === 'picked'
          ? `the pick left that ${thing} before they were written`
          : why === 'gone'
            ? 'the course went before they were written'
            : `the course's ${thing}s were numbered again before they were written (${node ? 'a node put in or taken out' : 'the gates placed again or one taken out'}, or an undo), so they would have gone to another ${thing}`;
      this.host.say(`the wheel's ${node ? 'shoulder' : 'width'} steps given up: ${because}`, false);
    }
    this.sizeBy = 0;
    this.sizeAt = -Infinity;
    this.sizeTrack = null;
    this.sizeBase = null;
  }

  /** Whether the pick now is what the wheel's steps were taken on (its track, mode, path and node or gate). */
  private sizeTarget(): boolean {
    if (this.sizeTrack === null || this.sizeTrack !== this.picked || this.sizeMode !== this.mode) return false;
    if (this.mode === 'edit') return this.sizePath === this.pickedPath && this.sizeIndex === this.pickedNode;
    return this.mode === 'gates' && this.sizeIndex === this.pickedGate;
  }

  /**
   * Why the wheel's steps waiting no longer name what they were taken on, or null where they still do: the pick moved off
   * it (asked every frame while they wait, so a node taken out and another put in at its index never takes them), the track
   * went, or the course was numbered again since they began (`keepsNumbering` against the row they were taken on: whatever
   * landed, the tool's own insert, delete or Place gates again, an undo, the dev server's word). A course that still numbers
   * it is kept as the new base, so a drag of the stepped node itself keeps them. Nothing is made.
   */
  private sizeStale(t: TrackDef | null): 'picked' | 'renumbered' | 'gone' | null {
    if (!this.sizeTarget()) {
      const tr = this.tracks();
      for (let i = 0; i < tr.length; i++) if (tr[i].id === this.sizeTrack) return 'picked';
      return 'gone';
    }
    if (!t) return 'gone';
    const base = this.sizeBase;
    if (t === base) return null;
    if (!base || !keepsNumbering(base, t, this.sizeMode === 'edit' ? 'nodes' : 'gates', this.sizePath, this.sizeIndex)) return 'renumbered';
    this.sizeBase = t;
    return null;
  }

  /** Delete: the picked node or gate taken out (one write). Answers whether it took the key. */
  deleteKey(): boolean {
    if (!this.armed) return false;
    const t = this.track();
    if (!t) return false;
    if (this.mode === 'edit' && this.pickedNode >= 0) {
      const i = this.pickedNode;
      this.pickedNode = -1;
      void this.write(`node ${i} taken out`, t, deleteNode(t, this.pathId(t), i, this.ctx()));
      return true;
    }
    if (this.mode === 'gates' && this.pickedGate >= 0) {
      const i = this.pickedGate;
      this.pickedGate = -1;
      void this.write(`gate ${i} taken out`, t, gateDeleted(t, i));
      return true;
    }
    return false;
  }

  /** Whether the arrows, Page Up and Page Down are its own this frame: a node or a gate picked. */
  claimsKeys(): boolean {
    return this.armed && ((this.mode === 'edit' && this.pickedNode >= 0) || (this.mode === 'gates' && this.pickedGate >= 0));
  }

  /** A nudge of the picked node or gate by metres of the game's frame (one write). */
  nudge(dx: number, dy: number, dz: number): void {
    const t = this.track();
    if (!t || this.writing) return;
    if (this.mode === 'edit' && this.pickedNode >= 0) {
      const n = this.nodeOf(t);
      if (!n) return;
      // A move of the game's frame in the raw frame: x mirrored.
      void this.write('a node nudged', t, setNode(t, this.pathId(t), this.pickedNode, { x: n.x - dx, z: n.z + dz, y: n.y + dy }, this.ctx()));
    } else if (this.mode === 'gates' && this.pickedGate >= 0) {
      const g = t.gates[this.pickedGate];
      if (!g) return;
      void this.write(`gate ${this.pickedGate} nudged`, t, gateMoved(t, this.pickedGate, { x: g.x - dx, y: g.y + dy, z: g.z + dz, q: g.q }));
    }
  }

  /** Ctrl+D while a node or a gate is picked: nothing to copy (a node or a gate is put in by a click). */
  duplicate(): void {
    this.host.say('a node is put in by a click on the road, and a gate by Place gates again', false);
  }

  /** The picked path's id on a track. */
  private pathId(t: TrackDef): string {
    return t.course?.paths[this.pickedPath]?.id ?? 'main';
  }

  /** The picked node as the file has it, or null. */
  private nodeOf(t: TrackDef): CourseNode | null {
    return t.course?.paths[this.pickedPath]?.nodes[this.pickedNode] ?? null;
  }

  /** The driver's right at node `i` of a spine (the edge leaving it; the last node of an open path, the edge reaching it), into `out`. */
  private nodeRight(sp: Spine, i: number, out: { x: number; z: number }): { x: number; z: number } {
    const edges = sp.edges.length;
    if (!edges) {
      out.x = 1;
      out.z = 0;
      return out;
    }
    spineAt(sp, Math.min(i, edges - 1), i < edges ? 0 : 1, this.spt);
    return rightOf(this.spt.tx, this.spt.tz, out);
  }

  /** What a held edit comes to now, as a course (never written here); null for none held or nothing to hold. */
  private heldEdit(t: TrackDef): CourseEdit | null {
    const c = this.ctx();
    const at = this.at;
    const h = this.held;
    // F or R held with no travel of the mouse moves nothing and writes nothing: a gate raised or turned by nought would be
    // pinned all the same (its anchor dropped by `nudgeGate`), so a tap is never an edit.
    if (h === 'raise' || h === 'bank') {
      const n = this.nodeOf(t);
      if (!n || (h === 'raise' ? this.raise === 0 : this.bankBy === 0)) return null;
      return setNode(t, this.pathId(t), this.pickedNode, h === 'raise' ? { y: n.y + this.raise } : { b: n.b + this.bankBy }, c);
    }
    if (h === 'gateRaise') return t.gates[this.pickedGate] && this.raise !== 0 ? gateRaised(t, this.pickedGate, this.raise) : null;
    if (h === 'gateTurn') return t.gates[this.pickedGate] && this.turnBy !== 0 ? gateTurned(t, this.pickedGate, -this.turnBy) : null;
    if (h === 'node') {
      this.host.toRaw(this.drag.gx + this.drag.mx, this.drag.gz + this.drag.mz, at);
      // The grab's offset from the node, taken at the grab.
      return moveNode(t, this.pathId(t), this.pickedNode, at.x + this.grabB, at.z + this.grabW, c);
    }
    if (h === 'width') {
      const n = this.nodeOf(t);
      if (!n) return null;
      // The grabber's travel on its own level plane (taken at the grabber's drawn height, so a banked node's grabber is
      // grabbed where it is drawn) from where it was grabbed, along the road's right: the width moves by twice it, outward
      // for either grabber, so the grabbed point stays under the cursor and a press that moves nothing changes nothing.
      this.host.toRaw(this.drag.gx + this.drag.mx, this.drag.gz + this.drag.mz, at);
      const rgt = this.nodeRight(courseSpines(t)[this.pickedPath], this.pickedNode, this.at2);
      const out = ((at.x - this.grab0x) * rgt.x + (at.z - this.grab0z) * rgt.z) * this.grabSide;
      // Across the width line on the screen, as far as the cursor has moved from the grab, the way the grabbed end rises on
      // the screen (`lineU`, turned at the grab): the bank, the grabbed end up. Along the line it only widens.
      const up = (this.cur.x - this.grabX) * this.lineUY - (this.cur.y - this.grabY) * this.lineUX;
      return setNode(t, this.pathId(t), this.pickedNode, { w: n.w + 2 * out, b: n.b + ((up * COURSE_TUNE.bankRate) / 100) * this.grabSide }, c);
    }
    if (h === 'gate') {
      // A gate's square: its place moved over the ground (pinned).
      const g = t.gates[this.pickedGate];
      if (!g) return null;
      this.host.toRaw(this.drag.gx + this.drag.mx, this.drag.gz + this.drag.mz, at);
      return gateMoved(t, this.pickedGate, { x: at.x + this.grabB, y: g.y, z: at.z + this.grabW, q: g.q });
    }
    return null;
  }

  /**
   * Whether a drag's grabbed point still stands under the cursor within the editor's click reach (`EDITOR_TUNE.pick.dragPx`):
   * a press and release that moved nothing, which only picks. Measured where the grabbed point is drawn now, so it holds in
   * Point (the cursor moved) and in Fly (the cursor stays in the middle and the camera turned) alike. Nothing is made.
   */
  private stillAt(view: ScreenView): boolean {
    const p = this.p3;
    p[0] = this.drag.gx;
    p[1] = this.drag.oy;
    p[2] = this.drag.gz;
    if (!projectAt(p, 0, view.vp, view.w, view.h, this.pt2)) return false;
    const dx = this.pt2[0] - this.cur.x;
    const dy = this.pt2[1] - this.cur.y;
    const r = EDITOR_TUNE.pick.dragPx;
    return dx * dx + dy * dy <= r * r;
  }

  /**
   * The width line's way on the screen as a grabber is grabbed (`lineU`, from its left grabber to its right), turned so that
   * across it (`(uy, -ux)`, what the bank reads) is the way the grabbed end rises on the screen: the grabbed point and the
   * same point a metre up, projected. Seen from the far side of the road the line runs right to left and its left-hand
   * normal points down the screen, so a grabber dragged up banked the road the other way and ran from the cursor. Where the
   * rise is under a pixel, the screen's up decides (the editor's camera never rolls). `k` is the node's place in `nodes`,
   * `g` the grabbed grabber's. A press's work.
   */
  private lineAt(nodes: Float64Array, k: number, g: number, view: ScreenView): void {
    projectAt(nodes, k + 3, view.vp, view.w, view.h, this.pt);
    const lx = this.pt[0];
    const ly = this.pt[1];
    projectAt(nodes, k + 6, view.vp, view.w, view.h, this.pt);
    let ux = this.pt[0] - lx;
    let uy = this.pt[1] - ly;
    const ul = Math.sqrt(ux * ux + uy * uy);
    ux = ul > 0 ? ux / ul : 1;
    uy = ul > 0 ? uy / ul : 0;
    const p = this.p3;
    p[0] = nodes[g];
    p[1] = nodes[g + 1];
    p[2] = nodes[g + 2];
    p[3] = p[0];
    p[4] = p[1] + 1;
    p[5] = p[2];
    let flip = ux < 0;
    if (projectAt(p, 0, view.vp, view.w, view.h, this.pt) && projectAt(p, 3, view.vp, view.w, view.h, this.pt2)) {
      const rx = this.pt2[0] - this.pt[0];
      const ry = this.pt2[1] - this.pt[1];
      if (rx * rx + ry * ry >= 1) flip = rx * uy - ry * ux < 0;
    }
    this.lineUX = flip ? -ux : ux;
    this.lineUY = flip ? -uy : uy;
  }

  /**
   * A held edit let go: what it came to written, one action (nothing where it moved nothing). A drag let go where it was
   * grabbed is a click, which only picks: a gate dragged by nought would be written pinned (`moveGateTo` builds a gate with
   * no anchor), so a click on a following gate to widen it would have pinned it first. The wheel's steps are kept.
   */
  private letGo(label: string, view: ScreenView): void {
    const t = this.track();
    const drag = this.held === 'node' || this.held === 'width' || this.held === 'gate';
    let e: CourseEdit | null = t && !(drag && this.stillAt(view)) ? this.heldEdit(t) : null;
    if (t && e && typeof e !== 'string' && JSON.stringify(e) === JSON.stringify(t)) e = null;
    this.giveUpHeld(true);
    // Nothing to write (let go where it was grabbed, an edit back at the file's numbers, the track gone) after a live carve: the
    // file's courses carved back, or the ground, the plants and the drive stood on the last preview's course, which no file holds.
    if (!t || !e) {
      if (this.carvedLive) this.carveBack();
      return;
    }
    // Shown as it is let go until the write has landed (or been refused), so the course never blinks back to the file's.
    if (typeof e !== 'string') this.live = e;
    void this.write(label, t, e);
  }

  /**
   * A held edit's course shown while it is held, at `previewHz` (never with `live` 'release'), and carved live (the race
   * drawer's second wave): the world handed the file's tracks with the held one laid over, `preview` (its dirty edges laid
   * again a budget at a time, nearest the cursor first). Every number the edit holds is the writer's rounding (`settle`), so
   * the ground carved while dragging is the ground the write carves, and its landing lays nothing again. A tick's work.
   */
  private preview(): void {
    if (COURSE_TUNE.live === 'release' || this.held === 'none') return;
    if (this.f.now - this.liveAt < 1 / Math.max(1, COURSE_TUNE.previewHz)) return;
    this.liveAt = this.f.now;
    const t = this.track();
    const e = t ? this.heldEdit(t) : null;
    if (e && typeof e !== 'string') {
      this.live = e;
      this.carveWith(e, true);
    }
  }

  /** Whether a held edit's course was carved live and the file's has not been carved back since. */
  private carvedLive = false;
  /** The list a live carve is handed (the file's tracks with the held one laid over), kept and refilled. */
  private readonly carveList: TrackDef[] = [];

  /** The world carves the file's tracks with `t` laid over its own (or added), `preview` while held. */
  private carveWith(t: TrackDef, preview: boolean): void {
    const carve = this.host.carve;
    if (!carve) return;
    const list = this.carveList;
    list.length = 0;
    let put = false;
    for (const k of this.tracks()) {
      if (k.id === t.id) {
        list.push(t);
        put = true;
      } else list.push(k);
    }
    if (!put) list.push(t);
    carve.call(this.host, list, this.f.valid ? this.f.x : Number.NaN, this.f.valid ? this.f.z : Number.NaN, preview);
    this.carvedLive = preview;
  }

  /**
   * The world's own courses carved back over what a held edit carved (a drag given up, refused, or let go with nothing to
   * write): its dirty edges laid again. The list the world last landed (`carved`, `World.courseTracks`), never the tool's
   * reading of the file, which is none once the race switch goes off or the file is unread mid-drag: handed none, the world
   * un-carved every course it holds and dropped their zones until the next arrival. A host that keeps no such list carves
   * the file's back, and nothing where the file is not read.
   */
  private carveBack(): void {
    this.carvedLive = false;
    const back = this.host.carved ? this.host.carved() : this.host.tracks();
    if (back) this.host.carve?.(back, Number.NaN, Number.NaN, false);
  }

  /**
   * The frame, from this frame's view: the press resolved by the mode, a held edit carried on and written as it is let go,
   * and every course near the eye drawn. Nothing is made in a frame with nothing to write.
   */
  overlay(d: ToolDraw, view: ScreenView): void {
    const f = this.f;
    const m = d.marks;
    m.courseOn = false;
    if (!this.armed) return;
    // The file's tracks landed as another list (this tool's write, an undo, the dev server's word): the pick and the notes
    // asked again (a change's work, never a frame's).
    const tr = this.tracks();
    if (tr !== this.seenTracks) {
      this.seenTracks = tr;
      this.landed();
    }
    const press = f.apply && !this.wasApply;
    const release = !f.apply && this.wasApply;
    const pressInverse = f.inverse && !this.wasInverse;
    const liftUp = !f.lift && this.wasLift;
    const turnUp = !f.turn && this.wasTurn;
    this.wasApply = f.apply;
    this.wasInverse = f.inverse;
    this.wasLift = f.lift;
    this.wasTurn = f.turn === true;
    this.cur.x = f.sx;
    this.cur.y = f.sy;
    rayAt(view, this.cur, this.ray);
    const t = this.track();
    // The mouse's movement this frame (Fly's, spent for the camera; Point's cursor's own, both ways, as the lights tool reads it).
    let dy = f.dy;
    if (!dy && Number.isFinite(this.lastSy)) dy = f.sy - this.lastSy;
    this.lastSy = f.sy;
    let dx = f.dx ?? 0;
    if (!dx && Number.isFinite(this.lastSx)) dx = f.sx - this.lastSx;
    this.lastSx = f.sx;
    const onPicked = (this.mode === 'edit' && this.pickedNode >= 0) || (this.mode === 'gates' && this.pickedGate >= 0);
    // F held on the picked node or gate: raised by the mouse, `raiseRate` metres a hundred pixels up; let go, written.
    if (t && f.lift && !this.writing && onPicked && (this.held === 'none' || this.held === 'raise' || this.held === 'gateRaise')) {
      if (this.held === 'none') {
        this.held = this.mode === 'edit' ? 'raise' : 'gateRaise';
        this.raise = 0;
      }
      if (dy) this.raise -= (dy * COURSE_TUNE.raiseRate) / 100;
    }
    if (liftUp && (this.held === 'raise' || this.held === 'gateRaise')) this.letGo(this.held === 'raise' ? 'a node raised' : `gate ${this.pickedGate} raised`, view);
    // R held: the picked node banked (the mouse right, the driver's right down), or the picked gate turned, `bankRate` degrees a hundred pixels.
    if (t && f.turn && !this.writing && onPicked && (this.held === 'none' || this.held === 'bank' || this.held === 'gateTurn')) {
      if (this.held === 'none') {
        this.held = this.mode === 'edit' ? 'bank' : 'gateTurn';
        this.bankBy = 0;
        this.turnBy = 0;
      }
      if (this.held === 'bank') this.bankBy -= (dx * COURSE_TUNE.bankRate) / 100;
      else this.turnBy += (dx * COURSE_TUNE.bankRate) / 100;
    }
    if (turnUp && (this.held === 'bank' || this.held === 'gateTurn')) this.letGo(this.held === 'bank' ? 'a node banked' : `gate ${this.pickedGate} turned`, view);
    // C with the wheel's steps waiting: given up, said, the frame the pick moves off what they were taken on or the course is
    // numbered again under them (`sizeStale`: a node picked, put in, taken out or placed again meanwhile never takes another's
    // steps). Rested, written to the node or gate they were taken on, once no write of the tool's or the editor's is out (an
    // undo landing first is judged as it lands, never refused as busy).
    if (this.sizeBy !== 0) {
      const why = this.sizeStale(t);
      if (why) this.dropSize(why);
      // Never while an edit is held: a shoulder step resting while its node is still dragged waits for the drag's own write
      // (written mid-drag, the preview blinked back to the file's course and the drag's let-go was refused as a write still going).
      else if (t && f.now - this.sizeAt > 0.4 && this.held === 'none' && !this.writing && !this.host.edits.writing) {
        const by = this.sizeBy;
        this.sizeBy = 0;
        this.sizeTrack = null;
        this.sizeBase = null;
        if (this.mode === 'edit') {
          const n = this.nodeOf(t);
          if (n) void this.write('a shoulder', t, setNode(t, this.pathId(t), this.pickedNode, { sh: n.sh + by }, this.ctx()));
        } else if (t.gates[this.pickedGate]) void this.write(`gate ${this.pickedGate} widened`, t, gateWidened(t, this.pickedGate, t.gates[this.pickedGate].w + by));
      }
    }
    // A drag carried on, or let go and written.
    if (this.held === 'node' || this.held === 'width' || this.held === 'gate') {
      if (f.apply) dragAt(this.drag, NO_LAYOUT, this.cur, this.ray);
      else if (release) this.letGo(this.held === 'node' ? 'a node moved' : this.held === 'width' ? 'a road widened or banked' : `gate ${this.pickedGate} moved`, view);
    } else if (press && !this.writing) this.pressed(view);
    else if (pressInverse && this.mode === 'draw' && this.draft.length) {
      this.draft.length--;
      this.draftChanged();
      this.host.say(`${this.draft.length} node${this.draft.length === 1 ? '' : 's'} in the draft`, true);
    }
    this.preview();
    this.drawMarks(d, view);
  }

  /** A press: a handle grabbed, a gate or a course picked, a node put in, or the draft's click. */
  private pressed(view: ScreenView): void {
    const f = this.f;
    if (f.sampled) return;
    const t = this.track();
    if (this.mode === 'draw') {
      if (f.valid) this.clickDraw(f.x, f.z);
      return;
    }
    if (this.mode === 'gates') {
      if (t && this.hotGate >= 0) {
        this.pickedGate = this.hotGate;
        const g = t.gates[this.pickedGate];
        // Grabbed at its own place's height (a hull's middle, which the run tests it at), dragged over the level plane there
        // with the point grabbed kept under the cursor.
        const gg = toGame(g, this.host.centre(), 'raw');
        this.gridPivot.x = gg.x;
        this.gridPivot.y = gg.y;
        this.gridPivot.z = gg.z;
        if (grabAt(this.drag, NO_LAYOUT, H.ground, view, this.gridPivot, this.cur, this.ray)) {
          this.host.toRaw(this.drag.gx, this.drag.gz, this.at);
          this.grabB = g.x - this.at.x;
          this.grabW = g.z - this.at.z;
          this.held = 'gate';
        }
        this.host.say(`gate ${this.pickedGate} of ${t.name}${g.path !== undefined ? ` (follows ${g.path}${g.ow ? ', its own width' : ''})` : ' (pinned)'}: drag it, F raises, R turns, C with the wheel widens, Delete takes it out`, true);
        this.host.refresh();
        return;
      }
      if (f.valid) this.pickAt(f.x, f.z);
      return;
    }
    // Edit: a diamond or a grabber of the picked course, the road between two nodes, or another course.
    if (t && this.hotNode >= 0) {
      const v = this.viewOf(t.id);
      const ref = v ? v.nodeRef[this.hotNode] : -1;
      if (ref >= 0 && v) {
        this.pickedPath = ref >> 16;
        this.pickedNode = ref & 0xffff;
        const k = this.hotNode * 9;
        const n = this.nodeOf(t);
        // A diamond is grabbed on the level plane at its node; a grabber on the plane at its own drawn place, which on a
        // banked node stands up or down by half the width's bank (grabbed on the node's plane, the ray through it met the
        // plane metres off and a click on it changed the width).
        const g = this.hotGrab === 0 ? k : this.hotGrab === 1 ? k + 6 : k + 3;
        this.gridPivot.x = v.nodes[g];
        this.gridPivot.y = v.nodes[g + 1];
        this.gridPivot.z = v.nodes[g + 2];
        if (n && grabAt(this.drag, NO_LAYOUT, H.ground, view, this.gridPivot, this.cur, this.ray)) {
          this.host.toRaw(this.drag.gx, this.drag.gz, this.at);
          if (this.hotGrab === 0) {
            this.grabB = n.x - this.at.x;
            this.grabW = n.z - this.at.z;
            this.held = 'node';
          } else {
            this.grabSide = this.hotGrab;
            this.grabX = this.cur.x;
            this.grabY = this.cur.y;
            this.grab0x = this.at.x;
            this.grab0z = this.at.z;
            this.lineAt(v.nodes, k, g, view);
            this.held = 'width';
          }
        }
        this.host.refresh();
        return;
      }
    }
    if (!f.valid) return;
    this.host.toRaw(f.x, f.z, this.at);
    const road = onRoad(t ? [t] : NO_TRACKS, this.at.x, this.at.z);
    if (t && road && road.track === t.id) {
      const p = pathIndex(t, road.path);
      void this.write('a node put in', t, insertNode(t, road.path, road.e, road.t, this.ctx())).then(() => {
        this.pickedPath = p;
        this.pickedNode = road.e + 1;
        this.host.refresh();
      });
      return;
    }
    this.pickAt(f.x, f.z);
  }

  /** A click on a course's road picks that course (its node let go); off every road the pick of a node or a gate is let go. */
  private pickAt(gx: number, gz: number): void {
    this.host.toRaw(gx, gz, this.at);
    const road = onRoad(this.tracks(), this.at.x, this.at.z);
    if (road) {
      if (this.picked !== road.track) {
        this.picked = road.track;
        this.pickedPath = 0;
        this.pickedNode = -1;
        this.pickedGate = -1;
        const t = this.track();
        if (t) this.notes = this.notesOf(t);
        this.host.say(`picked ${t?.name ?? road.track} (${road.track})`, true);
        this.host.refresh();
      }
      return;
    }
    if (this.pickedNode >= 0 || this.pickedGate >= 0) {
      this.pickedNode = -1;
      this.pickedGate = -1;
      this.host.refresh();
    }
  }

  /** A track picked by its id (the Tools tab, the console). */
  pick(id: string | null): string {
    if (id === null) {
      this.picked = null;
      this.pickedNode = -1;
      this.pickedGate = -1;
      this.host.refresh();
      return 'no course picked';
    }
    const t = this.tracks().find((x) => x.id === id);
    if (!t) return `no track called ${id} on this world`;
    this.picked = id;
    this.pickedPath = 0;
    this.pickedNode = -1;
    this.pickedGate = -1;
    this.notes = this.notesOf(t);
    this.host.refresh();
    return `picked ${t.name} (${id})${t.course ? '' : ': it has no course (Draw its course from its gates on the Tools tab)'}`;
  }

  // ---- Drawing. ----

  /** A height for a node at a point of the raw frame: a drawn road's surface where it is dropped on one, else the land. */
  private heightAt(x: number, z: number): { y: number; road: string | null; track: string | null } {
    const r = onRoad(this.tracks(), x, z);
    if (r) {
      const t = this.tracks().find((k) => k.id === r.track);
      return { y: r.y, road: r.path, track: t?.id ?? null };
    }
    return { y: this.host.land(x, z), road: null, track: null };
  }

  /** A click of the draft: a node added, or the draft closed (near the first) or finished (near the last). */
  clickDraw(gx: number, gz: number): void {
    const d = this.draft;
    this.host.toRaw(gx, gz, this.at);
    const x = this.at.x;
    const z = this.at.z;
    const reach = COURSE_TUNE.closeReach;
    if (d.length >= 3 && !this.draftJoin && Math.hypot(x - d[0].x, z - d[0].z) <= reach) {
      void this.finish(true);
      return;
    }
    if (d.length >= 2 && Math.hypot(x - d[d.length - 1].x, z - d[d.length - 1].z) <= reach) {
      void this.finish(false);
      return;
    }
    const h = this.heightAt(x, z);
    // A draft begun on the picked course's road is a shortcut joined to it there.
    if (!d.length && h.track && h.track === this.picked) this.draftJoin = h.road;
    if (!Number.isFinite(h.y)) {
      this.host.say('the ground under that point is not known yet: fly nearer', false);
      return;
    }
    d.push({ x, z, y: h.y, c: COURSE_TUNE.curve });
    this.draftChanged();
    this.host.say(`${d.length} node${d.length === 1 ? '' : 's'}${this.draftJoin ? ` of a shortcut from ${this.draftJoin}` : ''}${d.length >= 3 && !this.draftJoin ? ' (near the first closes a circuit, near the last finishes a sprint)' : d.length >= 2 ? ' (near the last finishes it)' : ''}`, true);
  }

  /** The draft written: a new track's course (closed a circuit, open a sprint), or a shortcut of the picked course. */
  async finish(closed: boolean): Promise<string> {
    const d = this.draft.slice();
    const join = this.draftJoin;
    if (d.length < 2) return this.said('a course has two nodes at least', false);
    this.draft.length = 0;
    this.draftJoin = null;
    const tracks = this.tracks();
    if (join && this.picked) {
      const t = this.track();
      if (!t) return this.said('the course the shortcut was begun on is gone', false);
      // Finished on a drawn road of the same course: joined there too.
      const end = onRoad([t], d[d.length - 1].x, d[d.length - 1].z);
      return this.write('a shortcut', t, addShortcut(t, d, join, end && end.track === t.id ? end.path : null, this.ctx()));
    }
    const { id, name } = mintTrack(tracks);
    const made = drawTrack(id, name, d, closed, this.ctx());
    const said = await this.write(`${name} drawn`, null, made);
    if (typeof made !== 'string' && this.last.ok) {
      this.picked = id;
      this.pickedPath = 0;
      this.pickedNode = -1;
      this.mode = 'edit';
      this.host.refresh();
    }
    return said;
  }

  // ---- Writes. ----

  /**
   * One action written: the track's whole row before (null: a new track) and after (a string: why the edit was refused, said
   * and nothing written), one write and one undo entry. A held edit's course is let go whatever came of it: refused, the course
   * is what the file says. Answers what was said.
   */
  async write(label: string, before: TrackDef | null, after: CourseEdit | null): Promise<string> {
    // Refused before a stroke is begun where the world refuses the tool (the console writes with it unarmed) or a write of
    // the tool's or the editor's own is out: begun then, the stroke wrote nothing and said "0 rows written" as a success,
    // and the reason was never said.
    const no = after === null || typeof after === 'string' ? null : this.refusal() ?? this.busyWords();
    if (after === null || typeof after === 'string' || no) {
      this.live = null;
      if (this.carvedLive) this.carveBack();
      if (after === null) return '';
      return this.said(typeof after === 'string' ? after : no!, false);
    }
    try {
      // What the course's change carries with it (the race drawer's second wave): our rows standing on the ground it moved,
      // and with `touchUps` 'clear' the sculpt's deltas a moved stretch left past `touchNote` written to nought, one batch.
      // The tool's writing is held while it is worked out (a tile is deflated), so a write asked meanwhile is refused in words.
      let release = (): void => {};
      const hold = new Promise<string>((r) => (release = () => r('')));
      this.writing = hold;
      let extras: RowChange[] | string;
      try {
        extras = await this.courseExtras(before, after, COURSE_TUNE.touchUps === 'clear');
      } finally {
        if (this.writing === hold) this.writing = null;
        release();
      }
      if (typeof extras === 'string') {
        this.live = null;
        if (this.carvedLive) this.carveBack();
        return this.said(extras, false);
      }
      const said = await this.change(label, { file: 'tracks', id: after.id, before, after }, extras);
      // Refused or failed: the course before the drag carved again over what the drag carved (a refused sculpt stroke's put-back).
      if (!this.last.ok && this.carvedLive) this.carveBack();
      return said;
    } finally {
      // The file's own course from here: landed, it is what was written; refused, what it was.
      this.live = null;
      this.carvedLive = false;
    }
  }

  /** What a course action carried and left, for the bar and the console (`carry`, `touch`). */
  readonly carried = { rows: 0, touchLeft: 0, touchTiles: 0, cleared: 0 };
  /** The touch-ups the last action left standing (their tiles and poles), what Clear old touch-ups writes to nought. */
  private touchLeft: { tx: number; tz: number; poles: number[] }[] = [];
  /** The track the touch-ups were measured against, by id and hash: a landing that moves it (an undo, a redo, the dev server's word) lets them go. */
  private touchFor = '';
  /** The world they were measured on (the host's mark): cleared only there. */
  private touchWorld = Number.NaN;

  /**
   * A course action's other rows (§2.7, §2.11): every row of ours set on the ground in the stretches it moved carried by the
   * carve's change under its origin (the sculpt's own carry, on its switch, `SCULPT_TUNE.carry` and `carryNear`), never a row
   * whose footprint meets a crossing's gap (a bridge and what stands under it); and the touch-ups a moved stretch leaves
   * under its old reach where the new does not cover them, past `touchNote`: counted for the notes, and with `clear` written
   * to nought in the heights file. A refusal in words where the rows come to more than one undo holds. An action's work.
   */
  private async courseExtras(before: TrackDef | null, after: TrackDef, clear: boolean): Promise<RowChange[] | string> {
    this.carried.rows = 0;
    this.carried.touchLeft = 0;
    this.carried.touchTiles = 0;
    this.carried.cleared = 0;
    this.touchLeft = [];
    this.touchFor = '';
    const h = this.host;
    if (!h.carve || (!before?.course && !after.course)) return [];
    const file = this.tracks();
    const listOf = (t: TrackDef | null): TrackDef[] => {
      const out: TrackDef[] = [];
      for (const k of file) if (k.id !== after.id) out.push(k);
      if (t) out.push(t);
      return out;
    };
    const sB = new CourseCarve();
    sB.set(listOf(before));
    const sA = new CourseCarve();
    sA.set(listOf(after));
    // The dirty rectangles (raw frame): the before's store made the after's.
    const sD = new CourseCarve();
    sD.set(listOf(before));
    const n = sD.set(listOf(after));
    if (!n) return [];
    const rects = sD.rects.slice(0, n).map((r) => ({ ...r }));
    const inRects = (x: number, z: number): boolean => rects.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
    const out: RowChange[] = [];
    // Carry what stands on the ground the course moved.
    const raw = h.rawGround;
    if (SCULPT_TUNE.carry && h.standing && h.lowestOf && raw) {
      const at = this.at;
      for (const r of h.standing()) {
        const row = r.row;
        if (row.kind === 'building' || row.inside || typeof row.ground !== 'number') continue;
        h.toRaw(r.x, r.z, at);
        if (!inRects(at.x, at.z)) continue;
        const low = h.lowestOf(r.id);
        if (low === null) continue;
        if (Math.abs(row.y + low - row.ground) > SCULPT_TUNE.carryNear) continue;
        // Never a row over or under a crossing's gap: a bridge's piers stand on the lower road and pass `carryNear`.
        if (this.deckAround(sB, at.x, at.z) || this.deckAround(sA, at.x, at.z)) continue;
        const g = raw(at.x, at.z);
        if (!Number.isFinite(g)) continue;
        const dd = sA.carveAt(g, at.x, at.z) - sB.carveAt(g, at.x, at.z);
        if (!(Math.abs(dd) >= 0.0005)) continue;
        const moved = { ...row, y: Math.round((row.y + dd) * 1000) / 1000, ground: Math.round((row.ground + dd) * 1000) / 1000 };
        delete (moved as { at?: number }).at;
        out.push({ file: r.layer, id: r.id, before: row, after: moved });
        this.carried.rows++;
      }
    }
    // The touch-ups a moved stretch leaves standing.
    const store = h.heights?.();
    if (store && store.size) {
      const sample: CarveSample = { T: 0.5, W: 0.5 };
      const tune = COURSE_TUNE;
      for (const tile of store.entries()) {
        const x0 = tile.tx * HEIGHT_TILE_POLES * HEIGHT_POLE;
        const z0 = tile.tz * HEIGHT_TILE_POLES * HEIGHT_POLE;
        const x1 = x0 + HEIGHT_TILE_POLES * HEIGHT_POLE;
        const z1 = z0 + HEIGHT_TILE_POLES * HEIGHT_POLE;
        if (!rects.some((r) => r.x1 >= x0 && r.x0 <= x1 && r.z1 >= z0 && r.z0 <= z1)) continue;
        const poles: number[] = [];
        for (let k = 0; k < tile.d.length; k++) {
          if (!(Math.abs(tile.d[k]) > tune.touchNote)) continue;
          const x = x0 + (k % HEIGHT_TILE_POLES) * HEIGHT_POLE;
          const z = z0 + Math.floor(k / HEIGHT_TILE_POLES) * HEIGHT_POLE;
          if (!(sB.sampleAt(x, z, sample).W > 0)) continue;
          if (sA.sampleAt(x, z, sample).W > 0) continue;
          poles.push(k);
        }
        if (!poles.length) continue;
        this.touchWorld = h.worldMark();
        if (!this.touchFor) {
          // Hashed as the file will read it back (through JSON and the reader), so the tool's own landing matches it.
          const back = readTrack(JSON.parse(JSON.stringify(after)), [], 0);
          this.touchFor = `${after.id}\n${trackHash(typeof back === 'string' ? after : back)}`;
        }
        this.touchLeft.push({ tx: tile.tx, tz: tile.tz, poles });
        this.carried.touchLeft += poles.length;
        this.carried.touchTiles++;
      }
      if (clear && this.touchLeft.length) {
        const tiles = await this.clearedTiles(this.touchLeft);
        if (typeof tiles === 'string') return tiles;
        out.push(...tiles);
        this.carried.cleared = this.carried.touchLeft;
        this.touchLeft = [];
      }
    }
    return out;
  }

  /** Whether a deck of either store stands at or beside a point of the raw frame (a row over or under a crossing's gap). */
  private deckAround(s: CourseCarve, x: number, z: number): boolean {
    const a = this.deckQ;
    for (let k = 0; k < 5; k++) {
      a.x = x + (k === 1 ? 4 : k === 2 ? -4 : 0);
      a.z = z + (k === 3 ? 4 : k === 4 ? -4 : 0);
      a.edge = -1;
      s.deckOf(a);
      if (a.out > -Infinity) return true;
    }
    return false;
  }
  private readonly deckQ = deckAsk();

  /** The heights rows that write the named touch-ups to nought (each tile's other deltas kept), or why not. */
  private async clearedTiles(left: readonly { tx: number; tz: number; poles: number[] }[]): Promise<RowChange[] | string> {
    const h = this.host;
    const store = h.heights?.();
    if (!store || !h.heightRow || !h.deflate) return 'the touch-ups cannot be cleared here: no heights file is held';
    const out: RowChange[] = [];
    let bytes = 0;
    for (const l of left) {
      const d = store.tile(l.tx, l.tz);
      if (!d) continue;
      const next = new Float32Array(d);
      for (const k of l.poles) next[k] = 0;
      const id = tileIdOf(l.tx, l.tz);
      const before = h.heightRow(id);
      let any = false;
      for (let k = 0; k < next.length; k++) if (next[k] !== 0) any = true;
      if (!any) {
        if (before) out.push({ file: 'heights', id, before: { ...before }, after: null });
        continue;
      }
      const b64 = await h.deflate(tileBytes(next));
      bytes += b64.length;
      // The raw ground the tile was authored over is the same ground: its digest kept.
      const row: HeightTileRow = { id, d: b64, on: before?.on ?? '' };
      out.push({ file: 'heights', id, before: before ? { ...before } : null, after: { ...row } });
    }
    if (bytes > SCULPT_TUNE.undoBytes) return `clearing the touch-ups is ${bytes} bytes of tiles, past the ${SCULPT_TUNE.undoBytes} one undo may hold`;
    return out;
  }

  /** Clear old touch-ups (§2.11): the deltas the last course action left past `touchNote` under its old reach written to nought, one action. */
  async clearTouchUps(): Promise<string> {
    // Measured on another world (one gone with the editor off, which only the next use finds): let go, never written here.
    if (this.touchLeft.length && this.host.worldMark() !== this.touchWorld) {
      this.touchLeft = [];
      this.carried.touchLeft = 0;
      this.carried.touchTiles = 0;
      return this.said('the touch-ups were left on another world: nothing written', false);
    }
    if (!this.touchLeft.length) return this.said('no touch-up left standing by the last change of a course', true);
    const no = this.refusal() ?? this.busyWords();
    if (no) return this.said(no, false);
    const tiles = await this.clearedTiles(this.touchLeft);
    if (typeof tiles === 'string') return this.said(tiles, false);
    // The tiles they stood in are gone (the sculpt stroke undone): nothing to clear, and nothing for the notes to name.
    if (!tiles.length) {
      this.dropTouchUps();
      return this.said('no touch-up left to clear', true);
    }
    const n = this.touchLeft.reduce((s, l) => s + l.poles.length, 0);
    const left = this.touchLeft;
    const empty: typeof left = [];
    this.touchLeft = empty;
    let wrote = false;
    const w = (async () => {
      const edits = this.host.edits;
      const es = edits.beginStroke('old touch-ups cleared');
      // Ended whatever the write does: a stroke left open would hold every undo after it (`stroking`).
      let refused = '';
      let said = '';
      try {
        refused = await edits.strokeWrite(es, tiles);
      } finally {
        said = edits.endStroke(es);
      }
      wrote = !refused;
      return refused ? said || refused : `${said} (${n} pole${n === 1 ? '' : 's'} of touch-ups written to nought)`;
    })();
    this.writing = w;
    try {
      const said = await w;
      // Written: the notes stop naming them (they were counted until the next course change, a clear they had already had).
      if (wrote) {
        this.carried.touchLeft = 0;
        this.carried.touchTiles = 0;
        const t = this.track();
        if (t) this.notes = this.notesOf(t);
      }
      return this.said(said, wrote);
    } catch (e) {
      return this.said(`clearing the touch-ups failed: ${e instanceof Error ? e.message : String(e)}`, false);
    } finally {
      // Refused or thrown: still left standing, still to clear (unless a course action measured a list of its own meanwhile).
      if (!wrote && this.touchLeft === empty) this.touchLeft = left;
      if (this.writing === w) this.writing = null;
    }
  }

  /** The touch-ups let go: the list, its counts and the notes' line. */
  private dropTouchUps(): void {
    this.touchLeft = [];
    this.touchFor = '';
    this.carried.touchLeft = 0;
    this.carried.touchTiles = 0;
    const t = this.track();
    if (t) this.notes = this.notesOf(t);
  }

  /** Why a write cannot go now: one of the tool's own or of the editor's (an undo, another tool's stroke) is out; null for none. */
  private busyWords(): string | null {
    return this.writing || this.host.edits.writing ? 'a write is still going: try again once it has landed' : null;
  }

  /** One row written as one action of the history, the tool's writing held for its length; answers what was said. */
  private async change(label: string, change: RowChange, extras: readonly RowChange[] = []): Promise<string> {
    const w = (async () => {
      const edits = this.host.edits;
      const es = edits.beginStroke(label);
      const no = await edits.strokeWrite(es, extras.length ? [change, ...extras] : [change]);
      const said = edits.endStroke(es);
      if (no) {
        this.last.ok = false;
        // The stroke's own words carry the restart's where an endpoint from before the tracks refused it (`refusalWords`).
        return said || (olderTracksEndpoint(no) ? `${no} -- ${TRACKS_OLDER_ENDPOINT}` : no);
      }
      this.last.ok = true;
      return said;
    })();
    this.writing = w;
    try {
      const said = await w;
      const t = this.track();
      if (t) this.notes = this.notesOf(t);
      this.viewsOf = null;
      return this.said(said, this.last.ok);
    } finally {
      if (this.writing === w) this.writing = null;
    }
  }

  /** A track taken out of the file (one write, the tool's writing held for it as for any other). */
  async remove(id: string): Promise<string> {
    const t = this.tracks().find((x) => x.id === id);
    if (!t) return this.said(`no track called ${id}`, false);
    const no = this.refusal() ?? this.busyWords();
    if (no) return this.said(no, false);
    if (this.picked === id) this.pick(null);
    return this.change(`${t.name} taken out`, { file: 'tracks', id, before: t, after: null });
  }

  private said(words: string, ok: boolean): string {
    this.last.said = words;
    this.last.ok = ok;
    if (words) this.host.say(words, ok);
    return words;
  }

  // ---- The Tools tab's and the console's acts. ----

  /** Place gates again on the picked course (or the one named). */
  gatesAgain(id?: string): Promise<string> {
    const t = id ? this.tracks().find((x) => x.id === id) ?? null : this.track();
    if (!t) return Promise.resolve(this.said('pick a course first', false));
    return this.write('gates placed again', t, placeGatesAgain(t, this.ctx()));
  }

  /** Follow: the picked gate anchored again to the road nearest it. */
  follow(): Promise<string> {
    const t = this.track();
    if (!t || this.pickedGate < 0) return Promise.resolve(this.said('pick a gate first (the gates mode)', false));
    return this.write(`gate ${this.pickedGate} follows the road again`, t, gateFollowed(t, this.pickedGate, this.ctx()));
  }

  /**
   * Draw its course from its gates (the picked track, or the one named), writing a course under them: asked twice (§2.9:
   * "the button says, before it writes, that the course carves that world's ground along the line for every player once
   * committed; nothing happens to a track unasked"). The first ask writes nothing and says so; the same track asked again
   * within `ASK_AGAIN_MS` writes it. The Tools tab's button, its act and `course({ fromGates })` all come here.
   */
  async fromGates(id?: string): Promise<string> {
    const t = id ? this.tracks().find((x) => x.id === id) ?? null : this.track();
    if (!t) return this.said('pick a track first', false);
    const r = courseFromGates(t, this.ctx());
    if (typeof r === 'string') return this.said(r, false);
    const now = performance.now();
    if (!this.fromAsked || this.fromAsked.id !== t.id || now > this.fromAsked.until) {
      this.fromAsked = { id: t.id, until: now + ASK_AGAIN_MS };
      return this.said(`Draw ${t.name}'s course from its gates? It carves ${this.host.packId()}'s ground along that line for every player once its file is committed (from the race drawer's second wave): ask again to write it`, true);
    }
    this.fromAsked = null;
    const said = await this.write(`${t.name}'s course drawn from its gates`, t, r.track);
    return this.said(`${said}${r.notes.length ? ` · ${r.notes.join(' · ')}` : ''}`, this.last.ok);
  }

  /** A field of the picked node, the course or the track set from the Selected tab (one write). */
  async setField(what: 'node' | 'course' | 'track', fields: Record<string, unknown>): Promise<string> {
    const t = this.track();
    if (!t) return this.said('pick a course first', false);
    if (what === 'node') {
      if (this.pickedNode < 0) return this.said('pick a node first', false);
      return this.write('a node set', t, setNode(t, this.pathId(t), this.pickedNode, fields as NodeFields, this.ctx()));
    }
    if (what === 'course') return this.write("the course's numbers set", t, setCourse(t, fields as Parameters<typeof setCourse>[1], this.ctx()));
    return this.write('the track set', t, setTrack(t, fields as Parameters<typeof setTrack>[1]));
  }

  // ---- The marks. ----

  /** A course's view by its track's id, or undefined. */
  private viewOf(id: string): CourseView | undefined {
    for (let i = 0; i < this.views.length; i++) if (this.views[i].id === id) return this.views[i];
    return undefined;
  }

  /** The views made again from the file's tracks and the held course (on a change of either alone). */
  private viewsNow(): CourseView[] {
    const tracks = this.tracks();
    if (tracks === this.viewsOf && this.live === this.viewsLive) return this.views;
    this.viewsOf = tracks;
    this.viewsLive = this.live;
    const out: CourseView[] = [];
    let points = 0;
    let nodes = 0;
    let gates = 0;
    for (const t0 of tracks) {
      const t = this.live && this.live.id === t0.id ? this.live : t0;
      if (!t.course) continue;
      const v = this.makeView(t);
      for (const p of v.paths) points += p.n;
      nodes += v.nodeRef.length;
      gates += v.gateN;
      out.push(v);
    }
    this.views = out;
    this.viewPoints = points;
    this.viewNodes = nodes;
    this.viewGates = gates;
    return out;
  }

  /** One course's places in the game's frame (a change's work, never a frame's). */
  private makeView(t: TrackDef): CourseView {
    const spines = courseSpines(t);
    const at = this.at;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const paths: CourseView['paths'] = [];
    const r = { x: 0, z: 0 };
    for (const sp of spines) {
      let n = 0;
      for (const ed of sp.edges) n += ed.count;
      const spine = new Float64Array(n * 3);
      const left = new Float64Array(n * 3);
      const right = new Float64Array(n * 3);
      const outL = new Float64Array(n * 3);
      const outR = new Float64Array(n * 3);
      let k = 0;
      for (const ed of sp.edges) {
        for (let i = 0; i < ed.count; i++) {
          const j = i + 1 < ed.count ? i + 1 : i;
          const h = i + 1 < ed.count ? i : i - 1;
          rightOf(ed.x[j] - ed.x[h], ed.z[j] - ed.z[h], r);
          const put = (arr: Float64Array, off: number, up: number) => {
            this.host.toGame(ed.x[i] + r.x * off, ed.z[i] + r.z * off, at);
            arr[k * 3] = at.x;
            arr[k * 3 + 1] = ed.y[i] + up + 0.05;
            arr[k * 3 + 2] = at.z;
          };
          put(spine, 0, 0);
          put(left, -ed.hw[i], -ed.hw[i] * ed.tb[i]);
          put(right, ed.hw[i], ed.hw[i] * ed.tb[i]);
          put(outL, -ed.hw[i] - ed.sh[i], -ed.hw[i] * ed.tb[i]);
          put(outR, ed.hw[i] + ed.sh[i], ed.hw[i] * ed.tb[i]);
          minX = Math.min(minX, at.x);
          maxX = Math.max(maxX, at.x);
          minZ = Math.min(minZ, at.z);
          maxZ = Math.max(maxZ, at.z);
          k++;
        }
      }
      paths.push({ spine, left, right, outL, outR, n });
    }
    // The nodes and their width lines.
    let nn = 0;
    for (const p of t.course!.paths) nn += p.nodes.length;
    const nodes = new Float64Array(nn * 9);
    const nodeRef = new Int32Array(nn);
    let k = 0;
    for (let p = 0; p < t.course!.paths.length; p++) {
      const ns = t.course!.paths[p].nodes;
      const sp: Spine = spines[p];
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i];
        // The road's way at the node: the edge leaving it (the last node, the edge reaching it).
        this.nodeRight(sp, i, r);
        const tb = Math.tan((n.b * Math.PI) / 180);
        this.host.toGame(n.x, n.z, at);
        nodes[k * 9] = at.x;
        nodes[k * 9 + 1] = n.y + 0.05;
        nodes[k * 9 + 2] = at.z;
        this.host.toGame(n.x - r.x * (n.w / 2), n.z - r.z * (n.w / 2), at);
        nodes[k * 9 + 3] = at.x;
        nodes[k * 9 + 4] = n.y - (n.w / 2) * tb + 0.05;
        nodes[k * 9 + 5] = at.z;
        this.host.toGame(n.x + r.x * (n.w / 2), n.z + r.z * (n.w / 2), at);
        nodes[k * 9 + 6] = at.x;
        nodes[k * 9 + 7] = n.y + (n.w / 2) * tb + 0.05;
        nodes[k * 9 + 8] = at.z;
        nodeRef[k] = (p << 16) | i;
        k++;
      }
    }
    // The gates' windows, baked as the run bakes them, so a gate drawn is the window a run tests.
    const baked = new Float64Array(GATE_STRIDE);
    const g12 = new Float64Array(t.gates.length * 12);
    const c = this.host.centre();
    for (let i = 0; i < t.gates.length; i++) {
      const g = t.gates[i];
      const gg = toGame(g, c, 'raw');
      bakeGate({ ...gg, w: g.w, h: g.h }, baked, 0);
      gateCorners(baked, 0, g12, i * 12);
    }
    return { id: t.id, paths, nodes, nodeRef, gates: g12, gateN: t.gates.length, minX, maxX, minZ, maxZ };
  }

  /**
   * The marks of every course near the eye: its spine (the picked course's brighter), its road's edges and its shoulders'
   * outer edges (dotted), the picked course's nodes and width lines with their grabbers (edit) or its gates' windows (gates),
   * and a draft. The hover is worked out here too, from the projected handles. Nothing is made but on a change of the views.
   */
  private drawMarks(d: ToolDraw, view: ScreenView): void {
    const m = d.marks;
    const views = this.viewsNow();
    const pick = this.picked;
    const edit = this.mode === 'edit';
    const gatesMode = this.mode === 'gates';
    // Five lines a path, the picked course's width lines and gates, and the draft.
    let lines = 0;
    for (let v = 0; v < views.length; v++) lines += views[v].paths.length * 5;
    coursePools(m, lines + this.viewNodes + this.viewGates + 1, this.viewPoints * 5 + this.viewNodes * 2 + this.viewGates * 4 + this.draft.length + 2, this.viewNodes * 3);
    const reach = COURSE_TUNE.drawReach;
    const near = COURSE_TUNE.drawNear;
    const ex = view.ex;
    const ez = view.ez;
    let L = 0;
    let P = 0;
    let K = 0;
    this.hotNode = -1;
    this.hotGrab = 0;
    this.hotGate = -1;
    // The running best, a gate's nearest edge and the corner before, in a kept register (a local that starts as the tune's
    // tagged number and is reassigned fractions is boxed in a frame that picks a handle).
    const R = this.reg;
    R[0] = COURSE_TUNE.hitPx;
    for (let vi = 0; vi < views.length; vi++) {
      const v = views[vi];
      // Past the reach, not drawn at all.
      const dx = ex < v.minX ? v.minX - ex : ex > v.maxX ? ex - v.maxX : 0;
      const dz = ez < v.minZ ? v.minZ - ez : ez > v.maxZ ? ez - v.maxZ : 0;
      if (dx * dx + dz * dz > reach * reach) continue;
      const picked = v.id === pick;
      for (let p = 0; p < v.paths.length; p++) {
        const path = v.paths[p];
        for (let w = 0; w < 5; w++) {
          const arr = w === 0 ? path.spine : w === 1 ? path.left : w === 2 ? path.right : w === 3 ? path.outL : path.outR;
          const start = P;
          for (let i = 0; i < path.n; i++) {
            const x = arr[i * 3];
            const z = arr[i * 3 + 2];
            const ddx = x - ex;
            const ddz = z - ez;
            // Within the near reach every sample, past it every fourth (and the last).
            if (ddx * ddx + ddz * ddz > near * near && (i & 3) !== 0 && i !== path.n - 1) continue;
            m.courseVis[P] = projectAt(arr, i * 3, view.vp, view.w, view.h, this.pt) ? 1 : 0;
            m.coursePts[P * 2] = this.pt[0];
            m.coursePts[P * 2 + 1] = this.pt[1];
            P++;
          }
          m.courseSpans[L] = P - start;
          m.courseStyle[L] = w === 0 ? (picked ? 1 : 0) : w <= 2 ? 2 : 3;
          L++;
        }
      }
      if (!picked) continue;
      if (edit) {
        // The nodes' diamonds and width lines with a grabber at each end, and the hover among them.
        const nodes = v.nodes;
        for (let i = 0; i < v.nodeRef.length; i++) {
          const k = i * 9;
          for (let e = 0; e < 3; e++) {
            const vis = projectAt(nodes, k + e * 3, view.vp, view.w, view.h, this.pt);
            m.courseMarkVis[K] = vis ? 1 : 0;
            m.courseMarkPts[K * 2] = this.pt[0];
            m.courseMarkPts[K * 2 + 1] = this.pt[1];
            m.courseMarkKind[K] = e === 0 ? 0 : 1;
            const isPicked = (v.nodeRef[i] >> 16) === this.pickedPath && (v.nodeRef[i] & 0xffff) === this.pickedNode;
            m.courseMarkState[K] = isPicked ? 2 : 0;
            if (vis) {
              const hx = this.pt[0] - this.cur.x;
              const hy = this.pt[1] - this.cur.y;
              const dd = Math.sqrt(hx * hx + hy * hy);
              if (dd < R[0]) {
                R[0] = dd;
                this.hotNode = i;
                // The grabber on the driver's right is the third point.
                this.hotGrab = e === 0 ? 0 : e === 2 ? 1 : -1;
              }
            }
            K++;
          }
          // Its width line: the left end to the node to the right end.
          const s = P;
          for (let e = 1; e < 3; e++) {
            m.courseVis[P] = m.courseMarkVis[K - 3 + e];
            m.coursePts[P * 2] = m.courseMarkPts[(K - 3 + e) * 2];
            m.coursePts[P * 2 + 1] = m.courseMarkPts[(K - 3 + e) * 2 + 1];
            P++;
          }
          m.courseSpans[L] = P - s;
          m.courseStyle[L] = 4;
          L++;
        }
        if (this.hotNode >= 0) {
          const k = this.hotNode * 3 + (this.hotGrab === 0 ? 0 : this.hotGrab === 1 ? 2 : 1);
          if (m.courseMarkState[k] !== 2) m.courseMarkState[k] = 1;
        }
      }
      if (gatesMode || edit) {
        // The gates' windows (in the edit mode faint), and the hover among them in the gates mode.
        const g = v.gates;
        for (let i = 0; i < v.gateN; i++) {
          const s = P;
          // The cursor's distance to the window's nearest edge on the screen, edge by edge from the kept points.
          R[1] = 1e30;
          for (let c = 0; c < 4; c++) {
            const vis = projectAt(g, i * 12 + c * 3, view.vp, view.w, view.h, this.pt);
            m.courseVis[P] = vis ? 1 : 0;
            m.coursePts[P * 2] = this.pt[0];
            m.coursePts[P * 2 + 1] = this.pt[1];
            if (c > 0 && vis && m.courseVis[P - 1]) this.edgeNear(m.coursePts, P - 1, P);
            P++;
          }
          if (m.courseVis[P - 1] && m.courseVis[s]) this.edgeNear(m.coursePts, P - 1, s);
          if (gatesMode && R[1] < R[0]) {
            R[0] = R[1];
            this.hotGate = i;
          }
          m.courseSpans[L] = P - s;
          m.courseStyle[L] = 0x80 | (i === this.pickedGate && gatesMode ? 6 : edit ? 8 : 5);
          L++;
        }
        if (this.hotGate >= 0) m.courseStyle[L - v.gateN + this.hotGate] = 0x80 | 7;
      }
    }
    // The draft: its points at their heights, and the aim.
    const dn = this.draft.length;
    if (dn) {
      const s = P;
      // The draft's points in the game's frame, worked out as each was added (`draftChanged`), one more slot for the aim.
      for (let i = 0; i < dn; i++) {
        m.courseVis[P] = projectAt(this.draftG, i * 3, view.vp, view.w, view.h, this.pt) ? 1 : 0;
        m.coursePts[P * 2] = this.pt[0];
        m.coursePts[P * 2 + 1] = this.pt[1];
        P++;
      }
      if (this.f.valid) {
        // The aim, the open line's end.
        this.draftG[dn * 3] = this.f.x;
        this.draftG[dn * 3 + 1] = this.f.y;
        this.draftG[dn * 3 + 2] = this.f.z;
        m.courseVis[P] = projectAt(this.draftG, dn * 3, view.vp, view.w, view.h, this.pt) ? 1 : 0;
        m.coursePts[P * 2] = this.pt[0];
        m.coursePts[P * 2 + 1] = this.pt[1];
        P++;
      }
      m.courseSpans[L] = P - s;
      m.courseStyle[L] = 9;
      L++;
    }
    m.courseLineN = L;
    m.courseMarkN = K;
    m.courseOn = L > 0 || K > 0;
  }

  /** The cursor's distance on the screen to the segment between points `a` and `b` of `pts` (two numbers a point), into `reg[1]` where nearer. */
  private edgeNear(pts: Float64Array, a: number, b: number): void {
    const ax = pts[a * 2];
    const ay = pts[a * 2 + 1];
    const dx = pts[b * 2] - ax;
    const dy = pts[b * 2 + 1] - ay;
    const x = this.cur.x;
    const y = this.cur.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - x;
    const py = ay + dy * t - y;
    const d = Math.sqrt(px * px + py * py);
    if (d < this.reg[1]) this.reg[1] = d;
  }

  /** The draft's points in the game's frame, made again whenever a point is added or taken back (never a frame's work). */
  private draftChanged(): void {
    const dn = this.draft.length;
    if (this.draftG.length < (dn + 1) * 3) this.draftG = new Float64Array((dn + 1) * 6);
    for (let i = 0; i < dn; i++) {
      const q = this.draft[i];
      this.host.toGame(q.x, q.z, this.at);
      this.draftG[i * 3] = this.at.x;
      this.draftG[i * 3 + 1] = q.y;
      this.draftG[i * 3 + 2] = this.at.z;
    }
  }

  // ---- The window's sections (the Tools tab's `Course`, the Selected tab's picked course, node and gate). ----

  /**
   * The Tools tab's section while the tool is armed: its modes, the next edge's curve, the draft's Finish and Close, the new
   * road's numbers, and this world's tracks each with Pick, Draw its course from its gates and Take out.
   */
  toolsSections(): EditorSection[] {
    const no = this.refusal();
    const tr = this.tracks();
    const t = this.track();
    const rows = tr.map((k) => {
      const spines = k.course ? courseSpines(k) : [];
      const km = spines.length ? ` · ${(spines[0].length / 1000).toFixed(2)} km` : '';
      const words = `${k.name} (${k.id}) · ${k.kind}${km} · ${k.course ? `${k.course.paths.length} path${k.course.paths.length === 1 ? '' : 's'}, ${k.course.paths.reduce((s, p) => s + p.nodes.length, 0)} nodes` : 'gates only'} · ${k.gates.length} gates`;
      return {
        words,
        buttons: [
          { label: k.id === this.picked ? 'Picked' : 'Pick', act: `course:pick:${k.id}`, off: k.id === this.picked },
          ...(k.course ? [] : [{ label: 'Draw its course from its gates', act: `course:fromGates:${k.id}` }]),
          { label: 'Take out', act: `course:remove:${k.id}`, danger: true },
        ],
      };
    });
    const buttons = [
      { label: 'Draw', act: 'course:mode:draw', off: this.mode === 'draw' },
      { label: 'Edit', act: 'course:mode:edit', off: this.mode === 'edit' },
      { label: 'Gates', act: 'course:mode:gates', off: this.mode === 'gates' },
      { label: COURSE_TUNE.curve === 'smooth' ? 'Next edge: a curve' : 'Next edge: a straight', act: 'course:curve' },
      { label: 'Finish (a sprint)', act: 'course:finish', off: this.draft.length < 2 },
      { label: 'Close (a circuit)', act: 'course:close', off: this.draft.length < 3 || !!this.draftJoin },
      { label: 'Give the draft up', act: 'course:giveUp', off: !this.draft.length },
      { label: 'Place gates again', act: 'course:gatesAgain', off: !t?.course },
      { label: 'Follow the road (the picked gate)', act: 'course:follow', off: !t || this.pickedGate < 0 },
      ...(this.host.carve
        ? [
            { label: 'Fit to land (the picked path)', act: 'course:fitLand', off: !t?.course },
            { label: 'Fit a bridge (the crossing nearest the aim)', act: 'course:bridge', off: !t?.course || !this.host.fitBridge },
            { label: 'Clear old touch-ups', act: 'course:clearTouchUps', off: !this.touchLeft.length },
          ]
        : []),
    ];
    const carves = this.host.carve ? 'A drawn course carves the ground under it as it is written' : 'This host carves nothing';
    return [
      {
        title: 'Course',
        note: no ?? `${this.modeWords()}. ${carves}.${this.notes.length ? ` Notes: ${this.notes.join(' · ')}` : ''}`,
        fields: [
          { label: 'New road wide', value: COURSE_TUNE.width, act: 'course:tune:width', kind: 'number' },
          { label: 'Its shoulder', value: COURSE_TUNE.shoulder, act: 'course:tune:shoulder', kind: 'number' },
          { label: 'Its bank (°)', value: COURSE_TUNE.bank, act: 'course:tune:bank', kind: 'number' },
          { label: 'Raced as a pod', value: COURSE_TUNE.forPods, act: 'course:tune:forPods', kind: 'check' },
          { label: 'Raced as a bike', value: COURSE_TUNE.forBikes, act: 'course:tune:forBikes', kind: 'check' },
        ],
        rows,
        buttons,
      },
    ];
  }

  /** The Selected tab's sections: the picked course's own numbers, and the picked node's (edit) or gate's (gates). */
  selectedSections(): EditorSection[] {
    const t = this.track();
    if (!t) return [];
    const c = t.course;
    const out: EditorSection[] = [
      {
        title: 'The picked course',
        note: `${t.id}: ${t.kind}${c ? `, ${c.paths.map((p) => `${p.id} ${p.nodes.length} nodes`).join(', ')}` : ', gates only'}; ${t.gates.length} gates, ${t.gates.filter((g) => g.path !== undefined).length} following the road`,
        fields: [
          { label: 'Name', value: t.name, act: 'course:set:name', kind: 'text' },
          ...(t.kind === 'circuit' ? [{ label: 'Laps', value: t.laps, act: 'course:set:laps', kind: 'number' as const }] : []),
          { label: 'Clear past the road', value: t.clear, act: 'course:set:clear', kind: 'number' },
          { label: 'Raced as a pod', value: t.for.includes('podracer'), act: 'course:set:pods', kind: 'check' },
          { label: 'Raced as a bike', value: t.for.includes('speederbike'), act: 'course:set:bikes', kind: 'check' },
          ...(c
            ? [
                { label: 'Falloff', value: c.feather, act: 'course:set:feather', kind: 'text' as const },
                { label: 'A crossing', value: c.crossing, act: 'course:set:crossing', kind: 'text' as const },
                { label: 'Margin', value: c.margin, act: 'course:set:margin', kind: 'number' as const },
                { label: 'Level', value: c.level, act: 'course:set:level', kind: 'number' as const },
                { label: 'Grass', value: c.grass, act: 'course:set:grass', kind: 'text' as const },
                { label: 'Walls out', value: c.wallOut, act: 'course:set:wallOut', kind: 'number' as const },
                { label: 'Walls high', value: c.wallHigh, act: 'course:set:wallHigh', kind: 'number' as const },
              ]
            : []),
        ],
      },
    ];
    const n = this.mode === 'edit' ? this.nodeOf(t) : null;
    if (n) {
      out.push({
        title: 'The picked node',
        note: `node ${this.pickedNode} of ${this.pathId(t)}${n.j ? `, joined to ${n.j}` : ''}; x and z in the file's frame`,
        fields: [
          { label: 'x', value: n.x, act: 'course:node:x', kind: 'number' },
          { label: 'z', value: n.z, act: 'course:node:z', kind: 'number' },
          { label: 'Height', value: n.y, act: 'course:node:y', kind: 'number' },
          { label: 'Width', value: n.w, act: 'course:node:w', kind: 'number' },
          { label: 'Bank (°)', value: n.b, act: 'course:node:b', kind: 'number' },
          { label: 'Shoulder', value: n.sh, act: 'course:node:sh', kind: 'number' },
          { label: 'Walls', value: n.wall ?? 'none', act: 'course:node:wall', kind: 'text' },
        ],
        buttons: [
          { label: n.c === 'smooth' ? 'The edge leaving it: a curve' : 'The edge leaving it: a straight', act: 'course:node:curve' },
          { label: 'Take it out', act: 'course:node:remove', danger: true },
        ],
      });
    }
    const g = this.mode === 'gates' && this.pickedGate >= 0 ? t.gates[this.pickedGate] : null;
    if (g) {
      out.push({
        title: 'The picked gate',
        note: `gate ${this.pickedGate}: ${g.path !== undefined ? `follows ${g.path}, edge ${g.e} at ${g.t}${g.ow ? ', its own width' : ''}` : 'pinned where it was put'}`,
        fields: [
          { label: 'x', value: g.x, act: 'course:gate:x', kind: 'number' },
          { label: 'y', value: g.y, act: 'course:gate:y', kind: 'number' },
          { label: 'z', value: g.z, act: 'course:gate:z', kind: 'number' },
          { label: 'Width', value: g.w, act: 'course:gate:w', kind: 'number' },
        ],
        buttons: [
          { label: 'Follow the road', act: 'course:follow', off: g.path !== undefined && !g.ow },
          { label: 'Take it out', act: 'course:gate:remove', danger: true },
        ],
      });
    }
    return out;
  }

  /**
   * A button or a field of its sections (`course:...`), answered as the matching key or console line would be; every write
   * one action. Answers what was said.
   */
  async act(act: string, value?: string): Promise<string> {
    this.sameWorld();
    const [, what, arg] = act.split(':');
    const num = Number(value);
    const fin = value !== undefined && value !== '' && Number.isFinite(num);
    const t = this.track();
    if (what === 'mode' && (COURSE_MODES as readonly string[]).includes(arg)) return this.setMode(arg as CourseMode);
    if (what === 'curve') {
      COURSE_TUNE.curve = COURSE_TUNE.curve === 'smooth' ? 'straight' : 'smooth';
      return `a new edge: ${COURSE_TUNE.curve === 'smooth' ? 'a curve' : 'a straight'}`;
    }
    if (what === 'finish') return this.finish(false);
    if (what === 'close') return this.finish(true);
    if (what === 'giveUp') {
      this.draft.length = 0;
      this.draftJoin = null;
      return 'the draft given up';
    }
    if (what === 'gatesAgain') return this.gatesAgain();
    if (what === 'follow') return this.follow();
    if (what === 'fitLand') return this.fitLand();
    if (what === 'bridge') return this.fitBridge();
    if (what === 'clearTouchUps') return this.clearTouchUps();
    if (what === 'pick') return this.pick(arg ? arg : null);
    if (what === 'fromGates') return this.fromGates(arg);
    if (what === 'remove') return this.remove(arg);
    if (what === 'tune') {
      if (arg === 'forPods' || arg === 'forBikes') return this.tune({ [arg]: value === 'true' }).join('; ');
      return fin ? this.tune({ [arg]: num }).join('; ') : `${arg} takes a number`;
    }
    if (!t) return this.said('pick a course first', false);
    if (what === 'set') {
      if (arg === 'name') return this.setField('track', { name: value ?? '' });
      if (arg === 'laps' || arg === 'clear') return fin ? this.setField('track', { [arg]: num }) : this.said(`${arg} takes a number`, false);
      if (arg === 'pods' || arg === 'bikes') {
        const on = value === 'true';
        const kinds = new Set(t.for);
        const k = arg === 'pods' ? 'podracer' : 'speederbike';
        if (on) kinds.add(k);
        else kinds.delete(k);
        return this.setField('track', { for: [...kinds] });
      }
      if (arg === 'feather' || arg === 'crossing' || arg === 'grass') return this.setField('course', { [arg]: value });
      return fin ? this.setField('course', { [arg]: num }) : this.said(`${arg} takes a number`, false);
    }
    if (what === 'node') {
      if (arg === 'curve') return this.write('a curve or a straight', t, toggleCurve(t, this.pathId(t), this.pickedNode, this.ctx()));
      if (arg === 'remove') {
        const i = this.pickedNode;
        this.pickedNode = -1;
        return this.write(`node ${i} taken out`, t, deleteNode(t, this.pathId(t), i, this.ctx()));
      }
      if (arg === 'wall') return this.setField('node', { wall: value });
      return fin ? this.setField('node', { [arg]: num }) : this.said(`${arg} takes a number`, false);
    }
    if (what === 'gate') {
      const i = this.pickedGate;
      const g = t.gates[i];
      if (!g) return this.said('pick a gate first (the gates mode)', false);
      if (arg === 'remove') {
        this.pickedGate = -1;
        return this.write(`gate ${i} taken out`, t, gateDeleted(t, i));
      }
      if (!fin) return this.said(`${arg} takes a number`, false);
      if (arg === 'w') return this.write(`gate ${i} widened`, t, gateWidened(t, i, num));
      const place = { x: arg === 'x' ? num : g.x, y: arg === 'y' ? num : g.y, z: arg === 'z' ? num : g.z, q: g.q };
      return this.write(`gate ${i} moved`, t, gateMoved(t, i, place));
    }
    return this.said(`no such act: ${act}`, false);
  }

  // ---- The console (`__debug.course`). ----

  /**
   * `__debug.course(o)` past arming (the entry arms it through the Tools list first): the tune, a pick, a course drawn through
   * points of the file's raw frame at the land's heights (`draw`), a shortcut drawn and joined (`shortcut`), a node's edit, a
   * gate's edit, the gates placed again, the track's and the course's numbers, a course from a track's gates, a track taken
   * out. Answers what was said and the report.
   */
  async debug(o: Record<string, unknown>): Promise<{ said: string[]; tool: Record<string, unknown>; courses: unknown[] }> {
    this.sameWorld();
    const said: string[] = [];
    const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
    const byId = (id: unknown): TrackDef | null => (typeof id === 'string' ? this.tracks().find((t) => t.id === id) ?? null : this.track());
    const pts = (v: unknown): { x: number; z: number; y: number; c: 'smooth' | 'straight' }[] | string => {
      if (!Array.isArray(v)) return 'points are [[x, z], ...] of the file\'s raw frame';
      const out: { x: number; z: number; y: number; c: 'smooth' | 'straight' }[] = [];
      for (const p of v) {
        if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return 'a point is [x, z] (raw frame), or [x, z, y]';
        const x = Number(p[0]);
        const z = Number(p[1]);
        const y = Number.isFinite(p[2]) ? Number(p[2]) : this.heightAt(x, z).y;
        if (!Number.isFinite(y)) return `the ground under [${x}, ${z}] is not known yet: fly nearer (or give its height as [x, z, y])`;
        out.push({ x, z, y, c: p[3] === 'straight' ? 'straight' : COURSE_TUNE.curve });
      }
      return out;
    };
    if (o.tune !== undefined) said.push(...this.tune(rec(o.tune) ?? {}));
    if (o.pick !== undefined) said.push(this.pick(typeof o.pick === 'string' ? o.pick : null));
    const draw = rec(o.draw);
    if (draw) {
      const p = pts(draw.points);
      if (typeof p === 'string') said.push(p);
      else {
        const minted = mintTrack(this.tracks());
        const id = typeof draw.track === 'string' ? draw.track : minted.id;
        const name = typeof draw.name === 'string' ? draw.name : id === minted.id ? minted.name : id;
        if (this.tracks().some((t) => t.id === id)) said.push(`${id} is in the file already: pick it and edit its nodes`);
        else {
          const made = drawTrack(id, name, p, draw.closed !== false, this.ctx());
          said.push(await this.write(`${name} drawn`, null, made));
          if (typeof made !== 'string' && this.last.ok) this.pick(id);
        }
      }
    }
    const cut = rec(o.shortcut);
    if (cut) {
      const t = byId(cut.track);
      const p = pts(cut.points);
      if (!t) said.push('a shortcut names its track (track: id), or one is picked');
      else if (typeof p === 'string') said.push(p);
      else {
        const a = onRoad([t], p[0].x, p[0].z);
        const b = onRoad([t], p[p.length - 1].x, p[p.length - 1].z);
        said.push(await this.write('a shortcut', t, addShortcut(t, p, typeof cut.from === 'string' ? cut.from : (a?.path ?? null), typeof cut.to === 'string' ? cut.to : (b?.path ?? null), this.ctx())));
      }
    }
    const node = rec(o.node);
    if (node) {
      const t = byId(node.track);
      const i = Number(node.i);
      const path = typeof node.path === 'string' ? node.path : undefined;
      if (!t) said.push('a node edit names its track (track: id), or one is picked');
      else if (node.remove === true) said.push(await this.write(`node ${i} taken out`, t, deleteNode(t, path, i, this.ctx())));
      else if (typeof node.insert === 'number') said.push(await this.write('a node put in', t, insertNode(t, path, i, node.insert, this.ctx())));
      else if (node.curve === true) said.push(await this.write('a curve or a straight', t, toggleCurve(t, path, i, this.ctx())));
      else {
        const f: NodeFields = {};
        for (const k of ['x', 'z', 'y', 'w', 'b', 'sh'] as const) if (typeof node[k] === 'number') f[k] = node[k] as number;
        if (typeof node.raise === 'number') {
          const n = t.course?.paths[Math.max(0, pathIndex(t, path))]?.nodes[i];
          if (n) f.y = n.y + node.raise;
        }
        if (node.c === 'smooth' || node.c === 'straight') f.c = node.c;
        if (node.wall === 'left' || node.wall === 'right' || node.wall === 'both' || node.wall === 'none') f.wall = node.wall;
        said.push(await this.write('a node set', t, setNode(t, path, i, f, this.ctx())));
      }
    }
    const gates = rec(o.gates);
    if (gates?.place === true) said.push(await this.gatesAgain(typeof gates.track === 'string' ? gates.track : undefined));
    const gate = rec(o.gate);
    if (gate) {
      const t = byId(gate.track);
      const i = Number(gate.i);
      const g = t?.gates[i];
      if (!t || !g) said.push(`a gate edit names its track and a gate it has (track: id, i: 0..)`);
      else if (gate.remove === true) said.push(await this.write(`gate ${i} taken out`, t, gateDeleted(t, i)));
      else if (gate.follow === true) said.push(await this.write(`gate ${i} follows the road again`, t, gateFollowed(t, i, this.ctx())));
      else if (Array.isArray(gate.move) && gate.move.length === 3 && gate.move.every((v) => Number.isFinite(v))) {
        const [x, y, z] = gate.move as number[];
        said.push(await this.write(`gate ${i} moved`, t, gateMoved(t, i, { x, y, z, q: g.q })));
      } else if (typeof gate.yaw === 'number') said.push(await this.write(`gate ${i} turned`, t, gateTurned(t, i, gate.yaw)));
      else if (typeof gate.raise === 'number') said.push(await this.write(`gate ${i} raised`, t, gateRaised(t, i, gate.raise)));
      else if (typeof gate.w === 'number') said.push(await this.write(`gate ${i} widened`, t, gateWidened(t, i, gate.w)));
      else said.push('a gate edit is remove, follow, move: [x, y, z], yaw, raise or w');
    }
    const set = rec(o.set);
    if (set) {
      const t = byId(set.track);
      if (!t) said.push('a set names its track (track: id), or one is picked');
      else {
        const trackF: Record<string, unknown> = {};
        const courseF: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(set)) {
          if (k === 'track') continue;
          if (k === 'name' || k === 'laps' || k === 'for' || k === 'clear' || k === 'kind') trackF[k] = v;
          else courseF[k] = v;
        }
        if (Object.keys(trackF).length) said.push(await this.write('the track set', t, setTrack(t, trackF as Parameters<typeof setTrack>[1])));
        const now = this.tracks().find((x) => x.id === t.id) ?? t;
        if (Object.keys(courseF).length) said.push(await this.write("the course's numbers set", now, setCourse(now, courseF as Parameters<typeof setCourse>[1], this.ctx())));
      }
    }
    if (typeof o.fromGates === 'string') said.push(await this.fromGates(o.fromGates));
    // The carve's acts (the race drawer's second wave): `fitLand` and `bridge` true (the picked course) or a track's id.
    if (o.fitLand !== undefined) said.push(await this.fitLand(typeof o.fitLand === 'string' ? o.fitLand : undefined));
    if (o.bridge !== undefined) said.push(await this.fitBridge(typeof o.bridge === 'string' ? o.bridge : undefined));
    if (o.clearTouchUps === true) said.push(await this.clearTouchUps());
    if (typeof o.remove === 'string') said.push(await this.remove(o.remove));
    return { said: said.filter(Boolean), tool: this.report(), courses: this.coursesReport() };
  }

  /** This world's tracks with a course, as the console reports them: paths, nodes, lengths, joins, gates and notes. */
  coursesReport(): unknown[] {
    return this.tracks()
      .filter((t) => t.course)
      .map((t) => {
        const spines = courseSpines(t);
        return {
          id: t.id,
          name: t.name,
          kind: t.kind,
          laps: t.laps,
          for: t.for,
          clear: t.clear,
          paths: t.course!.paths.map((p, i) => ({ id: p.id, nodes: p.nodes.length, edges: spines[i].edges.length, m: Math.round(spines[i].length * 10) / 10, joins: p.nodes.filter((n) => n.j !== undefined).map((n) => n.j) })),
          gates: t.gates.map((g, i) => ({ i, follows: g.path !== undefined ? `${g.path} e${g.e} t${g.t}` : 'pinned', ow: !!g.ow, w: g.w, at: [g.x, g.y, g.z] })),
          grid: t.grid.path !== undefined ? `${t.grid.path} e${t.grid.e} t${t.grid.t}` : 'pinned',
          crossings: courseCrossings(t).map((x) => ({ upper: x.upper, lower: x.lower, hairpin: x.hairpin, at: [Math.round(x.x), Math.round(x.z)], deck: +x.deck.toFixed(2), clearance: +x.clearance.toFixed(2), span: +x.span.toFixed(1) })),
          notes: this.notesOf(t),
        };
      });
  }

  // ---- What it says. ----

  /** The bar's words while armed. */
  barWords(): string {
    const t = this.track();
    const node = this.mode === 'edit' && t && this.pickedNode >= 0 ? this.nodeOf(t) : null;
    const held = this.held === 'raise' ? ` · raising ${this.raise >= 0 ? '+' : ''}${this.raise.toFixed(2)} m` : this.held === 'bank' ? ` · banking ${this.bankBy >= 0 ? '+' : ''}${this.bankBy.toFixed(1)}°` : this.held === 'gateTurn' ? ` · turning ${this.turnBy.toFixed(1)}°` : this.held === 'gateRaise' ? ` · raising the gate ${this.raise.toFixed(2)} m` : this.held !== 'none' ? ` · ${this.held} held` : '';
    const what = this.mode === 'draw' ? `drawing ${this.draft.length ? `${this.draft.length} nodes, the next edge a ${this.draft[this.draft.length - 1].c === 'smooth' ? 'curve' : 'straight'}` : `(a ${COURSE_TUNE.curve === 'smooth' ? 'curve' : 'straight'} next)`}${this.draftJoin ? ` · a shortcut from ${this.draftJoin}` : ''}` : this.mode === 'edit' ? (node ? `node ${this.pickedNode}${this.pickedPath ? ` of ${t?.course?.paths[this.pickedPath]?.id}` : ''}: ${node.w} m wide, bank ${node.b}°, shoulder ${node.sh} m, ${node.y.toFixed(2)} m up, ${node.c}` : 'editing: click a diamond or a grabber, the road to put a node in') : this.pickedGate >= 0 && t?.gates[this.pickedGate] ? `gate ${this.pickedGate}${t.gates[this.pickedGate].path !== undefined ? ' (follows)' : ' (pinned)'}` : 'gates: click near one';
    const notes = this.notes.length ? ` · ${this.notes.slice(0, 3).join(' · ')}${this.notes.length > 3 ? ` (+${this.notes.length - 3})` : ''}` : '';
    return `course: ${t ? `${t.name} · ` : ''}${what}${held}${this.writing ? ' · writing' : ''}${notes}${this.last.said && !this.writing ? ` · ${this.last.said}` : ''}`;
  }

  /** For the console. */
  report(): Record<string, unknown> {
    return { armed: this.armed, mode: this.mode, picked: this.picked, path: this.pickedPath, node: this.pickedNode, gate: this.pickedGate, draft: this.draft.length, shortcutFrom: this.draftJoin, held: this.held, writing: !!this.writing, views: this.views.length, last: { ...this.last }, notes: [...this.notes], carves: !!this.host.carve, carvedLive: this.carvedLive, carried: { ...this.carried } };
  }

  /** The tune moved from the console or a slider: the views drawn again (their reach, nothing else of a course). */
  tune(patch: Record<string, unknown>): string[] {
    const said = tuneCourse(patch);
    this.viewsOf = null;
    return said;
  }
}

/** A layout no handle is shown on: a ground drag reads only its pivot and its ray (`grabAt`, `dragAt` with `H.ground`). */
const NO_LAYOUT = gizmoLayout();


/** The Course tool as an entry of the Tools list, on the apostrophe. */
export function courseTool(c: EditorCourse): ToolDef {
  return {
    id: 'course',
    action: 'editorCourse',
    label: 'the Course tool',
    armed: () => c.armed,
    arm: () => c.arm(),
    disarm: () => c.disarm(),
    step(f) {
      c.step(f);
    },
    // No ring: what a click does is said on the bar, and the courses are drawn every frame (`overlay`).
    draw() {},
    overlay: (d, view) => c.overlay(d, view),
    owns: (b) => b === 'apply' || b === 'inverse',
    holdsMouse: (lift, turn) => c.holdsMouse(lift, turn),
    size: (notches) => c.size(notches),
    deleteKey: () => c.deleteKey(),
    escape: () => c.escape(),
    toggle: () => c.toggle(),
    claimsKeys: () => c.claimsKeys(),
    nudge: (dx, dy, dz) => c.nudge(dx, dy, dz),
    duplicate: () => c.duplicate(),
    barWords: () => c.barWords(),
    report: () => c.report(),
  };
}

/** Whether a track read from the file is the editor's to draw on: any of the world's, read as the reader reads it. */
export function courseTrackOk(t: unknown): t is TrackDef {
  return typeof readTrack(t) !== 'string';
}
