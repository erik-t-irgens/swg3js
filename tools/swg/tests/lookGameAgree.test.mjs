// The viewer's agreement suite brought into the game (the GPU port's pass 2, wave 4a): the body path's air
// (`src/sky/look/airProfile.js`) against the ground path's. The viewer's air (airProfile.js) against the game's own (src/sky/air/airParams.ts and airTwin.ts, read only, run as
// they stand with their types stripped): the same record's numbers, and on that one record the two methods' sun
// transmittance, multiple-scattering share and sky radiance seen from the ground, at set angles.
//   node tools/swg/tests/lookGameAgree.test.mjs
import { pathToFileURL } from 'node:url';
const LOOK = new URL('../../../src/sky/look/', import.meta.url);
const V = await import(new URL('airProfile.js', LOOK).href);
const GP = await import(new URL('../air/airParams.ts', LOOK).href);
const GT = await import(new URL('../air/airTwin.ts', LOOK).href);
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

// ---- the record: the same layout and the same numbers
// (wave B) the viewer's record is the game's 25 numbers, then the haze's colour appended; (the GPU port's pass 2, wave 4a)
// the game's record appended the same three, so the two are one record of 28
// (the GPU port's pass 2, wave 6 appended the smoke and ash's twelve after the haze's colour, in both: 40 in all)
ok(Object.entries(GP.F).every(([k, i]) => V.F[k] === i) && GP.AIR_FIELD_COUNT === V.AIR_FIELD_COUNT && V.GAME_FIELD_COUNT + 3 === V.HAZE_FIELD_COUNT && V.HAZE_FIELD_COUNT + 12 === GP.AIR_FIELD_COUNT && V.F.mieTintR === V.GAME_FIELD_COUNT && GP.F.mieTintR === V.F.mieTintR && GP.F.smokeER === V.HAZE_FIELD_COUNT, `the record's ${GP.AIR_FIELD_COUNT} fields sit where the game's do (${Object.keys(GP.F).length} named), the haze's colour appended after the first 25 and the smoke and ash after the 28 in both`);
ok(JSON.stringify(GP.EARTH) === JSON.stringify({ ...V.EARTH, rayleigh: GP.EARTH.rayleigh, ozone: GP.EARTH.ozone }) && GP.EARTH.rayleigh.every((v, i) => v === V.EARTH.rayleigh[i]) && GP.EARTH.ozone.every((v, i) => v === V.EARTH.ozone[i]), 'Hillaire\'s Earth is the game\'s, number for number');
const g = GP.newAirRecord();
GP.setVisibility(g, 40);
g[GP.F.groundR] = g[GP.F.groundG] = g[GP.F.groundB] = 0.2;
const v = V.recordOf({ mode: 'scattered' });
// (wave B: the game's numbers against the viewer's; both grey hazes are 1, 1, 1)
const worst = Math.max(...Array.from(g).map((x, i) => rel(v[i], x)));
ok(v[V.F.mieTintR] === 1 && v[V.F.mieTintG] === 1 && v[V.F.mieTintB] === 1 && g[GP.F.mieTintR] === 1 && g[GP.F.mieTintG] === 1 && g[GP.F.mieTintB] === 1, 'a look\'s start has a grey haze (its colour 1, 1, 1), as the game\'s fresh record has');
ok(worst < 0.005, `a look's start is the game's record at its clear day of 40 km (the worst field within ${(worst * 100).toFixed(2)}%: the sky colour's hex)`);

// ---- on the game's own record: the game's twin tables and the viewer's
const depth = new Float64Array(GT.DEPTH_FLOATS); GT.buildDepthTable(g, depth);
const psi = new Float64Array(GT.PSI_FLOATS); GT.buildPsiTable(g, depth, psi);
const tabs = V.makeTables(g);
const a = [0, 0, 0], b = new Float64Array(3);
let wT = 0, wTat = '';
for (const h of [0, 2, 10, 40]) for (const mu of [1, 0.5, 0.2, 0.1, 0.05]) {
  const r = g[GP.F.bottom] + h;
  V.transmittanceAt(g, tabs, r, mu, a);
  GT.lightTransmittance(g, depth, r, mu, b, 0);
  const w = Math.max(...[0, 1, 2].map((k) => Math.abs(a[k] - b[k]) / Math.max(b[k], 0.02)));
  if (w > wT) { wT = w; wTat = `h ${h}, mu ${mu}`; }
}
ok(wT < 0.03, `the sun's transmittance reads the game's within 3% at 20 set heights and angles (worst ${(wT * 100).toFixed(2)}% at ${wTat})`);
let wM = 0, wMat = '', wTw = 0;
for (const h of [0.5, 10, 50]) for (const mu of [1, 0.5, 0.1, 0, -0.1]) {
  const r = g[GP.F.bottom] + h;
  V.multiScatterAt(g, tabs, r, mu, a);
  GT.psiAt(g, psi, r, mu, b, 0);
  const w = Math.max(...[0, 1, 2].map((k) => Math.abs(a[k] - b[k]) / Math.max(b[k], 1e-4)));
  if (mu < 0) { if (w > wTw) wTw = w; continue; }
  if (w > wM) { wM = w; wMat = `h ${h}, mu ${mu}`; }
}
ok(wM < 0.15, `the multiple scattering's share reads the game's within 15% with the sun up (its own sizes and quadrature differ: 32 x 32 against the game's twin's 32 x 16) at 12 set points (worst ${(wM * 100).toFixed(1)}% at ${wMat})`);
ok(wTw < 0.25, `and within 25% with the sun just set (6 degrees down), where both tables are coarsest and the share turns fastest (the game's own note: 30% to twice at 16 across) (${(wTw * 100).toFixed(1)}%)`);
// the sky seen from the ground: the viewer's march against the game's own view radiance, the sun at 30 and 5 degrees
const lights = new GT.AirLights();
const out = new Float64Array(6), gv = new Float64Array(3);
let wS = 0, wSat = '';
for (const sunEl of [30, 5]) {
  const se = (sunEl * Math.PI) / 180;
  lights.count = 1; lights.live[0] = 1;
  lights.dir[0] = Math.cos(se); lights.dir[1] = Math.sin(se); lights.dir[2] = 0;
  lights.top[0] = lights.top[1] = lights.top[2] = 1;
  for (const [el, az] of [[90, 0], [45, 0], [20, 180], [10, 90], [3, 0]]) {
    const e = (el * Math.PI) / 180, z = (az * Math.PI) / 180;
    const dx = Math.cos(e) * Math.cos(z), dy = Math.sin(e), dz = Math.cos(e) * Math.sin(z);
    const r = g[GP.F.bottom] + 0.01;
    GT.viewRadiance(g, depth, psi, r, dx, dy, dz, lights, 200, 1e9, gv, 0, null);
    V.marchAir(g, tabs, 0, r, 0, dx, dy, dz, lights.dir[0], lights.dir[1], 0, 16, NaN, null, out);
    const w = Math.max(...[0, 1, 2].map((k) => rel(out[k], gv[k])));
    if (w > wS) { wS = w; wSat = `sun ${sunEl} degrees, view ${el} up, ${az} round`; }
  }
}
ok(wS < 0.1, `the sky from the ground: the viewer's march of 16 steps reads the game's 200-step view radiance within 10% at 10 set views (worst ${(wS * 100).toFixed(1)}% at ${wSat})`);
console.log(`${n - fails} of ${n} checks pass`);
process.exit(fails ? 1 : 0);
