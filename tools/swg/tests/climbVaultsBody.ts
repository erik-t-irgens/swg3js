// Climbing II, phase 6: the vaults' scenes on the test course's harness (tools/swg/tests/climbCourseBody.ts: each piece stood alone,
// a body driven at it by the player's own movement and climbing on the real Rapier, at any frame rate). A walk, a run and a sprint
// at every obstacle, clamber and three braced lips, each for five seconds with W held from the piece's run start; the sprint as the
// speed classes would give it (this harness has none: its pace is the run's and Shift walks), its speed the sprint's share of Jedi
// Academy's run on `speedScale` and its pace handed to the vault (`TestBody.sprinting`). Every frame of each goes into a hash (the
// course's own `Watch`), and each run's numbers into a record: where the vault began and ended, its clock and the body's place
// along the travel and its height at each of its frames, where the body was at the end. Not a test itself:
// `climbVaultsAfter.test.ts` holds the hashes, `climbVaults.test.ts` the records.
import { createHash } from 'node:crypto';
import { standPiece, bodyAt, runUntil, RATES, type Stood } from './climbCourseBody.ts';
import { climbCourse, type CoursePiece } from '../../../src/anim/climbCourse.ts';
import { worldToCourse } from '../../../src/anim/climbCourseBuild.ts';
import { LOCO_TUNE } from '../../../src/anim/locoTune.ts';
import { JKA, UNIT } from '../../../src/player/jkaMove.ts';

/** The pieces: every obstacle and clamber, and three braced lips (a deep 1.2 m top, and two faces too high for anything). */
export const VAULT_PIECES = (id: string): boolean => id.startsWith('obstacle-') || id.startsWith('clamber-') || id === 'lip-braced-1.2' || id === 'lip-braced-1.8' || id === 'lip-braced-2.4';
/** The paces run at each: the walk (Shift held, this harness's walk), the run (W alone), the sprint (its speed and pace stood in). */
export const PACES = ['walk', 'run', 'sprint'] as const;
export type Pace = (typeof PACES)[number];
/** The sprint's share of Jedi Academy's run (the speed classes' sprint speed over it, as the player's classes put it on the movement). */
export const SPRINT_SHARE = LOCO_TUNE.speed.forward.sprint / (JKA.speed * UNIT);
/** How long each run is held, seconds. */
export const RUN_SECONDS = 5;

/** One frame of a vault: its clock, and the body's place along the travel from the face, its height, and across. */
export interface VaultFrame {
  t: number;
  along: number;
  y: number;
  across: number;
}
/** One run's record. */
export interface VaultRun {
  key: string;
  id: string;
  fps: number;
  pace: Pace;
  trace: string;
  verdict: string;
  clip: string;
  kind: string;
  t0: number;
  rate: number;
  speed: number;
  top: number;
  depth: number;
  stretch: number;
  shift: number;
  counts: { vaults: number; dives: number; clambers: number; cuts: number };
  /** The vault's frames (its clock and the body on the path), and where it put the body down (from the face along the travel, and the height). */
  frames: VaultFrame[];
  endAlong: number;
  endY: number;
  /** Seconds from the start of the run to the vault's first frame and to its end (NaN for none). */
  began: number;
  ended: number;
  /** The body's speed across the ground on the frame the vault ended and half a second after, and whether it stood on something then. */
  speedAtEnd: number;
  speedAfter: number;
  groundedAfter: boolean;
  /** Where the body ended (the piece's frame), and the highest its feet stood. */
  end: [number, number, number];
  highest: number;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** One body at one piece at one rate and pace: its frames hashed into its own trace, its record. */
export function vaultRun(s: Stood, fps: number, pace: Pace): VaultRun {
  const p = s.piece;
  const { b, w } = bodyAt(s, 'run', fps);
  if (pace === 'sprint') {
    b.speedScale = SPRINT_SHARE;
    b.sprinting = true;
  }
  if (pace === 'walk') b.key('ShiftLeft', true);
  b.key('KeyW', true);
  // The obstacle's face along the piece's way (+z in its frame): its front lip's own place.
  const faceZ = p.lips[0].a[2];
  const c = { x: 0, y: 0, z: 0 };
  const V = b.vault;
  const frames: VaultFrame[] = [];
  let t = 0;
  let began = Number.NaN;
  let ended = Number.NaN;
  let highest = Number.NEGATIVE_INFINITY;
  let speedAtEnd = Number.NaN;
  let speedAfter = Number.NaN;
  let groundedAfter = false;
  let endAlong = Number.NaN;
  let endY = Number.NaN;
  runUntil(b, fps, RUN_SECONDS, () => {
    t += 1 / fps;
    worldToCourse(s.frame, p, b.pos.x, b.pos.y, b.pos.z, c);
    highest = Math.max(highest, c.y);
    if (V.holding) {
      if (!(began === began)) began = t;
      frames.push({ t: V.t, along: c.z - faceZ, y: c.y, across: c.x });
    } else if (began === began && !(ended === ended)) {
      ended = t;
      speedAtEnd = Math.hypot(b.vel.x, b.vel.z);
      worldToCourse(s.frame, p, V.endX, V.endY, V.endZ, c);
      endAlong = c.z - faceZ;
      endY = c.y;
    }
    if (ended === ended && !(speedAfter === speedAfter) && t >= ended + 0.5) {
      speedAfter = Math.hypot(b.vel.x, b.vel.z);
      groundedAfter = b.grounded;
    }
    return false;
  });
  b.key('KeyW', false);
  b.key('ShiftLeft', false);
  worldToCourse(s.frame, p, b.pos.x, b.pos.y, b.pos.z, c);
  const trace = w.hash.digest('hex').slice(0, 16);
  const run: VaultRun = {
    key: `${p.id}@${fps}:${pace}`,
    id: p.id,
    fps,
    pace,
    trace,
    verdict: V.verdict,
    clip: V.vaults + V.dives + V.clambers > 0 ? V.clip : '',
    kind: V.vaults + V.dives + V.clambers > 0 ? V.kind : '',
    t0: V.t0,
    rate: V.rate,
    speed: V.speed,
    top: V.top,
    depth: V.depth,
    stretch: V.stretch,
    shift: V.shift,
    counts: { vaults: V.vaults, dives: V.dives, clambers: V.clambers, cuts: V.cuts },
    frames,
    endAlong,
    endY,
    began,
    ended,
    speedAtEnd,
    speedAfter,
    groundedAfter,
    end: [r6(c.x), r6(c.y), r6(c.z)],
    highest,
  };
  // Out of the world, so the next body meets nothing of this one's.
  s.physics.removeBody(b.body);
  s.physics.stepOnce();
  return run;
}

/** Every piece at every rate and pace: the runs, and one digest of every run's trace in order (and the walks' and runs' alone). */
export async function vaultCourse(rates: readonly number[] = RATES, ids: (id: string) => boolean = VAULT_PIECES): Promise<{ runs: VaultRun[]; digest: string; plain: string }> {
  const all = createHash('sha256');
  const plain = createHash('sha256');
  const runs: VaultRun[] = [];
  for (const p of climbCourse({}).pieces.filter((q: CoursePiece) => ids(q.id))) {
    const s = await standPiece(p);
    for (const fps of rates) {
      for (const pace of PACES) {
        const r = vaultRun(s, fps, pace);
        all.update(`${r.key}=${r.trace};`);
        if (pace !== 'sprint') plain.update(`${r.key}=${r.trace};`);
        runs.push(r);
      }
    }
  }
  return { runs, digest: all.digest('hex'), plain: plain.digest('hex') };
}
