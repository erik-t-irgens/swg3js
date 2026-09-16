import * as THREE from 'three';
import { RAPIER } from '../core/physics';
import { GUNS, gunTypeFor, type GunProfile } from './guns';
import type { Kit, KitContext, KitSlot, Resource } from './kit';

interface Detonator {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  fuse: number;
}

const DET_COOLDOWN = 3;
const STIM_COOLDOWN = 12;
const BLAST_RADIUS = 9;

const dir = new THREE.Vector3();
const from = new THREE.Vector3();
const end = new THREE.Vector3();
const tmp = new THREE.Vector3();
const aimDir = new THREE.Vector3();
const shotDir = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const side = new THREE.Vector3();
const lift = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class BountyHunterKit implements Kit {
  readonly id = 'bounty_hunter' as const;
  readonly name = 'Bounty Hunter';
  readonly slots: KitSlot[] = [
    { key: '1', name: 'Thermal Detonator', cost: '3s' },
    { key: '2', name: 'Stim Pack', cost: '12s' },
  ];
  readonly help = [
    '<b>LMB</b> fire (hold): from the hip it scatters, aimed it flies true · <b>RMB</b> hold to aim, the camera in close · each kind of gun handles its own way: a pistol or a sniper charges while the trigger is held and fires on release, a bowcaster charges into a fan of bolts, a carbine streams, a flechette spreads shards, a launcher blasts where it lands',
    '<b>1</b> Thermal Detonator · <b>2</b> Stim Pack · <b>K</b> pistol or rifle · <b>V</b> kneel and <b>Z</b> prone (steadier shots, their own carries)',
  ];
  readonly resource: Resource | null = null;
  /** Last gun change, for the HUD. */
  gunNote = '';
  private fireCd = 0;
  /** Seconds the trigger has been held on a gun that charges, and whether it is charging now. */
  private chargeTime = 0;
  private charging = false;
  private lastProfile: GunProfile | null = null;
  private detCd = 0;
  private stimCd = 0;
  private readonly detonators: Detonator[] = [];
  private readonly detGeo = new THREE.SphereGeometry(0.16, 10, 8);
  private readonly detMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.4, metalness: 0.7 });
  private readonly detLightMat = new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false });
  private proto: THREE.Mesh | null = null;

  /** A detonator hidden in the scene, so the first one thrown finds its shaders compiled. */
  warmUp(): void {
    if (this.proto) return;
    const mesh = new THREE.Mesh(this.detGeo, this.detMat);
    mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), this.detLightMat));
    mesh.visible = false;
    mesh.position.y = -900;
    this.scene.add(mesh);
    this.proto = mesh;
  }

  constructor(private readonly scene: THREE.Scene) {}

  slotActive(): boolean {
    return false;
  }

  /** How charged the held shot is, 0 to 1, for the HUD; 0 when the gun does not charge. */
  charge(): number {
    const c = this.lastProfile?.charge;
    return c && this.charging ? Math.min(1, this.chargeTime / c.time) : 0;
  }

  /** The gun in hand: the rack's, by its name and class, or the placeholder's by its kind. */
  profile(ctx: KitContext): GunProfile {
    const def = ctx.player.equipped.right;
    const cls = def ? def.class : ctx.player.gunClass;
    return GUNS[gunTypeFor(def?.id ?? null, cls)];
  }

  slotCooldown(i: number): number {
    if (i === 0) return this.detCd / DET_COOLDOWN;
    if (i === 1) return this.stimCd / STIM_COOLDOWN;
    return 0;
  }

  update(ctx: KitContext): void {
    const { dt, input, player, world, cam, physics, effects } = ctx;
    const onFoot = !player.mounted;
    // K switches the kind of blaster, as it switches the saber styles: the pistol's carries or the rifle's.
    if (input.pressedAction('saberStyle') && onFoot) {
      if (player.equipped.right) this.gunNote = `${player.equipped.right.id} is a ${player.gunClass}; G opens the rack`;
      else {
        // The placeholder blaster cycles through the kinds, for their carries and turns.
        const kinds = ['pistol', 'carbine', 'rifle', 'heavy'] as const;
        player.gunClass = kinds[(kinds.indexOf(player.gunClass) + 1) % kinds.length];
        player.gunKind = player.gunClass === 'pistol' ? 'pistol' : 'rifle';
        player.fitGun();
        this.gunNote = `blaster: ${player.gunClass}`;
      }
    }
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.detCd = Math.max(0, this.detCd - dt);
    this.stimCd = Math.max(0, this.stimCd - dt);

    // The gun in hand fires its own way (see guns.ts). A gun that charges takes the trigger held and
    // fires on release; any other fires as long as the trigger is held and its rate allows.
    const gun = this.profile(ctx);
    if (gun !== this.lastProfile) {
      this.charging = false;
      this.chargeTime = 0;
      this.lastProfile = gun;
    }
    const primary = onFoot && input.held('attack');
    if (gun.charge) {
      if (primary && this.fireCd <= 0) {
        if (!this.charging) {
          this.charging = true;
          this.chargeTime = 0;
        }
        this.chargeTime += dt;
        // The charge glows at the muzzle as it builds.
        player.muzzle(tmp);
        effects.flash(tmp, gun.color, 2 + 10 * Math.min(1, this.chargeTime / gun.charge.time), 4, 0.06);
      } else if (this.charging) {
        this.charging = false;
        this.fire(ctx, gun, Math.min(1, this.chargeTime / gun.charge.time));
        this.chargeTime = 0;
      }
    } else if (primary && this.fireCd <= 0) this.fire(ctx, gun, 0);

    // 1: Thermal Detonator
    if (onFoot && input.pressedAction('slot1') && this.detCd <= 0) {
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
    if (input.pressedAction('slot2') && this.stimCd <= 0 && player.hp < player.maxHp) {
      this.stimCd = STIM_COOLDOWN;
      player.heal(45);
      effects.ring(player.pos, 0x7fff9f, 3, 0.6);
    }
  }

  /**
   * One shot from the gun: from the muzzle at the crosshair's point (unless that point is beside or
   * behind the muzzle, then straight ahead), scattered by the gun's spread (less aimed, less in a steadier
   * posture), as many bolts as it fires at once, at the charge's damage. A hitscan gun lands its shot at
   * once and draws the beam; a blasting bolt carries its blast to where it lands.
   */
  private fire(ctx: KitContext, gun: GunProfile, charge: number): void {
    const { player, cam, physics, effects } = ctx;
    this.fireCd = gun.fireTime;
    cam.camera.getWorldDirection(dir);
    from.copy(cam.camera.position);
    const ray = new RAPIER.Ray(from, dir);
    const hit = physics.world.castRay(ray, 300, true, undefined, undefined, undefined, player.body);
    end.copy(from).addScaledVector(dir, hit ? hit.timeOfImpact : 300);
    player.muzzle(muzzle);
    aimDir.copy(end).sub(muzzle);
    if (aimDir.lengthSq() < 1 || aimDir.dot(dir) < 0.5) aimDir.copy(dir);
    aimDir.normalize();
    // The Bryar's charge climbs in five steps, as the game's does; a sniper's climbs smoothly.
    const level = gun.type === 'bryar' ? Math.max(1, Math.min(5, Math.ceil(charge * 5))) / 5 : charge;
    const damage = gun.charge ? gun.damage + (gun.charge.maxDamage - gun.damage) * (gun.charge.bolts ? 1 : level) : gun.damage;
    const count = gun.charge?.bolts ? 1 + Math.floor(charge * (gun.charge.bolts - 1)) : (gun.pellets ?? 1);
    const base = ((player.aiming ? gun.aimSpread : gun.spread) * player.postureSpread * Math.PI) / 180;
    side.crossVectors(aimDir, UP).normalize();
    lift.crossVectors(side, aimDir);
    for (let i = 0; i < count; i++) {
      shotDir.copy(aimDir);
      // A fan of bolts (the bowcaster's) spreads across evenly; shards scatter at random.
      if (gun.charge?.bolts && count > 1) shotDir.addScaledVector(side, Math.tan(((i - (count - 1) / 2) * (gun.pelletSpread ?? 4) * Math.PI) / 180));
      const s = base + (gun.pellets ? ((gun.pelletSpread ?? 0) * Math.PI) / 180 : 0);
      if (s > 0) shotDir.addScaledVector(side, Math.tan((Math.random() * 2 - 1) * s)).addScaledVector(lift, Math.tan((Math.random() * 2 - 1) * s));
      shotDir.normalize();
      if (gun.hitscan) this.hitscan(ctx, gun, muzzle, shotDir, damage, level);
      else {
        const splash = gun.splash;
        ctx.bolts.fire(muzzle, shotDir, {
          owner: 'player',
          exclude: player.body,
          damage,
          speed: gun.speed,
          color: gun.color,
          size: gun.size * (gun.charge && !gun.charge.bolts ? 0.8 + level * 0.6 : 1),
          push: gun.push,
          life: 6,
          onHit: splash ? (p) => this.blast(ctx, p, splash.damage, splash.radius) : undefined,
        });
      }
    }
    effects.flash(muzzle, gun.color, 6 + 6 * gun.size, 6, 0.08);
    player.shotFired();
  }

  /** A shot that lands the instant it is fired: what the line meets is hurt, and the line is drawn as a fading beam. */
  private hitscan(ctx: KitContext, gun: GunProfile, at: THREE.Vector3, along: THREE.Vector3, damage: number, level: number): void {
    const { player, world, physics, effects } = ctx;
    const ray = new RAPIER.Ray(at, along);
    const hit = physics.world.castRay(ray, 400, true, undefined, undefined, undefined, player.body);
    const reach = hit ? hit.timeOfImpact : 400;
    end.copy(at).addScaledVector(along, reach);
    ctx.bolts.beam(at, end, gun.color, 0.3 + level * 0.3, 1 + level * 1.5);
    if (!hit) return;
    const target = world.hittableAt(hit.collider.handle);
    if (target) {
      tmp.copy(at);
      target.damage(damage, tmp, gun.push * (1 + level));
      effects.burst(end, 0xffb070, 0.7, 0.15);
    } else effects.burst(end, 0xffb070, 0.35, 0.12);
    effects.flash(end, gun.color, 10, 6, 0.1);
  }

  /** A blast at a point: everything within `radius` metres hurt by up to `damage` and thrown outward, the player too when close. */
  private blast(ctx: KitContext, at: THREE.Vector3, damage: number, radius: number): void {
    const { world, effects, player } = ctx;
    effects.ring(at, 0xffa050, radius * 2.5, 0.4);
    effects.burst(at, 0xffc080, radius * 0.6, 0.3);
    effects.flash(at, 0xffa050, 30 + damage * 0.3, radius * 4, 0.25);
    for (const c of world.creatures.creatures) {
      tmp.copy(c.pos).sub(at);
      const d = tmp.length();
      if (d > radius) continue;
      const f = 1 - d / radius;
      tmp.setY(0).normalize();
      c.damage(damage * f + damage * 0.1);
      c.knock(tmp, 10 * f + 4);
    }
    for (const t of world.turrets.turrets) {
      const d = t.pos.distanceTo(at);
      if (d <= radius) t.damage(damage * (1 - d / radius) + damage * 0.1);
    }
    for (const sp of world.vehicles) {
      tmp.copy(sp.pos).sub(at);
      const d = tmp.length();
      if (d > radius * 1.5) continue;
      const f = 1 - d / (radius * 1.5);
      const m = sp.body.mass();
      tmp.normalize();
      sp.body.applyImpulse({ x: tmp.x * m * 6 * f, y: m * 4 * f, z: tmp.z * m * 6 * f }, true);
    }
    const dp = player.pos.distanceTo(at);
    if (dp < radius * 0.7 && !player.mounted) player.takeDamage(damage * 0.35 * (1 - dp / (radius * 0.7)));
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
    for (const t of world.turrets.turrets) {
      const d = t.pos.distanceTo(at);
      if (d <= BLAST_RADIUS) t.damage(130 * (1 - d / BLAST_RADIUS) + 15);
    }
    for (const sp of world.vehicles) {
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
    if (this.proto) this.scene.remove(this.proto);
    for (const d of this.detonators) this.scene.remove(d.mesh);
    this.detonators.length = 0;
    this.detGeo.dispose();
    this.detMat.dispose();
    this.detLightMat.dispose();
  }
}
