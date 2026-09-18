// The body of a mobile, planned from its template's collision values and its appearance's
// bind-pose box: which colliders, how high the rigid body's origin sits over its feet, how far it
// reaches toward a point, how much a shove moves it, and the one sphere the whole mobile is culled
// by. Pure arithmetic, node-tested against the worked table of the design.
//
// Rule for this file (it is run by node with type stripping): relative imports only as
// `import type`, no enum, no namespace, no constructor parameter properties.
import type { SizeClass, Vec3 } from './types';

export interface BodyInput {
  hierarchy: 'creature_base' | 'all_b' | 'other';
  /** flyer, swims, static. */
  flags: readonly string[];
  /** Bind pose, X mirrored; extents taken componentwise, never trusting which corner is which. */
  bounds: { min: Vec3; max: Vec3 };
  collisionRadius: number;
  collisionLength: number;
  stepHeight: number;
  swimHeight: number;
  sizeClass: SizeClass;
  scale: number;
}

export interface ColliderPlan {
  shape: 'capsule' | 'ball';
  radius: number;
  /** A capsule's cylinder half-length; 0 for a ball. */
  half: number;
  /** Where it sits on the rigid body, whose origin is the support's centre. */
  at: Vec3;
  /** Whether it meets the terrain heightfield (the hull balls do not, as a vehicle's hull does not). */
  terrain: boolean;
  mass: number;
}

export interface BodyPlan {
  /** The first is the support, the rest the hull. */
  colliders: ColliderPlan[];
  /** The rigid body's origin above the ground; the model hangs at -feet. */
  feet: number;
  height: number;
  /** The middle of the body: what the kits aim at and the effects burst at. */
  halfHeight: number;
  /** Half-length and half-width, for reach. */
  along: number;
  across: number;
  centreZ: number;
  mass: number;
  /** A shove's speed is multiplied by this: a huge body hardly moves. */
  knockResist: number;
  /** Whether the Force can grip and throw it (not a large or huge body). */
  canHold: boolean;
  /** 0, or the height a flyer cruises at over the ground. */
  hover: number;
  /** How deep the body floats when it swims. */
  swimDepth: number;
  /** The sphere the manager culls the whole mobile by, in its own frame above its feet. */
  cull: { y: number; radius: number };
  /** Which rule shaped it, for the console. */
  kind: 'flyer' | 'long' | 'upright';
}

export const KNOCK_RESIST: Record<SizeClass, number> = { tiny: 1.2, small: 1, medium: 0.7, large: 0.35, huge: 0.08 };
/** The share of the mass the support capsule carries on a long body; the hull balls share the rest. */
const SUPPORT_SHARE = 0.7;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The colliders and the numbers that go with them.
 *
 * `W`, `H`, `L` are the extents across, up and along: `W` and `L` the box's, `H` the height above
 * the model's origin (the client stands a mobile on its origin, and one body is authored well
 * underground). A flyer is one ball. A `creature_base` body much longer than it is wide or tall
 * (`L > 1.6 * max(W, H)`) is long: a support capsule plus two to five hull balls along its length
 * that leave the terrain out. Everything else is one upright capsule whose radius takes the larger
 * horizontal extent, so a humanoid with its arms out in the bind pose is not a pencil.
 */
export function planBody(i: BodyInput): BodyPlan {
  const s = i.scale > 0 ? i.scale : 1;
  const { min, max } = i.bounds;
  const W = Math.abs(max[0] - min[0]) * s;
  const L = Math.abs(max[2] - min[2]) * s;
  const topY = Math.max(min[1], max[1]);
  const bottomY = Math.min(min[1], max[1]);
  const H = Math.max(0, topY) * s;
  const ey = Math.abs(topY - bottomY) * s;
  const fr = (i.collisionRadius > 0 ? i.collisionRadius : 0.5) * s;
  const centreZ = ((min[2] + max[2]) / 2) * s;
  const colliders: ColliderPlan[] = [];
  const mass = clamp(300 * W * H * L, 8, 60000);
  let feet: number;
  let along: number;
  let across: number;
  let hover = 0;
  let kind: BodyPlan['kind'];
  if (i.flags.includes('flyer')) {
    kind = 'flyer';
    const r = clamp(0.3 * Math.max(W, L, H), 0.2, 3);
    feet = r;
    colliders.push({ shape: 'ball', radius: r, half: 0, at: [0, 0, 0], terrain: true, mass });
    along = across = r;
    hover = clamp(1.6 * H, 1.5, 12);
  } else if (i.hierarchy === 'creature_base' && L > 1.6 * Math.max(W, H)) {
    kind = 'long';
    const r = clamp(Math.min(fr, W / 2, 0.4 * H), 0.15, 5);
    const total = Math.max(2 * r, 0.8 * H);
    feet = total / 2;
    colliders.push({ shape: 'capsule', radius: r, half: Math.max(0.01, total / 2 - r), at: [0, 0, centreZ], terrain: true, mass: mass * SUPPORT_SHARE });
    const rh = clamp(Math.min(W / 2, 0.4 * H), 0.15, 5);
    const n = clamp(Math.round(L / (2 * rh)), 2, 5);
    const y = Math.max(i.stepHeight * s + rh, 0.55 * H);
    const lo = Math.min(centreZ - L / 2 + rh, centreZ);
    const hi = Math.max(centreZ + L / 2 - rh, centreZ);
    for (let k = 0; k < n; k++) {
      const z = n === 1 ? centreZ : lo + ((hi - lo) * k) / (n - 1);
      colliders.push({ shape: 'ball', radius: rh, half: 0, at: [0, y - feet, z], terrain: false, mass: (mass * (1 - SUPPORT_SHARE)) / n });
    }
    along = L / 2;
    across = Math.max(r, rh);
  } else {
    kind = 'upright';
    const r = clamp(Math.min(fr, 0.2 * H + 0.02, 0.5 * Math.max(W, L)), 0.15, 6);
    const total = Math.max(2 * r, 0.92 * H);
    feet = total / 2;
    colliders.push({ shape: 'capsule', radius: r, half: Math.max(0.01, total / 2 - r), at: [0, 0, 0], terrain: true, mass });
    along = across = r;
  }
  return {
    colliders,
    feet,
    height: H,
    halfHeight: Math.max(colliders[0].radius, 0.5 * H),
    along,
    across,
    centreZ,
    mass,
    knockResist: KNOCK_RESIST[i.sizeClass] ?? 1,
    canHold: i.sizeClass !== 'large' && i.sizeClass !== 'huge',
    hover,
    swimDepth: clamp(Math.min(i.swimHeight * s, 0.5 * H), 0.1, 4),
    cull: { y: ((min[1] + max[1]) / 2) * s, radius: 0.62 * Math.hypot(W, ey, L) },
    kind,
  };
}

/**
 * How far the body reaches toward a point across the ground: the ellipse of `along` by `across`
 * at the bearing of (dx, dz) turned into the body's own frame by `heading` (forward is
 * (sin, cos) of the heading). A long creature is reached at its flank from a metre and at its
 * nose from four; an upright body or a flyer is a circle.
 */
export function radiusToward(plan: BodyPlan, heading: number, dx: number, dz: number): number {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6 || Math.abs(plan.along - plan.across) < 1e-6) return plan.across;
  const sh = Math.sin(heading);
  const ch = Math.cos(heading);
  const f = (dx * sh + dz * ch) / len;
  const r = (dx * ch - dz * sh) / len;
  const a = plan.along;
  const b = plan.across;
  return (a * b) / Math.sqrt(b * b * f * f + a * a * r * r);
}
