// Any garage ship hull stood as an NPC ship, for a side and at a tier the caller picks (the owner's request of
// 2026-10-19: every ship a player flies can be spawned as an NPC, flying for the faction he chooses).
//
// The combat file's types are the game's own NPC ships, each a family at a tier with its side, its taunt table and its
// tier chassis. A hull stood this way flies as a type of OURS made from the hull's own fields: its family is its
// chassis's name less `player_`, its name the game's own for an NPC type drawn on that hull where there is one (else
// the garage's words for it), its side and tier the caller's, and its taunt table the one the converter gives a type
// of that side and family at that tier (`tauntTableOf`, tools/swg/npcships.mjs, written again here). Nothing else is
// invented: where an NPC type of the hull's own family (else any the hull draws) has a tier fit in the combat file,
// the one nearest the tier gives its chassis and `pickLoadout` picks the parts at the tier asked, as for a typed ship;
// a hull with none flies its stock fit, as a player gets it. Every reader of the tier goes through the ladder
// (`tierLadder.ts`), so tiers 6 to 10 fly, fit and take damage as it says, and its knob reaches these ships too.
//
// Pure: no three, no rapier; node's tests import it straight from source.
import type { NpcFaction, NpcTypeDef } from './combatData.ts';
import { familyOf } from './shipStats.ts';

/** The sides a hull may be stood for, in the NPC tab's order. Never 'player', which is the flown ship's while it is flown. */
export const NPC_SIDES: readonly NpcFaction[] = ['imperial', 'rebel', 'blacksun', 'pirate', 'neutral'];

/** The tiers a hull may be stood at [SOE: the families run to tier 10]; above 5 they are read through the ladder. */
export const HULL_TIERS = { least: 1, most: 10 } as const;

/** A side named exactly as `NPC_SIDES` spells it, or null (the player's own, a capital letter, anything else). */
export function npcSideOf(x: unknown): NpcFaction | null {
  return typeof x === 'string' && (NPC_SIDES as readonly string[]).includes(x) ? (x as NpcFaction) : null;
}

/** A whole tier from 1 to 10, or null. */
export function npcTierOf(x: unknown): number | null {
  return typeof x === 'number' && Number.isInteger(x) && x >= HULL_TIERS.least && x <= HULL_TIERS.most ? x : null;
}

/** What of a garage def this file reads (a `VehicleDef` in the game, a manifest row in a test). */
export interface HullLike {
  id: string;
  label: string;
  template?: string;
  chassis?: string | null;
  fit?: { chassis?: string } | null;
  bounds?: { min: readonly number[]; max: readonly number[] } | null;
}

/** The chassis row a hull flies as when it is its own: its fit's, else the manifest's, else the player row named after it (as `ShipContacts` names it). */
export function hullChassisOf(h: HullLike): string {
  return h.fit?.chassis || h.chassis || `player_${h.id}`;
}

/** A hull's family: its chassis's name less `player_` (`player_corvette` -> `corvette`; the decorated YT-1300's is the YT-1300's). */
export function hullFamilyOf(h: HullLike): string {
  return hullChassisOf(h).replace(/^player_/, '');
}

/** The garage's words for a hull, less the class it writes after them (`yt1300 (freighter)` -> `yt1300`). */
export function hullWords(h: HullLike): string {
  return h.label.replace(/\s*\([^()]*\)\s*$/, '').trim() || h.id;
}

/** How near a type drawn on the hull is to the hull's own family: 0 the family itself, 1 its style-less base, 2 another drawn on it. */
function rankOn(family: string, base: string, t: NpcTypeDef): number {
  if (t.family === family) return 0;
  return t.family === base || t.base === base ? 1 : 2;
}

/** The game's NPC types drawn on a hull: its own family first, then its base, then any other, each by tier. */
export function typesOnHull(h: HullLike, types: readonly NpcTypeDef[]): NpcTypeDef[] {
  const family = hullFamilyOf(h);
  const base = familyOf(family);
  return types.filter((t) => t.hull === h.id && !t.standIn).sort((a, b) => rankOn(family, base, a) - rankOn(family, base, b) || a.tier - b.tier || a.family.localeCompare(b.family));
}

/** The game's own name for a hull: an NPC type drawn on it (its own family's lowest tier first), else the garage's words. */
export function hullNameOf(h: HullLike, types: readonly NpcTypeDef[]): string {
  return typesOnHull(h, types)[0]?.name ?? hullWords(h);
}

/**
 * The taunt table a type of `side` and `family` reads at `tier`, exactly as the converter gives the game's types one
 * (`tauntTableOf` in tools/swg/npcships.mjs, which `hullNpc.test.ts` holds this to): the Empire, the Alliance and Black
 * Sun their own; pirates on a Hutt hull 'hutt', other pirates and the neutral 'generic'; tiers 1 and 2 the `_low` table.
 */
export function tauntTableFor(side: NpcFaction, family: string, tier: number): string {
  let table = 'generic';
  if (side === 'imperial' || side === 'rebel' || side === 'blacksun') table = side;
  else if (side === 'pirate' && /^hutt_/.test(family)) table = 'hutt';
  return tier <= 2 ? `${table}_low` : table;
}

/** How a hull is stood as an NPC: the type of ours it flies as, and where its fit comes from. */
export interface HullNpcPlan {
  type: NpcTypeDef;
  /** 'tier': a tier chassis's fit, its parts picked at the tier asked (`pickLoadout`); 'stock': the hull's own stock fit. */
  fit: 'tier' | 'stock';
  /** The game's type whose tier chassis it takes, for 'tier'; null for 'stock'. */
  from: NpcTypeDef | null;
}

/**
 * The plan for a hull at a side and tier. The tier fit comes from the best-ranked group of the hull's types that has one
 * (`hasTierFit(chassis)`: the combat file built a fit for that chassis), the type nearest the tier in it (the lower on a
 * tie, as `spawnFamily` picks); none, the stock fit, and the chassis the hull flies as when it is its own.
 */
export function hullNpcPlan(h: HullLike, side: NpcFaction, tier: number, types: readonly NpcTypeDef[], hasTierFit: (chassis: string) => boolean): HullNpcPlan {
  const family = hullFamilyOf(h);
  const base = familyOf(family);
  let from: NpcTypeDef | null = null;
  let best = 3;
  for (const t of typesOnHull(h, types)) {
    if (!hasTierFit(t.chassis)) continue;
    const r = rankOn(family, base, t);
    if (r < best) {
      best = r;
      from = t;
    } else if (r === best && from && Math.abs(t.tier - tier) < Math.abs(from.tier - tier)) from = t;
  }
  const style = /^(.+)_(s\d+)$/.exec(family);
  // The type of ours: the hull's own fields, the side and tier asked. Never in the combat file (`standIn`).
  const type: NpcTypeDef = {
    id: `${h.id}_as_${side}_tier${tier}`,
    name: hullNameOf(h, types),
    family,
    base: style ? style[1] : family,
    style: style ? style[2] : null,
    tier,
    hull: h.id,
    chassis: from ? from.chassis : hullChassisOf(h),
    faction: side,
    taunts: tauntTableFor(side, family, tier),
    ...(h.template ? { template: h.template } : {}),
    standIn: true,
  };
  return { type, fit: from ? 'tier' : 'stock', from };
}

/**
 * The bounding radius (metres) of the largest of the game's own NPC hulls, which its formation tables, the NPC ships'
 * draw distance, their leash and their pilots' sight and gun reach were all made for [ours: a Black Sun heavy's box comes
 * to 15 m across its longer side and 17 m to its corner, and every typed hull is smaller (`hullNpc.test.ts` reads the
 * pack); a hull no bigger than this is laid out, drawn, leashed and measured exactly as a typed one is].
 */
export const HULL_FITTED_RADIUS = 17;

/** How a group of hulls bigger than a fighter is laid out; both ours, both live (`__debug.npcShips({ hulls })`). */
export const HULL_NPC_TUNE = {
  /**
   * The bounding radius (metres) the game's formation tables are laid out for: a group's slots are spread by the hull's
   * own radius over this and never drawn in closer than the table's [ours: `HULL_FITTED_RADIUS`, the largest typed NPC
   * hull's; the tables' first three slots stand at least 43 m apart, so at this the spheres never meet, where a
   * corvette's slots at the table's own 25 m stand three hulls in each other].
   */
  slotFits: HULL_FITTED_RADIUS,
  /**
   * The least room (metres) between the hull's bounding sphere, its formation's nearest member's included, and the
   * point it is stood ahead of [ours: the typed path's own floor, `Math.max(50, ahead)`, so a fighter asked for 400 m or
   * 700 m stands just where a typed one does, and only a hull whose sphere would reach nearer is stood further out: a
   * corvette patrol's wingmen, a Star Destroyer past its own 1.5 km].
   */
  aheadClear: 50,
};

/** Half a box's diagonal, from its two corners in either order (a pack's BOX corners may be swapped); 0 with no box. */
export function hullRadiusOf(b: HullLike['bounds']): number {
  if (!b) return 0;
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const d = Math.abs((b.max[i] ?? 0) - (b.min[i] ?? 0)) / 2;
    s += d * d;
  }
  return Math.sqrt(s);
}

/** The factor a group's formation slots are spread by: the hull's radius over `slotFits`, never under 1. */
export function hullSpread(radius: number): number {
  return Math.max(1, radius / HULL_NPC_TUNE.slotFits);
}

/**
 * How far ahead the leader of `count` is stood (the leader faces back toward the point, so a slot's +Z is toward it):
 * never nearer than `ahead`, and far enough that the hull's sphere at the slot nearest the point keeps `aheadClear`.
 * A slot past the table's rows is behind the leader (40 m a step), as the manager lays it.
 */
export function hullAhead(radius: number, spread: number, rows: readonly (readonly number[])[], count: number, ahead: number): number {
  let forward = 0;
  for (let i = 1; i < count; i++) {
    const z = (rows[i]?.[2] ?? -40 * i) * spread;
    if (z > forward) forward = z;
  }
  return Math.max(ahead, radius + HULL_NPC_TUNE.aheadClear + forward);
}

/** Move the layout live: `slotFits` (1 to 500 m) and `aheadClear` (0 to 20000 m); other names and non-numbers are ignored. Answers the table. */
export function tuneHullNpc(patch: Partial<typeof HULL_NPC_TUNE>): typeof HULL_NPC_TUNE {
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (num(patch.slotFits)) HULL_NPC_TUNE.slotFits = Math.max(1, Math.min(500, patch.slotFits));
  if (num(patch.aheadClear)) HULL_NPC_TUNE.aheadClear = Math.max(0, Math.min(20000, patch.aheadClear));
  return HULL_NPC_TUNE;
}

/** How many times a fitted hull's size a hull is (its radius over `HULL_FITTED_RADIUS`), never under 1. */
export function hullSize(radius: number): number {
  return Math.max(1, radius / HULL_FITTED_RADIUS);
}

/**
 * Formation slot `i` of a group in the leader's own frame, spread by `spread`, into `out` ([x, y, z]): the table's row,
 * or past its rows behind and to either side, 40 m a step. The one rule the manager stands a group by (`slotOffset`,
 * `hullLayout`) and its wingmen hold their slots by (`NpcBrain.slotPoint`); at a spread of 1 it is the table's own row.
 */
export function slotOf(rows: readonly (readonly number[])[], i: number, spread: number, out: number[]): number[] {
  const row = rows[i];
  if (row) {
    out[0] = row[0] * spread;
    out[1] = row[1] * spread;
    out[2] = row[2] * spread;
  } else {
    out[0] = (i % 2 ? 1 : -1) * 40 * Math.ceil(i / 2) * spread;
    out[1] = 0;
    out[2] = -40 * i * spread;
  }
  return out;
}

/** The manager's own numbers a hull's layout is worked out from (all of them `npcShips.ts`'s and `npcBrain.ts`'s). */
export interface HullLayoutBase {
  /** How far off a fitted hull is drawn (`HIDE_BEYOND`). */
  hide: number;
  /** How far from where it was stood a fitted hull's pilot chases (`LEASH`). */
  leash: number;
  /** The most a patrol's route reaches past the hull's own radius from where it was stood, and how far up or down it goes. */
  routeOut: number;
  routeRise: number;
  /** How high over the ground a hand-stood fitted hull is held on a planet (`HAND_ABOVE`). */
  above: number;
}

/** A group of a hull stood for a side, laid out (`hullLayout`): everything `standHull` stands it by. */
export interface HullLayout {
  radius: number;
  /** Its formation slots' spread over the table's (`hullSpread`). */
  spread: number;
  /** How far ahead of the point the leader is stood (`hullAhead`). */
  reach: number;
  /** How high over the ground it is held on a planet: a fitted hull's height, and a bigger hull as much higher as its sphere is wider than a fitted one's. */
  above: number;
  /** Each member's offset from the leader in the leader's own frame ([x, y, z], the leader's own first). */
  slots: number[][];
  /**
   * How far from the player its members are drawn: as far as the hull looks as large as a fitted one does at `hide`
   * (`hullSize`), and never nearer than the farthest any member can stand from the point while its leader keeps its route.
   */
  drawReach: number;
  /** How far from where it was stood its pilots chase: a fitted hull's leash times the hull's size. */
  leash: number;
}

/**
 * The layout of `count` of a hull with the box `bounds` stood for a side whose formation is `rows`, asked `ahead` metres
 * ahead of a point. A hull no bigger than a fitted one is laid out, drawn and leashed exactly as a typed one is: slots
 * at the table's own spacing, stood where it is asked, drawn to `hide` and leashed to `leash`. A bigger one spreads its
 * slots by its radius over `slotFits`, is stood out past its own sphere (`hullAhead`), held as much higher over the ground
 * as its sphere is wider than a fitted hull's, drawn and leashed as many times further as it is a fitted hull's size, so
 * every member stands within its own draw distance and its own leash wherever its leader is on its route
 * (`hullNpc.test.ts` holds both over the pack, at the layout knob's start and its ends).
 */
export function hullLayout(bounds: HullLike['bounds'], rows: readonly (readonly number[])[], count: number, ahead: number, base: HullLayoutBase): HullLayout {
  const radius = hullRadiusOf(bounds);
  const spread = hullSpread(radius);
  const reach = hullAhead(radius, spread, rows, count, ahead);
  const slots: number[][] = [];
  let most = 0;
  for (let i = 0; i < count; i++) {
    const s = slotOf(rows, i, spread, [0, 0, 0]);
    slots.push(s);
    most = Math.max(most, Math.sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]));
  }
  const size = hullSize(radius);
  // The farthest any member's middle stands from where the group was stood: its leader on its route (`makeRoute`:
  // the hull's radius and `routeOut` round it, `routeRise` up or down), and the member its slot from the leader.
  const roams = radius + base.routeOut + base.routeRise + most;
  return {
    radius,
    spread,
    reach,
    above: base.above + Math.max(0, radius - HULL_FITTED_RADIUS),
    slots,
    drawReach: Math.max(base.hide * size, reach + roams),
    leash: base.leash * size,
  };
}

/**
 * How far a hull stands out toward the local direction (dx, dy, dz) past a fitted hull's sphere: its box's extent that
 * way (half extents hx, hy, hz), never past its own bounding radius, less `HULL_FITTED_RADIUS`, never under nought. A
 * hull no bigger than a fitted one stands out nought whichever way, so a typed ship's sight and gun reach measured with
 * it are exactly what they were; a Star Destroyer's is its length off its bow and stern and its height above its deck.
 */
export function reachBeyond(radius: number, hx: number, hy: number, hz: number, dx: number, dy: number, dz: number): number {
  if (!(radius > HULL_FITTED_RADIUS)) return 0;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const support = d > 1e-9 ? (Math.abs(dx) * hx + Math.abs(dy) * hy + Math.abs(dz) * hz) / d : radius;
  return Math.max(0, Math.min(radius, support) - HULL_FITTED_RADIUS);
}

/** What the console's `npcShip(what, opts)` was asked. */
export interface NpcShipAsk {
  tier?: unknown;
  count?: unknown;
  distance?: unknown;
  faction?: unknown;
}

/** Where the console's `npcShip` goes: a hull stood for a side (`standHull`) and its arguments, or the game's own types. */
export type NpcShipRoute =
  | { to: 'hull'; hull: string; side: unknown; tier: unknown; count: 1 | 3; ahead: number; named: boolean }
  | { to: 'type' };

/**
 * The console's `npcShip` routing: a side named asks for the hull even where a type or family has its name (the X-wing's);
 * with none named a type's or family's name stands the game's own types, as it always did, and any other name is taken
 * as a hull (`named` false: the console asks the garage it is one before standing it). A hull's side is neutral, its tier
 * 1, its count 1 (3 only when asked) and its distance 700 m unless said; the side and tier go to `standHull` as typed,
 * which refuses anything else in words.
 */
export function npcShipRoute(what: string, opts: NpcShipAsk, known: { type: boolean; family: boolean }): NpcShipRoute {
  const named = opts.faction !== undefined;
  if (!named && (known.type || known.family)) return { to: 'type' };
  const ahead = typeof opts.distance === 'number' && Number.isFinite(opts.distance) ? opts.distance : 700;
  return { to: 'hull', hull: what, side: named ? opts.faction : 'neutral', tier: opts.tier ?? 1, count: opts.count === 3 ? 3 : 1, ahead, named };
}
