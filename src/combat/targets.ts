// Picking something out of the one list of living things: whose side it is on, who picks a fight
// with whom, and the nearest body ahead or nearby. Every side and every keyword is a constant in
// this file, so a fight that reads wrong is one line to change.
//
// Pure: no three, no rapier, no clock. `./kit` is imported for values (the keys), and kit.ts
// itself imports nothing but types, so both run under node's type stripping for the tests.
// The `.ts` on the import is deliberate and must stay: node runs this file straight from source
// for the tests, and kit.ts imports nothing but types, so it comes along without pulling in three.
import { NOBODY, PLAYER_KEY, type Aggression, type Side } from './kit.ts';

export { NOBODY, PLAYER_KEY };

/** A point, however it is spelled: a THREE.Vector3 satisfies it. */
export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The least a thing must show to be picked out of a crowd. Every `Living` satisfies it. */
export interface Targetable {
  readonly pos: Vec3Like;
  readonly halfHeight: number;
  dead: boolean;
}

/**
 * What `sideOf` reads: a catalogue entry, or anything shaped like one. The tags may sit at the
 * top level or under `stats`, which is where the mobiles catalogue writes them.
 */
export interface SideInput {
  id: string;
  /** 'creature', 'droid', 'npc', 'dressed' or 'special'. */
  kind?: string;
  group?: string;
  tags?: readonly string[];
  stats?: { tags?: readonly string[] } | null;
}

/**
 * The words that put an entry on a side. The converter's own tag says only `faction`, so which
 * faction is read from the id; everything else is read from the id, the group and the tags.
 */
export const SIDE_WORDS = {
  imperial: /(^|[_/])(imperial|imp|empire|emperor|moff|stormtrooper|storm_commando|scout_trooper|sand_trooper|snow_trooper|swamp_trooper|dark_trooper|shock_trooper|tie_pilot|inquisitor|sith)([_/]|$)/i,
  rebel: /(^|[_/])(rebel|alliance|rebellion|marine|sf_trooper|smuggler_rebel)([_/]|$)/i,
  hostile: /(^|[_/])(hostile|enemy|pirate|bandit|raider|thug|brigand|marauder|assassin|slaver|criminal|outlaw|kidnapper|thief|swoop_gang|black_sun|blacksun|binayre|nightsister|nym|tusken|jinda|janta|kunga|mokk|sand_people|gang)([_/]|$)/i,
  civilian: /(^|[_/])(civilian|villager|commoner|citizen|noble|farmer|merchant|shopkeeper|vendor|trainer|bartender|patron|dancer|musician|worker|child|elder|informant|passer_by)([_/]|$)/i,
} as const;

/** The kinds whose entries are wild things rather than people. */
export const WILD_KINDS: readonly string[] = ['creature', 'special'];

/** The tags that name a side outright, whatever the id says. */
const TAG_SIDES: Record<string, Side> = { hostile: 'hostile', civilian: 'civilian', imperial: 'imperial', rebel: 'rebel' };

/**
 * Whose side a catalogue entry is on: the faction from its id first (the converter's tag says
 * only that there is one), then wild for a creature or a special, then hostile, then civilian,
 * and neutral for everything left.
 */
export function sideOf(entry: SideInput): Side {
  const id = entry.id ?? '';
  if (SIDE_WORDS.imperial.test(id)) return 'imperial';
  if (SIDE_WORDS.rebel.test(id)) return 'rebel';
  if (entry.kind && WILD_KINDS.includes(entry.kind)) return 'wild';
  const tags = entry.tags ?? entry.stats?.tags ?? [];
  for (const t of tags) {
    const side = TAG_SIDES[t.toLowerCase()];
    if (side) return side;
  }
  // Joined with a slash, which every one of these patterns already treats as a word boundary.
  const text = `${id}/${entry.group ?? ''}`;
  if (SIDE_WORDS.hostile.test(text)) return 'hostile';
  if (SIDE_WORDS.civilian.test(text)) return 'civilian';
  return 'neutral';
}

/** The two halves of a fight, as far as picking one goes. */
export interface Fighter {
  readonly side: Side;
  readonly aggression: Aggression;
}

/**
 * Whether `me` picks a fight with `them` on sight. Anyone who hurts a body is a target whatever
 * their side (that is the retaliation memory, not this), so this decides only who starts one.
 *
 * - Nothing but an aggressive one picks a fight, and nothing picks a passive one (a hologram,
 *   a vendor, the tutorial).
 * - A fighter fights every person that is not passive, and does not start on the wildlife. One
 *   bitten by a creature still turns on it, because the attacker memory outranks this, whatever
 *   side the attacker is on. A fighter has only ever seen the player and the other fighters, and
 *   standing one beside a herd should not have it walk off after a bantha instead of coming for
 *   you; when a fighter should hunt wildlife, this is the one line to change.
 * - A wild predator takes the player, the fighters and every humanoid side, but not other wild things.
 * - A hostile humanoid takes everything but other hostiles, and a wild thing only when that one
 *   is aggressive too (it does not pick on the local herd).
 * - Imperials take the player, rebels, fighters and hostiles; rebels take imperials, fighters
 *   and hostiles, and leave the player alone.
 * - Anything else aggressive takes the player and the fighters.
 */
export function hostileSides(me: Fighter, them: Fighter): boolean {
  if (me.aggression !== 'aggressive' || them.aggression === 'passive') return false;
  if (me.side === them.side) return me.side === 'fighter';
  switch (me.side) {
    case 'fighter':
      return them.side !== 'wild';
    case 'wild':
      return them.side !== 'wild';
    case 'hostile':
      return them.side === 'wild' ? them.aggression === 'aggressive' : true;
    case 'imperial':
      return them.side === 'player' || them.side === 'rebel' || them.side === 'fighter' || them.side === 'hostile';
    case 'rebel':
      return them.side === 'imperial' || them.side === 'fighter' || them.side === 'hostile';
    default:
      return them.side === 'player' || them.side === 'fighter';
  }
}

/** What `nearestInCone` is asked to look for. */
export interface ConeQuery<T> {
  /** Where the look starts (the player's feet, a muzzle). */
  from: Vec3Like;
  /** A unit vector down the middle of the cone. */
  forward: Vec3Like;
  /** How far to look, in metres. */
  range: number;
  /** The cosine at the cone's edge; -1 takes everything within the range. */
  cone: number;
  /** Measure to the body's middle (`halfHeight` up) rather than to its feet. */
  middle?: boolean;
  /** Inside this many metres the cone is not tested: something on top of you is ahead of you. */
  near?: number;
  /** Anything this says no to is passed over (a grip needs something that can be held). */
  need?: (t: T) => boolean;
}

/** The nearest living thing in a cone about a direction, or null. Dead bodies are passed over. */
export function nearestInCone<T extends Targetable>(list: Iterable<T>, q: ConeQuery<T>): T | null {
  let best: T | null = null;
  let bestD = q.range;
  const near = q.near ?? 0;
  for (const t of list) {
    if (t.dead) continue;
    if (q.need && !q.need(t)) continue;
    const dx = t.pos.x - q.from.x;
    const dy = t.pos.y + (q.middle ? t.halfHeight : 0) - q.from.y;
    const dz = t.pos.z - q.from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d >= bestD) continue;
    if (d > near && d > 1e-6) {
      const dot = (dx * q.forward.x + dy * q.forward.y + dz * q.forward.z) / d;
      if (dot < q.cone) continue;
    }
    bestD = d;
    best = t;
  }
  return best;
}

/** The nearest living thing to a point within `range` metres, or null. Dead bodies are passed over. */
export function nearestTo<T extends Targetable>(list: Iterable<T>, point: Vec3Like, range: number, need?: (t: T) => boolean): T | null {
  let best: T | null = null;
  let bestD = range;
  for (const t of list) {
    if (t.dead) continue;
    if (need && !need(t)) continue;
    const d = Math.hypot(t.pos.x - point.x, t.pos.y - point.y, t.pos.z - point.z);
    if (d >= bestD) continue;
    bestD = d;
    best = t;
  }
  return best;
}

/**
 * The one in a list with this key, or null; `NOBODY` (and null) always give null. A brain keeps
 * whom it is fighting as a key rather than as the body, and reads it back through this.
 */
export function byKey<T extends { key: number }>(list: readonly T[], key: number | null): T | null {
  if (!key) return null;
  for (const t of list) if (t.key === key) return t;
  return null;
}
