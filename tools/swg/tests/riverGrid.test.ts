// The walk grid follows the rivers (Map-maker II's sixth wave, DESIGN.md §9 and the owner's answer to Q7: the converter's
// bake, never a patch at run time): the terrain's own wet rivers (rivertest's two, watertabletest's one) and the water
// file's rivers are water to the bake as a lake is, by the game's own rule (`riverTable`, `riversSurface`), and the grid's
// key folds in a stamp of the terrain's rivers so exactly the worlds that have them are baked again.
//
// Held here, on the converted packs (a world not converted is said and stepped over):
//   - rivertest and watertabletest baked with their rivers and without: the cells the rivers block are water and lie
//     under a river; every other reason a cell has is the same; nothing blocked without them is opened; the header counts
//     them (`soeRivers`);
//   - a river of ours in a water file over umbra (whose terrain has none): deep, its cells are water and every one under
//     it, and the header counts it (`edits.rivers`); shallow, nothing is blocked; a steep reach under 'fall' is no water;
//   - the stamp: `v1:<n>` for a terrain with rivers and '' for one without, folded into the key only where it is not
//     empty, and a grid with no key over a world with one is stale in its own words;
//   - the wave's conversion: rivertest's and watertabletest's grids on disk, where their key says they are current, are
//     today's bake with their rivers to the byte (a grid whose key is not current is said: `status` asks for it again).
//
// Run: node tools/swg/tests/riverGrid.test.ts
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { REPO } from './oldModules.ts';
import { buildNavGrid, gridEditsOf, gridSoeRivers, soeRiverStamp, walkThroughTemplates } from '../navgrid.mjs';
import { gridLayoutStale, layoutKeyOf } from '../finalnames.mjs';
import { RIVER_TUNE, riversSurface, riverTable } from '../../../src/world/ourWater.ts';
import { readWaterRow, waterFileText, type WaterRiverRow } from '../../../src/world/editFiles/waterFile.ts';
import { parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';

let passed = 0;
function ok(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
}
const note = (s: string): void => console.log(`note ${s}`);

const PACKS = join(REPO, 'assets-private');
const PLAIN = { world: 'none', texts: { heights: null, water: null, world: null, story: null } };
const wt = walkThroughTemplates();
const WATER = 4;

interface Built {
  header: { x0: number; z0: number; cell: number; nx: number; nz: number; center: { x: number; z: number }; stats: { water: number; soeRivers?: number; edits?: { rivers?: number } } };
  flags: Uint8Array;
}

/** Each cell's middle in the grid's (the game's) frame. */
const middle = (h: Built['header'], k: number): [number, number] => [h.x0 + ((k % h.nx) + 0.5) * h.cell, h.z0 + (Math.floor(k / h.nx) + 0.5) * h.cell];

/** A grid's planes joined as nav.bin holds them (before the deflate). */
const planes = (g: { nibbles: Uint8Array; coarse: Uint8Array; edges: Uint8Array; clear: Uint8Array }): Buffer => Buffer.concat([g.nibbles, g.coarse, g.edges, g.clear].map((a) => Buffer.from(a)));

// --- the wave's conversion: the test worlds' grids on disk ---
for (const [w, n] of [['rivertest', 2], ['watertabletest', 1]] as const) {
  const dir = join(PACKS, w);
  if (!existsSync(join(dir, 'nav.json')) || !existsSync(join(dir, 'nav.bin'))) {
    note(`${w} has no grid on disk: the conversion is not checked`);
    continue;
  }
  const head = JSON.parse(readFileSync(join(dir, 'nav.json'), 'utf8')) as { layoutKey?: string; stats?: { soeRivers?: number } };
  // The edits as the converter's own run reads them (the committed files and the pack's folder, so the terrain's stamp).
  const edits = gridEditsOf(w, undefined, dir);
  const key = layoutKeyOf(dir, wt, edits);
  if (head.layoutKey !== key) {
    note(`${w}: the grid on disk is keyed ${head.layoutKey ?? 'with nothing'}, not ${key}: status asks for it again, and it is not compared`);
    continue;
  }
  const grid = (await buildNavGrid(dir, { walkThrough: wt, edits })) as Built & { nibbles: Uint8Array; coarse: Uint8Array; edges: Uint8Array; clear: Uint8Array };
  const disk = inflateRawSync(readFileSync(join(dir, 'nav.bin')));
  ok(planes(grid).equals(disk) && head.stats?.soeRivers === n && grid.header.stats.soeRivers === n, `${w}: the grid on disk, keyed as current (${key}), is today's bake with its terrain's ${n} river${n === 1 ? '' : 's'} to the byte (${disk.length} bytes)`);
}

// --- the terrain's own wet rivers ---
for (const [w, n] of [['rivertest', 2], ['watertabletest', 1]] as const) {
  const dir = join(PACKS, w);
  if (!existsSync(join(dir, 'nav.json')) || !existsSync(join(dir, 'terrain.trn'))) {
    note(`${w} is not converted: its rivers in the bake are not checked`);
    continue;
  }
  const a = (await buildNavGrid(dir, { walkThrough: wt, edits: PLAIN })) as Built;
  const b = (await buildNavGrid(dir, { walkThrough: wt, edits: PLAIN, soeRivers: false })) as Built;
  const h = a.header;
  const tmpl = parseTerrainTemplate(new Uint8Array(readFileSync(join(dir, 'terrain.trn'))));
  const rows = gridSoeRivers(tmpl.generator) as WaterRiverRow[];
  const tables = rows.map((row) => riverTable(row, (x) => h.center.x - x, (z) => z - h.center.z, row.id));
  let added = 0;
  let under = true;
  let kept = true;
  let others = true;
  for (let k = 0; k < a.flags.length; k++) {
    const fa = a.flags[k];
    const fb = b.flags[k];
    if ((fa & ~WATER) !== (fb & ~WATER)) others = false;
    if (fb & WATER && !(fa & WATER)) kept = false;
    if (fa & WATER && !(fb & WATER)) {
      added++;
      const [gx, gz] = middle(h, k);
      if (!(riversSurface(tables, gx, gz, -Infinity) > -Infinity)) under = false;
    }
  }
  ok(rows.length === n && h.stats.soeRivers === n && b.header.stats.soeRivers === undefined, `${w}: the bake makes its terrain's ${n} wet river${n === 1 ? '' : 's'} water and its header counts ${n === 1 ? 'it' : 'them'}`);
  ok(added > 0 && under, `${w}: ${added} cells more are water, every one under a river`);
  ok(kept && others, `${w}: nothing blocked without them is opened, and every other reason a cell has is the same`);
  ok(h.stats.water === b.header.stats.water + added, `${w}: the header's water count is the plain one and those cells (${b.header.stats.water} + ${added})`);
}

// --- a river of ours over a world whose terrain has none ---
{
  const w = 'umbra';
  const dir = join(PACKS, w);
  if (!existsSync(join(dir, 'nav.json')) || !existsSync(join(dir, 'layout.json'))) note(`${w} is not converted: a river of ours in the bake is not checked`);
  else {
    const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8')) as { center: { x: number; z: number } };
    const c = layout.center;
    const make = (h0: number, h1: number, id = 'run'): WaterRiverRow => readWaterRow({ id, kind: 'river', points: [[c.x - 120, c.z - 40, h0], [c.x - 40, c.z, (h0 + h1) / 2], [c.x + 80, c.z + 30, h1]], width: 24, velocity: 1, shader: null }) as WaterRiverRow;
    const plain = (await buildNavGrid(dir, { walkThrough: wt, edits: PLAIN })) as Built;
    const deepRow = make(500, 499);
    const deep = (await buildNavGrid(dir, { walkThrough: wt, edits: { world: w, texts: { ...PLAIN.texts, water: waterFileText(w, [deepRow]) } } })) as Built;
    const h = deep.header;
    const tables = [riverTable(deepRow, (x) => h.center.x - x, (z) => z - h.center.z)];
    let added = 0;
    let under = true;
    let missed = 0;
    for (let k = 0; k < deep.flags.length; k++) {
      const [gx, gz] = middle(h, k);
      const over = riversSurface(tables, gx, gz, -Infinity) > -Infinity;
      if (deep.flags[k] & WATER && !(plain.flags[k] & WATER)) {
        added++;
        if (!over) under = false;
      } else if (over && !(deep.flags[k] & WATER)) missed++;
    }
    ok(added > 50 && under && missed === 0, `${w}: a deep river of ours makes every cell under it water (${added}), and none off it`);
    ok(h.stats.edits?.rivers === 1 && h.stats.soeRivers === undefined, "and the header counts it among the file's edits");
    const shallow = (await buildNavGrid(dir, { walkThrough: wt, edits: { world: w, texts: { ...PLAIN.texts, water: waterFileText(w, [make(-500, -501)]) } } })) as Built;
    ok(Buffer.from(shallow.flags).equals(Buffer.from(plain.flags)), `${w}: a river under the ground blocks nothing`);
    // A steep reach: the same river with its middle point dropped 60 m, so its first reach falls 30° and more. Under the
    // game's 'effects' it is water still; under 'fall' and 'refuse' it is none (the bake reads the tune the game would).
    const steepRow = readWaterRow({ id: 'steep', kind: 'river', points: [[c.x - 120, c.z - 40, 560], [c.x - 40, c.z, 500], [c.x + 80, c.z + 30, 499]], width: 24, velocity: 1, shader: null }) as WaterRiverRow;
    const text = waterFileText(w, [steepRow]);
    const effects = (await buildNavGrid(dir, { walkThrough: wt, edits: { world: w, texts: { ...PLAIN.texts, water: text } } })) as Built;
    RIVER_TUNE.steep = 'fall';
    const fall = (await buildNavGrid(dir, { walkThrough: wt, edits: { world: w, texts: { ...PLAIN.texts, water: text } } })) as Built;
    RIVER_TUNE.steep = 'effects';
    const t = riverTable(steepRow, (x) => h.center.x - x, (z) => z - h.center.z);
    ok(t.river.stretches.length === 1, `the steep river has one stretch past ${RIVER_TUNE.slopeMax}° (${t.river.stretches[0]?.slope.toFixed(1)}°)`);
    ok(effects.header.stats.water > fall.header.stats.water, `${w}: under 'effects' its steep reach is water to the bake (${effects.header.stats.water} cells), under 'fall' none (${fall.header.stats.water})`);
  }
}

// --- the stamp and the key ---
{
  let seen = 0;
  for (const [w, want] of [['rivertest', 'v1:2'], ['watertabletest', 'v1:1'], ['umbra', ''], ['floratest', ''], ['tatooine', '']] as const) {
    const dir = join(PACKS, w);
    if (!existsSync(join(dir, 'layout.json'))) continue;
    seen++;
    const stamp = soeRiverStamp(dir);
    ok(stamp === want, `${w}: its terrain's rivers stamp '${stamp}'`);
    const edits = gridEditsOf(w, null, dir) as { soeRivers?: string };
    ok(want ? edits.soeRivers === want : !('soeRivers' in edits), want ? `${w}: and the edits carry it` : `${w}: and the edits carry none`);
    const keyed = layoutKeyOf(dir, wt, edits);
    const plain = layoutKeyOf(dir, wt, { world: w, texts: PLAIN.texts });
    ok(want ? keyed !== plain : keyed === plain, want ? `${w}: its key folds it in` : `${w}: its key is the one it had`);
    if (want) {
      const why = gridLayoutStale({ cell: 2 }, dir, null, wt, edits);
      ok(why === "was baked before the terrain's own rivers were water", `${w}: a grid with no key is stale in its own words ("${why}")`);
    }
  }
  if (!seen) note('no converted world: the stamp is not checked');
}

console.log(`riverGrid: ${passed} checks passed`);
