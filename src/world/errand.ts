// An order a body does not forget, and an account of the walk that cannot flatter it.
//
// The order is the owner's: *send somebody from one town to another and watch how they do*. It is
// three writes on the body and nothing else. The creatures' brain (`mobiles/brain.ts`) already has
// the rule, as its very first one: past the leash, run home, take no target, answer nobody, until
// you are within two metres of home. So the order **is** the home. Move a body's `homeX`/`homeZ`
// onto the destination and rule 1 carries it there and will not be distracted.
//
// The third write is the one that is easy to miss, and leaving it out made a short order do nothing
// at all. Rule 1 is two clauses: `fromHome > leash`, and `state === 'return' && fromHome > home`.
// Since the home **is** the destination, the first clause says nothing more than "the destination is
// further off than the leash" -- 60 m outdoors, 25 m in a building. An order to anything nearer than
// that never fired rule 1 at all: the body fell through to the wander rule and pottered about within
// 30 m of its new home, and the account then read that as a stall and said, wrongly and in so many
// words, that it had wedged. The second clause is also the only thing carrying the *last* 60 m of
// every long walk, and it does so today only because nothing in the game moves a fighter's state out
// of `return` -- an accident rather than a guarantee. So the order asserts that state itself, every
// step, through `ErrandBody.holdReturn`, and now holds at every distance for a reason that is
// written down. `brain.ts` is still not opened and nothing is layered over it. Everything in this
// file beside those three writes is the account of what happened.
//
// The account is the point. The running game builds placed-object colliders only within 170 m of
// the player (`COLLIDER_RANGE`, `layoutStream.ts`; and not even there for a prop under the
// streamer's own radius floor, or for anything a building contains, which are never solid at any
// distance -- so "inside the bubble" means the buildings, the rocks and the larger crates were real,
// not that nothing could be walked through) and terrain collision only within three 64 m
// chunks of it (`PHYSICS_RADIUS`, `world.ts`), and outdoors a fighter's last floor is the planet's
// height, which clamps it *up* and never sideways. **So a body walking alone is stopped by nothing
// at all**: it walks through mesas and through buildings and arrives having proved nothing, and
// that arrival looks exactly like a success. A run therefore refuses to call itself a result
// unless it recorded, once a second, how far the body was from the player, and says *inconclusive*
// in words when it was mostly out there. That refusal is the whole reason this file exists rather
// than a field on the body.
//
// Three things the order cannot do anything about, said here rather than discovered later:
//
//  - **It will not fight back.** Rule 1 outranks the attacker memory and `goHome` sets
//    `clearMemory`, so whatever bites it on the way is forgotten every thought. That is right for a
//    pathing test and wrong for anything else, and a fighter has 160 health and does not heal.
//  - **It has no escape.** `npcs.ts` has no side-step of any kind, and the brain's own "stuck, give
//    this up" rule lives inside `if (target)`, which this order never has. A wedged body leans, and
//    goes on leaning. That is good for diagnosis and is exactly why the order must end itself on a
//    clock (`stallSeconds`, `budgetShare`) as well as on arrival.
//  - **It does not know what water is.** `npcs.ts` has no water or swim handling anywhere, so a
//    fighter sent across a world with lakes walks the lake bed. The first long walk belongs on a
//    dry world. The account counts the samples that stood in water so the owner can see it happen
//    rather than take it on trust.
//
// Rule for this file (a node test runs it with type stripping): relative value imports carry their
// `.ts`, no parameter properties, no three, no physics, no browser -- plain numbers in and out, so
// the whole instrument can be driven by hand.
import { BRAIN_TUNE } from './mobiles/brain.ts';

/**
 * What a long walk is measured with. Two of these are **not** invented and must not be tuned into
 * something comfortable: `objectsWithin` and `terrainWithin` are read off the running game and
 * pinned to it by the node test. Everything else is ours and lives through `__debug.send({ tune })`.
 */
export interface ErrandTune {
  /**
   * How far the player's placed-object colliders reach, metres. `COLLIDER_RANGE` in
   * `src/world/layoutStream.ts`. **Not ours.** Within this the body is stopped by what stops the
   * player -- which is not everything that is drawn: the same loop skips anything whose radius is
   * under `COLLIDER_MIN_RADIUS` and anything a building contains, at every distance. So this is the
   * range within which the buildings, the rocks and the larger crates are solid, and the small props
   * are never solid anywhere.
   */
  objectsWithin: number;
  /**
   * How far terrain collision reaches, metres: `PHYSICS_RADIUS` (3) chunks of `CHUNK_SIZE` (64) in
   * `src/world/world.ts` and `src/world/terrain.ts`. **Not ours.** Between this and `objectsWithin`
   * only the ground can stop a body; past it nothing can.
   */
  terrainWithin: number;
  /**
   * The share of a run's one-second samples that must have been inside `objectsWithin` before the
   * run may call an arrival a result. INVENTED. Below it the verdict is `inconclusive`, whatever
   * happened: an arrival out in the open country proves only that the straight line was empty of
   * colliders, which it always is out there.
   */
  provedShare: number;
  /** Seconds of simulated time between track rows. INVENTED. */
  sampleEvery: number;
  /** How many rows the track holds before it stops recording (and says so). INVENTED. */
  trackRows: number;
  /**
   * Seconds without the best-ever distance to the destination improving by `stallStep` before the
   * order gives up and calls itself stalled. INVENTED, and load-bearing: with no side-step a wedged
   * fighter leans for ever, so without this the order never ends.
   */
  stallSeconds: number;
  /** Metres of improvement that count as progress. INVENTED. */
  stallStep: number;
  /**
   * The whole order's clock, as a multiple of the straight line walked at the body's run speed,
   * with `budgetFloor` as its least. INVENTED.
   */
  budgetShare: number;
  budgetFloor: number;
  /**
   * `held` under this, for `heldFor` seconds together, is a body leaning on something rather than
   * walking: where that first happened is the single most useful line in the report. INVENTED.
   */
  heldUnder: number;
  heldFor: number;
  /**
   * Metres of water over the feet that count as deep -- the depth wave 4's bake means to mark as
   * blocked. INVENTED here, and only ever counted, never acted on: nothing in `npcs.ts` reads it.
   */
  deepWater: number;
}

export const ERRAND_TUNE: ErrandTune = {
  objectsWithin: 170,
  terrainWithin: 192,
  provedShare: 0.9,
  sampleEvery: 1,
  trackRows: 4096,
  stallSeconds: 45,
  stallStep: 5,
  budgetShare: 4,
  budgetFloor: 60,
  heldUnder: 0.35,
  heldFor: 2,
  deepWater: 1.2,
};

/**
 * Move the invented numbers live. The two that are the game's own are refused outright rather than
 * clamped, because an instrument whose own idea of the streaming bubble can be typed over is an
 * instrument that can be made to say anything.
 */
export function tuneErrand(patch: Partial<ErrandTune>): ErrandTune {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  if (patch.provedShare !== undefined) ERRAND_TUNE.provedShare = clamp(patch.provedShare, 0, 1);
  if (patch.sampleEvery !== undefined) ERRAND_TUNE.sampleEvery = clamp(patch.sampleEvery, 0.1, 60);
  if (patch.trackRows !== undefined) ERRAND_TUNE.trackRows = Math.round(clamp(patch.trackRows, 16, 65536));
  if (patch.stallSeconds !== undefined) ERRAND_TUNE.stallSeconds = clamp(patch.stallSeconds, 1, 3600);
  if (patch.stallStep !== undefined) ERRAND_TUNE.stallStep = clamp(patch.stallStep, 0.1, 500);
  if (patch.budgetShare !== undefined) ERRAND_TUNE.budgetShare = clamp(patch.budgetShare, 1, 100);
  if (patch.budgetFloor !== undefined) ERRAND_TUNE.budgetFloor = clamp(patch.budgetFloor, 5, 36000);
  if (patch.heldUnder !== undefined) ERRAND_TUNE.heldUnder = clamp(patch.heldUnder, 0, 1);
  if (patch.heldFor !== undefined) ERRAND_TUNE.heldFor = clamp(patch.heldFor, 0.1, 60);
  if (patch.deepWater !== undefined) ERRAND_TUNE.deepWater = clamp(patch.deepWater, 0.1, 20);
  return ERRAND_TUNE;
}

/**
 * The brain's states, in the order a track row's byte codes them. Index 255 is "something else".
 *
 * A new word goes on the **end**, never in the middle: the code is the index and a track already
 * printed is read against this list. `cover` is therefore last rather than beside `attack`, which
 * is where it sits in `MobileState` itself. A body under one of these walks is never in it in any
 * case -- the order holds the body upright and `Npc.stepCover` refuses outright while an errand
 * runs -- so the row is there for the day the two are allowed to overlap.
 */
export const ERRAND_STATES = ['loading', 'idle', 'wander', 'alert', 'chase', 'attack', 'flee', 'return', 'knockdown', 'dying', 'dead', 'cover'] as const;

function stateCode(name: string): number {
  const i = (ERRAND_STATES as readonly string[]).indexOf(name);
  return i < 0 ? 255 : i;
}

/**
 * What the walk reads off a body once a frame. Written into, never made: a quarter of an hour of
 * walking is about fifty thousand frames and nothing here may allocate on any of them.
 */
export interface ErrandProbe {
  x: number;
  y: number;
  z: number;
  /** Which way it is pointing, radians, the game's own heading. */
  heading: number;
  /** The brain's state word. */
  state: string;
  /** The share of the ground it asked for that it actually covered this frame; 1 when it asked for none. */
  held: number;
  /** Whether it asked to move at all this frame (so a standing body is never read as held up). */
  asking: boolean;
  /** How many times running the stuck check has fired. Outdoors, on a healthy run, 0. */
  stuck: number;
  /** How often the floor of last resort had to lift it a whole body, and by how much last time. Both must stay 0. */
  lifted: number;
  liftedBy: number;
  grounded: boolean;
  /** Whether it is in a building's room. */
  inside: boolean;
  hp: number;
  dead: boolean;
  /** Its own path counters: searches asked for, and searches that found nothing. Never printed before this. */
  plans: number;
  failures: number;
}

/** One of these per walk, made with the order and then only written to. */
export function newErrandProbe(): ErrandProbe {
  return { x: 0, y: 0, z: 0, heading: 0, state: 'idle', held: 1, asking: false, stuck: 0, lifted: 0, liftedBy: 0, grounded: true, inside: false, hp: 0, dead: false, plans: 0, failures: 0 };
}

/**
 * A body that can be given an order: its home is the order, and it can say what it is doing. `Npc`
 * is the only thing in the game that answers to this today, deliberately -- a creature heals a
 * third of its health a second while it is going home, which would make the walk unkillable and
 * hide the "it died on the way" failure this report most needs to be able to name, and a creature
 * can be handed to another browser half way and lose the brain's state with the hand-over.
 */
export interface ErrandBody {
  readonly key: number;
  readonly label: string;
  /** Not readonly: moving these two **is** the order. */
  homeX: number;
  homeZ: number;
  /**
   * Put the body in the brain's "on the way home" state, which is the clause of rule 1 that carries
   * the order once the destination is nearer than the leash -- the whole of a short order, and the
   * last sixty metres of a long one. The body decides what that means and what it refuses (a dead
   * one writes nothing), so this file never names a state word or knows the brain's enum.
   */
  holdReturn(): void;
  probe(out: ErrandProbe): void;
}

/** What the walk needs of the world each step. One of these is kept by the caller and written into. */
export interface ErrandWorld {
  playerX: number;
  playerZ: number;
  /** False when the player is not in the world's list of the living this step (dead, or gone). */
  playerKnown: boolean;
  /**
   * `SwgTerrain.syncGenerations`: terrain blocks generated on the main thread, one stutter each. It
   * is the world's one counter and everything that asks the terrain for a height moves it, the
   * player included, so differenced over a walk it is how stuttery that stretch of world was and not
   * what the body walking it cost.
   */
  syncGrids: number;
  /** Metres of water over a point; 0 or less is dry. Called at most once a sample, never on a frame. */
  waterOver(x: number, y: number, z: number): number;
}

/** How a walk ended. `walking` is the one that means it has not. */
export type ErrandEnd = 'walking' | 'arrived' | 'stalled' | 'spent' | 'died' | 'stopped' | 'gone';

/** One row of the track, built only when the console asks for it. */
export interface ErrandRow {
  t: number;
  x: number;
  z: number;
  toGoal: number;
  fromPlayer: number;
  solid: string;
  /** Degrees between the way it is pointing and the way the destination lies: what it is steering at. */
  bearing: number;
  held: number;
  state: string;
  stuck: number;
  hp: number;
}

/**
 * One order, and the account of the walk it caused.
 *
 * Every clock in it is the world's simulated one (`World.simTime`), so `__debug.advance` steps a
 * walk exactly as a real minute does -- which is *not* the same as `advance` being a fair test of
 * one, because `advance` never calls `world.update` and so nothing streams: the body walks out of
 * the bubble on its first stride and the report says `inconclusive` for exactly the right reason.
 */
export class Errand {
  readonly body: ErrandBody;
  /** Where it was sent, and the world's own name for the place when it was named rather than typed. */
  readonly toX: number;
  readonly toZ: number;
  readonly place: string | null;
  /** Where it set off from, and how far that is in a straight line. */
  readonly fromX: number;
  readonly fromZ: number;
  readonly straight: number;
  /** Where its home stood before the order. Kept for the record only: it is never put back (see `finish`). */
  readonly wasHomeX: number;
  readonly wasHomeZ: number;
  readonly startedAt: number;
  /** The run speed the budget is reckoned against, m/s: the body's own, handed in so this file need not know it. */
  readonly runSpeed: number;

  done = false;
  ended: ErrandEnd = 'walking';
  endedAt = 0;

  private readonly probe = newErrandProbe();
  /** Whether `probe` has ever been filled: before the first step there are no numbers at all. */
  private probed = false;
  private now = 0;
  private lastStepAt = 0;
  private lastSampleAt = 0;
  private lastX = 0;
  private lastZ = 0;
  /** The ground really covered, summed every frame rather than between samples. */
  private travelled = 0;
  /** The nearest it has ever been to the destination, and the clock since that improved. */
  private best = Infinity;
  private stallClock = 0;
  /** Seconds it has been getting less than `heldUnder` of the ground it asked for, in a row. */
  private heldClock = 0;
  private firstHeldT = -1;
  private firstHeldX = 0;
  private firstHeldZ = 0;
  private firstHeldToGoal = 0;
  private hpStart = 0;
  private hpLow = Infinity;
  private syncStart = 0;
  private syncNow = 0;
  private plansStart = 0;
  private failuresStart = 0;
  /**
   * The body's stuck and lift counters at the order, so the report can print **this walk's** rather
   * than the body's whole life's. A fighter stood an hour ago, pushed about and wedged on a doorway
   * since, would otherwise hand its history to the first walk it is given -- and the report's own
   * note says those numbers must stay 0 on a healthy outdoor run, which would then be a sentence
   * that is only true of a body stood fresh.
   */
  private stuckStart = 0;
  private liftedStart = 0;

  /** The track: one column an array, sized once with the order and then only written into. */
  private readonly tT: Float64Array;
  private readonly tX: Float64Array;
  private readonly tZ: Float64Array;
  private readonly tGoal: Float64Array;
  private readonly tPlayer: Float64Array;
  private readonly tBear: Float32Array;
  private readonly tHeld: Float32Array;
  private readonly tHp: Float32Array;
  private readonly tStuck: Uint16Array;
  private readonly tState: Uint8Array;
  private rows = 0;
  /** Samples taken in all, including the ones past the end of the track. */
  private samples = 0;
  private near = 0;
  private terrainOnly = 0;
  private alone = 0;
  private noPlayer = 0;
  private wet = 0;
  private deep = 0;

  constructor(body: ErrandBody, to: { x: number; z: number; place?: string | null }, now: number, runSpeed: number) {
    this.body = body;
    this.toX = to.x;
    this.toZ = to.z;
    this.place = to.place ?? null;
    this.wasHomeX = body.homeX;
    this.wasHomeZ = body.homeZ;
    this.startedAt = now;
    this.now = now;
    this.lastStepAt = now;
    this.lastSampleAt = now;
    this.runSpeed = Math.max(0.1, runSpeed);
    body.probe(this.probe);
    this.probed = true;
    this.fromX = this.probe.x;
    this.fromZ = this.probe.z;
    this.lastX = this.probe.x;
    this.lastZ = this.probe.z;
    this.straight = Math.hypot(this.toX - this.fromX, this.toZ - this.fromZ);
    this.best = this.straight;
    this.hpStart = this.probe.hp;
    this.hpLow = this.probe.hp;
    this.plansStart = this.probe.plans;
    this.failuresStart = this.probe.failures;
    this.stuckStart = this.probe.stuck;
    this.liftedStart = this.probe.lifted;
    const n = Math.max(16, Math.round(ERRAND_TUNE.trackRows));
    this.tT = new Float64Array(n);
    this.tX = new Float64Array(n);
    this.tZ = new Float64Array(n);
    this.tGoal = new Float64Array(n);
    this.tPlayer = new Float64Array(n);
    this.tBear = new Float32Array(n);
    this.tHeld = new Float32Array(n);
    this.tHp = new Float32Array(n);
    this.tStuck = new Uint16Array(n);
    this.tState = new Uint8Array(n);
    // The order itself, and the only three writes this whole file makes to the body.
    body.homeX = this.toX;
    body.homeZ = this.toZ;
    body.holdReturn();
  }

  /** Seconds of simulated time since the order was given. */
  get seconds(): number {
    return (this.done ? this.endedAt : this.now) - this.startedAt;
  }

  /** How far it still has to go, straight. */
  get toGoal(): number {
    return Math.hypot(this.probe.x - this.toX, this.probe.z - this.toZ);
  }

  /**
   * The budget: `budgetShare` times the straight line at the body's own run speed, never less than
   * `budgetFloor`. A walk that takes longer than this has not been walking, whatever it says.
   */
  get budget(): number {
    return Math.max(ERRAND_TUNE.budgetFloor, (this.straight / this.runSpeed) * ERRAND_TUNE.budgetShare);
  }

  /**
   * Whether the run is worth reading at all: the share of its samples taken where every collider
   * along the route really existed. This is the whole instrument. It is not a tuning question and
   * it is not a nicety -- a walk taken outside the bubble has walked through the world rather than
   * across it.
   */
  get proved(): boolean {
    return this.samples > 0 && this.near / this.samples >= ERRAND_TUNE.provedShare;
  }

  /** Words for the verdict. An arrival that was not proved is never called an arrival. */
  get verdict(): string {
    if (!this.done) return 'walking';
    if (this.ended === 'arrived') return this.proved ? 'arrived' : 'inconclusive';
    if (this.ended === 'stopped') return 'stopped by hand';
    if (this.ended === 'gone') return 'the body went';
    return this.ended;
  }

  /** One step of the walk. Called every frame the world steps the living, from `NpcManager.update`. */
  step(now: number, world: ErrandWorld): void {
    if (this.done) return;
    const dt = Math.max(0, now - this.lastStepAt);
    this.lastStepAt = now;
    this.now = now;
    const p = this.probe;
    this.body.probe(p);
    this.probed = true;
    // The order is re-asserted every step rather than written once, so nothing that moves a home or
    // a state can quietly lift it half way. Three writes and no allocation. `holdReturn` is what
    // holds an order whose destination is nearer than the brain's leash, which is every order given
    // to something in sight and the last stretch of every long one; without it such an order left
    // the body wandering its new neighbourhood and the account called that a wedge.
    this.body.homeX = this.toX;
    this.body.homeZ = this.toZ;
    this.body.holdReturn();
    this.travelled += Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x;
    this.lastZ = p.z;
    this.syncNow = world.syncGrids;
    if (p.hp < this.hpLow) this.hpLow = p.hp;
    // Leaning: getting far less of the ground than it asked for, for a couple of seconds together.
    if (p.asking && p.held < ERRAND_TUNE.heldUnder) this.heldClock += dt;
    else this.heldClock = 0;
    const left = Math.hypot(p.x - this.toX, p.z - this.toZ);
    if (this.firstHeldT < 0 && this.heldClock >= ERRAND_TUNE.heldFor) {
      this.firstHeldT = now - this.startedAt;
      this.firstHeldX = p.x;
      this.firstHeldZ = p.z;
      this.firstHeldToGoal = left;
    }
    if (left < this.best - ERRAND_TUNE.stallStep) {
      this.best = left;
      this.stallClock = 0;
    } else this.stallClock += dt;
    if (now - this.lastSampleAt >= ERRAND_TUNE.sampleEvery) {
      this.lastSampleAt = now;
      this.sample(now, world, left);
    }
    if (p.dead) {
      this.finish('died', now);
      return;
    }
    // Arrival is the brain's own, not a number of ours: within `BRAIN_TUNE.home` of the new home
    // both clauses of rule 1 fail together, so it stops running and drops to the wander rule, which
    // is what "arrived and stopped" looks like. The same number twice deliberately -- the walk must
    // end on the step the brain stops carrying it, or the clocks below would run on a body that is
    // no longer under orders at all.
    if (left <= BRAIN_TUNE.home) {
      this.finish('arrived', now);
      return;
    }
    if (this.stallClock >= ERRAND_TUNE.stallSeconds) {
      this.finish('stalled', now);
      return;
    }
    if (now - this.startedAt >= this.budget) this.finish('spent', now);
  }

  /** One row, and the three counts the verdict is made of. */
  private sample(now: number, world: ErrandWorld, left: number): void {
    const p = this.probe;
    const fromPlayer = world.playerKnown ? Math.hypot(p.x - world.playerX, p.z - world.playerZ) : Number.NaN;
    this.samples++;
    if (!world.playerKnown) {
      // Nobody to measure against: counted apart and treated as the worst case, because the streamer
      // follows the player and without one there is nothing to say what was solid.
      this.noPlayer++;
      this.alone++;
    } else if (fromPlayer <= ERRAND_TUNE.objectsWithin) this.near++;
    else if (fromPlayer <= ERRAND_TUNE.terrainWithin) this.terrainOnly++;
    else this.alone++;
    const over = world.waterOver(p.x, p.y, p.z);
    if (over > 0) this.wet++;
    if (over >= ERRAND_TUNE.deepWater) this.deep++;
    if (this.rows >= this.tT.length) return;
    const i = this.rows++;
    this.tT[i] = now - this.startedAt;
    this.tX[i] = p.x;
    this.tZ[i] = p.z;
    this.tGoal[i] = left;
    this.tPlayer[i] = fromPlayer;
    // What it is steering at, as one number: how far off the line to the destination its nose is.
    // A body leaning on a wall points straight at the goal and makes no ground; a body walking a
    // path round something points well off it and does. The two read quite differently here.
    const want = Math.atan2(this.toX - p.x, this.toZ - p.z);
    this.tBear[i] = Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading));
    this.tHeld[i] = p.held;
    this.tHp[i] = p.hp;
    this.tStuck[i] = Math.min(65535, p.stuck);
    this.tState[i] = stateCode(p.state);
  }

  /**
   * End the order. The home is left **where the body is standing**, never put back where it started:
   * put back, the body would be kilometres from home the instant the order lifted, rule 1 would fire
   * on the next thought and it would run the whole way back. That is the one outcome nobody wants,
   * and it is why an order layered over an unmoved home is the wrong shape.
   */
  finish(why: ErrandEnd, now: number): void {
    if (this.done) return;
    this.done = true;
    this.ended = why;
    this.endedAt = now;
    this.now = now;
    if (this.probed) {
      this.body.homeX = this.probe.x;
      this.body.homeZ = this.probe.z;
    }
  }

  /** The track, as rows for `console.table`. Built here and nowhere else, because it allocates. */
  track(): ErrandRow[] {
    const out: ErrandRow[] = [];
    const n2 = (v: number): number => Math.round(v * 100) / 100;
    for (let i = 0; i < this.rows; i++) {
      const fp = this.tPlayer[i];
      out.push({
        t: n2(this.tT[i]),
        x: Math.round(this.tX[i]),
        z: Math.round(this.tZ[i]),
        toGoal: Math.round(this.tGoal[i]),
        fromPlayer: Number.isNaN(fp) ? -1 : Math.round(fp),
        solid: Number.isNaN(fp) ? 'no player' : fp <= ERRAND_TUNE.objectsWithin ? 'all' : fp <= ERRAND_TUNE.terrainWithin ? 'ground only' : 'nothing',
        bearing: Math.round((this.tBear[i] * 180) / Math.PI),
        held: n2(this.tHeld[i]),
        state: ERRAND_STATES[this.tState[i]] ?? '?',
        stuck: this.tStuck[i],
        hp: Math.round(this.tHp[i]),
      });
    }
    return out;
  }

  /** The sentence the owner reads first. It says what the run is evidence *of*, not merely what happened. */
  why(): string {
    const share = this.samples ? Math.round((this.near / this.samples) * 100) : 0;
    const bubble = `${this.near} of ${this.samples} one-second samples were within ${ERRAND_TUNE.objectsWithin} m of you (${share}%)`;
    if (!this.done) return `still walking: ${Math.round(this.toGoal)} m to go; ${bubble}`;
    if (this.ended === 'died') return `it died on the way, ${Math.round(this.toGoal)} m short. Under this order it does not fight back and nothing heals it. ${bubble}`;
    if (this.ended === 'stopped') return `called off by hand ${Math.round(this.toGoal)} m short; its home was left where it stands, so it will not run back. ${bubble}`;
    if (this.ended === 'gone') return 'the body left the world before the walk ended; nothing here is a result.';
    if (this.ended === 'arrived' && this.proved) return `it walked there with the world solid around it the whole way: ${bubble}. This one counts.`;
    if (this.ended === 'arrived') return `it reached the point, but ${bubble} -- outside that the placed objects are not built and past ${ERRAND_TUNE.terrainWithin} m neither is the ground, so it walked through whatever was in the way. Inconclusive: follow it on a speeder and run it again.`;
    const where = this.firstHeldT >= 0 ? ` It first stopped getting through at ${Math.round(this.firstHeldT)} s, ${Math.round(this.travelled)} m in, with ${Math.round(this.firstHeldToGoal)} m still to go.` : '';
    // A stall and a wedge are not the same thing, and the report must never say the second when it
    // has only measured the first. `firstHeld` is the whole of the evidence: it is set when the body
    // spent `heldFor` seconds getting almost none of the ground it asked for, which is what leaning
    // on something looks like. With it, naming the missing side-step is a diagnosis; without it the
    // body was moving freely the whole time and simply stopped getting nearer, and saying "it
    // leaned" would be inventing a cause.
    if (this.ended === 'stalled' && this.firstHeldT >= 0) return `it wedged: it stopped making ground for ${ERRAND_TUNE.stallSeconds} s and the order gave up ${Math.round(this.toGoal)} m short.${where} A fighter has no side-step, so a body that leans keeps leaning. ${bubble}`;
    if (this.ended === 'stalled') return `it stopped making ground for ${ERRAND_TUNE.stallSeconds} s and the order gave up ${Math.round(this.toGoal)} m short -- but it never leaned on anything, so this is not a wedge: it kept moving and stopped getting nearer. Read the track's bearing and places; circling the destination, walking a long way round and being carried backwards all read like this. ${bubble}`;
    return `the clock ran out (${Math.round(this.budget)} s for a ${Math.round(this.straight)} m walk) ${Math.round(this.toGoal)} m short.${where} ${bubble}`;
  }

  /** What `__debug.send()` prints for this walk. */
  report(): Record<string, unknown> {
    const p = this.probe;
    const n2 = (v: number): number => Math.round(v * 100) / 100;
    return {
      body: this.body.label,
      key: this.body.key,
      to: this.place ? `${this.place} (${Math.round(this.toX)}, ${Math.round(this.toZ)})` : `${Math.round(this.toX)}, ${Math.round(this.toZ)}`,
      from: [Math.round(this.fromX), Math.round(this.fromZ)],
      at: [Math.round(p.x), Math.round(p.z)],
      verdict: this.verdict,
      why: this.why(),
      /** Whether the run is evidence at all: the share of its samples taken where everything was solid. */
      proved: this.proved,
      seconds: Math.round(this.seconds),
      budget: Math.round(this.budget),
      straight: Math.round(this.straight),
      travelled: Math.round(this.travelled),
      /** How much farther it walked than the straight line; 1.00 means it walked straight there and nothing was in the way. */
      detour: this.straight > 1 ? n2(this.travelled / this.straight) : null,
      /** Where it is along the route, 0 at the start and 1 at the destination. */
      along: this.straight > 1 ? n2(Math.min(1, Math.max(0, 1 - this.toGoal / this.straight))) : null,
      left: Math.round(this.toGoal),
      nearest: Math.round(this.best),
      /**
       * The three buckets the verdict is made of, and `all` is the one to read carefully: it means
       * the body was within `objectsWithin` of the player, where the streamer builds placed-object
       * collision -- but **not** for everything placed there. It skips anything whose radius is under
       * the streamer's own floor (a metre and a half: every small prop), and everything a building
       * contains, at any distance whatever. So `all` means the buildings, the rocks and the larger
       * crates along the route were solid, and never that nothing could be walked through.
       * `groundOnly`: past them but inside `terrainWithin`, where the terrain still stops it.
       * `nothing`: past both, where it walks through mesas.
       */
      samples: { taken: this.samples, all: this.near, groundOnly: this.terrainOnly, nothing: this.alone, noPlayer: this.noPlayer, rows: this.rows, trackFull: this.samples > this.rows },
      /** Where it first spent two seconds getting almost none of the ground it asked for; null if it never did. */
      firstHeld: this.firstHeldT < 0 ? null : { t: n2(this.firstHeldT), at: [Math.round(this.firstHeldX), Math.round(this.firstHeldZ)], left: Math.round(this.firstHeldToGoal) },
      /**
       * This walk's own, differenced against the body's counters at the order rather than read off
       * it: all three must stay 0 on a healthy outdoor run, and that sentence is only true of a
       * number that is the walk's. `liftedBy` is the size of the last lift and is reported as 0
       * unless this walk caused one, or a lift from an hour ago would be printed beside a clean run.
       */
      stuck: Math.max(0, p.stuck - this.stuckStart),
      lifted: Math.max(0, p.lifted - this.liftedStart),
      liftedBy: p.lifted > this.liftedStart ? n2(p.liftedBy) : 0,
      /** Its own path searches over this walk. Outdoors both stay 0 today: nothing asks for a path out there. */
      paths: { asked: p.plans - this.plansStart, foundNothing: p.failures - this.failuresStart },
      hp: { start: Math.round(this.hpStart), now: Math.round(p.hp), lowest: Math.round(this.hpLow) },
      /**
       * Terrain blocks generated on the main thread while the walk ran: one stutter each, a
       * millisecond or two. It is the **world's** counter differenced, not the walk's own -- there
       * is one counter and the player generates blocks on it too, so somebody following on a speeder
       * is in this number as well as the body being followed. Read it as how stuttery the stretch
       * was, never as what the fighter cost.
       */
      syncGrids: { made: Math.max(0, this.syncNow - this.syncStart), now: this.syncNow },
      /** Samples that stood in water, and in water deep enough for wave 4's bake to call it blocked. */
      water: { wet: this.wet, deep: this.deep },
      state: p.state,
      inside: p.inside,
      /**
       * Which clause of the brain's rule 1 is holding the order at this distance. Past the leash it
       * is the distance from home; inside it -- a short order start to finish, and the last stretch
       * of a long one -- it is the body's own "on the way home" state, which the order asserts every
       * step rather than hoping for.
       */
      carriedBy: this.toGoal > (p.inside ? BRAIN_TUNE.leashInside : BRAIN_TUNE.leash) ? `the leash (${p.inside ? BRAIN_TUNE.leashInside : BRAIN_TUNE.leash} m from home)` : 'the held return state',
      caveats: [
        'under this order the body takes no target and will not fight back: rule 1 outranks the attacker memory and clears it',
        'a fighter has no side-step at all, so a body that wedges leans until the clock ends the order',
        'a fighter has no water sense: it walks the lake bed, so the first long walk belongs on a dry world',
        'small props (under the streamer\'s own metre-and-a-half radius floor) and everything inside a building are never given collision at any distance, so walking through one of those is the game as it stands and not a steering failure',
      ],
      tune: { ...ERRAND_TUNE },
      ours: 'the order is the brain\'s own first rule with the home moved and the return state held; every number of the account but objectsWithin and terrainWithin is invented',
    };
  }

  /**
   * Called once, right after the order is given: the world's counters at that moment, and the
   * track's first row. The row is taken here rather than on the first step because a walk's own
   * starting place is the one row a reader always wants and the first step is a frame later.
   */
  begin(world: ErrandWorld): void {
    this.syncStart = world.syncGrids;
    this.syncNow = world.syncGrids;
    this.lastSampleAt = this.startedAt;
    this.sample(this.startedAt, world, this.straight);
  }
}
