// A row's new fields (DESIGN.md §2.7): `template` (the object template a gallery or world row really is) and `from` (the
// ground world a world row's model comes from) are read, cleaned and written in `ORDER`'s place, and tagged in
// `rowHash` only where present, so three rows with no new field hash to the very strings 5a4e765 answers (taken once by
// running 5a4e765's own `placements.ts` over these rows, held here as literals); a malformed value is unknown, never a
// refusal; `cut` is reserved; the endpoint's put carries them; the reader's limits are backstops (a 2,001st row and a
// 100 m `clear` stand, a 100,001st row is skipped and named); the world editor's writer (`rowFromEditor`) round-trips
// through the reader and `toGame` for every kind of source, both frames and both sides of a wall, and keeps a moved
// gallery row's deed; and the endpoint reads each layer once and looks rows up in a `Map` (text pins).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PLACEMENT_LIMITS, placementsFileText, readPlacementRow, readPlacementsFile, rowHash, toGame } from '../../../src/story/placements.ts';
import { applyPlacementOp } from '../../../src/world/placementEdits.ts';
import { rowFromEditor } from '../../../src/world/permanentEdit.ts';

/** Whether the reader named a field unknown (it names one `<id>.<field>`). */
const has = (list: string[], field: string) => list.some((u) => u === field || u.endsWith(`.${field}`));

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** 5a4e765's `rowHash` over these three rows, literally. */
const PRE_PASS_HASHES: Record<string, string> = {
  'crate-1': '["prop","props","test_crate",null,null,12.5,3,-7.25,[1,0,0,0],null,null,null,null]',
  'house-2': '["building","gallery",null,"test_house","test_deed",-100,12.125,40,[0.7071067811865476,0,0.7071067811865476,0],null,null,18.5,null]',
  'rock-3': '["prop","world",null,"test_rock",null,1,2,3,[1,0,0,0],false,true,null,null,"restuss=ruins"]',
};
const SAMPLES = [
  { id: 'crate-1', kind: 'prop', pack: 'props', thing: 'test_crate', x: 12.5, y: 3, z: -7.25, q: [1, 0, 0, 0] },
  { id: 'house-2', kind: 'building', pack: 'gallery', model: 'test_house', deed: 'test_deed', x: -100, y: 12.125, z: 40, q: [0.7071068, 0, 0.7071068, 0], clear: 18.5, name: 'TEST house', note: 'TEST note' },
  { id: 'rock-3', kind: 'prop', pack: 'world', model: 'test_rock', x: 1, y: 2, z: 3, q: [1, 0, 0, 0], inside: true, solid: false, state: 'restuss=ruins' },
];

for (const s of SAMPLES) {
  const row = readPlacementRow(s);
  ok(typeof row !== 'string' && rowHash(row) === PRE_PASS_HASHES[s.id], `${s.id}, with no new field, hashes to 5a4e765's very string`);
}

{
  const unknown: string[] = [];
  const row = readPlacementRow({ id: 'naboo-tree-1', kind: 'prop', pack: 'world', model: 'test_tree', template: 'object/tangible/test/shared_test_tree.iff', from: 'naboo', x: 1, y: 0, z: 2, q: [1, 0, 0, 0] }, unknown);
  ok(typeof row !== 'string' && row.template === 'object/tangible/test/shared_test_tree.iff' && row.from === 'naboo' && unknown.length === 0, 'a world row keeps its template and the world its model comes from');
  const plain = readPlacementRow({ id: 'naboo-tree-1', kind: 'prop', pack: 'world', model: 'test_tree', x: 1, y: 0, z: 2, q: [1, 0, 0, 0] });
  if (typeof row !== 'string' && typeof plain !== 'string') {
    const h = rowHash(row);
    ok(h !== rowHash(plain) && h.endsWith(',"template","object/tangible/test/shared_test_tree.iff","from","naboo"]'), `and both are tagged in its hash, after everything a row had before (${h.slice(-70)})`);
  }
  const text = placementsFileText('tatooine', 'raw', [row as never]);
  const line = text.split(/\r?\n/).find((l) => l.includes('naboo-tree-1')) ?? '';
  const order = ['"q"', '"template"', '"from"'].map((k) => line.indexOf(k));
  ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'and written in their place in the order, after the turn and before the words');
  const back = readPlacementsFile(text, 'tatooine', 'ground');
  ok(back.rows.length === 1 && back.rows[0].template === 'object/tangible/test/shared_test_tree.iff' && back.rows[0].from === 'naboo', 'the file reads back as written');
}

{
  const unknown: string[] = [];
  const row = readPlacementRow({ id: 'bad-1', kind: 'prop', pack: 'world', model: 'test_rock', template: 'not a template at all', from: 'Not A World!', x: 0, y: 0, z: 0, q: [1, 0, 0, 0] }, unknown);
  ok(typeof row !== 'string' && row.template === undefined && row.from === undefined && has(unknown, 'template') && has(unknown, 'from'), `a malformed template or world is unknown, never a refusal (${unknown.join(', ')})`);
  const u2: string[] = [];
  const prop = readPlacementRow({ id: 'chair-1', kind: 'prop', pack: 'props', thing: 'test_chair', template: 'object/tangible/test/shared_chair.iff', from: 'naboo', x: 0, y: 0, z: 0, q: [1, 0, 0, 0] }, u2);
  ok(typeof prop !== 'string' && prop.template === undefined && prop.from === undefined && has(u2, 'template') && has(u2, 'from'), "a props row's thing says what it is: a template or a world on it is unknown");
  const u3: string[] = [];
  const gallery = readPlacementRow({ id: 'house-9', kind: 'building', pack: 'gallery', model: 'test_house', from: 'naboo', template: 'object/building/test/shared_house.iff', x: 0, y: 0, z: 0, q: [1, 0, 0, 0] }, u3);
  ok(typeof gallery !== 'string' && gallery.template === 'object/building/test/shared_house.iff' && gallery.from === undefined && has(u3, 'from'), "a gallery row keeps its template, and a world is a world row's alone");
  const u4: string[] = [];
  const cut = readPlacementRow({ id: 'cut-1', kind: 'prop', pack: 'world', model: 'test_rock', cut: [1, 2, 3], x: 0, y: 0, z: 0, q: [1, 0, 0, 0] }, u4);
  ok(typeof cut !== 'string' && !('cut' in cut) && !has(u4, 'cut'), '`cut` is reserved: read and set aside, as `fill` and `locked` are (Map-maker II\'s)');
  const worlds = new Map([['tatooine', 'ground' as const]]);
  const file = JSON.stringify({ version: 1, world: 'tatooine', frame: 'raw', rows: [{ id: 'cut-1', kind: 'prop', pack: 'world', model: 'test_rock', cut: [1, 2, 3], x: 0, y: 0, z: 0, q: [1, 0, 0, 0] }] });
  const moved = applyPlacementOp({ op: 'put', layer: 'world', world: 'tatooine', row: { id: 'cut-1', kind: 'prop', pack: 'world', model: 'test_rock', x: 5, y: 0, z: 0, q: [1, 0, 0, 0] } }, { story: null, world: file }, { worlds: worlds as never, now: 3 });
  ok(moved.status === 200 && /"cut":\s?\[1,\s?2,\s?3\]/.test(moved.writes[0]?.text ?? ''), 'and a row carrying one keeps it across the endpoint\'s put');
  const u5: string[] = [];
  const long = readPlacementRow({ id: 'long-1', kind: 'prop', pack: 'world', model: 'test_rock', template: `object/${'a'.repeat(PLACEMENT_LIMITS.template)}.iff`, x: 0, y: 0, z: 0, q: [1, 0, 0, 0] }, u5);
  ok(typeof long !== 'string' && long.template === undefined && has(u5, 'template'), `a template past ${PLACEMENT_LIMITS.template} characters is unknown`);
}

{
  const worlds = new Map([['tatooine', 'ground' as const]]);
  const answer = applyPlacementOp({ op: 'put', layer: 'world', world: 'tatooine', row: { kind: 'prop', pack: 'world', model: 'test_tree', template: 'object/tangible/test/shared_test_tree.iff', from: 'naboo', x: 1.5, y: 0, z: -2, q: [1, 0, 0, 0] } }, { story: null, world: null }, { worlds: worlds as never, now: 1000 });
  ok(answer.status === 200 && answer.body.ok && answer.writes.length === 1, "the endpoint's put takes a row carrying both");
  const written = answer.writes[0].text ?? '';
  ok(written.includes('"template": "object/tangible/test/shared_test_tree.iff"') || written.includes('"template":"object/tangible/test/shared_test_tree.iff"'), 'and writes its template');
  ok(/"from":\s?"naboo"/.test(written), 'and its world');
}

{
  // The backstops: 2,001 rows and a 100 m clear stand; a row past the backstop is skipped and named.
  const rows = Array.from({ length: 2001 }, (_, i) => ({ id: `r-${i}`, kind: 'prop', pack: 'props', thing: 'test_crate', x: i, y: 0, z: 0, q: [1, 0, 0, 0], ...(i === 0 ? { clear: 100 } : {}) }));
  const text = JSON.stringify({ version: 1, world: 'tatooine', frame: 'raw', rows });
  const read = readPlacementsFile(text, 'tatooine', 'ground');
  ok(read.rows.length === 2001 && read.skipped.length === 0, `a file of 2,001 rows reads every one (the old cap of 2,000 is gone; the backstop is ${PLACEMENT_LIMITS.rows})`);
  ok(read.rows[0].clear === 100, `and a clear of 100 m stands (the backstop is ${PLACEMENT_LIMITS.circle} m)`);
  const worlds = new Map([['tatooine', 'ground' as const]]);
  const put = applyPlacementOp({ op: 'put', layer: 'world', world: 'tatooine', row: { kind: 'prop', pack: 'props', thing: 'test_crate', x: 9999, y: 0, z: 0, q: [1, 0, 0, 0] } }, { story: null, world: placementsFileText('tatooine', 'raw', read.rows) }, { worlds: worlds as never, now: 2000 });
  ok(put.status === 200, 'and the endpoint puts a 2,002nd row into it');
  const many = Array.from({ length: PLACEMENT_LIMITS.rows + 1 }, (_, i) => ({ id: `m-${i}`, kind: 'prop', pack: 'props', thing: 'test_crate', x: i % 1000, y: 0, z: Math.floor(i / 1000), q: [1, 0, 0, 0] }));
  const big = readPlacementsFile(JSON.stringify({ version: 1, world: 'tatooine', frame: 'raw', rows: many }), 'tatooine', 'ground');
  ok(big.rows.length === PLACEMENT_LIMITS.rows && big.skipped.length === 1 && big.skipped[0].id === `m-${PLACEMENT_LIMITS.rows}`, `a row past the ${PLACEMENT_LIMITS.rows}-row backstop is skipped and named (${big.skipped[0]?.id}: ${big.skipped[0]?.why})`);
}

{
  // The row the world editor writes (`rowFromEditor`), read back and stood: for a props thing, a gallery building, a
  // model of this world and one of another, in the raw frame about a layout's centre and in a space zone's game frame,
  // in a room and out of one, the place comes back within the millimetre it is written to and the turn within its six
  // decimals; `template` is written exactly where the row is not a props row, `from` exactly where the model is another
  // world's, `inside` and the ground as the spot says, and a gallery building's deed kept, its own or the row's it moves.
  const centre = { x: 120.5, z: -33.25 };
  const here = 'tatooine';
  const sources = [
    { kind: 'prop' as const, pack: 'props' as const, thing: 'test_chair', template: 'object/tangible/test/shared_test_chair.iff' },
    { kind: 'building' as const, pack: 'gallery' as const, model: 'test_house', template: 'object/building/test/shared_test_house.iff', deed: 'test_deed' },
    { kind: 'prop' as const, pack: 'world' as const, model: 'test_rock', template: 'object/static/test/shared_test_rock.iff', from: here },
    { kind: 'prop' as const, pack: 'world' as const, model: 'test_tree', template: 'object/tangible/test/shared_test_tree.iff', from: 'naboo' },
  ];
  // A turn about up with a tilt, made unit.
  const yaw = 1.234;
  const tilt = 0.2;
  const raw = [Math.sin(tilt / 2) * Math.cos(yaw / 2), Math.sin(yaw / 2) * Math.cos(tilt / 2), Math.sin(tilt / 2) * Math.sin(yaw / 2), Math.cos(yaw / 2) * Math.cos(tilt / 2)];
  const n = Math.hypot(...raw);
  const turn = raw.map((v) => v / n) as [number, number, number, number];
  const at = { x: 37.1234567, y: 4.4444444, z: -12.987654 };
  let held = 0;
  let worst = 0;
  let worstTurn = 0;
  const bad: string[] = [];
  for (const frame of ['raw', 'game'] as const) {
    for (const inside of [false, true]) {
      for (const src of sources) {
        const c = frame === 'raw' ? centre : null;
        const draft = rowFromEditor(src, at, turn, inside, c, frame, { here, clear: 12.34, ground: inside ? null : 3.21, mm: 0.001, turnDigits: 6 });
        const unknown: string[] = [];
        const row = readPlacementRow({ id: 'rt-1', ...draft }, unknown);
        const what = `${src.pack}${src.pack === 'world' ? `/${src.from}` : ''} ${frame} ${inside ? 'in a room' : 'outside'}`;
        if (typeof row === 'string' || unknown.length) {
          bad.push(`${what}: ${typeof row === 'string' ? row : unknown.join(', ')}`);
          continue;
        }
        const g = toGame(row, c, frame);
        const d = Math.max(Math.abs(g.x - at.x), Math.abs(g.y - at.y), Math.abs(g.z - at.z));
        const dot = Math.abs(g.q[0] * turn[0] + g.q[1] * turn[1] + g.q[2] * turn[2] + g.q[3] * turn[3]);
        worst = Math.max(worst, d);
        worstTurn = Math.max(worstTurn, 1 - dot);
        if (d > 0.0005 + 1e-9) bad.push(`${what}: place ${d.toFixed(6)} m off`);
        if (1 - dot > 1e-9) bad.push(`${what}: turn off by ${(1 - dot).toExponential(2)}`);
        if ((row.template !== undefined) !== (src.pack !== 'props')) bad.push(`${what}: template ${row.template ?? 'absent'}`);
        if (row.template !== undefined && row.template !== src.template) bad.push(`${what}: the wrong template`);
        const otherWorld = src.pack === 'world' && src.from !== here;
        if ((row.from !== undefined) !== otherWorld || (otherWorld && row.from !== src.from)) bad.push(`${what}: from ${row.from ?? 'absent'}`);
        if (!!row.inside !== inside) bad.push(`${what}: inside ${row.inside}`);
        if ((row.ground !== undefined) === inside) bad.push(`${what}: ground ${row.ground}`);
        if (row.clear !== 12.3) bad.push(`${what}: clear ${row.clear}`);
        if ((row.deed === 'test_deed') !== (src.pack === 'gallery')) bad.push(`${what}: deed ${row.deed}`);
        if ((row.thing !== undefined) !== (src.pack === 'props') || (row.model !== undefined) === (src.pack === 'props')) bad.push(`${what}: thing or model`);
        held++;
      }
    }
  }
  ok(bad.length === 0 && held === 16, `every row the editor writes reads back and stands where it was put, within ${(worst * 1000).toFixed(3)} mm and a turn ${worstTurn.toExponential(1)} off, its template, world, room, ground, clear and deed as the rules say (${held} of 16${bad.length ? `: ${bad.join('; ')}` : ''})`);
  // A gallery row picked up and put down: its deed and id kept, though the source names none.
  const base = readPlacementRow({ id: 'house-7', kind: 'building', pack: 'gallery', model: 'test_house', deed: 'test_deed', template: 'object/building/test/shared_test_house.iff', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], name: 'TEST house' });
  if (typeof base !== 'string') {
    const moved = rowFromEditor({ kind: 'building', pack: 'gallery', model: 'test_house', template: 'object/building/test/shared_test_house.iff' }, at, turn, false, centre, 'raw', { here, base, ground: 0 });
    ok(moved.id === 'house-7' && moved.deed === 'test_deed' && moved.name === 'TEST house', "a gallery row picked up and put down keeps its id, its deed and its words (the endpoint's put writes the whole row)");
  }
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const edits = readFileSync(join(here, '..', '..', '..', 'src', 'world', 'placementEdits.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(edits.includes('const full = readPlacementsFileRaw(text, world, kind);') && !edits.includes('parseJsonc('), 'the endpoint reads each layer once (`readPlacementsFileRaw`), never parsing it a second time');
  ok(edits.includes('const backById = new Map<string, PlacementRow>();') && !/back\.rows\.find\(/.test(edits), 'and looks the read-back up in a Map, so a put is linear in the file');
  ok(/const full = \(l: PlacementLayer\) => held\[l\]\.rows\.length >= PLACEMENT_LIMITS\.rows;/.test(edits), "its cap is the reader's backstop");
}

console.log(`\n${checks} checks passed`);
