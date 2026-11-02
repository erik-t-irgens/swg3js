// The locations file (Map-maker II's eighth wave, `src/world/editFiles/locationsFile.ts`) and its kind in the batch: a
// place a row, read and written by every build alike. Held here: a place reads back as it was written (its words, its three
// switches, its shape to the bit, its loading lines, its state); the world row is id `world` with no shape and the only row
// that may carry `cities`; a bad row is skipped and named and a bad header refuses the file whole; the backstops
// (`LOCATION_LIMITS`) hold; the text is one line a place, sorted, so a change to one is a change to one line; the ninth
// wave's sky fields (a place's `env`, `weather` and `grade`, the world row's `climate`, `fog`, `wind` and `clouds`) read
// back as written and are refused in their words where they are wrong; Light and shadow's `light` is kept quietly and
// carried across a put by the batch; and the batch writes it: a put minted from its name, `was` held, an undo putting the
// file back byte for byte, the last place out taking the file.
//
// Run: node tools/swg/tests/locationsFile.test.ts
import assert from 'node:assert/strict';
import { applyPlacementOp, type PlacementCtx } from '../../../src/world/placementEdits.ts';
import { LOCATION_LIMITS, buildable, drawnOnMap, locationsFileText, mintLocationId, readLocationRow, readLocationShape, readLocationsFile, saidOnEntry, sameLocationRow, shapeArea, shapeMiddle, type LocationRow } from '../../../src/world/editFiles/locationsFile.ts';
import { undoEdits, redoEdits } from '../../../src/editor/undo.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const W = 'tatooine';
const glue = await import('../../../tools/dev/placementsEndpoint.mjs');
const worlds = new Map([[W, 'ground'], ['space_tatooine', 'space'], ['dungeon1', 'copies']] as const);
const ctx = (now: number): PlacementCtx => ({ worlds, now, hash: glue.revisionOf });
const town = (id: string, extra: Partial<LocationRow> = {}): LocationRow => ({ id, kind: 'city', name: 'Dune Town', shape: { kind: 'circle', c: [-1250.25, -3600.5], r: 300 }, ...extra });

{
  // Read and written.
  const a = town('dune-town', { build: false, loading: ['Sand gets everywhere.', 'The dunes sing at night.'], desc: 'A town of ours', note: 'never shown', at: 5 });
  const b: LocationRow = { id: 'quarry', kind: 'area', shape: { kind: 'poly', pts: [[0, 0], [40.125, 0], [40, 40], [0, 40]] }, map: false, say: true, state: 'restuss=ruins' };
  const c: LocationRow = { id: 'yard', kind: 'zone', shape: { kind: 'rect', min: [-10, -20], max: [30, 5] } };
  const w: LocationRow = { id: 'world', kind: 'world', cities: 'noBuild', loading: ['A world of ours.'] };
  const text = locationsFileText(W, 'raw', [a, b, c, w] as never);
  const read = readLocationsFile(text, W, 'ground');
  ok(read.problem === null && read.rows.length === 4 && read.skipped.length === 0 && read.unknown.length === 0, 'a file of three places and the world row reads back whole');
  ok(read.rows.map((r) => r.id).join() === 'dune-town,quarry,world,yard', 'its rows sorted by id');
  ok(sameLocationRow(read.rows[0], a) && sameLocationRow(read.rows[1], b) && sameLocationRow(read.rows[3], c) && sameLocationRow(read.rows[2], w), 'each as written: its words, switches, shape to the bit, lines, state and moment');
  ok(text.split('\n').filter((l) => l.startsWith('    { ')).length === 4, 'one line a place, so a change to one is a change to one line');
  ok(locationsFileText(W, 'raw', [w, c, b, a] as never) === text, 'and the text the same whichever order it was handed');
  ok(/"loading": \["Sand gets everywhere\.","The dunes sing at night\."\], "shape": \{"kind":"circle","c":\[-1250\.25,-3600\.5\],"r":300\}, "at": 5 \}/.test(text), "a place's shape is written last but its moment");
  ok(locationsFileText(W, 'raw', []).includes('"rows": []'), 'an empty file is a file of no rows');
  // What each is to the maps.
  ok(drawnOnMap(a) && !drawnOnMap(b) && !drawnOnMap(c) && !drawnOnMap(w), 'drawn on the maps: a city by its kind, an area its own map false, a zone never, the world row never');
  ok(saidOnEntry(a) && saidOnEntry(b) && !saidOnEntry(c) && !saidOnEntry(w), 'said walking in: a city by its kind, an area by its own say, a zone not');
  ok(!buildable(a) && buildable(b) && buildable(c), 'built in: true unless its own build says not');
  const m = shapeMiddle(c.shape!);
  ok(m.x === 10 && m.z === -7.5 && shapeArea(c.shape!) === 1000 && Math.abs(shapeArea(a.shape!) - Math.PI * 90000) < 1e-6, "a shape's middle and its area");
}

{
  // Refusals and the backstops.
  const bad = (row: unknown) => readLocationRow(row);
  ok(typeof bad({ ...town('x'), id: 'Bad Id' }) === 'string', 'an id not a-z, 0-9, _ and - is refused');
  ok(typeof bad({ ...town('x'), kind: 'village' }) === 'string', 'a kind not of the list is refused');
  ok(typeof bad({ id: 'world', kind: 'city', shape: town('x').shape }) === 'string' && typeof bad({ id: 'x', kind: 'world' }) === 'string', "the id world is the world row's alone, and the world row's id is world");
  ok(typeof bad({ id: 'world', kind: 'world', shape: town('x').shape }) === 'string' && typeof bad({ id: 'world', kind: 'world', build: false }) === 'string', 'the world row has no shape and no switch of a place');
  ok(typeof bad({ ...town('x'), cities: 'noBuild' }) === 'string' && typeof bad({ id: 'world', kind: 'world', cities: 'yes' }) === 'string', "cities is the world row's alone, and is noBuild or absent");
  ok(typeof bad({ id: 'x', kind: 'city' }) === 'string', 'a place has a shape');
  ok(typeof readLocationShape({ kind: 'circle', c: [0, 0], r: LOCATION_LIMITS.radiusLeast / 2 }) === 'string' && typeof readLocationShape({ kind: 'circle', c: [LOCATION_LIMITS.reach + 1, 0], r: 5 }) === 'string', 'a circle smaller than the least radius, or past the reach, is refused');
  ok(typeof readLocationShape({ kind: 'rect', min: [0, 0], max: [0, 10] }) === 'string', 'a rectangle with no area is refused');
  const flipped = readLocationShape({ kind: 'rect', min: [10, 5], max: [-10, -5] });
  ok(typeof flipped !== 'string' && flipped.kind === 'rect' && flipped.min[0] === -10 && flipped.max[1] === 5, "a rectangle's corners are put in order");
  ok(typeof readLocationShape({ kind: 'poly', pts: [[0, 0], [1, 1]] }) === 'string' && typeof readLocationShape({ kind: 'poly', pts: [[0, 0], [1, 1], [2, 2]] }) === 'string', 'an outline of under three points, or of no area, is refused');
  const many = Array.from({ length: LOCATION_LIMITS.points + 1 }, (_, i) => [Math.cos(i), Math.sin(i)] as [number, number]);
  ok(typeof readLocationShape({ kind: 'poly', pts: many }) === 'string', `an outline of more than ${LOCATION_LIMITS.points} points is refused`);
  ok(typeof bad({ ...town('x'), name: 'x'.repeat(LOCATION_LIMITS.words + 1) }) === 'string' && typeof bad({ ...town('x'), name: 'a\u0007b' }) === 'string', `a name past ${LOCATION_LIMITS.words} or with a control character is refused`);
  ok(typeof bad({ ...town('x'), loading: Array.from({ length: LOCATION_LIMITS.lines + 1 }, () => 'a') }) === 'string' && typeof bad({ ...town('x'), loading: ['x'.repeat(LOCATION_LIMITS.lineWords + 1)] }) === 'string', `past ${LOCATION_LIMITS.lines} loading lines, or a line past ${LOCATION_LIMITS.lineWords}, is refused`);
  ok(typeof bad({ ...town('x'), map: 'yes' }) === 'string' && typeof bad({ ...town('x'), state: 'ruins' }) === 'string', 'a switch that is not true or false, a state that is not a tag, are refused');
  const unknown: string[] = [];
  readLocationRow({ ...town('u'), light: { sun: 1 }, flavour: 'sweet' }, unknown);
  ok(unknown.join() === 'u.light,u.flavour', 'a field this build does not read is named, never dropped silently');
  const quietly = readLocationsFile(JSON.stringify({ version: 1, world: W, frame: 'raw', rows: [{ ...town('a'), light: { x: 1 } }, { id: 'world', kind: 'world', light: { sun: 1 } }, { ...town('b'), flavour: 1 }] }), W, 'ground');
  ok(quietly.rows.length === 3 && quietly.unknown.join() === 'b.flavour', "Light and shadow's light is kept quietly and anything else is said");
  const mixed = readLocationsFile(JSON.stringify({ version: 1, world: W, frame: 'raw', rows: [town('a'), { id: 'b', kind: 'city' }, town('a'), { id: 'world', kind: 'world' }, { id: 'world', kind: 'world' }] }), W, 'ground');
  ok(mixed.rows.length === 2 && mixed.skipped.length === 3 && mixed.skipped.filter((s) => /second place/.test(s.why)).length === 2, 'a bad row, a second row under one id and a second world row are skipped and named, the rest read');
  const full = readLocationsFile(JSON.stringify({ version: 1, world: W, frame: 'raw', rows: Array.from({ length: LOCATION_LIMITS.rows + 2 }, (_, i) => town(`t${i}`)) }), W, 'ground');
  ok(full.rows.length === LOCATION_LIMITS.rows && full.skipped.length === 2, `a file past ${LOCATION_LIMITS.rows} places reads that many and names the rest`);
  ok(readLocationsFile('{', W, 'ground').problem !== null, 'a file that does not read is refused whole');
  ok(/naboo's/.test(readLocationsFile(locationsFileText('naboo', 'raw', []), W, 'ground').problem ?? ''), "a file of another world's is refused whole");
  ok(/raw/.test(readLocationsFile(locationsFileText(W, 'game', []), W, 'ground').problem ?? '') && /game/.test(readLocationsFile(locationsFileText(W, 'raw', []), W, 'space').problem ?? ''), "a ground world's file in the raw frame, a space zone's in the game's, else refused whole");
  ok(mintLocationId('Dune Town', new Set()) === 'dune-town' && mintLocationId('Dune Town', new Set(['dune-town'])) === 'dune-town-2' && mintLocationId('', new Set()) === 'place' && mintLocationId('World', new Set()) === 'world-place', "a fresh id from a name, unique among those taken, never the world row's");
}

{
  // The batch.
  const put = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'locations', put: { kind: 'city', name: 'Dune Town', shape: { kind: 'circle', c: [10, 20], r: 150 } } }] }, {}, ctx(1000));
  const body = put.body as { files: { locations: { put: LocationRow[]; rev: string } } };
  ok(put.status === 200 && put.writes.length === 1 && put.writes[0].layer === 'locations', 'a place is written into its own file');
  const made = body.files.locations.put[0];
  ok(made.id === 'dune-town' && made.at === 1000, "its id minted from its name, stamped with the endpoint's moment");
  const file1 = put.writes[0].text as string;
  const moved: LocationRow = { ...made, shape: { kind: 'circle', c: [12, 20], r: 150 }, build: false };
  delete moved.at;
  const second = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'locations', put: moved, was: made }] }, { locations: file1 }, ctx(2000));
  ok(second.status === 200, 'a place moved and made no-build, its was held');
  const after = (second.body as typeof body).files.locations.put[0];
  const action = { label: 'moved', changes: [{ file: 'locations' as const, id: made.id, before: made, after }] };
  const undo = applyPlacementOp({ op: 'batch', world: W, edits: undoEdits(action) }, { locations: second.writes[0].text as string }, ctx(3000));
  ok(undo.status === 200 && undo.writes[0].text === file1, 'its undo puts the file back byte for byte');
  const redo = applyPlacementOp({ op: 'batch', world: W, edits: redoEdits(action) }, { locations: file1 }, ctx(4000));
  ok(redo.status === 200 && redo.writes[0].text === second.writes[0].text, 'and its redo the second write');
  const stale = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'locations', put: moved, was: { ...made, name: 'Elsewhere' } }] }, { locations: file1 }, ctx(5000));
  ok(stale.status === 409 && !stale.writes.length, 'a place changed since the editor read it is refused by name and nothing written');
  const world = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'locations', put: { id: 'world', kind: 'world', cities: 'noBuild' } }] }, { locations: file1 }, ctx(6000));
  ok(world.status === 200 && /"id": "world", "kind": "world", "cities": "noBuild"/.test(world.writes[0].text as string), 'the world row is written under its own id');
  const out = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'locations', delete: made.id, was: made }] }, { locations: file1 }, ctx(7000));
  ok(out.status === 200 && out.writes.length === 1 && out.writes[0].text === null, 'the last place out takes the file');
  const copies = applyPlacementOp({ op: 'batch', world: 'dungeon1', edits: [{ file: 'locations', put: town('a') }] }, {}, ctx(8000));
  ok(copies.status === 409, "the dungeons' world of copies keeps none");
  const broken = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'locations', put: { id: 'x', kind: 'city', shape: { kind: 'circle', c: [0, 0], r: 0 } } }] }, {}, ctx(9000));
  ok(broken.status === 400 && /radius/.test((broken.body as { why: string }).why), 'a broken place is refused in its words');
  const strange = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'locations', put: { ...town('x'), light: { sun: 1 } } }] }, {}, ctx(9500));
  ok(strange.status === 400 && /does not write/.test((strange.body as { why: string }).why), 'a field this build does not write is refused from the editor (only a file may carry one)');
  const sky = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'locations', put: { ...town('x'), env: 'moseisley', weather: 'dust', grade: { warmth: 0.4 } } }] }, {}, ctx(9600));
  ok(sky.status === 200 && /"env": "moseisley", "weather": "dust", "grade": \{"warmth":0\.4\}/.test(sky.writes[0].text as string), "the ninth wave's sky fields are written by this build's batch");
  // A `light` block (Light and shadow's) kept across a put: the editor writes the row clean, and the batch carries what the
  // file's row held that this build does not read.
  const held = locationsFileText(W, 'raw', [{ ...town('dune-town'), light: { lamp: 2 }, at: 10 }, { id: 'world', kind: 'world', light: { sun: [1, 0.9, 0.8] }, loading: ['x'], at: 10 }] as never);
  const base = readLocationsFile(held, W, 'ground');
  const was = base.rows.find((r) => r.id === 'world')!;
  const kept = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'locations', put: { id: 'world', kind: 'world', loading: ['y'] }, was }, { file: 'locations', put: { ...town('dune-town'), build: false }, was: base.rows.find((r) => r.id === 'dune-town')! }] }, { locations: held }, ctx(11000));
  const keptText = kept.writes[0].text as string;
  ok(kept.status === 200 && /"loading": \["y"\], "at": 11000, "light": \{"sun":\[1,0\.9,0\.8\]\}/.test(keptText), "a light block on the world row is kept across a put that rewrote its loading lines");
  ok(/"build": false, "shape": .*"at": 11000, "light": \{"lamp":2\}/.test(keptText), "and a place's light across a put that made it no-build");
}

{
  // The sky per place (the ninth wave): read back as written, in the file's order, and refused in its words where it is wrong.
  const place = town('dune-town', { env: 'moseisley', weather: 'snow', grade: { gloom: 0.3, warmth: -0.5, strength: 1.5 }, at: 3 });
  const world: LocationRow = { id: 'world', kind: 'world', env: 'desert', grade: { heat: 0.2 }, climate: [40, 30, 20, 10, 5], fog: { morning: 0.6, evening: 0.3, morningLo: 0.4, morningHi: 0.9, eveningLo: 0.1, eveningHi: 0.3, top: 6 }, wind: { gust: 1.5, devils: 0 }, clouds: { cover: 1.25, height: 0.8, depth: 1.5, density: 2 } };
  const text = locationsFileText(W, 'raw', [place, world] as never);
  const read = readLocationsFile(text, W, 'ground');
  ok(read.problem === null && read.rows.length === 2 && read.unknown.length === 0 && read.skipped.length === 0, 'a place with a sky and a world row with its own read back whole');
  ok(sameLocationRow(read.rows.find((r) => r.id === 'dune-town')!, place) && sameLocationRow(read.rows.find((r) => r.id === 'world')!, world), 'each as written, every field');
  ok(!sameLocationRow({ ...place, grade: { gloom: 0.31, warmth: -0.5, strength: 1.5 } }, place) && !sameLocationRow({ ...world, climate: [40, 30, 20, 10, 6] }, world) && !sameLocationRow({ ...place, weather: 'rain' }, place), 'a grade, a climate or a weather moved is another row');
  ok(/"name": "Dune Town", "env": "moseisley", "weather": "snow", "grade": \{"gloom":0\.3,"warmth":-0\.5,"strength":1\.5\}, "shape"/.test(text) && /"kind": "world", "env": "desert", "grade": \{"heat":0\.2\}, "climate": \[40,30,20,10,5\], "fog": \{"morning":0\.6,/.test(text), 'the sky written after the switches and before the lines and the shape');
  const r = readLocationRow({ ...town('x'), grade: { contrast: 0.1, gloom: 0.2 } });
  ok(typeof r !== 'string' && JSON.stringify(r.grade) === '{"gloom":0.2,"contrast":0.1}', "a grade's fields cleaned in one fixed order, so its text is the same however it was handed");
  const bad = (row: unknown) => readLocationRow(row);
  ok(typeof bad({ ...town('x'), env: 'a\u0001b' }) === 'string' && typeof bad({ ...town('x'), env: '' }) === 'string' && typeof bad({ ...town('x'), env: 'x'.repeat(65) }) === 'string', "an env with a control character, empty or past 64 is refused");
  ok(typeof bad({ ...town('x'), weather: 'hail' }) === 'string', 'a weather kind not rain, dust or snow is refused');
  ok(typeof bad({ ...town('x'), grade: { murk: 1 } }) === 'string' && typeof bad({ ...town('x'), grade: { gloom: 1.5 } }) === 'string' && typeof bad({ ...town('x'), grade: {} }) === 'string' && typeof bad({ ...town('x'), grade: 'dark' }) === 'string', 'a grade naming a field it has not got, past its backstop, naming nothing or not an object is refused');
  for (const k of ['climate', 'fog', 'wind', 'clouds'] as const) ok(/world row's alone/.test(String(bad({ ...town('x'), [k]: (world as unknown as Record<string, unknown>)[k] }))), `${k} on a place is refused: the world row's alone`);
  ok(typeof bad({ id: 'world', kind: 'world', climate: [] }) === 'string' && typeof bad({ id: 'world', kind: 'world', climate: [0, 0] }) === 'string' && typeof bad({ id: 'world', kind: 'world', climate: [5, -1] }) === 'string' && typeof bad({ id: 'world', kind: 'world', climate: new Array(9).fill(1) }) === 'string', 'a climate empty, all nought, with a weight under nought or of more than eight levels is refused');
  ok(/all of/.test(String(bad({ id: 'world', kind: 'world', fog: { morning: 0.5 } }))) && typeof bad({ id: 'world', kind: 'world', fog: { ...world.fog, morning: 1.5 } }) === 'string', 'a fog look is all seven numbers, each within its backstop');
  ok(typeof bad({ id: 'world', kind: 'world', wind: { breeze: 2 } }) === 'string' && typeof bad({ id: 'world', kind: 'world', wind: { gust: 30 } }) === 'string', "a wind naming a multiplier it has not got, or past the wind's own ends, is refused");
  ok(typeof bad({ id: 'world', kind: 'world', clouds: { height: 0 } }) === 'string' && typeof bad({ id: 'world', kind: 'world', clouds: { tint: 1 } }) === 'string', "a cloud deck's height of nought, or a multiplier it has not got, is refused");
  // Every backstop's ends, as the design wrote them: each end taken, a hundredth past it refused.
  const ENDS: [string, string, number, number][] = [
    ['grade', 'gloom', 0, 1], ['grade', 'heat', 0, 1], ['grade', 'warmth', -1, 1], ['grade', 'cool', 0, 1], ['grade', 'saturation', -0.5, 0.5], ['grade', 'contrast', -0.2, 0.2], ['grade', 'strength', 0, 4],
    ['wind', 'floor', 0, 20], ['wind', 'gust', 0, 20], ['wind', 'devils', 0, 20],
    ['clouds', 'cover', 0, 4], ['clouds', 'height', 0.05, 20], ['clouds', 'depth', 0.05, 20], ['clouds', 'density', 0, 20],
  ];
  let held = 0;
  const misses: string[] = [];
  for (const [g, k, lo, hi] of ENDS) {
    const row = (v: number) => (g === 'grade' ? { ...town('x'), grade: { [k]: v } } : { id: 'world', kind: 'world', [g]: { [k]: v } });
    const fine = typeof bad(row(lo)) !== 'string' && typeof bad(row(hi)) !== 'string';
    const past = typeof bad(row(lo - 0.01)) === 'string' && typeof bad(row(hi + 0.01)) === 'string';
    if (fine && past) held++;
    else misses.push(`${g}.${k}`);
  }
  for (const [k, lo, hi] of [['morning', 0, 1], ['evening', 0, 1], ['morningLo', 0, 4], ['morningHi', 0, 4], ['eveningLo', 0, 4], ['eveningHi', 0, 4], ['top', 0, 100]] as [string, number, number][]) {
    const row = (v: number) => ({ id: 'world', kind: 'world', fog: { ...world.fog, [k]: v } });
    if (typeof bad(row(lo)) !== 'string' && typeof bad(row(hi)) !== 'string' && typeof bad(row(lo - 0.01)) === 'string' && typeof bad(row(hi + 0.01)) === 'string') held++;
    else misses.push(`fog.${k}`);
  }
  ok(misses.length === 0, `every grade, wind, cloud and fog number held to its backstop's ends (${held} of ${ENDS.length + 7}${misses.length ? `; not: ${misses.join(', ')}` : ''})`);
  const w2 = readLocationRow({ id: 'world', kind: 'world', wind: { gust: 2 }, clouds: { cover: 0.5 } });
  ok(typeof w2 !== 'string' && JSON.stringify(w2.wind) === '{"gust":2}' && JSON.stringify(w2.clouds) === '{"cover":0.5}', 'a wind or clouds of one multiplier keeps that one alone (the rest are the tables\' own)');
}

console.log(`locationsFile: ${checks} checks passed`);
