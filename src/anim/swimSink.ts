// How far a treading figure is drawn under where its body floats (the owner's word of 2026-11-15: "my body is above the
// water ... my body needs to move down quite a bit"). Only the drawn figure moves: the capsule, the swim, the wading and
// the camera's place are the swim's as ever. The sink is the tune's `swim.sink` on a figure of the human's size, scaled
// by the figure's own, and it applies only at the surface: a body deeper than the float line takes that much less of
// it, and none once it is as deep as the sink would have drawn it (`swimSinkAt`), so a dive and a rise hand over with no
// step. It comes on as the body stops to tread and goes as it swims off, eased by `swim.ease`.
//
// Pure: the player and the peers each keep one of these and the node tests drive the very class. Nothing is made on a
// frame and no number crosses a call: what a frame hands in it writes into this record's fields, and the answer is read
// off `now`.

import type { AnimTune } from './animTune.ts';

/** The sink a body at `depth` (its feet under the surface, metres) is drawn down by, with `full` the whole sink and `floatDepth` the depth it floats at. */
export function swimSinkAt(full: number, depth: number, floatDepth: number): number {
  const s = full - (depth - floatDepth);
  return s < 0 ? 0 : s > full ? full : s;
}

export class SwimSink {
  /** The frame's seconds, the body's feet under the surface (metres), the figure's size against the human's, and the depth it floats at: written before `step`. (Declared as fractions.) */
  dt = 0.5;
  depth = 0.5;
  scale = 0.5;
  floatDepth = 0.5;
  /** How much of the sink is on, 0 to 1, eased by the tune's `swim.ease`. */
  share = 0.5;
  /** The sink this frame, metres: how far the drawn figure stands under the body. */
  now = 0.5;

  constructor() {
    this.dt = 0;
    this.depth = 0;
    this.scale = 1;
    this.floatDepth = 1.1;
    this.share = 0;
    this.now = 0;
  }

  /**
   * A frame: `treading` says the figure treads in the water at all (the water's own state, still, and not a first
   * person view, whose eye is the head itself). Under the tune's 'before' the sink is nought, as it was.
   */
  step(treading: boolean, tune: AnimTune): void {
    const sw = tune.swim;
    const want = treading && sw.rule === 'owner';
    const k = sw.ease > 0 ? 1 - Math.exp(-this.dt / sw.ease) : 1;
    const target = want ? 1 : 0;
    this.share += (target - this.share) * k;
    // Settled to nothing: exactly nought, so a body that never treads is drawn where it always was.
    if (!want && this.share < 1e-4) this.share = 0;
    if (this.share <= 0) {
      this.now = 0;
      return;
    }
    const full = sw.sink * this.scale;
    const s = full - (this.depth - this.floatDepth);
    this.now = this.share * (s < 0 ? 0 : s > full ? full : s);
  }

  /** Let go at once (a reset, a mount, a world left). */
  drop(): void {
    this.share = 0;
    this.now = 0;
  }
}
