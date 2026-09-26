// Every prop in the game as one pack, and the rules about what is one.
//
// Run: node tools/swg/tests/props.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROPS_PACK_VERSION, buildProps, isProp, propCounts, propGroup, propId, propSize } from '../props.mjs';

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
    const bytes = m.models.reduce((a, d) => a + statSync(join('assets-private', 'props', d.file)).size, 0);
    ok(bytes / 1e6 < 1100, `the whole pack's models are ${(bytes / 1e6).toFixed(0)} MB, which is under the cap that would say the space stations had crept back in`);
  }
}

console.log(`\n${passed} checks passed`);
