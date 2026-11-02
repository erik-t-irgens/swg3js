// The world's people taken away by the removal file (Map-maker II's twelfth wave; Map-maker I §2.9 and §8's `peopleRemoved`):
// a row made dormant by its key, by a no-spawn zone keeping `people`, or by standing in a hidden building's rooms -- **never
// taken off the list**, so every other row's `stood:` name is the one it had (`StandingPeople`'s `removed`, decided at
// `adopt` and again at every `restrike`); a person taken away by key still counts as standing for the people of ours
// (`anyStanding`: their building stays the data's), one zoned or in a hidden building does not; a body standing for a row now
// dormant is put down, never one a follower keeps; and a row given back is stood by the next pass under its old name.
//
// Day one: with no removal file (`removed` null) every row stands and every name is the one it was, held against the very
// adopt with the extra left out, and against cfa55f3's own people and list out of git (else the hash of their trace).
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StandingPeople, type PeopleDeps, type PersonSpawn, type StandingRow } from '../../../src/world/standingPeople.ts';
import { ZoneSet, zonesOf } from '../../../src/world/noSpawnZones.ts';
import { HiddenPlaces } from '../../../src/world/hiddenPlaces.ts';
import type { RemovalRow } from '../../../src/story/removals.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

interface Body {
  removed: boolean;
  pos: THREE.Vector3;
  how: PersonSpawn;
}
function game(keepers: Set<Body> = new Set()): { deps: PeopleDeps; bodies: Body[] } {
  const bodies: Body[] = [];
  const deps: PeopleDeps = {
    catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }) as never,
    spawn: (_e, at, how) => {
      const b: Body = { removed: false, pos: new THREE.Vector3(at.x, at.y ?? 0, at.z), how };
      bodies.push(b);
      return b as never;
    },
    remove: (m) => {
      (m as unknown as Body).removed = true;
    },
    centre: () => ({ x: 0, z: 0 }),
    held: () => false,
    keeps: (m) => keepers.has(m as unknown as Body),
  };
  return { deps, bodies };
}
const row = (key: string, x: number, z: number, extra: Partial<StandingRow> = {}): StandingRow => ({ key, who: `test_${key}`, id: `test_${key}_body`, x, y: 0, z, heading: 0, cell: 0, respawn: 300, where: 'test', ...extra });
const rows: StandingRow[] = [
  row('aaaaaaaaaaaa', 5, 5),
  row('bbbbbbbbbbbb', -10, 4),
  row('cccccccccccc', 40, 40),
  row('dddddddddddd', 42, 38, { roam: 4 }),
  row('eeeeeeeeeeee', 100, 100, { cell: 1, room: 1 }),
  row('ffffffffffff', -60, 0, { route: [{ x: -60, y: 0, z: 0 }, { x: 41, y: 0, z: 40 }] }),
];
const W = 'test_world';
const at0 = new THREE.Vector3(0, 0, 0);
const up = (bodies: Body[]) => new Map(bodies.filter((b) => !b.removed).map((b) => [rows[b.how.index].key!, b.how.id]));

// ---- day one ------------------------------------------------------------------------------------------------------------------
const plain = (() => {
  const people = new StandingPeople();
  people.adopt(rows, null, { world: W });
  const g = game();
  people.step(0, 0, at0, g.deps, true);
  return up(g.bodies);
})();
{
  const people = new StandingPeople();
  people.adopt(rows, null, { world: W, removed: null });
  const g = game();
  people.step(0, 0, at0, g.deps, true);
  const names = up(g.bodies);
  ok(names.size === plain.size && plain.size >= 5 && [...plain].every(([k, id]) => names.get(k) === id), `with no removal file every row stands under the name it had (${names.size})`);
  ok([...people.removalCodes()].every((c) => c === 0) && people.dormantReport().removed === 0 && people.dormantReport().zoned === 0, 'and nothing is counted taken away');
}
{
  // Held against cfa55f3's own people and list out of git: rows of every source (Core3's, SOE's overlay, ours in a state, a
  // herald, one in a room, a patroller), adopted and stood by that commit's `StandingPeople` and listed by its
  // `standingList`, against today's with no removal file and no placed people -- every body's name, index, place and facing.
  const { loadOldMany } = await import('./oldModules.ts');
  const { standingList } = await import('../../../src/world/ngeOverlay.ts');
  const OLD = 'cfa55f3';
  const old = await loadOldMany(['src/world/standingPeople.ts', 'src/world/ngeOverlay.ts'], ['src/world/standingPeople.ts', 'src/world/ngeOverlay.ts'], OLD);
  const own = [rows[0], rows[1], rows[4], rows[5]];
  const heralds = [row('hhhhhhhhhhhh', 8, -6, { from: 'herald' })];
  const overlay = [row('nge:k-0001', 12, 3, { src: 'nge' }), row('nge:k-0002', -4, 9, { src: 'nge', roam: 3 })];
  const ours = [row('ours0001', 3, -3, { ours: true, state: 'restuss=ruins' } as Partial<StandingRow>)];
  /** Every body stood: its name, its index in the list, its place and its facing, in the order stood. */
  type Stood = { id: string; index: number; x: number; z: number; h: number };
  const stand = (People: new () => { adopt(r: unknown, c: unknown, e: unknown): void; step(dt: number, now: number, at: THREE.Vector3, deps: unknown, force: boolean): void }, list: readonly StandingRow[]): Stood[] => {
    const out: Stood[] = [];
    const people = new People();
    people.adopt(list, null, { world: W });
    const deps = { ...game().deps, spawn: (_e: unknown, a: { x: number; z: number; heading?: number }, how: PersonSpawn) => (out.push({ id: how.id, index: how.index, x: a.x, z: a.z, h: a.heading ?? NaN }), { removed: false, pos: new THREE.Vector3(a.x, 0, a.z), how }) };
    people.step(0, 0, at0, deps, true);
    return out;
  };
  const listNow = standingList(own, heralds, overlay, ours) as StandingRow[];
  const standNow = JSON.stringify(stand(StandingPeople, listNow));
  /** What cfa55f3 stood over those rows, as its own trace's hash (a checkout git cannot hand the commit over is held to it). */
  const OLD_PEOPLE = '23b6bb5911eb0febb431fae58c2594f96da739ba';
  const { createHash } = await import('node:crypto');
  const sha = createHash('sha1').update(standNow).digest('hex');
  if (!old) ok(sha === OLD_PEOPLE, `git cannot hand ${OLD}'s people over: the bodies stood hash to its own trace, written in (${sha})`);
  else {
    const [oldPeople, oldList] = old as [{ StandingPeople: never }, { standingList: (a: unknown, b: unknown, c: unknown, d?: unknown) => StandingRow[] }];
    const listThen = oldList.standingList(own, heralds, overlay, ours);
    ok(listThen.length === listNow.length && listThen.every((r, i) => r === listNow[i]), `${OLD}'s list of every source is today's, row for row, with no placed people (${listNow.length} rows)`);
    const standThen = JSON.stringify(stand(oldPeople.StandingPeople, listThen));
    ok(standThen === standNow && standNow.length > 10, `and its people stand every body under the very name, index, place and facing today's do (${JSON.parse(standNow).length} bodies)`);
    ok(createHash('sha1').update(standThen).digest('hex') === OLD_PEOPLE, `and the hash written in here is ${OLD}'s own trace (${createHash('sha1').update(standThen).digest('hex')})`);
  }
}

// ---- by key, by zone, by a hidden building ------------------------------------------------------------------------------------
const zoneRows: RemovalRow[] = [{ id: 'z:clear', shape: { kind: 'circle', c: [40, 40], r: 3 } }];
const zones = new ZoneSet(zonesOf(zoneRows));
const hidden = new HiddenPlaces([{ template: 'object/building/test.iff', x: 100, y: 0, z: 100, contained: false, q: null, box: { min: [-10, -2, -10], max: [10, 8, 10] } }]);
const removedKeys = new Set(['bbbbbbbbbbbb']);
const removedFn = (r: StandingRow): 0 | 1 | 2 => {
  if (r.key && removedKeys.has(r.key)) return 2;
  if (zones.rowZone(r) >= 0) return 1;
  if (hidden.personInside(r, 0.5)) return 1;
  return 0;
};
{
  const people = new StandingPeople();
  people.adopt(rows, null, { world: W, removed: removedFn });
  const g = game();
  people.step(0, 0, at0, g.deps, true);
  const names = up(g.bodies);
  const codes = people.removalCodes();
  ok(codes.join() === '0,2,1,1,1,1', `taken away: the person by key (2), the one in the zone (1), the one whose roam reaches into it, the one in the hidden building's rooms and the patroller whose round crosses it (${codes.join()})`);
  ok(names.size === 1 && names.get('aaaaaaaaaaaa') === plain.get('aaaaaaaaaaaa'), 'only the one left stands, under the very name it had: no row left the list');
  const rep = people.dormantReport();
  ok(rep.removed === 1 && rep.zoned === 4, `the console counts one taken away by key and four by a zone or a hidden building (${JSON.stringify(rep)})`);
  // The people of ours ask whether a building has anybody of the data's: a person taken away by key still counts.
  const all = () => true;
  ok(people.anyStanding(10, 4, 2, all), "a person taken away by key still counts as standing for the people of ours (their building stays the data's)");
  ok(!people.anyStanding(-40, 40, 2, all), "one zoned does not");
}

// ---- landed live --------------------------------------------------------------------------------------------------------------
{
  const people = new StandingPeople();
  people.adopt(rows, null, { world: W });
  const keep = new Set<Body>();
  const g = game(keep);
  people.step(0, 0, at0, g.deps, true);
  const byKey = new Map(g.bodies.map((b) => [rows[b.how.index].key!, b]));
  // A follower keeps one of them: it goes on with its row.
  keep.add(byKey.get('cccccccccccc')!);
  const down = people.restrike(removedFn, g.deps);
  ok(down === 3 && byKey.get('bbbbbbbbbbbb')!.removed && byKey.get('dddddddddddd')!.removed && byKey.get('ffffffffffff')!.removed && !byKey.get('aaaaaaaaaaaa')!.removed, `a landing puts down the bodies of the rows now taken away (${down})`);
  ok(!byKey.get('cccccccccccc')!.removed, 'never one a follower keeps');
  const before = g.bodies.length;
  people.step(0, 0, at0, g.deps, true);
  ok(g.bodies.length === before, 'and the next pass stands none of them again');
  keep.clear();
  people.step(0, 0, at0, g.deps, true);
  ok(byKey.get('cccccccccccc')!.removed, "the follower's let go, its row taken away: put down");
  // Given back: the file's rows taken out.
  people.restrike(null, g.deps);
  people.step(0, 0, at0, g.deps, true);
  const names = up(g.bodies);
  ok(names.size === plain.size && [...plain].every(([k, id]) => names.get(k) === id), 'given back, every row stands again under the name it had');
  ok([...people.removalCodes()].every((c) => c === 0), 'and nothing is counted taken away');
}

// ---- a world state's dormancy is kept apart -------------------------------------------------------------------------------------
{
  const people = new StandingPeople();
  people.adopt(rows, null, { world: W, dormant: (r) => r.key === 'aaaaaaaaaaaa' });
  const g = game();
  people.restrike(() => 0, g.deps);
  people.step(0, 0, at0, g.deps, true);
  ok(!up(g.bodies).has('aaaaaaaaaaaa'), "a restrike that takes nothing away leaves a row of the other world state dormant");
  ok(people.dormantReport().removed === 0 && people.dormantReport().zoned === 0 && people.dormantReport().dormant === 1, 'and counts it as the state\'s, not the file\'s');
}

console.log(`\n${checks} checks passed`);
