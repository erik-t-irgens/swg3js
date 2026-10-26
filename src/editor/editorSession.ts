// The world editor's session (DESIGN.md §2.2): on and off, the return point, the two mouse modes, the destination file and
// the hold, over ports the game hands in, so a node test drives every rule here with stand-ins.
//
// **The body is the anchor and rides with the camera, hidden.** Entering keeps the body's place, heading, room and
// noclip as the **return point** before anything moves, then hands the body to the free camera (the port's `enter`).
// Leaving stands the body back at the return point (`leaveWay`): a plain reset where something solid is under it within
// a step (`floorUnder`); exactly where it was, its height kept and no ground read, where there is nothing to stand on and
// nothing it should fall to (a space zone, where the ground is a plane three kilometres down that is never built, or
// the drawn water, whose bed would drown it: `keepsHeight`); otherwise the way a death far from a world's raised arrival
// comes round (a short loading screen, the world moved there and settled, the floor read). The room is kept as its
// number and found again at the body's place as it is stood (a building streamed out and back is a new object).
// **N** moves the return point to where the aim says. A world going turns the editor off with it and keeps the last
// return point to report, standing nobody: the travel stands the body.
//
// Entering is refused in words, never silently: mounted or riding, at a ship's controls, aboard a hull's rooms or a
// surface room, a shuttle's passenger, in a jump or a cruise, travelling, dying or dead, or in a conversation. It is
// allowed indoors, in space and in the world of copies (where only removals would be written, a later wave's).
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension,
// no enum, no namespace, no constructor parameter properties.

/** What the game is doing that would refuse entering the editor, read at the press. */
export interface EntryState {
  mounted: boolean;
  piloting: boolean;
  aboard: boolean;
  passenger: boolean;
  jumping: boolean;
  cruising: boolean;
  travelling: boolean;
  dead: boolean;
  talking: boolean;
}

/** Why the editor cannot be entered now, in words, or null. The order is the order a player would look for the reason in. */
export function entryRefusal(s: EntryState): string | null {
  if (s.travelling) return 'not while travelling: wait for the world to come in';
  if (s.dead) return 'not while down: come round first';
  if (s.passenger) return "not as a shuttle's passenger: step off first";
  if (s.jumping) return 'not in a hyperspace jump';
  if (s.cruising) return 'not in an ultra cruise: let go of it first';
  if (s.piloting) return "not at a ship's controls: let go of them first";
  if (s.mounted) return 'not while riding: get off first';
  if (s.aboard) return 'not aboard a ship or on a surface the boots hold: step off first';
  if (s.talking) return 'not in a conversation: end it first';
  return null;
}

/** Where the body was, and how it stood: what leaving stands it back at. */
export interface ReturnPoint {
  x: number;
  y: number;
  z: number;
  heading: number;
  /**
   * The room it was in, by its number in its building (0 outside). A number and never the world's `CellState`: a
   * building streamed out and back while the camera was away is a new object, and a kept one would be a building that
   * no longer stands, so the room is found again at the body's place as it is stood.
   */
  cell: number;
  /** Whether noclip was on. */
  noclip: boolean;
  /** Its health, which a reset would fill. */
  hp: number;
}

/** A return point with nothing in it. */
export function returnPoint(): ReturnPoint {
  return { x: 0, y: 0, z: 0, heading: 0, cell: 0, noclip: false, hp: 0 };
}

/** How the body is stood back: a plain reset onto a floor, exactly where it was (nothing to stand on or fall to), or behind the curtain. */
export type LeaveWay = 'plain' | 'exact' | 'curtain';

/**
 * How the body is stood back at its return point: `plain` where something solid is under it within a step; `exact` where
 * nothing is and nothing should be fallen to (a space zone, the drawn water: `keepsHeight`), its height kept and no ground
 * read; else `curtain`, the world moved there and settled and the floor read, the ground under it only where no floor came.
 */
export function leaveWay(floorUnder: boolean, keepsHeight: boolean): LeaveWay {
  if (floorUnder) return 'plain';
  return keepsHeight ? 'exact' : 'curtain';
}

/**
 * Why N will not move the return point to what the aim meets (its kind, `aim.ts`'s), or null: only the ground and what
 * stands still are a place to stand. The drawn water is not (the curtain would stand the body on its bed, metres under),
 * a row's box only where something solid is under its face within a step (`boxFloor`), and the sky never.
 */
export function returnRefusal(kind: string, boxFloor: boolean): string | null {
  if (kind === 'still' || kind === 'terrain') return null;
  if (kind === 'box') return boxFloor ? null : 'N: nothing solid under that box to stand on: aim at the ground or a floor';
  if (kind === 'water') return 'N: not the water (the body would be stood on its bed): aim at the ground or a floor';
  return 'N: aim at the ground or a floor to stand the body there';
}

/** What the session does to the game, handed in: the game's half of every rule here. */
export interface SessionPorts {
  /** What would refuse entering, read now. */
  state(): EntryState;
  /** The body's return point now, written into `out`. */
  body(out: ReturnPoint): void;
  /**
   * Everything entering does once the return point is kept: the grapple let go, a blade out quietly, any fight broken
   * off, the story's detectors told every area was left, noclip off, the body's collider off and its figure hidden, the
   * anchor moved to the camera's place and the eye given the camera's look, the guard on closing the tab set.
   */
  enter(): void;
  /** Stand the body back at `ret` the way `leaveWay` chose. */
  leave(ret: ReturnPoint, way: LeaveWay): void;
  /** Whether something solid is under a place within a step of it. */
  floorUnder(x: number, y: number, z: number): boolean;
  /** Whether a place is one the body keeps its height at, with nothing under it to stand on or fall to: a space zone, the drawn water. */
  keepsHeight(x: number, y: number, z: number): boolean;
  /** Take the mouse (Fly) or give it back (Point). */
  lock(): void;
  release(): void;
}

/** Which file a thing put down goes into. */
export type EditorDest = 'world' | 'story';

/** The session. */
export class EditorSession {
  /** Whether the editor is on. */
  on = false;
  /** Point mode (a free cursor), else Fly (the pointer locked, a crosshair). */
  point = false;
  /** The world is held: the living stand frozen while the day and the weather go on. */
  hold = false;
  /** Which file a click writes into. */
  dest: EditorDest = 'world';
  /** Where the body goes back to, kept at entry (and moved by N). */
  readonly ret: ReturnPoint = returnPoint();
  /** The last return point, kept after the editor turned off (a world gone, a leave): what `editor()` reports. */
  lastReturn: ReturnPoint | null = null;
  /** What the last leave was: a plain reset, exactly where it was, the curtain's way, or nothing at all (the world went). */
  lastLeave: LeaveWay | 'world-gone' | '' = '';
  /** When Fly last dropped to Point by itself (the lock lost): the Escape that lost it must not open the menu too. */
  droppedAt = -Infinity;
  private readonly ports: SessionPorts;

  constructor(ports: SessionPorts) {
    this.ports = ports;
  }

  /** Turn the editor on: refused in words (answered), or the return point kept first and the body handed over. */
  enter(): string | null {
    if (this.on) return null;
    const why = entryRefusal(this.ports.state());
    if (why) return why;
    // The return point is kept before anything moves.
    this.ports.body(this.ret);
    this.on = true;
    this.point = false;
    this.hold = false;
    this.ports.enter();
    this.ports.lock();
    return null;
  }

  /** Turn the editor off: the body stood back at the return point, the way `leaveWay` chooses. */
  leave(): void {
    if (!this.on) return;
    const r = this.ret;
    const way = leaveWay(this.ports.floorUnder(r.x, r.y, r.z), this.ports.keepsHeight(r.x, r.y, r.z));
    this.on = false;
    this.point = false;
    this.hold = false;
    this.lastReturn = { ...r };
    this.lastLeave = way;
    this.ports.leave(r, way);
  }

  /** N: the return point moved to where the aim met the ground or a floor, its room (by number, 0 outside) and the camera's heading with it. */
  setReturn(x: number, y: number, z: number, heading: number, cell: number): void {
    if (!this.on) return;
    const r = this.ret;
    r.x = x;
    r.y = y;
    r.z = z;
    r.heading = heading;
    r.cell = cell;
  }

  /** The world went with the editor on: off with it, standing nobody (the travel stands the body), the return point kept to say. */
  worldGone(): void {
    if (!this.on) return;
    this.on = false;
    this.point = false;
    this.hold = false;
    this.lastReturn = { ...this.ret };
    this.lastLeave = 'world-gone';
  }

  /** Point mode on (the cursor freed) or off (the pointer locked again). */
  setPoint(point: boolean): void {
    if (!this.on || point === this.point) return;
    this.point = point;
    if (point) this.ports.release();
    else this.ports.lock();
  }

  /**
   * The pointer lock went without the editor asking (Escape, a click away): in Fly it drops to Point, which the browser
   * has done already, and the menu stays shut; in Point it was the editor's own release. Answers true, the editor having
   * taken it, whenever the editor is on.
   */
  lockLost(now: number): boolean {
    if (!this.on) return false;
    if (!this.point) {
      this.point = true;
      this.droppedAt = now;
    }
    return true;
  }

  /** L: the other file. */
  toggleDest(): EditorDest {
    this.dest = this.dest === 'world' ? 'story' : 'world';
    return this.dest;
  }
}
