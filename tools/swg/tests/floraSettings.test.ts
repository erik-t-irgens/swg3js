// The flora's settings and the Graphics page's Flora section (wave 8; `src/world/floraSettings.ts`,
// `src/ui/floraPage.ts`), and the rule between the page and the console:
//
//   1. every flora key has a knob and every knob a key, of the kind its setting's type wants, each on one line
//   2. today's look pinned as literals, not read from the tunes: the settings' defaults come to what the game drew
//      before the page had a Flora section, and only the two new things (shadows falling on the grass, on; the
//      grass's tint, the ground's own) are new
//   3. every range pinned as literal numbers, each holding its default, and the options and choices holding theirs;
//      the Shadows section's two ends the console reads (`SHADOW_RANGES`) held to the menu's own knobs
//   4. `consoleToSettings`: a word or a NaN dropped, the fields with no setting left out, a value past the page's
//      range marked so, Infinity's Tree distance the setting's nought
//   5. `flora({ reach: true })`'s rule keeps the two settings' values and puts the rest back as shipped
//   6. the console's held values and the note a slider moved under one says
//   7. the wiring, read as text: a `case` for every key in `applySetting`, `applyFlora` before `attachCamera`, every
//      console field with a setting through `setSettingFromConsole(`, and no `saveSettings` in it; `applyFlora`
//      feeding each tune its own field and only then walking the world, and the smallest caster walking the casters
//   8. a save and a load through a stand-in storage keep every flora setting
//
// Run: node tools/swg/tests/floraSettings.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const bag = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => (bag.has(k) ? bag.get(k)! : null),
  setItem: (k: string, v: string) => void bag.set(k, v),
  removeItem: (k: string) => void bag.delete(k),
};

const { DEFAULT_SETTINGS, loadSettings, saveSettings } = await import('../../../src/core/settings.ts');
const { FLORA } = await import('../../../src/ui/floraPage.ts');
const { FLORA_KEYS, FLORA_RANGES, SHADOW_RANGES, consoleToSettings, floraHeldNote, floraOverrides, floraReachBack, floraTunesFrom } = await import('../../../src/world/floraSettings.ts');
const { FLORA_DEFAULTS } = await import('../../../src/world/floraReach.ts');
const { GRASS_DEFAULTS, GRASS_SHADOW_DEFAULTS } = await import('../../../src/world/grassMath.ts');

const S = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
const read = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- 1. keys and knobs

{
  const knobKeys = FLORA.knobs.map((k) => k.key as string);
  ok(FLORA.title === 'Flora' && knobKeys.length === FLORA_KEYS.length && FLORA_KEYS.every((k) => knobKeys.includes(k)) && knobKeys.every((k) => (FLORA_KEYS as readonly string[]).includes(k)), `every flora setting has a knob and every knob a setting (${knobKeys.length})`);
  ok(FLORA_KEYS.every((k) => k in S), 'and every one is a setting with a default');
  const kindOk = FLORA.knobs.every((k) => {
    const v = S[k.key];
    if (k.kind === 'toggle') return typeof v === 'boolean';
    if (k.kind === 'choice') return typeof v === 'string' && !!k.choices?.length;
    if (k.kind === 'select') return typeof v === 'number' && !!k.options?.length;
    return typeof v === 'number' && typeof k.min === 'number' && typeof k.max === 'number' && typeof k.step === 'number';
  });
  ok(kindOk, 'each knob is of the kind its setting\'s type wants: a switch a boolean, a slider and a list of numbers a number, a list of words a word');
  const page = read('ui/floraPage.ts');
  const lines = page.split('\n').filter((l) => /^\s*\{ key: '/.test(l));
  ok(lines.length === FLORA.knobs.length, `each knob is written on one line (${lines.length})`);
  const menu = read('ui/menu.ts');
  ok(/import \{ FLORA \} from '\.\/floraPage\.ts';/.test(menu) && menu.indexOf("title: 'Distance and detail'") < menu.indexOf('  FLORA,\n];'), 'the Graphics page takes the Flora section after Distance and detail, so its labels, its wiring and its Reset reach it');
  const requires = FLORA.knobs.filter((k) => ['floraTreeShadows', 'floraPlantShadows', 'grassShadows', 'grassTakesShadows', 'farCardShadows', 'leafShadows'].includes(k.key));
  ok(requires.length === 6 && requires.every((k) => k.requires?.includes('shadows')), 'every shadow switch is greyed while Shadows is off');
}

// ---------------------------------------------------------------- 2. today's look

{
  const was = { grass: true, grassReach: 1, grassDensity: 1, farCards: true, farCardReach: 1, floraPlantReach: 2, floraTreeReach: 0, floraTreeShadows: true, floraPlantShadows: false, grassShadows: false, farCardShadows: false, leafShadows: 'self' };
  ok(Object.entries(was).every(([k, v]) => S[k] === v), "the settings' defaults are today's look, written out here and not read from the tunes: grass and far cards on at their worlds' own reaches and full density, small plants at twice the world's own distance, trees as far as the ground, trees casting and nothing smaller, grass and far cards casting nothing, and no leaf in its own tree's shadow");
  ok(S.grassTakesShadows === true && GRASS_DEFAULTS.tint === 'ground', 'and only two things are new: shadows fall on the grass, and the grass takes the ground\'s own tint (the owner\'s)');
  const t = floraTunesFrom(DEFAULT_SETTINGS);
  ok(t.reach.plantReachFactor === 2 && FLORA_DEFAULTS.plantReachFactor === 2 && t.reach.treeReach === Number.POSITIVE_INFINITY && FLORA_DEFAULTS.treeReach === Number.POSITIVE_INFINITY, 'they come to the plant reach as shipped: twice the world\'s own distance, and trees at Infinity (a Tree distance of nought)');
  ok(t.grass.on && t.grass.reachScale === 1 && t.grass.density === 1 && GRASS_DEFAULTS.window === 3 && GRASS_DEFAULTS.reachScale === 1 && GRASS_DEFAULTS.density === 1, 'the grass at its world\'s own reach, a window of three and full density');
  ok(t.farCards.on && t.farCards.reachScale === 1 && t.casters.trees && !t.casters.plants && t.leaves === 'self', 'the far cards at their own end, trees casting, small plants not, the leaves skipping their own tree');
  ok(!t.grassShadow.cast && !t.grassShadow.farCast && t.grassShadow.receive && t.grassShadow.farReceive && !GRASS_SHADOW_DEFAULTS.cast && GRASS_SHADOW_DEFAULTS.receive, 'the grass casts nothing and takes the sun\'s shadow, as the tune ships');
}

// ---------------------------------------------------------------- 3. ranges

{
  ok(FLORA_RANGES.grassReach.min === 0.5 && FLORA_RANGES.grassReach.max === 3 && FLORA_RANGES.grassReach.step === 0.1, 'Grass distance is 0.5 to 3 by 0.1');
  ok(FLORA_RANGES.grassDensity.min === 0.25 && FLORA_RANGES.grassDensity.max === 1 && FLORA_RANGES.grassDensity.step === 0.05, 'Grass density is 0.25 to 1 by 0.05');
  ok(FLORA_RANGES.farCardReach.min === 1 && FLORA_RANGES.farCardReach.max === 2 && FLORA_RANGES.farCardReach.step === 0.05, 'Far tree card distance is 1 to 2 by 0.05');
  ok(FLORA_RANGES.floraPlantReach.min === 1 && FLORA_RANGES.floraPlantReach.max === 4 && FLORA_RANGES.floraPlantReach.step === 0.25, 'Small plant distance is 1 to 4 by 0.25');
  ok(JSON.stringify(FLORA_RANGES.floraTreeReach.options) === JSON.stringify([0, 128, 192, 256, 320]), 'Tree distance is as far as the ground, 128, 192, 256 or 320 m');
  ok(JSON.stringify(FLORA_RANGES.leafShadows.choices) === JSON.stringify(['self', 'all', 'none']), 'and the leaves\' own shadow is no, yes or none at all');
  for (const k of FLORA.knobs) {
    const v = S[k.key];
    if (k.kind === 'range') {
      const r = (FLORA_RANGES as unknown as Record<string, { min: number; max: number; step: number }>)[k.key];
      ok(k.min === r.min && k.max === r.max && k.step === r.step && (v as number) >= r.min && (v as number) <= r.max, `${k.label}: the slider's ends are the range the console reads, and hold the default ${String(v)}`);
    } else if (k.kind === 'select') ok(!!k.options?.some((o) => o.value === v), `${k.label}: its options hold the default`);
    else if (k.kind === 'choice') ok(!!k.choices?.some((o) => o.value === v), `${k.label}: its choices hold the default`);
  }
  const menu = read('ui/menu.ts');
  ok(SHADOW_RANGES.shadowDistance.min === 80 && SHADOW_RANGES.shadowDistance.max === 800 && menu.includes("key: 'shadowDistance', label: 'Shadow distance'") && /key: 'shadowDistance'[^\n]*min: 80, max: 800, step: 20/.test(menu), 'Shadow distance is 80 to 800 m by 20 on the page and to the console');
  ok(SHADOW_RANGES.shadowCasterRadius.min === 0.5 && SHADOW_RANGES.shadowCasterRadius.max === 8 && /key: 'shadowCasterRadius'[^\n]*min: 0\.5, max: 8, step: 0\.1/.test(menu), 'and the smallest caster 0.5 to 8 m by 0.1');
  ok(/key: 'shadowCasterRadius'[^\n]*what players put down included; trees and plants follow the Flora switches/.test(menu), 'whose words now say it governs placed buildings and props, what players put down included, and not the plants');
}

// ---------------------------------------------------------------- 4. the console's fields as settings

{
  const g = consoleToSettings('grass', { on: false, reachScale: 1.5, density: 'lots', cutoff: 0.4, reach: 40 });
  ok(g.length === 2 && g.some((c) => c.key === 'grass' && c.value === false && c.inRange) && g.some((c) => c.key === 'grassReach' && c.value === 1.5 && c.inRange), 'grass: `on` and `reachScale` become their settings, a word where a number goes is dropped, and the fields with no setting (the cut, a reach in metres) are left out');
  const nan = consoleToSettings('grass', { reachScale: Number.NaN, density: 0.1 });
  ok(nan.length === 1 && nan[0].key === 'grassDensity' && !nan[0].inRange, 'a NaN is dropped, and a density under the page\'s quarter is kept but marked past its range');
  const far = consoleToSettings('farCards', { reachScale: 3, fadeBand: 0.2 });
  ok(far.length === 1 && far[0].key === 'farCardReach' && far[0].value === 3 && !far[0].inRange, 'far cards: a distance of three is past the page\'s two, and marked so');
  const tree = consoleToSettings('flora', { treeReach: Number.POSITIVE_INFINITY, plantReachFactor: 3, hysteresis: 4 });
  ok(tree.length === 2 && tree.some((c) => c.key === 'floraTreeReach' && c.value === 0 && c.inRange) && tree.some((c) => c.key === 'floraPlantReach' && c.value === 3 && c.inRange), 'flora: Infinity\'s Tree distance is the setting\'s nought, the plant factor its slider, and the hysteresis has no setting');
  const odd = consoleToSettings('flora', { treeReach: 150 });
  ok(odd.length === 1 && !odd[0].inRange, 'a Tree distance the list does not offer is applied live and marked past the page');
  const sh = consoleToSettings('floraShadows', { trees: false, plants: true, grassCast: true, grassReceive: false, farCast: true, leaves: 'all', lift: 2, castCascades: 1 });
  ok(sh.length === 6 && sh.every((c) => c.inRange) && sh.some((c) => c.key === 'leafShadows' && c.value === 'all') && sh.some((c) => c.key === 'grassShadows' && c.value === true), 'floraShadows: the six switches become their settings and the tunes with none (the lift, the cascades) are left out');
  ok(consoleToSettings('floraShadows', { leaves: 'some' }).length === 0, 'a leaf rule not on the page is dropped');
  const shadows = consoleToSettings('shadows', { distance: 1200, minRadius: 2 });
  ok(shadows.length === 2 && shadows.some((c) => c.key === 'shadowDistance' && !c.inRange) && shadows.some((c) => c.key === 'shadowCasterRadius' && c.inRange), 'shadows: 1200 m is past the page\'s 800 and marked so; a smallest caster of 2 m is on the page');
  ok(consoleToSettings('shadows', { distance: undefined, minRadius: undefined }).length === 0, 'and `shadows()` with nothing moves nothing');
}

// ---------------------------------------------------------------- 5. flora({ reach: true })

{
  const tune = { ...FLORA_DEFAULTS, fixedReach: 150, plantReachMin: 20, hysteresis: 1, plantReachFactor: 9 };
  const s = { ...DEFAULT_SETTINGS, floraPlantReach: 3, floraTreeReach: 192 };
  floraReachBack(tune, s);
  ok(tune.plantReachFactor === 3 && tune.treeReach === 192 && tune.fixedReach === 0 && tune.plantReachMin === FLORA_DEFAULTS.plantReachMin && tune.hysteresis === FLORA_DEFAULTS.hysteresis, '`flora({ reach: true })` keeps the two settings\' own values, lets a reach typed in metres go and puts every other field back as shipped');
}

// ---------------------------------------------------------------- 6. held values

{
  const none = floraOverrides({ reach: null, windowHold: null }, { reach: null }, { fixedReach: 0 });
  ok(Object.values(none).every((v) => v === null) && floraHeldNote('grassReach', none) === null, 'with nothing typed at the console nothing stands over a setting and no note is said');
  const held = floraOverrides({ reach: 40, windowHold: null }, { reach: 700 }, { fixedReach: 150 });
  ok(held.grassReach === 40 && held.farCardReach === 700 && held.floraPlantReach === 150, 'a reach in metres for the grass, the far cards or the small plants stands over its setting');
  ok(/held at 40 m from the console/.test(floraHeldNote('grassReach', held) ?? '') && /reach: null/.test(floraHeldNote('farCardReach', held) ?? '') && /reach: true/.test(floraHeldNote('floraPlantReach', held) ?? ''), 'and moving the setting under one says so, naming how to hand it back');
  const win = floraOverrides({ reach: null, windowHold: 7 }, { reach: null }, { fixedReach: 0 });
  ok(/window is held at 7 chunks/.test(floraHeldNote('grassReach', win) ?? ''), 'a window typed outright stands over the window the grass distance works out');
}

// ---------------------------------------------------------------- 7. the wiring

{
  const main = read('main.ts');
  const apply = main.slice(main.indexOf('private applySetting(key: keyof Settings): void {'), main.indexOf('private applyFlora('));
  ok(FLORA_KEYS.every((k) => apply.includes(`case '${k}':`)), 'applySetting has a case for every flora key (a key with no case does nothing live)');
  ok(/case 'shadowDistance':\s*this\.world\.setShadows\(S\.shadowDistance\);\s*break;\s*case 'shadowCasterRadius':/.test(apply), 'and the shared shadows case is split, so the smallest caster walks the casters only when it moves');
  const ctor = main.indexOf('this.world.setShadows(S.shadowDistance, S.shadowCasterRadius);');
  const flora = main.indexOf('this.applyFlora();', ctor);
  ok(ctor > 0 && flora > ctor && flora - ctor < 300 && flora < main.indexOf('this.world.attachCamera(this.cam.camera, true, this.portals);'), 'applyFlora runs in the constructor straight after setShadows and before attachCamera and any world');
  const set = main.slice(main.indexOf('private setSettingFromConsole('), main.indexOf('private applyHudSettings('));
  ok(set.length > 0 && !set.includes('saveSettings'), 'setSettingFromConsole never saves: only the page does');
  ok(/redrawGraphics\(\)/.test(set) && /this\.applySetting\(c\.key\)/.test(set), 'it applies a setting the page\'s way and draws the Graphics page again if it shows');
  for (const helper of ['grass', 'farCards', 'flora', 'floraShadows', 'shadows']) ok(main.includes(`this.setSettingFromConsole('${helper}'`), `__debug.${helper}'s fields with a setting go through setSettingFromConsole`);
  ok(/floraHeldNote\(key, floraOverrides\(GRASS_TUNE, FAR_CARD_TUNE, FLORA_TUNE\)\)/.test(apply), 'a slider moved under a console value says so on the message line');
  // What a setting comes to: `applyFlora` feeds every tune its own part of `floraTunesFrom`, then walks the world.
  const applied = main.slice(main.indexOf('private applyFlora('), main.indexOf('private flipFloraTune('));
  const fed = ['if (setGrassTune(t.grass)) this.world.grass?.rebuildAll();', 'if (setFarCardTune(t.farCards)) this.world.farCards?.rebuildAll();', 'setGrassShadowTune(t.grassShadow);', 'applyReachOption(FLORA_TUNE, t.reach);', 'setShadowCasterTune(t.casters);', 'setCardLightTune({ shadow: t.leaves });'];
  ok(applied.includes('const t = floraTunesFrom(s);') && fed.every((f) => applied.includes(f)), `applyFlora feeds each tune its own field of the settings: the grass, the far cards, their shadows, the plants' reach, the casters and the leaves (${fed.filter((f) => !applied.includes(f)).join('; ') || 'all six'})`);
  const walks = ['writeGrassUniforms(this.world.grassWorld);', 'this.world.refreshFloraReach();', 'this.world.applyFloraCasters();', 'this.world.applyCasters();', 'this.world.farCards?.applyCast();', 'this.world.grass?.applyCast(this.cam.camera.position);', 'this.world.applyCardShadow();'];
  const lastFed = Math.max(...fed.map((f) => applied.indexOf(f)));
  ok(walks.every((w) => applied.indexOf(w) > lastFed), `and only then walks the world: the uniforms, the plants' reach, the flora's casters, the placed casters, the far cards' and the grass's casting, the leaves' receiving (${walks.filter((w) => applied.indexOf(w) <= lastFed).join('; ') || 'all seven'})`);
  ok(/if \(CARD_LIGHT_TUNE\.shadow !== leavesWere\) this\.world\.applyCardShadow\(\);/.test(applied) && /const leavesWere = CARD_LIGHT_TUNE\.shadow;\s*setCardLightTune\(\{ shadow: t\.leaves \}\);/.test(applied), 'the leaves\' receiving walked only when their rule really moved');
  const flip = main.slice(main.indexOf('private flipFloraTune('), main.indexOf('private setSettingFromConsole('));
  ok(walks.slice(0, 1).concat(walks.slice(2, 6)).every((w) => flip.includes(w)), 'and the frame report\'s flora switches walk the world the same way after their tune moved');
  const world = read('world/world.ts');
  const shadows = world.slice(world.indexOf('  setShadows(distance?: number, minRadius?: number)'), world.indexOf('  applyFloraCasters(): number {'));
  ok(/if \(minRadius !== undefined && Number\.isFinite\(minRadius\) && minRadius >= 0 && minRadius !== SHADOW_CASTER_TUNE\.placedMinRadius\) \{\s*SHADOW_CASTER_TUNE\.placedMinRadius = minRadius;\s*this\.layoutStream\?\.applyCasters\(\);\s*\}/.test(shadows), 'the Smallest shadow caster moves the casters\' rule and walks every placed caster standing by it (`World.setShadows`)');
}

// ---------------------------------------------------------------- 8. a save and a load

{
  const s = loadSettings();
  s.grassShadows = true;
  s.grassReach = 2.5;
  s.floraTreeReach = 192;
  s.leafShadows = 'none';
  s.grassTakesShadows = false;
  saveSettings(s);
  const kept = JSON.parse(bag.get('swg.settings') ?? '{}') as Record<string, unknown>;
  ok(kept.grassShadows === true && kept.grassReach === 2.5 && kept.floraTreeReach === 192 && kept.leafShadows === 'none' && kept.grassTakesShadows === false && !('grass' in kept), 'a save keeps the flora settings that differ from their defaults, and only those');
  const back = loadSettings();
  ok(back.grassShadows === true && back.grassReach === 2.5 && back.floraTreeReach === 192 && back.leafShadows === 'none' && !back.grassTakesShadows && back.grass === true, 'and a load gives every one back');
  bag.set('swg.settings', JSON.stringify({ grassReach: 'far', floraTreeReach: null, leafShadows: 3 }));
  const bad = loadSettings();
  ok(bad.grassReach === 1 && bad.floraTreeReach === 0 && bad.leafShadows === 'self', 'a stored value of the wrong kind is dropped for the default');
}

console.log(`\nfloraSettings: ${passed} checks passed`);
