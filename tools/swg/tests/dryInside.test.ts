// A building with rooms under a lake of ours is dry inside (Map-maker II's fifth wave, DESIGN.md §2.7's underwater
// structures): nothing to build, since every reader of the water already takes a room as dry -- the feet and the blade
// (`waterTopAt`), the swim's column (`Player.inside`), the mobiles, the camera's verdict and the weather -- and a lake of ours
// is a client lake to every one of them. Held: a point in a room under a lake of ours is dry to `waterTopAt` and the same
// point out of doors is under it; and the readers' room rules are still where they were (text).
//
// Run: node tools/swg/tests/dryInside.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lakeTable, surfaceOf } from '../../../src/world/ourWater.ts';
import { waterTopAt } from '../../../src/world/waterLineMath.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');

{
  // A lake 20 m deep over a house whose rooms stand from 0 to 6 m.
  const lake = lakeTable({ id: 'over-house', kind: 'lake', h: 20, points: [[-50, -50], [50, -50], [50, 50], [-50, 50]], shader: null }, (x) => -x, (z) => z);
  const surface = surfaceOf([lake], 3, 4);
  ok(surface === 20, 'the lake of ours is the surface over the house');
  const inRoom = (x: number, y: number, z: number) => Math.abs(x) < 8 && Math.abs(z) < 8 && y >= 0 && y < 6;
  ok(waterTopAt(3, 2, 4, surface, inRoom) === -Infinity, 'a point in one of its rooms is dry (no water over it at all)');
  ok(waterTopAt(30, 2, 4, surface, inRoom) === 20, 'the same height out of doors is under the lake');
  ok(waterTopAt(3, 25, 4, surface, inRoom) === 20, 'and a point over the surface asks nothing of the room');
}

{
  // Every reader's room rule, where it was.
  const player = read('src/player/player.ts');
  // The swim's own line, pinned whole: a `!this.inside` anywhere else in the player (the terrain floor's reset has one) is
  // no proof the swim asks it.
  ok(/this\.swimming = !this\.inside && depth > \(this\.swimming \? SWIM_DEPTH - 0\.3 : SWIM_DEPTH\);/.test(player) && /const depth = surface - this\.pos\.y;/.test(player), "the swim's column is dry while the player is in a room (`Player.inside`): the swim's own line asks it");
  const world = read('src/world/world.ts');
  ok(/const dry = !this\.planet \|\| !!this\.planet\.space \|\| this\.inside;/.test(world), "the camera's verdict is dry in a room");
  ok(/const table = dry \? null : this\.terrain\.waterTableAt\(p\.x, p\.z\);/.test(world), 'and names the lake of ours over it through the terrain\'s own answer, on any world');
  const line = read('src/world/waterLineMath.ts');
  ok(/return indoors\(x, y, z\) \? -Infinity : surface;/.test(line), "the feet's and the blade's water reads a room as dry (`waterTopAt`)");
}

console.log(`dryInside: ${checks} checks passed`);
