// The owner's own people (Map-maker II's twelfth wave; Map-maker I §2.10 and §8's `placedPeople`):
// `public/placements/people/<world>.json`, read as every reader reads it (`src/story/placedPeople.ts`), written by the
// batch as a kind of its own, and stood by the very standing people the data's rows are stood by, after everybody else
// (`standingList`) and by their own ids (`stoodName`'s `stood:<world>:p<11 hex>`), so no other row's name moves; taken
// again at a landing by difference (`StandingPeople.replacePlaced`), and adopted on a world with no rows of its own (his own
// worlds), about the frame the world's rows are written in.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PEOPLE_LIMITS, PLACED_RESPAWN, castSnippet, isPersonId, mintPersonId, peopleFileText, placedStandingRow, readPeopleFile, readPersonRow, type PlacedPersonRow } from '../../../src/story/placedPeople.ts';
import { StandingPeople, placedHex, sourceOfRow, stoodName, type PeopleDeps, type PersonSpawn, type StandingRow } from '../../../src/world/standingPeople.ts';
import { standingList } from '../../../src/world/ngeOverlay.ts';
import { applyPlacementOp, type PlacementCtx } from '../../../src/world/placementEdits.ts';
import { PLANETS, packIdOf } from '../../../src/data/planets.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const W = 'tatooine';
const person = (id: string, x: number, z: number, extra: Partial<PlacedPersonRow> = {}): PlacedPersonRow => ({ id, body: 'human_male', x, y: 5, z, heading: 90, ...extra });

// ---- the file ---------------------------------------------------------------------------------------------------------------
{
  ok(mintPersonId('Kael the Smuggler', new Set()) === 'kael-the-smuggler-1' && mintPersonId('Kael', new Set(['kael-1'])) === 'kael-2' && mintPersonId('', new Set()) === 'person-1', "an id minted from a name, numbered from 1");
  ok(isPersonId('kael-1') && !isPersonId('Kael') && !isPersonId('-x') && !isPersonId('a'.repeat(65)), 'an id is a-z, 0-9, _ and -, 64 at most');
  const rows = [person('kael-1', 3500, -4700, { mood: 'npc_sitting_chair', still: true, peaceful: true, respawn: 0, name: 'Kael' }), person('guard-1', 3510, -4710, { who: 'tatooine_militia', roam: 6, route: [{ x: 3510, y: 5, z: -4710 }, { x: 3530, y: 5, z: -4710, linger: true }] })];
  const text = peopleFileText(W, 'raw', rows);
  const read = readPeopleFile(text, W, 'ground');
  ok(read.problem === null && read.rows.length === 2 && read.skipped.length === 0, 'a file of two people reads whole');
  ok(peopleFileText(W, 'raw', read.rows as never[]) === text, 'and written again from what it read is the same text');
  ok(typeof readPersonRow({ id: 'x-1', x: 0, y: 0, z: 0, heading: 0 }) === 'string' && typeof readPersonRow({ id: 'x-1', body: 'b', x: 'a', y: 0, z: 0, heading: 0 }) === 'string', 'a row with no body, or a place that is no number, is refused');
  ok(readPeopleFile(text, 'naboo', 'ground').problem !== null && readPeopleFile(text, W, 'space').problem !== null, "another world's file, or the wrong frame, is refused whole");
  // As the standing people read a row.
  const kael = read.rows.find((r) => r.id === 'kael-1')!;
  const guard = read.rows.find((r) => r.id === 'guard-1')!;
  const s = placedStandingRow(kael);
  ok(s.src === 'placed' && s.key === 'kael-1' && s.id === 'human_male' && s.who === '' && Math.abs(s.heading - Math.PI / 2) < 1e-12 && s.respawn === 0 && s.still === true && s.mood === 'npc_sitting_chair' && s.cell === 0, "a placed person as a standing row: its body, no creature of its own, its heading in radians, its own key, src 'placed'");
  const g = placedStandingRow(guard);
  ok(g.respawn === PLACED_RESPAWN && g.who === 'tatooine_militia' && g.route?.length === 2 && g.route[1].linger === true && g.roam === 6, 'with the row\'s own creature, round and roam, and the respawn of ours where it names none');
  ok(placedStandingRow(person('in-1', 0, 0, { room: 3 })).cell === 1, 'a person in a room says so (any number past nought is indoors)');
  const snip = JSON.parse(castSnippet(kael, W));
  ok(snip.world === W && snip.f === 'raw' && snip.at.join() === '3500,5,-4700' && snip.heading === 90 && snip.mood === 'npc_sitting_chair', "Copy as cast: the shape a story's cast file takes for its place");
  ok(PEOPLE_LIMITS.rows >= 1000, 'a file holds a world\'s worth of people');
}

// ---- the names ----------------------------------------------------------------------------------------------------------------
{
  ok(/^[0-9a-f]{11}$/.test(placedHex('kael-1')) && placedHex('kael-1') === placedHex('kael-1') && placedHex('kael-1') !== placedHex('kael-2'), 'eleven hex of its own id, the same in every browser, different for another id');
  ok(stoodName(W, { src: 'placed', key: 'kael-1' }, 5) === `stood:${W}:p${placedHex('kael-1')}` && stoodName(W, { src: 'placed', key: 'kael-1' }, 99) === stoodName(W, { src: 'placed', key: 'kael-1' }, 5), "a placed person goes by its own id, never its place in the list");
  ok(stoodName(W, { key: 'kael-1' }, 5) === `stood:${W}:5` && stoodName(W, { src: 'placed' }, 5) === `stood:${W}:5`, 'a row not his, or his with no key, goes by its place as every Core3 row does');
  let longest = '';
  for (const p of PLANETS) for (const id of [p.id, ...(p.zones ?? []).map((z) => packIdOf(p, z.id))]) if (id.length > longest.length) longest = id;
  const name = stoodName(longest, { src: 'placed', key: 'a'.repeat(64) }, 0);
  ok(name.length <= 48, `the name on the longest world (${longest}) is ${name.length} characters, inside the 48 the server takes`);
  ok(sourceOfRow({ src: 'placed' }) === 'placed', 'and the console counts it as his');
}

// ---- standing them --------------------------------------------------------------------------------------------------------------
interface Body {
  removed: boolean;
  dead?: boolean;
  pos: THREE.Vector3;
  heading: number;
  how: PersonSpawn;
}
function game(centre: { x: number; z: number } = { x: 0, z: 0 }, keeps?: (b: Body) => boolean): { deps: PeopleDeps; bodies: Body[] } {
  const bodies: Body[] = [];
  const deps: PeopleDeps = {
    catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }) as never,
    spawn: (_e, at, how) => {
      const b: Body = { removed: false, pos: new THREE.Vector3(at.x, at.y ?? 0, at.z), heading: at.heading ?? NaN, how };
      bodies.push(b);
      return b as never;
    },
    remove: (m) => {
      (m as unknown as Body).removed = true;
    },
    centre: () => centre,
    held: () => false,
    ...(keeps ? { keeps: (m) => keeps(m as unknown as Body) } : {}),
  };
  return { deps, bodies };
}
const row = (key: string, x: number, z: number): StandingRow => ({ key, who: `test_${key}`, id: `test_${key}_body`, x, y: 0, z, heading: 0, cell: 0, respawn: 300, where: 'test' });
{
  const own = [row('aaaaaaaaaaaa', 5, 5), row('bbbbbbbbbbbb', -10, 4)];
  const placed = [placedStandingRow(person('kael-1', 2, 2)), placedStandingRow(person('guard-1', -2, -3))] as unknown as StandingRow[];
  const list = standingList(own, [], [], [], placed);
  ok(list.length === 4 && list[0] === own[0] && list[1] === own[1] && list[2] === placed[0] && list[3] === placed[1], 'his people come after everybody else in the list, every other row keeping its place');
  const before = standingList(own, [], []);
  const none = standingList(own, [], [], [], []);
  ok(before.length === own.length && none.length === own.length && none.every((r, i) => r === before[i] && r === own[i]), 'with none the list is what it was, row for row (and cfa55f3\'s own, `peopleRemoved.test.ts`)');
  ok(standingList([], [], [], [], placed).length === 2, 'and on a world with no rows of its own (his own worlds), his people stand alone');
  const people = new StandingPeople();
  people.adopt(list, null, { world: W });
  const { deps, bodies } = game();
  people.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  const by = new Map(bodies.map((b) => [list[b.how.index].key, b]));
  ok(by.get('kael-1')?.how.id === `stood:${W}:p${placedHex('kael-1')}` && by.get('aaaaaaaaaaaa')?.how.id === `stood:${W}:0`, 'stood by the standing people, his under their own names, the data\'s by their places');
  ok(Math.abs(by.get('kael-1')!.pos.x - -2) < 1e-9 && Math.abs(by.get('kael-1')!.pos.z - 2) < 1e-9, "carried into the world's frame as every row is (x mirrored about the centre)");
  const names0 = new Map(bodies.map((b) => [list[b.how.index].key, b.how.id]));
  // A landing: one of his taken out, one moved, one added; nobody else's name moves and nobody else is touched.
  const next = [placedStandingRow(person('guard-1', 20, 20)), placedStandingRow(person('trader-1', 1, -1))] as unknown as StandingRow[];
  const down = people.replacePlaced(next, deps, null, W);
  ok(down === 2 && by.get('kael-1')!.removed && by.get('guard-1')!.removed && !by.get('aaaaaaaaaaaa')!.removed, "a landing puts his bodies down and leaves everybody else's standing");
  people.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  const fresh = bodies.filter((b) => !b.removed);
  const freshNames = new Map(fresh.map((b) => [b.how.id, b]));
  ok(freshNames.has(`stood:${W}:p${placedHex('trader-1')}`) && freshNames.has(`stood:${W}:p${placedHex('guard-1')}`) && !freshNames.has(`stood:${W}:p${placedHex('kael-1')}`), 'the next pass stands the new rows under their own names, the one taken out stands no more');
  ok(freshNames.get(`stood:${W}:p${placedHex('guard-1')}`)!.pos.x === -20, 'the one moved stands where it was moved to, carried as the rest');
  ok(names0.get('aaaaaaaaaaaa') === `stood:${W}:0` && fresh.some((b) => b.how.id === `stood:${W}:0`) && fresh.some((b) => b.how.id === `stood:${W}:1`), "and the data's rows keep their names and their bodies");
  ok(people.bySource().rows.placed === 2, 'the console counts his two');
}
{
  // His own world, packless: no rows of its own until his first person is placed, adopted about the frame (0, 0).
  const people = new StandingPeople();
  people.adopt([], null, { world: 'monument' });
  const { deps, bodies } = game({ x: 0, z: 0 });
  people.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  ok(bodies.length === 0, 'a world of his with nobody placed stands nobody');
  people.replacePlaced([placedStandingRow(person('hermit-1', 12, -4))] as unknown as StandingRow[], deps, null, 'monument');
  people.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  ok(bodies.length === 1 && bodies[0].how.id === `stood:monument:p${placedHex('hermit-1')}` && bodies[0].pos.x === -12 && bodies[0].pos.z === -4, 'his first person placed is adopted afresh and stood about the frame (0, 0)');
}
{
  // A world whose layout centre is not the origin (Tatooine's own sits kilometres off it): a person placed live is carried
  // about that centre, exactly where the same row adopted at an arrival stands, its heading turned with the mirror.
  const C = { x: 3500, z: -4800 };
  const own = [row('aaaaaaaaaaaa', 3505, -4795)];
  const hers = person('kael-1', 3512.5, -4790.25, { heading: 30 });
  const live = new StandingPeople();
  live.adopt(standingList(own, [], [], [], []), null, { world: W });
  const a = game(C);
  live.step(0, 0, new THREE.Vector3(-5, 0, 5), a.deps, true);
  ok(a.bodies.length === 1, 'the data\'s row stands about its centre first');
  live.replacePlaced([placedStandingRow(hers)] as unknown as StandingRow[], a.deps, null, W);
  live.step(0, 0, new THREE.Vector3(-5, 0, 5), a.deps, true);
  const placedLive = a.bodies.find((b) => b.how.id === `stood:${W}:p${placedHex('kael-1')}`);
  const arrival = new StandingPeople();
  arrival.adopt(standingList(own, [], [], [], [placedStandingRow(hers)] as unknown as StandingRow[]), null, { world: W });
  const b = game(C);
  arrival.step(0, 0, new THREE.Vector3(-5, 0, 5), b.deps, true);
  const placedArrival = b.bodies.find((x) => x.how.id === `stood:${W}:p${placedHex('kael-1')}`);
  ok(!!placedLive && Math.abs(placedLive.pos.x - -(hers.x - C.x)) < 1e-9 && Math.abs(placedLive.pos.z - (hers.z - C.z)) < 1e-9, `placed live it stands where its raw place falls about the layout's centre (${placedLive?.pos.x.toFixed(2)}, ${placedLive?.pos.z.toFixed(2)})`);
  ok(!!placedLive && !!placedArrival && placedLive.pos.distanceTo(placedArrival.pos) < 1e-9 && placedLive.heading === placedArrival.heading, 'and exactly where, and facing as, the same row adopted at an arrival stands');
  ok(!!placedLive && Math.abs(placedLive.heading - -(hers.heading * Math.PI) / 180) < 1e-9, 'its heading turned with the mirror, as every row\'s is');
}
{
  // A follower stands for one of his people (`keeps`): a landing that takes the person ahead of it out moves its index; the
  // body goes on under its own person's new index, never standing for another, and its person taken out it is an orphan
  // put down once nobody has it.
  let following: Body | null = null;
  const { deps, bodies } = game({ x: 0, z: 0 }, (b) => b === following);
  const people = new StandingPeople();
  const list = standingList([row('aaaaaaaaaaaa', 5, 5)], [], [], [], [placedStandingRow(person('a-1', 2, 2)), placedStandingRow(person('b-1', -2, -3))] as unknown as StandingRow[]);
  people.adopt(list, null, { world: W });
  people.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  following = bodies.find((b) => b.how.id === `stood:${W}:p${placedHex('b-1')}`) ?? null;
  ok(!!following, 'b-1 stands, and is following');
  people.replacePlaced([placedStandingRow(person('b-1', -2, -3))] as unknown as StandingRow[], deps, null, W);
  people.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  const forB = bodies.filter((b) => b.how.id === `stood:${W}:p${placedHex('b-1')}`);
  ok(!following!.removed && forB.length === 1 && people.bodyOfKey('b-1') === (following as never), 'a-1 taken out: the follower goes on as b-1 under its new place in the list, and no second b-1 is stood');
  people.replacePlaced([placedStandingRow(person('c-1', 1, 1))] as unknown as StandingRow[], deps, null, W);
  people.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  ok(!following!.removed && people.bodyOfKey('b-1') === null, 'b-1 taken out while followed: its body is kept while somebody has it, standing for nobody');
  ok(bodies.some((b) => b.how.id === `stood:${W}:p${placedHex('c-1')}` && !b.removed), 'and the person in its old place in the list stands as itself');
  const keptBody = following!;
  following = null;
  people.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  ok(keptBody.removed, 'let go, the next pass puts it down');
  following = bodies.find((b) => b.how.id === `stood:${W}:p${placedHex('c-1')}` && !b.removed) ?? null;
  people.replacePlaced([], deps, null, W);
  people.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  ok(!!following && !following.removed, 'c-1 taken out while followed is kept as well');
  people.clear(deps);
  ok(bodies.every((b) => b.removed), 'and a clear puts every body down, an orphan somebody still has with the rest');
}

// ---- the batch writes it ------------------------------------------------------------------------------------------------------------
{
  const ctx = (): PlacementCtx => ({ worlds: new Map([[W, 'ground'], ['monument', 'ground'], ['dungeon1', 'copies']]), now: 1_800_000_000_000, hash: (t: string) => t.length.toString(16).padStart(12, '0') });
  const put = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'people', put: person('kael-1', 1, 2) }, { file: 'people', put: { body: 'human_female', x: 3, y: 0, z: 4, heading: 0 } }] }, { story: null, world: null }, ctx());
  ok(put.status === 200 && put.writes.length === 1 && put.writes[0].layer === 'people', 'the batch writes the people file');
  const rows = readPeopleFile(put.writes[0].text!, W, 'ground').rows;
  ok(rows.length === 2 && rows.some((r) => r.id === 'kael-1') && rows.some((r) => /^human-female-\d+$/.test(r.id)) && rows.every((r) => r.at === 1_800_000_000_000), 'a given id kept, one not given minted from its body, each stamped');
  ok(applyPlacementOp({ op: 'batch', world: 'monument', edits: [{ file: 'people', put: person('hermit-1', 0, 0) }] }, { story: null, world: null }, ctx()).status === 200, 'his own world takes them');
  ok(applyPlacementOp({ op: 'batch', world: 'dungeon1', edits: [{ file: 'people', put: person('x-1', 0, 0) }] }, { story: null, world: null }, ctx()).status === 409, "and the world of copies does not");
}

console.log(`\n${checks} checks passed`);
