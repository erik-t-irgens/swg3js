// Climbing II, phase 1: the test course's harness. Each piece of the one layout (src/anim/climbCourse.ts) stood alone through
// the one builder (src/anim/climbCourseBuild.ts) on a flat ground 0.05 m under its slab (as the game stands it on the open
// ground of a world), and a body driven through it by the grapple's harness (tools/swg/tests/grappleBody.ts: the player's
// own movement, slope rule, step-up, ledges and wall climb, stepped in the player's order on the real Rapier) with scripted
// keys, at any frame rate: walk or run at it, jump, hold W, A and D along the lip, a hop each way, Space with nothing to hop
// to, a climb up, a drop. What today's climbing does is recorded per piece and rate (`PieceRun`): grabbed or not (which lip,
// braced or free, after how long), each shimmy's travel and why it ended (its leading hand at the lip's end, stopped short,
// or out of time), each hop's target and whether it was reached, the hands' worst distance off the lip they hold, let-goes
// nothing asked for, the wall climb's stalls, and where the body ended; and every frame of it goes into a hash (`trace`),
// which `climbToday.test.ts` holds to today's.
//
// The stamina is kept full (filled after every frame), so its drain, which is its own suite's, never decides what a piece
// measures; and each body is taken out of its world once the script is done with it, before the next one is stood, so no
// body stands in another's way. Not a test itself.
import { createHash, type Hash } from 'node:crypto';
import { TestBody, ground, makePhysics, type Physics } from './grappleBody.ts';
import { LEDGE_HANG } from '../../../src/player/ledge.ts';
import { WALL_ON } from '../../../src/player/wallClimb.ts';
import { LEDGE_FACTS, LEDGE_ROLES } from '../../../src/anim/ledgeClips.ts';
import { CLIMB_TUNE } from '../../../src/anim/climbTune.ts';
import { climbCourse, lipPiece, type ClimbCourse, type CourseLip, type CoursePiece } from '../../../src/anim/climbCourse.ts';
import { buildCourseColliders, courseToWorld, courseWayToWorld, worldToCourse, type CourseCollider, type CourseFrame } from '../../../src/anim/climbCourseBuild.ts';

/** How far under its slab's top the ground stands (the game's `climbTest` stands each slab this far over the highest ground under it). */
export const SLAB_LIFT = 0.05;

/** A piece stood alone in a world of its own: its local x the world's -x, its z the world's z, its slab's top at nought. */
export interface Stood {
  physics: Physics;
  piece: CoursePiece;
  frame: CourseFrame;
  /** Its lips in the world, and each one's chain (its name less a trailing number: a polyline's segments, a run of steps). */
  lips: { name: string; chain: string; a: [number, number, number]; b: [number, number, number] }[];
  /** Its colliders (the feedback round: a refused climb up names the course's solid it met, as the game's `climbTest` does). */
  colliders: CourseCollider[];
}

export async function standPiece(piece: CoursePiece, shiftX = 0, shiftZ = 0): Promise<Stood> {
  const physics = await makePhysics();
  ground(physics, -SLAB_LIFT);
  // (Moved by `shiftX`, `shiftZ` metres in the world, the smoothness round's review: a search whose answer turns on where the
  // piece stands is found only by standing it somewhere not round.)
  const frame: CourseFrame = { ox: piece.at[0] + shiftX, oz: -piece.at[1] + shiftZ, h: 0, ref: () => 0 };
  const one: ClimbCourse = { pieces: [piece], floor: 1, reach: { standing: 0, running: 0 }, lipSlope: 0, unknown: [] };
  const colliders = buildCourseColliders(physics.world, one, frame);
  physics.stepOnce();
  const w = { x: 0, y: 0, z: 0 };
  const lips = piece.lips.map((L: CourseLip) => {
    courseToWorld(frame, piece, L.a[0], L.a[1], L.a[2], w);
    const a: [number, number, number] = [w.x, w.y, w.z];
    courseToWorld(frame, piece, L.b[0], L.b[1], L.b[2], w);
    return { name: L.name, chain: L.name.replace(/\d+$/, ''), a, b: [w.x, w.y, w.z] as [number, number, number] };
  });
  return { physics, piece, frame, lips, colliders };
}

/** A collider of a stood piece by its name on the course (`the course's beam (room-beam)`), as the game's `climbTest` names its own; null for another (the harness's ground). */
export function courseNamer(s: Stood): (c: { handle: number }) => string | null {
  return (c) => {
    const k = s.colliders.find((q) => q.collider.handle === c.handle);
    return k ? `the course's ${k.role} (${k.piece})` : null;
  };
}

// ---- the lips in the world: nearest, and along a chain ---------------------------------------------------------------------
/** A point's nearest lip and how far it stands off it (3D), and where along that lip's chain it falls (metres from the chain's first end). */
export function nearestLip(s: Stood, x: number, y: number, z: number): { name: string; chain: string; off: number; along: number; total: number } {
  let best = { name: '', chain: '', off: Infinity, along: 0, total: 0 };
  const lens = new Map<string, number>();
  for (const L of s.lips) lens.set(L.chain, (lens.get(L.chain) ?? 0) + Math.hypot(L.b[0] - L.a[0], L.b[1] - L.a[1], L.b[2] - L.a[2]));
  const before = new Map<string, number>();
  for (const L of s.lips) {
    const ux = L.b[0] - L.a[0];
    const uy = L.b[1] - L.a[1];
    const uz = L.b[2] - L.a[2];
    const len = Math.hypot(ux, uy, uz);
    const t = Math.max(0, Math.min(1, ((x - L.a[0]) * ux + (y - L.a[1]) * uy + (z - L.a[2]) * uz) / (len * len)));
    const d = Math.hypot(L.a[0] + ux * t - x, L.a[1] + uy * t - y, L.a[2] + uz * t - z);
    const c0 = before.get(L.chain) ?? 0;
    if (d < best.off) best = { name: L.name, chain: L.chain, off: d, along: c0 + t * len, total: lens.get(L.chain) ?? len };
    before.set(L.chain, c0 + len);
  }
  return best;
}

/** The hands' rest half span of the hang's kind on this body, metres (the ledges' own `handHalf`). */
function handHalf(b: TestBody): number {
  const L = b.ledge;
  return (Math.abs(LEDGE_FACTS[L.braced ? LEDGE_ROLES.braced.idle : LEDGE_ROLES.free.idle].span0) / 2) * b.ledgeScale;
}

/** The rail's own sample at the hand on side `k` (+1 the left, -1 the right), its scratch put back after (so the hang reads nothing it did not write). */
function handAt(b: TestBody, k: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const L = b.ledge;
  const R = L.rail;
  const keep = [R.q, R.sx, R.sy, R.sz, R.snx, R.snz, R.stop];
  R.q = L.barc + handHalf(b) * k;
  R.sample();
  out.x = R.sx;
  out.y = R.sy;
  out.z = R.sz;
  [R.q, R.sx, R.sy, R.sz, R.snx, R.snz, R.stop] = keep;
  return out;
}

// ---- the body and the frame's watch ---------------------------------------------------------------------------------------
const SEED = new Float64Array(8);
const HAND = { x: 0, y: 0, z: 0 };

/** What a frame watch measures while a script runs. */
export class Watch {
  hash: Hash = createHash('sha256');
  frames = 0;
  /** The hands' worst distance off the lip they hold, while hanging. */
  handOff = 0;
  /** Let-goes nothing in the script asked for (while it holds a key along a lip), with their words. */
  falls = 0;
  fell: string[] = [];
  /** Set by the script while no let-go is asked for. */
  holdOn = false;
  /** The longest the wall climb stood in a stall it named, seconds. */
  wallStall = 0;
  private stallRun = 0;
  private wasHolding = false;
  readonly s: Stood;
  readonly b: TestBody;
  constructor(s: Stood, b: TestBody) {
    this.s = s;
    this.b = b;
  }
  frame(dt: number): void {
    const b = this.b;
    const L = b.ledge;
    fill(b);
    SEED[0] = b.pos.x;
    SEED[1] = b.pos.y;
    SEED[2] = b.pos.z;
    SEED[3] = L.phase;
    SEED[4] = b.wall.phase;
    SEED[5] = b.heading;
    SEED[6] = b.vel.y;
    SEED[7] = b.stamina.value;
    this.hash.update(new Uint8Array(SEED.buffer.slice(0)));
    this.frames++;
    if (L.phase === LEDGE_HANG && L.rail.n > 0 && this.s.lips.length) {
      for (const k of [-1, 1]) {
        handAt(b, k, HAND);
        this.handOff = Math.max(this.handOff, nearestLip(this.s, HAND.x, HAND.y, HAND.z).off);
      }
    }
    const holding = L.holding || b.wall.holding;
    if (this.wasHolding && !holding && this.holdOn) {
      this.falls++;
      this.fell.push(L.lastLetGo || b.wall.said || 'let go');
    }
    this.wasHolding = holding;
    if (b.wall.phase === WALL_ON && b.wall.stallWhy) {
      this.stallRun += dt;
      this.wallStall = Math.max(this.wallStall, this.stallRun);
    } else this.stallRun = 0;
  }
}

/** The stamina full again (before each move: its drain is its own suite's, not what a piece measures). */
function fill(b: TestBody): void {
  b.stamina.value = 100;
  b.stamina.tired = false;
}

/**
 * A body at one of a piece's starts, facing its way, settled (no Force: a plain jump's 0.8 m apex, as the ledges' tests).
 * Every body starts at the physics' own phase nought, as the first body of a fresh world does: the world steps on whole
 * sixtieths of a second, so at 144 and 240 frames a second a body's frames fall between its steps by however many frames
 * the bodies before it in this world took, and that moved a later attempt's numbers (the 3.6 m lip's running grab at 240:
 * 2.613 s from phase nought, 2.671 s a quarter of a step on) whenever an earlier attempt's script ran longer or shorter.
 */
export function bodyAt(s: Stood, start: string, fps: number): { b: TestBody; w: Watch } {
  const st = s.piece.starts.find((q) => q.name === start);
  if (!st) throw new Error(`${s.piece.id} has no start ${start}`);
  (s.physics as unknown as { acc: number }).acc = 0;
  const b = new TestBody(s.physics);
  b.jka.forceLevel = 0;
  b.ledge.namer = courseNamer(s);
  const w = { x: 0, y: 0, z: 0 };
  courseToWorld(s.frame, s.piece, st.at[0], st.at[1], st.at[2], w);
  b.place(w.x, w.y, w.z);
  face(s, b, st.face[0], st.face[1]);
  const watch = new Watch(s, b);
  b.beforeStep = (dt) => watch.frame(dt);
  b.run(fps, 0.3);
  return { b, w: watch };
}

/** The camera (the move keys' frame) turned to a way of the piece, and the body's heading with it. */
function face(s: Stood, b: TestBody, dx: number, dz: number): void {
  const f = courseWayToWorld(s.frame, dx, dz, { x: 0, z: 0 });
  b.forward.set(f.x, 0, f.z);
  b.right.set(-f.z, 0, f.x);
  b.heading = Math.atan2(f.x, f.z);
}

/** Frames until `until` holds or the seconds run out; the seconds taken (Infinity for never). */
export function runUntil(b: TestBody, fps: number, seconds: number, until: () => boolean): number {
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    b.frame(1 / fps);
    if (until()) return (i + 1) / fps;
  }
  return Infinity;
}

/** A key pressed for one frame, every other key as it was. */
export function tap(b: TestBody, code: string, fps: number): void {
  b.key(code, true);
  b.frame(1 / fps);
  b.key(code, false);
}

const hangs = (b: TestBody) => b.ledge.phase === LEDGE_HANG;
/** Climbing II, phase 2: the climb takes the use key (`climb.grab` 'use'), so a script presses E where it grabs or climbs. */
const useGrab = (): boolean => CLIMB_TUNE.grab === 'use';
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const here = (s: Stood, b: TestBody) => worldToCourse(s.frame, s.piece, b.pos.x, b.pos.y, b.pos.z, { x: 0, y: 0, z: 0 });
const lipNow = (s: Stood, b: TestBody) => nearestLip(s, b.ledge.lip.ex, b.ledge.lip.ey, b.ledge.lip.ez);

// ---- the reaches --------------------------------------------------------------------------------------------------------
/**
 * Whether a jump (standing, or running from 4.2 m back) grabs the layout's own braced lip at `height` at `fps`: the ledges'
 * own grab in the jump's flight, before the feet are down again (W held against the face after a landing starts the wall
 * climb, which reaches any lip and is no jump's reach).
 */
export async function jumpGrabs(height: number, how: 'stand' | 'run', fps: number): Promise<boolean> {
  const s = await standPiece(lipPiece('reach', height, true));
  const { b } = bodyAt(s, how, fps);
  const j = jump(b, how, fps);
  return j.ok && !j.viaWall;
}

/** The highest lip (to the centimetre) a jump grabs at `fps`, by halving between a lip it grabs and one it does not. */
export async function reachAt(how: 'stand' | 'run', fps: number, lo = 2.6, hi = 3.6): Promise<number> {
  let a = Math.round(lo * 100);
  let z = Math.round(hi * 100);
  if (!(await jumpGrabs(a / 100, how, fps))) return Number.NaN;
  if (await jumpGrabs(z / 100, how, fps)) return z / 100;
  while (z - a > 1) {
    const m = Math.floor((a + z) / 2);
    if (await jumpGrabs(m / 100, how, fps)) a = m;
    else z = m;
  }
  return a / 100;
}

/**
 * A jump at what is ahead: W held (0.45 s of it first for a running jump), Space tapped, W held until the ledges have the
 * body hanging or the feet are down again (no longer: W against a face after a landing starts the wall climb, which is no
 * jump's grab), or 2.5 s. A wall climb the jump started in the air and still holds when the window closes is carried on,
 * W still held, to the hang it hands the ledges (or until it lets go, 6 s at most), and a ledge grab under way then to its
 * hang (2 s at most): the window is the script's, not the game's, and a hang that came 17 ms after it (the 3.6 m lip's at
 * 240 frames a second) is no difference by frame rate. The time is the whole of it, from the first key.
 */
export function jump(b: TestBody, how: 'stand' | 'run', fps: number): { ok: boolean; t: number; viaWall: boolean } {
  fill(b);
  const climbs0 = b.wall.climbs;
  b.key('KeyW', true);
  if (how === 'run') b.run(fps, 0.45);
  // Climbing II, phase 2: under `climb.grab` 'use' a lip is grabbed only on the use key, pressed on the jump's own frame and
  // held (maker B: pressed a frame after it, as maker A had it, it came 33 ms into the jump at 30 frames a second against 4 at
  // 240, and a low lip had passed the hands by then at 30 alone; held on the ground before the jump, a wall in reach would be
  // climbed instead of jumped at, and on the jump's frame the wall climb waits while the body rises).
  const use = useGrab();
  if (use) b.key('KeyE', true);
  tap(b, 'Space', fps);
  let flew = false;
  const t = runUntil(b, fps, 2.5, () => {
    if (!b.grounded) flew = true;
    return hangs(b) || (flew && b.grounded && !b.ledge.holding);
  });
  let took = Number.isFinite(t) ? t : 2.5;
  // The wall climb under way in the air when the window ran out, carried with W held to its hang or until it lets go (never
  // one after the feet were down, which closed the window).
  if (!Number.isFinite(t) && b.wall.holding && !hangs(b)) {
    const c = runUntil(b, fps, 6, () => hangs(b) || (!b.wall.holding && !b.ledge.holding));
    took += Number.isFinite(c) ? c : 6;
  }
  b.key('KeyW', false);
  // A grab under way when the window closed is carried to its hang.
  if (b.ledge.holding && !hangs(b)) {
    const c = runUntil(b, fps, 2, () => hangs(b) || !b.ledge.holding);
    took += Number.isFinite(c) ? c : 2;
  }
  if (use) b.key('KeyE', false);
  const ok = hangs(b);
  // W held against the face in the air starts the wall climb too (after `climb.wallStart`), which carries the body up to any
  // lip and hands it to a hang there: that is no jump's grab, and the record says which it was.
  return { ok, t: ok ? r3(took + 1 / fps + (how === 'run' ? 0.45 : 0)) : Infinity, viaWall: b.wall.climbs > climbs0 };
}

// ---- one piece's run ----------------------------------------------------------------------------------------------------
export interface Shimmy {
  key: string;
  /** How far the body's middle went along the lips it holds, metres (positive the key's way; NaN where it ended on another chain). */
  moved: number;
  /** Why the key was let go: 'end' (the leading hand at the end of the lip's chain), 'stopped' (no progress for 0.4 s), 'time', 'fell'. */
  why: string;
  /** Where the leading hand stood against the end of the chain it went along, metres. */
  stop: number;
  /** The lip held at the end. */
  on: string;
  /** How far the body turned, degrees (round a corner). */
  turned: number;
  /** How far the lip held rose while it went, metres. */
  rose: number;
  t: number;
}
export interface Hop {
  key: string;
  from: string;
  to: string;
  reached: boolean;
  words: string;
  t: number;
}
export interface PieceRun {
  id: string;
  kind: string;
  fps: number;
  /** Each grab tried: how, whether it held, the lip, braced or free, seconds from the key. */
  grab: { how: string; ok: boolean; lip: string; braced: boolean | null; t: number }[];
  shimmies: Shimmy[];
  hops: Hop[];
  /** A climb up off the hang (W): onto the top, or the words that refused it. */
  climb: string;
  /** Stages a script reached (the walls', the pits', the obstacles', the free run's). */
  stages: string[];
  handOff: number;
  falls: number;
  fell: string[];
  wallStall: number;
  /** Where the body ended (the piece's frame), and the words the ledges and the climb said. */
  end: [number, number, number];
  words: string[];
  frames: number;
  trace: string;
}

/** A grab from a start by a jump. */
function grab(s: Stood, start: string, how: 'stand' | 'run', fps: number): { b: TestBody; w: Watch; rec: PieceRun['grab'][number] } {
  const { b, w } = bodyAt(s, start, fps);
  const j = jump(b, how, fps);
  return { b, w, rec: { how: `${how} from ${start}${j.viaWall ? ' (the wall climb took it in the air)' : ''}`, ok: j.ok, lip: j.ok ? lipNow(s, b).name : '', braced: j.ok ? b.ledge.braced : null, t: j.t } };
}

/**
 * A key held along the lip until the leading hand is at the end of the chain it holds ('end'), the body has made no way for
 * 0.4 s ('stopped'), it is no longer hanging ('fell'), it is `until` along the chain, or the time runs out.
 */
export function shimmy(s: Stood, b: TestBody, w: Watch, key: 'KeyA' | 'KeyD', fps: number, max = 20, until = Number.NaN): Shimmy {
  fill(b);
  const L = b.ledge;
  const dir = key === 'KeyD' ? 1 : -1;
  const at0 = lipNow(s, b);
  const h0 = b.heading;
  const y0 = L.lip.ey;
  let why = 'time';
  let lastX = b.pos.x;
  let lastZ = b.pos.z;
  let still = 0;
  w.holdOn = true;
  b.key(key, true);
  const t = runUntil(b, fps, max, () => {
    if (!L.holding) {
      why = 'fell';
      return true;
    }
    if (!hangs(b)) return false;
    const lead = nearestLip(s, ...xyz(handAt(b, -dir, HAND)));
    if (lead.chain === at0.chain && (dir > 0 ? lead.total - lead.along : lead.along) < 0.02) {
      why = 'end';
      return true;
    }
    if (until === until) {
      const mid = lipNow(s, b);
      if (mid.chain === at0.chain && (mid.along - until) * dir >= 0) {
        why = 'there';
        return true;
      }
    }
    const moved = Math.hypot(b.pos.x - lastX, b.pos.z - lastZ);
    if (moved > 0.01) {
      lastX = b.pos.x;
      lastZ = b.pos.z;
      still = 0;
    } else if ((still += 1 / fps) >= 0.4) {
      why = 'stopped';
      return true;
    }
    return false;
  });
  b.key(key, false);
  w.holdOn = false;
  const at1 = lipNow(s, b);
  let stop = Number.NaN;
  if (hangs(b) && L.rail.n > 0) {
    const lead = nearestLip(s, ...xyz(handAt(b, -dir, HAND)));
    stop = dir > 0 ? lead.total - lead.along : lead.along;
  }
  const moved = at0.chain === at1.chain ? (at1.along - at0.along) * dir : Number.NaN;
  const turned = (Math.atan2(Math.sin(b.heading - h0), Math.cos(b.heading - h0)) * 180) / Math.PI;
  return { key: key === 'KeyD' ? 'D' : 'A', moved: r3(moved), why, stop: r3(stop), on: L.holding ? at1.name : '', turned: r3(turned), rose: r3(L.lip.ey - y0), t: Number.isFinite(t) ? r3(t) : max };
}
const xyz = (p: { x: number; y: number; z: number }): [number, number, number] => [p.x, p.y, p.z];

/**
 * A hop (a key and Space pressed on one frame, both let go after: the hang decides on the press, and a key still held after
 * a refusal would shimmy on), run until hanging again or 3 s; reached where it hangs from a lip of `to`'s chain.
 */
export function hop(s: Stood, b: TestBody, key: 'KeyA' | 'KeyD' | 'KeyW' | 'KeyS', fps: number, to: string): Hop {
  fill(b);
  const L = b.ledge;
  const from = L.holding ? lipNow(s, b).name : '';
  const words0 = b.ledgeWords.length;
  b.key(key, true);
  tap(b, 'Space', fps);
  b.key(key, false);
  // Climbing II: on the use key, a jump off backward (S with Space) is caught by a lip behind only with E held in the air.
  const catchBehind = useGrab() && key === 'KeyS';
  if (catchBehind) b.key('KeyE', true);
  let left = false;
  const t = runUntil(b, fps, 3, () => {
    if (L.phase !== LEDGE_HANG) left = true;
    return left && hangs(b);
  });
  if (catchBehind) b.key('KeyE', false);
  const now = hangs(b) ? lipNow(s, b) : null;
  const words = b.ledgeWords.slice(words0).join(' ');
  return { key: key.replace('Key', ''), from, to: now ? now.name : '', reached: !!now && now.chain === to.replace(/\d+$/, '') && now.name !== from, words, t: Number.isFinite(t) ? r3(t) : Infinity };
}

/** Climbing II, item 3: Space with nowhere to hop jumps a little up and off the wall (`climb.spaceOff` 'jump'). */
const offJumps = (): boolean => CLIMB_TUNE.spaceOff === 'jump';

/** W pressed at the hang: up onto the top (stood there, the ledges let go of it), or the words that refused it. */
function climbUp(s: Stood, b: TestBody, fps: number): string {
  fill(b);
  const words0 = b.ledgeWords.length;
  // The smoothness round (`climb.hangKeys` 'cue'): W goes where the view looks, so the view is turned to the wall first (a
  // corner rounded leaves it along the old one, where W would mean a side). Under 'before' the view is left as it is.
  if (CLIMB_TUNE.hangKeys === 'cue' && b.ledge.holding) {
    b.forward.set(Math.sin(b.heading), 0, Math.cos(b.heading));
    b.right.set(-Math.cos(b.heading), 0, Math.sin(b.heading));
  }
  tap(b, 'KeyW', fps);
  runUntil(b, fps, 3, () => !b.ledge.holding);
  b.run(fps, 0.2);
  const c = here(s, b);
  if (!b.ledge.holding && b.grounded) return `stood at y ${r3(c.y)}`;
  return b.ledgeWords.slice(words0).join(' ') || (b.ledge.holding ? 'still hanging' : `fell to y ${r3(c.y)}`);
}

function newRun(s: Stood, fps: number): PieceRun {
  return { id: s.piece.id, kind: s.piece.kind, fps, grab: [], shimmies: [], hops: [], climb: '', stages: [], handOff: 0, falls: 0, fell: [], wallStall: 0, end: [0, 0, 0], words: [], frames: 0, trace: '' };
}

/** Folds a watched body's numbers into the run (several bodies may serve one run: their hashes chained in order). */
function fold(run: PieceRun, s: Stood, b: TestBody, w: Watch, trace: Hash): void {
  run.handOff = r3(Math.max(run.handOff, w.handOff));
  run.falls += w.falls;
  run.fell.push(...w.fell);
  run.wallStall = r3(Math.max(run.wallStall, w.wallStall));
  run.frames += w.frames;
  run.words.push(...b.ledgeWords);
  const c = here(s, b);
  run.end = [r3(c.x), r3(c.y), r3(c.z)];
  trace.update(w.hash.digest());
  // Out of the world, so the next body of the script meets nothing of this one's.
  s.physics.removeBody(b.body);
  s.physics.stepOnce();
}

/** The step down: off a top, crouched and walking off its lip into a hang. */
function stepDown(s: Stood, start: string, fps: number): { b: TestBody; w: Watch; rec: PieceRun['grab'][number] } {
  const { b, w } = bodyAt(s, start, fps);
  fill(b);
  b.key('ControlLeft', true);
  b.key('KeyW', true);
  // Off the lip in a second at the crouched walk, and the step down's own clip carries the body down for about three more.
  const t = runUntil(b, fps, 6, () => hangs(b));
  b.key('KeyW', false);
  b.key('ControlLeft', false);
  const ok = Number.isFinite(t);
  return { b, w, rec: { how: `step down off ${start}`, ok, lip: ok ? lipNow(s, b).name : '', braced: ok ? b.ledge.braced : null, t: ok ? r3(t) : Infinity } };
}

// ---- the scripts, by kind -----------------------------------------------------------------------------------------------
/** A lone lip: a standing jump at it, D and A along it to each end, a hop each way (nothing there), and W to climb up; a running jump at it after. */
async function lipScript(p: CoursePiece, fps: number, trace: Hash): Promise<PieceRun> {
  const s = await standPiece(p);
  const run = newRun(s, fps);
  let g = grab(s, 'stand', 'stand', fps);
  run.grab.push(g.rec);
  if (g.rec.ok && offJumps()) {
    // Climbing II, item 3: a hop to nowhere jumps a little up and off the wall, so each hop is a body of its own (the lip
    // grabbed again from the start for the next), and the climb up a third.
    run.shimmies.push(shimmy(s, g.b, g.w, 'KeyD', fps));
    if (hangs(g.b)) run.shimmies.push(shimmy(s, g.b, g.w, 'KeyA', fps));
    if (hangs(g.b)) run.hops.push(hop(s, g.b, 'KeyD', fps, 'none'));
    run.stages.push(`after D and Space ${hangs(g.b) ? 'still hanging' : g.b.ledge.lastLetGo}`);
    for (const next of ['KeyA', 'climb'] as const) {
      fold(run, s, g.b, g.w, trace);
      g = grab(s, 'stand', 'stand', fps);
      run.grab.push(g.rec);
      if (!g.rec.ok) break;
      if (next === 'KeyA') {
        run.hops.push(hop(s, g.b, 'KeyA', fps, 'none'));
        run.stages.push(`after A and Space ${hangs(g.b) ? 'still hanging' : g.b.ledge.lastLetGo}`);
      } else run.climb = climbUp(s, g.b, fps);
    }
  } else if (g.rec.ok) {
    run.shimmies.push(shimmy(s, g.b, g.w, 'KeyD', fps));
    if (hangs(g.b)) run.shimmies.push(shimmy(s, g.b, g.w, 'KeyA', fps));
    if (hangs(g.b)) run.hops.push(hop(s, g.b, 'KeyD', fps, 'none'));
    if (hangs(g.b)) run.hops.push(hop(s, g.b, 'KeyA', fps, 'none'));
    if (hangs(g.b)) run.climb = climbUp(s, g.b, fps);
  }
  fold(run, s, g.b, g.w, trace);
  const r = grab(s, 'run', 'run', fps);
  run.grab.push(r.rec);
  fold(run, s, r.b, r.w, trace);
  return run;
}

/** A corner, a bend, a curve, a slope or steps: grab the lip, D along it (round or up the turn) to its end, A all the way back. */
async function alongScript(p: CoursePiece, fps: number, trace: Hash): Promise<PieceRun> {
  const s = await standPiece(p);
  const run = newRun(s, fps);
  const g = grab(s, 'stand', 'stand', fps);
  run.grab.push(g.rec);
  if (g.rec.ok) {
    // Round a corner: first to 2 m short of the chain's end (well past the turn: the turn read there), then on to the end.
    if (p.kind === 'corner') run.shimmies.push(shimmy(s, g.b, g.w, 'KeyD', fps, 20, lipNow(s, g.b).total - 2));
    if (hangs(g.b)) run.shimmies.push(shimmy(s, g.b, g.w, 'KeyD', fps));
    if (hangs(g.b)) run.shimmies.push(shimmy(s, g.b, g.w, 'KeyA', fps));
  }
  fold(run, s, g.b, g.w, trace);
  return run;
}

/** Two lips side by side: from A, D to its end and a hop right; from B, A to its end and a hop left. */
async function sideScript(p: CoursePiece, fps: number, trace: Hash): Promise<PieceRun> {
  const s = await standPiece(p);
  const run = newRun(s, fps);
  for (const [start, key, to] of [['onA', 'KeyD', 'B'], ['onB', 'KeyA', 'A']] as const) {
    const g = grab(s, start, 'stand', fps);
    run.grab.push(g.rec);
    if (g.rec.ok) {
      run.shimmies.push(shimmy(s, g.b, g.w, key, fps));
      if (hangs(g.b)) run.hops.push(hop(s, g.b, key, fps, to));
    }
    fold(run, s, g.b, g.w, trace);
  }
  return run;
}

/**
 * A lip and another stepped back over it: A grabbed where nothing stands over it, D along it under B, Space with W to hop
 * up to B; then from B (the hop's hang, else the step down off B's top) a drop (crouch) with W held to catch A on the way
 * down (today's only way down a wall's lips).
 */
async function upDownScript(p: CoursePiece, fps: number, trace: Hash): Promise<PieceRun> {
  const s = await standPiece(p);
  const run = newRun(s, fps);
  const g = grab(s, 'onA', 'stand', fps);
  run.grab.push(g.rec);
  let atB: { b: TestBody; w: Watch } | null = null;
  if (g.rec.ok) {
    // Along A to under B's middle (its along: A's chain begins 4 m to the left of the piece's middle).
    run.shimmies.push(shimmy(s, g.b, g.w, 'KeyD', fps, 20, 4));
    if (hangs(g.b)) {
      const h = hop(s, g.b, 'KeyW', fps, 'B');
      run.hops.push(h);
      if (h.reached) atB = g;
    }
  }
  if (!atB) {
    fold(run, s, g.b, g.w, trace);
    const d = stepDown(s, 'topB', fps);
    run.grab.push(d.rec);
    if (d.rec.ok && d.rec.lip === 'B') atB = d;
    else fold(run, s, d.b, d.w, trace);
  }
  if (atB && CLIMB_TUNE.hops === 'band') {
    // Climbing II, item 4: from B, S with Space hops down to A.
    run.hops.push(hop(s, atB.b, 'KeyS', fps, 'A'));
    fold(run, s, atB.b, atB.w, trace);
  } else if (atB) {
    const b = atB.b;
    fill(b);
    const from = lipNow(s, b).name;
    b.key('KeyW', true);
    tap(b, 'ControlLeft', fps);
    let left = false;
    const t = runUntil(b, fps, 3, () => {
      if (!b.ledge.holding) left = true;
      return left && hangs(b);
    });
    b.key('KeyW', false);
    const now = hangs(b) ? lipNow(s, b).name : '';
    run.hops.push({ key: 'drop+W', from, to: now, reached: now === 'A', words: '', t: Number.isFinite(t) ? r3(t) : Infinity });
    fold(run, s, b, atB.w, trace);
  }
  return run;
}

/** Two lips side by side at two heights: from A, D to its end and a hop up and right; from B (the step down off its top), A to its end and a hop down and left. */
async function diagScript(p: CoursePiece, fps: number, trace: Hash): Promise<PieceRun> {
  const s = await standPiece(p);
  const run = newRun(s, fps);
  const g = grab(s, 'onA', 'stand', fps);
  run.grab.push(g.rec);
  if (g.rec.ok) {
    run.shimmies.push(shimmy(s, g.b, g.w, 'KeyD', fps));
    if (hangs(g.b)) run.hops.push(hop(s, g.b, 'KeyD', fps, 'B'));
  }
  fold(run, s, g.b, g.w, trace);
  const d = stepDown(s, 'topB', fps);
  run.grab.push(d.rec);
  if (d.rec.ok) {
    run.shimmies.push(shimmy(s, d.b, d.w, 'KeyA', fps));
    if (hangs(d.b)) run.hops.push(hop(s, d.b, 'KeyA', fps, 'A'));
  }
  fold(run, s, d.b, d.w, trace);
  return run;
}

/** Two walls facing each other: grab A, then S with Space (today's jump off backward), caught by B behind or not. */
async function behindScript(p: CoursePiece, fps: number, trace: Hash): Promise<PieceRun> {
  const s = await standPiece(p);
  const run = newRun(s, fps);
  const g = grab(s, 'onA', 'stand', fps);
  run.grab.push(g.rec);
  if (g.rec.ok) run.hops.push(hop(s, g.b, 'KeyS', fps, 'B'));
  fold(run, s, g.b, g.w, trace);
  // Climbing II, item 7 (maker B): braced on A again, the view turned back over the right shoulder, Space alone hops to B
  // behind (else a small jump off the wall).
  if (CLIMB_TUNE.lookAway === 'reach') {
    const h = grab(s, 'onA', 'stand', fps);
    run.grab.push(h.rec);
    if (h.rec.ok) run.hops.push(lookHop(s, h.b, fps, 'B', -LOOK_BACK_DEG));
    fold(run, s, h.b, h.w, trace);
  }
  return run;
}

/** How far the look-away's script turns the view from the wall, degrees (back over a shoulder, past the threshold). */
export const LOOK_BACK_DEG = 160;

/**
 * Climbing II, item 7: the view turned `deg` from the way the hang faces (positive to the figure's left), held while the
 * look eases in (0.3 s), then Space alone; run until hanging again or 3 s. The camera is put back after. Reached where it
 * hangs from a lip of `to`'s chain.
 */
export function lookHop(s: Stood, b: TestBody, fps: number, to: string, deg: number): Hop {
  fill(b);
  const L = b.ledge;
  const from = L.holding ? lipNow(s, b).name : '';
  const words0 = b.ledgeWords.length;
  const fx = b.forward.x;
  const fz = b.forward.z;
  const v = b.heading + (deg * Math.PI) / 180;
  b.forward.set(Math.sin(v), 0, Math.cos(v));
  b.right.set(-Math.cos(v), 0, Math.sin(v));
  // The smoothness round (`climb.hangKeys` 'cue'): the look-away is W's cue, held through the look and the Space.
  const cue = CLIMB_TUNE.hangKeys === 'cue';
  if (cue) b.key('KeyW', true);
  b.run(fps, 0.3);
  tap(b, 'Space', fps);
  if (cue) b.key('KeyW', false);
  let left = false;
  const t = runUntil(b, fps, 3, () => {
    if (L.phase !== LEDGE_HANG) left = true;
    return left && hangs(b);
  });
  b.forward.set(fx, 0, fz);
  b.right.set(-fz, 0, fx);
  const now = hangs(b) ? lipNow(s, b) : null;
  const words = b.ledgeWords.slice(words0).join(' ');
  return { key: 'look+Space', from, to: now ? now.name : '', reached: !!now && now.chain === to.replace(/\d+$/, '') && now.name !== from, words, t: Number.isFinite(t) ? r3(t) : Infinity };
}

/** A wall: W held into it until the top is reached and climbed out onto, or the time runs out. */
async function wallScript(p: CoursePiece, fps: number, trace: Hash): Promise<PieceRun> {
  const s = await standPiece(p);
  const run = newRun(s, fps);
  const { b, w } = bodyAt(s, 'stand', fps);
  const H = p.numbers.height as number;
  fill(b);
  b.key('KeyW', true);
  // Climbing II: on the use key the climb starts as the face comes into reach (W walks the body there and climbs).
  if (useGrab()) b.key('KeyE', true);
  w.holdOn = true;
  const t0 = runUntil(b, fps, 2, () => b.wall.holding);
  run.stages.push(Number.isFinite(t0) ? `on the wall ${r3(t0)} s` : 'never on the wall');
  if (Number.isFinite(t0)) {
    const tHang = runUntil(b, fps, H / 0.8 + 4, () => hangs(b));
    run.stages.push(Number.isFinite(tHang) ? `hung at the lip ${r3(t0 + tHang)} s` : `no hang (y ${r3(here(s, b).y)}${b.wall.stallWhy ? `, ${b.wall.stallWhy}` : ''})`);
    w.holdOn = false;
    const tTop = runUntil(b, fps, 4, () => !b.ledge.holding && !b.wall.holding && b.grounded);
    const c = here(s, b);
    run.stages.push(Number.isFinite(tTop) && Math.abs(c.y - H) < 0.1 ? `on top ${r3(t0 + (Number.isFinite(tHang) ? tHang : 0) + tTop)} s (z ${r3(c.z)})` : b.ledge.holding ? 'still hanging at the lip' : `not on top (y ${r3(c.y)})`);
  }
  w.holdOn = false;
  b.key('KeyW', false);
  if (useGrab()) b.key('KeyE', false);
  fold(run, s, b, w, trace);
  return run;
}

/** Run along the take-off, jump at its edge toward the bars or the rope, and see what is caught or where the body falls. */
async function pitScript(p: CoursePiece, fps: number, trace: Hash): Promise<PieceRun> {
  const s = await standPiece(p);
  const run = newRun(s, fps);
  const { b, w } = bodyAt(s, 'run', fps);
  fill(b);
  b.key('KeyW', true);
  runUntil(b, fps, 3, () => here(s, b).z >= 4.5);
  tap(b, 'Space', fps);
  // Climbing II: on the use key, held from the frame after the jump.
  if (useGrab()) b.key('KeyE', true);
  runUntil(b, fps, 3, () => hangs(b));
  b.key('KeyW', false);
  if (useGrab()) b.key('KeyE', false);
  const c = here(s, b);
  const lip = worldToCourse(s.frame, s.piece, b.ledge.lip.ex, b.ledge.lip.ey, b.ledge.lip.ez, { x: 0, y: 0, z: 0 });
  run.stages.push(hangs(b) ? `hung from a lip at y ${r3(lip.y)}, z ${r3(lip.z)} (${b.ledge.braced ? 'braced' : 'free'})` : 'caught nothing');
  if (!hangs(b)) run.stages.push(b.wall.holding ? `on the wall climb at y ${r3(c.y)}, z ${r3(c.z)}` : c.y < 1 ? `fell into the pit (y ${r3(c.y)})` : `ended at y ${r3(c.y)}, z ${r3(c.z)}`);
  fold(run, s, b, w, trace);
  return run;
}

/** A pole: W held into it for 4 s (the wall climb, a grab, or nothing). */
async function poleScript(p: CoursePiece, fps: number, trace: Hash): Promise<PieceRun> {
  const s = await standPiece(p);
  const run = newRun(s, fps);
  const { b, w } = bodyAt(s, 'stand', fps);
  fill(b);
  b.key('KeyW', true);
  if (useGrab()) b.key('KeyE', true);
  let climbed = '';
  runUntil(b, fps, 4, () => {
    if (b.wall.holding) climbed = 'the wall climb took it';
    else if (b.ledge.holding) climbed = 'the ledges took it';
    return false;
  });
  b.key('KeyW', false);
  if (useGrab()) b.key('KeyE', false);
  const c = here(s, b);
  run.stages.push(climbed || `nothing took it (stopped at z ${r3(c.z)})`);
  fold(run, s, b, w, trace);
  return run;
}

/** An obstacle after a 15 m run-up: run straight into it, then (a new body) run and jump 1.2 m before it. */
async function obstacleScript(p: CoursePiece, fps: number, trace: Hash): Promise<PieceRun> {
  const s = await standPiece(p);
  const run = newRun(s, fps);
  const H = p.numbers.height as number;
  const z0 = p.starts[0].at[2] + (p.numbers.runUp as number);
  const zEnd = z0 + (p.numbers.depth as number);
  for (const jumpAt of [false, true]) {
    const { b, w } = bodyAt(s, 'run', fps);
    fill(b);
    b.key('KeyW', true);
    let top = 0;
    let onTop = false;
    if (jumpAt) {
      runUntil(b, fps, 4, () => here(s, b).z >= z0 - 1.2);
      tap(b, 'Space', fps);
    }
    runUntil(b, fps, jumpAt ? 3 : 5, () => {
      const c = here(s, b);
      top = Math.max(top, c.y);
      if (b.grounded && Math.abs(c.y - H) < 0.06) onTop = true;
      return false;
    });
    b.key('KeyW', false);
    const c = here(s, b);
    run.stages.push(`${jumpAt ? 'jumped' : 'ran'}: ${c.z > zEnd ? 'over' : onTop ? 'onto it' : `stopped at z ${r3(c.z)}`}, highest ${r3(top)}${b.ledge.grabs ? `, grabbed ${b.ledge.grabs}` : ''}${b.wall.climbs ? `, climbed ${b.wall.climbs}` : ''}`);
    fold(run, s, b, w, trace);
  }
  return run;
}

/** The free run: grab A, D to its end, hop right onto B, D round B's corner to its end, climb up, W into C (the wall climb, top out), on off C's far side onto D. */
async function freeRunScript(p: CoursePiece, fps: number, trace: Hash): Promise<PieceRun> {
  const s = await standPiece(p);
  const run = newRun(s, fps);
  const g = grab(s, 'stand', 'stand', fps);
  run.grab.push(g.rec);
  const b = g.b;
  const st = run.stages;
  const done = (): PieceRun => {
    fold(run, s, b, g.w, trace);
    return run;
  };
  if (!g.rec.ok) {
    st.push('never grabbed A');
    return done();
  }
  st.push('grabbed A');
  run.shimmies.push(shimmy(s, b, g.w, 'KeyD', fps));
  const h = hop(s, b, 'KeyD', fps, 'B0');
  run.hops.push(h);
  if (!h.reached) {
    st.push(`no hop to B (${h.words || h.to || 'nothing'})`);
    return done();
  }
  st.push('hopped to B');
  const round = shimmy(s, b, g.w, 'KeyD', fps);
  run.shimmies.push(round);
  st.push(round.on === 'B1' ? 'round B\'s corner' : `not round the corner (on ${round.on || 'nothing'})`);
  run.climb = climbUp(s, b, fps);
  if (!run.climb.startsWith('stood')) {
    st.push(`no climb up (${run.climb})`);
    return done();
  }
  st.push('on B\'s top');
  // Face C (ahead) and walk into it: the wall climb up it, W still held over its lip, on along its top and off its far side.
  face(s, b, 0, 1);
  fill(b);
  b.key('KeyW', true);
  // Climbing II: on the use key the climb starts as C comes into reach.
  if (useGrab()) b.key('KeyE', true);
  const t0 = runUntil(b, fps, 4, () => b.wall.holding);
  if (useGrab()) b.key('KeyE', false);
  if (!Number.isFinite(t0)) {
    b.key('KeyW', false);
    st.push(`never on C (at x ${r3(here(s, b).x)}, z ${r3(here(s, b).z)})`);
    return done();
  }
  st.push('climbing C');
  const tTop = runUntil(b, fps, 14, () => !b.wall.holding && !b.ledge.holding && b.grounded && here(s, b).y > 8);
  if (!Number.isFinite(tTop)) {
    b.key('KeyW', false);
    st.push(`not over C (y ${r3(here(s, b).y)})`);
    return done();
  }
  st.push('on C\'s top');
  // Off C's far side: landed where the feet are first down again under C's top.
  const harm0 = b.fallDamage;
  let fell = false;
  const tOff = runUntil(b, fps, 6, () => {
    if (!b.grounded) fell = true;
    return fell && b.grounded && here(s, b).y < 8;
  });
  b.key('KeyW', false);
  const c = here(s, b);
  st.push(Number.isFinite(tOff) && Math.abs(c.y - 4) < 0.1 ? `dropped onto D (harm ${r3(b.fallDamage - harm0)})` : `not on D (landed y ${r3(c.y)}, z ${r3(c.z)})`);
  return done();
}

/**
 * The feedback round, item 2: a climb up that only nearly fits. A standing jump at the lip (E held, as every grab), then W:
 * the climb up taken whole, short or refused, run to its end (6 s at the most: the free climb's clip is 3.9 s), and half a
 * second more on the top. Recorded: what the climb came to (stood on the top at a depth in from the lip, or the words that
 * refused it), what the room tests found (`LedgeHang.room`), how long the climb's one-off took (a cut clip ends sooner), and
 * whether the body is still kept crouched there.
 */
async function roomScript(p: CoursePiece, fps: number, trace: Hash): Promise<PieceRun> {
  const s = await standPiece(p);
  const run = newRun(s, fps);
  const g = grab(s, 'stand', 'stand', fps);
  run.grab.push(g.rec);
  if (g.rec.ok) {
    const b = g.b;
    fill(b);
    const words0 = b.ledgeWords.length;
    tap(b, 'KeyW', fps);
    const took = runUntil(b, fps, 6, () => !b.ledge.holding);
    b.run(fps, 0.5);
    const c = here(s, b);
    const R = b.ledge.room;
    // How far in from the lip (the piece's own z) the feet stand.
    const lipZ = p.lips[0].a[2];
    run.climb = !b.ledge.holding && b.grounded ? `stood ${r3(c.z - lipZ)} m in at y ${r3(c.y)}` : b.ledgeWords.slice(words0).join(' ') || (b.ledge.holding ? 'still hanging' : `fell to y ${r3(c.y)}`);
    run.stages.push(`room ${R.rule}: ${R.result || '-'}${R.test ? ` (${R.test}${R.leg ? ` ${R.leg}` : ''}${R.depth === R.depth ? ` ${r3(R.depth)} m in` : ''}${R.met ? `, met ${R.met}` : ''}${R.past === R.past ? ` ${r3(R.past)} m` : ''})` : ''}${R.cut ? ', cut' : ''}`);
    if (Number.isFinite(took)) run.stages.push(`the climb took ${r3(took)} s`);
    if (!b.ledge.holding) run.stages.push(b.ledge.keepCrouched ? 'kept crouched' : 'standing');
  }
  fold(run, s, g.b, g.w, trace);
  return run;
}

/** One piece at one rate, by its kind. */
export async function runPiece(p: CoursePiece, fps: number, trace: Hash): Promise<PieceRun> {
  switch (p.kind) {
    case 'lip':
      return lipScript(p, fps, trace);
    case 'corner':
    case 'slope':
    case 'steps':
      return alongScript(p, fps, trace);
    case 'gap':
      if (p.numbers.dir === 'side') return sideScript(p, fps, trace);
      if (p.numbers.dir === 'updown') return upDownScript(p, fps, trace);
      if (p.numbers.dir === 'diag') return diagScript(p, fps, trace);
      return behindScript(p, fps, trace);
    case 'wall':
      return wallScript(p, fps, trace);
    case 'bar':
    case 'rope':
      return pitScript(p, fps, trace);
    case 'pole':
      return poleScript(p, fps, trace);
    case 'obstacle':
      return obstacleScript(p, fps, trace);
    case 'run':
      return freeRunScript(p, fps, trace);
    case 'room':
      return roomScript(p, fps, trace);
  }
}

export const RATES = [30, 60, 144, 240] as const;

/** A run as one line: its grabs, shimmies, hops, climb and stages, the hands' worst distance off the lip, let-goes, stalls and where it ended. */
export function summarize(r: PieceRun): string {
  const g = r.grab.map((q) => `${q.how}: ${q.ok ? `${q.lip} ${q.braced ? 'braced' : 'free'} ${q.t} s` : 'no'}`).join('; ');
  const sh = r.shimmies.map((s) => `${s.key} ${s.moved} m (${s.why}, lead ${s.stop} m from the end${s.on ? `, on ${s.on}` : ''}${s.turned ? `, turned ${s.turned}` : ''}${s.rose ? `, rose ${s.rose}` : ''})`).join('; ');
  const hp = r.hops.map((h) => `${h.key} ${h.from}->${h.to || '-'}${h.reached ? ' reached' : ''}${h.words ? ` "${h.words}"` : ''}`).join('; ');
  const tail = `hands off ${r.handOff}, falls ${r.falls}${r.fell.length ? ` (${r.fell.join(', ')})` : ''}, wall stall ${r.wallStall}, end ${r.end.join(' ')}`;
  return [`${r.id} @${r.fps}`, g, sh, hp, r.climb, r.stages.join('; '), tail].filter((s) => s).join(' | ');
}

/** The whole course (or `ids`) at every rate: each run, and one digest of every frame of them all. */
export async function runCourse(ids?: readonly string[], rates: readonly number[] = RATES): Promise<{ runs: PieceRun[]; digest: string }> {
  const course = climbCourse(ids ? { pieces: ids } : {});
  const all = createHash('sha256');
  const runs: PieceRun[] = [];
  for (const p of course.pieces) {
    for (const fps of rates) {
      const h = createHash('sha256');
      const run = await runPiece(p, fps, h);
      run.trace = h.digest('hex').slice(0, 16);
      all.update(`${p.id}@${fps}:${run.trace};`);
      runs.push(run);
    }
  }
  return { runs, digest: all.digest('hex') };
}
