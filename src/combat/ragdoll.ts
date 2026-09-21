// Ragdolls: a dead body left to the physics. Built from any skinned skeleton (a character rig,
// a creature model) without a table of parts: every bone with a child long enough gets a capsule
// from itself to its children, hinged on its nearest ancestor that got one by a ball joint, and
// each frame the bones are posed from the bodies, so the skin follows. It starts from the pose
// the last animation frame left, so a fall carries on from where the death clip ended, and each
// joint is sprung towards that pose (a torque applied here every frame, stiffening past a limit),
// so a body sags and folds under its weight rather than into a heap, and sleeps once it lies still. The bodies touch only what stands still (the ground, buildings,
// a ship's rooms): the physics hooks in physics.ts drop their contacts with players, creatures
// and vehicles, and with one another unless `RAGDOLL.selfCollide` is on, in which case one body's
// own pieces meet each other and no others.
import * as THREE from 'three';
import { Physics, RAGDOLL_RULES, RAPIER } from '../core/physics.ts';

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
  /**
   * The body's three principal angular inertias about its middle, for turning a wanted angular
   * acceleration into a torque. Three numbers and not one: a capsule resists being swung across
   * itself several times as hard as it resists spinning about its own length (a thin one, twenty
   * times), so a single scalar would ask for an acceleration it could not deliver about one axis
   * and several times too much about another.
   */
  inertia: THREE.Vector3;
  /** The frame those three are measured in, in the body's own space: the capsule's own turn. */
  principal: THREE.Quaternion;
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
  /**
   * The strongest angular acceleration a spring may ask for, so a body thrown hard cannot be flung
   * by its own joints. It is radians a second squared about whatever axis the spring is pulling,
   * and it really is that: the torque is worked out through each piece's own inertia tensor
   * (`jointTorque`), so a capsule that is twenty times harder to swing than to spin is asked for
   * the same acceleration either way. Worked out through one scalar it would not be -- which is
   * the trap `pieceInertia` opened when the pieces stopped being balls.
   */
  maxAccel: 40,
  /** The springs shape the fall, then let go: over this many seconds after death they fade to nothing, so a landed body lies loose and still. */
  springFade: 2.5,
  /** Seconds of near stillness (the pieces' mean speed under `restSpeed`) after which the bodies are stopped and put to sleep. */
  settleTime: 1,
  restSpeed: 0.25,
  /** However it twitches, a body slower than this for `forceSleep` seconds is put to sleep as it is. */
  slowSpeed: 2,
  forceSleep: 2.5,
  /**
   * The bodies' own damping. The linear one is all but nothing: a body killed on a ledge has to
   * accelerate as it falls, and at the 2 this was it reached ten metres a second and stayed there,
   * which reads as a corpse sinking through the air rather than dropping. What stops a fallen body
   * drifting is the sleep rule below, not this.
   */
  linearDamping: 0.05,
  angularDamping: 5,
  /** Every piece turns as if it were a ball this wide (metres) at the far end of `inertiaBlend`: the spin a contact can give it. */
  inertiaRadius: 0.35,
  /**
   * How each piece turns: 0 is the capsule's own inertia, small about its long axis and large
   * across it, so a limb swings like a limb; 1 is the ball of `inertiaRadius` every piece used to
   * be, which is where to go back to if a skeleton of thin true capsules shivers under the solver.
   * Anything between is a blend of the two, axis by axis.
   */
  inertiaBlend: 0,
  /** No piece turns more freely than this (kg m²), whatever the blend: a needle-thin capsule is a hole for the solver to fall into. */
  minInertia: 0.005,
  /**
   * Whether one corpse's own pieces meet each other (`__debug.ragdoll({ selfCollide: true })`). It
   * is the rule the game turned off on purpose -- with the contact hooks silently skipped, every
   * piece met every other and the body shivered for ever -- so it stays off until the owner has
   * looked at it. The switch itself lives in physics.ts, where the contact filter reads it.
   */
  get selfCollide(): boolean {
    return RAGDOLL_RULES.selfCollide;
  },
  set selfCollide(on: boolean) {
    RAGDOLL_RULES.selfCollide = !!on;
  },
  /**
   * Two pieces closer than this (metres) in the pose the body died in never meet, switch or no:
   * a pair that starts inside its neighbour would be thrown apart on the first step.
   */
  selfCollideGap: 0.03,
  friction: 1.2,
};

/**
 * A capsule's own angular inertia about its middle: `axial` about its long axis (the small one,
 * which is what lets a limb spin about itself) and `across` about either axis at right angles to
 * it. A cylinder of radius `radius` and height `2 * half`, with a hemisphere on each end, at one
 * density throughout. `half` 0 is a ball, where the two are equal.
 */
export function capsuleInertia(mass: number, half: number, radius: number): { axial: number; across: number } {
  const r = Math.max(1e-4, radius);
  const h = Math.max(0, 2 * half);
  const cyl = Math.PI * r * r * h;
  const caps = (4 / 3) * Math.PI * r * r * r;
  const mc = (mass * cyl) / (cyl + caps);
  const mh = mass - mc;
  // The two hemispheres about the capsule's middle: each is 2/5 m r² about its own flat face's
  // centre, moved out to h/2 with its own centre of mass 3r/8 inside it.
  return {
    axial: 0.5 * mc * r * r + 0.4 * mh * r * r,
    across: (mc * (3 * r * r + h * h)) / 12 + mh * (0.4 * r * r + (h * h) / 4 + 0.375 * h * r),
  };
}

/**
 * What goes on a piece: the capsule's own inertia blended toward the ball of `ballRadius` by
 * `RAGDOLL.inertiaBlend` and floored at `RAGDOLL.minInertia`, in the capsule's own frame (its
 * long axis is the collider's local Y).
 */
export function pieceInertia(mass: number, half: number, radius: number, ballRadius: number, blend = RAGDOLL.inertiaBlend): { x: number; y: number; z: number } {
  const { axial, across } = capsuleInertia(mass, half, radius);
  const ball = 0.4 * mass * ballRadius * ballRadius;
  const b = Math.min(1, Math.max(0, blend));
  const mix = (own: number): number => Math.max(RAGDOLL.minInertia, own * (1 - b) + ball * b);
  return { x: mix(across), y: mix(axial), z: mix(across) };
}

/**
 * The torque that asks a piece for a wanted angular acceleration (`want`, in the world's frame),
 * given where the piece is turned to now (`bodyRot`), the frame its three principal inertias are
 * measured in (`principal`, in the body's own space) and those inertias.
 *
 * This is the whole of `T = I a` for a body whose inertia is not a ball: the wanted acceleration is
 * taken into the piece's principal frame, multiplied axis by axis, and brought back. Multiplying by
 * one scalar instead -- the mean of the three, as this did while every piece was a ball and it made
 * no difference -- asks for mean/axial times the acceleration wanted about a capsule's long axis
 * and mean/across times it across, so `RAGDOLL.maxAccel` stops meaning anything and the damping
 * term is over-applied by the same factor. On a thin piece that factor is about twenty, and an
 * explicit -k w term with k dt past 2 does not settle: it grows, which is the shiver.
 *
 * Allocates nothing: the two turns are module scratch and the answer is written into `out`.
 */
export function jointTorque(want: THREE.Vector3, bodyRot: THREE.Quaternion, principal: THREE.Quaternion, inertia: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  // The piece's principal axes as they lie in the world just now, and the way back into them.
  jtWorld.copy(principal).premultiply(bodyRot);
  jtLocal.copy(jtWorld).invert();
  out.copy(want).applyQuaternion(jtLocal);
  out.set(out.x * inertia.x, out.y * inertia.y, out.z * inertia.z);
  return out.applyQuaternion(jtWorld);
}

/**
 * The least distance between two line segments, which for two capsules is the distance between
 * their axes: they overlap when it is less than the sum of their radii. Used once per body, at
 * death, to find the pairs of pieces that already lie inside one another.
 */
export function segmentDistance(a1: THREE.Vector3, b1: THREE.Vector3, a2: THREE.Vector3, b2: THREE.Vector3): number {
  segD1.copy(b1).sub(a1);
  segD2.copy(b2).sub(a2);
  segR.copy(a1).sub(a2);
  const a = segD1.dot(segD1);
  const e = segD2.dot(segD2);
  const f = segD2.dot(segR);
  const eps = 1e-12;
  let s = 0;
  let t = 0;
  if (a <= eps && e <= eps) return segR.length();
  if (a <= eps) t = Math.min(1, Math.max(0, f / e));
  else {
    const c = segD1.dot(segR);
    if (e <= eps) s = Math.min(1, Math.max(0, -c / a));
    else {
      const b = segD1.dot(segD2);
      const denom = a * e - b * b;
      s = denom > eps ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  segA.copy(a1).addScaledVector(segD1, s);
  segB.copy(a2).addScaledVector(segD2, t);
  return segA.distanceTo(segB);
}

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
   * The ball a piece would turn as if it were, 0.35 m by default (`RAGDOLL.inertiaRadius`). Each
   * piece now turns as its own capsule does, so this is only the far end of `RAGDOLL.inertiaBlend`
   * and nothing while the blend is 0; a big body still scales it with its capsules, so that turning
   * the blend up on a three-metre bone asks for a three-metre bone's ball and not a person's.
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
const qrot = new THREE.Quaternion();
const jtWorld = new THREE.Quaternion();
const jtLocal = new THREE.Quaternion();
const axis = new THREE.Vector3();
const want = new THREE.Vector3();
const torque = new THREE.Vector3();
const wp = new THREE.Vector3();
const wc = new THREE.Vector3();
const segD1 = new THREE.Vector3();
const segD2 = new THREE.Vector3();
const segR = new THREE.Vector3();
const segA = new THREE.Vector3();
const segB = new THREE.Vector3();

export class Ragdoll {
  private readonly parts: Part[] = [];
  // Written out rather than declared in the constructor's own parameters: node's type stripping,
  // which is what runs this file's test, does not take a TypeScript parameter property.
  private readonly physics: Physics;
  private readonly root: THREE.Object3D;
  private readonly frame: THREE.Matrix4 | null;
  private readonly frameInverse = new THREE.Matrix4();
  private disposed = false;

  constructor(physics: Physics, root: THREE.Object3D, opts: RagdollOptions = {}) {
    this.physics = physics;
    this.root = root;
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
    // This corpse's own group number, and each piece's capsule axis and the piece it hangs from:
    // what the contact filter is told once the whole skeleton is up (see the end of this method).
    const group = physics.nextRagdollGroup();
    const axes: { a: THREE.Vector3; b: THREE.Vector3; r: number }[] = [];
    const hangsFrom: (Part | null)[] = [];
    for (const b of bones.sort((a, c) => a.depth - c.depth)) {
      if (!chosen.has(b.bone)) continue;
      m4.copy(this.frameInverse).multiply(b.bone.matrixWorld).decompose(p, q, s);
      // Every body starts unrotated, the bone's rotation folded into its capsule: so the joints'
      // angles all read zero in the death pose, and the springs and limits work from there.
      // Damped in its turning, so the springs' pumping dies away, and all but not at all in its
      // falling: what stops a fallen body drifting is the sleep rule, not its drag through the air.
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setLinearDamping(RAGDOLL.linearDamping).setAngularDamping(RAGDOLL.angularDamping));
      // The capsule lies from the bone to its children; a bone with none is a small ball.
      const length = Math.max(0.06, b.length || 0.1);
      const radius = THREE.MathUtils.clamp(length * 0.3, 0.05, maxRadius);
      const half = Math.max(0.01, length / 2 - radius * 0.5);
      let desc: RAPIER.ColliderDesc;
      // Where the capsule's axis lies in the physics frame, for the pairs that already lie inside
      // one another; a ball is both its ends at once.
      const span = { a: b.pos.clone(), b: b.pos.clone(), r: radius };
      if (b.end) {
        dir.copy(b.end).sub(b.pos).normalize();
        const rot = new THREE.Quaternion().setFromUnitVectors(UP, dir);
        desc = RAPIER.ColliderDesc.capsule(half, radius)
          .setTranslation(dir.x * (length / 2), dir.y * (length / 2), dir.z * (length / 2))
          .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
        span.a.addScaledVector(dir, length / 2 - half);
        span.b.addScaledVector(dir, length / 2 + half);
      } else desc = RAPIER.ColliderDesc.ball(radius);
      // A piece's own mass, turning as the capsule it is: little about its long axis and a good
      // deal across it, which is what makes a limb swing like a limb. The ball every piece used to
      // turn as is still there at the far end of `RAGDOLL.inertiaBlend`, for a skeleton of thin
      // true capsules that shivers under the solver.
      const mass = 4 + 10 * length;
      const inertia = pieceInertia(mass, b.end ? half : 0, radius, inertiaRadius);
      desc.setMassProperties(mass, { x: 0, y: 0, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 }).setFriction(RAGDOLL.friction).setRestitution(0).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      const collider = w.createCollider(desc, body);
      axes.push(span);
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
      // Read back off the body rather than worked out again: the engine has carried the collider's
      // own mass properties through the capsule's turn, so these three and the frame they are in
      // are exactly what the solver will divide the spring's torque by.
      const pi = body.principalInertia();
      const pf = body.principalInertiaLocalFrame();
      hangsFrom.push(parentPart);
      this.parts.push({
        bone: b.bone,
        body,
        collider,
        scale: s.clone(),
        rest: q.clone(),
        parent: parentPart,
        inertia: new THREE.Vector3(Math.max(1e-4, pi.x), Math.max(1e-4, pi.y), Math.max(1e-4, pi.z)),
        principal: new THREE.Quaternion(pf.x, pf.y, pf.z, pf.w),
        depth: b.depth,
      });
    }
    // Now the whole skeleton is up, the contact filter is told what each piece is: whose body it
    // belongs to (pieces of two corpses never meet) and the pieces of its own body it must never
    // meet however the switch stands -- the one a joint holds it to, which overlaps it at the
    // joint, and any it already lies inside in the pose the body died in. Both would be thrown
    // apart on the first step. Everything else is left to `RAGDOLL.selfCollide`.
    const gap = RAGDOLL.selfCollideGap;
    for (let i = 0; i < this.parts.length; i++) {
      const ignore: number[] = [];
      const hung = hangsFrom[i];
      if (hung) ignore.push(hung.collider.handle);
      for (let j = 0; j < this.parts.length; j++) {
        if (i === j || this.parts[j] === hung) continue;
        if (segmentDistance(axes[i].a, axes[i].b, axes[j].a, axes[j].b) < axes[i].r + axes[j].r + gap) ignore.push(this.parts[j].collider.handle);
      }
      physics.markRagdoll(this.parts[i].collider, group, ignore);
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
      // Kept before the invert below, which is in place: the torque is worked out in this piece's
      // own frame and brought back, and that needs the turn itself and not its opposite.
      qrot.copy(qc);
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
      // What the joint wants of this piece, as an angular acceleration: the spring toward the
      // parent's turn, less the damping on their relative spin. `maxAccel` has already capped the
      // spring, and because the tensor below is the piece's real one that cap holds about whatever
      // axis the spring pulls, and the damping really is `damping` per radian a second.
      want.copy(axis).multiplyScalar(accel).addScaledVector(wc, -T.damping * fade);
      jointTorque(want, qrot, part.principal, part.inertia, torque);
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
