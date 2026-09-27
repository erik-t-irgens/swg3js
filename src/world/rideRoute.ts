// A shuttle trip as data: where it leaves from, where it goes, and the legs it is flown in.
//
// A trip is a list of legs, each one plain JSON naming what happens (boarding at the pad, the take-off
// on its clip, a flight, a crossing, the landing, stepping off, the empty hull going on its way) and on
// which world and at which pad, so the runner that flies it (`shuttleRide.ts`) walks a list rather
// than a fixed story, and a later trip with more in it -- a stop on the way, a quest's errand -- is a
// longer list and not a new runner. A pad is named as the shuttle rigs name it (`travel:<pack>:<i>`)
// with the clock its round runs under, which is the port's name as `main.ts` has always given it, and
// the one rule for which port a thing belongs to lives here so the terminal, the collector and the
// shuttle can never disagree about it.
//
// Pure: no three, no fetch, no DOM. Node runs it (`rideRoute.test.ts`): relative value imports carry
// their extension, and there are no constructor parameter properties.

import { portsOf, type Port, type PoiRow } from './shuttle.ts';
import { rigTimes, travelPackReadable, travelThingsOf, tripOf, TRAVEL_TUNE, type ShuttleTimes, type Ticket, type TravelRig, type TravelRow, type TravelThing } from './travelTerminal.ts';

/** What one leg of a trip is. */
export type LegKind = 'board' | 'lift' | 'fly' | 'climb' | 'up' | 'jump' | 'down' | 'skip' | 'land' | 'off' | 'walkOff' | 'leave';

/** A trip about one world, one that skips the flight between worlds, or one that flies it. */
export type TripKind = 'local' | 'skip' | 'space';

/**
 * A pad a shuttle stands on, as everything about a trip needs it: the pack it is in, its key among the
 * stood shuttles and its index in the pack's rows, the port it belongs to (empty for none) and the name
 * its round runs under, how long its rig takes to land and lift off, where it stands in the world's own
 * frame and in which room of which building, the rig and branch it is drawn with (null for a pad with
 * no rig), and its collector's place, if the building has one.
 */
export interface PadRef {
  pack: string;
  key: string;
  index: number;
  port: string;
  clock: string;
  times: ShuttleTimes;
  x: number;
  y: number;
  z: number;
  yaw: number;
  cell: number;
  building: string;
  rig: string | null;
  mood: string;
  collector: { x: number; y: number; z: number } | null;
}

/** What a flown leg flies toward. */
export type Aim =
  | { to: 'join'; pack: string; port: string }
  | { to: 'height'; over: number }
  | { to: 'zonePlace'; zone: string; world: string }
  | { to: 'disc'; zone: string; world: string; seconds: number }
  | { to: 'port'; pack: string; port: string };

/** One leg: what it is, on which world (a pack, or a space zone), and the pad, aim or port it is about. `tag` is for whoever hangs something on it. */
export interface RideLeg {
  kind: LegKind;
  world: string;
  zone?: string;
  pad?: PadRef;
  aim?: Aim;
  port?: string;
  tag?: string;
}

/**
 * A whole trip: the ticket it is flown on (empty for none), what kind of trip, the rig and branch it is
 * flown with, where it leaves from and where it goes (the port's own place in its world's frame where
 * the ticket says it, which is where somebody saved mid-trip is put down), whether the flight between
 * worlds is skipped and why it had to be (null when it was chosen, or not skipped), and its legs.
 */
export interface RideRoute {
  ticket: string;
  trip: TripKind;
  rig: string;
  mood: string;
  from: PadRef;
  to: { pack: string; port: string; pad: PadRef | null; at?: { x: number; z: number } | null };
  skipSpace: boolean;
  forced: string | null;
  legs: RideLeg[];
}

/** Metres from a building to the port it belongs to, at most: past it a thing belongs to no port. */
export const PORT_REACH = 200;

/**
 * Which port a travel thing belongs to: the one nearest the building it stands in, within `reach`. A
 * terminal, a collector and a shuttle of one building come to the same port, which is what ties a
 * ticket bought inside to the shuttle outside. Of two ports equally near, the first listed.
 */
export function portOfThing(ports: readonly Port[], thing: { bx: number; bz: number }, reach = PORT_REACH): Port | null {
  let best: Port | null = null;
  let bestD = Infinity;
  for (const p of ports) {
    const d = Math.hypot(p.x - thing.bx, p.z - thing.bz);
    if (d >= bestD) continue;
    bestD = d;
    best = p;
  }
  return bestD <= reach ? best : null;
}

/**
 * The name a port's shuttle keeps its round under: the pack and the port's name, where the world knows
 * one, and the building's place otherwise. The collector and the shuttle it serves belong to one
 * building, so they come to the same name, and the words at the collector and what is drawn on the pad
 * are one round.
 */
export function shuttleClockName(pack: string, thing: { bx: number; bz: number }, ports: readonly Port[]): string {
  const port = portOfThing(ports, thing);
  return `${pack}|${port?.name ?? `${Math.round(thing.bx)},${Math.round(thing.bz)}`}`;
}

/**
 * The pad a shuttle row stands on, as a trip names it: the key the shuttle rigs stand it under, the port
 * and the clock its round runs under, its rig's landing and lift-off (the old glide for a pad with no
 * rig), and the collector of its own building among `things`, if there is one.
 */
export function padRefOf(pack: string, index: number, thing: TravelThing, ports: readonly Port[], rigs: Readonly<Record<string, TravelRig>>, things: readonly TravelThing[] = []): PadRef {
  const rig = thing.rig && rigs[thing.rig] ? thing.rig : null;
  const collector = things.find((t) => t.kind === 'collector' && t.bx === thing.bx && t.bz === thing.bz) ?? null;
  return {
    pack,
    key: `travel:${pack}:${index}`,
    index,
    port: portOfThing(ports, thing)?.name ?? '',
    clock: shuttleClockName(pack, thing, ports),
    times: (rig ? rigTimes(rigs[rig], thing.mood) : null) ?? { land: TRAVEL_TUNE.glide, lift: TRAVEL_TUNE.glide },
    x: thing.x,
    y: thing.y,
    z: thing.z,
    yaw: thing.yaw,
    cell: thing.cell,
    building: thing.building,
    rig,
    mood: thing.mood,
    collector: collector ? { x: collector.x, y: collector.y, z: collector.z } : null,
  };
}

/**
 * A hop from one pad to another on the same world with nothing flown between: boarded at the first,
 * its take-off played to the cut, then put straight onto the second's landing at its join, landed,
 * parked and left empty to go on its way. What the console flies to try a hull's clips end to end;
 * a trip somebody rides flies the middle instead.
 */
export function planHop(from: PadRef, to: PadRef): RideRoute {
  const here = from.pack;
  const there = to.pack;
  return {
    ticket: '',
    trip: 'local',
    rig: from.rig ?? '',
    mood: from.mood,
    from,
    to: { pack: there, port: to.port, pad: to },
    skipSpace: false,
    forced: null,
    legs: [
      { kind: 'board', world: here, pad: from },
      { kind: 'lift', world: here, pad: from },
      { kind: 'skip', world: there, pad: to },
      { kind: 'land', world: there, pad: to },
      { kind: 'off', world: there, pad: to },
      { kind: 'leave', world: there, pad: to },
    ],
  };
}

/**
 * The pad a ticket's port is flown to: the rigged shuttle row nearest that port's own place, within the
 * reach a thing belongs to a port by. Null for a port this world does not name, or one with no shuttle
 * standing on a rig by it (six of the retail ports: a trip there is flown as far as the take-off and
 * the passenger put down at the port, as a ticket always was).
 */
export function padOfPort(things: readonly TravelThing[], ports: readonly Port[], port: string, pack: string, rigs: Readonly<Record<string, TravelRig>>, reach = PORT_REACH): PadRef | null {
  const p = ports.find((x) => x.name === port);
  if (!p) return null;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < things.length; i++) {
    const t = things[i];
    if (t.kind !== 'shuttle' || !t.rig || !rigs[t.rig]) continue;
    const d = Math.hypot(p.x - t.bx, p.z - t.bz);
    if (d >= bestD) continue;
    bestD = d;
    best = i;
  }
  return best >= 0 && bestD <= reach ? padRefOf(pack, best, things[best], ports, rigs, things) : null;
}

/** Another world's travel things, its ports and its rigs, as a trip reads them before that world has loaded. */
export interface FarPads {
  things: TravelThing[];
  ports: Port[];
  rigs: Record<string, TravelRig>;
}

/**
 * Another world's shuttle pads out of its own two files as they were fetched (`travel.json` and
 * `pois.json`, untouched): its travel rows with their rigs, and its places, both measured from the
 * places' own centre (which the map's list of places throws away), so that its pads, their keys and the
 * names their rounds run under are exactly what that world stands once it has loaded about its layout's
 * centre -- the two centres are one on every pack, and `rideRoute.test.ts` holds this very function to
 * what the world stands over every converted pack. Null for a travel pack this build cannot read, rows
 * that are not a list, or places with no centre, as the world's own read of its travel pack refuses them.
 */
export function farPadsOf(travel: unknown, pois: unknown): FarPads | null {
  if (!travel || typeof travel !== 'object' || !pois || typeof pois !== 'object') return null;
  const t = travel as { version?: unknown; rows?: unknown; rigs?: unknown };
  const p = pois as { center?: { x?: unknown; z?: unknown } | null; pois?: unknown };
  if (!Array.isArray(t.rows) || !travelPackReadable(t.version)) return null;
  const c = p.center;
  if (!c || typeof c !== 'object' || typeof c.x !== 'number' || typeof c.z !== 'number' || !Number.isFinite(c.x) || !Number.isFinite(c.z)) return null;
  const centre = { x: c.x, z: c.z };
  return {
    things: travelThingsOf(t.rows as TravelRow[], centre),
    ports: portsOf(Array.isArray(p.pois) ? (p.pois as PoiRow[]) : [], centre),
    rigs: t.rigs && typeof t.rigs === 'object' ? (t.rigs as Record<string, TravelRig>) : {},
  };
}

/**
 * The branch a hull flown from a pad lands with, wherever it lands: the calm one, where its rig has one,
 * and otherwise the one it took off on (the shuttle's only branch). No trip ends in Theed's hangar, since
 * no port stands near it, so a transport out of Theed comes down as every other transport does.
 */
export function landMood(rig: Pick<TravelRig, 'moods'> | null | undefined, from: { mood: string }): string {
  return rig?.moods?.calm ? 'calm' : from.mood;
}

/**
 * A ticket's trip, as legs. A ticket about this world with a rigged pad at the far end is boarded,
 * lifted off on its clip, flown by the shuttle's own pilot to the landing's join, landed, stepped off
 * and left empty to go on its way; with no pad there it is flown as far as the take-off's cut and the
 * passenger put down at the port. A ticket to another world that skips the flight through space
 * (`tripOf`) is boarded and lifted off the same way, and at the cut carried across to the far world
 * under the loading screen, onto its landing's join over the far pad, then landed, stepped off and left
 * there; with no rigged pad on the far world it is flown to the cut and the passenger put down at the
 * port over there, as a ticket to another world always was. `forced` is why the flight through space
 * was skipped whether or not the player wanted it (the terminal's locked box), and is carried on the
 * trip. Null where no trip can be flown -- a pad with no rig to fly, or a ticket that flies through
 * space, which is not flown yet -- and the caller does what a ticket always did.
 */
export function planRoute(ticket: Ticket, from: PadRef, to: PadRef | null, here: string, forced: string | null = null): RideRoute | null {
  if (!from.rig || ticket.from !== here) return null;
  const trip = tripOf(ticket);
  if (trip === 'space') return null;
  const there = ticket.pack;
  const pad = to && to.rig ? to : null;
  const legs: RideLeg[] = [
    { kind: 'board', world: here, pad: from },
    { kind: 'lift', world: here, pad: from },
  ];
  if (pad) {
    legs.push(
      trip === 'local' ? { kind: 'fly', world: there, pad, aim: { to: 'join', pack: there, port: ticket.to } } : { kind: 'skip', world: there, pad },
      { kind: 'land', world: there, pad },
      { kind: 'off', world: there, pad },
      { kind: 'leave', world: there, pad },
    );
  } else legs.push({ kind: 'walkOff', world: there, port: ticket.to, aim: { to: 'port', pack: there, port: ticket.to } });
  return {
    ticket: ticket.id,
    trip,
    rig: from.rig,
    mood: from.mood,
    from,
    to: { pack: there, port: ticket.to, pad, at: ticket.at ? { x: ticket.at.x, z: ticket.at.z } : null },
    skipSpace: trip === 'skip',
    forced: trip === 'skip' ? forced : null,
    legs,
  };
}

/**
 * What a trip between worlds needs to know of the galaxy, handed in so that this file stays pure: the
 * planet a pack is a world of (with the zone, for a pack that is a space zone itself), the orbit a
 * planet is reached through -- its own, or its system's where it has none of its own, as Talus and Rori
 * are reached through their neighbour's -- or null where there is none, and the galaxy's own words for
 * why a world has none. `routeFactsOf` in `galaxy.ts` answers all three from the game's own tables.
 */
export interface RouteFacts {
  worldOf(pack: string): { planet: string; zone?: string } | null;
  orbitOf(planet: string): string | null;
  noOrbit(planet: string): string;
}

/**
 * What a trip from one pack to another flies between them: a jump, between two systems; a flight, within
 * one (Corellia to Talus); or none, for a trip about one world, for a pack this build has no world for,
 * and for an end with no orbit at all (Mustafar), with why in words.
 */
export function spaceLegOf(from: string, to: string, facts: RouteFacts): { kind: 'jump' | 'fly' | 'none'; why: string } {
  if (from === to) return { kind: 'none', why: '' };
  const a = facts.worldOf(from);
  const b = facts.worldOf(to);
  if (!a || !b) return { kind: 'none', why: `this build has no world for ${a ? to : from}` };
  const oa = a.zone ?? facts.orbitOf(a.planet);
  const ob = b.zone ?? facts.orbitOf(b.planet);
  if (!oa) return { kind: 'none', why: facts.noOrbit(a.planet) || `there is no orbit over ${a.planet} to fly out of` };
  if (!ob) return { kind: 'none', why: facts.noOrbit(b.planet) || `there is no orbit over ${b.planet} to fly into` };
  return { kind: oa === ob ? 'fly' : 'jump', why: '' };
}

/** What the box says while no flight through space is flown at all. */
export const SPACE_LATER = 'the flight through space comes later: for now the shuttle skips it, under a loading screen';

/** The terminal's "skip the flight through space" box: whether it is there, ticked, and free to change, and why not. */
export interface SkipOffer {
  show: boolean;
  checked: boolean;
  locked: boolean;
  why: string;
}

/**
 * The box for a ticket from one pack to another. Not there for a ticket about one world. Ticked and
 * locked, with the reason in words, where no flight through space can be flown -- an end with no orbit,
 * in the galaxy's own words -- and where this build flies none yet (`built` false). Otherwise free and
 * unticked: the whole trip is the one on offer, the box is the way out of it, and whoever draws it keeps
 * the player's own choice.
 */
export function skipOffer(fromPack: string, toPack: string, facts: RouteFacts, built: boolean): SkipOffer {
  if (fromPack === toPack) return { show: false, checked: false, locked: false, why: '' };
  const leg = spaceLegOf(fromPack, toPack, facts);
  if (leg.kind === 'none') return { show: true, checked: true, locked: true, why: leg.why };
  if (!built) return { show: true, checked: true, locked: true, why: SPACE_LATER };
  return { show: true, checked: false, locked: false, why: '' };
}
