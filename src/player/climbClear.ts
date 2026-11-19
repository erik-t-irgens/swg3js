// Climbing II, Smoothness II, item 3 (`climb.bodyClear` 'spheres'): a climbing figure's spheres (src/player/bodySpheres.ts)
// against what stands still, at the two places of a climb's frame the player's `placeHangLimbs` and `placeWallLimbs` (and the
// harness's figure, tools/swg/tests/climbFigure.ts) call it, so both run this very code:
//  - before the limbs' solves (`clearClimb`): the figure's root pushed out of what its trunk and legs are in (the feet's too
//    while they are not planted on the face), eased back in as the need goes; and a hand not placed on its lip (reaching for
//    its next hold, or swung across a corner by its clip) handed to its own solve moved out of what it is in, so the arm takes
//    it out rather than the whole figure;
//  - after them (`settleClimb`): what the feet's and the hands' solves took back into something (a leg across a corner's other
//    face) pushed out at once, and the measure the tests hold left in `after`.
// A hand placed on the lip and the feet planted on the face are allowed their contact. Nothing here makes an object.
import * as THREE from 'three';
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { STILL_FLAGS } from './stairSense.ts';
import { climbMask, climbMeasureMask, SPH_L_HAND, SPH_R_HAND, type BodySpheres, type SphereRig, type SphereWorld } from './bodySpheres.ts';
import type { LimbPlace, LimbRig } from './limbPlace.ts';

const grip = new THREE.Vector3();
const dir = new THREE.Vector3();
const BEFORE = new Float64Array(2);
const AFTER = new Float64Array(2);
/** How much further past its reach a placed hand may be left by the push, metres (mechanics: half a centimetre, the solve's own slack). */
const REACH_SLACK = 0.005;

/** How far past its arm's reach each placed hand's place on the lip or face stands now, into `out` (nought for a hand not placed). */
function pastOf(lp: LimbPlace, rig: LimbRig, k: number, out: Float64Array): void {
  void k;
  for (let side = 0; side < 2; side++) {
    out[side] = 0;
    if (!(lp.handW[side] > 0.01)) continue;
    lp.reachAt[0] = lp.hand[side * 3];
    lp.reachAt[1] = lp.hand[side * 3 + 1];
    lp.reachAt[2] = lp.hand[side * 3 + 2];
    lp.reachPastIn(rig, side, null, dir);
    out[side] = lp.past;
  }
}

/** The hands' weights in the solve as the climb placed them, before `clearClimb` moved a reaching one out (the measure's). */
export const PLACED = new Float64Array(2);

/** The climb's own hands' weights noted (`clearClimb` does; a measure under 'before' notes them itself). */
export function notePlaced(lp: LimbPlace): void {
  PLACED[0] = lp.handW[0];
  PLACED[1] = lp.handW[1];
}

/**
 * Before the solves: the push (eased), and a reaching hand moved out. `world` the engine's, `filter` the move's groups, `dt` the
 * frame's, (`rx`, `ry`, `rz`) where the body stands in the open (its capsule's middle), (`nx`, `nz`) the held lip's or face's
 * outward normal across (the push goes along it, square to it).
 */
export function clearClimb(S: BodySpheres, lp: LimbPlace, rig: LimbRig & SphereRig, world: SphereWorld, filter: number, dt: number, rx: number, ry: number, rz: number, nx: number, nz: number): void {
  notePlaced(lp);
  // (The held lip's or face's way across is kept for a later way of pushing; any way, for now.)
  void nx;
  void nz;
  S.axX = 0;
  S.axZ = 0;
  S.refX = rx;
  S.refY = ry;
  S.refZ = rz;
  rig.root.updateMatrixWorld(true);
  S.sample();
  // How far past its reach each placed hand's place on the lip stands before the push (the hang's anchor leaves a little).
  pastOf(lp, rig, 0, BEFORE);
  S.clearOut(world, climbMask(lp.wallW), STILL_FLAGS, filter, dt, CLIMB_TUNE.clearEase, CLIMB_TUNE.clearMost, false);
  // Never so far that a placed hand could no longer reach its place: the push halved until both reach as they did (four times
  // at most, then none), so the push slides the figure along and out only as far as its arms allow.
  for (let i = 0; i < 5; i++) {
    pastOf(lp, rig, 0, AFTER);
    if (!(AFTER[0] > BEFORE[0] + REACH_SLACK) && !(AFTER[1] > BEFORE[1] + REACH_SLACK)) break;
    S.scalePush(i < 4 ? 0.5 : 0);
  }
  // Smoothness III, item 0: a climb up crossfading into the crouch it ends in hands its figure onto its feet, which are never
  // pushed out of the floor they stand on (the feet's spheres reach a tenth of a metre under their soles, so a figure standing
  // on the top it climbed onto was pushed up as much again and dropped at once at the hand-back): the push goes out by the
  // crossfade's own share, as the climb's line-up does. Untouched at every other time (nothing moved at a share of 1).
  if (lp.pushKeep < 1) S.scalePush(lp.pushKeep > 0 ? lp.pushKeep : 0);
  for (let side = 0; side < 2; side++) {
    if (lp.handW[side] > 0.01) continue;
    if (!S.handOut(world, side === 0 ? SPH_L_HAND : SPH_R_HAND, STILL_FLAGS, filter)) continue;
    const g = lp.gripNow(rig, side, null, grip);
    if (!g) continue;
    const w = S.handPush;
    lp.hand[side * 3] = g.x + w.x;
    lp.hand[side * 3 + 1] = g.y + w.y;
    lp.hand[side * 3 + 2] = g.z + w.z;
    lp.handW[side] = 1;
    lp.palmW[side] = 0;
  }
}

/** After the solves: what is still in something pushed out at once (the trunk and legs), and the measure left in `after`. */
export function settleClimb(S: BodySpheres, lp: LimbPlace, rig: LimbRig & SphereRig, world: SphereWorld, filter: number): void {
  rig.root.updateMatrixWorld(true);
  // Only while no hand is placed (a hop's flight, a let-go's fall): pushed after the solves, a placed hand would leave its lip.
  if (PLACED[0] > 0.01 || PLACED[1] > 0.01) return;
  // (Item 0: the settle's reach goes out with the push's, or it would lay back at once what the crossfade let go.)
  S.settle(world, climbMask(lp.wallW), STILL_FLAGS, filter, lp.pushKeep < 1 ? CLIMB_TUNE.clearMost * (lp.pushKeep > 0 ? lp.pushKeep : 0) : CLIMB_TUNE.clearMost);
}

/** The climb's measure now: every sphere but a hand placed by the climb itself and the feet planted (metres; `worstAt` names it). */
export function climbWorst(S: BodySpheres, lp: LimbPlace, world: SphereWorld, filter: number): number {
  return S.measure(world, climbMeasureMask(PLACED[0], PLACED[1], lp.wallW), STILL_FLAGS, filter);
}
