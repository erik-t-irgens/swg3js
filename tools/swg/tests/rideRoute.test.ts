// A shuttle trip as data (src/world/rideRoute.ts): the pads a trip names, the one rule for which port a
// travel thing belongs to, the hop the console flies, a ticket's trip about one world, and the pad each
// of the game's ports is flown to.
//
// The port rule used to live in main.ts twice over (the terminal's port and the name a shuttle's round
// runs under); it lives here now, so the names every shuttle's round has always run under are checked
// against a transcription of the old code over every converted world's own travel rows and places: a
// round that changed its name would have every shuttle land at another moment than the one it did.
//
// Run: node tools/swg/tests/rideRoute.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { landingMood } from '../../../src/vehicles/rigHull.ts';
import { PORT_REACH, landMood, padOfPort, padRefOf, planHop, planRoute, portOfThing, shuttleClockName, type PadRef } from '../../../src/world/rideRoute.ts';
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
  ok(planRoute({ ...ticket, pack: 'tatooine' }, from, to, 'naboo') === null, 'nor is a ticket to another world flown yet');
  ok(JSON.stringify(structuredClone(route)) === JSON.stringify(route), 'and a trip is plain data');
  ok(landMood(rig, from) === 'calm' && landMood(rigs.shuttle, to!) === '' && landMood({ moods: { theed: rig.moods.calm, calm: rig.moods.calm } }, { mood: 'theed' }) === 'calm', 'a hull lands with its calm branch where its rig has one, and its own otherwise');
  ok(landingMood(rigs.shuttle.moods, '') === landMood(rigs.shuttle, { mood: '' }) && landingMood(rig.moods, 'calm') === landMood(rig, { mood: 'calm' }), "and the hull's own rule is that same one");
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

console.log(`\nride route: ${passed} checks passed`);
