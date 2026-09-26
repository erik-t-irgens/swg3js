// Where a prop may stand, and how it is turned while somebody is placing it.
//
// A house and a prop are placed by the same hand and judged by quite different rules, which is why
// this is its own file rather than another branch of `housePlace.ts`.
//
// A **house** meets ground it cannot change: it is stood at the height of its own doorstep, ground
// falling away is forgiven because a foundation covers it, ground rising over the doorstep is not,
// and the whole thing is refused rather than made to fit. A **prop** is the opposite in every way. It
// may go indoors, where there is no terrain at all and the floor is a room's. It may be lifted and
// dropped a long way on purpose -- that is how a picture goes on a wall and a lamp on a shelf. It may
// be turned about all three axes, because a crate lying on its side is a crate lying on its side. And
// it is small enough that the ground under it is never the question.
//
// So there are exactly two rules, and both are the owner's words: **not fully submerged beneath the
// world, and not inside a wall.** Everything else a player may do.
//
// Neither rule is a distance. "Buried" is every corner of the thing below the floor under it, which
// lets a rug sit flush and a foundation stone sink halfway and refuses only a thing nobody could
// ever see. "In a wall" is asked of the world rather than guessed from a box: the game answers
// whether a point is inside something solid, and the test is how many of the thing's own points are.
// A prop may therefore clip a wall -- a shelf bracket must -- and may not be swallowed by one.
//
// Pure: no three, no rapier, no DOM. Rule for this file (node runs it with type stripping for the
// tests): relative imports only as `import type`, no enum, no namespace, no constructor parameter
// properties.

/** Every number here is ours. Live through `__debug.prop`. */
export const PROP_TUNE = {
  /** How far ahead of the player a prop starts, metres. */
  reach: 3,
  /** The closest and furthest the wheel will push it, metres. */
  near: 0.6,
  far: 25,
  /** How far one notch of the wheel moves it, metres. */
  step: 0.25,
  /** How far one press of a turn key turns it, degrees. */
  turn: 15,
  /** How far one press of a height key lifts or drops it, metres. */
  rise: 0.1,
  /**
   * The most it may be lifted or dropped from where the ground put it, metres.
   *
   * Generous on purpose: the owner asked to be able to raise and lower quite far, because that is
   * how a thing goes on a shelf, on a beam, or down into a plinth. What stops it is the two rules,
   * not this.
   */
  most: 30,
  /** How see-through the thing is while it is a ghost. */
  opacity: 0.5,
  /**
   * How many of a prop's own points must be inside something solid before it counts as in a wall.
   *
   * Not one, because a shelf bracket, a wall light and a picture all have to reach into the wall
   * they hang on, and not all of them, because a thing half in a wall is a thing in a wall. Two
   * thirds is ours.
   */
  buriedShare: 0.67,
};

/** A box in the thing's own frame: the bounds the pack carries. */
export interface PropBox {
  min: number[];
  max: number[];
}

/** A turn, as a quaternion. Three axes, because the owner asked for three. */
export interface PropTurn {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** What placing a prop needs to ask of the world. */
export interface PropDeps {
  /**
   * The floor under a point: the room's indoors, the terrain outdoors, null where nothing is under
   * it at all (over a hole, outside the world).
   */
  floorAt(x: number, y: number, z: number): number | null;
  /** Whether a point is inside something solid. */
  solidAt(x: number, y: number, z: number): boolean;
}

/** Where a prop would stand and whether it may. */
export interface PropVerdict {
  ok: boolean;
  /** Why not, in the game's own words, or null. */
  why: string | null;
  /** How many of its points were inside something, and how many were tested. */
  inside: number;
  of: number;
  /** How far the lowest of its points is above the floor under it; negative is under. */
  clearance: number;
}

/** The identity turn, for a prop nobody has turned yet. */
export const NO_TURN: PropTurn = { x: 0, y: 0, z: 0, w: 1 };

/** A turn about one axis, in radians, composed onto another. Order is the caller's. */
export function turnBy(q: PropTurn, axis: 'x' | 'y' | 'z', radians: number): PropTurn {
  const h = radians / 2;
  const s = Math.sin(h);
  const c = Math.cos(h);
  const r = { x: axis === 'x' ? s : 0, y: axis === 'y' ? s : 0, z: axis === 'z' ? s : 0, w: c };
  // r * q: the new turn is applied in the world's frame, which is what a player pressing a key means
  // -- "turn it left" is about the world's up however the thing is already lying.
  return {
    x: r.w * q.x + r.x * q.w + r.y * q.z - r.z * q.y,
    y: r.w * q.y - r.x * q.z + r.y * q.w + r.z * q.x,
    z: r.w * q.z + r.x * q.y - r.y * q.x + r.z * q.w,
    w: r.w * q.w - r.x * q.x - r.y * q.y - r.z * q.z,
  };
}

/** A point turned by a quaternion and moved: the standard rotation, written out. */
export function applyTurn(q: PropTurn, p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const { x, y, z } = p;
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return {
    x: x + q.w * tx + q.y * tz - q.z * ty,
    y: y + q.w * ty + q.z * tx - q.x * tz,
    z: z + q.w * tz + q.x * ty - q.y * tx,
  };
}

/**
 * The points a prop is judged by: its box's eight corners and its middle, turned and moved to where
 * it would stand.
 *
 * The corners and not a grid, because the two questions are "is any of it above the floor" and "is
 * most of it inside something", and a box's corners answer both for anything convex enough to be
 * furniture. The middle is in so that a thing whose corners all miss a pillar it is standing in is
 * still caught.
 */
export function propPoints(box: PropBox | null, at: { x: number; y: number; z: number }, q: PropTurn): { x: number; y: number; z: number }[] {
  if (!box) return [at];
  const out: { x: number; y: number; z: number }[] = [];
  for (const cx of [box.min[0], box.max[0]]) {
    for (const cy of [box.min[1], box.max[1]]) {
      for (const cz of [box.min[2], box.max[2]]) {
        const p = applyTurn(q, { x: cx, y: cy, z: cz });
        out.push({ x: at.x + p.x, y: at.y + p.y, z: at.z + p.z });
      }
    }
  }
  const mid = applyTurn(q, { x: (box.min[0] + box.max[0]) / 2, y: (box.min[1] + box.max[1]) / 2, z: (box.min[2] + box.max[2]) / 2 });
  out.push({ x: at.x + mid.x, y: at.y + mid.y, z: at.z + mid.z });
  return out;
}

/**
 * Whether a prop may stand where it is, and why not.
 *
 * The two rules and nothing else. A world that cannot answer where the floor is (`floorAt` null
 * everywhere, which is what a node test with no world hands back) forgives the first rule rather
 * than refusing on it: refusing a thing because the game does not know is the wrong way round.
 */
export function propVerdict(box: PropBox | null, at: { x: number; y: number; z: number }, q: PropTurn, deps: PropDeps, tune = PROP_TUNE): PropVerdict {
  const points = propPoints(box, at, q);
  let inside = 0;
  for (const p of points) if (deps.solidAt(p.x, p.y, p.z)) inside++;
  // How far the lowest point is above whatever is under it. Only the points the world can answer
  // for count, so a thing hanging over the edge of the world is judged by the part that is on it.
  let clearance = Infinity;
  let answered = 0;
  for (const p of points) {
    const floor = deps.floorAt(p.x, p.y, p.z);
    if (floor === null) continue;
    answered++;
    const above = p.y - floor;
    if (above < clearance) clearance = above;
  }
  if (!answered) clearance = 0;
  // Buried: every point of it under the floor, which is a thing nobody could ever see.
  let under = 0;
  for (const p of points) {
    const floor = deps.floorAt(p.x, p.y, p.z);
    if (floor !== null && p.y < floor) under++;
  }
  if (answered && under === points.length) return { ok: false, why: 'it would be buried', inside, of: points.length, clearance };
  if (inside / points.length >= tune.buriedShare) return { ok: false, why: 'it is inside a wall', inside, of: points.length, clearance };
  return { ok: true, why: null, inside, of: points.length, clearance };
}

/** One notch of the wheel: how far ahead the thing is held, kept between `near` and `far`. */
export function pushBy(reach: number, notches: number, tune = PROP_TUNE): number {
  return Math.min(tune.far, Math.max(tune.near, reach + notches * tune.step));
}

/** One press of a height key, kept within `most` either way and on the step. */
export function liftBy(lift: number, presses: number, tune = PROP_TUNE): number {
  const next = lift + presses * tune.rise;
  return Math.min(tune.most, Math.max(-tune.most, Math.round(next / tune.rise) * tune.rise));
}

/**
 * The spot a prop is held at: ahead of the player along the way they face.
 *
 * `heading`'s forward is `(sin, cos)`. It is written out here rather than taken from the camera for
 * the reason the house's own placement learned the hard way: the camera's yaw is the opposite, and a
 * ghost placed with it appears behind you.
 */
export function propSpot(from: { x: number; y: number; z: number }, heading: number, reach: number): { x: number; y: number; z: number } {
  return { x: from.x + Math.sin(heading) * reach, y: from.y, z: from.z + Math.cos(heading) * reach };
}
