// The rope chain round (the owner's ask of 2026-11-18: "the rope in our climbing pass right now is quite lackluster and is just
// a straight pipe on a pendulum with no physics or bend"): the scenes its digest (`climbRopeChainAfter.test.ts`) and its proofs
// run, through the game's own movement and climbing on real Rapier (the test course's `rope` piece, stood as the game's
// `climbTest` stands it). Each frame is the harness's `frame` (the player's update and the physics' step) and then its
// `drawRopes` (the player's own: the chains stepped on the frame's physics steps and laid for drawing), as the frame loop and
// `__debug.advance` have them. Not a test itself.
//
//  - 'free': the rope let go of swinging 0.3 rad off straight down across the pit and left alone 40 s, the body standing back on
//    the take-off floor (its free swing, and under `climb.ropeLook` 'chain' the chain settling to a vertical line);
//  - 'lying': a rope of its own 10.5 m long (its last 1.5 m on the pit's floor) let go of at 0.25 rad and left alone 30 s (under
//    'chain' the tail lying on the floor, never under it);
//  - 'held': phase 4's own session (`climbRopesAfter.test.ts`): run off the take-off edge, E as the body passes the rope, a still
//    hang, a climb up, A pumping a swing, let alone, D, a climb down, Space letting go on the swing into the pit, and on.
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { courseToWorld } from '../../../src/anim/climbCourseBuild.ts';
import { RATES, SLAB_LIFT, bodyAt, standPiece, tap } from './climbCourseBody.ts';
import type { TestBody, THREE } from './grappleBody.ts';
import type { HangingRope } from '../../../src/player/hangingRope.ts';

export { RATES };

export type ChainScene = 'free' | 'lying' | 'held';

/** What a frame records: the body (`body`) and the rope as it is drawn (`drawn`), each after the frame and its draw. */
export type ChainRec = (b: TestBody, r: HangingRope, frame: number) => void;

export interface ChainRun {
  /** The scene's rope (its chain as the run left it). */
  rope: HangingRope;
  frames: number;
  held: boolean;
  climbed: number;
  most: number;
  letGo: boolean;
}

/**
 * One scene at one rate; every frame handed to `rec` after the frame and the draw (and to `pre`, where given, after the frame and
 * before the draw: what the frame handed the chains, which the draw takes). With `camera` (maker B), each rope's strip is laid
 * for it every frame through its chain's curve, as the player lays it (`drawChained`, by the harness's `drawRopes`), the camera stood
 * 6 m to the rope's side and 4 m under its anchor, looking at it.
 */
export async function chainSession(scene: ChainScene, fps: number, rec: ChainRec, camera: THREE.PerspectiveCamera | null = null, pre: ChainRec | null = null): Promise<ChainRun> {
  const s = await standPiece(climbCourse({ pieces: ['rope'] }).pieces[0]);
  const { b } = bodyAt(s, 'run', fps);
  b.rope.ropes = s.ropes;
  // The chains' ground: the harness's own ground's top (`standPiece`'s, in the terrain group, which the chains' rays leave out as the
  // game's leave the terrain to its cached heights). Nothing of the body reads it.
  (b as unknown as { chainGroundAt: (x: number, z: number) => number }).chainGroundAt = () => -SLAB_LIFT;
  const r = s.ropes[0];
  if (camera) {
    camera.position.set(r.ax + 6, r.ay - 4, r.az);
    camera.lookAt(r.ax, r.ay - 4, r.az);
    camera.updateMatrixWorld(true);
    b.chainCamera = camera;
  }
  let frames = 0;
  const one = () => {
    b.frame(1 / fps);
    // (The fixer: what the frame handed the chains, read before the draw takes it: `climbRopeChainAlike.test.ts`.)
    if (pre) pre(b, r, frames);
    drawn(b);
    rec(b, r, frames);
    frames++;
  };
  const run = (sec: number) => {
    const n = Math.round(sec * fps);
    for (let i = 0; i < n; i++) one();
  };
  const until = (sec: number, done: () => boolean) => {
    const n = Math.round(sec * fps);
    for (let i = 0; i < n && !done(); i++) one();
  };
  const press = (code: string) => {
    b.key(code, true);
    one();
    b.key(code, false);
  };
  void tap;
  if (scene === 'free' || scene === 'lying') {
    // The rope swinging by itself from 0.3 rad off straight down across the pit (as a body let go of it there), left alone; for
    // 'lying', a rope of its own 10.5 m long, its last 1.5 m on the pit's floor, from 0.25 rad.
    const th = scene === 'free' ? 0.3 : 0.25;
    if (scene === 'lying') r.own = 10.5;
    r.th = th;
    r.om = 0;
    r.thDraw = th;
    r.lay();
    // (The chain, where the harness has one, laid on the rope's line there before a step is taken: the same at every rate.)
    const C = (b as unknown as { ropeChains?: { steps: number } }).ropeChains;
    if (C) {
      C.steps = 0;
      drawn(b);
    }
    run(scene === 'free' ? 40 : 30);
    return { rope: r, frames, held: false, climbed: 0, most: 0, letGo: false };
  }
  const rz = r.az;
  b.key('KeyW', true);
  until(3, () => b.pos.z > 4.5);
  press('Space');
  until(2, () => b.pos.z > rz - 0.4 || b.rope.holding);
  b.key('KeyW', false);
  press('KeyE');
  run(1.5);
  const held = b.rope.holding;
  const s0 = b.rope.s;
  b.key('KeyW', true);
  run(2);
  b.key('KeyW', false);
  const climbed = s0 - b.rope.s;
  b.key('KeyA', true);
  let most = 0;
  const n = Math.round(5 * fps);
  for (let i = 0; i < n; i++) {
    one();
    most = Math.max(most, b.rope.amplitude());
  }
  b.key('KeyA', false);
  run(2);
  b.key('KeyD', true);
  run(2);
  b.key('KeyD', false);
  b.key('KeyS', true);
  run(3);
  b.key('KeyS', false);
  // Pumped again, then let go of on the swing.
  b.key('KeyA', true);
  run(3);
  b.key('KeyA', false);
  const wasHeld = b.rope.holding;
  press('Space');
  const letGo = wasHeld && !b.rope.holding;
  run(4);
  return { rope: r, frames, held, climbed, most, letGo };
}

/** The rope piece's solids in the world (each a box's two corners), as `standPiece` stands it: all but the rope's own column, which a rope switches off. */
export function ropeSolids(): { role: string; min: [number, number, number]; max: [number, number, number] }[] {
  const piece = climbCourse({ pieces: ['rope'] }).pieces[0];
  const frame = { ox: piece.at[0], oz: -piece.at[1], h: 0, ref: () => 0 };
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  const out: { role: string; min: [number, number, number]; max: [number, number, number] }[] = [];
  for (const s of piece.solids) {
    if (s.role === 'rope' || s.kind !== 'box' || !s.mid || !s.half) continue;
    courseToWorld(frame, piece, s.mid[0] - s.half[0], s.mid[1] - s.half[1], s.mid[2] - s.half[2], a);
    courseToWorld(frame, piece, s.mid[0] + s.half[0], s.mid[1] + s.half[1], s.mid[2] + s.half[2], b);
    out.push({ role: s.role, min: [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)], max: [Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)] });
  }
  return out;
}

/** The harness's draw after a frame (the player's `drawRopes`, as far as the chains go), where it has one. */
function drawn(b: TestBody): void {
  const d = (b as unknown as { drawRopes?: () => void }).drawRopes;
  if (d) d.call(b);
}

/** The rope as `climb.ropeLook` 'straight' draws it (phase 4's lay: the anchor, the hands while held, the end) into a row. */
export function straightRow(r: HangingRope, out: Float64Array): number {
  let k = 0;
  out[k++] = r.count;
  for (let i = 0; i < 3 * r.count; i++) out[k++] = r.pts[i];
  out[k++] = r.endX;
  out[k++] = r.endY;
  out[k++] = r.endZ;
  return k;
}

/** The rope as `climb.ropeLook` 'chain' lays it for drawing (src/player/ropeChain.ts's `lay`: its points, the hands' places in them) into a row; 0 where no chain is drawn. */
export function chainRow(r: HangingRope, out: Float64Array): number {
  const c = r.chain;
  let k = 0;
  if (!c || !c.live) {
    out[k++] = 0;
    return k;
  }
  out[k++] = c.drawCount;
  out[k++] = c.gripA;
  out[k++] = c.gripB;
  for (let i = 0; i < 3 * c.drawCount; i++) out[k++] = c.draw[i];
  return k;
}

/** The body's numbers of a frame (`climbRopesAfter.test.ts`'s row). */
export function bodyRow(b: TestBody, out: Float64Array): void {
  const R = b.rope;
  out[0] = b.pos.x;
  out[1] = b.pos.y;
  out[2] = b.pos.z;
  out[3] = b.vel.x;
  out[4] = b.vel.y;
  out[5] = b.vel.z;
  out[6] = R.phase;
  out[7] = R.mode;
  out[8] = R.s;
  out[9] = R.e;
  out[10] = R.th;
  out[11] = R.om;
  out[12] = R.thDraw;
  out[13] = R.holding ? 1 : 0;
}
