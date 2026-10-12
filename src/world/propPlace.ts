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
  /**
   * How far one notch of the wheel moves it, metres. How far a held key turns or lifts it, and the grid
   * the wheel steps to while one is held, are `PLACE_HOLD_TUNE`'s (`placeHold.ts`).
   */
  step: 0.25,
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
  /**
   * What of the world's own a circle of `r` metres about (x, z) would stand on, by name, or null: a
   * permanent placement round which a player's own thing may not stand (`PermanentLayer.guardedAt`). Absent,
   * nothing is guarded, which is a permanent layer's own editing.
   */
  reserved?(x: number, z: number, r: number): string | null;
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

/**
 * A turn of `radians` about the unit axis `(ax, ay, az)` in the world, composed onto `q`, written into
 * `out` (a fresh record without one; `q` itself may be handed as `out`).
 *
 * `r * q`: the new turn is applied in the world's frame, which is what a player turning it means --
 * "turn it left" is about the world's up, and "tip it away from me" about the view's own across axis,
 * however the thing is already lying.
 */
export function turnAbout(q: PropTurn, ax: number, ay: number, az: number, radians: number, out?: PropTurn): PropTurn {
  const h = radians / 2;
  const s = Math.sin(h);
  const rw = Math.cos(h);
  const rx = ax * s;
  const ry = ay * s;
  const rz = az * s;
  const x = rw * q.x + rx * q.w + ry * q.z - rz * q.y;
  const y = rw * q.y - rx * q.z + ry * q.w + rz * q.x;
  const z = rw * q.z + rx * q.y - ry * q.x + rz * q.w;
  const w = rw * q.w - rx * q.x - ry * q.y - rz * q.z;
  const o = out ?? { x: 0, y: 0, z: 0, w: 1 };
  o.x = x;
  o.y = y;
  o.z = z;
  o.w = w;
  return o;
}

/** A turn about one of the world's own axes, in radians, composed onto another (`turnAbout`). */
export function turnBy(q: PropTurn, axis: 'x' | 'y' | 'z', radians: number): PropTurn {
  return turnAbout(q, axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0, radians);
}

/** A point turned by a quaternion: the standard rotation, written out, into `out` when one is handed over. */
export function applyTurn(q: PropTurn, p: { x: number; y: number; z: number }, out?: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const { x, y, z } = p;
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  const o = out ?? { x: 0, y: 0, z: 0 };
  o.x = x + q.w * tx + q.y * tz - q.z * ty;
  o.y = y + q.w * ty + q.z * tx - q.x * tz;
  o.z = z + q.w * tz + q.x * ty - q.y * tx;
  return o;
}

/** A point of a turn's own, kept for the two readings below. */
const AXIS = { x: 0, y: 0, z: 0 };
const TURNED = { x: 0, y: 0, z: 0 };

/**
 * Which way a turned thing faces, in radians, three's sense (the yaw `rotation.set(0, yaw, 0)` would
 * give): the heading of its own +Z laid flat on the ground, or of its own +X less a quarter turn where
 * the thing lies with +Z straight up or down. Turning it about the world's up moves this by exactly
 * that turn, so it is what the wheel steps along the grid and what the bar reads out.
 */
export function spinOf(q: PropTurn): number {
  AXIS.x = 0;
  AXIS.y = 0;
  AXIS.z = 1;
  const z = applyTurn(q, AXIS, TURNED);
  if (Math.hypot(z.x, z.z) > 1e-6) return Math.atan2(z.x, z.z);
  AXIS.x = 1;
  AXIS.z = 0;
  const x = applyTurn(q, AXIS, TURNED);
  return Math.atan2(x.x, x.z) - Math.PI / 2;
}

/** How far a turned thing's own up stands off the world's, in radians: 0 upright, a quarter turn on its side. */
export function tiltOf(q: PropTurn): number {
  AXIS.x = 0;
  AXIS.y = 1;
  AXIS.z = 0;
  const up = applyTurn(q, AXIS, TURNED);
  return Math.acos(Math.max(-1, Math.min(1, up.y)));
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
export function propPoints(box: PropBox | null, at: { x: number; y: number; z: number }, q: PropTurn, out: { x: number; y: number; z: number }[] = []): { x: number; y: number; z: number }[] {
  if (!box) {
    const p = out[0] ?? (out[0] = { x: 0, y: 0, z: 0 });
    p.x = at.x;
    p.y = at.y;
    p.z = at.z;
    out.length = 1;
    return out;
  }
  let n = 0;
  for (let i = 0; i < 8; i++) {
    LOCAL.x = i & 4 ? box.max[0] : box.min[0];
    LOCAL.y = i & 2 ? box.max[1] : box.min[1];
    LOCAL.z = i & 1 ? box.max[2] : box.min[2];
    pointAt(out, n++, q, at);
  }
  LOCAL.x = (box.min[0] + box.max[0]) / 2;
  LOCAL.y = (box.min[1] + box.max[1]) / 2;
  LOCAL.z = (box.min[2] + box.max[2]) / 2;
  pointAt(out, n++, q, at);
  out.length = n;
  return out;
}

/** A point of the thing's own frame, written by `propPoints` before it is turned. */
const LOCAL = { x: 0, y: 0, z: 0 };

/** `LOCAL` turned and carried to `at`, into the `i`th record of `out`, made the first time only. */
function pointAt(out: { x: number; y: number; z: number }[], i: number, q: PropTurn, at: { x: number; y: number; z: number }): void {
  const p = applyTurn(q, LOCAL, out[i] ?? (out[i] = { x: 0, y: 0, z: 0 }));
  p.x += at.x;
  p.y += at.y;
  p.z += at.z;
}

/**
 * Whether a prop may stand where it is, and why not.
 *
 * The two rules and nothing else. A world that cannot answer where the floor is (`floorAt` null
 * everywhere, which is what a node test with no world hands back) forgives the first rule rather
 * than refusing on it: refusing a thing because the game does not know is the wrong way round.
 */
export function propVerdict(box: PropBox | null, at: { x: number; y: number; z: number }, q: PropTurn, deps: PropDeps, tune = PROP_TUNE, out?: PropVerdict): PropVerdict {
  const points = propPoints(box, at, q, POINTS);
  // Part of the world first: whatever else is true of the spot, a thing of the world's own is under it, and
  // that is what the player needs to be told. The circle is the thing's own reach on the ground.
  const taken = deps.reserved?.(at.x, at.z, box ? Math.max(Math.abs(box.max[0] - box.min[0]), Math.abs(box.max[2] - box.min[2])) / 2 : 0) ?? null;
  if (taken !== null) return said(out, false, partOfWorld(taken), 0, points.length, 0);
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
  const of = points.length;
  if (answered && under === of) return said(out, false, 'it would be buried', inside, of, clearance);
  if (inside / of >= tune.buriedShare) return said(out, false, 'it is inside a wall', inside, of, clearance);
  return said(out, true, null, inside, of, clearance);
}

/** The points `propVerdict` judges by, kept: it reads them into numbers before it hands anything back. */
const POINTS: { x: number; y: number; z: number }[] = [];

/** The last refusal for something of the world's own, kept so a thing held over one makes no new words a frame. */
let partName = '';
let partWhy = '';

/** "that is part of this world (<name>)", made once a name rather than once a frame. */
function partOfWorld(name: string): string {
  if (name !== partName) {
    partName = name;
    partWhy = `that is part of this world (${name})`;
  }
  return partWhy;
}

/** `propVerdict`'s answer, written into `out` when the caller keeps one (the frame does), else a new record. */
function said(out: PropVerdict | undefined, ok: boolean, why: string | null, inside: number, of: number, clearance: number): PropVerdict {
  if (!out) return { ok, why, inside, of, clearance };
  out.ok = ok;
  out.why = why;
  out.inside = inside;
  out.of = of;
  out.clearance = clearance;
  return out;
}

/** One notch of the wheel: how far ahead the thing is held, kept between `near` and `far`. */
export function pushBy(reach: number, notches: number, tune = PROP_TUNE): number {
  return Math.min(tune.far, Math.max(tune.near, reach + notches * tune.step));
}

/**
 * How far it is lifted or dropped from where the ground put it, as a held key or a wheel step asks:
 * kept within `most` either way and to the centimetre. Nothing else rounds it, so a slow hand's few
 * millimetres a frame are kept by whoever holds the unrounded value (`App`'s hold) and add up.
 */
export function liftTo(value: number, tune = PROP_TUNE): number {
  const v = Math.min(tune.most, Math.max(-tune.most, value));
  return Math.round(v * 100) / 100;
}

/**
 * The spot a prop is held at: ahead of the player along the way they face, written into `out` when
 * one is handed over.
 *
 * `heading`'s forward is `(sin, cos)`: a body's heading, which the game works out from the camera's
 * own direction in the world. The camera's own yaw is the opposite of it, and a ghost placed with that
 * appears behind you, which is what the house's own placement learned the hard way.
 */
export function propSpot(from: { x: number; y: number; z: number }, heading: number, reach: number, out?: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const o = out ?? { x: 0, y: 0, z: 0 };
  o.x = from.x + Math.sin(heading) * reach;
  o.y = from.y;
  o.z = from.z + Math.cos(heading) * reach;
  return o;
}
