// The locations file (Map-maker II's eighth wave, `src/world/editFiles/locationsFile.ts`) and its kind in the batch: a
// place a row, read and written by every build alike. Held here: a place reads back as it was written (its words, its three
// switches, its shape to the bit, its loading lines, its state); the world row is id `world` with no shape and the only row
// that may carry `cities`; a bad row is skipped and named and a bad header refuses the file whole; the backstops
// (`LOCATION_LIMITS`) hold; the text is one line a place, sorted, so a change to one is a change to one line; the later
// waves' fields (a place's `env`, the world row's `climate`, `light`) are kept quietly and carried across a put by the batch;
// and the batch writes it: a put minted from its name, `was` held, an undo putting the file back byte for byte, the last
// place out taking the file.
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
  readLocationRow({ ...town('u'), env: 'mos_eisley', flavour: 'sweet' }, unknown);
  ok(unknown.join() === 'u.env,u.flavour', 'a field this build does not read is named, never dropped silently');
  const quietly = readLocationsFile(JSON.stringify({ version: 1, world: W, frame: 'raw', rows: [{ ...town('a'), env: 'x', grade: 'y' }, { id: 'world', kind: 'world', climate: {}, light: { sun: 1 } }, { ...town('b'), flavour: 1 }] }), W, 'ground');
  ok(quietly.rows.length === 3 && quietly.unknown.join() === 'b.flavour', "the later waves' fields are kept quietly and anything else is said");
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
  const strange = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'locations', put: { ...town('x'), env: 'mos_eisley' } }] }, {}, ctx(9500));
  ok(strange.status === 400 && /does not write/.test((strange.body as { why: string }).why), 'a field this build does not write is refused from the editor (only a file may carry one)');
  // A `light` block (Light and shadow's) and a place's `env` (the ninth wave's) kept across a put: the editor writes the row
  // clean, and the batch carries what the file's row held that this build does not read.
  const held = locationsFileText(W, 'raw', [{ ...town('dune-town'), env: 'mos_eisley', at: 10 }, { id: 'world', kind: 'world', light: { sun: [1, 0.9, 0.8] }, loading: ['x'], at: 10 }] as never);
  const base = readLocationsFile(held, W, 'ground');
  const was = base.rows.find((r) => r.id === 'world')!;
  const kept = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'locations', put: { id: 'world', kind: 'world', loading: ['y'] }, was }, { file: 'locations', put: { ...town('dune-town'), build: false }, was: base.rows.find((r) => r.id === 'dune-town')! }] }, { locations: held }, ctx(11000));
  const keptText = kept.writes[0].text as string;
  ok(kept.status === 200 && /"loading": \["y"\], "at": 11000, "light": \{"sun":\[1,0\.9,0\.8\]\}/.test(keptText), "a light block on the world row is kept across a put that rewrote its loading lines");
  ok(/"build": false, "shape": .*"at": 11000, "env": "mos_eisley"/.test(keptText), "and a place's env across a put that made it no-build");
}

console.log(`locationsFile: ${checks} checks passed`);
