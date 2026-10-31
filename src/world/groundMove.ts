// Two rules of the AI handoff's step 3 that the fighters (`npcs.ts`) and the people from the catalogue
// (`mobiles/tactics.ts`, `mobiles/mobile.ts`) share, so the two can never come to answer differently and a node test
// runs the very lines both of them run.
//
//   1. **Which place on the standoff ring is picked** (`StandoffTries`). The slide's lean is laid on the point before
//      the route is asked for it, the point is checked before it is picked, and the order of the tries is fixed: the
//      point as chosen, else the slide the other way (kept, so the next frame does not try the wall again), else the
//      ring with no slide at all. One refused every way is never walked into, and is counted once a refusal and not once
//      a frame, so the count is the same at any frame rate.
//   2. **Where the feet go and whether the gun goes with them** (`legsFor`). A slide the route walks straight is held to
//      its tier's lean; a corner the route bent it round is walked as the route says, and only past what the legs can
//      show at all (`GROUND_STEP.legMax`) is it a move, which takes the gun with it. Held to the tier's lean on a routed
//      slide, the gun swung onto the feet every time the bearing drifted a degree past the lean between two plans --
//      which indoors is every plan, since a room's path always ends at its goal and so is always a corner.
//
// Pure: numbers and kept records in, kept records out, so a node test runs it as it stands. Nothing here is made on a
// frame.
import { GROUND_STEP } from './groundStep.ts';
import { wrapAngle } from './fighterStance.ts';

/** Which way round a slide goes, and the count of its refusals, kept per body. Its `ask` is written by the caller. */
export class StandoffTries {
  /** Which way round the ring its slide goes, +1 or -1: the duty cycle flips it, and so does a pick that found only the other way open. */
  side: number;
  /** Whether the frame before was refused every way. */
  refusing = false;
  /** Whether this pick began a refusal: the one frame a refusal is counted on. */
  fresh = false;
  /**
   * What one pick is asked, written by the caller and read at once, so no number crosses a call: where the body stands
   * (`x`, `z`) and what it fights (`tx`, `tz`), the ring's own pull (`vx`, `vz`, nought inside its band), the outward
   * unit from the target (`ux`, `uz`), the slide across the ring this frame (`slide`: its tier's share times `side`,
   * nought while it holds), how far ahead the point is put (`step`), and the lean laid on a slide (`lean`, radians; below
   * nought for none, which is a body that has not earned the split or one backing out of somebody's face).
   */
  readonly ask = { x: 0, z: 0, tx: 0, tz: 0, vx: 0, vz: 0, ux: 0, uz: 0, slide: 0, step: 0, lean: -1 };
  /** Whether the last try had a point to try at all: a body in its band with no slide has none. */
  private had = false;

  constructor(side: number) {
    this.side = side < 0 ? -1 : 1;
  }

  /**
   * The place picked, written into `out`, and whether there is one. `fits` is the check (on the room's floor indoors, a
   * walkable leg outdoors: `walkGoalFits`). Writes `fresh` as it answers.
   */
  pick(out: { x: number; z: number }, fits: (gx: number, gz: number) => boolean): boolean {
    const slide = this.ask.slide;
    let ok = this.tryAt(out, slide, fits);
    let tried = this.had;
    if (!ok && slide !== 0) {
      ok = this.tryAt(out, -slide, fits);
      tried ||= this.had;
      if (ok) this.side = -this.side;
      else {
        ok = this.tryAt(out, 0, fits);
        tried ||= this.had;
      }
    }
    const refused = !ok && tried;
    this.fresh = refused && !this.refusing;
    this.refusing = refused;
    return ok;
  }

  /** One place on the ring: the pull and the slide across it, the lean laid on it, a stride out, then the check. */
  private tryAt(out: { x: number; z: number }, side: number, fits: (gx: number, gz: number) => boolean): boolean {
    const a = this.ask;
    this.had = false;
    const dx = a.vx - a.uz * side;
    const dz = a.vz + a.ux * side;
    if (!(dx * dx + dz * dz > 1e-6)) return false;
    this.had = true;
    let travel = Math.atan2(dx, dz);
    if (a.lean >= 0) {
      const face = Math.atan2(a.tx - a.x, a.tz - a.z);
      const off = wrapAngle(travel - face);
      if (Math.abs(off) > a.lean && Math.abs(off) <= Math.PI / 2 + 0.01) travel = face + Math.sign(off) * a.lean;
    }
    out.x = a.x + Math.sin(travel) * a.step;
    out.z = a.z + Math.cos(travel) * a.step;
    return fits(out.x, out.z);
  }
}

/** What `legsFor` answered: the heading the feet are eased onto, and whether the gun goes with them. Written, never made. */
export const LEGS = { head: 0, gunOnFeet: false };

/**
 * Where the feet go while a body that has earned the split moves, and whether the gun goes with them, written into
 * `LEGS`: `travel` is the way the feet want to go (the route's corner, or the goal itself), `aim` the way the gun points.
 *
 * Within the lean, the feet go where they want and the gun stays. A **slide** the route did not bend (`leanOnly`, not
 * `routed`) is held to its tier's lean (`slideLean`): past it the feet are laid on the lean and the gun stays where it
 * is, which turns a sideways slip into a diagonal. A slide whose corner the route chose (`routed`) is walked as the
 * route says and keeps the gun on what it fights up to the legs' own ceiling (`GROUND_STEP.legMax`), the same as any
 * move: its goal was put inside the lean before the route was asked for it, so only the drift of the bearing between
 * two plans, or a real bend round something, takes it past the lean, and neither is a reason to swing the gun. Anything
 * past the ceiling is a move, which turns the body and takes the gun with it, since there is no strafe clip to draw it.
 */
export function legsFor(travel: number, aim: number, leanOnly: boolean, slideLean: number, routed: boolean): void {
  const off = wrapAngle(travel - aim);
  const lean = leanOnly && !routed ? slideLean : GROUND_STEP.legMax;
  LEGS.head = travel;
  LEGS.gunOnFeet = false;
  if (Math.abs(off) <= lean) return;
  if (leanOnly && !routed && Math.abs(off) <= Math.PI / 2 + 0.01) {
    LEGS.head = aim + Math.sign(off) * lean;
    return;
  }
  LEGS.gunOnFeet = true;
}
