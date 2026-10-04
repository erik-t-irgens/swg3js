// What a customization colour is called on the appearance page: the head's "Color 2" is the eyes.
//
// The fix round's item. The label was the variable's name with its prefix off, and the game numbers
// most of its colour variables, keeping the meaning in the palette the shader reads -- the human
// head's private `index_color_2` is read by `shader/hum_m_mouth.sht` from `palette/pc_eye_hum.pal`, so
// the eyes read "Color 2". The fallback built here (no conversion) names a palette variable by its own
// words where it has any, by its palette's family, or by the texture slot it tints.
//
// The rules run here on their own, and then over every recipe of every converted customize.json on
// this machine through the game's own `recipeVariableDefs`, which is exactly what the page is handed
// (a machine with no packs says so and checks the rules alone).
//
// Run: node tools/swg/tests/variableLabel.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { distinctLabels, paletteFamily, plainLabel, tagLabel, variableLabel } from '../../../src/ui/variableLabel.ts';
import { recipeVariableDefs, type Recipe } from '../../../src/player/texrender.ts';
import { packColours } from '../../../src/ui/creatorModel.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ---------------------------------------------------------------- the rules

{
  ok(variableLabel({ name: '/private/index_color_2', palette: 'palette/pc_eye_hum.pal', tag: 'MAIN' }) === 'Eye Color', "the human head's index_color_2 on the eye palette is the Eye Color");
  ok(variableLabel({ name: 'index_color_2' }) === 'Color 2', 'with nothing to go on it reads as it always did');
  ok(variableLabel({ name: 'index_color_skin', palette: 'palette/pc_skin_hum.pal' }) === 'Skin Color', 'a variable that says what it is, is called that');
  ok(variableLabel({ name: '/private/index_color_facial_hair', palette: 'palette/pc_hair_hum.pal' }) === 'Facial Hair Color', "the variable's own words win over its palette's (facial hair reads the hair palette)");
  ok(variableLabel({ name: 'index_color_pattern', palette: 'palette/pc_skin_twk_leccu.pal' }) === 'Pattern Color', "and a twi'lek's lekku pattern is a pattern, not its skin");
  ok(variableLabel({ name: 'index_color_skin_1', palette: 'palette/npc_toydarian1.pal' }) === 'Skin Color', 'a numbered word is still the word');
  ok(variableLabel({ name: '/private/index_color_1', palette: 'palette/wr_cloth_general.pal', tag: 'MAIN' }) === 'Main Color', "a garment's general palette says nothing, so the slot it tints names it");
  ok(variableLabel({ name: '/private/index_color_2', palette: 'palette/wr_cloth_general.pal', tag: 'HUEB' }) === 'Second Color', 'MAIN is the main colour and HUEB the second');
  ok(tagLabel('bp:MAIN') === 'Main Color' && tagLabel('SPEC') === null, "a blueprint's slot reads the same, and a slot with no colour of its own names nothing");
  ok(paletteFamily('palette/pc_skin_wke.pal') === 'Fur Color', 'the Wookiee skin palette is fur');
  ok(paletteFamily('palette/pc_skin_rod_spot.pal') === 'Spot Color', "a Rodian's spot palette is spots before it is skin");
  ok(paletteFamily('palette/pc_horns_zab_b.pal') === 'Horn Color', "a Zabrak's horns");
  ok(paletteFamily('palette/pc_tat_zab.pal') === 'Tattoo Color' && paletteFamily('palette/pc_lips_hum.pal') === 'Lip Color', 'tattoos and lips');
  ok(paletteFamily('palette/npc_chiss_eyes.pal') === 'Eye Color', "an NPC's eye palette is eyes too");
  ok(paletteFamily('palette/wr_leather.pal') === null && paletteFamily('palette/stormtrooper.pal') === null && paletteFamily(undefined) === null, 'a palette that says nothing about what it colours has no family');
  ok(plainLabel('blend_jaw') === 'Jaw' && plainLabel('/shared_owner/index_texture_1') === 'Texture 1', 'a shape or a choice keeps the name it always had');
  ok(distinctLabels([{ name: 'index_color_1', palette: 'palette/pc_skin_wke.pal' }, { name: 'index_color_3', palette: 'palette/pc_skin_wke.pal' }]).join('|') === 'Fur Color|Fur Color 2', "two colours of one name in a section are numbered rather than shown twice");
}

// ---------------------------------------------------------------- the page names its rows by these rules
//
// The appearance page and the customizer cannot load under node, so their source is read: put back to
// the variable's bare name, every rule above would still pass and the eyes would read "Color 2" again.

{
  const read = (rel: string) => readFileSync(new URL(`../../../src/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const page = read('ui/appearanceUi.ts');
  const customizer = read('player/customizer.ts');
  ok(/import \{ distinctLabels[^}]*\} from '\.\/variableLabel\.ts';/.test(page), 'the appearance page takes its colour names from variableLabel.ts');
  ok(/const names = distinctLabels\(colours\);/.test(page) && /row\(v, names\[colours\.indexOf\(v\)\] \?\? ''\)/.test(page), "each section's colours are named together, a second of one name numbered, and each row handed its own");
  ok(/const label = v\.kind === 'palette' \? named : prettyMorph\(short\);/.test(page), 'and a palette row wears that name, where it wore the variable\'s bare name');
  // Which rows the page draws without the creator's table is `packColours`, a pure function, so it is run here.
  ok(/packColours\(\{/.test(page), "the page's rows without the creator's table come from packColours");
  const { rows } = packColours({
    live: [{ key: 'shirt|/private/index_color_1', name: '/private/index_color_1', private: true, mesh: 'shirt', default: 0, kind: 'palette', palette: 'palette/wr_x.pal', tag: 'HUEB', colors: [[1, 2, 3]] }],
    manifest: [
      { name: '/private/index_color_1', private: true, kind: 'palette', default: 0, palette: 'palette/merged.pal', colors: [[1, 2, 3]], meshes: ['shirt'] },
      { name: '/shared_owner/index_color_skin', private: false, kind: 'palette', default: 0, palette: 'palette/pc_skin_x.pal', colors: [[4, 5, 6]] },
    ],
    worn: new Set(['shirt']),
    isLinked: () => false,
    morphs: [],
  });
  const shirt = rows.find((r) => r.key === 'shirt|/private/index_color_1');
  ok(!!shirt && shirt.live && shirt.palette === 'palette/wr_x.pal' && shirt.tag === 'HUEB', "a live row carries the palette and the slot the customizer read it on, which are what name it");
  const skin = rows.find((r) => r.key === '/shared_owner/index_color_skin');
  ok(!!skin && !skin.live && skin.palette === 'palette/pc_skin_x.pal', "and a row only the manifest lists carries the manifest's palette");
  ok(/\.\.\.\(d\.tag \? \{ tag: d\.tag \} : \{\}\)/.test(customizer), "the customizer hands each variable's slot on from the recipe");
}

// ---------------------------------------------------------------- every converted recipe on this machine

const root = new URL('../../../assets-private/', import.meta.url);
const files: string[] = [];
function walk(dir: string): void {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n === 'customize.json') files.push(p);
  }
}
const characters = join(root.pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'characters');
const mobiles = join(root.pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'mobiles');
if (existsSync(characters)) walk(characters);
if (existsSync(mobiles)) walk(mobiles);

if (!files.length) {
  console.log('note no converted customize.json on this machine: the rules alone were checked (run the species command to check the packs)');
} else {
  let rows = 0;
  let eyes = 0;
  let eyesRight = 0;
  let numbered = 0;
  let speciesHeads = 0;
  const wrongEyes: string[] = [];
  const stillNumbered: string[] = [];
  for (const f of files) {
    const pack = JSON.parse(readFileSync(f, 'utf8')) as { recipes?: Recipe[] };
    const species = /[\\/]characters[\\/]/.test(f);
    for (const r of pack.recipes ?? []) {
      for (const d of recipeVariableDefs(r)) {
        if (d.kind !== 'palette') continue;
        rows++;
        const label = variableLabel({ name: d.name, palette: d.palette, tag: d.tag });
        const stem = (d.palette ?? '').replace(/^.*\//, '');
        if (/(^|_)eyes?(_|\.)/.test(stem)) {
          eyes++;
          if (label === 'Eye Color') eyesRight++;
          else wrongEyes.push(`${f.replace(/^.*assets-private[\\/]/, '')} ${r.mesh} ${d.name} -> ${label}`);
        }
        // Read off a species pack (the player's own bodies): nothing on them reads as a bare number now.
        if (species && /^Color \d+$/.test(label)) {
          numbered++;
          stillNumbered.push(`${f.replace(/^.*assets-private[\\/]/, '')} ${r.mesh} ${d.name} ${stem} ${d.tag ?? '?'}`);
        }
        if (species && /_head_l\d/.test(r.mesh) && /pc_eye_/.test(stem)) speciesHeads++;
      }
    }
  }
  console.log(`note ${files.length} customize.json files, ${rows} palette variables read`);
  ok(rows > 100, `the packs were read (${rows} palette variables)`);
  ok(eyes > 0 && eyesRight === eyes, `every variable read from an eye palette is called Eye Color (${eyesRight} of ${eyes})${wrongEyes.length ? `: ${wrongEyes.slice(0, 3).join('; ')}` : ''}`);
  ok(speciesHeads > 0, `and the species' heads carry them (${speciesHeads})`);
  ok(numbered === 0, `no colour on a player body reads as a bare number any more${stillNumbered.length ? `: ${stillNumbered.slice(0, 4).join('; ')}` : ''}`);
  // The case the owner saw, named exactly.
  const human = files.find((f) => /[\\/]characters[\\/]human_male[\\/]customize\.json$/.test(f));
  if (human) {
    const pack = JSON.parse(readFileSync(human, 'utf8')) as { recipes?: Recipe[] };
    const head = (pack.recipes ?? []).filter((r) => /^hum_m_head_l\d/.test(r.mesh));
    const eye = head.flatMap((r) => recipeVariableDefs(r)).find((d) => d.kind === 'palette' && /pc_eye_hum/.test(d.palette ?? ''));
    ok(!!eye && /index_color_2$/.test(eye.name), "the human male head's eye colour is its index_color_2, as measured");
    ok(!!eye && eye.tag === 'MAIN', 'read on its MAIN slot, which the page is now handed');
    ok(!!eye && variableLabel({ name: eye.name, palette: eye.palette, tag: eye.tag }) === 'Eye Color', 'and the page calls it Eye Color, where it said Color 2');
  }
}

console.log(`\n${passed} checks passed`);
