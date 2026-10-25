// What the ground is made of as the moving air sees it (src/world/volumetrics/groundResponse.ts): over every world on
// disk (SWG3JS_PACKS, else assets-private), every family decided by an override, SOE's surface or a rule and none by the
// fallback; every override names a family a pack holds; the handoff's own stated cases; `dirt_kash_*` is not ash; and a
// fixture of thirty family names with their classes (names only, ours) for a checkout with no packs.
//
// Plain type stripping. It prints family names and classes, never anything else of the files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyFamily, fillLayerResponse, fillResponseTable, GROUND_OVERRIDES, responseOf, ruleClass, SURFACE_ALLOWS, surfaceWordOf, type FamilyFacts } from '../../../src/world/volumetrics/groundResponse.ts';
import { GROUND_CLASS_NAMES, GROUND_RESPONSE_CLASSES } from '../../../src/world/volumetrics/airTune.ts';
import { parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { groundWorlds, PACKS } from './terrainHarness.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string): void => console.log(`note ${s}`);
const byName = (name: string, world = '', surface = '', children: FamilyFacts['children'] = []): FamilyFacts => ({ id: 0, name, surface, children });

// --- the handoff's stated cases (its own comments in family_defaults.py) ---
ok(classifyFamily('', byName('mudcracks')).cls === 'packed', "dry, cracked mud is packed earth, not mud (the handoff's first rule)");
ok(classifyFamily('', byName('rock_dath_desertash')).cls === 'ash', 'ash whatever prefix it was filed under: rock_dath_desertash is loose ash');
ok(classifyFamily('', byName('dirt_dath_desertcanyonfloor')).cls === 'dirt', "a canyon floor of loose dirt is dirt, not paving (the handoff dropped 'floor')");
ok(classifyFamily('', byName('rock_lok_glowinglava')).cls === 'rock', "glowing lava is rock to the wind: molten in look, the lava's job");
ok(classifyFamily('', byName('rock_lok_lava')).cls === 'rock', 'lava by name is rock');

// --- research3's fixes ---
for (const n of ['dirt_kash_leaves', 'dirt_kash_rocky', 'dirt_kash_mossy', 'kash_dirt_path']) ok(classifyFamily('kashyyyk_main', byName(n)).cls !== 'ash', `"${n}" is not loose ash (a "k" before "ash" is Kashyyyk)`);
ok(ruleClass('rocky_mtn') === 'rock' && ruleClass('rockyterrain') === 'gravel' && ruleClass('brokenrock') === 'gravel', '"rocky" is gravel except a rocky mountain');
ok(ruleClass('sand_wet_shore') === 'wetsand' && ruleClass('waterline_mud') === 'wetsand', 'wet shore sand is wet sand, before mud and sand');

// --- thirty names with their classes (ours: the rules applied to the names alone) ---
const FIXTURE: Record<string, string> = {
  'cliffCracked-brngrey': 'rock',
  CourtTile: 'paved',
  CourtTileDark: 'paved',
  gravel_fine: 'gravel',
  gravel_large: 'gravel',
  grss_dsrt_dry: 'grass',
  mud: 'mud',
  mudcracks: 'packed',
  rock_cliff_anza: 'rock',
  rock_graniteplate_orange: 'rock',
  rock_road: 'paved',
  sand_bumpy: 'sand',
  Sand_light: 'sand',
  'sand-blown': 'sand',
  snow: 'snow',
  dirt_dath_desertcanyonfloor: 'dirt',
  dirt_grasslands: 'dirt',
  dirt_lok_smallrock: 'gravel',
  dirt_redsandy: 'sand',
  grss_dsrt_dry_trans: 'grass',
  outpost_concrete: 'paved',
  rock_beachcliff_red: 'rock',
  rock_dath_desertash: 'ash',
  rock_lok_glowinglava: 'rock',
  rock_lok_lava: 'rock',
  snow_mtnspeak: 'snow',
  tatt_sand_bumpy: 'sand',
  rock_endoracid: 'rock',
  rock_rusted_orange: 'rock',
  dirt_kash_leaves: 'litter',
};
ok(Object.keys(FIXTURE).length === 30, 'the fixture is thirty names');
for (const [name, cls] of Object.entries(FIXTURE)) ok(classifyFamily('', byName(name)).cls === cls, `${name} is ${cls}`);

// --- the surface's allow set, and the table ---
ok(classifyFamily('', byName('sand_bumpy', '', 'abstract/terrain_surface/stone.iff')).cls === 'paved', "SOE's surface wins over a name it does not allow (stone allows paving only)");
ok(classifyFamily('', byName('dirt_lok_smallrock', '', 'abstract/terrain_surface/harddirt.iff')).cls === 'gravel', 'and the name refines inside what the surface allows (hard dirt allows gravel)');
ok(surfaceWordOf('abstract/terrain_surface/sand.iff') === 'sand' && surfaceWordOf('') === '', "a surface template's bare word");
for (const allows of Object.values(SURFACE_ALLOWS)) ok(allows.every((c) => GROUND_CLASS_NAMES.includes(c)), `a surface's classes are real classes (${allows.join(', ')})`);
for (const [k, [cls]] of Object.entries(GROUND_OVERRIDES)) ok(GROUND_CLASS_NAMES.includes(cls), `the override ${k} names a real class`);
{
  const out = new Uint8Array(8 * 4);
  const fall = fillResponseTable('', [{ id: 2, name: 'sand_bumpy', surface: '', children: [] }, { id: 5, name: 'qqq', surface: '', children: [] }, { id: 99, name: 'sand', surface: '', children: [] }], out);
  ok(out[2 * 4 + 3] === 255 && out[2 * 4] === 255 && fall === 1 && out[5 * 4 + 3] === Math.round(GROUND_RESPONSE_CLASSES.dirt.dust * 255), 'the table: four bytes a family by id, a family past its size left out, the fallback counted');
  ok(responseOf('mud').dust === 0 && responseOf('wetsand').dust === 0 && responseOf('rock').dust < 0.2, 'mud and wet sand throw no dust, rock almost none');
}
// --- the per-layer lookup the ground's variant reads: two rows of four bytes a layer ---
{
  // Five families' responses and three families' colours (family 4 has a response and no colour row); six layers, two
  // of them named by no family; a family past the response table and a layer past the lookup left out.
  const response = new Uint8Array(5 * 4);
  for (let f = 0; f < 5; f++) for (let c = 0; c < 4; c++) response[f * 4 + c] = 10 * (f + 1) + c;
  const colour = new Uint8Array(4 * 4);
  for (let f = 0; f < 4; f++) for (let c = 0; c < 4; c++) colour[f * 4 + c] = 100 + 20 * f + c;
  const layers = 6;
  const out = new Uint8Array(layers * 8).fill(77);
  const childLayers = new Map<number, number[]>([
    [1, [0, 3]],
    [2, [1]],
    [4, [5]],
    [9, [2]],
    [3, [7]],
  ]);
  const filed = fillLayerResponse(childLayers, response, out, colour);
  const row = layers * 4;
  const rowOf = (r: number, layer: number): number[] => Array.from(out.subarray(r * row + layer * 4, r * row + layer * 4 + 4));
  const respOf = (f: number): number[] => Array.from(response.subarray(f * 4, f * 4 + 4));
  const colOf = (f: number): number[] => Array.from(colour.subarray(f * 4, f * 4 + 4));
  const eq = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
  const zero = [0, 0, 0, 0];
  ok(filed === 4 && out.length >> 3 === layers, `the lookup holds out.length / 8 layers (${layers}) in two rows, and files a layer for every family's child it can (${filed}: a family past the table and a layer past the lookup left out)`);
  ok(eq(rowOf(0, 0), respOf(1)) && eq(rowOf(0, 3), respOf(1)) && eq(rowOf(0, 1), respOf(2)) && eq(rowOf(0, 5), respOf(4)), "row 0 holds each layer's family's response bytes (moves, heals, gives, dust)");
  ok(eq(rowOf(1, 0), colOf(1)) && eq(rowOf(1, 3), colOf(1)) && eq(rowOf(1, 1), colOf(2)), "row 1 its family's colour bytes, never written over row 0");
  ok(eq(rowOf(1, 5), zero) && eq(rowOf(0, 5), respOf(4)), 'a family outside the colour table leaves its layer\'s colour row at nought, its response row filed');
  ok(eq(rowOf(0, 2), zero) && eq(rowOf(1, 2), zero) && eq(rowOf(0, 4), zero) && eq(rowOf(1, 4), zero), 'a layer no family names (or only one past the response table) is nought in both rows: nothing blows over it');
  const plain = new Uint8Array(layers * 8).fill(5);
  fillLayerResponse(childLayers, response, plain);
  ok(eq(Array.from(plain.subarray(0, row)), Array.from(out.subarray(0, row))) && plain.subarray(row).every((v) => v === 0), 'with no colour table, row 0 the same and row 1 all nought');
}

// --- every world on disk ---
const worlds = groundWorlds();
if (!worlds.length) note(`no converted worlds under ${PACKS}: the fixture above stands in for them`);
const seen = new Set<string>();
let families = 0;
for (const w of worlds) {
  let template;
  try {
    template = parseTerrainTemplate(new Uint8Array(readFileSync(join(PACKS, w, 'terrain.trn'))));
  } catch (err) {
    note(`${w}: its terrain could not be read (${String(err)})`);
    continue;
  }
  const group = template.generator.shaderGroup;
  const fallbacks: string[] = [];
  const byDecider: Record<string, number> = {};
  for (const f of group.families.values()) {
    families++;
    seen.add(f.name);
    seen.add(`${w}:${f.id}`);
    const c = classifyFamily(w, f);
    byDecider[c.by] = (byDecider[c.by] ?? 0) + 1;
    if (c.by === 'fallback') fallbacks.push(`${f.id} ${f.name}`);
  }
  ok(fallbacks.length === 0, `${w}: every one of its ${group.families.size} families is decided by an override, a surface or a rule (${Object.entries(byDecider).map(([k, v]) => `${k} ${v}`).join(', ')})${fallbacks.length ? `; fell back: ${fallbacks.join('; ')}` : ''}`);
}
if (worlds.length) {
  for (const key of Object.keys(GROUND_OVERRIDES)) ok(seen.has(key), `the override "${key}" names a family a pack holds`);
  note(`${families} families over ${worlds.length} worlds`);
}

console.log(`\n${checks} checks passed`);
