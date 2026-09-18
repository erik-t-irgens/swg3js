// Ragdolls: a dead body left to the physics. Built from any skinned skeleton (a character rig,
// a creature model) without a table of parts: every bone with a child long enough gets a capsule
// from itself to its children, hinged on its nearest ancestor that got one by a ball joint, and
// each frame the bones are posed from the bodies, so the skin follows. It starts from the pose
// the last animation frame left, so a fall carries on from where the death clip ended, and each
// joint is sprung towards that pose (a torque applied here every frame, stiffening past a limit),
// so a body sags and folds under its weight rather than into a heap, and sleeps once it lies still. The bodies touch only what stands still (the ground, buildings,
// a ship's rooms): the physics hooks in physics.ts drop their contacts with players, creatures
// and vehicles, and with one another.
import * as THREE from 'three';
import { Physics, RAPIER } from '../core/physics';

interface Part {
  bone: THREE.Bone;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** The bone's world scale, kept: the physics carries none. */
  scale: THREE.Vector3;
  /** The bone's rotation at death, in the physics frame: the body starts unrotated and carries the capsule turned by this, so every joint rests at zero. */
  rest: THREE.Quaternion;
  /** The part this one hangs from, whose rotation it is sprung towards. */
  parent: Part | null;
  /** The body's angular inertia about its middle, for turning a wanted angular acceleration into a torque. */
  inertia: number;
  depth: number;
}

/**
 * The spring that holds each joint at the pose it died in, as angular accelerations: `stiffness`
 * radians a second squared per radian of bend, `damping` per radian a second of relative turn,
 * and past `limit` radians the spring stiffens by `limitStiffness` more for every radian over,
 * so a body sags and folds under its weight but never past what a joint can do. The torques are
 * applied here each frame rather than by the engine's joint motors and limits: three angular
 * motors and three limits on one ball joint fought one another and never settled. Live in the
 * console as `__debug.ragdoll({ stiffness: 80 })`; the next body to fall takes the new numbers,
 * and the bodies already down take the spring and sleep ones at once.
 */
export const RAGDOLL = {
  stiffness: 60,
  damping: 9,
  limit: 0.8,
  limitStiffness: 400,
  /** The strongest angular acceleration a spring may ask for, so a body thrown hard cannot be flung by its own joints. */
  maxAccel: 40,
  /** The springs shape the fall, then let go: over this many seconds after death they fade to nothing, so a landed body lies loose and still. */
  springFade: 2.5,
  /** Seconds of near stillness (the pieces' mean speed under `restSpeed`) after which the bodies are stopped and put to sleep. */
  settleTime: 1,
  restSpeed: 0.25,
  /** However it twitches, a body slower than this for `forceSleep` seconds is put to sleep as it is. */
  slowSpeed: 2,
  forceSleep: 2.5,
  /** The bodies' own damping. */
  linearDamping: 2,
  angularDamping: 5,
  /** Every piece turns as if it were a ball this wide (metres), whatever its capsule: the spin a contact can give it. */
  inertiaRadius: 0.35,
  friction: 1.2,
};

export interface RagdollOptions {
  /** The frame the physics world is in when it is a room's (a hull's live world matrix); null for the world. */
  frame?: THREE.Matrix4 | null;
  /** The body's speed as it died, carried into the fall (world units a second). */
  velocity?: THREE.Vector3 | null;
  /** Bones shorter than this (metres, bone to its children) ride their parent's body. */
  minLength?: number;
  maxBodies?: number;
  /** The widest a piece's capsule may be, 0.22 m by default; a huge body wants wider pieces than a person's. */
  maxRadius?: number;
  /**
   * The ball each piece turns as if it were, 0.35 m by default (`RAGDOLL.inertiaRadius`). A
   * three-metre bone's mass with a 0.35 m ball's inertia is the "every contact spins it wildly"
   * case, so a big body scales this with its capsules.
   */
  inertiaRadius?: number;
}

const m4 = new THREE.Matrix4();
const m4b = new THREE.Matrix4();
const p = new THREE.Vector3();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const dir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const qp = new THREE.Quaternion();
const qc = new THREE.Quaternion();
const err = new THREE.Quaternion();
const axis = new THREE.Vector3();
const torque = new THREE.Vector3();
const wp = new THREE.Vector3();
const wc = new THREE.Vector3();

export class Ragdoll {
  private readonly parts: Part[] = [];
  private readonly frame: THREE.Matrix4 | null;
  private readonly frameInverse = new THREE.Matrix4();
  private disposed = false;

  constructor(private readonly physics: Physics, private readonly root: THREE.Object3D, opts: RagdollOptions = {}) {
    this.frame = opts.frame ?? null;
    const minLength = opts.minLength ?? 0.12;
    const maxBodies = opts.maxBodies ?? 22;
    const maxRadius = opts.maxRadius ?? 0.22;
    const inertiaRadius = opts.inertiaRadius ?? RAGDOLL.inertiaRadius;
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
      // Every body starts unrotated, the bone's rotation folded into its capsule: so the joints'
      // angles all read zero in the death pose, and the springs and limits work from there.
      // Heavily damped: a corpse does not drift, and the springs' pumping dies away.
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setLinearDamping(RAGDOLL.linearDamping).setAngularDamping(RAGDOLL.angularDamping));
      // The capsule lies from the bone to its children; a bone with none is a small ball.
      const length = Math.max(0.06, b.length || 0.1);
      const radius = THREE.MathUtils.clamp(length * 0.3, 0.05, maxRadius);
      let desc: RAPIER.ColliderDesc;
      if (b.end) {
        dir.copy(b.end).sub(b.pos).normalize();
        const rot = new THREE.Quaternion().setFromUnitVectors(UP, dir);
        desc = RAPIER.ColliderDesc.capsule(Math.max(0.01, length / 2 - radius * 0.5), radius)
          .setTranslation(dir.x * (length / 2), dir.y * (length / 2), dir.z * (length / 2))
          .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
      } else desc = RAPIER.ColliderDesc.ball(radius);
      // A piece's own mass, with the angular inertia of a body a good deal wider than its
      // capsule: a thin capsule's true inertia is so small that every contact spins it wildly,
      // and a skeleton of such pieces shivers for ever.
      const mass = 4 + 10 * length;
      const inertia = mass * inertiaRadius * inertiaRadius * 0.4;
      desc.setMassProperties(mass, { x: 0, y: 0, z: 0 }, { x: inertia, y: inertia, z: inertia }, { x: 0, y: 0, z: 0, w: 1 }).setFriction(RAGDOLL.friction).setRestitution(0).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      const collider = w.createCollider(desc, body);
      physics.markRagdoll(collider);
      if (opts.velocity) body.setLinvel(this.toPhysicsDir(opts.velocity.clone()), true);
      bodyOf.set(b.bone, body);
      // Hinged on the nearest ancestor with a body, at this bone's own origin; the spring towards
      // the death pose is applied each frame (see update).
      let anc: THREE.Object3D | null = b.bone.parent;
      while (anc && !(anc instanceof THREE.Bone && bodyOf.has(anc))) anc = anc.parent;
      let parentPart: Part | null = null;
      if (anc instanceof THREE.Bone) {
        const parent = bodyOf.get(anc)!;
        const pp = info.get(anc)!.pos;
        w.createImpulseJoint(RAPIER.JointData.spherical({ x: p.x - pp.x, y: p.y - pp.y, z: p.z - pp.z }, { x: 0, y: 0, z: 0 }), parent, body, true);
        parentPart = this.parts.find((x) => x.body === parent) ?? null;
      }
      const pi = body.principalInertia();
      this.parts.push({ bone: b.bone, body, collider, scale: s.clone(), rest: q.clone(), parent: parentPart, inertia: Math.max(1e-3, (pi.x + pi.y + pi.z) / 3), depth: b.depth });
    }
  }

  private settled = 0;
  private slow = 0;
  private speed = 0;
  private age = 0;
  private asleep = false;

  /** How the body is doing, for the console: its pieces' mean speed, its age, and whether it sleeps. */
  get status(): { parts: number; speed: number; age: number; asleep: boolean } {
    return { parts: this.parts.length, speed: Number(this.speed.toFixed(2)), age: Number(this.age.toFixed(1)), asleep: this.asleep };
  }

  /**
   * The springs: each body is turned towards its parent's rotation (the pose it died in has every
   * pair aligned, the bones' own turns being in the capsules), harder the farther past the limit,
   * and damped by their relative spin; the parent takes the opposite torque. Once everything has
   * been near still for a while the bodies are put to sleep and left as they lie.
   */
  private spring(dt: number): void {
    if (this.asleep) return;
    this.age += dt;
    const T = RAGDOLL;
    // The springs fade with age: they shape the fall, and a landed body is left to lie loose.
    const fade = T.springFade > 0 ? Math.max(0, 1 - this.age / T.springFade) : 1;
    // How much the body as a whole still moves: the mean of its pieces' speeds, so one twitching
    // hoof against the ground does not keep the rest awake for ever.
    let speed = 0;
    for (const part of this.parts) part.body.resetTorques(false);
    for (const part of this.parts) {
      const v = part.body.linvel();
      const a = part.body.angvel();
      speed += Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) + 0.3 * Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      const parent = part.parent;
      if (!parent) continue;
      const rp = parent.body.rotation();
      const rc = part.body.rotation();
      qp.set(rp.x, rp.y, rp.z, rp.w);
      qc.set(rc.x, rc.y, rc.z, rc.w);
      // The turn from the child's rotation to the parent's, as an axis and an angle.
      err.copy(qp).multiply(qc.invert());
      if (err.w < 0) err.set(-err.x, -err.y, -err.z, -err.w);
      const half = Math.min(1, Math.max(-1, err.w));
      const angle = 2 * Math.acos(half);
      const sin = Math.sqrt(Math.max(0, 1 - half * half));
      if (sin < 1e-5 || angle < 1e-4) axis.set(0, 0, 0);
      else axis.set(err.x / sin, err.y / sin, err.z / sin);
      const ap = parent.body.angvel();
      const ac = part.body.angvel();
      wp.set(ap.x, ap.y, ap.z);
      wc.set(ac.x, ac.y, ac.z).sub(wp);
      if (fade <= 0) continue;
      let accel = T.stiffness * angle + T.limitStiffness * Math.max(0, angle - T.limit);
      accel = Math.min(T.maxAccel, accel) * fade;
      torque.copy(axis).multiplyScalar(accel).addScaledVector(wc, -T.damping * fade).multiplyScalar(part.inertia);
      part.body.addTorque(torque, false);
      parent.body.addTorque(torque.negate(), false);
    }
    speed /= Math.max(1, this.parts.length);
    this.speed = speed;
    this.slow = speed < T.slowSpeed ? this.slow + dt : 0;
    if (speed < T.restSpeed || this.slow >= T.forceSleep) {
      this.settled += dt;
      if (this.settled >= T.settleTime || this.slow >= T.forceSleep) {
        // Still enough: the bodies are stopped and put to sleep, and lie as they are.
        this.asleep = true;
        for (const part of this.parts) {
          part.body.resetTorques(false);
          part.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
          part.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
          part.body.sleep();
        }
      }
    } else this.settled = 0;
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

  /** Pose the bones from the bodies (parents first, each bone's local transform read back under its parent's world matrix), and wind the springs for the next step. */
  update(dt = 1 / 60): void {
    if (this.disposed || !this.parts.length) return;
    this.spring(dt);
    for (const part of this.parts) {
      const t = part.body.translation();
      const r = part.body.rotation();
      m4.compose(p.set(t.x, t.y, t.z), q.set(r.x, r.y, r.z, r.w).multiply(part.rest), part.scale);
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

  /** Whether the body has come to rest and been put to sleep. */
  get still(): boolean {
    return this.asleep;
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
