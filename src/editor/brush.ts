// The world editor's scatter brush (DESIGN.md §2.8, research5 §4.7): trees, rocks and shrubs painted toward a density.
//
// B arms it with the library's chosen entries and their weights; a ring of 48 ground points under the aim is drawn on
// the overlay; **LMB held paints, RMB held erases** (Unreal's foliage paint with its Shift moved off: Shift is the fast
// flight). A stroke draws from a seed of its own (`brushRandom`), so the same seed over the same ground gives the same
// rows, and is one undo entry; its stamps come `rate` times a second whatever the frame rate (`stampsDue`). A paint stamp
// fills the disc **toward the target density, counting the rows of the brush's own entries that stand in it**, never past
// it: every candidate a fixed number of draws from the generator, kept only where it is `spacing` from everything standing
// and every plant of the stamp, on ground whose slope (and height, where asked) is within the filters, off the drawn water
// unless its model is meant for water (the radial flora's own rule, `MEANT_FOR_WATER`), and off what stands (its boxes).
// An erase stamp takes each row of its own entries in the disc with the chance `eraseShare`. Roads and rivers are not kept
// off this pass: the terrain has no query for them (Map-maker II's paint layers).
//
// Every number is the owner's (`BRUSH_TUNE`, `editorTune.ts`): live through `__debug.editor({ tune: { brush } })` and a
// slider each under `editor` in the debug menu, never chosen by measuring.
//
// Pure: no three, no DOM, nothing of the game's. The ring writes into kept arrays and makes nothing a frame. Rule for this
// file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no constructor
// parameter properties.

import { MEANT_FOR_WATER } from '../world/grassMath.ts';

/** The brush's numbers (`BRUSH_TUNE`): every one live. */
export interface BrushTune {
  /** The disc's radius, metres. */
  radius: number;
  /** The target, rows of the brush's own entries per 100 m² (Unreal's per 1,000 × 1,000 units). */
  density: number;
  /** The least distance between two plants, and between a plant and anything standing, metres. */
  spacing: number;
  /** Stamps a second while a button is held, whatever the frame rate. */
  rate: number;
  /** A plant's yaw drawn at random; off, the camera's heading. */
  randomYaw: boolean;
  /** A plant's uniform scale drawn between these. */
  scaleMin: number;
  scaleMax: number;
  /** A plant's up leaned toward the ground's by at most `alignMax` degrees. */
  align: boolean;
  alignMax: number;
  /** The ground's slope a plant may stand on, degrees. */
  slopeMin: number;
  slopeMax: number;
  /** With `heightOn`, the ground's height (absolute, metres) a plant may stand at. */
  heightOn: boolean;
  heightMin: number;
  heightMax: number;
  /** Never on the drawn water, unless the model is meant for it. */
  keepOffWater: boolean;
  /** Never inside what stands (a placed object's box). */
  keepOffStanding: boolean;
  /** Never on a road's flat part or a river's bed (Map-maker II's fourth wave: the generator's road byte). */
  keepOffRoads: boolean;
  /** The share of its own rows in the disc an erase stamp takes. */
  eraseShare: number;
  /** Candidates tried a plant still wanted: how hard a stamp looks before it gives the rest up. */
  tries: number;
}

/**
 * A seeded generator (mulberry32): the same seed gives the same draws, so a stroke is reproducible. Floats in [0, 1).
 * Its state is a closure's: one is made a stroke, never a frame.
 */
export function brushRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One entry the brush paints with: its library key, its weight among the rest, and whether its model is meant for water. */
export interface BrushEntry {
  key: string;
  weight: number;
  water: boolean;
}

/** Whether a model or entry id is meant for the water (the radial flora's own rule: reeds, cattails, lilies, the underwater). */
export function meantForWater(id: string): boolean {
  return MEANT_FOR_WATER.test(id);
}

/** An entry drawn by weight from `u` in [0, 1): the first whose running weight passes `u` of the whole; -1 for none. */
export function pickEntry(entries: readonly BrushEntry[], u: number): number {
  let total = 0;
  for (const e of entries) if (e.weight > 0) total += e.weight;
  if (!(total > 0)) return -1;
  let at = u * total;
  for (let i = 0; i < entries.length; i++) {
    const w = entries[i].weight;
    if (!(w > 0)) continue;
    if (at < w) return i;
    at -= w;
  }
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].weight > 0) return i;
  return -1;
}

/** What stands near the disc: a place, and whether it is a row of the brush's own entries (counted toward the density). */
export interface BrushNear {
  x: number;
  z: number;
  mine: boolean;
}

/** What the brush asks of the world at a point. */
export interface BrushGround {
  /** The ground's height, NaN where it is not known. */
  ground(x: number, z: number): number;
  /** The drawn water's height there (NaN or -Infinity for none). */
  water(x: number, z: number): number;
  /** Whether the point stands inside what stands there (a placed object's box). */
  blocked(x: number, z: number): boolean;
  /**
   * Whether a road's flat part or a river's bed reaches the point (Map-maker II's fourth wave: the generator's road byte,
   * from the cached ground); absent, or null for ground not cached, is no road.
   */
  road?(x: number, z: number): boolean | null;
}

/** One plant a paint stamp puts down: which entry, where (on the ground), its yaw, its scale and the ground's up there. */
export interface BrushPlant {
  entry: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  nx: number;
  ny: number;
  nz: number;
}

/** How many rows of its own entries the disc holds at the density: `density` per 100 m² over πr², rounded. */
export function brushTarget(tune: Pick<BrushTune, 'radius' | 'density'>): number {
  const r = Math.max(0, tune.radius);
  return Math.max(0, Math.round((Math.max(0, tune.density) / 100) * Math.PI * r * r));
}

/** How many of `near` are the brush's own within its disc. */
export function brushCount(cx: number, cz: number, radius: number, near: readonly BrushNear[]): number {
  let n = 0;
  const r2 = radius * radius;
  for (const p of near) if (p.mine && (p.x - cx) ** 2 + (p.z - cz) ** 2 <= r2) n++;
  return n;
}

/**
 * One paint stamp centred at (`cx`, `cz`): the plants that take the disc toward its target density, counting the brush's
 * own rows standing in it (`near`, `mine`), never past it. Each candidate takes the same draws of `rand` in the same
 * order (a place, an entry, a yaw, a scale), so a seed decides a stroke; it is kept only `spacing` from everything near and
 * every plant already kept, on known ground, within the slope (from the ground's normal, four samples half a metre out)
 * and the height when asked, off the drawn water unless its entry is meant for it, and off what stands. At most `tries`
 * candidates a plant wanted. `cameraYaw` is the yaw with `randomYaw` off. Allocates its answer: a stamp is a press-rate
 * event, never a frame.
 */
export function paintStamp(tune: BrushTune, cx: number, cz: number, entries: readonly BrushEntry[], near: readonly BrushNear[], ground: BrushGround, rand: () => number, cameraYaw: number): BrushPlant[] {
  const out: BrushPlant[] = [];
  if (!entries.length) return out;
  const r = Math.max(0, tune.radius);
  const need = brushTarget(tune) - brushCount(cx, cz, r, near);
  if (need <= 0 || !(r > 0)) return out;
  const sp = Math.max(0, tune.spacing);
  const sp2 = sp * sp;
  const tries = Math.max(1, Math.ceil(need * Math.max(1, tune.tries)));
  const slopeMin = tune.slopeMin;
  const slopeMax = tune.slopeMax;
  const sLo = Math.min(tune.scaleMin, tune.scaleMax);
  const sHi = Math.max(tune.scaleMin, tune.scaleMax);
  const e = 0.5;
  for (let t = 0; t < tries && out.length < need; t++) {
    // The candidate's draws, always all four, so the seed alone decides what comes after.
    const u = rand();
    const a = rand() * Math.PI * 2;
    const pick = pickEntry(entries, rand());
    const yawU = rand();
    const scaleU = rand();
    const d = r * Math.sqrt(u);
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (pick < 0) continue;
    let clear = true;
    for (const p of near) {
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < sp2) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    for (const p of out) {
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < sp2) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    const y = ground.ground(x, z);
    if (!Number.isFinite(y)) continue;
    if (tune.heightOn && (y < tune.heightMin || y > tune.heightMax)) continue;
    if (tune.keepOffWater && !entries[pick].water) {
      const w = ground.water(x, z);
      if (Number.isFinite(w) && w > y) continue;
    }
    // The slope, from the ground's own normal.
    const hx0 = ground.ground(x - e, z);
    const hx1 = ground.ground(x + e, z);
    const hz0 = ground.ground(x, z - e);
    const hz1 = ground.ground(x, z + e);
    const gx = (hx1 - hx0) / (2 * e);
    const gz = (hz1 - hz0) / (2 * e);
    const fx = Number.isFinite(gx) ? gx : 0;
    const fz = Number.isFinite(gz) ? gz : 0;
    const nl = Math.sqrt(fx * fx + 1 + fz * fz);
    const ny = 1 / nl;
    const slope = (Math.acos(Math.min(1, ny)) * 180) / Math.PI;
    if (slope < slopeMin || slope > slopeMax) continue;
    if (tune.keepOffStanding && ground.blocked(x, z)) continue;
    // Off a road or a river (the fourth wave), asked last so a candidate refused by anything else asks nothing.
    if (tune.keepOffRoads && ground.road && ground.road(x, z) === true) continue;
    out.push({ entry: pick, x, y, z, yaw: tune.randomYaw ? yawU * Math.PI * 2 : cameraYaw, scale: sLo + scaleU * (sHi - sLo), nx: -fx / nl, ny, nz: -fz / nl });
  }
  return out;
}

/**
 * One erase stamp centred at (`cx`, `cz`): of `near`, the brush's own rows within its disc, each taken with the chance
 * `eraseShare` (one draw of `rand` a row, in their order, so a seed decides it). Answers their indices in `near`.
 */
export function eraseStamp(tune: Pick<BrushTune, 'radius' | 'eraseShare'>, cx: number, cz: number, near: readonly BrushNear[], rand: () => number): number[] {
  const out: number[] = [];
  const r2 = tune.radius * tune.radius;
  const share = Math.min(1, Math.max(0, tune.eraseShare));
  for (let i = 0; i < near.length; i++) {
    const p = near[i];
    if (!p.mine || (p.x - cx) ** 2 + (p.z - cz) ** 2 > r2) continue;
    if (rand() < share) out.push(i);
  }
  return out;
}

/** How near a whole stamp the clock's owed share counts as it (`stampsDue`): far past a frame sum's rounding, far under any real share of a stamp. */
const STAMP_HAIR = 1e-9;

/** A stroke's clock: the seconds owed toward the next stamp. Kept, one a brush. */
export interface BrushClock {
  owed: number;
}

/**
 * How many stamps are due this frame of `dt` seconds at `rate` a second (written into the clock): the seconds owed carried
 * from frame to frame, so stamps come at the same rate at any frame rate; at most `most` a frame, and nothing owed carried
 * past them, so a long frame does not stamp on and on after. The first frame of a stroke owes a whole stamp (`start`).
 */
export function stampsDue(clock: BrushClock, dt: number, rate: number, most = 4): number {
  if (!(rate > 0) || !(dt >= 0)) return 0;
  clock.owed += dt * rate;
  // A whole stamp owed to within a hair counts: a sum of `dt * rate` over frames lands a few units in the last place short of
  // the whole number it stands for (144 frames of 1/144 at 30 a second sum to 30.999999999999996), and floored it lost a
  // stamp at 144 frames a second that 30, 60 and 120 kept. Nothing is owed a hair under nought for long: the next frame adds.
  let n = Math.floor(clock.owed + STAMP_HAIR);
  if (n > most) n = most;
  clock.owed -= n;
  if (clock.owed > 1) clock.owed = 1;
  return n;
}

/** A stroke begun: its first frame stamps at once. */
export function startClock(clock: BrushClock): void {
  clock.owed = 1;
}

/** How many points the ring is drawn through. */
export const RING_STEPS = 48;

/** What the ring asks of the ground: the height at a point, NaN where it is not known (the caller's cache, never a block made). */
export interface RingGround {
  /** A kept record the caller fills: the point asked, and the height it answers into `y`. */
  readonly at: { x: number; z: number; y: number };
  sample(): void;
}

/**
 * What the ring is asked, one kept record the caller writes a frame: its middle (`cx`, `cy`, `cz`), its radius and the
 * screen it is drawn on (`w` by `h`). Its numbers ride a record rather than the call, since a number handed to a call the
 * compiler leaves out is boxed. Fractions from the start.
 */
export interface RingAsk {
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  w: number;
  h: number;
}

/** A ring's ask, made once. */
export function ringAsk(): RingAsk {
  return { cx: 0.5, cy: 0.5, cz: 0.5, radius: 0.5, w: 0.5, h: 0.5 };
}

/**
 * The ring: `RING_STEPS` points round (`cx`, `cz`) at `radius`, each on the ground (`g`, the centre's own `cy` where it is
 * not known), projected through `vp` (three's column-major view-projection) onto a screen `w` by `h` into `out` (two a
 * point), `vis` one where the point is in front of the eye. Nothing is made.
 */
export function brushRing(ask: RingAsk, g: RingGround, vp: ArrayLike<number>, out: Float64Array, vis: Uint8Array): void {
  const cx = ask.cx;
  const cy = ask.cy;
  const cz = ask.cz;
  const radius = ask.radius;
  const w = ask.w;
  const h = ask.h;
  const at = g.at;
  for (let i = 0; i < RING_STEPS; i++) {
    const a = (i / RING_STEPS) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const z = cz + Math.sin(a) * radius;
    at.x = x;
    at.z = z;
    at.y = Number.NaN;
    g.sample();
    const y = Number.isFinite(at.y) ? at.y + 0.05 : cy;
    const px = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    const py = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    const pw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (!(pw > 1e-6)) {
      vis[i] = 0;
      continue;
    }
    vis[i] = 1;
    out[i * 2] = (px / pw * 0.5 + 0.5) * w;
    out[i * 2 + 1] = (0.5 - py / pw * 0.5) * h;
  }
}
