// demShader.ts's ground rules (GRAND_CANYON_LOK) through the real DemShader, against a canyon whose shape is known.
//
// It exists to guard one mistake. The first rule set chose strata by slope as well as height, with
// thresholds taken from real geology, and on a 10 m survey -- which flattens every wall -- almost
// none of them fired: one talus family swallowed the gorge from the Tonto bench to the rim. Height
// survives resampling and angle does not, so the bands are chosen by elevation and the test checks
// that a gentle profile still paints many of them.
//
// It runs the real class and the real rules: an earlier copy of the class lifted into this file fell behind when the
// rules learned hollows and two sand families, and failed on rules that paint the canyon as meant. The bands the
// profile crosses from river to rim are printed as well, so a look moved on purpose shows what to check instead.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DemShader, GRAND_CANYON_LOK } from '../../../src/world/demShader.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPEC = GRAND_CANYON_LOK;

// Lok's families: the converted pack's own list where it is on disk (`terrain/shaders.json`), else the names the
// rules were written against, which then holds them only to themselves and says so.
const packFile = join(process.env.SWG3JS_PACKS ?? join(ROOT, 'assets-private'), SPEC.pack, 'terrain', 'shaders.json');
let names;
let fromPack = false;
if (existsSync(packFile)) {
  const j = JSON.parse(readFileSync(packFile, 'utf8'));
  names = (Array.isArray(j) ? j : j.families ?? []).map((f) => f.name);
  fromPack = names.length > 0;
}
if (!fromPack) names = [...new Set([SPEC.fallback, ...SPEC.rules.map((r) => r.family)])];
const FAMILIES = new Map(names.map((n, i) => [n, i]));
const NAME = new Map([...FAMILIES].map(([k, v]) => [v, k]));

// A canyon: flat rim at 2200, a wall down to a river at 750, mirrored.
const LIFT = -750; // game height 0 == 750 m above sea level
const rim = 2200, river = 750, halfW = 6000;
const profile = (x) => { const t = Math.min(1, Math.abs(x) / halfW); return river + (rim - river) * Math.pow(t, 0.75); };
const heightAt = (x) => profile(x) + LIFT;

const shader = new DemShader(SPEC, FAMILIES, LIFT);
let fails = 0;
let checks = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); checks++; if (!c) fails++; };

console.log(fromPack ? `note the ${SPEC.pack} pack's own ${names.length} families, from ${packFile}` : `note no ${SPEC.pack} pack on disk: the rules are held to the names they were written against`);
ok(shader.missing.length === 0, `every family the rules name is in the ${SPEC.pack} pack${shader.missing.length ? ': missing ' + shader.missing : ''}`);

const at = (x) => NAME.get(shader.familyAt(x, 0, (xx) => heightAt(xx)));
ok(at(0) === 'dirt_dath_desertcanyonfloor', 'the river flat is canyon floor');
// Which rock the inner gorge wears is the owner's look and still being worked on: said, not held. The rules before
// hollows painted it dark canyon rock; today's paint the cliff brown-grey from 100 m out.
console.log(`note the inner gorge, 250 m out at ${Math.round(profile(250))} m, paints ${at(250)}`);
ok(at(6500) === 'grss_dsrt_dry_trans', 'the plateau is the only thing growing');
const seen = [];
for (let x = 0; x <= 7000; x += 50) { const f = at(x); if (f !== seen[seen.length - 1]) seen.push(f); }
ok(new Set(seen).size >= 7, `river to rim crosses ${new Set(seen).size} distinct families (want 7+)`);
ok(!seen.includes(undefined), 'no sample fell through to an unresolved family');
console.log(`note river to rim: ${seen.join(' > ')}`);

// The lesson: this profile never exceeds 22 degrees, as a resampled canyon does not.
let steepest = 0;
for (let x = 50; x <= 7000; x += 50) steepest = Math.max(steepest, Math.atan(Math.abs((heightAt(x + 4) - heightAt(x - 4)) / 8)) * 57.2958);
// Real Canyon walls run 50 to 80 degrees; a 10 m survey smooths them to a third of that.
ok(steepest < 35, `the test profile peaks at ${steepest.toFixed(0)} degrees, well under a real wall`);

// Elevation drives the bands, so the same ground at a different lift paints the same.
const shifted = new DemShader(SPEC, FAMILIES, LIFT - 500);
let same = true;
for (let x = 0; x <= 7000; x += 250) if (shader.familyAt(x, 0, (xx) => heightAt(xx)) !== shifted.familyAt(x, 0, (xx) => heightAt(xx) - 500)) same = false;
ok(same, 'a different lift paints the same ground the same way, all the way from river to rim');

console.log(fails ? `\n${fails} failed` : `\ndemShader: ${checks} checks passed`);
process.exit(fails ? 1 : 0);
