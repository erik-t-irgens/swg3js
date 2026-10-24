// The volumetrics' settings (src/world/volumetrics/volSettings.ts, the page's rows in src/ui/volPage.ts): every key in
// the defaults with its type and the master off; every preset inside every knob's range and worked out again to
// itself; one quality key moved reads Custom; the kept record written in place; the console's fields as settings;
// the page's ranges and the console's the same numbers. (That a settings file saved by the commit before the pass
// loads to the new defaults is the off-proof's, `airOff.test.ts`, which can load that commit's own module.)
//
// Plain type stripping: every module here imports only `.ts`-suffixed modules.
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/core/settings.ts';
import { FX_DEFAULTS, FX_KNOBS, isFxSettingKey } from '../../../src/core/fxRegistry.ts';
import { isVolKey, newVolTune, presetOf, VOL_APPLY_CLASS, VOL_FX_KEYS, VOL_KEYS, VOL_PRESET_NAMES, VOL_PRESETS, VOL_QUALITY_KEYS, VOL_RANGES, VOL_SCENE_KEYS, VOL_TUNE, volConsoleToSettings, volMemoryMB, volQualityFrom } from '../../../src/world/volumetrics/volSettings.ts';
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
};
for (const k of VOL_KEYS) ok(typeof S[k] === types[k], `"${k}" is in the defaults as a ${types[k]}`);
ok(Object.keys(types).length === VOL_KEYS.length, 'and those are every key the pass speaks for, no more');
for (const k of VOL_FX_KEYS) ok(isFxSettingKey(k) && (FX_DEFAULTS as unknown as Record<string, unknown>)[k] === S[k], `"${k}" is the effects registry's, with the same default there`);
for (const k of VOL_SCENE_KEYS) ok(!isFxSettingKey(k), `"${k}" is a scene key the chain never reads`);
ok(VOL_KEYS.every((k) => isVolKey(k)) && !isVolKey('effects') && !isVolKey('bloom'), 'isVolKey answers the pass\'s keys and nothing else');
for (const k of VOL_KEYS) ok(['A', 'C', 'T', 'U'].includes(VOL_APPLY_CLASS[k as keyof typeof VOL_APPLY_CLASS]), `"${k}" says how it takes effect (${VOL_APPLY_CLASS[k as keyof typeof VOL_APPLY_CLASS]})`);
ok(VOL_APPLY_CLASS.volumetrics === 'A', 'the master is class A in this wave: on waits for an arrival');
// No later wave's key is in this build at all, shown or hidden.
for (const later of ['volAirLayers', 'volSmoke', 'volFog', 'volSmokeDetail', 'volSand', 'volSandDetail', 'volPrints', 'volPrintDetail', 'volCurrent', 'volLiquidDetail', 'volLava', 'volGrass', 'volArtSand', 'volArtPrints', 'volArtShade', 'volArtWater', 'volArtLava', 'volArtGrass', 'volFromFeet', 'volFromPeers']) {
  ok(!(later in S), `"${later}" (a later wave's) is not in this build`);
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
ok(!(VOL_QUALITY_KEYS as readonly string[]).some((k) => ['volumetrics', 'airVolume', 'volAir', 'volDust', 'volKickUp', 'volLight', 'airVolumeAmount', 'volStormThin', 'volFromEngines', 'volFromForce', 'volFromBlasts'].includes(k)), 'no switch and no art dial is a quality key');

// --- the kept record ---
{
  const out = newVolTune();
  const back = volQualityFrom(DEFAULT_SETTINGS, out);
  ok(back === out, 'volQualityFrom writes into the record it is handed and answers it');
  ok(out.on === false && out.air && out.dust && out.kickUp && out.light && out.volume, 'the defaults write the master off and every switch under it on');
  ok(out.airDetail === 128 && out.solve === 20 && out.rate === 60 && out.dustDetail === 4 && out.lightDetail === 2 && out.lightSteps === 26 && out.volumeSteps === 16 && out.volumeResolution === 0.5, 'and High\'s numbers');
  const odd = { ...DEFAULT_SETTINGS, volAirDetail: 100, volDustDetail: 5, volAirSolve: 999, volLightSteps: -4, airVolumeAmount: Number.NaN } as Settings;
  volQualityFrom(odd, out);
  ok(out.airDetail === 128 && out.dustDetail === 4 && out.solve === 40 && out.lightSteps === 12 && out.volumeAmount === 1, 'a hand-edited file is held to the page: a detail not on the list takes High\'s, a range its ends, a NaN its default');
  volQualityFrom(DEFAULT_SETTINGS, out, { volAirSolve: 60, volumetrics: true });
  ok(out.solve === 60 && out.on === true, 'a console value past the page\'s end is in force through `over`');
  const fields = Object.keys(newVolTune());
  ok(fields.every((f) => typeof (VOL_TUNE as unknown as Record<string, unknown>)[f] === typeof (newVolTune() as unknown as Record<string, unknown>)[f]), 'the session\'s record has every field, its first values the right types');
  ok(newVolTune().stormThin === 0.5 && Number.isInteger(newVolTune().stormThin) === false, 'a field that holds a fraction starts as one');
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

// --- memory ---
ok(volMemoryMB(newVolTune(), 2560, 1440) > 10 && volMemoryMB(newVolTune(), 2560, 1440) < 120, `High at 2560x1440 is about ${volMemoryMB(newVolTune(), 2560, 1440)} MB (the design's ~55)`);

console.log(`\n${checks} checks passed`);
