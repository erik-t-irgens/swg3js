// The ship edit page's rules (src/ui/shipEditModel.ts): how a slot's components are grouped (by the look
// each shows on this hull, "No model on this hull", "(empty)" last), what a pick keeps (stock and the
// shader's own default are absent), and the words beside each row. Synthetic tables only.
import assert from 'node:assert/strict';
import { copyFit, paintCountText, paintLabel, pickComponent, pickPaintValue, slotChoices, slotCountText, slotSections, slotWord } from '../../../src/ui/shipEditModel.ts';
import { resolveFit, componentIndex, stockFit, type ComponentDef, type FitDef, type ShipFit } from '../../../src/vehicles/shipFit.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const components: ComponentDef[] = [
  { name: 'eng_s01_a', type: 'engine', compat: 'eng_0', label: 'Engine A', template: 't/eng_a' }, // 0
  { name: 'eng_s01_b', type: 'engine', compat: 'eng_0', label: 'Engine B', template: 't/eng_b' }, // 1
  { name: 'eng_s02', type: 'engine', compat: 'eng_0', label: 'Engine C', template: 't/eng_c' }, // 2
  { name: 'eng_nomodel', type: 'engine', compat: 'eng_0', label: 'Engine D', template: 't/eng_d' }, // 3
  { name: 'eng_loose', type: 'engine', compat: 'eng_9, eng_0', label: 'Engine E', template: 't/eng_e' }, // 4: a comma list, in no look
  { name: 'eng_test', type: 'engine', compat: 'eng_0', label: 'Engine Test', template: 't/eng_test' }, // 5: a test component
  { name: 'rct_basic', type: 'reactor', compat: 'rct_0', label: 'Reactor', template: 't/rct' }, // 6
  { name: 'rct_hot', type: 'reactor', compat: 'rct_0', label: 'Hot reactor', template: 't/rct_hot' }, // 7
  { name: 'wpn_red', type: 'weapon', compat: 'wpn_0', label: 'Red', template: 't/red', weapon: { projectile: 4, speed: 600, range: 512 } }, // 8
];
const index = componentIndex(components);

const def: FitDef = {
  chassis: 'player_testwing',
  droid: 'astromech',
  slots: [
    { slot: 'reactor', compat: ['rct_0'], looks: [], stock: 'rct_basic' },
    {
      slot: 'engine',
      compat: ['eng_0'],
      stock: 'eng_s01_a',
      looks: [
        { parts: [{ file: 'eng_s01.glb', hardpoint: 'engine_pos1', template: 't/p1' }], components: [0, 1] },
        { parts: [{ file: 'eng_s02.glb', hardpoint: 'engine_pos1', template: 't/p2' }], components: [2] },
        { parts: [], components: [3], noModel: true },
      ],
    },
    { slot: 'weapon_0', compat: ['wpn_0'], stock: 'wpn_red', looks: [{ parts: [{ file: 'gun.glb', hardpoint: 'weapon1_pos1', template: 't/g' }], components: [8] }] },
    { slot: 'modification_0', compat: ['mod_x'], stock: null, looks: [] },
    { slot: 'weapon_8', compat: [], stock: 'wpn_red', fixed: true, looks: [{ parts: [{ file: 'base.glb', hardpoint: 'turret8', template: 't/b' }], components: [8] }] },
  ],
  paint: {
    shaders: ['shader/testwing.sht'],
    variables: [
      { name: 'index_texture_1', kind: 'index', count: 8, fewest: 2, default: 0 },
      { name: 'index_color_1', kind: 'palette', palette: 'palette/p.pal', size: 64, default: 40 },
    ],
  },
};
const engine = def.slots[1];
const reactor = def.slots[0];

// --- grouping ---------------------------------------------------------------------------------------
{
  const c = slotChoices(engine, components, 'eng_s01_b');
  ok(c.groups.length === 4, 'the engine offers its three looks and one loose group');
  ok(c.groups[0].label === 'Look 1 (2)' && c.groups[1].label === 'Look 2 (1)', 'a look group is labelled with its place and how many show it');
  ok(c.groups[2].label === 'Look 3 (no model)', 'a look with no model says so');
  ok(c.groups[3].label === 'No model on this hull', 'components the slot takes that no look lists come last, as "No model on this hull"');
  ok(c.groups[3].options.map((o) => o.name).join() === 'eng_loose', 'a comma-list class that includes the slot\'s is offered; a test component never is');
  ok(c.groups[0].options.find((o) => o.name === 'eng_s01_a')?.stock === true, 'the stock component is marked');
  ok(c.groups[0].options.find((o) => o.name === 'eng_s01_b')?.selected === true && !c.emptySelected, 'the fitted component is selected, and "(empty)" is not');
  ok(c.extra === null, 'nothing extra when the fitted component is listed');
}
{
  const c = slotChoices(engine, components, null);
  ok(c.emptySelected && c.groups.every((g) => g.options.every((o) => !o.selected)), 'an empty slot selects "(empty)" alone');
}
{
  const c = slotChoices(engine, components, 'eng_gone');
  ok(c.extra === 'eng_gone', 'a fitted component no list carries is named so the select still says what is fitted');
}
{
  const c = slotChoices(reactor, components, 'rct_basic');
  ok(c.groups.length === 1 && c.groups[0].label === null, 'a slot with no looks lists its components without a group');
  ok(c.groups[0].options.map((o) => o.name).join() === 'rct_basic,rct_hot', 'the systems slot lists what it takes, in table order');
}
{
  const s = slotSections(def);
  ok(s.fixed === 1, 'the fixed slot is counted, not offered');
  ok(s.visual.map((x) => x.slot).join() === 'engine,weapon_0', 'the slots with looks are the Components section');
  ok(s.systems.map((x) => x.slot).join() === 'reactor,modification_0', 'the slots without looks are the Systems section');
}

// --- what a pick keeps ------------------------------------------------------------------------------
{
  const fit: ShipFit = stockFit();
  ok(pickComponent(fit, def, 'engine', 'eng_s02') && fit.components.engine === 'eng_s02', 'a component other than stock is kept');
  ok(pickComponent(fit, def, 'engine', 'eng_s01_a') && !('engine' in fit.components), 'the stock component is kept as absent');
  ok(pickComponent(fit, def, 'weapon_0', '') && fit.components.weapon_0 === '', "'' keeps a slot empty");
  ok(pickComponent(fit, def, 'modification_0', '') && !('modification_0' in fit.components), "'' on a slot whose stock is empty is stock, so absent");
  ok(!pickComponent(fit, def, 'weapon_8', 'eng_s02') && !('weapon_8' in fit.components), 'a fixed slot takes no pick');
  ok(!pickComponent(fit, def, 'no_slot', 'x'), 'a slot the hull lacks takes no pick');
  ok(pickComponent(fit, def, 'droid', 'r2') && fit.droid === 'r2', 'the droid is kept');
  ok(pickComponent(fit, def, 'droid', '') && !('droid' in fit), 'no droid is absent');
  ok(pickPaintValue(fit, def, 'index_color_1', 20) && fit.paint.index_color_1 === 20, 'a colour other than the default is kept');
  ok(pickPaintValue(fit, def, 'index_color_1', 40) && !('index_color_1' in fit.paint), "the shader's own default is kept as absent");
  ok(!pickPaintValue(fit, def, 'index_color_9', 3), 'a variable the hull lacks takes no pick');
  const r = resolveFit(def, components, index, [{ id: 'r2', kind: 'astromech', label: 'R2', model: null }], fit);
  ok(r.components.weapon_0 === null && r.components.engine === 'eng_s01_a' && !r.painted, 'what the page keeps resolves as the page shows it');
}
{
  const a: ShipFit = { components: { engine: 'eng_s02' }, paint: { index_color_1: 3 }, droid: 'r2' };
  const b = copyFit(a);
  b.components.engine = 'x';
  b.paint.index_color_1 = 9;
  ok(a.components.engine === 'eng_s02' && a.paint.index_color_1 === 3 && b.droid === 'r2', 'the page edits its own copy of the kept fit');
  ok(!('droid' in copyFit(stockFit())), 'a copy of a fit with no droid has none');
}

// --- words ------------------------------------------------------------------------------------------
ok(slotCountText(engine, 'eng_s01_a', 0) === 'look 1/3 · stock', 'a stock component on a look');
ok(slotCountText(engine, 'eng_nomodel', 2) === 'look 3/3, no model', 'a component on a look with no model');
ok(slotCountText(engine, 'eng_loose', -1) === 'no model', 'a component no look lists');
ok(slotCountText(engine, null, -1) === 'empty', 'an empty slot');
ok(slotCountText(reactor, 'rct_hot', -1) === 'fitted' && slotCountText(reactor, 'rct_basic', -1) === 'fitted · stock', 'a systems slot is fitted or empty');
ok(slotCountText(def.slots[3], null, -1) === 'empty', 'an empty slot whose stock is empty is not called stock');
ok(paintLabel('index_texture_1') === 'Pattern' && paintLabel('index_texture_2') === 'Pattern 2' && paintLabel('index_texture_10') === 'Pattern 10', 'patterns are named');
ok(paintLabel('index_color_2') === 'Colour 2' && paintLabel('private_hue_trim') === 'Hue trim', 'colours and other variables are named');
ok(paintCountText(def.paint!.variables[0], 2) === 'Pattern 3 of 8 (some parts have 2)', "a pattern's own label");
ok(paintCountText(def.paint!.variables[1], 20, 64) === '21/64' && paintCountText(def.paint!.variables[1], 0) === '1/64', "a colour's place in its palette");
ok(slotWord(def, 'engine') === 'engine' && slotWord(def, 'droid') === 'droid' && slotWord(def, 'odd_slot') === 'odd slot', 'a slot named in a sentence');

console.log(`shipEdit: ${checks} checks passed`);
