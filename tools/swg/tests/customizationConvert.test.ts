// The creator's own table (`customization`, tools/swg/customization.mjs): the client's creator tables
// joined into characters/customization.json.
//
// First the join on made-up tables, where every column can be seen to land where it should and the
// client's interface palette can be seen never to be opened. Then, where this machine has the client
// (SWG in the environment or in .env), the real command is run into a folder of its own and its file is
// read back against the archives and, where they are converted, the species packs. Nothing here quotes
// the client's words: a row's label is compared with the string table's own entry for it.
//
// Run: node tools/swg/tests/customizationConvert.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUSTOMIZATION_FILE, CUSTOMIZATION_FORMAT, PALETTE_SKIP, buildCustomization, customizationStatus, itemIdOf } from '../customization.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

// ---------------------------------------------------------------- the join, on made-up tables

{
  const opened: string[] = [];
  const tables: Record<string, { rows: Record<string, unknown>[] }> = {
    'datatables/customization/customization_data.iff': {
      rows: [
        { SPECIES_GENDER: 'a_male', CUSTOMIZATION_GROUP: 'body', TYPE: 'hslider', CUSTOMIZATION_NAME: 'height', VARIABLES: '', IS_SCALE: 1, RAMDOMIZABLE: 1, RANDOMIZABLE_GROUP: 0 },
        { SPECIES_GENDER: 'a_male', CUSTOMIZATION_GROUP: 'body', TYPE: 'hslider', CUSTOMIZATION_NAME: 'weight', VARIABLES: 'blend_skinny,blend_fat', RAMDOMIZABLE: 1, RANDOMIZABLE_GROUP: 2 },
        { SPECIES_GENDER: 'a_male', CUSTOMIZATION_GROUP: 'body', TYPE: 'hslider', CUSTOMIZATION_NAME: 'chest', VARIABLES: 'blend_flat_chest', REVERSE: 1 },
        { SPECIES_GENDER: 'a_male', CUSTOMIZATION_GROUP: 'body', TYPE: 'color', CUSTOMIZATION_NAME: 'skin', VARIABLES: 'index_color_skin', COLOR_LINKED_TO_SELF_0: 'index_color_eyeshadow', COLOR_LINKED_TO_SELF_1: 'index_color_lips', CAMERA_YAW: 180 },
        { SPECIES_GENDER: 'a_male', CUSTOMIZATION_GROUP: 'body', TYPE: 'color', CUSTOMIZATION_NAME: 'shadow', VARIABLES: 'index_color_eyeshadow', COLOR_LINKED_TO_SELF_0: '', COLOR_LINKED_TO_SELF_1: 'index_color_lips' },
        { SPECIES_GENDER: 'a_male', CUSTOMIZATION_GROUP: 'face', TYPE: 'hslider', CUSTOMIZATION_NAME: 'age', VARIABLES: 'index_age', DISCRETE: 1 },
        { SPECIES_GENDER: 'a_male', CUSTOMIZATION_GROUP: 'face', TYPE: 'color', CUSTOMIZATION_NAME: 'skin', VARIABLES: 'index_color_skin' },
        { SPECIES_GENDER: 'a_male', CUSTOMIZATION_GROUP: 'hair', TYPE: 'color', CUSTOMIZATION_NAME: 'hair', VARIABLES: 'index_color_1', IS_VAR_HAIR_COLOR: 1 },
        { SPECIES_GENDER: 'a_male', CUSTOMIZATION_GROUP: 'hair', TYPE: 'color', CUSTOMIZATION_NAME: 'beard', VARIABLES: 'index_color_facial_hair', COLOR_LINKED: 'index_color_1' },
        { SPECIES_GENDER: 'b_female', CUSTOMIZATION_GROUP: 'body', TYPE: 'hslider', CUSTOMIZATION_NAME: 'height', VARIABLES: '', IS_SCALE: 1 },
      ],
    },
    'datatables/customization/customization_group_shared.iff': { rows: [{ CUSTOMIZATION_GROUP: 'hair', IS_HAIR: 1, IS_MARKING: 0 }, { CUSTOMIZATION_GROUP: 'face', IS_HAIR: 0, IS_MARKING: 1 }] },
    'datatables/customization/palette_columns.iff': {
      rows: [
        { PALETTE: 'pc_hair_x', CREATION_INDEXES: 20, CREATION_COLUMNS: 5, ID_MASTER_COLUMNS: 16 },
        { PALETTE: 'ui', CREATION_INDEXES: 256, CREATION_COLUMNS: 8, ID_MASTER_COLUMNS: 16 },
        { PALETTE: 'ui_zone', CREATION_INDEXES: 256, CREATION_COLUMNS: 8, ID_MASTER_COLUMNS: 16 },
        { PALETTE: 'wr_cloth_x', CREATION_INDEXES: 256, CREATION_COLUMNS: 8, ID_MASTER_COLUMNS: 16 },
      ],
    },
    'datatables/customization/allow_bald.iff': { rows: [{ SPECIES_GENDER: 'a_male', ALLOW_BALD: 0 }] },
    'datatables/customization/hair_assets_skill_mods.iff': {
      rows: [
        { SHARED_TEMPLATE: 'object/tangible/hair/a/shared_hair_a_male_s01.iff', PLAYER_TEMPLATE: 'object/creature/player/shared_a_male.iff', AVAILABLE_AT_CREATION: 1, SKILL_MOD_VALUE: 1 },
        { SHARED_TEMPLATE: 'object/tangible/hair/a/shared_hair_a_male_s09.iff', PLAYER_TEMPLATE: 'object/creature/player/shared_a_male.iff', AVAILABLE_AT_CREATION: 0, SKILL_MOD_VALUE: 3 },
        { SHARED_TEMPLATE: 'object/tangible/hair/a/shared_hair_a_female_s01.iff', PLAYER_TEMPLATE: 'object/creature/player/shared_a_female.iff', AVAILABLE_AT_CREATION: 1, SKILL_MOD_VALUE: 1 },
      ],
    },
  };
  const words = new Map([['height', 'w-height'], ['skin', 'w-skin'], ['body', 'w-body'], ['hair', 'w-hair']]);
  const { file, counts } = buildCustomization({
    table: (p: string) => tables[p] ?? null,
    strings: () => words,
    palette: (p: string) => {
      opened.push(p);
      return [[1, 2, 3, 255], [4, 5, 6, 255]];
    },
    has: (p: string) => !p.includes('_s09'),
  });
  const a = file.species.a_male;
  ok(file.format === CUSTOMIZATION_FORMAT && Object.keys(file.species).join() === 'a_male,b_female', 'every species in the table, in its order, stamped with the format');
  ok(a.groups.map((g: { id: string }) => g.id).join() === 'body,face,hair' && a.groups[2].hair === true && a.groups[1].marking === true && a.groups[0].label === 'w-body', "the tabs in the table's order, with their hair and marking flags and their words");
  const row = (n: string) => a.rows.find((r: { name: string }) => r.name === n);
  ok(row('height').type === 'scale' && row('weight').type === 'slider' && row('weight').variables.join() === 'blend_skinny,blend_fat', 'the height is the scale and two morphs are one slider');
  ok(row('chest').reverse === true && row('age').type === 'choice' && row('age').discrete === true, 'a reversed slider, and an index variable is a choice in whole steps');
  ok(row('skin').alsoIn.join() === 'face' && a.rows.filter((r: { name: string }) => r.name === 'skin').length === 1, 'a row repeated under another tab is kept once, with the other tab noted');
  ok(row('skin').sets.join() === 'index_color_eyeshadow,index_color_lips' && row('skin').yaw === 180, 'both colours a colour also sets are kept, in their columns\' order, and its camera turn');
  ok(row('shadow').sets.join() === 'index_color_lips', 'a link in the second column alone is kept as well');
  ok(row('hair').onHair === true && row('beard').follows === 'index_color_1', 'a hair colour, and a colour that follows it');
  ok(row('weight').random === 2 && row('height').random === true && !('random' in row('chest')), 'the randomise rules are kept for later');
  ok(row('skin').label === 'w-skin' && row('age').label === null && row('shadow').label === null && counts.words === 4, "a row carries the string table's word where it has one");
  ok(a.bald === false && !('bald' in file.species.b_female), 'the bald rule where the table has one');
  ok(a.hair.length === 2 && a.hair[0].id === 'hair_a_male_s01' && a.hair[0].creation && !a.hair[1].creation && a.hair[1].skill === 3 && a.hair[1].inArchives === false, "the species' own hairstyles with their ids, creation flags, levels and whether the archives have them");
  ok(itemIdOf('object/tangible/hair/human/shared_hair_human_female_s33.iff') === 'hair_human_female_s33', 'a template reads to the id the wardrobe gives it');
  ok(!Object.keys(file.palettes).some((k) => PALETTE_SKIP.test(k)) && counts.skipped.join() === 'ui,ui_zone', "the client's interface palettes are left out by rule");
  ok(!opened.some((p) => /\/ui(_|\.)/.test(p)) && opened.join() === 'palette/pc_hair_x.pal', 'and never even opened; only a creator palette has its colours read');
  ok(file.palettes.pc_hair_x.creation === 20 && file.palettes.pc_hair_x.columns === 5 && file.palettes.pc_hair_x.colors.length === 2 && !file.palettes.wr_cloth_x.colors, "a creator palette's creation range, columns and colours; a garment palette's range alone");
}

// ---------------------------------------------------------------- what status asks

{
  const good = { format: CUSTOMIZATION_FORMAT, species: { human_male: { rows: [{ name: 'color_eyes' }] } }, palettes: {} };
  ok(customizationStatus(null).why !== null, 'no file is asked for');
  ok(customizationStatus({ ...good, format: 0 }).why !== null, 'an older file is asked for again');
  ok(customizationStatus({ ...good, species: { human_male: { rows: [] } } }).why !== null, "a file without the human male's eye colour row is asked for again");
  ok(customizationStatus(good).why === null && /1 species/.test(customizationStatus(good).line), 'a whole one is left alone');

  // And `status` itself asks it: run over a folder holding a species index alone, then that with a whole file beside it.
  const dir = mkdtempSync(join(tmpdir(), 'swg3js-customization-status-'));
  try {
    const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
    mkdirSync(join(dir, 'characters'), { recursive: true });
    writeFileSync(join(dir, 'characters', 'index.json'), JSON.stringify({ species: [{ id: 'human_male', species: 'human', gender: 'male', wardrobe: null, morphs: [], variables: [], jkaClips: true }] }));
    const asks = (): boolean => {
      const run = spawnSync(process.execPath, [cli, 'status', dir], { encoding: 'utf8', maxBuffer: 16 * 1048576 });
      return /swg -- customization /.test(run.stdout ?? '');
    };
    ok(asks(), 'status asks for the creator table where there is a species index and no table');
    writeFileSync(join(dir, ...CUSTOMIZATION_FILE.split('/')), JSON.stringify(good));
    ok(!asks(), 'and asks for nothing of it once a whole one is there');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- the real archives

let swg = process.env.SWG ?? '';
const env = fileURLToPath(new URL('../../../.env', import.meta.url));
if (!swg && existsSync(env)) {
  for (const line of readFileSync(env, 'utf8').split(/\r?\n/)) {
    const m = /^\s*SWG\s*=\s*(.*?)\s*$/.exec(line);
    if (m) swg = m[1].replace(/^(['"])(.*)\1$/, '$2');
  }
}
if (!swg || !existsSync(swg)) note('no SWG install on this machine, so the retail tables are not read here');
else {
  const out = mkdtempSync(join(tmpdir(), 'swg3js-customization-'));
  try {
    const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [cli, 'customization', swg, out, '--retail-only'], { encoding: 'utf8', maxBuffer: 16 * 1048576 });
    ok(run.status === 0, `the command runs (${(run.stdout || run.stderr).trim().split('\n').slice(-2).join(' / ')})`);
    const file = JSON.parse(readFileSync(join(out, ...CUSTOMIZATION_FILE.split('/')), 'utf8'));
    const { openVfs } = await import('../tre.mjs');
    const { isRetailByName } = await import('../manifest.mjs');
    const { parseStringTable } = await import('../datatable.mjs');
    const { parsePalette } = await import('../texrender.mjs');
    const vfs = openVfs(swg, { filter: (f: string) => isRetailByName(f, statSync(join(swg, f)).size) !== null, log: () => {} });
    const words = parseStringTable(vfs.read('string/en/ui_cust.stf')) as Map<string, string>;
    ok(Object.keys(file.species).length === 20, `twenty species and genders (${Object.keys(file.species).length})`);
    const human = file.species.human_male;
    const eyes = human.rows.find((r: { name: string }) => r.name === 'color_eyes');
    ok(!!eyes && eyes.type === 'color' && eyes.variables.join() === 'index_color_2' && eyes.label === words.get('color_eyes'), "the human male's eye colour is his index_color_2, under the string table's own word for it");
    ok(human.rows.find((r: { name: string }) => r.name === 'color_facial_hair')?.follows === 'index_color_1', 'his facial hair follows his hair colour');
    const twilekSkin = file.species.twilek_female.rows.find((r: { name: string }) => r.name === 'color_skin');
    ok(twilekSkin?.sets?.includes('index_color_eyeshadow') && twilekSkin?.sets?.includes('index_color_lips'), `a Twi'lek female's skin sets both her eye shadow and her lips, the second link column read as well as the first (${twilekSkin?.sets?.join(', ')})`);
    for (const sp of ['zabrak', 'twilek', 'trandoshan']) ok(file.species[`${sp}_male`].bald === false && file.species[`${sp}_female`].bald === false, `a ${sp} may not go bald`);
    ok(file.species.human_male.bald === true && file.species.human_female.bald === true, 'a human may');
    ok(!Object.keys(file.palettes).some((k) => /^ui/.test(k)), "no interface palette is in the file");
    const hairPal = file.palettes.pc_hair_hum;
    ok(hairPal.creation === 20 && hairPal.columns === 5, 'the human hair palette offered twenty colours at creation, in five columns');
    ok(hairPal.colors.length === parsePalette(vfs.read('palette/pc_hair_hum.pal')).length, "and carries every one of the palette's colours");
    ok(Object.entries(file.palettes).every(([k, p]) => !/^pc_/.test(k) || ((p as { colors?: unknown[] }).colors?.length ?? 0) > 0), 'every creator palette carries its colours');
    const missing = Object.values(file.species).flatMap((s) => ((s as { hair?: { inArchives: boolean; id: string }[] }).hair ?? []).filter((h) => !h.inArchives).map((h) => h.id));
    ok(missing.length === 2, `two of the hairstyles the table names are not in the archives (${missing.join(', ')})`);

    // Against the species packs, where they are converted.
    const root = fileURLToPath(new URL('../../../assets-private/', import.meta.url));
    if (!existsSync(join(root, 'characters', 'index.json'))) note('no species packs on this machine, so the rows are not joined to them');
    else {
      const { recipeVariableDefs } = await import('../../../src/player/texrender.ts');
      const index = JSON.parse(readFileSync(join(root, 'characters', 'index.json'), 'utf8')) as { species: { id: string; species: string; gender: string; wardrobe: string | null }[] };
      const bare = (n: string) => n.replace(/^.*\//, '');
      const hairVars = new Map<string, Set<string>>();
      const hairOf = (w: string, species: string) => {
        const key = `${w}:${species}`;
        if (hairVars.has(key)) return hairVars.get(key)!;
        const wardrobe = JSON.parse(readFileSync(join(root, 'wardrobe', w, 'wardrobe.json'), 'utf8')) as { items: { kind: string; template: string; parts: { name: string }[] }[] };
        const meshes = new Set(wardrobe.items.filter((i) => i.kind === 'hair' && i.template.includes(`/hair/${species}/`)).flatMap((i) => i.parts.map((p) => p.name)));
        const cz = JSON.parse(readFileSync(join(root, 'wardrobe', w, 'customize.json'), 'utf8')) as { recipes: { mesh: string }[] };
        const names = new Set<string>();
        for (const r of cz.recipes) if (meshes.has(r.mesh)) for (const d of recipeVariableDefs(r as never)) names.add(bare(d.name));
        hairVars.set(key, names);
        return names;
      };
      const lost: string[] = [];
      const untabled: string[] = [];
      for (const sp of index.species) {
        const entry = file.species[sp.id];
        if (!entry) continue;
        const parts = JSON.parse(readFileSync(join(root, 'characters', sp.id, 'parts.json'), 'utf8')) as { parts: { name: string; body?: boolean; morphs?: string[] }[]; defaultWear?: string[] };
        const dress = new Set(parts.defaultWear ?? []);
        const morphs = new Set(parts.parts.filter((p) => p.body || dress.has(p.name)).flatMap((p) => p.morphs ?? []));
        const cz = JSON.parse(readFileSync(join(root, 'characters', sp.id, 'customize.json'), 'utf8')) as { recipes: { mesh: string }[] };
        const body = new Set(parts.parts.filter((p) => p.body).map((p) => p.name));
        const vars = new Set<string>();
        for (const r of cz.recipes) if (body.has(r.mesh)) for (const d of recipeVariableDefs(r as never)) vars.add(bare(d.name));
        const hair = sp.wardrobe ? hairOf(sp.wardrobe, sp.species) : new Set<string>();
        for (const r of entry.rows as { name: string; type: string; variables: string[]; onHair?: boolean }[]) {
          if (r.type === 'scale') continue;
          for (const v of r.variables) if (!morphs.has(v) && !vars.has(v) && !(r.onHair && hair.has(v))) lost.push(`${sp.id}:${r.name}:${v}`);
        }
        const named = new Set((entry.rows as { variables: string[] }[]).flatMap((r) => r.variables));
        for (const m of morphs) if (!named.has(m)) untabled.push(`${sp.id}:${m}`);
      }
      ok(lost.length === 0, `every row's variables are in its species' pack, its dress or its hairstyles${lost.length ? `: ${lost.slice(0, 6).join(', ')}` : ''}`);
      // The research's measurement, over the body and its own dress: nine morphs no row names.
      const NINE = ['moncal_female:blend_ear_0', 'moncal_female:blend_ear_1', 'moncal_female:blend_flat_chest', 'trandoshan_female:blend_flat_chest', 'wookiee_female:blend_flat_chest', 'wookiee_female:blend_nosedepth_0', 'wookiee_female:blend_nosedepth_1', 'wookiee_male:blend_nosedepth_0', 'wookiee_male:blend_nosedepth_1'];
      ok(untabled.length === NINE.length && NINE.every((m) => untabled.includes(m)), `and the pack's morphs no row names are the nine documented ones (${untabled.join(', ')})`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

console.log(`\ncustomization: ${passed} checks passed`);
