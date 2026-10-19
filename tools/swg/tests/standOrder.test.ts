// Why the people are stood by the loading screen's settle and not by the arrival's warm-up (the performance pass's
// first wave): the real `StandingPeople` driven in the world's own order. A world's load empties the people's rows
// (`World.unload` calls `standingPeople.unload`), the arrival's warm-up ran next with a forced pass of its own, and only
// then did `loadPack` hand the people the new world's rows (`standingPeople.adopt`). So the warm-up's forced pass stood
// nobody, on every path, and the settle's, which runs once the pack is in, stands them. The order itself is read out
// of world.ts, so the test fails if the world ever moves a step of it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { StandingPeople, type PeopleDeps, type StandingRow } from '../../../src/world/standingPeople.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const bodies: { removed: boolean; dead: boolean; ready: boolean }[] = [];
const deps: PeopleDeps = {
  catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }) as never,
  spawn: () => {
    const b = { removed: false, dead: false, ready: true };
    bodies.push(b);
    return b as never;
  },
  remove: (m) => {
    (m as unknown as { removed: boolean }).removed = true;
  },
  centre: () => ({ x: 0, z: 0 }),
  held: () => false,
};
const row = (x: number, z: number): StandingRow => ({ who: 'a townsperson', id: 'body', x, y: 0, z, heading: 0, cell: 0, respawn: 300, where: 'static_spawns' });
const at = new THREE.Vector3(0, 0, 0);

{
  const people = new StandingPeople();
  // The world left behind's rows, standing.
  people.adopt([row(1, 1), row(2, 2)]);
  people.step(0, 0, at, deps, true);
  ok(people.last.up === 2, 'the world left behind had its people standing');
  // `World.load` -> `unload`: the rows emptied.
  people.unload();
  // The arrival's warm-up, which used to force a pass here.
  const before = bodies.length;
  people.step(0, 0, at, deps, true);
  ok(bodies.length === before && people.last.up === 0 && people.last.rows === 0, "the warm-up's forced pass, between the load and the pack, stands nobody: the rows are empty");
  // `loadPack` -> `adopt`: the new world's rows.
  people.adopt([row(3, 0), row(-4, 0), row(0, 5)]);
  people.step(0, 1, at, deps, true);
  ok(people.last.stood === 3 && people.last.up === 3 && bodies.length === before + 3, 'a forced pass after the pack is in stands them: which is where the settle makes it');
  ok(people.readyBodies() === 3, 'and the record of a screen counts them up once their models are');
  // One still loading its model and one taken away: neither is up, and only the one ready and live is counted.
  const mine = bodies.slice(before);
  mine[0].ready = false;
  mine[1].removed = true;
  ok(people.readyBodies() === 1, `a body still loading and one taken away are not up (${people.readyBodies()} of 3): what T6 is read by counts only the ready and live`);
  mine[1].removed = false;
  mine[1].dead = true;
  ok(people.readyBodies() === 1, 'nor one lying dead');
}

{
  // The world's own order, read out of world.ts: the unload empties the rows in `unload`, the pack adopts them, and the
  // warm-up no longer forces a pass of its own.
  const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
  ok(/wildLife\.unload\(\);\s*standingPeople\.unload\(\);/.test(world), "the world's unload empties the people's rows");
  ok(/standingPeople\.adopt\(/.test(world.slice(world.indexOf('async loadPack('))), 'the pack hands them the new rows');
  const warm = world.slice(world.indexOf('  warmUp(center: THREE.Vector3): void {'), world.indexOf('  warmUp(center: THREE.Vector3): void {') + 6000);
  ok(warm.length > 1000 && !/standingPeople\.step\(/.test(warm) && !/ambientPeople\.step\(/.test(warm), 'and the arrival\'s warm-up forces no pass of its own any more');
  ok(/standPeopleNow\(at: THREE\.Vector3\): number \{\s*standingPeople\.step\(0, this\.simTime, at, this\.peopleDeps\(\), true\);/.test(world), 'the settle\'s pass is the world\'s own forced one');
}

console.log(`\nstandOrder: ${checks} checks passed`);
