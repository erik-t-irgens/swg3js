// One creature, droid or person from the catalogue, standing in the world: a rotation-locked
// dynamic body shaped from its template and its bind-pose box (shape.ts), a skeleton cloned from
// the shared model and driven by its pack's clips by role (animator.ts), speeds that keep its
// feet from sliding (gait.ts), and a brain that wanders, chases, strikes, shoots, flees or goes
// home (brain.ts), all on the world's simulated clock.
//
// The body exists before the model does: a spawn is never blocked on a download, a bolt can find
// and kill a mobile whose model is still loading, and a body with no model is simply not drawn.
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Group, groups, RAPIER, type Physics } from '../../core/physics';
import type { Terrain } from '../terrain';
import type { Bolts } from '../../combat/bolts';
import type { Effects } from '../../combat/effects';
import { GUNS, type GunProfile } from '../../combat/guns';
import { Ragdoll } from '../../combat/ragdoll';
import { SaberBlade } from '../../combat/saberBlade';
import { boneForRole } from '../../player/rig';
import { MUZZLE_PATTERNS } from './arms';
import { nextLivingKey, PLAYER_KEY, type Aggression, type Living, type Side } from '../../combat/kit';
import { hostileSides, sideOf } from '../../combat/targets';
import { markActor } from '../portalRender';
import { planBody, radiusToward, type BodyInput, type BodyPlan } from './shape';
import { moveSpeeds, stepGait, type GaitStep } from './gait';
import { BRAIN_TUNE, decide, type BrainSelf, type BrainTarget, type Decision } from './brain';
import { LOD_TUNE, type LodTier } from './lod';
import { MobileAnimator, SHOT_PRIORITY } from './animator';
import { describeRoles, rolesFor } from './packClips';
import type { PackAsset } from './assets';
import type { Gait, MobileEntry, MobileState, Roles, Vec3 } from './types';

export type { MobileState };

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
/** What a blade faces while no camera is given (a headless step). */
const IDLE_CAMERA = new THREE.PerspectiveCamera();

/** The body a mobile wears: a plain model's prototype, or a person's dressed look; cloned per mobile. */
export interface MobileBody {
  key: string;
  scene: THREE.Object3D;
}

/** What the pack is played with beyond its own clips and roles: a Jedi's swings off a species rig, a rifle's stance. */
export interface MobileExtras {
  clips?: ReadonlyMap<string, THREE.AnimationClip>;
  roles?: Partial<Roles>;
}

/** A weapon off the rack, loaded and prepared, for a person to hold. */
export interface MobileEquipment {
  /** The rack's id, for the console. */
  id: string;
  /** A fresh copy of the rack's model (its materials and geometry are the rack's, never disposed here). */
  model: THREE.Object3D;
  kind: 'gun' | 'saber';
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
}

/** Collision filters: outdoors everything, a hull ball everything but the terrain, indoors neither the terrain nor the shells. */
const OUTSIDE = groups(Group.all, Group.all);
const HULL_OUTSIDE = groups(Group.all, Group.all & ~Group.terrain);
const INSIDE = groups(Group.all, Group.all & ~(Group.terrain | Group.exterior));

/** The shove a melee blow gives, by size class. */
const BLOW_PUSH = { tiny: 1, small: 3, medium: 6, large: 10, huge: 16 } as const;
/** A creature's spit: speed (m/s), colour, drop, and the acid burn it leaves (share of the blow a second, seconds). */
const SPIT = { speed: 28, color: 0xb8e04a, gravity: 4, size: 1.2, burn: 0.15, burnFor: 3 };
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
  origin: 'spawned' | 'ambient';
  inside: boolean;
  /** The appearance's bind-pose box and the pack's hierarchy, from the catalogue. */
  bounds: { min: Vec3; max: Vec3 };
  hierarchy: BodyInput['hierarchy'];
  /** Else picked in `entry.size.scale`. */
  scale?: number;
  /** The planet's own values, when it is the planet's wildlife. */
  overrides?: { hp?: number; damage?: number; aggression?: Aggression };
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
  /** Asking for the ragdoll, which the manager starts a couple a frame. */
  wantRagdoll(self: Mobile): void;
}

export interface MobileContext {
  now: number;
  dt: number;
  camera: THREE.Camera | null;
  playerPos: THREE.Vector3;
  targets: readonly Living[];
}

interface Grudge {
  who: Living;
  at: number;
  total: number;
}

export class Mobile implements Living {
  /**
   * Its place in the one list of living things, for as long as it lives. A respawn is a new
   * life, so it takes a new key: a brain that remembered this body must not find the fresh one.
   */
  key = nextLivingKey();
  readonly entry: MobileEntry;
  readonly origin: 'spawned' | 'ambient';
  readonly label: string;
  readonly side: Side;
  aggression: Aggression;
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
  readonly halfHeight: number;
  readonly hologram: boolean;
  hp: number;
  readonly maxHp: number;
  readonly blow: number;
  dead = false;
  deadTimer = 0;
  grounded = true;
  state: MobileState = 'loading';
  ragdoll: Ragdoll | null = null;
  inside: boolean;
  /** The building room it is in (the manager follows it through the portals), 0 outside. */
  room = 0;
  heading: number;
  /** Where it came from: the leash is measured from here. */
  homeX: number;
  homeZ: number;
  /** The model's meshes, whose shadow flag the manager sets. */
  meshes: THREE.Mesh[] = [];
  model: THREE.Object3D | null = null;
  animator: MobileAnimator | null = null;
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
  /** What the body moves at: what the chosen gait's feet show. */
  private speed = 0;
  /** The acceleration's own progress toward the pace, from which the gait is chosen (never overwritten by the gait). */
  private ramp = 0;
  private readonly gaitOut: GaitStep = { clip: null, timeScale: 1, speed: 0, ramp: 0 };
  /** Where a chase faces this frame, kept rather than made anew. */
  private readonly faceAt = { x: 0, z: 0 };
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
  private shotsLeft = 0;
  private nextShotAt = 0;
  private thinkAt = 0;
  private melee = false;
  private rangedRange = 0;
  private canSwim = false;
  private swimming = false;
  private flyer: boolean;
  private muzzle: THREE.Object3D | null = null;
  /** The weapon in the hand, when it holds one off the rack; its bolt when it is a gun. */
  weapon: string | null = null;
  private gun: GunProfile | null = null;
  private holder: THREE.Group | null = null;
  private blade: SaberBlade | null = null;
  private hiltTop = 0.13;
  private readonly bladeBase = new THREE.Vector3();
  private readonly bladeTip = new THREE.Vector3();
  private readonly restPose = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }>();
  private readonly memory = new Map<number, Grudge>();
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
    this.hologram = (e.flags ?? []).includes('hologram');
    this.flyer = this.plan.hover > 0;
    this.label = e.name;
    this.side = sideOf(e);
    this.aggression = this.hologram ? 'passive' : (spawn.overrides?.aggression ?? e.stats?.aggression ?? 'defensive');
    this.maxHp = spawn.overrides?.hp ?? e.stats?.hp ?? 80;
    this.hp = this.maxHp;
    this.blow = spawn.overrides?.damage ?? e.stats?.damage ?? 8;
    this.heading = spawn.heading;
    this.homeX = spawn.x;
    this.homeZ = spawn.z;
    this.inside = spawn.inside;

    const feet = this.plan.feet;
    tmpQ.setFromAxisAngle(UP, this.heading);
    const w = deps.physics.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y + feet + 0.05, spawn.z)
        .setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w })
        .lockRotations()
        .setLinearDamping(0.6)
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

  /**
   * Hang the model on the body: a clone of the prepared prototype, its rest pose saved before
   * anything plays (a pack clip may carry no track for a joint that never leaves it), the idle
   * playing. Refused, leaving the group empty, when the mobile died or was taken away while its
   * model loaded; the caller then releases what it acquired. Returns a warning when the pack's
   * tracks mostly bind to nothing in this skeleton.
   */
  attach(model: MobileBody, pack: PackAsset | null, extras?: MobileExtras): { ok: boolean; warning: string | null } {
    if (this.disposed || this.dead) return { ok: false, warning: null };
    const scene = cloneSkeleton(model.scene);
    const names = new Set<string>();
    scene.traverse((o) => {
      names.add(o.name);
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        this.meshes.push(m);
        // Culled as a whole by the manager, never mesh by mesh (a mesh's own sphere would be in its own frame).
        m.frustumCulled = false;
      }
      if ((o as THREE.Bone).isBone) this.restPose.set(o, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });
    });
    markActor(scene);
    this.inner.add(scene);
    this.model = scene;
    let warning: string | null = null;
    if (pack) {
      this.roles = rolesFor(pack.json, this.entry.gender);
      // A rifle's carry, a Jedi's swings: laid over the pack's roles, with any clips they name.
      if (extras?.roles) Object.assign(this.roles, extras.roles);
      const clips = extras?.clips?.size ? new Map([...pack.clips, ...extras.clips]) : pack.clips;
      this.animator = new MobileAnimator(scene, clips, pack.additive);
      const probe = pack.clips.get(this.roles.idle ?? '') ?? pack.clips.values().next().value;
      if (probe && probe.tracks.length) {
        let unbound = 0;
        for (const t of probe.tracks) if (!names.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName ?? '')) unbound++;
        if (unbound > probe.tracks.length / 10) warning = `pack ${pack.id} does not fit model ${model.key}: ${unbound} of ${probe.tracks.length} tracks bind to nothing`;
      }
      const r = this.roles;
      this.speeds = moveSpeeds(r, this.scale, this.entry.move);
      this.melee = (this.flyer && r.hoverAttacks.length ? r.hoverAttacks : r.attacks).length > 0;
      // Only what the catalogue gives a ranged attack shoots: a pack with a ranged clip is not enough.
      const ranged = this.entry.stats?.ranged;
      this.rangedRange = r.ranged && !this.hologram && ranged && ranged.range > 0 ? ranged.range * Math.max(1, Math.sqrt(this.scale)) : 0;
      this.canSwim = !!(r.swim || r.swimIdle);
      if (this.entry.flags?.includes('static')) this.speeds = { walk: 0, run: 0 };
      // Nothing to strike or shoot with: passive, whatever the keywords say.
      if (!this.melee && !this.rangedRange) this.aggression = 'passive';
    } else this.aggression = 'passive';
    for (const re of MUZZLE_BONES) {
      scene.traverse((o) => {
        if (!this.muzzle && (o as THREE.Bone).isBone && re.test(o.name)) this.muzzle = o;
      });
      if (this.muzzle) break;
    }
    this.state = 'idle';
    this.animator?.loop(this.idleNow(), 1, 0);
    return { ok: true, warning };
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
    b.update(dt, this.bladeBase, this.bladeTip, on, camera ?? IDLE_CAMERA, this.swingAt > 0 ? 1 : this.speed > 0.5 ? 0.3 : 0, this.dead);
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

  /** Whether it is in a one-shot, dying, or attacking: the tiers never freeze it. */
  get busy(): boolean {
    return this.dead || !!this.animator?.busy || this.swingAt > 0 || this.shotsLeft > 0 || this.state === 'attack';
  }

  private remember(source: Living, amount: number): void {
    if (this.aggression === 'passive' || source.key === this.key) return;
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
    // Allies do not hurt each other: a shot or a swing from its own side, from one that would never
    // pick a fight with it, passes it by. Without this a pack firing at the player through its own
    // ring turned on itself and feuded for the rest of the fight.
    if (source && source.key !== this.key && source.side === this.side && !hostileSides(source, this)) return;
    if (source && source.key !== this.key) {
      this.remember(source, amount);
      this.deps.alert(this, source);
    }
    this.hp -= amount;
    if (this.hp <= 0) {
      this.die();
      return;
    }
    // A flinch, shorter the bigger it is: a repeater must not pin a krayt dragon in place.
    this.stunned = Math.max(this.stunned, 0.15 * Math.min(1, this.plan.knockResist));
    // A hit reaction, now and then, never over an attack, and none for a hologram.
    if (this.animator && !this.hologram && this.hitCd <= 0 && this.animator.shotLevel < SHOT_PRIORITY.attack && !this.downPhase) {
      const r = this.roles!;
      const share = amount / this.maxHp;
      const clip = this.entry.kind === 'creature' && share > 0.2 && r.hitHeavy ? r.hitHeavy : share < 0.08 ? (r.hitLight ?? r.hitMedium) : (r.hitMedium ?? r.hitLight);
      if (this.animator.once(clip, { priority: SHOT_PRIORITY.hit, fadeIn: 0.06, fadeOut: 0.2 }) !== null) this.hitCd = HIT_EVERY;
    }
    if (from && push > 0) {
      tmp.copy(this.pos).sub(from).setY(0);
      if (tmp.lengthSq() > 1e-8) this.knock(tmp.normalize(), push);
    }
  }

  knock(dir: THREE.Vector3, power: number): void {
    if (this.dead || this.disposed) return;
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
    if (lift > 1) this.grounded = false;
    if (k >= KNOCKDOWN_AT && this.roles?.knockdown && this.animator && !this.downPhase) {
      const d = this.animator.once(this.roles.knockdown, { hold: true, priority: SHOT_PRIORITY.down, onEnd: () => this.lieDown() });
      if (d !== null) {
        this.downPhase = 'fall';
        this.state = 'knockdown';
        this.swingAt = 0;
        this.shotsLeft = 0;
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
  }

  holdAt(point: THREE.Vector3, dt: number): void {
    if (this.dead || this.disposed || !this.plan.canHold) return;
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

  afflict(dps: number, seconds: number): void {
    if (this.dead) return;
    if (dps * seconds >= this.dotDps * this.dotLeft) {
      this.dotDps = dps;
      this.dotLeft = seconds;
    }
  }

  stun(seconds: number): void {
    if (this.dead) return;
    this.stunned = Math.max(this.stunned, seconds);
  }

  slow(seconds: number): void {
    if (this.dead) return;
    this.slowed = Math.max(this.slowed, seconds);
  }

  private die(): void {
    this.dead = true;
    this.hp = 0;
    this.state = 'dying';
    this.deadTimer = DEAD_FOR;
    this.swingAt = 0;
    this.shotsLeft = 0;
    this.downPhase = null;
    this.targetRef = null;
    const v = this.body.linvel();
    this.body.setLinvel({ x: 0, y: this.flyer ? Math.min(0, v.y) : v.y, z: 0 }, true);
    // A flyer falls out of the air; a swimmer stays afloat.
    if (!this.swimming) this.body.setGravityScale(1, true);
    if (this.hologram) {
      this.fading = HOLOGRAM_FADE;
      this.deadTimer = HOLOGRAM_FADE + 0.05;
      return;
    }
    if (!this.model) return;
    const r = this.roles;
    const clip = r ? (this.swimming ? (r.swimDown ?? r.down) : this.flyer ? (r.hoverDown ?? r.down) : r.down) ?? r.hitHeavy : null;
    const d = this.animator?.once(clip, { hold: true, priority: SHOT_PRIORITY.down, fadeIn: 0.08, onEnd: () => this.deps.wantRagdoll(this) }) ?? null;
    if (d === null) this.deps.wantRagdoll(this);
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
  }

  private endRagdoll(): void {
    if (!this.ragdoll) return;
    this.ragdoll.dispose();
    this.ragdoll = null;
  }

  /** Where a shot leaves from: a muzzle bone, else the head, else the middle of its front. */
  private muzzlePoint(out: THREE.Vector3): THREE.Vector3 {
    if (this.muzzle) return this.muzzle.getWorldPosition(out);
    out.set(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(this.plan.along * 0.9);
    return out.add(this.pos).setY(this.pos.y + this.halfHeight * 1.3);
  }

  /** Whether a shot from here would reach a target's middle: a ray against what stands still. */
  private lineTo(t: Living): boolean {
    this.muzzlePoint(tmp);
    tmp2.set(t.pos.x, t.pos.y + t.halfHeight, t.pos.z).sub(tmp);
    const len = tmp2.length();
    if (len < 0.5) return true;
    tmp2.divideScalar(len);
    const ray = new RAPIER.Ray({ x: tmp.x, y: tmp.y, z: tmp.z }, { x: tmp2.x, y: tmp2.y, z: tmp2.z });
    const hit = this.deps.physics.world.castRay(ray, len - 0.3, true, undefined, this.inside ? INSIDE : OUTSIDE, undefined, this.body, (c) => {
      const b = c.parent();
      return !b || b.isFixed();
    });
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
      this.deps.bolts.fire(from, dir, { owner: 'enemy', damage: this.blow, metresPerSecond: SPIT.speed, color, size: SPIT.size * Math.max(0.6, Math.min(2, Math.sqrt(this.scale * this.plan.height / 2))), gravity: SPIT.gravity, push: 1, exclude: this.body, source: this, onHit: (_p, hit) => hit?.afflict?.(burn, SPIT.burnFor) });
    } else {
      // The gun in its hand when it holds one off the rack; else a droid's or a person's own: the
      // pistol's bolt for the one-frame pistol shots, the rifle's otherwise.
      // (A beam or a flame has no bolt to fire: its holder shoots the rifle's.)
      const held = this.gun && this.gun.primary.speed > 0 ? this.gun : null;
      const g = (held ?? (this.roles?.rangedAdditive && /pistol/i.test(this.roles.ranged ?? '') ? GUNS.bryar : GUNS.blaster)).primary;
      color = g.color;
      this.deps.bolts.fire(from, dir, { owner: 'enemy', damage: this.blow, speed: g.speed, color, size: g.size, push: g.push, exclude: this.body, source: this });
    }
    // The flash is a pooled light shared by everything; only a near shot may borrow one.
    if (this.tier?.name === 'near' && cameraDist < LOD_TUNE.near) this.deps.effects()?.flash(from, color, 5, 6, 0.06);
    const r = this.roles;
    if (r?.ranged && r.rangedAdditive) this.animator?.pulse(r.ranged, 0.06, 0.12);
  }

  /** The set of roles in use now: swimming, hovering, fighting, or plain. */
  private gaitsNow(): readonly Gait[] {
    const r = this.roles;
    if (!r) return [];
    if (this.swimming && r.gaitsSwim.length) return r.gaitsSwim;
    if (this.flyer && r.gaitsHover.length) return r.gaitsHover;
    if (this.fighting() && r.gaitsCombat.length) return r.gaitsCombat;
    return r.gaits;
  }

  private idleNow(): string | null {
    const r = this.roles;
    if (!r) return null;
    if (this.swimming && r.swimIdle) return r.swimIdle;
    if (this.flyer && r.hoverIdle) return r.hoverIdle;
    if (this.decision?.attack === 'ranged' && r.rangedAdditive && r.rangedStance) return r.rangedStance;
    if (this.fighting() && r.idleCombat) return r.idleCombat;
    return r.idle;
  }

  private fighting(): boolean {
    return this.targetKey !== null && (this.state === 'chase' || this.state === 'attack' || this.state === 'alert');
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
    // 2. The body's place, and the heading it is held at.
    const t = this.body.translation();
    this.pos.set(t.x, t.y - this.plan.feet, t.z);
    this.group.position.set(t.x, t.y, t.z);
    tmpQ.setFromAxisAngle(UP, this.heading);
    this.group.quaternion.copy(tmpQ);
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
    // 7. Timers.
    this.stunned = Math.max(0, this.stunned - sdt);
    this.attackCd -= sdt;
    this.rangedCd -= sdt;
    this.hitCd -= sdt;
    if (this.downPhase === 'lie' && this.now >= this.downUntil) this.getUp();
    // 8. The ground: every frame near, every fourth frame farther out.
    if (tier.name === 'near' || (this.frame + this.key) % 4 === 0) this.checkGround(t);
    // 9. Think.
    if (this.now >= this.thinkAt && !this.downPhase) {
      this.think(ctx);
      this.thinkAt = this.now + tier.think * (0.85 + Math.random() * 0.3);
    }
    // 10. Act, 11. hold its height, 12. animate.
    if (this.state === 'return') this.hp = Math.min(this.maxHp, this.hp + (this.maxHp / 3) * sdt);
    this.act(sdt, ctx, tier);
    this.holdHeight(t);
    this.animate(sdt, tier);
    this.updateBlade(dt, ctx.camera);
  }

  private checkGround(t: { x: number; y: number; z: number }): void {
    const terrain = this.deps.terrain;
    const filter = this.inside ? INSIDE : undefined;
    const gd = this.deps.physics.groundDistance(t.x, t.y, t.z, this.plan.feet + 0.4, this.body, filter);
    this.grounded = gd !== null || (!this.inside && this.pos.y <= terrain.heightAt(this.pos.x, this.pos.z) + 0.25);
    if (this.inside) {
      this.swimming = false;
      return;
    }
    const surface = terrain.waterHeightAt(this.pos.x, this.pos.z);
    const ground = terrain.heightAt(this.pos.x, this.pos.z);
    const deep = surface - ground > (this.entry.size?.swimHeight ?? 1) * this.scale;
    const swimming = this.canSwim && deep && this.pos.y < surface;
    if (swimming !== this.swimming) {
      this.swimming = swimming;
      this.body.setGravityScale(swimming || (this.flyer && !this.dead) ? 0 : 1, true);
    }
  }

  private think(ctx: MobileContext): void {
    const now = this.now;
    if (this.wanderAt < 0) this.wanderAt = now + 1 + Math.random() * 4;
    // Grudges past the memory are dropped.
    for (const [k, g] of this.memory) if (now - g.at > BRAIN_TUNE.memory || g.who.dead) this.memory.delete(k);
    const list = this.brainTargets;
    list.length = 0;
    let current: Living | null = null;
    const reachOut = Math.max(BRAIN_TUNE.aggroBig, BRAIN_TUNE.leash) + 30;
    for (const t of ctx.targets) {
      if (t === (this as Living) || t.key === this.key) continue;
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
      big: this.entry.stats?.sizeClass === 'large' || this.entry.stats?.sizeClass === 'huge',
      reach: (this.entry.stats?.reach ?? 1.5) * this.scale,
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
    };
    const d = decide(self, list);
    if (d.clearMemory) this.memory.clear();
    if (d.targetKey !== this.targetKey) {
      this.stuck = 0;
      this.stuckClock = 0;
    }
    this.targetKey = d.targetKey;
    this.targetRef = d.targetKey === null ? null : d.targetKey === current?.key ? current : (ctx.targets.find((t) => t.key === d.targetKey) ?? null);
    this.wanderAt = d.wanderAt;
    this.goal = d.goal;
    this.until = d.until;
    this.blockedSince = d.blockedSince;
    this.forgetKey = d.forgetKey;
    this.forgetUntil = d.forgetUntil;
    if (d.state === 'return' && this.state !== 'return') this.goal = null;
    this.state = d.state;
    this.decision = d;
    // Water it cannot swim in, just ahead: a wander turns elsewhere, a chase stops at the edge.
    this.waterAhead = false;
    if (!this.canSwim && !this.flyer && !this.inside && d.pace !== 'stand') {
      const ahead = Math.max(1, this.speed * 0.5);
      const nx = this.pos.x + Math.sin(this.heading) * ahead;
      const nz = this.pos.z + Math.cos(this.heading) * ahead;
      const terrain = this.deps.terrain;
      if (terrain.waterHeightAt(nx, nz) - terrain.heightAt(nx, nz) > (this.entry.size?.swimHeight ?? 1) * this.scale * 0.8) {
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

  private act(dt: number, ctx: MobileContext, tier: LodTier): void {
    const move = this.entry.move;
    const d = this.decision;
    const t = this.targetRef;
    if (t && (t.dead || (t as { removed?: boolean }).removed)) this.targetRef = null;
    // The target moves between thoughts: the chase and the aim follow it every frame.
    let moveTo = d?.moveTo ?? null;
    let face = d?.face ?? null;
    let pace = d?.pace ?? 'stand';
    const target = this.targetRef;
    if (target && d && (d.state === 'chase' || d.state === 'attack' || d.state === 'alert')) {
      face = this.faceAt;
      face.x = target.pos.x;
      face.z = target.pos.z;
      if (d.state === 'chase') {
        moveTo = face;
        // Close enough to strike: stop rather than run on until the next thought.
        const gap = Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z) - target.radiusToward(this.pos) - this.radiusToward(target.pos);
        if (this.melee && gap <= (this.entry.stats?.reach ?? 1.5) * this.scale * 0.8) pace = 'stand';
      }
    }
    if (this.waterAhead && pace !== 'stand') pace = 'stand';
    if (!tier.move || this.stunned > 0 || this.downPhase) pace = 'stand';
    if (!tier.move) {
      this.body.setLinvel({ x: 0, y: this.body.linvel().y, z: 0 }, false);
      // Only a body standing on something sleeps: one put to sleep in the air hangs there for good.
      if (this.grounded && !this.body.isSleeping()) this.body.sleep();
    }
    let wanted = pace === 'run' ? this.speeds.run : pace === 'walk' ? this.speeds.walk : 0;
    if (moveTo && pace !== 'stand' && Math.hypot(moveTo.x - this.pos.x, moveTo.z - this.pos.z) < 0.5) wanted = 0;
    // Face the move point, or the target while attacking.
    if (face && !this.downPhase && this.stunned <= 0) {
      let want = Math.atan2(face.x - this.pos.x, face.z - this.pos.z);
      if (this.now < this.sidestepUntil && pace !== 'stand') want += this.sidestep;
      const rate = THREE.MathUtils.degToRad(wanted > this.speeds.walk + 1e-3 ? move.turnRun : move.turnWalk) || Math.PI;
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const turn = rate * dt;
      this.heading += clamp(diff, -turn, turn);
    }
    // Speed: the template's acceleration toward the pace, then the gait that matches what it ends up doing.
    const accel = (wanted > this.speeds.walk + 1e-3 ? move.accel?.[0] : move.accel?.[1]) ?? 4;
    // The ramp keeps its own progress (a clamped walk must never hold it off the run), the body goes
    // at what the chosen gait's feet show, and below `still` the ramp stands it (stepGait, gait.ts).
    const gait = stepGait(this.ramp, wanted, accel, dt, this.gaitsNow(), this.idleNow(), this.scale, undefined, this.gaitOut);
    this.ramp = gait.ramp;
    this.speed = gait.speed;
    const moving = this.speed > 0.05 && (this.grounded || this.flyer || this.swimming) && this.stunned <= 0 && !this.downPhase && tier.move;
    if (moving) {
      const vy = this.body.linvel().y;
      this.body.setLinvel({ x: Math.sin(this.heading) * this.speed, y: vy, z: Math.cos(this.heading) * this.speed }, true);
    } else if (this.grounded && tier.move) {
      // Braking: a fifth off per sixtieth of a second, whatever the frame rate.
      const v = this.body.linvel();
      const brake = Math.pow(0.8, dt * 60);
      this.body.setLinvel({ x: v.x * brake, y: v.y, z: v.z * brake }, true);
    }
    if (tier.move) {
      tmpQ.setFromAxisAngle(UP, this.heading);
      this.body.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }, moving);
    }
    if (!this.downPhase) this.animator?.loop(gait.clip ?? this.idleNow(), gait.timeScale);
    this.checkStuck(dt, moving ? this.speed : 0);
    this.fight(ctx, d);
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
    if (!roles || !animator || this.downPhase || this.stunned > 0.3) return;
    const cameraDist = ctx.camera ? ctx.camera.position.distanceTo(this.pos) : Infinity;
    const cooldown = this.entry.stats?.attackCooldown ?? 1.6;
    // A blow under way lands part way into its swing, if the target is still in reach.
    if (this.swingAt > 0 && this.now >= this.swingAt) {
      this.swingAt = 0;
      const t = this.swingKey !== null && target && target.key === this.swingKey ? target : null;
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
    if (!target || !d || d.state !== 'attack') return;
    if (d.attack === 'melee' && this.attackCd <= 0 && this.swingAt === 0 && animator.shotLevel < SHOT_PRIORITY.attack) {
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
        // A whole-body shot: the bolt leaves part way into the clip.
        const length = animator.once(roles.ranged, { priority: SHOT_PRIORITY.attack, fadeIn: 0.08, fadeOut: 0.2 });
        this.shotsLeft = 1;
        this.nextShotAt = this.now + Math.min(0.5, 0.4 * (length ?? 0.5));
      } else {
        this.shotsLeft = beast ? 1 : 1 + Math.floor(Math.random() * 3);
        this.nextShotAt = this.now;
      }
    }
  }

  /** A flyer holds its cruising height over the ground; a swimmer floats. */
  private holdHeight(t: { x: number; y: number; z: number }): void {
    if (this.dead || this.heldUntil > this.now) return;
    let wantY: number | null = null;
    if (this.swimming) {
      wantY = this.deps.terrain.waterHeightAt(this.pos.x, this.pos.z) - this.plan.swimDepth + this.plan.feet;
    } else if (this.flyer) {
      const ground = this.deps.groundAt(this.pos.x, t.y, this.pos.z, this.inside) ?? this.deps.terrain.heightAt(this.pos.x, this.pos.z);
      wantY = ground + this.plan.hover + this.plan.feet;
      if (this.body.gravityScale() !== 0) this.body.setGravityScale(0, true);
    }
    if (wantY === null) return;
    const v = this.body.linvel();
    const vy = clamp((wantY - t.y) * 2.5 - v.y * 0.3, -6, 6);
    this.body.setLinvel({ x: v.x, y: vy, z: v.z }, true);
  }

  /** The mixer at the tier's rate; its time kept, so a thinned mobile's clips run at the right speed. */
  private animate(dt: number, tier: LodTier): void {
    const a = this.animator;
    if (!a) return;
    this.animAcc = Math.min(2, this.animAcc + dt);
    const every = tier.animEvery;
    if (every <= 0) return;
    if (every > 1 && (this.frame + this.key) % every !== 0) return;
    a.update(this.animAcc);
    this.animAcc = 0;
  }

  /**
   * Outdoors, a body found well under the terrain is put back on top of it. The ground can change
   * under a mobile: the planet's own heights arrive after the arrival spawn (the wildlife is stood
   * on the stand-in terrain behind the loading screen), and past the physics' reach there is no
   * heightfield to stand on. Returns whether it moved it.
   */
  liftToGround(): boolean {
    if (this.dead || this.disposed || this.inside || this.ragdoll || this.swimming || this.heldUntil > this.now) return false;
    const ground = this.deps.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y > ground - 1) return false;
    const t = this.body.translation();
    this.body.setTranslation({ x: t.x, y: ground + this.plan.feet + 0.05 + (this.flyer ? this.plan.hover : 0), z: t.z }, true);
    const v = this.body.linvel();
    this.body.setLinvel({ x: v.x, y: 0, z: v.z }, true);
    this.pos.y = ground;
    this.grounded = true;
    return true;
  }

  /** A fresh life at a new spot: everything a body can carry is cleared, the bones put back to rest. */
  respawn(x: number, y: number, z: number): void {
    if (this.disposed) return;
    this.key = nextLivingKey();
    this.endRagdoll();
    for (const [bone, r] of this.restPose) {
      bone.position.copy(r.p);
      bone.quaternion.copy(r.q);
      bone.scale.copy(r.s);
    }
    this.dead = false;
    this.deadTimer = 0;
    this.hp = this.maxHp;
    this.dotDps = 0;
    this.dotLeft = 0;
    this.slowed = 0;
    this.heldUntil = 0;
    this.stunned = 0;
    this.attackCd = 0;
    this.rangedCd = 0;
    this.hitCd = 0;
    this.swingAt = 0;
    this.shotsLeft = 0;
    this.downPhase = null;
    this.memory.clear();
    this.targetKey = null;
    this.targetRef = null;
    this.decision = null;
    this.goal = null;
    this.until = 0;
    this.blockedSince = null;
    this.forgetKey = null;
    this.stuck = 0;
    this.stuckClock = 0;
    this.wanderAt = -1;
    this.thinkAt = 0;
    this.speed = 0;
    this.ramp = 0;
    this.swimming = false;
    this.fading = 0;
    this.queued = false;
    this.grounded = true;
    this.inner.scale.setScalar(this.scale);
    this.homeX = x;
    this.homeZ = z;
    this.body.setEnabled(true);
    this.body.setGravityScale(this.flyer ? 0 : 1, true);
    this.body.setTranslation({ x, y: y + this.plan.feet + 0.05, z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    tmpQ.setFromAxisAngle(UP, this.heading);
    this.body.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }, true);
    this.pos.set(x, y, z);
    this.state = this.model ? 'idle' : 'loading';
    if (this.animator) {
      this.animator.reset();
      this.animator.loop(this.idleNow(), 1, 0);
    }
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
      maxHp: this.maxHp,
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
      shadow: this.meshes.some((m) => m.castShadow),
      visible: this.group.visible,
      inside: this.inside,
      room: this.room,
      swimming: this.swimming,
      ragdoll: this.ragdoll?.status ?? null,
      ranged: this.rangedRange ? Number(this.rangedRange.toFixed(0)) : 0,
      weapon: this.weapon,
      roles: r ? describeRoles(r) : null,
    };
  }

  /** Taken out of the world: the body, the skeletons' bone textures and the mixer go; the caller releases the assets and the collider handles. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dead = true;
    this.memory.clear();
    this.targetRef = null;
    this.endRagdoll();
    this.deps.physics.world.removeRigidBody(this.body);
    this.animator?.dispose();
    this.animator = null;
    if (this.blade) {
      this.blade.group.parent?.remove(this.blade.group);
      this.blade.dispose();
      this.blade = null;
    }
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
  }
}
