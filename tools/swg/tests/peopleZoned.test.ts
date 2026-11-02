// The world's people kept out of a no-spawn zone (Map-maker II's twelfth wave; research5 §3.10's `peopleZoned`): a zone that
// keeps `people` makes dormant every row of the data's -- Core3's, the heralds', the NGE overlay's, the brigade's and his own
// placed people alike -- whose stand point is inside it, whose roam reaches in, or whose round crosses it, by the overlay's
// own rule (`rowKeptOff`); a zone keeping only `wild` or `ours` stands them; the zone is asked in the file's frame, the very
// frame the rows are written in; and **no-spawn, not no-enter**: nobody's body is barred from walking in.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StandingPeople, type PeopleDeps, type PersonSpawn, type StandingRow } from '../../../src/world/standingPeople.ts';
import { ZoneSet, rawOf, zonesOf } from '../../../src/world/noSpawnZones.ts';
import { placedStandingRow } from '../../../src/story/placedPeople.ts';
import type { RemovalRow } from '../../../src/story/removals.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const row = (key: string, x: number, z: number, extra: Partial<StandingRow> = {}): StandingRow => ({ key, who: `test_${key}`, id: `test_${key}_body`, x, y: 0, z, heading: 0, cell: 0, respawn: 300, where: 'test', ...extra });
const rows: StandingRow[] = [
  row('aaaaaaaaaaaa', 500, 500), // Core3's, inside
  row('bbbbbbbbbbbb', 500, 560, { from: 'herald', still: true, peaceful: true }), // a herald 60 m off: outside
  row('n00000000001', 540, 500, { src: 'nge', roam: 20 }), // the overlay's, roam reaching in
  row('cccccccccccc', 300, 300, { route: [{ x: 300, y: 0, z: 300 }, { x: 505, y: 0, z: 505 }] }), // a patroller crossing it
  row('dddddddddddd', 520, 480, { src: 'ours', state: 'restuss=ruins' }), // the brigade's, inside
  placedStandingRow({ id: 'kael-1', body: 'human_male', x: 495, y: 0, z: 510, heading: 0 }) as unknown as StandingRow, // his own, inside
];
const zoneRows = (keeps?: RemovalRow['keeps']): RemovalRow[] => [{ id: 'z:square', shape: { kind: 'circle', c: [500, 500], r: 30 }, ...(keeps ? { keeps } : {}) }];
const codes = (keeps?: RemovalRow['keeps']): string => {
  const set = new ZoneSet(zonesOf(zoneRows(keeps)));
  return rows.map((r) => (set.rowZone(r) >= 0 ? 1 : 0)).join('');
};
ok(codes() === '101111', `a zone keeping all three zones Core3's, the overlay's roaming, the patroller crossing it, the brigade's and his own, and not the herald 60 m off (${codes()})`);
ok(codes(['people']) === '101111' && codes(['wild']) === '000000' && codes(['ours']) === '000000' && codes(['wild', 'ours']) === '000000', "only a zone that keeps the people zones them");

interface Body {
  removed: boolean;
  how: PersonSpawn;
}
const stand = (keeps?: RemovalRow['keeps']): Set<string> => {
  const set = new ZoneSet(zonesOf(zoneRows(keeps)));
  const people = new StandingPeople();
  people.adopt(rows, null, { world: 'test_world', removed: (r) => (set.rowZone(r) >= 0 ? 1 : 0) });
  const bodies: Body[] = [];
  const deps: PeopleDeps = {
    catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }) as never,
    spawn: (_e, _at, how) => {
      const b: Body = { removed: false, how };
      bodies.push(b);
      return b as never;
    },
    remove: (m) => {
      (m as unknown as Body).removed = true;
    },
    centre: () => ({ x: 0, z: 0 }),
    held: () => false,
  };
  people.step(0, 0, new THREE.Vector3(-500, 0, 500), deps, true);
  return new Set(bodies.filter((b) => !b.removed).map((b) => rows[b.how.index].key!));
};
const zoned = stand();
const kept = stand(['wild']);
ok(zoned.has('bbbbbbbbbbbb') && !zoned.has('aaaaaaaaaaaa') && !zoned.has('n00000000001') && !zoned.has('cccccccccccc') && !zoned.has('kael-1'), `stood, the zone keeps them out and the herald stands (${[...zoned].join(', ')})`);
ok(kept.has('aaaaaaaaaaaa') && kept.has('kael-1') && kept.has('n00000000001'), 'a zone keeping only the wildlife stands them all');
// The frame: a zone written about the layout's centre is asked of a point of the game's carried back.
const centre = { x: 3000, z: -4000 };
const raw = rawOf(-500 + 3000 - 3000, 500 - 4000 + 4000, { x: 0, z: 0 });
ok(raw.x === 500 && raw.z === 500, "a point of the game's frame carried into the file's (x mirrored about the centre)");
const g = rawOf(centre.x - 500, 500 - centre.z, centre);
ok(g.x === 500 && g.z === 500 && new ZoneSet(zonesOf(zoneRows())).oursZone(g.x, g.z) === 0, "and the people of ours ask the zone there, about the world's own centre");

console.log(`\n${checks} checks passed`);
