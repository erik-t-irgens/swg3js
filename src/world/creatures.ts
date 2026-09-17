import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { PlanetDef } from '../data/planets';
import { RAPIER, type Physics } from '../core/physics';
import type { Terrain } from './terrain';
import { ACTOR_LAYER } from './portalRender';
import { Ragdoll } from '../combat/ragdoll';

export type CreatureDef = PlanetDef['creatures'];

const tmp = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const AGGRO_RANGE = 32;
/** Converted SWG models already face +Z, the direction the creatures move in. */
const MODEL_YAW = 0;

/** A converted creature (tools/swg creatures command): a skinned model with the clips the game drives. */
export interface CreatureModel {
  gltf: GLTF;
  clips: Map<string, THREE.AnimationClip>;
  /** Movement speed each locomotion clip was animated at (m/s), to scale playback to the real speed. */
  speeds: Map<string, number>;
}

/** Load the converted creature for a species name, or null when the pack has none. */
export async function loadCreatureModel(name: string): Promise<CreatureModel | null> {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const base = `${import.meta.env.BASE_URL}assets-private/creatures/`;
  try {
    const res = await fetch(`${base}manifest.json`);
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const manifest = (await res.json()) as { creatures: { id: string; file: string; clipSpeeds?: Record<string, number> }[] };
    const entry = manifest.creatures.find((c) => c.id === id);
    if (!entry) return null;
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets-private/${entry.file}`);
    gltf.scene.traverse((o) => {
      o.layers.enable(ACTOR_LAYER);
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    return { gltf, clips: new Map(gltf.animations.map((a) => [a.name, a])), speeds: new Map(Object.entries(entry.clipSpeeds ?? {})) };
  } catch (err) {
    console.warn('creature model', id, err);
    return null;
  }
}

export class Creature {
  readonly group = new THREE.Group();
  readonly inner = new THREE.Group();
  /** Feet position, mirrored from the physics body every frame. */
  readonly pos = new THREE.Vector3();
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly halfHeight: number;
  hp: number;
  dead = false;
  deadTimer = 0;
  stunned = 0;
  grounded = true;
  heading = Math.random() * Math.PI * 2;
  private readonly target = new THREE.Vector3();
  private retarget = 0;
  private attackCd = 0;
  private phase = Math.random() * 10;
  private tumble = 0;
  private moving = false;
  private speed = 0;
  private readonly legs: THREE.Object3D[] = [];
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private clipSpeeds = new Map<string, number>();
  private current: THREE.AnimationAction | null = null;
  private oneShot: THREE.AnimationAction | null = null;

  constructor(readonly def: CreatureDef, mat: THREE.Material, private readonly physics: Physics, x: number, y: number, z: number) {
    const s = def.size;
    this.hp = def.hp;
    this.halfHeight = 0.5 * s;

    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 0.6 * s, 1.6 * s), mat);
    bodyMesh.position.y = 0.75 * s;
    bodyMesh.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.45 * s, 0.6 * s), mat);
    head.position.set(0, 0.95 * s, 0.95 * s);
    head.castShadow = true;
    this.inner.add(bodyMesh, head);
    const legGeo = new THREE.BoxGeometry(0.2 * s, 0.6 * s, 0.2 * s).translate(0, -0.3 * s, 0);
    for (const [lx, lz] of [[-0.3, 0.55], [0.3, 0.55], [-0.3, -0.55], [0.3, -0.55]]) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(lx * s, 0.6 * s, lz * s);
      leg.castShadow = true;
      this.inner.add(leg);
      this.legs.push(leg);
    }
    this.inner.position.y = -this.halfHeight;
    this.group.add(this.inner);

    const world = physics.world;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y + this.halfHeight + 0.05, z)
        .lockRotations()
        .setLinearDamping(0.6)
        .setAngularDamping(2.5),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.45 * s, this.halfHeight, 0.8 * s).setMass(60 * s * s).setFriction(0.8),
      this.body,
    );
    this.pos.set(x, y, z);
    this.target.copy(this.pos);
  }

  /** Swap the procedural body for the planet's converted creature model. */
  setModel(model: CreatureModel): void {
    if (this.model) return;
    for (const o of [...this.inner.children]) this.inner.remove(o);
    this.legs.length = 0;
    const scene = cloneSkeleton(model.gltf.scene);
    scene.rotation.y = MODEL_YAW;
    this.inner.add(scene);
    this.model = scene;
    this.mixer = new THREE.AnimationMixer(scene);
    for (const [name, clip] of model.clips) this.actions.set(name, this.mixer.clipAction(clip));
    this.clipSpeeds = model.speeds;
    this.play('idle');
  }

  private action(...names: string[]): THREE.AnimationAction | null {
    for (const n of names) {
      const exact = this.actions.get(n);
      if (exact) return exact;
      for (const [k, a] of this.actions) if (k.includes(n)) return a;
    }
    return null;
  }

  /** Cross-fade to a looping clip; moving clips play at the rate that matches the ground speed. */
  private play(name: string, moveSpeed = 0): void {
    const order = name === 'run' ? ['run', 'walk'] : name === 'walk' ? ['walk', 'run'] : [name];
    let next: THREE.AnimationAction | null = null;
    let clipName = '';
    for (const n of order) {
      next = this.action(n);
      if (next) {
        clipName = n;
        break;
      }
    }
    if (!next) return;
    if (moveSpeed > 0) {
      const natural = this.clipSpeeds.get(clipName) ?? 0;
      next.timeScale = natural > 0.05 ? Math.min(2.5, Math.max(0.6, moveSpeed / natural)) : 1;
    } else next.timeScale = 1;
    if (next === this.current) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    if (this.current) next.crossFadeFrom(this.current, 0.25, false);
    this.current = next;
  }

  /** Play a clip once over the loop (attack, hit, death); `then` runs as it ends. */
  private playOnce(name: string, hold = false, then?: () => void): boolean {
    const a = this.action(name);
    if (!a || !this.mixer) return false;
    a.reset().setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = hold;
    a.play();
    const back = this.current && !hold ? this.current : null;
    if (back || then) {
      const onDone = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== a) return;
        this.mixer?.removeEventListener('finished', onDone);
        back?.reset().play();
        then?.();
      };
      this.mixer.addEventListener('finished', onDone);
    }
    this.oneShot = a;
    return true;
  }

  /** The body left to the physics once the death clip has played; gone ten seconds later. */
  ragdoll: Ragdoll | null = null;

  /** Hand the skinned body to the physics from the pose it is in now; the creature's own body goes quiet. */
  private startRagdoll(): void {
    if (this.ragdoll || !this.model || !this.dead) return;
    this.group.updateMatrixWorld(true);
    const v = this.body.linvel();
    this.ragdoll = new Ragdoll(this.physics, this.model, { velocity: new THREE.Vector3(v.x, v.y, v.z) });
    this.body.setEnabled(false);
    this.mixer?.stopAllAction();
    this.deadTimer = 10;
  }

  private endRagdoll(): void {
    if (!this.ragdoll) return;
    this.ragdoll.dispose();
    this.ragdoll = null;
    this.body.setEnabled(true);
  }

  respawn(x: number, y: number, z: number): void {
    this.dead = false;
    this.endRagdoll();
    if (this.model) {
      this.oneShot?.stop();
      this.oneShot = null;
      this.current = null;
      this.play('idle');
    }
    this.hp = this.def.hp;
    this.stunned = 0;
    this.tumble = 0;
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.lockRotations(true, true);
    this.body.setTranslation({ x, y: y + this.halfHeight + 0.05, z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setRotation({ x: 0, y: Math.sin(this.heading / 2), z: 0, w: Math.cos(this.heading / 2) }, true);
    this.pos.set(x, y, z);
    this.target.copy(this.pos);
    this.retarget = 0;
  }

  /** Seconds left in a Force slow: it moves and animates at a crawl. */
  slowed = 0;
  /** Held in the air by the Force: it hangs where it is put, and its own moves stop. */
  held = false;

  /** Slow it for `seconds` (a Force stasis, a carbonite bolt). */
  slow(seconds: number): void {
    if (this.dead) return;
    this.slowed = Math.max(this.slowed, seconds);
  }

  /** Damage over time (a burn, acid): `dps` a second for `seconds`; a new one replaces a weaker one. */
  private dotDps = 0;
  private dotLeft = 0;
  afflict(dps: number, seconds: number): void {
    if (this.dead) return;
    if (dps * seconds >= this.dotDps * this.dotLeft) {
      this.dotDps = dps;
      this.dotLeft = seconds;
    }
  }

  /** Stagger it: no moves of its own for `seconds`. */
  stun(seconds: number): void {
    if (this.dead) return;
    this.stunned = Math.max(this.stunned, seconds);
  }

  /** Hold it at a point in the air this frame: pulled there, its own moves stopped. */
  holdAt(point: THREE.Vector3, dt: number): void {
    if (this.dead) return;
    this.held = true;
    this.stunned = Math.max(this.stunned, 0.3);
    this.grounded = false;
    // A spring toward the point, damped: it settles there and hangs.
    tmp.copy(point).sub(this.pos);
    const k = Math.min(12, 1 / Math.max(dt, 1e-3));
    this.body.setLinvel({ x: tmp.x * k * 0.5, y: tmp.y * k * 0.5 + 0.5, z: tmp.z * k * 0.5 }, true);
  }

  /** Let go of a held creature, thrown along `dir`. */
  release(dir: THREE.Vector3, power: number): void {
    this.held = false;
    this.knock(dir, power);
  }

  /** Apply a horizontal shove plus lift. Power is a target speed in m/s for a size-1 creature. */
  knock(dir: THREE.Vector3, power: number): void {
    if (this.dead) return;
    const k = power / Math.sqrt(this.def.size);
    this.body.setLinvel({ x: dir.x * k, y: Math.max(k * 0.55, 2), z: dir.z * k }, true);
    this.stunned = Math.max(this.stunned, 0.8);
    this.grounded = false;
  }

  damage(amount: number, from?: THREE.Vector3, knock = 0): void {
    if (this.dead) return;
    this.hp -= amount;
    this.stunned = Math.max(this.stunned, 0.25);
    if (this.model && this.hp > 0) this.playOnce('rea_stand_get_hit_light', false);
    if (from && knock > 0) {
      tmp.copy(this.pos).sub(from).setY(0).normalize();
      this.knock(tmp, knock);
    }
    if (this.hp <= 0) this.die(from);
  }

  private die(from?: THREE.Vector3): void {
    this.dead = true;
    this.deadTimer = 9;
    if (this.model) {
      // A real body plays its incapacitation, then falls to the physics from that pose; the boxes tumble.
      this.current?.stop();
      this.current = null;
      if (!this.playOnce('trn_stand_to_incapacitated', true, () => this.startRagdoll())) this.startRagdoll();
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }
    this.body.setEnabledRotations(true, true, true, true);
    tmp.set(0, 0, 0);
    if (from) tmp.copy(this.pos).sub(from).setY(0).normalize();
    const m = this.body.mass();
    this.body.applyImpulse({ x: tmp.x * m * 2.5, y: m * 3, z: tmp.z * m * 2.5 }, true);
    this.body.applyTorqueImpulse({ x: m * 1.5, y: 0, z: m * (Math.random() - 0.5) }, true);
  }

  update(dt: number, terrain: Terrain, playerPos: THREE.Vector3, onAttack: (damage: number) => void): void {
    if (this.ragdoll) {
      // The physics has the body: the skin follows it, and the creature's place is where the trunk lies.
      this.ragdoll.update(dt);
      this.ragdoll.centre(tmp);
      this.pos.set(tmp.x, tmp.y - 0.3, tmp.z);
      this.deadTimer -= dt;
      return;
    }
    const t = this.body.translation();
    this.pos.set(t.x, t.y - this.halfHeight, t.z);
    this.group.position.set(t.x, t.y, t.z);
    const r = this.body.rotation();
    this.group.quaternion.set(r.x, r.y, r.z, r.w);

    // Slowed by the Force, it lives at a crawl: its clips, its moves and its attacks all at the same fraction.
    this.slowed = Math.max(0, this.slowed - dt);
    const slowness = this.slowed > 0 ? 0.12 : 1;
    if (slowness < 1 && !this.dead) {
      const v0 = this.body.linvel();
      this.body.setLinvel({ x: v0.x * 0.5, y: v0.y, z: v0.z * 0.5 }, true);
    }
    dt *= slowness;
    this.mixer?.update(dt);
    if (this.dead) {
      this.deadTimer -= dt;
      return;
    }
    // A burn or acid eats at it, in real time, whatever it is doing.
    if (this.dotLeft > 0) {
      const step = Math.min(this.dotLeft, dt / slowness);
      this.dotLeft -= step;
      this.hp -= this.dotDps * step;
      if (this.hp <= 0) this.die();
      if (this.dead) return;
    }
    // Held in the air: nothing of its own until it is let go.
    if (this.held) {
      this.held = false;
      return;
    }

    this.stunned = Math.max(0, this.stunned - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    const gd = this.physics.groundDistance(t.x, t.y, t.z, this.halfHeight + 0.4, this.body);
    const wasGrounded = this.grounded;
    this.grounded = gd !== null;
    if (!this.grounded) this.tumble += dt * 5;
    else if (!wasGrounded) this.tumble = 0;

    const v = this.body.linvel();
    this.moving = false;
    if (this.grounded && this.stunned <= 0) {
      const toPlayer = tmp.copy(this.pos).sub(playerPos);
      const dist = toPlayer.length();
      const flee = !this.def.aggressive && dist < 6 * this.def.size && this.def.speed > 3;
      const chase = this.def.aggressive && dist < AGGRO_RANGE;
      this.retarget -= dt;
      if (chase) {
        this.target.copy(playerPos);
      } else if (this.retarget <= 0 || (flee && this.retarget > 1)) {
        const angle = flee ? Math.atan2(toPlayer.x, toPlayer.z) + (Math.random() - 0.5) : Math.random() * Math.PI * 2;
        const range = flee ? 25 : 12 + Math.random() * 30;
        this.target.set(this.pos.x + Math.sin(angle) * range, 0, this.pos.z + Math.cos(angle) * range);
        this.retarget = 2 + Math.random() * 5;
      }

      const dx = this.target.x - this.pos.x;
      const dz = this.target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const reach = chase ? 1.3 * this.def.size + 0.9 : 1.5;
      if (chase && d <= reach + 0.3) {
        if (this.attackCd <= 0) {
          onAttack(this.def.damage);
          this.attackCd = 1.6;
          if (this.model) this.playOnce('cbt_stand_combat_attack_light', false);
        }
      }
      if (d > reach) {
        const desired = Math.atan2(dx, dz);
        let diff = desired - this.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.heading += diff * Math.min(1, dt * (chase ? 5 : 3));
        const speed = (flee || chase ? this.def.speed * 1.5 : this.def.speed) * (this.retarget > 1.5 || chase ? 1 : 0.5);
        const nx = this.pos.x + Math.sin(this.heading) * speed * 0.5;
        const nz = this.pos.z + Math.cos(this.heading) * speed * 0.5;
        if (terrain.heightAt(nx, nz) > terrain.waterLevel - 0.3) {
          this.body.setLinvel({ x: Math.sin(this.heading) * speed, y: v.y, z: Math.cos(this.heading) * speed }, true);
          this.moving = true;
          this.speed = speed;
          this.phase += dt * speed * 2.5;
        } else {
          this.retarget = 0;
          this.heading += Math.PI;
        }
      }
      if (!this.moving) this.body.setLinvel({ x: v.x * 0.8, y: v.y, z: v.z * 0.8 }, true);
      tmpQ.setFromAxisAngle(tmp.set(0, 1, 0), this.heading);
      this.body.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }, true);
    }

    if (this.model) {
      // Locomotion clips by speed; one-shot clips (attack, hit) play over them.
      if (!this.oneShot || !this.oneShot.isRunning()) {
        this.oneShot = null;
        this.play(!this.moving ? 'idle' : this.speed >= this.def.speed * 1.4 ? 'run' : 'walk', this.moving ? this.speed : 0);
      }
      return;
    }
    this.inner.rotation.x = this.tumble;
    const swing = this.moving ? Math.sin(this.phase) * 0.55 : 0;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.legs[2].rotation.x = -swing;
    this.legs[3].rotation.x = swing;
    this.inner.position.x = this.stunned > 0 && this.grounded ? Math.sin(this.stunned * 60) * 0.04 : 0;
  }

  dispose(): void {
    this.endRagdoll();
    this.physics.world.removeRigidBody(this.body);
    this.mixer?.stopAllAction();
    if (!this.model) {
      this.inner.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
  }
}

export class CreatureManager {

  readonly group = new THREE.Group();
  readonly creatures: Creature[] = [];
  readonly byCollider = new Map<number, Creature>();
  private readonly mat: THREE.MeshStandardMaterial;
  private model: CreatureModel | null = null;
  private disposed = false;

  constructor(private readonly planet: PlanetDef, private readonly terrain: Terrain, private readonly physics: Physics) {
    this.mat = new THREE.MeshStandardMaterial({ color: planet.creatures.color, flatShading: true, roughness: 0.9 });
    void loadCreatureModel(planet.creatures.name).then((m) => {
      if (!m || this.disposed) return;
      this.model = m;
      for (const c of this.creatures) c.setModel(m);
      console.info(`creatures: ${planet.creatures.name} uses the converted model (${[...m.clips.keys()].join(', ')})`);
    });
  }

  spawnAround(center: THREE.Vector3): void {
    for (let i = 0; i < this.planet.creatures.count; i++) {
      const p = this.pickSpot(center);
      const c = new Creature(this.planet.creatures, this.mat, this.physics, p.x, p.y, p.z);
      if (this.model) c.setModel(this.model);
      this.creatures.push(c);
      this.byCollider.set(c.collider.handle, c);
      this.group.add(c.group);
    }
  }

  /** Stand one of the planet's creatures at a point (the NPC tab's spawn). */
  spawnAt(x: number, z: number): Creature {
    const c = new Creature(this.planet.creatures, this.mat, this.physics, x, this.terrain.heightAt(x, z), z);
    if (this.model) c.setModel(this.model);
    this.creatures.push(c);
    this.byCollider.set(c.collider.handle, c);
    this.group.add(c.group);
    return c;
  }

  /** Take every creature away. */
  removeAll(): number {
    const n = this.creatures.length;
    for (const c of this.creatures) {
      this.group.remove(c.group);
      c.dispose();
    }
    this.creatures.length = 0;
    this.byCollider.clear();
    return n;
  }

  private pickSpot(center: THREE.Vector3): THREE.Vector3 {
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = 35 + Math.random() * 90;
      const x = center.x + Math.sin(a) * r;
      const z = center.z + Math.cos(a) * r;
      const h = this.terrain.heightAt(x, z);
      if (h > this.terrain.waterLevel + 0.5) return new THREE.Vector3(x, h, z);
    }
    return new THREE.Vector3(center.x, this.terrain.heightAt(center.x, center.z), center.z);
  }

  update(dt: number, playerPos: THREE.Vector3, onAttack: (damage: number) => void): void {
    for (const c of this.creatures) {
      if ((c.dead && c.deadTimer <= 0) || c.pos.distanceTo(playerPos) > 260 || c.pos.y < this.terrain.floor - 20) {
        const p = this.pickSpot(playerPos);
        c.respawn(p.x, p.y, p.z);
      }
      c.update(dt, this.terrain, playerPos, onAttack);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const c of this.creatures) c.dispose();
    this.creatures.length = 0;
    this.byCollider.clear();
    this.mat.dispose();
  }
}
