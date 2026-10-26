// The world editor's aim (DESIGN.md §2.3): the ray through the crosshair (Fly) or the cursor (Point), resolved after the
// camera is placed so the hit is this frame's, tested nearest first against, in this order where two meet at once:
//
//   1. the editor's handles (W2), in screen space;
//   2. the **turned boxes** of what can be picked (the permanent rows; the world's own objects only with the World filter,
//      W2): each model's own box turned the way it stands, never the snapshot's radius;
//   3. what stands still in the physics (a shut door is a wall), only the colliders that exist near the anchor;
//   4. the drawn water;
//   5. the terrain, marched along the ray (`heightIfCached` a frame, which works wherever a block is cached);
//   6. nothing: a point `skyReach` along the ray, which the wheel pushes out and pulls in.
//
// **A frame makes nothing.** A number handed across a call the compiler does not build in is boxed, so everything the
// frame works out goes through kept records and is written into their fields: the ray (`AimRay`), the turned box's
// answer (`turnedBoxHit` writes `ray.t`), the ground and the water at a point (`AimSample`), the engine's cast
// (`StillHit`) and the rectangle the streamer's region walk is handed. `editorAllocOwn.ts` measures it with the engine's
// cast and the terrain stood in. The plain forms (`rayTurnedBox`, `marchSurface`, `resolveAim`) are the same arithmetic
// over the same records, for the tests and the console.
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension,
// no enum, no namespace, no constructor parameter properties.

/** What the aim met, in the order two at one distance are taken. */
export const AIM_ORDER = ['handle', 'box', 'still', 'water', 'terrain', 'sky'] as const;
export type AimKind = (typeof AIM_ORDER)[number];

/** A ray, kept: its origin, its unit direction, how far it reaches, the uniform scale of the box it is tested against, and the answer. */
export interface AimRay {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  len: number;
  s: number;
  t: number;
}

/** A ray with nothing in it, its fields made doubles from the start (a field that starts whole boxes the first fraction). */
export function aimRay(): AimRay {
  return { ox: 0.5, oy: 0.5, oz: 0.5, dx: 0.5, dy: 0.5, dz: 0.5, len: 0.5, s: 1.5, t: 0.5 };
}

/** Just enough of a placed object for its turned box: where it stands, how it is turned, and whose it is. */
export interface BoxedThing {
  x: number;
  y: number;
  z: number;
  q: { x: number; y: number; z: number; w: number };
  template: string;
}

/**
 * Where the ray in `r` first meets a box turned and placed, written into `r.t` (Infinity for never): the box `b.min`..
 * `b.max` (either corner may come first, the BOX lesson) in its own frame, stood at `o`'s place, turned by its
 * quaternion (three's x, y, z, w), scaled uniformly by `r.s`, met within `r.len`. A ray starting inside the box meets it
 * at nought. Nothing is made.
 */
export function turnedBoxHit(r: AimRay, o: BoxedThing, b: { min: ArrayLike<number>; max: ArrayLike<number> }): void {
  const q = o.q;
  const sc = r.s > 0 ? 1 / r.s : 1;
  const cx = -q.x;
  const cy = -q.y;
  const cz = -q.z;
  const cw = q.w;
  // The ray into the box's own frame: v' = q⁻¹ (v - p) / s, by the conjugate's rotation written out (t = 2 c × v;
  // v' = v + w t + c × t).
  let vx = r.ox - o.x;
  let vy = r.oy - o.y;
  let vz = r.oz - o.z;
  let tx = 2 * (cy * vz - cz * vy);
  let ty = 2 * (cz * vx - cx * vz);
  let tz = 2 * (cx * vy - cy * vx);
  const lox = (vx + cw * tx + (cy * tz - cz * ty)) * sc;
  const loy = (vy + cw * ty + (cz * tx - cx * tz)) * sc;
  const loz = (vz + cw * tz + (cx * ty - cy * tx)) * sc;
  vx = r.dx;
  vy = r.dy;
  vz = r.dz;
  tx = 2 * (cy * vz - cz * vy);
  ty = 2 * (cz * vx - cx * vz);
  tz = 2 * (cx * vy - cy * vx);
  const ldx = (vx + cw * tx + (cy * tz - cz * ty)) * sc;
  const ldy = (vy + cw * ty + (cz * tx - cx * tz)) * sc;
  const ldz = (vz + cw * tz + (cx * ty - cy * tx)) * sc;
  let t0 = 0;
  let t1 = r.len;
  for (let k = 0; k < 3; k++) {
    const lo = Math.min(b.min[k], b.max[k]);
    const hi = Math.max(b.min[k], b.max[k]);
    const org = k === 0 ? lox : k === 1 ? loy : loz;
    const d = k === 0 ? ldx : k === 1 ? ldy : ldz;
    if (Math.abs(d) < 1e-12) {
      if (org < lo || org > hi) {
        r.t = Infinity;
        return;
      }
      continue;
    }
    let a = (lo - org) / d;
    let bb = (hi - org) / d;
    if (a > bb) {
      const c = a;
      a = bb;
      bb = c;
    }
    if (a > t0) t0 = a;
    if (bb < t1) t1 = bb;
    if (t0 > t1) {
      r.t = Infinity;
      return;
    }
  }
  r.t = t0;
}

const PLAIN_RAY = aimRay();
const PLAIN_THING: BoxedThing = { x: 0.5, y: 0.5, z: 0.5, q: { x: 0.5, y: 0.5, z: 0.5, w: 0.5 }, template: '' };
const PLAIN_BOX: { min: ArrayLike<number>; max: ArrayLike<number> } = { min: [0, 0, 0], max: [0, 0, 0] };

/**
 * `turnedBoxHit` as a plain function, for the tests and the console: where a ray from `o` along unit `d` first meets a box
 * `min`..`max` stood at `p`, turned by `q`, scaled by `s`, within `reach`, or Infinity.
 */
export function rayTurnedBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number, min: ArrayLike<number>, max: ArrayLike<number>, s: number, reach: number): number {
  const r = PLAIN_RAY;
  r.ox = ox;
  r.oy = oy;
  r.oz = oz;
  r.dx = dx;
  r.dy = dy;
  r.dz = dz;
  r.len = reach;
  r.s = s;
  const o = PLAIN_THING;
  o.x = px;
  o.y = py;
  o.z = pz;
  o.q.x = qx;
  o.q.y = qy;
  o.q.z = qz;
  o.q.w = qw;
  PLAIN_BOX.min = min;
  PLAIN_BOX.max = max;
  turnedBoxHit(r, o, PLAIN_BOX);
  return r.t;
}

/** The ground and the drawn water at a point, kept: the port writes `ground` and `water` for `x`, `z` (NaN for an unknown ground, -Infinity for no water). */
export interface AimSample {
  x: number;
  z: number;
  /** The ray's height at the point, which the march compares with the surface (the port leaves it alone). */
  y: number;
  ground: number;
  water: number;
}

/** A sample with nothing in it, its fields doubles. */
export function aimSample(): AimSample {
  return { x: 0.5, z: 0.5, y: 0.5, ground: 0.5, water: 0.5 };
}

/** What the march answers, kept: how far along the ray, and whether the surface met was the drawn water. */
export interface SurfaceHit {
  t: number;
  water: boolean;
}

/** The march's halving: its two ends and its middle, as unboxed doubles. */
const HALVES = new Float64Array(3);

/** +1 the sample's point (at its own `y`) is over the surface (the ground or the water over it), -1 under it, 0 where no ground is known. Its height rides in the record: a number handed across a call the compiler leaves out is boxed. */
function aboveSample(p: AimSample): number {
  const y = p.y;
  const g = p.ground;
  if (!(g === g) || !Number.isFinite(g)) return 0;
  const w = p.water;
  const top = w === w && Number.isFinite(w) && w > g ? w : g;
  return y > top ? 1 : -1;
}

/**
 * Where the ray in `r` first goes under the ground or the drawn water, marched in steps of `tune.marchStep` metres out to
 * `r.len` and the crossing halved down to `tune.marchTol`, written into `out` (`t` Infinity for none). `sample` fills `p` for `p.x`, `p.z`; a
 * point with no ground known (an uncached block: a frame's march never generates one) is passed over. The water is met
 * where it stands over the ground. Nothing is made.
 */
export function marchRay(r: AimRay, tune: { marchStep: number; marchTol: number }, sample: (p: AimSample) => void, p: AimSample, out: SurfaceHit): void {
  out.t = Infinity;
  out.water = false;
  // The tune is handed whole: a number read out of a field and handed across a call the compiler leaves out is boxed.
  const step = tune.marchStep;
  const tol = tune.marchTol;
  const st = step > 0 ? step : 4;
  const reach = r.len;
  let prev = 0;
  p.x = r.ox;
  p.z = r.oz;
  sample(p);
  p.y = r.oy;
  let prevAbove = aboveSample(p);
  for (let t = st; t <= reach + st * 0.5; t += st) {
    const tt = t > reach ? reach : t;
    p.x = r.ox + r.dx * tt;
    p.z = r.oz + r.dz * tt;
    sample(p);
    p.y = r.oy + r.dy * tt;
    const a = aboveSample(p);
    if (a === 0) {
      prevAbove = a;
      prev = tt;
      continue;
    }
    if (a < 0 && prevAbove > 0) {
      // Halved down between the last sample above and this one under. The two ends live in a typed array: kept as
      // locals that start whole (the march's steps are whole metres) and turn fractional halfway, the compiler keeps
      // them tagged and boxes every half (28 B a frame, measured).
      const h = HALVES;
      h[0] = prev;
      h[1] = tt;
      while (h[1] - h[0] > tol) {
        h[2] = (h[0] + h[1]) / 2;
        p.x = r.ox + r.dx * h[2];
        p.z = r.oz + r.dz * h[2];
        sample(p);
        p.y = r.oy + r.dy * h[2];
        if (aboveSample(p) < 0) h[1] = h[2];
        else h[0] = h[2];
      }
      const hi = h[1];
      out.t = hi;
      p.x = r.ox + r.dx * hi;
      p.z = r.oz + r.dz * hi;
      sample(p);
      const g = p.ground;
      const w = p.water;
      out.water = Number.isFinite(w) && (!Number.isFinite(g) || w > g);
      return;
    }
    prevAbove = a;
    prev = tt;
    if (tt >= reach) break;
  }
}

const MARCH_RAY = aimRay();
const MARCH_SAMPLE = aimSample();
const MARCH_TUNE = { marchStep: 4.5, marchTol: 0.5 };

/**
 * `marchRay` as a plain function, for the tests: `ground(x, z)` and `water(x, z)` answer a height, NaN where nothing is
 * known. Written into `out`.
 */
export function marchSurface(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number, step: number, tol: number, ground: (x: number, z: number) => number, water: (x: number, z: number) => number, out: SurfaceHit): SurfaceHit {
  const r = MARCH_RAY;
  r.ox = ox;
  r.oy = oy;
  r.oz = oz;
  r.dx = dx;
  r.dy = dy;
  r.dz = dz;
  r.len = reach;
  MARCH_TUNE.marchStep = step;
  MARCH_TUNE.marchTol = tol;
  marchRay(
    r,
    MARCH_TUNE,
    (p) => {
      p.ground = ground(p.x, p.z);
      p.water = water(p.x, p.z);
    },
    MARCH_SAMPLE,
    out,
  );
  return out;
}

/** One frame's distances, one a kind, Infinity for none: what the answer is chosen among. */
export interface AimCandidates {
  handle: number;
  box: number;
  still: number;
  water: number;
  terrain: number;
}

/**
 * The aim's answer: the nearest of the frame's candidates, two at one distance taken in `AIM_ORDER`'s order, or the sky
 * where none met anything within the reach. Answers the kind and writes its distance into `out.t` (the sky's own reach
 * for the sky, `out.sky`).
 */
export function resolveIn(c: AimCandidates, out: { kind: AimKind; t: number; sky: number }): AimKind {
  let kind: AimKind = 'sky';
  let t = Infinity;
  // In the order: a strictly nearer one wins, so the first of two at one distance stands.
  if (c.handle < t) {
    t = c.handle;
    kind = 'handle';
  }
  if (c.box < t) {
    t = c.box;
    kind = 'box';
  }
  if (c.still < t) {
    t = c.still;
    kind = 'still';
  }
  if (c.water < t) {
    t = c.water;
    kind = 'water';
  }
  if (c.terrain < t) {
    t = c.terrain;
    kind = 'terrain';
  }
  out.kind = kind;
  out.t = kind === 'sky' ? out.sky : t;
  return kind;
}

const RESOLVE = { kind: 'sky' as AimKind, t: 0.5, sky: 0.5 };

/** `resolveIn` as a plain function: the kind, its distance written into `out.t`. */
export function resolveAim(c: AimCandidates, skyReach: number, out: { kind: AimKind; t: number }): { kind: AimKind; t: number } {
  RESOLVE.sky = skyReach;
  resolveIn(c, RESOLVE);
  out.kind = RESOLVE.kind;
  out.t = RESOLVE.t;
  return out;
}

/**
 * The turned-box walk of one frame's ray over what the streamer files (`LayoutStreamer.forEachPlacedIn`): every thing
 * the filter takes, tested with `turnedBoxHit` against its own box (`boxOf`, the streamer's kept answer), the nearest
 * kept. `visit` is made once with the walk and handed to the streamer every frame; `begin` sets the ray. Past `most`
 * things tested in one walk the rest are left for another frame (the hover then runs at `hover.hz`). A box the eye
 * stands inside (a building flown into) is not what the aim rests on: its walls are. Nothing is made.
 */
export class BoxWalk<T extends BoxedThing> {
  /** The ray this walk tests, kept. */
  readonly ray: AimRay = aimRay();
  /** The nearest met this walk, and how far; null and Infinity for none. */
  best: T | null = null;
  bestT = Infinity;
  /** How many things were tested this walk. */
  tested = 0;
  most = 5000;
  readonly boxOf: (o: T) => { min: ArrayLike<number>; max: ArrayLike<number> } | null;
  readonly takes: (o: T) => boolean;
  readonly visit: (o: T) => boolean;

  constructor(boxOf: (o: T) => { min: ArrayLike<number>; max: ArrayLike<number> } | null, takes: (o: T) => boolean) {
    this.boxOf = boxOf;
    this.takes = takes;
    this.ray.s = 1;
    this.visit = (o: T): boolean => {
      if (!this.takes(o)) return true;
      if (this.tested >= this.most) return false;
      this.tested++;
      const b = this.boxOf(o);
      if (!b) return true;
      const r = this.ray;
      turnedBoxHit(r, o, b);
      if (r.t > 0 && r.t < this.bestT) {
        this.bestT = r.t;
        this.best = o;
      }
      return true;
    };
  }

  /** A new walk along `r`, as far as `r.len` (a number handed across a call is boxed, so the reach rides on the ray), testing at most `most`. */
  beginRay(r: AimRay, most: number): void {
    const w = this.ray;
    w.ox = r.ox;
    w.oy = r.oy;
    w.oz = r.oz;
    w.dx = r.dx;
    w.dy = r.dy;
    w.dz = r.dz;
    w.len = r.len;
    w.s = 1;
    this.most = most;
    this.best = null;
    this.bestT = Infinity;
    this.tested = 0;
  }

  /** A new walk, the ray as plain numbers (the tests'). */
  begin(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number, most: number): void {
    const r = PLAIN_RAY;
    r.ox = ox;
    r.oy = oy;
    r.oz = oz;
    r.dx = dx;
    r.dy = dy;
    r.dz = dz;
    r.len = reach;
    this.beginRay(r, most);
  }
}

/** What stands still met by the engine's cast, as `Physics.aimHit` writes it. */
export interface StillHit {
  toi: number;
  nx: number;
  ny: number;
  nz: number;
  handle: number;
}

/** A rectangle of the game's frame, kept: what the streamer's region walk is handed. */
export interface AimRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** What one frame's aim asks of the world, handed in, each over a kept record: the engine's cast, the ground and the water, the region walk. */
export interface AimPorts<T extends BoxedThing> {
  /** What stands still along `r` within `r.len`, written into `out`: false for nothing. */
  cast(r: AimRay, inside: boolean, out: StillHit): boolean;
  /** The ground's height (NaN where no block is cached) and the drawn water's (-Infinity for none) at `p.x`, `p.z`, into `p`. */
  sample(p: AimSample): void;
  /** Every object filed in the regions a rectangle touches (`LayoutStreamer.forEachPlacedIn`). */
  walk(rect: AimRect, visit: (o: T) => boolean): void;
}

/** One frame's switches for the aim, kept. */
export interface AimAsk {
  /** The eye stands in a room: the ground and the shells are left out, and the terrain is not marched. */
  inside: boolean;
  /** A space zone: there is no ground to march. */
  space: boolean;
  /** Where a ray that meets nothing puts its point. */
  skyReach: number;
  /** The clock, seconds, for the hover's rate past `hover.most`. */
  now: number;
}

/**
 * The world editor's aim, a frame at a time (DESIGN.md §2.3): what stands still first (the engine's one cast), then the
 * ground and the water marched, then the turned boxes of what can be picked walked **only as far as the nearest surface**
 * (a row behind a wall is not under the crosshair, and a walk to the aim's whole reach would visit every object of a
 * hundred regions), and the answer chosen in `AIM_ORDER`'s order. Everything is written into kept records; a frame makes
 * nothing of its own (`editorAllocOwn.ts`). The box walk's hover runs every frame while it tests no more than
 * `hover.most` boxes, and `hover.hz` times a second past that, the last answer kept between.
 */
export class EditorAim<T extends BoxedThing> {
  /** The ray the caller writes before `step`: origin, unit direction. */
  readonly ray: AimRay = aimRay();
  readonly cand: AimCandidates = { handle: Infinity, box: Infinity, still: Infinity, water: Infinity, terrain: Infinity };
  readonly answer: { kind: AimKind; t: number; sky: number } = { kind: 'sky', t: 0.5, sky: 0.5 };
  /** The point it met, and the surface's normal where one is known (the engine's; straight up for the ground and the water). */
  // Every field that holds a fraction starts as one: a field that starts whole boxes every fraction written into it after.
  readonly hit = { x: 0.5, y: 0.5, z: 0.5, nx: 0.5, ny: 0.5, nz: 0.5, handle: -1 };
  readonly still: StillHit = { toi: 0.5, nx: 0.5, ny: 0.5, nz: 0.5, handle: -1 };
  readonly surface: SurfaceHit = { t: Infinity, water: false };
  readonly boxes: BoxWalk<T>;
  /** What the aim rests on of what can be picked, and how far; null for nothing. */
  hover: T | null = null;
  hoverT = Infinity;
  private readonly ports: AimPorts<T>;
  private readonly sample = aimSample();
  private readonly rect: AimRect = { x0: 0.5, z0: 0.5, x1: 0.5, z1: 0.5 };
  private readonly fill: (p: AimSample) => void;
  private lastWalk = -Infinity;
  private crowded = false;

  constructor(ports: AimPorts<T>, boxOf: (o: T) => { min: ArrayLike<number>; max: ArrayLike<number> } | null, takes: (o: T) => boolean) {
    this.ports = ports;
    this.boxes = new BoxWalk<T>(boxOf, takes);
    this.fill = (p) => this.ports.sample(p);
  }

  /** One frame's aim along `ray` (written first). Answers the kind met; the point is `hit`. Nothing is made. */
  step(ask: AimAsk, tune: { reach: number; marchStep: number; marchTol: number }, hover: { most: number; hz: number }): AimKind {
    const r = this.ray;
    const c = this.cand;
    r.len = tune.reach;
    r.s = 1;
    c.handle = Infinity;
    c.box = Infinity;
    c.still = this.ports.cast(r, ask.inside, this.still) ? this.still.toi : Infinity;
    c.water = Infinity;
    c.terrain = Infinity;
    if (!ask.inside && !ask.space) {
      r.len = Math.min(tune.reach, c.still);
      marchRay(r, tune, this.fill, this.sample, this.surface);
      r.len = tune.reach;
      if (this.surface.t < Infinity) {
        if (this.surface.water) c.water = this.surface.t;
        else c.terrain = this.surface.t;
      }
    }
    // The boxes, walked only as far as the nearest surface (or the sky's reach, or the aim's whole reach past it).
    const near = Math.min(c.still, c.water, c.terrain);
    const walkTo = Math.min(tune.reach, near < Infinity ? near : Math.max(ask.skyReach, 400));
    if (!this.crowded || ask.now - this.lastWalk >= 1 / Math.max(1, hover.hz)) {
      const w = this.boxes;
      r.len = walkTo;
      w.beginRay(r, hover.most);
      r.len = tune.reach;
      const q = this.rect;
      const ex = r.ox + r.dx * walkTo;
      const ez = r.oz + r.dz * walkTo;
      q.x0 = Math.min(r.ox, ex);
      q.z0 = Math.min(r.oz, ez);
      q.x1 = Math.max(r.ox, ex);
      q.z1 = Math.max(r.oz, ez);
      this.ports.walk(q, w.visit);
      this.crowded = w.tested >= hover.most;
      this.lastWalk = ask.now;
      this.hover = w.best;
      this.hoverT = w.bestT;
    }
    if (this.hover && this.hoverT <= walkTo) c.box = this.hoverT;
    const a = this.answer;
    a.sky = ask.skyReach;
    const kind = resolveIn(c, a);
    const h = this.hit;
    h.x = r.ox + r.dx * a.t;
    h.y = r.oy + r.dy * a.t;
    h.z = r.oz + r.dz * a.t;
    h.handle = -1;
    if (kind === 'still') {
      h.nx = this.still.nx;
      h.ny = this.still.ny;
      h.nz = this.still.nz;
      h.handle = this.still.handle;
    } else {
      h.nx = 0;
      h.ny = 1;
      h.nz = 0;
    }
    return kind;
  }
}
