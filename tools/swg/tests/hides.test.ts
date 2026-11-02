// What a world takes away (Map-maker II's twelfth wave; Map-maker I §2.9 and §8's `hides`): the removal file read as every
// reader reads it (`src/story/removals.ts`), its content keys found again over a layout's own objects, the changes the
// console and the editor make (`src/world/removalEdits.ts`), the batch writing it as a kind of its own (the world of copies
// taking it and nothing else), and what the readers outside the streamer ask after a hide (`src/world/hiddenPlaces.ts`:
// the placed sounds, a fitting's or a travel thing's building, the people in a hidden building's rooms). The streamer's own
// part runs on the real streamer in `liveHide.test.ts`; the walk grid's in `gridOpen.test.ts`.
//
// Day one: a world with no file, or a file the world cannot read, takes nothing away (`noRemovals`), and every writer leaves
// a file it did not change byte for byte.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  HIDE_TUNE, ObjectKeyIndex, REMOVAL_LIMITS, compileRemovals, landRows, mintZoneId, noRemovals, objectKey, parseObjectKey, readRemovalRow, readRemovalsFile, readZoneShape,
  removalKindOf, removalsEmpty, removalsFileText, removalWithExtras, sameRemovalRow, zoneKeeps, type RemovalRow,
} from '../../../src/story/removals.ts';
import { hideChange, makeRemovalEdits, personChange, siteChange, solidChange, unhideChange, unzoneChange, zoneChange, zoneSetChange } from '../../../src/world/removalEdits.ts';
import { HiddenPlaces, gameTo, layoutYaw, plainTemplate } from '../../../src/world/hiddenPlaces.ts';
import { applyPlacementOp, type PlacementCtx } from '../../../src/world/placementEdits.ts';
import { EDIT_FILE_KINDS, editFileOf, editFilePath } from '../../../src/story/placementPath.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const T = 'object/building/tatooine/shared_cantina_tatooine.iff';
const W = 'tatooine';

// ---- the keys ------------------------------------------------------------------------------------------------------------
{
  ok(objectKey(T, 3519.254, 5, -4811.5) === `o:${T}@3519.25,5,-4811.5` && objectKey(T, -0.001, 0, 0.004) === `o:${T}@0,0,0`, "a content key is the template and its place to the centimetre, -0 written 0");
  ok(objectKey(T, 1, 2, 3, 2) === `o:${T}@1,2,3#2` && objectKey(T, 1, 2, 3, 1) === `o:${T}@1,2,3`, 'past the first of its twins it carries #n');
  const k = parseObjectKey(`o:${T}@1.5,-2,3#3/7`)!;
  ok(k.template === T && k.x === 1.5 && k.y === -2 && k.z === 3 && k.n === 3 && k.piece === 7, "a key taken apart: template, place, twin and a piece's index");
  ok(removalKindOf(`o:${T}@1,2,3`) === 'object' && removalKindOf(`t:${T}`) === 'template' && removalKindOf('p:2b2c346e6abc') === 'person' && removalKindOf('s:tatooine:-3:12') === 'site' && removalKindOf('z:quiet-flats') === 'zone' && removalKindOf('chair-1') === null, 'each kind of row by its id');
  ok(mintZoneId('Quiet Flats!', new Set()) === 'z:quiet-flats' && mintZoneId('Quiet Flats', new Set(['z:quiet-flats'])) === 'z:quiet-flats-2' && mintZoneId('', new Set()) === 'z:zone', "a zone's id minted from its name, numbered where taken");
}

// ---- reading -------------------------------------------------------------------------------------------------------------
{
  const rows = [
    { id: `o:${T}@1,2,3`, hide: true, ground: 'drop', at: 5 },
    { id: `t:${T}`, solid: false },
    { id: 'p:2b2c346e6abc' },
    { id: 's:tatooine:-3:12' },
    { id: 'z:quiet', name: 'Quiet', shape: { kind: 'rect', min: [10, 10], max: [-10, -10] }, keeps: ['people', 'wild'] },
    { id: 'z:all', shape: { kind: 'circle', c: [0, 0], r: 5 }, keeps: ['wild', 'people', 'ours'] },
  ];
  const text = removalsFileText(W, 'raw', rows);
  const read = readRemovalsFile(text, W, 'ground');
  ok(read.problem === null && read.rows.length === 6 && read.skipped.length === 0, 'a file of every kind reads whole');
  const quiet = read.rows.find((r) => r.id === 'z:quiet')!;
  ok(quiet.shape?.kind === 'rect' && quiet.shape.min[0] === -10 && quiet.shape.max[0] === 10 && quiet.keeps!.join() === 'wild,people', "a rectangle's corners put in order, and what a zone keeps in the one order");
  ok(read.rows.find((r) => r.id === 'z:all')!.keeps === undefined && zoneKeeps(read.rows.find((r) => r.id === 'z:all')!).length === 3, 'all three kept is written as none: one meaning, one spelling');
  ok(text.split('\n').filter((l) => l.startsWith('    {')).map((l) => /"id": "([^"]+)"/.exec(l)![1]).join() === [...rows.map((r) => r.id)].sort().join(), 'one line a row, sorted by id');
  ok(removalsFileText(W, 'raw', read.rows as never[]) === removalsFileText(W, 'raw', readRemovalsFile(removalsFileText(W, 'raw', read.rows as never[]), W, 'ground').rows as never[]), 'and written again it reads to the same text');
  // Refusals: a row of another kind's field, a hide that is not true, a ground with no hide, an object row saying nothing.
  const bad = (r: unknown) => typeof readRemovalRow(r) === 'string';
  ok(bad({ id: 'p:abc', shape: { kind: 'circle', c: [0, 0], r: 1 } }) && bad({ id: `o:${T}@1,2,3`, hide: 'yes' }) && bad({ id: `o:${T}@1,2,3`, ground: 'drop' }) && bad({ id: `o:${T}@1,2,3` }) && bad({ id: `t:${T}` }) && bad({ id: 'chair-1' }), 'a row that is not one of its kind is refused, never guessed at');
  ok(bad({ id: 'z:x', shape: { kind: 'poly', pts: [[0, 0], [1, 1], [2, 2]] } }) && bad({ id: 'z:x', shape: { kind: 'circle', c: [0, 0], r: 0 } }) && bad({ id: 'z:x', shape: { kind: 'circle', c: [0, 0], r: 5 }, keeps: ['crowds'] }), 'a zone with no area, no radius or keeping what nobody keeps is refused');
  ok(typeof readZoneShape({ kind: 'poly', pts: Array.from({ length: REMOVAL_LIMITS.points + 1 }, (_, i) => [Math.cos(i), Math.sin(i)]) }) === 'string', `an outline past ${REMOVAL_LIMITS.points} points is refused`);
  const unknown: string[] = [];
  ok(typeof readRemovalRow({ id: 'p:abc', later: 1 }, unknown) !== 'string' && unknown.join() === 'p:abc.later', "a field this build does not read is kept out and named");
  ok(readRemovalsFile(text, 'naboo', 'ground').problem !== null && readRemovalsFile(text, W, 'space').problem !== null && readRemovalsFile('{', W, 'ground').problem !== null, "a file of another world, the wrong frame or no JSON is refused whole");
  const dup = readRemovalsFile(removalsFileText(W, 'raw', [{ id: 'p:abc' }]).replace(']', ', { "id": "p:abc" }]'), W, 'ground');
  ok(dup.rows.length === 1 && dup.skipped.length === 1 && /second row/.test(dup.skipped[0].why), 'a second row under one id is skipped and named');
  ok(sameRemovalRow(read.rows[0], { ...read.rows[0] }) && !sameRemovalRow(read.rows[0], { ...read.rows[0], hide: undefined }), 'two rows that take away the same read the same');
  ok(JSON.stringify(removalWithExtras({ id: 'p:abc' }, { id: 'p:abc', later: 7 })) === '{"id":"p:abc","later":7}', "a row written back keeps what it held that this build does not read");
  ok(landRows([{ id: 'b' }, { id: 'a' }], [{ id: 'c' }, { id: 'a', x: 1 } as never], ['b']).map((r) => r.id).join() === 'a,c', 'a landing lays the put rows over by id and drops the deleted, sorted');
}

// ---- finding the world's own objects -------------------------------------------------------------------------------------
{
  const objects = [
    { template: T, x: 10, y: 0, z: 10 },
    { template: T, x: 10, y: 0, z: 10 },
    { template: T, x: 10.03, y: 0, z: 10 },
    { template: 'object/other.iff', x: 10, y: 0, z: 10 },
    { template: 'object/piece.iff', x: 11, y: 0, z: 11, ilf: `o:${T}@10,0,10/0` },
  ];
  const idx = new ObjectKeyIndex(objects);
  ok(idx.keyOf(0) === `o:${T}@10,0,10` && idx.keyOf(1) === `o:${T}@10,0,10#2` && idx.keyOf(2) === `o:${T}@10.03,0,10`, 'exact twins are numbered in layout order; a neighbour three centimetres off is its own key');
  ok(idx.find(`o:${T}@10,0,10`) === 0 && idx.find(`o:${T}@10,0,10#2`) === 1 && idx.find(`o:${T}@10,0,10#3`) === -1, 'each found again; a twin past those there is nothing');
  ok(idx.find(`o:${T}@10.04,0,10`) === 2 && idx.find(`o:${T}@10.01,0,10`) === 0, `the nearest within ${HIDE_TUNE.match} m, then its twin`);
  ok(idx.find(`o:${T}@10.2,0,10`) === -1 && idx.find(`o:${T}@10.2,0,10`, 0.5) >= 0, 'past the match nothing; a wider match finds it');
  ok(idx.find(`o:${T}@10,0,10/0`) === 4 && idx.keyOf(4) === `o:${T}@10,0,10/0` && idx.find(`o:${T}@10,0,10/1`) === -1, "a piece of a building's furniture by its own key, in that one copy");
  const c = compileRemovals(
    [
      { id: `o:${T}@10,0,10#2`, hide: true, ground: 'drop' },
      { id: `o:${T}@10.03,0,10`, solid: false },
      { id: `o:${T}@99,0,99`, hide: true },
      { id: `t:object/other.iff`, solid: true },
      { id: 'p:abc' },
      { id: 's:tatooine:1:2' },
      { id: 'z:z', shape: { kind: 'circle', c: [0, 0], r: 5 } },
    ] as RemovalRow[],
    objects,
  );
  ok([...c.hidden].join() === '1' && [...c.groundDrop].join() === '1' && c.solid.get(2) === false && c.templates.get('object/other.iff') === true, 'compiled: the twin hidden with its ground, the neighbour walked through, the template switched');
  ok(c.missing.join() === `o:${T}@99,0,99` && c.found.get(`o:${T}@99,0,99`) === -1, 'a key that finds nothing hides nothing and is named');
  ok(c.people.has('abc') && c.sites.has('tatooine:1:2') && c.zones.length === 1, 'the people, sites and zones by kind');
  ok(removalsEmpty(noRemovals()) && removalsEmpty(compileRemovals([], objects)) && !removalsEmpty(c), 'a world with no file takes nothing away');
}

// ---- the changes ---------------------------------------------------------------------------------------------------------
{
  const key = `o:${T}@1,2,3`;
  let rows: RemovalRow[] = [];
  const apply = (c: ReturnType<typeof hideChange>): void => {
    assert.ok(typeof c !== 'string', String(c));
    rows = landRows(rows, c.after ? [c.after] : [], c.after ? [] : [c.id]);
  };
  const h = hideChange(rows, key, true);
  ok(typeof h !== 'string' && h.before === null && h.after?.hide === true && h.after.ground === 'drop', 'a hide with its ground');
  apply(h);
  apply(solidChange(rows, key, false));
  ok(rows[0].hide === true && rows[0].solid === false, "a switch on a hidden thing joins its row");
  apply(unhideChange(rows, key));
  ok(rows.length === 1 && rows[0].hide === undefined && rows[0].ground === undefined && rows[0].solid === false, "shown again, its switch kept");
  apply(solidChange(rows, key, null));
  ok(rows.length === 0, 'and the switch taken off: a row that says nothing more is taken out, not written empty');
  ok(typeof unhideChange(rows, key) === 'string' && typeof hideChange(rows, `t:${T}`) === 'string' && typeof solidChange(rows, 'p:x', true) === 'string', "what cannot be done is said in words");
  apply(solidChange(rows, `t:${T}`, false));
  ok(rows[0].id === `t:${T}` && rows[0].solid === false, "this world's every copy of a model switched");
  apply(personChange(rows, '2b2c346e6abc'));
  apply(siteChange(rows, 'tatooine:1:2'));
  ok(typeof personChange(rows, '2b2c346e6abc') === 'string' && typeof siteChange(rows, 'tatooine:1:2') === 'string', 'a person or a site taken away twice is said, not written twice');
  apply(personChange(rows, '2b2c346e6abc', true));
  ok(!rows.some((r) => r.id === 'p:2b2c346e6abc'), 'and given back');
  const z = zoneChange(rows, { kind: 'circle', c: [1.234567, -2.345678], r: 40.0001 }, ['wild'], 'Lair Clear');
  ok(typeof z !== 'string' && z.after?.id === 'z:lair-clear' && z.after.shape?.kind === 'circle' && (z.after.shape as { c: number[] }).c.join() === '1.23,-2.35' && z.after.keeps?.join() === 'wild', "a zone to the centimetre, named, keeping what it says");
  apply(z);
  const named = zoneSetChange(rows, 'z:lair-clear', { name: 'Clear', keeps: ['wild', 'people', 'ours'] });
  ok(typeof named !== 'string' && named.after?.name === 'Clear' && named.after.keeps === undefined, "a zone's fields written, all three kept written as none");
  apply(named);
  apply(unzoneChange(rows, 'z:lair-clear'));
  ok(!rows.some((r) => r.id.startsWith('z:')), 'and taken up');
  // The console's asks as edits, through the same changes.
  const said: string[] = [];
  const edits = makeRemovalEdits({ rows: [], picked: () => key, here: () => ({ x: 5, z: 6 }), toRaw: (x, zz) => ({ x: 100 - x, z: zz + 50 }), location: () => null, space: false }, { hide: 'selected', zone: { r: 30, keeps: ['people'] } }, said);
  ok(edits.length === 2 && (edits[0] as { put: RemovalRow }).put.id === key && (edits[1] as { put: RemovalRow }).put.shape?.kind === 'circle' && ((edits[1] as { put: RemovalRow }).put.shape as { c: number[] }).c.join() === '95,56', `the console's hide of what is picked, and a zone where the player stands carried into the file's frame (${said.join('; ')})`);
  const sw: string[] = [];
  const ctx = { rows: [] as RemovalRow[], picked: () => key, here: () => ({ x: 0, z: 0 }), toRaw: (x: number, zz: number) => ({ x, z: zz }), location: () => null, space: false };
  const thing = makeRemovalEdits(ctx, { solid: { thing: 'selected', value: false } }, sw);
  const model = makeRemovalEdits(ctx, { solid: { model: T, value: true } }, sw);
  const every = makeRemovalEdits(ctx, { solid: { everywhere: T, value: false } }, sw);
  const off = makeRemovalEdits(ctx, { solid: { everywhere: T, value: null } }, sw);
  ok((thing[0] as { put: RemovalRow }).put.id === key && (thing[0] as { put: RemovalRow }).put.solid === false && (model[0] as { put: RemovalRow }).put.id === `t:${T}` && (model[0] as { put: RemovalRow }).put.solid === true, "the console's walk-through switch on the picked thing and on this world's model, as rows of the removal file");
  ok((every[0] as { file: string; put: { id: string; solid: boolean } }).file === 'solid' && (every[0] as { put: { id: string; solid: boolean } }).put.solid === false && (off[0] as { file: string; delete: string }).delete === T, "and on every world's, a row of the shared file put or taken out");
  ok(makeRemovalEdits(ctx, { solid: { everywhere: 'not a template', value: true } }, sw).length === 0 && makeRemovalEdits(ctx, { solid: { thing: key } }, sw).length === 0, 'a switch with no template, or no value, is said and writes nothing');
  const spaceSaid: string[] = [];
  ok(makeRemovalEdits({ rows: [], picked: () => null, here: () => ({ x: 0, z: 0 }), toRaw: () => ({ x: 0, z: 0 }), location: () => null, space: true }, { zone: { r: 5 } }, spaceSaid).length === 0 && /space zone/.test(spaceSaid.join()), "a space zone's zones keep nothing this pass, and say so");
}

// ---- the batch writes it ---------------------------------------------------------------------------------------------------
{
  ok(EDIT_FILE_KINDS.includes('removed') && EDIT_FILE_KINDS.includes('people') && editFilePath('removed', W) === `placements/removed/${W}.json` && editFileOf(`removed/${W}.json`)?.kind === 'removed', 'the removal file is a kind of edit file of its own');
  const hash = (t: string) => t.length.toString(16).padStart(12, '0');
  const ctx = (): PlacementCtx => ({ worlds: new Map([[W, 'ground'], ['dungeon1', 'copies'], ['space_tatooine', 'space']]), now: 1_800_000_000_000, hash });
  const key = `o:${T}@1,2,3`;
  const put = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'removed', put: { id: key, hide: true } }, { file: 'removed', put: { id: 'z:quiet', shape: { kind: 'circle', c: [0, 0], r: 9 } } }] }, { story: null, world: null }, ctx());
  ok(put.status === 200 && put.writes.length === 1 && put.writes[0].layer === 'removed', 'the batch writes the removal file');
  const text = put.writes[0].text!;
  const read = readRemovalsFile(text, W, 'ground');
  ok(read.rows.length === 2 && read.rows.every((r) => r.at === 1_800_000_000_000), 'each row put stamped with the moment');
  const again = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'removed', delete: 'z:quiet', was: read.rows[1] }] }, { story: null, world: null, removed: text }, ctx());
  ok(again.status === 200 && readRemovalsFile(again.writes[0].text!, W, 'ground').rows.length === 1, 'a row taken out by its id, its was held');
  const stale = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'removed', delete: key, was: { id: key, solid: true } }] }, { story: null, world: null, removed: text }, ctx());
  ok(stale.status === 409, 'a row changed since it was read is refused by its id');
  const last = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'removed', delete: key }, { file: 'removed', delete: 'z:quiet' }] }, { story: null, world: null, removed: text }, ctx());
  ok(last.status === 200 && last.writes[0].text === null, 'the file goes with its last row');
  const bad = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'removed', put: { id: key } }] }, { story: null, world: null }, ctx());
  ok(bad.status === 400 && bad.writes.length === 0, 'a row the reader refuses refuses the batch');
  const copies = applyPlacementOp({ op: 'batch', world: 'dungeon1', edits: [{ file: 'removed', put: { id: 'p:crew-1' } }] }, { story: null, world: null }, ctx());
  ok(copies.status === 200 && /"frame": "raw"/.test(copies.writes[0].text ?? ''), "the world of copies takes what is taken away (a copy's crew member), written raw");
  const copiesOther = applyPlacementOp({ op: 'batch', world: 'dungeon1', edits: [{ file: 'removed', put: { id: 'p:crew-1' } }, { file: 'people', put: { id: 'a-1', body: 'x', x: 0, y: 0, z: 0, heading: 0 } }] }, { story: null, world: null }, ctx());
  ok(copiesOther.status === 409 && copiesOther.writes.length === 0 && (copiesOther.body as { why: string }).why === "nothing stands for good in the dungeons' world of copies", 'and nothing else, in the words it always gave');
  const space = applyPlacementOp({ op: 'batch', world: 'space_tatooine', edits: [{ file: 'removed', put: { id: 'p:x' } }] }, { story: null, world: null }, ctx());
  ok(space.status === 200 && /"frame": "game"/.test(space.writes[0].text ?? ''), "a space zone's file is in the game's frame");
}

// ---- the readers outside the streamer -------------------------------------------------------------------------------------
{
  ok(plainTemplate('object/building/X/shared_house.iff') === plainTemplate('object\\building\\x\\house.iff'), "a template's two spellings are one");
  const centre = { x: 1000, z: -500 };
  const raw = gameTo(30, 40, centre);
  ok(raw.x === 970 && raw.z === -460, "a point of the game's frame carried back into the layout's own");
  const box = { min: [-8, -2, -5], max: [10, 9, 4] };
  // A building turned about up by 0.7 rad, its place and turn as the layout writes them.
  const turn = 0.7;
  const q = [Math.cos(turn / 2), 0, Math.sin(turn / 2), 0];
  const b = { template: T, x: 200, y: 10, z: 300, contained: false, q, box };
  ok(Math.abs(layoutYaw(q) - turn) < 1e-12, "a layout quaternion's yaw across the ground");
  const hp = new HiddenPlaces([b, { template: 'object/sign.iff', x: 50, y: 0, z: 50, contained: false }]);
  ok(hp.buildingAt(T.replace('shared_', ''), 200.5, 300.4) && !hp.buildingAt(T, 205, 300) && !hp.buildingAt('object/other.iff', 200, 300), "a fitting's building found by template and place within a metre");
  ok(hp.emitterHidden({ template: 'object/sign.iff', p: [50.02, 0, 50] }, 0.05) && !hp.emitterHidden({ template: 'object/sign.iff', p: [51, 0, 50] }, 0.05) && hp.emitterHidden({ pob: 'x.pob', bp: [200, 10, 300] }, 0.05), 'a placed sound goes with its own hidden object, and one standing in a hidden building');
  // A person in the building's rooms, tested against three's own frame: the layout's raw point into the game's (x mirrored
  // about the centre, the turn mirrored with it: `placementFrame`), then into the model's own by its inverse.
  // A second building tilted as well as turned (any unit quaternion), far from the first.
  const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -1.1, 0.2));
  const q2 = [tq.w, tq.x, tq.y, tq.z];
  const b2 = { template: 'object/building/tilted.iff', x: 900, y: -20, z: -700, contained: false, q: q2, box };
  const hp2 = new HiddenPlaces([b2]);
  let agree = 0;
  let disagree = 0;
  let insideCount = 0;
  for (const [bb, h] of [[b, hp], [b2, hp2]] as const) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(centre.x - bb.x, bb.y, bb.z - centre.z), new THREE.Quaternion(bb.q[1], -bb.q[2], -bb.q[3], bb.q[0]), new THREE.Vector3(1, 1, 1));
    const inv = m.clone().invert();
    const v = new THREE.Vector3();
    for (let i = 0; i < 400; i++) {
      const rx = bb.x + (((i * 7919) % 41) - 20);
      const rz = bb.z + (((i * 104729) % 37) - 18);
      const ry = bb.y + ((i % 13) - 4);
      v.set(centre.x - rx, ry, rz - centre.z).applyMatrix4(inv);
      const inside = v.x >= -8 && v.x <= 10 && v.y >= -2 && v.y <= 9 && v.z >= -5 && v.z <= 4;
      if (inside) insideCount++;
      if (h.personInside({ x: rx, y: ry, z: rz, cell: 1 }, 0) === inside) agree++;
      else disagree++;
    }
  }
  ok(disagree === 0 && agree === 800 && insideCount > 40 && insideCount < 760, `a person stood in a room is inside a hidden building, turned or tilted, exactly where three's own frame puts them inside its box (${agree} agree, ${disagree} not, ${insideCount} inside)`);
  ok(!hp.personInside({ x: b.x, y: b.y, z: b.z, cell: 0 }, 0), 'a person outdoors (no room) is never in it, even at its middle: they are let down');
}

// ---- the brigade's roster with a ruin hidden ------------------------------------------------------------------------------
// The First Brigade of ours is laid by a rule over the ruins' own places (`rosterRows`), and every browser must name its
// people alike: a ruin the removal file hides changes neither the roster nor any `stood:` name (the roster is laid over the
// layout's own objects, never the filed list), and a brigade row the file takes away lies dormant in its place.
{
  const { RUINS_TAG, ruinsOf, rosterRows } = await import('../../../src/world/restuss.ts');
  const { fileByState } = await import('../../../src/world/worldState.ts');
  const { StandingPeople } = await import('../../../src/world/standingPeople.ts');
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { REPO } = await import('./oldModules.ts');
  const q = [Math.cos(0.35), 0, Math.sin(0.35), 0];
  const objects = Array.from({ length: 12 }, (_, i) => ({ template: `object/static/test_ruin_${i % 3}.iff`, model: `ruin${i % 3}`, x: 5000 + i * 45, y: 80, z: 5600 + (i % 4) * 35, q, state: RUINS_TAG }));
  const bounds = () => ({ min: [-12, 0, -6], max: [10, 9, 8] });
  const bodies = ['dressed_brigade_a', 'dressed_brigade_b'];
  const whole = rosterRows(ruinsOf(objects, bounds), bodies);
  // What the streamer files with ruin 4 hidden: the roster is never laid over that (`World.restussRoster` reads the layout).
  const filed = fileByState(objects, () => true, (i) => i === 4);
  ok(filed.hiddenCount === 1 && whole.length > 0, `a ruin hidden at the arrival is filed nowhere, and the roster stands ${whole.length} people`);
  const world = readFileSync(join(REPO, 'src/world/world.ts'), 'utf8');
  ok(/const ruins = ruinsOf\(layout\.objects, \(model\) => pack\.find\(model\)\?\.bounds \?\? null\);/.test(world), "the world lays the roster over the layout's own objects, whatever the removal file hides");
  const deps = () => {
    const bodiesUp: { how: { id: string; index: number }; removed: boolean }[] = [];
    return {
      bodiesUp,
      deps: {
        catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }),
        spawn: (_e: unknown, _at: unknown, how: { id: string; index: number }) => {
          const m = { how, removed: false };
          bodiesUp.push(m);
          return m;
        },
        remove: (m: { removed: boolean }) => {
          m.removed = true;
        },
        centre: () => ({ x: 5200, z: 5650 }),
        held: () => false,
      },
    };
  };
  const names = (removed: ((r: { key?: string }) => 0 | 1 | 2) | null): Map<string, string> => {
    const people = new StandingPeople();
    people.adopt(whole as never, null, { world: 'rori', removed: removed as never });
    const g = deps();
    people.step(0, 0, new THREE.Vector3(0, 0, 0), g.deps as never, true);
    return new Map(g.bodiesUp.filter((m) => !m.removed).map((m) => [(whole[m.how.index] as { key: string }).key, m.how.id]));
  };
  const all = names(null);
  // The first of those standing, so the row taken away is one that stood.
  const gone = [...all.keys()][0];
  const less = names((r) => (r.key === gone ? 2 : 0));
  ok(all.size > 1 && !!gone && !less.has(gone) && less.size === all.size - 1 && [...less].every(([k, id]) => all.get(k) === id), `one of the brigade taken away lies dormant in its place: every other keeps its \`stood:\` name (${less.size} of ${all.size})`);
}

console.log(`\n${checks} checks passed`);
