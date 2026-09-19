// A ship's numbers in a fight. The game's tables say which components exist and which slots take
// them; what any of them was worth was the server's and did not ship. So every number here is
// INVENTED: speed, turn, shields, armour, chassis and component hit points, damage, refire, boost,
// and the grade read from a component's name. They are kept in this one file to be tuned.
//
// Pure: no three, no rapier; node's tests import it straight from source.
import type { ComponentWeapon } from '../vehicles/shipFit.ts';

export type Grade = 1 | 2 | 3 | 4 | 5;

/** The handling a vehicle already has: its own spec's numbers (specFor's, per vehicle). */
export interface Handling {
  maxSpeed: number;
  boostSpeed: number;
  accel: number;
  brake: number;
  turnRate: number;
  inertia: number;
}

/** How a hull is treated: 'big' for a hull over 18 m (specFor's own test), 'bomber' for a smaller hull the manifest calls a bomber (but BOMBER_AS_FIGHTER), else 'fighter'. */
export type HullClass = 'fighter' | 'bomber' | 'big';

/** Hulls the game's data calls bombers that fly as fighters (Vader's TIE Advanced). */
export const BOMBER_AS_FIGHTER: readonly string[] = ['tieadvanced', 'tieadvanced_modified'];

/** The handling class's change to the spec a vehicle already has (invented): fighters and big hulls keep it, small bombers fly slower and turn heavier. */
export const CLASS_HANDLING: Record<HullClass, { speed: number; accel: number; turn: number }> = {
  fighter: { speed: 1, accel: 1, turn: 1 },
  bomber: { speed: 0.82, accel: 0.75, turn: 0.77 },
  big: { speed: 1, accel: 1, turn: 1 },
};

/** Durability and firepower by class at grade 2 and tier 2 (invented). */
export const CLASS_BASE: Record<HullClass, { chassis: number; armour: number; shield: number; part: number; damage: number; refire: number }> = {
  fighter: { chassis: 300, armour: 120, shield: 140, part: 80, damage: 30, refire: 0.5 },
  bomber: { chassis: 450, armour: 180, shield: 160, part: 110, damage: 38, refire: 0.6 },
  big: { chassis: 900, armour: 300, shield: 300, part: 160, damage: 34, refire: 0.55 },
};

/** Per family (the hull id without a style): speed, agility and hull over the class, 1 being none (invented). */
export const FAMILY_TRAITS: Record<string, { speed?: number; agility?: number; hull?: number }> = {
  awing: { speed: 1.15, agility: 1.15, hull: 0.8 },
  tieinterceptor: { speed: 1.15, agility: 1.2, hull: 0.8 },
  tieinterceptor_imperial_guard: { speed: 1.15, agility: 1.2, hull: 0.9 },
  tiefighter: { agility: 1.1, hull: 0.75 },
  tiebomber: { hull: 1.3 },
  ywing: { hull: 1.3 },
  bwing: { hull: 1.2 },
  tieadvanced: { speed: 1.1, hull: 1.1 },
  tieoppressor: { hull: 1.2 },
  tieaggressor: { hull: 1.1 },
};

/** Durability and damage by grade (grade 2 is 1). */
export const gradeScale = (g: Grade): number => 0.8 + 0.1 * g;
/** Top speed by the engine's grade. */
export const speedScale = (g: Grade): number => 0.95 + 0.025 * g;
/** Durability by tier (tier 2 is 1; tier 0, a ship a player flies, is 1). */
export const tierDurability = (t: number): number => (t ? 0.6 + 0.2 * t : 1);
/** Damage by tier (tier 0 is 1). */
export const tierDamage = (t: number): number => (t ? 0.7 + 0.15 * t : 1);

/** A shield's regeneration a second, as a share of its maximum, after SHIELD_DELAY seconds without a hit. */
export const SHIELD_REGEN = 0.08;
export const SHIELD_DELAY = 4;
/** Boost seconds at grade 2 (scaled by the booster's grade) and the share of a full boost recharged a second. */
export const BOOST_SECONDS = 6;
export const BOOST_RECHARGE = 0.25;
/** The slots whose component is a part that can be hit and go down. */
export const PART_SLOTS = /^(reactor|engine|shield_0|capacitor|booster|droid_interface|weapon_\d+)$/;

export interface WeaponStat {
  slot: string;
  name: string;
  projectile: number;
  speed: number;
  range: number;
  damage: number;
}

export interface ShipStats {
  /** What goes into the vehicle's spec (planet units: flyShip doubles the speeds in space). */
  handling: Handling;
  /** Front and back. */
  shieldMax: [number, number];
  /** Per second, once `shieldDelay` seconds have passed without a hit. */
  shieldRegen: number;
  shieldDelay: number;
  /** Front (armor_0) and back (armor_1). */
  armourMax: [number, number];
  chassisMax: number;
  parts: { slot: string; max: number; weight: number; targetable: boolean }[];
  /** Seconds between shots of the whole ship with two live guns (more guns fire faster, up to twice as fast). */
  refire: number;
  /** Gun slots only (a `wpn_0` slot whose component is a bolt weapon), in slot order; `guns[0]` is the hull guns' slot. */
  guns: WeaponStat[];
  boostSeconds: number;
  /** Share of a full boost regained a second. */
  boostRecharge: number;
}

export interface StatInput {
  hullClass: HullClass;
  family: string;
  /** 1..5 for an NPC; 0 for a ship a player flies. */
  tier: number;
  base: Handling;
  /** The chassis's slots: compatibility from the fit, weight and targetable from combat.json. */
  slots: Record<string, { compat: readonly string[]; hitweight: number; targetable: boolean }>;
  /** ResolvedFit.components (slot -> component name or null). */
  components: Readonly<Record<string, string | null>>;
  /** The stock component per slot: a player's grades are counted from it, so a stock ship keeps its spec's handling. */
  stock: Readonly<Record<string, string | null>>;
  weaponOf(name: string): ComponentWeapon | null;
  /** The hull's own gun (the manifest's `weapon`), for a hull whose fit gives it none. */
  defaultWeapon: { name: string; projectile: number; speed: number; range: number } | null;
}

/** The words a name is graded by (invented), best first: a name with two is graded by the better. */
const GRADE_WORDS: [Grade, readonly string[]][] = [
  [5, ['experimental', 'prototype', 'kessel', 'reward', 'collection']],
  [4, ['advanced', 'deluxe', 'elite']],
  [3, ['improved', 'enhanced', 'heavy']],
  [1, ['cheap', 'light', 'basic', 'generic', 'mini']],
];
const MARK = /^(?:mk|mark)_?(\d)$/;

/** A component's grade from its name (invented rule): mkN or markN is N; else by its words; anything else 2. */
export function gradeOf(component: string | null | undefined): Grade {
  if (!component) return 2;
  const words = component.toLowerCase().split(/[_\s-]+/);
  for (const w of words) {
    const m = MARK.exec(w);
    if (m) return Math.min(5, Math.max(1, Number(m[1]))) as Grade;
  }
  for (const [g, list] of GRADE_WORDS) if (words.some((w) => list.includes(w))) return g;
  return 2;
}

export function hullClassOf(manifestClass: string | undefined, big: boolean, family: string): HullClass {
  if (big) return 'big';
  if (manifestClass === 'bomber' && !BOMBER_AS_FIGHTER.includes(family)) return 'bomber';
  return 'fighter';
}

/** A hull id's family: the id without a style suffix (`blacksun_light_s01` -> `blacksun_light`). */
export function familyOf(hullId: string): string {
  return hullId.replace(/_s\d\d$/, '');
}

/** A weapon that fires bolts (not a missile, countermeasures, a tractor, a beam or a mining laser). */
function firesBolts(w: ComponentWeapon | null | undefined): w is ComponentWeapon {
  return !!w && !w.missile && !w.countermeasure && !w.tractor && !w.beam && !w.mining;
}

/** `weapon_3` -> 3, anything else a large number (so the weapon slots sort in their own order). */
function slotNumber(slot: string): number {
  const m = /_(\d+)$/.exec(slot);
  return m ? Number(m[1]) : 1e6;
}

/**
 * A ship's numbers (all invented). Handling starts from the vehicle's own spec, so a stock player fighter
 * or big hull with no family trait flies exactly as before: the class, the family's trait and the engine's
 * grade against the reference (the stock engine's for a player's ship, grade 2 for an NPC) change it.
 * Durability and firepower come from the class, each component's grade and the tier.
 */
export function statsFor(input: StatInput): ShipStats {
  const { hullClass, family, tier, base, slots, components } = input;
  const trait = FAMILY_TRAITS[family] ?? {};
  const cls = CLASS_HANDLING[hullClass];
  const bc = CLASS_BASE[hullClass];
  const has = (slot: string): boolean => Object.prototype.hasOwnProperty.call(slots, slot);
  const comp = (slot: string): string | null => components[slot] ?? null;
  // The engine's grade against the reference; an empty engine slot, or none, leaves the speed alone.
  let engine = 1;
  const eng = comp('engine');
  if (has('engine') && eng) {
    const ref: Grade = tier === 0 ? gradeOf(input.stock.engine ?? eng) : 2;
    engine = speedScale(gradeOf(eng)) / speedScale(ref);
  }
  const speed = cls.speed * (trait.speed ?? 1) * engine;
  const agility = trait.agility ?? 1;
  const handling: Handling = {
    maxSpeed: base.maxSpeed * speed,
    boostSpeed: base.boostSpeed * speed,
    accel: base.accel * cls.accel,
    brake: base.brake * cls.accel,
    turnRate: base.turnRate * cls.turn * agility,
    inertia: base.inertia / agility,
  };
  const dur = tierDurability(tier);
  const shield = has('shield_0') ? bc.shield * gradeScale(gradeOf(comp('shield_0'))) * dur : 0;
  const armour = (slot: string): number => (has(slot) ? bc.armour * gradeScale(gradeOf(comp(slot))) * dur : 0);
  const parts: ShipStats['parts'] = [];
  for (const slot of Object.keys(slots)) {
    if (!PART_SLOTS.test(slot)) continue;
    const s = slots[slot];
    parts.push({ slot, max: bc.part * gradeScale(gradeOf(comp(slot))), weight: Math.max(0, s.hitweight), targetable: !!s.targetable });
  }
  const damageOf = (name: string): number => bc.damage * gradeScale(gradeOf(name)) * tierDamage(tier);
  const guns: WeaponStat[] = [];
  const gunSlots = Object.keys(slots)
    .filter((s) => /^weapon_\d+$/.test(s) && slots[s].compat.includes('wpn_0'))
    .sort((a, b) => slotNumber(a) - slotNumber(b));
  for (const slot of gunSlots) {
    const name = comp(slot);
    if (!name) continue;
    const w = input.weaponOf(name);
    if (!firesBolts(w)) continue;
    guns.push({ slot, name, projectile: w.projectile, speed: w.speed, range: w.range, damage: damageOf(name) });
  }
  if (!guns.length && input.defaultWeapon) {
    const d = input.defaultWeapon;
    guns.push({ slot: 'weapon_0', name: d.name, projectile: d.projectile, speed: d.speed, range: d.range, damage: damageOf(d.name) });
  }
  return {
    handling,
    shieldMax: [shield, shield],
    shieldRegen: SHIELD_REGEN * shield,
    shieldDelay: SHIELD_DELAY,
    armourMax: [armour('armor_0'), armour('armor_1')],
    chassisMax: bc.chassis * dur * (trait.hull ?? 1),
    parts,
    refire: bc.refire / gradeScale(gradeOf(comp('capacitor'))),
    guns,
    boostSeconds: has('booster') ? BOOST_SECONDS * gradeScale(gradeOf(comp('booster'))) : 0,
    boostRecharge: BOOST_RECHARGE,
  };
}

const r2 = (n: number): string => String(Math.round(n * 100) / 100);

/** The Edit page's line for a component in a slot (the numbers are the invented ones above, for a fighter). */
export function componentLine(slot: string, component: { name: string; type: string; weapon?: ComponentWeapon }): string {
  const g = gradeOf(component.name);
  const w = component.weapon;
  if (w) {
    if (!firesBolts(w)) return `grade ${g} · not flown yet`;
    return `grade ${g} · ${Math.round(CLASS_BASE.fighter.damage * gradeScale(g))} damage · ${Math.round(w.speed)} m/s · ${Math.round(w.range)} m`;
  }
  if (component.type === 'engine' || slot === 'engine') return `grade ${g} · top speed ×${r2(speedScale(g) / speedScale(2))}`;
  if (component.type === 'booster' || slot === 'booster') return `grade ${g} · ${r2(BOOST_SECONDS * gradeScale(g))} s of boost`;
  if (component.type === 'capacitor' || slot === 'capacitor') return `grade ${g} · fire rate ×${r2(gradeScale(g))}`;
  if (/^(cargo_hold|modification|bridge|hangar|targeting_station)$/.test(component.type)) return `grade ${g}`;
  return `grade ${g} · ×${r2(gradeScale(g))} hit points`;
}
