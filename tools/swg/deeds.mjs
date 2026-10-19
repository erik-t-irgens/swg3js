// The deeds a player buys a building with, and everything needed to put one down.
//
// A deed is four sources joined, and none of them alone is enough:
//
//   1. **The emulator's own scripts** say which building a deed makes (`generatedObjectTemplate`),
//      how many lots it takes, what it costs to keep and which worlds it may stand on. The client's
//      own deed template does **not** say what it makes -- 0 of the 442 in the retail archives name
//      a building -- because that was the server's business and the server's alone.
//   2. **The client's deed template** says what the deed is called and what it says about itself,
//      through its string ids, exactly as every other item in this game is named.
//   3. **The client's building template** says which portal layout the building is, which is what
//      the gallery pack keys its models on -- so it is what turns "this deed makes a house" into
//      "this deed stands up a model this game already carries".
//   4. **The client's footprint** (`.sfp`) says the grid the game drew while you placed it. It hangs
//      off the building rather than the deed: 0 of the 442 deed templates set
//      `structureFootprintFileName` although every one of them declares it, and the value that is
//      really set is reached up the *building's* own chain.
//
// What comes of the join, measured on the retail archives and a Core3 checkout: 111 deeds make a
// player building, all 111 have a retail deed template, 110 reach a footprint, and 47 reach a model
// the gallery pack already carries -- the rest are buildings with no walkable interior (banks,
// garages) or ones the gallery has not converted, and they are written with no model and left out
// of what can be placed rather than silently dropped.
//
// **Nothing here may ever reach the repository.** The checkout is a third-party project under its
// own licence: this reads its data, never its code, and everything written lands in the git-ignored
// output folder exactly as the packs converted from the game's own archives do.
//
// Dependency-free but for node's own modules and this folder's readers; shared with
// tools/swg/tests/deeds.test.ts.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readLua } from './lua.mjs';
import { footprintEntry, footprintFaults, footprintPatch, readFootprint } from './sfp.mjs';

/** Every `.lua` under a folder, deepest first order not mattering. */
function luaFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) luaFiles(p, out);
    else if (e.endsWith('.lua') && !/serverobjects|objects\.lua$/.test(e)) out.push(p);
  }
  return out;
}

/**
 * Every deed the emulator's scripts define that makes a **player building**, with what the scripts
 * say about it.
 *
 * The deed's own retail template is found by the script's path rather than by its name: a script at
 * `object/tangible/deed/player_house_deed/corellia_house_small_deed.lua` is the shared template
 * `object/tangible/deed/player_house_deed/shared_corellia_house_small_deed.iff`, and that join is
 * exact on all 111 of them.
 */
export function readDeeds(scriptsDir) {
  const out = [];
  for (const file of luaFiles(join(scriptsDir, 'object', 'tangible', 'deed'))) {
    let parsed;
    try {
      parsed = readLua(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const [name, v] of parsed.values) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const makes = typeof v.generatedObjectTemplate === 'string' ? v.generatedObjectTemplate : '';
      if (!makes || !/^object\/building\/player\//.test(makes)) continue;
      const rel = file.replace(/\\/g, '/').split('/bin/scripts/')[1];
      if (!rel) continue;
      const template = rel.replace(/\.lua$/, '.iff').replace(/\/([^/]+)$/, '/shared_$1');
      out.push({ key: name, template, makes, id: rel.split('/').pop().replace(/\.lua$/, '') });
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** What the emulator's scripts say about each player building: its lots, its upkeep, its worlds. */
export function readBuildings(scriptsDir) {
  const out = new Map();
  for (const file of luaFiles(join(scriptsDir, 'object', 'building', 'player'))) {
    let parsed;
    try {
      parsed = readLua(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const rel = file.replace(/\\/g, '/').split('/bin/scripts/')[1];
    if (!rel) continue;
    const template = rel.replace(/\.lua$/, '.iff');
    for (const [, v] of parsed.values) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      if (v.lotSize === undefined && v.baseMaintenanceRate === undefined) continue;
      out.set(template, {
        lots: Number.isFinite(v.lotSize) ? Math.max(0, Math.round(v.lotSize)) : 0,
        upkeep: Number.isFinite(v.baseMaintenanceRate) ? Math.max(0, Math.round(v.baseMaintenanceRate)) : 0,
        zones: Array.isArray(v.allowedZones) ? v.allowedZones.filter((z) => typeof z === 'string') : [],
      });
    }
  }
  return out;
}

/**
 * The whole join, as the pack carries it.
 *
 * `deps` hands in what only the caller has: the archives (`has`, `read`), the string lookups, and
 * which model ids the gallery pack really carries. Nothing here opens a file of the game's itself,
 * which is what lets the test run the whole join over fixtures.
 */
export function joinDeeds(deeds, buildings, deps) {
  const rows = [];
  const faults = [];
  const feet = new Map();
  for (const d of deeds) {
    // A deed of ours has no lots, no upkeep and every world: those were the server's, and nothing here invents them.
    const b = (d.ours ? null : buildings.get(d.makes)) ?? { lots: 0, upkeep: 0, zones: [] };
    const layout = deps.templateString(d.makes, ['portalLayoutFilename']);
    const model = layout ? layout.split('/').pop().replace(/\.[^.]+$/, '') : null;
    const footFile = deps.templateString(d.makes, ['structureFootprintFileName']) ?? deps.templateString(d.template, ['structureFootprintFileName']);
    let foot = null;
    if (footFile && deps.has(footFile)) {
      if (!feet.has(footFile)) {
        const f = readFootprint(deps.read(footFile));
        const bad = footprintFaults(f);
        if (bad.length) faults.push(`${footFile}: ${bad.join('; ')}`);
        feet.set(footFile, f && !bad.length ? f : null);
      }
      foot = feet.get(footFile);
    }
    // A deed of ours (`OUR_DEEDS`) takes its building's name where its own names a table the client lacks.
    const name = deps.name(d.template) || (d.ours ? deps.name(d.makes) : null);
    rows.push({
      id: d.id,
      name: name || wordsFrom(d.id),
      named: !!name,
      desc: deps.desc(d.template) || (d.ours ? deps.desc(d.makes) || '' : ''),
      makes: d.makes,
      model: model && deps.hasModel(model) ? model : null,
      layout: model,
      lots: b.lots,
      upkeep: b.upkeep,
      zones: b.zones,
      foot: foot ? footprintEntry(foot) : null,
      patch: foot ? round4(footprintPatch(foot)) : null,
      ...(d.ours ? { ours: true } : {}),
    });
  }
  return { rows, faults };
}

/**
 * Deeds of ours [ours, from the client's own names]: every client house deed Core3's scripts do not know, paired with
 * the client building it makes by the two templates' own names, since no client file pairs a deed with its building
 * (that was the server's). Each row goes through `joinDeeds` as a Core3 row does -- the layout, the model and the
 * footprint from the building, the name from the deed falling back to the building's -- with no lots, no upkeep and
 * every world (`zones: []`), and marked `ours`, since those three were the server's and nothing here invents them.
 * Where two deeds make one building (the Dathomir huts' plain and `_01` deeds) the first listed is the row, the one
 * the client names. The houses SOE's last publishes added come first, then the older player houses and the trading
 * card buildings Core3 never had a deed for.
 */
export const OUR_DEEDS = [
  ['object/tangible/deed/player_house_deed/shared_yt1300_house_deed.iff', 'shared_player_house_yt1300.iff'],
  ['object/tangible/deed/player_house_deed/shared_tree_house_01_deed.iff', 'shared_player_house_tree_house_01.iff'],
  ['object/tangible/deed/player_house_deed/shared_jabbas_sail_barge_deed.iff', 'shared_player_house_jabbas_sail_barge.iff'],
  ['object/tangible/deed/player_house_deed/shared_player_house_tcg_8_bespin_house_deed.iff', 'shared_player_house_tcg_8_bespin_house.iff'],
  ['object/tangible/deed/player_house_deed/shared_player_house_tcg_8_yoda_house.iff', 'shared_player_house_tcg_8_yoda_house.iff'],
  ['object/tangible/deed/player_house_deed/shared_wod_ns_hut_deed.iff', 'shared_player_house_wod_ns_hut.iff'],
  ['object/tangible/deed/player_house_deed/shared_wod_ns_hut_01_deed.iff', 'shared_player_house_wod_ns_hut.iff'],
  ['object/tangible/deed/player_house_deed/shared_wod_sm_hut_deed.iff', 'shared_player_house_wod_sm_hut.iff'],
  ['object/tangible/deed/player_house_deed/shared_wod_sm_hut_01_deed.iff', 'shared_player_house_wod_sm_hut.iff'],
  ['object/tangible/deed/player_house_deed/shared_generic_house_large_window_s01_deed.iff', 'shared_player_house_generic_large_window_s01.iff'],
  ['object/tangible/deed/player_house_deed/shared_generic_house_large_window_s02_deed.iff', 'shared_player_house_generic_large_window_s02.iff'],
  ['object/tangible/deed/player_house_deed/shared_generic_house_medium_windowed_deed.iff', 'shared_player_house_generic_medium_windowed.iff'],
  ['object/tangible/deed/player_house_deed/shared_generic_house_medium_windowed_s02_deed.iff', 'shared_player_house_generic_medium_windowed_s02.iff'],
  ['object/tangible/deed/player_house_deed/shared_generic_house_small_window_deed.iff', 'shared_player_house_generic_small_windowed.iff'],
  ['object/tangible/deed/player_house_deed/shared_generic_house_small_window_style_03_deed.iff', 'shared_player_house_generic_small_window_style_03.iff'],
  ['object/tangible/deed/player_house_deed/shared_naboo_house_small_window_deed.iff', 'shared_player_house_naboo_small_window_style_01.iff'],
  ['object/tangible/deed/player_house_deed/shared_tatooine_house_window_small_deed.iff', 'shared_player_house_tatooine_small_window_style_01.iff'],
  ['object/tangible/deed/player_house_deed/shared_mustafar_house_lg.iff', 'shared_player_house_mustafar_lg.iff'],
  ['object/tangible/tcg/series1/shared_structure_deed_barn.iff', 'shared_barn_no_planet_restriction.iff'],
  ['object/tangible/tcg/series1/shared_structure_deed_diner.iff', 'shared_diner_no_planet_restriction.iff'],
  ['object/tangible/tcg/series3/shared_structure_deed_jedi_meditation_room_deed.iff', 'shared_player_house_jedi_meditation_room.iff'],
  ['object/tangible/tcg/series3/shared_structure_deed_sith_meditation_room_deed.iff', 'shared_player_house_sith_meditation_room.iff'],
  ['object/tangible/tcg/series4/shared_structure_deed_relaxation_pool.iff', 'shared_player_house_tcg_relaxation_pool.iff'],
  ['object/tangible/tcg/series5/shared_structure_deed_player_house_atat.iff', 'shared_player_house_atat.iff'],
  ['object/tangible/tcg/series5/shared_structure_deed_player_house_hangar.iff', 'shared_player_house_hangar.iff'],
  ['object/tangible/tcg/series6/shared_structure_deed_emperors_spire.iff', 'shared_player_house_tcg_emperors_spire.iff'],
  ['object/tangible/tcg/series6/shared_structure_deed_rebel_spire.iff', 'shared_player_house_tcg_rebel_spire.iff'],
  ['object/tangible/tcg/series7/shared_structure_deed_commando_bunker.iff', 'shared_player_house_tcg_commando_bunker.iff'],
  ['object/tangible/tcg/series7/shared_structure_deed_vehicle_garage.iff', 'shared_player_house_tcg_vehicle_garage.iff'],
  ['object/tangible/tcg/series7/shared_structure_deed_vip_bunker.iff', 'shared_player_house_tcg_vip_bunker.iff'],
];

/**
 * A building template's path with its file name's `shared_` taken off, lower case: the one spelling a client
 * template (`object/building/player/shared_player_house_yt1300.iff`) and the server template Core3's rows name
 * (`object/building/player/player_house_yt1300.iff`) share, as `readDeeds` joins a script to its client deed.
 */
export const buildingKey = (path) => String(path ?? '').toLowerCase().replace(/\\/g, '/').replace(/\/shared_([^/]+)$/, '/$1');

/**
 * The deeds of ours this install's archives can stand (`OUR_DEEDS`), in the shape `readDeeds` gives a Core3 deed,
 * marked `ours`: one a building, the first listed winning, only where the deed and its building are in the archives
 * and Core3 has no deed making that building already (`known`, the buildings Core3's own rows make, server paths
 * compared with the client's by `buildingKey`). `buildingOf` finds a building template by its file name (the folder
 * under `object/building/player/` is the client's).
 */
export function ourDeeds({ has, buildingOf, known = new Set() }) {
  const out = [];
  const taken = new Set([...known].map(buildingKey));
  for (const [template, building] of OUR_DEEDS) {
    if (!has(template)) continue;
    const makes = buildingOf(building);
    if (!makes || taken.has(buildingKey(makes))) continue;
    taken.add(buildingKey(makes));
    const id = template.split('/').pop().replace(/^shared_/, '').replace(/\.iff$/, '');
    out.push({ key: id, template, makes, id, ours: true });
  }
  return out;
}

/** Words out of a key, for a deed the string tables have no name for. */
export function wordsFrom(id) {
  return id
    .replace(/_deed$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function round4(p) {
  return { hx: Math.round(p.hx * 1e4) / 1e4, hz: Math.round(p.hz * 1e4) / 1e4, cx: Math.round(p.cx * 1e4) / 1e4, cz: Math.round(p.cz * 1e4) / 1e4 };
}

/** What `status` and the conversion print about a run. */
export function deedCounts(rows) {
  return {
    deeds: rows.length,
    named: rows.filter((r) => r.named).length,
    withModel: rows.filter((r) => r.model).length,
    withFoot: rows.filter((r) => r.foot).length,
    withLots: rows.filter((r) => r.lots > 0).length,
  };
}
