// What the client walked through that the placed models' own triangles would make solid here (src/world/walkThrough.ts):
// the owner's shared file `public/placements/solid.json` and a waterfall's falling water.
//
// The file's reader, on files of every shape; the committed file held to its shape alone (which templates it names, and
// how, are the owner's, said in notes); the one rule every collider asks (`collidesByRule`),
// where a thing's own word wins over the file and the file over the size; the real streamer and the real physics in node
// (a fern of a listed template builds no collider and a rock beside it does, a waterfall's falling water builds none while
// its rock does, a model of nothing but falling water is solid nowhere, and the old rule back with the switch); the walk
// grid's bake leaving out a listed template and a falling-water piece (`walkThroughTemplates`, `readGlbTriangles` on a GLB
// written here), its key folding in what the file reaches of a world (`layoutKeyOf`) and the staleness `status` asks of a
// grid by it (`gridLayoutStale`); nobody the game's own data stands somewhere left on a walk-through piece over a fall, on
// the packs on disk. The hand-overs only the game and the commands make are pinned as text.
//
// Run: node tools/swg/tests/walkThrough.test.ts
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { THREE, boxGeo, loadedOf, makeStreamer } from './streamHarness.ts';
import { PACKS } from './materialsHarness.ts';

// After the harness, never beside it (`placedColliders.test.ts` says why).
const { FALLING_WATER_SHADERS, SOLID_FILE, SOLID_FILE_VERSION, SOLID_TUNE, isFallingWaterShader, readSolidFile, setSolidRows, solidRows, solidRuleOf } = await import('../../../src/world/walkThrough.ts');
const { collidesByRule, fallingWater } = await import('../../../src/world/layoutStream.ts');
const { readGlbTriangles, walkThroughTemplates } = await import('../navgrid.mjs');
const { gridLayoutStale, layoutKeyOf } = await import('../finalnames.mjs');

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (what: string) => console.log(`note ${what}`);

const FERN = 'object/building/kashyyyk/shared_ptch_kashyyyk_fern_s01.iff';
const ROCKT = 'object/static/test/shared_test_rock.iff';

// --- the reader ----------------------------------------------------------------------------------------------------------
{
  const good = readSolidFile(JSON.stringify({ version: 1, everywhere: { [FERN]: { solid: false }, [ROCKT]: { solid: true }, 'not/a/template': { solid: false }, 'object/x/shared_y.iff': { solid: 'no' } } }));
  ok(good.problem === null && good.rows.size === 2 && good.rows.get(FERN) === false && good.rows.get(ROCKT) === true, 'a row is a template and a boolean; anything else is passed over');
  ok(readSolidFile('{nope').problem !== null && readSolidFile('{nope').rows.size === 0, 'a file that is not JSON is no rows, with why');
  ok(readSolidFile(JSON.stringify({ version: 2, everywhere: {} })).problem?.includes('version 2') === true, 'a file of another version is no rows, with why');
  ok(readSolidFile(JSON.stringify({ version: 1 })).problem === 'no everywhere scope' && readSolidFile('[]').problem === 'not an object', 'and so is a file of another shape');
  ok(SOLID_FILE === 'placements/solid.json' && SOLID_FILE_VERSION === 1, 'the file is the placements folder\'s solid.json, version 1');
}

// --- the committed file ---------------------------------------------------------------------------------------------------
// Held to its shape only: which templates are in it, and whether each is solid, are the owner's choices (and Map-maker II's
// editor will write it), so they are said in notes and never asserted. What a choice must not do -- leave somebody the
// game's data stands on a piece of it with nothing solid under them -- is the floors' check below.
const committed = readFileSync(new URL('../../../public/placements/solid.json', import.meta.url), 'utf8');
const fileRows = readSolidFile(committed);
const walkedRows = [...fileRows.rows].filter(([, s]) => s === false).map(([t]) => t);
{
  const raw = JSON.parse(committed) as { everywhere: Record<string, unknown> };
  ok(fileRows.problem === null && fileRows.rows.size === Object.keys(raw.everywhere).length && fileRows.rows.size > 0, `the committed file reads whole: every key a template and every row a word, nothing refused (${fileRows.rows.size} rows)`);
  note(`the owner's file makes ${walkedRows.length} templates walk-through and ${fileRows.rows.size - walkedRows.length} solid`);
  const lead = [...fileRows.rows.keys()].filter((t) => /tree_wall|walk_treetop|tree_lift|campfire|skeleton/.test(t));
  if (lead.length) note(`the file names ${lead.length} of the kinds the lead left solid on purpose (tree walls, the walkway's treetops, lift doors, campfires, skeletons): ${lead.join(', ')}`);
  const placed = new Map<string, number>();
  let layouts = 0;
  if (existsSync(PACKS)) {
    for (const w of readdirSync(PACKS)) {
      const f = join(PACKS, w, 'layout.json');
      if (!existsSync(f)) continue;
      layouts++;
      for (const o of JSON.parse(readFileSync(f, 'utf8')).objects as { template: string }[]) if (fileRows.rows.has(o.template)) placed.set(o.template, (placed.get(o.template) ?? 0) + 1);
    }
  }
  if (!layouts) note("no converted layouts: the file's templates are not counted against them");
  else {
    note(`${placed.size} of the file's ${fileRows.rows.size} templates are placed on the ${layouts} converted worlds, ${[...placed.values()].reduce((a, b) => a + b, 0)} copies`);
    const nowhere = [...fileRows.rows.keys()].filter((t) => !placed.has(t));
    if (nowhere.length) note(`placed on no converted world (a world not converted here, or a template that reaches nothing): ${nowhere.join(', ')}`);
  }
}

// --- the rule -------------------------------------------------------------------------------------------------------------
{
  setSolidRows(new Map([[FERN, false], [ROCKT, true]]));
  ok(solidRows().size === 2 && solidRuleOf(FERN) === false && solidRuleOf(ROCKT) === true && solidRuleOf('object/other.iff') === undefined && solidRuleOf(undefined) === undefined, "a template's word, and none for a template with no row");
  ok(!collidesByRule({ template: FERN, radius: 5 } as never) && collidesByRule({ template: ROCKT, radius: 0.5 } as never), "the file's word comes before the size: a big fern is walked through, a small listed rock is solid");
  ok(collidesByRule({ template: FERN, radius: 5, solid: true } as never) && !collidesByRule({ template: ROCKT, radius: 5, solid: false } as never), "a thing's own word comes before the file's: a house, a fitting, a seat of ours, a permanent row");
  ok(!collidesByRule({ template: 'home:1', effectsOf: FERN, radius: 5 } as never), 'a thing put down in play under a name of its own is asked by the template it really is');
  ok(collidesByRule({ template: 'object/other.iff', radius: 2 } as never) && !collidesByRule({ template: 'object/other.iff', radius: 0.4 } as never), 'a template with no row keeps the size rule');
  SOLID_TUNE.use = false;
  ok(collidesByRule({ template: FERN, radius: 5 } as never) && solidRuleOf(FERN) === undefined, 'with the file switched off the rule before it is back');
  SOLID_TUNE.use = true;
  ok(isFallingWaterShader('shader/waterfall_scroll.sht') && !isFallingWaterShader('shader/thed_water_aaes23.sht') && !isFallingWaterShader(undefined) && FALLING_WATER_SHADERS.size === 7, 'falling water by its shader, the basins and every other water not');
  const fall = new THREE.MeshBasicMaterial({ name: 'shader/whitewater_mesh_aa7.sht' });
  const rock = new THREE.MeshBasicMaterial({ name: 'shader/rock_agrlt_waterfall_asb13.sht' });
  ok(fallingWater(fall) && !fallingWater(rock) && fallingWater([fall, fall]) && !fallingWater([fall, rock]) && !fallingWater([]), "a piece is falling water when its material is, every one of them where it has several");
}

// --- the real streamer and the real physics --------------------------------------------------------------------------------
{
  setSolidRows(new Map([[FERN, false]]));
  const fallMat = new THREE.MeshStandardMaterial({ name: 'shader/waterfall_scroll.sht' });
  const rockMat = new THREE.MeshStandardMaterial({ name: 'shader/rock_crystl_geyser.sht' });
  const FERNDEF = { id: 'fern', file: 'fern.glb', bounds: { min: [-4, 0, -4], max: [4, 6, 4] }, triangles: 12 };
  const FALLS = { id: 'falls', file: 'falls.glb', bounds: { min: [-12, 0, -4], max: [12, 20, 4] }, triangles: 24 };
  const SHEET = { id: 'sheet', file: 'sheet.glb', bounds: { min: [-4, 0, -4], max: [4, 20, 4] }, triangles: 12 };
  // The falls: a rock on the west half (game x -10..-2), its falling water on the east half (game x 2..10); a sheet of nothing else.
  const fallsGeo = { rock: boxGeo(8, 20, 8, 0).translate(-6, 0, 0), water: boxGeo(8, 20, 8, 0).translate(6, 0, 0) };
  const h = await makeStreamer(
    [
      { template: FERN, model: 'fern', x: -50, y: 0, z: 50, q: [1, 0, 0, 0], radius: 40 },
      { template: ROCKT, model: 'rock', x: -100, y: 0, z: 100, q: [1, 0, 0, 0], radius: 40 },
      { template: 'object/static/test/shared_falls.iff', model: 'falls', x: -150, y: 0, z: 150, q: [1, 0, 0, 0], radius: 40 },
      { template: 'object/static/test/shared_sheet.iff', model: 'sheet', x: -200, y: 0, z: 200, q: [1, 0, 0, 0], radius: 40 },
    ],
    {
      defs: [FERNDEF, FALLS, SHEET],
      models: {
        fern: loadedOf(FERNDEF, [{ geometry: boxGeo(8, 6, 8, 0), cell: -1 }]),
        falls: loadedOf(FALLS, [
          { geometry: fallsGeo.rock, cell: -1, material: rockMat },
          { geometry: fallsGeo.water, cell: -1, material: fallMat },
        ]),
        sheet: loadedOf(SHEET, [{ geometry: boxGeo(8, 20, 8, 0), cell: -1, material: fallMat }]),
      },
    },
  );
  await h.settle({ x: 120, z: 120 });
  ok(h.rayDown(50, 50, 40) === null, 'a fern of a listed template builds no collider: a ray down through it meets nothing');
  ok(h.rayDown(100, 100, 40) !== null && Math.abs(h.rayDown(100, 100, 40)! - 30) < 0.05, 'the rock beside it is solid as it always was');
  // Snapshot x -150 stands at the game's x 150; the model's own +x is the game's +x (its GLB is mirrored already).
  ok(h.rayDown(150 - 6, 150, 40) !== null && Math.abs(h.rayDown(150 - 6, 150, 40)! - 20) < 0.05, "a waterfall's rock is solid");
  ok(h.rayDown(150 + 6, 150, 40) === null, 'and its falling water builds no collider');
  ok(h.rayDown(200, 200, 40) === null, 'a model of nothing but falling water is solid nowhere');
  // The switch: colliders made from then on take the rule before the file.
  SOLID_TUNE.use = false;
  await h.settle({ x: 5000, z: 5000 });
  await h.settle({ x: 120, z: 120 });
  ok(h.rayDown(50, 50, 40) !== null, 'with the file switched off the fern is solid again once its collider is made again');
  SOLID_TUNE.use = true;
}

// --- the walk grid's bake -------------------------------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'walkthrough-'));
  try {
    writeFileSync(join(dir, 'solid.json'), JSON.stringify({ version: 1, everywhere: { [FERN]: { solid: false }, [ROCKT]: { solid: true } } }));
    const w = walkThroughTemplates(join(dir, 'solid.json'));
    ok(w.size === 1 && w.has(FERN), 'the bake reads the file and leaves out only what it walks through');
    ok(walkThroughTemplates(join(dir, 'missing.json')).size === 0 && walkThroughTemplates(null).size === 0, 'no file is nothing left out');
    const own = walkThroughTemplates();
    ok(own.size === walkedRows.length && walkedRows.every((t) => own.has(t)), "with no file named, the bake reads this install's own (the checkout's public/placements): every row it walks through");
    // A GLB of two pieces, a rock and falling water, written here: the bake's reader leaves the falling water out.
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0]);
    const json = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      materials: [{ name: 'shader/rock_test.sht' }, { name: 'shader/waterfall_scroll_fast.sht' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }, { attributes: { POSITION: 1 }, material: 1 }] }],
      buffers: [{ byteLength: pos.byteLength }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' }],
    };
    let text = Buffer.from(JSON.stringify(json));
    if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
    const bin = Buffer.from(pos.buffer);
    const glb = Buffer.alloc(12 + 8 + text.length + 8 + bin.length);
    glb.writeUInt32LE(0x46546c67, 0);
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(text.length, 12);
    glb.writeUInt32LE(0x4e4f534a, 16);
    text.copy(glb, 20);
    glb.writeUInt32LE(bin.length, 20 + text.length);
    glb.writeUInt32LE(0x004e4942, 24 + text.length);
    bin.copy(glb, 28 + text.length);
    writeFileSync(join(dir, 'falls.glb'), glb);
    const all = readGlbTriangles(join(dir, 'falls.glb'), null);
    const baked = readGlbTriangles(join(dir, 'falls.glb'));
    ok(all.positions.length === 18 && baked.positions.length === 9 && baked.positions[0] === 0, "the bake's reader leaves out a falling-water piece and keeps the rock (with nothing to leave out, both)");
    // The grid's key folds in what the file reaches of a world, and nothing for a world it reaches nowhere.
    const packOf = (objects: { template: string; contained?: boolean }[]) => {
      const d = mkdtempSync(join(dir, 'w-'));
      writeFileSync(join(d, 'layout.json'), JSON.stringify({ planet: 't', center: { x: 0, z: 0 }, terrain: 'terrain.trn', objects }));
      writeFileSync(join(d, 'terrain.trn'), 'x');
      return d;
    };
    const keyOf = (objects: { template: string; contained?: boolean }[], wt: Set<string> | null) => layoutKeyOf(packOf(objects), wt);
    const plain = [{ template: ROCKT }];
    const withFern = [{ template: ROCKT }, { template: FERN }];
    ok(keyOf(plain, w) === keyOf(plain, null), 'a world the file reaches nowhere keys as it did before the file');
    ok(keyOf(withFern, w) !== keyOf(withFern, null) && keyOf(withFern, w) !== keyOf(withFern, new Set(['object/other.iff'])), 'a world it reaches keys with the templates it reaches, so a moved row asks for the grid again');
    ok(keyOf([{ template: FERN, contained: true }, { template: ROCKT }], w) === keyOf([{ template: FERN, contained: true }, { template: ROCKT }], null), 'a listed thing standing in a room is not the grid\'s and moves no key');
    // What `status` and `navgrid --skip-existing` ask of a grid baked over the file: nothing while the file reaches the
    // world as it did, and again once it does not (asked with no file, here; a row moved, in the game).
    const fernPack = packOf(withFern);
    const header = { layoutKey: layoutKeyOf(fernPack, w) };
    ok(gridLayoutStale(header, fernPack, null, w) === null, 'a grid baked over the file is not asked for again while the file reaches its world alike');
    ok(gridLayoutStale(header, fernPack, null, null) !== null && gridLayoutStale(header, fernPack, null, new Set(['object/other.iff'])) !== null, 'and is asked for again once what the file reaches of its world moves');
    const plainPack = packOf(plain);
    ok(gridLayoutStale({ layoutKey: layoutKeyOf(plainPack, null) }, plainPack, null, w) === null, "a grid baked before the file, of a world the file reaches nowhere, is never asked for because of it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- what the game's own data stands on ------------------------------------------------------------------------------------
// Whatever the owner's file walks through must not be what somebody the game's data stands somewhere stands on, with
// nothing solid under it: one of SOE's people on Kashyyyk and Mustafar (the overlay's rows), a dungeon's start and its way
// out, a gate's landing (the ways). Made walk-through, the Rryatt Trail's level-four root path dropped its webweavers and
// feral Wookiees 139 to 165 m into the canyon, which is why that piece is not in the file. One ray down from just over each
// spot, against the placed models' own triangles where their boxes cover it (the falling water left out, as the colliders
// leave it), each hit judged by the game's own rule (`collidesByRule`), and the ground under it: a spot whose floor within
// 2.5 m under it is a piece the file walks through, standing more than 2 m over the first solid thing under that, fails.
// The triangles are the generous measure of solid (a placed tree collides by its trunk alone), so this can miss a fall
// but never make one up. Read over the packs on disk, where they are.
{
  const NGE = join(PACKS, 'nge');
  const readJson = (f: string): unknown => {
    try {
      return JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      return null;
    }
  };
  type Spot = { what: string; x: number; y: number; z: number };
  const spots = new Map<string, Spot[]>();
  const addSpot = (world: string | undefined, what: string, at: unknown) => {
    const p = typeof at === 'string' ? at.trim().split(/\s+/).map(Number) : Array.isArray(at) ? at.map(Number) : null;
    if (!world || !p || p.length !== 3 || !p.every(Number.isFinite)) return;
    const list = spots.get(world) ?? [];
    list.push({ what, x: p[0], y: p[1], z: p[2] });
    spots.set(world, list);
  };
  if (existsSync(join(NGE, 'spawns'))) {
    for (const f of readdirSync(join(NGE, 'spawns'))) {
      if (!f.endsWith('.json') || f === 'manifest.json') continue;
      const doc = readJson(join(NGE, 'spawns', f)) as { statics?: { who?: string; key?: string; cell?: number; x: number; y: number; z: number }[] } | null;
      for (const r of doc?.statics ?? []) if (!r.cell) addSpot(f.replace(/\.json$/, ''), `${r.who ?? 'somebody'} (${r.key ?? 'no key'})`, [r.x, r.y, r.z]);
    }
  }
  const ways = readJson(join(NGE, 'ways.json')) as { zones?: Record<string, { gates?: { to?: { zone?: string; at?: unknown } }[] }>; dungeons?: Record<string, { zone?: string; starts?: unknown[]; exit?: { zone?: string; at?: unknown } }> } | null;
  for (const [from, zone] of Object.entries(ways?.zones ?? {})) for (const g of zone.gates ?? []) addSpot(g.to?.zone, `the landing of a gate from ${from}`, g.to?.at);
  for (const [name, d] of Object.entries(ways?.dungeons ?? {})) {
    for (const s of d.starts ?? []) addSpot(d.zone, `a start of ${name}`, s);
    addSpot(d.exit?.zone, `the way out of ${name}`, d.exit?.at);
  }
  if (!spots.size) note('no NGE overlay or ways on disk: what the game stands people on is not checked against the file');
  setSolidRows(fileRows.rows);
  const { boxOf } = await import('../stateObjects.mjs');
  const { SwgTerrain } = await import('../../../src/world/swgTerrain.ts');
  /** A vector turned by the conjugate of (x, y, z, w): from the game's frame into a model's own. */
  const unturn = (q: number[], v: number[]): number[] => {
    const [x, y, z, w] = [-q[0], -q[1], -q[2], q[3]];
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  };
  /** Where a ray meets a triangle (both faces), as its distance, or -1. */
  const meet = (o: number[], d: number[], P: Float32Array, i: number): number => {
    const e1 = [P[i + 3] - P[i], P[i + 4] - P[i + 1], P[i + 5] - P[i + 2]];
    const e2 = [P[i + 6] - P[i], P[i + 7] - P[i + 1], P[i + 8] - P[i + 2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) return -1;
    const s = [o[0] - P[i], o[1] - P[i + 1], o[2] - P[i + 2]];
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
    if (u < 0 || u > 1) return -1;
    const qv = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / det;
    if (v < 0 || u + v > 1) return -1;
    const t = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
    return t >= 0 ? t : -1;
  };
  for (const [world, list] of [...spots].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dir = join(PACKS, world);
    const layout = readJson(join(dir, 'layout.json')) as { center: { x: number; z: number }; terrain?: string; objects: { template: string; model: string; x: number; y: number; z: number; q: number[]; radius: number; contained?: boolean; state?: string }[] } | null;
    const manifest = readJson(join(dir, 'manifest.json')) as { categories?: Record<string, { id: string; file?: string; bounds?: unknown; particle?: boolean }[]> } | null;
    if (!layout || !manifest) {
      note(`${world} is not converted: its ${list.length} spots are not checked`);
      continue;
    }
    const defs = new Map<string, { id: string; file?: string; bounds?: unknown; particle?: boolean }>();
    for (const l of Object.values(manifest.categories ?? {})) for (const d of l) defs.set(d.id, d);
    // Every outdoor model of the world as it stands by default (the overlay's worlds carry no added state), in 64 m cells.
    const CELL = 64;
    const grid = new Map<string, { o: (typeof layout.objects)[number]; file: string; b: { c: number[]; u: number[][]; e: number[] }; kind: 'file' | 'solid' | 'none' }[]>();
    for (const o of layout.objects) {
      if (o.contained || o.state) continue;
      const d = defs.get(o.model);
      if (!d?.file || !d.bounds || d.particle) continue;
      const b = boxOf(d.bounds, o.q, [o.x, o.y, o.z]);
      if (!b) continue;
      const kind = solidRuleOf(o.template) === false ? 'file' : collidesByRule(o as never) ? 'solid' : 'none';
      if (kind === 'none') continue;
      const r = Math.hypot(b.e[0], b.e[1], b.e[2]) + 1;
      for (let i = Math.floor((b.c[0] - r) / CELL); i <= Math.floor((b.c[0] + r) / CELL); i++) for (let k = Math.floor((b.c[2] - r) / CELL); k <= Math.floor((b.c[2] + r) / CELL); k++) {
        const key = `${i},${k}`;
        const at = grid.get(key);
        const rec = { o, file: d.file, b, kind: kind as 'file' | 'solid' };
        if (at) at.push(rec);
        else grid.set(key, [rec]);
      }
    }
    const tris = new Map<string, Float32Array>();
    const trianglesOf = (file: string): Float32Array => {
      let t = tris.get(file);
      if (!t) {
        try {
          t = readGlbTriangles(join(dir, file)).positions as Float32Array;
        } catch {
          t = new Float32Array();
        }
        tris.set(file, t);
      }
      return t;
    };
    let terrain: { heightAt(x: number, z: number): number } | null | undefined;
    const groundAt = async (s: Spot): Promise<number> => {
      if (terrain === undefined) {
        const bytes = (rel: string): ArrayBuffer | null => {
          const f = join(dir, rel);
          if (!existsSync(f)) return null;
          const buf = readFileSync(f);
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        };
        const trn = bytes(layout.terrain ?? 'terrain.trn');
        terrain = trn ? await SwgTerrain.create(trn, [], layout.center.x, layout.center.z, async (f) => bytes(f)) : null;
      }
      return terrain ? terrain.heightAt(-(s.x - layout.center.x), s.z - layout.center.z) : -Infinity;
    };
    const falls: string[] = [];
    let onFile = 0;
    for (const s of list) {
      const origin = [-s.x, s.y + 1.5, s.z];
      let fileFloor = -Infinity;
      let solidUnder = -Infinity;
      const seen = new Set<unknown>();
      for (const rec of grid.get(`${Math.floor(origin[0] / CELL)},${Math.floor(origin[2] / CELL)}`) ?? []) {
        if (seen.has(rec)) continue;
        seen.add(rec);
        // The vertical line through the spot must pass through the box (a slab test in the box's own frame, 0.3 m to spare).
        const rel = [origin[0] - rec.b.c[0], origin[1] - rec.b.c[1], origin[2] - rec.b.c[2]];
        let lo = 0;
        let hi = Infinity;
        let through = true;
        for (let i = 0; i < 3 && through; i++) {
          const u = rec.b.u[i];
          const p = rel[0] * u[0] + rel[1] * u[1] + rel[2] * u[2];
          const dd = -u[1];
          const e = rec.b.e[i] + 0.3;
          if (Math.abs(dd) < 1e-9) through = Math.abs(p) <= e;
          else {
            const t1 = (-e - p) / dd;
            const t2 = (e - p) / dd;
            lo = Math.max(lo, Math.min(t1, t2));
            hi = Math.min(hi, Math.max(t1, t2));
            through = lo <= hi;
          }
        }
        if (!through) continue;
        const q = rec.o.q;
        const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        const gq = [q[1] / n, -q[2] / n, -q[3] / n, q[0] / n];
        const om = unturn(gq, [origin[0] + rec.o.x, origin[1] - rec.o.y, origin[2] - rec.o.z]);
        const dm = unturn(gq, [0, -1, 0]);
        const P = trianglesOf(rec.file);
        for (let i = 0; i + 8 < P.length; i += 9) {
          const t = meet(om, dm, P, i);
          if (t < 0) continue;
          const y = origin[1] - t;
          if (rec.kind === 'file') {
            if (y <= s.y + 0.5 && y >= s.y - 2.5) fileFloor = Math.max(fileFloor, y);
          } else if (y <= s.y + 0.5) solidUnder = Math.max(solidUnder, y);
        }
      }
      if (fileFloor === -Infinity) continue;
      onFile++;
      const under = Math.max(solidUnder, await groundAt(s));
      if (fileFloor - under > 2) falls.push(`${s.what} at /loc ${s.x.toFixed(1)} ${s.z.toFixed(1)}, ${(fileFloor - under).toFixed(1)} m over what is under it`);
    }
    ok(!falls.length, `${world}: nobody of the ${list.length} spots the game's data stands there is left on a walk-through piece over a fall (${onFile - falls.length} stand on or by one with solid ground within 2 m)${falls.length ? `; ${falls.length} fall: ${falls.slice(0, 4).join('; ')}` : ''}`);
  }
}

// --- the hand-overs only the game and the commands make ------------------------------------------------------------------
{
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const stream = read('../../../src/world/layoutStream.ts');
  const main = read('../../../src/main.ts');
  const world = read('../../../src/world/world.ts');
  const nav = read('../navgrid.mjs');
  const cli = read('../cli.mjs');
  const pack = read('../../launcher/pack.mjs');
  const pin = (src: string, re: RegExp, what: string) => ok(re.test(src), what);
  pin(stream, /if \(o\.solid === undefined\) \{\s*const rule = solidRuleOf\(o\.effectsOf \?\? o\.template\);\s*if \(rule !== undefined\) return rule;\s*\}/, "the streamer's one rule asks the file for a thing with no word of its own (collidesByRule)");
  pin(stream, /if \(isDecal\(prim\.material\)\) continue;\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if \(fallingWater\(prim\.material\)\) continue;/, "a piece of falling water builds no collider (addColliders)");
  pin(stream, /isDecal\(prim\.material\) \|\| fallingWater\(prim\.material\)\) \{/, 'nor in the huge objects\' pieces (buildHuge)');
  pin(main, /this\.world\.solidFileReady = this\.loadSolidFile\(\);/, 'the game reads the file once a session, before the first world');
  pin(main, /const res = await fetchPublic\(SOLID_FILE, \{ cache: 'no-store' \}, import\.meta\.env\.BASE_URL\);\s*if \(!res\) return;\s*const type = res\.headers\.get\('content-type'\) \?\? '';\s*if \(!res\.ok \|\| !\(type\.includes\('json'\) \|\| type\.includes\('text\/plain'\)\)\) return;\s*const read = readSolidFile\(await res\.text\(\)\);[\s\S]{0,200}?setSolidRows\(read\.rows\);/, 'as a public file the build ships, its kind of answer asked (a page handed back for a missing file is no rows), its rows made the rules');
  pin(world, /if \(layout && this\.solidFileReady\) \{\s*await Promise\.race\(\[this\.solidFileReady, new Promise<void>\(\(r\) => setTimeout\(r, 4000\)\)\]\);\s*if \(token !== this\.loadToken\) return null;\s*\}\s*\/\/ Snapshot objects stream in/, 'an arrival waits for it a moment before its streamer makes a collider');
  pin(nav, /if \(walkThrough\.has\(o\.template\)\) \{\s*walkedThrough\+\+;\s*continue;\s*\}/, "the bake leaves out every copy of a template the file walks through");
  pin(nav, /export function readGlbTriangles\(file, skip = isFallingWaterShader\)/, 'and every falling-water piece');
  pin(cli, /const walkThrough = walkThroughTemplates\(\);\s*let built = 0;/, 'the navgrid command reads the file once');
  pin(cli, /gridLayoutStale\(there, outDir, manifest, walkThrough\)/, 'its resumed run asks the same key status asks');
  pin(cli, /const layoutKey = layoutKeyOf\(outDir, walkThrough\);\s*const grid = await buildNavGrid\(outDir, \{ cell, slope, walkThrough,/, 'and it keys and bakes over the one set it read');
  pin(cli, /const navStale = gridLayoutStale\(navGrid, packDir, manifest, statusWalkThrough\);/, '`status` asks for a grid again when what the file reaches of a world moves');
  pin(pack, /'src\/world\/walkThrough\.ts'\]/, "the launcher's release carries the reader the bake imports");
}

console.log(`\n${passed} checks passed`);
