// A nebula as arithmetic: where its sheets stand, how deep the camera is inside one, when its
// lightning strikes and how hard a strike hits. Nothing here imports three or touches the DOM, so
// `tools/swg/tests/nebulaMath.test.ts` runs exactly the code the game runs.
//
// What comes from the client's own table (through the pack) is each nebula's place, size, density,
// the share of its sheets that face the camera, its two colour pairs, its camera shake, which of
// the two sheet looks it wears, how often it strikes, how long a strike lasts and the damage band a
// strike draws from. Everything else below is OURS and is marked so: how many sheets a nebula gets,
// how big they are and how they are spread, how a sheet fades near the camera and as it fills the
// screen, how far out a nebula is pulled in toward the camera, how deep "inside" counts, when
// inside a slot a strike falls, where its two ends sit, and the share of the table's damage a
// strike really does. Every one of them sits in NEBULA_TUNE, which `__debug.nebulae({...})` moves
// live so the owner can say "twice as thick" and have the number set from what they saw.
//
// The clock. A strike is not decided by a frame: the time line is cut into slots of one over the
// row's strike rate, and slot n's strike is a hash of the nebula's name and n. Two browsers on the
// same wall clock therefore see the same strikes at the same moments with nothing sent between
// them, which is how `weatherSchedule.ts` keeps the weather the same for everyone.
import type { Nebula, NebulaColour } from './spaceData.ts';

/** A sheet's colour: red, green, blue, alpha (the table stores alpha first; this is drawing order). */
export type SheetColour = [number, number, number, number];

/**
 * Every number in a nebula that the client's files do not give. INVENTED, all of them, and all live
 * through `__debug.nebulae({ ... })`.
 */
export const NEBULA_TUNE = {
  /** An overall multiplier on every nebula's sheet count: the "twice as thick" knob. */
  density: 1,
  /** An overall multiplier on every sheet's own alpha: the "too solid" knob, which costs nothing to move. */
  alpha: 1,
  /** count = density x (radius / 500)^1.5 x this, before the clamps. */
  sheetsPer500m: 24,
  sheetsMin: 6,
  sheetsMax: 96,
  /** The most sheets one zone may draw, shared out in proportion when the rows ask for more. */
  zoneSheets: 1500,
  /** A sheet's width across, as a share of its nebula's radius. */
  sizeMin: 0.35,
  sizeMax: 0.7,
  /**
   * How the sheets are spread inside the sphere: a sheet's distance from the middle is the radius
   * times a uniform number to this power. 1/3 would spread them evenly through the volume, so
   * anything under that crowds them toward the middle.
   */
  centrePower: 0.7,
  /** A nebula whose middle is farther than this (metres) is pulled in to it, and scaled by the same ratio. */
  pullFrom: 6000,
  /** A sheet fades out over this band of view depth (metres), so nothing is cut by the far plane. */
  farFadeFrom: 7200,
  farFadeTo: 8700,
  /** A sheet fades out as the camera comes within this band of its own width across. */
  nearFadeFrom: 0.1,
  nearFadeTo: 0.4,
  /** A sheet fades out as it grows past this share of the screen's height; gone by the second. */
  screenFadeFrom: 0.6,
  screenFadeTo: 1.3,
  /** How far into a nebula (as a share of its radius) counts as all the way inside. */
  insideOver: 0.6,
  /** The near shell: how solid it may get, how far out it stands (metres), and how fast its cloud drifts. */
  shellAlpha: 0.5,
  shellRadius: 30,
  shellDrift: 0.004,
  /** How large the haze's cloud is drawn across the view: smaller is a broader, softer cloud. */
  shellScale: 1.3,
  /**
   * The least of `shellAlpha` the haze keeps where its picture is at its thinnest, so the haze is a
   * fog rather than a set of holes. The rest of it follows the picture.
   */
  shellFloor: 0.45,
  /** The mist is re-ordered no oftener than this (seconds) and at least this often while the camera stands still. */
  sortLeast: 0.1,
  sortEvery: 0.25,
  /** Or as soon as the camera has moved this far (metres) since the last order, subject to `sortLeast`. */
  sortMoved: 50,
  /** How much of the lens flare and of the god rays being deep inside a nebula takes away. */
  dimFlare: 0.85,
  dimRays: 0.8,
  /** The camera shake at the table's full jitter and full depth: radians of turn, metres of shift, and its rate. */
  shakeTurn: 0.012,
  shakeShift: 0.04,
  shakeHz: 8.5,
  /** How near a nebula's edge must be before its strikes are worked out at all (metres). */
  strikeReach: 1800,
  /** How near a strike's far end must land before it is moved onto the player's ship and hurts it (metres). */
  hitWithin: 900,
  /** How far off a strike may be and still be drawn (metres); past this nothing is shown for it. */
  drawWithin: 3600,
  /** A bolt's length, as a share of its nebula's radius. */
  strikeSpanMin: 0.25,
  strikeSpanMax: 0.8,
  /** A strike's life as a share of the row's longest: the least of it, and the band above that. */
  strikeLifeMin: 0.4,
  strikeLifeSpan: 0.6,
  /** Where inside the nebula a strike begins, as a share of the radius: the least, and the band above it. */
  strikeStartMin: 0.1,
  strikeStartSpan: 0.7,
  /** The most slots of a gap (a paused tab, a loading screen) that are caught up with rather than dropped. */
  catchUpSlots: 4,
  /** The most bolts alive at once; a strike that comes while they are all busy is skipped. Next zone load. */
  beams: 2,
  /** Segments along a bolt, and how many points its shaping curves are sampled at. Next zone load. */
  beamSegments: 24,
  /** A bolt at its widest (metres) and how far it wanders off the straight line (metres). */
  beamWidth: 7,
  beamWander: 40,
  /**
   * How the bolt wanders along its length: two rates each on the two axes across it, and how much of
   * the faster one is mixed into the slower. Sums of sines, so the wander is smooth and repeatable
   * and costs nothing; rates that do not divide into one another, so it never reads as a wave.
   */
  beamWaveSlowA: 11,
  beamWaveFastA: 27,
  beamWaveSlowB: 9,
  beamWaveFastB: 23,
  beamWaveMix: 0.6,
  /** How long a bolt takes to come up, as a share of its life, and how much of its life it holds full. */
  beamRise: 0.12,
  beamHold: 0.45,
  /**
   * Where each thing a nebula draws sits in three's see-through order: the mist, the glow over it,
   * then the haze and the bolts over both, all of them before everything else the zone draws.
   */
  orderMist: -2,
  orderGlow: -1,
  orderHaze: 1,
  orderBeam: 2,
  /** The pooled light a strike borrows. */
  flashIntensity: 9,
  flashDistance: 900,
  flashSeconds: 0.14,
  /**
   * The share of the table's damage band a strike really does. The tables were written for the
   * game's own hit points and ours are smaller, so the full numbers would take a fighter's shields
   * and most of its armour in one strike. A quarter is the owner's decision, not a reading of the
   * files, and the switch in the settings turns damage off altogether.
   */
  damageShare: 0.25,
  /**
   * The least seconds between two strikes that end on the player's ship. INVENTED: the roughest
   * rows strike once a second, and without this a ship sitting in one would be hit as often, which
   * no amount of shields lives through. It is a floor on how often, never on how hard.
   */
  hitEvery: 4,
  /**
   * Read the second waveform as how bright the bolt is along its length rather than as how far it
   * wanders off the straight line (see `beamCurves`). With it on the wander is the same all the way
   * along instead. It is spent when the bolt pool is made, so it takes effect at the next zone load.
   */
  waveAlpha: false,
};

/** The knobs that are spent when a zone's nebulae are built: moving one takes effect at the next zone load. */
export const BUILD_ONLY_KEYS: readonly string[] = ['beams', 'beamSegments', 'waveAlpha'];

export type NebulaTune = typeof NEBULA_TUNE;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** A 32-bit mix, so a seed and a counter give the same numbers in every browser and in node. */
export function hash32(a: number): number {
  let x = a | 0;
  x = (x ^ 61) ^ (x >>> 16);
  x = (x + (x << 3)) | 0;
  x = x ^ (x >>> 4);
  x = Math.imul(x, 0x27d4eb2d);
  x = x ^ (x >>> 15);
  return x >>> 0;
}

/** A number in [0, 1) from a seed and a counter. */
export function rand01(seed: number, n: number): number {
  return hash32(Math.imul(seed, 0x9e3779b1) + Math.imul(n, 0x85ebca6b)) / 4294967296;
}

/** A nebula's own seed: its name, so the same nebula makes the same sheets and the same strikes everywhere. */
export function seedOfName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** How many sheets a nebula asks for, before the zone's cap shares them out. OURS. */
export function sheetCount(radius: number, density: number, tune: NebulaTune = NEBULA_TUNE): number {
  const want = Math.round(Math.max(0, density) * tune.density * Math.pow(Math.max(1, radius) / 500, 1.5) * tune.sheetsPer500m);
  return clamp(want, tune.sheetsMin, tune.sheetsMax);
}

/**
 * The zone's sheets shared out: what each nebula asked for, scaled down in proportion when the zone
 * wants more than the cap. Every nebula keeps at least three sheets, so none of them vanishes.
 */
export function shareSheets(wanted: readonly number[], cap: number): number[] {
  const total = wanted.reduce((a, b) => a + b, 0);
  if (total <= cap || total === 0) return wanted.slice();
  const scale = cap / total;
  return wanted.map((w) => Math.max(3, Math.round(w * scale)));
}

/** The table's (alpha, red, green, blue) as drawing's (red, green, blue, alpha). */
export function sheetColour(c: NebulaColour): SheetColour {
  return [c[1], c[2], c[3], c[0]];
}

/** A sheet's colour at `t` of the way from the middle to the edge: the row's colour toward its ramp colour. */
export function rampAt(colour: NebulaColour, ramp: NebulaColour, t: number): SheetColour {
  const k = clamp(t, 0, 1);
  const a = sheetColour(colour);
  const b = sheetColour(ramp);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
}

/** One sheet, in the game's frame. */
export interface NebulaSheet {
  x: number;
  y: number;
  z: number;
  /** Its width across, metres. */
  size: number;
  /** It turns to face the camera; otherwise `right` and `up` are the turn it keeps. */
  facing: boolean;
  right: [number, number, number];
  up: [number, number, number];
  colour: SheetColour;
  /** Which nebula it belongs to (its index in the zone's list). */
  nebula: number;
}

/**
 * A nebula's sheets, the same every time for the same name and count: placed inside the sphere and
 * crowded toward the middle, `facingShare` of them turning to face the camera and the rest keeping a
 * fixed turn, each coloured by how far out it sits. OURS, every part of it.
 */
export function buildSheets(row: Pick<Nebula, 'name' | 'at' | 'radius' | 'facingShare' | 'facing' | 'oriented'>, index: number, count: number, tune: NebulaTune = NEBULA_TUNE): NebulaSheet[] {
  const seed = seedOfName(row.name);
  const out: NebulaSheet[] = [];
  for (let i = 0; i < count; i++) {
    const n = i * 8;
    // A direction on the sphere, and a distance from the middle crowded inward.
    const z = rand01(seed, n) * 2 - 1;
    const phi = rand01(seed, n + 1) * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const t = Math.pow(rand01(seed, n + 2), tune.centrePower);
    const d = row.radius * t;
    const x = row.at[0] + Math.cos(phi) * r * d;
    const y = row.at[1] + z * d;
    const zz = row.at[2] + Math.sin(phi) * r * d;
    const facing = rand01(seed, n + 3) < row.facingShare;
    const size = row.radius * (tune.sizeMin + (tune.sizeMax - tune.sizeMin) * rand01(seed, n + 4));
    const pair = facing ? row.facing : row.oriented;
    // A turn for the sheets that keep one: a direction to face, and a roll about it.
    const az = rand01(seed, n + 5) * Math.PI * 2;
    const el = rand01(seed, n + 6) * Math.PI - Math.PI / 2;
    const roll = rand01(seed, n + 7) * Math.PI * 2;
    const normal: [number, number, number] = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    const { right, up } = basisAbout(normal, roll);
    out.push({ x, y, z: zz, size, facing, right, up, colour: rampAt(pair.colour, pair.ramp, t), nebula: index });
  }
  return out;
}

/** Two unit vectors across a plane whose normal is `normal`, rolled about it: a fixed sheet's turn. */
export function basisAbout(normal: readonly [number, number, number], roll: number): { right: [number, number, number]; up: [number, number, number] } {
  // Any vector not along the normal will do to start from.
  const helper: [number, number, number] = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const a = norm(cross(helper, normal));
  const b = norm(cross(normal, a));
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  return {
    right: [a[0] * c + b[0] * s, a[1] * c + b[1] * s, a[2] * c + b[2] * s],
    up: [b[0] * c - a[0] * s, b[1] * c - a[1] * s, b[2] * c - a[2] * s],
  };
}

const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const norm = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * How near a nebula is pulled: the farthest nebula edges in the zones sit well past the 9 km far
 * plane, so a nebula whose middle is beyond `pullFrom` is scaled toward the camera by this ratio.
 * Scaling a whole nebula about the camera keeps its picture exactly: every sheet's apparent size and
 * place are what they were, only nearer. OURS, and our reading of the client's "far appearance".
 */
export function pullScale(distance: number, tune: NebulaTune = NEBULA_TUNE): number {
  return tune.pullFrom > 0 && distance > tune.pullFrom ? tune.pullFrom / distance : 1;
}

/** How big a sheet looks: its width across over its distance. The pull must not change this. */
export function apparentSize(size: number, distance: number): number {
  return size / Math.max(1e-6, distance);
}

/** How deep inside a nebula the camera is, 0 at the edge and 1 once it is `insideOver` of the radius in. OURS. */
export function insideDepth(distance: number, radius: number, tune: NebulaTune = NEBULA_TUNE): number {
  if (radius <= 0) return 0;
  return clamp((radius - distance) / (radius * Math.max(0.05, tune.insideOver)), 0, 1);
}

/** Where the camera stands in the nebulae: which one it is deepest inside (-1 for none) and how deep. */
export interface InsideAt {
  index: number;
  depth: number;
}

/**
 * Which nebula the camera is deepest inside (by depth times the row's density), and how deep, written
 * into `out` and returned. It is asked once a frame, so it takes the object to fill rather than
 * making one; a caller with none of its own gets a shared one, which is only safe because the answer
 * is read straight away.
 */
const insideShared: InsideAt = { index: -1, depth: 0 };

export function deepestInside(
  rows: readonly { at: readonly [number, number, number]; radius: number; density: number }[],
  cx: number,
  cy: number,
  cz: number,
  tune: NebulaTune = NEBULA_TUNE,
  out: InsideAt = insideShared,
): InsideAt {
  let index = -1;
  let best = 0;
  let depth = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const d = insideDepth(Math.hypot(r.at[0] - cx, r.at[1] - cy, r.at[2] - cz), r.radius, tune);
    if (d <= 0) continue;
    const score = d * Math.max(0.05, r.density);
    if (score > best) {
      best = score;
      index = i;
      depth = d;
    }
  }
  out.index = index;
  out.depth = depth;
  return out;
}

/**
 * `order[0..count)` sorted so that `keys[order[i]]` runs from largest to smallest: the sheets far to
 * near. A merge sort down a scratch buffer made once, because `%TypedArray%.sort` with a comparator
 * allocates both the comparator's closure and a working copy of the array on every call, and this
 * runs while the player is flying.
 */
export function sortFarToNear(order: Int32Array, keys: Float32Array, count: number, scratch: Int32Array): void {
  if (count < 2) return;
  let src = order;
  let dst = scratch;
  for (let width = 1; width < count; width *= 2) {
    for (let lo = 0; lo < count; lo += width * 2) {
      const mid = Math.min(lo + width, count);
      const hi = Math.min(lo + width * 2, count);
      let a = lo;
      let b = mid;
      for (let i = lo; i < hi; i++) {
        // Largest key first; equal keys keep the order they came in, so the picture never flickers.
        if (a < mid && (b >= hi || keys[src[a]] >= keys[src[b]])) dst[i] = src[a++];
        else dst[i] = src[b++];
      }
    }
    const swap = src;
    src = dst;
    dst = swap;
  }
  // An odd number of passes leaves the answer in the scratch buffer; copy it back by hand, since
  // `set` would want a view of it and a view is an object made on the spot.
  if (src !== order) for (let i = 0; i < count; i++) order[i] = src[i];
}

/** A waveform point as the particle reader gives it: [percent, value, randomMin, randomMax]. */
export type WavePoint = readonly number[];

/** A waveform read at `t` (0 to 1), straight between its points; 0 without any. */
export function waveAt(points: readonly WavePoint[], t: number): number {
  if (!points.length) return 0;
  const k = clamp(t, 0, 1);
  if (k <= points[0][0]) return points[0][1] ?? 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (k <= b[0]) {
      const span = b[0] - a[0];
      const f = span > 1e-6 ? (k - a[0]) / span : 0;
      return (a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * f;
    }
  }
  return points[points.length - 1][1] ?? 0;
}

/**
 * A waveform sampled into `n` points and scaled so its largest value is 1: what a shader reads to
 * shape a bolt. The curves in the one lightning appearance the zones name both end at their
 * maximum, which is why neither is read as the bolt's alpha in time unless `waveAlpha` asks for it:
 * a bolt at its brightest in the instant it vanishes is not what a strike looks like. Read along the
 * bolt instead, the first curve widens it from its start and the second says how far it wanders;
 * with `waveAlpha` on, the second is how bright it is along its length and the wander is even.
 *
 * The scaling to 1 throws the curve's own magnitudes away (the one appearance's curves rise to 8
 * with a plateau at 3), because what those numbers are in is not known: `beamWidth` and
 * `beamWander`, both ours, put them back in metres. If they turn out to be metres already, the
 * scaling here is what to take out.
 */
export function beamCurves(points: readonly WavePoint[], n: number): number[] {
  const out: number[] = [];
  let max = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, waveAt(points, n > 1 ? i / (n - 1) : 0));
    out.push(v);
    if (v > max) max = v;
  }
  if (max > 0) for (let i = 0; i < n; i++) out[i] /= max;
  else for (let i = 0; i < n; i++) out[i] = 1;
  return out;
}

/** One strike of one nebula: when it began, how long it lasts, its two ends (offsets from the middle) and its damage roll. */
export interface NebulaStrike {
  /** Wall clock milliseconds. */
  at: number;
  seconds: number;
  from: [number, number, number];
  to: [number, number, number];
  /** 0 to 1 across the row's damage band. */
  roll: number;
  /** The slot it came from, so the same strike is never started twice. */
  slot: number;
}

/** How long one strike slot is, seconds: one over the row's rate, and never shorter than a tenth of a second. */
export function slotSeconds(every: number): number {
  return every > 0 ? Math.max(0.1, 1 / every) : 0;
}

/** Which slot a moment falls in. */
export function slotOf(every: number, ms: number): number {
  const s = slotSeconds(every);
  return s > 0 ? Math.floor(ms / 1000 / s) : -1;
}

/**
 * The one strike a slot holds: its moment inside the slot, its length, and its two ends as offsets
 * from the nebula's middle. Every part of this is OURS; the table gives only the rate, the longest
 * a strike may last and the damage band.
 */
export function strikeOfSlot(seed: number, slot: number, every: number, maxSeconds: number, radius: number, tune: NebulaTune = NEBULA_TUNE): NebulaStrike {
  const span = slotSeconds(every);
  const n = slot * 16;
  const at = (slot * span + rand01(seed, n) * span * 0.9) * 1000;
  const seconds = Math.max(0.15, maxSeconds * (tune.strikeLifeMin + tune.strikeLifeSpan * rand01(seed, n + 1)));
  const dir = unitFrom(seed, n + 2);
  const away = unitFrom(seed, n + 4);
  const start = radius * (tune.strikeStartMin + tune.strikeStartSpan * rand01(seed, n + 6));
  const length = radius * (tune.strikeSpanMin + (tune.strikeSpanMax - tune.strikeSpanMin) * rand01(seed, n + 7));
  const from: [number, number, number] = [dir[0] * start, dir[1] * start, dir[2] * start];
  return {
    at,
    seconds,
    from,
    to: [from[0] + away[0] * length, from[1] + away[1] * length, from[2] + away[2] * length],
    roll: rand01(seed, n + 8),
    slot,
  };
}

/** A unit direction from a seed and a counter (two numbers of it). */
function unitFrom(seed: number, n: number): [number, number, number] {
  const z = rand01(seed, n) * 2 - 1;
  const phi = rand01(seed, n + 1) * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [Math.cos(phi) * r, z, Math.sin(phi) * r];
}

/**
 * Every strike of one nebula that began in (`fromMs`, `toMs`], oldest first, pushed into `out`.
 * Nothing is allocated when nothing struck. A gap longer than `maxSlots` slots (a paused tab, a
 * loading screen) is taken from the last of them, so nothing ever catches up with a burst.
 */
export function strikesBetween(seed: number, every: number, maxSeconds: number, radius: number, fromMs: number, toMs: number, out: NebulaStrike[], tune: NebulaTune = NEBULA_TUNE, maxSlots = tune.catchUpSlots): NebulaStrike[] {
  out.length = 0;
  if (!(every > 0) || !(toMs > fromMs)) return out;
  const last = slotOf(every, toMs);
  let first = slotOf(every, fromMs);
  if (last - first > maxSlots) first = last - maxSlots;
  for (let slot = first; slot <= last; slot++) {
    const s = strikeOfSlot(seed, slot, every, maxSeconds, radius, tune);
    if (s.at > fromMs && s.at <= toMs) out.push(s);
  }
  return out;
}

/** What a strike does to a ship: the table's band at the roll, times the share the owner chose (0 with damage off). */
export function strikeDamage(band: readonly [number, number], roll: number, enabled: boolean, tune: NebulaTune = NEBULA_TUNE): number {
  if (!enabled) return 0;
  const lo = Math.min(band[0], band[1]);
  const hi = Math.max(band[0], band[1]);
  return (lo + (hi - lo) * clamp(roll, 0, 1)) * tune.damageShare;
}

/** How bright a bolt is through its life: up quickly, held, then out. OURS; see `beamCurves`. */
export function beamEnvelope(age: number, seconds: number, tune: NebulaTune = NEBULA_TUNE): number {
  if (seconds <= 0) return 0;
  const t = age / seconds;
  if (t < 0 || t > 1) return 0;
  const rise = Math.max(0.01, tune.beamRise);
  const hold = clamp(tune.beamHold, 0, 1 - rise);
  if (t < rise) return t / rise;
  if (t < rise + hold) return 1;
  const left = 1 - rise - hold;
  return left > 1e-6 ? 1 - (t - rise - hold) / left : 0;
}

/** The camera shake inside a nebula: turn in radians and a shift in metres, from the row's jitter and how deep in you are. */
export interface ViewShake {
  yaw: number;
  pitch: number;
  roll: number;
  x: number;
  y: number;
}

/**
 * The shake at a moment. Sums of sines rather than random numbers, so it is smooth, repeatable and
 * costs nothing; three rates that do not divide into one another, so it never reads as a loop.
 */
export function shakeAt(seconds: number, amount: number, out: ViewShake, tune: NebulaTune = NEBULA_TUNE): ViewShake {
  const a = clamp(amount, 0, 1);
  if (a <= 0) {
    out.yaw = out.pitch = out.roll = out.x = out.y = 0;
    return out;
  }
  const w = seconds * tune.shakeHz * Math.PI * 2;
  const turn = tune.shakeTurn * a;
  const shift = tune.shakeShift * a;
  out.yaw = Math.sin(w) * turn;
  out.pitch = Math.sin(w * 1.37 + 1.1) * turn * 0.8;
  out.roll = Math.sin(w * 0.79 + 2.3) * turn * 0.6;
  out.x = Math.sin(w * 1.11 + 0.7) * shift;
  out.y = Math.sin(w * 1.53 + 2.9) * shift;
  return out;
}

/** How much of the lens flare (or of the god rays) is left at this depth inside a nebula. OURS. */
export function dimInside(depth: number, share: number): number {
  return clamp(1 - clamp(depth, 0, 1) * clamp(share, 0, 1), 0, 1);
}
