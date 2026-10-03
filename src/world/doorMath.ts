// The doors' own arithmetic, apart from anything that draws or collides, so a node test runs it: the
// shape of the converter's `doors.json`, how far through its slide a door is for how long it has been
// moving, when it starts and stops and what it sounds at, and where a leaf hangs for a given opening.
//
// What is the client's and what is ours. The times a door takes to open and to close, how far each leaf
// slides and which way, the radius a body must come within, whether a style has a second leaf and the
// four client effects it sounds at are all the client's own door style table, read by the converter
// (`tools/swg/doors.mjs`). How a door eases along that slide is ours: the table carries a springiness
// and a smoothness and nothing says what the client did with them, so smoothness is read as how much of
// the move is eased in and out (none is a constant speed, one a full ease) and springiness over one as a
// leaf running a little past its stop and settling back, under one as a heavy leaf slow to get going.
// Every number of ours is in `DOORS_TUNE`, live through `__debug.doors`.
import * as THREE from 'three';

/** The shape of `doors.json` this build reads; the converter's `DOORS_PACK_VERSION`, which a node test holds equal. */
export const DOORS_PACK_VERSION = 1;

/** One door style as a pack's doors.json carries it: its models by id in the shared folder, and its numbers. */
export interface DoorStyleRow {
  /** The leaf's model, and the second leaf's (a double door), by id in `doors/manifest.json`. */
  door: string | null;
  door2: string | null;
  /** The second leaf is hung turned half way round about its own up, so the two slide apart. */
  flip2: boolean;
  /** A frame hung at the door that does not move (only the table's two test styles name one). */
  frame: string | null;
  /** How far a leaf slides when fully open, in its own frame, metres (X already mirrored). */
  move: number[];
  /** Seconds to open and to close. */
  open: number;
  close: number;
  spring: number;
  smooth: number;
  /** Metres within which a body opens it. */
  trigger: number;
  /** The sounds each moment plays, as the style's client effects name them. */
  sounds: { openBegin?: string[]; openEnd?: string[]; closeBegin?: string[]; closeEnd?: string[] };
}

/** One door in a building: the portal it stands in, its style, the cells on its two sides and where it hangs (3x4 row-major, building frame). */
export interface DoorRow {
  portal: number;
  style: string;
  cells: number[];
  m: number[];
  /** Hung at its portal's bottom middle: the portal names no hardpoint. */
  fallback?: boolean;
}

/** A pack's doors.json. */
export interface DoorsFile {
  version: number;
  styles: Record<string, DoorStyleRow>;
  models: Record<string, DoorRow[]>;
}

/**
 * What the portal renderer needs of a building's doors, kept on the building (`Building.doors`): the
 * meshes of the doors on its exits, which stand in the world and join the rooms' pass of their own
 * building only, and the meshes of the doors between two of its rooms, each with those two rooms, which
 * are shown with the rooms like the rest of its interior. Nothing is shown before `ready` (its programs
 * exist).
 */
export interface BuildingDoors {
  ready: boolean;
  outer: THREE.Object3D[];
  inner: THREE.Object3D[];
  /** Two rooms a mesh of `inner`, index for index: the rooms on either side of its door. */
  innerCells: Int16Array;
}

/** What a door is opened by, as the locks' seam is told it. */
export const OPENER = { player: 0, mobile: 1, fighter: 2, peer: 3 } as const;

/** Ours, every one: see the head of this file. `__debug.doors({ tune })` moves them live. */
export interface DoorsTune {
  /** Doors drawn, opening and blocking at all. Off, the doors already standing are left where they are and nothing moves them. */
  on: boolean;
  /** Metres past its trigger a door already open stays open by, so a body standing at the edge does not swing it every step. */
  release: number;
  /** Seconds a door waits with nobody near before it begins to close. */
  linger: number;
  /**
   * How hard a style's springiness bends the end of a move: the bend is (springiness - 1) times this. At
   * 5 the table's usual 1.3 runs a leaf about one and a half per cent of its slide past its stop and back,
   * and its heavy 0.5 lags behind and catches up at the end; at 0 every door eases the same way.
   */
  spring: number;
  /** A collider's least half thickness, metres: the door models are a few centimetres thick and a fast body must not pass through. */
  minDepth: number;
  /** A shut door blocks (a kinematic body per leaf). */
  solid: boolean;
  /** The doors on a building's exits cast shadows. Off by default: the shell around the doorway casts the same shadow and every door costs a draw a cascade. */
  shadows: boolean;
  /** The doors sound. */
  sound: boolean;
  /** Multiplies every style's trigger radius (the radius alone: never how far a door stands from its building's middle). */
  reach: number;
  /** Multiplies every style's open and close times. */
  speed: number;
}

export const DOORS_TUNE: DoorsTune = { on: true, release: 0.5, linger: 0.3, spring: 5, minDepth: 0.12, solid: true, shadows: false, sound: true, reach: 1, speed: 1 };

/** The moments a door sounds at, as the bits `stepDoor` answers. */
export const DOOR_EVENT = { openBegin: 1, openEnd: 2, closeBegin: 4, closeEnd: 8 } as const;

/**
 * How far along its move a door is, 0 to 1 (a little past 1 for a springy one), when a share `p` of
 * the move's time has gone. Smoothness blends a constant speed with a smoothstep; springiness bends the
 * end (`tune.spring`): over one the leaf finishes quicker, and past about 1.2 runs a little past its stop
 * and comes back; under one it lags and catches up at the end. 0 at 0 and exactly 1 at 1 whatever the
 * numbers, and never moving backwards for a springiness up to 1.2.
 */
export function doorEase(p: number, spring: number, smooth: number, tune: DoorsTune = DOORS_TUNE): number {
  const t = p <= 0 ? 0 : p >= 1 ? 1 : p;
  const sm = smooth <= 0 ? 0 : smooth >= 1 ? 1 : smooth;
  const s = t + sm * (t * t * (3 - 2 * t) - t);
  // s + b s^3 (1 - s) is s again at both ends, and its slope is 1 + b (3s^2 - 4s^3), which lies between
  // 1 - b and 1 + b/4: so it never runs backwards for b between -4 and 1, and above 1 it rises past 1
  // just before the end and settles back (b 1.5 is about one and a half per cent, 3 about twelve).
  const raw = (spring - 1) * tune.spring;
  const b = raw < -3 ? -3 : raw > 3 ? 3 : raw;
  return s + b * s * s * s * (1 - s);
}

/** One door's motion: how open it is, where the move it is making began and ends, and how long it has been making it. */
export interface DoorMotion {
  /** How open, 0 shut to 1 open (a springy leaf a little past 1 for a moment). */
  open: number;
  /** Where the move in hand began, and where it is going (0 or 1). */
  from: number;
  target: number;
  /** Seconds into the move in hand. */
  t: number;
  moving: boolean;
  /** Seconds nobody has been near while it stood open, toward `linger`. */
  idle: number;
}

export function newDoorMotion(): DoorMotion {
  return { open: 0, from: 0, target: 0, t: 0, moving: false, idle: 0 };
}

/**
 * One step of a door: `want` is whether a body is near enough to hold it open. A move toward the other
 * end begins from wherever the door stands, so a body arriving while it closes turns it round with no
 * jump, and takes the share of the style's time that is left of the distance. Answers the moments it
 * crossed (`DOOR_EVENT` bits) and nothing allocated.
 */
export function stepDoor(d: DoorMotion, want: boolean, dt: number, s: { open: number; close: number; spring: number; smooth: number }, tune: DoorsTune = DOORS_TUNE): number {
  let events = 0;
  if (want) {
    d.idle = 0;
    if (d.target !== 1) {
      d.from = d.open;
      d.target = 1;
      d.t = 0;
      d.moving = true;
      events |= DOOR_EVENT.openBegin;
    }
  } else if (d.target !== 0) {
    // Only once it has stood with nobody near for `linger`, counted from the moment it was last wanted.
    d.idle += dt;
    if (d.idle >= tune.linger) {
      d.from = Math.min(1, Math.max(0, d.open));
      d.target = 0;
      d.t = 0;
      d.moving = true;
      events |= DOOR_EVENT.closeBegin;
    }
  }
  if (!d.moving) return events;
  d.t += dt;
  const opening = d.target === 1;
  const span = Math.abs(d.target - d.from);
  const time = Math.max(1e-3, (opening ? s.open : s.close) * Math.max(0, tune.speed)) * span;
  const p = time > 1e-6 ? d.t / time : 1;
  if (p >= 1) {
    d.open = d.target;
    d.moving = false;
    events |= opening ? DOOR_EVENT.openEnd : DOOR_EVENT.closeEnd;
    return events;
  }
  // A closing leaf never runs past its frame: the spring bends only the opening.
  const f = doorEase(p, opening ? s.spring : Math.min(1, s.spring), s.smooth, tune);
  const open = d.from + (d.target - d.from) * f;
  d.open = opening ? open : Math.max(0, open);
  return events;
}

/**
 * Where a leaf hangs with no slide: the building's matrix, then the door's own hardpoint (3x4 row-major
 * in the building's frame), then, for a second leaf hung flipped, half a turn about its own up. Into `out`.
 */
export function leafBase(building: THREE.Matrix4, m: readonly number[], flip: boolean, out: THREE.Matrix4): THREE.Matrix4 {
  out.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], 0, 0, 0, 1);
  out.premultiply(building);
  if (flip) {
    // Half a turn about the leaf's own Y: its X and Z columns change sign.
    const e = out.elements;
    e[0] = -e[0];
    e[1] = -e[1];
    e[2] = -e[2];
    e[8] = -e[8];
    e[9] = -e[9];
    e[10] = -e[10];
  }
  return out;
}

/** A leaf's slide when fully open, in the world: the style's move taken through the leaf's own turn. Into `out`. */
export function leafSlide(base: THREE.Matrix4, move: readonly number[], out: THREE.Vector3): THREE.Vector3 {
  const e = base.elements;
  const x = move[0] ?? 0;
  const y = move[1] ?? 0;
  const z = move[2] ?? 0;
  return out.set(e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z);
}

/** A leaf's matrix at an opening: its base with the slide's share added to its place. Into `out`, nothing allocated. */
export function leafAt(base: THREE.Matrix4, slide: THREE.Vector3, open: number, out: THREE.Matrix4): THREE.Matrix4 {
  out.copy(base);
  const e = out.elements;
  e[12] += slide.x * open;
  e[13] += slide.y * open;
  e[14] += slide.z * open;
  return out;
}

/** Whether a door's two cells make it a door to the world: one side is the exterior (cell 0). */
export function isExitDoor(cells: readonly number[]): boolean {
  return (cells[0] ?? 0) === 0 || (cells[1] ?? 0) === 0;
}

// ---- Who opens a door ----
//
// The bodies that may open a door this step are one flat list (`xyz` three numbers a body, `kind` its
// `OPENER`), told again every step and never shortened, so nothing here allocates. A building's doors
// first take the bodies near enough that any of its doors could be within their reach (`openersNear`),
// then each door asks of those alone whether one is within its own radius and may open it (`doorWanted`).

/**
 * The bodies near enough to a building's middle (`bx`, `bz`) that one of its doors could open for them:
 * as far as its farthest door stands from its middle (`spread`, level metres) plus the largest radius
 * any of its doors opens at (`trigger`) times the tune's `reach`, plus the tune's `release`. The two are
 * kept apart so the `reach` knob moves only the radius and never the building's own size. Their indices
 * into `xyz` go into `out`; answers how many.
 */
export function openersNear(bx: number, bz: number, spread: number, trigger: number, xyz: Float64Array, n: number, out: Int32Array, tune: DoorsTune = DOORS_TUNE): number {
  const reach = spread + trigger * Math.max(0, tune.reach) + Math.max(0, tune.release);
  const r2 = reach * reach;
  let m = 0;
  for (let k = 0; k < n; k++) {
    const dx = xyz[k * 3] - bx;
    const dz = xyz[k * 3 + 2] - bz;
    if (dx * dx + dz * dz <= r2) out[m++] = k;
  }
  return m;
}

/** What the opening decision counts: bodies within a door's radius that its lock turned away. */
export interface DoorCounts {
  refused: number;
}

/**
 * Whether a door is held open this step: one of the bodies `near` names (the first `m`) stands within its
 * radius of the doorway's bottom middle (`ox`, `oy`, `oz`) -- its style's trigger times the tune's
 * `reach`, and the tune's `release` more while it is already opening or open (`open`), so a body at the
 * edge does not swing it every step -- and is let through. `ask` is the locks' seam: null lets every body
 * through, which is the game today; a body it refuses, or a lock that throws, keeps that door shut and is
 * counted. Nothing allocated.
 */
export function doorWanted<T>(
  door: T,
  ox: number,
  oy: number,
  oz: number,
  trigger: number,
  open: boolean,
  xyz: Float64Array,
  kind: Uint8Array,
  near: Int32Array,
  m: number,
  ask: ((door: T, who: number) => boolean) | null,
  counts: DoorCounts,
  tune: DoorsTune = DOORS_TUNE,
): boolean {
  const r = trigger * Math.max(0, tune.reach) + (open ? Math.max(0, tune.release) : 0);
  const r2 = r * r;
  for (let j = 0; j < m; j++) {
    const k = near[j];
    const dx = xyz[k * 3] - ox;
    const dy = xyz[k * 3 + 1] - oy;
    const dz = xyz[k * 3 + 2] - oz;
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    if (!ask) return true;
    try {
      if (ask(door, kind[k])) return true;
    } catch {
      // A lock that throws keeps its own door shut and nothing else.
    }
    counts.refused++;
  }
  return false;
}

/** Where the doors are told of the step's bodies (`Doors`). */
export interface OpenerSink {
  beginOpeners(): void;
  addOpener(x: number, y: number, z: number, kind: number): void;
}

/** A body that may open a door: its feet in the world and whether it is down. */
export interface OpenerBody {
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly dead: boolean;
}

/** One of the catalogue's people or creatures, which opens a door only once its model is up and while it is in the world. */
export interface OpenerMobile extends OpenerBody {
  readonly ready: boolean;
  readonly removed: boolean;
}

/**
 * Every body that opens a door this step, told to the doors: the player wherever they stand (`player`,
 * null while they stand in a hull's rooms, which are in no building of this world and have no doors),
 * every person and creature of the catalogue with its model up and alive, every fighter alive and every
 * other player's body alive. Not the world's list of targets, which leaves the player out while a panel
 * is open: a door must not shut on somebody who has stopped to read a menu in its doorway. Walked by
 * index; nothing allocated.
 */
export function gatherOpeners(
  sink: OpenerSink,
  player: { readonly x: number; readonly y: number; readonly z: number } | null,
  mobiles: readonly OpenerMobile[] | null | undefined,
  fighters: readonly OpenerBody[],
  peers: readonly OpenerBody[],
): void {
  sink.beginOpeners();
  if (player) sink.addOpener(player.x, player.y, player.z, OPENER.player);
  if (mobiles) {
    for (let i = 0; i < mobiles.length; i++) {
      const m = mobiles[i];
      if (!m.ready || m.removed || m.dead) continue;
      sink.addOpener(m.pos.x, m.pos.y, m.pos.z, OPENER.mobile);
    }
  }
  for (let i = 0; i < fighters.length; i++) {
    const n = fighters[i];
    if (n.dead) continue;
    sink.addOpener(n.pos.x, n.pos.y, n.pos.z, OPENER.fighter);
  }
  for (let i = 0; i < peers.length; i++) {
    const f = peers[i];
    if (f.dead) continue;
    sink.addOpener(f.pos.x, f.pos.y, f.pos.z, OPENER.peer);
  }
}
