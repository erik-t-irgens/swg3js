// Every prop in the game as one pack, and the rules about what is one.
//
// Run: node tools/swg/tests/props.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROPS_PACK_VERSION, buildProps, isProp, propCounts, propGroup, propId, propSize } from '../props.mjs';
import { atBase, traceHash } from './atBase.ts';
import { mountRetail } from './materialsHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

// ---------------------------------------------------------------- what is a prop

{
  ok(isProp('object/tangible/furniture/all/shared_frn_all_chair_s01.iff'), 'a chair is a prop');
  ok(isProp('object/static/structure/general/shared_streetlamp_small.iff'), 'and a streetlamp');
  ok(isProp('object/installation/faction_perk/turret/shared_tower_lg.iff'), 'and a turret, which is scenery a player may want to stand');
  // Each of these the game already has a home for, and one of them is a judgement.
  ok(!isProp('object/tangible/wearables/shirt/shared_shirt_s01.iff'), 'a shirt is not: the wardrobe has it');
  ok(!isProp('object/weapon/ranged/pistol/shared_pistol_dl44.iff'), 'nor a weapon: the rack has it');
  ok(!isProp('object/tangible/ship/shared_cmp_engine.iff'), 'nor a ship part');
  ok(!isProp('object/draft_schematic/item/shared_item_firework_one.iff'), 'nor a schematic, which is a recipe and not a thing');
  // The space stations are the one exclusion worth stating: the space command already converts every
  // one of them, and they are hundreds of metres across.
  ok(!isProp('object/static/space/shared_spacestation_imperial.iff'), 'and not a space station, which the space packs already carry');
  ok(!isProp('object/tangible/space/shared_spacestation_rebel.iff'), 'under either of its two folders');
  ok(!isProp('object/tangible/furniture/all/frn_all_chair_s01.iff'), 'a template that is not the shared one is not a prop either');
}

// ---------------------------------------------------------------- the trading-card decorations
{
  const app = (a: string) => () => a;
  ok(isProp('object/tangible/tcg/series8/shared_combine_decorative_bespin_lamp.iff', app('appearance/frn_bespin_lamp.apt')), 'a trading-card decoration is a prop');
  ok(!isProp('object/tangible/tcg/series1/shared_structure_deed_barn.iff', app('appearance/eqp_tool_datapad.apt')) && !isProp('object/tangible/tcg/series3/shared_vehicle_deed_mechno_chair.iff'), 'its structure and vehicle deeds are not');
  ok(!isProp('object/tangible/tcg/series2/shared_greeter_deed_ewok.iff', app('appearance/frn_all_data_terminal_wall_s3.apt')) && !isProp('object/tangible/tcg/series4/shared_instant_travel_terminal_deed.iff'), 'nor any other deed, nor an instant travel terminal');
  ok(!isProp('object/tangible/tcg/series5/shared_house_capacity_organizational_datapad.iff', app('appearance/item_tcg_datapad_s01.apt')), 'nor one drawn as a datapad');
  ok(isProp('object/tangible/tcg/series5/shared_decorative_thing.iff'), 'and with no appearance known, a decoration by its name is taken');
}
{
  // Day one: every template the rule took at the pass's base is still taken (the change only admits trading cards).
  // Today's rule is asked with an appearance that calls everything a datapad, so a trading-card refusal (by name or by
  // look) leaking out of tcg/ shows as a loss. Over the archives' own templates when this machine has them, else over
  // a hand sample; where git cannot hand the base over, today's answers for the sample are held to the base's hash.
  const old = await atBase<{ isProp: typeof isProp }>('tools/swg/props.mjs');
  const datapad = () => 'appearance/eqp_tool_datapad.apt';
  const TCG = /\/tcg\//;
  const sample = ['object/tangible/furniture/all/shared_frn_all_chair_s01.iff', 'object/static/structure/general/shared_streetlamp_small.iff', 'object/installation/faction_perk/turret/shared_tower_lg.iff', 'object/tangible/wearables/shirt/shared_shirt_s01.iff', 'object/tangible/ship/shared_cmp_engine.iff', 'object/static/space/shared_spacestation_imperial.iff', 'object/tangible/deed/player_house_deed/shared_yt1300_house_deed.iff', 'object/tangible/loot/creature/shared_bone.iff', 'object/tangible/hair/human/shared_hair_human_male_s01.iff', 'object/tangible/tcg/series1/shared_decorative_x.iff', 'object/tangible/crafting/station/shared_food_station.iff', 'object/tangible/painting/shared_painting_wod_s01.iff', 'object/tangible/furniture/decorative/shared_datapad_deed_display.iff'];
  const kept = sample.filter((t) => !TCG.test(t));
  const trace = (f: (t: string) => boolean) => kept.map((t) => [t, f(t)]);
  const BASE_TRACE = '533491c78828';
  const judge = (templates: string[], what: string) => {
    const lost = templates.filter((t) => old!.isProp(t) && !isProp(t, datapad));
    const gained = templates.filter((t) => !old!.isProp(t) && isProp(t));
    ok(!lost.length && gained.every((t) => TCG.test(t)), `day one, ${what}: nothing the rule took at the pass's base is left out, and only trading cards are added (${templates.length} templates, ${gained.length} gained${lost.length ? `; lost ${lost.slice(0, 5).join(', ')}` : ''})`);
  };
  if (old) {
    judge(sample, 'a hand sample');
    const then = traceHash(trace(old.isProp));
    if (then !== BASE_TRACE) note(`the base's trace hashes to ${then}; write it as BASE_TRACE so a checkout without git still holds today's to it`);
    else ok(true, `and that trace is the one written down here (${BASE_TRACE})`);
    const vfs = await mountRetail();
    if (!vfs) note('no SWG install on this machine: day one is held over the hand sample alone');
    else {
      judge(vfs.list('object/').filter((t: string) => t.startsWith('object/')), "every template the archives hold");
      (vfs as { close?: () => void }).close?.();
    }
  } else {
    note("git cannot hand over props.mjs as it stood at the pass's base: today's answers for the sample are held to the trace written down here");
    ok(traceHash(trace((t) => isProp(t, datapad))) === BASE_TRACE, `day one: every template of the sample outside tcg/ is taken or refused as the base did (${traceHash(trace((t) => isProp(t, datapad)))}, written ${BASE_TRACE})`);
  }
}

{
  ok(propId('object/tangible/furniture/all/shared_frn_all_chair_s01.iff') === 'frn_all_chair_s01', "a prop's id is its template's own name");
  ok(propGroup('object/tangible/furniture/all/shared_frn_all_chair_s01.iff') === 'tangible/furniture', 'and its group the two folders below object/, which is the game\'s own arrangement');
  const s = propSize({ min: [-0.5, 0, -0.4], max: [0.5, 1.2, 0.4] });
  ok(s.w === 1 && s.h === 1.2 && s.d === 0.8, 'its size is its box, in metres');
  ok(propSize(null).h === 0, 'and a thing with no box has none rather than throwing');
}

// ---------------------------------------------------------------- the build

{
  const convert = (t: string) => (/bad/.test(t) ? { skip: 'resolve failed' } : { model: 'm', file: 'm.glb', bounds: { min: [0, 0, 0], max: [1, 1, 1] }, icon: 'icons/m.png' });
  const templates = [
    'object/tangible/furniture/all/shared_a.iff',
    'object/tangible/furniture/all/shared_b.iff',
    'object/static/structure/general/shared_bad.iff',
    'object/tangible/wearables/shirt/shared_c.iff',
  ];
  const { props, skipped } = buildProps(templates, { convert, describe: () => ({ name: 'A thing', description: 'a thing', slots: null }) });
  ok(props.length === 2, 'every prop that converts is in the pack');
  ok(skipped.length === 1 && /resolve failed/.test(skipped[0].why), 'one that does not is named with why');
  ok(!props.some((p) => /wearables/.test(p.template)), 'and a shirt was never a candidate');
  ok(props[0].name === 'A thing', "the game's own name is carried");
  const c = propCounts({ props });
  ok(c.props === 2 && c.models === 1, 'two things on one model, because a template is a thing and an appearance is a model');
}

// ---------------------------------------------------------------- the real pack

{
  const file = join('assets-private', 'props', 'manifest.json');
  if (!existsSync(file)) note("no props pack here (npm run swg -- props '@SWG' assets-private --retail-only)");
  else {
    const m = JSON.parse(readFileSync(file, 'utf8')) as { version: number; props: { id: string; model: string; file: string; group: string; name?: string | null }[]; models: { id: string; file: string }[] };
    ok(m.version === PROPS_PACK_VERSION, 'the pack is the shape this build reads');
    const c = propCounts(m);
    ok(c.props > 5000, `${c.props} props in ${c.models} models over ${c.groups} groups`);
    ok(c.named / c.props > 0.8, `${c.named} of them carry the game's own name (${Math.round((c.named / c.props) * 100)}%)`);
    ok(c.iconed / c.props > 0.9, `${c.iconed} have a picture, which is what the list shows`);
    // Every prop must name a model the pack really holds, or the list offers a thing that cannot be
    // put down -- the same check the fittings' own test makes, for the same reason.
    const have = new Set(m.models.map((d) => d.id));
    const lost = m.props.filter((p) => !have.has(p.model));
    assert.ok(lost.length === 0, `every prop names a model the pack lists (${lost.slice(0, 3).map((p) => p.id).join(', ')})`);
    passed++;
    console.log('ok   and every one of them names a model the pack really lists');
    // And that model's file is really on disk.
    let missing = 0;
    for (const d of m.models) if (!existsSync(join('assets-private', 'props', d.file))) missing++;
    ok(missing === 0, `and all ${m.models.length} model files are on disk`);
    // Nothing enormous: the space stations are out, so what is left is furniture and structures a
    // player might really stand. This is what would trip if that exclusion were ever lost.
    // The cap is the pack's own late world's: 974 MB measured on the mount before SOE's final names list, 1,228 MB
    // with it (729 more props, 275 of them trading-card decorations, none of them a space station). The skeletal props
    // (a `.sat` drawn still, which a pack written so marks `skeletal` on the model) are held to a cap of their own:
    // 221 MB over 366 models measured on SOE complete's pilot conversion, none of them a station.
    const bytes = (skeletal: boolean) => m.models.filter((d) => !!(d as { skeletal?: boolean }).skeletal === skeletal).reduce((a, d) => a + statSync(join('assets-private', 'props', d.file)).size, 0);
    const late = (m as { late?: { state?: string } }).late?.state;
    const cap = late === 'applied' || late === 'final' ? 1400 : 1100;
    ok(bytes(false) / 1e6 < cap, `the pack's static models are ${(bytes(false) / 1e6).toFixed(0)} MB, which is under the cap of ${cap} MB that would say the space stations had crept back in`);
    ok(bytes(true) / 1e6 < 300, `and its skeletal props ${(bytes(true) / 1e6).toFixed(0)} MB, under their own cap of 300 MB`);
  }
}

console.log(`\n${passed} checks passed`);
