// A world's own arrival (`PlanetDef.arrival`, `src/world/arrival.ts`): Mustafar's is the Mensix Mining Facility's
// landing deck, worked out into the game's frame from the world's own places file, stood at its own height and never
// moved to the ground about 125 m under it, and the spawn a death comes round at. The numbers are fix round 2's measurement of
// the deck (cell 0's own floor of the facility's portal layout), which this test holds the arithmetic to, and, where
// Mustafar's pack is converted on this machine, holds the deck itself to.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PLANETS } from '../../../src/data/planets.ts';
import { arrivalInGame, hasOwnArrival } from '../../../src/world/arrival.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const text = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

const mustafar = PLANETS.find((p) => p.id === 'mustafar')!;
// Fix round 2's measurement: Mustafar's places file centre, and the deck in the game's frame.
const CENTRE = { x: -5431, z: 6054 };
const DECK = { x: -2952.9, z: -4434.0, floor: 230.06 };
const DOOR = { x: -2961.6, z: -4411.9 };

// ------------------------------------------------------------------------------------------- the arithmetic
{
  ok(!!mustafar.arrival && hasOwnArrival(mustafar), 'Mustafar names an arrival of its own');
  const g = arrivalInGame(mustafar.arrival!, CENTRE);
  ok(near(g.x, DECK.x) && near(g.z, DECK.z), `worked out from the places file's centre, it is the deck's middle in the game's frame (${g.x.toFixed(2)}, ${g.z.toFixed(2)})`);
  ok(g.y > DECK.floor && g.y - DECK.floor < 0.5, `at a body's standing height over the deck's floor, ${(g.y - DECK.floor).toFixed(2)} m over its ${DECK.floor}`);
  // The heading is ours and the owner's to change (`__debug.arrival({ heading })`), so only its being a heading the
  // arrival takes is held; how near it faces the door is said and never held.
  const face = Math.atan2(DOOR.x - g.x, DOOR.z - g.z);
  ok(g.heading !== null && Number.isFinite(g.heading) && g.heading === mustafar.arrival!.heading, `with the heading it names, which the arrival passes through as it stands (${g.heading} rad)`);
  console.log(`note the door into the landing deck room is at ${face.toFixed(3)} rad from the arrival, ${g.heading === null ? 'no heading named' : `${Math.abs(face - g.heading).toFixed(3)} rad off the heading named`}`);
  const moved = arrivalInGame({ raw: { x: 10, z: 20 }, y: 5 }, { x: 100, z: -50 });
  ok(moved.x === 90 && moved.z === 70 && moved.y === 5 && moved.heading === null, "the teleport's own arithmetic: x mirrored about the centre, z moved by it, the height absolute, no heading where none is named");
}

// ------------------------------------------------------------------------------------------- which worlds
{
  const named = PLANETS.filter((p) => p.arrival);
  ok(named.every((p) => hasOwnArrival(p)) && named.map((p) => p.id).join(',') === 'mustafar', `only worlds of one zone and some ground name an arrival, and Mustafar is the one (${named.map((p) => p.id).join(', ')})`);
  const tatooine = PLANETS.find((p) => p.id === 'tatooine')!;
  ok(!hasOwnArrival(tatooine) && !hasOwnArrival({ arrival: mustafar.arrival, zones: [{}] }) && !hasOwnArrival({ arrival: mustafar.arrival, space: 'test_space' }), 'a world naming none, a zoned world and a space zone arrive as they always did');
}

// ------------------------------------------------------------------------------------------- on this machine
// Where Mustafar's pack is converted: its places file's centre, and the deck itself under the arrival.
{
  const pois = new URL('../../../assets-private/mustafar/pois.json', import.meta.url);
  if (existsSync(pois)) {
    const centre = JSON.parse(readFileSync(pois, 'utf8')).center as { x: number; z: number };
    const g = arrivalInGame(mustafar.arrival!, centre);
    ok(near(g.x, DECK.x, 0.01) && near(g.z, DECK.z, 0.01), `the converted places file's centre (${centre.x}, ${centre.z}) puts it on the deck's middle`);
  } else console.log('note no Mustafar places file on this machine: the arithmetic alone is held');
  const floors = new URL('../../../assets-private/mustafar/floors.json', import.meta.url);
  const layout = new URL('../../../assets-private/mustafar/layout.json', import.meta.url);
  if (existsSync(floors) && existsSync(layout)) {
    const building = (JSON.parse(readFileSync(layout, 'utf8')).objects as { template: string; model: string; x: number; y: number; z: number }[]).find((o) => /must_new_mining_facility/.test(o.template));
    const floor = JSON.parse(readFileSync(floors, 'utf8')).models?.[building?.model ?? '']?.['0']?.floor as { v: number[]; t: number[] } | undefined;
    if (building && floor) {
      // The arrival in the building's own frame, x negated as the floors file keeps it (the building stands unturned).
      const a = mustafar.arrival!;
      const lx = -(a.raw.x - building.x);
      const lz = a.raw.z - building.z;
      let under: number | null = null;
      for (let t = 0; t * 10 < floor.t.length; t++) {
        const p = [0, 1, 2].map((k) => floor.t[t * 10 + k] * 3);
        const [ax, ay, az] = [floor.v[p[0]], floor.v[p[0] + 1], floor.v[p[0] + 2]];
        const [bx, by, bz] = [floor.v[p[1]], floor.v[p[1] + 1], floor.v[p[1] + 2]];
        const [cx, cy, cz] = [floor.v[p[2]], floor.v[p[2] + 1], floor.v[p[2] + 2]];
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const u = ((bz - cz) * (lx - cx) + (cx - bx) * (lz - cz)) / d;
        const v = ((cz - az) * (lx - cx) + (ax - cx) * (lz - cz)) / d;
        if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
        under = building.y + u * ay + v * by + (1 - u - v) * cy;
        break;
      }
      ok(under !== null && a.y > under && a.y - under < 0.5, `the deck's own floor (the facility's cell 0) stands under the arrival, ${under === null ? 'none found' : `${(a.y - under).toFixed(2)} m below it at ${under.toFixed(2)}`}`);
    } else console.log('note the converted Mustafar pack has no floor for the facility: the deck itself is not held');
  } else console.log('note no Mustafar floors on this machine: the deck itself is not held');
}

// ------------------------------------------------------------------------------------------- the wiring
// The game's own hand-overs, which nothing above makes: read as text, since the app does not load under node.
{
  const main = text('src/main.ts');
  ok(/const home = await this\.homeOf\(planet, c\.zone\);\s*this\.arrive\(planet, c\.zone, [^\n]*, home\);/.test(main), "a character played is arrived with its world's own arrival, worked out before the world is in");
  ok(/const home = planet\.space \? null : await this\.homeOf\(planet, zoneId\);/.test(main) && /this\.arrive\(planet, zoneId, [^\n]*, home\);/.test(main), 'and so is a travel, a galaxy shuttle to a world with no port among them included');
  ok(/this\.spawn = home \? new THREE\.Vector3\(home\.x, home\.y, home\.z\) : this\.world\.spawnPoint\(\);/.test(main), 'the arrival is the spawn a death comes round at, in place of the flattest spot near the layout centre');
  ok(/if \(clearSpawn && !at && !home && /.test(main), 'and an arrival there is never moved to open ground near it, which is the valley floor about 125 m below the deck');
  ok(/if \(!this\.arrivalHome\) this\.spawn\.copy\(at\);/.test(main), 'a ship come down out of space leaves the spawn on the deck');
  ok(/private respawn\(\): void \{[\s\S]{0,600}this\.player\.reset\(this\.spawn\);/.test(main), 'and a death comes round at the spawn');
  ok(/if \(home && !at && home\.heading !== null\) \{\s*this\.player\.heading = home\.heading;/.test(main), 'facing the heading the world names, where nothing else says where the player stands');
  // From far off the deck's collision is gone (the streamer keeps a building's only near the player), so a death there
  // must move the world first, as a facility's respawn does, or the player is stood in the air 125 m over the valley.
  ok(/private respawn\(\): void \{[\s\S]{0,300}?if \(this\.spawnNeedsWorld\(\)\) \{\s*void this\.respawnHome\(\);\s*return;\s*\}\s*this\.death\.classList\.remove/.test(main), 'a death far from the deck, with no floor under the spawn, comes round by the slow way');
  ok(/private spawnNeedsWorld\(\): boolean \{[\s\S]{0,400}return !this\.floorUnder\(s\);/.test(main) && /private floorUnder\(at: THREE\.Vector3\): boolean \{\s*return this\.physics\.groundDistance\(at\.x, at\.y \+ 0\.5, at\.z, 2, this\.player\.body\) !== null;/.test(main), 'which it takes exactly when the spawn is the arrival and nothing solid is under it now');
  ok(/private async standAtHome\([\s\S]{0,700}this\.loadingScreen\.show\([\s\S]{0,400}this\.world\.jumpTo\(at\);[\s\S]{0,200}await this\.settle\(\);[\s\S]{0,200}onFloor = this\.floorUnder\(at\);/.test(main), 'the slow way: a loading screen, the world moved to the deck and waited for, and the floor read before the player is stood on it');
  ok(/else if \(this\.floorUnder\(at\)\) \{[\s\S]{0,400}\} else if \(!\(await this\.standAtHome\(at, home,/.test(main), "and the console's go takes it too when the floor is not built where it is asked from");
  ok(/this\.world\.arrivalPoint = \(\) => this\.spawn;/.test(main), "so the NGE overlay's people who pick a fight keep clear of the deck, not of the old spot");
}

console.log(`\n${passed} checks passed`);
