// One ship's fight: its stats (shipStats.ts), its condition layer by layer (shipDamage.ts), its guns'
// turn and refire, its boost energy, the game's hit effects where a bolt strikes, and the ship's own
// damage-band effects as its chassis goes. Every number it works with is invented (shipStats.ts);
// the effects are the game's (ship_hit_effects.iff, the hull's client data).
//
// The constructor writes the vehicle's spec once from the stats (the spec object is the vehicle's own:
// specFor makes a fresh one per spawn), and again only when a part goes down or comes back. The chassis
// mirrors into `hull.hp`, so a destroyed ship is what it always was to the rest of the game.
//
// Imports `three`, the pure modules with `.ts`, and only types from the runtime, so node's tests load it.
// Nothing here allocates per frame or per hit (a hit's effect handle is the particle system's own).
import * as THREE from 'three';
import { layerColours } from '../core/palette.ts';
import { NOBODY, PLAYER_KEY, type Living } from '../combat/kit.ts';
import type { Bolt } from '../combat/bolts';
import type { CombatFile, CombatLayer, HullFx } from './combatData.ts';
import { vehicleSounds } from '../audio/vehicleSounds.ts';
import type { ShipContact } from './contacts';
import { applyCollision, applyHit, applyShares, createCondition, isDown, newHitResult, regenerate, rescaleCondition, sharesOf, type ConditionShares, type HitResult, type ShipCondition } from './shipDamage.ts';
import { CLASS_BASE, COLLISION_BOUT, COLLISION_CAP_SHARE, statsFor, type Handling, type ShipStats, type StatInput, type WeaponStat } from './shipStats.ts';

/** What a zone crossing carries of a ship's fight onto the hull spawned on the other side: its condition's shares and its boost's. */
export interface CarriedCondition extends ConditionShares {
  boost: number;
}

/**
 * Whether a ship may be picked, followed or fired at: alive, and not in a jump (a ghosted hull's
 * colliders are in no group and its flight is the jump's). Every target choice goes through this.
 */
export function targetable(c: { readonly dead: boolean; readonly vehicle: { readonly ghosted: boolean } }): boolean {
  return !c.dead && !c.vehicle.ghosted;
}

/**
 * The key a blow's source is remembered by: the player in any form (on foot, PLAYER_KEY, or the contact
 * of the ship they fly now) is PLAYER_KEY, so retaliation and the death taunt find the player however
 * they struck; anyone else by their own key; nobody, NOBODY.
 */
export function blameKey(source: { readonly key: number } | null, playerShip: object | null): number {
  if (!source) return NOBODY;
  if (source.key === PLAYER_KEY || (playerShip !== null && source === playerShip)) return PLAYER_KEY;
  return source.key;
}

/** Who a remembered key names now: PLAYER_KEY is the ship the player flies, else the player on foot; any other key a contact in `list`; NOBODY, no one. */
export function blamed<T extends { readonly key: number }>(key: number, list: readonly T[], playerShip: T | null, playerOnFoot: T | null): T | null {
  if (!key) return null;
  if (key === PLAYER_KEY) return playerShip ?? playerOnFoot;
  for (const c of list) if (c.key === key) return c;
  return null;
}

/** The stock components a ship's stats count: the fit's stock parts for a player or garage ship; none for an NPC type, whose loadout is its fit. */
export function stockFor(isNpc: boolean, slots: readonly { readonly slot: string; readonly stock: string | null }[] | null | undefined): Record<string, string | null> {
  const stock: Record<string, string | null> = {};
  if (!isNpc) for (const s of slots ?? []) stock[s.slot] = s.stock;
  return stock;
}

/** What ShipCombat reads of a vehicle: a stub in the node test, the Vehicle in the game. */
export interface CombatHull {
  spec: { maxSpeed: number; boostSpeed: number; accel: number; brake: number; turnRate: number; inertia?: number; bounds: { min: readonly number[]; max: readonly number[] } };
  hp: number;
  readonly maxHp: number;
  struck: number;
  readonly group: THREE.Object3D;
  guns: { pos: THREE.Vector3; dir: THREE.Vector3; node?: THREE.Object3D; slot?: string | null }[];
}

/** What ShipCombat needs to show itself: null in the node test. */
export interface CombatFx {
  place(file: string, matrix: THREE.Matrix4, transient: boolean, frame: THREE.Matrix4 | null): unknown;
  remove(handle: unknown): void;
  flash(at: THREE.Vector3, color: number, intensity: number, distance: number, seconds: number): void;
  /** The garage's hardpoint search (through hardpointName). */
  hardpoint(root: THREE.Object3D, name: string): THREE.Object3D | null;
}

/** What the owner of the combats (ShipContacts) is told: the clock, and each blow after the layers took it. */
export interface CombatHooks {
  now(): number;
  struck(combat: ShipCombat, source: Living | null, result: HitResult): void;
}

/** What the flight HUD's status line shows: shares 0..1 (front, back), boost energy 0..1, and what is down. */
export interface CombatStatus {
  shield: [number, number];
  armour: [number, number];
  hull: number;
  boost: number;
  down: readonly string[];
}

/** Shields and armour share of one face, and the hull's share, 0..1. */
export interface CombatSummary {
  shield: number;
  armour: number;
  hull: number;
}

/** Hit-effect flash colours per layer, ours (the effect's own light, CLGT, is not decoded): the palette's own four, read from there rather than written again here, so the hull flashes in the colour the layer's bar and its pip wear and a part hit no longer looks like a hull hit. Read as this module loads, which is before the stylesheet is: that is the palette's fallback table, which `palette.test.ts` pins to `:root` value for value, so the two cannot differ while the tests pass. */
export const LAYER_FLASH: Record<CombatLayer, number> = layerColours();

/**
 * What a part going down does (invented): an engine down flies at ENGINE_DOWN_SPEED of the top speed and
 * ENGINE_DOWN_ACCEL of the acceleration, with no boost; a reactor down REACTOR_DOWN_SPEED of the top, no
 * shield regeneration and REACTOR_DOWN_REFIRE times the refire; a capacitor down CAPACITOR_DOWN_REFIRE
 * times; a droid interface down DROID_DOWN_TURN of the turn rate. A shield generator down holds the
 * shields at nothing, a booster down gives no boost, and a weapon slot down silences its guns.
 */
export const DOWN_EFFECT = { engineSpeed: 0.35, engineAccel: 0.4, reactorSpeed: 0.8, reactorRefire: 1.6, capacitorRefire: 2, droidTurn: 0.7 };

/** A gun stat for a ship that has none (nothing to fire): never used to fire, only to answer weaponOfGun. */
const NO_WEAPON: WeaponStat = { slot: 'weapon_0', name: '', projectile: 0, speed: 600, range: 512, damage: CLASS_BASE.fighter.damage };

// Scratch: nothing is allocated per hit.
const nose = new THREE.Vector3();
const toward = new THREE.Vector3();
const placeQ = new THREE.Quaternion();
const placeM = new THREE.Matrix4();
const hitP = new THREE.Vector3();
const hitN = new THREE.Vector3();
const toHull = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** One place on the hull where damage bands play (a hardpoint or a position): the band showing now and its effect. */
interface BandPlace {
  bands: HullFx['damage'];
  matrix: THREE.Matrix4 | null;
  active: number;
  handle: unknown;
}

export class ShipCombat {
  readonly hull: CombatHull;
  readonly contact: ShipContact;
  stats: ShipStats;
  readonly cond: ShipCondition;
  /** Seconds until the next shot, and the gun that fires next (index into hull.guns). */
  cooldown = 0;
  nextGun = 0;
  /** Seconds of boost left. */
  boostLeft = 0;
  /** Who struck last (a key), for the death taunt and retaliation. */
  lastSourceKey = NOBODY;
  /** Shots, hits dealt, hits taken: for the console. */
  readonly tally = { shots: 0, hits: 0, taken: 0 };
  /** Takes no damage (the console's god mode). */
  god = false;
  /** Told of each blow (ShipContacts); null in the node test. */
  hooks: CombatHooks | null = null;
  /** The last blow's result, kept (nothing is allocated per hit). */
  readonly last: HitResult = newHitResult();
  /** The random numbers a blow draws (a component struck, which one): replaceable for tests. */
  rng: () => number = Math.random;
  /** Whether the last blow placed the game's hit effect for its layer (false: the combat file has none for it, or there is no combat file), so the bolt's own hit effect can stand in. */
  shown = false;
  /** The chassis row this hull flies as, which is what the game keys its hit and power sounds on; null: the fallback row. Set by whoever adopts the combat, which is the only place the chassis is known. */
  soundChassis: string | null = null;
  /** The handling as the vehicle had it before the combat wrote its spec: every restat starts from this. */
  private readonly base: Handling;
  private readonly fx: CombatFx | null;
  private hitEffects: CombatFile['hitEffects'] | null = null;
  private readonly places: BandPlace[] = [];
  /** The chassis share the bands were last set for (-1: never). */
  private bandShare = -1;
  /** The chassis has fallen under a quarter once (its event effect played). */
  private low = false;
  /** Simulated seconds this fight has run (`update`), which the collision bouts are timed on. */
  private clock = 0;
  /** The collision with another ship under way: that ship's key (its body's handle; a number, so a removed ship is not kept alive), when it last touched, and what it has taken so far. */
  private boutWith: number | null = null;
  private boutAt = -Infinity;
  private boutTaken = 0;
  private readonly downList: string[] = [];
  private readonly statusOut: CombatStatus = { shield: [1, 1], armour: [1, 1], hull: 1, boost: 1, down: [] };
  private readonly summaryOut: CombatSummary = { shield: 1, armour: 1, hull: 1 };

  constructor(hull: CombatHull, contact: ShipContact, input: StatInput, fx: CombatFx | null, hullFx: HullFx | null, hitEffects: CombatFile['hitEffects'] | null) {
    this.hull = hull;
    this.contact = contact;
    this.fx = fx;
    this.base = { ...input.base };
    this.stats = statsFor({ ...input, base: this.base });
    this.cond = createCondition(this.stats);
    this.boostLeft = this.stats.boostSeconds;
    this.statusOut.down = this.downList;
    this.setEffects(hullFx, hitEffects);
    this.writeSpec();
    this.mirror();
  }

  /**
   * The combat file's effects for this ship: the per-layer hit effects and the hull's damage bands. The
   * constructor sets them, and ShipContacts again when the combat file arrives after the ship was adopted;
   * the bands showing are taken down and put up again for the chassis as it stands.
   */
  setEffects(hullFx: HullFx | null, hitEffects: CombatFile['hitEffects'] | null): void {
    this.hitEffects = hitEffects;
    this.dispose();
    this.places.length = 0;
    // The damage bands by place, in file order: a later band at the same place replaces an earlier one.
    const byKey = new Map<string, BandPlace>();
    for (const b of hullFx?.damage ?? []) {
      if (!b.particle) continue;
      const key = b.hardpoint ? `hp:${b.hardpoint}` : b.position ? b.position.map((n) => n.toFixed(2)).join(',') : 'origin';
      let p = byKey.get(key);
      if (!p) {
        p = { bands: [], matrix: null, active: -1, handle: null };
        byKey.set(key, p);
        this.places.push(p);
      }
      p.bands.push(b);
    }
  }

  /** Stats again from a new input (a refit): the condition keeps its shares; the spec is rewritten from the handling the vehicle had before the combat (input.base is not read). */
  restat(input: StatInput): void {
    const from = this.stats;
    const to = statsFor({ ...input, base: this.base });
    rescaleCondition(this.cond, from, to);
    this.stats = to;
    this.boostLeft = Math.min(this.boostLeft, to.boostSeconds);
    this.nextGun = 0;
    this.refreshDown();
    this.writeSpec();
    this.mirror();
  }

  /** The chassis slot a gun belongs to: its own when it has a gun stat, else the first gun slot (the hull guns'); null when the ship has no gun stat. */
  gunSlot(i: number): string | null {
    const own = this.hull.guns[i]?.slot;
    if (own) for (const g of this.stats.guns) if (g.slot === own) return own;
    return this.stats.guns[0]?.slot ?? null;
  }

  /** Whether gun `i` may fire: it has a weapon and its slot's part is not down. */
  private gunLive(i: number): boolean {
    const slot = this.gunSlot(i);
    return slot !== null && !isDown(this.cond, slot);
  }

  /** Seconds between shots now: the refire over how many guns can fire, the capacitor and the reactor. */
  interval(): number {
    let live = 0;
    for (let i = 0; i < this.hull.guns.length; i++) if (this.gunLive(i)) live++;
    let t = this.stats.refire / Math.min(2, Math.max(1, live / 2));
    if (isDown(this.cond, 'capacitor')) t *= DOWN_EFFECT.capacitorRefire;
    if (isDown(this.cond, 'reactor')) t *= DOWN_EFFECT.reactorRefire;
    return t;
  }

  /** The next gun that may fire now, or -1 (the cooldown, dead weapon slots); advances the cooldown by the ship's interval when it returns one. */
  takeShot(): number {
    if (this.cooldown > 0 || this.cond.chassis <= 0) return -1;
    const n = this.hull.guns.length;
    for (let k = 0; k < n; k++) {
      const i = (this.nextGun + k) % n;
      if (!this.gunLive(i)) continue;
      this.nextGun = (i + 1) % n;
      this.cooldown = Math.max(0, this.cooldown) + this.interval();
      this.tally.shots++;
      return i;
    }
    return -1;
  }

  /** What gun `i` fires (its slot's weapon, else the first gun's). */
  weaponOfGun(i: number): WeaponStat {
    const slot = this.gunSlot(i);
    for (const g of this.stats.guns) if (g.slot === slot) return g;
    return this.stats.guns[0] ?? NO_WEAPON;
  }

  /** The face a direction of travel strikes: a blow travelling against the nose strikes the front (0), else the back (1). */
  private faceOfTravel(dir: THREE.Vector3): 0 | 1 {
    nose.set(0, 0, 1).applyQuaternion(this.hull.group.quaternion);
    return dir.dot(nose) < 0 ? 0 : 1;
  }

  /** The face toward a point: in front of the hull's middle the front (0), else the back (1). */
  private faceToward(p: THREE.Vector3): 0 | 1 {
    nose.set(0, 0, 1).applyQuaternion(this.hull.group.quaternion);
    toward.copy(p).sub(this.hull.group.position);
    return toward.dot(nose) >= 0 ? 0 : 1;
  }

  /**
   * A bolt struck the hull at `point`: the layers, the effects, the attacker remembered. The bolt is always
   * spent: 'shown' when the game's hit effect for the layer struck was placed, 'taken' when none was (no
   * combat file, no effect for that layer, or the ship already destroyed), so the bolt's own may stand in.
   */
  takeBolt(bolt: Bolt, point: THREE.Vector3, normal: THREE.Vector3): 'taken' | 'shown' {
    this.shown = false;
    if (this.cond.chassis <= 0) return 'taken';
    this.blow(bolt.damage, this.faceOfTravel(bolt.dir), bolt.source ?? null, point, normal, 1);
    return this.shown ? 'shown' : 'taken';
  }

  /** Any other blow (a saber, a blast): the face from `from`; the effects at the hull's middle, facing the blow. */
  take(amount: number, from: THREE.Vector3 | undefined, source: Living | null): void {
    if (this.cond.chassis <= 0) return;
    const facing = from ? this.faceToward(from) : 0;
    hitP.copy(this.hull.group.position);
    if (from) hitN.copy(from).sub(hitP);
    else hitN.set(0, 0, 1).applyQuaternion(this.hull.group.quaternion);
    if (hitN.lengthSq() < 1e-9) hitN.copy(UP);
    this.blow(amount, facing, source, hitP, hitN.normalize(), 1);
  }

  /**
   * A collision's damage (the speed lost past the threshold, as flyShip counts it, in the hull's `hp`
   * points), onto the front's armour (a ship mostly meets what is ahead of it), then the chassis. It is
   * taken as the same share of the chassis it took of `hp` before ships had a fight (the armour taking the
   * first of it), a choice, not the client's. `other` is the key of the other ship it met (its body's handle),
   * or null for anything else. Only a collision with another ship is capped: contacts with the same ship within
   * COLLISION_BOUT seconds of the last are one collision, which takes at most COLLISION_CAP_SHARE of this ship's
   * full front armour and chassis, so a ship at full health lives through meeting another. Anything else (a
   * station, an asteroid, the Star Destroyer, the ground) takes all it costs, every time, so a ship held into a
   * station face is still destroyed. Returns what it took, in the stats' points.
   */
  collide(amount: number, other: number | null = null): number {
    if (this.cond.chassis <= 0 || this.god || !(amount > 0)) return 0;
    const scale = this.hull.maxHp > 0 ? this.stats.chassisMax / this.hull.maxHp : 1;
    let take = amount * scale;
    if (other !== null) {
      if (other !== this.boutWith || this.clock - this.boutAt > COLLISION_BOUT) {
        this.boutWith = other;
        this.boutTaken = 0;
      }
      this.boutAt = this.clock;
      const cap = COLLISION_CAP_SHARE * (this.stats.armourMax[0] + this.stats.chassisMax);
      take = Math.min(take, Math.max(0, cap - this.boutTaken));
      if (!(take > 0)) return 0;
      this.boutTaken += take;
    }
    applyCollision(this.cond, this.stats, take, 0, this.last);
    this.afterBlow();
    return take;
  }

  /** The condition as shares and the boost's share, for a zone crossing to carry (a fresh object: once per crossing). */
  shares(): CarriedCondition {
    const s = this.stats;
    return { ...sharesOf(this.cond, s), boost: s.boostSeconds > 0 ? this.boostLeft / s.boostSeconds : 1 };
  }

  /**
   * A carried condition put on this ship (the hull spawned on the other side of a crossing, once adopted): each
   * layer and part the share it had, onto this ship's own maxima, what was down down again; the spec, the damage
   * bands and `hull.hp` follow. A share of nothing left in the chassis is not carried (a destroyed ship cannot cross).
   */
  restore(c: CarriedCondition): void {
    const s = this.stats;
    applyShares(this.cond, s, c);
    if (this.cond.chassis <= 0) this.cond.chassis = Math.min(s.chassisMax, 1);
    this.boostLeft = s.boostSeconds * (Number.isFinite(c.boost) ? Math.max(0, Math.min(1, c.boost)) : 1);
    this.low = this.cond.chassis < 0.25 * s.chassisMax;
    this.refreshDown();
    this.writeSpec();
    this.mirror();
  }

  /** The layers, the effects, the attacker, the hooks. `roll` over COMPONENT_CHANCE keeps components out (the console's layer hits). */
  private blow(amount: number, facing: 0 | 1, source: Living | null, point: THREE.Vector3, normal: THREE.Vector3, allowPart: number): void {
    const roll = allowPart ? this.rng() : 1;
    applyHit(this.cond, this.stats, this.god ? 0 : amount, facing, roll, this.rng(), this.last);
    if (this.god) this.last.layer = 'shield';
    this.tally.taken++;
    if (source) this.lastSourceKey = source.key;
    this.effects(point, normal, this.last);
    this.afterBlow();
    this.hooks?.struck(this, source, this.last);
  }

  /** After the condition changed: the hull's hp, what is down, and the spec when a part went down. */
  private afterBlow(): void {
    if (this.last.partDown) {
      this.refreshDown();
      this.writeSpec();
    }
    this.mirror();
  }

  /**
   * The layer's hit effect at the point, facing the normal, a pooled flash, and the event effect when a
   * layer gave way. The effects are placed in the hull's frame (its live world matrix), so they ride a
   * ship doing hundreds of metres a second instead of being left behind; the place is taken against the
   * same matrix the frame is, so the effect starts exactly at the point however stale that matrix is.
   */
  private effects(point: THREE.Vector3, normal: THREE.Vector3, r: HitResult): void {
    // The blow's own sound for the layer it reached, and the game's power-down when the blow took a
    // part with it. Before the effects, because a ship with no effects to place still sounds.
    vehicleSounds.shipHit(this.soundChassis, r.layer, point.x, point.y, point.z, r.partDown ? r.part : null);
    const fx = this.fx;
    if (!fx) return;
    placeQ.setFromUnitVectors(UP, normal);
    const frame = this.hull.group.matrixWorld;
    placeM.compose(point, placeQ, ONE).premultiply(toHull.copy(frame).invert());
    const set = this.hitEffects?.[r.layer];
    const hit = set?.hit[r.weight] ?? set?.hit[0] ?? null;
    if (hit) {
      fx.place(hit, placeM, true, frame);
      this.shown = true;
    }
    fx.flash(point, LAYER_FLASH[r.layer], 6 + 4 * r.weight, 5 + 2 * r.weight, 0.1);
    let event: CombatLayer | null = null;
    if (r.destroyed || (!this.low && this.cond.chassis < 0.25 * this.stats.chassisMax)) {
      this.low = true;
      event = 'chassis';
    } else if (r.partDown) event = 'component';
    else if (r.armourBreached) event = 'armor';
    else if (r.shieldDown) event = 'shield';
    if (event) {
      const e = this.hitEffects?.[event]?.event;
      const file = e?.[r.weight] ?? e?.[2] ?? e?.[0] ?? null;
      if (file) fx.place(file, placeM, true, frame);
    }
  }

  /** Shields back after a quiet spell, boost energy (`boosting` spends it), cooldown, and the damage-band effects. */
  update(dt: number, now: number, boosting = false): void {
    void now;
    this.clock += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const s = this.stats;
    if (s.boostSeconds > 0 && !isDown(this.cond, 'booster') && !isDown(this.cond, 'engine')) {
      if (boosting) this.boostLeft = Math.max(0, this.boostLeft - dt);
      else this.boostLeft = Math.min(s.boostSeconds, this.boostLeft + s.boostRecharge * s.boostSeconds * dt);
    } else this.boostLeft = 0;
    const generatorUp = !isDown(this.cond, 'shield_0');
    if (!generatorUp) {
      this.cond.shield[0] = 0;
      this.cond.shield[1] = 0;
    }
    regenerate(this.cond, s, generatorUp, !isDown(this.cond, 'reactor'), dt);
    this.updateBands();
  }

  /** The hull's damage-band effects for its chassis share now: at each place the last band started, placed in the hull's frame. */
  private updateBands(): void {
    const fx = this.fx;
    if (!fx || !this.places.length) return;
    const share = this.stats.chassisMax > 0 ? 1 - this.cond.chassis / this.stats.chassisMax : 0;
    if (share === this.bandShare) return;
    this.bandShare = share;
    for (const p of this.places) {
      let want = -1;
      for (let i = 0; i < p.bands.length; i++) if (share > 0 && share >= p.bands[i].from) want = i;
      if (want === p.active) continue;
      if (p.handle !== null) fx.remove(p.handle);
      p.handle = null;
      p.active = want;
      if (want < 0) continue;
      const b = p.bands[want];
      p.matrix ??= this.bandMatrix(b);
      p.handle = fx.place(b.particle, p.matrix, false, this.hull.group.matrixWorld);
    }
  }

  /** Where a band plays, in the hull group's frame: its hardpoint as it stands now, else its position in the model's frame (the model is the group's first child). */
  private bandMatrix(b: HullFx['damage'][number]): THREE.Matrix4 {
    const g = this.hull.group;
    const m = new THREE.Matrix4();
    if (b.hardpoint && this.fx) {
      const node = this.fx.hardpoint(g, b.hardpoint);
      if (node) {
        g.updateMatrixWorld(true);
        return m.copy(g.matrixWorld).invert().multiply(node.matrixWorld);
      }
    }
    if (b.position) m.makeTranslation(b.position[0], b.position[1], b.position[2]);
    const model = g.children[0];
    if (model) {
      model.updateMatrix();
      m.premultiply(model.matrix);
    }
    return m;
  }

  /** The slots whose part is down. */
  get down(): readonly string[] {
    return this.downList;
  }

  private refreshDown(): void {
    this.downList.length = 0;
    for (const p of this.cond.parts) if (p.down) this.downList.push(p.slot);
  }

  /** The vehicle's spec from the stats and what is down. */
  private writeSpec(): void {
    const h = this.stats.handling;
    const spec = this.hull.spec;
    const c = this.cond;
    let top = h.maxSpeed;
    let boost = h.boostSpeed;
    let accel = h.accel;
    let brake = h.brake;
    let turn = h.turnRate;
    if (isDown(c, 'engine')) {
      top *= DOWN_EFFECT.engineSpeed;
      boost = top;
      accel *= DOWN_EFFECT.engineAccel;
      brake *= DOWN_EFFECT.engineAccel;
    }
    if (isDown(c, 'reactor')) {
      top *= DOWN_EFFECT.reactorSpeed;
      boost *= DOWN_EFFECT.reactorSpeed;
    }
    // No booster (none in the chassis, or down): the boost is no faster than the top.
    if (isDown(c, 'booster') || this.stats.boostSeconds <= 0) boost = top;
    if (isDown(c, 'droid_interface')) turn *= DOWN_EFFECT.droidTurn;
    spec.maxSpeed = top;
    spec.boostSpeed = Math.max(top, boost);
    spec.accel = accel;
    spec.brake = brake;
    spec.turnRate = turn;
    spec.inertia = h.inertia;
  }

  /** The chassis share into the vehicle's hp, which says to the rest of the game whether it is destroyed. */
  private mirror(): void {
    const max = this.stats.chassisMax;
    this.hull.hp = max > 0 ? Math.max(0, (this.hull.maxHp * this.cond.chassis) / max) : 0;
  }

  /** Shield and armour share of the face toward `from` (the front without it), and the hull share: a kept object. */
  summary(from?: THREE.Vector3): CombatSummary {
    const f = from ? this.faceToward(from) : 0;
    const s = this.stats;
    const o = this.summaryOut;
    o.shield = s.shieldMax[f] > 0 ? this.cond.shield[f] / s.shieldMax[f] : 0;
    o.armour = s.armourMax[f] > 0 ? this.cond.armour[f] / s.armourMax[f] : 0;
    o.hull = s.chassisMax > 0 ? this.cond.chassis / s.chassisMax : 0;
    return o;
  }

  /** The status line's numbers: a kept object. */
  status(): CombatStatus {
    const s = this.stats;
    const o = this.statusOut;
    o.shield[0] = s.shieldMax[0] > 0 ? this.cond.shield[0] / s.shieldMax[0] : 0;
    o.shield[1] = s.shieldMax[1] > 0 ? this.cond.shield[1] / s.shieldMax[1] : 0;
    o.armour[0] = s.armourMax[0] > 0 ? this.cond.armour[0] / s.armourMax[0] : 0;
    o.armour[1] = s.armourMax[1] > 0 ? this.cond.armour[1] / s.armourMax[1] : 0;
    o.hull = s.chassisMax > 0 ? this.cond.chassis / s.chassisMax : 0;
    o.boost = s.boostSeconds > 0 ? this.boostLeft / s.boostSeconds : 0;
    return o;
  }

  /**
   * The console's blow: `what` a layer ('shield', 'armor', 'chassis') or a slot ('engine'), `share` 0..1 of
   * that layer's (or part's) maximum. A layer's blow goes through the same path as a bolt's (effects, event,
   * hooks with no source) with no component struck; a slot's takes that part alone. Returns the result.
   */
  forceHit(what: string, share: number): HitResult {
    const s = this.stats;
    const c = this.cond;
    const k = Math.max(0, Math.min(1, share));
    this.hull.group.updateMatrixWorld(true);
    hitP.copy(this.hull.group.position);
    hitN.set(0, 0, 1).applyQuaternion(this.hull.group.quaternion);
    if (what === 'shield' || what === 'armor' || what === 'armour' || what === 'chassis') {
      let amount = s.shieldMax[0] * k;
      if (what !== 'shield') amount = c.shield[0] + (what === 'chassis' ? c.armour[0] + s.chassisMax * k : s.armourMax[0] * k);
      this.blow(amount, 0, null, hitP, hitN, 0);
      return this.last;
    }
    const part = c.parts.find((p) => p.slot === what);
    const r = this.last;
    r.layer = 'component';
    r.facing = 0;
    r.part = part ? part.slot : null;
    r.partDown = false;
    r.shieldDown = false;
    r.armourBreached = false;
    r.destroyed = false;
    r.dealt = 0;
    r.weight = 2;
    if (part && !part.down) {
      const take = Math.min(part.hp, part.max * k);
      part.hp -= take;
      r.dealt = take;
      if (part.hp <= 1e-6) {
        part.hp = 0;
        part.down = true;
        r.partDown = true;
      }
      this.effects(hitP, hitN, r);
      this.afterBlow();
    }
    return r;
  }

  /** Everything back to full (the console's repair). */
  repair(): void {
    const s = this.stats;
    const c = this.cond;
    c.shield[0] = s.shieldMax[0];
    c.shield[1] = s.shieldMax[1];
    c.armour[0] = s.armourMax[0];
    c.armour[1] = s.armourMax[1];
    c.chassis = s.chassisMax;
    for (const p of c.parts) {
      p.hp = p.max;
      p.down = false;
    }
    c.sinceHit = 1e9;
    this.low = false;
    this.boutWith = null;
    this.boutAt = -Infinity;
    this.boutTaken = 0;
    this.boostLeft = s.boostSeconds;
    this.refreshDown();
    this.writeSpec();
    this.mirror();
  }

  /** For the console (allocates). */
  report(): Record<string, unknown> {
    const n = (x: number) => Math.round(x * 10) / 10;
    const s = this.stats;
    const c = this.cond;
    return {
      shields: [n(c.shield[0]), n(c.shield[1])],
      shieldMax: s.shieldMax.map(n),
      armour: [n(c.armour[0]), n(c.armour[1])],
      armourMax: s.armourMax.map(n),
      chassis: n(c.chassis),
      chassisMax: n(s.chassisMax),
      hp: n(this.hull.hp),
      parts: c.parts.map((p) => ({ slot: p.slot, hp: n(p.hp), max: n(p.max), down: p.down })),
      down: [...this.downList],
      guns: s.guns.map((g) => ({ slot: g.slot, name: g.name, projectile: g.projectile, damage: n(g.damage), speed: g.speed, range: g.range })),
      refire: n(s.refire * 100) / 100,
      interval: Math.round(this.interval() * 1000) / 1000,
      boost: { left: n(this.boostLeft), seconds: n(s.boostSeconds) },
      speed: { top: n(this.hull.spec.maxSpeed), boost: n(this.hull.spec.boostSpeed), undamaged: n(s.handling.maxSpeed) },
      turn: n(this.hull.spec.turnRate * 100) / 100,
      tally: { ...this.tally },
      lastSourceKey: this.lastSourceKey,
      god: this.god,
      bands: this.places.map((p) => (p.active >= 0 ? p.bands[p.active].particle : null)).filter(Boolean),
    };
  }

  /** Removes its damage-band effect handles (safe to call twice). */
  dispose(): void {
    for (const p of this.places) {
      if (p.handle !== null) this.fx?.remove(p.handle);
      p.handle = null;
      p.active = -1;
    }
    this.bandShare = -1;
  }
}
