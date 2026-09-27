// A shuttle trip as data (src/world/rideRoute.ts): the pads a trip names, the one rule for which port a
// travel thing belongs to, and the hop the console flies.
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
import { PORT_REACH, padRefOf, planHop, portOfThing, shuttleClockName, type PadRef } from '../../../src/world/rideRoute.ts';
import { portsOf, type Port, type PoiRow } from '../../../src/world/shuttle.ts';
import { TRAVEL_TUNE, rigTimes, travelThingsOf, type TravelRig, type TravelRow, type TravelThing } from '../../../src/world/travelTerminal.ts';

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

console.log(`\nride route: ${passed} checks passed`);
