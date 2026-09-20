import * as THREE from 'three';
import { KICK_DAMAGE } from './saber';
import { THROW } from './saberThrow';
import { DEFAULT_LOADOUT, POWERS, SLOT_ACTIONS, SLOT_COUNT, powerById } from './forcePowers';
import { sabers } from '../audio/saberSounds.ts';
import type { Hittable, Kit, KitContext, KitSlot, Living, Resource } from './kit';
import { nearestInCone, type ConeQuery } from './targets';
import { sweepCapsule } from './sweep';
import { Unarmed } from './unarmed';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const LIGHTNING_SEGMENTS = 14;
/** The narrowings the powers ask `targetAhead` for, as kept predicates rather than a closure a frame. */
const CAN_SLOW = (t: Living): boolean => !!t.slow;
const CAN_HOLD = (t: Living): boolean => !!t.holdAt;
/** Rage lasts this long, then rests this long. */
const RAGE_TIME = 10;
const RAGE_REST = 20;
/**
 * The three powers that are held and the three that are toggled, looked up once rather than on
 * every frame they are held: what each one sounds like is on the power itself (`forcePowers.ts`).
 */
const HELD_POWERS = { lightning: powerById('lightning'), drain: powerById('drain'), grip: powerById('grip') };
const KEPT_POWERS = { speed: powerById('speed'), protect: powerById('protect'), rage: powerById('rage') };

export class JediKit implements Kit {
  readonly id = 'jedi' as const;
  readonly name = 'Jedi';
  /** The power in each number slot, by id (null for an empty slot); the HUD's slots follow it. */
  loadout: (string | null)[] = [...DEFAULT_LOADOUT];
  readonly help = [
    '<b>LMB</b> saber swing (hold to chain, direction keys pick the swing) · <b>RMB</b> hold to block: the stance comes up and bolts are turned away · <b>LMB+RMB</b> kata · <b>R</b> throw the saber (staff: kick) · <b>K</b> style (fast, medium, strong, dual, staff) · <b>L</b> saber on/off',
    '<b>Jump</b> + direction + <b>LMB</b> flip and jump attacks · <b>Ctrl</b> + forward + <b>LMB</b> lunge or spin · <b>Jump</b> beside a wall: wall run (strafe + forward) or wall flip (strafe) · <b>Jump</b> at a wall: run up and flip back · back + <b>Jump</b>: backflip',
    '<b>1</b> to <b>6</b> the Force powers in the slots: the inventory\'s Force tab (<b>I</b>) picks which; a tap power fires on the key, a hold power lasts while it is down, a toggle until the key again',
    'Bolts are only turned away while the block is held, back where you look; at the top defence rank the block holds through a swing',
  ];
  readonly resource: Resource = { label: 'Force', value: 100, max: 100 };
  speedActive = false;
  lightningActive = false;
  protectActive = false;
  drainActive = false;
  /** Seconds of rage left, and of its rest after. */
  private rageLeft = 0;
  private rageRest = 0;
  /** Whatever the Force is holding, while the grip lasts: a creature, a fighter, anything alive. */
  private gripped: Living | null = null;
  /**
   * One kept cone query and one kept test for `targetAhead`, which runs every frame lightning,
   * drain or a grip is held: a fresh object literal and a fresh closure a frame is exactly what
   * the rule against allocating inside a frame is about. The two fields are the test's inputs.
   */
  private aheadNeed: ((t: Living) => boolean) | null = null;
  private aheadMe: Living | null = null;
  private readonly aheadTest = (t: Living): boolean => t !== this.aheadMe && (!this.aheadNeed || this.aheadNeed(t));
  private readonly aheadQuery: ConeQuery<Living> = { from: tmp, forward: tmp, range: 0, cone: 0, need: this.aheadTest };
  private healCd = 0;
  private repulseCd = 0;
  private slowCd = 0;
  private pullCd = 0;
  /** Last style change, for the HUD. */
  styleNote = '';
  private readonly hitThisSwing = new Set<Hittable>();
  private lastAttackId = -1;
  /** The body's count of bolts turned away, as it stood last frame: a rise in it is a block heard. */
  private lastBlocks = -1;
  /** What the thrown saber has hit on its current leg out or back. */
  private readonly hitThisLeg = new Set<Hittable>();
  private lastLegId = -1;
  private orbitTimer = 0;
  /** Bare hands on: the saber away, the buttons punching and kicking. */
  fistsActive = false;
  private readonly unarmed = new Unarmed();
  private readonly aura: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly bolt: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly boltPositions = new Float32Array((LIGHTNING_SEGMENTS + 1) * 3);
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.aura = new THREE.Mesh(
      new THREE.SphereGeometry(1.3, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x5fb8ff, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.aura.visible = false;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.boltPositions, 3));
    this.bolt = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xbfe6ff, toneMapped: false }));
    this.bolt.visible = false;
    this.bolt.frustumCulled = false;
    scene.add(this.aura, this.bolt);
  }

  /** The slots as the HUD shows them: one per number key with a power in it. */
  get slots(): KitSlot[] {
    const out: KitSlot[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const p = this.loadout[i] ? powerById(this.loadout[i]!) : null;
      if (p) out.push({ key: String(i + 1), name: p.name, cost: p.cost });
    }
    return out;
  }

  /** Put powers in the slots (ids; unknown ones are dropped), keeping toggles that are no longer there off. */
  setLoadout(ids: (string | null)[]): void {
    this.loadout = [];
    for (let i = 0; i < SLOT_COUNT; i++) this.loadout.push(ids[i] && powerById(ids[i]!) ? ids[i]! : null);
    if (!this.loadout.includes('speed')) this.speedActive = false;
    if (!this.loadout.includes('protect')) this.protectActive = false;
    if (!this.loadout.includes('rage')) this.rageLeft = 0;
    if (!this.loadout.includes('fists')) this.fistsActive = false;
  }

  /** The slot index (0-based among the HUD's slots) for the i-th number key, or -1. */
  private hudIndexOf(id: string): number {
    let n = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (!this.loadout[i]) continue;
      if (this.loadout[i] === id) return n;
      n++;
    }
    return -1;
  }

  slotActive(i: number): boolean {
    const id = this.slots[i]?.name;
    const p = POWERS.find((x) => x.name === id);
    switch (p?.id) {
      case 'speed':
        return this.speedActive;
      case 'lightning':
        return this.lightningActive;
      case 'drain':
        return this.drainActive;
      case 'protect':
        return this.protectActive;
      case 'rage':
        return this.rageLeft > 0;
      case 'grip':
        return this.gripped !== null;
      case 'fists':
        return this.fistsActive;
      default:
        return false;
    }
  }

  slotCooldown(i: number): number {
    const name = this.slots[i]?.name;
    const p = POWERS.find((x) => x.name === name);
    switch (p?.id) {
      case 'heal':
        return this.healCd / 6;
      case 'repulse':
        return this.repulseCd / 4;
      case 'slow':
        return this.slowCd / 5;
      case 'pull':
        return this.pullCd / 1.5;
      case 'rage':
        return this.rageLeft > 0 ? 0 : this.rageRest / RAGE_REST;
      default:
        return 0;
    }
  }

  update(ctx: KitContext): void {
    const { dt, input, player, world, cam, physics, effects } = ctx;
    this.time += dt;
    const planet = world.planet;
    const res = this.resource;
    const onFoot = !player.mounted;
    // Where the player's own sounds are heard, and which blades in the world are the player's: the
    // move machine and the parries know when something happens but not where the body is, and the
    // blades in other hands hum as somebody else's. The figure's world place, not `pos`, because
    // aboard a ship `pos` is in the hull's frame and a power used there would sound out in the zone.
    sabers.follow(player.worldPos, player.saberBlades);
    // A bolt turned away rings off the blade. The count is what the body raises for every bolt it
    // really blocked, which is the only thing that knows it happened: the parry animation plays
    // only when the legs have nothing better to do, so a block heard from there would be silent
    // whenever the player was moving or already swinging, and the maths that turns the bolt round
    // is a pure function several things may one day ask without a bolt being blocked at all.
    if (this.lastBlocks < 0) this.lastBlocks = player.blocks;
    else if (player.blocks !== this.lastBlocks) {
      this.lastBlocks = player.blocks;
      sabers.contact('block');
    }

    // Lightsaber: the player runs the swing itself (Jedi Academy's move system); each new swing
    // may hit every creature once.
    player.force = res;
    if (input.pressedAction('saberStyle') && onFoot) this.styleNote = player.allowedStyles.length > 1 ? `saber style: ${player.saber.cycleStyle(player.allowedStyles)}` : `${player.equipped.right?.id ?? 'this weapon'} fights only as ${player.saber.style}`;
    if (player.saber.attackId !== this.lastAttackId) {
      this.lastAttackId = player.saber.attackId;
      this.hitThisSwing.clear();
    }
    if (player.swing === 0) this.hitThisSwing.clear();
    // Bare hands: the saber is away and the buttons brawl.
    player.fists = this.fistsActive && onFoot;
    if (player.fists) {
      this.unarmed.update(ctx);
      player.fistsBusy = this.unarmed.busy;
    } else {
      this.unarmed.reset();
      player.fistsBusy = false;
    }
    // Every lit blade sweeps: the staff's second and the dual style's left-hand saber too.
    if (onFoot && player.saberOn && player.bladeActive) {
      for (let i = 0; i < player.bladeCount; i++) {
        player.bladeSegmentAt(i, a, b);
        this.sweep(ctx, a, b, 0.16, player.saberDamage, this.hitThisSwing);
      }
    }
    // A kick: the foot out in its direction, from the body's middle.
    const kick = onFoot ? player.saber.kicking : null;
    if (kick) {
      const yaw = player.heading + (kick === 'L' ? Math.PI / 2 : kick === 'R' ? -Math.PI / 2 : kick === 'B' ? Math.PI : 0);
      a.copy(player.pos).y += 0.8;
      b.set(a.x + Math.sin(yaw) * 1.3, a.y + 0.1, a.z + Math.cos(yaw) * 1.3);
      this.sweep(ctx, a, b, 0.3, KICK_DAMAGE.min + Math.floor(Math.random() * (KICK_DAMAGE.max - KICK_DAMAGE.min + 1)), this.hitThisSwing, KICK_DAMAGE.push);
    }
    // The dual kata's circling sabers cut everything they pass, again each half turn.
    if (player.orbiting) {
      this.orbitTimer += dt;
      if (this.orbitTimer > 0.33) {
        this.orbitTimer = 0;
        this.hitThisSwing.clear();
      }
      for (let i = 0; i < 2; i++) {
        player.orbitSegment(i, a, b);
        this.sweep(ctx, a, b, 0.25, player.saberDamage, this.hitThisSwing, 4);
      }
    }
    // The thrown saber cuts what it flies through, once on the way out and once on the way back (not aboard, where it flies in the hull's frame).
    if (player.thrown.inFlight && !player.aboard) {
      if (player.thrown.legId !== this.lastLegId) {
        this.lastLegId = player.thrown.legId;
        this.hitThisLeg.clear();
      }
      player.thrown.direction(tmp);
      // The blade lies across the flight, spinning: a disc of its length.
      a.copy(player.thrown.pos).addScaledVector(tmp, -0.55);
      b.copy(player.thrown.pos).addScaledVector(tmp, 0.55);
      this.sweep(ctx, a, b, 0.55, player.thrown.returning ? THROW.returnHitDamage : THROW.hitDamage, this.hitThisLeg, 3);
    }

    // The powers in the slots.
    this.healCd = Math.max(0, this.healCd - dt);
    this.repulseCd = Math.max(0, this.repulseCd - dt);
    this.slowCd = Math.max(0, this.slowCd - dt);
    this.pullCd = Math.max(0, this.pullCd - dt);
    this.rageRest = Math.max(0, this.rageRest - dt);
    let lightning = false;
    let drain = false;
    let grip = false;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const id = this.loadout[i];
      if (!id) continue;
      const action = SLOT_ACTIONS[i];
      const pressed = input.pressedAction(action);
      const held = input.held(action);
      switch (id) {
        case 'jump':
          if (onFoot && pressed && player.grounded && !player.swimming && res.value >= 20) {
            res.value -= 20;
            player.launch(Math.sqrt(2 * planet.gravity * 11), 9, cam);
            effects.ring(player.pos, 0x9fd4ff, 5, 0.5);
            sabers.power(powerById(id), 'once');
          }
          break;
        case 'speed':
          if (pressed) {
            if (this.speedActive) this.speedActive = false;
            else if (res.value >= 10) this.speedActive = true;
          }
          break;
        case 'push':
          if (onFoot && pressed && res.value >= 25) {
            res.value -= 25;
            this.shove(ctx, 1);
            sabers.power(powerById(id), 'once');
          }
          break;
        case 'pull':
          if (onFoot && pressed && res.value >= 20 && this.pullCd <= 0) {
            res.value -= 20;
            this.pullCd = 1.5;
            this.shove(ctx, -1);
            sabers.power(powerById(id), 'once');
          }
          break;
        case 'lightning':
          lightning = onFoot && held && res.value > 0;
          break;
        case 'drain':
          drain = onFoot && held && res.value > 0 && !lightning;
          break;
        case 'grip':
          grip = onFoot && held && res.value > 0;
          break;
        case 'repulse':
          if (onFoot && pressed && res.value >= 40 && this.repulseCd <= 0) {
            res.value -= 40;
            this.repulseCd = 4;
            this.repulse(ctx);
            sabers.power(powerById(id), 'once');
          }
          break;
        case 'slow':
          if (onFoot && pressed && res.value >= 25 && this.slowCd <= 0) {
            const target = this.targetAhead(ctx, 24, 0.5, CAN_SLOW);
            if (target) {
              res.value -= 25;
              this.slowCd = 5;
              target.slow?.(5);
              tmp.copy(target.pos).y += target.halfHeight;
              effects.ring(tmp, 0xc0a0ff, 3, 0.6);
              effects.flash(tmp, 0xc0a0ff, 12, 8, 0.3);
              sabers.power(powerById(id), 'once', tmp);
            }
          }
          break;
        case 'heal':
          if (pressed && res.value >= 30 && this.healCd <= 0 && player.hp < player.maxHp) {
            res.value -= 30;
            this.healCd = 6;
            player.heal(35);
            effects.ring(player.pos, 0x9fffb0, 3, 0.6);
            sabers.power(powerById(id), 'once');
          }
          break;
        case 'protect':
          if (pressed) {
            if (this.protectActive) this.protectActive = false;
            else if (res.value >= 15) this.protectActive = true;
          }
          break;
        case 'rage':
          if (pressed && this.rageLeft <= 0 && this.rageRest <= 0 && player.hp > 25) {
            this.rageLeft = RAGE_TIME;
            effects.ring(player.pos, 0xff4040, 4, 0.5);
          }
          break;
        case 'fists':
          if (pressed) this.fistsActive = !this.fistsActive;
          break;
      }
    }

    // Speed: a toggle that drains while it lasts.
    if (this.speedActive) {
      res.value -= 6 * dt;
      if (res.value <= 0) this.speedActive = false;
    }
    // Protect: what hurts counts for a third, while it drains.
    if (this.protectActive) {
      res.value -= 5 * dt;
      if (res.value <= 0) this.protectActive = false;
    }
    player.damageTaken = this.protectActive ? 0.34 : 1;
    // Rage: faster and harder for its time, paid for in health; then the rest.
    if (this.rageLeft > 0) {
      this.rageLeft -= dt;
      player.hp = Math.max(8, player.hp - 3 * dt);
      if (this.rageLeft <= 0) this.rageRest = RAGE_REST;
    }
    const raging = this.rageLeft > 0;
    player.damageBoost = raging ? 1.5 : 1;
    player.speedMultiplier = (this.speedActive ? 2.1 : 1) * (raging ? 1.3 : 1);
    this.aura.visible = (this.speedActive || this.protectActive || raging) && onFoot;
    if (this.aura.visible) {
      this.aura.material.color.set(raging ? 0xff5040 : this.protectActive ? 0x60ff90 : 0x5fb8ff);
      this.aura.position.copy(player.pos).y += 1;
      const s = 1 + Math.sin(this.time * 9) * 0.08;
      this.aura.scale.set(s, s * 1.3, s);
    }

    // Lightning and Drain: a bolt at the nearest creature ahead, hurting it while the key is down;
    // the drain gives what it takes back to the player.
    this.lightningActive = lightning;
    this.drainActive = drain;
    this.bolt.visible = lightning || drain;
    if (lightning || drain) {
      res.value -= (drain ? 10 : 18) * dt;
      cam.forward(tmp);
      const target = this.targetAhead(ctx, 26, 0.45);
      if (target) {
        const hurt = (drain ? 20 : 30) * dt;
        // The source is what makes it fight back: without it a defensive or skittish body would
        // simply stand there while it was burned.
        target.damage(hurt, player.pos, 0, world.playerTarget);
        if (drain) player.heal(hurt * 0.6);
        if (!drain && target.grounded && Math.random() < dt * 1.2) {
          tmp2.copy(target.pos).sub(player.pos).setY(0).normalize();
          target.knock?.(tmp2, 4);
        }
      }
      const start = tmp2.copy(player.pos).addScaledVector(tmp, 0.4);
      start.y += 1.35;
      const end = target ? target.pos.clone().setY(target.pos.y + target.halfHeight) : start.clone().addScaledVector(tmp, 14);
      this.bolt.material.color.set(drain ? 0xff6060 : 0xbfe6ff);
      this.drawBolt(start, end);
      // The glow comes from the pooled flash lights (a light of the kit's own would come and go
      // with the class, and a change in the light count recompiles every shader).
      tmp2.copy(end).lerp(start, 0.5).y += 0.5;
      ctx.effects.flash(tmp2, drain ? 0xff6060 : 0x9fd4ff, 14 + Math.random() * 12, 18, 0.08);
    }

    // Grip: whatever is under the crosshair lifted and held ahead, choking; let go and it is thrown.
    if (grip) {
      if (!this.gripped || this.gripped.dead) this.gripped = this.targetAhead(ctx, 14, 0.7, CAN_HOLD);
      const g = this.gripped;
      if (g) {
        res.value -= 12 * dt;
        cam.forward(tmp);
        tmp2.copy(player.pos).addScaledVector(tmp, 3.2 + g.halfHeight);
        tmp2.y = player.pos.y + 1.6 + g.halfHeight;
        g.holdAt?.(tmp2, dt);
        g.damage(6 * dt, player.pos, 0, world.playerTarget);
        tmp2.copy(g.pos).y += g.halfHeight;
        ctx.effects.flash(tmp2, 0xc0b0ff, 4, 5, 0.08);
      }
    } else if (this.gripped) {
      cam.forward(tmp);
      this.gripped.release?.(tmp, 18);
      this.gripped = null;
    }

    // What the powers that last sound like while they last. Each is asked every frame and speaks
    // only when it changes: one sound as it comes on, a loop that follows the player, one as it
    // goes -- whether it was switched off, ran the Force out or simply ended. The grip speaks only
    // once it has hold of something, which is the moment the choking starts.
    sabers.holdPower(KEPT_POWERS.speed, this.speedActive);
    sabers.holdPower(KEPT_POWERS.protect, this.protectActive);
    sabers.holdPower(KEPT_POWERS.rage, raging);
    sabers.holdPower(HELD_POWERS.lightning, lightning);
    sabers.holdPower(HELD_POWERS.drain, drain);
    sabers.holdPower(HELD_POWERS.grip, grip && !!this.gripped);
    res.value = Math.min(res.max, Math.max(0, res.value + 9 * dt));
  }

  /**
   * The nearest living thing within `range` metres and the cone about the view (`cone` is the
   * cosine at its edge), over everything alive but the player. `need` narrows it to what the
   * power can actually do something with (a grip wants a body that can be held).
   */
  private targetAhead(ctx: KitContext, range: number, cone: number, need?: (t: Living) => boolean): Living | null {
    const { player, world, cam } = ctx;
    cam.forward(tmp);
    const q = this.aheadQuery;
    q.from = player.pos;
    q.forward = tmp;
    q.range = range;
    q.cone = cone;
    this.aheadNeed = need ?? null;
    this.aheadMe = world.playerTarget;
    return nearestInCone(world.targets(), q);
  }

  /** Push (`sign` 1) or Pull (-1): everything ahead thrown away from, or dragged toward, the player; vehicles too. */
  private shove(ctx: KitContext, sign: number): void {
    const { player, world, cam, effects } = ctx;
    cam.forward(tmp);
    effects.ring(player.pos, sign > 0 ? 0xbfe0ff : 0xffd0a0, 12, 0.45);
    for (const c of world.targets()) {
      if (c === world.playerTarget || c.dead) continue;
      tmp2.copy(c.pos).sub(player.pos);
      const d = tmp2.length();
      if (d > 16) continue;
      tmp2.normalize();
      if (d > 3 && tmp2.dot(tmp) < 0.35) continue;
      c.damage(sign > 0 ? 10 : 4, player.pos, 0, world.playerTarget);
      // Pulled, it comes to the player's feet: the shove scales with how far it is.
      tmp2.multiplyScalar(sign);
      c.knock?.(tmp2, sign > 0 ? 22 * (1 - d / 18) + 6 : 4 + d * 1.1);
    }
    for (const sp of world.vehicles) {
      tmp2.copy(sp.pos).sub(player.pos);
      const d = tmp2.length();
      if (d > 12 || sp === player.mounted || sp === player.aboard?.vehicle) continue;
      tmp2.normalize().multiplyScalar(sign);
      const m = sp.body.mass();
      sp.body.applyImpulse({ x: tmp2.x * m * 9 * (1 - d / 14), y: m * 4, z: tmp2.z * m * 9 * (1 - d / 14) }, true);
    }
  }

  /** Repulse: a blast in every direction from the player. */
  private repulse(ctx: KitContext): void {
    const { player, world, effects } = ctx;
    effects.ring(player.pos, 0xbfe0ff, 18, 0.5);
    effects.burst(tmp.copy(player.pos).setY(player.pos.y + 1), 0xdfefff, 3, 0.3);
    effects.flash(tmp, 0xbfe0ff, 40, 14, 0.25);
    for (const c of world.targets()) {
      if (c === world.playerTarget || c.dead) continue;
      tmp2.copy(c.pos).sub(player.pos);
      const d = tmp2.length();
      if (d > 10) continue;
      tmp2.setY(0).normalize();
      c.damage(25 * (1 - d / 12) + 5, player.pos, 0, world.playerTarget);
      c.knock?.(tmp2, 26 * (1 - d / 12) + 8);
    }
    for (const sp of world.vehicles) {
      tmp2.copy(sp.pos).sub(player.pos);
      const d = tmp2.length();
      if (d > 10 || sp === player.mounted || sp === player.aboard?.vehicle) continue;
      tmp2.normalize();
      const m = sp.body.mass();
      sp.body.applyImpulse({ x: tmp2.x * m * 10 * (1 - d / 12), y: m * 5, z: tmp2.z * m * 10 * (1 - d / 12) }, true);
    }
  }

  /** Hurt every creature a capsule between two points touches, each once per `already` (the damage is the style's, with the rage already in it). */
  private sweep(ctx: KitContext, from: THREE.Vector3, to: THREE.Vector3, radius: number, damage: number, already: Set<Hittable>, push = 5): void {
    const hit = sweepCapsule(ctx, from, to, radius, damage / ctx.player.damageBoost, already, push);
    // The blade met a body. One sound however many it caught, at the middle of what it swept, and
    // never again for the same body in the same swing: `already` is what makes that true.
    if (hit > 0) {
      tmp2.copy(from).lerp(to, 0.5);
      sabers.contact('body', tmp2);
    }
  }

  private drawBolt(from: THREE.Vector3, to: THREE.Vector3): void {
    const arr = this.boltPositions;
    const dir = tmp.copy(to).sub(from);
    const len = dir.length();
    for (let i = 0; i <= LIGHTNING_SEGMENTS; i++) {
      const t = i / LIGHTNING_SEGMENTS;
      const jitter = i === 0 || i === LIGHTNING_SEGMENTS ? 0 : Math.min(1, len * 0.06) * (0.6 + t * 0.6);
      arr[i * 3] = from.x + dir.x * t + (Math.random() - 0.5) * jitter;
      arr[i * 3 + 1] = from.y + dir.y * t + (Math.random() - 0.5) * jitter;
      arr[i * 3 + 2] = from.z + dir.z * t + (Math.random() - 0.5) * jitter;
    }
    this.bolt.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    // The kit is going (a change of class, a new character, the select screen): anything a power
    // was holding open goes with it, since nothing else will ever be told to end it.
    sabers.stopPowers();
    sabers.follow(null);
    this.scene.remove(this.aura, this.bolt);
    this.aura.geometry.dispose();
    this.aura.material.dispose();
    this.bolt.geometry.dispose();
    this.bolt.material.dispose();
  }
}
