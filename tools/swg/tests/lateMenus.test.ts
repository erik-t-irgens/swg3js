// Every menu's late things, on the packs on disk: what SOE's final files (publishes 55 to 59, read through the names
// list the converter ships) bring to the give tab's Clothes and Weapons, the appearance page's hair grid and its
// sections, the garage, the NPC tab, the props tab, the Housing tab and the emote list, each asked of the menu's own
// pure function (`src/ui/lateReport.ts`, the very products `__debug.late()` reports in play, over `buildWardrobeView`,
// `hairCells`, `buildWeaponView`, `buildPropView`, `emoteChoices`; and `creatorView` for the sections).
//
// Keyed on each pack's own late stamp (the `late` the converter writes into the file `status` reads for its command):
// a pack stamped `applied` (or `final`) fails when its menu does not show the late thing; a pack with no stamp is a
// note ("converted before SOE's final files: run convert"), and one converted with the late phase refused or with
// nothing to do is a note too, never a failure, since a player's packs being old is not a fault. The garage does not
// load under node (three, its loader, extensionless imports), so its checks read the packs it lists from.
//
// Ids only: nothing here quotes the client's words. Run first over made-up rows (each product fails without its thing
// and passes with it), then over the packs the folder SWG3JS_PACKS names, else assets-private.
//
// Run: node tools/swg/tests/lateMenus.test.ts
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LATE_THINGS, bodiesProduct, clothesProduct, emotesProduct, garageProduct, hairProduct, housingProduct, lateLine, lateMounted, lateStateOf, missingMenus, propsProduct, rackProduct, shipsProduct, type LateProduct } from '../../../src/ui/lateReport.ts';
import { garageGalleryRows } from '../../../src/vehicles/vehicleKinds.ts';
import { failedModelsOf, readinessOf } from '../../../src/world/mobiles/catalogueIndex.ts';
import type { MobileCatalogueFile } from '../../../src/world/mobiles/types.ts';
import { NO_HAIR, hairCells, type HairItem } from '../../../src/ui/hairGrid.ts';
import { buildWeaponView } from '../../../src/ui/giveModel.ts';
import { creatorView, gridGroupId, type CreatorState, type CreatorTable } from '../../../src/ui/creatorModel.ts';
import { isHairKey } from '../../../src/core/inventory.ts';
import { CLASS_LABELS } from '../../../src/player/weapons.ts';
import { deedLine, type DeedRow } from '../../../src/world/deeds.ts';
import { Customizer } from '../../../src/player/customizer.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

// ---------------------------------------------------------------- the pieces, on made-up rows

ok(lateStateOf(undefined) === 'before' && lateStateOf(null) === 'before' && lateStateOf({ state: 'applied' }) === 'applied' && lateStateOf({ state: 'refused' }) === 'refused' && lateStateOf({ state: 'odd' }) === 'before', 'a stamp reads as its state, and none (or one this build does not know) as before');
ok(lateMounted({ state: 'applied' }) && lateMounted({ state: 'final' }) && !lateMounted({ state: 'none' }) && !lateMounted(null), 'the late things must show where the late files were in the mount, and only there');
{
  const fail = (p: LateProduct) => !p.shows && p.what.length > 0;
  const pass = (p: LateProduct) => p.shows && p.what.length > 0;
  const wear = (id: string, slots: string[][] = [['chest1']]) => ({ id, kind: 'wear', gender: 'm', parts: [{}], slots });
  // The late pieces no id pattern places, each with its arrangement's first slot as the converted wardrobes carry it.
  const SLOT_OF_GROUP: Record<string, string> = { back: 'back', head: 'hat', bracer_l: 'wrist_l' };
  const slotted = Object.entries(LATE_THINGS.slotted).map(([id, g]) => wear(id, [[SLOT_OF_GROUP[g]]]));
  const human = { own: 'm', species: 'human_male' };
  ok(fail(clothesProduct([wear('shirt_s03'), ...slotted], human)) && pass(clothesProduct([wear('shirt_s03'), wear(LATE_THINGS.clothes), ...slotted], { own: 'f', species: 'human_female' })), 'the Clothes view: without the late chest plate it fails, with it (authored for the other body) it passes');
  ok(fail(clothesProduct([wear(LATE_THINGS.clothes), ...slotted.slice(1)], human)) && fail(clothesProduct([wear(LATE_THINGS.clothes), wear(slotted[0].id, []), ...slotted.slice(1)], human)), "and it fails when a late piece no id pattern places is missing, or stands under Other for want of its slots (the give tab's own grouping, `slotGroupOf(id, slots)`)");
  const hair = (id: string, file: string): HairItem => ({ id, kind: 'hair', template: `object/tangible/hair/wookiee/shared_${id}.iff`, parts: [{ file }] });
  const table: CreatorTable = { format: 1, source: 'test', palettes: {}, species: { wookiee_male: { groups: [{ id: 'fur', label: 'g', hair: true }], rows: [], hair: [{ template: '', id: 'hair_wookiee_male_s01', inArchives: true, creation: false, skill: 1 }] } } };
  ok(fail(hairProduct(table, [])) && fail(hairProduct(null, [hair('hair_wookiee_male_s01', 'a')])) && pass(hairProduct(table, [hair('hair_wookiee_male_s01', 'a')])), 'the hair grid: a Wookiee man gets his own group only with the table and the style both there');
  const order = [{ id: 'sword2h', label: 's' }];
  ok(fail(rackProduct([{ id: 'other', class: 'sword2h' }], order)) && fail(rackProduct([{ id: LATE_THINGS.weapon, class: 'sword2h' }], [])) && pass(rackProduct([{ id: LATE_THINGS.weapon, class: 'sword2h' }], order)), "the rack: the scythe listed, and only under a class the rack's order reads");
  ok(fail(garageProduct(LATE_THINGS.vehicles)) && pass(garageProduct([...LATE_THINGS.vehicles, ...LATE_THINGS.mounts, 'speeder'])), 'the garage: every late vehicle and mount, not some');
  ok(fail(shipsProduct([LATE_THINGS.hull], [])) && fail(shipsProduct([], [LATE_THINGS.npcType])) && pass(shipsProduct([LATE_THINGS.hull], [LATE_THINGS.npcType])), 'the ships: the late hull and the tier 10 type');
  ok(fail(shipsProduct([LATE_THINGS.hull], null)) && /combat\.json/.test(shipsProduct([LATE_THINGS.hull], null).what), 'and a ships pack with no NPC types at all (its combat.json missing) does not show the tier 10 type, and says why');
  {
    const answers = [shipsProduct([LATE_THINGS.hull], null), { menu: 'props', shows: null, what: 'not fetched' }, propsProduct([{ id: 'chair', group: 'g' }])];
    const packsOf = { ships: ['ships', 'ships/combat.json'], props: ['props'] };
    const got = missingMenus(answers, packsOf, [{ name: 'ships', stamp: { state: 'applied' } }, { name: 'props', stamp: null }]);
    ok(got.length === 1 && /^ships: .*combat\.json/.test(got[0]), `missing names a menu that does not show its late things where its own pack says they were in the mount, never one not asked yet nor one whose pack is old (${got.join('; ')})`);
    ok(missingMenus(answers, packsOf, [{ name: 'props', stamp: { state: 'final' } }]).join() === `props: ${answers[2].what}` && missingMenus(answers, packsOf, []).length === 0, 'and a mount read through SOE\'s own final indexes counts as the names list does, while no pack fetched names nothing');
  }
  ok(fail(bodiesProduct(() => null)) && fail(bodiesProduct(() => false)) && pass(bodiesProduct((id) => id === LATE_THINGS.body)), 'the NPC tab: the Dug there and ready');
  {
    // The two rules the disk checks below read the packs through, the garage's and the NPC tab's own.
    const rows = garageGalleryRows([{ label: 'a', model: 'm_a' }, { label: 'b', model: 'm_gone' }, { label: 'c', model: 'm_c' }], [{ id: 'm_c' }, { id: 'm_a' }]);
    ok(rows.map((r) => `${r.item.label}:${r.model.id}`).join() === 'a:m_a,c:m_c', "the garage lists a gallery vehicle only when the gallery's layout holds its model, in the section's order");
    const entry = (more: Record<string, unknown> = {}) => ({ id: 'dug_m', kind: 'creature', appearance: 'dug', pack: null, ready: true, ...more }) as unknown as MobileCatalogueFile['entries'][number];
    const file = (a: boolean, p: boolean) => ({ appearances: { dug: { ready: a, pack: 'dugs' } }, packs: { dugs: { id: 'dugs', ready: p } } }) as unknown as MobileCatalogueFile;
    const none = new Set<string>();
    ok(readinessOf(entry(), file(true, true), none).ok && !readinessOf(entry(), file(false, true), none).ok && !readinessOf(entry(), file(true, false), none).ok && !readinessOf(entry(), file(true, true), new Set(['dug'])).ok && !readinessOf(entry({ ready: false }), file(true, true), none).ok, "the NPC tab stands a body only with the converter's mark, its model converted and in the archives, and its animation pack converted");
    ok(failedModelsOf({ failed: [{ what: 'model', id: 'x', why: '' }, { what: 'pack', id: 'y', why: '' }] }).has('x') && !failedModelsOf({ failed: [{ what: 'pack', id: 'y', why: '' }] }).has('y'), 'and a failed model is a model the catalogue records the archives could not give');
  }
  ok(fail(propsProduct([{ id: 'chair', group: 'tangible/furniture' }])) && pass(propsProduct([{ id: 'painting_wod_ns_01', group: 'tangible/painting' }])), 'the props view: a Dathomir painting listed');
  ok(fail(housingProduct([{ id: 'd', makes: LATE_THINGS.house, model: null }])) && pass(housingProduct([{ id: 'd', makes: LATE_THINGS.house, model: 'ply_yt1300_house', ours: true }])), 'the Housing tab: a deed that makes the YT-1300 house, with a model to stand');
  const dances = [33, 34, 35, 36].map((n) => `loop_skill:speed2:dance_${n}`);
  ok(fail(emotesProduct(dances)) && fail(emotesProduct([LATE_THINGS.emote, ...dances.slice(1)])) && fail(emotesProduct([LATE_THINGS.emote, ...dances, 'loop_skill:speed2:dance_40'])) && pass(emotesProduct([LATE_THINGS.emote, ...dances, 'loop_skill:speed2:dance_2'])), 'the emote list: the undead emote, all four late dances, and a label for every dance the rig carries');
  ok(/mounted in every pack fetched \(2; names list k, 9,890 rows\)/.test(lateLine([{ name: 'a', stamp: { state: 'applied', key: 'k', rows: 9890 } }, { name: 'b', stamp: { state: 'applied', key: 'k' } }])), 'the line: mounted in every pack');
  ok(/1 of 2 packs fetched carry them \(not: b\)/.test(lateLine([{ name: 'a', stamp: { state: 'applied', key: 'k' } }, { name: 'b', stamp: null }])) && /not mounted on this install: x/.test(lateLine([{ name: 'a', stamp: { state: 'refused', why: 'x' } }])) && /no pack fetched carries them \(1 converted before/.test(lateLine([{ name: 'a', stamp: undefined }])), 'and some of them, a refusal, and none');
}

// ---------------------------------------------------------------- the packs on disk

const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
const json = (rel: string): any => {
  const f = join(PACKS, rel);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
let applied = 0;
let noted = 0;
/**
 * A pack's late check: run where its stamp says the late files were in the mount; a note naming the pack otherwise.
 * Answers whether it ran.
 */
async function held(pack: string, stamp: unknown, check: () => void | Promise<void>): Promise<boolean> {
  const state = lateStateOf(stamp);
  if (state === 'applied' || state === 'final') {
    applied++;
    await check();
    return true;
  }
  noted++;
  const why = (stamp as { why?: string } | null)?.why;
  note(state === 'before' ? `${pack}: converted before SOE's final files: run convert` : `${pack}: converted without SOE's final files (${state}${why ? `: ${why}` : ''}): nothing late to show`);
  return false;
}

if (!existsSync(PACKS)) note(`no packs at ${PACKS}: only the made-up rows were checked`);
else {
  // The wardrobes: every hair entry is hair to the one test of a part name (always, whatever the stamp: a hair entry
  // `isHairKey` misses is owned, put in the backpack and never taken off), and the late chest plate in the Clothes view.
  const folders = existsSync(join(PACKS, 'wardrobe')) ? readdirSync(join(PACKS, 'wardrobe')).filter((f) => existsSync(join(PACKS, 'wardrobe', f, 'wardrobe.json'))) : [];
  const wardrobes = new Map<string, any>();
  for (const f of folders) wardrobes.set(f, json(`wardrobe/${f}/wardrobe.json`));
  for (const [f, w] of wardrobes) {
    if (!w) continue;
    const hair = (w.items as HairItem[]).filter((i) => i.kind === 'hair');
    const missed = hair.filter((i) => !isHairKey(i.id)).map((i) => i.id);
    ok(missed.length === 0, `wardrobe/${f}: every one of its ${hair.length} hair entries is hair to isHairKey${missed.length ? ` (not: ${missed.slice(0, 5).join(', ')})` : ''}`);
    if (/^human_(fe)?male$/.test(f))
      await held(`wardrobe/${f}`, w.late, () => {
        const p = clothesProduct(w.items, { own: String(w.gender ?? f.replace('human_', '')).charAt(0), species: f });
        ok(p.shows, `wardrobe/${f}: the Clothes view lists the late chest plate, and the late wings, headband and bracelet under back, head and the left bracer by their slots (${p.what})`);
      });
  }

  // The creator's table: a Wookiee man's own hair group, no group of any species' grid saying a label or showing a mesh
  // twice (always: the rules are the code's), and the appearance page's sections for a Wookiee man and a human man.
  const table = json('characters/customization.json') as CreatorTable | null;
  const index = json('characters/index.json') as { species: { id: string; species: string; gender: string; wardrobe: string | null }[] } | null;
  if (!table || !index) note('no creator table or species index: the hair grid and the sections are not checked here');
  else {
    const itemsOf = (sp: { wardrobe: string | null }) => (sp.wardrobe ? ((wardrobes.get(sp.wardrobe)?.items ?? []) as HairItem[]) : []);
    const human = index.species.find((s) => s.id === 'human_male');
    await held('characters/customization.json', table.late, () => {
      const p = hairProduct(table, human ? itemsOf(human) : []);
      ok(p.shows, `the hair grid gives a Wookiee man his own group (${p.what})`);
    });
    const repeats: string[] = [];
    const tableTwice: string[] = [];
    let grids = 0;
    for (const sp of index.species) {
      const items = itemsOf(sp);
      if (!items.length) continue;
      const grid = hairCells(table, items, sp.species, sp.gender === 'female' ? 'female' : 'male', null);
      grids++;
      const meshOf = new Map(items.map((i) => [i.id, (i.parts ?? []).map((p) => p.file ?? p.name ?? '').sort().join(',')]));
      // Which cell first showed each mesh: the own group is the table's rows for this gender exactly (hairGrid.test.ts),
      // so two rows the game's own table names on one appearance stand twice there, the game's offering and said as such;
      // every other repeat -- a label said twice, or a mesh any group of ours shows again -- is the grid's own fault.
      const shown = new Map<string, string>();
      for (const g of grid.groups) {
        const cells = g.cells.filter((c) => c.id !== NO_HAIR);
        const labels = cells.map((c) => c.label);
        if (new Set(labels).size !== labels.length) repeats.push(`${sp.id}/${g.id}: a label twice`);
        for (const c of cells) {
          const m = meshOf.get(c.id) ?? '';
          const first = m ? shown.get(m) : undefined;
          if (first !== undefined) (g.id === 'own' && first.startsWith('own:') ? tableTwice : repeats).push(`${sp.id}/${g.id}: ${c.id} on the same mesh as ${first}`);
          else if (m) shown.set(m, `${g.id}:${c.id}`);
        }
      }
    }
    ok(grids > 0 && repeats.length === 0, `no group of any species' hair grid says a label twice, and none of ours shows a mesh another cell shows (${grids} grids${repeats.length ? `; ${repeats.slice(0, 5).join('; ')}` : ''})`);
    if (tableTwice.length) note(`the game's own table offers two rows on one appearance, and the own group shows both as the table has them: ${tableTwice.join('; ')}`);
    await held('characters/customization.json (the sections)', table.late, () => sections(table, index));
  }

  // The rack: the scythe, the fifth generation two-handed saber and the legendary E-5 in their classes, the E-5 with
  // its effect row; and the sounds' ranged row for it.
  const weapons = json('weapons/manifest.json');
  if (!weapons) note('no weapons pack: the rack is not checked here');
  else
    await held('weapons', weapons.late, () => {
      const order = Object.keys(CLASS_LABELS).map((id) => ({ id, label: CLASS_LABELS[id as keyof typeof CLASS_LABELS] }));
      const p = rackProduct(weapons.weapons, order);
      ok(p.shows, `the rack lists the scythe (${p.what})`);
      const view = buildWeaponView(weapons.weapons, { find: '', right: null, left: null, offHand: new Set(), order, iconUrl: () => null });
      const where = (id: string) => view.groups.find((g) => g.cells.some((c) => c.id === id))?.id ?? null;
      ok(where('sword_lightsaber_two_handed_gen5_sith') === 'lightsaber2h' && where('carbine_e5_legend') === 'carbine', `the fifth generation two-handed saber stands under the two-handed sabers and the legendary E-5 under the carbines (${where('sword_lightsaber_two_handed_gen5_sith')}, ${where('carbine_e5_legend')})`);
      ok(!!weapons.weapons.find((w: { id: string; fx?: unknown }) => w.id === 'carbine_e5_legend')?.fx, 'and the E-5 fires its own effect row');
    });
  const bank = json('sounds/sounds.json');
  const sources = json('sounds/sources.json');
  if (!bank || !sources) note('no sound bank: the guns\' sound rows are not checked here');
  else
    await held('sounds', bank.late, () => {
      ok((sources.ranged as { weapon: string }[]).some((r) => r.weapon === 'shared_carbine_e5_legend.iff'), "the sounds' ranged rows carry the legendary E-5's own");
    });

  // The garage reads three packs: the gallery's vehicles (those whose model the gallery's layout holds,
  // `garageGalleryRows`, the garage's own rule), the creatures' mounts and the ships.
  const garageIds: string[] = [];
  const gallery = json('gallery/manifest.json');
  const galleryIndex = json('gallery/gallery.json');
  const galleryRows = gallery && galleryIndex ? garageGalleryRows<{ label: string; model: string }, { id: string }>((galleryIndex.sections as { id: string; items: { label: string; model: string }[] }[]).find((s) => s.id === 'vehicles')?.items ?? [], gallery.categories?.layout ?? []) : [];
  const galleryRan = !gallery || !galleryIndex ? (note('no gallery: its vehicles are not checked here'), false) : await held('gallery', gallery.late, () => {
    const labels = new Set<string>(galleryRows.map((r) => r.item.label));
    const missing = LATE_THINGS.vehicles.filter((id) => !labels.has(id));
    ok(!missing.length, `the gallery lists the late vehicles for the garage, each with its model in the layout (${missing.length ? `missing ${missing.join(', ')}` : LATE_THINGS.vehicles.join(', ')})`);
  });
  for (const r of galleryRows) garageIds.push(r.item.label);
  const creatures = json('creatures/manifest.json');
  const creaturesRan = !creatures ? (note('no creatures pack: the mounts are not checked here'), false) : await held('creatures', creatures.late, () => {
    const mounts = (creatures.creatures as { id: string; mount?: boolean; saddle?: { joint?: string | null } }[]).filter((c) => LATE_THINGS.mounts.includes(c.id));
    ok(mounts.length === LATE_THINGS.mounts.length && mounts.every((c) => c.mount === true && !!c.saddle?.joint), `the four late mounts are mounts with a saddle joint (${mounts.map((c) => `${c.id}:${c.saddle?.joint ?? 'none'}`).join(', ')})`);
  });
  if (creatures) for (const c of creatures.creatures ?? []) garageIds.push(c.id);
  const ships = json('ships/manifest.json');
  const combat = json('ships/combat.json');
  if (ships) for (const s of ships.ships ?? []) garageIds.push(s.id);
  if (!ships) note('no ships pack: the hulls are not checked here');
  else
    await held('ships', ships.late, () => {
      const ids = new Set<string>((ships.ships as { id: string }[]).map((s) => s.id));
      const hulls = ['twing', 'tiedefender', 'havoc', 'snow_speeder_s01', 'droid_fighter_s01', 'blacksun_vaksai_s02', 'lambda'];
      ok(hulls.every((h) => ids.has(h)) && !ids.has('tie_defender'), `the garage's ships hold the seven late hulls and not the placeholder drawn on another hull (${hulls.filter((h) => !ids.has(h)).join(', ') || 'all'})`);
      // A combat file converted without the late files beside a ships manifest converted with them is a run of the
      // ships command that did not finish: its tier 10 type is not asked, and said so. A missing combat file is a
      // fault of a pack stamped with the late files, as `__debug.late()` names it.
      if (combat && !lateMounted(combat.late)) {
        note(`ships/combat.json: converted without SOE's final files (${lateStateOf(combat.late)}) beside a ships manifest converted with them: the tier 10 type is not asked`);
        ok(ids.has(LATE_THINGS.hull), `the ship list holds the late hull (${LATE_THINGS.hull})`);
      } else {
        const p = shipsProduct(ids, combat ? (combat.types as { id: string }[]).map((t) => t.id) : null);
        ok(p.shows, `the ship list holds the late hull and the NPC tab the X-wing at tier 10 (${p.what})`);
      }
    });
  if (galleryRan && creaturesRan) {
    const p = garageProduct(garageIds);
    ok(p.shows, `the garage's own list, as it reads those packs, holds every late vehicle and mount (${p.what})`);
  }

  // The NPC tab, the props tab and the Housing tab.
  const catalogue = json('mobiles/catalogue.json');
  if (!catalogue) note('no mobiles catalogue: the NPC tab is not checked here');
  else
    await held('mobiles', catalogue.options?.source?.late, () => {
      // Ready by the NPC tab's own rule (`readinessOf`, which `MobileCatalogue.ready` asks): the converter's mark, a
      // model the archives gave and the converter made, and a converted animation pack.
      const file = catalogue as MobileCatalogueFile;
      const failed = failedModelsOf(file);
      const byId = new Map(file.entries.map((e) => [e.id, e]));
      let why: string | null = null;
      const p = bodiesProduct((id) => {
        const e = byId.get(id);
        if (!e) return null;
        const r = readinessOf(e, file, failed);
        why = r.why;
        return r.ok;
      });
      ok(p.shows, `the NPC tab holds the Dug, ready by its own rule (${p.what}${why ? `: ${why}` : ''})`);
    });
  const props = json('props/manifest.json');
  if (!props) note('no props pack: the props tab is not checked here');
  else
    await held('props', props.late, () => {
      const p = propsProduct(props.props);
      ok(p.shows, `the props view lists the Dathomir paintings (${p.what})`);
    });
  const deeds = json('deeds.json');
  if (!deeds) note('no deeds: the Housing tab is not checked here');
  else
    await held('deeds', deeds.late, () => {
      const p = housingProduct(deeds.deeds);
      ok(p.shows, `the Housing tab offers the YT-1300 house (${p.what})`);
      const d = (deeds.deeds as DeedRow[]).find((x) => x.makes === LATE_THINGS.house && x.model)!;
      ok(!d.ours || /not known \(ours\)/.test(deedLine(d)), `and says its lots and upkeep are not known where the deed is ours (${deedLine(d)})`);
    });

  // The emote list over every rig the converter stamps: each species' parts and the player's own rig.
  const rigs: { pack: string; late: unknown; clips: string[] }[] = [];
  for (const sp of index?.species ?? []) {
    const parts = json(`characters/${sp.id}/parts.json`);
    if (parts) rigs.push({ pack: `characters/${sp.id}`, late: parts.late, clips: parts.clips ?? [] });
  }
  const player = json('player/manifest.json')?.players?.[0];
  if (player) rigs.push({ pack: 'player', late: player.late, clips: player.clips ?? [] });
  if (!rigs.length) note('no rigs: the emote list is not checked here');
  const unlit: string[] = [];
  for (const r of rigs) await held(r.pack, r.late, () => {
    const p = emotesProduct(r.clips);
    if (!p.shows) unlit.push(`${r.pack}: ${p.what}`);
  });
  if (rigs.some((r) => lateMounted(r.late))) ok(unlit.length === 0, `every rig converted with the late files lists the undead emote and dances 33 to 36, every dance it carries labelled (${rigs.filter((r) => lateMounted(r.late)).length} rigs${unlit.length ? `; not: ${unlit.slice(0, 4).join('; ')}` : ''})`);

  note(`${applied} pack checks ran on packs converted with SOE's final files, ${noted} noted`);
}

/**
 * The appearance page's sections over the converted table, through the game's own customizer (`Customizer`, fed each
 * pack's customize.json through a stand-in for `fetch`): a Wookiee man's and a human man's view, the grid in the first
 * hair group (`gridGroupId`), the Wookiee's fur pattern and the human's trim colour each standing in a section (the
 * trim under a style that carries it: only a few do), and the sections in the table's own order.
 */
async function sections(table: CreatorTable, index: { species: { id: string; wardrobe: string | null }[] }): Promise<void> {
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
    const p = url.replace(/^pack:\/\//, PACKS.replace(/\\/g, '/').replace(/\/?$/, '/'));
    if (!existsSync(p)) return new Response('', { status: 404 });
    return new Response(readFileSync(p), { headers: { 'content-type': p.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
  };
  const stateFor = async (id: string, hairId: string | null): Promise<CreatorState | null> => {
    const manifest = json(`characters/${id}/parts.json`) as { parts: { name: string; body?: boolean; morphs?: string[] }[]; defaultWear?: string[] } | null;
    const entry = index.species.find((s) => s.id === id);
    if (!manifest || !entry?.wardrobe || !existsSync(join(PACKS, 'characters', id, 'customize.json'))) return null;
    const body = manifest.parts.filter((p) => p.body);
    const worn = new Set(manifest.defaultWear ?? []);
    const morphs: Record<string, number> = {};
    for (const p of manifest.parts) if (p.body || worn.has(p.name)) for (const m of p.morphs ?? []) morphs[m] = 0;
    const ward = json(`wardrobe/${entry.wardrobe}/wardrobe.json`) as { items: { id: string; parts: { name: string }[] }[] };
    const hairMeshes = hairId ? (ward.items.find((i) => i.id === hairId)?.parts.map((p) => p.name) ?? []) : [];
    const meshes = new Set([...body.map((p) => p.name), ...hairMeshes]);
    const cz = new Customizer();
    await cz.addSource(`pack://characters/${id}/`);
    await cz.addSource(`pack://wardrobe/${entry.wardrobe}/`);
    const files = [`characters/${id}`, `wardrobe/${entry.wardrobe}`].map((d) => json(`${d}/customize.json`) as { recipes: { mesh: string; material: string }[] });
    const mats = new Set(files.flatMap((f) => f.recipes.filter((r) => meshes.has(r.mesh)).map((r) => r.material)));
    cz.materialsFor = (name) => (mats.has(name) ? [{} as never] : []);
    cz.invalidate();
    return { morphs, bodyMorphs: body.flatMap((p) => p.morphs ?? []), variables: cz.variables(), bodyMeshes: body.map((p) => p.name), hairMeshes, hasHairObjects: !!table.species[id]?.hair?.length };
  };
  const inTableOrder = (id: string, groups: { id: string; ours?: boolean }[]) => {
    const order = table.species[id].groups.map((g) => g.id);
    const ids = groups.filter((g) => !g.ours && order.includes(g.id)).map((g) => order.indexOf(g.id));
    return ids.every((v, i) => i === 0 || v > ids[i - 1]);
  };
  for (const [id, row, hairs] of [
    ['wookiee_male', 'pattern', [null, ...(table.species.wookiee_male?.hair ?? []).filter((h) => h.inArchives).slice(0, 1).map((h) => h.id)]],
    ['human_male', 'color_trim', (table.species.human_male?.hair ?? []).filter((h) => h.inArchives).map((h) => h.id)],
  ] as const) {
    if (!table.species[id]) {
      note(`no ${id} in the creator's table: its sections are not checked`);
      continue;
    }
    const firstHair = table.species[id].groups.find((g) => g.hair)?.id ?? null;
    let found: string | null = null;
    let checked = 0;
    for (const h of hairs) {
      const state = await stateFor(id, h);
      if (!state) break;
      const view = creatorView(table.species[id], state)!;
      checked++;
      assert.ok(gridGroupId(view) === firstHair, `${id}: the grid stands in the table's first hair group (${gridGroupId(view)} against ${firstHair})`);
      assert.ok(inTableOrder(id, view.groups), `${id}: the sections stand in the table's order (${view.groups.map((g) => g.id).join(', ')})`);
      const at = view.groups.find((g) => g.rows.some((r) => r.name === row));
      if (at && !found) found = `${at.id} with ${h ?? 'no hair'} on`;
      if (found && id === 'wookiee_male') continue;
      if (found) break;
    }
    if (!checked) {
      note(`${id}: no parts pack or recipes on this machine: its sections are not checked`);
      continue;
    }
    ok(firstHair !== null, `${id}: the grid stands in the table's first hair group (${firstHair}), and every section in the table's order, over ${checked} view${checked === 1 ? '' : 's'}`);
    ok(!!found, `${id}: the ${row} row stands in a section of the view (${found ?? 'dropped'})`);
  }
}

console.log(`\n${passed} checks passed`);
