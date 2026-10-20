// The NPC ships on a world: the patrols kept round a space zone's stations, hyperspace points and
// arrival lane (woken as the player comes within 3 km, put away past 6 km unless fighting, sent again
// a while after one is wiped out), and the ships stood from the NPC tab. Each one is an ordinary garage
// hull built with its tier chassis's fit (the components picked by `pickLoadout`, invented), compiled
// hidden and held before it is shown, fought through the world's ship contacts and flown by its brain.
// Any garage ship hull may be stood the same way for a side and tier picked (`standHull`), flying as a
// type of ours made from the hull's own fields (`hullNpc.ts`).
//
// While play is paused (a panel, the map, the menu) every NPC ship is held where it is and nothing
// thinks, fires or streams; on the first simulated frame each goes on at the cruise it had. Which
// groups keep which anchor, how many live at once and every distance below are invented.
import * as THREE from 'three';
import type { Bolts } from '../combat/bolts';
import type { Effects } from '../combat/effects';
import type { Physics } from '../core/physics';
import type { Garage, VehicleDef } from '../vehicles/garage';
import type { ResolvedFit } from '../vehicles/shipFit';
import type { Vehicle } from '../vehicles/vehicle';
import { WING_AUTO } from '../vehicles/wings.ts';
import { cellIndexOf } from '../vehicles/cells.ts';
import type { FormationName, NpcTypeDef } from './combatData';
import { ShipContact, type ShipContacts } from './contacts';
import { FACTION_LABEL, type ShipFaction } from './factions.ts';
import { HULL_FITTED_RADIUS, HULL_TIERS, NPC_SIDES, hullLayout, hullNpcPlan, hullRadiusOf, inTheWay, npcSideOf, npcTierOf, slotOf, standsInside, type HullLayoutBase, type InTheWay } from './hullNpc.ts';
import { pickLoadout, seeded } from './loadout';
import { LEASH, NpcBrain, type BrainContext } from './npcBrain';
import { formationPoint } from './pilot';
import { FACTION_FORMATION, anchorRecipes, anchorsOf, groupTypes, type AnchorFaction, type Recipe, type SpacePackLike } from './roster';

export interface NpcShip {
  vehicle: Vehicle;
  contact: ShipContact;
  brain: NpcBrain;
  type: NpcTypeDef;
  group: NpcGroup;
  /** Its place in the group (0 the leader), and so its formation slot. */
  slot: number;
  ready: boolean;
  /** Held by a pause (the manager lets it go on the first simulated frame). */
  paused: boolean;
}

export interface NpcGroup {
  id: number;
  faction: ShipFaction;
  formation: FormationName;
  /** In slot order: the first is the leader; a wingman whose leader went moves up. */
  members: NpcShip[];
  anchor: PatrolAnchor | null;
  /** The leader's patrol: four points round the anchor (or round where the group was stood). */
  route: THREE.Vector3[];
  waypoint: number;
  /** Stood from the NPC tab (no anchor): a hostile one goes for the player's ship. */
  byHand: boolean;
  /** Some member has a target (a group fighting is not put away by distance). */
  engaged: boolean;
  /** Where it keeps to without an anchor (where it was stood). */
  home: THREE.Vector3;
  /** Its leader has called out engaging the player (once per group). */
  called: boolean;
  /** Ships still being built for it. */
  pending: number;
  /**
   * How far its formation slots are spread over the table's: 1 for every group but one of hulls bigger than a fighter
   * stood by `standHull` (`hullSpread`), whose slots at the table's own spacing would stand the hulls in each other.
   */
  spread: number;
  /**
   * Past this from the player its members are not drawn (`HIDE_BEYOND` for every group but one of hulls bigger than a
   * fighter, `hullLayout`'s `drawReach`: a Star Destroyer patrol stands kilometres past `HIDE_BEYOND` from the start).
   */
  drawReach: number;
  /** How far from its anchor, or where it was stood, its pilots chase (`LEASH` for every group but one of big hulls). */
  leash: number;
}

/** How a group is spread, drawn and leashed: what `newGroup` takes; a `HullLayout` is one. */
interface GroupScale {
  spread: number;
  drawReach: number;
  leash: number;
}

export interface PatrolAnchor {
  name: string;
  pos: THREE.Vector3;
  radius: number;
  faction: AnchorFaction;
  slots: AnchorSlot[];
}

interface AnchorSlot {
  recipe: Recipe;
  group: NpcGroup | null;
  state: 'asleep' | 'spawning' | 'awake';
  /** Not woken again before this (simulated seconds). */
  respawnAt: number;
  /** It was wiped out: it comes back only while the player is at least WIPED_AWAY off. */
  wiped: boolean;
  /** No types for its recipe in this pack: never woken. */
  none: boolean;
}

export interface NpcShipDeps {
  bolts: Bolts;
  ships: ShipContacts;
  /** The world's own list: an NPC ship is pushed there once ready (stepped, hit, drawn, mapped). */
  vehicles: Vehicle[];
  garage(): Promise<Garage>;
  /** World.spawnHull: the hull built with its fit and prepared, stood exactly at `at`, hidden and held, not in the list. */
  spawnHull(def: VehicleDef, fit: ResolvedFit | null, at: THREE.Vector3, heading: number): Promise<Vehicle>;
  /** World.prepareExtras: what is made after the vehicle (its clear glass stand-ins), adopted and compiled a mesh at a time. */
  prepareExtras(objects: THREE.Object3D[]): Promise<void>;
  /** World.disposeVehicle: the one way a vehicle goes. */
  dispose(v: Vehicle): void;
  /** The pooled flash lights: null until the game hands them over. */
  effects(): Effects | null;
  /** The physics the brains' obstacle rays are cast in. */
  physics: Physics;
  /** The terrain's height on a planet; null in space. */
  groundAt: ((x: number, z: number) => number) | null;
  space: boolean;
  zoneTier: number;
  /** The player's place, kept by reference (world.playerTarget.pos). */
  playerPos: THREE.Vector3;
}

/** At most this many NPC ships live at once (invented, for the frame budget). */
export const NPC_SHIP_CAP = 16;
/** A patrol wakes within this of the player, is put away past SLEEP unless fighting, and comes back RESPAWN s after it was wiped out (invented). */
export const WAKE = 3000;
export const SLEEP = 6000;
export const RESPAWN = 150;
/** NPC fire stops while this many NPC bolts fly. */
export const MAX_NPC_BOLTS = 64;
/** Farther than this from the player a ship is not drawn and draws no trail (it still flies). */
export const HIDE_BEYOND = 4000;
/** A wiped-out patrol comes back only while the player is at least this far off. */
const WIPED_AWAY = 1500;
/** A patrol's route radius over its anchor's, and how far up or down its points go (metres, invented). */
const ROUTE_OUT = [600, 1200] as const;
const ROUTE_RISE = 200;
/** Stood from the NPC tab: this far ahead, and on a planet at least this high over the ground. */
const HAND_AHEAD = 700;
const HAND_ABOVE = 150;
/** A spawn's speed, as a share of the top. */
const LAUNCH_SHARE = 0.6;
/** Every typed group's (a patrol's, a family's): the table's own slots, drawn to HIDE_BEYOND, leashed to LEASH. */
const TYPED_SCALE: GroupScale = { spread: 1, drawReach: HIDE_BEYOND, leash: LEASH };
/** What a hull stood for a side is laid out from (`hullLayout`): this manager's and the brain's own numbers. */
const LAYOUT_BASE: HullLayoutBase = { hide: HIDE_BEYOND, leash: LEASH, routeOut: ROUTE_OUT[1], routeRise: ROUTE_RISE, above: HAND_ABOVE };
/** A slot's [x, y, z], kept for `slotOffset`. */
const slotArr = [0, 0, 0];

const Z = new THREE.Vector3(0, 0, 1);
const tmp = new THREE.Vector3();
const slotV = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

/** A quaternion turning the nose (+Z) onto the way from `from` to `to`, level (no roll). */
function lookAlong(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  tmp.copy(to).sub(from);
  if (tmp.lengthSq() < 1e-6) tmp.copy(Z);
  tmp.normalize();
  euler.set(Math.asin(THREE.MathUtils.clamp(-tmp.y, -1, 1)), Math.atan2(tmp.x, tmp.z), 0, 'YXZ');
  return out.setFromEuler(euler);
}

/** The heading (rad, 0 along +Z) of a quaternion's nose. */
function headingOf(q: THREE.Quaternion): number {
  tmp.copy(Z).applyQuaternion(q);
  return Math.atan2(tmp.x, tmp.z);
}

export class NpcShipManager {
  readonly ships: NpcShip[] = [];
  readonly groups: NpcGroup[] = [];
  anchors: PatrolAnchor[] = [];
  /** The console: false stops the patrols streaming in; `passive` stops every NPC's fire. */
  patrols = true;
  passive = false;
  /** Bumped whenever a ship comes or goes. */
  version = 0;
  /** Milliseconds the last update spent (thinking and streaming), for __debug.npcShips. */
  readonly ms = { think: 0 };
  /** Kills and losses since the world loaded, for the console. */
  readonly tally = { spawned: 0, destroyed: 0, failed: 0 };
  private disposed = false;
  private simulating = true;
  private now = 0;
  /** Ships being built (every group's). */
  private pending = 0;
  /** A patrol is being woken (one at a time). */
  private streaming = false;
  private nextGroupId = 1;
  private seed = (Date.now() & 0x7fffffff) >>> 0;
  /** Bumped by a clear of everything: a spawn still being built then throws its ship away. */
  private epoch = 0;
  private npcBolts = 0;
  private garageNow: Garage | null = null;
  private readonly ctx: BrainContext;
  private lastNote = '';
  /** The places of the stands from the NPC tab still being built, each held until its stand is done (`inTheWay`). */
  private readonly coming: InTheWay[] = [];

  constructor(private readonly deps: NpcShipDeps) {
    this.ctx = {
      ships: deps.ships,
      bolts: deps.bolts,
      physics: deps.physics,
      projectileFor: (i) => this.garageNow?.projectileFor(i) ?? null,
      effects: () => deps.effects(),
      groundAt: deps.groundAt,
      space: deps.space,
      mayFire: true,
    };
  }

  /** Space zones: the anchors of the zone's pack (roster.anchorsOf), each with its groups asleep. Replaces any before. */
  setAnchors(pack: SpacePackLike | null): void {
    if (this.disposed) return;
    this.anchors = anchorsOf(pack).map((a, i) => ({
      name: a.name,
      pos: new THREE.Vector3(a.x, a.y, a.z),
      radius: a.radius,
      faction: a.faction,
      slots: anchorRecipes(a.faction, this.deps.zoneTier, i).map((recipe) => ({ recipe, group: null, state: 'asleep' as const, respawnAt: 0, wiped: false, none: false })),
    }));
    if (this.anchors.length) console.info(`npc ships: ${this.anchors.length} anchors (${this.anchors.map((a) => `${a.name} ${a.faction}, ${a.slots.length} groups`).join('; ')}), zone tier ${this.deps.zoneTier}`);
  }

  /** A fresh generator for one spawn (its loadout and its pilot's scatter). */
  private newRng(): () => number {
    this.seed = (this.seed + 0x9e3779b1) >>> 0;
    return seeded(this.seed);
  }

  private newGroup(faction: ShipFaction, anchor: PatrolAnchor | null, byHand: boolean, route: THREE.Vector3[], home: THREE.Vector3, scale: GroupScale = TYPED_SCALE): NpcGroup {
    const g: NpcGroup = {
      id: this.nextGroupId++,
      faction,
      formation: FACTION_FORMATION[faction] ?? 'arrow',
      members: [],
      anchor,
      route,
      waypoint: 0,
      byHand,
      engaged: false,
      home: home.clone(),
      called: false,
      pending: 0,
      spread: scale.spread,
      drawReach: scale.drawReach,
      leash: scale.leash,
    };
    this.groups.push(g);
    return g;
  }

  /** Four points round a centre, `out` metres beyond `radius`, rising and sinking within ROUTE_RISE in space (level on a planet, `above` over the ground). */
  private makeRoute(centre: THREE.Vector3, radius: number, rng: () => number, above = HAND_ABOVE): THREE.Vector3[] {
    const r = radius + ROUTE_OUT[0] + (ROUTE_OUT[1] - ROUTE_OUT[0]) * rng();
    const turn = rng() * Math.PI * 2;
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      const a = turn + (i * Math.PI) / 2;
      const p = new THREE.Vector3(centre.x + Math.cos(a) * r, centre.y + (this.deps.space ? (rng() * 2 - 1) * ROUTE_RISE : 0), centre.z + Math.sin(a) * r);
      this.raise(p, above);
      out.push(p);
    }
    return out;
  }

  /** On a planet, a point at least `above` (HAND_ABOVE unless said) over the ground. */
  private raise(p: THREE.Vector3, above = HAND_ABOVE): THREE.Vector3 {
    const g = this.deps.groundAt;
    if (g) p.y = Math.max(p.y, g(p.x, p.z) + above);
    return p;
  }

  /** A group's formation slot `i` in the leader's frame (the table's row, or behind and to the side past its rows), spread by the group's own spread. */
  private slotOffset(g: NpcGroup, i: number, out: THREE.Vector3): THREE.Vector3 {
    const rows = this.deps.ships.data?.formation(g.formation, !this.deps.space) ?? [];
    return out.fromArray(slotOf(rows, i, g.spread, slotArr));
  }

  /** The refusal when `count` more would pass the cap (every ship out and every one being built counted), else null. */
  private capRefusal(count: number): string | null {
    if (this.ships.length + this.pending + count <= NPC_SHIP_CAP) return null;
    return `at most ${NPC_SHIP_CAP} NPC ships at once (${this.ships.length} out${this.pending ? `, ${this.pending} coming` : ''}): clear some first`;
  }

  /**
   * Stand `count` of a family at a tier (the nearest tier it has) `ahead` metres (700 by default) ahead of `from`
   * along `dir`, facing back toward `from`, in its faction's formation. Returns the sentence for the count line.
   */
  async spawnFamily(family: string, tier: number, count: 1 | 3, from: THREE.Vector3, dir: THREE.Vector3, ahead = HAND_AHEAD): Promise<string> {
    const data = this.deps.ships.data;
    if (!data) return 'no combat.json in the ships pack: convert the ships again';
    const types = data.typesOfFamily(family);
    if (!types.length) return `no NPC type of the family ${family}`;
    let type = types[0];
    for (const t of types) if (Math.abs(t.tier - tier) < Math.abs(type.tier - tier)) type = t;
    const full = this.capRefusal(count);
    if (full) return full;
    const epoch = this.epoch;
    // A family whose hull is bigger than a fighter (the gunboats, freighters and transports the ships pack's NPC-only
    // hulls draw) is laid out by its size, as a hull stood for a side is (`hullLayout`): at the tables' own spacing
    // three of them stood in each other. A fighter's family is stood exactly as it always was.
    const garage = await this.deps.garage();
    if (this.disposed || epoch !== this.epoch) return 'the NPC ships were cleared meanwhile';
    this.garageNow = garage;
    // Spawns begun while the garage loaded count too.
    const stillFull = this.capRefusal(count);
    if (stillFull) return stillFull;
    const hullDef = garage.vehicles.find((d) => d.id === type.hull && d.source === 'ship') ?? null;
    const faction = (type.faction ?? 'neutral') as ShipFaction;
    const lay = hullDef?.bounds && hullRadiusOf(hullDef.bounds) > HULL_FITTED_RADIUS ? hullLayout(hullDef.bounds, data.formation(FACTION_FORMATION[faction] ?? 'arrow', !this.deps.space), count, Math.max(50, ahead), LAYOUT_BASE) : null;
    const rng = this.newRng();
    tmp.copy(dir);
    if (tmp.lengthSq() < 1e-6) tmp.copy(Z);
    tmp.normalize();
    const lead = lay ? this.raise(from.clone().addScaledVector(tmp, lay.reach), lay.above) : this.raise(from.clone().addScaledVector(tmp, Math.max(50, ahead)));
    const q = lookAlong(lead, from, new THREE.Quaternion());
    // Every member's place before the first is built: a big hull's where its layout says, asked first whether any would
    // stand inside a ship already out or still being built (`standsInside`).
    const places: THREE.Vector3[] = [];
    if (lay) {
      for (let i = 0; i < count; i++) {
        const at = new THREE.Vector3();
        formationPoint(lead, q, slotV.fromArray(lay.slots[i]), at);
        places.push(this.raise(at, lay.above));
      }
      const inside = this.standsInsideOut(places, lay.radius);
      if (inside) return `a ${type.name} would stand inside the ${inside} already out there: face another way, or clear it first`;
    }
    const g = lay ? this.newGroup(faction, null, true, this.makeRoute(lead, lay.radius, rng, lay.above), lead, lay) : this.newGroup(faction, null, true, this.makeRoute(lead, 0, rng), lead);
    // A fighter's family exactly as it always was, at its table's own slots.
    if (!lay) {
      for (let i = 0; i < count; i++) {
        const at = new THREE.Vector3();
        formationPoint(lead, q, this.slotOffset(g, i, slotV), at);
        places.push(this.raise(at));
      }
    }
    // Held as coming while they are built, so a big hull asked for meanwhile is not stood inside them.
    const held = this.holdPlaces(places, lay ? lay.radius : (hullDef?.bounds ? hullRadiusOf(hullDef.bounds) : 0) || HULL_FITTED_RADIUS, type.name);
    const notes: string[] = [];
    try {
      for (let i = 0; i < count; i++) {
        const r = await this.spawnType(type.id, places[i], q, g, i, rng);
        if (this.disposed || epoch !== this.epoch) return 'the NPC ships were cleared meanwhile';
        if (typeof r === 'string') notes.push(r);
      }
    } finally {
      this.releasePlaces(held);
    }
    if (!g.members.length && !g.pending) this.dropGroup(g);
    const got = g.members.length;
    const what = `${type.name} (tier ${type.tier})`;
    if (!got) return `no ${what} could be stood: ${notes.join('; ') || 'unknown'}`;
    return `${got === 1 ? 'one' : got} ${what} ${Math.round(Math.max(50, ahead))} m ahead${this.simulating ? '' : ', held until the panel closes'}${notes.length ? ` (${notes.join('; ')})` : ''}`;
  }

  /**
   * Stand `count` of a garage ship hull (any `source: 'ship'` def, the room ships among them) as NPC ships flying for
   * `side` (one of `NPC_SIDES`, never the player's) at `tier` (1 to 10, every reader of it through the ladder), as a
   * type of ours made from the hull's own fields (`hullNpcPlan`): the tier chassis's fit where an NPC type the hull
   * draws has one, the hull's stock fit otherwise. Stood `ahead` metres (700 by default) ahead of `from` along `dir`,
   * facing back toward it, in the side's formation spread to the hull's size, and further out when the hull is too big
   * for 700 m (`hullAhead`). The NPC tab and the console both come here. Returns the sentence for the count line.
   */
  async standHull(hullId: string, side: unknown, tier: unknown, count: 1 | 3, from: THREE.Vector3, dir: THREE.Vector3, ahead = HAND_AHEAD, as: { name: string; endOfWar: string } | null = null): Promise<string> {
    const faction = npcSideOf(side);
    if (!faction) return `a ship flies for ${NPC_SIDES.join(', ')}; not ${typeof side === 'string' ? `'${side}'` : String(side)}`;
    const t = npcTierOf(tier);
    if (t === null) return `a tier is a whole number from ${HULL_TIERS.least} to ${HULL_TIERS.most}; not ${String(tier)}`;
    const data = this.deps.ships.data;
    if (!data) return 'no combat.json in the ships pack: convert the ships again';
    const full = this.capRefusal(count);
    if (full) return full;
    const epoch = this.epoch;
    const garage = await this.deps.garage();
    if (this.disposed || epoch !== this.epoch) return 'the NPC ships were cleared meanwhile';
    this.garageNow = garage;
    const want = hullId.toLowerCase();
    const hull = garage.vehicles.find((d) => d.source === 'ship' && d.id === hullId) ?? garage.vehicles.find((d) => d.source === 'ship' && d.id.toLowerCase() === want);
    if (!hull) return `no garage ship ${hullId}`;
    // Spawns begun while the garage loaded count too.
    const stillFull = this.capRefusal(count);
    if (stillFull) return stillFull;
    // One of the End of War's ships (`as`) flies as this hull under its own name and id.
    const plan = hullNpcPlan(hull, faction, t, data.file.types, (c) => !!data.chassis(c)?.fit, as);
    // Laid out for its size (`hullLayout`): a fighter exactly as a typed one is; a bigger hull's slots spread by its
    // radius, stood out past its own sphere, held higher over the ground on a planet by as much as it is wider than a
    // fighter, and drawn and leashed as far as its size asks, so no member stands past its own draw distance or leash.
    const rows = data.formation(FACTION_FORMATION[faction] ?? 'arrow', !this.deps.space);
    const lay = hullLayout(hull.bounds, rows, count, Math.max(50, ahead), LAYOUT_BASE);
    const rng = this.newRng();
    tmp.copy(dir);
    if (tmp.lengthSq() < 1e-6) tmp.copy(Z);
    tmp.normalize();
    const lead = this.raise(from.clone().addScaledVector(tmp, lay.reach), lay.above);
    const q = lookAlong(lead, from, new THREE.Quaternion());
    const places: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const at = new THREE.Vector3();
      formationPoint(lead, q, slotV.fromArray(lay.slots[i]), at);
      this.raise(at, lay.above);
      places.push(at);
    }
    // A hull bigger than a fitted one is never stood inside a ship already out or still being built (`standsInside`); a
    // fighter's own formation table keeps its spheres apart, and it is never asked, as a fighter's family is not.
    const inside = lay.radius > HULL_FITTED_RADIUS ? this.standsInsideOut(places, lay.radius) : null;
    if (inside) return `a ${plan.type.name} would stand inside the ${inside} already out there: face another way, or clear it first`;
    const g = this.newGroup(faction, null, true, this.makeRoute(lead, lay.radius, rng, lay.above), lead, lay);
    // Held as coming while they are built, so a big hull asked for meanwhile is not stood inside them.
    const held = this.holdPlaces(places, lay.radius || HULL_FITTED_RADIUS, plan.type.name);
    const notes: string[] = [];
    try {
      for (let i = 0; i < count; i++) {
        const at = places[i];
        const r = await this.stand(plan.type, hull, at, q, g, rng);
        if (this.disposed || epoch !== this.epoch) return 'the NPC ships were cleared meanwhile';
        if (typeof r === 'string') notes.push(r);
      }
    } finally {
      this.releasePlaces(held);
    }
    if (!g.members.length && !g.pending) this.dropGroup(g);
    const got = g.members.length;
    const fit = plan.fit === 'tier' && plan.from ? `fitted as ${plan.from.id}` : 'on its stock fit';
    const what = `${plan.type.name} flying for ${FACTION_LABEL[faction]} at tier ${t}${t > 5 ? ' (read through the ladder)' : ''}, ${fit}`;
    if (!got) return `no ${plan.type.name} could be stood: ${notes.join('; ') || 'unknown'}`;
    return `${got === 1 ? 'one' : got} ${what}, ${Math.round(lay.reach)} m ahead${this.simulating ? '' : ', held until the panel closes'}${notes.length ? ` (${notes.join('; ')})` : ''}`;
  }

  /**
   * Build one NPC ship of a type the combat file carries (`stand`). `slot` is the formation slot `at` was worked out
   * for; the ship takes the group's next place, so one that failed to build leaves no gap in the order.
   */
  async spawnType(typeId: string, at: THREE.Vector3, q: THREE.Quaternion, group: NpcGroup, slot: number, rng: () => number): Promise<NpcShip | string> {
    const type = this.deps.ships.data?.typeById(typeId) ?? null;
    if (!type) return `no NPC type ${typeId}`;
    return this.stand(type, null, at, q, group, rng);
  }

  /**
   * Build one NPC ship: its hull from the garage (`hull`, or the one its type is drawn with) with its tier chassis's
   * fit (the components picked by tier, invented) or the hull's stock fit, prepared and held while hidden, then its
   * contact and combat, its full attitude and speed, its brain; shown and put in the world's list only then. A spawn
   * that finds the manager disposed (the world went) or cleared at any wait throws away what it made.
   */
  private async stand(type: NpcTypeDef, hull: VehicleDef | null, at: THREE.Vector3, q: THREE.Quaternion, group: NpcGroup, rng: () => number): Promise<NpcShip | string> {
    const data = this.deps.ships.data;
    if (!data) return `no NPC type ${type.id}`;
    const epoch = this.epoch;
    this.pending++;
    group.pending++;
    let v: Vehicle | null = null;
    try {
      const garage = await this.deps.garage();
      this.garageNow = garage;
      if (this.disposed || epoch !== this.epoch) return 'the world changed';
      const hullDef = hull ?? garage.vehicles.find((d) => d.id === type.hull && d.source === 'ship') ?? garage.find(type.hull);
      if (!hullDef) return `no garage hull ${type.hull}`;
      const chassis = data.chassis(type.chassis);
      // Nobody sits in it: no cockpit frame, no rooms; its wings and engine parts stay. With the tier chassis's
      // fit the garage hangs that fit's parts; without one (a pack that could not build it) the hull's stock.
      const fitDef = garage.components.length ? (chassis?.fit ?? hullDef.fit ?? null) : null;
      const npcDef: VehicleDef = { ...hullDef, label: type.name, fit: fitDef, cockpit: null, interior: null };
      const picked = chassis?.fit && fitDef === chassis.fit ? pickLoadout(chassis.fit, garage.components, type.tier, hullDef.weapon?.projectile ?? null, rng) : null;
      const fit = garage.resolve(npcDef, picked);
      v = await this.deps.spawnHull(npcDef, fit, at, headingOf(q));
      if (this.disposed || epoch !== this.epoch) return 'the world changed';
      // A hull that is itself a portal building carries its rooms in its model, often larger than the hull round them:
      // nobody boards an NPC ship, so they stay hidden as a player's ship's do until someone is aboard (`reveal`).
      v.group.traverse((o) => {
        if (cellIndexOf(o) > 0) o.visible = false;
      });
      // What the garage made after the vehicle: the clear glass stand-ins (the glows and trails compiled with the hull).
      const extras: THREE.Object3D[] = [...v.glows, ...v.trails.map((t) => t.mesh), ...v.group.children.filter((o) => o.userData.paneStandIn === true)];
      if (extras.length) await this.deps.prepareExtras(extras);
      if (this.disposed || epoch !== this.epoch) return 'the world changed';
      const combat = this.deps.ships.adopt(v, { faction: type.faction as ShipFaction, type });
      const contact = combat.contact;
      // Solid again (spawnHull ghosts a hull while it is prepared), its full attitude, then into flight at a share of
      // its (now its stats') top speed.
      v.setGhost(false);
      v.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      v.group.quaternion.copy(q);
      // Its pilot's hand on the wings before the launch snaps them, so a patrol arrives with them shut (the brain, made
      // just after, opens them when it takes a target); under the 'flight' rule the flight rule has them, as before.
      v.wings.brain = WING_AUTO.npc === 'target' ? false : null;
      v.launch(LAUNCH_SHARE * v.spec.maxSpeed * (this.deps.space ? 2 : 1));
      const ship: NpcShip = { vehicle: v, contact, brain: null as unknown as NpcBrain, type, group, slot: group.members.length, ready: true, paused: !this.simulating };
      ship.brain = new NpcBrain(ship, rng);
      v.autopilot = ship.brain;
      if (this.simulating) v.resumeFlight();
      v.group.visible = true;
      group.members.push(ship);
      this.ships.push(ship);
      this.deps.vehicles.push(v);
      this.tally.spawned++;
      this.version++;
      // Handed over: the world's list and this manager own it now.
      v = null;
      return ship;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A spawn a travel cancelled (garage.ts SpawnCancelled, told by its name) is no fault worth a warning.
      if (err instanceof Error && err.name === 'SpawnCancelled') return 'the world changed';
      this.tally.failed++;
      if (msg !== this.lastNote) console.warn(`npc ships: ${type.id} was not stood`, err);
      this.lastNote = msg;
      return msg;
    } finally {
      // Anything made and not handed over goes the one way a vehicle goes.
      if (v) this.deps.dispose(v);
      this.pending--;
      group.pending--;
    }
  }

  /** Streaming, thinking, firing: called from World.stepLiving; while not simulating every ship is held and nothing thinks, fires or streams. */
  update(dt: number, now: number, simulating: boolean): void {
    const t0 = performance.now();
    this.now = now;
    this.simulating = simulating;
    // Drop the gone (a destruction, a clear, the world's own dispose).
    for (let i = this.ships.length - 1; i >= 0; i--) if (this.ships[i].vehicle.disposed) this.drop(i);
    if (!simulating) {
      for (const s of this.ships) {
        if (s.ready && !s.paused) {
          s.vehicle.held = true;
          s.paused = true;
        }
      }
      this.ms.think = performance.now() - t0;
      return;
    }
    for (const s of this.ships) {
      if (s.paused) {
        s.vehicle.resumeFlight();
        s.paused = false;
      }
    }
    // NPC bolts in the air: fire stops at the cap (the contacts' count, nothing allocated).
    const n = this.deps.ships.npcBolts();
    this.npcBolts = n;
    this.ctx.mayFire = !this.passive && n < MAX_NPC_BOLTS;
    if (this.deps.space && this.patrols) this.stream(now);
    for (const g of this.groups) {
      g.engaged = false;
      for (const m of g.members) {
        if (m.brain.target) {
          g.engaged = true;
          break;
        }
      }
    }
    const p = this.deps.playerPos;
    for (let i = 0; i < this.ships.length; i++) {
      const s = this.ships[i];
      // A patrol put away by `stream` just now is disposed and leaves the list on the next update: its body is gone.
      if (!s.ready || s.vehicle.disposed) continue;
      s.brain.think(dt, now, this.ctx);
      // Far away: not drawn (the glow's closure then feeds its trails nothing); it still flies. How far is its group's
      // (HIDE_BEYOND, or a big hull's own `drawReach`, which its layout stands every member within).
      const far = s.group.drawReach;
      const show = s.vehicle.pos.distanceToSquared(p) <= far * far;
      if (s.vehicle.group.visible !== show) s.vehicle.group.visible = show;
    }
    this.ms.think = performance.now() - t0;
  }

  /** The anchors' groups: woken within WAKE, put away past SLEEP unless fighting, sent again RESPAWN s after a wipe-out. */
  private stream(now: number): void {
    const p = this.deps.playerPos;
    for (const a of this.anchors) {
      const d = a.pos.distanceTo(p);
      for (const s of a.slots) {
        if (s.none) continue;
        if (s.state === 'awake') {
          const g = s.group!;
          if (!g.members.length && !g.pending) {
            s.state = 'asleep';
            s.group = null;
            s.respawnAt = now + RESPAWN;
            s.wiped = true;
            this.dropGroup(g);
          } else if (d > SLEEP && !g.engaged) {
            for (const m of [...g.members]) this.deps.dispose(m.vehicle);
            s.state = 'asleep';
            s.group = null;
            s.respawnAt = 0;
            s.wiped = false;
            // Its members leave the ships list on the next update (their vehicles are disposed); the group goes now.
            this.dropGroup(g);
          }
        } else if (s.state === 'asleep' && d < WAKE && now >= s.respawnAt && (!s.wiped || d >= WIPED_AWAY) && !this.streaming && this.ships.length + this.pending + 3 <= NPC_SHIP_CAP) {
          void this.wake(a, s, now);
        }
      }
    }
  }

  /** Wake an anchor's group: its types for the zone's tier, its route, stood at the route point farthest from the player. */
  private async wake(a: PatrolAnchor, s: AnchorSlot, now: number): Promise<void> {
    const data = this.deps.ships.data;
    if (!data) return;
    // A clear of everything while this patrol is being built stops the rest of it too, not only the ship in hand.
    const epoch = this.epoch;
    this.streaming = true;
    s.state = 'spawning';
    try {
      const rng = this.newRng();
      const ids = groupTypes(data.file.types, s.recipe, this.deps.zoneTier, rng);
      if (!ids?.length) {
        s.none = true;
        s.state = 'asleep';
        console.info(`npc ships: ${a.name}: no ${s.recipe} types in this pack; that group is left out`);
        return;
      }
      const route = this.makeRoute(a.pos, a.radius, rng);
      // Out of the player's way: the route point farthest from them, facing the next.
      const p = this.deps.playerPos;
      let start = 0;
      for (let i = 1; i < route.length; i++) if (route[i].distanceToSquared(p) > route[start].distanceToSquared(p)) start = i;
      const at = route[start];
      const q = lookAlong(at, route[(start + 1) % route.length], new THREE.Quaternion());
      const g = this.newGroup(s.recipe as ShipFaction, a, false, route, a.pos);
      g.waypoint = (start + 1) % route.length;
      s.group = g;
      for (let i = 0; i < ids.length; i++) {
        if (this.ships.length + this.pending >= NPC_SHIP_CAP) break;
        const pos = new THREE.Vector3();
        formationPoint(at, q, this.slotOffset(g, i, slotV), pos);
        await this.spawnType(ids[i], pos, q, g, i, rng);
        if (this.disposed) return;
        if (epoch !== this.epoch) {
          // Cleared meanwhile: back as a wiped-out patrol comes back (what was built was taken by the clear).
          if (s.group === g) {
            s.state = 'asleep';
            s.group = null;
            s.respawnAt = this.now + RESPAWN;
            s.wiped = true;
          }
          this.dropGroup(g);
          return;
        }
      }
      if (s.group !== g) return;
      if (g.members.length) s.state = 'awake';
      else {
        s.state = 'asleep';
        s.group = null;
        s.respawnAt = now + RESPAWN;
        this.dropGroup(g);
      }
    } catch (err) {
      console.warn(`npc ships: ${a.name}: a patrol was not stood`, err);
      if (s.group?.members.length) s.state = 'awake';
      else {
        if (s.group) this.dropGroup(s.group);
        s.group = null;
        s.state = 'asleep';
        s.respawnAt = now + RESPAWN;
      }
    } finally {
      this.streaming = false;
    }
  }

  /** Called when a ship is destroyed (the ship contacts' `onShipDown`): the tally; the ship itself goes with the world's dispose. */
  destroyed(v: Vehicle, now: number): void {
    void now;
    if (this.ships.some((s) => s.vehicle === v)) this.tally.destroyed++;
  }

  /** Out of the lists (its group closes up; the wingman behind a gone leader leads). */
  private drop(i: number): void {
    const s = this.ships[i];
    const last = this.ships.length - 1;
    this.ships[i] = this.ships[last];
    this.ships.length = last;
    const g = s.group;
    const k = g.members.indexOf(s);
    if (k >= 0) {
      g.members.splice(k, 1);
      for (let j = 0; j < g.members.length; j++) g.members[j].slot = j;
    }
    if (!g.members.length && !g.pending && !g.anchor) this.dropGroup(g);
    this.version++;
  }

  private dropGroup(g: NpcGroup): void {
    const i = this.groups.indexOf(g);
    if (i >= 0) this.groups.splice(i, 1);
  }

  /** How many NPC ships are out (of a family of the game's types, when given; a hull stood for a side is its own row's). */
  count(family?: string): number {
    if (!family) return this.ships.length;
    let n = 0;
    for (const s of this.ships) if (s.type.family === family && !s.type.standIn) n++;
    return n;
  }

  /**
   * The name of the ship out, or the stand still being built, that a hull of `radius` stood at `places` would stand
   * inside, or null (`standsInside` over `inTheWay`).
   */
  private standsInsideOut(places: readonly THREE.Vector3[], radius: number): string | null {
    const out = inTheWay(this.ships, this.coming);
    const j = standsInside(places, radius, out);
    return j < 0 ? null : out[j].name;
  }

  /** Hold a stand's places as coming (`inTheWay`) until `releasePlaces`, which the stand calls however it ends. */
  private holdPlaces(places: readonly THREE.Vector3[], radius: number, name: string): InTheWay[] {
    const held = places.map((p) => ({ x: p.x, y: p.y, z: p.z, radius, name }));
    this.coming.push(...held);
    return held;
  }

  private releasePlaces(held: readonly InTheWay[]): void {
    for (const h of held) {
      const i = this.coming.indexOf(h);
      if (i >= 0) this.coming.splice(i, 1);
    }
  }

  /** How many of a garage hull are out as NPC ships stood for a side (`standHull`), the End of War's apart. */
  countHull(hull: string): number {
    let n = 0;
    for (const s of this.ships) if (s.type.standIn && s.type.hull === hull && !s.type.endOfWar) n++;
    return n;
  }

  /** How many of one of the End of War's ships are out (`standHull` with its name). */
  countEndOfWar(id: string): number {
    let n = 0;
    for (const s of this.ships) if (s.type.endOfWar === id) n++;
    return n;
  }

  /** Take NPC ships away (those the filter picks, or every one, and every spawn still being built); returns how many. */
  clear(filter?: (s: NpcShip) => boolean): number {
    let n = 0;
    for (let i = this.ships.length - 1; i >= 0; i--) {
      const s = this.ships[i];
      if (filter && !filter(s)) continue;
      this.deps.dispose(s.vehicle);
      this.drop(i);
      n++;
    }
    if (!filter) {
      this.epoch++;
      // The anchors' patrols come back as a wiped-out one does.
      for (const a of this.anchors) {
        for (const s of a.slots) {
          if (s.state !== 'awake') continue;
          if (s.group) this.dropGroup(s.group);
          s.state = 'asleep';
          s.group = null;
          s.respawnAt = this.now + RESPAWN;
          s.wiped = true;
        }
      }
    }
    return n;
  }

  /** The console's view (allocates; not per frame). */
  report(): Record<string, unknown> {
    const p = this.deps.playerPos;
    const n0 = (x: number) => Math.round(x);
    const member = (s: NpcShip) => {
      const c = s.contact.combat?.summary() ?? null;
      const t = s.brain.target;
      return {
        type: s.type.id,
        name: s.type.name,
        tier: s.type.tier,
        slot: s.slot,
        state: s.brain.state,
        target: t ? (t instanceof ShipContact ? `${t.label} (${t.faction})` : t.label) : null,
        shields: c ? n0(c.shield * 100) : null,
        armour: c ? n0(c.armour * 100) : null,
        hull: n0((s.vehicle.hp / s.vehicle.maxHp) * 100),
        shots: s.brain.shots,
        hits: s.contact.combat?.tally.hits ?? 0,
        taken: s.contact.combat?.tally.taken ?? 0,
        distance: n0(s.vehicle.pos.distanceTo(p)),
        speed: n0(s.vehicle.speed),
        ready: s.ready,
        paused: s.paused,
        shown: s.vehicle.group.visible,
      };
    };
    return {
      cap: NPC_SHIP_CAP,
      live: this.ships.length,
      pending: this.pending,
      patrols: this.patrols,
      passive: this.passive,
      space: this.deps.space,
      zoneTier: this.deps.zoneTier,
      npcBolts: this.npcBolts,
      tally: { ...this.tally },
      anchors: this.anchors.map((a) => ({ name: a.name, faction: a.faction, distance: n0(a.pos.distanceTo(p)), groups: a.slots.map((s) => `${s.recipe}: ${s.none ? 'no types' : s.state}${s.state === 'asleep' && s.respawnAt > this.now ? ` (back in ${n0(s.respawnAt - this.now)} s)` : ''}`) })),
      groups: this.groups.map((g) => ({ id: g.id, faction: g.faction, formation: g.formation, byHand: g.byHand, anchor: g.anchor?.name ?? null, engaged: g.engaged, pending: g.pending, ...(g.spread !== 1 || g.drawReach !== HIDE_BEYOND || g.leash !== LEASH ? { spread: Number(g.spread.toFixed(2)), drawReach: n0(g.drawReach), leash: n0(g.leash) } : {}), members: g.members.map(member) })),
    };
  }

  /**
   * Forget everything and refuse the spawns still being built (they dispose what they made). Does NOT
   * dispose vehicles: World.unload disposes every vehicle in its list, and a second dispose would remove
   * a body twice.
   */
  dispose(): void {
    this.disposed = true;
    this.epoch++;
    this.ships.length = 0;
    this.groups.length = 0;
    this.anchors = [];
    this.version++;
  }
}
