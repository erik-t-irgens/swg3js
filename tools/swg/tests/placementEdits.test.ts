// The placement editor's endpoint, its rules alone (`src/world/placementEdits.ts`): who may ask, and what one
// ask does to a world's two files of permanent placements. Every refusal the design lists is asked here and
// answered in its own status, and every op is run against files written the way the editor writes them and
// the way an owner writes them by hand: a put of a new row and of one already there, a delete, a move across the
// layers, a rename. A row nobody asked about is written back exactly as it was read, fields this build does not
// read included; a file is taken away when its last row goes; the same ask at the same moment writes the same
// bytes; and what the answer says the layers read as is what the written file reads as, which is what makes the
// dev server's own word that the file changed find nothing left to do.
//
// Nothing here touches a file. Run: node tools/swg/tests/placementEdits.test.ts
import assert from 'node:assert/strict';
import { PLACEMENTS_ENDPOINT_TUNE, EDITOR_HEADER_VALUE, applyPlacementOp, editFile, refuseRequest, type EditWorldKind, type PlacementAnswer } from '../../../src/world/placementEdits.ts';
import { PLACEMENT_LIMITS, placementsFileText, readPlacementsFile, type PlacementRow } from '../../../src/story/placements.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ---------------------------------------------------------------------------------------------
// Who may ask.
{
  const good = { method: 'POST', remoteAddress: '127.0.0.1', origin: 'http://localhost:5183', host: 'localhost:5183', dev: EDITOR_HEADER_VALUE, contentType: 'application/json', length: 120 };
  ok(refuseRequest(good) === null, 'a POST from this machine, from the page, with the header and a JSON body, is heard');
  ok(refuseRequest({ ...good, remoteAddress: '::1' }) === null && refuseRequest({ ...good, remoteAddress: '::ffff:127.0.0.1' }) === null, 'from this machine by either way of writing it');
  ok(refuseRequest({ ...good, contentType: 'application/json; charset=utf-8' }) === null && refuseRequest({ ...good, length: null }) === null, 'a charset on the type, or no length said, is fine');
  ok(refuseRequest({ ...good, method: 'GET' })?.status === 405 && refuseRequest({ ...good, method: 'PUT' })?.status === 405, 'anything but a POST is 405');
  ok(refuseRequest({ ...good, remoteAddress: '192.168.1.20' })?.status === 403 && refuseRequest({ ...good, remoteAddress: null })?.status === 403, 'another machine on the network is 403 (the dev server listens on every interface)');
  ok(refuseRequest({ ...good, origin: 'http://evil.example' })?.status === 403 && refuseRequest({ ...good, origin: null })?.status === 403 && refuseRequest({ ...good, origin: 'https://localhost:5183' })?.status === 403, 'an Origin that is not the page asked, or none, is 403');
  ok(refuseRequest({ ...good, dev: null })?.status === 403 && refuseRequest({ ...good, dev: 'other' })?.status === 403, 'an ask without the editor\'s own header is 403');
  ok(refuseRequest({ ...good, contentType: 'text/plain' })?.status === 415 && refuseRequest({ ...good, contentType: null })?.status === 415 && refuseRequest({ ...good, contentType: 'application/jsonx' })?.status === 415, 'a body that does not say it is JSON is 415');
  ok(refuseRequest({ ...good, length: PLACEMENTS_ENDPOINT_TUNE.bodyMax + 1 })?.status === 413 && refuseRequest({ ...good, length: PLACEMENTS_ENDPOINT_TUNE.bodyMax })?.status === undefined, `a body over ${PLACEMENTS_ENDPOINT_TUNE.bodyMax} bytes is 413, and one at the cap is heard`);
}

// ---------------------------------------------------------------------------------------------
// What an ask does.
const worlds = new Map<string, EditWorldKind>([
  ['tatooine', 'ground'],
  ['space_tatooine', 'space'],
  ['dungeon1', 'copies'],
]);
const ctx = (now = 1_760_000_000_000) => ({ worlds, now });
const crate = (extra: Partial<PlacementRow> = {}): Record<string, unknown> => ({ kind: 'prop', pack: 'props', thing: 'crate_s01', x: 3476.5, y: 5.25, z: -4694, q: [1, 0, 0, 0], ...extra });
const none = { story: null, world: null };
const body = (a: PlacementAnswer) => a.body as Extract<PlacementAnswer['body'], { ok: true }>;
const why = (a: PlacementAnswer) => (a.body.ok ? '' : a.body.why);
const fileOf = (rows: PlacementRow[], world = 'tatooine', frame: 'raw' | 'game' = 'raw') => placementsFileText(world, frame, rows);

{
  // Refused, each in its own status, and nothing written.
  const refused: [string, unknown, { story: string | null; world: string | null }, number][] = [
    ['an ask that is not an object', [1], none, 400],
    ['an op it does not know', { op: 'burn', layer: 'world', world: 'tatooine' }, none, 400],
    ['an unknown layer', { op: 'put', layer: 'private', world: 'tatooine', row: crate() }, none, 400],
    ['a world that is not a pack id', { op: 'put', layer: 'world', world: '../tatooine', row: crate() }, none, 400],
    ['a world with a capital', { op: 'put', layer: 'world', world: 'Tatooine', row: crate() }, none, 400],
    ['a world there is not', { op: 'put', layer: 'world', world: 'hoth', row: crate() }, none, 404],
    ['the dungeons\' world of copies', { op: 'put', layer: 'world', world: 'dungeon1', row: crate() }, none, 409],
    ['a bad row', { op: 'put', layer: 'world', world: 'tatooine', row: crate({ q: [1, 1, 0, 0] }) }, none, 400],
    ['a row of fields this build does not write', { op: 'put', layer: 'world', world: 'tatooine', row: { ...crate(), colour: 'red' } }, none, 400],
    ['a put with no row', { op: 'put', layer: 'world', world: 'tatooine' }, none, 400],
    ['a delete of a row that is not there', { op: 'delete', layer: 'world', world: 'tatooine', id: 'nothing-here' }, none, 404],
    ['a delete with no id', { op: 'delete', layer: 'world', world: 'tatooine' }, none, 400],
    ['a rename to an id that is not one', { op: 'rename', layer: 'world', world: 'tatooine', id: 'a', to: 'Bad Id' }, { story: null, world: fileOf([{ id: 'a', ...(crate() as object) } as PlacementRow]) }, 400],
    ['a move within one layer', { op: 'move', from: 'world', layer: 'world', world: 'tatooine', id: 'a' }, none, 400],
    ['a file that does not read', { op: 'put', layer: 'world', world: 'tatooine', row: crate() }, { story: null, world: '{ "version": 1, ' }, 409],
    ['a file of another world', { op: 'put', layer: 'world', world: 'tatooine', row: crate() }, { story: null, world: fileOf([], 'naboo') }, 409],
    ['a file in the wrong frame', { op: 'put', layer: 'world', world: 'space_tatooine', row: crate() }, { story: null, world: fileOf([], 'space_tatooine', 'raw') }, 409],
  ];
  for (const [what, op, current, status] of refused) {
    const a = applyPlacementOp(op, current, ctx());
    ok(a.status === status && !a.body.ok && a.writes.length === 0, `refused: ${what} (${a.status}: ${why(a)})`);
  }
  // A file holding a row this build cannot read is refused whole, or writing it back would lose that row.
  const handBad = `{\n  "version": 1,\n  "world": "tatooine",\n  "frame": "raw",\n  "rows": [\n    { "id": "fine", "kind": "prop", "pack": "props", "thing": "crate_s01", "x": 1, "y": 2, "z": 3, "q": [1, 0, 0, 0] },\n    { "id": "typo", "kind": "prop", "pack": "props", "thing": "crate_s01", "x": "one", "y": 2, "z": 3, "q": [1, 0, 0, 0] }\n  ]\n}\n`;
  const bad = applyPlacementOp({ op: 'put', layer: 'world', world: 'tatooine', row: crate() }, { story: null, world: handBad }, ctx());
  ok(bad.status === 409 && /typo/.test(why(bad)) && /mend/.test(why(bad)), `refused: a file holding a row it cannot read, named (${why(bad)})`);
  // One id across both layers.
  const inStory = fileOf([{ id: 'locker', ...(crate() as object) } as PlacementRow]);
  const clash = applyPlacementOp({ op: 'put', layer: 'world', world: 'tatooine', row: crate({ id: 'locker' } as Partial<PlacementRow>) }, { story: inStory, world: null }, ctx());
  ok(clash.status === 409 && why(clash) === "that id is in the story's dressing", `refused: an id the other layer holds (${why(clash)})`);
  const back = applyPlacementOp({ op: 'put', layer: 'story', world: 'tatooine', row: crate({ id: 'locker' } as Partial<PlacementRow>) }, { story: null, world: inStory.replace('"world": "tatooine"', '"world": "tatooine"') }, ctx());
  ok(back.status === 409 && why(back) === 'that id is in the world edits', 'and the same the other way round');
  const taken = applyPlacementOp({ op: 'rename', layer: 'world', world: 'tatooine', id: 'a', to: 'locker' }, { story: inStory, world: fileOf([{ id: 'a', ...(crate() as object) } as PlacementRow]) }, ctx());
  ok(taken.status === 409, 'and a rename to an id the other layer holds');
  // The cap.
  const full: PlacementRow[] = [];
  for (let i = 0; i < PLACEMENT_LIMITS.rows; i++) full.push({ id: `r${i}`, kind: 'prop', pack: 'props', thing: 'crate_s01', x: i, y: 0, z: 0, q: [1, 0, 0, 0] });
  const fullText = fileOf(full);
  const over = applyPlacementOp({ op: 'put', layer: 'world', world: 'tatooine', row: crate() }, { story: null, world: fullText }, ctx());
  ok(over.status === 409 && new RegExp(`${PLACEMENT_LIMITS.rows} rows`).test(why(over)), `refused: a new row past the ${PLACEMENT_LIMITS.rows} rows a file may hold`);
  const replace = applyPlacementOp({ op: 'put', layer: 'world', world: 'tatooine', row: crate({ id: 'r5', x: 99 } as Partial<PlacementRow>) }, { story: null, world: fullText }, ctx());
  ok(replace.status === 200 && body(replace).world?.rows.length === PLACEMENT_LIMITS.rows, 'while a row already there is still replaced in a full file');
}

{
  // A put of a new row: an id minted from its thing, stamped, one line in a new file.
  const a = applyPlacementOp({ op: 'put', layer: 'world', world: 'tatooine', row: crate() }, none, ctx());
  ok(a.status === 200 && body(a).id === 'crate_s01-1' && body(a).layer === 'world' && body(a).file === 'public/placements/world/tatooine.json' && body(a).file === editFile('world', 'tatooine'), `a new row is given an id from its thing (${body(a).id}) and the answer names the file`);
  ok(a.writes.length === 1 && a.writes[0].layer === 'world' && typeof a.writes[0].text === 'string', 'one file written');
  const text = a.writes[0].text!;
  const read = readPlacementsFile(text, 'tatooine', 'ground');
  ok(!read.problem && read.skipped.length === 0 && read.rows.length === 1 && read.rows[0].at === 1_760_000_000_000 && read.rows[0].x === 3476.5, 'which reads back whole, stamped with the moment');
  ok(JSON.stringify(body(a).world) === JSON.stringify(read) && body(a).story === null, 'and the answer is both layers exactly as the written file reads, the story none');
  ok(text === placementsFileText('tatooine', 'raw', read.rows), 'written as the reader writes it: one line a row, a fixed order, no comment');
  // The same ask at the same moment writes the same bytes; a second new crate takes the next number.
  ok(applyPlacementOp({ op: 'put', layer: 'world', world: 'tatooine', row: crate() }, none, ctx()).writes[0].text === text, 'the same ask at the same moment writes the same bytes');
  const b = applyPlacementOp({ op: 'put', layer: 'world', world: 'tatooine', row: crate({ x: 3480 }) }, { story: null, world: text }, ctx());
  ok(body(b).id === 'crate_s01-2' && body(b).world?.rows.length === 2, 'a second of one thing is given the next id, the first kept');
  // The id is minted clear of both layers: a fresh crate into the world edits beside a story crate of the same
  // thing takes the next number, where minted against its own layer alone it was refused as the story's (a hand
  // carries no id, so nothing in the game could get past that).
  const storyHas = fileOf([{ id: 'crate_s01-1', kind: 'prop', pack: 'props', thing: 'crate_s01', x: 1, y: 0, z: 1, q: [1, 0, 0, 0] }]);
  const across = applyPlacementOp({ op: 'put', layer: 'world', world: 'tatooine', row: crate() }, { story: storyHas, world: null }, ctx());
  ok(across.status === 200 && body(across).id === 'crate_s01-2', `a new row's id is minted clear of the other layer too (${across.status}, ${across.status === 200 ? body(across).id : why(across)})`);
  // The ground a row was judged on is written and read back as it was asked for.
  const grounded = applyPlacementOp({ op: 'put', layer: 'world', world: 'tatooine', row: crate({ ground: 4.125 }) }, none, ctx());
  ok(grounded.status === 200 && body(grounded).world?.rows[0].ground === 4.125 && /"ground": 4\.125/.test(grounded.writes[0].text!), 'a row carrying the ground it was judged on is written with it, and reads back the same');
  // A space zone's file is the game's own frame.
  const s = applyPlacementOp({ op: 'put', layer: 'story', world: 'space_tatooine', row: crate({ x: 1500, z: 900 }) }, none, ctx());
  ok(s.status === 200 && /"frame": "game"/.test(s.writes[0].text!), "a space zone's file says the game's own frame");
}

{
  // A put replacing a row: every other row exactly as it was read, words and fields this build does not read
  // included; the replaced row keeps those fields of its own too.
  const hand = `{\n  "version": 1,\n  "world": "tatooine",\n  "frame": "raw",\n  "rows": [\n    { "id": "locker", "kind": "prop", "pack": "props", "thing": "crate_s01", "x": 3448.12, "y": 5.03, "z": -4688.4, "q": [0.92388, 0, 0.38268, 0], "solid": true, "inside": true, "name": "Locker", "note": "the drawer and the coat hooks", "fill": "later" },\n    { "id": "anchorhead-house-1", "kind": "building", "pack": "gallery", "model": "ply_tato_house_sm_s01_fp1", "x": 0, "y": 12.4, "z": 0, "q": [0.70711, 0, 0.70711, 0], "clear": 14.5, "locked": true }\n  ]\n}\n`;
  const lineOf = (text: string, id: string) => text.split('\n').find((l) => l.includes(`"id": "${id}"`)) ?? '';
  const a = applyPlacementOp({ op: 'put', layer: 'story', world: 'tatooine', row: crate({ id: 'locker', x: 3449, name: 'Locker' } as Partial<PlacementRow>) }, { story: hand, world: null }, ctx());
  ok(a.status === 200 && a.writes.length === 1 && a.writes[0].layer === 'story', 'a row replaced writes its own layer alone');
  const text = a.writes[0].text!;
  const house = lineOf(text, 'anchorhead-house-1');
  ok(house.includes('"q": [0.70711,0,0.70711,0]') && house.includes('"locked": true') && house.includes('"clear": 14.5') && !house.includes('"at"'), `a row nobody asked about goes back exactly as it was read, its unread field and its hand-typed turn included (${house.trim()})`);
  const locker = lineOf(text, 'locker');
  ok(locker.includes('"x": 3449') && locker.includes('"fill": "later"') && locker.includes('"at": 1760000000000') && !locker.includes('"note"'), `the replaced row is the row asked for, stamped, and keeps the unread field it carried (${locker.trim()})`);
  const read = readPlacementsFile(text, 'tatooine', 'ground');
  ok(read.rows.length === 2 && read.skipped.length === 0 && read.unknown.length === 0, 'and the file reads back whole');
  // The other layer is untouched and answered as it reads.
  const w = fileOf([{ id: 'wall', ...(crate() as object) } as PlacementRow]);
  const both = applyPlacementOp({ op: 'put', layer: 'story', world: 'tatooine', row: crate({ id: 'locker' } as Partial<PlacementRow>) }, { story: hand, world: w }, ctx());
  ok(both.writes.length === 1 && JSON.stringify(body(both).world) === JSON.stringify(readPlacementsFile(w, 'tatooine', 'ground')), 'the other layer is not written, and is answered as it reads');
}

{
  // A delete; the last row takes the file with it.
  const two = fileOf([{ id: 'a', ...(crate() as object) } as PlacementRow, { id: 'b', ...(crate({ x: 1 }) as object) } as PlacementRow]);
  const d = applyPlacementOp({ op: 'delete', layer: 'world', world: 'tatooine', id: 'a' }, { story: null, world: two }, ctx());
  ok(d.status === 200 && body(d).world?.rows.map((r) => r.id).join() === 'b' && d.writes[0].text !== null, 'a delete takes the one row out and keeps the rest');
  const last = applyPlacementOp({ op: 'delete', layer: 'world', world: 'tatooine', id: 'b' }, { story: null, world: d.writes[0].text }, ctx());
  ok(last.status === 200 && last.writes.length === 1 && last.writes[0].text === null && body(last).world === null, 'and taking out the last row takes the file away, so nothing is left behind for git');
}

{
  // A move across the layers, with a new place and with none; then a rename.
  const story = fileOf([{ id: 'locker', ...(crate({ name: 'Locker' }) as object) } as PlacementRow, { id: 'stays', ...(crate({ x: 7 }) as object) } as PlacementRow]);
  const m = applyPlacementOp({ op: 'move', from: 'story', layer: 'world', world: 'tatooine', id: 'locker', row: crate({ x: 3500, name: 'Locker' }) }, { story, world: null }, ctx());
  ok(m.status === 200 && m.writes.length === 2 && body(m).layer === 'world' && body(m).file === editFile('world', 'tatooine'), 'a move writes both files and names the one it went to');
  ok(body(m).story?.rows.map((r) => r.id).join() === 'stays' && body(m).world?.rows.length === 1 && body(m).world?.rows[0].x === 3500 && body(m).world?.rows[0].name === 'Locker', 'out of the story, into the world edits, at its new place');
  const plain = applyPlacementOp({ op: 'move', from: 'world', layer: 'story', world: 'tatooine', id: 'locker' }, { story: m.writes.find((w) => w.layer === 'story')!.text, world: m.writes.find((w) => w.layer === 'world')!.text }, ctx(1_760_000_000_500));
  ok(plain.status === 200 && body(plain).story?.rows.find((r) => r.id === 'locker')?.x === 3500 && body(plain).world === null && plain.writes.some((w) => w.layer === 'world' && w.text === null), 'moved back with no new place it is as it was, and the emptied file is taken away');
  ok(body(plain).story?.rows.find((r) => r.id === 'locker')?.at === 1_760_000_000_500, 'stamped with the moment it moved');
  const r = applyPlacementOp({ op: 'rename', layer: 'story', world: 'tatooine', id: 'locker', to: 'eisley-bay22-locker' }, { story: plain.writes.find((w) => w.layer === 'story')!.text, world: null }, ctx());
  ok(r.status === 200 && body(r).id === 'eisley-bay22-locker' && body(r).story?.rows.some((x) => x.id === 'eisley-bay22-locker' && x.x === 3500 && x.name === 'Locker') && !body(r).story?.rows.some((x) => x.id === 'locker'), 'a rename gives the row its new id, keeping everything else');
}

console.log(`\n${passed} checks passed`);
