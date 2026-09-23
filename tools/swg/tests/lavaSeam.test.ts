// The one place the converter and the game meet over lava, tested from both ends at once.
//
// `tools/swg/water.mjs` writes the client's two terrain tables into a planet's `water.json`, and the
// game reads that block back through `readWaterPack`, `lavaImmuneTemplates` and the immunity
// registry. Each side has its own test, and each passes happily while spelling a field differently
// from the other: a row written as `damages` rather than `damage` would leave every flow harmless on
// a converted pack while an unconverted one still burned, and `tsc` would have nothing to say about
// it. So this runs the real writer into the real readers and asks the question the garage asks.
//
// **Every number here is invented for the test.** The client's own water values are in the archives
// and are written down nowhere in this repository; the fixture below is a quarter of a life every
// two seconds, which is nobody's.
import assert from 'node:assert/strict';
import { waterHarmTypes, waterImmunity } from '../water.mjs';
import { readWaterPack } from '../../../src/world/waterLook.ts';
import { LAVA_HARM, applyLavaHarm, lavaImmuneTemplates, resetLavaHarm } from '../../../src/world/lavaHarmMath.ts';
import { lavaImmuneTemplate, setLavaImmunity } from '../../../src/world/lavaImmunity.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// The two tables as `parseDatatable` hands them back, with values that are nobody's.
const values = {
  rows: [
    { water_type: 'water', causes_damage: 0, damage_kills: 0, damage_interval_secs: 0, damage_per_interval_percentage: 0, transparent: 1 },
    { water_type: 'hot_soup', causes_damage: 1, damage_kills: 1, damage_interval_secs: 2, damage_per_interval_percentage: 25, transparent: 0 },
  ],
};
const creatures = { rows: [{ object_template_name: 'object/mobile/vehicle/invented_skiff.iff', lava_resistance: 100 }] };

// What the converter would write, and the pack it would write it into.
const harm = { files: {}, types: waterHarmTypes(values), immune: waterImmunity(creatures, (p: string) => p.includes('shared_')) };
const pack = { version: 1, planet: 'nowhere', global: null, harm, shaders: {}, notes: [] };

{
  const data = readWaterPack(pack);
  ok(!!data && !!(data as { harm?: unknown }).harm, 'the harm block survives the reader that keeps only the fields it knows');
}

{
  resetLavaHarm();
  const applied = applyLavaHarm(pack);
  ok(applied.source === 'pack', "the game takes the pack's own numbers rather than its fallback");
  ok(LAVA_HARM.share === 0.25, 'the share the writer wrote is the share the game applies');
  ok(LAVA_HARM.interval === 2, 'and so is the interval');
  ok(LAVA_HARM.kills === true, 'and whether it kills');
  resetLavaHarm();
}

{
  // The row the writer writes is an object, not a string: the reader must take it as it comes.
  const names = lavaImmuneTemplates(pack);
  ok(names.length === 1, 'the wired reader sees the immunity row the writer wrote');
  setLavaImmunity(names);
  ok(lavaImmuneTemplate('object/mobile/vehicle/shared_invented_skiff.iff'), 'and a hull the client lists is immune, joined through the shared name the packs are keyed on');
  ok(!lavaImmuneTemplate('object/mobile/vehicle/shared_invented_other.iff'), 'while a hull nobody listed is not');
  setLavaImmunity(null);
}

{
  // A pack from before the water command learned any of this: nothing burns, which is what every
  // planet on disk does today.
  resetLavaHarm();
  const applied = applyLavaHarm({ version: 1, planet: 'nowhere', global: null, shaders: {}, notes: [] });
  ok(applied.source !== 'pack', 'an older pack carries no block, and the game says so rather than inventing one');
  ok(lavaImmuneTemplates({ version: 1 }).length === 0, 'and names nobody immune');
  resetLavaHarm();
}

console.log(`\n${passed} checks passed`);
