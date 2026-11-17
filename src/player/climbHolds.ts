// Climbing II, phase 2, item 6 (maker B; the owner's: "doing diagonal up/down should use the same up/down animation for wall
// climbing but use hand and foot placement IK to basically lock them in place until the next step/handhold for each limb").
// Under `climb.wallLimbs` 'held', a hand or a foot the wall clip plants on the face (its plant share whole: the clip has it
// within `WALL_PLANT.near` of its wall) takes a hold there, a point in the physics frame, and is put on that point however the
// body moves until that limb's next reach: the clip lifting it (its share under a half) begins the reach, and the hold is let
// go of over `climb.ease` into where the clip has it, a new hold taken where the clip plants it again (never sooner than the
// ease, so a reach is never a frame's jump).
//
// One limb reaches at a time, as a climber moves: the clips lift a hand and the other foot together, so a limb the clip lifts
// while another is still reaching (let go of its hold and not on a new one) stays on its hold, its turn kept, and reaches the
// moment that one is on its new hold (from its hold to where the clip has it then, over the ease, even where the clip has
// planted it again meanwhile). A limb whose hold the body has carried more than `climb.holdMost` from where its clip has it
// reaches at once whatever else is reaching (`forced`), and so does a foot whose hold stands past its leg's own length from
// the hip (`reach`, `beyond`), so no leg is asked past its reach (the hands need no such test: the figure is drawn toward
// them). One limb at a time is therefore the rule only while neither carries a hold that far: climbing straight up or along
// on the shimmy clips the clip's own limbs stay with their holds, but on a diagonal the up or down clip's limbs do not move
// across the face with the body, and at the shipped `holdMost` (0.3 m) most reaches there are forced, two limbs often
// between their holds at once (the fixer of Climbing II's phase 2 measured it; the most is the owner's).
//
// The limbs: 0 the left hand, 1 the right, 2 the left foot, 3 the right. The wall climb steps the hands
// (`WallClimb.limbsFor`) and the limbs' solve the feet (`LimbPlace.placeFeet`), each through `step` with its ask in the
// fields (no number crosses a call). Nothing here makes an object on a frame.

/** The limbs a climb holds. */
export const HOLD_LIMBS = 4;

export class ClimbHolds {
  /** Each limb's hold, x y z in the physics frame (limb * 3). */
  readonly at = new Float64Array(HOLD_LIMBS * 3);
  /** Whether each limb is on its hold. */
  readonly on = new Uint8Array(HOLD_LIMBS);
  /** Whether each limb is reaching (let go of its hold and not on a new one), and whether that reach was forced by the most. */
  readonly moving = new Uint8Array(HOLD_LIMBS);
  readonly forcedNow = new Uint8Array(HOLD_LIMBS);
  /** Whether each limb's clip has lifted it while another reached: its turn, kept until that one is on its new hold. */
  readonly turn = new Uint8Array(HOLD_LIMBS);
  /** Seconds since each limb let go of its hold. */
  readonly since = new Float64Array(HOLD_LIMBS);
  /** How much of each limb's target is its hold (eased toward 1 while held, toward nought once let go). */
  readonly share = new Float64Array(HOLD_LIMBS);
  /** The limb whose turn it is to reach now (let go of its hold and not on a new one), -1 for none. */
  mover = -1;
  /** In: where the limb's clip has it on the face (x y z), how planted the clip has it (0 to 1), the frame's seconds, the ease and the most. */
  px = 0.5;
  py = 0.5;
  pz = 0.5;
  plant = 0.5;
  dt = 0.5;
  ease = 0.5;
  most = 0.5;
  /**
   * In: how far the limb reaches from its own root (nought for no test: the hands, toward which the figure is drawn), and
   * that root moved by the limb's end's offset from the point held (x y z), so a hold the limb cannot reach is let go of:
   * the feet's (`LimbPlace.placeFeet`: the hip moved by the ball's offset from the ankle, the thigh's and shin's lengths).
   */
  reach = 0.5;
  rx = 0.5;
  ry = 0.5;
  rz = 0.5;
  /** Out: the limb's target this frame and its weight (0 to 1). */
  tx = 0.5;
  ty = 0.5;
  tz = 0.5;
  w = 0.5;
  /**
   * Counted (the console's and the tests'): holds taken, reaches begun, reaches forced (begun while another limb was
   * reaching, by the most or by the limb's reach), holds let go of because the limb could not reach them, frames a limb was
   * kept on its hold for its turn.
   */
  taken = 0;
  reaches = 0;
  forced = 0;
  beyond = 0;
  waited = 0;

  constructor() {
    // Fields that will hold fractions start as one (wave 2a's lesson) and are put to nought here.
    this.px = 0;
    this.py = 0;
    this.pz = 0;
    this.plant = 0;
    this.dt = 0;
    this.ease = 0;
    this.most = 0;
    this.reach = 0;
    this.rx = 0;
    this.ry = 0;
    this.rz = 0;
    this.tx = 0;
    this.ty = 0;
    this.tz = 0;
    this.w = 0;
  }

  /** Every hold let go of at once (onto a wall, off it). */
  reset(): void {
    this.on.fill(0);
    this.moving.fill(0);
    this.forcedNow.fill(0);
    this.turn.fill(0);
    this.share.fill(0);
    this.since.fill(0);
    this.mover = -1;
  }

  /** A limb with no face under it: its hold let go of at once (an edge, a gap), its target where the clip has it. */
  drop(limb: number): void {
    this.on[limb] = 0;
    this.moving[limb] = 0;
    this.forcedNow[limb] = 0;
    this.turn[limb] = 0;
    this.share[limb] = 0;
    if (this.mover === limb) this.mover = -1;
    this.tx = this.px;
    this.ty = this.py;
    this.tz = this.pz;
    this.w = 0;
  }

  /** One limb's frame: its hold taken, kept or let go, and its target and weight into `t*` and `w`. */
  step(limb: number): void {
    const k = limb * 3;
    const at = this.at;
    const p = this.plant;
    const px = this.px;
    const py = this.py;
    const pz = this.pz;
    let held = this.on[limb] === 1;
    if (held) {
      const dx = px - at[k];
      const dy = py - at[k + 1];
      const dz = pz - at[k + 2];
      const m = this.most;
      let far = dx * dx + dy * dy + dz * dz > m * m;
      const r = this.reach;
      if (!far && r > 0) {
        // Past the limb's own reach from its root: no leg is asked past its length (the fixer of Climbing II's phase 2).
        const ex = at[k] - this.rx;
        const ey = at[k + 1] - this.ry;
        const ez = at[k + 2] - this.rz;
        if (ex * ex + ey * ey + ez * ez > r * r) {
          far = true;
          this.beyond++;
        }
      }
      if (far) {
        // Carried past the most, or out of the limb's reach: it reaches now, its turn or not.
        held = false;
        this.on[limb] = 0;
        this.moving[limb] = 1;
        this.since[limb] = 0;
        this.turn[limb] = 0;
        this.reaches++;
        if (this.mover < 0) this.mover = limb;
        else if (this.mover !== limb) {
          this.forcedNow[limb] = 1;
          this.forced++;
        }
      } else if (p < 0.5 || this.turn[limb] === 1) {
        if (this.mover < 0 || this.mover === limb) {
          held = false;
          this.on[limb] = 0;
          this.moving[limb] = 1;
          this.since[limb] = 0;
          this.turn[limb] = 0;
          this.mover = limb;
          this.reaches++;
        } else {
          this.turn[limb] = 1;
          this.waited++;
        }
      }
    } else {
      this.since[limb] += this.dt;
      // On again where the clip plants it, once let go of for the ease at least.
      if (p >= 1 && this.since[limb] >= this.ease) {
        at[k] = px;
        at[k + 1] = py;
        at[k + 2] = pz;
        this.on[limb] = 1;
        this.moving[limb] = 0;
        this.forcedNow[limb] = 0;
        held = true;
        this.taken++;
        if (this.mover === limb) this.mover = -1;
      }
    }
    const e = this.ease;
    const st = e > 0 ? this.dt / e : 1;
    let s = this.share[limb];
    if (held) s = s + st < 1 ? s + st : 1;
    else s = s - st > 0 ? s - st : 0;
    this.share[limb] = s;
    this.tx = px + (at[k] - px) * s;
    this.ty = py + (at[k + 1] - py) * s;
    this.tz = pz + (at[k + 2] - pz) * s;
    this.w = p > s ? p : s;
  }

  /** Limbs reaching in turn now (forced reaches left out): the tests' one-at-a-time count. */
  reaching(): number {
    let n = 0;
    for (let i = 0; i < HOLD_LIMBS; i++) if (this.moving[i] === 1 && this.forcedNow[i] === 0) n++;
    return n;
  }
}
