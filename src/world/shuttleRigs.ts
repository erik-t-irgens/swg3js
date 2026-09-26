// The shuttles that land at the starports and the shuttleports, drawn with the game's own rigs.
//
// A shuttle is a skeleton and its clips -- coming down, going up, parked on the ground and parked in
// the sky -- with its hull hung on its joints: one piece on the shuttle's root, five on the transport's
// (the hull, three landing struts and the door), so its struts fold and its door opens as the clip
// says. `tools/swg/travel.mjs` says where each comes from.
//
// Nothing here keeps time. Where a shuttle is in its round is `shuttleAt`, off the clock every browser
// shares with the port's own name, and which clip that is and where in it is `rigPose`; this file only
// puts that pose on the joints, so two players at one starport watch one shuttle land at one instant,
// and the collector's words and what is drawn on the pad can never disagree.
//
// A rig is prepared (its materials joined and its programs compiled) before it is ever shown, drawn as
// an actor like anything else that moves, and while it stands waiting on its pad it is solid: the
// shuttle it replaced was a placed prop you could not walk through, and a parked hull you could would
// be the first thing anybody noticed. Every number of ours is `SHUTTLE_RIG_TUNE`, live through
// `__debug.terminal({ rigs: ... })`.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { cleanTrimesh, Group, groups, RAPIER as R, TRIMESH_FLAGS, type Physics } from '../core/physics.ts';
import { surfaces } from './surfaces.ts';
import { rigPose, type RigClips, type RigPose, type ShuttleState, type ShuttleTimes, type TravelRig } from './travelTerminal.ts';

/** Every number of ours about the drawn shuttles. */
export const SHUTTLE_RIG_TUNE = {
  /** Metres from the camera to a shuttle's pad within which it is posed and drawn at all. */
  reach: 9000,
  /** Whether a parked shuttle is solid. */
  solid: true,
};

/** What a stood shuttle needs from the game: where it is in its round, now. */
export interface ShuttleClock {
  state(): ShuttleState;
  times: ShuttleTimes;
}

export interface ShuttleRigDeps {
  scene: THREE.Scene;
  physics: Physics;
  /** The root of the packs, with its trailing slash. */
  base: string;
  /** Materials joined and programs compiled before it is shown (`World.prepareActor`). */
  prepare(root: THREE.Object3D): Promise<void>;
  /** Out of the portal renderer's set and the cascades' map, before a material is disposed. */
  forget(materials: Iterable<THREE.Material>): void;
}

/** A rig as loaded: its joints, its clips, and each piece's model with the joint it rides. */
interface RigAsset {
  joints: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  parts: { joint: string; model: THREE.Object3D }[];
  /** Everything it owns, for when the world goes. */
  materials: Set<THREE.Material>;
  geometries: Set<THREE.BufferGeometry>;
}

interface Stood {
  key: string;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<RigPose['role'], THREE.AnimationAction>>;
  current: THREE.AnimationAction | null;
  clock: ShuttleClock;
  inside: boolean;
  shown: boolean;
  /** The hull as it stands parked, in the world, once worked out; and its collider while parked. */
  hull: { vertices: Float32Array; indices: Uint32Array } | null;
  collider: R.Collider | null;
  role: RigPose['role'];
}

const tmpPose: RigPose = { role: 'sky', seconds: 0, shown: false };
const tmpV = new THREE.Vector3();

export class ShuttleRigs {
  private readonly deps: ShuttleRigDeps;
  private readonly assets = new Map<string, Promise<RigAsset | null>>();
  private readonly stood: Stood[] = [];
  private readonly loader = surfaces.withPlugin(new GLTFLoader());
  /** Why the last rig that would not stand would not, for the console. */
  note = '';
  /** Moved on by every `clear`, so a stand begun for a world that has gone is dropped. */
  private generation = 0;

  constructor(deps: ShuttleRigDeps) {
    this.deps = deps;
  }

  /** How many are stood, and each one's pose, for the console. */
  describe(): { stood: number; note: string; shuttles: { key: string; role: string; shown: boolean; solid: boolean; inside: boolean }[] } {
    return { stood: this.stood.length, note: this.note, shuttles: this.stood.map((s) => ({ key: s.key, role: s.role, shown: s.shown, solid: !!s.collider, inside: s.inside })) };
  }

  /** Every stood shuttle's root, for the motion blur: the root stays on its pad and the joints move. */
  roots(out: THREE.Object3D[]): THREE.Object3D[] {
    out.length = 0;
    for (const s of this.stood) if (s.shown) out.push(s.root);
    return out;
  }

  private load(rig: TravelRig): Promise<RigAsset | null> {
    let p = this.assets.get(rig.file);
    if (!p) {
      p = this.fetchRig(rig).catch((err) => {
        this.note = `the rig ${rig.file} would not load: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(this.note);
        return null;
      });
      this.assets.set(rig.file, p);
    }
    return p;
  }

  private async fetchRig(rig: TravelRig): Promise<RigAsset> {
    const base = this.deps.base;
    const skeleton = await this.loader.loadAsync(base + rig.file);
    const parts: RigAsset['parts'] = [];
    const materials = new Set<THREE.Material>();
    const geometries = new Set<THREE.BufferGeometry>();
    for (const p of rig.parts) {
      const gltf = await this.loader.loadAsync(base + p.file);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        geometries.add(m.geometry);
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat);
      });
      parts.push({ joint: p.joint, model: gltf.scene });
    }
    return { joints: skeleton.scene, clips: new Map(skeleton.animations.map((a) => [a.name, a])), parts, materials, geometries };
  }

  /**
   * Stand one shuttle on its pad: the rig's joints cloned, its pieces hung on them, prepared out of
   * sight, and then posed every frame from `clock`. False when the rig will not load or has none of
   * the clips its branch names.
   */
  async stand(key: string, rig: TravelRig, mood: string, at: { x: number; y: number; z: number; yaw: number }, inside: boolean, clock: ShuttleClock): Promise<boolean> {
    // A world can go while this waits on a load or a compile: what was begun for it is then dropped
    // rather than stood in the next one.
    const generation = this.generation;
    const asset = await this.load(rig);
    if (!asset || generation !== this.generation) return false;
    const clips: RigClips | undefined = rig.moods[mood] ?? Object.values(rig.moods)[0];
    if (!clips) {
      this.note = `the rig ${rig.file} has no clips for ${mood || 'its only branch'}`;
      return false;
    }
    const root = new THREE.Group();
    root.name = `shuttle:${key}`;
    root.position.set(at.x, at.y, at.z);
    root.rotation.y = at.yaw;
    const joints = asset.joints.clone(true);
    root.add(joints);
    for (const p of asset.parts) {
      const joint = joints.getObjectByName(p.joint);
      if (!joint) {
        this.note = `the rig ${rig.file} has no joint ${p.joint}`;
        continue;
      }
      joint.add(p.model.clone(true));
    }
    root.visible = false;
    this.deps.scene.add(root);
    root.updateMatrixWorld(true);
    await this.deps.prepare(root);
    if (generation !== this.generation) {
      this.deps.scene.remove(root);
      return false;
    }
    // Culled piece by piece, since a piece is a still model whose own box is right; prepareActor
    // turns that off for the skinned actors it was written for.
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.frustumCulled = true;
    });
    const mixer = new THREE.AnimationMixer(joints);
    const actions: Stood['actions'] = {};
    for (const role of ['land', 'lift', 'ground', 'sky'] as const) {
      const name = clips[role];
      const clip = name ? asset.clips.get(name) : undefined;
      if (!clip) continue;
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      actions[role] = a;
    }
    if (!actions.land || !actions.lift) {
      this.deps.scene.remove(root);
      this.note = `the rig ${rig.file} has no ${actions.land ? 'lift-off' : 'landing'} clip`;
      return false;
    }
    this.stood.push({ key, root, mixer, actions, current: null, clock, inside, shown: false, hull: null, collider: null, role: 'sky' });
    return true;
  }

  /** Put every shuttle near the camera where its round says it is. */
  update(camera: THREE.Vector3): void {
    const reach = SHUTTLE_RIG_TUNE.reach;
    for (const s of this.stood) {
      const pose = rigPose(s.clock.state(), s.clock.times, tmpPose);
      const near = s.root.position.distanceToSquared(camera) < reach * reach;
      s.role = pose.role;
      s.shown = pose.shown && near;
      s.root.visible = s.shown;
      if (s.shown) this.pose(s, pose);
      this.solid(s, s.shown && pose.role === 'ground' && SHUTTLE_RIG_TUNE.solid);
    }
  }

  private pose(s: Stood, pose: RigPose): void {
    // Parked on the ground with no clip of its own for it: the landing's last instant is the same pose.
    let action = s.actions[pose.role];
    let seconds = pose.seconds;
    if (!action && pose.role === 'ground') {
      action = s.actions.land!;
      seconds = action.getClip().duration;
    }
    if (!action) return;
    if (s.current !== action) {
      s.current?.stop();
      action.reset();
      action.play();
      s.current = action;
    }
    action.paused = true;
    action.time = Math.min(seconds, action.getClip().duration);
    s.mixer.update(0);
  }

  /** A parked shuttle's collider on or off: built the first time it is parked, from the hull as it stands. */
  private solid(s: Stood, want: boolean): void {
    if (!want) {
      if (s.collider) {
        this.deps.physics.removeCollider(s.collider);
        s.collider = null;
      }
      return;
    }
    if (s.collider) return;
    if (!s.hull) {
      s.root.updateMatrixWorld(true);
      s.hull = hullOf(s.root);
      if (!s.hull) return;
    }
    const desc = R.ColliderDesc.trimesh(s.hull.vertices, s.hull.indices, TRIMESH_FLAGS).setFriction(0.8);
    desc.setCollisionGroups(s.inside ? groups(Group.interior, Group.all) : groups(Group.all, Group.all));
    s.collider = this.deps.physics.world.createCollider(desc);
  }

  /** Take every shuttle down and let go of the rigs: the world they stood in is going. */
  clear(): void {
    this.generation++;
    for (const s of this.stood) {
      this.solid(s, false);
      s.mixer.stopAllAction();
      s.mixer.uncacheRoot(s.root.children[0]);
      this.deps.scene.remove(s.root);
    }
    this.stood.length = 0;
    const loads = [...this.assets.values()];
    this.assets.clear();
    for (const p of loads) {
      void p.then((a) => {
        if (!a) return;
        this.deps.forget(a.materials);
        for (const m of a.materials) m.dispose();
        for (const g of a.geometries) g.dispose();
      });
    }
  }
}

/** The hull's triangles in the world, from every mesh under a posed root; null when there are none. */
function hullOf(root: THREE.Object3D): { vertices: Float32Array; indices: Uint32Array } | null {
  const verts: number[] = [];
  const idx: number[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    if (!pos) return;
    const first = verts.length / 3;
    for (let i = 0; i < pos.count; i++) {
      tmpV.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      verts.push(tmpV.x, tmpV.y, tmpV.z);
    }
    const index = m.geometry.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(first + index.getX(i));
    else for (let i = 0; i < pos.count; i++) idx.push(first + i);
  });
  if (!idx.length) return null;
  const clean = cleanTrimesh(new Float32Array(verts), new Uint32Array(idx));
  return clean ? { vertices: clean.vertices, indices: clean.indices } : null;
}
