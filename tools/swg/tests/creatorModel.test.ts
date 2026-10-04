// The appearance page as the game's creator laid it out (src/ui/creatorModel.ts): which rows show, which
// customizer keys each one writes, which follow, which are dropped and which stand in the group of ours.
//
// Run first over a small made-up species that has one of everything, then over every species converted
// on this machine with the table the `customization` command wrote, through the game's own customizer:
// the species' and the wardrobe's customize.json are fed to a real `Customizer` through a stand-in for
// `fetch`, its materials are the ones the body (and the worn hair) would have on, and `variables()` is
// exactly what the page is handed. A machine with neither says so and checks the made-up species alone.
//
// Nothing here quotes the client's words: a row is checked against the label the table carries for it.
//
// Run: node tools/swg/tests/creatorModel.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CREATOR_TUNE, CUSTOMIZATION_FORMAT, DYE_PALETTE, UNTABLED_GROUP, bareName, creatorView, hairNone, oneColour, ownSection, packColours, packSliders, pickWrites, readableTable, swatchLayout, type CreatorSpecies, type CreatorState, type CreatorTable, type CreatorVariable, type CreatorView } from '../../../src/ui/creatorModel.ts';
import { CUSTOMIZATION_FORMAT as CONVERTER_FORMAT } from '../customization.mjs';
import { Customizer } from '../../../src/player/customizer.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

ok(CUSTOMIZATION_FORMAT === CONVERTER_FORMAT, 'the page reads exactly the format the converter writes');

// ---------------------------------------------------------------- a made-up species with one of everything

const SKIN = '/shared_owner/index_color_skin';
const v = (key: string, name: string, priv: boolean, mesh: string, extra: Partial<CreatorVariable> = {}): CreatorVariable => ({ key, name, private: priv, mesh, default: 0, kind: 'palette', colors: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], ...extra });
// The groups are deliberately not in alphabetical order, so a view that sorted them would be caught here
// as well as on the real packs.
const FIXTURE: CreatorSpecies = {
  bald: true,
  groups: [
    { id: 'eyes', label: 'g:eyes' },
    { id: 'body', label: 'g:body' },
    { id: 'empty', label: 'g:empty' },
    { id: 'hair', label: 'g:hair', hair: true },
  ],
  rows: [
    { name: 'muscle', label: 'r:muscle', group: 'body', type: 'slider', variables: ['blend_muscle'] },
    { name: 'height', label: 'r:height', group: 'body', type: 'scale', variables: [] },
    { name: 'chest', label: 'r:chest', group: 'body', type: 'slider', variables: ['blend_muscle'] },
    { name: 'weight', label: 'r:weight', group: 'body', type: 'slider', variables: ['blend_skinny', 'blend_fat'] },
    { name: 'flat', label: 'r:flat', group: 'body', type: 'slider', variables: ['blend_flat_chest'], reverse: true },
    { name: 'color_skin', label: 'r:skin', group: 'body', alsoIn: ['eyes'], type: 'color', variables: ['index_color_skin'], sets: ['index_color_lips'] },
    { name: 'color_eyes', label: 'r:eyes', group: 'eyes', type: 'color', variables: ['index_color_2'] },
    { name: 'brow', label: 'r:brow', group: 'eyes', type: 'slider', variables: ['blend_brow_0', 'blend_brow_1'], discrete: true },
    { name: 'color_lip', label: 'r:lips', group: 'eyes', type: 'color', variables: ['index_color_lips'] },
    { name: 'nothing', label: 'r:nothing', group: 'empty', type: 'color', variables: ['index_color_absent'] },
    { name: 'color_hair', label: 'r:hair', group: 'hair', type: 'color', variables: ['index_color_1'], onHair: true },
    // The Zabrak's horns: the same bare name as the eyes, on the hair object, and so not a second copy of them.
    { name: 'color_horns', label: 'r:horns', group: 'hair', type: 'color', variables: ['index_color_2'], onHair: true },
    { name: 'color_facial_hair', label: 'r:beard', group: 'hair', type: 'color', variables: ['index_color_facial_hair'], follows: 'index_color_1' },
  ],
};
const VARS: CreatorVariable[] = [
  v(SKIN, SKIN, false, ''),
  v('head|/private/index_color_skin', '/private/index_color_skin', true, 'head'),
  v('head|/private/index_color_2', '/private/index_color_2', true, 'head'),
  v('head|/private/index_color_lips', '/private/index_color_lips', true, 'head'),
  v('head|/private/index_color_facial_hair', '/private/index_color_facial_hair', true, 'head'),
  v('body|/private/index_color_3', '/private/index_color_3', true, 'body', { colors: [[213, 213, 213], [213, 213, 213]] }),
  v('body|/private/index_color_9', '/private/index_color_9', true, 'body'),
  v('wig|/private/index_color_1', '/private/index_color_1', true, 'wig'),
  v('wig|/private/index_color_2', '/private/index_color_2', true, 'wig'),
  v('shirt|/private/index_color_1', '/private/index_color_1', true, 'shirt'),
  // A garment's colour whose bare name no row names, so only the rule that keeps the body's untabled
  // colours to the body can keep it out of the group of ours.
  v('shirt|/private/index_color_7', '/private/index_color_7', true, 'shirt'),
];
const MORPHS = { blend_muscle: 0, blend_skinny: 0, blend_fat: 0, blend_flat_chest: 0, blend_brow_0: 0, blend_brow_1: 0, blend_ear_0: 0, blend_ear_1: 0, blend_jacket_belt: 0 };
const state = (hair: string[], extra: Partial<CreatorState> = {}): CreatorState => ({ morphs: MORPHS, bodyMorphs: ['blend_muscle', 'blend_skinny', 'blend_fat', 'blend_flat_chest', 'blend_brow_0', 'blend_brow_1', 'blend_ear_0', 'blend_ear_1'], variables: VARS, bodyMeshes: ['body', 'head'], hairMeshes: hair, hasHairObjects: true, ...extra });
const rowOf = (view: CreatorView, name: string) => view.groups.flatMap((g) => g.rows).find((r) => r.name === name);
{
  const view = creatorView(FIXTURE, state(['wig']))!;
  ok(!!view, 'a species row gives a view');
  ok(view.groups.map((g) => g.id).join() === `eyes,body,hair,${UNTABLED_GROUP}`, "the groups come in the table's order (not sorted), the one with nothing to show is left out, and ours stands last");
  ok(view.duplicates.join() === 'chest' && !rowOf(view, 'chest'), 'a row whose variables are an earlier row\'s is dropped');
  const horns = rowOf(view, 'color_horns');
  ok(!!horns && horns.keys.join() === 'wig|/private/index_color_2,hair|index_color_2' && view.groups.find((g) => g.id === 'hair')!.rows.includes(horns), "a colour on the hair sharing a bare name with the eyes is not a copy of them: it shows under its own tab and writes the hair's key");
  ok(rowOf(view, 'color_eyes')!.keys.join() === 'head|/private/index_color_2', "and the eyes still write the head's alone");
  const weight = rowOf(view, 'weight')!;
  ok(weight.type === 'slider' && weight.lo === 'blend_skinny' && weight.hi === 'blend_fat', 'two morphs are one slider, the first its low end');
  ok(rowOf(view, 'flat')!.reverse === true && rowOf(view, 'flat')!.hi === 'blend_flat_chest', 'a slider that runs the other way says so');
  const brow = rowOf(view, 'brow')!;
  ok(brow.discrete === true && brow.lo === 'blend_brow_0' && brow.hi === 'blend_brow_1' && !weight.discrete, 'a slider the game moved in whole steps says so, and one it did not does not');
  const skin = rowOf(view, 'color_skin')!;
  ok(skin.keys[0] === SKIN && skin.keys.includes('head|/private/index_color_skin'), "a body colour writes the shared key first, then every body mesh's private copy");
  ok(skin.shows?.key === SKIN, 'and shows the shared palette');
  ok(skin.sets.join() === 'head|/private/index_color_lips', 'the colours it also sets are resolved to their keys');
  ok(view.groups.filter((g) => g.rows.some((r) => r.name === 'color_skin')).length === 1, 'a row in two tabs shows once, in its first');
  ok(rowOf(view, 'color_eyes')!.keys.join() === 'head|/private/index_color_2' && rowOf(view, 'color_eyes')!.label === 'r:eyes', "the head's index_color_2 is the eye row, by the table's own label");
  const hair = rowOf(view, 'color_hair')!;
  ok(hair.keys.join() === 'wig|/private/index_color_1,hair|index_color_1', "a hair colour writes the worn hair's key and the remembered one, and never a garment's of the same name");
  ok(!rowOf(view, 'color_facial_hair') && view.following.some((f) => f.row === 'color_facial_hair' && f.follows === 'index_color_1'), 'the facial hair is not shown while the hair colour is');
  ok(hair.followers.join() === 'head|/private/index_color_facial_hair', 'and a hair pick writes the facial hair too');
  ok(view.unresolved.includes('nothing'), 'a row whose variable the character lacks is said not to resolve');
  ok(view.hidden.some((h) => h.key === 'body|/private/index_color_3' && /one colour/.test(h.why)), 'a body colour on a palette of one colour is hidden');
  const ours = view.groups.find((g) => g.id === UNTABLED_GROUP)!.rows;
  ok(ours.some((r) => r.lo === 'blend_ear_0' && r.hi === 'blend_ear_1') && ours.some((r) => r.keys.includes('body|/private/index_color_9')), 'a body morph pair and a body colour no row names stand in the group of ours');
  ok(!ours.some((r) => r.hi === 'blend_jacket_belt') && view.hidden.some((h) => h.key === 'blend_jacket_belt'), "and a garment's own fit morph is left out");
  ok(!view.taken.has('shirt|/private/index_color_1') && view.taken.has('head|/private/index_color_facial_hair'), "a garment's colours are left to their own section, a follower's are taken");
  const SHIRT_7 = 'shirt|/private/index_color_7';
  ok(!view.taken.has(SHIRT_7) && !ours.some((r) => r.keys.includes(SHIRT_7)) && !view.hidden.some((h) => h.key === SHIRT_7), "and one whose bare name no row names is neither taken, nor put in the group of ours, nor hidden");
  ok(ownSection(view, { key: SHIRT_7, private: true, mesh: 'shirt' }) && ownSection(view, { key: 'shirt|/private/index_color_1', private: true, mesh: 'shirt' }), 'so both stand in the shirt\'s own section after the groups');
  ok(!ownSection(view, { key: 'body|/private/index_color_3', private: true, mesh: 'body' }) && !ownSection(view, { key: 'wig|/private/index_color_1', private: true, mesh: 'wig' }) && !ownSection(view, { key: SKIN, private: false, mesh: '' }), "while the body's own, a hair colour a row took and a shared colour do not");
  // A pick: the row's keys, then its followers', then (with linkSelf) what it also sets.
  ok(pickWrites(hair).join() === 'wig|/private/index_color_1,hair|index_color_1,head|/private/index_color_facial_hair', 'a hair pick writes the hair, the remembered colour, then the facial hair that follows it');
  ok(pickWrites(skin, { ...CREATOR_TUNE, linkSelf: true }).join() === `${SKIN},head|/private/index_color_skin,head|/private/index_color_lips`, 'a skin pick writes the skin, then the lips it sets');
  ok(pickWrites(skin, { ...CREATOR_TUNE, linkSelf: false }).join() === `${SKIN},head|/private/index_color_skin`, 'and with linkSelf off, the skin alone');
}
{
  const bald = creatorView(FIXTURE, state([]))!;
  ok(!rowOf(bald, 'color_hair') && bald.unresolved.includes('color_hair'), 'bald, the hair colour has nothing to write and does not show');
  ok(rowOf(bald, 'color_facial_hair')?.keys.join() === 'head|/private/index_color_facial_hair', 'and the facial hair shows on its own');
  ok(bald.groups.some((g) => g.id === 'hair'), "the hair tab stays for the style picker while the species has hairstyles");
  const none = creatorView({ ...FIXTURE, groups: FIXTURE.groups }, state([], { hasHairObjects: false, variables: VARS.filter((x) => !/facial/.test(x.key)) }))!;
  ok(!none.groups.some((g) => g.id === 'hair'), 'and goes when it has none and nothing to show');
  const off = creatorView(FIXTURE, state(['wig']), { ...CREATOR_TUNE, untabledGroup: false })!;
  ok(!off.groups.some((g) => g.id === UNTABLED_GROUP) && off.hidden.some((h) => /switched off/.test(h.why)), 'the group of ours can be switched off');
  ok(creatorView(null, state([])) === null && creatorView(undefined, state([])) === null, 'no species row, no view: the page draws itself as it did before the table');
}
{
  const table: CreatorTable = { format: 1, source: '', species: {}, palettes: { pc_hair_x: { creation: 20, columns: 5, master: 16 }, pc_eye_x: { creation: 12, columns: 0, master: 16 } } };
  const a = swatchLayout('palette/pc_hair_x.pal', 256, table);
  ok(a.creation === 20 && a.columns === 5 && a.more === 236 && a.moreColumns === CREATOR_TUNE.moreColumns, "the creation block in the game's own columns, then every other colour");
  ok(swatchLayout('palette/pc_eye_x.pal', 256, table).columns === CREATOR_TUNE.fallbackColumns, 'a palette with no columns of its own takes ours');
  const w = swatchLayout('palette/wr_cloth_general.pal', 256, table);
  ok(w.creation === 256 && w.more === 0 && w.columns === CREATOR_TUNE.moreColumns, 'a palette the table says nothing about is one block');
  ok(oneColour([[213, 213, 213], [213, 213, 213]]) && !oneColour([[1, 1, 1], [2, 2, 2]]) && !oneColour(undefined), 'a palette of one colour is told from one of two');
  ok(readableTable({ format: 1, species: {}, palettes: {} }) && !readableTable({ format: CUSTOMIZATION_FORMAT + 1, species: {}, palettes: {} }) && !readableTable(null), 'a file newer than the code is not read');
  ok(bareName('hum_m_head_l0|/private/index_color_2') === 'index_color_2' && bareName('/shared_owner/index_color_skin') === 'index_color_skin', 'a key reads back to its bare name');
}

// ---------------------------------------------------------------- the bald rule

{
  ok(hairNone({ bald: true }, true, false) === 'offer' && hairNone({ bald: true }, true, true) === 'offer', 'a species that may go bald is offered no hair');
  ok(hairNone({ bald: false }, true, true) === 'left out', 'one that may not, wearing a style, is not');
  ok(hairNone({ bald: false }, true, false) === 'shown', 'and one already wearing none is told so without being offered it');
  ok(hairNone(null, true, true) === 'offer' && hairNone({}, true, true) === 'offer' && hairNone({ bald: false }, false, false) === 'offer', 'no table, no rule for the species, or no styles to pick between: none is offered, as before');
}

// ---------------------------------------------------------------- the page without the table

{
  const sliders = packSliders(['blend_fat', 'blend_jaw_1', 'blend_jaw_0', 'blend_ear_0', 'blend_skinny']);
  ok(sliders.map((s) => `${s.name}:${s.lo ?? ''}:${s.hi}`).join() === 'blend_ear_0::blend_ear_0,blend_fat::blend_fat,blend_jaw:blend_jaw_0:blend_jaw_1,blend_skinny::blend_skinny', 'a pack\'s sliders are sorted, an _0/_1 pair is one slider, and an _0 without its _1 runs on its own');
  const live: CreatorVariable[] = [
    v(SKIN, SKIN, false, ''),
    v('head|/private/index_color_skin', '/private/index_color_skin', true, 'head'),
    v('head|/private/index_color_2', '/private/index_color_2', true, 'head'),
    v('shirt|/private/index_color_1', '/private/index_color_1', true, 'shirt'),
    v('hat|/private/index_color_1', '/private/index_color_1', true, 'hat'),
    v('blend_fat', 'blend_fat', false, '', { kind: 'index', count: 3, colors: undefined }),
  ];
  const isLinked = (k: string) => k === 'head|/private/index_color_skin';
  const manifest = [{ name: '/shared_owner/index_color_tattoo', private: false, kind: 'palette' as const, default: 0, colors: [[1, 1, 1]] }];
  const all = packColours({ live, manifest, worn: new Set(['head', 'shirt']), isLinked, morphs: ['blend_fat', 'blend_jaw_0'] });
  ok(all.shared.map((r) => r.key).join() === `${SKIN},/shared_owner/index_color_tattoo`, "the owner's own section holds the shared colours, a slider's own blend left to the slider and the manifest's dead row kept");
  ok(all.shared.find((r) => r.key === SKIN)!.live && !all.shared.find((r) => /tattoo/.test(r.key))!.live, 'a live row is live and the manifest-only one is not');
  ok([...all.byMesh.keys()].join() === 'head,shirt' && all.byMesh.get('head')!.map((r) => r.key).join() === 'head|/private/index_color_2', "each worn piece has its own section, a private copy of a shared colour is never on its own, and a piece not worn has none");
  const kept = packColours({ live, manifest, worn: new Set(['head', 'shirt']), isLinked, morphs: [], only: (r) => r.mesh === 'shirt' });
  ok(kept.rows.length === 1 && !kept.shared.length && kept.byMesh.get('shirt')?.length === 1, '`only` keeps a subset, which is how the table\'s page shows what its rows left');
  const robe = v('robe|/private/index_color_dye', '/private/index_color_dye', true, 'robe', { palette: DYE_PALETTE, colors: [[255, 255, 255, 0]] });
  const dyed = packColours({ live: [...live, robe], manifest, worn: new Set(['head', 'shirt', 'robe']), isLinked, morphs: [] });
  ok(!dyed.rows.some((r) => r.palette === DYE_PALETTE) && !dyed.byMesh.has('robe'), "a garment's dye of ours has no row until a picker can set it (no swatch of its palette dyes)");
}

// ---------------------------------------------------------------- every species converted on this machine

const ROOT = fileURLToPath(new URL('../../../assets-private/', import.meta.url));
const tableFile = `${ROOT}characters/customization.json`;
const indexFile = `${ROOT}characters/index.json`;
if (!existsSync(tableFile) || !existsSync(indexFile)) {
  note('no creator table or species index on this machine: the made-up species alone was checked (run the customization and species commands)');
} else {
  const table = JSON.parse(readFileSync(tableFile, 'utf8')) as CreatorTable;
  const index = JSON.parse(readFileSync(indexFile, 'utf8')) as { species: { id: string; wardrobe: string | null }[] };
  // The customizer reads its files through `fetch`; this one reads them off the disk.
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
    const p = url.replace(/^pack:\/\//, ROOT);
    if (!existsSync(p)) return new Response('', { status: 404 });
    return new Response(readFileSync(p), { headers: { 'content-type': p.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
  };
  const wardrobes = new Map<string, { items: { id: string; kind: string; parts: { name: string }[] }[] }>();
  const wardrobe = (w: string) => {
    if (!wardrobes.has(w)) wardrobes.set(w, JSON.parse(readFileSync(`${ROOT}wardrobe/${w}/wardrobe.json`, 'utf8')));
    return wardrobes.get(w)!;
  };
  /** What the page is handed for a species standing in its own pack's dress, with a hairstyle on or none. */
  const stateFor = async (id: string, hairId: string | null): Promise<{ state: CreatorState; hairMeshes: string[] }> => {
    const manifest = JSON.parse(readFileSync(`${ROOT}characters/${id}/parts.json`, 'utf8')) as { parts: { name: string; body?: boolean; morphs?: string[] }[]; defaultWear?: string[] };
    const body = manifest.parts.filter((p) => p.body);
    const worn = new Set(manifest.defaultWear ?? []);
    const morphs: Record<string, number> = {};
    for (const p of manifest.parts) if (p.body || worn.has(p.name)) for (const m of p.morphs ?? []) morphs[m] = 0;
    const entry = index.species.find((s) => s.id === id);
    const hairItem = hairId && entry?.wardrobe ? wardrobe(entry.wardrobe).items.find((i) => i.id === hairId) : null;
    const hairMeshes = hairItem?.parts.map((p) => p.name) ?? [];
    const meshes = new Set([...body.map((p) => p.name), ...hairMeshes]);
    const cz = new Customizer();
    await cz.addSource(`pack://characters/${id}/`);
    if (entry?.wardrobe) await cz.addSource(`pack://wardrobe/${entry.wardrobe}/`);
    // The materials the body and the hair would have on: every one their recipes name.
    const files = [`characters/${id}`, ...(entry?.wardrobe ? [`wardrobe/${entry.wardrobe}`] : [])].map((d) => JSON.parse(readFileSync(`${ROOT}${d}/customize.json`, 'utf8')) as { recipes: { mesh: string; material: string }[] });
    const mats = new Set(files.flatMap((f) => f.recipes.filter((r) => meshes.has(r.mesh)).map((r) => r.material)));
    cz.materialsFor = (name) => (mats.has(name) ? [{} as never] : []);
    cz.invalidate();
    return { state: { morphs, bodyMorphs: body.flatMap((p) => p.morphs ?? []), variables: cz.variables(), bodyMeshes: body.map((p) => p.name), hairMeshes, hasHairObjects: !!table.species[id]?.hair?.length }, hairMeshes };
  };
  const firstHair = (id: string) => table.species[id]?.hair?.find((h) => h.creation && h.inArchives)?.id ?? null;
  const labelOf = (id: string, row: string) => table.species[id].rows.find((r) => r.name === row)?.label ?? null;

  {
    const id = 'human_male';
    const { state: s } = await stateFor(id, firstHair(id));
    const view = creatorView(table.species[id], s)!;
    ok(view.duplicates.includes('chest') && !rowOf(view, 'chest'), `the human male's torso slider, which is his muscle one, is shown once (${view.duplicates.join(', ')})`);
    const hair = rowOf(view, 'color_hair');
    ok(!!hair && hair.keys.some((k) => k.startsWith('hair|')), `with a hairstyle on, the hair colour shows and remembers itself (${hair?.keys.join(', ')})`);
    ok(!rowOf(view, 'color_facial_hair') && view.following.some((f) => f.row === 'color_facial_hair'), 'and the facial hair follows it unseen');
    ok(hair!.followers.some((k) => /index_color_facial_hair$/.test(k)), 'a hair pick writes the facial hair');
    const eyes = rowOf(view, 'color_eyes');
    ok(!!eyes && eyes.keys.some((k) => /^hum_m_head_l0\|(\/private\/)?index_color_2$/.test(k)) && eyes.label === labelOf(id, 'color_eyes'), `the head's index_color_2 is the eye row, under the table's own word for it (${eyes?.keys.join(', ')})`);
    ok(eyes!.shows?.palette === 'palette/pc_eye_hum.pal', 'and offers the eye palette');
    const lay = swatchLayout(eyes!.shows?.palette, eyes!.shows?.colors?.length ?? 0, table);
    ok(lay.creation === table.palettes.pc_eye_hum.creation && lay.columns === table.palettes.pc_eye_hum.columns && lay.creation + lay.more === eyes!.shows!.colors!.length, `its creation colours in the game's columns first, every colour offered (${lay.creation} in ${lay.columns}, then ${lay.more})`);
    ok(view.hidden.some((h) => /index_color_3$/.test(h.key) && /one colour/.test(h.why)), "the white palette's colours are hidden");
    ok(view.groups[0].label === table.species[id].groups[0].label, "the first group is the table's first tab, under its own word");
    const { state: baldState } = await stateFor(id, null);
    const bald = creatorView(table.species[id], baldState)!;
    ok(!rowOf(bald, 'color_hair') && !!rowOf(bald, 'color_facial_hair'), 'bald, the facial hair colour shows on its own');
  }
  {
    const id = 'twilek_female';
    const { state: s } = await stateFor(id, firstHair(id));
    const view = creatorView(table.species[id], s)!;
    const brows = rowOf(view, 'color_eyebrows');
    ok(!!brows && !view.following.some((f) => f.row === 'color_eyebrows'), "the Twi'lek female's eyebrows, which follow a colour no lekku carries, are shown on their own");
    const skin = rowOf(view, 'color_skin')!;
    ok(skin.sets.some((k) => /index_color_eyeshadow$/.test(k)) && skin.sets.some((k) => /index_color_lips$/.test(k)), 'her skin also sets her eye shadow and her lips');
  }
  // A colour on the hair object that shares its bare name with the eyes (index_color_2 on both) is a row
  // of its own under the hair's tab, writing the worn hair's key and the remembered one.
  for (const [id, row, tab] of [['zabrak_male', 'color_horns', 'horns_hair'], ['zabrak_female', 'color_horns', 'horns_hair'], ['bothan_female', 'color_trim', 'hair']] as const) {
    const hairId = firstHair(id);
    const { state: s, hairMeshes } = await stateFor(id, hairId);
    const view = creatorView(table.species[id], s)!;
    const r = rowOf(view, row);
    const group = view.groups.find((g) => g.rows.some((x) => x.name === row));
    ok(!!r && !view.duplicates.includes(row) && group?.id === tab && r.keys.some((k) => hairMeshes.some((m) => k.startsWith(`${m}|`))) && r.keys.includes('hair|index_color_2') && r.label === labelOf(id, row), `${id}'s ${row} shows under its own tab and writes the hair's key (${r?.keys.join(', ') ?? 'not shown'})`);
    ok(!rowOf(view, 'color_eyes')!.keys.some((k) => hairMeshes.some((m) => k.startsWith(`${m}|`))), `and ${id}'s eyes write nothing of the hair's`);
  }
  ok(['zabrak_male', 'twilek_female', 'trandoshan_male'].every((id) => hairNone(table.species[id], true, true) === 'left out') && hairNone(table.species.human_male, true, true) === 'offer', "the style picker offers no hair to a human and leaves it out for a Zabrak, a Twi'lek and a Trandoshan wearing a style");
  {
    const id = 'human_female';
    const { state: s } = await stateFor(id, firstHair(id));
    const view = creatorView(table.species[id], s)!;
    ok(view.groups.map((g) => g.id).join() === table.species[id].groups.map((g) => g.id).filter((g) => view.groups.some((x) => x.id === g)).join() && view.groups.some((g) => g.id === 'cosmetic') && view.groups.some((g) => g.id === 'hair'), `the human female's groups are the table's, in its order (${view.groups.map((g) => g.id).join(', ')})`);
  }
  // Every species: what the pack has that no row names, and what no row could find.
  const untabledMorphs: string[] = [];
  const garmentFit: string[] = [];
  const unresolved: string[] = [];
  const dropped: string[] = [];
  for (const sp of index.species) {
    if (!table.species[sp.id]) continue;
    const { state: s } = await stateFor(sp.id, firstHair(sp.id));
    const view = creatorView(table.species[sp.id], s)!;
    for (const d of view.duplicates) dropped.push(`${sp.id}:${d}`);
    for (const r of view.groups.find((g) => g.id === UNTABLED_GROUP)?.rows ?? []) {
      if (r.type === 'slider') untabledMorphs.push(...[r.lo, r.hi].filter(Boolean).map((m) => `${sp.id}:${m}`));
      else unresolved.push(`${sp.id}:ours ${r.keys[0]}`);
    }
    for (const h of view.hidden) if (/fit/.test(h.why)) garmentFit.push(`${sp.id}:${h.key}`);
    for (const r of view.unresolved) unresolved.push(`${sp.id}:${r}`);
  }
  // The one second copy in the table is the males' torso slider, which is their muscle one.
  ok(dropped.length > 0 && dropped.every((d) => d.endsWith(':chest')) && dropped.every((d) => /_male:/.test(d)), `the only rows dropped as copies are the males' torso sliders (${dropped.join(', ')})`);
  note(`morphs no row names: ${untabledMorphs.join(', ')}`);
  // The research counted nine over the body and its own dress together. Two of them, the Mon Calamari
  // and Wookiee females' flat chest, are on the shirt alone: no row offers them and no body has them, so
  // a slider would move the shirt and nothing under it. Those are a garment's fit, and left out.
  ok(untabledMorphs.length === 7 && untabledMorphs.includes('trandoshan_female:blend_flat_chest') && untabledMorphs.filter((m) => /blend_nosedepth/.test(m)).length === 4, `the seven body morphs no row names stand in the group of ours (${untabledMorphs.length})`);
  ok(garmentFit.includes('moncal_female:blend_flat_chest') && garmentFit.includes('wookiee_female:blend_flat_chest'), 'and the two only their shirt carries are left out as its fit, which makes the nine');
  // A row that finds nothing is one whose variable lives on a hairstyle the first one does not carry
  // (a Zabrak's horns-only styles have no hair colour); anything else would be a reading gone wrong.
  note(`rows that found nothing with the first creation hairstyle on: ${unresolved.join(', ') || 'none'}`);
  const bodyMiss = unresolved.filter((u) => {
    const [id, row] = u.split(':');
    return !table.species[id]?.rows.find((r) => r.name === row)?.onHair;
  });
  ok(bodyMiss.length === 0, `every body row of every species finds its variables (${bodyMiss.join(', ') || 'all'})`);
}

console.log(`\n${passed} checks passed`);
