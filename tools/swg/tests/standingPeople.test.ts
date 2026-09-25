// The people who stand somewhere and stay there, driven headless.
//
// Where the real packs are converted it then stands a real town, which is the only way to know that
// numbers tuned on a fixture behave over four thousand rows half of which are indoors.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { StandingPeople, PEOPLE_TUNE, type PeopleDeps, type StandingRow } from '../../../src/world/standingPeople.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

interface Body {
  dead: boolean;
  removed: boolean;
  x: number;
  z: number;
  y: number | undefined;
  inside: boolean;
}

function game(over: Partial<PeopleDeps> = {}): { deps: PeopleDeps; bodies: Body[] } {
  const bodies: Body[] = [];
  const deps: PeopleDeps = {
    catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }) as never,
    spawn: (entry, at, inside) => {
      const b: Body = { dead: false, removed: false, x: at.x, z: at.z, y: at.y, inside };
      void entry;
      bodies.push(b);
      return b as never;
    },
    remove: (m) => {
      (m as unknown as Body).removed = true;
    },
    centre: () => ({ x: 0, z: 0 }),
    held: () => false,
    ...over,
  };
  return { deps, bodies };
}

const row = (over: Partial<StandingRow> = {}): StandingRow => ({ who: 'somebody', id: 'body', x: 0, y: 10, z: 0, heading: 0, cell: 0, respawn: 300, where: 'static_spawns', ...over });

// ------------------------------------------------------------------ what is taken and what is refused
{
  const p = new StandingPeople();
  p.adopt([row(), row({ x: 5 })]);
  ok(p.ready && p.last.rows === 2, 'the rows a pack carries are taken');

  // A row indoors whose room could not be resolved is a spot in a cell and nowhere on a planet.
  const half = new StandingPeople();
  half.adopt([row(), row({ cell: 4235585, room: null }), row({ cell: 4235586, room: 2 })]);
  ok(half.last.rows === 2, 'and one indoors whose room was never resolved is refused rather than stood in a field');
  half.adopt(null);
  ok(!half.ready, 'a pack with no rows at all leaves nothing standing');
}

// ------------------------------------------------------------------ standing, keeping, dropping
{
  const p = new StandingPeople();
  p.adopt(Array.from({ length: 12 }, (_, i) => row({ who: `p${i}`, x: i * 4 })));
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);

  p.step(1, 1, at, deps);
  ok(p.last.stood > 0 && p.last.stood <= PEOPLE_TUNE.perPass, `a pass stands ${p.last.stood}, never more than ${PEOPLE_TUNE.perPass}`);
  for (let i = 0; i < 8; i++) p.step(PEOPLE_TUNE.everySeconds + 0.1, 5 + i * 2, at, deps);
  ok(p.last.up > PEOPLE_TUNE.perPass, `over a few passes ${p.last.up} of them are up`);
  ok(p.last.up <= PEOPLE_TUNE.most, `and never more than ${PEOPLE_TUNE.most} at once`);

  const settled = p.last.up;
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 40, at, deps);
  ok(p.last.stood === 0 && p.last.up === settled, 'standing still stands nobody new, so nothing churns');

  p.step(PEOPLE_TUNE.everySeconds + 0.1, 50, new THREE.Vector3(9000, 0, 9000), deps);
  ok(p.last.up === 0 && bodies.every((b) => b.removed), 'walking away puts every one of them down');
}

// ------------------------------------------------------------------ indoors is a different thing
{
  const p = new StandingPeople();
  p.adopt([row({ who: 'barman', cell: 4235585, room: 1, x: 10, y: 24.5, z: 10 })]);
  let built = false;
  const { deps, bodies } = game({ cellReady: () => built });
  const at = new THREE.Vector3(10, 0, 10);

  p.step(1, 1, at, deps);
  ok(bodies.length === 0 && p.last.waiting === 1, 'somebody in a room is not stood until that building is really built, or they fall through its floor');

  built = true;
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 5, at, deps);
  ok(bodies.length === 1, 'and is stood once it is');
  ok(bodies[0].inside === true, 'stood as inside, which is what the ground check and the colliders follow');
  ok(bodies[0].y === 24.5, "and at the height the converter carried out of that room's own frame, not the terrain under the building");

  // Outdoors the height is the manager's to find, for the reason the wildlife learned the hard way.
  const out = new StandingPeople();
  out.adopt([row({ x: 3, z: 3 })]);
  const g2 = game();
  out.step(1, 1, new THREE.Vector3(3, 0, 3), g2.deps);
  ok(g2.bodies.length === 1 && g2.bodies[0].y === undefined, 'while outdoors no height is given at all, so the manager finds whatever is standing on that ground');
}

// ------------------------------------------------------------------ killed, and back on the server's own clock
{
  const p = new StandingPeople();
  p.adopt([row({ respawn: 300 })]);
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);
  p.step(1, 1, at, deps);
  ok(bodies.length === 1, 'one stood');

  bodies[0].dead = true;
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 10, at, deps);
  ok(bodies.length === 1, 'killed, and not stood again at once');
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 200, at, deps);
  ok(bodies.length === 1, 'nor a moment before its own wait is out');
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 320, at, deps);
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 322, at, deps);
  ok(bodies.length === 2, "and stood again once it is, on the row's own respawn rather than a number of ours");
}

// ------------------------------------------------------------------ the world holding still
{
  const p = new StandingPeople();
  p.adopt([row()]);
  let holding = true;
  const { deps, bodies } = game({ held: () => holding });
  p.step(10, 10, new THREE.Vector3(0, 0, 0), deps);
  ok(bodies.length === 0, 'a world holding still stands nobody');
  holding = false;
  p.step(10, 20, new THREE.Vector3(0, 0, 0), deps);
  ok(bodies.length === 1, 'and picks up when the hold comes off');
}

// ------------------------------------------------------------------ a real town, where converted
{
  const f = join('assets-private', 'tatooine', 'spawns.json');
  if (!existsSync(f)) {
    note('no converted pack here, so the rules above stand on their own');
  } else {
    const pack = JSON.parse(readFileSync(f, 'utf8')) as { statics: StandingRow[] };
    const p = new StandingPeople();
    p.adopt(pack.statics);
    const indoors = pack.statics.filter((r) => r.cell).length;
    note(`a real world carries ${pack.statics.length} people, ${indoors} of them indoors; ${p.last.rows} are standable`);
    ok(p.last.rows > 100, 'which is a world with people in it');

    // Stand the densest place on the planet and see what it costs.
    let best = { x: 0, z: 0, n: 0 };
    for (const r of pack.statics) {
      let n = 0;
      for (const o of pack.statics) if (Math.hypot(o.x - r.x, o.z - r.z) < PEOPLE_TUNE.build) n++;
      if (n > best.n) best = { x: r.x, z: r.z, n };
    }
    note(`the busiest spot has ${best.n} people within ${PEOPLE_TUNE.build} m of it`);
    const { deps, bodies } = game({ cellReady: () => true });
    const at = new THREE.Vector3(best.x, 0, best.z);
    for (let i = 0; i < 30; i++) p.step(PEOPLE_TUNE.everySeconds + 0.1, i * 2, at, deps);
    note(`standing in it put ${p.last.up} up (${p.last.indoors} of them indoors) from ${bodies.length} stood in all`);
    ok(p.last.up <= PEOPLE_TUNE.most, `and never more than ${PEOPLE_TUNE.most} at once, however crowded the place is`);
    ok(p.last.up > 0, 'with somebody really standing there');
  }
}

console.log(`\n${passed} checks passed`);
