// Real chairs for the people (Map-maker II's twelfth wave; Map-maker I §2.10 and §8's `seatsData`, its first item dropped as
// done in Map-maker I's first wave): a permanent row may say what it counts as for the people (`furniture`: seat, table or
// none), which wins over its template's name wherever a seat is asked of it -- whether it stands solid (`standsSolid`: a seat
// or a table is passable unless its row says `solid`), whether the people of ours sit in it (`furnish`), whether the seats of
// ours stand one beside it (`World.dataPlacedNear`) -- and the world editor's Make permanent writes a seat of ours as such a
// row at its exact place and turn (`seatPermanentRow`, held here through the game's own `toGame`), and its snap puts a chair
// or a table in hand on the nearest sitter (`seatSnap`).
//
// Day one: a row with no `furniture` stands solid or passable exactly as cfa55f3's rule had it, held against that commit's
// `rowSolid.ts` out of git over every kind of row; and `furnish` over rows that carry no word is cfa55f3's.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { furnitureOf, isSeat, isTableTemplate, standsSolid } from '../../../src/world/rowSolid.ts';
import { SEAT_SNAP_TUNE, SEAT_TUNE, seatPermanentRow, seatSnap, type SeatedRow } from '../../../src/world/seatProps.ts';
import { furnish, type Furnishing, type SeatCandidate } from '../../../src/world/ambient/fillers.ts';
import { readPlacementRow, rowHash, toGame } from '../../../src/story/placements.ts';
import { loadOld, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const CHAIR = 'object/tangible/furniture/all/shared_frn_all_chair_wooden_s1.iff';
const TABLE = 'object/tangible/furniture/all/shared_frn_all_table_s01.iff';
const CRATE = 'object/tangible/container/general/shared_crate.iff';
ok(isSeat(CHAIR) && isTableTemplate(TABLE) && !isSeat(CRATE) && !isTableTemplate(CRATE), 'the test templates read as a chair, a table and neither by their names');

// ---- what a row counts as ---------------------------------------------------------------------------------------------------
{
  ok(furnitureOf({ furniture: 'seat' }, CRATE) && furnitureOf({ furniture: 'seat' }, CRATE, 'seat') && !furnitureOf({ furniture: 'seat' }, CRATE, 'table'), "a row's own word wins over its template's name, and says which");
  ok(!furnitureOf({ furniture: 'none' }, CHAIR) && !furnitureOf({ furniture: 'none' }, CHAIR, 'seat'), "'none' is neither, whatever its template");
  ok(furnitureOf({}, CHAIR, 'seat') && !furnitureOf({}, CHAIR, 'table') && furnitureOf(null, TABLE) && !furnitureOf({}, CRATE) && !furnitureOf({}, null), 'with no word, its template');
}

// ---- solid ------------------------------------------------------------------------------------------------------------------
{
  const kinds: { solid?: boolean; pack?: string; kind?: string }[] = [];
  for (const pack of ['props', 'world', 'gallery', 'imported', undefined]) for (const kind of ['prop', 'building', 'mark', undefined]) for (const solid of [true, false, undefined]) kinds.push({ ...(pack ? { pack } : {}), ...(kind ? { kind } : {}), ...(solid !== undefined ? { solid } : {}) });
  const old = await loadOld<{ standsSolid: (r: unknown, f: boolean) => boolean }>(['src/world/rowSolid.ts'], 'src/world/rowSolid.ts', 'cfa55f3');
  if (!old) console.log("note git cannot hand cfa55f3's rowSolid over: the day-one rule is not compared here");
  else ok(kinds.every((r) => [true, false].every((f) => old.standsSolid(r, f) === standsSolid(r, f))), `a row with no furniture word stands as cfa55f3's rule had it, over ${kinds.length * 2} kinds of row`);
  // What every caller hands it is its template's answer alone (a world or gallery row's `false`, a props row's thing's
  // template), so the row's own word is read inside: each of these is asked with what a caller really passes.
  ok(!standsSolid({ pack: 'world', kind: 'prop', furniture: 'seat' }, false) && !standsSolid({ pack: 'gallery', kind: 'prop', furniture: 'table' }, false), 'a world or gallery row that says it is a seat or a table is passable, as a props seat is (a seated body on a collider is pushed off)');
  ok(standsSolid({ pack: 'world', kind: 'prop', furniture: 'seat', solid: true }, false) && standsSolid({ pack: 'world', kind: 'prop', furniture: 'none' }, false), "unless its row says solid; and 'none' stands as a world row does");
  ok(standsSolid({ pack: 'props', kind: 'prop', furniture: 'none' }, true) && !standsSolid({ pack: 'props', kind: 'prop', furniture: 'seat' }, false), "a props chair that says none is solid, and a props crate that says seat passable, whatever its template answers");
  ok(!standsSolid({ kind: 'mark', furniture: 'seat', solid: true }, true), 'a mark is never solid, whatever it says');
}

// ---- the game's stand, the walk grid's bake and the editor's Solid over the same rows ------------------------------------------
{
  const { dressingStandOf } = await import('../../../src/world/permanent.ts');
  const { gridSolidRows } = await import('../navgrid.mjs');
  const things: Record<string, string> = { chair: CHAIR, table: TABLE, crate: CRATE };
  const row = (id: string, more: Record<string, unknown>) => ({ id, kind: 'prop', x: 1, y: 0, z: 1, q: [1, 0, 0, 0], ...more });
  const rows = [
    row('w-seat', { pack: 'world', model: 'm', template: CRATE, furniture: 'seat' }),
    row('w-table', { pack: 'world', model: 'm', template: CHAIR, furniture: 'table' }),
    row('w-none', { pack: 'world', model: 'm', template: CHAIR, furniture: 'none' }),
    row('w-plain', { pack: 'world', model: 'm', template: CHAIR }),
    row('g-seat', { pack: 'gallery', model: 'm', furniture: 'seat' }),
    row('p-chair-none', { pack: 'props', thing: 'chair', furniture: 'none' }),
    row('p-crate-seat', { pack: 'props', thing: 'crate', furniture: 'seat' }),
    row('p-chair', { pack: 'props', thing: 'chair' }),
    row('p-crate', { pack: 'props', thing: 'crate' }),
    row('p-chair-solid', { pack: 'props', thing: 'chair', furniture: 'seat', solid: true }),
  ];
  const text = JSON.stringify({ version: 1, world: 'naboo', frame: 'raw', rows });
  const baked = new Set((gridSolidRows({ world: 'naboo', texts: { world: text } }, (thing: string) => things[thing] ?? null) as { row: { id: string } }[]).map((r) => r.row.id));
  const isFurniture = (t: string) => isSeat(t) || isTableTemplate(t);
  // The editor's Solid (`App.solidOf`), read off its own line and asked as it asks.
  const main = readFileSync(join(REPO, 'src/main.ts'), 'utf8');
  ok(/return standsSolid\(row, row\.pack === 'props' && this\.isFurnitureThing\(row\.thing\)\);/.test(main), "the editor's Solid asks standsSolid with its thing's template's answer alone");
  const g = { x: 0, y: 0, z: 0, q: [1, 0, 0, 0] as [number, number, number, number] };
  const disagree: string[] = [];
  for (const raw of rows) {
    const r = readPlacementRow(raw);
    assert.ok(typeof r !== 'string', `${raw.id} reads`);
    const stood = dressingStandOf(r as never, g as never, raw.id, (t: string) => (things[t] ? { model: t, template: things[t] } : null), isFurniture);
    const editor = standsSolid(r as never, r.pack === 'props' && isFurniture(things[r.thing ?? ''] ?? ''));
    if (!stood || stood.solid !== baked.has(raw.id) || stood.solid !== editor) disagree.push(`${raw.id}: stood ${stood?.solid}, baked ${baked.has(raw.id)}, editor ${editor}`);
  }
  ok(disagree.length === 0, `the game stands, the walk grid bakes and the editor shows every row alike, a row's own furniture word included (${rows.length} rows${disagree.length ? `: ${disagree.join('; ')}` : ''})`);
  ok(!baked.has('w-seat') && baked.has('w-none') && !baked.has('p-crate-seat') && baked.has('p-chair-none') && baked.has('p-chair-solid'), "a world row saying seat is walked through by the bake too, and a props chair saying none blocks it");
}

// ---- the file's word ----------------------------------------------------------------------------------------------------------
{
  const base = { id: 'chair-1', kind: 'prop', pack: 'props', thing: 'chair', x: 1, y: 2, z: 3, q: [1, 0, 0, 0] };
  const plain = readPlacementRow(base);
  const said = readPlacementRow({ ...base, furniture: 'seat' });
  ok(typeof plain !== 'string' && typeof said !== 'string' && said.furniture === 'seat' && plain.furniture === undefined, 'a row reads its furniture word, and one with none carries none');
  const unknown: string[] = [];
  const sofa = readPlacementRow({ ...base, furniture: 'sofa' }, unknown);
  ok(typeof sofa !== 'string' && sofa.furniture === undefined && unknown.includes('chair-1.furniture'), 'a word that is not seat, table or none is not read, and named (as a state this build does not know is)');
  ok(typeof plain !== 'string' && typeof said !== 'string' && rowHash(plain) !== rowHash(said), 'the word is in the row\'s hash: a row whose word moves stands again');
}

// ---- the snap ---------------------------------------------------------------------------------------------------------------------
{
  const sitters: SeatedRow[] = [
    { key: 'a', x: 10, y: 0, z: 10, heading: 0.5, inside: true, sits: 'chair' },
    { key: 'b', x: 20, y: 0, z: 10, heading: Math.PI / 2, inside: true, sits: 'table' },
  ];
  const chair = seatSnap('seat', 10.4, 10.2, sitters);
  ok(!!chair && chair.key === 'a' && chair.x === 10 && chair.z === 10 && chair.heading === 0.5 + SEAT_TUNE.seatTurn, `a chair in hand within ${SEAT_TUNE.seatNear} m of a chair sitter snaps to its spot and its turn`);
  ok(seatSnap('seat', 12, 10, sitters) === null, 'past the reach it stands where the aim puts it');
  const tx = 20 + Math.sin(Math.PI / 2) * SEAT_TUNE.ahead;
  const table = seatSnap('table', tx + 0.3, 10, sitters);
  ok(!!table && table.key === 'b' && Math.abs(table.x - tx) < 1e-9 && Math.abs(table.heading - (Math.PI / 2 + Math.PI)) < 1e-9, `a table snaps to the spot ${SEAT_TUNE.ahead} m in front of a table sitter, facing them`);
  ok(seatSnap('seat', tx, 10, sitters) === null && seatSnap('table', 10, 10, sitters) === null, 'a chair never snaps to a table sitter, nor a table to a chair sitter');
  SEAT_SNAP_TUNE.on = false;
  try {
    ok(seatSnap('seat', 10.4, 10.2, sitters) === null, 'with the snap off nothing snaps');
  } finally {
    SEAT_SNAP_TUNE.on = true;
  }
}

// ---- Make permanent ---------------------------------------------------------------------------------------------------------------
{
  const c = { x: 3500, z: -4800 };
  const p = { kind: 'chair' as const, model: 'thm_frn_chair_s01', x: 12.25, y: 4.5, z: -33.5, yaw: 1.1, inside: true };
  const row = seatPermanentRow(p, c, 'cantina_chair', true, (b) => `${b}-1`);
  ok(typeof row !== 'string' && row.pack === 'props' && row.thing === 'cantina_chair' && row.furniture === 'seat' && row.solid === undefined && row.inside === true && row.id === 'thm_frn_chair_s01-1', 'a seat of ours made permanent: a props row with its furniture word, its solidity absent, in its room');
  const read = readPlacementRow(row as Record<string, unknown>);
  ok(typeof read !== 'string', `and the file's own reader takes it (${typeof read === 'string' ? read : 'read'})`);
  const g = toGame(read as never, c);
  const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
  const got = new THREE.Quaternion(g.q[0], g.q[1], g.q[2], g.q[3]);
  ok(Math.abs(g.x - p.x) < 1e-3 && Math.abs(g.z - p.z) < 1e-3 && g.y === p.y && got.angleTo(want) < 1e-5, "stood by the game's own toGame it is where the seat of ours stood, turned as it was (the seats' own setFromAxisAngle)");
  const own = seatPermanentRow({ ...p, kind: 'table', model: 'thm_frn_table_s01' }, c, null, true, (b) => b);
  ok(typeof own !== 'string' && own.pack === 'world' && own.model === 'thm_frn_table_s01' && own.furniture === 'table', "one the props catalogue lacks is a row of this world's own pack, a table a table");
  ok(typeof seatPermanentRow(p, c, null, false, (b) => b) === 'string', 'one in neither is refused in words');
  const main = readFileSync(join(REPO, 'src/main.ts'), 'utf8');
  ok(/return seatPermanentRow\(p, c, thing\?\.id \?\? null, this\.world\.packHas\(p\.model\), mint\);/.test(main), 'the game writes the row through this very function');
}

// ---- the people of ours sit in his chairs ---------------------------------------------------------------------------------------
{
  const f = (template: string, x: number, extra: Partial<Furnishing> = {}): Furnishing => ({ x, y: 0, z: 0, template, q: { x: 0, y: 0, z: 0, w: 1 }, ...extra });
  const objects: Furnishing[] = [
    f(CHAIR, 1),
    f(CRATE, 2),
    // Ids that say nothing of what they are (a row's id is the editor's to mint), so only its template can.
    f('place/row-7', 3, { effectsOf: CHAIR }),
    f('place/row-9', 4, { effectsOf: CRATE, furniture: 'seat' }),
    f('place/row-8', 5, { effectsOf: CHAIR, furniture: 'none' }),
  ];
  const seats: SeatCandidate[] = [];
  furnish(objects, () => 1, new Set(), 0, seats, []);
  ok(seats.map((s) => s.x).join() === '1,3,4', `a filler sits in the data's chair, in his permanent chair filed under place/ by what it really is, and in a crate he said is a seat, never in one he said is none (${seats.map((s) => s.x).join()})`);
  const old = await loadOld<{ furnish: typeof furnish }>(['src/world/ambient/fillers.ts'], 'src/world/ambient/fillers.ts', 'cfa55f3');
  const plain = objects.slice(0, 2);
  const b: SeatCandidate[] = [];
  furnish(plain, () => 1, new Set(), 0, b, []);
  /** What cfa55f3's furnish answered over those two rows, recorded from it (a checkout git cannot hand that commit over is held to it). */
  const OLD_FURNISH = '[{"x":1,"y":0,"z":0,"heading":0,"cell":1}]';
  if (old) {
    const a: SeatCandidate[] = [];
    old.furnish(plain, () => 1, new Set(), 0, a, []);
    ok(JSON.stringify(a) === JSON.stringify(b), "over rows carrying no word, furnish is cfa55f3's");
    ok(JSON.stringify(a) === OLD_FURNISH, `and the answer written in here is cfa55f3's own (${JSON.stringify(a)})`);
  } else ok(JSON.stringify(b) === OLD_FURNISH, `git cannot hand cfa55f3's fillers over: over rows carrying no word furnish answers what that commit's did, written in (${JSON.stringify(b)})`);
}

// ---- the world's question ------------------------------------------------------------------------------------------------------------
{
  const world = readFileSync(join(REPO, 'src/world/world.ts'), 'utf8');
  ok((world.match(/if \(o\.furniture && kind && o\.template\.startsWith\(PLACEMENT_KEY_PREFIX\)\) \{\s*if \(furnitureOf\(o, null, kind\)\) return true;\s*continue;\s*\}/g) ?? []).length === 2, "dataPlacedNear reads a permanent row's own word, in a building's rooms and out in the open alike");
  const main = readFileSync(join(REPO, 'src/main.ts'), 'utf8');
  ok(/this\.world\.dataPlacedNear\(kind === 'chair' \? isSeat : isTableTemplate, x, y, z, reach, level, kind === 'chair' \? 'seat' : 'table'\)/.test(main), 'and the seats of ours ask it which kind they mean');
  const stream = readFileSync(join(REPO, 'src/world/layoutStream.ts'), 'utf8');
  ok(/if \(row\.furniture\) \{\s*const p = this\.placedByKey\.get\(row\.key\);\s*if \(p\) p\.furniture = row\.furniture;\s*\}/.test(stream) && /\.\.\.\(o\.furniture \? \{ furniture: o\.furniture \} : \{\}\)/.test(stream), "the streamer carries a permanent row's word onto what it stands and hands it on with what stands near");
}

console.log(`\n${checks} checks passed`);
