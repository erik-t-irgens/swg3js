import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type RigState = 'idle' | 'walk' | 'run' | 'air' | 'seated' | 'swim' | 'float' | 'crouch' | 'crouchWalk' | 'stance' | 'strafeLeft' | 'strafeRight' | 'runBack' | 'walkBack';

/** Clip names used for each state, in preference order (placeholder rig names, then the game's); a pattern matches any clip. */
const STATE_CLIPS: Record<RigState, (string | RegExp)[]> = {
  idle: ['idle', 'Idle', 'stand', 'loop_stand', 'idle_combat'],
  walk: ['walk', 'Walk', 'loop_walk', 'walk_combat'],
  run: ['run', 'Run', 'loop_run', 'run_combat'],
  air: ['BOTH_INAIR1', 'jump', 'fall', 'loop_jump', 'sneak_pose', 'idle', 'stand'],
  seated: ['sit', 'loop_sit', 'loop_sitting_chair:0', 'loop_sitting_chair', 'loop_sitting_ground', 'sneak_pose', 'idle', 'stand'],
  swim: ['swim', 'loop_swimming:speed1', 'loop_swimming:speed0', 'walk', 'idle'],
  float: ['float', 'loop_swimming:speed0', 'swim', 'idle'],
  crouch: ['BOTH_CROUCH1IDLE', 'BOTH_CROUCH1', 'sneak_pose', 'idle', 'stand'],
  crouchWalk: ['BOTH_CROUCH1WALK', 'sneak', 'walk', 'loop_walk'],
  /** Standing with the saber drawn: the style's stance (set through `stanceClip`), else the idle. */
  stance: ['BOTH_STAND2', 'idle_combat', 'idle', 'Idle', 'stand', 'loop_stand'],
  // Sideways and backwards locomotion, when the skeleton's tables carry them: the body then
  // keeps facing the camera while it moves. Nothing else matches, so these states stay unused.
  strafeLeft: [/strafe.*(left|_l)$/i, /^(run|walk)_?(strafe_?)?l(eft)?$/i, /side.*left/i],
  strafeRight: [/strafe.*(right|_r)$/i, /^(run|walk)_?(strafe_?)?r(ight)?$/i, /side.*right/i],
  runBack: [/^run.*back/i, /back.*run/i, /^run.*bwd/i],
  walkBack: [/^walk.*back/i, /back.*walk/i, /^walk.*bwd/i],
};

/** Natural travel speed of the placeholder rig's locomotion clips, in m/s, used to scale playback. */
const DEFAULT_CLIP_SPEED: Partial<Record<RigState, number>> = { walk: 1.5, run: 5.5, swim: 2.5, crouchWalk: 2.2, strafeLeft: 4.5, strafeRight: 4.5, runBack: 4, walkBack: 1.5 };

/** Bones the game needs by role: exact names of the placeholder rig first, then patterns for the game's skeletons. */
export type BoneRole = 'rightHand' | 'leftHand' | 'spine' | 'rightUpperArm' | 'rightForeArm' | 'leftUpperArm' | 'leftForeArm' | 'head';
const BONE_ROLES: Record<BoneRole, (string | RegExp)[]> = {
  rightHand: ['mixamorig:RightHand', 'mixamorigRightHand', /^r_?hand$/i, /^right_?hand$/i, /(^|_)r_?hand/i, /hand_?r$/i, /^r_?wrist$/i, /(^|_)r_?wrist/i, /^rhand/i],
  leftHand: ['mixamorig:LeftHand', 'mixamorigLeftHand', /^l_?hand$/i, /^left_?hand$/i, /(^|_)l_?hand/i, /hand_?l$/i, /^l_?wrist$/i, /(^|_)l_?wrist/i, /^lhand/i],
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
}

const tmpQ = new THREE.Quaternion();
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
  private readonly roles = new Map<BoneRole, THREE.Bone | null>();
  private readonly restArm = new Map<'left' | 'right', THREE.Vector3>();
  /** Bind-pose rotations of the arm bones: relative to the root (upper arms) and to the parent (forearms). */
  private readonly bindToRoot = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly bindLocal = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly clipSpeeds: Record<string, number>;
  private readonly hold: Set<string>;
  /** The clip the `stance` state plays, when the rig has it; the saber style picks it. */
  stanceClip: string | null = null;
  private current: THREE.AnimationAction | null = null;
  private state: RigState | null = null;
  /** A one-off clip (a swing, a jump, a landing) playing over the state clips until it ends. */
  private override: THREE.AnimationAction | null = null;
  private overrideEnds = 0;
  private overrideTime = 0;

  private constructor(scene: THREE.Group, clips: THREE.AnimationClip[], options: RigOptions) {
    this.root = scene;
    this.scale = options.scale ?? 1;
    this.clipSpeeds = options.clipSpeeds ?? {};
    this.hold = new Set(options.hold ?? []);
    this.mixer = new THREE.AnimationMixer(scene);
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    scene.traverse((o) => {
      if (o instanceof THREE.Bone) this.bones.set(o.name, o);
      if (o instanceof THREE.SkinnedMesh || o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m instanceof THREE.MeshStandardMaterial) this.materials.push(m);
      }
    });
    // The rest direction of each upper arm (shoulder to elbow) in root space, from the bind pose,
    // so aiming works whatever pose the skeleton was authored in.
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

  /** Whether a one-off clip is still playing. */
  get overriding(): boolean {
    return this.override !== null;
  }

  /**
   * Play a clip over the state clips: once (then the state clip returns) or looping until
   * `stopOverride`. Returns its length in seconds at the given speed, or null when missing.
   */
  play(clip: string, { loop = false, fadeIn = 0.1, timeScale = 1, hold = false }: { loop?: boolean; fadeIn?: number; timeScale?: number; hold?: boolean } = {}): number | null {
    const next = this.actions.get(clip);
    if (!next) return null;
    const from = this.override ?? this.current;
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

  setState(state: RigState, speed = 0): void {
    if (this.override) {
      // A one-off clip is playing; remember the state for when it ends.
      this.state = state;
      return;
    }
    const wantedStance = state === 'stance' && this.stanceClip && this.actions.has(this.stanceClip) ? this.stanceClip : null;
    if (state !== this.state || (wantedStance && this.current?.getClip().name !== wantedStance)) {
      const clipName = wantedStance ?? this.findClip(STATE_CLIPS[state]);
      const next = clipName ? this.actions.get(clipName)! : null;
      if (next && next !== this.current) {
        // A held clip (a stance) plays once and keeps its last frame.
        next.reset().setLoop(this.hold.has(clipName!) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).setEffectiveWeight(1).play();
        next.clampWhenFinished = true;
        if (this.current) this.current.crossFadeTo(next, 0.18, false);
        this.current = next;
      }
      this.state = state;
    }
    const clip = this.current?.getClip().name;
    const natural = (clip && this.clipSpeeds[clip]) || DEFAULT_CLIP_SPEED[state];
    if (this.current && natural && speed > 0) this.current.timeScale = THREE.MathUtils.clamp(speed / natural, 0.5, 2.5);
    else if (this.current) this.current.timeScale = 1;
  }

  update(dt: number): void {
    this.mixer.update(dt);
    if (this.override) {
      this.overrideTime += dt;
      if (this.overrideTime >= this.overrideEnds - 0.08) {
        // Fade back to the state clip just before the one-off clip holds its last frame.
        const state = this.state;
        this.stopOverride(0.12);
        this.state = null;
        if (state) this.setState(state);
      }
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
  players: { id: string; file: string; clipSpeeds?: Record<string, number>; scale?: number; jkaClips?: Record<string, { loop: boolean }> }[];
}

/**
 * The player's rig: a character converted from the game (assets-private/player/manifest.json, the
 * first entry) when one exists, otherwise the bundled placeholder.
 */
export async function loadPlayerRig(baseUrl: string): Promise<CharacterRig> {
  try {
    const res = await fetch(`${baseUrl}assets-private/player/manifest.json`);
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      const manifest = (await res.json()) as PlayerManifest;
      const entry = manifest.players?.[0];
      if (entry) {
        const hold = Object.entries(entry.jkaClips ?? {}).filter(([, c]) => !c.loop).map(([name]) => name);
        const rig = await CharacterRig.load(`${baseUrl}assets-private/${entry.file}`, { clipSpeeds: entry.clipSpeeds, scale: entry.scale ?? 1, hold });
        console.info(`player model ${entry.id}: clips ${rig.clipNames.join(', ')}; bones ${rig.boneNames.join(', ')}`);
        return rig;
      }
    }
  } catch (err) {
    console.warn('player model failed to load, using the placeholder', err);
  }
  return CharacterRig.load(`${baseUrl}assets/characters/xbot.glb`, { scale: 0.95 });
}
