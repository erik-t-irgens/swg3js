// Fighters: humanoid NPCs stood on demand to fight the player and each other. Each is a character
// rig of a random species with a random look, a weapon off the rack (a lightsaber, a sword or a
// gun) in its hand, and a body the blades and bolts can hurt. The mind is small: the nearest foe
// within reach is the target, it runs to its weapon's range, and it swings or shoots on a timer.
// A first pass: no cover, no dodging, the ground read from the terrain only. Its clothes come off
// its species' wardrobe (a Wookiee's from the Wookiee pieces alone).
import * as THREE from 'three';
import { Group, groups, RAPIER, type Physics } from '../core/physics';
import { CharacterRig, loadPlayerRig } from '../player/rig';
import { applyLook } from '../player/look';
import { FIGHTS, isSaber, type WeaponCatalogue, type WeaponDef } from '../player/weapons';
import { SaberBlade } from '../combat/saberBlade';
import { keepNearestGlow } from '../combat/bladeLights';
import { Ragdoll } from '../combat/ragdoll';
import { GUNS, gunTypeFor, type GunProfile } from '../combat/guns';
import type { Bolts } from '../combat/bolts';
import type { Effects } from '../combat/effects';
import { nextLivingKey, type Aggression, type Living, type Side } from '../combat/kit';
import { hostileSides } from '../combat/targets';
import type { Terrain } from './terrain';
import { markActor } from './portalRender';
import { slotOf } from '../ui/wardrobeUi';
import type { CellState } from './layoutStream';
import { SABER_SWINGS } from './mobiles/arms';

/** What a fighter carries, and so how it fights. */
type Arm = 'saber' | 'melee' | 'gun';

/** Jedi Academy's one-hand swings (the same list a lightsaber-armed person from the catalogue swings). */
const SWINGS = SABER_SWINGS;
const SPECIES_FALLBACK = ['human_male', 'human_female', 'twilek_male', 'twilek_female', 'zabrak_male', 'zabrak_female', 'rodian_male', 'bothan_male', 'trandoshan_male', 'moncal_female', 'sullustan_male', 'wookiee_male'];
const RUN_SPEED = 5.2;
const SIGHT = 45;
const HP = 160;

/** The wearables a Wookiee wears, and nobody else: the Kashyyykian pieces, and the ones marked _wke. */
const WOOKIEE_ONLY = /kashyyyk|(^|_)wke(_|$)/i;
/** Pieces that are not clothes to be seen in: quest props, the new-player set. */
const NOT_STREET = /_quest$|_npe$|_noob$|prison|slave/i;

/**
 * An outfit for a fighter off its species' wardrobe: something on the chest, the legs and the
 * feet always, a hat, gloves or a back piece now and then, each a random piece of the slot for
 * the species' gender. A Wookiee wears only the pieces made for Wookiees, and no one else wears those.
 */
export function pickOutfit(items: { id: string; kind: string; gender: string }[], species: string): string[] {
  const wookiee = /^wookiee/i.test(species);
  const gender = /female/.test(species) ? 'f' : 'm';
  const pool = items.filter((i) => i.kind !== 'hair' && i.gender === gender && WOOKIEE_ONLY.test(i.id) === wookiee && !NOT_STREET.test(i.id));
  const bySlot = new Map<string, string[]>();
  for (const i of pool) (bySlot.get(slotOf(i.id)) ?? bySlot.set(slotOf(i.id), []).get(slotOf(i.id))!).push(i.id);
  const pick = (slot: string, chance: number) => {
    const list = bySlot.get(slot);
    if (!list?.length || Math.random() > chance) return null;
    return list[Math.floor(Math.random() * list.length)];
  };
  return [pick('chest', 1), pick('legs', 1), pick('feet', 1), pick('head', 0.3), pick('hands', 0.3), pick('back', 0.2), pick('waist', 0.4)].filter((s): s is string => !!s);
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
/** What a blade faces while no camera is given (a dead fighter's retracting blade, a headless step). */
const IDLE_CAMERA = new THREE.PerspectiveCamera();
const spot = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const tmpQ = new THREE.Quaternion();

/** A fighter's lit blade wanting a pooled light this frame: where, in its colour, and how far from the eye (squared). */
export interface FighterGlow {
  readonly pos: THREE.Vector3;
  color: number;
  d2: number;
}

export interface NpcDeps {
  weapons: WeaponCatalogue | null;
  effects: Effects | null;
  /** The species the character packs hold, by id; the fallback list when none is known. */
  species: string[];
  /** Compile an object's shaders in the background, resolving when it can be drawn without a stall. */
  compile?: (objects: THREE.Object3D[]) => Promise<void>;
  /** The room a fighter put down inside a building starts in. */
  cellAt?: (p: THREE.Vector3) => CellState | null;
  /** Follow a body through a building's portals, as the player is followed. */
  followCell?: (state: CellState | null, prev: THREE.Vector3, pos: THREE.Vector3) => CellState | null;
}

/** How often (seconds of sim time) a fighter's room is followed, and how far it may go between. */
const FOLLOW_EVERY = 0.25;
const FOLLOW_STEP = 2;
/** How far above its feet a fighter's floor ray starts inside: a stair's step, and less than a counter. */
const FLOOR_STEP = 0.5;
/** A floor inside a building: neither the terrain under it nor the building's outer shell. */
const INSIDE_FILTER = groups(Group.all, Group.all & ~(Group.terrain | Group.exterior));
/** Only what stands still is a floor. */
const staticOnly = (c: RAPIER.Collider): boolean => {
  const body = c.parent();
  return !body || body.isFixed();
};

export class Npc implements Living {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly halfHeight = 0.9;
  /** Its place in the one list of living things, for as long as it lives. */
  readonly key = nextLivingKey();
  readonly side: Side = 'fighter';
  readonly aggression: Aggression = 'aggressive';
  /** Standing on the ground: a fighter is, except while the Force has it off it. */
  grounded = true;
  hp = HP;
  dead = false;
  deadTimer = 0;
  heading = Math.random() * Math.PI * 2;
  rig: CharacterRig | null = null;
  arm: Arm = 'saber';
  weapon: WeaponDef | null = null;
  gun: GunProfile | null = null;
  /** The pieces it dressed in, by catalogue id. */
  outfit: string[] = [];
  private holder: THREE.Group | null = null;
  private hiltTop = 0.13;
  private blade: SaberBlade | null = null;
  /**
   * This fighter's blade emitter and full-length tip this frame, world space. Each fighter keeps
   * its own: they were once shared by every fighter, and every glow sat at the last one's blade.
   */
  private readonly bladeBase = new THREE.Vector3();
  private readonly bladeTip = new THREE.Vector3();
  readonly color = new THREE.Color().setHSL(Math.random(), 0.9, 0.55);
  private target: Living | null = null;
  private retarget = 0;
  private attackCd = 1 + Math.random();
  /** A swing under way: seconds until its blade lands. */
  private hitIn = -1;
  private stunned = 0;
  private slowed = 0;
  private dotDps = 0;
  private dotLeft = 0;
  private readonly push = new THREE.Vector3();
  private moving = false;
  readonly name: string;
  /** The building room it is in, followed through the portals by the manager; null outside. */
  cell: CellState | null = null;
  /** Where it stood when its room was last followed, and when (sim time). */
  readonly cellFrom = new THREE.Vector3();
  followAt = -Infinity;

  constructor(readonly species: string, private readonly physics: Physics, x: number, y: number, z: number) {
    this.name = `${species.replace(/_/g, ' ')} fighter`;
    this.pos.set(x, y, z);
    this.group.position.copy(this.pos);
    markActor(this.group);
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + this.halfHeight, z));
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(this.halfHeight - 0.35, 0.35), this.body);
  }

  /** What to call it in the console and on a target reticle. */
  get label(): string {
    return this.name;
  }

  /** A person is a circle from above: the capsule's own radius, whichever way you come at it. */
  radiusToward(): number {
    return 0.35;
  }

  /** Where the world's simulated clock stood at this fighter's last step: the hold's grace keys off it. */
  private now = 0;
  /** Where the Force is holding it, and until when (seconds of that clock); null when free. */
  private heldAt: THREE.Vector3 | null = null;
  private heldUntil = 0;
  /**
   * Vertical speed while it is in the air after a throw or a knock; NaN while it is on the ground.
   * Without it the ground clamp in `update` would drag a gripped fighter back down every frame
   * and a thrown one would slide along the ground, so the powers would appear to do nothing.
   */
  private fallVy = Number.NaN;

  /** Hold it at a point in the air this frame (the Force grip). */
  holdAt(point: THREE.Vector3, dt: number): void {
    if (this.dead) return;
    (this.heldAt ??= new THREE.Vector3()).copy(point);
    // A frame or two of grace, as the creatures use: the power sets this every frame it is held.
    this.heldUntil = this.now + Math.max(0.05, dt * 3);
    this.fallVy = 0;
    this.grounded = false;
    // Stunned while it hangs, as a held creature is: without it the chase step below keeps running
    // and walks the body out of the hold while the lerp drags it back, which reads as a shiver.
    this.stunned = Math.max(this.stunned, 0.3);
  }

  /** Let it go, thrown along `dir`: the push carries it out and the fall brings it down. */
  release(dir: THREE.Vector3, power: number): void {
    this.heldAt = null;
    this.push.addScaledVector(dir, power);
    this.fallVy = Math.max(this.fallVy || 0, power * 0.35);
  }

  /** The rig of its species with a random look, and its weapon in hand; the placeholder is nothing meanwhile. */
  async dress(baseUrl: string, deps: NpcDeps): Promise<void> {
    let rig: CharacterRig | null = null;
    for (const id of [this.species, 'human_male']) {
      try {
        rig = await loadPlayerRig(baseUrl, id);
        break;
      } catch {
        rig = null;
      }
    }
    if (!rig || this.dead) return;
    rig.root.scale.setScalar(rig.scale);
    // Hidden until its clothes are on and their shaders compiled, so the first sight of it is not a stall.
    rig.root.visible = false;
    this.group.add(rig.root);
    markActor(rig.root);
    this.rig = rig;
    rig.setState('idle');
    // A random look: the height, and every colour and choice the pack lets vary, thrown; and
    // clothes off the species' wardrobe.
    const c = rig.character;
    if (c) {
      const values: Record<string, number> = {};
      for (const [name] of Object.entries(c.variableValues())) if (c.canCustomize(name)) values[name] = Math.floor(Math.random() * 12);
      let outfit: string[] = [];
      try {
        outfit = pickOutfit((await c.catalogue(baseUrl)).items, this.species);
      } catch {
        outfit = [];
      }
      this.outfit = outfit;
      try {
        await applyLook(c, { morphs: {}, values, height: 0.25 + Math.random() * 0.5, outfit }, baseUrl);
      } catch {
        // A look that will not go on is no loss.
      }
    }
    await this.armUp(deps);
    if (this.dead || !this.rig) return;
    rig.root.updateMatrixWorld(true);
    if (deps.compile) await deps.compile([rig.root]);
    rig.root.visible = true;
  }

  /** A weapon off the rack: a lightsaber most often, else a sword or a gun, hung on the hand as the game hangs it. */
  private async armUp(deps: NpcDeps): Promise<void> {
    const rig = this.rig;
    const cat = deps.weapons;
    if (!rig || !cat) return;
    const r = Math.random();
    const pool = cat.weapons.filter((w) => (r < 0.5 ? w.class === 'lightsaber' : r < 0.7 ? w.class === 'sword1h' || w.class === 'sword2h' || w.class === 'polearm' : FIGHTS[w.class] === 'gun') && !/_static$|_npe$|_noob$/.test(w.id));
    const def = pool[Math.floor(Math.random() * pool.length)];
    if (!def) return;
    const hand = rig.boneFor('rightHand');
    if (!hand) return;
    let model: THREE.Group;
    try {
      model = await cat.model(def);
    } catch {
      return;
    }
    if (this.dead || !this.rig) return;
    const holder = new THREE.Group();
    holder.name = `npc weapon:${def.id}`;
    holder.add(model);
    holder.scale.setScalar(1 / Math.max(hand.getWorldScale(tmp).x, 1e-6));
    hand.add(holder);
    markActor(holder);
    this.holder = holder;
    this.weapon = def;
    this.arm = isSaber(def.class) ? 'saber' : FIGHTS[def.class] === 'gun' ? 'gun' : 'melee';
    if (this.arm === 'saber') {
      // The hilt along the character's forward, as the game's clips hold it; the blade from its top.
      rig.root.updateWorldMatrix(true, true);
      tmp.set(0, 0, 1).applyQuaternion(rig.root.getWorldQuaternion(tmpQ));
      tmp.applyQuaternion(hand.getWorldQuaternion(tmpQ).invert()).normalize();
      holder.quaternion.setFromUnitVectors(Y, tmp);
      const b = def.bounds;
      this.hiltTop = b ? Math.abs(b.max[1] - b.min[1]) / 2 : 0.13;
      this.blade = new SaberBlade();
      this.blade.setColor(this.color.getHex());
      if (def.blade) this.blade.spec = { length: def.blade.length, width: def.blade.width, open: def.blade.open, close: def.blade.close };
      this.group.parent?.add(this.blade.group);
      if (this.blade.group.parent) markActor(this.blade.group);
    } else if (this.arm === 'gun') this.gun = GUNS[gunTypeFor(def, def.class)];
  }

  /** Who hurt it last, and for how long it remembers; it turns on whoever struck. */
  private provoked: Living | null = null;
  private provokedFor = 0;

  damage(amount: number, from?: THREE.Vector3, push = 0, source?: Living | null): void {
    if (this.dead) return;
    if (source && source.key !== this.key && source.aggression !== 'passive') {
      this.provoked = source;
      this.provokedFor = 20;
    }
    this.hp -= amount;
    this.stunned = Math.max(this.stunned, 0.2);
    if (from && push > 0) {
      tmp.copy(this.pos).sub(from).setY(0).normalize();
      this.knock(tmp, push);
    }
    if (this.hp <= 0) this.die();
  }

  knock(dir: THREE.Vector3, power: number): void {
    if (this.dead) return;
    this.push.addScaledVector(dir, power * 0.6);
    this.stunned = Math.max(this.stunned, 0.5);
    // A real blow takes it off its feet: it rises and falls where it lands, rather than sliding
    // along the ground. A bolt's or a blade's little shove (under six) leaves it standing.
    if (power >= 6) {
      this.fallVy = Math.max(Number.isNaN(this.fallVy) ? 0 : this.fallVy, Math.max(power * 0.35, 2));
      this.grounded = false;
    }
  }

  afflict(dps: number, seconds: number): void {
    if (this.dead) return;
    if (dps * seconds >= this.dotDps * this.dotLeft) {
      this.dotDps = dps;
      this.dotLeft = seconds;
    }
  }

  stun(seconds: number): void {
    this.stunned = Math.max(this.stunned, seconds);
  }

  slow(seconds: number): void {
    this.slowed = Math.max(this.slowed, seconds);
  }

  /** The manager's collider map, so the entry goes at the moment the collider does (see `die`). */
  byCollider: Map<number, Npc> | null = null;

  private die(): void {
    this.dead = true;
    this.deadTimer = 9;
    this.hitIn = -1;
    this.heldAt = null;
    this.provoked = null;
    const rig = this.rig;
    // The death clip plays out, then the body falls to the physics from its last frame.
    this.ragdollIn = 0.6;
    if (rig) {
      const clip = rig.firstOf('trn_stand_to_incapacitated', 'BOTH_DEATH1', 'BOTH_DEATH4', 'BOTH_DEAD1');
      if (clip) {
        rig.play(clip, { fadeIn: 0.08, hold: true });
        this.ragdollIn = Math.min(3, (rig.clipDuration(clip) ?? 1) - 0.05);
      }
    }
    // The handle goes out of the lookup at the moment the collider goes, not ten seconds later
    // when the fighter is disposed: rapier recycles handles, so a fresh body landing on this one
    // in the meantime would otherwise be found as this corpse.
    this.byCollider?.delete(this.collider.handle);
    this.physics.world.removeCollider(this.collider, false);
  }

  /** The body left to the physics once the death clip has played; the fighter is cleared ten seconds later. */
  ragdoll: Ragdoll | null = null;
  private ragdollIn = -1;

  private startRagdoll(): void {
    if (this.ragdoll || !this.rig) return;
    this.group.updateMatrixWorld(true);
    this.ragdoll = new Ragdoll(this.physics, this.rig.root, { velocity: this.push.clone() });
    this.deadTimer = 10;
    if (this.blade) this.blade.group.visible = false;
  }

  /** Where a gun's muzzle is: the far end of the model's long axis, as the rack reads it. */
  private muzzle(out: THREE.Vector3): THREE.Vector3 {
    const h = this.holder;
    if (!h) {
      out.copy(this.pos);
      out.y += 1.3;
      return out;
    }
    const len = this.weapon?.length ?? 0.6;
    h.updateWorldMatrix(true, false);
    return h.localToWorld(out.set(0, 0, len * 0.55));
  }

  /** `now` is the world's simulated clock (`World.simTime`), so `__debug.advance` exercises the hold. */
  update(dt: number, terrain: Terrain, foes: readonly Living[], bolts: Bolts, effects: Effects | null, camera: THREE.Camera | null, now: number): void {
    this.now = now;
    // Slowed, everything of its own runs at a crawl; a burn eats in real time.
    this.slowed = Math.max(0, this.slowed - dt);
    const own = this.slowed > 0 ? 0.12 : 1;
    if (this.dotLeft > 0 && !this.dead) {
      const step = Math.min(this.dotLeft, dt);
      this.dotLeft -= step;
      this.hp -= this.dotDps * step;
      if (this.hp <= 0) this.die();
    }
    const rig = this.rig;
    if (this.dead) {
      this.deadTimer -= dt;
      if (this.ragdoll) {
        this.ragdoll.update(dt);
        this.ragdoll.centre(this.pos);
        return;
      }
      rig?.update(dt);
      this.ragdollIn -= dt;
      if (this.ragdollIn <= 0 && this.ragdollIn > -100) {
        this.ragdollIn = -1000;
        this.startRagdoll();
      }
      this.blade?.update(dt, this.bladeBase, this.bladeTip, false, camera ?? IDLE_CAMERA, 0, true);
      return;
    }
    const sdt = dt * own;
    this.stunned = Math.max(0, this.stunned - sdt);
    this.attackCd = Math.max(0, this.attackCd - sdt);
    this.retarget -= sdt;
    // Whoever hurt it last outranks the nearest, whatever side they are on, until it forgets.
    if (this.provoked) {
      this.provokedFor -= sdt;
      if (this.provokedFor <= 0 || this.provoked.dead) this.provoked = null;
    }
    if (this.retarget <= 0) {
      this.retarget = 0.4 + Math.random() * 0.3;
      let best: Living | null = this.provoked;
      let bestD = SIGHT;
      if (!best) {
        for (const f of foes) {
          if (f.key === this.key || f.dead || !hostileSides(this, f)) continue;
          const d = f.pos.distanceTo(this.pos);
          if (d < bestD) {
            bestD = d;
            best = f;
          }
        }
      }
      this.target = best;
    }
    const t = this.target && !this.target.dead ? this.target : null;
    this.moving = false;
    if (t && this.stunned <= 0) {
      tmp.copy(t.pos).sub(this.pos);
      tmp.y = 0;
      const d = tmp.length();
      const want = Math.atan2(tmp.x, tmp.z);
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, sdt * 6);
      const reach = this.arm === 'gun' ? 9 + Math.random() * 0.1 : 1.9;
      if (d > reach && this.hitIn < 0) {
        const step = Math.min(d - reach, RUN_SPEED * sdt);
        this.pos.x += Math.sin(this.heading) * step;
        this.pos.z += Math.cos(this.heading) * step;
        this.moving = true;
      }
      // The attack: a swing that lands a moment in, or a bolt at the foe's middle.
      if (this.attackCd <= 0 && Math.abs(diff) < 0.5) {
        if (this.arm === 'gun' && this.gun && d < 26) {
          const g = this.gun;
          this.attackCd = Math.max(0.35, g.primary.fireTime * 2.5) + Math.random() * 0.3;
          this.muzzle(tmp2);
          tmp.copy(t.pos).y += t.halfHeight * 0.9;
          tmp.sub(tmp2).normalize();
          // A fighter's aim scatters a little more than the player's.
          const s = 0.03;
          tmp.x += (Math.random() - 0.5) * s;
          tmp.y += (Math.random() - 0.5) * s;
          tmp.z += (Math.random() - 0.5) * s;
          tmp.normalize();
          bolts.fire(tmp2, tmp, { owner: 'enemy', damage: Math.max(6, g.primary.damage * 0.6), speed: g.primary.speed || 2300, color: g.primary.color, size: g.primary.size, push: g.primary.push, exclude: this.body, life: 6, source: this });
          effects?.flash(tmp2, g.primary.color, 6, 5, 0.06);
          rig?.playUpper(rig.firstOf('rifle_combat_standing_fire_1', 'add_rifle_fire_1', 'pistol_combat_standing_fire_1') ?? '', 0.04);
        } else if (this.arm !== 'gun' && d < 2.6) {
          this.attackCd = 1.1 + Math.random() * 0.4;
          this.hitIn = 0.32;
          const swing = SWINGS[Math.floor(Math.random() * SWINGS.length)];
          if (rig?.has(swing)) rig.play(swing, { fadeIn: 0.06 });
        }
      }
    }
    if (this.hitIn >= 0) {
      this.hitIn -= sdt;
      if (this.hitIn < 0 && t) {
        tmp.copy(t.pos).sub(this.pos);
        if (tmp.length() < 2.8) {
          t.damage(this.arm === 'saber' ? 32 : 18, this.pos, 4, this);
          if (effects) {
            tmp2.copy(t.pos).y += t.halfHeight;
            effects.burst(tmp2, this.arm === 'saber' ? this.color.getHex() : 0xffd0a0, 1, 0.2);
          }
        }
      }
    }
    // A shove from a blow or a blast, spent over a moment.
    if (this.push.lengthSq() > 1e-4) {
      this.pos.addScaledVector(this.push, sdt);
      this.push.multiplyScalar(Math.max(0, 1 - sdt * 4));
    }
    // Where the ground is, and whether the Force is keeping it off there. A kinematic body goes
    // where it is put, so the hold and the fall have to be written here or the clamp undoes them
    // every frame: a gripped fighter would be dragged down and a thrown one would slide.
    // Inside a building the floor under it, by a ray from a step above its feet (a cantina's floor,
    // not the ground under the building); outside, or with nothing under it, the terrain.
    // Only what stands still counts: the ray starts inside the fighter's own capsule. From a step
    // up, not a metre: a kinematic body walking into a counter or a table would pop onto its top.
    const floor = this.cell ? this.physics.topSurface(this.pos.x, this.pos.z, this.pos.y + FLOOR_STEP, 40, INSIDE_FILTER, staticOnly) : null;
    const ground = floor ?? terrain.heightAt(this.pos.x, this.pos.z);
    if (this.heldAt && this.now < this.heldUntil) {
      this.pos.lerp(this.heldAt, Math.min(1, sdt * 12));
      this.fallVy = 0;
      this.grounded = false;
      // A blow that lifted it (fallVy above zero) starts the arc from the ground it is standing on.
    } else if (!Number.isNaN(this.fallVy) && (this.pos.y > ground + 0.02 || this.fallVy > 0)) {
      this.heldAt = null;
      this.fallVy -= 18 * sdt;
      this.pos.y += this.fallVy * sdt;
      this.grounded = false;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.fallVy = Number.NaN;
        this.grounded = true;
      }
    } else {
      this.heldAt = null;
      this.fallVy = Number.NaN;
      this.pos.y = ground;
      this.grounded = true;
    }
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + this.halfHeight, z: this.pos.z });
    this.group.position.copy(this.pos);
    this.group.quaternion.setFromAxisAngle(UP, this.heading);
    if (rig) {
      if (!rig.overriding) {
        if (this.moving) rig.setState('run', RUN_SPEED * own);
        else if (this.arm === 'gun') rig.setState(rig.hasState('gunAimIdle') ? 'gunAimIdle' : 'idle');
        else if (this.arm === 'saber' && t) rig.setState(rig.hasState('stance') ? 'stance' : 'idle');
        else rig.setState('idle');
      }
      rig.update(sdt);
      this.group.updateMatrixWorld(true);
    }
    if (this.blade && this.holder) {
      const len = this.blade.spec.length;
      this.holder.updateWorldMatrix(true, false);
      this.holder.localToWorld(this.bladeBase.set(0, this.hiltTop, 0));
      this.holder.localToWorld(this.bladeTip.set(0, this.hiltTop + len, 0));
      this.blade.update(dt, this.bladeBase, this.bladeTip, !!t, camera ?? IDLE_CAMERA, this.hitIn >= 0 ? 1 : this.moving ? 0.3 : 0);
    }
  }

  /** The blade renderer when the weapon is a lightsaber: the light it throws is read from it. */
  get saber(): SaberBlade | null {
    return this.blade;
  }

  /** The middle of the lit blade, when there is one out this frame (igniting, lit or retracting). */
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

  dispose(scene: THREE.Scene): void {
    this.ragdoll?.dispose();
    this.ragdoll = null;
    // Anything still holding this one reads it as dead from here on.
    if (!this.dead) this.byCollider?.delete(this.collider.handle);
    this.provoked = null;
    this.target = null;
    if (!this.dead) this.physics.world.removeCollider(this.collider, false);
    this.dead = true;
    this.physics.world.removeRigidBody(this.body);
    scene.remove(this.group);
    if (this.blade) {
      scene.remove(this.blade.group);
      this.blade.dispose();
    }
  }
}

export class NpcManager {
  readonly npcs: Npc[] = [];
  readonly byCollider = new Map<number, Npc>();
  /** Bumped on every spawn and every removal, so the world's target list knows when to rebuild. */
  version = 0;
  private deps: NpcDeps = { weapons: null, effects: null, species: [] };
  private disposed = false;

  constructor(private readonly scene: THREE.Scene, private readonly physics: Physics, private readonly terrain: Terrain, private readonly baseUrl: string) {}

  /** What the fighters need from the game: the rack, the effects, the species there are. */
  attach(deps: Partial<NpcDeps>): void {
    this.deps = { ...this.deps, ...deps };
  }

  /**
   * Stand one at a point on the ground, of a random species; it dresses and arms itself as its rig
   * loads. `at.y` and `at.inside` put it on a building's floor, in the room the point is in.
   */
  spawnAt(x: number, z: number, wanted?: string, at: { y?: number; inside?: boolean } = {}): Npc {
    const species = this.deps.species.length ? this.deps.species : SPECIES_FALLBACK;
    const id = (wanted && species.find((s) => s.includes(wanted))) ?? species[Math.floor(Math.random() * species.length)];
    const npc = new Npc(id, this.physics, x, at.y ?? this.terrain.heightAt(x, z), z);
    npc.cellFrom.copy(npc.pos);
    if (at.inside) npc.cell = this.deps.cellAt?.(npc.pos) ?? null;
    this.scene.add(npc.group);
    this.npcs.push(npc);
    this.byCollider.set(npc.collider.handle, npc);
    npc.byCollider = this.byCollider;
    this.version++;
    void npc.dress(this.baseUrl, this.deps).catch((err) => console.warn(`fighter ${id}: no rig`, err));
    return npc;
  }

  removeAll(): number {
    const n = this.npcs.length;
    for (const npc of this.npcs) npc.dispose(this.scene);
    this.npcs.length = 0;
    this.byCollider.clear();
    this.version++;
    return n;
  }

  /**
   * The fighters' lit blades nearest `eye` within `maxDistance`, nearest first, each in its fighter's
   * colour: where they want pooled light this frame. Fills `out` (kept entries, reordered in place)
   * and returns how many.
   */
  lightSpots(out: FighterGlow[], eye: THREE.Vector3, maxDistance: number): number {
    const max2 = maxDistance * maxDistance;
    let n = 0;
    for (const npc of this.npcs) {
      if (!npc.glowAt(spot)) continue;
      const d2 = spot.distanceToSquared(eye);
      if (d2 > max2) continue;
      n = keepNearestGlow(out, n, spot, npc.color.getHex(), d2);
    }
    return n;
  }

  /** Every fighter's drawn blade core, for the depth of field's glow depth: fills `out` from `n`, returns the new count. */
  glowCores(out: THREE.Object3D[], n: number): number {
    for (const npc of this.npcs) n = npc.glowCore(out, n);
    return n;
  }

  /** `targets` is the world's one list of living things (the player, the creatures, the fighters). */
  update(dt: number, targets: readonly Living[], bolts: Bolts, camera: THREE.Camera | null, now: number): void {
    if (this.disposed) return;
    const follow = this.deps.followCell;
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const npc = this.npcs[i];
      // Its room, followed through the portals four times a second, and sooner when it has gone a couple of metres.
      if (follow && !npc.dead && (now - npc.followAt >= FOLLOW_EVERY || npc.cellFrom.distanceToSquared(npc.pos) > FOLLOW_STEP * FOLLOW_STEP)) {
        npc.followAt = now;
        npc.cell = follow(npc.cell, npc.cellFrom, npc.pos);
        npc.cellFrom.copy(npc.pos);
      }
      npc.update(dt, this.terrain, targets, bolts, this.deps.effects, camera, now);
      if (npc.dead && npc.deadTimer <= 0) {
        // The collider handle went out of the lookup in `die`, at the moment the collider itself
        // went. Deleting it again here would unregister whichever live body rapier has since
        // given that recycled handle to, and that body would stop taking damage.
        npc.dispose(this.scene);
        this.npcs.splice(i, 1);
        this.version++;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.removeAll();
  }
}
