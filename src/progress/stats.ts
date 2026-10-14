// Every number progression can change, as one table (the owner's Table A), and the one place a stat is worked
// out: its base, then what each layer of grants does to it, in the doc's order (the base, proficiency, the core
// skills, the disciplines, gear, then buffs), and its clamp.
//
// **A stat nobody touches is not worked out at all.** An empty record grants nothing, nothing has an entry,
// and `apply(id, base)` hands back the very base it was given -- the same value, not a recomputation -- so on
// the day this lands every number the player meets is the number it was, to the bit (the identity test pins
// it by `Object.is`). A grant only exists when something writes one: a core skill's curve from rating 1 up,
// a milestone reached, a node owned.
//
// **What each stat is.** `base` is today's literal at its read site where the stat is one number, or
// `per-item` where the base is a weapon's or a grenade's own field (a gun's spread, a grenade's radius), which
// the read site hands in. `status` says what this pass does with it: `built` (something in it writes the
// stat), `route` (read through here, written by nothing yet) or `absent` (nothing in the game for it to act
// on today: never read, never written, and `why` says so). Building an absent stat at a base worse than today
// would take something away from a character who has earned nothing, which the doc forbids.
//
// Within a layer a `set` comes first (the last one wins), then every `add`, then every `mul`; the layers in
// order; then the clamp. Pure, and nothing imported beyond its own folder: the server reads the catalogue as
// the browser does, though only the browser works a character's stats out.

import { coreGrants } from './core.ts';
import { nodeGrants } from './disciplines.ts';
import type { ProgressRecord } from './record.ts';
import type { ProgressRules } from './tune.ts';

export type StatStatus = 'built' | 'route' | 'absent';
export type StatCategory = 'ranged' | 'proficiency' | 'melee' | 'movement' | 'survivability' | 'force' | 'tactical' | 'crafting' | 'social';

export interface StatDef {
  id: string;
  /** Our words for it. */
  label: string;
  unit: string;
  /** The doc's category (Table A's rows). */
  category: StatCategory;
  /** What a stat with a grant on it is held to. A stat with none is never clamped: it is its base. */
  min: number;
  max: number;
  /** Today's literal at the read site, `per-item` where the item carries it, or null for a stat nothing reads. */
  base: number | 'per-item' | null;
  /** The file it is read in. */
  reads: string;
  status: StatStatus;
  /** What writes it, in this pass. */
  by?: string;
  /** Why nothing reads it yet. */
  why?: string;
}

const A = 'absent' as const;

/**
 * The catalogue. Every base here is the literal its read site held before this pass, so the read site now holds
 * the kept value whose base it is. Every range is ours; the doc names none.
 */
export const STATS = [
  // ---- survivability ----
  { id: 'health.max', label: 'Health', unit: 'health', category: 'survivability', min: 1, max: 10000, base: 100, reads: 'src/player/player.ts', status: 'built', by: 'Fortitude' },
  { id: 'health.regen', label: 'Health regained a second', unit: 'health/s', category: 'survivability', min: 0, max: 1000, base: 4, reads: 'src/player/player.ts', status: 'route' },
  { id: 'resist.burn', label: 'How long a burn lasts', unit: 'x', category: 'survivability', min: 0, max: 10, base: 1, reads: 'src/world/world.ts', status: 'built', by: 'Fortitude' },
  // ---- movement ----
  { id: 'fall.safeExtra', label: 'A fall that hurts nothing, added', unit: 'm', category: 'movement', min: 0, max: 100, base: 0, reads: 'src/player/jkaMove.ts', status: 'built', by: 'Acrobatics' },
  { id: 'fall.rollDivisor', label: 'A landing roll divides a fall by', unit: 'divisor', category: 'movement', min: 1, max: 1000, base: 3, reads: 'src/player/jkaMove.ts', status: 'built', by: 'Acrobatics' },
  { id: 'fall.rollFree', label: 'A landing roll takes nothing from', unit: 'm', category: 'movement', min: 0, max: 100, base: 0, reads: 'src/player/jkaMove.ts', status: 'built', by: 'Acrobatics 25' },
  { id: 'roll.iframes', label: 'A roll dodges blows for', unit: 's', category: 'movement', min: 0, max: 5, base: 0, reads: 'src/player/player.ts', status: 'built', by: 'Acrobatics' },
  { id: 'move.airAccel', label: 'Air control', unit: 'x', category: 'movement', min: 0, max: 20, base: 1, reads: 'src/player/jkaMove.ts', status: 'built', by: 'Acrobatics' },
  // ---- ranged handling ----
  { id: 'gun.spread', label: 'Spread from the hip', unit: 'degrees', category: 'ranged', min: 0, max: 90, base: 'per-item', reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Marksmanship' },
  { id: 'gun.aimSpread', label: 'Spread aimed', unit: 'degrees', category: 'ranged', min: 0, max: 90, base: 'per-item', reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Marksmanship' },
  { id: 'gun.steady', label: 'Aimed spread once aimed and still', unit: 'x', category: 'ranged', min: 0, max: 1, base: 1, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Marksmanship 25' },
  { id: 'gun.aimRate', label: 'The view comes to the shoulder, a frame', unit: 'share', category: 'ranged', min: 0.01, max: 1, base: 0.15, reads: 'src/core/camera.ts', status: 'built', by: 'Marksmanship 50' },
  { id: 'gun.damage', label: 'A gun’s damage', unit: 'health', category: 'ranged', min: 0, max: 100000, base: 'per-item', reads: 'src/combat/bountyHunter.ts', status: 'route' },
  { id: 'gun.refire', label: 'Seconds between shots', unit: 's', category: 'ranged', min: 0.01, max: 60, base: 'per-item', reads: 'src/combat/bountyHunter.ts', status: 'route' },
  { id: 'launcher.refire', label: 'Seconds between rockets', unit: 's', category: 'ranged', min: 0.01, max: 60, base: 'per-item', reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Quick Reload' },
  { id: 'launcher.pickCos', label: 'How near the crosshair a homing rocket picks its mark (a cosine)', unit: 'cos', category: 'ranged', min: 0, max: 1, base: 0.9, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Launcher Familiarity' },
  { id: 'gun.bloom', label: 'Bloom per shot', unit: 'degrees', category: 'ranged', min: 0, max: 0, base: null, reads: '', status: A, why: 'a shot’s spread does not grow as you fire' },
  { id: 'gun.bloomRecovery', label: 'Bloom recovery', unit: '/s', category: 'ranged', min: 0, max: 0, base: null, reads: '', status: A, why: 'there is no bloom to recover from' },
  { id: 'gun.recoil', label: 'Recoil kick and recovery', unit: 'degrees', category: 'ranged', min: 0, max: 0, base: null, reads: '', status: A, why: 'the recoil is the arms’ fire clip and never moves the aim' },
  { id: 'gun.sway', label: 'Weapon sway', unit: 'degrees', category: 'ranged', min: 0, max: 0, base: null, reads: '', status: A, why: 'the aim does not sway' },
  { id: 'gun.reload', label: 'Reload speed', unit: 's', category: 'ranged', min: 0, max: 0, base: null, reads: '', status: A, why: 'guns have no magazines (Quick Reload reads the launcher’s refire instead)' },
  { id: 'gun.swap', label: 'Swap speed', unit: 's', category: 'ranged', min: 0, max: 0, base: null, reads: '', status: A, why: 'a weapon is put in hand with no timer' },
  { id: 'gun.falloff', label: 'Range falloff', unit: 'share', category: 'ranged', min: 0, max: 0, base: null, reads: '', status: A, why: 'a bolt keeps its damage for its whole flight' },
  { id: 'gun.weakPoint', label: 'Weak-point multiplier', unit: 'x', category: 'ranged', min: 0, max: 0, base: null, reads: '', status: A, why: 'nothing has weak points yet' },
  // ---- weapon proficiency ----
  { id: 'prof.tier', label: 'Proficiency with a weapon family', unit: 'tier', category: 'proficiency', min: 0, max: 0, base: null, reads: '', status: A, why: 'Progression II: every gun fires at its one tuning (the doc’s Proficient); the nodes’ proficiencies are recorded and read by nothing' },
  // ---- melee and saber ----
  { id: 'saber.damage', label: 'Saber damage', unit: 'x', category: 'melee', min: 0, max: 100, base: 1, reads: 'src/player/player.ts', status: 'route' },
  { id: 'saber.swing', label: 'Saber swing speed', unit: 'x', category: 'melee', min: 0.1, max: 10, base: 1, reads: 'src/combat/saber.ts', status: 'built', by: 'Melee' },
  { id: 'saber.defense', label: 'Saber defence rank', unit: 'rank', category: 'melee', min: 1, max: 3, base: 3, reads: 'src/player/player.ts', status: 'route' },
  { id: 'melee.push', label: 'How hard a kick or a fist shoves', unit: 'x', category: 'melee', min: 0, max: 100, base: 1, reads: 'src/combat/jedi.ts, src/combat/unarmed.ts', status: 'built', by: 'Melee' },
  { id: 'saber.combo', label: 'Combo length', unit: 'moves', category: 'melee', min: 0, max: 0, base: null, reads: '', status: A, why: 'the chains are Jedi Academy’s own move machine; Progression II’s Forms' },
  { id: 'saber.blockArc', label: 'Block arc', unit: 'degrees', category: 'melee', min: 0, max: 0, base: null, reads: '', status: A, why: 'Jedi Academy’s own cone, not read through here until Progression II' },
  { id: 'saber.blockStamina', label: 'Block stamina', unit: 'points', category: 'melee', min: 0, max: 0, base: null, reads: '', status: A, why: 'Jedi Academy’s block points were never ported' },
  { id: 'saber.parryWindow', label: 'Parry window', unit: 'ms', category: 'melee', min: 0, max: 0, base: null, reads: '', status: A, why: 'there is no timed parry' },
  { id: 'saber.deflect', label: 'Deflect accuracy', unit: 'share', category: 'melee', min: 0, max: 0, base: null, reads: '', status: A, why: 'Jedi Academy’s scatter by rank, not read through here until Progression II' },
  { id: 'saber.throwRange', label: 'Saber throw range', unit: 'm', category: 'melee', min: 0, max: 0, base: null, reads: '', status: A, why: 'the throw is Jedi Academy’s own; the Force pass' },
  { id: 'saber.stances', label: 'Stance access', unit: 'styles', category: 'melee', min: 0, max: 0, base: null, reads: '', status: A, why: 'the five styles are all open; Progression II’s Forms' },
  // ---- movement, not built ----
  { id: 'move.jump', label: 'Jump height', unit: 'm', category: 'movement', min: 0, max: 0, base: null, reads: '', status: A, why: 'Jedi Academy’s jump and the Force’s levels; Athletics and the Force pass' },
  { id: 'move.sprint', label: 'Sprint speed', unit: 'm/s', category: 'movement', min: 0, max: 0, base: null, reads: '', status: A, why: 'there is one run; Athletics, later' },
  { id: 'move.stamina', label: 'Stamina pool and regen', unit: 'points', category: 'movement', min: 0, max: 0, base: null, reads: '', status: A, why: 'there is no stamina' },
  { id: 'move.mantle', label: 'Mantle height', unit: 'm', category: 'movement', min: 0, max: 0, base: null, reads: '', status: A, why: 'there is no mantle; Athletics, later' },
  { id: 'move.wallRun', label: 'Wall-run duration', unit: 's', category: 'movement', min: 0, max: 0, base: null, reads: '', status: A, why: 'Jedi Academy’s wall runs belong to Force jump 3; the Force pass' },
  // ---- the grapple: each base is `GRAPPLE_TUNE`'s own number, which the read site hands in, so the tune stays live ----
  { id: 'grapple.range', label: 'Grapple range', unit: 'm', category: 'movement', min: 1, max: 1000, base: 100, reads: 'src/player/grapple.ts', status: 'route' },
  { id: 'grapple.reel', label: 'Grapple reel speed', unit: 'm/s', category: 'movement', min: 0.1, max: 100, base: 6, reads: 'src/player/grapple.ts', status: 'route' },
  { id: 'grapple.yank', label: 'Grapple haul speed', unit: 'm/s', category: 'movement', min: 0.1, max: 100, base: 18, reads: 'src/player/grapple.ts', status: 'route' },
  { id: 'grapple.swing', label: 'Swing momentum on the grapple', unit: 'x', category: 'movement', min: 0, max: 10, base: 1, reads: 'src/player/grapple.ts', status: 'built', by: 'Acrobatics' },
  // ---- survivability, not built ----
  { id: 'armor.taken', label: 'Armour effectiveness', unit: 'x', category: 'survivability', min: 0, max: 0, base: null, reads: '', status: A, why: 'items carry no modifiers yet (Force Protect keeps its own field)' },
  { id: 'resist.stagger', label: 'Stagger and knockdown resistance', unit: 'share', category: 'survivability', min: 0, max: 0, base: null, reads: '', status: A, why: 'a slam on the grapple’s rope staggers the player for a moment, and nothing reads this yet' },
  { id: 'resist.status', label: 'Status resistance beyond the burn', unit: 'share', category: 'survivability', min: 0, max: 0, base: null, reads: '', status: A, why: 'the burn is the one status the player carries' },
  { id: 'revive.speed', label: 'Revive speed', unit: 's', category: 'survivability', min: 0, max: 0, base: null, reads: '', status: A, why: 'a death is a ragdoll and a respawn; Medic, later' },
  { id: 'bleed.out', label: 'Bleed-out time', unit: 's', category: 'survivability', min: 0, max: 0, base: null, reads: '', status: A, why: 'there is no bleeding out' },
  // ---- the Force ----
  { id: 'force.pool', label: 'Force pool', unit: 'points', category: 'force', min: 0, max: 0, base: null, reads: '', status: A, why: 'the Jedi kit’s own 100, not read through here; the Force pass' },
  { id: 'force.regen', label: 'Force regen and its delay', unit: '/s', category: 'force', min: 0, max: 0, base: null, reads: '', status: A, why: 'the Force pass' },
  { id: 'force.reach', label: 'Power range, cone and field', unit: 'm', category: 'force', min: 0, max: 0, base: null, reads: '', status: A, why: 'the Force pass' },
  { id: 'force.hold', label: 'Slow strength and hold duration', unit: 's', category: 'force', min: 0, max: 0, base: null, reads: '', status: A, why: 'the Force pass' },
  { id: 'force.cast', label: 'Cast time and cooldowns', unit: 's', category: 'force', min: 0, max: 0, base: null, reads: '', status: A, why: 'the Force pass' },
  { id: 'force.alignment', label: 'Alignment affinity and visibility', unit: 'share', category: 'force', min: 0, max: 0, base: null, reads: '', status: A, why: 'the Force pass' },
  // ---- tactical ----
  { id: 'throw.speed', label: 'How fast a grenade leaves the hand', unit: 'm/s', category: 'tactical', min: 0, max: 200, base: 'per-item', reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Steady Arm' },
  { id: 'throw.lift', label: 'The lift a throw is given', unit: 'm/s', category: 'tactical', min: 0, max: 100, base: 4, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Steady Arm' },
  { id: 'charge.packs', label: 'Det packs out at once', unit: 'packs', category: 'tactical', min: 1, max: 6, base: 1, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Detonite Handling, Chain Detonation' },
  { id: 'blast.radius', label: 'A grenade’s and a charge’s blast radius', unit: 'm', category: 'tactical', min: 0, max: 100, base: 'per-item', reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Shrapnel Casing' },
  { id: 'blast.self', label: 'What your own blast does to you', unit: 'share', category: 'tactical', min: 0, max: 1, base: 0.35, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Blast Discipline' },
  { id: 'blast.machines', label: 'What machines take of a grenade’s or a charge’s blast (never a gun’s)', unit: 'x', category: 'tactical', min: 0, max: 100, base: 'per-item', reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Demolition Expert' },
  { id: 'chain.reach', label: 'A blast sets off charges within this share of its radius', unit: 'share', category: 'tactical', min: 0, max: 5, base: 0.8, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Chain Detonation' },
  { id: 'grenade.cooldown', label: 'A grenade’s cooldown', unit: 'x', category: 'tactical', min: 0.05, max: 10, base: 1, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Twin Toss' },
  { id: 'grenade.stock', label: 'Throws a grenade holds', unit: 'throws', category: 'tactical', min: 1, max: 10, base: 1, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Improvised Ordnance' },
  { id: 'grenade.count', label: 'Grenades a throw', unit: 'grenades', category: 'tactical', min: 1, max: 4, base: 1, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Twin Toss' },
  { id: 'demo.cook', label: 'A grenade’s key held cooks it', unit: 'switch', category: 'tactical', min: 0, max: 1, base: 0, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Demolitions Novice' },
  { id: 'demo.arc', label: 'The throw’s arc shown (1 short, 2 to its first touch)', unit: 'level', category: 'tactical', min: 0, max: 2, base: 0, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Demolitions Novice, Steady Arm' },
  { id: 'demo.burst', label: 'A cooked grenade bursts in the air', unit: 'switch', category: 'tactical', min: 0, max: 1, base: 0, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Cooked Fuse' },
  { id: 'demo.sticky', label: 'A throw may stick', unit: 'switch', category: 'tactical', min: 0, max: 1, base: 0, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Bank Shot' },
  { id: 'demo.lock', label: 'A launcher locks on', unit: 'switch', category: 'tactical', min: 0, max: 1, base: 0, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Tracking Lock' },
  { id: 'demo.payload', label: 'A rocket’s warhead may be swapped', unit: 'switch', category: 'tactical', min: 0, max: 1, base: 0, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Payload Swap' },
  { id: 'demo.remote', label: 'Det packs set off by the key held', unit: 'switch', category: 'tactical', min: 0, max: 1, base: 0, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Detonite Handling' },
  { id: 'demo.shaped', label: 'A stuck det pack blasts outward from its surface', unit: 'switch', category: 'tactical', min: 0, max: 1, base: 0, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Shaped Charge' },
  { id: 'demo.chainAll', label: 'Grenades in flight are set off too', unit: 'switch', category: 'tactical', min: 0, max: 1, base: 0, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Chain Detonation' },
  { id: 'demo.stagger', label: 'Seconds staggered within half a grenade’s radius', unit: 's', category: 'tactical', min: 0, max: 5, base: 0, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Ion & Concussion' },
  { id: 'demo.dangerClose', label: 'Your own blast never takes your last point and launches you', unit: 'switch', category: 'tactical', min: 0, max: 1, base: 0, reads: 'src/combat/bountyHunter.ts', status: 'built', by: 'Master Demolitionist' },
  { id: 'trap.arm', label: 'Trap arm time', unit: 's', category: 'tactical', min: 0, max: 0, base: null, reads: '', status: A, why: 'Entrapment, later' },
  { id: 'trap.conceal', label: 'Trap concealment', unit: 'share', category: 'tactical', min: 0, max: 0, base: null, reads: '', status: A, why: 'Entrapment, later' },
  { id: 'detect.radius', label: 'Detection radius', unit: 'm', category: 'tactical', min: 0, max: 0, base: null, reads: '', status: A, why: 'Awareness, later' },
  { id: 'tether.strength', label: 'Tether strength: the heaviest thing the grapple pulls to you', unit: 'kg', category: 'tactical', min: 0, max: 100000, base: 40, reads: 'src/player/grapple.ts', status: 'route' },
  { id: 'lock.grade', label: 'Lock grade', unit: 'grade', category: 'tactical', min: 0, max: 0, base: null, reads: '', status: A, why: 'Slicer, later' },
  { id: 'slice.time', label: 'Slicing time and alarm delay', unit: 's', category: 'tactical', min: 0, max: 0, base: null, reads: '', status: A, why: 'Slicer, later' },
  // ---- crafting and social ----
  { id: 'craft.schematics', label: 'Schematic access', unit: 'schematics', category: 'crafting', min: 0, max: 0, base: null, reads: '', status: A, why: 'there is no crafting yet' },
  { id: 'craft.experiment', label: 'Experimentation points', unit: 'points', category: 'crafting', min: 0, max: 0, base: null, reads: '', status: A, why: 'there is no crafting yet' },
  { id: 'craft.quality', label: 'Quality ceiling and masterwork chance', unit: 'share', category: 'crafting', min: 0, max: 0, base: null, reads: '', status: A, why: 'there is no crafting yet' },
  { id: 'craft.repair', label: 'Repair efficiency', unit: 'share', category: 'crafting', min: 0, max: 0, base: null, reads: '', status: A, why: 'there is no crafting yet' },
  { id: 'social.buff', label: 'Buff strength and duration', unit: 'share', category: 'social', min: 0, max: 0, base: null, reads: '', status: A, why: 'there are no performance buffs' },
  { id: 'social.audience', label: 'Audience capacity', unit: 'people', category: 'social', min: 0, max: 0, base: null, reads: '', status: A, why: 'there are no performance buffs' },
  { id: 'social.fatigue', label: 'Fatigue removal', unit: 'share', category: 'social', min: 0, max: 0, base: null, reads: '', status: A, why: 'there is no fatigue' },
  { id: 'social.crowd', label: 'Crowd reactions', unit: 'share', category: 'social', min: 0, max: 0, base: null, reads: '', status: A, why: 'there are no crowds that react yet' },
] as const satisfies readonly StatDef[];

export type StatId = (typeof STATS)[number]['id'];

const BY_ID = new Map<string, StatDef>(STATS.map((s) => [s.id, s as StatDef]));

/** One stat's entry in the catalogue, or undefined. */
export function statDef(id: string): StatDef | undefined {
  return BY_ID.get(id);
}

export function isStatId(x: unknown): x is StatId {
  return typeof x === 'string' && BY_ID.has(x);
}

/** A stat's one-number base, for a stat that has one (the kept fields' bases), else NaN. */
export function baseOf(id: StatId): number {
  const b = BY_ID.get(id)?.base;
  return typeof b === 'number' ? b : NaN;
}

/** The doc's layers, in the order a stat is worked out through them. */
export const LAYERS = ['base', 'proficiency', 'core', 'discipline', 'gear', 'buff'] as const;
export type Layer = (typeof LAYERS)[number];

export type GrantOp = 'add' | 'mul' | 'set';

/** One modifier: what it does to which stat (the doc's `{ "stat", "op", "value" }`). */
export interface Grant {
  stat: StatId;
  op: GrantOp;
  value: number;
}

/** A grant as it is gathered: which layer it is in and where it came from (a node, a core skill, a milestone). */
export interface SourcedGrant extends Grant {
  layer: Layer;
  from: string;
}

/** What one layer does to one stat, as `stat()` shows it. */
export interface LayerView {
  layer: Layer;
  set?: number;
  add?: number;
  mul?: number;
  from: string[];
}

interface LayerSum {
  layer: Layer;
  hasSet: boolean;
  set: number;
  hasAdd: boolean;
  add: number;
  hasMul: boolean;
  mul: number;
  from: string[];
}

interface Entry {
  min: number;
  max: number;
  /** Only the layers that hold something, in order. */
  layers: LayerSum[];
}

/** The stats as one record's grants make them. Made only when the grants change; asked many times a frame. */
export interface Resolved {
  readonly version: number;
  /** The stat worked out from the base handed in; the very base when nothing grants anything to it. Allocates nothing. */
  apply(id: StatId, base: number): number;
  layers(id: StatId): LayerView[];
  has(id: StatId): boolean;
  /** Every stat something grants to. */
  touched(): StatId[];
}

let made = 0;

class Worked implements Resolved {
  readonly version: number;
  private readonly entries: Map<string, Entry>;

  constructor(entries: Map<string, Entry>) {
    this.entries = entries;
    this.version = ++made;
  }

  apply(id: StatId, base: number): number {
    const e = this.entries.get(id);
    if (!e) return base;
    let v = base;
    const ls = e.layers;
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      if (l.hasSet) v = l.set;
      if (l.hasAdd) v += l.add;
      if (l.hasMul) v *= l.mul;
    }
    return v < e.min ? e.min : v > e.max ? e.max : v;
  }

  layers(id: StatId): LayerView[] {
    const e = this.entries.get(id);
    if (!e) return [];
    return e.layers.map((l) => ({ layer: l.layer, ...(l.hasSet ? { set: l.set } : {}), ...(l.hasAdd ? { add: l.add } : {}), ...(l.hasMul ? { mul: l.mul } : {}), from: [...l.from] }));
  }

  has(id: StatId): boolean {
    return this.entries.has(id);
  }

  touched(): StatId[] {
    return [...this.entries.keys()] as StatId[];
  }
}

/**
 * Grants made into the stats they work out. A grant that changes nothing (a `mul` of 1, an `add` of nought) and a
 * grant on a stat the catalogue has not got write no entry, so a grant of nothing is no grant at all; a `set`
 * always writes one.
 */
export function resolveGrants(grants: readonly SourcedGrant[]): Resolved {
  const entries = new Map<string, Entry>();
  for (const g of grants) {
    const def = BY_ID.get(g.stat);
    if (!def || !Number.isFinite(g.value)) continue;
    if ((g.op === 'mul' && g.value === 1) || (g.op === 'add' && g.value === 0)) continue;
    let e = entries.get(g.stat);
    if (!e) {
      e = { min: def.min, max: def.max, layers: [] };
      entries.set(g.stat, e);
    }
    let l = e.layers.find((x) => x.layer === g.layer);
    if (!l) {
      l = { layer: g.layer, hasSet: false, set: 0, hasAdd: false, add: 0, hasMul: false, mul: 1, from: [] };
      e.layers.push(l);
      e.layers.sort((a, b) => LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer));
    }
    if (g.op === 'set') {
      l.hasSet = true;
      l.set = g.value;
    } else if (g.op === 'add') {
      l.hasAdd = true;
      l.add += g.value;
    } else {
      l.hasMul = true;
      l.mul *= g.value;
    }
    if (!l.from.includes(g.from)) l.from.push(g.from);
  }
  return new Worked(entries);
}

/** Every grant a record makes: its core skills' curves and milestones, then its owned nodes. */
export function gatherGrants(rec: ProgressRecord | null, rules: ProgressRules): SourcedGrant[] {
  if (!rec) return [];
  return [...coreGrants(rec, rules), ...nodeGrants(rec, rules)];
}

/** The stats a record makes, worked out. A record that grants nothing works out to nothing: every stat its base. */
export function resolveStats(rec: ProgressRecord | null, rules: ProgressRules): Resolved {
  return resolveGrants(gatherGrants(rec, rules));
}
