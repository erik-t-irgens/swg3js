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

/** What a piece is for (the design's list). */
export type CourseKind = 'lip' | 'wall' | 'corner' | 'slope' | 'steps' | 'gap' | 'bar' | 'rope' | 'pole' | 'obstacle' | 'run';

/** What a solid is to its piece (the floor slab every piece stands on, and what stands on it). */
export type SolidRole = 'floor' | 'wall' | 'plate' | 'platform' | 'bar' | 'beam' | 'rope' | 'pole' | 'obstacle';

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
  return out;
}

/** Every id the course has, in its order. */
export function courseIds(): string[] {
  return allPieces(1, CLIMB_TUNE.lipSlope, TODAY_REACH).map((p) => p.id);
}

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
