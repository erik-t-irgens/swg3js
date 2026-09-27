// A shuttle trip as data (src/world/rideRoute.ts): the pads a trip names, the one rule for which port a
// travel thing belongs to, the hop the console flies, a ticket's trip about one world, and the pad each
// of the game's ports is flown to.
//
// The port rule used to live in main.ts twice over (the terminal's port and the name a shuttle's round
// runs under); it lives here now, so the names every shuttle's round has always run under are checked
// against a transcription of the old code over every converted world's own travel rows and places: a
// round that changed its name would have every shuttle land at another moment than the one it did.
//
// A trip through space as legs, over the game's own routes (22 jumps, 4 flights within a system, 4 to or
// from a world with no orbit); a trip given up for a skip from any leg; where the crossing down comes out
// and the glide it leaves onto each of the game's own landings; where Talus and Rori are reached in their
// neighbour's orbits; each orbit's disc where the sky draws it; nothing standing in the way out of any
// world's crossing up or across any system; the numbers read out of the files node cannot load that the
// ride's own must stay inside; and about how long a trip through space flies.
//
// Run: node tools/swg/tests/rideRoute.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { loadGlb, packRigs } from './rigFixtures.ts';
import { GALAXY_SYSTEMS, destinationFor, routeFactsOf, systemOf } from '../../../src/data/galaxy.ts';
import { PLANETS } from '../../../src/data/planets.ts';
import { JUMP_COUNTDOWN, enterSpeed, sceneOf, toGame, transitAt } from '../../../src/space/hyperspaceMath.ts';
import { HyperspaceCatalogue, arrivalAt, destinationsOf, landmarksOf, type Destination, type SpacePack } from '../../../src/space/spaceData.ts';
import { RigHull, assembleRigModel, hullJointOf, landingMood } from '../../../src/vehicles/rigHull.ts';
import { PORT_REACH, SPACE_LATER, discDirection, downArrival, farPadsOf, landMood, padOfPort, padRefOf, planHop, planRoute, portOfThing, replanSkip, shuttleClockName, skipOffer, spaceLegOf, tripSeconds, zonePlace, type PadRef, type RideRoute, type SpacePlan } from '../../../src/world/rideRoute.ts';
import { landingTarget, makeLandingTarget } from '../../../src/world/rigPath.ts';
import { RIDE_PILOT } from '../../../src/world/shuttleCourse.ts';
import { RIDE_TUNE, downGlideOf } from '../../../src/world/shuttleRide.ts';
import { portsOf, type Port, type PoiRow } from '../../../src/world/shuttle.ts';
import { TRAVEL_TUNE, rigTimes, travelThingsOf, type Ticket, type TravelRig, type TravelRow, type TravelThing } from '../../../src/world/travelTerminal.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

const thing = (over: Partial<TravelThing> = {}): TravelThing => ({ kind: 'shuttle', model: null, rig: 'transport', mood: 'calm', x: 0, y: 12, z: 0, yaw: 0.5, cell: 0, building: 'b', bx: 0, bz: 0, ...over });
const rig: TravelRig = { file: 'travel/rig.glb', parts: [], moods: { calm: { land: 'land', lift: 'take_off' } }, seconds: { land: 26.6, take_off: 19.9 } };

// ---------------------------------------------------------------- which port

{
  const ports: Port[] = [
    { name: 'Near', x: 100, z: 0, kind: 'starport' },
    { name: 'Far', x: 150, z: 0, kind: 'shuttleport' },
    { name: 'Tie', x: -100, z: 0, kind: 'shuttleport' },
  ];
  ok(portOfThing(ports, { bx: 90, bz: 0 })?.name === 'Near', 'a thing belongs to the port nearest its building');
  ok(portOfThing(ports, { bx: 0, bz: 0 })?.name === 'Near', 'and of two equally near, to the first named');
  ok(portOfThing(ports, { bx: 400, bz: 0 }) === null && portOfThing(ports, { bx: 350, bz: 0 })?.name === 'Far', `and to none past ${PORT_REACH} m`);
  ok(shuttleClockName('tatooine', { bx: 90, bz: 0 }, ports) === 'tatooine|Near' && shuttleClockName('tatooine', { bx: 1234.4, bz: -99.6 }, ports) === 'tatooine|1234,-100', "a shuttle's round runs under its port's name, or its building's place with none");
}

// ---------------------------------------------------------------- a pad

{
  const ports: Port[] = [{ name: 'Mos Eisley Starport', x: 10, z: 5, kind: 'starport' }];
  const shuttle = thing({ x: 30, z: 40, bx: 12, bz: 6, cell: 0 });
  const collector = thing({ kind: 'collector', rig: null, x: 20, y: 11, z: 25, bx: 12, bz: 6 });
  const elsewhere = thing({ kind: 'collector', rig: null, x: 999, bx: 500, bz: 500 });
  const pad = padRefOf('tatooine', 7, shuttle, ports, { transport: rig }, [elsewhere, collector, shuttle]);
  ok(pad.key === 'travel:tatooine:7' && pad.index === 7 && pad.pack === 'tatooine', 'a pad is keyed as the drawn shuttles stand it');
  ok(pad.port === 'Mos Eisley Starport' && pad.clock === 'tatooine|Mos Eisley Starport', 'with its port and the name its round runs under');
  ok(pad.times.land === 26.6 && pad.times.lift === 19.9 && pad.rig === 'transport' && pad.mood === 'calm', "with its rig's own landing and lift-off, its rig and its branch");
  ok(pad.x === 30 && pad.y === 12 && pad.z === 40 && pad.yaw === 0.5, 'where it stands');
  ok(!!pad.collector && pad.collector.x === 20 && pad.collector.z === 25, "and its own building's collector, not another's");
  const bare = padRefOf('tatooine', 2, thing({ rig: 'nothing we have' }), ports, { transport: rig });
  ok(bare.rig === null && bare.times.land === TRAVEL_TUNE.glide && bare.times.lift === TRAVEL_TUNE.glide && bare.collector === null, 'a pad whose rig the pack does not carry has none, and the old glide');
  ok(JSON.stringify(structuredClone(pad)) === JSON.stringify(pad), 'and a pad is plain data');
}

// ---------------------------------------------------------------- the hop

{
  const ports: Port[] = [];
  const from = padRefOf('naboo', 3, thing({ x: 100 }), ports, { transport: rig });
  const to = padRefOf('naboo', 9, thing({ x: -4000, mood: 'calm' }), ports, { transport: rig });
  const route = planHop(from, to);
  ok(route.legs.map((l) => l.kind).join(',') === 'board,lift,skip,land,off,leave', `a hop is boarded, lifted off, skipped to the landing, landed, parked and left (${route.legs.map((l) => l.kind).join(', ')})`);
  ok(route.legs.slice(0, 2).every((l) => l.pad === from && l.world === 'naboo') && route.legs.slice(2).every((l) => l.pad === to && l.world === 'naboo'), 'its first two legs are at the pad it leaves and the rest at the one it lands on');
  ok(route.trip === 'local' && route.rig === 'transport' && route.mood === 'calm' && route.from === from && route.to.pad === to && route.to.pack === 'naboo' && !route.skipSpace && route.forced === null && route.ticket === '', 'on no ticket, about one world, flown with the rig and branch of the pad it leaves');
  const same = planHop(from, from);
  ok(same.legs.every((l) => l.pad === from), 'and a hop can come back to the pad it left');
  ok(JSON.stringify(structuredClone(route)) === JSON.stringify(route), 'a route is plain data');
}

// ---------------------------------------------------------------- a ticket's trip

{
  const ports: Port[] = [
    { name: 'Keren Starport', x: 100, z: 0, kind: 'starport' },
    { name: 'Keren Shuttleport', x: -3000, z: 900, kind: 'shuttleport' },
    { name: 'Nowhere Shuttleport', x: 9000, z: 9000, kind: 'shuttleport' },
  ];
  const things: TravelThing[] = [
    thing({ kind: 'collector', rig: null, bx: 110, bz: 5, x: 120, z: 30 }),
    thing({ bx: 110, bz: 5, x: 130, z: 40 }),
    thing({ rig: 'shuttle', mood: '', bx: -2950, bz: 880, x: -2940, z: 870 }),
    thing({ rig: null, bx: 9000, bz: 9010, x: 9005, z: 9020 }),
  ];
  const rigs: Record<string, TravelRig> = { transport: rig, shuttle: { ...rig, moods: { '': { land: 'land', lift: 'take_off' } } } };
  const from = padRefOf('naboo', 1, things[1], ports, rigs, things);
  const to = padOfPort(things, ports, 'Keren Shuttleport', 'naboo', rigs);
  ok(!!to && to.index === 2 && to.rig === 'shuttle' && to.port === 'Keren Shuttleport', "a port's pad is the rigged shuttle nearest it");
  ok(padOfPort(things, ports, 'Nowhere Shuttleport', 'naboo', rigs) === null, 'a port whose only shuttle has no rig has no pad to fly to');
  ok(padOfPort(things, ports, 'Nowhere Starport', 'naboo', rigs) === null, 'nor has a port this world does not name');
  const ticket: Ticket = { id: 't3', from: 'naboo', pack: 'naboo', to: 'Keren Shuttleport', at: { x: -3000, z: 900 }, price: 20, bought: 1 };
  const route = planRoute(ticket, from, to, 'naboo')!;
  ok(route.legs.map((l) => l.kind).join(',') === 'board,lift,fly,land,off,leave', `a ticket to a rigged pad on this world is boarded, lifted off, flown, landed, stepped off and left (${route.legs.map((l) => l.kind).join(', ')})`);
  ok(route.legs.slice(0, 2).every((l) => l.pad === from) && route.legs.slice(2).every((l) => l.pad === to) && route.legs[2].aim?.to === 'join', 'its first two legs are at the pad it leaves, the rest at the far pad, and it is flown to the landing\'s join');
  ok(route.ticket === 't3' && route.trip === 'local' && route.rig === 'transport' && route.mood === 'calm' && route.to.port === 'Keren Shuttleport' && route.to.at?.x === -3000, 'on its ticket, about one world, flown with the rig it leaves on, and knowing where the port is');
  const walk = planRoute({ ...ticket, to: 'Nowhere Shuttleport', at: { x: 9000, z: 9000 } }, from, null, 'naboo')!;
  ok(walk.legs.map((l) => l.kind).join(',') === 'board,lift,walkOff' && walk.legs[2].port === 'Nowhere Shuttleport' && walk.to.pad === null, `with no pad to land on, it is lifted off and the passenger set down at the port (${walk.legs.map((l) => l.kind).join(', ')})`);
  ok(planRoute(ticket, padRefOf('naboo', 3, things[3], ports, rigs, things), to, 'naboo') === null, 'a pad with no rig to fly flies nothing, and the ticket does what it always did');
  ok(planRoute({ ...ticket, pack: 'tatooine', trip: 'space', skipSpace: false }, from, to, 'naboo') === null, 'nor is a ticket to another world through space flown yet');
  const says = planRoute({ ...ticket, trip: 'skip', skipSpace: true }, from, to, 'naboo');
  ok(says?.trip === 'local' && says.legs[2].kind === 'fly', 'a ticket about this world is flown about it, whatever it says of space');
  ok(JSON.stringify(structuredClone(route)) === JSON.stringify(route), 'and a trip is plain data');
  ok(landMood(rig, from) === 'calm' && landMood(rigs.shuttle, to!) === '' && landMood({ moods: { theed: rig.moods.calm, calm: rig.moods.calm } }, { mood: 'theed' }) === 'calm', 'a hull lands with its calm branch where its rig has one, and its own otherwise');
  ok(landingMood(rigs.shuttle.moods, '') === landMood(rigs.shuttle, { mood: '' }) && landingMood(rig.moods, 'calm') === landMood(rig, { mood: 'calm' }), "and the hull's own rule is that same one");
}

// ---------------------------------------------------------------- a ticket to another world

{
  // Boarded and lifted off here; from the cut on, every leg is on the far world at the far pad, and the
  // flight between is a skip: carried across under the loading screen onto the landing's join.
  const ports: Port[] = [{ name: 'Theed Spaceport', x: 100, z: 0, kind: 'starport' }];
  const here = padRefOf('naboo', 1, thing({ bx: 100, bz: 0, x: 120, z: 20 }), ports, { transport: rig });
  const farPorts: Port[] = [
    { name: 'Mos Eisley Starport', x: -500, z: 300, kind: 'starport' },
    { name: 'Bare Shuttleport', x: 4000, z: 0, kind: 'shuttleport' },
  ];
  const farThings: TravelThing[] = [thing({ bx: -500, bz: 300, x: -480, z: 320 }), thing({ kind: 'collector', rig: null, bx: -500, bz: 300, x: -470, z: 330 })];
  const far = padOfPort(farThings, farPorts, 'Mos Eisley Starport', 'tatooine', { transport: rig })!;
  const ticket: Ticket = { id: 'w1', from: 'naboo', pack: 'tatooine', to: 'Mos Eisley Starport', at: { x: -500, z: 300 }, price: 1250, bought: 1, trip: 'skip', skipSpace: true };
  const route = planRoute(ticket, here, far, 'naboo', SPACE_LATER)!;
  const kinds = route.legs.map((l) => l.kind).join(',');
  ok(kinds === 'board,lift,skip,land,off,leave', `a ticket to another world is boarded, lifted off, skipped across to the far pad's landing, landed, stepped off and left (${kinds})`);
  ok(route.legs.slice(0, 2).every((l) => l.world === 'naboo' && l.pad === here) && route.legs.slice(2).every((l) => l.world === 'tatooine' && l.pad === far), 'its first two legs are on this world at the pad it leaves, and every one after the cut on the far world at the far pad');
  ok(route.trip === 'skip' && route.skipSpace && route.forced === SPACE_LATER && route.to.pack === 'tatooine' && route.to.pad === far && route.to.at?.x === -500 && route.ticket === 'w1', 'a skip, on its ticket, carrying why it had to be skipped and where the far port is');
  ok(!!far.collector && far.key === 'travel:tatooine:0' && far.clock === 'tatooine|Mos Eisley Starport', "the far pad is keyed and clocked as the far world's own shuttles will stand it, with its collector");
  const bare = planRoute({ ...ticket, to: 'Bare Shuttleport', at: { x: 4000, z: 0 } }, here, null, 'naboo')!;
  const bareKinds = bare.legs.map((l) => l.kind).join(',');
  ok(bareKinds === 'board,lift,walkOff' && bare.legs[2].world === 'tatooine' && bare.legs[2].port === 'Bare Shuttleport' && bare.to.pad === null && bare.forced === null, `with no rigged pad on the far world, it is lifted off here and the passenger set down at the far port (${bareKinds})`);
  ok(planRoute({ ...ticket, trip: undefined, skipSpace: undefined }, here, far, 'naboo')?.trip === 'skip', 'a ticket to another world that says nothing of its trip skips the flight through space');
  ok(planRoute({ ...ticket, trip: 'space', skipSpace: false }, here, far, 'naboo') === null, 'one that flies through space with nothing to plan it by is not flown, and does what a ticket always did');
  ok(planRoute({ ...ticket, from: 'tatooine' }, here, far, 'naboo') === null, 'nor is a ticket from another world handed in here');
  ok(JSON.stringify(structuredClone(route)) === JSON.stringify(route), 'and a trip between worlds is plain data');
}

// ---------------------------------------------------------------- the box that skips the flight through space

{
  const facts = routeFactsOf();
  const leg = (a: string, b: string) => spaceLegOf(a, b, facts);
  ok(leg('naboo', 'tatooine').kind === 'jump' && leg('corellia', 'kashyyyk_main').kind === 'jump', 'between two systems the flight through space is a jump');
  ok(leg('corellia', 'talus').kind === 'fly' && leg('rori', 'naboo').kind === 'fly', 'within one it is flown: Talus and Rori are reached through their neighbour\'s orbit');
  const noOrbit = GALAXY_SYSTEMS.find((s) => s.id === 'mustafar')?.worlds[0].noOrbit ?? '';
  const must = leg('tatooine', 'mustafar');
  ok(must.kind === 'none' && must.why === noOrbit && noOrbit.length > 0 && leg('mustafar', 'naboo').why === noOrbit, `a trip to or from a world with no orbit has none, in the galaxy's own words (${must.why})`);
  ok(leg('naboo', 'naboo').kind === 'none' && leg('naboo', 'nowhere').kind === 'none', 'and none for a trip about one world, or to a world this build does not have');
  const later = skipOffer('naboo', 'tatooine', facts, false);
  ok(later.show && later.locked && later.checked && later.why === SPACE_LATER, `while no flight through space is flown, the box is ticked and locked, and says so (${later.why})`);
  const forced = skipOffer('tatooine', 'mustafar', facts, true);
  ok(forced.show && forced.locked && forced.checked && forced.why === noOrbit, 'where one cannot be flown at all, it is ticked and locked in the galaxy\'s own words');
  ok(skipOffer('tatooine', 'mustafar', facts, false).why === noOrbit, "and that reason is given over the build's own, which would not be true there even once the flight is flown");
  const free = skipOffer('naboo', 'tatooine', facts, true);
  ok(free.show && !free.locked && !free.checked && free.why === '', 'otherwise it is free and unticked: the whole trip is the one on offer');
  ok(!skipOffer('naboo', 'naboo', facts, true).show, 'and there is no box on a ticket about one world');
  ok(skipOffer('naboo', 'nowhere', facts, true).locked, 'nor a free one to a world this build does not have');
}

// ---------------------------------------------------------------- the old names, over the real packs

{
  /** main.ts's `portOfBuilding` and `shuttleKey` as they were written before the rule moved here. */
  const oldName = (here: string, t: TravelThing, ports: readonly Port[]): string => {
    let best: Port | null = null;
    let bestD = Infinity;
    for (const p of ports) {
      const d = Math.hypot(p.x - t.bx, p.z - t.bz);
      if (d >= bestD) continue;
      bestD = d;
      best = p;
    }
    const port = bestD <= 200 ? best : null;
    return `${here}|${port?.name ?? `${Math.round(t.bx)},${Math.round(t.bz)}`}`;
  };
  const packs = join(process.cwd(), 'assets-private');
  const worlds = existsSync(packs) ? readdirSync(packs).filter((w) => existsSync(join(packs, w, 'travel.json')) && existsSync(join(packs, w, 'pois.json'))) : [];
  if (!worlds.length) note('no converted world carries both a travel.json and a pois.json, so the old names are not checked over real packs: npm run swg -- travel @SWG assets-private --retail-only');
  let things = 0;
  let pads = 0;
  let named = 0;
  for (const world of worlds) {
    const travel = JSON.parse(readFileSync(join(packs, world, 'travel.json'), 'utf8')) as { rows?: TravelRow[]; rigs?: Record<string, TravelRig> };
    const pois = JSON.parse(readFileSync(join(packs, world, 'pois.json'), 'utf8')) as { center?: { x: number; z: number }; pois?: PoiRow[] };
    if (!pois.center || !Array.isArray(travel.rows)) continue;
    const ports = portsOf(pois.pois ?? [], pois.center);
    const all = travelThingsOf(travel.rows, pois.center);
    for (const [i, t] of all.entries()) {
      assert.equal(shuttleClockName(world, t, ports), oldName(world, t, ports), `${world}: thing ${i} runs its round under the name it always did`);
      things++;
      if (t.kind !== 'shuttle') continue;
      const pad: PadRef = padRefOf(world, i, t, ports, travel.rigs ?? {}, all);
      assert.equal(pad.key, `travel:${world}:${i}`);
      assert.equal(pad.clock, oldName(world, t, ports));
      const times = t.rig && travel.rigs?.[t.rig] ? rigTimes(travel.rigs[t.rig], t.mood) : null;
      if (times) assert.ok(pad.times.land === times.land && pad.times.lift === times.lift, `${world}: pad ${i} takes its rig's own times`);
      pads++;
      if (pad.port) named++;
    }
  }
  if (things) ok(true, `over ${worlds.length} converted worlds, every one of ${things} travel things runs its round under the name main.ts always gave it, and ${pads} shuttle pads (${named} with a port's name) are keyed as the drawn shuttles stand them`);
}

// ---------------------------------------------------------------- every port's pad, over the real packs

{
  // Six of the game's ports have no shuttle standing on a rig by them, and a ticket there is flown as far
  // as the take-off and set down at the port; every other port a ticket can name has a pad to land on.
  const packs = join(process.cwd(), 'assets-private');
  const worlds = existsSync(packs) ? readdirSync(packs).filter((w) => !w.startsWith('space_') && existsSync(join(packs, w, 'travel.json')) && existsSync(join(packs, w, 'pois.json'))) : [];
  const none: string[] = [];
  let answered = 0;
  let calm = 0;
  for (const world of worlds) {
    const travel = JSON.parse(readFileSync(join(packs, world, 'travel.json'), 'utf8')) as { rows?: TravelRow[]; rigs?: Record<string, TravelRig> };
    const pois = JSON.parse(readFileSync(join(packs, world, 'pois.json'), 'utf8')) as { center?: { x: number; z: number }; pois?: PoiRow[] };
    if (!pois.center || !Array.isArray(travel.rows)) continue;
    const rigs = travel.rigs ?? {};
    const all = travelThingsOf(travel.rows, pois.center);
    for (const p of portsOf(pois.pois ?? [], pois.center)) {
      const pad = padOfPort(all, portsOf(pois.pois ?? [], pois.center), p.name, world, rigs);
      if (!pad) {
        none.push(`${world}: ${p.name}`);
        continue;
      }
      assert.ok(pad.rig && rigs[pad.rig] && Math.hypot(p.x - all[pad.index].bx, p.z - all[pad.index].bz) <= PORT_REACH, `${world}: ${p.name}'s pad has a rig and stands by it`);
      answered++;
      if (landMood(rigs[pad.rig], pad) === 'calm') calm++;
    }
  }
  if (!answered) note('no converted world carries rigged shuttle pads, so the ports are not checked: npm run swg -- travel @SWG assets-private --retail-only');
  else {
    ok(none.length === 6, `six ports have no rigged shuttle to land on (${none.join('; ')})`);
    ok(answered > 40, `and every other one of ${answered + none.length} has its pad (${answered}, ${calm} of them flown to by a transport's calm landing)`);
  }
}

// ---------------------------------------------------------------- a far world's pads, read before it loads

{
  // What the game's `padsOf` makes of a far world's two files, as fetched: `farPadsOf`, read about the
  // places' own centre, and refused where the world's own read of its travel pack would refuse it.
  const rows: TravelRow[] = [{ kind: 'shuttle', model: null, rig: 'transport', mood: 'calm', building: 'b', x: 3, y: 12, z: 4, yaw: 0.5, cell: 0, bx: 100, by: 10, bz: 40, byaw: 0 }];
  const places: PoiRow[] = [
    { name: 'Far Starport', kind: 'starport', x: 110, z: 45 },
    { name: 'A City', kind: 'city', x: 0, z: 0 },
  ];
  const centre = { x: 100, z: 50 };
  const got = farPadsOf({ version: 1, rows, rigs: { transport: rig } }, { center: centre, pois: places });
  ok(
    !!got && JSON.stringify(got.things) === JSON.stringify(travelThingsOf(rows, centre)) && JSON.stringify(got.ports) === JSON.stringify(portsOf(places, centre)) && got.rigs.transport === rig,
    "another world's pads are its rows and its ports about the places' own centre, with its rigs",
  );
  const off = farPadsOf({ version: 1, rows, rigs: { transport: rig } }, { center: { x: 0, z: 0 }, pois: places });
  ok(!!off && JSON.stringify(off.things) !== JSON.stringify(got!.things) && JSON.stringify(off.ports) !== JSON.stringify(got!.ports), 'and a centre that is not the one the file gives moves them all');
  ok(farPadsOf({ version: 1, rows }, { center: centre })!.ports.length === 0 && Object.keys(farPadsOf({ version: 1, rows }, { center: centre })!.rigs).length === 0, 'a pack with no places listed or no rigs has no ports and no rigs, not no pads');
  const refused = [
    ['no travel file', null, { center: centre, pois: places }],
    ['no places file', { version: 1, rows }, null],
    ['rows that are not a list', { version: 1, rows: {} }, { center: centre, pois: places }],
    ['a travel pack of a later version', { version: 999, rows }, { center: centre, pois: places }],
    ['a travel pack with no version', { rows }, { center: centre, pois: places }],
    ['places with no centre', { version: 1, rows }, { pois: places }],
    ['a centre that is not a number', { version: 1, rows }, { center: { x: 'a', z: 1 }, pois: places }],
    ['a centre that is not finite', { version: 1, rows }, { center: { x: NaN, z: 1 }, pois: places }],
  ] as const;
  const read = refused.filter(([, t, p]) => farPadsOf(t, p) !== null).map(([why]) => why);
  ok(read.length === 0, `and nothing is read where a world's own read would refuse it (${read.length ? `read anyway: ${read.join(', ')}` : `${refused.length} of ${refused.length} refused`})`);
}

{
  // A ticket to another world is planned before that world has loaded, from its own packs: the game's
  // `padsOf` hands the two files as fetched to `farPadsOf`, which reads them about the places' own
  // centre. What a far pad is keyed, clocked and placed as must be exactly what that world stands once
  // it is there, which is its rows and its places about the layout's centre (`travelThings`,
  // `portsHere`); so the very function the game calls is held to that over every ground pack there is.
  const packs = join(process.cwd(), 'assets-private');
  const worlds = existsSync(packs) ? readdirSync(packs).filter((w) => existsSync(join(packs, w, 'pois.json')) && existsSync(join(packs, w, 'layout.json'))) : [];
  if (!worlds.length) note('no converted ground world carries both a pois.json and a layout.json, so the far pads are not checked over real packs');
  const centreOff: string[] = [];
  const unread: string[] = [];
  let pads = 0;
  let ports = 0;
  let travelled = 0;
  for (const world of worlds) {
    const poisJson = JSON.parse(readFileSync(join(packs, world, 'pois.json'), 'utf8')) as { center?: { x: number; z: number }; pois?: PoiRow[] };
    const layout = JSON.parse(readFileSync(join(packs, world, 'layout.json'), 'utf8')) as { center?: { x: number; z: number } };
    if (!poisJson.center || !layout.center || poisJson.center.x !== layout.center.x || poisJson.center.z !== layout.center.z) centreOff.push(`${world}: ${JSON.stringify(poisJson.center)} against ${JSON.stringify(layout.center)}`);
    if (!existsSync(join(packs, world, 'travel.json')) || !layout.center) continue;
    const travelJson = JSON.parse(readFileSync(join(packs, world, 'travel.json'), 'utf8')) as { version?: number; rows?: TravelRow[]; rigs?: Record<string, TravelRig> };
    if (!Array.isArray(travelJson.rows)) continue;
    travelled++;
    // What a trip reads of it before it goes: the game's own call, on the files as they are.
    const far = farPadsOf(travelJson, poisJson);
    if (!far) {
      unread.push(world);
      continue;
    }
    // What the far world stands once it has loaded: its rows about the layout's centre, its places likewise.
    const rigs = travelJson.rigs && typeof travelJson.rigs === 'object' ? travelJson.rigs : {};
    const stood = travelThingsOf(travelJson.rows, layout.center);
    const stoodPorts = portsOf(poisJson.pois ?? [], layout.center);
    assert.deepEqual(far.things, stood, `${world}: its travel things read before it loads are the ones it stands`);
    assert.deepEqual(far.ports, stoodPorts, `${world}: and its ports are the ones it names`);
    assert.deepEqual(Object.keys(far.rigs), Object.keys(rigs), `${world}: with the same rigs`);
    for (const p of far.ports) {
      ports++;
      const pad = padOfPort(far.things, far.ports, p.name, world, far.rigs);
      const there = padOfPort(stood, stoodPorts, p.name, world, rigs);
      assert.deepEqual(pad, there, `${world}: ${p.name}'s pad read before it loads is the pad it has once it has`);
      if (!pad) continue;
      const t = stood[pad.index];
      assert.equal(pad.key, `travel:${world}:${pad.index}`, `${world}: ${p.name}'s pad is keyed as its world stands it`);
      assert.equal(pad.clock, shuttleClockName(world, t, stoodPorts), `${world}: ${p.name}'s pad runs its round under the name its world gives it`);
      assert.ok(t.kind === 'shuttle' && t.x === pad.x && t.y === pad.y && t.z === pad.z && t.yaw === pad.yaw, `${world}: ${p.name}'s pad stands where its world stands its shuttle`);
      pads++;
    }
  }
  if (worlds.length) {
    ok(centreOff.length === 0, `the places' centre is the layout's on every ground pack there is (${worlds.length}${centreOff.length ? `; off: ${centreOff.join('; ')}` : ''})`);
    if (travelled) {
      ok(unread.length === 0, `the game reads every one of ${travelled} worlds' travel packs and places before going there (${unread.length ? `unread: ${unread.join(', ')}` : 'none unread'})`);
      ok(pads > 0, `and every one of ${pads} far pads (of ${ports} ports) it reads is keyed, clocked and placed as that world stands it, its things and ports the very ones the world stands about its layout's centre`);
    } else note('no converted ground world carries a travel.json, so the far pads are not checked');
  }
}

// ---------------------------------------------------------------- a trip through space

/** A number the game keeps in a file node cannot load, read out of the file itself. */
const constOf = (src: string, name: string): number => {
  const m = new RegExp(`const ${name} = (\\d+(?:\\.\\d+)?);`).exec(src);
  assert.ok(m, `${name} is read out of its file`);
  return Number(m![1]);
};
const mainSrc = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
const GATE = constOf(mainSrc, 'SPACE_GATE_HEIGHT');
const facts = routeFactsOf();
const SPACE: SpacePlan = { facts, gate: GATE, discSeconds: RIDE_TUNE.discSeconds };
/** A trip's legs in words: a flight named by what it flies to. */
const words = (r: RideRoute): string => r.legs.map((l) => (l.kind === 'fly' ? `fly(${l.aim?.to ?? '?'})` : l.kind)).join(',');
const CROSSINGS = new Set(['up', 'jump', 'down', 'skip']);
/** A pad on a world, rigged, for a trip that needs one at either end. */
const padOn = (pack: string, i = 1): PadRef => padRefOf(pack, i, thing({ bx: 100 * i, bz: 0, x: 100 * i + 20, z: 20 }), [{ name: `${pack} port`, x: 100 * i, z: 0, kind: 'starport' }], { transport: rig });
const spaceTicket = (from: string, to: string): Ticket => ({ id: `${from}>${to}`, from, pack: to, to: `${to} port`, at: { x: 100, z: 0 }, price: 0, bought: 0, trip: 'space', skipSpace: false });

{
  ok(facts.hasDisc('space_corellia', 'corellia') && !facts.hasDisc('space_corellia', 'talus') && !facts.hasDisc('space_naboo', 'rori') && !facts.hasDisc('space_light1', 'space_light1'), "a zone hangs a world's own disc only for the world it is the orbit of");
  const route = planRoute(spaceTicket('naboo', 'tatooine'), padOn('naboo'), padOn('tatooine'), 'naboo', null, SPACE)!;
  ok(words(route) === 'board,lift,climb,up,jump,fly(disc),down,fly(join),land,off,leave', `a ticket through space between two systems climbs out, crosses up, jumps, turns to the far world, crosses down and flies in to land (${words(route)})`);
  const at = (k: string) => route.legs.find((l) => l.kind === k)!;
  ok(at('climb').world === 'naboo' && at('climb').aim?.to === 'height' && (at('climb').aim as { over: number }).over === GATE, `it climbs over the world it left, to the game's own space gate (${GATE} m)`);
  ok(at('up').world === 'space_naboo' && at('up').aim?.to === 'zonePlace' && (at('up').aim as { world: string }).world === 'naboo', "up into the orbit of the world it left, where that world is in it");
  ok(at('jump').world === 'space_tatooine' && (at('jump').aim as { world: string; zone: string }).world === 'tatooine' && (at('jump').aim as { zone: string }).zone === 'space_tatooine', 'a jump to where the far world is reached in its own orbit');
  const disc = route.legs.find((l) => l.aim?.to === 'disc')!;
  ok(disc.world === 'space_tatooine' && (disc.aim as { seconds: number }).seconds === RIDE_TUNE.discSeconds, 'turning toward the far world in its sky for the ride\'s own seconds');
  ok(at('down').world === 'tatooine' && at('down').pad?.key === 'travel:tatooine:1' && route.legs.slice(-4).every((l) => l.world === 'tatooine' && l.pad?.key === 'travel:tatooine:1'), 'down onto the far world over its pad, and flown in, landed, stepped off and left there');
  ok(route.trip === 'space' && !route.skipSpace && route.forced === null && JSON.stringify(structuredClone(route)) === JSON.stringify(route), 'a trip through space, not skipped, and plain data');
  const across = planRoute(spaceTicket('corellia', 'talus'), padOn('corellia'), padOn('talus'), 'corellia', null, SPACE)!;
  ok(words(across) === 'board,lift,climb,up,fly(zonePlace),down,fly(join),land,off,leave' && (across.legs[3].aim as { world: string }).world === 'corellia' && (across.legs[4].aim as { world: string; zone: string }).world === 'talus' && across.legs[4].world === 'space_corellia', `within one system it flies across it, and Talus hangs no disc of its own (${words(across)})`);
  const back = planRoute(spaceTicket('talus', 'corellia'), padOn('talus'), padOn('corellia'), 'talus', null, SPACE)!;
  ok(words(back) === 'board,lift,climb,up,fly(zonePlace),fly(disc),down,fly(join),land,off,leave' && (back.legs[3].aim as { world: string }).world === 'talus' && back.legs[3].world === 'space_corellia', `out of Talus it comes up into its neighbour's orbit, flies across to Corellia and turns to its disc (${words(back)})`);
  const bare = planRoute(spaceTicket('corellia', 'kashyyyk_main'), padOn('corellia'), null, 'corellia', null, SPACE)!;
  ok(words(bare) === 'board,lift,climb,up,jump,fly(disc),walkOff' && bare.legs.at(-1)!.world === 'kashyyyk_main', `with no pad over there, the flight through space ends with the passenger set down at the port (${words(bare)})`);
  const noOrbit = GALAXY_SYSTEMS.find((s) => s.id === 'mustafar')!.worlds[0].noOrbit!;
  const must = planRoute(spaceTicket('tatooine', 'mustafar'), padOn('tatooine'), null, 'tatooine', null, SPACE)!;
  ok(words(must) === 'board,lift,walkOff' && must.trip === 'skip' && must.forced === noOrbit, `a world with no orbit is skipped to whatever the ticket says, in the galaxy's own words (${words(must)})`);
  ok(planRoute(spaceTicket('naboo', 'tatooine'), padOn('naboo'), padOn('tatooine'), 'naboo', null, null) === null, 'and a trip through space with nothing to plan it by is not flown');
}

{
  // Over the game's own routes: 22 jumps between systems, 4 flights within one, and 4 to or from
  // Mustafar, which has no orbit; every trip is boarded and lifted off and ends parked and left, or
  // with the passenger set down at the port; every crossing up comes after a climb, into a space zone
  // other than the one a jump goes to; nothing crosses anywhere where an end has no orbit, nor on a
  // ticket that skips the flight.
  const file = join(process.cwd(), 'assets-private', 'galaxy.json');
  if (!existsSync(file)) note('no galaxy.json converted, so the game\'s own routes are not planned: npm run swg -- maps @SWG assets-private --retail-only');
  else {
    const routes = (JSON.parse(readFileSync(file, 'utf8')) as { routes: { from: string; to: string }[] }).routes;
    const count = { jump: 0, fly: 0, none: 0 };
    let mustafar = 0;
    const packs = join(process.cwd(), 'assets-private');
    const hasPad = (pack: string): boolean => {
      const f = join(packs, pack, 'travel.json');
      if (!existsSync(f)) return false;
      const t = JSON.parse(readFileSync(f, 'utf8')) as { rows?: TravelRow[]; rigs?: Record<string, TravelRig> };
      return (t.rows ?? []).some((r) => r.kind === 'shuttle' && !!r.rig && !!t.rigs?.[r.rig]);
    };
    const bad: string[] = [];
    for (const r of routes) {
      const leg = spaceLegOf(r.from, r.to, facts);
      count[leg.kind]++;
      if (r.from === 'mustafar' || r.to === 'mustafar') mustafar++;
      const trip = planRoute(spaceTicket(r.from, r.to), padOn(r.from), hasPad(r.to) ? padOn(r.to) : null, r.from, null, SPACE);
      const skip = planRoute({ ...spaceTicket(r.from, r.to), trip: 'skip', skipSpace: true }, padOn(r.from), hasPad(r.to) ? padOn(r.to) : null, r.from, null, SPACE);
      if (!trip || !skip) {
        bad.push(`${r.from}>${r.to}: not planned`);
        continue;
      }
      const k = trip.legs.map((l) => l.kind);
      const end = k.slice(-2).join(',');
      if (k[0] !== 'board' || k[1] !== 'lift' || !(end === 'off,leave' || k.at(-1) === 'walkOff')) bad.push(`${r.from}>${r.to}: ${k.join(',')}`);
      const up = k.indexOf('up');
      if (up >= 0 && (k[up - 1] !== 'climb' || !trip.legs[up].world.startsWith('space_'))) bad.push(`${r.from}>${r.to}: the crossing up is ${trip.legs[up - 1]?.kind} then into ${trip.legs[up].world}`);
      const jump = trip.legs.find((l) => l.kind === 'jump');
      if (jump && jump.world === trip.legs[up].world) bad.push(`${r.from}>${r.to}: a jump within the zone it came up into`);
      if (leg.kind === 'none' && trip.legs.some((l) => CROSSINGS.has(l.kind) && l.kind !== 'skip')) bad.push(`${r.from}>${r.to}: crosses through space with no orbit`);
      if (skip.legs.some((l) => l.kind === 'up' || l.kind === 'jump' || l.kind === 'down' || l.kind === 'climb')) bad.push(`${r.from}>${r.to}: a skip that flies through space`);
      if ((leg.kind === 'jump') !== !!jump) bad.push(`${r.from}>${r.to}: a ${leg.kind} trip ${jump ? 'with' : 'without'} a jump`);
    }
    ok(count.jump === 22 && count.fly === 4 && count.none === 4 && mustafar === 4, `the game's ${routes.length} routes: ${count.jump} jump between systems, ${count.fly} fly within one, ${count.none} have no flight through space (${mustafar} touch Mustafar)`);
    ok(bad.length === 0, `every route is boarded and lifted off, ends parked or on foot at the port, climbs before it crosses up, and crosses nothing it cannot (${bad.join('; ') || `${routes.length} of ${routes.length}`})`);
  }
}

{
  // Given up for a skip from any leg: what was flown is kept, and from there it is one skip onto the far
  // pad's landing and nothing else crossed after it; a skip that fails is never tried again, and with no
  // pad there it is the port on foot.
  const route = planRoute(spaceTicket('naboo', 'tatooine'), padOn('naboo'), padOn('tatooine'), 'naboo', null, SPACE)!;
  const bad: string[] = [];
  for (let i = 0; i < route.legs.length; i++) {
    const r = replanSkip(route, i, 'test');
    const tail = r.legs.slice(i).map((l) => l.kind).join(',');
    if (JSON.stringify(r.legs.slice(0, i)) !== JSON.stringify(route.legs.slice(0, i))) bad.push(`${i}: the flown legs changed`);
    if (tail !== 'skip,land,off,leave') bad.push(`${i}: ${tail}`);
    if (r.trip !== 'skip' || !r.skipSpace || r.forced !== 'test') bad.push(`${i}: not marked a skip`);
    const again = replanSkip(r, i, 'again').legs.slice(i).map((l) => l.kind).join(',');
    if (again !== 'walkOff') bad.push(`${i}: a failed skip is ${again}`);
  }
  ok(bad.length === 0, `given up for a skip at any of ${route.legs.length} legs, the flown legs stay, one skip onto the pad follows and nothing is crossed after it, and a skip that failed becomes the port on foot (${bad.join('; ') || 'all'})`);
  const bare = planRoute(spaceTicket('corellia', 'kashyyyk_main'), padOn('corellia'), null, 'corellia', null, SPACE)!;
  ok(replanSkip(bare, 4, 'x').legs.slice(4).map((l) => l.kind).join(',') === 'walkOff', 'with no pad over there, given up means the port on foot');
  ok(route.legs.length === 11 && route.trip === 'space', 'and the trip it was made from is left as it was');
}

{
  // The crossing down comes out on the landing's own line, back along the way it comes in from its join,
  // exactly `reach` from the pad over the ground and on a straight glide of the ride's own down to the join,
  // facing along that glide -- so nothing is left to turn and nothing to dive. The join here stands 60 m off
  // the line through the pad along the way in, as a transport's does: measured from the pad instead, the
  // hull came out off the landing's line and had to fly a circle to get onto it.
  const pad: [number, number, number] = [100, 20, -30];
  const jn: { at: [number, number, number]; dirX: number; dirZ: number } = { at: [100 + 180 + 48, 147, -30 + 240 - 36], dirX: -0.6, dirZ: -0.8 };
  const G = RIDE_TUNE.downGlide;
  const a = downArrival(pad, jn, 1500, G);
  const out = Math.hypot(a.at[0] - pad[0], a.at[2] - pad[2]);
  const across = (a.at[0] - jn.at[0]) * -jn.dirZ - (a.at[2] - jn.at[2]) * -jn.dirX;
  const behind = (a.at[0] - jn.at[0]) * jn.dirX + (a.at[2] - jn.at[2]) * jn.dirZ;
  const run = Math.hypot(a.at[0] - jn.at[0], a.at[2] - jn.at[2]);
  const f = new THREE.Vector3(...a.forward);
  const toJoin = new THREE.Vector3(jn.at[0] - a.at[0], jn.at[1] - a.at[1], jn.at[2] - a.at[2]).normalize();
  const glide = THREE.MathUtils.radToDeg(Math.atan2(a.at[1] - jn.at[1], run));
  ok(Math.abs(out - 1500) < 1e-9 && Math.abs(across) < 1e-9 && behind < 0 && Math.abs(run - a.run) < 1e-9, `the crossing down comes out 1500 m from the pad, on the landing's own line ${a.run.toFixed(1)} m back from its join (${across.toExponential(1)} m off it)`);
  ok(Math.abs(glide - G) < 1e-9 && Math.abs(f.length() - 1) < 1e-9 && f.angleTo(toJoin) < 1e-9, `on a straight glide of ${G} degrees down to the join, facing along it (${glide.toFixed(3)}°)`);
  // And against the game's own landings, when they are converted: on each landing's own line, `downReach`
  // from its pad, behind the join and never beyond the pad, on a glide of `downGlide` that is never steeper
  // than the landing's own at its join -- which is what the pilot's height law holds it to all the way in.
  const packs = join(process.cwd(), 'assets-private');
  const rigs = packRigs(packs, readdirSync, existsSync, join);
  const glides: string[] = [];
  let worst = '';
  let branches = 0;
  for (const [name, r] of Object.entries(rigs)) {
    if (!existsSync(join(packs, r.file)) || !r.parts.every((p) => existsSync(join(packs, p.file)))) {
      note(`the ${name} rig is not converted whole, so its glides are not measured`);
      continue;
    }
    const skeleton = loadGlb(join(packs, r.file));
    const pieces = r.parts.map((p) => ({ joint: p.joint, model: loadGlb(join(packs, p.file)).scene as THREE.Object3D }));
    const hullJoint = hullJointOf(r);
    for (const [mood, clips] of Object.entries(r.moods)) {
      branches++;
      const assembled = assembleRigModel({ scene: skeleton.scene.clone(true), animations: skeleton.animations }, pieces.map((p) => ({ joint: p.joint, model: p.model.clone(true) })), hullJoint, clips);
      const hull = new RigHull(assembled, clips, { [mood]: clips });
      hull.frame();
      const paths = hull.paths(mood);
      if (!paths?.join) {
        // `rigPath.test.ts` holds every retail branch to a join; one without is said here, never passed over.
        note(`the ${name}/${mood} branch gives no join to glide down onto`);
        hull.dispose();
        continue;
      }
      const padRef = padOn('glide');
      const target = landingTarget(padRef, paths.land, paths.join, hull.offset, makeLandingTarget());
      // The way the landing travels at its join, read off the clip's own velocity rather than its heading.
      const g = downGlideOf(-target.climb);
      const d = downArrival([padRef.x, padRef.y, padRef.z], { at: [target.pos.x, target.pos.y, target.pos.z], dirX: target.vel.x, dirZ: target.vel.z }, RIDE_TUNE.downReach, g);
      const glide = THREE.MathUtils.radToDeg(Math.atan2(d.at[1] - target.pos.y, Math.hypot(d.at[0] - target.pos.x, d.at[2] - target.pos.z)));
      const own = THREE.MathUtils.radToDeg(-target.climb);
      glides.push(`${name}/${mood} ${glide.toFixed(1)}° onto its own ${own.toFixed(1)}°`);
      if (Math.abs(glide - RIDE_TUNE.downGlide) > 1e-6 || glide > Math.max(own, RIDE_PILOT.glideMin) + 1e-9) worst = `${name}/${mood} ${glide.toFixed(1)}°`;
      // On the landing's own line, `downReach` from the pad.
      const sp = Math.hypot(target.vel.x, target.vel.z);
      const off = ((d.at[0] - target.pos.x) * target.vel.z - (d.at[2] - target.pos.z) * target.vel.x) / sp;
      if (Math.abs(off) > 1e-6 || Math.abs(Math.hypot(d.at[0] - padRef.x, d.at[2] - padRef.z) - RIDE_TUNE.downReach) > 1e-6) worst = `${name}/${mood} off its line by ${off.toFixed(3)} m`;
      // Behind the join along the way it comes in, never beyond the pad.
      if ((d.at[0] - padRef.x) * target.vel.x + (d.at[2] - padRef.z) * target.vel.z >= 0 || (d.at[0] - target.pos.x) * target.vel.x + (d.at[2] - target.pos.z) * target.vel.z >= 0) worst = `${name}/${mood} comes out beyond the join or the pad`;
      hull.dispose();
    }
  }
  if (!glides.length) note('no converted rig to glide down onto, so the glide is not measured: npm run swg -- travel @SWG assets-private --retail-only');
  else ok(!worst && glides.length === branches, `the crossing down comes out on each landing's own line, ${RIDE_TUNE.downReach} m from its pad and behind its join, on a glide of ${RIDE_TUNE.downGlide}° no steeper than the landing's own (${glides.join(', ')}; ${glides.length} of ${branches} branches)${worst ? `: ${worst}` : ''}`);
}

{
  // Where the worlds are reached in their zones, from the game's own packs: Talus and Rori beside their
  // stations in their neighbour's orbit, a flight of 8370 and 6886 metres from its launch point, both short
  // of a jump; a world's own orbit reached at its launch point; and a world's own disc in its orbit's sky.
  const packs = join(process.cwd(), 'assets-private');
  const zones = PLANETS.filter((p) => p.space && existsSync(join(packs, p.id, 'space.json')));
  if (!zones.length) note('no space zone converted, so where the worlds are reached is not measured: npm run swg -- space @SWG all assets-private --retail-only');
  else {
    const packOf = (z: string): SpacePack => {
      const raw = JSON.parse(readFileSync(join(packs, z, 'space.json'), 'utf8')) as Partial<SpacePack>;
      return { ...raw, zone: z, stations: raw.stations ?? [], scenery: raw.scenery ?? [], planets: raw.planets ?? [] } as SpacePack;
    };
    const cat = new HyperspaceCatalogue(
      zones.map((z) => {
        const pack = packOf(z.id);
        const below = PLANETS.find((p) => p.id === z.space && !p.space)?.name ?? null;
        return { id: z.id, name: z.name, title: z.name, pack, destinations: destinationsOf(pack, below) };
      }),
    );
    for (const [world, zone, want] of [['talus', 'space_corellia', 8370], ['rori', 'space_naboo', 6886]] as const) {
      const pack = cat.pack(zone);
      if (!pack) {
        note(`${zone} is not converted, so where ${world} is reached in it is not measured: npm run swg -- space @SWG all assets-private --retail-only`);
        continue;
      }
      const dest = destinationFor(systemOf(world)!, PLANETS.find((p) => p.id === world)!, cat)!;
      const place = zonePlace(pack, dest, null);
      const launch = arrivalAt(pack)!;
      const d = Math.hypot(place.at[0] - launch[0], place.at[1] - launch[1], place.at[2] - launch[2]);
      ok(dest.kind === 'station' && Math.abs(d - want) <= 5 && d < RIDE_TUNE.jumpBeyond, `${world} is reached beside its station, ${d.toFixed(0)} m from ${zone}'s launch point (${want} ± 5), which is flown and not jumped`);
    }
    const own: string[] = [];
    const missing: string[] = [];
    for (const z of zones) {
      const below = PLANETS.find((p) => p.id === z.space && !p.space);
      if (!below) continue;
      const pack = cat.pack(z.id)!;
      const dest = destinationFor(systemOf(below.id)!, below, cat);
      const place = dest ? zonePlace(pack, dest, [0, 0, 1000]) : null;
      const launch = arrivalAt(pack);
      const disc = discDirection(pack, below.id);
      if (!place || !launch || Math.hypot(place.at[0] - launch[0], place.at[1] - launch[1], place.at[2] - launch[2]) > 1e-6 || !disc || Math.abs(Math.hypot(...disc) - 1) > 1e-9) missing.push(z.id);
      else own.push(below.id);
      // Asked to face a point a kilometre along +Z from a launch point at the origin, it faces +Z.
      if (place && launch && launch[0] === 0 && launch[1] === 0 && launch[2] === 0 && place.forward[2] < 1 - 1e-9) missing.push(`${z.id} does not face where it was asked to`);
    }
    ok(missing.length === 0 && own.length > 0, `every orbit reaches its own world at its launch point, and hangs that world's disc in its sky (${own.join(', ')}${missing.length ? `; not: ${missing.join(', ')}` : ''})`);
    const talusSky = cat.pack('space_corellia');
    if (talusSky) ok(discDirection(talusSky, 'talus') === null, "and Talus hangs no disc of its own in Corellia's sky");

    // The disc is turned toward where the sky draws it: `World` hangs each body along its pack direction
    // with X mirrored, and skips one shorter than a metre. Built that way here, never through the function
    // under test, and at least one orbit's disc must stand off the X = 0 plane or the mirror is not tried.
    const drawnOff: string[] = [];
    let mirrored = 0;
    for (const z of zones) {
      const below = PLANETS.find((p) => p.id === z.space && !p.space);
      if (!below) continue;
      const pack = cat.pack(z.id)!;
      const body = pack.planets.find((b) => b.appearance.replace(/^.*\//, '').replace(/\.[^.]*$/, '').toLowerCase() === `planet_${below.id}`);
      const got = discDirection(pack, below.id);
      if (!body || !got) continue;
      const drawn = new THREE.Vector3(-body.direction[0], body.direction[1], body.direction[2]);
      if (drawn.lengthSq() < 1) continue;
      drawn.normalize();
      if (Math.abs(drawn.x) > 1e-3) mirrored++;
      const err = drawn.distanceTo(new THREE.Vector3(...got));
      if (err > 1e-9) drawnOff.push(`${z.id} ${err.toExponential(1)}`);
    }
    ok(drawnOff.length === 0 && mirrored > 0, `every orbit's disc is turned toward where the sky draws that body, X mirrored (${mirrored} off the X = 0 plane${drawnOff.length ? `; off: ${drawnOff.join(', ')}` : ''})`);

    // Nothing stands in the way out of a crossing up. With nowhere to fly across to it is followed by a
    // jump, flown straight on along the nose through the countdown (at most the space cruise) and the
    // enter stage up to the transit (at most the scene's own curve from that cruise); within one system
    // it is faced toward the far world and flown the whole way there. Every station and capital ship the
    // zone stands is kept that far off the line, its bounding radius and a hull's margin clear.
    const MARGIN = 50;
    const inTheWay = (pack: SpacePack, from: readonly number[], dir: readonly number[], run: number): string => {
      for (const m of landmarksOf(pack)) {
        const t = (m.at[0] - from[0]) * dir[0] + (m.at[1] - from[1]) * dir[1] + (m.at[2] - from[2]) * dir[2];
        const s = Math.max(0, Math.min(run, t));
        const off = Math.hypot(from[0] + dir[0] * s - m.at[0], from[1] + dir[1] * s - m.at[1], from[2] + dir[2] * s - m.at[2]);
        if (off < (m.radius || 0) + MARGIN) return `a thing ${Math.round(m.radius)} m across ${Math.round(t)} m along, ${Math.round(off)} m off the line`;
      }
      return '';
    };
    const worlds = PLANETS.filter((p) => !p.space && !!systemOf(p.id)?.zone);
    const places = new Map<string, { dest: Destination; pack: SpacePack }>();
    for (const w of worlds) {
      const dest = destinationFor(systemOf(w.id)!, w, cat);
      const pack = dest ? cat.pack(dest.zone) : null;
      if (dest && pack) places.set(w.id, { dest, pack });
    }
    const blocked: string[] = [];
    const runs: string[] = [];
    let across = 0;
    for (const [id, { dest, pack }] of places) {
      const s = sceneOf(pack);
      const T = transitAt(s);
      let enter = 0;
      for (let i = 0; i < 1000; i++) enter += (enterSpeed(((i + 0.5) * T) / 1000, RIDE_TUNE.spaceCruise, s) * T) / 1000;
      const run = JUMP_COUNTDOWN * RIDE_TUNE.spaceCruise + enter;
      const up = zonePlace(pack, dest, null);
      const why = inTheWay(pack, up.at, up.forward, run);
      if (why) blocked.push(`${id} (${dest.kind}): ${why}`);
      runs.push(`${id} ${Math.round(run)}`);
      // The same system's other worlds, faced toward and flown to.
      for (const [other, there] of places) {
        if (other === id || there.dest.zone !== dest.zone) continue;
        const to = zonePlace(pack, there.dest, null).at;
        const from = zonePlace(pack, dest, to);
        const d = Math.hypot(to[0] - from.at[0], to[1] - from.at[1], to[2] - from.at[2]);
        const facing = (from.forward[0] * (to[0] - from.at[0]) + from.forward[1] * (to[1] - from.at[1]) + from.forward[2] * (to[2] - from.at[2])) / d;
        const w = inTheWay(pack, from.at, from.forward, d);
        if (w || facing < 1 - 1e-9) blocked.push(`${id} across to ${other}: ${w || `faces ${facing.toFixed(3)} of the way`}`);
        across++;
      }
    }
    if (places.size < worlds.length) note(`${worlds.length - places.size} of ${worlds.length} worlds with an orbit have no converted zone, so their way out is not checked`);
    ok(blocked.length === 0 && places.size > 0, `out of every crossing up, the countdown and the enter stage run clear of every station and capital ship (${places.size} worlds, ${runs.join(', ')} m), and the ${across} flights across a system face their far end and pass nothing on the way${blocked.length ? `: ${blocked.join('; ')}` : ''}`);
    for (const [id, { dest, pack }] of places) {
      if (dest.kind !== 'station') continue;
      const up = zonePlace(pack, dest, null);
      const st = toGame(dest.at);
      const away = up.forward[0] * (st[0] - up.at[0]) + up.forward[1] * (st[1] - up.at[1]) + up.forward[2] * (st[2] - up.at[2]);
      ok(away < 0, `${id} comes up beside its station facing away from it, into the open a jump is flown into`);
    }
  }
}

{
  // What is read out of other files and must stay true: the crossing down comes out inside the range a
  // starport's buildings load out to; the climb ends under the height where a ship's own flight eases a
  // slack nose back down; space's cruise is under what a body can be moved at.
  const layout = readFileSync(new URL('../../../src/world/layoutStream.ts', import.meta.url), 'utf8');
  const vehicle = readFileSync(new URL('../../../src/vehicles/vehicle.ts', import.meta.url), 'utf8');
  const near = Number(/\{ minRadius: 12, range: (\d+) \}/.exec(layout)?.[1]);
  const ceiling = Number(/fly: \{ climb: big \? 6 : 10, ceiling: (\d+), floor/.exec(vehicle)?.[1]);
  const cap = constOf(vehicle, 'BODY_SPEED_CAP');
  ok(near > 0 && RIDE_TUNE.downReachMin < near && RIDE_TUNE.downReach <= near - RIDE_TUNE.downReachMargin, `the crossing down comes out ${RIDE_TUNE.downReach} m from the pad (never nearer than ${RIDE_TUNE.downReachMin}), inside the ${near} m a starport loads out to`);
  ok(ceiling > 0 && GATE + RIDE_TUNE.gateMargin < ceiling, `the climb goes to ${GATE + RIDE_TUNE.gateMargin} m over the ground, under the ship's ceiling of ${ceiling}`);
  ok(RIDE_TUNE.spaceCruise < cap, `space's cruise of ${RIDE_TUNE.spaceCruise} m/s is under the ${cap} a body can be moved at`);
}

{
  // About how long a trip through space flies, from the game's own calm transport (its cut and join as
  // `rigPath.test.ts` measures them, its touch-down at 22.33 s): 82 seconds or so, loading screens aside.
  const route = planRoute(spaceTicket('naboo', 'tatooine'), padOn('naboo'), padOn('tatooine'), 'naboo', null, SPACE)!;
  const calm = { cut: 12.8, cutH: 190.93, join: 8.2, joinH: 127.33, joinOut: 276.55, down: 22.33 };
  const s = tripSeconds(route, calm, { cruise: 150, spaceCruise: RIDE_TUNE.spaceCruise, climbDeg: RIDE_TUNE.climbDeg, gate: GATE, gateMargin: RIDE_TUNE.gateMargin, downGlide: RIDE_TUNE.downGlide, downReach: RIDE_TUNE.downReach, jump: 17.8 });
  ok(Math.abs(s - 82) <= 3, `a calm transport's trip through space flies for about ${s.toFixed(1)} s, as the design reckoned (82 ± 3)`);
}

console.log(`\nride route: ${passed} checks passed`);
