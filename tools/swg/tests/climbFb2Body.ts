// Climbing II, feedback round II: the round's own scenes through the game's own movement and climbing on the real Rapier (the
// grapple's harness, tools/swg/tests/grappleBody.ts, and the course's pieces stood by tools/swg/tests/climbCourseBody.ts), shared
// by the round's digest (climbFb2After.test.ts) and its suites, so the digest and the suites drive one script.
//
// `barSession`: a running jump at `bars-3`'s first bar with E held, the swing let alone (to a still hang), A and D along the bar,
// W pumping it again, let alone a moment, Space on the forward swing (the flight, and the next bar caught or a landing), and the
// body run on. Each frame's numbers of the body and the bar (the ones every commit since phase 3 has) hashed into `h`; and, where
// a caller asks (`more`), whatever else it wants of the frame into its own hash.
import type { Hash } from 'node:crypto';
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { worldToCourse } from '../../../src/anim/climbCourseBuild.ts';
import { BAR_SWING } from '../../../src/player/barSwing.ts';
import type { TestBody } from './grappleBody.ts';
import { LEDGE_HANG } from '../../../src/player/ledge.ts';
import { bodyAt, nearestLip, runUntil, standPiece, tap, LOOK_BACK_DEG, type Stood } from './climbCourseBody.ts';

const DEG = 180 / Math.PI;

/** What a bar session did (the shipped run's words). */
export interface BarRun {
  frames: number;
  grabbed: boolean;
  /** Seconds after the grab the swing's amplitude first fell under 3 degrees (Infinity for never). */
  settled: number;
  /** The amplitude at the let-alone and the largest the pump reached, degrees. */
  amp0: number;
  pumped: number;
  /** How far A and D moved the hands along the bar, metres. */
  shiftA: number;
  shiftD: number;
  letGo: boolean;
  catches: number;
  landings: number;
}

/** A running jump at a piece's first bar with E held (the course's run start), as phase 3's suites take it. */
export function runJumpAtBar(s: Stood, b: TestBody, fps: number): void {
  const dt = 1 / fps;
  b.key('KeyW', true);
  b.key('KeyE', true);
  let jumped = false;
  for (let i = 0; i < 4 * fps; i++) {
    const c = worldToCourse(s.frame, s.piece, b.pos.x, b.pos.y, b.pos.z, { x: 0, y: 0, z: 0 });
    if (!jumped && c.z >= 4.2) {
      b.key('Space', true);
      jumped = true;
    } else b.key('Space', false);
    b.frame(dt);
    if (b.bar.holding || b.ledge.holding) break;
  }
  b.key('KeyW', false);
  b.key('KeyE', false);
  b.key('Space', false);
}

const ROW = new Float64Array(12);

/** One bar session at `fps` (see the header). */
export async function barSession(fps: number, h: Hash, more: ((b: TestBody) => void) | null = null): Promise<BarRun> {
  const s = await standPiece(climbCourse({ pieces: ['bars-3'] }).pieces[0]);
  const { b } = bodyAt(s, 'run', fps);
  const dt = 1 / fps;
  let frames = 0;
  const B = b.bar;
  const amp = () => (B.report() as { amplitude: number }).amplitude;
  const rec = () => {
    ROW[0] = b.pos.x;
    ROW[1] = b.pos.y;
    ROW[2] = b.pos.z;
    ROW[3] = b.vel.x;
    ROW[4] = b.vel.y;
    ROW[5] = b.vel.z;
    ROW[6] = B.phase;
    ROW[7] = B.th;
    ROW[8] = B.om;
    ROW[9] = B.thDraw;
    ROW[10] = B.s;
    ROW[11] = B.holding ? 1 : 0;
    h.update(new Uint8Array(ROW.buffer));
    more?.(b);
    frames++;
  };
  const step = () => {
    b.frame(dt);
    rec();
  };
  const run = (sec: number) => {
    const n = Math.round(sec * fps);
    for (let i = 0; i < n; i++) step();
  };
  runJumpAtBar(s, b, fps);
  rec();
  const grabbed = B.holding;
  // Let alone: the swing dies away (the time the amplitude first falls under 3 degrees).
  const amp0 = amp();
  let settled = Infinity;
  const n0 = Math.round(8 * fps);
  for (let i = 0; i < n0; i++) {
    step();
    if (settled === Infinity && B.holding && amp() < 3) settled = (i + 1) / fps;
  }
  // A, then D, along the bar.
  let s0 = B.s;
  b.key('KeyA', true);
  run(1.5);
  b.key('KeyA', false);
  const shiftA = B.s - s0;
  s0 = B.s;
  b.key('KeyD', true);
  run(1.5);
  b.key('KeyD', false);
  const shiftD = B.s - s0;
  // W pumps it again, let alone a moment, then Space on the forward swing.
  b.key('KeyW', true);
  let pumped = 0;
  const n1 = Math.round(4 * fps);
  for (let i = 0; i < n1; i++) {
    step();
    pumped = Math.max(pumped, amp());
  }
  b.key('KeyW', false);
  run(0.25);
  let letGo = false;
  const n2 = Math.round(3 * fps);
  for (let i = 0; i < n2 && !letGo; i++) {
    const th = B.th * DEG;
    const want = B.phase === BAR_SWING && B.om > 0 && th > 25 && th < 50;
    b.key('Space', want);
    step();
    if (want) letGo = true;
  }
  b.key('Space', false);
  run(4);
  return { frames, grabbed, settled, amp0, pumped, shiftA, shiftD, letGo, catches: B.catches, landings: B.landings };
}

// ---- maker B's scenes: the free hang's cue and hop up, the ladders, the free hang's jump behind ---------------------------------

/** Maker B's ledge scenes (see `ledgeSession`). */
export type LedgeScene = 'freeCue' | 'freeLadder' | 'bracedLadder' | 'freeBehind';
/** Each scene's course piece. */
export const LEDGE_SCENE_PIECE: Readonly<Record<LedgeScene, string>> = {
  freeCue: 'free-ladder-1.25',
  freeLadder: 'free-ladder-1',
  bracedLadder: 'ladder-1',
  freeBehind: 'free-gap-behind-2.0',
};

/** What a ledge scene did (the words of its run). */
export interface LedgeRun {
  frames: number;
  grabbed: boolean;
  /** The lips it hung from, in turn (the course's names). */
  seen: string[];
  /** Whether the cue showed wholly (the up or the behind cue), and where the body ended. */
  cued: boolean;
  last: string;
}

const LROW = new Float64Array(16);

/**
 * One ledge scene at `fps` (maker B's part of the round's digest): the body grabs the piece's first lip (E held, Space), then
 *  - `freeCue`: W held a second (the free hang's up cue), let go a moment (the cue back down), held again and Space (the free hop
 *    up R0 to R1), run on;
 *  - `freeLadder` and `bracedLadder`: W held up four rungs (at most six seconds), let go, a still moment, S held two and a half
 *    seconds down, let go, a still moment;
 *  - `freeBehind`: the view turned back over the left shoulder (`LOOK_BACK_DEG`), W held 0.3 s, Space, W let go, run on.
 * Each frame's numbers of the body and the hang (its place and velocity, the hang's phase, heading, figure offset, cue, way, look)
 * hashed into `h`; where a caller asks (`more`), whatever else it wants of the frame into its own hash.
 */
export async function ledgeSession(scene: LedgeScene, fps: number, h: Hash, more: ((b: TestBody) => void) | null = null): Promise<LedgeRun> {
  const s = await standPiece(climbCourse({ extras: true, pieces: [LEDGE_SCENE_PIECE[scene]] }).pieces[0]);
  const start = scene === 'freeBehind' ? 'onA' : 'stand';
  const { b } = bodyAt(s, start, fps);
  const L = b.ledge;
  let frames = 0;
  const seen: string[] = [];
  const nameOf = () => (L.holding ? nearestLip(s, L.lip.ex, L.lip.ey, L.lip.ez).name : '-');
  const rec = () => {
    LROW[0] = b.pos.x;
    LROW[1] = b.pos.y;
    LROW[2] = b.pos.z;
    LROW[3] = b.vel.x;
    LROW[4] = b.vel.y;
    LROW[5] = b.vel.z;
    LROW[6] = L.phase;
    LROW[7] = L.heading;
    LROW[8] = L.offX;
    LROW[9] = L.offY;
    LROW[10] = L.offZ;
    LROW[11] = L.cue;
    LROW[12] = L.way * 16 + L.wayKind;
    LROW[13] = L.look;
    LROW[14] = L.lookSide;
    LROW[15] = L.holding ? 1 : 0;
    h.update(new Uint8Array(LROW.buffer));
    more?.(b);
    frames++;
    if (L.phase === LEDGE_HANG) {
      const n = nameOf();
      if (seen[seen.length - 1] !== n) seen.push(n);
    }
  };
  const hold = b.frame.bind(b);
  b.frame = (t: number) => {
    hold(t);
    rec();
  };
  const face = (deg: number) => {
    const v = L.heading + (deg * Math.PI) / 180;
    b.forward.set(Math.sin(v), 0, Math.cos(v));
    b.right.set(-Math.cos(v), 0, Math.sin(v));
  };
  b.key('KeyE', true);
  tap(b, 'Space', fps);
  runUntil(b, fps, 2.5, () => L.phase === LEDGE_HANG);
  b.key('KeyE', false);
  const grabbed = L.phase === LEDGE_HANG;
  runUntil(b, fps, 0.6, () => false);
  face(0);
  let cued = false;
  if (scene === 'freeCue') {
    b.key('KeyW', true);
    runUntil(b, fps, 1, () => false);
    cued = L.cue >= 0.99;
    b.key('KeyW', false);
    runUntil(b, fps, 0.6, () => false);
    b.key('KeyW', true);
    runUntil(b, fps, 1, () => false);
    tap(b, 'Space', fps);
    b.key('KeyW', false);
    runUntil(b, fps, 3, () => false);
  } else if (scene === 'freeLadder' || scene === 'bracedLadder') {
    b.key('KeyW', true);
    runUntil(b, fps, 6, () => seen.length > 4);
    b.key('KeyW', false);
    runUntil(b, fps, 1.5, () => false);
    face(0);
    b.key('KeyS', true);
    runUntil(b, fps, 2.5, () => false);
    b.key('KeyS', false);
    runUntil(b, fps, 1.5, () => false);
  } else {
    face(LOOK_BACK_DEG);
    b.key('KeyW', true);
    runUntil(b, fps, 0.3, () => false);
    cued = L.cue >= 0.99 || L.look >= 0.99;
    tap(b, 'Space', fps);
    b.key('KeyW', false);
    runUntil(b, fps, 3, () => false);
  }
  b.frame = hold;
  const last = nameOf();
  b.physics.world.removeRigidBody(b.body);
  return { frames, grabbed, seen, cued, last };
}
