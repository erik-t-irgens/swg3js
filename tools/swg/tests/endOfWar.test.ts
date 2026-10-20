// The End of War's ships and the ships pack's NPC-only hulls (tools/swg/npcships.mjs `END_OF_WAR`, `npcOnlyHullPicks`,
// `buildCombat`'s `endOfWar`; src/space/hullNpc.ts `endOfWarRows`, `hullNpcPlan`'s name of its own).
//
// The NPC-only path's picks are worked out over templates made here: one hull an appearance an NPC type flies that no
// player hull shares, by the family that sorts first and its lowest tier, never for a type the garage hull draws, never
// for the two End of War ships the table names a garage hull for, never for a quest line's tiers. `buildCombat` gives
// every End of War template a hull (by its appearance, else the garage hull the table names), its side and its name,
// and lists one with neither as skipped; the tiered types an NPC-only hull draws find it by their appearance as any
// type finds its hull. The NPC tab's rows (`endOfWarRows`, the tab's readiness as `readinessOf` is the people's) and the
// type a stand of one makes (named as itself, counted by its id) are asked too. Then, on a ships pack on disk written
// with the NPC-only hulls (`SWG3JS_PACKS`, else assets-private), every NPC-only hull is `npc`, every End of War ship's
// hull is in the manifest, and where SOE's final files were mounted all eight are listed; a pack converted before is a note.
//
// Run: node tools/swg/tests/endOfWar.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { END_OF_WAR, NPC_HULLS_FORMAT, buildCombat, combatLine, npcOnlyHullPicks } from '../npcships.mjs';
import { END_OF_WAR_TUNE, endOfWarRows, hullNpcPlan, inTheWay, standsInside, tuneEndOfWar } from '../../../src/space/hullNpc.ts';
import type { NpcTypeDef } from '../../../src/space/combatData.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// Templates made here: a player hull's family whose NPC types it draws, an NPC-only family over three tiers and a
// second family sharing its appearance, a quest line's, and the End of War's eight.
const apps: Record<string, string> = {
  'object/ship/shared_xwing_tier1.iff': 'appearance/test_xwing.apt',
  'object/ship/shared_test_gunboat_tier2.iff': 'appearance/test_gunboat.apt',
  'object/ship/shared_test_gunboat_tier1.iff': 'appearance/test_gunboat.apt',
  'object/ship/shared_test_gunboat_tier6.iff': 'appearance/test_gunboat.apt',
  'object/ship/shared_abc_gunboat_tier3.iff': 'appearance/test_gunboat.apt',
  'object/ship/shared_nova_orion_test_tier2.iff': 'appearance/test_quest.apt',
  'object/ship/shared_eow_corvette.iff': 'appearance/test_corvette.apt',
  'object/ship/shared_eow_imperial_lancer.iff': 'appearance/test_lancer.apt',
  'object/ship/shared_eow_nebulon_frigate.iff': 'appearance/test_nebulon.apt',
  'object/ship/shared_eow_rebel_transport.iff': 'appearance/test_transport.apt',
  'object/ship/shared_eow_star_destroyer.iff': 'appearance/test_sd.apt',
  'object/ship/shared_eow_stardestroyer.iff': 'appearance/test_sd.apt',
  'object/ship/shared_spacestation_imperial_gcw.iff': 'appearance/test_imp_station.apt',
  'object/ship/shared_spacestation_rebel_gcw.iff': 'appearance/test_reb_station.apt',
  'object/ship/player/shared_player_xwing.iff': 'appearance/test_xwing.apt',
};
const appearanceOf = (t: string) => apps[t] ?? null;
const templates = Object.keys(apps).filter((t) => !t.includes('/player/'));
ok(Object.keys(END_OF_WAR).length === 8 && Object.values(END_OF_WAR).every((r) => ['imperial', 'rebel'].includes(r.faction)), "the End of War table holds its eight ships, each for a side");

const picks = npcOnlyHullPicks({ templates, appearanceOf, playerAppearances: new Set(['appearance/test_xwing.apt']) });
const pickIds = picks.map((p) => p.id);
ok(pickIds.includes('npc_abc_gunboat') && !pickIds.includes('npc_test_gunboat') && picks.find((p) => p.id === 'npc_abc_gunboat')?.template === 'object/ship/shared_abc_gunboat_tier3.iff', `one hull an appearance no player hull shares, by the family that sorts first (${pickIds.join(', ')})`);
ok(!pickIds.some((id) => /xwing|nova_orion/.test(id)), "no hull for a type a player hull draws, nor for a quest line's tiers");
ok(!pickIds.includes('npc_eow_corvette') && !pickIds.includes('npc_eow_star_destroyer') && !pickIds.includes('npc_eow_stardestroyer') && ['npc_eow_imperial_lancer', 'npc_eow_nebulon_frigate', 'npc_eow_rebel_transport', 'npc_spacestation_imperial_gcw', 'npc_spacestation_rebel_gcw'].every((id) => pickIds.includes(id)), 'a hull for each End of War ship but the two the table gives a garage hull');
ok(JSON.stringify(npcOnlyHullPicks({ templates: [...templates].reverse(), appearanceOf, playerAppearances: new Set(['appearance/test_xwing.apt']) })) === JSON.stringify(picks), 'the picks do not depend on the order the templates come in');
{
  const one = npcOnlyHullPicks({ templates: ['object/ship/shared_test_gunboat_tier6.iff', 'object/ship/shared_test_gunboat_tier2.iff', 'object/ship/shared_test_gunboat_tier1.iff'], appearanceOf, playerAppearances: new Set() });
  ok(one.length === 1 && one[0].template === 'object/ship/shared_test_gunboat_tier1.iff', 'within a family, its lowest tier');
}

// buildCombat: the ships as the manifest would hold them after the NPC-only path.
const ships = [
  { id: 'xwing', template: 'object/ship/player/shared_player_xwing.iff' },
  { id: 'corellian_corvette', template: 'object/ship/player/shared_player_corellian_corvette.iff' },
  { id: 'star_destroyer', template: 'object/ship/player/shared_player_star_destroyer.iff' },
  ...picks.map((p) => ({ id: p.id, template: p.template, npc: true })),
].filter((s) => s.id !== 'npc_spacestation_rebel_gcw');
const rows = new Map(templates.map((t) => [t.replace(/^.*\/shared_/, '').replace(/\.iff$/, ''), {}]));
const combat = buildCombat({
  templates: templates.filter((t) => /_tier\d+\.iff$/.test(t)),
  endOfWar: templates.filter((t) => !/_tier\d+\.iff$/.test(t)),
  appearanceOf,
  ships,
  chassisRows: rows,
  slotNames: [],
  nameOf: (id: string) => (id === 'eow_imperial_lancer' ? 'TEST lancer' : null),
  objectNameOf: (t: string) => (t.includes('nebulon') ? 'TEST frigate' : null),
});
const eow = combat.file.endOfWar as { id: string; name: string; hull: string; faction: string }[];
const byId = new Map(eow.map((e) => [e.id, e]));
ok(byId.get('eow_imperial_lancer')?.hull === 'npc_eow_imperial_lancer' && byId.get('eow_rebel_transport')?.hull === 'npc_eow_rebel_transport', 'an End of War ship takes the hull whose template has its appearance');
ok(byId.get('eow_corvette')?.hull === 'corellian_corvette' && byId.get('eow_star_destroyer')?.hull === 'star_destroyer' && byId.get('eow_stardestroyer')?.hull === 'star_destroyer', 'one no hull shares the appearance of takes the garage hull the table names');
ok(!byId.has('spacestation_rebel_gcw') && combat.file.skipped.some((s: { id: string; why: string }) => s.id === 'spacestation_rebel_gcw' && /no hull of the ships pack/.test(s.why)), 'one with neither is left out and listed as skipped with why');
ok(byId.get('eow_imperial_lancer')?.name === 'TEST lancer' && byId.get('eow_nebulon_frigate')?.name === 'TEST frigate' && byId.get('spacestation_imperial_gcw')?.name === 'Spacestation Imperial Gcw' && byId.get('eow_corvette')?.faction === 'rebel' && byId.get('spacestation_imperial_gcw')?.faction === 'imperial', "named by the type table, else the template's own name, else words; each for its own side");
ok(combat.file.types.some((t: { id: string; hull: string }) => t.id === 'test_gunboat_tier1' && t.hull === 'npc_abc_gunboat') && !combat.file.skipped.some((s: { id: string }) => /gunboat/.test(s.id)), 'the tiered types an NPC-only hull draws find it by their appearance and are no longer skipped');
ok(/8 End of War ships|7 End of War ships/.test(combatLine(combat.file)), `the combat line says how many End of War ships it lists (${combatLine(combat.file)})`);

// The NPC tab: a row each by name, standable while the garage holds its hull; a stand of one is named and counted as itself.
const list = eow.map((e) => ({ id: e.id, name: e.name, faction: e.faction as 'imperial', hull: e.hull }));
const ready = endOfWarRows(list, new Set(ships.map((s) => s.id)));
ok(ready.every((r) => r.ok && r.why === null) && ready.map((r) => r.name).join() === [...ready.map((r) => r.name)].sort((a, b) => a.localeCompare(b)).join(), 'every row is ready while the garage holds its hull, listed by name');
const gone = endOfWarRows(list, new Set(['xwing']));
ok(gone.filter((r) => !r.ok).length === list.length && gone.every((r) => /not in the garage/.test(r.why ?? '')) && endOfWarRows(list, null).every((r) => r.why === 'the garage is loading'), 'a row whose hull the garage has not got says why, and every row waits while the garage loads');
const hull = { id: 'corellian_corvette', label: 'corellian corvette (gunship)', template: 'object/ship/player/shared_player_corellian_corvette.iff', chassis: 'player_corellian_corvette', bounds: { min: [-20, 0, -66], max: [20, 22, 66] } };
const plan = hullNpcPlan(hull, 'rebel', END_OF_WAR_TUNE.tier, [] as NpcTypeDef[], () => false, { name: 'TEST corvette', endOfWar: 'eow_corvette' });
const plain = hullNpcPlan(hull, 'rebel', 3, [] as NpcTypeDef[], () => false);
ok(plan.type.name === 'TEST corvette' && plan.type.endOfWar === 'eow_corvette' && plan.type.standIn === true && plan.type.faction === 'rebel' && plain.type.endOfWar === undefined && plain.type.name !== 'TEST corvette', "a stand of an End of War ship flies the hull as a type of ours named as itself and counted by its id; a plain hull stand is not");
const was = END_OF_WAR_TUNE.tier;
tuneEndOfWar({ tier: 8 });
const moved = END_OF_WAR_TUNE.tier;
tuneEndOfWar({ tier: 11 as number });
tuneEndOfWar({ tier: 2.5 as number });
ok(was === 5 && moved === 8 && END_OF_WAR_TUNE.tier === 8, `the End of War's tier starts at 5, moves live to a whole tier from 1 to 10 and refuses anything else (${was} -> ${moved} -> ${END_OF_WAR_TUNE.tier})`);
tuneEndOfWar({ tier: was });
// A big hull is never stood inside a ship already out: three End of War ships stood one after another from one spot
// were, and wrecked each other within seconds. `standsInside` answers the first ship out a place's sphere meets.
{
  const out = [{ x: 0, y: 0, z: 700, radius: 170 }, { x: 2000, y: 0, z: 0, radius: 240 }];
  ok(standsInside([{ x: 0, y: 0, z: 700 }], 200, out) === 0, 'a hull stood where a ship already stands is met by it');
  ok(standsInside([{ x: 1500, y: 0, z: 700 }], 200, out) === -1 && standsInside([{ x: 0, y: 0, z: 1071 }], 200, out) === -1, 'and not where their spheres only touch or stand apart');
  ok(standsInside([{ x: 0, y: 0, z: 5000 }, { x: 1900, y: 0, z: 100 }], 200, out) === 1 && standsInside([], 200, out) === -1 && standsInside([{ x: 0, y: 0, z: 0 }], 200, []) === -1, "every member's place is asked, and nothing stands in nothing");
  // What is asked about (`inTheWay`): every ship out whose vehicle has not gone, then every stand still being built, so
  // a second press while the first capital ship is still behind its hold is refused as well.
  const ship = (x: number, radius: number, name: string, disposed = false) => ({ vehicle: { disposed, pos: { x, y: 0, z: 700 }, radius }, type: { name } });
  const coming = [{ x: 0, y: 0, z: 1400, radius: 170, name: 'TEST frigate' }];
  const way = inTheWay([ship(0, 170, 'TEST lancer'), ship(3000, 170, 'TEST gone', true)], coming);
  ok(way.map((w) => w.name).join() === 'TEST lancer,TEST frigate' && way[0].z === 700 && way[0].radius === 170, `the ships out that have not gone, then the stands still being built (${way.map((w) => w.name).join(', ')})`);
  const j = standsInside([{ x: 0, y: 0, z: 1500 }], 200, way);
  ok(j === 1 && way[j].name === 'TEST frigate' && standsInside([{ x: 0, y: 0, z: 1500 }], 200, inTheWay([ship(0, 170, 'TEST lancer')], [])) === -1, 'a hull asked for where a stand is still being built is refused by that stand, which the ships out alone would not have refused');
}

// ---------------------------------------------------------------------------------------------------------
// The ships pack on disk.
const packs = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
const manifestFile = join(packs, 'ships', 'manifest.json');
const combatFile = join(packs, 'ships', 'combat.json');
if (!existsSync(manifestFile) || !existsSync(combatFile)) console.log(`note: no ships pack with a combat.json at ${packs}; the pack checks are skipped`);
else {
  const m = JSON.parse(readFileSync(manifestFile, 'utf8')) as { npcHulls?: number; late?: { state?: string }; ships: { id: string; npc?: boolean; template: string }[]; skipped?: { template: string; why: string; npc?: boolean }[] };
  const c = JSON.parse(readFileSync(combatFile, 'utf8')) as { endOfWar?: { id: string; hull: string }[]; types: { hull: string }[]; skipped: { id: string; why: string }[] };
  if ((m.npcHulls ?? 0) < NPC_HULLS_FORMAT) console.log('note: the ships pack was converted before the NPC-only hulls; its pack checks are skipped (status asks for it)');
  else {
    const npc = m.ships.filter((s) => s.npc);
    ok(npc.length > 0 && npc.every((s) => s.id.startsWith('npc_')) && m.ships.filter((s) => s.id.startsWith('npc_')).every((s) => s.npc), `the NPC-only hulls are marked npc and named npc_ (${npc.length}: ${npc.map((s) => s.id).join(', ')})`);
    const ids = new Set(m.ships.map((s) => s.id));
    ok((c.endOfWar ?? []).every((e) => ids.has(e.hull)) && c.types.every((t) => ids.has(t.hull)), 'every End of War ship and every NPC type flies a hull the manifest holds');
    // Where SOE's final files were mounted every one of the eight is in the archives, and every one has a hull: the two
    // the table names a garage hull for and the five the NPC-only path draws (the GCW stations among them).
    const listed = new Map((c.endOfWar ?? []).map((e) => [e.id, e.hull]));
    if (m.late?.state === 'applied' || m.late?.state === 'final') ok(Object.keys(END_OF_WAR).every((id) => listed.has(id) && ids.has(listed.get(id)!)), `with SOE's final files mounted, all eight End of War ships are listed, each on a hull the manifest holds (${Object.keys(END_OF_WAR).filter((id) => !listed.has(id)).join(', ') || 'all eight'}${c.skipped.filter((s) => Object.hasOwn(END_OF_WAR, s.id)).map((s) => `; ${s.id}: ${s.why}`).join('')})`);
    else console.log('note: the ships pack was converted without SOE\'s final files; the End of War ships are not in its archives');
    // Every appearance an NPC type flies now has a hull of the pack's, so no type is left out for want of one, unless
    // the manifest itself names an NPC-only hull that would not convert.
    const noHull = c.skipped.filter((s) => /^no garage hull/.test(s.why));
    const npcFailed = (m.skipped ?? []).filter((s) => s.npc);
    ok(!noHull.length || npcFailed.length > 0, `no NPC type is left out for want of a hull (${noHull.length}: ${[...new Set(noHull.map((s) => s.why))].slice(0, 4).join('; ') || 'none'}${npcFailed.length ? `; NPC-only hulls that would not convert: ${npcFailed.map((s) => `${s.template} (${s.why})`).join('; ')}` : ''})`);
  }
}

console.log(`\n${passed} checks passed`);
