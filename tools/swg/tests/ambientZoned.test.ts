// The people of ours kept out of a no-spawn zone (Map-maker II's twelfth wave; research5 §3.10's `ambientZoned`): a starport
// in a zone keeping `ours` stands no traveller (those already about finish on their own) and a building of the fillers' in
// one stands nobody, asked of the runner's own pass (`AmbientPeople.gather`) through the world's one hand-over
// (`AmbientDeps.zoned`); with no zone (the hand-over absent, every world with no removal file) the pass is the one it was.
// And the world asks the zone in the file's frame, carrying a point of the game's back about its own centre (`World.oursZoned`).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AmbientPeople, type AmbientDeps } from '../../../src/world/ambient/ambientPeople.ts';
import { ZoneSet, rawOf, zonesOf } from '../../../src/world/noSpawnZones.ts';
import { REPO } from './oldModules.ts';
import * as THREE from 'three';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type Runner = {
  ports: { port: { pad: { x: number; z: number } }; ready: boolean; triedAt: number }[];
  active: unknown[];
  candidateCount: number;
  gather(now: number, seconds: number, at: THREE.Vector3, deps: AmbientDeps): void;
  planPort(pp: unknown, now: number, deps: AmbientDeps): void;
};

/** The runner with one port (never planned: what a plan is asked of is counted) and one building of ours with one place due. */
function runner(): { run: Runner; planned: () => number } {
  const ap = new AmbientPeople();
  const run = ap as unknown as Runner;
  let planned = 0;
  run.ports = [{ port: { pad: { x: 10, z: 10 } }, ready: false, triedAt: -100 }];
  run.planPort = () => {
    planned++;
  };
  run.active = [{ empty: true, draw: true, building: { x: 60, z: 60, radius: 10 }, slots: [{ state: 'entering', leaveAt: 1e9 }], bodies: [null], blocked: [false], doors: [{}], seed: 1 }];
  return { run, planned: () => planned };
}
const at = new THREE.Vector3(0, 0, 0);
const deps = (zoned?: (x: number, z: number) => boolean): AmbientDeps => ({ ...(zoned ? { zoned } : {}) }) as unknown as AmbientDeps;

{
  const a = runner();
  a.run.gather(10, 10, at, deps());
  ok(a.planned() === 1 && a.run.candidateCount === 1, 'with no zone the port is planned and the building of ours has its place due, as before');
  const b = runner();
  b.run.gather(10, 10, at, deps((x, z) => Math.hypot(x - 10, z - 10) < 5));
  ok(b.planned() === 0 && b.run.candidateCount === 1, 'a port in a zone keeping ours stands no traveller: it is not even planned, and the building beside it still is due');
  const c = runner();
  c.run.gather(10, 10, at, deps((x, z) => Math.hypot(x - 60, z - 60) < 5));
  ok(c.planned() === 1 && c.run.candidateCount === 0, 'a building of the fillers\' in one stands nobody, and the port beside it is planned');
}
{
  // A zone put down live: whoever of ours already stands in a building or at a port it now keeps is put away on the next pass
  // (`shedZoned`, which the pass runs after walking everybody), and nobody else is.
  const ap = new AmbientPeople();
  const run = ap as unknown as { records: Map<string, unknown>; done: Map<number, number>; tally: { zoned: number }; shedZoned(d: AmbientDeps): void };
  const body = () => ({ removed: false, pos: new THREE.Vector3() });
  const fill = { building: { x: 60, z: 60, radius: 10 }, bodies: [null, null] as unknown[] };
  const inZone = { id: 'f0', num: -1, body: body(), fill, slot: 0, port: null, plan: null, trace: null };
  fill.bodies[0] = inZone.body;
  const farFill = { building: { x: 300, z: 300, radius: 10 }, bodies: [null] as unknown[] };
  const elsewhere = { id: 'f1', num: -1, body: body(), fill: farFill, slot: 0, port: null, plan: null, trace: null };
  farFill.bodies[0] = elsewhere.body;
  const traveller = { id: 't7', num: 7, body: body(), fill: null, slot: 0, port: { port: { pad: { x: 10, z: 10 } } }, plan: { round: 3 }, trace: null };
  run.records.set('f0', inZone);
  run.records.set('f1', elsewhere);
  run.records.set('t7', traveller);
  const removed: unknown[] = [];
  const zone = (x: number, z: number) => Math.hypot(x - 60, z - 60) < 5 || Math.hypot(x - 10, z - 10) < 5;
  run.shedZoned({ zoned: zone, remove: (m: unknown) => removed.push(m) } as unknown as AmbientDeps);
  ok(removed.length === 2 && removed.includes(inZone.body) && removed.includes(traveller.body) && !removed.includes(elsewhere.body), 'the filler in a zoned building and the traveller of a zoned port are put down, the filler elsewhere stays');
  ok(run.records.size === 1 && run.records.has('f1') && fill.bodies[0] === null && run.done.get(7) === 3 && run.tally.zoned === 2, "off the books, the filler's place left empty and the traveller's day over for its round");
  const ambient = readFileSync(join(REPO, 'src/world/ambient/ambientPeople.ts'), 'utf8');
  ok(/for \(const r of this\.records\.values\(\)\) this\.walkOne\(r, now, seconds, at, deps\);\s*\/\/[^\n]*\n\s*if \(deps\.zoned\) this\.shedZoned\(deps\);/.test(ambient), 'and every pass asks it, after walking everybody and before anybody is stood');
}
{
  // The world's question: a point of the game's frame carried into the file's about the layout's centre, asked of the zones
  // that keep ours.
  const centre = { x: 3500, z: -4800 };
  const set = new ZoneSet(zonesOf([{ id: 'z:port', shape: { kind: 'circle', c: [3510, -4790], r: 20 }, keeps: ['ours'] }]));
  const game = { x: centre.x - 3510, z: -4790 - centre.z };
  const raw = rawOf(game.x, game.z, centre);
  ok(raw.x === 3510 && raw.z === -4790 && set.oursZone(raw.x, raw.z) === 0, "the world carries the game's point back into the file's frame and asks the zones keeping ours");
  ok(new ZoneSet(zonesOf([{ id: 'z:p', shape: { kind: 'circle', c: [3510, -4790], r: 20 }, keeps: ['people'] }])).oursZone(raw.x, raw.z) === -1, 'a zone that keeps only the data\'s people keeps none of ours off');
  const world = readFileSync(join(REPO, 'src/world/world.ts'), 'utf8');
  ok(/zoned: \(x, z\) => this\.oursZoned\(x, z\)/.test(world) && /const raw = gameTo\(gx, gz, c\);\s*return this\.zoneSet\.oursZone\(raw\.x, raw\.z\) >= 0;/.test(world), "and the world hands the runner exactly that question");
}

console.log(`\n${checks} checks passed`);
