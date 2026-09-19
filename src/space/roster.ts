// Who patrols where: each space zone's tier, the formation each faction flies, the groups a faction
// sends at each tier, and the anchors (stations, hyperspace points, the arrival lane) patrols keep
// to. All INVENTED, after the game's progression as players knew it; the anchors' places are the
// zone pack's own.
//
// Pure: no three, no rapier; node's tests import it straight from source.
import type { ShipFaction } from './factions.ts';
import type { NpcTypeDef } from './combatData.ts';

/** A zone's tier (invented). */
export const ZONE_TIER: Record<string, number> = { space_tatooine: 1, space_naboo: 1, space_corellia: 1, space_dantooine: 2, space_lok: 2, space_dathomir: 3, space_endor: 3, space_yavin4: 4, space_kashyyyk: 5, space_light1: 5, space_heavy1: 5, space_ord_mantell: 4 };

/** Which of the game's formations each faction flies (invented). */
export const FACTION_FORMATION: Record<ShipFaction, 'arrow' | 'claw' | 'wall'> = { imperial: 'claw', rebel: 'arrow', blacksun: 'wall', pirate: 'arrow', neutral: 'arrow', player: 'arrow' };

/** Group recipes by faction: at each tier (up to `upTo`), the families (bases) of the leader and the two wingmen (invented). */
export const GROUPS: Record<'imperial' | 'rebel' | 'blacksun' | 'pirate', { upTo: number; families: [string, string, string] }[]> = {
  imperial: [
    { upTo: 2, families: ['tiefighter', 'tiefighter', 'tiefighter'] },
    { upTo: 3, families: ['tieinterceptor', 'tiefighter', 'tiefighter'] },
    { upTo: 4, families: ['tieadvanced', 'tieinterceptor', 'tiebomber'] },
    { upTo: 5, families: ['tieoppressor', 'tieaggressor', 'tieinterceptor_imperial_guard'] },
  ],
  rebel: [
    { upTo: 2, families: ['xwing', 'xwing', 'ywing'] },
    { upTo: 3, families: ['xwing', 'awing', 'ywing'] },
    { upTo: 5, families: ['bwing', 'awing', 'xwing'] },
  ],
  blacksun: [
    { upTo: 2, families: ['blacksun_light', 'blacksun_light', 'blacksun_light'] },
    { upTo: 3, families: ['blacksun_medium', 'blacksun_light', 'blacksun_light'] },
    { upTo: 5, families: ['blacksun_heavy', 'blacksun_medium', 'blacksun_medium'] },
  ],
  pirate: [
    { upTo: 1, families: ['z95', 'hutt_light', 'hutt_light'] },
    { upTo: 3, families: ['hutt_medium', 'hutt_light', 'z95'] },
    { upTo: 5, families: ['hutt_heavy', 'hutt_medium', 'firespray'] },
  ],
};

export type AnchorFaction = 'imperial' | 'rebel' | 'neutral' | 'lane';
export type Recipe = 'imperial' | 'rebel' | 'blacksun' | 'pirate';

/** A place patrols keep to, in the game's frame (X mirrored from the pack). */
export interface RosterAnchor {
  name: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  faction: AnchorFaction;
}

/** What anchorsOf reads of a space pack: every field optional, so a version-1 pack works (`SpacePack` from spaceData.ts fits it). */
export interface SpacePackLike {
  stations?: { name: string; model?: string; x: number; y: number; z: number; radius?: number }[];
  scenery?: { near?: string }[];
  arrival?: { x: number; y: number; z: number } | null;
  hyperspace?: { points?: { id: string; name?: string; x: number; y: number; z: number }[] } | null;
}

/** A station's radius when the pack gives none; the lane's distance from the arrival; how near another anchor drops the lane. */
export const STATION_RADIUS = 300;
export const LANE_OUT = 2000;
export const LANE_CROWD = 1500;

/** A station's faction from its name or model. */
export function stationFaction(name: string, model: string): 'imperial' | 'rebel' | 'neutral' {
  const s = `${name} ${model}`.toLowerCase();
  if (/imperial/.test(s)) return 'imperial';
  if (/rebel/.test(s)) return 'rebel';
  return 'neutral';
}

/** A hyperspace point's radius for its patrols' route (it has no size of its own; invented). */
export const POINT_RADIUS = 200;

/** X mirrored, never a negative zero. */
const mirror = (x: number): number => (x === 0 ? 0 : -x);

/**
 * Groups kept round an anchor: an imperial or rebel anchor two of its own; a neutral one (a neutral
 * station or hyperspace point) one raider group, pirates at tiers 1-2 and above that pirates or Black Sun
 * alternating by the anchor's index; the arrival lane one raider group (pirates at tiers 1-2, Black Sun above).
 */
export function anchorRecipes(faction: AnchorFaction, tier: number, index: number): Recipe[] {
  switch (faction) {
    case 'imperial':
      return ['imperial', 'imperial'];
    case 'rebel':
      return ['rebel', 'rebel'];
    case 'lane':
      return [tier <= 2 ? 'pirate' : 'blacksun'];
    default:
      return [tier <= 2 || index % 2 === 0 ? 'pirate' : 'blacksun'];
  }
}

/**
 * Anchors from a space pack: the stations (radius, default STATION_RADIUS), the hyperspace points (neutral, or
 * imperial when a scenery's `near` names them), and the lane LANE_OUT from the arrival toward the nearest
 * station (or the arrival itself with none), left out when another anchor lies within LANE_CROWD of it.
 * Positions with X mirrored. Null gives none.
 */
export function anchorsOf(pack: SpacePackLike | null): RosterAnchor[] {
  if (!pack) return [];
  const out: RosterAnchor[] = [];
  for (const s of pack.stations ?? []) {
    out.push({ name: s.name, x: mirror(s.x), y: s.y, z: s.z, radius: s.radius && s.radius > 0 ? s.radius : STATION_RADIUS, faction: stationFaction(s.name, s.model ?? '') });
  }
  const stations = out.slice();
  const near = new Set<string>();
  for (const s of pack.scenery ?? []) if (s.near) near.add(s.near);
  for (const p of pack.hyperspace?.points ?? []) {
    const imperial = near.has(p.id) || (!!p.name && near.has(p.name));
    out.push({ name: p.name || p.id, x: mirror(p.x), y: p.y, z: p.z, radius: POINT_RADIUS, faction: imperial ? 'imperial' : 'neutral' });
  }
  // The lane: out from the arrival (the zone's origin on an older pack) toward the nearest station.
  const a = pack.arrival ?? { x: 0, y: 0, z: 0 };
  const ax = mirror(a.x);
  let best: RosterAnchor | null = null;
  let bestD = Infinity;
  for (const s of stations) {
    const d = Math.hypot(s.x - ax, s.y - a.y, s.z - a.z);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  let lx = ax;
  let ly = a.y;
  let lz = a.z;
  if (best && bestD > 1e-3) {
    const k = Math.min(LANE_OUT, bestD) / bestD;
    lx += (best.x - ax) * k;
    ly += (best.y - a.y) * k;
    lz += (best.z - a.z) * k;
  }
  const crowded = out.some((o) => Math.hypot(o.x - lx, o.y - ly, o.z - lz) < LANE_CROWD);
  if (!crowded) out.push({ name: 'lane', x: lx, y: ly, z: lz, radius: STATION_RADIUS, faction: 'lane' });
  return out;
}

/** The type of a family at a tier: that tier, else the nearest below, else the lowest. */
function atTier(of: readonly NpcTypeDef[], tier: number): NpcTypeDef | null {
  let best: NpcTypeDef | null = null;
  for (const t of of) if (t.tier <= tier && (!best || t.tier > best.tier)) best = t;
  if (best) return best;
  for (const t of of) if (!best || t.tier < best.tier) best = t;
  return best;
}

/** The NPC type ids for a group: each family at the tier (clamped to the family's tiers), a style picked by rng for bases with styles; null when a family has no type. */
export function groupTypes(types: readonly NpcTypeDef[], faction: Recipe, tier: number, rng: () => number): string[] | null {
  const recipes = GROUPS[faction];
  const r = recipes.find((g) => tier <= g.upTo) ?? recipes[recipes.length - 1];
  const out: string[] = [];
  for (const base of r.families) {
    const ofBase = types.filter((t) => t.family === base || t.base === base);
    if (!ofBase.length) return null;
    const families = [...new Set(ofBase.map((t) => t.family))].sort();
    const family = families[Math.min(families.length - 1, Math.floor(rng() * families.length))];
    const t = atTier(
      ofBase.filter((x) => x.family === family),
      tier,
    );
    if (!t) return null;
    out.push(t.id);
  }
  return out;
}
