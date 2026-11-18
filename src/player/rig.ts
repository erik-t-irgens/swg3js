import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Character, type GripAxes } from './character';
import { aimArmBones } from './armAim.ts';
import { HeadHider, type HeadStatusRow } from './headHide.ts';
import { HeadLook } from './lookAt.ts';
import { MOOD_TUNE } from './moods.ts';
import { chainPoint, clipLinks, HEAD_TO_EYE, type Quat, type Vec3 } from '../vehicles/cockpitSeat';
import type { ActiveClip, ClipHalf } from '../audio/clipEvents.ts';
import { restWorld as restPlaces, type TargetSkeleton } from '../anim/fit.ts';
import { phaseAt, sharedRate, timeAtPhase, type ClipFacts } from '../anim/locoPhase.ts';
import { STAIR_WINDOWS, stairCyclesFor, type StairCycleFacts, type StairCycles } from '../anim/stairCycle.ts';
import { ANIM_TUNE, watchJkaSpine } from '../anim/animTune.ts';
import { applyJkaSpine, isJkaClip, rebaseJkaClips, spineRebaseFor } from '../anim/jkaSpine.ts';
import { forgetMixerWrites, poseAtRest } from '../anim/poseReset.ts';

// The Jedi Academy spine's switch moved (`__debug.anim({ tune: { jkaSpine } })`, its dial): every clip rebased so far
// takes the keys the switch names, written in place (an event, never a frame).
watchJkaSpine(() => applyJkaSpine(ANIM_TUNE.jkaSpine === 'mended'));

export type RigState = 'idle' | 'walk' | 'run' | 'air' | 'seated' | 'swim' | 'float' | 'crouch' | 'crouchWalk' | 'crouchWalkBack' | 'stance' | 'strafeLeft' | 'strafeRight' | 'runBack' | 'walkBack' | 'runSaber' | 'walkSaber' | 'gunIdle' | 'gunWalk' | 'gunRun' | 'gunReadyIdle' | 'gunReadyWalk' | 'gunReadyRun' | 'gunAimIdle' | 'gunAimWalk' | 'gunAimRun' | 'kneel' | 'prone' | 'proneMove' | 'gunProneIdle' | 'gunProneMove' | 'gunProneReadyIdle' | 'gunProneReadyMove' | 'gunProneAimIdle' | 'gunProneAimMove' | 'hangBraced' | 'hangFree' | 'shimmyBracedL' | 'shimmyBracedR' | 'shimmyFreeL' | 'shimmyFreeR' | 'climbUpBraced' | 'climbUpFree' | 'wallStill' | 'wallUp' | 'wallDown' | 'wallLeft' | 'wallRight';

/** Clip names used for each state, in preference order (placeholder rig names, then the game's); a pattern matches any clip. */
const STATE_CLIPS: Record<RigState, (string | RegExp)[]> = {
  idle: ['idle', 'Idle', 'stand', 'loop_stand', 'idle_combat'],
  walk: ['walk', 'Walk', 'loop_walk', 'walk_combat'],
  run: ['run', 'Run', 'loop_run', 'run_combat'],
  // The imported falling loop first, when the rig has it (src/anim/): a rig without the imported clips, or with the
  // switch off, steps over the name and plays what it always did.
  air: ['mx_falling_idle', 'BOTH_INAIR1', 'jump', 'fall', 'loop_jump', 'sneak_pose', 'idle', 'stand'],
  // Riding: the vehicle's own pose is asked for through `prefer` (loop_riding:vehicle_speeder_bike, the saddle poses); the plain loop_riding is the game's default saddle.
  seated: ['loop_riding', /^loop_riding/, 'loop_ride', 'sit', 'loop_sit', /^loop_sitting_chair/, 'loop_sitting_ground', 'sneak_pose', 'idle', 'stand'],
  swim: ['swim', 'loop_swimming:speed1', 'loop_swimming:speed0', 'walk', 'idle'],
  // Still in the water: the imported tread when the rig has it. (Adrift in space sets its own preference over this.)
  float: ['mx_treading_water', 'float', 'loop_swimming:speed0', 'swim', 'idle'],
  crouch: ['BOTH_CROUCH1IDLE', 'BOTH_CROUCH1', 'sneak_pose', 'idle', 'stand'],
  crouchWalk: ['BOTH_CROUCH1WALK', 'sneak', 'walk', 'loop_walk'],
  crouchWalkBack: ['BOTH_CROUCH1WALKBACK', 'BOTH_CROUCH1WALK', 'sneak', 'walk', 'loop_walk'],
  /** Standing with the saber drawn: the style's stance (set through `stanceClip`), else the idle. */
  stance: ['BOTH_STAND2', 'idle_combat', 'idle', 'Idle', 'stand', 'loop_stand'],
  // Sideways and backwards locomotion, when the skeleton's tables carry them: the body then
  // keeps facing the camera while it moves. The imported jog strafes first, when the rig has them (src/anim/): what a
  // figure told only "strafing" plays. The speed classes name the exact clip themselves, through `prefer`.
  strafeLeft: ['mx_jog_strafe_left', /strafe.*(left|_l)$/i, /^(run|walk)_?(strafe_?)?l(eft)?$/i, /side.*left/i],
  strafeRight: ['mx_jog_strafe_left_mirrored', /strafe.*(right|_r)$/i, /^(run|walk)_?(strafe_?)?r(ight)?$/i, /side.*right/i],
  runBack: ['BOTH_RUNBACK2', 'BOTH_RUNBACK1', /^run.*back/i, /back.*run/i, /^run.*bwd/i],
  walkBack: ['BOTH_WALKBACK2', 'BOTH_WALKBACK1', /^walk.*back/i, /back.*walk/i, /^walk.*bwd/i],
  /** Moving with the block held: Jedi Academy's saber run and walk, else the game's own. */
  runSaber: ['BOTH_RUN2', 'BOTH_RUN1', 'run', 'Run', 'loop_run', 'run_combat'],
  walkSaber: ['BOTH_WALK2', 'BOTH_WALK1', 'walk', 'Walk', 'loop_walk', 'walk_combat'],
  // A blaster in hand, the game's own way: the relaxed carry (a rifle across the chest, a pistol
  // at the side), the combat carry after a shot, and the aimed carry. Each has its idle, walk and
  // run as the table's speed variants; the kind of gun picks between them through `prefer`.
  gunIdle: [/^loop_rifle:speed0/, /^loop_pistol_standing:speed0/, 'idle', 'stand'],
  gunWalk: [/^loop_rifle:speed1/, /^loop_pistol_standing:speed1/, 'walk', 'loop_walk'],
  gunRun: [/^loop_rifle:speed2/, /^loop_pistol_standing:speed2/, 'run', 'loop_run'],
  // These two lists are the fallback and almost never the answer: `player.ts` writes a `prefer` for
  // both states every frame a blaster is held, naming that gun's own relaxed carry, and `prefer`
  // resolves ahead of the list (`setState` below). loop_combat_standing is the game's *unarmed*
  // combat stance, not its one stance for every weapon: the table has a ready and an aimed loop per
  // weapon (loop_pistol_combat_standing, loop_pistol_combat_standing_aimed and the rifle's), which
  // the converter could not read until the direction selector's tag was read as four characters.
  // The aimed pose rides the upper body and is asked for by pattern in `player.ts`, not from here.
  gunReadyIdle: [/^loop_combat_standing:speed0$/, /^loop_combat_standing:speed0/, 'idle_combat', /^loop_rifle:speed0/, 'idle'],
  gunReadyWalk: [/^loop_combat_standing:speed1$/, /^loop_combat_standing:speed1/, 'walk_combat', /^loop_rifle:speed1/, 'walk'],
  gunReadyRun: [/^loop_combat_standing:speed2$/, /^loop_combat_standing:speed2/, 'run_combat', /^loop_rifle:speed2/, 'run'],
  gunAimIdle: [/^loop_combat_standing:speed0$/, /^loop_combat_standing:speed0/, 'idle_combat', 'idle'],
  gunAimWalk: [/^loop_combat_standing:speed1$/, /^loop_combat_standing:speed1/, 'walk_combat', 'walk'],
  gunAimRun: [/^loop_combat_standing:speed2$/, /^loop_combat_standing:speed2/, 'run_combat', 'run'],
  // Kneeling (V): the game's own; a blaster has its kneel through `prefer` (loop_pistol_kneeling, loop_rifle_kneeling).
  kneel: ['loop_kneeling', 'BOTH_CROUCH1IDLE', 'sneak_pose', 'idle'],
  // Lying prone (Z): the game's own, still and crawling; a blaster has its own relaxed, combat and aimed prone loops.
  prone: [/^loop_prone:speed0/, /^loop_prone:speed1/, 'BOTH_CROUCH1IDLE', 'idle'],
  proneMove: [/^loop_prone:speed1/, /^loop_prone:speed0/, 'BOTH_CROUCH1WALK', 'walk'],
  gunProneIdle: [/^loop_rifle_prone:speed0/, /^loop_pistol_prone:speed0/, /^loop_prone:speed0/, 'idle'],
  gunProneMove: [/^loop_rifle_prone:speed1/, /^loop_pistol_prone:speed1/, /^loop_prone:speed1/, 'walk'],
  gunProneReadyIdle: [/^loop_rifle_combat_prone:speed0/, /^loop_pistol_combat_prone:speed0/, /^loop_rifle_combat_prone:speed1/, /^loop_pistol_combat_prone:speed1/, /^loop_prone:speed0/, 'idle'],
  gunProneReadyMove: [/^loop_rifle_combat_prone:speed1/, /^loop_pistol_combat_prone:speed1/, /^loop_prone:speed1/, 'walk'],
  gunProneAimIdle: [/^loop_rifle_combat_prone_aimed:speed0/, /^loop_pistol_combat_prone_aimed:speed0/, /^loop_rifle_combat_prone_aimed:speed1/, /^loop_pistol_combat_prone_aimed:speed1/, /^loop_prone:speed0/, 'idle'],
  gunProneAimMove: [/^loop_rifle_combat_prone_aimed:speed1/, /^loop_pistol_combat_prone_aimed:speed1/, /^loop_prone:speed1/, 'walk'],
  // Wave 4, the ledges (src/player/ledge.ts, src/anim/ledgeClips.ts): hanging braced (the feet on the wall) or free, still
  // or shimmying left or right, and climbing up. Asked for by name through `prefer` too; a rig without the imported clips
  // falls back on the air's own pose.
  hangBraced: ['mx_braced_hanging_idle', 'mx_hanging_idle', 'BOTH_INAIR1', 'jump', 'idle'],
  hangFree: ['mx_free_hang_hanging_idle', 'mx_hanging_idle_looking_up', 'mx_braced_hanging_idle', 'BOTH_INAIR1', 'jump', 'idle'],
  shimmyBracedL: ['mx_braced_hang_shimmy_1', 'mx_braced_hanging_idle', 'BOTH_INAIR1', 'idle'],
  shimmyBracedR: ['mx_braced_hang_shimmy', 'mx_braced_hanging_idle', 'BOTH_INAIR1', 'idle'],
  shimmyFreeL: ['mx_free_hang_left_shimmy', 'mx_free_hang_hanging_idle', 'BOTH_INAIR1', 'idle'],
  shimmyFreeR: ['mx_free_hang_right_shimmy', 'mx_free_hang_hanging_idle', 'BOTH_INAIR1', 'idle'],
  climbUpBraced: ['mx_braced_hang_to_crouch', 'mx_braced_hanging_idle', 'BOTH_INAIR1', 'idle'],
  climbUpFree: ['mx_freehang_climb', 'mx_free_hang_hanging_idle', 'BOTH_INAIR1', 'idle'],
  // Wave 4, the wall climb (src/player/wallClimb.ts, src/anim/wallClips.ts): still, up, down and sideways (no clip of its own:
  // the up clip, played at the sideways speed's rate). Without the imported clips, the air's own pose.
  wallStill: ['mx_climbing_up_wall', 'BOTH_INAIR1', 'jump', 'idle'],
  wallUp: ['mx_climbing_up_wall', 'BOTH_INAIR1', 'jump', 'idle'],
  wallDown: ['mx_climbing_down_wall', 'mx_climbing_up_wall', 'BOTH_INAIR1', 'jump', 'idle'],
  wallLeft: ['mx_climbing_up_wall', 'BOTH_INAIR1', 'jump', 'idle'],
  wallRight: ['mx_climbing_up_wall', 'BOTH_INAIR1', 'jump', 'idle'],
};

/** The game's additive clips: add_pistol_fire_N and kin, deltas meant to play over whatever pose is up. */
export function isAdditive(name: string): boolean {
  return /^add_/.test(name);
}

/**
 * Turn a clip that was baked over the rest pose into the delta from it, in place, so three.js can
 * add it to whatever the body is doing (AdditiveAnimationBlendMode). The reference is each bone's
 * rest transform, which is what the skinned model's nodes hold before anything plays.
 */
export function additiveAgainstRest(clip: THREE.AnimationClip, bones: Map<string, THREE.Bone>): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(t.name);
    const bone = nodeName ? bones.get(nodeName) : undefined;
    if (!bone) continue;
    if (propertyName === 'quaternion') tracks.push(new THREE.QuaternionKeyframeTrack(t.name, [0], bone.quaternion.toArray()));
    else if (propertyName === 'position') tracks.push(new THREE.VectorKeyframeTrack(t.name, [0], bone.position.toArray()));
    else if (propertyName === 'scale') tracks.push(new THREE.VectorKeyframeTrack(t.name, [0], bone.scale.toArray()));
  }
  THREE.AnimationUtils.makeClipAdditive(clip, 0, new THREE.AnimationClip('rest', 1, tracks));
  return clip;
}

/** Natural travel speed of the placeholder rig's locomotion clips, in m/s, used to scale playback. */
const DEFAULT_CLIP_SPEED: Partial<Record<RigState, number>> = { walk: 1.5, run: 5.5, swim: 2.5, crouchWalk: 2.2, strafeLeft: 4.5, strafeRight: 4.5, runBack: 4, walkBack: 1.5, runSaber: 6.3, walkSaber: 2, crouchWalkBack: 2, gunWalk: 1.5, gunRun: 5.5, gunReadyWalk: 1.5, gunReadyRun: 5.5, gunAimWalk: 1.5, gunAimRun: 5.5, proneMove: 0.6, gunProneMove: 0.6, gunProneReadyMove: 0.6, gunProneAimMove: 0.6 };

/** Bones the game needs by role: exact names of the placeholder rig first, then patterns for the game's skeletons. */
export type BoneRole = 'rightHand' | 'leftHand' | 'spine' | 'rightUpperArm' | 'rightForeArm' | 'leftUpperArm' | 'leftForeArm' | 'head';
const BONE_ROLES: Record<BoneRole, (string | RegExp)[]> = {
  // The game's skeletons carry the weapon hardpoints as bones (hold_r, hold_l) in the palm: those first.
  rightHand: [/^hold_r$/i, 'mixamorig:RightHand', 'mixamorigRightHand', /^r_?hand$/i, /^right_?hand$/i, /(^|_)r_?hand/i, /hand_?r$/i, /^r_?wrist$/i, /(^|_)r_?wrist/i, /^rhand/i],
  leftHand: [/^hold_l$/i, 'mixamorig:LeftHand', 'mixamorigLeftHand', /^l_?hand$/i, /^left_?hand$/i, /(^|_)l_?hand/i, /hand_?l$/i, /^l_?wrist$/i, /(^|_)l_?wrist/i, /^lhand/i],
  spine: ['mixamorig:Spine2', 'mixamorigSpine2', /^spine_?3$/i, /^spine_?2$/i, /chest/i, /torso/i, /^spine_?1$/i, /spine/i],
  rightUpperArm: ['mixamorig:RightArm', 'mixamorigRightArm', /^r_?(upper_?arm|bicep|humerus|shoulder|arm)$/i, /^right_?(upper_?arm|arm)$/i, /(^|_)r_?(upper_?arm|bicep)/i],
  rightForeArm: ['mixamorig:RightForeArm', 'mixamorigRightForeArm', /^r_?(fore_?arm|lower_?arm|elbow|radius)$/i, /^right_?fore_?arm$/i, /(^|_)r_?(fore_?arm|elbow)/i],
  leftUpperArm: ['mixamorig:LeftArm', 'mixamorigLeftArm', /^l_?(upper_?arm|bicep|humerus|shoulder|arm)$/i, /^left_?(upper_?arm|arm)$/i, /(^|_)l_?(upper_?arm|bicep)/i],
  leftForeArm: ['mixamorig:LeftForeArm', 'mixamorigLeftForeArm', /^l_?(fore_?arm|lower_?arm|elbow|radius)$/i, /^left_?fore_?arm$/i, /(^|_)l_?(fore_?arm|elbow)/i],
  head: ['mixamorig:Head', 'mixamorigHead', /^head$/i, /head/i],
};

/**
 * The bone playing a role in any skeleton, by the same names and patterns a rig uses: what a
 * creature or NPC that is not a CharacterRig (a mobile on its own model) hangs a weapon on.
 */
export function boneForRole(bones: ReadonlyMap<string, THREE.Bone>, role: BoneRole): THREE.Bone | null {
  for (const candidate of BONE_ROLES[role]) {
    if (typeof candidate === 'string') {
      const b = bones.get(candidate);
      if (b) return b;
    } else for (const [name, bone] of bones) if (candidate.test(name)) return bone;
  }
  return null;
}

export interface RigOptions {
  /** Movement speed each locomotion clip was animated at (m/s), from a converter manifest. */
  clipSpeeds?: Record<string, number>;
  /** Root scale to apply (the placeholder rig is a little tall for the world). */
  scale?: number;
  /** Clips that hold their last frame instead of looping (Jedi Academy's stances, the in-air pose). */
  hold?: string[];
  /** Clips that move only part of the skeleton, with the joints they drive (a shot on the arms); played as layers. */
  partialClips?: Record<string, string[]>;
  /** Where the blade points in each hand, from the importer; without it the game guesses from the bind pose. */
  grip?: GripAxes;
  /** Selector branches by clip: the variable and every value that picks the clip (a flourish two dances share). */
  variants?: Record<string, { variable: string; values: string[] }>;
}

/** A keyframe track's own interpolant (three's, which its types leave out): Smoothness II's nearest phase reads a pose with it. */
function interpOf(tr: THREE.KeyframeTrack): THREE.Interpolant {
  return (tr as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
}
const tmpQ = new THREE.Quaternion();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const RIGHT_AXIS = new THREE.Vector3(1, 0, 0);
const pitchQ = new THREE.Quaternion();
const steadyQ = new THREE.Quaternion();
const IDENTITY_Q = new THREE.Quaternion();
const steadyFullQ = new THREE.Quaternion();
/** A swing's own pelvis at its moment, and the turn onto it (wave 2b's `swingPelvis`). */
const swingQ = new THREE.Quaternion();
const swingTurnQ = new THREE.Quaternion();
const swingWasQ = new THREE.Quaternion();
/** States whose legs walk or run around the standing pelvis, where a pose on the upper body is held steady. */
const LOCOMOTION_STATES = new Set<RigState>(['walk', 'run', 'runBack', 'walkBack', 'runSaber', 'walkSaber', 'strafeLeft', 'strafeRight', 'gunWalk', 'gunRun', 'gunReadyWalk', 'gunReadyRun', 'gunAimWalk', 'gunAimRun']);
/**
 * The one state a mood may change, and the whole of "combat is never affected": the plain idle. The
 * saber, gun, prone and kneeling states have states of their own and are not in this list, so a mood
 * set before a fight changes nothing about the fight.
 *
 * The walk is not here, and that is the data's answer rather than a choice: the animation table's
 * mood selector hangs under the still branch alone, and the walk and the run carry no mood selector
 * at all, so there is no walking mood to convert and a branch written for one could never fire. It
 * was measured over the real table leaf by leaf. If a species' table is ever found with one, adding
 * `'walk'` back to this list is the whole of the change -- everything below reads the list.
 */
const MOOD_STATES: readonly RigState[] = ['idle'];
const rootQ = new THREE.Quaternion();
const rootInvQ = new THREE.Quaternion();
const parentQ = new THREE.Quaternion();
const alignQ = new THREE.Quaternion();
/** The head's own turn, kept apart from the torso twist's temporaries: both are written in one frame. */
const lookQ = new THREE.Quaternion();
const lookPitchQ = new THREE.Quaternion();
const lookAlignQ = new THREE.Quaternion();
const lookRootQ = new THREE.Quaternion();
const lookRootInvQ = new THREE.Quaternion();
const lookParentQ = new THREE.Quaternion();
/** How long the duck's crouch layer takes to come in or go from nought to whole, seconds (the rig's own fade between two clips). */
const DUCK_FADE = 0.18;
/** The most of the bones' pose the duck's layers ever take (the state's clip keeps a little, so its weight is never divided by nought). */
const DUCK_MOST = 0.98;
/** A value moved toward a target by at most a step. */
function approach(v: number, to: number, step: number): number {
  return v < to ? (v + step < to ? v + step : to) : v - step > to ? v - step : to;
}
const restWorld = new THREE.Vector3();
const dirWorld = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

/**
 * A half's clip is named `upper:<clip>` or `lower:<clip>`, and a clip's event markers are listed
 * under the bare name. Cut once per name and kept: `activeClips` runs every frame for every body in
 * earshot, and slicing there would make a string a frame per half the player's body is playing.
 * Bounded by the number of half clips a session ever plays, a few dozen.
 */
const bareNames = new Map<string, string>();
function bareClipName(name: string): string {
  let bare = bareNames.get(name);
  if (bare === undefined) {
    bare = name.slice(6);
    bareNames.set(name, bare);
  }
  return bare;
}

/** A skinned GLTF character with an animation mixer and bones found by role. */
export class CharacterRig {
  readonly root: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  readonly scale: number;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly bones = new Map<string, THREE.Bone>();
  /** Each spine bone's pose before and after the torso twist, so the twist never stacks on itself. */
  private readonly twists = new Map<THREE.Bone, { clean: THREE.Quaternion; twisted: THREE.Quaternion }>();
  /**
   * The same pair for the two joints the head's look turns, which is the same rule one joint further
   * up. The entries are made once per rig (two of them) and kept for its life: they are cleared of
   * their *turn* rather than thrown away, since a head that stops looking and looks again is what
   * happens at the end of every kata, kick, emote and death, and making four quaternions there would
   * be four made on a live frame in the middle of a fight.
   */
  private readonly lookTurns = new Map<THREE.Bone, { clean: THREE.Quaternion; turned: THREE.Quaternion }>();
  /** Whether a turn of the look is standing on those joints just now, which is what `lookTurns.size` used to say. */
  private lookTurned = false;
  /**
   * How far the torso twist really turned the spine this frame, after its own clamp: what the head's
   * look takes off before its cone, so the two never add up past what was asked for. Written by
   * `twistTorso`, which is **not** called on every path a body can take -- adrift on foot in space
   * the figure is posed and nothing twists the spine -- so `twistFresh` says whether what is here
   * was written this frame. `lookToward` reads it and puts it down again, and a look that runs on a
   * frame the twist did not measures itself from a chest with no turn in it, which is what the
   * spine really has. Left standing, the last on-foot frame's turn (up to the clamp's 1.2 rad) would
   * be taken off every adrift frame and the head would sit pulled to one side for as long as the
   * player floated, with nothing to put it back.
   */
  private twistYaw = 0;
  private twistPitch = 0;
  private twistFresh = false;
  /** Where this body's head is looking, and the ease that takes it there (`lookAt.ts`). */
  readonly headLook = new HeadLook();
  /** The neck and the head, found once: null once looked for and not found. */
  private lookBones: { neck: THREE.Bone | null; head: THREE.Bone | null } | null = null;
  /**
   * Climbing II's feedback round, item 4 (the duck, `src/player/bodyShape.ts`): the crouch's share wanted in the pose this
   * frame (nought to one) and whether the body moves, written by the caller before `update`, which takes them and puts the
   * share back to nought, so a frame that does not ask (a hang, a wall, a ride) eases the layer out. Nothing at all while no
   * share was ever asked.
   */
  duckWant = 0;
  duckMoving = false;
  /** The duck's two layers (the crouch's idle and its walk), their shares as eased, and their actions (made once, per clip). */
  private duckIdleShare = 0;
  private duckWalkShare = 0;
  private readonly duckActions = new Map<string, THREE.AnimationAction | null>();
  private duckIdle: THREE.AnimationAction | null = null;
  private duckWalk: THREE.AnimationAction | null = null;
  /** The arms' joints (the upper arms and all under them), which the duck's layer leaves to the state's clip. */
  private armBoneNames: Set<string> | null = null;
  /** The neck's forward bend past the crouch (item 4), with its clean and bent poses, put back before the next mixer update. */
  private readonly duckNeckTurn = { clean: new THREE.Quaternion(), turned: new THREE.Quaternion(), bone: null as THREE.Bone | null, on: false };
  private readonly roles = new Map<BoneRole, THREE.Bone | null>();
  private readonly restArm = new Map<'left' | 'right', THREE.Vector3>();
  /** Bind-pose rotations of the arm bones: relative to the root (upper arms) and to the parent (forearms). */
  private readonly bindToRoot = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly bindLocal = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly clipSpeeds: Record<string, number>;
  private readonly hold: Set<string>;
  /** Every bone's rest rotation under its parent, for holding the torso steady over running legs. */
  private readonly restLocal = new Map<THREE.Bone, THREE.Quaternion>();
  /** Every bone's rest position under its parent, for composing a clip's first frame without posing the skeleton. */
  private readonly restPosition = new Map<THREE.Bone, THREE.Vector3>();
  /** Every bone's rest scale, so a measurement never depends on whatever pose the skeleton happens to hold when first asked. */
  private readonly restScale = new Map<THREE.Bone, THREE.Vector3>();
  /** Where each measured clip's first frame puts the eyes and the pelvis, in the rig root's unscaled frame (null: it cannot say). */
  private readonly seatedCache = new Map<string, { eye: THREE.Vector3; pelvis: THREE.Vector3 } | null>();
  /** Clips that add to the pose underneath instead of replacing it (the game's add_ shots). */
  private readonly additive = new Set<string>();
  readonly grip: GripAxes | null;
  readonly partialClips: Record<string, string[]>;
  readonly variants: Record<string, { variable: string; values: string[] }>;
  /**
   * The stride of each walking or running clip that has one (the imported ones: src/anim/locoPhase.ts), by clip name:
   * the speed its feet were made for, and when its left foot lands. A clip without one (every clip of the game's own)
   * plays and fades exactly as it always did.
   */
  private readonly strides = new Map<string, ClipFacts>();
  /**
   * Two striding clips kept in step while one fades into the other: the outgoing and the incoming action with their
   * strides, how far the fade has got, and the rates. Kept fields rather than a record made at each change of clip.
   */
  private syncOn = false;
  private syncFrom: THREE.AnimationAction | null = null;
  private syncNext: THREE.AnimationAction | null = null;
  private syncA: ClipFacts | null = null;
  private syncB: ClipFacts | null = null;
  private syncT = 0.5;
  private syncFade = 0.5;
  /** The outgoing clip's own phase rate as the fade began, strides a second, and the rate the incoming clip is asked to play at. */
  private syncFromRate = 0.5;
  private syncWanted = 1.5;
  /** A clip to play for a state ahead of its table, when the rig has it: the style's stance, the jump's direction, the style's run. */
  private readonly preferred = new Map<RigState, string | RegExp>();
  /** A one-shot clip on the upper body over whatever the legs do (a shot fired), and when it ends. */
  private upperShot: THREE.AnimationAction | null = null;
  private upperShotEnds = 0;
  private upperShotTime = 0;
  /** A one-shot that replaces the upper layer while it plays (a full shot clip: the state clip keeps the legs only). */
  private shotName: string | null = null;
  private current: THREE.AnimationAction | null = null;
  private state: RigState | null = null;
  /** A clip on the upper body only, over the state clip's legs (the saber stance while swimming). */
  private upper: THREE.AnimationAction | null = null;
  private upperName: string | null = null;
  /** The upper-body clip the caller last asked for, restored after a one-off clip. */
  private wantedUpper: string | null = null;
  /** Half-body versions of clips, made on demand: 'upper:<clip>' and 'lower:<clip>'. */
  private readonly halves = new Map<string, THREE.AnimationAction>();
  private upperBoneNames: Set<string> | null = null;
  /** A one-off clip (a swing, a jump, a landing) playing over the state clips until it ends. */
  private override: THREE.AnimationAction | null = null;
  private overrideEnds = 0;
  private overrideTime = 0;
  /** The mood the body has been asked for, '' for none, and whether this pack really had a branch for it. */
  private moodName = '';
  private moodOnBody = false;

  /** Meshes carrying each morph target, by target name. */
  private readonly morphs = new Map<string, THREE.Mesh[]>();

  /** Every shape slider this character has, and where each one currently sits. */
  morphValues(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, meshes] of this.morphs) {
      const m = meshes[0];
      out[name] = m.morphTargetInfluences![m.morphTargetDictionary![name]];
    }
    return out;
  }

  /** Set one shape slider, on every mesh that carries it. Returns false for an unknown name. */
  setMorph(name: string, value: number): boolean {
    const meshes = this.morphs.get(name);
    if (!meshes) return false;
    const v = Math.min(Math.max(value, 0), 1);
    for (const m of meshes) m.morphTargetInfluences![m.morphTargetDictionary![name]] = v;
    return true;
  }

  private constructor(scene: THREE.Group, clips: THREE.AnimationClip[], options: RigOptions) {
    this.root = scene;
    this.scale = options.scale ?? 1;
    this.clipSpeeds = options.clipSpeeds ?? {};
    this.hold = new Set(options.hold ?? []);
    // The game's transitions into an aimed pose end in it and have no loop of their own: held at their end.
    for (const clip of clips) if (/^trn_.*_(aimed|ready)$/.test(clip.name)) this.hold.add(clip.name);
    this.grip = options.grip ?? null;
    this.partialClips = options.partialClips ?? {};
    this.variants = options.variants ?? {};
    this.mixer = new THREE.AnimationMixer(scene);
    scene.traverse((o) => {
      if (o instanceof THREE.Bone) {
        this.bones.set(o.name, o);
        this.restLocal.set(o, o.quaternion.clone());
        this.restPosition.set(o, o.position.clone());
        this.restScale.set(o, o.scale.clone());
      }
    });
    // Jedi Academy's clips' spine rebased from the bind pose onto the game's own idle (src/anim/jkaSpine.ts): once a clip,
    // before anything plays it, with the keys as converted kept for the switch (`ANIM_TUNE.jkaSpine`).
    const idleClip = clips.find((c) => c.name === 'idle');
    if (idleClip && clips.some((c) => isJkaClip(c.name))) {
      const skel: { name: string; parent: string; rest: [number, number, number, number] }[] = [];
      for (const [name, b] of this.bones) skel.push({ name, parent: b.parent instanceof THREE.Bone ? b.parent.name : '', rest: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w] });
      rebaseJkaClips(clips as never, spineRebaseFor(skel, idleClip as never), ANIM_TUNE.jkaSpine === 'mended');
    }
    for (const clip of clips) {
      // The game's add_ clips (a blaster's shots) are deltas on whatever plays: made additive against the rest pose.
      if (isAdditive(clip.name)) {
        // makeClipAdditive rewrites a clip's values in place and leaves its blendMode behind as
        // the mark: a clip shared between rigs (the species packs have been shared since the
        // fighters stopped parsing them each) must only be converted once, or every rig after
        // the first takes the delta of a delta.
        if (clip.blendMode !== THREE.AdditiveAnimationBlendMode) additiveAgainstRest(clip, this.bones);
        this.additive.add(clip.name);
        this.actions.set(clip.name, this.mixer.clipAction(clip, undefined, THREE.AdditiveAnimationBlendMode));
      } else this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
    scene.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh || o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m instanceof THREE.MeshStandardMaterial) this.materials.push(m);
      }
    });
    // The rest direction of each upper arm (shoulder to elbow) in root space, from the bind pose,
    // so aiming works whatever pose the skeleton was authored in.
    // Morph targets: the character creator's shape sliders, as the converter carried them out of
    // the mesh's blend targets. They are gathered by name across every mesh, because one slider
    // can move two of them at once (the body's blend_muscle and the head's, so the neck matches).
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.morphTargetDictionary || !m.morphTargetInfluences) return;
      for (const name of Object.keys(m.morphTargetDictionary)) {
        (this.morphs.get(name) ?? this.morphs.set(name, []).get(name)!).push(m);
      }
    });
    scene.updateMatrixWorld(true);
    scene.getWorldQuaternion(rootQ).invert();
    for (const side of ['left', 'right'] as const) {
      const upper = this.boneFor(side === 'right' ? 'rightUpperArm' : 'leftUpperArm');
      const fore = this.boneFor(side === 'right' ? 'rightForeArm' : 'leftForeArm');
      const rest = new THREE.Vector3(side === 'right' ? -1 : 1, 0, 0);
      if (upper && fore) {
        fore.getWorldPosition(tmpA).sub(upper.getWorldPosition(tmpB)).applyQuaternion(rootQ);
        if (tmpA.lengthSq() > 1e-8) rest.copy(tmpA).normalize();
        this.bindToRoot.set(upper, upper.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootQ));
        this.bindLocal.set(fore, fore.quaternion.clone());
      }
      this.restArm.set(side, rest);
    }
  }

  static async load(url: string, options: RigOptions = {}): Promise<CharacterRig> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new CharacterRig(gltf.scene, gltf.animations, options);
  }

  /**
   * A rig around a character assembled from parts. The group holds the shared skeleton and the
   * meshes bound to it, so everything below -- the state machine, the clip matching, the arm
   * solving -- works on it exactly as it does on a single converted model.
   */
  static fromCharacter(character: Character, options: RigOptions = {}): CharacterRig {
    const rig = new CharacterRig(character.group, character.clips, options);
    rig.character = character;
    return rig;
  }

  /** The parts this rig was assembled from, when it came from a parts pack. */
  character: Character | null = null;

  /** What placed the feet after the mixer last frame (src/player/footIk.ts), put back before it runs again; null for none. */
  legPose: { restore(): void } | null = null;

  /** What placed the hands on a lip or a face, and the feet on a wall, after the mixer last frame (src/player/limbPlace.ts), put back before it runs again; null for none. */
  limbPose: { restore(): void } | null = null;

  /** A bone by its own name, or null (the feet's placement asks for the legs' joints by the game's names). */
  boneNamed(name: string): THREE.Bone | null {
    return this.bones.get(name) ?? null;
  }

  /** First person on a model not assembled from parts; a parts character keeps its own. */
  private headHider: HeadHider | null = null;

  /** Work out, once, what first person hides: called for the local player's rig only (Player.attachRig). */
  prepareHeadHiding(): void {
    const head = this.boneFor('head');
    if (this.character) this.character.prepareHead(head);
    else this.headHider ??= HeadHider.forModel(this.root, head);
  }

  /** Out of the eyes: the head, hair and headwear draw into the shadows only. */
  setHeadHidden(hidden: boolean): void {
    if (this.character) this.character.setHeadHidden(hidden);
    else {
      if (hidden && !this.headHider) this.prepareHeadHiding();
      this.headHider?.set(hidden);
    }
  }

  /** What first person does with each worn part (or each mesh of a single model), for `__debug.fpHead()`. */
  headStatus(): HeadStatusRow[] {
    return this.character ? this.character.headStatus() : (this.headHider?.rows ?? []);
  }

  /** Every bone name, for finding out what a converted skeleton calls things. */
  get boneNames(): string[] {
    return [...this.bones.keys()];
  }

  get clipNames(): string[] {
    return [...this.actions.keys()];
  }

  bone(name: string): THREE.Bone | undefined {
    return this.bones.get(name) ?? this.bones.get(name.replace('mixamorig:', 'mixamorig'));
  }

  /** The bone playing a role, matched by the first name or pattern that fits. */
  boneFor(role: BoneRole): THREE.Bone | null {
    if (this.roles.has(role)) return this.roles.get(role)!;
    const found = boneForRole(this.bones, role);
    this.roles.set(role, found);
    return found;
  }

  /** Colour the untextured parts (the placeholder rig); real skin and clothing keep their textures. */
  tint(color: number): void {
    for (const m of this.materials) if (!m.map) m.color.set(color);
  }

  /** The first clip a candidate list names (or a pattern matches), or undefined. */
  private findClip(candidates: (string | RegExp)[]): string | undefined {
    for (const c of candidates) {
      if (typeof c === 'string') {
        if (this.actions.has(c)) return c;
      } else for (const name of this.actions.keys()) if (c.test(name)) return name;
    }
    return undefined;
  }

  /** Whether the rig has a clip of its own for a state (rather than a stand-in from another). */
  hasState(state: RigState): boolean {
    return this.findClip(STATE_CLIPS[state]) !== undefined;
  }

  has(clip: string): boolean {
    return this.actions.has(clip);
  }

  /** A clip the rig has, by name, as its three.js clip (the appearance page's doll plays a gait's walk on its own skeleton). */
  clipObject(clip: string): THREE.AnimationClip | null {
    return this.actions.get(clip)?.getClip() ?? null;
  }

  /**
   * Take clips after the rig was made: the imported animations fitted to this skeleton (src/anim/), which the
   * loader hands over before the rig is shown, and any the console asks for later. A clip is an action more on the
   * mixer and a name more in the table; nothing that is playing is touched, and a name the rig already has is left
   * as it is. Never called on a frame. Answers how many were new.
   */
  addClips(clips: readonly THREE.AnimationClip[], strides?: ((clip: THREE.AnimationClip) => ClipFacts | null) | null): number {
    let added = 0;
    let stairs = false;
    for (const clip of clips) {
      if (this.actions.has(clip.name)) continue;
      this.actions.set(clip.name, this.mixer.clipAction(clip));
      // A walking or running clip comes with its stride: what keeps its feet on the ground and in step.
      const stride = strides?.(clip);
      if (stride) this.strides.set(clip.name, stride);
      if (clip.name.startsWith('mx_') && clip.name.slice(3) in STAIR_WINDOWS) stairs = true;
      added++;
    }
    // The stairs wave: a stair clip taken, the stair cycles made beside the clips (once a skeleton), with their facts.
    if (stairs) this.addStairCycles(stairCyclesFor(clips, this.restSkeleton()));
    return added;
  }

  /**
   * The stairs wave: the stair clips' facts on this rig's skeleton (src/anim/stairCycle.ts), by clip name: the cycles
   * made beside the pack's clips and the clips as they stand. Set with the cycles (`attachImportedClips`).
   */
  private cycleFacts: Map<string, StairCycleFacts> | null = null;
  /** A stair clip's facts, or null (no cycles made for this rig, or no such clip). */
  stairFacts(clip: string): StairCycleFacts | null {
    return this.cycleFacts?.get(clip) ?? null;
  }
  /** Take a skeleton's stair cycles: their clips as any clip is taken (none a stair clip of the pack's own), and every stair clip's facts. */
  addStairCycles(cycles: StairCycles): void {
    for (const clip of cycles.clips) if (!this.actions.has(clip.name)) this.actions.set(clip.name, this.mixer.clipAction(clip));
    const facts = this.cycleFacts ?? (this.cycleFacts = new Map());
    for (const [name, f] of cycles.facts) {
      facts.set(name, f);
      // A whole cycle (both feet's footfalls) has a stride its left foot's landing starts, which a change off it to a
      // striding clip starts that clip in step with (`stairStrides`, read only as the clip faded out).
      let k = -1;
      for (let i = 0; i < f.steps; i++) if (f.side[i] === 0) k = i;
      if (f.steps === 2 && k >= 0 && f.len > 0) this.stairStrides.set(name, { speed: (2 * f.fwd) / f.len, leftAt: f.at[k], cycle: f.len });
    }
  }
  /**
   * The stairs wave: a stair cycle's stride, for a change off it alone. Started from its start as every clip without a
   * stride is, the walk at the top of a flight came in with the foot planted on the last tread swinging, skimming 38 cm
   * along the floor through the fade (measured at 144 fps). A change onto a stair clip is not put in step: the stairs'
   * step starts it at its footfall's own phase (`setTime`).
   */
  private readonly stairStrides = new Map<string, ClipFacts>();
  private stairStrideOf(action: THREE.AnimationAction): ClipFacts | null {
    const name = action.getClip().name;
    return this.stairStrides.get(name.startsWith('lower:') ? bareClipName(name) : name) ?? null;
  }
  /** The legs' clip's time now, into `timeOut`, where the legs play `clip` (whole, or its lower half): false otherwise. */
  timeOut = 0.5;
  readTime(clip: string): boolean {
    const cur = this.current;
    if (!cur || !cur.enabled) return false;
    const name = cur.getClip().name;
    if (name !== clip && !(name.length === clip.length + 6 && name.startsWith('lower:') && name.endsWith(clip))) return false;
    this.timeOut = cur.time;
    return true;
  }
  /** Put the legs' clip at a time, where the legs play `clip` (the stairs' step starts a clip at its footfall's phase). */
  setTime(clip: string, t: number): void {
    const cur = this.current;
    if (!cur) return;
    const name = cur.getClip().name;
    if (name !== clip && !(name.length === clip.length + 6 && name.startsWith('lower:') && name.endsWith(clip))) return;
    cur.time = t;
  }

  /**
   * Climbing II, Smoothness III, items 4 and 4b: the state's upper layer (`setState`'s `upper`) put `t` seconds into its clip and
   * held there (its rate nought: the caller puts it every frame), where the layer plays `clip`: a free hop up's arms over a free
   * hang's legs, a free ladder's cycle. Nothing otherwise.
   */
  upperSeek(clip: string): void {
    const u = this.upper;
    if (!u || this.upperName !== clip) return;
    u.time = this.upperAt;
    u.timeScale = 0;
  }

  /**
   * Smoothness III, item 4b (the review's): `setTime` for a ladder's cycle every frame, the seconds read from `timeAt`, which the
   * caller writes just before (a number handed across the call is made anew every frame).
   */
  setTimeNow(clip: string): void {
    const cur = this.current;
    if (!cur) return;
    const name = cur.getClip().name;
    if (name !== clip && !(name.length === clip.length + 6 && name.startsWith('lower:') && name.endsWith(clip))) return;
    cur.time = this.timeAt;
  }

  /** `setTimeNow`'s seconds (written by the caller first). */
  timeAt = 0.5;

  /**
   * Where `upperSeek` puts the upper layer, seconds into its clip: written by the caller just before (the review's: a number
   * handed across the call was made anew every frame of a free hop's arms).
   */
  upperAt = 0.5;

  /**
   * The ground speed a clip's feet were made for on this figure, m/s: a striding clip's own at the figure's size, else
   * the converter's manifest's, else null. What a caller divides the body's speed by for the rate the clip plays at.
   */
  clipSpeed(clip: string): number | null {
    const stride = this.strides.get(clip);
    if (stride) return stride.speed * this.root.scale.y;
    return this.clipSpeeds[clip] ?? null;
  }

  /**
   * `clipSpeed` for a frame: the speed is written into `speedOut` and the answer is whether it is known, so no
   * number is handed back across the call (the speed classes ask this of the legs' clip every frame).
   */
  readSpeed(clip: string): boolean {
    const stride = this.strides.get(clip);
    if (stride) {
      this.speedOut = stride.speed * this.root.scale.y;
      return true;
    }
    const own = this.clipSpeeds[clip];
    if (own === undefined) return false;
    this.speedOut = own;
    return true;
  }
  /** What `readSpeed` last read, m/s. (Declared as a fraction: it holds one.) */
  speedOut = 0.5;

  /** The clip a state plays as things stand: its preference when the rig has it, else its table's first match; null with neither. */
  stateClip(state: RigState): string | null {
    return this.preferredClip(state) ?? this.findClip(STATE_CLIPS[state]) ?? null;
  }

  /**
   * Climbing II, Smoothness II, item 4, after its review: the highest `measure` answers with this skeleton posed by each of
   * `clips` (those the rig has) alone, at `samples` times through it, every node put back as it stood after (a mixer of its
   * own, let go). An event (once a rig), read off the clips' own keys and never the live pose, so a crossfade into a crouch or
   * a fidget never moves it; NaN where the rig has none of them.
   */
  posedHighest(clips: readonly string[], samples: number, measure: () => number): number {
    const named = clips.filter((c, i) => this.actions.has(c) && clips.indexOf(c) === i);
    if (named.length === 0) return Number.NaN;
    const nodes: THREE.Object3D[] = [];
    this.root.traverse((o) => {
      if (o !== this.root) nodes.push(o);
    });
    const kept = nodes.map((o) => ({ p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));
    const mixer = new THREE.AnimationMixer(this.root);
    let best = Number.NaN;
    try {
      for (const name of named) {
        const clip = this.actions.get(name)!.getClip();
        const act = mixer.clipAction(clip);
        act.play();
        for (let k = 0; k < samples; k++) {
          mixer.setTime((clip.duration * k) / samples);
          this.root.updateMatrixWorld(true);
          const v = measure();
          if (v === v && !(v <= best)) best = v;
        }
        act.stop();
        mixer.uncacheAction(clip);
      }
    } finally {
      mixer.stopAllAction();
      mixer.uncacheRoot(this.root);
      nodes.forEach((o, i) => {
        o.position.copy(kept[i].p);
        o.quaternion.copy(kept[i].q);
        o.scale.copy(kept[i].s);
      });
      this.root.updateMatrixWorld(true);
    }
    return best;
  }

  /** The clip a state's own table gives, whatever is preferred. */
  tableClip(state: RigState): string | null {
    return this.findClip(STATE_CLIPS[state]) ?? null;
  }

  /** The stride of the clip an action plays (its lower half is the clip's own), or null. */
  private strideOf(action: THREE.AnimationAction): ClipFacts | null {
    if (!this.strides.size) return null;
    const name = action.getClip().name;
    return this.strides.get(name.startsWith('lower:') ? bareClipName(name) : name) ?? null;
  }

  /**
   * What the legs' clip is doing, for the console and the tests: its name, the rate it plays at, how far it is through
   * its stride (null for a clip with none), and while two striding clips are fading the two's phases.
   */
  strideNow(): { clip: string | null; rate: number; phase: number | null; fading: { from: string; phase: number; to: string; toPhase: number } | null } {
    const cur = this.current;
    const stride = cur ? this.strideOf(cur) : null;
    const fading = this.syncOn && this.syncFrom && this.syncNext && this.syncA && this.syncB
      ? { from: this.syncFrom.getClip().name, phase: phaseAt(this.syncFrom.time, this.syncA), to: this.syncNext.getClip().name, toPhase: phaseAt(this.syncNext.time, this.syncB) }
      : null;
    return { clip: cur?.getClip().name ?? null, rate: cur?.timeScale ?? 0, phase: cur && stride ? phaseAt(cur.time, stride) : null, fading };
  }

  /**
   * The skeleton at its bind pose, as the imported animations' fitter takes it (`TargetSkeleton`, src/anim/fit.ts):
   * every joint parent first with its rest under its parent, from the rest the rig kept when it was made, so the
   * answer is the same whatever is playing; and where a joint that hangs from no joint has its parent, in the frame
   * of the rig's own root.
   */
  restSkeleton(): TargetSkeleton {
    const list = [...this.bones.values()];
    const at = new Map(list.map((b, i) => [b, i]));
    const joints = list.map((b) => {
      const p = this.restPosition.get(b) ?? b.position;
      const q = this.restLocal.get(b) ?? b.quaternion;
      return { name: b.name, parent: b.parent instanceof THREE.Bone ? (at.get(b.parent) ?? -1) : -1, restP: [p.x, p.y, p.z] as [number, number, number], restQ: [q.x, q.y, q.z, q.w] as [number, number, number, number] };
    });
    // Whatever stands between the rig's root and the first parentless joint (nothing, in the converted packs): no
    // clip moves it, so its place now is its place always.
    const base = new THREE.Matrix4();
    const first = list.find((b) => !(b.parent instanceof THREE.Bone));
    for (let o = first?.parent ?? null; o && o !== this.root; o = o.parent) base.premultiply(tmpM.compose(o.position, o.quaternion, o.scale));
    const bp = new THREE.Vector3(), bq = new THREE.Quaternion(), bs = new THREE.Vector3();
    base.decompose(bp, bq, bs);
    // Where this figure's own clips hold the root: the standing idle's first frame, less the bind pose. The fitted
    // clips are anchored there, so a hand-over between the game's clips and the imported ones never slides the hips.
    // A rig whose idle leaves the root where it rests (or has no such track) says nothing, and its fit is the one it was.
    const hips = this.bones.get('root') ?? first;
    const idle = this.findClip(STATE_CLIPS.idle);
    const held = hips && idle ? this.actions.get(idle)!.getClip().tracks.find((t) => t.name === `${hips.name}.position`) : undefined;
    const rest = hips ? this.restPosition.get(hips) : undefined;
    const off: [number, number, number] | null = held && rest && held.values.length >= 3 ? [held.values[0] - rest.x, held.values[1] - rest.y, held.values[2] - rest.z] : null;
    const anchor = off && Math.hypot(off[0], off[1], off[2]) > 1e-4 ? off : null;
    return { joints, base: { p: [bp.x, bp.y, bp.z], q: [bq.x, bq.y, bq.z, bq.w] }, ...(anchor ? { anchor } : {}) };
  }

  /**
   * How the pose now stands against the bind pose, for the console (`__debug.anim()`): how far the hips are turned
   * from their rest, degrees, and how far each ankle stands over (+) or under (-) where it rests, metres, in the rig's
   * own frame, so a body standing on the ground reads its feet against the ground. Null on a skeleton without them.
   */
  poseAgainstRest(): { hipsFromRestDeg: number; leftAnkleM: number; rightAnkleM: number; chestLeanDeg: number | null; reachDeg: number | null } | null {
    const hips = this.bones.get('root'), left = this.bones.get('lAnkle'), right = this.bones.get('rAnkle');
    const restQ = hips ? this.restLocal.get(hips) : undefined;
    if (!hips || !left || !right || !restQ) return null;
    const skeleton = this.restSkeleton();
    const rest = restPlaces(skeleton);
    const at = (name: string) => skeleton.joints.findIndex((j) => j.name === name);
    this.root.updateWorldMatrix(true, true);
    const scale = this.root.getWorldScale(new THREE.Vector3()).y;
    const over = (bone: THREE.Bone, name: string) => (this.root.worldToLocal(bone.getWorldPosition(new THREE.Vector3())).y - rest.p[at(name) * 3 + 1]) * scale;
    const n = (v: number, digits: number) => Number(v.toFixed(digits));
    // Wave 2b's swing (`swingPelvis`): the chest's lean (the top of the spine to the neck, + forward) and the reach (the
    // shoulder to the hand's hold point, + up), degrees, in the figure's own frame; null on a skeleton without them.
    const local = (name: string) => {
      const b = this.bones.get(name);
      return b ? this.root.worldToLocal(b.getWorldPosition(new THREE.Vector3())) : null;
    };
    const s3 = local('spine3'), neck = local('neck'), arm = local('rArm'), hold = local('hold_r');
    const chestLeanDeg = s3 && neck ? n((Math.atan2(neck.z - s3.z, neck.y - s3.y) * 180) / Math.PI, 1) : null;
    const reachDeg = arm && hold ? n((Math.atan2(hold.y - arm.y, Math.hypot(hold.x - arm.x, hold.z - arm.z)) * 180) / Math.PI, 1) : null;
    return { hipsFromRestDeg: n((hips.quaternion.angleTo(restQ) * 180) / Math.PI, 2), leftAnkleM: n(over(left, 'lAnkle'), 3), rightAnkleM: n(over(right, 'rAnkle'), 3), chestLeanDeg, reachDeg };
  }

  /**
   * Where the two ankles are in the world just now, metres, for the console (`__debug.loco()`): a foot that is on the
   * ground and moves over it is a foot sliding, and this is what that is measured from. Null on a skeleton without them.
   */
  anklesNow(): { left: [number, number, number]; right: [number, number, number] } | null {
    const left = this.bones.get('lAnkle'), right = this.bones.get('rAnkle');
    if (!left || !right) return null;
    this.root.updateWorldMatrix(true, true);
    const at = (b: THREE.Bone): [number, number, number] => {
      const p = b.getWorldPosition(new THREE.Vector3());
      return [p.x, p.y, p.z];
    };
    return { left: at(left), right: at(right) };
  }

  /** Length of a clip in seconds, or null when the rig lacks it. */
  clipDuration(clip: string): number | null {
    const a = this.actions.get(clip);
    return a ? a.getClip().duration : null;
  }

  /** The clip playing under everything (the state's), by name, or null. */
  get currentClip(): string | null {
    return this.current?.getClip().name.replace(/^lower:/, '') ?? null;
  }

  /**
   * Where a clip puts the skeleton's root at its first frame, in the rig's own frame (a riding
   * clip's is the pelvis over the vehicle's origin: a speeder bike's 1.16 m up, a chair's 0.5 m).
   * Null when the rig lacks the clip or the clip leaves the root where the bind pose has it.
   */
  rootOffset(clip: string, out: THREE.Vector3): THREE.Vector3 | null {
    const a = this.actions.get(clip);
    if (!a) return null;
    let root: THREE.Bone | null = null;
    for (const b of this.bones.values()) if (!(b.parent instanceof THREE.Bone)) { root = b; break; }
    if (!root) return null;
    const track = a.getClip().tracks.find((t) => t.name === `${root!.name}.position`);
    if (!track || track.values.length < 3) return null;
    return out.set(track.values[0], track.values[1], track.values[2]).multiplyScalar(this.scale);
  }

  /**
   * Where a clip's first frame puts the eyes (the middle of the eye joints, else the head joint plus HEAD_TO_EYE) and
   * the pelvis (the root joint), in the frame the rig hangs in (the figure's, its scale and height slider included).
   * Worked out once per clip from the clip's own tracks, not the live pose, so a fidget never moves them. False without
   * the clip, a head, or with a scaled node on a chain (none in the packs).
   */
  seatedPoints(clip: string, eye: THREE.Vector3, pelvis: THREE.Vector3): boolean {
    let found = this.seatedCache.get(clip);
    if (found === undefined) {
      found = this.measureSeated(clip);
      this.seatedCache.set(clip, found);
      if (found) {
        const e = found.eye, p = found.pelvis;
        console.info(`rig: ${clip} puts the eyes ${e.y.toFixed(2)} m over the figure's origin, ${e.z.toFixed(2)} ahead, ${(e.y - p.y).toFixed(2)} over the pelvis`);
      } else console.info(`rig: ${clip} cannot say where the seated eyes are (no clip, no head, or a scaled joint): the stock seated figure stands in`);
    }
    if (!found) return false;
    this.root.updateMatrix();
    eye.copy(found.eye).applyMatrix4(this.root.matrix);
    pelvis.copy(found.pelvis).applyMatrix4(this.root.matrix);
    return true;
  }

  /** The measurement behind seatedPoints, in the rig root's own (unscaled) frame. */
  private measureSeated(clip: string): { eye: THREE.Vector3; pelvis: THREE.Vector3 } | null {
    const action = this.actions.get(clip);
    if (!action) return null;
    const tracks = new Map<string, ArrayLike<number>>();
    for (const t of action.getClip().tracks) tracks.set(t.name, t.values);
    const unit = (x: number) => Math.abs(x - 1) < 1e-4;
    // A joint's point: the chain from the root's child down to it, parent first, composed at the clip's first frame.
    const pointOf = (joint: THREE.Object3D, local: Vec3): Vec3 | null => {
      const chain: { name: string; restP: Vec3; restQ: Quat }[] = [];
      for (let o: THREE.Object3D | null = joint; o !== this.root; o = o.parent) {
        if (!o) return null; // not under the rig's root
        const bone = o as THREE.Bone;
        // The rest scale and the clip's first-frame scale, never the live pose, so the answer (cached, null included)
        // is the same whichever frame first asks.
        const scaleKey = tracks.get(`${o.name}.scale`);
        const s = (bone.isBone ? this.restScale.get(bone) : null) ?? o.scale;
        if (scaleKey && scaleKey.length >= 3) {
          if (!(unit(scaleKey[0]) && unit(scaleKey[1]) && unit(scaleKey[2]))) return null;
        } else if (!unit(s.x) || !unit(s.y) || !unit(s.z)) return null;
        const p = (bone.isBone ? this.restPosition.get(bone) : null) ?? o.position;
        const q = (bone.isBone ? this.restLocal.get(bone) : null) ?? o.quaternion;
        chain.push({ name: o.name, restP: [p.x, p.y, p.z], restQ: [q.x, q.y, q.z, q.w] });
      }
      chain.reverse();
      return chainPoint(clipLinks(chain, tracks), local);
    };
    let root: THREE.Bone | null = null;
    for (const b of this.bones.values()) if (!(b.parent instanceof THREE.Bone)) { root = b; break; }
    if (!root) return null;
    const pelvis = pointOf(root, [0, 0, 0]);
    if (!pelvis) return null;
    let left: THREE.Bone | null = null;
    let right: THREE.Bone | null = null;
    for (const [name, b] of this.bones) {
      if (!/^[lr]_?eye$/i.test(name)) continue;
      if (/^l/i.test(name)) left ??= b;
      else right ??= b;
    }
    let eye: Vec3 | null = null;
    if (left && right) {
      const l = pointOf(left, [0, 0, 0]);
      const r = pointOf(right, [0, 0, 0]);
      if (l && r) eye = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2];
    }
    if (!eye) {
      // No eye joints (the rodian, mon calamari and ithorian): the head joint plus a human's head-to-eye, in the figure's frame.
      const head = this.boneFor('head');
      const h = head ? pointOf(head, [0, 0, 0]) : null;
      if (!h) return null;
      eye = [h[0] + HEAD_TO_EYE[0], h[1] + HEAD_TO_EYE[1], h[2] + HEAD_TO_EYE[2]];
    }
    return { eye: new THREE.Vector3(eye[0], eye[1], eye[2]), pelvis: new THREE.Vector3(pelvis[0], pelvis[1], pelvis[2]) };
  }

  /**
   * Climbing II, phase 3: where each of `joints` (a bone by its name, '' the skeleton's root bone) stands at each of `times` in
   * `clip`, in the rig root's own (unscaled) frame, from the clip's own tracks (never the live pose, which this leaves as it
   * is), three numbers a joint a time into `out` (time first: `out[(i * joints.length + j) * 3]`). False without the clip or a
   * joint, or with a scaled node on a chain (none in the packs). An event's arithmetic, made once by its caller and kept (the
   * bar's swing measured off its clip at its first use, src/anim/barClips.ts).
   */
  sampleJoints(clip: string, joints: readonly string[], times: ArrayLike<number>, out: Float64Array): boolean {
    const action = this.actions.get(clip);
    if (!action) return false;
    const unit = (x: number) => Math.abs(x - 1) < 1e-4;
    const tracks = new Map<string, THREE.KeyframeTrack>();
    for (const t of action.getClip().tracks) tracks.set(t.name, t);
    let rootBone: THREE.Bone | null = null;
    for (const b of this.bones.values()) if (!(b.parent instanceof THREE.Bone)) { rootBone = b; break; }
    type Link = { restP: Vec3; restQ: Quat; p: THREE.Interpolant | null; q: THREE.Interpolant | null };
    const chains: Link[][] = [];
    for (const name of joints) {
      const joint = name === '' ? rootBone : this.boneNamed(name);
      if (!joint) return false;
      const chain: Link[] = [];
      for (let o: THREE.Object3D | null = joint; o !== this.root; o = o.parent) {
        if (!o) return false;
        const bone = o as THREE.Bone;
        const s = (bone.isBone ? this.restScale.get(bone) : null) ?? o.scale;
        const sk = tracks.get(`${o.name}.scale`);
        if (sk && sk.values.length >= 3 ? !(unit(sk.values[0]) && unit(sk.values[1]) && unit(sk.values[2])) : !(unit(s.x) && unit(s.y) && unit(s.z))) return false;
        const p = (bone.isBone ? this.restPosition.get(bone) : null) ?? o.position;
        const q = (bone.isBone ? this.restLocal.get(bone) : null) ?? o.quaternion;
        const pt = tracks.get(`${o.name}.position`);
        const qt = tracks.get(`${o.name}.quaternion`);
        chain.push({ restP: [p.x, p.y, p.z], restQ: [q.x, q.y, q.z, q.w], p: pt ? interpOf(pt) : null, q: qt ? interpOf(qt) : null });
      }
      chain.reverse();
      chains.push(chain);
    }
    const nj = joints.length;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      for (let j = 0; j < nj; j++) {
        const links = chains[j].map((L) => {
          const pv = L.p ? (L.p.evaluate(t) as ArrayLike<number>) : L.restP;
          const qv = L.q ? (L.q.evaluate(t) as ArrayLike<number>) : L.restQ;
          const l = Math.hypot(qv[0], qv[1], qv[2], qv[3]) || 1;
          return { p: [pv[0], pv[1], pv[2]] as Vec3, q: [qv[0] / l, qv[1] / l, qv[2] / l, qv[3] / l] as Quat };
        });
        const v = chainPoint(links, [0, 0, 0]);
        const k = (i * nj + j) * 3;
        out[k] = v[0];
        out[k + 1] = v[1];
        out[k + 2] = v[2];
      }
    }
    return true;
  }

  /**
   * Climbing II, phase 3 (maker B): a twin of `clip` under `name`, its very tracks as an action of its own (made once a rig: an
   * event, at the bar's first use), so the bar's flight can be crossfaded from the swing and back into the reach, which one
   * action cannot be into itself. True where the twin stands (made now or before); false without the clip.
   */
  twinClip(clip: string, name: string): boolean {
    if (this.actions.has(name)) return true;
    const src = this.actions.get(clip)?.getClip();
    if (!src) return false;
    this.actions.set(name, this.mixer.clipAction(new THREE.AnimationClip(name, src.duration, src.tracks)));
    return true;
  }

  /** The clip posing the arms right now: a shot on the upper body, a one-off, the upper layer, else the state clip. */
  armSource(): string {
    const shot = this.upperShot && !this.additive.has(this.upperShot.getClip().name.replace(/^(upper|lower):/, '')) ? this.upperShot : null;
    const a = shot ?? this.override ?? this.upper ?? this.current;
    return a ? a.getClip().name.replace(/^(upper|lower):/, '') : '';
  }

  /** Whether a one-off clip is still playing. */
  get overriding(): boolean {
    return this.override !== null;
  }

  /**
   * The one-off clip playing over the states, by its action's own name, or null: a whole-body one is
   * the clip's name as it was played, a half carries its `upper:` prefix. Nothing is made to answer, so
   * a body may ask on every frame whether the clip it put up is still the one playing.
   */
  get overrideName(): string | null {
    return this.override ? this.override.getClip().name : null;
  }

  /** Whether the one-off clip playing is one of Jedi Academy's (a swing, a flip), not a game transition. */
  get overridingJka(): boolean {
    return this.override !== null && this.override.getClip().name.replace(/^upper:/, '').startsWith('BOTH_');
  }

  /** Whether the one-off clip drives the upper body only, the state's clip keeping the legs. */
  private overrideUpper = false;

  get overridingUpperOnly(): boolean {
    return this.override !== null && this.overrideUpper;
  }

  /**
   * Take a one-off clip that poses the whole body off the legs: the clip goes on playing on the
   * spine, arms and head from where it is, and the state's clip has the legs from here on, so a
   * swing started running keeps the run under it, the way Jedi Academy plays its torso and legs
   * apart. (Nothing is done to a clip already on the upper body alone.)
   */
  overrideUpperOnly(): void {
    const full = this.override;
    if (!full || this.overrideUpper) return;
    const name = full.getClip().name;
    const up = this.half(name, 'upper');
    up.reset().setLoop(full.loop, Infinity).setEffectiveWeight(1);
    up.clampWhenFinished = true;
    up.timeScale = full.timeScale;
    up.time = full.time;
    up.fadeIn(0.1).play();
    full.fadeOut(0.1);
    this.override = up;
    this.overrideUpper = true;
    // The legs: the state's clip again, as its lower half.
    const state = this.state;
    this.state = null;
    if (state) this.setState(state, 0, this.wantedUpper);
  }

  /** The first of these clips the rig has, or null. */
  firstOf(...names: string[]): string | null {
    for (const n of names) if (this.actions.has(n)) return n;
    return null;
  }

  /**
   * The clip a selector picks for a value (`variant('skill_action_3', 'dance_18')`, `variant('loop_riding',
   * 'vehicle_hover_chair')`): the branch named for the value, else the branch whose value list holds it
   * (the game names a shared branch for its first value), else the plain default, else null.
   */
  variant(base: string, value: string): string | null {
    const exact = `${base}:${value}`;
    if (this.actions.has(exact)) return exact;
    const prefix = `${base}:`;
    for (const [clip, v] of Object.entries(this.variants)) if (clip.startsWith(prefix) && v.values.includes(value) && this.actions.has(clip)) return clip;
    return this.actions.has(base) ? base : null;
  }

  /** The mood the body is wearing, '' for none. */
  get mood(): string {
    return this.moodName;
  }

  /** Whether this pack really had a branch for that mood, so the body is posing it rather than merely holding the name. */
  get moodInBody(): boolean {
    return this.moodOnBody;
  }

  /**
   * The branch of a state's clip a mood picks, or null when this pack has none. It is the selector
   * machinery `variant` already uses, with two differences that matter here: only a branch under the
   * `mood` variable counts (a gender's or a speed's value must never be taken for a mood), and the
   * plain clip is **not** an answer -- "the pack has no branch for this mood" has to be tellable
   * from "the pack's branch is the default clip under another name", or a mood the conversion has
   * not run for yet would read as one that had.
   */
  private moodClip(base: string, value: string): string | null {
    const exact = `${base}:${value}`;
    if (this.actions.has(exact)) return exact;
    const prefix = `${base}:`;
    for (const [clip, v] of Object.entries(this.variants)) {
      if (v.variable !== 'mood' || !clip.startsWith(prefix)) continue;
      if (v.values.includes(value) && this.actions.has(clip)) return clip;
    }
    return null;
  }

  /**
   * Every value this pack's idle carries a branch for, which is what tells a pack converted before
   * the moods from one converted after. A pack with none answers with an empty list, which reads as
   * "not yet" everywhere and is never an error.
   *
   * It is the pack's own list and is not filtered here: the same conversion writes the entertainers'
   * performances and the scene NPCs' poses beside the moods, and what `/mood` may offer out of them
   * is `isMoodValue` in `moods.ts` -- the pack says what it carries, and the mood rules say which of
   * it is a mood. Console and chat only, so it may allocate.
   */
  moodValues(): string[] {
    const out: string[] = [];
    for (const state of MOOD_STATES) {
      const base = this.findClip(STATE_CLIPS[state]);
      if (!base) continue;
      const prefix = `${base}:`;
      for (const clip of this.actions.keys()) {
        if (!clip.startsWith(prefix)) continue;
        const v = this.variants[clip];
        // A branch under some other selector (a gender, a speed) is not a mood and is stepped over;
        // a branch the manifest says nothing about is named for its own value, as the converter names them.
        if (v && v.variable !== 'mood') continue;
        for (const value of v ? v.values : [clip.slice(prefix.length)]) {
          if (value && !out.includes(value)) out.push(value);
        }
      }
    }
    return out;
  }

  /**
   * Wear a mood, or `null` to take it off. The idle takes the mood's own branch when this pack has
   * one; everything else the body does is untouched, the walk, the run and the fight included.
   *
   * The answer is whether the body really took it: false for a mood the pack has no branch for,
   * which is every mood until the player pack has been converted with them, and which the caller
   * says in words rather than treating as a failure. A mood with no branch still leaves the body in
   * a clean state -- the state's clip is played again from the top through `setState`'s own restart,
   * because a preference taken away is not a change `setState` would otherwise notice, and an action
   * that has been faded out is disabled by three and would show the bind pose until it is reset.
   */
  setMood(mood: string | null, force = false): boolean {
    const want = typeof mood === 'string' ? mood.trim().toLowerCase() : '';
    if (!force && want === this.moodName) return this.moodOnBody;
    this.moodName = want;
    let took = false;
    for (const state of MOOD_STATES) {
      // `MOOD_TUNE.body` at 0 is the switch that makes the game exactly what it was: the name is
      // still worn (the chat keeps marking what you say) and nothing is preferred on the body.
      const base = want && MOOD_TUNE.body > 0 ? this.findClip(STATE_CLIPS[state]) : undefined;
      const clip = base ? this.moodClip(base, want) : null;
      if (clip) took = true;
      this.prefer(state, clip);
    }
    this.moodOnBody = took;
    this.restartState();
    return took;
  }

  /**
   * Play the state's clip again from the table, whether or not the state itself has changed.
   * `setState` leaves an action that is already up alone, so a preference taken away would go on
   * playing for ever; and three disables an action once its fade-out finishes, so one that comes
   * back after that has to be reset. Clearing the state is what makes `setState` take both branches.
   */
  private restartState(): void {
    const state = this.state;
    if (!state) return;
    this.state = null;
    this.setState(state, 0, this.wantedUpper);
  }

  /**
   * Play a clip over the state clips: once (then the state clip returns) or looping until
   * `stopOverride`. Returns its length in seconds at the given speed, or null when missing.
   * `from` starts a one-off that many seconds into the clip (an imported landing's trim: the part of
   * it before the feet come down is skipped), and what is returned is then what is left to play.
   */
  play(clip: string, { loop = false, fadeIn = 0.1, timeScale = 1, hold = false, upperOnly = false, from = 0, keepWeight = false }: { loop?: boolean; fadeIn?: number; timeScale?: number; hold?: boolean; upperOnly?: boolean; from?: number; keepWeight?: boolean } = {}): number | null {
    if (!this.actions.has(clip)) return null;
    // Never past the clip's own end, less a moment, so a trim set too long still shows its last pose and ends.
    const startAt = from > 0 ? Math.min(from, Math.max(0, this.actions.get(clip)!.getClip().duration - 0.02)) : 0;
    // A one-off chained onto one already on the upper body alone (a swing's follow-through after
    // the swing) stays on the upper body: the legs go on with what they were doing.
    if (upperOnly && this.overrideUpper && this.override) {
      const next = this.half(clip, 'upper');
      const was = this.override;
      next.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity).setEffectiveWeight(1);
      next.clampWhenFinished = true;
      next.timeScale = timeScale;
      next.play();
      if (startAt > 0) next.time = startAt;
      if (was !== next) was.crossFadeTo(next, fadeIn, false);
      else next.fadeIn(0);
      // The swing fading out under the one chained on (the swings' own pelvis, `swingTurn`, blends the two by their weights).
      this.swingFading = was !== next ? was : null;
      this.override = next;
      const duration = (next.getClip().duration - startAt) / Math.max(1e-3, Math.abs(timeScale));
      this.overrideEnds = loop || hold ? Infinity : duration;
      this.overrideTime = 0;
      return duration;
    }
    const next = this.actions.get(clip)!;
    const was = this.override ?? this.current;
    if (this.upper) {
      // A one-off clip poses the whole body; the upper layer comes back with the state after it.
      this.upper.fadeOut(fadeIn);
      this.upper = null;
      this.upperName = null;
    }
    next.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity).setEffectiveWeight(1);
    next.clampWhenFinished = true;
    next.timeScale = timeScale;
    next.play();
    if (startAt > 0) next.time = startAt;
    if (this.overrideUpper && was) {
      // The last one-off had the upper body alone; this one takes the whole body, so the legs' clip goes too.
      was.fadeOut(fadeIn);
      this.swingFading = was;
      if (this.current && this.current !== was) this.current.fadeOut(fadeIn);
      next.fadeIn(fadeIn);
    } else if (was && was !== next) {
      // Climbing II, Smoothness II, item 2 after its review (`keepWeight`, the hang's one-offs under `climb.transitions`
      // 'blend'): a clip still fading in fades out from the weight it has, never from a whole one (three's fade out starts at
      // one: a grab begun while the falling loop was three quarters in jumped it to all of it in a frame).
      if (keepWeight && was.enabled && was.getEffectiveWeight() < 1) was.setEffectiveWeight(was.getEffectiveWeight());
      was.crossFadeTo(next, fadeIn, false);
    }
    else if (was === next) next.fadeIn(0);
    this.overrideUpper = false;
    this.override = next;
    const duration = (next.getClip().duration - startAt) / Math.max(1e-3, Math.abs(timeScale));
    // A held clip keeps its last frame until the next one-off clip or `stopOverride` (a saber
    // move chains straight into the next without a dip back to the stance).
    this.overrideEnds = loop || hold ? Infinity : duration;
    this.overrideTime = 0;
    return duration;
  }

  /**
   * Climbing II, Smoothness II, item 1: the whole-body one-off playing now played at `rate` of its own rate from this frame
   * (a timed hop's flight, a drop's fall): the climbing's clock and the pose keep one time. Nothing while none plays.
   */
  overrideRate(rate: number, clip: string | null = null): void {
    const o = this.override;
    if (o && !this.overrideUpper && (clip === null || o.getClip().name === clip)) o.timeScale = rate;
  }

  /** Smoothness II, item 1: the whole-body one-off `clip` (when it is the one playing) put `t` seconds into its clip. */
  overrideSeek(t: number, clip: string): void {
    const o = this.override;
    if (o && !this.overrideUpper && o.getClip().name === clip) o.time = t;
  }

  /**
   * Smoothness III, item 1 (the review's): `overrideSeek` and `overrideRate` for a hop's move every frame, the seconds and the
   * rate read from `overrideSeekAt` and `overrideRateAt`, which the caller writes just before: a number handed across the call was
   * made anew every frame of every hop.
   */
  overrideSeekNow(clip: string): void {
    const o = this.override;
    if (o && !this.overrideUpper && o.getClip().name === clip) o.time = this.overrideSeekAt;
  }

  overrideRateNow(): void {
    const o = this.override;
    if (o && !this.overrideUpper) o.timeScale = this.overrideRateAt;
  }

  /** `overrideSeekNow`'s seconds and `overrideRateNow`'s rate (written by the caller first). */
  overrideSeekAt = 0.5;
  overrideRateAt = 0.5;

  /**
   * Smoothness II, item 1: the whole-body one-off `clip` (when it is the one playing) held past its own end for `lease` more
   * seconds of the rig's time, the caller renewing it every frame it drives the clip (a drop played by the owner's rule): a
   * hold its driver stops renewing (the body taken by a path that runs no drop) lets go by itself, as a one-off's end does.
   */
  holdOverride(clip: string, lease: number): void {
    const o = this.override;
    if (o && !this.overrideUpper && o.getClip().name === clip) this.overrideEnds = this.overrideTime + lease;
  }

  /** The whole-body one-off's own time now (seconds into its clip), NaN while none plays: the climbing's tests read it. */
  overrideAt(): number {
    const o = this.override;
    return o && !this.overrideUpper ? o.time : Number.NaN;
  }

  /**
   * Climbing II, Smoothness II, item 2 (`climb.transitions` 'blend'): end the whole-body one-off by crossfading it straight
   * into the clip of the state as it stands now (never through the clip that played before the one-off), that clip started
   * where its pose is nearest the one-off's own last pose (`nearestPhase`), over `fade` seconds. As `yieldOverride`, with the
   * phase. Nothing while none plays.
   */
  blendOut(fade: number): void {
    const ending = this.override;
    if (!ending) return;
    if (this.overrideUpper) {
      this.stopOverride(fade);
      return;
    }
    const state = this.state;
    const upper = this.wantedUpper;
    this.override = null;
    this.current = ending;
    this.state = null;
    this.upperName = null;
    if (state) this.setState(state, 0, upper, { fade });
    const next = this.current;
    if (next === ending) {
      ending.fadeOut(fade);
      return;
    }
    if (next) {
      // The loop picked up where its pose is nearest the one-off's last (its own time: a fade starts the clip from nought).
      next.time = this.nearestPhase(ending.getClip(), next.getClip());
      ending.crossFadeTo(next, fade, false);
    }
  }

  /**
   * Smoothness II, item 2: a clip `setState` changes to is taken up where its pose is nearest the one it fades from (the wall
   * climb's caller sets it before its `setState` under `climb.transitions` 'blend'; false everywhere else, as ever).
   */
  nearestNext = false;

  /** Each pair's answer, kept (an event's arithmetic, once a pair a session): one-off clip name, a tab, the loop's. */
  private readonly phaseCache = new Map<string, number>();

  /**
   * The time in `loop` whose pose is nearest `from`'s last frame: every joint's turn compared (the sum of the angles between
   * the two quaternions, the hips' place by its distance at a radian a metre), at each of the loop's own keyframes. Worked out
   * once a pair and kept.
   */
  nearestPhase(from: THREE.AnimationClip, loop: THREE.AnimationClip, fromTime = Number.NaN): number {
    // At its last frame (a one-off ending: kept), or at a time of its own (a loop left part way: an event, worked out each time).
    const atEnd = !(fromTime === fromTime);
    const key = `${from.name}\t${loop.name}`;
    const known = atEnd ? this.phaseCache.get(key) : undefined;
    if (known !== undefined) return known;
    const last = new Map<string, number[]>();
    for (const tr of from.tracks) {
      const vs = tr.values;
      const n = tr.getValueSize();
      const k = tr.times.length - 1;
      if (k < 0) continue;
      if (atEnd) last.set(tr.name, Array.from(vs.slice(k * n, k * n + n)));
      else last.set(tr.name, Array.from(interpOf(tr).evaluate(fromTime) as ArrayLike<number>));
    }
    let times: ArrayLike<number> = [0];
    for (const tr of loop.tracks) if (tr.times.length > times.length) times = tr.times;
    let best = 0;
    let bestCost = Infinity;
    const interps = loop.tracks.map((tr) => interpOf(tr));
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      let cost = 0;
      for (let j = 0; j < loop.tracks.length; j++) {
        const tr = loop.tracks[j];
        const want = last.get(tr.name);
        if (!want) continue;
        const v = interps[j].evaluate(t) as ArrayLike<number>;
        if (tr.getValueSize() === 4) {
          const d = Math.abs(v[0] * want[0] + v[1] * want[1] + v[2] * want[2] + v[3] * want[3]);
          cost += 2 * Math.acos(d > 1 ? 1 : d);
        } else if (tr.getValueSize() === 3 && /\.position$/.test(tr.name)) {
          const dx = v[0] - want[0];
          const dy = v[1] - want[1];
          const dz = v[2] - want[2];
          cost += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = t;
      }
    }
    if (atEnd) this.phaseCache.set(key, best);
    return best;
  }

  /** End a one-off clip early and fade the state clip back in. */
  stopOverride(fade = 0.15): void {
    if (!this.override) return;
    if (this.overrideUpper) {
      // The upper body's clip goes; the state's clip comes back whole over the legs it kept.
      this.override.fadeOut(fade);
      // A swing fading out still stands on its own pelvis by its weight (`swingTurn`), or the chest drops onto the legs' hips.
      this.swingFading = this.override;
      this.override = null;
      this.overrideUpper = false;
      const state = this.state;
      this.state = null;
      if (state) this.setState(state, 0, this.wantedUpper);
      return;
    }
    const back = this.current;
    if (back && back !== this.override) {
      back.reset().setEffectiveWeight(1).play();
      this.override.crossFadeTo(back, fade, false);
    } else this.override.fadeOut(fade);
    this.override = null;
  }

  /**
   * End a whole-body one-off early and fade straight into the clip of the state as it stands now, over `fade`
   * seconds: what an imported landing does when the keys cut it short (src/anim/bodyAnim.ts). `stopOverride` fades
   * back to the clip that was playing when the one-off began and leaves the state it remembered since as it is, which
   * is right where the stop and the state's change come in one frame (a swimmer, a rider) and wrong after a one-off
   * has played a while: a body that landed standing and was then told to run was left in the idle, sliding, since
   * the state it was asked for was already the one remembered. A one-off on the upper body alone ends as it always did.
   */
  yieldOverride(fade = 0.15): void {
    const ending = this.override;
    if (!ending) return;
    if (this.overrideUpper) {
      this.stopOverride(fade);
      return;
    }
    // As a one-off's own end does (`update`): the state's clip is resolved afresh with the one-off as what it fades from.
    const state = this.state;
    const upper = this.wantedUpper;
    this.override = null;
    this.current = ending;
    this.state = null;
    this.upperName = null;
    if (state) this.setState(state, 0, upper);
    if (this.current === ending) ending.fadeOut(fade);
    else if (this.current) ending.crossFadeTo(this.current, fade, false);
  }

  /**
   * Play the state's clip. With `upper`, that clip drives the legs only and `upper` (a stance)
   * drives the spine, arms and head: the saber held up while the legs swim.
   */
  setState(state: RigState, speed = 0, upper: string | null = null, opts?: { rate?: number; fade?: number }): void {
    this.wantedUpper = upper;
    // How long a change of clip takes to fade (the speed classes say; the game's own 0.18 otherwise).
    const fade = opts?.fade ?? 0.18;
    if (this.override && !this.overrideUpper) {
      // A one-off clip is playing; remember the state for when it ends.
      this.state = state;
      return;
    }
    // A one-off clip on the upper body alone: the state drives the legs only, and no layer of its own.
    const legsOnly = this.override !== null;
    const wantedStance = this.preferredClip(state);
    // A one-shot on the upper body takes the layer while it plays; the caller's layer returns after it.
    const upperName = legsOnly ? null : (this.shotName ?? (upper && this.actions.has(upper) ? upper : null));
    const playing = this.current?.getClip().name.replace(/^lower:/, '');
    if (state !== this.state || this.repick || (wantedStance && playing !== wantedStance) || upperName !== this.upperName) {
      this.repick = false;
      const clipName = wantedStance ?? this.findClip(STATE_CLIPS[state]);
      const next = clipName ? (upperName || legsOnly ? this.half(clipName, 'lower') : this.actions.get(clipName)!) : null;
      // The same action already playing is left alone, unless it was faded out (a one-off clip
      // took the whole body from it meanwhile) and has gone dead: then it is started again.
      if (next && (next !== this.current || !next.enabled)) {
        const same = next === this.current;
        // Two striding clips fade with their feet in step: the incoming one starts where the outgoing one is in its
        // own stride, and the two then advance at one phase rate until the fade is done (`stepSync`). A clip with no
        // stride (every one of the game's own) fades plain, from its start, as it always did.
        const was = this.current;
        const a = was && !same && was.enabled ? (this.strideOf(was) ?? this.stairStrideOf(was)) : null;
        const b = a ? this.strideOf(next) : null;
        const startAt = a && b ? timeAtPhase(phaseAt(was!.time, a), b, next.getClip().duration) : 0;
        // A held clip (a stance) plays once and keeps its last frame.
        next.reset().setLoop(this.hold.has(clipName!) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).setEffectiveWeight(1).play();
        next.clampWhenFinished = true;
        // Climbing II, Smoothness II, item 2 (the wall climb's clips under `climb.transitions` 'blend', `nearestNext`): the clip
        // taken up where its pose is nearest the one it fades from as that one stands now (never a striding pair, which keep
        // their step).
        if (this.nearestNext && was && !same && was.enabled && !(a && b)) next.time = this.nearestPhase(was.getClip(), next.getClip(), was.time);
        this.syncOn = false;
        if (a && b && was) {
          next.time = startAt;
          this.syncOn = true;
          this.syncFrom = was;
          this.syncNext = next;
          this.syncA = a;
          this.syncB = b;
          this.syncT = 0;
          this.syncFade = fade;
          this.syncFromRate = was.timeScale / a.cycle;
          this.syncWanted = was.timeScale;
        }
        if (this.current && !same) this.current.crossFadeTo(next, fade, false);
        else if (same) next.fadeIn(0.12);
        this.current = next;
      }
      const nextUpper = upperName ? this.half(upperName, 'upper') : null;
      if (nextUpper !== this.upper && !legsOnly) {
        const shot = upperName !== null && upperName === this.shotName;
        if (this.upper) this.upper.fadeOut(shot ? 0.05 : 0.18);
        if (nextUpper) {
          nextUpper.reset().setLoop(shot || this.hold.has(upperName!) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).setEffectiveWeight(1).fadeIn(shot ? 0.05 : 0.18).play();
          nextUpper.clampWhenFinished = true;
        }
        this.upper = nextUpper;
      }
      this.upperName = upperName;
      this.state = state;
    }
    if (!this.current) return;
    // The rate the caller worked out (the speed classes, inside their own band), else the body's speed over the
    // clip's own, inside the game's band, else the clip's own rate. (A striding clip's own speed is worked out here
    // and never asked of `clipSpeed`: a number handed back across a call is a number made, and this is every frame.)
    let wanted = 1;
    if (opts?.rate !== undefined) wanted = opts.rate;
    else if (speed > 0) {
      const clip = this.current.getClip().name.replace(/^lower:/, '');
      const stride = this.strides.size ? this.strides.get(clip) : undefined;
      const natural = stride ? stride.speed * this.root.scale.y : this.clipSpeeds[clip] || DEFAULT_CLIP_SPEED[state];
      if (natural) wanted = THREE.MathUtils.clamp(speed / natural, 0.5, 2.5);
    }
    // Part way through a fade in step, the rate is the two clips' shared one, written each frame by `stepSync`.
    if (this.syncOn && this.syncNext === this.current) this.syncWanted = wanted;
    else this.current.timeScale = wanted;
  }

  /**
   * Two striding clips part way through a fade: both advance at one phase rate, the outgoing clip's own as the fade
   * began eased to the incoming clip's own as it ends, so the left feet of the two land together all the way through.
   * Over as soon as the fade is, or anything else takes the body.
   */
  private stepSync(dt: number): void {
    const from = this.syncFrom, next = this.syncNext, a = this.syncA, b = this.syncB;
    if (!from || !next || !a || !b || next !== this.current || (this.override !== null && !this.overrideUpper)) {
      this.syncOn = false;
      return;
    }
    this.syncT += dt;
    const w = this.syncFade > 0 ? Math.min(1, this.syncT / this.syncFade) : 1;
    const rate = sharedRate(this.syncFromRate, this.syncWanted / b.cycle, w);
    from.timeScale = rate * a.cycle;
    next.timeScale = rate * b.cycle;
    if (w >= 1) {
      this.syncOn = false;
      next.timeScale = this.syncWanted;
    }
  }

  update(dt: number): void {
    this.stepDt = dt;
    if (this.syncOn) this.stepSync(dt);
    this.stepDuck(dt); // item 4: the duck layer
    // The feet's placement (wave 3, src/player/footIk.ts) turned the legs after the mixer last frame: their clean pose
    // goes back before the mixer runs, since it writes a joint only when its clip's value moved, and a leg the clip held
    // still would otherwise keep last frame's turn and the next placement would stack on it.
    // Wave 4: the hands' and the wall feet's (src/player/limbPlace.ts) first, since they were placed after the feet's: each
    // puts back what it found, so the last to turn a joint is the first to put it back.
    this.limbPose?.restore();
    this.legPose?.restore();
    this.mixer.update(dt);
    // The mixer writes a joint only when its clip's value moved since the last frame, so a neck or head the look
    // turned last frame still carries that turn on a frame the clip held it still. The first-person eye reads the
    // head before `lookToward` runs, so the clean pose goes back here: left to `lookToward`, every frame the clip
    // held the neck put the eye where last frame's look had it, and the view shook back and forth by a centimetre.
    if (this.lookTurned && this.lookBones) {
      this.cleanLookBone(this.lookBones.neck);
      this.cleanLookBone(this.lookBones.head);
    }
    // The duck's neck bend (item 4), laid on under the look: put back after the look's own, the last laid first.
    const dn = this.duckNeckTurn;
    if (dn.on && dn.bone) {
      if (dn.bone.quaternion.equals(dn.turned)) dn.bone.quaternion.copy(dn.clean);
      dn.on = false;
    }
    if (this.upperShot) {
      this.upperShotTime += dt;
      if (this.upperShotTime >= this.upperShotEnds - 0.05) {
        this.upperShot.fadeOut(0.12);
        this.upperShot = null;
      }
    }
    if (this.shotName) {
      this.upperShotTime += dt;
      // The layer the caller wants comes back through the next setState once the shot is done.
      if (this.upperShotTime >= this.upperShotEnds - 0.08) this.shotName = null;
    }
    if (this.override) {
      this.overrideTime += dt;
      if (this.overrideTime >= this.overrideEnds - 0.08) {
        if (this.overrideUpper) {
          // The upper body's clip is done: the state's clip comes back whole over the legs it kept.
          this.stopOverride(0.12);
          return;
        }
        // Fade straight from the one-off clip into the state's clip just before it holds its last
        // frame (not through the clip that played before it, which would show as a hitch).
        const state = this.state;
        const upper = this.wantedUpper;
        const ending = this.override;
        this.override = null;
        this.current = ending;
        this.state = null;
        this.upperName = null;
        if (state) this.setState(state, 0, upper);
        if (this.current === ending) ending.fadeOut(0.12);
      }
    }
  }

  /** The clip a state prefers, when the rig has it: a name, or the first clip a pattern matches. */
  private preferredClip(state: RigState): string | null {
    const p = this.preferred.get(state);
    if (!p) return null;
    if (p instanceof RegExp) return this.findClip([p]) ?? null;
    return this.actions.has(p) ? p : null;
  }

  /** The first clip whose name a pattern matches, or undefined. */
  clipMatching(pattern: RegExp): string | undefined {
    return this.findClip([pattern]);
  }

  /** Every clip a pattern matches. */
  clipsMatching(pattern: RegExp): string[] {
    return [...this.actions.keys()].filter((n) => pattern.test(n));
  }

  /**
   * Play a clip once on the upper body only, over the legs' state clip (a shot fired while running).
   * An additive clip (the game's add_ shots) goes on top of everything; any other takes the upper
   * layer for its length, with the state clip driving the legs only meanwhile.
   */
  playUpper(clip: string, fadeIn = 0.05): number | null {
    if (!this.actions.has(clip)) return null;
    const duration = this.actions.get(clip)!.getClip().duration;
    if (this.additive.has(clip)) {
      const action = this.half(clip, 'upper');
      if (this.upperShot && this.upperShot !== action) this.upperShot.fadeOut(fadeIn);
      action.reset().setLoop(THREE.LoopOnce, 1).setEffectiveWeight(1).fadeIn(fadeIn).play();
      action.clampWhenFinished = true;
      this.upperShot = action;
      this.upperShotTime = 0;
      this.upperShotEnds = duration;
      return duration;
    }
    if (this.override) return null; // a one-off clip has the whole body
    this.shotName = clip;
    this.upperShotTime = 0;
    this.upperShotEnds = duration;
    // Restart the layer even when the same shot is already up.
    if (this.upperName === clip) {
      this.upper?.reset().play();
    } else if (this.state) {
      const state = this.state;
      this.state = null;
      this.setState(state, 0, this.wantedUpper);
    }
    return duration;
  }

  /** Ask a state to play `clip` when the rig has it: a name or a pattern (null goes back to the state's table). */
  prefer(state: RigState, clip: string | RegExp | null, repick = false): void {
    if (clip) this.preferred.set(state, clip);
    // Taken off with `repick`, the state in force picks its clip again at its next `setState`: a preference removed
    // leaves the clip it had asked for playing for as long as the state stays the same (a stance's, a crouch's, as it
    // always was), which is wrong for a clip the speed classes had put on a state they have just let go of.
    else if (this.preferred.delete(state) && repick && state === this.state) this.repick = true;
  }

  /** The state in force has had its preference taken off and picks its clip again at its next `setState` (`prefer`). */
  private repick = false;

  /** The speed, in metres a second, the clip a state would play was made for, or null when unknown. */
  naturalSpeed(state: RigState): number | null {
    const clip = this.preferredClip(state) ?? this.findClip(STATE_CLIPS[state]);
    return (clip && (this.clipSpeed(clip) ?? 0)) || DEFAULT_CLIP_SPEED[state] || null;
  }

  /** What plays now, for the console. */
  describe(): { state: RigState | null; clip: string | null; upper: string | null; override: string | null; shot: string | null; weights: Record<string, number> } {
    const weights: Record<string, number> = {};
    for (const a of [this.current, this.upper, this.override, this.upperShot]) if (a) weights[a.getClip().name] = Number(a.getEffectiveWeight().toFixed(2)) + (a.enabled ? 0 : -100);
    return { state: this.state, clip: this.current?.getClip().name ?? null, upper: this.upperName, override: this.override?.getClip().name ?? null, shot: this.shotName ?? this.upperShot?.getClip().name.replace(/^upper:/, '') ?? null, weights };
  }

  /** The four slots `activeClips` reads, kept so that reading them makes no array of its own. */
  private readonly clipSlots: (THREE.AnimationAction | null)[] = [null, null, null, null];

  /**
   * The actions this rig is playing, for whatever reads a clip's own event markers: the state's
   * clip (or its lower half while something rides the upper body), the upper layer, a one-off and a
   * shot. Those four are the whole of it -- nothing else is ever started here -- so this costs four
   * lookups rather than a walk of the twelve hundred clips a species pack holds.
   *
   * `out` is the caller's own array, filled in place and never replaced, and the count is returned:
   * a frame allocates nothing. A record's `token` is the action itself, which is how the reader
   * remembers where each one had got to.
   */
  activeClips(out: ActiveClip[]): number {
    let n = 0;
    // The four are refilled into a kept array rather than listed in a literal, which would make one
    // per call, and this is called for every body in earshot every frame.
    const slots = this.clipSlots;
    slots[0] = this.current;
    slots[1] = this.upper;
    slots[2] = this.override;
    slots[3] = this.upperShot;
    for (const action of slots) {
      if (!action || !action.enabled || !action.isRunning()) continue;
      const weight = action.getEffectiveWeight();
      if (weight <= 0) continue;
      const clip = action.getClip();
      const name = clip.name;
      const half: ClipHalf = name.startsWith('upper:') ? 'upper' : name.startsWith('lower:') ? 'lower' : 'whole';
      let row = out[n];
      if (!row) {
        row = { name: '', half: 'whole', time: 0, duration: 0, timeScale: 1, weight: 0, looping: false, token: action };
        out[n] = row;
      }
      row.name = half === 'whole' ? name : bareClipName(name);
      row.half = half;
      row.time = action.time;
      row.duration = clip.duration;
      row.timeScale = action.timeScale;
      row.weight = weight;
      row.looping = action.loop === THREE.LoopRepeat;
      row.token = action;
      n++;
    }
    return n;
  }

  /** Whether the torso is held steady over locomotion legs while a pose rides the upper body. */
  steady = true;
  /**
   * Seconds the steady hold takes to come on as the legs start to walk or run and to go as they stop: 0, at once,
   * as it always was. The hold takes the pelvis's whole turn off the torso, and a strafe's hips stand turned a
   * dozen degrees, so on at once it swung a pose on the upper body (an aimed blaster) that far in the one frame
   * the legs started or stopped; whoever fades the legs' clip sets this to that fade (`Player`, the speed classes).
   */
  steadyEase = 0;
  /** How much of the steady hold is on, 0 to 1: at once with no `steadyEase`, eased over it otherwise. */
  private steadyShare = 1e-9;
  /** The last update's step, for what is eased after the mixer (`steadyShare`). */
  private stepDt = 1 / 60;

  /** Each Jedi Academy clip's own pelvis, as an interpolant over its track (made once a clip; null where it has none). */
  private readonly swingPelvisOf = new Map<THREE.AnimationClip, THREE.Interpolant | null>();
  /** The swing fading out under one chained onto the upper body (`play`'s `upperOnly`), while it fades. */
  private swingFading: THREE.AnimationAction | null = null;

  /**
   * A Jedi Academy swing's own pelvis at its moment, into `q`, and the swing's weight; nought (`q` untouched) for an
   * action that is no swing on the upper body alone, or whose clip has no track for the pelvis.
   */
  private swingPelvisAt(action: THREE.AnimationAction, pelvis: string, q: THREE.Quaternion): number {
    const name = action.getClip().name;
    if (!name.startsWith('upper:BOTH_')) return 0;
    const full = this.actions.get(name.slice('upper:'.length))?.getClip();
    if (!full) return 0;
    let at = this.swingPelvisOf.get(full);
    if (at === undefined) {
      const track = full.tracks.find((t) => t.name === `${pelvis}.quaternion`);
      // The track's own (spherical) interpolation, made once with a buffer of its own.
      at = track ? new THREE.QuaternionLinearInterpolant(track.times, track.values, 4, new Float32Array(4)) : null;
      this.swingPelvisOf.set(full, at);
    }
    if (!at) return 0;
    const w = action.getEffectiveWeight();
    if (!(w > 0)) return 0;
    const v = at.evaluate(action.time);
    q.set(v[0], v[1], v[2], v[3]).normalize();
    return w;
  }

  /**
   * Wave 2b (`ANIM_TUNE.swingPelvis` 'mended'): a Jedi Academy swing riding the upper body alone stands on its own
   * pelvis. Its spine's keys are turns against the pelvis, so over the legs' pelvis the whole upper body took the legs'
   * hips: a medium or strong swing (its hips bent 16 to 30 degrees into the strike) over the back-pedal (8.5 degrees) or
   * a walk stood up to 30 degrees further back and passed over people. The turn from the legs' pelvis to the swing's own
   * at the swing's moment, for the lowest spine bone, so that bone and all above it stand in the figure as the
   * whole-body swing has them; by the swing's weight (a swing fading out under one chained on blended in by its own), so
   * it comes and goes with the swings' fades. False (and `out` untouched) when no such swing rides, and always under
   * 'before'.
   */
  private swingTurn(bone: THREE.Bone, out: THREE.Quaternion): boolean {
    if (ANIM_TUNE.swingPelvis !== 'mended') return false;
    const ride = this.override && this.overrideUpper ? this.override : null;
    if (!ride && !this.swingFading) return false;
    const parent = bone.parent;
    if (!(parent instanceof THREE.Bone) || this.upperBones().has(parent.name)) return false;
    const now = ride ? this.swingPelvisAt(ride, parent.name, swingQ) : 0;
    const fading = this.swingFading;
    const was = fading && fading !== ride ? this.swingPelvisAt(fading, parent.name, swingWasQ) : 0;
    const total = now + was;
    if (!(total > 0)) return false;
    if (now <= 0) swingQ.copy(swingWasQ);
    else if (was > 0) swingQ.copy(swingWasQ.slerp(swingQ, now / total));
    out.copy(parent.quaternion).invert().multiply(swingQ);
    if (total < 1) out.slerpQuaternions(IDENTITY_Q, steadyFullQ.copy(out), total);
    return true;
  }

  /**
   * With a pose riding the upper body over locomotion legs, the pelvis's rock from the run would carry
   * the torso with it: the turn that takes the pelvis back to its rest, to go on the lowest spine bone
   * so the torso sits as if the pelvis stood still while the legs run. Identity when nothing rides.
   */
  private steadyTurn(bone: THREE.Bone, out: THREE.Quaternion): THREE.Quaternion {
    out.identity();
    // Only over walking and running legs: a posture's pelvis (prone, kneeling, swimming) is meant to be turned.
    const wanted = !!this.upper && this.steady && !!this.state && LOCOMOTION_STATES.has(this.state);
    if (this.steadyEase > 0) {
      const step = this.stepDt / this.steadyEase;
      this.steadyShare = wanted ? Math.min(1, this.steadyShare + step) : Math.max(0, this.steadyShare - step);
    } else this.steadyShare = wanted ? 1 : 0;
    // Going, it eases out under whatever pose still rides the upper body; with none there is nothing to hold.
    if (this.steadyShare <= 0 || !this.upper || !this.steady) return out;
    const parent = bone.parent;
    if (!(parent instanceof THREE.Bone) || this.upperBones().has(parent.name)) return out;
    const rest = this.restLocal.get(parent);
    if (!rest) return out;
    out.copy(parent.quaternion).invert().multiply(rest);
    // Part way: that share of the turn from none (the whole of it is left exactly as it was worked out).
    if (this.steadyShare < 1) out.slerpQuaternions(IDENTITY_Q, steadyFullQ.copy(out), this.steadyShare);
    return out;
  }

  /** The bones from the lowest spine bone up: the torso, arms and head. */
  private upperBones(): Set<string> {
    if (this.upperBoneNames) return this.upperBoneNames;
    const names = new Set<string>();
    let base: THREE.Bone | null = null;
    for (const [name, bone] of this.bones) if (/^spine_?1$/i.test(name)) base = bone;
    base ??= this.boneFor('spine');
    // Walk down to the lowest spine bone so the whole torso is one layer.
    while (base?.parent instanceof THREE.Bone && /spine|torso|chest/i.test(base.parent.name)) base = base.parent;
    base?.traverse((o) => names.add(o.name));
    this.upperBoneNames = names;
    return names;
  }

  /** How a clip splits into its halves, for the console: which bones each half drives, and where the split is. */
  splitInfo(clip: string): { base: string | null; upper: string[]; lower: string[]; weights: Record<string, number> } | null {
    const src = this.actions.get(clip)?.getClip();
    if (!src) return null;
    const upper = this.upperBones();
    const names = src.tracks.map((t) => THREE.PropertyBinding.parseTrackName(t.name).nodeName ?? '');
    let base: THREE.Bone | null = null;
    for (const [name, bone] of this.bones) if (/^spine_?1$/i.test(name)) base = bone;
    base ??= this.boneFor('spine');
    while (base?.parent instanceof THREE.Bone && /spine|torso|chest/i.test(base.parent.name)) base = base.parent;
    const weights: Record<string, number> = {};
    for (const a of [this.current, this.upper, this.override, this.upperShot]) if (a) weights[a.getClip().name] = Number(a.getEffectiveWeight().toFixed(2)) + (a.enabled ? 0 : -100);
    return { base: base?.name ?? null, upper: [...new Set(names.filter((n) => upper.has(n)))], lower: [...new Set(names.filter((n) => !upper.has(n)))], weights };
  }

  /** A clip's tracks for one half of the body only, as an action of its own. */
  private half(clip: string, half: 'upper' | 'lower'): THREE.AnimationAction {
    const key = `${half}:${clip}`;
    let action = this.halves.get(key);
    if (action) return action;
    const src = this.actions.get(clip)!.getClip();
    // The split is always at the lowest spine bone; a clip that drives only some joints (a shot on the
    // arms) simply has no tracks for the rest, so its lower half is empty and its upper half is its own joints.
    const upper = this.upperBones();
    const tracks = src.tracks.filter((t) => upper.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName ?? '') === (half === 'upper'));
    action = this.mixer.clipAction(new THREE.AnimationClip(key, src.duration, tracks), undefined, this.additive.has(clip) ? THREE.AdditiveAnimationBlendMode : THREE.NormalAnimationBlendMode);
    this.halves.set(key, action);
    return action;
  }

  /**
   * The spine bones the twist is spread over, worked out once. `bones` is filled in the
   * constructor and never added to, so this cannot go stale; it was a spread, a filter and a
   * regular expression per bone on **every call**, which was once a frame for the player and is
   * now once a frame for every gun-armed fighter in the world as well.
   */
  private spines: THREE.Bone[] | null = null;

  private spineBones(): THREE.Bone[] {
    if (!this.spines) {
      const found: THREE.Bone[] = [];
      for (const b of this.bones.values()) if (/^spine_?[1-3]$/i.test(b.name)) found.push(b);
      this.spines = found;
    }
    return this.spines;
  }

  /**
   * The feedback round, item 4: the duck's crouch layered over the state's clip, by share. Two layers (the crouch's idle while
   * still, its walk while moving), each a copy of the crouch clip with the arms' tracks left out (so what the hands hold keeps
   * the state's pose), mixed in by the mixer's own weighted average: a layer at share s of the bones over a state at weight one
   * is a weight of s over one less the shares. The walk's layer keeps step with a striding state clip (the incoming clip's
   * phase, as a fade between two strides does), else plays at the state's rate. A share eases in and out over `DUCK_FADE`.
   */
  private stepDuck(dt: number): void {
    // Nothing asked and nothing still easing out: nothing to step (the frame of a body that never ducks).
    if (!(this.duckWant > 0 || this.duckIdleShare > 0 || this.duckWalkShare > 0)) return;
    const want = this.duckWant > 1 ? 1 : this.duckWant;
    this.duckWant = 0;
    const step = dt / DUCK_FADE;
    const toWalk = this.duckMoving ? want : 0;
    const toIdle = this.duckMoving ? 0 : want;
    this.duckIdleShare = approach(this.duckIdleShare, toIdle, step);
    this.duckWalkShare = approach(this.duckWalkShare, toWalk, step);
    let sum = this.duckIdleShare + this.duckWalkShare;
    if (sum > DUCK_MOST) sum = DUCK_MOST;
    const base = 1 - sum;
    this.duckIdle = this.duckLayer(this.duckIdle, 'crouch', this.duckIdleShare, base);
    this.duckWalk = this.duckLayer(this.duckWalk, 'crouchWalk', this.duckWalkShare, base);
    const walk = this.duckWalk;
    const cur = this.current;
    if (walk && walk.isScheduled() && cur) {
      const a = cur.enabled ? this.strideOf(cur) : null;
      const b = a ? this.strideOf(walk) : null;
      if (a && b) {
        walk.timeScale = 0;
        walk.time = timeAtPhase(phaseAt(cur.time, a), b, walk.getClip().duration);
      } else walk.timeScale = cur.timeScale;
    }
  }

  /** One of the duck's layers at a share: played, weighted, and stopped once its share is nought. */
  private duckLayer(action: THREE.AnimationAction | null, state: RigState, share: number, base: number): THREE.AnimationAction | null {
    if (share <= 0) {
      if (action && action.isScheduled()) action.stop();
      return action;
    }
    const clip = this.preferredClip(state) ?? this.findClip(STATE_CLIPS[state]) ?? null;
    let a = clip ? this.duckActionFor(clip) : null;
    if (action && action !== a && action.isScheduled()) action.stop();
    if (!a) return null;
    if (!a.isScheduled() || !a.enabled) a.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    const w = share / (base > 0.02 ? base : 0.02);
    a.setEffectiveWeight(w);
    return a;
  }

  /** A crouch clip with the arms' tracks left out, as an action of its own (made once a clip). */
  private duckActionFor(clip: string): THREE.AnimationAction | null {
    let a = this.duckActions.get(clip);
    if (a !== undefined) return a;
    const src = this.actions.get(clip)?.getClip();
    a = null;
    if (src) {
      const arms = this.armBones();
      const tracks = src.tracks.filter((t) => !arms.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName ?? ''));
      if (tracks.length) a = this.mixer.clipAction(new THREE.AnimationClip(`duck:${clip}`, src.duration, tracks));
    }
    this.duckActions.set(clip, a);
    return a;
  }

  /** The arms' joints: each upper arm and everything under it (found once). */
  private armBones(): Set<string> {
    if (this.armBoneNames) return this.armBoneNames;
    const names = new Set<string>();
    for (const role of ['leftUpperArm', 'rightUpperArm'] as const) this.boneFor(role)?.traverse((o) => names.add(o.name));
    this.armBoneNames = names;
    return names;
  }

  /** How much of the duck's crouch the mixer laid on this frame (the console's), nought to one. */
  get duckShare(): number {
    return this.duckIdleShare + this.duckWalkShare;
  }

  /**
   * The feedback round, item 4: the neck bent forward by `pitch` radians past the crouch (about the figure's own right axis,
   * in the neck's parent frame), over whatever the clip and the spine's twist left; put back before the next mixer update,
   * so it never stacks. Call after `twistTorso`, with the world matrices current; nought does nothing.
   */
  bendNeck(pitch: number): void {
    if (pitch === 0) return;
    const dn = this.duckNeckTurn;
    if (!dn.bone) {
      dn.bone = this.neckBone() ?? this.boneFor('head');
      if (!dn.bone) return;
    }
    const bone = dn.bone;
    const parent = bone.parent;
    if (!parent) return;
    dn.clean.copy(bone.quaternion);
    this.root.getWorldQuaternion(lookRootQ);
    lookRootInvQ.copy(lookRootQ).invert();
    lookQ.setFromAxisAngle(RIGHT_AXIS, pitch);
    parent.getWorldQuaternion(lookParentQ);
    lookAlignQ.copy(lookParentQ).invert().multiply(lookRootQ).multiply(lookQ).multiply(lookRootInvQ).multiply(lookParentQ);
    bone.quaternion.premultiply(lookAlignQ);
    dn.turned.copy(bone.quaternion);
    dn.on = true;
    bone.updateMatrixWorld(true);
  }

  /**
   * Turn the torso about the vertical by `angle` radians (positive to the character's left),
   * spread over the spine bones, so the upper body can face the camera while the legs run at
   * an angle. Call after update() and after world matrices are current.
   */
  twistTorso(angle: number, pitch = 0): void {
    const spines = this.spineBones();
    // What the head's look measures itself from is what the spine was really given, clamp and all,
    // and nothing at all when there is no spine to turn.
    this.twistYaw = spines.length ? THREE.MathUtils.clamp(angle, -1.2, 1.2) : 0;
    this.twistPitch = spines.length ? THREE.MathUtils.clamp(pitch, -0.9, 0.9) : 0;
    // Written this frame: the look may take it off. Put down again by the look itself, so a frame
    // that never reaches here leaves the head measuring from a chest with no turn in it.
    this.twistFresh = true;
    if (!spines.length) return;
    const each = this.twistYaw / spines.length;
    // A tilt about the character's right axis too (positive bends forward and down), for aiming a gun where the camera looks.
    const eachPitch = this.twistPitch / spines.length;
    this.root.getWorldQuaternion(rootQ);
    rootInvQ.copy(rootQ).invert();
    tmpQ.setFromAxisAngle(UP_AXIS, each);
    if (eachPitch !== 0) tmpQ.multiply(pitchQ.setFromAxisAngle(RIGHT_AXIS, eachPitch));
    for (const bone of spines) {
      if (!bone.parent) continue;
      // The twist goes on top of the clip's pose, never on top of last frame's twist: a bone the
      // clip did not write this frame still holds the twisted value, so put the clean one back.
      let twist = this.twists.get(bone);
      if (!twist) {
        twist = { clean: new THREE.Quaternion(), twisted: new THREE.Quaternion() };
        this.twists.set(bone, twist);
      } else if (bone.quaternion.equals(twist.twisted)) bone.quaternion.copy(twist.clean);
      twist.clean.copy(bone.quaternion);
      // The lowest spine bone also takes the turn that holds the torso steady over running legs.
      if (!(bone.parent instanceof THREE.Bone && /spine|torso|chest/i.test(bone.parent.name))) {
        this.steadyTurn(bone, steadyQ);
        // A Jedi Academy swing on the upper body alone stands on its own pelvis (wave 2b), in place of the steady hold.
        if (this.swingTurn(bone, swingTurnQ)) bone.quaternion.premultiply(swingTurnQ);
        else if (!steadyQ.equals(IDENTITY_Q)) bone.quaternion.premultiply(steadyQ);
      }
      if (each !== 0 || eachPitch !== 0) {
        // A turn about the character's up axis, expressed in the bone's parent frame.
        bone.parent.getWorldQuaternion(parentQ);
        // The kept inverse, not a fresh one: this runs once per spine bone on every frame of every
        // body in view, and a quaternion made here is a quaternion made a frame per bone.
        alignQ.copy(parentQ).invert().multiply(rootQ).multiply(tmpQ).multiply(rootInvQ).multiply(parentQ);
        bone.quaternion.premultiply(alignQ);
      }
      twist.twisted.copy(bone.quaternion);
      bone.updateMatrixWorld(true);
    }
  }

  /**
   * Turn the head toward where the view looks: the same pattern as the twist, one joint further up,
   * and beside it rather than instead of it. `yaw` and `pitch` are where the view looks measured
   * from **the body's own heading** (yaw positive to the character's left, pitch positive looking
   * down, which is the camera's own pitch); the turn the spine was given this frame is taken off
   * here, so the head is measured from where `twistTorso` left the chest and the two never add up
   * past the cone. `allowed` false -- a special move, a kata, a death, an emote, a ride -- eases the
   * whole thing back to nothing at the same rate it eased out.
   *
   * Call after `update()` and after `twistTorso`, with the world matrices current, exactly as the
   * twist is called: the bone work is the same and it reads the chest the twist has just written.
   * Allocation-free, and a rig with no head joint does nothing at all.
   */
  lookToward(yaw: number, pitch: number, dt: number, allowed: boolean): void {
    const look = this.headLook;
    // The chest's own turn, but only if something really wrote it this frame: a path that poses the
    // body without twisting the spine (adrift on foot in space) leaves the last one standing, and
    // subtracting a turn the spine has not got would hold the head to one side for good.
    if (!this.twistFresh) {
      this.twistYaw = 0;
      this.twistPitch = 0;
    }
    this.twistFresh = false;
    look.step(yaw, pitch, this.twistYaw, this.twistPitch, dt, allowed);
    if (!this.lookBones) {
      const neck = this.neckBone();
      const head = this.boneFor('head');
      // A skeleton whose head *is* the neck (nothing in the packs, but a converted model may be
      // anything) shares nothing: the head takes the whole turn rather than twice its share.
      this.lookBones = { neck: neck && neck !== head ? neck : null, head };
    }
    const { neck, head } = this.lookBones;
    if (!head) return;
    // Nothing to put back and nothing to turn: the frames after the look has eased out cost two
    // comparisons, which is what lets the game leave it switched on.
    if (look.yaw === 0 && look.pitch === 0 && !this.lookTurned) return;
    this.root.getWorldQuaternion(lookRootQ);
    lookRootInvQ.copy(lookRootQ).invert();
    // The neck first: the head hangs under it, so its own parent frame is read after the neck has
    // been turned and written.
    if (neck) this.turnLookBone(neck, look.neckYaw, look.neckPitch);
    this.turnLookBone(head, neck ? look.headYaw : look.yaw, neck ? look.headPitch : look.pitch);
    // Eased all the way back and not wanted: the clean poses are on the joints again (the two calls
    // above have just put them there), so from here the look costs two comparisons a frame until it
    // is asked for again. The pairs themselves stay -- they are two objects for the life of the rig,
    // and throwing them away would make four quaternions again at the end of every move.
    this.lookTurned = !(!look.on && look.yaw === 0 && look.pitch === 0);
  }

  /**
   * The neck joint, by name, once per rig. Exact first and only then anything carrying the word:
   * a name search that matches loosely is a mistake this project has made before, and a skeleton
   * with two bones carrying `neck` in their names would otherwise hand the look whichever the map
   * happened to hold first and put two thirds of the turn on a joint that is not the neck.
   */
  private neckBone(): THREE.Bone | null {
    for (const pattern of [/^neck$/i, /^neck_?\d+$/i, /^(bip01[_ ]?)?neck/i, /neck/i]) {
      for (const [name, bone] of this.bones) if (pattern.test(name)) return bone;
    }
    return null;
  }

  /**
   * One joint of the head's look. The clean/turned pair is the twist's own rule: the turn goes on
   * top of the clip's pose and never on top of last frame's, and a joint no clip wrote this frame
   * still holds the turned value, so the clean one is put back first.
   */
  private turnLookBone(bone: THREE.Bone, yaw: number, pitch: number): void {
    const parent = bone.parent;
    if (!parent) return;
    let turn = this.lookTurns.get(bone);
    if (!turn) {
      turn = { clean: new THREE.Quaternion(), turned: new THREE.Quaternion() };
      this.lookTurns.set(bone, turn);
    } else if (bone.quaternion.equals(turn.turned)) bone.quaternion.copy(turn.clean);
    turn.clean.copy(bone.quaternion);
    if (yaw !== 0 || pitch !== 0) {
      lookQ.setFromAxisAngle(UP_AXIS, yaw);
      if (pitch !== 0) lookQ.multiply(lookPitchQ.setFromAxisAngle(RIGHT_AXIS, pitch));
      // A turn about the figure's own up and right axes, expressed in the joint's parent frame, so
      // the joint keeps its authored twist and only the look changes.
      parent.getWorldQuaternion(lookParentQ);
      lookAlignQ.copy(lookParentQ).invert().multiply(lookRootQ).multiply(lookQ).multiply(lookRootInvQ).multiply(lookParentQ);
      bone.quaternion.premultiply(lookAlignQ);
    }
    turn.turned.copy(bone.quaternion);
    bone.updateMatrixWorld(true);
  }

  /**
   * Forget the head's look outright and put the joints back as the clip left them, rather than
   * easing it away over the next fifth of a second. What needs it is a body that stops being posed
   * by one thing and starts being posed by another with no frames in between: a peer standing up
   * again out of the death clip (`RemotePlayers.setDown`), where the held clip is dropped in the
   * same call. Everywhere else the ease is what is wanted, and `allowed` false is how to ask for it.
   */
  /** One joint of the look back on its clean pose, when it still holds last frame's turn (nothing wrote it since). */
  private cleanLookBone(bone: THREE.Bone | null): void {
    if (!bone) return;
    const turn = this.lookTurns.get(bone);
    if (turn && bone.quaternion.equals(turn.turned)) bone.quaternion.copy(turn.clean);
  }

  clearLook(): void {
    this.headLook.reset();
    for (const [bone, turn] of this.lookTurns) {
      if (bone.quaternion.equals(turn.turned)) bone.quaternion.copy(turn.clean);
    }
    this.lookTurned = false;
  }

  /**
   * Back to the clips alone after something posed the bones directly (a ragdoll): every bone on its rest and the
   * mixer told so (`src/anim/poseReset.ts`), so the next update writes every joint the clips drive and leaves the rest
   * at rest. The placements laid after the mixer (the limbs', the legs', the look's, the duck's neck) are let go first,
   * so none puts back a pose from before.
   */
  retakePose(): void {
    this.limbPose?.restore();
    this.legPose?.restore();
    this.clearLook();
    this.duckNeckTurn.on = false;
    poseAtRest(this.bones.values(), this.restLocal, this.restPosition, this.restScale);
    forgetMixerWrites(this.mixer);
  }

  /**
   * Point an arm along a direction given in the character's local space
   * (+Z forward, +Y up). Call after update() and after world matrices are
   * current, so it overrides the clip pose while respecting the shoulder.
   * `weight` lays that much of the aim over the clip's pose (the grapple's
   * left arm eases in and out by it); at 1 it is the aim outright, as it
   * always was, and at nought the clip's pose is left as it stands.
   */
  aimArm(side: 'left' | 'right', dir: THREE.Vector3, roll = 0, weight = 1): void {
    const upper = this.boneFor(side === 'right' ? 'rightUpperArm' : 'leftUpperArm');
    const fore = this.boneFor(side === 'right' ? 'rightForeArm' : 'leftForeArm');
    if (!upper || !upper.parent) return;
    const bind = this.bindToRoot.get(upper);
    if (!bind) return;
    aimArmBones(this.root, upper, fore, this.restArm.get(side)!, bind, fore ? (this.bindLocal.get(fore) ?? null) : null, dir, roll, weight);
  }
}

interface PlayerManifest {
  players: { id: string; file: string; clipSpeeds?: Record<string, number>; scale?: number; jkaClips?: Record<string, { loop: boolean }>; jkaGrip?: GripAxes; partialClips?: Record<string, string[]>; variants?: RigOptions['variants'] }[];
}

/**
 * Where a rig's loader gets the imported animations fitted to its skeleton (src/anim/mixamoPack.ts): set once by the
 * game as it starts, through this record and never an import, so the rig knows nothing of the pack, its files or the
 * page. With none set, or a provider that answers with nothing (no pack, the switch off), a rig is the rig it was.
 */
export const IMPORTED_CLIPS: { provider: ((skeleton: TargetSkeleton, label: string) => Promise<THREE.AnimationClip[]>) | null; strides: ((clip: THREE.AnimationClip) => ClipFacts | null) | null; waitMs: number } = {
  provider: null,
  /** A fitted walking or running clip's stride (its feet's speed, its left foot's landing), which the rig keeps with the clip; null for none. */
  strides: null,
  /**
   * How long a rig's load waits for them before it goes on without: the clips are a few hundred kilobytes beside a
   * rig file of hundreds of megabytes, so this is only ever a server that has stopped answering. They are added
   * when they do land.
   */
  waitMs: 4000,
};

/**
 * Hand a freshly made rig the imported clips for its skeleton, before it is shown: fitted once a skeleton and shared,
 * so every rig after the first takes the same clip objects at no cost. Never throws.
 */
export async function attachImportedClips(rig: CharacterRig, label: string): Promise<void> {
  const provider = IMPORTED_CLIPS.provider;
  if (!provider) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fitting = provider(rig.restSkeleton(), label).catch((err) => {
      console.warn('imported animations: the fit failed', err);
      return [] as THREE.AnimationClip[];
    });
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), IMPORTED_CLIPS.waitMs);
    });
    const clips = await Promise.race([fitting, late]);
    if (clips) rig.addClips(clips, IMPORTED_CLIPS.strides);
    else void fitting.then((c) => rig.addClips(c, IMPORTED_CLIPS.strides));
  } catch (err) {
    console.warn('imported animations: not attached', err);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The player's rig: a character converted from the game (assets-private/player/manifest.json, the
 * first entry) when one exists, otherwise the bundled placeholder.
 */
export async function loadPlayerRig(baseUrl: string, id = 'human_male'): Promise<CharacterRig> {
  // A parts pack first: one skeleton with the body, head and clothing as separate meshes, which
  // is what lets the character be reshaped and dressed while the game is running.
  try {
    const character = await Character.load(baseUrl, id);
    const m = character.manifest;
    const names = new Set(character.clips.map((c) => c.name));
    // Without the named locomotion set the character could only stand: use the single model instead.
    if (!['idle', 'walk', 'run'].every((n) => names.has(n))) throw new Error(`the parts rig has ${character.clips.length} clips but no idle, walk and run; run the converter's parts command again`);
    const hold = Object.entries(m.jkaClips ?? {}).filter(([, c]) => !c.loop).map(([name]) => name);
    const rig = CharacterRig.fromCharacter(character, { clipSpeeds: m.clipSpeeds, scale: m.scale ?? 1, hold, grip: m.jkaGrip, partialClips: m.partialClips, variants: m.variants });
    // The imported animations for this skeleton, before anybody is shown the rig (the player's, a peer's, a fighter's).
    await attachImportedClips(rig, m.id);
    console.info(`player ${m.id}: assembled from ${m.parts.length} parts, ${character.clips.length} clips, ${Object.keys(character.morphValues()).length} shape sliders`);
    return rig;
  } catch (err) {
    console.info('no parts pack for the player, falling back to the single model', err instanceof Error ? err.message : err);
  }
  try {
    const res = await fetch(`${baseUrl}assets-private/player/manifest.json`);
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      const manifest = (await res.json()) as PlayerManifest;
      const entry = manifest.players?.[0];
      if (entry) {
        const hold = Object.entries(entry.jkaClips ?? {}).filter(([, c]) => !c.loop).map(([name]) => name);
        const rig = await CharacterRig.load(`${baseUrl}assets-private/${entry.file}`, { clipSpeeds: entry.clipSpeeds, scale: entry.scale ?? 1, hold, grip: entry.jkaGrip, partialClips: entry.partialClips, variants: entry.variants });
        await attachImportedClips(rig, entry.id);
        console.info(`player model ${entry.id}: clips ${rig.clipNames.join(', ')}; bones ${rig.boneNames.join(', ')}`);
        return rig;
      }
    }
  } catch (err) {
    console.warn('player model failed to load, using the placeholder', err);
  }
  return CharacterRig.load(`${baseUrl}assets/characters/xbot.glb`, { scale: 0.95 });
}
