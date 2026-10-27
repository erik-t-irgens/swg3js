// Families of other worlds (Map-maker II, DESIGN.md §2.5 "Families of other worlds" and §6, W3):
//
//   1. a family group lends another world's family under a fresh id, keyed by its pack and its name (never matched to a
//      family of this world's by its name alone), the same id again after; this world's own names still answer its own;
//      another thread's group takes the lent list at the very ids, and never over one of its own;
//   2. both threads: the main thread's sampler and the terrain worker's core (`init` with the lent list, then a `paint`
//      carrying one lent in play) give each lent family the same id, and every grid either makes with a paint naming
//      them is the same ground by `Object.is`, the lent family's id on its painted cells;
//   3. a pack that is not installed (or a family it has not got, or one past the arrays' layers) lends nothing, said in
//      words, and its painted cells lay nothing: the ground there is the world's own;
//   4. two packs' families in one array: on the packs on disk (SWG3JS_PACKS, else assets-private), Naboo's own ground
//      with Corellia's families lent through the very plan, arrays and lookups `TerrainTextures.load` makes (`tilePlan`,
//      `assembleTileArrays`, `tilesOf`): every layer of the world's own where it stands with none lent, the lent family's
//      layers after them, holding that pack's own pictures (decoded from its PNGs), and a tile whose corners hold the lent
//      family drawing those layers (`tileLayers`), a family whose name the world shares drawing the lent pack's pictures,
//      never the world's own;
//   5. the plan: the palette's families first, the world row's packs whole after, each once, the arrays' 256 layers held,
//      one lent in play appended after them all (`appendLending`) and the pictures handed in the order the ids were lent;
//      the packs a ground lends from, a lent world's table read off its own two files, and the air's classes asked by a
//      lent family's own world and id; and the decisions the world makes, run here as it runs them (the lending's answer,
//      a family whose pictures never reached the arrays laying nothing, a weights key, a real-elevation world's base of
//      another pack, a family's pack, what an arrival asks, a lent world's table read once by pack and file through a
//      recording fetch, a pack no ground world gives asked nothing, a 404 kept and a failure asked again, the game's
//      `packBytes` by the pack files' rules);
//   6. no family of another world is the second wave's ground to the bit: ba83837's `generator.ts`, `groundPaint.ts`,
//      `trn.ts` and `workerCore.ts` out of git beside today's, on every converted world on disk, an own-only palette
//      resolving to the same ids and choices, every family name to the same id, grids and the worker's grids by
//      `Object.is`, and the arrays' plan with nothing lent this world's own list, entries and names (the layer count
//      unchanged);
//   7. the hand-overs only the game makes, as text (the arrival's order, the lent table's group, the textures, the air),
//      each call of a function sections 4 and 5 run pinned by its whole line (a review broke six hand-overs pinned by a
//      fragment of their lines with every check passing; `A:\swg3js\mapmaker2\scratch\w3fix\spec*.json` hold 32 mutations
//      of the wave's code, 31 failing here and the one left changing nothing a caller can see).
//
// Run: node tools/swg/tests/foreignFamilies.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ShaderGroup, childIndexOf, lentFamilyKey, type ShaderFamily } from '../../../src/swg/terrain/generator.ts';
import { GroundPaint, paintTileNumber } from '../../../src/swg/terrain/groundPaint.ts';
import { TerrainSampler, parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { TerrainWorkerCore } from '../../../src/swg/terrain/workerCore.ts';
import { GROUND_LAYERS_MOST, LENT_PRIORITY, assembleTileArrays, fitLent, tileEntries, tilePlan, tilesOf, tileUrlOf, type ShaderFamilyDef, type TilePictures } from '../../../src/world/terrainTextures.ts';
import { tileLayers } from '../../../src/world/groundTiles.ts';
import { NOT_LENT_YET, PICTURES_NOT_LOADED, appendLending, arrivalAsks, baseFamilyId, familyOfKey, forgetLentTables, groundPacksOf, lendInto, lentAnswer, lentPacksOf, lentPicturesOf, loadLentTable, packOfFamily, planLending, readLentTable, shadersTiled, undrawnLent, type LendPlan as LendPlanOf, type LentFetch, type LentTable } from '../../../src/world/lentGround.ts';
import { classifyFamily } from '../../../src/world/volumetrics/groundResponse.ts';
import { PACK_FILES, filesReport, forgetFiles, knownAbsent, packBytes } from '../../../src/world/packFiles.ts';
import { decodePng } from '../png.mjs';
import { form, chunk, W, encode, ihdr, mfrc } from './iffWriter.ts';
import { cellPaint, paintTerrainBytes, sameArrays } from './paintHarness.ts';
import { groundWorlds, PACKS, sampleBlocks } from './terrainHarness.ts';
import { loadOldMany, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

// ---------------------------------------------------------------- a second made world, to lend from

/** A made world of two families: `grass` (a name the first made world has too, with other pictures) and `sand`. */
function otherTerrainBytes(): Uint8Array {
  const header = new W().str('other').f32(2048).f32(8).i32(2).i32(0).f32(0).f32(2).str('').f32(60)
    .f32(0).f32(0).f32(16).f32(2).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).u8(1).bytes();
  const sfam = (id: number, name: string, surface: string, kids: number) => {
    const w = new W().i32(id).str(name).str(surface).u8(1).u8(2).u8(3).f32(4).f32(1).i32(kids);
    for (let k = 0; k < kids; k++) w.str(`shader/other_${name}_${k}.sht`).f32(k + 1);
    return chunk('SFAM', w.bytes());
  };
  const adta = () => chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes());
  const sgrp = form('SGRP', form('0006', sfam(1, 'grass', 'abstract/terrain_surface/grass.iff', 2), sfam(2, 'sand', 'abstract/terrain_surface/sand.iff', 1)));
  const mgrp = form('MGRP', form('0000', form('MFAM', chunk('DATA', new W().i32(1).str('noise').bytes()), mfrc(7))));
  const tgen = form('TGEN', form('0000', sgrp, form('FGRP', form('0008')), form('RGRP', form('0003')), form('EGRP', form('0002')), mgrp, form('LYRS', form('LAYR', form('0003', ihdr('nothing'), adta())))));
  return encode(form('PTAT', form('0015', chunk('DATA', header), tgen, form('BAKE'))));
}

const otherGroup = parseTerrainTemplate(otherTerrainBytes()).generator.shaderGroup;
const otherGrass = otherGroup.byName('grass')!;
const otherSand = otherGroup.byName('sand')!;

// ---------------------------------------------------------------- 1. the group lends

{
  const trn = paintTerrainBytes();
  const group = parseTerrainTemplate(trn).generator.shaderGroup;
  const own = new Map([...group.families].map(([id, f]) => [id, f.name]));
  const ownGrass = group.byName('grass')!;
  const id = group.lend('other', otherGrass);
  ok(id === Math.max(...own.keys()) + 1 && group.families.get(id)!.name === 'grass' && group.families.get(id)!.children.map((c) => c.name).join() === otherGrass.children.map((c) => c.name).join(), `a family of another world is copied in under a fresh id (${id}), with its own children`);
  ok(group.byName('grass') === ownGrass && group.lentId('other', 'GRASS') === id && group.lentId('other', 'sand') === -1, "the world's own name still answers its own family: a lent family is kept by its pack and name (case as `byName` takes it), never matched by its name");
  ok(group.lend('other', otherGrass) === id && group.families.size === own.size + 1, 'lent again, the same id, nothing added');
  ok(group.lent.get(id)!.pack === 'other' && group.lent.get(id)!.from === otherGrass.id && group.families.get(id)!.surface === otherGrass.surface, "and it keeps where it came from: its pack, its id there, its surface (the feet's)");
  const sandId = group.lend('other', otherSand);
  // Another thread's group: the same terrain, the lent list taken at the very ids.
  const worker = parseTerrainTemplate(trn).generator.shaderGroup;
  worker.takeLent(group.lentList());
  ok(worker.lentId('other', 'grass') === id && worker.lentId('other', 'sand') === sandId && worker.families.get(sandId)!.name === 'sand' && worker.byName('grass')!.id === ownGrass.id, 'another thread\'s group takes the lent list at the very ids, its own names untouched');
  const mine = parseTerrainTemplate(trn).generator.shaderGroup;
  mine.takeLent([{ id: ownGrass.id, pack: 'other', from: 2, family: { ...otherSand, id: ownGrass.id } }]);
  ok(mine.families.get(ownGrass.id)!.name === 'grass' && mine.lent.size === 0, "and never one over a family of its own (an id a family of this world's holds)");
  // A lent family copied, not shared: the list handed over is copies.
  const list = group.lentList();
  list[0].family.children[0].weight = 99;
  ok(group.families.get(id)!.children[0].weight !== 99, 'the list handed over is copies of the families, never the group\'s own');
  // A name only the lent family has: this world's names never answer it, and a family of this world's made by that name (a
  // building's layer file, `ensure`) is one of its own under a fresh id, never the lent one.
  ok(group.byName('sand') === undefined && group.byName('SAND') === undefined, "a name only another world's lent family has is no name of this world's (`byName` answers nothing)");
  const ensured = group.ensure(otherSand);
  ok(ensured !== sandId && !group.lent.has(ensured) && group.byName('sand')?.id === ensured && group.lentId('other', 'sand') === sandId, `and \`ensure\` by that name makes a family of this world's own (${ensured}), never the lent one (${sandId})`);
}

// ---------------------------------------------------------------- 2. both threads

{
  const trn = paintTerrainBytes();
  const template = parseTerrainTemplate(trn);
  const group = template.generator.shaderGroup;
  const tables = new Map<string, LentTable | string>([['other', { pack: 'other', group: otherGroup, defs: new Map([['grass', defOf(otherGrass, 1)], ['sand', defOf(otherSand, 2)]]), base: '/x/' }]]);
  const entries = [{ pack: 'test', name: 'grass' }, { pack: 'other', name: 'grass' }, { pack: 'other', name: 'sand' }];
  const plan = planLending(ownDefsOf(group), entries, [], 'test', tables, false);
  lendInto(group, plan);
  const paint = new GroundPaint(4);
  const lend = (p: string, n: string): number | string => (group.lentId(p, n) > 0 ? group.lentId(p, n) : 'not lent');
  const missing = paint.resolve(entries, group, 'test', undefined, lend);
  ok(missing.length === 0 && paint.familyOf[1] === group.byName('grass')!.id && paint.familyOf[2] === group.lentId('other', 'grass') && paint.familyOf[3] === group.lentId('other', 'sand'), `the palette resolves this world's grass to its own (${paint.familyOf[1]}) and the other world's grass and sand to the ids lent (${paint.familyOf[2]}, ${paint.familyOf[3]})`);
  for (let cz = -10; cz < 10; cz++) for (let cx = -10; cx < 10; cx++) cellPaint(paint, cx, cz, 1 + ((cx + cz + 30) % 3));
  const sampler = new TerrainSampler(template);
  sampler.paint = paint;
  const core = new TerrainWorkerCore();
  core.handle({ type: 'init', trn: trn.slice().buffer, layers: [], bitmaps: [], ramps: [], lent: group.lentList(), paint: paint.message(null, null, true), rev: 1 });
  // The worker's own group took the lent list at its `init` (the grids alone cannot say so: a painted pole's family is the
  // paint's id whatever the worker's group holds).
  const initGroup = (core as unknown as { sampler: TerrainSampler }).sampler.generator.shaderGroup;
  ok(initGroup.lentId('other', 'grass') === group.lentId('other', 'grass') && initGroup.lentId('other', 'sand') === group.lentId('other', 'sand') && initGroup.families.get(group.lentId('other', 'sand'))?.name === 'sand', "the worker's group takes the lent families at their ids with its `init`");
  const places = [{ x: -40, z: -40 }, { x: -4, z: -36 }, { x: 10, z: 10 }];
  let same = true;
  let laid = 0;
  for (const [i, p] of places.entries()) {
    const m = core.handle({ type: 'generate', id: i, startX: p.x, startZ: p.z, n: 37, step: 2 }).message;
    const here = sampler.generate(p.x, p.z, 37, 2);
    if (!sameArrays(here, m)) same = false;
    for (const v of here.shaders) if (v === group.lentId('other', 'sand')) laid++;
  }
  ok(same && laid > 0, `every grid the worker makes with the lent families equals the main thread's by Object.is (${laid} poles the other world's sand)`);
  // One lent in play: the main thread's group lends it, a `paint` message carries the list, the worker's group takes it.
  const wc = core as unknown as { sampler: TerrainSampler };
  const extra = { ...otherSand, name: 'dust', id: 9 };
  const dustId = group.lend('other', extra);
  paint.resolve([...entries, { pack: 'other', name: 'dust' }], group, 'test', undefined, lend);
  cellPaint(paint, 3, 3, 4);
  core.handle({ type: 'paint', rev: 2, paint: paint.message([paintTileNumber(0, 0)], [], false), lent: group.lentList() });
  const m = core.handle({ type: 'generate', id: 9, startX: -4, startZ: -4, n: 37, step: 2 }).message;
  const here = sampler.generate(-4, -4, 37, 2);
  ok(wc.sampler.generator.shaderGroup.lentId('other', 'dust') === dustId && sameArrays(here, m) && [...here.shaders].includes(dustId), `a family lent in play reaches the worker's group at the same id (${dustId}) with the next \`paint\`, and its cells are laid alike on both threads`);
}

// ---------------------------------------------------------------- 3. a pack not installed falls back

{
  const trn = paintTerrainBytes();
  const template = parseTerrainTemplate(trn);
  const group = template.generator.shaderGroup;
  const tables = new Map<string, LentTable | string>([['gone', 'gone is not installed (no ground pictures)'], ['other', { pack: 'other', group: otherGroup, defs: new Map([['grass', defOf(otherGrass, 1)]]), base: '/x/' }]]);
  const entries = [{ pack: 'gone', name: 'grass' }, { pack: 'other', name: 'nothing' }, { pack: 'other', name: 'sand' }];
  const plan = planLending(ownDefsOf(group), entries, [], 'test', tables, false);
  ok(plan.families.length === 0 && plan.why.get('gone:grass') === 'gone is not installed (no ground pictures)' && /no family of that name/.test(plan.why.get('other:nothing') ?? '') && /no ground pictures for it/.test(plan.why.get('other:sand') ?? ''), `a pack not installed, a family it has not got and a family with no pictures lend nothing, each said (${[...plan.why.values()].join('; ')})`);
  lendInto(group, plan);
  const paint = new GroundPaint(4);
  const missing = paint.resolve(entries, group, 'test', undefined, (p, n) => (group.lentId(p, n) > 0 ? group.lentId(p, n) : plan.why.get(lentFamilyKey(p, n)) ?? 'not lent'));
  for (let cz = -8; cz < 8; cz++) for (let cx = -8; cx < 8; cx++) cellPaint(paint, cx, cz, 1 + ((cx + 16) % 3));
  const painted = new TerrainSampler(template);
  painted.paint = paint;
  const plain = new TerrainSampler(parseTerrainTemplate(trn));
  ok(missing.length === 3 && missing[0].includes('not installed') && [1, 2, 3].every((e) => paint.familyOf[e] === 0) && sameArrays(painted.generate(-30, -30, 33, 2), plain.generate(-30, -30, 33, 2)), "their entries lay nothing (said in words): the ground under their painted cells is the world's own, every map by Object.is");
}

// ---------------------------------------------------------------- 4. two packs' families in one array

const shadersOf = (world: string): { version?: number; families: ShaderFamilyDef[]; blend?: Record<string, string> } | null => {
  const f = join(PACKS, world, 'terrain', 'shaders.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};
type Picture = { width: number; height: number; rgba: Uint8Array };
const picture = (world: string, rel: string | null | undefined): Picture | null => {
  if (!rel) return null;
  const f = join(PACKS, world, rel);
  return existsSync(f) ? (decodePng(readFileSync(f)) as Picture | null) : null;
};

const worlds = groundWorlds();
// Naboo's own ground with Corellia's families lent: the two share names, some of them drawing other pictures (a name
// alone would collide).
const OWN = 'naboo';
const LENT = 'corellia';
if (worlds.includes(OWN) && worlds.includes(LENT)) {
  const own = shadersOf(OWN)!;
  const lentFile0 = shadersOf(LENT)!;
  const tTemplate = parseTerrainTemplate(new Uint8Array(readFileSync(join(PACKS, OWN, 'terrain.trn'))));
  const group = tTemplate.generator.shaderGroup;
  // The lent world's table read as the game reads it (`loadLentTable`), through a fetch that answers off the disk and
  // records what it was asked: its own two files, by its pack, and its pictures' address the site's one for it.
  forgetLentTables();
  const asked: string[] = [];
  const disk: LentFetch = {
    json: async (pack, file) => {
      asked.push(`${pack}/${file}`);
      const f = join(PACKS, pack, file);
      return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
    },
    bytes: async (pack, file) => {
      asked.push(`${pack}/${file}`);
      const f = join(PACKS, pack, file);
      return existsSync(f) ? new Uint8Array(readFileSync(f)) : null;
    },
    absent: (pack, file) => !existsSync(join(PACKS, pack, file)),
  };
  const table = await loadLentTable(LENT, '/', disk);
  ok(typeof table !== 'string' && table.defs.size === lentFile0.families.length && table.base === `/assets-private/${LENT}/` && asked.join() === `${LENT}/terrain/shaders.json,${LENT}/terrain.trn` && shadersTiled(own) && shadersTiled(lentFile0), `${LENT}'s table reads off its own two files and nothing else (${asked.join(', ')}), its pictures at ${typeof table === 'string' ? table : table.base}`);
  forgetLentTables();
  const nTable = table as LentTable;
  const ownByName = new Map(own.families.map((f) => [f.name.toLowerCase(), f] as const));
  const kidsOf = (f: ShaderFamilyDef): string => (f.children ?? []).map((c) => c.shader).join();
  // A family whose name the world's own ground shares and whose pictures differ (twenty of the fifty-three names two
  // worlds share draw other pictures), else any shared, and another lent family besides.
  const sharedAll = lentFile0.families.filter((f) => ownByName.has(f.name.toLowerCase()) && f.children?.length);
  const shared = sharedAll.find((f) => kidsOf(f) !== kidsOf(ownByName.get(f.name.toLowerCase())!)) ?? sharedAll[0];
  const other = lentFile0.families.find((f) => !ownByName.has(f.name.toLowerCase()) && (f.children?.length ?? 0) > 1)!;
  const lentNames = [...(shared ? [shared.name] : []), other.name];
  if (!shared) note(`no family name of ${LENT} is also ${OWN}'s here: the shared-name case is held on the made worlds above`);
  const entries = lentNames.map((name) => ({ pack: LENT, name }));
  const plan = planLending(own.families, entries, [], OWN, new Map([[LENT, nTable]]), false);
  lendInto(group, plan);
  const planet = new Map<number, string>();
  for (const f of group.families.values()) if (!group.lent.has(f.id)) planet.set(f.id, f.name);
  const pics = lentPicturesOf(plan, new Map([[LENT, nTable]]), (p, n) => group.lentId(p, n));
  ok(pics.length > 0 && pics.every((r) => r.pack === LENT && r.url('x.png') === `${nTable.base}x.png`), `the lent pictures are addressed at their own pack's files (${pics[0]?.url('x.png')})`);
  const withLent = tilePlan(own.families, planet, pics, false);
  const without = tilePlan(own.families, planet, [], false);
  const ownCount = without.entries.length;
  ok(withLent.entries.length === ownCount + plan.families.reduce((n, f) => n + f.layers, 0) && withLent.entries.slice(0, ownCount).every((e, i) => e.family === without.entries[i].family && e.child === without.entries[i].child), `the lent families' pictures come after the world's own (${ownCount} own, ${withLent.entries.length - ownCount} lent), every own entry where it stands with none lent`);
  // Pictures: every entry's address the load's own (`tileUrlOf`, this world's own pack addressed as the site addresses it);
  // the world's own stood in by bytes of their entry (the same either way), a lent family's decoded from the PNG its address
  // names, read off the disk only where that address is its own pack's, so a lent picture asked of the wrong pack is no picture.
  const SITE = '/assets-private/';
  const urlOf = tileUrlOf(withLent, (f) => `${SITE}${OWN}/${f}`);
  const size = 256;
  const per = size * size * 4;
  const standIn = (i: number): Uint8Array => new Uint8Array(per).fill((i * 37) & 255);
  const lentFile = (e: (typeof withLent.entries)[number]): Picture | null => {
    if (!withLent.lentFams?.urls.has(e.family)) return null;
    const url = urlOf(e, e.def.file!);
    const at = `${SITE}${LENT}/`;
    return url.startsWith(at) ? picture(LENT, url.slice(at.length)) : null;
  };
  const picsOf = (p: typeof withLent): TilePictures => ({
    colour: (i) => {
      const l = lentFile(p.entries[i]);
      return l && l.width === size ? l.rgba : standIn(i);
    },
    normal: () => null,
    gloss: () => null,
  });
  const a1 = assembleTileArrays(withLent.families, withLent.entries, withLent.entries.map(() => true), size, picsOf(withLent))!;
  const a0 = assembleTileArrays(without.families, without.entries, without.entries.map(() => true), size, picsOf(without))!;
  ok(a0.depth === ownCount && a1.depth === withLent.entries.length && a1.colour.subarray(0, ownCount * per).every((v, i) => v === a0.colour[i]), `every layer of the world's own is the same bytes with the lent beside it (${a0.depth} layers alone, ${a1.depth} with)`);
  const t1 = tilesOf(withLent, a1, group, false);
  const t0 = tilesOf(without, a0, group, false);
  const otherId = group.lentId(LENT, other.name);
  const otherLayers = t1.childLayers.get(otherId) ?? [];
  const otherFamily = group.families.get(otherId)!;
  let pictured = otherLayers.length === other.children!.length;
  for (const [k, layer] of otherLayers.entries()) {
    const p = picture(LENT, other.children![k].file);
    if (!p || p.width !== size || !a1.colour.subarray(layer * per, (layer + 1) * per).every((v, i) => v === p.rgba[i])) pictured = false;
  }
  ok(pictured && otherLayers.every((l) => l >= ownCount), `${LENT}'s ${other.name} (id ${otherId}) draws its ${otherLayers.length} children from layers after the world's own, each its own pack's picture byte for byte`);
  ok([...t0.childLayers].every(([id, l]) => (t1.childLayers.get(id) ?? []).join() === l.join()) && [...t0.priority].every(([id, r]) => t1.priority.get(id) === r) && (t1.priority.get(otherId) ?? 0) >= LENT_PRIORITY, "the world's own families keep their layers and their rank, and a lent one ranks above them (laid on the ground)");
  // A tile whose four corners hold the lent family samples its pictures, by the alternate each choice picks.
  const layers = new Uint8Array(4);
  const codes = new Uint8Array(3);
  let tiles = true;
  for (const choice of [0, 60, 130, 250]) {
    tileLayers([otherId, otherId, otherId, otherId], [choice, choice, choice, choice], t1.tiler, layers, codes);
    if (layers[0] !== otherLayers[childIndexOf(otherFamily, choice)]) tiles = false;
  }
  ok(tiles, "a tile whose corners hold the lent family draws its layer for each choice byte (`tileLayers` through the tiler, the alternate `childIndexOf` picks over the lent family's own weights)");
  if (shared) {
    const sid = group.lentId(LENT, shared.name);
    const mine = group.byName(shared.name)!;
    const sl = t1.childLayers.get(sid) ?? [];
    const ol = t1.childLayers.get(mine.id) ?? [];
    const p = picture(LENT, shared.children![0].file);
    const differ = kidsOf(shared) !== kidsOf(ownByName.get(shared.name.toLowerCase())!);
    ok(sid !== mine.id && sl.length > 0 && sl.every((l) => !ol.includes(l)) && !!p && a1.colour.subarray(sl[0] * per, sl[0] * per + per).every((v, i) => v === p.rgba[i]), `a name both worlds have (${shared.name}${differ ? ', drawing other pictures on each' : ''}): the lent one is a family of its own (id ${sid}, ${OWN}'s ${mine.id}) drawing ${LENT}'s pictures, never ${OWN}'s`);
  }
  ok(t1.lentReport !== null && t1.lentReport.families.every((f) => f.pack === LENT) && t1.lentReport.layers === a1.depth && t0.lentReport === null, 'what the arrays hold of other worlds is reported (and nothing with none lent)');
} else note(`${OWN} and ${LENT} are not both converted under ${PACKS}: two packs' pictures in one array are held on the plan alone`);

// ---------------------------------------------------------------- 5. the plan

{
  const mk = (name: string, kids: number): ShaderFamilyDef => ({ id: name.length, name, size: 4, file: `${name}.png`, children: Array.from({ length: kids }, (_, k) => ({ shader: `${name}${k}`, weight: 1, file: `${name}${k}.png`, normal: null, specular: null, specularColor: null })) });
  const ownDefs = [mk('own', 248)];
  const table = (pack: string, fams: [string, number][]): LentTable => {
    const g = new ShaderGroup();
    fams.forEach(([n, k], i) => g.families.set(i + 1, { id: i + 1, name: n, featherClamp: 1, shaderSize: 4, children: Array.from({ length: k }, (_, j) => ({ name: `${n}${j}`, weight: 1 })), surface: '' }));
    return { pack, group: g, defs: new Map(fams.map(([n, k]) => [n.toLowerCase(), mk(n, k)])), base: `/a/${pack}/` };
  };
  const tables = new Map<string, LentTable | string>([['a', table('a', [['a1', 2], ['a2', 3], ['a3', 9]])], ['b', table('b', [['b1', 1], ['b2', 2], ['bare', 0]])]]);
  const plan = planLending(ownDefs, [{ pack: 'b', name: 'b2' }, { pack: 'own', name: 'x' }], ['a', 'b'], 'own', tables, false);
  ok(plan.families.map((f) => `${f.pack}:${f.name}`).join() === 'b:b2,a:a1,a:a2,b:b1' && plan.layers === 256 && /picture layers are full/.test(plan.why.get('a:a3') ?? '') && !plan.why.has('b:bare'), `the palette's family first, the packs' whole after it, each once, held to ${GROUND_LAYERS_MOST} layers (a3's nine left out and said; a family with no pictures passed over quietly): ${plan.families.map((f) => f.name).join(', ')}`);
  ok(lentPacksOf([{ pack: 'b', name: 'b2' }, { pack: 'own', name: 'x' }, { pack: 'b', name: 'b1' }], ['a', 'own', 'b'], 'own').join() === 'b,a', "the packs a world lends from: the palette's other packs in order, then the row's, never its own, never twice");
  const full = appendLending(plan, tables.get('a')!, 'a', 'a3', false);
  const plan2 = planLending([mk('own', 40)], [], ['b'], 'own', tables, false);
  const before = plan2.families.map((f) => f.name).join();
  const added = appendLending(plan2, tables.get('a')!, 'a', 'a3', false);
  ok(/full/.test(full ?? '') && added === null && plan2.families.map((f) => f.name).join() === `${before},a3` && plan2.layers === 40 + 3 + 9 && appendLending(plan2, tables.get('a')!, 'a', 'a3', false) === null && plan2.families.length === 3, 'a family lent in play goes after every one lent already (refused in words where the layers are full), once');
  const g = new ShaderGroup();
  g.families.set(1, { id: 1, name: 'own', featherClamp: 1, shaderSize: 4, children: [], surface: '' });
  // Lent out of the plan's order (as a family lent in play is, the latest id last): the pictures follow the ids.
  g.lend('a', (tables.get('a') as LentTable).group.byName('a1')!);
  g.lend('b', (tables.get('b') as LentTable).group.byName('b2')!);
  g.lend('b', (tables.get('b') as LentTable).group.byName('b1')!);
  const runs = (p: LendPlanOf): string => lentPicturesOf(p, tables, (pk, n) => g.lentId(pk, n)).map((x) => `${x.pack}:${x.families.map((f) => f.id).join('/')}`).join();
  ok(runs(plan2) === 'b:3/4' && runs(plan) === 'a:2,b:3/4', `the pictures are handed in the order the ids were lent (a run a pack), never the plan's, a family the group has not lent left out (${runs(plan2)}; ${runs(plan)})`);
  const fit = fitLent(ownDefs, [{ pack: 'a', url: (f) => `/a/${f}`, families: [{ id: 7, def: mk('a1', 2) }, { id: 8, def: mk('a3', 9) }] }], false);
  ok(fit.defs.length === 1 && fit.defs[0].name === 'a:a1' && fit.defs[0].id === 7 && fit.leftOut.join() === 'a:a3' && fit.urls.get(fit.defs[0])!('x.png') === '/a/x.png', "the arrays hold a lent family by its key and its id here, read from its own pack, one past the layers left out whole");
  const packs = groundPacksOf();
  ok(packs.includes('tatooine') && packs.includes('kashyyyk_main') && !packs.includes('kashyyyk') && !packs.some((p) => /space|dungeon1|gallery|monument|helensar/.test(p)), `a ground lends from every ground world's pack or zone, never a space zone, the copies, the gallery or a world with no pack (${packs.length}: ${packs.join(', ')})`);
  ok(typeof readLentTable('x', '/', new Uint8Array(4), { version: 3, families: [{ id: 1, name: 'n', children: [] }] }) === 'string' && typeof readLentTable('x', '/', null, null) === 'string', 'a pack from before terrain shaders version 4, or with no list, lends nothing, said');
  const facts = { id: 40, name: 'lent', surface: '', children: [] };
  ok(classifyFamily('tatooine', { ...facts, scope: { world: 'kashyyyk_main', id: 18 } }).by === 'override' && classifyFamily('tatooine', facts).by !== 'override', "the air classes a lent family by its own world and id (an override written for its numbering), never by this world's numbering");

  // The decisions the world makes, run here as the world runs them (`lentAnswer`, `undrawnLent`, `familyOfKey`,
  // `baseFamilyId`, `packOfFamily`, `arrivalAsks`): section 7 pins each call site to them.
  const st = { plan: planLending([mk('own', 40)], [{ pack: 'a', name: 'a1' }, { pack: 'a', name: 'gone' }], ['b'], 'own', tables, false), off: null as string | null };
  const ga = new ShaderGroup();
  ga.families.set(1, { id: 1, name: 'own', featherClamp: 1, shaderSize: 4, children: [{ name: 'own0', weight: 1 }], surface: '' });
  lendInto(ga, st.plan);
  const idA1 = ga.lentId('a', 'a1');
  ok(lentAnswer(st, idA1, lentFamilyKey('a', 'a1')) === idA1 && /no family of that name/.test(String(lentAnswer(st, ga.lentId('a', 'gone'), lentFamilyKey('a', 'gone')))) && lentAnswer(st, -1, lentFamilyKey('c', 'x')) === NOT_LENT_YET && lentAnswer(null, -1, 'c:x') === NOT_LENT_YET && lentAnswer(null, 5, 'c:x') === 5 && lentAnswer({ ...st, off: 'no tiles' }, idA1, lentFamilyKey('a', 'a1')) === 'no tiles', `the lending's answer: the id lent (${idA1}), why not where it was asked and not lent, "not lent at this arrival" where nothing named it, and the world's own why where it lends nothing at all`);
  // A family lent whose pictures never reached the arrays lays nothing after all, and its layers are given back.
  const idB1 = ga.lentId('b', 'b1');
  const layersBefore = st.plan.layers;
  const b1Layers = st.plan.families.find((f) => f.name === 'b1')!.layers;
  const lost = undrawnLent(st.plan, (p, n) => ga.lentId(p, n), (id) => id !== idB1);
  ok(lost.join() === 'b:b1' && !st.plan.families.some((f) => f.name === 'b1') && st.plan.layers === layersBefore - b1Layers && lentAnswer(st, idB1, lentFamilyKey('b', 'b1')) === PICTURES_NOT_LOADED && lentAnswer(st, idA1, lentFamilyKey('a', 'a1')) === idA1, `a lent family whose pictures never reached the arrays is taken out of the plan (${lost.join()}), its layers given back, and the lending answers why for it while the rest still lay`);
  ok(familyOfKey(ga, 'own', 'own:own')?.id === 1 && familyOfKey(ga, 'own', 'a:a1')?.id === idA1 && familyOfKey(ga, 'own', 'a:a1')?.name === 'a1' && familyOfKey(ga, 'own', 'a:nope') === undefined && familyOfKey(ga, 'own', 'own:a1') === undefined, "a world row's weights key names this world's own family by its name and another world's by the id it was lent under, never one by the other's name");
  ok(baseFamilyId({ pack: 'own', name: 'OWN' }, 'own', ga, st) === 1 && baseFamilyId({ pack: 'a', name: 'a1' }, 'own', ga, st) === idA1 && baseFamilyId({ pack: 'b', name: 'b1' }, 'own', ga, st) === -1 && baseFamilyId({ pack: 'c', name: 'x' }, 'own', ga, st) === -1 && baseFamilyId(null, 'own', ga, st) === -1 && baseFamilyId({ pack: 'own', name: 'own' }, 'own', null, st) === -1 && baseFamilyId({ pack: 'a', name: 'a1' }, 'own', ga, { ...st, off: 'x' }) === -1, "a real-elevation world's base: the borrowed pack's own family, another pack's by the id it was lent under while it lays (never one whose pictures did not load, or not lent), none at all otherwise");
  ok(packOfFamily(ga, idA1, 'own') === 'a' && packOfFamily(ga, 1, 'own') === 'own' && packOfFamily(null, idA1, 'own') === 'own', "a family of the group is its lending pack's where another world lent it, else this world's own (what the editor's middle button takes it as)");
  const ents = [{ pack: 'own', name: 'x' }, { pack: 'a', name: 'a1' }];
  const noBase = arrivalAsks(ents, ['b'], null, 'own');
  const sameBase = arrivalAsks(ents, undefined, { pack: 'own', name: 'x' }, 'own');
  const named = arrivalAsks(ents, ['b'], { pack: 'c', name: 'base' }, 'own');
  const twice = arrivalAsks(ents, [], { pack: 'a', name: 'A1' }, 'own');
  ok(noBase.asks === ents && noBase.read.join() === 'a,b' && noBase.whole.join() === 'b' && sameBase.asks === ents && sameBase.read.join() === 'a' && named.asks.length === 3 && named.asks[2].pack === 'c' && named.asks[2].name === 'base' && named.read.join() === 'a,c,b' && twice.asks === ents, "an arrival asks the palette's entries by identity (no base of another pack: the second wave's), the row's packs read and lent whole, and a real-elevation world's base of another pack once after them");
  // A lent world's table read once a session through a fetch by pack and file: a pack no ground world gives asked nothing;
  // a 404 (`absent`) kept; a failure asked again.
  const shadersText = { version: 4, blend: { quarter: 'q.png', half: 'h.png', threequarter: 't.png' }, families: [{ id: 1, name: 'own', children: [{ shader: 's', weight: 1, file: 'own0.png' }] }] };
  const fake = (answer: unknown | null, isAbsent: boolean) => {
    const asked: string[] = [];
    const f: LentFetch = {
      json: async (pack, file) => (asked.push(`${pack}/${file}`), answer),
      bytes: async (pack, file) => (asked.push(`${pack}/${file}`), null),
      absent: () => isAbsent,
    };
    return { f, asked };
  };
  forgetLentTables();
  const none = fake(shadersText, false);
  const words = [await loadLentTable('monument', '/', none.f), await loadLentTable('space_tatooine', '/', none.f), await loadLentTable('gallery', '/', none.f), await loadLentTable('no_such_world', '/', none.f)];
  ok(none.asked.length === 0 && words.every((w) => typeof w === 'string' && /not a ground world's pack/.test(w)), `a pack no ground world gives (a real-elevation world, a space zone, the gallery, none) is asked for nothing and lends nothing, said (${String(words[0])})`);
  const gone = fake(null, true);
  const g1 = await loadLentTable('naboo', '/t404/', gone.f);
  const g2 = await loadLentTable('naboo', '/t404/', gone.f);
  const failed = fake(null, false);
  const f1 = await loadLentTable('naboo', '/tfail/', failed.f);
  const f2 = await loadLentTable('naboo', '/tfail/', failed.f);
  ok(/not installed/.test(String(g1)) && g2 === g1 && gone.asked.join() === 'naboo/terrain/shaders.json' && /did not load/.test(String(f1)) && /did not load/.test(String(f2)) && failed.asked.join() === 'naboo/terrain/shaders.json,naboo/terrain/shaders.json', `a 404 is kept for the session (asked once: ${gone.asked.length}), a failure asked again (${failed.asked.length})`);
  const noTrn = fake(shadersText, true);
  const t1 = await loadLentTable('rori', '/tt/', noTrn.f);
  ok(typeof t1 === 'string' && /carries no terrain/.test(t1) && noTrn.asked.join() === 'rori/terrain/shaders.json,rori/terrain.trn' && (await loadLentTable('rori', '/tt/', noTrn.f)) === t1 && noTrn.asked.length === 2, "a pack whose pictures' list is there and whose terrain is not (a 404) lends nothing, said, and is not asked again");
  forgetLentTables();
  // The game's fetch for a lent world's terrain (`packBytes`, beside `packJson`): the pack files' rules and their record.
  forgetFiles();
  const realFetch = PACK_FILES.fetch;
  const fetched: string[] = [];
  PACK_FILES.fetch = async (url) => {
    fetched.push(url);
    const missing = url.includes('/nope/');
    return { ok: !missing, status: missing ? 404 : 200, headers: { get: () => 'application/octet-stream' }, json: async () => null, text: async () => '', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  try {
    const packless = await packBytes('monument', 'terrain.trn', '/', { probe: false });
    const got = await packBytes('naboo', 'terrain.trn', '/', { probe: false });
    const miss = await packBytes('nope', 'terrain.trn', '/', { probe: false });
    const again = await packBytes('nope', 'terrain.trn', '/', { probe: false });
    const r = filesReport();
    ok(packless === null && got?.length === 3 && miss === null && again === null && fetched.join() === '/assets-private/naboo/terrain.trn,/assets-private/nope/terrain.trn' && r.asked.some((x) => x.url === '/assets-private/naboo/terrain.trn' && x.answer === 'ok') && knownAbsent('nope', 'terrain.trn', '/') && r.skipped.some((s) => s.url === '/assets-private/monument/terrain.trn'), `a lent world's bytes are read by the pack files' rules and in their record: a packless world's never asked, a 404 kept and not asked again (${fetched.length} asked)`);
  } finally {
    PACK_FILES.fetch = realFetch;
    forgetFiles();
  }
}

// ---------------------------------------------------------------- 6. the second wave's ground to the bit with no other world

const W2 = 'ba83837';
const mods = await loadOldMany(['src/swg/terrain/generator.ts', 'src/swg/terrain/groundPaint.ts', 'src/swg/terrain/trn.ts', 'src/swg/terrain/workerCore.ts'], ['src/swg/terrain/trn.ts', 'src/swg/terrain/groundPaint.ts', 'src/swg/terrain/workerCore.ts'], W2);
if (!mods) note(`git cannot hand ${W2} over here: the second wave's comparison is skipped`);
else if (!worlds.length) note(`no converted world under ${PACKS}: the second wave's comparison is held on the made terrain alone`);
{
  const OldTrn = mods?.[0] as { parseTerrainTemplate: typeof parseTerrainTemplate; TerrainSampler: typeof TerrainSampler } | undefined;
  const OldPaint = mods?.[1] as { GroundPaint: typeof GroundPaint } | undefined;
  const OldCore = mods?.[2] as { TerrainWorkerCore: typeof TerrainWorkerCore } | undefined;
  const list = mods ? [...worlds.map((w) => ({ name: w, bytes: new Uint8Array(readFileSync(join(PACKS, w, 'terrain.trn'))) })), { name: 'the made terrain', bytes: paintTerrainBytes() }] : [];
  for (const { name, bytes } of list) {
    const t = parseTerrainTemplate(bytes);
    const old = OldTrn!.parseTerrainTemplate(bytes);
    const fams = [...t.generator.shaderGroup.families.values()].filter((f) => f.children.length);
    const sameIds = fams.every((f) => t.generator.shaderGroup.byName(f.name)?.id === old.generator.shaderGroup.byName(f.name)?.id && t.generator.shaderGroup.ensure(f) === old.generator.shaderGroup.ensure(f));
    const entries = fams.slice(0, 4).map((f, i) => (i === 1 && f.children.length > 1 ? { pack: name, name: f.name, child: 1 } : { pack: name, name: f.name }));
    entries.push({ pack: 'elsewhere', name: fams[0]?.name ?? 'x' });
    const p = new GroundPaint(4);
    const o = new OldPaint!.GroundPaint(4);
    const mp = p.resolve(entries, t.generator.shaderGroup, name, undefined, () => 'not lent');
    const mo = o.resolve(entries, old.generator.shaderGroup, name);
    const sameResolve = p.familyOf.every((v, i) => v === o.familyOf[i]) && p.choiceOf.every((v, i) => v === o.choiceOf[i]) && mp.length === mo.length;
    const sampler = new TerrainSampler(t);
    const oldS = new OldTrn!.TerrainSampler(old);
    const blocks = name === 'the made terrain' ? [{ bx: -1, bz: -1 }, { bx: 0, bz: 0 }] : sampleBlocks(t, 3, 4242);
    for (const b of blocks) {
      const s = sampler.blockStart(b.bx, b.bz);
      for (let cz = 0; cz < 8; cz++) for (let cx = 0; cx < 8; cx += 2) {
        const c = { x: Math.floor(s.x / 4) + 2 + cx * 2, z: Math.floor(s.z / 4) + 2 + cz * 2 };
        cellPaint(p, c.x, c.z, 1 + ((cx + cz) % 4));
        cellPaint(o as unknown as GroundPaint, c.x, c.z, 1 + ((cx + cz) % 4));
      }
    }
    sampler.paint = p;
    oldS.paint = o as unknown as GroundPaint;
    let sameGrids = true;
    for (const b of blocks) {
      const s = sampler.blockStart(b.bx, b.bz);
      if (!sameArrays(sampler.generate(s.x, s.z, sampler.numberOfPoles, sampler.poleStep), oldS.generate(s.x, s.z, oldS.numberOfPoles, oldS.poleStep))) sameGrids = false;
    }
    const core = new TerrainWorkerCore();
    const oc = new OldCore!.TerrainWorkerCore();
    core.handle({ type: 'init', trn: bytes.slice().buffer, layers: [], bitmaps: [], ramps: [], paint: p.message(null, null, true), rev: 1 });
    oc.handle({ type: 'init', trn: bytes.slice().buffer, layers: [], bitmaps: [], ramps: [], paint: o.message(null, null, true), rev: 1 });
    const s0 = sampler.blockStart(blocks[0].bx, blocks[0].bz);
    const g = (c: { handle: TerrainWorkerCore['handle'] }) => c.handle({ type: 'generate', id: 1, startX: s0.x, startZ: s0.z, n: sampler.numberOfPoles, step: sampler.poleStep }).message;
    ok(sameIds && sameResolve && sameGrids && sameArrays(g(core), g(oc)) && t.generator.shaderGroup.lent.size === 0, `${name}: with no other world's family, every name's id, the palette's ids and choices (an entry of another pack laying nothing either way), ${blocks.length} painted grids and the worker's grid are ${W2}'s by Object.is`);
  }
  // The arrays' plan with nothing lent: this world's own list, entries and names, the layer count unchanged.
  for (const world of worlds.filter((w) => !!shadersOf(w))) {
    const s = shadersOf(world)!;
    const planet = new Map<number, string>(s.families.map((f) => [f.id, f.name]));
    const plan = tilePlan(s.families, planet, [], false);
    const ownList = s.families.filter((f) => f.children?.length);
    const ents = tileEntries(ownList, false);
    if (!(plan.lentFams === null && Object.is(plan.planet, planet) && plan.families.length === ownList.length && plan.families.every((f, i) => f === ownList[i]) && plan.entries.length === ents.length && plan.entries.every((e, i) => e.family === ents[i].family && e.child === ents[i].child && e.def === ents[i].def))) {
      ok(false, `${world}: the arrays' plan with nothing lent is the second wave's`);
    }
  }
  if (worlds.length) ok(true, `on every converted world (${worlds.filter((w) => !!shadersOf(w)).length}) the arrays' plan with nothing lent is this world's own list, entries and names, the very map handed in: the layer count the second wave's`);
}

// ---------------------------------------------------------------- 7. the hand-overs only the game makes

{
  const read = (f: string) => readFileSync(join(REPO, f), 'utf8');
  const world = read('src/world/world.ts');
  const load = world.slice(world.indexOf('  async loadPack('));
  const ready = load.indexOf('await this.paintReady();');
  const prep = load.indexOf('await this.prepareLending(pack, this.paintPack());');
  const create = load.indexOf('const swg = await SwgTerrain.create(');
  ok(ready > 0 && prep > ready && create > prep && /lend: \(group, tileWidth\) => this\.lendGround\(group, tileWidth\)/.test(load.slice(create, create + 400)), "a converted world plans its lending after its paint file is read and before its terrain is made, whose group lends at the constructor (`lend`)");
  const swgT = read('src/world/swgTerrain.ts');
  const ctor = swgT.slice(swgT.indexOf('  private constructor('));
  ok(ctor.indexOf('if (lend) lend(this.template.generator.shaderGroup, this.template.tileWidthInMeters);') > 0 && ctor.indexOf('if (lend) lend(') < ctor.indexOf('if (paint && paintResolve) paintResolve(') && ctor.indexOf('if (paint && paintResolve) paintResolve(') < ctor.indexOf("type: 'init',") && /lent: this\.template\.generator\.shaderGroup\.lentList\(\)/.test(ctor), 'the terrain lends after its building layers and before the palette is resolved, and the worker\'s `init` carries the lent list');
  const borrow = world.slice(world.indexOf('  private async loadBorrowedGround('));
  ok(borrow.indexOf('await this.prepareLending(pack, spec.pack);') > 0 && borrow.indexOf('this.lendGround(table.template.generator.shaderGroup);') > borrow.indexOf('await this.prepareLending(') && borrow.indexOf('this.lendGround(') < borrow.indexOf('await this.loadGroundTextures(pack, table);') && /if \(table\.template\.generator\.shaderGroup\.lent\.has\(f\.id\)\) continue;/.test(borrow), "a real-elevation world's lent table lends before its pictures are loaded, and its rules never name a lent family");
  const tex = world.slice(world.indexOf('  private async loadGroundPictures('));
  ok(tex.includes('const lentPictures = l && !l.off && group ? lentPicturesOf(l.plan, l.tables, (p, n) => group.lentId(p, n)) : [];') && /TerrainTextures\.load\(pack, World\.anisotropy, planet, ground, lentPictures\)/.test(tex) && /if \(group\) for \(const f of group\.families\.values\(\)\) if \(!group\.lent\.has\(f\.id\)\) planet\.set\(f\.id, f\.name\);/.test(tex), "the ground's pictures load with the lent beside its own (unless the world lends nothing at all), and the planet's names handed in are its own alone");
  ok(/scope: \{ world: l\.pack, id: l\.from \}/.test(world) && world.includes('const lend = (pk: string, nm: string): number | string => lentAnswer(l, group.lentId(pk, nm), lentFamilyKey(pk, nm));') && /p\.resolve\(this\.paintEntries, group, pack, byId, lend\)/.test(world) && world.includes('const f = familyOfKey(group, pack, k);'), "the air classes a lent family by its own world, the palette is resolved with the lending's very answer, and the world row's weights find a lent family by the key's own rule");
  // Whole lines of the game's own decisions, each a call of a function section 5 runs (a review broke every hand-over that
  // was pinned by a fragment of its line, with every check passing).
  const fn = (name: string): string => {
    const at = world.indexOf(`  ${name}(`);
    const tail = world.slice(at);
    return tail.slice(0, tail.indexOf('\n  }\n') > 0 ? tail.indexOf('\n  }\n') : tail.indexOf('\r\n  }\r\n'));
  };
  const prepBody = fn('private async prepareLending');
  ok(prepBody.includes('const a = arrivalAsks(this.paintEntries, this.paintWorld.packs, this.planet?.dem ? this.terrain.demBase : null, own);') && prepBody.includes('const packs = a.read;') && prepBody.includes('for (const p of packs) tables.set(p, await loadLentTable(p, import.meta.env.BASE_URL, World.lentFetch));') && prepBody.includes('const plan = planLending(ownFile!.families, a.asks, a.whole, own, tables, GROUND_FIRST_CHILD_ONLY);'), "an arrival asks what the palette, the world row's packs and a real-elevation world's base name (`arrivalAsks`), reads every pack it names, and plans with the asks and the row's packs whole");
  ok(fn('lentHere').includes("return !!g && typeof lentAnswer(this.lending, g.lentId(pack, name), lentFamilyKey(pack, name)) === 'number';"), "whether a family is lent here is the lending's very answer (a family whose pictures never loaded is not)");
  const inPlay = fn('async lendInPlay');
  ok(inPlay.includes('if (this.lentHere(pack, name)) return null;') && inPlay.includes('const lost = group.lentId(pack, name) > 0 ? l.plan.why.get(key) : undefined;') && inPlay.includes('if (lost !== undefined) return lost;') && inPlay.indexOf('if (lost !== undefined) return lost;') < inPlay.indexOf('appendLending(') &&inPlay.includes('await this.loadGroundTextures(picturePack, this.terrain.swg ? undefined : (this.terrain.demLent ?? undefined), false);') && inPlay.includes('this.relayPaint(group, before);') && inPlay.includes("[...layersBefore].some(([id, list]) => (layersNow.get(id) ?? []).join() !== list.join())) this.rebuildGround();") && inPlay.includes('const a = lentAnswer(this.lending, group.lentId(pack, name), key);') && inPlay.includes("return typeof a === 'number' ? null : a;"), "a family lent in play: none twice, one whose pictures never loaded refused this visit, the arrays made again, the palette relaid, the chunks built again should a layer of before have moved, and the answer the lending's own");
  const loadTex = fn('private async loadGroundTextures');
  ok(loadTex.includes('const lost = this.settleLending(lending, group);') && loadTex.includes('this.relayPaint(group, before);') && fn('private settleLending').includes('const lost = undrawnLent(l.plan, (p, n) => group.lentId(p, n), (id) => (tiles?.childLayers.get(id)?.length ?? 0) > 0);'), "after the ground's arrays are made, every lent family without layers there is taken out of the lending (`undrawnLent`) and an arrival's palette relaid");
  ok(fn('private installDemPaint').includes('shader.baseId = baseFamilyId(t.demBase, t.demLentPack, group, this.lending);'), "a real-elevation world's base is `baseFamilyId`'s (another pack's lent by its id)");
  ok(/json: \(pack, file\) => packJson\(pack, file, import\.meta\.env\.BASE_URL, \{ probe: false \}\),/.test(world) && /bytes: \(pack, file\) => packBytes\(pack, file, import\.meta\.env\.BASE_URL, \{ probe: false \}\),/.test(world) && /absent: \(pack, file\) => knownAbsent\(pack, file, import\.meta\.env\.BASE_URL\),/.test(world) && fn('async packFamilies').includes('if (!groundPacksOf().includes(pack)) return notGroundPack(pack);') && !/fetch\(`\$\{base\}terrain/.test(world), "a lent world's files are read through the pack files' rules (`packJson`, `packBytes`, `knownAbsent`), never a fetch of their own, and a pack no ground world gives is never browsed");
  const entry = read('src/editor/editorEntry.ts');
  ok(entry.includes('pack: packOfFamily(g, f.id, own), children: f.children') && entry.includes("const browse = this.paintBrowse === own ? '' : this.paintBrowse;"), "the editor's families carry the pack each is from (`packOfFamily`), and a browsed pack that is the world's own is its own list");
  const tt = read('src/world/terrainTextures.ts');
  ok(/const plan = tilePlan\(file\.families, planet, lent, firstOnly\);/.test(tt) && /tilesOf\(plan, arrays, ground\.shaderGroup, firstOnly\)/.test(tt) && tt.includes('const urlOf = tileUrlOf(plan, (f) => pack.url(f));'), "the ground's load plans, addresses its pictures and looks up through the very functions this test runs");
  const wc = read('src/swg/terrain/workerCore.ts');
  ok(/template\.generator\.shaderGroup\.takeLent\(msg\.lent\);\s*if \(msg\.paint\) this\.takePaint\(msg\.paint, msg\.rev\);/.test(wc) && /this\.sampler\.generator\.shaderGroup\.takeLent\(msg\.lent\);\s*this\.takePaint\(msg\.paint, msg\.rev\);/.test(wc), "the worker takes the lent list before the paint, at its `init` and at every `paint`");
}

/** A family's ground-picture entry made from its group's family (the made worlds have no `shaders.json`). */
function defOf(f: ShaderFamily, id: number): ShaderFamilyDef {
  return { id, name: f.name, size: 4, file: `${f.name}0.png`, children: f.children.map((c, k) => ({ shader: c.name, weight: c.weight, file: `${f.name}${k}.png`, normal: null, specular: null, specularColor: null })) };
}

/** A made world's own families as ground-picture entries. */
function ownDefsOf(g: ShaderGroup): ShaderFamilyDef[] {
  return [...g.families.values()].map((f) => defOf(f, f.id));
}

console.log(`\nforeignFamilies: ${checks} checks passed`);
