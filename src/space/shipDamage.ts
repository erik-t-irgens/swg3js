// How a ship takes a blow, layer by layer: the shield on the face that was struck, then that face's
// armour, then the chassis, with a chance that a component takes it too. The layering, the leak and
// every share here are INVENTED (the server's rules did not ship); the game's own part is only which
// hit effect each layer plays (ship_hit_effects.iff).
//
// Pure: no three, no rapier; node's tests import it straight from source. Nothing allocates per hit:
// the caller's HitResult is filled.
import type { ShipStats } from './shipStats.ts';

export type Layer = 'shield' | 'armor' | 'component' | 'chassis';
/** Light, medium, heavy: which of the layer's three effects plays. */
export type Weight = 0 | 1 | 2;

export interface PartState {
  slot: string;
  hp: number;
  max: number;
  weight: number;
  down: boolean;
}

export interface ShipCondition {
  shield: [number, number];
  armour: [number, number];
  chassis: number;
  parts: PartState[];
  /** Seconds since the last hit. */
  sinceHit: number;
}

export interface HitResult {
  /** The deepest layer the blow reached. */
  layer: Layer;
  facing: 0 | 1;
  /** The part that took it as well, or null. */
  part: string | null;
  partDown: boolean;
  shieldDown: boolean;
  armourBreached: boolean;
  destroyed: boolean;
  weight: Weight;
  /** What the blow took off in all (shield, armour and chassis; a part's share is not counted twice). */
  dealt: number;
}

/** The chance a blow that reaches the chassis also strikes a component (invented). */
export const COMPONENT_CHANCE = 0.35;

/** A fresh result to fill, one per caller. */
export function newHitResult(): HitResult {
  return { layer: 'shield', facing: 0, part: null, partDown: false, shieldDown: false, armourBreached: false, destroyed: false, weight: 0, dealt: 0 };
}

/** Seconds since a hit for a ship never hit. */
const LONG_AGO = 1e9;

export function createCondition(stats: ShipStats): ShipCondition {
  return {
    shield: [stats.shieldMax[0], stats.shieldMax[1]],
    armour: [stats.armourMax[0], stats.armourMax[1]],
    chassis: stats.chassisMax,
    parts: stats.parts.map((p) => ({ slot: p.slot, hp: p.max, max: p.max, weight: p.weight, down: false })),
    sinceHit: LONG_AGO,
  };
}

const shareOf = (value: number, max: number): number => (max > 0 ? Math.max(0, Math.min(1, value / max)) : 1);

/** Keep the condition's shares when the stats change (a refit): each value scaled to its new maximum; parts matched by slot (a new slot's part is whole, a part that was down stays down). */
export function rescaleCondition(c: ShipCondition, from: ShipStats, to: ShipStats): void {
  for (const i of [0, 1] as const) {
    c.shield[i] = to.shieldMax[i] * shareOf(c.shield[i], from.shieldMax[i]);
    c.armour[i] = to.armourMax[i] * shareOf(c.armour[i], from.armourMax[i]);
  }
  c.chassis = to.chassisMax * shareOf(c.chassis, from.chassisMax);
  const old = c.parts.slice();
  c.parts.length = 0;
  for (const p of to.parts) {
    const was = old.find((o) => o.slot === p.slot);
    const share = was ? shareOf(was.hp, was.max) : 1;
    const down = !!was?.down;
    c.parts.push({ slot: p.slot, hp: down ? 0 : p.max * share, max: p.max, weight: p.weight, down });
  }
}

function reset(out: HitResult, facing: 0 | 1): void {
  out.layer = 'shield';
  out.facing = facing;
  out.part = null;
  out.partDown = false;
  out.shieldDown = false;
  out.armourBreached = false;
  out.destroyed = false;
  out.weight = 0;
  out.dealt = 0;
}

/** A live part picked by hit weight (`pick` 0..1), or null when none is live. */
function pickPart(c: ShipCondition, pick: number): PartState | null {
  let total = 0;
  for (const p of c.parts) if (!p.down && p.weight > 0) total += p.weight;
  if (total <= 0) return null;
  let at = Math.max(0, Math.min(0.999999, pick)) * total;
  for (const p of c.parts) {
    if (p.down || p.weight <= 0) continue;
    at -= p.weight;
    if (at < 0) return p;
  }
  return null;
}

/** What passes the face's armour to the chassis; the armour's own part of the blow. Returns what is left. */
function throughArmour(c: ShipCondition, left: number, facing: 0 | 1, out: HitResult): number {
  const ar = c.armour[facing];
  if (left <= 0 || ar <= 0) return left;
  const take = Math.min(ar, left);
  c.armour[facing] = ar - take;
  out.dealt += take;
  out.layer = 'armor';
  if (c.armour[facing] <= 1e-6) {
    c.armour[facing] = 0;
    out.armourBreached = true;
  }
  return left - take;
}

function intoChassis(c: ShipCondition, left: number, out: HitResult): void {
  if (left <= 0) return;
  const take = Math.min(c.chassis, left);
  c.chassis -= take;
  out.dealt += take;
  out.layer = 'chassis';
  if (c.chassis <= 1e-6) {
    c.chassis = 0;
    out.destroyed = true;
  }
}

/**
 * One blow on a face (0 front, 1 back); `roll` and `pick` are 0..1 (the caller's random numbers, so tests are exact).
 * The face's shield takes it first, then that face's armour, then the chassis; with chance COMPONENT_CHANCE (`roll`)
 * a live component picked by hit weight (`pick`) takes what reached the chassis as well. The layer reported is the
 * deepest reached, a struck component counting as 'component'. A ship already destroyed takes nothing. Fills `out`.
 */
export function applyHit(c: ShipCondition, stats: ShipStats, amount: number, facing: 0 | 1, roll: number, pick: number, out: HitResult): HitResult {
  reset(out, facing);
  if (c.chassis <= 0 || !(amount > 0)) {
    out.layer = c.chassis <= 0 ? 'chassis' : 'shield';
    return out;
  }
  c.sinceHit = 0;
  let left = amount;
  const sh = c.shield[facing];
  if (sh > 0) {
    const take = Math.min(sh, left);
    c.shield[facing] = sh - take;
    out.dealt += take;
    left -= take;
    if (c.shield[facing] <= 1e-6) {
      c.shield[facing] = 0;
      out.shieldDown = true;
    }
  }
  left = throughArmour(c, left, facing, out);
  if (left > 0) {
    const reached = left;
    intoChassis(c, left, out);
    if (roll < COMPONENT_CHANCE) {
      const part = pickPart(c, pick);
      if (part) {
        part.hp = Math.max(0, part.hp - reached);
        out.part = part.slot;
        if (!out.destroyed) out.layer = 'component';
        if (part.hp <= 1e-6) {
          part.hp = 0;
          part.down = true;
          out.partDown = true;
        }
      }
    }
  }
  out.weight = weightOf(out.dealt, stats);
  return out;
}

/** A collision: skips the shield, onto the armour of the face that hit, then the chassis. Fills `out`. */
export function applyCollision(c: ShipCondition, stats: ShipStats, amount: number, facing: 0 | 1, out: HitResult): HitResult {
  reset(out, facing);
  out.layer = 'armor';
  if (c.chassis <= 0 || !(amount > 0)) return out;
  c.sinceHit = 0;
  const left = throughArmour(c, amount, facing, out);
  intoChassis(c, left, out);
  out.weight = weightOf(out.dealt, stats);
  return out;
}

/**
 * The speed the other ship lost in a contact one ship measured (`lost`, m/s): the momentum the contact moved is the
 * same both ways, so the other's loss is this one's times this mass over the other's. Zero for a massless pair.
 */
export function partnerLoss(lost: number, mass: number, otherMass: number): number {
  if (!(lost > 0) || !(mass > 0)) return 0;
  return (lost * mass) / Math.max(1e-6, otherMass);
}

/** Shields back after a quiet spell; nothing while the generator or the reactor is down. */
export function regenerate(c: ShipCondition, stats: ShipStats, generatorUp: boolean, reactorUp: boolean, dt: number): void {
  c.sinceHit = Math.min(LONG_AGO, c.sinceHit + dt);
  if (!generatorUp || !reactorUp || c.chassis <= 0 || c.sinceHit < stats.shieldDelay) return;
  // Unrolled: this runs every frame for every ship, and a loop over a literal would allocate it.
  const step = stats.shieldRegen * dt;
  if (c.shield[0] < stats.shieldMax[0]) c.shield[0] = Math.min(stats.shieldMax[0], c.shield[0] + step);
  if (c.shield[1] < stats.shieldMax[1]) c.shield[1] = Math.min(stats.shieldMax[1], c.shield[1] + step);
}

/** A blow's weight by its share of the front's shield + armour + the chassis: under 3% light, under 8% medium, else heavy. */
export function weightOf(dealt: number, stats: ShipStats): Weight {
  const total = stats.shieldMax[0] + stats.armourMax[0] + stats.chassisMax;
  const share = total > 0 ? dealt / total : 1;
  return share < 0.03 ? 0 : share < 0.08 ? 1 : 2;
}

export function isDown(c: ShipCondition, slot: string): boolean {
  for (const p of c.parts) if (p.slot === slot) return p.down;
  return false;
}
