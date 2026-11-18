import * as THREE from 'three';
import type { ClassId, Resource } from '../combat/kit';
import type { ThirdPersonCamera } from '../core/camera';
import type { Input } from '../core/input';
import { Group, groups, PLAYER_SOLVER, RAPIER, type Physics } from '../core/physics';
import { markActor } from '../world/portalRender';
import type { Vehicle } from '../vehicles/vehicle';
import { SEATED_EYE_FALLBACK, SEATED_PELVIS_FALLBACK, bodyLift } from '../vehicles/cockpitSeat';
import { isSurfaceRoom, roomFrame, roomTurn, type WalkableRoom } from '../vehicles/surfaceRoom';
import type { World } from '../world/world';
import { STANCE_ANIM, STYLE_DAMAGE, SaberCombat, type Dir, type SaberInput } from '../combat/saber';
import { SaberThrow, THROW } from '../combat/saberThrow';
import { Ragdoll } from '../combat/ragdoll';
import { canBlock, inFront, parryClip, parryZone, reflectDirection } from '../combat/deflect';
import { JKA, JkaMovement, UNIT, type MoveCommand } from './jkaMove';
import type { CharacterRig, RigState } from './rig';
import { FIGHTS, OFF_HAND, gunKindOf, isSaber, type WeaponClass, type WeaponDef } from './weapons';
import { STYLES, type SaberStyle } from '../combat/saber';
import { SaberBlade } from '../combat/saberBlade';
import { stepBurn as spendBurn } from '../combat/burnMath.ts';
import { breathReport, maxBreath, newBreath, resetBreath, stepBreath as spendBreath, tuneBreath, type Breath, type BreathTune } from './breathMath.ts';
import { LAVA_HARM, newLavaHold, resetLavaHold, stepLavaHold, type LavaHold } from '../world/lavaHarmMath.ts';
import { lavaSinkReport, newLavaSink, resetLavaSink, stepLavaSink as spendLavaSink, tuneLavaSink, type LavaSink, type LavaSinkTune } from './lavaSinkMath.ts';
import { PlayerStats } from './playerStats.ts';
import { newHarm, newHarmAsk, takeHarm, type HarmAsk, type HarmKind } from './harmRule.ts';
import { GRAPPLE_TUNE, Grapple, newFireState, type GrappleBody, type GrappleFireState } from './grapple.ts';
import { RopeRibbon, dartMesh } from './grappleDraw.ts';
import { makeHullController, type PeerHulls } from './grappleFrames.ts';
import { armAimFor } from './grappleMath.ts';
import { newSwimIn, newSwimOut, swimStep, SWIM_DEPTH } from './swimStep.ts';
import { ANIM_TUNE } from '../anim/animTune.ts';
import { MX } from '../anim/animRules.ts';
import { BodyAnim } from '../anim/bodyAnim.ts';
import { BodyLoco, CARRY_FULL, FadeOpts, LegOpts, fightKeysDown, gunClassIndex, newLocoIn } from '../anim/bodyLoco.ts';
import { SlopeRule } from './slopeRule.ts';
import { StepUp } from './stepUp.ts';
import { SwimSink } from '../anim/swimSink.ts';
import { LOCO_TUNE } from '../anim/locoTune.ts';
import { CROUCH, CROUCH_BACK, CROUCH_CLIPS, STAND, clipOfId, isStairPick } from '../anim/locoTable.ts';
import { FELL_UNDER } from '../world/fellOut.ts';
import { FootIk, stairFeetOf } from './footIk.ts';
import { StairSense } from './stairSense.ts';
import { ClimbAsk, LedgeHang, LedgeIn, climbTakesUseFirst, type LedgeWorld } from './ledge.ts';
import { LimbPlace } from './limbPlace.ts';
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { MOVE_TUNE, shapeRulesOn } from '../anim/moveTune.ts';
import { BodyShape, CROUCH_TALL, DEEP_SHARE, LYING, STAND_TALL, ShapeIn, type ShapeWorld } from './bodyShape.ts';
import { BodySpheres, measureSpheres, sphereSourceOf, SPHERES_TRUNK, type SphereWorld } from './bodySpheres.ts';
import { clearClimb, settleClimb } from './climbClear.ts';
import { STILL_FLAGS } from './stairSense.ts';
import { DuckPace, lieOn, paceOn } from './duckPace.ts';
import { ledgeClipName } from '../anim/ledgeClips.ts';
import { figureScaleOf } from './peerHang.ts';
import { WallClimb } from './wallClimb.ts';
import { ClimbCamFollow } from './climbCam.ts';
import { driveBarClips, driveDropClip, driveHangClips, driveRopeClips, releaseBarClip, releaseRopeClip, type HangClipState } from './hangClips.ts';
import { BarSwing, type BarWorld } from './barSwing.ts';
import { RopeSwing, type RopeWorld } from './ropeSwing.ts';
import type { HangingRope } from './hangingRope.ts';
import { ROPE_CLIP_NAMES, ROPE_SWING, ROPE_SWING_TWIN, measureRopeTables, type RopeTables } from '../anim/ropeClips.ts';
import { measureRopeLandTables, type RopeLandTables } from '../anim/ropeClips.ts';
import { BAR_CLIP, BAR_CLIP_NAMES, BAR_FLIGHT_NAME, measureBarFlight, measureBarTable, type BarFlightTable, type BarSwingTable } from '../anim/barClips.ts';
import { WALL_CLIP_NAMES, wallClipName } from '../anim/wallClips.ts';
import { BraceIn, Crowd, HandBrace } from './brace.ts';
import { hostileSides } from '../combat/targets.ts';
import { PLAYER_KEY } from '../combat/kit.ts';
import { DrawnHeight, DrawnIn } from '../anim/drawnHeight.ts';

/**
 * The two lines a fire says, and the only two: one when you catch, one when it goes out, and
 * nothing at all in between. They are ours -- the client's own fire state is a chime and a look and
 * it said no words -- and they are here rather than in the pure module because they are words, which
 * a node test has nothing useful to say about.
 */
const BURN_LIT = 'you are on fire';
const BURN_OUT = 'the fire is out';

/**
 * The two lines a dive says, and the only two: one when the head has been under long enough to be
 * worth saying and one when it comes up. Nothing at all in between, and in particular **nothing per
 * drowning blow**: the message line merges a repeat within two seconds into a rising count, so a
 * line a second would bury everything else the game says while the one thing that matters -- the
 * screen flashing and the health bar going down -- is already on the screen.
 *
 * They are ours, like every other word and number about breath, because there was no going under
 * water in the game at all. They are here rather than in the pure module because they are words.
 */
const BREATH_SHORT = 'you are holding your breath';
const BREATH_BACK = 'you can breathe again';

/** The display's name for the breath row; the row itself is `src/ui/hud.ts`'s. */
const BREATH_LABEL = 'Breath';

// The original game's run is 5.375 m/s; the character stands about 1.75 m.
const RUN_SPEED = 5.5;
/** The player's capsule: its radius and half the straight part, standing and crouched (1.6 m and 1.0 m tall). */
const CAPSULE_RADIUS = 0.35;
const STAND_HALF_HEIGHT = 0.45;
const CROUCH_HALF_HEIGHT = 0.15;
const WALK_SPEED = 2.0;
const JUMP_HEIGHT = 1.4;
/** Depth at which the head is under and looking down dives. */
const DIVE_DEPTH = 1.9;

/**
 * Smoothness II, item 4, after its review: the crouch's own head is read off these clips (`Player.measureDeep`): the
 * crouched walk by class (Alt, nothing, Shift), backing up, and the crouch's own still and moving states where they are a
 * crouch's. The plain crouched walk names when the pack is in. Samples a clip: enough that a cycle's top is within a few
 * millimetres. No number of feel.
 */
const DEEP_MAIN = clipOfId('crouched_walking');
const DEEP_SAMPLES = 48;
/** For a rig whose crouch clips cannot be read: the live read waits this long at the deepest (the crouch's crossfade done), seconds. */
const DEEP_SETTLE = 0.4;
function deepClipsOf(rig: CharacterRig): string[] {
  const out: string[] = [];
  for (const id of CROUCH_CLIPS) if (id) out.push(clipOfId(id));
  out.push(clipOfId(CROUCH_BACK));
  for (const s of ['crouch', 'crouchWalk', 'crouchWalkBack'] as const) {
    const c = rig.stateClip(s);
    if (c && /crouch|sneak/i.test(c)) out.push(c);
  }
  return out;
}
const dive = new THREE.Vector3();
const SWING_TIME = 0.45;

const fwd = new THREE.Vector3();
const rgt = new THREE.Vector3();
const move = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const evaFwd = new THREE.Vector3();
const evaRight = new THREE.Vector3();
const evaUp = new THREE.Vector3();
/** Adrift in space: thrust (m/s²), the brake (m/s²), the fastest drift (m/s) and the roll (rad/s). */
const EVA_ACCEL = 8;
const EVA_BRAKE = 12;
const EVA_MAX_SPEED = 60;
const EVA_ROLL_RATE = 1.6;
/** The kick upward (m/s) a rider gets from a vehicle blowing up under them. */
const FLING_UP = 6;
const seatOffset = new THREE.Vector3();
/** Seating a ship's pilot by the eye: the eye in the hull's frame, the seated clip's eyes and pelvis, and the body's move under the eye. */
const eyeLocal = new THREE.Vector3();
const seatedEye = new THREE.Vector3();
const seatedPelvis = new THREE.Vector3();
const bodyOffset = new THREE.Vector3();
const armDir = new THREE.Vector3();
const barrelA = new THREE.Vector3();
const barrelB = new THREE.Vector3();
const aim = new THREE.Vector3();
const aimFrom = new THREE.Vector3();
const handPos = new THREE.Vector3();
/** The grapple's drawing: the drawn left hand, the dart's place as a one-point rope, and the way the dart points. */
const grappleDrawnHand = new THREE.Vector3();
const grappleDartAt = new Float64Array(3);
const grappleDartDir = new THREE.Vector3();
/** Climbing II, phase 4: a rope's end, as the hook's ribbon takes its free span's (`drawRopes`). */
const ropeEnd = { x: 0, y: 0, z: 0 };
/** Phase 4, maker B: the posed ankles in the rig root's frame (`plantRopeFeet`). */
const ropePlantA = new THREE.Vector3();
const ropePlantB = new THREE.Vector3();
/** The grapple's look (wave 2): the lean as a turn, the rope point's lift it turns, and the arm's turn and way in the figure's own frame. */
const grappleLeanQ = new THREE.Quaternion();
const grappleLift = new THREE.Vector3();
/** Wave 4: the grapple's pivot, read for the ledges' hand-over (`ledgeFromHaul`). */
const ledgePivot = new THREE.Vector3();
const grappleArmTurn = new THREE.Quaternion();
const grappleArmDir = new THREE.Vector3();
const grappleArmLocal = { x: 0, y: 0, z: 0 };
/** How Jedi Academy spells the jump directions in its clip names. */
/** The dual kata's saber protect: the sabers circle the body at this radius and height, this fast. */
const ORBIT = { radius: 1.4, height: 1.0, turnsPerSecond: 1.5 };
const orbitTangent = new THREE.Vector3();
const gripQ = new THREE.Quaternion();
const rollQ = new THREE.Quaternion();
const forearmAxis = new THREE.Vector3();
/** Seconds after a shot before the relaxed carry returns. */
const GUN_READY_SECONDS = 5;
/** Running with the block held, forwards or back-pedalling, is at most this much of the full run. */
const BLOCK_RUN_SCALE = 0.8;
const JUMP_SUFFIX: Record<Dir, string> = { F: '', B: 'BACK', L: 'LEFT', R: 'RIGHT' };

interface Parts {
  hips: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  saber: THREE.Group;
  blade: THREE.Mesh;
  bladeTip: THREE.Object3D;
  hilt: THREE.Mesh;
  /** The staff's second blade, out of the far end of the hilt. */
  staffBlade: THREE.Mesh;
  staffTip: THREE.Object3D;
  /** The second saber of the dual style, in the left hand. */
  saber2: THREE.Group;
  hilt2: THREE.Mesh;
  blade2: THREE.Mesh;
  bladeTip2: THREE.Object3D;
  saberLight: THREE.PointLight;
  rifle: THREE.Group;
  muzzle: THREE.Object3D;
}

/** The placeholder torso's look per class, made once (a material made per swap compiled its shader per swap). */
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const hiltGlow = new THREE.Vector3();
/** The placeholder blade meshes are frames for the blade renderer, never drawn themselves. */
const BLADE_FRAME = new THREE.MeshBasicMaterial({ visible: false });
/** Where the placeholder hilt ends and its blade begins, along the saber's Y. */
const HILT_TOP = 0.13;
/** The blade colour a character starts with. */
export const DEFAULT_SABER_COLOR = '#3aa0ff';
const bladeBase = new THREE.Vector3();
const bladeEnd = new THREE.Vector3();
const hullInv = new THREE.Matrix4();
/** How far the spine turns for the aim before the rest goes on the body's facing (radians). */
const AIM_SPINE_MAX = 0.6;
/** Whether an object is drawn: itself and every parent visible. */
function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
const TORSO_JEDI = new THREE.MeshStandardMaterial({ color: 0xc9b58a, roughness: 0.8, metalness: 0, flatShading: true });
const TORSO_HUNTER = new THREE.MeshStandardMaterial({ color: 0x5f6b6e, roughness: 0.8, metalness: 0.3, flatShading: true });

function buildCharacter(): { group: THREE.Group; parts: Parts } {
  const robe = new THREE.MeshStandardMaterial({ color: 0xc9b58a, roughness: 0.9, flatShading: true });

  const cloth = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9, flatShading: true });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a77a, roughness: 0.8, flatShading: true });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.5, metalness: 0.6 });

  const group = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  group.add(hips);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), robe);
  torso.position.y = 0.45;
  torso.castShadow = true;
  hips.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skin);
  head.position.y = 0.98;
  head.castShadow = true;
  hips.add(head);

  const mkLimb = (len: number, r: number, mat: THREE.Material) => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len - r * 2, 3, 6), mat);
    m.position.y = -len / 2;
    m.castShadow = true;
    g.add(m);
    return g;
  };

  const leftLeg = mkLimb(0.95, 0.11, cloth);
  leftLeg.position.set(-0.14, 0, 0);
  const rightLeg = mkLimb(0.95, 0.11, cloth);
  rightLeg.position.set(0.14, 0, 0);
  hips.add(leftLeg, rightLeg);

  const leftArm = mkLimb(0.7, 0.08, robe);
  leftArm.position.set(-0.34, 0.72, 0);
  const rightArm = mkLimb(0.7, 0.08, robe);
  rightArm.position.set(0.34, 0.72, 0);
  hips.add(leftArm, rightArm);

  // Lightsaber: blade runs along the arm, away from the hand. The blade mesh is never drawn (its
  // material is invisible): it is the frame the SaberBlade renderer draws the real blade in, from
  // the hilt's top (HILT_TOP along its Y) to the tip, and its `visible` flag says whether it is out.
  const saber = new THREE.Group();
  saber.position.set(0, -0.7, 0.05);
  saber.rotation.x = Math.PI;
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.26, 8), metal);
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 8).translate(0, 0.68, 0), BLADE_FRAME);
  const bladeTip = new THREE.Object3D();
  bladeTip.position.y = 1.25;
  const saberLight = new THREE.PointLight(0x66c8ff, 0, 7);
  saberLight.position.y = 0.6;
  // The staff: a second blade out of the other end of the hilt.
  const staffBlade = blade.clone();
  staffBlade.rotation.x = Math.PI;
  staffBlade.visible = false;
  const staffTip = new THREE.Object3D();
  staffTip.position.y = -1.25;
  // The saber's own light is not in the group: the group is hidden as a bounty hunter, and a
  // light that comes and goes recompiles every shader. The hilt's glow comes from the pooled
  // flash lights instead (lightSpots), and this light stays out of the scene.
  saber.add(hilt, blade, bladeTip, staffBlade, staffTip);
  blade.visible = false;
  rightArm.add(saber);
  // The dual style's second saber, for the left hand.
  const saber2 = new THREE.Group();
  saber2.position.set(0, -0.7, 0.05);
  saber2.rotation.x = Math.PI;
  const blade2 = blade.clone();
  blade2.visible = false;
  const bladeTip2 = new THREE.Object3D();
  bladeTip2.position.y = 1.25;
  const hilt2 = hilt.clone();
  saber2.add(hilt2, blade2, bladeTip2);
  saber2.visible = false;
  leftArm.add(saber2);

  // Blaster rifle: barrel along the arm.
  const rifle = new THREE.Group();
  rifle.position.set(0, -0.62, 0);
  rifle.rotation.x = Math.PI / 2;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.7), dark);
  stock.position.z = 0.1;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.55, 8).rotateX(Math.PI / 2), metal);
  barrel.position.set(0, 0.03, 0.65);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, 0.95);
  rifle.add(stock, barrel, muzzle);
  rifle.visible = false;
  rightArm.add(rifle);

  return { group, parts: { hips, torso, head, leftLeg, rightLeg, leftArm, rightArm, saber, blade, bladeTip, hilt, staffBlade, staffTip, saber2, hilt2, blade2, bladeTip2, saberLight, rifle, muzzle } };
}

/**
 * The world editor's flight, as the body is handed to it (`setEditorFlight`): one frame of the free camera, moving the
 * body's own place, which is the world's anchor. Declared here and implemented by the editor's own module (the dev
 * server's alone, `src/editor/flyCam.ts`), so nothing shipped imports the editor.
 */
export interface EditorFlight {
  step(dt: number, input: { mouseDX: number; mouseDY: number; locked: boolean }, pos: { x: number; y: number; z: number }): void;
}

export class Player {
  readonly group: THREE.Group;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  grounded = true;
  swimming = false;
  /** Swimming with the head under the surface (diving). */
  submerged = false;
  /**
   * What the last swimming frame decided about holding the float line, for `__debug.afloat`. One
   * kept object written in place, so asking costs nothing and nothing is allocated in a frame.
   * Every field is the raw number the frame used: what the surface was, where the line therefore
   * was, where the body was, what the spring asked for, whether the holding branch was the one
   * taken at all, what the buoyancy cap left of it, and what the character controller then allowed.
   */
  readonly swimProbe = { dt: 0, surface: 0, want: 0, from: 0, gap: 0, ride: 0, riding: false, asked: 0, capped: 0, moved: Number.NaN, rope: false };
  /** What the swim step reads and hands back (`src/player/swimStep.ts`): kept records, written in place. */
  private readonly swimIn = newSwimIn();
  private readonly swimOut = newSwimOut();
  /** How deep the feet stood under the drawn water on the last update (negative out of it), for the grapple's wading drag. */
  private waterDepth = Number.NEGATIVE_INFINITY;
  /**
   * The air in the lungs (`src/player/breathMath.ts`, which owns every rule about it). It lives on
   * the body rather than on the world's player record, which is where the fire lives, because
   * nothing outside ever *gives* anybody a breath: it is spent by being under water, which is a
   * thing this file already knows and nothing else does.
   */
  private readonly air: Breath = newBreath();
  /**
   * How far a flow has drawn this body down and whether it is in one (`src/player/lavaSinkMath.ts`,
   * which owns every rule about it). It lives here for the same reason the air does: standing in a
   * flow is a thing this file already knows about its own feet, and the sink it causes is a drop on
   * the drawn figure and on the view -- never on the physics body, whose real feet are what the
   * world's harm tick measures and must go on measuring.
   */
  private readonly lava: LavaSink = newLavaSink();
  /**
   * Whether this body counts as standing in a flow, how long it has been out of one and the last
   * depth it really was in: the **same record and the same stepper the world's hazard tick uses**
   * (`LavaHold`, `stepLavaHold` in `src/world/lavaHarmMath.ts`), so the sink and the burn cannot draw
   * different lines. Writing the rule out here instead is exactly how the sink came to have the
   * hysteresis band without the bridge across the gaps it cannot reach.
   */
  private readonly lavaHold: LavaHold = newLavaHold();
  /**
   * What is left of the walking speed after the flow, 0 to 1, written once a step by `stepLavaSink`
   * and read by both movement profiles. It is a second factor rather than a write to
   * `speedMultiplier`, which Force Speed rewrites from scratch every frame.
   */
  private lavaPaceNow = 1;
  heading = 0;
  speedMultiplier = 1;
  saberOn = false;
  classId: ClassId = 'jedi';
  /**
   * The stats the character's progress makes (`src/player/playerStats.ts`), kept and worked out only when what
   * grants them changes: every one its base, today's number, until something is earned. Before anything that
   * reads one, since a field below starts from one of them.
   */
  readonly stats = new PlayerStats();
  hp = 100;
  /** Whole health, as progress makes it (100 until Fortitude raises it). It going up leaves `hp` where it is; going down clamps it (`syncStats`). */
  get maxHp(): number {
    return this.stats.healthMax;
  }
  mounted: Vehicle | null = null;
  /** Swing progress in [0, 1], or -1 when idle (the stand-in swing when the rig has no saber clips). */
  swing = -1;
  /** Ground and air movement: the original game's numbers, or Jedi Academy's (see jkaMove.ts). */
  moveProfile: 'swg' | 'jka' = 'jka';
  readonly jka = new JkaMovement();
  /** The lightsaber move system (Jedi Academy's styles, swings and chains). */
  readonly saber = new SaberCombat();
  /**
   * A blade of ours met another (src/combat/clash.ts): the loser's swing runs out into its return.
   * In a bind neither blade gave way, so neither swing is cut short -- both take the bind's own
   * give from the renderer and go on. One object for the life of the session, so hanging it on a
   * blade every frame never allocates.
   */
  private readonly saberClashed = (loser: boolean, bind: boolean): void => {
    if (loser && !bind) this.saber.clashed();
  };
  /** The Force pool the kit exposes, spent by force jumps. */
  force: { value: number } | null = null;
  /** Whether the rig carries Jedi Academy's clips (set when a rig attaches). */
  hasJkaClips = false;
  /** The saber's flight when thrown (right mouse). */
  readonly thrown = new SaberThrow();
  /**
   * The grappling hook (`src/player/grapple.ts`): the dart, the rope and the two steps of a frame this update
   * runs it through. Every line of it here is behind `out` (flying or attached), and everything that touches
   * the body behind `attached`, so a player who never fires plays exactly as before.
   */
  readonly grapple: Grapple;
  /** The rope's ribbon and the dart, on the scene's root (never under the figure, which the doll clones), hidden until the hook is out. */
  private readonly ropeRibbon: RopeRibbon;
  /** The rope's points where they are drawn (a point on a hull at the hull's drawn pose), kept for the ribbon. */
  private readonly ropeDrawn: Float64Array;
  private readonly dartView: THREE.Mesh;
  /** The capsule collider's height over the feet as the crouch last wrote it: what the grapple's collider sync puts it at. */
  colliderOffsetY = CAPSULE_RADIUS + STAND_HALF_HEIGHT;
  /** The physics world's step count at the last reset: no grapple query is trusted, and no dart fired, until it has stepped since. */
  stepsAtReset = 0;
  /** The player as the grapple sees it: one view, its getters reading the live body whatever world it is in. */
  private readonly gview: GrappleBody;
  /** The grapple's hull test's own controller (wave 3), made once in the world: no body, no collider. */
  readonly hullController: RAPIER.KinematicCharacterController;
  /** The vehicles the grapple's rope may meet (`World.vehicles`, written at the top of each update), and the terrain's height under the body as the frame read it. */
  private grappleVehicles: readonly Vehicle[] = [];
  private groundUnder = Number.NEGATIVE_INFINITY;
  /**
   * Other players' vehicles as the rope sees them (wave 3c): `RemoteBodies.hullBoxes()`, one kept list the peers refill once
   * a frame, which the game hangs here; null with none (the node harness, a page with no peers' bodies).
   */
  grapplePeers: PeerHulls | null = null;
  /** What refuses a shot, filled in place each time it is asked. */
  private readonly fireState: GrappleFireState = newFireState();
  /** Saber defence rank (1..3): how well bolts are blocked and where they are sent (see deflect.ts); it starts at its stat's, which is 3. */
  saberDefense = this.stats.saberDefense;
  /** Holding the block (right mouse) with the saber lit: the stance is up and bolts are turned away. */
  blocking = false;
  /**
   * Jedi Academy's animations and camera facing are in charge: while blocking, swinging, throwing,
   * flipping or rolling. Otherwise the game's own clips play and the body turns the way it runs.
   */
  jkaMode = false;
  /** Which way the current jump was made, for its air and landing clips (PMF_BACKWARDS_JUMP and kin). */
  private jumpDir: Dir = 'F';
  /**
   * What the body remembers for the imported clips (src/anim/bodyAnim.ts): what the air has been since the feet left
   * the ground, the thrown fall and its impact's hold on the keys, the landing playing and how long. Every moment of
   * those is one call on it below, and nothing else here decides any of it.
   */
  private readonly anim = new BodyAnim(ANIM_TUNE, UNIT);
  /**
   * How far the treading figure is drawn under where its body floats (src/anim/swimSink.ts): the rig's root lowered by
   * it, so only what is drawn moves (the capsule, the swim, the wading and the camera's place are as ever).
   */
  readonly swimSink = new SwimSink();

  /** Whether the thrown fall's impact still holds the keys: the game mutes them before anything reads one. */
  get impactLocked(): boolean {
    return this.anim.impactLocked;
  }

  /** Under the owner's air rule, a plain jump is in its float (`BodyAnim.jumpFloat`): the console's. */
  get jumpFloat(): boolean {
    return this.anim.jumpFloat;
  }

  /** How deep the feet are under the water's surface, metres (-Infinity with none): the console's. */
  get waterDepthNow(): number {
    return this.waterDepth;
  }

  /** Thrown from a wreck and not yet down (`fling`). */
  get flung(): boolean {
    return this.anim.flung;
  }

  /**
   * The speed classes (src/anim/bodyLoco.ts): the class Shift and the walk key ask for, the stamina that pays, the
   * imported clip for the way the keys go, what the class moves the body at and how far its clip turns the body from
   * the view. Every moment of those is one call on it below, and nothing else here decides any of it; with the classes
   * off, or on a rig without the imported clips, each call answers "as before".
   */
  readonly loco = new BodyLoco(LOCO_TUNE);
  /** The frame as the classes need it: one kept record, written before `loco.plan`. */
  private readonly locoIn = newLocoIn();
  /** The rate and the fade the classes hand the rig with a state: one kept record; and the fade alone, for a state whose clip keeps its own rate. */
  private readonly legOpts = new LegOpts();
  /** The crouched states were last asked for one of the classes' clips (wave 2b): what lets them go when a blaster takes the legs back. */
  private crouchPreferred = false;
  private readonly fadeOpts = new FadeOpts();
  /**
   * The slope limit (wave 2b, `src/player/slopeRule.ts`): the controller's numbers before the move, its "grounded"
   * judged after it (a face too steep to stand on is never ground), and the slide down such a face. The grapple's
   * harness steps the very same calls in the same places.
   */
  readonly slope = new SlopeRule();
  /**
   * Stairs II (A, `src/player/stepUp.ts`): the collider put where the body is before every move, and the step taken where the
   * controller fell short at a riser up to the step-up's height, a riser taller a wall, at every frame rate. The grapple's
   * harness steps the very same calls in the same places.
   */
  readonly stepUp = new StepUp((h, r) => new RAPIER.Capsule(h, r));
  /** The fade the falling loop comes in with as a slide begins: one kept record (`LOCO_TUNE.slope.fade`). */
  private readonly slideFade = { fade: 0.18 };
  /**
   * Wave 3: the feet placed on what is under them (`src/player/footIk.ts`), once the figure is posed and placed at the end
   * of the update; the stairs the ground ahead and behind makes (`src/player/stairSense.ts`), read after the move for the
   * next frame's legs; and the drawn body's height eased over a step's pop (`src/anim/drawnHeight.ts`).
   */
  readonly feet = new FootIk(LOCO_TUNE.ik, () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
  readonly stairSense = new StairSense();
  readonly drawn = new DrawnHeight();
  /** The stairs wave: how far the moves since the legs last read it took the body along the stairs' travel, metres (stairLoco's and BodyLoco.legs'). */
  private stairMoved = 0.5;
  private readonly drawnIn = new DrawnIn();
  /**
   * Wave 4: the ledges (`src/player/ledge.ts`): a lip grabbed in the air after the move (`sense`), and while it holds the
   * body the hang's own frame in place of the movement (`hangFrame`); and the hands put on the lip and the feet on the
   * wall after the figure is placed (`src/player/limbPlace.ts`, which maker B's bracing asks through `setHand`). The
   * grapple's harness steps the very same calls in the same places.
   */
  readonly ledge = new LedgeHang({ ray: () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }), capsule: (h, r) => new RAPIER.Capsule(h, r), cuboid: (x, y, z) => new RAPIER.Cuboid(x, y, z) });
  private readonly ledgeIn = new LedgeIn();
  /**
   * Climbing II, phase 3 (`climb.bars` 'on', src/player/barSwing.ts): a bar grabbed with the use key after the move (`senseBar`,
   * before the ledges'), and while it holds the body the swing's own frame in place of the movement (`barFrame`), its clip by the
   * pendulum's angle (src/player/hangClips.ts's `driveBarClips`) and the figure drawn with its hands on the bar. The grapple's
   * harness steps the very same calls in the same places.
   */
  readonly bar = new BarSwing({ cuboid: (x, y, z) => new RAPIER.Cuboid(x, y, z), capsule: (h, r) => new RAPIER.Capsule(h, r) });
  /** Phase 3: the bar's clip measured off this rig (`measureBarTable`), once a rig, and the rig it was measured off. */
  private barTable: BarSwingTable | null = null;
  private barTableRig: CharacterRig | null = null;
  /** Phase 3, maker B: the flight's part of the clip measured off the same rig (`measureBarFlight`). */
  private barFlight: BarFlightTable | null = null;
  /** Phase 3: whether the rig's root was last drawn by the bar (`applyBarRoot`), so the next frame off it puts the root back. */
  private barRooted = false;
  /**
   * Climbing II, phase 4 (`climb.ropes` 'on', src/player/ropeSwing.ts): a rope grabbed with the use key after the move (`senseRope`,
   * after the bars'), and while it holds the body the swing's own frame in place of the movement (`ropeFrame`), its clips by the
   * swing (src/player/hangClips.ts's `driveRopeClips`) and the figure drawn with its hands on the rope. The grapple's harness steps
   * the very same calls in the same places. Its ropes are stood by `addRope` (the course's, the console's) and drawn by `drawRopes`.
   */
  readonly rope = new RopeSwing({ cuboid: (x, y, z) => new RAPIER.Cuboid(x, y, z), capsule: (h, r) => new RAPIER.Capsule(h, r) });
  /** Phase 4: the rope's clips measured off this rig (`measureRopeTables`), once a rig, and the rig they were measured off. */
  private ropeTables: RopeTables | null = null;
  private ropeTablesRig: CharacterRig | null = null;
  /** Maker B: the let-go's clips measured off the same rig (`measureRopeLandTables`), and the health at the last frame on the rope (a blow since then of `climb.barKnock` or more knocks the body off). */
  private ropeLandTables: RopeLandTables | null = null;
  private ropeHp = 0.5;
  /** Maker B: whether the last `climbReach` found a rope (the action bar's "grab" for its "climb", as a bar's). */
  reachRope = false;
  /** Phase 4: whether the rig's root was last drawn by the rope (`applyRopeRoot`). */
  private ropeRooted = false;
  /** Phase 4: the scene the ropes' ribbons hang in (the player's own). */
  private readonly ropeScene: THREE.Scene;
  /**
   * Climbing II, phase 2, item 1: the use key handed to the climb by the game's one use-key dispatch (main.ts's E) and still
   * held, which `climb.grab` 'use' grabs and climbs on (`LedgeIn.use`).
   */
  readonly climbAsk = new ClimbAsk();
  /**
   * Climbing II's feedback round, items 3 and 4 (`src/player/bodyShape.ts`, under `MOVE_TUNE`): the capsule lying along a
   * prone body, and ducked under what stands over the body and ahead along its travel. With both switches at their other
   * setting it never writes the collider and today's `setCrouchCollider` does. The grapple's harness steps the very same
   * calls in the same places.
   */
  readonly shape = new BodyShape({ capsule: (h, r) => new RAPIER.Capsule(h, r), ball: (r) => new RAPIER.Ball(r), cuboid: (x, y, z) => new RAPIER.Cuboid(x, y, z) });
  private readonly shapeIn = new ShapeIn();
  /**
   * Climbing II, Smoothness II, items 3 and 4 (`climb.bodyClear` 'spheres', `move.duckHead` 'clear'): the figure's sixteen
   * spheres, measured off the body's own rest mesh when a rig is attached (src/player/bodySpheres.ts): asked of what stands still
   * after the pose while climbing and ducking, the figure pushed out of what they are in; and the drawn top over the capsule's
   * that the duck keeps room for.
   */
  readonly spheres = new BodySpheres({ ball: (r) => new RAPIER.Ball(r), contact: () => new RAPIER.ShapeContact(0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }) });
  /** The frame's seconds the climb's spheres ease their push by (written by the hang's and the wall's frames). */
  private clearDt = 0.5;
  /** Whether the last frame's spheres were the climb's (a climb begun after anything else starts with no push). */
  private spheresClimb = false;
  /** Whether the duck's spheres pushed the figure's root across last frame (its across place is put back before the next). */
  private duckPushed = false;
  /**
   * Smoothness II, item 4, after its review: the rig whose crouch clips have been read for the crouch's own head, and that head
   * (the highest drawn top over the feet the crouched walks and the crouch's own clips carry, metres; NaN until read), read off
   * the clips once a rig (`measureDeep`) so the duck knows it before the first deep duck and never from a pose still crossfading.
   */
  private deepRig: CharacterRig | null = null;
  private deepClip = 0.5;
  /** How long the duck has stood at its deepest (the live read's settle, for a rig whose crouch clips cannot be read). */
  private deepFor = 0.5;
  /** Climbing II's smoothness round, item 4 (`MOVE_TUNE.duckPace`): what the ducked height means for the pace and the clips, and whether the duck laid the body down (src/player/duckPace.ts). */
  readonly duck = new DuckPace();
  /** The placing hand holds something (a building or a prop being put down): the game sets it; the duck waits while it does. */
  handPlacing: (() => boolean) | null = null;
  readonly limbs = new LimbPlace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
  /** The rig's root was put off the body's place by the hang (its x and z): what `placeVisual` puts back. */
  private ledgeRooted = false;
  /**
   * Wave 4, item B: the wall climb (`src/player/wallClimb.ts`): onto a face after the move (`sense`, beside the ledges'),
   * and while it holds the body its own frame in place of the movement (`wallFrame`); and the hands' bracing
   * (`src/player/brace.ts`) after the feet are placed, through the very limbs' solve the ledges hand their lip to (a rig has
   * one hook). The grapple's harness steps the climb's calls in the same places.
   */
  readonly wall = new WallClimb({ ray: () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), capsule: (h, r) => new RAPIER.Capsule(h, r) });
  readonly brace = new HandBrace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
  private readonly braceIn = new BraceIn();
  /** The bodies near enough to brace on, refilled a frame while it is asked (kept). */
  readonly crowd = new Crowd();
  /** The rig's root was put off the body's place and leant by the climb: what `placeVisual` puts back. */
  private wallRooted = false;
  /** The frame's move was cut short across the ground by something in its way (the climb's start reads it). */
  private wallBlocked = false;
  /** The world into a ship's rooms' frame (aboard), for the feet's rays; and the chase camera's point (`followAt`). */
  private readonly roomInverse = new THREE.Matrix4();
  private readonly followPoint = new THREE.Vector3();
  /** The blaster's own relaxed carry (its standing loop), found once a rig and a kind of gun: what rides the upper body over the classes' legs. */
  private readonly carryFor: { rig: CharacterRig | null; gun: string; clip: string | null } = { rig: null, gun: '', clip: null };
  /**
   * Under a block or a swing with the classes ruling: the speed from which Jedi Academy's run has the legs rather than
   * its walk, forward and backing up, found once a rig and a saber style (the geometric mean of the two clips' own
   * speeds: where each is equally far from its own rate). Times the tune's `fight.walkUnder` where it is read.
   */
  private readonly saberRunFrom: { rig: CharacterRig | null; style: string; forward: number; back: number } = { rig: null, style: '', forward: 0.5, back: 0.5 };

  /** Sprinting: the game mutes the fight's keys before anything reads one. */
  get sprinting(): boolean {
    return this.loco.sprinting;
  }

  /** The stamina pool's size as the stats have it (the tune's own until something is earned). */
  get staminaPool(): number {
    return this.stats.apply('move.stamina', LOCO_TUNE.stamina.pool);
  }

  /** Jedi Academy's animations are in charge by what the player is doing (the block held, a fight's move), written each frame beside `jkaMode`. */
  private jkaActing = false;
  /** The walk key is held: the walk clips rather than the runs, whatever the speed. */
  private walkKey = false;
  /** The blaster in hand: a pistol is carried at the side like a hilt, a rifle across the chest. */
  gunKind: 'pistol' | 'rifle' = 'rifle';
  /** The kind of blaster for the torso's turns: a carbine and a heavy weapon play the rifle's carries but may want their own angles. */
  gunClass: 'pistol' | 'carbine' | 'rifle' | 'heavy' = 'rifle';
  /** The weapons in hand from the rack (assets-private/weapons), and their models on the hand bones. */
  readonly equipped: { right: WeaponDef | null; left: WeaponDef | null } = { right: null, left: null };
  private readonly held: { right: THREE.Object3D | null; left: THREE.Object3D | null } = { right: null, left: null };
  /** Where the right hand's thing was taken from, while it is standing in the world instead. */
  private setDown: { parent: THREE.Object3D; index: number } | null = null;
  /**
   * Keep the right hand's thing out of sight although it is held.
   *
   * The three instruments that are furniture: a nalargon is the height of a man and the two boxes
   * are cabinets, so carrying one looks like a fault. It is the caller's word rather than a rule
   * here, because what counts as too big to carry is not something this file can know.
   */
  hideRight = false;
  /** A held weapon's reach for the hit sweep: its grip end and its far end, in the model's own frame. */
  private readonly reach: { right: { near: THREE.Object3D; far: THREE.Object3D } | null; left: { near: THREE.Object3D; far: THREE.Object3D } | null } = { right: null, left: null };
  /** Aiming the blaster (right mouse held): the aimed carry, a steadier shot, the camera in closer. */
  aiming = false;
  /** Seconds since the last shot; the combat carry stays up this long before the relaxed one returns. */
  sinceShot = Infinity;
  /** The rig has the game's blaster carries (set when a rig attaches). */
  hasGunClips = false;
  /** Lying prone (Z toggles it): a crawl, the blaster's prone carries; a saber swing or a jump gets up. */
  prone = false;
  /** Kneeling (V toggles it): still, the blaster's kneel; moving, the crouch key, a jump or a saber swing gets up. */
  kneeling = false;
  /** The jump key stood the body up from prone or a kneel and is still down: no jump until it is pressed again. */
  private jumpLatched = false;
  /** Aiming last frame, to play the game's transition out of the aimed pose when it ends. */
  private wasAiming = false;
  /**
   * Calibration for the blade's angle in the hand, in degrees, set from the console: `stanceRoll`
   * turns the hilt about the forearm in Jedi Academy's held poses only (stances, saber runs), and
   * `jkaRoll` in every Jedi Academy clip, swings included. Both default to nothing.
   */
  /**
   * The torso's turn to the right, in degrees, per blaster: the game's poses point the arm off to the left
   * of the body. `ready` is the hip-fire carry (every posture but prone), `aim` the aim standing or
   * moving, `aimKneel` the aim kneeling or crouched. The pistol's two-handed standing aim points straight.
   */
  readonly gunTune: Record<'pistol' | 'carbine' | 'rifle' | 'heavy', { ready: number; aim: number; aimKneel: number }> = {
    pistol: { ready: 30, aim: 0, aimKneel: 30 },
    carbine: { ready: 30, aim: 30, aimKneel: 30 },
    rifle: { ready: 30, aim: 30, aimKneel: 30 },
    heavy: { ready: 30, aim: 30, aimKneel: 30 },
  };
  /** The torso's current turn for the aim, eased. */
  private aimTwist = 0;
  /**
   * The rest of the way to the crosshair: each frame the barrel is measured where the pose and the tuned
   * turn left it, and the difference to where the camera looks is folded into the torso's turn and tilt
   * for the next frame, so the gun lines up whatever the carry (hip or aimed, standing or kneeling).
   */
  readonly aimFix = { yaw: 0, pitch: 0, on: true };
  /** The hip-fire pose chosen when the combat carry came up, kept while it lasts (a rifle's is a held transition into it). */
  private readyPose: string | null = null;
  readonly gripTune: { jkaRoll: number; stanceRoll: number; source: 'solved' | 'tags'; tilt: number; turn: number } = { jkaRoll: 0, stanceRoll: 0, source: 'solved', tilt: 0, turn: 0 };
  /** The hand bones the sabers hang from, for refitting the grip from the console. */
  private handBones: { right: THREE.Bone | null; left: THREE.Bone | null } = { right: null, left: null };
  /** Bolts turned away so far, for the console. */
  blocks = 0;
  private physics: Physics;
  /**
   * The room this player is in, with physics of its own; `pos` is then in that room's frame. A ship's rooms,
   * or a surface in space the boots hold them to: both are rooms to everything here, and `roomFrame` gives
   * whichever frame the one in hand keeps its physics in.
   */
  aboard: WalkableRoom | null = null;
  /** The ship flown from inside its rooms (standing at its controls, still aboard). */
  piloting: Vehicle | null = null;
  /** Set by the App each frame: the view is inside the cockpit (first person, seated in a ship), so the body rises no more than the collar allows. */
  firstPersonSeat = false;
  /** What the last seating did, for __debug.cockpit: the eyes over the pelvis by the clip, the lift applied, the clip measured. */
  readonly seatReport = { eyeOverPelvis: 0, lift: 0, scale: 1, clip: '' as string | null };
  private seatedClipOf: Vehicle | null = null;
  private seatedClipRig: CharacterRig | null = null;
  private seatedClipName: string | null = null;
  /** The world's own body, collider and controller, kept while aboard a ship and taken back on leaving. */
  private worldBody: { physics: Physics; body: RAPIER.RigidBody; collider: RAPIER.Collider; controller: RAPIER.KinematicCharacterController } | null = null;
  private world: World | null = null;
  /** The thrown saber's own model, spinning through the air. */
  private readonly flying: THREE.Group;
  /** The dual kata's sabers, out of the hands and circling the body. */
  private readonly orbit: THREE.Group[] = [];
  /** A blur disc in the thrown saber's spin plane, coloured like the blade. */
  private readonly flyingBlur: THREE.MeshBasicMaterial;
  /**
   * Every blade the character can have out, each drawn by its own renderer along a frame mesh: the
   * one in the right hand, the staff's second, the dual style's left, the thrown one, the two orbiting.
   * The frame's own visibility (through its parents) says whether the blade is out.
   */
  private readonly blades: { frame: THREE.Object3D; blade: SaberBlade; snap: boolean; hand: 'right' | 'left'; hiltTop: number }[] = [];
  /**
   * Every blade renderer the character has (the orbiting two, then right, staff, left, thrown): the
   * light they throw is read from here, as each drew itself this frame. `saberSegments` is the wrong
   * source for light: it skips the thrown and orbiting blades and ignores ignition.
   */
  readonly saberBlades: SaberBlade[] = [];
  /** The colour the pooled lights glow with around a lit blade: the blade's, softened toward white. */
  saberColor = new THREE.Color(DEFAULT_SABER_COLOR).getHex();
  /** The blade's own colour, as the glow draws it. */
  bladeColor = new THREE.Color(DEFAULT_SABER_COLOR).getHex();

  /** Where the sabers out of the hand want light this frame: the thrown one, the orbiting two. */
  lightSpots(): { pos: THREE.Vector3; intensity: number; distance: number }[] {
    const out: { pos: THREE.Vector3; intensity: number; distance: number }[] = [];
    // Only a lightsaber glows: a sword or polearm from the rack in the right hand lights nothing.
    if (!this.saberInHand) return out;
    if (this.thrown.inFlight) out.push({ pos: this.flying.position, intensity: 2.5, distance: 6 });
    if (this.saberOn && !this.thrown.inFlight && !this.orbiting && this.classId === 'jedi' && !this.mounted) {
      this.parts.saber.getWorldPosition(hiltGlow);
      hiltGlow.y += 0.6;
      out.push({ pos: hiltGlow, intensity: 2.2, distance: 6 });
    }
    if (this.orbiting) for (const g of this.orbit) out.push({ pos: g.position, intensity: 2, distance: 5 });
    return out;
  }

  /** Every blade's white core drawn this frame (in the hand, thrown, orbiting), for the depth of field's glow depth; returns the new count. */
  glowCores(out: THREE.Object3D[], n: number): number {
    for (const b of this.saberBlades) n = b.glowCore(out, n);
    return n;
  }
  private orbitAngle = 0;
  /**
   * The hilt's rotation in the hand for each source of arm poses: SWG's own clips hold the
   * blade the game's way (along the character's forward at rest), Jedi Academy's the way its
   * swings say (the axis the importer solved). The blend follows whichever clip poses the arms.
   */
  private readonly saberQ = { swg: new THREE.Quaternion(), jka: new THREE.Quaternion() };
  private readonly saber2Q = { swg: new THREE.Quaternion(), jka: new THREE.Quaternion() };
  private gripBlend = 0;
  /** The forearm's direction in each hand's own frame, the axis a calibration roll turns about. */
  private readonly forearm = new THREE.Vector3(-1, 0, 0);
  private readonly forearm2 = new THREE.Vector3(1, 0, 0);
  /** A wall run or grab turns the body this way while it lasts. */
  private lockedHeading: THREE.Vector3 | null = null;
  /** The rig has Jedi Academy's back-pedal clips, so the legs keep near the camera's facing while moving. */
  private directional = false;
  /** How far the torso turns from the legs back towards the camera, in radians, this frame. */
  private torsoTwist = 0;
  /** The torso's tilt toward where the camera looks while a blaster is up, so the barrel follows the crosshair. */
  private torsoPitch = 0;
  /** Where the camera looks, kept from the last update for the rig. */
  private readonly lookDir = new THREE.Vector3(0, 0, 1);
  private readonly cmd: MoveCommand = { forward: new THREE.Vector3(), right: new THREE.Vector3(), fmove: 0, smove: 0, walk: false, crouch: false, roll: false, jump: false, jumpPressed: false, attack: false, speedScale: 1 };
  /** Ducking (Ctrl on land): half speed, crouch clips, and the crouched attacks. */
  crouching = false;
  /** What today's crouch rule last wrote onto the collider; null once the body's shape (`shape`) wrote it, so the next write is never skipped. */
  private colliderCrouched: boolean | null = false;
  /** Fly mode for exploring and bug hunting: no gravity, no collision. */
  noclip = false;
  /** Noclip flying speed in m/s (Shift multiplies it); adjusted from the keyboard. */
  noclipSpeed = 35;
  /** Inside a building: ignore the ground and the building's shell, as the game does per cell. */
  inside = false;
  private regenDelay = 0;
  private phase = 0;
  private moveAmount = 0;
  private readonly parts: Parts;
  /** The skinned character, once it has loaded; null while the primitive body stands in. */
  rig: CharacterRig | null = null;
  private groundSpeed = 0;

  constructor(scene: THREE.Scene, physics: Physics) {
    const { group, parts } = buildCharacter();
    this.group = group;
    // The figure and whatever it holds are never weathered (the placeholder body is plain meshes).
    group.userData.weatherDry = true;
    this.parts = parts;
    scene.add(group);
    markActor(group);
    this.physics = physics;
    // The thrown saber: a hilt with its blade, lying flat and spinning like a boomerang.
    this.flying = new THREE.Group();
    const flyHilt = parts.hilt.clone();
    const flyBlade = parts.blade.clone();
    flyBlade.visible = true;
    flyHilt.rotation.z = Math.PI / 2;
    flyBlade.rotation.z = Math.PI / 2;
    // A faint disc in the spin plane reads as the blur of the spinning blade from any angle.
    this.flyingBlur = new THREE.MeshBasicMaterial({ color: 0x8fd6ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    const blur = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32), this.flyingBlur);
    blur.rotation.x = -Math.PI / 2;
    // No light of its own: every point light in the scene makes every shader longer (and on
    // some drivers seconds slower to compile), so the flying saber's glow comes from the pooled
    // flash lights, which the game feeds from lightSpots() each frame.
    this.flying.add(flyHilt, flyBlade, blur);
    this.flying.visible = false;
    this.flying.userData.weatherDry = true;
    scene.add(this.flying);
    markActor(this.flying);
    // Two more for the dual kata: the same spinning saber, one each side of the body.
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const h = parts.hilt.clone();
      const b = parts.blade.clone();
      b.visible = true;
      h.rotation.z = Math.PI / 2;
      b.rotation.z = Math.PI / 2;
      g.add(h, b);
      g.visible = false;
      g.userData.weatherDry = true;
      scene.add(g);
      markActor(g);
      this.orbit.push(g);
      this.blades.push({ frame: b, blade: new SaberBlade(), snap: true, hand: 'right', hiltTop: HILT_TOP });
    }
    // The blades themselves, in the scene's own frame (they are built from world positions each frame).
    // Each follows the hilt in one hand: the right's blade, the staff's second, the thrown and the orbiting ones; the left's blade.
    this.blades.push(
      { frame: parts.blade, blade: new SaberBlade(), snap: false, hand: 'right', hiltTop: HILT_TOP },
      { frame: parts.staffBlade, blade: new SaberBlade(), snap: false, hand: 'right', hiltTop: HILT_TOP },
      { frame: parts.blade2, blade: new SaberBlade(), snap: false, hand: 'left', hiltTop: HILT_TOP },
      { frame: flyBlade, blade: new SaberBlade(), snap: true, hand: 'right', hiltTop: HILT_TOP },
    );
    for (const b of this.blades) {
      scene.add(b.blade.group);
      markActor(b.blade.group);
      this.saberBlades.push(b.blade);
    }
    this.setSaberColor(DEFAULT_SABER_COLOR);
    this.cmd.probe = (dir, dist) => this.probeWall(dir, dist);
    this.cmd.groundDistance = (max) => this.groundDistanceUnits(max);
    this.cmd.floorAhead = (dist) => this.floorAhead(dist);

    const made = Player.makeBody(physics.world);
    this.body = made.body;
    this.collider = made.collider;
    this.controller = made.controller;
    this.hullController = makeHullController(physics.world);
    // Stairs II (A): the capsule's radius and the controller's offset, for the step's casts.
    this.stepUp.at.r = CAPSULE_RADIUS;
    this.stepUp.at.off = 0.04;
    // The grappling hook, its rope and its dart: built now on their one material, hidden and marked as actors,
    // so every warm-up compiles them for the world's pass and the rooms' and the first fire builds nothing.
    this.grapple = new Grapple(RAPIER, physics);
    // Its range, reel, haul, sway and strength read through the player's own stats: the tune's numbers until earned.
    this.grapple.stats = this.stats;
    const self = this;
    this.gview = {
      pos: this.pos,
      vel: this.vel,
      jka: this.jka,
      get grounded() {
        return self.grounded;
      },
      get swimming() {
        return self.swimming;
      },
      get depth() {
        return self.waterDepth;
      },
      get inside() {
        return self.inside;
      },
      get physics() {
        return self.physics;
      },
      get body() {
        return self.body;
      },
      get collider() {
        return self.collider;
      },
      get controller() {
        return self.controller;
      },
      get colliderOffsetY() {
        return self.colliderOffsetY;
      },
      get filter() {
        return self.inside ? groups(Group.all, Group.all & ~(Group.terrain | Group.exterior)) : groups(Group.all, Group.all);
      },
      get hp() {
        return self.hp;
      },
      // A slam's harm goes through the player's own record of a loss, as a fall's does.
      takeDamage: (amount: number, force: boolean, kind: HarmKind) => self.takeDamage(amount, force, kind),
      // Wave 3: the vehicles the rope may meet, the hull test's controller (the world's, never a room's), and the terrain's height under the body.
      get vehicles() {
        return self.grappleVehicles;
      },
      get hullController() {
        return self.aboard ? null : self.hullController;
      },
      get ground() {
        return self.groundUnder;
      },
      // Wave 3c: other players' vehicles, as their boxes.
      get peerHulls() {
        return self.grapplePeers;
      },
    };
    this.ropeRibbon = new RopeRibbon(this.grapple.rope.capacity, GRAPPLE_TUNE.sagSegments);
    this.ropeDrawn = new Float64Array(3 * this.grapple.rope.capacity);
    this.stairMoved = 0;
    scene.add(this.ropeRibbon.mesh);
    markActor(this.ropeRibbon.mesh);
    // (Climbing II, phase 4: the ropes' ribbons hang in the same scene, each made as its rope is stood.)
    this.ropeScene = scene;
    this.dartView = dartMesh();
    scene.add(this.dartView);
    markActor(this.dartView);
  }

  /** The player as the grapple's steps see it (the console and the key block hand it on). */
  get grappleBody(): GrappleBody {
    return this.gview;
  }

  /**
   * Everything that refuses a grapple shot (the design's §3.8), filled in place: what the body itself knows,
   * and what the game hands in (a shuttle's passenger, a jump with the controls, the placing hand, talking, and from
   * wave 4 whether the character owns a rig, which only matters once `everyone` is off).
   */
  grappleFireState(riding: boolean, jump: boolean, placing: boolean, talking: boolean, rig = true): GrappleFireState {
    const s = this.fireState;
    s.rig = rig;
    s.mounted = !!this.mounted;
    s.piloting = !!this.piloting;
    s.noclip = this.noclip;
    s.eva = this.eva;
    s.aboard = !!this.aboard;
    s.riding = riding;
    s.jump = jump;
    s.dead = !!this.ragdoll || this.hp <= 0;
    s.placing = placing;
    s.talking = talking;
    s.prone = this.prone;
    s.kneeling = this.kneeling;
    s.rolling = this.jka.rolling;
    s.special = this.jka.inSpecialJump;
    s.swgProfile = this.moveProfile === 'swg';
    s.stepped = this.physics.steps > this.stepsAtReset;
    // Wave 4: hanging from a ledge or climbing a wall, the hands are full.
    s.climbing = this.climbHolds;
    return s;
  }

  /** The rope point as the hook fires from it: over the feet by `ropeY`, in the world. */
  grappleHand(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + GRAPPLE_TUNE.ropeY, this.pos.z);
  }

  /**
   * The rope and the dart laid for this frame, after the body is posed and before the frame is drawn (beside
   * `drawBlades`): the ribbon from the anchor through every bend to the drawn left hand, the free span hung by
   * the constraint's own slack; the dart in flight, or at the anchor. Hidden while the hook is not out. Writes
   * kept arrays and the two meshes' places; never a matrix in a draw hook.
   */
  drawGrapple(camera: THREE.PerspectiveCamera, screenH: number): void {
    const g = this.grapple;
    const ribbon = this.ropeRibbon;
    const dart = this.dartView;
    if (!g.out) {
      if (ribbon.mesh.visible) ribbon.hide();
      if (dart.visible) dart.visible = false;
      return;
    }
    // The drawn left hand, where the second blade already hangs: the left is Jedi Academy's Force hand.
    const bone = this.rig?.boneFor('leftHand');
    if (bone) bone.getWorldPosition(grappleDrawnHand);
    else this.grappleHand(grappleDrawnHand);
    const h = grappleDrawnHand;
    if (g.flying) {
      grappleDartAt[0] = g.dart[0];
      grappleDartAt[1] = g.dart[1];
      grappleDartAt[2] = g.dart[2];
      ribbon.slack = 0;
      ribbon.screenH = screenH;
      ribbon.lay(grappleDartAt, 1, h, camera);
      dart.position.set(g.dart[0], g.dart[1], g.dart[2]);
      if (g.returning) grappleDartDir.set(h.x - g.dart[0], h.y - g.dart[1], h.z - g.dart[2]);
      else grappleDartDir.set(g.dartVel[0], g.dartVel[1], g.dartVel[2]);
    } else {
      // A hooked prop's end carried onto the prop as it is drawn this frame (the pool wrote its mesh after the update).
      if (g.holding) g.placeThingEnd();
      ribbon.slack = g.slack(this.gview);
      ribbon.screenH = screenH;
      // A point on a hull is laid where the hull is drawn (its group, a physics step behind its body), so the rope
      // stays on the drawn hull; with none on a hull the rope's own points are the world's.
      const pts = g.rope.hullPoints > 0 ? g.drawnPoints(this.ropeDrawn) : g.rope.pts;
      ribbon.lay(pts, g.rope.n + 1, h, camera);
      // Bitten into the surface it struck, along the way it came.
      dart.position.set(pts[0], pts[1], pts[2]);
      if (g.rope.pf[0] === 0) grappleDartDir.set(-g.rope.anchorNormal[0], -g.rope.anchorNormal[1], -g.rope.anchorNormal[2]);
      else g.anchorNormalDrawn(grappleDartDir).negate();
    }
    if (grappleDartDir.lengthSq() > 1e-12) dart.quaternion.setFromUnitVectors(AXIS_Z, grappleDartDir.normalize());
    dart.visible = true;
  }

  /**
   * What the character controller walks straight through: a corpse (a ragdoll is no wall), another
   * player's body (it comes off the wire and teleports, so it must never climb, shove or trap you), and
   * somebody following you (`Physics.markWalkThrough`), who is never in your way. One kept predicate
   * rather than a closure made on every step.
   */
  private readonly walkPast = (c: RAPIER.Collider): boolean => !this.physics.isRagdoll(c.handle) && !this.physics.isPeer(c.handle) && !this.physics.isWalkThrough(c.handle);

  /** A kinematic capsule with its character controller, in a physics world: the player's in the world, or in a ship's room. */
  private static makeBody(world: RAPIER.World): { body: RAPIER.RigidBody; collider: RAPIER.Collider; controller: RAPIER.KinematicCharacterController } {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    // In the solver as the player and nothing else (`PLAYER_SOLVER`), which every collider's default still
    // takes and somebody following the player leaves out, so walking through a follower never shoves it.
    const collider = world.createCollider(RAPIER.ColliderDesc.capsule(STAND_HALF_HEIGHT, CAPSULE_RADIUS).setTranslation(0, CAPSULE_RADIUS + STAND_HALF_HEIGHT, 0).setSolverGroups(PLAYER_SOLVER), body);
    const controller = world.createCharacterController(0.04);
    controller.enableAutostep(0.5, 0.2, true);
    controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    controller.enableSnapToGround(0.35);
    // The figure does not push the vehicles it walks into: the engine's push works the contact
    // between the figure and the body's shape, and with a hull's own triangles as that shape it
    // panicked the moment a figure landed on a ship, after which every call into the engine
    // failed ("recursive use of an object"). __debug.pushBodies(true) turns it back on to check.
    controller.setApplyImpulsesToDynamicBodies(Player.pushBodies);
    controller.setCharacterMass(80);
    return { body, collider, controller };
  }

  /** Whether the figure pushes dynamic bodies it walks into (see makeBody). */
  static pushBodies = false;

  setPushBodies(on: boolean): void {
    Player.pushBodies = on;
    this.controller.setApplyImpulsesToDynamicBodies(on);
    this.worldBody?.controller.setApplyImpulsesToDynamicBodies(on);
  }

  /**
   * Step into a ship's room: the body moves to the room's own physics world, in the hull's
   * frame, and from here `pos` is in that frame; the figure is drawn wherever the hull puts it.
   */
  board(interior: WalkableRoom, local: THREE.Vector3): void {
    // The body moves to another physics world: the rope's anchor is the last world's.
    this.grapple.letGo('board');
    if (this.aboard) this.leave();
    this.mounted = null;
    this.worldBody = { physics: this.physics, body: this.body, collider: this.collider, controller: this.controller };
    this.body.setEnabled(false);
    this.physics = interior.physics;
    const made = Player.makeBody(interior.physics.world);
    this.body = made.body;
    this.collider = made.collider;
    this.controller = made.controller;
    this.pos.copy(local);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.swimming = false;
    this.submerged = false;
    this.body.setTranslation({ x: local.x, y: local.y, z: local.z }, true);
    this.aboard = interior;
    this.placeVisual();
  }

  /** Back to the world's body; the caller then stands the player somewhere with `reset`. */
  leave(): void {
    const saved = this.worldBody;
    const room = this.aboard;
    if (!saved || !room) return;
    this.grapple.letGo('leave');
    const w = room.physics.world;
    w.removeCharacterController(this.controller);
    w.removeRigidBody(this.body);
    this.physics = saved.physics;
    this.body = saved.body;
    this.collider = saved.collider;
    this.controller = saved.controller;
    this.body.setEnabled(true);
    this.worldBody = null;
    this.aboard = null;
    this.piloting = null;
  }

  /** Where the figure stands in the world: `pos` itself, or, aboard a ship, `pos` carried through the hull's transform. */
  get worldPos(): THREE.Vector3 {
    return this.aboard ? this.group.position : this.pos;
  }

  /** Wave 3's crease (`SlopeRule.settling`): the capsule's collider put where the body is before the move, as the grappling rope does. */
  private syncCrease(): void {
    const s = this.creaseAt;
    s.x = this.pos.x;
    s.y = this.pos.y + this.colliderOffsetY;
    s.z = this.pos.z;
    this.collider.setTranslation(s);
  }
  private readonly creaseAt = { x: 0.5, y: 0.5, z: 0.5 };

  /** Wave 3: the feet's placement, the stairs held and the drawn body's lag let go of (the body stood somewhere new). */
  private resetFeet(): void {
    this.feet.reset();
    this.stairSense.reset();
    this.drawn.reset();
    // Wave 4: stood somewhere new, nothing holds a lip any more, and nothing is placed on one.
    this.ledge.reset('stood elsewhere');
    this.wall.reset('stood elsewhere');
    this.brace.reset();
    this.limbs.reset();
    // (Climbing II, phase 3: nor a bar.)
    this.bar.reset('stood elsewhere');
    // (Phase 4: nor a rope.)
    this.rope.reset('stood elsewhere');
  }

  /**
   * Wave 3: where the chase camera follows. Under `stairs.camera` 'smooth' the drawn body's height (its place lifted by
   * the step's lag, along the figure's own up), else `worldPos` itself (the capsule's, its pop at each step and all).
   */
  get followAt(): THREE.Vector3 {
    // Climbing II, Smoothness II, item 7 (`climb.camera` 'eased'): while a climb holds the body, and after it until caught,
    // the eased follow stepped this frame (`stepClimbCam`); never under 'before', where it is never on.
    if (this.camFollow.on && this.camStepped === this.frameNo) return this.followEased.set(this.camFollow.x, this.camFollow.y, this.camFollow.z);
    return this.rawFollowAt();
  }

  /** The place the chase follows with no climbing's ease (wave 3's own): the drawn body's height, else the capsule's place. */
  private rawFollowAt(): THREE.Vector3 {
    const lag = this.drawn.offset;
    if (LOCO_TUNE.stairs.camera !== 'smooth' || lag === 0) return this.worldPos;
    const out = this.followPoint.copy(this.worldPos);
    if (this.aboard) out.add(this.followLift.set(0, lag, 0).applyQuaternion(roomTurn(this.aboard)));
    else out.y += lag;
    return out;
  }
  private readonly followLift = new THREE.Vector3();
  /** Smoothness II, item 7: the eased follow while climbing, the frame it was last stepped, the frame now, and its answer (kept). */
  private readonly camFollow = new ClimbCamFollow();
  private camStepped = -1;
  private frameNo = 0;
  private readonly followEased = new THREE.Vector3();

  /**
   * Smoothness II, item 7: a frame of the camera's follow while climbing (the game's, before it places the camera): toward the
   * place the chase would follow (`rawFollowAt`), critically damped over `climb.camEase` while a climb holds the body and, after
   * it, until caught. Nothing at all under 'before' or with no climb (the follow stays off and the chase reads the body).
   */
  stepClimbCam(dt: number): void {
    const climbing = CLIMB_TUNE.camera === 'eased' && this.climbHolds;
    const p = this.rawFollowAt();
    const F = this.camFollow;
    // The followed place's own speed (the frame before), so a follow begun on a body flying at a lip goes on at its pace.
    const k = dt > 0 && this.camLastOk ? 1 / dt : 0;
    const vx = (p.x - this.camLastX) * k;
    const vy = (p.y - this.camLastY) * k;
    const vz = (p.z - this.camLastZ) * k;
    this.camLastX = p.x;
    this.camLastY = p.y;
    this.camLastZ = p.z;
    this.camLastOk = true;
    if (!climbing && !F.on) return;
    // (The ask written into the follow's own fields: no number crosses a call.)
    F.tx = p.x;
    F.ty = p.y;
    F.tz = p.z;
    F.dt = dt;
    F.climbing = climbing;
    F.ease = CLIMB_TUNE.camEase;
    F.bvx = vx;
    F.bvy = vy;
    F.bvz = vz;
    F.stepIn();
    this.camStepped = this.frameNo;
  }
  private camLastX = 0.5;
  private camLastY = 0.5;
  private camLastZ = 0.5;
  private camLastOk = false;

  /** Smoothness II, item 7: how long the camera, pulled in by a wall, takes to go back out this frame (seconds; nought: today's). */
  get climbCamOut(): number {
    return CLIMB_TUNE.camera === 'eased' && this.camFollow.on ? CLIMB_TUNE.camOut : 0;
  }

  /**
   * Wave 3: how far the first-person eye is put back up after the feet's placement lowered the pelvis (`ik.eye` 'steady',
   * the start: the view does not bob on a slope or stairs), along the figure's up; nought under 'follow'.
   */
  get eyeLift(): number {
    return LOCO_TUNE.ik.eye === 'steady' ? this.feet.drop : 0;
  }

  /** Put the figure where it is: in the world at `pos`, or, aboard, where the hull's transform carries `pos`. */
  placeVisual(): void {
    const room = this.aboard;
    if (room) {
      this.group.position.copy(this.pos).applyMatrix4(roomFrame(room));
      this.group.quaternion.copy(roomTurn(room)).multiply(tmpQ.setFromAxisAngle(UP_AXIS, this.heading));
    } else if (this.eva) {
      this.group.position.copy(this.pos);
      this.group.quaternion.copy(this.evaFrame);
    } else {
      // Leaning into the rope, the figure is drawn turned about the rope point (`leanedAt`); the capsule and `pos`
      // stay upright.
      this.leanedAt(this.group.position);
      // Drawn into the flow it is standing in. `drawnSink` and not `lava.sink`, and the view reads
      // the very same getter, so the two cannot come apart on the paths that place the figure
      // themselves.
      this.group.position.y -= this.drawnSink;
      this.group.rotation.set(0, this.heading, 0);
      if (this.grapple.leaning) this.group.quaternion.premultiply(this.leanTurn(grappleLeanQ));
    }
    // Treading water, the drawn figure under where the body floats (`swimSink`, stepped by the update): the rig's root
    // alone, so the capsule, the camera's place and everything hung on the group stay where the swim has them.
    const rig = this.rig;
    if (rig) rig.root.position.y = this.swimming && !room && !this.eva && this.swimSink.now > 0 ? -this.swimSink.now : 0;
    if (rig) this.rootBase = rig.root.position.y;
    // Wave 3: the drawn body's lag over a step's pop, on the rig's root alone as the sink is (nought under 'before').
    if (rig && this.drawn.offset !== 0) rig.root.position.y += this.drawn.offset;
    // Wave 4: hanging, the figure drawn where its clip's hands are on the lip (each clip authored at a height of its own),
    // and after a let-go eased back onto the body; then the root's level offset put back (never under 'before').
    if (rig && (this.ledgeRooted || this.ledge.offset)) {
      if (this.ledge.offset) this.applyLedgeRoot();
      else {
        rig.root.position.x = 0;
        rig.root.position.z = 0;
        rig.root.quaternion.set(0, 0, 0, 1);
        this.ledgeRooted = false;
      }
    }
    // Wave 4, item B: on a wall, the figure drawn leant into the face with its clip's own wall on it, and after a let-go
    // eased back upright onto the body (on top of the hang's offset in the frame the climb hands its body to a lip).
    if (rig && (this.wallRooted || this.wall.drawn)) {
      if (!this.ledge.offset) {
        rig.root.position.x = 0;
        rig.root.position.z = 0;
      }
      if (this.wall.drawn) this.applyWallRoot();
      else {
        rig.root.quaternion.set(0, 0, 0, 1);
        this.wallRooted = false;
      }
    }
    // Climbing II, phase 3: on a bar, the figure drawn where its clip's hands are on the bar and turned about its own left so its
    // hips stand at the swing's angle, and after a let-go eased back onto the body (never under `climb.bars` 'off').
    if (rig && (this.barRooted || this.bar.offset)) {
      if (this.bar.offset) this.applyBarRoot();
      else {
        rig.root.position.x = 0;
        rig.root.position.z = 0;
        rig.root.quaternion.set(0, 0, 0, 1);
        this.barRooted = false;
      }
    }
    // Climbing II, phase 4: on a rope, the figure drawn where its clip's hands are on the rope and turned about its own left so its
    // hips stand on the rope's line, and after a let-go eased back onto the body (never under `climb.ropes` 'off').
    if (rig && (this.ropeRooted || this.rope.offset)) {
      // (Maker B: after a landing, the drawn lower ankle held no lower than the top while the offset eases out.)
      if (this.rope.offset && this.rope.plantY === this.rope.plantY) this.plantRopeFeet(rig);
      if (this.rope.offset) this.applyRopeRoot();
      else {
        rig.root.position.x = 0;
        rig.root.position.z = 0;
        rig.root.quaternion.set(0, 0, 0, 1);
        this.ropeRooted = false;
      }
    }
  }

  /**
   * Phase 4, maker B: after a landing off a rope, while its drawn offset eases out over the rig's own fade of the landing's clip
   * into the crouch (`RopeSwing.plantY` set), the offset lifted by what the drawn lower ankle stands under the top: the posed
   * ankles read in the rig root's own frame (its place is the frame's to come), never lowered. Two bone reads into kept vectors.
   */
  private plantRopeFeet(rig: CharacterRig): void {
    const R = this.rope;
    const a = rig.boneNamed('lAnkle');
    const b = rig.boneNamed('rAnkle');
    if (!a || !b) return;
    rig.root.updateMatrixWorld(true);
    a.getWorldPosition(ropePlantA);
    b.getWorldPosition(ropePlantB);
    rig.root.worldToLocal(ropePlantA);
    rig.root.worldToLocal(ropePlantB);
    R.ankleLow = (ropePlantA.y < ropePlantB.y ? ropePlantA.y : ropePlantB.y) * rig.root.scale.y;
    R.plantFeet(this.pos);
  }

  /** Phase 4: the rig's root put where the rope draws the figure against the body (its offset, the world's frame, into the group's) and turned about its own left. */
  private applyRopeRoot(): void {
    const rig = this.rig;
    if (!rig) return;
    const R = this.rope;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    rig.root.position.x = R.offX * c - R.offZ * s;
    rig.root.position.y += R.offY;
    rig.root.position.z = R.offX * s + R.offZ * c;
    rig.root.quaternion.setFromAxisAngle(AXIS_X, R.tilt);
    this.ropeRooted = true;
  }

  /** Phase 3: the rig's root put where the bar draws the figure against the body (its offset, the world's frame, into the group's) and turned about its own left. */
  private applyBarRoot(): void {
    const rig = this.rig;
    if (!rig) return;
    const B = this.bar;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    rig.root.position.x = B.offX * c - B.offZ * s;
    rig.root.position.y += B.offY;
    rig.root.position.z = B.offX * s + B.offZ * c;
    rig.root.quaternion.setFromAxisAngle(AXIS_X, B.tilt);
    this.barRooted = true;
  }

  /** The rig's root put where the climb draws the figure against the body (its offset, the world's frame, into the group's) and leant into the face about its own left. */
  private applyWallRoot(): void {
    const rig = this.rig;
    if (!rig) return;
    const W = this.wall;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    rig.root.position.x += W.offX * c - W.offZ * s;
    rig.root.position.y += W.offY;
    rig.root.position.z += W.offX * s + W.offZ * c;
    rig.root.quaternion.setFromAxisAngle(AXIS_X, W.lean);
    this.wallRooted = true;
  }

  /** What `placeVisual` last stood the rig's root at before wave 3's lag and drop: what a branch off the feet puts back (`feetOff`). */
  private rootBase = 0;

  /**
   * Wave 3: a frame off the feet (riding, flying, adrift, dead, the editor's flight): the placement and the drawn lag let
   * go of, and the rig's root put back where `placeVisual` last stood it without them (those branches never place the
   * figure through it). Under every switch at 'before' the root is already there and nothing is written.
   */
  private feetOff(): void {
    this.feet.reset();
    this.drawn.reset();
    // Wave 4: a frame off the feet for any other reason than the ledge's own (riding, flying, adrift, dead, the editor's
    // flight) lets go of the ledge outright. (The hang's own frame lets go of the feet and the lag itself.)
    if (this.ledge.holding) this.ledge.reset('off the feet');
    if (this.wall.holding) this.wall.reset('off the feet');
    if (this.bar.holding) this.bar.reset('off the feet');
    if (this.rope.holding) this.rope.reset('off the feet');
    if (this.brace.busy) {
      this.brace.reset();
      this.limbs.reset();
    }
    const rig = this.rig;
    if (rig && rig.root.position.y !== this.rootBase) rig.root.position.y = this.rootBase;
  }

  /** The grapple's lean (§3.12) as a turn in the world's frame, into `out`. */
  private leanTurn(out: THREE.Quaternion): THREE.Quaternion {
    const l = this.grapple.lean;
    return out.set(l.x, l.y, l.z, l.w);
  }

  /**
   * Where the figure's own origin is drawn, into `out`: `pos`, or while the body leans into the rope, `pos` turned by
   * the lean about the rope point `ropeY` over the feet, so the rope point stays where the rope holds it. What
   * `placeVisual` stands the figure at (before a flow's sink), and what goes to other players with the whole turn.
   */
  leanedAt(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.pos);
    if (!this.grapple.leaning) return out;
    // The rope point less the lean's turn of the rope point's own lift: pos + up·ropeY − L·(up·ropeY).
    const lift = grappleLift.set(0, GRAPPLE_TUNE.ropeY, 0);
    out.y += lift.y;
    lift.applyQuaternion(this.leanTurn(grappleLeanQ));
    return out.sub(lift);
  }

  /**
   * The left arm up the rope (§3.12), laid over the clip's pose by the hook's eased weight: the hook's direction from
   * the rope point to the rope's first point, taken into the figure's own frame as `placeVisual` will stand it this
   * frame (its heading, then the lean, then the rig's own turn under the group), held where no shoulder reaches
   * (`armAimFor`). Called after every other arm aim, unconditionally while the line is out, since the chain before it
   * leaves the arms alone whenever Jedi Academy's clips pose the body.
   */
  private aimGrappleArm(rig: CharacterRig): void {
    const g = this.grapple;
    const turn = grappleArmTurn.setFromAxisAngle(UP_AXIS, this.heading);
    if (g.leaning) turn.premultiply(this.leanTurn(grappleLeanQ));
    turn.multiply(rig.root.quaternion).invert();
    const d = grappleArmDir.set(g.armDir.x, g.armDir.y, g.armDir.z).applyQuaternion(turn);
    armAimFor(d.x, d.y, d.z, GRAPPLE_TUNE, grappleArmLocal);
    rig.aimArm('left', d.set(grappleArmLocal.x, grappleArmLocal.y, grappleArmLocal.z), 0, g.armWeight);
  }

  /** The body left to the physics after death, until the respawn. */
  ragdoll: Ragdoll | null = null;

  /**
   * Die where standing: the rig's pose is handed to a ragdoll (in the room's physics when
   * aboard, in the hull's frame) and the controller's body goes quiet until the respawn. The
   * camera keeps following `pos`, which follows the body from now on.
   */
  startRagdoll(): void {
    // The fire goes out with the body, in silence, and **before** the early return, because a body
    // with no rig dies just as thoroughly. This is the one place a death can be caught: the whole
    // death card is unsimulated, so nothing in the world's own step runs between the blow that kills
    // and the respawn, and `update` below returns at its first line for as long as the ragdoll is
    // up, so nothing spends the burn either. Left standing, a burn with seconds on it would resume
    // on the fresh body the moment the respawn simulated a frame -- with `said` already true, so it
    // would eat the new health bar without a word and then announce that it had gone out.
    this.dropBurn();
    // And the lungs, for the same reason and in the same breath: a body that drowned and was stood
    // up again would otherwise come back with no air in it and take its first blow a second later,
    // with `said` already true, so nothing would have told it to hold its breath.
    this.dropBreath();
    // And up out of the flow, before the matrices below are worked out: the ragdoll is built from
    // where the bones are **drawn**, so a body left drawn a waist into the bed would have every piece
    // of it made inside the ground and thrown apart on the first step that resolved them. The figure
    // rises to its real feet on the frame it dies, which is the one moment the pop is paid for.
    this.dropLavaSink();
    // The rope lets go: the body is the physics' now, and the ragdoll keeps the swing's velocity.
    this.grapple.letGo('death');
    if (this.ragdoll || !this.rig) return;
    this.saber.holster();
    this.thrown.cancel();
    this.rig.stopOverride(0);
    this.group.updateMatrixWorld(true);
    const frame = this.aboard ? roomFrame(this.aboard) : null;
    this.ragdoll = new Ragdoll(this.physics, this.rig.root, { frame, velocity: this.aboard ? null : this.vel });
    this.body.setEnabled(false);
    this.updateBlades();
  }

  /** The body follows the physics: the bones from the bodies, `pos` from the trunk (in the hull's frame aboard). */
  ragdollStep(): void {
    const r = this.ragdoll;
    if (!r) return;
    r.update();
    r.centre(this.pos);
    if (this.aboard) this.aboard.toLocal(this.pos, this.pos);
  }

  /** Back on their feet: the ragdoll is gone and the body enabled; the caller stands them somewhere. */
  endRagdoll(): void {
    if (!this.ragdoll) return;
    this.ragdoll.dispose();
    this.ragdoll = null;
    this.body.setEnabled(true);
    // The ragdoll posed every bone it had a body for; the clips take the skeleton back from its rest, or a joint no clip
    // drives (the face, the extra forearm joints the Mixamo clips leave alone) keeps the ragdoll's turn (the owner,
    // 2026-11-17: the eyes and mouth out of the back of the head after a respawn).
    this.rig?.retakePose();
  }

  /** Stand the player somewhere, keeping health and the rest as they are (stepping off a ship). */
  stand(p: THREE.Vector3): void {
    // A new place: the rope cannot come with it.
    this.grapple.letGo('stand');
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.anim.drop();
    this.slope.reset();
    this.resetFeet();
    // Stood somewhere means stood on your feet: a body put down here is not in whatever flow it was
    // last drawn into, and `placeVisual` below would otherwise draw it a waist under the new ground.
    this.dropLavaSink();
    this.swimSink.drop();
    this.body.setEnabled(true);
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.placeVisual();
  }

  reset(p: THREE.Vector3): void {
    // An arrival, a respawn, a teleport, the console: a new place, and the rope's anchor is the last one's.
    this.grapple.letGo('reset');
    // No grapple query is trusted until the world has stepped since this.
    this.stepsAtReset = this.physics.steps;
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.hp = this.maxHp;
    // Smoothness II, item 7: the camera's follow starts afresh on the body where it is stood.
    this.camFollow.reset();
    this.camLastOk = false;
    // Whole again means not alight either: health back and a fire still burning would be a body put
    // together from two different moments. It is the second of the two guards (the first is at the
    // death itself) and it covers every way a body is stood up fresh -- the respawn, an arrival, the
    // console's own teleport.
    this.dropBurn();
    // Whole means a lungful too: this is the second of the two guards on the breath (the first is at
    // the death itself) and it is what makes a travel taken mid-dive arrive with full lungs, in
    // silence, rather than drowning the player on the far side of a loading screen.
    this.dropBreath();
    // And out of the flow: a body stood up somewhere fresh is stood up on its feet, not drawn a waist
    // into ground it has never been in. `reset` writes the group's place itself a few lines down, so
    // there is nothing here to re-place.
    this.dropLavaSink();
    // And out of the water, which is not the same thing as having air. A body stood up somewhere is
    // stood up dry: leaving these two standing meant the first simulated frame of the new world
    // stepped the breath as a dive (the swim block has not run yet to say otherwise), and worse,
    // that a world with no swim block to run at all -- space, where `update` returns at the EVA
    // branch -- kept the last dive's verdict for ever and drowned the player in vacuum.
    this.swimming = false;
    this.submerged = false;
    this.swing = -1;
    this.slope.reset();
    this.resetFeet();
    this.jka.reset();
    this.anim.drop();
    // Whole means rested too: the stamina is full at a respawn and at an arrival.
    this.loco.refill(this.staminaPool);
    this.swimSink.drop();
    this.saber.holster();
    this.rig?.stopOverride(0);
    this.mounted = null;
    this.eva = false;
    this.body.setEnabled(true);
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.group.position.copy(p);
    // The feedback round, items 3 and 4: stood up fresh on its feet, standing (under 'lying' a prone body gets up, since its
    // lying capsule was never asked for room here; with both switches off the shape never wrote the collider).
    if (shapeRulesOn()) {
      if (MOVE_TUNE.proneShape === 'lying') this.prone = false;
      if (this.shape.kind === LYING || this.shape.tall !== STAND_TALL) this.shape.writeUpright(this.collider, p.x, p.y, p.z, STAND_TALL);
      this.shape.reset();
      this.colliderOffsetY = this.shape.offsetY;
      this.colliderCrouched = null;
    }
    // Climbing II's smoothness round, item 4: nothing of the duck's pace carried to the new place.
    this.duck.reset();
  }

  /** Launch the player into the air (used by Force Jump). */
  launch(vy: number, forwardBoost: number, cam: ThirdPersonCamera): void {
    this.vel.y = vy;
    cam.forward(fwd);
    this.vel.x += fwd.x * forwardBoost;
    this.vel.z += fwd.z * forwardBoost;
    this.grounded = false;
    this.pos.y += 0.05;
    // A Force user's air, as a held jump's is.
    this.anim.forceMove();
  }

  setClass(id: ClassId): void {
    this.classId = id;
    const jedi = id === 'jedi';
    // Only a Force user force jumps, flips and runs walls; the bounty hunter has the jetpack.
    this.jka.forceLevel = jedi ? 3 : 0;
    this.parts.rifle.visible = !jedi;
    if (!jedi && this.saberOn) this.toggleSaber();
    this.parts.saber.visible = jedi;
    this.parts.torso.material = jedi ? TORSO_JEDI : TORSO_HUNTER;
    this.applyClassLook();
  }

  /** Swap the primitive body for a skinned rig; weapons move to its hand bones. */
  /** Take the rig off (a species change puts another on): the model leaves the scene and the placeholder body shows until the next attaches. */
  detachRig(): void {
    const rig = this.rig;
    if (!rig) return;
    rig.stopOverride();
    this.group.remove(rig.root);
    this.rig = null;
    this.spheres.use(null, []);
    this.shapeIn.headOver = Number.NaN;
    this.shapeIn.deepHead = Number.NaN;
    this.deepRig = null;
    this.deepClip = Number.NaN;
    this.deepFor = 0;
    this.hasJkaClips = false;
    this.parts.hips.visible = true;
  }

  attachRig(rig: CharacterRig): void {
    this.rig = rig;
    this.hasJkaClips = rig.has('BOTH_A1_T__B_') || rig.has('BOTH_A2_T__B_');
    this.parts.hips.visible = false;
    rig.root.scale.setScalar(rig.scale);
    this.group.add(rig.root);
    markActor(rig.root);
    // What first person hides, worked out now while the character loads (the masks saved include the actor layer just set).
    rig.prepareHeadHiding();
    this.group.updateMatrixWorld(true);
    // Climbing II, Smoothness II, items 3 and 4: the figure's spheres measured off its own body's rest mesh (an event, once a rig).
    const sphereSrc = rig.character ? sphereSourceOf(rig.character.bodyMeshes()) : null;
    this.spheres.use(rig, sphereSrc ? measureSpheres(sphereSrc) : []);
    this.spheres.headHeld = 0;
    this.shapeIn.headOver = Number.NaN;
    this.shapeIn.deepHead = Number.NaN;
    this.deepRig = null;
    this.deepClip = Number.NaN;
    this.deepFor = 0;
    const hand = rig.boneFor('rightHand');
    const fore = rig.boneFor('rightForeArm');
    const spine = rig.boneFor('spine');
    const leftHand = rig.boneFor('leftHand');
    const leftFore = rig.boneFor('leftForeArm');
    this.jka.clipDuration = (a) => rig.clipDuration(a);
    if (!hand || !spine) console.warn(`rig: no ${!hand ? 'hand' : 'spine'} bone matched; bones are ${rig.boneNames.join(', ')}`);
    const p = this.parts;
    // Bone space may be centimetres (the placeholder rig) or metres (converted skeletons): size
    // props by the bone's world scale so they come out in metres either way.
    const unitsPerMetre = (bone: THREE.Bone) => 1 / Math.max(bone.getWorldScale(new THREE.Vector3()).x, 1e-6);
    if (hand) {
      // Weapons continue the arm line (forearm to wrist, in the hand's own frame) so an aimed
      // arm points them where it looks, whatever axis this skeleton's hand bone runs along.
      const k = unitsPerMetre(hand);
      const along = new THREE.Vector3(-1, 0, 0);
      if (fore) {
        const handQ = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
        const d = hand.getWorldPosition(new THREE.Vector3()).sub(fore.getWorldPosition(new THREE.Vector3())).applyQuaternion(handQ);
        if (d.lengthSq() > 1e-10) along.copy(d).normalize();
      }
      hand.add(p.saber, p.rifle);
      // Where the blade points in the hand: the axis the importer solved from Jedi Academy's
      // swings when it is there; else a guess, the way the character faces with the arms at rest.
      const swgGrip = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.root.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()).invert());
      if (swgGrip.lengthSq() < 1e-6) swgGrip.set(0, 0, 1);
      swgGrip.normalize();
      const grip = this.gripAxis('right', hand) ?? swgGrip;
      this.saberQ.swg.setFromUnitVectors(new THREE.Vector3(0, 1, 0), swgGrip);
      this.saberQ.jka.setFromUnitVectors(new THREE.Vector3(0, 1, 0), grip);
      this.handBones.right = hand;
      this.forearm.copy(along).normalize();
      // The saber's blade runs along its +Y, the rifle's barrel along its +Z. A hold point sits in
      // the palm already; a wrist bone needs the grip moved a little along the arm.
      const grabbed = /^hold/i.test(hand.name);
      p.saber.position.copy(along).multiplyScalar(grabbed ? 0 : 0.02 * k);
      p.saber.quaternion.copy(this.saberQ.swg);
      p.saber.scale.setScalar(k);
      p.rifle.position.copy(along).multiplyScalar(grabbed ? 0.04 * k : 0.1 * k);
      p.rifle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along);
      p.rifle.scale.setScalar(k);
      this.fitGun();
    }
    if (leftHand) {
      // The second saber sits in the left hand the same way.
      const k = unitsPerMetre(leftHand);
      const along = new THREE.Vector3(1, 0, 0);
      if (leftFore) {
        const handQ = leftHand.getWorldQuaternion(new THREE.Quaternion()).invert();
        const d = leftHand.getWorldPosition(new THREE.Vector3()).sub(leftFore.getWorldPosition(new THREE.Vector3())).applyQuaternion(handQ);
        if (d.lengthSq() > 1e-10) along.copy(d).normalize();
      }
      leftHand.add(p.saber2);
      const swgGrip = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.root.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(leftHand.getWorldQuaternion(new THREE.Quaternion()).invert());
      if (swgGrip.lengthSq() < 1e-6) swgGrip.set(0, 0, 1);
      swgGrip.normalize();
      const grip = this.gripAxis('left', leftHand) ?? swgGrip;
      this.saber2Q.swg.setFromUnitVectors(new THREE.Vector3(0, 1, 0), swgGrip);
      this.saber2Q.jka.setFromUnitVectors(new THREE.Vector3(0, 1, 0), grip);
      this.handBones.left = leftHand;
      this.forearm2.copy(along).normalize();
      p.saber2.position.copy(along).multiplyScalar(/^hold/i.test(leftHand.name) ? 0 : 0.02 * k);
      p.saber2.quaternion.copy(this.saber2Q.swg);
      p.saber2.scale.setScalar(k);
    }
    // The game's own blaster carries: only then do the clips pose the arms, else they are aimed by hand.
    this.hasGunClips = !!rig.clipMatching(/^loop_(rifle|pistol)/);
    this.applyClassLook();
  }

  /**
   * The importer's blade axis for a hand, taken from the bone it was solved in (the wrist) into
   * the frame of the bone the weapon hangs from (the hold point), at the bind pose.
   */
  private gripAxis(side: 'left' | 'right', hand: THREE.Bone): THREE.Vector3 | null {
    const tuned = this.tunedGrip(side);
    const bone = tuned && this.rig?.bone(tuned.bone);
    if (!tuned || !bone) return null;
    const axis = new THREE.Vector3(tuned.axis[0], tuned.axis[1], tuned.axis[2]);
    return axis.applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
  }

  /**
   * The importer's blade axis for a hand in the bone it was solved in, from the source the console
   * picked (the swings' solve or the game's tags), tilted and turned by the console's degrees: the
   * numbers to bake into the manifest once a setting looks right in every clip.
   */
  tunedGrip(side: 'left' | 'right'): { bone: string; axis: number[] } | null {
    const all = this.rig?.grip;
    const g = (this.gripTune.source === 'tags' ? all?.tags?.[side] : null) ?? all?.[side];
    if (!g || g.axis.length !== 3) return null;
    const u = new THREE.Vector3(g.axis[0], g.axis[1], g.axis[2]);
    if (u.lengthSq() < 1e-6) return null;
    u.normalize();
    const { tilt, turn } = this.gripTune;
    if (tilt !== 0 || turn !== 0) {
      // Two turns about axes perpendicular to the blade, in the solved bone's frame (mirrored for the left hand).
      const ref = Math.abs(u.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const v = new THREE.Vector3().crossVectors(u, ref).normalize();
      const w = new THREE.Vector3().crossVectors(u, v).normalize();
      const sign = side === 'left' ? -1 : 1;
      u.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(v, (sign * tilt * Math.PI) / 180));
      u.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(w, (sign * turn * Math.PI) / 180));
    }
    return { bone: g.bone, axis: [u.x, u.y, u.z].map((n) => Number(n.toFixed(4))) };
  }

  /** Recompute the hilts' orientation from the console's grip settings. */
  refitGrip(): void {
    const up = new THREE.Vector3(0, 1, 0);
    const right = this.handBones.right && this.gripAxis('right', this.handBones.right);
    if (right) this.saberQ.jka.setFromUnitVectors(up, right);
    const left = this.handBones.left && this.gripAxis('left', this.handBones.left);
    if (left) this.saber2Q.jka.setFromUnitVectors(up, left);
  }

  private applyClassLook(): void {
    const jedi = this.classId === 'jedi';
    this.rig?.tint(jedi ? 0xb9a57c : 0x66727a);
  }

  toggleNoclip(): void {
    this.grapple.letGo('noclip');
    this.noclip = !this.noclip;
    this.setBodyFree(this.noclip);
  }

  /**
   * The body's collider off (it flies through everything and stands on nothing) or back on where the body is now:
   * noclip's toggle and the world editor's flight share it. The velocity is spent either way.
   */
  private setBodyFree(free: boolean): void {
    this.vel.set(0, 0, 0);
    this.body.setEnabled(!free);
    if (!free) {
      this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
      this.grounded = false;
    }
  }

  /**
   * The world editor's flight (`src/editor/flyCam.ts`, the dev server's alone), or null: while it is set the body is the
   * free camera's eye -- the world's anchor, flown and hidden -- and nothing else of the body runs in `update`. Set and
   * cleared by `setEditorFlight`, never directly.
   */
  private editorFlight: EditorFlight | null = null;

  /** Whether the world editor flies the body. */
  get editorFlying(): boolean {
    return this.editorFlight !== null;
  }

  /**
   * Hand the body to the world editor's flight, or take it back (null): the grapple lets go, noclip goes off, the
   * collider goes off by noclip's own helper and the figure is hidden whole (its root, so its shadow goes too) while it
   * flies; taken back, the collider comes back where the body stands and the figure shows again.
   */
  setEditorFlight(flight: EditorFlight | null): void {
    if (flight) {
      this.grapple.letGo('editor');
      this.noclip = false;
      this.rig?.stopOverride();
      this.saber.holster();
      this.thrown.cancel();
      this.updateBlades();
      this.editorFlight = flight;
      this.setBodyFree(true);
      this.swimming = false;
      this.submerged = false;
      this.group.visible = false;
      return;
    }
    if (!this.editorFlight) return;
    this.editorFlight = null;
    this.setBodyFree(false);
    this.group.visible = true;
  }

  toggleSaber(): void {
    this.saberOn = !this.saberOn;
    if (!this.saberOn) {
      this.saber.holster();
      this.thrown.cancel();
      this.rig?.stopOverride();
    }
    this.updateBlades();
  }

  /** The blades' colour (hex, as '#rrggbb' or a number): the glow, the thrown saber's blur, the pooled lights. */
  setSaberColor(hex: string | number): void {
    const c = new THREE.Color(hex);
    this.bladeColor = c.getHex();
    for (const b of this.blades) b.blade.setColor(c.getHex());
    this.flyingBlur.color.copy(c);
    // The light the blade throws is the blade's colour, barely softened so a pure colour still shows the body's shading.
    this.saberColor = c.lerp(new THREE.Color(0xffffff), 0.12).getHex();
  }

  /**
   * How high the eyes are over the feet in the posture held: standing, crouched, kneeling, or lying
   * down. The posture alone, with nothing the world is doing to the body in it -- which is what the
   * sink below needs, and is why the two are separate getters rather than one.
   */
  get postureEye(): number {
    if (this.mounted || this.aboard || this.eva || this.swimming) return 1.5;
    // A roll is a crouch that moves: the view stays down through it, as the game's does.
    if (this.prone) return 0.45;
    if (this.kneeling) return 1.0;
    const posture = this.crouching || this.jka.rolling ? 1.05 : 1.5;
    // The feedback round, item 4: ducked under something, the view comes down with the capsule (first person reads the head).
    return MOVE_TUNE.duck === 'on' ? this.shape.eyeFor(posture) : posture;
  }

  /**
   * How far under its real feet the figure is really **drawn**, which is not always how far the flow
   * has pulled it. Three paths place the group themselves and none of them takes the drop: aboard a
   * hull's rooms and adrift in space `placeVisual` has its own branch (`y` in a hull's frame is not
   * the world's, and there is no lava in either place), and a rider is placed by `syncMount` from the
   * hull's own attitude. None of those three is ever *given* a sink -- `stepLavaSink` hands them the
   * verdict false -- but a sink already in the body takes 0.63 s to let go, and for that moment the
   * figure is up and the drop is still on the record. The camera reads this getter too, so the orbit
   * centre cannot sit under a body that has already risen.
   */
  private get drawnSink(): number {
    return this.mounted || this.aboard || this.eva ? 0 : this.lava.sink;
  }

  /**
   * Where the view centres over `worldPos`: the posture's eye height, less however far a flow has
   * drawn the body down. The drawn figure is lowered by the very same getter in `placeVisual`, so the
   * two can only agree -- in third person the orbit's centre comes down with the shoulders, and in
   * first person the camera is put at the head bone itself, which hangs under the group and has
   * already come with it. This is the whole of requirement 4 and it is one subtraction in each place
   * because they are one number.
   */
  get eyeHeight(): number {
    return this.postureEye - this.drawnSink;
  }

  /** Whether the blade in the right hand is a lightsaber (the placeholder's, or a hilt from the rack) rather than a sword or polearm. */
  get saberInHand(): boolean {
    const r = this.equipped.right;
    return !r || isSaber(r.class);
  }

  /**
   * The lit lightsaber blades in the world this frame, as segments from the hilt's emitter to the tip
   * (only lightsabers: a sword or polearm leaves no burn), for the marks they scorch into what they touch.
   */
  saberSegments(out: { a: THREE.Vector3; b: THREE.Vector3 }[]): number {
    let n = 0;
    if (!this.saberOn || this.classId === 'jedi' && this.mounted) return 0;
    const push = (frame: THREE.Object3D, hiltTop: number, length: number) => {
      if (!isShown(frame) || n >= out.length) return;
      frame.localToWorld(out[n].a.set(0, hiltTop, 0));
      frame.localToWorld(out[n].b.set(0, hiltTop + length, 0));
      n++;
    };
    for (const b of this.blades) {
      if (b.snap) continue;
      const isLeft = b.hand === 'left';
      const held = isLeft ? this.equipped.left : this.equipped.right;
      if (held && !isSaber(held.class)) continue;
      push(b.frame, b.hiltTop, b.blade.spec.length);
    }
    return n;
  }

  /**
   * Draw every blade that is out, from its hilt's top to its tip, with the smear its motion leaves:
   * once a frame, after the body is posed and before the frame is drawn. A blade whose frame is
   * hidden retracts; the thrown and orbiting ones snap, as the blade in the hand does while they
   * are out (the blade leaves with the hilt, it does not shrink back into it).
   */
  drawBlades(dt: number, camera: THREE.Camera): void {
    const busy = this.saber.busy || this.swing >= 0;
    const swing = this.bladeActive ? 1 : busy ? 0.55 : 0;
    const away = this.thrown.inFlight || this.orbiting;
    // Aboard, the sweep is remembered in the hull's frame, so the ship's own motion leaves no smear.
    const hull = this.aboard ? roomFrame(this.aboard) : null;
    for (const { frame, blade, snap, hiltTop } of this.blades) {
      const shown = isShown(frame);
      const length = blade.spec.length;
      // The frame's world matrix is this frame's pose, not the last drawn one, so the blade never trails the hand.
      frame.updateWorldMatrix(true, false);
      frame.localToWorld(bladeBase.set(0, hiltTop, 0));
      frame.localToWorld(bladeEnd.set(0, hiltTop + length, 0));
      // A blade of ours meeting another: the swing gives, and what is left of it runs out into the
      // return the move table already has. The renderer's own recoil happens either way.
      if (!blade.onClash) blade.onClash = this.saberClashed;
      blade.update(dt, bladeBase, bladeEnd, shown, camera, swing, snap || away, hull);
    }
  }

  /** Whether what is held fights with nothing: an instrument, which is carried and played, never swung. */
  get holdsNoWeapon(): boolean {
    const r = this.equipped.right;
    return !!r && FIGHTS[r.class] === 'none';
  }

  /** Which blades show: the main one, the staff's second, the dual style's left-hand saber; none while thrown. */
  private updateBlades(): void {
    const p = this.parts;
    const rightWeapon = this.equipped.right;
    const leftWeapon = this.equipped.left;
    // A weapon from the rack in a hand hides the placeholder there; a lightsaber from the rack keeps the blade, on its own hilt.
    const saberRight = isSaber(rightWeapon?.class);
    const saberLeft = isSaber(leftWeapon?.class);
    const meleeRight = !!rightWeapon && FIGHTS[rightWeapon.class] !== 'gun' && !saberRight;
    const gunRight = !!rightWeapon && FIGHTS[rightWeapon.class] === 'gun';
    const on = this.saberOn && this.classId === 'jedi' && !meleeRight;
    const inHand = !this.thrown.inFlight && !this.orbiting;
    // Bare hands: everything held is put away.
    const bare = this.fists;
    p.saber.visible = this.classId === 'jedi' && !meleeRight && !bare;
    p.hilt.visible = inHand && !saberRight;
    p.blade.visible = on && inHand;
    p.staffBlade.visible = on && inHand && this.saber.style === 'staff';
    // The left hand's saber: the placeholder in the dual style, or the rack's hilt there, with its blade.
    const leftSaber = this.saber.style === 'dual' && !this.orbiting && (!leftWeapon || saberLeft);
    p.saber2.visible = this.classId === 'jedi' && leftSaber && !bare;
    p.hilt2.visible = !saberLeft;
    p.blade2.visible = on && leftSaber;
    p.rifle.visible = this.classId === 'bounty_hunter' && !gunRight && !bare;
    // A thing set down is no longer in the hand and no longer answers to the hand's rules: it is
    // standing in the world, and writing `visible` from here would take it away every frame.
    if (this.held.right && !this.setDown) this.held.right.visible = (inHand || gunRight) && !bare && !this.hideRight;
    if (this.held.left) this.held.left.visible = !this.orbiting && !bare;
    for (const g of this.orbit) g.visible = this.orbiting;
    this.flying.visible = this.thrown.inFlight;
  }

  /**
   * Stand what is in the right hand on the ground, or take it back up.
   *
   * It is one object moved between two parents and nothing is cloned: the model in the hand is the
   * model on the floor. Three of the game's instruments are the whole reason it exists -- a nalargon
   * is the height of a man and the ommni and downey boxes are cabinets, and the game stood all three
   * on the floor and had the player walk up to one.
   *
   * `into` is where it goes (the world's scene); with no `at` it comes back to the hand it left,
   * at the place in that hand's children it had, so nothing about the figure changes.
   */
  putHeldDown(into: THREE.Object3D | null, at: THREE.Vector3 | null, yaw = 0): boolean {
    const obj = this.held.right;
    if (!obj) return false;
    if (at && into) {
      if (!this.setDown) {
        const parent = obj.parent;
        if (!parent) return false;
        this.setDown = { parent, index: parent.children.indexOf(obj) };
      }
      into.add(obj);
      obj.position.copy(at);
      obj.quaternion.setFromAxisAngle(UP_AXIS, yaw);
      obj.scale.setScalar(1);
      obj.visible = true;
      return true;
    }
    const was = this.setDown;
    if (!was) return false;
    this.setDown = null;
    was.parent.add(obj);
    // Back where a hand's thing belongs: the hold's own transform is written every frame by the rig,
    // so nothing here has to remember what it was.
    obj.position.set(0, 0, 0);
    obj.quaternion.identity();
    return true;
  }

  /** Whether the right hand's thing is standing in the world rather than being held. */
  get heldIsDown(): boolean {
    return !!this.setDown;
  }

  /**
   * What is on a hand bone, or null: the model of whatever is held.
   *
   * For a dancer's prop it is an **empty** group, because the prop is a particle effect and has no
   * model; the caller plays the effect at its world matrix. That is the whole reason this is public.
   */
  heldNode(hand: 'left' | 'right'): THREE.Object3D | null {
    return this.held[hand];
  }

  /** True while a swing can hurt: the saber system's attack moves, or the stand-in swing's middle. */
  get bladeActive(): boolean {
    if (this.thrown.inFlight) return false;
    if (this.hasJkaClips) return this.saber.attacking;
    return this.swing >= 0.25 && this.swing <= 0.8;
  }

  /** How many blades are lit: the staff and the dual style carry two. */
  get bladeCount(): number {
    return this.saber.style === 'staff' || this.saber.style === 'dual' ? 2 : 1;
  }

  /** The ends of blade `i` in world space (0 is the one in the right hand). A weapon from the rack sweeps its own length. */
  bladeSegmentAt(i: number, a: THREE.Vector3, b: THREE.Vector3): void {
    const p = this.parts;
    const right = this.reach.right;
    const left = this.reach.left;
    const saberRight = isSaber(this.equipped.right?.class);
    if (i === 0 && right && !saberRight) {
      right.near.getWorldPosition(a);
      right.far.getWorldPosition(b);
      return;
    }
    if (i === 1 && this.saber.style === 'dual' && left && !isSaber(this.equipped.left?.class)) {
      left.near.getWorldPosition(a);
      left.far.getWorldPosition(b);
      return;
    }
    if (i === 1 && this.saber.style === 'staff' && right && !saberRight) {
      // A polearm: the shaft's other half.
      right.near.getWorldPosition(a);
      right.far.getWorldPosition(b);
      b.sub(a).multiplyScalar(-0.5).add(a);
      return;
    }
    if (i === 0) {
      p.saber.getWorldPosition(a);
      p.bladeTip.getWorldPosition(b);
    } else if (this.saber.style === 'staff') {
      p.saber.getWorldPosition(a);
      p.staffTip.getWorldPosition(b);
    } else {
      p.saber2.getWorldPosition(a);
      p.bladeTip2.getWorldPosition(b);
    }
  }

  /** How much a posture steadies a shot from the hip: prone most, then a kneel, then a crouch. */
  get postureSpread(): number {
    return this.prone ? 0.35 : this.kneeling ? 0.5 : this.crouching ? 0.75 : 1;
  }

  /**
   * The game's one-shot between two postures (standing, crouched, kneeling, prone), when it has one:
   * a blaster in combat has its own set, aimed or not. A crouch's only plays standing still, and not
   * while Jedi Academy's crouch is in charge.
   */
  private postureTransition(was: { prone: boolean; kneel: boolean; crouch: boolean }, moving: boolean): void {
    const rig = this.rig;
    if (!rig) return;
    const from = was.prone ? 'prone' : was.kneel ? 'kneeling' : was.crouch ? 'crouched' : 'standing';
    const to = this.prone ? 'prone' : this.kneeling ? 'kneeling' : this.crouching || this.duck.crouch ? 'crouched' : 'standing';
    if (from === to) return;
    if ((from === 'crouched' || to === 'crouched') && (moving || this.jkaMode)) return;
    const names: string[] = [];
    const gun = this.classId === 'bounty_hunter' && this.hasGunClips && this.gunReady ? this.gunKind : null;
    if (gun && from !== 'crouched' && to !== 'crouched') {
      if (this.aiming) {
        names.push(`trn_${gun}_combat_${from}_aimed_to_${gun}_combat_${to}_aimed`);
        // One of these names is misspelt in the archives themselves: the aimed way down from lying
        // to kneeling spells the destination `kneleing`, and the converter writes what the archives
        // hold, so the correctly spelled name matches nothing and the posture change falls back to
        // the plain transition without saying so. Asked for by name beside the right one rather than
        // mended in the converter, because a pack should hold what the client holds and the rest of
        // the game should not have to know which of the two spellings a clip arrived under. The
        // right name is tried first, so a pack that ever carries it wins.
        if (to === 'kneeling') names.push(`trn_${gun}_combat_${from}_aimed_to_${gun}_combat_kneleing_aimed`);
      }
      names.push(`trn_${gun}_combat_${from}_to_${gun}_combat_${to}`);
    }
    names.push(`trn_${from}_to_${to}`);
    const clip = rig.firstOf(...names);
    if (clip) rig.play(clip, { fadeIn: 0.08 });
  }

  /**
   * Put a weapon from the rack in a hand: its model on the hand's hold point (the game's hardpoint,
   * which its meshes are made for), its class picking the carries, the style and the sweep. Returns
   * the class of kit the weapon wants (a blaster the bounty hunter's, a blade the jedi's), or null
   * for a thing that is not a weapon at all -- an instrument, which wants neither kit and must not
   * light a blade or change the class to be picked up and played.
   */
  equip(def: WeaponDef, model: THREE.Object3D, hand: 'right' | 'left' = 'right'): ClassId | null {
    if (hand === 'left' && !OFF_HAND.has(def.class)) hand = 'right';
    this.unequip(hand);
    const bone = this.handBones[hand];
    const holder = new THREE.Group();
    holder.name = `weapon:${def.id}`;
    holder.add(model);
    if (bone) {
      const k = 1 / Math.max(bone.getWorldScale(new THREE.Vector3()).x, 1e-6);
      holder.scale.setScalar(k);
      bone.add(holder);
    } else this.parts.rightArm.add(holder);
    markActor(holder);
    // The reach: the grip is the model's origin, the far end the extreme of its longest extent.
    const near = new THREE.Object3D();
    const far = new THREE.Object3D();
    // The manifest's min and max come swapped from some packs, so the extents are taken as sizes: the
    // longest axis is the barrel or the blade, and its far end the extreme farther from the grip.
    const b = def.bounds;
    if (b) {
      const ext = [0, 1, 2].map((k) => Math.abs(b.max[k] - b.min[k]));
      const axis = ext.indexOf(Math.max(...ext));
      const towards = Math.abs(b.max[axis]) >= Math.abs(b.min[axis]) ? b.max[axis] : b.min[axis];
      far.position.setComponent(axis, towards);
    } else far.position.y = def.length;
    holder.add(near, far);
    this.held[hand] = holder;
    this.reach[hand] = { near, far };
    this.equipped[hand] = def;
    if (isSaber(def.class)) {
      // The rack's hilt hangs where the placeholder's does in that hand, so the blade comes out of it: the
      // model is centred on the grip, so the blade begins half its length up, and the blade file says how long.
      const saber = hand === 'right' ? this.parts.saber : this.parts.saber2;
      holder.removeFromParent();
      saber.add(holder);
      holder.scale.setScalar(1 / Math.max(saber.getWorldScale(new THREE.Vector3()).x, 1e-6));
      this.setBladeSpec(hand, def.blade ? { length: def.blade.length, width: def.blade.width, open: def.blade.open, close: def.blade.close } : null, b ? Math.abs(b.max[1] - b.min[1]) / 2 : HILT_TOP);
    }
    const fights = FIGHTS[def.class];
    if (fights === 'gun') {
      this.gunKind = gunKindOf(def.class);
      this.gunClass = def.class as 'pistol' | 'carbine' | 'rifle' | 'heavy';
    } else if (fights !== 'none' && this.classId === 'jedi' && !this.saberOn) this.toggleSaber();
    this.settleStyle();
    this.updateBlades();
    return fights === 'gun' ? 'bounty_hunter' : fights === 'none' ? null : 'jedi';
  }

  /**
   * The blades in one hand: their size and timing from a rack saber's blade file (the placeholder's when
   * null), and where up the hilt they begin; the tips the hits are swept to move to match.
   */
  private setBladeSpec(hand: 'right' | 'left', spec: { length: number; width: number; open: number; close: number } | null, hiltTop = HILT_TOP): void {
    const s = spec ?? { length: 1.1, width: 0.12, open: 0.32, close: 0.32 };
    for (const b of this.blades) {
      if (b.hand !== hand) continue;
      b.blade.spec = { ...s };
      b.hiltTop = hiltTop;
    }
    const tip = hiltTop + s.length;
    if (hand === 'right') {
      this.parts.bladeTip.position.y = tip;
      this.parts.staffTip.position.y = -tip;
    } else this.parts.bladeTip2.position.y = tip;
  }

  /** Take the rack's weapon out of a hand (the placeholder comes back). */
  unequip(hand: 'right' | 'left'): void {
    const held = this.held[hand];
    if (held) {
      held.removeFromParent();
      held.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
    if (isSaber(this.equipped[hand]?.class)) this.setBladeSpec(hand, null);
    this.held[hand] = null;
    this.reach[hand] = null;
    this.equipped[hand] = null;
    this.settleStyle();
    this.updateBlades();
  }

  /**
   * The saber styles the weapons in hand allow: a polearm or a double-bladed saber fights as the staff, a
   * blade in each hand (any but the staff) as the dual style, a single sword or knife with the three
   * single-blade styles, a lightsaber with the styles its grip allows, empty hands with all five.
   */
  get allowedStyles(): SaberStyle[] {
    const r = this.equipped.right;
    const l = this.equipped.left;
    if (r && FIGHTS[r.class] === 'gun') return STYLES;
    if (r && OFF_HAND.has(r.class) && l && OFF_HAND.has(l.class)) return ['dual'];
    if (r?.class === 'polearm' || r?.class === 'lightsaberStaff') return ['staff'];
    if (r?.class === 'lightsaber2h') return ['medium', 'strong'];
    if (r?.class === 'lightsaber') return ['fast', 'medium', 'strong'];
    if (r?.class === 'fist' || r?.class === 'knife') return ['fast'];
    if (r && (FIGHTS[r.class] === 'single')) return ['fast', 'medium', 'strong'];
    return STYLES;
  }

  /** Keep the style within what the hands allow. */
  private settleStyle(): void {
    const allowed = this.allowedStyles;
    if (!allowed.includes(this.saber.style)) this.saber.style = allowed.includes('medium') ? 'medium' : allowed[0];
  }

  /** Size the placeholder gun to its kind: a pistol is a stub of the rifle until the weapons are converted. */
  fitGun(): void {
    const s = this.gunKind === 'pistol' ? 0.45 : 1;
    this.parts.rifle.scale.set(this.parts.rifle.scale.x, this.parts.rifle.scale.y, Math.abs(this.parts.rifle.scale.x) * s);
  }

  /** The combat carry is up: aiming, or within five seconds of a shot. */
  get gunReady(): boolean {
    return !this.fists && (this.aiming || this.sinceShot < GUN_READY_SECONDS);
  }

  /** A shot left the blaster: keep the combat carry up, and play the shot on the upper body when the rig has one. */
  shotFired(): void {
    this.sinceShot = 0;
    const rig = this.rig;
    if (!rig || !this.hasGunClips) return;
    // Prone has its own shots; standing and kneeling use the game's additive shots (add_<kind>_fire_N), a recoil on the arms over whatever pose is up.
    const kind = this.gunKind;
    // The hierarchy's own shots for the posture first (pistol_combat_standing_fire_N, pistol_combat_kneeling_fire_N), then the additive ones.
    const posture = this.prone ? 'prone' : this.kneeling ? 'kneeling' : 'standing';
    // Prone, the aimed shots for every shot: the unaimed prone shots throw the off hand about.
    let shots = this.prone ? rig.clipsMatching(new RegExp(`^${kind}_(combat_)?prone_aimed_fire_\\d+$`)) : [];
    if (!shots.length) shots = rig.clipsMatching(new RegExp(`^${kind}_(combat_)?${posture}(_aimed)?_fire_\\d+$`));
    if (!shots.length && this.kneeling) shots = rig.clipsMatching(new RegExp(`^${kind}_kneeling_fire_\\d+$`));
    if (!shots.length && !this.prone) shots = rig.clipsMatching(new RegExp(`^add_${kind}_fire_\\d+$`));
    const pool = shots.length ? shots : rig.clipsMatching(new RegExp(`^(add_)?${kind}_(combat_)?(prone_|kneeling_|standing_)?fire_\\d+$`));
    if (pool.length) rig.playUpper(pool[Math.floor(Math.random() * pool.length)], 0.04);
  }

  /** The dual kata is on: both sabers are out of the hands, circling the body. */
  get orbiting(): boolean {
    return this.saber.move === 'DUAL_SPIN_PROTECT' && this.saberOn;
  }

  /** The ends of orbiting saber `i` (0 or 1) in world space. */
  orbitSegment(i: number, a: THREE.Vector3, b: THREE.Vector3): void {
    const g = this.orbit[i];
    a.copy(g.position).addScaledVector(orbitTangent.set(Math.cos(g.rotation.y), 0, -Math.sin(g.rotation.y)), -0.5);
    b.copy(g.position).addScaledVector(orbitTangent, 1.0);
  }

  /** Fly the dual kata's sabers round the body, as the game's saber protect does. */
  private updateOrbit(dt: number): void {
    if (!this.orbiting) return;
    this.orbitAngle += ORBIT.turnsPerSecond * Math.PI * 2 * dt;
    for (let i = 0; i < 2; i++) {
      const g = this.orbit[i];
      const a = this.orbitAngle + i * Math.PI;
      g.position.set(this.pos.x + Math.cos(a) * ORBIT.radius, this.pos.y + ORBIT.height, this.pos.z + Math.sin(a) * ORBIT.radius);
      // The blade lies along the circle and spins on its own as well.
      g.rotation.set(0, -a + this.orbitAngle * 3, 0);
    }
  }

  /** Where the right hand is, for the throw and the catch. */
  handPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.parts.saber.getWorldPosition(out);
  }

  /** A wall past the body's edge along `dir` (horizontal), `dist` units out: its normal, or null. */
  private probeWall(dir: THREE.Vector3, dist: number): THREE.Vector3 | null {
    const len = CAPSULE_RADIUS + dist * UNIT;
    const origin = { x: this.pos.x, y: this.pos.y + 0.9, z: this.pos.z };
    const ray = new RAPIER.Ray(origin, { x: dir.x, y: 0, z: dir.z });
    const filter = this.inside ? groups(Group.all, Group.all & ~(Group.terrain | Group.exterior)) : groups(Group.all, Group.all);
    const hit = this.physics.world.castRayAndGetNormal(ray, len, true, undefined, filter, undefined, this.body, (c) => {
      const body = c.parent();
      return !body || body.isFixed();
    });
    if (!hit) return null;
    return new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
  }

  /** Whether a floor lies `dist` units ahead of the body's edge, within a body height below its middle (the top of a wall being run up). */
  private floorAhead(dist: number): boolean {
    const yaw = this.heading;
    const d = CAPSULE_RADIUS + dist * UNIT;
    const x = this.pos.x + Math.sin(yaw) * d;
    const z = this.pos.z + Math.cos(yaw) * d;
    return this.physics.groundDistance(x, this.pos.y + 1.0, z, 1.0 + 64 * UNIT, this.body) !== null;
  }

  /** Distance to the ground below the feet in units, or null beyond `max` units. */
  private groundDistanceUnits(max: number): number | null {
    const d = this.physics.groundDistance(this.pos.x, this.pos.y + 0.1, this.pos.z, max * UNIT + 0.1, this.body);
    return d === null ? null : Math.max(0, (d - 0.1) / UNIT);
  }

  /**
   * A bolt flying along `dir` has reached the body at `hit`: turn it away with the saber when it
   * can be blocked (lit, in hand, ahead of the view, and not mid-swing below the top defence
   * rank), writing the way it leaves to `out` and playing the parry for where it struck.
   */
  deflect(dir: THREE.Vector3, hit: THREE.Vector3, cam: ThirdPersonCamera, out: THREE.Vector3): boolean {
    if (this.classId !== 'jedi' || this.mounted || this.noclip || this.swimming) return false;
    const attacking = this.hasJkaClips ? this.saber.attacking : this.swing >= 0;
    if (!canBlock({ blocking: this.blocking, saberOn: this.saberOn, inHand: !this.thrown.inFlight, attacking, special: this.jka.inSpecialJump || this.jka.rolling || this.saber.busy, rank: this.saberDefense })) return false;
    cam.forward(fwd);
    aimFrom.copy(this.pos);
    aimFrom.y += 1.55;
    if (!inFront(hit, aimFrom, fwd)) return false;
    cam.camera.getWorldDirection(aim);
    reflectDirection(this.saberDefense, dir, aim, out);
    this.blocks++;
    // The parry: a whole-body clip, so only when the legs have nothing better to do.
    if (this.rig && this.hasJkaClips && !attacking && this.groundSpeed < 1) {
      cam.right(rgt);
      const clip = parryClip(this.saber.style, parryZone(hit, aimFrom, rgt), (c) => this.rig!.has(c));
      if (clip) this.rig.play(clip, { fadeIn: 0.05 });
    }
    return true;
  }

  /** Whether anything alive or a turret stands within `radius` metres of the body in a direction relative to its facing. */
  private enemyNear(dir: 'F' | 'B' | 'L' | 'R', radius: number): boolean {
    const world = this.world;
    if (!world) return false;
    const sx = Math.sin(this.heading);
    const sz = Math.cos(this.heading);
    // Forward is (sin, cos) of the heading; right is turned a quarter round.
    const dx = dir === 'F' ? sx : dir === 'B' ? -sx : dir === 'R' ? sz : -sz;
    const dz = dir === 'F' ? sz : dir === 'B' ? -sz : dir === 'R' ? -sx : sx;
    const near = (p: THREE.Vector3): boolean => {
      const ox = p.x - this.pos.x;
      const oz = p.z - this.pos.z;
      const along = ox * dx + oz * dz;
      const across = Math.abs(ox * dz - oz * dx);
      return along > 0 && along < radius + 0.5 && across < 0.8 && Math.abs(p.y - this.pos.y) < 2;
    };
    // Everything alive but the player itself, then the emplacements, which are not alive at all.
    // Walked in place rather than joined into a list: this is asked several times a frame.
    const me = world.playerTarget;
    for (const c of world.targets()) if (c !== me && !c.dead && near(c.pos)) return true;
    for (const t of world.turrets.turrets) if (!t.dead && near(t.pos)) return true;
    return false;
  }

  /** Damage of the current style's swing, times what progress makes of it (exactly 1 until something does). */
  get saberDamage(): number {
    return STYLE_DAMAGE[this.saber.style] * this.stats.saberDamage * this.damageBoost;
  }

  /** What the blade does over its style's damage (Force Rage raises it). */
  damageBoost = 1;
  /** Bare hands: the weapon put away and hidden, the mouse buttons brawling (the kits' bare-hands toggle). */
  fists = false;
  /** Whether the feet are moving, for a punch to ride the upper body over the run. */
  get moving(): boolean {
    return this.groundSpeed > 0.1;
  }
  /** A punch or kick under way, for the body to face the camera through it. */
  fistsBusy = false;
  /** What hurts the player counts for this much (Force Protect lowers it). */
  damageTaken = 1;

  startSwing(): boolean {
    if (this.swing >= 0) return false;
    this.swing = 0;
    return true;
  }

  /**
   * God mode (`__debug.god`, `src/player/godMode.ts`): nothing takes health off. Asked first in
   * `takeDamage`, which every way the player is hurt ends in, so this one flag is the whole of it for
   * the body. Never saved: a reload is always mortal.
   */
  god = false;

  /**
   * Last stand (Fortitude 75): armed by the game as a fight opens once the skill has reached it, and spent by the
   * first blow or fall that would have killed, which leaves one point of health instead (`harmRule.ts`).
   */
  lastStand = false;
  /** Told of every point of health really lost, and what took it: a blow, a fall, the player's own blast, or the surroundings. */
  onHarm: ((lost: number, kind: HarmKind) => void) | null = null;
  /** Told of a blow a roll's first moments dodged (`roll.iframes`), naming whatever struck it, or null. */
  onDodge: ((source: unknown) => void) | null = null;
  /** Told of a landing roll that saved some of a fall: how far the fall was, in metres, and the health it kept. */
  onRolled: ((fell: number, saved: number) => void) | null = null;
  /** The harm rule's question and answer, kept: a blow can land every frame (a held flame). */
  private readonly harmAsk: HarmAsk = newHarmAsk();
  private readonly harmAnswer = newHarm();

  /**
   * Health off for a blow; false when it was refused (god mode, or a roll's dodge), so the caller shows no red
   * flash and no arc for a blow that did nothing. `force` is the console's own `kill('player')`, which still
   * kills. `kind` is what it is -- a blow from something, a fall, the player's own blast or cloud, or the
   * surroundings -- and `source` whatever struck, for a dodge to name (`harmRule.ts` is the whole of it, the
   * glue included: `takeHarm` reads the roll and last stand off this body and writes the answer back).
   */
  takeDamage(amount: number, force = false, kind: HarmKind = 'blow', source: unknown = null): boolean {
    if (this.god && !force) return false;
    if (!takeHarm(this, amount, force, kind, source, this.harmAsk, this.harmAnswer)) return false;
    this.regenDelay = 5;
    return true;
  }

  heal(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  /**
   * The stats moved (`stats.update` answered true): the player's own saber swings at its rate, and health over a
   * whole that went down comes down to it. A whole that went up leaves health where it is, to fill by regeneration.
   */
  syncStats(): void {
    this.saber.swingScale = this.stats.saberSwing;
    if (this.hp > this.maxHp) this.hp = this.maxHp;
  }

  /**
   * A fire the player is carrying, spent. The burn itself lives on the world's player record
   * (`PlayerTarget.burn`), because `afflict` is the one contract a striker has ever reached; what
   * happens here is the **spending** of it, deliberately beside the regeneration delay in `update`,
   * so the two pause and step together and neither can ever run while the other does not.
   *
   * Three things it does not do. It does not take the damage off directly: it hands it to the
   * record's own `damage`, which is the path that applies the regeneration lockout and raises the
   * red flash, with **no direction**, so the screen flashes and no arc points anywhere -- a fire is
   * on you and not off to one side of you. It does not say a word per blow: one line when you catch
   * and one when it goes out, because the message line merges a repeat within two seconds into a
   * rising count that would bury everything else the game says. And it does not end a fire that has
   * become impossible: a fire ends where the body does (`startRagdoll`, `reset`) or where the world
   * does (`World.unload`), which are the three moments this step is never called in.
   *
   * A burn that is not burning costs one property read, which is why it is called unconditionally.
   */
  private stepBurn(dt: number, world: World): void {
    const t = world.playerTarget;
    if (!t.burning) return;
    const r = spendBurn(t.burn, dt);
    if (r.started) world.onNote?.(BURN_LIT);
    // Mounted, the record's own callback refuses the blow, exactly as it refuses every other blow
    // on a rider; the fire goes on burning and is seen and heard, and it costs the rider nothing.
    if (r.damage > 0) t.damage(r.damage);
    // And if that last blow was the one that finished you, nothing is said: "the fire is out" over
    // your own corpse, on the very frame the death card comes up, is the one moment this line reads
    // as a joke. `hp` is read after the blow rather than predicted from it, because a blow the
    // game's own rule refuses (a rider's) takes nothing off and should still end with the words.
    if (r.ended && this.hp > 0) world.onNote?.(BURN_OUT);
  }

  /**
   * The fire out and forgotten, in silence, because this is no longer the body that caught it: it
   * has died, or it has been stood up whole somewhere. The burn itself lives on the world's player
   * record, so this is one hop through the world the last `update` was given -- null before the
   * first, which is exactly when there is nothing to put out.
   *
   * Silence is the point: `clearBurn` puts `said` back with the rest, so nothing is announced about
   * a fire that ended because the body did, and the next one says its own first line.
   */
  private dropBurn(): void {
    this.world?.playerTarget.clearBurn();
  }

  /**
   * The breath as the display reads it, or **null when there is nothing to show** -- which is every
   * frame on dry land, and is what lets the row be absent rather than empty. It is the same
   * `{ label, value, max }` shape the class pool has (`Kit.resource`), so the row that draws it is
   * the row that already draws one, and it is deliberately a second field rather than a borrowing of
   * that one: the Bounty Hunter has no class pool at all, so there is no slot to borrow.
   *
   * One kept object, written in place. A getter that built one would put an object into every frame
   * of every dive, and the display reads it once a frame.
   */
  get breath(): Resource | null {
    const b = this.air;
    const max = maxBreath();
    // A lungful of no seconds at all has no bar to draw: a row with `max` 0 is a length the display
    // would have to divide by. `tuneBreath` refuses to write one, so this is only reachable by
    // writing the number itself, and the honest answer is the same as dry land -- there is nothing
    // to show. The display guards this too; a getter that hands out a shape nobody can draw is this
    // file's own fault and not the row's.
    if (max <= 0) return null;
    // Full and not under: nothing to draw. `left` reaches `max` exactly (the recovery clamps to it),
    // so this is a real equality and not a threshold that could leave a hairline of bar on screen.
    if (!b.under && b.left >= max) return null;
    const r = this.breathRes;
    r.value = b.left;
    r.max = max;
    return r;
  }

  /** The kept reading behind `breath`; its label never changes and is written once. */
  private readonly breathRes: Resource = { label: BREATH_LABEL, value: 0, max: 0 };

  /** Seconds of air left, for anything that wants the number without the display's shape. */
  get breathLeft(): number {
    return this.air.left;
  }

  /**
   * The breath: the numbers in force and the air as it stands, with the console's own knob
   * (`__debug.breath`). Every one of them is **ours** -- there was no going under water in the game
   * at all, so there is no table to be faithful to and nothing here is the client's.
   *
   * `breath({ on: false })` is the switch that makes the game exactly what it was: the lungs go back
   * to full there and then, rather than at the next step, because the step is in `update`, which
   * does not run while a panel is open. `breath({ full: true })` fills them without changing a
   * number, which is how to climb out of a dive from the console.
   */
  setBreath(tune?: BreathTune & { full?: boolean }): ReturnType<typeof breathReport> & { hp: number } {
    if (tune) {
      tuneBreath(tune);
      if (tune.on === false || tune.full) resetBreath(this.air);
    }
    return { ...breathReport(this.air), hp: Math.round(this.hp * 10) / 10 };
  }

  /**
   * The air, spent under water and recovered out of it. Beside the fire and the regeneration delay
   * in `update`, deliberately and for the same reasons: the three pause together with a panel, step
   * together under `__debug.advance`, and every drowning blow sets the regeneration delay afresh, so
   * nothing can be healing while the lungs are empty.
   *
   * What counts as under is `submerged` (the head below the surface, which the swim block works out
   * from the **lava-filtered** water height, so a flow is not something you can drown in) and the
   * four states in which this body is not in the water at all whatever `submerged` says: riding,
   * noclipping, adrift in space, and standing in a hull's rooms.
   *
   * All four of those return from `update` **before** the swim block, so none of them has anything
   * to write a fresh verdict with, and this used to be the only thing standing between a stale
   * `submerged` and a drowning. Naming them is now the second line and not the first: every one of
   * those four branches puts `submerged` down for itself, beside the `swimming` it was already
   * putting down (`board`, `mount`, `evaUpdate`, `flyUpdate`), and so does `reset`, which is every
   * way a body is stood up somewhere fresh. The rule those enforce is that `submerged` is never true
   * while `swimming` is false -- the swim block only ever sets it from `swimming` -- so a leftover
   * is now an impossible state rather than a state this one test has to catch. The test stays
   * because it is four properties on a record and the thing it would cost to be wrong about is a
   * player drowning in vacuum.
   *
   * It does not take the damage off directly: it hands it to the world's player record, which is the
   * path that applies the regeneration lockout and raises the red flash, with **no direction**, so
   * the screen flashes and no arc points anywhere -- there is no side that water is on. And it
   * passes no `source`, so nothing anywhere is blamed for it.
   */
  private stepBreath(dt: number, world: World): void {
    const under = this.submerged && !this.mounted && !this.noclip && !this.eva && !this.aboard;
    const r = spendBreath(this.air, dt, under);
    if (r.started) world.onNote?.(BREATH_SHORT);
    if (r.damage > 0) world.playerTarget.damage(r.damage);
    // Surfacing and drowning cannot fall on the same step (one needs the head out, the other needs
    // it in), so the order of these two is a matter of reading rather than of arithmetic.
    //
    // `hp > 0` is the same guard the fire's last line carries two methods above, and for the same
    // reason: "you can breathe again" over your own corpse is the one moment this line reads as a
    // joke. A body with a rig never reaches it -- `update` returns at its first line for as long as
    // the ragdoll is up -- but the placeholder body has no rig, `startRagdoll` returns before it
    // sets `ragdoll`, and `update` goes on running for the second and a half the death card takes,
    // which is long enough to refill the lungs over a corpse and say so.
    if (r.ended && this.hp > 0) world.onNote?.(BREATH_BACK);
  }

  /**
   * The lungs full again and the dive forgotten, in silence, because this is no longer the body that
   * took the breath: it has died, or it has been stood up whole somewhere (a respawn, an arrival on
   * another world, the console's own teleport). `resetBreath` puts `said` back with the rest, so
   * nothing announces that a drowning body can breathe again.
   */
  private dropBreath(): void {
    resetBreath(this.air);
  }

  /**
   * The flow's hold on the body: how far it has drawn the figure down, and what that leaves of its
   * walk. Beside the fire, the regeneration delay and the breath in `update`, deliberately and for
   * the same reasons: the four pause together with a panel, step together under `__debug.advance`,
   * and each of them is a thing the ground is doing to a body over time.
   *
   * It runs **before** the four branches that return early (riding, noclipping, adrift in space,
   * standing in a hull's rooms), which is the whole reason it is up here rather than down in the
   * block that reads the water. None of those four is standing in anything, so none of them feeds the
   * sink; but every one of them still has to let a sink already in the body come back out, and a step
   * that only ran on the walking path would leave a figure that mounted a speeder half-way into a
   * flow drawn low for as long as it rode. The verdict is simply false for all four and the sink
   * rises out of its own accord.
   *
   * The depth is last frame's feet, exactly as the breath reads last frame's `submerged`: a sixtieth
   * of a second against a sink that takes two and a half, and the price of being here where a panel
   * pauses it.
   *
   * Two things it deliberately does not do. It never moves the physics body: `pos` is what the
   * world's harm tick measures, so a sink that moved it would change how fast a flow kills, and a
   * capsule pushed into the bed would be shoved straight back out by the controller on the same step.
   * And it does not draw the verdict itself: `stepLavaHold` is the world's own, record and all, so
   * the sink is in the flow on exactly the steps the burn is.
   *
   * That is not a nicety. The band in `inLava` moves a line by `hold` metres, but `stillInLava`
   * bridges a gap no distance can reach -- where no local table covers a column `World.lavaAt` falls
   * through to the global sea's level, metres *below* the feet, so the depth jumps from half a metre
   * under the surface to a large negative and back in the space of two steps. A verdict with the band
   * and not the bridge came out false across such a seam, and the figure climbed out of a full sink
   * at the rising rate (four times the going one) and then stepped back down into it.
   *
   * Across a bridged step the depth read is the last one that really was in the flow (`hold.depth`),
   * not the column's, so the figure goes on toward the target it had rather than chasing a surface
   * that is not there.
   */
  private stepLavaSink(dt: number, world: World): void {
    const onFoot = !this.ragdoll && !this.mounted && !this.noclip && !this.eva && !this.aboard;
    const h = this.lavaHold;
    // Off its own feet, or with the flow's own switch off, nothing about a flow reaches this body and
    // the hold is forgotten exactly as the hazard tick forgets its own. The sink then rises out of
    // wherever it had got to, which is what stops a body that mounts half-way into a flow from being
    // drawn low for as long as it rides.
    if (!onFoot || !LAVA_HARM.on) resetLavaHold(h);
    else stepLavaHold(h, dt, world.lavaAt(this.pos.x, this.pos.y, this.pos.z));
    const r = spendLavaSink(this.lava, dt, h.in ? h.depth : -Infinity, h.in, this.postureEye);
    this.lavaPaceNow = r.pace;
  }

  /**
   * The sink as it stands and the numbers in force, with the console's own knob
   * (`__debug.lava({ sink: … })`, which is where it belongs: it is one of the things a flow does).
   * Every one of them is **ours** -- the client's terrain water values say what lava takes off you and
   * how often, and nothing whatever about standing in it, because in that game you could not.
   *
   * `sink({ on: false })` is the switch that makes the game exactly what it was: the figure and the
   * view go back there and then rather than at the next step, because the step is in `update`, which
   * does not run while a panel is open.
   */
  setLavaSink(tune?: LavaSinkTune): ReturnType<typeof lavaSinkReport> {
    if (tune) {
      tuneLavaSink(tune);
      if (tune.on === false) this.dropLavaSink();
    }
    // The harm's own margin and the game's own run go in rather than being written down a second time
    // in the report: `secondsToWaist` is measured from the **lip** of a flow (the line the sink and
    // the burn both start on) and not from the surface, which is the difference between the 2.53 s
    // the whole choice of rate rests on and 3.03 s for a descent nobody ever makes.
    return lavaSinkReport(this.lava, LAVA_HARM.margin, RUN_SPEED);
  }

  /**
   * Up out of the flow and the hold forgotten, at once, because this is no longer the body it had:
   * it has died, or it has been stood up whole somewhere (a respawn, an arrival on another world, the
   * console's own teleport). At a death it matters for more than tidiness -- the ragdoll is built
   * from where the bones are **drawn**, so a body left sunk would have its pieces made a waist deep
   * inside the bed and thrown apart by the first step that resolved them.
   */
  private dropLavaSink(): void {
    const was = this.lava.sink;
    resetLavaSink(this.lava);
    // And the verdict's own memory with it, or a body stood up somewhere fresh would carry the last
    // one's hysteresis band and its bridge into the first step of the new place.
    resetLavaHold(this.lavaHold);
    this.lavaPaceNow = 1;
    // And the figure with it, so the drop is gone from the picture on this very frame rather than on
    // the next one `update` happens to reach -- which at a death is never, since `update` returns at
    // its first line for as long as the ragdoll is up, and the ragdoll is built from where the bones
    // are drawn.
    //
    // Guarded twice, and both guards earn themselves. `was > 0` keeps every other caller (a respawn,
    // an arrival, the switch) from paying for a place it did not need. `!this.mounted` is the one
    // that matters: `placeVisual` writes the group's **turn** as well as its place, from `heading`
    // about the upright, and a body seated in a ride is placed by `syncMount` from the hull's own
    // attitude -- so calling it on a rider would flatten a banked pilot's pitch and roll. A rider is
    // never sunk in any case, which is what makes the guard free.
    if (was > 0 && !this.mounted) this.placeVisual();
  }

  bladeSegment(a: THREE.Vector3, b: THREE.Vector3): void {
    this.parts.saber.getWorldPosition(a);
    this.parts.bladeTip.getWorldPosition(b);
  }

  /** Where a bolt leaves: the held gun's muzzle (the far end of its barrel), or the placeholder rifle's. */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    const right = this.reach.right;
    if (right && this.held.right && this.equipped.right && FIGHTS[this.equipped.right.class] === 'gun') {
      right.far.updateWorldMatrix(true, false);
      return right.far.getWorldPosition(out);
    }
    return this.parts.muzzle.getWorldPosition(out);
  }

  mount(speeder: Vehicle): void {
    // A rider has no rope.
    this.grapple.letGo('mount');
    this.mounted = speeder;
    this.body.setEnabled(false);
    this.vel.set(0, 0, 0);
    this.swing = -1;
    this.eva = false;
    // Out of the water by the act of getting on, as `board` already does for a ship's rooms. A rider
    // returns from `update` before the swim block, so anything left standing here is last frame's
    // for as long as the ride lasts -- and rides end in other worlds. `submerged` is only ever
    // meaningful while `swimming` is, so the two go together wherever either is put down.
    this.swimming = false;
    this.submerged = false;
    // And off whatever the imported clips were holding, a thrown fall with them.
    this.anim.drop();
    // The rider starts straight: no twist toward the view or aim carried over from on foot (nor back onto the ground after).
    this.torsoTwist = 0;
    this.aimTwist = 0;
    // The saber goes away for the ride: lit, it is in the way of everything.
    if (this.saberOn) this.toggleSaber();
  }

  /**
   * Thrown from a vehicle that has just blown up under the rider: off it with its speed and a
   * kick upward, flailing through the air, and down on the ground prone. (`flung` says so until then.)
   */
  fling(from: THREE.Vector3, velocity: THREE.Vector3): void {
    this.dismount(from);
    this.vel.copy(velocity);
    this.vel.y += FLING_UP;
    this.grounded = false;
    this.anim.fling();
    this.prone = false;
    this.kneeling = false;
  }

  /**
   * Adrift in space on foot: no down, no ground. The body turns freely, the mouse yawing and
   * pitching it in its own frame and the roll keys rolling it, and the view rides behind it
   * however it is turned. The keys are thrusters: forward and back, sideways, up and down, each
   * adding to a momentum that is kept until the brake takes it off, and a hull met on the way
   * takes the speed into it. (Later this wants a jetpack to move and a helmet to live.)
   */
  eva = false;
  /** The body's frame adrift: forward down its +Z, up its +Y. */
  readonly evaFrame = new THREE.Quaternion();

  private evaUpdate(dt: number, input: Input, cam: ThirdPersonCamera): void {
    if (!this.eva) {
      this.eva = true;
      this.evaFrame.setFromAxisAngle(UP_AXIS, this.heading);
      this.prone = false;
      this.kneeling = false;
      this.crouching = false;
    }
    this.rig?.stopOverride();
    this.saber.holster();
    this.thrown.cancel();
    this.updateBlades();
    const q = this.evaFrame;
    // The mouse turns the body, unless Alt holds it for the view to look round.
    if (input.locked && !input.held('freeLook')) {
      const k = 0.0025 * cam.sensitivity;
      if (input.mouseDX) q.multiply(tmpQ.setFromAxisAngle(AXIS_Y, -input.mouseDX * k));
      if (input.mouseDY) q.multiply(tmpQ.setFromAxisAngle(AXIS_X, input.mouseDY * k * (cam.invertY ? -1 : 1)));
      input.mouseDX = 0;
      input.mouseDY = 0;
    }
    // The body's frame is the converted models' (X mirrored): its right is down -X, and a roll to the left is a turn the other way about Z.
    const roll = (input.held('rollRight') ? 1 : 0) - (input.held('rollLeft') ? 1 : 0);
    if (roll) q.multiply(tmpQ.setFromAxisAngle(AXIS_Z, roll * EVA_ROLL_RATE * dt));
    q.normalize();
    evaFwd.set(0, 0, 1).applyQuaternion(q);
    evaRight.set(-1, 0, 0).applyQuaternion(q);
    evaUp.set(0, 1, 0).applyQuaternion(q);
    // Thrust along the body's axes; the brake takes speed off whichever way it points.
    const ahead = (input.held('forward') ? 1 : 0) - (input.held('back') ? 1 : 0);
    const side = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    const rise = (input.held('jump') ? 1 : 0) - (input.held('crouch') ? 1 : 0);
    if (ahead || side || rise) {
      move.set(0, 0, 0).addScaledVector(evaFwd, ahead).addScaledVector(evaRight, side).addScaledVector(evaUp, rise).normalize();
      this.vel.addScaledVector(move, EVA_ACCEL * dt);
    }
    if (input.held('brake')) {
      const speed = this.vel.length();
      if (speed > 0) this.vel.multiplyScalar(Math.max(0, speed - EVA_BRAKE * dt) / speed);
    }
    if (this.vel.length() > EVA_MAX_SPEED) this.vel.setLength(EVA_MAX_SPEED);
    // Move with the collider: a hull or a rock in the way stops the drift into it. A corpse and
    // another player are not in the way of it, as on foot.
    this.controller.disableSnapToGround();
    this.controller.computeColliderMovement(this.collider, { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt }, undefined, groups(Group.all, Group.all), this.walkPast);
    const mv = this.controller.computedMovement();
    const wanted = this.vel.lengthSq() * dt * dt;
    const got = mv.x * mv.x + mv.y * mv.y + mv.z * mv.z;
    if (wanted > 1e-8 && got < wanted * 0.9) this.vel.set(mv.x, mv.y, mv.z).divideScalar(dt).multiplyScalar(0.5);
    this.pos.x += mv.x;
    this.pos.y += mv.y;
    this.pos.z += mv.z;
    this.grounded = false;
    // There is no water out here and no swim block on this path to say so: this branch returns from
    // `update` before it. `submerged` goes down with `swimming` because a verdict left standing here
    // is left standing for the whole spacewalk.
    this.swimming = false;
    this.submerged = false;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.heading = Math.atan2(evaFwd.x, evaFwd.z);
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(q);
    // Weightless: the imported adrift loop when the rig has it (a preference the rig steps over without it), else the
    // still-water pose the state's own list gives.
    this.rig?.prefer('float', MX.adrift);
    this.rig?.setState('float');
    this.rig?.update(dt);
    this.group.updateMatrixWorld(true);
    // Wave 4, item B: drifting near a surface, the hands reach to it and step along it (visual only: the drift is the drift).
    this.placeBrace(dt, null, true);
  }

  dismount(to: THREE.Vector3): void {
    this.mounted = null;
    this.pos.copy(to);
    this.vel.set(0, 0, 0);
    this.body.setEnabled(true);
    this.body.setTranslation({ x: to.x, y: to.y, z: to.z }, true);
    this.grounded = true;
  }

  /** The riding loop's branch for the vehicle ridden (its rider pose's), or null for the plain default. Resolved once per vehicle and rig. */
  private seatedClip(): string | null {
    const v = this.mounted, rig = this.rig;
    if (!v || !rig) return null;
    if (v !== this.seatedClipOf || rig !== this.seatedClipRig) {
      const clip = rig.variant('loop_riding', v.riderPose ?? `vehicle_${v.spec.id.replace(/^pv_/, '')}`);
      this.seatedClipName = clip && clip !== 'loop_riding' ? clip : null;
      this.seatedClipOf = v;
      this.seatedClipRig = rig;
    }
    return this.seatedClipName;
  }

  /** Pin the model to the speeder seat. Call after the speeder has updated. */
  syncMount(): void {
    if (!this.mounted) return;
    this.mounted.group.updateMatrixWorld(true);
    const v = this.mounted;
    // A ship's pilot sits by the eye: the cockpit's own camera point is where the eyes go, the body hangs under it as the
    // seated pose has it, then moves up or down onto the seat found under it (less far up in first person), so the view is
    // the same point hovering and flying and the figure sits on the cushion.
    if (v.eyeSeat && v.cockpitEye(eyeLocal)) {
      // The body hangs from the eye the seat was measured from: the camera point with the cockpit file's 1OFF, whatever
      // the view's own offset is now (__debug.cockpit({ offset: false }) moves the view alone).
      const f = v.cockpitFrame ? v.def?.cockpit?.firstOffset : null;
      if (f && f.length >= 3) eyeLocal.set(eyeLocal.x - v.cockpitOffset[0] - f[0], eyeLocal.y - v.cockpitOffset[1] + f[1], eyeLocal.z - v.cockpitOffset[2] + f[2]);
      v.quaternion(tmpQ);
      const rig = this.rig;
      const scale = rig ? rig.root.scale.y : 1;
      const clip = this.seatedClip();
      if (!(clip && rig?.seatedPoints(clip, seatedEye, seatedPelvis))) {
        seatedEye.fromArray(SEATED_EYE_FALLBACK).multiplyScalar(scale);
        seatedPelvis.fromArray(SEATED_PELVIS_FALLBACK).multiplyScalar(scale);
      }
      const eyeOverPelvis = seatedEye.y - seatedPelvis.y;
      const lift = bodyLift(v.seatDrop, eyeOverPelvis, scale, this.firstPersonSeat);
      const r = this.seatReport;
      r.eyeOverPelvis = eyeOverPelvis;
      r.lift = lift;
      r.scale = scale;
      r.clip = clip;
      bodyOffset.set(v.bodyNudge[0], v.bodyNudge[1] + lift, v.bodyNudge[2]);
      seatedEye.sub(bodyOffset).applyQuaternion(tmpQ);
      this.pos.copy(eyeLocal).applyMatrix4(v.group.matrixWorld).sub(seatedEye);
      this.group.position.copy(this.pos);
      this.group.quaternion.copy(tmpQ);
      this.heading = 2 * Math.atan2(tmpQ.y, tmpQ.w);
      this.group.updateMatrixWorld(true);
      return;
    }
    this.mounted.seat.getWorldPosition(this.pos);
    // A seat riding an animal's back turns with it: the rider sways with the gait.
    if (this.mounted.seatFollows) this.mounted.seat.getWorldQuaternion(tmpQ);
    else this.mounted.quaternion(tmpQ);
    // A seat that names where the pelvis goes: the riding clip's own root offset comes off, in
    // the vehicle's frame, so the pelvis lands on the seat whatever pose is playing.
    const clip = this.rig?.currentClip;
    const root = clip ? this.rig?.rootOffset(clip, seatOffset) : null;
    // A pod's seat is one of these (the garage hangs it under the cockpit's joint, src/vehicles/podSeat.ts), so its
    // pilot rides the cockpit through the pod's own clips and a nudge from the console moves them on every pod.
    if (this.mounted.seatPelvis && root) this.pos.sub(seatOffset.applyQuaternion(tmpQ));
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(tmpQ);
    this.heading = 2 * Math.atan2(tmpQ.y, tmpQ.w);
    this.group.updateMatrixWorld(true);
  }

  update(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {
    this.world = world;
    // Smoothness II, item 7: the frame the camera's follow is stepped against (`stepClimbCam`, `followAt`).
    this.frameNo++;
    // What the grapple's rope may meet that moves: the vehicles this browser simulates.
    this.grappleVehicles = world.vehicles;
    // Climbing II, phase 4: the ropes nobody holds swung by themselves (and their columns switched) once a frame, here ahead of
    // every way out of the update, so a rope swings on whatever has the body: its own flight off it and landing, a bar, a ledge.
    this.rope.tickRopes(dt);
    // Dead: the body is the physics' now, and nothing else moves.
    if (this.ragdoll) {
      // (The speed classes are put down, as on every branch below that returns before they are planned: a sprint
      // must not outlive the feet it was run on. The pool waits for the respawn, which fills it.)
      this.loco.idle(0, this.staminaPool);
      this.slope.reset();
      this.feetOff();
      this.ragdollStep();
      return;
    }
    // The world editor's free camera: the body is its eye, flown and hidden, and nothing else of the body runs -- no
    // animation, no swim, no fire, no breath, no flow, no hazard -- so a camera flown under a lake drowns nobody. Ahead
    // of everything, noclip's branch included, which never reaches it.
    if (this.editorFlight) {
      if (this.grapple.out) this.grapple.letGo('editor');
      this.loco.idle(dt, this.staminaPool);
      // And the slope's slide with them: what the feet were sliding on is not under them when they come back.
      this.slope.reset();
      this.feetOff();
      this.editorFlight.step(dt, input, this.pos);
      this.vel.set(0, 0, 0);
      this.grounded = false;
      this.swimming = false;
      this.submerged = false;
      this.group.position.copy(this.pos);
      return;
    }
    this.regenDelay = Math.max(0, this.regenDelay - dt);
    if (this.regenDelay <= 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.stats.healthRegen * dt);
    // And the fire, on that same clock and in that same place: a panel pauses both alike, both step
    // under `__debug.advance`, and a burn keeps the regeneration locked out for as long as it lasts
    // because every blow it lands sets the delay above afresh. Before the mounted branch below, so a
    // rider goes on burning; the blow itself is refused for them by the record's own callback.
    this.stepBurn(dt, world);
    // And the air, on the same clock and in the same place. It reads `submerged` as the last swim
    // block left it, which is one frame old on the frame the head goes under and one frame old on
    // the frame it comes up: a sixtieth of a second either way on a thirty-second lungful, and the
    // price of it being here, where a panel pauses it exactly as it pauses the regeneration.
    this.stepBreath(dt, world);
    // And the flow's hold on the body, on that same clock and in that same place, and before the four
    // branches that return early, so a sink already in the body comes back out wherever it has gone.
    this.stepLavaSink(dt, world);

    if (this.swing >= 0) {
      this.swing += dt / SWING_TIME;
      if (this.swing >= 1) this.swing = -1;
    }
    // The thrown fall's impact holds the keys until it has played out (the game mutes them from `impactLocked`).
    this.anim.tick(dt);
    this.blocking = this.classId === 'jedi' && this.saberOn && input.held('block') && !this.mounted && !this.noclip && !this.fists;
    this.aiming = this.classId === 'bounty_hunter' && input.held('altAttack') && !this.mounted && !this.noclip && !this.swimming && !this.fists;
    this.sinceShot += dt;
    cam.aim = this.aiming;
    const fighting = this.swing >= 0 || this.saber.busy || this.thrown.inFlight || this.jka.inSpecialJump || this.jka.rolling || this.fistsBusy;
    this.jkaMode = this.hasJkaClips && (this.blocking || fighting || !!this.rig?.overridingJka);
    // Blocking or fighting, and not merely one of that game's one-offs still playing out: what keeps its jump, its
    // in-air pose and its landing over the imported ones (the owner's rule: its legs stay only while blocking or attacking).
    this.jkaActing = this.hasJkaClips && (this.blocking || fighting);

    if (this.mounted) {
      if (this.grapple.out) this.grapple.letGo('mount');
      // Seated, the speed classes are put down (`BodyLoco.idle`): nothing sprints, so the fight's keys are not left
      // muted for the ride by a sprint the body sat down out of, and the stamina regains as it does standing.
      this.loco.idle(dt, this.staminaPool);
      // And the slope's slide with them: what the feet were sliding on is not under them when they come back.
      this.slope.reset();
      this.feetOff();
      this.rig?.stopOverride();
      this.thrown.cancel();
      this.updateBlades();
      this.animateSeated();
      this.animateRig(dt, 0, false);
      return;
    }

    if (this.noclip) {
      if (this.grapple.out) this.grapple.letGo('noclip');
      this.loco.idle(dt, this.staminaPool);
      // And the slope's slide with them: what the feet were sliding on is not under them when they come back.
      this.slope.reset();
      this.feetOff();
      this.rig?.stopOverride();
      this.saber.holster();
      this.thrown.cancel();
      this.updateBlades();
      this.flyUpdate(dt, input, cam);
      return;
    }

    // On foot in space, outside any ship's rooms: adrift. The zero-g tether waits, so the rope lets go.
    if (world.planet.space && !this.aboard) {
      if (this.grapple.out) this.grapple.letGo('eva');
      this.loco.idle(dt, this.staminaPool);
      // And the slope's slide with them: what the feet were sliding on is not under them when they come back.
      this.slope.reset();
      this.feetOff();
      this.evaUpdate(dt, input, cam);
      return;
    }
    this.eva = false;

    // Climbing II, phase 3: on a bar (`BarSwing`), the swing has the body in place of the movement. Never under `climb.bars`
    // 'off', where nothing ever holds.
    if (this.bar.holding) {
      this.barFrame(dt, input, cam, world);
      return;
    }
    // Climbing II, phase 4: on a rope (`RopeSwing`), the swing has the body in place of the movement. Never under `climb.ropes`
    // 'off', where nothing ever holds.
    if (this.rope.holding) {
      this.ropeFrame(dt, input, cam, world);
      return;
    }
    // Wave 4: hanging from a ledge, or carried through one of its one-offs (`LedgeHang`): the ledge has the body in place
    // of the movement. Never under `climb.ledges` 'before', where nothing ever holds.
    if (this.ledge.holding) {
      this.hangFrame(dt, input, cam, world);
      return;
    }
    // Wave 4, item B: on a wall (`WallClimb`), the climb has the body in place of the movement. Never under `climb.wall`
    // 'before', where nothing ever climbs.
    if (this.wall.holding) {
      this.wallFrame(dt, input, cam, world);
      return;
    }

    const g = world.planet.gravity;
    const terrain = world.terrain;

    let mx = 0;
    let mz = 0;
    // At a ship's controls the keys fly the ship; the figure stands where it is.
    const atControls = !!this.piloting;
    if (!atControls) {
      if (input.held('forward')) mz += 1;
      if (input.held('back')) mz -= 1;
      if (input.held('left')) mx -= 1;
      if (input.held('right')) mx += 1;
    }

    // Aboard a ship the camera's frame is the hull's, so its directions are already the room's:
    // forward on the screen is forward in the room, whatever the hull is doing.
    cam.forward(fwd);
    cam.right(rgt);
    move.set(0, 0, 0).addScaledVector(fwd, mz).addScaledVector(rgt, mx);
    const moving = move.lengthSq() > 0;
    if (moving) move.normalize();

    // The speed keys (src/anim/bodyLoco.ts): Shift raises the class and the walk key, held, is the slowest. What comes
    // back is the walk by the rules the body always had: with the classes off either key held, as Shift walked. At a
    // ship's controls neither is the body's: Shift is the ship's boost there and Alt its free look.
    const walking = this.loco.keys(dt, !atControls && input.held('speedUp'), !atControls && input.pressedAction('speedUp'), !atControls && input.held('walk'), this.rig);
    this.walkKey = walking;
    // Postures: Z toggles prone and V kneeling, on the ground; jumping, swimming or a saber swing brings the
    // body up, and a kneel also ends when you move or crouch. The game's own transitions play between them.
    const was = { prone: this.prone, kneel: this.kneeling, crouch: this.crouching || this.duck.crouch };
    const onGround = !this.mounted && !this.noclip && !this.swimming;
    // The feedback round, item 3 (`proneShape` 'lying'): going prone asks for room for the lying capsule and getting up for
    // room to stand (`proneAsk`); with the switch at 'crouch' both are today's toggles.
    const lyingRule = MOVE_TUNE.proneShape === 'lying';
    if (input.pressedAction('prone') && onGround) this.prone = lyingRule ? this.proneAsk(!this.prone, input) : !this.prone;
    if (input.pressedAction('kneel') && onGround) {
      this.kneeling = !this.kneeling;
      if (this.kneeling) this.prone = lyingRule ? this.proneAsk(false, input) : false;
    }
    if (this.prone) this.kneeling = false;
    // Getting up on the jump key is only that: the jump itself waits for the key to be let go and pressed again.
    if ((this.prone || this.kneeling) && input.pressedAction('jump')) this.jumpLatched = true;
    if (!input.held('jump')) this.jumpLatched = false;
    const wasProne = this.jumpLatched;
    const getsUp = this.swimming || input.pressedAction('jump') || (this.classId === 'jedi' && (input.pressedAction('attack') || input.pressedAction('block')));
    // Lying, the water over the feet deeper than the body lies is water to stand up in, as the swim already stands it.
    const lyingDrowns = lyingRule && this.prone && this.waterDepth > 2 * MOVE_TUNE.lyingRadius;
    if (this.prone && (getsUp || lyingDrowns)) this.prone = lyingRule && !this.swimming ? this.proneAsk(false, input) : false;
    // Climbing II's smoothness round, item 4: a body the duck laid down for a low roof gets up again into a crouch on its own
    // where the room over its feet comes back and no roof ahead along its way would lay it down again; a prone the key asked
    // for never does (`duck.lying` is only ever the duck's).
    if (!this.prone) this.duck.lying = false;
    else if (this.duck.lying && this.grounded && lieOn()) this.riseFromDuck(moving, move);
    if (this.kneeling && (getsUp || moving || input.held('crouch'))) this.kneeling = false;
    this.crouching = !this.swimming && !this.prone && !this.kneeling && (input.held('crouch') || (this.ledge.keepCrouched && !this.ledge.standRoom(this.physics.world as unknown as LedgeWorld, this, this.moveFilter())));
    // The feedback round, items 3 and 4: either switch on, the body's shape decides the capsule (`stepShape`); both off,
    // today's crouch rule, to the line.
    if (shapeRulesOn()) this.stepShape(dt, moving, move);
    else this.setCrouchCollider((this.crouching || this.prone || this.kneeling) && this.grounded);
    // Item 4: what the height the shape wrote means for the pace and the clips (a body it laid down crouches no more).
    if (paceOn()) this.stepDuckPace();
    else if (this.duck.active) this.duck.step(STAND_TALL, false, false);
    if (this.grounded && !this.swimming) this.postureTransition(was, moving);
    // `lavaPaceNow` is what a flow has left of the walk: 1 everywhere else, and it is a factor of its
    // own rather than a write to `speedMultiplier`, which Force Speed rewrites from scratch each
    // frame. It goes on both profiles' speeds (here for the game's own, and on `speedScale` below for
    // Jedi Academy's), so the body really moves slower and the clips, which are scaled to how fast it
    // moves, slow with it.
    let speed = (walking ? WALK_SPEED : RUN_SPEED) * this.speedMultiplier * this.lavaPaceNow * (this.crouching && this.grounded ? 0.5 : 1);
    // Item 4, without the speed classes: the duck's pace as a share of the body's own (the classes take it in their plan).
    if (this.duck.active) speed *= (this.duck.crouch && !this.crouching && this.grounded ? 0.5 : 1) * this.duck.share;

    // Water: the surface here, and how deep the body sits in it. Swimming starts when the
    // chest is under; the head stays above the surface unless the player dives.
    //
    // The height asked for is the **lava-filtered column** (`World.waterColumnAt`) and not
    // `terrain.waterHeightAt`: a flow is water to the terrain and is water to nothing else, so
    // reading the terrain's own height had the player wade into a flow and then swim strokes in it.
    // With the flow filtered out there is no surface over the point at all, so the body walks the
    // bed of the flow under its own gravity and burns where it stands, which is the harm's business
    // and not this file's.
    //
    // It is deliberately **not** `footSurfaces.waterTop`, which the feet, the blade and the bolts
    // read: that one also answers -Infinity for a point standing in a room's box, and a swimmer who
    // consumed that would read a depth of -Infinity and lose the water from under them -- gravity
    // back, buoyancy gone, the saber out again -- while the screen, which reads the tracked cell
    // instead, stayed tinted blue. Room boxes are padded and overhang their hulls, and swimming down
    // to an entrance that sits under a lake puts the point inside one before the doorway is crossed.
    // This body has the better room rule and uses it on the next line.
    //
    // And the surface is the **drawn** one, not the flat table: the open sea swells, and a swimmer
    // measured against the plane through the middle of those waves has a crest rise over its head
    // and a trough drop out from under its feet while the body itself never moves. `swellOverFlat`
    // is 0 on a lake, in the shallows, on a planet with no sea and wherever the sea is switched
    // off, so everywhere but the open sea this is the line it always was.
    const flat = this.aboard ? -1e9 : world.waterColumnAt(this.pos.x, this.pos.z);
    const surface = flat + world.seaSwellOverFlat(this.pos.x, this.pos.z, flat);
    const depth = surface - this.pos.y;
    // Interiors can sit below a lake (the Gungan cities do) and are never water. `inside` is the
    // cell the frame tracks through doorways -- walked into rather than read off a box -- which is
    // the answer only the player has and is why the swim needs no box test. Once swimming, a little
    // slack keeps the float line from flickering between states.
    this.swimming = !this.inside && depth > (this.swimming ? SWIM_DEPTH - 0.3 : SWIM_DEPTH);
    this.submerged = this.swimming && depth > DIVE_DEPTH;
    this.waterDepth = depth;
    // The speed classes: the frame's class, its clip and its speed, and the stamina's step (`BodyLoco.plan`). Where
    // the class rules the body (on its feet, out of the water) its speed is the body's, under whatever multiplies it;
    // crouched, prone, kneeling and swimming keep the speeds they always had, and so does everything with the classes off.
    // Wave 3: the stairs the rule held under the body last frame (read after the move, `stairSense`).
    this.locoIn.stairs = this.stairSense.way;
    // The stairs wave: and their measure (the tread and riser one step a stair is planned by).
    this.stairLoco();
    const lo = this.locoIn;
    lo.dt = dt;
    lo.mz = mz;
    lo.mx = mx;
    lo.standing = !this.crouching && !this.duck.crouch && !this.prone && !this.kneeling;
    lo.grounded = this.grounded;
    lo.swimming = this.swimming;
    // Blocking or fighting, and not merely one of Jedi Academy's one-offs playing out (a Force jump's flip): a jump
    // out of a sprint is still the sprint.
    lo.fighting = this.blocking || fighting;
    lo.aiming = this.aiming;
    // One of the fight's keys pressed or held (the attack, the other attack, a gun's other trigger, the throw, the
    // block): under the tune's 'ends' it ends a sprint this frame, before the kit reads the press.
    lo.fightKeys = !atControls && fightKeysDown(input);
    lo.gunUp = this.classId === 'bounty_hunter' && !this.fists && (this.aiming || this.gunReady);
    // The kind of gun in hand, where the body carries one it has the game's clips for: what a pace plays with none up.
    lo.gunClass = this.classId === 'bounty_hunter' && this.hasGunClips && !this.fists ? gunClassIndex(this.gunClass) : -1;
    lo.sprint = this.stats.apply('move.sprint', LOCO_TUNE.speed.forward.sprint);
    lo.pool = this.staminaPool;
    lo.boost = this.speedMultiplier;
    // Climbing II's smoothness round, item 4: the duck's pace (nought under 'before': every speed as it was).
    lo.duckToCrouch = this.duck.toCrouch;
    lo.duckToCrawl = this.duck.toCrawl;
    // Wave 2b: crouched and prone under the classes, the injured walk by the health's share, and the figure's scale a
    // game clip's measured stride is scaled by. Item 4: ducked to `crouchAt`, the crouch's.
    lo.crouched = this.crouching || this.duck.crouch;
    // Smoothness III, item 3b (`move.duckClip` 'clearance'): ducked under something, the crouch whose head clears it.
    lo.crouchCls = this.duck.crouch && !this.crouching ? this.shape.duckCls : 0;
    lo.prone = this.prone;
    lo.hpShare = this.hp / this.maxHp;
    lo.scale = this.rig ? this.rig.root.scale.y : 1;
    const classes = this.loco.plan(lo);
    if (classes) {
      speed = this.loco.speed * this.speedMultiplier * this.lavaPaceNow;
      // The walk clips are the walk class's (Jedi Academy's saber walk too), whatever key gave it.
      this.walkKey = this.loco.cls <= 1;
    }
    // The rope's words for this frame, from the body as the swim has just left it (`ropeModes`, the one place
    // they are decided), and the move keys' direction as the sway: read below and by the grapple's steps.
    if (this.grapple.out) {
      this.grapple.refreshModes(this.gview);
      this.grapple.keys.swayX = moving ? move.x : 0;
      this.grapple.keys.swayZ = moving ? move.z : 0;
    }

    if (this.swimming) {
      // Swimming: slow, no gravity, free up and down; looking down while submerged dives. (Untouched by the
      // movement profile: the water keeps its own rules.) The arithmetic is `swimStep`'s, the block moved out
      // unchanged so the grapple's tests run the game's own swim; what is not arithmetic stays here.
      this.rig?.stopOverride();
      // Water ends a thrown fall and a Force user's air, and what the movement reports on the first step out is the
      // plunge's and no landing (`BodyAnim.swim`).
      this.anim.swim();
      this.saber.holster();
      const sw = this.swimIn;
      sw.vel = this.vel;
      sw.posY = this.pos.y;
      sw.surface = surface;
      sw.depth = depth;
      sw.submerged = this.submerged;
      sw.jump = input.held('jump');
      sw.crouch = input.held('crouch');
      sw.moving = moving;
      sw.moveX = move.x;
      sw.moveZ = move.z;
      // Under water the camera steers: swim where you look.
      if (moving) {
        cam.camera.getWorldDirection(dive);
        sw.diveY = dive.y;
      }
      sw.forward = mz >= 0;
      sw.speed = speed;
      sw.dt = dt;
      // Reeling in toward a pivot rising past `swimLift`, the rope has the vertical (only while attached).
      sw.ropeLift = this.grapple.out && this.grapple.liftsSwimmer(this.gview);
      // Towed by a rope on a hull, the swimmer skims: the tow's friction in place of the swim's level ease.
      sw.towed = this.grapple.out && this.grapple.towsSwimmer(this.gview, sw);
      const swum = swimStep(sw, this.swimProbe, this.swimOut);
      speed = swum.speed;
      this.grounded = swum.grounded;
      // Water breaks a fall. The swim never told the movement so, and a fall into deep water was paid on the
      // shore as the first step out landed, measured from the top of the fall (and on Progression I, a crouched
      // step out was paid as a landing roll too). The fall's memory is held here on every swimming frame, for
      // everyone: the owner's call, and the one change to what a player who never fires meets in play.
      this.jka.holdApex(this.pos.y);
    } else if (this.moveProfile === 'jka') {
      // Jedi Academy's ground and air rules: friction, acceleration, air control, and jumps
      // that keep lifting while the key is held, as far as the Force Jump level allows.
      const c = this.cmd;
      // A leaping saber move drives the body itself while it lasts (the keys are ignored).
      const script = this.saber.scriptNow();
      let jump = input.held('jump') && !this.prone && !wasProne;
      let jumpPressed = input.pressedAction('jump') && !wasProne;
      if (script) {
        mz = script.fmove;
        mx = script.smove;
        jump = false;
        jumpPressed = false;
        if (script.hop !== null && this.grounded) {
          this.vel.y = script.hop;
          this.grounded = false;
          this.pos.y += 0.02;
          this.jka.markJumpStart(this.pos.y);
        }
      }
      c.forward.copy(fwd);
      c.right.copy(rgt);
      c.fmove = mz;
      c.smove = mx;
      // With a speed class ruling the body the class's speed is the whole of it (on `speedScale`, below): no halving.
      // (A leaping saber move keeps the walk key's halving with the pace it is paired with there, as it always had.)
      c.walk = classes && !script ? false : walking;
      // Item 4: ducked to `crouchAt` the body moves crouched (Jedi Academy's duck halves its own speed; the classes' share takes it back).
      c.crouch = this.crouching || this.duck.crouch;
      // A crouch tap on the move rolls, as the game's does, unless a swing is in its cutting part (its wind-up and return may be rolled out of).
      c.roll = input.pressedAction('crouch') && moving && !this.saber.attacking;
      c.jump = jump;
      c.jumpPressed = jumpPressed && !this.saber.busy;
      c.attack = input.held('attack');
      // The class's speed as a share of Jedi Academy's own run, so its acceleration, friction and air are unchanged; a
      // leaping saber move, and everything without a class, keeps the pace it always had, and so does a body with no
      // way asked (`loco.moves`: the scale also sets how hard the friction stops it, which is as it always was).
      // Crouched under the classes the movement halves the speed on the ground (Jedi Academy's duck), which the share
      // takes back, so the class's speed is the body's.
      c.speedScale = this.speedMultiplier * this.lavaPaceNow * (classes && this.loco.moves && !script ? this.loco.speed / (this.loco.posture === CROUCH && this.grounded ? JKA.speed * UNIT * JKA.duckScale : JKA.speed * UNIT) : this.paceScale(walking, mz, mx));
      // Item 4 without the speed classes: the duck's pace as a share of the posture's own (the classes' plan took it above).
      if (!(classes && this.loco.moves && !script) && this.duck.active) c.speedScale *= this.duck.share;
      // What progress makes of a fall and the air, each today's number until something is earned.
      const st = this.stats;
      c.fallSafeExtra = st.fallSafeExtra / UNIT;
      c.rollDivisor = st.rollDivisor;
      c.rollFree = st.rollFree;
      c.airAccel = st.airAccel;
      // On the rope and swinging, the move keys sway and Space boosts (the grapple's own), so the movement is
      // handed neither; sliding on the ground with the rope taut, it is handed no ground (no friction). Both
      // are the rope's words, rewritten in the hook's own `command`, which the node harness calls too; while the
      // hook is not attached nothing here changes.
      const stepGrounded = this.grapple.command(c, this.grounded);
      // A jump off a face too steep to stand on (wave 2b's slope limit): under `LOCO_TUNE.slopeJump` 'allowed' the plain
      // jump, as from the ground; refused by default, when the movement (which jumps only off the ground) never sees one.
      const slopeJumped = this.slope.jumpOff(this.vel, c.jumpPressed);
      if (slopeJumped) this.jka.markJumpStart(this.pos.y);
      const force = this.force;
      const ev = this.jka.step(dt, this.vel, this.pos, stepGrounded, c, { value: force?.value ?? 100, spend: (n) => { if (force) force.value = Math.max(0, force.value - n); } });
      if (slopeJumped) ev.jumped = true;
      const rig = this.rig;
      // The imported clips' memory of the air (src/anim/bodyAnim.ts): a step in the air is a fall begun here.
      this.anim.stepped(stepGrounded);
      if (ev.jumped) {
        this.grounded = false;
        // The jump for the direction pushed (PM_JumpForDir); with the body turned the way it runs, that is always forward.
        this.jumpDir = this.jkaMode ? (mz > 0 ? 'F' : mz < 0 ? 'B' : mx > 0 ? 'R' : mx < 0 ? 'L' : 'F') : 'F';
        // A plain jump is the imported one for every class; with Jedi Academy's animations in charge, or without the
        // imported clips, that game's own.
        if (!this.anim.jump(rig, this.jkaActing)) this.playOnce(this.jumpClip('JUMP', false), 0.05);
      }
      if (ev.special) {
        this.grounded = false;
        this.playOnce(ev.special, 0.05);
      }
      if (ev.flip) this.playOnce(`BOTH_FLIP_${ev.flip}`, 0.08);
      else if (ev.forceJumpStarted) this.playOnce(this.jumpClip('JUMP', true), 0.08);
      // A flip, a Force jump or a wall move: the air is a Force user's from here until the feet touch down.
      if (ev.special || ev.flip || ev.forceJumpStarted) this.anim.forceMove();
      this.lockedHeading = ev.heading;
      if (ev.rolled) this.playOnce(`BOTH_ROLL_${ev.rolled}`, 0.05);
      if (this.jka.rolling) this.crouching = false;
      if (ev.landed !== null) {
        // The landing: the imported one by how fast and how hard it was, none for a gentle one, and "before" for the
        // game's own by its own rule. A thrown fall's landing, reported here a frame after its impact began, is the impact's.
        const how = this.anim.land(rig, ev.landed, ev.damage, ev.forceLanded, ev.rolled !== null, this.saber.busy || this.jkaActing);
        if (how === 'before' && ev.landed >= 2 && !ev.rolled && !this.saber.busy) this.playOnce(this.jumpClip('LAND', ev.forceLanded), 0.06);
      }
      // An imported landing gives way to the keys once it has shown its start.
      this.anim.cut(rig, dt, moving);
      if (ev.damage > 0) this.takeDamage(ev.damage, false, 'fall');
      // A landing roll that kept some of a fall's harm off: what Acrobatics is paid for, outside a fight as well.
      if (ev.rollSaved > 0) this.onRolled?.(ev.fell, ev.rollSaved);
    } else if (this.grounded) {
      // This profile reports no landing: on the ground, the air's memory is simply put down.
      this.anim.onGround();
      this.vel.x = move.x * speed;
      this.vel.z = move.z * speed;
      if (input.held('jump') && !this.prone && !wasProne && !atControls) {
        this.vel.y = Math.sqrt(2 * g * JUMP_HEIGHT);
        this.grounded = false;
      }
    } else if (!this.flung) {
      // In the air the keys steer a little; thrown from a wreck, the momentum is the wreck's until the ground.
      const k = 1 - Math.exp(-dt * 2.5);
      this.vel.x += (move.x * speed - this.vel.x) * k;
      this.vel.z += (move.z * speed - this.vel.z) * k;
    }

    if (!this.swimming && this.moveProfile !== 'jka') this.vel.y -= g * dt;
    // Falling into deep water: the plunge slows quickly.
    if (depth > 0 && !this.swimming && this.vel.y < -4) this.vel.y += (-4 - this.vel.y) * (1 - Math.exp(-dt * 8));
    // Sliding down a face too steep to stand on (wave 2b's slope limit): gravity's share along it, before the move.
    if (this.slope.sliding) this.slope.share(this.vel, dt, this.moveProfile === 'jka' ? this.jka.gravity : g);
    // The grapple's step before the move: the dart's flight, and attached, the reel or the haul, the sway, the
    // drags, the constraint and its correction, and the fall's memory held while the rope is taut.
    if (this.grapple.out) this.grapple.beforeMove(this.gview, dt);

    // The snap to the ground is off while swinging on the rope as well as rising and swimming, and while the body slides
    // down a face too steep to stand on (wave 2b), whose controller is told so before the move (`SlopeRule.controllerFor`).
    if (this.vel.y > 0.5 || this.swimming || this.slope.sliding || (this.grapple.attached && this.grapple.modes.swinging)) this.controller.disableSnapToGround();
    else this.controller.enableSnapToGround(0.35);
    this.slope.controllerFor(this.controller);
    const filter = this.inside ? groups(Group.all, Group.all & ~(Group.terrain | Group.exterior)) : groups(Group.all, Group.all);
    let moveX = this.vel.x * dt;
    let moveY = this.vel.y * dt;
    let moveZ = this.vel.z * dt;
    // Stairs II (A): where the body stands before the move, for the collider's sync and the step (`StepUp`).
    const su = this.stepUp.at;
    su.x = this.pos.x;
    su.y = this.pos.y;
    su.z = this.pos.z;
    su.localY = this.colliderOffsetY;
    su.half = this.colliderOffsetY - CAPSULE_RADIUS;
    // On real ground only: the slope rule's last verdict found something under the body (a body pressed against a sheer wall
    // in the air is called grounded by the controller, and is no step's: its Jedi wall moves stay as they were).
    su.ruled = this.grounded && !this.swimming && !this.grapple.attached && !this.grapple.released && !this.slope.sliding;
    // The feedback round, item 3: a lying capsule is no upright one the step casts for (the controller's own autostep has it),
    // but where the step would reach the body its collider is still put where the body is before the move (`syncLying`).
    const lyingSync = this.shape.kind === LYING && su.ruled;
    if (this.shape.kind === LYING) su.ruled = false;
    // Where the slope rule found nothing under the body to stand on, the step is the body's only with a floor within the
    // step's height under it (`StepUp.reach`: a capsule wedged on a nosing over the tread below, yes; a body pressed against
    // a sheer wall in the air, no).
    su.supported = this.slope.supported;
    su.filter = filter;
    this.stepUp.reach(this.physics.world, this.body, this.collider, this.walkPast);
    if (this.grapple.attached || this.grapple.released) {
      // On the rope, or in the fast flight after letting go of it: the capsule's collider put where the body is (the
      // controller starts from the collider, which runs up to two frames behind at 144 fps), and the rope's correction
      // added to the move (nought once it has let go).
      this.grapple.syncCollider(this.gview);
      const gc = this.grapple.corr;
      moveX += gc.x;
      moveY += gc.y;
      moveZ += gc.z;
    } else if (this.slope.settling) this.syncCrease();
    // Stairs II (A): and on its feet on the ground, the collider put where the body is before every move (Rapier moves it only
    // at its own 60 Hz step, and the controller works the move out from it: at 144 frames a second two moves in three began a
    // frame or two back, and the body stalled at a riser), in the engine's own sums so a collider already there moves by no bit.
    else this.stepUp.sync(this.collider);
    if (lyingSync) this.shape.syncLying(this.collider, su);
    // Wave 3's crease: how fast a frame that began in the air falls into its move, and the frame's seconds.
    this.slope.at.fall = !this.grounded && this.vel.y < 0 ? -this.vel.y : 0;
    this.slope.at.dt = dt;
    // The dead are walked through: a corpse is no wall. So is another player: their body comes off
    // the wire and teleports between messages, and one walked into must never climb, shove or trap
    // you. Their collision groups already keep them out of a filtered query like this one; the
    // predicate is what keeps it true if that filter is ever widened.
    this.controller.computeColliderMovement(this.collider, { x: moveX, y: moveY, z: moveZ }, undefined, filter, this.walkPast);
    const mv = this.controller.computedMovement();
    // Stairs II (A): where the controller met a riser in the way and fell short, the step (up to the step-up's 0.5 m, at
    // every frame rate); a riser taller than that is a wall, its own lift onto one undone (`StepUp.after`).
    su.ax = moveX;
    su.ay = moveY;
    su.az = moveZ;
    su.filter = filter;
    su.climb = LOCO_TUNE.slope.climb;
    this.stepUp.after(this.physics.world, this.controller, mv, this.body, this.collider, this.walkPast);
    // On the rope and in the flight after it, what each surface refused is taken off the velocity, measured against
    // what was touched, and a wall struck hard enough is a slam (§3.11); a hull the rope rides and that moves is met in
    // its own frame there, its move written over the controller's (§3.18).
    if (this.grapple.attached || this.grapple.released) this.grapple.clip(this.gview, mv);
    // What the controller allowed of what the swim asked for. A body that asks to rise and is
    // handed back less -- or handed back a fall -- is being held by something it is touching, and
    // no spring above can argue with that.
    if (this.swimming) this.swimProbe.moved = mv.y;
    this.pos.x += mv.x;
    this.pos.y += mv.y;
    this.pos.z += mv.z;
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    if (this.stepUp.stands) this.grounded = true;
    // The slope limit (wave 2b): the controller calls any face whose normal points up at all ground; one too steep to
    // stand on is not, and the body slides down it (the velocity clipped onto it, gravity's share along it kept, the
    // fall's memory held at what the speed down into the ground is worth). Not on the rope, nor in the water.
    // (The place goes over in the rule's own record, never as numbers, which a call not built in would box every frame.)
    const slopeAt = this.slope.at;
    slopeAt.x = this.pos.x;
    slopeAt.y = this.pos.y;
    slopeAt.z = this.pos.z;
    slopeAt.offsetY = this.colliderOffsetY;
    // The feedback round, item 3: lying, the rule's sphere is the lying capsule's middle ball (its radius at its middle).
    slopeAt.r = CAPSULE_RADIUS;
    if (this.shape.kind === LYING) slopeAt.r = this.shape.radius;
    slopeAt.filter = filter;
    this.grounded = this.slope.judge(this.physics.world, this.grounded, !this.swimming && !this.grapple.attached && !this.grapple.released, this.body, this.walkPast);
    if (this.slope.sliding) this.jka.holdApex(this.slope.slide(this.vel, this.pos.y, this.moveProfile === 'jka' ? this.jka.gravity : g));
    // A slide is no step off a ledge (no hop) and its air is the falling loop (`BodyAnim.slide`).
    this.anim.slide = this.slope.sliding;
    if (this.grounded && this.vel.y < 0) this.vel.y = 0;
    if (!wasGrounded && this.grounded && Math.abs(mv.y) < 1e-4 && this.vel.y > 0) this.grounded = false;
    // Wave 4: a lip grabbed in the air, or lowered into off a lip crouched (`LedgeHang.sense`, after the move and the slope's
    // verdict); and the clocks of a let-go (a drop's clip cut, the jump off's turn). From a grab the frame is the hang's.
    this.ledgeClocks(dt);
    // Wave 4, item B: whether the move was cut short across the ground by what is in its way (only a body pressed into a
    // face feels for one to climb, so walking free casts nothing), worked out in place (no number crosses a call).
    const askH = moveX * moveX + moveZ * moveZ;
    this.wallBlocked = askH > 1e-8 && mv.x * mv.x + mv.z * mv.z < askH * 0.36;
    // Climbing II, phase 3: a bar grabbed with the use key (`BarSwing.sense`), before the ledges (a bar is never a lip).
    if (this.senseBar(dt, input, move, wasGrounded, atControls)) {
      this.barFrame(dt, input, cam, world);
      return;
    }
    // Climbing II, phase 4: a rope grabbed with the use key (`RopeSwing.sense`), after the bars (a rope is no collider: nothing
    // else could have taken it).
    if (this.senseRope(dt, input, move, wasGrounded, atControls, cam)) {
      this.ropeFrame(dt, input, cam, world);
      return;
    }
    if (this.senseLedge(dt, input, move, wasGrounded, atControls)) {
      this.hangFrame(dt, input, cam, world);
      return;
    }
    // Wave 4, item B: onto a wall after the move: W held into a climbable face it is pressed against (`WallClimb.sense`).
    if (this.senseWall(dt, input, move, wasGrounded, atControls)) {
      this.wallFrame(dt, input, cam, world);
      return;
    }
    // Climbing II, phase 3: the bar's refusal ("No room to hang from the bar here.") said only now, when neither a lip nor a
    // wall took the press in the same frame (`senseBar` drops one they took).
    if (this.bar.said) {
      this.onLedgeWords?.(this.bar.said);
      this.bar.said = '';
    }
    // (Phase 4: and the rope's, "No room to hang from the rope here.", the same way.)
    if (this.rope.said) {
      this.onLedgeWords?.(this.rope.said);
      this.rope.said = '';
    }
    // Wave 3: the drawn body's lag over a step (`DrawnHeight`): what the controller added to a move that began on the
    // ground beyond the plane under the body's own rise; and the stairs the ground along the travel makes, read here
    // after the move for the next frame's legs (`StairSense`). Neither touches the body.
    const rope = this.grapple.attached || this.grapple.released;
    const di = this.drawnIn;
    di.dt = dt;
    di.dx = mv.x;
    di.dy = mv.y;
    di.dz = mv.z;
    di.askedY = moveY;
    di.nx = this.slope.planeNx;
    di.ny = this.slope.planeNy;
    di.nz = this.slope.planeNz;
    di.grounded = wasGrounded && !this.swimming && !rope;
    this.drawn.step(di, LOCO_TUNE.stairs);
    const sa = this.stairSense.at;
    sa.x = this.pos.x;
    sa.y = this.pos.y;
    sa.z = this.pos.z;
    sa.vx = this.vel.x;
    sa.vz = this.vel.z;
    sa.dt = dt;
    sa.filter = filter;
    sa.reads = this.grounded && !this.swimming && !rope && !this.crouching && !this.prone && !this.kneeling && moving;
    sa.measure = LOCO_TUNE.ik.hips === 'steady' || LOCO_TUNE.stairs.stepRule === 'stairs';
    this.stairSense.step(this.physics.world, LOCO_TUNE.stairs);
    // The stairs wave: how far the move took the body along the stairs' travel, for the legs' clip's phase.
    this.stairMoved += mv.x * this.stairSense.ux + mv.z * this.stairSense.uz;
    // Off the ground with no jump this frame (a jump puts the feet down as `grounded` false before the move): a step off
    // a ledge or a drop. Under the owner's air rule, judged once now by one ray down from the feet (the game's own
    // ground query, which passes over other players): the hop over a drop of `fall.hopDrop` or more (`BodyAnim.leftGround`).
    if (wasGrounded && !this.grounded && !this.swimming && !this.flung && !this.grapple.attached && this.anim.judgesLedges) {
      const reach = ANIM_TUNE.fall.hopDrop;
      const d = this.physics.groundDistance(this.pos.x, this.pos.y + 0.1, this.pos.z, reach + 0.1, this.body, filter);
      this.anim.dropBelow = d === null ? -1 : Math.max(0, d - 0.1);
      this.anim.leftGround(this.rig, this.jkaActing);
    }
    // Down from a wreck: flat on the ground where the fall ends.
    if (this.flung && this.grounded) {
      this.prone = true;
      this.vel.x = 0;
      this.vel.z = 0;
      // The imported impact, from its trim, and the keys held while it plays (`impactLocked`); the body is already
      // lying as far as the game goes, so the prone idle is what the clip gives way to. Without the clip, as before.
      this.anim.hitGround(this.rig);
    }

    const ground = this.aboard ? -1e9 : terrain.heightAt(this.pos.x, this.pos.z);
    this.groundUnder = ground;
    // The grapple's step after the move: the dart's trail, and attached, the carry round the rope, the wrapping,
    // the anchor, the haul's arrival, the teleport guard, the towed floor and the slide latch.
    if (this.grapple.out) this.grapple.afterMove(this.gview, dt);
    // And the rest of its frame while anything of it is still easing: the stagger, the jolt, the camera's pull, the
    // lean and the arm. It moves no body, and for a player who never fires it never runs.
    if (this.grapple.lively) this.grapple.look(this.gview, dt);
    // Wave 4: the haul ended under a lip it could not go over (too steep a top, or no room): a braced hang there.
    if (this.grapple.haulStuck && this.ledgeFromHaul()) {
      this.hangFrame(dt, input, cam, world);
      return;
    }
    // Fallen out of the world: back onto the ground. Not inside a building, whose rooms (a bunker's
    // lowest landing, a dungeon under a mountain) go far below the terrain's floor. And under the ground right below
    // too (`fellOut`): a sinkhole sculpted deeper than the world's floor is ground, not out of the world.
    if (!this.aboard && !this.inside && this.pos.y < terrain.floor && !(this.pos.y >= ground - FELL_UNDER)) {
      this.pos.y = ground + 1;
      this.vel.set(0, 0, 0);
    }

    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });

    // Lightsaber: the first press draws it, then the direction keys pick the swing and holding
    // attack chains the next one; the rig plays the move's clip when it has it. With bare hands
    // on, the buttons are the kit's punches and kicks and the saber stays away.
    if (this.classId === 'jedi' && this.fists && this.saberOn) this.toggleSaber();
    // A thing in hand that fights with nothing -- an instrument -- swings at nothing either. It
    // hides the blade the way a melee weapon does and takes no attack at all: the click belongs to
    // whatever it is for, and here that is the music.
    if (this.classId === 'jedi' && !this.fists && !this.holdsNoWeapon) {
      const attackPressed = input.pressedAction('attack');
      const blockPressed = input.pressedAction('block');
      const throwPressed = input.pressedAction('saberThrow');
      if ((attackPressed || blockPressed) && !this.saberOn) this.toggleSaber();
      const roll = this.jka.roll;
      const si: SaberInput = {
        attack: input.held('attack'),
        attackPressed,
        // The block held with attack makes the kata; the staff's kick sits on the throw key.
        altAttack: input.held('block'),
        altAttackPressed: this.saber.style === 'staff' ? throwPressed : blockPressed,
        fmove: mz,
        smove: mx,
        grounded: this.grounded,
        vy: this.vel.y,
        aboveGround: this.grounded ? 0 : (this.groundDistanceUnits(400) ?? 400) * UNIT,
        jumpHeld: input.held('jump'),
        jumpPressed: input.pressedAction('jump') && !this.swimming,
        crouch: this.crouching,
        force: this.force?.value ?? 100,
        enemyNear: (d, r) => this.enemyNear(d, r),
        rollEnding: !!roll && roll.dir === 'F' && roll.left <= 0.25,
        inSpecialJump: this.jka.inSpecialJump || this.jka.rolling,
      };
      // The throw key throws the saber (the staff kicks instead), from the ready stance.
      if (throwPressed && this.saberOn && !this.thrown.inFlight && this.saber.style !== 'staff' && !this.saber.busy && !si.attack && (this.force?.value ?? 100) >= THROW.cost && !this.swimming) {
        if (this.force) this.force.value -= THROW.cost;
        cam.camera.getWorldDirection(aim);
        this.handPosition(handPos);
        if (this.aboard) {
          // Thrown aboard: in the hull's frame from the start.
          hullInv.copy(roomFrame(this.aboard)).invert();
          handPos.applyMatrix4(hullInv);
          aim.transformDirection(hullInv);
        }
        this.thrown.throw(handPos, aim);
        this.saber.holster();
        this.rig?.stopOverride();
      }
      const play = this.saber.update(dt, this.saberOn && !this.thrown.inFlight, si, (a) => this.rig?.clipDuration(a) ?? null);
      if (play) {
        if (play.forceCost > 0 && this.force) this.force.value = Math.max(0, this.force.value - play.forceCost);
        if (play.impulse) {
          // The move's leap: the client sets the velocity outright, along the view's yaw.
          const im = play.impulse;
          this.vel.x = (fwd.x * im.forward + rgt.x * im.right) * UNIT;
          this.vel.z = (fwd.z * im.forward + rgt.z * im.right) * UNIT;
          if (im.up !== null) {
            this.vel.y = im.up * UNIT;
            this.grounded = false;
            this.pos.y += 0.02;
          }
          this.jka.markJumpStart(this.pos.y);
        }
        if (play.move.kind === 'ready') this.rig?.stopOverride();
        // Held: the move keeps its last frame until the next chains in, with no dip to the stance between.
        // A special (a kata, a kick, a lunge, the jump attacks) is a whole-body move: it takes the legs back even from a swing that had the upper body alone.
        else if (this.rig?.has(play.anim)) this.rig.play(play.anim, { loop: play.loop, fadeIn: play.blend, timeScale: play.speed, hold: true, upperOnly: this.rig.overridingUpperOnly && play.move.kind !== 'special' });
        else if (play.move.kind === 'attack' || play.move.kind === 'special') this.startSwing();
      }
    }
    this.updateThrown(dt, input, cam);
    this.updateOrbit(dt);
    this.updateBlades();

    // The body faces the camera while fighting, in the air, rolling and through the wall moves.
    // On the ground, with Jedi Academy's back-pedal clips, the legs turn at most 45 degrees off
    // the camera the way the game's do (CG_PlayerAngles' movement directions): sideways runs
    // angle the legs, backing up plays the back-pedal facing forward, and the torso twists back
    // to the camera. Without those clips the body turns the way it runs, as SWG has no sideways
    // or backwards clips of its own.
    // Only while Jedi Academy's animations are in charge; the game's own clips turn the body the way it runs.
    const directional = this.jkaMode && !!this.rig && this.rig.hasState('runBack');
    this.directional = directional;
    // A swing on the upper body over running legs: the legs keep their angle to the way moved
    // and the torso its turn back to the camera, as they do running without a swing.
    // Decided from the move itself, not from whether the upper body has taken it yet: a swing that
    // starts on the move must not turn the legs to the camera for a frame before it is split off them.
    const swingOnLegs = moving && this.grounded && !!this.rig && (this.rig.overridingUpperOnly || (this.hasJkaClips && this.saber.busy && this.saber.current.kind !== 'special' && !this.jka.rolling && !this.jka.inSpecialJump));
    // Swinging on the rope the body faces the way the view looks, as it does in the air in a fight (§3.12).
    const faceCamera = (this.classId === 'bounty_hunter' && (this.gunReady || !this.hasGunClips)) || (fighting && !swingOnLegs) || (!this.grounded && this.jkaMode) || cam.firstPerson || (this.grapple.attached && this.grapple.modes.swinging);
    const camYaw = Math.atan2(fwd.x, fwd.z);
    // The speed classes face the body by the clip that has the legs: the way the view looks, turned by how far the
    // travel lies from the clip's own heading (`BodyLoco.faces`, `turn`). Backing up and strafing no longer turn it
    // round; a strafe used for a diagonal turns it 45 degrees, which the torso and the head then take back.
    const locoFaces = moving && !this.swimming && this.loco.faces(this.jkaMode);
    const locoTurn = locoFaces ? this.loco.turn : 0;
    // The turn eased (`BodyLoco.face`): where it has got to, which first person takes as it stands, and this frame's
    // share of the way left, which the third-person body's heading is turned by.
    this.loco.face(locoFaces);
    this.aimBodyNow = 0;
    let legsOffset = 0;
    if (this.lockedHeading) {
      this.heading = Math.atan2(this.lockedHeading.x, this.lockedHeading.z);
    } else if (cam.firstPerson) {
      // Seen from the eyes, the body turns with the view at once: a lag would show the shoulders
      // swinging round, and turning the view alone would look back down into the neck. (A clip's own turn is eased.)
      this.heading = camYaw + this.loco.turnNow;
    } else if (faceCamera) {
      // With a blaster up, the body also turns by what the aim's correction left over from the spine.
      let diff = camYaw + locoTurn + this.aimBodyTurn - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 16);
      // How far the body stands turned for the aim just now (it comes round to `aimBodyTurn` over a few frames): what
      // the spine takes the rest of under the speed classes, so the barrel holds while the two change shares.
      const stands = this.heading - camYaw - locoTurn;
      this.aimBodyNow = Math.atan2(Math.sin(stands), Math.cos(stands));
    } else if (locoFaces) {
      let diff = camYaw + locoTurn - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * this.loco.turnStep;
    } else if (moving && directional) {
      // Forward 0, diagonals 22.5, sideways 45 (the sign turns the legs towards the side moved);
      // backing up keeps the legs forward and the back diagonals turn them the other way.
      const side = mx > 0 ? -1 : mx < 0 ? 1 : 0;
      legsOffset = mz > 0 ? side * (Math.PI / 8) : mz < 0 ? -side * (Math.PI / 8) : side * (Math.PI / 4);
      const desired = camYaw + legsOffset;
      let diff = desired - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 14);
    } else if (moving) {
      const desired = Math.atan2(move.x, move.z);
      let diff = desired - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 14);
    } else if (directional && this.grounded) {
      // Standing: the torso follows the view and the legs lag behind it, swinging round once the
      // view is more than 45 degrees off them (CG_SwingAngles' tolerance).
      let diff = camYaw - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const over = Math.abs(diff) - Math.PI / 4;
      if (over > 0) this.heading += Math.sign(diff) * over * Math.min(1, dt * 12);
    }
    // How far the torso turns back towards the camera after the legs' angle: not all the way while moving,
    // since the game keeps the torso a quarter of the legs' offset toward the way moved (CG_PlayerAngles:
    // the legs at the movement offset, the torso at a quarter of it), so a strafe leans the shoulders a little.
    const torsoWants = camYaw + legsOffset * 0.25;
    this.torsoTwist = directional && this.grounded && !faceCamera && !this.lockedHeading ? Math.atan2(Math.sin(torsoWants - this.heading), Math.cos(torsoWants - this.heading)) : 0;
    // Under the speed classes the torso takes back a share of whatever the clip turned the body by (the head's look
    // takes what it can of the rest), measured from where the body really stands just now.
    if (locoFaces && !this.lockedHeading) {
      const back = camYaw + this.aimBodyNow - this.heading;
      this.torsoTwist = Math.atan2(Math.sin(back), Math.cos(back)) * LOCO_TUNE.turn.torso;
    }
    // The feedback round, item 3: lying, the heading just decided turns the lying capsule, or is slid or refused by it.
    if (this.shape.kind === LYING) this.turnLying();

    this.moveAmount += ((moving ? Math.min(1, speed / RUN_SPEED) : 0) - this.moveAmount) * Math.min(1, dt * 10);
    this.phase += dt * speed * (moving ? 1.9 : 0);
    // The clips are scaled to the speed the body actually moves at, so the feet stay planted.
    this.groundSpeed = moving ? (this.moveProfile === 'jka' && !this.swimming ? Math.hypot(this.vel.x, this.vel.z) : speed) : 0;
    this.animate(dt);
    cam.camera.getWorldDirection(this.lookDir);
    this.animateRig(dt, this.groundSpeed, moving, mz, mx);
    // The treading figure's sink (`SwimSink`): on while the body treads in the water (still, which under the owner's
    // rule is under the water too), never in first person, whose eye is the head itself (lowered with the figure it
    // would sit 0.15 m over the water on a human and go under on the swell), and only at the surface.
    const ss = this.swimSink;
    ss.dt = dt;
    ss.depth = this.waterDepth;
    ss.scale = this.rig ? this.rig.root.scale.y : 1;
    ss.floatDepth = SWIM_DEPTH;
    ss.step(this.swimming && !moving && !cam.firstPerson, ANIM_TUNE);

    this.placeVisual();
    this.placeFeet(dt);
    // Wave 4, item B: the hands bracing on a wall, in a passage or on a body near (after the feet: the last to turn a joint).
    this.placeBrace(dt, world, false);
  }

  /**
   * Wave 3: the feet placed on what is under them (`FootIk`), the figure posed and placed: standing on its feet on the
   * ground (idle, every class, crouched, kneeling, Jedi Academy's legs, a gun's carry); never in the air, swimming, prone,
   * on the rope or in its flight, dead, thrown, standing in a flow, on the gravity boots' surface (whose up is not the
   * world's), sliding, or in a whole-body special move (a flip, a kata, a roll, the landing roll: Jedi Academy's own
   * one-offs on the whole body that are no plain swing). Aboard a ship's rooms its rays are cast in the rooms' own physics.
   */
  private placeFeet(dt: number): void {
    const rig = this.rig;
    if (!rig) return;
    const fi = this.feet.in;
    const special = (this.saber.busy && this.saber.current.kind === 'special') || this.jka.rolling || this.jka.inSpecialJump || (rig.overridingJka && !rig.overridingUpperOnly && !this.saber.busy);
    fi.on = this.grounded && !this.swimming && !this.prone && !this.grapple.attached && !this.grapple.released && !this.flung && this.hp > 0 && this.drawnSink <= 0 && !(this.aboard && isSurfaceRoom(this.aboard)) && !this.slope.sliding && !special;
    fi.landing = this.anim.landing !== null;
    fi.dt = dt;
    fi.stairClip = this.loco.legsOn && isStairPick(this.loco.pick);
    fi.px = this.pos.x;
    fi.py = this.pos.y;
    fi.pz = this.pos.z;
    fi.heading = this.heading;
    fi.filter = this.inside ? groups(Group.all, Group.all & ~(Group.terrain | Group.exterior)) : groups(Group.all, Group.all);
    // The stairs wave: the stairs measured under the body (the hips' line), and one step a stair's stride and clearance.
    const stepping = this.loco.legsOn && this.loco.stepFacts !== null;
    // Stairs II: the pin held through each foot's first stance under the regular clip after the stairs gave way too (`StairEnd.pins`).
    fi.stride = stepping ? this.loco.step.stride : 1;
    fi.clear = stepping ? LOCO_TUNE.stairs.clear : 0;
    fi.pin = (stepping || this.loco.stairEnd.pins) && LOCO_TUNE.stairs.pin === 'sole';
    stairFeetOf(this.stairSense, fi);
    fi.pivotL = stepping ? this.loco.step.pivotL : 0;
    fi.pivotR = stepping ? this.loco.step.pivotR : 0;
    // Nothing to place and nothing eased in: under 'before' (and off the feet) the frame asks nothing more, the figure's
    // matrices left for the draw to work out as ever.
    if (!(fi.on && LOCO_TUNE.ik.rule === 'placed') && this.feet.weight === 0 && this.feet.drop === 0) return;
    this.group.updateMatrixWorld(true);
    const room = this.aboard;
    this.feet.step(rig, this.physics.world, room ? this.roomInverse.copy(roomFrame(room)).invert() : null);
  }

  /** The stairs wave: the speed classes' record of the stairs' measure (`StairSense`: the tread and riser, the next riser), field by field. */
  private stairLoco(): void {
    const s = this.stairSense;
    const lo = this.locoIn;
    lo.stairKnown = s.known;
    lo.stairTread = s.tread;
    lo.stairRiser = s.riser;
    lo.stairNext = s.next;
    lo.stairPrev = s.prev;
    lo.stairLead = this.feet.leadSide;
    lo.stairLeadAt = this.feet.leadAt;
    // Stairs II: the hold ending (no riser of the way ahead within the longest tread): walked off once a foot is planted on the
    // floor beyond the last riser of the way, which stands this far behind the body's middle.
    lo.stairEnding = s.ending;
    lo.stairAhead = s.way > 0 ? s.ahead.up : s.way < 0 ? s.ahead.down : Number.POSITIVE_INFINITY;
    lo.stairGap = s.way > 0 ? s.ahead.upGap : s.way < 0 ? s.ahead.downGap : Number.POSITIVE_INFINITY;
    lo.stairBehind = s.way > 0 ? s.ahead.upBehind : s.way < 0 ? s.ahead.downBehind : Number.POSITIVE_INFINITY;
  }

  // ---- wave 4: the ledges ------------------------------------------------------------------------------------------------

  /** Said on the message line by the ledges (a refusal in words): the game sets it. */
  onLedgeWords: ((words: string) => void) | null = null;

  /** Hanging from a ledge or carried through one of its one-offs, or on a wall: the fight's keys are muted by the game, the grapple refused. */
  get climbHolds(): boolean {
    return this.ledge.holding || this.wall.holding || this.bar.holding || this.rope.holding;
  }

  /** The move's own collision groups (as the frame's `filter`). */
  private moveFilter(): number {
    return this.inside ? groups(Group.all, Group.all & ~(Group.terrain | Group.exterior)) : groups(Group.all, Group.all);
  }

  /**
   * The figure's size against the human male's (its hips' rest height over his 1.002 m, times its own scale), found once a rig.
   * (Phase 4, the fixer: public, so the console's course lays the rope's landings for the figure standing, `climbTest`.)
   */
  ledgeScale(): number {
    return this.rig ? figureScaleOf(this.rig) : 1;
  }

  /** The ledges' frame record: the keys and the body (fields, so nothing crosses a call). */
  private fillLedgeIn(dt: number, input: Input | null, move: THREE.Vector3 | null, wasGrounded: boolean): LedgeIn {
    const li = this.ledgeIn;
    li.dt = dt;
    li.heading = this.heading;
    li.grounded = this.grounded;
    li.wasGrounded = wasGrounded;
    li.jumped = this.vel.y > 0.5;
    li.crouchHeld = !!input && input.held('crouch');
    li.crouchPressed = !!input && input.pressedAction('crouch');
    li.jumpPressed = !!input && input.pressedAction('jump');
    li.forwardHeld = !!input && input.held('forward');
    li.forwardPressed = !!input && input.pressedAction('forward');
    li.backHeld = !!input && input.held('back');
    li.leftHeld = !!input && input.held('left');
    li.rightHeld = !!input && input.held('right');
    li.moveX = move ? move.x : 0;
    li.moveZ = move ? move.z : 0;
    li.scale = this.ledgeScale();
    li.filter = this.moveFilter();
    li.pool = this.staminaPool;
    li.blocked = this.wallBlocked;
    li.airWallMove = false;
    li.use = this.climbAsk.on;
    return li;
  }

  /**
   * Climbing II, item 1: on foot and falling, where the use key goes to the climb before anything else may take it
   * (`climbTakesUseFirst`, the game's dispatch asks it).
   */
  get climbFalls(): boolean {
    return climbTakesUseFirst(CLIMB_TUNE.grab, !this.mounted && !this.piloting && !this.aboard && !this.noclip && !this.swimming, this.grounded, this.vel.y);
  }

  /**
   * Climbing II, item 1: whether the use key would grab a lip or start a wall climb here (the action bar's "climb", gathered a
   * few times a second): on foot, nothing else holding the body, a lip in the hands' reach or a climbable face ahead.
   */
  climbReach(): boolean {
    this.reachBar = false;
    this.reachRope = false;
    if (CLIMB_TUNE.grab !== 'use' || this.mounted || this.piloting || this.aboard || this.noclip || this.swimming || this.climbHolds || this.grapple.out || this.eva || this.hp <= 0) return false;
    const li = this.fillLedgeIn(0, null, null, false);
    li.busy = false;
    const w = this.physics.world as unknown as LedgeWorld;
    // (Climbing II, phase 3: a bar in reach with room under it, `climb.bars` 'on', first: the ledges pass a bar. Maker B: and
    // whether it was a bar, kept for the action bar's word, "grab".)
    this.reachBar = this.bar.canGrab(this.physics.world as unknown as BarWorld, this, li);
    return this.reachBar || this.ledge.canGrab(w, this, li) || this.wall.canClimb(w, this, li) || this.ropeReach(li);
  }

  /** Climbing II, phase 4: a rope in reach with room under it (`climb.ropes` 'on'): `climbReach`'s last ask (a rope is no collider: nothing else is it). */
  private ropeReach(li: LedgeIn): boolean {
    if (this.rope.ropes.length === 0) return false;
    this.viewYawInto(li);
    // (Maker B: and whether it was a rope, kept for the action bar's word, "grab".)
    this.reachRope = this.rope.canGrab(this.physics.world as unknown as RopeWorld, this, li);
    return this.reachRope;
  }

  /**
   * Climbing II, phase 4: after the move, a rope grabbed with the use key (`RopeSwing.sense`), not swimming, on the grapple's rope
   * or in its flight, thrown, dead, at a ship's controls, prone, in a wall move or a Force jump's rise, as the bars' grab. True
   * where the rope took the body.
   */
  private senseRope(dt: number, input: Input, move: THREE.Vector3, wasGrounded: boolean, atControls: boolean, cam: ThirdPersonCamera): boolean {
    if (CLIMB_TUNE.ropes !== 'on' || this.rope.ropes.length === 0) return false;
    const li = this.fillLedgeIn(dt, input, move, wasGrounded);
    li.busy = this.swimming || this.grapple.out || this.grapple.released || this.flung || this.hp <= 0 || atControls || this.prone || this.jka.inSpecialJump || (this.jka.isForceJumping && this.vel.y > 0) || (this.aboard !== null && isSurfaceRoom(this.aboard));
    // (Where the view looks: the swing's plane at a grab from a standstill.)
    if (this.aboard) li.viewYaw = Number.NaN;
    else {
      cam.forward(fwd);
      li.viewYaw = Math.atan2(fwd.x, fwd.z);
    }
    this.ropeViewYaw = li.viewYaw;
    this.rope.said = '';
    const took = this.rope.sense(this.physics.world as unknown as RopeWorld, this, li);
    if (!took) return false;
    this.takenByRope();
    return true;
  }

  /** The view's yaw into the ledges' frame (`climbReach`'s ask, a few times a second: the camera the update last placed). */
  private viewYawInto(li: LedgeIn): void {
    li.viewYaw = this.ropeViewYaw;
  }

  /** The view's yaw the last frame on foot saw (what `climbReach`, gathered between frames, reads for a rope's plane). */
  private ropeViewYaw = Number.NaN;

  /** A rope grabbed: as a bar's (`takenByBar`), the fall ends with no harm and the air's and the slope's memories are put down. */
  private takenByRope(): void {
    this.jka.reset();
    this.jka.holdApex(this.pos.y);
    this.anim.drop();
    this.slope.reset();
    this.feet.reset();
    this.drawn.reset();
    this.brace.reset();
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.heading = this.rope.heading;
    this.hangClips.posePlaying = '';
    // (Maker B: the health the rope's frames measure a blow against.)
    this.ropeHp = this.hp;
  }

  /**
   * Phase 4: a frame on a rope (`RopeSwing.step`) in place of the movement, as a bar's (`barFrame`): the speed classes put down,
   * what is in the hands kept as a hang keeps it, the swing stepped on the physics' own coming steps (`Physics.stepsAhead`), the
   * rope's clips by its mode, and the figure placed with its hands on the rope.
   */
  private ropeFrame(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {
    void world;
    this.loco.idle(0, this.staminaPool);
    this.slope.reset();
    this.feet.reset();
    this.drawn.reset();
    this.saber.holster();
    this.blocking = false;
    this.aiming = false;
    cam.aim = false;
    this.swimming = false;
    this.submerged = false;
    this.lockedHeading = null;
    this.crouching = false;
    const li = this.fillLedgeIn(dt, input, null, false);
    // Where the view looks (the swing's plane turns toward it; none aboard a ship's rooms, whose frame is the hull's).
    if (this.aboard) li.viewYaw = Number.NaN;
    else {
      cam.forward(fwd);
      li.viewYaw = Math.atan2(fwd.x, fwd.z);
    }
    const R = this.rope;
    // Maker B, item 5: a blow taken since the last frame on the rope, hard enough, knocks the body off (`RopeSwing.knock`), as off
    // a bar; and the water under the body, which lets go of the rope into the swim and ends a flight off it (the swim's own surface
    // and depth; none indoors or aboard).
    if (this.hp < this.ropeHp) R.knock(this.ropeHp - this.hp);
    this.ropeHp = this.hp;
    if (!this.aboard && !this.inside) {
      const flat = world.waterColumnAt(this.pos.x, this.pos.z);
      R.swimLine = flat + world.seaSwellOverFlat(this.pos.x, this.pos.z, flat) - SWIM_DEPTH;
    } else R.swimLine = Number.NEGATIVE_INFINITY;
    R.steps = this.physics.stepsAhead(dt);
    R.behind = this.physics.behind;
    R.step(this.physics.world as unknown as RopeWorld, this, li);
    this.setCrouchCollider(false);
    // (Maker B: the fall's memory where the rope says: the flight's top while flying off it, else the feet; and a landing ended stood.)
    this.jka.holdApex(R.apexY);
    this.grounded = R.landedNow;
    if (R.holding) this.heading = R.heading;
    this.torsoTwist = 0;
    this.groundSpeed = 0;
    this.moveAmount += (0 - this.moveAmount) * Math.min(1, dt * 10);
    this.updateThrown(dt, input, cam);
    this.updateOrbit(dt);
    this.updateBlades();
    this.animateRope(dt);
    this.placeVisual();
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
  }

  /** Phase 4: the rope's clips measured off the rig once (`measureRopeTables`), the swing's twin made, the figure's place, and the clips on the rig. */
  private animateRope(dt: number): void {
    const rig = this.rig;
    if (!rig) return;
    if (this.ropeTablesRig !== rig) {
      const T = measureRopeTables(rig);
      if (T) {
        this.ropeTables = T;
        this.ropeTablesRig = rig;
        rig.twinClip(ROPE_CLIP_NAMES[ROPE_SWING], ROPE_SWING_TWIN);
        // (Maker B: and the let-go's, the flight's and each landing's, once a rig.)
        this.ropeLandTables = measureRopeLandTables(rig);
      }
    }
    this.rope.landTables = this.ropeTablesRig === rig ? this.ropeLandTables : null;
    this.rope.placeFigure(this.ropeTablesRig === rig ? this.ropeTables : null, rig.root.scale.y, this.pos);
    driveRopeClips(rig, this.rope, dt, this.hangClips);
    this.group.updateMatrixWorld(true);
    rig.twistTorso(0, 0);
  }

  /**
   * Phase 4: a rope stood (the course's, the console's): one the use key may grab, drawn as the grappling hook's rope (a ribbon
   * of its own on the hook's one material, so it builds no program), shown while `climb.ropes` is 'on'.
   */
  addRope(r: HangingRope): void {
    if (this.rope.ropes.indexOf(r) >= 0) return;
    this.rope.add(r);
    const ribbon = new RopeRibbon(2, 1);
    this.ropeScene.add(ribbon.mesh);
    markActor(ribbon.mesh);
    r.drawn = ribbon;
    this.ropeRibbons.set(r, ribbon);
  }

  /** Phase 4: a rope taken down (let go of first where it is held), its ribbon out of the scene and its geometry disposed. */
  removeRope(r: HangingRope): void {
    this.rope.remove(r);
    const ribbon = this.ropeRibbons.get(r);
    if (ribbon) {
      ribbon.mesh.removeFromParent();
      ribbon.mesh.geometry.dispose();
      this.ropeRibbons.delete(r);
    }
    r.drawn = null;
  }

  /** Phase 4: the ropes stood and their ribbons (the console's and the course's). */
  private readonly ropeRibbons = new Map<HangingRope, RopeRibbon>();

  /**
   * Phase 4: the ropes laid for this frame (beside `drawGrapple`): each rope's ribbon from its anchor through the hands (while held)
   * to its end, straight, at the angle its swing is drawn at; hidden while `climb.ropes` is 'off'. Writes kept arrays only.
   */
  drawRopes(camera: THREE.PerspectiveCamera, screenH: number): void {
    const on = CLIMB_TUNE.ropes === 'on';
    const list = this.rope.ropes;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const ribbon = this.ropeRibbons.get(r);
      if (!ribbon) continue;
      if (!on) {
        if (ribbon.mesh.visible) ribbon.hide();
        continue;
      }
      ropeEnd.x = r.endX;
      ropeEnd.y = r.endY;
      ropeEnd.z = r.endZ;
      ribbon.slack = 0;
      ribbon.screenH = screenH;
      ribbon.lay(r.pts, r.count, ropeEnd, camera);
    }
  }

  /** Climbing II, phase 3 (maker B): whether the last `climbReach` found a bar (the action bar's "grab" for its "climb"). */
  reachBar = false;

  /**
   * Climbing II, phase 3: after the move, a bar grabbed with the use key (`BarSwing.sense`): not swimming, on the rope or in its
   * flight, thrown, dead, at a ship's controls, prone, in a wall move or a Force jump's rise, as the ledges' grab. True where the
   * bar took the body.
   */
  private senseBar(dt: number, input: Input, move: THREE.Vector3, wasGrounded: boolean, atControls: boolean): boolean {
    if (CLIMB_TUNE.bars !== 'on') return false;
    const li = this.fillLedgeIn(dt, input, move, wasGrounded);
    li.busy = this.swimming || this.grapple.out || this.grapple.released || this.flung || this.hp <= 0 || atControls || this.prone || this.jka.inSpecialJump || (this.jka.isForceJumping && this.vel.y > 0) || (this.aboard !== null && isSurfaceRoom(this.aboard));
    // (A refusal the last frame's lip or wall took is never said: the update says one only once neither took the press.)
    this.bar.said = '';
    const took = this.bar.sense(this.physics.world as unknown as BarWorld, this, li);
    if (!took) return false;
    this.takenByBar();
    return true;
  }

  /** A bar grabbed: as a lip's (`takenByLedge`), the fall ends with no harm and the air's and the slope's memories are put down. */
  private takenByBar(): void {
    this.jka.reset();
    this.jka.holdApex(this.pos.y);
    this.anim.drop();
    this.slope.reset();
    this.feet.reset();
    this.drawn.reset();
    this.brace.reset();
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.heading = this.bar.heading;
    this.hangClips.posePlaying = '';
    // (Maker B: the health the bar's frames measure a blow against.)
    this.barHp = this.hp;
  }

  /** Climbing II, phase 3 (maker B): the health at the last frame on a bar (a blow since then of `climb.barKnock` or more knocks the body off). */
  private barHp = 0.5;

  /**
   * Phase 3: a frame on a bar (`BarSwing.step`) in place of the movement, as a hang's (`hangFrame`): the speed classes put down,
   * what is in the hands kept as a hang keeps it, the swing stepped on the physics' own coming steps (`Physics.stepsAhead`), the
   * bar's clip by the swing's angle, and the figure placed with its hands on the bar.
   */
  private barFrame(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {
    void world;
    this.loco.idle(0, this.staminaPool);
    this.slope.reset();
    this.feet.reset();
    this.drawn.reset();
    this.saber.holster();
    this.blocking = false;
    this.aiming = false;
    cam.aim = false;
    this.swimming = false;
    this.submerged = false;
    this.lockedHeading = null;
    this.crouching = false;
    const li = this.fillLedgeIn(dt, input, null, false);
    const B = this.bar;
    // Maker B: a blow taken since the last frame on the bar, hard enough, knocks the body off (`BarSwing.knock`); and the water
    // under the body, which ends a flight off the bar (the swim's own surface and depth; none indoors or aboard).
    if (this.hp < this.barHp) B.knock(this.barHp - this.hp);
    this.barHp = this.hp;
    if (!this.aboard && !this.inside) {
      const flat = world.waterColumnAt(this.pos.x, this.pos.z);
      B.swimLine = flat + world.seaSwellOverFlat(this.pos.x, this.pos.z, flat) - SWIM_DEPTH;
    } else B.swimLine = Number.NEGATIVE_INFINITY;
    B.steps = this.physics.stepsAhead(dt);
    B.behind = this.physics.behind;
    B.step(this.physics.world as unknown as BarWorld, this, li);
    this.setCrouchCollider(false);
    // (Maker B: the fall's memory at the flight's top while flying off a bar and the frame it ends, else the body's feet.)
    this.jka.holdApex(B.apexY);
    this.grounded = false;
    if (B.holding) this.heading = B.heading;
    this.torsoTwist = 0;
    this.groundSpeed = 0;
    this.moveAmount += (0 - this.moveAmount) * Math.min(1, dt * 10);
    this.updateThrown(dt, input, cam);
    this.updateOrbit(dt);
    this.updateBlades();
    this.animateBar(dt);
    this.placeVisual();
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
  }

  /** Phase 3: the bar's clip measured off the rig once (`measureBarTable`), the figure's place for the swing, and the clip on the rig. */
  private animateBar(dt: number): void {
    const rig = this.rig;
    if (!rig) return;
    if (this.barTableRig !== rig) {
      const T = measureBarTable(rig);
      if (T) {
        this.barTable = T;
        this.barTableRig = rig;
        // Maker B: the flight's twin of the clip and its hips' table, once a rig.
        rig.twinClip(BAR_CLIP_NAMES[BAR_CLIP], BAR_FLIGHT_NAME);
        this.barFlight = measureBarFlight(rig);
      }
    }
    this.bar.flight = this.barTableRig === rig ? this.barFlight : null;
    this.bar.placeFigure(this.barTableRig === rig ? this.barTable : null, rig.root.scale.y, this.pos);
    driveBarClips(rig, this.bar, dt, this.hangClips);
    this.group.updateMatrixWorld(true);
    rig.twistTorso(0, 0);
  }

  /**
   * After the move (`LedgeHang.sense`): a lip grabbed, or one lowered into off a lip crouched. Not swimming, on the rope or in
   * its flight, thrown, dead, at a ship's controls, in a wall move or a Force jump's rise. True where the ledge took the body.
   */
  private senseLedge(dt: number, input: Input, move: THREE.Vector3, wasGrounded: boolean, atControls: boolean): boolean {
    if (CLIMB_TUNE.ledges !== 'on') return false;
    const li = this.fillLedgeIn(dt, input, move, wasGrounded);
    li.busy = this.swimming || this.grapple.out || this.grapple.released || this.flung || this.hp <= 0 || atControls || this.prone || this.jka.inSpecialJump || (this.jka.isForceJumping && this.vel.y > 0) || (this.aboard !== null && isSurfaceRoom(this.aboard));
    if (!this.ledge.sense(this.physics.world as unknown as LedgeWorld, this, li, this.loco.stamina)) return false;
    this.takenByLedge();
    return true;
  }

  /** The grapple's haul ended under a lip it could not go over: a braced hang there (`LedgeHang.fromHaul`), the rope let go. */
  private ledgeFromHaul(): boolean {
    if (CLIMB_TUNE.ledges !== 'on') return false;
    const piv = this.grapple.pivot(ledgePivot);
    const li = this.fillLedgeIn(0, null, null, false);
    if (!this.ledge.fromHaul(this.physics.world as unknown as LedgeWorld, this, li, piv.x - this.pos.x, piv.z - this.pos.z)) return false;
    this.grapple.letGo('ledge');
    this.takenByLedge();
    return true;
  }

  /** A grab: the fall ends with no harm, the air's and the slope's memories are put down, the feet let go. */
  private takenByLedge(): void {
    this.jka.reset();
    this.jka.holdApex(this.pos.y);
    this.anim.drop();
    this.slope.reset();
    this.feet.reset();
    this.drawn.reset();
    // (Wave 4, item B: the hands' bracing lets go; the hang has them.)
    this.brace.reset();
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.heading = this.ledge.heading;
    // (Climbing II, item 7: no look-away pose carried over from a hang before.)
    this.hangClips.posePlaying = '';
  }

  /** Off the ledge: a let-go's clocks (`LedgeHang.tick`): the drop's clip handed to the falling loop, the jump off's turn round. */
  private ledgeClocks(dt: number): void {
    if (this.ledge.tick(dt)) this.heading = this.ledge.turnNow;
    // Climbing II, Smoothness II, item 1: a drop played by the owner's rule (its clip timed to the fall, held while still
    // falling, the landing from the feet's touch, ended at once in the water or on the rope), and a let-go's cut handed to the
    // loop that follows (src/player/hangClips.ts, which the climbing's tests drive); nothing while there is neither.
    driveDropClip(this.rig, this.ledge, dt, this.grounded, !this.swimming && !this.grapple.attached && !this.grapple.released);
    // Wave 4, item B: and the wall's (its drawn lean and offset eased out after a let-go, the jump off's turn round).
    if (this.wall.tick(dt)) this.heading = this.wall.turnNow;
    // Climbing II, phase 3: and the bar's (a let-go's held clip let go of where nothing else did, the drawn offset eased out).
    releaseBarClip(this.rig, this.bar);
    this.bar.tick(dt);
    // Phase 4: and the rope's (its clips let go of where nothing else did, the drawn offset eased out; the ropes nobody holds are
    // swung at the top of the update, `tickRopes`).
    releaseRopeClip(this.rig, this.rope);
    this.rope.tick(dt);
  }

  /**
   * A frame of the hang (`LedgeHang.step`) in place of the movement: the speed classes put down with no regain (the hang
   * drains the pool itself), what is in the hands kept as swimming keeps it (the blade put away, nothing aimed or blocked),
   * the hang's clips, the figure placed, and its hands on the lip and its feet on the wall.
   */
  private hangFrame(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {
    void world;
    this.loco.idle(0, this.staminaPool);
    this.slope.reset();
    this.feet.reset();
    this.drawn.reset();
    this.saber.holster();
    this.blocking = false;
    this.aiming = false;
    cam.aim = false;
    this.swimming = false;
    this.submerged = false;
    this.lockedHeading = null;
    this.crouching = false;
    const li = this.fillLedgeIn(dt, input, null, false);
    // Climbing II, item 7: where the view looks, for the braced look-away (none aboard a ship's rooms, whose frame is the hull's).
    if (this.aboard) li.viewYaw = Number.NaN;
    else {
      cam.forward(fwd);
      li.viewYaw = Math.atan2(fwd.x, fwd.z);
    }
    this.clearDt = dt;
    this.ledge.step(this.physics.world as unknown as LedgeWorld, this, li, this.loco.stamina);
    // The capsule the ledge's step has the body in: standing, but crouched over the top on a climb's last leg.
    this.setCrouchCollider(this.ledge.crouchedNow);
    if (this.ledge.said) {
      this.onLedgeWords?.(this.ledge.said);
      this.ledge.said = '';
    }
    // The fall's memory held where the body is: a let-go falls from here, and nothing of the climb hurts.
    this.jka.holdApex(this.pos.y);
    if (this.ledge.holding) {
      this.grounded = false;
      this.heading = this.ledge.heading;
    } else this.grounded = this.ledge.stood;
    this.torsoTwist = 0;
    this.groundSpeed = 0;
    this.moveAmount += (0 - this.moveAmount) * Math.min(1, dt * 10);
    // Wave 4, item B: a hang a wall climb handed over eases the climb's lean out (the hang never runs the clocks after it).
    this.wall.tick(dt);
    this.updateThrown(dt, input, cam);
    this.updateOrbit(dt);
    this.updateBlades();
    this.animateHang(dt);
    this.placeVisual();
    this.placeHangLimbs();
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
  }

  /** The kept fade a hang's loop comes in with (`climb.ease`). */
  private readonly hangFade = { fade: 0.15 };
  /** The smoothness round, item 2: a ladder's climb's rate and fade handed to the rig (kept). */
  private readonly ladderRate = { rate: 0.5, fade: 0.15 };

  /**
   * The smoothness round, item 3: the head's pitch while hanging (the view's, `pitch`), turned down at the lip beneath by the
   * drop's cue's share while it shows (`LedgeHang.headDown`); the view's otherwise, to the bit.
   */
  headPitchFor(pitch: number): number {
    const L = this.ledge;
    return L.headShare > 0 ? pitch + (L.headDown - pitch) * L.headShare : pitch;
  }

  /**
   * The hang's clips on the rig: a one-off begun, a held one let go into the loop, the loop itself (Smoothness II moved them
   * whole into `driveHangClips`, src/player/hangClips.ts, so the climbing's tests drive the very hand-over on the real rig).
   */
  private animateHang(dt: number): void {
    const rig = this.rig;
    if (!rig) return;
    const L = this.ledge;
    driveHangClips(rig, L, dt, this.hangClips);
    this.group.updateMatrixWorld(true);
    // Climbing II, item 7: the spine turned toward the view while looking away (nought otherwise, every hang frame, so with
    // no look-away this is phase 1's own call to the letter: it eases the steady share and puts the clean pose back).
    rig.twistTorso(L.lookTwistNow, 0);
  }

  /** The hop clip held as the look-away's pose on the rig now ('' for none), and the fades handed to the rig: the hang's clips' own. */
  private readonly hangClips: HangClipState = { posePlaying: '', hangFade: this.hangFade, ladderRate: this.ladderRate };

  /** The rig's root put where the ledge draws the figure against the body (its offset, the world's frame, into the group's). */
  private applyLedgeRoot(): void {
    const rig = this.rig;
    if (!rig) return;
    const L = this.ledge;
    const h = this.heading;
    const c = Math.cos(h);
    const s = Math.sin(h);
    rig.root.position.x = L.offX * c - L.offZ * s;
    rig.root.position.y += L.offY;
    rig.root.position.z = L.offX * s + L.offZ * c;
    // Turned with a sloping lip about its own front, on its hands (the fix round's: `climb.lipTilt`); upright otherwise.
    if (L.tilted) L.applyTilt(rig.root);
    else rig.root.quaternion.set(0, 0, 0, 1);
    this.ledgeRooted = true;
  }

  /** The hands on the lip and the feet on the wall (`LimbPlace`, through the ledge's line): while the ledge places them. */
  private placeHangLimbs(): void {
    const rig = this.rig;
    if (!rig) return;
    const lp = this.limbs;
    if (!this.ledge.holding && !lp.busy) return;
    this.group.updateMatrixWorld(true);
    const room = this.aboard;
    const toPhys = room ? this.roomInverse.copy(roomFrame(room)).invert() : null;
    this.ledge.limbsFor(lp, rig, toPhys);
    this.clearFigure(lp, toPhys);
    lp.filter = this.moveFilter();
    lp.place(rig, this.physics.world, toPhys);
    this.settleFigure(lp, toPhys);
  }

  /**
   * Climbing II, Smoothness II, item 3 (`climb.bodyClear` 'spheres'): after the hang or the wall has lined the figure up and
   * before the limbs' solves, the figure's spheres asked of what stands still and the figure pushed out of what they are in (a
   * hand or the feet planted on the lip or the face allowed their contact: their spheres are not asked). Never aboard a ship's
   * rooms (their frame turns the push); nothing under 'before'.
   */
  private clearFigure(lp: LimbPlace, toPhys: THREE.Matrix4 | null): void {
    const S = this.spheres;
    const rig = this.rig;
    if (CLIMB_TUNE.bodyClear !== 'spheres' || toPhys !== null || !S.ready || !rig) return;
    if (!this.spheresClimb) S.reset();
    this.spheresClimb = true;
    // The held lip's outward way, or on a wall its face's (the limbs' own copy of it).
    const onWall = this.wall.holding && !this.ledge.holding;
    clearClimb(S, lp, rig, this.physics.world as unknown as SphereWorld, this.moveFilter(), this.clearDt, this.pos.x, this.pos.y + this.colliderOffsetY, this.pos.z, onWall ? lp.wall[3] : this.ledge.lip.nx, onWall ? lp.wall[5] : this.ledge.lip.nz);
  }

  /** Item 3, after the limbs' solves: what they took back into something pushed out at once (`settleClimb`). */
  private settleFigure(lp: LimbPlace, toPhys: THREE.Matrix4 | null): void {
    const S = this.spheres;
    const rig = this.rig;
    if (CLIMB_TUNE.bodyClear !== 'spheres' || toPhys !== null || !S.ready || !rig) return;
    settleClimb(S, lp, rig, this.physics.world as unknown as SphereWorld, this.moveFilter());
  }

  /**
   * Smoothness II, items 3 and 4 on the feet, after the pose (`animate`): the drawn figure's top over the capsule's, held over
   * the walk's bob, handed to the duck (`move.duckHead` 'clear', `ShapeIn.headOver`); and ducked under something, the figure
   * pushed out across of anything still its spheres are in (`climb.bodyClear` 'spheres'; across only, never into its floor),
   * eased back once out from under it. Nothing at all with both switches at 'before'.
   */
  /**
   * Smoothness II, item 4, after its review: the crouch's own head off the rig's crouch clips (`deepClipsOf`, posed alone by
   * `CharacterRig.posedHighest`, every node put back): the highest drawn top of the head, neck and chest over the rig's root
   * (the feet). An event, once a rig, as soon as it has the plain crouched walk (the pack's clips may come in after the rig).
   */
  /** The console's: the crouch's own head read off its clips, cm over the feet (null until read). */
  get crouchHeadCm(): number | null {
    return this.deepClip === this.deepClip ? Math.round(this.deepClip * 1000) / 10 : null;
  }

  private measureDeep(rig: CharacterRig): void {
    // (Item 3b: a rig whose crouch is not read yet wears the keys' class: no head of another rig's stands for its own.)
    if (this.shapeIn.clipHeads[2] === this.shapeIn.clipHeads[2] && this.deepRig !== rig) this.shapeIn.clipHeads.fill(Number.NaN);
    if (!rig.has(DEEP_MAIN)) return;
    this.deepRig = rig;
    const S = this.spheres;
    const root = rig.root;
    const measure = () => {
      S.sample();
      S.topOfUpper();
      return S.topNow - root.matrixWorld.elements[13];
    };
    this.deepClip = rig.posedHighest(deepClipsOf(rig), DEEP_SAMPLES, measure);
    // (Each clip's own, for the console: an event, once a rig.)
    this.deepHeads = {};
    for (const c of deepClipsOf(rig)) if (rig.has(c)) this.deepHeads[c] = Math.round(rig.posedHighest([c], DEEP_SAMPLES, measure) * 1000) / 10;
    // Smoothness III, item 3b (`move.duckClip` 'clearance'): each crouched walk's own head by its class, which the duck wears by
    // its clearance (NaN for a class the rig has no clip of: the duck then wears the keys' class, as ever); and the crouch's own
    // idle's, for the console.
    const heads = this.shapeIn.clipHeads;
    heads.fill(Number.NaN);
    for (let cls = 1; cls <= 3; cls++) {
      const c = clipOfId(CROUCH_CLIPS[cls]);
      if (rig.has(c)) heads[cls] = rig.posedHighest([c], DEEP_SAMPLES, measure);
    }
    const idle = rig.stateClip('crouch');
    this.crouchIdleHead = idle && rig.has(idle) ? rig.posedHighest([idle], DEEP_SAMPLES, measure) : Number.NaN;
  }
  /** Item 3b, the console's: the crouch's own idle's head over the feet, metres (NaN until read). */
  crouchIdleHead = Number.NaN;
  /** The console's: each crouch clip's own head over the feet, cm (`measureDeep`'s, per clip). */
  deepHeads: Record<string, number> = {};

  private duckFigure(dt: number, rig: CharacterRig, ducked: boolean): void {
    this.spheresClimb = false;
    const S = this.spheres;
    const head = MOVE_TUNE.duckHead === 'clear' && MOVE_TUNE.duck === 'on';
    const clear = CLIMB_TUNE.bodyClear === 'spheres' && MOVE_TUNE.duck === 'on' && (ducked || this.duckPushed);
    // (The push laid across last frame taken back: on the feet the root stands at nought across.)
    if (this.duckPushed) {
      rig.root.position.set(0, rig.root.position.y, 0);
      this.duckPushed = false;
    }
    if (!S.ready || this.aboard !== null || (!head && !clear)) {
      if (S.push.x !== 0 || S.push.y !== 0 || S.push.z !== 0) S.reset();
      if (!head) {
        this.shapeIn.headOver = Number.NaN;
        this.shapeIn.deepHead = Number.NaN;
      }
      return;
    }
    // (The crouch's own head read off its clips once a rig, as soon as the rig has them: before the first deep duck, and never
    // from a pose still crossfading into the crouch, which once read 1.51 m and laid the body down under every beam past it.)
    if (head && this.deepRig !== rig) this.measureDeep(rig);
    rig.root.updateMatrixWorld(true);
    S.sample();
    // (Read only standing at full height on the feet, and held while ducked: the figure's head over its standing capsule is the
    // figure's own, and read while the capsule shrinks ahead of the pose's crouch it grew with the shrink and ran the duck down.)
    if (head && this.shapeIn.feet && !this.prone && !this.kneeling && !this.crouching && this.shape.kind !== LYING && this.shape.tall >= STAND_TALL - 1e-3) {
      S.headFeet = this.pos.y;
      S.headTall = this.shape.tall;
      S.headDt = dt;
      S.holdHead();
      if (S.topNow === S.topNow) this.shapeIn.headOver = S.headHeld;
    }
    // (And at the duck's deepest, the crouch's own or the duck's past it, the drawn top over the feet: the crouched walk's own
    // head, which the duck cannot lower and the body lies down for under a roof it cannot pass. Read off the crouch's clips
    // where the rig has them; else live, once the deepest has stood `DEEP_SETTLE` (the crossfade into the crouch done), and
    // never over the standing head.)
    const deep = head && this.shapeIn.feet && !this.prone && !this.kneeling && this.shape.kind !== LYING && (this.crouching || this.shape.share >= DEEP_SHARE || this.shape.bend > 0);
    this.deepFor = deep ? this.deepFor + dt : 0;
    const standing = STAND_TALL + S.headHeld;
    if (head && this.deepClip === this.deepClip) this.shapeIn.deepHead = Math.min(this.deepClip, standing);
    else if (deep && this.deepFor >= DEEP_SETTLE) {
      S.headFeet = this.pos.y;
      S.headDt = dt;
      S.holdDeep();
      if (S.deepHeld > 0) this.shapeIn.deepHead = Math.min(S.deepHeld, standing);
    }
    if (!clear) {
      if (S.push.x !== 0 || S.push.y !== 0 || S.push.z !== 0) S.reset();
      return;
    }
    S.refX = this.pos.x;
    S.refY = this.pos.y + this.colliderOffsetY;
    S.refZ = this.pos.z;
    S.axX = 0;
    S.axZ = 0;
    S.clearOut(this.physics.world as unknown as SphereWorld, SPHERES_TRUNK, STILL_FLAGS, this.moveFilter(), dt, CLIMB_TUNE.clearEase, CLIMB_TUNE.clearMost, true);
    this.duckPushed = S.push.x !== 0 || S.push.z !== 0;
  }

  // ---- wave 4, item B: the wall climb and the hands' bracing -----------------------------------------------------------------

  /**
   * After the move (`WallClimb.sense`): onto a wall. Not swimming, on the rope or in its flight, thrown, dead, at a ship's
   * controls, prone or kneeling, in a wall move or a Force jump's rise, nor on the gravity boots' surface. True where the
   * climb took the body.
   */
  private senseWall(dt: number, input: Input, move: THREE.Vector3, wasGrounded: boolean, atControls: boolean): boolean {
    if (CLIMB_TUNE.wall !== 'on') return false;
    const li = this.fillLedgeIn(dt, input, move, wasGrounded);
    li.busy = this.swimming || this.grapple.out || this.grapple.released || this.flung || this.hp <= 0 || atControls || this.prone || this.kneeling || this.jka.inSpecialJump || (this.jka.isForceJumping && this.vel.y > 0) || (this.aboard !== null && isSurfaceRoom(this.aboard));
    li.airWallMove = !this.grounded && this.jka.airWallMoveOpen(this.pos, this.vel);
    if (!this.wall.sense(this.physics.world as unknown as LedgeWorld, this, li, this.loco.stamina)) return false;
    this.takenByWall();
    return true;
  }

  /** Onto a wall: a fall ends with no harm, the air's and the slope's memories put down, the feet and the hands let go. */
  private takenByWall(): void {
    this.jka.reset();
    this.jka.holdApex(this.pos.y);
    this.anim.drop();
    this.slope.reset();
    this.feet.reset();
    this.drawn.reset();
    this.brace.reset();
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.heading = this.wall.heading;
  }

  /**
   * A frame on the wall (`WallClimb.step`) in place of the movement: the speed classes put down with no regain (the climb
   * drains the pool itself), what is in the hands kept as swimming keeps it, the climb's clips, the figure placed leant
   * into the face, and its hands and feet on it. The frame the climb hands the body to a lip is the hang's.
   */
  private wallFrame(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {
    void world;
    this.loco.idle(0, this.staminaPool);
    this.slope.reset();
    this.feet.reset();
    this.drawn.reset();
    this.saber.holster();
    this.blocking = false;
    this.aiming = false;
    cam.aim = false;
    this.swimming = false;
    this.submerged = false;
    this.lockedHeading = null;
    this.crouching = false;
    this.setCrouchCollider(false);
    const li = this.fillLedgeIn(dt, input, null, false);
    const W = this.wall;
    W.step(this.physics.world as unknown as LedgeWorld, this, li, this.loco.stamina, this.ledge);
    this.clearDt = dt;
    if (W.said) {
      this.onLedgeWords?.(W.said);
      W.said = '';
    }
    // The fall's memory held where the body is: a let-go falls from here, and nothing of the climb hurts.
    this.jka.holdApex(this.pos.y);
    if (W.holding) {
      this.grounded = false;
      this.heading = W.heading;
    } else if (this.ledge.holding) {
      this.grounded = false;
      this.heading = this.ledge.heading;
    } else this.grounded = W.stood;
    this.torsoTwist = 0;
    this.groundSpeed = 0;
    this.moveAmount += (0 - this.moveAmount) * Math.min(1, dt * 10);
    this.updateThrown(dt, input, cam);
    this.updateOrbit(dt);
    this.updateBlades();
    if (this.ledge.holding) {
      this.animateHang(dt);
      this.placeVisual();
      this.placeHangLimbs();
    } else {
      this.animateWall(dt);
      this.placeVisual();
      this.placeWallLimbs();
    }
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
  }

  /** The climb's rate and fade handed to the rig (kept). */
  private readonly wallRate = { rate: 0.5, fade: 0.15 };

  /** The climb's clips on the rig: the jump off's one-off begun, the climb's loop at its rate (held still, the clip that played stops where it is). */
  private animateWall(dt: number): void {
    const rig = this.rig;
    if (!rig) return;
    const W = this.wall;
    if (W.startClip) rig.play(ledgeClipName(W.startClip), { from: W.startFrom, fadeIn: W.startFade, hold: false });
    if (W.rigState) {
      if (W.rigState === 'wallStill') rig.prefer('wallStill', wallClipName(W.rigClip));
      // Climbing II, item 6: sideways the clip the climb says (the braced shimmy of that way under `climb.wallSide` 'shimmy').
      else if (W.rigState === 'wallLeft' || W.rigState === 'wallRight') rig.prefer(W.rigState, WALL_CLIP_NAMES[W.rigClip] ?? wallClipName(W.rigClip));
      this.wallRate.rate = W.rate;
      this.wallRate.fade = CLIMB_TUNE.ease;
      // Climbing II, Smoothness II, item 2: a clip of the climb taken up where its pose is nearest the one it fades from ('blend').
      rig.nearestNext = CLIMB_TUNE.transitions === 'blend';
      rig.setState(W.rigState as RigState, 0, null, this.wallRate);
      rig.nearestNext = false;
    } else rig.setState(W.stood ? 'idle' : 'air', 0, null, this.hangFade);
    rig.update(dt);
    this.group.updateMatrixWorld(true);
    rig.twistTorso(0, 0);
  }

  /** The hands and the feet on the face (`LimbPlace`, through the climb's own face) while on the wall; let go of when off it. */
  private placeWallLimbs(): void {
    const rig = this.rig;
    if (!rig) return;
    const lp = this.limbs;
    if (!this.wall.holding) {
      if (lp.busy) lp.reset();
      return;
    }
    this.group.updateMatrixWorld(true);
    const room = this.aboard;
    const toPhys = room ? this.roomInverse.copy(roomFrame(room)).invert() : null;
    lp.filter = this.moveFilter();
    this.wall.limbsFor(lp, rig, this.physics.world as unknown as LedgeWorld, toPhys);
    this.clearFigure(lp, toPhys);
    lp.place(rig, this.physics.world, toPhys);
    this.settleFigure(lp, toPhys);
  }

  /** The player's own key, kept (the crowd's `fights` asks with it: no closure a frame). */
  private readonly isPlayerKey = (k: number): boolean => k === PLAYER_KEY;
  private readonly crowdAt = new THREE.Vector3();

  /**
   * The bodies near enough to brace on (`Crowd`), refilled from the world's living a frame while asked: every other
   * player, person and creature on this world but one fighting the player (one that would pick a fight on sight, or is
   * fighting or holds a grudge against the player now). Nothing aboard a ship's rooms (their frame is the hull's).
   */
  private gatherCrowd(world: World | null): void {
    const c = this.crowd;
    c.count = 0;
    if (!world || this.aboard || CLIMB_TUNE.brace.people !== 'on') return;
    const list = world.targets();
    const me = world.playerTarget;
    const s = this.ledgeScale();
    const reach = (CLIMB_TUNE.brace.reach + 0.6) * s + 1;
    const at = this.crowdAt;
    at.x = this.pos.x;
    at.y = this.pos.y + CLIMB_TUNE.brace.height * s;
    at.z = this.pos.z;
    for (let k = 0; k < list.length; k++) {
      const t = list[k];
      if (t === me || t.dead || t.key === PLAYER_KEY) continue;
      const dx = t.pos.x - at.x;
      const dz = t.pos.z - at.z;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (hostileSides(t, me) || (t as { fights?(ours: (key: number) => boolean): boolean }).fights?.(this.isPlayerKey)) continue;
      c.add(at.x, at.z, t.pos.x, t.pos.z, t.pos.y, t.pos.y + 2 * t.halfHeight, t.radiusToward(at), reach);
    }
  }

  /**
   * Wave 4, item B: the hands bracing (`HandBrace`), after the figure is placed and its feet put down: on foot (a wall, a
   * passage, the crowd), or drifting in space (`space`: a surface near, stepped along). Asks nothing at all under
   * `brace.rule` 'before' (the wave 3 commit's arms) or while nothing is to be done.
   */
  private placeBrace(dt: number, world: World | null, space: boolean): void {
    const B = this.brace;
    if (CLIMB_TUNE.brace.rule !== 'on' && !B.busy) return;
    const rig = this.rig;
    if (!rig) return;
    const bi = this.braceIn;
    bi.dt = dt;
    bi.x = this.pos.x;
    bi.y = this.pos.y;
    bi.z = this.pos.z;
    bi.heading = this.heading;
    bi.scale = this.ledgeScale();
    bi.filter = this.moveFilter();
    bi.vx = this.vel.x;
    bi.vy = this.vel.y;
    bi.vz = this.vel.z;
    bi.moveX = space ? 0 : move.x;
    bi.moveZ = space ? 0 : move.z;
    // A hand holding something never braces; a gun held in both hands takes the left as well, and the rope the left.
    const twoHanded = !!this.held.right && this.classId === 'bounty_hunter' && !this.fists && this.gunClass !== 'pistol';
    bi.freeR = !this.held.right;
    bi.freeL = !this.held.left && !twoHanded && !this.grapple.out;
    bi.busy = this.climbHolds || this.saber.busy || this.blocking || this.aiming || this.fists || this.thrown.inFlight || rig.overriding || this.prone || this.kneeling || this.swimming || !!this.mounted || this.hp <= 0 || this.flung || this.drawnSink > 0 || this.grapple.attached || this.grapple.released;
    bi.onFeet = !space && this.grounded;
    bi.space = space;
    bi.blocked = !space && this.wallBlocked;
    if (space) {
      evaUp.set(0, 1, 0).applyQuaternion(this.evaFrame);
      evaFwd.set(0, 0, 1).applyQuaternion(this.evaFrame);
      bi.ux = evaUp.x;
      bi.uy = evaUp.y;
      bi.uz = evaUp.z;
      bi.fx = evaFwd.x;
      bi.fy = evaFwd.y;
      bi.fz = evaFwd.z;
    }
    const moving = bi.vx * bi.vx + bi.vz * bi.vz > CLIMB_TUNE.brace.moving * CLIMB_TUNE.brace.moving;
    if (!space && moving && !bi.busy) this.gatherCrowd(world);
    else this.crowd.count = 0;
    B.step(this.physics.world, bi, this.crowd);
    const lp = this.limbs;
    if (!B.busy) {
      if (lp.busy) lp.reset();
      return;
    }
    this.group.updateMatrixWorld(true);
    const room = this.aboard;
    const toPhys = room ? this.roomInverse.copy(roomFrame(room)).invert() : null;
    B.apply(lp);
    lp.filter = bi.filter;
    lp.place(rig, this.physics.world, toPhys);
  }

  /**
   * Stand where you are and breathe: the figure animated with no input, no physics and no camera.
   *
   * This is what the creation and selection screens want. `update` is the whole of being alive --
   * it reads the keys, moves a kinematic body through the character controller, takes the heading
   * off the camera and hurts you for standing in lava -- and none of that belongs on a screen where
   * somebody is choosing a hat. What is left is the part that makes a figure look like a person:
   * the rig's own idle, ticked, and the drawn body put where the rig now is.
   *
   * It is the same quartet the mounted and noclip branches of `update` already use, which is the
   * precedent for it being safe: neither of those steps physics either. Without it the figure is
   * simply frozen, because `CharacterRig.update` is called from nowhere else for the player.
   */
  standStill(dt: number): void {
    this.rig?.stopOverride();
    this.animateRig(dt, 0, false);
    this.placeVisual();
    this.group.updateMatrixWorld(true);
  }

  private animateRig(dt: number, speed: number, moving: boolean, mz = 0, mx = 0): void {
    const rig = this.rig;
    if (!rig) return;
    // The walk key picks the walk clips; the speed only sets how fast a clip plays.
    let running = !this.walkKey;
    const style = this.saber.style;
    const stance = STANCE_ANIM[style];
    // The saber run and walk are the staff's, the dual sabers' or the single saber's (the three single styles share them).
    rig.prefer('runSaber', style === 'staff' ? 'BOTH_RUN_STAFF' : style === 'dual' ? 'BOTH_RUN_DUAL' : 'BOTH_RUN2');
    rig.prefer('walkSaber', style === 'staff' ? 'BOTH_WALK_STAFF' : style === 'dual' ? 'BOTH_WALK_DUAL' : 'BOTH_WALK2');
    // Under the speed classes with Jedi Academy's legs (a block, a swing under way) the body keeps the class's speed,
    // and the legs are that game's saber walk where the speed is nearer the walk's own than the run's, its run from
    // there up (`LOCO_TUNE.fight.walkUnder` of the point where the two are equally far from their own rates): the run
    // at the jog's pace would play under the half rate a clip is held above, its feet sliding.
    if (this.jkaMode && this.loco.rules && this.loco.moves) {
      const from = this.saberRunFrom;
      if (from.rig !== rig || from.style !== style) {
        from.rig = rig;
        from.style = style;
        from.forward = Math.sqrt((rig.naturalSpeed('walkSaber') ?? 0) * (rig.naturalSpeed('runSaber') ?? 0));
        from.back = Math.sqrt((rig.naturalSpeed('walkBack') ?? 0) * (rig.naturalSpeed('runBack') ?? 0));
      }
      running = this.loco.cls > 1 && this.loco.speed >= (this.directional && mz < 0 ? from.back : from.forward) * LOCO_TUNE.fight.walkUnder;
    }
    // The kind of blaster picks its carries: the pistol's stand at the side, the rifle's across the chest.
    const gun = this.gunKind;
    const armed = this.classId === 'bounty_hunter' && this.hasGunClips && !this.fists;
    for (const [state, n] of [['Idle', 0], ['Walk', 1], ['Run', 2]] as const) {
      rig.prefer(`gun${state}`, new RegExp(gun === 'pistol' ? `^loop_pistol_standing:speed${n}` : `^loop_rifle:speed${n}`));
    }
    // The table's one combat stance (loop_combat_standing) is the unarmed one, fists up: with a blaster
    // the combat carry keeps the gun's own carry and turns to face the camera, until the game's state
    // hierarchy tells which loop it plays there.
    // The state hierarchy names loop_<kind>_combat_standing_aimed as the combat and aimed loops: those when
    // the table has them, else the relaxed carry.
    // The state hierarchy: the pistol's combat and aimed states both idle with loop_pistol_combat_standing_aimed,
    // the rifle's with loop_rifle_a_combat_standing_aimed; those when the table has them, else the relaxed carry.
    // The combat loop may be a single clip rather than a speed set: then it is the combat idle, and while
    // moving it rides the upper body over the relaxed walk or run.
    // The legs (and the arms when nothing rides them) are the relaxed carry's idle, walk and run for every
    // carry; the hip-fire and aimed poses ride the upper body over them, so the legs never sway them.
    for (const [state, n] of [['Idle', 0], ['Walk', 1], ['Run', 2]] as const) {
      const relaxed = new RegExp(gun === 'pistol' ? `^loop_pistol_standing:speed${n}$` : `^loop_rifle:speed${n}$`);
      rig.prefer(`gunReady${state}`, relaxed);
      rig.prefer(`gunAim${state}`, relaxed);
    }
    for (const [state, n] of [['Idle', 0], ['Move', 1]] as const) {
      rig.prefer(`gunProne${state}`, new RegExp(`^loop_${gun}_prone:speed${n}`));
      rig.prefer(`gunProneReady${state}`, new RegExp(`^loop_${gun}_combat_prone:speed${n}`));
      rig.prefer(`gunProneAim${state}`, new RegExp(`^loop_${gun}_combat_prone_aimed:speed${n}`));
    }
    // Kneeling keeps the relaxed kneel underneath; the poses ride its upper body like the standing ones.
    rig.prefer('kneel', armed ? new RegExp(`^loop_${gun}_kneeling`) : null);
    // The poses on the upper body. Aimed: the table's aimed loop when it has one, else the transition into
    // the aimed pose held at its end (the pistol's, the rifle's ready-to-aimed, kneeling's own). Hip fire
    // (the combat carry after a shot): the pistol's one-handed riding carry (loop_pistol_riding, held at
    // chest height), the rifle's "ready" pose, which the table has only as the end of its transitions
    // (hold-to-ready, or aimed-to-ready when the aim has just ended), so those are held at their ends.
    const armedUp = armed && !this.prone && !this.swimming;
    let gunUpper: string | null = null;
    if (armedUp && this.aiming) {
      gunUpper = this.kneeling
        ? rig.firstOf(...rig.clipsMatching(new RegExp(`^loop_${gun}_(combat_kneeling|kneeling_combat)_aimed`)), `trn_${gun}_combat_kneeling_to_${gun}_combat_kneeling_aimed`)
        : rig.firstOf(...rig.clipsMatching(new RegExp(`^loop_${gun}(_a)?_combat_standing_aimed(:speed0)?$`)), gun === 'pistol' ? 'trn_pistol_combat_to_pistol_combat_aimed' : 'trn_rifle_a_standing_ready_to_aimed');
      this.readyPose = null;
    } else if (armedUp && this.gunReady) {
      if (!this.readyPose || !this.readyPose.includes(gun)) {
        this.readyPose = gun === 'pistol'
          ? rig.firstOf('loop_pistol_riding', ...rig.clipsMatching(/^loop_pistol_combat_standing_aimed/))
          : rig.firstOf(this.wasAiming ? 'trn_rifle_a_standing_aimed_to_ready' : 'trn_rifle_a_standing_hold_to_ready', 'loop_rifle_riding');
      }
      gunUpper = this.readyPose;
    } else this.readyPose = null;
    // The pistol's way down from the aim plays once before its hip-fire pose takes over.
    if (armedUp && this.wasAiming && !this.aiming && gun === 'pistol') {
      const out = rig.firstOf(this.kneeling ? 'trn_pistol_combat_kneeling_aimed_to_pistol_combat_kneeling' : 'trn_pistol_combat_standing_aimed_to_pistol_combat_standing');
      if (out) rig.playUpper(out, 0.08);
    }
    this.wasAiming = this.aiming;
    // A swing while moving, or in the air: the legs keep what they were doing (Jedi Academy's run,
    // walk, back-pedal or angled strafe, or the jump) under the swing on the upper body, the way
    // that game plays its torso and legs apart; standing still, the swing has the whole body.
    // The specials (katas, kicks, lunges, the jump attacks) move the legs themselves and keep the whole body.
    if (rig.overridingJka && this.saber.busy && this.saber.current.kind !== 'special' && !this.jka.rolling && !this.jka.inSpecialJump && (moving || !this.grounded) && !this.mounted && !this.swimming) rig.overrideUpperOnly();
    // The speed classes' legs (`BodyLoco.legs`): the imported clip for the way the keys go and the class, on a body
    // moving on its feet with Jedi Academy's animations not in charge, and the rate that keeps its feet on the ground.
    // Null leaves every state below the clip it always had. While the classes are in force a change of the legs' clip
    // fades by the tune: between two of their clips (in step), to and from standing, and into and out of Jedi Academy's legs.
    // Crouched or prone under the classes (wave 2b, `loco.posture`) the legs are the classes' too.
    // The stairs wave: the stairs as measured after this frame's move, how far it took the body along them, and the legs'
    // clip's time, for one step a stair (`BodyLoco.legs`).
    this.stairLoco();
    this.locoIn.stairMoved = this.stairMoved;
    this.stairMoved = 0;
    const stepPick = this.loco.pick;
    this.locoIn.legTime = stepPick !== null && rig.readTime(stepPick.clip) ? rig.timeOut : Number.NaN;
    const onFeet = moving && this.grounded && !this.mounted && !this.swimming && !this.kneeling && (this.loco.posture !== STAND || (!this.prone && !this.crouching));
    this.locoIn.ground = speed;
    const legs = this.loco.legs(onFeet ? rig : null, this.locoIn, this.jkaMode);
    // How long this frame's change of the legs' clip fades (`BodyLoco.fadeFor`), handed on with the state.
    this.loco.fadeFor(legs !== null, this.jkaMode, moving);
    this.legOpts.rate = this.loco.rate;
    this.legOpts.fade = this.loco.fadeNow;
    this.fadeOpts.fade = this.loco.fadeNow;
    const fo = this.loco.on ? this.fadeOpts : undefined;
    // The state the classes' clip is asked for keeps it only while they have the legs (`BodyLoco.prefers`): let go
    // of, the state picks its own clip again, there and then (the classes switched off on the move). A blaster's
    // states are asked for their own carries afresh every frame, above, and need no letting go.
    const dropped = this.loco.prefers(legs && !armed ? legs.state : null);
    if (dropped) rig.prefer(dropped as RigState, null, true);
    // The hold that keeps a pose on the upper body steady over moving legs comes on and goes over the legs' own
    // fade to and from standing (a strafe's hips stand turned, and taken off the torso in one frame the turn swung an
    // aimed barrel off the crosshair at every start and stop); at once, as it always was, without the classes.
    rig.steadyEase = this.loco.on ? LOCO_TUNE.fade.idle : 0;
    if (this.mounted) {
      // Seated the way the game seats a rider on this vehicle: its rider pose's branch of the
      // riding loop (a speeder bike's crouch, a landspeeder's seat, the hover chair, the pilot's chair), else the default saddle.
      rig.prefer('seated', this.seatedClip());
      rig.setState('seated');
    }
    // Swimming with the block held: the stance on the torso and arms over the swimming legs. Still in the water, the
    // imported tread when the rig has it (said outright, since adrift in space prefers another loop for the same state).
    else if (this.swimming) {
      rig.prefer('float', MX.tread);
      // Still under the water the tread too, under the owner's rule (`ANIM_TUNE.swim.rule`); the swimming stroke before.
      rig.setState(moving || (this.submerged && ANIM_TUNE.swim.rule !== 'owner') ? 'swim' : 'float', speed, this.blocking && this.hasJkaClips ? stance : null);
    }
    else if (!this.grounded) {
      // In the air. Thrown from a wreck: the imported long fall, else flailing (the swimming stroke) all the way down.
      // Otherwise the imported falling loop, or the float after a flip or a Force jump, and Jedi Academy's own in-air
      // pose with its animations in charge or without the imported clips.
      // On the rope (attached, the feet off the ground) and how fast the body falls: what the owner's air rule reads.
      this.anim.rope = this.grapple.attached;
      this.anim.vy = this.vel.y;
      const loop = this.anim.air(rig, this.jkaActing);
      if (this.flung && !loop) rig.setState('swim', 3);
      else {
        rig.prefer('air', loop ?? this.jumpClip('INAIR', this.jka.isForceJumping));
        // Sliding down a face too steep to stand on, the falling loop comes in over the slope's own fade (wave 2b).
        this.slideFade.fade = LOCO_TUNE.slope.fade;
        rig.setState('air', 0, null, this.slope.sliding ? this.slideFade : undefined);
      }
    }
    else if (this.prone) {
      // Lying down: a blaster has its own prone carries, else the game's crawl; under the classes (wave 2b) the class's
      // crawl at the rate that keeps it on the ground (`legs`, none with a blaster in hand).
      if (armed) rig.setState(`${this.aiming ? 'gunProneAim' : this.gunReady ? 'gunProneReady' : 'gunProne'}${moving ? 'Move' : 'Idle'}` as RigState, speed);
      else if (legs) {
        rig.prefer(legs.state, legs.clip);
        rig.setState(legs.state, speed, null, this.legOpts);
      } else rig.setState(moving ? 'proneMove' : 'prone', speed);
    } else if (this.kneeling) rig.setState('kneel', 0, gunUpper);
    else if (this.crouching || this.duck.crouch) {
      // Crouched (item 4: or ducked to `crouchAt`): the game's own loop_crouched clips unless Jedi Academy's animations are in charge.
      const swg = !this.jkaMode && !!rig.clipMatching(/^loop_crouched:speed1/);
      // The classes' crouched clips were preferred last frame and are not now (a blaster in hand, whose states the
      // classes' let-go does not reach): each state picks its own again there and then (only ever true under the classes).
      if (this.crouchPreferred && !legs) {
        rig.prefer('crouchWalk', null, true);
        rig.prefer('crouchWalkBack', null, true);
        this.crouchPreferred = false;
      }
      rig.prefer('crouch', swg ? /^loop_crouched:speed0/ : null);
      rig.prefer('crouchWalk', swg ? /^loop_crouched:speed1/ : null);
      rig.prefer('crouchWalkBack', swg ? /^loop_crouched:speed1/ : null);
      if (legs) {
        // Under the classes (wave 2b): the class's crouched clip for the way, at the rate that keeps its feet down.
        rig.prefer(legs.state, legs.clip);
        rig.setState(legs.state, speed, gunUpper, this.legOpts);
        this.crouchPreferred = true;
      } else rig.setState(moving ? (this.directional && mz < 0 ? 'crouchWalkBack' : 'crouchWalk') : 'crouch', speed, gunUpper);
    }
    else if (moving && this.directional && mz < 0) {
      // Backing up with the legs facing forward: the back-pedal clip.
      rig.setState(running && rig.hasState('runBack') ? 'runBack' : rig.hasState('walkBack') ? 'walkBack' : 'runBack', speed, null, fo);
    } else if (!moving && this.hasJkaClips && (this.blocking || this.thrown.inFlight)) {
      // Standing with the block held: the style's stance; the arm out while the saber flies.
      rig.prefer('stance', this.thrown.inFlight ? 'BOTH_SABERPULL' : stance);
      rig.setState('stance', 0, null, fo);
    } else if (armed) {
      // The blaster carries: relaxed, combat after a shot, or aimed (the combat legs under the held aimed pose); each with its idle, walk and run.
      const carry = this.aiming ? 'gunAim' : this.gunReady ? 'gunReady' : 'gun';
      const state = `${carry}${!moving ? 'Idle' : running ? 'Run' : 'Walk'}` as RigState;
      if (legs) {
        // Under the speed classes the legs are the classes' clip, and the upper body the gun's own: its ready or aimed
        // pose as ever, else its relaxed carry (the standing one, held steady over the legs as those poses are), or with
        // the tune's 'full' for this kind of gun none, the clip having the whole body (`BodyLoco.carry`). Its 'original'
        // hands no legs (`legs` null) and takes the line below, the state's own carry walk or run.
        rig.prefer(state, legs.clip);
        rig.setState(state, speed, gunUpper ?? (this.loco.carry === CARRY_FULL ? null : this.gunCarry(rig, gun)), this.legOpts);
      } else rig.setState(state, speed, gunUpper, fo);
    } else if (!moving) rig.setState('idle', 0, null, fo);
    // Moving with the block held: Jedi Academy's saber run and walk; otherwise the game's own, saber lit or not.
    else if (this.jkaMode) rig.setState(running ? 'runSaber' : 'walkSaber', speed, null, fo);
    else if (legs) {
      // The speed classes: the imported clip for the way and the class, at the rate that matches the ground.
      rig.prefer(legs.state, legs.clip);
      rig.setState(legs.state, speed, null, this.legOpts);
    } else rig.setState(running ? 'run' : 'walk', speed, null, fo);
    // The feedback round, item 4: ducked under something, the crouch's share of the pose, laid on by the mixer (`stepDuck`).
    const ducks = MOVE_TUNE.duck === 'on' && this.shape.kind !== LYING;
    if (ducks && this.shape.share > 0 && !this.duck.crouch) {
      rig.duckWant = this.shape.share;
      rig.duckMoving = moving;
    }
    // The stairs wave: a stair cycle just taken on starts where its next footfall lands on a tread (`StairStep`'s snap).
    if (legs && this.loco.snap === this.loco.snap) rig.setTime(legs.clip, this.loco.snap);
    rig.update(dt);
    this.group.updateMatrixWorld(true);
    // Always called: with no twist it puts the spine's clip pose back.
    // With a blaster up the torso also tilts to where the camera looks, so the barrel follows the crosshair.
    const gunUp = this.classId === 'bounty_hunter' && !this.prone && !this.swimming && !this.mounted && !this.fists && (this.aiming || this.gunReady);
    const wantedPitch = gunUp ? -Math.asin(THREE.MathUtils.clamp(this.lookDir.y, -1, 1)) : 0;
    this.torsoPitch += (wantedPitch - this.torsoPitch) * Math.min(1, dt * 10);
    // Aiming standing (not crouched, kneeling or prone) the torso also turns right by the tuned angle, since the
    // game's aimed poses point the arm off to the left of the body; the legs keep facing the camera.
    const tune = this.gunTune[this.gunClass];
    const low = this.crouching || this.kneeling;
    // The tuned turn is the starting point only while the barrel is not measured (`aimFix.on` off).
    const wantedTwist = armedUp && !this.aimFix.on ? (this.aiming ? -(low ? tune.aimKneel : tune.aim) : this.gunReady ? -tune.ready : 0) * (Math.PI / 180) : 0;
    this.aimTwist += (wantedTwist - this.aimTwist) * Math.min(1, dt * 10);
    // A whole-body Jedi Academy clip is left alone; a swing on the upper body alone takes the twist, so the torso faces the camera over angled legs.
    const wholeJka = rig.overridingJka && !rig.overridingUpperOnly;
    // The measured correction: the spine takes the first part of it, the body's heading the rest (a kneeling
    // shooter's pose is authored with the hips turned from the target, which a spine twist cannot give).
    // Under the speed classes' legs the spine takes more of it (`aimSpineMax`), so the body stays where its legs' clip
    // needs it: the legs then carry it the way it really goes, and the heading other players are sent is the legs' own.
    const wideSpine = Math.max(AIM_SPINE_MAX, (LOCO_TUNE.turn.aimSpine * Math.PI) / 180);
    this.aimSpineMax = legs ? wideSpine : AIM_SPINE_MAX;
    // The spine's share changes the moment the classes' legs come or go, and the body comes round to its new share
    // over a few frames. With the classes in force the spine takes whatever of the correction the body does not
    // stand turned by just now (`aimBodyNow`), up to its wider limit, so the two always add up to the correction and
    // the barrel holds through every start and stop; without them the spine's share is the game's own, as before.
    const spineFix = this.loco.on && gunUp ? THREE.MathUtils.clamp(this.aimFix.yaw - this.aimBodyNow, -wideSpine, wideSpine) : THREE.MathUtils.clamp(this.aimFix.yaw, -this.aimSpineMax, this.aimSpineMax);
    // Seated, the spine keeps the clip's own pose: no view-following twist or aim tilt carried over from on foot.
    const straight = wholeJka || !!this.mounted;
    // The feedback round, item 4: past the crouch's own height the spine bends forward (`duckBend` at the deepest duck) and
    // the neck with it (`duckNeck`), laid after the mixer, put back before its next update; the first-person eye reads the head.
    const duckBend = ducks && !straight ? this.shape.bend : 0;
    let pitch = straight ? 0 : this.torsoPitch + this.aimFix.pitch;
    if (duckBend > 0) pitch += (duckBend * MOVE_TUNE.duckBend * Math.PI) / 180;
    rig.twistTorso(straight ? 0 : this.torsoTwist + this.aimTwist + spineFix, pitch);
    if (duckBend > 0) rig.bendNeck((duckBend * MOVE_TUNE.duckNeck * Math.PI) / 180);
    // Climbing II, Smoothness II, items 3 and 4: the drawn top handed to the duck, and a ducked figure out of what is beside it.
    this.duckFigure(dt, rig, ducks && (this.shape.share > 0 || this.shape.bend > 0));
    // An imported clip posing the arms (the jump's start, a loop of the air, a landing) holds the gun wherever the clip
    // has it, so the barrel says nothing of the aim while it plays.
    this.correctAim(dt, gunUp, rig.armSource().startsWith('mx_'));
    // The hilt turns in the hand to whichever convention poses the arms: the game's own clips
    // hold it their way, Jedi Academy's the way its swings were made for.
    // The hilt's axis: the solved one through Jedi Academy's one-off clips (its swings, katas, throws),
    // the bind-pose guess for everything held (its stances, runs and walks, and the game's own clips):
    // the stances read right with the guess and the swings with the solve, whatever the maths says.
    const jkaArms = rig.armSource().startsWith('BOTH_') && rig.overridingJka;
    this.gripBlend += ((jkaArms ? 1 : 0) - this.gripBlend) * Math.min(1, dt * 14);
    // The console's calibration: a turn about the forearm for every Jedi Academy clip, and one more for its held poses.
    const roll = ((this.gripTune.jkaRoll + (jkaArms && !rig.overridingJka ? this.gripTune.stanceRoll : 0)) * Math.PI) / 180;
    gripQ.copy(this.saberQ.jka);
    if (roll !== 0) gripQ.premultiply(rollQ.setFromAxisAngle(forearmAxis.copy(this.forearm), roll));
    this.parts.saber.quaternion.slerpQuaternions(this.saberQ.swg, gripQ, this.gripBlend);
    gripQ.copy(this.saber2Q.jka);
    if (roll !== 0) gripQ.premultiply(rollQ.setFromAxisAngle(forearmAxis.copy(this.forearm2), roll));
    this.parts.saber2.quaternion.slerpQuaternions(this.saber2Q.swg, gripQ, this.gripBlend);

    if (this.mounted) {
      // The riding and sitting clips pose the whole arm themselves -- every species' rig carries 45 of
      // them, each authoring the shoulder, the elbow and the hand on the bars, the yoke or the reins.
      // Both arms used to be aimed straight ahead here on top of them, left over from the placeholder
      // rig the first mounts were built on, which locked the elbows and held the hands out in front of
      // every rider and pilot. The branch stays so a rider takes none of the aims below either.
    } else if (this.classId === 'bounty_hunter' && !this.hasGunClips) {
      rig.aimArm('right', armDir.set(-0.15, 0.02, 0.99).normalize());
      rig.aimArm('left', armDir.set(0.2, -0.1, 0.95).normalize());
    } else if (rig.overriding || this.hasJkaClips) {
      // Jedi Academy's clips pose the whole body themselves.
    } else if (this.swing >= 0) {
      const t = this.swing;
      const e = t < 0.3 ? t / 0.3 : 1;
      const s = t < 0.3 ? 0 : Math.min(1, (t - 0.3) / 0.45);
      const eased = s * s * (3 - 2 * s);
      // Raise up and back, then chop down and across the body.
      armDir.set(-0.35 + 0.15 * e, 0.1 + 0.85 * e, 0.3 - 0.6 * e);
      armDir.lerp(new THREE.Vector3(0.55, -0.45, 0.7), eased).normalize();
      rig.aimArm('right', armDir, -0.6 * eased);
    } else if (this.saberOn) {
      rig.aimArm('right', armDir.set(-0.45, -0.55, 0.7).normalize());
    }
    // The left arm up the grapple's rope, over whatever the chain above did or left alone, while its weight is up.
    if (this.grapple.armWeight > 0 && !this.mounted) this.aimGrappleArm(rig);
  }

  /**
   * Measure the barrel (the rack gun's grip to its muzzle, or the placeholder rifle's) against where the
   * camera looks, and fold the difference into the torso's turn and tilt for the next frame. Off, the
   * correction eases away. A shot's recoil is not chased.
   */
  private correctAim(dt: number, gunUp: boolean, importedArms = false): void {
    const fix = this.aimFix;
    if (!gunUp || this.mounted || !fix.on) {
      fix.yaw += (0 - fix.yaw) * Math.min(1, dt * 8);
      fix.pitch += (0 - fix.pitch) * Math.min(1, dt * 8);
      return;
    }
    if (this.sinceShot < 0.35) return;
    // Held where it stands, as through a shot, while an imported clip has the arms: measured against a barrel the
    // clip is swinging, the correction wound up and turned the whole body up to a right angle off the view through a
    // hop's landing.
    if (importedArms) return;
    const right = this.reach.right;
    if (right && this.held.right) {
      right.near.getWorldPosition(barrelA);
      right.far.getWorldPosition(barrelB);
    } else {
      this.parts.rifle.getWorldPosition(barrelA);
      this.parts.muzzle.getWorldPosition(barrelB);
    }
    barrelB.sub(barrelA);
    if (barrelB.lengthSq() < 1e-6) return;
    barrelB.normalize();
    const look = this.lookDir;
    let dYaw = Math.atan2(look.x, look.z) - Math.atan2(barrelB.x, barrelB.z);
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    const dPitch = Math.asin(THREE.MathUtils.clamp(look.y, -1, 1)) - Math.asin(THREE.MathUtils.clamp(barrelB.y, -1, 1));
    // A turn to the left is positive; a tilt forward and down is positive, so the pitch runs the other way.
    const gain = Math.min(1, dt * 12);
    fix.yaw = THREE.MathUtils.clamp(fix.yaw + dYaw * gain, -2.2, 2.2);
    fix.pitch = THREE.MathUtils.clamp(fix.pitch - dPitch * gain, -0.8, 0.8);
  }

  /** The part of the aim's correction the spine cannot take, turned into the whole body's facing. */
  private get aimBodyTurn(): number {
    return this.aimFix.yaw - THREE.MathUtils.clamp(this.aimFix.yaw, -this.aimSpineMax, this.aimSpineMax);
  }

  /**
   * How far the spine turns for the aim before the rest goes on the body's facing, radians, this frame: the game's own
   * limit, and under the speed classes' legs the tune's wider one. An imported clip keeps the hips square to the way
   * the body faces, where the game's own gun carries stand side-on; the aimed pose on the upper body was made for
   * those, so over the imported legs it needs about twice the turn, and a body turned for it would cross its own legs.
   */
  private aimSpineMax = AIM_SPINE_MAX;
  /**
   * How far the body stands turned from the view for the aim just now, radians: its heading less the view's and the
   * clip's own turn, written each frame the body faces the view with a blaster up and nought otherwise. (Declared as
   * a fraction: it holds one.)
   */
  private aimBodyNow = 1e-9;

  /**
   * The feedback round, item 3 (`proneShape` 'lying'): whether the body lies prone after a press that asked `want`. Lying down
   * is refused in words with the grappling rope out (its collider sync stands the capsule upright), in water deeper than the
   * body lies, and where the lying capsule does not fit; getting up, where the upright capsule it gets up into (the crouch's
   * with the duck on, the crouch held or a kneel asked, else standing) does not, and it stays down.
   */
  private proneAsk(want: boolean, input: Input): boolean {
    const w = this.physics.world as unknown as ShapeWorld;
    const S = this.shape;
    if (want === this.prone) return want;
    if (want) {
      if (this.grapple.out || this.grapple.released) S.said = S.last = 'Not with the grappling rope out.';
      else if (this.waterDepth > 2 * MOVE_TUNE.lyingRadius) S.said = S.last = 'Too deep to lie down here.';
      else if (S.mayLie(w, this.pos.x, this.pos.y, this.pos.z, this.heading, this.ledgeScale(), this.moveFilter())) return true;
      if (S.said) this.onLedgeWords?.(S.said);
      S.said = '';
      return false;
    }
    const tall = MOVE_TUNE.duck === 'on' || input.held('crouch') || this.kneeling ? CROUCH_TALL : STAND_TALL;
    if (S.mayRise(w, this.pos.x, this.pos.y, this.pos.z, tall, this.moveFilter())) return false;
    if (S.said) this.onLedgeWords?.(S.said);
    S.said = '';
    return true;
  }

  /**
   * The feedback round, items 3 and 4: the capsule as the body's shape decides it this frame (`src/player/bodyShape.ts`):
   * lying along the heading while prone under 'lying', else upright, ducked under what stands over the body and ahead along
   * its travel (on its feet with the duck on), crouched by the key, kneeling and (under 'crouch') prone on the ground, or
   * standing. Written onto the collider, and its middle kept for everything that reads the worn capsule.
   */
  private stepShape(dt: number, moving: boolean, move: THREE.Vector3): void {
    const S = this.shape;
    const w = this.physics.world as unknown as ShapeWorld;
    const lying = this.prone && MOVE_TUNE.proneShape === 'lying';
    const f = this.shapeIn;
    f.dt = dt;
    f.x = this.pos.x;
    f.y = this.pos.y;
    f.z = this.pos.z;
    f.heading = this.heading;
    f.scale = this.ledgeScale();
    f.filter = this.moveFilter();
    this.groundPlaneInto(f);
    if (lying) S.holdLying(f, this.collider);
    else {
      f.vx = this.vel.x;
      f.vz = this.vel.z;
      f.moveX = moving ? move.x : 0;
      f.moveZ = moving ? move.z : 0;
      // On its feet on the ground: never in the air, swimming, prone or kneeling, riding, at the controls, on the rope,
      // aboard the boots' surface, sliding down a face, nor with the placing hand holding something.
      f.feet = this.grounded && !this.swimming && !this.prone && !this.kneeling && !this.mounted && !this.piloting && !this.noclip && !this.grapple.attached && !this.grapple.released && !this.slope.sliding && !(this.aboard !== null && isSurfaceRoom(this.aboard)) && !(this.handPlacing?.() ?? false);
      f.crouch = (this.crouching || this.prone || this.kneeling) && this.grounded;
      f.lying = false;
      // The slope under the feet (the slope rule's plane, last judged): how far the floor rises under the capsule's rim.
      const pny = this.slope.planeNy;
      const pt = pny > 0.1 ? Math.sqrt(this.slope.planeNx * this.slope.planeNx + this.slope.planeNz * this.slope.planeNz) / pny : 0;
      f.rise = pt > 0 ? (pt < 1 ? pt : 1) * 0.35 : 0;
      S.stepUpright(w, f, this.collider);
      // Climbing II's smoothness round, item 4: a roof ahead too low for the deepest duck, and a lying body fits here: the
      // duck lays the body down along its heading, to crawl under it (`BodyShape.lieAhead`, asked only under 'height'). Never
      // where Z would refuse it (`proneAsk`, said nothing: nobody asked): with the grappling rope out, or in water deeper than
      // the body lies, where the stand-up rule would stand it again the frame after.
      if (S.lieAhead && !this.prone && !this.grapple.out && !this.grapple.released && !(this.waterDepth > 2 * MOVE_TUNE.lyingRadius)) {
        this.prone = true;
        this.kneeling = false;
        this.duck.lying = true;
        this.duck.laid++;
        S.holdLying(f, this.collider);
      }
    }
    this.colliderOffsetY = S.offsetY;
    this.colliderCrouched = null;
  }

  /**
   * Climbing II's smoothness round, item 4, after the shape: a body the duck laid down crouches no more, and the duck's pace
   * and clips from the height the shape wrote (`DuckPace.step`: on its feet only, the crouch key's own crouch eased on toward
   * the crawl's in a tunnel).
   */
  private stepDuckPace(): void {
    if (this.prone) this.crouching = false;
    this.duck.step(this.shape.tall, !this.prone && this.shape.kind !== LYING && this.shapeIn.feet, this.crouching, this.shape.duckCls);
  }

  /**
   * Item 4: a body the duck laid down gets up into a crouch (`riseAt` tall) where `BodyShape.riseClear` finds the room over its
   * feet and no roof ahead along its way; the duck stands it the rest of the way as the room allows.
   */
  private riseFromDuck(moving: boolean, move: THREE.Vector3): void {
    const S = this.shape;
    const f = this.shapeIn;
    f.x = this.pos.x;
    f.y = this.pos.y;
    f.z = this.pos.z;
    f.heading = this.heading;
    f.scale = this.ledgeScale();
    f.filter = this.moveFilter();
    f.vx = this.vel.x;
    f.vz = this.vel.z;
    f.moveX = moving ? move.x : 0;
    f.moveZ = moving ? move.z : 0;
    if (!S.riseClear(this.physics.world as unknown as ShapeWorld, f)) return;
    this.prone = false;
    this.duck.lying = false;
    this.duck.rose++;
    S.writeUpright(this.collider, this.pos.x, this.pos.y, this.pos.z, MOVE_TUNE.riseAt);
    this.colliderOffsetY = S.offsetY;
  }

  /**
   * After the heading is decided, a lying body's turn (item 3): the capsule turned with it where it fits, slid out of what it
   * met where that clears it, else the turn refused for this frame. Nothing while the heading holds still.
   */
  private turnLying(): void {
    const S = this.shape;
    if (S.kind !== LYING || !this.prone) return;
    const w = this.physics.world as unknown as ShapeWorld;
    const f = this.shapeIn;
    f.x = this.pos.x;
    f.y = this.pos.y;
    f.z = this.pos.z;
    f.heading = this.heading;
    f.scale = this.ledgeScale();
    f.filter = this.moveFilter();
    this.groundPlaneInto(f);
    S.turnLyingIn(w, f, this.collider);
    if (S.slideX !== 0 || S.slideZ !== 0) {
      this.pos.x += S.slideX;
      this.pos.z += S.slideZ;
      this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    }
    this.heading = S.lyingYaw;
  }

  /** The ground's plane under the feet as the slope rule last judged it, into the shape's frame (a lying capsule lies along it). */
  private groundPlaneInto(f: ShapeIn): void {
    f.nx = this.slope.planeNx;
    f.ny = this.slope.planeNy;
    f.nz = this.slope.planeNz;
  }

  /** How far the body reaches toward a point across the ground (`PlayerTarget.radiusToward`): the lying capsule's along its length. */
  reachToward(at: THREE.Vector3): number {
    return this.shape.reachToward(at.x, at.z, this.worldPos.x, this.worldPos.z);
  }

  /** The capsule shrinks to the crouch height while ducking (its feet stay where they are). */
  private setCrouchCollider(crouched: boolean): void {
    if (crouched === this.colliderCrouched) return;
    // The body's shape left it lying (item 3): upright again before today's rule writes it.
    if (this.shape.kind === LYING) this.shape.writeUpright(this.collider, this.pos.x, this.pos.y, this.pos.z, STAND_TALL);
    this.shape.followCrouch(crouched);
    this.colliderCrouched = crouched;
    const half = crouched ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    this.collider.setHalfHeight(half);
    this.collider.setTranslationWrtParent({ x: 0, y: CAPSULE_RADIUS + half, z: 0 });
    // Kept, so the grapple's collider sync puts the capsule at its own offset and never reads the engine.
    this.colliderOffsetY = CAPSULE_RADIUS + half;
    // The offset only reaches the collider's world position at the next physics step; placing it now
    // keeps this frame's ground test from seeing the new capsule at the old centre (and flickering).
    this.collider.setTranslation({ x: this.pos.x, y: this.pos.y + CAPSULE_RADIUS + half, z: this.pos.z });
  }

  /**
   * Movement keeps pace with the clip that plays for it, so the feet stay planted: walking is
   * as fast as the walk clip travels (SWG's own, or Jedi Academy's saber walk with the block
   * held), crouch-walking as its clip, and backing up with the block held a touch slower than
   * the run, as its back-pedal is. Returns the factor on Jedi Academy's own speed for the keys.
   */
  private paceScale(walking: boolean, mz: number, mx: number): number {
    const rig = this.rig;
    if (!rig || this.swimming || !this.grounded || (!mz && !mx)) return 1;
    const crouch = this.crouching;
    // The prone crawl and a crouch on the game's own clip are paced by the clip; the base is what the keys would give.

    const base = JKA.speed * UNIT * (walking ? JKA.walkScale : 1) * (crouch ? JKA.duckScale : 1);
    const back = this.directional && mz < 0;
    let target: number | null = null;
    // Crouched: with the walk key the crouch walk's own pace; without it the game's crouched walk speed, a little quicker.
    // Jedi Academy's clips were made for less than its speeds (it lets the feet slide), so the
    // paces taken from them are held within bands of the game's own speed.
    if (this.prone) target = Math.max(0.3, rig.naturalSpeed(this.classId === 'bounty_hunter' && this.hasGunClips ? (this.aiming ? 'gunProneAimMove' : this.gunReady ? 'gunProneReadyMove' : 'gunProneMove') : 'proneMove') ?? 0.6);
    // Crouched the game's way: the crawl clip's own pace, halved with the walk key (the clip slows with it).
    else if (crouch && !this.jkaMode && rig.clipMatching(/^loop_crouched:speed1/)) target = Math.max(0.5, rig.naturalSpeed('crouchWalk') ?? 1.5) * (walking ? JKA.walkScale : 1);
    else if (crouch) target = walking ? Math.max(rig.naturalSpeed(back ? 'crouchWalkBack' : 'crouchWalk') ?? 0, 0.8) : base * JKA.walkScale;
    else if (walking && this.classId === 'bounty_hunter' && this.hasGunClips) target = Math.max(rig.naturalSpeed(this.aiming ? 'gunAimWalk' : this.gunReady ? 'gunReadyWalk' : 'gunWalk') ?? 0, 0.8);
    else if (walking) target = Math.max(rig.naturalSpeed(this.jkaMode ? (back ? 'walkBack' : 'walkSaber') : 'walk') ?? 0, this.jkaMode ? 1.2 : 0.8);
    else if (this.jkaMode && back) target = THREE.MathUtils.clamp(rig.naturalSpeed('runBack') ?? base, base * 0.5, base * BLOCK_RUN_SCALE);
    // Running with the block held: the saber run's own pace, within a band under the full run.
    else if (this.jkaMode && this.blocking) target = THREE.MathUtils.clamp(rig.naturalSpeed('runSaber') ?? base, base * 0.65, base * BLOCK_RUN_SCALE);
    return target && target > 0.3 ? target / base : 1;
  }

  /**
   * The jump, in-air or landing clip for the current jump's direction, the force version when
   * asked (PM_ForceJumpAnimForJumpAnim), falling back to the plain forward one the rig has.
   */
  private jumpClip(base: 'JUMP' | 'INAIR' | 'LAND', force: boolean): string {
    const rig = this.rig;
    const suffix = JUMP_SUFFIX[this.jumpDir];
    for (const name of [`BOTH_FORCE${base}${suffix}1`, `BOTH_FORCE${base}1`, `BOTH_${base}${suffix}1`, `BOTH_${base}1`]) {
      if (!force && name.startsWith('BOTH_FORCE')) continue;
      if (!rig || rig.has(name)) return name;
    }
    return `BOTH_${base}1`;
  }

  private playOnce(clip: string, fadeIn: number): void {
    if (this.rig?.has(clip)) this.rig.play(clip, { fadeIn });
  }

  /** A kind of blaster's relaxed standing carry on a rig, looked for once a rig and a kind (a search of every clip's name). */
  private gunCarry(rig: CharacterRig, gun: 'pistol' | 'rifle'): string | null {
    const c = this.carryFor;
    if (c.rig !== rig || c.gun !== gun) {
      c.rig = rig;
      c.gun = gun;
      c.clip = rig.clipMatching(gun === 'pistol' ? /^loop_pistol_standing:speed0/ : /^loop_rifle:speed0/) ?? null;
    }
    return c.clip;
  }

  /** Fly the thrown saber, steer it where the camera looks, and take it back into the hand. */
  private updateThrown(dt: number, input: Input, cam: ThirdPersonCamera): void {
    if (!this.thrown.inFlight) return;
    this.handPosition(handPos);
    aimFrom.copy(this.pos).y += 1.5;
    cam.camera.getWorldDirection(aim);
    const room = this.aboard;
    if (room) {
      // Aboard, the saber flies in the hull's frame (`pos` already is): the hand and the aim brought into it.
      hullInv.copy(roomFrame(room)).invert();
      handPos.applyMatrix4(hullInv);
      aim.transformDirection(hullInv);
    }
    const blocked = room ? (a: THREE.Vector3, b: THREE.Vector3) => room.physics.cameraBlock(a, b, null, true) !== null : (a: THREE.Vector3, b: THREE.Vector3) => this.physics.cameraBlock(a, b, this.body, this.inside) !== null;
    const result = this.thrown.update(dt, handPos, aimFrom, aim, input.held('saberThrow'), blocked);
    if (result === 'caught') return;
    if (room) {
      this.flying.position.copy(this.thrown.pos).applyMatrix4(roomFrame(room));
      this.flying.quaternion.copy(roomTurn(room)).multiply(tmpQ.setFromAxisAngle(UP_AXIS, this.thrown.spin));
    } else {
      this.flying.position.copy(this.thrown.pos);
      this.flying.rotation.set(0, this.thrown.spin, 0);
    }
  }

  private flyUpdate(dt: number, input: Input, cam: ThirdPersonCamera): void {
    cam.camera.getWorldDirection(fwd);
    // Aboard, the flying is in the room's frame: the camera's world direction turned into it
    // (its right is already the room's).
    if (this.aboard) fwd.applyQuaternion(tmpQ.copy(roomTurn(this.aboard)).invert());
    cam.right(rgt);
    move.set(0, 0, 0);
    if (input.held('forward')) move.add(fwd);
    if (input.held('back')) move.sub(fwd);
    if (input.held('right')) move.add(rgt);
    if (input.held('left')) move.sub(rgt);
    if (input.held('jump')) move.y += 1;
    // Down is an action of its own on X, never the crouch's Ctrl: W held with Ctrl closes the tab.
    if (input.held('noclipDown')) move.y -= 1;
    const moving = move.lengthSq() > 0;
    if (moving) move.normalize();
    const speed = this.noclipSpeed * (input.held('speedUp') ? 3.5 : 1) * this.speedMultiplier;
    this.pos.addScaledVector(move, speed * dt);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    // Noclip returns from `update` before the swim block too, so the same rule holds: the two go
    // down together, or a dive flown out of is still a dive to everything that reads it.
    this.swimming = false;
    this.submerged = false;
    const desired = Math.atan2(fwd.x, fwd.z);
    let diff = desired - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.heading += diff * Math.min(1, dt * 10);
    this.moveAmount = 0;
    this.animate(dt);
    this.animateRig(dt, 0, false);
    this.placeVisual();
    this.group.updateMatrixWorld(true);
  }

  private animateSeated(): void {
    const p = this.parts;
    p.leftLeg.rotation.x = -1.35;
    p.rightLeg.rotation.x = -1.35;
    p.leftLeg.rotation.z = 0.25;
    p.rightLeg.rotation.z = -0.25;
    p.leftArm.rotation.x = -1.1;
    p.rightArm.rotation.x = -1.1;
    p.leftArm.rotation.z = 0.2;
    p.rightArm.rotation.z = -0.2;
    p.hips.position.y = 0.55;
    p.torso.rotation.x = 0.25;
  }

  private animate(dt: number): void {
    const p = this.parts;
    const swing = Math.sin(this.phase) * 0.75 * this.moveAmount;
    const aiming = this.classId === 'bounty_hunter';
    p.leftLeg.rotation.z = 0;
    p.rightLeg.rotation.z = 0;
    p.torso.rotation.x = 0.08 * this.moveAmount;

    if (this.grounded) {
      p.leftLeg.rotation.x = swing;
      p.rightLeg.rotation.x = -swing;
      p.hips.position.y = 0.95 + Math.abs(Math.sin(this.phase)) * 0.05 * this.moveAmount;
    } else {
      const k = Math.min(1, dt * 8);
      p.leftLeg.rotation.x += (0.5 - p.leftLeg.rotation.x) * k;
      p.rightLeg.rotation.x += (-0.35 - p.rightLeg.rotation.x) * k;
      p.hips.position.y = 1.0;
    }

    if (aiming) {
      p.rightArm.rotation.x = -1.5;
      p.rightArm.rotation.z = -0.1;
      p.leftArm.rotation.x = -1.35;
      p.leftArm.rotation.z = 0.55;
    } else if (this.swing >= 0) {
      // Overhead chop that sweeps across the body.
      const t = this.swing;
      const e = t < 0.3 ? t / 0.3 : 1;
      const s = t < 0.3 ? 0 : Math.min(1, (t - 0.3) / 0.45);
      const eased = s * s * (3 - 2 * s);
      p.rightArm.rotation.x = -2.5 * e + eased * 2.3;
      p.rightArm.rotation.z = 0.7 * e - eased * 1.5;
      p.leftArm.rotation.x = -0.6;
      p.leftArm.rotation.z = 0.4;
      p.torso.rotation.y = 0.25 * e - eased * 0.6;
    } else {
      const k = Math.min(1, dt * 10);
      const armSwing = this.grounded ? swing * 0.8 : -2.4;
      p.leftArm.rotation.x += (-armSwing - p.leftArm.rotation.x) * k;
      p.rightArm.rotation.x += ((this.saberOn ? -0.9 : armSwing) - p.rightArm.rotation.x) * k;
      p.rightArm.rotation.z += ((this.saberOn ? -0.25 : 0) - p.rightArm.rotation.z) * k;
      p.leftArm.rotation.z += (0 - p.leftArm.rotation.z) * k;
      p.torso.rotation.y += (0 - p.torso.rotation.y) * k;
    }

  }
}
