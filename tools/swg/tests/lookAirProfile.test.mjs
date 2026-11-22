// The viewer's air suite brought into the game (the GPU port's pass 2, wave 4a): `src/sky/look/airProfile.js`, the body path both
// the viewer and the game import, held as the viewer's atmosphere wave A held it. Node tests for airProfile.js (the atmosphere
// brief's wave A, item 1), as the game's airTwin.test.ts
// holds its twin: the tables and the march against direct sums at set angles, the limb's thickness by the scale
// height, the night side's nothing, the dials' ranges, and Hillaire's Earth as the start.
//   node tools/swg/tests/lookAirProfile.test.mjs [path to airProfile.js]
import { pathToFileURL } from 'node:url';
const LOOK = new URL('../../../src/sky/look/', import.meta.url);
const A = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : new URL('airProfile.js', LOOK).href);
const { F } = A;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
const worst3 = (a, b, i = 0, j = 0) => Math.max(rel(a[i], b[j]), rel(a[i + 1], b[j + 1]), rel(a[i + 2], b[j + 2]));

// ---- the start is Hillaire's Earth, number for number (but the haze, which is the game's clear day of 40 km)
const rec = A.recordOf({ mode: 'scattered' });
const fresh = A.newRecord();
// (wave B) the game's 25 numbers, then the haze's colour (three more)
ok(rec.length === A.AIR_FIELD_COUNT && A.AIR_FIELD_COUNT === 28 && A.GAME_FIELD_COUNT === 25, 'a record holds the game\'s 25 numbers and the haze\'s colour (28)');
ok(rec[F.bottom] === 6360 && rec[F.top] === 6460 && rec[F.rayH] === 8 && rec[F.mieH] === 1.2 && rec[F.mieG] === 0.8 && rec[F.ozC] === 25 && rec[F.ozW] === 15, 'the start\'s planet, heights, phase and ozone layer are Hillaire\'s');
ok(worst3(rec, fresh, F.rayR, F.rayR) < 0.01, `its Rayleigh is Hillaire's within 1% (the sky colour's hex rounds it: ${[F.rayR, F.rayG, F.rayB].map((i) => (rel(rec[i], fresh[i]) * 100).toFixed(2) + '%').join(', ')})`);
ok(worst3(rec, fresh, F.ozR, F.ozR) < 1e-12, 'its ozone is Hillaire\'s');
const vis = A.KOSCHMIEDER / (rec[F.rayG] + rec[F.mieS] + rec[F.mieA]);
ok(Math.abs(vis - 40) < 1e-9 && Math.abs(rec[F.mieS] / (rec[F.mieS] + rec[F.mieA]) - 0.9) < 1e-12, `its haze is the game's clear day: visibility ${vis.toFixed(6)} km, single-scattering albedo 0.9 (setVisibility's split)`);
ok(A.F.mieAlbedo === 24 && A.F.visShare === 23 && A.F.sunRadius === 22, 'the fields sit where airParams.ts puts them');

// ---- the transmittance table against the direct sum at set angles
const tabs = A.makeTables(rec);
console.log(`     (the three tables took ${tabs.ms.toFixed(0)} ms)`);
const t = [0, 0, 0], d = [0, 0, 0];
let worstT = 0, worstTat = '';
for (const h of [0, 1, 5, 20, 60]) for (const mu of [1, 0.5, 0.2, 0.1, 0.05]) {
  const r = rec[F.bottom] + h;
  A.transmittanceAt(rec, tabs, r, mu, t);
  A.transmittanceDirect(rec, r, mu, 400, d);
  const w = Math.max(...[0, 1, 2].map((k) => Math.abs(t[k] - d[k]) / Math.max(d[k], 0.02)));
  if (w > worstT) { worstT = w; worstTat = `h ${h} km, mu ${mu}`; }
}
ok(worstT < 0.03, `the transmittance table reads the direct sum within 3% (of the value, or of 0.02 where it is darker) at 25 set angles and heights (worst ${(worstT * 100).toFixed(2)}% at ${worstTat})`);
A.transmittanceAt(rec, tabs, rec[F.bottom], -0.05, t);
ok(t[0] === 0 && t[1] === 0 && t[2] === 0, 'no sun reaches the ground below its horizon');

// ---- the march (the shader's own method) against a direct sum, at 16 steps, at set angles
const out = new Float64Array(6), ref = new Float64Array(6);
const R = rec[F.bottom];
const cases = [
  ['the disc\'s middle, the sun behind the eye', [0, 0, 1e5], [0, 0, -1], [0, 0, 1]],
  ['the disc half way out, the sun from the side', [0.5 * R, 0, 1e5], [0, 0, -1], [1, 0, 0]],
  ['the disc at 0.9, the sun behind', [0.9 * R, 0, 1e5], [0, 0, -1], [0.3, 0, 0.954]],
  ['the limb at 3 km, the sun from the side', [R + 3, 0, 1e5], [0, 0, -1], [1, 0, 0]],
  ['the limb at 15 km, the sun behind', [R + 15, 0, 1e5], [0, 0, -1], [0.2, 0, 0.98]],
  ['the limb at 8 km, against the sun (forward)', [R + 8, 0, 1e5], [0, 0, -1], [0.1, 0, -0.995]],
  ['from the ground, straight up, the sun at 30 degrees', [0, R + 0.01, 0], [0, 1, 0], [0.866, 0.5, 0]],
  ['from the ground, toward the horizon, the sun low', [0, R + 0.01, 0], [0.995, 0.0998, 0], [0.98, 0.2, 0]],
];
for (const [name, o, dd, l] of cases) {
  const ln = Math.hypot(...l), dn = Math.hypot(...dd);
  A.marchAir(rec, tabs, o[0], o[1], o[2], dd[0] / dn, dd[1] / dn, dd[2] / dn, l[0] / ln, l[1] / ln, l[2] / ln, 16, NaN, null, out);
  A.marchDirect(rec, tabs, o[0], o[1], o[2], dd[0] / dn, dd[1] / dn, dd[2] / dn, l[0] / ln, l[1] / ln, l[2] / ln, 6000, NaN, ref);
  const wl = worst3(out, ref), wt = Math.max(...[3, 4, 5].map((k) => Math.abs(out[k] - ref[k])));
  ok(wl < 0.06 && wt < 0.01, `${name}: in-scatter within 6% of the direct sum (${(wl * 100).toFixed(2)}%), transmittance within 0.01 (${wt.toFixed(4)})`);
}
// and at 8 steps, the cheapest quality, within twice that
let w8 = 0;
for (const [, o, dd, l] of cases) {
  const ln = Math.hypot(...l), dn = Math.hypot(...dd);
  A.marchAir(rec, tabs, o[0], o[1], o[2], dd[0] / dn, dd[1] / dn, dd[2] / dn, l[0] / ln, l[1] / ln, l[2] / ln, 8, NaN, null, out);
  A.marchDirect(rec, tabs, o[0], o[1], o[2], dd[0] / dn, dd[1] / dn, dd[2] / dn, l[0] / ln, l[1] / ln, l[2] / ln, 6000, NaN, ref);
  w8 = Math.max(w8, worst3(out, ref));
}
ok(w8 < 0.15, `at 8 steps (Low) every case is within 15% (worst ${(w8 * 100).toFixed(2)}%: the cheap quality's price, the forward-scattering limb)`);
// a march that ends at a point short of the ground (a cloud deck's) is the direct sum to that point
{
  const o = [0.3 * R, 0, 1e5], dd = [0, 0, -1], l = [0, 0, 1];
  const b = 0.3 * R, sCloud = -Math.sqrt((R + 12) ** 2 - b * b);
  A.marchAir(rec, tabs, ...o, ...dd, ...l, 16, sCloud, null, out);
  A.marchDirect(rec, tabs, ...o, ...dd, ...l, 6000, sCloud, ref);
  ok(worst3(out, ref) < 0.06, `a march ending on a cloud deck 12 km up reads the direct sum to it within 6% (${(worst3(out, ref) * 100).toFixed(2)}%)`);
}

// ---- the limb's thickness follows the scale height
const limbScale = (H) => {
  const r2 = A.recordOf({ mode: 'scattered', rayleighHeightKm: H, visibilityKm: 1000, ozone: 0, thicknessKm: 12 * H });
  const tb = A.makeTables(r2, { ...A.TABLES, multiScatter: { ...A.TABLES.multiScatter, dirs: 16, steps: 12 } });
  // the limb's glow by tangent height, well above the layer the air is opaque in: its e-folding height
  const at = (h, ch) => { A.marchAir(r2, tb, r2[F.bottom] + h, 0, 1e5, 0, 0, -1, 1, 0, 0, 16, NaN, null, out); return out[ch]; };
  const h1 = 3 * H, h2 = 5 * H;
  // (blue, where the limb is bright; and red high up, where the air is optically thin and the glow is its density's)
  return [(h2 - h1) / Math.log(at(h1, 2) / at(h2, 2)), (2 * H) / Math.log(at(5 * H, 0) / at(7 * H, 0))];
};
const [e4, t4] = limbScale(4), [e8, t8] = limbScale(8), [e16, t16] = limbScale(16);
ok(Math.abs(e8 / e4 - 2) < 0.2 && Math.abs(e16 / e8 - 2) < 0.2, `the limb's glow thins by the scale height: its e-folding height ${e4.toFixed(2)}, ${e8.toFixed(2)}, ${e16.toFixed(2)} km for heights of 4, 8 and 16 km (ratios ${(e8 / e4).toFixed(3)}, ${(e16 / e8).toFixed(3)})`);
ok([t4 / 4, t8 / 8, t16 / 16].every((x) => Math.abs(x - 1) < 0.05), `and where the limb is optically thin (red, 5 to 7 scale heights up) its e-folding height is the scale height itself within 5% (${[t4 / 4, t8 / 8, t16 / 16].map((x) => x.toFixed(3)).join(', ')})`);

// ---- the night side: nothing
A.marchAir(rec, tabs, 0, 0, 1e5, 0, 0, -1, 0, 0, -1, 16, NaN, null, out);
ok(out[0] === 0 && out[1] === 0 && out[2] === 0, `the night side's middle (the sun behind the body) adds no light at all (${out[2]})`);
A.marchAir(rec, tabs, 0.6 * R, 0, 1e5, 0, 0, -1, -0.8, 0, -0.6, 16, NaN, null, out);
ok(out[2] < 1e-7, `a ray onto the night side away from the terminator adds none (${out[2].toExponential(2)})`);
const lg = new Float64Array(6);
A.lightAt(rec, tabs, R, -0.4, lg);
const noon = new Float64Array(6); A.lightAt(rec, tabs, R, 1, noon);
ok(lg[0] === 0 && lg[1] === 0 && lg[2] === 0 && [3, 4, 5].every((k) => lg[k] <= 1e-6 * noon[k]), `a point of the ground 24 degrees past the terminator gets no sun, and under a millionth of the noon sky's light (${lg[5].toExponential(1)} against ${noon[5].toFixed(3)})`);
A.lightAt(rec, tabs, R, -0.04, lg);
ok(lg[0] === 0 && lg[5] > 0 && lg[5] > lg[3], `just past the terminator the sun is gone but the twilight sky still lights it, bluer than red (${lg[3].toExponential(2)}, ${lg[5].toExponential(2)})`);
A.lightAt(rec, tabs, R, 0.06, lg);
ok(lg[0] > lg[1] && lg[1] > lg[2] && lg[2] > 0, `near the terminator the sun reaches it reddened (${[lg[0], lg[1], lg[2]].map((v) => v.toFixed(3)).join(', ')})`);

// ---- the dials' ranges
let okRange = true, why = '';
for (const dl of A.AIR_DIALS) {
  if (dl.type !== 'range') continue;
  if (!(dl.min < dl.max) || !(dl.def >= dl.min && dl.def <= dl.max) || dl.reset !== dl.def) { okRange = false; why = dl.k; }
  for (const v of [dl.min, dl.max, dl.min - 1e6, dl.max + 1e6]) {
    const c = A.cleanAir({ mode: 'scattered', [dl.k]: v });
    if (!(c[dl.k] >= dl.min && c[dl.k] <= dl.max)) { okRange = false; why = `${dl.k} ${v}`; }
    const r = A.recordOf(c);
    if (!Array.from(r).every((x) => Number.isFinite(x) && x >= 0)) { okRange = false; why = `${dl.k} ${v} record`; }
  }
}
ok(okRange, `every dial starts inside its range, resets to its start, holds what is out of range to it, and makes a finite record at both ends${why ? ' (' + why + ')' : ''}`);
const cz = A.cleanAir({ mode: 'bogus', skyColour: 'red', radiusKm: 'x' });
ok(cz.mode === 'painted' && cz.skyColour === '#74abff' && cz.radiusKm === 6360, 'an unknown form is Painted, a broken colour or number its start');
ok(A.airless(A.recordOf(A.airStartFor('moon'))) && !A.airless(rec), 'a moon\'s start has no air; the Earth\'s has');
const gg = A.recordOf(A.airStartFor('gasgiant', { limbDark: 0.45 }));
ok(gg[F.bottom] === 60000 && gg[F.ozR] === 0 && A.cleanAir(A.airStartFor('gasgiant', { limbDark: 0.45 })).limbDark === 0.45, 'a gas giant starts 60,000 km across, ozone-free, with its own limb darkening');
ok(A.stepsOf('low') === 8 && A.stepsOf('medium') === 12 && A.stepsOf('high') === 16 && A.stepsOf('x') === 12, 'the qualities are 8, 12 and 16 steps (Medium when unknown)');

console.log(`${n - fails} of ${n} checks pass`);
process.exit(fails ? 1 : 0);
