// Buildout tables through a fake archive: an area with a building, its cell and a chair in
// the cell, plus a free-standing statue; world positions must come out like the client's.
import { form, chunk, W, encode } from './iffWriter.ts';
import { loadBuildouts, mergeBuildouts, parseCrcStringTable } from '../buildout.mjs';
import { flattenWithWorldTransforms } from '../ws.mjs';
import { parseIff } from '../iff.mjs';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failures++;
};

const dt = (cols: string[], types: string[], rows: W[]) =>
  Buffer.from(encode(form('DTII', form('0001',
    chunk('COLS', cols.reduce((w, c) => w.str(c), new W().i32(cols.length)).bytes()),
    chunk('TYPE', types.reduce((w, t) => w.str(t), new W()).bytes()),
    chunk('ROWS', new Uint8Array([...new W().i32(rows.length).bytes(), ...rows.flatMap((r) => [...r.bytes()])]))))));

// crc string table: two names with made-up crcs
const names = ['object/building/naboo/shared_theed_palace.iff', 'object/cell/shared_cell.iff', 'object/tangible/furniture/shared_chair.iff', 'object/static/shared_statue.iff'];
const crcs = [0x11111111, 0x22222222, 0x33333333, 0x44444444];
const stng: number[] = [];
const offsets: number[] = [];
for (const n of names) {
  offsets.push(stng.length);
  for (const ch of n) stng.push(ch.charCodeAt(0));
  stng.push(0);
}
const cstb = Buffer.from(encode(form('CSTB', form('0000', chunk('DATA', new W().i32(4).bytes()), chunk('CRCT', crcs.reduce((w, c) => w.u32(c), new W()).bytes()), chunk('STRT', offsets.reduce((w, o) => w.i32(o), new W()).bytes()), chunk('STNG', new Uint8Array(stng))))));

const cols = ['objid', 'container', 'shared_template_crc', 'cell_index', 'px', 'py', 'pz', 'qw', 'qx', 'qy', 'qz', 'radius', 'portal_layout_crc'];
const types = ['i', 'i', 'i', 'i', 'f', 'f', 'f', 'f', 'f', 'f', 'f', 'f', 'i'];
const row = (objid: number, container: number, crc: number, cell: number, px: number, py: number, pz: number, qw: number, qy: number, radius: number, pob: number) =>
  new W().i32(objid).i32(container).i32(crc | 0).i32(cell).f32(px).f32(py).f32(pz).f32(qw).f32(0).f32(qy).f32(0).f32(radius).i32(pob);
// building at area-relative (100, 5, 200) turned 90 degrees about Y; its cell; a chair 2 m along the cell's +X; a statue
const s2 = Math.SQRT1_2;
const areaRows = dt(cols, types, [row(-7, 0, crcs[0], 0, 100, 5, 200, s2, s2, 60, 0x99), row(-8, -7, crcs[1], 1, 0, 0, 0, 1, 0, 0, 0), row(-9, -8, crcs[2], 1, 2, 0, 0, 1, 0, 1, 0), row(-10, 0, crcs[3], 0, 10, 0, 20, 1, 0, 3, 0)]);
const areas = dt(['area', 'x1', 'z1', 'x2', 'z2', 'eventRequired'], ['s', 'f', 'f', 'f', 'f', 's'], [new W().str('theed_palace').f32(-6000).f32(4000).f32(-5000).f32(5000).str(''), new W().str('life_day').f32(0).f32(0).f32(1).f32(1).str('life_day')]);
const files = new Map<string, Buffer>([
  ['datatables/buildout/areas_naboo.iff', areas],
  ['datatables/buildout/naboo/theed_palace.iff', areaRows],
  ['datatables/buildout/naboo/life_day.iff', areaRows],
  ['misc/object_template_crc_string_table.iff', cstb],
]);
const vfs = { has: (p: string) => files.has(p), read: (p: string) => files.get(p)! };

check('crc table', parseCrcStringTable(parseIff(cstb)).get(0x33333333) === names[2]);
const b = loadBuildouts(vfs, 'naboo');
check('event area skipped', b.stats.eventAreas === 1 && b.stats.areas === 1, JSON.stringify(b.stats));
check('four objects', b.nodes.length === 4);
const snap = mergeBuildouts({ version: '0001', templates: ['object/static/shared_rock.iff'], nodes: [] }, b);
check('templates merged', snap.templates.length === 5 && snap.templates[1] === names[0]);
const entries = flattenWithWorldTransforms(snap);
const palace = entries.find((e) => snap.templates[e.node.templateIndex] === names[0])!;
check('building at area origin + offset', Math.abs(palace.world!.pos[0] - -5900) < 1e-3 && Math.abs(palace.world!.pos[2] - 4200) < 1e-3, JSON.stringify(palace.world));
const chair = entries.find((e) => snap.templates[e.node.templateIndex] === names[2])!;
// 2 m along the building's local +X, which after a 90 degree yaw points along world -Z
check('chair follows its building', chair.parentId !== 0 && Math.abs(chair.world!.pos[0] - -5900) < 1e-3 && Math.abs(chair.world!.pos[2] - 4198) < 1e-3, JSON.stringify(chair.world));
const statue = entries.find((e) => snap.templates[e.node.templateIndex] === names[3])!;
check('free object at area origin + offset', statue.parentId === 0 && Math.abs(statue.world!.pos[0] - -5990) < 1e-3 && Math.abs(statue.world!.pos[2] - 4020) < 1e-3);
console.log(failures ? `${failures} FAILURES` : 'all passed');
process.exit(failures ? 1 : 0);
