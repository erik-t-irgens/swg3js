// The rope chain round, item 3 (maker B): the curve a chain is drawn through. The chain's drawn points (src/player/ropeChain.ts's
// `lay`: its points led to the frame's own time, the drawn hands put in on a held rope) are knots a smooth curve passes through,
// sampled `CURVE_STEPS` times a span, so the strip `ropeChainDraw.ts` lays turns as a rope does rather than kinking at each link.
// The curve is a centripetal Catmull-Rom (its knots spaced by the square root of the distance between them), which passes through
// every knot and never loops or overshoots between two knots close together (the two hands, a hand's width apart, beside links a
// third of a metre long), so:
//  - every knot is a ring of the curve exactly (written as it stands, never worked out by the formula), the hands among them: the
//    drawn rope meets each hand to the bit, whatever the curve does between;
//  - a knot lying on something (its surface's normal not nought) is lifted along that normal by `climb.ropeLift` before the curve is
//    laid through it, so the rope lying on the ground or on a ledge is drawn that far off it (and the material's depth offset does
//    the rest); a knot touching nothing, a hand among them, is not moved;
//  - each ring's place along the rope (`along`, metres from the anchor by the rings themselves) is what the twist's strands are laid
//    by, so the strands stay on the rope as it swings, and the hands slide along them as the body climbs.
// Pure: no three.js; nothing made a frame (kept arrays; the one number it takes, the lift, read off the tune).
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { CHAIN_MOST, type RopeChain } from './ropeChain.ts';

/** Samples a span between two knots (a mechanic: four, so a link a third of a metre long is drawn in pieces of 8 cm, smooth to the eye at any distance a rope is climbed at). */
export const CURVE_STEPS = 4;
/** The most knots: the chain's most points and the two hands put into it. */
export const CURVE_KNOTS = CHAIN_MOST + 2;
/** The most rings a curve lays. */
export const CURVE_MOST = (CURVE_KNOTS - 1) * CURVE_STEPS + 1;
/** Two knots nearer than this along the curve's own knot spacing count as this far apart (a mechanic: no span divided by nought). */
const KNOT_LEAST = 1e-4;

/** One rope's curve, laid a frame: the rings' places, their places along the rope, and the hands' rings. */
export class RopeCurve {
  /** The rings' places, three numbers each, and how many. */
  readonly ring = new Float64Array(3 * CURVE_MOST);
  /** Each ring's place along the rope from its anchor, metres (by the rings, so the strands stay put on a rope lying still). */
  readonly along = new Float64Array(CURVE_MOST);
  count = 0;
  /** The rings of the drawn hands (the chain's `gripA` and `gripB` knots), -1 where no hand is drawn. */
  gripA = -1;
  gripB = -1;
  /** The knots as laid: the chain's drawn points, each lying one lifted off its surface. */
  private readonly knot = new Float64Array(3 * CURVE_KNOTS);
  /** How far each knot was lifted, metres (the console's and the tests' word; begun as a fraction, put to nought in the constructor). */
  liftMost = 0.5;
  /** Knots lifted this lay. */
  lifted = 0;

  constructor() {
    this.liftMost = 0;
  }

  /** Lay the curve through `c`'s drawn points (see the file). Writes kept arrays only. */
  lay(c: RopeChain): void {
    const n = c.drawCount;
    const D = c.draw;
    const N = c.drawN;
    const K = this.knot;
    const lift = CLIMB_TUNE.ropeLift;
    let lifted = 0;
    for (let i = 0; i < n; i++) {
      const nx = N[3 * i];
      const ny = N[3 * i + 1];
      const nz = N[3 * i + 2];
      if (nx !== 0 || ny !== 0 || nz !== 0) {
        K[3 * i] = D[3 * i] + nx * lift;
        K[3 * i + 1] = D[3 * i + 1] + ny * lift;
        K[3 * i + 2] = D[3 * i + 2] + nz * lift;
        lifted++;
      } else {
        K[3 * i] = D[3 * i];
        K[3 * i + 1] = D[3 * i + 1];
        K[3 * i + 2] = D[3 * i + 2];
      }
    }
    this.lifted = lifted;
    this.liftMost = lifted > 0 ? lift : 0;
    const R = this.ring;
    this.gripA = c.gripA < 0 ? -1 : c.gripA * CURVE_STEPS;
    this.gripB = c.gripB < 0 ? -1 : c.gripB * CURVE_STEPS;
    if (n < 2) {
      this.count = 0;
      return;
    }
    let m = 0;
    for (let i = 0; i < n - 1; i++) {
      // The span from knot i to knot i + 1, with its neighbours (each end's own reflected where there is none).
      const x1 = K[3 * i];
      const y1 = K[3 * i + 1];
      const z1 = K[3 * i + 2];
      const x2 = K[3 * i + 3];
      const y2 = K[3 * i + 4];
      const z2 = K[3 * i + 5];
      let x0: number;
      let y0: number;
      let z0: number;
      if (i > 0) {
        x0 = K[3 * i - 3];
        y0 = K[3 * i - 2];
        z0 = K[3 * i - 1];
      } else {
        x0 = 2 * x1 - x2;
        y0 = 2 * y1 - y2;
        z0 = 2 * z1 - z2;
      }
      let x3: number;
      let y3: number;
      let z3: number;
      if (i + 2 < n) {
        x3 = K[3 * i + 6];
        y3 = K[3 * i + 7];
        z3 = K[3 * i + 8];
      } else {
        x3 = 2 * x2 - x1;
        y3 = 2 * y2 - y1;
        z3 = 2 * z2 - z1;
      }
      // The knot spacing: the square root of each distance (centripetal), never under `KNOT_LEAST`.
      let d01 = Math.sqrt(Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) + (z1 - z0) * (z1 - z0)));
      let d12 = Math.sqrt(Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1) + (z2 - z1) * (z2 - z1)));
      let d23 = Math.sqrt(Math.sqrt((x3 - x2) * (x3 - x2) + (y3 - y2) * (y3 - y2) + (z3 - z2) * (z3 - z2)));
      if (d01 < KNOT_LEAST) d01 = KNOT_LEAST;
      if (d12 < KNOT_LEAST) d12 = KNOT_LEAST;
      if (d23 < KNOT_LEAST) d23 = KNOT_LEAST;
      const t1 = d01;
      const t2 = t1 + d12;
      const t3 = t2 + d23;
      // The knot itself, as it stands.
      R[3 * m] = x1;
      R[3 * m + 1] = y1;
      R[3 * m + 2] = z1;
      m++;
      for (let u = 1; u < CURVE_STEPS; u++) {
        const t = t1 + (d12 * u) / CURVE_STEPS;
        // Barry and Goldman's pyramid: three lines, two blends of them, and one of those.
        const a1 = (t1 - t) / t1;
        const b1 = t / t1;
        const ax = a1 * x0 + b1 * x1;
        const ay = a1 * y0 + b1 * y1;
        const az = a1 * z0 + b1 * z1;
        const a2 = (t2 - t) / d12;
        const b2 = (t - t1) / d12;
        const bx = a2 * x1 + b2 * x2;
        const by = a2 * y1 + b2 * y2;
        const bz = a2 * z1 + b2 * z2;
        const a3 = (t3 - t) / d23;
        const b3 = (t - t2) / d23;
        const cx = a3 * x2 + b3 * x3;
        const cy = a3 * y2 + b3 * y3;
        const cz = a3 * z2 + b3 * z3;
        const e1 = (t2 - t) / t2;
        const f1 = t / t2;
        const px = e1 * ax + f1 * bx;
        const py = e1 * ay + f1 * by;
        const pz = e1 * az + f1 * bz;
        const e2 = (t3 - t) / (t3 - t1);
        const f2 = (t - t1) / (t3 - t1);
        const qx = e2 * bx + f2 * cx;
        const qy = e2 * by + f2 * cy;
        const qz = e2 * bz + f2 * cz;
        R[3 * m] = a2 * px + b2 * qx;
        R[3 * m + 1] = a2 * py + b2 * qy;
        R[3 * m + 2] = a2 * pz + b2 * qz;
        m++;
      }
    }
    // The last knot.
    R[3 * m] = K[3 * (n - 1)];
    R[3 * m + 1] = K[3 * (n - 1) + 1];
    R[3 * m + 2] = K[3 * (n - 1) + 2];
    m++;
    this.count = m;
    // Each ring's place along the rope, by the rings.
    const A = this.along;
    A[0] = 0;
    for (let k = 1; k < m; k++) {
      const dx = R[3 * k] - R[3 * k - 3];
      const dy = R[3 * k + 1] - R[3 * k - 2];
      const dz = R[3 * k + 2] - R[3 * k - 1];
      A[k] = A[k - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
}
