// The drawn body's height over a step (wave 3 of the animations): the character controller's autostep lifts the capsule a
// whole riser in one step and its snap to the ground drops it one going down, and a figure drawn on the capsule pops by
// that much. The drawn figure keeps where it was and eases onto the capsule over `stairs.ease`, never more than
// `stairs.lagMost` away, while the feet stand on the real treads (src/player/footIk.ts). Visual only, as the swim's sink
// is: the capsule, the physics and what other players are sent are untouched.
//
// What is a pop and what is the ground's own slope is told apart by the plane under the body (the slope rule's floor,
// src/player/slopeRule.ts): moving along that plane the capsule's height follows it, and only what the controller added
// to the move beyond the plane's rise (a riser stepped up, a drop snapped down) goes into the lag, so a body walking up a
// ramp or a hill is drawn on its capsule exactly. With no plane known (not standing on walkable ground, or the slope rule
// at 'before') nothing is taken for a pop. Only on a frame that began on the ground: a landing's or a jump's height is the
// air's own.
//
// Pure: numbers in a kept record, the offset out in a field, nothing made.

import type { LocoTune } from './locoTune.ts';

/** A frame of the capsule as the ease needs it (written by the caller before `step`; declared as fractions). */
export class DrawnIn {
  dt = 0.5;
  /** How far the controller moved the capsule this frame, and how far up the move asked it to go (the velocity's own share). */
  dx = 0.5;
  dy = 0.5;
  dz = 0.5;
  askedY = 0.5;
  /** The plane under the body after the move (its normal), NaN for none known. */
  nx = 0.5;
  ny = 0.5;
  nz = 0.5;
  /** The frame began on the ground, on its feet (not swimming, not on the rope). */
  grounded = false;
}

export class DrawnHeight {
  /** The drawn body's height less the capsule's, metres: under nought just after a step up, over it just after a step down. */
  offset = 0.5;
  /** The last frame's pop, metres (the console's). */
  popped = 0.5;

  constructor() {
    this.offset = 0;
    this.popped = 0;
  }

  /** Back onto the capsule at once (the body stood somewhere new). */
  reset(): void {
    this.offset = 0;
    this.popped = 0;
  }

  step(f: DrawnIn, tune: LocoTune['stairs']): void {
    if (tune.rule !== 'stairs') {
      this.offset = 0;
      this.popped = 0;
      return;
    }
    let pop = 0;
    if (f.grounded && f.ny > 0.05) {
      // What the controller added beyond the move asked for, less the plane's own rise over the ground gone.
      const rise = -(f.nx * f.dx + f.nz * f.dz) / f.ny;
      pop = f.dy - f.askedY - rise;
      // A pop is a step's: a rise or drop of a centimetre or more (less is the controller's own settling and the plane's
      // rounding, which the drawn body follows exactly).
      if (pop < 0.01 && pop > -0.01) pop = 0;
    }
    this.popped = pop;
    let o = this.offset - pop;
    const ease = tune.ease;
    o = ease > 0 ? o * Math.exp(-f.dt / ease) : 0;
    const most = tune.lagMost;
    if (o > most) o = most;
    else if (o < -most) o = -most;
    this.offset = o;
  }
}
