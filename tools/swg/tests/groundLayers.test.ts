// What a version-4 pack's ground pictures become (`src/world/terrainTextures.ts`, materials and ground pass,
// wave 5). The loader only decodes each picture and reads it through a canvas; everything after that is pure
// code, which this runs over the packs' own pictures (SWG3JS_PACKS, else assets-private) and the planets' own
// shader groups in node:
//
//   1. the pictures in order (`tileEntries`): every child that has one, a layer each, the first only when asked,
//      with the family's own picture standing in for a first child that has none
//   2. the arrays (`assembleTileArrays`): every kept child's colour its own layer, byte for byte; its bump's
//      direction in that layer's rgb (flat where it has none); its gloss picture's red in the alpha, and nought
//      there for every child whose shader's specular colour is black (`glossTaken`), held on a child made for it
//      (on the converted packs every black child's mask is written nought already, so no real picture shows the
//      rule at work); each family's children's layers, a child with no picture drawing its family's heaviest;
//      and how many layers a world needs, which the vertex's byte must hold
//   3. the planet's own families matched by name (`tileLookups`): each id its family's layers, its rank the
//      pack's priority, one the pack does not list above every listed one
//   4. the tiler (`makeTiler`) over the planet's own shader group: every family's layer for every choice byte is
//      the child `childIndexOf` picks, its rank the pack's priority (which is not its id), the other end first
//      under `order: 'last'`, the first child under `children: false` and under the first-child switch, the
//      corners from `childCorner`, and a family it has no layers for drawing layer nought
//   5. which worlds the program fits (`tilesFit`): every ground world but the copies' (16 m tiles), whose
//      ground keeps the program of before
//
// Run: node tools/swg/tests/groundLayers.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleTileArrays, glossTaken, makeTiler, tileEntries, tileLookups, type ShaderFamilyDef, type TilePictures } from '../../../src/world/terrainTextures.ts';
import { GROUND_DRAW_TUNE, tilesFit } from '../../../src/world/groundTiles.ts';
import { childIndexOf } from '../../../src/swg/terrain/generator.ts';
import { parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { decodePng } from '../png.mjs';
import { groundWorlds, loadWorld, PACKS } from './terrainHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

interface ShadersFile {
  version?: number;
  families: ShaderFamilyDef[];
}

function shadersOf(world: string): ShadersFile | null {
  const f = join(PACKS, world, 'terrain', 'shaders.json');
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, 'utf8')) as ShadersFile;
  return (j.version ?? 0) >= 4 ? j : null;
}

type Picture = { width: number; height: number; rgba: Uint8Array };
function picture(world: string, rel: string | null | undefined): Picture | null {
  if (!rel) return null;
  const f = join(PACKS, world, rel);
  if (!existsSync(f)) return null;
  return decodePng(readFileSync(f)) as Picture | null;
}

// ---------------------------------------------------------------- 1. glossTaken and the first-child entries, by hand

{
  ok(!glossTaken({ specularColor: [0, 0, 0] }, { specularColor: [1, 1, 1] }) && glossTaken({ specularColor: [1, 1, 1] }, { specularColor: [0, 0, 0] }), "a child's own specular colour decides whether it shines, black taking none");
  ok(!glossTaken({ specularColor: null }, { specularColor: [0, 0, 0] }) && glossTaken({ specularColor: null }, { specularColor: null }), "and with none of its own its family's does, none at all shining as before");
  const fam = (name: string, kids: (string | null)[], file: string | null): ShaderFamilyDef => ({ id: name.length, name, size: 4, file: file as string, children: kids.map((k) => ({ shader: name, weight: 1, file: k, normal: null, specular: null, specularColor: null })) });
  const fams = [fam('a', ['a0', 'a1', null], 'a0'), fam('bb', [null, 'b1'], 'b_heavy'), fam('ccc', [null], null)];
  const every = tileEntries(fams, false);
  ok(every.map((e) => `${e.family.name}${e.child}`).join() === 'a0,a1,bb1', 'every child with a picture is an entry, in the family list\'s order, and a child with none is none');
  const first = tileEntries(fams, true);
  ok(first.map((e) => `${e.family.name}${e.child}:${e.def.file}`).join() === 'a0:a0,bb0:b_heavy', 'under the first-child switch each family is its first child, its own picture standing in where that child has none');
  // The black rule through the arrays: on the converted packs every black child's gloss picture is already nought
  // (the converter writes no mask for a plain dot3 shader), so only a child made here can show the rule at work.
  const shiny: ShaderFamilyDef = {
    id: 3,
    name: 'shiny',
    size: 4,
    file: 's0',
    specularColor: [1, 1, 1],
    children: [
      { shader: 's0', weight: 1, file: 's0', normal: null, specular: 's0g', specularColor: [0, 0, 0] },
      { shader: 's1', weight: 1, file: 's1', normal: 's1n', specular: 's1g', specularColor: null },
    ],
  };
  const e2 = tileEntries([shiny], false);
  const arrays = assembleTileArrays([shiny], e2, [true, true], 1, { colour: (i) => [i, 2, 3, 255], normal: (i) => (i === 1 ? [10, 20, 30, 255] : null), gloss: () => [200, 7, 200, 255] })!;
  ok([...arrays.bump].join() === '128,128,255,0,10,20,30,200', "a child whose shader's specular colour is black takes no gloss whatever its picture holds, and the next its picture's red, its bump's direction beside it (flat where it has none)");
}

// ---------------------------------------------------------------- 2 to 4, over the packs

const WORLDS = ['tatooine', 'kashyyyk_hunting', 'corellia'];
let blackSeen = 0;
let tilersRun = 0;
for (const world of WORLDS) {
  const file = shadersOf(world);
  const loaded = file ? loadWorld(world) : null;
  if (!file || !loaded) {
    note(`no ${world} at terrain shaders version 4 under ${PACKS}: its pictures are not read here`);
    continue;
  }
  const families = file.families.filter((f) => f.children?.length);
  const entries = tileEntries(families, false);
  const colours = entries.map((e) => picture(world, e.def.file));
  const kept = colours.map((c) => !!c);
  const size = Math.min(512, Math.max(...colours.filter(Boolean).map((c) => Math.max(c!.width, c!.height))));
  const all = entries.flatMap((e, i) => [colours[i], picture(world, e.def.normal), picture(world, e.def.specular)]).filter(Boolean) as Picture[];
  if (all.some((p) => p.width !== size || p.height !== size)) {
    note(`${world}: its pictures are not all ${size} px, which the canvas would scale: not compared here`);
    continue;
  }
  const normals = entries.map((e) => picture(world, e.def.normal));
  const glosses = entries.map((e) => picture(world, e.def.specular));
  const asked = { colour: [] as number[], normal: [] as number[], gloss: [] as number[] };
  const pictures: TilePictures = {
    colour: (i) => (asked.colour.push(i), colours[i]!.rgba),
    normal: (i) => (asked.normal.push(i), normals[i]?.rgba ?? null),
    gloss: (i) => (asked.gloss.push(i), glosses[i]?.rgba ?? null),
  };
  const arrays = assembleTileArrays(families, entries, kept, size, pictures)!;
  const per = size * size * 4;
  const keptAt = entries.map((_, i) => i).filter((i) => kept[i]);
  ok(arrays.depth === keptAt.length && arrays.colour.length === per * keptAt.length && arrays.bump.length === per * keptAt.length, `${world}: ${arrays.depth} layers, one for every child whose colour decoded (of ${entries.length} entries)`);
  ok(asked.colour.join() === keptAt.join(), 'and each kept colour asked for once, in order');
  let coloursSame = true;
  let bumpsSame = true;
  let glossSame = true;
  keptAt.forEach((i, layer) => {
    const at = layer * per;
    const c = colours[i]!.rgba;
    for (let p = 0; p < per; p++) if (arrays.colour[at + p] !== c[p]) coloursSame = false;
    const n = normals[i]?.rgba;
    const g = glosses[i]?.rgba;
    const takes = glossTaken(entries[i].def, entries[i].family);
    let glossy = false;
    for (let p = 0; p < per; p += 4) {
      const want = n ? [n[p], n[p + 1], n[p + 2]] : [128, 128, 255];
      if (arrays.bump[at + p] !== want[0] || arrays.bump[at + p + 1] !== want[1] || arrays.bump[at + p + 2] !== want[2]) bumpsSame = false;
      if (g && g[p] > 0) glossy = true;
      if (arrays.bump[at + p + 3] !== (g && takes ? g[p] : 0)) glossSame = false;
    }
    if (!takes && glossy) blackSeen++;
  });
  ok(coloursSame, "every layer's colour is its child's picture, byte for byte");
  ok(bumpsSame, "its bump's direction is its child's bump picture's, and flat (128 128 255) where it has none");
  ok(glossSame, "its alpha is its child's gloss picture's red, and nought where it has none or its shader's specular colour is black");
  // Each family's children's layers.
  let layersRight = true;
  for (const f of families) {
    const list = arrays.childLayersByName.get(f.name.toLowerCase());
    if (!list) {
      if (f.children!.some((k) => k.file)) layersRight = false;
      continue;
    }
    if (list.length !== f.children!.length) layersRight = false;
    const own = (k: number) => {
      const i = entries.findIndex((e) => e.family === f && e.child === k);
      return i >= 0 && kept[i] ? keptAt.indexOf(i) : -1;
    };
    const owned = f.children!.map((_, k) => own(k));
    const heaviest = owned[f.primary ?? 0] >= 0 ? owned[f.primary ?? 0] : (owned.find((v) => v >= 0) ?? 0);
    owned.forEach((o, k) => {
      if (list[k] !== (o >= 0 ? o : heaviest)) layersRight = false;
    });
    if (arrays.firstLayer.get(f.id) !== list[0]) layersRight = false;
    if (arrays.childCounts.get(f.name.toLowerCase()) !== owned.filter((v) => v >= 0).length) layersRight = false;
  }
  ok(layersRight, "each family's children map to their own layers, a child with no picture to its family's heaviest, and its first child's layer is what the dust reads");
  ok(arrays.depth <= 255, `and ${arrays.depth} layers fit the byte a vertex carries a layer in`);

  // 3. The planet's own families.
  const group = loaded.template.generator.shaderGroup;
  const planet = new Map<number, string>([...group.families.values()].map((f) => [f.id, f.name]));
  planet.set(9999, 'a_family_no_pack_lists');
  const { childLayers, priority } = tileLookups(planet, families, arrays.childLayersByName);
  const packPriority = new Map(families.map((f, i) => [f.name.toLowerCase(), f.priority ?? i]));
  let lookupsRight = true;
  for (const [id, name] of planet) {
    const list = arrays.childLayersByName.get(name.toLowerCase());
    if (childLayers.get(id) !== list) lookupsRight = false;
    const p = packPriority.get(name.toLowerCase());
    if (p !== undefined ? priority.get(id) !== p : (priority.get(id) ?? 0) < 10000) lookupsRight = false;
  }
  ok(lookupsRight, `${world}: every planet family by its id has its pack family's layers and its pack priority, and one the pack does not list ranks above them all`);

  // 4. The tiler over the planet's own shader group.
  const saved = { order: GROUND_DRAW_TUNE.order, children: GROUND_DRAW_TUNE.children, childCorner: [...GROUND_DRAW_TUNE.childCorner] };
  try {
    const tiler = makeTiler(childLayers, priority, group, false);
    let picks = true;
    let varied = 0;
    for (const [id, list] of childLayers) {
      const seen = new Set<number>();
      for (let c = 0; c < 256; c++) {
        const want = list[childIndexOf(group.families.get(id), c)] ?? list[0];
        const got = tiler.layer(id, c);
        if (got !== want) picks = false;
        seen.add(got);
      }
      if (seen.size > 1) varied++;
    }
    ok(picks && varied > 0, `the tiler draws, for every family and every choice byte, the child the generator's own childIndexOf picks (${varied} families draw more than one child)`);
    const ids = [...childLayers.keys()];
    const notId = ids.filter((id) => priority.get(id) !== id).length;
    ok(ids.every((id) => tiler.rank(id) === priority.get(id)) && notId > 0, `its rank is the pack's priority, not the family's id (they differ on ${notId} of ${ids.length})`);
    ok(tiler.layer(123456, 77) === 0, 'and a family it has no layers for draws layer nought');
    GROUND_DRAW_TUNE.order = 'last';
    GROUND_DRAW_TUNE.children = false;
    GROUND_DRAW_TUNE.childCorner = ['ne', 'nw'];
    tiler.census[2] = 5;
    tiler.refresh();
    ok(ids.every((id) => tiler.rank(id) === -priority.get(id)!), "after `order: 'last'` and a refresh, the other end of the list ranks lowest");
    ok([...childLayers].every(([id, list]) => [0, 99, 200, 255].every((c) => tiler.layer(id, c) === list[0])), 'after `children: false`, every choice draws the first child');
    ok(tiler.corners.join() === '3,2,0,1' && tiler.census.every((v) => v === 0), '`childCorner` sets the corners asked, any left out after them in the client\'s order, and a refresh starts the census again');
    GROUND_DRAW_TUNE.order = saved.order;
    GROUND_DRAW_TUNE.children = true;
    const first = makeTiler(childLayers, priority, group, true);
    ok([...childLayers].every(([id, list]) => [0, 128, 255].every((c) => first.layer(id, c) === list[0])), 'and a world loaded under the first-child switch draws the first child whatever the knob says');
    tilersRun++;
  } finally {
    GROUND_DRAW_TUNE.order = saved.order;
    GROUND_DRAW_TUNE.children = saved.children;
    GROUND_DRAW_TUNE.childCorner = saved.childCorner as typeof GROUND_DRAW_TUNE.childCorner;
  }
}
note(`${blackSeen} children here whose shader takes no shine bring a gloss picture that is not nought (the black rule changes no byte of the converted packs today: their black children's masks are written nought)`);
if (!tilersRun) note('no pack read here: the tiler is not run over a real shader group');

// ---------------------------------------------------------------- 5. which worlds the program fits

{
  const worlds = groundWorlds();
  if (!worlds.length) note(`no converted worlds under ${PACKS}: tilesFit is checked by hand only`);
  const widths = worlds.map((w) => ({ w, tw: parseTerrainTemplate(new Uint8Array(readFileSync(join(PACKS, w, 'terrain.trn')))).tileWidthInMeters }));
  const unfit = widths.filter((x) => !tilesFit(x.tw));
  ok(tilesFit(4) && !tilesFit(16) && !tilesFit(8), 'the tile program fits 4 m tiles, two 2 m poles a tile, and nothing else');
  if (worlds.length) {
    ok(unfit.every((x) => x.tw !== 4) && widths.filter((x) => x.tw === 4).length === worlds.length - unfit.length, `on ${worlds.length - unfit.length} of the ${worlds.length} converted worlds the tiles are 4 m and the program fits; ${unfit.map((x) => `${x.w} (${x.tw} m)`).join(', ') || 'none'} ${unfit.length === 1 ? 'keeps' : 'keep'} the program of before`);
    if (worlds.includes('dungeon1')) ok(unfit.some((x) => x.w === 'dungeon1'), "the copies' world, whose 16 m tiles would lay its cells on tiles of the wrong size, is the one that does not fit");
  }
}

console.log(`\n${passed} checks passed`);
