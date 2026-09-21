import * as THREE from 'three';
import { KICK_DAMAGE } from './saber';
import { THROW } from './saberThrow';
import { DEFAULT_LOADOUT, FORCE_FX, SLOT_ACTIONS, SLOT_COUNT, adoptPowerPack, noteForceFx, noteForceFxMissing, powerById, powerEffect, powerVoice, prepareForceEffects, type PowerDef, type PowerPart } from './forcePowers';
import { holdForceBeam, releaseForceBeam } from './forceLightning.ts';
import { sabers } from '../audio/saberSounds.ts';
import type { Hittable, Kit, KitContext, KitSlot, Living, Resource } from './kit';
import { nearestInCone, type ConeQuery } from './targets';
import { BLADE_RADIUS, BladePath, playerStrike, strikeSweep } from './sweep.ts';
import { BrushClock, SABER_HIT, bodyTeleported, brushDamage, noteBrush, saberSwingStart, type HitLedger } from './saberHit.ts';
import { roomFrame } from '../vehicles/surfaceRoom.ts';
import { loosePropAhead, shoveLooseProps } from '../world/looseProps.ts';
import type { BoltFrame } from './bolts';
import type { EffectHandle, ParticleEffects } from '../world/particles';
import { Unarmed } from './unarmed';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
/** Where a held beam goes and where it ends, so the frame that draws one allocates nothing. */
const beamDir = new THREE.Vector3();
const beamEnd = new THREE.Vector3();
/** The one transform, turn, place and direction a placed effect is built from; kept, never made in a frame. */
const fxM = new THREE.Matrix4();
const fxQ = new THREE.Quaternion();
const fxAt = new THREE.Vector3();
const fxDir = new THREE.Vector3();
/** Where a power's effect is asked for, in the world's frame, before it is carried into the hull's. */
const fxWhere = new THREE.Vector3();
const FX_ONE = new THREE.Vector3(1, 1, 1);
/**
 * Whether a placed Force effect is allowed to play the sounds its own emitters name. One kept
 * object written in place, never made in a frame; `FORCE_FX.fxSound` is what moves it, and it is 0,
 * so the power's voice is the sabers' alone and a particle naming the sound its client effect
 * already named is not heard twice.
 */
const FX_PLACE_OPTS = { sound: false };
const fxSpeaks = (): { sound: boolean } => {
  FX_PLACE_OPTS.sound = FORCE_FX.fxSound > 0;
  return FX_PLACE_OPTS;
};
/** The client's particle effects are authored looking down their own +Z, as the guns' own are placed. */
const FX_Z = new THREE.Vector3(0, 0, 1);
/** The spark a blade leaves where it bites, which is the colour every sweep has always thrown. */
const SABER_SPARK = 0x9fd4ff;
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

/**
 * One of the game's own effects held for as long as a power lasts: the handle, the file it draws,
 * the frame it was placed in and the player that made it. A power that ends, a file that changes or
 * a frame that changes (boarding a ship, stepping out of one) takes the old one down and places the
 * new one; while none of those happen the effect is simply moved, so a power held for a minute
 * places one effect and not sixty a second.
 */
class HeldFx {
  handle: EffectHandle | null = null;
  file = '';
  frame: THREE.Matrix4 | null = null;
  owner: ParticleEffects | null = null;
}

export class JediKit implements Kit {
  readonly id = 'jedi' as const;
  readonly name = 'Jedi';
  /**
   * The power in each number slot, by id (null for an empty slot); the HUD's slots follow it. One
   * array for the life of the kit, emptied and filled again by `setLoadout`.
   */
  readonly loadout: (string | null)[] = [];
  /**
   * The slots as the display shows them: one per number key with a power in it. One array, built
   * only when the loadout changes, because the display walks it every frame and a getter that
   * returned a fresh array of fresh objects was building five arrays and sixteen objects a frame.
   */
  readonly slots: KitSlot[] = [];
  /** The power behind each of those slots, in the same order, so neither test below has to search for it by name. */
  private readonly slotPowers: PowerDef[] = [];
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
  /**
   * Where each lit blade was last frame: one per blade the player can have out (the staff's second
   * and the dual style's left-hand saber), kept here rather than at module scope, since the blades
   * belong to whoever holds them.
   */
  private readonly bladePaths: BladePath[] = [new BladePath(), new BladePath()];
  /** Whom a merely lit blade has already brushed, and when, so it takes its tenth four times a second and no more. */
  private readonly brush = new BrushClock();
  /** The hull's frame while aboard, and the way back into it: kept, because they are asked every lit frame. */
  private aboardFrame: BoltFrame | null = null;
  private readonly intoFrame = new THREE.Matrix4();
  /**
   * That same frame as this frame's powers see it, written once at the top of `update`: a power used
   * aboard a ship's rooms places its effect in the hull's frame and it rides the hull, exactly as a
   * bolt fired there does.
   */
  private fxFrame: BoltFrame | null = null;
  /**
   * The standing effects the lasting powers keep: the speed's blur, the shield, the rage's aura, the
   * lightning and the drain at the hand and the choke on what is held. One slot each for the life of
   * the kit, so a power held costs one handle and no allocation a frame.
   */
  private readonly fxSpeed = new HeldFx();
  private readonly fxProtect = new HeldFx();
  private readonly fxRage = new HeldFx();
  private readonly fxLightning = new HeldFx();
  private readonly fxDrain = new HeldFx();
  private readonly fxGrip = new HeldFx();
  /**
   * When a power last threw its `land` effect (`FORCE_FX.hitEvery`), one clock per power that can
   * be landing at the same moment as another. There are two, and they are two because Protect is a
   * toggle: it can be up while Lightning or Drain is held, and on one shared clock the lightning's
   * own landing -- placed four times a second for as long as the key is down -- would keep the
   * clock fresh and the blow the guard absorbed would never draw at all, which is the one thing
   * that shows the guard is doing anything. Lightning and Drain do share theirs, and may: the slot
   * loop makes `drain` false whenever `lightning` is true, so only one of the two is ever held.
   */
  private readonly fxHeldClock = { at: -Infinity };
  private readonly fxGuardClock = { at: -Infinity };
  /** The body's health as it stood last frame: a fall in it while the guard is up is a blow absorbed. */
  private lastHp = Infinity;
  /**
   * Where the body itself stood when a blade was last swept, and when. A body that moved further
   * than `SABER_HIT.carry` could carry it was *put* there -- a lift's pick, a teleport, an arrival
   * -- and every path it holds starts fresh, which is the one case the path's own rules cannot see:
   * a lift puts the player just through a doorway, which is well inside the blade's own `jump`, and
   * a path swept across it would cast the capsule through the wall beside the door.
   */
  private readonly bodyWas = new THREE.Vector3();
  private bodyAt = -Infinity;
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
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.aura = new THREE.Mesh(
      new THREE.SphereGeometry(1.3, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x5fb8ff, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.aura.visible = false;
    scene.add(this.aura);
    // The slots are filled the one way they are ever filled, so the array the display walks exists
    // and agrees with the loadout from the first frame.
    this.setLoadout(DEFAULT_LOADOUT);
  }

  /** Put powers in the slots (ids; unknown ones are dropped), keeping toggles that are no longer there off. */
  setLoadout(ids: (string | null)[]): void {
    this.loadout.length = 0;
    this.slots.length = 0;
    this.slotPowers.length = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const p = ids[i] ? powerById(ids[i]!) : undefined;
      this.loadout.push(p ? ids[i]! : null);
      if (!p) continue;
      this.slots.push({ key: String(i + 1), name: p.name, cost: p.cost });
      this.slotPowers.push(p);
    }
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
    switch (this.slotPowers[i]?.id) {
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
    switch (this.slotPowers[i]?.id) {
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
    // Every lit blade sweeps: the staff's second and the dual style's left-hand saber too. The cast
    // is stepped along the path the blade covered since last frame (`SABER_HIT`), so a swing at a
    // run no longer steps over a thin body between two frames, and a blade that is merely lit still
    // writes its path down, so the first frame of the next swing has somewhere to step from. A lit
    // blade nobody is swinging brushes what it stands in for a tenth of the style's damage, at most
    // four times a second per body, which is `brushShare` and is off at 0; what counts as lit there
    // is the renderers' own answer and not this file's. Aboard, the path, the capsule and the query
    // are all in the hull's frame and in the room's own physics, as a bolt fired aboard is, or the
    // ship's own motion would be part of every swing.
    const bladeFrame = this.frameOf(ctx);
    this.fxFrame = bladeFrame;
    // Which of the game's own effects each power wears, out of the weapons pack. The rack arrives
    // after the world does, so it is asked for here rather than at the kit's making; the pack is
    // read once and the same manifest is never read twice (`adoptPowerPack`).
    //
    // The world's own load prepares every one of those effects behind the loading screen, which is
    // what keeps a power from building a program on the frame it is first used. This is the belt
    // for the one case that cannot reach: a rack that lands *after* the world did, where nothing
    // would otherwise ask for them until a key was pressed. It happens once, off the frame, and a
    // second call over the same files prepares nothing again.
    // The renderer is handed over as well, since the world has one: without it the batches are
    // built but the textures are not uploaded, and this belt exists for exactly the path where that
    // upload would otherwise land on the first frame a power draws.
    if (ctx.weapons && adoptPowerPack(ctx.weapons.manifest)) void prepareForceEffects(ctx.world.weaponFx, ctx.world.renderer, ctx.weapons.manifest);
    const swinging = onFoot && player.saberOn && player.bladeActive;
    const inHand = onFoot && player.saberOn && !player.fists && !player.thrown.inFlight && !player.orbiting;
    if (swinging || inHand) {
      const now = world.simTime;
      saberSwingStart(player.saber.attackId);
      // The body was put where it stands rather than having walked there: nothing it holds swept
      // anything on the way, so every path starts again from here.
      // `pos` and not `worldPos`, because that is the frame the path itself is kept in: aboard a
      // hull at 900 m/s the world place moves kilometres a frame and would call every swing a
      // teleport, while in the hull's frame the body is standing still, which it is.
      if (bodyTeleported(this.bodyWas.distanceTo(player.pos), now - this.bodyAt)) for (const path of this.bladePaths) path.reset();
      this.bodyWas.copy(player.pos);
      this.bodyAt = now;
      for (let i = 0; i < player.bladeCount; i++) {
        player.bladeSegmentAt(i, a, b);
        if (bladeFrame) {
          a.applyMatrix4(this.intoFrame);
          b.applyMatrix4(this.intoFrame);
        }
        const path = this.bladePaths[i];
        if (swinging) this.sweep(ctx, a, b, BLADE_RADIUS, player.saberDamage, this.hitThisSwing, 5, path, now, bladeFrame);
        else path.mark(a, b, now);
      }
      // The brush, from the renderers and from nowhere else: `SaberBlade.glowing` is the one thing
      // that knows a blade is really drawn and out, so a sword or a polearm from the rack (which
      // `bladeSegmentAt` answers for, on purpose, so its swing lands) brushes nobody, and a blade
      // part-way through its ignition brushes with only the part that is out. One cast where the
      // blade is drawn, never a stepped path: this is what standing *in* a blade costs.
      if (!swinging && inHand && SABER_HIT.brushShare > 0) {
        this.brush.begin(now);
        let brushed = 0;
        for (const blade of player.saberBlades) {
          if (!blade.glowing) continue;
          a.copy(blade.drawnBase);
          b.copy(blade.drawnTip);
          if (bladeFrame) {
            a.applyMatrix4(this.intoFrame);
            b.applyMatrix4(this.intoFrame);
          }
          brushed += this.sweep(ctx, a, b, SABER_HIT.brushRadius, brushDamage(player.saberDamage), this.brush, SABER_HIT.brushPush, null, now, bladeFrame);
        }
        noteBrush(brushed, now, this.brush.declined);
      }
    } else {
      for (const path of this.bladePaths) path.reset();
      this.bodyAt = -Infinity;
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
            // The archives have no jump effect at all -- its client effect names a sound and no
            // particle -- so the ring and the flash are ours and are exactly what they always were.
            // `worldPos` and not `pos`: the ring pool draws in the world's frame, and aboard a
            // ship's rooms `pos` is the hull's, which would put the ring wherever the hull's own
            // coordinates happen to land in the world -- metres to kilometres off.
            effects.ring(player.worldPos, 0x9fd4ff, 5, 0.5);
            sabers.power(powerVoice(powerById(id)), 'once');
          }
          break;
        case 'speed':
          if (pressed) {
            if (this.speedActive) this.speedActive = false;
            else if (res.value >= 10) {
              this.speedActive = true;
              // The game's own effect as it comes on; the one that runs while it lasts is held below.
              this.fireFx(ctx, id, powerEffect(id)?.cast);
            }
          }
          break;
        case 'push':
          if (onFoot && pressed && res.value >= 25) {
            res.value -= 25;
            this.shove(ctx, 1);
            sabers.power(powerVoice(powerById(id)), 'once');
          }
          break;
        case 'pull':
          if (onFoot && pressed && res.value >= 20 && this.pullCd <= 0) {
            res.value -= 20;
            this.pullCd = 1.5;
            this.shove(ctx, -1);
            // The game's own throw, looking where the pull does. Its row puts it on what it
            // reached, and a pull reaches everything ahead rather than one body, so it stands at
            // the hand: `partPoint`'s own answer when there is nothing to put it on.
            cam.forward(tmp);
            this.fireFx(ctx, id, powerEffect(id)?.cast, null, tmp);
            sabers.power(powerVoice(powerById(id)), 'once');
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
            sabers.power(powerVoice(powerById(id)), 'once');
          }
          break;
        case 'slow':
          if (onFoot && pressed && res.value >= 25 && this.slowCd <= 0) {
            const target = this.targetAhead(ctx, 24, 0.5, CAN_SLOW);
            if (target) {
              res.value -= 25;
              this.slowCd = 5;
              target.slow?.(5);
              // The tangle names a sound and no particle, so the ring and the flash are ours and
              // are what they always were.
              tmp.copy(target.pos).y += target.halfHeight;
              effects.ring(tmp, 0xc0a0ff, 3, 0.6);
              effects.flash(tmp, 0xc0a0ff, 12, 8, 0.3);
              sabers.power(powerVoice(powerById(id)), 'once', tmp);
            }
          }
          break;
        case 'heal':
          if (pressed && res.value >= 30 && this.healCd <= 0 && player.hp < player.maxHp) {
            res.value -= 30;
            this.healCd = 6;
            player.heal(35);
            // The ring is drawn in the world's frame, so it takes `worldPos` (heal has no `onFoot`
            // guard and is reachable aboard a ship's rooms, where `pos` is the hull's frame).
            effects.ring(player.worldPos, 0x9fffb0, 3, 0.6);
            // The game's own heal, on the body: the one pairing its own client effect settles.
            this.fireFx(ctx, id, powerEffect(id)?.cast);
            sabers.power(powerVoice(powerById(id)), 'once');
          }
          break;
        case 'protect':
          if (pressed) {
            if (this.protectActive) this.protectActive = false;
            else if (res.value >= 15) {
              this.protectActive = true;
              // The absorb's trigger, on oneself, as the guard comes up; what the client draws
              // where a blow lands is its `land` part and is placed below, when one does.
              this.fireFx(ctx, id, powerEffect(id)?.cast);
            }
          }
          break;
        case 'rage':
          if (pressed && this.rageLeft <= 0 && this.rageRest <= 0 && player.hp > 25) {
            this.rageLeft = RAGE_TIME;
            effects.ring(player.worldPos, 0xff4040, 4, 0.5);
            // The game never had a rage, so whatever the pack put on it is ours and says so.
            this.fireFx(ctx, id, powerEffect(id)?.cast);
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
      // The aura hangs in the world's scene, so it is placed in the world's frame: aboard a ship's
      // rooms `pos` is the hull's and `onFoot` is still true (it means unmounted, not off a ship).
      this.aura.position.copy(player.worldPos).y += 1;
      const s = 1 + Math.sin(this.time * 9) * 0.08;
      this.aura.scale.set(s, s * 1.3, s);
    }
    // The game's own effects for the three powers that are kept on: each stands on the body while
    // its power lasts and is taken down the moment it stops. `holdFx` moves the effect it already
    // has rather than placing another, so a toggle left on for a minute places one and not sixty a
    // second; a power whose row the pack has not got holds nothing and looks as it always did.
    this.holdFx(ctx, 'speed', this.fxSpeed, this.speedActive && onFoot);
    this.holdFx(ctx, 'protect', this.fxProtect, this.protectActive && onFoot);
    this.holdFx(ctx, 'rage', this.fxRage, raging && onFoot);
    // What the client draws where a blow is absorbed. Nothing tells the kit that the player was
    // hurt, so the body's own health falling while the guard is up is what says so -- on a clock of
    // its own, so a burst of fire is one effect and not twelve, and so that lightning held in the
    // same moment (which lands four times a second of its own) cannot swallow it.
    if (this.protectActive && onFoot && player.hp < this.lastHp) this.landFx(ctx, 'protect', null, world.simTime, this.fxGuardClock);
    this.lastHp = player.hp;

    // Lightning and Drain: a bolt at the nearest creature ahead, hurting it while the key is down;
    // the drain gives what it takes back to the player.
    this.lightningActive = lightning;
    this.drainActive = drain;
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
      // The beam is the world's own pool (`forceLightning.ts`), built and compiled behind the
      // loading screen, so nothing is made on the frame the key goes down. Its near end borrows
      // one pooled flash light on its own clock and its far end, given nothing struck, is a wall
      // or the ground the pool finds by a ray of its own -- a beam never ends in the air.
      //
      // The frame is `fxFrame`, which is what every other effect in this file is placed with and
      // is null on foot; `aboardFrame` is the kept struct behind it and is never cleared when the
      // player steps off, so a beam given that would be drawn and cast in the last hull the player
      // stood in. And everything handed to the pool must be in that one frame, exactly as
      // `fxTransform` does for the powers' particles: aboard, `player.pos` already is the hull's,
      // the camera's forward and a target's place are the world's and are carried in.
      //
      // Where the bolt leaves the hand is the very point a power's own effect at the hand is placed
      // at, so the two are one number apiece and `__debug.powers({ handUp: 1.2 })` moves both.
      const beamFrame = this.fxFrame;
      beamDir.copy(tmp);
      if (beamFrame) beamDir.transformDirection(this.intoFrame);
      const start = tmp2.copy(player.pos).addScaledVector(beamDir, FORCE_FX.handAhead);
      start.y += FORCE_FX.handUp;
      let beamTo: THREE.Vector3 | null = null;
      if (target) {
        beamTo = beamEnd.copy(target.pos).setY(target.pos.y + target.halfHeight);
        if (beamFrame) beamTo.applyMatrix4(this.intoFrame);
      }
      holdForceBeam({
        owner: this,
        style: drain ? 'drain' : 'lightning',
        from: start,
        dir: beamDir,
        reach: 26,
        to: beamTo,
        frame: beamFrame,
        exclude: player.body,
      });
      // The game's own effects for a power that is held: what the row holds while the key is down
      // (the weaken on what is being drained), and what it plays where the power lands, on its own
      // clock. What the power's *beam* plays at its two ends is the beam pool's and is never placed
      // here (`viaBeam`), or the lightning's start would stand at the hand twice.
      const held = drain ? 'drain' : 'lightning';
      this.holdFx(ctx, held, drain ? this.fxDrain : this.fxLightning, true, target);
      if (target) this.landFx(ctx, held, target, world.simTime, this.fxHeldClock);
    } else releaseForceBeam(this);
    // Either key let go, or the other one taken up: the hand's effect goes with it.
    if (!lightning) this.dropFx(this.fxLightning);
    if (!drain) this.dropFx(this.fxDrain);

    // Grip: whatever is under the crosshair lifted and held ahead, choking; let go and it is thrown.
    if (grip) {
      // A body first, and a loose prop when there is none: a prop is deliberately not in
      // `targets()`, which `targetAhead` reads, so it is asked for by name. Same reach, same cone.
      // The camera's forward is read before the choice rather than after it, since the cone is what
      // picks the prop; and a prop is looked for only out in the world, never from inside a hull's
      // rooms, where `pos` is the hull's frame and the props are still standing on the planet.
      cam.forward(tmp);
      if (!this.gripped || this.gripped.dead) this.gripped = this.targetAhead(ctx, 14, 0.7, CAN_HOLD) ?? (player.aboard ? null : loosePropAhead(player.worldPos, tmp, 14, 0.7));
      const g = this.gripped;
      if (g) {
        res.value -= 12 * dt;
        tmp2.copy(player.pos).addScaledVector(tmp, 3.2 + g.halfHeight);
        tmp2.y = player.pos.y + 1.6 + g.halfHeight;
        g.holdAt?.(tmp2, dt);
        g.damage(6 * dt, player.pos, 0, world.playerTarget);
        tmp2.copy(g.pos).y += g.halfHeight;
        ctx.effects.flash(tmp2, 0xc0b0ff, 4, 5, 0.08);
        // The choke, on the body being choked: the client's own effect for this power, and it
        // follows what is held rather than being placed again as it struggles.
        this.holdFx(ctx, 'grip', this.fxGrip, true, g);
      } else this.dropFx(this.fxGrip);
    } else if (this.gripped) {
      cam.forward(tmp);
      this.gripped.release?.(tmp, 18);
      this.gripped = null;
      this.dropFx(this.fxGrip);
    }

    // What the powers that last sound like while they last. Each is asked every frame and speaks
    // only when it changes: one sound as it comes on, a loop that follows the player, one as it
    // goes -- whether it was switched off, ran the Force out or simply ended. The grip speaks only
    // once it has hold of something, which is the moment the choking starts.
    sabers.holdPower(powerVoice(KEPT_POWERS.speed), this.speedActive);
    sabers.holdPower(powerVoice(KEPT_POWERS.protect), this.protectActive);
    sabers.holdPower(powerVoice(KEPT_POWERS.rage), raging);
    sabers.holdPower(powerVoice(HELD_POWERS.lightning), lightning);
    sabers.holdPower(powerVoice(HELD_POWERS.drain), drain);
    sabers.holdPower(powerVoice(HELD_POWERS.grip), grip && !!this.gripped);
    res.value = Math.min(res.max, Math.max(0, res.value + 9 * dt));
  }

  // ---- where a power's own effect goes ----
  //
  // Every point handed to `fireFx` and `holdFx` below is in the **world's** frame, and the placing
  // is what carries it into the hull's while the player is aboard a ship's rooms -- so a power used
  // in there rides the hull, exactly as a bolt fired there does, and one used on a planet is placed
  // in the world with no frame at all. That is why the body's place here is `worldPos` and not
  // `pos`: aboard, `pos` is already in the hull's frame and would be carried into it twice.

  /** On the body itself: the heal's rise, the speed's blur, the shield, the rage's aura. */
  private selfPoint(ctx: KitContext): THREE.Vector3 {
    return fxWhere.copy(ctx.player.worldPos).setY(ctx.player.worldPos.y + FORCE_FX.selfUp);
  }

  /** At the hand, a little ahead of the body along the view: where a held power leaves it. */
  private handPoint(ctx: KitContext): THREE.Vector3 {
    ctx.cam.forward(fxDir);
    fxWhere.copy(ctx.player.worldPos).addScaledVector(fxDir, FORCE_FX.handAhead);
    fxWhere.y += FORCE_FX.handUp;
    return fxWhere;
  }

  /** On what the power reached, up its own height (`targetShare` of it). */
  private targetPoint(target: Living): THREE.Vector3 {
    return fxWhere.copy(target.pos).setY(target.pos.y + target.halfHeight * FORCE_FX.targetShare);
  }

  /**
   * Where one of a power's own parts goes: the pack's row says which of the three places it is, and
   * a part put on what it reached with nothing to reach (a push that threw a roomful, a pull with
   * nobody in front of it) falls back to the hand, which is where the power came from.
   */
  private partPoint(ctx: KitContext, part: PowerPart, target: Living | null): THREE.Vector3 {
    if (part.place === 'target') return target ? this.targetPoint(target) : this.handPoint(ctx);
    if (part.place === 'hand') return this.handPoint(ctx);
    return this.selfPoint(ctx);
  }

  /**
   * One of the game's own effects placed once and left to play itself out (`transient`, which the
   * effects player ends after one run however long the client's own effect loops for): the `cast`
   * part as a power fires, the `land` part where it arrives. A power the pack has no such part for
   * places nothing at all and looks exactly as it did before the Force had effects, which is the
   * whole of the fallback -- the rings and the flashes beside these calls are untouched.
   *
   * It is placed silent (`FORCE_FX.fxSound` 0). The power's voice is the sabers', which already
   * play the sound the client effect named, and a `pt_force_*` emitter that names that same sound
   * -- which is exactly what a `.cef` pairing a particle with a sound makes likely -- would be
   * heard twice over, once from each side. `{ fxSound: 1 }` lets the effect speak as well, which is
   * how to hear whether a particle carries anything its `.cef` never named.
   */
  private fireFx(ctx: KitContext, id: string, part: PowerPart | null | undefined, target: Living | null = null, dir: THREE.Vector3 | null = null): void {
    if (!(FORCE_FX.on > 0)) return;
    if (!part) {
      noteForceFxMissing();
      return;
    }
    const fxs = ctx.world.weaponFx;
    this.fxTransform(this.partPoint(ctx, part, target), dir);
    fxs.place(part.file, fxM, false, true, this.fxFrame ? this.fxFrame.matrix : null, false, fxSpeaks());
    noteForceFx(id, part.file);
  }

  /**
   * The `hold` part, the effect a lasting power keeps while it lasts. The one it already has is
   * moved rather than placed again; it is taken down and placed afresh only when the file or the
   * frame changes, and dropped outright when the power ends.
   */
  private holdFx(ctx: KitContext, id: string, slot: HeldFx, on: boolean, target: Living | null = null): void {
    const part = on && FORCE_FX.on > 0 ? powerEffect(id)?.hold : null;
    if (!part) {
      this.dropFx(slot);
      return;
    }
    const fxs = ctx.world.weaponFx;
    const frame = this.fxFrame ? this.fxFrame.matrix : null;
    this.fxTransform(this.partPoint(ctx, part, target), null);
    if (slot.handle && slot.owner === fxs && slot.file === part.file && slot.frame === frame) {
      fxs.move(slot.handle, fxM);
      return;
    }
    this.dropFx(slot);
    // Silent for the same reason a fired one is: the power's own loop is the sabers' (`holdPower`),
    // and an emitter that names it too would be heard twice for as long as the power lasts.
    slot.handle = fxs.place(part.file, fxM, false, false, frame, false, fxSpeaks());
    slot.file = part.file;
    slot.frame = frame;
    slot.owner = fxs;
    noteForceFx(id, part.file);
  }

  /**
   * The `land` part, where a power that is held arrives: placed no oftener than `FORCE_FX.hitEvery`,
   * since a fresh effect on every frame of a held key is sixty a second. The clock is handed in
   * rather than being one field for all of them: two powers can be landing in the same window (the
   * guard is a toggle and stands while lightning is held), and on one clock the oftener of the two
   * would silently swallow the other.
   */
  private landFx(ctx: KitContext, id: string, target: Living | null, now: number, clock: { at: number }): void {
    const part = powerEffect(id)?.land;
    if (!part || now - clock.at < FORCE_FX.hitEvery) return;
    clock.at = now;
    this.fireFx(ctx, id, part, target);
  }

  /** A held effect taken down (the power ended, the kit is going, the world was left). */
  private dropFx(slot: HeldFx): void {
    if (slot.handle && slot.owner) slot.owner.remove(slot.handle);
    slot.handle = null;
    slot.file = '';
    slot.frame = null;
    slot.owner = null;
  }

  /** Every held effect taken down at once. */
  private dropAllFx(): void {
    for (const slot of [this.fxSpeed, this.fxProtect, this.fxRage, this.fxLightning, this.fxDrain, this.fxGrip]) this.dropFx(slot);
  }

  /**
   * `fxM`, the transform an effect is placed with: the point and, where the power has a direction,
   * the turn that looks along it. Both are carried into the hull's frame while aboard.
   */
  private fxTransform(at: THREE.Vector3, dir: THREE.Vector3 | null): void {
    fxAt.copy(at);
    if (this.fxFrame) fxAt.applyMatrix4(this.intoFrame);
    if (dir) {
      fxDir.copy(dir);
      if (this.fxFrame) fxDir.transformDirection(this.intoFrame);
      const len = fxDir.length();
      if (len > 1e-6) fxQ.setFromUnitVectors(FX_Z, fxDir.divideScalar(len));
      else fxQ.identity();
    } else fxQ.identity();
    fxM.compose(fxAt, fxQ, FX_ONE);
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
    // Drawn in the world's frame, so `worldPos`: the archives have no push effect at all and this
    // ring is the whole of its look. What the shove itself is measured from is left as it was --
    // `pos` against the targets' own places -- since that is a question of its own and not this
    // wave's.
    effects.ring(player.worldPos, sign > 0 ? 0xbfe0ff : 0xffd0a0, 12, 0.45);
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
    // The loose props (src/world/looseProps.ts). They are not in `targets()` -- nothing should ever
    // pick a fight with a crate -- so a power that wants one asks for it by name. `tmp` is the
    // camera's forward, which is the same cone the bodies above are chosen with. It is measured from
    // `worldPos` and not `pos`, because a prop only ever stands in the world's own frame.
    shoveLooseProps(player.worldPos, 16, sign, tmp, sign > 0 ? 18 : 10);
  }

  /** Repulse: a blast in every direction from the player. */
  private repulse(ctx: KitContext): void {
    const { player, world, effects } = ctx;
    // The same: the repulse has no effect in the archives either, so the ring, the burst and the
    // flash are its whole look and are placed in the frame they are drawn in.
    effects.ring(player.worldPos, 0xbfe0ff, 18, 0.5);
    effects.burst(tmp.copy(player.worldPos).setY(player.worldPos.y + 1), 0xdfefff, 3, 0.3);
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
    // Every loose prop within reach, in every direction: no cone, as the bodies above take none.
    shoveLooseProps(player.worldPos, 10, 1, null, 20);
  }

  /**
   * Hurt every creature a capsule between two points touches, each once per `already` (the damage
   * is the style's, with the rage already in it). With a `path`, the capsule is stepped along
   * everything the blade covered since last frame rather than cast at its two ends alone, and with
   * a `frame` all of it -- the path, the capsule and the query -- is in the hull's frame while the
   * blow is heard out in the world. Returns how many bodies were caught.
   */
  private sweep(ctx: KitContext, from: THREE.Vector3, to: THREE.Vector3, radius: number, damage: number, already: HitLedger, push = 5, path: BladePath | null = null, now = 0, frame: BoltFrame | null = null): number {
    const who = playerStrike(ctx, frame, radius, damage, push, SABER_SPARK, now);
    const hit = path ? path.sweep(who, from, to, already) : strikeSweep(who, from, to, already);
    // The blade met a body. One sound however many it caught, at the middle of what it swept, and
    // never again for the same body in the same swing: `already` is what makes that true.
    if (hit > 0) {
      tmp2.copy(from).lerp(to, 0.5);
      // Aboard, the swing was measured in the hull's frame and the ear is out in the world.
      if (frame) tmp2.applyMatrix4(frame.matrix);
      sabers.contact('body', tmp2);
    }
    return hit;
  }

  /**
   * The frame a blade swings in: the hull's while aboard (the room's own physics with it, as a
   * bolt fired aboard has), else none. One kept struct and one kept inverse, since this is asked
   * on every frame a blade is lit.
   */
  private frameOf(ctx: KitContext): BoltFrame | null {
    const room = ctx.player.aboard;
    if (!room) return null;
    const matrix = roomFrame(room);
    if (this.aboardFrame) {
      this.aboardFrame.matrix = matrix;
      this.aboardFrame.physics = room.physics;
    } else this.aboardFrame = { matrix, physics: room.physics };
    this.intoFrame.copy(matrix).invert();
    return this.aboardFrame;
  }

  dispose(): void {
    // The kit is going (a change of class, a new character, the select screen): anything a power
    // was holding open goes with it, since nothing else will ever be told to end it.
    sabers.stopPowers();
    sabers.follow(null);
    // And the beam, if one was being held: the pool's own step lets go of anything that merely
    // stops asking (a Jedi who dies, or one whose panel takes the screen), but a kit that is going
    // will never be stepped again.
    releaseForceBeam(this);
    // And anything a lasting power was drawing: the effects player lives for the session, so a
    // standing effect nobody took down would go on playing where the kit last stood.
    this.dropAllFx();
    // The brush's ring holds the bodies it last touched; nothing else will ever let go of them.
    this.brush.clear();
    for (const path of this.bladePaths) path.reset();
    this.bodyAt = -Infinity;
    this.scene.remove(this.aura);
    this.aura.geometry.dispose();
    this.aura.material.dispose();
  }
}
