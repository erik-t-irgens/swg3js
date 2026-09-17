// The effects registry, checked without a browser. Every effect's settings key, menu knob, place
// in the chain, shared products and cost budget live in one dependency-free list, so this is where
// two effects written apart are caught claiming the same key, the same place, or more milliseconds
// than the frame has. It also checks that a settings file saved before the effects had a registry
// of their own still means what it did.
import assert from 'node:assert/strict';
import { FX_DEFAULTS, FX_KNOBS, FX_LAYERS, FX_PASSES, FX_PRODUCTS, FX_TYPICAL_BUDGET_MS, fxPassDef, fxPassIndex, fxProductDef, isFxSettingKey, type FxProductId, type FxSettings } from '../../../src/core/fxRegistry.ts';
import { DEFAULT_SETTINGS, migrateSettings } from '../../../src/core/settings.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

const defaultKeys = Object.keys(FX_DEFAULTS) as (keyof FxSettings)[];

// --- nothing is claimed twice ---

const passIds = FX_PASSES.map((p) => p.id);
ok(new Set(passIds).size === passIds.length, `${passIds.length} pass ids, all different`);
const productIds = FX_PRODUCTS.map((p) => p.id);
ok(new Set(productIds).size === productIds.length, `${productIds.length} product ids, all different`);
ok(new Set(defaultKeys).size === defaultKeys.length, `${defaultKeys.length} settings keys, all different`);

// --- every key has exactly one knob, and the knob matches the default ---

const knobKeys = FX_KNOBS.map((k) => k.key);
ok(new Set(knobKeys).size === knobKeys.length, 'no key has two knobs');
for (const key of defaultKeys) ok(knobKeys.includes(key), `the setting "${key}" has a knob`);
for (const key of knobKeys) ok(key in FX_DEFAULTS, `the knob "${key}" has a default`);

for (const knob of FX_KNOBS) {
  const value = FX_DEFAULTS[knob.key];
  if (knob.kind === 'toggle') ok(typeof value === 'boolean', `"${knob.key}" is a switch and its default is a yes or a no`);
  else ok(typeof value === 'number', `"${knob.key}" is a ${knob.kind} and its default is a number`);
  if (knob.kind === 'range') {
    ok(typeof knob.min === 'number' && typeof knob.max === 'number' && typeof knob.step === 'number', `"${knob.key}" states its range`);
    ok((value as number) >= knob.min! && (value as number) <= knob.max!, `"${knob.key}" default ${value} sits inside ${knob.min} to ${knob.max}`);
  }
  if (knob.kind === 'select') {
    ok(!!knob.options?.length, `"${knob.key}" states its choices`);
    ok(knob.options!.some((o) => o.value === value), `"${knob.key}" default ${value} is one of its choices`);
  }
  for (const req of knob.requires) {
    ok(req in FX_DEFAULTS, `"${knob.key}" waits on "${req}", which is a setting`);
    ok(typeof FX_DEFAULTS[req] === 'boolean', `"${knob.key}" waits on "${req}", which is a switch`);
  }
  if (knob.pass) ok(fxPassDef(knob.pass).id === knob.pass, `"${knob.key}" belongs to the pass "${knob.pass}"`);
  if (knob.product) ok(fxProductDef(knob.product).id === knob.product, `"${knob.key}" waits on the product "${knob.product}"`);
  ok(knob.label.length > 0 && knob.hint.length > 0, `"${knob.key}" has a name and a word of explanation`);
}

// --- the order of the chain ---

ok(FX_PASSES[0].id === 'sanitize', 'the first pass is the one that cleans the picture');
ok(FX_PASSES[0].required, 'and it is always drawn');

const STAGE_ORDER = { scene: 0, lens: 1, display: 2 };
let stage = 0;
for (const def of FX_PASSES) {
  const here = STAGE_ORDER[def.stage];
  ok(here >= stage, `"${def.id}" is a ${def.stage} pass and nothing has gone past that stage yet`);
  stage = here;
}

const required = FX_PASSES.filter((p) => p.required).map((p) => p.id);
ok(required.length === 2 && required.includes('sanitize') && required.includes('output'), 'exactly two passes are always drawn: the clean-up and the output');
const firstDisplay = FX_PASSES.find((p) => p.stage === 'display');
ok(firstDisplay?.id === 'output', 'the output pass is the first of the display passes, so tone mapping happens once and before anything that needs it');
for (const def of FX_PASSES) {
  if (def.canBeLast) ok(def.stage === 'display', `"${def.id}" may draw to the canvas, so it is a display pass`);
}
ok(FX_PASSES[FX_PASSES.length - 1].canBeLast, 'the last pass in the list can draw to the canvas');
for (const def of FX_PASSES) ok(fxPassIndex(def.id) === FX_PASSES.indexOf(def), `"${def.id}" is found at its own place`);

// A pass draws when any one of the settings it names is on, so each of them has to be a yes or a
// no: a strength among them would be a number the runner reads as "always on", and the pass's own
// switch would stop meaning anything.
for (const def of FX_PASSES) {
  for (const key of def.toggles) {
    ok(key in FX_DEFAULTS, `the pass "${def.id}" is turned on by "${key}", which is a setting`);
    ok(typeof FX_DEFAULTS[key] === 'boolean', `the pass "${def.id}" is turned on by "${key}", which is a switch`);
  }
}

// --- products ---

for (const def of FX_PASSES) for (const need of def.needs) ok(productIds.includes(need), `the pass "${def.id}" asks for "${need}", which is a product`);
FX_PRODUCTS.forEach((def, i) => {
  for (const need of def.needs) {
    const at = productIds.indexOf(need);
    ok(at >= 0 && at < i, `the product "${def.id}" is built from "${need}", which is computed before it`);
  }
  if (def.kind === 'geometry') ok(def.scale === 1, `the geometry product "${def.id}" is full size, since it shares the scene's depth`);
});
let seenGeometry = false;
for (const def of FX_PRODUCTS) {
  if (def.kind === 'geometry') seenGeometry = true;
  else ok(!seenGeometry, `the depth product "${def.id}" comes before every geometry product`);
}
for (const def of FX_PRODUCTS) {
  if (def.owner !== 'spine') ok(passIds.includes(def.owner), `the product "${def.id}" belongs to the pass "${def.owner}"`);
}

// --- what a typical frame costs ---

/** Products a typical pass may ask for that are still not computed in a typical frame. */
const NOT_IN_A_TYPICAL_FRAME: Partial<Record<FxProductId, string>> = { waterMask: 'there is no water in view in a typical outdoor frame' };
let typical = 0;
for (const def of FX_PRODUCTS) if (def.typical) typical += def.budgetMs;
for (const def of FX_PASSES) if (def.typical) typical += def.budgetMs;
typical = Number(typical.toFixed(3));
ok(typical <= FX_TYPICAL_BUDGET_MS + 1e-6, `a typical frame's effects come to ${typical.toFixed(2)} ms, inside the ${FX_TYPICAL_BUDGET_MS.toFixed(2)} ms the frame allows`);
console.log(`     margin ${(FX_TYPICAL_BUDGET_MS - typical).toFixed(2)} ms`);
for (const def of FX_PASSES) {
  if (!def.typical) continue;
  for (const need of def.needs) {
    const product = fxProductDef(need);
    ok(product.typical || !!NOT_IN_A_TYPICAL_FRAME[need], `the typical pass "${def.id}" asks for "${need}", which is either counted or has a stated reason not to run`);
  }
}

// --- layers ---

for (const [name, layer] of Object.entries(FX_LAYERS)) {
  ok(Number.isInteger(layer), `the layer "${name}" is a whole number`);
  ok(layer >= 2 && layer <= 30, `the layer "${name}" is ${layer}, which is not the world (0), a building's rooms (1) or the actors (31)`);
}
const layerValues = Object.values(FX_LAYERS);
ok(new Set(layerValues).size === layerValues.length, `${layerValues.length} claimed layers, all different`);

// --- the effects' keys against the rest of the settings ---

const others = Object.keys(DEFAULT_SETTINGS).filter((k) => !isFxSettingKey(k));
for (const key of others) ok(!(key in FX_DEFAULTS), `the setting "${key}" is not an effects key as well`);
for (const key of defaultKeys) ok(isFxSettingKey(key), `"${key}" is recognised as an effects key`);
ok(others.length + defaultKeys.length === Object.keys(DEFAULT_SETTINGS).length, 'every setting is either an effects key or one of the rest, and none is both');

// --- a settings file saved before the effects had a registry ---

const moved = migrateSettings({ speedBlur: false, motionBlur: 0.5 });
assert.deepEqual(moved, { motionBlur: false, motionBlurStrength: 0.5 });
passed++;
console.log('ok   a kept "speed blur off, blur 0.5" becomes motion blur off at strength 0.5');
assert.deepEqual(migrateSettings({}), {});
passed++;
console.log('ok   nothing kept stays nothing');
const kept = migrateSettings({ bloom: true, speedBlur: false, motionBlur: 0.5, renderScale: 1.25 });
assert.deepEqual(kept, { bloom: true, motionBlur: false, motionBlurStrength: 0.5, renderScale: 1.25 });
passed++;
console.log('ok   everything else in a kept file is left alone');

console.log(`\n${passed} checks passed`);
