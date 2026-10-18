// The race drive: how a pod, or a speeder bike in racing mode, drives (the design's §5). One per vehicle spawned as a
// pod or a bike, attached by the garage (`attachRace`) and never by `Vehicle`'s constructor, so a vehicle made with
// none drives exactly as it always did; while it holds the hull, `Vehicle.update` runs `step` and nothing of the
// springs.
//
// What it is, in short. The speed is four parts (a curve the throttle climbs, a boost charged at speed that burns the
// engines' heat, a slope's push, and whatever the curve can no longer hold, easing down at the brake), held under the
// owner's ceiling. The travel lags the nose by a time constant, so a pod drifts wide at speed and grips as it slows;
// the turn eases toward what the stick asks, never past the maximum turn rate; the hull banks with the turn and leans
// on Z and V. Its height is set rather than sprung: its posed lowest point is held at its ride over a line read off
// the ground under the hull (bridged over pits narrower than half a second of travel) and raised halfway toward the
// ground half a second ahead, rising at once and settling within a band; and held there loosely (`RACE_TUNE.hold`
// 'loose'): never pulled down harder than the cushion's grip, and over its band falling at the world's own gravity, so
// a crest is a jump and a dip is carried over, where the first ride's firm rule ('firm') fell hard. The body moves
// only on the physics' whole sixtieths of a second, so every frame the drive asks how many of them the coming step
// will take (`Physics.stepsAhead`) and plans exactly that travel, in sub-steps, with every sweep (the strikes, the
// bridge's odometer, the climbing judge) running from a mark of its own; a frame on which the physics takes no step
// plans nothing.
//
// Walls are scored by two measures (scrape or crash), steep terrain faces and rises too tall to clear in time are
// scored the same way, and the hull wears to a floor that only a crash crosses. Everything the drive does to the speed
// is in its own command, so its own cuts are never read as a hit; and while play stands still (`RACE_CLOCK.live`
// false) it holds the hull where it is and comes back at the speed it had.
//
// `step` reads only its `DriveInput`: never the keyboard, the camera or the player, so whatever writes a drive (the
// player, a later AI pilot) drives it the same way. Nothing is allocated in a step: every vector, ring and sample row
// is made once with the drive. Node loads it (`tools/swg/tests/raceDrive.test.ts`).
import * as THREE from 'three';
import { FIXED_DT, Group, groups, RAPIER, type Physics } from '../core/physics.ts';
import {
  BAND,
  FALL,
  HIT_CRASH,
  HIT_NONE,
  HIT_SCRAPE,
  LatticeRing,
  bankTarget,
  boostOf,
  bridgeClose,
  bridgedBetweenOf,
  climbVerdictOf,
  ease,
  faceVerdict,
  hitVerdict,
  hitVerdictOf,
  lagBlendOf,
  len3,
  levelsAt,
  lineFromOf,
  lineRateOfQ,
  lowestOffsetOf,
  newBase,
  newClimbPass,
  newLineQuery,
  newLagStep,
  newLineWalk,
  newSweptPath,
  newLooseStep,
  newYawStep,
  resolveRace,
  shareSpeed,
  slopePush,
  speedOf,
  stepLooseOf,
  stepVerticalOf,
  stepYawRateOf,
  strikeKick,
  thrustA,
  thrustCapOf,
  thrustFor,
  underAheadOfQ,
  walkLineOf,
  wrap,
  yawWanted,
  type ClimbJudged,
  type ClimbPass,
  type LineReader,
  type RaceBase,
  type RaceLevels,
  type SpeedParts,
} from './raceMath.ts';
import { RACE_GEN, RACE_TUNE, RACE_UPGRADES, baseFor } from './raceTune.ts';
import { ENGINE_TUNE, damageAny, damagePart, hitSide, newEngineSet, overheat, sideBand, stepEngines, type EngineSet } from './drivetrain.ts';
import { BODY_SPEED_CAP, type DriveInput, type Vehicle } from './vehicle.ts';
import { LAVA_HARM } from '../world/lavaHarmMath.ts';

/**
 * Whether play is running: `stepVehicles` writes it every step from its own `simulate` (which `__debug.advance` passes
 * as true). While it is false every race-driven hull is paused where it stands, since the frame loop steps the
 * vehicles and the physics behind every panel.
 */
export const RACE_CLOCK = { live: true };

/** What a race-driven hull reads of the ground ahead: built blocks and the far grid's lattice (`LineReader`), and the flat water. */
export interface RaceGround extends LineReader {
  water(x: number, z: number): number;
}

/** What the garage hands a drive when it attaches it: the world's cached ground, or nothing (a test, a world with none). */
export interface RaceDeps {
  ground: RaceGround | null;
}

export type RaceMode = 'traversal' | 'racing';

const D2R = Math.PI / 180;
/** A floor the far ray and the middle ray may find: only what stands still (a ray from inside the hull would find the hull). */
const stillOnly = (c: RAPIER.Collider): boolean => {
  const b = c.parent();
  return !b || b.isFixed();
};
const FLOOR_ALL = groups(Group.all, Group.all);

/** Scratch for the step: nothing is made per frame. */
const euler = new THREE.Euler();
const quat = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
/** Nought, handed to the engine's setters. Never written. */
const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });

/** One sub-step's place along the travel, and the plan's start. */
interface Place {
  x: number;
  z: number;
}

export class RaceDrive {
  /** The drive, by the kind the vehicle was spawned as. */
  readonly kind: 'pod' | 'bike';
  /** A bike's two modes (traversal is the springs', racing the drive's); a pod has none. */
  readonly modes: boolean;
  mode: RaceMode;
  /** Whether the drive holds the hull now (from `adopt` to `release`). */
  active = false;
  /** The handling now, resolved from the base of its kind, the ceiling and the upgrades (`resolve`). */
  readonly handling: RaceBase = newBase();
  private readonly baseNow: RaceBase = newBase();
  private gen = -1;
  /** Upgrade levels (kept with the character in the vehicle's fit, `shipFit.ts`'s `race_*` keys), and the condition (reserved: 1). */
  readonly levels: RaceLevels = levelsAt(0);
  condition = 1.5;
  /**
   * The engines (`drivetrain.ts`): two of three parts raced as a pod, one raced as a bike. Their damage takes a share
   * off the plain top (`topNow`, laid on the resolved `V`, which is kept whole as `vFull`), pulls the stick and can
   * refuse the boost.
   */
  readonly engines: EngineSet;
  /** The random numbers a scrape, a strike or an overheat draws (which part): replaceable for tests. */
  rng: () => number = Math.random;
  private vFull = 0.5;
  private topNow = 1.5;
  /** The velocity a hit just lost, across (written before `score`, for the side it struck). */
  private lossX = 0.5;
  private lossZ = 0.5;
  /** The spec's two tops as they were before the drive wrote the race tops into them, put back on hand-over. */
  private keptMax = 0.5;
  private keptBoost = 0.5;
  private specKept = false;

  // --- the speed's parts --------------------------------------------------------------------------------------------
  /** The thrust on the curve, the boost's charge, the charge-up, whether boosting, the engines' coolness (100 cold). */
  T = 0.5;
  B = 0.5;
  charge = 0.5;
  boosting = false;
  heat = 100.5;
  /** Overheated: the boost refused until the heat is back to `readyAt`. */
  locked = false;
  /** The slope's push and the speed the curve cannot hold. */
  p = 0.5;
  over = 0.5;
  /** The horizontal speed now (signed: below nought reversing). */
  h = 0.5;
  private readonly parts: SpeedParts = { T: 0, B: 0, p: 0, over: 0 };

  // --- direction, turn, pose ----------------------------------------------------------------------------------------
  /** The travel's direction (a horizontal unit vector), the lag's eased multiplier, the yaw rate (deg/s), the heading (rad). */
  readonly u = { x: 0, z: 1 };
  slideMul = 1.5;
  w = 0.5;
  heading = 0.5;
  private lastSign = 0;
  /** The stick this step, for the console. */
  stick = 0.5;
  /** Bank and the ground's roll (degrees, the right side down positive), the lean (-1 left to 1 right), the nose (degrees, up positive). */
  bank = 0.5;
  groundRoll = 0.5;
  lean = 0.5;
  pitch = 0.5;
  /** The vertical speed the height rule carries, and the one the body was last told. */
  vy = 0.5;
  private cmdVy = 0.5;

  // --- the command and the walls ------------------------------------------------------------------------------------
  private readonly cmd = new THREE.Vector3();
  private cmdValid = false;
  /** A scrape's timers: the throttle cut, the lag's kick, and the command held off the wall along `holdNormal`. */
  cut = 0.5;
  kick = 0.5;
  hold = 0.5;
  private readonly holdNormal = new THREE.Vector3();
  /** The last hit, for the console. */
  readonly lastHit = { kind: '' as '' | 'scrape' | 'crash' | 'face' | 'climb' | 'strike', loss: 0, drop: 0, at: 0 };
  /** Words for the message line, taken once by the game (`takeNote`). */
  private note = '';
  /** Every time the strike sweep met the ground and lifted the hull out of it, slight or hard, ever: the ground's own push, which a measure of the hold sets apart. */
  lifts = 0;
  /** Steps taken, for the console's clock of when things happened. */
  private steps = 0;

  // --- pause --------------------------------------------------------------------------------------------------------
  private paused = false;
  private readonly keptPos = new THREE.Vector3();
  private readonly keptQuat = new THREE.Quaternion();

  // --- the plan on the physics' clock -------------------------------------------------------------------------------
  /** The fixed steps the last plan covered (0: none this frame), its travel, whether the hull was over its band or airborne. */
  planned = 0;
  planTravel = 0.5;
  overLine = 0.5;
  airborne = false;
  onBand = true;
  /** The distance travelled along the path (the odometer) and where the last plan started. */
  odo = 0.5;
  private readonly planFrom: Place = { x: 0, z: 0 };
  private planFromValid = false;
  /** Each sweep's own mark on the odometer: the strike sweep's and the climbing judge's. */
  sweptTo = 0.5;
  judgedTo = 0.5;

  // --- the look-ahead -----------------------------------------------------------------------------------------------
  private readonly ring: LatticeRing;
  private readonly walk = newLineWalk(64);
  /** The look-ahead's reach this plan, whether the far ray was taken, and the line's rate. */
  reach = 0.5;
  rayTaken = false;
  lineRate = 0.5;
  line = 0.5;
  /**
   * The rate the height rule is fed: the line's own under the firm hold; under the loose the rate the ground under the
   * hull has risen at over the last tenth of a second, taken up no faster than `looseFeed` (`planRate`), which is where
   * the upward speed it keeps comes from (`keep`).
   */
  rateFed = 0.5;
  /** The loose hold's rate for its rise and its settle (`looseRate`): the ground's own rise ahead while it rises, else the line's fall as it falls now. */
  looseLine = 0.5;
  /** The ground under the footprint a tenth of a second on less the ground under it now, over that time (m/s, bridged): how far the cushion may run ahead of its line. */
  underRate = 0.5;
  /** The ground under the hull at the plan's start, raw (unbridged): what its kept upward speed is fed from. */
  private rawNow = 0.5;
  /** The upward speed the ground has given the hull and gravity alone may take back (`stepLooseOf`'s `keep`). */
  keep = 0.5;
  /** The line at the last sub-step, whether it may be read against (a sub-step of the same run of plans), and the rate a run's first sub-step takes. */
  private lastLine = 0.5;
  private lastLineOk = false;
  private firstRate = 0.5;
  /** The loose hold's look behind: the line under the hull at each plan's start and the plan's clock then, in a ring (`pastRate`). */
  private readonly pastT = new Float64Array(16);
  private readonly pastL = new Float64Array(16);
  private pastN = 0;
  private pastHead = 0;
  private pastClock = 0.5;
  private pastLine = 0.5;
  private pastFed = 0.5;

  // --- the bridge ---------------------------------------------------------------------------------------------------
  private readonly bridgeRing: number;
  private readonly ringVal: Float64Array;
  private readonly ringKey: Int32Array;
  private readonly ahead = new Float64Array(256);
  private aheadFrom = 0;
  private aheadCount = 0;
  private readonly rowS = new Float64Array(1024);
  private readonly rowDil = new Float64Array(1024);
  private readonly rowDeque = new Int32Array(1024);
  /** The ground under the hull on the plan's last sub-step (bridged), and the hull's lowest point at the plan's end. */
  under = 0.5;
  low = 0.5;
  /** How much the bridge lifted the ground under the hull on the last sub-step, and its span. */
  bridgeLift = 0.5;
  span = 0.5;

  // --- the slope and the strikes ------------------------------------------------------------------------------------
  slopeTheta = 0.5;
  private readonly path = newSweptPath(16);
  /** Where the strike sweep met the ground deepest in its last sub-step, and how deep. */
  private metX = 0.5;
  private metZ = 0.5;
  private metDepth = 0.5;
  private readonly judged: ClimbJudged = { to: 0, allowed: Infinity, points: 0 };

  /** The ground readers of the step now running, kept only for its length (cleared after). */
  private stepGround: ((x: number, z: number) => number) | null = null;
  private stepWater: ((x: number, z: number) => number) | null = null;
  private stepLava: ((x: number, z: number) => boolean) | null = null;
  private stepPhysics: Physics | null = null;
  private stepVehicle: Vehicle | null = null;
  private readonly deps: RaceDeps;

  constructor(kind: 'pod' | 'bike', deps: RaceDeps) {
    this.kind = kind;
    this.modes = kind === 'bike';
    this.mode = kind === 'bike' ? 'traversal' : 'racing';
    this.deps = deps;
    this.ring = new LatticeRing(RACE_TUNE.latticeRing);
    this.bridgeRing = Math.max(16, Math.round(RACE_TUNE.bridgeRing));
    this.ringVal = new Float64Array(this.bridgeRing);
    this.ringKey = new Int32Array(this.bridgeRing).fill(-0x7fffffff);
    // Every number field above starts as a fraction, so its field holds a number of its own from the first and a step
    // writes it in place; a field first written a whole number and later a fraction is one the engine may keep making
    // numbers for. Their real starting values:
    this.T = 0;
    this.B = 0;
    this.charge = 0;
    this.heat = 100;
    this.p = 0;
    this.over = 0;
    this.h = 0;
    this.slideMul = 1;
    this.w = 0;
    this.heading = 0;
    this.stick = 0;
    this.bank = 0;
    this.groundRoll = 0;
    this.lean = 0;
    this.pitch = 0;
    this.vy = 0;
    this.cmdVy = 0;
    this.cut = 0;
    this.kick = 0;
    this.hold = 0;
    this.planTravel = 0;
    this.overLine = 0;
    this.odo = 0;
    this.sweptTo = 0;
    this.judgedTo = 0;
    this.reach = 0;
    this.lineRate = 0;
    this.line = 0;
    this.rateFed = 0;
    this.looseLine = 0;
    this.underRate = 0;
    this.rawNow = 0;
    this.keep = 0;
    this.lastLine = 0;
    this.firstRate = 0;
    this.pastClock = 0;
    this.pastLine = 0;
    this.pastFed = 0;
    this.bridgeLift = 0;
    this.span = 0;
    this.slopeTheta = 0;
    this.keptMax = 0;
    this.keptBoost = 0;
    this.metX = 0;
    this.metZ = 0;
    this.metDepth = 0;
    this.condition = 1;
    this.engines = newEngineSet(kind);
    this.vFull = 0;
    this.topNow = 1;
    this.lossX = 0;
    this.lossZ = 0;
  }

  /**
   * Whether the drive should hold the hull this step: the switch on and the drive rule 'racer'; the hull not a ship,
   * not adrift, held or ghosted, not destroyed; and a pod, or a bike in racing mode.
   */
  wants(v: Vehicle): boolean {
    if (!RACE_TUNE.on || RACE_TUNE.drive !== 'racer') return false;
    if (v.spec.ship || v.drift || v.held || v.holding || v.ghosted || v.destroyed || v.disposed) return false;
    return this.kind === 'pod' || this.mode === 'racing';
  }

  /** The handling made again from the base, the ceiling and the levels; a speed the new handling can no longer hold is shared out again. */
  private resolve(v: Vehicle | null): void {
    baseFor(this.kind, this.baseNow);
    resolveRace(this.baseNow, this.levels, this.condition, RACE_UPGRADES, this.handling);
    // The engines' share of the top laid on the resolved one, kept whole beside it for the next change of share.
    this.vFull = this.handling.V;
    this.handling.V = this.vFull * this.topNow;
    this.gen = RACE_GEN.n;
    if (this.active) {
      this.share(this.h);
      if (v) this.writeSpec(v);
    }
  }

  /** The reachable plain top and the top with a full boost, as the spec carries them (whole values). */
  plainTop(): number {
    return Math.min(this.handling.cap, RACE_TUNE.thrustCap * this.handling.V);
  }

  boostTop(): number {
    return Math.min(this.handling.cap, RACE_TUNE.thrustCap * this.handling.V + this.handling.BT);
  }

  /** What a hull over its band falls at under the hold in force (m/s²): the world's gravity loose, the firm rule's own fall. */
  fallNow(): number {
    return RACE_TUNE.hold === 'firm' ? this.handling.fall : RACE_TUNE.looseFall;
  }

  private writeSpec(v: Vehicle): void {
    if (!this.specKept) {
      this.keptMax = v.spec.maxSpeed;
      this.keptBoost = v.spec.boostSpeed;
      this.specKept = true;
    }
    v.spec.maxSpeed = this.plainTop();
    v.spec.boostSpeed = this.boostTop();
  }

  /** The spec's boost top as it was before the drive (traversal's own top: 21 m/s on a bike today). */
  traversalTop(v: Vehicle): number {
    return this.specKept ? this.keptBoost : v.spec.boostSpeed;
  }

  /** A horizontal speed shared out among the parts (`shareSpeed`), so the curve carries on from where the hull is. */
  private share(v: number): void {
    const h = this.handling;
    shareSpeed(v, this.p, this.B, h, RACE_TUNE.thrustCap, RACE_TUNE.boostHalf, this.parts);
    this.T = this.parts.T;
    this.B = this.parts.B;
    this.p = this.parts.p;
    this.over = this.parts.over;
    this.h = v;
  }

  /**
   * Take the hull from the springs: its horizontal speed shared out into the parts, its travel from its horizontal
   * velocity, its vertical speed and yaw rate from the body's; gravity and damping to nought (the drive moves it); the
   * race box in for the hull's own; the command not trusted for one step; the bridge and the marks begun afresh.
   */
  adopt(v: Vehicle): void {
    const body = v.body;
    if (!body.isValid()) return;
    // Read off the body before the drive holds it (the vehicle's heading is the drive's own from then on).
    this.heading = v.heading;
    this.active = true;
    this.paused = false;
    if (this.gen !== RACE_GEN.n || !this.specKept) this.resolve(v);
    this.writeSpec(v);
    const lv = body.linvel();
    const av = body.angvel();
    const nx = Math.sin(this.heading);
    const nz = Math.cos(this.heading);
    const hs = Math.hypot(lv.x, lv.z);
    let h = 0;
    if (hs > 0.5) {
      const forward = lv.x * nx + lv.z * nz >= 0;
      this.u.x = forward ? lv.x / hs : nx;
      this.u.z = forward ? lv.z / hs : nz;
      h = forward ? hs : -Math.min(hs, this.handling.reverseTop);
    } else {
      this.u.x = nx;
      this.u.z = nz;
    }
    this.boosting = false;
    this.charge = 0;
    this.share(h);
    this.vy = lv.y;
    this.cmdVy = lv.y;
    this.w = av.y / D2R;
    this.lastSign = 0;
    v.quaternion(quat);
    euler.setFromQuaternion(quat, 'YXZ');
    this.pitch = -euler.x / D2R;
    this.groundRoll = euler.z / D2R;
    this.bank = 0;
    this.lean = 0;
    this.slideMul = 1;
    body.setGravityScale(0, true);
    body.setLinearDamping(0);
    v.setRaceHull(true);
    this.cmdValid = false;
    this.hold = 0;
    this.restartMarks(v);
  }

  /** Back to the springs: the spec as it was, gravity, damping and the hull's own colliders back (`Vehicle.handBack`). */
  release(v: Vehicle): void {
    if (!this.active) return;
    this.active = false;
    this.paused = false;
    this.cmdValid = false;
    if (this.specKept) {
      v.spec.maxSpeed = this.keptMax;
      v.spec.boostSpeed = this.keptBoost;
      this.specKept = false;
    }
    this.boosting = false;
    v.boosting = false;
    v.handBack();
  }

  /** The bridge's ring, the odometer and every sweep's mark begun afresh (just adopted, put somewhere else). */
  private restartMarks(v: Vehicle): void {
    this.odo = 0;
    this.ringKey.fill(-0x7fffffff);
    this.aheadCount = 0;
    this.ring.clear();
    this.sweptTo = 0;
    this.judgedTo = this.lengthOf(v) / 2 + this.handling.climbLen;
    this.planFromValid = false;
    this.pastN = 0;
    this.rateFed = 0;
    this.keep = 0;
    this.lastLineOk = false;
  }

  /** A bike's mode, as U switches it: up at any speed, down only under its traversal top. '' when done, else the words of the refusal. */
  setMode(v: Vehicle, mode: RaceMode): string {
    if (!this.modes) return 'a pod has no modes';
    if (mode === this.mode) return '';
    if (mode === 'traversal') {
      const l = v.body.linvel();
      const speed = this.active ? Math.abs(this.h) : Math.hypot(l.x, l.z);
      if (speed > this.traversalTop(v)) return 'slow down to leave racing mode';
      this.mode = 'traversal';
      this.release(v);
      return '';
    }
    this.mode = 'racing';
    return '';
  }

  /** Upgrade levels set (in memory this wave): `'max'`, `'stock'` or some of the seven; resolved at once. */
  setLevels(levels: Partial<RaceLevels> | 'max' | 'stock', v: Vehicle | null = null): void {
    const all = levels === 'max' ? levelsAt(5) : levels === 'stock' ? levelsAt(0) : levels;
    for (const [k, n] of Object.entries(all)) if (Object.hasOwn(this.levels, k) && typeof n === 'number' && Number.isFinite(n)) this.levels[k as keyof RaceLevels] = Math.max(0, Math.min(5, Math.round(n)));
    this.resolve(v);
  }

  /** The condition the upgrades are multiplied by (reserved: 1 this pass), 0 to 1. */
  setCondition(c: number, v: Vehicle | null = null): void {
    this.condition = Math.max(0, Math.min(1, Number.isFinite(c) ? c : 1));
    this.resolve(v);
  }

  /** A rope's pull told to the hit test: what it put on the body is added to the command, so the next step reads no loss from it. */
  told(dx: number, dy: number, dz: number): void {
    if (!this.cmdValid) return;
    this.cmd.x += dx;
    this.cmd.y += dy;
    this.cmd.z += dz;
  }

  /**
   * The engines overheated now, exactly as a run dry does it (the console's `engines({ heat: 0 })`): no coolness left,
   * the boost ended and refused until `readyAt`, one part set on fire. The part's index, or -1 when none could catch.
   */
  overheatNow(): number {
    this.heat = 0;
    this.boosting = false;
    this.locked = true;
    this.charge = 0;
    this.note = 'engines overheated';
    return overheat(this.engines, this.rng);
  }

  /** The words the drive has for the message line since it was last asked, once. */
  takeNote(): string {
    const n = this.note;
    this.note = '';
    return n;
  }

  private lengthOf(v: Vehicle): number {
    const b = v.spec.bounds;
    return Math.abs(b.max[2] - b.min[2]);
  }

  private widthOf(v: Vehicle): number {
    const box = v.spec.raceBox;
    if (box) return box[0];
    const b = v.spec.bounds;
    return Math.abs(b.max[0] - b.min[0]);
  }

  /** The thresholds the scrape and crash verdict reads, the kind's own. */
  private verdictNumbers(): { hitLoss: number; crashImpact: number; crashDrop: number; crashFrom: number } {
    const h = this.handling;
    const k = this.verdictK;
    k.hitLoss = RACE_TUNE.hitLoss;
    k.crashImpact = h.crashImpact;
    k.crashDrop = h.crashDrop;
    k.crashFrom = h.crashFrom;
    return k;
  }
  private readonly verdictK = { hitLoss: 0, crashImpact: 0, crashDrop: 0, crashFrom: 0 };

  /**
   * One step (the design's §5): the pause, the hit test on what the last command left, the speed's parts, the turn,
   * the travel's lag, the pose, the height planned over the coming fixed steps with its strikes, faces and the rise
   * too tall to clear, and one command for the body. `ground` is the vehicle's own reader (the terrain under the hull,
   * or a room's floor), `water` the flat water.
   */
  step(v: Vehicle, dt: number, drive: DriveInput | null, ground: ((x: number, z: number) => number) | null, water: ((x: number, z: number) => number) | null, lava: ((x: number, z: number) => boolean) | null, physics: Physics): void {
    const body = v.body;
    if (!body.isValid()) return;
    if (!this.active) this.adopt(v);
    if (this.gen !== RACE_GEN.n) this.resolve(v);
    // Something else may have had the hull since the last step (a hold that let go): the drive's own setup again.
    if (body.gravityScale() !== 0) body.setGravityScale(0, true);
    if (body.linearDamping() !== 0) body.setLinearDamping(0);
    this.steps++;
    if (!RACE_CLOCK.live) {
      this.pause(v);
      return;
    }
    if (this.paused) {
      // Back from a pause: the step commands the kept velocity again, and this one is not measured.
      this.paused = false;
      this.cmdValid = false;
    }
    this.stepGround = ground;
    this.stepWater = water;
    this.stepLava = lava;
    this.stepPhysics = physics;
    this.stepVehicle = v;
    try {
      this.run(v, dt, drive, physics);
    } finally {
      this.stepGround = null;
      this.stepWater = null;
      this.stepLava = null;
      this.stepPhysics = null;
      this.stepVehicle = null;
    }
  }

  /** Held where it is while play stands still: its kept pose and no velocity written each step, every number kept. */
  private pause(v: Vehicle): void {
    const body = v.body;
    if (!this.paused) {
      const t = body.translation();
      this.keptPos.set(t.x, t.y, t.z);
      v.quaternion(this.keptQuat);
      this.paused = true;
    }
    body.setTranslation(this.keptPos, true);
    body.setRotation(this.keptQuat, true);
    body.setLinvel(ZERO, true);
    body.setAngvel(ZERO, true);
    this.cmdValid = false;
    v.pos.copy(this.keptPos);
    v.group.position.copy(this.keptPos);
    v.group.quaternion.copy(this.keptQuat);
    v.speed = this.h;
    v.justHit = 0;
  }

  // --- the step's own numbers -----------------------------------------------------------------------------------------
  // Every number the step's parts hand one another goes through these fields and never as an argument or a return: a
  // number handed to a call the compiler did not build into its caller is a number made, and a step makes nothing. Each
  // starts as a fraction, so its field holds a number of its own from the first and is written in place ever after.
  /** The step's seconds, the nose's direction, the throttle, the nose trim, the pose's two angles and its roll. */
  private sDt = 0.5;
  private sNx = 0.5;
  private sNz = 0.5;
  private sTh = 0.5;
  private sTrim = 0.5;
  private sEx = 0.5;
  private sEz = 0.5;
  private sRoll = 0.5;
  private sOverWater = false;
  /** The liquid's surface over the hull's column the last step (-Infinity where there is none). */
  private sWetTop = 0.5;
  private sBraking = false;
  /** The velocity the last step left, read once. */
  private readonly lvNow = { x: 0.5, y: 0.5, z: 0.5 };
  /** The ground a point is asked of (`footAt`, `aheadAt`) and what it answers; the footprint's answer. */
  private qx = 0.5;
  private qz = 0.5;
  private qg = 0.5;
  private qa = 0.5;
  private fx = 0.5;
  private fz = 0.5;
  private fp = 0.5;
  /** The middle ray's question and answer. */
  private mx = 0.5;
  private mz = 0.5;
  private mFrom = 0.5;
  private mReach = 0.5;
  private mOut = 0.5;
  /** The bridge's question (`bridgedAt`: the odometer's place) and answer. */
  private bS = 0.5;
  private bOut = 0.5;
  private readonly bQ = { at: 0.5, out: 0.5 };
  /** The plan as it stands: its steps, seconds, speed, travel, length, half width, lowest point at its start, direction. */
  private pN = 0;
  private pT = 0.5;
  private pSpeed = 0.5;
  private pTravel = 0.5;
  private pL = 0.5;
  private pHalfW = 0.5;
  private pLow0 = 0.5;
  private pForward = false;
  private pUx = 0.5;
  private pUz = 0.5;
  private pSpan = 0.5;
  private pBridge = false;
  private pMiddleFrom = 0.5;
  private pRayReach = 0.5;
  private pM = 0;
  private pDs = 0.5;
  private pDts = 0.5;
  private pSign = 0.5;
  private pLip = 0.5;
  private pStopAt = 0.5;
  private pPhase = 0;
  /** The loose hold this plan (`RACE_TUNE.hold`), or the firm. */
  private pLoose = true;
  /** The sweep's sub-step: where it starts and ends on the odometer, the hull's lowest point at each, and whether it is the plan's last. */
  private wS0 = 0.5;
  private wS1 = 0.5;
  private wLowA = 0.5;
  private wLowB = 0.5;
  private wLast = false;
  private readonly lineQ = newLineQuery();
  private readonly vStep = newLooseStep();
  private readonly climb = newClimbPass();
  private readonly pose = { ex: 0.5, ez: 0.5, low: 0.5 };
  private readonly hitC = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly hitA = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly yawStep = newYawStep();
  private readonly lagStepQ = newLagStep();

  private run(v: Vehicle, dt: number, drive: DriveInput | null, physics: Physics): void {
    this.sDt = dt;
    this.pN = physics.stepsAhead(dt);
    const body = v.body;
    const t = body.translation();
    v.pos.set(t.x, t.y, t.z);
    const lv = body.linvel();
    this.lvNow.x = lv.x;
    this.lvNow.y = lv.y;
    this.lvNow.z = lv.z;
    // The parts in order, through the list, until one says the hull was wrecked. Each part is called through the one
    // list rather than by name, so the compiler builds each on its own with its own budget: built into this method
    // they spent its budget between them, and the small arithmetic each calls was left as calls that make numbers.
    const parts = RaceDrive.PARTS;
    for (let i = 0; i < parts.length; i++) if (parts[i](this, v, drive)) return;
  }

  /**
   * The step's parts: the odometer; the hit test (wrecked: stop); the speed's thrust, boost and push; the turn; the
   * travel's lag; the pose on the ground and its bank and lean, and the turn the body is written with; the height
   * planned over the coming fixed steps (wrecked: stop); one command.
   */
  private static readonly PARTS: readonly ((d: RaceDrive, v: Vehicle, drive: DriveInput | null) => boolean)[] = [
    (d, v) => {
      d.odometer(v);
      return false;
    },
    (d, v) => d.hitTest(v),
    (d, v, drive) => {
      d.engineStep(v, drive);
      return false;
    },
    (d, _v, drive) => {
      d.thrustStep(drive);
      return false;
    },
    (d, _v, drive) => {
      d.boostStep(drive);
      return false;
    },
    (d, v) => {
      d.pushStep(v);
      return false;
    },
    (d, _v, drive) => {
      d.turnStep(drive);
      return false;
    },
    (d, v, drive) => {
      d.lagStep(v, drive);
      return false;
    },
    (d, v) => {
      d.poseGround(v);
      return false;
    },
    (d, _v, drive) => {
      d.poseBank(drive);
      return false;
    },
    (d) => {
      d.poseTurn();
      return false;
    },
    (d, v) => d.planPart(v),
    (d, v) => {
      d.command(v);
      return false;
    },
  ];

  /** The height, planned over the travel the coming fixed steps make (`pN`), and the plan's start kept. True when the hull was wrecked. */
  private planPart(v: Vehicle): boolean {
    this.planned = this.pN;
    if (this.pN > 0 && this.plan(v)) return true;
    this.planFrom.x = v.pos.x;
    this.planFrom.z = v.pos.z;
    this.planFromValid = true;
    return false;
  }

  /** The odometer, from where the body really went since the last plan began: a body put somewhere else (a teleport, a respawn) starts the bridge and the marks afresh. */
  private odometer(v: Vehicle): void {
    if (!this.planFromValid) return;
    const dx = v.pos.x - this.planFrom.x;
    const dz = v.pos.z - this.planFrom.z;
    const moved = Math.sqrt(dx * dx + dz * dz);
    if (moved > this.planTravel * 3 + 10) this.restartMarks(v);
    else if (moved > 0) {
      this.odo += moved;
      this.freezeBridge();
    }
  }

  /** The hit test: what the last command lost to a contact; a scrape's hold keeps it from reading the same wall again. True when the hull was wrecked. */
  private hitTest(v: Vehicle): boolean {
    const dt = this.sDt;
    if (this.cmdValid && this.hold <= 0) {
      const lv = this.lvNow;
      const verdict = hitVerdictOf(this.cmd, lv, this.verdictNumbers());
      if (verdict !== HIT_NONE) {
        tmpV.set(this.cmd.x - lv.x, this.cmd.y - lv.y, this.cmd.z - lv.z);
        const impact = tmpV.length();
        const drop = this.cmd.length() - len3(lv.x, lv.y, lv.z);
        this.lossX = tmpV.x;
        this.lossZ = tmpV.z;
        if (this.score(v, verdict, impact, drop, 'contact')) return true;
        // A scrape: the velocity taken from what the step left, the command held off the wall for a moment.
        this.holdNormal.copy(tmpV).normalize();
        this.hold = RACE_TUNE.scrapeHold;
        const hs = Math.sqrt(lv.x * lv.x + lv.z * lv.z);
        const nx = Math.sin(this.heading);
        const nz = Math.cos(this.heading);
        if (hs > 0.5 && lv.x * nx + lv.z * nz > 0) {
          this.u.x = lv.x / hs;
          this.u.z = lv.z / hs;
          this.share(hs);
        } else this.share(0);
        this.vy = lv.y;
      }
    }
    this.cmdValid = false;
    this.cut = Math.max(0, this.cut - dt);
    this.kick = Math.max(0, this.kick - dt);
    this.hold = Math.max(0, this.hold - dt);
    return false;
  }

  /**
   * The engines' step (`drivetrain.ts`): the repair key, the fires, the pull, the top's share and whether the boost may
   * run. A share that moved (a part out, an engine out, a repair begun or ended) lowers or raises the top the curve
   * runs to, and the speed the hull has is shared out again under it, so what the lowered top cannot hold eases down
   * at the brake as `over` and nothing in the command jumps (a jump would be read as a hit).
   */
  private engineStep(v: Vehicle, drive: DriveInput | null): void {
    const e = this.engines;
    e.dt = this.sDt;
    e.wantRepair = !!drive && drive.repair === true;
    e.rate = this.handling.repairRate;
    stepEngines(e, ENGINE_TUNE);
    if (e.top !== this.topNow) {
      this.topNow = e.top;
      this.handling.V = this.vFull * e.top;
      this.share(this.h);
      this.writeSpec(v);
    }
  }

  /**
   * The speed's parts: the thrust on the curve, the boost and the engines' heat, what the curve cannot hold, the
   * slope's push; the speed held under the ceiling. In three parts, each small enough that the compiler builds its
   * every call into it.
   */
  private speedStep(v: Vehicle, drive: DriveInput | null): void {
    this.thrustStep(drive);
    this.boostStep(drive);
    this.pushStep(v);
  }

  /** The thrust on the curve: climbing with the throttle, coasting off it, the air brake, reversing at a crawl. */
  private thrustStep(drive: DriveInput | null): void {
    const h = this.handling;
    const tune = RACE_TUNE;
    const dt = this.sDt;
    const A = thrustA(h.t75);
    const tCap = thrustCapOf(A, tune.thrustCap);
    const th = drive ? drive.throttle : 0;
    const trim = drive && tune.pitchFrom === 'view' && typeof drive.pitch === 'number' ? Math.max(-1, Math.min(1, drive.pitch)) : 0;
    this.sTh = th;
    this.sTrim = trim;
    let braking = false;
    if (!drive) {
      // Nobody drives it: it brakes, so nothing coasts kilometres with nobody on it.
      this.T *= Math.exp(-dt / Math.max(1e-3, tune.idleBrake));
    } else if (this.cut > 0 || th === 0) {
      this.T *= Math.exp(-dt / Math.max(1e-3, h.coast));
    } else if (th > 0) {
      const rate = (this.boosting ? tune.boostRate : 1) * (trim ? 1 + (tune.trimThrottle - 1) * -trim : 1);
      this.T = Math.min(tCap, this.T + th * rate * dt);
    } else if (this.h > tune.reverseBelow) {
      braking = true;
      this.T *= Math.exp(-dt / Math.max(1e-3, h.brake));
    } else {
      // The most reverse thrust, worked out only here where it is used: worked out every step it was a number made a
      // step once the curve's inverse had been asked for forward speeds as well (a speed shared out at a lowered top).
      this.T = Math.max(thrustFor(-h.reverseTop, h.V, A), this.T + th * dt);
    }
    if (this.T > tCap) this.T = tCap;
    this.sBraking = braking;
  }

  /** The boost: charged at speed with Shift and W, engaged once full, ended by letting go, the brake, a scrape or the heat; and what the curve cannot hold, easing down. */
  private boostStep(drive: DriveInput | null): void {
    const h = this.handling;
    const tune = RACE_TUNE;
    const dt = this.sDt;
    const th = this.sTh;
    const now = Math.abs(this.h);
    // A part out or burning, or a repair under way, refuses it (`boostOk`).
    const wantBoost = !!drive && drive.boost && th > 0 && this.cut <= 0 && !this.locked && !this.sBraking && this.engines.boostOk;
    if (this.boosting && !wantBoost) {
      this.boosting = false;
      this.charge = 0;
    }
    if (!this.boosting) {
      if (wantBoost && now >= tune.boostGate * h.V) {
        this.charge = Math.min(1, this.charge + dt / Math.max(1e-3, h.chargeTime));
        if (this.charge >= 1) this.boosting = true;
      } else this.charge = 0;
    }
    if (this.boosting) {
      this.B += dt;
      this.heat -= (100 / Math.max(1e-3, h.boostSeconds)) * dt;
    } else {
      this.B *= Math.exp(-dt / Math.max(1e-3, tune.boostDecay));
      this.heat = Math.min(100, this.heat + (100 / Math.max(1e-3, h.coolSeconds)) * dt);
    }
    // Over a flow the engines lose their coolness whatever the throttle does: only over one, the liquid standing over the
    // ground under the hull (`sOverWater`, the last step's) and the hull's lowest point within the reach the world's own
    // burn gives a ride over a flow (`LAVA_HARM.rideReach`), and only then is the column asked whether its liquid is a
    // flow. Asked of the column alone, every racing hull on the lava world overheated: its whole sea is a flow, under
    // dry ground as much as anywhere, so the column answered yes everywhere.
    const lava = this.stepLava;
    const sv = this.stepVehicle;
    if (lava && sv && this.sOverWater && this.low - this.sWetTop <= LAVA_HARM.rideReach && lava(sv.pos.x, sv.pos.z)) this.heat -= ENGINE_TUNE.lavaHeat * dt;
    if (this.heat <= 0) {
      this.heat = 0;
      if (!this.locked) {
        // Overheated: the boost refused until the engines are back to `readyAt`, and one part caught fire.
        this.boosting = false;
        this.locked = true;
        this.charge = 0;
        this.note = 'engines overheated';
        overheat(this.engines, this.rng);
      }
    }
    if (this.locked && this.heat >= tune.readyAt) this.locked = false;
    this.over *= Math.exp(-dt / Math.max(1e-3, h.brake));
  }

  /** The slope's push, along the travel over a fixed length centred on the hull, eased in and out; then the speed, the four parts summed under the ceiling. */
  private pushStep(v: Vehicle): void {
    const h = this.handling;
    const tune = RACE_TUNE;
    const dt = this.sDt;
    const c = speedOf(this.T, h.V, thrustA(h.t75));
    const half = h.slopeLen / 2;
    this.qx = v.pos.x + this.u.x * half;
    this.qz = v.pos.z + this.u.z * half;
    this.footAt();
    const gF = this.qg;
    this.qx = v.pos.x - this.u.x * half;
    this.qz = v.pos.z - this.u.z * half;
    this.footAt();
    const gB = this.qg;
    this.slopeTheta = Number.isFinite(gF) && Number.isFinite(gB) ? Math.atan((gF - gB) / Math.max(1e-3, h.slopeLen)) : 0;
    const pushWant = c > 0 ? slopePush(this.slopeTheta, c, !this.onBand, tune) : 0;
    this.p = ease(this.p, pushWant, tune.slopeEase, dt);

    let speed = c + boostOf(this.B, h.BT, tune.boostHalf) + this.p + this.over;
    if (speed > h.cap) speed = h.cap;
    if (speed < -h.cap) speed = -h.cap;
    // A forward thrust never reverses for a strong climb.
    if (this.T >= 0 && speed < 0) speed = 0;
    this.h = speed;
  }

  /** The stick (the keys while held, else toward the heading asked for), the yaw rate eased toward what it asks, and the heading. */
  private turnStep(drive: DriveInput | null): void {
    const h = this.handling;
    const tune = RACE_TUNE;
    const dt = this.sDt;
    const trim = this.sTrim;
    let s = drive ? drive.steer : 0;
    if (s === 0 && drive && drive.heading !== undefined && drive.heading !== null) s = Math.max(-1, Math.min(1, -wrap(drive.heading - this.heading) / tune.aimLock));
    // Damaged parts pull toward their side, and a side under repair toward itself (`drivetrain.ts`'s `pullOf`).
    const pull = this.engines.pull;
    if (pull !== 0) s = Math.max(-1, Math.min(1, s + pull));
    this.stick = s;
    const sign = s > 0 ? 1 : s < 0 ? -1 : 0;
    const snap = sign !== 0 && this.lastSign !== 0 && sign !== this.lastSign;
    if (sign !== 0) this.lastSign = sign;
    const authority = Math.min(1, Math.max(0.3, Math.abs(this.h) / Math.max(1e-3, h.turnFullAt)));
    const reversing = this.h < -0.5 ? -1 : 1;
    const turnTrim = trim ? 1 + (tune.trimTurn - 1) * -trim : 1;
    const wantW = yawWanted(s, h.maxTurn, tune.deadBand) * authority * reversing * turnTrim;
    const y = this.yawStep;
    y.w = this.w;
    y.target = wantW;
    y.response = h.turnResponse;
    y.reverse = tune.reverseFactor;
    y.snap = snap;
    y.dt = dt;
    stepYawRateOf(y);
    this.w = y.w;
    // Never past the maximum turn rate, whatever eased into it.
    if (Math.abs(this.w) > h.maxTurn) this.w = Math.sign(this.w) * h.maxTurn;
    this.heading = wrap(this.heading + this.w * D2R * dt);
    this.sNx = Math.sin(this.heading);
    this.sNz = Math.cos(this.heading);
  }

  /** The travel's lag behind the nose, its multipliers eased in and out. */
  private lagStep(v: Vehicle, drive: DriveInput | null): void {
    const h = this.handling;
    const tune = RACE_TUNE;
    const dt = this.sDt;
    const water = this.stepWater;
    const wetHere = water ? water(v.pos.x, v.pos.z) : -Infinity;
    // Over water: the liquid standing over the ground itself. Never over `footAt`'s ground, which is the higher of the
    // ground and the water (what the hull rides on), so measured against it no column was ever over water.
    const ground = this.stepGround;
    const bed = ground ? ground(v.pos.x, v.pos.z) : -Infinity;
    const overWater = wetHere > bed + 0.05;
    this.sOverWater = overWater;
    this.sWetTop = wetHere;
    let mul = 1;
    if (drive && drive.slide) mul *= tune.slide;
    if (this.sTh <= 0) mul *= tune.offThrottle;
    if (this.airborne) mul *= tune.air;
    if (overWater) mul *= tune.water;
    if (this.kick > 0) mul *= tune.kick;
    this.slideMul = ease(this.slideMul, mul, tune.slideEase, dt);
    const lag = this.lagStepQ;
    lag.nx = this.sNx;
    lag.nz = this.sNz;
    lag.tau = h.tau * this.slideMul;
    lag.dt = dt;
    lagBlendOf(this.u, lag);
  }

  /** The turn the body is written with, from the heading, the pose's pitch, the ground's roll, the bank and the lean. */
  private poseTurn(): void {
    const h = this.handling;
    const ex = -this.pitch * D2R;
    const rollTotal = this.groundRoll + this.bank + (this.lean * h.leanMax - this.bank) * Math.abs(this.lean);
    this.sRoll = rollTotal;
    this.sEx = ex;
    this.sEz = rollTotal * D2R;
    euler.set(ex, this.heading, this.sEz, 'YXZ');
    quat.setFromEuler(euler);
  }

  /**
   * One command: the travel at the speed, the planned vertical speed, the whole held under the body cap with the
   * vertical part kept first, and during a scrape's hold nothing back into the wall; and what the rest of the game reads.
   */
  private command(v: Vehicle): void {
    const h = this.handling;
    const tune = RACE_TUNE;
    const body = v.body;
    let vx = this.h * this.u.x;
    let vz = this.h * this.u.z;
    let vy = Math.max(-BODY_SPEED_CAP, Math.min(BODY_SPEED_CAP, this.cmdVy));
    if (this.hold > 0) {
      const into = vx * this.holdNormal.x + vy * this.holdNormal.y + vz * this.holdNormal.z;
      if (into > 0) {
        vx -= into * this.holdNormal.x;
        vy -= into * this.holdNormal.y;
        vz -= into * this.holdNormal.z;
      }
    }
    const room = Math.sqrt(Math.max(0, BODY_SPEED_CAP * BODY_SPEED_CAP - vy * vy));
    const hs = Math.sqrt(vx * vx + vz * vz);
    if (hs > room && hs > 0) {
      vx *= room / hs;
      vz *= room / hs;
    }
    // Handed over through kept objects: the engine copies what it is given, and a literal here would be one a step.
    body.setRotation(quat, true);
    body.setAngvel(ZERO, true);
    this.cmd.set(vx, vy, vz);
    body.setLinvel(this.cmd, true);
    this.cmdValid = true;

    v.speed = this.h;
    v.steer = this.stick;
    v.boosting = this.boosting;
    v.meter = 1 - this.heat / 100;
    v.overheated = this.locked ? Math.max(0.01, ((tune.readyAt - this.heat) / 100) * h.coolSeconds) : 0;
    v.groundedPoints = this.onBand ? 4 : 0;
    v.onWater = this.sOverWater && !this.airborne;
    v.upsideDown = false;
    v.flipped = false;
    v.lean = Math.abs(this.sRoll) * D2R;
    v.group.position.copy(v.pos);
    v.group.quaternion.copy(quat);
  }

  /**
   * The pose's slow parts: the ground's pitch and roll eased (or the air's), the bank toward the yaw rate, the lean
   * toward the keys. In two halves, each small enough that the compiler builds its every call into it.
   */
  private stepPose(v: Vehicle, drive: DriveInput | null): void {
    this.poseGround(v);
    this.poseBank(drive);
  }

  /** The bank toward what the yaw rate asks, the lean toward the keys once the hull is really moving. */
  private poseBank(drive: DriveInput | null): void {
    const h = this.handling;
    const tune = RACE_TUNE;
    const dt = this.sDt;
    this.bank = ease(this.bank, bankTarget(this.w, h.maxTurn, h.bankMax), h.bankEase, dt);
    // Never while a side is being repaired: the pilot's hands are full.
    const leanWant = drive && Math.abs(this.h) >= h.leanFrom && this.engines.repairing < 0 ? Math.max(-1, Math.min(1, drive.lean ?? 0)) : 0;
    this.lean = ease(this.lean, leanWant, tune.leanEase, dt);
  }

  private readonly poseReads = new Float64Array(4);

  /** The ground's pitch and roll under the hull eased, or in the air a level roll and a gently dropping nose. */
  private poseGround(v: Vehicle): void {
    const tune = RACE_TUNE;
    const dt = this.sDt;
    const b = v.spec.bounds;
    if (this.airborne) {
      this.groundRoll = ease(this.groundRoll, 0, tune.airRoll, dt);
      if (this.pitch > tune.airNoseMost) this.pitch = Math.max(tune.airNoseMost, this.pitch - tune.airNose * dt);
    } else {
      const nx = this.sNx;
      const nz = this.sNz;
      const L = Math.max(1.2, Math.abs(b.max[2] - b.min[2]) * 0.6);
      const W = Math.max(0.8, Math.abs(b.max[0] - b.min[0]) * 0.6);
      // The right is the nose crossed with up: -x at heading nought. The four reads (ahead, behind, to the right and
      // to the left) from one call in a loop, which the compiler builds in once.
      const rx = -nz;
      const rz = nx;
      const g4 = this.poseReads;
      for (let i = 0; i < 4; i++) {
        const along = i === 0 ? L : i === 1 ? -L : 0;
        const across = i === 2 ? W : i === 3 ? -W : 0;
        this.qx = v.pos.x + nx * along + rx * across;
        this.qz = v.pos.z + nz * along + rz * across;
        this.footAt();
        g4[i] = this.qg;
      }
      const ahead = g4[0];
      const behind = g4[1];
      const toRight = g4[2];
      const toLeft = g4[3];
      if (Number.isFinite(ahead) && Number.isFinite(behind) && Number.isFinite(toRight) && Number.isFinite(toLeft)) {
        const wantPitch = Math.atan((ahead - behind) / (2 * L)) / D2R;
        const wantRoll = -Math.atan((toRight - toLeft) / (2 * W)) / D2R;
        this.pitch = ease(this.pitch, wantPitch, wantPitch > this.pitch ? tune.pitchUp : tune.pitchDown, dt);
        this.groundRoll = ease(this.groundRoll, wantRoll, tune.roll, dt);
      }
    }
  }

  /**
   * The ground the hull's own reader gives at `qx`, `qz`, the flat water over it laid on, into `qg`: what the
   * footprint, the slope and the pose read. −Infinity where there is neither.
   */
  private footAt(): void {
    const x = this.qx;
    const z = this.qz;
    const g = this.stepGround ? this.stepGround(x, z) : -Infinity;
    const w = this.stepWater ? this.stepWater(x, z) : -Infinity;
    const top = g > w ? g : w;
    this.qg = Number.isFinite(top) ? top : -Infinity;
  }

  /** The ground at a point, read as `footAt` reads it: for the rare callers (a wall's slope, the console) that are not stepped. */
  private footGround(x: number, z: number): number {
    this.qx = x;
    this.qz = z;
    this.footAt();
    return this.qg;
  }

  /** The highest ground under the hull's footprint with its middle at `fx`, `fz`, turned with the heading (its four corners and the middles of its sides), into `fp`. */
  private footprintAt(v: Vehicle): void {
    const b = v.spec.bounds;
    const px = this.fx;
    const pz = this.fz;
    const s = this.sinH;
    const c = this.cosH;
    const x0 = b.min[0] < b.max[0] ? b.min[0] : b.max[0];
    const x1 = b.min[0] < b.max[0] ? b.max[0] : b.min[0];
    const z0 = b.min[2] < b.max[2] ? b.min[2] : b.max[2];
    const z1 = b.min[2] < b.max[2] ? b.max[2] : b.min[2];
    const zm = (z0 + z1) / 2;
    let top = -Infinity;
    for (let i = 0; i < 6; i++) {
      const lx = i & 1 ? x1 : x0;
      const lz = i < 2 ? z0 : i < 4 ? z1 : zm;
      this.qx = px + lx * c + lz * s;
      this.qz = pz - lx * s + lz * c;
      this.footAt();
      if (this.qg > top) top = this.qg;
    }
    this.fp = top;
  }
  /** The heading's sine and cosine as the plan began, for the footprint. */
  private sinH = 0.5;
  private cosH = 0.5;

  /** The middle ray down at `mx`, `mz` from `mFrom` for `mReach`, among what stands still (a deck, a floor, a rock under the hull), into `mOut`; −Infinity with nothing, or before the world has stepped. */
  private middleRayAt(v: Vehicle): void {
    const ph = this.stepPhysics;
    if (!ph || ph.steps <= 0 || v.inRoom) {
      this.mOut = -Infinity;
      return;
    }
    const hit = ph.topSurface(this.mx, this.mz, this.mFrom, this.mReach, FLOOR_ALL, stillOnly);
    this.mOut = hit === null ? -Infinity : hit;
  }

  /** The ground across the box's width at `qx`, `qz` on the path ahead, cached only (its left and right edges and its middle), into `qa`; NaN where the cache cannot answer. */
  private aheadAt(): void {
    const r = this.reader();
    if (!r) {
      this.qa = Number.NaN;
      return;
    }
    const x = this.qx;
    const z = this.qz;
    const ax = -this.cosH * this.pHalfW;
    const az = this.sinH * this.pHalfW;
    let top = -Infinity;
    for (let i = 0; i < 3; i++) {
      const k = i - 1;
      const g = r.near(x + ax * k, z + az * k);
      if (g === null || !Number.isFinite(g)) {
        this.qa = Number.NaN;
        return;
      }
      if (g > top) top = g;
    }
    const w = this.stepWater ? this.stepWater(x, z) : -Infinity;
    this.qa = w > top ? w : top;
  }

  /** In a building's rooms the ground ahead is the room's own ray (the vehicle's reader there), and nothing is far. */
  private readonly roomNear = (x: number, z: number): number | null => {
    const g = this.stepGround ? this.stepGround(x, z) : -Infinity;
    return Number.isFinite(g) ? g : null;
  };
  private readonly roomReader: LineReader = { near: (x, z) => this.roomNear(x, z), far: () => null, farStep: 0, farX: () => 0, farZ: () => 0 };

  private reader(): LineReader | null {
    const v = this.stepVehicle;
    if (v?.inRoom) return this.roomReader;
    return this.deps.ground;
  }

  /** The climbing judge's reading of the ground at a distance travelled (`climbVerdictOf`), cached only. */
  private readonly climbGround = (q: ClimbPass): boolean => {
    const d = q.at - this.odo;
    this.qx = this.planFrom.x + this.u.x * d;
    this.qz = this.planFrom.z + this.u.z * d;
    this.aheadAt();
    if (!Number.isFinite(this.qa)) return false;
    q.g = this.qa;
    return true;
  };

  /** The samples the hull's middle has passed go from the ahead row into the ring behind it. */
  private freezeBridge(): void {
    const step = RACE_TUNE.bridgeStep;
    const upTo = Math.floor(this.odo / step);
    for (let i = 0; i < this.aheadCount; i++) {
      const k = this.aheadFrom + i;
      if (k > upTo) break;
      const slot = ((k % this.bridgeRing) + this.bridgeRing) % this.bridgeRing;
      this.ringKey[slot] = k;
      this.ringVal[slot] = this.ahead[i];
    }
  }

  /**
   * The bridged ground at the footprint's rear and nose for the middle at `bS` on the odometer, the plan's span and
   * length, into `bOut`: the flat closing of the samples within a span either side (the ring behind, the row read this
   * plan ahead), the higher of the two ends; −Infinity where no window can see across (the line as before).
   */
  private bridgedAt(): void {
    const step = RACE_TUNE.bridgeStep;
    const s = this.bS;
    const length = this.pL;
    const span = this.pSpan;
    // A sample's margin either side, so every window holding the rear and the nose lies within the row.
    const kLo = Math.floor((s - length / 2 - span) / step) - 1;
    const kHi = Math.ceil((s + length / 2 + span) / step) + 1;
    const n = Math.min(this.rowS.length, kHi - kLo + 1);
    const from = this.aheadFrom;
    const count = this.aheadCount;
    const ring = this.bridgeRing;
    for (let i = 0; i < n; i++) {
      const k = kLo + i;
      if (k >= from && k < from + count) this.rowS[i] = this.ahead[k - from];
      else {
        const slot = ((k % ring) + ring) % ring;
        this.rowS[i] = this.ringKey[slot] === k ? this.ringVal[slot] : Number.NaN;
      }
    }
    const nw = Math.max(1, Math.round(span / step) + 1);
    const starts = bridgeClose(this.rowS, n, nw, this.rowDil, this.rowDeque);
    if (starts <= 0) {
      this.bOut = -Infinity;
      return;
    }
    // Only where the closing lifted a sample either side: elsewhere the raw ground answers, to the bit (`bridgedBetweenOf`).
    const q = this.bQ;
    q.at = (s - length / 2) / step - kLo;
    bridgedBetweenOf(this.rowS, this.rowDil, starts, nw, q);
    const rear = q.out;
    q.at = (s + length / 2) / step - kLo;
    bridgedBetweenOf(this.rowS, this.rowDil, starts, nw, q);
    const nose = q.out;
    const r = Number.isNaN(rear) ? -Infinity : rear;
    const f = Number.isNaN(nose) ? -Infinity : nose;
    this.bOut = r > f ? r : f;
  }

  /**
   * The height over the coming fixed steps (`pN`): the walk ahead once, the climbing judge once, then sub-steps of at
   * most `sweepStep` of the travel, each with its line, its height rule and its strike sweep. The body is commanded
   * the plan's net vertical speed. True when the hull was wrecked (nothing more to command).
   */
  private plan(v: Vehicle): boolean {
    this.planStart(v);
    if (this.pForward) {
      this.planWalk(v);
      if (this.planJudge(v)) return true;
    } else {
      // Reversing or crawling: nothing ahead is judged and nothing swept, and the marks keep up with the odometer, so
      // ground the hull backed over is never swept as though it lay ahead.
      this.walk.n = 0;
      this.walk.past = Number.NaN;
      this.rayTaken = false;
      this.reach = 0;
      this.judgedTo = Math.max(this.judgedTo, this.odo + this.pTravel + this.pL / 2 + this.handling.climbLen);
      this.sweptTo = Math.max(this.sweptTo, this.odo + this.pTravel);
    }
    this.planBridgeRow(v);
    this.planRate(v);
    for (let i = 0; i < this.pM; i++) if (this.subStep(v, i)) return true;
    const h = this.handling;
    const st = this.vStep;
    this.low = st.low;
    this.overLine = st.low - (this.line + h.ride);
    this.airborne = st.low - this.line > h.airborneAt;
    this.onBand = this.pPhase !== FALL || this.overLine <= h.band;
    this.vy = st.vy;
    this.keep = st.keep;
    this.cmdVy = (st.low - this.pLow0) / this.pT;
    return false;
  }

  /** The plan's own numbers: its seconds, speed and travel, the hull's length and width, its lowest point posed, its direction. */
  private planStart(v: Vehicle): void {
    const h = this.handling;
    const tune = RACE_TUNE;
    const b = v.spec.bounds;
    this.pT = this.pN * FIXED_DT;
    this.pL = this.lengthOf(v);
    this.pHalfW = this.widthOf(v) / 2;
    this.pLoose = tune.hold !== 'firm';
    // The hull's lowest point as it rolls, banks and leans, and under the firm hold as it pitches too. The loose hold
    // leaves the pitch out: the attitude tips the nose toward the ground a hull's length ahead and behind, raw (a bridged
    // pit's floor included), so it tips the nose down 36 degrees at a pit's near edge and up 30 to 47 at its far rim, and
    // the cushion lifting the whole hull out of a dip of its own nose or tail threw it two to nine metres up at every
    // edge it passed (the firm hold does too, and its fall of fifteen times gravity brings it back down in a blink; with
    // nothing but gravity to, the loose hold hung there). What the hull holds is its flat underside over the highest
    // ground under its footprint, which a nose tipped toward ground falling away, or a tail toward ground left behind,
    // is never nearer than.
    this.pose.ex = this.pLoose ? 0 : this.sEx;
    this.pose.ez = this.sEz;
    lowestOffsetOf(b, this.pose);
    const st = this.vStep;
    st.low = v.pos.y + this.pose.low;
    st.vy = this.vy;
    this.pLow0 = st.low;
    // The travel along the path this plan: forward, or for a reversing hull nothing of the look-ahead or the bridge.
    this.pForward = this.h > 0.5;
    this.pUx = this.u.x;
    this.pUz = this.u.z;
    this.sinH = Math.sin(this.heading);
    this.cosH = Math.cos(this.heading);
    this.planFrom.x = v.pos.x;
    this.planFrom.z = v.pos.z;
    this.pBridge = tune.bridge === 'on' && !v.inRoom && !!this.deps.ground && this.pForward;
    this.pMiddleFrom = v.pos.y + (b.min[1] + b.max[1]) / 2;
    this.pRayReach = this.pMiddleFrom - this.pLow0 + 60;
    this.planTravelAt(this.pForward);
    this.pSign = this.h >= 0 ? 1 : -1;
    const fallTune = this.fallTune;
    fallTune.ride = h.ride;
    fallTune.riseRate = h.riseRate;
    fallTune.riseMax = h.riseMax;
    fallTune.band = h.band;
    fallTune.bandRate = h.bandRate;
    fallTune.fall = h.fall * (this.sTrim > 0 ? 1 - tune.trimGlide * this.sTrim : 1);
    fallTune.fallMax = h.fallMax;
    // The loose hold's: the firm rule's own rise, settle and fall, the world's gravity in the air (the nose trim's glide
    // on it as on the firm fall) and the cushion's grip.
    const loose = this.looseTune;
    loose.ride = h.ride;
    loose.riseRate = h.riseRate;
    loose.riseMax = h.riseMax;
    loose.band = h.band;
    loose.bandRate = h.bandRate;
    loose.fall = fallTune.fall;
    loose.fallMax = h.fallMax;
    loose.gravity = tune.looseFall * (this.sTrim > 0 ? 1 - tune.trimGlide * this.sTrim : 1);
    loose.grip = tune.looseGrip;
    st.keep = this.keep;
    this.pLip = tune.lipShare * h.ride;
    this.pPhase = BAND;
    this.pStopAt = Infinity;
  }

  /** The plan's speed and travel from the speed now, the bridge's span with them, and the sub-steps the travel is cut into. */
  private planTravelAt(forward: boolean): void {
    this.pSpeed = Math.abs(this.h);
    this.pTravel = this.pSpeed * this.pT;
    this.planTravel = this.pTravel;
    this.pSpan = Math.max(this.pL, RACE_TUNE.bridgeTime * this.pSpeed);
    this.span = this.pSpan;
    this.pM = Math.max(1, Math.ceil(this.pTravel / Math.max(0.25, this.handling.sweepStep)));
    this.pDs = this.pTravel / this.pM;
    this.pDts = this.pT / this.pM;
    if (!forward) this.pBridge = false;
  }

  /** The walk ahead, once a plan, from the nose along the travel; the one far ray at its farthest sample within reach. */
  private planWalk(v: Vehicle): void {
    const h = this.handling;
    const reader = this.reader();
    const walk = this.walk;
    walk.n = 0;
    walk.past = Number.NaN;
    this.rayTaken = false;
    if (reader) {
      const wt = this.walkTune;
      wt.lookAhead = RACE_TUNE.lookAhead;
      wt.lookMax = h.lookMax;
      wt.lookStep = h.lookStep;
      walk.x0 = v.pos.x + this.pUx * (this.pL / 2);
      walk.z0 = v.pos.z + this.pUz * (this.pL / 2);
      walk.dx = this.pUx;
      walk.dz = this.pUz;
      walk.speed = this.pSpeed;
      walkLineOf(reader, this.ring, wt, walk, this.stepWater);
      this.farRay(v);
    }
    this.reach = walk.got;
  }

  /** The climbing judge, once a plan: every point ahead judged once as it passes climbLen off the nose. True when the cut wrecked the hull. */
  private planJudge(v: Vehicle): boolean {
    const h = this.handling;
    const c = this.climb;
    c.nose = this.odo + this.pL / 2;
    c.from = Math.max(this.judgedTo, c.nose);
    c.travel = this.pTravel;
    c.low = this.pLow0;
    c.step = h.sweepStep;
    climbVerdictOf(this.climbGround, h, c);
    this.judgedTo = c.to;
    this.judged.to = c.to;
    this.judged.allowed = c.allowed;
    this.judged.points = c.points;
    const speed = this.pSpeed;
    if (c.allowed < speed) {
      const left = c.allowed;
      if (this.scoreCut(v, speed - left, speed, left, 'climb')) return true;
      // The plan's travel is the cut speed's from here on, so the sweep's marks keep tiling what the body really travels.
      this.planTravelAt(Math.abs(this.h) > 0.5);
    }
    return false;
  }

  /** The bridge's row ahead: from the first lattice point past the middle to a span past the nose at the plan's end, or the line's rate's reach. */
  private planBridgeRow(v: Vehicle): void {
    this.aheadCount = 0;
    if (!this.pBridge) return;
    const step = RACE_TUNE.bridgeStep;
    this.aheadFrom = Math.floor(this.odo / step) + 1;
    // Two samples past the farthest window the plan's last sub-step reads (`bridgedAt` keeps a sample's margin), or the
    // line's rate reads `feedAhead` on, whichever is further.
    const reachOut = Math.max(this.pTravel, this.pSpeed * RACE_TUNE.feedAhead);
    const last = Math.ceil((this.odo + reachOut + this.pL / 2 + this.pSpan) / step) + 2;
    const count = Math.min(this.ahead.length, last - this.aheadFrom + 1);
    for (let i = 0; i < count; i++) {
      const d = (this.aheadFrom + i) * step - this.odo;
      this.qx = v.pos.x + this.pUx * d;
      this.qz = v.pos.z + this.pUz * d;
      this.aheadAt();
      this.ahead[i] = this.qa;
    }
    this.aheadCount = Math.max(0, count);
  }

  /** The line's rate, from the same walk: the ground under the hull now and under the footprint `feedAhead` on, both bridged. */
  private planRate(v: Vehicle): void {
    this.mx = v.pos.x;
    this.mz = v.pos.z;
    this.mFrom = this.pMiddleFrom;
    this.mReach = this.pRayReach;
    this.middleRayAt(v);
    this.fx = v.pos.x;
    this.fz = v.pos.z;
    this.footprintAt(v);
    let underNow = this.fp > this.mOut ? this.fp : this.mOut;
    this.rawNow = underNow;
    if (this.pBridge) {
      this.bS = this.odo;
      this.bridgedAt();
      if (this.bOut > underNow) underNow = this.bOut;
    }
    if (!this.pForward) {
      this.lineRate = 0;
      this.rateFed = 0;
      this.pastN = 0;
      this.lastLineOk = false;
      this.firstRate = 0;
      this.underRate = 0;
      return;
    }
    const q = this.lineQ;
    const f = this.pSpeed * RACE_TUNE.feedAhead;
    // The ground under the footprint `f` on, bridged as `under` will be when the hull is there: read raw, the line's
    // rate dived toward every pit's floor ahead while the line itself, bridged, never would.
    q.under = underNow;
    q.f = f;
    q.length = this.pL;
    underAheadOfQ(this.walk, q);
    let underAhead = q.out;
    if (this.pBridge) {
      this.bS = this.odo + f;
      this.bridgedAt();
      if (this.bOut > underAhead) underAhead = this.bOut;
    }
    q.under = underNow;
    q.underAhead = underAhead;
    q.speed = this.pSpeed;
    lineRateOfQ(this.walk, q, RACE_TUNE);
    this.lineRate = q.out;
    if (!this.pLoose) {
      this.rateFed = this.lineRate;
      // (The loose hold's look behind and its line's own rate begin afresh if the hold is switched back.)
      this.pastN = 0;
      this.lastLineOk = false;
      return;
    }
    // A hull riding its line carries on at the vertical speed it has, which on a slope is the slope's, wherever nothing
    // is behind it to read (just taken over, or put somewhere else). Read as nought, a hull taken over halfway down a
    // descent levelled off and flew off its own slope as off a crest.
    const h = this.handling;
    const over = this.pLow0 - underNow - h.ride;
    const riding = over <= h.band && over >= -h.band;
    const vyNow = this.vy > h.riseMax ? h.riseMax : this.vy < -h.fallMax ? -h.fallMax : this.vy;
    if (!this.lastLineOk) this.firstRate = riding ? vyNow : 0;
    // How far the ground under the footprint will have risen a tenth of a second on (`stepLooseOf`'s `ahead`): the
    // cushion's own lift may run that far ahead of its line, as the firm rule's rise on the line's rate ahead does, so a
    // rise met at the foot of a step is climbed from before it rather than from it. Held to its line alone, a bike at its
    // top met the far wall of a pit 6 m deep, vertical, at its line half a wall below the rim and crashed, which the firm
    // hold rises out of.
    this.underRate = RACE_TUNE.feedAhead > 0 ? (underAhead - underNow) / RACE_TUNE.feedAhead : 0;
    // What the hull keeps comes from the rate of the ground itself under it over the last tenth of a second, never the
    // line's rate ahead (the look-ahead raises the line to anticipate a rise, which the ground has given nothing yet),
    // nor the bridged ground's (the bridge is the drive's own glide over a pothole, and gives nothing either: fed the
    // bridged ground, a hull carried up a slope over its potholes kept more of the slope's speed than one that met
    // them, flew further off the crest beyond, and with the bridge on spent more time high over open ground than with
    // it off, by 0.6 of a point on hilly ground, past the half point the bridge is held to; fed the ground itself, 0.3).
    this.pastLine = this.rawNow;
    const first = this.pastN === 0;
    this.pastRate();
    if (first) {
      this.rateFed = riding ? vyNow : 0;
      return;
    }
    // And taken up no faster than `looseFeed` a second: a slope's rate is taken within a fraction of a second, while a
    // step (a kerb, the far rim of a pit the hull is carried over) is the ground's whole height in one sub-step, read
    // over the look behind as hundreds of metres a second, and taken whole it threw the hull tens of metres up. (The
    // climb does not wait for it: the rise is the firm rule's own, `looseRate`.)
    const most = RACE_TUNE.looseFeed * this.pT;
    const d = this.pastFed - this.rateFed;
    this.rateFed += d > most ? most : d < -most ? -most : d;
  }

  /**
   * The loose hold's rate for its rise and its settle at this sub-step (its line in `line`): the line's own rate ahead
   * while it rises (`lineRate`, exactly the firm rule's, so a rise is climbed as the firm hold climbs it and the
   * climbing judge's reckoning holds), else the line's fall as it falls now, from sub-step to sub-step (the first of a
   * run taking `firstRate`, the hull's own while it rides its line). The line's own
   * rate ahead reads nought on a descent wherever the footprint a tenth of a second on still overlaps the one now (at
   * the halved speeds a stock pod's whole range), and fed nought a hull riding a descent fell behind it in the band and
   * then could only follow it at the grip; fed what the ground has done over a tenth of a second behind it, a hull
   * reaching a descent's foot was still being taken down at the descent's speed after the ground had levelled, and sank
   * into the foot. The line's own fall now stops with the line.
   */
  private looseRate(): void {
    // (Read off `line` and written into `looseLine`, fields both: nothing crosses the call as a number.)
    const line = this.line;
    const inst = this.lastLineOk ? (line - this.lastLine) / this.pDts : this.firstRate;
    this.lastLine = line;
    this.lastLineOk = true;
    this.looseLine = this.lineRate > 0 ? this.lineRate : inst < 0 ? inst : 0;
  }

  /**
   * The line's rate over the last `feedAhead` seconds of the physics' own steps, behind the hull as the line's own rate
   * is ahead of it, into `pastFed`: the line under the hull now (`pastLine`) kept in a ring with the plan's clock, and
   * read against the newest kept a `feedAhead` ago (or the oldest, nearer). Over one plan alone it was the line's own
   * jitter between plans, a fixed step apart at one frame rate and three at another.
   */
  private pastRate(): void {
    const now = this.pastClock;
    const size = this.pastT.length;
    let at = -1;
    let oldest = -1;
    for (let k = 0; k < this.pastN; k++) {
      const i = (this.pastHead - 1 - k + size * 2) % size;
      oldest = i;
      if (now - this.pastT[i] >= RACE_TUNE.feedAhead - 1e-9) {
        at = i;
        break;
      }
    }
    if (at < 0) at = oldest;
    this.pastFed = at >= 0 && now - this.pastT[at] > 1e-9 ? (this.pastLine - this.pastL[at]) / (now - this.pastT[at]) : 0;
    this.pastT[this.pastHead] = now;
    this.pastL[this.pastHead] = this.pastLine;
    this.pastHead = (this.pastHead + 1) % size;
    if (this.pastN < size) this.pastN++;
    this.pastClock = now + this.pT;
  }

  /** One sub-step of the plan: the ground under it (bridged), its line, the height rule, and the strike sweep over what it crossed. True when the hull was wrecked. */
  private subStep(v: Vehicle, i: number): boolean {
    const h = this.handling;
    const st = this.vStep;
    const s0 = Math.min(this.odo + i * this.pDs, this.pStopAt);
    const s1 = Math.min(s0 + this.pDs, this.pStopAt);
    const along = (s1 - this.odo) * this.pSign;
    const px = v.pos.x + this.pUx * along;
    const pz = v.pos.z + this.pUz * along;
    this.fx = px;
    this.fz = pz;
    this.footprintAt(v);
    this.mx = px;
    this.mz = pz;
    this.mFrom = this.pMiddleFrom + (st.low - this.pLow0);
    this.mReach = this.pRayReach;
    this.middleRayAt(v);
    let raw = this.fp > this.mOut ? this.fp : this.mOut;
    if (!Number.isFinite(raw)) raw = st.low - h.ride;
    let under = raw;
    if (this.pBridge) {
      this.bS = s1;
      this.bridgedAt();
      if (this.bOut > under) under = this.bOut;
      this.bridgeLift = Math.max(0, under - raw);
    } else this.bridgeLift = 0;
    let line = under;
    if (this.pForward) {
      const q = this.lineQ;
      q.under = under;
      q.from = s1 - this.odo;
      q.share = RACE_TUNE.lookShare;
      q.past = false;
      lineFromOf(this.walk, q);
      line = q.out;
    }
    this.line = line;
    this.under = under;
    const lowA = st.low;
    st.line = line;
    st.dt = this.pDts;
    if (this.pLoose) {
      this.looseRate();
      st.rate = this.looseLine;
      st.feed = this.rateFed;
      st.ahead = this.underRate * RACE_TUNE.feedAhead;
      this.pPhase = stepLooseOf(st, this.looseTune);
    } else {
      st.rate = this.rateFed;
      this.pPhase = stepVerticalOf(st, this.fallTune);
    }
    // The strike sweep: every point the footprint crossed since its mark, against the hull's height there.
    if (this.pForward && s1 > s0) {
      this.wS0 = s0;
      this.wS1 = s1;
      this.wLowA = lowA;
      this.wLowB = st.low;
      this.wLast = i === this.pM - 1;
      if (this.sweep(v)) {
        const wall = this.strike(v, st, Math.abs(this.h), this.pLip);
        if (wall === 2) return true;
        if (wall === 1) this.pStopAt = s1;
      }
    }
    return false;
  }
  private readonly fallTune = { ride: 0.5, riseRate: 0.5, riseMax: 0.5, band: 0.5, bandRate: 0.5, fall: 0.5, fallMax: 0.5 };
  private readonly looseTune = { ride: 0.5, riseRate: 0.5, riseMax: 0.5, band: 0.5, bandRate: 0.5, fall: 0.5, fallMax: 0.5, gravity: 0.5, grip: 0.5 };
  private readonly walkTune = { lookAhead: 0.5, lookMax: 0.5, lookStep: 0.5 };

  /**
   * The far ray at the walk's farthest sample within `rayReach`, cast from `rayAbove` over the hull among what stands
   * still, taken only when what it finds stands within `rayAccept` of the cached ground there: a road, a plaza, a
   * ramp's foot, never a trunk, a roof or a deck high over the ground.
   */
  private farRay(v: Vehicle): void {
    const ph = this.stepPhysics;
    const w = this.walk;
    if (!ph || ph.steps <= 0 || v.inRoom || !w.n) return;
    const tune = RACE_TUNE;
    let k = -1;
    for (let i = w.n - 1; i >= 0; i--) {
      if (w.d[i] <= tune.rayReach) {
        k = i;
        break;
      }
    }
    if (k < 0) return;
    const from = v.pos.y + tune.rayAbove;
    const reach = from - w.g[k] + tune.rayAccept + 1;
    if (!(reach > 0)) return;
    const hit = ph.topSurface(w.x[k], w.z[k], from, reach, FLOOR_ALL, stillOnly);
    if (hit !== null && Math.abs(hit - w.g[k]) <= tune.rayAccept && hit > w.g[k]) {
      w.g[k] = hit;
      this.rayTaken = true;
    }
  }

  /**
   * The strike sweep over one sub-step (`wS0` to `wS1` on the odometer, the hull's lowest point `wLowA` to `wLowB`):
   * the points a `sweepStep` apart from the mark, each the footprint's ground there, the ground `faceLen` behind it and
   * the hull's lowest point interpolated to it. True when the footprint met ground over the hull anywhere.
   */
  private sweep(v: Vehicle): boolean {
    const h = this.handling;
    const step = Math.max(0.25, h.sweepStep);
    const path = this.path;
    const s0 = this.wS0;
    const s1 = this.wS1;
    const lowA = this.wLowA;
    const lowB = this.wLowB;
    path.n = 0;
    // From its own mark, even where the body went further than the last plan said (a step nobody planned, a
    // `stepOnce`): that ground is behind the hull now, and is judged at the height the sub-step starts from.
    let q = this.sweptTo;
    if (q > s1) return false;
    let met = false;
    const ds = s1 - s0;
    while (path.n < path.g.length) {
      let next = q + step;
      if (next > s1) {
        // The sub-step's end is judged too on the plan's last sub-step, so nothing between plans goes unjudged.
        if (!this.wLast || q >= s1 - 1e-9) break;
        next = s1;
      }
      q = next;
      const along = q - this.odo;
      const x = this.planFrom.x + this.u.x * along;
      const z = this.planFrom.z + this.u.z * along;
      this.fx = x;
      this.fz = z;
      this.footprintAt(v);
      const g = this.fp;
      this.fx = x - this.u.x * h.faceLen;
      this.fz = z - this.u.z * h.faceLen;
      this.footprintAt(v);
      const back = this.fp;
      const y = q <= s0 ? lowA : ds > 0 ? lowA + ((lowB - lowA) * (q - s0)) / ds : lowB;
      path.g[path.n] = Number.isFinite(g) ? g : -Infinity;
      path.back[path.n] = Number.isFinite(back) ? back : path.g[path.n];
      path.y[path.n] = y;
      if (path.g[path.n] > y) {
        // The deepest point met, where a face's own slope is read if it turns out to be a wall.
        if (!met || path.g[path.n] - y > this.metDepth) {
          this.metDepth = path.g[path.n] - y;
          this.metX = x;
          this.metZ = z;
        }
        met = true;
      }
      path.n++;
    }
    this.sweptTo = q;
    return met;
  }

  /**
   * What the footprint met: a face steeper than `climbGrade` standing over the lip is a wall (the speed into it cut
   * to nought and scored); anything else a strike, the hull lifted out at once and its vertical speed set to the
   * ground's own rise (`strikeKick`), the closing sparking past `strikeSpark` and costing hull past `strikeHurt`, never
   * past `strikeMost` and never under the wear floor. 0 a strike (or nothing), 1 a wall the hull stopped at, 2 a wall
   * that wrecked it.
   */
  private strike(v: Vehicle, st: { low: number; vy: number }, speed: number, lip: number): number {
    const h = this.handling;
    const tune = RACE_TUNE;
    const path = this.path;
    const face = faceVerdict(path, lip, h);
    if (face > h.climbGrade) {
      // A wall: the speed into it cut to nought along the face's own horizontal normal (from the ground's slope where
      // it was met; along the travel where the slope says nothing), and no lift: a cliff is not climbed by being struck.
      const e = 1;
      let gx = this.footGround(this.metX + e, this.metZ) - this.footGround(this.metX - e, this.metZ);
      let gz = this.footGround(this.metX, this.metZ + e) - this.footGround(this.metX, this.metZ - e);
      let gl = Math.hypot(gx, gz);
      if (!(gl > 1e-6) || !Number.isFinite(gl)) {
        gx = this.u.x;
        gz = this.u.z;
        gl = 1;
      }
      gx /= gl;
      gz /= gl;
      const into = speed * (this.u.x * gx + this.u.z * gz);
      if (!(into > 0)) return 0;
      const lx = speed * this.u.x - into * gx;
      const lz = speed * this.u.z - into * gz;
      const left = Math.hypot(lx, lz);
      const k = this.verdictNumbers();
      let verdict = hitVerdict(speed * this.u.x, 0, speed * this.u.z, lx, 0, lz, k);
      if (verdict === HIT_CRASH && RACE_TUNE.offCourse === 'stop') verdict = HIT_SCRAPE;
      if (left > 1e-6) {
        this.u.x = lx / left;
        this.u.z = lz / left;
      }
      this.share(left);
      // What it lost is the speed into the face, along the face's own normal: the side it struck.
      this.lossX = into * gx;
      this.lossZ = into * gz;
      if (verdict !== HIT_NONE && this.score(v, verdict, into, speed - left, 'face')) return 2;
      return 1;
    }
    let top = -Infinity;
    for (let i = 0; i < path.n; i++) if (path.g[i] > top) top = path.g[i];
    this.lifts++;
    const rise = strikeKick(path, speed, h);
    const closing = Math.max(0, rise - st.vy);
    if (top > st.low) st.low = top;
    if (rise > st.vy) st.vy = rise;
    if (closing > h.strikeSpark) {
      v.justHit = Math.max(v.justHit, Math.min(20, closing));
      this.lastHit.kind = 'strike';
      this.lastHit.loss = closing;
      this.lastHit.drop = 0;
      this.lastHit.at = this.steps;
      if (closing > h.strikeHurt) {
        v.raceHurt(Math.min(h.strikeMost, (closing - h.strikeHurt) * h.strikeHull), tune.wearFloor);
        // And a part of either engine, never much: a bad landing is felt in the engines, never ruinous.
        damageAny(this.engines, Math.min(ENGINE_TUNE.strikeMost, (closing - h.strikeHurt) * ENGINE_TUNE.strikePart), this.rng);
      }
    }
    return 0;
  }

  /**
   * A cut of the horizontal speed the drive makes itself (a steep face met, a rise too tall to clear in time), scored as
   * a contact's loss would be: the speed shared out again at what is left. With `offCourse: 'stop'` a terrain face is
   * never more than a scrape (W1 has no runs). True when the hull was wrecked.
   */
  private scoreCut(v: Vehicle, cut: number, from: number, left: number, why: 'face' | 'climb'): boolean {
    const k = this.verdictNumbers();
    let verdict = hitVerdict(from * this.u.x, 0, from * this.u.z, left * this.u.x, 0, left * this.u.z, k);
    if (verdict === HIT_CRASH && RACE_TUNE.offCourse === 'stop') verdict = HIT_SCRAPE;
    this.share(Math.max(0, left));
    if (verdict === HIT_NONE) return false;
    // Lost straight ahead: square on, so a coin picks the engine it is felt in.
    this.lossX = cut * this.u.x;
    this.lossZ = cut * this.u.z;
    return this.score(v, verdict, cut, cut, why);
  }

  /**
   * A hit scored: a crash wrecks the hull (the game's own path takes the vehicle away and throws the rider, no harder
   * than `flingMost`); a scrape costs hull past `hitLoss` down to the wear floor, cuts the throttle and the boost for a
   * moment and kicks the travel's lag. True when the hull was wrecked.
   */
  private score(v: Vehicle, verdict: number, impact: number, drop: number, why: 'contact' | 'face' | 'climb'): boolean {
    const tune = RACE_TUNE;
    this.lastHit.kind = verdict === HIT_CRASH ? 'crash' : why === 'contact' ? 'scrape' : why;
    this.lastHit.loss = impact;
    this.lastHit.drop = drop;
    this.lastHit.at = this.steps;
    if (verdict === HIT_CRASH) {
      v.justHit = Math.max(v.justHit, impact);
      v.raceWreck();
      this.boosting = false;
      return v.destroyed;
    }
    v.justHit = Math.max(v.justHit, Math.min(20, impact));
    // The engines take most of a scrape (a part of the struck side; a bike's one engine) and the hull the rest, never
    // under its floor.
    const past = impact - tune.hitLoss;
    v.raceHurt(past * tune.scrapeHull * ENGINE_TUNE.hullShare, tune.wearFloor);
    const side = hitSide(this.lossX, this.lossZ, -Math.cos(this.heading), Math.sin(this.heading), this.rng);
    damagePart(this.engines, side, past * ENGINE_TUNE.scrapePart, this.rng);
    this.cut = tune.scrapeCut;
    this.kick = tune.kickTime;
    this.boosting = false;
    this.charge = 0;
    return false;
  }

  /** The engines in numbers, for the console (`__debug.engines()`, `race()`); allocates, never called in a frame. */
  enginesReport(): Record<string, unknown> {
    const e = this.engines;
    const r2 = (n: number) => Number(n.toFixed(2));
    return {
      engines: e.sides,
      parts: e.parts.map((p, i) => ({ part: enginePartName(e.sides, i), damage: r2(p.out ? 1 : p.d), burning: p.fire > 0 ? r2(p.fire) : 0, out: p.out })),
      pull: r2(e.pull),
      topShare: r2(e.top),
      limp: e.limp,
      boostAllowed: e.boostOk,
      repairing: e.repairing >= 0 ? enginePartName(e.sides, e.repairing) : null,
      repairHeld: r2(e.held),
      repairRate: r2(this.handling.repairRate),
      thrust: e.sides === 1 ? [r2(e.thrust[0])] : [r2(e.thrust[0]), r2(e.thrust[1])],
      bands: e.sides === 1 ? [sideBand(e, 0)] : [sideBand(e, 0), sideBand(e, 1)],
      meanDamage: r2(e.mean),
    };
  }

  /** The drive in numbers, for the console (`__debug.race()`); allocates, never called in a frame. */
  report(v: Vehicle): Record<string, unknown> {
    // A knob moved since the last step: the handling it asks for, as the next step would build it, so the console says
    // what is in force rather than what was.
    if (this.gen !== RACE_GEN.n) this.resolve(v);
    const h = this.handling;
    const r2 = (n: number) => Number(n.toFixed(2));
    const A = thrustA(h.t75);
    const c = speedOf(this.T, h.V, A);
    const b = boostOf(this.B, h.BT, RACE_TUNE.boostHalf);
    return {
      kind: this.kind,
      mode: this.modes ? this.mode : null,
      active: this.active,
      paused: this.paused,
      plannedSteps: this.planned,
      levels: { ...this.levels },
      condition: this.condition,
      handling: { V: r2(h.V), plainTop: r2(this.plainTop()), boostTop: r2(this.boostTop()), cap: r2(h.cap), t75: r2(h.t75), tau: r2(h.tau), turnResponse: r2(h.turnResponse), brake: r2(h.brake), coolSeconds: r2(h.coolSeconds), ride: h.ride, band: h.band },
      T: r2(this.T),
      B: r2(this.B),
      charge: r2(this.charge),
      heat: r2(this.heat),
      boosting: this.boosting,
      overheated: this.locked,
      parts: { curve: r2(c), boost: r2(b), push: r2(this.p), over: r2(this.over) },
      speed: r2(this.h),
      kmh: Math.round(Math.abs(this.h) * 3.6),
      tau: r2(h.tau * this.slideMul),
      yawRate: r2(this.w),
      bank: r2(this.bank),
      lean: r2(this.lean),
      pitch: r2(this.pitch),
      hold: { rule: RACE_TUNE.hold, fall: r2(this.fallNow()), grip: RACE_TUNE.hold === 'firm' ? null : RACE_TUNE.looseGrip, kept: RACE_TUNE.hold === 'firm' ? null : r2(Math.max(0, this.keep)), vy: r2(this.vy) },
      overLine: r2(this.overLine),
      airborne: this.airborne,
      lookAhead: { reach: r2(this.reach), farRayTaken: this.rayTaken, latticeReads: this.ring.reads },
      bridge: { span: r2(this.span), lift: r2(this.bridgeLift), on: RACE_TUNE.bridge },
      slope: { degrees: r2(this.slopeTheta / D2R), push: r2(this.p) },
      lastHit: this.lastHit.kind ? { ...this.lastHit, loss: r2(this.lastHit.loss), drop: r2(this.lastHit.drop), stepsAgo: this.steps - this.lastHit.at } : null,
      hull: r2(v.hp),
      wearFloor: RACE_TUNE.wearFloor,
      engines: this.enginesReport(),
      raceBox: v.spec.raceBox ?? null,
      raceBoxOn: !!v.raceBoxCollider?.isEnabled(),
    };
  }
}

/** The part names the console and the display use: the engine, then top, middle or bottom. */
export function enginePartName(sides: number, i: number): string {
  const engine = sides === 1 ? 'engine' : i < 3 ? 'left engine' : 'right engine';
  return `${engine}, ${['top', 'middle', 'bottom'][i % 3]} part`;
}

/** The drive for a vehicle spawned as a pod or a bike, attached at once (nothing is awaited after `new Vehicle`); null for anything else. */
export function attachRace(v: Vehicle, drive: 'pod' | 'bike' | null, deps: RaceDeps): RaceDrive | null {
  if (!drive) return null;
  const race = new RaceDrive(drive, deps);
  v.race = race;
  return race;
}

/**
 * The rider's throw off a hull blown up under them, written into `vel` (the hull's own velocity as it went): a hull the
 * race drive held is wrecked before its body has slowed, however it came to be wrecked, so the throw is held to
 * `flingMost`, never the hull's own hundreds of metres a second. Any other hull's is left as it is.
 */
export function raceFling(v: Vehicle, vel: THREE.Vector3): THREE.Vector3 {
  if (v.raceDriven && vel.length() > RACE_TUNE.flingMost) vel.setLength(RACE_TUNE.flingMost);
  return vel;
}

/** Whether the hull a drive holds is racing faster than the living's hold asks (`RACE_TUNE.livingAbove`, `holdLiving`). */
export function holdsLiving(v: Vehicle | null): boolean {
  const how = RACE_TUNE.holdLiving;
  if (how === 'never') return false;
  if (!v?.raceDriven || !RACE_TUNE.on) return false;
  if (how === 'always') return true;
  return Math.abs(v.speed) > RACE_TUNE.livingAbove;
}
