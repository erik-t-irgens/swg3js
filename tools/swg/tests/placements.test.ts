// The permanent placements' files, read: the shape both layers share (`src/story/placements.ts`), the frame
// they are written in, how two layers are joined and what a sync does.
//
// What is worth pinning here, rather than what is easy to pin:
//
//  - **A bad row is skipped and named, a file never thrown away for one**, and a file whose header is not this
//    world's (its version, its world, its frame) is refused whole, since every row in it would be read in the
//    wrong place.
//  - **The raw frame is the layout's own**: a row stands exactly where the streamer would stand a snapshot
//    object written with the same numbers, so the test builds that very quaternion and those very coordinates
//    the way the streamer's constructor does and compares.
//  - **A story object can name a row with nothing in the story changed**: `place/<id>` passes the story's own
//    template pattern.
//  - **A sync takes down only what moved**: a row's name, note and time are words about it, and a change to
//    them re-stands nothing.
//
//  - **`status` only says which pack the rows need** (`tools/swg/placementsStatus.mjs`): a machine with no
//    placements folder (every one today) reads none and does not fail, and nothing about a file somebody wrote
//    is ever a step to run.
//
// Plain node with type stripping: the modules under test are imported with their extensions.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { placementPackLines, placementRows, placementsFolder, worldPackCommand } from '../placementsStatus.mjs';
import { TEMPLATE } from '../../../src/story/set.ts';
import { parseJsonc } from '../../../src/story/jsonc.ts';
import { PLACEMENT_LIMITS, fromGame, isPlacementId, mergeLayers, mintPlacementId, placementFileOf, placementIdOf, placementKey, placementsFileText, placementsPath, radiusOfBounds, readPlacementRow, readPlacementsFile, rowHash, storyAreaSnippet, storyObjectSnippet, syncPlan, toGame, type PlacementRow } from '../../../src/story/placements.ts';
import { gameX, gameZ } from '../../../src/world/placedTiers.ts';
import { DRESSING_TUNE } from '../../../src/world/permanent.ts';

let checks = 0;
let bad = 0;
function ok(what: string, pass: boolean, note = ''): void {
  checks++;
  if (!pass) {
    bad++;
    console.log(`  FAIL ${what}${note ? `: ${note}` : ''}`);
  }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const crate: PlacementRow = { id: 'eisley-bay22-locker', kind: 'prop', pack: 'props', thing: 'placable_loot_crate', x: 3448.12, y: 5.03, z: -4688.4, q: [0.92388, 0, 0.38268, 0], solid: true, inside: true, name: 'Locker', note: 'the drawer and the coat hooks', at: 1760000000000 };
const house: PlacementRow = { id: 'anchorhead-house-1', kind: 'building', pack: 'gallery', model: 'ply_tato_house_sm_s01_fp1', deed: 'tatooine_house_small_deed', x: 0, y: 12.4, z: 0, q: [0.70711, 0, 0.70711, 0], clear: 14.5 };
const fileOf = (rows: unknown[], head: Record<string, unknown> = {}) => JSON.stringify({ version: 1, world: 'tatooine', frame: 'raw', rows, ...head });

// ---- Reading a file --------------------------------------------------------------------------------

{
  const r = readPlacementsFile(fileOf([crate, house]), 'tatooine', 'ground');
  ok('a good file reads whole', r.problem === null && r.rows.length === 2 && r.skipped.length === 0 && r.unknown.length === 0, JSON.stringify(r.skipped));
  ok('and its rows come back as they were written, the turn renormalised', r.rows[0].id === crate.id && r.rows[0].thing === crate.thing && near(Math.hypot(...r.rows[0].q), 1, 1e-12) && r.rows[1].clear === 14.5 && r.rows[1].deed === house.deed);
  ok("what the reader keeps of a row is the row's own fields", r.rows[0].inside === true && r.rows[0].note === crate.note && r.rows[0].at === crate.at);
  // A hand-written file with a comment and a trailing comma still reads: the files are JSON, but a person's edit may not be.
  const lenient = readPlacementsFile(`// by hand\n{ "version": 1, "world": "tatooine", "frame": "raw", "rows": [ ${JSON.stringify(crate)}, ], }`, 'tatooine', 'ground');
  ok('a comment and a trailing comma written by hand do not refuse a file', lenient.problem === null && lenient.rows.length === 1, lenient.problem ?? '');
}
{
  // Each bad field, one row at a time, beside a good one that must still stand.
  const cases: [string, Record<string, unknown>][] = [
    ['an id with a capital', { ...crate, id: 'Locker' }],
    ['an id with a slash', { ...crate, id: 'a/b' }],
    ['an id too long', { ...crate, id: 'a'.repeat(65) }],
    ['a kind that is not prop or building', { ...crate, kind: 'tree' }],
    ['a pack that is not props, gallery or world', { ...crate, pack: 'snapshot' }],
    ['a building out of the props pack', { ...crate, kind: 'building' }],
    ['a props row with no thing', { ...crate, thing: undefined }],
    ['a gallery row with no model', { ...house, model: undefined }],
    ['a model with a space', { ...house, model: 'ply tato' }],
    ['a deed that is not an id', { ...house, deed: 'a deed' }],
    ['a place that is not a number', { ...crate, x: 'over there' }],
    ['a place too far out', { ...crate, z: PLACEMENT_LIMITS.reach + 1 }],
    ['a height too far off', { ...crate, y: -(PLACEMENT_LIMITS.height + 1) }],
    ['a turn of three numbers', { ...crate, q: [1, 0, 0] }],
    ['a turn that is not a turn', { ...crate, q: [1, 0, 0.1, 0] }],
    ['solid that is not true or false', { ...crate, solid: 'yes' }],
    ['a clear past the limit', { ...house, clear: PLACEMENT_LIMITS.circle + 1 }],
    ['a negative guard', { ...crate, guard: -1 }],
    ['a name too long', { ...crate, name: 'n'.repeat(PLACEMENT_LIMITS.name + 1) }],
    ['a note too long', { ...crate, note: 'n'.repeat(PLACEMENT_LIMITS.note + 1) }],
    ['a time that is not a time', { ...crate, at: -5 }],
  ];
  for (const [what, row] of cases) {
    const r = readPlacementsFile(fileOf([row, { ...house, id: 'other-house' }]), 'tatooine', 'ground');
    ok(`${what} is skipped and named, and the file kept`, r.problem === null && r.rows.length === 1 && r.rows[0].id === 'other-house' && r.skipped.length === 1 && r.skipped[0].why.length > 0, JSON.stringify(r.skipped));
  }
  const nearly = readPlacementsFile(fileOf([{ ...crate, q: [1.0005, 0, 0, 0] }]), 'tatooine', 'ground');
  ok('a turn within the limit of one is renormalised, not refused', nearly.rows.length === 1 && near(nearly.rows[0].q[0], 1, 1e-12));
  const named = readPlacementsFile(fileOf([{ ...crate, q: 'turned' }]), 'tatooine', 'ground');
  ok('a refused row is named by its id', named.skipped[0]?.id === crate.id);
  const nameless = readPlacementsFile(fileOf([{ ...crate, id: 7 }]), 'tatooine', 'ground');
  ok('and one with no id of its own by its place in the list', nameless.skipped[0]?.id === '#0');
  const twice = readPlacementsFile(fileOf([crate, { ...crate, x: 1 }]), 'tatooine', 'ground');
  ok('a second row under one id is skipped, the first kept', twice.rows.length === 1 && twice.rows[0].x === crate.x && twice.skipped[0]?.why.includes('same id'));
  const extra = readPlacementsFile(fileOf([{ ...crate, colour: 'red', fill: true, locked: 'keypad' }]), 'tatooine', 'ground');
  ok('a field this build does not read is named and never a refusal; the reserved ones are read and set aside', extra.rows.length === 1 && extra.unknown.length === 1 && extra.unknown[0] === `${crate.id}.colour` && !('fill' in extra.rows[0]));
  const many = Array.from({ length: PLACEMENT_LIMITS.rows + 3 }, (_, i) => ({ ...crate, id: `crate-${i}` }));
  const capped = readPlacementsFile(fileOf(many), 'tatooine', 'ground');
  ok(`a file keeps ${PLACEMENT_LIMITS.rows} rows and names the rest`, capped.rows.length === PLACEMENT_LIMITS.rows && capped.skipped.length === 3 && capped.skipped.every((s) => s.why.includes(String(PLACEMENT_LIMITS.rows))));
}
{
  // The header: refused whole.
  const notJson = readPlacementsFile('{ "rows": [', 'tatooine', 'ground');
  ok('a file that does not read is refused with where', notJson.problem !== null && /line \d+/.test(notJson.problem) && notJson.rows.length === 0);
  ok('so is one of another version', readPlacementsFile(fileOf([crate], { version: 2 }), 'tatooine', 'ground').problem !== null);
  ok("so is one whose world is not its name's", readPlacementsFile(fileOf([crate], { world: 'naboo' }), 'tatooine', 'ground').problem !== null);
  ok('so is one with no rows list', readPlacementsFile(JSON.stringify({ version: 1, world: 'tatooine', frame: 'raw' }), 'tatooine', 'ground').problem !== null);
  const space = (frame: string) => readPlacementsFile(JSON.stringify({ version: 1, world: 'space_tatooine', frame, rows: [crate] }), 'space_tatooine', 'space');
  ok("a space zone's file in the raw frame is refused", space('raw').problem !== null && space('raw').rows.length === 0);
  ok("and in the game's own it reads", space('game').problem === null && space('game').rows.length === 1);
  ok("a planet's in the game's frame is refused too", readPlacementsFile(fileOf([crate], { frame: 'game' }), 'tatooine', 'ground').problem !== null);
}

// ---- The frame -------------------------------------------------------------------------------------

{
  const centre = { x: 312.5, z: -77.25 };
  // The streamer's own constructor, for a layout object written with these numbers.
  const row: PlacementRow = { ...crate, q: [0.5, 0.5, 0.5, 0.5] };
  const g = toGame(row, centre);
  const qStream = new THREE.Quaternion(row.q[1], -row.q[2], -row.q[3], row.q[0]);
  ok("a raw row lands where the streamer stands a snapshot object of the same numbers", near(g.x, gameX(row.x, centre.x), 1e-9) && near(g.z, gameZ(row.z, centre.z), 1e-9) && g.y === row.y);
  ok("and is turned as the streamer turns it", near(g.q[0], qStream.x) && near(g.q[1], qStream.y) && near(g.q[2], qStream.z) && near(g.q[3], qStream.w));
  const back = fromGame(g, centre);
  ok('and comes back to the file exactly', near(back.x, row.x, 1e-9) && near(back.z, row.z, 1e-9) && back.q.every((n, i) => near(n, row.q[i])));
  // A pure yaw: in the raw frame it is the game's yaw negated.
  const yaw = 0.6;
  const yawRow: PlacementRow = { ...house, q: [Math.cos(yaw / 2), 0, Math.sin(yaw / 2), 0] };
  const gy = toGame(yawRow, centre);
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(gy.q[0], gy.q[1], gy.q[2], gy.q[3]), 'YXZ');
  ok('a row turned by a yaw stands turned by that yaw negated', near(e.y, -yaw, 1e-9) && near(e.x, 0, 1e-12) && near(e.z, 0, 1e-12), `yaw ${e.y}`);
  // The game's own frame is read as it stands.
  const sg = toGame(row, centre, 'game');
  ok("a space zone's row is read in the game's frame as written", sg.x === row.x && sg.z === row.z && sg.q[0] === row.q[1] && sg.q[3] === row.q[0]);
  const sb = fromGame(sg, null, 'game');
  ok('and written back the same way', sb.x === row.x && sb.q.every((n, i) => n === row.q[i]));
  // Written into a kept record when one is handed over.
  const kept = { x: 0, y: 0, z: 0, q: [0, 0, 0, 1] as [number, number, number, number] };
  ok('a kept place is written into and handed back', toGame(row, centre, 'raw', kept) === kept && kept.x === g.x);
}

// ---- Keys, ids, joins and plans ---------------------------------------------------------------------

{
  ok("a row's key passes the story's own template pattern", TEMPLATE.test(placementKey('eisley-bay22-locker')) && TEMPLATE.test(placementKey('a'.repeat(64))));
  ok('and its id comes back out of it, and nothing else does', placementIdOf(placementKey('locker')) === 'locker' && placementIdOf('prop:abc') === null && placementIdOf('object/tangible/x.iff') === null);
  ok('an id is lower case, digits, _ and -', isPlacementId('bay-22_locker') && !isPlacementId('-lead') && !isPlacementId('Bay') && !isPlacementId(''));
  const taken = new Set<string>();
  for (let i = 0; i < 500; i++) taken.add(mintPlacementId('Corellian Crate!!', taken));
  ok('a minted id is never one already taken', taken.size === 500 && [...taken].every((id) => isPlacementId(id) && id.startsWith('corellian-crate-')));
  ok('and a name with nothing usable in it still mints one', isPlacementId(mintPlacementId('!!!', new Set())));
  ok("a box's radius is half its wider span on the ground, whichever way its corners were written", radiusOfBounds({ min: [-2, 0, -1], max: [2, 3, 1] }) === 2 && radiusOfBounds({ min: [2, 3, 1], max: [-2, 0, -1] }) === 2 && radiusOfBounds(null) === 0);
}
{
  const a: PlacementRow = { ...crate, id: 'a' };
  const b: PlacementRow = { ...house, id: 'b' };
  const m = mergeLayers([a, b], [{ ...a, x: 9 }]);
  ok('both layers holding one id: the world edit is kept and the story row is a clash', m.rows.length === 2 && m.rows.find((e) => e.row.id === 'a')?.layer === 'world' && m.rows.find((e) => e.row.id === 'a')?.row.x === 9 && m.clashes.length === 1 && m.clashes[0] === 'a');
}
{
  const p1: PlacementRow = { ...crate, id: 'p1' };
  const p2: PlacementRow = { ...crate, id: 'p2' };
  const b1: PlacementRow = { ...house, id: 'b1' };
  const b2: PlacementRow = { ...house, id: 'b2' };
  const standing = new Map<string, string>([
    [placementKey('p1'), rowHash(p1)],
    [placementKey('b1'), rowHash(b1)],
    [placementKey('gone'), rowHash(p1)],
  ]);
  const plan = syncPlan(standing, [
    { row: { ...p1, x: p1.x + 2 }, layer: 'story' },
    { row: p2, layer: 'story' },
    { row: b1, layer: 'world' },
    { row: b2, layer: 'world' },
  ]);
  ok('a sync adds what stands nowhere, buildings first', plan.add.map((e) => e.row.id).join() === 'b2,p2');
  ok('takes down what no row names', plan.remove.join() === placementKey('gone'));
  ok('and stands again only what moved', plan.change.map((e) => e.row.id).join() === 'p1');
  const words = syncPlan(new Map([[placementKey('p1'), rowHash(p1)]]), [{ row: { ...p1, name: 'Other', note: 'a word', at: 5 }, layer: 'story' }]);
  ok('a change to a row\'s name, note or time re-stands nothing', words.add.length === 0 && words.change.length === 0 && words.remove.length === 0);
  ok('while a change to its guard, its flora or whether it is solid does', rowHash({ ...p1, guard: 3 }) !== rowHash(p1) && rowHash({ ...p1, clear: 2 }) !== rowHash(p1) && rowHash({ ...p1, solid: false }) !== rowHash(p1));
  const both = syncPlan(new Map([[placementKey('p1'), 'old'], [placementKey('b1'), 'old']]), [{ row: p1, layer: 'story' }, { row: b1, layer: 'world' }]);
  ok('and a change of a building and a prop together stands the building first', both.change.map((e) => e.row.id).join() === 'b1,p1');
}

// ---- The file's own text, the watcher's word and the snippets ------------------------------------------

{
  const text = placementsFileText('tatooine', 'raw', [house, crate]);
  ok('a written file has no comment, in either layer', !text.includes('//') && !text.includes('/*'));
  ok('and is JSON that reads back to the same rows', readPlacementsFile(text, 'tatooine', 'ground').rows.length === 2 && JSON.parse(text).rows.length === 2);
  const lines = text.split('\n');
  ok('one row a line, sorted by id', lines.filter((l) => l.startsWith('    { "id"')).length === 2 && lines.findIndex((l) => l.includes(house.id)) < lines.findIndex((l) => l.includes(crate.id)));
  ok('the same rows written twice are the same text, whatever order they came in', placementsFileText('tatooine', 'raw', [crate, house]) === text);
  ok('an empty file is still a file', readPlacementsFile(placementsFileText('tatooine', 'raw', []), 'tatooine', 'ground').problem === null);
  // Read once (its turn renormalised), written and read again: nothing moves the second time.
  const once = readPlacementRow(crate) as PlacementRow;
  const reread = readPlacementsFile(placementsFileText('tatooine', 'raw', [once]), 'tatooine', 'ground').rows[0];
  ok('every field survives a write and a read', rowHash(reread) === rowHash(once) && reread.name === crate.name && reread.note === crate.note && reread.at === crate.at);
}
{
  ok("a layer's file is fetched from placements/<layer>/<world>.json", placementsPath('story', 'tatooine') === 'placements/story/tatooine.json' && placementsPath('world', 'space_naboo') === 'placements/world/space_naboo.json');
  const w = placementFileOf('world/tatooine.json');
  ok('the watcher names the layer and the world of a changed file', w?.layer === 'world' && w.world === 'tatooine' && placementFileOf('story\\kashyyyk_main.json')?.world === 'kashyyyk_main');
  ok('and nothing for a file in a dot folder or under a dot name', placementFileOf('story/.history/tatooine.json') === null && placementFileOf('world/.tatooine.json') === null && placementFileOf('.git/x.json') === null);
  ok('nor for a file that is not one layer folder deep, or not JSON', placementFileOf('tatooine.json') === null && placementFileOf('world/a/b.json') === null && placementFileOf('world/tatooine.jsonc') === null && placementFileOf('other/tatooine.json') === null);
}
{
  const obj = parseJsonc(storyObjectSnippet(crate, 'tatooine', 'LOCKER'));
  const o = obj.value as Record<string, unknown>;
  ok('a story object snippet reads, names the row by its key and stands near the row', !obj.error && o.template === placementKey(crate.id) && TEMPLATE.test(String(o.template)) && Array.isArray(o.near) && (o.near as number[])[0] === 3448.1 && o.world === 'tatooine');
  const area = parseJsonc(storyAreaSnippet(crate, 'tatooine', 8, 'BAY 22'));
  const a = area.value as { shape?: { kind?: string; c?: number[]; r?: number } };
  ok('and an area snippet is a circle round it', !area.error && a.shape?.kind === 'circle' && a.shape.r === 8 && a.shape.c?.[1] === -4688.4);
}
ok('the guard a story row carries where it says none is a metre and a half', DRESSING_TUNE.guard === 1.5);

// ---- What `status` says of them: a pack the rows need, information only ------------------------------------------
{
  const scratch = mkdtempSync(join(tmpdir(), 'placements-status-'));
  try {
    const packs = join(scratch, 'assets-private');
    mkdirSync(packs, { recursive: true });
    const readJson = (file: string) => {
      try {
        return JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    };
    // No folder at all, which is every install today: nothing read, nothing failed, one line saying so.
    ok('a checkout or a release with no placements folder reads no rows and does not fail', placementsFolder(join(scratch, 'no-checkout')) === null && placementRows(null).length === 0 && placementRows(join(scratch, 'nowhere')).length === 0);
    const none = placementPackLines([], packs, readJson);
    ok('and status says there are none, in one line', none.length === 1 && /placements: none in this build/.test(none[0]));
    // A release carries the built copy (`dist/placements`) and no `public/`.
    mkdirSync(join(scratch, 'release', 'dist', 'placements', 'world'), { recursive: true });
    ok("a release's rows are the build's own copy", placementsFolder(join(scratch, 'release')) === join(scratch, 'release', 'dist', 'placements'));
    // A checkout whose last row was taken out (the editor takes `public/placements` away with it) after a build:
    // its `dist/` still holds the last build's copy, which is no row anybody ships.
    mkdirSync(join(scratch, 'emptied', 'public'), { recursive: true });
    mkdirSync(join(scratch, 'emptied', 'dist', 'placements', 'world'), { recursive: true });
    writeFileSync(join(scratch, 'emptied', 'dist', 'placements', 'world', 'tatooine.json'), placementsFileText('tatooine', 'raw', [crate]));
    ok("a checkout with no placements in public/ has none, whatever its last build's dist/ holds", placementsFolder(join(scratch, 'emptied')) === null);
    // Rows on two worlds, out of all three packs, with no pack converted here.
    const dir = join(scratch, 'checkout', 'public', 'placements');
    mkdirSync(join(dir, 'story'), { recursive: true });
    mkdirSync(join(dir, 'world'), { recursive: true });
    writeFileSync(join(dir, 'story', 'tatooine.json'), placementsFileText('tatooine', 'raw', [crate, { ...crate, id: 'other-crate', thing: 'missing_thing' }]));
    writeFileSync(join(dir, 'world', 'tatooine.json'), placementsFileText('tatooine', 'raw', [house, { id: 'wall', kind: 'prop', pack: 'world', model: 'wall_s01', x: 1, y: 0, z: 1, q: [1, 0, 0, 0] }]));
    writeFileSync(join(dir, 'world', 'naboo.json'), placementsFileText('naboo', 'raw', [{ ...crate, id: 'theed-crate' }]));
    ok("a checkout's rows are its public folder's", placementsFolder(join(scratch, 'checkout')) === dir);
    const rows = placementRows(dir);
    ok('every row of both layers is read, with its world and layer', rows.length === 5 && rows.filter((r) => r.world === 'tatooine').length === 4 && rows.some((r) => r.layer === 'world' && r.row.id === 'wall'));
    const lacking = placementPackLines(rows, packs, readJson);
    ok('with no packs converted, each world says which pack its rows need, with the command that makes it', lacking.some((l) => /permanent placements on tatooine need the props pack for 2 rows.*npm run swg -- props <swg-dir> .* --retail-only/.test(l)) && lacking.some((l) => /on tatooine need the gallery pack for 1 row/.test(l)) && lacking.some((l) => /on tatooine need the tatooine pack for 1 row.*snapshot <swg-dir> tatooine/.test(l)) && lacking.some((l) => /on naboo need the props pack for 1 row/.test(l)), lacking.join(' | '));
    // The snapshot of one world writes into the very folder it is given, so the command names the world's own pack
    // folder, as the rest of status does; given the packs' root it would convert a whole world into the wrong place.
    const snap = lacking.find((l) => /need the tatooine pack/.test(l)) ?? '';
    ok('a world pack is asked for into its own folder', snap.includes(`snapshot <swg-dir> tatooine ${join(packs, 'tatooine')} --center=auto --radius=all --retail-only`), snap);
    // A space zone's own pack is the space command's, which writes `<dir>/<zone>` itself; the made-up system is its own command's.
    const spaceRow = { world: 'space_tatooine', layer: 'world', row: { id: 'rock', kind: 'prop', pack: 'world', model: 'asteroid_a', x: 0, y: 0, z: 0, q: [1, 0, 0, 0] } };
    const spaceLines = placementPackLines([spaceRow], packs, readJson);
    ok("a space zone's rows ask for the space command, into the packs' root", spaceLines.some((l) => l.includes(`need the space_tatooine pack for 1 row`) && l.includes(`npm run swg -- space <swg-dir> space_tatooine ${packs} --retail-only`)) && !spaceLines.some((l) => /snapshot/.test(l)), spaceLines.join(' | '));
    ok('and the made-up system its own', worldPackCommand('space_sandbox', packs) === `sandbox <swg-dir> ${packs} --retail-only`);
    ok('and a summary first', /placements: 5 permanent rows over 2 worlds/.test(lacking[0]));
    // The packs converted, holding all but one thing: one line for what a pack has not got, and never a reconversion.
    mkdirSync(join(packs, 'props'), { recursive: true });
    mkdirSync(join(packs, 'gallery'), { recursive: true });
    mkdirSync(join(packs, 'tatooine'), { recursive: true });
    writeFileSync(join(packs, 'props', 'manifest.json'), JSON.stringify({ props: [{ id: crate.thing }] }));
    // The house's model in a gallery category other than the walk-in buildings': the game finds a row's model in any
    // of the pack's categories (`AssetPack.find`), so status does too.
    writeFileSync(join(packs, 'gallery', 'manifest.json'), JSON.stringify({ categories: { layout: [{ id: 'some_other_house' }], vehicles: [{ id: house.model }] } }));
    writeFileSync(join(packs, 'tatooine', 'manifest.json'), JSON.stringify({ categories: { structures: [{ id: 'wall_s01' }] } }));
    const have = placementPackLines(rows, packs, readJson);
    ok('with the packs here, only what a pack has not got is said, and that converting again does not change it unless the archives hold it', have.length === 2 && /props pack here has not got 1 of what the permanent placements on tatooine stand \(missing_thing\)/.test(have[1]) && /converting again does not change/.test(have[1]), have.join(' | '));
    ok('and a gallery model is found in whichever of its categories holds it', !have.some((l) => /gallery pack/.test(l)), have.join(' | '));
    // The status is information only: cli.mjs prints the lines and never puts them on the to-do list.
    const cli = readFileSync(join(ROOT, 'tools', 'swg', 'cli.mjs'), 'utf8');
    ok("status prints the lines and never asks for a step for them", /for \(const line of placementPackLines\(placementRows\(placementsFolder\(\)\), dir, readJson\)\) console\.log\(line\);/.test(cli) && !/need\([^)]*placement/i.test(cli));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

console.log(`placements: ${checks} checks, ${bad} failed`);
if (bad) process.exit(1);
