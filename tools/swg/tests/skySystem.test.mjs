// The skies II clockwork in the game's own tree (the GPU port's pass 2, wave 4a; the design's 2.11): `src/sky/system/`'s
// system.js, drafts.js, drafts1.js and places.js, moved byte for byte from the space body viewer, held by the viewer's
// own checks of skies in motion II run on the moved modules. The game does not yet follow the clockwork (wave 5 applies
// it); this holds the modules as they came in: pure, every rule of the brief, the first round's drafts drawing exactly as
// recorded from the viewer's own code (a digest recorded from it on 22 November, the live viewer's copy agreeing), every
// draft of version 2 as recorded, and a sky asked a long run of times growing no heap.
//   node tools/swg/tests/skySystem.test.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import v8 from 'node:v8';
import vm from 'node:vm';

const SYS = new URL('../../../src/sky/system/', import.meta.url);
const S = await import(new URL('system.js', SYS).href);
const Dr = await import(new URL('drafts.js', SYS).href);
const D1 = await import(new URL('drafts1.js', SYS).href);
const PL = await import(new URL('places.js', SYS).href);

let pass = 0, fail = 0;
const fails = [];
function ok(cond, what) {
  if (cond) pass++;
  else { fail++; fails.push(what); }
}
function section(name) { console.log(`\n== ${name}`); }
const DEG = Math.PI / 180;
const deg = (r) => r / DEG;
const altOf = (o, j) => deg(Math.asin(Math.max(-1, Math.min(1, o.dir[3 * j + 1]))));
const azOf = (o, j) => deg(Math.atan2(o.dir[3 * j], -o.dir[3 * j + 2]));
const angle = (o, a, b) => { const c = o.dir[3 * a] * o.dir[3 * b] + o.dir[3 * a + 1] * o.dir[3 * b + 1] + o.dir[3 * a + 2] * o.dir[3 * b + 2]; return deg(Math.acos(Math.max(-1, Math.min(1, c)))); };
const sizeOf = () => 10;
const model = (sys, world, extra = {}) => S.compileSystem(sys, sizeOf, () => false, { world, ...extra });
const itemOfBody = (M, id) => M.items.findIndex((it) => M.sys.bodies[it.body].id === id);
const T0 = S.realDays(Date.UTC(2026, 10, 21, 0));
const hash = (x) => createHash('sha256').update(x).digest('hex').slice(0, 16);
/** A plain test world: a star and a planet you stand on, at a latitude, tilt and time of year. */
function testWorld({ lat = 30, lon = 0, tilt = 20, season = 0, dayHours = 4, period = 365 } = {}) {
  return S.cleanSystem({
    version: 2, id: 'test', name: 'Test', grounds: [{ world: 'w', body: 'p', lat, lon, dayHours, season }],
    bodies: [{ id: 'sun', kind: 'star', name: 'Sun', size: 10 }, { id: 'p', kind: 'planet', name: 'P', parent: 'sun', period, radius: 1, axialTilt: tilt, spinHours: 24 }],
  });
}
/** The highest the casting sun gets in one of the world's days from T (sampled, then refined). */
function highest(M, O, T) {
  let best = -99, bt = T;
  for (let k = 0; k < 720; k++) { const t = T + (k / 720) * M.dayDays; S.skyAt(M, t, O); const a = altOf(O, M.casterJ); if (a > best) { best = a; bt = t; } }
  for (let s = M.dayDays / 720; s > 1e-9; s /= 4) for (const t of [bt - s, bt + s]) { S.skyAt(M, t, O); const a = altOf(O, M.casterJ); if (a > best) { best = a; bt = t; } }
  return best;
}
/** The sun's hour angle as the sky shows it (radians, 0 on the meridian, growing westward). */
function hourAngle(O, j) {
  const P = [O.poleSky[0], O.poleSky[1], O.poleSky[2]];
  const up = [0, 1, 0];
  const d = up[0] * P[0] + up[1] * P[1] + up[2] * P[2];
  let m = [up[0] - d * P[0], up[1] - d * P[1], up[2] - d * P[2]];
  const ml = Math.hypot(...m); m = m.map((x) => x / ml);
  const w = [P[1] * m[2] - P[2] * m[1], P[2] * m[0] - P[0] * m[2], P[0] * m[1] - P[1] * m[0]];
  const s = [O.dir[3 * j], O.dir[3 * j + 1], O.dir[3 * j + 2]];
  return Math.atan2(-(s[0] * w[0] + s[1] * w[1] + s[2] * w[2]), s[0] * m[0] + s[1] * m[1] + s[2] * m[2]);
}
const wrapPi = (a) => { let x = (a + Math.PI) % (2 * Math.PI); if (x < 0) x += 2 * Math.PI; return x - Math.PI; };

// -------------------------------------------------------------------------------------------
section('the modules are pure: no page, no three, imports only among themselves');
{
  for (const [f, want] of [['system.js', ['./places.js']], ['drafts.js', ['./system.js']], ['drafts1.js', ['./system.js', './system.js']], ['places.js', []]]) {
    const src = readFileSync(new URL(f, SYS), 'utf8');
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    ok(JSON.stringify(imports) === JSON.stringify(want), `${f} imports ${want.length ? want.join(', ') : 'nothing'} (${imports.join(', ') || 'nothing'})`);
    ok(!/\b(document|window|THREE|localStorage)\b/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), `${f} touches no page and no three`);
  }
}

// -------------------------------------------------------------------------------------------
section('dayHours: held between 2 and 6; default the lore day over six');
{
  ok(S.defaultDayHours(26) === 4.33 && S.defaultDayHours(23) === 3.83 && S.defaultDayHours(36) === 6 && S.defaultDayHours(46) === 6 && S.defaultDayHours(6) === 2 && S.defaultDayHours(18) === 3, 'defaultDayHours: 26 -> 4.33, 23 -> 3.83, 36 -> 6, 46 -> 6, 6 -> 2, 18 -> 3');
  const mk = (dayHours, spinHours = 24) => S.cleanSystem({ version: 2, grounds: [{ world: 'w', body: 'p', dayHours }], bodies: [{ id: 's', kind: 'star' }, { id: 'p', kind: 'planet', parent: 's', spinHours }] }).grounds[0].dayHours;
  ok(mk(1) === 2 && mk(9) === 6 && mk(3.5) === 3.5 && mk(null, 30) === 5 && mk(undefined, 100) === 6 && mk('x', 6) === 2, 'a ground\'s dayHours is held to 2..6, and a missing one is the default');
  for (const id of Dr.DRAFT_SYSTEMS) {
    const sys = Dr.draftSystem(id);
    for (const g of sys.grounds.filter((x) => !x.copy)) {
      const b = sys.bodies.find((x) => x.id === g.body);
      const dn = S.daylightHours(g.lat, b.axialTilt, g.season, g.dayHours);
      ok(g.dayHours >= 2 && g.dayHours <= 6, `${g.world}: dayHours ${g.dayHours} within 2..6`);
      ok(dn.day >= 1 - 1e-9 && dn.day <= 3 + 1e-9 && dn.night >= 1 - 1e-9 && dn.night <= 3 + 1e-9, `${g.world}: daylight ${dn.day.toFixed(2)} h and night ${dn.night.toFixed(2)} h each within 1..3`);
    }
  }
}

// -------------------------------------------------------------------------------------------
section('one steady spin: the hour and the sun\'s hour angle advance evenly, day after day');
{
  for (const [id, world] of [['naboo', 'naboo'], ['naboo', 'rori'], ['tatoo', 'tatooine'], ['yavin', 'yavin4'], ['corell', 'talus']]) {
    const M = model(Dr.draftSystem(id), world), O = S.makeSkyState(M);
    const j = M.casterJ;
    let worst = 0, worstHour = 0;
    S.skyAt(M, T0, O);
    const H0 = hourAngle(O, j);
    for (let k = 1; k <= 400; k++) {
      const t = T0 + (k / 100) * M.dayDays;
      S.skyAt(M, t, O);
      const expect = H0 + (2 * Math.PI * k) / 100;
      worst = Math.max(worst, Math.abs(wrapPi(hourAngle(O, j) - expect)));
      const h = S.localHour(M, t), h0 = S.localHour(M, T0);
      worstHour = Math.max(worstHour, Math.abs(wrapPi(((h - h0) / 24) * 2 * Math.PI - (2 * Math.PI * k) / 100)));
    }
    ok(deg(worst) < (M.locked ? 0.2 : 1e-6), `${world}: the sun's hour angle steady to ${deg(worst).toExponential(2)}°`);
    ok(worstHour < 1e-9, `${world}: the hour steady`);
  }
  for (const lat of [0, 25, 45, 60]) {
    const M = model(testWorld({ lat, tilt: 23, season: 0 }), 'w'), O = S.makeSkyState(M);
    let up = 0;
    const N = 4000;
    for (let k = 0; k < N; k++) { S.skyAt(M, T0 + (k / N) * M.dayDays, O); if (O.dir[3 * M.casterJ + 1] > 0) up++; }
    ok(Math.abs(up / N - 0.5) < 0.004, `equinox at ${lat}°: daylight is half the day (${(up / N).toFixed(4)})`);
  }
}

// -------------------------------------------------------------------------------------------
section('the sun\'s noon height from the latitude, the tilt and the time of year');
{
  let worst = 0, n = 0;
  for (const lat of [-60, -20, 0, 12, 35, 55, 80]) for (const tilt of [0, 8, 23, 40]) for (const season of [-90, -45, 0, 30, 90, 135]) {
    const M = model(testWorld({ lat, tilt, season }), 'w'), O = S.makeSkyState(M);
    const got = highest(M, O, T0), want = Math.min(90, S.noonHeight(lat, tilt, season));
    worst = Math.max(worst, Math.abs(got - want));
    n++;
  }
  ok(worst < 0.02, `noon height = 90 - |lat - declination| over ${n} worlds (worst ${worst.toFixed(4)}°)`);
  for (const id of Dr.DRAFT_SYSTEMS) for (const g of Dr.draftSystem(id).grounds.filter((x) => !x.copy)) {
    const M = model(Dr.draftSystem(id), g.world), O = S.makeSkyState(M);
    const b = M.sys.bodies[M.worldI];
    const want = S.noonHeight(g.lat, b.axialTilt, g.season), got = highest(M, O, T0);
    ok(Math.abs(got - want) < (M.locked ? 0.3 : 0.02), `${g.world}: noon height ${got.toFixed(2)}° (formula ${want.toFixed(2)}°)`);
  }
}

// -------------------------------------------------------------------------------------------
section('no seasons, ever: the same noon height on every real date');
{
  for (const [id, world] of [['tatoo', 'tatooine'], ['hoth', 'hoth'], ['naboo', 'rori'], ['endor', 'endor'], ['yavin', 'yavin4'], ['corell', 'talus'], ['mustafar', 'mustafar']]) {
    const M = model(Dr.draftSystem(id), world), O = S.makeSkyState(M);
    const hs = [];
    for (let d = 0; d <= 720; d += 45) hs.push(highest(M, O, T0 + d));
    const spread = Math.max(...hs) - Math.min(...hs);
    ok(spread < (M.locked ? 0.3 : 0.02), `${world}: noon height steady over two real years (spread ${spread.toFixed(4)}°)`);
  }
}

// -------------------------------------------------------------------------------------------
section('real time: everything is a function of the one clock; moons phase over real days; orbits tilt');
{
  const sys = Dr.draftSystem('naboo');
  const A = model(sys, 'naboo'), B = model(sys, 'naboo');
  const oa = S.makeSkyState(A), ob = S.makeSkyState(B);
  S.skyAt(A, T0 + 3.21, oa);
  S.skyAt(B, T0 + 100, ob); S.skyAt(B, T0 - 7, ob); S.skyAt(B, T0 + 3.21, ob);
  ok(oa.dir.every((v, i) => v === ob.dir[i]) && oa.lit.every((v, i) => v === ob.lit[i]) && oa.pos.every((v, i) => v === ob.pos[i]), 'the same moment gives the same sky, whatever was asked before (two models, two histories)');
  const j = itemOfBody(A, 'rori');
  const syn = 1 / (1 / 18 - 1 / 312);
  const lits = [];
  for (let k = 0; k <= 60 * 48; k++) { S.skyAt(A, T0 + k / 48, oa); lits.push(oa.lit[j]); }
  const minima = [];
  for (let k = 1; k < lits.length - 1; k++) if (lits[k] < lits[k - 1] && lits[k] <= lits[k + 1] && lits[k] < 0.1) minima.push(k / 48);
  const gaps = minima.slice(1).map((m, i) => m - minima[i]);
  ok(gaps.length >= 2 && gaps.every((g) => Math.abs(g - syn) < 0.05), `Rori is new every ${gaps.map((g) => g.toFixed(2)).join(', ')} real days (synodic month ${syn.toFixed(2)})`);
  let lo = 99, hi = -99;
  const ni = A.sys.bodies.findIndex((b) => b.id === 'naboo'), ri = A.sys.bodies.findIndex((b) => b.id === 'rori');
  for (let k = 0; k <= 400; k++) {
    S.skyAt(A, T0 + k * 0.05, oa);
    const z = oa.pos[3 * ri + 2] - oa.pos[3 * ni + 2], x = oa.pos[3 * ri] - oa.pos[3 * ni], y = oa.pos[3 * ri + 1] - oa.pos[3 * ni + 1];
    const b = deg(Math.asin(z / Math.hypot(x, y, z)));
    lo = Math.min(lo, b); hi = Math.max(hi, b);
  }
  ok(Math.abs(hi - 5) < 0.05 && Math.abs(lo + 5) < 0.05, `Rori's orbit leans 5°: it ranges ${lo.toFixed(2)}° to ${hi.toFixed(2)}° off Naboo's plane`);
  const R = model(sys, 'rori');
  const nj = itemOfBody(R, 'naboo');
  ok(Math.abs(R.itemSpin[nj] - (360 * 24) / 26) < 1e-9, `Naboo seen from Rori turns ${R.itemSpin[nj].toFixed(1)}°/real day (its 26-hour day)`);
  const Y = model(Dr.draftSystem('yavin'), 'yavin4');
  ok(Math.abs(Y.itemSpin[itemOfBody(Y, 'prime')] - (360 * 24) / 11) < 1e-9, 'Yavin Prime seen from Yavin 4 turns at its own 11-hour day');
  const P = model(sys, 'rori'), op = S.makeSkyState(P);
  S.skyAt(P, T0, op); const a0 = op.angle[ni];
  S.skyAt(P, T0 + 78, op); const a1 = op.angle[ni];
  ok(Math.abs(wrapPi(a1 - a0) - (2 * Math.PI * 78) / 312) < 1e-9, 'Naboo moves a quarter of its orbit in 78 real days');
}

// -------------------------------------------------------------------------------------------
section('locked moons: the parent stands still at the height the play area gives, phasing once a game day');
{
  for (const [id, world, parentId, want] of [['yavin', 'yavin4', 'prime', 39.8], ['endor', 'endor', 'giant', 30.2], ['corell', 'talus', 'tralus', 20.4]]) {
    const sys = JSON.parse(JSON.stringify(Dr.draftSystem(id)));
    sys.bodies.find((b) => b.id === sys.grounds.find((g) => g.world === world).body).wobble = 0;
    const M = model(S.cleanSystem(sys), world), O = S.makeSkyState(M);
    const j = itemOfBody(M, parentId);
    let aMin = 99, aMax = -99, zMin = 999, zMax = -999;
    for (let k = 0; k <= 300; k++) {
      S.skyAt(M, T0 + k * 0.013 + Math.floor(k / 100) * 97, O);
      const a = altOf(O, j), z = azOf(O, j);
      aMin = Math.min(aMin, a); aMax = Math.max(aMax, a); zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
    }
    ok(aMax - aMin < 0.01 && zMax - zMin < 0.01, `${world}: ${M.items[j].name} stands still (height within ${(aMax - aMin).toExponential(1)}°, bearing ${(zMax - zMin).toExponential(1)}°)`);
    const g = M.ground;
    const geo = 90 - deg(Math.acos(Math.cos(g.lat * DEG) * Math.cos(g.lon * DEG)));
    ok(Math.abs(aMin - want) < 0.1 && Math.abs(aMin - geo) < 0.6, `${world}: it stands ${aMin.toFixed(2)}° up (90 - acos(cos lat cos lon) = ${geo.toFixed(2)}°)`);
  }
  const yv = JSON.parse(JSON.stringify(Dr.draftSystem('yavin')));
  yv.bodies.find((b) => b.id === 'yavin4').wobble = 0;
  for (const [lat, lon, want] of [[0, 0, 90], [0, 60, 30], [30, 30, 90 - deg(Math.acos(Math.cos(30 * DEG) * Math.cos(30 * DEG)))], [0, 120, -30], [10, 180, -80]]) {
    yv.grounds[0].lat = lat; yv.grounds[0].lon = lon;
    const M = model(S.cleanSystem(yv), 'yavin4'), O = S.makeSkyState(M);
    S.skyAt(M, T0, O);
    const a = altOf(O, itemOfBody(M, 'prime'));
    ok(Math.abs(a - want) < 0.5, `Yavin 4 at ${lat}°, ${lon}°: Yavin Prime ${a.toFixed(2)}° up (geometry ${want.toFixed(2)}°)`);
  }
  yv.grounds[0].lat = 0; yv.grounds[0].lon = 0;
  const M = model(S.cleanSystem(yv), 'yavin4'), O = S.makeSkyState(M);
  const j = itemOfBody(M, 'prime');
  S.skyAt(M, S.timeAtHour(M, T0, 0), O);
  const full = O.lit[j];
  S.skyAt(M, S.timeAtHour(M, T0, 12), O);
  const noonLit = O.lit[j], noonLight = O.daylight;
  ok(full > 0.999 && noonLit < 0.001 && noonLight < 0.01, `Yavin Prime full at midnight (${full.toFixed(4)}), new at noon (${noonLit.toFixed(4)}), the sun hidden at noon (daylight ${noonLight.toFixed(3)})`);
  const ls = [];
  for (let k = 0; k <= 1000; k++) { S.skyAt(M, T0 + (k / 100) * M.dayDays, O); ls.push(O.lit[j]); }
  const fulls = [];
  for (let k = 1; k < ls.length - 1; k++) if (ls[k] > ls[k - 1] && ls[k] >= ls[k + 1] && ls[k] > 0.9) fulls.push(k / 100);
  const fgaps = fulls.slice(1).map((x, i) => x - fulls[i]);
  ok(fgaps.length >= 8 && fgaps.every((g) => Math.abs(g - 1) < 0.011), `Yavin Prime full once every game day (${fulls.length} fulls in ten, ${fgaps.length} gaps of one day)`);
  const W = model(Dr.draftSystem('yavin'), 'yavin4'), ow = S.makeSkyState(W);
  const wj = itemOfBody(W, 'prime');
  const pts = [];
  for (let k = 0; k <= 200; k++) { S.skyAt(W, T0 + (k / 100) * W.dayDays, ow); pts.push([ow.dir[3 * wj], ow.dir[3 * wj + 1], ow.dir[3 * wj + 2]]); }
  let swing = 0;
  for (const p of pts) for (const q of pts) swing = Math.max(swing, deg(Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])))));
  ok(swing > 3 && swing < 5, `with its wobble of 2°, Yavin Prime swings ${swing.toFixed(2)}° end to end each day`);
  ok(Math.abs(W.lockDay[W.worldI] - 4 / 24) < 1e-12, 'Yavin 4\'s orbit round Yavin Prime is its 4-hour game day');
}

// -------------------------------------------------------------------------------------------
section('one system per star: the same moment from Naboo and from Rori, from Corellia and from Talus');
{
  for (const [id, a, b] of [['naboo', 'naboo', 'rori'], ['corell', 'corellia', 'talus']]) {
    const sys = Dr.draftSystem(id);
    const MA = model(sys, a), MB = model(sys, b), oa = S.makeSkyState(MA), ob = S.makeSkyState(MB);
    let worstPos = 0, worstDir = 0, worstLit = 0;
    for (let k = 0; k < 40; k++) {
      const t = T0 + k * 7.3 + k * k * 0.01;
      S.skyAt(MA, t, oa); S.skyAt(MB, t, ob);
      for (let i = 0; i < oa.pos.length; i++) worstPos = Math.max(worstPos, Math.abs(oa.pos[i] - ob.pos[i]));
      const jb = itemOfBody(MA, MA.sys.bodies[MB.worldI].id), ja = itemOfBody(MB, MB.sys.bodies[MA.worldI].id);
      const back = (o, j) => { const R = o.R, x = o.dir[3 * j], y = o.dir[3 * j + 1], z = o.dir[3 * j + 2]; return [R[0] * x + R[3] * y + R[6] * z, R[1] * x + R[4] * y + R[7] * z, R[2] * x + R[5] * y + R[8] * z]; };
      const u = back(oa, jb), v = back(ob, ja);
      worstDir = Math.max(worstDir, deg(Math.acos(Math.max(-1, Math.min(1, -(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))))));
      const ia = MA.worldI, ib = MB.worldI, s3 = 3 * MA.sunI, P = oa.pos;
      const sa = [P[3 * ia] - P[s3], P[3 * ia + 1] - P[s3 + 1], P[3 * ia + 2] - P[s3 + 2]], sb = [P[3 * ib] - P[s3], P[3 * ib + 1] - P[s3 + 1], P[3 * ib + 2] - P[s3 + 2]];
      const atSun = Math.acos(Math.max(-1, Math.min(1, (sa[0] * sb[0] + sa[1] * sb[1] + sa[2] * sb[2]) / (Math.hypot(...sa) * Math.hypot(...sb)))));
      const pa = Math.acos(Math.max(-1, Math.min(1, 2 * oa.lit[jb] - 1))), pb = Math.acos(Math.max(-1, Math.min(1, 2 * ob.lit[ja] - 1)));
      worstLit = Math.max(worstLit, deg(Math.abs(pa + pb + atSun - Math.PI)));
    }
    ok(worstPos === 0, `${a} and ${b}: every body in the same place at the same moment (worst ${worstPos})`);
    ok(worstDir < 1e-4, `${b} seen from ${a} and ${a} seen from ${b}: opposite directions (worst ${worstDir.toExponential(2)}°)`);
    ok(worstLit < 0.01, `${b}'s phase from ${a}, ${a}'s from ${b} and their angle at the sun make half a turn (worst ${worstLit.toFixed(5)}°)`);
  }
}

// -------------------------------------------------------------------------------------------
section('Tatooine\'s twin suns: one body, side by side, never overlapping from anywhere');
{
  const base = JSON.parse(JSON.stringify(Dr.draftSystem('tatoo')));
  let worstGap = 99, checks = 0, belowOk = 0, belowN = 0;
  const disc = (s) => deg(Math.atan(0.2 * Math.tan((s * DEG) / 2)));
  for (const lat of [-85, -60, -30, -10, 0, 10, 25, 45, 70, 85]) for (const lon of [0, 90, -150]) for (const season of [-90, 0, 90]) for (const tilt of [0, 12, 40]) {
    base.grounds[0].lat = lat; base.grounds[0].lon = lon; base.grounds[0].season = season;
    base.bodies.find((b) => b.id === 'tatooine').axialTilt = tilt;
    const M = model(S.cleanSystem(base), 'tatooine'), O = S.makeSkyState(M);
    const a = M.pairA[0], b = M.pairB[0];
    const need = disc(M.itemSize[a]) + disc(M.itemSize[b]);
    for (let k = 0; k < 48; k++) {
      S.skyAt(M, T0 + (k / 48) * M.dayDays, O);
      worstGap = Math.min(worstGap, angle(O, a, b) - need);
      checks++;
      const P = O.poleSky, hemi = lat < 0 ? -1 : 1;
      const da = O.dir[3 * a] * P[0] + O.dir[3 * a + 1] * P[1] + O.dir[3 * a + 2] * P[2];
      const db = O.dir[3 * b] * P[0] + O.dir[3 * b + 1] * P[1] + O.dir[3 * b + 2] * P[2];
      belowN++; if (hemi * (da - db) > 0) belowOk++;
    }
  }
  ok(worstGap > 1.5 - 1e-6, `${checks} moments over 270 worlds: the discs' edges never closer than ${worstGap.toFixed(4)}° (the 1.5° gap)`);
  ok(belowOk === belowN, `Tatoo II always farther from the visible pole than Tatoo I (${belowOk}/${belowN})`);
  const M = model(Dr.draftSystem('tatoo'), 'tatooine'), O = S.makeSkyState(M);
  const a = M.pairA[0], b = M.pairB[0];
  const cross = (j, rising) => { let prev = null; for (let k = 0; k <= 20000; k++) { const t = T0 + (k / 20000) * M.dayDays; S.skyAt(M, t, O); const y = O.dir[3 * j + 1]; if (prev !== null && (rising ? prev <= 0 && y > 0 : prev > 0 && y <= 0)) return t; prev = y; } return NaN; };
  const ra = cross(a, true), rb = cross(b, true), sa = cross(a, false), sb = cross(b, false);
  ok(rb > ra && sb < sa, `Tatoo II rises ${((rb - ra) * 1440).toFixed(1)} real minutes after Tatoo I and sets ${((sa - sb) * 1440).toFixed(1)} before it`);
  ok(M.casterJ === a, 'Tatoo I (brightness 1) casts the light, not Tatoo II (0.8)');
  const swap = JSON.parse(JSON.stringify(Dr.draftSystem('tatoo')));
  swap.bodies[0].members[1].brightness = 1.4;
  const M2 = model(S.cleanSystem(swap), 'tatooine'), O2 = S.makeSkyState(M2);
  S.skyAt(M2, T0 + 0.1, O2);
  ok(M2.casterJ === M2.pairB[0] && O2.day.sun.x === O2.dir[3 * M2.pairB[0]], 'made the brighter, Tatoo II casts the light and the day\'s sun is it');
}

// -------------------------------------------------------------------------------------------
section('the viewer\'s clock: the hour within a day of the world, and the real date');
{
  const M = model(Dr.draftSystem('naboo'), 'naboo');
  let worst = 0;
  for (const h of [0, 1.5, 6, 12, 18.25, 23.9]) for (const t of [T0, T0 + 0.37, T0 - 41.9]) {
    const t2 = S.timeAtHour(M, t, h);
    const dh = Math.abs(S.localHour(M, t2) - h); worst = Math.max(worst, Math.min(dh, 24 - dh));
    ok(Math.abs(t2 - t) < M.dayDays, `timeAtHour stays within the same day of the world (${h} h)`);
  }
  ok(worst < 1e-6, `timeAtHour gives the hour asked (worst ${worst.toExponential(2)} h)`);
  ok(S.realDays(S.EPOCH_MS) === 0 && Math.abs(S.msOfRealDays(S.realDays(1795000000000)) - 1795000000000) < 1e-3, 'the real clock: days since 1 January 2026 and back');
}

// -------------------------------------------------------------------------------------------
section('the first round\'s drafts and every draft of version 2, as recorded from the viewer\'s own code; which sky a world follows');
{
  // Recorded on 22 November from the moved modules and from the live viewer's own copy (`sysdigests.mjs` in the wave's
  // scratch), which agreed: every version 1 draft cleaned and drawn at fifty moments, and every version 2 draft.
  const RECORDED = { drafts1File: 'f19aaf65f179923b', v1Worlds: 14, v1: '1b6279c877787844', v2Systems: 12, v2: '8186d664ae0a1f14' };
  // Hashed with its line ends as git keeps them (LF): a checkout made with `core.autocrlf` has CRLF on disk.
  ok(hash(readFileSync(new URL('drafts1.js', SYS), 'utf8').replace(/\r\n/g, '\n')) === RECORDED.drafts1File, 'drafts1.js is the first round\'s drafts.js unchanged (its hash as recorded)');
  const v1 = createHash('sha256');
  for (const w of D1.DRAFT_WORLDS) {
    const sys = S.cleanSystem(JSON.parse(JSON.stringify(D1.draftFor(w))));
    v1.update(w + JSON.stringify(sys));
    const M = S.compileSystem(sys, () => 9, () => false), O = S.makeSkyState(M);
    for (let k = 0; k < 50; k++) {
      S.skyAt(M, S.skyTime(k * 3, (k * 5.3) % 24), O);
      for (const key of ['dir', 'light', 'lit', 'dist', 'cover', 'R', 'zenith', 'pos']) v1.update(Buffer.from(new Float64Array(O[key]).buffer));
      v1.update(String(O.daylight) + String(O.night));
    }
  }
  ok(D1.DRAFT_WORLDS.length === RECORDED.v1Worlds && v1.digest('hex').slice(0, 16) === RECORDED.v1, `all ${D1.DRAFT_WORLDS.length} version 1 drafts clean and draw bit for bit as recorded`);
  const v2 = createHash('sha256');
  for (const id of Dr.DRAFT_SYSTEMS) {
    const sys = Dr.draftSystem(id);
    ok(!!sys && sys.version === 2 && sys.grounds.length >= 1, `${id}: a version 2 system with ${sys?.grounds.length} ground(s)`);
    v2.update(id + JSON.stringify(sys));
  }
  ok(Dr.DRAFT_SYSTEMS.length === RECORDED.v2Systems && v2.digest('hex').slice(0, 16) === RECORDED.v2, `all ${Dr.DRAFT_SYSTEMS.length} version 2 drafts as recorded`);
  const fut = S.cleanSystem({ version: 7, name: 'x', bodies: [] });
  ok(fut && fut.future === true && fut.version === 7, 'a system from a newer viewer is kept as it is (future)');
  const holds = (w) => Dr.draftSystemOf(w);
  const v1r = { rori: { applied: true } };
  ok(S.skyRuleFor('rori', v1r, {}, holds).rule === 'one-world', 'Rori applied in the first round keeps its one-world sky');
  ok(S.skyRuleFor('naboo', v1r, {}, holds).rule === 'swg', 'Naboo, never applied, keeps SWG\'s sky');
  ok(S.skyRuleFor('rori', v1r, { naboo: { applied: true } }, holds).rule === 'system' && S.skyRuleFor('naboo', v1r, { naboo: { applied: true } }, holds).rule === 'system', 'once the Naboo system is applied, Naboo and Rori both follow it');
  ok(S.skyRuleFor('otoh_gunga', {}, { naboo: { applied: true } }, holds).rule === 'system', 'and so does Otoh Gunga, a copy of Naboo\'s sky');
  ok(S.skyRuleFor('naboo', {}, { naboo: { applied: false } }, holds).rule === 'swg', 'a system not applied changes nothing');
}

// -------------------------------------------------------------------------------------------
section('Mustafar\'s giants stay beside it, as the lore keeps them; Nur goes round it');
{
  const M = model(Dr.draftSystem('mustafar'), 'mustafar'), O = S.makeSkyState(M);
  const j = (id) => itemOfBody(M, id);
  const elong = (a) => deg(Math.acos(Math.max(-1, Math.min(1, O.dir[3 * a] * O.dir[3 * M.casterJ] + O.dir[3 * a + 1] * O.dir[3 * M.casterJ + 1] + O.dir[3 * a + 2] * O.dir[3 * M.casterJ + 2]))));
  let far = 0;
  const eJ = [], eL = [];
  for (let d = 0; d <= 3650; d += 73) {
    S.skyAt(M, T0 + d, O);
    far = Math.max(far, O.dist[j('jestefad')], O.dist[j('lefrani')]);
    eJ.push(elong(j('jestefad'))); eL.push(elong(j('lefrani')));
  }
  ok(far < 0.4, `over ten real years neither giant is ever more than ${far.toFixed(3)} AU from Mustafar`);
  ok(Math.max(...eJ) - Math.min(...eJ) < 2 && Math.abs(eJ[0] - 65.5) < 2, `Jestefad stays ${eJ[0].toFixed(1)}° from the sun (inside, half lit)`);
  ok(Math.max(...eL) - Math.min(...eL) < 3 && eL[0] > 100, `Lefrani stays ${eL[0].toFixed(1)}° from the sun (outside, by night)`);
  ok(M.sys.bodies[M.items[j('nur')].body].parent === 'mustafar', 'Nur goes round Mustafar');
}

// -------------------------------------------------------------------------------------------
section('SWG\'s rules as places.js keeps them (the game\'s own numbers, read only by it)');
{
  ok(PL.SWG_LIGHT_ELEVATION === 67.5, `the light's path is pitched 67.5° (daycycle.ts's), places.js ${PL.SWG_LIGHT_ELEVATION}`);
  ok(PL.DAY_NIGHT_SPLIT > 0 && PL.DAY_NIGHT_SPLIT < 1, `the day's share of the light path ${PL.DAY_NIGHT_SPLIT}`);
  // the light at noon stands at its peak, the day at 06:00 begins it
  const noon = PL.dayAt(12), six = PL.dayAt(6);
  ok(!!noon && !!six && typeof noon.ratio === 'number', 'dayAt answers a day record');
}

// -------------------------------------------------------------------------------------------
section('skyAt makes nothing: a long run grows no heap');
{
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const M = model(Dr.draftSystem('tatoo'), 'tatooine'), O = S.makeSkyState(M);
  for (let k = 0; k < 20000; k++) S.skyAt(M, T0 + k * 0.001, O);
  gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let k = 0; k < 400000; k++) S.skyAt(M, T0 + k * 0.001, O);
  gc();
  const grew = process.memoryUsage().heapUsed - h0;
  ok(grew < 256 * 1024, `400,000 skies grew the heap by ${(grew / 1024).toFixed(1)} KB`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.map((f) => '  FAIL ' + f).join('\n')); process.exit(1); }
