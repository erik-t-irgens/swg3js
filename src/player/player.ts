import * as THREE from 'three';
import type { ClassId } from '../combat/kit';
import type { ThirdPersonCamera } from '../core/camera';
import type { Input } from '../core/input';
import { Group, groups, RAPIER, type Physics } from '../core/physics';
import { markActor } from '../world/portalRender';
import type { Vehicle } from '../vehicles/vehicle';
import type { World } from '../world/world';
import { STANCE_ANIM, STYLE_DAMAGE, SaberCombat, type Dir, type SaberInput } from '../combat/saber';
import { SaberThrow, THROW } from '../combat/saberThrow';
import { canBlock, inFront, parryClip, parryZone, reflectDirection } from '../combat/deflect';
import { JKA, JkaMovement, UNIT, type MoveCommand } from './jkaMove';
import type { CharacterRig, RigState } from './rig';
import { FIGHTS, ONE_HANDED, gunKindOf, type WeaponClass, type WeaponDef } from './weapons';
import { STYLES, type SaberStyle } from '../combat/saber';

// The original game's run is 5.375 m/s; the character stands about 1.75 m.
const RUN_SPEED = 5.5;
/** The player's capsule: its radius and half the straight part, standing and crouched (1.6 m and 1.0 m tall). */
const CAPSULE_RADIUS = 0.35;
const STAND_HALF_HEIGHT = 0.45;
const CROUCH_HALF_HEIGHT = 0.15;
const WALK_SPEED = 2.0;
const JUMP_HEIGHT = 1.4;
/** Depth of the feet below the surface at which walking becomes swimming (the chest is under). */
const SWIM_DEPTH = 1.1;
/** Depth at which the head is under and looking down dives. */
const DIVE_DEPTH = 1.9;
/** Swimming speed as a fraction of running. */
const SWIM_SPEED = 0.45;
const dive = new THREE.Vector3();
const SWING_TIME = 0.45;

const fwd = new THREE.Vector3();
const rgt = new THREE.Vector3();
const move = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const armDir = new THREE.Vector3();
const aim = new THREE.Vector3();
const aimFrom = new THREE.Vector3();
const handPos = new THREE.Vector3();
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
  blade2: THREE.Mesh;
  bladeTip2: THREE.Object3D;
  saberLight: THREE.PointLight;
  rifle: THREE.Group;
  muzzle: THREE.Object3D;
}

/** The placeholder torso's look per class, made once (a material made per swap compiled its shader per swap). */
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const hiltGlow = new THREE.Vector3();
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

  // Lightsaber: blade runs along the arm, away from the hand.
  const saber = new THREE.Group();
  saber.position.set(0, -0.7, 0.05);
  saber.rotation.x = Math.PI;
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.26, 8), metal);
  const blade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 1.1, 8).translate(0, 0.68, 0),
    new THREE.MeshBasicMaterial({ color: 0x8fd6ff, toneMapped: false }),
  );
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.009, 0.009, 1.1, 6).translate(0, 0.68, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  );
  blade.add(core);
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
  saber2.add(hilt.clone(), blade2, bladeTip2);
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

  return { group, parts: { hips, torso, head, leftLeg, rightLeg, leftArm, rightArm, saber, blade, bladeTip, hilt, staffBlade, staffTip, saber2, blade2, bladeTip2, saberLight, rifle, muzzle } };
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
  heading = 0;
  speedMultiplier = 1;
  saberOn = false;
  classId: ClassId = 'jedi';
  hp = 100;
  readonly maxHp = 100;
  mounted: Vehicle | null = null;
  /** Swing progress in [0, 1], or -1 when idle (the stand-in swing when the rig has no saber clips). */
  swing = -1;
  /** Ground and air movement: the original game's numbers, or Jedi Academy's (see jkaMove.ts). */
  moveProfile: 'swg' | 'jka' = 'jka';
  readonly jka = new JkaMovement();
  /** The lightsaber move system (Jedi Academy's styles, swings and chains). */
  readonly saber = new SaberCombat();
  /** The Force pool the kit exposes, spent by force jumps. */
  force: { value: number } | null = null;
  /** Whether the rig carries Jedi Academy's clips (set when a rig attaches). */
  hasJkaClips = false;
  /** The saber's flight when thrown (right mouse). */
  readonly thrown = new SaberThrow();
  /** Saber defence rank (1..3): how well bolts are blocked and where they are sent (see deflect.ts). */
  saberDefense = 3;
  /** Holding the block (right mouse) with the saber lit: the stance is up and bolts are turned away. */
  blocking = false;
  /**
   * Jedi Academy's animations and camera facing are in charge: while blocking, swinging, throwing,
   * flipping or rolling. Otherwise the game's own clips play and the body turns the way it runs.
   */
  jkaMode = false;
  /** Which way the current jump was made, for its air and landing clips (PMF_BACKWARDS_JUMP and kin). */
  private jumpDir: Dir = 'F';
  /** The walk key is held: the walk clips rather than the runs, whatever the speed. */
  private walkKey = false;
  /** The blaster in hand: a pistol is carried at the side like a hilt, a rifle across the chest. */
  gunKind: 'pistol' | 'rifle' = 'rifle';
  /** The kind of blaster for the torso's turns: a carbine and a heavy weapon play the rifle's carries but may want their own angles. */
  gunClass: 'pistol' | 'carbine' | 'rifle' | 'heavy' = 'rifle';
  /** The weapons in hand from the rack (assets-private/weapons), and their models on the hand bones. */
  readonly equipped: { right: WeaponDef | null; left: WeaponDef | null } = { right: null, left: null };
  private readonly held: { right: THREE.Object3D | null; left: THREE.Object3D | null } = { right: null, left: null };
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
  /** The hip-fire pose chosen when the combat carry came up, kept while it lasts (a rifle's is a held transition into it). */
  private readyPose: string | null = null;
  readonly gripTune: { jkaRoll: number; stanceRoll: number; source: 'solved' | 'tags'; tilt: number; turn: number } = { jkaRoll: 0, stanceRoll: 0, source: 'solved', tilt: 0, turn: 0 };
  /** The hand bones the sabers hang from, for refitting the grip from the console. */
  private handBones: { right: THREE.Bone | null; left: THREE.Bone | null } = { right: null, left: null };
  /** Bolts turned away so far, for the console. */
  blocks = 0;
  private physics: Physics;
  /** The ship's room this player is in, with physics of its own; `pos` is then in the hull's frame. */
  aboard: import('../vehicles/interior').ShipInterior | null = null;
  /** The world's own body, collider and controller, kept while aboard a ship and taken back on leaving. */
  private worldBody: { physics: Physics; body: RAPIER.RigidBody; collider: RAPIER.Collider; controller: RAPIER.KinematicCharacterController } | null = null;
  private world: World | null = null;
  /** The thrown saber's own model, spinning through the air. */
  private readonly flying: THREE.Group;
  /** The dual kata's sabers, out of the hands and circling the body. */
  private readonly orbit: THREE.Group[] = [];

  /** Where the sabers out of the hand want light this frame: the thrown one, the orbiting two. */
  lightSpots(): { pos: THREE.Vector3; intensity: number; distance: number }[] {
    const out: { pos: THREE.Vector3; intensity: number; distance: number }[] = [];
    if (this.thrown.inFlight) out.push({ pos: this.flying.position, intensity: 4, distance: 6 });
    if (this.saberOn && !this.thrown.inFlight && !this.orbiting && this.classId === 'jedi' && !this.mounted) {
      this.parts.saber.getWorldPosition(hiltGlow);
      hiltGlow.y += 0.6;
      out.push({ pos: hiltGlow, intensity: 6, distance: 7 });
    }
    if (this.orbiting) for (const g of this.orbit) out.push({ pos: g.position, intensity: 3, distance: 5 });
    return out;
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
  private colliderCrouched = false;
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
    const blur = new THREE.Mesh(
      new THREE.CircleGeometry(1.2, 32),
      new THREE.MeshBasicMaterial({ color: 0x8fd6ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    blur.rotation.x = -Math.PI / 2;
    // No light of its own: every point light in the scene makes every shader longer (and on
    // some drivers seconds slower to compile), so the flying saber's glow comes from the pooled
    // flash lights, which the game feeds from lightSpots() each frame.
    this.flying.add(flyHilt, flyBlade, blur);
    this.flying.visible = false;
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
      scene.add(g);
      markActor(g);
      this.orbit.push(g);
    }
    this.cmd.probe = (dir, dist) => this.probeWall(dir, dist);
    this.cmd.groundDistance = (max) => this.groundDistanceUnits(max);
    this.cmd.floorAhead = (dist) => this.floorAhead(dist);

    const made = Player.makeBody(physics.world);
    this.body = made.body;
    this.collider = made.collider;
    this.controller = made.controller;
  }

  /** A kinematic capsule with its character controller, in a physics world: the player's in the world, or in a ship's room. */
  private static makeBody(world: RAPIER.World): { body: RAPIER.RigidBody; collider: RAPIER.Collider; controller: RAPIER.KinematicCharacterController } {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const collider = world.createCollider(RAPIER.ColliderDesc.capsule(STAND_HALF_HEIGHT, CAPSULE_RADIUS).setTranslation(0, CAPSULE_RADIUS + STAND_HALF_HEIGHT, 0), body);
    const controller = world.createCharacterController(0.04);
    controller.enableAutostep(0.5, 0.2, true);
    controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    controller.enableSnapToGround(0.35);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setCharacterMass(80);
    return { body, collider, controller };
  }

  /**
   * Step into a ship's room: the body moves to the room's own physics world, in the hull's
   * frame, and from here `pos` is in that frame; the figure is drawn wherever the hull puts it.
   */
  board(interior: import('../vehicles/interior').ShipInterior, local: THREE.Vector3): void {
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
  }

  /** Where the figure stands in the world: `pos` itself, or, aboard a ship, `pos` carried through the hull's transform. */
  get worldPos(): THREE.Vector3 {
    return this.aboard ? this.group.position : this.pos;
  }

  /** Put the figure where it is: in the world at `pos`, or, aboard, where the hull's transform carries `pos`. */
  placeVisual(): void {
    const room = this.aboard;
    if (room) {
      room.vehicle.group.updateMatrixWorld(true);
      this.group.position.copy(this.pos).applyMatrix4(room.vehicle.group.matrixWorld);
      this.group.quaternion.copy(room.vehicle.group.quaternion).multiply(tmpQ.setFromAxisAngle(UP_AXIS, this.heading));
    } else {
      this.group.position.copy(this.pos);
      this.group.rotation.set(0, this.heading, 0);
    }
  }

  /** Stand the player somewhere, keeping health and the rest as they are (stepping off a ship). */
  stand(p: THREE.Vector3): void {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.body.setEnabled(true);
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.placeVisual();
  }

  reset(p: THREE.Vector3): void {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.hp = this.maxHp;
    this.swing = -1;
    this.jka.reset();
    this.saber.holster();
    this.rig?.stopOverride(0);
    this.mounted = null;
    this.body.setEnabled(true);
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.group.position.copy(p);
  }

  /** Launch the player into the air (used by Force Jump). */
  launch(vy: number, forwardBoost: number, cam: ThirdPersonCamera): void {
    this.vel.y = vy;
    cam.forward(fwd);
    this.vel.x += fwd.x * forwardBoost;
    this.vel.z += fwd.z * forwardBoost;
    this.grounded = false;
    this.pos.y += 0.05;
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
    this.group.updateMatrixWorld(true);
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
    this.noclip = !this.noclip;
    this.vel.set(0, 0, 0);
    this.body.setEnabled(!this.noclip);
    if (!this.noclip) {
      this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
      this.grounded = false;
    }
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

  /** Which blades show: the main one, the staff's second, the dual style's left-hand saber; none while thrown. */
  private updateBlades(): void {
    const p = this.parts;
    const rightWeapon = this.equipped.right;
    const leftWeapon = this.equipped.left;
    // A weapon from the rack in a hand hides the placeholder there; a lightsaber from the rack keeps the blade, on its own hilt.
    const meleeRight = !!rightWeapon && FIGHTS[rightWeapon.class] !== 'gun' && rightWeapon.class !== 'lightsaber';
    const gunRight = !!rightWeapon && FIGHTS[rightWeapon.class] === 'gun';
    const on = this.saberOn && this.classId === 'jedi' && !meleeRight;
    const inHand = !this.thrown.inFlight && !this.orbiting;
    p.saber.visible = this.classId === 'jedi' && !meleeRight;
    p.hilt.visible = inHand && rightWeapon?.class !== 'lightsaber';
    p.blade.visible = on && inHand;
    p.staffBlade.visible = on && inHand && this.saber.style === 'staff';
    p.saber2.visible = this.classId === 'jedi' && this.saber.style === 'dual' && !this.orbiting && !leftWeapon;
    p.blade2.visible = on && this.saber.style === 'dual' && !this.orbiting && !leftWeapon;
    p.rifle.visible = this.classId === 'bounty_hunter' && !gunRight;
    if (this.held.right) this.held.right.visible = inHand || gunRight;
    if (this.held.left) this.held.left.visible = !this.orbiting;
    for (const g of this.orbit) g.visible = this.orbiting;
    this.flying.visible = this.thrown.inFlight;
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
    if (i === 0 && right && this.equipped.right?.class !== 'lightsaber') {
      right.near.getWorldPosition(a);
      right.far.getWorldPosition(b);
      return;
    }
    if (i === 1 && this.saber.style === 'dual' && left) {
      left.near.getWorldPosition(a);
      left.far.getWorldPosition(b);
      return;
    }
    if (i === 1 && this.saber.style === 'staff' && right && this.equipped.right?.class !== 'lightsaber') {
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
    const to = this.prone ? 'prone' : this.kneeling ? 'kneeling' : this.crouching ? 'crouched' : 'standing';
    if (from === to) return;
    if ((from === 'crouched' || to === 'crouched') && (moving || this.jkaMode)) return;
    const names: string[] = [];
    const gun = this.classId === 'bounty_hunter' && this.hasGunClips && this.gunReady ? this.gunKind : null;
    if (gun && from !== 'crouched' && to !== 'crouched') {
      if (this.aiming) names.push(`trn_${gun}_combat_${from}_aimed_to_${gun}_combat_${to}_aimed`);
      names.push(`trn_${gun}_combat_${from}_to_${gun}_combat_${to}`);
    }
    names.push(`trn_${from}_to_${to}`);
    const clip = rig.firstOf(...names);
    if (clip) rig.play(clip, { fadeIn: 0.08 });
  }

  /**
   * Put a weapon from the rack in a hand: its model on the hand's hold point (the game's hardpoint,
   * which its meshes are made for), its class picking the carries, the style and the sweep. Returns
   * the class of kit the weapon wants (a blaster the bounty hunter's, a blade the jedi's).
   */
  equip(def: WeaponDef, model: THREE.Object3D, hand: 'right' | 'left' = 'right'): ClassId {
    if (hand === 'left' && !ONE_HANDED.has(def.class)) hand = 'right';
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
    const b = def.bounds;
    if (b) {
      const ext = [0, 1, 2].map((k) => b.max[k] - b.min[k]);
      const axis = ext.indexOf(Math.max(...ext));
      const towards = Math.abs(b.max[axis]) >= Math.abs(b.min[axis]) ? b.max[axis] : b.min[axis];
      far.position.setComponent(axis, towards);
    } else far.position.y = def.length;
    holder.add(near, far);
    this.held[hand] = holder;
    this.reach[hand] = { near, far };
    this.equipped[hand] = def;
    if (hand === 'right' && def.class === 'lightsaber') {
      // The rack's hilt hangs where the placeholder's does, so the blade comes out of it.
      holder.removeFromParent();
      this.parts.saber.add(holder);
      holder.scale.setScalar(1 / Math.max(this.parts.saber.getWorldScale(new THREE.Vector3()).x, 1e-6));
    }
    const fights = FIGHTS[def.class];
    if (fights === 'gun') {
      this.gunKind = gunKindOf(def.class);
      this.gunClass = def.class as 'pistol' | 'carbine' | 'rifle' | 'heavy';
    } else if (this.classId === 'jedi' && !this.saberOn) this.toggleSaber();
    this.settleStyle();
    this.updateBlades();
    return fights === 'gun' ? 'bounty_hunter' : 'jedi';
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
    this.held[hand] = null;
    this.reach[hand] = null;
    this.equipped[hand] = null;
    this.settleStyle();
    this.updateBlades();
  }

  /**
   * The saber styles the weapons in hand allow: a polearm fights as the staff, one blade in each hand as
   * the dual style, a single sword or knife with the three single-blade styles, a lightsaber or empty
   * hands with all five.
   */
  get allowedStyles(): SaberStyle[] {
    const r = this.equipped.right;
    const l = this.equipped.left;
    if (r && FIGHTS[r.class] === 'gun') return STYLES;
    if (r?.class === 'polearm') return ['staff'];
    if (r && ONE_HANDED.has(r.class) && l && ONE_HANDED.has(l.class)) return ['dual'];
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
    return this.aiming || this.sinceShot < GUN_READY_SECONDS;
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
    let shots = rig.clipsMatching(new RegExp(`^${kind}_(combat_)?${posture}(_aimed)?_fire_\\d+$`));
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

  /** Whether a creature or turret stands within `radius` metres of the body in a direction relative to its facing. */
  private enemyNear(dir: 'F' | 'B' | 'L' | 'R', radius: number): boolean {
    const creatures = [...(this.world?.creatures.creatures ?? []), ...(this.world?.turrets.turrets ?? [])];
    const sx = Math.sin(this.heading);
    const sz = Math.cos(this.heading);
    // Forward is (sin, cos) of the heading; right is turned a quarter round.
    const dx = dir === 'F' ? sx : dir === 'B' ? -sx : dir === 'R' ? sz : -sz;
    const dz = dir === 'F' ? sz : dir === 'B' ? -sz : dir === 'R' ? -sx : sx;
    for (const c of creatures) {
      if (c.dead) continue;
      const ox = c.pos.x - this.pos.x;
      const oz = c.pos.z - this.pos.z;
      const along = ox * dx + oz * dz;
      const across = Math.abs(ox * dz - oz * dx);
      if (along > 0 && along < radius + 0.5 && across < 0.8 && Math.abs(c.pos.y - this.pos.y) < 2) return true;
    }
    return false;
  }

  /** Damage of the current style's swing. */
  get saberDamage(): number {
    return STYLE_DAMAGE[this.saber.style];
  }

  startSwing(): boolean {
    if (this.swing >= 0) return false;
    this.swing = 0;
    return true;
  }

  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
    this.regenDelay = 5;
  }

  heal(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  bladeSegment(a: THREE.Vector3, b: THREE.Vector3): void {
    this.parts.saber.getWorldPosition(a);
    this.parts.bladeTip.getWorldPosition(b);
  }

  muzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.parts.muzzle.getWorldPosition(out);
  }

  mount(speeder: Vehicle): void {
    this.mounted = speeder;
    this.body.setEnabled(false);
    this.vel.set(0, 0, 0);
    this.swing = -1;
  }

  dismount(to: THREE.Vector3): void {
    this.mounted = null;
    this.pos.copy(to);
    this.vel.set(0, 0, 0);
    this.body.setEnabled(true);
    this.body.setTranslation({ x: to.x, y: to.y, z: to.z }, true);
    this.grounded = true;
  }

  /** Pin the model to the speeder seat. Call after the speeder has updated. */
  syncMount(): void {
    if (!this.mounted) return;
    this.mounted.group.updateMatrixWorld(true);
    this.mounted.seat.getWorldPosition(this.pos);
    this.mounted.quaternion(tmpQ);
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(tmpQ);
    this.heading = 2 * Math.atan2(tmpQ.y, tmpQ.w);
    this.group.updateMatrixWorld(true);
  }

  update(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {
    this.world = world;
    this.regenDelay = Math.max(0, this.regenDelay - dt);
    if (this.regenDelay <= 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 4 * dt);

    if (this.swing >= 0) {
      this.swing += dt / SWING_TIME;
      if (this.swing >= 1) this.swing = -1;
    }
    this.blocking = this.classId === 'jedi' && this.saberOn && input.held('block') && !this.mounted && !this.noclip;
    this.aiming = this.classId === 'bounty_hunter' && input.held('altAttack') && !this.mounted && !this.noclip && !this.swimming;
    this.sinceShot += dt;
    cam.aim = this.aiming;
    const fighting = this.swing >= 0 || this.saber.busy || this.thrown.inFlight || this.jka.inSpecialJump || this.jka.rolling;
    this.jkaMode = this.hasJkaClips && (this.blocking || fighting || !!this.rig?.overridingJka);

    if (this.mounted) {
      this.rig?.stopOverride();
      this.thrown.cancel();
      this.updateBlades();
      this.animateSeated();
      this.animateRig(dt, 0, false);
      return;
    }

    if (this.noclip) {
      this.rig?.stopOverride();
      this.saber.holster();
      this.thrown.cancel();
      this.updateBlades();
      this.flyUpdate(dt, input, cam);
      return;
    }

    const g = world.planet.gravity;
    const terrain = world.terrain;

    let mx = 0;
    let mz = 0;
    if (input.held('forward')) mz += 1;
    if (input.held('back')) mz -= 1;
    if (input.held('left')) mx -= 1;
    if (input.held('right')) mx += 1;

    // Aboard a ship the camera's frame is the hull's, so its directions are already the room's:
    // forward on the screen is forward in the room, whatever the hull is doing.
    cam.forward(fwd);
    cam.right(rgt);
    move.set(0, 0, 0).addScaledVector(fwd, mz).addScaledVector(rgt, mx);
    const moving = move.lengthSq() > 0;
    if (moving) move.normalize();

    const walking = input.held('walk');
    this.walkKey = walking;
    // Postures: Z toggles prone and V kneeling, on the ground; jumping, swimming or a saber swing brings the
    // body up, and a kneel also ends when you move or crouch. The game's own transitions play between them.
    const was = { prone: this.prone, kneel: this.kneeling, crouch: this.crouching };
    const onGround = !this.mounted && !this.noclip && !this.swimming;
    if (input.pressedAction('prone') && onGround) this.prone = !this.prone;
    if (input.pressedAction('kneel') && onGround) {
      this.kneeling = !this.kneeling;
      if (this.kneeling) this.prone = false;
    }
    if (this.prone) this.kneeling = false;
    // Getting up on the jump key is only that: the jump itself waits for the key to be let go and pressed again.
    if ((this.prone || this.kneeling) && input.pressedAction('jump')) this.jumpLatched = true;
    if (!input.held('jump')) this.jumpLatched = false;
    const wasProne = this.jumpLatched;
    const getsUp = this.swimming || input.pressedAction('jump') || (this.classId === 'jedi' && (input.pressedAction('attack') || input.pressedAction('block')));
    if (this.prone && getsUp) this.prone = false;
    if (this.kneeling && (getsUp || moving || input.held('crouch'))) this.kneeling = false;
    this.crouching = !this.swimming && !this.prone && !this.kneeling && input.held('crouch');
    this.setCrouchCollider((this.crouching || this.prone || this.kneeling) && this.grounded);
    if (this.grounded && !this.swimming) this.postureTransition(was, moving);
    let speed = (walking ? WALK_SPEED : RUN_SPEED) * this.speedMultiplier * (this.crouching && this.grounded ? 0.5 : 1);

    // Water: the surface here, and how deep the body sits in it. Swimming starts when the
    // chest is under; the head stays above the surface unless the player dives.
    const surface = this.aboard ? -1e9 : terrain.waterHeightAt(this.pos.x, this.pos.z);
    const depth = surface - this.pos.y;
    // Interiors can sit below a lake (the Gungan cities do) and are never water. Once
    // swimming, a little slack keeps the float line from flickering between states.
    this.swimming = !this.inside && depth > (this.swimming ? SWIM_DEPTH - 0.3 : SWIM_DEPTH);
    this.submerged = this.swimming && depth > DIVE_DEPTH;

    if (this.swimming) {
      // Swimming: slow, no gravity, free up and down; looking down while submerged dives.
      // (Untouched by the movement profile: the water keeps its own rules.)
      this.rig?.stopOverride();
      this.saber.holster();
      speed *= SWIM_SPEED;
      const k = 1 - Math.exp(-dt * 4);
      this.vel.x += (move.x * speed - this.vel.x) * k;
      this.vel.z += (move.z * speed - this.vel.z) * k;
      let vy = 0;
      if (input.held('jump')) vy = SWIM_SPEED * RUN_SPEED;
      else if (input.held('crouch')) vy = -SWIM_SPEED * RUN_SPEED;
      else if (moving) {
        // Under water the camera steers: swim where you look. At the surface only a steep
        // look downwards dives, so ordinary forward swimming keeps the head up.
        cam.camera.getWorldDirection(dive);
        vy = dive.y * speed * (mz >= 0 ? 1 : -1);
        if (!this.submerged && (vy > 0 || dive.y > -0.5)) vy = 0;
      } else if (!this.submerged) vy = 0;
      else vy = -0.3; // a slow sink when idle under water
      this.vel.y += (vy - this.vel.y) * (1 - Math.exp(-dt * 6));
      // Buoyancy: rising past the float line stops at it.
      if (this.vel.y > 0 && depth - this.vel.y * dt < SWIM_DEPTH) this.vel.y = Math.max(0, (depth - SWIM_DEPTH) / dt);
      this.grounded = false;
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
      c.walk = walking;
      c.crouch = this.crouching;
      c.roll = input.pressedAction('crouch') && moving && !this.saber.busy;
      c.jump = jump;
      c.jumpPressed = jumpPressed && !this.saber.busy;
      c.attack = input.held('attack');
      c.speedScale = this.speedMultiplier * this.paceScale(walking, mz, mx);
      const force = this.force;
      const ev = this.jka.step(dt, this.vel, this.pos, this.grounded, c, { value: force?.value ?? 100, spend: (n) => { if (force) force.value = Math.max(0, force.value - n); } });
      if (ev.jumped) {
        this.grounded = false;
        // The jump for the direction pushed (PM_JumpForDir); with the body turned the way it runs, that is always forward.
        this.jumpDir = this.jkaMode ? (mz > 0 ? 'F' : mz < 0 ? 'B' : mx > 0 ? 'R' : mx < 0 ? 'L' : 'F') : 'F';
        this.playOnce(this.jumpClip('JUMP', false), 0.05);
      }
      if (ev.special) {
        this.grounded = false;
        this.playOnce(ev.special, 0.05);
      }
      if (ev.flip) this.playOnce(`BOTH_FLIP_${ev.flip}`, 0.08);
      else if (ev.forceJumpStarted) this.playOnce(this.jumpClip('JUMP', true), 0.08);
      this.lockedHeading = ev.heading;
      if (ev.rolled) this.playOnce(`BOTH_ROLL_${ev.rolled}`, 0.05);
      if (this.jka.rolling) this.crouching = false;
      if (ev.landed !== null && ev.landed >= 2 && !ev.rolled && !this.saber.busy) this.playOnce(this.jumpClip('LAND', ev.forceLanded), 0.06);
      if (ev.damage > 0) this.takeDamage(ev.damage);
    } else if (this.grounded) {
      this.vel.x = move.x * speed;
      this.vel.z = move.z * speed;
      if (input.held('jump') && !this.prone && !wasProne) {
        this.vel.y = Math.sqrt(2 * g * JUMP_HEIGHT);
        this.grounded = false;
      }
    } else {
      const k = 1 - Math.exp(-dt * 2.5);
      this.vel.x += (move.x * speed - this.vel.x) * k;
      this.vel.z += (move.z * speed - this.vel.z) * k;
    }

    if (!this.swimming && this.moveProfile !== 'jka') this.vel.y -= g * dt;
    // Falling into deep water: the plunge slows quickly.
    if (depth > 0 && !this.swimming && this.vel.y < -4) this.vel.y += (-4 - this.vel.y) * (1 - Math.exp(-dt * 8));

    if (this.vel.y > 0.5 || this.swimming) this.controller.disableSnapToGround();
    else this.controller.enableSnapToGround(0.35);
    const filter = this.inside ? groups(Group.all, Group.all & ~(Group.terrain | Group.exterior)) : groups(Group.all, Group.all);
    this.controller.computeColliderMovement(this.collider, { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt }, undefined, filter);
    const mv = this.controller.computedMovement();
    this.pos.x += mv.x;
    this.pos.y += mv.y;
    this.pos.z += mv.z;
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.vel.y < 0) this.vel.y = 0;
    if (!wasGrounded && this.grounded && Math.abs(mv.y) < 1e-4 && this.vel.y > 0) this.grounded = false;

    const ground = this.aboard ? -1e9 : terrain.heightAt(this.pos.x, this.pos.z);
    if (!this.aboard && this.pos.y < terrain.floor) {
      this.pos.y = ground + 1;
      this.vel.set(0, 0, 0);
    }

    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });

    // Lightsaber: the first press draws it, then the direction keys pick the swing and holding
    // attack chains the next one; the rig plays the move's clip when it has it.
    if (this.classId === 'jedi') {
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
        this.thrown.throw(this.handPosition(handPos), aim);
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
        else if (this.rig?.has(play.anim)) this.rig.play(play.anim, { loop: play.loop, fadeIn: play.blend, timeScale: play.speed, hold: true });
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
    const faceCamera = (this.classId === 'bounty_hunter' && (this.gunReady || !this.hasGunClips)) || fighting || (!this.grounded && this.jkaMode) || cam.firstPerson;
    const camYaw = Math.atan2(fwd.x, fwd.z);
    let legsOffset = 0;
    if (this.lockedHeading) {
      this.heading = Math.atan2(this.lockedHeading.x, this.lockedHeading.z);
    } else if (cam.firstPerson) {
      // Seen from the eyes, the body turns with the view at once: a lag would show the shoulders
      // swinging round, and turning the view alone would look back down into the neck.
      this.heading = camYaw;
    } else if (faceCamera) {
      let diff = camYaw - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 16);
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
    // How far the torso turns back towards the camera after the legs' angle.
    this.torsoTwist = directional && this.grounded && !faceCamera && !this.lockedHeading ? Math.atan2(Math.sin(camYaw - this.heading), Math.cos(camYaw - this.heading)) : 0;

    this.moveAmount += ((moving ? Math.min(1, speed / RUN_SPEED) : 0) - this.moveAmount) * Math.min(1, dt * 10);
    this.phase += dt * speed * (moving ? 1.9 : 0);
    // The clips are scaled to the speed the body actually moves at, so the feet stay planted.
    this.groundSpeed = moving ? (this.moveProfile === 'jka' && !this.swimming ? Math.hypot(this.vel.x, this.vel.z) : speed) : 0;
    this.animate(dt);
    cam.camera.getWorldDirection(this.lookDir);
    this.animateRig(dt, this.groundSpeed, moving, mz, mx);

    this.placeVisual();
    this.group.updateMatrixWorld(true);
  }

  private animateRig(dt: number, speed: number, moving: boolean, mz = 0, mx = 0): void {
    const rig = this.rig;
    if (!rig) return;
    // The walk key picks the walk clips; the speed only sets how fast a clip plays.
    const running = !this.walkKey;
    const style = this.saber.style;
    const stance = STANCE_ANIM[style];
    // The saber run and walk are the staff's, the dual sabers' or the single saber's (the three single styles share them).
    rig.prefer('runSaber', style === 'staff' ? 'BOTH_RUN_STAFF' : style === 'dual' ? 'BOTH_RUN_DUAL' : 'BOTH_RUN2');
    rig.prefer('walkSaber', style === 'staff' ? 'BOTH_WALK_STAFF' : style === 'dual' ? 'BOTH_WALK_DUAL' : 'BOTH_WALK2');
    // The kind of blaster picks its carries: the pistol's stand at the side, the rifle's across the chest.
    const gun = this.gunKind;
    const armed = this.classId === 'bounty_hunter' && this.hasGunClips;
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
    if (this.mounted) rig.setState('seated');
    // Swimming with the block held: the stance on the torso and arms over the swimming legs.
    else if (this.swimming) rig.setState(moving || this.submerged ? 'swim' : 'float', speed, this.blocking && this.hasJkaClips ? stance : null);
    else if (!this.grounded) {
      rig.prefer('air', this.jumpClip('INAIR', this.jka.isForceJumping));
      rig.setState('air');
    }
    else if (this.prone) {
      // Lying down: a blaster has its own prone carries, else the game's crawl.
      if (armed) rig.setState(`${this.aiming ? 'gunProneAim' : this.gunReady ? 'gunProneReady' : 'gunProne'}${moving ? 'Move' : 'Idle'}` as RigState, speed);
      else rig.setState(moving ? 'proneMove' : 'prone', speed);
    } else if (this.kneeling) rig.setState('kneel', 0, gunUpper);
    else if (this.crouching) {
      // Crouched: the game's own loop_crouched clips unless Jedi Academy's animations are in charge.
      const swg = !this.jkaMode && !!rig.clipMatching(/^loop_crouched:speed1/);
      rig.prefer('crouch', swg ? /^loop_crouched:speed0/ : null);
      rig.prefer('crouchWalk', swg ? /^loop_crouched:speed1/ : null);
      rig.prefer('crouchWalkBack', swg ? /^loop_crouched:speed1/ : null);
      rig.setState(moving ? (this.directional && mz < 0 ? 'crouchWalkBack' : 'crouchWalk') : 'crouch', speed, gunUpper);
    }
    else if (moving && this.directional && mz < 0) {
      // Backing up with the legs facing forward: the back-pedal clip.
      rig.setState(running && rig.hasState('runBack') ? 'runBack' : rig.hasState('walkBack') ? 'walkBack' : 'runBack', speed);
    } else if (!moving && this.hasJkaClips && (this.blocking || this.thrown.inFlight)) {
      // Standing with the block held: the style's stance; the arm out while the saber flies.
      rig.prefer('stance', this.thrown.inFlight ? 'BOTH_SABERPULL' : stance);
      rig.setState('stance');
    } else if (armed) {
      // The blaster carries: relaxed, combat after a shot, or aimed (the combat legs under the held aimed pose); each with its idle, walk and run.
      const carry = this.aiming ? 'gunAim' : this.gunReady ? 'gunReady' : 'gun';
      rig.setState(`${carry}${!moving ? 'Idle' : running ? 'Run' : 'Walk'}` as RigState, speed, gunUpper);
    } else if (!moving) rig.setState('idle');
    // Moving with the block held: Jedi Academy's saber run and walk; otherwise the game's own, saber lit or not.
    else if (this.jkaMode) rig.setState(running ? 'runSaber' : 'walkSaber', speed);
    else rig.setState(running ? 'run' : 'walk', speed);
    rig.update(dt);
    this.group.updateMatrixWorld(true);
    // Always called: with no twist it puts the spine's clip pose back.
    // With a blaster up the torso also tilts to where the camera looks, so the barrel follows the crosshair.
    const gunUp = this.classId === 'bounty_hunter' && !this.prone && !this.swimming && !this.mounted && (this.aiming || this.gunReady);
    const wantedPitch = gunUp ? -Math.asin(THREE.MathUtils.clamp(this.lookDir.y, -1, 1)) : 0;
    this.torsoPitch += (wantedPitch - this.torsoPitch) * Math.min(1, dt * 10);
    // Aiming standing (not crouched, kneeling or prone) the torso also turns right by the tuned angle, since the
    // game's aimed poses point the arm off to the left of the body; the legs keep facing the camera.
    const tune = this.gunTune[this.gunClass];
    const low = this.crouching || this.kneeling;
    const wantedTwist = armedUp ? (this.aiming ? -(low ? tune.aimKneel : tune.aim) : this.gunReady ? -tune.ready : 0) * (Math.PI / 180) : 0;
    this.aimTwist += (wantedTwist - this.aimTwist) * Math.min(1, dt * 10);
    rig.twistTorso(rig.overridingJka ? 0 : this.torsoTwist + this.aimTwist, rig.overridingJka ? 0 : this.torsoPitch);
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
      rig.aimArm('right', armDir.set(-0.25, -0.15, 0.95).normalize());
      rig.aimArm('left', armDir.set(0.25, -0.15, 0.95).normalize());
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
  }

  /** Play a one-off clip on the rig when it has it (jumps, landings). */
  /** The capsule shrinks to the crouch height while ducking (its feet stay where they are). */
  private setCrouchCollider(crouched: boolean): void {
    if (crouched === this.colliderCrouched) return;
    this.colliderCrouched = crouched;
    const half = crouched ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    this.collider.setHalfHeight(half);
    this.collider.setTranslationWrtParent({ x: 0, y: CAPSULE_RADIUS + half, z: 0 });
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

  /** Fly the thrown saber, steer it where the camera looks, and take it back into the hand. */
  private updateThrown(dt: number, input: Input, cam: ThirdPersonCamera): void {
    if (!this.thrown.inFlight) return;
    this.handPosition(handPos);
    aimFrom.copy(this.pos).y += 1.5;
    cam.camera.getWorldDirection(aim);
    const result = this.thrown.update(dt, handPos, aimFrom, aim, input.held('saberThrow'), (a, b) => this.physics.cameraBlock(a, b, this.body, this.inside) !== null);
    if (result === 'caught') return;
    this.flying.position.copy(this.thrown.pos);
    this.flying.rotation.set(0, this.thrown.spin, 0);
  }

  private flyUpdate(dt: number, input: Input, cam: ThirdPersonCamera): void {
    cam.camera.getWorldDirection(fwd);
    cam.right(rgt);
    move.set(0, 0, 0);
    if (input.held('forward')) move.add(fwd);
    if (input.held('back')) move.sub(fwd);
    if (input.held('right')) move.add(rgt);
    if (input.held('left')) move.sub(rgt);
    if (input.held('jump')) move.y += 1;
    if (input.held('crouch')) move.y -= 1;
    const moving = move.lengthSq() > 0;
    if (moving) move.normalize();
    const speed = this.noclipSpeed * (input.held('walk') ? 3.5 : 1) * this.speedMultiplier;
    this.pos.addScaledVector(move, speed * dt);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.swimming = false;
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
