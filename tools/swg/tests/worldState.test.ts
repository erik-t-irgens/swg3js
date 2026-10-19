// A world's states in the game (src/world/worldState.ts, src/world/restuss.ts), and what reads them.
//
// TEST layouts, rows and files only: a layout with state tags filed by the streamer's own rule keeps every `in`
// index right and files a thing in a room only with its building, and the real streamer over it files the other
// state nowhere while `objectsNear` answers over both; the ports in each state and `landingOn` answering alike in
// both; the circle skipping Core3's rows while every `stood:` name stays; the First Brigade of ours stable from run
// to run, every post outside its ruin, tagged ruins and in the raw frame; the people's list in its order; which state
// an arrival takes (the server's, then the setting, then the default) and what it waits on first; a permanent
// placement row with a state filed only in its state, one with a malformed state kept out with a note, and the
// editor writing `state` in its place in a row.
//
// Run: node tools/swg/tests/worldState.test.ts
import assert from 'node:assert/strict';
import { arrivalWait, cleanStates, fileByState, fileInState, forgetWorldStates, inState, localWorldState, releaseWorldStates, setLocalWorldState, setServerStates, stateNews, standsIn, stateNow, takeWorldStates, waitForHail, worldStateOf, worldStateSource, WORLD_STATES } from '../../../src/world/worldState.ts';
import { LIVING_TAG, RESTUSS_ROSTER_TUNE, RUINS_TAG, brigadeBodies, fittingDormant, inRestussCircle, personDormant, portsInState, rosterRows, ruinsOf, tuneRestussRoster, type RuinPlace } from '../../../src/world/restuss.ts';
import { RESTUSS_DIALS } from '../../../src/world/restussDials.ts';
import { allDials, movedLine } from '../../../src/ui/dials.ts';
import { landingOn } from '../../../src/world/shuttle.ts';
import { standingList } from '../../../src/world/ngeOverlay.ts';
import { StandingPeople, type PeopleDeps, type StandingRow } from '../../../src/world/standingPeople.ts';
import { PermanentLayer } from '../../../src/world/permanent.ts';
import { nextStateChoice, stateChoiceText } from '../../../src/world/permanentEdit.ts';
import { applyPlacementOp } from '../../../src/world/placementEdits.ts';
import { placementKey, placementsFileText, readPlacementRow, readPlacementsFile } from '../../../src/story/placements.ts';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GAMEPLAY } from '../../../src/ui/gameplayPage.ts';
import { DEFAULT_SETTINGS } from '../../../src/core/settings.ts';
import { CRATE, HALL, loadedOf, makeStreamer, boxGeo, type SnapshotObject } from './streamHarness.ts';
import { CHUNK_SIZE } from '../../../src/world/terrain.ts';
import { rowFromHouse, rowFromProp } from '../../../src/world/permanentEdit.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

/** A page's storage, stood in for: what `swg.world.<key>` is read out of. */
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
const BLOCK = { restuss: { values: ['living', 'ruins'], default: 'ruins', centre: { x: 5318, z: 5680 } } };
/** An arrival on Restuss's world standing it as `value`, through this browser's own setting. */
function arriveAs(value: 'living' | 'ruins'): void {
  forgetWorldStates();
  store.clear();
  setLocalWorldState('restuss', value);
  takeWorldStates(BLOCK);
}

// --- which state an arrival takes, and the tags --------------------------------------------------------------------
{
  forgetWorldStates();
  store.clear();
  ok(worldStateOf('restuss') === 'ruins' && worldStateSource('restuss') === 'default', 'with nobody having said, Restuss stands in ruins, its default');
  setLocalWorldState('restuss', 'ruins');
  ok(worldStateOf('restuss') === 'ruins' && worldStateSource('restuss') === 'setting' && localWorldState('restuss') === 'ruins' && store.get('swg.world.restuss') === 'ruins', "this browser's own setting is the next, and is kept");
  setServerStates({ restuss: 'living' });
  ok(worldStateOf('restuss') === 'living' && worldStateSource('restuss') === 'server', "the server's word comes first");
  setServerStates(null);
  ok(worldStateOf('restuss') === 'ruins', "and with the server's word gone the setting stands again");
  ok(!setLocalWorldState('restuss', 'rubble') && worldStateOf('restuss') === 'ruins', 'a value the key does not allow is refused');
  ok(cleanStates({ restuss: 'ruins', other: 'x', __proto__: { restuss: 'living' } })?.restuss === 'ruins' && cleanStates({ restuss: 'rubble' })?.restuss === undefined && cleanStates(undefined) === null && cleanStates('ruins') === null, "a server's states are cleaned to the keys and values this build knows");
  takeWorldStates(BLOCK);
  ok(stateNow('restuss') === 'ruins' && standsIn(RUINS_TAG) && !standsIn(LIVING_TAG) && standsIn(undefined) && standsIn('not a tag'), 'an arrival takes the state, and a tag stands only in it; untagged stands always');
  setServerStates({ restuss: 'living' });
  ok(stateNow('restuss') === 'ruins' && worldStateOf('restuss') === 'living', "the server's word in the middle of a world moves nothing until the next arrival");
  ok(stateNews('restuss', 'ruins', 'living', 'ruins')?.includes('when you next arrive on Rori') === true && stateNews('restuss', 'ruins', 'ruins', 'ruins') === null, 'and is said on the message line, unless the world already stands that way');
  releaseWorldStates();
  ok(stateNow('restuss') === 'living', 'between worlds a key reads what an arrival would take');
  ok(standsIn('unknownkey=whatever'), 'a tag of a key nobody knows stands');
  ok(JSON.stringify(WORLD_STATES.restuss.values) === '["living","ruins"]' && WORLD_STATES.restuss.default === 'ruins', 'Restuss is living or ruins, ruins by default (the owner\'s answer)');
}

// --- what an arrival waits on ---------------------------------------------------------------------------------------
{
  const base = { states: true, saved: true, mode: 'off', wanted: false, toCome: false };
  ok(arrivalWait({ ...base, states: false }) === 'none' && arrivalWait({ ...base, saved: false, wanted: true }) === 'none', 'nothing is waited on for a world with no states, or with no server address saved');
  ok(arrivalWait({ ...base, mode: 'server', wanted: true }) === 'none' && arrivalWait({ ...base, mode: 'relay', wanted: true }) === 'none', 'nor where this line has been answered');
  ok(arrivalWait({ ...base, toCome: true }) === 'peek', "a session's first world, whose line is made after its loading screen, looks at the saved server's hail on a line of its own");
  ok(arrivalWait({ ...base, wanted: true, mode: 'waiting' }) === 'wait' && arrivalWait({ ...base, wanted: true, mode: 'off' }) === 'wait', 'a line wanted and not yet answered is waited on');
  let polls = 0;
  const sleep = async (): Promise<void> => {
    polls++;
  };
  ok((await waitForHail(() => polls >= 3, 6000, sleep)) === true && polls === 3, 'the wait ends the moment the hail is heard');
  polls = 0;
  ok((await waitForHail(() => false, 1000, sleep, 100)) === false && polls === 10, 'and gives up at its wait');
}

// --- the streamer's filing, and the real streamer --------------------------------------------------------------------
{
  const objects = [
    { state: undefined, contained: false },
    { state: LIVING_TAG, contained: false },
    { state: undefined, contained: true, in: 1 },
    { state: RUINS_TAG, contained: false },
    { state: undefined, contained: false },
    { state: undefined, contained: true, in: 4 },
  ];
  arriveAs('ruins');
  const f = fileByState(objects);
  ok(f.dormant === 2 && f.placedAt[1] === -1 && f.placedAt[2] === -1, 'in the ruins the living building and the thing in its room lie dormant, the thing with its host whatever its own tag');
  ok(f.placedAt[0] === 0 && f.placedAt[3] === 1 && f.placedAt[4] === 2 && f.placedAt[5] === 3, 'everything else takes the next place in order');
  ok(f.host[5] === 2 && f.host[2] === -1, "and a room's thing names its building by its place in the streamer's list, not the layout's");
  arriveAs('living');
  const g = fileByState(objects);
  ok(g.dormant === 1 && g.placedAt[3] === -1 && g.host[2] === 1 && g.host[5] === 3, 'in the living city only the ruin lies dormant, and every index after it moves by one');
  ok(fileByState(objects, () => true).host[5] === 4, 'filed with every state standing, every index is the layout\'s own');

  // The real streamer over a world of the same shape, its pack the hall and the crate.
  const at = (x: number, z: number) => ({ x: -x, y: 0, z, q: [1, 0, 0, 0], radius: 40 });
  const layout = [
    { template: 'object/rock', model: 'rock', ...at(100, 100) },
    { template: 'object/hall', model: 'hall', ...at(200, 200), state: LIVING_TAG },
    { template: 'object/crate', model: 'crate', ...at(200, 200), contained: true, in: 1, cell: 1 },
    { template: 'object/ruin', model: 'rock', ...at(300, 300), state: RUINS_TAG },
    { template: 'object/hall', model: 'hall', ...at(400, 400) },
    { template: 'object/crate', model: 'crate', ...at(400, 400), contained: true, in: 4, cell: 1 },
  ] as unknown as SnapshotObject[];
  const room = (): THREE.Box3[] => [new THREE.Box3(new THREE.Vector3(-9, 0, -9), new THREE.Vector3(9, 7.5, 9))];
  const shell = () => [{ geometry: boxGeo(20, 8, 20, 0), cell: 0 }, { geometry: boxGeo(18, 0.3, 18, 0), cell: 1 }];
  const extra = { defs: [HALL], models: { hall: loadedOf(HALL, shell(), room()), crate: loadedOf(CRATE, [{ geometry: boxGeo(1, 1, 1, 0), cell: -1 }]) } };
  arriveAs('ruins');
  const ruins = await makeStreamer(layout, extra);
  const ro = ruins.stream.objects;
  ok(ro.length === 4 && ruins.stream.dormantCount === 2 && !ro.some((o) => o.template === 'object/hall' && o.x === 200), "in the ruins the real streamer files the living hall and its crate nowhere");
  ok(ro[3].contained && ro[3].hostIndex === 2 && ro[3].host === ro[2], "the other hall's crate is filed with its own hall, by the hall's place in the streamer's list");
  ok(ruins.stream.objectsNear(200, 200, 2).some((o) => o.model === 'hall'), "and `objectsNear` still answers the dormant hall, so a house is refused on the city's ground in the ruins too");
  arriveAs('living');
  const living = await makeStreamer(layout, extra);
  const lo = living.stream.objects;
  ok(lo.length === 5 && living.stream.dormantCount === 1 && lo[2].hostIndex === 1 && lo[2].host === lo[1], 'in the living city the hall stands and its crate is filed with it');
  ok(living.stream.objectsNear(300, 300, 2).some((o) => o.template === 'object/ruin'), 'and the dormant ruin is still asked of by the placing rules');
  ok(living.stream.statedCount === 1 && ruins.stream.statedCount === 1, 'one object of one state stands in each');
  // The flora is kept off what lies dormant as off what stands, so switching never shows a tree through a building.
  const cell = (v: number) => Math.floor(v / CHUNK_SIZE);
  const keptOff = (h: Awaited<ReturnType<typeof makeStreamer>>, x: number, z: number) => h.stream.exclusionsFor(cell(x), cell(z)).some((e) => e.x === x && e.z === z && e.r > 0);
  ok(keptOff(ruins, 200, 200) && keptOff(ruins, 400, 400) && keptOff(ruins, 300, 300), "in the ruins the dormant living hall's ground is kept clear of plants, beside what stands");
  ok(keptOff(living, 300, 300) && keptOff(living, 200, 200), "and in the living city the dormant ruin's");
  living.physics.world.free?.();
  ruins.physics.world.free?.();
}

// --- the ports, and where a ride lands ---------------------------------------------------------------------------
{
  const rows = [
    { name: 'Narmle Starport', x: 3672, z: -6421, kind: 'starport' },
    { name: 'Restuss Starport', x: 5364, z: 5752, kind: 'starport', state: LIVING_TAG },
    { name: 'Restuss Starport', x: 5281, z: 6171, kind: 'starport', state: RUINS_TAG },
    { name: 'Restuss Shuttleport', x: 5211, z: 5791, kind: 'shuttleport', state: LIVING_TAG },
    { name: 'Restuss Shuttleport', x: 5240, z: 6205, kind: 'shuttleport', state: RUINS_TAG },
    { name: 'Dreifa Shuttleport', x: 0, z: 0, kind: 'shuttleport' },
  ];
  for (const value of ['living', 'ruins'] as const) {
    arriveAs(value);
    const here = portsInState(rows, standsIn);
    const names = here.map((r) => r.name);
    ok(here.length === 4 && new Set(names).size === 4 && here.every((r) => !r.state || r.state === `restuss=${value}`), `${value}: one port of each name, Restuss's its own state's`);
    ok(landingOn(here)?.name === 'Narmle Starport', `${value}: a ride to Rori lands where it always did`);
    // The game's own filter (`inState`, every list it reads), held to the rows that should stand, by place.
    const want = value === 'living' ? [3672, 5364, 5211, 0] : [3672, 5281, 5240, 0];
    ok(JSON.stringify(inState(rows).map((r) => r.x)) === JSON.stringify(want), `${value}: the game's own filter leaves exactly the untagged ports and this state's own, in the file's order`);
  }
  arriveAs('ruins');
  const file = fileInState({ version: 4, rows: [{ kind: 'terminal' }, { kind: 'terminal', state: LIVING_TAG }] }) as { version: number; rows: unknown[] };
  ok(file.version === 4 && file.rows.length === 1, "a travel file's rows of the other state are left out, the rest of the file as it was");
  ok(fileInState(null) === null && fileInState({ pois: 1 }, 'pois') !== null, 'and anything that is no such file is handed back');
}

// --- Core3's town in the ruins, the brigade of ours, and the people's list -------------------------------------------
{
  const centre = { x: 10, z: 10 };
  const ruins = { centre, circle: 20 };
  ok(inRestussCircle(10, 25, centre, 20) && !inRestussCircle(10, 31, centre, 20), 'the circle is measured across the ground');
  ok(personDormant({ x: 12, z: 12 }, standsIn, ruins) && !personDormant({ x: 12, z: 12 }, standsIn, null), "Core3's own row inside the circle is skipped in the ruins only");
  ok(!personDormant({ x: 12, z: 12, from: 'herald' }, standsIn, ruins) && !personDormant({ x: 12, z: 12, ours: true }, standsIn, ruins) && !personDormant({ x: 12, z: 12, src: 'nge' }, standsIn, ruins), "a herald, one of ours and one of the overlay's are not Core3's");
  arriveAs('living');
  ok(personDormant({ x: 100, z: 100, state: RUINS_TAG, ours: true }, standsIn, null), 'and in the living city a row of the ruins is skipped wherever it stands');
  ok(fittingDormant({ building: 'server:rori', x: 12, z: 12 }, standsIn, ruins) && !fittingDormant({ building: 'server:rori', x: 500, z: 500 }, standsIn, ruins), "what the server stood on no building is skipped inside the circle and stands outside it");
  ok(!fittingDormant({ building: 'object/building/military/shared_outpost_cloning_facility.iff', x: 12, z: 12 }, standsIn, ruins), 'and a fitting on a building that stands in both states (the late camp\'s cloning facility, inside the circle) stands with it');
  ok(fittingDormant({ building: 'object/building/naboo/shared_bank_naboo.iff', x: 500, z: 500, state: RUINS_TAG }, standsIn, null) && !fittingDormant({ building: 'object/building/naboo/shared_bank_naboo.iff', x: 500, z: 500, state: LIVING_TAG }, standsIn, null), 'and one of the other state wherever it stands, one of this state wherever it stands');

  // The people: the same rows adopted in both states, stood by the real class.
  const rows: StandingRow[] = [
    // Core3's, inside the circle and seated (so the chairs of ours would stand for it), and outside it.
    { who: 'a', id: 'body', x: -12, y: 0, z: 12, heading: 0, cell: 0, respawn: 300, where: 'cities', key: '00000001', sit: true },
    { who: 'b', id: 'body', x: -40, y: 0, z: 40, heading: 0, cell: 0, respawn: 300, where: 'cities', key: '00000002' },
  ];
  const heralds = [{ who: 'h', id: 'body', x: -15, y: 0, z: 15, heading: 0, cell: 0, respawn: 300, where: 'herald', key: '00000005', from: 'herald' }];
  const ours = [{ who: '', id: 'dressed_brigade_test', x: -11, y: 0, z: 11, heading: 0, cell: 0, respawn: 300, where: 'ours', still: true, key: '00000003', ours: true, src: 'ours' as const, state: RUINS_TAG }];
  const overlay = [{ who: 'n', id: 'body', x: -20, y: 0, z: 20, heading: 0, cell: 0, respawn: 300, where: 'x', key: '00000004', src: 'nge' as const }];
  const list = standingList(rows, heralds, overlay, ours);
  ok(list.length === 5 && list[2] === heralds[0] && list[3] === ours[0] && list[4] === overlay[0], "the people's list is the world's own, the heralds, ours, then the overlay");
  const stood = (value: 'living' | 'ruins'): { ids: Map<string, string>; people: StandingPeople } => {
    arriveAs(value);
    // In the snapshot's raw frame, as the rows are when they are adopted.
    const ring = value === 'ruins' ? { centre: { x: -10, z: 10 }, circle: 20 } : null;
    const people = new StandingPeople();
    people.adopt(list as StandingRow[], {}, { world: 'rori', dormant: (r) => personDormant(r, standsIn, ring) });
    const ids = new Map<string, string>();
    const deps: PeopleDeps = {
      catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }) as never,
      spawn: (_entry, _at, how) => {
        ids.set(list[how.index].who || list[how.index].id, how.id);
        return { dead: false, removed: false, ready: true } as never;
      },
      remove: () => {},
      centre: () => ({ x: 0, z: 0 }),
      held: () => false,
    };
    people.step(1, 0, new THREE.Vector3(20, 0, 20), deps, true);
    return { ids, people };
  };
  const living = stood('living');
  const ruins2 = stood('ruins');
  const inLiving = living.ids;
  const inRuins = ruins2.ids;
  ok(inLiving.has('a') && inLiving.has('b') && !inLiving.has('dressed_brigade_test'), "in the living city Core3's town stands and the brigade of ours does not");
  ok(!inRuins.has('a') && inRuins.has('b') && inRuins.has('dressed_brigade_test'), "in the ruins Core3's row inside the circle is skipped, the one outside stands, and the brigade stands");
  ok(inLiving.has('h') && inRuins.has('h'), 'a herald inside the circle stands in both, being nobody\'s town');
  ok(inLiving.get('b') === 'stood:rori:1' && inRuins.get('b') === 'stood:rori:1' && inRuins.get('h') === 'stood:rori:2' && inRuins.get('n') === 'stood:rori:4' && inLiving.get('n') === 'stood:rori:4', 'and every `stood:` name is the same in both states');
  // Everything else the people answer skips a dormant row as the standing does: the town of ours asks whether the
  // data's own stand in a building (`anyStanding`), the Skills tab the nearest trainer (`nearestOf`), and the chairs of
  // ours stand under whoever sits (`seatedRows`). Row `a` stands at the world's (12, 12).
  ok(living.people.anyStanding(12, 12, 0.5, () => true) && !ruins2.people.anyStanding(12, 12, 0.5, () => true), "a row of Core3's skipped in the ruins stands in no building there");
  ok(living.people.nearestOf((who) => who === 'a', 0, 0)?.key === '00000001' && ruins2.people.nearestOf((who) => who === 'a', 0, 0) === null, 'is nobody\'s nearest');
  ok(living.people.seatedRows(null).some((s) => s.key === '00000001') && !ruins2.people.seatedRows(null).some((s) => s.key === '00000001'), 'and has no chair of ours stood under it');
}

// --- the First Brigade of ours ------------------------------------------------------------------------------------------
{
  const yaw = 0.7;
  const q = [Math.cos(yaw / 2), 0, Math.sin(yaw / 2), 0];
  // Each on a height of its own, so a post standing on its own ruin's height is told from one on any other.
  const ruins: RuinPlace[] = Array.from({ length: 30 }, (_, i) => ({ template: `object/static/test_ruin_${i % 3}.iff`, x: 5000 + i * 40, y: 80 + i, z: 5600 + (i % 5) * 30, q, bounds: { min: [-12, 0, -6], max: [10, 9, 8] } }));
  const bodies = brigadeBodies([{ id: 'dressed_brigade_b', ready: true }, { id: 'dressed_brigade_a', ready: true }, { id: 'dressed_villager', ready: true }, { id: 'dressed_brigade_c', ready: false }]);
  ok(JSON.stringify(bodies) === '["dressed_brigade_a","dressed_brigade_b"]', "the brigade's bodies are the catalogue's ready `dressed_brigade_*` entries");
  const a = rosterRows(ruins, bodies);
  const b = rosterRows(ruins, [...bodies].reverse());
  ok(a.length > 0 && JSON.stringify(a) === JSON.stringify(b), `stable from run to run, whatever order the bodies come in (${a.length} people)`);
  const posts = new Set(a.map((r) => r.key.split(':')[0]));
  ok(posts.size === a.length, 'every one has a name of its own');
  ok(a.every((r) => r.state === RUINS_TAG && r.ours && r.src === 'ours' && r.who === '' && r.still && r.cell === 0 && !r.peaceful), 'every row is tagged ruins, ours, naming no creature, at its post, and fought as its body says');
  // Back into each ruin's own frame: every one outside the footprint by at least the ring.
  let outside = 0;
  for (const r of a) {
    const near = ruins.reduce((best, u) => (Math.hypot(u.x - r.x, u.z - r.z) < Math.hypot(best.x - r.x, best.z - r.z) ? u : best));
    const dx = r.x - near.x;
    const dz = r.z - near.z;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    if (Math.abs(lx) >= 12 + RESTUSS_ROSTER_TUNE.ring - 1e-6 || Math.abs(lz) >= 8 + RESTUSS_ROSTER_TUNE.ring - 1e-6) outside++;
  }
  ok(outside === a.length, `every post stands ring metres outside its ruin's footprint, in the snapshot's raw frame (${outside} of ${a.length})`);
  const ownHeight = a.filter((r) => {
    const near = ruins.reduce((best, u) => (Math.hypot(u.x - r.x, u.z - r.z) < Math.hypot(best.x - r.x, best.z - r.z) ? u : best));
    return r.y === near.y;
  }).length;
  ok(a.length > 0 && ownHeight === a.length && new Set(a.map((r) => r.y)).size > 1, `on its own ruin's height, each ruin's its own (${ownHeight} of ${a.length})`);

  // Filler blocks packed side by side, as the launch city's are: a 3 by 3 of touching 20 by 10 m blocks, turned a
  // little. A post drawn onto the side two blocks share would stand in the neighbour's rubble; it takes the next side
  // round that is clear, and the middle block, hemmed in on all four, has none.
  {
    const turnBy = 0.3;
    const qq = [Math.cos(turnBy / 2), 0, Math.sin(turnBy / 2), 0];
    const cs = Math.cos(turnBy);
    const sn = Math.sin(turnBy);
    const blocks: RuinPlace[] = [];
    for (let gx = -1; gx <= 1; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        // Local (gx * 20, gz * 10) into the raw frame by the same turn the roster reads off `q`.
        const lx = gx * 20;
        const lz = gz * 10;
        blocks.push({ template: 'object/static/test_block.iff', x: 5300 + (lx * cs + lz * sn), y: 80, z: 5700 + (-lx * sn + lz * cs), q: qq, bounds: { min: [-10, 0, -5], max: [10, 9, 5] } });
      }
    }
    const tune = { ...RESTUSS_ROSTER_TUNE, share: 1, group: [3, 3] as [number, number], ring: 6, spacing: 1.5 };
    const posts = rosterRows(blocks, bodies, tune);
    const inside = posts.filter((r) =>
      blocks.some((u) => {
        const dx = r.x - u.x;
        const dz = r.z - u.z;
        const lx = dx * cs - dz * sn;
        const lz = dx * sn + dz * cs;
        return Math.abs(lx) < 10 && Math.abs(lz) < 5;
      }),
    );
    ok(inside.length === 0, `no one of the brigade stands inside any block's footprint, its own or a neighbour's (${inside.length} of ${posts.length})`);
    ok(posts.length === 24, `every block with a clear side has its post, and the middle one, hemmed in on all four, none (${posts.length / 3} posts of 9 blocks)`);
    ok(JSON.stringify(posts) === JSON.stringify(rosterRows([...blocks], [...bodies].reverse(), tune)), 'and the side taken is the same from run to run, in every browser');
  }
  tuneRestussRoster({ share: 0 });
  ok(rosterRows(ruins, bodies).length === 0, 'a share of nought guards nothing');
  tuneRestussRoster({ share: 1, group: [2, 2], temper: 'peaceful' });
  const all = rosterRows(ruins, bodies);
  ok(all.length === 60 && all.every((r) => r.peaceful), 'a share of one guards every ruin, two at a post, part of the furniture when peaceful');
  tuneRestussRoster({ on: 'no' });
  ok(rosterRows(ruins, bodies).length === 0 && rosterRows(ruins, []).length === 0, 'off, or with no body, nobody of ours');
  tuneRestussRoster({ on: true, share: 0.4, group: [1, 3], temper: 'entry' });
  ok(ruinsOf([{ template: 't', model: 'm', x: 1, y: 2, z: 3, q: [1, 0, 0, 0], state: RUINS_TAG }, { template: 't', model: 'm', x: 1, y: 2, z: 3, q: [1, 0, 0, 0], state: LIVING_TAG }, { template: 't', model: 'm', x: 1, y: 2, z: 3, q: [1, 0, 0, 0], state: RUINS_TAG, contained: true }], () => null).length === 1, "a layout's ruins are its objects tagged ruins out in the open");
  // The debug menu's sliders, through the real tables.
  const share2 = allDials(RESTUSS_DIALS).find((d) => d.key === 'roster.share');
  const most = allDials(RESTUSS_DIALS).find((d) => d.key === 'roster.most');
  ok(!!share2 && share2.kind === 'number' && share2.set(0.6).length === 0 && RESTUSS_ROSTER_TUNE.share === 0.6, 'the share slider moves the roster, as the console line does');
  ok(!!most && most.kind === 'number' && most.set(5).length === 0 && RESTUSS_ROSTER_TUNE.group[1] === 5, 'and so does the most at a post');
  ok(/^__debug\.restuss\(\{ roster: \{ share: 0\.6, most: 5 \} \}\)$/.test(movedLine(RESTUSS_DIALS)), `the line the menu copies out is the helper's own (${movedLine(RESTUSS_DIALS)})`);
  tuneRestussRoster({ share: 0.4, group: [1, 3] });
}

// --- permanent placement rows that carry a state ------------------------------------------------------------------
{
  const unknown: string[] = [];
  const row = readPlacementRow({ id: 'rubble-1', kind: 'prop', pack: 'props', thing: 'mun_nboo_building_chunk_destoyed_01', x: 5300, y: 80, z: 5700, q: [1, 0, 0, 0], state: RUINS_TAG }, unknown);
  ok(typeof row !== 'string' && row.state === RUINS_TAG && !unknown.length, 'a row may carry a state');
  const bad: string[] = [];
  const odd = readPlacementRow({ id: 'rubble-2', kind: 'prop', pack: 'props', thing: 'x', x: 1, y: 1, z: 1, q: [1, 0, 0, 0], state: 'Restuss Ruins' }, bad);
  ok(typeof odd !== 'string' && odd.state === undefined && bad.includes('rubble-2.state'), 'a state of the wrong shape is kept out of the row, with its note, and the row stands in every state');
  const text = placementsFileText('rori', 'raw', [{ ...(row as never), ground: 79, name: 'Rubble' }]);
  ok(/"ground": 79, "state": "restuss=ruins", "name": "Rubble"/.test(text), "the file writes `state` in its place, after the ground and before the name");
  // The editor's endpoint writing one.
  const answer = applyPlacementOp({ op: 'put', layer: 'world', world: 'rori', row: { kind: 'prop', pack: 'props', thing: 'mun_nboo_building_chunk_destoyed_01', x: 5300, y: 80, z: 5700, q: [1, 0, 0, 0], state: RUINS_TAG } }, { story: null, world: null }, { worlds: new Map([['rori', 'ground']]), now: 1 });
  ok(answer.status === 200 && /"q": \[1,0,0,0\], "state": "restuss=ruins", "at": 1/.test(answer.writes[0]?.text ?? ''), 'and the editor writes it there too');
  const refused = applyPlacementOp({ op: 'put', layer: 'world', world: 'rori', row: { kind: 'prop', pack: 'props', thing: 'x', x: 1, y: 1, z: 1, q: [1, 0, 0, 0], state: 'ruins' } }, { story: null, world: null }, { worlds: new Map([['rori', 'ground']]), now: 1 });
  ok(refused.status === 400, 'a state of the wrong shape is refused by the editor rather than written');
  ok(nextStateChoice(undefined, [LIVING_TAG, RUINS_TAG]) === LIVING_TAG && nextStateChoice(LIVING_TAG, [LIVING_TAG, RUINS_TAG]) === RUINS_TAG && nextStateChoice(RUINS_TAG, [LIVING_TAG, RUINS_TAG]) === '', "the list's State button goes round every state, living only and ruins only");
  ok(stateChoiceText('') === 'every state' && stateChoiceText(RUINS_TAG) === 'restuss ruins only', 'and says which');
  // A row picked up and saved again keeps the state the owner set on it, as it keeps its name and its solid.
  const base = { id: 'rubble-1', kind: 'prop' as const, pack: 'props', thing: 'mun_nboo_building_chunk_destoyed_01', x: 5300, y: 80, z: 5700, q: [1, 0, 0, 0] as [number, number, number, number], state: RUINS_TAG, name: 'Rubble' };
  const moved = rowFromProp({ id: 'mun_nboo_building_chunk_destoyed_01' }, { x: 10, y: 80, z: 20 }, [0, 0, 0, 1], false, { x: 3672, z: -6421 }, 'raw', base, 79);
  ok(moved.state === RUINS_TAG && moved.id === 'rubble-1' && moved.name === 'Rubble', 'a prop of the ruins moved with the editor keeps its state, with its id and name');
  ok(rowFromProp({ id: 'crate' }, { x: 10, y: 80, z: 20 }, [0, 0, 0, 1], false, { x: 3672, z: -6421 }, 'raw', null, 79).state === undefined, 'and one never saved has none, standing in every state');
  const house = rowFromHouse({ x: 10, y: 80, z: 20, yaw: 0, clear: 12 }, 'ply_tato_house_sm_s01_fp1', null, { x: 3672, z: -6421 }, 'raw', { ...base, kind: 'building', pack: 'gallery', thing: undefined, model: 'ply_tato_house_sm_s01_fp1', state: LIVING_TAG }, 79);
  ok(house.state === LIVING_TAG, 'and so does a building');
  // Filed only in its state.
  const read = readPlacementsFile(placementsFileText('rori', 'raw', [row as never, { id: 'crate-1', kind: 'prop', pack: 'props', thing: 'crate', x: 5310, y: 80, z: 5700, q: [1, 0, 0, 0] }]), 'rori', 'ground');
  const standOf = (value: 'living' | 'ruins'): string[] => {
    arriveAs(value);
    const keys: string[] = [];
    const layer = new PermanentLayer({ stand: (_row, _g, key) => (keys.push(key), { bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] } }), unstand: () => {}, packReady: () => true, generation: () => 1 });
    layer.enter('rori', { x: 3672, z: -6421 }, 'ground', 1);
    layer.setLayers(null, read);
    const why = layer.report().rows.find((r) => r.id === 'rubble-1')?.why ?? null;
    return [...keys, `why:${why}`];
  };
  const ruinsKeys = standOf('ruins');
  const livingKeys = standOf('living');
  ok(ruinsKeys.includes(placementKey('rubble-1')) && ruinsKeys.includes(placementKey('crate-1')), 'in the ruins a row kept to the ruins is stood beside one of every state');
  ok(!livingKeys.includes(placementKey('rubble-1')) && livingKeys.includes(placementKey('crate-1')) && livingKeys.includes('why:otherState'), 'in the living city it is filed nowhere, said to be of the other state, and never taken out of its file');
}

// --- the Gameplay page's row and what the game does with it --------------------------------------------------------
{
  const knob = GAMEPLAY.flatMap((g) => g.knobs).find((k) => k.key === 'restuss') as { kind?: string; choices?: { value: string }[] } | undefined;
  ok(!!knob && knob.kind === 'choice' && JSON.stringify(knob.choices?.map((c) => c.value)) === JSON.stringify(WORLD_STATES.restuss.values), "the Gameplay page has a row for Restuss whose choices are the state's own values");
  ok(DEFAULT_SETTINGS.restuss === WORLD_STATES.restuss.default, 'and the setting starts at the state\'s default, ruins');
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  ok(/case 'restuss':[\s\S]{0,300}this\.chooseWorldState\(RESTUSS_KEY, S\.restuss\)/.test(main), "moving the row asks the same rule the console's `restuss('ruins')` asks");
  ok(/S\.restuss = \(localWorldState\(RESTUSS_KEY\) \?\? WORLD_STATES\[RESTUSS_KEY\]\.default\)/.test(main), 'and the row shows the state\'s own kept setting at start, never a second copy of it');
  ok(/this\.world\.worldStatesReady = \(\) => this\.worldStatesHere\(\);/.test(main) && /this\.net\.onStates = \(states, why\) => this\.heardWorldStates\(states, why\);/.test(main), "the world's arrival waits through the game's own rule, and the line's states reach the game");
}

// --- the game's hand-overs, as text -------------------------------------------------------------------------------------
{
  // Every block above hands the rules what the game would; these are the lines where the game itself does, each of
  // which a deletion leaves both states standing at once, the town skipped in the living city, the server's word
  // never reaching the world, or a list of the other state's rows offered, with every block above still passing.
  const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  const ambience = readFileSync(new URL('../../../src/audio/ambience.ts', import.meta.url), 'utf8');
  const galaxy = readFileSync(new URL('../../../src/ui/galaxyMap.ts', import.meta.url), 'utf8');
  const pin = (src: string, re: RegExp, what: string) => ok(re.test(src), what);
  pin(world, /if \(pack\.layout\?\.states\) \{\s*await this\.worldStatesReady\?\.\(\);[\s\S]{0,200}?if \(token !== this\.loadToken\) \{\s*pack\.dispose\(\);\s*return null;\s*\}\s*takeWorldStates\(pack\.layout\.states\);\s*\}\s*this\.pack = pack;/, "an arrival takes its world's states after a saved server's hail, and before the pack is the world's (so nothing read off the pack in the wait's frames, the placed sounds among them, reads the states before)");
  pin(world, /const ruins: RuinsCircle \| null = restuss\?\.centre && stateNow\(RESTUSS_KEY\) === 'ruins' \? \{ centre: restuss\.centre, circle: RESTUSS_TUNE\.circle \} : null;/, "Core3's town is skipped only while Restuss stands in ruins, about the layout's own raw middle");
  pin(world, /standingPeople\.adopt\(standingList\(people, heralds, wildLife\.overlayRows\(\) as StandingRow\[\], roster as StandingRow\[\]\), wildLife\.peopleCreatures\(\), \{ \.\.\.wildLife\.peopleExtras\(\), dormant: \(r\) => personDormant\(r, standsIn, ruins\) \}\);/, 'the people are adopted with the brigade in their list and the dormant rule as their mask');
  pin(world, /new LayoutStreamer\(this\.scene, this\.physics, pack, layout, this\.particles, \{[^}]*stands: standsIn \}\);/, 'the streamer files what stands by the world states taken at this arrival');
  pin(world, /const ruins = ruinsOf\(layout\.objects, \(model\) => pack\.find\(model\)\?\.bounds \?\? null\);[\s\S]{0,400}?return rosterRows\(ruins, brigadeBodies\(cat\?\.entries \?\? \[\]\)\);/, "the brigade's posts are a rule over the layout's own ruins and their models' bounds");
  pin(world, /if \(!block\?\.centre \|\| !c \|\| stateNow\(RESTUSS_KEY\) !== 'ruins'\) return null;\s*return \{ centre: \{ x: -\(block\.centre\.x - c\.x\), z: block\.centre\.z - c\.z \}, circle: RESTUSS_TUNE\.circle \};/, "the circle the fittings are skipped by is the layout's middle carried into the world's frame, only in the ruins");
  pin(main, /const ruins = this\.world\.restussRuinsHere\(\);\s*for \(const \[i, f\] of all\.entries\(\)\) \{[\s\S]{0,200}?if \(fittingDormant\(f, standsIn, ruins\)\) continue;/, 'the fittings of the other state, and what the server stood in the streets in the ruins, are skipped when standing and never taken off their list');
  pin(main, /travelThingsOf\(inState\(this\.travelRows\), c\)/, "only the travel things of the state the world stands in stand");
  pin(main, /this\.placeRowsIn = \{ rows: this\.placeRows, stamp, list: inState\(this\.placeRows\) \}/, 'only the places and ports of that state are named');
  pin(main, /void this\.poisRawOf\(placesFor\)/, 'read from the file whole, every state, and filtered as they are asked');
  pin(main, /farPadsOf\(fileInState\(travel\), fileInState\(pois, 'pois'\)\)/, "another world's pads are those of the state it would stand in");
  pin(main, /private heardWorldStates\([\s\S]{0,400}?setServerStates\(states\);/, "the server's word, as the line hears it, is the world's");
  pin(main, /const hail = await peekHail\(saved, WORLD_STATE_TUNE\.waitMs\);[\s\S]{0,200}?if \(hail\) setServerStates\(cleanStates\(hail\.states\)\);/, "and so is what a session's first arrival reads off a look at the saved server's hail");
  pin(ambience, /if \(e\.state && !standsIn\(e\.state\)\) continue;/, "a placed sound of the other state is never put down");
  pin(galaxy, /return this\.loadPoisRaw\(planetId\)\.then\(\(f\) => \(\{ center: f\.center, pois: inState\(f\.pois\) \}\)\);/, "and the map's places, which the death card and a travel read, are this state's");
}

forgetWorldStates();
console.log(`\n${passed} checks passed`);
