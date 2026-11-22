// The viewer's haze suite brought into the game (the GPU port's pass 2, wave 4a), over `src/sky/look/airProfile.js`.
// Node tests for the haze's colour (the atmosphere brief's wave B, item 1): airProfile.js's per-channel haze albedo
// (F.mieTintR..B, the hazeColour dial). Against a direct sum written here from the physics alone (no function of the
// module's but recordOf and the record's numbers): the single-scattered light of a pure haze along set rays, and its
// colour; that a grey haze is the record as it was (the game's 25 numbers give the very same tables and march); that
// the haze's extinction stays grey (the sun through it is dimmed, never tinted, by its colour); the march against the
// module's own direct sum for a warm dust and a dark ash, with the multiple scattering; the dial's cleaning.
//   node tools/swg/tests/lookHaze.test.mjs [path to airProfile.js]
import { pathToFileURL } from 'node:url';
const LOOK = new URL('../../../src/sky/look/', import.meta.url);
const A = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : new URL('airProfile.js', LOOK).href);
const { F } = A;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
const worst3 = (a, b) => Math.max(rel(a[0], b[0]), rel(a[1], b[1]), rel(a[2], b[2]));

// ---- a grey haze is the record as it was
const grey = A.recordOf({ mode: 'scattered' });
ok(grey[F.mieTintR] === 1 && grey[F.mieTintG] === 1 && grey[F.mieTintB] === 1, 'a haze of no colour (#ffffff, the start) is grey: its three shares are 1');
const g25 = Float64Array.from(grey).subarray(0, A.GAME_FIELD_COUNT).slice();
const t28 = A.makeTables(grey), t25 = A.makeTables(g25);
const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
ok(same(t28.T, t25.T) && same(t28.MS, t25.MS) && same(t28.E, t25.E), 'the game\'s record of 25 numbers (no colour) makes the very same three tables as the grey 28');
{
  const o1 = new Float64Array(6), o2 = new Float64Array(6);
  let worst = 0;
  for (const [ox, oy, oz, dx, dy, dz, lx, ly, lz] of [[0, 0, 1e5, 0, 0, -1, 0, 0, 1], [6365, 0, 1e5, 0, 0, -1, 1, 0, 0], [0, 6360.01, 0, 0.6, 0.8, 0, 0.98, 0.2, 0]]) {
    A.marchAir(grey, t28, ox, oy, oz, dx, dy, dz, lx, ly, lz, 12, NaN, null, o1);
    A.marchAir(g25, t25, ox, oy, oz, dx, dy, dz, lx, ly, lz, 12, NaN, null, o2);
    for (let k = 0; k < 6; k++) worst = Math.max(worst, Math.abs(o1[k] - o2[k]));
  }
  ok(worst === 0, `and the march on either is the same to the last bit at three set rays (largest difference ${worst})`);
}

// ---- the colour's shares
const t = A.hazeTintFromHex('#ffb080');
ok(Math.max(...t) === 1 && t[0] === 1 && t[1] < 1 && t[2] < t[1], `a warm colour gives shares under 1 for the colours it absorbs, 1 for its brightest (${t.map((v) => v.toFixed(3)).join(', ')})`);
ok(A.hazeTintFromHex('#000000').every((v) => v === 1) && A.hazeTintFromHex('#808080').every((v) => Math.abs(v - 1) < 1e-12), 'black or any grey is a grey haze (the shares are the colour\'s hue, its darkness is the haze brightness dial\'s)');
const cz = A.cleanAir({ mode: 'scattered', hazeColour: 'brown' });
ok(cz.hazeColour === '#ffffff' && A.cleanAir({ mode: 'scattered', hazeColour: '#A08070' }).hazeColour === '#a08070', 'a broken colour cleans to white, a good one to its lower-case self');
ok(A.airDial('hazeColour')?.type === 'color' && A.airDial('hazeColour').def === '#ffffff' && A.airDial('hazeColour').group === 'air', 'the dial is a colour of the air\'s group, starting white');

// ---- the extinction stays grey: the sun through a coloured haze is dimmed as through a grey one
const dust = A.recordOf({ mode: 'scattered', visibilityKm: 8, hazeAlbedo: 0.8, hazeColour: '#ffb080', hazeHeightKm: 2 });
const dustGrey = A.recordOf({ mode: 'scattered', visibilityKm: 8, hazeAlbedo: 0.8, hazeHeightKm: 2 });
const ext = (r) => [0, 1, 2].map((k) => r[F.mieS] + r[F.mieA]);
ok(same(A.makeTables(dust).T, A.makeTables(dustGrey).T), 'the transmittance table of a warm dust is the grey dust\'s, bit for bit: its colour takes nothing more from the sun');
{
  const k = A.hazeTintOf(dust, [0, 0, 0]);
  const s = [0, 1, 2].map((c) => dust[F.mieS] * k[c]), a = [0, 1, 2].map((c) => dust[F.mieA] + dust[F.mieS] * (1 - k[c]));
  const e = ext(dust);
  ok([0, 1, 2].every((c) => Math.abs(s[c] + a[c] - e[c]) < 1e-15) && [0, 1, 2].every((c) => Math.abs(s[c] / e[c] - 0.8 * k[c]) < 1e-12), `per channel, scattering plus absorption is the grey extinction (${e[0].toFixed(4)} per km) and the single-scattering albedo is 0.8 times the share (${[0, 1, 2].map((c) => (s[c] / e[c]).toFixed(3)).join(', ')})`);
}

// ---- the single-scattered light of a pure haze against a direct sum written from the physics
// A record with no clear air and no ozone, only a haze; its multiple scattering taken out (the table zeroed), so the
// march is single scattering alone. The sum: along the ray, dI = T_view * sigma_s,c(h) * p_Mie(cos) * T_sun * dl, with
// T = exp(-optical depth) found by its own fine sums (the sun's toward the sun from each point, the view's back to
// the eye), the planet's shadow a hard edge (the points used are all lit or far from it).
function directSingle(rec, o, d, l, N = 4000) {
  const bottom = rec[F.bottom], top = rec[F.top];
  const H = rec[F.mieH], sig0 = rec[F.mieS] + rec[F.mieA], g = rec[F.mieG];
  const k = [rec[F.mieTintR], rec[F.mieTintG], rec[F.mieTintB]];
  const dens = (p) => Math.exp(-Math.max(0, Math.hypot(p[0], p[1], p[2]) - bottom) / H);
  const hit = (p, v, R) => { const b = p[0] * v[0] + p[1] * v[1] + p[2] * v[2], c = p[0] ** 2 + p[1] ** 2 + p[2] ** 2 - R * R, q = b * b - c; return q < 0 ? null : [-b - Math.sqrt(q), -b + Math.sqrt(q)]; };
  const depth = (p, v, len, M = 600) => { let s = 0; for (let i = 0; i < M; i++) { const u = (i + 0.5) / M, t = len * u * u, dt = len * ((i + 1) ** 2 - i ** 2) / (M * M); s += dens([p[0] + v[0] * t, p[1] + v[1] * t, p[2] + v[2] * t]) * dt; } return s * sig0; };
  const ht = hit(o, d, top); if (!ht) return [0, 0, 0];
  const t0 = Math.max(0, ht[0]);
  const hg = hit(o, d, bottom);
  const t1 = hg && hg[0] > t0 ? hg[0] : ht[1];
  const cos = d[0] * l[0] + d[1] * l[1] + d[2] * l[2];
  const pM = (3 / (8 * Math.PI)) * (1 - g * g) * (1 + cos * cos) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * cos, 1.5));
  const L = [0, 0, 0];
  let tauV = 0, prevT = t0;
  for (let i = 0; i < N; i++) {
    // steps laid densest near the ray's lowest point
    const u = (i + 0.5) / N, tm = t0 + (t1 - t0) * u, dl = (t1 - t0) / N;
    const p = [o[0] + d[0] * tm, o[1] + d[1] * tm, o[2] + d[2] * tm];
    const rho = dens(p);
    tauV += sig0 * rho * (tm - prevT) * (i === 0 ? 1 : 1); prevT = tm;
    const hs = hit(p, l, bottom);
    if (hs && hs[0] > 0) continue; // in the planet's shadow
    const hT = hit(p, l, top);
    const tauS = depth(p, l, Math.max(0, hT[1]));
    const w = Math.exp(-tauV) * Math.exp(-tauS) * rho * pM * dl;
    for (let c = 0; c < 3; c++) L[c] += w * rec[F.mieS] * k[c];
  }
  return L;
}
const pure = (colour) => A.recordOf({ mode: 'scattered', skyStrength: 0, ozone: 0, visibilityKm: 15, hazeAlbedo: 0.8, hazeColour: colour, hazeHeightKm: 2, hazeG: 0.7 });
const single = (rec) => { const tb = A.makeTables(rec); tb.MS = new Float32Array(tb.MS.length); return tb; };
const R0 = 6360;
const rays = [
  ['the disc\'s middle, the sun behind the eye', [0, 0, 1e5], [0, 0, -1], [0, 0.2, 0.98]],
  ['the disc half way out, the sun from the side', [0.5 * R0, 0, 1e5], [0, 0, -1], [0.8, 0, 0.6]],
  ['the limb at 2 km, the sun from the side', [R0 + 2, 0, 1e5], [0, 0, -1], [1, 0, 0]],
  ['the limb at 5 km, against the sun (forward)', [R0 + 5, 0, 1e5], [0, 0, -1], [0.3, 0, -0.954]],
];
for (const colour of ['#ffffff', '#ffb080', '#8a7060']) {
  const rec = pure(colour), tb = single(rec), out = new Float64Array(6);
  let wl = 0, wr = 0, at = '';
  for (const [name, o, d, l] of rays) {
    const ln = Math.hypot(...l);
    const lu = l.map((x) => x / ln);
    A.marchAir(rec, tb, o[0], o[1], o[2], d[0], d[1], d[2], lu[0], lu[1], lu[2], 16, NaN, null, out);
    const ref = directSingle(rec, o, d, lu);
    const w = worst3(out, ref);
    if (w > wl) { wl = w; at = name; }
    // its colour: the channels' ratios are the haze's own shares (a pure haze with grey extinction)
    const k = A.hazeTintOf(rec, [0, 0, 0]);
    wr = Math.max(wr, rel(out[0] / out[1], k[0] / k[1]), rel(out[2] / out[1], k[2] / k[1]));
  }
  ok(wl < 0.05, `a pure haze of ${colour}: the march of 16 steps (single scattering) reads the direct sum within 5% at four set rays (worst ${(wl * 100).toFixed(2)}%, ${at})`);
  ok(wr < 1e-9, `  and its light is the haze's own colour: red to green and blue to green are the shares' ratios (worst ${wr.toExponential(1)})`);
}

// ---- with everything (clear air, ozone, the multiple scattering): the march against the module's own direct sum
const cases = [
  ['the disc\'s middle, the sun behind the eye', [0, 0, 1e5], [0, 0, -1], [0, 0, 1]],
  ['the disc at 0.9, the sun behind', [0.9 * R0, 0, 1e5], [0, 0, -1], [0.3, 0, 0.954]],
  ['the limb at 3 km, the sun from the side', [R0 + 3, 0, 1e5], [0, 0, -1], [1, 0, 0]],
  ['from the ground toward the horizon, the sun low', [0, R0 + 0.01, 0], [0.995, 0.0998, 0], [0.98, 0.2, 0]],
];
// (the body's own rays: from space onto the disc and past the limb; the last case, from the ground along the horizon
// through a dense haze, is the game's sky's, where 16 steps fall short in a haze of 10 km whatever its colour: it is
// held only to the grey haze's own miss, below)
for (const [label, air] of [
  ['a warm desert dust (#fff3db, 0.85, 25 km)', A.airStartFor('desert')],
  ['a dark ash (#8a7060, 0.4, 10 km)', { mode: 'scattered', visibilityKm: 10, hazeAlbedo: 0.4, hazeColour: '#8a7060', hazeHeightKm: 2 }],
]) {
  const rec = A.recordOf(air), tb = A.makeTables(rec), out = new Float64Array(6), ref = new Float64Array(6);
  const recG = A.recordOf({ ...air, hazeColour: '#ffffff' }), tbG = A.makeTables(recG), outG = new Float64Array(6), refG = new Float64Array(6);
  let wl = 0, wt = 0, extra = 0, ground = 0;
  for (const [name, o, d, l] of cases) {
    const ln = Math.hypot(...l), lu = l.map((x) => x / ln);
    A.marchAir(rec, tb, o[0], o[1], o[2], d[0], d[1], d[2], lu[0], lu[1], lu[2], 16, NaN, null, out);
    A.marchDirect(rec, tb, o[0], o[1], o[2], d[0], d[1], d[2], lu[0], lu[1], lu[2], 6000, NaN, ref);
    A.marchAir(recG, tbG, o[0], o[1], o[2], d[0], d[1], d[2], lu[0], lu[1], lu[2], 16, NaN, null, outG);
    A.marchDirect(recG, tbG, o[0], o[1], o[2], d[0], d[1], d[2], lu[0], lu[1], lu[2], 6000, NaN, refG);
    for (let k = 0; k < 3; k++) extra = Math.max(extra, Math.abs(rel(out[k], ref[k]) - rel(outG[k], refG[k])));
    if (/ground/.test(name)) { ground = worst3(out, ref); continue; }
    wl = Math.max(wl, worst3(out, ref)); wt = Math.max(wt, ...[3, 4, 5].map((k) => Math.abs(out[k] - ref[k])));
  }
  ok(wl < 0.08 && wt < 0.012, `${label}: on the body's rays the march with its multiple scattering reads the direct sum within 8% (${(wl * 100).toFixed(2)}%), its transmittance within 0.012 (${wt.toFixed(4)})`);
  ok(extra < 0.005, `  and its colour adds no error of its own: at every ray its miss is the grey haze's within half a percent (${(extra * 100).toFixed(2)} points; from the ground along the horizon both miss by ${(ground * 100).toFixed(1)}%)`);
}

// ---- what the colour does on a disc: a warm dust warms the haze's light, a dark ash darkens it, the sun through
// either is the grey haze's
{
  const look = (colour, albedo) => A.recordOf({ mode: 'scattered', skyStrength: 0.4, visibilityKm: 10, hazeAlbedo: albedo, hazeColour: colour, hazeHeightKm: 2 });
  const at = (rec) => { const tb = A.makeTables(rec), o = new Float64Array(6); A.marchAir(rec, tb, 0.4 * R0, 0, 1e5, 0, 0, -1, 0.3, 0.2, 0.93, 12, NaN, null, o); return o; };
  const w = at(look('#ffffff', 0.85)), d = at(look('#ffc890', 0.85)), ash = at(look('#9a8878', 0.35));
  ok(d[0] / d[2] > 1.3 * (w[0] / w[2]) && Math.abs(d[3] - w[3]) < 1e-12 && Math.abs(d[5] - w[5]) < 1e-12, `a warm dust's haze over the disc is redder than a grey one's (red to blue ${(d[0] / d[2]).toFixed(2)} against ${(w[0] / w[2]).toFixed(2)}) while the light through it is the same (${d[4].toFixed(4)})`);
  ok(ash[1] < 0.6 * w[1] && Math.abs(ash[4] - w[4]) < 1e-12, `a dark ash adds under 0.6 of the grey haze's light (${(ash[1] / w[1]).toFixed(2)}) and dims what lies behind it as much`);
}
// the starts: a desert's dust is warm, a volcanic world's ash grey-brown, a living world's haze grey
{
  const k = (r) => A.hazeTintOf(A.recordOf(A.airStartFor(r)), [0, 0, 0]);
  const ds = k('desert'), vo = k('volcanic'), li = k('living');
  ok(ds[0] === 1 && ds[2] < ds[1] && ds[1] < 1 && vo[2] < vo[1] && vo[1] < 1 && li.every((v) => v === 1), `the starts: desert dust (${ds.map((v) => v.toFixed(2)).join(', ')}), volcanic ash (${vo.map((v) => v.toFixed(2)).join(', ')}), a living world grey`);
}
const u = A.airUniformValues(A.recordOf({ mode: 'scattered', hazeColour: '#ffb080' }), A.cleanAir({ mode: 'scattered' }));
ok(Array.isArray(u.mieTint) && u.mieTint.length === 3 && u.mieTint[0] === 1 && u.mieTint[2] < 1, 'the shader\'s uniforms carry the colour (mieTint)');
console.log(`${n - fails} of ${n} checks pass`);
process.exit(fails ? 1 : 0);
