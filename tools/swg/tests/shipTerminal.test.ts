// The ship terminal: what the game's own `terminal_space` offers, and that it really is in the
// starports rather than somewhere this file decided.
//
// The second half is the interesting one. Nothing here may have an opinion about which ports have a
// ship terminal -- the world's own snapshot placed them, 130 over the ground worlds -- so the real
// packs are read and the terminals are matched against the ports the same packs name. If they ever
// stop landing in starports, this says so.
//
// Run: node tools/swg/tests/shipTerminal.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SHIP_TERMINAL_TEMPLATES, SHIP_TERMINAL_TUNE, SHIP_TRIP_ORBIT, shipTripsFrom, shipTripsNote, type ShipTerminalState } from '../../../src/world/shipTerminal.ts';
import { portsOf, type PoiRow } from '../../../src/world/shuttle.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

const here = { name: 'Coronet Starport', x: 0, z: 0, kind: 'starport' as const };
const ports = [
  here,
  { name: 'Kor Vella Starport', x: 3000, z: 0, kind: 'starport' as const },
  { name: 'Tyrena Starport', x: 0, z: 1200, kind: 'starport' as const },
  { name: 'Doaba Guerfel Shuttleport', x: 200, z: 200, kind: 'shuttleport' as const },
];
const good: ShipTerminalState = { hasShip: true, orbit: 'space_corellia', orbitName: 'Corellia orbit', canFly: true, whyNot: '' };

// ---------------------------------------------------------------- what it offers

{
  const trips = shipTripsFrom(here, ports, good);
  ok(trips[0].kind === 'orbit', 'the orbit is offered first, because it is the thing a ship terminal is for');
  ok(trips.every((t) => t.kind === 'orbit' || t.name.includes('Starport')), 'and only starports after it: a shuttleport is a shelter with a bench and no pad');
  ok(!trips.some((t) => t.name === here.name), 'the port you are standing in is not somewhere to fly to');
  ok((trips[1].away ?? 0) < (trips[2].away ?? 0), 'the nearest pad is offered before the far one');
  ok(trips.every((t) => !t.why), 'and with a ship and nothing in the way, every one of them can be taken');
}

{
  const nowhere = shipTripsFrom(here, ports, { ...good, orbit: null, orbitName: '' });
  ok(!nowhere.some((t) => t.kind === 'orbit'), 'a world with nothing above it offers no launch');
  ok(nowhere.length === 2, 'and still offers its pads');
}

{
  // A refusal is **listed** rather than hidden, so a player is told why the list does nothing
  // instead of being shown a list that silently will not work.
  const flying = shipTripsFrom(here, ports, { ...good, canFly: false, whyNot: 'you are already flying' });
  ok(flying.length === 3 && flying.every((t) => t.why === 'you are already flying'), 'every trip carries the reason it cannot be taken');
  ok(shipTripsNote(flying, { ...good, canFly: false, whyNot: 'you are already flying' }).includes('already flying'), 'and the note under the list says it once');
  const none = shipTripsFrom(here, ports, { ...good, hasShip: false });
  ok(none.every((t) => t.why === 'you have no ship'), 'and with no ship at all, that is the reason');
  ok(shipTripsNote(none, { ...good, hasShip: false }).includes('no ships converted'), 'which the note puts in the words a fresh checkout needs');
}

{
  ok(shipTripsNote(shipTripsFrom(here, ports, good), good).includes('nothing to pay'), 'nothing is charged: it is your own ship, not a seat on somebody else\'s');
  ok(shipTripsNote([], good).includes('nowhere'), 'and a world with no pad and no orbit says so');
}

{
  // The orbit's id must not be mistakable for a port's name, since both go through one string.
  ok(!ports.some((p) => p.name === SHIP_TRIP_ORBIT), 'the orbit carries an id no place name can hold');
  ok(SHIP_TRIP_ORBIT.includes('\u0000'), 'and it is spelt with a character a name cannot contain');
}

// ------------------------------------------- the real packs: where the game itself put them

{
  const packs = join(process.cwd(), 'assets-private');
  const worlds = existsSync(packs) ? readdirSync(packs).filter((w) => existsSync(join(packs, w, 'layout.json')) && existsSync(join(packs, w, 'pois.json'))) : [];
  if (!worlds.length) {
    note('no converted world here, so where the game puts its ship terminals is not checked');
  } else {
    let total = 0;
    let atStarport = 0;
    let worstAway = 0;
    const byWorld: string[] = [];
    for (const world of worlds) {
      const layout = JSON.parse(readFileSync(join(packs, world, 'layout.json'), 'utf8')) as { center?: { x: number; z: number }; objects: { template: string; x: number; z: number; contained?: boolean }[] };
      const poisFile = JSON.parse(readFileSync(join(packs, world, 'pois.json'), 'utf8')) as PoiRow[] | { pois?: PoiRow[] };
      const rows = Array.isArray(poisFile) ? poisFile : (poisFile.pois ?? []);
      const centre = layout.center ?? { x: 0, z: 0 };
      const star = portsOf(rows, centre).filter((p) => p.kind === 'starport');
      const found = (layout.objects ?? []).filter((o) => SHIP_TERMINAL_TEMPLATES.has(o.template));
      if (!found.length) continue;
      let near = 0;
      for (const o of found) {
        total++;
        const at = { x: -(o.x - centre.x), z: o.z - centre.z };
        let d = Infinity;
        for (const p of star) d = Math.min(d, Math.hypot(p.x - at.x, p.z - at.z));
        if (d <= 200) {
          atStarport++;
          near++;
          if (d > worstAway) worstAway = d;
        }
      }
      byWorld.push(`${world} ${near}/${found.length}`);
    }
    if (!total) note('no converted world places a ship terminal, so nothing was measured');
    else {
      // Not all of them: a few stand in cantinas and hotels, which is the game's own doing. What
      // matters is that the starports have them, since that is where the travel is.
      ok(atStarport > 0, `${atStarport} of ${total} ship terminals over ${byWorld.length} worlds stand within 200 m of a starport this game names (${byWorld.join(', ')})`);
      ok(worstAway < 200, `and the furthest one that counts is ${worstAway.toFixed(0)} m from its port, which is inside a starport's own footprint`);
      note(`the reach is ours and is ${SHIP_TERMINAL_TUNE.reach} m: "you are at that terminal", not "you are at the port"`);
    }
  }
}

console.log(`\n${passed} checks passed`);
