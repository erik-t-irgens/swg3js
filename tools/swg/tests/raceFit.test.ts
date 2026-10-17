// The race upgrades kept with the character in a vehicle's fit (src/vehicles/shipFit.ts): seven `race_*` keys in the
// fit's components, each naming a level part (`race_top_3`), absent at stock. Guarded three ways -- `resolveFit` steps
// over them without a note, `fitForWire` strips them so no hello carries handling, and a save by any writer but the race
// writer keeps the ones already kept (`keepRaceKeys`) -- and resolved against the base of the kind the vehicle was
// spawned as, so a pod's levels raced as a bike are a bike's upgrades at the same levels; and the game's own saves and
// spawn, which call those rules, pinned by their text. Invented fits throughout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RACE_KEY,
  fitForWire,
  keepRaceKeys,
  keptFitEmpty,
  packFit,
  paintOnlyFit,
  raceLevelsOf,
  resolveFit,
  stockFit,
  withRaceLevels,
  type FitPaint,
  type ShipFit,
} from '../../../src/vehicles/shipFit.ts';
import { RACE_CATEGORIES, newBase, resolveRace } from '../../../src/vehicles/raceMath.ts';
import { RACE_UPGRADES, baseFor } from '../../../src/vehicles/raceTune.ts';
import { RaceDrive } from '../../../src/vehicles/raceDrive.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// A painted speeder's paint, shaped as the gallery writes one: two palette colours.
const PAINT: FitPaint = {
  shaders: ['shader/test_speeder_paint.sht'],
  variables: [
    { name: '/private/index_color_1', kind: 'palette', palette: 'palette/test.pal', size: 64, default: 0 },
    { name: '/private/index_color_2', kind: 'palette', palette: 'palette/test.pal', size: 64, default: 3 },
  ],
};

// --- the keys -----------------------------------------------------------------------------------------------------------
{
  const fit = withRaceLevels(stockFit(), { top: 3, cooling: 5, repair: 0 });
  ok(fit.components.race_top === 'race_top_3' && fit.components.race_cooling === 'race_cooling_5', 'a level is kept as its category\'s key naming a level part');
  ok(!('race_repair' in fit.components), 'level 0 is stock, which is the key absent');
  ok(Object.keys(fit.components).every((k) => RACE_KEY.test(k)) && RACE_CATEGORIES.every((c) => !(`race_${c}` in fit.components) || /^race_[a-z]+_[1-5]$/.test(fit.components[`race_${c}`])), 'every key it writes is a race key naming a level one to five');
  const levels = raceLevelsOf(fit);
  ok(levels.top === 3 && levels.cooling === 5 && levels.repair === undefined && Object.keys(levels).length === 2, 'and the levels read back are the ones written, the rest absent');
  const merged = withRaceLevels(fit, { accel: 2, top: 0 });
  ok(merged.components.race_accel === 'race_accel_2' && !('race_top' in merged.components) && merged.components.race_cooling === 'race_cooling_5', 'writing some levels moves those and keeps the others the fit had');
  const max = withRaceLevels(null, { traction: 5, turning: 5, accel: 5, top: 5, airbrake: 5, cooling: 5, repair: 5 });
  ok(Object.keys(max.components).length === 7, 'all seven at once are seven keys');
  ok(Object.keys(raceLevelsOf({ components: { race_top: 'race_turning_3', race_accel: 'race_accel_9', race_cooling: 'nonsense', race_bogus: 'race_bogus_2' }, paint: {} })).length === 0, 'a key naming another category\'s part, a level past five, a word that is no part or a category that does not exist reads as stock');
  ok(Object.keys(raceLevelsOf(null)).length === 0 && Object.keys(raceLevelsOf(stockFit())).length === 0, 'no fit, and a stock one, read as stock everywhere');
}

// --- packFit keeps them, and a fit of race keys alone is kept --------------------------------------------------------
{
  const fit = withRaceLevels({ components: {}, paint: { '/private/index_color_1': 7 } }, { top: 4, airbrake: 1 });
  const packed = packFit(fit);
  ok(packed.components.race_top === 'race_top_4' && packed.components.race_airbrake === 'race_airbrake_1' && packed.paint['/private/index_color_1'] === 7, 'packFit keeps the race keys beside the paint, as it keeps any slot');
  const only = packFit(withRaceLevels(stockFit(), { top: 2 }));
  ok(!keptFitEmpty(only), 'a fit of race upgrades alone is kept');
  ok(keptFitEmpty(packFit(withRaceLevels(only, { top: 0 }))), 'and one taken back to stock is absent, as every stock fit is');
}

// --- resolveFit steps over them without a note --------------------------------------------------------------------------
{
  const def = paintOnlyFit(PAINT)!;
  const saved = withRaceLevels({ components: {}, paint: { '/private/index_color_1': 12 } }, { top: 5, repair: 3 });
  const resolved = resolveFit(def, [], new Map(), [], saved);
  ok(resolved.notes.length === 0, 'a painted speeder\'s fit with race keys resolves with no note about them');
  ok(resolved.paint['/private/index_color_1'] === 12 && resolved.painted, 'and its paint resolves as it always did');
  ok(!Object.keys(resolved.components).some((k) => RACE_KEY.test(k)), 'and they are not slots of the resolved fit');
  const bogus = resolveFit(def, [], new Map(), [], { components: { engine: 'eng_test' }, paint: {} });
  ok(bogus.notes.length === 1 && /no such slot/.test(bogus.notes[0]), 'while a slot the hull has not got is still noted, as before');
}

// --- fitForWire strips them, both ways --------------------------------------------------------------------------------
{
  const plain = withRaceLevels({ components: {}, paint: { '/private/index_color_1': 5 } }, { top: 5, cooling: 2 });
  const a = fitForWire(plain, PAINT, null).fit;
  ok(!Object.keys(a.components).some((k) => RACE_KEY.test(k)) && a.paint['/private/index_color_1'] === 5, 'a hello carries no race key, with the paint as it is');
  const whole = withRaceLevels({ components: {}, paint: { '/private/index_color_1': -(0x336699 + 1) } }, { traction: 1 });
  const b = fitForWire(whole, PAINT, { 'palette/test.pal': [[0, 0, 0], [51, 102, 153], [255, 255, 255]] }).fit;
  ok(!Object.keys(b.components).some((k) => RACE_KEY.test(k)) && b.colours?.['/private/index_color_1'] === -(0x336699 + 1), 'nor does one whose paint carries a colour whole, which goes the other way through it');
  ok(plain.components.race_top === 'race_top_5', 'and the kept fit it was made from keeps them');
  const none: ShipFit = { components: { engine: 'eng_test' }, paint: {} };
  ok(fitForWire(none, null, null).fit === none, 'a fit with no race key goes as it is, the very object');
}

// --- keepRaceKeys: a save that is not the race writer's ----------------------------------------------------------------
{
  const kept = withRaceLevels({ components: {}, paint: { '/private/index_color_1': 2 } }, { top: 3, turning: 4 });
  // The edit page saves the whole fit it shows: a new colour, and no race key at all.
  const page: ShipFit = { components: {}, paint: { '/private/index_color_1': 9, '/private/index_color_2': 1 } };
  const saved = keepRaceKeys(kept, page);
  ok(saved.components.race_top === 'race_top_3' && saved.components.race_turning === 'race_turning_4', "the edit page's save keeps the upgrades the kept fit had");
  ok(saved.paint['/private/index_color_1'] === 9 && saved.paint['/private/index_color_2'] === 1, 'and takes its own paint');
  const sneaky: ShipFit = { components: { race_top: 'race_top_5' }, paint: {} };
  ok(keepRaceKeys(kept, sneaky).components.race_top === 'race_top_3', 'a race key in a save that is not the race writer\'s is never its own: the kept one stands');
  ok(!('race_top' in keepRaceKeys(null, sneaky).components), 'and with nothing kept, it is dropped');
  ok(keepRaceKeys(kept, { components: { engine: 'eng_test' }, paint: {} }).components.engine === 'eng_test', 'a slot of the save is kept beside them');
}

// --- levels resolved against the base of the kind spawned as ----------------------------------------------------------
{
  const fit = withRaceLevels(stockFit(), { top: 5, accel: 3, cooling: 2 });
  const levels = raceLevelsOf(fit);
  // A pod's kept levels, the pod spawned as a bike: the drive is a bike's, and the levels are its upgrades.
  const bike = new RaceDrive('bike', { ground: null });
  bike.setLevels(levels, null);
  const pod = new RaceDrive('pod', { ground: null });
  pod.setLevels(levels, null);
  const bikeWant = resolveRace(baseFor('bike', newBase()), levels, 1, RACE_UPGRADES, newBase());
  const podWant = resolveRace(baseFor('pod', newBase()), levels, 1, RACE_UPGRADES, newBase());
  ok(Math.abs(bike.handling.V - bikeWant.V) < 1e-9 && Math.abs(bike.handling.t75 - bikeWant.t75) < 1e-9 && Math.abs(bike.handling.coolSeconds - bikeWant.coolSeconds) < 1e-9, "a pod's levels spawned as a bike resolve against the bike's base");
  ok(Math.abs(pod.handling.V - podWant.V) < 1e-9 && Math.abs(bike.handling.V - pod.handling.V) > 1, 'and against the pod\'s raced as a pod, which is another top');
  ok(bike.levels.top === 5 && bike.levels.accel === 3 && bike.levels.cooling === 2 && bike.levels.traction === 0, 'the drive holds the levels the fit names and stock for the rest');
}

// --- the game's own wiring, by its text: the saves and the spawn go through the rules above ---------------------------
{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const at = main.indexOf('private saveFit(id: string, fit: ShipFit, raceWriter = false): void {');
  const save = main.slice(at, main.indexOf('\n  }\n', at));
  ok(at > 0 && /\n\s*const packed = packFit\(raceWriter \? fit : keepRaceKeys\(this\.savedFit\(id\), fit\)\);\n/.test(save), '(main.ts: every save but the race writer\'s lays the kept upgrades back over what it saves)');
  // Every call of it on one line each: exactly one says it is the race writer, and that one writes the drive's levels.
  const calls = main.split('\n').filter((l) => l.includes('this.saveFit('));
  const writers = calls.filter((l) => /, true\)/.test(l));
  ok(calls.length >= 3 && writers.length === 1 && /this\.saveFit\(id, withRaceLevels\(this\.savedFit\(id\), race\.levels\), true\);/.test(writers[0]), `(main.ts: of ${calls.length} saves only the console's race({ upgrades }) is the race writer)`);
  const s = main.indexOf('async spawnVehicle(def: VehicleDef, kind?: VehicleKind): Promise<string> {');
  const spawn = main.slice(s, main.indexOf('} catch (err)', s));
  ok(s > 0 && /const v = await this\.world\.spawnVehicle\([^\n]*\);\n(?:\s*\/\/[^\n]*\n)*\s*if \(v\.race\) \{\n\s*const levels = raceLevelsOf\(this\.savedFit\(def\.id\)\);\n\s*if \(Object\.keys\(levels\)\.length\) v\.race\.setLevels\(levels, v\);\n/.test(spawn), '(main.ts: a spawn sets the kept levels on the drive it was given, by the def\'s id, as soon as it stands)');
}

console.log(`\n${checks} checks passed`);
