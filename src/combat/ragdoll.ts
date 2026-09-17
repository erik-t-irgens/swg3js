// Ragdolls: a dead body left to the physics. Built from any skinned skeleton (a character rig,
// a creature model) without a table of parts: every bone with a child long enough gets a capsule
// from itself to its children, hinged on its nearest ancestor that got one by a ball joint, and
// each frame the bones are posed from the bodies, so the skin follows. It starts from the pose
// the last animation frame left, so a fall carries on from where the death clip ended. The
// bodies touch only what stands still (the ground, buildings, a ship's rooms): the physics hooks
// in physics.ts drop their contacts with players, creatures and vehicles, and with one another.
import * as THREE from 'three';
import { Physics, RAPIER } from '../core/physics';

interface Part {
  bone: THREE.Bone;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** The bone's world scale, kept: the physics carries none. */
  scale: THREE.Vector3;
  depth: number;
}

export interface RagdollOptions {
  /** The frame the physics world is in when it is a room's (a hull's live world matrix); null for the world. */
  frame?: THREE.Matrix4 | null;
  /** The body's speed as it died, carried into the fall (world units a second). */
  velocity?: THREE.Vector3 | null;
  /** Bones shorter than this (metres, bone to its children) ride their parent's body. */
  minLength?: number;
  maxBodies?: number;
}

const m4 = new THREE.Matrix4();
const m4b = new THREE.Matrix4();
const p = new THREE.Vector3();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const end = new THREE.Vector3();
const dir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Ragdoll {
  private readonly parts: Part[] = [];
  private readonly frame: THREE.Matrix4 | null;
  private readonly frameInverse = new THREE.Matrix4();
  private disposed = false;

  constructor(private readonly physics: Physics, private readonly root: THREE.Object3D, opts: RagdollOptions = {}) {
    this.frame = opts.frame ?? null;
    const minLength = opts.minLength ?? 0.12;
    const maxBodies = opts.maxBodies ?? 22;
    root.updateMatrixWorld(true);
    if (this.frame) this.frameInverse.copy(this.frame).invert();
    // Every bone, with where it is and where its children are, in the physics world's frame.
    const bones: { bone: THREE.Bone; depth: number; pos: THREE.Vector3; end: THREE.Vector3 | null; length: number }[] = [];
    root.traverse((o) => {
      if (!(o instanceof THREE.Bone)) return;
      let depth = 0;
      for (let n = o.parent; n; n = n.parent) if (n instanceof THREE.Bone) depth++;
      const pos = this.toPhysics(o.getWorldPosition(new THREE.Vector3()));
      const kids = o.children.filter((c): c is THREE.Bone => c instanceof THREE.Bone);
      let endP: THREE.Vector3 | null = null;
      if (kids.length) {
        endP = new THREE.Vector3();
        for (const k of kids) endP.add(this.toPhysics(k.getWorldPosition(new THREE.Vector3())));
        endP.divideScalar(kids.length);
      }
      bones.push({ bone: o, depth, pos, end: endP, length: endP ? endP.distanceTo(pos) : 0 });
    });
    if (!bones.length) return;
    // The bones that get bodies: the topmost always, then the longest, to the cap.
    const top = bones.find((b) => !(b.bone.parent instanceof THREE.Bone)) ?? bones[0];
    const chosen = new Set<THREE.Bone>([top.bone]);
    for (const b of bones.filter((x) => x.length >= minLength && x !== top).sort((a, c) => c.length - a.length)) {
      if (chosen.size >= maxBodies) break;
      chosen.add(b.bone);
    }
    const w = physics.world;
    const bodyOf = new Map<THREE.Bone, RAPIER.RigidBody>();
    const info = new Map(bones.map((b) => [b.bone, b]));
    for (const b of bones.sort((a, c) => a.depth - c.depth)) {
      if (!chosen.has(b.bone)) continue;
      m4.copy(this.frameInverse).multiply(b.bone.matrixWorld).decompose(p, q, s);
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setLinearDamping(0.6).setAngularDamping(4).setCcdEnabled(true));
      // The capsule lies from the bone to its children, in the bone's own frame; a bone with none is a small ball.
      const length = Math.max(0.06, b.length || 0.1);
      const radius = THREE.MathUtils.clamp(length * 0.3, 0.05, 0.22);
      let desc: RAPIER.ColliderDesc;
      if (b.end) {
        dir.copy(b.end).sub(b.pos).normalize().applyQuaternion(q.clone().invert());
        const rot = new THREE.Quaternion().setFromUnitVectors(UP, dir);
        desc = RAPIER.ColliderDesc.capsule(Math.max(0.01, length / 2 - radius * 0.5), radius)
          .setTranslation(dir.x * (length / 2), dir.y * (length / 2), dir.z * (length / 2))
          .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
      } else desc = RAPIER.ColliderDesc.ball(radius);
      desc.setMass(4 + 10 * length).setFriction(0.9).setRestitution(0.05).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      const collider = w.createCollider(desc, body);
      physics.markRagdoll(collider);
      if (opts.velocity) body.setLinvel(this.toPhysicsDir(opts.velocity.clone()), true);
      bodyOf.set(b.bone, body);
      this.parts.push({ bone: b.bone, body, collider, scale: s.clone(), depth: b.depth });
      // Hinged on the nearest ancestor with a body, at this bone's own origin.
      let anc: THREE.Object3D | null = b.bone.parent;
      while (anc && !(anc instanceof THREE.Bone && bodyOf.has(anc))) anc = anc.parent;
      if (anc instanceof THREE.Bone) {
        const parent = bodyOf.get(anc)!;
        const pp = info.get(anc)!.pos;
        const pr = parent.rotation();
        const local = p.clone().sub(pp).applyQuaternion(new THREE.Quaternion(pr.x, pr.y, pr.z, pr.w).invert());
        w.createImpulseJoint(RAPIER.JointData.spherical({ x: local.x, y: local.y, z: local.z }, { x: 0, y: 0, z: 0 }), parent, body, true);
      }
    }
  }

  private toPhysics(v: THREE.Vector3): THREE.Vector3 {
    return this.frame ? v.applyMatrix4(this.frameInverse) : v;
  }

  private toPhysicsDir(v: THREE.Vector3): THREE.Vector3 {
    return this.frame ? v.transformDirection(this.frameInverse) : v;
  }

  /** How many bodies the skeleton got. */
  get size(): number {
    return this.parts.length;
  }

  /** Pose the bones from the bodies: parents first, each bone's local transform read back under its parent's world matrix. */
  update(): void {
    if (this.disposed || !this.parts.length) return;
    for (const part of this.parts) {
      const t = part.body.translation();
      const r = part.body.rotation();
      m4.compose(p.set(t.x, t.y, t.z), q.set(r.x, r.y, r.z, r.w), part.scale);
      if (this.frame) m4.premultiply(this.frame);
      const parent = part.bone.parent;
      if (!parent) continue;
      parent.updateWorldMatrix(true, false);
      m4b.copy(parent.matrixWorld).invert().multiply(m4);
      m4b.decompose(part.bone.position, part.bone.quaternion, part.bone.scale);
      part.bone.updateWorldMatrix(false, false);
    }
    this.root.updateMatrixWorld(true);
  }

  /** Where the body's trunk is, in the world. */
  centre(out: THREE.Vector3): THREE.Vector3 {
    const part = this.parts[0];
    if (!part) return out.set(0, 0, 0);
    const t = part.body.translation();
    out.set(t.x, t.y, t.z);
    if (this.frame) out.applyMatrix4(this.frame);
    return out;
  }

  /** Whether the body has come to rest. */
  get still(): boolean {
    return this.parts.every((part) => {
      const v = part.body.linvel();
      return v.x * v.x + v.y * v.y + v.z * v.z < 0.01;
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const part of this.parts) {
      this.physics.unmarkRagdoll(part.collider);
      this.physics.world.removeRigidBody(part.body);
    }
    this.parts.length = 0;
  }
}
