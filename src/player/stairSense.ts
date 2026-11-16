// The stairs rule's eyes (wave 3 of the animations): the ground's heights sampled along a body's travel, behind it and
// ahead of it, for `stairsIn` (src/anim/stairsRule.ts) to read, and its answer held (`StairsHold`).
//
// The samples stand on a lattice laid along the travel (a line through where the body was when it began going that way,
// a sample every `step`), so a body walking straight casts one new sample each `step` it goes and reads every other one
// back: at a walk about 17 casts a second, at a sprint about 70, and standing still none. The line is laid afresh when
// the travel turns more than `TURN` or the body strays `step` / 2 off it; every sample is cast again when the world's
// colliders come or go (a building streamed in) or the body is in another world (aboard a ship's rooms).
//
// A sample is a ray straight down from `PROBE_UP` over the body's feet to `PROBE_DOWN` under them, against what stands
// still only (the engine's own query flags, never a predicate: a predicate is called back into script for every
// collider a ray's box passes): never another player, a creature, a vehicle, a loose prop or a corpse. Nothing here makes
// an object on a frame but what the engine's own casts make (counted in `casts`).

import { RAPIER } from '../core/physics.ts';
import { StairsFound, StairsHold, stairsIn } from '../anim/stairsRule.ts';
import type { LocoTune } from '../anim/locoTune.ts';

/** The engine's query flags for what stands still: no sensor, nothing kinematic, nothing dynamic (as the grapple's rope). */
export const STILL_FLAGS = 8 | 2 | 4;
/** How far over the body's feet a sample's ray starts, metres: a stair a step and a half ahead of the most the window reaches stands under it. */
export const PROBE_UP = 1.6;
/** How far under the body's feet a sample's ray reaches, metres. */
export const PROBE_DOWN = 2.4;
/** The travel's turn past which the lattice is laid afresh, radians (10 degrees). */
const TURN_COS = Math.cos((10 * Math.PI) / 180);
/** The ring the samples are kept in (a window is at most 4 m at 0.03: 135 samples). */
const CAP = 256;

/** The little of a physics world the sampler asks (rapier's `World`). */
export interface StairWorld {
  castRay(ray: RAPIER.Ray, maxToi: number, solid: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number): RAPIER.RayColliderHit | null;
  colliders: { len(): number };
}

/** Where a body is this frame, written by the caller before `step` (fields, so no number crosses a call). */
export class StairAt {
  x = 0.5;
  y = 0.5;
  z = 0.5;
  /** The horizontal velocity, m/s: the travel. */
  vx = 0.5;
  vz = 0.5;
  dt = 0.5;
  filter = 0.5;
  /** Whether the body is where stairs are read this frame (on its feet on the ground, standing, moving). */
  reads = false;
  /**
   * The stairs wave: whether the stairs' size and where their risers stand are measured too (the hips' line, `ik.hips`
   * 'steady', and one step a stair, `stairs.stepRule` 'stairs'): each riser of the run found placed to the centimetre by a
   * few more rays (`REFINE_MOST`), once a riser. Off, nothing more is cast or worked out (9c18665's sampler).
   */
  measure = false;
}

/** How many more rays place one riser: the gap it stands in halved until it is under a centimetre (a 0.1 m sample's in four). */
const REFINE_MOST = 6;
/** Risers placed and kept (by the lattice's own sample before each), so a riser is placed once while the line stands. */
const PLACED = 32;

export class StairSense {
  /** The way held: +1 up the stairs, -1 down, 0 off them. */
  way = 0;
  /** Rays cast, and samples read back with none (the console's and the tests'). */
  casts = 0;
  reused = 0;
  /**
   * The stairs wave (`at.measure`): the stairs' tread (riser to riser along the travel) and riser, averaged over the run
   * found; how far ahead along the travel the next riser stands from the body's middle and how far behind the last one
   * (NaN for none in the window); the tread's height the body stands on; and the travel's way (the lattice's). `known`
   * false where none of it stands (off stairs, or the window holds no run of the held way). (Declared as fractions.)
   */
  known = false;
  tread = 0.5;
  riser = 0.5;
  next = 0.5;
  prev = 0.5;
  floor = 0.5;
  /** The rays the risers' places cost (also in `casts`). */
  placeCasts = 0;
  readonly at = new StairAt();
  readonly found = new StairsFound();
  private readonly hold = new StairsHold();
  /** The window's heights, behind to ahead. */
  private readonly window = new Float64Array(CAP);
  private readonly ringIdx = new Int32Array(CAP);
  private readonly ringY = new Float64Array(CAP);
  private ray: RAPIER.Ray | null = null;
  private world: StairWorld | null = null;
  private count = -1;
  private lined = false;
  private ox = 0.5;
  private oz = 0.5;
  /** The line's way along the travel (the lattice's), a unit across the ground. */
  ux = 0.5;
  uz = 0.5;
  private stepWas = 0.5;
  private px = 0.5;
  private pz = 0.5;
  /** The risers placed (`at.measure`): each by the lattice index of the sample before it, its place along the line. */
  private readonly placedJ = new Int32Array(PLACED);
  private readonly placedS = new Float64Array(PLACED);
  private placedNext = 0;

  constructor() {
    this.ringIdx.fill(-0x7fffffff);
    this.placedJ.fill(-0x7fffffff);
    this.next = Number.NaN;
    this.prev = Number.NaN;
  }

  /** Forget the lattice and the hold (the body stood somewhere new). */
  reset(): void {
    this.hold.reset();
    this.way = 0;
    this.lined = false;
    this.world = null;
    this.known = false;
  }

  /** The frame's look, from `at`: answers the way held (and keeps it in `way`). */
  step(world: StairWorld, tune: LocoTune['stairs']): number {
    const at = this.at;
    const moved = Math.sqrt((at.x - this.px) * (at.x - this.px) + (at.z - this.pz) * (at.z - this.pz));
    this.px = at.x;
    this.pz = at.z;
    if (tune.rule !== 'stairs') {
      this.reset();
      return 0;
    }
    if (!at.measure) this.known = false;
    if (!at.reads) return this.way;
    const sp = Math.sqrt(at.vx * at.vx + at.vz * at.vz);
    if (sp < 0.3) return this.way;
    const ux = at.vx / sp;
    const uz = at.vz / sp;
    const step = tune.step;
    // The world, its colliders and the sample's step: every sample cast afresh when any changes.
    const n = world.colliders.len();
    if (world !== this.world || n !== this.count || step !== this.stepWas) {
      this.world = world;
      this.count = n;
      this.stepWas = step;
      this.lined = false;
    }
    // The line: laid afresh when the travel turns or the body strays off it.
    if (this.lined) {
      const off = (at.x - this.ox) * this.uz - (at.z - this.oz) * this.ux;
      const along = ux * this.ux + uz * this.uz;
      if (along < TURN_COS || off > step * 0.5 || off < -step * 0.5) this.lined = false;
    }
    if (!this.lined) {
      this.lined = true;
      this.ox = at.x;
      this.oz = at.z;
      this.ux = ux;
      this.uz = uz;
      this.ringIdx.fill(-0x7fffffff);
      if (at.measure) this.placedJ.fill(-0x7fffffff);
    }
    const half = Math.min(CAP / 2 - 1, Math.round(tune.look / 2 / step));
    const jb = Math.round(((at.x - this.ox) * this.ux + (at.z - this.oz) * this.uz) / step);
    let ray = this.ray;
    if (!ray) ray = this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    const w = this.window;
    let m = 0;
    for (let j = jb - half; j <= jb + half; j++) {
      const slot = ((j % CAP) + CAP) % CAP;
      if (this.ringIdx[slot] === j) {
        w[m++] = this.ringY[slot];
        this.reused++;
        continue;
      }
      ray.origin.x = this.ox + this.ux * j * step;
      ray.origin.y = at.y + PROBE_UP;
      ray.origin.z = this.oz + this.uz * j * step;
      this.casts++;
      const hit = world.castRay(ray, PROBE_UP + PROBE_DOWN, true, STILL_FLAGS, at.filter);
      const y = hit ? ray.origin.y - hit.timeOfImpact : Number.NaN;
      this.ringIdx[slot] = j;
      this.ringY[slot] = y;
      w[m++] = y;
    }
    // Read along the travel: the lattice's own way is the travel's (it is laid afresh past a tenth of a turn).
    stairsIn(w, m, step, tune, this.found);
    this.way = this.hold.step(this.found, moved, tune);
    if (at.measure) this.measureRun(world, ray, jb - half, step);
    return this.way;
  }

  /**
   * The stairs wave: the held way's run measured (`known`, `tread`, `riser`, `next`, `prev`, `floor`). Each riser of the
   * run is placed between the samples either side of it by halving that gap with a ray at a time until under a centimetre
   * (where the ground crosses the riser's middle height), once a riser while the line stands; the tread is the run's
   * placed risers' spacing averaged, the riser their heights averaged. `j0` the lattice index of the window's first sample.
   */
  private measureRun(world: StairWorld, ray: RAPIER.Ray, j0: number, step: number): void {
    const f = this.found;
    const count = f.risers < f.mids.length ? f.risers : f.mids.length;
    if (this.way === 0 || f.way !== this.way || count < 1) {
      this.known = false;
      return;
    }
    const at = this.at;
    const body = (at.x - this.ox) * this.ux + (at.z - this.oz) * this.uz;
    let first = 0;
    let last = 0;
    let rise = 0;
    let next = Number.POSITIVE_INFINITY;
    let prev = Number.POSITIVE_INFINITY;
    let floor = Number.NaN;
    let after = Number.NaN;
    for (let r = 0; r < count; r++) {
      const jl = j0 + f.lo[r];
      // Placed before? Else halve the gap it stands in.
      let s = Number.NaN;
      for (let q = 0; q < PLACED; q++) {
        if (this.placedJ[q] === jl) {
          s = this.placedS[q];
          break;
        }
      }
      if (!(s === s)) {
        const mid = (f.from[r] + f.to[r]) * 0.5;
        const up = f.to[r] > f.from[r];
        let a = jl * step;
        let b = (j0 + f.hi[r]) * step;
        for (let i = 0; i < REFINE_MOST && b - a > 0.01; i++) {
          const c = (a + b) * 0.5;
          ray.origin.x = this.ox + this.ux * c;
          ray.origin.y = at.y + PROBE_UP;
          ray.origin.z = this.oz + this.uz * c;
          this.casts++;
          this.placeCasts++;
          const hit = world.castRay(ray, PROBE_UP + PROBE_DOWN, true, STILL_FLAGS, at.filter);
          const y = hit ? ray.origin.y - hit.timeOfImpact : Number.NaN;
          // Past the riser where the ground there has crossed its middle height (none found: nearer the riser's foot).
          const past = y === y ? (up ? y > mid : y < mid) : !up;
          if (past) b = c;
          else a = c;
        }
        s = (a + b) * 0.5;
        const q = this.placedNext;
        this.placedNext = q + 1 === PLACED ? 0 : q + 1;
        this.placedJ[q] = jl;
        this.placedS[q] = s;
      }
      if (r === 0) first = s;
      last = s;
      const d = f.to[r] - f.from[r];
      rise += d < 0 ? -d : d;
      const ahead = s - body;
      if (ahead >= 0) {
        if (ahead < next) {
          next = ahead;
          floor = f.from[r];
        }
      } else if (-ahead < prev) {
        prev = -ahead;
        after = f.to[r];
      }
    }
    // The tread the body stands on: before the next riser, else after the last one.
    this.known = true;
    this.riser = rise / count;
    this.tread = count > 1 ? (last - first) / (count - 1) : Number.NaN;
    this.next = next === Number.POSITIVE_INFINITY ? Number.NaN : next;
    this.prev = prev === Number.POSITIVE_INFINITY ? Number.NaN : prev;
    this.floor = next === Number.POSITIVE_INFINITY ? after : floor;
    if (!(this.tread > 0)) this.known = false;
  }
}
