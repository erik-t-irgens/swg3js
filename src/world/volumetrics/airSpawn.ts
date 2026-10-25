// What the CPU hands the fourth wave's particles each frame (the design's §2.16): the spawn records the sources' frame
// walk, a blast, a Force front and the feet write, and the fractions each source is owed between frames. Nothing per
// particle is ever worked out here: a record says where a handful start, how fast they are thrown, in what colour, how
// big and for how long, and the card finds each slot's record by a loop over the cumulative counts. Counts are a rate
// times the frame's `dt` with the fraction carried per source (`owe`), so the mean is the rate at every frame rate.
//
// **No number crosses a call on the frame's path** (the design's rule 4): a record is handed over in a kept array
// (`arg`, then `addArgs()`), and the fraction in a kept record (`fq`). The ring's head per kind and the kinds' table are
// the pool's (`airParticles.ts`).
//
// Pure: no three, nothing of the page; the node tests drive the very class the game does.
import { GROUND_CLASS_NAMES, type GroundClass } from './airTune.ts';

/** The kinds the kick-up pool holds, a row range each (`airParticles.ts`). */
export const KICK_KIND = { leaf: 0, puff: 1, spray: 2, streak: 3 } as const;
export const KICK_KINDS = 4;
export const KICK_KIND_NAMES = ['leaf', 'puff', 'spray', 'streak'] as const;
export type KickKindName = (typeof KICK_KIND_NAMES)[number];

/**
 * A particle's look, the whole part of its seed: a plain one of its kind, the spray thrown behind a machine crossing
 * water in the game's own trail's look (the owner's Q14), or one the wind alone picked up off the ground (counted apart,
 * `air().pickups`).
 */
export const KICK_LOOK = { plain: 0, wake: 1, pickup: 2 } as const;

/** Records a frame the update reads (its loop bound and uniform arrays), a pool's. */
export const SPAWN_MOST = 32;
/** Floats a staged record holds: place xyz and the count; throw xyz and spread; colour, size, life, spare; kind, look, radius, nought. */
export const SPAWN_W = 16;

/** Each ground class's index on the class raster (`AirRaster.klass`): its place in the response table plus one, nought unknown or a liquid. */
export const CLASS_INDEX: Readonly<Record<GroundClass, number>> = Object.fromEntries(GROUND_CLASS_NAMES.map((n, i) => [n, i + 1])) as Record<GroundClass, number>;

/** Whether a class index throws leaves (grass, forest litter), puffs and streaks (sand, ash, dirt). */
export function leafyClass(c: number): boolean {
  return c === CLASS_INDEX.grass || c === CLASS_INDEX.litter;
}
export function sandyClass(c: number): boolean {
  return c === CLASS_INDEX.sand || c === CLASS_INDEX.ash || c === CLASS_INDEX.dirt;
}

/**
 * A colour in linear light packed into one float as three bytes of its `1/2.2` power (so the dark end keeps its steps),
 * exact in a float32 (24 bits). `unpackColour` and the shaders' `airUnpackColour` undo it.
 */
export function packColour(r: number, g: number, b: number): number {
  const q = (c: number): number => {
    const v = c > 0 ? (c < 1 ? Math.pow(c, 1 / 2.2) : 1) : 0;
    return Math.floor(v * 255 + 0.5);
  };
  return q(r) * 65536 + q(g) * 256 + q(b);
}
export function unpackColour(p: number, out: [number, number, number]): [number, number, number] {
  const i = Math.floor(p + 0.5);
  out[0] = Math.pow(((i >> 16) & 255) / 255, 2.2);
  out[1] = Math.pow(((i >> 8) & 255) / 255, 2.2);
  out[2] = Math.pow((i & 255) / 255, 2.2);
  return out;
}
/** White, packed: the spray's colour (the sky lights it). */
export const WHITE_PACKED = 255 * 65536 + 255 * 256 + 255;

/**
 * The shaders' hash (`airHash`, a 32-bit integer mix), mirrored: what every slot draws its own randomness from, so a
 * test can say which slot does what with no card.
 */
export function airHash(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
/** A share in [0, 1) off a hash, as the shaders take it (`airRand`): the top 24 bits. */
export function airRand(x: number): number {
  return (airHash(x) >>> 8) / 16777216;
}

/**
 * One frame's spawn records, staged by the sources in whatever order they come (`addArgs`) and read by the pool, which
 * sorts them by kind into the update's uniform arrays (`airParticles.ts`). A record past `SPAWN_MOST` is refused and
 * counted; a record of a kind switched off is not taken.
 */
export class SpawnTable {
  /** The staged records, `SPAWN_W` floats each, in world metres (the pool takes its corner off). */
  readonly rec = new Float64Array(SPAWN_MOST * SPAWN_W);
  count = 0;
  /** Particles asked for this frame, by kind. */
  readonly asked = new Float64Array(KICK_KINDS);
  /**
   * Particles asked for since the console last read them, by source (0 engines, 1 blasts, 2 fronts, 3 feet, 4 the
   * console), and records dropped (5): a typed array indexed by the record's own source, never a branch a source, since a
   * source seen once in a while (a running wader) left a branch the compiled code had not met and boxed its count.
   */
  readonly bySource = new Float64Array(6);
  /** The counts by source as an object, for the console (made when asked, never in a frame). */
  get seen(): { engines: number; blasts: number; fronts: number; feet: number; console: number; dropped: number } {
    const b = this.bySource;
    return { engines: b[0], blasts: b[1], fronts: b[2], feet: b[3], console: b[4], dropped: b[5] };
  }
  /** The counts by source back to nought (the console has read them). */
  resetSeen(): void {
    this.bySource.fill(0);
  }
  /** Which kinds are on (the switches, `volLeaves` and the rest), written by the field each frame. */
  readonly on = [true, true, true, true];
  /**
   * A record handed over: x, y, z (world), n (particles), throw vx, vy, vz, spread (m/s each way), colour (packed),
   * size, life, spare, kind, look, radius (metres the n are spread over), source (0 engine, 1 blast, 2 front, 3 feet, 4
   * the console).
   */
  readonly arg = new Float64Array(SPAWN_W);

  /** The record in `arg` into the frame's table; answers whether it was taken. */
  addArgs(): boolean {
    const a = this.arg;
    const kind = a[12];
    const n = Math.floor(a[3]);
    if (!(n >= 1) || !(kind >= 0 && kind < KICK_KINDS) || !this.on[kind]) return false;
    for (let i = 0; i < 12; i++) {
      if (!Number.isFinite(a[i])) return false;
    }
    if (this.count >= SPAWN_MOST) {
      this.bySource[5]++;
      return false;
    }
    const k = this.count * SPAWN_W;
    const r = this.rec;
    for (let i = 0; i < SPAWN_W; i++) r[k + i] = a[i];
    r[k + 3] = n;
    this.count++;
    this.asked[kind] += n;
    const s = a[15];
    this.bySource[s >= 0 && s <= 3 ? s : 4] += n;
    return true;
  }

  /** The frame's records spent (the pool took them, or nothing steps to take them). */
  clear(): void {
    this.count = 0;
    for (let k = 0; k < KICK_KINDS; k++) this.asked[k] = 0;
  }
}

/** A source's fraction asked: its key, the kind, the rate times the frame's `dt`; `owe` writes the whole count into `n`. */
export interface Owed {
  key: number;
  kind: number;
  amount: number;
  n: number;
}

export function newOwed(): Owed {
  // A fraction first, so each number is a double from its first write.
  const o: Owed = { key: 0.5, kind: 0, amount: 0.5, n: 0 };
  o.key = 0;
  o.amount = 0;
  return o;
}

/**
 * What each continuous source is owed of a particle between frames (an engine's leaves, its puffs, its spray, its
 * streaks), keyed by the source and the kind, so a count is a rate times `dt` with the fraction carried: the mean is the
 * rate at every frame rate (the first wave's shed lesson from the other side). A fixed table: the least recently seen
 * source gives its place up past its size, which starts that source's fraction again (at most one particle lost).
 */
export class OwedTable {
  private readonly keys: Float64Array;
  private readonly frac: Float64Array;
  private readonly seenAt: Float64Array;
  private tick = 0;

  constructor(size = 128) {
    this.keys = new Float64Array(size).fill(Number.NaN);
    this.frac = new Float64Array(size);
    this.seenAt = new Float64Array(size);
  }

  /** The whole count `q.amount` comes to with what `q.key`'s `q.kind` was owed, into `q.n`; the rest kept. */
  owe(q: Owed): void {
    this.tick++;
    const id = q.key * 8 + q.kind;
    const keys = this.keys;
    let at = -1;
    let oldest = 0;
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === id) {
        at = i;
        break;
      }
      if (this.seenAt[i] < this.seenAt[oldest]) oldest = i;
    }
    if (at < 0) {
      at = oldest;
      keys[at] = id;
      this.frac[at] = 0;
    }
    this.seenAt[at] = this.tick;
    const a = q.amount > 0 && Number.isFinite(q.amount) ? q.amount : 0;
    const total = this.frac[at] + a;
    const n = Math.floor(total);
    this.frac[at] = total - n;
    q.n = n;
  }

  clear(): void {
    this.keys.fill(Number.NaN);
    this.frac.fill(0);
    this.seenAt.fill(0);
  }
}

/**
 * Which record a slot at `ring` (its place in this frame's range of its kind) takes: the first whose cumulative end is
 * past it, over the records `start` to `end` (the shader's loop, `kickRecordOf`); -1 for none.
 */
export function recordOf(ring: number, ends: ArrayLike<number>, start: number, end: number): number {
  for (let i = start; i < end; i++) if (ring < ends[i]) return i;
  return -1;
}
