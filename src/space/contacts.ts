// The ships that fight: every ship vehicle in the world (NPC ships, the player's, idle garage ships)
// as a contact beside the world's living list, not in it (the ground brains and the Force powers never
// see a hull). Each contact is a `Living` (a key, a side, damage that carries who struck) so blame and
// retaliation work as everywhere else; its condition is its ShipCombat. The player is found again
// through `find(PLAYER_KEY)`, which answers with the ship the player flies, or the player on foot.
import * as THREE from 'three';
import { NOBODY, PLAYER_KEY, nextLivingKey, type Aggression, type Living, type Side } from '../combat/kit';
import type { Bolts } from '../combat/bolts';
import type { Effects } from '../combat/effects';
import type { EffectHandle, ParticleEffects } from '../world/particles';
import type { Garage } from '../vehicles/garage';
import type { Vehicle } from '../vehicles/vehicle';
import { anyHardpoint } from '../vehicles/shipAssembly';
import { CombatData, type NpcTypeDef } from './combatData.ts';
import { aggressionOfFaction, sideOfFaction, type ShipFaction } from './factions.ts';
import { ShipCombat, blameKey, blamed, stockFor, targetable, type CombatFx, type CombatHooks } from './shipCombat.ts';
import type { HitResult } from './shipDamage.ts';
import { familyOf, hullClassOf, type Handling, type StatInput } from './shipStats.ts';
import { TauntGate, fillTaunt, pickLine, type TauntEvent } from './taunts.ts';

/** The slots a ship is given when neither its fit nor combat.json says (an older pack): a fighter's systems, each weighing 10. */
const DEFAULT_SLOTS: StatInput['slots'] = {
  reactor: { compat: ['rct_0'], hitweight: 10, targetable: true },
  engine: { compat: ['eng_0'], hitweight: 10, targetable: true },
  shield_0: { compat: ['shd_0'], hitweight: 10, targetable: false },
  armor_0: { compat: ['arm_0'], hitweight: 10, targetable: false },
  armor_1: { compat: ['arm_0'], hitweight: 10, targetable: false },
  capacitor: { compat: ['cap_0'], hitweight: 10, targetable: false },
  booster: { compat: ['bst_0'], hitweight: 10, targetable: false },
};

export class ShipContact implements Living {
  readonly key = nextLivingKey();
  label: string;
  side: Side;
  aggression: Aggression;
  faction: ShipFaction;
  readonly baseFaction: ShipFaction;
  readonly vehicle: Vehicle;
  combat: ShipCombat | null = null;
  /** The NPC type when an NPC flies it. */
  type: NpcTypeDef | null;
  /** Who hurt it last and when (retaliation memory), by key; PLAYER_KEY for the player in any form. */
  lastAttacker = NOBODY;
  lastAttackedAt = -Infinity;

  constructor(vehicle: Vehicle, faction: ShipFaction, type: NpcTypeDef | null) {
    this.vehicle = vehicle;
    this.baseFaction = faction;
    this.type = type;
    this.label = type?.name ?? vehicle.def?.label ?? vehicle.spec.label;
    this.faction = faction;
    this.side = sideOfFaction(faction);
    this.aggression = aggressionOfFaction(faction);
  }

  /** Fly for another faction (the player's ship while the player flies it), or back to its own. */
  setFaction(f: ShipFaction): void {
    this.faction = f;
    this.side = sideOfFaction(f);
    this.aggression = aggressionOfFaction(f);
  }

  get pos(): THREE.Vector3 {
    return this.vehicle.pos;
  }

  get halfHeight(): number {
    return this.vehicle.halfHeight;
  }

  get dead(): boolean {
    return this.vehicle.destroyed || this.vehicle.disposed;
  }

  /** In a jump: nothing may pick or strike it. */
  get ghosted(): boolean {
    return this.vehicle.ghosted;
  }

  /** Alive and not in a jump (shipCombat.ts `targetable`). */
  get targetable(): boolean {
    return targetable(this);
  }

  damage(amount: number, from?: THREE.Vector3, push?: number, source?: Living | null): void {
    this.vehicle.damage(amount, from, push, source);
  }

  radiusToward(from: THREE.Vector3): number {
    void from;
    return this.vehicle.radius;
  }
}

const boom = new THREE.Matrix4();

export class ShipContacts {
  readonly list: ShipContact[] = [];
  data: CombatData | null = null;
  /** Set by the game: a taunt line to show (speaker, text, faction). */
  onTaunt: (speaker: string, text: string, faction: ShipFaction) => void = () => {};
  /** Set by the game: told when a ship has been destroyed (after its explosion and taunt), with who struck last. */
  onShipDown: (v: Vehicle, killer: Living | null) => void = () => {};
  /** Set by the game: the player's character name for the taunts. */
  playerName = '';
  /** The player's ship's contact while the player flies one (set by sync), else null. */
  playerShip: ShipContact | null = null;
  /** The player on foot (world.playerTarget), kept by sync. */
  playerTarget: Living | null = null;
  /** The taunts' own random numbers (the chances, the lines). */
  rng: () => number = Math.random;
  private readonly byVehicle = new Map<Vehicle, ShipContact>();
  /** The handling each vehicle had before a combat first wrote its spec: a re-adopt starts from it. */
  private readonly bases = new WeakMap<Vehicle, Handling>();
  private readonly gate: TauntGate;
  private readonly fx: CombatFx;
  private readonly hooks: CombatHooks;
  private readonly shipFx: ParticleEffects;
  private readonly bolts: Bolts;
  private readonly garage: () => Garage | null;
  private loading: Promise<void> | null = null;
  private preparing: Promise<void> | null = null;
  private now = 0;

  constructor(shipFx: ParticleEffects, bolts: Bolts, effects: () => Effects | null, garage: () => Garage | null) {
    this.shipFx = shipFx;
    this.bolts = bolts;
    this.garage = garage;
    this.gate = new TauntGate(() => this.rng());
    this.fx = {
      place: (file, matrix, transient, frame) => shipFx.place(file, matrix, false, transient, frame),
      remove: (handle) => shipFx.remove(handle as EffectHandle),
      flash: (at, color, intensity, distance, seconds) => effects()?.flash(at, color, intensity, distance, seconds),
      hardpoint: (root, name) => anyHardpoint(root, name),
    };
    this.hooks = { now: () => this.now, struck: (combat, source, result) => this.struck(combat, source, result) };
  }

  /** CombatData.load, once. */
  load(baseUrl: string): Promise<void> {
    this.loading ??= CombatData.load(baseUrl).then((d) => {
      this.data = d;
      if (d) console.info(`combat: ${d.file.types.length} NPC ship types, ${Object.keys(d.file.chassis).length} chassis rows`);
      else console.info('combat: no combat.json in the ships pack; no NPC ships (convert the ships again)');
      if (!d) return;
      // Ships adopted before the file arrived (an early arrival in a ship): its hit effects, damage bands and slot weights now, their condition's shares kept.
      for (const c of this.list) {
        const combat = c.combat;
        if (!combat || c.vehicle.disposed) continue;
        combat.setEffects(d.hullFx(c.vehicle.def?.id ?? c.vehicle.spec.id), d.file.hitEffects);
        combat.restat(this.inputFor(c.vehicle, c.type));
      }
    });
    return this.loading;
  }

  /** Before the loading screen's compile: every combat effect's batches made (hidden) and textures uploaded, and the projectiles'. */
  prepareEffects(renderer: THREE.WebGLRenderer): Promise<void> {
    if (this.preparing) return this.preparing;
    const run = (async () => {
      await (this.loading ?? Promise.resolve());
      const files = new Set(this.data?.effectFiles() ?? []);
      const g = this.garage();
      for (const p of g?.projectiles.values() ?? []) {
        if (p.effect) files.add(p.effect);
        for (const h of [p.hit.metal, p.hit.other, p.hit.shield]) if (h) files.add(h);
      }
      const seen = new Set<string>();
      await Promise.all([...files].map((f) => this.shipFx.prepare(f, renderer, seen).catch(() => false)));
    })();
    // A later world (another garage, a reconversion) prepares again; the effects already made cost a lookup.
    this.preparing = run.finally(() => {
      this.preparing = null;
    });
    return this.preparing;
  }

  /** Keep the list in step with the world's ship vehicles (no allocation when nothing changed); adopt a combat for any ship without one; mark the player's ship. */
  sync(vehicles: readonly Vehicle[], playerShip: Vehicle | null, playerTarget: Living, now: number): void {
    this.now = now;
    this.playerTarget = playerTarget;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      if (c.vehicle.disposed || !vehicles.includes(c.vehicle)) this.drop(i);
    }
    for (const v of vehicles) {
      if (!v.spec.ship || v.disposed || this.byVehicle.has(v)) continue;
      this.adopt(v, { faction: 'neutral' });
    }
    const pc = playerShip ? (this.byVehicle.get(playerShip) ?? null) : null;
    if (pc !== this.playerShip) {
      if (this.playerShip) this.playerShip.setFaction(this.playerShip.baseFaction);
      this.playerShip = pc;
      if (pc) pc.setFaction('player');
    }
  }

  /** Take contact `i` out (its vehicle went): its combat's effects go; the vehicle is the world's to dispose. */
  private drop(i: number): void {
    const c = this.list[i];
    const last = this.list.length - 1;
    if (i !== last) this.list[i] = this.list[last];
    this.list.length = last;
    if (this.byVehicle.get(c.vehicle) === c) this.byVehicle.delete(c.vehicle);
    if (this.playerShip === c) this.playerShip = null;
    c.combat?.dispose();
  }

  /** The contact for a vehicle, or null. */
  of(v: Vehicle | null | undefined): ShipContact | null {
    return v ? (this.byVehicle.get(v) ?? null) : null;
  }

  /** By key: PLAYER_KEY is the player's ship's contact while the player flies, else the player on foot. */
  find(key: number): Living | null {
    return blamed<Living>(key, this.list, this.playerShip, this.playerTarget);
  }

  /** The key a blow's source is remembered by: the player in any form (on foot, or the ship they fly) is PLAYER_KEY (shipCombat.ts `blameKey`). */
  keyOf(source: Living | null): number {
    return blameKey(source, this.playerShip);
  }

  /** Make a combat for a ship (and its contact): the stat input from the vehicle's fit and its chassis, or defaults. Adopting again re-types it. */
  adopt(v: Vehicle, opts: { faction: ShipFaction; type?: NpcTypeDef | null }): ShipCombat {
    const type = opts.type ?? null;
    const had = this.byVehicle.get(v);
    if (had?.combat && had.type === type && had.baseFaction === opts.faction) return had.combat;
    if (had) this.drop(this.list.indexOf(had));
    if (!this.bases.has(v)) {
      const s = v.spec;
      this.bases.set(v, { maxSpeed: s.maxSpeed, boostSpeed: s.boostSpeed, accel: s.accel, brake: s.brake, turnRate: s.turnRate, inertia: s.inertia ?? 0.5 });
    }
    const contact = new ShipContact(v, opts.faction, type);
    const hullFx = this.data?.hullFx(v.def?.id ?? v.spec.id) ?? null;
    const combat = new ShipCombat(v, contact, this.inputFor(v, type), this.fx, hullFx, this.data?.file.hitEffects ?? null);
    combat.hooks = this.hooks;
    contact.combat = combat;
    v.combat = combat;
    this.list.push(contact);
    this.byVehicle.set(v, contact);
    return combat;
  }

  /** The stats' input for a vehicle: its hull's class and family, its chassis's slots (the fit's compatibility, combat.json's weights), its fit's components, its guns. */
  inputFor(v: Vehicle, type: NpcTypeDef | null): StatInput {
    const def = v.def;
    const id = def?.id ?? v.spec.id;
    const family = familyOf(type?.hull ?? id);
    const b = v.spec.bounds;
    // The manifest's class: VehicleDef.class, else the "(class)" the garage writes after a ship's label.
    const cls = (def as { class?: string } | null)?.class ?? /\((\w+)\)\s*$/.exec(def?.label ?? '')?.[1];
    const fitDef = (type ? this.data?.chassis(type.chassis)?.fit : null) ?? def?.fit ?? null;
    const chassisName = type ? type.chassis : (def?.fit?.chassis ?? `player_${id}`);
    const rows = this.data?.chassis(chassisName)?.slots ?? {};
    const slots: StatInput['slots'] = {};
    for (const s of fitDef?.slots ?? []) slots[s.slot] = { compat: s.compat, hitweight: rows[s.slot]?.hitweight ?? 10, targetable: rows[s.slot]?.targetable ?? false };
    for (const [slot, r] of Object.entries(rows)) if (!slots[slot]) slots[slot] = { compat: r.compat ?? [], hitweight: r.hitweight, targetable: r.targetable };
    const stock = stockFor(type !== null, fitDef?.slots);
    const g = this.garage();
    const weapon = def?.weapon ?? v.weapon;
    return {
      hullClass: hullClassOf(cls, b.max[2] - b.min[2] > 18, family),
      family,
      tier: type?.tier ?? 0,
      base: this.bases.get(v) ?? { maxSpeed: v.spec.maxSpeed, boostSpeed: v.spec.boostSpeed, accel: v.spec.accel, brake: v.spec.brake, turnRate: v.spec.turnRate, inertia: v.spec.inertia ?? 0.5 },
      slots: Object.keys(slots).length ? slots : DEFAULT_SLOTS,
      components: v.fit?.components ?? {},
      stock,
      weaponOf: (name) => {
        const i = g?.componentByName.get(name);
        return i === undefined ? null : (g?.components[i]?.weapon ?? null);
      },
      defaultWeapon: weapon ? { name: weapon.name, projectile: weapon.projectile, speed: weapon.speed, range: weapon.range } : null,
    };
  }

  /** Stats again after a refit (World.refitVehicle calls it). */
  refit(v: Vehicle): void {
    const c = this.byVehicle.get(v);
    if (c?.combat) c.combat.restat(this.inputFor(v, c.type));
  }

  /** A ship has just been destroyed: its explosion, the death taunt (only for the player's kill), then onShipDown. */
  onDestroyed(v: Vehicle): void {
    const c = this.byVehicle.get(v);
    const file = this.data?.hullFx(v.def?.id ?? v.spec.id)?.destroyed;
    if (file) {
      v.group.updateMatrixWorld(true);
      boom.copy(v.group.matrixWorld);
      this.shipFx.place(file, boom, false, true);
    }
    const killerKey = c?.combat?.lastSourceKey ?? NOBODY;
    if (c && c.type && killerKey === PLAYER_KEY) this.taunt(c, 'death');
    this.onShipDown(v, this.find(killerKey));
  }

  /** Raise a taunt for a contact (the gate and the chances apply unless `force`); true when a line was shown. */
  taunt(c: ShipContact, event: TauntEvent, force = false): boolean {
    if (!c.type || !this.data) return false;
    const lines = this.data.taunts(c.type.taunts)?.[event];
    if (!lines?.length) return false;
    if (!force && !this.gate.want(c.key, event, this.now)) return false;
    const line = pickLine(lines, this.rng);
    if (!line) return false;
    this.onTaunt(c.label, fillTaunt(line, this.playerName), c.baseFaction);
    return true;
  }

  /** A blow landed on a ship: who struck is remembered (the player in any form as PLAYER_KEY), the shooter's tally, the taunts. */
  private struck(combat: ShipCombat, source: Living | null, result: HitResult): void {
    void result;
    if (!source) return;
    const c = combat.contact;
    const key = this.keyOf(source);
    combat.lastSourceKey = key;
    c.lastAttacker = key;
    c.lastAttackedAt = this.now;
    const shooter = source instanceof ShipContact ? source : null;
    if (shooter?.combat) shooter.combat.tally.hits++;
    if (key === PLAYER_KEY && c.type) this.taunt(c, 'gothit');
    if (c === this.playerShip && shooter?.type) this.taunt(shooter, 'hityou');
  }

  /** How many bolts in the air an NPC ship fired (an index loop, nothing allocated). */
  npcBolts(): number {
    let n = 0;
    for (const b of this.bolts.bolts) if (b.source instanceof ShipContact && b.source.type !== null) n++;
    return n;
  }

  /** Every combat's update; nothing regenerates or cools down while paused. */
  update(dt: number, now: number, simulating: boolean): void {
    this.now = now;
    if (!simulating) return;
    for (const c of this.list) c.combat?.update(dt, now, c.vehicle.boosting);
  }

  /** A world unload: every contact dropped (their vehicles are the world's to dispose). */
  clear(): void {
    for (const c of this.list) c.combat?.dispose();
    this.list.length = 0;
    this.byVehicle.clear();
    this.playerShip = null;
    this.gate.clear();
  }
}
