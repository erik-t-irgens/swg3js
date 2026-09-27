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

import type { Port } from './shuttle.ts';
import { rigTimes, TRAVEL_TUNE, type ShuttleTimes, type TravelRig, type TravelThing } from './travelTerminal.ts';

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
 * flown with, where it leaves from and where it goes, whether the flight between worlds is skipped and
 * why it had to be (null when it was chosen, or not skipped), and its legs.
 */
export interface RideRoute {
  ticket: string;
  trip: TripKind;
  rig: string;
  mood: string;
  from: PadRef;
  to: { pack: string; port: string; pad: PadRef | null };
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
