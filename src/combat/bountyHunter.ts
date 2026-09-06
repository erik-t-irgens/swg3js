import * as THREE from 'three';
import { RAPIER } from '../core/physics';
import type { Kit, KitContext, KitSlot, Resource } from './kit';

interface Detonator {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  fuse: number;
}

const FIRE_RATE = 0.16;
const DET_COOLDOWN = 3;
const STIM_COOLDOWN = 12;
const BLAST_RADIUS = 9;

const dir = new THREE.Vector3();
const from = new THREE.Vector3();
const end = new THREE.Vector3();
const tmp = new THREE.Vector3();

export class BountyHunterKit implements Kit {
  readonly id = 'bounty_hunter' as const;
  readonly name = 'Bounty Hunter';
  readonly slots: KitSlot[] = [
    { key: '1', name: 'Thermal Detonator', cost: '3s' },
    { key: '2', name: 'Stim Pack', cost: '12s' },
    { key: 'Space', name: 'Jetpack', cost: 'fuel' },
  ];
  readonly help = [
    '<b>LMB</b> fire blaster (hold) · <b>Space</b> in the air: jetpack',
    '<b>1</b> Thermal Detonator · <b>2</b> Stim Pack',
  ];
  readonly resource: Resource = { label: 'Fuel', value: 100, max: 100 };
  private fireCd = 0;
  private detCd = 0;
  private stimCd = 0;
  private jetOn = false;
  private readonly detonators: Detonator[] = [];
  private readonly detGeo = new THREE.SphereGeometry(0.16, 10, 8);
  private readonly detMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.4, metalness: 0.7 });
  private readonly detLightMat = new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false });

  constructor(private readonly scene: THREE.Scene) {}

  slotActive(i: number): boolean {
    return i === 2 && this.jetOn;
  }

  slotCooldown(i: number): number {
    if (i === 0) return this.detCd / DET_COOLDOWN;
    if (i === 1) return this.stimCd / STIM_COOLDOWN;
    return 0;
  }

  update(ctx: KitContext): void {
    const { dt, input, player, world, cam, physics, effects } = ctx;
    const res = this.resource;
    const onFoot = !player.mounted;
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.detCd = Math.max(0, this.detCd - dt);
    this.stimCd = Math.max(0, this.stimCd - dt);

    // Blaster: hitscan from the camera through the crosshair.
    if (onFoot && input.isDown('Mouse0') && this.fireCd <= 0) {
      this.fireCd = FIRE_RATE;
      cam.camera.getWorldDirection(dir);
      from.copy(cam.camera.position);
      const ray = new RAPIER.Ray(from, dir);
      const hit = physics.world.castRay(ray, 250, true, undefined, undefined, undefined, player.body);
      if (hit) {
        const p = ray.pointAt(hit.timeOfImpact);
        end.set(p.x, p.y, p.z);
      } else {
        end.copy(from).addScaledVector(dir, 250);
      }
      player.muzzle(tmp);
      effects.tracer(tmp, end, 0xff5a3a, 0.08);
      effects.flash(tmp, 0xff6a3a, 8, 6, 0.08);
      const creature = hit ? world.creatures.byCollider.get(hit.collider.handle) : undefined;
      if (creature) {
        creature.damage(22, player.pos, 2.5);
        effects.burst(end, 0xffb070, 0.6, 0.15);
      } else if (hit) {
        effects.burst(end, 0xffb070, 0.3, 0.12);
      }
    }

    // Jetpack: hold Space while airborne.
    const g = world.planet.gravity;
    this.jetOn = onFoot && input.isDown('Space') && !player.grounded && res.value > 0;
    if (this.jetOn) {
      player.vel.y = Math.min(11, player.vel.y + (g + 16) * dt);
      res.value -= 30 * dt;
    } else if (player.grounded || player.mounted) {
      res.value = Math.min(res.max, res.value + 22 * dt);
    }
    player.jetThrust = this.jetOn;

    // 1: Thermal Detonator
    if (onFoot && input.justPressed('Digit1') && this.detCd <= 0) {
      this.detCd = DET_COOLDOWN;
      this.throwDetonator(ctx);
    }
    for (let i = this.detonators.length - 1; i >= 0; i--) {
      const d = this.detonators[i];
      d.fuse -= dt;
      const t = d.body.translation();
      d.mesh.position.set(t.x, t.y, t.z);
      const r = d.body.rotation();
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      d.mesh.children[0].visible = Math.sin(d.fuse * (d.fuse < 1 ? 60 : 18)) > 0;
      if (d.fuse <= 0) {
        this.explode(ctx, d.mesh.position);
        this.scene.remove(d.mesh);
        physics.world.removeRigidBody(d.body);
        this.detonators.splice(i, 1);
      }
    }

    // 2: Stim Pack
    if (input.justPressed('Digit2') && this.stimCd <= 0 && player.hp < player.maxHp) {
      this.stimCd = STIM_COOLDOWN;
      player.heal(45);
      effects.ring(player.pos, 0x7fff9f, 3, 0.6);
    }
  }

  private throwDetonator(ctx: KitContext): void {
    const { player, cam, physics } = ctx;
    cam.camera.getWorldDirection(dir);
    player.muzzle(from);
    from.addScaledVector(dir, 0.4);
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(from.x, from.y, from.z)
        .setLinvel(dir.x * 17 + player.vel.x, dir.y * 17 + 4, dir.z * 17 + player.vel.z)
        .setAngvel({ x: 6, y: 2, z: 4 })
        .setCcdEnabled(true),
    );
    physics.world.createCollider(RAPIER.ColliderDesc.ball(0.16).setMass(0.6).setRestitution(0.45).setFriction(0.7), body);
    const mesh = new THREE.Mesh(this.detGeo, this.detMat);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), this.detLightMat);
    light.position.y = 0.16;
    mesh.add(light);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.detonators.push({ mesh, body, fuse: 2.5 });
  }

  private explode(ctx: KitContext, at: THREE.Vector3): void {
    const { world, effects, player } = ctx;
    effects.ring(at, 0xffa050, 14, 0.5);
    effects.burst(at, 0xffc080, 4, 0.35);
    effects.flash(at, 0xffa050, 60, 25, 0.3);
    for (const c of world.creatures.creatures) {
      tmp.copy(c.pos).sub(at);
      const d = tmp.length();
      if (d > BLAST_RADIUS) continue;
      const f = 1 - d / BLAST_RADIUS;
      tmp.setY(0).normalize();
      c.damage(130 * f + 15);
      c.knock(tmp, 16 * f + 5);
    }
    for (const sp of world.speeders) {
      tmp.copy(sp.pos).sub(at);
      const d = tmp.length();
      if (d > BLAST_RADIUS) continue;
      const f = 1 - d / BLAST_RADIUS;
      const m = sp.body.mass();
      tmp.normalize();
      sp.body.applyImpulse({ x: tmp.x * m * 10 * f, y: m * 6 * f, z: tmp.z * m * 10 * f }, true);
    }
    const dp = player.pos.distanceTo(at);
    if (dp < BLAST_RADIUS * 0.7) player.takeDamage(35 * (1 - dp / (BLAST_RADIUS * 0.7)));
  }

  dispose(): void {
    for (const d of this.detonators) this.scene.remove(d.mesh);
    this.detonators.length = 0;
    this.detGeo.dispose();
    this.detMat.dispose();
    this.detLightMat.dispose();
  }
}
