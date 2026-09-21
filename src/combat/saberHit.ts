// Where a lightsaber lands, as numbers. The blade already sweeps a capsule every frame of a swing,
// once per body per swing; what is here is the ground the blade covered *between* two frames. At a
// run, on a low frame, a swing stepped clean over a thin body: the tip crosses more than a metre in
// a frame and only the two ends of that metre were ever asked about. The answer is to step the same
// capsule along the path, one cast per `stepLength` of travel and never more than `maxSteps` of
// them, and never a fatter capsule -- the sweep is an overlap query with no line of sight, so a fat
// one reaches through a thin wall and still tunnels at the next speed up.
//
// The brush is the other half: standing inside a blade that is merely lit, with nothing being swung,
// costs `brushShare` of the style's damage, at most once per body per `brushEvery`. There is no
// swing to key the once-per-swing set on, so the brush keeps a clock instead (`BrushClock`), which
// answers the same two questions the set does and therefore needs no branch inside the query. The
// brush is one cast where the blade is drawn and never a stepped path: it is what standing *in* a
// blade costs, not what the blade passed over, and a path stepped on every frame a saber is lit
// would reach where the blade never went.
//
// The loop that steps a path is here too (`PathMemory`), with the cast handed in, so that a plain
// node test drives the very loop the game runs rather than a copy of the rule written out again.
// Nothing here imports anything at runtime (`bladeGlowMath.ts` and `gradeMath.ts` are the same
// arrangement). The capsule itself is `sweep.ts`, and the only caller of that for a blade in the
// player's hand is `jedi.ts`.
//
// Units: metres, and seconds that are always `World.simTime`, so `__debug.advance` drives every
// clock here. Every function is allocation-free.

import type { Hittable } from './kit.ts';

/** Anything with the three fields: a `THREE.Vector3` is one, and so is a plain object in a test. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * What a sweep writes down about a body it has already hurt, so that one swing takes one bite out
 * of one body however many times it is cast. The once-per-swing `Set<Hittable>` is one of these (it
 * answers "hit at all"); the brush's clock is the other (it answers "hit too recently"). Both answer
 * the same two questions, so the query itself never has to know which kind it was handed.
 */
export interface HitLedger {
  has(c: Hittable): boolean;
  add(c: Hittable): void;
}

/**
 * One sub-step's cast: the two ends and the ledger, and how many bodies it caught. `sweep.ts` fills
 * this in with the rapier query; a test fills it in with a counter, which is how the loop below is
 * pinned without a physics world. It is a kept closure at module scope on both sides -- never one
 * made inside a step.
 */
export type SweepCast = (a: Vec3Like, b: Vec3Like, already: HitLedger) => number;

export interface SaberHitTune {
  /** Metres of blade travel between two frames that one cast covers. */
  stepLength: number;
  /** The most casts one blade may make in one frame, however far it moved. */
  maxSteps: number;
  /**
   * A blade that moved further than this in one frame did not swing there: it was lit, thrown,
   * caught, carried or teleported, and its path starts fresh rather than sweeping across the world.
   * A real swing cannot reach it: the frame loop clamps a step to a twentieth of a second, so this
   * is a tip speed no arm has.
   */
  jump: number;
  /**
   * A path whose age in simulated seconds is outside 0..`gap` is stale and starts fresh. What this
   * really catches is a clock that went backwards -- a planet load zeroes `World.simTime` -- since
   * the frame loop clamps `dt`, so a hidden tab and a slow frame look alike in the age alone. The
   * body being *put* somewhere is caught by `carry` instead, which is the rule that covers a lift,
   * a teleport and a travel however short the move was.
   */
  gap: number;
  /**
   * How fast the body itself can really move, in metres a second. Anything faster than this was
   * put where it stands rather than having walked, run, fallen or jumped there, and every blade it
   * holds starts its path fresh: a lift puts the player just through a doorway, which is a stride
   * and not a swing, and a path swept across it would cast the blade through the wall beside it.
   * Well over any speed on foot, because failing toward a fresh path only ever costs the one cast
   * the game made before any of this existed.
   */
  carry: number;
  /**
   * What standing inside a lit blade that is not swinging costs, as a share of the style's damage.
   * 0 is the switch that makes the game exactly what it was before the brush existed.
   */
  brushShare: number;
  /** The most often the brush may take that from one body, in simulated seconds. */
  brushEvery: number;
  /**
   * How near the blade a body has to be for the brush, in metres. It is the blade's own radius and
   * must never be made larger than it: the brush is the one query that runs continuously and
   * unattended, so it is the one most likely to be found reaching through a thin partition, and
   * this is an overlap query with no line of sight.
   */
  brushRadius: number;
  /** How hard the brush shoves what it touches. */
  brushPush: number;
}

/**
 * Every number the swept hit and the brush have. All of them are ours: nothing in the archives says
 * how far a blade reaches between two frames. Live through `__debug.saber({ ... })`.
 */
export const SABER_HIT: SaberHitTune = {
  stepLength: 0.35,
  maxSteps: 4,
  jump: 4,
  gap: 0.2,
  carry: 60,
  brushShare: 0.1,
  brushEvery: 0.25,
  brushRadius: 0.16,
  brushPush: 1,
};

/** How many bodies the brush remembers at once. Fixed: the ring allocates nothing in a step. */
export const BRUSH_SLOTS = 16;

/** Distance between two points. */
export function distanceBetween(a: Vec3Like, b: Vec3Like): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * How far the blade travelled between two frames: the greater of what each end moved. The tip is
 * almost always the faster end -- the swing turns about the hand -- but a thrust moves the hilt as
 * far as the tip, and taking only the tip would under-sample exactly the move that goes straight
 * through somebody.
 */
export function pathTravel(a0: Vec3Like, a1: Vec3Like, b0: Vec3Like, b1: Vec3Like): number {
  const base = distanceBetween(a0, a1);
  const tip = distanceBetween(b0, b1);
  return tip > base ? tip : base;
}

/**
 * How many casts cover that travel: one per `stepLength`, at least one, never more than `maxSteps`.
 * A tip that crosses two metres in a frame is cast four times, not forty: past the cap the steps
 * simply stretch, which is the point at which a thing that fast is not a swing at all.
 */
export function subSteps(travel: number, tune: SaberHitTune = SABER_HIT): number {
  const max = Math.max(1, Math.floor(tune.maxSteps));
  if (!(travel > 0) || !(tune.stepLength > 0)) return 1;
  const n = Math.ceil(travel / tune.stepLength);
  if (!(n > 1)) return 1;
  return n > max ? max : n;
}

/**
 * Whether the path between the two frames means nothing and the blade should be cast where it is
 * and nowhere else: a blade just lit or caught, one carried further than an arm can swing, or a
 * clock that went backwards or stood still (a planet load zeroes the simulated second). It does not
 * and cannot catch the body being put somewhere: `bodyTeleported` is that rule, and the caller
 * applies it to the body rather than to the blade.
 */
export function startsFresh(travel: number, age: number, tune: SaberHitTune = SABER_HIT): boolean {
  if (!(age >= 0) || age > tune.gap) return true;
  return !(travel <= tune.jump);
}

/**
 * Whether the body holding the blade was *put* where it stands rather than having moved there: a
 * lift's pick, a teleport, an arrival. Anything faster than `carry` is not a walk, a run, a fall or
 * a jump, and every path the body holds starts fresh, however short the move was -- which is the
 * case `startsFresh` cannot see, since a stride through a doorway is well inside `jump`.
 */
export function bodyTeleported(moved: number, age: number, tune: SaberHitTune = SABER_HIT): boolean {
  if (!(age > 0)) return true;
  return !(moved <= tune.carry * age);
}

/**
 * The ends of sub-step `k` of `n`, from where the blade was (a0, b0) to where it is (a1, b1). Step
 * `n` is exactly where the blade is now, which is the one cast the game made before this existed,
 * so a blade that did not move is cast once, in the same place, and nothing about the old behaviour
 * moves. Step 0 is where it was and is never cast again: last frame already did.
 */
export function stepEnds(a0: Vec3Like, a1: Vec3Like, b0: Vec3Like, b1: Vec3Like, k: number, n: number, outA: Vec3Like, outB: Vec3Like): void {
  const t = n <= 1 ? 1 : Math.min(1, Math.max(0, k / n));
  outA.x = a0.x + (a1.x - a0.x) * t;
  outA.y = a0.y + (a1.y - a0.y) * t;
  outA.z = a0.z + (a1.z - a0.z) * t;
  outB.x = b0.x + (b1.x - b0.x) * t;
  outB.y = b0.y + (b1.y - b0.y) * t;
  outB.z = b0.z + (b1.z - b0.z) * t;
}

/** What one touch of the brush takes off, from the style's own damage. */
export function brushDamage(styleDamage: number, tune: SaberHitTune = SABER_HIT): number {
  return styleDamage * tune.brushShare;
}

/** A body's name when it has one (a `Living` does), for the readout only. */
function labelOf(c: Hittable): string {
  const label = (c as { label?: unknown }).label;
  return typeof label === 'string' ? label : '';
}

/**
 * The brush's memory: which bodies it has touched and when, so a blade resting against somebody
 * takes its tenth four times a second rather than on every frame. A fixed ring, because it is
 * written inside a step.
 *
 * It fails **closed**. A body already in it keeps its slot; a new one takes a free slot, or one
 * whose own body has not been touched within `brushEvery` and is therefore no longer promising
 * anything. When there is neither -- more bodies than slots, all of them brushed just now -- the
 * newcomer is simply left alone, because evicting a live entry would brush its body again on the
 * very next frame and silently lose the one guarantee the clock exists to make. `has` is what says
 * so, so the query never learns there was a ring at all.
 *
 * It is a `HitLedger`, so the brush is the ordinary sweep with this handed to it in place of the
 * once-per-swing set: `has` means "leave it alone", which for the set is "already cut this swing"
 * and here is "cut too recently, or cannot be remembered".
 */
export class BrushClock implements HitLedger {
  private readonly who: (Hittable | null)[] = new Array<Hittable | null>(BRUSH_SLOTS).fill(null);
  private readonly when = new Float64Array(BRUSH_SLOTS);
  /** The simulated second the frame being swept is at; `begin` writes it. */
  private now = 0;
  /** How many bodies the last frame was told to leave alone because the ring was full. */
  declined = 0;

  /** Ready the clock for a frame at `now` (World.simTime). */
  begin(now: number): void {
    this.now = now;
    this.declined = 0;
  }

  /** Which slot this body sits in, or -1. */
  private slotOf(c: Hittable): number {
    for (let i = 0; i < BRUSH_SLOTS; i++) if (this.who[i] === c) return i;
    return -1;
  }

  /**
   * A slot a new body may have: an empty one, else the one whose body was touched longest ago among
   * those past `brushEvery` (a clock that went backwards counts as never touched). -1 when every
   * slot is holding a live promise, which is what makes the ring fail closed.
   */
  private freeSlot(): number {
    let best = -1;
    let bestAge = SABER_HIT.brushEvery;
    for (let i = 0; i < BRUSH_SLOTS; i++) {
      if (this.who[i] === null) return i;
      const age = this.now - this.when[i];
      if (!(age >= 0)) return i;
      if (age >= bestAge) {
        best = i;
        bestAge = age;
      }
    }
    return best;
  }

  has(c: Hittable): boolean {
    const slot = this.slotOf(c);
    if (slot >= 0) {
      const age = this.now - this.when[slot];
      // A clock that went back (a travel resets the world's) is as good as never having touched it.
      return age >= 0 && age < SABER_HIT.brushEvery;
    }
    // Not remembered, and nowhere to remember it: leave it alone rather than take a slot back off
    // a body that was brushed this quarter second, which would brush that one again next frame.
    if (this.freeSlot() < 0) {
      this.declined++;
      return true;
    }
    return false;
  }

  add(c: Hittable): void {
    let slot = this.slotOf(c);
    if (slot < 0) slot = this.freeSlot();
    // `has` said there was room; nothing may call `add` without asking first.
    if (slot < 0) return;
    this.who[slot] = c;
    this.when[slot] = this.now;
    SABER_HIT_STATS.brushName = labelOf(c);
  }

  /** Forget everybody: the blade went out, the class changed, the world was left. */
  clear(): void {
    for (let i = 0; i < BRUSH_SLOTS; i++) this.who[i] = null;
    this.when.fill(0);
    this.declined = 0;
  }
}

/**
 * Where one blade was when it was last swept, and the loop that steps from there to where it is
 * now. One per blade, belonging to whoever holds that blade -- never to a module: a path at module
 * scope would be every blade's path at once, which is the mistake the fighters' blade ends were
 * already made to stop making.
 *
 * The cast is handed in rather than imported, so this loop is the one the game runs *and* the one a
 * node test drives. `sweep.ts` wraps it as `BladePath` with the rapier query behind it.
 */
export class PathMemory {
  private ax = 0;
  private ay = 0;
  private az = 0;
  private bx = 0;
  private by = 0;
  private bz = 0;
  /** False until a frame has been written down: a blade just lit has no path yet. */
  private live = false;
  /** The simulated second that frame was at, so a frame nobody drew can be told from a slow one. */
  private at = -Infinity;

  /** Forget it: the blade went out, was thrown, the body was put somewhere. The next cast is where it is and nowhere else. */
  reset(): void {
    this.live = false;
    this.at = -Infinity;
  }

  /** Write this frame's ends down without casting: a blade that is lit but idle still gives the next swing somewhere to step from. */
  mark(a: Vec3Like, b: Vec3Like, now: number): void {
    this.ax = a.x;
    this.ay = a.y;
    this.az = a.z;
    this.bx = b.x;
    this.by = b.y;
    this.bz = b.z;
    this.live = true;
    this.at = now;
  }

  /**
   * Cast the blade along everything it has covered since last frame, `cast` once per sub-step, and
   * hand **one** ledger to every one of them -- which is what keeps one swing to one bite out of
   * one body however many of the sub-steps caught it. The last sub-step is exactly where the blade
   * is now, so a blade that has not moved, or one whose path starts fresh, is the single cast the
   * game made before any of this existed.
   *
   * `a`, `b` and the striker's own `from` are all in one frame -- the hull's aboard, the world's
   * outside -- and so is the path, or a hull at 300 m/s would put the whole ship's motion into
   * every swing aboard it.
   */
  step(now: number, a: Vec3Like, b: Vec3Like, already: HitLedger, cast: SweepCast): number {
    saberFrameStart(now);
    wasA.x = this.ax;
    wasA.y = this.ay;
    wasA.z = this.az;
    wasB.x = this.bx;
    wasB.y = this.by;
    wasB.z = this.bz;
    const travel = this.live ? pathTravel(wasA, a, wasB, b) : 0;
    const fresh = !this.live || startsFresh(travel, now - this.at);
    const steps = fresh ? 1 : subSteps(travel);
    let hits = 0;
    for (let k = 1; k <= steps; k++) {
      if (steps === 1) {
        stepA.x = a.x;
        stepA.y = a.y;
        stepA.z = a.z;
        stepB.x = b.x;
        stepB.y = b.y;
        stepB.z = b.z;
      } else stepEnds(wasA, a, wasB, b, k, steps, stepA, stepB);
      hits += cast(stepA, stepB, already);
    }
    this.mark(a, b, now);
    saberBladeSwept(fresh ? 0 : travel, steps, fresh, hits);
    return hits;
  }
}

/** The sub-step's ends and the last frame's, kept: a blade is stepped up to `maxSteps` times a frame. */
const wasA: Vec3Like = { x: 0, y: 0, z: 0 };
const wasB: Vec3Like = { x: 0, y: 0, z: 0 };
const stepA: Vec3Like = { x: 0, y: 0, z: 0 };
const stepB: Vec3Like = { x: 0, y: 0, z: 0 };

/**
 * What the last frame's blades did, for `__debug.saber()`. Numbers only, written by the sweep as it
 * runs: nothing here is read by the game itself, and a readout that allocated would be a readout
 * that could not be left switched on.
 */
export const SABER_HIT_STATS = {
  /** The swing being counted (`saber.attackId`), and what it has cut so far. */
  swing: -1,
  hits: 0,
  /** The last simulated second a blade was swept, and what that frame cost. */
  at: -Infinity,
  blades: 0,
  casts: 0,
  /** The most sub-steps any one blade was cast in that frame, and the furthest any one of them had travelled. */
  steps: 0,
  travel: 0,
  /** How many of that frame's blades started their path fresh rather than sweeping from last frame. */
  fresh: 0,
  /** The last time the brush took anything, how many bodies it took it from, and the last of their names. */
  brushed: 0,
  brushedAt: -Infinity,
  brushName: '',
  /** How many bodies the brush's last frame left alone because its ring was full. */
  brushDeclined: 0,
};

/** A new swing: the count of what it has cut starts again. The set of bodies is the kit's own. */
export function saberSwingStart(id: number): void {
  if (id === SABER_HIT_STATS.swing) return;
  SABER_HIT_STATS.swing = id;
  SABER_HIT_STATS.hits = 0;
}

/** A frame's blades are about to be swept at `now`: the per-frame counts start again. */
export function saberFrameStart(now: number): void {
  const s = SABER_HIT_STATS;
  if (s.at === now) return;
  s.at = now;
  s.blades = 0;
  s.casts = 0;
  s.steps = 0;
  s.travel = 0;
  s.fresh = 0;
}

/** One blade, swept: how far it had come, in how many casts, and whether its path started fresh. */
export function saberBladeSwept(travel: number, steps: number, fresh: boolean, hits: number): void {
  const s = SABER_HIT_STATS;
  s.blades++;
  s.casts += steps;
  if (steps > s.steps) s.steps = steps;
  if (travel > s.travel) s.travel = travel;
  if (fresh) s.fresh++;
  s.hits += hits;
}

/** The brush took something from `count` bodies at `now`, and left `declined` alone for want of a slot. */
export function noteBrush(count: number, now: number, declined = 0): void {
  SABER_HIT_STATS.brushDeclined = declined;
  if (count <= 0) return;
  SABER_HIT_STATS.brushed = count;
  SABER_HIT_STATS.brushedAt = now;
}

/** The floors that keep the rules finite: a zero step length divides by zero, a zero cap casts nothing. */
const FLOOR: Record<keyof SaberHitTune, number> = {
  stepLength: 0.01,
  maxSteps: 1,
  jump: 0,
  gap: 0,
  carry: 0.01,
  brushShare: 0,
  brushEvery: 0.01,
  brushRadius: 0.01,
  brushPush: 0,
};

/** Move the tuning live, as `__debug.saber({ stepLength: 0.2 })` does; returns what is in force. */
export function tuneSaberHit(opts?: Partial<SaberHitTune> | null): SaberHitTune {
  if (!opts) return SABER_HIT;
  for (const key of Object.keys(SABER_HIT) as (keyof SaberHitTune)[]) {
    const v = opts[key];
    if (typeof v === 'number' && Number.isFinite(v)) SABER_HIT[key] = Math.max(FLOOR[key], v);
  }
  SABER_HIT.maxSteps = Math.floor(SABER_HIT.maxSteps);
  return SABER_HIT;
}

const r3 = (v: number): number => (Number.isFinite(v) ? Number(v.toFixed(3)) : v);

/**
 * The readout: this swing's hits, what last frame's blades cost, the brush's last victims and the
 * tuning. Passing any of the tuning's numbers moves them first. Console only, so it may allocate.
 */
export function saberHitReport(opts?: Partial<SaberHitTune> | null): {
  swing: { id: number; hits: number };
  frame: { at: number; blades: number; casts: number; steps: number; travel: number; fresh: number };
  brush: { on: boolean; victims: number; last: string; secondsAgo: number | null; declined: number };
  tune: SaberHitTune;
} {
  if (opts) tuneSaberHit(opts);
  const s = SABER_HIT_STATS;
  const ago = Number.isFinite(s.brushedAt) && Number.isFinite(s.at) ? r3(s.at - s.brushedAt) : null;
  return {
    swing: { id: s.swing, hits: s.hits },
    frame: { at: r3(s.at), blades: s.blades, casts: s.casts, steps: s.steps, travel: r3(s.travel), fresh: s.fresh },
    brush: { on: SABER_HIT.brushShare > 0, victims: s.brushed, last: s.brushName, secondsAgo: ago, declined: s.brushDeclined },
    tune: { ...SABER_HIT },
  };
}
