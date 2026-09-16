import * as THREE from 'three';
import { RAPIER } from '../core/physics';
import { GUNS, gunTypeFor, type FireMode, type GunProfile } from './guns';
import type { BoltFrame } from './bolts';
import type { Hittable, Kit, KitContext, KitSlot, Resource } from './kit';
import type { EffectHandle } from '../world/particles';

interface Detonator {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  fuse: number;
  damage: number;
  radius: number;
  mode: FireMode | null;
}

const DET_COOLDOWN = 3;
const STIM_COOLDOWN = 12;
const BLAST_RADIUS = 9;

const dir = new THREE.Vector3();
const from = new THREE.Vector3();
const end = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const aimDir = new THREE.Vector3();
const shotDir = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const side = new THREE.Vector3();
const lift = new THREE.Vector3();
const placeQ = new THREE.Quaternion();
const placeM = new THREE.Matrix4();
const hullInverse = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);
const Z = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The bounty hunter: a gun with two triggers (see guns.ts for what each kind does on each), a thermal
 * detonator and a stim pack. A gun fires from its muzzle at what the crosshair is on; the client's own
 * shot, flash and hit effects are drawn when the pack has them.
 */
export class BountyHunterKit implements Kit {
  readonly id = 'bounty_hunter' as const;
  readonly name = 'Bounty Hunter';
  readonly slots: KitSlot[] = [
    { key: '1', name: 'Thermal Detonator', cost: '3s' },
    { key: '2', name: 'Stim Pack', cost: '12s' },
  ];
  readonly help = [
    '<b>LMB</b> fire: from the hip it scatters, aimed it flies true · <b>RMB</b> hold to aim, the camera in close · <b>Middle mouse</b> or <b>Q</b> the gun\'s other trigger: a pistol\'s or sniper\'s charge, a rifle\'s rapid fire, a bowcaster\'s bouncing bolt, a repeater\'s concussive ball, a flechette\'s mines, a launcher\'s homing rocket, an ion blast, a fireball, a ball of lightning, a sonic pulse, an acid spray',
    'Each kind of gun handles its own way: a flame thrower is a cone of flame that burns on, a lightning rifle a bolt held on what is ahead that jumps to what stands near, a slugthrower a fast slug that drops over distance, a crossbow an arc, carbonite a freezing bolt · <b>1</b> Thermal Detonator · <b>2</b> Stim Pack · <b>K</b> pistol or rifle · <b>V</b> kneel and <b>Z</b> prone',
  ];
  readonly resource: Resource | null = null;
  /** Last gun change, for the HUD. */
  gunNote = '';
  private fireCd = 0;
  private altCd = 0;
  private detCd = 0;
  private stimCd = 0;
  /** Which trigger is charging, and for how long. */
  private charging: 'primary' | 'alt' | null = null;
  private chargeTime = 0;
  private lastProfile: GunProfile | null = null;
  /** A stream's or beam's effect at the muzzle while the trigger is held. */
  private held: { fx: EffectHandle; which: 'primary' | 'alt' } | null = null;
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

  /** How charged the held shot is, 0 to 1, for the HUD; 0 when nothing charges. */
  charge(): number {
    if (!this.charging || !this.lastProfile) return 0;
    const mode = this.charging === 'primary' ? this.lastProfile.primary : this.lastProfile.alt;
    return mode?.charge ? Math.min(1, this.chargeTime / mode.charge.time) : 0;
  }

  /** The gun in hand: the rack's, by its client effect, name and class, or the placeholder's by its kind. */
  profile(ctx: KitContext): GunProfile {
    const def = ctx.player.equipped.right;
    const cls = def ? def.class : ctx.player.gunClass;
    return GUNS[gunTypeFor(def, cls)];
  }

  slotCooldown(i: number): number {
    if (i === 0) return this.detCd / DET_COOLDOWN;
    if (i === 1) return this.stimCd / STIM_COOLDOWN;
    return 0;
  }

  update(ctx: KitContext): void {
    const { dt, input, player, world, effects, physics } = ctx;
    const onFoot = !player.mounted && !player.eva;
    // K switches the kind of blaster, as it switches the saber styles: the pistol's carries or the rifle's.
    if (input.pressedAction('saberStyle') && onFoot) {
      if (player.equipped.right) this.gunNote = `${player.equipped.right.id} is a ${player.gunClass}; I opens the rack`;
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
    this.altCd = Math.max(0, this.altCd - dt);
    this.detCd = Math.max(0, this.detCd - dt);
    this.stimCd = Math.max(0, this.stimCd - dt);

    const gun = this.profile(ctx);
    if (gun !== this.lastProfile) {
      this.charging = null;
      this.chargeTime = 0;
      this.stopHeld(ctx);
      this.lastProfile = gun;
    }
    const primary = onFoot && input.held('attack');
    const alt = onFoot && input.held('altFire');
    let heldNow = false;
    heldNow = this.trigger(ctx, gun, gun.primary, primary, 'primary') || heldNow;
    if (gun.alt) heldNow = this.trigger(ctx, gun, gun.alt, alt && !primary, 'alt') || heldNow;
    if (!heldNow) this.stopHeld(ctx);

    // 1: Thermal Detonator
    if (onFoot && input.pressedAction('slot1') && this.detCd <= 0) {
      this.detCd = DET_COOLDOWN;
      this.throwMine(ctx, 17, 2.5, 130, BLAST_RADIUS, null);
    }
    for (let i = this.detonators.length - 1; i >= 0; i--) {
      const d = this.detonators[i];
      d.fuse -= dt;
      const t = d.body.translation();
      d.mesh.position.set(t.x, t.y, t.z);
      const r = d.body.rotation();
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      d.mesh.children[0].visible = Math.sin(d.fuse * (d.fuse < 1 ? 60 : 18)) > 0;
      // A mine goes off early when something walks up to it.
      const near = d.mode && world.creatures.creatures.some((c) => !c.dead && c.pos.distanceTo(d.mesh.position) < 1.6);
      if (d.fuse <= 0 || near) {
        this.blast(ctx, d.mesh.position, d.damage, d.radius, d.mode);
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

  /** One trigger this frame: what its mode does with the button held or not. Returns whether it holds an effect at the muzzle. */
  private trigger(ctx: KitContext, gun: GunProfile, mode: FireMode, held: boolean, which: 'primary' | 'alt'): boolean {
    const { dt, player, effects } = ctx;
    const ready = which === 'primary' ? this.fireCd <= 0 : this.altCd <= 0;
    const cool = (s: number) => {
      if (which === 'primary') this.fireCd = s;
      else this.altCd = s;
    };
    switch (mode.kind) {
      case 'shot':
        if (held && ready) {
          this.fire(ctx, gun, mode, 0);
          cool(mode.fireTime);
        }
        return false;
      case 'charge':
        if (held && ready) {
          if (this.charging !== which) {
            this.charging = which;
            this.chargeTime = 0;
          }
          this.chargeTime += dt;
          player.muzzle(tmp);
          effects.flash(tmp, mode.color, 2 + 10 * Math.min(1, this.chargeTime / mode.charge!.time), 4, 0.06);
        } else if (this.charging === which) {
          this.charging = null;
          this.fire(ctx, gun, mode, Math.min(1, this.chargeTime / mode.charge!.time));
          this.chargeTime = 0;
          cool(mode.fireTime);
        }
        return false;
      case 'mines':
        if (held && ready) {
          for (let i = 0; i < (mode.mines?.count ?? 1); i++) this.throwMine(ctx, 12 + i * 3, mode.mines?.fuse ?? 2.5, mode.splash?.damage ?? mode.damage, mode.splash?.radius ?? 3, mode);
          cool(mode.fireTime);
          player.shotFired();
        }
        return false;
      case 'blast':
        if (held && ready) {
          tmp.copy(player.pos).y += 1;
          this.blast(ctx, tmp, mode.splash?.damage ?? mode.damage, mode.splash?.radius ?? 5, mode, mode.push);
          cool(mode.fireTime);
        }
        return false;
      case 'stream':
        if (!held) return false;
        this.stream(ctx, mode, which);
        return true;
      case 'beam':
        if (!held) return false;
        this.beam(ctx, mode, which);
        return true;
    }
    return false;
  }

  /**
   * Where the muzzle is and which way a shot leaves it: at the crosshair's point, unless that is beside
   * or behind the muzzle. Aboard, the room's walls are what the crosshair finds, and the shot's frame is the hull's.
   */
  private aim(ctx: KitContext): void {
    const { player, cam, physics } = ctx;
    cam.camera.getWorldDirection(dir);
    from.copy(cam.camera.position);
    player.muzzle(muzzle);
    const room = player.aboard;
    if (room) {
      // The crosshair's line and the muzzle into the hull's frame; the room's physics finds the wall.
      hullInverse.copy(room.vehicle.group.matrixWorld).invert();
      from.applyMatrix4(hullInverse);
      dir.transformDirection(hullInverse);
      muzzle.applyMatrix4(hullInverse);
      const ray = new RAPIER.Ray(from, dir);
      const hit = room.physics.world.castRay(ray, 60, true);
      end.copy(from).addScaledVector(dir, hit ? hit.timeOfImpact : 60);
    } else {
      const ray = new RAPIER.Ray(from, dir);
      const hit = physics.world.castRay(ray, 300, true, undefined, undefined, undefined, player.body);
      end.copy(from).addScaledVector(dir, hit ? hit.timeOfImpact : 300);
    }
    aimDir.copy(end).sub(muzzle);
    if (aimDir.lengthSq() < 1 || aimDir.dot(dir) < 0.5) aimDir.copy(dir);
    aimDir.normalize();
  }

  /** The frame a shot flies in: the hull's when aboard, else none (the world). */
  private frameOf(ctx: KitContext): BoltFrame | null {
    const room = ctx.player.aboard;
    return room ? { matrix: room.vehicle.group.matrixWorld, physics: room.physics } : null;
  }

  /** The body a shot flies out through: the hull's when aboard (the room is not a target), else the player's. */
  private excludeOf(ctx: KitContext): RAPIER.RigidBody {
    return ctx.player.aboard ? ctx.player.aboard.vehicle.body : ctx.player.body;
  }

  /**
   * One shot of a mode: from the muzzle at the crosshair, scattered by the mode's spread (less aimed and
   * in a steadier posture), as many bolts as it fires at once, at the charge's damage; a hitscan mode
   * lands at once, a bolt flies with its drop, bounces or homing, and where it lands its blast and its
   * burn, stun or freeze reach what it struck.
   */
  private fire(ctx: KitContext, gun: GunProfile, mode: FireMode, charge: number): void {
    const { player, effects, world } = ctx;
    this.aim(ctx);
    // The pistol's charge climbs in five steps, as the game's does; a sniper's climbs smoothly.
    const level = gun.type === 'bryar' ? Math.max(1, Math.min(5, Math.ceil(charge * 5))) / 5 : charge;
    const damage = mode.charge ? mode.damage + (mode.charge.maxDamage - mode.damage) * (mode.charge.bolts ? 1 : level) : mode.damage;
    const count = mode.charge?.bolts ? 1 + Math.floor(charge * (mode.charge.bolts - 1)) : (mode.pellets ?? 1);
    const base = ((player.aiming ? mode.aimSpread : mode.spread) * player.postureSpread * Math.PI) / 180;
    side.crossVectors(aimDir, UP).normalize();
    lift.crossVectors(side, aimDir);
    const fx = player.equipped.right?.fx;
    const own = mode.ownShot && fx?.shot ? { effect: fx.shot, reach: fx.reach ?? 0.5, hit: fx.hit ?? null, pack: 'weapons' as const } : null;
    // A homing rocket follows what was under the crosshair when it left.
    const mark = mode.homing ? this.targetAhead(ctx, 60, 0.9) : null;
    for (let i = 0; i < count; i++) {
      shotDir.copy(aimDir);
      if (mode.fan && count > 1) shotDir.addScaledVector(side, Math.tan(((i - (count - 1) / 2) * (mode.pelletSpread ?? 4) * Math.PI) / 180));
      const s = base + (mode.pellets && !mode.fan ? ((mode.pelletSpread ?? 0) * Math.PI) / 180 : 0);
      if (s > 0) shotDir.addScaledVector(side, Math.tan((Math.random() * 2 - 1) * s)).addScaledVector(lift, Math.tan((Math.random() * 2 - 1) * s));
      shotDir.normalize();
      if (mode.speed <= 0) this.hitscan(ctx, mode, muzzle, shotDir, damage, level);
      else {
        ctx.bolts.fire(muzzle, shotDir, {
          owner: 'player',
          exclude: this.excludeOf(ctx),
          frame: this.frameOf(ctx),
          damage,
          speed: mode.speed,
          color: mode.color,
          size: mode.size * (mode.charge && !mode.charge.bolts ? 0.8 + level * 0.6 : 1),
          push: mode.push,
          life: 8,
          projectile: own,
          gravity: mode.gravity,
          bounces: mode.bounces,
          homing: mark ? { pos: mark.pos, dead: mark.dead } : null,
          onHit: (p, target) => {
            if (mode.splash) this.blast(ctx, p, mode.splash.damage, mode.splash.radius, mode);
            if (target) this.afflict(ctx, target, mode);
          },
        });
      }
    }
    // The client's own muzzle flash when the pack has it, and the pooled light either way (at the muzzle in the world).
    player.muzzle(tmp);
    tmp2.copy(aimDir);
    if (player.aboard) tmp2.transformDirection(player.aboard.vehicle.group.matrixWorld);
    ctx.bolts.flash(fx?.fire, tmp, tmp2);
    effects.flash(tmp, mode.color, 6 + 6 * mode.size, 6, 0.08);
    player.shotFired();
    void world;
  }

  /** A shot that lands the instant it is fired: what the line meets is hurt, and the line is drawn as a fading beam. */
  private hitscan(ctx: KitContext, mode: FireMode, at: THREE.Vector3, along: THREE.Vector3, damage: number, level: number): void {
    const { player, world, physics, effects } = ctx;
    const room = player.aboard;
    const ray = new RAPIER.Ray(at, along);
    const hit = room ? room.physics.world.castRay(ray, 60, true) : physics.world.castRay(ray, 400, true, undefined, undefined, undefined, player.body);
    const reach = hit ? hit.timeOfImpact : room ? 60 : 400;
    end.copy(at).addScaledVector(along, reach);
    if (room) {
      // Drawn where the hull carries the line; the room's walls are not targets.
      const m = room.vehicle.group.matrixWorld;
      tmp.copy(at).applyMatrix4(m);
      tmp2.copy(end).applyMatrix4(m);
      ctx.bolts.beam(tmp, tmp2, mode.color, 0.3 + level * 0.3, 1 + level * 1.5);
      if (hit) effects.burst(tmp2, 0xffb070, 0.35, 0.12);
      return;
    }
    ctx.bolts.beam(at, end, mode.color, 0.3 + level * 0.3, 1 + level * 1.5);
    if (!hit) return;
    const target = world.hittableAt(hit.collider.handle);
    if (target) {
      tmp.copy(at);
      target.damage(damage, tmp, mode.push * (1 + level));
      this.afflict(ctx, target, mode);
      effects.burst(end, 0xffb070, 0.7, 0.15);
    } else effects.burst(end, 0xffb070, 0.35, 0.12);
    if (mode.splash) this.blast(ctx, end, mode.splash.damage, mode.splash.radius, mode);
    effects.flash(end, mode.color, 10, 6, 0.1);
  }

  /** A cone of harm ahead while the trigger is held (a flame, an acid spray): what stands in it is hurt each frame and burns on. */
  private stream(ctx: KitContext, mode: FireMode, which: 'primary' | 'alt'): void {
    const { dt, player, world, effects } = ctx;
    this.aim(ctx);
    const cone = mode.cone ?? { range: 5, angle: 20 };
    const cos = Math.cos((cone.angle * Math.PI) / 180);
    for (const c of world.creatures.creatures) {
      if (c.dead) continue;
      tmp.copy(c.pos).y += c.halfHeight;
      tmp.sub(muzzle);
      const d = tmp.length();
      if (d > cone.range + c.halfHeight) continue;
      if (d > 0.5 && tmp.divideScalar(d).dot(aimDir) < cos) continue;
      c.damage(mode.damage * dt);
      this.afflict(ctx, c, mode);
      if (mode.push > 0 && Math.random() < dt * 2) {
        tmp2.copy(c.pos).sub(player.pos).setY(0).normalize();
        c.knock(tmp2, mode.push);
      }
    }
    for (const t of world.turrets.turrets) {
      tmp.copy(t.pos).sub(muzzle);
      const d = tmp.length();
      if (d > cone.range || (d > 0.5 && tmp.divideScalar(d).dot(aimDir) < cos)) continue;
      t.damage(mode.damage * dt);
    }
    this.holdEffect(ctx, mode, which, muzzle, aimDir);
    // Without the pack's flame, the stream is puffs of light along the cone.
    if (!this.held) {
      tmp.copy(muzzle).addScaledVector(aimDir, 1 + Math.random() * (cone.range - 1));
      effects.burst(tmp, mode.color, 0.5 + Math.random() * 0.6, 0.25);
    }
    effects.flash(muzzle, mode.color, 10, 6, 0.06);
    player.shotFired();
  }

  /** A line held on the nearest thing ahead (lightning): hurt each frame, staggered, and the shock jumps to what stands near it. */
  private beam(ctx: KitContext, mode: FireMode, which: 'primary' | 'alt'): void {
    const { dt, player, world, effects } = ctx;
    this.aim(ctx);
    const cone = mode.cone ?? { range: 25, angle: 8 };
    const target = this.targetAhead(ctx, cone.range, Math.cos((cone.angle * Math.PI) / 180));
    if (target) {
      end.copy(target.pos).y += target.halfHeight;
      target.damage(mode.damage * dt);
      this.afflict(ctx, target, mode);
      if (mode.chain) {
        let other: Hittable | null = null;
        let best = mode.chain.radius;
        for (const c of world.creatures.creatures) {
          if (c === target || c.dead) continue;
          const d = c.pos.distanceTo(target.pos);
          if (d < best) {
            best = d;
            other = c;
          }
        }
        if (other) {
          other.damage(mode.damage * mode.chain.share * dt);
          this.afflict(ctx, other, mode);
          tmp.copy(other.pos).y += other.halfHeight;
          ctx.bolts.beam(end, tmp, mode.color, 0.08, 0.7);
        }
      }
    } else end.copy(muzzle).addScaledVector(aimDir, cone.range);
    tmp2.copy(end).sub(muzzle).normalize();
    ctx.bolts.beam(muzzle, end, mode.color, 0.08, 1);
    this.holdEffect(ctx, mode, which, muzzle, tmp2);
    effects.flash(end, mode.color, 12, 8, 0.06);
    player.shotFired();
  }

  /** The pack's effect for a held trigger, placed at the muzzle facing `along` and kept there while it lasts. */
  private holdEffect(ctx: KitContext, mode: FireMode, which: 'primary' | 'alt', at: THREE.Vector3, along: THREE.Vector3): void {
    const file = mode.effect ? ctx.weapons?.effect(mode.effect) : null;
    if (!file) return;
    // The client's beam effects run along their own Y: stood up, they point where the muzzle does.
    placeQ.setFromUnitVectors(UP, along);
    placeM.compose(at, placeQ, ONE);
    if (this.held && this.held.which === which) ctx.world.weaponFx.move(this.held.fx, placeM);
    else {
      this.stopHeld(ctx);
      this.held = { fx: ctx.world.weaponFx.place(file, placeM, false, false), which };
    }
  }

  private stopHeld(ctx: KitContext): void {
    if (!this.held) return;
    ctx.world.weaponFx.remove(this.held.fx);
    this.held = null;
  }

  /** What a mode does to what it hurt beyond the damage: a burn, a stagger, a freeze, an ion shove. */
  private afflict(ctx: KitContext, target: Hittable, mode: FireMode): void {
    if (mode.dot) target.afflict?.(mode.dot.dps, mode.dot.seconds);
    if (mode.stun) target.stun?.(mode.stun);
    if (mode.slow) target.slow?.(mode.slow);
    if (mode.ion) {
      // Ion: a vehicle takes the shove hard.
      for (const sp of ctx.world.vehicles) {
        if (sp === ctx.player.mounted || sp.pos.distanceTo(target.pos) > 3) continue;
        const m = sp.body.mass();
        sp.body.applyImpulse({ x: aimDir.x * m * 6, y: m * 3, z: aimDir.z * m * 6 }, true);
      }
    }
  }

  /** The nearest living creature within `range` metres and the cone about the aim (`cos` at its edge). */
  private targetAhead(ctx: KitContext, range: number, cos: number): Hittable | null {
    const { world } = ctx;
    let best: Hittable | null = null;
    let bestD = range;
    for (const c of world.creatures.creatures) {
      if (c.dead) continue;
      tmp.copy(c.pos).y += c.halfHeight;
      tmp.sub(muzzle);
      const d = tmp.length();
      if (d >= bestD) continue;
      if (d > 0.5 && tmp.divideScalar(d).dot(aimDir) < cos) continue;
      bestD = d;
      best = c;
    }
    return best;
  }

  /** A blast at a point: everything within `radius` metres hurt by up to `damage` and thrown outward, the player too when close. */
  private blast(ctx: KitContext, at: THREE.Vector3, damage: number, radius: number, mode: FireMode | null, push = 10): void {
    const { world, effects, player } = ctx;
    effects.ring(at, mode?.color ?? 0xffa050, radius * 2.5, 0.4);
    effects.burst(at, 0xffc080, radius * 0.6, 0.3);
    effects.flash(at, mode?.color ?? 0xffa050, 30 + damage * 0.3, radius * 4, 0.25);
    for (const c of world.creatures.creatures) {
      tmp.copy(c.pos).sub(at);
      const d = tmp.length();
      if (d > radius) continue;
      const f = 1 - d / radius;
      tmp.setY(0).normalize();
      c.damage(damage * f + damage * 0.1);
      c.knock(tmp, push * f + 4);
      if (mode) this.afflict(ctx, c, mode);
    }
    for (const t of world.turrets.turrets) {
      const d = t.pos.distanceTo(at);
      if (d <= radius) t.damage(damage * (1 - d / radius) + damage * 0.1);
    }
    for (const sp of world.vehicles) {
      tmp.copy(sp.pos).sub(at);
      const d = tmp.length();
      if (d > radius * 1.5 || sp === player.mounted || sp === player.aboard?.vehicle) continue;
      const f = 1 - d / (radius * 1.5);
      const m = sp.body.mass();
      tmp.normalize();
      sp.body.applyImpulse({ x: tmp.x * m * 6 * f, y: m * 4 * f, z: tmp.z * m * 6 * f }, true);
    }
    const dp = player.pos.distanceTo(at);
    if (dp < radius * 0.7 && !player.mounted) player.takeDamage(damage * 0.35 * (1 - dp / (radius * 0.7)));
  }

  /** Throw a charge ahead: a ball with a fuse that goes off as a blast (the thermal detonator, the flechette's mines). */
  private throwMine(ctx: KitContext, speed: number, fuse: number, damage: number, radius: number, mode: FireMode | null): void {
    const { player, cam, physics } = ctx;
    cam.camera.getWorldDirection(dir);
    player.muzzle(from);
    from.addScaledVector(dir, 0.4);
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(from.x, from.y, from.z)
        .setLinvel(dir.x * speed + player.vel.x, dir.y * speed + 4, dir.z * speed + player.vel.z)
        .setAngvel({ x: 6, y: 2, z: 4 })
        .setCcdEnabled(true),
    );
    physics.world.createCollider(RAPIER.ColliderDesc.ball(0.16).setMass(0.6).setRestitution(mode ? 0.6 : 0.45).setFriction(0.7), body);
    const mesh = new THREE.Mesh(this.detGeo, this.detMat);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), this.detLightMat);
    light.position.y = 0.16;
    mesh.add(light);
    mesh.castShadow = true;
    if (mode) mesh.scale.setScalar(0.7);
    this.scene.add(mesh);
    this.detonators.push({ mesh, body, fuse, damage, radius, mode });
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
