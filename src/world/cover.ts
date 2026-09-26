// Somewhere to stand where the thing shooting at you cannot see you -- the search, as pure rules.
//
// **The client has no cover data of any kind**, so every rule below is ours. The archives carry the
// vocabulary and nothing else: `state.iff` has `Cover` as state 0 beside Aiming and Alert, 139
// commands in `command_table.iff` are gated on it, `posture.iff` and `locomotion.iff` carry the
// crouch, the kneel and the crawl, and the combat playback table names `fire_suppression`, `dodge`
// and a `lower_posture_<weapon>` family. Nothing anywhere computes, marks or stores a cover
// position: cover was a server-side state and the server never shipped. So this is Half-Life 2's
// idea rather than the game's, which is what the owner asked for -- bodies that get behind the map's
// own geometry, its buildings and its props.
//
// ## The shape of it
//
// Sample points near the body, cast a ray from each toward whatever is shooting, and keep the ones
// the world blocks. Two kinds come out of it, and the difference is the whole point:
//
//   - **crouch cover**: blocked at a crouched body's own chest and **open** at a standing one's. A
//     body ducks behind it and rises to shoot, which is what makes wave 5's postures worth having.
//   - **hard cover**: blocked at both. Nothing can touch it there and it cannot shoot back either,
//     so it is worth less, and how much less is the fighter's own tier (`hardCost`).
//
// The two heights are **not numbers of this file's**: they are `aimPointFor('crouch')` and
// `aimPointFor('stand')` out of `fighterStance.ts`, which are the very points the rest of the game
// shoots a body at in each posture. That is the only way the answer can mean anything -- a spot is
// cover exactly when a bolt aimed where bolts are aimed would not arrive, so if those move, these
// must move with them, and the node test moves one and watches this follow.
//
// ## Three things that are easy to get wrong
//
// **The blocker list is a hint; the rays are the truth.** A blocker is a disc and a top height, and
// the game will fill it from a placed object's own model box, which over-blocks a town's footprint
// by four to twelve times. That does not matter here, because nothing about a blocker ever *claims*
// cover: it only says where to aim a candidate point. Every spot that is kept was kept by a ray
// against the real colliders.
//
// **The hit test must see only what stands still.** Pass it a filter that keeps fixed and bodiless
// colliders (`Physics.cameraBlock`'s own predicate) or a body will take cover behind the very
// creature it is fighting, behind the player, or behind a speeder that is about to drive off.
//
// **A spot you cannot walk to is not cover.** Three tests answer that, and the second is the one
// that is not obvious: a ray down for a floor (so a spot is not out over a drop or half way up a
// wall), a ray along the ground from the body to the spot -- where **the blocker itself is allowed
// to be in the way**, since the spot is behind it by construction and the body will walk round, but
// anything nearer than the blocker's own face is a wall and refuses the spot -- and, where the world
// has a baked walkability grid, the grid's own ranks, which are the one thing that can say a place
// is on ground this body's ground is not joined to at all.
//
// ## Not indoors
//
// `ask.indoors` answers none at once and casts no ray. The reason it was written has since gone:
// what a building contains really is solid now, within its own range. What has **not** changed is
// `layoutStream.noteBlocker`, which still steps over every contained object, so the list this search
// reads is empty indoors and would find nothing however hard it looked. Turning that on is a wave of
// its own: the blocker list is walked up to four times a step, and a town's rooms would put
// thousands of chairs in it. Until then this answers none, and answers it at once.
//
// Pure: no three, no rapier, no browser. The physics is handed in as `CoverDeps`, so the node test
// builds a real rapier world, puts real boxes in it and asks this the real question rather than a
// mirror of it. Nothing here allocates after the searcher is made.
import { FIGHTER_BODY, aimPointFor, type FighterBody } from './fighterStance.ts';

/** Which kind of cover a spot is. */
export type CoverKind = 'crouch' | 'hard';

/**
 * Something to stand behind: a disc over its footprint and the height of its top, in the world.
 *
 * It is deliberately the crudest shape that can aim a candidate point. The game fills it from a
 * placed object's own model box, which is free at every distance and is wrong by four to twelve
 * times in a town -- and that is fine, because a blocker never claims cover, it only says where to
 * look. `gap` is written by the search and the filler leaves it alone.
 */
export interface Blocker {
  x: number;
  z: number;
  /** Half the widest span of its footprint: a disc that covers it. */
  radius: number;
  /** The world height of its top. */
  topY: number;
  /** How far its middle is from the body: the search writes this, the caller does not. */
  gap: number;
}

/**
 * The physics, handed in. Every argument is a primitive and every answer is a number, so a caller
 * can serve this without allocating and a node test can serve it out of a real rapier world.
 */
export interface CoverDeps {
  /**
   * Fill `out` with what stands within `reach` of (x, z) and could be hidden behind, and return how
   * many were written. It must write into the objects already in `out` -- at most `cap` of them --
   * and must not change the array's length.
   *
   * The order does not matter and neither does the quality: the search asks for as many as its
   * scratch holds and then keeps the nearest few itself, so a filler that simply hands over whatever
   * the broad phase gives it first is right. (It was not always: asking the filler to cap the list
   * meant a wide reach filled it with far-off props and quietly lost the near ones, which cost eight
   * points of the hit rate at a reach of twenty metres. The cap belongs where the distances are.)
   */
  blockers(x: number, z: number, reach: number, out: Blocker[], cap: number): number;
  /**
   * How far along the segment from a to b the first solid thing stands, or `Infinity` when the
   * segment is clear. **Only things that stand still may answer**: see the note at the top.
   */
  hit(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number;
  /**
   * The height of the floor at (x, z), searched downward from `fromY` for at most `maxDrop` metres,
   * or `NaN` when there is nothing to stand on.
   */
  floor(x: number, z: number, fromY: number, maxDrop: number): number;
  /**
   * Whether the ground at (bx, bz) is ground the body at (ax, az) could walk to at all. It is the
   * baked grid's own region ranks (`OutdoorNav.reachable`, which answers true whenever it does not
   * know and true for a world with no grid), and it is optional because a world without one is a
   * world where the two rays above are the whole answer.
   */
  sameGround?(ax: number, az: number, bx: number, bz: number): boolean;
}

/** What one search is asked. The caller keeps one of these and writes into it. */
export interface CoverAsk {
  /** Where the body's feet are. */
  x: number;
  y: number;
  z: number;
  /** The point a shot would come from: the threat's own aim point, which is what it shoots from. */
  tx: number;
  ty: number;
  tz: number;
  /** How far to look, metres. The tier's `coverWalk`, capped by `COVER_TUNE.reach`. */
  reach: number;
  /** How many extra metres of walk a spot it can shoot out of is worth. The tier's `hardCost`. */
  hardCost: number;
  /** Inside a building: the search answers none and casts nothing. See the note at the top. */
  indoors: boolean;
}

/** Somewhere to stand. One of these is kept and refilled; read it, do not hold it. */
export interface CoverSpot {
  /** The spot's feet, on the floor the search found under it. */
  x: number;
  y: number;
  z: number;
  kind: CoverKind;
  /** How far the body must walk to reach it, metres. */
  walk: number;
  /** What it scored: the walk, plus `ask.hardCost` when it cannot be shot out of. */
  score: number;
  /** Which blocker it stands behind, as an index into the last search's list; for the console. */
  blocker: number;
}

export interface CoverTune {
  /** The furthest a search ever looks, metres; `ask.reach` is capped by it. */
  reach: number;
  /** At most this many blockers are considered, nearest first. */
  maxBlockers: number;
  /** Candidate spots fanned behind each one: 1 is straight behind, 3 adds a pair, 5 adds another. */
  spots: number;
  /** How far each fanned pair is swung round the blocker, degrees. */
  fanDeg: number;
  /** How far past a blocker's own disc a body stands: its own radius, and a little air. */
  standoff: number;
  /**
   * A blocker whose top is less than this over the body's feet is no cover at all and costs no ray.
   *
   * It is a shade over a **crouched** body's own aim point, not a standing one's, and that is the
   * whole difference between a search that finds crouch cover and one that only ever finds walls: a
   * crate three quarters of a metre high stops a shot aimed where shots are aimed at a body on one
   * knee and lets one aimed at a standing body straight over, which is exactly the spot worth
   * having. Set at a standing chest instead, nothing under a metre would ever be looked at.
   */
  minTop: number;
  /** Nor is one narrower than this across. */
  minWide: number;
  /** A spot nearer the threat than this is not cover, it is a rush. */
  minGap: number;
  /** The height the walk ray is cast at: the character controller's own autostep. */
  step: number;
  /** The most a spot's floor may stand over the body's feet, and the most it may lie below them. */
  climb: number;
  drop: number;
  /** How much nearer than a blocker's own face something may stand and still be taken for the blocker. */
  slack: number;
  /** At most this many spots are walk-tested in one search, best score first. */
  checks: number;
  /** At most this many searches in one step of the simulation, over every body there is. */
  perStep: number;
}

/**
 * Every one of them invented. The first three are the design's own starting figures, kept because
 * the measurement in `tools/swg/tests/cover.test.ts` bore them out: at reach 12 with six blockers by
 * three spots a whole search is tens of microseconds and a ray is about a microsecond, flat in how
 * crowded the world is, so the average is nothing and the number to design against is a squad
 * engaging on one frame -- which is what `perStep` caps.
 */
export const COVER_TUNE: CoverTune = {
  reach: 12,
  maxBlockers: 6,
  spots: 3,
  fanDeg: 38,
  standoff: 0.55,
  minTop: 0.6,
  minWide: 0.6,
  minGap: 4,
  step: 0.5,
  climb: 1.2,
  drop: 2.5,
  slack: 0.6,
  checks: 3,
  perStep: 4,
};

/**
 * What the scratch is sized for, which is what the knob may never be moved past: a typed buffer
 * silently drops a write past its end, and a searcher that overflowed would go on counting spots it
 * does not hold.
 */
const BLOCKER_CAP = 24;
const FAN_CAP = 7;
// One note about that first number, since it is the one place the filler's own order can still
// matter: with more than `BLOCKER_CAP` things standing within reach, which of them the search ever
// sees is whichever the filler handed over, and the nearest-first cap below can only sort what it
// was given. Twenty-four is ample for the real case -- a random spot beside a placed object on any
// of the game's planets has a median three to six things worth hiding behind within twelve metres --
// and it is only a synthetic junkyard that fills it.

const TUNE_FLOOR: Record<keyof CoverTune, number> = {
  reach: 1,
  maxBlockers: 0,
  spots: 1,
  fanDeg: 0,
  standoff: 0,
  minTop: 0,
  minWide: 0,
  minGap: 0,
  step: 0,
  climb: 0,
  drop: 0,
  slack: 0,
  checks: 1,
  perStep: 0,
};

const TUNE_CEILING: Partial<Record<keyof CoverTune, number>> = { maxBlockers: BLOCKER_CAP, spots: FAN_CAP };

/** Move the search's numbers live; returns what is in force. `__debug.fighters({ cover: { reach: 20 } })`. */
export function tuneCover(opts?: Partial<CoverTune> | null): CoverTune {
  if (!opts) return COVER_TUNE;
  for (const key of Object.keys(COVER_TUNE) as (keyof CoverTune)[]) {
    const v = opts[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    COVER_TUNE[key] = Math.min(TUNE_CEILING[key] ?? Infinity, Math.max(TUNE_FLOOR[key], v));
  }
  return COVER_TUNE;
}

/**
 * Fill the two fields of an ask that come from the body's tier, from anything carrying those two
 * numbers (`GroundSkill` in `groundSkill.ts` does). It is a bridge by shape rather than by import,
 * so neither module has to know the other exists.
 */
export function askFromSkill(ask: CoverAsk, skill: { coverWalk: number; hardCost: number }, tune: CoverTune = COVER_TUNE): CoverAsk {
  ask.reach = Math.max(0, Math.min(tune.reach, skill.coverWalk));
  ask.hardCost = Math.max(0, skill.hardCost);
  return ask;
}

/** What `coverHeights` hands back: one kept object, refilled. Read it, do not keep it. */
export interface CoverHeights {
  low: number;
  stand: number;
}

const HEIGHTS: CoverHeights = { low: 0, stand: 0 };

/**
 * The heights the two rays are cast at, over the spot's own floor: the points the rest of the game
 * shoots a crouched body and a standing one at. Read out of the hitbox every time rather than kept,
 * because the hitbox is live (`__debug.fighters({ body: { lowHalf: … } })`) and a cover search whose
 * heights were literals would go on answering about a body that no longer exists.
 */
export function coverHeights(tune: FighterBody = FIGHTER_BODY, out: CoverHeights = HEIGHTS): CoverHeights {
  out.low = aimPointFor('crouch', tune);
  out.stand = aimPointFor('stand', tune);
  return out;
}

export interface CoverStatus {
  /** Searches asked for, and what they came to. */
  asked: number;
  found: number;
  crouch: number;
  hard: number;
  /** Looked and found nothing worth standing behind. */
  none: number;
  /** Refused without a ray because the body was inside a building. */
  indoor: number;
  /** Put off to the next step because this one had spent its budget. */
  deferred: number;
  /** Totals over the session: blockers the filler offered, candidate spots made, rays cast. */
  blockers: number;
  candidates: number;
  rays: number;
  /** What the last search that really ran cost; `lastBlockers` is how many were really considered. */
  lastBlockers: number;
  lastCandidates: number;
  lastRays: number;
  lastMs: number;
  /** The worst one search has cost since the game started, milliseconds. */
  worstMs: number;
  tune: CoverTune;
}

/** One candidate, kept in a pool and refilled. */
interface Candidate {
  x: number;
  z: number;
  kind: CoverKind;
  walk: number;
  score: number;
  blocker: number;
  /** Whether the walk test has already thrown it out. */
  done: boolean;
}

/** The clock, where there is one; a searcher that cannot read one simply reports nought. */
const NOW: () => number = typeof performance === 'object' && performance && typeof performance.now === 'function' ? () => performance.now() : () => 0;

/**
 * The search itself, and the budget. One of these serves every body in the world, exactly as
 * `outdoorNav` does: it holds nothing but scratch and counters, and the per-step budget is what
 * keeps a squad that engages together off one frame.
 */
export class CoverSearch {
  private readonly pool: Blocker[] = [];
  private readonly cands: Candidate[] = [];
  private stepAt = Number.NaN;
  private stepRuns = 0;
  private askedCount = 0;
  private foundCount = 0;
  private crouchCount = 0;
  private hardCount = 0;
  private noneCount = 0;
  private indoorCount = 0;
  private deferredCount = 0;
  private blockerCount = 0;
  private candidateCount = 0;
  private rayCount = 0;
  private lastBlockers = 0;
  private lastCandidates = 0;
  private lastRays = 0;
  private lastMs = 0;
  private worstMs = 0;
  /** The one answer, refilled: read it and do not keep it. */
  private readonly spot: CoverSpot = { x: 0, y: 0, z: 0, kind: 'crouch', walk: 0, score: 0, blocker: -1 };
  readonly tune: CoverTune = COVER_TUNE;

  constructor() {
    for (let i = 0; i < BLOCKER_CAP; i++) this.pool.push({ x: 0, z: 0, radius: 0, topY: 0, gap: 0 });
    for (let i = 0; i < BLOCKER_CAP * FAN_CAP; i++) this.cands.push({ x: 0, z: 0, kind: 'crouch', walk: 0, score: 0, blocker: -1, done: false });
  }

  /**
   * Whether a spot really is cover against a threat -- the two rays and nothing else, so a body can
   * ask whether the crate it is already behind still answers now that the shooting has moved. Null
   * when a bolt at either height would arrive.
   *
   * It takes the spot's own feet, which is where the body is standing, and casts from the floor it
   * is given rather than looking for one: the body is standing on it.
   *
   * Indoors it answers none and casts nothing, exactly as `find` does and for exactly the same
   * reason: the props in there are not colliders, so a spot behind one would stop no bolts. The two
   * entry points must agree about that or a body that walked its cover spot indoors would go on
   * believing an answer the search would refuse to give it.
   */
  test(deps: CoverDeps, ask: CoverAsk, x: number, y: number, z: number): CoverKind | null {
    if (ask.indoors) return null;
    const h = coverHeights();
    if (!this.blockedAt(deps, ask, x, y + h.low, z)) return null;
    return this.blockedAt(deps, ask, x, y + h.stand, z) ? 'hard' : 'crouch';
  }

  /**
   * Somewhere to stand, or null. The answer is one kept object: read it on the frame it is handed
   * over.
   *
   * `now` is the simulated clock the rest of the game runs on, and it is what the per-step budget is
   * counted against -- a body turned away keeps whatever it already has and asks again next step.
   */
  find(deps: CoverDeps, ask: CoverAsk, now: number, tune: CoverTune = this.tune): CoverSpot | null {
    this.askedCount++;
    if (ask.indoors) {
      this.indoorCount++;
      return null;
    }
    if (now !== this.stepAt) {
      this.stepAt = now;
      this.stepRuns = 0;
    }
    if (this.stepRuns >= tune.perStep) {
      this.deferredCount++;
      return null;
    }
    this.stepRuns++;
    const t0 = NOW();
    const rays0 = this.rayCount;
    const out = this.search(deps, ask, tune);
    this.lastMs = NOW() - t0;
    if (this.lastMs > this.worstMs) this.worstMs = this.lastMs;
    this.lastRays = this.rayCount - rays0;
    if (out) {
      this.foundCount++;
      if (out.kind === 'hard') this.hardCount++;
      else this.crouchCount++;
    } else {
      this.noneCount++;
    }
    return out;
  }

  private search(deps: CoverDeps, ask: CoverAsk, tune: CoverTune): CoverSpot | null {
    const reach = Math.max(0, Math.min(tune.reach, ask.reach));
    if (!(reach > 0)) return null;
    const cap = Math.max(0, Math.min(BLOCKER_CAP, Math.round(tune.maxBlockers)));
    if (cap === 0) return null;
    // Ask for as many as the scratch holds, not as many as will be used: the cap has to be applied
    // where the distances are known, or a wide reach fills the list with whatever the broad phase
    // happened to walk first and the thing standing two metres away is never looked at.
    const got = Math.max(0, Math.min(BLOCKER_CAP, deps.blockers(ask.x, ask.z, reach, this.pool, BLOCKER_CAP) | 0));
    this.blockerCount += got;
    if (got === 0) {
      this.lastBlockers = 0;
      return null;
    }

    // Nearest first, so the cap keeps the nearest and the distance bound below can stop the search
    // early. Insertion sort over at most `BLOCKER_CAP` entries, swapping references in a pool that
    // is refilled next call.
    for (let i = 0; i < got; i++) {
      const b = this.pool[i];
      b.gap = Math.hypot(b.x - ask.x, b.z - ask.z);
    }
    for (let i = 1; i < got; i++) {
      const b = this.pool[i];
      let j = i - 1;
      while (j >= 0 && this.pool[j].gap > b.gap) {
        this.pool[j + 1] = this.pool[j];
        j--;
      }
      this.pool[j + 1] = b;
    }
    const n = Math.min(got, cap);
    this.lastBlockers = n;

    const h = coverHeights();
    const fan = Math.max(1, Math.min(FAN_CAP, Math.round(tune.spots)));
    const fanRad = tune.fanDeg * (Math.PI / 180);
    const hard = Math.max(0, ask.hardCost);
    let count = 0;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const b = this.pool[i];
      // Nothing to hide behind: too short for a crouched body's own chest, or narrower than one.
      if (!(b.topY >= ask.y + tune.minTop)) continue;
      if (!(b.radius * 2 >= tune.minWide)) continue;
      // Every spot behind this blocker is at least this far off, so once the best already found is
      // nearer than that, no blocker further out can beat it and the rest cost nothing.
      const bound = Math.max(0, b.gap - b.radius - tune.standoff);
      if (bound >= best) break;
      let ux = b.x - ask.tx;
      let uz = b.z - ask.tz;
      const ul = Math.hypot(ux, uz);
      if (!(ul > 1e-3)) continue;
      ux /= ul;
      uz /= ul;
      const out = b.radius + tune.standoff;
      for (let k = 0; k < fan; k++) {
        const swing = Math.floor((k + 1) / 2) * fanRad * (k % 2 === 1 ? 1 : -1);
        const cs = Math.cos(swing);
        const sn = Math.sin(swing);
        const dx = ux * cs - uz * sn;
        const dz = ux * sn + uz * cs;
        const sx = b.x + dx * out;
        const sz = b.z + dz * out;
        const walk = Math.hypot(sx - ask.x, sz - ask.z);
        if (walk > reach) continue;
        if (Math.hypot(sx - ask.tx, sz - ask.tz) < tune.minGap) continue;
        // The walk alone is a lower bound on the score, so a candidate that cannot beat the best
        // already found costs no ray at all. What passes the rays is then kept whatever it scores:
        // the rays are already paid for, and a worse spot is the fallback when the best one turns
        // out to be somewhere the body cannot get to.
        if (walk >= best) continue;
        // The ray that decides it. The floor under the spot is not known yet, so the height is taken
        // over the body's own feet; the floor test below refuses anything more than a step away from
        // them, so the two can never be far apart.
        if (!this.blockedAt(deps, ask, sx, ask.y + h.low, sz)) continue;
        const kind: CoverKind = this.blockedAt(deps, ask, sx, ask.y + h.stand, sz) ? 'hard' : 'crouch';
        const score = walk + (kind === 'hard' ? hard : 0);
        const c = this.cands[count++];
        c.x = sx;
        c.z = sz;
        c.kind = kind;
        c.walk = walk;
        c.score = score;
        c.blocker = i;
        c.done = false;
        if (score < best) best = score;
        if (count >= this.cands.length) break;
      }
      if (count >= this.cands.length) break;
    }
    this.lastCandidates = count;
    this.candidateCount += count;
    if (count === 0) return null;

    // Best score first, and at most `checks` of them walk-tested: a spot nobody can get to is not
    // cover, and finding that out costs a ray each.
    const checks = Math.max(1, Math.round(tune.checks));
    for (let tries = 0; tries < checks; tries++) {
      let pick = -1;
      let low = Infinity;
      for (let i = 0; i < count; i++) {
        const c = this.cands[i];
        if (c.done || c.score >= low) continue;
        low = c.score;
        pick = i;
      }
      if (pick < 0) break;
      const c = this.cands[pick];
      c.done = true;
      const y = this.standable(deps, ask, c, tune);
      if (Number.isNaN(y)) continue;
      this.spot.x = c.x;
      this.spot.y = y;
      this.spot.z = c.z;
      this.spot.kind = c.kind;
      this.spot.walk = c.walk;
      this.spot.score = c.score;
      this.spot.blocker = c.blocker;
      return this.spot;
    }
    return null;
  }

  /**
   * Whether the body could really stand at a candidate, and the height of the floor there; NaN when
   * it could not.
   *
   * Three refusals, and the middle one is the whole trick. The floor has to be there and within a
   * step of the body's own feet, or the spot is out over a drop or half way up a wall. Then one ray
   * along the ground: the blocker the spot stands behind is **allowed** to be in the way, because
   * the spot is on the far side of it by construction and a body walks round such a thing every day
   * -- but anything standing nearer than that blocker's own face is a wall between the two, and the
   * spot is refused. And last, where the world has a baked grid, its region ranks, which are the one
   * thing that can say a place is on ground this body's ground is not joined to at all.
   */
  private standable(deps: CoverDeps, ask: CoverAsk, c: Candidate, tune: CoverTune): number {
    this.rayCount++;
    const fy = deps.floor(c.x, c.z, ask.y + tune.climb, tune.climb + tune.drop);
    if (!Number.isFinite(fy)) return Number.NaN;
    if (fy > ask.y + tune.climb || fy < ask.y - tune.drop) return Number.NaN;
    const b = this.pool[c.blocker];
    const ay = ask.y + tune.step;
    const by = fy + tune.step;
    const len = Math.hypot(c.x - ask.x, by - ay, c.z - ask.z);
    this.rayCount++;
    const h = deps.hit(ask.x, ay, ask.z, c.x, by, c.z);
    const face = b ? Math.max(0, b.gap - b.radius - tune.slack) : len;
    if (h < len - 1e-3 && h < face) return Number.NaN;
    if (deps.sameGround && !deps.sameGround(ask.x, ask.z, c.x, c.z)) return Number.NaN;
    return fy;
  }

  /** One ray from a point toward the threat: whether something solid stands in the way. */
  private blockedAt(deps: CoverDeps, ask: CoverAsk, x: number, y: number, z: number): boolean {
    this.rayCount++;
    const len = Math.hypot(ask.tx - x, ask.ty - y, ask.tz - z);
    if (!(len > 1e-3)) return false;
    return deps.hit(x, y, z, ask.tx, ask.ty, ask.tz) < len - 1e-3;
  }

  status(): CoverStatus {
    return {
      asked: this.askedCount,
      found: this.foundCount,
      crouch: this.crouchCount,
      hard: this.hardCount,
      none: this.noneCount,
      indoor: this.indoorCount,
      deferred: this.deferredCount,
      blockers: this.blockerCount,
      candidates: this.candidateCount,
      rays: this.rayCount,
      lastBlockers: this.lastBlockers,
      lastCandidates: this.lastCandidates,
      lastRays: this.lastRays,
      lastMs: Number(this.lastMs.toFixed(4)),
      worstMs: Number(this.worstMs.toFixed(4)),
      tune: this.tune,
    };
  }

  /** Move a number for a run and read the counters back; anything that is not a number is left alone. */
  set(values: Partial<CoverTune>): CoverStatus {
    tuneCover(values);
    return this.status();
  }

  /** Forget the counters. Nothing in play calls it; the node test does, between measurements. */
  forget(): void {
    this.askedCount = 0;
    this.foundCount = 0;
    this.crouchCount = 0;
    this.hardCount = 0;
    this.noneCount = 0;
    this.indoorCount = 0;
    this.deferredCount = 0;
    this.blockerCount = 0;
    this.candidateCount = 0;
    this.rayCount = 0;
    this.lastBlockers = 0;
    this.lastCandidates = 0;
    this.lastRays = 0;
    this.lastMs = 0;
    this.worstMs = 0;
    this.stepAt = Number.NaN;
    this.stepRuns = 0;
  }
}

/**
 * The one searcher. Like `outdoorNav` it holds nothing but scratch, so every body in the world
 * shares it and the per-step budget means what it says.
 */
export const coverSearch = new CoverSearch();
