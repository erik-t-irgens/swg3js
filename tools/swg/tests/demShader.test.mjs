// demShader.ts's rule evaluation, lifted verbatim, against a canyon whose answer is known.
//
// It exists to guard one mistake. The first rule set chose strata by slope as well as height, with
// thresholds taken from real geology, and on a 10 m survey -- which flattens every wall -- almost
// none of them fired: one talus family swallowed the gorge from the Tonto bench to the rim. Height
// survives resampling and angle does not, so the bands are chosen by elevation and the test checks
// that a gentle profile still produces all of them.
function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123; return s - Math.floor(s); }
class DemShader {
  constructor(spec, families, lift, step = 4) {
    this.spec = spec; this.lift = lift; this.step = step; this.missing = [];
    const find = (n) => { const id = families.get(n); if (id === undefined) { if (!this.missing.includes(n)) this.missing.push(n); return -1; } return id; };
    this.ids = spec.rules.map((r) => find(r.family));
    this.fallbackId = find(spec.fallback);
    if (this.fallbackId < 0) { const f = families.values().next(); this.fallbackId = f.done ? 0 : f.value; }
  }
  familyAt(x, z, heightAt) {
    const h = heightAt(x, z), e = this.step;
    const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    const slope = Math.atan(Math.hypot(gx, gz)) * 57.29577951308232;
    const elevation = h - this.lift;
    for (let i = 0; i < this.spec.rules.length; i++) {
      const id = this.ids[i]; if (id < 0) continue;
      const r = this.spec.rules[i];
      const wob = r.fuzz ? (hash2(x * 0.021, z * 0.021) - 0.5) * 2 * r.fuzz : 0;
      if (r.aboveSlope !== undefined && slope < r.aboveSlope) continue;
      if (r.belowSlope !== undefined && slope > r.belowSlope) continue;
      if (r.aboveElevation !== undefined && elevation + wob < r.aboveElevation) continue;
      if (r.belowElevation !== undefined && elevation + wob > r.belowElevation) continue;
      return id;
    }
    return this.fallbackId;
  }
}
const LOK = new Map([['dirt_dath_desertcanyonfloor',1],['dirt_grasslands',23],['dirt_lok_smallrock',11],
  ['dirt_redsandy',25],['grss_dsrt_dry_trans',22],['rock_cliffbrowngray',2],['rock_dath_cliffred',30],
  ['rock_dath_desertcanyon',16],['rock_dath_desertdirty',6],['rock_lok_whitecliff',13],['rock_rusted_orange',19]]);
const NAME = new Map([...LOK].map(([k,v])=>[v,k]));
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TS = readFileSync(join(ROOT, 'src', 'world', 'demShader.ts'), 'utf8');
const SPEC = eval('(' + TS.match(/export const GRAND_CANYON_LOK: GroundRules = (\{[\s\S]*?\n\};)/)[1]
  .replace(/\n\s*\/\/[^\n]*/g, '').replace(/;$/, '') + ')');

// A canyon: flat rim at 2200, a wall down to a river at 750, mirrored.
const LIFT = -750;                       // game height 0 == 750 m above sea level
const rim = 2200, river = 750, halfW = 6000;
const profile = (x) => { const t = Math.min(1, Math.abs(x)/halfW); return river + (rim-river)*Math.pow(t, 0.75); };
const heightAt = (x) => profile(x) + LIFT;

const shader = new DemShader(SPEC, LOK, LIFT);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

ok(shader.missing.length === 0, `every family the rules name is in the pack${shader.missing.length ? ': missing ' + shader.missing : ''}`);

const at = (x) => NAME.get(shader.familyAt(x, 0, (xx) => heightAt(xx)));
ok(at(0) === 'dirt_dath_desertcanyonfloor', 'the river flat is canyon floor');
ok(at(250) === 'rock_dath_desertcanyon', 'the inner gorge is dark canyon rock');
ok(at(6500) === 'grss_dsrt_dry_trans', 'the plateau is the only thing growing');

const seen = [];
for (let x = 0; x <= 7000; x += 50) { const f = at(x); if (f !== seen[seen.length - 1]) seen.push(f); }
ok(new Set(seen).size >= 7, `river to rim crosses ${new Set(seen).size} distinct families (want 7+)`);

// The lesson: this profile never exceeds 22 degrees, as a resampled canyon does not.
let steepest = 0;
for (let x = 50; x <= 7000; x += 50) steepest = Math.max(steepest, Math.atan(Math.abs((heightAt(x + 4) - heightAt(x - 4)) / 8)) * 57.2958);
// Real Canyon walls run 50 to 80 degrees; a 10 m survey smooths them to a third of that.
ok(steepest < 35, `the test profile peaks at ${steepest.toFixed(0)} degrees, well under a real wall`);
ok(!seen.includes(undefined), 'no sample fell through to an unresolved family');

// Elevation drives the bands, so the same ground at a different lift paints the same.
const shifted = new DemShader(SPEC, LOK, LIFT - 500);
const a = shader.familyAt(2000, 0, (xx) => heightAt(xx));
const b = shifted.familyAt(2000, 0, (xx) => heightAt(xx) - 500);
ok(a === b, 'a different lift paints the same ground the same way');

console.log(fails ? `\n${fails} failed` : `\nall passed`);
process.exit(fails ? 1 : 0);
