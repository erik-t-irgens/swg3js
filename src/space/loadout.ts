// Which components an NPC ship of a tier carries. The game's per-hull tier tables are look tables,
// the same at every tier; what an NPC carried was the server's choice and did not ship. So the pick
// here is INVENTED: by the grade a tier wants, from the component list, never a player-made or loot
// piece, always one the hull shows a model for where it shows one, and the hull's own bolt preferred.
//
// Pure: no three, no rapier; node's tests import it straight from source.
import type { ComponentDef, FitDef, ShipFit } from '../vehicles/shipFit.ts';
import { gradeOf, type Grade } from './shipStats.ts';

/** The grade a tier wants in every slot (invented). */
export const TIER_GRADE: Record<number, Grade> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };
/** Never on an NPC: player-made and loot pieces (the Kessel pieces are rewards too). */
export const NPC_NEVER = /crafted|reward|collection|kessel|mission|quest|npe|heroic|nova_|orion|(^|_)test(_|$)/;
/** Slots an NPC leaves as the chassis has them (stock: empty). */
const MODIFICATION = /^modification_/;

/** Whether a component's compatibility (one class, or a comma list) is one the slot accepts (the rule resolveFit applies). */
export function accepts(slotCompat: readonly string[], componentCompat: string): boolean {
  for (const raw of String(componentCompat ?? '').split(',')) {
    const c = raw.trim().replace(/[^a-z0-9_]/g, '');
    if (c && slotCompat.includes(c)) return true;
  }
  return false;
}

/** A weapon that fires bolts (not a missile, countermeasures, a tractor, a beam or a mining laser). */
function firesBolts(c: ComponentDef): boolean {
  const w = c.weapon;
  return !!w && !w.missile && !w.countermeasure && !w.tractor && !w.beam && !w.mining;
}

/**
 * An NPC's components, one per slot of the fit, as a ShipFit for Garage.resolve:
 *  1. candidates: the components the slot accepts, not NPC_NEVER; a gun slot (wpn_0) only bolt weapons;
 *  2. a slot with looks on this hull: only components that have a look (so the hull always shows its part);
 *  3. a gun slot: only those firing `preferProjectile` (the hull's own bolt), when any remain;
 *  4. by grade: those at TIER_GRADE[tier]; none, the next grade down, and so on to 1; none at all, the
 *     lowest grade present;
 *  5. one of those by `rng`. A slot with no candidate is left out (resolveFit then gives the stock).
 */
export function pickLoadout(fit: FitDef, components: readonly ComponentDef[], tier: number, preferProjectile: number | null, rng: () => number): ShipFit {
  const out: ShipFit = { components: {}, paint: {} };
  const want = TIER_GRADE[Math.max(1, Math.min(5, Math.round(tier)))] ?? 2;
  for (const s of fit.slots) {
    // A fixed slot is always stock; a modification slot's one look is a reward (the X-wing's strakes): an NPC leaves it empty.
    if (s.fixed || MODIFICATION.test(s.slot)) continue;
    const gun = s.compat.includes('wpn_0');
    // The components this hull shows a model for in the slot: when it shows any, only those.
    const shown = new Set<number>();
    for (const l of s.looks) if (!l.noModel && l.parts.length) for (const i of l.components) shown.add(i);
    let cands: number[] = [];
    components.forEach((c, i) => {
      if (NPC_NEVER.test(c.name) || !accepts(s.compat, c.compat)) return;
      if (gun && !firesBolts(c)) return;
      if (shown.size && !shown.has(i)) return;
      cands.push(i);
    });
    if (gun && preferProjectile !== null) {
      const own = cands.filter((i) => components[i].weapon?.projectile === preferProjectile);
      if (own.length) cands = own;
    }
    if (!cands.length) continue;
    const grades = cands.map((i) => gradeOf(components[i].name));
    let pool: number[] = [];
    for (let g = want; g >= 1 && !pool.length; g--) pool = cands.filter((_, k) => grades[k] === g);
    if (!pool.length) {
      const lowest = Math.min(...grades);
      pool = cands.filter((_, k) => grades[k] === lowest);
    }
    const pick = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    out.components[s.slot] = components[pick].name;
  }
  return out;
}

/** A small seeded generator (mulberry32), so a spawn's loadout and aim scatter repeat for a seed. Values in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
