// The race drawer's second wave: the world's life is kept off a drawn course's road plus its track's `clear` (DESIGN.md §2.7)
// by the removal file's own no-spawn zones (`noSpawnZones.ts`'s `courseZones`): the road cut into pieces along its spine,
// each an outline keeping the wildlife, the people and the people of ours. The outlines hold the road plus its clear (a point
// well inside is in a zone, one well outside in none); a wild site whose footprint or herd meets the road is not laid and
// every other is the very site it was; a row whose stand point, roam or round meets it is not stood; a person of ours
// likewise; and with no course there is no zone, so the zone set and the sites are what they were. What the Course tool's
// notes count as kept away (`sitesKeptOffBy`, `rowsZonedBy`) is those very sites and rows, on a real wild world and people.
//
// Run: node tools/swg/tests/courseLife.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CourseCarve, CARVE_PIECE, type CarveTrack } from '../../../src/swg/terrain/courseCarve.ts';
import { ZoneSet, courseZones, sameCourseZones, wildAreasOf, zonesOf } from '../../../src/world/noSpawnZones.ts';
import { LAIR_TUNE, gridSites, touches, type GroupEntry, type SpawnArea } from '../../../src/world/mobiles/lairs.ts';
import { figureEight, node, track } from './carveFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const storeOf = (ts: CarveTrack[]): CourseCarve => {
  const s = new CourseCarve();
  s.set(ts);
  return s;
};

// A figure eight and a long straight sprint, each keeping 10 m clear past its road.
const tracks: CarveTrack[] = [{ ...figureEight('eight', 8), clear: 10 }, { ...track('run', 'sprint', [{ id: 'main', nodes: [node(-400, 300, 0, { w: 20, c: 'straight' }), node(400, 420, 0, { w: 20, c: 'straight' })] }]), clear: 10 }];
const store = storeOf(tracks);
const outlines = store.outlines();
const zones = courseZones(outlines);
const set = new ZoneSet(zones);

{
  ok(zones.length === outlines.length && zones.length > 10 && zones.every((z) => z.shape.kind === 'poly' && z.keeps.includes('wild') && z.keeps.includes('people') && z.keeps.includes('ours')), `the roads are ${zones.length} outlines, each keeping the wildlife, the people and the people of ours`);
  ok(zones.every((z, i) => z.id === outlines[i].id && /^the road of /.test(z.name)), 'each named for its road');
  // Well inside (the road plus its clear at the point and a metre round it) in a zone; well outside in none.
  let inside = 0;
  let missedIn = 0;
  let outside = 0;
  let caughtOut = 0;
  const robust = (x: number, z: number, v: boolean) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => store.roadAt(x + dx, z + dz, 0) === v);
  for (let z = -260; z <= 480; z += 3)
    for (let x = -420; x <= 420; x += 3) {
      if (robust(x, z, true)) {
        inside++;
        if (set.oursZone(x, z) < 0) missedIn++;
      } else if (robust(x, z, false)) {
        outside++;
        if (set.oursZone(x, z) >= 0) caughtOut++;
      }
    }
  ok(inside > 1000 && missedIn === 0, `every point well inside a road plus its clear is in a zone (${inside} points)`);
  ok(outside > 10000 && caughtOut === 0, `and none well outside every road is (${outside} points)`);
  // The pieces are CARVE_PIECE metres of spine.
  const runSpine = store.spines().find((s) => s.track === 'run')!.spine;
  const runPieces = outlines.filter((o) => o.id.split(':')[1] === 'run' && /^\d+$/.test(o.id.split(':')[3])).length;
  const caps = outlines.filter((o) => o.id.split(':')[1] === 'run' && /^(start|end)$/.test(o.id.split(':')[3])).length;
  const eightCaps = outlines.filter((o) => o.id.split(':')[1] === 'eight' && /^(start|end)$/.test(o.id.split(':')[3])).length;
  ok(runPieces === Math.ceil(runSpine.length / CARVE_PIECE) && caps === 2 && eightCaps === 0, `the sprint's ${runSpine.length.toFixed(0)} m are cut into ${runPieces} pieces of ${CARVE_PIECE} m with a round cap at each open end (the circuit none)`);
}

{
  // A road turning a sharp corner between two straights: the reach at the corner's outside is a disc about the node, which
  // neither leg's own strip holds, so the outlines carry a disc there (`join`); every point well inside is still in a zone.
  const kink = storeOf([{ ...track('kink', 'sprint', [{ id: 'main', nodes: [node(800, -500, 0, { w: 20, c: 'straight' }), node(1000, -500, 0, { w: 20, c: 'straight' }), node(1000, -300, 0, { w: 20, c: 'straight' })] }]), clear: 10 }]);
  const ks = new ZoneSet(courseZones(kink.outlines()));
  let inside = 0;
  let missed = 0;
  let wedge = 0;
  const robust = (x: number, z: number) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => kink.roadAt(x + dx, z + dz, 0));
  for (let z = -560; z <= -280; z += 2)
    for (let x = 780; x <= 1060; x += 2) {
      if (!robust(x, z)) continue;
      inside++;
      if (x > 1000 && z < -500) wedge++;
      if (ks.oursZone(x, z) < 0) missed++;
    }
  ok(inside > 1000 && wedge > 20 && missed === 0, `a sharp corner's outside is held too: every one of ${inside} points well inside the road plus its clear is in a zone, ${wedge} of them in the corner's outer wedge`);
}

{
  // The people's rows and the people of ours.
  ok(set.rowZone({ x: 0, z: 0 }) >= 0, 'a row standing at the crossing is not stood');
  ok(set.rowZone({ x: 0, z: 340 }) >= 0 && set.rowZone({ x: 0, z: 400 }) < 0, 'a row standing on the sprint is not stood, and one 40 m past it is');
  ok(set.rowZone({ x: 0, z: 400, roam: 30 }) >= 0, 'a row whose roam reaches the road is not stood');
  ok(set.rowZone({ x: 0, z: -230, route: [{ x: 150, z: -230 }, { x: 0, z: 0 }] }) >= 0 && set.rowZone({ x: 0, z: -230, route: [{ x: 150, z: -230 }] }) < 0, "a row a point of whose round is on the road is not stood, where its stand point and a round off it alone would be");
  ok(set.oursZone(0, 0) >= 0 && set.oursZone(0, 400) < 0 && set.oursZone(0, 400, 50) >= 0, 'a person of ours likewise, a reach about the point counted');
}

{
  // The wildlife's laying: a site whose footprint or herd meets a road is not laid, every other the very site it was.
  const W = 'test_world';
  const areas: SpawnArea[] = [{ name: 'test_area', shape: 'circle', x: 0, z: 0, r: 2500, groups: ['g'], cap: 0 }];
  const groups: Record<string, GroupEntry[]> = { g: [{ lair: 'small', weight: 3, count: 0, size: 10, limit: -1, minDiff: 1, maxDiff: 10 }, { lair: 'big', weight: 1, count: 0, size: 40, limit: -1, minDiff: 5, maxDiff: 20 }] };
  const plain = gridSites(W, areas, [], groups);
  const wild = wildAreasOf(zones);
  const laid = gridSites(W, areas, wild, groups);
  const byKey = new Map(plain.map((s) => [s.key, JSON.stringify(s)]));
  const reach = (s: { size: number }) => Math.max(0, s.size) / 2 + LAIR_TUNE.herdSpread;
  const meets = (s: { x: number; z: number; size: number }) => wild.some((z) => touches(z, s.x, s.z, reach(s)));
  const gone = plain.filter((s) => !laid.some((t) => t.key === s.key));
  ok(gone.length > 0 && gone.every(meets), `the ${gone.length} sites the roads take away each reached a road with their bodies`);
  ok(laid.every((s) => !meets(s) && byKey.get(s.key) === JSON.stringify(s)), `and the ${laid.length} laid reach none, each the very site it was`);
  // What the Course tool's notes say the road keeps away (`WildLife.sitesKeptOffBy`): exactly those sites, counted on a real
  // wild world laid without the roads' zones; and of the people (`StandingPeople.rowsZonedBy`), the rows the zones refuse.
  const { WildLife } = await import('../../../src/world/wildLife.ts');
  const w = new WildLife();
  w.adopt({ format: 1, planet: W, areas, noSpawn: [], statics: [] } as never, { format: 1, creatures: {}, lairs: {}, groups } as never);
  ok(w.sitesKeptOffBy(wild) === gone.length && w.sitesKeptOffBy([]) === 0, `the notes' count of wild sites the roads keep away is those ${gone.length} sites (${w.sitesKeptOffBy(wild)}), and none with no road`);
  // Five long roads across the area: among the sites they take are some whose middle stands off every road and whose herd
  // reaches one, which the count must take too.
  const many = storeOf([-2000, -1000, 0, 1000, 2000].map((z, k) => ({ ...track(`r${k}`, 'sprint', [{ id: 'main', nodes: [node(-2400, z, 0, { w: 20, c: 'straight' }), node(2400, z + 37, 0, { w: 20, c: 'straight' })] }]), clear: 10 })));
  const manyZones = courseZones(many.outlines());
  const manySet = new ZoneSet(manyZones);
  const manyWild = wildAreasOf(manyZones);
  const manyGone = plain.filter((s) => !gridSites(W, areas, manyWild, groups).some((t) => t.key === s.key));
  const herdOnly = manyGone.filter((s) => manySet.oursZone(s.x, s.z) < 0).length;
  ok(herdOnly > 0 && w.sitesKeptOffBy(manyWild) === manyGone.length, `five long roads keep ${manyGone.length} sites away, ${herdOnly} of them by their herd alone (their middles off every road), and the notes count every one (${w.sitesKeptOffBy(manyWild)})`);
  const { StandingPeople } = await import('../../../src/world/standingPeople.ts');
  const { readPersonRow, placedStandingRow } = await import('../../../src/story/placedPeople.ts');
  const person = (id: string, x: number, z: number) => placedStandingRow(readPersonRow({ id, body: 'human_male', x, y: 0, z, heading: 0 }) as never);
  const people = new StandingPeople();
  people.adopt([person('p-1', 0, 0), person('p-2', 0, 340), person('p-3', 0, 400), person('p-4', 900, 900)] as never, null, { world: W });
  ok(people.rowsZonedBy(set) === 2 && people.rowsZonedBy(new ZoneSet([])) === 0, `and of the people's posts, the two standing on a road (${people.rowsZonedBy(set)}), none with no road`);
  // No course: no zone, and the laying and the zone set are what they were.
  const none = storeOf([]);
  const nz = courseZones(none.outlines());
  ok(nz.length === 0 && new ZoneSet([...zonesOf([]), ...nz]).empty && gridSites(W, areas, wildAreasOf(nz), groups).every((s, i) => JSON.stringify(s) === JSON.stringify(plain[i])), 'with no course there is no zone: the zone set is empty and the laying is the one without');
}

{
  // The world's hand-overs, held as text: the zones joined after the removal file's own, landed through its path, and taken
  // away again with the course.
  const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/this\.courseZoneList = store && !store\.empty \? courseZones\(store\.outlines\(\)\) : \[\];/.test(world), 'a landing makes the zones again from the store, none where it is empty');
  ok(/this\.zoneSet = new ZoneSet\(this\.courseZoneList\.length \? \[\.\.\.zonesOf\(this\.removalRows\), \.\.\.this\.courseZoneList\] : zonesOf\(this\.removalRows\)\);/.test(world), "joined after the removal file's own, the set the removal file's alone where there is no course");
  ok(/this\.courseWork\.peopleDown \+= standingPeople\.restrike\(this\.personRemovedFn\(\), this\.peopleDeps\(\)\);\s*this\.courseWork\.sitesDown \+= wildLife\.setRemovals\(wildAreasOf\(this\.zoneSet\.zones\), this\.removals\.sites, true\);/.test(world), 'and landed as the removal file lands: the people struck again, the wildlife laid again, live');
  ok((world.match(/\.\.\.this\.courseZoneList/g) ?? []).length >= 2, "and the removal file's own landing keeps the courses' zones beside its own");
  // A landing whose roads did not move lands nothing again, while the set holds those very zones (one taken at an arrival
  // after the set was compiled is landed whole once): asked before the set is made again, the list kept as it was.
  const body = /private landCourseZones\(\): void \{\n([\s\S]*?)\n  \}\n/.exec(world)?.[1] ?? '';
  const skip = body.indexOf('if (sameCourseZones(before, this.courseZoneList) && this.zoneSet.zones.includes(before[before.length - 1])) {\n      this.courseZoneList = before;\n      return;\n    }');
  ok(skip > 0 && skip < body.indexOf('this.zoneSet = new ZoneSet(') && skip > body.indexOf('if (this.planet?.space) return;'), "a landing whose roads' zones are the ones in force lays the world's life again for nothing no more");
}

{
  // The zones of the same roads are the same zones (`sameCourseZones`): made again from the same tracks to the bit, never once
  // a node moved, a road's clear changed, a road was added or the tracks came in another order.
  const z = (ts: CarveTrack[]) => courseZones(storeOf(ts).outlines());
  const moved: CarveTrack = JSON.parse(JSON.stringify(tracks[1]));
  moved.course!.paths[0].nodes[1].x += 0.01;
  ok(sameCourseZones(z(tracks), z(JSON.parse(JSON.stringify(tracks)))) && sameCourseZones([], []), 'the same roads made again are the same zones, and none is none');
  ok(!sameCourseZones(z(tracks), z([tracks[0], moved])) && !sameCourseZones(z(tracks), z([tracks[0], { ...tracks[1], clear: 11 }])), 'a node moved a centimetre, or a road kept a metre further clear, is other zones');
  ok(!sameCourseZones(z(tracks), z([tracks[0]])) && !sameCourseZones(z(tracks), z([tracks[1], tracks[0]])) && !sameCourseZones(z([]), z(tracks)), 'a road taken out or added, or the roads in another order, is other zones');
  ok(!sameCourseZones(z([tracks[1]]), z([{ ...tracks[1], id: 'other' }])), "and the very road under another track's name is other zones (each is named for its track)");
}

console.log(`\ncourseLife: ${checks} checks passed`);
