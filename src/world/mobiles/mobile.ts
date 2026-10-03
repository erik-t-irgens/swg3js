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
// starts from where the body is standing, and no pose is put back to rest, because that is exactly
// what would make a creature flick as it changed hands.
//
// With no server none of this runs: `driven` is never set, `mine` answers yes for everything, and
// every creature is this browser's own with its damage applied where it lands.
import * as THREE from 'three';
import { cloneShared, reshareSkeletons } from './cloneShared.ts';
import { cullsOneByOne, fitCullSpheres, setBodyCulled, type BodyPose } from '../bodyCull.ts';
import { groundUnder, standingOn } from './groundProbe.ts';
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
import { KICK_DAMAGE, type Dir, type Impulse, type MoveScriptNow, type SaberStyle, type SaberVoice } from '../../combat/saber.ts';
import { parryClip } from '../../combat/deflect.ts';
// A lightsaber swung through the player's own move machine from the second tier up, and a bolt turned
// away by chance by tier (wave W9), as a fighter's is: `npcSaber.ts`, written fresh.
import { BLOCK_EYE, JKA_UNIT, LUNGE_PUSH, NPC_SABER_TUNE, NpcSaber, alongFacing, blockFrame, canSwing, liesToward, styleOf, type BladeAsk, type BlockAsk } from '../npcSaber.ts';
import type { Bolt } from '../../combat/bolts';
import { boneForRole } from '../../player/rig';
import { BLADE_SWING, MUZZLE_PATTERNS, borrowSwingFigures, noteBladeSwing, returnSwingFigures } from './arms';
import { BLADE_RADIUS, BladePath, type Striker } from '../../combat/sweep';
import { CLASH } from '../../combat/clash.ts';
import { nextLivingKey, PLAYER_KEY, type Aggression, type Hittable, type Living, type Side } from '../../combat/kit';
import { hostileSides, sideOf } from '../../combat/targets';
import { Strikers } from '../../combat/strikers.ts';
import { copyBrain, mayFight, npcNow, NPC_TUNE, type NpcBolt, type NpcBrain, type NpcMark, type NpcRow, type NpcSubject } from '../../net/npcNet.ts';
import { markActor } from '../portalRender';
import { planBody, radiusToward, type BodyInput, type BodyPlan } from './shape';
import { moveSpeeds, stepGait, type GaitStep } from './gait';
import { BRAIN_TUNE, clampWander, decide, keepPost, type BrainSelf, type BrainTarget, type Decision, type Post } from './brain';
import { LOD_TUNE, type LodTier } from './lod';
import { gravityFor, holdAir } from './airless.ts';
import { easeShare, onFeet, resetStepWalker, stepAhead, stepHeightOf, stepWalker, stoodStill, walkStep, type StepRay, type StepShape, type StepTrace, type StepWalker } from './stepUp.ts';
import { rescaleBody, scaledByDifficulty } from '../difficulty.ts';
import { NavAgent } from '../nav/navAgent.ts';
import { DOOR_TUNE, DoorLegs, doorwayNav, placeOfCell, placeOfWalk, wallBetween, type GoalPlace } from '../nav/doorway.ts';
import { MOBILE_GRID_ACROSS, outdoorNav } from '../nav/outdoorNav.ts';
import { PATROL_TUNE, keepPatrol, thinkWalking, type Patrol } from '../patrols.ts';
// A person following the player (`src/world/followers.ts`): its place behind them, kept on every thought.
import { keepFollow, type FollowOrder } from '../followers.ts';
import { walkDecision, type RoutineWalk } from '../ambient/routines.ts';
import type { CellState } from '../layoutStream';
import { MobileAnimator, SHOT_PRIORITY } from './animator';
import { describeRoles, idleClipFor, ownGunIsPistol, rolesFor } from './packClips';
// The fighters' own carry and aim, borrowed whole rather than written a second time: pure, on the
// player's numbers, node-tested, and the bones it wants (`spine1..3`, the hand's weapon joint) are
// exactly the ones a mobile's clone carries. One knob moves a fighter's carry and a mobile's.
import { POSTURE_TUNE, STANCE_TUNE, aimMode, bodyShare, capsuleTopFor, easeAngle, paceInPosture, postureFor, spineShare, stanceFor, stepAimFix, wrapAngle, type AimFix, type AimWhen, type Posture, type PostureInput, type Stance, type StanceInput } from '../fighterStance.ts';
// And the rest of fighting as a fighter does, for a person: its tier from its level, its ring, its
// slide and its cover (`tactics.ts`), and Jedi Academy's roll and a jump by what it is (`evade.ts`).
import { GroundTactics, lowClipsFor, lowLoop, lowTransition, type LowClips } from './tactics.ts';
import { EVADE_TUNE, JUMP_TUNE, ROLL_CLIPS, aimedAt, jumpAcross, jumpClipName, jumpHeight, jumpSpeed, ledgeJump, rollCommit, rollDirection, rollVector, type AimLine, type LedgeAsk, type RollDir } from '../evade.ts';
import { tierOfLevel, willFire } from '../groundSkill.ts';
import { GROUND_STEP } from '../groundStep.ts';
import type { CoverDeps } from '../cover.ts';
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
/** A bolt off the wire asked of a blade (`npcHurt`): its heading, where it goes from the block, and where it leaves from. */
const blockDir = new THREE.Vector3();
const blockOut = new THREE.Vector3();
const blockAt = new THREE.Vector3();
/** Written into by the driven body every frame; the engine copies out of them at the call. */
const driveAt = { x: 0, y: 0, z: 0 };
const driveTurn = { x: 0, y: 0, z: 0, w: 1 };
/** What the step-up's rays found, written in place by every mobile in turn and read at once. */
const stepHit: StepRay = { toi: 0, ny: 0 };
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
/**
 * What a person's posture, a ledge and a roll are asked through, written in place by each body in
 * turn and read at once, as the fighters keep theirs: a literal a body a frame is an allocation a
 * body a frame.
 */
const postureAsk: PostureInput = { grounded: true, gun: false, combat: false, shooting: false, gap: Infinity, hpRatio: 1, pace: 'stand', held: false, canProne: false, was: 'stand', covered: false };
const ledgeAsk: LedgeAsk = { rise: 0, flat: 0, level: 0, grounded: true, chasing: false, free: true, outdoors: true, since: 0 };
const rollAt = { x: 0, z: 0 };
/** The velocity a roll or a jump writes onto the body, kept. */
const rollVel = { x: 0, y: 0, z: 0 };
/**
 * The linear damping every mobile's body is built with, which settles a walker's velocity between the
 * frames that write it. Off for the length of a jump of its own (`startJump`), put back on landing.
 */
const BODY_DAMPING = 0.6;
/**
 * A low shell's height against a standing one's: the fighters' own (`capsuleTopFor`), 1.0 m of the
 * player's 1.6 m, read live so the one knob that moves a fighter's low shell moves a person's.
 */
const lowShare = (): number => capsuleTopFor('crouch') / Math.max(1e-3, capsuleTopFor('stand'));

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
  /**
   * The ranged attack the gun its own creature's list put in its hand gives it, where its own numbers
   * give it none (`ArmsDecision.ranged` in arms.ts): what it holds and whether it shoots are one answer.
   */
  ranged?: { range: number; additive: boolean };
}

/** A weapon off the rack, loaded and prepared, for a person to hold. */
export interface MobileEquipment {
  /** The rack's id, for the console. */
  id: string;
  /** A fresh copy of the rack's model (its materials and geometry are the rack's, never disposed here). */
  model: THREE.Object3D;
  /** A gun, a lightsaber, or a blade, club, staff or fist weapon that is swung and never shoots. */
  kind: 'gun' | 'saber' | 'melee';
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
  /** The style a lightsaber is swung in, drawn from the spawn's own seed (`styleOf`); drawn here when absent. */
  saberStyle?: SaberStyle;
  /** The rack's class of the weapon, which says which styles a hilt may swing (a staff, or the three single ones). */
  weaponClass?: string;
}

/**
 * The roles a weapon's carry row speaks for (`rolesFromCarry` in arms.ts, and a lightsaber's swings):
 * what a body changes when what is in its hand changes, and nothing else (`Mobile.rearm`).
 */
const COMBAT_ROLES = ['idleCombat', 'walkCombat', 'runCombat', 'gaitsCombat', 'toCombat', 'fromCombat', 'attacks', 'ranged', 'rangedAdditive', 'rangedStance', 'rangedAimed', 'rangedShots'] as const;

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
  origin: 'spawned';
  inside: boolean;
  /** The appearance's bind-pose box and the pack's hierarchy, from the catalogue. */
  bounds: { min: Vec3; max: Vec3 };
  hierarchy: BodyInput['hierarchy'];
  /** Else picked in `entry.size.scale`. */
  scale?: number;
  /**
   * Its own numbers over its body's: the planet's own values for its wildlife, and a standing person's
   * own creature's (format 2's `game`) -- a body is shared by every creature drawn as it, and its
   * catalogue entry carries only one of theirs. `ranged` null is a creature that does not shoot, and
   * left out is the body's own; `level` is only ever shown.
   */
  overrides?: { hp?: number; damage?: number; aggression?: Aggression; level?: number; ranged?: { range: number; additive: boolean } | null };
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
  /**
   * The ground where the world already holds it, and whether a point is within the physics' reach: a body
   * outdoors past that reach reads the first and never makes terrain on the spot (commit 4b, `groundProbe.ts`).
   */
  groundIfCached?(x: number, z: number): number | null;
  groundSolid?(x: number, z: number): boolean;
  /**
   * The physics the cover search casts through (`cover.ts`), the manager's one adapter over the
   * streamer's blockers and the rays that stand still. With none, a person finds no cover and walks
   * into the open exactly as it always did.
   */
  cover?: CoverDeps | null;
  /**
   * How a lightsaber's blade renderer, which is this body's own, lets its materials go before it is
   * disposed: out of the portal renderer's set and the shadow cascades' map (`World.forgetMaterials`), both
   * strong, the first walked a dozen times a frame. With none they are only disposed, as they always were.
   */
  forgetMaterials?(materials: readonly THREE.Material[]): void;
}

export interface MobileContext {
  now: number;
  dt: number;
  camera: THREE.Camera | null;
  playerPos: THREE.Vector3;
  targets: readonly Living[];
  /**
   * Which room a living thing is in, as the world follows it: the player's own followed room, a
   * body's, a fighter's; null for open ground and undefined for something nobody follows. It is what
   * lets a body outside make for the door of the building somebody went into (`doorway.ts`), and
   * tell a wall between it and what it is fighting from a doorway it can strike through. With none,
   * every body steers exactly as it did before it could be told.
   */
  cellOf?(t: Living): CellState | null | undefined;
  /**
   * Where the player's gun is pointed, when it is up (`World.playerAim`): what makes a person say it
   * is being aimed at and throw itself aside. Null or off, only a blow from afar says so.
   */
  aim?: AimLine | null;
}

interface Grudge {
  who: Living;
  at: number;
  total: number;
}

export class Mobile implements Living, NpcSubject {
  /**
   * Its place in the one list of living things, for as long as it lives. A body is one life: whatever
   * comes back at its post is a new body with a key of its own, so a brain that remembered this one
   * never finds the next.
   */
  readonly key = nextLivingKey();
  readonly entry: MobileEntry;
  readonly origin: 'spawned';
  readonly label: string;
  /**
   * Whose side it is on. Not readonly, for one reason: a person asked to follow the player takes the
   * player's side for as long as it follows, and its own back when it is asked to stop
   * (`src/world/followers.ts`). Everything that reads a side reads it again each time.
   */
  side: Side;
  aggression: Aggression;
  /** Its own temper as it was stood, which a weapon put in an empty hand gives back (`rearm`). */
  private readonly baseAggression: Aggression;
  /** Whether it went passive for want of anything to fight with rather than by its own temper. */
  private emptyHanded = false;
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
  /**
   * The point the rest of the game shoots at, over its feet -- and not readonly, because a person's
   * moves with its posture, in the same call as its collision capsule and never apart (`reshape`),
   * exactly as a fighter's does: the capsule is the hitbox. Everything else stands at its plan's.
   */
  halfHeight: number;
  /** The standing aim point, which `halfHeight` goes back to when it gets up. */
  private readonly standHalfHeight: number;
  readonly hologram: boolean;
  /**
   * A person on the humanoid skeleton -- a catalogue NPC or a dressed one, never a creature, a droid
   * or a hologram -- which is what may fight as a fighter does (`tactics`), and jump.
   */
  readonly humanoid: boolean;
  hp: number;
  /**
   * Its whole health and its blow at the difficulty in force (`src/world/difficulty.ts`): its own
   * numbers times the knob, set again when the knob moves (`applyDifficulty`) from the two it was
   * stood with, which never change.
   */
  maxHp: number;
  blow: number;
  private readonly baseHp: number;
  private readonly baseBlow: number;
  /** Its level, where its own creature or its body's entry has one: the nameplate shows it and nothing else reads it. */
  readonly level: number | null;
  /** The ranged attack its own numbers give it, or null for none: its row's creature's where it has one, else its body's. */
  private readonly rangedStat: { range: number; additive: boolean } | null;
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
  /** Its walk between the street and a room, when what it is after is on the other side of a wall (`doorway.ts`). */
  readonly legs = new DoorLegs();
  /**
   * The room it was stood in, and null for a body stood on open ground: where home is, which a body
   * walking home from a fight is sent to the door of, and which leash it keeps -- a creature from the
   * sand that follows somebody into a cantina is still on the sand's leash, not a room's.
   */
  homeCell: CellState | null = null;
  /** The round a town's walker walks (`patrols.ts`); null for everything else. */
  patrol: Patrol | null = null;
  /**
   * One of ours walked by a routine rather than a brain (`src/world/ambient/`): where it is going and in
   * which room, or what it faces while it stands, written in place by whatever walks it. It is read on
   * every thought of a body that is part of the furniture, which every one of ours is.
   */
  routine: RoutineWalk | null = null;
  /**
   * Whether the mood it was stood in is for sitting down alone: a person of ours bound for a seat is
   * lent the chair's idle and stands in its own until it really sits (`sit`), since a lent sitting idle
   * played in a doorway is a body sitting on the air.
   */
  seatedIdleOnly = false;
  /** Where it sits, while it sits (`sit`): held there, out of the solver. Null while it stands. */
  private seatAt: { x: number; y: number; z: number; heading: number } | null = null;
  /** Its own pack's idle and the one laid over it (a mood's): what `sit` and `rise` move between. */
  private plainIdle: string | null = null;
  private laidIdle: string | null = null;
  /** Every time the stuck check has found it stuck, for the console: never reset, unlike `stuck`. */
  stuckEvents = 0;
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
  /**
   * A body that is part of the furniture: it stands where it was stood and nothing moves it.
   *
   * The ticket collector is the first of them and there will be many more -- the shopkeeper behind
   * a counter, the officer at a terminal, everyone the game had standing at a post. It takes no
   * damage, never dies, never picks a fight, never flees and never wanders, and it is the whole
   * brain that is skipped rather than each of its branches: a body that cannot think has no state to
   * be left in. What it still does is everything that makes it a body and not a statue -- it is
   * drawn, animated, lit, culled, followed through a building's portals and stood on the floor.
   */
  essential = false;
  /**
   * A fixture the world cannot work without, stood as one (`SpawnOpts.fixture`): the ticket collector.
   * Nobody talks such a body away from its post (`src/world/talk.ts`).
   */
  fixture = false;
  /**
   * The spot the data put it on, for a standing person, and how it keeps to it (`keepPost` in
   * `brain.ts`); null for everything else, whose wander is the brain's own.
   */
  post: Post | null = null;
  /**
   * Following the player (`src/world/followers.ts`): whom, and its place behind them, rewritten by the
   * follower set every step. While it is set its home is that place, so the brain's own leash measures
   * from the player, and the idle half of every decision is a walk to it (`keepFollow`). Null for every
   * body nobody has asked to follow.
   */
  follow: FollowOrder | null = null;
  /**
   * Being spoken to: the point it turns to, and holds still for, while the conversation lasts. Nothing
   * it would otherwise think of is thought of meanwhile -- no wander, no post, no walk of a round or a
   * routine -- and it is let go of the moment the conversation ends. Null the rest of the time.
   */
  listening: { x: number; z: number } | null = null;
  /** The decision a body in a conversation acts on: stand, and face the one speaking. Made once. */
  private readonly hearing: Decision = { state: 'idle', targetKey: null, moveTo: null, pace: 'stand', posture: 'stand', cover: false, face: null, attack: null, emote: null, wanderAt: 0, goal: null, until: 0, blockedSince: null, forgetKey: null, forgetUntil: 0, clearMemory: false };
  /**
   * Its own fighting tier, set by hand for this one body (`__debug.mobile(..., { tier })`), which wins
   * over the one the console sets for everybody and over its own level's; null for neither.
   */
  ownTier: number | null = null;
  /**
   * Whether the room it stands in has no collision under it this instant. A building's colliders
   * come and go with the player's distance while the room a body is in goes on answering from model
   * data, so a body left in a building the player has walked away from stands on a floor that is no
   * longer there. While this is set it holds the height it had, as the fighters do (`cellSolid`), and
   * stands on its own floor again the moment the colliders come back. The manager sets it.
   */
  private airless = false;
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
  /** Whether the mixer has run since the model was hung or the bones were put back to rest (`animate`). */
  private posed = false;
  /** What the body moves at: what the chosen gait's feet show. */
  private speed = 0;
  /** The acceleration's own progress toward the pace, from which the gait is chosen (never overwritten by the gait). */
  private ramp = 0;
  private readonly gaitOut: GaitStep = { clip: null, timeScale: 1, speed: 0, ramp: 0 };
  /** Where a chase faces this frame, kept rather than made anew. */
  private readonly faceAt = { x: 0, z: 0 };
  /** Where its goal is, written for the doorway join each frame it walks, never made. */
  private readonly goalPlace: GoalPlace = { building: null, room: 0 };
  /**
   * Whether what it is fighting stands on the other side of a wall from it: one of them in a building
   * and the other not, or the two in different buildings. A blow through a wall is not a blow, so a
   * body told this walks round to the door instead of stopping to swing at the plaster.
   */
  private apart = false;
  /** A walker's decision when it is part of the furniture and has no brain to make one, kept. */
  private walkerDecision: Decision | null = null;
  private readonly walkerSelf = { x: 0, z: 0, now: 0 };
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
  /** The muzzle its own skeleton has (a droid's gun bone), found when the model is hung; null for none. */
  private ownMuzzle: THREE.Object3D | null = null;
  /** The weapon in the hand, when it holds one off the rack; its bolt when it is a gun. */
  weapon: string | null = null;
  private gun: GunProfile | null = null;
  private holder: THREE.Group | null = null;
  private blade: SaberBlade | null = null;
  private hiltTop = 0.13;
  /**
   * Its lightsaber swung through the player's own move machine (`npcSaber.ts`) from the second tier up,
   * a fighter's own way; null for anything but a lightsaber. Below that tier, or before a species rig
   * lent it the machine's clips, it swings the ten one-hand swings it always has and this presses nothing.
   */
  private blades: NpcSaber | null = null;
  /** The move clip it last put on its animator, so letting a move go takes that clip off and never another. */
  private bladeAnim: string | null = null;
  /** The swing its ledger was last opened for, and whether a move that cuts was under way last frame. */
  private bladeSwing = 0;
  private bladeWas = false;
  /** The kick that has already landed, so a kick lands once. */
  private kickedFor = 0;
  /** Whether this swing of the machine's was ever swept, and whom it was aimed at: one never swept lands the old instant blow. */
  private bladeSwept = false;
  private bladeFoe: Living | null = null;
  /** Whether the cull was last asked while a special had the body. */
  private cullSpecial = false;
  /** A leap's push along the ground, when it began, until when it lasts, and whether it is in the air on one. */
  private leapVX = 0;
  private leapVZ = 0;
  private leapAt = 0;
  private leapUntil = 0;
  private leapAir = false;
  /** The living things it was last handed, for its blade's question about a foe behind it; read, never kept past a step. */
  private targetsSeen: readonly Living[] = [];
  /** What its blade is asked each frame and what a bolt meeting it is judged from: one each for its life. */
  private readonly bladeAsk: BladeAsk = { now: 0, dt: 0, lit: false, hasTarget: false, attackState: false, chasing: false, gap: Infinity, reach: 0, offNose: 0, grounded: true, vy: 0, above: 0, tumbling: false, stunned: false };
  private readonly blockAsk: BlockAsk = { lit: false, tumbling: false, dir: new THREE.Vector3(), hit: new THREE.Vector3(), eye: new THREE.Vector3(), forward: new THREE.Vector3(), right: new THREE.Vector3(), look: new THREE.Vector3() };
  private readonly moveScript: MoveScriptNow = { fmove: 0, smove: 0, hop: Number.NaN };
  /** A push along the ground worked out from its facing (`alongFacing`), written into. */
  private readonly pushAt = { x: 0, z: 0 };
  /**
   * The share of its own blow the swing of the machine's under way lands (`NpcSaber.shareOf`), measured
   * against its own cooldown between blows, so a chain lands no more over a fight than its own numbers
   * say. The old clock's swings land a whole blow each and never read it.
   */
  private bladeShare = 1;
  /** Arrows made once for its life: how long a clip lasts, whether it has one, a blade meeting another, a foe behind. */
  private readonly clipLength = (anim: string): number | null => {
    const d = this.animator?.duration(anim) ?? 0;
    return d > 0 ? d : null;
  };
  private readonly hasClip = (clip: string): boolean => !!this.animator?.has(clip);
  private readonly bladeClashed = (loser: boolean, bind: boolean): void => {
    if (loser && !bind) this.blades?.combat.clashed();
  };
  private readonly foeToward = (dir: Dir, radius: number): boolean => {
    for (const t of this.targetsSeen) {
      if (t.dead || t.key === this.key) continue;
      if (t.key !== this.targetKey && !this.memory.has(t.key) && !hostileSides(this, t)) continue;
      if (liesToward(dir, radius, this.facing, this.pos.x, this.pos.y, this.pos.z, t.pos.x, t.pos.y, t.pos.z)) return true;
    }
    return false;
  };
  /** Where its moves' whooshes are heard -- along its own blade -- and whose they are, so its next move takes back only its own. Made once. */
  private readonly voice: SaberVoice = {
    swing: (style, clip, seconds) => {
      const drawn = this.bladeTip.lengthSq() > 1e-6;
      const bx = drawn ? (this.bladeBase.x + this.bladeTip.x) * 0.5 : this.pos.x;
      const by = drawn ? (this.bladeBase.y + this.bladeTip.y) * 0.5 : this.pos.y + this.halfHeight;
      const bz = drawn ? (this.bladeBase.z + this.bladeTip.z) * 0.5 : this.pos.z;
      combatSounds.saberSwing(style, bx, by, bz, clip, seconds, this);
    },
    cancel: () => combatSounds.saberCancel(this),
  };
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
  /** What the step-up keeps between frames (`stepUp.ts`): the pace it was set at, when it may ask again, and its lifts. */
  private readonly stepWalk: StepWalker = stepWalker();
  /** How many times the step-up has lifted this body onto a step, for the console's trace of the people of ours. */
  get stepLifts(): number {
    return this.stepWalk.lifts;
  }
  /** The body the step-up climbs with, written in place before each ask (`stepShapeNow`). */
  private readonly stepShape: StepShape = { along: 0, rim: 0, step: 0, feet: 0 };
  /** The lifts the picture has already been eased over, and how far behind the body it is still drawn, in the body's own frame (up, forward). */
  private liftsSeen = 0;
  private liftLagY = 0;
  private liftLagZ = 0;
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
  /** Which way the roll or the jump that mark is about went, and whether the jump was the Force's. */
  private markDir: RollDir = 'F';
  private markForce = false;
  /**
   * A driven copy's jump, played from its keeper's mark: until when it is held in the air before it
   * lands. The place comes from the keeper's rows; this is only how long the clips say it is up.
   */
  private hopDownAt = 0;
  /**
   * A bolt that reached this body while another browser keeps it, held for the blow the same bolt is
   * about to strike (`blockBolt` is asked first, `damage` straight after): the keeper is asked whether
   * its blade turned it away, which needs the bolt's own flight. Only ever held for an instant, and only
   * on a body that carries a lightsaber.
   */
  private readonly heldBolt: NpcBolt = { dx: 0, dy: 0, dz: 1, speed: 0, color: 0xff4a2a, size: 1 };
  private heldBoltAt = -Infinity;
  /**
   * A body that is this browser's alone whatever it is (`neverShared`): today nothing sets it but the
   * console, and the named people of a story and a player's companions are what it is for. A follower is
   * the other such body, by its follow order.
   */
  companion = false;
  /**
   * How a person fights beyond what the brain decides -- its tier, its ring and its slide, its cover,
   * its evade and its jump (`tactics.ts`) -- made when it is hung and null for everything that is not
   * a person. Its tier is its own level's (`tierOfLevel`) unless the console says otherwise, and tier
   * 0 is none of it: the mobile this game had before.
   */
  tactics: GroundTactics | null = null;
  /**
   * How low it stands: upright, crouched, kneeling or flat, which is the fighters' own axis and their
   * own rule (`postureFor`), with what each means read out of the client's own state table. Only a
   * person whose pack carries the low postures (`lowClips`) ever leaves `stand`.
   */
  posture: Posture = 'stand';
  /** Seconds before it may take another posture, the settle a fighter keeps. */
  private postureHeld = 0;
  /** A posture put on by hand (`__debug.mobileTune({ posture })`), or null for the rule's. */
  private forcedPosture: Posture | null = null;
  /** The low postures its pack can draw, resolved when it is hung; null for a pack without them. */
  private lowClips: LowClips | null = null;
  /** The crouch walk as a gait list, kept, so the gait is chosen from it with nothing made. */
  private readonly crouchGaits: Gait[] = [];
  /** Whether its capsule is the low one this instant, so a change is written once. */
  private lowShape = false;
  /** A roll under way: seconds of it left, and the ground it covers a second while it lasts. */
  private rollLeft = 0;
  private rollVX = 0;
  private rollVZ = 0;
  /** Until when the roll's or a landing's clip still has the body, so nothing else is started over it. */
  private tumbleUntil = 0;
  /** A jump of its own under way: when it left the ground, which way, whether a Force jump, whether for a ledge. */
  private hopping = false;
  private hopAt = 0;
  private hopDir: RollDir = 'F';
  private hopForce = false;
  /** Its in-air loop for this jump, resolved as it left the ground so that no frame looks a name up. */
  private hopAir: string | null = null;
  /** Whether the last thought found its shot at what it is after clear: a ring is held only with one. */
  private lineSeen = false;
  /**
   * Whether this frame's travel is its own and not the brain's -- a cover spot, or a place on the ring
   * -- so the feet go there while the gun stays on what it fights; and whether the gun gave way to the
   * feet this frame, because the two were further apart than the legs can show on anything but a slide.
   */
  private splitMove = false;
  private gunOnFeet = false;
  /** How far its gun still had to turn to where it wanted it this frame, radians: what its trigger's cone reads. */
  private aimErr = 0;
  /** A shot of its own landing on something alive, counted for the console: one arrow for the body's life. */
  private readonly shotLanded = (_at: THREE.Vector3, hit: Hittable | null): void => {
    if (hit && this.tactics && typeof (hit as { key?: unknown }).key === 'number') this.tactics.counts.hits++;
  };

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
    this.standHalfHeight = this.halfHeight;
    this.hologram = (e.flags ?? []).includes('hologram');
    this.humanoid = (e.kind === 'npc' || e.kind === 'dressed') && spawn.hierarchy === 'all_b' && !this.hologram && this.plan.kind === 'upright';
    this.flyer = this.plan.hover > 0;
    this.label = e.name;
    this.side = sideOf(e);
    this.aggression = this.hologram ? 'passive' : (spawn.overrides?.aggression ?? e.stats?.aggression ?? 'defensive');
    this.baseAggression = this.aggression;
    this.baseHp = spawn.overrides?.hp ?? e.stats?.hp ?? 80;
    this.baseBlow = spawn.overrides?.damage ?? e.stats?.damage ?? 8;
    this.maxHp = scaledByDifficulty(this.baseHp);
    this.hp = this.maxHp;
    this.blow = scaledByDifficulty(this.baseBlow);
    this.level = spawn.overrides?.level ?? e.stats?.level ?? null;
    this.rangedStat = spawn.overrides && spawn.overrides.ranged !== undefined ? spawn.overrides.ranged : (e.stats?.ranged ?? null);
    this.heading = spawn.heading;
    this.facing = spawn.heading;
    this.homeX = spawn.x;
    this.homeZ = spawn.z;
    this.inside = spawn.inside;
    this.legs.who = e.name;

    const feet = this.plan.feet;
    tmpQ.setFromAxisAngle(UP, this.heading);
    const w = deps.physics.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y + feet + 0.05, spawn.z)
        .setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w })
        .lockRotations()
        .setLinearDamping(BODY_DAMPING)
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

  /** Its lit blade's own group, which hangs beside the body rather than under it; null with no blade. */
  get bladeRoot(): THREE.Object3D | null {
    return this.blade ? this.blade.group : null;
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

  /** Whether the room under it has no collision just now (see `airless`). The manager asks every frame; only a change does anything. */
  setAirless(airless: boolean): void {
    if (this.airless === airless || this.disposed) return;
    this.airless = airless;
    // A driven body is kinematic and goes where it is told; its gravity is set again when it is ours.
    if (this.driven || !this.body.isValid()) return;
    if (airless) holdAir(this.body);
    else this.body.setGravityScale(gravityFor(false, this.swimming, this.flyer, this.dead), true);
  }

  /**
   * The difficulty knob moved: its whole and its blow set again from its own numbers, keeping the share
   * of its health it had, so a body half dead stays half dead and nothing on its bar jumps. A dead body
   * stays dead; a driven one is told its health as a share anyway, so the keeper's knob is what counts.
   */
  applyDifficulty(scale: number): void {
    rescaleBody(this, this.baseHp, scale);
    this.blow = this.baseBlow * scale;
  }

  /**
   * Whether it is in a fight or has been in one lately: a target, a grudge it still holds, or a
   * fight's state. What makes room for somebody nearer must never put such a body down
   * (`StandingPeople`): somebody you are fighting does not vanish.
   */
  get engaged(): boolean {
    if (this.targetKey !== null || this.memory.size > 0) return true;
    const s = this.state;
    return s === 'alert' || s === 'chase' || s === 'attack' || s === 'cover' || s === 'flee' || s === 'return' || s === 'knockdown';
  }

  // ---- fighting as a fighter does ------------------------------------------------------------------
  //
  // A person from the catalogue: its tier from its level, its postures, its ring and its slide, its
  // cover, Jedi Academy's roll and a jump by what it is. Everything here is the fighters' own rules on
  // the fighters' own tables (`fighterStance.ts`, `groundSkill.ts`, `groundStep.ts`, `cover.ts`,
  // `evade.ts`); what is this file's is only the body it is done with, a dynamic one shared with every
  // creature. A creature, a droid and a hologram have no `tactics` and never reach any of it.

  /**
   * Its tier: its own when one was set for this body alone (`ownTier`), else `override` when the console
   * sets one for everybody, else its own level's (`tierOfLevel`). Tier 0 is none of this at all -- no
   * postures, no cover, no slide, no roll and no jump -- which is the mobile the game had before, so it
   * can be looked at beside the new one.
   */
  applyFightTier(override: number | null = null): void {
    const t = this.tactics;
    if (!t) return;
    t.setTier(this.ownTier ?? override ?? tierOfLevel(this.level), 'person', !!this.blade);
    if (!t.skill && this.posture !== 'stand' && !this.forcedPosture) this.setPosture('stand');
    // Its blade is judged at the same rung (`npcSaber.ts`), and hears a change of it on its next step.
    if (this.blades) this.blades.tier = t.tier;
  }

  /** Hold it in one posture by hand, or hand it back to the rule with null. The settle does not apply. */
  forcePosture(p: Posture | null): void {
    if (!this.lowClips) return;
    this.forcedPosture = p;
    if (p) {
      this.postureHeld = 0;
      this.setPosture(p);
    }
  }

  /** Rolling, or in the air on a jump of its own: its steering and its blows wait until it is done. */
  private get tumbling(): boolean {
    return this.rollLeft > 0 || this.hopping;
  }

  /** A saber move other than the ready stance is under way: it stands for it, and nothing else starts over it. */
  private get bladeBusy(): boolean {
    return !!this.blades && this.blades.busy;
  }

  /** Whether its blade swings through the move machine this instant (tier 2 up, the clips lent), rather than the old swings. */
  private get bladesOn(): boolean {
    return !!this.blades && this.blades.active && !this.driven;
  }

  /**
   * Go into a posture, and write its capsule and its aim point for it. Counted when it goes low, for
   * the console's measure of how often a fight puts people on a knee or on the ground.
   */
  private setPosture(p: Posture): void {
    const was = this.posture;
    this.posture = p;
    const c = this.tactics?.counts;
    if (c && p !== was) {
      if (p === 'kneel') c.kneels++;
      else if (p === 'prone') c.prones++;
      else if (p === 'crouch') c.crouches++;
    }
    // Asked whether or not the posture changed: a roll that has just been let go of leaves the shell
    // low under a body that never left `stand`.
    this.reshape();
    // Flat it lies outside the standing body's sphere (`BodyPose.low`), and a knee is the rule's own
    // switch (`LOW_CULL.kneelWhole`): asked again whenever either changes, the fighter's own test, so
    // going straight from a knee to flat (or back) is asked too -- the two answer differently whenever
    // the knee is culled.
    if ((p === 'prone') !== (was === 'prone') || (p === 'kneel') !== (was === 'kneel')) this.applyCull();
  }

  /**
   * The capsule and the aim point for the posture it is in, or for a roll: **moved in one call and
   * never apart**, since a bolt is a ray against the physics and the struck collider is the hitbox.
   * The fighters' own shapes (`capsuleTopFor`): the low shell is the standing one's share of 1.0 m to
   * 1.6 m, its feet where they were, and the aim point is its middle. One capsule reshaped, as the
   * player's and a fighter's are, rather than a second switched on and off, so no new handle has to be
   * taught to the manager's lookup or to the bolts.
   */
  private reshape(): void {
    const low = this.posture !== 'stand' || this.rollLeft > 0;
    if (low === this.lowShape) return;
    const c = this.colliders[0];
    const p = this.plan.colliders[0];
    if (!c || !p || p.shape !== 'capsule' || !c.isValid()) return;
    this.lowShape = low;
    const standTotal = 2 * (p.half + p.radius);
    const half = low ? Math.max(0.01, (standTotal * lowShare()) / 2 - p.radius) : p.half;
    // Its feet stay where the standing shell's were: the capsule's own bottom over the body's origin.
    const bottom = p.at[1] - (p.half + p.radius);
    const y = bottom + p.radius + half;
    c.setHalfHeight(half);
    c.setTranslationWrtParent({ x: p.at[0], y, z: p.at[2] });
    // And in the world as well, which is what every bolt already in the air reads this frame.
    c.setTranslation({ x: this.pos.x + p.at[0], y: this.pos.y + this.plan.feet + y, z: this.pos.z + p.at[2] });
    this.halfHeight = low ? p.radius + half : this.standHalfHeight;
  }

  /**
   * How low it stands this frame: `postureFor`, the fighters' own rule, fed from the brain's own
   * answer and what this body already knows, and written back onto the decision. A pack that cannot
   * draw the low postures never leaves `stand`, and neither does a body with no tier. The game's own
   * one-shot between two postures plays over the change where the pack has it.
   */
  private stepPosture(dt: number, pace: 'stand' | 'walk' | 'run', target: Living | null, d: Decision | null): void {
    this.postureHeld = Math.max(0, this.postureHeld - dt);
    const tac = this.tactics;
    const c = this.lowClips;
    if (!c || !tac?.skill) {
      if (this.posture !== 'stand' && !this.forcedPosture) this.setPosture('stand');
      return;
    }
    const ask = postureAsk;
    ask.grounded = this.grounded;
    ask.gun = !!this.gun && this.rangedRange > 0;
    ask.combat = this.now < this.readyUntil;
    // `cover` is the attack state under another name: a body behind a crate that can see you is shooting.
    ask.shooting = !!d && (d.state === 'attack' || d.state === 'cover') && d.attack === 'ranged' && !!target && !target.dead;
    // Standing in cover it cannot shoot out of: the one place it goes low with no shot to take.
    ask.covered = tac.coverKind === 'hard' && tac.inSpot(this.pos.x, this.pos.z);
    ask.gap = target ? Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z) : Infinity;
    ask.hpRatio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    ask.pace = pace;
    // A walker on a round or a routine is under orders, as a fighter under a long walk is.
    ask.held = !!this.routine || this.essential;
    ask.canProne = c.canProne;
    ask.was = this.posture;
    const want = this.forcedPosture ?? postureFor(ask);
    if (d) d.posture = want;
    if (want === this.posture || this.postureHeld > 0) return;
    this.postureHeld = POSTURE_TUNE.settle;
    const was = this.posture;
    this.setPosture(want);
    const animator = this.animator;
    const pack = this.animPack;
    if (!animator || !pack) return;
    const clip = lowTransition(pack.json, was, want, pace !== 'stand', (n) => animator.has(n));
    if (clip) animator.once(clip, { priority: SHOT_PRIORITY.hit, fadeIn: 0.08, fadeOut: 0.15 });
  }

  /**
   * Whether it gets behind things at all, which is what it tells the brain (`BrainSelf.seeksCover`):
   * a capability and not a kind, as a fighter's is -- a tier of its own, a gun in its hand that shoots,
   * out of doors where the streamer builds what a body would hide behind, and its own fight to fight.
   */
  private seeksCover(): boolean {
    return !!this.tactics?.skill && !!this.gun && this.rangedRange > 0 && !this.inside && !this.routine && !this.essential;
  }

  /**
   * Somewhere to stand out of the line of fire, for a tiered person with a gun out of doors: the
   * fighters' own rule through `GroundTactics.stepCover`, with the brain's `d.cover` as whether to look.
   * Every other body lets go of any spot it had, as a fighter does.
   */
  private stepCover(target: Living | null, d: Decision | null): boolean {
    const tac = this.tactics;
    const deps = this.deps.cover;
    if (!tac?.skill || !deps || !target || target.dead || !d || !this.gun || !(this.rangedRange > 0) || this.inside || this.routine) {
      if (tac?.coverKind) tac.dropCover(this.now, false);
      return false;
    }
    return tac.stepCover(this.now, deps, this.pos.x, this.pos.y, this.pos.z, target.key, target.pos.x, target.pos.y + target.halfHeight, target.pos.z, d.cover === true, this.inside);
  }

  /**
   * Which way the feet go while a move of its own is under way, radians. A **slide** keeps them within
   * its tier's lean of the gun (`slideLean`), so it becomes a diagonal and the gun stays on what it
   * fights; anything else past what the legs can show (`GROUND_STEP.legMax`) turns the body and takes
   * the gun with it (`gunOnFeet`), and so does every move of a tier that has not earned the split --
   * the fighters' own division of it, since there is no strafe clip in either game.
   */
  private legsWant(face: { x: number; z: number }, look: { x: number; z: number } | null): number {
    const travel = Math.atan2(face.x - this.pos.x, face.z - this.pos.z);
    this.gunOnFeet = false;
    const tac = this.tactics;
    if (!this.splitMove || !look || !tac) return travel;
    if (!tac.split) {
      this.gunOnFeet = true;
      return travel;
    }
    const aim = Math.atan2(look.x - this.pos.x, look.z - this.pos.z);
    const off = wrapAngle(travel - aim);
    const lean = tac.leanOnly ? tac.slideLean : GROUND_STEP.legMax;
    if (Math.abs(off) <= lean) return travel;
    if (tac.leanOnly && Math.abs(off) <= Math.PI / 2 + 0.01) return aim + Math.sign(off) * lean;
    this.gunOnFeet = true;
    return travel;
  }

  /**
   * Whether to throw itself aside, or jump up to somebody on a ledge, asked once a thought. Aimed at
   * is the player's gun pointed within reach of it **while it is in a fight** (`fighting`), or a blow
   * from afar a moment ago (`EvadeClock`); how often is its tier's share a second, compounded over the
   * thought (`evade.ts`). A person at its post, in a queue or walking its round that the player merely
   * looks at down a raised gun has nothing to throw itself away from: only a blow makes it one.
   */
  private stepEvade(ctx: MobileContext): void {
    const tac = this.tactics;
    if (!tac?.skill || this.essential || this.routine || this.driven || this.dead || !this.animator) return;
    const now = this.now;
    // Not in the middle of a saber move either, whose clip has the whole body, nor up on a leap of one.
    const free = !this.tumbling && now >= this.tumbleUntil && this.stunned <= 0 && !this.downPhase && this.heldUntil <= now && this.swingAt === 0 && now >= this.swingUntil && !this.bladeBusy && now >= this.leapUntil && this.posture !== 'prone' && !this.swimming && !this.flyer && !this.seatAt && !!this.tier?.move;
    const target = this.targetRef;
    const gap = target ? Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z) : Infinity;
    const level = this.inside ? 0 : tac.jumpLevel;
    // A ledge first: whatever it is chasing stands above it within its jump, and near.
    if (target && !target.dead && level > 0 && this.decision?.state === 'chase') {
      const a = ledgeAsk;
      a.rise = target.pos.y - this.pos.y;
      a.flat = gap;
      a.level = level;
      a.grounded = this.grounded;
      a.chasing = true;
      a.free = free;
      a.outdoors = !this.inside;
      a.since = now - tac.evade.jumpAt;
      const height = ledgeJump(a);
      if (height > 0 && gap > 1e-3) {
        // Over the lip as it tops out, and down onto the ledge just past it.
        const across = jumpAcross(gap, height, this.gravityNow(), 'top');
        if (this.startJump(height, (target.pos.x - this.pos.x) / gap, (target.pos.z - this.pos.z) / gap, across, 'F')) tac.evade.jumped(now, true);
        return;
      }
    }
    const aimed = (this.fighting() && aimedAt(ctx.aim, this.pos.x, this.pos.y + this.halfHeight, this.pos.z)) || tac.evade.shotLately(now);
    const kind = tac.evade.due(now, tac.tier, aimed, this.grounded, free, this.animator.has('BOTH_ROLL_L'), level, Math.random(), Math.random());
    if (!kind) return;
    const side = Math.random() < 0.5 ? 1 : -1;
    if (kind === 'roll') {
      this.startRoll(rollDirection(side, gap));
      return;
    }
    // A hop (only with `hopShare` raised, D9 being the roll only): aside, or at what it fights for a
    // blade still far off, which has to close to do anything -- down on level ground at its mark.
    const height = jumpHeight(level);
    if (this.blade && target && gap > EVADE_TUNE.leapFrom) {
      const across = jumpAcross(gap - EVADE_TUNE.leapFrom * 0.5, height, this.gravityNow(), 'land');
      this.startJump(height, (target.pos.x - this.pos.x) / gap, (target.pos.z - this.pos.z) / gap, across, 'F');
    } else {
      const dir: RollDir = side > 0 ? 'L' : 'R';
      rollVector(dir, this.facing, rollAt);
      this.startJump(height, rollAt.x, rollAt.z, EVADE_TUNE.rollSpeed, dir);
    }
    tac.evade.jumped(now, false);
  }

  /** What gravity pulls this body down at, metres a second squared: the world's, by its own scale. */
  private gravityNow(): number {
    const g = this.deps.physics.world.gravity;
    return Math.abs(g.y) * (this.body.isValid() ? this.body.gravityScale() : 1);
  }

  /**
   * Jedi Academy's roll: along `dir` off the way its gun faces, at the roll's own speed for its own
   * length of time (`EVADE_TUNE`, the player's own figures), on the low shell so the shot it dodged goes
   * over, with the lent clip played over its loop. Refused for a body that cannot be drawn rolling.
   */
  private startRoll(dir: RollDir): boolean {
    const animator = this.animator;
    const clip = ROLL_CLIPS[dir];
    if (!animator?.has(clip) || !this.body.isValid()) return false;
    rollVector(dir, this.facing, rollAt);
    this.rollVX = rollAt.x * EVADE_TUNE.rollSpeed;
    this.rollVZ = rollAt.z * EVADE_TUNE.rollSpeed;
    this.rollLeft = EVADE_TUNE.rollTime;
    const length = animator.once(clip, { priority: SHOT_PRIORITY.attack, fadeIn: 0.05, fadeOut: 0.15 }) ?? 0;
    // Held until the clip has run out, or for the roll and the knob's recovery after it (`rollCommit`).
    this.tumbleUntil = this.now + rollCommit(length);
    this.startTumble();
    // Every other browser is told, so its copy rolls rather than sliding along the ground it covers.
    this.mark = 'roll';
    this.markDir = dir;
    return true;
  }

  /**
   * A jump of its own to `height`, carried `across` metres a second along (`dx`, `dz`): the dynamic
   * body is thrown and falls under the world's own gravity, with Jedi Academy's jump for the direction
   * (a Force jump's past the plain one's height) played as it leaves the ground, its in-air loop under
   * it and its landing when it comes down (`stepTumble`).
   */
  private startJump(height: number, dx: number, dz: number, across: number, dir: RollDir): boolean {
    const animator = this.animator;
    if (!animator || !this.body.isValid() || !(height > 0)) return false;
    const up = jumpSpeed(height, this.gravityNow());
    if (!(up > 0)) return false;
    this.hopForce = height > (JUMP_TUNE.heights[1] ?? 0) + 1e-3;
    this.hopDir = dir;
    // Undamped for the flight. The body's own linear damping (`BODY_DAMPING`) is there to settle a
    // walker, and left on it takes the launch down with it: a jump thrown at `sqrt(2 g h)` then tops out
    // at 71 to 85 per cent of the height it was thrown for, and a ledge in the top of a level's reach
    // is tried every `JUMP_TUNE.every` seconds and never reached. Put back as it lands (`endTumble`).
    this.body.setLinearDamping(0);
    rollVel.x = dx * across;
    rollVel.y = up;
    rollVel.z = dz * across;
    this.body.setLinvel(rollVel, true);
    this.grounded = false;
    this.hopping = true;
    this.hopAt = this.now;
    // Off the ground of its own accord: every other browser is told which jump, so its copy plays the
    // same clips over the arc its keeper's rows carry it along.
    this.mark = 'jump';
    this.markDir = dir;
    this.markForce = this.hopForce;
    this.hopAir = jumpClipName('INAIR', dir, this.hopForce, animator);
    const clip = jumpClipName('JUMP', dir, this.hopForce, animator);
    if (clip) animator.once(clip, { priority: SHOT_PRIORITY.attack, fadeIn: 0.05, fadeOut: 0.12 });
    this.startTumble();
    return true;
  }

  /** What starting a roll or a jump takes off it: its blows under way, its walk, and any low posture. */
  private startTumble(): void {
    this.swingAt = 0;
    this.swingUntil = 0;
    // A saber move under way is let go of: the roll's or the jump's clip has already taken the animator.
    this.dropBlades();
    this.shotsLeft = 0;
    this.speed = 0;
    this.ramp = 0;
    this.forcedPosture = null;
    if (this.posture !== 'stand') {
      this.posture = 'stand';
      this.postureHeld = 0;
    }
    this.reshape();
    this.applyCull();
  }

  /**
   * A roll or a jump let go of, whatever became of it: its shell back to its posture's, its damping
   * back, and the cull asked again. Called **while it is still rolling or in the air** -- the guard is
   * what keeps a Force hold, a knock or a death from asking the cull every frame -- which is why
   * `stepTumble` ends a roll before it writes the roll's last second off rather than after.
   */
  private endTumble(): void {
    if (!this.tumbling) return;
    this.rollLeft = 0;
    if (this.hopping) {
      this.hopping = false;
      if (this.body.isValid()) this.body.setLinearDamping(BODY_DAMPING);
    }
    this.reshape();
    this.applyCull();
  }

  /**
   * Everything of a roll or a jump let go of at once, the clip that ends one included: for a body that
   * will not step `act` to find that clip run out (one handed to another browser to drive) or that is
   * starting a fresh life. The clock goes first, so the cull `endTumble` asks is the standing one.
   */
  private dropTumble(): void {
    this.tumbleUntil = 0;
    this.endTumble();
    if (this.cullTumble) this.applyCull();
  }

  /**
   * One frame of a roll or a jump, which is all a body does while one is under way: a roll holds its
   * ground speed along the roll for the roll's length, and a jump goes where it was thrown until it
   * stands on something again coming down, when it lands. A jump that has not come down in a few
   * seconds -- stuck on a ledge's lip, held up in a room with no floor built -- is let go all the same.
   */
  private stepTumble(dt: number): void {
    if (this.rollLeft > 0) {
      const v = this.body.linvel();
      rollVel.x = this.rollVX;
      rollVel.y = v.y;
      rollVel.z = this.rollVZ;
      this.body.setLinvel(rollVel, true);
      // Ended before the time left is written off, never after: `endTumble` asks `tumbling`, which a
      // roll with nothing left no longer is, and a roll written down to nothing first would leave the
      // body standing on the low shell, aimed at half a metre low and drawn whole, until it next knelt.
      const left = this.rollLeft - dt;
      if (left <= 0) this.endTumble();
      else this.rollLeft = left;
    } else if (this.hopping) {
      const up = this.now - this.hopAt;
      if (up > 0.2 && this.grounded && this.body.linvel().y <= 0.5) {
        const animator = this.animator;
        const clip = animator ? jumpClipName('LAND', this.hopDir, this.hopForce, animator) : null;
        if (clip && animator) {
          const length = animator.once(clip, { priority: SHOT_PRIORITY.hit, fadeIn: 0.05, fadeOut: 0.15 }) ?? 0;
          this.tumbleUntil = Math.max(this.tumbleUntil, this.now + Math.min(0.6, length));
        }
        this.endTumble();
      } else if (up > 4) this.endTumble();
    }
    if (!this.downPhase) this.animator?.loop(this.idleNow(), 1);
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
    // One skeleton for the meshes that shared one in the model (commit 3a), not one for each.
    const scene = cloneShared(model.scene);
    const names = new Set<string>();
    const spines: THREE.Bone[] = [];
    scene.traverse((o) => {
      names.add(o.name);
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        this.meshes.push(m);
        // Culled as a whole by the manager, and mesh by mesh only through the sphere set below.
        m.frustumCulled = false;
      }
      // Found on the one walk the clone already takes, rather than on a walk of its own: this runs once
      // per body and the aim then costs a list lookup a frame. No rest pose is kept: nothing stands a body
      // up again in place, so nothing ever needs one put back.
      if ((o as THREE.Bone).isBone && SPINE_BONE.test(o.name)) spines.push(o as THREE.Bone);
    });
    this.spines = spines;
    this.carry = extras?.carry ?? 'unarmed';
    this.carried = !!extras?.carried;
    markActor(scene);
    this.inner.add(scene);
    this.model = scene;
    // Each mesh culled on its own in every pass and cascade (commit 3c).
    this.refitCull();
    // A new skeleton in its rest pose: posed on its first step, whatever its tier.
    this.posed = false;
    let warning: string | null = null;
    if (pack) {
      this.roles = rolesFor(pack.json, this.entry.gender);
      // The pack's own ranged attack, kept before the carry is laid over it: it is what a row whose
      // clips the bake left out falls back on, below.
      const ownRanged = this.roles.ranged;
      const ownAdditive = this.roles.rangedAdditive;
      // Its own idle, kept before anything is laid over it, so one of ours bound for a seat stands in
      // it until it sits and in the lent one only once it does (`sit`, `rise`).
      this.plainIdle = this.roles.idle;
      // A rifle's carry, a Jedi's swings: laid over the pack's roles, with any clips they name.
      if (extras?.roles) Object.assign(this.roles, extras.roles);
      this.laidIdle = this.roles.idle;
      if (this.seatedIdleOnly && !this.seatAt) this.roles.idle = this.plainIdle;
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
      this.fitArms(ownRanged, ownAdditive, extras?.ranged ?? null);
      this.canSwim = !!(r.swim || r.swimIdle);
      if (this.entry.flags?.includes('static')) this.speeds = { walk: 0, run: 0 };
      // Nothing to strike or shoot with: passive, whatever the keywords say.
      if (!this.melee && !this.rangedRange) this.disarmTemper();
    } else this.aggression = 'passive';
    for (const re of MUZZLE_BONES) {
      scene.traverse((o) => {
        if (!this.muzzle && (o as THREE.Bone).isBone && re.test(o.name)) this.muzzle = o;
      });
      if (this.muzzle) break;
    }
    // Its skeleton's own, which a gun taken out of its hand again leaves it with (`unequip`).
    this.ownMuzzle = this.muzzle;
    // A person fights as a fighter does (`tactics.ts`): its low postures where its pack can draw them,
    // the crouch walk as a gait of its own, and its tier from its own level. The manager lays the
    // console's tier over it once the weapon is in its hand (`applyFightTier`), since a lightsaber
    // changes how high it jumps.
    if (this.humanoid && pack && this.animator) {
      this.fitLow(pack);
      this.tactics ??= new GroundTactics(this.key % 2 === 0 ? 1 : -1);
      this.applyFightTier();
    }
    this.state = 'idle';
    this.animator?.loop(this.idleNow(), 1, 0);
    // Asked again now its idle is known: a mood's idle may lay it at full length (`refitCull` above ran before the roles).
    this.applyCull();
    return { ok: true, warning };
  }

  /**
   * What its roles and what its hands were given say it fights with: a blow of its own where it has
   * swings, the aimed pose and the whole-body shots only where the GLB really has them, and a shot only
   * where its own numbers give it a ranged attack or the gun in its hand does (`given`). `ownRanged` and
   * `ownAdditive` are its pack's own ranged attack, which a row whose shots the bake left out falls back
   * on. Asked when the model is hung, and again whenever what is in its hand changes (`rearm`).
   */
  private fitArms(ownRanged: string | null, ownAdditive: boolean, given: { range: number; additive: boolean } | null): void {
    const r = this.roles;
    const animator = this.animator;
    if (!r || !animator) return;
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
    // Only what its own numbers give a ranged attack shoots, or the gun its own list put in its hand
    // (`extras.ranged`): a pack with a ranged clip is not enough.
    const ranged = this.rangedStat && this.rangedStat.range > 0 ? this.rangedStat : given;
    this.rangedRange = r.ranged && !this.hologram && ranged && ranged.range > 0 ? ranged.range * Math.max(1, Math.sqrt(this.scale)) : 0;
  }

  /**
   * Passive for want of anything to strike or shoot with, whatever its keywords say -- and remembered as
   * that, so a weapon put in its hand later gives it its own temper back (`rearm`).
   */
  private disarmTemper(): void {
    if (this.aggression !== 'passive') this.emptyHanded = true;
    this.aggression = 'passive';
  }

  /** The low postures its pack can draw for what it carries now, and the crouch walk as a gait of its own. */
  private fitLow(pack: PackAsset): void {
    const played = this.animator;
    if (!played) return;
    const kind = this.carry === 'pistol' || this.carry === 'rifle' ? this.carry : null;
    this.lowClips = lowClipsFor(pack.json, kind, (c) => played.has(c));
    this.crouchGaits.length = 0;
    if (this.lowClips?.crouchWalk) this.crouchGaits.push({ clip: this.lowClips.crouchWalk, speed: this.lowClips.crouchSpeed });
  }

  /**
   * The weapon it holds taken out of its hand: the rack's copy let go (its geometry and materials are the
   * rack's and are never disposed here), a lightsaber's blade renderer disposed and its moves dropped, and
   * its muzzle back on its own skeleton. What its roles say it fights with is `rearm`'s to put right.
   */
  private unequip(): void {
    if (this.blade) {
      this.dropBlades();
      this.disposeBlade();
    }
    this.blades = null;
    this.bladeAnim = null;
    const holder = this.holder;
    if (holder) {
      holder.parent?.remove(holder);
      // Its meshes out of the list the manager writes the shadow flag on, in place.
      let n = 0;
      for (const m of this.meshes) {
        let under = false;
        for (let o: THREE.Object3D | null = m; o; o = o.parent) {
          if (o === holder) {
            under = true;
            break;
          }
        }
        if (!under) this.meshes[n++] = m;
      }
      this.meshes.length = n;
    }
    this.holder = null;
    this.weapon = null;
    this.gun = null;
    this.hiltTop = 0.13;
    this.muzzle = this.ownMuzzle;
    this.refitCull();
  }

  /**
   * Its lightsaber's blade renderer taken off and disposed, its materials let go of first (`forgetMaterials`):
   * they joined the portal renderer's set and the cascades' map the first time the scan met them, and a
   * disposed material left in either is walked for the rest of the world's life. A re-arm can do this to one
   * body any number of times, which is why it is not left to the world's unload.
   */
  private disposeBlade(): void {
    const blade = this.blade;
    if (!blade) return;
    blade.group.parent?.remove(blade.group);
    const forget = this.deps.forgetMaterials;
    if (forget) {
      const materials: THREE.Material[] = [];
      blade.group.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        if (Array.isArray(m)) materials.push(...m);
        else materials.push(m);
      });
      if (materials.length) forget(materials);
    }
    blade.dispose();
    this.blade = null;
  }

  /**
   * What is in its hand changed while it stands (`MobileManager.rearm`, the console's `arm`): the weapon it
   * holds goes (`unequip`) and `e` takes its place, with the fighting roles its carry row gives (`extras`).
   * Only the fighting roles move -- the combat stance and gaits, the swings, the shots -- and they are its
   * pack's own again first, so nothing of the last weapon's row is left over; how it idles, walks and runs,
   * and the mood it was stood in, are its own and stay. A body that had nothing to fight with and has now
   * gets its own temper back; one left with nothing goes passive, as one stood empty-handed always has.
   * Nothing here compiles: the weapon was prepared before it was handed over, and a lightsaber's blade is a
   * program every loading screen already built. False with no body to arm (loading, dead, gone) or no hand.
   */
  rearm(e: MobileEquipment | null, extras: MobileExtras | null): boolean {
    const pack = this.animPack;
    const r = this.roles;
    const animator = this.animator;
    if (this.disposed || this.dead || !this.model || !pack || !r || !animator) return false;
    this.unequip();
    if (extras?.clips?.size) animator.lend(extras.clips);
    const own = rolesFor(pack.json, this.entry.gender);
    const into = r as unknown as Record<string, unknown>;
    const fresh = own as unknown as Record<string, unknown>;
    const laid = (extras?.roles ?? {}) as Record<string, unknown>;
    for (const k of COMBAT_ROLES) into[k] = laid[k] !== undefined ? laid[k] : fresh[k];
    this.carry = extras?.carry ?? 'unarmed';
    this.carried = !!extras?.carried;
    this.fitArms(own.ranged, own.rangedAdditive, extras?.ranged ?? null);
    if (this.humanoid) this.fitLow(pack);
    if (!this.lowClips && this.posture !== 'stand') this.setPosture('stand');
    // Whatever it was doing with the last weapon is let go of: a burst, its aim, a decision about a range.
    this.shotsLeft = 0;
    this.dropAim();
    this.decision = null;
    this.thinkAt = 0;
    const fights = this.melee || this.rangedRange > 0;
    if (fights && this.emptyHanded) {
      this.aggression = this.baseAggression;
      this.emptyHanded = false;
    } else if (!fights) this.disarmTemper();
    if (e && !this.equip(e)) return false;
    if (!this.downPhase) animator.loop(this.idleNow(), 1, 0.25);
    return true;
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
    // Rigid, and culled by its own geometry's sphere along with the body (commit 3c): it hangs in the model now.
    this.refitCull();
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
      // Its moves: the player's own machine, pressed from its tier (`npcSaber.ts`), in the style its seed
      // drew among those its hilt can swing, heard through its own voice -- but only where a species rig
      // has lent it the machine's clips (`MobileManager.saberClips`), or it would swing a machine it
      // cannot draw. A blade of its that gives way in a clash cuts its swing short into the return.
      const style = e.saberStyle ?? styleOf(Math.random(), e.weaponClass);
      if (canSwing(style, this.hasClip)) {
        const blades = new NpcSaber(this.voice, this.foeToward);
        blades.weaponClass = e.weaponClass ?? null;
        blades.own = style;
        blades.tier = this.tactics?.tier ?? 0;
        this.blades = blades;
        blade.onClash = this.bladeClashed;
      }
    } else if (e.kind === 'melee') {
      // A knife, a sword, an axe, a staff, a knuckler: held as the game's own model has it on the
      // weapon joint, swung by its carry row's clips, and never shot from, for the reason a lightsaber
      // is not. It has no blade to draw, so its blow lands as a body's own blow does.
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
    // A swing is live from the moment the clip's blow would have landed until its window shuts, or
    // for as long as a move of the machine's that cuts is under way (`stepBlades`), so the smear, the
    // clashes and the sweep below all read the one answer.
    const machine = this.bladeWas;
    const swinging = this.swingAt > 0 || this.now < this.swingUntil || machine;
    // Whose blade it is when it meets another, and what it weighs (src/combat/clash.ts): its style's,
    // from the second tier up, else the medium the old one-hand swings are. Without this it owns
    // nobody, and two blades that own nobody never clash with each other.
    b.owner = this.key;
    b.attacking = swinging;
    b.clashWeight = this.bladesOn && this.blades ? CLASH.weights[this.blades.style] : CLASH.weights.medium;
    b.update(dt, this.bladeBase, this.bladeTip, on, camera ?? IDLE_CAMERA, swinging ? 1 : this.speed > 0.5 ? 0.3 : 0, this.dead);
    // Swinging, the blade cuts what it has passed through since the last frame; standing, it only
    // writes down where it is, so the first cut of the next swing steps from the blade itself. A
    // driven body (another browser thinks for it) never swings here: its keeper's blow crosses.
    if (this.driven || this.dead || !this.deps.hittableAt) return;
    if (this.now >= this.swingUntil && !machine) {
      this.bladePath.mark(this.bladeBase, this.bladeTip, this.now);
      return;
    }
    this.bladeSwept = true;
    const strike = (this.strike ??= { physics: this.deps.physics, hittableAt: this.findLiving, effects: null, source: this, from: this.pos, exclude: this.body, spare: null, radius: BLADE_RADIUS, damage: this.blow, push: 3, color: b.color.getHex(), now: 0 });
    strike.effects = this.deps.effects();
    // A whole blow for the old clock's swings; a share of one for a swing of the move machine's.
    strike.damage = machine ? this.blow * this.bladeShare : this.blow;
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
    // Landed: the next swing's share is measured from here.
    if (hits > 0) this.blades?.landed(this.now);
    // One sound a swing, not one a frame: a swing that catches three bodies over three of its
    // frames is one blow landing, exactly as the instant blow it replaces was.
    if (hits > 0 && !this.swingSounded) {
      this.swingSounded = true;
      tmp2.copy(this.bladeBase).lerp(this.bladeTip, 0.5);
      combatSounds.saberContact('body', tmp2.x, tmp2.y, tmp2.z);
    }
  }

  /**
   * One frame of its lightsaber through the move machine (`npcSaber.ts`), from the second tier up, a
   * fighter's own way (`Npc.stepBlades`): the brain's answer turned into the keys the player would
   * press, each move played over its loop and held so it runs straight on into the next with no dip to
   * the loop between, and the blade cutting while a move that cuts is under way. A leap or a lunge
   * carries the body by its own push, a kick lands once, and a swing its blade could never sweep (a
   * body culled as a group, or no lookup wired) lands the old instant blow when it ends. Every frame it
   * is its own and alive; below the second tier, or with the blade put away, the machine is let go of
   * and this does nothing.
   */
  private stepBlades(dt: number, ctx: MobileContext): void {
    const b = this.blades;
    const animator = this.animator;
    if (!b || !animator || this.driven || this.dead) return;
    // Read by its blade's question about a foe behind it, this step only.
    this.targetsSeen = ctx.targets;
    const t = this.targetRef && !this.targetRef.dead ? this.targetRef : null;
    const d = this.decision;
    const a = this.bladeAsk;
    const gap = t ? Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) - t.radiusToward(this.pos) - this.radiusToward(t.pos) : Infinity;
    // A chain goes on while its foe stays within `keepTo`, a little past where it stopped to strike.
    const reach = NPC_SABER_TUNE.keepTo;
    a.now = this.now;
    a.dt = dt;
    a.lit = this.fighting() && this.heldUntil <= this.now && !this.downPhase && !this.seatAt && !this.swimming;
    a.hasTarget = !!t;
    a.attackState = !!t && !!d && d.state === 'attack' && d.attack === 'melee' && !this.apart && this.posture === 'stand';
    // A leap is out of doors only: a room's ceiling and furniture are nothing to throw a body across.
    a.chasing = !!t && !!d && d.state === 'chase' && !this.apart && !this.inside;
    a.gap = gap;
    a.reach = reach;
    a.offNose = t ? wrapAngle(Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z) - this.facing) : 0;
    a.grounded = this.grounded;
    // Its vertical speed matters only off the ground (a leap is started on it), so the engine is asked only then.
    a.vy = this.grounded || !this.body.isValid() ? 0 : this.body.linvel().y;
    a.above = this.grounded ? 0 : 2;
    a.tumbling = this.tumbling || this.now < this.tumbleUntil;
    a.stunned = this.stunned > 0.3;
    const play = b.step(a, this.clipLength);
    const c = b.combat;
    if (play) {
      if (play.move.kind === 'ready') this.takeBladeClip();
      else if (animator.has(play.anim)) {
        // Straight on from the move before, with no fade through the loop: each move begins where the last one ended.
        const chained = this.bladeAnim !== null && animator.shot === this.bladeAnim;
        const took = animator.once(play.anim, { priority: SHOT_PRIORITY.attack, fadeIn: chained ? 0 : play.blend, fadeOut: 0.2, hold: true, timeScale: play.speed });
        this.bladeAnim = took === null ? null : play.anim;
      }
      if (play.impulse) this.leap(play.impulse);
    } else if (c.move === 'NONE' && this.bladeAnim) this.takeBladeClip();
    // Drawn whole while a special carries it, asked again whenever that changes.
    if (b.special !== this.cullSpecial) this.applyCull();
    // The swing's window: open for as long as a move that cuts plays, one ledger per swing.
    const cuts = b.active && c.attacking;
    const id = c.attackId;
    if (this.bladeWas && (!cuts || id !== this.bladeSwing)) this.closeBladeSwing(reach);
    if (cuts && (!this.bladeWas || id !== this.bladeSwing)) {
      this.bladeSwing = id;
      this.hitThisSwing.clear();
      this.swingSounded = false;
      this.bladeSwept = false;
      this.bladeFoe = t;
      // How much of its own blow this swing lands: measured from the last that landed against its own
      // cooldown between blows, so a chain hits no harder over a fight than its own numbers say.
      this.bladeShare = b.shareOf(this.now, this.bladeCooldown);
      noteBladeSwing(!this.deps.hittableAt);
    }
    this.bladeWas = cuts;
    // A kick lands with the foot, once, while its foot is out.
    const kick = c.kicking;
    if (kick && t && this.kickedFor !== id) this.kick(t, kick, id);
    this.bladeMotion(gap);
  }

  /** Its own seconds between blows (its template's), which a chain's swings share a blow out by. */
  private get bladeCooldown(): number {
    return this.entry.stats?.attackCooldown ?? 1.6;
  }

  /** The move clip it put up, taken off the animator -- only while it is still the one playing, so a roll, a parry or a death that took over since is left alone. */
  private takeBladeClip(): void {
    const animator = this.animator;
    if (animator && this.bladeAnim && animator.shot === this.bladeAnim) animator.stopShot(0.2);
    this.bladeAnim = null;
  }

  /**
   * A swing of the machine's has ended. One its blade was never swept for -- a body culled as a group
   * draws no blade, and with no lookup wired nothing can be named -- lands the blow the old swings
   * land in that case, on what it was aimed at if that still stands in reach and level with it.
   */
  private closeBladeSwing(reach: number): void {
    const t = this.bladeFoe;
    this.bladeFoe = null;
    if (this.bladeSwept || !t || t.dead) return;
    const gap = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) - t.radiusToward(this.pos) - this.radiusToward(t.pos);
    const level = Math.abs(t.pos.y + t.halfHeight - (this.pos.y + this.halfHeight)) <= this.halfHeight + t.halfHeight + BRAIN_TUNE.vertical;
    if (!(gap <= reach && level)) return;
    // The same share of its blow the swept swing would have landed, on the same clock.
    t.damage(this.blow * this.bladeShare, this.pos, BLOW_PUSH[this.entry.stats?.sizeClass ?? 'small'] ?? 3, this);
    this.blades?.landed(this.now);
  }

  /**
   * A saber move's own push (`Impulse`, in Jedi Academy's units a second along its facing and to its
   * right): thrown up at once, undamped, when it has an upward speed, and carried until it comes down;
   * with none, a push along the ground eased out over `LUNGE_PUSH`.
   */
  private leap(im: Impulse): void {
    if (!this.body.isValid()) return;
    const v = alongFacing(this.facing, im.forward * JKA_UNIT, im.right * JKA_UNIT, this.pushAt);
    this.leapVX = v.x;
    this.leapVZ = v.z;
    this.leapAt = this.now;
    if (im.up === null) {
      this.leapAir = false;
      this.leapUntil = this.now + LUNGE_PUSH;
      return;
    }
    // Undamped for the flight, as a jump of its own is (`startJump`), and put back as it lands.
    this.body.setLinearDamping(0);
    rollVel.x = this.leapVX;
    rollVel.y = im.up * JKA_UNIT;
    rollVel.z = this.leapVZ;
    this.body.setLinvel(rollVel, true);
    this.grounded = false;
    this.leapAir = true;
    this.leapUntil = this.now + 3;
    // Off the ground: every other browser is told, as a jump of its own tells them.
    this.mark = 'leap';
  }

  /**
   * What a saber move carries the body by this frame: a lunge's push eased out, a leap's flight until
   * it comes down (its push taken off once it is within striking distance of what it fights, so
   * it never lands past it), and a move's own script -- the staff's butterflies, a kata's steps -- at
   * its run, which stops the same way. A script's hop lifts it off the ground.
   */
  private bladeMotion(gap: number): void {
    if (!this.body.isValid()) return;
    const carry = gap > NPC_SABER_TUNE.closeTo;
    if (this.now < this.leapUntil) {
      if (this.leapAir) {
        if (this.now - this.leapAt > 0.2 && this.grounded) {
          // Down again: the flight ends and its damping comes back.
          this.leapUntil = 0;
          this.leapAir = false;
          this.body.setLinearDamping(BODY_DAMPING);
        } else if (!carry && (this.leapVX !== 0 || this.leapVZ !== 0)) {
          this.leapVX = 0;
          this.leapVZ = 0;
          const v = this.body.linvel();
          rollVel.x = 0;
          rollVel.y = v.y;
          rollVel.z = 0;
          this.body.setLinvel(rollVel, true);
        }
      } else if (carry) {
        const k = Math.max(0, (this.leapUntil - this.now) / LUNGE_PUSH);
        const v = this.body.linvel();
        rollVel.x = this.leapVX * k;
        rollVel.y = v.y;
        rollVel.z = this.leapVZ * k;
        this.body.setLinvel(rollVel, true);
      }
    } else if (this.leapAir) {
      // A flight not seen down in its time -- come down in deep water, held up on a lip -- is let go
      // all the same, and its damping comes back with it, as a jump of its own is (`endTumble`).
      this.leapAir = false;
      this.body.setLinearDamping(BODY_DAMPING);
    }
    const b = this.blades;
    if (!b || !b.combat.scriptInto(this.moveScript)) return;
    const s = this.moveScript;
    const push = (s.fmove !== 0 || s.smove !== 0) && carry;
    const hop = !Number.isNaN(s.hop) && this.grounded;
    if (!push && !hop) return;
    const v = this.body.linvel();
    const run = this.speeds.run > 0 ? this.speeds.run : 5;
    const along = alongFacing(this.facing, s.fmove, s.smove, this.pushAt);
    rollVel.x = push ? along.x * run : v.x;
    rollVel.y = hop ? s.hop : v.y;
    rollVel.z = push ? along.z * run : v.z;
    if (hop) this.grounded = false;
    this.body.setLinvel(rollVel, true);
  }

  /**
   * A staff's kick landing with the foot: once a kick, on what it is fighting if that stands the kick's
   * way within reach. A blow like a swing, on the same clock (`NpcSaber.shareOf`), so it comes out of its
   * own rate of blows rather than on top of it.
   */
  private kick(t: Living, dir: Dir, id: number): void {
    this.kickedFor = id;
    if (!liesToward(dir, (this.entry.stats?.reach ?? 1.5) * this.scale + 0.5, this.facing, this.pos.x, this.pos.y, this.pos.z, t.pos.x, t.pos.y, t.pos.z)) return;
    const share = this.blades ? this.blades.shareOf(this.now, this.bladeCooldown) : 1;
    this.blades?.landed(this.now);
    t.damage(scaledByDifficulty(KICK_DAMAGE.min + Math.random() * (KICK_DAMAGE.max - KICK_DAMAGE.min)) * share, this.pos, KICK_DAMAGE.push, this);
    combatSounds.melee(null, true, t.pos.x, t.pos.y + t.halfHeight, t.pos.z);
  }

  /**
   * Its saber move let go of wherever it was (a roll, a jump, a death, a change of hands): its whooshes
   * still to come, its push and its window with it -- and its clip, while that is still the one on the
   * animator. A move is played held (`hold`), so nothing ends it but another shot or this: a body handed
   * to another browser mid-move is only ever given its loop from then on, and without this would glide
   * about frozen in the move's last frame, flinching at nothing, for as long as that browser kept it.
   */
  private dropBlades(): void {
    if (!this.blades) return;
    this.blades.holster();
    this.takeBladeClip();
    this.bladeWas = false;
    this.bladeFoe = null;
    if (this.leapAir && this.body.isValid()) this.body.setLinearDamping(BODY_DAMPING);
    this.leapUntil = 0;
    this.leapAir = false;
  }

  /**
   * A bolt reached its body: whether its lit blade turns it away (`NpcSaber.block`: the player's own
   * blocking maths and a chance by tier), writing where it now goes to `out`. The parry plays over its
   * loop when nothing weightier has the animator, and the blade rings where the bolt struck. A body
   * another browser thinks for turns nothing here: whatever it does is its keeper's.
   *
   * **With a server the keeper answers for everybody.** On a shooter's browser the kept body is driven
   * and never blocks: the bolt's own flight is held here for the blow it is about to strike, the blow
   * is asked of the keeper with it (`npcHurt`), and the keeper's own blade decides there, flying a bolt
   * of its own back that crosses as any of its shots does. On the keeper's browser a bolt of its own
   * player's turned away here is cut short on every screen and flies on as this body's shot, which
   * crosses too (`Bolts`), and either way every other screen is told with a mark, so its copy parries.
   */
  blockBolt(bolt: Bolt, point: THREE.Vector3, out: THREE.Vector3): boolean {
    if (this.driven) {
      // Held for the blow the same bolt strikes in the same breath, so the keeper can be asked about it.
      if (this.blades && this.blade && !this.dead) {
        const h = this.heldBolt;
        h.dx = bolt.dir.x;
        h.dy = bolt.dir.y;
        h.dz = bolt.dir.z;
        h.speed = bolt.speed;
        h.color = bolt.color ?? 0xff4a2a;
        h.size = bolt.size ?? 1;
        this.heldBoltAt = this.now;
      }
      return false;
    }
    if (!this.blockFrom(bolt.dir, point, out)) return false;
    this.mark = 'block';
    return true;
  }

  /**
   * Whether its lit blade turns away a bolt going along `dir` that reached it at `point`, writing where
   * it goes from here to `out`; the parry and the ring are played when it does. Asked of a bolt that
   * reached this body here, and of one that reached a copy of it on another browser (`npcHurt`).
   */
  private blockFrom(dir: THREE.Vector3, point: THREE.Vector3, out: THREE.Vector3): boolean {
    const b = this.blades;
    const blade = this.blade;
    const animator = this.animator;
    if (!b || !blade || !animator || this.dead || this.driven || this.heldUntil > this.now || this.downPhase) return false;
    const a = this.blockAsk;
    // Out and lit: a blade still igniting or going out turns nothing.
    a.lit = blade.ignition >= 0.9 && this.fighting();
    a.tumbling = this.tumbling || this.now < this.tumbleUntil;
    a.dir.copy(dir);
    a.hit.copy(point);
    blockFrame(a, this.pos.x, this.pos.y, this.pos.z, this.facing, BLOCK_EYE * this.scale);
    const t = this.targetRef;
    if (t && !t.dead) a.look.set(t.pos.x - a.eye.x, t.pos.y + t.halfHeight - a.eye.y, t.pos.z - a.eye.z);
    else a.look.copy(a.forward);
    if (a.look.lengthSq() < 1e-8) a.look.copy(a.forward);
    a.look.normalize();
    const zone = b.block(a, out);
    if (!zone) return false;
    if (!b.busy && this.swingAt === 0 && animator.shotLevel < SHOT_PRIORITY.hit) {
      const clip = parryClip(b.style, zone, this.hasClip);
      if (clip) animator.once(clip, { priority: SHOT_PRIORITY.hit, fadeIn: 0.05, fadeOut: 0.15 });
    }
    combatSounds.saberContact('block', point.x, point.y, point.z);
    return true;
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

  /**
   * Whether it is in a one-shot, dying, or attacking (from cover too, the same state): the tiers never
   * freeze it. Nor one following the player or being spoken to, which is behind the camera or at its
   * edge as often as not and would otherwise think once a second and slide on unmoving feet.
   */
  get busy(): boolean {
    return this.dead || !!this.animator?.busy || this.swingAt > 0 || this.shotsLeft > 0 || this.bladeBusy || this.state === 'attack' || this.state === 'cover' || this.follow !== null || this.listening !== null;
  }

  /** Whether it has anything to fight with at all: a blow of its own, or a shot. */
  get canFight(): boolean {
    return this.melee || this.rangedRange > 0;
  }

  /** The ranged attack its own numbers give it, or null: what a gun put in its hand is judged against (`MobileManager.rearm`). */
  get ownRanged(): { range: number; additive: boolean } | null {
    return this.rangedStat;
  }

  // ---- being spoken to, and following ------------------------------------------------------------
  //
  // A person the player talks to (`src/world/talk.ts`) and one asked to follow them
  // (`src/world/followers.ts`). What is here is only what needs the body itself: the rest is the talk's
  // and the follower set's, which are pure.

  /**
   * Speak to it, or stop (null): while spoken to it stands where it is and turns to face `at`, which the
   * caller keeps and moves; let go, it thinks again at once, and a body that thinks nothing (part of the
   * furniture) is left facing where it faced rather than acting on a stale decision.
   */
  listen(at: { x: number; z: number } | null): void {
    if (this.disposed) return;
    const was = this.listening;
    this.listening = at;
    if (at || !was) return;
    this.decision = null;
    this.goal = null;
    this.thinkAt = 0;
  }

  /**
   * The greeting it turns to answer with: the first of `clips` its animator holds, played once over its
   * idle as an emote is. False where it holds none, or something weightier is playing.
   */
  greet(clips: readonly string[]): boolean {
    const a = this.animator;
    if (!a || this.dead || this.downPhase) return false;
    for (const c of clips) {
      if (!a.has(c)) continue;
      return a.once(c, { priority: SHOT_PRIORITY.emote, fadeIn: 0.15, fadeOut: 0.25 }) !== null;
    }
    return false;
  }

  /**
   * Made ready to walk off with the player: up off a seat onto the spot in front of it, back in its own
   * idle rather than a lent one (a sitting mood played on the move is a body walking along sat on the
   * air), and no longer walked by a routine of ours.
   */
  readyToFollow(): void {
    if (this.disposed || this.dead) return;
    if (this.seatAt) {
      const s = this.seatAt;
      this.rise(s.x + Math.sin(s.heading) * 0.7, s.z + Math.cos(s.heading) * 0.7);
    }
    this.routine = null;
    this.seatedIdleOnly = false;
    if (this.roles && this.plainIdle && this.roles.idle !== this.plainIdle) {
      this.roles.idle = this.plainIdle;
      this.laidIdle = this.plainIdle;
      if (!this.downPhase) this.animator?.loop(this.idleNow(), 1, 0.3);
      // A lent idle may have laid it at full length; its own does not.
      this.applyCull();
    }
    this.thinkAt = 0;
  }

  /**
   * Let go of its steering once it is no longer following: its last decision was a walk to a place behind
   * the player, and a body that thinks nothing would otherwise walk on to where that place was. Its room
   * is its home's room from here, since its home has just been moved to where it stands.
   */
  unfollow(): void {
    if (this.disposed) return;
    this.decision = null;
    this.goal = null;
    this.thinkAt = 0;
    this.homeCell = this.navCell;
    if (!this.dead && this.state !== 'loading' && !this.downPhase) this.state = 'idle';
  }

  /**
   * Clips lent to it after it was hung (`MobileAnimator.lend`): the rolls and jumps a person stood as part
   * of the furniture was never lent, handed over when it is asked to follow and may now have to fight.
   */
  lendClips(extra: ReadonlyMap<string, THREE.AnimationClip>): void {
    this.animator?.lend(extra);
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
    // sent says it and the next one does not. A roll and a jump say which way, and a jump whether it was
    // the Force's, which is what picks their clips.
    if (this.mark) {
      row.f = this.mark;
      if (this.mark === 'roll' || this.mark === 'jump') row.fd = this.markDir;
      if (this.mark === 'jump' && this.markForce) row.ff = 1;
      this.mark = null;
    }
    // How low it stands, and whether it is in its cover spot: what it is doing, said every batch, so a
    // copy of it is on its knee behind the crate rather than standing in the open beside it.
    if (this.posture !== 'stand') row.po = this.posture;
    const tac = this.tactics;
    if (tac?.coverKind && tac.inSpot(this.pos.x, this.pos.z)) row.cv = 1;
    // What it is thinking, so whoever takes it over next does not start it over. Written only when
    // there is something to say: a creature standing about with nothing on its mind costs no bytes.
    // A player is named by the relay id of the browser they are at (`p:<id>`), never as `'p'`, which
    // the new keeper read as its own player and so turned the creature on somebody else.
    const t = this.targetRef;
    const target = t ? (npcNow()?.nameTarget(t.key, (t as { npcId?: string }).npcId ?? '') ?? '') : '';
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
    // The word names this browser's own player, another player's figure here, or one of the world's
    // creatures; a player this browser holds no figure for is nobody, and it picks its own fight.
    const named = npcNow()?.readTarget(want) ?? null;
    if (!named) return;
    for (const t of targets) {
      const mine = 'key' in named ? t.key === named.key : (t as { npcId?: string }).npcId === named.npc;
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
    // moment cost nothing and need no extra word on the wire. Copied, because the row it arrived in
    // is refilled by the next one; and a row with nothing on its mind means exactly that.
    this.heldBrain = row.b ? copyBrain(row.b, this.heldBrain) : null;
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
    // How low it stands, as its keeper has it: the same posture, the same shell for a bolt to meet and
    // the game's own one-shot between the two, where its pack has the clips at all. Not through a roll
    // or a jump, whose clips have the whole body; the next row after one says it again.
    this.toldCover = row.cv === 1;
    const low = row.po ?? 'stand';
    if (low !== this.posture && this.lowClips && !this.tumbling) this.drivenPosture(low);
    if (row.f) this.sawMark(row.f, row.fd, row.ff === 1);
  }

  /** Whether its keeper last said it is in its cover spot; for the console, since nothing here moves it. */
  private toldCover = false;

  /**
   * A driven copy put into the posture its keeper says: the shell and the aim point together, as the
   * keeper's own are (`setPosture`), and the transition between the two played over its loop.
   */
  private drivenPosture(want: Posture): void {
    const was = this.posture;
    this.setPosture(want);
    const animator = this.animator;
    const pack = this.animPack;
    if (!animator || !pack) return;
    const clip = lowTransition(pack.json, was, want, this.toldSpeed > 0.3, (n) => animator.has(n));
    if (clip) animator.once(clip, { priority: SHOT_PRIORITY.hit, fadeIn: 0.08, fadeOut: 0.15 });
  }

  /**
   * Something that had to be seen once: it was struck, and it left the ground.
   *
   * A death is not one of them and never arrives here. It has a word of its own, which reaches this
   * body as `npcEnd`, and two ways to say one death would be two paths for the same thing.
   */
  private sawMark(mark: NpcMark, dir: RollDir = 'F', force = false): void {
    if (mark === 'hit') {
      this.flinch(0.1);
      return;
    }
    const animator = this.animator;
    if (mark === 'roll') {
      // Jedi Academy's roll, as its keeper threw it: the clip over the ground the rows carry it across,
      // on the low shell for as long as the roll lasts, so a bolt aimed at its chest goes over here too.
      const clip = ROLL_CLIPS[dir];
      if (!animator?.has(clip)) return;
      if (this.posture !== 'stand') this.setPosture('stand');
      this.rollLeft = EVADE_TUNE.rollTime;
      const length = animator.once(clip, { priority: SHOT_PRIORITY.attack, fadeIn: 0.05, fadeOut: 0.15 }) ?? 0;
      this.tumbleUntil = this.now + rollCommit(length);
      this.reshape();
      this.applyCull();
      return;
    }
    if (mark === 'jump') {
      // A jump of its own, as its keeper threw it: the take-off, the in-air loop while the clips say it
      // is up, and the landing. The arc is the rows' own.
      this.grounded = false;
      if (!animator) return;
      if (this.posture !== 'stand') this.setPosture('stand');
      this.hopForce = force;
      this.hopDir = dir;
      this.hopAir = jumpClipName('INAIR', dir, force, animator);
      const clip = jumpClipName('JUMP', dir, force, animator);
      if (clip) animator.once(clip, { priority: SHOT_PRIORITY.attack, fadeIn: 0.05, fadeOut: 0.12 });
      this.hopping = true;
      this.hopAt = this.now;
      // How long it is up: a plain hop's, or a Force jump's, out of the jump's own height at the world's
      // gravity -- which is what the keeper threw it at, so the two land together near enough.
      const up = jumpSpeed(jumpHeight(force ? 2 : 1), this.gravityNow());
      this.hopDownAt = this.now + (up > 0 ? (2 * up) / Math.max(1e-3, this.gravityNow()) : 0.8);
      this.applyCull();
      return;
    }
    if (mark === 'block') {
      // Its blade turned a bolt away at its keeper's: the parry over its loop and the ring. The bolt that
      // flies back is the keeper's own and crosses as a shot of its, so it is seen here too.
      const b = this.blades;
      if (animator && b && !b.busy && animator.shotLevel < SHOT_PRIORITY.hit) {
        const clip = parryClip(b.style, 'top', this.hasClip);
        if (clip) animator.once(clip, { priority: SHOT_PRIORITY.hit, fadeIn: 0.05, fadeOut: 0.15 });
      }
      this.bladeTipNow(tmp2);
      combatSounds.saberContact('block', tmp2.x, tmp2.y, tmp2.z);
      return;
    }
    // 'leap': it left the ground. The ease carries the arc, since where it is is said four times a
    // second and it is the place that matters; what this says is that it is not walking.
    this.grounded = false;
  }

  /** Where its blade is this frame, or its chest where it holds none: where a parry rings. */
  private bladeTipNow(out: THREE.Vector3): THREE.Vector3 {
    const b = this.blade;
    if (b?.glowing) return out.copy(b.drawnBase).lerp(b.drawnTip, 0.5);
    return out.set(this.pos.x, this.pos.y + this.halfHeight * 1.2, this.pos.z);
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
      // And its saber moves with it: the keeper swings them now, and nothing here steps the machine.
      this.dropBlades();
      this.shotsLeft = 0;
      this.dotLeft = 0;
      this.slowed = 0;
      this.stunned = 0;
      this.heldUntil = 0;
      // And the aim, which nothing steps for a driven body: left folded, the chest would keep the
      // turn it had at the moment it changed hands for as long as it was somebody else's.
      this.dropAim();
      // And whatever of a fighter's it was doing: the posture, the ring and the evade are all this
      // browser's thinking, and a driven body is walked where its keeper says, standing.
      this.dropTumble();
      this.setPosture('stand');
      this.tactics?.reset();
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
      this.body.setGravityScale(gravityFor(this.airless, this.swimming, this.flyer, this.dead), true);
    }
    this.state = this.state === 'loading' ? 'loading' : this.dead ? this.state : 'idle';
    // It thinks at once rather than standing still for a think's worth of seconds, and the stuck
    // check starts again: the ground it covered while it was driven is not its own walking.
    this.thinkAt = 0;
    this.wanderAt = -1;
    this.stuck = 0;
    this.stuckClock = 0;
    this.stuckCommanded = 0;
    resetStepWalker(this.stepWalk);
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
  npcHurt(amount: number, x: number, y: number, z: number, source: Living | null, _what = '', bolt: NpcBolt | null = null): void {
    if (this.dead || this.disposed || this.driven) return;
    blowFrom.set(x, y, z);
    // A bolt that reached its copy on the shooter's browser, asked of its own blade here first: the
    // keeper answers the block for everybody. Turned away, nothing is taken off; every other screen is
    // told with a mark, so its copy parries; and the bolt flies back from where it met the copy as a
    // shot of this body's own, which crosses as its shots do, so the shooter sees it coming.
    if (bolt && this.blades && this.blade) {
      blockDir.set(bolt.dx, bolt.dy, bolt.dz);
      if (this.blockFrom(blockDir, blowFrom, blockOut)) {
        this.mark = 'block';
        npcNow()?.noteBlocked();
        blockAt.copy(blowFrom).addScaledVector(blockOut, 0.05);
        this.deps.bolts.fire(blockAt, blockOut, { owner: 'enemy', damage: amount, metresPerSecond: bolt.speed > 0 ? bolt.speed : undefined, color: bolt.color, size: bolt.size, exclude: this.body, source: this });
        this.deps.effects()?.burst(blowFrom, 0xbfe6ff, 0.6, 0.15);
        return;
      }
    }
    // No push: what struck is somebody else's bolt or blade and nothing on the wire says how hard
    // it shoves. The health and the flinch are what cross.
    this.damage(amount, blowFrom, 0, source);
  }

  /**
   * Who struck it within `seconds` of now, by living key: what its death names, so a later server can
   * witness the kill (`NpcNet.strikersOf` turns the players among them into relay ids).
   */
  npcStruckBy(seconds: number, out: number[]): void {
    // Its own record of blows (`Strikers`), never the brain's grudges: a passive creature keeps none, and
    // the death that asks this is read after the body has died.
    this.strikers.within(this.now, seconds, out);
  }

  /** Who has struck it lately, whatever its temper and whether or not it lives: what its death names. */
  private readonly strikers = new Strikers();

  /**
   * Off the wire for good while it stands: it has become a body that is this browser's alone (a
   * follower). Whatever another browser was doing with it is no longer anybody's business but this
   * one's, so it is never driven again and never asks anybody about a blow.
   */
  unshare(): void {
    if (this.driven) this.npcSetDriven(false);
    this.shared = '';
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
    // A follower never holds a grudge against its own side: the player it follows, another player, or
    // anybody else following them. A neighbour of its old group told that the player struck one of them
    // (`MobileManager.assist`) would otherwise have it turn on the one it walks behind.
    if (this.follow && source.side === this.side) return;
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
    // Essential: the blow lands, is heard and marks, and takes nothing off. Refused here rather than
    // by giving it a great deal of health, so that nothing anywhere has to know how much is enough.
    if (this.essential) return;
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
    // A bolt that reached it this instant goes with the blow, so the keeper's blade can turn it away.
    const bolt = this.heldBoltAt === this.now ? this.heldBolt : null;
    this.heldBoltAt = -Infinity;
    if (this.driven && this.shared && npcNow()?.askHit(this.shared, amount, this.pos.x, this.pos.y + this.halfHeight, this.pos.z, '', source?.key === PLAYER_KEY, bolt)) return;
    if (source && source.key !== this.key) {
      this.strikers.note(source.key, this.now);
      this.remember(source, amount);
      this.deps.alert(this, source);
      // Struck by something standing well off is being shot at: a tiered person may throw itself aside.
      this.tactics?.evade.struck(this.now, Math.hypot(source.pos.x - this.pos.x, source.pos.z - this.pos.z));
    }
    this.hp -= amount;
    // Something everyone else has to see once: what they are told is that it was struck, and their
    // own copy flinches with the same clip this one is about to play. The least of the marks: a roll, a
    // jump, a parry or a knock off its feet already waiting for the batch says more, and a flinch over it
    // would have the other screens see a slide where it threw itself aside.
    if (!this.mark) this.mark = 'hit';
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
    // kinematic body here would be undone by the next word about it anyway. Sat on a seat (`sit`) it is
    // held there out of the solver, and the seated branch of `update` runs none of the timers that
    // would get it up off the floor again: a knockdown there would lie at the chair until its stay ran out.
    if (this.dead || this.disposed || this.driven || this.seatAt) return;
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
    // A real shove ends a roll or a jump of its own: it goes where it was thrown, not where it was going.
    if (k >= 6) this.endTumble();
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
        // Laid out along the ground until it is up again: drawn whole, not mesh by mesh.
        this.applyCull();
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
    this.applyCull();
  }

  holdAt(point: THREE.Vector3, dt: number): void {
    // Held by the Force is a thing done to a body, and a driven one is not this browser's body to
    // move: the power fires and the creature goes on walking wherever its keeper says. One sat on a
    // seat is held there (`sit`) and stays sat, as it does under a shove (`knock`).
    if (this.dead || this.disposed || this.driven || this.seatAt || !this.plan.canHold) return;
    this.endTumble();
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
    // A saber move let go of, and its whooshes still to come with it: the death clip takes the animator next.
    this.dropBlades();
    this.shotsLeft = 0;
    this.downPhase = null;
    this.targetRef = null;
    // Upright first, while its capsule is still the one being written: a corpse left on the low shell
    // would be shot at half a metre over the ground it lies on, and a roll part way through stops here.
    this.endTumble();
    this.forcedPosture = null;
    this.setPosture('stand');
    this.tactics?.dropCover(this.now, false);
    // Before the death clip, so the fall is posed from the clip's own chest and the ragdoll built
    // from it is not carrying an aim.
    this.dropAim();
    const v = this.body.linvel();
    this.body.setLinvel({ x: 0, y: this.flyer ? Math.min(0, v.y) : v.y, z: 0 }, true);
    // A flyer falls out of the air; a swimmer stays afloat, and so does one in a room with no floor built.
    if (!this.swimming && !this.airless) this.body.setGravityScale(1, true);
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
    // The death clip lays it out along the ground, past the standing body's sphere, and with a server
    // holding the world it lies in that clip for the whole of its time rather than turning ragdoll.
    this.applyCull();
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
    // Its pieces leave the body's sphere as it falls: not culled mesh by mesh for the ragdoll's life.
    this.applyCull();
  }

  private endRagdoll(): void {
    if (!this.ragdoll) return;
    this.ragdoll.dispose();
    this.ragdoll = null;
    this.applyCull();
  }

  /**
   * The meshes the per-mesh cull may take (commit 3c): the model's, each skinned one carrying the body's
   * own sphere in its frame, and a weapon's. Filled when the body is hung and a weapon taken up.
   */
  private readonly cullMeshes: THREE.Mesh[] = [];

  /** What `applyCull` reads, filled rather than made each time it is asked. */
  private readonly cullPose: BodyPose = { ragdoll: false, dead: false, down: false, low: false, kneel: false, idle: null };
  /**
   * Whether the cull was last asked while a roll, a jump or the clip that ends one still had the body,
   * which is what makes `act` ask again the frame that clip has run out (`tumbleUntil`).
   */
  private cullTumble = false;

  /**
   * Whether its meshes are culled one by one now (`cullsOneByOne`): the switch, and only while it is on
   * its feet. Dead (in its held death clip or a ragdoll), knocked down, or standing in an idle that lays it
   * at full length, it reaches past the standing body's sphere and is drawn whole whenever its group is.
   * Asked again whenever one of those changes: hung, dying, knocked down and up, sat and risen, stood again.
   * A roll's clip runs past the roll's own 0.55 s and a landing plays after the feet are down, so the
   * body counts as tumbling until `tumbleUntil` and not only while it is rolling or in the air.
   */
  applyCull(): void {
    const p = this.cullPose;
    p.ragdoll = this.ragdoll !== null;
    p.dead = this.dead;
    p.down = this.downPhase !== null;
    const tumble = this.tumbling || this.now < this.tumbleUntil;
    this.cullTumble = tumble;
    // A saber special (a leap, a kata, a kick) carries the body by a clip the standing sphere was never
    // measured against, as a roll does: drawn whole for as long as it plays.
    const special = !!this.blades && this.blades.special;
    this.cullSpecial = special;
    p.low = this.posture === 'prone' || tumble || special;
    p.kneel = this.posture === 'kneel';
    p.idle = this.roles?.idle ?? null;
    setBodyCulled(this.cullMeshes, cullsOneByOne(p));
  }

  /**
   * Every mesh of the hung model given its cull sphere again (commit 3c): the manager's own sphere for the
   * body, which in the inner group's frame (at the feet, scaled with the body) is `plan.cull` over the scale,
   * grown by `SKELETON_TUNE.sphereScale`. When it is hung, when a weapon is put in its hand, and when the
   * console moves the scale.
   */
  refitCull(): void {
    this.cullMeshes.length = 0;
    if (!this.model) return;
    const cull = this.plan.cull;
    fitCullSpheres(this.model, this.inner, cull.y / this.scale, cull.radius / this.scale, this.cullMeshes);
    this.applyCull();
  }

  /** The share switch flipped (commit 3a): its hung meshes one skeleton, or one each; how many it has now. */
  reshare(share: boolean): number {
    return this.model ? reshareSkeletons(this.model, share) : 0;
  }

  /** Where a shot leaves from: a muzzle bone, else the head, else the middle of its front. */
  private muzzlePoint(out: THREE.Vector3): THREE.Vector3 {
    if (this.muzzle) return this.muzzle.getWorldPosition(out);
    out.set(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(this.plan.along * 0.9);
    return out.add(this.pos).setY(this.pos.y + this.halfHeight * 1.3);
  }

  /**
   * Whether a shot from here would reach a target's middle: a ray against what stands still and a shut
   * door (`Physics.stillOrWall`). A door's leaf stops the bolt, so a target behind one is no line: the
   * brain closes in rather than standing to shoot the door, and the door opens as the body comes up.
   */
  private lineTo(t: Living): boolean {
    this.muzzlePoint(tmp);
    tmp2.set(t.pos.x, t.pos.y + t.halfHeight, t.pos.z).sub(tmp);
    const len = tmp2.length();
    if (len < 0.5) return true;
    tmp2.divideScalar(len);
    const ray = new RAPIER.Ray({ x: tmp.x, y: tmp.y, z: tmp.z }, { x: tmp2.x, y: tmp2.y, z: tmp2.z });
    const hit = this.deps.physics.world.castRay(ray, len - 0.3, true, undefined, this.inside ? INSIDE : OUTSIDE, undefined, this.body, this.deps.physics.stillOrWall);
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
      // A person counts its shots and what they land on, for the console's measure of a fight; the
      // one arrow is the body's own, made with it.
      const tac = this.tactics;
      if (tac) tac.counts.shots++;
      this.deps.bolts.fire(from, dir, { owner: 'enemy', damage: this.blow, speed: g.speed, color, size: g.size, push: g.push, exclude: this.body, source: this, sound: (held ? combatSounds.gunById(this.weapon) : null) ?? combatSounds.gunOf(pistol ? OWN_GUN.pistol : OWN_GUN.rifle), scar: scarFamilyOf(profile.type, this.weapon), onHit: tac ? this.shotLanded : undefined });
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
    // Crouched, the game's own crouch walk: the crouch is how a body moves low.
    if (this.posture === 'crouch' && this.crouchGaits.length) return this.crouchGaits;
    if (this.fighting() && r.gaitsCombat.length) return r.gaitsCombat;
    return r.gaits;
  }

  private idleNow(): string | null {
    // In the air on a jump of its own: Jedi Academy's in-air loop for that jump, found as it left the
    // ground. Low: the posture's own loop for the carry it stands in (`lowLoop`).
    if (this.hopping && this.hopAir) return this.hopAir;
    if (this.posture !== 'stand' && this.lowClips) {
      const low = lowLoop(this.lowClips, this.posture, this.stance);
      if (low) return low;
    }
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
    // Not through a roll or a jump, whose clips pose the whole body: the correction eases away meanwhile.
    ask.aiming = !!this.gun && !!holder && !!target && !target.dead && this.stance !== 'relaxed' && !this.tumbling;
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
    // the combat gaits and a lit blade exactly as one told `attack` does. A tiered person from the
    // catalogue takes cover now (`seeksCover`) and its keeper sends the word, so a driven copy of one
    // is told it; listing it here is what keeps that copy in its fight.
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
    // 2. The body's place, and the heading it is held at; and the picture still catching up with a
    //    step it was lifted onto.
    const t = this.body.translation();
    this.pos.set(t.x, t.y - this.plan.feet, t.z);
    this.group.position.set(t.x, t.y, t.z);
    tmpQ.setFromAxisAngle(UP, this.heading);
    this.group.quaternion.copy(tmpQ);
    if (this.liftLagY !== 0 || this.liftLagZ !== 0) this.easeLift(dt);
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
      if (this.airless) holdAir(this.body);
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
    // 6b. Sat down by one of ours (`sit`): held on its seat, out of the solver, in its seated idle. It
    // still thinks, since whatever walks it says when it gets up; nothing else of it runs.
    if (this.seatAt) {
      if (this.routine && this.now >= this.thinkAt) {
        this.thinkRoutine();
        this.thinkAt = this.now + tier.think;
      }
      this.animate(sdt, tier);
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
    // 9. Think. One that is essential does not: it stands where it was stood, faces the way it was
    // faced, and takes no interest in anything. Skipping the whole brain rather than gating each of
    // its branches is the point -- there is no state it can be left in and nothing to come out of.
    // The one thing such a body does do is walk a town's round, which asks nothing of the brain -- or,
    // for one of ours, the walk its routine gives it, which asks nothing of the brain either.
    // Spoken to, it thinks of nothing else: it stands and turns to whoever is speaking, whatever it was
    // doing, and picks its day up again when the conversation ends (`listen`).
    if (this.listening) this.hearOut();
    else {
      if (this.routine && this.now >= this.thinkAt && !this.downPhase) {
        this.thinkRoutine();
        this.thinkAt = this.now + tier.think * (0.85 + Math.random() * 0.3);
      }
      if (!this.routine && this.now >= this.thinkAt && !this.downPhase && (!this.essential || this.patrol)) {
        if (this.essential) this.thinkWalker();
        else this.think(ctx);
        this.thinkAt = this.now + tier.think * (0.85 + Math.random() * 0.3);
      }
    }
    // 10. The carry it stands in (before acting: `act` chooses the loop from it), 11. act,
    // 12. hold its height, 13. animate, 14. aim.
    if (this.state === 'return') this.hp = Math.min(this.maxHp, this.hp + (this.maxHp / 3) * sdt);
    this.stepStance(this.targetRef);
    this.act(sdt, ctx, tier);
    // Its lightsaber's move machine, after the ground it asked for and before its height is held, so a
    // leap begun this frame goes up this frame (`stepBlades`). Every frame it is its own, rolling or not.
    this.stepBlades(sdt, ctx);
    this.holdHeight(t, sdt);
    // After everything that writes a velocity this frame, so nothing it did can start a fall.
    if (this.airless) holdAir(this.body);
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
    // A body handed over part way through catching up with a step it was lifted onto goes on catching
    // up here, rather than snapping onto its body the moment it changed hands.
    if (this.liftLagY !== 0 || this.liftLagZ !== 0) this.easeLift(dt);
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
    // A roll or a jump its keeper threw, played out here on the clips' own clock: the roll on its low
    // shell for the roll's length, the jump held in the air until the clips bring it down.
    if (this.rollLeft > 0) {
      const left = this.rollLeft - dt;
      if (left <= 0) this.endTumble();
      else this.rollLeft = left;
    } else if (this.hopping && this.now >= this.hopDownAt) {
      const animator = this.animator;
      const clip = animator ? jumpClipName('LAND', this.hopDir, this.hopForce, animator) : null;
      if (clip && animator) {
        const length = animator.once(clip, { priority: SHOT_PRIORITY.hit, fadeIn: 0.05, fadeOut: 0.15 }) ?? 0;
        this.tumbleUntil = Math.max(this.tumbleUntil, this.now + Math.min(0.6, length));
      }
      this.endTumble();
      this.grounded = true;
    }
    if (this.cullTumble && !this.tumbling && this.now >= this.tumbleUntil) this.applyCull();
    const move = this.entry.move;
    const accel = (this.toldSpeed > this.speeds.walk + 1e-3 ? move.accel?.[0] : move.accel?.[1]) ?? 4;
    const gait = stepGait(this.ramp, this.toldSpeed, accel, dt, this.gaitsNow(), this.idleNow(), this.scale, undefined, this.gaitOut);
    this.ramp = gait.ramp;
    this.speed = gait.speed;
    // In the air its own loop holds whatever the rows' pace would ask for.
    if (!this.downPhase) this.animator?.loop(this.hopping ? this.idleNow() : (gait.clip ?? this.idleNow()), gait.timeScale);
    this.animate(dt, tier);
    this.updateBlade(dt, ctx.camera);
  }

  private checkGround(t: { x: number; y: number; z: number }): void {
    const terrain = this.deps.terrain;
    const filter = this.inside ? INSIDE : undefined;
    const gd = this.deps.physics.groundDistance(t.x, t.y, t.z, this.plan.feet + 0.4, this.body, filter);
    // Outdoors, the ground under it -- read where the world holds it when it is past the physics' reach,
    // and unknown (null) where it holds nothing, which changes nothing below (commit 4b).
    const ground = this.inside ? null : groundUnder(this.pos.x, this.pos.z, terrain, this.deps);
    // A room with no floor built is stood on as though it had one: the height is held for it.
    this.grounded = standingOn(this.grounded, gd !== null, this.airless, this.inside, this.pos.y, ground);
    if (this.inside) {
      this.swimming = false;
      return;
    }
    if (ground === null) return;
    const surface = terrain.waterHeightAt(this.pos.x, this.pos.z);
    const deep = surface - ground > (this.entry.size?.swimHeight ?? 1) * this.scale;
    const swimming = this.canSwim && deep && this.pos.y < surface;
    if (swimming !== this.swimming) {
      this.swimming = swimming;
      this.body.setGravityScale(gravityFor(this.airless, swimming, this.flyer, this.dead), true);
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
    /** Whom it was after before this thought, and whether its shot at them was clear: a ring holds only with one. */
    const was = this.targetKey;
    let line = false;
    const reachOut = Math.max(BRAIN_TUNE.aggroBig, BRAIN_TUNE.leash) + 30;
    // Following the player: home is its place behind them, and its room theirs, so the leash, the walk
    // back after a chase and which leash is kept (a room's or the ground's) all measure from the player.
    const follow = this.follow;
    if (follow) {
      this.homeX = follow.slotX;
      this.homeZ = follow.slotZ;
      this.homeCell = ctx.cellOf ? (ctx.cellOf(follow.leader) ?? null) : null;
    }
    // A blade swung through the move machine strikes from where arm and blade really reach
    // (`NPC_SABER_TUNE.closeTo`), as a fighter's does; everything else from its own template's reach.
    const own = (this.entry.stats?.reach ?? 1.5) * this.scale;
    const reach = this.bladesOn ? Math.min(own, NPC_SABER_TUNE.closeTo) : own;
    for (const t of ctx.targets) {
      if (t === (this as Living) || t.key === this.key) continue;
      // Another player only for a body whose blow can reach their browser: one this browser keeps on the
      // wire. Anybody else would chase a picture it can never finish (`mayFight`).
      if (!mayFight(t, this.shared)) continue;
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
      if (isCurrent) line = b.hasLine;
      // Whether a wall stands between: asked only of what a blow could nearly reach, which is the one
      // rule that reads it, so a ray is cast for a handful of bodies at most and none at all for most.
      // Left undefined past that, which says "not asked" rather than "no wall".
      b.apart = this.melee && !t.dead && Math.hypot(dx, dz) - b.radius <= reach + DOOR_TUNE.wallLook ? this.apartFrom(ctx, t) : undefined;
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
      homeInside: this.homeCell !== null,
      big: this.entry.stats?.sizeClass === 'large' || this.entry.stats?.sizeClass === 'huge',
      reach,
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
      // What a person tells the shared brain, and nothing else does: whether it gets behind things at
      // all (a tier, a gun in its hand, out of doors, its own fight), whether it is behind one now,
      // and how far up its jump reaches. Every creature leaves all three out and is what it was.
      seeksCover: this.seeksCover(),
      inCover: !!this.tactics?.coverKind,
      jumpReach: this.tactics && !this.inside ? jumpHeight(this.tactics.jumpLevel) : 0,
    };
    const d = decide(self, list);
    // A standing person keeps to the spot the data put it on (`keepPost`): the brain's wander is drawn
    // for animals on open ground. And indoors no wander reaches past the indoor leash, the fighters'
    // own rule, or the body paces out and back for as long as it is left alone.
    //
    // A town's walker keeps to its round instead (`keepPatrol`), and its home is the point of the
    // round it is making for, written **before** the indoor clamp reads it: so the leash, the walk home
    // after a fight and the clamp all measure from the round, and a walker who was fought comes back to
    // the very point it was on its way to.
    //
    // A follower keeps to its place behind the player instead (`keepFollow`), which leaves a fight, a
    // flight and the run back past the leash to the brain.
    if (follow) keepFollow(d, self, follow);
    else if (this.patrol) {
      keepPatrol(d, self, this.patrol, Math.random, PATROL_TUNE, !this.tier?.move);
      this.homeX = this.patrol.anchor.x;
      this.homeZ = this.patrol.anchor.z;
    } else if (this.post) keepPost(d, self, this.post, self.wanderAt);
    if (this.inside) clampWander(d, this.homeX, this.homeZ, BRAIN_TUNE.leashInside * BRAIN_TUNE.wanderInsideShare);
    if (d.clearMemory) this.memory.clear();
    if (d.targetKey !== this.targetKey) {
      this.stuck = 0;
      this.stuckClock = 0;
    }
    this.targetKey = d.targetKey;
    this.targetRef = d.targetKey === null ? null : d.targetKey === current?.key ? current : (ctx.targets.find((t) => t.key === d.targetKey) ?? null);
    // The wall between it and what it is now after, for the frames until the next thought (the stop
    // to strike in `act` reads it): the answer the list already has, else one ray for this one body.
    this.apart = false;
    if (this.targetRef && this.melee) {
      let asked: boolean | undefined;
      for (const b of list) {
        if (b.key !== d.targetKey) continue;
        asked = b.apart;
        break;
      }
      this.apart = asked ?? this.apartFrom(ctx, this.targetRef);
    }
    this.wanderAt = d.wanderAt;
    this.goal = d.goal;
    this.until = d.until;
    this.blockedSince = d.blockedSince;
    this.forgetKey = d.forgetKey;
    this.forgetUntil = d.forgetUntil;
    if (d.state === 'return' && this.state !== 'return') this.goal = null;
    this.state = d.state;
    this.decision = d;
    // Whether its shot at what it is after is clear, kept only while that is still who it is after:
    // the ring holds a chase off only with a line, since a chase with none is a wall in the way.
    this.lineSeen = d.targetKey !== null && d.targetKey === was ? line : false;
    // And whether to throw itself aside, or jump up to somebody on a ledge, once a thought.
    this.stepEvade(ctx);
    // Water it cannot swim in, just ahead: a wander turns elsewhere, a chase stops at the edge.
    this.waterAhead = false;
    if (!this.canSwim && !this.flyer && !this.inside && d.pace !== 'stand') {
      const ahead = Math.max(1, this.speed * 0.5);
      const nx = this.pos.x + Math.sin(this.heading) * ahead;
      const nz = this.pos.z + Math.cos(this.heading) * ahead;
      const terrain = this.deps.terrain;
      // The same far read as the ground's (commit 4b): ground not held out there is no water known ahead.
      const ahead0 = groundUnder(nx, nz, terrain, this.deps);
      if (ahead0 !== null && terrain.waterHeightAt(nx, nz) - ahead0 > (this.entry.size?.swimHeight ?? 1) * this.scale * 0.8) {
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

  /**
   * A body being spoken to: the one decision it keeps for this, standing and facing the speaker, and no
   * fight, target or walk of its own while it lasts. Nothing is made.
   */
  private hearOut(): void {
    const at = this.listening;
    const d = this.hearing;
    d.face = at;
    this.decision = d;
    this.goal = null;
    this.state = 'idle';
    this.targetKey = null;
    this.targetRef = null;
  }

  /**
   * A walker that is part of the furniture: no brain, no targets, nothing on its mind but its round
   * (`thinkWalking`, which the node test walks). One decision kept for the life of the body and
   * written over each thought, since a thought here makes nothing the brain would.
   */
  private thinkWalker(): void {
    const p = this.patrol;
    if (!p) return;
    const self = this.walkerSelf;
    self.x = this.pos.x;
    self.z = this.pos.z;
    self.now = this.now;
    const d = thinkWalking(this.walkerDecision, self, p, Math.random, PATROL_TUNE, !this.tier?.move);
    this.walkerDecision = d;
    this.homeX = p.anchor.x;
    this.homeZ = p.anchor.z;
    this.goal = d.goal;
    this.state = d.state;
    this.decision = d;
  }

  /**
   * One of ours: no brain and no targets, only the walk its routine has given it (`walkDecision`), in
   * the one decision the body keeps for its life. Its home follows the point it walks to, so nothing
   * that measures a leash from home ever pulls it back to where it was stood.
   */
  private thinkRoutine(): void {
    const w = this.routine;
    if (!w) return;
    const d = walkDecision(this.walkerDecision, w);
    this.walkerDecision = d;
    if (w.going) {
      this.homeX = w.goal.x;
      this.homeZ = w.goal.z;
    }
    this.goal = d.goal;
    this.state = d.state;
    this.decision = d;
  }

  /**
   * Sit on a seat: put exactly there, facing the way the seat faces, held out of the solver (a seat is
   * solid, and a body stood inside one would be shoved off it) and playing the idle it was lent for
   * sitting. For the people of ours; nothing else sits.
   */
  sit(x: number, y: number, z: number, heading: number): void {
    if (this.disposed || this.dead) return;
    this.seatAt = { x, y, z, heading };
    if (this.body.isValid()) {
      this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.placeAt(x, y, z, heading);
    this.speed = 0;
    this.ramp = 0;
    this.heldUntil = 0;
    // Knocked down on the way to the seat: up at once, since nothing in the seated branch of `update`
    // would ever get it up again, and a knockdown's hold ending in `lieDown` would lay it on the chair.
    if (this.downPhase) {
      this.downPhase = null;
      this.state = 'idle';
      this.stunned = 0;
      this.animator?.stopShot(0.1);
    }
    if (this.roles && this.laidIdle) this.roles.idle = this.laidIdle;
    this.animator?.loop(this.idleNow(), 1);
    // Up from a knockdown, and in the seat's idle, which may lay it down at full length.
    this.applyCull();
  }

  /** Get up off a seat onto the spot in front of it, a body in the solver again standing in its own idle. */
  rise(x: number, z: number): void {
    if (!this.seatAt || this.disposed) return;
    const y = this.seatAt.y;
    const heading = this.seatAt.heading;
    this.seatAt = null;
    if (this.body.isValid()) {
      this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setGravityScale(gravityFor(this.airless, this.swimming, this.flyer, this.dead), true);
    }
    this.placeAt(x, y + 0.05, z, heading);
    resetStepWalker(this.stepWalk);
    if (this.roles && this.plainIdle && this.seatedIdleOnly) this.roles.idle = this.plainIdle;
    this.thinkAt = 0;
    this.applyCull();
  }

  /**
   * Stood somewhere else at once, on its feet, out of any seat and with nothing carried over: the
   * building it was standing in is being taken out of the world. Its path and its home's room go with
   * the building, and its home is the doorstep it is stood on (a follower's is its
   * place behind the leader again on its next thought): kept, they leashed it to a room that is not
   * there and walked it home into one. A body another browser keeps loses its rooms all the same and is
   * not moved, since its place is that browser's to say (it takes the same building down and stands it
   * out there). Answers whether it was moved.
   */
  standOut(x: number, y: number, z: number): boolean {
    if (this.disposed) return false;
    this.navCell = null;
    this.navAgent.clear();
    this.homeCell = null;
    if (this.driven) return false;
    if (this.seatAt) this.rise(x, z);
    this.placeAt(x, y + 0.05, z, this.heading);
    if (this.body.isValid()) this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    resetStepWalker(this.stepWalk);
    this.homeX = x;
    this.homeZ = z;
    this.goal = null;
    this.thinkAt = 0;
    return true;
  }

  /** Whether it is sitting on a seat just now. */
  get seated(): boolean {
    return this.seatAt !== null;
  }

  /**
   * Whether a wall stands between this body and a living thing (see `apart`): in different places by
   * the rooms the two are followed in, and no open doorway between their middles (`wallBetween`).
   */
  private apartFrom(ctx: MobileContext, t: Living): boolean {
    return wallBetween(
      this.deps.physics,
      this.navCell,
      ctx.cellOf ? ctx.cellOf(t) : undefined,
      this.inside,
      this.pos.x,
      this.pos.y + this.halfHeight,
      this.pos.z,
      t.pos.x,
      t.pos.y + t.halfHeight,
      t.pos.z,
    );
  }

  /** Where a living thing it is after is, for the doorway join (`placeOfCell`); null where nobody follows it. */
  private placeOf(ctx: MobileContext, t: Living): GoalPlace | null {
    return placeOfCell(ctx.cellOf ? ctx.cellOf(t) : undefined, this.goalPlace);
  }

  /**
   * Where the goal of a walk that is not a chase is (`placeOfWalk`): a walker's point of its round,
   * home for a walk home, home's building for a wander about it; anything else (a flight) nobody can
   * place, and the old rules decide.
   */
  private placeOfGoal(d: Decision | null): GoalPlace | null {
    if (!d) return null;
    // One of ours: its routine says where the point it walks to is -- a room of a building, or out in
    // the open -- so the doorway join walks it in through a door and out of one.
    const w = this.routine;
    if (w) {
      if (!w.going) return null;
      this.goalPlace.building = w.building;
      this.goalPlace.room = w.building ? w.room : 0;
      return this.goalPlace;
    }
    const p = this.patrol;
    const onRound = !!p && (d.goal === p.goal || d.state === 'return');
    return placeOfWalk(this.goalPlace, d.state, onRound, p ? p.anchor.room : undefined, this.homeCell, this.navCell);
  }

  /**
   * Whether it may be handed the outdoor grid's corners: a grid baked no steeper than a mobile climbs
   * at a walk (`outdoorNav.forMobiles`), and a body no wider than the grid's own margin
   * (`MOBILE_GRID_ACROSS`). Never anything that flies or is swimming: the grid is the dry ground.
   *
   * People and creatures alike, and that is a decision rather than a default. The grid was kept from
   * the creatures because it was cut at an angle their bodies stall on; a person here is the very same
   * dynamic body a creature is, so whatever made the grid safe for one makes it safe for the other,
   * and at 45 degrees it promises neither a face it cannot walk up. What still keeps the biggest
   * creatures off it is their width, which the grid was never grown for.
   */
  private walksGrid(): boolean {
    return outdoorNav.forMobiles && !this.flyer && !this.swimming && this.plan.across <= MOBILE_GRID_ACROSS;
  }

  private act(dt: number, ctx: MobileContext, tier: LodTier): void {
    const move = this.entry.move;
    const d = this.decision;
    const t = this.targetRef;
    if (t && (t.dead || (t as { removed?: boolean }).removed)) this.targetRef = null;
    // A roll or a jump of its own under way is the whole of this frame: it goes where it was thrown,
    // and whatever it was walking at or striking at waits until it is on its feet again.
    if (this.tumbling) {
      this.stepTumble(dt);
      return;
    }
    // The clip that ends a roll or a jump has run out: its meshes may be culled against the standing
    // sphere again. One boolean a frame, and a cull asked once.
    if (this.cullTumble && this.now >= this.tumbleUntil) this.applyCull();
    // The target moves between thoughts: the chase and the aim follow it every frame.
    let moveTo = d?.moveTo ?? null;
    let face = d?.face ?? null;
    let pace = d?.pace ?? 'stand';
    const target = this.targetRef;
    // `cover` is `attack` or `chase` under another name and is listed with them for that reason. No
    // creature can reach it: the word is gated on `BrainSelf.seeksCover`, which only a tiered person
    // with a gun out of doors sets (`seeksCover`), and such a person must not stop tracking whatever
    // it is fighting the moment it gets behind something.
    if (target && d && (d.state === 'chase' || d.state === 'attack' || d.state === 'cover' || d.state === 'alert')) {
      face = this.faceAt;
      face.x = target.pos.x;
      face.z = target.pos.z;
      if (d.state === 'chase' || (d.state === 'cover' && !!d.moveTo)) {
        moveTo = face;
        // Close enough to strike: stop rather than run on until the next thought. Not with a wall
        // between (`apart`): that is the doorway's to answer, and it is round the corner.
        const gap = Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z) - target.radiusToward(this.pos) - this.radiusToward(target.pos);
        if (this.melee && !this.apart && gap <= (this.bladesOn ? NPC_SABER_TUNE.closeTo : (this.entry.stats?.reach ?? 1.5) * this.scale * 0.8)) pace = 'stand';
      }
    }
    // A person's own feet, for a tier that has any (`tactics.ts`): a cover spot outranks the ring, and
    // the ring outranks the brain's own point, exactly as a fighter's do. Either is a move of its own
    // (`splitMove`), which the feet walk while the gun stays on what it is fighting.
    this.splitMove = false;
    this.gunOnFeet = false;
    const tac = this.tactics;
    if (tac?.skill && tier.move && !this.driven) {
      const frozen = this.stunned > 0 || this.swingAt > 0 || this.now < this.swingUntil;
      if (frozen) pace = 'stand';
      if (this.stepCover(target, d)) {
        moveTo = tac.walkTo;
        // Run for it, and stand once there: a body walking to cover under fire is not behind anything yet.
        pace = frozen || tac.inSpot(this.pos.x, this.pos.z) ? 'stand' : pace === 'stand' ? 'run' : pace;
        this.splitMove = true;
      } else if (!frozen && target && !target.dead && d && this.gun && this.rangedRange > 0 && !this.routine) {
        const gap = Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
        const shooting = d.attack === 'ranged' && (d.state === 'attack' || d.state === 'cover');
        const lineChase = (d.state === 'chase' || d.state === 'cover') && this.lineSeen;
        if (tac.stepStandoff(this.now, this.pos.x, this.pos.z, target.pos.x, target.pos.z, gap, this.key, shooting, lineChase, this.rangedRange, this.speeds.walk * 1.5)) {
          moveTo = tac.walkTo;
          pace = pace === 'stand' ? 'walk' : pace;
          this.splitMove = true;
        }
      }
    }
    // A saber move under way has the whole body, and a leap of one carries it: it stands for both.
    if (this.bladeBusy || this.now < this.leapUntil) pace = 'stand';
    // How low it stands, asked after the feet have been decided (a body sliding or running for a crate
    // is on its feet) and capping the pace: a kneel has no walk and a prone body goes nowhere.
    if (tac) {
      this.stepPosture(dt, pace, target, d);
      pace = paceInPosture(pace, this.posture);
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
    // A move of its own: the feet make for its point while the gun stays on `look`. Standing in its
    // spot it turns to what it fights, as a body with nowhere to go always has.
    if (this.splitMove && moveTo && pace !== 'stand') face = moveTo;
    // The way there. Indoors, the building's own floors say which corner to walk at next on the way
    // to where the brain is sending it; outdoors, the world's baked grid does, for a body it is given
    // to (`walksGrid`); and between the two, when what it is after is on the other side of a wall,
    // the doorway join (`doorway.ts`) walks it to a door and through it, told where the goal is by the
    // room the world follows it in (`placeOf`, `placeOfGoal`). Only where it **travels** is taken from
    // the path, so the arrival test below still measures the real goal and a body walking the last
    // corner of a path does not stop a stride short of it. In a room whose floor the pack has not got
    // with the goal in that same room, out of doors for a body the grid is not given to with its goal
    // on open ground, and for anything that flies, `corner` is null and every line below is the line
    // it always was.
    if (moveTo && pace !== 'stand' && !this.flyer && !this.driven) {
      // A move of its own is to a point of its own on open ground, not to the thing it is fighting.
      const fighting = !this.splitMove && !!target && !!d && (d.state === 'chase' || d.state === 'attack' || d.state === 'cover' || d.state === 'alert');
      // A follower's walk is to its place behind the player, which is in whatever room the player is in:
      // the doorway join walks it through the door they went through, and up to the floor they are on.
      const leader = !fighting && this.follow ? this.follow.leader : null;
      const goalY = fighting && target ? target.pos.y : leader ? leader.pos.y : this.pos.y;
      const place = fighting && target ? this.placeOf(ctx, target) : leader ? this.placeOf(ctx, leader) : this.placeOfGoal(d);
      const corner = doorwayNav.corner(this.navAgent, this.legs, this.navCell, this.pos.x, this.pos.y, this.pos.z, moveTo.x, goalY, moveTo.z, place, this.plan.across, this.now, this.walksGrid());
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
    // Crouched, no faster than its crouch walk shows at its size, so the feet stay planted.
    const low = this.lowClips;
    if (this.posture === 'crouch' && low && low.crouchSpeed > 0) wanted = Math.min(wanted, low.crouchSpeed * this.scale);
    if (moveTo && pace !== 'stand' && Math.hypot(moveTo.x - this.pos.x, moveTo.z - this.pos.z) < 0.5) wanted = 0;
    // Point the feet at the move point, or at the target while attacking -- and the weapon at
    // whatever it is really fighting. The side-step goes on the **feet alone** now: it is a twist
    // of sixty degrees for a second to get round whatever it walked into, and twisting the weapon
    // with it dropped the carry out of its aiming cone and put the gun down for the whole step.
    if (!this.downPhase && this.stunned <= 0) {
      const rate = THREE.MathUtils.degToRad(wanted > this.speeds.walk + 1e-3 ? move.turnRun : move.turnWalk) || Math.PI;
      const turn = rate * dt;
      if (face) {
        let want = this.splitMove ? this.legsWant(face, look) : Math.atan2(face.x - this.pos.x, face.z - this.pos.z);
        if (this.now < this.sidestepUntil && pace !== 'stand') want += this.sidestep;
        this.heading += clamp(Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading)), -turn, turn);
      }
      // The same rate, so the two never come apart faster than a body can turn; with nothing to
      // fight the weapon simply follows the feet, which is where it has always pointed -- and so does
      // one whose own move has taken its feet further off its gun than its legs can show.
      const aimAt = this.gunOnFeet ? face : (look ?? face);
      if (aimAt) {
        const want = Math.atan2(aimAt.x - this.pos.x, aimAt.z - this.pos.z);
        // Measured before the turn, as a fighter's is: the error its trigger's cone is tested against.
        this.aimErr = Math.atan2(Math.sin(want - this.facing), Math.cos(want - this.facing));
        this.facing += clamp(this.aimErr, -turn, turn);
      } else {
        this.facing = this.heading;
        this.aimErr = 0;
      }
    }
    // Speed: the template's acceleration toward the pace, then the gait that matches what it ends up doing.
    const accel = (wanted > this.speeds.walk + 1e-3 ? move.accel?.[0] : move.accel?.[1]) ?? 4;
    // The ramp keeps its own progress (a clamped walk must never hold it off the run), the body goes
    // at what the chosen gait's feet show, and below `still` the ramp stands it (stepGait, gait.ts).
    const gait = stepGait(this.ramp, wanted, accel, dt, this.gaitsNow(), this.idleNow(), this.scale, undefined, this.gaitOut);
    this.ramp = gait.ramp;
    this.speed = gait.speed;
    // On its feet is on the ground, or just lifted onto a step and not yet found it (`onFeet`).
    const feet = onFeet(this.stepWalk, this.grounded, this.pos.y);
    const moving = this.speed > 0.05 && (feet || this.flyer || this.swimming) && this.stunned <= 0 && !this.downPhase && tier.move;
    if (moving) {
      const v = this.body.linvel();
      const sx = Math.sin(this.heading);
      const sz = Math.cos(this.heading);
      // Held back since the last step, walking on its own feet on the ground: a step it can climb,
      // perhaps, and then it is set on the tread and any fall it carried is dropped (`stepUp.ts`).
      // Refused, it does not ask again for `retry` seconds.
      const vy = walkStep(this.deps.physics, this.body, this.stepWalk, this.now, this.grounded && !this.flyer && !this.swimming, this.speed, v.x, v.y, v.z, sx, sz, this.stepShapeNow(), this.pos.x, this.pos.y, this.pos.z, this.inside ? INSIDE : OUTSIDE, stepHit);
      if (this.stepWalk.lifts !== this.liftsSeen) this.noteLift();
      this.body.setLinvel({ x: sx * this.speed, y: vy, z: sz * this.speed }, true);
    } else {
      if (this.grounded && tier.move) {
        // Braking: a fifth off per sixtieth of a second, whatever the frame rate.
        const v = this.body.linvel();
        const brake = Math.pow(0.8, dt * 60);
        this.body.setLinvel({ x: v.x * brake, y: v.y, z: v.z * brake }, true);
      }
      stoodStill(this.stepWalk);
    }
    if (tier.move) {
      tmpQ.setFromAxisAngle(UP, this.heading);
      this.body.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }, moving);
    }
    if (!this.downPhase) this.animator?.loop(gait.clip ?? this.idleNow(), gait.timeScale);
    this.checkStuck(dt, moving ? this.speed : 0);
    this.fight(ctx, d);
  }

  /**
   * The body the step-up climbs with, written into the one struct it keeps: its support's place along
   * its heading (off the origin only on a long creature, whose support capsule sits under its middle
   * rather than its origin), the support's rim, its template's own step height at its size, and how
   * high its origin sits over its feet.
   */
  private stepShapeNow(): StepShape {
    const s = this.stepShape;
    const support = this.plan.colliders[0];
    s.along = support ? support.at[2] : 0;
    s.rim = support ? support.radius : this.plan.across;
    s.step = stepHeightOf(this.entry.size?.stepHeight, this.scale);
    s.feet = this.plan.feet;
    return s;
  }

  /**
   * A lift has just set the body up on a step and along onto its tread, in one step of the physics:
   * the picture is held back by as much and let catch up (`easeLift`), so a body is seen stepping up
   * rather than jumping. Held back in the body's own frame, up and forward, since the lift went along
   * its heading; a lag still being eased when another lift comes is added to, not dropped.
   */
  private noteLift(): void {
    const w = this.stepWalk;
    this.liftsSeen = w.lifts;
    this.liftLagY -= w.rise;
    this.liftLagZ -= w.ahead;
  }

  /** The picture a frame nearer the body it was held back from, and put exactly on it once it is under a millimetre. */
  private easeLift(dt: number): void {
    const k = easeShare(dt);
    this.liftLagY *= k;
    this.liftLagZ *= k;
    if (Math.abs(this.liftLagY) + Math.abs(this.liftLagZ) < 1e-3) {
      this.liftLagY = 0;
      this.liftLagZ = 0;
    }
    this.inner.position.set(0, this.liftLagY - this.plan.feet, this.liftLagZ);
  }

  /** No lag at all: anything that puts the body somewhere new. */
  private dropLiftLag(): void {
    this.liftsSeen = this.stepWalk.lifts;
    this.liftLagY = 0;
    this.liftLagZ = 0;
    this.inner.position.set(0, -this.plan.feet, 0);
  }

  /**
   * For the console (`__debug.stepProbe`): the step-up's probe cast now from where it stands along its
   * heading, as `walkStep` would cast it, with every ray it cast and what each met. It lifts nothing,
   * is counted among the probes' asks like any other, and allocates: nothing in a frame calls it.
   */
  probeStep(): Record<string, unknown> {
    const shape = this.stepShapeNow();
    const sx = Math.sin(this.heading);
    const sz = Math.cos(this.heading);
    const trace: StepTrace[] = [];
    const hit: StepRay = { toi: 0, ny: 0 };
    const top = stepAhead(this.deps.physics, this.pos.x + sx * shape.along, this.pos.y, this.pos.z + sz * shape.along, sx, sz, shape.rim, shape.step, this.inside ? INSIDE : OUTSIDE, hit, undefined, trace);
    const r = (n: number): number => Number(n.toFixed(3));
    return {
      who: this.label,
      key: this.key,
      feet: this.pos.toArray().map(r),
      heading: [r(sx), r(sz)],
      rim: r(shape.rim),
      step: r(shape.step),
      top: Number.isNaN(top) ? null : r(top),
      lifts: this.stepWalk.lifts,
      footing: this.stepWalk.footing,
      rays: trace.map((t) => ({ ray: t.ray, from: t.from.map(r), dir: t.dir.map(r), len: r(t.len), hit: t.hit, toi: t.hit ? r(t.toi) : null, ny: t.hit ? r(t.ny) : null })),
    };
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
      this.stuckEvents++;
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
    // Nothing is struck or shot from a roll, a jump, or the clip that ends one.
    if (!roles || !animator || this.downPhase || this.stunned > 0.3 || this.tumbling || this.now < this.tumbleUntil) return;
    // **A crouched body does nothing at all**, which is the client's own data: of the state hierarchy's
    // twelve crouch states not one carries a fire or an attack. The crouch is how a body moves low; the
    // kneel is how it fights low. A burst under way is let go with it.
    if (this.posture === 'crouch') {
      this.shotsLeft = 0;
      return;
    }
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
    // `cover` is the attack state under another name, exactly as a fighter's is (`Npc.act`): the brain
    // says it in place of `attack` for a tiered person behind something, and `d.attack` beside it is
    // still what says whether a shot would land. Leaving it out is a person that takes a spot and never
    // fires from it again, since a spot it can shoot out of is held for as long as it holds.
    if (!target || !d || (d.state !== 'attack' && d.state !== 'cover')) return;
    // A tiered person pulls the trigger only once its gun has come round to within its tier's cone of
    // where it wants it -- the fighters' own discipline and the fighters' own measure of it, the gun's
    // turn still to make (`aimErr`) -- and swings only on its feet.
    const skill = this.tactics?.skill;
    if (skill && d.attack === 'ranged' && !willFire(skill, this.aimErr)) return;
    if (this.posture !== 'stand' && d.attack === 'melee') return;
    // A lightsaber from the second tier up is swung by its move machine (`stepBlades`), frame by frame,
    // and never by this clock.
    if (d.attack === 'melee' && !this.bladesOn && this.attackCd <= 0 && this.swingAt === 0 && animator.shotLevel < SHOT_PRIORITY.attack) {
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
        // On a knee or flat, the posture's own shots: the game's six kneeling fires a weapon, and the prone one.
        const lowShots = this.posture === 'kneel' ? this.lowClips?.fires.kneel : this.posture === 'prone' ? this.lowClips?.fires.prone : null;
        const shots = lowShots && lowShots.length ? lowShots : roles.rangedShots;
        const shot = shots && shots.length > 1 ? shots[Math.floor(Math.random() * shots.length)] : shots?.length ? shots[0] : roles.ranged;
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
      // Outdoors past the physics' reach, only the ground the world holds (commit 4b); with none, it holds
      // the height it is at -- asked to stay where it is, so a climb or a dive under way is damped out
      // rather than carried on unchecked, with no gravity, for as long as the ground stays unknown.
      const ground = this.deps.groundAt(this.pos.x, t.y, this.pos.z, this.inside) ?? (this.inside ? this.deps.terrain.heightAt(this.pos.x, this.pos.z) : groundUnder(this.pos.x, this.pos.z, this.deps.terrain, this.deps));
      if (this.body.gravityScale() !== 0) this.body.setGravityScale(0, true);
      wantY = ground === null ? t.y : ground + this.plan.hover + this.plan.feet;
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

  /**
   * The mixer at the tier's rate; its time kept, so a thinned mobile's clips run at the right speed. A
   * body whose mixer has not run since it was hung or stood again is in its rest pose, and is posed once
   * whatever its tier: one frozen from the start -- in a room nobody could see (commit 2c), or off the
   * screen -- is otherwise shown in the rest pose on the frame its room or the view first reaches it.
   */
  private animate(dt: number, tier: LodTier): void {
    const a = this.animator;
    if (!a) return;
    this.animAcc = Math.min(2, this.animAcc + dt);
    const every = tier.animEvery;
    if (this.posed) {
      if (every <= 0) return;
      if (every > 1 && (this.frame + this.key) % every !== 0) return;
    }
    a.update(this.animAcc);
    this.animAcc = 0;
    this.posed = true;
  }

  /**
   * Outdoors, a body found well under the terrain is put back on top of it. The ground can change
   * under a mobile: the planet's own heights arrive after the arrival spawn (the wildlife is stood
   * on the stand-in terrain behind the loading screen), and past the physics' reach there is no
   * heightfield to stand on. Returns whether it moved it.
   */
  liftToGround(): boolean {
    if (this.dead || this.disposed || this.inside || this.ragdoll || this.swimming || this.heldUntil > this.now) return false;
    // Past the physics' reach, only where the world already holds the ground (commit 4b): unknown moves nothing.
    const ground = groundUnder(this.pos.x, this.pos.z, this.deps.terrain, this.deps);
    if (ground === null || this.pos.y > ground - 1) return false;
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
      maxHp: Number(this.maxHp.toFixed(1)),
      level: this.level,
      blow: Number(this.blow.toFixed(1)),
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
      // One of the world's creatures, and whether this browser is the one thinking for it; driven, how low
      // its keeper says it stands and whether in its cover spot, which is what the wire carries of a fight.
      shared: this.shared || null,
      driven: this.driven,
      told: this.driven ? { posture: this.posture, cover: this.toldCover, rolling: this.rollLeft > 0, inAir: this.hopping } : null,
      companion: this.companion,
      shadow: this.meshes.some((m) => m.castShadow),
      visible: this.group.visible,
      inside: this.inside,
      room: this.room,
      // Its room has no collision built under it just now, so it is holding its height.
      airless: this.airless,
      // The spot a standing person keeps to, and how far it is off it.
      post: this.post ? `${this.post.kind} ${Math.hypot(this.pos.x - this.homeX, this.pos.z - this.homeZ).toFixed(1)} m off` : null,
      // Following the player, and how far it is from its place behind them; being spoken to; its own tier.
      follow: this.follow ? `place ${this.follow.index + 1}, ${Math.hypot(this.pos.x - this.follow.slotX, this.pos.z - this.follow.slotZ).toFixed(1)} m off${this.follow.run ? ', running' : ''}` : null,
      listening: this.listening !== null,
      fixture: this.fixture,
      essential: this.essential,
      ownTier: this.ownTier,
      // A town walker's round: the point it is at and the one it walks to, legs and rounds walked.
      patrol: this.patrol ? `${this.patrol.walking ? `walking ${this.patrol.at} -> ${this.patrol.to}` : `waiting at ${this.patrol.at}`} of ${this.patrol.points.length}, ${this.patrol.legs} legs (${this.patrol.skipped} given up), ${this.patrol.rounds} rounds` : null,
      // Its walk through a doorway, and whether the ground's grid is handed to it at all.
      door: this.legs.phase === 0 ? null : `${this.legs.phase === 1 ? 'approaching' : 'walking through'} way in ${this.legs.exit}`,
      grid: this.walksGrid(),
      stuckEvents: this.stuckEvents,
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
      // How a person fights: its tier (0 is none of it), its jump level, where its cover is, what it
      // has done, how low it stands and how far its feet are off its gun. `low` null is a pack that
      // cannot draw the low postures, whose body therefore never leaves its feet.
      fight: this.tactics
        ? {
            ...this.tactics.status(this.now, this.pos.x, this.pos.z),
            posture: this.posture,
            forced: this.forcedPosture,
            lean: Number(THREE.MathUtils.radToDeg(wrapAngle(this.heading - this.facing)).toFixed(1)),
            shell: { aimAt: Number(this.halfHeight.toFixed(2)), low: this.lowShape },
            low: this.lowClips ? { canProne: this.lowClips.canProne, kneelShots: this.lowClips.fires.kneel.length, proneShots: this.lowClips.fires.prone.length } : null,
            rolling: this.rollLeft > 0,
            inAir: this.hopping,
          }
        : null,
      // Its lightsaber's moves (`npcSaber.ts`): its tier and style, the move it is in, its Force and what
      // it has swung, leapt and turned away; null for anything but a lightsaber with the machine's clips.
      blade: this.blades ? this.blades.status(this.now) : null,
    };
  }

  /** Taken out of the world: the body, the skeletons' bone textures and the mixer go; the caller releases the assets and the collider handles. */
  dispose(): void {
    if (this.disposed) return;
    // Nothing is said about it going: this browser's body went, and the creature itself belongs to
    // the world (a travel, a world unloaded, a body cleared here). What is dropped is the wire's
    // hold on this body, and only while it is still this body the wire is holding: a creature stood
    // again under the same id has already taken that place. **Before it is marked dead**, which the
    // wire reads as "this died here": marked first, every lair creature and every person put down
    // here was taken for a death, the word that this browser had no body for it any more was never
    // said, and the creature froze on every other screen.
    if (this.shared) {
      const net = npcNow();
      if (net?.find(this.shared) === this) net.remove(this.shared);
    }
    this.disposed = true;
    this.dead = true;
    this.memory.clear();
    this.targetRef = null;
    this.endRagdoll();
    this.deps.physics.world.removeRigidBody(this.body);
    this.animator?.dispose();
    this.animator = null;
    // The pack itself belongs to the asset cache, which the caller releases; only the hold on it goes.
    this.animPack = null;
    this.disposeBlade();
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
    this.cullMeshes.length = 0;
  }
}
