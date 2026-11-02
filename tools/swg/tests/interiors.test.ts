// The client's own furniture in its buildings' rooms (the interior layout files' wave): the strict reader
// (`tools/swg/ilf.mjs`) on files made up here and on every file the owner's archives hold, the keys and the
// never-twice rules the `interiors` pass writes, what the game makes of a pack's file (`src/world/interiors.ts`:
// the layout's pieces, a permanent building's pieces in the game's frame -- held to the streamer's own mirror of
// the layout's pieces, so a building put down by the editor stands its furniture exactly where the world's own copy
// of it does -- a piece stood (`pieceStand`) and made a row of its own (`pieceRow`), what a building whose furniture is its
// own carries (`carriedRowIds`), and a post moved clear of a solid piece), the pass's own rules (`interiorPieces`,
// `buildingRow`), the real people pass asking a post once, a building row's `furnish`, the editor's carry
// (`ownFurniture`), a ship's furniture written and hung (`hullFurniturePlace`, `placeFurniture`), the props the files need
// (`buildInteriorProps`), the sounds they stand (`interiorEmitters`), and the packs on disk where they are.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { INTERIORS_PACK_VERSION, buildingKey, buildingRow, doublesOf, fixed, hullFurniturePlace, ilfPath, interiorPieces, layoutBuildings, mulQuat, nodeTransform, otherState, readIlf, rotateByQuat } from '../ilf.mjs';
import { FURNITURE_RADIUS, INTERIORS_PACK_VERSION as RUNTIME_VERSION, POST_CLEAR_TUNE, carriedRowIds, clearSpotNear, furnishLayout, insidePiece, interiorsReadable, pieceKeyOf, pieceOfKey, pieceRow, pieceSolid, pieceStand, piecesInGame, templateEntry, type InteriorsFile } from '../../../src/world/interiors.ts';
import { PLACEMENT_FIELDS, placementsFileText, readPlacementRow, readPlacementsFile, rowHash, toGame, type PlacementRow } from '../../../src/story/placements.ts';
import { rowFromEditor } from '../../../src/world/permanentEdit.ts';
import { furniturePassable, placeFurniture } from '../../../src/vehicles/shipAssembly.ts';
import { buildShips } from '../ships.mjs';
import { buildInteriorProps } from '../props.mjs';
import { interiorEmitters } from '../soundplaces.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------- 1. the reader, on files made up here

/** One interior layout file of these nodes: `FORM INLY > FORM 0000 > NODE*`, each two NUL-ended strings and twelve floats. */
function ilfOf(nodes: { template: string; cell: string; m: number[] }[], opts: { extra?: Buffer; tag?: string; floats?: number } = {}): Buffer {
  const chunks = nodes.map((n) => {
    const t = Buffer.from(`${n.template}\0${n.cell}\0`, 'latin1');
    const f = Buffer.alloc(4 * (opts.floats ?? 12));
    for (let k = 0; k < (opts.floats ?? 12); k++) f.writeFloatLE(n.m[k] ?? 0, k * 4);
    const head = Buffer.alloc(8);
    head.write(opts.tag ?? 'NODE', 0, 'latin1');
    head.writeUInt32BE(t.length + f.length, 4);
    return Buffer.concat([head, t, f]);
  });
  const body = Buffer.concat([...chunks, opts.extra ?? Buffer.alloc(0)]);
  const ver = Buffer.alloc(12);
  ver.write('FORM', 0, 'latin1');
  ver.writeUInt32BE(4 + body.length, 4);
  ver.write('0000', 8, 'latin1');
  const root = Buffer.alloc(12);
  root.write('FORM', 0, 'latin1');
  root.writeUInt32BE(4 + 12 + body.length, 4);
  root.write('INLY', 8, 'latin1');
  return Buffer.concat([root, ver, body]);
}

const YAW = (30 * Math.PI) / 180;
const ROW_MAJOR = [Math.cos(YAW), 0, Math.sin(YAW), 1.5, 0, 1, 0, 0.25, -Math.sin(YAW), 0, Math.cos(YAW), -2];
{
  const file = ilfOf([
    { template: 'object/tangible/furniture/all/shared_frn_all_chair_s01.iff', cell: 'mainroom', m: ROW_MAJOR },
    { template: 'object/tangible/furniture/all/shared_frn_all_table_s01.iff', cell: 'hall', m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] },
  ]);
  const r = readIlf(file);
  ok(r.version === '0000' && r.nodes.length === 2, 'a file of two nodes reads as two nodes');
  ok(r.nodes[0].template === 'object/tangible/furniture/all/shared_frn_all_chair_s01.iff' && r.nodes[0].cell === 'mainroom' && r.nodes[1].cell === 'hall', "each node's template and cell to the byte");
  ok(r.nodes[0].m.every((v: number, k: number) => near(v, Math.fround(ROW_MAJOR[k]))), "and its twelve floats as written (little-endian, single precision)");
  const refuse = (buf: Buffer, why: RegExp, what: string) => {
    let said = '';
    try {
      readIlf(buf);
    } catch (err) {
      said = (err as Error).message;
    }
    ok(why.test(said), `${what} is refused (${said || 'read'})`);
  };
  refuse(Buffer.concat([file, Buffer.from([0])]), /root FORM says/, 'a byte past the root FORM');
  refuse(ilfOf([{ template: 'a', cell: 'b', m: [] }], { extra: Buffer.from('JUNK\0\0\0\0', 'latin1') }), /a JUNK at/, 'a chunk that is no NODE');
  refuse(ilfOf([{ template: 'a', cell: 'b', m: [] }], { floats: 11 }), /holds 44 bytes of transform/, 'a node of eleven floats');
  refuse(ilfOf([{ template: 'a', cell: 'b', m: [] }], { floats: 13 }), /holds 52 bytes of transform/, 'a node of thirteen floats');
  const wrongRoot = Buffer.from(file);
  wrongRoot.write('INLX', 8, 'latin1');
  refuse(wrongRoot, /not INLY/, 'a root FORM of another type');
  const wrongVersion = Buffer.from(file);
  wrongVersion.write('0001', 20, 'latin1');
  refuse(wrongVersion, /version 0001/, 'another version');
  refuse(Buffer.from('FORM', 'latin1'), /too short/, 'a file of four bytes');
}

// ---------------------------------------------------------------- 2. a node's place and turn

{
  const { p, q } = nodeTransform(ROW_MAJOR);
  ok(near(p[0], 1.5) && near(p[1], 0.25) && near(p[2], -2), 'a node stands at its fourth column');
  ok(near(q[0], Math.cos(YAW / 2), 1e-12) && near(q[1], 0) && near(q[2], Math.sin(YAW / 2), 1e-12) && near(q[3], 0), `turned about up by its rows' rotation (30 degrees: [${q.map((v) => v.toFixed(4)).join(', ')}])`);
  // The turn it reads puts a local point where the matrix puts it.
  const local = [0.4, 0.7, -1.1];
  const byMatrix = [ROW_MAJOR[0] * local[0] + ROW_MAJOR[1] * local[1] + ROW_MAJOR[2] * local[2], ROW_MAJOR[4] * local[0] + ROW_MAJOR[5] * local[1] + ROW_MAJOR[6] * local[2], ROW_MAJOR[8] * local[0] + ROW_MAJOR[9] * local[1] + ROW_MAJOR[10] * local[2]];
  const byTurn = rotateByQuat(q, local);
  ok(byTurn.every((v, k) => near(v, byMatrix[k], 1e-12)), 'and that turn carries a point where the rows carry it');
  // Turned 200 degrees: the trace is negative and the branch that reads it finds w below nought before it is signed.
  const Y2 = (200 * Math.PI) / 180;
  const flipped = nodeTransform([Math.cos(Y2), 0, Math.sin(Y2), 0, 0, 1, 0, 0, -Math.sin(Y2), 0, Math.cos(Y2), 0]);
  ok(flipped.q[0] >= 0 && near(Math.abs(flipped.q[2]), Math.abs(Math.sin(Y2 / 2)), 1e-12) && rotateByQuat(flipped.q, [1, 0, 0]).every((v, k) => near(v, [Math.cos(Y2), 0, -Math.sin(Y2)][k], 1e-12)), 'one sign for one turn: w at or above nought, the turn the same');
  ok(fixed(-0.00001, 4) === 0 && !Object.is(fixed(-0.00001, 4), -0), 'a number rounded to nought is written as a plain nought');
  const half = mulQuat([Math.cos(YAW / 4), 0, Math.sin(YAW / 4), 0], [Math.cos(YAW / 4), 0, Math.sin(YAW / 4), 0]);
  ok(near(half[0], q[0], 1e-12) && near(half[2], q[2], 1e-12), 'turns compose by the Hamilton product');
  ok(ilfPath('InteriorLayout\\Shared_Cantina.ILF') === 'interiorlayout/shared_cantina.ilf' && ilfPath('') === null, 'a file named in a template is looked for as the archives hold it');
}

// ---------------------------------------------------------------- 3. keys, doubles and states

{
  const T = 'object/building/tatooine/shared_cantina_tatooine.iff';
  const objects = [
    { template: T, x: 10.004, y: 5, z: -3.333 },
    { template: 'object/tangible/furniture/all/shared_frn_all_chair_s01.iff', x: 11, y: 5, z: -3, contained: true, in: 0 },
    { template: T, x: 10.004, y: 5, z: -3.333 },
    { template: 'object/building/other/shared_hut.iff', x: 0, y: 0, z: 0 },
  ];
  const rows = layoutBuildings(objects, (t: string) => (t === T ? 'interiorlayout/cantina.ilf' : null));
  ok(rows.length === 2 && rows[0].row === 0 && rows[1].row === 2, 'only the buildings whose template names a file, contained things never');
  ok(rows[0].key === `o:${T}@10,5,-3.33` && rows[1].key === `o:${T}@10,5,-3.33#2`, `a building's key is its template and its place to the centimetre, its exact twin numbered (${rows[1].key})`);
  ok(buildingKey(T, 1, 2, 3, 1) === `o:${T}@1,2,3`, 'the first of its twins has no number');
  // A building at (10, 0, 0) turned a quarter about up; the world's own chair stands a metre along its +X, which is world -Z.
  const q90 = [Math.SQRT1_2, 0, Math.SQRT1_2, 0];
  const b = { template: T, x: 10, y: 0, z: 0, q: q90 };
  const along = rotateByQuat(q90, [1, 0, 0]);
  const contained = [{ template: 'object/tangible/furniture/all/frn_all_chair_s01.iff', x: 10 + along[0], y: 0, z: along[2] }];
  const pieces = [
    { template: 'object/tangible/furniture/all/shared_frn_all_chair_s01.iff', p: [1, 0, 0] },
    { template: 'object/tangible/furniture/all/shared_frn_all_chair_s01.iff', p: [1.6, 0, 0] },
    { template: 'object/tangible/furniture/all/shared_frn_all_table_s01.iff', p: [1, 0, 0] },
  ];
  const d = doublesOf(b, pieces, contained, []);
  ok(d.size === 1 && d.get(0) === '', "a piece of the same thing (the server's spelling of it too) within half a metre in the building's frame stands twice; one 0.6 m off and another thing on the very spot do not");
  const tagged = doublesOf(b, pieces, [{ ...contained[0], state: 'soe=earlier' }], []);
  ok(tagged.get(0) === 'soe=earlier', 'a double that stands in one state only is named by its state');
  const both = doublesOf(b, pieces, [{ ...contained[0], state: 'soe=earlier' }, contained[0]], []);
  ok(both.get(0) === '', 'and one standing in every state wins over it');
  const fit = doublesOf(b, pieces, [], [{ cell: 2, building: 'object/building/tatooine/cantina_tatooine.iff', bx: 10.4, bz: 0.2, template: 'object/tangible/furniture/all/frn_all_table_s01.iff', x: 1.2, y: 0, z: 0.1 }]);
  ok(fit.size === 1 && fit.get(2) === '', "a fitting the server stood in that very building's rooms is a double too (its place is the building's own frame)");
  // What is no double: a fitting of another copy of the same template two metres off (several buildings share one), and a
  // fitting standing in the street (room nought), each at the very spot of the piece in the building's frame.
  const tableFit = { building: 'object/building/tatooine/cantina_tatooine.iff', template: 'object/tangible/furniture/all/frn_all_table_s01.iff', x: 1.2, y: 0, z: 0.1 };
  ok(doublesOf(b, pieces, [], [{ ...tableFit, cell: 2, bx: 12.2, bz: 0 }]).size === 0 && doublesOf(b, pieces, [], [{ ...tableFit, cell: 2, bx: 10, bz: -2.5 }]).size === 0, "a fitting of another copy of the template, two metres off the building or more, is that copy's and no double here");
  ok(doublesOf(b, pieces, [], [{ ...tableFit, cell: 0, bx: 10.4, bz: 0.2 }]).size === 0, 'nor is a fitting standing in the street (room nought)');
  // A contained thing whose own template names a file is still no building of the layout's (a cabinet with a layout of its own).
  const withFiles = layoutBuildings(objects, (t: string) => (t === T || /frn_all_chair/.test(t) ? 'interiorlayout/any.ilf' : null));
  ok(withFiles.length === 2 && withFiles.every((r: { row: number }) => r.row !== 1), "a contained thing whose template names a file is never listed as a building");
  const states = { soe: { values: ['final', 'earlier'] } };
  ok(otherState('soe=earlier', states, undefined) === 'soe=final' && otherState('soe=final', states, undefined) === 'soe=earlier', 'a piece doubled in one state stands in the other');
  ok(otherState('soe=earlier', states, 'restuss=living') === null && otherState('soe=earlier', {}, undefined) === null && otherState('soe=odd', states, undefined) === null, 'never in a building of a state of its own, nor by a key the layout does not know two values of');
}

// ---------------------------------------------------------------- 3b. the pass's own rules: a file's pieces, a building's row

{
  const T = 'object/building/tatooine/shared_cantina_tatooine.iff';
  const CHAIR = 'object/tangible/furniture/all/shared_frn_all_chair_s01.iff';
  const HELM = 'object/tangible/wearables/armor/composite/shared_armor_composite_helmet.iff';
  const SND = 'object/soundobject/shared_soundobject_cantina_small.iff';
  const GONE = 'object/tangible/furniture/all/shared_frn_all_gone.iff';
  const at = (x: number, y: number, z: number) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
  // Tipped a quarter about X: its own up is the building's +Z.
  const tipped = (x: number, y: number, z: number) => [1, 0, 0, x, 0, 0, -1, y, 0, 1, 0, z];
  const nodes = [
    { template: CHAIR, cell: 'rooma', m: at(0, 0, 0) }, // 0: a room the building has not got
    { template: CHAIR, cell: 'hall', m: at(1, 0, 0) }, // 1: the world's own chair stands here in every state
    { template: CHAIR, cell: 'hall', m: at(3, 0, 0) }, // 2: and here in one state only
    { template: HELM, cell: 'back', m: tipped(0, 1, 0) }, // 3: a helmet of the props pack, stood still and lifted
    { template: SND, cell: 'hall', m: at(0, 2, 0) }, // 4: a sound object
    { template: GONE, cell: 'hall', m: at(5, 0, 0) }, // 5: a template that stands as nothing
  ];
  const def = { id: 'cantina', cells: [{ index: 0, name: 'r0' }, { index: 2, name: 'hall' }, { index: 3, name: 'back' }] };
  const defs = new Map<string, Record<string, unknown>>([
    ['cantina', def],
    ['chair_own', { id: 'chair_own' }],
  ]);
  const left: string[] = [];
  const used = new Map<string, unknown>();
  const kindOf = (t: string) => (t === SND ? { kind: 'snd' } : t === GONE ? { skip: 'its template is not in the archives' } : t === HELM ? { kind: 'model', own: 'armor_helmet' } : { kind: 'model', own: 'chair_own' });
  const LIFT = 0.3;
  const propOf = (t: string) => (t === HELM ? { id: 'armor_helmet_still', file: 'armor_helmet_still.glb', skeletal: 'bind', lift: LIFT, icon: 'icons/x.png' } : null);
  const pieces = interiorPieces(nodes, def, defs, used, { kindOf, propOf, leave: (why: string) => left.push(why) });
  ok(pieces.length === 4 && pieces.map((p: unknown[]) => p[0]).join() === '1,2,3,4', `a node in a room its building has not got, or of a template that stands as nothing, is left out and said, and every piece keeps its node's index in the file (${pieces.map((p: unknown[]) => p[0]).join(', ')}; left ${left.length})`);
  ok(left.length === 2 && /rooma/.test(left[0]) && /not in the archives/.test(left[1]), 'each left out with why');
  const chair = pieces[0];
  ok(chair[2] === 'chair_own' && chair[3] === 'own' && chair[4] === 2 && chair[5] === 1, "a model the pack carries is the pack's own, in its room by the building's own cell name");
  const helm = pieces[2];
  ok(helm[2] === 'armor_helmet_still' && helm[3] === 'props' && used.has('armor_helmet_still') && !(used.get('armor_helmet_still') as Record<string, unknown>).icon, "anything else is the props catalogue's, its entry handed to the pack's guest (its picture left out)");
  ok(near(helm[5] as number, 0) && near(helm[6] as number, 1) && near(helm[7] as number, -LIFT, 1e-4), `a skeletal model set down by its lift is taken back off along the piece's own up, not the world's (${helm.slice(5, 8).join(', ')})`);
  ok(pieces[3][3] === 'snd' && pieces[3][2] === '', 'a sound object is a piece with no model, the placed sounds\'');
  // The building's row: what is left out by the index in the file, never by the place in the table.
  const o = { template: T, x: 10, y: 0, z: 0, q: [1, 0, 0, 0] };
  const t = { file: 'interiorlayout/cantina.ilf', model: 'cantina', pieces };
  const contained = [
    { template: 'object/tangible/furniture/all/frn_all_chair_s01.iff', x: 11, y: 0, z: 0 },
    { template: CHAIR, x: 13, y: 0, z: 0, state: 'soe=earlier' },
  ];
  const r = buildingRow({ row: 7, key: `o:${T}@10,0,0`, template: T }, o, t, contained, [], { soe: { values: ['final', 'earlier'] } });
  ok(JSON.stringify(r.row.skip) === '[1]' && JSON.stringify(r.row.states) === '{"2":"soe=final"}', `a piece standing twice is named by its index in the file, and one doubled in one state stands in the other by its index too (skip ${JSON.stringify(r.row.skip)}, states ${JSON.stringify(r.row.states)})`);
  ok(r.twice.size === 1 && r.twice.has(0) && r.row.row === 7 && r.row.key === `o:${T}@10,0,0` && r.row.state === undefined, "and `twice` is the same piece's place in the table, for the counts");
  // What the game makes of that row: the doubled chair left out, the other chair in the other state.
  const made = furnishLayout([o as never], { version: RUNTIME_VERSION, templates: { [T]: t as never }, buildings: [{ ...r.row, row: 0 }], defs: [] });
  ok(made.twice === 1 && made.objects.length === 2 && made.objects.find((p) => p.ilf.endsWith('/2'))?.state === 'soe=final' && !made.objects.some((p) => p.ilf.endsWith('/1')), 'and the game stands what the row says: the double never, the other in its state');
}

// ---------------------------------------------------------------- 4. the game's side: the layout's pieces

const T = 'object/building/tatooine/shared_cantina_tatooine.iff';
const CHAIR = 'object/tangible/furniture/all/shared_frn_all_chair_s01.iff';
const BAR = 'object/tangible/furniture/all/shared_frn_all_bar_s01.iff';
const LAMP = 'object/tangible/furniture/all/shared_frn_all_lamp_free_s01.iff';
const SND = 'object/soundobject/shared_soundobject_cantina_large.iff';
const FILE: InteriorsFile = {
  version: RUNTIME_VERSION,
  templates: {
    [T]: {
      file: 'interiorlayout/cantina.ilf',
      model: 'cantina',
      pieces: [
        [0, CHAIR, 'frn_chair', 'props', 2, 1, 0.5, 2, Math.cos(0.3), 0, Math.sin(0.3), 0],
        [1, BAR, 'bar', 'own', 2, -3, 0.5, 1, 1, 0, 0, 0],
        [2, SND, '', 'snd', 2, 0, 2, 0, 1, 0, 0, 0],
        [3, LAMP, 'lamp', 'props', 3, 4, 0.5, -2, Math.SQRT1_2, Math.SQRT1_2, 0, 0],
        [5, CHAIR, 'frn_chair', 'props', 2, 1.4, 0.5, 2, 1, 0, 0, 0],
      ],
    },
  },
  buildings: [
    { row: 1, key: `o:${T}@100,10,-50`, template: T, skip: [5], states: { 3: 'soe=final' } },
    { row: 0, key: `o:${T}@0,0,0`, template: T },
  ],
  defs: [],
};
ok(interiorsReadable(FILE) && !interiorsReadable({ ...FILE, version: 2 }) && !interiorsReadable({ version: 1 }), 'a file of the shape this build reads is read, and no other');
ok(RUNTIME_VERSION === INTERIORS_PACK_VERSION, `the game reads the shape the converter writes (${RUNTIME_VERSION} and ${INTERIORS_PACK_VERSION})`);
const BQ = [Math.cos(0.6), 0, Math.sin(0.6), 0];
const LAYOUT = [
  { template: 'object/building/other/shared_hut.iff', model: 'hut', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], radius: 50 },
  { template: T, model: 'cantina', x: 100, y: 10, z: -50, q: BQ, radius: 60 },
];
const made = furnishLayout(LAYOUT, FILE);
{
  ok(made.objects.length === 3 && made.twice === 1 && made.sounds === 1 && made.moved === 1, `a building's pieces less the one standing twice and the sound object; a building whose row holds another template is left out whole (${made.objects.length}, twice ${made.twice}, sounds ${made.sounds}, moved ${made.moved})`);
  const chair = made.objects[0];
  const at = rotateByQuat(BQ, [1, 0.5, 2]);
  ok(near(chair.x, 100 + at[0], 1e-12) && near(chair.y, 10 + at[1], 1e-12) && near(chair.z, -50 + at[2], 1e-12), "a piece stands at its building's place, carried by its turn (the snapshot's frame)");
  const q = mulQuat(BQ, [Math.cos(0.3), 0, Math.sin(0.3), 0]);
  const lampQ = mulQuat(BQ, [Math.SQRT1_2, Math.SQRT1_2, 0, 0]);
  ok(chair.q.every((v: number, k: number) => near(v, q[k], 1e-12)) && made.objects[2].q.every((v: number, k: number) => near(v, lampQ[k], 1e-12)), 'turned by its building and then its own (a lamp tipped on its side, which does not commute with the building\'s turn)');
  ok(chair.contained === true && chair.cell === 2 && chair.in === 1 && chair.radius === FURNITURE_RADIUS, "contained in its building's row and room, filed at the snapshot's own least radius for a contained thing");
  ok(chair.ilf === `o:${T}@100,10,-50/0`, `known by its building's key and its index in the file (${chair.ilf})`);
  ok(chair.solid === false && made.objects[1].solid === undefined, 'a seat stands passable (the person the data seats there is never pushed off), the bar by its size and the walk-through file');
  ok(made.objects[2].state === 'soe=final' && made.objects[0].state === undefined, 'a piece the world stands again in one state stands only in the other');
  ok(pieceSolid(CHAIR) === false && pieceSolid('object/tangible/furniture/all/shared_frn_all_table_s01.iff') === false && pieceSolid(BAR) === undefined && pieceSolid(LAMP) === undefined, 'seats and tables never solid, everything else as the world rules it');
}

// ---------------------------------------------------------------- 5. a permanent building's pieces, in the game's frame

{
  // The streamer's own mirror of a layout object (`LayoutStreamer`'s constructor): x about the centre negated, z less the
  // centre's, the turn (w, x, y, z) as three's (x, -y, -z, w).
  const centre = { x: 37, z: -12 };
  const mirrorPlace = (o: { x: number; y: number; z: number }) => ({ x: -(o.x - centre.x), y: o.y, z: o.z - centre.z });
  const mirrorTurn = (q: readonly number[]) => [q[1], -q[2], -q[3], q[0]];
  const building = LAYOUT[1];
  const g = mirrorPlace(building);
  const gq = mirrorTurn(building.q) as [number, number, number, number];
  const ours = piecesInGame(FILE.templates[T], g, gq);
  ok(ours.length === 4, "every piece of the file but the sound object (a permanent building's file stands whole: nothing of the world's own stands in its rooms)");
  // The same building's pieces as the layout writes them, carried by the streamer's mirror: the very places and turns.
  const byLayout = furnishLayout(LAYOUT, { ...FILE, buildings: [{ row: 1, key: 'k', template: T }] }).objects;
  let worst = 0;
  let worstTurn = 0;
  for (const p of ours) {
    const l = byLayout.find((o) => o.ilf === `k/${p.index}`)!;
    const m = mirrorPlace(l);
    worst = Math.max(worst, Math.abs(m.x - p.x), Math.abs(m.y - p.y), Math.abs(m.z - p.z));
    const mq = mirrorTurn(l.q);
    // One turn, either sign.
    const dot = Math.abs(mq[0] * p.q[0] + mq[1] * p.q[1] + mq[2] * p.q[2] + mq[3] * p.q[3]);
    worstTurn = Math.max(worstTurn, 1 - dot);
  }
  ok(worst < 1e-9 && worstTurn < 1e-12, `a building the editor stands at the world's own copy's place stands every piece exactly where the world's own stands it (worst ${worst.toExponential(1)} m, turn ${worstTurn.toExponential(1)})`);
  ok(templateEntry(FILE, 'object/building/tatooine/cantina_tatooine.iff') === FILE.templates[T] && templateEntry(FILE, 'OBJECT/BUILDING/TATOOINE/SHARED_CANTINA_TATOOINE.IFF') === FILE.templates[T] && templateEntry(FILE, 'object/building/other/shared_hut.iff') === null && templateEntry(null, T) === null, "a row's template finds its file's entry in either spelling and any case, and no other");
  ok(pieceKeyOf('place/cantina-1', 7) === 'place/cantina-1.f7', 'a piece of a permanent building is filed under its building\'s key, `.f` and its index');
  const back = pieceOfKey('place/cantina-1.f7');
  ok(back?.building === 'place/cantina-1' && back.index === 7 && pieceOfKey('place/cantina-1') === null && pieceOfKey('place/f7') === null, 'and taken apart again; a row\'s own key is no piece\'s');

  // How each piece is stood (`pieceStand`, `App.furnishDressing`), and made a row of its own (`pieceRow`, the make-own).
  const chair = ours.find((p) => p.index === 0)!;
  const bar = ours.find((p) => p.index === 1)!;
  const st = pieceStand(chair, 'place/cantina-1', { pack: 'world', from: 'naboo' });
  ok(st.key === 'place/cantina-1.f0' && st.inside === true && st.radius === FURNITURE_RADIUS && st.solid === false && st.effectsOf === CHAIR && st.from === undefined, "a piece stands under its building's key and its index, in its rooms, filed at the furniture's radius, a seat never solid, its effects by its own template, and a props piece out of no world");
  const sb = pieceStand(bar, 'place/cantina-1', { pack: 'world', from: 'naboo' });
  ok(sb.solid === undefined && sb.from === 'naboo' && pieceStand(bar, 'place/cantina-1', { pack: 'gallery' }).from === undefined, "a piece of the building's own pack out of the world the row names (a gallery row's, none), solid by the world's rule");
  ok(pieceStand({ ...bar, cell: 0 }, 'k', { pack: 'gallery' }).inside === false, 'a piece standing outside its rooms (room nought) is no room\'s');
  // Made rows: each `toGame` of its row is where the piece stood, to the file's precision, in the raw frame about the centre.
  const ctx = { centre, frame: 'raw' as const, here: 'tatooine', defOf: (m: string) => (m === 'glow' ? { id: 'glow', file: 'particles/glow.json', particle: true } : null) as never, thingOf: (t: string) => (t === CHAIR ? 'frn_all_chair_s01' : t === LAMP ? 'frn_all_lamp_free_s01' : null) };
  const glow = { index: 9, template: 'object/static/particle/shared_pt_glow.iff', model: 'glow', from: 'props' as const, cell: 2, x: chair.x + 0.5, y: chair.y + 1, z: chair.z, q: chair.q };
  let off = 0;
  let offTurn = 0;
  const rowsMade: { p: typeof chair; row: Omit<PlacementRow, 'id'> }[] = [];
  for (const p of [...ours, glow]) {
    const r = pieceRow(p, { pack: 'world', from: 'naboo' }, ctx);
    ok(typeof r !== 'string', `piece ${p.index} makes a row (${typeof r === 'string' ? r : r.row.kind})`);
    if (typeof r === 'string') continue;
    ok(r.index === p.index, `and keeps its index (${r.index})`);
    rowsMade.push({ p, row: r.row });
    const g = toGame(r.row as PlacementRow, centre, 'raw');
    off = Math.max(off, Math.abs(g.x - p.x), Math.abs(g.y - p.y), Math.abs(g.z - p.z));
    offTurn = Math.max(offTurn, 1 - Math.abs(g.q[0] * p.q[0] + g.q[1] * p.q[1] + g.q[2] * p.q[2] + g.q[3] * p.q[3]));
  }
  ok(off <= 0.0005 + 1e-9 && offTurn < 1e-5, `every row made of a piece stands where the piece stood: within ${off.toFixed(4)} m and a turn ${offTurn.toExponential(1)} off (the rows keep a millimetre and a millionth)`);
  const rowOf = (i: number) => rowsMade.find((m) => m.p.index === i)!.row;
  ok(rowOf(0).pack === 'props' && rowOf(0).thing === 'frn_all_chair_s01' && rowOf(0).inside === true && rowOf(0).solid === undefined, "a props piece is the catalogue's thing for its template, in its room");
  ok(rowOf(1).pack === 'world' && rowOf(1).model === 'bar' && rowOf(1).template === BAR && rowOf(1).from === 'naboo' && rowOf(1).inside === true, "a piece of the building's own pack is that model by its template, out of the world the building's row names");
  ok(rowOf(9).kind === 'mark' && JSON.stringify(rowOf(9).attach) === '[{"fx":"props:particles/glow.json"}]' && rowOf(9).inside === true, "an effect is a mark carrying it, out of the props folder");
  const seat = pieceRow({ ...bar, template: CHAIR, model: 'chair_own', from: 'own' }, { pack: 'gallery' }, ctx);
  ok(typeof seat !== 'string' && seat.row.solid === false && seat.row.pack === 'gallery' && seat.row.from === undefined, "a seat of the building's own pack is written never solid, as it stood; a gallery row's out of no world");
  ok(pieceRow({ ...chair, template: 'object/tangible/furniture/all/shared_nothing.iff' }, { pack: 'gallery' }, ctx) === `the props catalogue has no thing for object/tangible/furniture/all/shared_nothing.iff: convert the props again (\`props\`) and the furniture can be made its own`, 'a piece the catalogue has no thing for is refused in words');
}

// ---------------------------------------------------------------- 5b. what a building whose furniture is its own carries

{
  const rows = [
    { id: 'house', layer: 'world', kind: 'building', inside: false, x: 0, y: 0, z: 0 },
    { id: 'chair', layer: 'world', kind: 'prop', inside: true, x: 1, y: 0.3, z: 1 },
    { id: 'lamp-glow', layer: 'world', kind: 'mark', inside: true, x: 2, y: 2.5, z: 0 },
    { id: 'doormat', layer: 'world', kind: 'prop', inside: true, x: 0, y: 0.3, z: 9.6 },
    { id: 'story-crate', layer: 'story', kind: 'prop', inside: true, x: -1, y: 0.3, z: 1 },
    { id: 'outside', layer: 'world', kind: 'prop', inside: false, x: 1, y: 0.3, z: 1 },
    { id: 'neighbour', layer: 'world', kind: 'prop', inside: true, x: 40, y: 0.3, z: 0 },
    { id: 'shed', layer: 'world', kind: 'building', inside: true, x: 1, y: 0, z: 2 },
  ];
  // The streamer's rule stood in: the house's rooms hold everything within 10 m of its middle (the doormat in a doorway too).
  const hostAt = (x: number, y: number, z: number) => (Math.hypot(x, z) <= 10 && y < 8 ? 'place/house' : Math.hypot(x - 40, z) <= 10 ? 'place/next' : null);
  const got = carriedRowIds({ id: 'house', key: 'place/house', layer: 'world' }, rows, hostAt);
  ok(JSON.stringify(got) === JSON.stringify(['chair', 'lamp-glow', 'doormat']), `a building carries every row of its own file standing in its rooms, a mark and one in a doorway included, and nothing of another file, nothing outside a room, nothing of another building's rooms, no building (${got.join(', ')})`);
}

// ---------------------------------------------------------------- 6. a post moved clear of a solid piece

{
  const square = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, min: [1, 0, 1], max: [-1, 1, -1] };
  ok(insidePiece(square, 0.2, 0.1, 0.2, 0), 'a post inside a crate is in it (either corner of its box first)');
  ok(!insidePiece(square, 0.2, 0.95, 0.2, 0), 'feet within a hand of its top stand on it, not in it');
  ok(!insidePiece(square, 1.2, 0.1, 0, 0) && insidePiece(square, 1.2, 0.1, 0, 0.35), "a post beside it is clear, and inside the body's own half-width of it");
  // Turned an eighth about up: its corner along +X reaches 1.41 m, its side along the diagonal only 1 m.
  const crate = { ...square, qy: Math.sin(Math.PI / 8), qw: Math.cos(Math.PI / 8) };
  ok(insidePiece(crate, 1.3, 0.1, 0, 0) && !insidePiece(square, 1.3, 0.1, 0, 0) && !insidePiece(crate, 0.95, 0.1, 0.95, 0) && insidePiece(square, 0.95, 0.1, 0.95, 0), 'turned with its own turn');
  const rug = { ...crate, min: [-2, 0, -2], max: [2, 0.05, 2] };
  const hall = { ...crate, min: [-20, 0, -20], max: [20, 3, 20] };
  ok(!insidePiece(rug, 0, 0.01, 0, 0) && !insidePiece(hall, 0, 0.5, 0, 0), `a piece lower than ${POST_CLEAR_TUNE.least} m (a rug) or wider than ${POST_CLEAR_TUNE.widest} m (a room's dressing) is no place to be stuck in`);
  // A room 6 m across whose floor stands at 0.2, its east half missing.
  const floorAt = (x: number, _y: number, z: number) => (Math.abs(x) <= 3 && Math.abs(z) <= 3 && x <= 0.6 ? 0.2 : null);
  const post = { x: 0.2, y: 0.2, z: 0.2 };
  const spot = clearSpotNear(post, [crate], floorAt);
  ok(!!spot && !insidePiece(crate, spot.x, spot.y, spot.z, POST_CLEAR_TUNE.body) && spot.x <= 0.6 && near(spot.y, 0.2), `the nearest spot clear of it by a body's width, on the room's own floor (${spot ? `${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}` : 'none'})`);
  const far = Math.hypot(spot!.x - post.x, spot!.z - post.z);
  ok(far <= 2, `and near: ${far.toFixed(2)} m off`);
  ok(clearSpotNear(post, [crate], () => null) === null, 'with no floor round it, nowhere');
}

// ---------------------------------------------------------------- 6b. the people pass asks a post once, waits, and stands it clear

{
  const { StandingPeople } = await import('../../../src/world/standingPeople.ts');
  const row = (over: Record<string, unknown>) => ({ who: 'somebody', id: 'body', x: 0, y: 2, z: 0, heading: 0, cell: 99, room: 1, respawn: 300, where: 'static_spawns', ...over });
  const people = new StandingPeople();
  people.adopt([
    row({ who: 'barman', x: 10, z: 10 }),
    row({ who: 'drinker', x: 12, z: 10, sit: true }),
    row({ who: 'lounger', x: 14, z: 10, mood: 'npc_sitting_chair' }),
    row({ who: 'walker', x: 20, z: 20, peaceful: true, route: [{ x: 20, y: 2, z: 20, room: 1 }, { x: 24, y: 2, z: 20, room: 1 }] }),
  ] as never);
  type Body = { who: string; x: number; z: number; removed: boolean; dead: boolean; patrol?: unknown };
  const bodies: Body[] = [];
  const asked: string[] = [];
  let answer: 'wait' | 'move' | 'clear' = 'wait';
  const deps = {
    catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }),
    spawn: (_e: unknown, at: { x: number; z: number }, how: { index: number }) => {
      const b: Body = { who: String(how.index), x: at.x, z: at.z, removed: false, dead: false };
      bodies.push(b);
      return b;
    },
    remove: (m: Body) => {
      m.removed = true;
    },
    centre: () => ({ x: 0, z: 0 }),
    held: () => false,
    clearPost: (st: { x: number; z: number }) => {
      asked.push(`${st.x},${st.z}`);
      if (answer === 'wait') return null;
      if (answer === 'clear') return false;
      st.x += 2;
      return true;
    },
  };
  const here = new THREE.Vector3(-14, 0, 12);
  people.step(1, 1, here, deps as never, true);
  // The snapshot's x is mirrored about the centre: the barman stands at the game's (-10, 10), the walker at (-20, 20).
  ok(!bodies.some((b) => Math.abs(b.x + 10) < 1e-9 && Math.abs(b.z - 10) < 1e-9) && asked.filter((a) => a === '-10,10').length === 1 && people.last.waiting >= 2, `a post whose answer must wait is not stood and is counted waiting (${people.last.waiting})`);
  ok(!asked.includes('-12,10') && !asked.includes('-14,10'), 'a seated row, by the server or by its sitting mood, is never asked');
  const seated = bodies.length;
  answer = 'move';
  people.step(10, 10, here, deps as never, true);
  const barman = bodies.find((b) => Math.abs(b.z - 10) < 1e-9 && Math.abs(b.x + 8) < 1e-9);
  ok(asked.filter((a) => a === '-10,10').length === 2 && !!barman, 'asked again on a later pass, and stood at the spot it was moved to');
  ok(people.last.cleared === 2, `each post moved clear is counted (${people.last.cleared})`);
  const walker = bodies.find((b) => Math.abs(b.z - 20) < 1e-9);
  ok(!!walker && Math.abs(walker.x + 18) < 1e-9 && !!walker.patrol, "a patroller moved clear at its round's first point still walks its round, from where it stands");
  const calls = asked.length;
  people.step(10, 20, new THREE.Vector3(9000, 0, 9000), deps as never, true);
  people.step(10, 30, here, deps as never, true);
  ok(asked.length === calls && bodies.filter((b) => !b.removed).length >= seated, 'a post asked once is never asked again (walked away from and back to, it stands where it was moved)');
}

// ---------------------------------------------------------------- 7. a building row's `furnish`

{
  const base = { id: 'cantina-1', kind: 'building', pack: 'gallery', model: 'cantina', template: T, x: 1, y: 2, z: 3, q: [1, 0, 0, 0] };
  const plain = readPlacementRow(base) as PlacementRow;
  const empty = readPlacementRow({ ...base, furnish: false }) as PlacementRow;
  const said: string[] = [];
  const truthy = readPlacementRow({ ...base, furnish: true }, said) as PlacementRow;
  ok(typeof plain === 'object' && plain.furnish === undefined && empty.furnish === false && truthy.furnish === undefined && !said.length, '`furnish: false` is kept on a building, `true` read as the absent it means');
  const odd: string[] = [];
  readPlacementRow({ ...base, furnish: 'no' }, odd);
  const prop: string[] = [];
  const p = readPlacementRow({ id: 'crate-1', kind: 'prop', pack: 'props', thing: 'crate', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], furnish: false }, prop) as PlacementRow;
  ok(odd.includes('cantina-1.furnish') && prop.includes('crate-1.furnish') && p.furnish === undefined, 'anything else, and on anything but a building, is a field this build does not read');
  ok(rowHash(plain) === JSON.stringify(['building', 'gallery', null, 'cantina', null, 1, 2, 3, [1, 0, 0, 0], null, null, null, null, 'template', T]) && rowHash(plain) === rowHash(truthy), "a row with none hashes exactly as before the field was read (so nothing of a file before it stands again)");
  ok(rowHash(empty) !== rowHash(plain) && rowHash(empty).endsWith(',"furnish",false]'), 'and one without its furniture stands as another');
  ok(PLACEMENT_FIELDS.includes('furnish'), "it is one of the fields a file's row is written with");
  const text = placementsFileText('tatooine', 'raw', [empty, plain.id === 'cantina-1' ? { ...plain, id: 'cantina-2' } : plain]);
  const read = readPlacementsFile(text, 'tatooine', 'ground');
  ok(read.rows.length === 2 && read.rows.find((r) => r.id === 'cantina-1')?.furnish === false && read.rows.find((r) => r.id === 'cantina-2')?.furnish === undefined && !read.unknown.length, 'written and read back as it was');
  const line = text.split(/\r?\n/).find((l) => l.includes('"cantina-1"')) ?? '';
  ok(line.indexOf('"furnish"') > line.indexOf('"template"') && line.indexOf('"template"') > 0, 'written after the template, before the looks');
  // The editor's own rows: a new building with the switch off is written empty; one picked up keeps its own word.
  const src = { kind: 'building' as const, pack: 'gallery' as const, model: 'cantina', template: T };
  const fresh = rowFromEditor({ ...src, furnish: false }, { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], false, { x: 0, z: 0 }, 'raw', { here: 'tatooine' });
  const furnished = rowFromEditor(src, { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], false, { x: 0, z: 0 }, 'raw', { here: 'tatooine' });
  const moved = rowFromEditor(src, { x: 5, y: 0, z: 0 }, [0, 0, 0, 1], false, { x: 0, z: 0 }, 'raw', { here: 'tatooine', base: empty });
  const movedBack = rowFromEditor({ ...src, furnish: false }, { x: 5, y: 0, z: 0 }, [0, 0, 0, 1], false, { x: 0, z: 0 }, 'raw', { here: 'tatooine', base: plain });
  ok(fresh.furnish === false && furnished.furnish === undefined, 'a building put down with the switch off is written `furnish: false`, with it on written as before');
  ok(moved.furnish === false && movedBack.furnish === undefined, 'a building picked up and put down keeps its own word, whatever the switch says');
  const propRow = rowFromEditor({ kind: 'prop', pack: 'props', thing: 'crate', furnish: false }, { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], false, { x: 0, z: 0 }, 'raw', { here: 'tatooine' });
  ok(propRow.furnish === undefined, 'a prop never carries it');
}

// ---------------------------------------------------------------- 8. the editor's carry of a building whose furniture is its own

{
  const { withOwnFurniture } = await import('../../../src/editor/editorEdit.ts');
  const rows = new Map<string, PlacementRow>([
    ['own', { id: 'own', kind: 'building', pack: 'gallery', model: 'cantina', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], furnish: false }],
    ['filed', { id: 'filed', kind: 'building', pack: 'gallery', model: 'cantina', x: 50, y: 0, z: 0, q: [1, 0, 0, 0] }],
    ['chair-1', { id: 'chair-1', kind: 'prop', pack: 'props', thing: 'chair', x: 1, y: 0, z: 0, q: [1, 0, 0, 0], inside: true }],
    ['chair-2', { id: 'chair-2', kind: 'prop', pack: 'props', thing: 'chair', x: 2, y: 0, z: 0, q: [1, 0, 0, 0], inside: true }],
    ['crate-1', { id: 'crate-1', kind: 'prop', pack: 'props', thing: 'crate', x: 51, y: 0, z: 0, q: [1, 0, 0, 0], inside: true }],
  ]);
  const ed = {
    rowFor: (id: string) => {
      const row = rows.get(id);
      return row ? { row, layer: 'world' as const, label: id } : null;
    },
    hostedRows: (key: string) => (key === 'place/own' ? ['chair-1', 'chair-2', 'gone-1', 'own.f3'] : key === 'place/filed' ? ['crate-1'] : []),
  };
  ok(JSON.stringify(withOwnFurniture(['own'], ed)) === JSON.stringify(['own', 'chair-1', 'chair-2']), "a building whose furniture is its own takes the rows standing in its rooms (never an id no file holds)");
  ok(JSON.stringify(withOwnFurniture(['filed'], ed)) === JSON.stringify(['filed']), "a building furnished from its file carries nothing of the rows that stand in it (as before the wave)");
  ok(JSON.stringify(withOwnFurniture(['chair-1', 'own'], ed)) === JSON.stringify(['chair-1', 'own', 'chair-2']), 'each once, in the order met');
  ok(JSON.stringify(withOwnFurniture(['own'], { rowFor: ed.rowFor })) === JSON.stringify(['own']), 'and with no streamer to ask, nothing');
  const { ownFurniture } = await import('../../../src/editor/editorEdit.ts');
  const own = ownFurniture(['chair-1', 'own', 'filed'], ed);
  ok(own.host.get('chair-1') === 'own' && own.host.get('chair-2') === 'own' && !own.host.has('crate-1') && !own.host.has('own') && own.host.size === 2, "each row carried is known by the building it stands in, a row picked as well as one taken in with it (so it follows that building whatever the edit), and nothing a furnished building stands");
}

// ---------------------------------------------------------------- 8b. a ship's own furniture, written and hung

{
  // A node at the hull's +X, turned a third about up, its cell the cockpit (2).
  const a = Math.PI / 3;
  const m = [Math.cos(a), 0, Math.sin(a), 1.25, 0, 1, 0, 0.5, -Math.sin(a), 0, Math.cos(a), -2];
  const f = hullFurniturePlace(m);
  ok(near(f.place[0], -1.25) && near(f.place[1], 0.5) && near(f.place[2], -2), `the ships command writes a piece's place mirrored in X as the hull's GLB is (${f.place.join(', ')})`);
  const { q } = nodeTransform(m);
  ok(near(f.turn[0], fixed(q[0], 6)) && near(f.turn[1], fixed(q[1], 6)) && near(f.turn[2], fixed(-q[2], 6)) && near(f.turn[3], fixed(-q[3], 6)), 'and its turn [w, x, -y, -z]');
  // The garage's hand: the node's matrix carries a point of the piece's own (GLB) frame where the client's transform, seen
  // in the mirrored frame, carries it: M (R (M v) + t), with M the X mirror.
  const node = new THREE.Object3D();
  placeFurniture(node, { place: f.place, turn: f.turn });
  node.updateMatrixWorld(true);
  let worst = 0;
  for (const v of [[0.3, 0.2, -0.7], [1, 0, 0], [0, 0, 1]]) {
    const mv = [-v[0], v[1], v[2]];
    const client = [m[0] * mv[0] + m[1] * mv[1] + m[2] * mv[2] + m[3], m[4] * mv[0] + m[5] * mv[1] + m[6] * mv[2] + m[7], m[8] * mv[0] + m[9] * mv[1] + m[10] * mv[2] + m[11]];
    const want = [-client[0], client[1], client[2]];
    const got = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(node.matrixWorld);
    worst = Math.max(worst, Math.abs(got.x - want[0]), Math.abs(got.y - want[1]), Math.abs(got.z - want[2]));
  }
  ok(worst < 1e-4, `the garage stands it so (its turn read [w, x, y, z] into three's (x, y, z, w)): every point of it lands where the client's own transform puts it, mirrored (worst ${worst.toExponential(1)} m)`);
  ok(furniturePassable({ file: 'x.glb', template: 'object/tangible/furniture/all/shared_frn_all_chair_s01.iff' }) && furniturePassable({ file: 'x.glb', template: 'object/tangible/furniture/all/shared_frn_all_table_s01.iff' }) && furniturePassable({ file: 'ships/yt1300_pilot_chair.glb' }) && !furniturePassable({ file: 'crate.glb', template: 'object/tangible/furniture/all/shared_frn_all_crate_s01.iff' }), 'a seat, a table and a pilot\'s chair are never colliders of the rooms; a crate is');
  // The ships command writes what `furnitureOf` answers on the hull's entry, and nothing on a hull with none.
  const furn = [{ file: 'chair.glb', template: 'object/tangible/furniture/all/shared_frn_all_chair_s01.iff', cell: 2, ...f }];
  const built = buildShips(['object/ship/player/shared_player_yt1300.iff', 'object/ship/player/shared_player_xwing.iff'], {
    convert: (t: string) => ({ model: t.includes('yt') ? 'yt1300' : 'xwing', file: 'x.glb', bounds: { min: [-1, 0, -1], max: [1, 1, 1] } }),
    furnitureOf: (t: string) => (t.includes('yt1300') ? furn : null),
  });
  const yt = built.ships.find((s: { id: string }) => s.id === 'yt1300') as { furniture?: unknown };
  const xw = built.ships.find((s: { id: string }) => s.id === 'xwing') as { furniture?: unknown };
  ok(JSON.stringify(yt?.furniture) === JSON.stringify(furn) && xw && !('furniture' in xw), "the ships command writes a hull's furniture on its entry, and none on a hull whose template names no file");
}

// ---------------------------------------------------------------- 8c. the props the files need, and the sounds they stand

{
  const CHAIR = 'object/tangible/furniture/all/shared_frn_all_chair_s01.iff';
  const WORN = 'object/tangible/wearables/armor/composite/shared_armor_composite_helmet.iff';
  const COLUMN = 'object/building/kashyyyk/shared_cave_column_s01.iff';
  const BROKEN = 'object/building/general/shared_broken_crate_s01.iff';
  const asked: string[] = [];
  const got = buildInteriorProps(new Set([CHAIR, WORN, COLUMN, BROKEN, 'object/soundobject/shared_soundobject_cantina_large.iff', 'object/cell/shared_cell.iff']), {
    convert: (t: string) => {
      asked.push(t);
      return t === BROKEN ? { skip: 'no mesh' } : { model: t.replace(/^.*\/shared_/, '').replace(/\.iff$/, ''), file: 'x.glb', bounds: { min: [-1, 0, -1], max: [1, 2, 1] } };
    },
  });
  ok(got.props.length === 2 && got.props.every((p: { interior?: boolean }) => p.interior === true) && got.props.some((p: { template: string }) => p.template === WORN) && got.props.some((p: { template: string }) => p.template === COLUMN), `the things a file stands that the catalogue's roots leave out are added, marked interior (${got.props.map((p: { id: string }) => p.id).join(', ')})`);
  ok(!asked.includes(CHAIR) && !asked.some((t) => /soundobject|\/cell\//.test(t)), 'a template the catalogue already carries is never added twice, nor a sound object or a cell');
  ok(got.worn === 1 && got.skipped.length === 1 && got.skipped[0].template === BROKEN && got.skipped[0].why === 'no mesh', 'the worn piece on display is counted, and one that does not convert is left out with why');

  // The sound objects a building's file stands, placed as the snapshot's own are.
  const T = 'object/building/tatooine/shared_cantina_tatooine.iff';
  const SND = 'object/soundobject/shared_soundobject_cantina_large.iff';
  const yaw = [Math.SQRT1_2, 0, Math.SQRT1_2, 0];
  const layout = { objects: [{ template: 'object/rock', x: 0, y: 0, z: 0, q: [1, 0, 0, 0] }, { template: T, x: 10, y: 1, z: 5, q: yaw }] };
  const interiors = {
    templates: {
      [T]: {
        file: 'interiorlayout/cantina.ilf',
        model: 'cantina',
        pieces: [
          [0, SND, '', 'snd', 2, 1, 2, 3, 1, 0, 0, 0],
          [1, SND, '', 'snd', 2, 4, 2, 0, 1, 0, 0, 0],
          [2, 'object/tangible/instrument/shared_kloo_horn.iff', 'horn', 'props', 3, 0, 1, -2, 1, 0, 0, 0],
          [3, CHAIR, 'chair', 'props', 2, 0, 0, 0, 1, 0, 0, 0],
        ],
      },
    },
    buildings: [{ row: 1, key: `o:${T}@10,1,5`, template: T, skip: [1], states: { 2: 'soe=final' } }],
  };
  const soundOf = (t: string) => (t === SND ? 'sound/amb_cantina.snd' : /kloo/.test(t) ? 'sound/music_band.snd' : null);
  const em = interiorEmitters(null, interiors, layout, {}, { soundOf, pobOf: () => 'cantina_tatooine.pob' });
  ok(em.length === 2 && em.every((e: { template: string }) => e.template !== CHAIR), `every piece with a loop of its own is an emitter, the one standing twice left out (${em.length})`);
  const first = em.find((e: { sound: string }) => e.sound === 'sound/amb_cantina.snd') as { p: number[]; cell: number; pob: string; bp: number[]; state?: string };
  const v = rotateByQuat(yaw, [1, 2, 3]);
  ok(near(first.p[0], Math.round((10 + v[0]) * 100) / 100) && near(first.p[1], 3) && near(first.p[2], Math.round((5 + v[2]) * 100) / 100), `in the snapshot's frame, its building's place and turn carrying it (${first.p.join(', ')})`);
  ok(first.cell === 2 && first.pob === 'cantina_tatooine.pob' && JSON.stringify(first.bp) === '[10,1,5]' && first.state === undefined, "in its room of its building's portal layout, with its building's place");
  const band = em.find((e: { sound: string }) => e.sound === 'sound/music_band.snd') as { state?: string; cell: number };
  ok(band.state === 'soe=final' && band.cell === 3, 'a piece standing in one state only sounds there only');
}

// ---------------------------------------------------------------- 9. the owner's archives, every file of them

{
  let swg = process.env.SWG ?? '';
  const env = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (!swg && existsSync(env)) {
    for (const line of readFileSync(env, 'utf8').split(/\r?\n/)) {
      const m = /^\s*SWG\s*=\s*(.*?)\s*$/.exec(line);
      if (m) swg = m[1].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  if (!swg || !existsSync(swg)) note('no SWG install on this machine, so the real interior layout files are not read here');
  else {
    const { openVfs } = await import('../tre.mjs');
    const { isRetailByName } = await import('../manifest.mjs');
    const vfs = openVfs(swg, { filter: (f: string) => isRetailByName(f, statSync(join(swg, f)).size) !== null, log: () => {} });
    const files = vfs.list('interiorlayout/').filter((f: string) => f.toLowerCase().endsWith('.ilf'));
    let nodes = 0;
    const refused: string[] = [];
    let scaled = 0;
    for (const f of files) {
      try {
        const r = readIlf(vfs.read(f));
        nodes += r.nodes.length;
        for (const n of r.nodes) {
          const cols = [0, 1, 2].map((k) => Math.hypot(n.m[k], n.m[4 + k], n.m[8 + k]));
          if (cols.some((c) => Math.abs(c - 1) > 1e-3)) scaled++;
        }
      } catch (err) {
        refused.push(`${f}: ${(err as Error).message}`);
      }
    }
    ok(files.length >= 290 && !refused.length, `every interior layout file the archives hold reads to the byte (${files.length} files, ${nodes} things${refused.length ? `; refused ${refused.slice(0, 3).join('; ')}` : ''})`);
    ok(scaled === 0, 'and no node carries a scale');
    const cantina = files.find((f: string) => /shared_cantina_mos_eisley_tatooine\.ilf$/.test(f));
    const jabba = files.find((f: string) => /jabba_palace_interior\.ilf$/.test(f));
    ok(!!cantina && readIlf(vfs.read(cantina)).nodes.length > 200, `the Mos Eisley cantina's file is there and stands its seats, tables, glasses and band (${cantina ? readIlf(vfs.read(cantina)).nodes.length : 0} things)`);
    ok(!!jabba && readIlf(vfs.read(jabba)).nodes.length > 100, `and Jabba's palace's (${jabba ? readIlf(vfs.read(jabba)).nodes.length : 0} things)`);
  }
}

// ---------------------------------------------------------------- 10. the packs on disk, where there are any

{
  const root = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
  if (!existsSync(root)) note('no packs on this machine');
  else {
    let packs = 0;
    let buildings = 0;
    let moved = 0;
    let stood = 0;
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const f = join(root, d.name, 'interiors.json');
      if (!existsSync(f)) continue;
      const j = JSON.parse(readFileSync(f, 'utf8'));
      if (!interiorsReadable(j)) continue;
      packs++;
      if (d.name === 'gallery') ok(Object.keys(j.templates).length > 0, `the gallery's file holds its buildings' tables (${Object.keys(j.templates).length} templates), for the editor's rows`);
      const layoutFile = join(root, d.name, 'layout.json');
      if (!existsSync(layoutFile)) continue;
      const layout = JSON.parse(readFileSync(layoutFile, 'utf8'));
      const r = furnishLayout(layout.objects ?? [], j);
      buildings += j.buildings.length;
      moved += r.moved;
      stood += r.objects.length;
      ok(r.moved === 0, `${d.name}: every building its file names stands at its row with its template (${j.buildings.length} buildings, ${r.objects.length} things)`);
      const keys = new Set(r.objects.map((o) => o.ilf));
      ok(keys.size === r.objects.length, `${d.name}: every piece's key is its own`);
    }
    if (!packs) note('no pack carries interiors.json yet (run `interiors`)');
    else note(`${packs} packs carry their interior layout tables: ${stood} things in ${buildings} buildings, ${moved} buildings moved since`);
  }
}

console.log(`\n${checks} checks passed`);
