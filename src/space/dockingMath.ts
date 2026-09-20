// Docking at a station: the lanes the client's own hulls carry, the path a ship flies along one, the
// pose it comes to rest in at the dock, and the drive that flies it there.
//
// What the client's files hold is a set of hardpoints per hull: a `dock_<lane>`, a `dockradius_<lane>`
// beside it, and numbered `approach_<lane>_<n>` and `exit_<lane>_<n>` points. There is no docking
// procedure anywhere in the client, so the order a lane is flown in, the speeds, and everything below
// that is called INVENTED is ours.
//
// Three things about that data cost a rule each, and all three were read off the converted packs
// rather than assumed:
//   - **A dock's own forward is not the way in.** It is the way a ship parked there faces. On two of
//     the five hulls that carry lanes it happens to agree with the direction of travel down the lane;
//     on the others it stands square across it or thereabouts. So the way in is always taken from the
//     lane's own points (the last of them to the dock) and never from the dock hardpoint, and
//     `DOCK_FACE` decides what the parked ship faces.
//   - **The numbers on the points are not an order.** One hull's letter holds two whole corridors
//     under one set of numbers, with the numbers interleaved between them, and another lane's numbers
//     start at 2. So a lane's points are chained by geometry, outward from the dock, and the numbers
//     are never read as a sequence.
//   - **A lane's letter is not whose corridor it is.** On one hull the corridors of a third dock are
//     filed under the letters of the two beside it, which left that dock looking like a dock with no
//     points at all. So once the points are chained, each corridor is put back on the dock its
//     innermost point is nearest, which gives every dock on every hull a corridor of its own and is
//     what keeps a ship from being parked on a direction borrowed from a neighbour.
//
// Between them those three explain the one attitude that used to flip: a corridor filed under the
// wrong letter stood 138 degrees from that letter's dock, and was parked on by a different rule from
// the corridor beside it. Put back on its own dock it stands at 90 degrees like all the rest.
//
// Pure: no three, no DOM; the node test imports it straight from source. Everything a plan needs is
// worked out once when the dock is asked for; the per-step calls (`laneCruise`, `laneDrive`) fill
// objects the caller owns and allocate nothing.
import { steerToward, toLocal, type Q4, type Stick, type V3 } from './pilot.ts';

/**
 * INVENTED, every one of them: the client flew this on the server and none of it shipped. Live through
 * `__debug.dock({ ... })`.
 * - `ask`: how near a hull with lanes the Dock row lights up (m).
 * - `laneSpeed`: the fastest the autopilot flies a lane (m/s).
 * - `dockSpeed`: the most it carries onto the last leg, the one that ends at the dock (m/s).
 * - `gain`: the cruise it asks for per metre still to fly, inside those two.
 * - `arrive`: how near a lane point counts as reached (m); the dock uses the hull's own dock radius.
 * - `standOff`: how far out a lane with a dock and no points at all is approached and left from (m).
 * - `linkCos`: the sharpest turn one chained link may make against the one before it (a cosine), which
 *   is what keeps two corridors stored under one letter from being chained into each other.
 * - `linkMax`: the longest link between two points of one corridor (m).
 * - `bank`: how far off the nose (rad) the autopilot rolls the point overhead and pulls instead of
 *   steering onto it flat; `steerToward`'s own sense.
 * - `settle`: how long the ease onto the dock pose takes (s).
 * - `repair`: how long the station takes over the repair (s).
 * - `sideCos`: how far round the hull an approach point may lie from the ship's own bearing (both
 *   measured from the hull's own origin) before the lane counts as being on the far side and is not
 *   offered: flown anyway, the straight leg to it would go through the hull. 0 is a right angle.
 * - `approachCos`: how far against the way a corridor is flown a ship may arrive at one of its points
 *   before the lane counts as being entered from the wrong end (a cosine; 0 is a right angle). It is
 *   what stops a ship behind a station from aiming at the near end of a lane that comes in from the
 *   front, which would be a straight line through the station.
 * - `nearLeg`: a leg shorter than this is never refused by either bearing (m): a ship already
 *   alongside the hull is joining the lane where it stands, not crossing anything.
 * - `flyBy`: how far past a lane point counts as flown by once the point has gone behind the nose (m),
 *   so an overshoot goes on to the next point instead of circling this one.
 * - `budget`: the longest a whole approach or launch may take before it is broken off (s).
 * - `faceCos`: how far round the dock hardpoint's own turn may face from the way in before it is
 *   taken for a mistake and the lane's direction is used instead (a cosine; -0.7 is about 135
 *   degrees). On the hulls the game shipped, once each corridor is put back on the dock it belongs to,
 *   the two are between 9 and 100 degrees apart -- a dock in a row of parking bays stands square
 *   across its lane -- so the game's own turn is what every retail ship parks on, and this only
 *   catches a dock that faces back out the way the ship flew in.
 */
export const DOCK_TUNE = {
  ask: 1500,
  laneSpeed: 90,
  dockSpeed: 14,
  gain: 0.5,
  arrive: 20,
  standOff: 150,
  linkCos: 0.5,
  linkMax: 900,
  bank: 1.2,
  settle: 1.5,
  repair: 4,
  sideCos: 0,
  approachCos: 0,
  nearLeg: 120,
  flyBy: 80,
  budget: 90,
  faceCos: -0.7,
};

/**
 * Which way a ship parked at a dock faces. 'auto' takes the dock hardpoint's own turn unless it faces
 * back out the way the ship flew in (further round than `faceCos`), where it takes the lane's own
 * direction instead, so a ship can never end an approach by flipping end for end on the spot.
 * 'hardpoint' always takes the game's own turn, 'lane' always the way it flew in. Live through
 * `__debug.dock({ face: 'lane' })`.
 */
export const DOCK_FACE: { rule: 'auto' | 'hardpoint' | 'lane' } = { rule: 'auto' };

/** A lane's dock radius when the hull carries no `dockradius` point beside its dock (m, INVENTED). */
export const DOCK_RADIUS_DEFAULT = 20;

/** A point on a lane, as the pack writes it: `at` and `forward` in the model's frame, `q` as [w, x, y, z]. */
export interface LanePointLike {
  readonly at: readonly number[];
  readonly q: readonly number[];
  readonly forward: readonly number[];
}

export interface LaneStepLike extends LanePointLike {
  readonly n: number;
  readonly fromDock: number | null;
}

/** One lane of a model, as the pack writes it. */
export interface DockLaneLike {
  readonly lane: string;
  readonly dock: LanePointLike | null;
  readonly dockRadius: number | null;
  readonly approach: readonly LaneStepLike[];
  readonly exit: readonly LaneStepLike[];
}

/** One corridor of a lane: its points in order, the one nearest the dock first. */
export interface LaneWay {
  points: V3[];
  /** True when nothing in the files drew this corridor and it was made up from the lane's neighbours. */
  guessed: boolean;
}

/** A lane worked out: where its dock is, how it is faced, and the corridors in and out of it. */
export interface LanePlan {
  lane: string;
  dock: V3;
  /** The dock hardpoint's own turn, [x, y, z, w] as everything else here keeps a quaternion. */
  dockQ: Q4;
  radius: number;
  in: LaneWay[];
  out: LaneWay[];
  /** The lane carries a dock and no points at all: both corridors were made up. */
  bare: boolean;
}

/** A lane picked and a course through it: the points to fly in order, the dock last on the way in. */
export interface LaneRun {
  lane: string;
  points: V3[];
  /** The way this course is flown: in ends at the dock, out ends in open space. */
  out: boolean;
  /** No point of this lane can be reached from where the ship stands without crossing the hull. */
  blocked: boolean;
}

/** The drive an autopilot hands the flight code; the same shape a pilot's keys fill. */
export interface LaneDrive {
  throttle: number;
  steer: number;
  heading: null;
  boost: boolean;
  hop: boolean;
  up: boolean;
  down: boolean;
  stickX: number;
  stickY: number;
  cruise: number;
}

/** A drive object in its resting state, for a caller that keeps one. */
export function newLaneDrive(): LaneDrive {
  return { throttle: 0, steer: 0, heading: null, boost: false, hop: false, up: false, down: false, stickX: 0, stickY: 0, cruise: 0 };
}

const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
const at3 = (a: readonly number[]): V3 => v3(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);

function sub(a: V3, b: V3, out: V3): V3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

function len(a: V3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function norm(a: V3, out: V3): V3 {
  const l = len(a);
  out.x = l > 1e-9 ? a.x / l : 0;
  out.y = l > 1e-9 ? a.y / l : 0;
  out.z = l > 1e-9 ? a.z / l : 0;
  return out;
}

function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: V3, b: V3, out: V3): V3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/** The pack keeps a turn as [w, x, y, z]; everything here keeps one as {x, y, z, w}. */
export function packQuat(q: readonly number[]): Q4 {
  return { w: q[0] ?? 1, x: q[1] ?? 0, y: q[2] ?? 0, z: q[3] ?? 0 };
}

/** A vector turned by a quaternion, into `out`. */
export function turn(q: Q4, v: V3, out: V3): V3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  const x = v.x + q.w * tx + (q.y * tz - q.z * ty);
  const y = v.y + q.w * ty + (q.z * tx - q.x * tz);
  const z = v.z + q.w * tz + (q.x * ty - q.y * tx);
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

const bx = v3();
const by = v3();
const bz = v3();

/**
 * The turn whose nose (+Z) is `forward` and whose up is as near `up` as that allows, into `out`. A
 * degenerate pair (the two in line) falls back to any up square to the nose, so nothing ever comes out
 * as a zero quaternion.
 */
export function quatFromForwardUp(forward: V3, up: V3, out: Q4): Q4 {
  norm(forward, bz);
  if (len(bz) < 0.5) bz.z = 1;
  cross(up, bz, bx);
  if (len(bx) < 1e-6) {
    // Up and the nose in line: any square direction will do, and the two axes tried cannot both fail.
    cross({ x: 0, y: 1, z: 0 }, bz, bx);
    if (len(bx) < 1e-6) cross({ x: 1, y: 0, z: 0 }, bz, bx);
  }
  norm(bx, bx);
  cross(bz, bx, by);
  norm(by, by);
  // The usual matrix-to-quaternion, on the basis (right, up, nose).
  const m00 = bx.x;
  const m10 = bx.y;
  const m20 = bx.z;
  const m01 = by.x;
  const m11 = by.y;
  const m21 = by.z;
  const m02 = bz.x;
  const m12 = bz.y;
  const m22 = bz.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out.w = 0.25 / s;
    out.x = (m21 - m12) * s;
    out.y = (m02 - m20) * s;
    out.z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    out.w = (m21 - m12) / s;
    out.x = 0.25 * s;
    out.y = (m01 + m10) / s;
    out.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    out.w = (m02 - m20) / s;
    out.x = (m01 + m10) / s;
    out.y = 0.25 * s;
    out.z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    out.w = (m10 - m01) / s;
    out.x = (m02 + m20) / s;
    out.y = (m12 + m21) / s;
    out.z = 0.25 * s;
  }
  return out;
}

interface Node {
  p: V3;
  d: number;
  used: boolean;
}

const step = v3();
const dir = v3();
const last = v3();

/**
 * A lane's points chained into corridors, each one ordered from the dock outward. The chain starts at
 * whichever unused point is nearest the dock and walks outward, taking at each turn the nearest unused
 * point further out that lies within `linkMax` and turns no harder than `linkCos` against the link
 * before it; when nothing qualifies the corridor ends and the next one starts. That is what separates
 * two corridors stored under one letter, whose points are interleaved by distance and would otherwise
 * chain into a zig-zag across the hull.
 *
 * A single stray point (one hull leaves the outer point of a neighbouring corridor in the wrong lane)
 * is dropped when the lane has a corridor of three or more: flown on its own it would cut across the
 * hull to the dock.
 */
export function chainWays(dock: V3, steps: readonly LaneStepLike[], tune = DOCK_TUNE): LaneWay[] {
  const nodes: Node[] = [];
  for (const s of steps) {
    const p = at3(s.at);
    nodes.push({ p, d: len(sub(p, dock, step)), used: false });
  }
  nodes.sort((a, b) => a.d - b.d);
  const ways: LaneWay[] = [];
  for (;;) {
    const start = nodes.find((n) => !n.used);
    if (!start) break;
    start.used = true;
    const points = [start.p];
    norm(sub(start.p, dock, step), dir);
    last.x = start.p.x;
    last.y = start.p.y;
    last.z = start.p.z;
    let from = start.d;
    for (;;) {
      let best: Node | null = null;
      let bestLen = Infinity;
      for (const n of nodes) {
        // Outward only, and never back past a point already flown: a corridor leaves the hull.
        if (n.used || n.d < from) continue;
        const l = len(sub(n.p, last, step));
        if (l > tune.linkMax || l >= bestLen || l < 1e-6) continue;
        norm(step, step);
        if (dot(step, dir) < tune.linkCos) continue;
        best = n;
        bestLen = l;
      }
      if (!best) break;
      best.used = true;
      norm(sub(best.p, last, step), dir);
      last.x = best.p.x;
      last.y = best.p.y;
      last.z = best.p.z;
      from = best.d;
      points.push(best.p);
    }
    ways.push({ points, guessed: false });
  }
  const longest = ways.reduce((m, w) => Math.max(m, w.points.length), 0);
  return longest >= 3 ? ways.filter((w) => w.points.length > 1) : ways;
}

/** The unit direction a corridor is flown in (toward the dock for a way in, away for a way out). */
function wayDirection(way: LaneWay, dock: V3, inward: boolean, out: V3): V3 {
  const near = way.points[0];
  return inward ? norm(sub(dock, near, out), out) : norm(sub(near, dock, out), out);
}

/**
 * Every corridor of one kind on a model put back on the dock its innermost point is nearest. The
 * client files a corridor under a lane letter, and on one hull the letters and the docks disagree:
 * two of its letters carry a third dock's corridors as well as their own, which left that dock with no
 * points and had a ship parked at it on a direction borrowed from a neighbour. The innermost point of
 * a corridor sits a few tens of metres off the dock it serves and several times that off any other, so
 * "nearest dock" separates them with room to spare on every hull the game shipped.
 */
function regroup(plans: LanePlan[], key: 'in' | 'out'): void {
  if (plans.length < 2) return;
  const all: LaneWay[] = [];
  for (const p of plans) {
    for (const w of p[key]) all.push(w);
    p[key] = [];
  }
  for (const w of all) {
    const near = w.points[0];
    if (!near) continue;
    let best = plans[0];
    let bestD = Infinity;
    for (const p of plans) {
      const d = len(sub(near, p.dock, step));
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    best[key].push(w);
  }
  // Each dock's corridors back in order, the one whose innermost point is nearest it first.
  for (const p of plans) p[key].sort((a, b) => len(sub(a.points[0], p.dock, step)) - len(sub(b.points[0], p.dock, step)));
}

/**
 * Each of a model's lanes worked out. A lane with no dock is dropped: there is nowhere to put a ship.
 * The chained corridors are put back on the docks they belong to (`regroup`), and only then is a lane
 * that still has no points at all treated as bare: it borrows the mean direction of its neighbours'
 * corridors and is approached and left along it from `standOff` metres out; with no neighbours to
 * borrow from, it falls back to the dock hardpoint's own forward, which is the one case where that is
 * trusted, and the corridor says it was guessed. On the retail hulls nothing is bare once the
 * corridors are back where they belong.
 */
export function lanesOf(lanes: readonly DockLaneLike[], tune = DOCK_TUNE): LanePlan[] {
  const out: LanePlan[] = [];
  for (const l of lanes) {
    if (!l.dock) continue;
    const dock = at3(l.dock.at);
    const plan: LanePlan = {
      lane: l.lane,
      dock,
      dockQ: packQuat(l.dock.q),
      radius: l.dockRadius && l.dockRadius > 0 ? l.dockRadius : DOCK_RADIUS_DEFAULT,
      in: chainWays(dock, l.approach, tune),
      out: chainWays(dock, l.exit, tune),
      bare: false,
    };
    out.push(plan);
  }
  regroup(out, 'in');
  regroup(out, 'out');
  // The mean of every real corridor's direction on this model, which a bare dock borrows.
  const meanIn = v3();
  const meanOut = v3();
  const d = v3();
  for (const p of out) {
    for (const w of p.in) {
      wayDirection(w, p.dock, true, d);
      meanIn.x += d.x;
      meanIn.y += d.y;
      meanIn.z += d.z;
    }
    for (const w of p.out) {
      wayDirection(w, p.dock, false, d);
      meanOut.x += d.x;
      meanOut.y += d.y;
      meanOut.z += d.z;
    }
  }
  const haveIn = len(meanIn) > 1e-6;
  const haveOut = len(meanOut) > 1e-6;
  norm(meanIn, meanIn);
  norm(meanOut, meanOut);
  for (const p of out) {
    if (p.in.length && p.out.length) continue;
    p.bare = !p.in.length && !p.out.length;
    if (!p.in.length) {
      // The way in runs backward from the dock: the ship starts `standOff` out along it and flies down it.
      const back = haveIn ? { x: -meanIn.x, y: -meanIn.y, z: -meanIn.z } : turn(p.dockQ, { x: 0, y: 0, z: -1 }, v3());
      p.in.push({ points: [v3(p.dock.x + back.x * tune.standOff, p.dock.y + back.y * tune.standOff, p.dock.z + back.z * tune.standOff)], guessed: true });
    }
    if (!p.out.length) {
      const away = haveOut ? meanOut : haveIn ? { x: -meanIn.x, y: -meanIn.y, z: -meanIn.z } : turn(p.dockQ, { x: 0, y: 0, z: -1 }, v3());
      p.out.push({ points: [v3(p.dock.x + away.x * tune.standOff, p.dock.y + away.y * tune.standOff, p.dock.z + away.z * tune.standOff)], guessed: true });
    }
  }
  return out;
}

const pick = v3();
const legTo = v3();
const inward = v3();

/**
 * Whether a straight leg from the ship to this point of a lane keeps clear of the hull. There is no
 * collision shape in a pack -- a placed object gives a place, a turn and a bounding radius, and the
 * hull itself is streamed -- so this is two bearings rather than a trace, and both are measured in the
 * model's own frame, whose origin is inside the hull:
 *   - the point must be on the ship's own side of the hull (no more than `sideCos` round from it). The
 *     capital ship is 1.6 km long and every one of its four lanes is at its tail, so a ship off its
 *     nose was being sent 1300 m straight down the hull at lane speed.
 *   - the leg must not arrive at the point against the way the corridor is flown (`approachCos`),
 *     which is what a ship standing behind a station and aiming at the near end of a lane that comes
 *     in from the front would do: straight through the station.
 * A leg shorter than `nearLeg` is kept whatever the bearings say: a ship already alongside the hull is
 * joining the lane where it stands, not crossing anything.
 */
export function legClear(from: V3, entry: V3, inward: V3 | null, tune = DOCK_TUNE): boolean {
  const legLen = len(sub(entry, from, legTo));
  if (legLen <= tune.nearLeg) return true;
  const fl = len(from);
  const el = len(entry);
  if (fl > 1e-3 && el > 1e-3 && dot(from, entry) / (fl * el) < tune.sideCos) return false;
  if (!inward || legLen < 1e-3) return true;
  return dot(legTo, inward) / legLen >= tune.approachCos;
}

/**
 * The course into a dock from where the ship stands (both in the model's frame): the lane's corridor
 * whose nearest point is nearest the ship, entered at that point and flown inward, the dock last. Only
 * a point the ship can reach without crossing the hull (`legClear`) is entered at; with none of them
 * reachable the run comes back `blocked` and empty, and the pilot is told to come round to the docks
 * rather than flown through the station.
 *
 * Entering at the nearest reachable point rather than always at the far end is ours: a ship already
 * alongside the hull would otherwise fly half a kilometre out to start the lane from its end.
 */
export function approachRun(plan: LanePlan, from: V3, out: LaneRun, tune = DOCK_TUNE): LaneRun {
  out.lane = plan.lane;
  out.out = false;
  out.blocked = false;
  out.points.length = 0;
  let bestWay: LaneWay | null = null;
  let bestAt = 0;
  let bestD = Infinity;
  for (const w of plan.in) {
    for (let i = 0; i < w.points.length; i++) {
      const d = len(sub(w.points[i], from, pick));
      if (d >= bestD) continue;
      // The way the lane goes on from this point: the next point inward, or the dock at the innermost.
      norm(sub(i > 0 ? w.points[i - 1] : plan.dock, w.points[i], inward), inward);
      if (!legClear(from, w.points[i], inward, tune)) continue;
      bestD = d;
      bestWay = w;
      bestAt = i;
    }
  }
  if (!bestWay) {
    out.blocked = true;
    return out;
  }
  for (let i = bestAt; i >= 0; i--) out.points.push(bestWay.points[i]);
  out.points.push(plan.dock);
  return out;
}

/**
 * The course out of a dock: the corridor out whose innermost point is nearest the dock (one hull files
 * two docks' exits under one letter, and half the launches would otherwise be flown out of the other
 * dock's corridor), flown from the dock outward.
 */
export function exitRun(plan: LanePlan, out: LaneRun): LaneRun {
  out.lane = plan.lane;
  out.out = true;
  out.blocked = false;
  out.points.length = 0;
  let way: LaneWay | null = null;
  let bestD = Infinity;
  for (const w of plan.out) {
    const near = w.points[0];
    if (!near) continue;
    const d = len(sub(near, plan.dock, pick));
    if (d >= bestD) continue;
    bestD = d;
    way = w;
  }
  if (way) for (const p of way.points) out.points.push(p);
  out.blocked = !out.points.length;
  return out;
}

/**
 * Where a ship rests at the dock, in the model's frame: at the dock point, faced by `DOCK_FACE`. The
 * lane's own direction is the last leg of the course in; the hardpoint's is its turn's nose. Its up is
 * always the hardpoint's, so a ship parks in the plane the hull's designers drew.
 */
export function dockPose(plan: LanePlan, run: LaneRun, outPos: V3, outQ: Q4, tune = DOCK_TUNE): void {
  outPos.x = plan.dock.x;
  outPos.y = plan.dock.y;
  outPos.z = plan.dock.z;
  const hard = turn(plan.dockQ, { x: 0, y: 0, z: 1 }, v3());
  const up = turn(plan.dockQ, { x: 0, y: 1, z: 0 }, v3());
  const before = run.points.length >= 2 ? run.points[run.points.length - 2] : null;
  const lane = before ? norm(sub(plan.dock, before, v3()), v3()) : hard;
  const rule = DOCK_FACE.rule;
  const use = rule === 'hardpoint' ? hard : rule === 'lane' ? lane : dot(hard, lane) > tune.faceCos ? hard : lane;
  quatFromForwardUp(use, up, outQ);
}

/** How near a point of the course counts as reached: the hull's own dock radius at the dock, `arrive` before it. */
export function reached(distance: number, last: boolean, radius: number, tune = DOCK_TUNE): boolean {
  return distance <= (last ? radius : tune.arrive);
}

const nose = v3();
const past = v3();

/**
 * Whether a point of the course has been flown by: it has gone behind the nose and is no further off
 * than `flyBy`. A hull with inertia turning at lane speed has a turning circle far wider than the
 * arrival distance, so a point missed by a few metres would otherwise be circled for ever; past it,
 * the course goes on to the next point rather than turning back. The point at the dock is never flown
 * by -- arriving there is the whole errand -- so the caller passes `last` false for it.
 */
export function flownBy(pos: V3, q: Q4, to: V3, distance: number, tune = DOCK_TUNE): boolean {
  if (distance > tune.flyBy) return false;
  turn(q, { x: 0, y: 0, z: 1 }, nose);
  return dot(sub(to, pos, past), nose) < 0;
}

/**
 * The cruise the autopilot asks for with `distance` metres to the next point of the course. It eases
 * down by distance, is never faster than the lane's own speed, and on the leg that ends at the dock
 * never faster than the dock speed, so nothing arrives at the hull with speed to shed. A launch's last
 * leg ends in open space, so it is not one of those: the ship is handed back at the lane's own speed
 * rather than crawling out of the corridor.
 */
export function laneCruise(distance: number, last: boolean, tune = DOCK_TUNE): number {
  const top = last ? tune.dockSpeed : tune.laneSpeed;
  const want = distance * tune.gain;
  return Math.max(0, Math.min(top, want));
}

const toPoint = v3();
const local = v3();
const stick: Stick = { x: 0, y: 0, roll: 0 };

/**
 * The drive that flies a ship at `pos` facing `q` toward `to`, at `cruise`. The stick is the NPC
 * pilots' own (`steerToward`), so the lane is flown by the same flight code a pilot's mouse drives,
 * and nothing here is allocated. With the point all but underfoot the stick is left in the middle
 * rather than swinging at a direction with no length.
 */
export function laneDrive(pos: V3, q: Q4, to: V3, cruise: number, out: LaneDrive, tune = DOCK_TUNE): LaneDrive {
  out.throttle = 0;
  out.boost = false;
  out.hop = false;
  out.up = false;
  out.down = false;
  out.heading = null;
  out.cruise = cruise;
  sub(to, pos, toPoint);
  if (len(toPoint) < 1e-3) {
    out.stickX = 0;
    out.stickY = 0;
    out.steer = 0;
    return out;
  }
  toLocal(q, toPoint, local);
  steerToward(local, tune.bank, null, stick);
  out.stickX = stick.x;
  out.stickY = stick.y;
  out.steer = stick.roll;
  return out;
}

/** The ease onto the dock pose, 0 to 1: still at both ends, the landing's own curve. */
export function settleEase(t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k * k * (3 - 2 * k);
}

/**
 * Who holds each lane. It is local today: one browser, one ship. The shape is the one a server will
 * answer with, so the call site does not change when it becomes a request -- `claim` grants or refuses,
 * and `release` gives back everything one owner holds.
 */
export class LaneClaims {
  private readonly held = new Map<string, string>();

  /** `${target}|${lane}`, the key a claim is made under. */
  static key(target: string, lane: string): string {
    return `${target}|${lane}`;
  }

  /** Granted, or refused because someone else holds it. Claiming what you already hold is granted. */
  claim(key: string, by: string): boolean {
    const who = this.held.get(key);
    if (who !== undefined && who !== by) return false;
    this.held.set(key, by);
    return true;
  }

  holder(key: string): string | null {
    return this.held.get(key) ?? null;
  }

  free(key: string, by: string): boolean {
    const who = this.held.get(key);
    return who === undefined || who === by;
  }

  /** Everything this owner holds, given back (a dock broken off, a ship disposed, a zone left). */
  release(by: string): void {
    for (const [k, who] of this.held) if (who === by) this.held.delete(k);
  }

  clear(): void {
    this.held.clear();
  }

  get count(): number {
    return this.held.size;
  }
}

// ---------------------------------------------------------------------------------------------------
// One ship clamped onto another
//
// A station's lanes are the client's own; nothing of this is. The client has no ship-to-ship docking at
// all -- no hardpoint names it, no table holds it, and the one `canDock` string in the executable is
// read by nothing the archives carry -- so every rule and every number below is ours, and each says so.
//
// A clamped ship is not simulated in the carrier's frame: it is written to a pose in that frame before
// every step and ghosted, which is why it is the light form of carrying a ship. Everything here is pure
// and fills objects the caller owns.

/**
 * INVENTED, every one of them: see the note above. Live through `__debug.dock({ clamp: { ... } })`,
 * under `clamp` because the station's own numbers have an `ask` and a `settle` of their own.
 * - `ask`: how near the clamp spot a ship may ask to be carried (m).
 * - `carrier`: how many times the asking ship's longest side the carrier's must be. Two, so a fighter
 *   rides a freighter and nothing rides its own size.
 * - `slow`: the fastest the asking ship may be going when it asks (m/s), so a clamp is a manoeuvre
 *   rather than a collision.
 * - `settle`: how long the ease onto the clamp spot takes (s).
 * - `gap`: how far the carried hull's belly stands off the carrier's skin (m). It is a clamp, not a
 *   landing: the gap is what the arms would be.
 * - `clear`: how many of the carried ship's own radii clear of the carrier's it must be before its
 *   colliders come back, so an undock never ends with the two wedged together.
 * - `push`: how fast an undock leaves along the carrier's own up (m/s), on top of the carrier's motion.
 * - `cross`: how near the room's own way in a walker must stand for the crossing to be offered (m).
 * - `lapse`: how long a request to another player's pilot stands before it lapses (s of flying: the
 *   clock is the step's, so it stops while the menu that answers the request is open).
 * - `lead`: how much of a step ahead the carrier's pose is read at (1 is a whole step, 0 none). The
 *   clamp is written before the carrier has stepped, so without this the carried hull would ride a step
 *   behind the hull it is on -- a constant few metres back at cruising speed, and a visible swing in a
 *   turn. `__debug.dock({ clamp: { lead: 0 } })` turns it off to compare.
 */
export const CLAMP_TUNE = {
  ask: 50,
  carrier: 2,
  slow: 25,
  settle: 1.5,
  gap: 1.5,
  clear: 1.5,
  push: 6,
  cross: 6,
  lapse: 20,
  lead: 1,
};

/** A model's box as the garage keeps one: two corners, in either order (a mesh's BOX chunk holds the larger first). */
export interface BoundsLike {
  readonly min: readonly number[];
  readonly max: readonly number[];
}

/** How far a box reaches along an axis. Which corner holds the larger value is never trusted. */
export function extent(b: BoundsLike, axis: number): number {
  return Math.abs((b.max[axis] ?? 0) - (b.min[axis] ?? 0));
}

/** The lower of a box's two corners along an axis, whichever corner that is. */
export function lowSide(b: BoundsLike, axis: number): number {
  return Math.min(b.min[axis] ?? 0, b.max[axis] ?? 0);
}

/** The higher of a box's two corners along an axis. */
export function highSide(b: BoundsLike, axis: number): number {
  return Math.max(b.min[axis] ?? 0, b.max[axis] ?? 0);
}

/** A box's longest side: what "how big is this hull" means here. */
export function hullLength(b: BoundsLike): number {
  return Math.max(extent(b, 0), extent(b, 1), extent(b, 2));
}

/**
 * Whether a hull is big enough to carry another: its longest side at least `carrier` times the other's.
 * Ours, and the one rule that decides what may be a carrier at all.
 */
export function carrierEnough(carrier: BoundsLike, ship: BoundsLike, tune = CLAMP_TUNE): boolean {
  const s = hullLength(ship);
  return s > 1e-3 && hullLength(carrier) >= s * tune.carrier;
}

/**
 * Where a clamped ship rests, in the carrier's own frame: over the middle of the carrier's box, with
 * its own belly `gap` above the top of that box. The box's top is always outside the hull, so this is
 * the spot before anything has looked at the skin; `clampOnSkin` lowers it onto what a ray down finds.
 */
export function clampLocal(carrier: BoundsLike, ship: BoundsLike, out: V3, tune = CLAMP_TUNE): V3 {
  out.x = (lowSide(carrier, 0) + highSide(carrier, 0)) / 2;
  out.z = (lowSide(carrier, 2) + highSide(carrier, 2)) / 2;
  out.y = highSide(carrier, 1) + tune.gap - lowSide(ship, 1);
  return out;
}

/**
 * The height of the clamp spot once a ray straight down the carrier's back has found its skin at
 * `hitY` (in the carrier's frame): the carried ship's belly `gap` above it. A spine or a mast can
 * stand well above the deck the ray finds, so this is only ever used with the ray's own answer.
 */
export function clampOnSkin(hitY: number, ship: BoundsLike, tune = CLAMP_TUNE): number {
  return hitY + tune.gap - lowSide(ship, 1);
}

/** Whether a ship that has let go is far enough off the carrier to be given its colliders back. */
export function clampClear(shipPos: V3, carrierPos: V3, shipRadius: number, carrierRadius: number, tune = CLAMP_TUNE): boolean {
  const dx = shipPos.x - carrierPos.x;
  const dy = shipPos.y - carrierPos.y;
  const dz = shipPos.z - carrierPos.z;
  return Math.hypot(dx, dy, dz) > carrierRadius + shipRadius * tune.clear;
}

/**
 * Whether a walker standing at `at` in a hull's frame is at the room's own way in, which is where a
 * crossing to the other ship is offered.
 */
export function atTheDoor(at: V3, entry: V3, tune = CLAMP_TUNE): boolean {
  return Math.hypot(at.x - entry.x, at.y - entry.y, at.z - entry.z) <= tune.cross;
}

/**
 * A carrier's pose `lead` steps on from where it is and what it is doing, into `outPos`/`outQ`: what a
 * clamped hull is written against. The clamp is written before the carrier has taken its own step, so
 * without this the carried hull rides a step behind it. `lead` 0 gives the pose as it stands.
 */
export function leadPose(pos: V3, q: Q4, linvel: V3, angvel: V3, dt: number, lead: number, outPos: V3, outQ: Q4): void {
  const t = dt * lead;
  outPos.x = pos.x + linvel.x * t;
  outPos.y = pos.y + linvel.y * t;
  outPos.z = pos.z + linvel.z * t;
  // The first-order advance of a turn by an angular velocity: q + (dt/2) * omega * q, normalised.
  const h = t / 2;
  const wx = angvel.x * h;
  const wy = angvel.y * h;
  const wz = angvel.z * h;
  const x = q.x + (wy * q.z - wz * q.y + q.w * wx);
  const y = q.y + (wz * q.x - wx * q.z + q.w * wy);
  const z = q.z + (wx * q.y - wy * q.x + q.w * wz);
  const w = q.w - (wx * q.x + wy * q.y + wz * q.z);
  const l = Math.hypot(x, y, z, w);
  if (l < 1e-9) {
    outQ.x = q.x;
    outQ.y = q.y;
    outQ.z = q.z;
    outQ.w = q.w;
    return;
  }
  outQ.x = x / l;
  outQ.y = y / l;
  outQ.z = z / l;
  outQ.w = w / l;
}
