// The volumetrics' settings (src/world/volumetrics/volSettings.ts, the page's rows in src/ui/volPage.ts): every key in
// the defaults with its type and the master off; every preset inside every knob's range and worked out again to
// itself; one quality key moved reads Custom; the kept record written in place; the console's fields as settings;
// the page's ranges and the console's the same numbers. (That a settings file saved by the commit before the pass
// loads to the new defaults is the off-proof's, `airOff.test.ts`, which can load that commit's own module.)
//
// Plain type stripping: every module here imports only `.ts`-suffixed modules.
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../../../src/core/settings.ts';
import { FX_DEFAULTS, FX_KNOBS, isFxSettingKey } from '../../../src/core/fxRegistry.ts';
import { isVolKey, liquidTileCells, newVolTune, presetOf, VOL_APPLY_CLASS, VOL_FX_KEYS, VOL_KEYS, VOL_PRESET_NAMES, VOL_PRESETS, VOL_QUALITY_ADDED, VOL_QUALITY_KEYS, VOL_QUALITY_LATER, VOL_QUALITY_MOVED, VOL_QUALITY_STAMP, VOL_QUALITY_WAVE, VOL_RANGES, VOL_SCENE_KEYS, VOL_TUNE, volConsoleToSettings, volFillQuality, volMemoryMB, volQualityFrom, type VolPresetName, type VolQualityKey } from '../../../src/world/volumetrics/volSettings.ts';
import { VOL_PAGE_KEYS, VOLUMETRICS } from '../../../src/ui/volPage.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const S = DEFAULT_SETTINGS as unknown as Record<string, unknown>;

// --- every key, its type, the master off ---
ok(S.volumetrics === false, 'the master is off by default: off is today\'s game');
const types: Record<string, string> = {
  volumetrics: 'boolean',
  airVolume: 'boolean',
  airVolumeAmount: 'number',
  airVolumeResolution: 'number',
  airVolumeSteps: 'number',
  airVolumeHistory: 'boolean',
  airVolumeShadows: 'boolean',
  volAir: 'boolean',
  volAirDetail: 'number',
  volAirSolve: 'number',
  volAirRate: 'number',
  volDust: 'boolean',
  volDustDetail: 'number',
  volKickUp: 'boolean',
  volLight: 'boolean',
  volLightDetail: 'number',
  volLightSteps: 'number',
  volStormThin: 'number',
  volFromEngines: 'boolean',
  volFromForce: 'boolean',
  volFromBlasts: 'boolean',
  // The second wave's: the ground keeps what passes.
  volSand: 'boolean',
  volSandDetail: 'number',
  volPrints: 'boolean',
  volPrintDetail: 'number',
  volArtSand: 'number',
  volArtPrints: 'number',
  volArtShade: 'number',
  volFromFeet: 'boolean',
  // Wave 2b's look of the dust.
  volDustBright: 'number',
  volDustSelfShadow: 'number',
  // The third wave's: layers of air, smoke and fog, the wisps, a dust field a layer.
  volAirLayers: 'number',
  volSmoke: 'boolean',
  volFog: 'boolean',
  volSmokeDetail: 'number',
  volDustWisps: 'number',
  volDustLayers: 'boolean',
  // The fourth wave's: what the air carries besides dust, and the rain and snow of ours.
  volParticles: 'boolean',
  volLeaves: 'boolean',
  volPuffs: 'boolean',
  volSpray: 'boolean',
  volStreaks: 'boolean',
  volParticleDetail: 'number',
  volParticleShadows: 'boolean',
  volRain: 'boolean',
  volSnow: 'boolean',
  volRainDetail: 'number',
  volRainThin: 'number',
  volSnowThin: 'number',
  // The fifth wave's: the water's current and the lava's, the liquid's tile, the two art dials.
  volCurrent: 'boolean',
  volLiquidDetail: 'number',
  volLava: 'boolean',
  volArtWater: 'number',
  volArtLava: 'number',
  // The sixth wave's: the grass in the air, how far it bends, and other players' rides.
  volGrass: 'boolean',
  volArtGrass: 'number',
  volFromPeers: 'boolean',
  // The seventh wave's (7a): the unified wind, its devils, the trees in its gusts, and its art dial.
  volWind: 'boolean',
  volWindDevils: 'boolean',
  volWindTrees: 'boolean',
  volArtWind: 'number',
  // The seventh wave's second half (7b): one cloud system.
  volClouds: 'boolean',
  volCloudsAmount: 'number',
  volCloudsResolution: 'number',
  volCloudsSteps: 'number',
  volCloudsLight: 'number',
  volCloudsHistory: 'boolean',
  volCloudsWeather: 'number',
  volCloudsSmear: 'boolean',
  volCloudsLow: 'boolean',
  volCloudsHoles: 'boolean',
  volCloudsBright: 'number',
  volCloudsArt: 'number',
  volCloudSheets: 'number',
};
for (const k of VOL_KEYS) ok(typeof S[k] === types[k], `"${k}" is in the defaults as a ${types[k]}`);
ok(Object.keys(types).length === VOL_KEYS.length, 'and those are every key the pass speaks for, no more');
for (const k of VOL_FX_KEYS) ok(isFxSettingKey(k) && (FX_DEFAULTS as unknown as Record<string, unknown>)[k] === S[k], `"${k}" is the effects registry's, with the same default there`);
for (const k of VOL_SCENE_KEYS) ok(!isFxSettingKey(k), `"${k}" is a scene key the chain never reads`);
ok(VOL_KEYS.every((k) => isVolKey(k)) && !isVolKey('effects') && !isVolKey('bloom'), 'isVolKey answers the pass\'s keys and nothing else');
for (const k of VOL_KEYS) ok(['W', 'C', 'T', 'U', 'M', 'A'].includes(VOL_APPLY_CLASS[k as keyof typeof VOL_APPLY_CLASS]), `"${k}" says how it takes effect (${VOL_APPLY_CLASS[k as keyof typeof VOL_APPLY_CLASS]})`);
ok(VOL_APPLY_CLASS.volumetrics === 'W', 'the master is class W from the second wave: on in play, its programs built off the frame behind a notice');
ok(VOL_APPLY_CLASS.volSand === 'M' && VOL_APPLY_CLASS.volPrints === 'M', 'the sand and the prints are class M: the ground changes material, both already compiled');
ok(VOL_APPLY_CLASS.volSandDetail === 'T' && VOL_APPLY_CLASS.volPrintDetail === 'T', 'their details are class T: a target made again');
ok(VOL_APPLY_CLASS.volArtSand === 'U' && VOL_APPLY_CLASS.volArtPrints === 'U' && VOL_APPLY_CLASS.volArtShade === 'U' && VOL_APPLY_CLASS.volFromFeet === 'C', 'the art dials are uniforms and the feet a switch the frame reads');
ok(S.volSand === true && S.volPrints === true && S.volFromFeet === true && S.volArtSand === 1 && S.volArtPrints === 1 && S.volArtShade === 1, 'the ground\'s switches start on and its art dials at one: nothing shows while the master is off');
ok(S.volDustBright === 0.6 && S.volDustSelfShadow === 1, "the dust's look starts at the design's: brightness 0.6 (fresh dust on sand at noon about its ground's own), self-shadow 1 (the march's own extinction)");
ok(VOL_APPLY_CLASS.volDustBright === 'U' && VOL_APPLY_CLASS.volDustSelfShadow === 'U', "the dust's look is two uniforms: nothing built, nothing made again");
ok(!(VOL_QUALITY_KEYS as readonly string[]).includes('volDustBright') && !(VOL_QUALITY_KEYS as readonly string[]).includes('volDustSelfShadow'), 'and no quality key, so no preset writes them and no stamp moves');
{
  const t = newVolTune();
  ok(!Number.isInteger(t.dustBright) && !Number.isInteger(t.dustSelfShadow), 'their fields in the kept record start as fractions, so each is a double from its first write');
}
// The sixth wave's: the grass's twin is class M (its plain material and the twin, both built), its bend a uniform, the
// peers a source the frame reads; on by default at the art dial's one, so nothing shows while the master is off.
ok(VOL_APPLY_CLASS.volGrass === 'M' && VOL_APPLY_CLASS.volArtGrass === 'U' && VOL_APPLY_CLASS.volFromPeers === 'C', "the sixth wave's: the grass swaps built materials, its bend is a uniform, the peers a switch the frame reads");
ok(S.volGrass === true && S.volArtGrass === 1 && S.volFromPeers === true, 'the grass and the peers start on, the bend at one: nothing shows while the master is off');
ok(!(VOL_QUALITY_KEYS as readonly string[]).some((k) => ['volGrass', 'volArtGrass', 'volFromPeers'].includes(k)), 'and none of the three is a quality key: no preset writes them and no stamp moves');
// The seventh wave's first half (7a): the wind and its devils are switches the frame reads (the arm), its art a uniform
// (the pack's strengths), and the trees' form class A, taken at the next arrival (its programs come only from a screen).
ok(VOL_APPLY_CLASS.volWind === 'C' && VOL_APPLY_CLASS.volWindDevils === 'C' && VOL_APPLY_CLASS.volArtWind === 'U' && VOL_APPLY_CLASS.volWindTrees === 'A', "the seventh wave's: the wind and its devils switches the frame reads, its art a uniform, the trees' form at the next arrival");
ok(S.volWind === true && S.volWindDevils === true && S.volWindTrees === true && S.volArtWind === 1, 'the wind, its devils and the trees start on, the art at one: nothing of it runs while the master is off');
ok(!(VOL_QUALITY_KEYS as readonly string[]).some((k) => ['volWind', 'volWindDevils', 'volWindTrees', 'volArtWind'].includes(k)), 'and none of the four is a quality key: no preset writes them and no stamp moves');
{
  const t = newVolTune();
  ok(t.wind === true && t.windDevils === true && t.windTrees === true && t.artWind === 1, "the kept record's seventh-wave fields start at the defaults' own values");
}
// No later wave's key is in this build at all, shown or hidden (the far devils are Q20's, not this pass's).
for (const later of ['volWindArt', 'volWindFarDevils']) {
  ok(!(later in S), `"${later}" (no setting of this pass) is not in this build`);
}
// The seventh wave's second half (7b): the clouds' switch, their history and the holes switches the frame reads; their
// resolution and weather map targets made again; their steps, light steps, smear, low deck and look uniforms; on by
// default (nothing of them runs while the master is off), the sheets kept over a deck at nought.
ok(VOL_APPLY_CLASS.volClouds === 'C' && VOL_APPLY_CLASS.volCloudsHistory === 'C' && VOL_APPLY_CLASS.volCloudsHoles === 'C' && VOL_APPLY_CLASS.volCloudsResolution === 'T' && VOL_APPLY_CLASS.volCloudsWeather === 'T' && ['volCloudsSteps', 'volCloudsLight', 'volCloudsAmount', 'volCloudsSmear', 'volCloudsLow', 'volCloudsBright', 'volCloudsArt', 'volCloudSheets'].every((k) => VOL_APPLY_CLASS[k as keyof typeof VOL_APPLY_CLASS] === 'U'), "the seventh wave's clouds: switches the frame reads, targets made again, uniforms; nothing of them a program built");
ok(S.volClouds === true && S.volCloudsHistory === true && S.volCloudsSmear === true && S.volCloudsLow === true && S.volCloudsHoles === true && S.volCloudsAmount === 1 && S.volCloudsBright === 1 && S.volCloudsArt === 1 && S.volCloudSheets === 0 && S.volCloudsResolution === 0.25 && S.volCloudsSteps === 48 && S.volCloudsLight === 4 && S.volCloudsWeather === 512, "the clouds start on at High's numbers, the art at one, no sheet kept over a deck: nothing of them runs while the master is off");
ok(VOL_PRESETS.low.volCloudsSteps === 24 && VOL_PRESETS.medium.volCloudsSteps === 32 && VOL_PRESETS.high.volCloudsSteps === 48 && VOL_PRESETS.ultra.volCloudsSteps === 64 && VOL_PRESETS.ultra.volCloudsResolution === 0.5 && VOL_PRESETS.low.volCloudsWeather === 256 && VOL_PRESETS.ultra.volCloudsWeather === 1024 && VOL_PRESETS.low.volCloudsSmear === false && VOL_PRESETS.medium.volCloudsSmear === false && VOL_PRESETS.high.volCloudsSmear === true && VOL_PRESETS.low.volCloudsLight === 2 && VOL_PRESETS.ultra.volCloudsLight === 5, "the clouds by preset: 24, 32, 48 and 64 steps, 2 to 5 light steps, a weather map of 256 to 1,024 texels, the smear from High, Ultra's march at half the screen");
ok((['volCloudsResolution', 'volCloudsSteps', 'volCloudsLight', 'volCloudsWeather', 'volCloudsSmear'] as const).every((k) => (VOL_QUALITY_KEYS as readonly string[]).includes(k) && VOL_QUALITY_ADDED[k] === 7 && VOL_QUALITY_LATER.includes(k)) && !(VOL_QUALITY_KEYS as readonly string[]).some((k) => ['volClouds', 'volCloudsAmount', 'volCloudsHistory', 'volCloudsLow', 'volCloudsHoles', 'volCloudsBright', 'volCloudsArt', 'volCloudSheets'].includes(k)), "the clouds' five quality keys say the seventh wave added them, and no switch or look of theirs is a quality key");
{
  const t = newVolTune();
  ok(t.clouds === true && t.cloudsHoles === true && t.cloudsLow === true && t.cloudsAmount === 1 && t.cloudsBright === 1 && t.cloudsArt === 1 && t.cloudSheets === 0, "the kept record's clouds start at the defaults' own values");
  const hard = volQualityFrom(DEFAULT_SETTINGS, newVolTune(), { volCloudsSteps: 400, volCloudsLight: 40 });
  ok(hard.cloudsSteps === 128 && hard.cloudsLight === 8, "a step count past the page's end from the console is held under the march's loop bounds (128 and 8)");
  ok(volMemoryMB({ ...newVolTune(), on: true, clouds: true }, 1600, 900) > volMemoryMB({ ...newVolTune(), on: true, clouds: false }, 1600, 900), 'the clouds count their memory while they are on (the noise, the weather map, the holes, the march)');
}
{
  const t = newVolTune();
  ok(t.grass === true && t.fromPeers === true && t.artGrass === 1, "the kept record's sixth-wave fields start at the defaults' own values");
  ok(volQualityFrom({ ...DEFAULT_SETTINGS, volArtGrass: 7 } as Settings, newVolTune()).artGrass === 1 && volQualityFrom(DEFAULT_SETTINGS, newVolTune(), { volArtGrass: 7 }).artGrass === 4, "the bend held to the page's ends from a file, and from the console only to what cannot break anything");
}
// The fifth wave's: the current and the lava are class M (the water and the lava change material, both built), the
// liquid's tile a target made again (T), the two art dials uniforms (U); on by default at the art dials' one, and the
// liquid's tile by preset 64 to 192 cells. The water's ribbons switch is the water's own, beside its settings, and off.
ok(VOL_APPLY_CLASS.volCurrent === 'M' && VOL_APPLY_CLASS.volLava === 'M' && VOL_APPLY_CLASS.volLiquidDetail === 'T' && VOL_APPLY_CLASS.volArtWater === 'U' && VOL_APPLY_CLASS.volArtLava === 'U', "the fifth wave's: the current and the lava swap built materials, the tile is a target made again, the art dials are uniforms");
ok(S.volCurrent === true && S.volLava === true && S.volArtWater === 1 && S.volArtLava === 1 && S.volLiquidDetail === 128, 'the current and the lava start on, their art at one and the tile at High\'s 128: nothing shows while the master is off');
ok(VOL_PRESETS.low.volLiquidDetail === 64 && VOL_PRESETS.medium.volLiquidDetail === 96 && VOL_PRESETS.high.volLiquidDetail === 128 && VOL_PRESETS.ultra.volLiquidDetail === 192, "the liquid's tile by preset: 64, 96, 128 and 192 cells");
ok(liquidTileCells({ current: false, lava: false, liquidDetail: 128 }) === 0 && liquidTileCells({ current: true, lava: false, liquidDetail: 128 }) === 128 && liquidTileCells({ current: false, lava: true, liquidDetail: 96 }) === 96, "the liquid's tile is made only while the current or the lava is on: none with both off, so no memory is spent on it");
ok(S.waterRibbons === false && !isVolKey('waterRibbons'), "the terrain's ribbons are the water's own switch, not the pass's, and off: off is today's game");
// The third wave's: the layers, smoke and fog details and a field a layer are targets made again (class T), the wisps a
// march material a mode (class M, the Start's decision), smoke and fog switches the frame reads (C); a dust field a layer
// is off by default and on Ultra alone (the owner's answer).
ok(VOL_APPLY_CLASS.volAirLayers === 'T' && VOL_APPLY_CLASS.volSmokeDetail === 'T' && VOL_APPLY_CLASS.volDustLayers === 'T', "the layers, the smoke's detail and a dust field a layer are class T: targets made again");
ok(VOL_APPLY_CLASS.volDustWisps === 'W', "the wisps are class W from the fourth wave: one march material a mode, all four built behind a loading screen, and the master's in-play warm building the mode in force alone, a mode moved to later warmed off the frame (W3's carried cold warm)");
ok(VOL_APPLY_CLASS.volSmoke === 'C' && VOL_APPLY_CLASS.volFog === 'C', 'smoke and fog are switches the frame reads');
ok(S.volDustLayers === false && VOL_PRESETS.ultra.volDustLayers === true && VOL_PRESET_NAMES.filter((n) => VOL_PRESETS[n].volDustLayers === true).join() === 'ultra', 'a dust field a layer is off by default and on Ultra alone');
ok(S.volSmoke === true && S.volFog === true && S.volAirLayers === 3 && S.volDustWisps === 2 && S.volSmokeDetail === 2, "High's third-wave numbers are the defaults: three layers, smoke and fog on, one octave of wisps");
ok(VOL_PRESETS.low.volDustWisps === 0 && VOL_PRESETS.medium.volDustWisps === 1 && VOL_PRESETS.high.volDustWisps === 2 && VOL_PRESETS.ultra.volDustWisps === 3, 'the wisps by preset: off, bands, noise, noise ×2');
// The fourth wave's: the kinds and the rain switches the frame reads, the pools' counts targets made again, the
// leaves' shadow and the sheets' thinning uniforms; the particles, every kind and the rain on, the snow off until asked
// (the owner's), the game's own sheets wholly stood down while ours falls.
ok(['volParticles', 'volLeaves', 'volPuffs', 'volSpray', 'volStreaks', 'volRain', 'volSnow'].every((k) => VOL_APPLY_CLASS[k as keyof typeof VOL_APPLY_CLASS] === 'C') && VOL_APPLY_CLASS.volParticleDetail === 'T' && VOL_APPLY_CLASS.volRainDetail === 'T' && VOL_APPLY_CLASS.volParticleShadows === 'U' && VOL_APPLY_CLASS.volRainThin === 'U' && VOL_APPLY_CLASS.volSnowThin === 'U', "the fourth wave's switches are read by the frame, its counts are targets made again, the leaves' shadow and the thinning are uniforms");
ok(S.volParticles === true && S.volLeaves === true && S.volPuffs === true && S.volSpray === true && S.volStreaks === true && S.volRain === true && S.volSnow === false && S.volRainThin === 1 && S.volSnowThin === 1, 'the particles, every kind and the rain start on, the snow off; the game\'s own sheets stood down whole while ours falls');
ok(VOL_PRESETS.low.volParticleDetail === 0.5 && VOL_PRESETS.medium.volParticleDetail === 1 && VOL_PRESETS.high.volParticleDetail === 1 && VOL_PRESETS.ultra.volParticleDetail === 2 && VOL_PRESETS.low.volRainDetail === 4096 && VOL_PRESETS.ultra.volRainDetail === 32768 && VOL_PRESETS.low.volParticleShadows === false, "the pools' counts by preset: half, whole, whole and twice High's particles; 4,096 to 32,768 drops; the leaves' shadow off on Low");
ok(VOL_QUALITY_WAVE === 7 && VOL_QUALITY_ADDED.volParticleDetail === 4 && VOL_QUALITY_ADDED.volRainDetail === 4 && VOL_QUALITY_ADDED.volParticleShadows === 4 && VOL_QUALITY_ADDED.volLiquidDetail === 5, "this build saves its files as the seventh wave's; the fourth wave's three quality keys and the fifth's one say which wave added them");
// The sixth wave moved the blowing sand's rows (decision 54): twice the air's grid on Low, Medium and High, three times on
// Ultra, the default with them; the rows before the move kept beside it for the files written before.
ok(VOL_PRESETS.low.volSandDetail === 2 && VOL_PRESETS.medium.volSandDetail === 2 && VOL_PRESETS.high.volSandDetail === 2 && VOL_PRESETS.ultra.volSandDetail === 3 && S.volSandDetail === 2, "the blowing sand by preset: ×2, ×2, ×2, ×3, the default High's ×2");
{
  const mv = VOL_QUALITY_MOVED.volSandDetail;
  ok(!!mv && mv.wave === 6 && mv.oldDefault === 4 && mv.old.low === 3 && mv.old.medium === 4 && mv.old.high === 4 && mv.old.ultra === 6, 'and the rows before the move (×3, ×4, ×4, ×6, the default ×4) are kept with the wave that moved them');
  ok(Object.keys(VOL_QUALITY_MOVED).every((k) => (VOL_QUALITY_KEYS as readonly string[]).includes(k)), 'every moved key is a quality key');
  ok(volMemoryMB({ ...newVolTune(), sandDetail: 2 }, 2560, 1440) < volMemoryMB({ ...newVolTune(), sandDetail: 4 }, 2560, 1440) - 10, `the move saves its memory: High at ×2 ${volMemoryMB({ ...newVolTune(), sandDetail: 2 }, 2560, 1440)} MB against ×4 ${volMemoryMB({ ...newVolTune(), sandDetail: 4 }, 2560, 1440)} MB`);
}

// --- presets ---
ok(presetOf(DEFAULT_SETTINGS) === 'high', 'the defaults work out to High');
const knobs = VOLUMETRICS.flatMap((g) => g.knobs);
const knobOf = (key: string) => knobs.find((k) => k.key === key && k.kind !== 'preset');
for (const name of VOL_PRESET_NAMES) {
  const p = VOL_PRESETS[name];
  for (const k of VOL_QUALITY_KEYS) {
    const v = p[k];
    const knob = knobOf(k);
    ok(!!knob, `the preset's "${k}" has a knob on the page`);
    if (!knob) continue;
    if (knob.kind === 'toggle') ok(typeof v === 'boolean', `${name}'s ${k} is a switch's value`);
    else if (knob.kind === 'select') ok(!!knob.options?.some((o) => o.value === v), `${name}'s ${k} ${String(v)} is one of the page's options`);
    else ok(typeof v === 'number' && v >= (knob.min as number) && v <= (knob.max as number), `${name}'s ${k} ${String(v)} is inside the page's range`);
  }
  const applied = { ...DEFAULT_SETTINGS, ...p } as Settings;
  ok(presetOf(applied) === name, `${name} applied works out to ${name} again`);
}
for (const k of VOL_QUALITY_KEYS) {
  const moved = { ...DEFAULT_SETTINGS } as unknown as Record<string, unknown>;
  const v = moved[k];
  moved[k] = typeof v === 'boolean' ? !v : (v as number) === 6 ? 8 : (v as number) + (k === 'airVolumeResolution' ? 0.5 : 2);
  ok(presetOf(moved as unknown as Settings) === 'custom', `moving "${k}" alone reads Custom`);
}
// A preset writes quality and nothing else: no switch, no art dial.
for (const name of VOL_PRESET_NAMES) for (const k of Object.keys(VOL_PRESETS[name])) ok((VOL_QUALITY_KEYS as readonly string[]).includes(k), `${name} writes "${k}", a quality key`);
ok(!(VOL_QUALITY_KEYS as readonly string[]).some((k) => ['volumetrics', 'airVolume', 'volAir', 'volDust', 'volKickUp', 'volLight', 'airVolumeAmount', 'volStormThin', 'volFromEngines', 'volFromForce', 'volFromBlasts', 'volSand', 'volPrints', 'volArtSand', 'volArtPrints', 'volArtShade', 'volFromFeet', 'volGrass', 'volArtGrass', 'volFromPeers'].includes(k)), 'no switch and no art dial is a quality key');

// --- a file saved before a wave added a quality key ---
{
  const earlier = VOL_QUALITY_KEYS.filter((k) => !VOL_QUALITY_LATER.includes(k));
  ok(VOL_QUALITY_LATER.every((k) => (VOL_QUALITY_KEYS as readonly string[]).includes(k) && (VOL_QUALITY_ADDED[k] ?? 0) > 1 && (VOL_QUALITY_ADDED[k] ?? 0) <= VOL_QUALITY_WAVE), 'every later quality key is a quality key, of a wave after the first and no later than this build\'s');
  for (const name of VOL_PRESET_NAMES) {
    // The first wave's file: only what differed from the defaults, no stamp, none of the later keys.
    const saved: Record<string, unknown> = {};
    for (const k of earlier) if (VOL_PRESETS[name][k] !== (S as Record<string, unknown>)[k]) saved[k] = VOL_PRESETS[name][k];
    const merged = { ...DEFAULT_SETTINGS, ...saved } as Settings;
    volFillQuality(saved, merged);
    ok(presetOf(merged) === name, `a ${name} saved in the first wave still reads ${name}: the later keys take its values`);
  }
  {
    // This build's file: Ultra with the sand moved to High's own ×2, which saving leaves out as the default.
    const s = { ...DEFAULT_SETTINGS, ...VOL_PRESETS.ultra, volSandDetail: 2 } as Settings;
    const saved: Record<string, unknown> = { [VOL_QUALITY_STAMP]: VOL_QUALITY_WAVE };
    for (const [k, v] of Object.entries(s)) if (v !== (S as Record<string, unknown>)[k]) saved[k] = v;
    ok(!('volSandDetail' in saved), 'a sand detail at the default is left out of the file');
    const merged = { ...DEFAULT_SETTINGS, ...saved } as Settings;
    ok(volFillQuality(saved, merged) === 0 && merged.volSandDetail === 2 && presetOf(merged) === 'custom', 'and the stamp keeps it at the default on load: Custom, not filled back to Ultra\'s');
  }
  // A file as wave `wave` wrote it for preset `name`: each key that wave knew, at that wave's own row (a row a later wave
  // moved is the row before the move) and left out where it was that wave's own default.
  const fileOf = (name: VolPresetName, wave: number): Record<string, unknown> => {
    const out: Record<string, unknown> = wave > 1 ? { [VOL_QUALITY_STAMP]: wave } : {};
    for (const k of VOL_QUALITY_KEYS) {
      if ((VOL_QUALITY_ADDED[k] ?? 1) > wave) continue;
      const mv = VOL_QUALITY_MOVED[k as VolQualityKey];
      const before = !!mv && wave < mv.wave;
      const value = before ? mv!.old[name] : VOL_PRESETS[name][k];
      const def = before ? mv!.oldDefault : (S as Record<string, unknown>)[k];
      if (value !== def) out[k] = value;
    }
    return out;
  };
  for (const name of VOL_PRESET_NAMES) {
    for (const wave of [2, 3, 4, 5, 6]) {
      // An earlier wave's file: its own wave's keys written where they differed from its own defaults, none of a later's.
      const later = VOL_QUALITY_KEYS.filter((k) => (VOL_QUALITY_ADDED[k] ?? 1) > wave);
      const saved = fileOf(name, wave);
      const merged = { ...DEFAULT_SETTINGS, ...saved } as Settings;
      volFillQuality(saved, merged);
      ok(presetOf(merged) === name && later.every((k) => merged[k] === VOL_PRESETS[name][k]) && merged.volSandDetail === VOL_PRESETS[name].volSandDetail, `a ${name} saved in wave ${wave} reads ${name}: the sand's moved row and ${later.length ? `the later keys (${later.join(', ')})` : 'no later key'} filled from its own preset`);
    }
  }
  {
    // The move's migration, key by key (decision 54): a fifth wave's Low (×3), Ultra (×6) and High (×4, left out) take
    // their preset's new row; a Custom keeps what it was drawn with, written or left out at the old default.
    const fifth = (extra: Record<string, unknown>, base: VolPresetName | null): Settings => {
      const saved = { ...(base ? fileOf(base, 5) : { [VOL_QUALITY_STAMP]: 5, volAirSolve: 33 }), ...extra };
      const merged = { ...DEFAULT_SETTINGS, ...saved } as Settings;
      volFillQuality(saved, merged);
      return merged;
    };
    ok(fifth({}, 'low').volSandDetail === 2 && fifth({}, 'ultra').volSandDetail === 3 && fifth({}, 'high').volSandDetail === 2, "a fifth wave's Low, Ultra and High take the sand's new rows (×2, ×3, ×2)");
    ok(fifth({ volSandDetail: 6 }, 'low').volSandDetail === 6, 'a Low whose sand was moved off its own row keeps the value it was drawn with');
    ok(fifth({}, null).volSandDetail === 4 && presetOf(fifth({}, null)) === 'custom', "a fifth wave's Custom that left the sand at the old default keeps ×4, as it was drawn");
    ok(fifth({ volSandDetail: 3 }, null).volSandDetail === 3, 'and one that wrote it keeps what it wrote');
    const sixth: Record<string, unknown> = { [VOL_QUALITY_STAMP]: 6, volAirSolve: 33 };
    const m6 = { ...DEFAULT_SETTINGS, ...sixth } as Settings;
    ok(volFillQuality(sixth, m6) === 0 && m6.volSandDetail === 2, "a sixth wave's file is never migrated: the sand at this build's default");
  }
  {
    const saved: Record<string, unknown> = { volAirDetail: 64, volAirSolve: 33 };
    const merged = { ...DEFAULT_SETTINGS, ...saved } as Settings;
    ok(volFillQuality(saved, merged) === 0 && merged.volSandDetail === S.volSandDetail, 'a first wave\'s Custom fills nothing');
    const low: Record<string, unknown> = { volSandDetail: 6 };
    for (const k of earlier) if (VOL_PRESETS.low[k] !== (S as Record<string, unknown>)[k]) low[k] = VOL_PRESETS.low[k];
    const m2 = { ...DEFAULT_SETTINGS, ...low } as Settings;
    volFillQuality(low, m2);
    ok(m2.volSandDetail === 6 && m2.volPrintDetail === VOL_PRESETS.low.volPrintDetail, 'a later key the file did write is kept, the one it did not is filled');
  }
}

// --- the kept record ---
{
  const out = newVolTune();
  const back = volQualityFrom(DEFAULT_SETTINGS, out);
  ok(back === out, 'volQualityFrom writes into the record it is handed and answers it');
  ok(out.on === false && out.air && out.dust && out.kickUp && out.light && out.volume, 'the defaults write the master off and every switch under it on');
  ok(out.airDetail === 128 && out.solve === 20 && out.rate === 60 && out.dustDetail === 4 && out.lightDetail === 2 && out.lightSteps === 26 && out.volumeSteps === 16 && out.volumeResolution === 0.5, 'and High\'s numbers');
  ok(out.sand && out.prints && out.fromFeet && out.sandDetail === 2 && out.printDetail === 2048 && out.artSand === 1 && out.artPrints === 1 && out.artShade === 1, 'and the ground\'s: the sand and the prints on, High\'s details, the art dials at one');
  ok(out.dustBright === 0.6 && out.dustSelfShadow === 1, "and the dust's look");
  volQualityFrom({ ...DEFAULT_SETTINGS, volDustBright: 5, volDustSelfShadow: -2 } as Settings, out);
  ok(out.dustBright === 2 && out.dustSelfShadow === 0, "a hand-edited look is held to the page's ends");
  volQualityFrom(DEFAULT_SETTINGS, out, { volDustBright: 3 });
  ok(out.dustBright === 3, "and one from the console past them is in force through `over`");
  volQualityFrom(DEFAULT_SETTINGS, out);
  const odd = { ...DEFAULT_SETTINGS, volAirDetail: 100, volDustDetail: 5, volAirSolve: 999, volLightSteps: -4, airVolumeAmount: Number.NaN, volSandDetail: 5, volPrintDetail: 999, volArtPrints: 9, volArtShade: -1 } as Settings;
  volQualityFrom(odd, out);
  ok(out.airDetail === 128 && out.dustDetail === 4 && out.solve === 40 && out.lightSteps === 12 && out.volumeAmount === 1, 'a hand-edited file is held to the page: a detail not on the list takes High\'s, a range its ends, a NaN its default');
  ok(out.sandDetail === 2 && out.printDetail === 2048 && out.artPrints === 1.5 && out.artShade === 0, 'the ground\'s details and art dials the same way');
  volQualityFrom(DEFAULT_SETTINGS, out, { volAirSolve: 60, volumetrics: true });
  ok(out.solve === 60 && out.on === true, 'a console value past the page\'s end is in force through `over`');
  const fields = Object.keys(newVolTune());
  ok(fields.every((f) => typeof (VOL_TUNE as unknown as Record<string, unknown>)[f] === typeof (newVolTune() as unknown as Record<string, unknown>)[f]), 'the session\'s record has every field, its first values the right types');
  ok(newVolTune().stormThin === 0.5 && Number.isInteger(newVolTune().stormThin) === false, 'a field that holds a fraction starts as one');
  volQualityFrom(DEFAULT_SETTINGS, out);
  ok(out.particles && out.leaves && out.puffs && out.spray && out.streaks && out.rain && !out.snow && out.particleDetail === 1 && out.rainDetail === 16384 && out.rainThin === 1 && out.snowThin === 1, "and the fourth wave's: the particles, every kind and the rain on, the snow off, High's counts");
  volQualityFrom({ ...DEFAULT_SETTINGS, volParticleDetail: 3, volRainDetail: 999, volRainThin: 4 } as Settings, out);
  ok(out.particleDetail === 1 && out.rainDetail === 16384 && out.rainThin === 1, "a hand-edited count not on the list takes High's, the thinning held to its ends");
  // Every switch of the fourth wave, moved away from its default alone, moves its own field of the record and no other's
  // (a switch written as its default would pass every check above).
  const SWITCHES: [keyof Settings, keyof typeof out][] = [
    ['volParticles', 'particles'],
    ['volLeaves', 'leaves'],
    ['volPuffs', 'puffs'],
    ['volSpray', 'spray'],
    ['volStreaks', 'streaks'],
    ['volParticleShadows', 'particleShadows'],
    ['volRain', 'rain'],
    ['volSnow', 'snow'],
    ['volFromFeet', 'fromFeet'],
  ];
  const base = { ...volQualityFrom(DEFAULT_SETTINGS, newVolTune()) } as unknown as Record<string, unknown>;
  for (const [key, field] of SWITCHES) {
    const flipped = !(S[key] as boolean);
    const got = volQualityFrom({ ...DEFAULT_SETTINGS, [key]: flipped } as Settings, newVolTune()) as unknown as Record<string, unknown>;
    const others = Object.keys(base).filter((f) => f !== field && got[f] !== base[f]);
    ok(got[field] === flipped && others.length === 0, `"${key}" flipped to ${flipped} moves the record's "${String(field)}" and nothing else${others.length ? ` (also moved: ${others.join(', ')})` : ''}`);
  }
  for (const [key, field, v] of [['volRainThin', 'rainThin', 0.25], ['volSnowThin', 'snowThin', 0.4], ['volParticleDetail', 'particleDetail', 2], ['volRainDetail', 'rainDetail', 4096]] as [keyof Settings, string, number][]) {
    const got = volQualityFrom({ ...DEFAULT_SETTINGS, [key]: v } as Settings, newVolTune()) as unknown as Record<string, unknown>;
    ok(got[field] === v, `"${key}" at ${v} is the record's "${field}"`);
  }
  // The record a node test builds (`newVolTune`) is the record the game's defaults write, for the fourth wave's fields:
  // a harness run on the one never stands at numbers the shipped game does not.
  const fresh = newVolTune() as unknown as Record<string, unknown>;
  const W4 = ['particles', 'leaves', 'puffs', 'spray', 'streaks', 'particleDetail', 'particleShadows', 'rain', 'snow', 'rainDetail', 'rainThin', 'snowThin'];
  const differ = W4.filter((f) => fresh[f] !== base[f]);
  ok(differ.length === 0, `newVolTune() holds the fourth wave's every field at the defaults' own value${differ.length ? ` (differs: ${differ.map((f) => `${f} ${String(fresh[f])} against ${String(base[f])}`).join(', ')})` : ''}`);
}

// --- the console ---
{
  const a = volConsoleToSettings({ on: true, preset: 'medium', airVolumeSteps: 24 });
  const by = Object.fromEntries(a.map((c) => [c.key, c]));
  ok(by.volumetrics?.value === true && by.airVolumeSteps?.value === 24 && by.volAirDetail?.value === 96, 'on, a preset and a key by name: the key wins over the preset');
  ok(a.every((c) => c.inRange), 'and every one is a value the page can hold');
  const b = volConsoleToSettings({ volAirSolve: 60, volDust: 'yes', airVolumeAmount: Number.NaN, volLight: false, nonsense: 3 });
  const bb = Object.fromEntries(b.map((c) => [c.key, c]));
  ok(bb.volAirSolve?.inRange === false && bb.volLight?.value === false && !('volDust' in bb) && !('airVolumeAmount' in bb) && !('nonsense' in bb), 'past the range is marked; a word for a switch, a NaN and a key it has not got are dropped');
}

// --- the page and the console share their ends ---
for (const [key, r] of Object.entries(VOL_RANGES)) {
  const knob = knobOf(key);
  ok(!!knob, `the range of "${key}" has a knob`);
  if (!knob) continue;
  if ('options' in r) ok(JSON.stringify(knob.options?.map((o) => o.value)) === JSON.stringify(r.options), `"${key}"'s options are the console's`);
  else ok(knob.min === r.min && knob.max === r.max, `"${key}"'s ends are the console's`);
}
for (const k of VOL_PAGE_KEYS) ok(isVolKey(k), `the page's "${k}" is one of the pass's keys`);
for (const k of VOL_KEYS) ok(VOL_PAGE_KEYS.includes(k), `"${k}" is on the page`);
const fxRows = FX_KNOBS.filter((k) => k.group === 'volumetrics').map((k) => k.key);
ok(fxRows.length === VOL_FX_KEYS.length && VOL_FX_KEYS.every((k) => fxRows.includes(k)), 'the effects registry\'s volumetrics rows are exactly the pass\'s FX keys');
ok(VOLUMETRICS[0].knobs[1].kind === 'preset' && typeof VOLUMETRICS[0].knobs[1].presetOf === 'function', 'the preset is a knob of its own kind beside the master');
for (const g of VOLUMETRICS) for (const k of g.knobs) if (k.key !== 'volumetrics') ok(!!k.requires?.includes('volumetrics'), `"${k.key}" greys under the master`);

// --- through the settings' own storage ---
{
  const bag = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (bag.has(k) ? bag.get(k)! : null),
    setItem: (k: string, v: string) => void bag.set(k, v),
    removeItem: (k: string) => void bag.delete(k),
  };
  const ultraSand = { ...DEFAULT_SETTINGS, ...VOL_PRESETS.ultra, volSandDetail: 2 } as Settings;
  saveSettings(ultraSand);
  const written = JSON.parse(bag.get('swg.settings') ?? '{}') as Record<string, unknown>;
  ok(written[VOL_QUALITY_STAMP] === VOL_QUALITY_WAVE && !('volSandDetail' in written), 'a save carries the wave it was written in, and leaves a default out');
  const back = loadSettings();
  ok(back.volSandDetail === 2 && presetOf(back) === 'custom', 'and loads back as it was saved: Ultra with High\'s sand detail is Custom');
  // A fifth wave's Ultra through the storage: the sand's old ×6 is written, and loads as Ultra's new ×3.
  const fifthUltra: Record<string, unknown> = { [VOL_QUALITY_STAMP]: 5 };
  for (const k of VOL_QUALITY_KEYS) if (k !== 'volSandDetail' && VOL_PRESETS.ultra[k] !== (S as Record<string, unknown>)[k]) fifthUltra[k] = VOL_PRESETS.ultra[k];
  fifthUltra.volSandDetail = 6;
  bag.set('swg.settings', JSON.stringify(fifthUltra));
  const u5 = loadSettings();
  ok(u5.volSandDetail === 3 && presetOf(u5) === 'ultra', "an Ultra saved by the fifth wave (the sand at ×6) loads as Ultra, its sand at the new ×3");
  const firstWave: Record<string, unknown> = {};
  for (const k of VOL_QUALITY_KEYS) if (!VOL_QUALITY_LATER.includes(k) && VOL_PRESETS.low[k] !== (S as Record<string, unknown>)[k]) firstWave[k] = VOL_PRESETS.low[k];
  bag.set('swg.settings', JSON.stringify(firstWave));
  ok(presetOf(loadSettings()) === 'low', 'a Low saved by the first wave, with no stamp, loads as Low');
  bag.clear();
  ok(presetOf(loadSettings()) === 'high', 'and nothing saved is High');
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
}

// --- memory ---
ok(volMemoryMB(newVolTune(), 2560, 1440) > 10 && volMemoryMB(newVolTune(), 2560, 1440) < 120, `High at 2560x1440 is about ${volMemoryMB(newVolTune(), 2560, 1440)} MB (the design's ~55)`);

console.log(`\n${checks} checks passed`);
