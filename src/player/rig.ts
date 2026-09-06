import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type RigState = 'idle' | 'walk' | 'run' | 'air' | 'seated';

/** Clip names used for each state, in preference order. */
const STATE_CLIPS: Record<RigState, string[]> = {
  idle: ['idle', 'Idle'],
  walk: ['walk', 'Walk'],
  run: ['run', 'Run'],
  air: ['jump', 'fall', 'sneak_pose', 'idle'],
  seated: ['sit', 'sneak_pose', 'idle'],
};

/** Natural travel speed of each locomotion clip, in m/s, used to scale playback. */
const CLIP_SPEED: Partial<Record<RigState, number>> = { walk: 1.5, run: 5.5 };

const REST_RIGHT_ARM = new THREE.Vector3(-1, 0, 0);
const REST_LEFT_ARM = new THREE.Vector3(1, 0, 0);
const tmpQ = new THREE.Quaternion();
const rootQ = new THREE.Quaternion();
const parentQ = new THREE.Quaternion();
const alignQ = new THREE.Quaternion();
const restWorld = new THREE.Vector3();
const dirWorld = new THREE.Vector3();

/** A skinned GLTF character with an animation mixer and named bones. */
export class CharacterRig {
  readonly root: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private current: THREE.AnimationAction | null = null;
  private state: RigState | null = null;

  private constructor(scene: THREE.Group, clips: THREE.AnimationClip[]) {
    this.root = scene;
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
  }

  static async load(url: string): Promise<CharacterRig> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new CharacterRig(gltf.scene, gltf.animations);
  }

  bone(name: string): THREE.Bone | undefined {
    return this.bones.get(name) ?? this.bones.get(name.replace('mixamorig:', 'mixamorig'));
  }

  tint(color: number): void {
    for (const m of this.materials) m.color.set(color);
  }

  setState(state: RigState, speed = 0): void {
    if (state !== this.state) {
      const clipName = STATE_CLIPS[state].find((n) => this.actions.has(n));
      const next = clipName ? this.actions.get(clipName)! : null;
      if (next && next !== this.current) {
        next.reset().setEffectiveWeight(1).play();
        if (this.current) this.current.crossFadeTo(next, 0.18, false);
        this.current = next;
      }
      this.state = state;
    }
    const natural = CLIP_SPEED[state];
    if (this.current && natural) this.current.timeScale = THREE.MathUtils.clamp(speed / natural, 0.5, 2.5);
    else if (this.current) this.current.timeScale = 1;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  /**
   * Point an arm along a direction given in the character's local space
   * (+Z forward, +Y up). Call after update() and after world matrices are
   * current, so it overrides the clip pose while respecting the shoulder.
   */
  aimArm(side: 'left' | 'right', dir: THREE.Vector3, roll = 0): void {
    const upper = this.bone(side === 'right' ? 'mixamorig:RightArm' : 'mixamorig:LeftArm');
    const fore = this.bone(side === 'right' ? 'mixamorig:RightForeArm' : 'mixamorig:LeftForeArm');
    if (!upper || !upper.parent) return;
    const rest = side === 'right' ? REST_RIGHT_ARM : REST_LEFT_ARM;
    // Bones rest at identity relative to the rig root, so the rest axis in world
    // space is the root's rotation applied to the local rest axis.
    this.root.getWorldQuaternion(rootQ);
    upper.parent.getWorldQuaternion(parentQ);
    restWorld.copy(rest).applyQuaternion(rootQ);
    dirWorld.copy(dir).applyQuaternion(rootQ).normalize();
    alignQ.setFromUnitVectors(restWorld, dirWorld);
    if (roll !== 0) alignQ.multiply(tmpQ.setFromAxisAngle(dirWorld, roll));
    upper.quaternion.copy(parentQ).invert().multiply(alignQ).multiply(rootQ);
    if (fore) fore.quaternion.identity();
  }
}
