// One creature, droid or person from the catalogue, standing in the world: a rotation-locked
// dynamic body shaped from its template and its bind-pose box (shape.ts), a skeleton cloned from
// the shared model and driven by its pack's clips by role (animator.ts), speeds that keep its
// feet from sliding (gait.ts), and a brain that wanders, chases, strikes, shoots, flees or goes
// home (brain.ts), all on the world's simulated clock.
//
// The body exists before the model does: a spawn is never blocked on a download, a bolt can find
// and kill a mobile whose model is still loading, and a body with no model is simply not drawn.
//
// A creature the world shares between players has a second life: **driven**. One browser thinks for
// it and every other one holds the same body with its brain switched off, eased toward what the
// keeper says four times a second and playing the clip its told pace asks for. A driven mobile is
// not a picture -- it has its colliders, it is lifted to the ground, it follows rooms through the
// portals and it is in the one list of the living -- so it can be shot at, swept at, targeted with
// Tab and walked into exactly as one this browser thinks for. What it does not have is a brain, a
// dynamic body or the right to take health off itself: a blow struck here is asked of the keeper
// (`src/net/npcNet.ts`) and the keeper's answer, which arrives as the health in the next batch or
// as the word that it is gone, is what kills it. Taking one over is seamless on purpose: the brain
// starts from where the body is standing, and no pose is reset, because a respawn's pose reset is
// exactly what would make a creature flick as it changed hands.
//
// With no server none of this runs: `driven` is never set, `mine` answers yes for everything, and
// every creature is this browser's own with its damage applied where it lands.
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { combatSounds, type GunSound } from '../../audio/combatSounds';
import { Group, groups, RAPIER, type Physics } from '../../core/physics';
import type { Terrain } from '../terrain';
import { afloatVelocity } from '../afloat.ts';
import type { Bolts } from '../../combat/bolts';
import type { Effects } from '../../combat/effects';
import { GUNS, type GunProfile } from '../../combat/guns';
import { scarFamilyOf } from '../../combat/scars.ts';
import { Ragdoll } from '../../combat/ragdoll';
import { SaberBlade } from '../../combat/saberBlade';
import { boneForRole } from '../../player/rig';
import { BLADE_SWING, MUZZLE_PATTERNS, borrowSwingFigures, noteBladeSwing, returnSwingFigures } from './arms';
import { BLADE_RADIUS, BladePath, type Striker } from '../../combat/sweep';
import { CLASH } from '../../combat/clash.ts';
import { nextLivingKey, PLAYER_KEY, type Aggression, type Hittable, type Living, type Side } from '../../combat/kit';
import { hostileSides, sideOf } from '../../combat/targets';
import { npcNow, NPC_TUNE, type NpcBrain, type NpcMark, type NpcRow, type NpcSubject } from '../../net/npcNet.ts';
import { markActor } from '../portalRender';
import { planBody, radiusToward, type BodyInput, type BodyPlan } from './shape';
import { moveSpeeds, stepGait, type GaitStep } from './gait';
import { BRAIN_TUNE, decide, type BrainSelf, type BrainTarget, type Decision } from './brain';
import { LOD_TUNE, type LodTier } from './lod';
import { NavAgent } from '../nav/navAgent.ts';
import { worldNav } from '../nav/nav.ts';
import type { CellState } from '../layoutStream';
import { MobileAnimator, SHOT_PRIORITY } from './animator';
import { describeRoles, idleClipFor, ownGunIsPistol, rolesFor } from './packClips';
// The fighters' own carry and aim, borrowed whole rather than written a second time: pure, on the
// player's numbers, node-tested, and the bones it wants (`spine1..3`, the hand's weapon joint) are
// exactly the ones a mobile's clone carries. One knob moves a fighter's carry and a mobile's.
import { STANCE_TUNE, aimMode, bodyShare, easeAngle, spineShare, stanceFor, stepAimFix, type AimFix, type AimWhen, type Stance, type StanceInput } from '../fighterStance.ts';
// The spine is collected on the one walk the clone already takes, by the module's own `SPINE_BONE`
// rule, which is why that rule is exported and no second walk is: one home for which bones fold.
import { SPINE_BONE, foldSpine, type FoldRecord } from './spineFold.ts';
import type { PackAsset } from './assets';
import type { CarryWeapon, Gait, MobileEntry, MobileState, Roles, Vec3 } from './types';

export type { MobileState };

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
/**
 * Where a blow off the wire came from. Its own vector rather than one of the two above, because a
 * blow arrives in the middle of a message and `damage` spends `tmp` on the knock it gives.
 */
const blowFrom = new THREE.Vector3();
/** Written into by the driven body every frame; the engine copies out of them at the call. */
const driveAt = { x: 0, y: 0, z: 0 };
const driveTurn = { x: 0, y: 0, z: 0, w: 1 };
const UP = new THREE.Vector3(0, 1, 0);
/** What a blade faces while no camera is given (a headless step). */
const IDLE_CAMERA = new THREE.PerspectiveCamera();
/**
 * The aim's own scratch: three points, module-level and written in place, so that measuring a
 * barrel against a target allocates nothing on a frame with a hundred armed bodies in it.
 */
const aimWant = new THREE.Vector3();
const aimHave = new THREE.Vector3();
const aimGrip = new THREE.Vector3();

/** The body a mobile wears: a plain model's prototype, or a person's dressed look; cloned per mobile. */
export interface MobileBody {
  key: string;
  scene: THREE.Object3D;
}

/** What the pack is played with beyond its own clips and roles: a Jedi's swings off a species rig, a rifle's stance. */
export interface MobileExtras {
  clips?: ReadonlyMap<string, THREE.AnimationClip>;
  roles?: Partial<Roles>;
  /** Which carry row those roles came from, so the body knows what is in its hands. */
  carry?: CarryWeapon;
  /**
   * Whether the pack really carried a row for that weapon, as against the clip-name matching
   * `armedRoles` falls back on. It is what lets the stance choose the clip at all
   * (`IdleSituation.carried`), so a pack nobody has reconverted stands exactly where it did.
   */
  carried?: boolean;
}

/** A weapon off the rack, loaded and prepared, for a person to hold. */
export interface MobileEquipment {
  /** The rack's id, for the console. */
  id: string;
  /** A fresh copy of the rack's model (its materials and geometry are the rack's, never disposed here). */
  model: THREE.Object3D;
  kind: 'gun' | 'saber';
  /** The gun's bolt, for a gun. */
  gun: GunProfile | null;
  /** The model's length along its barrel, for the muzzle. */
  length: number;
  /** Half the hilt's height, where a lightsaber's blade starts. */
  hiltTop: number;
  /** The blade's spec, for a lightsaber. */
  blade: { length: number; width: number; open: number; close: number } | null;
  /** The blade's colour. */
  color: number;
}

/** Collision filters: outdoors everything, a hull ball everything but the terrain, indoors neither the terrain nor the shells. */
const OUTSIDE = groups(Group.all, Group.all);
const HULL_OUTSIDE = groups(Group.all, Group.all & ~Group.terrain);
const INSIDE = groups(Group.all, Group.all & ~(Group.terrain | Group.exterior));

/** The shove a melee blow gives, by size class. */
const BLOW_PUSH = { tiny: 1, small: 3, medium: 6, large: 10, huge: 16 } as const;
/** A creature's spit: speed (m/s), colour, drop, and the acid burn it leaves (share of the blow a second, seconds). */
const SPIT = { speed: 28, color: 0xb8e04a, gravity: 4, size: 1.2, burn: 0.15, burnFor: 3 };
/**
 * INVENTED, from the game's own names: a spitting creature is no weapon any table names, and the
 * game carries exactly two sounds for it, one leaving and one landing. The same sound lands on
 * every surface, since nothing says a mouthful of acid hits stone differently from wood.
 */
const SPIT_SOUND: GunSound = {
  key: 'spit',
  fire: 'sound/cr_spit_fire.snd',
  hit: { creature: 'sound/cr_spit_impact.snd', metal: 'sound/cr_spit_impact.snd', stone: 'sound/cr_spit_impact.snd', wood: 'sound/cr_spit_impact.snd', other: 'sound/cr_spit_impact.snd' },
  miss: { water: null, terrain: 'sound/cr_spit_impact.snd', nothing: null },
  ricochet: null,
  ship: false,
};
/**
 * INVENTED: what a person or droid with nothing off the rack in its hands shoots like. Its bolt is
 * already the game's plain pistol or rifle bolt, and these are the plain pistol and rifle rows of
 * the game's own ranged table, chosen the same way the bolt is.
 */
const OWN_GUN = { pistol: { id: 'npc_pistol', class: 'pistol' }, rifle: { id: 'npc_rifle', class: 'rifle' } };
/** The bone a shot leaves from, in the order tried (arms.ts). */
const MUZZLE_BONES = MUZZLE_PATTERNS;
/** A knock at least this hard (after the size's resistance) knocks it down, when it has the clips. */
const KNOCKDOWN_AT = 14;
/** Seconds a knocked-down body lies before it gets up. */
const KNOCKDOWN_LIE = 1.2;
/** Hit reactions at most this often (seconds). */
const HIT_EVERY = 0.6;
/** How long after death the body is taken away (spawned) or comes back (ambient), seconds. */
const DEAD_FOR = 10;
/** A hologram shrinks away over this long instead of falling. */
const HOLOGRAM_FADE = 0.5;
/**
 * The state words a driven creature may be told it is in. A word from the wire is checked against
 * this before it is kept, since what it chooses is a clip and a gait set: the list is the one in
 * `types.ts` and the server checks it too.
 */
const STATE_WORDS: readonly string[] = ['loading', 'idle', 'wander', 'alert', 'chase', 'attack', 'cover', 'flee', 'return', 'knockdown', 'dying', 'dead'];
/** The stuck check's window (seconds), and the side-step it tries. */
const STUCK_WINDOW = 1.5;
const SIDESTEP = THREE.MathUtils.degToRad(60);

const clamp = THREE.MathUtils.clamp;
/** A cooldown's spread, a tenth either way. */
const jitter = (): number => 0.9 + Math.random() * 0.2;

export interface MobileSpawn {
  entry: MobileEntry;
  x: number;
  y: number;
  z: number;
  heading: number;
  origin: 'spawned' | 'ambient';
  inside: boolean;
  /** The appearance's bind-pose box and the pack's hierarchy, from the catalogue. */
  bounds: { min: Vec3; max: Vec3 };
  hierarchy: BodyInput['hierarchy'];
  /** Else picked in `entry.size.scale`. */
  scale?: number;
  /** The planet's own values, when it is the planet's wildlife. */
  overrides?: { hp?: number; damage?: number; aggression?: Aggression };
}

/** What a mobile needs of the game. */
export interface MobileDeps {
  physics: Physics;
  terrain: Terrain;
  bolts: Bolts;
  /** The effects, once they exist (they arrive with the weapons rack). */
  effects(): Effects | null;
  /** Telling the neighbours who struck. */
  alert(self: Mobile, attacker: Living): void;
  /** The ground under a point, through the physics when inside a building. */
  groundAt(x: number, y: number, z: number, inside: boolean): number | null;
  /**
   * The swell standing over a point whose flat surface the caller already has, so a swimmer rides
   * the waves instead of a plane through the middle of them. Absent, or 0, is a flat sea, which is
   * what a lake, the shallows and a world converted before the sea swelled all are.
   */
  seaSwellAt?(x: number, z: number, flat: number): number;
  /** What a physics collider belongs to, when a carried blade sweeps through it; with none it cuts nobody. */
  hittableAt?(handle: number): Hittable | undefined;
  /** Asking for the ragdoll, which the manager starts a couple a frame. */
  wantRagdoll(self: Mobile): void;
}

export interface MobileContext {
  now: number;
  dt: number;
  camera: THREE.Camera | null;
  playerPos: THREE.Vector3;
  targets: readonly Living[];
}

interface Grudge {
  who: Living;
  at: number;
  total: number;
}

export class Mobile implements Living, NpcSubject {
  /**
   * Its place in the one list of living things, for as long as it lives. A respawn is a new
   * life, so it takes a new key: a brain that remembered this body must not find the fresh one.
   */
  key = nextLivingKey();
  readonly entry: MobileEntry;
  readonly origin: 'spawned' | 'ambient';
  readonly label: string;
  readonly side: Side;
  aggression: Aggression;
  /** Hangs at the body's middle, turned by the heading. */
  readonly group = new THREE.Group();
  /** Hangs at -feet, at the spawn's scale: the model's origin is on the ground. */
  readonly inner = new THREE.Group();
  /** The feet, mirrored from the physics body every frame. */
  readonly pos = new THREE.Vector3();
  readonly body: RAPIER.RigidBody;
  readonly colliders: RAPIER.Collider[] = [];
  readonly plan: BodyPlan;
  readonly scale: number;
  readonly halfHeight: number;
  readonly hologram: boolean;
  hp: number;
  readonly maxHp: number;
  readonly blow: number;
  dead = false;
  deadTimer = 0;
  grounded = true;
  state: MobileState = 'loading';
  ragdoll: Ragdoll | null = null;
  inside: boolean;
  /** The building room it is in (the manager follows it through the portals), 0 outside. */
  room = 0;
  /**
   * The same room as the building it is in, which is what an indoor path is keyed on. The manager
   * writes it beside `room`; null outside, and null for every pack and every planet whose buildings
   * have no rooms, in which case the steering below is exactly what it always was.
   */
  navCell: CellState | null = null;
  /** Its own path: the corners still to walk and the clock that says when to ask for fresh ones. */
  readonly navAgent = new NavAgent();
  /**
   * The way the **feet** go: the direction it travels, the yaw its body is held at and the number
   * that crosses the wire. Everything that has ever read it still means that.
   */
  heading: number;
  /**
   * The way its **weapon** points, which until this wave was the same number. It is read by one
   * rule -- the carry (`stepStance`), which asks how far off its nose its foe is -- and that rule
   * was being told the wrong thing: a body stepping round a rock twists its whole heading sixty
   * degrees for a second, and measured against that the foe went outside the aiming cone and the
   * weapon came down for as long as the step lasted.
   *
   * The drawn body was never fooled, because the aim's own correction measures the **barrel** and
   * not the heading, so it wound the chest back onto the target throughout; only the carry that
   * chose which pose to wind was. So the split here is small and exact: the feet go round the rock
   * and the gun stays up. A creature with nothing in its hands never reaches the rule at all and is
   * bit for bit what it was.
   */
  facing: number;
  /** Where it came from: the leash is measured from here. */
  homeX: number;
  homeZ: number;
  /** The model's meshes, whose shadow flag the manager sets. */
  meshes: THREE.Mesh[] = [];
  model: THREE.Object3D | null = null;
  animator: MobileAnimator | null = null;
  /**
   * The clip pack the animator plays, kept so that what listens to a clip's own event markers can
   * find the animation each clip was baked from (the pack's JSON names the source `.ans` per clip).
   * The asset itself is shared by every mobile using it and is never disposed here.
   */
  animPack: PackAsset | null = null;
  roles: Roles | null = null;
  speeds = { walk: 0, run: 0 };
  /** The tier the manager gave it last, for the console. */
  tier: LodTier | null = null;
  /** Set by the manager while it waits in the ragdoll queue. */
  queued = false;
  /** Seconds left in the hologram's shrink. */
  private fading = 0;
  private disposed = false;
  private now = 0;
  private frame = 0;
  private animAcc = 0;
  /** What the body moves at: what the chosen gait's feet show. */
  private speed = 0;
  /** The acceleration's own progress toward the pace, from which the gait is chosen (never overwritten by the gait). */
  private ramp = 0;
  private readonly gaitOut: GaitStep = { clip: null, timeScale: 1, speed: 0, ramp: 0 };
  /** Where a chase faces this frame, kept rather than made anew. */
  private readonly faceAt = { x: 0, z: 0 };
  private stunned = 0;
  private slowed = 0;
  private dotDps = 0;
  private dotLeft = 0;
  private heldUntil = 0;
  private attackCd = 0;
  private rangedCd = 0;
  private hitCd = 0;
  private swingAt = 0;
  private swingKey: number | null = null;
  /** While a carried blade is live: the simulated second its swing window shuts. */
  private swingUntil = 0;
  /** What this swing has already bitten: one bite per body per swing, as every other blade takes. */
  private readonly hitThisSwing = new Set<Hittable>();
  /** Whether this swing has already been heard landing: one contact sound a swing, not one a frame. */
  private swingSounded = false;
  /** Where its blade was when it was last drawn; its own, never at module scope. */
  private readonly bladePath = new BladePath();
  /** This body behind its own blow: one struct, written each frame, never made in a step. */
  private strike: Striker | null = null;
  /**
   * What its blade is allowed to find: only something alive. The world's lookup names the turrets,
   * the vehicles and another player's hull as well, and the blow this replaces could only ever
   * reach a `Living` -- so a swing beside a parked speeder leaves the speeder alone, and a body
   * already out is not cut again. One arrow for the life of the body, never one a frame.
   */
  private readonly findLiving = (handle: number): Hittable | undefined => {
    const c = this.deps.hittableAt?.(handle);
    if (!c || c.dead || typeof (c as { key?: unknown }).key !== 'number') return undefined;
    return c;
  };
  private shotsLeft = 0;
  private nextShotAt = 0;
  private thinkAt = 0;
  private melee = false;
  private rangedRange = 0;
  private canSwim = false;
  private swimming = false;
  private flyer: boolean;
  private muzzle: THREE.Object3D | null = null;
  /** The weapon in the hand, when it holds one off the rack; its bolt when it is a gun. */
  weapon: string | null = null;
  private gun: GunProfile | null = null;
  private holder: THREE.Group | null = null;
  private blade: SaberBlade | null = null;
  private hiltTop = 0.13;
  /**
   * Which carry row its roles came from, and which of the three carries it stands in this instant.
   * `unarmed` and `relaxed` are what a creature, a driven body and anything holding nothing are,
   * and between them they mean every branch below is skipped.
   */
  private carry: CarryWeapon = 'unarmed';
  /**
   * Whether that carry came from a real row in the pack, which is what lets the stance pick the
   * clip. False on every pack converted before the rows, and then the stance is worked out and
   * reported but changes nothing a body stands in -- see `IdleSituation.carried`.
   */
  private carried = false;
  private stance: Stance = 'relaxed';
  /**
   * Whether the spine may be folded toward what it is shooting at: only for a body whose pack
   * really carries an aimed pose for the weapon in its hands.
   *
   * It is a gate and not an optimisation. A pack that has never been reconverted holds a blaster
   * carrier in the plain breathing loop with the gun at its hip, and folding the chest until that
   * hip-held barrel pointed at a target would lean the body back by tens of degrees -- a pose
   * nobody authored and nothing would recognise. With an aimed loop the barrel already points
   * roughly where the body faces, the correction is small, and folding it is the whole point.
   */
  private canAim = false;
  /** The simulated second the combat carry lapses, `STANCE_TUNE.ready` after its last live foe. */
  private readyUntil = -Infinity;
  /** Seconds since its last shot: the recoil window the aim is **held** through, as the player's is. */
  private sinceShot = Infinity;
  /** The measured aim correction, and how much of it the drawn body has eased onto. */
  private readonly aimFix: AimFix = { yaw: 0, pitch: 0 };
  private aimTurn = 0;
  /** The two structs the stance and the aim are asked through, written and never made. */
  private readonly stanceAsk: StanceInput = { gun: false, combat: false, hasTarget: false, gap: 0, range: 0, offNose: 0 };
  private readonly aimAsk: AimWhen = { aiming: false, sinceShot: 0, stunned: false };
  /** The spine bones the fold is spread over, found once when the model is hung; empty for a body with none. */
  private spines: THREE.Bone[] | null = null;
  /** What the fold last wrote on each of them, so it never folds on top of its own last turn. */
  private readonly folded = new Map<THREE.Bone, FoldRecord>();
  private readonly bladeBase = new THREE.Vector3();
  private readonly bladeTip = new THREE.Vector3();
  private readonly restPose = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }>();
  private readonly memory = new Map<number, Grudge>();
  /** The last mind a keeper said this creature had, kept until this browser is asked to take it on. */
  private heldBrain: NpcBrain | null = null;
  /** A target named by a keeper, waiting for a list of the living to be looked up in. */
  private wantTarget: string | null = null;
  private targetKey: number | null = null;
  private targetRef: Living | null = null;
  private decision: Decision | null = null;
  private wanderAt = -1;
  private goal: { x: number; z: number } | null = null;
  private until = 0;
  private blockedSince: number | null = null;
  private forgetKey: number | null = null;
  private forgetUntil = 0;
  private stuck = 0;
  private stuckClock = 0;
  private stuckCommanded = 0;
  private readonly stuckFrom = new THREE.Vector3();
  private sidestepUntil = 0;
  private sidestep = 0;
  private waterAhead = false;
  /** Knocked down: falling, lying, getting up, or not at all. */
  private downPhase: 'fall' | 'lie' | 'up' | null = null;
  private downUntil = 0;
  private readonly brainTargets: BrainTarget[] = [];
  /** The objects `brainTargets` is filled from, reused every thought. */
  private readonly brainPool: BrainTarget[] = [];
  /**
   * The id every browser knows this creature by, when it is one of the world's; empty while it is
   * this browser's alone, which is every creature with no server and everything a console stood.
   */
  private shared = '';
  /** Another browser thinks for it: no brain, no dynamics, and no health taken off here. */
  private driven = false;
  /** Where the keeper says it is, and how it faces: what the ease walks toward. */
  private readonly toldAt = new THREE.Vector3();
  private toldHeading = 0;
  private toldSpeed = 0;
  private toldState: MobileState = 'idle';
  /** Whether anything has been said about it yet: the first word is arrived at, not eased toward. */
  private toldOnce = false;
  /** Something this browser owes the wire about it while it keeps it: it was struck, it was thrown. */
  private mark: NpcMark | null = null;

  constructor(spawn: MobileSpawn, private readonly deps: MobileDeps) {
    const e = spawn.entry;
    this.entry = e;
    this.origin = spawn.origin;
    const [lo, hi] = e.size?.scale ?? [1, 1];
    this.scale = spawn.scale ?? (lo > 0 ? lo + Math.random() * Math.max(0, hi - lo) : 1);
    this.plan = planBody({
      hierarchy: spawn.hierarchy,
      flags: e.flags ?? [],
      bounds: spawn.bounds,
      collisionRadius: e.size?.collisionRadius ?? 0.5,
      collisionLength: e.size?.collisionLength ?? 1.5,
      stepHeight: e.size?.stepHeight ?? 0.5,
      swimHeight: e.size?.swimHeight ?? 1,
      sizeClass: e.stats?.sizeClass ?? 'small',
      scale: this.scale,
    });
    this.halfHeight = this.plan.halfHeight;
    this.hologram = (e.flags ?? []).includes('hologram');
    this.flyer = this.plan.hover > 0;
    this.label = e.name;
    this.side = sideOf(e);
    this.aggression = this.hologram ? 'passive' : (spawn.overrides?.aggression ?? e.stats?.aggression ?? 'defensive');
    this.maxHp = spawn.overrides?.hp ?? e.stats?.hp ?? 80;
    this.hp = this.maxHp;
    this.blow = spawn.overrides?.damage ?? e.stats?.damage ?? 8;
    this.heading = spawn.heading;
    this.facing = spawn.heading;
    this.homeX = spawn.x;
    this.homeZ = spawn.z;
    this.inside = spawn.inside;

    const feet = this.plan.feet;
    tmpQ.setFromAxisAngle(UP, this.heading);
    const w = deps.physics.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y + feet + 0.05, spawn.z)
        .setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w })
        .lockRotations()
        .setLinearDamping(0.6)
        .setAngularDamping(2.5),
    );
    for (const c of this.plan.colliders) {
      const desc = c.shape === 'ball' ? RAPIER.ColliderDesc.ball(c.radius) : RAPIER.ColliderDesc.capsule(c.half, c.radius);
      desc.setTranslation(c.at[0], c.at[1], c.at[2]).setMass(Math.max(0.5, c.mass)).setFriction(0.8).setCollisionGroups(this.groupsFor(c.terrain));
      this.colliders.push(w.createCollider(desc, this.body));
    }
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.group.position.set(spawn.x, spawn.y + feet, spawn.z);
    this.group.quaternion.copy(tmpQ);
    this.inner.position.y = -feet;
    this.inner.scale.setScalar(this.scale);
    this.group.add(this.inner);
    this.group.name = `mobile:${e.id}`;
    markActor(this.group);
  }

  private groupsFor(terrain: boolean): number {
    if (this.inside) return INSIDE;
    return terrain ? OUTSIDE : HULL_OUTSIDE;
  }

  /** Whether the model has been hung on the body. */
  get ready(): boolean {
    return !!this.model;
  }

  /** Whether it has been taken out of the world. */
  get removed(): boolean {
    return this.disposed;
  }

  /** In a building or out: the colliders' filters and the ground check follow it through a door. */
  setInside(inside: boolean): void {
    if (this.inside === inside || this.disposed) return;
    this.inside = inside;
    this.plan.colliders.forEach((c, i) => this.colliders[i]?.setCollisionGroups(this.groupsFor(c.terrain)));
  }

  /**
   * Hang the model on the body: a clone of the prepared prototype, its rest pose saved before
   * anything plays (a pack clip may carry no track for a joint that never leaves it), the idle
   * playing. Refused, leaving the group empty, when the mobile died or was taken away while its
   * model loaded; the caller then releases what it acquired. Returns a warning when the pack's
   * tracks mostly bind to nothing in this skeleton.
   */
  attach(model: MobileBody, pack: PackAsset | null, extras?: MobileExtras): { ok: boolean; warning: string | null } {
    if (this.disposed || this.dead) return { ok: false, warning: null };
    const scene = cloneSkeleton(model.scene);
    const names = new Set<string>();
    const spines: THREE.Bone[] = [];
    scene.traverse((o) => {
      names.add(o.name);
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        this.meshes.push(m);
        // Culled as a whole by the manager, never mesh by mesh (a mesh's own sphere would be in its own frame).
        m.frustumCulled = false;
      }
      if ((o as THREE.Bone).isBone) {
        this.restPose.set(o, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });
        // Found on the one walk the clone already takes, rather than on a walk of its own: this
        // runs once per body and the aim then costs a list lookup a frame.
        if (SPINE_BONE.test(o.name)) spines.push(o as THREE.Bone);
      }
    });
    this.spines = spines;
    this.carry = extras?.carry ?? 'unarmed';
    this.carried = !!extras?.carried;
    markActor(scene);
    this.inner.add(scene);
    this.model = scene;
    let warning: string | null = null;
    if (pack) {
      this.roles = rolesFor(pack.json, this.entry.gender);
      // The pack's own ranged attack, kept before the carry is laid over it: it is what a row whose
      // clips the bake left out falls back on, below.
      const ownRanged = this.roles.ranged;
      const ownAdditive = this.roles.rangedAdditive;
      // A rifle's carry, a Jedi's swings: laid over the pack's roles, with any clips they name.
      if (extras?.roles) Object.assign(this.roles, extras.roles);
      const clips = extras?.clips?.size ? new Map([...pack.clips, ...extras.clips]) : pack.clips;
      const animator = new MobileAnimator(scene, clips, pack.additive);
      this.animator = animator;
      this.animPack = pack;
      const probe = pack.clips.get(this.roles.idle ?? '') ?? pack.clips.values().next().value;
      if (probe && probe.tracks.length) {
        let unbound = 0;
        for (const t of probe.tracks) if (!names.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName ?? '')) unbound++;
        if (unbound > probe.tracks.length / 10) warning = `pack ${pack.id} does not fit model ${model.key}: ${unbound} of ${probe.tracks.length} tracks bind to nothing`;
      }
      const r = this.roles;
      this.speeds = moveSpeeds(r, this.scale, this.entry.move);
      this.melee = (this.flyer && r.hoverAttacks.length ? r.hoverAttacks : r.attacks).length > 0;
      // The aimed pose the fold is only meaningful over, and the GLB really having it: a pack whose
      // carry row names one the bake left out would otherwise fold a body over a clip that is not
      // there. Read once, here, rather than on every frame of every armed body.
      this.canAim = !!r.rangedAimed && animator.has(r.rangedAimed);
      // And the shots, for the same reason and once for the same cost: a row says what the animation
      // table holds, not what the bake wrote, so a name the bake left out would be a shot that plays
      // nothing at all. What the GLB has is kept; with none of them left the pack's own ranged
      // attack comes back, recoil and all, which is what a pack with no rows plays anyway.
      if (r.rangedShots?.length) {
        const have = r.rangedShots.filter((c) => animator.has(c));
        r.rangedShots = have.length ? have : undefined;
      }
      if (r.ranged && !animator.has(r.ranged)) {
        r.ranged = r.rangedShots?.[0] ?? ownRanged;
        r.rangedAdditive = r.rangedShots?.length ? false : ownAdditive;
      }
      // Only what the catalogue gives a ranged attack shoots: a pack with a ranged clip is not enough.
      const ranged = this.entry.stats?.ranged;
      this.rangedRange = r.ranged && !this.hologram && ranged && ranged.range > 0 ? ranged.range * Math.max(1, Math.sqrt(this.scale)) : 0;
      this.canSwim = !!(r.swim || r.swimIdle);
      if (this.entry.flags?.includes('static')) this.speeds = { walk: 0, run: 0 };
      // Nothing to strike or shoot with: passive, whatever the keywords say.
      if (!this.melee && !this.rangedRange) this.aggression = 'passive';
    } else this.aggression = 'passive';
    for (const re of MUZZLE_BONES) {
      scene.traverse((o) => {
        if (!this.muzzle && (o as THREE.Bone).isBone && re.test(o.name)) this.muzzle = o;
      });
      if (this.muzzle) break;
    }
    this.state = 'idle';
    this.animator?.loop(this.idleNow(), 1, 0);
    return { ok: true, warning };
  }

  /**
   * Put a weapon off the rack in the right hand, as a fighter holds one: on the skeleton's weapon
   * joint (`hold_r`), at world size whatever the body's scale. A gun's shots then leave from its
   * muzzle with its own bolt; a lightsaber's hilt lies along the body's forward, as the game's
   * clips hold it, and its blade is drawn from the hilt's top while the mobile is fighting. False
   * when the body has no hand, or has gone.
   */
  equip(e: MobileEquipment): boolean {
    if (this.disposed || this.dead || !this.model || this.holder) return false;
    const bones = new Map<string, THREE.Bone>();
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    });
    const hand = boneForRole(bones, 'rightHand');
    if (!hand) return false;
    this.group.updateMatrixWorld(true);
    const holder = new THREE.Group();
    holder.name = `mobile weapon:${e.id}`;
    holder.add(e.model);
    holder.scale.setScalar(1 / Math.max(hand.getWorldScale(tmp).x, 1e-6));
    hand.add(holder);
    markActor(holder);
    e.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      this.meshes.push(m);
    });
    this.holder = holder;
    this.weapon = e.id;
    if (e.kind === 'saber') {
      tmp.set(0, 0, 1).applyQuaternion(this.model.getWorldQuaternion(tmpQ));
      tmp.applyQuaternion(hand.getWorldQuaternion(tmpQ).invert()).normalize();
      holder.quaternion.setFromUnitVectors(UP, tmp);
      this.hiltTop = e.hiltTop;
      const blade = new SaberBlade();
      blade.setColor(e.color);
      if (e.blade) blade.spec = { ...e.blade };
      this.group.parent?.add(blade.group);
      markActor(blade.group);
      this.blade = blade;
      // A blade is for closing in: no shots from the hand that holds it.
      this.rangedRange = 0;
    } else {
      this.gun = e.gun;
      const muzzle = new THREE.Object3D();
      muzzle.name = 'muzzle';
      muzzle.position.set(0, 0, e.length * 0.55);
      holder.add(muzzle);
      this.muzzle = muzzle;
    }
    return true;
  }

  /** The lit blade follows the hilt: drawn while it fights, retracted otherwise; hidden with the body. */
  private updateBlade(dt: number, camera: THREE.Camera | null): void {
    const b = this.blade;
    const h = this.holder;
    if (!b || !h) return;
    const shown = this.group.visible && !this.ragdoll;
    b.group.visible = shown;
    if (!shown) return;
    h.updateWorldMatrix(true, false);
    h.localToWorld(this.bladeBase.set(0, this.hiltTop, 0));
    h.localToWorld(this.bladeTip.set(0, this.hiltTop + b.spec.length, 0));
    const on = !this.dead && this.fighting();
    // A swing is live from the moment the clip's blow would have landed until its window shuts, so
    // the smear, the clashes and the sweep below all read the one answer.
    const swinging = this.swingAt > 0 || this.now < this.swingUntil;
    // Whose blade it is when it meets another, and what it weighs (src/combat/clash.ts). Without
    // this it owns nobody, and two blades that own nobody never clash with each other.
    b.owner = this.key;
    b.attacking = swinging;
    b.clashWeight = CLASH.weights.medium;
    b.update(dt, this.bladeBase, this.bladeTip, on, camera ?? IDLE_CAMERA, swinging ? 1 : this.speed > 0.5 ? 0.3 : 0, this.dead);
    // Swinging, the blade cuts what it has passed through since the last frame; standing, it only
    // writes down where it is, so the first cut of the next swing steps from the blade itself. A
    // driven body (another browser thinks for it) never swings here: its keeper's blow crosses.
    if (this.driven || this.dead || !this.deps.hittableAt) return;
    if (this.now >= this.swingUntil) {
      this.bladePath.mark(this.bladeBase, this.bladeTip, this.now);
      return;
    }
    const strike = (this.strike ??= { physics: this.deps.physics, hittableAt: this.findLiving, effects: null, source: this, from: this.pos, exclude: this.body, spare: null, radius: BLADE_RADIUS, damage: this.blow, push: 3, color: b.color.getHex(), now: 0 });
    strike.effects = this.deps.effects();
    strike.damage = this.blow;
    strike.push = BLOW_PUSH[this.entry.stats?.sizeClass ?? 'small'] ?? 3;
    strike.color = b.color.getHex();
    strike.now = this.now;
    // The player's readout (`SABER_HIT_STATS`) is one shared record and this blade is swept at a
    // different simulated second of the same drawn frame, so it is borrowed and put back rather
    // than written into. The `finally` is what keeps a throw inside the query from leaving the
    // player's own figures holding this swing for good.
    let hits = 0;
    borrowSwingFigures(this.now);
    try {
      hits = this.bladePath.sweep(strike, this.bladeBase, this.bladeTip, this.hitThisSwing);
    } finally {
      returnSwingFigures(this.now);
    }
    // One sound a swing, not one a frame: a swing that catches three bodies over three of its
    // frames is one blow landing, exactly as the instant blow it replaces was.
    if (hits > 0 && !this.swingSounded) {
      this.swingSounded = true;
      tmp2.copy(this.bladeBase).lerp(this.bladeTip, 0.5);
      combatSounds.saberContact('body', tmp2.x, tmp2.y, tmp2.z);
    }
  }

  /** The blade renderer while it lives and holds a lightsaber: the blade glow reads its light from it, as from a fighter's. */
  get saber(): SaberBlade | null {
    return this.dead ? null : this.blade;
  }

  /** The middle of the lit blade, when there is one out this frame (igniting, lit or retracting), as `Npc.glowAt`. */
  glowAt(out: THREE.Vector3): boolean {
    const b = this.blade;
    if (this.dead || !b?.glowing) return false;
    out.copy(b.drawnBase).lerp(b.drawnTip, 0.5);
    return true;
  }

  /** The blade's white core while it is drawn, for the depth of field's glow depth; returns the new count. */
  glowCore(out: THREE.Object3D[], n: number): number {
    return this.blade ? this.blade.glowCore(out, n) : n;
  }

  /** The blade's colour, for the pooled light it borrows. */
  get bladeColor(): number {
    return this.blade ? this.blade.color.getHex() : 0xffffff;
  }

  radiusToward(from: THREE.Vector3): number {
    return radiusToward(this.plan, this.heading, from.x - this.pos.x, from.z - this.pos.z);
  }

  /** Whether it is in a one-shot, dying, or attacking: the tiers never freeze it. */
  get busy(): boolean {
    return this.dead || !!this.animator?.busy || this.swingAt > 0 || this.shotsLeft > 0 || this.state === 'attack';
  }

  // ---- one of the world's creatures ----------------------------------------------------------------
  //
  // Everything from here to `stepDriven` is the `NpcSubject` the wire talks to (src/net/npcNet.ts).
  // A creature with no id is not one of the world's and none of it ever runs: that is every creature
  // in a game with no server, and everything stood from the console.

  /** Make it one of the world's, by the id every browser knows it by. Said once, when it is stood. */
  shareAs(id: string): void {
    this.shared = id;
  }

  /** The id every browser knows it by, or an empty string while it is this browser's alone. */
  get npcId(): string {
    return this.shared;
  }

  get npcDead(): boolean {
    return this.dead;
  }

  /** Another browser thinks for it. */
  get isDriven(): boolean {
    return this.driven;
  }

  /**
   * One of the world's while a server is holding the world: every browser on it has a copy of this
   * creature under the same name, whoever is thinking for it just now. It is asked rather than
   * stored because a creature can be one of the world's before the line is up and after it drops,
   * and with no server it is false for everything, which is the game played alone.
   */
  private get sharedLive(): boolean {
    return !!this.shared && (npcNow()?.active ?? false);
  }

  /**
   * Where it is and what it is doing, for the keeper's batch. False while there is nothing worth
   * saying: a body whose model has not landed has not moved and has nothing to play.
   */
  npcFill(row: NpcRow): boolean {
    if (this.disposed || this.state === 'loading') return false;
    row.p[0] = this.pos.x;
    row.p[1] = this.pos.y;
    row.p[2] = this.pos.z;
    row.h = this.heading;
    row.s = this.state;
    row.v = this.speed;
    row.hp = this.maxHp > 0 ? Math.max(0, this.hp) / this.maxHp : 0;
    // A thing that happened once is said once: it is taken as it is handed over, so a batch that is
    // sent says it and the next one does not.
    if (this.mark) {
      row.f = this.mark;
      this.mark = null;
    }
    // What it is thinking, so whoever takes it over next does not start it over. Written only when
    // there is something to say: a creature standing about with nothing on its mind costs no bytes.
    const t = this.targetRef;
    const target = t ? (t.key === PLAYER_KEY ? 'p' : ((t as { npcId?: string }).npcId ?? '')) : '';
    if (target || this.stunned > 0 || this.slowed > 0 || this.dotLeft > 0 || this.goal) {
      const b: NpcBrain = {};
      if (target) b.t = target;
      if (this.stunned > 0) b.st = Math.round(this.stunned * 100) / 100;
      if (this.slowed > 0) b.sl = Math.round(this.slowed * 100) / 100;
      if (this.dotLeft > 0) {
        b.bd = Math.round(this.dotDps * 100) / 100;
        b.bs = Math.round(this.dotLeft * 100) / 100;
      }
      if (this.goal) {
        b.gx = Math.round(this.goal.x * 100) / 100;
        b.gz = Math.round(this.goal.z * 100) / 100;
      }
      row.b = b;
    } else row.b = undefined;
    return true;
  }

  /**
   * Take on a mind handed over by whoever was keeping this creature.
   *
   * What cannot be carried is handled rather than dropped: a target named by an id this browser has
   * never built simply is not found, and the creature picks a fight of its own on its next thought
   * instead of standing still waiting for somebody who is not here.
   */
  private adoptBrain(b: NpcBrain): void {
    if (b.st && b.st > 0) this.stunned = Math.max(this.stunned, b.st);
    if (b.sl && b.sl > 0) this.slowed = Math.max(this.slowed, b.sl);
    if (b.bd && b.bs && b.bs > 0) {
      this.dotDps = b.bd;
      this.dotLeft = b.bs;
    }
    if (typeof b.gx === 'number' && typeof b.gz === 'number') this.goal = { x: b.gx, z: b.gz };
    // The target waits for the next thought, because the list of what is alive is handed to this
    // creature a frame at a time and is not its to ask for.
    this.wantTarget = b.t ?? null;
  }

  /**
   * Find the thing a handed-over mind was fighting, now that there is a list to look in.
   *
   * Not finding it is an ordinary answer rather than a fault: the other browser may have been
   * fighting something this one has never built. The creature then picks its own fight on this very
   * thought instead of standing about waiting for somebody who is not here.
   */
  private takeWantedTarget(targets: readonly Living[]): void {
    const want = this.wantTarget;
    this.wantTarget = null;
    if (!want) return;
    for (const t of targets) {
      const mine = want === 'p' ? t.key === PLAYER_KEY : (t as { npcId?: string }).npcId === want;
      if (!mine || t.dead) continue;
      this.targetRef = t;
      this.targetKey = t.key;
      return;
    }
  }

  /**
   * What the keeper says. Nothing here is jumped to: the place and the heading are walked toward in
   * `stepDriven` at the same tenth of a second every other glide in this game uses. `snap` is the
   * first word about it, where there is nothing to walk from -- a body stood from a spawn record
   * would otherwise cross the world from its spawn point at walking pace.
   */
  npcDrive(row: NpcRow, snap: boolean): void {
    if (this.disposed || this.dead) return;
    // Kept, not applied: a driven copy thinks nothing, so its mind is only worth having at the
    // moment this browser is asked to take it over. Holding the last one said is what makes that
    // moment cost nothing and need no extra word on the wire.
    if (row.b) this.heldBrain = row.b;
    this.toldAt.set(row.p[0], row.p[1], row.p[2]);
    this.toldHeading = row.h;
    this.toldSpeed = row.v;
    if (STATE_WORDS.includes(row.s)) this.toldState = row.s as MobileState;
    // The keeper's number, not a number worked out here: this is the only thing that moves a driven
    // creature's health, and it is why a browser cannot come to disagree about how hurt one is.
    this.hp = Math.max(0, Math.min(this.maxHp, row.hp * this.maxHp));
    if (snap || !this.toldOnce) {
      this.toldOnce = true;
      this.placeAt(this.toldAt.x, this.toldAt.y, this.toldAt.z, row.h);
    }
    if (row.f) this.sawMark(row.f);
  }

  /**
   * Something that had to be seen once: it was struck, and it left the ground.
   *
   * A death is not one of them and never arrives here. It has a word of its own, which reaches this
   * body as `npcEnd`, and two ways to say one death would be two paths for the same thing.
   */
  private sawMark(mark: NpcMark): void {
    if (mark === 'hit') {
      this.flinch(0.1);
      return;
    }
    // 'leap': it left the ground. The ease carries the arc, since where it is is said four times a
    // second and it is the place that matters; what this says is that it is not walking.
    this.grounded = false;
  }

  /**
   * Whether another browser thinks for it. Called only when the answer changes, and seamless both
   * ways: giving it up eases from where it stands, and taking it over starts the brain from where
   * the body is, with nothing reset and no pose put back -- a pose reset here is exactly the flick
   * that would say "this creature just changed hands".
   */
  npcSetDriven(driven: boolean): void {
    if (this.driven === driven || this.disposed) return;
    this.driven = driven;
    const live = this.body.isValid();
    if (driven) {
      this.toldAt.copy(this.pos);
      this.toldHeading = this.heading;
      this.toldSpeed = this.speed;
      this.toldState = this.state === 'loading' ? 'loading' : this.state;
      this.toldOnce = false;
      // Nothing of its own is under way any more: a swing part way through would land on a target
      // this browser is no longer thinking about, and a burst would go on firing bolts nobody else
      // can see.
      this.targetKey = null;
      this.targetRef = null;
      this.decision = null;
      this.goal = null;
      this.swingAt = 0;
      // The blade stops cutting here as well: from now on the keeper's browser lands its blows.
      this.swingUntil = 0;
      this.shotsLeft = 0;
      this.dotLeft = 0;
      this.slowed = 0;
      this.stunned = 0;
      this.heldUntil = 0;
      // And the aim, which nothing steps for a driven body: left folded, the chest would keep the
      // turn it had at the moment it changed hands for as long as it was somebody else's.
      this.dropAim();
      // Out of the solver. A dynamic body nobody is steering would fall, drift and be shoved about
      // between the keeper's words; kinematic, it goes exactly where it is told and still stops a
      // bolt, holds a blade and blocks a walker.
      if (live) this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      return;
    }
    // Ours again, from where it stands.
    if (live) {
      this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setGravityScale(this.flyer || this.swimming ? 0 : 1, true);
    }
    this.state = this.state === 'loading' ? 'loading' : this.dead ? this.state : 'idle';
    // It thinks at once rather than standing still for a think's worth of seconds, and the stuck
    // check starts again: the ground it covered while it was driven is not its own walking.
    this.thinkAt = 0;
    this.wanderAt = -1;
    this.stuck = 0;
    this.stuckClock = 0;
    this.stuckCommanded = 0;
    this.ramp = this.speed;
    // And its mind, as the last keeper left it. Without this a creature changes hands and forgets
    // what it was fighting, where it was going and everything on it -- so a bantha being led away
    // from a fight by a stun would shrug the stun off at the boundary and walk back into it.
    if (this.heldBrain) {
      this.adoptBrain(this.heldBrain);
      this.heldBrain = null;
    }
  }

  /**
   * A blow somebody else struck, handed over by the wire. It is only ever called on the browser that
   * keeps this creature, so it goes through the ordinary path: the grudge, the pack's alert, the
   * health and the death are all worked out exactly as they are for a blow struck here.
   */
  npcHurt(amount: number, x: number, y: number, z: number, source: Living | null, _what = ''): void {
    if (this.dead || this.disposed || this.driven) return;
    blowFrom.set(x, y, z);
    // No push: what struck is somebody else's bolt or blade and nothing on the wire says how hard
    // it shoves. The health and the flinch are what cross.
    this.damage(amount, blowFrom, 0, source);
  }

  /** The keeper says it is gone: it died there, or it was taken out of the world. */
  npcEnd(why: 'dead' | 'gone'): void {
    if (this.disposed) return;
    if (why === 'dead') {
      if (!this.dead) this.die();
      return;
    }
    // Taken away rather than killed: it is spent, and the manager takes the body down on its next
    // pass, which is the one place a mobile is ever removed.
    this.dead = true;
    this.hp = 0;
    this.deadTimer = 0;
    this.state = 'dead';
  }

  /** Put exactly there, body and picture together: the first word about a driven creature, and a lift. */
  private placeAt(x: number, y: number, z: number, heading: number): void {
    this.pos.set(x, y, z);
    this.heading = heading;
    // Put exactly there means exactly there: a body set down, lifted or first heard of from another
    // browser has its weapon pointed the way its feet are and no lean left over from before.
    this.facing = heading;
    tmpQ.setFromAxisAngle(UP, heading);
    this.group.position.set(x, y + this.plan.feet, z);
    this.group.quaternion.copy(tmpQ);
    if (!this.body.isValid()) return;
    this.body.setTranslation({ x, y: y + this.plan.feet, z }, true);
    this.body.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }, true);
  }

  private remember(source: Living, amount: number): void {
    if (this.aggression === 'passive' || source.key === this.key) return;
    const g = this.memory.get(source.key);
    if (g) {
      g.at = this.now;
      g.total += amount;
      g.who = source;
    } else this.memory.set(source.key, { who: source, at: this.now, total: amount });
  }

  /** Told by a neighbour of its group that `attacker` struck: it remembers them too. */
  provoke(attacker: Living): void {
    if (this.dead || this.disposed) return;
    this.remember(attacker, 0);
  }

  damage(amount: number, from?: THREE.Vector3, push = 0, source?: Living | null): void {
    if (this.dead || this.disposed) return;
    // Allies do not hurt each other: a shot or a swing from its own side, from one that would never
    // pick a fight with it, passes it by. Without this a pack firing at the player through its own
    // ring turned on itself and feuded for the rest of the fight. It is asked before the blow is
    // handed anywhere, so a blow that could never land is never put on the wire either.
    if (source && source.key !== this.key && source.side === this.side && !hostileSides(source, this)) return;
    // Another browser thinks for it: the blow is asked of that browser and nothing is taken off
    // here. Its health comes back in the keeper's next batch, and if that blow finished it the word
    // that it is gone comes with it. Nothing here may ever subtract from something it does not keep,
    // or two browsers would hold two different creatures under one name.
    // Whether the player of this browser struck it is the only thing about who struck that can
    // cross: it is the one person the browser at the other end can name. A creature of this
    // browser's, an NPC fighter of its or a turret of its is nobody over there, and sent under this
    // player's name the keeper's creature -- and, through its pack's alert, everything standing with
    // it -- would turn on a player who never touched it.
    if (this.driven && this.shared && npcNow()?.askHit(this.shared, amount, this.pos.x, this.pos.y + this.halfHeight, this.pos.z, '', source?.key === PLAYER_KEY)) return;
    if (source && source.key !== this.key) {
      this.remember(source, amount);
      this.deps.alert(this, source);
    }
    this.hp -= amount;
    // Something everyone else has to see once: what they are told is that it was struck, and their
    // own copy flinches with the same clip this one is about to play.
    this.mark = 'hit';
    if (this.hp <= 0) {
      this.die();
      return;
    }
    // A flinch, shorter the bigger it is: a repeater must not pin a krayt dragon in place.
    this.stunned = Math.max(this.stunned, 0.15 * Math.min(1, this.plan.knockResist));
    this.flinch(amount / this.maxHp);
    if (from && push > 0) {
      tmp.copy(this.pos).sub(from).setY(0);
      if (tmp.lengthSq() > 1e-8) this.knock(tmp.normalize(), push);
    }
  }

  /** The hit reaction: now and then, never over an attack, and none for a hologram. */
  private flinch(share: number): void {
    if (!this.animator || this.hologram || this.hitCd > 0 || this.animator.shotLevel >= SHOT_PRIORITY.attack || this.downPhase) return;
    const r = this.roles;
    if (!r) return;
    const clip = this.entry.kind === 'creature' && share > 0.2 && r.hitHeavy ? r.hitHeavy : share < 0.08 ? (r.hitLight ?? r.hitMedium) : (r.hitMedium ?? r.hitLight);
    if (this.animator.once(clip, { priority: SHOT_PRIORITY.hit, fadeIn: 0.06, fadeOut: 0.2 }) !== null) this.hitCd = HIT_EVERY;
  }

  knock(dir: THREE.Vector3, power: number): void {
    // Driven from elsewhere: where it goes is the keeper's to say, and a shove written into a
    // kinematic body here would be undone by the next word about it anyway.
    if (this.dead || this.disposed || this.driven) return;
    const k = power * this.plan.knockResist;
    // A strong shove throws it up as well; a bolt's nudge does not make it hop.
    const lift = k >= 6 ? Math.max(k * 0.55, 2) : k * 0.25;
    if (k >= 6) this.body.setLinvel({ x: dir.x * k, y: lift, z: dir.z * k }, true);
    else {
      // A nudge is added to how it moves, not put in its place: a bolt must not zero a big body's run.
      const v = this.body.linvel();
      this.body.setLinvel({ x: v.x + dir.x * k, y: Math.max(v.y, lift), z: v.z + dir.z * k }, true);
    }
    this.stunned = Math.max(this.stunned, Math.min(0.8, 0.1 * k));
    if (lift > 1) {
      this.grounded = false;
      // Off the ground: the ease on every other browser would walk it along the floor, so this is
      // one of the things they are told happened rather than left to work out.
      this.mark = 'leap';
    }
    if (k >= KNOCKDOWN_AT && this.roles?.knockdown && this.animator && !this.downPhase) {
      const d = this.animator.once(this.roles.knockdown, { hold: true, priority: SHOT_PRIORITY.down, onEnd: () => this.lieDown() });
      if (d !== null) {
        this.downPhase = 'fall';
        this.state = 'knockdown';
        this.swingAt = 0;
        // A body on its way to the floor cuts nothing more: the window shuts with the swing.
        this.swingUntil = 0;
        this.shotsLeft = 0;
      }
    }
  }

  private lieDown(): void {
    if (this.dead || this.downPhase !== 'fall') return;
    this.downPhase = 'lie';
    this.downUntil = this.now + KNOCKDOWN_LIE;
    this.animator?.loop(this.roles?.knockdownLoop ?? this.roles?.downLoop ?? null, 1, 0.1);
    this.animator?.stopShot(0.15);
  }

  private getUp(): void {
    this.downPhase = 'up';
    const d = this.animator?.once(this.roles?.knockdownGetUp ?? this.roles?.getUp ?? null, { priority: SHOT_PRIORITY.down, onEnd: () => this.stoodUp() }) ?? null;
    if (d === null) this.stoodUp();
  }

  private stoodUp(): void {
    if (this.dead) return;
    this.downPhase = null;
    this.state = 'idle';
    this.stunned = 0;
    this.animator?.loop(this.idleNow(), 1, 0.2);
  }

  holdAt(point: THREE.Vector3, dt: number): void {
    // Held by the Force is a thing done to a body, and a driven one is not this browser's body to
    // move: the power fires and the creature goes on walking wherever its keeper says.
    if (this.dead || this.disposed || this.driven || !this.plan.canHold) return;
    this.heldUntil = this.now + Math.max(0.05, dt * 3);
    this.stunned = Math.max(this.stunned, 0.3);
    this.grounded = false;
    // A spring toward the point, damped: it settles there and hangs.
    tmp.copy(point).sub(this.pos);
    const k = Math.min(12, 1 / Math.max(dt, 1e-3));
    this.body.setGravityScale(1, false);
    this.body.setLinvel({ x: tmp.x * k * 0.5, y: tmp.y * k * 0.5 + 0.5, z: tmp.z * k * 0.5 }, true);
  }

  release(dir: THREE.Vector3, power: number): void {
    this.heldUntil = 0;
    if (!this.plan.canHold) return;
    this.knock(dir, power);
  }

  // A burn, a stun and a slow are all things a keeper works out on its own copy and says the result
  // of through the health and the pace in its batch, so a browser that does not keep this creature
  // takes none of them: applied here they would be applied twice, once at each end.

  afflict(dps: number, seconds: number): void {
    if (this.dead || this.driven) return;
    if (dps * seconds >= this.dotDps * this.dotLeft) {
      this.dotDps = dps;
      this.dotLeft = seconds;
    }
  }

  stun(seconds: number): void {
    if (this.dead || this.driven) return;
    this.stunned = Math.max(this.stunned, seconds);
  }

  slow(seconds: number): void {
    if (this.dead || this.driven) return;
    this.slowed = Math.max(this.slowed, seconds);
  }

  private die(): void {
    this.dead = true;
    this.hp = 0;
    this.state = 'dying';
    this.deadTimer = DEAD_FOR;
    this.swingAt = 0;
    this.shotsLeft = 0;
    this.downPhase = null;
    this.targetRef = null;
    // Before the death clip, so the fall is posed from the clip's own chest and the ragdoll built
    // from it is not carrying an aim.
    this.dropAim();
    const v = this.body.linvel();
    this.body.setLinvel({ x: 0, y: this.flyer ? Math.min(0, v.y) : v.y, z: 0 }, true);
    // A flyer falls out of the air; a swimmer stays afloat.
    if (!this.swimming) this.body.setGravityScale(1, true);
    if (this.hologram) {
      this.fading = HOLOGRAM_FADE;
      this.deadTimer = HOLOGRAM_FADE + 0.05;
      return;
    }
    if (!this.model) return;
    const r = this.roles;
    const clip = r ? (this.swimming ? (r.swimDown ?? r.down) : this.flyer ? (r.hoverDown ?? r.down) : r.down) ?? r.hitHeavy : null;
    // One of the world's, with a server holding it: the death plays as a clip and the body is never
    // handed to the physics. Nothing carries bone motion between browsers, so a ragdoll is simulated
    // again from scratch on every screen and comes to rest in a different heap on each -- which is
    // the same divergence the game already forbids for a player's own death, for the same reason. It
    // would also stop the body being written from the wire for the whole of the corpse's life, since
    // the ragdoll is read before the driven branch is. Alone, or on a world nobody else is holding,
    // it falls exactly as it always has.
    const heap = !this.sharedLive;
    const d = this.animator?.once(clip, { hold: true, priority: SHOT_PRIORITY.down, fadeIn: 0.08, onEnd: heap ? () => this.deps.wantRagdoll(this) : undefined }) ?? null;
    if (d === null && heap) this.deps.wantRagdoll(this);
  }

  /** Hand the skinned body to the physics from the pose the death clip left. Called by the manager's queue. */
  startRagdoll(): void {
    this.queued = false;
    if (this.ragdoll || !this.model || !this.dead || this.disposed) return;
    this.group.updateMatrixWorld(true);
    const v = this.body.linvel();
    const maxRadius = clamp(0.08 * this.plan.height, 0.22, 2);
    this.ragdoll = new Ragdoll(this.deps.physics, this.model, {
      velocity: new THREE.Vector3(v.x, v.y, v.z),
      maxRadius,
      inertiaRadius: clamp(1.6 * maxRadius, 0.35, 3),
      maxBodies: this.entry.stats?.sizeClass === 'huge' ? 14 : 22,
    });
    this.body.setEnabled(false);
    this.animator?.reset();
    this.deadTimer = DEAD_FOR;
    this.state = 'dead';
  }

  private endRagdoll(): void {
    if (!this.ragdoll) return;
    this.ragdoll.dispose();
    this.ragdoll = null;
  }

  /** Where a shot leaves from: a muzzle bone, else the head, else the middle of its front. */
  private muzzlePoint(out: THREE.Vector3): THREE.Vector3 {
    if (this.muzzle) return this.muzzle.getWorldPosition(out);
    out.set(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(this.plan.along * 0.9);
    return out.add(this.pos).setY(this.pos.y + this.halfHeight * 1.3);
  }

  /** Whether a shot from here would reach a target's middle: a ray against what stands still. */
  private lineTo(t: Living): boolean {
    this.muzzlePoint(tmp);
    tmp2.set(t.pos.x, t.pos.y + t.halfHeight, t.pos.z).sub(tmp);
    const len = tmp2.length();
    if (len < 0.5) return true;
    tmp2.divideScalar(len);
    const ray = new RAPIER.Ray({ x: tmp.x, y: tmp.y, z: tmp.z }, { x: tmp2.x, y: tmp2.y, z: tmp2.z });
    const hit = this.deps.physics.world.castRay(ray, len - 0.3, true, undefined, this.inside ? INSIDE : OUTSIDE, undefined, this.body, (c) => {
      const b = c.parent();
      return !b || b.isFixed();
    });
    return !hit;
  }

  private fire(t: Living, cameraDist: number): void {
    const from = this.muzzlePoint(new THREE.Vector3());
    const beast = this.entry.kind === 'creature' || this.entry.kind === 'special';
    const dir = tmp.set(t.pos.x, t.pos.y + t.halfHeight, t.pos.z).sub(from);
    if (dir.lengthSq() < 1e-6) return;
    // A spit falls: aim over the target by the drop over its flight, or it lands short.
    if (beast) dir.y += 0.5 * SPIT.gravity * (dir.length() / SPIT.speed) ** 2;
    dir.normalize();
    // A little scatter, a degree or so.
    dir.x += (Math.random() - 0.5) * 0.035;
    dir.y += (Math.random() - 0.5) * 0.035;
    dir.z += (Math.random() - 0.5) * 0.035;
    dir.normalize();
    let color: number;
    if (beast) {
      color = SPIT.color;
      const burn = this.blow * SPIT.burn;
      this.deps.bolts.fire(from, dir, { owner: 'enemy', damage: this.blow, metresPerSecond: SPIT.speed, color, size: SPIT.size * Math.max(0.6, Math.min(2, Math.sqrt(this.scale * this.plan.height / 2))), gravity: SPIT.gravity, push: 1, exclude: this.body, source: this, sound: SPIT_SOUND, scar: 'flame', onHit: (_p, hit) => hit?.afflict?.(burn, SPIT.burnFor) });
    } else {
      // The gun in its hand when it holds one off the rack; else a droid's or a person's own: the
      // pistol's bolt when the clip it plays is a pistol's, the rifle's otherwise.
      // (A beam or a flame has no bolt to fire: its holder shoots the rifle's.)
      const held = this.gun && this.gun.primary.speed > 0 ? this.gun : null;
      const pistol = ownGunIsPistol(this.roles);
      const profile = held ?? (pistol ? GUNS.bryar : GUNS.blaster);
      const g = profile.primary;
      color = g.color;
      // The weapon in its hand is known here by the rack's id alone (the hands are given a copy of
      // the model, not the record), which is all its sounds need: every id is its template's name.
      this.deps.bolts.fire(from, dir, { owner: 'enemy', damage: this.blow, speed: g.speed, color, size: g.size, push: g.push, exclude: this.body, source: this, sound: (held ? combatSounds.gunById(this.weapon) : null) ?? combatSounds.gunOf(pistol ? OWN_GUN.pistol : OWN_GUN.rifle), scar: scarFamilyOf(profile.type, this.weapon) });
    }
    // The flash is a pooled light shared by everything; only a near shot may borrow one.
    if (this.tier?.name === 'near' && cameraDist < LOD_TUNE.near) this.deps.effects()?.flash(from, color, 5, 6, 0.06);
    const r = this.roles;
    if (r?.ranged && r.rangedAdditive) this.animator?.pulse(r.ranged, 0.06, 0.12);
    // The recoil window the aim is held through starts at the bolt, not at the clip: it is the
    // player's own 0.35 s and it is what stops the barrel swinging off a target and back on again
    // between every shot and the next.
    this.sinceShot = 0;
  }

  /** The set of roles in use now: swimming, hovering, fighting, or plain. */
  private gaitsNow(): readonly Gait[] {
    const r = this.roles;
    if (!r) return [];
    if (this.swimming && r.gaitsSwim.length) return r.gaitsSwim;
    if (this.flyer && r.gaitsHover.length) return r.gaitsHover;
    if (this.fighting() && r.gaitsCombat.length) return r.gaitsCombat;
    return r.gaits;
  }

  private idleNow(): string | null {
    return idleClipFor(this.roles, { swimming: this.swimming, flying: this.flyer, shooting: this.decision?.attack === 'ranged', fighting: this.fighting(), stance: this.stance, carried: this.carried });
  }

  /**
   * Which of the three carries it stands in, from what is in its hands and where its foe is:
   * `stanceFor`, the fighters' own, on the player's own numbers. A body with nothing off the rack
   * (a creature, a droid with a built-in gun, anyone the catalogue arms with nothing) is `relaxed`
   * for ever, which is exactly what it was before any of this.
   *
   * The combat carry outlives the fight by `STANCE_TUNE.ready` seconds, as the player's blaster
   * stays up after a shot -- otherwise a body drops its weapon to its side between one thought and
   * the next every time its target steps behind something.
   */
  private stepStance(target: Living | null): void {
    if (this.carry === 'unarmed' && !this.gun && !this.blade) {
      this.stance = 'relaxed';
      return;
    }
    const live = !!target && !target.dead;
    if (live && this.fighting()) this.readyUntil = this.now + STANCE_TUNE.ready;
    const ask = this.stanceAsk;
    const dx = live ? target!.pos.x - this.pos.x : 0;
    const dz = live ? target!.pos.z - this.pos.z : 0;
    // Off the **weapon's** nose and not off the feet's: whether the weapon comes up is a question
    // about where the weapon is pointed, and a body side-stepping round a rock has not stopped
    // aiming at you.
    const off = live ? Math.atan2(dx, dz) - this.facing : Math.PI;
    ask.gun = !!this.gun;
    ask.combat = this.now < this.readyUntil;
    ask.hasTarget = live;
    ask.gap = live ? Math.hypot(dx, dz) : 0;
    // Its own reach when the catalogue gives it no range at all (a body with a blade, or one whose
    // gun the catalogue never gave a range), so `stanceFor`'s range test is never a comparison
    // against zero that would hold a carrier at `ready` for ever.
    ask.range = this.rangedRange || 20;
    ask.offNose = live ? Math.atan2(Math.sin(off), Math.cos(off)) : Math.PI;
    this.stance = stanceFor(ask);
  }

  /**
   * The aim let go of and the spine put back where its clip had it, in one call: a body that has
   * died, one another browser has taken over, and one starting a fresh life.
   *
   * It matters most at death. The fold writes bone quaternions directly, and a ragdoll is built
   * from the pose the death clip leaves, so a turn left in the chest would be baked into the heap.
   * A death clip that keys the spine washes the fold out by itself; one that does not would leave
   * a corpse with its chest wound round for as long as it lay there.
   */
  private dropAim(): void {
    this.stance = 'relaxed';
    this.readyUntil = -Infinity;
    // And the weapon back on the feet, for the same reason the fold is washed out: a body that has
    // died or changed hands must not be left leaning on a target it is no longer thinking about.
    this.facing = this.heading;
    this.aimFix.yaw = 0;
    this.aimFix.pitch = 0;
    this.aimTurn = 0;
    this.inner.rotation.y = 0;
    // The same frame the fold is taken in, and put back to nothing before it is read.
    if (this.spines?.length) foldSpine(this.spines, this.inner, this.folded, 0, 0);
  }

  /**
   * The aim, once the pose is on: the barrel is measured where the clip and last frame's fold left
   * it, the difference to where the next bolt is really going is folded in, the spine takes what it
   * can of the yaw and the drawn body eases onto the rest. It is `Player.correctAim` through the
   * fighters' pure module, with the crosshair replaced by the point `fire` aims at.
   *
   * Only a gun in the hand. A blade is swung by clips that pose the whole arm, and a body with no
   * weapon off the rack has no grip to measure a barrel from at all.
   *
   * Nothing here decides anything: a mobile's bolt leaves `muzzlePoint` aimed straight at its
   * target whatever the pose says, so a fold that is wrong is a body that looks wrong and never a
   * body that misses. That is why it can be this cheap.
   */
  private aimPose(dt: number): void {
    const holder = this.holder;
    const target = this.targetRef;
    const ask = this.aimAsk;
    ask.aiming = !!this.gun && !!holder && !!target && !target.dead && this.stance !== 'relaxed';
    ask.sinceShot = this.sinceShot;
    ask.stunned = this.stunned > 0;
    const mode = aimMode(ask);
    if (mode === 'chase' && holder && target) {
      // The matrices are last frame's until something asks: the clip has just been posed and the
      // parents are the group's, so this is the one call that makes the measurement this frame's.
      holder.updateWorldMatrix(true, false);
      holder.getWorldPosition(aimGrip);
      // Where the barrel points: the grip to the muzzle node, which was hung at the far end of the
      // model when the weapon went in the hand.
      this.muzzlePoint(aimWant);
      aimHave.copy(aimWant).sub(aimGrip);
      const barrel = aimHave.length();
      // And where the shot is going: the same point `fire` aims at, from that same muzzle.
      aimGrip.copy(aimWant);
      aimWant.set(target.pos.x, target.pos.y + target.halfHeight, target.pos.z).sub(aimGrip);
      const len = aimWant.length();
      if (len > 1e-4 && barrel > 1e-6) {
        aimWant.divideScalar(len);
        aimHave.divideScalar(barrel);
        stepAimFix(this.aimFix, Math.atan2(aimWant.x, aimWant.z), Math.asin(clamp(aimWant.y, -1, 1)), Math.atan2(aimHave.x, aimHave.z), Math.asin(clamp(aimHave.y, -1, 1)), dt, 'chase');
      }
      // A barrel of no length, or a foe standing on the muzzle, leaves the correction exactly where
      // it is: the player's own early return, which is a hold and not an ease.
    } else if (mode === 'ease') stepAimFix(this.aimFix, 0, 0, 0, 0, dt, 'ease');
    // 'hold' does nothing at all, which is the whole of it.
    //
    // What the spine could not take goes on the drawn model, never on the heading: the heading is
    // the brain's, the body's rotation, where its bolts and its blade start from and what the
    // stuck check measures. The model turning inside it is a look.
    //
    // It is written **before** the fold, and the fold is about `inner` rather than `group`, because
    // the tilt is about whatever frame the fold is given. The two frames are a whole body turn
    // apart: the spine takes at most `spineMax` (0.6 rad) and everything past that -- up to 1.6 --
    // is this turn, so folding about the group tilts the chest about an axis that far off the drawn
    // body's own right and rolls it sideways instead of leaning it forward. The player has no such
    // seam, because its leftover goes on the heading and `rig.twistTorso`'s root already carries it.
    // Writing the turn first is the other half: read afterwards the axis would be last frame's.
    this.aimTurn = easeAngle(this.aimTurn, bodyShare(this.aimFix.yaw), STANCE_TUNE.bodyTurn, dt);
    if (this.inner.rotation.y !== this.aimTurn) this.inner.rotation.y = this.aimTurn;
    foldSpine(this.spines ?? [], this.inner, this.folded, spineShare(this.aimFix.yaw), this.aimFix.pitch);
  }

  private fighting(): boolean {
    // `cover` is in the list because it is the attack state under another name: a body behind a
    // crate is still in a fight, and one told the word off the wire must carry the combat stance,
    // the combat gaits and a lit blade exactly as one told `attack` does. Nothing in this game
    // sends it yet -- only a fighter takes cover and a fighter is on no wire -- and listing it here
    // is what makes that stay true when one is.
    const at = this.state === 'chase' || this.state === 'attack' || this.state === 'cover' || this.state === 'alert';
    // Driven, there is no target here to have: what it is doing is the keeper's word for it, and
    // that word is what chooses the combat stance, the combat gaits and a lit blade.
    return at && (this.targetKey !== null || this.driven);
  }

  update(dt: number, ctx: MobileContext, tier: LodTier): void {
    if (this.disposed) return;
    this.now = ctx.now;
    this.tier = tier;
    this.frame++;
    // 1. The physics has the body: the skin follows it, and its place is where the trunk lies.
    if (this.ragdoll) {
      this.ragdoll.update(dt);
      this.ragdoll.centre(tmp);
      this.pos.set(tmp.x, tmp.y - Math.min(0.3, this.halfHeight * 0.3), tmp.z);
      this.deadTimer -= dt;
      if (this.blade) this.blade.group.visible = false;
      return;
    }
    // 1b. Driven from elsewhere: nothing below runs at all. No ground check of its own, no thought,
    // no steering, no springs -- it is walked toward what its keeper last said and plays the clip
    // that pace asks for.
    if (this.driven) {
      this.stepDriven(dt, ctx, tier);
      return;
    }
    // 2. The body's place, and the heading it is held at.
    const t = this.body.translation();
    this.pos.set(t.x, t.y - this.plan.feet, t.z);
    this.group.position.set(t.x, t.y, t.z);
    tmpQ.setFromAxisAngle(UP, this.heading);
    this.group.quaternion.copy(tmpQ);
    // 3. Slowed by the Force, it lives at a crawl.
    this.slowed = Math.max(0, this.slowed - dt);
    const own = this.slowed > 0 ? 0.12 : 1;
    if (own < 1 && !this.dead) {
      const v0 = this.body.linvel();
      this.body.setLinvel({ x: v0.x * 0.5, y: v0.y, z: v0.z * 0.5 }, true);
    }
    const sdt = dt * own;
    // 4. A burn eats at it in real time, whatever it is doing.
    if (!this.dead && this.dotLeft > 0) {
      const step = Math.min(this.dotLeft, dt);
      this.dotLeft -= step;
      this.hp -= this.dotDps * step;
      if (this.hp <= 0) this.die();
    }
    // 5. Dead: the death clip plays out (the ragdoll starts from where it ends), the timer runs.
    if (this.dead) {
      if (this.fading > 0) {
        this.fading = Math.max(0, this.fading - dt);
        this.inner.scale.setScalar(this.scale * Math.max(0.001, this.fading / HOLOGRAM_FADE));
      }
      if (this.swimming) {
        const v = this.body.linvel();
        this.body.setLinvel({ x: v.x * 0.9, y: v.y * 0.8, z: v.z * 0.9 }, true);
      }
      this.animate(sdt, tier);
      this.updateBlade(dt, ctx.camera);
      this.deadTimer -= dt;
      return;
    }
    if (this.state === 'loading') return;
    // 6. Held by the Force: nothing of its own this frame.
    if (this.heldUntil > this.now) {
      this.animate(sdt, tier);
      this.updateBlade(dt, ctx.camera);
      return;
    }
    // 7. Timers.
    this.stunned = Math.max(0, this.stunned - sdt);
    // On the simulated clock beside the rest, so `__debug.advance` moves the recoil window the aim
    // is held through exactly as a drawn frame does.
    this.sinceShot += sdt;
    this.attackCd -= sdt;
    this.rangedCd -= sdt;
    this.hitCd -= sdt;
    if (this.downPhase === 'lie' && this.now >= this.downUntil) this.getUp();
    // 8. The ground: every frame near, every fourth frame farther out.
    if (tier.name === 'near' || (this.frame + this.key) % 4 === 0) this.checkGround(t);
    // 9. Think.
    if (this.now >= this.thinkAt && !this.downPhase) {
      this.think(ctx);
      this.thinkAt = this.now + tier.think * (0.85 + Math.random() * 0.3);
    }
    // 10. The carry it stands in (before acting: `act` chooses the loop from it), 11. act,
    // 12. hold its height, 13. animate, 14. aim.
    if (this.state === 'return') this.hp = Math.min(this.maxHp, this.hp + (this.maxHp / 3) * sdt);
    this.stepStance(this.targetRef);
    this.act(sdt, ctx, tier);
    this.holdHeight(t, sdt);
    this.animate(sdt, tier);
    // After the mixer and before the blade: the fold goes on top of the pose the clip has just
    // written, and the blade's own ends are worked out from the hand the fold has just moved.
    // Skipped for everything with nothing in its hands, for anything culled, and for a tier whose
    // mixer is not running at all -- which is most of the world.
    if (this.gun && this.holder && this.canAim && this.group.visible && tier.animEvery > 0) this.aimPose(sdt);
    this.updateBlade(dt, ctx.camera);
  }

  /**
   * One frame of a creature another browser thinks for. It is the same body doing the same things
   * to the world -- it is lifted to the ground, it is followed through a building's portals, it
   * stops a bolt and it stands in the one list of the living -- with the brain, the steering and the
   * dynamics taken out and a word from the wire put in their place.
   *
   * Nothing is allocated: the two objects the engine is written through are kept above, and the
   * gait's answer goes into the one struct every mobile already reuses.
   */
  private stepDriven(dt: number, ctx: MobileContext, tier: LodTier): void {
    // 1. Toward what the keeper last said, a tenth of a second's worth at a time -- the same glide
    //    a remote player's figure is drawn with, so a creature moves no differently from a person.
    const k = this.toldOnce ? 1 - Math.exp(-dt / Math.max(1e-3, NPC_TUNE.glideSeconds)) : 1;
    this.pos.lerp(this.toldAt, k);
    let diff = this.toldHeading - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.heading += diff * k;
    // A driven body has no aim of its own -- `dropAim` took it when it changed hands and nothing
    // steps it again -- so its weapon points where its feet do. The wire carries one angle and the
    // lean does not cross; a keeper's sliding gunner is drawn walking straight here, which is a
    // difference nobody can see against the tenth of a second everything else on it is glided over.
    this.facing = this.heading;
    this.toldOnce = true;
    // 2. The body follows the picture here, not the other way about: it is kinematic, so where it
    //    is is written rather than solved for.
    const feet = this.plan.feet;
    tmpQ.setFromAxisAngle(UP, this.heading);
    driveAt.x = this.pos.x;
    driveAt.y = this.pos.y + feet;
    driveAt.z = this.pos.z;
    driveTurn.x = tmpQ.x;
    driveTurn.y = tmpQ.y;
    driveTurn.z = tmpQ.z;
    driveTurn.w = tmpQ.w;
    if (this.body.isValid()) {
      this.body.setNextKinematicTranslation(driveAt);
      this.body.setNextKinematicRotation(driveTurn);
    }
    this.group.position.copy(driveAt);
    this.group.quaternion.copy(tmpQ);
    // 3. Dead: the death clip plays out where it fell and the timer runs, exactly as it does for one
    //    this browser killed itself, so the manager takes the body down in its own good time.
    if (this.dead) {
      if (this.fading > 0) {
        this.fading = Math.max(0, this.fading - dt);
        this.inner.scale.setScalar(this.scale * Math.max(0.001, this.fading / HOLOGRAM_FADE));
      }
      this.animate(dt, tier);
      this.updateBlade(dt, ctx.camera);
      this.deadTimer -= dt;
      return;
    }
    if (this.state === 'loading' && !this.model) return;
    // 4. Whether it is in water, which is what chooses between its swimming clips and its walking
    //    ones. Asked at the same rate a mobile of this browser's own asks it.
    if (tier.name === 'near' || (this.frame + this.key) % 4 === 0) this.checkGround(driveAt);
    // 5. What it is doing, and the clip for it: the gait is chosen from the pace its keeper says its
    //    feet are going at, through the same acceleration ramp a mobile of this browser's own uses,
    //    so nothing slides and nothing snaps between one word and the next.
    this.state = this.toldState;
    this.hitCd -= dt;
    const move = this.entry.move;
    const accel = (this.toldSpeed > this.speeds.walk + 1e-3 ? move.accel?.[0] : move.accel?.[1]) ?? 4;
    const gait = stepGait(this.ramp, this.toldSpeed, accel, dt, this.gaitsNow(), this.idleNow(), this.scale, undefined, this.gaitOut);
    this.ramp = gait.ramp;
    this.speed = gait.speed;
    if (!this.downPhase) this.animator?.loop(gait.clip ?? this.idleNow(), gait.timeScale);
    this.animate(dt, tier);
    this.updateBlade(dt, ctx.camera);
  }

  private checkGround(t: { x: number; y: number; z: number }): void {
    const terrain = this.deps.terrain;
    const filter = this.inside ? INSIDE : undefined;
    const gd = this.deps.physics.groundDistance(t.x, t.y, t.z, this.plan.feet + 0.4, this.body, filter);
    this.grounded = gd !== null || (!this.inside && this.pos.y <= terrain.heightAt(this.pos.x, this.pos.z) + 0.25);
    if (this.inside) {
      this.swimming = false;
      return;
    }
    const surface = terrain.waterHeightAt(this.pos.x, this.pos.z);
    const ground = terrain.heightAt(this.pos.x, this.pos.z);
    const deep = surface - ground > (this.entry.size?.swimHeight ?? 1) * this.scale;
    const swimming = this.canSwim && deep && this.pos.y < surface;
    if (swimming !== this.swimming) {
      this.swimming = swimming;
      this.body.setGravityScale(swimming || (this.flyer && !this.dead) ? 0 : 1, true);
    }
  }

  private think(ctx: MobileContext): void {
    const now = this.now;
    if (this.wanderAt < 0) this.wanderAt = now + 1 + Math.random() * 4;
    // Grudges past the memory are dropped.
    for (const [k, g] of this.memory) if (now - g.at > BRAIN_TUNE.memory || g.who.dead) this.memory.delete(k);
    const list = this.brainTargets;
    list.length = 0;
    // A mind handed over names what it was fighting, and this is the first moment there is a list of
    // the living to find it in.
    if (this.wantTarget) this.takeWantedTarget(ctx.targets);
    let current: Living | null = null;
    const reachOut = Math.max(BRAIN_TUNE.aggroBig, BRAIN_TUNE.leash) + 30;
    for (const t of ctx.targets) {
      if (t === (this as Living) || t.key === this.key) continue;
      const dx = t.pos.x - this.pos.x;
      const dz = t.pos.z - this.pos.z;
      const grudge = this.memory.get(t.key);
      const isCurrent = t.key === this.targetKey;
      if (!grudge && !isCurrent && dx * dx + dz * dz > reachOut * reachOut) continue;
      if (isCurrent) current = t;
      // Filled into a pooled object: the brain copies what it keeps, and never holds on to these.
      let b = this.brainPool[list.length];
      if (!b) {
        b = { key: 0, x: 0, y: 0, z: 0, halfHeight: 0, radius: 0, side: t.side, aggression: t.aggression, dead: false, attackedMeAt: -Infinity, hasLine: false };
        this.brainPool.push(b);
      }
      b.key = t.key;
      b.x = t.pos.x;
      b.y = t.pos.y;
      b.z = t.pos.z;
      b.halfHeight = t.halfHeight;
      b.radius = t.radiusToward(this.pos) + this.radiusToward(t.pos);
      b.side = t.side;
      b.aggression = t.aggression;
      b.dead = t.dead;
      b.attackedMeAt = grudge ? grudge.at : -Infinity;
      b.hasLine = isCurrent && this.rangedRange > 0 && !t.dead ? this.lineTo(t) : false;
      list.push(b);
    }
    const self: BrainSelf = {
      key: this.key,
      x: this.pos.x,
      y: this.pos.y,
      z: this.pos.z,
      heading: this.heading,
      homeX: this.homeX,
      homeZ: this.homeZ,
      side: this.side,
      aggression: this.aggression,
      inside: this.inside,
      big: this.entry.stats?.sizeClass === 'large' || this.entry.stats?.sizeClass === 'huge',
      reach: (this.entry.stats?.reach ?? 1.5) * this.scale,
      ranged: this.rangedRange,
      melee: this.melee,
      halfHeight: this.halfHeight,
      hpRatio: this.hp / this.maxHp,
      state: this.state,
      targetKey: this.targetKey,
      stuck: this.stuck,
      now,
      wanderAt: this.wanderAt,
      goal: this.goal,
      until: this.until,
      blockedSince: this.blockedSince,
      forgetKey: this.forgetKey,
      forgetUntil: this.forgetUntil,
    };
    const d = decide(self, list);
    if (d.clearMemory) this.memory.clear();
    if (d.targetKey !== this.targetKey) {
      this.stuck = 0;
      this.stuckClock = 0;
    }
    this.targetKey = d.targetKey;
    this.targetRef = d.targetKey === null ? null : d.targetKey === current?.key ? current : (ctx.targets.find((t) => t.key === d.targetKey) ?? null);
    this.wanderAt = d.wanderAt;
    this.goal = d.goal;
    this.until = d.until;
    this.blockedSince = d.blockedSince;
    this.forgetKey = d.forgetKey;
    this.forgetUntil = d.forgetUntil;
    if (d.state === 'return' && this.state !== 'return') this.goal = null;
    this.state = d.state;
    this.decision = d;
    // Water it cannot swim in, just ahead: a wander turns elsewhere, a chase stops at the edge.
    this.waterAhead = false;
    if (!this.canSwim && !this.flyer && !this.inside && d.pace !== 'stand') {
      const ahead = Math.max(1, this.speed * 0.5);
      const nx = this.pos.x + Math.sin(this.heading) * ahead;
      const nz = this.pos.z + Math.cos(this.heading) * ahead;
      const terrain = this.deps.terrain;
      if (terrain.waterHeightAt(nx, nz) - terrain.heightAt(nx, nz) > (this.entry.size?.swimHeight ?? 1) * this.scale * 0.8) {
        this.waterAhead = true;
        if (d.state === 'wander') {
          this.goal = null;
          this.wanderAt = now;
          this.state = 'idle';
        }
      }
    }
    if (d.emote && this.animator && this.roles) {
      const e = this.roles.emotes;
      if (d.emote === 'alert') {
        // Half the time a threat or a call as it squares up.
        if (Math.random() < 0.5) this.animator.once(e.threaten ?? e.vocalize ?? e.combatVocalize ?? null, { priority: SHOT_PRIORITY.emote });
      } else {
        const names = Object.keys(e).filter((k) => k !== 'threaten' && k !== 'combatVocalize');
        if (names.length) this.animator.once(e[names[Math.floor(Math.random() * names.length)]], { priority: SHOT_PRIORITY.emote });
      }
    }
  }

  private act(dt: number, ctx: MobileContext, tier: LodTier): void {
    const move = this.entry.move;
    const d = this.decision;
    const t = this.targetRef;
    if (t && (t.dead || (t as { removed?: boolean }).removed)) this.targetRef = null;
    // The target moves between thoughts: the chase and the aim follow it every frame.
    let moveTo = d?.moveTo ?? null;
    let face = d?.face ?? null;
    let pace = d?.pace ?? 'stand';
    const target = this.targetRef;
    // `cover` is `attack` or `chase` under another name and is listed with them for that reason,
    // though no creature can reach it: the word is gated on `BrainSelf.seeksCover` and nothing but
    // a tiered fighter sets that. It is here so a mobile that is ever given one does not silently
    // stop tracking whatever it is fighting.
    if (target && d && (d.state === 'chase' || d.state === 'attack' || d.state === 'cover' || d.state === 'alert')) {
      face = this.faceAt;
      face.x = target.pos.x;
      face.z = target.pos.z;
      if (d.state === 'chase' || (d.state === 'cover' && !!d.moveTo)) {
        moveTo = face;
        // Close enough to strike: stop rather than run on until the next thought.
        const gap = Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z) - target.radiusToward(this.pos) - this.radiusToward(target.pos);
        if (this.melee && gap <= (this.entry.stats?.reach ?? 1.5) * this.scale * 0.8) pace = 'stand';
      }
    }
    // Where the **gun** points, which from here on is a different question from where the feet go:
    // the thing it is fighting, whatever its legs are doing. It is read by the carry alone, and by
    // nothing else at all, so for a creature with empty hands it costs one angle and changes
    // nothing.
    //
    // **This line must stay above the corner below.** `face` is the feet's want in this method --
    // `this.heading` is eased onto it, and the body's velocity goes along the heading -- and the
    // corner overwrites it with the next point on the indoor path. Capture `look` after that and it
    // is the corner too, which is the whole of the split undone: an armed creature rounding a
    // doorway would swing its gun onto the doorway instead of keeping it on what it is fighting.
    // The side-step below is the same trap from the other side, and is applied to the heading only.
    // `fighterMove.test.ts` pins the order as text, because nothing else can.
    const look = face;
    // The way out of the room. Indoors, the building's own floors say which corner to walk at next
    // on the way to where the brain is sending it; only where it **travels** is taken from the path,
    // so the arrival test below still measures the real goal and a body walking the last corner of a
    // path does not stop a stride short of it. Outdoors, in a room whose floor the pack has not
    // got with the goal in that same room, and for anything that flies, `corner` is null and every
    // line below is the line it always was.
    if (moveTo && pace !== 'stand' && this.navCell && !this.flyer && !this.driven) {
      const goalY = target && d && (d.state === 'chase' || d.state === 'attack' || d.state === 'cover' || d.state === 'alert') ? target.pos.y : this.pos.y;
      const corner = worldNav.corner(this.navAgent, this.navCell, this.pos.x, this.pos.y, this.pos.z, moveTo.x, goalY, moveTo.z, this.plan.across, this.now);
      if (corner) face = corner;
    }
    if (this.waterAhead && pace !== 'stand') pace = 'stand';
    if (!tier.move || this.stunned > 0 || this.downPhase) pace = 'stand';
    if (!tier.move) {
      this.body.setLinvel({ x: 0, y: this.body.linvel().y, z: 0 }, false);
      // Only a body standing on something sleeps: one put to sleep in the air hangs there for good.
      if (this.grounded && !this.body.isSleeping()) this.body.sleep();
    }
    let wanted = pace === 'run' ? this.speeds.run : pace === 'walk' ? this.speeds.walk : 0;
    if (moveTo && pace !== 'stand' && Math.hypot(moveTo.x - this.pos.x, moveTo.z - this.pos.z) < 0.5) wanted = 0;
    // Point the feet at the move point, or at the target while attacking -- and the weapon at
    // whatever it is really fighting. The side-step goes on the **feet alone** now: it is a twist
    // of sixty degrees for a second to get round whatever it walked into, and twisting the weapon
    // with it dropped the carry out of its aiming cone and put the gun down for the whole step.
    if (!this.downPhase && this.stunned <= 0) {
      const rate = THREE.MathUtils.degToRad(wanted > this.speeds.walk + 1e-3 ? move.turnRun : move.turnWalk) || Math.PI;
      const turn = rate * dt;
      if (face) {
        let want = Math.atan2(face.x - this.pos.x, face.z - this.pos.z);
        if (this.now < this.sidestepUntil && pace !== 'stand') want += this.sidestep;
        this.heading += clamp(Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading)), -turn, turn);
      }
      // The same rate, so the two never come apart faster than a body can turn; with nothing to
      // fight the weapon simply follows the feet, which is where it has always pointed.
      const aimAt = look ?? face;
      if (aimAt) {
        const want = Math.atan2(aimAt.x - this.pos.x, aimAt.z - this.pos.z);
        this.facing += clamp(Math.atan2(Math.sin(want - this.facing), Math.cos(want - this.facing)), -turn, turn);
      } else this.facing = this.heading;
    }
    // Speed: the template's acceleration toward the pace, then the gait that matches what it ends up doing.
    const accel = (wanted > this.speeds.walk + 1e-3 ? move.accel?.[0] : move.accel?.[1]) ?? 4;
    // The ramp keeps its own progress (a clamped walk must never hold it off the run), the body goes
    // at what the chosen gait's feet show, and below `still` the ramp stands it (stepGait, gait.ts).
    const gait = stepGait(this.ramp, wanted, accel, dt, this.gaitsNow(), this.idleNow(), this.scale, undefined, this.gaitOut);
    this.ramp = gait.ramp;
    this.speed = gait.speed;
    const moving = this.speed > 0.05 && (this.grounded || this.flyer || this.swimming) && this.stunned <= 0 && !this.downPhase && tier.move;
    if (moving) {
      const vy = this.body.linvel().y;
      this.body.setLinvel({ x: Math.sin(this.heading) * this.speed, y: vy, z: Math.cos(this.heading) * this.speed }, true);
    } else if (this.grounded && tier.move) {
      // Braking: a fifth off per sixtieth of a second, whatever the frame rate.
      const v = this.body.linvel();
      const brake = Math.pow(0.8, dt * 60);
      this.body.setLinvel({ x: v.x * brake, y: v.y, z: v.z * brake }, true);
    }
    if (tier.move) {
      tmpQ.setFromAxisAngle(UP, this.heading);
      this.body.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }, moving);
    }
    if (!this.downPhase) this.animator?.loop(gait.clip ?? this.idleNow(), gait.timeScale);
    this.checkStuck(dt, moving ? this.speed : 0);
    this.fight(ctx, d);
  }

  /** Every window, the ground covered against the speed commanded: under a fifth is stuck, and it side-steps. */
  private checkStuck(dt: number, commanded: number): void {
    if (this.stuckClock === 0) this.stuckFrom.copy(this.pos);
    this.stuckClock += dt;
    this.stuckCommanded += commanded * dt;
    if (this.stuckClock < STUCK_WINDOW) return;
    const avg = this.stuckCommanded / this.stuckClock;
    const covered = Math.hypot(this.pos.x - this.stuckFrom.x, this.pos.z - this.stuckFrom.z);
    if (avg > 1 && covered < 0.2 * avg * this.stuckClock) {
      this.stuck++;
      this.sidestepUntil = this.now + 1;
      this.sidestep = (Math.random() < 0.5 ? -1 : 1) * SIDESTEP;
    }
    this.stuckClock = 0;
    this.stuckCommanded = 0;
  }

  /** Strike, shoot, and land what is under way. */
  private fight(ctx: MobileContext, d: Decision | null): void {
    const target = this.targetRef;
    const roles = this.roles;
    const animator = this.animator;
    if (!roles || !animator || this.downPhase || this.stunned > 0.3) return;
    const cameraDist = ctx.camera ? ctx.camera.position.distanceTo(this.pos) : Infinity;
    const cooldown = this.entry.stats?.attackCooldown ?? 1.6;
    // A blow under way lands part way into its swing, if the target is still in reach.
    if (this.swingAt > 0 && this.now >= this.swingAt) {
      this.swingAt = 0;
      // A body that carries a blade cuts what the blade passes through instead: the swing opens a
      // window here and `updateBlade` sweeps the path for as long as it runs, so it can miss, can
      // catch two bodies at once, and takes one bite out of each. With nothing wired to name what a
      // collider belongs to, no sweep is possible at all and the instant blow below stands in.
      // Only a blade that is really being drawn can be swept: `updateBlade` works the ends out and
      // it does nothing at all for a body culled as a group or lying in a ragdoll, so such a body
      // keeps the instant blow it always had rather than swinging at nothing.
      const sweeps = !!this.blade && !!this.deps.hittableAt && !this.driven && this.group.visible && !this.ragdoll;
      if (this.blade) noteBladeSwing(!sweeps);
      if (sweeps) {
        this.swingUntil = this.now + BLADE_SWING.window;
        this.hitThisSwing.clear();
        this.swingSounded = false;
      }
      const t = sweeps ? null : this.swingKey !== null && target && target.key === this.swingKey ? target : null;
      if (t && !t.dead) {
        const gap = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) - t.radiusToward(this.pos) - this.radiusToward(t.pos);
        const level = Math.abs(t.pos.y + t.halfHeight - (this.pos.y + this.halfHeight)) <= this.halfHeight + t.halfHeight + BRAIN_TUNE.vertical;
        if (gap <= (this.entry.stats?.reach ?? 1.5) * this.scale + 0.5 && level) {
          const push = BLOW_PUSH[this.entry.stats?.sizeClass ?? 'small'] ?? 3;
          t.damage(this.blow, this.pos, push, this);
        }
      }
    }
    // Shots of a burst, a fifth of a second apart.
    if (this.shotsLeft > 0 && this.now >= this.nextShotAt) {
      if (target && !target.dead) this.fire(target, cameraDist);
      this.shotsLeft--;
      this.nextShotAt = this.now + 0.18;
    }
    if (!target || !d || d.state !== 'attack') return;
    if (d.attack === 'melee' && this.attackCd <= 0 && this.swingAt === 0 && animator.shotLevel < SHOT_PRIORITY.attack) {
      const list = this.flyer && roles.hoverAttacks.length ? roles.hoverAttacks : roles.attacks;
      if (!list.length) return;
      // Light seven times in ten, heavy the rest where there is one, a special one time in ten.
      const roll = Math.random();
      const clip = list.length > 2 && roll < 0.1 ? list[2 + Math.floor(Math.random() * (list.length - 2))] : list.length > 1 && roll > 0.7 ? list[1] : list[0];
      const length = animator.once(clip, { priority: SHOT_PRIORITY.attack, fadeIn: 0.08, fadeOut: 0.2 });
      const duration = length ?? 0.6;
      this.swingAt = this.now + Math.min(0.5, 0.4 * duration);
      this.swingKey = target.key;
      this.attackCd = cooldown * jitter();
    } else if (d.attack === 'ranged' && this.rangedCd <= 0 && this.shotsLeft === 0) {
      const beast = this.entry.kind === 'creature' || this.entry.kind === 'special';
      this.rangedCd = cooldown * jitter();
      if (!roles.rangedAdditive && roles.ranged) {
        // A whole-body shot: the bolt leaves part way into the clip. The carry row hands over every
        // shot the weapon has where the table carries them (six a weapon), so a gunner standing
        // over somebody does not fire the identical clip a dozen times; a pack with one falls back
        // to `ranged`, which is that one.
        const shots = roles.rangedShots;
        const shot = shots && shots.length > 1 ? shots[Math.floor(Math.random() * shots.length)] : roles.ranged;
        const length = animator.once(animator.has(shot) ? shot : roles.ranged, { priority: SHOT_PRIORITY.attack, fadeIn: 0.08, fadeOut: 0.2 });
        this.shotsLeft = 1;
        this.nextShotAt = this.now + Math.min(0.5, 0.4 * (length ?? 0.5));
      } else {
        this.shotsLeft = beast ? 1 : 1 + Math.floor(Math.random() * 3);
        this.nextShotAt = this.now;
      }
    }
  }

  /** A flyer holds its cruising height over the ground; a swimmer floats. */
  private holdHeight(t: { x: number; y: number; z: number }, sdt: number): void {
    if (this.dead || this.heldUntil > this.now) return;
    let wantY: number | null = null;
    let afloat = false;
    if (this.swimming) {
      afloat = true;
      // The **drawn** surface, not the flat table under it: on the open sea a body measured
      // against that plane has the waves pass over it while it holds perfectly still. The swell is
      // 0 on a lake, in the shallows and on a planet with no sea, so everywhere else this is the
      // line it always was.
      const flat = this.deps.terrain.waterHeightAt(this.pos.x, this.pos.z);
      const swell = this.deps.seaSwellAt?.(this.pos.x, this.pos.z, flat) ?? 0;
      wantY = flat + swell - this.plan.swimDepth + this.plan.feet;
    } else if (this.flyer) {
      const ground = this.deps.groundAt(this.pos.x, t.y, this.pos.z, this.inside) ?? this.deps.terrain.heightAt(this.pos.x, this.pos.z);
      wantY = ground + this.plan.hover + this.plan.feet;
      if (this.body.gravityScale() !== 0) this.body.setGravityScale(0, true);
    }
    if (wantY === null) return;
    const v = this.body.linvel();
    // A floater chases a surface that moves and takes the shared spring (`src/world/afloat.ts`),
    // which the player's own swim reads too, so a person and a creature on the same wave ride it
    // alike and one knob moves both. A flyer chases a height that stands still and keeps the
    // softer numbers it has always had, since nothing about a hover changed.
    const vy = afloat ? afloatVelocity(wantY, t.y, v.y, sdt) : clamp((wantY - t.y) * 2.5 - v.y * 0.3, -6, 6);
    this.body.setLinvel({ x: v.x, y: vy, z: v.z }, true);
  }

  /** The mixer at the tier's rate; its time kept, so a thinned mobile's clips run at the right speed. */
  private animate(dt: number, tier: LodTier): void {
    const a = this.animator;
    if (!a) return;
    this.animAcc = Math.min(2, this.animAcc + dt);
    const every = tier.animEvery;
    if (every <= 0) return;
    if (every > 1 && (this.frame + this.key) % every !== 0) return;
    a.update(this.animAcc);
    this.animAcc = 0;
  }

  /**
   * Outdoors, a body found well under the terrain is put back on top of it. The ground can change
   * under a mobile: the planet's own heights arrive after the arrival spawn (the wildlife is stood
   * on the stand-in terrain behind the loading screen), and past the physics' reach there is no
   * heightfield to stand on. Returns whether it moved it.
   */
  liftToGround(): boolean {
    if (this.dead || this.disposed || this.inside || this.ragdoll || this.swimming || this.heldUntil > this.now) return false;
    const ground = this.deps.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y > ground - 1) return false;
    const t = this.body.translation();
    this.body.setTranslation({ x: t.x, y: ground + this.plan.feet + 0.05 + (this.flyer ? this.plan.hover : 0), z: t.z }, true);
    const v = this.body.linvel();
    this.body.setLinvel({ x: v.x, y: 0, z: v.z }, true);
    this.pos.y = ground;
    // Driven, what it is walking toward is raised with it: left where it was, the next frame's ease
    // would pull it straight back under the ground it has just been put on top of.
    if (this.driven) this.toldAt.y = Math.max(this.toldAt.y, ground);
    this.grounded = true;
    return true;
  }

  /** A fresh life at a new spot: everything a body can carry is cleared, the bones put back to rest. */
  respawn(x: number, y: number, z: number): void {
    if (this.disposed) return;
    this.key = nextLivingKey();
    this.endRagdoll();
    for (const [bone, r] of this.restPose) {
      bone.position.copy(r.p);
      bone.quaternion.copy(r.q);
      bone.scale.copy(r.s);
    }
    this.dead = false;
    this.deadTimer = 0;
    this.hp = this.maxHp;
    this.dotDps = 0;
    this.dotLeft = 0;
    this.slowed = 0;
    this.heldUntil = 0;
    this.stunned = 0;
    this.attackCd = 0;
    this.rangedCd = 0;
    this.hitCd = 0;
    this.swingAt = 0;
    this.swingUntil = 0;
    this.swingSounded = false;
    this.hitThisSwing.clear();
    this.bladePath.reset();
    this.shotsLeft = 0;
    // The carry and the aim. The bones have just been put back to their rest pose above, so the
    // fold's record of what it last wrote describes a pose that no longer exists: cleared rather
    // than unwound, or it would compare a rest-pose quaternion against a folded one, find them
    // different, and take the fold as the clip's own -- which is the one way this can compound.
    this.folded.clear();
    this.dropAim();
    this.sinceShot = Infinity;
    this.downPhase = null;
    this.memory.clear();
    this.targetKey = null;
    this.targetRef = null;
    this.decision = null;
    this.goal = null;
    this.until = 0;
    this.blockedSince = null;
    this.forgetKey = null;
    this.stuck = 0;
    this.stuckClock = 0;
    this.wanderAt = -1;
    this.thinkAt = 0;
    // A path is a path through one room of one building; a body stood somewhere else carries none
    // of it. The manager gives it its room again on its next follow.
    this.navCell = null;
    this.navAgent.clear();
    // A fresh life has not been spoken about yet, and owes the wire nothing about the last one.
    this.toldOnce = false;
    this.mark = null;
    this.speed = 0;
    this.ramp = 0;
    this.swimming = false;
    this.fading = 0;
    this.queued = false;
    this.grounded = true;
    this.inner.scale.setScalar(this.scale);
    this.homeX = x;
    this.homeZ = z;
    this.body.setEnabled(true);
    this.body.setGravityScale(this.flyer ? 0 : 1, true);
    this.body.setTranslation({ x, y: y + this.plan.feet + 0.05, z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    tmpQ.setFromAxisAngle(UP, this.heading);
    this.body.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }, true);
    this.pos.set(x, y, z);
    this.state = this.model ? 'idle' : 'loading';
    if (this.animator) {
      this.animator.reset();
      this.animator.loop(this.idleNow(), 1, 0);
    }
  }

  /** What the console shows of it. */
  describe(from?: THREE.Vector3): Record<string, unknown> {
    const c = this.plan.colliders[0];
    const hull = this.plan.colliders.length - 1;
    const r = this.roles;
    return {
      key: this.key,
      id: this.entry.id,
      name: this.label,
      origin: this.origin,
      state: this.state,
      hp: Number(this.hp.toFixed(1)),
      maxHp: this.maxHp,
      side: this.side,
      aggression: this.aggression,
      scale: Number(this.scale.toFixed(2)),
      at: this.pos.toArray().map((n) => Number(n.toFixed(1))),
      dist: from ? Number(this.pos.distanceTo(from).toFixed(1)) : undefined,
      body: `${c.shape} r${c.radius.toFixed(2)} h${(2 * this.plan.feet).toFixed(2)}${hull ? ` + ${hull} hull balls` : ''}`,
      clip: this.animator?.base ?? null,
      shot: this.animator?.shot ?? null,
      target: this.targetKey === PLAYER_KEY ? 'you' : this.targetRef?.label ?? this.targetKey,
      walk: Number(this.speeds.walk.toFixed(2)),
      run: Number(this.speeds.run.toFixed(2)),
      speed: Number(this.speed.toFixed(2)),
      tier: this.tier?.name ?? null,
      // One of the world's creatures, and whether this browser is the one thinking for it.
      shared: this.shared || null,
      driven: this.driven,
      shadow: this.meshes.some((m) => m.castShadow),
      visible: this.group.visible,
      inside: this.inside,
      room: this.room,
      swimming: this.swimming,
      ragdoll: this.ragdoll?.status ?? null,
      ranged: this.rangedRange ? Number(this.rangedRange.toFixed(0)) : 0,
      weapon: this.weapon,
      // What it is carrying and how it is holding it, with the spine's share of the aim in degrees
      // and how much of it the drawn model took. `spines 0` on a person is the one thing here that
      // means something is wrong: it is a skeleton the fold found no spine in.
      // A body holding something whose pack has no row for it says so: the stance is still worked
      // out and reported, and it chooses no clip, which is the one line that says why nothing moved.
      carry: this.carried || !(this.gun || this.blade) ? this.carry : `${this.carry} (no row in this pack: reconvert mobiles)`,
      stance: this.carried || !(this.gun || this.blade) ? this.stance : `${this.stance} (no row: it chooses no clip)`,
      aim: !this.gun ? null : !this.canAim ? 'no aimed pose in this pack: reconvert mobiles' : `${THREE.MathUtils.radToDeg(spineShare(this.aimFix.yaw)).toFixed(1)}° spine, ${THREE.MathUtils.radToDeg(this.aimTurn).toFixed(1)}° body, ${THREE.MathUtils.radToDeg(this.aimFix.pitch).toFixed(1)}° pitch`,
      spines: this.spines?.length ?? 0,
      roles: r ? describeRoles(r) : null,
    };
  }

  /** Taken out of the world: the body, the skeletons' bone textures and the mixer go; the caller releases the assets and the collider handles. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dead = true;
    // Nothing is said about it going: this browser's body went, and the creature itself belongs to
    // the world (a travel, a world unloaded, a body cleared here). What is dropped is the wire's
    // hold on this body, and only while it is still this body the wire is holding: a creature stood
    // again under the same id has already taken that place.
    if (this.shared) {
      const net = npcNow();
      if (net?.find(this.shared) === this) net.remove(this.shared);
    }
    this.memory.clear();
    this.targetRef = null;
    this.endRagdoll();
    this.deps.physics.world.removeRigidBody(this.body);
    this.animator?.dispose();
    this.animator = null;
    // The pack itself belongs to the asset cache, which the caller releases; only the hold on it goes.
    this.animPack = null;
    if (this.blade) {
      this.blade.group.parent?.remove(this.blade.group);
      this.blade.dispose();
      this.blade = null;
    }
    // The rack's copy shares its geometry and materials with the rack: it is let go, never disposed.
    this.holder?.parent?.remove(this.holder);
    this.holder = null;
    this.gun = null;
    if (this.model) {
      this.model.traverse((o) => {
        const s = o as THREE.SkinnedMesh;
        if (s.isSkinnedMesh) s.skeleton?.dispose();
      });
      this.inner.remove(this.model);
      this.model = null;
    }
    this.meshes.length = 0;
  }
}
