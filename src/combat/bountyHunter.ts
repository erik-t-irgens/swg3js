import * as THREE from 'three';
import { combatSounds, COMBAT_TUNE } from '../audio/combatSounds';
import { RAPIER } from '../core/physics';
import { GUNS, gunTypeFor, type FireMode, type GunProfile } from './guns';
import { layScar, marksHold, scarFamilyOf } from './scars.ts';
import type { BoltFrame } from './bolts';
import type { Hittable, Kit, KitContext, KitSlot, Living, Resource } from './kit';
import type { EffectHandle, ParticleEffects } from '../world/particles';
import { plumeNoiseFrequency, type HeatPlumeSink } from '../world/heatSources';
import { shoveLooseProps } from '../world/looseProps.ts';
import { DEFAULT_GADGETS, gadgetById, type GadgetDef, type GrenadeSpec } from './gadgets';
import { SLOT_ACTIONS, SLOT_COUNT } from './forcePowers';
import { Unarmed } from './unarmed';

/** A charge in the world: a thrown grenade or flechette mine on its fuse, a trip mine on its wall, a det pack waiting for the key. */
interface Charge {
  kind: 'grenade' | 'trip' | 'pack';
  mesh: THREE.Object3D;
  /** A thrown charge's body; a stuck one has none. */
  body: RAPIER.RigidBody | null;
  fuse: number;
  damage: number;
  radius: number;
  push: number;
  color: number;
  /** The flechette's mine mode, for its afflictions. */
  mode: FireMode | null;
  spec: GrenadeSpec | null;
  /** The trip mine's laser: from the mine to the wall it meets. */
  laser?: { from: THREE.Vector3; to: THREE.Vector3; mesh: THREE.Mesh };
  /** The blinking light on a fused charge. */
  light: THREE.Object3D | null;
  /** A grenade that goes off on its first touch: what it was thrown from, so it does not go off in the hand. */
  armedAt: number;
  /** It has touched down once, so it is heard landing once and not on every bounce after. */
  landed?: boolean;
  /** How fast it was going last step, so a sudden loss of speed can be told from the top of a throw. */
  lastSpeed?: number;
}

/** A cloud left where a poison grenade or bug bomb burst: whoever stands in it is afflicted while it lasts. */
interface Cloud {
  pos: THREE.Vector3;
  radius: number;
  spec: GrenadeSpec;
  left: number;
  tick: number;
}

const BLAST_RADIUS = 9;
const TRIP_REACH = 4;
const TRIP_LASER = 14;
const TRIP_DAMAGE = 110;
const TRIP_RADIUS = 5;
const PACK_DAMAGE = 120;
const PACK_RADIUS = 6;
const MAX_PACKS = 6;

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
/** A hull-frame point and direction carried into the world (`toWorld`, `heatPlumes`). */
const worldAt = new THREE.Vector3();
const worldAlong = new THREE.Vector3();
/** Where a held trigger's loop sounds from, in the world; its own vector, so a held frame allocates nothing. */
const heldAt = new THREE.Vector3();
/**
 * INVENTED, from the game's own names: the loop a held trigger makes. The flame thrower's is the
 * one sound the game keeps a loop of (`_lp`); the beams' are its one-shot sets of four samples,
 * which the mixer runs one after another while the trigger is down, as a continuous beam wants.
 * These are the three held triggers the guns have; anything else held makes no loop at all.
 */
const HELD_LOOPS: Record<string, string> = {
  flame: 'sound/wep_flamethrower_shoot_lp.snd',
  lightning: 'sound/wep_rifle_lightning.snd',
  acid: 'sound/wep_rifle_acid_beam.snd',
};
/** How fast the air in a flame thrower's cone flows out from the muzzle, metres a second: the heat haze's noise follows it. */
const FLAME_FLOW = 7;
/** A held flame not stamped within this many milliseconds gives no heat: the step that held it did not run. */
const FLAME_STALE_MS = 100;

/**
 * The bounty hunter: a gun with two triggers (see guns.ts for what each kind does on each), and the
 * gadgets in the number slots (gadgets.ts: the game's grenades, Jedi Academy's trip mine and det
 * pack, the stim pack, bare hands), picked on the inventory's Skills tab. A gun fires from its
 * muzzle at what the crosshair is on; the client's own shot, flash and hit effects are drawn when
 * the pack has them, and a grenade flies as the model the rack has for it.
 */
export class BountyHunterKit implements Kit {
  readonly id = 'bounty_hunter' as const;
  readonly name = 'Bounty Hunter';
  /**
   * The gadget in each number slot, by id (null for an empty slot); the HUD's slots follow it. One
   * array for the life of the kit, emptied and filled again by `setLoadout`.
   */
  readonly loadout: (string | null)[] = [];
  /**
   * The slots as the display shows them: one per number key with a gadget in it. One array, built
   * only when the loadout changes, because the display walks it every frame and a getter that
   * returned a fresh array of fresh objects was building five arrays and sixteen objects a frame.
   */
  readonly slots: KitSlot[] = [];
  /** The gadget behind each of those slots, in the same order, so nothing has to search for it by name. */
  private readonly slotGadgets: GadgetDef[] = [];
  readonly help = [
    '<b>LMB</b> fire: from the hip it scatters, aimed it flies true · <b>RMB</b> hold to aim, the camera in close · <b>Middle mouse</b> or <b>Q</b> the gun\'s other trigger: a pistol\'s or sniper\'s charge, a rifle\'s rapid fire, a bowcaster\'s bouncing bolt, a repeater\'s concussive ball, a flechette\'s mines, a launcher\'s homing rocket, an ion blast, a fireball, a ball of lightning, a sonic pulse, an acid spray',
    'Each kind of gun handles its own way: a flame thrower is a cone of flame that burns on, a lightning rifle a bolt held on what is ahead that jumps to what stands near, a slugthrower a fast slug that drops over distance, a crossbow an arc, carbonite a freezing bolt · <b>K</b> pistol or rifle · <b>V</b> kneel and <b>Z</b> prone',
    '<b>1</b> to <b>6</b> the gadgets in the slots: the inventory\'s Skills tab (<b>I</b>) picks which: the grenades (thermal, fragmentation, proton, Imperial, cryoban, glop, poison, the bug bomb), the trip mine, the det pack, the stim pack, and bare hands (punches on <b>LMB</b>, kicks on <b>RMB</b>)',
  ];
  readonly resource: Resource | null = null;
  /** Last gun change, for the HUD. */
  gunNote = '';
  private fireCd = 0;
  private altCd = 0;
  /** Seconds left before each gadget can be used again, by id. */
  private readonly cds = new Map<string, number>();
  /** Which trigger is charging, and for how long. */
  private charging: 'primary' | 'alt' | null = null;
  private chargeTime = 0;
  private lastProfile: GunProfile | null = null;
  /** A stream's or beam's effect at the muzzle while the trigger is held, and the effects it was placed in (so it can be dropped without a frame's context). */
  private held: { fx: EffectHandle; which: 'primary' | 'alt'; owner: ParticleEffects } | null = null;
  /**
   * The held flame thrower's cone, for the heat haze: where it leaves and which way (in the hull's
   * frame aboard, `frame` being that hull's live matrix), how far and wide it reaches, its noise
   * phase, and `stamp`, performance.now() of the last stream() that held it.
   */
  private readonly flame = { active: false, stamp: 0, at: new THREE.Vector3(), along: new THREE.Vector3(), frame: null as THREE.Matrix4 | null, range: 6, width: 1.3, phase: 0 };
  private readonly charges: Charge[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly unarmed = new Unarmed();
  private readonly detGeo = new THREE.SphereGeometry(0.16, 10, 8);
  private readonly detMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.4, metalness: 0.7 });
  private readonly detLightMat = new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false });
  private readonly packGeo = new THREE.BoxGeometry(0.22, 0.08, 0.16);
  private readonly mineGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.06, 12);
  private readonly laserGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 6, 1, true);
  private readonly laserMat = new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false, transparent: true, opacity: 0.85 });
  /** The rack's grenade models, loaded once each and cloned per throw; 'loading' while on the way. */
  private readonly models = new Map<string, THREE.Group | 'loading'>();
  private proto: THREE.Mesh | null = null;

  /** A detonator hidden in the scene, so the first one thrown finds its shaders compiled. */
  warmUp(): void {
    if (this.proto) return;
    const mesh = new THREE.Mesh(this.detGeo, this.detMat);
    mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), this.detLightMat));
    mesh.add(new THREE.Mesh(this.laserGeo, this.laserMat));
    mesh.visible = false;
    mesh.position.y = -900;
    this.scene.add(mesh);
    this.proto = mesh;
  }

  constructor(private readonly scene: THREE.Scene) {
    // The slots are filled the one way they are ever filled, so the array the display walks exists
    // and agrees with the loadout from the first frame.
    this.setLoadout(DEFAULT_GADGETS);
  }

  /** Put gadgets in the slots (ids; unknown ones are dropped); bare hands go back in the pockets if they are no longer there. */
  setLoadout(ids: (string | null)[]): void {
    this.loadout.length = 0;
    this.slots.length = 0;
    this.slotGadgets.length = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const g = ids[i] ? gadgetById(ids[i]!) : undefined;
      this.loadout.push(g ? ids[i]! : null);
      if (!g) continue;
      this.slots.push({ key: String(i + 1), name: g.name, cost: g.cost });
      this.slotGadgets.push(g);
    }
    if (!this.loadout.includes('fists')) this.fistsWanted = false;
  }

  /** Bare hands are on: the player's flag follows it every frame. */
  private fistsWanted = false;

  /** The charges in the world and the clouds hanging, for the console. */
  status(): { charges: { kind: string; at: number[]; fuse: number }[]; clouds: { at: number[]; left: number }[]; fists: boolean; lastThrow: { from: number[]; dir: number[]; at: number[] } | null; note: string } {
    const r2 = (a: number[]) => a.map((n) => Number(n.toFixed(2)));
    return {
      charges: this.charges.map((c) => ({ kind: c.spec ? c.spec.model : c.kind, at: r2(c.mesh.position.toArray()), fuse: Number(c.fuse.toFixed(2)) })),
      clouds: this.clouds.map((c) => ({ at: r2(c.pos.toArray()), left: Number(c.left.toFixed(1)) })),
      fists: this.fistsWanted,
      lastThrow: this.lastThrow ? { from: r2(this.lastThrow.from), dir: r2(this.lastThrow.dir), at: r2(this.lastThrow.at) } : null,
      note: this.gunNote,
    };
  }

  /** The gadget behind the i-th slot of the display's row. */
  private gadgetAtHud(i: number): GadgetDef | undefined {
    return this.slotGadgets[i];
  }

  /** Whether a charge of a kind is out in the world; a plain loop, since this is asked every frame. */
  private anyCharge(kind: Charge['kind']): boolean {
    for (let i = 0; i < this.charges.length; i++) if (this.charges[i].kind === kind) return true;
    return false;
  }

  /**
   * Whether the i-th slot of the display's row is lit, asked once per slot on every frame: the two
   * searches walk the charges by hand rather than with `some`, whose callback is a fresh closure
   * every time it is asked, and both gadgets are in the row by default.
   */
  slotActive(i: number): boolean {
    const id = this.gadgetAtHud(i)?.id;
    if (id === 'fists') return this.fistsWanted;
    if (id === 'det_pack') return this.anyCharge('pack');
    if (id === 'trip_mine') return this.anyCharge('trip');
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
    const g = this.gadgetAtHud(i);
    if (!g || g.cooldown <= 0) return 0;
    return (this.cds.get(g.id) ?? 0) / g.cooldown;
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
    for (const [id, left] of this.cds) this.cds.set(id, Math.max(0, left - dt));

    const gun = this.profile(ctx);
    if (gun !== this.lastProfile) {
      this.charging = null;
      this.chargeTime = 0;
      this.stopHeld(ctx);
      this.lastProfile = gun;
    }
    // Bare hands: the gun is away, the mouse buttons brawl.
    player.fists = this.fistsWanted && onFoot;
    if (player.fists) {
      this.stopHeld(ctx);
      this.charging = null;
      this.unarmed.update(ctx);
      player.fistsBusy = this.unarmed.busy;
    } else {
      this.unarmed.reset();
      player.fistsBusy = false;
      const primary = onFoot && input.held('attack');
      const alt = onFoot && input.held('altFire');
      let heldNow = false;
      heldNow = this.trigger(ctx, gun, gun.primary, primary, 'primary') || heldNow;
      if (gun.alt) heldNow = this.trigger(ctx, gun, gun.alt, alt && !primary, 'alt') || heldNow;
      if (!heldNow) this.stopHeld(ctx);
    }

    // The gadgets in the slots.
    for (let i = 0; i < SLOT_COUNT; i++) {
      const id = this.loadout[i];
      if (!id || !input.pressedAction(SLOT_ACTIONS[i])) continue;
      const g = gadgetById(id);
      if (!g) continue;
      const ready = (this.cds.get(id) ?? 0) <= 0;
      if (g.id === 'fists') {
        this.fistsWanted = !this.fistsWanted;
        continue;
      }
      if (!onFoot) continue;
      const packs = this.charges.filter((c) => c.kind === 'pack');
      if (g.id === 'det_pack' && packs.length) {
        // The key again, at any time: every pack goes, farthest first so the nearer ones are seen going.
        for (const c of packs.sort((a, b) => b.mesh.position.distanceTo(player.pos) - a.mesh.position.distanceTo(player.pos))) this.detonate(ctx, c);
        this.cds.set(id, g.cooldown);
        continue;
      }
      if (!ready) continue;
      if (g.grenade) {
        this.cds.set(id, g.cooldown);
        this.throwGrenade(ctx, g.grenade);
      } else if (g.id === 'trip_mine') {
        if (this.placeTripMine(ctx)) this.cds.set(id, g.cooldown);
      } else if (g.id === 'det_pack') {
        if (this.placePack(ctx)) this.cds.set(id, g.cooldown);
      } else if (g.id === 'stim') {
        if (player.hp < player.maxHp) {
          this.cds.set(id, g.cooldown);
          player.heal(45);
          effects.ring(player.pos, 0x7fff9f, 3, 0.6);
        }
      }
    }
    // A det pack beyond the first: no wait between placings, only between placing and the next after a blast.
    this.stepCharges(ctx);
    this.stepClouds(ctx);
    void world;
    void physics;
  }

  /** Fly and watch every charge: fuses, first touches, the mines' lasers and what walks up to them. */
  private stepCharges(ctx: KitContext): void {
    const { dt, world, player, physics } = ctx;
    for (let i = this.charges.length - 1; i >= 0; i--) {
      const c = this.charges[i];
      c.fuse -= dt;
      if (c.body) {
        const t = c.body.translation();
        c.mesh.position.set(t.x, t.y, t.z);
        const r = c.body.rotation();
        c.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
      if (c.light) c.light.visible = c.kind === 'pack' ? Math.sin(performance.now() * 0.006) > 0 : Math.sin(c.fuse * (c.fuse < 1 ? 60 : 18)) > 0;
      let go = false;
      if (c.kind === 'grenade') {
        // Its first touch: thrown at a known speed, so it has landed as soon as it is no longer
        // going at it and has lost that speed in one step rather than over a long climb. Thrown
        // steeply a grenade is nearly still at the top of its arc, and without the second half of
        // the test it would knock on the ground up there. It is heard whether or not the touch is
        // what sets it off -- on the ground, or in the water it fell into.
        if (!c.landed && c.body && c.armedAt > 0.15) {
          const v = c.body.linvel();
          const speed = Math.hypot(v.x, v.y, v.z);
          const was = c.lastSpeed ?? speed;
          c.lastSpeed = speed;
          if (speed < (c.spec?.speed ?? 12) * 0.5 && was - speed > COMBAT_TUNE.grenadeKnock) {
            c.landed = true;
            combatSounds.grenade(c.spec?.model ?? null, 'land', c.mesh.position.x, c.mesh.position.y, c.mesh.position.z);
          }
        }
        // A fused charge goes on its fuse; a flechette mine early when something walks up to it; an impact grenade on its first touch.
        if (c.fuse <= 0) go = true;
        else if (c.mode && this.targets(ctx).some((h) => !h.dead && h.pos.distanceTo(c.mesh.position) < 1.6)) go = true;
        else if (c.spec && c.spec.fuse <= 0 && c.armedAt > 0.15 && c.body) {
          c.armedAt += dt;
          const v = c.body.linvel();
          // Slowed by a touch (the velocity is no longer what it was thrown with): it has hit something.
          if (Math.hypot(v.x, v.y, v.z) < c.spec.speed * 0.5) go = true;
        } else c.armedAt += dt;
      } else if (c.kind === 'trip' && c.laser) {
        // Whatever crosses the beam sets it off: creatures, fighters, the player.
        for (const h of this.targets(ctx)) {
          if (h.dead) continue;
          if (this.crossesBeam(h.pos, h.halfHeight, c.laser.from, c.laser.to)) go = true;
        }
        if (!player.mounted && this.crossesBeam(player.pos, 0.9, c.laser.from, c.laser.to)) go = true;
        // Shot or blown up: a blast near it sets it off too.
      }
      if (go) this.detonate(ctx, c);
    }
    void world;
    void physics;
  }

  /** Whether a standing body (its feet at `pos`, `half` up to its middle) crosses the segment from a to b. */
  private crossesBeam(pos: THREE.Vector3, half: number, a: THREE.Vector3, b: THREE.Vector3): boolean {
    // The nearest point on the beam to the body's middle, then the body's radius about it.
    tmp.copy(pos).y += half;
    tmp2.copy(b).sub(a);
    const len2 = tmp2.lengthSq();
    const t = len2 > 0 ? THREE.MathUtils.clamp(tmp.clone().sub(a).dot(tmp2) / len2, 0, 1) : 0;
    tmp2.multiplyScalar(t).add(a);
    const dy = Math.abs(tmp2.y - tmp.y);
    const dxz = Math.hypot(tmp2.x - tmp.x, tmp2.z - tmp.z);
    // A body is about as wide as it is tall to the middle (a bantha's flank is a metre out).
    return dxz < Math.max(0.45, half * 0.7) && dy < half + 0.1;
  }

  /** The clouds: whoever stands in one is afflicted every half second; a puff now and then shows where it hangs. */
  private stepClouds(ctx: KitContext): void {
    const { dt, effects } = ctx;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const cl = this.clouds[i];
      cl.left -= dt;
      cl.tick -= dt;
      if (cl.left <= 0) {
        this.clouds.splice(i, 1);
        continue;
      }
      if (cl.tick <= 0) {
        cl.tick = 0.5;
        for (const h of this.targets(ctx)) {
          if (h.dead || h.pos.distanceTo(cl.pos) > cl.radius) continue;
          if (cl.spec.dot) h.afflict?.(cl.spec.dot.dps, Math.min(cl.spec.dot.seconds, 3));
          if (cl.spec.slow) h.slow?.(1);
          h.damage(cl.spec.damage * 0.1, cl.pos, 0, ctx.world.playerTarget);
        }
        const p = ctx.player;
        if (!p.mounted && p.pos.distanceTo(cl.pos) < cl.radius * 0.8) p.takeDamage(cl.spec.dot ? cl.spec.dot.dps * 0.5 : 2);
      }
      if (Math.random() < dt * 12) {
        tmp.set(cl.pos.x + (Math.random() - 0.5) * cl.radius * 1.4, cl.pos.y + Math.random() * 1.8, cl.pos.z + (Math.random() - 0.5) * cl.radius * 1.4);
        effects.burst(tmp, cl.spec.color, 1.2 + Math.random() * 1.5, 0.8);
      }
    }
  }

  /**
   * Everything a blast or a beam can hurt: the one list of living things, less the player. One
   * kept array rather than a copy a call, because a held trigger asks for this every frame over a
   * list that grows with every body the planet puts out. The one rule it imposes: nothing may ask
   * for it again while it is still walking the last answer, and nothing in this file does.
   */
  private readonly foes: Living[] = [];
  private targets(ctx: KitContext): readonly Living[] {
    const me = ctx.world.playerTarget;
    const out = this.foes;
    out.length = 0;
    for (const t of ctx.world.targets()) if (t !== me) out.push(t);
    return out;
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
          const room = player.aboard;
          if (room) {
            // Aboard, `pos` is in the hull's frame: the pulse is drawn and lit where the hull carries it,
            // and nothing is swept, since nothing in the room is a target (as with a shot fired aboard).
            tmp.applyMatrix4(room.vehicle.group.matrixWorld);
            const radius = mode.splash?.radius ?? 5;
            effects.ring(tmp, mode.color, radius * 2.5, 0.4);
            effects.burst(tmp, 0xffc080, radius * 0.6, 0.3);
            effects.flash(tmp, mode.color, 30 + (mode.splash?.damage ?? mode.damage) * 0.3, radius * 4, 0.25);
          } else this.blast(ctx, tmp, mode.splash?.damage ?? mode.damage, mode.splash?.radius ?? 5, mode, mode.push);
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
    // The weapon in hand: its shot, and what its bolts sound like landing. Built once per weapon.
    const gunSound = combatSounds.gunOf(player.equipped.right);
    // A homing rocket follows what was under the crosshair when it left.
    const mark = mode.homing ? this.targetAhead(ctx, 60, 0.9) : null;
    for (let i = 0; i < count; i++) {
      shotDir.copy(aimDir);
      if (mode.fan && count > 1) shotDir.addScaledVector(side, Math.tan(((i - (count - 1) / 2) * (mode.pelletSpread ?? 4) * Math.PI) / 180));
      const s = base + (mode.pellets && !mode.fan ? ((mode.pelletSpread ?? 0) * Math.PI) / 180 : 0);
      if (s > 0) shotDir.addScaledVector(side, Math.tan((Math.random() * 2 - 1) * s)).addScaledVector(lift, Math.tan((Math.random() * 2 - 1) * s));
      shotDir.normalize();
      if (mode.speed <= 0) this.hitscan(ctx, gun, mode, muzzle, shotDir, damage, level);
      else {
        ctx.bolts.fire(muzzle, shotDir, {
          owner: 'player',
          source: ctx.world.playerTarget,
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
          sound: gunSound,
          // The mark it leaves where it stops: the gun's own type first, its weapon effect family
          // second (`scarFamilyOf`). A rocket leaves a char, a slugthrower a pit, a flame gun soot
          // and a lightning gun a fork, so the four read apart on a wall.
          scar: scarFamilyOf(gun.type, fx?.id),
          onHit: (p, target) => {
            if (mode.splash) this.blast(ctx, p, mode.splash.damage, mode.splash.radius, mode);
            if (target) this.afflict(ctx, target, mode);
          },
        });
      }
    }
    // The client's own muzzle flash when the pack has it, and the pooled light either way (at the muzzle in the world).
    player.muzzle(tmp);
    // The shot a bolt cannot make for itself: a disruptor's line lands the instant it is fired and
    // there is no bolt to sound it. Every other mode is heard from inside `Bolts.fire`, once for
    // the whole trigger pull, since a scattergun's pellets are one shot.
    if (mode.speed <= 0) combatSounds.fire(gunSound, tmp.x, tmp.y, tmp.z);
    tmp2.copy(aimDir);
    if (player.aboard) tmp2.transformDirection(player.aboard.vehicle.group.matrixWorld);
    ctx.bolts.flash(fx?.fire, tmp, tmp2);
    effects.flash(tmp, mode.color, 6 + 6 * mode.size, 6, 0.08);
    player.shotFired();
    void world;
  }

  /** A shot that lands the instant it is fired: what the line meets is hurt, and the line is drawn as a fading beam. */
  private hitscan(ctx: KitContext, profile: GunProfile, mode: FireMode, at: THREE.Vector3, along: THREE.Vector3, damage: number, level: number): void {
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
      // A hull's rooms are the hull: what a shot fired in one strikes is metal.
      if (hit) {
        combatSounds.hit(combatSounds.gunOf(player.equipped.right), tmp2.x, tmp2.y, tmp2.z, 'ship');
        effects.burst(tmp2, 0xffb070, 0.35, 0.12);
      }
      return;
    }
    ctx.bolts.beam(at, end, mode.color, 0.3 + level * 0.3, 1 + level * 1.5);
    if (!hit) return;
    const target = world.hittableAt(hit.collider.handle);
    // Where the line landed, by the same rules a bolt's landing takes.
    const gun = combatSounds.gunOf(player.equipped.right);
    if (target) {
      tmp.copy(at);
      target.damage(damage, tmp, mode.push * (1 + level), world.playerTarget);
      this.afflict(ctx, target, mode);
      combatSounds.hit(gun, end.x, end.y, end.z, 'creature');
      effects.burst(end, 0xffb070, 0.7, 0.15);
    } else {
      const missed = combatSounds.missKindAt(end.x, end.y, end.z);
      if (missed) combatSounds.miss(gun, end.x, end.y, end.z, missed);
      else combatSounds.hit(gun, end.x, end.y, end.z, null);
      effects.burst(end, 0xffb070, 0.35, 0.12);
      // The mark a beam leaves, on the same two conditions a bolt's takes: not on the water, whose
      // surface writes no depth and would wear a mark that hung over the swell, and only on
      // something that holds still. It carries no bolt, so the normal is the way the beam came: a
      // beam fired at a wall marks it square, and one fired across a wall leans a little.
      if (missed !== 'water' && marksHold(hit.collider)) layScar(scarFamilyOf(profile.type, player.equipped.right?.fx?.id), end.x, end.y, end.z, -along.x, -along.y, -along.z, hit.collider.handle);
    }
    if (mode.splash) this.blast(ctx, end, mode.splash.damage, mode.splash.radius, mode);
    effects.flash(end, mode.color, 10, 6, 0.1);
  }

  /** A hull-frame point and direction (aim()'s) carried into the world, into `worldAt` and `worldAlong`: unchanged on foot. */
  private toWorld(ctx: KitContext, at: THREE.Vector3, along: THREE.Vector3): void {
    worldAt.copy(at);
    worldAlong.copy(along);
    const room = ctx.player.aboard;
    if (room) {
      const m = room.vehicle.group.matrixWorld;
      worldAt.applyMatrix4(m);
      worldAlong.transformDirection(m);
    }
  }

  /**
   * A cone of harm ahead while the trigger is held (a flame, an acid spray): what stands in it is hurt
   * each frame and burns on. Aboard, the cone is in the hull's frame and nothing in the room is a
   * target (the same rule as a hitscan shot); the pack's effect is placed in that frame and the light
   * and the puffs are carried out of it.
   */
  private stream(ctx: KitContext, mode: FireMode, which: 'primary' | 'alt'): void {
    const { dt, player, world, effects } = ctx;
    this.aim(ctx);
    const cone = mode.cone ?? { range: 5, angle: 20 };
    const cos = Math.cos((cone.angle * Math.PI) / 180);
    if (!player.aboard) {
      for (const c of this.targets(ctx)) {
        if (c.dead) continue;
        tmp.copy(c.pos).y += c.halfHeight;
        tmp.sub(muzzle);
        const d = tmp.length();
        if (d > cone.range + c.halfHeight) continue;
        if (d > 0.5 && tmp.divideScalar(d).dot(aimDir) < cos) continue;
        c.damage(mode.damage * dt, player.pos, 0, world.playerTarget);
        this.afflict(ctx, c, mode);
        if (mode.push > 0 && Math.random() < dt * 2) c.damage(0, player.pos, mode.push, world.playerTarget);
      }
      for (const t of world.turrets.turrets) {
        tmp.copy(t.pos).sub(muzzle);
        const d = tmp.length();
        if (d > cone.range || (d > 0.5 && tmp.divideScalar(d).dot(aimDir) < cos)) continue;
        t.damage(mode.damage * dt);
      }
    }
    this.holdEffect(ctx, mode, which, muzzle, aimDir);
    this.toWorld(ctx, muzzle, aimDir);
    // Without the pack's flame, the stream is puffs of light along the cone.
    if (!this.held) {
      tmp.copy(worldAt).addScaledVector(worldAlong, 1 + Math.random() * (cone.range - 1));
      effects.burst(tmp, mode.color, 0.5 + Math.random() * 0.6, 0.25);
    }
    effects.flash(worldAt, mode.color, 10, 6, 0.06);
    player.shotFired();
    // The flame's cone for the heat haze, stamped so a step that does not run leaves it cold.
    const f = this.flame;
    if (mode.effect === 'flame') {
      f.active = true;
      f.stamp = performance.now();
      f.at.copy(muzzle);
      f.along.copy(aimDir);
      f.frame = player.aboard ? player.aboard.vehicle.group.matrixWorld : null;
      f.range = cone.range;
      f.width = Math.min(1.6, cone.range * Math.tan((cone.angle * Math.PI) / 180) * 0.55);
      f.phase = (f.phase + dt * FLAME_FLOW * plumeNoiseFrequency(f.width)) % 1;
    } else f.active = false;
  }

  /**
   * The flame held this frame as a plume, carried out of the hull's frame aboard at the moment it is
   * drawn. A flame not held within the last 100 ms gives nothing: the step that fires and the frame
   * that draws run together, so a held flame is under a millisecond old when asked, and a frame that
   * does not simulate (a menu, the map, a panel, dying) leaves the stamp behind at once, as does
   * travel, whose hull may be gone.
   */
  heatPlumes(sink: HeatPlumeSink, now: number): void {
    const f = this.flame;
    if (!f.active || now - f.stamp > FLAME_STALE_MS) return;
    worldAt.copy(f.at);
    worldAlong.copy(f.along);
    if (f.frame) {
      worldAt.applyMatrix4(f.frame);
      worldAlong.transformDirection(f.frame);
    }
    sink.push(worldAt.x, worldAt.y, worldAt.z, worldAlong.x, worldAlong.y, worldAlong.z, f.range * 1.15, 0.12, f.width, 1.4, f.phase);
  }

  /** Forget the flame (a class switch, leaving a ship): the heat stops and the held effect goes, even if no stream() comes to stop them. */
  coolDown(): void {
    this.flame.active = false;
    this.flame.frame = null;
    this.dropHeldEffect();
    combatSounds.hold(null, 0, 0, 0);
  }

  /** A line held on the nearest thing ahead (lightning): hurt each frame, staggered, and the shock jumps to what stands near it. */
  private beam(ctx: KitContext, mode: FireMode, which: 'primary' | 'alt'): void {
    const { dt, player, effects, world } = ctx;
    // Only one trigger runs a frame, so a flame let go for the lightning is cold at once, not 100 ms later.
    this.flame.active = false;
    this.aim(ctx);
    const cone = mode.cone ?? { range: 25, angle: 8 };
    const room = player.aboard;
    if (room) {
      // Aboard: the line runs to the room's own wall (nothing in the room is a target, and nothing
      // jumps), in the hull's frame, and is drawn and lit where the hull carries it.
      const hit = room.physics.world.castRay(new RAPIER.Ray(muzzle, aimDir), cone.range, true);
      end.copy(muzzle).addScaledVector(aimDir, hit ? hit.timeOfImpact : cone.range);
      const m = room.vehicle.group.matrixWorld;
      worldAt.copy(muzzle).applyMatrix4(m);
      tmp.copy(end).applyMatrix4(m);
      ctx.bolts.beam(worldAt, tmp, mode.color, 0.08, 1);
      this.holdEffect(ctx, mode, which, muzzle, aimDir);
      effects.flash(tmp, mode.color, 12, 8, 0.06);
      player.shotFired();
      return;
    }
    const target = this.targetAhead(ctx, cone.range, Math.cos((cone.angle * Math.PI) / 180));
    if (target) {
      end.copy(target.pos).y += target.halfHeight;
      target.damage(mode.damage * dt, player.pos, 0, world.playerTarget);
      this.afflict(ctx, target, mode);
      if (mode.chain) {
        let other: Hittable | null = null;
        let best = mode.chain.radius;
        for (const c of this.targets(ctx)) {
          if (c === target || c.dead) continue;
          const d = c.pos.distanceTo(target.pos);
          if (d < best) {
            best = d;
            other = c;
          }
        }
        if (other) {
          other.damage(mode.damage * mode.chain.share * dt, player.pos, 0, world.playerTarget);
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

  /**
   * The pack's effect for a held trigger, placed at the muzzle facing `along` and kept there while it
   * lasts. `at` and `along` are aim()'s: in the hull's frame aboard, where the effect is placed with
   * that hull's matrix as its frame, so it stays in the room while the ship flies. Boarding or stepping
   * out with the trigger held places it again in the new frame.
   */
  private holdEffect(ctx: KitContext, mode: FireMode, which: 'primary' | 'alt', at: THREE.Vector3, along: THREE.Vector3): void {
    // The loop the trigger holds, at the muzzle in the world. It is asked for here, before the
    // pack's own effect, so a flame is heard even where the pack has no flame to draw.
    heldAt.copy(at);
    const aboard = ctx.player.aboard;
    if (aboard) heldAt.applyMatrix4(aboard.vehicle.group.matrixWorld);
    combatSounds.hold((mode.effect && HELD_LOOPS[mode.effect]) || null, heldAt.x, heldAt.y, heldAt.z);
    const file = mode.effect ? ctx.weapons?.effect(mode.effect) : null;
    if (!file) return;
    const fxs = ctx.world.weaponFx;
    const frame = ctx.player.aboard ? ctx.player.aboard.vehicle.group.matrixWorld : null;
    // The client's beam effects run along their own Y: stood up, they point where the muzzle does
    // (in the hull's frame aboard, UP being the hull's up).
    placeQ.setFromUnitVectors(UP, along);
    placeM.compose(at, placeQ, ONE);
    const held = this.held;
    if (held && held.which === which && held.owner === fxs && held.fx.frame === frame) fxs.move(held.fx, placeM);
    else {
      this.dropHeldEffect();
      this.held = { fx: fxs.place(file, placeM, false, false, frame), which, owner: fxs };
    }
  }

  /** The trigger is let go (or the gun changed): the flame's heat and the held effect both stop. */
  private stopHeld(_ctx: KitContext): void {
    // The flame first: without a pack effect `held` is null, and the heat must stop all the same.
    this.flame.active = false;
    this.dropHeldEffect();
    // And its loop, which is held whether or not the pack had an effect to draw.
    combatSounds.hold(null, 0, 0, 0);
  }

  private dropHeldEffect(): void {
    if (!this.held) return;
    this.held.owner.remove(this.held.fx);
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

  /** The nearest living creature or fighter within `range` metres and the cone about the aim (`cos` at its edge). */
  private targetAhead(ctx: KitContext, range: number, cos: number): Hittable | null {
    let best: Hittable | null = null;
    let bestD = range;
    for (const c of this.targets(ctx)) {
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

  /**
   * A blast at a point: everything within `radius` metres hurt by up to `damage` and thrown outward,
   * the player too when close; vehicles and turrets by `machines` times as much (the proton grenade);
   * `spec` adds the grenade's burn, freeze or stun to what it reached.
   */
  private blast(ctx: KitContext, at: THREE.Vector3, damage: number, radius: number, mode: FireMode | null, push = 10, color = 0xffa050, spec: GrenadeSpec | null = null): void {
    const { world, effects, player } = ctx;
    effects.ring(at, mode?.color ?? color, radius * 2.5, 0.4);
    effects.burst(at, spec ? color : 0xffc080, radius * 0.6, 0.3);
    effects.flash(at, mode?.color ?? color, 30 + damage * 0.3, radius * 4, 0.25);
    const machines = spec?.machines ?? 1;
    for (const c of this.targets(ctx)) {
      tmp.copy(c.pos).sub(at);
      const d = tmp.length();
      if (d > radius) continue;
      const f = 1 - d / radius;
      c.damage(damage * f + damage * 0.1, at, push * f + 4, world.playerTarget);
      if (mode) this.afflict(ctx, c, mode);
      if (spec) {
        if (spec.dot) c.afflict?.(spec.dot.dps, spec.dot.seconds);
        if (spec.slow) c.slow?.(spec.slow);
        if (spec.stun) c.stun?.(spec.stun);
      }
    }
    for (const t of world.turrets.turrets) {
      const d = t.pos.distanceTo(at);
      if (d <= radius) t.damage((damage * (1 - d / radius) + damage * 0.1) * machines);
    }
    for (const sp of world.vehicles) {
      tmp.copy(sp.pos).sub(at);
      const d = tmp.length();
      if (d > radius * 1.5 || sp === player.mounted || sp === player.aboard?.vehicle) continue;
      const f = 1 - d / (radius * 1.5);
      const m = sp.body.mass();
      tmp.normalize();
      sp.body.applyImpulse({ x: tmp.x * m * 6 * f * machines, y: m * 4 * f * machines, z: tmp.z * m * 6 * f * machines }, true);
      if (machines > 1) sp.damage(damage * f * machines);
    }
    // The loose props: a blast takes every direction, so no cone, and reaches half as far again as
    // it does for a body, exactly as it does for a vehicle above.
    shoveLooseProps(at, radius * 1.5, 1, null, 12 + damage * 0.1);
    const dp = player.pos.distanceTo(at);
    if (dp < radius * 0.7 && !player.mounted) player.takeDamage(damage * 0.35 * (1 - dp / (radius * 0.7)));
    // A blast sets off the charges near it: a chain of mines, a det pack under a grenade.
    for (const other of this.charges) {
      if (other.kind !== 'grenade' && other.mesh.position.distanceTo(at) < radius * 0.8) other.fuse = Math.min(other.fuse, 0.15 + Math.random() * 0.1);
    }
  }

  /** A charge goes off where it is and is gone; a poison or bug cloud may stay. */
  private detonate(ctx: KitContext, c: Charge): void {
    const at = c.mesh.position;
    combatSounds.blast(c.radius, at.x, at.y, at.z, c.spec?.model ?? null);
    this.blast(ctx, at, c.damage, c.radius, c.mode, c.push, c.color, c.spec);
    if (c.spec?.cloud) this.clouds.push({ pos: at.clone(), radius: c.spec.radius * 0.8, spec: c.spec, left: c.spec.cloud, tick: 0 });
    this.removeCharge(ctx, c);
  }

  private removeCharge(ctx: KitContext, c: Charge): void {
    this.scene.remove(c.mesh);
    if (c.laser) this.scene.remove(c.laser.mesh);
    if (c.body) ctx.physics.world.removeRigidBody(c.body);
    const i = this.charges.indexOf(c);
    if (i >= 0) this.charges.splice(i, 1);
  }

  /**
   * Where a throw starts and which way: from the hand, at the point under the crosshair (the
   * camera's own line, from behind and above the body, would throw everything into the ground
   * a few metres out), with a little lift for the arc.
   */
  private throwFrom(ctx: KitContext): void {
    const { player } = ctx;
    this.aim(ctx);
    player.handPosition(from);
    if (from.distanceTo(player.pos) > 1.6) from.copy(player.pos).setY(player.pos.y + 1.4);
    if (player.aboard) from.applyMatrix4(hullInverse);
    dir.copy(end).sub(from);
    if (dir.lengthSq() < 1) dir.copy(aimDir);
    // Lobbed: a level throw arcs up and comes down where it was aimed rather than skidding along the ground.
    dir.normalize().y += 0.3;
    dir.normalize();
    if (player.aboard) {
      // The charge is a world-space body: back into the world (the hull's frame is only for the aim).
      const m = player.aboard.vehicle.group.matrixWorld;
      from.applyMatrix4(m);
      dir.transformDirection(m);
    }
    from.addScaledVector(dir, 0.4);
    this.lastThrow = { from: from.toArray(), dir: dir.toArray(), at: end.toArray() };
  }

  /** The last throw's start, direction and the crosshair point it was aimed at, for the console. */
  private lastThrow: { from: number[]; dir: number[]; at: number[] } | null = null;

  /** A thrown body with its ball collider, moving with the player's own speed. */
  private throwBody(ctx: KitContext, speed: number, bounce: number, upward = 4): RAPIER.RigidBody {
    const { player, physics } = ctx;
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(from.x, from.y, from.z)
        .setLinvel(dir.x * speed + player.vel.x, dir.y * speed + upward, dir.z * speed + player.vel.z)
        .setAngvel({ x: 6, y: 2, z: 4 })
        .setCcdEnabled(true),
    );
    physics.world.createCollider(RAPIER.ColliderDesc.ball(0.14).setMass(0.6).setRestitution(bounce).setFriction(0.7), body);
    return body;
  }

  /** The stand-in charge: a dark ball with a blinking light on top. */
  private ballMesh(scale = 1): { mesh: THREE.Mesh; light: THREE.Object3D } {
    const mesh = new THREE.Mesh(this.detGeo, this.detMat);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), this.detLightMat);
    light.position.y = 0.16;
    mesh.add(light);
    mesh.castShadow = true;
    mesh.scale.setScalar(scale);
    this.scene.add(mesh);
    return { mesh, light };
  }

  /**
   * The rack's model for a grenade, cloned, once it has loaded; the first throw of each kind gets
   * the stand-in ball while the model comes. A model is sized down to a hand's width if it came
   * larger (some are authored at display size).
   */
  private grenadeModel(ctx: KitContext, spec: GrenadeSpec): THREE.Group | null {
    const rack = ctx.weapons;
    if (!rack) return null;
    const have = this.models.get(spec.model);
    if (have && have !== 'loading') return have.clone();
    if (have === 'loading') return null;
    const def = rack.find(spec.model);
    if (!def || def.class !== 'thrown') {
      this.models.set(spec.model, new THREE.Group());
      return null;
    }
    this.models.set(spec.model, 'loading');
    void rack
      .model(def)
      .then((g) => {
        const box = new THREE.Box3().setFromObject(g);
        const size = box.getSize(new THREE.Vector3());
        const longest = Math.max(size.x, size.y, size.z, 0.01);
        const wrap = new THREE.Group();
        // Centred on its box so it tumbles about its middle.
        g.position.sub(box.getCenter(new THREE.Vector3()));
        wrap.add(g);
        if (longest > 0.35) wrap.scale.setScalar(0.3 / longest);
        this.models.set(spec.model, wrap);
      })
      .catch((err) => {
        console.warn(`grenade model ${spec.model} failed`, err);
        this.models.set(spec.model, new THREE.Group());
      });
    return null;
  }

  /** Throw one of the game's grenades: its model from the rack (or the stand-in), an arc that bounces, its fuse. */
  private throwGrenade(ctx: KitContext, spec: GrenadeSpec): void {
    this.throwFrom(ctx);
    const body = this.throwBody(ctx, spec.speed, spec.bounce);
    const model = this.grenadeModel(ctx, spec);
    let mesh: THREE.Object3D;
    let light: THREE.Object3D | null = null;
    if (model && model.children.length) {
      mesh = model;
      mesh.traverse((o) => {
        (o as THREE.Mesh).castShadow = true;
      });
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), this.detLightMat);
      l.position.y = 0.1;
      mesh.add(l);
      light = l;
      this.scene.add(mesh);
    } else {
      const ball = this.ballMesh(0.9);
      mesh = ball.mesh;
      light = ball.light;
    }
    this.charges.push({ kind: 'grenade', mesh, body, fuse: spec.fuse > 0 ? spec.fuse : 30, damage: spec.damage, radius: spec.radius, push: spec.push, color: spec.color, mode: null, spec, light, armedAt: 0 });
    // Armed as it leaves the hand, at the hand: the three grenades the game gives a sound of their
    // own take it and the rest take the plain one.
    combatSounds.grenade(spec.model, 'arm', mesh.position.x, mesh.position.y, mesh.position.z);
    ctx.player.shotFired();
  }

  /** Throw a charge ahead: a ball with a fuse that goes off as a blast (the flechette's mines). */
  private throwMine(ctx: KitContext, speed: number, fuse: number, damage: number, radius: number, mode: FireMode | null): void {
    this.throwFrom(ctx);
    const body = this.throwBody(ctx, speed, mode ? 0.6 : 0.45);
    const ball = this.ballMesh(mode ? 0.7 : 1);
    this.charges.push({ kind: 'grenade', mesh: ball.mesh, body, fuse, damage, radius, push: 10, color: mode?.color ?? 0xffa050, mode, spec: null, light: ball.light, armedAt: 0 });
  }

  /** The surface under the crosshair within `reach` metres of the player (walls, floors, props, hulls; not creatures), with its normal. */
  private surfaceAhead(ctx: KitContext, reach: number): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    const { cam, physics, player, world } = ctx;
    if (player.aboard) return null;
    cam.camera.getWorldDirection(dir);
    from.copy(cam.camera.position);
    end.copy(from).addScaledVector(dir, 60);
    const hit = physics.surfaceHit(from, end, player.body, player.inside, (h) => world.hittableAt(h) !== undefined);
    if (!hit) return null;
    const point = new THREE.Vector3(...hit.point);
    tmp.copy(player.pos).y += 1;
    if (point.distanceTo(tmp) > reach + 0.5) return null;
    return { point, normal: new THREE.Vector3(...hit.normal) };
  }

  /** A trip mine on the surface ahead, its laser out along the surface's normal to whatever it meets. */
  private placeTripMine(ctx: KitContext): boolean {
    const at = this.surfaceAhead(ctx, TRIP_REACH);
    if (!at) {
      this.gunNote = 'a trip mine needs a wall or floor within four metres';
      return false;
    }
    const mesh = new THREE.Mesh(this.mineGeo, this.detMat);
    mesh.position.copy(at.point).addScaledVector(at.normal, 0.03);
    mesh.quaternion.setFromUnitVectors(UP, at.normal);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), this.detLightMat);
    light.position.y = 0.05;
    mesh.add(light);
    mesh.castShadow = true;
    this.scene.add(mesh);
    // The beam: from the mine along its normal to the next surface, or its full reach.
    const start = mesh.position.clone().addScaledVector(at.normal, 0.05);
    const far = start.clone().addScaledVector(at.normal, TRIP_LASER);
    const wall = ctx.physics.surfaceHit(start, far, ctx.player.body, ctx.player.inside, (h) => ctx.world.hittableAt(h) !== undefined);
    const to = wall ? new THREE.Vector3(...wall.point) : far;
    const laser = new THREE.Mesh(this.laserGeo, this.laserMat);
    const len = start.distanceTo(to);
    laser.position.copy(start).lerp(to, 0.5);
    laser.quaternion.setFromUnitVectors(UP, tmp.copy(to).sub(start).normalize());
    laser.scale.set(1, len, 1);
    this.scene.add(laser);
    this.charges.push({ kind: 'trip', mesh, body: null, fuse: 600, damage: TRIP_DAMAGE, radius: TRIP_RADIUS, push: 12, color: 0xff6040, mode: null, spec: null, laser: { from: start, to, mesh: laser }, light: null, armedAt: 0 });
    return true;
  }

  /** A det pack stuck to the surface ahead, or thrown to lie where it lands when nothing is near; the key again sets them off. */
  private placePack(ctx: KitContext): boolean {
    if (this.charges.filter((c) => c.kind === 'pack').length >= MAX_PACKS) {
      this.gunNote = `no more than ${MAX_PACKS} det packs at once`;
      return false;
    }
    const at = this.surfaceAhead(ctx, TRIP_REACH);
    const mesh = new THREE.Mesh(this.packGeo, this.detMat);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), this.detLightMat);
    light.position.y = 0.05;
    mesh.add(light);
    mesh.castShadow = true;
    this.scene.add(mesh);
    let body: RAPIER.RigidBody | null = null;
    if (at) {
      mesh.position.copy(at.point).addScaledVector(at.normal, 0.04);
      mesh.quaternion.setFromUnitVectors(UP, at.normal);
    } else {
      this.throwFrom(ctx);
      body = this.throwBody(ctx, 12, 0.1, 3);
      ctx.player.shotFired();
    }
    this.charges.push({ kind: 'pack', mesh, body, fuse: 600, damage: PACK_DAMAGE, radius: PACK_RADIUS, push: 14, color: 0xffa050, mode: null, spec: null, light, armedAt: 0 });
    return true;
  }

  dispose(): void {
    if (this.proto) this.scene.remove(this.proto);
    for (const c of this.charges) {
      this.scene.remove(c.mesh);
      if (c.laser) this.scene.remove(c.laser.mesh);
    }
    this.charges.length = 0;
    this.clouds.length = 0;
    this.detGeo.dispose();
    this.detMat.dispose();
    this.detLightMat.dispose();
    this.packGeo.dispose();
    this.mineGeo.dispose();
    this.laserGeo.dispose();
    this.laserMat.dispose();
  }
}
