// Fighters: humanoid NPCs stood on demand to fight the player and each other. Each is a character
// rig of a random species with a random look, a weapon off the rack (a lightsaber, a sword or a
// gun) in its hand, and a body the blades and bolts can hurt. The mind is small: the nearest foe
// within reach is the target, it runs to its weapon's range, and it swings or shoots on a timer.
// A first pass: no cover, no dodging, the ground read from the terrain only. Its clothes come off
// its species' wardrobe (a Wookiee's from the Wookiee pieces alone).
import * as THREE from 'three';
import { RAPIER, type Physics } from '../core/physics';
import { CharacterRig, loadPlayerRig } from '../player/rig';
import { applyLook } from '../player/look';
import { FIGHTS, isSaber, type WeaponCatalogue, type WeaponDef } from '../player/weapons';
import { SaberBlade } from '../combat/saberBlade';
import { Ragdoll } from '../combat/ragdoll';
import { GUNS, gunTypeFor, type GunProfile } from '../combat/guns';
import type { Bolts } from '../combat/bolts';
import type { Effects } from '../combat/effects';
import type { Hittable } from '../combat/kit';
import type { Terrain } from './terrain';
import { markActor } from './portalRender';
import { slotOf } from '../ui/wardrobeUi';

/** What a fighter carries, and so how it fights. */
type Arm = 'saber' | 'melee' | 'gun';

const SWINGS = ['BOTH_A1_T__B_', 'BOTH_A1__L__R', 'BOTH_A1__R__L', 'BOTH_A1_TL_BR', 'BOTH_A1_TR_BL', 'BOTH_A2_T__B_', 'BOTH_A2__L__R', 'BOTH_A2_TL_BR', 'BOTH_A3_T__B_', 'BOTH_A3_TR_BL'];
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
const base = new THREE.Vector3();
const tip = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const tmpQ = new THREE.Quaternion();

export interface NpcDeps {
  weapons: WeaponCatalogue | null;
  effects: Effects | null;
  /** The species the character packs hold, by id; the fallback list when none is known. */
  species: string[];
}

export class Npc implements Hittable {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly halfHeight = 0.9;
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
  readonly color = new THREE.Color().setHSL(Math.random(), 0.9, 0.55);
  private target: Hittable | null = null;
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

  constructor(readonly species: string, private readonly physics: Physics, x: number, y: number, z: number) {
    this.name = `${species.replace(/_/g, ' ')} fighter`;
    this.pos.set(x, y, z);
    this.group.position.copy(this.pos);
    markActor(this.group);
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + this.halfHeight, z));
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(this.halfHeight - 0.35, 0.35), this.body);
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

  damage(amount: number, from?: THREE.Vector3, push = 0): void {
    if (this.dead) return;
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

  private die(): void {
    this.dead = true;
    this.deadTimer = 9;
    this.hitIn = -1;
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

  update(dt: number, terrain: Terrain, foes: Hittable[], bolts: Bolts, effects: Effects | null, camera: THREE.Camera | null): void {
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
        this.ragdoll.update();
        this.ragdoll.centre(this.pos);
        return;
      }
      rig?.update(dt);
      this.ragdollIn -= dt;
      if (this.ragdollIn <= 0 && this.ragdollIn > -100) {
        this.ragdollIn = -1000;
        this.startRagdoll();
      }
      this.blade?.update(dt, base, tip, false, camera ?? new THREE.PerspectiveCamera(), 0, true);
      return;
    }
    const sdt = dt * own;
    this.stunned = Math.max(0, this.stunned - sdt);
    this.attackCd = Math.max(0, this.attackCd - sdt);
    this.retarget -= sdt;
    if (this.retarget <= 0) {
      this.retarget = 0.4 + Math.random() * 0.3;
      let best: Hittable | null = null;
      let bestD = SIGHT;
      for (const f of foes) {
        if (f === this || f.dead) continue;
        const d = f.pos.distanceTo(this.pos);
        if (d < bestD) {
          bestD = d;
          best = f;
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
          bolts.fire(tmp2, tmp, { owner: 'enemy', damage: Math.max(6, g.primary.damage * 0.6), speed: g.primary.speed || 2300, color: g.primary.color, size: g.primary.size, push: g.primary.push, exclude: this.body, life: 6 });
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
          t.damage(this.arm === 'saber' ? 32 : 18, this.pos, 4);
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
    this.pos.y = terrain.heightAt(this.pos.x, this.pos.z);
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
    if (this.blade && this.holder && camera) {
      const len = this.blade.spec.length;
      this.holder.updateWorldMatrix(true, false);
      this.holder.localToWorld(base.set(0, this.hiltTop, 0));
      this.holder.localToWorld(tip.set(0, this.hiltTop + len, 0));
      this.blade.update(dt, base, tip, !!t, camera, this.hitIn >= 0 ? 1 : this.moving ? 0.3 : 0);
    }
  }

  /** The point a light glows from, when a lit blade is out. */
  glowAt(out: THREE.Vector3): boolean {
    if (!this.blade || this.dead || !this.target) return false;
    out.copy(base).lerp(tip, 0.5);
    return true;
  }

  dispose(scene: THREE.Scene): void {
    this.ragdoll?.dispose();
    this.ragdoll = null;
    if (!this.dead) this.physics.world.removeCollider(this.collider, false);
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
  private deps: NpcDeps = { weapons: null, effects: null, species: [] };
  private disposed = false;

  constructor(private readonly scene: THREE.Scene, private readonly physics: Physics, private readonly terrain: Terrain, private readonly baseUrl: string) {}

  /** What the fighters need from the game: the rack, the effects, the species there are. */
  attach(deps: Partial<NpcDeps>): void {
    this.deps = { ...this.deps, ...deps };
  }

  /** Stand one at a point on the ground, of a random species; it dresses and arms itself as its rig loads. */
  spawnAt(x: number, z: number, wanted?: string): Npc {
    const species = this.deps.species.length ? this.deps.species : SPECIES_FALLBACK;
    const id = (wanted && species.find((s) => s.includes(wanted))) ?? species[Math.floor(Math.random() * species.length)];
    const npc = new Npc(id, this.physics, x, this.terrain.heightAt(x, z), z);
    this.scene.add(npc.group);
    this.npcs.push(npc);
    this.byCollider.set(npc.collider.handle, npc);
    void npc.dress(this.baseUrl, this.deps).catch((err) => console.warn(`fighter ${id}: no rig`, err));
    return npc;
  }

  removeAll(): number {
    const n = this.npcs.length;
    for (const npc of this.npcs) npc.dispose(this.scene);
    this.npcs.length = 0;
    this.byCollider.clear();
    return n;
  }

  /** Where the lit blades want light this frame. */
  lightSpots(out: THREE.Vector3[]): number {
    let n = 0;
    for (const npc of this.npcs) if (n < out.length && npc.glowAt(out[n])) n++;
    return n;
  }

  update(dt: number, player: Hittable, bolts: Bolts, camera: THREE.Camera | null): void {
    if (this.disposed) return;
    const foes: Hittable[] = [player, ...this.npcs];
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const npc = this.npcs[i];
      npc.update(dt, this.terrain, foes, bolts, this.deps.effects, camera);
      if (npc.dead && npc.deadTimer <= 0) {
        npc.dispose(this.scene);
        this.byCollider.delete(npc.collider.handle);
        this.npcs.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.removeAll();
  }
}
