// Climbing II, phase 1: the test course (the owner's 2026-11-16: "a gauntlet of various turns and heights and jumps to
// test out distances and stuff like we just did for our 8 stairs"), as one layout. `climbCourse(options)` answers the
// course as a list of pieces, each in its own frame (x across to the body's right, y up from its own floor slab's top, z
// ahead from its own start line) with where it stands in the course's frame (`at`), its solids (boxes: a middle, half sizes
// and a turn; prisms: a convex footprint and a top over each of its corners), the lips it was made to have (top edges and
// the way each faces out), where a body starts on it, and the numbers it was made to test. The game's `__debug.climbTest()`
// and the node harness (tools/swg/tests/climbCourseBody.ts) both stand what this answers, through one builder
// (src/anim/climbCourseBuild.ts), never a copy of it; `climbCourse.test.ts` measures every piece's solids back to its
// numbers.
//
// Pure: no three.js, no engine and nothing of the page, so node runs it as the game does. Every number here is the
// course's own (ours: a test bed, not a rule of the game), except the two reaches below, measured on today's climbing.

import { CLIMB_TUNE } from './climbTune.ts';
import { ROPE_FACTS } from './ropeClips.ts';

/** What a piece is for (the design's list; `room` the feedback round's climbs up that only nearly fit). */
export type CourseKind = 'lip' | 'wall' | 'corner' | 'slope' | 'steps' | 'gap' | 'bar' | 'rope' | 'pole' | 'obstacle' | 'run' | 'room';

/** What a solid is to its piece (the floor slab every piece stands on, and what stands on it). */
export type SolidRole = 'floor' | 'wall' | 'plate' | 'platform' | 'bar' | 'beam' | 'rope' | 'pole' | 'obstacle' | 'roof' | 'bump';

/** A box: its middle, its half sizes along its own axes, and its turn about up (its own x along (cos turn, sin turn) of the piece's x and z). */
export interface CourseBox {
  kind: 'box';
  role: SolidRole;
  mid: [number, number, number];
  half: [number, number, number];
  turn: number;
}

/** A prism: a convex footprint (x, z pairs, counter-clockwise with x across and z ahead), its floor's height and the top over each footprint corner. */
export interface CoursePrism {
  kind: 'prism';
  role: SolidRole;
  foot: [number, number][];
  y0: number;
  tops: number[];
  /**
   * The underside under each footprint corner where it is not `y0` (a free-hanging beam's, which slopes with its top: the
   * owner's free twins, 2026-11-17); absent on every solid made before, whose underside is level at `y0`. `y0` is then the
   * lowest of them.
   */
  bottoms?: number[];
}

export type CourseSolid = CourseBox | CoursePrism;

/** A lip the piece was made to have: its top edge from `a` to `b` (the piece's frame) and the way its face looks out (level, unit). */
export interface CourseLip {
  name: string;
  a: [number, number, number];
  b: [number, number, number];
  out: [number, number];
}

/** Where a body starts on the piece (its feet), facing `face` (level, unit, the piece's x and z). */
export interface CourseStart {
  name: string;
  at: [number, number, number];
  face: [number, number];
}

export interface CoursePiece {
  id: string;
  kind: CourseKind;
  /** The row of the course it stands in (one family a row). */
  row: string;
  /** Where the piece's own origin stands in the course's frame (x across, z ahead). */
  at: [number, number];
  /** Its footprint in its own frame: its floor slab's (every solid and start, and a margin). */
  bounds: { x0: number; x1: number; z0: number; z1: number };
  solids: CourseSolid[];
  lips: CourseLip[];
  starts: CourseStart[];
  /** The numbers it was made to test (a lip's height over its floor, a gap's span, an angle, a step), which the test measures the solids back to. */
  numbers: Record<string, number | string | boolean>;
}

export interface ClimbCourse {
  pieces: CoursePiece[];
  /** How deep each floor slab reaches under its top, metres. */
  floor: number;
  /** The two jump reaches the lip heights were made from. */
  reach: { standing: number; running: number };
  /** The lip slope limit the steepest sloped lip was made just past, degrees. */
  lipSlope: number;
  /** Ids asked for that the course does not have. */
  unknown: string[];
}

export interface CourseOptions {
  /** Only these ids, laid out by themselves (the rows packed again). */
  pieces?: readonly string[];
  /** Metres between pieces across a row (2). */
  gap?: number;
  /** Metres between rows (4). */
  rowGap?: number;
  /** How deep every floor slab reaches under its top (1): the game asks for more where the ground under the course falls. */
  floor?: number;
  /** The shimmy's slope limit the last sloped lip is made just past (`CLIMB_TUNE.lipSlope`, read when asked). */
  lipSlope?: number;
  /** The two jump reaches (`TODAY_REACH`). */
  reach?: { standing?: number; running?: number };
  /**
   * The owner's extra rows (2026-11-17: "a section of ladder-like things so I can test hop-ups and hop-downs and a vertical
   * portion to the gauntlet that lets me combine a bunch of things"), laid out after every other row: the ladders, the
   * vertical pieces, and (the feedback round's) the low pieces to duck and crawl under (`extraPieces`). Off unless asked, so
   * the harness, `courseIds()` and every digest are as they were; the game's `__debug.climbTest()` asks for them by default.
   */
  extras?: boolean;
  /**
   * Climbing II, phase 4 (maker B): the rope's landings, a row after every other (`ropeLandPieces`): a rope over level ground
   * and a platform ahead of it at each landing's height (level, knee, between knee and waist, waist), and one with no platform
   * at all (the fall). Off unless asked, so every digest is as it was; the game's `__debug.climbTest()` asks for them by default.
   */
  ropeLands?: boolean;
  /**
   * The fixer: the scale of the figure the rope's landings are laid for (`ropeLandTops`; the game's `climbTest` hands the stood
   * figure's, the player's own ledge scale), 1 for the human male's own size.
   */
  ropeScale?: number;
}

/**
 * Today's reaches (`c88f890`), measured by `tools/swg/tests/climbCourseBody.ts`'s `reachAt` on this very layout's braced lip
 * (a 1 m deep wall, 6 m of lip) with the body on the piece's own floor slab, the human male's size, no Force: the highest
 * lip, to the centimetre, that the ledges grab in a jump's flight (a standing jump 0.8 m from the face, W held, Space tapped;
 * a running jump from 4.2 m back, W held 0.45 s before Space). It is not one number: standing 3.10 m at 30 frames a second,
 * 3.24 at 60, 3.25 at 144 and 240; running 3.10, 3.15, 3.25 and 3.26 (a fault of today's, by frame rate, which
 * `climbToday.test.ts` holds as it stands). They are the reaches off the course's slab: off the terrain with no slab under
 * the body the standing ones are the same and the running ones at 30 and 144 a centimetre higher (3.11, 3.15, 3.26, 3.26),
 * so a centimetre between the two grounds is the ground's, never a change. The course takes the physics' own rate's (60):
 * two lips from each, it and 0.25 m past it, so the lips at the two reaches straddle every rate's edge (30 grabs neither,
 * 144 and 240 both, none grabs either past it).
 */
export const TODAY_REACH = { standing: 3.24, running: 3.15 } as const;

/** The height of every lip that is not itself about height (a standing jump grabs it today: the ledges' own tests' 2.6). */
export const LIP_HEIGHT = 2.6;
/** How far behind the start line the main face stands (the running start 4.2 m back from it, the standing one 0.8). */
export const FACE_Z = 5;
/** The standing and running starts' distances from a face, metres (the ledges' own tests'). */
export const STAND_OFF = 0.8;
export const RUN_OFF = 4.2;
/** The margin round a piece's solids and starts that its floor slab covers, metres. */
export const SLAB_MARGIN = 0.75;

/** The lip heights over their floor the design names, before the measured reaches. */
export const LIP_HEIGHTS = [1.2, 1.8, 2.4, 3.0, 3.6] as const;
/** The hop gaps' spans: 1 to 6 m in steps of 0.5. */
export const GAP_SPANS: readonly number[] = Array.from({ length: 11 }, (_, k) => 1 + 0.5 * k);
/** The corridors behind the body for the look-away jump: 1.5 to 4 m. */
export const BEHIND_SPANS: readonly number[] = [1.5, 2, 2.5, 3, 3.5, 4];
/** The obstacles' heights and depths, and the ledges to clamber onto. */
export const OBSTACLE_HEIGHTS = [0.6, 0.9, 1.1, 1.3] as const;
export const OBSTACLE_DEPTHS = [0.3, 0.8, 1.5] as const;
export const CLAMBER_HEIGHTS = [1.0, 1.2] as const;
/** The run-up before every obstacle, metres. */
export const RUN_UP = 15;

const f1 = (v: number): string => (Math.round(v * 100) / 100).toString();
const round = (v: number): number => Math.round(v * 1e9) / 1e9;

// ---- solids -----------------------------------------------------------------------------------------------------------------

/** An axis-aligned box from its two corners (the piece's frame). */
function aabb(role: SolidRole, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): CourseBox {
  return {
    kind: 'box',
    role,
    mid: [round((x0 + x1) / 2), round((y0 + y1) / 2), round((z0 + z1) / 2)],
    half: [round((x1 - x0) / 2), round((y1 - y0) / 2), round((z1 - z0) / 2)],
    turn: 0,
  };
}

/** A box's footprint, counter-clockwise (x across, z ahead). */
export function boxFoot(b: CourseBox): [number, number][] {
  const c = Math.cos(b.turn);
  const s = Math.sin(b.turn);
  const [hx, , hz] = b.half;
  const out: [number, number][] = [];
  for (const [u, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    out.push([b.mid[0] + c * hx * u - s * hz * w, b.mid[2] + s * hx * u + c * hz * w]);
  }
  return out;
}

/** A solid's footprint and its floor and highest top. */
export function solidFoot(s: CourseSolid): { foot: [number, number][]; y0: number; y1: number } {
  if (s.kind === 'box') return { foot: boxFoot(s), y0: s.mid[1] - s.half[1], y1: s.mid[1] + s.half[1] };
  return { foot: s.foot, y0: s.y0, y1: Math.max(...s.tops) };
}

/**
 * A wall along a lip's polyline (x, z points: the lip's top edge, its face looking out to the right of the way the points
 * run, the solid to their left), `depth` deep, standing from 0 to the top over each point: one convex prism a segment,
 * each mitred to the next so neighbours share a face exactly (no gap, no overlap). Answers the prisms and the lips.
 */
function lipWall(points: [number, number][], tops: number[], depth: number, name = 'A'): { solids: CoursePrism[]; lips: CourseLip[] } {
  const n = points.length;
  const dirs: [number, number][] = [];
  for (let i = 0; i + 1 < n; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dz = points[i + 1][1] - points[i][1];
    const l = Math.hypot(dx, dz);
    dirs.push([dx / l, dz / l]);
  }
  // The left normal of each segment (the solid's side), and the inner point at each vertex (mitred).
  const left = dirs.map(([tx, tz]) => [-tz, tx] as [number, number]);
  const inner: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = left[Math.max(0, i - 1)];
    const b = left[Math.min(n - 2, i)];
    let mx = a[0] + b[0];
    let mz = a[1] + b[1];
    const ml = Math.hypot(mx, mz);
    mx /= ml;
    mz /= ml;
    const k = depth / (mx * a[0] + mz * a[1]);
    inner.push([round(points[i][0] + mx * k), round(points[i][1] + mz * k)]);
  }
  const solids: CoursePrism[] = [];
  const lips: CourseLip[] = [];
  for (let i = 0; i + 1 < n; i++) {
    solids.push({ kind: 'prism', role: 'wall', foot: [points[i], points[i + 1], inner[i + 1], inner[i]], y0: 0, tops: [tops[i], tops[i + 1], tops[i + 1], tops[i]] });
    lips.push({ name: `${name}${i}`, a: [points[i][0], tops[i], points[i][1]], b: [points[i + 1][0], tops[i + 1], points[i + 1][1]], out: [round(dirs[i][1]), round(-dirs[i][0])] });
  }
  return { solids, lips };
}

/** The front lip of an axis-aligned wall box facing the start line (its near z face). */
function frontLip(name: string, x0: number, x1: number, y: number, z: number): CourseLip {
  return { name, a: [x0, y, z], b: [x1, y, z], out: [0, -1] };
}

const stand = (x: number, z = FACE_Z - STAND_OFF): CourseStart => ({ name: 'stand', at: [x, 0, z], face: [0, 1] });
const run = (x: number, z = FACE_Z - RUN_OFF): CourseStart => ({ name: 'run', at: [x, 0, z], face: [0, 1] });

/** A piece from its parts: its footprint worked out from its solids and starts, and its floor slab added under it. */
function piece(id: string, kind: CourseKind, row: string, solids: CourseSolid[], lips: CourseLip[], starts: CourseStart[], numbers: CoursePiece['numbers'], floor: number): CoursePiece {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const s of solids) {
    for (const [x, z] of solidFoot(s).foot) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
  }
  for (const s of starts) {
    x0 = Math.min(x0, s.at[0]);
    x1 = Math.max(x1, s.at[0]);
    z0 = Math.min(z0, s.at[2]);
    z1 = Math.max(z1, s.at[2]);
  }
  const b = { x0: round(x0 - SLAB_MARGIN), x1: round(x1 + SLAB_MARGIN), z0: round(z0 - SLAB_MARGIN), z1: round(z1 + SLAB_MARGIN) };
  const slab = aabb('floor', b.x0, -floor, b.z0, b.x1, 0, b.z1);
  return { id, kind, row, at: [0, 0], bounds: b, solids: [slab, ...solids], lips, starts, numbers };
}

// ---- the pieces ---------------------------------------------------------------------------------------------------------

/** A lip over its floor: braced (a 1 m deep wall under it, 6 m of lip) or free (a 0.3 m plate standing 2 m out from a back wall, nothing under its lip). */
export function lipPiece(id: string, height: number, braced: boolean, floor = 1, what = ''): CoursePiece {
  const H = height;
  const solids: CourseSolid[] = braced
    ? [aabb('wall', -3, 0, FACE_Z, 3, H, FACE_Z + 1)]
    : [aabb('wall', -3, 0, FACE_Z + 2, 3, H, FACE_Z + 3), aabb('plate', -3, H - 0.3, FACE_Z, 3, H, FACE_Z + 2)];
  const numbers: CoursePiece['numbers'] = { height: round(H), braced, lipLength: 6 };
  if (!braced) {
    numbers.overhang = 2;
    numbers.plate = 0.3;
  }
  if (what) numbers.from = what;
  return piece(id, 'lip', braced ? 'lips braced' : 'lips free', solids, [frontLip('A', -3, 3, H, FACE_Z)], [stand(0), run(0)], numbers, floor);
}

/** A lip turning a corner (an outer or inner turn of `angle` degrees) part way along it. */
function cornerPiece(id: string, angle: number, outer: boolean, floor: number): CoursePiece {
  const a = (angle * Math.PI) / 180;
  const sgn = outer ? 1 : -1;
  const pts: [number, number][] = [[-4, FACE_Z], [0, FACE_Z], [round(4 * Math.cos(a)), round(FACE_Z + sgn * 4 * Math.sin(a))]];
  const w = lipWall(pts, [LIP_HEIGHT, LIP_HEIGHT, LIP_HEIGHT], 1);
  return piece(id, 'corner', 'corners', w.solids, w.lips, [stand(-2)], { angle, turn: outer ? 'outer' : 'inner', height: LIP_HEIGHT, corner: '0,5' }, floor);
}

/** A lip curving round a radius in steps (outer: round a tower; inner: into a bay), with 3 m of straight lip before it and 2 m after. */
function curvePiece(id: string, radius: number, sweep: number, steps: number, outer: boolean, floor: number): CoursePiece {
  const pts: [number, number][] = [[-3, FACE_Z], [0, FACE_Z]];
  const cz = outer ? FACE_Z + radius : FACE_Z - radius;
  for (let k = 1; k <= steps; k++) {
    const t = ((sweep * k) / steps) * (Math.PI / 180);
    pts.push(outer ? [round(radius * Math.sin(t)), round(cz - radius * Math.cos(t))] : [round(radius * Math.sin(t)), round(cz + radius * Math.cos(t))]);
  }
  const last = pts[pts.length - 1];
  const te = (sweep * Math.PI) / 180;
  const tx = Math.cos(te);
  const tz = outer ? Math.sin(te) : -Math.sin(te);
  pts.push([round(last[0] + 2 * tx), round(last[1] + 2 * tz)]);
  const w = lipWall(pts, pts.map(() => LIP_HEIGHT), 1);
  return piece(id, 'corner', 'corners', w.solids, w.lips, [stand(-1.5)], { radius, sweep, step: round(sweep / steps), turn: outer ? 'outer' : 'inner', height: LIP_HEIGHT, centre: `0,${cz}` }, floor);
}

/** A lip rising along its length at `angle` degrees: 2.5 m flat at the lip height, 2.5 m of slope, 2 m flat at the top. */
function slopePiece(id: string, angle: number, floor: number, past = false): CoursePiece {
  const rise = round(2.5 * Math.tan((angle * Math.PI) / 180));
  const top = round(LIP_HEIGHT + rise);
  const w = lipWall([[-4, FACE_Z], [-1.5, FACE_Z], [1, FACE_Z], [3, FACE_Z]], [LIP_HEIGHT, LIP_HEIGHT, top, top], 1);
  const numbers: CoursePiece['numbers'] = { angle, run: 2.5, rise, height: LIP_HEIGHT };
  if (past) numbers.pastLimit = true;
  return piece(id, 'slope', 'slopes and steps', w.solids, w.lips, [stand(-2.75)], numbers, floor);
}

/** A lip in five steps of `step` along it, 1.5 m each, rising to the body's right (the middle one at the lip height). */
function stepsPiece(id: string, step: number, floor: number): CoursePiece {
  const solids: CourseSolid[] = [];
  const lips: CourseLip[] = [];
  for (let k = 0; k < 5; k++) {
    const x0 = -3.75 + 1.5 * k;
    const h = round(LIP_HEIGHT + (k - 2) * step);
    solids.push(aabb('wall', x0, 0, FACE_Z, x0 + 1.5, h, FACE_Z + 1));
    lips.push(frontLip(`S${k}`, x0, x0 + 1.5, h, FACE_Z));
  }
  return piece(id, 'steps', 'slopes and steps', solids, lips, [stand(0)], { step, segment: 1.5, count: 5, height: LIP_HEIGHT }, floor);
}

/** Two lips side by side at one height, `span` apart end to end (A on the left, B on the right). */
function sidePiece(id: string, span: number, floor: number): CoursePiece {
  const h = span / 2;
  const solids = [aabb('wall', -h - 3, 0, FACE_Z, -h, LIP_HEIGHT, FACE_Z + 1), aabb('wall', h, 0, FACE_Z, h + 3, LIP_HEIGHT, FACE_Z + 1)];
  const lips = [frontLip('A', -h - 3, -h, LIP_HEIGHT, FACE_Z), frontLip('B', h, h + 3, LIP_HEIGHT, FACE_Z)];
  return piece(id, 'gap', 'hops sideways', solids, lips, [{ ...stand(-h - 1.5), name: 'onA' }, { ...stand(h + 1.5), name: 'onB' }], { dir: 'side', span, dx: span, dy: 0, height: LIP_HEIGHT }, floor);
}

/**
 * A lip in a wall stepped back 0.3 m behind it, the upper lip `span` over it (A the lower, 6 m long, B the upper over A's
 * right 4 m): A's left 2 m have nothing over them (a lip with wall rising just behind it is no lip a jump grabs today: the
 * ledges look for open air over the hands' reach), so a body grabs A there and shimmies under B. B's top 1.5 m deep to
 * start on.
 */
function upDownPiece(id: string, span: number, floor: number): CoursePiece {
  const back = 0.3;
  const top = round(LIP_HEIGHT + span);
  const solids = [aabb('wall', -4, 0, FACE_Z, 2, LIP_HEIGHT, FACE_Z + back), aabb('wall', -2, 0, FACE_Z + back, 2, top, FACE_Z + back + 1.5)];
  const lips = [frontLip('A', -4, 2, LIP_HEIGHT, FACE_Z), frontLip('B', -2, 2, top, FACE_Z + back)];
  const onB: CourseStart = { name: 'topB', at: [0, top, round(FACE_Z + back + 1.0)], face: [0, -1] };
  return piece(id, 'gap', 'hops up and down', solids, lips, [{ ...stand(-3), name: 'onA' }, onB], { dir: 'updown', span, dx: 0, dy: span, setback: back, open: 2, height: LIP_HEIGHT }, floor);
}

/** Two lips side by side, the right one higher: `span` apart corner to corner along a 45-degree line (A low on the left, B high on the right; B's top 1.5 m deep to start on). */
function diagPiece(id: string, span: number, floor: number): CoursePiece {
  const d = round(span / Math.SQRT2);
  const h = d / 2;
  const top = round(LIP_HEIGHT + d);
  const solids = [aabb('wall', -h - 3, 0, FACE_Z, -h, LIP_HEIGHT, FACE_Z + 1.5), aabb('wall', h, 0, FACE_Z, h + 3, top, FACE_Z + 1.5)];
  const lips = [frontLip('A', -h - 3, -h, LIP_HEIGHT, FACE_Z), frontLip('B', h, h + 3, top, FACE_Z)];
  const onB: CourseStart = { name: 'topB', at: [round(h + 1.5), top, FACE_Z + 1.0], face: [0, -1] };
  return piece(id, 'gap', 'hops diagonally', solids, lips, [{ ...stand(-h - 1.5), name: 'onA' }, onB], { dir: 'diag', span, dx: d, dy: d, height: LIP_HEIGHT }, floor);
}

/** Two walls facing each other across a corridor `span` wide, both lips at the lip height (A ahead of the start, B behind it). */
function behindPiece(id: string, span: number, floor: number): CoursePiece {
  const solids = [aabb('wall', -3, 0, FACE_Z, 3, LIP_HEIGHT, FACE_Z + 1), aabb('wall', -3, 0, FACE_Z - span - 1, 3, LIP_HEIGHT, FACE_Z - span)];
  const lips = [frontLip('A', -3, 3, LIP_HEIGHT, FACE_Z), { name: 'B', a: [3, LIP_HEIGHT, FACE_Z - span] as [number, number, number], b: [-3, LIP_HEIGHT, FACE_Z - span] as [number, number, number], out: [0, 1] as [number, number] }];
  return piece(id, 'gap', 'hops behind', solids, lips, [{ ...stand(0), name: 'onA' }], { dir: 'behind', span, height: LIP_HEIGHT }, floor);
}

/** A climbable wall `height` tall, with a 2 m deep top to climb out onto, or (`edge`) 0.2 m thick with nothing to stand on. */
function wallPiece(id: string, height: number, edge: boolean, floor: number): CoursePiece {
  const deep = edge ? 0.2 : 2;
  const solids = [aabb('wall', -2, 0, FACE_Z, 2, height, FACE_Z + deep)];
  return piece(id, 'wall', 'walls', solids, [frontLip('A', -2, 2, height, FACE_Z)], [{ name: 'stand', at: [0, 0, FACE_Z - 1], face: [0, 1] }], { height, top: edge ? 'edge' : 'deep', depth: deep }, floor);
}

/** A pit 3 m deep between two platforms, bars across it every `spacing` metres 2.4 m over the take-off floor (the first 1 m out). */
function barsPiece(id: string, spacing: number, floor: number): CoursePiece {
  const pit = 3;
  const over = 2.4;
  const r = 0.035;
  const count = 3;
  const first = 5 + 1;
  const end = first + (count - 1) * spacing + 1;
  const solids: CourseSolid[] = [aabb('platform', -2, 0, 0, 2, pit, 5), aabb('platform', -2, 0, end, 2, pit, end + 4)];
  for (let k = 0; k < count; k++) {
    const z = first + k * spacing;
    solids.push(aabb('bar', -2, pit + over - r, z - r, 2, pit + over + r, z + r));
  }
  return piece(id, 'bar', 'bars ropes poles', solids, [], [{ name: 'run', at: [0, pit, 1], face: [0, 1] }], { spacing, over, radius: r, pit, bars: count, first: 1 }, floor);
}

/** A pit 3 m deep and 6 m across, a rope hanging into it 2 m from the take-off edge from a beam 6 m over the take-off floor to 1 m over the pit's floor. */
function ropePiece(id: string, floor: number): CoursePiece {
  const pit = 3;
  const r = 0.02;
  const rz = 5 + 2;
  const beamY = pit + 6;
  const solids: CourseSolid[] = [
    aabb('platform', -2, 0, 0, 2, pit, 5),
    aabb('platform', -2, 0, 11, 2, pit, 15),
    aabb('beam', -2, beamY, rz - 0.1, 2, beamY + 0.2, rz + 0.1),
    aabb('rope', -r, 1, rz - r, r, beamY, rz + r),
  ];
  return piece(id, 'rope', 'bars ropes poles', solids, [], [{ name: 'run', at: [0, pit, 1], face: [0, 1] }], { pit, across: 6, fromEdge: 2, overPit: 1, anchor: beamY, radius: r }, floor);
}

/** Two vertical poles 0.08 m across and 6 m tall, 2 m apart. */
function polesPiece(id: string, floor: number): CoursePiece {
  const r = 0.04;
  const solids = [aabb('pole', -1 - r, 0, 6 - r, -1 + r, 6, 6 + r), aabb('pole', 1 - r, 0, 6 - r, 1 + r, 6, 6 + r)];
  return piece(id, 'pole', 'bars ropes poles', solids, [], [{ name: 'stand', at: [-1, 0, 4], face: [0, 1] }], { width: 2 * r, height: 6, apart: 2 }, floor);
}

/** A box `height` high and `depth` deep after a run-up (a vault's or a clamber's: a clamber's ledge 4 m deep). */
function obstaclePiece(id: string, height: number, depth: number, clamber: boolean, floor: number): CoursePiece {
  const z0 = 1 + RUN_UP;
  const w = clamber ? 1.5 : 1;
  const solids = [aabb('obstacle', -w, 0, z0, w, height, z0 + depth)];
  return piece(id, 'obstacle', 'obstacles', solids, [frontLip('A', -w, w, height, z0)], [{ name: 'run', at: [0, 0, 1], face: [0, 1] }], { height, depth, runUp: RUN_UP, clamber }, floor);
}

/**
 * A free run chaining them: a lip (A), a hop of 0.9 m to the right onto B, B's lip round an outer corner onto its side, a
 * climb up onto B's top, a wall (C) 6 m over B's top to climb and top out on, and a drop of 4.6 m off its far side onto a
 * platform (D).
 */
function runPiece(id: string, floor: number): CoursePiece {
  const H = LIP_HEIGHT;
  const solids = [
    aabb('wall', -6, 0, FACE_Z, -2, H, FACE_Z + 1),
    aabb('wall', -1.1, 0, FACE_Z, 3, H, FACE_Z + 4),
    aabb('wall', -1.1, 0, FACE_Z + 4, 3, H + 6, FACE_Z + 6),
    aabb('platform', -1.1, 0, FACE_Z + 6, 3, 4, FACE_Z + 13),
  ];
  const lips: CourseLip[] = [
    frontLip('A', -6, -2, H, FACE_Z),
    frontLip('B0', -1.1, 3, H, FACE_Z),
    { name: 'B1', a: [3, H, FACE_Z], b: [3, H, FACE_Z + 4], out: [1, 0] },
    frontLip('C', -1.1, 3, H + 6, FACE_Z + 4),
  ];
  return piece(id, 'run', 'free run', solids, lips, [stand(-4)], { hop: 0.9, corner: 'outer 90', wall: 6, drop: round(H + 6 - 4), height: H }, floor);
}

/** The feedback round's climbs up: the lip's height (a standing jump grabs it, braced and free alike: 0.70 and 1.17 s at 60). */
export const ROOM_HEIGHT = 2.4;
/** The row the feedback round's pieces stand in (after every other, so no piece before it moves). */
export const ROOM_ROW = 'climbs up short';
/**
 * How far over the lip a room piece's roof, lintel or ceiling reaches at its top, metres: past a hop up's reach (`hopUp`
 * 1.5 and the band's 0.1), so W at the lip climbs up rather than hopping to the roof's own front edge.
 */
export const ROOM_ROOF_TOP = 1.8;

/**
 * The feedback round, item 2: a lip whose climb up only nearly fits, each made so that today's climb up refuses it at one
 * test and a short climb (`climb.roomRule` 'fit') takes it one way. Braced (a wall 2 m deep under the lip) unless free:
 *  - `beam` (free: the free lip's plate and back wall): a beam 0.3 m deep over the plate's top 0.6 m in from the lip, its
 *    underside 0.9 m over the top, under which no crouched body (1.0 m and a 0.02 m skin) fits: the top's room at the free
 *    climb's own end (0.66 m in) and the two deeper ones meet it; nearer, 0.21 m in, the body fits (the climb ends nearer);
 *  - `roof`: a roof over the top and 0.6 m out over the face, its underside 1.3 m over the top: a crouched body fits on the
 *    top, but standing on the way up past the lip meets it (the climb tucks crouched);
 *  - `sill` (free, as `beam`): a lintel over the plate's top from its lip in, its underside 1.04 m over the top: a crouched
 *    body fits on the top under it, but the crouched way in over the lip at today's lift (0.05 m and the skin) meets it by a
 *    centimetre as it passes under its edge, and at no lift passes under it (the lower way in); no standing body fits there,
 *    so the climb ends crouched;
 *  - `bump`: three ribs 0.03 m tall and 0.04 m deep across the top, each 0.01 to 0.05 m in front of one of the braced
 *    climb's three depths: a crouched body's foot meets each by under a centimetre (the brush);
 *  - `none`: a ceiling over the top from 0.03 m behind the face, its underside 0.85 m over the top: nothing fits (refused
 *    under either rule).
 */
function roomPiece(id: string, what: 'beam' | 'roof' | 'sill' | 'bump' | 'none', floor: number): CoursePiece {
  const H = ROOM_HEIGHT;
  const free = what === 'beam' || what === 'sill';
  const solids: CourseSolid[] = free
    ? [aabb('wall', -3, 0, FACE_Z + 2, 3, H, FACE_Z + 3), aabb('plate', -3, H - 0.3, FACE_Z, 3, H, FACE_Z + 2)]
    : [aabb('wall', -3, 0, FACE_Z, 3, H, FACE_Z + 2)];
  const numbers: CoursePiece['numbers'] = { height: H, braced: !free, what };
  if (what === 'beam') {
    solids.push(aabb('beam', -3, H + 0.9, FACE_Z + 0.6, 3, H + 1.1, FACE_Z + 0.9));
    Object.assign(numbers, { over: 0.9, from: 0.6, deep: 0.3, overhang: 2, plate: 0.3 });
  } else if (what === 'roof') {
    solids.push(aabb('roof', -3, H + 1.3, FACE_Z - 0.6, 3, H + ROOM_ROOF_TOP, FACE_Z + 2));
    Object.assign(numbers, { over: 1.3, from: -0.6, top: ROOM_ROOF_TOP });
  } else if (what === 'sill') {
    solids.push(aabb('roof', -3, H + 1.04, FACE_Z, 3, H + ROOM_ROOF_TOP, FACE_Z + 2));
    Object.assign(numbers, { over: 1.04, from: 0, top: ROOM_ROOF_TOP, overhang: 2, plate: 0.3 });
  } else if (what === 'bump') {
    for (const z of [0.125, 0.275, 0.425]) solids.push(aabb('bump', -3, H, FACE_Z + z, 3, H + 0.03, FACE_Z + z + 0.04));
    Object.assign(numbers, { bump: 0.03, ribs: '0.125,0.275,0.425', rib: 0.04 });
  } else {
    solids.push(aabb('roof', -3, H + 0.85, FACE_Z + 0.03, 3, H + ROOM_ROOF_TOP, FACE_Z + 2));
    Object.assign(numbers, { over: 0.85, from: 0.03, top: ROOM_ROOF_TOP });
  }
  return piece(id, 'room', ROOM_ROW, solids, [frontLip('A', -3, 3, H, FACE_Z)], [stand(0)], numbers, floor);
}

// ---- the course ---------------------------------------------------------------------------------------------------------

/** Every piece, in its rows' order (its own frame, `at` not yet given). */
function allPieces(floor: number, lipSlope: number, reach: { standing: number; running: number }): CoursePiece[] {
  const out: CoursePiece[] = [];
  for (const braced of [true, false]) {
    const k = braced ? 'braced' : 'free';
    for (const H of LIP_HEIGHTS) out.push(lipPiece(`lip-${k}-${f1(H)}`, H, braced, floor));
    out.push(lipPiece(`lip-${k}-stand`, reach.standing, braced, floor, 'the standing jump reach'));
    out.push(lipPiece(`lip-${k}-stand+0.25`, round(reach.standing + 0.25), braced, floor, 'past the standing jump reach'));
    out.push(lipPiece(`lip-${k}-run`, reach.running, braced, floor, 'the running jump reach'));
    out.push(lipPiece(`lip-${k}-run+0.25`, round(reach.running + 0.25), braced, floor, 'past the running jump reach'));
  }
  out.push(cornerPiece('corner-outer-90', 90, true, floor));
  out.push(cornerPiece('corner-inner-90', 90, false, floor));
  for (const a of [30, 45, 60]) out.push(cornerPiece(`bend-outer-${a}`, a, true, floor));
  for (const a of [30, 45, 60]) out.push(cornerPiece(`bend-inner-${a}`, a, false, floor));
  out.push(curvePiece('curve-outer-3m', 3, 90, 9, true, floor));
  out.push(curvePiece('curve-inner-3m', 3, 90, 9, false, floor));
  for (const a of [15, 25, 35]) out.push(slopePiece(`slope-${a}`, a, floor));
  const past = Math.round(lipSlope) + 3;
  out.push(slopePiece(`slope-${past}`, past, floor, true));
  for (const s of [0.2, 0.35, 0.5, 0.6]) out.push(stepsPiece(`steps-${f1(s)}`, s, floor));
  for (const d of GAP_SPANS) out.push(sidePiece(`gap-side-${d.toFixed(1)}`, d, floor));
  for (const d of GAP_SPANS) out.push(upDownPiece(`gap-updown-${d.toFixed(1)}`, d, floor));
  for (const d of GAP_SPANS) out.push(diagPiece(`gap-diag-${d.toFixed(1)}`, d, floor));
  for (const d of BEHIND_SPANS) out.push(behindPiece(`gap-behind-${d.toFixed(1)}`, d, floor));
  out.push(wallPiece('wall-3', 3, false, floor));
  out.push(wallPiece('wall-6', 6, false, floor));
  out.push(wallPiece('wall-10', 10, false, floor));
  out.push(wallPiece('wall-edge-8', 8, true, floor));
  for (const s of [2, 3, 4, 5]) out.push(barsPiece(`bars-${s}`, s, floor));
  out.push(ropePiece('rope', floor));
  out.push(polesPiece('poles', floor));
  for (const h of OBSTACLE_HEIGHTS) for (const d of OBSTACLE_DEPTHS) out.push(obstaclePiece(`obstacle-${f1(h)}x${f1(d)}`, h, d, false, floor));
  for (const h of CLAMBER_HEIGHTS) out.push(obstaclePiece(`clamber-${f1(h)}`, h, 4, true, floor));
  out.push(runPiece('run', floor));
  // The feedback round's row, last: no piece before it moves.
  for (const w of ['beam', 'roof', 'sill', 'bump', 'none'] as const) out.push(roomPiece(`room-${w}`, w, floor));
  return out;
}

/** Every id the course has, in its order. */
export function courseIds(): string[] {
  return allPieces(1, CLIMB_TUNE.lipSlope, TODAY_REACH).map((p) => p.id);
}

/**
 * The course's pieces as phases 1 and 2 had them (every row but the feedback round's): `climbToday.test.ts` and
 * `climbAfter.test.ts` hold their digests over these, laid out alone as they always stood (the round's row comes after them).
 */
export const COURSE_TWO_IDS: readonly string[] = allPieces(1, CLIMB_TUNE.lipSlope, TODAY_REACH)
  .filter((p) => p.row !== ROOM_ROW)
  .map((p) => p.id);

/**
 * The course: every piece (or the ones `pieces` names), one family a row, each row centred across the course's x with
 * `gap` between its pieces and the rows `rowGap` apart ahead, each piece's `at` its own origin there.
 */
export function climbCourse(o: CourseOptions = {}): ClimbCourse {
  const floor = o.floor ?? 1;
  const lipSlope = o.lipSlope ?? CLIMB_TUNE.lipSlope;
  const reach = { standing: o.reach?.standing ?? TODAY_REACH.standing, running: o.reach?.running ?? TODAY_REACH.running };
  const gap = o.gap ?? 2;
  const rowGap = o.rowGap ?? 4;
  let pieces = allPieces(floor, lipSlope, reach);
  if (o.extras) pieces = pieces.concat(extraPieces(floor));
  if (o.ropeLands) pieces = pieces.concat(ropeLandPieces(floor, o.ropeScale ?? 1));
  const unknown: string[] = [];
  if (o.pieces) {
    const want = new Set(o.pieces);
    for (const id of o.pieces) if (!pieces.some((p) => p.id === id)) unknown.push(id);
    pieces = pieces.filter((p) => want.has(p.id));
  }
  // The rows, in the order their first piece comes.
  const rows: string[] = [];
  for (const p of pieces) if (!rows.includes(p.row)) rows.push(p.row);
  let rowZ = 0;
  for (const r of rows) {
    const inRow = pieces.filter((p) => p.row === r);
    const width = inRow.reduce((s, p) => s + (p.bounds.x1 - p.bounds.x0), 0) + gap * (inRow.length - 1);
    let x = -width / 2;
    let deep = 0;
    for (const p of inRow) {
      p.at = [round(x - p.bounds.x0), round(rowZ - p.bounds.z0)];
      x += p.bounds.x1 - p.bounds.x0 + gap;
      deep = Math.max(deep, p.bounds.z1 - p.bounds.z0);
    }
    rowZ += deep + rowGap;
  }
  return { pieces, floor, reach, lipSlope, unknown };
}

// ---- the owner's extra rows: ladders and the vertical pieces (`extras`) ------------------------------------------------------

/** A ladder's rungs: how far each stands out from the wall, how thick, how many, and how wide. */
export const RUNG_DEEP = 0.3;
export const RUNG_THICK = 0.2;
export const LADDER_RUNGS = 6;
/** The rung spacings of the straight ladders, the zigzags and the shelves, metres. */
export const LADDER_STEPS = [0.75, 1, 1.25, 1.5, 2] as const;
export const ZIGZAG_STEPS = [1, 1.5] as const;
export const SHELF_STEPS = [1, 1.5, 2] as const;

/** A rung: a plate standing `RUNG_DEEP` out of a wall's face at `z` (looking toward -z), its top at `h`, and its lip. */
function rung(name: string, x0: number, x1: number, h: number, z: number): { solid: CourseBox; lip: CourseLip } {
  return { solid: aabb('plate', x0, round(h - RUNG_THICK), round(z - RUNG_DEEP), x1, h, z), lip: frontLip(name, x0, x1, h, round(z - RUNG_DEEP)) };
}

/**
 * A ladder of lips straight up a flat wall: `LADDER_RUNGS` rungs 4 m wide, `step` apart, the first at the lip height (a
 * standing jump grabs it), the last flush with the wall's top (1.5 m deep to climb out onto): hop up rung to rung with W
 * or Space, and from the top hang on the last rung and hop down.
 */
function ladderPiece(id: string, step: number, floor: number): CoursePiece {
  const top = round(LIP_HEIGHT + (LADDER_RUNGS - 1) * step);
  const solids: CourseSolid[] = [aabb('wall', -2, 0, FACE_Z, 2, top, FACE_Z + 1.5)];
  const lips: CourseLip[] = [];
  for (let k = 0; k < LADDER_RUNGS; k++) {
    const r = rung(`R${k}`, -2, 2, round(LIP_HEIGHT + k * step), FACE_Z);
    solids.push(r.solid);
    lips.push(r.lip);
  }
  const starts: CourseStart[] = [stand(0, round(FACE_Z - RUNG_DEEP - STAND_OFF)), { name: 'top', at: [0, top, FACE_Z + 1], face: [0, -1] }];
  return piece(id, 'gap', 'ladders', solids, lips, starts, { dir: 'ladder', step, rungs: LADDER_RUNGS, deep: RUNG_DEEP, first: LIP_HEIGHT, top }, floor);
}

/** A ladder whose rungs (2 m wide, 0.5 m apart across) go left and right in turn as they rise `step` each: diagonal hops up and down. */
function zigzagPiece(id: string, step: number, floor: number): CoursePiece {
  const rungs = 7;
  const top = round(LIP_HEIGHT + (rungs - 1) * step);
  const solids: CourseSolid[] = [aabb('wall', -2.5, 0, FACE_Z, 2.5, top, FACE_Z + 1.5)];
  const lips: CourseLip[] = [];
  for (let k = 0; k < rungs; k++) {
    const left = k % 2 === 0;
    const r = rung(`R${k}`, left ? -2.25 : 0.25, left ? -0.25 : 2.25, round(LIP_HEIGHT + k * step), FACE_Z);
    solids.push(r.solid);
    lips.push(r.lip);
  }
  const starts: CourseStart[] = [stand(-1.25, round(FACE_Z - RUNG_DEEP - STAND_OFF)), { name: 'top', at: [-1.25, top, FACE_Z + 1], face: [0, -1] }];
  return piece(id, 'gap', 'ladders', solids, lips, starts, { dir: 'zigzag', step, rungs, across: 2, apart: 0.5, first: LIP_HEIGHT, top }, floor);
}

/** Six tiers rising `step` each, every tier stepped 0.6 m back from the one below (a lip with open air over it at every tier), the top tier 1.5 m deep. */
function shelvesPiece(id: string, step: number, floor: number): CoursePiece {
  const tiers = 6;
  const back = 0.6;
  const solids: CourseSolid[] = [];
  const lips: CourseLip[] = [];
  for (let k = 0; k < tiers; k++) {
    const z0 = round(FACE_Z + k * back);
    const z1 = round(k < tiers - 1 ? z0 + back : z0 + 1.5);
    const h = round(LIP_HEIGHT + k * step);
    solids.push(aabb('wall', -2, 0, z0, 2, h, z1));
    lips.push(frontLip(`T${k}`, -2, 2, h, z0));
  }
  const top = round(LIP_HEIGHT + (tiers - 1) * step);
  const starts: CourseStart[] = [stand(0), { name: 'top', at: [0, top, round(FACE_Z + (tiers - 1) * back + 1)], face: [0, -1] }];
  return piece(id, 'gap', 'ladders', solids, lips, starts, { dir: 'shelves', step, tiers, back, first: LIP_HEIGHT, top }, floor);
}

/**
 * A chimney: two walls 12 m tall facing each other across a corridor 2.5 m wide, rungs on each face in turn, 1.2 m apart
 * in height (the far wall's at 2.6, 5.0, 7.4 and 9.8, the near wall's at 3.8, 6.2, 8.6 and 11.0; 1.9 m across between the
 * two faces' lips): up by the braced look-away and the hop behind, face to face, and out onto either top.
 */
function chimneyPiece(id: string, floor: number): CoursePiece {
  const span = 2.5;
  const top = 12;
  const near = FACE_Z - span;
  const solids: CourseSolid[] = [aabb('wall', -2, 0, FACE_Z, 2, top, FACE_Z + 1.5), aabb('wall', -2, 0, near - 1.5, 2, top, near)];
  const lips: CourseLip[] = [frontLip('Atop', -2, 2, top, FACE_Z), { name: 'Btop', a: [2, top, near], b: [-2, top, near], out: [0, 1] }];
  [2.6, 5.0, 7.4, 9.8].forEach((h, k) => {
    const r = rung(`A${k}`, -2, 2, h, FACE_Z);
    solids.push(r.solid);
    lips.push(r.lip);
  });
  [3.8, 6.2, 8.6, 11.0].forEach((h, k) => {
    solids.push(aabb('plate', -2, round(h - RUNG_THICK), near, 2, h, round(near + RUNG_DEEP)));
    lips.push({ name: `B${k}`, a: [2, h, round(near + RUNG_DEEP)], b: [-2, h, round(near + RUNG_DEEP)], out: [0, 1] });
  });
  const starts: CourseStart[] = [{ name: 'stand', at: [0, 0, round(FACE_Z - RUNG_DEEP - STAND_OFF)], face: [0, 1] }];
  return piece(id, 'gap', 'vertical', solids, lips, starts, { dir: 'chimney', span, top, rise: 1.2, across: round(span - 2 * RUNG_DEEP) }, floor);
}

/**
 * The tower, one line of everything (the owner's "a vertical portion to the gauntlet that lets me combine a bunch of
 * things"), left to right and up: grab A (2.6 m), shimmy right up two steps of 0.35 m (S1, S2), hop up 1.25 m twice (U1,
 * U2, each stepped 0.3 m back), hop right 2 m across a gap to C (5.8 m), climb onto C's shelf (0.8 m deep), wall-climb the
 * 5 m face above it (C2) and top out at 10.8 m, hop down and right 2 m across and 1.8 m down to D (9.0 m), shimmy round
 * D's outer corner onto its side, drop 4 m off its back onto a platform (P, 5.0 m), cross a pit 4 m wide on two bars
 * 2 m apart 2.4 m over P (for the bars phase) to G, and climb down the pole beside G (for the poles phase).
 */
function towerPiece(id: string, floor: number): CoursePiece {
  const F = FACE_Z;
  const r = 0.035;
  const pr = 0.04;
  const solids: CourseSolid[] = [
    aabb('wall', -7, 0, F, -3, 2.6, F + 3),
    aabb('wall', -3, 0, F, -1.5, 2.95, F + 3),
    aabb('wall', -1.5, 0, F, 0, 3.3, F + 0.3),
    aabb('wall', -1.5, 0, F + 0.3, 0, 4.55, F + 0.6),
    aabb('wall', -1.5, 0, F + 0.6, 0, 5.8, F + 3),
    aabb('wall', 2, 0, F + 0.6, 5, 5.8, F + 1.4),
    aabb('wall', 2, 0, F + 1.4, 5, 10.8, F + 3.6),
    aabb('wall', 7, 0, F + 1.4, 10, 9.0, F + 4.4),
    aabb('platform', 7, 0, F + 4.4, 12, 5.0, F + 10),
    aabb('platform', 7, 0, F + 14, 12, 5.0, F + 18),
    aabb('bar', 7, 7.4 - r, F + 11 - r, 12, 7.4 + r, F + 11 + r),
    aabb('bar', 7, 7.4 - r, F + 13 - r, 12, 7.4 + r, F + 13 + r),
    aabb('pole', 12.5 - pr, 0, F + 16 - pr, 12.5 + pr, 8, F + 16 + pr),
  ];
  const lips: CourseLip[] = [
    frontLip('A', -7, -3, 2.6, F),
    frontLip('S1', -3, -1.5, 2.95, F),
    frontLip('S2', -1.5, 0, 3.3, F),
    frontLip('U1', -1.5, 0, 4.55, F + 0.3),
    frontLip('U2', -1.5, 0, 5.8, F + 0.6),
    frontLip('C', 2, 5, 5.8, F + 0.6),
    frontLip('C2', 2, 5, 10.8, F + 1.4),
    frontLip('D', 7, 10, 9.0, F + 1.4),
    { name: 'D1', a: [10, 9.0, F + 1.4], b: [10, 9.0, F + 4.4], out: [1, 0] },
  ];
  const starts: CourseStart[] = [stand(-5), { name: 'onC', at: [3.5, 5.8, F + 1], face: [0, 1] }, { name: 'onP', at: [9.5, 5.0, F + 8], face: [0, 1] }];
  return piece(id, 'run', 'vertical', solids, lips, starts, { steps: 0.35, hopUp: 1.25, hopSide: 2, wall: 5, hopDown: '2 across, 1.8 down', drop: 4, bars: 2, pit: 4, pole: 8, top: 10.8 }, floor);
}

/** The low pieces' undersides, metres over their floor: beams to walk under ducking, and slabs to crawl under lying prone. */
export const DUCK_UNDER = [1.5, 1.2, 0.9] as const;
export const CRAWL_UNDER = [0.6, 0.55] as const;

/**
 * A low piece (the feedback round's, for the duck and lying prone): something 4 m wide and 0.3 m thick across the way,
 * its underside `under` over the floor, `long` along the way from the face line (a beam 0.4 m, a tunnel or a slab 4 m),
 * standing on nothing (a fixed collider needs no posts), and a start 3 m short of it facing it: walk, run, crouch or crawl
 * under it with nothing pressed but the move keys.
 */
function lowPiece(id: string, under: number, long: number, dir: string, floor: number): CoursePiece {
  const solids: CourseSolid[] = [aabb(long > 1 ? 'roof' : 'beam', -2, under, FACE_Z, 2, round(under + 0.3), round(FACE_Z + long))];
  const starts: CourseStart[] = [{ name: 'stand', at: [0, 0, round(FACE_Z - 3)], face: [0, 1] }];
  return piece(id, 'obstacle', 'low', solids, [], starts, { dir, under, long }, floor);
}

/** The extra rows' pieces, in their order (its own frame, `at` not yet given): the ladders, the vertical pieces, the low pieces. */
function extraPieces(floor: number): CoursePiece[] {
  const out: CoursePiece[] = [];
  for (const s of LADDER_STEPS) out.push(ladderPiece(`ladder-${f1(s)}`, s, floor));
  for (const s of ZIGZAG_STEPS) out.push(zigzagPiece(`ladder-zigzag-${f1(s)}`, s, floor));
  for (const s of SHELF_STEPS) out.push(shelvesPiece(`shelves-${f1(s)}`, s, floor));
  out.push(chimneyPiece('chimney-2.5', floor));
  out.push(towerPiece('tower', floor));
  for (const h of DUCK_UNDER) out.push(lowPiece(`duck-${f1(h)}`, h, 0.4, 'duck', floor));
  out.push(lowPiece('tunnel-0.9', 0.9, 4, 'tunnel', floor));
  for (const h of CRAWL_UNDER) out.push(lowPiece(`crawl-${f1(h)}`, h, 4, 'crawl', floor));
  // The owner's free twins, traverses and climbing walls (2026-11-17), last: no piece before them moves.
  out.push(...freePieces(floor));
  return out;
}

// ---- the owner's free twins, traverses and climbing walls (2026-11-17) -------------------------------------------------------
//
// The owner: "we have a ton of stuff that all has walls for hanging. Can we make a copy for each test that is also for
// free-hanging and not braced-hanging? As in, the slopes and such you grab, I want an example of each (stairs, etc) that are
// just poles to grab onto as well. Also, I want to test out sideways jumping and navigation. If we can do rock climbing-like
// handholds area too, that would be great. both for braces and free hanging". So: one free twin of each kind of lip the
// course has (its lip a beam standing in the air with nothing under it, where the braced one stands on a wall), a traverse
// of lips at changing heights and gaps to cross sideways (braced and free), and climbing walls of holds (on a wall, and in
// the air). Every number here is ours, a test bed.

/**
 * A free-hanging beam: how far it reaches back from its lip and how thick it is (a rung's: a shallow lip the controls round
 * grabs), standing on nothing (a fixed collider needs no posts). Thicker than phase 3's bars (`barThin`, 0.12 m), so it
 * stays a lip and is never taken for a bar to swing on.
 */
export const BEAM_DEEP = 0.3;
export const BEAM_THICK = 0.2;

/** A beam from x0 to x1, its lip's top at `h` on its near face at `z` (looking toward -z), reaching back to z + `BEAM_DEEP`. */
function beam(name: string, x0: number, x1: number, h: number, z: number, role: SolidRole = 'beam'): { solid: CourseBox; lip: CourseLip } {
  return { solid: aabb(role, x0, round(h - BEAM_THICK), z, x1, h, round(z + BEAM_DEEP)), lip: frontLip(name, x0, x1, h, z) };
}

/** A beam along a lip's polyline (as `lipWall`, its lip the points, `BEAM_DEEP` deep and `BEAM_THICK` thick, its underside following its top). */
function beamLine(points: [number, number][], tops: number[], name = 'A'): { solids: CoursePrism[]; lips: CourseLip[] } {
  const w = lipWall(points, tops, BEAM_DEEP, name);
  for (const s of w.solids) {
    s.role = 'beam';
    s.bottoms = s.tops.map((t) => round(t - BEAM_THICK));
    s.y0 = Math.min(...s.bottoms);
  }
  return w;
}

/** The points of a curving lip as `curvePiece` lays them (3 m straight, the curve in `steps`, 2 m straight), and its centre. */
function curvePoints(radius: number, sweep: number, steps: number, outer: boolean): { pts: [number, number][]; cz: number } {
  const pts: [number, number][] = [[-3, FACE_Z], [0, FACE_Z]];
  const cz = outer ? FACE_Z + radius : FACE_Z - radius;
  for (let k = 1; k <= steps; k++) {
    const t = ((sweep * k) / steps) * (Math.PI / 180);
    pts.push(outer ? [round(radius * Math.sin(t)), round(cz - radius * Math.cos(t))] : [round(radius * Math.sin(t)), round(cz + radius * Math.cos(t))]);
  }
  const last = pts[pts.length - 1];
  const te = (sweep * Math.PI) / 180;
  const tx = Math.cos(te);
  const tz = outer ? Math.sin(te) : -Math.sin(te);
  pts.push([round(last[0] + 2 * tx), round(last[1] + 2 * tz)]);
  return { pts, cz };
}

const FREE = 'free twins';

/** The free twin of a corner or a bend (`cornerPiece`'s lip, a beam). */
function freeCornerPiece(id: string, angle: number, outer: boolean, floor: number): CoursePiece {
  const a = (angle * Math.PI) / 180;
  const sgn = outer ? 1 : -1;
  const pts: [number, number][] = [[-4, FACE_Z], [0, FACE_Z], [round(4 * Math.cos(a)), round(FACE_Z + sgn * 4 * Math.sin(a))]];
  const w = beamLine(pts, [LIP_HEIGHT, LIP_HEIGHT, LIP_HEIGHT]);
  return piece(id, 'corner', FREE, w.solids, w.lips, [stand(-2)], { angle, turn: outer ? 'outer' : 'inner', height: LIP_HEIGHT, free: true }, floor);
}

/** The free twin of a curve (`curvePiece`'s lip, a beam). */
function freeCurvePiece(id: string, radius: number, sweep: number, steps: number, outer: boolean, floor: number): CoursePiece {
  const { pts } = curvePoints(radius, sweep, steps, outer);
  const w = beamLine(pts, pts.map(() => LIP_HEIGHT));
  return piece(id, 'corner', FREE, w.solids, w.lips, [stand(-1.5)], { radius, sweep, turn: outer ? 'outer' : 'inner', height: LIP_HEIGHT, free: true }, floor);
}

/** The free twin of a sloping lip (`slopePiece`'s, a beam whose underside slopes with it). */
function freeSlopePiece(id: string, angle: number, floor: number): CoursePiece {
  const rise = round(2.5 * Math.tan((angle * Math.PI) / 180));
  const top = round(LIP_HEIGHT + rise);
  const w = beamLine([[-4, FACE_Z], [-1.5, FACE_Z], [1, FACE_Z], [3, FACE_Z]], [LIP_HEIGHT, LIP_HEIGHT, top, top]);
  return piece(id, 'slope', FREE, w.solids, w.lips, [stand(-2.75)], { angle, run: 2.5, rise, height: LIP_HEIGHT, free: true }, floor);
}

/** The free twin of a stepped lip (`stepsPiece`'s five steps, each a beam). */
function freeStepsPiece(id: string, step: number, floor: number): CoursePiece {
  const solids: CourseSolid[] = [];
  const lips: CourseLip[] = [];
  for (let k = 0; k < 5; k++) {
    const x0 = -3.75 + 1.5 * k;
    const b = beam(`S${k}`, x0, x0 + 1.5, round(LIP_HEIGHT + (k - 2) * step), FACE_Z);
    solids.push(b.solid);
    lips.push(b.lip);
  }
  return piece(id, 'steps', FREE, solids, lips, [stand(0)], { step, segment: 1.5, count: 5, height: LIP_HEIGHT, free: true }, floor);
}

/** Free hops: sideways (`sidePiece`), up and down (`upDownPiece`, B over A's right 4 m and stepped 0.3 m back), diagonally (`diagPiece`), behind (`behindPiece`), each lip a beam. */
function freeHopPiece(id: string, dir: 'side' | 'updown' | 'diag' | 'behind', span: number, floor: number): CoursePiece {
  const solids: CourseSolid[] = [];
  const lips: CourseLip[] = [];
  const add = (b: { solid: CourseBox; lip: CourseLip }): void => {
    solids.push(b.solid);
    lips.push(b.lip);
  };
  let starts: CourseStart[];
  const numbers: CoursePiece['numbers'] = { dir, span, height: LIP_HEIGHT, free: true };
  if (dir === 'side') {
    const h = span / 2;
    add(beam('A', -h - 3, -h, LIP_HEIGHT, FACE_Z));
    add(beam('B', h, h + 3, LIP_HEIGHT, FACE_Z));
    starts = [{ ...stand(-h - 1.5), name: 'onA' }, { ...stand(h + 1.5), name: 'onB' }];
  } else if (dir === 'updown') {
    add(beam('A', -4, 2, LIP_HEIGHT, FACE_Z));
    add(beam('B', -2, 2, round(LIP_HEIGHT + span), FACE_Z + 0.3));
    starts = [{ ...stand(-3), name: 'onA' }];
  } else if (dir === 'diag') {
    const d = round(span / Math.SQRT2);
    const h = d / 2;
    add(beam('A', -h - 3, -h, LIP_HEIGHT, FACE_Z));
    add(beam('B', h, h + 3, round(LIP_HEIGHT + d), FACE_Z));
    starts = [{ ...stand(-h - 1.5), name: 'onA' }];
    numbers.dx = d;
    numbers.dy = d;
  } else {
    add(beam('A', -3, 3, LIP_HEIGHT, FACE_Z));
    // B faces A across the corridor: its lip on its far face (toward +z), the beam reaching back toward the start.
    solids.push(aabb('beam', -3, round(LIP_HEIGHT - BEAM_THICK), round(FACE_Z - span - BEAM_DEEP), 3, LIP_HEIGHT, round(FACE_Z - span)));
    lips.push({ name: 'B', a: [3, LIP_HEIGHT, round(FACE_Z - span)], b: [-3, LIP_HEIGHT, round(FACE_Z - span)], out: [0, 1] });
    starts = [{ ...stand(0), name: 'onA' }];
  }
  return piece(id, 'gap', FREE, solids, lips, starts, numbers, floor);
}

/** The free twin of a ladder (`ladderPiece`'s rungs, `zigzag` `zigzagPiece`'s), each rung a beam with no wall behind it. */
function freeLadderPiece(id: string, step: number, zigzag: boolean, floor: number): CoursePiece {
  const rungs = zigzag ? 7 : LADDER_RUNGS;
  const solids: CourseSolid[] = [];
  const lips: CourseLip[] = [];
  for (let k = 0; k < rungs; k++) {
    const left = k % 2 === 0;
    const [x0, x1] = zigzag ? (left ? [-2.25, -0.25] : [0.25, 2.25]) : [-2, 2];
    const b = beam(`R${k}`, x0, x1, round(LIP_HEIGHT + k * step), FACE_Z);
    solids.push(b.solid);
    lips.push(b.lip);
  }
  return piece(id, 'gap', FREE, solids, lips, [stand(zigzag ? -1.25 : 0)], { dir: zigzag ? 'zigzag' : 'ladder', step, rungs, first: LIP_HEIGHT, free: true }, floor);
}

/** The traverse: lips in a line across, 2 m each, the gaps between them and each lip's height over the first. */
export const TRAVERSE_GAPS = [1, 1.5, 2, 1.25, 2.5, 1] as const;
export const TRAVERSE_RISES = [0, 0.4, -0.2, 0.6, 0, -0.4, 0.2] as const;
const TRAVERSE_LIP = 2;

/**
 * A traverse (the owner's "sideways jumping and navigation"): lips 2 m long in a line across, `TRAVERSE_GAPS` apart, each at
 * its own height (`TRAVERSE_RISES` over the lip height): braced (each on a wall 1 m deep) or free (each a beam). Grab the
 * first, shimmy to its end, look across and hop, all the way along and back.
 */
function traversePiece(id: string, braced: boolean, floor: number): CoursePiece {
  const solids: CourseSolid[] = [];
  const lips: CourseLip[] = [];
  const total = TRAVERSE_RISES.length * TRAVERSE_LIP + TRAVERSE_GAPS.reduce((s, g) => s + g, 0);
  let x = -total / 2;
  for (let k = 0; k < TRAVERSE_RISES.length; k++) {
    const x0 = round(x);
    const x1 = round(x + TRAVERSE_LIP);
    const h = round(LIP_HEIGHT + TRAVERSE_RISES[k]);
    if (braced) {
      solids.push(aabb('wall', x0, 0, FACE_Z, x1, h, FACE_Z + 1));
      lips.push(frontLip(`T${k}`, x0, x1, h, FACE_Z));
    } else {
      const b = beam(`T${k}`, x0, x1, h, FACE_Z);
      solids.push(b.solid);
      lips.push(b.lip);
    }
    x = x1 + (k < TRAVERSE_GAPS.length ? TRAVERSE_GAPS[k] : 0);
  }
  const first = round(-total / 2 + TRAVERSE_LIP / 2);
  const last = round(total / 2 - TRAVERSE_LIP / 2);
  return piece(id, 'gap', 'traverses', solids, lips, [{ ...stand(first), name: 'first' }, { ...stand(last), name: 'last' }], { dir: 'traverse', braced, lips: TRAVERSE_RISES.length, lip: TRAVERSE_LIP, gaps: TRAVERSE_GAPS.join(' '), rises: TRAVERSE_RISES.join(' ') }, floor);
}

/** A climbing wall's holds: rows up from `HOLD_FIRST`, `HOLD_ROW` apart, four columns across, each nudged a little (seeded, so every run stands the same wall). */
export const HOLD_FIRST = 2.0;
export const HOLD_ROW = 0.9;
export const HOLD_ROWS = 9;
export const HOLD_COLUMNS = [-2.25, -0.75, 0.75, 2.25] as const;
/** How far a hold is nudged from its place at most: up or down, and across. */
export const HOLD_NUDGE = { up: 0.12, across: 0.25 } as const;
/** The top of a climbing wall (a lip to climb out onto, 0.8 m over the last row's place). */
const HOLD_TOP = round(HOLD_FIRST + (HOLD_ROWS - 1) * HOLD_ROW + 0.8);

/** A number in [0, 1) from a hold's row and column (a fixed hash: the same in node and the browser). */
function holdHash(r: number, c: number, salt: number): number {
  const v = Math.sin(r * 127.1 + c * 311.7 + salt * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * A climbing wall (the owner's "rock climbing-like handholds area ... both for braces and free hanging"): holds `width`
 * wide, each standing `BEAM_DEEP` out and `BEAM_THICK` thick, in `HOLD_ROWS` rows `HOLD_ROW` apart (within the controls
 * round's ladder range, so W, S, A and D climb hand to hand) and four columns 1.5 m apart, every hold nudged by its own
 * hash and now and then one left out (never two stacked): braced, on a wall 6 m wide climbed out onto at its top; free, in
 * the air under a slab 1.5 m deep to climb out onto.
 */
function climbingWallPiece(id: string, braced: boolean, width: number, floor: number): CoursePiece {
  const solids: CourseSolid[] = [];
  const lips: CourseLip[] = [];
  const front = braced ? round(FACE_Z - BEAM_DEEP) : FACE_Z;
  if (braced) {
    solids.push(aabb('wall', -3, 0, FACE_Z, 3, HOLD_TOP, FACE_Z + 1.5));
    lips.push(frontLip('top', -3, 3, HOLD_TOP, FACE_Z));
  } else {
    solids.push(aabb('platform', -3, round(HOLD_TOP - 0.3), FACE_Z, 3, HOLD_TOP, FACE_Z + 1.5));
    lips.push(frontLip('top', -3, 3, HOLD_TOP, FACE_Z));
  }
  let held = 0;
  for (let r = 0; r < HOLD_ROWS; r++) {
    // At most one hold left out, and only on every other row from the third: every hold then has one under it within the
    // ladder's reach (its own column's, or a neighbour's beside a gap), so the wall climbs hand to hand from the bottom.
    const gap = r >= 2 && r % 2 === 0 && holdHash(r, 0, 3) < 0.5 ? Math.floor(holdHash(r, 1, 3) * HOLD_COLUMNS.length) : -1;
    HOLD_COLUMNS.forEach((cx, c) => {
      if (c === gap) return;
      const x = round(cx + (holdHash(r, c, 1) * 2 - 1) * HOLD_NUDGE.across);
      const h = round(HOLD_FIRST + r * HOLD_ROW + (holdHash(r, c, 2) * 2 - 1) * HOLD_NUDGE.up);
      const b = beam(`H${r}-${c}`, round(x - width / 2), round(x + width / 2), h, front, braced ? 'plate' : 'beam');
      solids.push(b.solid);
      lips.push(b.lip);
      held++;
    });
  }
  const starts: CourseStart[] = [stand(0, round(front - STAND_OFF)), { name: 'top', at: [0, HOLD_TOP, FACE_Z + 1], face: [0, -1] }];
  return piece(id, 'wall', 'climbing walls', solids, lips, starts, { braced, holdWidth: width, holds: held, rows: HOLD_ROWS, rowApart: HOLD_ROW, top: HOLD_TOP }, floor);
}

/** The free twins, the traverses and the climbing walls, in their order. */
function freePieces(floor: number): CoursePiece[] {
  const out: CoursePiece[] = [];
  out.push(freeCornerPiece('free-corner-outer-90', 90, true, floor));
  out.push(freeCornerPiece('free-corner-inner-90', 90, false, floor));
  out.push(freeCornerPiece('free-bend-outer-45', 45, true, floor));
  out.push(freeCornerPiece('free-bend-inner-45', 45, false, floor));
  out.push(freeCurvePiece('free-curve-outer-3m', 3, 90, 9, true, floor));
  out.push(freeCurvePiece('free-curve-inner-3m', 3, 90, 9, false, floor));
  for (const a of [15, 25, 35]) out.push(freeSlopePiece(`free-slope-${a}`, a, floor));
  for (const s of [0.35, 0.5]) out.push(freeStepsPiece(`free-steps-${f1(s)}`, s, floor));
  for (const d of [1, 2, 3, 4]) out.push(freeHopPiece(`free-gap-side-${d.toFixed(1)}`, 'side', d, floor));
  for (const d of [1, 1.5, 2]) out.push(freeHopPiece(`free-gap-updown-${d.toFixed(1)}`, 'updown', d, floor));
  for (const d of [1.5, 2.5]) out.push(freeHopPiece(`free-gap-diag-${d.toFixed(1)}`, 'diag', d, floor));
  for (const d of [2, 3]) out.push(freeHopPiece(`free-gap-behind-${d.toFixed(1)}`, 'behind', d, floor));
  for (const s of [1, 1.25]) out.push(freeLadderPiece(`free-ladder-${f1(s)}`, s, false, floor));
  out.push(freeLadderPiece('free-ladder-zigzag-1', 1, true, floor));
  out.push(traversePiece('traverse-braced', true, floor));
  out.push(traversePiece('traverse-free', false, floor));
  out.push(climbingWallPiece('climbwall-braced', true, 0.7, floor));
  out.push(climbingWallPiece('climbwall-free', false, 0.7, floor));
  out.push(climbingWallPiece('climbwall-braced-small', true, 0.45, floor));
  out.push(climbingWallPiece('climbwall-free-small', false, 0.45, floor));
  return out;
}

/** Every id the extra rows have, in their order. */
export function extraIds(): string[] {
  return extraPieces(1).map((p) => p.id);
}

// ---- Climbing II, phase 4 (maker B): the rope's landings (`ropeLands`) ------------------------------------------------------

/** The rope landings' row (after every other, so no piece before it moves). */
export const ROPE_LAND_ROW = 'rope landings';
/** Where the landings' rope hangs from: its beam's underside over the piece's floor, at z `ROPE_LAND_AT` (its length the slider's, 8 m: its end half a metre over the floor). */
export const ROPE_LAND_ANCHOR = 8.5;
export const ROPE_LAND_AT = 5;
/**
 * How far ahead of the rope's line the landing platform's face stands, metres: just past the front of the swing the default push
 * settles at (33 degrees on this rope, its front 4.0 m out, the hanging capsule's own 0.37 m more), so the swing never meets it.
 */
export const ROPE_LAND_FACE = 4.5;
/** The fixer: the let-go the landings' platforms are laid for, radians: on the forward swing at 28 degrees (the proof's). */
export const ROPE_LAND_LET_GO = (28 * Math.PI) / 180;
/** The standing capsule's middle over its feet, metres (src/player/ledge.ts's `LEDGE_CAPSULE`, r and stand: climbRopesLand.test.ts holds the two equal). */
export const ROPE_LAND_MID = 0.8;
/**
 * The fixer: each band's lip over the feet at the let-go a platform is laid at, metres for a figure of the human male's own size
 * and scaled with the figure, as the bands are: the middle of each band at the bands' starting edges (knee 0.2 to 0.45, between
 * to 0.78, waist to 1.1), the level top a little under the feet (the flight comes down onto it from above, or meets its edge).
 * The middles, because where the flight meets a face is the let-go's feet give or take a tenth of a metre by how long the swing
 * was pumped (a swing pumped longer flies higher, as does a longer figure's: measured, 9 s of A leaves the human male's at 33.5
 * degrees and one a twentieth taller at 35.6, and the flight's last few hundredths of a metre fall in the one and rise in the
 * other). Laid at the bands' lower parts, as they were, a taller figure or a longer pump landed each a band lower (the review's
 * human male at the height slider's top, `figureScaleOf` 1.11, landed the knee piece level).
 */
export const ROPE_LAND_LIPS = { level: -0.2, knee: 0.325, between: 0.615, waist: 0.94 } as const;

/**
 * The fixer: the feet's height over the floor at the let-go (`ROPE_LAND_LET_GO`) for a figure of scale `k` that grabbed the rope
 * standing on the floor (src/player/ropeSwing.ts's grab: the hands `ROPE_FACTS.grip` over the feet, the body's middle
 * `ROPE_FACTS.hang` under them, both scaled; the rope's stretch at that grip `climb.ropeGive` over `climb.ropeLength`), metres.
 */
export function ropeLandFeet(k: number): number {
  const s = ROPE_LAND_ANCHOR - ROPE_FACTS.grip * k;
  const e = CLIMB_TUNE.ropeGive * (s / Math.max(1e-3, CLIMB_TUNE.ropeLength));
  const R = s + e + ROPE_FACTS.hang * k;
  return ROPE_LAND_ANCHOR - R * Math.cos(ROPE_LAND_LET_GO) - ROPE_LAND_MID;
}

/** The fixer: each landing's platform top over the floor for a figure of scale `k`: its band's lip (scaled) over the feet at the let-go, to the centimetre. */
export function ropeLandTops(k = 1): { level: number; knee: number; between: number; waist: number } {
  const f = ropeLandFeet(k);
  const at = (lip: number) => Math.round((f + lip * k) * 100) / 100;
  const L = ROPE_LAND_LIPS;
  return { level: at(L.level), knee: at(L.knee), between: at(L.between), waist: at(L.waist) };
}

/** Each landing's platform top over the floor, metres, for the human male's own size (the harness's figure). */
export const ROPE_LAND_TOPS = ropeLandTops(1);

/**
 * A rope's landing (the brief's "lips at level, knee, between and waist"): the rope from a beam `ROPE_LAND_ANCHOR` over level floor
 * (a column standing in for it while ropes are off, as the rope piece's), the body starting under it, and a platform 4 m wide and
 * 3 m deep with its face `ROPE_LAND_FACE` ahead at `top` over the floor; `top` null, nothing ahead at all (the fall with no lip).
 */
function ropeLandPiece(id: string, band: string, top: number | null, floor: number): CoursePiece {
  const r = 0.02;
  const z = ROPE_LAND_AT;
  const solids: CourseSolid[] = [aabb('beam', -1, ROPE_LAND_ANCHOR, z - 0.1, 1, ROPE_LAND_ANCHOR + 0.2, z + 0.1), aabb('rope', -r, 0.5, z - r, r, ROPE_LAND_ANCHOR, z + r)];
  const lips: CourseLip[] = [];
  if (top !== null) {
    solids.push(aabb('platform', -2, 0, z + ROPE_LAND_FACE, 2, top, z + ROPE_LAND_FACE + 3));
    lips.push(frontLip('L', -2, 2, top, z + ROPE_LAND_FACE));
  }
  const numbers: CoursePiece['numbers'] = { band, anchor: ROPE_LAND_ANCHOR, face: ROPE_LAND_FACE };
  if (top !== null) numbers.top = top;
  return piece(id, 'rope', ROPE_LAND_ROW, solids, lips, [{ name: 'stand', at: [0, 0, round(z - 0.3)], face: [0, 1] }], numbers, floor);
}

/** The rope landings' pieces, in their order, laid for a figure of scale `k`. */
function ropeLandPieces(floor: number, k = 1): CoursePiece[] {
  const T = ropeLandTops(k);
  return [
    ropeLandPiece('rope-land-level', 'level', T.level, floor),
    ropeLandPiece('rope-land-knee', 'knee', T.knee, floor),
    ropeLandPiece('rope-land-between', 'between', T.between, floor),
    ropeLandPiece('rope-land-waist', 'waist', T.waist, floor),
    ropeLandPiece('rope-land-none', 'none', null, floor),
  ];
}

/** Every id the rope landings' row has, in its order. */
export function ropeLandIds(): string[] {
  return ropeLandPieces(1).map((p) => p.id);
}
