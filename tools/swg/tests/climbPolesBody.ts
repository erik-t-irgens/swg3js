// Climbing II, phase 5 (poles): the round's own scenes through the game's own movement and climbing on the real Rapier (the
// grapple's harness, tools/swg/tests/grappleBody.ts, and the course's `poles` piece stood by tools/swg/tests/climbCourseBody.ts),
// shared by the round's digest (climbPolesAfter.test.ts) and its suites, so the digest and the suites drive one script.
//
// `poleSession(scene, fps, h, more)` runs one scene on a fixed timeline of keys (the same keys at every setting, so a trace taken
// with the round's switches at their other settings is the base commit's to the bit):
//  - 'climb' (maker A, items 1 and 2): from the piece's start 2 m in front of its left pole, W and E held 1.5 s (walked up to it;
//    under `climb.poles` 'on' grabbed), W held 3.5 s (up), let alone half a second, S held 2 s (down), let alone, A held 2 s and D
//    1 s (round it), let alone, W held 8 s (to its top and held there), S held 10 s (to its bottom and held there), let alone a
//    second. The view is the piece's own ahead the whole time (free: a turn round the pole never turns it).
//  - 'jump' (maker B, items 3 and 4, the brief's proof): from the same start, W and E held 1.5 s (the left pole grabbed), W 2 s up,
//    the view turned to the right pole (2 m off) and let alone a moment, Space tapped (jumped off at it), let alone 2 s (caught on
//    the way), A held 4 s (round it once), S 3 s down, W 3 s up, the crouch tapped (slid down to the ground) and let alone 3 s,
//    then the view ahead again and W a second (walking off).
//  - 'top' (maker B, item 3): the poles' tops' `pole-top-lip`: from between the pole and the platform's face, W and E held (the
//    pole grabbed facing it), the view turned to the platform and W held to its top and on (the ledges' climb onto the platform
//    behind the body, W then a step onto it), let alone.
//  - 'floor' (maker B, item 3): `pole-top-floor`: from under the hole, W and E held, the view turned back and W held to the pole's
//    top and on (up through the hole onto the floor behind the body), let alone.
// Each frame's numbers of the body (its place, velocity and heading, and the ledges' and the wall climb's phases: what the base
// commit has) hashed into `h`; and, where a caller asks (`more`), whatever else it wants of the frame into its own hash.
import type { Hash } from 'node:crypto';
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { courseWayToWorld } from '../../../src/anim/climbCourseBuild.ts';
import type { TestBody } from './grappleBody.ts';
import { bodyAt, standPiece, type Stood } from './climbCourseBody.ts';

/** The round's scenes (maker A's: 'climb'; maker B's: 'jump', 'top', 'floor'). */
export type PoleScene = 'climb' | 'jump' | 'top' | 'floor';

/** Each scene's piece (the course's own: `poles`, or the poles' tops' row, `poleTops`). */
export const POLE_PIECES: Readonly<Record<PoleScene, string>> = { climb: 'poles', jump: 'poles', top: 'pole-top-lip', floor: 'pole-top-floor' };

/** One step of a scene's timeline: the keys held (KeyboardEvent codes) for `seconds`, and the view turned first to a way of the piece (its own frame's x and z). */
interface Leg {
  keys: readonly string[];
  seconds: number;
  view?: readonly [number, number];
}

/** Each scene's timeline of keys (fixed: every setting is driven alike). */
export const POLE_TIMELINES: Readonly<Record<PoleScene, readonly Leg[]>> = {
  climb: [
    { keys: ['KeyW', 'KeyE'], seconds: 1.5 },
    { keys: ['KeyW'], seconds: 3.5 },
    { keys: [], seconds: 0.5 },
    { keys: ['KeyS'], seconds: 2 },
    { keys: [], seconds: 0.5 },
    { keys: ['KeyA'], seconds: 2 },
    { keys: ['KeyD'], seconds: 1 },
    { keys: [], seconds: 0.5 },
    { keys: ['KeyW'], seconds: 8 },
    { keys: ['KeyS'], seconds: 10 },
    { keys: [], seconds: 1 },
  ],
  jump: [
    { keys: ['KeyW', 'KeyE'], seconds: 1.5 },
    { keys: ['KeyW'], seconds: 2 },
    { keys: [], seconds: 0.3, view: [1, 0] },
    { keys: ['Space'], seconds: 0.05 },
    { keys: [], seconds: 2 },
    { keys: ['KeyA'], seconds: 4 },
    { keys: ['KeyS'], seconds: 3 },
    { keys: ['KeyW'], seconds: 3 },
    { keys: ['KeyX'], seconds: 0.05 },
    { keys: [], seconds: 3 },
    { keys: ['KeyW'], seconds: 1, view: [0, 1] },
  ],
  top: [
    { keys: ['KeyW', 'KeyE'], seconds: 1 },
    { keys: ['KeyW'], seconds: 4.4, view: [0, 1] },
    { keys: [], seconds: 1.5 },
  ],
  floor: [
    { keys: ['KeyW', 'KeyE'], seconds: 1 },
    { keys: ['KeyW'], seconds: 3.4, view: [0, -1] },
    { keys: [], seconds: 3 },
  ],
};

/** Every key any timeline holds (let go of between legs). */
const ALL_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'Space', 'KeyX'];

/** What a scene did: its frames, and per leg the body's feet height at its end (the course's frame) and whether a climb held it. */
export interface PoleRun {
  frames: number;
  /** The body's feet over the piece's floor at each leg's end, metres. */
  heights: number[];
  /** Whether the ledges or the wall climb held the body at each leg's end ('ledge', 'wall', or ''). */
  held: string[];
  /** The stood piece and the body, for a caller that reads more of them (taken out of the world once the run is done). */
  s: Stood;
  b: TestBody;
}

const ROW = new Float64Array(9);

/** One scene at `fps` (see the header). The body is taken out of its world at the end; `after` reads it before then. */
export async function poleSession(scene: PoleScene, fps: number, h: Hash, more: ((b: TestBody) => void) | null = null, after: ((r: PoleRun) => void) | null = null): Promise<PoleRun> {
  const s = await standPiece(climbCourse({ pieces: [POLE_PIECES[scene]], poleTops: true }).pieces[0]);
  const { b } = bodyAt(s, 'stand', fps);
  const way = { x: 0, z: 0 };
  const dt = 1 / fps;
  let frames = 0;
  const heights: number[] = [];
  const held: string[] = [];
  const floorY = b.pos.y;
  const rec = () => {
    ROW[0] = b.pos.x;
    ROW[1] = b.pos.y;
    ROW[2] = b.pos.z;
    ROW[3] = b.vel.x;
    ROW[4] = b.vel.y;
    ROW[5] = b.vel.z;
    ROW[6] = b.heading;
    ROW[7] = b.ledge.phase;
    ROW[8] = b.wall.phase;
    h.update(new Uint8Array(ROW.buffer));
    more?.(b);
    frames++;
  };
  for (const leg of POLE_TIMELINES[scene]) {
    // (The camera, the move keys' frame and the view a jump off goes along, turned to the leg's way; the body's heading is its own.)
    if (leg.view) {
      courseWayToWorld(s.frame, leg.view[0], leg.view[1], way);
      b.forward.set(way.x, 0, way.z);
      b.right.set(-way.z, 0, way.x);
    }
    for (const k of ALL_KEYS) b.key(k, leg.keys.includes(k));
    const n = Math.round(leg.seconds * fps);
    for (let i = 0; i < n; i++) {
      b.frame(dt);
      rec();
    }
    heights.push(b.pos.y - floorY);
    held.push(b.ledge.holding ? 'ledge' : b.wall.holding ? 'wall' : '');
  }
  for (const k of ALL_KEYS) b.key(k, false);
  const run: PoleRun = { frames, heights, held, s, b };
  after?.(run);
  b.physics.world.removeRigidBody(b.body);
  return run;
}
