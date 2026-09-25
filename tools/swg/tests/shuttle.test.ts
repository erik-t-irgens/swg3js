// Where a shuttle will take you, and what the game charged.
//
// The rules are pure, so this runs the real ones; and because every number they work on is the
// game's own and is already in the packs, the second half runs them over the **real** worlds and
// prints what comes out. That is the only way to know that a rule written against a fixture offers
// a real player somewhere real to go.
//
// Run: node tools/swg/tests/shuttle.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHUTTLE_TUNE, fareText, landingOn, portAt, portsOf, ridesFrom, type FareTable, type PoiRow, type Port } from '../../../src/world/shuttle.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

const poi = (name: string, x: number, z: number, kind: string): PoiRow => ({ name, x, z, kind });
const port = (name: string, x: number, z: number, kind: 'starport' | 'shuttleport'): Port => ({ name, x, z, kind });
const label = (p: string) => (p === 'nowhere' ? null : p.replace(/_/g, ' '));

// ---------------------------------------------------------------- the frame

{
  const ports = portsOf([poi('A', 100, 200, 'starport'), poi('B', 0, 0, 'city'), poi('C', -50, 20, 'shuttleport')], { x: 10, z: 20 });
  ok(ports.length === 2, 'only starports and shuttleports are ports');
  ok(ports[0].x === -90 && ports[0].z === 180, 'a port is mirrored in X and centred exactly as the streamer does it');
  ok(ports[1].kind === 'shuttleport', 'and each keeps which kind it is');
}

{
  // The mirror is the streamer's, not the pack's, so a pack whose centre moves needs no rerun: the
  // same POI against two centres lands two different places and neither is wrong.
  const a = portsOf([poi('A', 100, 200, 'starport')], { x: 0, z: 0 })[0];
  const b = portsOf([poi('A', 100, 200, 'starport')], { x: 100, z: 200 })[0];
  ok(a.x === -100 && a.z === 200, 'against the origin a port keeps its own numbers, X flipped');
  ok(b.x === 0 && b.z === 0, 'and a port at the centre stands at the world origin');
}

{
  const bad = portsOf([poi('A', Number.NaN, 200, 'starport'), poi('B', 1, 2, 'starport')], { x: 0, z: 0 });
  ok(bad.length === 1, 'a place with no real coordinates is not a port');
}

// ---------------------------------------------------------------- standing at one

{
  const ports = [port('near', 0, 0, 'starport'), port('far', 500, 0, 'shuttleport')];
  ok(portAt(ports, { x: 5, z: 5 })?.name === 'near', 'standing beside one puts you at it');
  ok(portAt(ports, { x: 0, z: SHUTTLE_TUNE.reach + 1 }) === null, 'and standing past the reach puts you at none');
  ok(portAt(ports, { x: 0, z: SHUTTLE_TUNE.reach - 1 })?.name === 'near', 'the reach is a circle about the point, since a port in the packs has no size of its own');
  ok(portAt([], { x: 0, z: 0 }) === null, 'a world with no ports has none to stand at');
}

{
  // Corellia really does have a starport and a shuttleport in the same town; the nearer one wins.
  const ports = [port('starport', 0, 0, 'starport'), port('shuttleport', 10, 0, 'shuttleport')];
  ok(portAt(ports, { x: 9, z: 0 })?.name === 'shuttleport', 'two ports in one town: the one you are standing at is the one you get');
  ok(portAt(ports, { x: 1, z: 0 })?.name === 'starport', 'and a step the other way is the other one');
}

// ---------------------------------------------------------------- where it goes

const fares: FareTable = {
  routes: [
    { from: 'here', to: 'there', price: 1000 },
    { from: 'there', to: 'here', price: 4000 },
    { from: 'here', to: 'nowhere', price: 50 },
    { from: 'here', to: 'here', price: 9 },
    { from: 'elsewhere', to: 'there', price: 7 },
  ],
  local: { here: 100 },
};

{
  const home = port('home', 0, 0, 'shuttleport');
  const ports = [home, port('down the road', 300, 0, 'shuttleport'), port('across the map', 4000, 0, 'starport')];
  const rides = ridesFrom(home, ports, 'here', fares, label);
  ok(rides.every((r) => r.kind === 'local'), 'a shuttleport only ever moves you about its own world');
  ok(rides.length === 2, 'to every other port on it');
  ok(rides[0].name === 'down the road', 'nearest first');
  ok(rides.every((r) => r.price === 100), "at the world's own local fare");
  ok(rides[0].to?.x === 300, 'and each says where it lands you');
}

{
  const home = port('home', 0, 0, 'starport');
  const rides = ridesFrom(home, [home, port('down the road', 300, 0, 'shuttleport')], 'here', fares, label);
  const worlds = rides.filter((r) => r.kind === 'world');
  ok(rides.some((r) => r.kind === 'local'), 'a starport moves you about its own world too');
  ok(worlds.length === 1 && worlds[0].name === 'there', 'and off it, to every world the routes table names from here');
  ok(worlds[0].price === 1000, "at the table's own fare");
  ok(worlds[0].pack === 'there', 'naming the pack to travel to');
}

{
  // The fares are directed, which is the whole reason the converter keeps both rows.
  const from = ridesFrom(port('h', 0, 0, 'starport'), [], 'here', fares, label).find((r) => r.pack === 'there');
  const back = ridesFrom(port('t', 0, 0, 'starport'), [], 'there', fares, label).find((r) => r.pack === 'here');
  ok(from?.price === 1000 && back?.price === 4000, 'the fare out is not the fare back');
}

{
  const rides = ridesFrom(port('h', 0, 0, 'starport'), [], 'here', fares, label);
  ok(!rides.some((r) => r.pack === 'nowhere'), 'a route to a world this game does not carry is left out rather than offered and then refused');
  ok(!rides.some((r) => r.pack === 'here'), 'and a route that ends where it starts is not somewhere to go');
  ok(!rides.some((r) => r.pack === 'elsewhere'), 'nor is a route that starts somewhere else');
}

{
  const home = port('home', 0, 0, 'starport');
  const beside = port('beside it', SHUTTLE_TUNE.same - 1, 0, 'shuttleport');
  const rides = ridesFrom(home, [home, beside], 'here', fares, label);
  ok(!rides.some((r) => r.kind === 'local'), 'a port on the very spot you are standing is not a journey');
}

{
  const rides = ridesFrom(port('h', 0, 0, 'shuttleport'), [port('a', 100, 0, 'shuttleport')], 'unpriced', { routes: [], local: {} }, label);
  ok(rides.length === 1 && rides[0].price === 0, 'a world the table gives no local fare for still lets you move about it, free');
  ok(fareText(0) === 'free' && fareText(1000).includes('1,000'), 'and a fare reads as the number the game charged');
}

{
  ok(landingOn([poi('s', 1, 1, 'shuttleport'), poi('p', 2, 2, 'starport')])?.kind === 'starport', 'a shuttle from another world lands at a starport');
  ok(landingOn([poi('s', 1, 1, 'shuttleport')])?.name === 's', 'or at whatever port a world has, if it has no starport');
  ok(landingOn([poi('c', 1, 1, 'city')]) === null, 'a world whose only places are cities lands you wherever the world would have anyway');
  ok(landingOn([]) === null, 'and so does one with no places at all');
}

// ---------------------------------------------------------------- the real worlds

{
  const galaxy = join('assets-private', 'galaxy.json');
  if (!existsSync(galaxy)) {
    note('no galaxy.json here, so the real routes are not read (npm run swg -- maps @SWG assets-private --retail-only)');
  } else {
    const file = JSON.parse(readFileSync(galaxy, 'utf8')) as FareTable & { planets?: { id: string }[] };
    const packs = (file.planets ?? []).map((p) => p.id);
    const name = (p: string) => (packs.includes(p) ? p.replace(/_/g, ' ') : null);
    ok(file.routes.length > 0, `the pack carries ${file.routes.length} shuttle routes between worlds`);

    let withPorts = 0;
    let totalPorts = 0;
    let reachable = 0;
    const oneWay: string[] = [];
    const uneven: string[] = [];
    for (const pack of packs) {
      const poisFile = join('assets-private', pack, 'pois.json');
      if (!existsSync(poisFile)) continue;
      const data = JSON.parse(readFileSync(poisFile, 'utf8')) as { center: { x: number; z: number }; pois: PoiRow[] };
      const ports = portsOf(data.pois ?? [], data.center ?? { x: 0, z: 0 });
      if (!ports.length) continue;
      withPorts++;
      totalPorts += ports.length;
      const star = ports.find((p) => p.kind === 'starport');
      if (!star) continue;
      const rides = ridesFrom(star, ports, pack, file, name);
      const worlds = rides.filter((r) => r.kind === 'world');
      if (worlds.length) reachable++;
      // Every ride must be somewhere a player can really be put: a real fare and a real place.
      for (const r of rides) {
        assert.ok(r.price >= 0 && Number.isFinite(r.price), `${pack}: ${r.name} has a real fare`);
        if (r.kind === 'local') assert.ok(Number.isFinite(r.to!.x) && Number.isFinite(r.to!.z), `${pack}: ${r.name} has a real place`);
        else assert.ok(packs.includes(r.pack!), `${pack}: ${r.name} is a world this game carries`);
      }
      // Standing at the starport, the starport itself is what `portAt` answers.
      assert.ok(portAt(ports, { x: star.x, z: star.z })?.name === star.name, `${pack}: standing at its starport puts you at it`);
      for (const w of worlds) {
        const back = (file.routes ?? []).find((r) => r.from === w.pack && r.to === pack);
        if (!back) oneWay.push(`${pack} -> ${w.pack}`);
        else if (back.price !== w.price) uneven.push(`${pack} to ${w.pack} ${w.price} but back ${back.price}`);
      }
    }
    passed++;
    console.log(`ok   every ride on every converted world has a real fare and a real place to land`);
    note(`${withPorts} converted worlds carry ports, ${totalPorts} of them in all, and ${reachable} can fly off-world`);
    note(oneWay.length ? `${oneWay.length} route${oneWay.length === 1 ? ' is' : 's are'} one-way in the game's own table: ${oneWay.slice(0, 3).join(', ')}` : "every route in the game's own table can be flown both ways");
    // Whether the fare really differs by direction is the reason the converter keeps both rows and
    // the reason this file never folds a pair into one. Measured rather than assumed.
    note(uneven.length ? `${uneven.length / 2} pair${uneven.length === 2 ? '' : 's'} cost different amounts each way, which is why the fare is kept directed: ${uneven[0]}` : 'and every pair costs the same in both directions, so the directed fare is a faithfulness rather than a difference you can feel');

    // What a player standing at one real starport is actually offered.
    const show = packs.find((p) => existsSync(join('assets-private', p, 'pois.json')));
    if (show) {
      const data = JSON.parse(readFileSync(join('assets-private', show, 'pois.json'), 'utf8')) as { center: { x: number; z: number }; pois: PoiRow[] };
      const ports = portsOf(data.pois ?? [], data.center ?? { x: 0, z: 0 });
      const star = ports.find((p) => p.kind === 'starport');
      if (star) {
        const rides = ridesFrom(star, ports, show, file, name);
        note(`at ${star.name} on ${show} a player is offered ${rides.filter((r) => r.kind === 'local').length} places on this world and ${rides.filter((r) => r.kind === 'world').length} other worlds:`);
        for (const r of rides.slice(0, 6)) note(`     ${r.name.padEnd(34)} ${fareText(r.price)}${r.away ? ` (${(r.away / 1000).toFixed(1)} km)` : ''}`);
      }
    }
  }
}

console.log(`\n${passed} checks passed`);
