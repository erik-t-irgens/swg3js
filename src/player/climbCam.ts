// Climbing II, Smoothness II, item 7 (`climb.camera` 'eased'; the owner, 2026-11-17: "my camera can snap around and jump
// quickly in some movements while climbing or shimmying around corners. I'd like to smooth the camera so that doesn't
// happen"): while the body is held by a climb (hanging, shimmying, a hop, a wall climb, a climb up), the place the chase
// camera follows is the body's through a critically damped follow of `climb.camEase`, so a corner's turn, a hang place moved,
// a transition's place carried or a hop's landing never moves the view in one frame. Once the climb lets go the follow goes
// on until it has caught the body, then hands the body's own place back, so a top-out never snaps either.
//
// Each step is the critically damped spring's own exact answer over the frame (the target held for the frame), so it eases
// alike at any frame rate. The view's own mouse look is never eased: only the point it orbits.
//
// Pure: numbers only (node runs it with the harness's bodies).

/** The follow is let go of once within this of the body and slower than `CAUGHT_SPEED` (metres, m/s; a mechanic, under a pixel at chase distance). */
const CAUGHT = 0.002;
const CAUGHT_SPEED = 0.05;

export class ClimbCamFollow {
  /** The followed point and its velocity (metres, m/s); `on` while it, not the body, is what the camera follows. */
  x = 0.5;
  y = 0.5;
  z = 0.5;
  vx = 0.5;
  vy = 0.5;
  vz = 0.5;
  on = false;

  constructor() {
    this.tx = 0;
    this.ty = 0;
    this.tz = 0;
    this.dt = 0;
    this.ease = 0;
    this.bvx = 0;
    this.bvy = 0;
    this.bvz = 0;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
  }

  /** Nothing followed (a reset, a travel, a death): the next climb starts on the body. */
  reset(): void {
    this.on = false;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
  }

  /** The frame's ask, written by the caller before `stepIn` (fields, so no number crosses a call): the body's place (tx, ty, tz), the frame's seconds, whether a climb holds the body, the follow's time and the body's own speed (a climb begun starts the follow moving with it). */
  tx = 0.5;
  ty = 0.5;
  tz = 0.5;
  dt = 0.5;
  climbing = false;
  ease = 0.5;
  bvx = 0.5;
  bvy = 0.5;
  bvz = 0.5;

  /** `stepIn` with its ask handed over (the tests'; the game writes the ask and calls `stepIn`). */
  step(tx: number, ty: number, tz: number, dt: number, climbing: boolean, ease: number, bvx: number, bvy: number, bvz: number): boolean {
    this.tx = tx;
    this.ty = ty;
    this.tz = tz;
    this.dt = dt;
    this.climbing = climbing;
    this.ease = ease;
    this.bvx = bvx;
    this.bvy = bvy;
    this.bvz = bvz;
    return this.stepIn();
  }

  /**
   * A frame: toward the body at (tx, ty, tz), `ease` seconds the follow's time (two over it its rate), while `climbing` (and,
   * after, until caught). A climb begun starts the follow on the body moving at (bvx, bvy, bvz). Answers whether the follow is
   * what the camera follows this frame.
   */
  stepIn(): boolean {
    const tx = this.tx;
    const ty = this.ty;
    const tz = this.tz;
    const dt = this.dt;
    const climbing = this.climbing;
    const ease = this.ease;
    if (!this.on) {
      if (!climbing) return false;
      this.on = true;
      this.x = tx;
      this.y = ty;
      this.z = tz;
      this.vx = this.bvx;
      this.vy = this.bvy;
      this.vz = this.bvz;
      return true;
    }
    if (!(ease > 0) || !(dt > 0)) {
      this.x = tx;
      this.y = ty;
      this.z = tz;
      this.vx = 0;
      this.vy = 0;
      this.vz = 0;
    } else {
      // x(t) = target + (c1 + c2 t) e^(-w t), c1 = x0 - target, c2 = v0 + w c1: the critically damped answer, exact over the step.
      const w = 2 / ease;
      const e = Math.exp(-w * dt);
      let c1 = this.x - tx;
      let c2 = this.vx + w * c1;
      this.x = tx + (c1 + c2 * dt) * e;
      this.vx = (c2 - w * (c1 + c2 * dt)) * e;
      c1 = this.y - ty;
      c2 = this.vy + w * c1;
      this.y = ty + (c1 + c2 * dt) * e;
      this.vy = (c2 - w * (c1 + c2 * dt)) * e;
      c1 = this.z - tz;
      c2 = this.vz + w * c1;
      this.z = tz + (c1 + c2 * dt) * e;
      this.vz = (c2 - w * (c1 + c2 * dt)) * e;
    }
    if (!climbing) {
      const dx = this.x - tx;
      const dy = this.y - ty;
      const dz = this.z - tz;
      if (dx * dx + dy * dy + dz * dz < CAUGHT * CAUGHT && this.vx * this.vx + this.vy * this.vy + this.vz * this.vz < CAUGHT_SPEED * CAUGHT_SPEED) {
        this.on = false;
        return false;
      }
    }
    return true;
  }
}

