// Climbing II's smoothness round, item 4 (the owner, 2026-11-17: "When automatically going under things and ducking, we
// need to dynamically slow down movement speed depending on height of the crouch so it matches our various crouch and
// prone heights the closer we get to them, and dynamically switch to their animations if we get to their heights"), under
// `MOVE_TUNE.duckPace` ('height' new, 'before' the feedback round's duck at the walk's own speeds and clips) and only with
// the feedback round's duck on.
//
// What the frame's ducked height means for the pace and the clips (`DuckPace.step`, after the body's shape has written its
// capsule): standing down to `crouchAt` the standing class's speed eases toward the crouch's at the same class by how far down
// the body is (`toCrouch`, after `paceCurve`); at `crouchAt` and under it wears the crouch's clips and walks at the crouch's
// pace (`crouch`, held until it rises `crouchBand` over `crouchAt`), and past the crouch's own height its speed eases on
// toward the crawl's by how far down it is toward the lying height (`toCrawl`). Lying down where the room is too low and
// getting up again where it comes back are the shape's tests (`BodyShape.lieAhead`, `BodyShape.riseClear`); `lying` keeps
// that the body lay down for a roof, so it gets up again on its own and a prone the key asked for never does.
//
// Pure: no engine, no page; node reads it, and the player and the movement harness step the very same record.
import { MOVE_TUNE } from '../anim/moveTune.ts';
import { LOCO_TUNE } from '../anim/locoTune.ts';
import { CROUCH_TALL, DUCK_CLEAR, STAND_TALL } from './bodyShape.ts';
import { JKA } from './jkaMove.ts';

/** Whether the pace rules this frame: the switch at 'height' and the feedback round's duck on. */
export function paceOn(): boolean {
  return MOVE_TUNE.duckPace === 'height' && MOVE_TUNE.duck === 'on';
}

/** Whether the duck may lay the body down: the pace on and prone lying along the body (a crouch's upright shell fits nowhere a crouch does not). */
export function lieOn(): boolean {
  return paceOn() && MOVE_TUNE.proneShape === 'lying';
}

/** The ducked height a body lies down under, metres: the room `proneUnder` less the duck's clearance, never under the deepest duck. */
export function lieTall(): number {
  const t = MOVE_TUNE.proneUnder - DUCK_CLEAR;
  return t > MOVE_TUNE.duckMost ? t : MOVE_TUNE.duckMost;
}

export class DuckPace {
  /** Wears the crouch's clips and walks at its pace this frame: ducked to `crouchAt` or under, the crouch key not crouching it. */
  crouch = false;
  /** The share of the way from the standing class's speed to the crouch's (nought standing, one at `crouchAt`), after `paceCurve`. */
  toCrouch = 0.5;
  /** Past the crouch's height, the share of the way from the crouch's speed to the crawl's (one at the lying height), after `paceCurve`. */
  toCrawl = 0.5;
  /**
   * Without the speed classes (a rig without their clips, and the movement harness): the pace as a share of the posture's own
   * (standing eased toward Jedi Academy's duck, half; crouched eased toward the crawl at the classes' own ratio of crawl to
   * crouch). One with nothing ducked.
   */
  share = 1.5;
  /** Lying prone because the room ahead was too low: it gets up again on its own where the room comes back. */
  lying = false;
  /** The console's and the tests': how many times the duck laid the body down and got it up again. */
  laid = 0;
  rose = 0;

  constructor() {
    this.toCrouch = 0;
    this.toCrawl = 0;
    this.share = 1;
  }

  /** Back to nothing (the body stood somewhere new). */
  reset(): void {
    this.crouch = false;
    this.toCrouch = 0;
    this.toCrawl = 0;
    this.share = 1;
    this.lying = false;
  }

  /** Whether anything of the pace moves the body this frame (a crouch it wears, or a share eased). */
  get active(): boolean {
    return this.crouch || this.toCrouch > 0 || this.toCrawl > 0;
  }

  /**
   * One frame, after the shape wrote the capsule: its upright height `tall`, whether the duck ruled the body this frame (`feet`:
   * on its feet on the ground, not prone, kneeling, swimming, climbing, riding or placing), and whether the crouch key
   * crouches it (its clips and pace are the crouch's already; it eases on toward the crawl's in a tunnel all the same).
   */
  step(tall: number, feet: boolean, crouchKey: boolean): void {
    const was = this.crouch;
    this.crouch = false;
    this.toCrouch = 0;
    this.toCrawl = 0;
    this.share = 1;
    if (!feet || !paceOn()) return;
    const T = MOVE_TUNE;
    const at = T.crouchAt;
    const curve = T.paceCurve;
    if (!crouchKey) {
      this.crouch = tall <= at + 1e-6 || (was && tall <= at + T.crouchBand + 1e-6);
      if (!this.crouch && tall < STAND_TALL - 1e-6) {
        let s = at < STAND_TALL - 1e-6 ? (STAND_TALL - tall) / (STAND_TALL - at) : 1;
        if (s > 1) s = 1;
        if (s > 1e-4) this.toCrouch = curve === 1 ? s : Math.pow(s, curve);
      }
    }
    if (crouchKey || this.crouch) {
      const top = at < CROUCH_TALL ? at : CROUCH_TALL;
      const low = lieTall();
      if (top > low + 1e-6 && tall < top) {
        let s = (top - tall) / (top - low);
        if (s > 1) s = 1;
        if (s > 1e-4) this.toCrawl = curve === 1 ? s : Math.pow(s, curve);
      }
      if (this.toCrawl > 0) this.share = 1 + (LOCO_TUNE.prone.forward.normal / LOCO_TUNE.crouch.forward.normal - 1) * this.toCrawl;
    } else if (this.toCrouch > 0) this.share = 1 + (JKA.duckScale - 1) * this.toCrouch;
  }
}
