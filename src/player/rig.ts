import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Character, type GripAxes } from './character';

export type RigState = 'idle' | 'walk' | 'run' | 'air' | 'seated' | 'swim' | 'float' | 'crouch' | 'crouchWalk' | 'crouchWalkBack' | 'stance' | 'strafeLeft' | 'strafeRight' | 'runBack' | 'walkBack' | 'runSaber' | 'walkSaber' | 'gunIdle' | 'gunWalk' | 'gunRun' | 'gunReadyIdle' | 'gunReadyWalk' | 'gunReadyRun' | 'gunAimIdle' | 'gunAimWalk' | 'gunAimRun' | 'kneel' | 'prone' | 'proneMove' | 'gunProneIdle' | 'gunProneMove' | 'gunProneReadyIdle' | 'gunProneReadyMove' | 'gunProneAimIdle' | 'gunProneAimMove';

/** Clip names used for each state, in preference order (placeholder rig names, then the game's); a pattern matches any clip. */
const STATE_CLIPS: Record<RigState, (string | RegExp)[]> = {
  idle: ['idle', 'Idle', 'stand', 'loop_stand', 'idle_combat'],
  walk: ['walk', 'Walk', 'loop_walk', 'walk_combat'],
  run: ['run', 'Run', 'loop_run', 'run_combat'],
  air: ['BOTH_INAIR1', 'jump', 'fall', 'loop_jump', 'sneak_pose', 'idle', 'stand'],
  // Riding: the vehicle's own pose is asked for through `prefer` (loop_riding:vehicle_speeder_bike, the saddle poses); the plain loop_riding is the game's default saddle.
  seated: ['loop_riding', /^loop_riding/, 'loop_ride', 'sit', 'loop_sit', /^loop_sitting_chair/, 'loop_sitting_ground', 'sneak_pose', 'idle', 'stand'],
  swim: ['swim', 'loop_swimming:speed1', 'loop_swimming:speed0', 'walk', 'idle'],
  float: ['float', 'loop_swimming:speed0', 'swim', 'idle'],
  crouch: ['BOTH_CROUCH1IDLE', 'BOTH_CROUCH1', 'sneak_pose', 'idle', 'stand'],
  crouchWalk: ['BOTH_CROUCH1WALK', 'sneak', 'walk', 'loop_walk'],
  crouchWalkBack: ['BOTH_CROUCH1WALKBACK', 'BOTH_CROUCH1WALK', 'sneak', 'walk', 'loop_walk'],
  /** Standing with the saber drawn: the style's stance (set through `stanceClip`), else the idle. */
  stance: ['BOTH_STAND2', 'idle_combat', 'idle', 'Idle', 'stand', 'loop_stand'],
  // Sideways and backwards locomotion, when the skeleton's tables carry them: the body then
  // keeps facing the camera while it moves. Nothing else matches, so these states stay unused.
  strafeLeft: [/strafe.*(left|_l)$/i, /^(run|walk)_?(strafe_?)?l(eft)?$/i, /side.*left/i],
  strafeRight: [/strafe.*(right|_r)$/i, /^(run|walk)_?(strafe_?)?r(ight)?$/i, /side.*right/i],
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
  // The combat carry is the game's one combat stance for every weapon (loop_combat_standing); there
  // is no aimed loop: aiming holds the last frame of the transition into the aimed pose on the upper body.
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

const tmpQ = new THREE.Quaternion();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const RIGHT_AXIS = new THREE.Vector3(1, 0, 0);
const pitchQ = new THREE.Quaternion();
const steadyQ = new THREE.Quaternion();
const IDENTITY_Q = new THREE.Quaternion();
/** States whose legs walk or run around the standing pelvis, where a pose on the upper body is held steady. */
const LOCOMOTION_STATES = new Set<RigState>(['walk', 'run', 'runBack', 'walkBack', 'runSaber', 'walkSaber', 'strafeLeft', 'strafeRight', 'gunWalk', 'gunRun', 'gunReadyWalk', 'gunReadyRun', 'gunAimWalk', 'gunAimRun']);
const rootQ = new THREE.Quaternion();
const parentQ = new THREE.Quaternion();
const alignQ = new THREE.Quaternion();
const restWorld = new THREE.Vector3();
const dirWorld = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** A skinned GLTF character with an animation mixer and bones found by role. */
export class CharacterRig {
  readonly root: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  readonly scale: number;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly bones = new Map<string, THREE.Bone>();
  /** Each spine bone's pose before and after the torso twist, so the twist never stacks on itself. */
  private readonly twists = new Map<THREE.Bone, { clean: THREE.Quaternion; twisted: THREE.Quaternion }>();
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
  /** Clips that add to the pose underneath instead of replacing it (the game's add_ shots). */
  private readonly additive = new Set<string>();
  readonly grip: GripAxes | null;
  readonly partialClips: Record<string, string[]>;
  readonly variants: Record<string, { variable: string; values: string[] }>;
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
      }
    });
    for (const clip of clips) {
      // The game's add_ clips (a blaster's shots) are deltas on whatever plays: made additive against the rest pose.
      if (isAdditive(clip.name)) {
        additiveAgainstRest(clip, this.bones);
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
    let found: THREE.Bone | null = null;
    for (const candidate of BONE_ROLES[role]) {
      if (typeof candidate === 'string') found = this.bones.get(candidate) ?? null;
      else for (const [name, bone] of this.bones) if (candidate.test(name)) { found = bone; break; }
      if (found) break;
    }
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

  /** Length of a clip in seconds, or null when the rig lacks it. */
  clipDuration(clip: string): number | null {
    const a = this.actions.get(clip);
    return a ? a.getClip().duration : null;
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

  /** Whether the one-off clip playing is one of Jedi Academy's (a swing, a flip), not a game transition. */
  get overridingJka(): boolean {
    return this.override !== null && this.override.getClip().name.startsWith('BOTH_');
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

  /**
   * Play a clip over the state clips: once (then the state clip returns) or looping until
   * `stopOverride`. Returns its length in seconds at the given speed, or null when missing.
   */
  play(clip: string, { loop = false, fadeIn = 0.1, timeScale = 1, hold = false }: { loop?: boolean; fadeIn?: number; timeScale?: number; hold?: boolean } = {}): number | null {
    const next = this.actions.get(clip);
    if (!next) return null;
    const from = this.override ?? this.current;
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
    if (from && from !== next) from.crossFadeTo(next, fadeIn, false);
    else if (from === next) next.fadeIn(0);
    this.override = next;
    const duration = next.getClip().duration / Math.max(1e-3, Math.abs(timeScale));
    // A held clip keeps its last frame until the next one-off clip or `stopOverride` (a saber
    // move chains straight into the next without a dip back to the stance).
    this.overrideEnds = loop || hold ? Infinity : duration;
    this.overrideTime = 0;
    return duration;
  }

  /** End a one-off clip early and fade the state clip back in. */
  stopOverride(fade = 0.15): void {
    if (!this.override) return;
    const back = this.current;
    if (back && back !== this.override) {
      back.reset().setEffectiveWeight(1).play();
      this.override.crossFadeTo(back, fade, false);
    } else this.override.fadeOut(fade);
    this.override = null;
  }

  /**
   * Play the state's clip. With `upper`, that clip drives the legs only and `upper` (a stance)
   * drives the spine, arms and head: the saber held up while the legs swim.
   */
  setState(state: RigState, speed = 0, upper: string | null = null): void {
    this.wantedUpper = upper;
    if (this.override) {
      // A one-off clip is playing; remember the state for when it ends.
      this.state = state;
      return;
    }
    const wantedStance = this.preferredClip(state);
    // A one-shot on the upper body takes the layer while it plays; the caller's layer returns after it.
    const upperName = this.shotName ?? (upper && this.actions.has(upper) ? upper : null);
    const playing = this.current?.getClip().name.replace(/^lower:/, '');
    if (state !== this.state || (wantedStance && playing !== wantedStance) || upperName !== this.upperName) {
      const clipName = wantedStance ?? this.findClip(STATE_CLIPS[state]);
      const next = clipName ? (upperName ? this.half(clipName, 'lower') : this.actions.get(clipName)!) : null;
      if (next && next !== this.current) {
        // A held clip (a stance) plays once and keeps its last frame.
        next.reset().setLoop(this.hold.has(clipName!) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).setEffectiveWeight(1).play();
        next.clampWhenFinished = true;
        if (this.current) this.current.crossFadeTo(next, 0.18, false);
        this.current = next;
      }
      const nextUpper = upperName ? this.half(upperName, 'upper') : null;
      if (nextUpper !== this.upper) {
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
    const clip = this.current?.getClip().name.replace(/^lower:/, '');
    const natural = (clip && this.clipSpeeds[clip]) || DEFAULT_CLIP_SPEED[state];
    if (this.current && natural && speed > 0) this.current.timeScale = THREE.MathUtils.clamp(speed / natural, 0.5, 2.5);
    else if (this.current) this.current.timeScale = 1;
  }

  update(dt: number): void {
    this.mixer.update(dt);
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
  prefer(state: RigState, clip: string | RegExp | null): void {
    if (clip) this.preferred.set(state, clip);
    else this.preferred.delete(state);
  }

  /** The speed, in metres a second, the clip a state would play was made for, or null when unknown. */
  naturalSpeed(state: RigState): number | null {
    const clip = this.preferredClip(state) ?? this.findClip(STATE_CLIPS[state]);
    return (clip && this.clipSpeeds[clip]) || DEFAULT_CLIP_SPEED[state] || null;
  }

  /** What plays now, for the console. */
  describe(): { state: RigState | null; clip: string | null; upper: string | null; override: string | null; shot: string | null } {
    return { state: this.state, clip: this.current?.getClip().name ?? null, upper: this.upperName, override: this.override?.getClip().name ?? null, shot: this.shotName ?? this.upperShot?.getClip().name.replace(/^upper:/, '') ?? null };
  }

  /** Whether the torso is held steady over locomotion legs while a pose rides the upper body. */
  steady = true;

  /**
   * With a pose riding the upper body over locomotion legs, the pelvis's rock from the run would carry
   * the torso with it: the turn that takes the pelvis back to its rest, to go on the lowest spine bone
   * so the torso sits as if the pelvis stood still while the legs run. Identity when nothing rides.
   */
  private steadyTurn(bone: THREE.Bone, out: THREE.Quaternion): THREE.Quaternion {
    out.identity();
    // Only over walking and running legs: a posture's pelvis (prone, kneeling, swimming) is meant to be turned.
    if (!this.upper || !this.steady || !this.state || !LOCOMOTION_STATES.has(this.state)) return out;
    const parent = bone.parent;
    if (!(parent instanceof THREE.Bone) || this.upperBones().has(parent.name)) return out;
    const rest = this.restLocal.get(parent);
    if (!rest) return out;
    return out.copy(parent.quaternion).invert().multiply(rest);
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
   * Turn the torso about the vertical by `angle` radians (positive to the character's left),
   * spread over the spine bones, so the upper body can face the camera while the legs run at
   * an angle. Call after update() and after world matrices are current.
   */
  twistTorso(angle: number, pitch = 0): void {
    const spines = [...this.bones.values()].filter((b) => /^spine_?[1-3]$/i.test(b.name));
    if (!spines.length) return;
    const each = THREE.MathUtils.clamp(angle, -1.2, 1.2) / spines.length;
    // A tilt about the character's right axis too (positive bends forward and down), for aiming a gun where the camera looks.
    const eachPitch = THREE.MathUtils.clamp(pitch, -0.9, 0.9) / spines.length;
    this.root.getWorldQuaternion(rootQ);
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
        if (!steadyQ.equals(IDENTITY_Q)) bone.quaternion.premultiply(steadyQ);
      }
      if (each !== 0 || eachPitch !== 0) {
        // A turn about the character's up axis, expressed in the bone's parent frame.
        bone.parent.getWorldQuaternion(parentQ);
        alignQ.copy(parentQ).invert().multiply(rootQ).multiply(tmpQ).multiply(rootQ.clone().invert()).multiply(parentQ);
        bone.quaternion.premultiply(alignQ);
      }
      twist.twisted.copy(bone.quaternion);
      bone.updateMatrixWorld(true);
    }
  }

  /**
   * Point an arm along a direction given in the character's local space
   * (+Z forward, +Y up). Call after update() and after world matrices are
   * current, so it overrides the clip pose while respecting the shoulder.
   */
  aimArm(side: 'left' | 'right', dir: THREE.Vector3, roll = 0): void {
    const upper = this.boneFor(side === 'right' ? 'rightUpperArm' : 'leftUpperArm');
    const fore = this.boneFor(side === 'right' ? 'rightForeArm' : 'leftForeArm');
    if (!upper || !upper.parent) return;
    const rest = this.restArm.get(side)!;
    // The rest axis is known in root space, so the world rest axis is the root's rotation applied to it.
    this.root.getWorldQuaternion(rootQ);
    upper.parent.getWorldQuaternion(parentQ);
    restWorld.copy(rest).applyQuaternion(rootQ);
    dirWorld.copy(dir).applyQuaternion(rootQ).normalize();
    alignQ.setFromUnitVectors(restWorld, dirWorld);
    if (roll !== 0) alignQ.multiply(tmpQ.setFromAxisAngle(dirWorld, roll));
    // World rotation = align × the bone's bind-pose world rotation, expressed in the parent's frame,
    // so the bone keeps its authored twist and only the arm direction changes.
    upper.quaternion.copy(parentQ).invert().multiply(alignQ).multiply(rootQ).multiply(this.bindToRoot.get(upper)!);
    if (fore) fore.quaternion.copy(this.bindLocal.get(fore)!);
  }
}

interface PlayerManifest {
  players: { id: string; file: string; clipSpeeds?: Record<string, number>; scale?: number; jkaClips?: Record<string, { loop: boolean }>; jkaGrip?: GripAxes; partialClips?: Record<string, string[]>; variants?: RigOptions['variants'] }[];
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
        console.info(`player model ${entry.id}: clips ${rig.clipNames.join(', ')}; bones ${rig.boneNames.join(', ')}`);
        return rig;
      }
    }
  } catch (err) {
    console.warn('player model failed to load, using the placeholder', err);
  }
  return CharacterRig.load(`${baseUrl}assets/characters/xbot.glb`, { scale: 0.95 });
}
