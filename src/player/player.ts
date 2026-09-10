import * as THREE from 'three';
import type { ClassId } from '../combat/kit';
import type { ThirdPersonCamera } from '../core/camera';
import type { Input } from '../core/input';
import { Group, groups, RAPIER, type Physics } from '../core/physics';
import { markActor } from '../world/portalRender';
import type { Speeder } from '../vehicles/speeder';
import type { World } from '../world/world';
import type { CharacterRig } from './rig';

// The original game's run is 5.375 m/s; the character stands about 1.75 m.
const RUN_SPEED = 5.5;
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
  saberLight: THREE.PointLight;
  rifle: THREE.Group;
  muzzle: THREE.Object3D;
  jetpack: THREE.Group;
  flames: THREE.Mesh[];
}

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
  saber.add(hilt, blade, bladeTip, saberLight);
  blade.visible = false;
  rightArm.add(saber);

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

  // Jetpack on the back with two flame cones.
  const jetpack = new THREE.Group();
  jetpack.position.set(0, 0.55, -0.3);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.46, 0.18), dark);
  jetpack.add(pack);
  const flames: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.5, 6).rotateX(Math.PI),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    flame.position.set(sx * 0.1, -0.45, 0);
    flame.visible = false;
    jetpack.add(flame);
    flames.push(flame);
  }
  jetpack.visible = false;
  hips.add(jetpack);

  return { group, parts: { hips, torso, head, leftLeg, rightLeg, leftArm, rightArm, saber, blade, bladeTip, saberLight, rifle, muzzle, jetpack, flames } };
}

export class Player {
  readonly group: THREE.Group;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
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
  mounted: Speeder | null = null;
  /** Swing progress in [0, 1], or -1 when idle. */
  swing = -1;
  jetThrust = false;
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
  private rig: CharacterRig | null = null;
  private groundSpeed = 0;

  constructor(scene: THREE.Scene, physics: Physics) {
    const { group, parts } = buildCharacter();
    this.group = group;
    this.parts = parts;
    scene.add(group);
    markActor(group);

    const world = physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.45, 0.35).setTranslation(0, 0.8, 0), this.body);
    this.controller = world.createCharacterController(0.04);
    this.controller.enableAutostep(0.5, 0.2, true);
    this.controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.controller.enableSnapToGround(0.35);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(80);
  }

  reset(p: THREE.Vector3): void {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.hp = this.maxHp;
    this.swing = -1;
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
    this.parts.rifle.visible = !jedi;
    this.parts.jetpack.visible = !jedi;
    if (!jedi && this.saberOn) this.toggleSaber();
    this.parts.saber.visible = jedi;
    this.parts.torso.material = new THREE.MeshStandardMaterial({ color: jedi ? 0xc9b58a : 0x5f6b6e, roughness: 0.8, metalness: jedi ? 0 : 0.3, flatShading: true });
    this.applyClassLook();
  }

  /** Swap the primitive body for a skinned rig; weapons move to its hand bones. */
  attachRig(rig: CharacterRig): void {
    this.rig = rig;
    this.parts.hips.visible = false;
    rig.root.scale.setScalar(rig.scale);
    this.group.add(rig.root);
    markActor(rig.root);
    this.group.updateMatrixWorld(true);
    const hand = rig.boneFor('rightHand');
    const fore = rig.boneFor('rightForeArm');
    const spine = rig.boneFor('spine');
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
      // A gripped hilt runs across the palm, pointing the way the character faces when the arms
      // hang at rest: the rig's forward axis taken into the hand's frame in the bind pose.
      const grip = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.root.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()).invert());
      if (grip.lengthSq() < 1e-6) grip.set(0, 0, 1);
      grip.normalize();
      // The saber's blade runs along its +Y, the rifle's barrel along its +Z.
      p.saber.position.copy(along).multiplyScalar(0.02 * k);
      p.saber.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), grip);
      p.saber.scale.setScalar(k);
      p.rifle.position.copy(along).multiplyScalar(0.1 * k);
      p.rifle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along);
      p.rifle.scale.setScalar(k);
    }
    if (spine) {
      const k = unitsPerMetre(spine);
      spine.add(p.jetpack);
      p.jetpack.position.set(0, 0.06, -0.14).multiplyScalar(k);
      p.jetpack.scale.setScalar(k);
    }
    this.applyClassLook();
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
    this.parts.blade.visible = this.saberOn;
    this.parts.saberLight.intensity = this.saberOn ? 6 : 0;
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

  mount(speeder: Speeder): void {
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
    this.regenDelay = Math.max(0, this.regenDelay - dt);
    if (this.regenDelay <= 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 4 * dt);

    if (this.swing >= 0) {
      this.swing += dt / SWING_TIME;
      if (this.swing >= 1) this.swing = -1;
    }

    if (this.mounted) {
      this.animateSeated();
      this.animateRig(dt, 0, false);
      return;
    }

    if (this.noclip) {
      this.flyUpdate(dt, input, cam);
      return;
    }

    const g = world.planet.gravity;
    const terrain = world.terrain;

    let mx = 0;
    let mz = 0;
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) mz += 1;
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) mz -= 1;
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) mx -= 1;
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) mx += 1;

    cam.forward(fwd);
    cam.right(rgt);
    move.set(0, 0, 0).addScaledVector(fwd, mz).addScaledVector(rgt, mx);
    const moving = move.lengthSq() > 0;
    if (moving) move.normalize();

    const walking = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    let speed = (walking ? WALK_SPEED : RUN_SPEED) * this.speedMultiplier;

    // Water: the surface here, and how deep the body sits in it. Swimming starts when the
    // chest is under; the head stays above the surface unless the player dives.
    const surface = terrain.waterHeightAt(this.pos.x, this.pos.z);
    const depth = surface - this.pos.y;
    // Interiors can sit below a lake (the Gungan cities do) and are never water. Once
    // swimming, a little slack keeps the float line from flickering between states.
    this.swimming = !this.inside && depth > (this.swimming ? SWIM_DEPTH - 0.3 : SWIM_DEPTH);
    this.submerged = this.swimming && depth > DIVE_DEPTH;

    if (this.swimming) {
      // Swimming: slow, no gravity, free up and down; looking down while submerged dives.
      speed *= SWIM_SPEED;
      const k = 1 - Math.exp(-dt * 4);
      this.vel.x += (move.x * speed - this.vel.x) * k;
      this.vel.z += (move.z * speed - this.vel.z) * k;
      let vy = 0;
      if (input.isDown('Space')) vy = SWIM_SPEED * RUN_SPEED;
      else if (input.isDown('ControlLeft') || input.isDown('ControlRight')) vy = -SWIM_SPEED * RUN_SPEED;
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
    } else if (this.grounded) {
      this.vel.x = move.x * speed;
      this.vel.z = move.z * speed;
      if (input.isDown('Space')) {
        this.vel.y = Math.sqrt(2 * g * JUMP_HEIGHT);
        this.grounded = false;
      }
    } else {
      const k = 1 - Math.exp(-dt * 2.5);
      this.vel.x += (move.x * speed - this.vel.x) * k;
      this.vel.z += (move.z * speed - this.vel.z) * k;
    }

    if (!this.swimming) this.vel.y -= g * dt;
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

    const ground = terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < terrain.floor) {
      this.pos.y = ground + 1;
      this.vel.set(0, 0, 0);
    }

    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });

    const faceCamera = this.classId === 'bounty_hunter' || this.swing >= 0;
    if (faceCamera) {
      const desired = Math.atan2(fwd.x, fwd.z);
      let diff = desired - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 16);
    } else if (moving) {
      const desired = Math.atan2(move.x, move.z);
      let diff = desired - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 14);
    }

    this.moveAmount += ((moving ? Math.min(1, speed / RUN_SPEED) : 0) - this.moveAmount) * Math.min(1, dt * 10);
    this.phase += dt * speed * (moving ? 1.9 : 0);
    this.groundSpeed = moving ? speed : 0;
    this.animate(dt);
    this.animateRig(dt, this.groundSpeed, moving);

    this.group.position.copy(this.pos);
    this.group.rotation.set(0, this.heading, 0);
    this.group.updateMatrixWorld(true);
  }

  private animateRig(dt: number, speed: number, moving: boolean): void {
    const rig = this.rig;
    if (!rig) return;
    if (this.mounted) rig.setState('seated');
    else if (this.swimming) rig.setState(moving || this.submerged ? 'swim' : 'float', speed);
    else if (!this.grounded) rig.setState('air');
    else if (!moving) rig.setState('idle');
    else rig.setState(speed < 4.5 ? 'walk' : 'run', speed);
    rig.update(dt);
    this.group.updateMatrixWorld(true);

    if (this.mounted) {
      rig.aimArm('right', armDir.set(-0.25, -0.15, 0.95).normalize());
      rig.aimArm('left', armDir.set(0.25, -0.15, 0.95).normalize());
    } else if (this.classId === 'bounty_hunter') {
      rig.aimArm('right', armDir.set(-0.15, 0.02, 0.99).normalize());
      rig.aimArm('left', armDir.set(0.2, -0.1, 0.95).normalize());
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
    for (const f of this.parts.flames) {
      f.visible = this.jetThrust;
      f.scale.y = 0.8 + Math.random() * 0.5;
    }
  }

  private flyUpdate(dt: number, input: Input, cam: ThirdPersonCamera): void {
    cam.camera.getWorldDirection(fwd);
    cam.right(rgt);
    move.set(0, 0, 0);
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) move.add(fwd);
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) move.sub(fwd);
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) move.add(rgt);
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) move.sub(rgt);
    if (input.isDown('Space')) move.y += 1;
    if (input.isDown('ControlLeft') || input.isDown('ControlRight')) move.y -= 1;
    const moving = move.lengthSq() > 0;
    if (moving) move.normalize();
    const speed = this.noclipSpeed * (input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? 3.5 : 1) * this.speedMultiplier;
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
    this.group.position.copy(this.pos);
    this.group.rotation.set(0, this.heading, 0);
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
    for (const f of p.flames) f.visible = false;
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

    for (const f of p.flames) {
      f.visible = this.jetThrust;
      f.scale.y = 0.8 + Math.random() * 0.5;
    }
  }
}
