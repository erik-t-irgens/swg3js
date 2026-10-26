// The unified wind's arithmetic (the volumetrics' wave 7a, `src/world/windMath.ts`): the pattern's geometry is the world's
// and the shared clock's alone (three players at three places with three histories of frames pack the same lattice to the
// bit), the travel by absolute steps is the fine integral within a percent, the wobble is pure and nought off the arm and
// never turns faster than the design's bound, the patches travel downwind, nothing jumps at a phase's restart, a gust's
// mean factor is one, the committed quantile table is the one a fresh build makes (whole or in slices), the hash fills its
// deciles, the world multipliers start at one, the read-outs agree with a fine count, the devils are the same in every
// history and are born by day only, the processor's copy of the gust (`gustFlat`) is the shader's single-precision
// arithmetic against a double-precision reading of the same formula, and `WIND7_GLSL` passes the scans.
import assert from 'node:assert/strict';
import {
  DEFAULT_CBAR,
  DEFAULT_THETA,
  DEVIL_W,
  PACK_FLOATS,
  WIND7_GLSL,
  WIND_KINDS,
  WindPattern,
  buildWindTable,
  devilInDay,
  devilSalt,
  gustFlat,
  headingWalk,
  newGustAt,
  newProfile,
  newWindAsk,
  newWindTableJob,
  stepWindTable,
  windHash,
  worldWindOf,
  type DevilDay,
  type WindMathTune,
  type WindProfile,
  type WindRow,
} from '../../../src/world/windMath.ts';
import { WIND_DAY, WIND_PROFILES, WIND_TUNE, WIND_WORLDS, windWorldOf, writeWindDay } from '../../../src/world/wind.ts';
import { climateFor, levelAtStep, seedOf } from '../../../src/world/weatherSchedule.ts';
import { redeclared, reservedWords, unbalanced, undefinedCalls, uniformNames } from './glslScan.ts';
import { glslFunctionText, glslFunctions, glslW7Hash } from './glslRun.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// A world of our own: five levels, a clear sky at 0 to a dust storm at 4.
const ROWS: WindRow[] = [];
for (let l = 0; l < 5; l++) {
  for (let r = 0; r < 4; r++) ROWS.push({ weatherIndex: l, windSpeedScale: 2 + l * 2.5 + r * 0.3, cameraEffect: l >= 3 ? { kind: 'dust' } : l === 2 ? { kind: 'leaves' } : null });
}
const WORLD = worldWindOf(ROWS, 5);
const SEED = seedOf('tatooine');
const WEIGHTS = climateFor('tatooine', 5);
const TUNE = WIND_TUNE as unknown as WindMathTune;
const make = (): WindPattern => new WindPattern(SEED, WEIGHTS, WORLD, WIND_PROFILES, windWorldOf('tatooine'), TUNE, new Float32Array(PACK_FLOATS));
const ask = (profile: WindProfile, t: number): ReturnType<typeof newWindAsk> => {
  const a = newWindAsk(profile);
  a.t = t;
  a.on = true;
  a.rows = 6;
  a.art = 1;
  return a;
};
const T0 = 1.79e9;
const GEOMETRY = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 23, 24];

// --- the world's table ---
{
  ok(WORLD.levels === 5 && WORLD.speeds[0] === 2.6 && WORLD.speeds[4] === 12.6, "the world's speed a level is its rows' upper median (2.6 m/s at level 0, 12.6 at 4)");
  ok(WORLD.shares[3 * 8 + 3] === 1 && WORLD.shares[0] === 1, "and its kinds' shares by the rows' own camera effects (level 3 all dust, level 0 all clear)");
  const gap = worldWindOf([{ weatherIndex: 0, windSpeedScale: 3 }, { weatherIndex: 3, windSpeedScale: 9 }], 5);
  ok(gap.speeds[1] === 3 && gap.speeds[2] === 3 && gap.speeds[4] === 9, 'a level with no row takes the nearest level below that has one');
}

// --- the schedule's level, written out through the kept hash record, is the weather's own ---
{
  let same = true;
  for (const [seed, w] of [[SEED, WEIGHTS], [seedOf('mustafar'), climateFor('mustafar', 3)], [7, [1, 1, 1, 1, 1]]] as [number, number[]][]) {
    const p = new WindPattern(seed, w, worldWindOf(ROWS, w.length), WIND_PROFILES, windWorldOf('tatooine'), TUNE, new Float32Array(PACK_FLOATS));
    for (let s = 5966000; s < 5969000; s++) if (p.levelAtStepOf(s) !== levelAtStep(seed, w, s)) same = false;
  }
  ok(same, "the pattern's own reading of the weather's level at a step is the weather's levelAtStep, over 3,000 steps of three climates");
}

// --- three players, three histories: one pattern ---
{
  const a = make();
  const b = make();
  const c = make();
  const pa = newProfile();
  Object.assign(pa, WIND_PROFILES.clear);
  const pb = newProfile();
  Object.assign(pb, WIND_PROFILES.dust);
  // a steps every 1/144 s for five minutes, b every 1/20 s with a pause, c is made fresh at each moment asked.
  const moments = [T0 + 37.3, T0 + 91.7, T0 + 180.2, T0 + 299.9];
  let same = true;
  let diffStrength = false;
  let t = T0;
  let m = 0;
  while (m < moments.length) {
    t += 1 / 144;
    a.pack(ask(pa, Math.min(t, moments[m])));
    if (Math.floor(t * 20) !== Math.floor((t - 1 / 144) * 20) && !(t > T0 + 100 && t < T0 + 160)) b.pack(ask(pb, Math.min(t, moments[m])));
    if (t >= moments[m]) {
      a.pack(ask(pa, moments[m]));
      b.pack(ask(pb, moments[m]));
      const fresh = make();
      fresh.pack(ask(pa, moments[m]));
      for (const i of GEOMETRY) if (!Object.is(a.packOut[i], b.packOut[i]) || !Object.is(a.packOut[i], fresh.packOut[i])) same = false;
      if (a.packOut[20] !== b.packOut[20]) diffStrength = true;
      m++;
    }
  }
  void c;
  ok(same, 'three players with three histories of frames (every 1/144 s, every 1/20 s with a minute away, made fresh at the moment) pack the same offsets, headings, weights, scales, θ, c̄, second octave and lattice, to the bit');
  ok(diffStrength, "while how strong a gust is follows each observer's own area (a dust storm's gust against a clear day's)");
}

// --- the travel by absolute steps against a fine integral ---
{
  const coarse = make();
  const fineTune = JSON.parse(JSON.stringify(WIND_TUNE)) as WindMathTune;
  fineTune.gusts.step = 0.05;
  const fine = new WindPattern(SEED, WEIGHTS, WORLD, WIND_PROFILES, windWorldOf('tatooine'), fineTune, new Float32Array(PACK_FLOATS));
  coarse.arm = true;
  fine.arm = true;
  let worst = 0;
  for (const span of [90, 600, 3600]) {
    coarse.between(0, T0, T0 + span);
    const cx = coarse.to.x;
    const cz = coarse.to.z;
    fine.between(0, T0, T0 + span);
    const d = Math.hypot(fine.to.x, fine.to.z);
    worst = Math.max(worst, Math.hypot(cx - fine.to.x, cz - fine.to.z) / Math.max(d, 1));
  }
  ok(worst < 0.01, `the pattern's travel summed over 2 s steps is the 0.05 s integral within a percent over 90 s, ten minutes and an hour (worst ${(worst * 100).toFixed(3)}%)`);
  // The memo never changes an answer.
  const fresh = make();
  fresh.arm = true;
  coarse.between(1, T0, T0 + 1234.5);
  fresh.between(1, T0, T0 + 1234.5);
  ok(Object.is(coarse.to.x, fresh.to.x) && Object.is(coarse.to.z, fresh.to.z), 'and the memo never changes an answer: carried on, or summed afresh, the travel is the same to the bit');
}

// --- the heading: today's walk off the arm, the wobble under it ---
{
  const p = make();
  let pure = true;
  for (let i = 0; i < 400; i++) {
    const t = T0 + i * 13.7;
    p.arm = false;
    p.headingAtIn(t);
    if (!Object.is(p.hd, headingWalk(SEED, t, WIND_TUNE.heading.wanderPeriod))) pure = false;
  }
  ok(pure, "off the arm the heading is today's shared walk to the bit (the weather's own `windAt`)");
  p.arm = true;
  let worstRate = 0;
  let worstOff = 0;
  let moved = false;
  for (let i = 0; i < 4000; i++) {
    const t = T0 + i * 0.9;
    p.headingAtIn(t);
    const h0 = p.hd;
    p.levelAtIn(t);
    const A = p.worldProfileAt(p.lv).wander;
    p.headingAtIn(t + 1);
    const h1 = p.hd;
    const walk0 = headingWalk(SEED, t, WIND_TUNE.heading.wanderPeriod);
    const walk1 = headingWalk(SEED, t + 1, WIND_TUNE.heading.wanderPeriod);
    const wob = Math.abs(h1 - walk1 - (h0 - walk0));
    if (A > 0) worstRate = Math.max(worstRate, wob / (A / 40));
    worstOff = Math.max(worstOff, Math.abs(h0 - walk0) - A);
    if (Math.abs(h0 - walk0) > 1e-3) moved = true;
  }
  ok(moved && worstOff <= 1e-12, 'under the arm the heading wobbles about the walk by no more than the world profile\'s wander');
  ok(worstRate <= 1, `and the wobble turns the wind no faster than a fortieth of its size a second (worst ${worstRate.toFixed(3)} of that)`);
}

// --- the patches travel downwind ---
{
  const p = make();
  const pr = newProfile();
  Object.assign(pr, WIND_PROFILES.clear);
  const g = newGustAt();
  const t = T0 + 20;
  const dt = 2;
  p.pack(ask(pr, t));
  const before = Float32Array.from(p.packOut);
  p.travelWindIn(t);
  const vx = p.su.x;
  const vz = p.su.z;
  p.pack(ask(pr, t + dt));
  const after = p.packOut;
  // The phases' weights moved a little over two seconds: compare the blended noise before the threshold, through p.
  let shifted = 0;
  let still = 0;
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const x = ((i * 37) % 200) * 3.1 - 300;
    const z = Math.floor(i / 20) * 13.3 - 120;
    g.x = x;
    g.z = z;
    gustFlat(g, before);
    const p0 = g.p;
    g.x = x + vx * dt;
    g.z = z + vz * dt;
    gustFlat(g, after);
    shifted += Math.abs(g.p - p0);
    g.x = x;
    g.z = z;
    gustFlat(g, after);
    still += Math.abs(g.p - p0);
    n++;
  }
  ok(Math.hypot(vx, vz) >= WIND_TUNE.gusts.travelFloor && shifted < 0.35 * still, `a patch two seconds on stands where the wind carried it: the field at the carried place differs ${(shifted / n).toFixed(4)} on average, at the same place ${(still / n).toFixed(4)}`);
}

// --- no seam at a restart, and the mean factor one ---
{
  const p = make();
  const pr = newProfile();
  Object.assign(pr, WIND_PROFILES.clear);
  const g = newGustAt();
  const cyc = WIND_TUNE.gusts.cycle;
  const start = Math.ceil(T0 / cyc) * cyc;
  let restartJump = 0;
  let otherJump = 0;
  const pts: [number, number][] = [];
  for (let i = 0; i < 64; i++) pts.push([((i * 53) % 97) * 7.3 - 350, ((i * 29) % 89) * 6.1 - 270]);
  const prev = new Float64Array(pts.length);
  for (let s = -240; s <= 240; s++) {
    const t = start + s / 60;
    p.pack(ask(pr, t));
    for (let i = 0; i < pts.length; i++) {
      g.x = pts[i][0];
      g.z = pts[i][1];
      gustFlat(g, p.packOut);
      if (s > -240) {
        const j = Math.abs(g.k - prev[i]);
        if (Math.abs(s) <= 1) restartJump = Math.max(restartJump, j);
        else otherJump = Math.max(otherJump, j);
      }
      prev[i] = g.k;
    }
  }
  ok(restartJump <= Math.max(otherJump, 1e-3) * 1.5, `no seam at a phase's restart: the gust factor moves ${restartJump.toFixed(4)} across the restart's frame, at most ${otherJump.toFixed(4)} across any other`);
  // The mean of k over the ground at many moments.
  let sum = 0;
  let count = 0;
  let inside = 0;
  let cover = 0;
  for (let m = 0; m < 24; m++) {
    p.pack(ask(pr, T0 + m * 61.3));
    cover += (p.covers[0] + p.covers[1]) / 2 / 24;
    for (let i = 0; i < 2500; i++) {
      g.x = (i % 50) * 23.7 - 600;
      g.z = Math.floor(i / 50) * 21.1 - 500;
      gustFlat(g, p.packOut);
      sum += g.k;
      if (g.p > 0.5) inside++;
      count++;
    }
  }
  const mean = sum / count;
  ok(Math.abs(mean - 1) < 0.05, `a gust's mean factor over the ground is one, so the mean wind is the weather's (${mean.toFixed(4)} over ${count} points at 24 moments)`);
  ok(Math.abs(inside / count - cover) < 0.08, `and the share of the ground under a gust is about the world's cover the phases froze (${(inside / count).toFixed(3)} against ${cover.toFixed(3)}): the geometry is the world's, never the observer's`);
}

// --- the quantile table: the committed one is a fresh build's, and sliced is whole ---
{
  const fresh = buildWindTable();
  let same = true;
  for (let i = 0; i < DEFAULT_THETA.length; i++) if (!Object.is(fresh.theta[i], DEFAULT_THETA[i]) || !Object.is(fresh.cbar[i], DEFAULT_CBAR[i])) same = false;
  ok(same && DEFAULT_THETA.length === 65, 'the committed quantile table (θ and c̄ at 65 covers) is exactly the one a fresh build makes');
  const job = newWindTableJob(WIND_TUNE.gusts.soft, WIND_TUNE.gusts.octave2, WIND_TUNE.gusts.lattice);
  let slices = 0;
  while (!stepWindTable(job)) slices++;
  let sliced = true;
  for (let i = 0; i < 65; i++) if (!Object.is(job.theta[i], fresh.theta[i]) || !Object.is(job.cbar[i], fresh.cbar[i])) sliced = false;
  ok(sliced && slices > 10, `and made in slices a frame at a time (${slices + 1} slices) it is the same table to the bit`);
  let mono = true;
  for (let i = 1; i < 65; i++) if (!(fresh.theta[i] <= fresh.theta[i - 1]) || !(fresh.cbar[i] >= fresh.cbar[i - 1])) mono = false;
  ok(mono && Math.abs(fresh.cbar[32] - 0.5) < 0.02, 'θ falls and c̄ rises with the cover, c̄ about a half at half cover');
}

// --- the hash ---
{
  const dec = new Float64Array(10);
  const N = 200000;
  for (let i = 0; i < N; i++) dec[Math.floor(windHash(i % 457, Math.floor(i / 457), 3) * 10)]++;
  let worst = 0;
  for (let d = 0; d < 10; d++) worst = Math.max(worst, Math.abs(dec[d] / N - 0.1));
  ok(worst < 0.01, `the hash fills its deciles evenly (worst ${(worst * 100).toFixed(2)} points off a tenth over ${N} values)`);
  let exact = true;
  for (let i = 0; i < 1000; i++) {
    const h = windHash(i, -i, i * 7);
    if (!(h >= 0 && h < 1) || Math.fround(h) !== h) exact = false;
  }
  ok(exact, 'and every answer is in [0, 1) and exact in a float, so the program and the processor read the same number');
}

// --- the worlds' multipliers ---
{
  let ones = true;
  for (const [id, e] of Object.entries(WIND_WORLDS)) {
    for (const k of ['floor', 'gust', 'cover', 'size', 'wander'] as const) if (e[k] !== 1) ones = false;
    if (e.byLevel.length !== 5) ones = false;
    for (const L of e.byLevel) for (const k of ['floor', 'gust', 'cover', 'size', 'wander', 'devils'] as const) if (L[k] !== 1) ones = false;
    if (!['endor', 'yavin4', 'kashyyyk'].some((w) => id.startsWith(w)) && e.devils !== 1) ones = false;
  }
  ok(ones, "every world's multipliers start at one but the jungle and forest worlds' devils");
  ok(WIND_WORLDS.endor?.devils === 0 && WIND_WORLDS.yavin4?.devils === 0, 'and Endor and Yavin 4 have no dust devils');
  const unknown = windWorldOf('nowhere');
  ok(unknown.floor === 1 && unknown.devils === 1 && unknown.byLevel.length === 5, 'a world not listed is all ones');
}

// --- the read-outs against a fine count ---
{
  const pr = newProfile();
  Object.assign(pr, WIND_PROFILES.clear);
  const a = ask(pr, T0);
  const r = WindPattern.readouts(make, a, 120, -40, 3600, 1);
  const fine = WindPattern.readouts(make, a, 120, -40, 3600, 0.1);
  ok(r.perHour > 0 && Math.abs(r.share - fine.share) < 0.03, `the read-outs a second at a time over an hour (${r.perHour.toFixed(1)} gusts, ${r.secondsEach.toFixed(1)} s each, ${(r.share * 100).toFixed(1)}% of the time) agree with a count ten times a second over the same hour (${fine.perHour.toFixed(1)}, ${fine.secondsEach.toFixed(1)} s, ${(fine.share * 100).toFixed(1)}%)`);
  ok(Math.abs(r.perHour - fine.perHour) <= Math.max(3, 0.35 * fine.perHour), 'and count about as many gusts an hour');
}

// --- the devils ---
{
  const day: DevilDay = { now: 0.5, t: 0, length: 720 };
  // Many devils to see: a rate turned up for the test alone.
  const profiles = JSON.parse(JSON.stringify(WIND_PROFILES)) as typeof WIND_PROFILES;
  for (const k of Object.keys(profiles) as (keyof typeof profiles)[]) profiles[k].devils = 400;
  const mk = (): WindPattern => new WindPattern(SEED, WEIGHTS, WORLD, profiles, windWorldOf('tatooine'), TUNE, new Float32Array(PACK_FLOATS));
  const a = mk();
  const b = mk();
  a.arm = true;
  b.arm = true;
  let same = true;
  let seen = 0;
  for (let i = 0; i < 1200; i++) {
    const t = T0 + i * 0.25;
    day.t = t;
    day.now = 0.5;
    a.devilsNear(0, 0, 160, t, day, false);
    if (i % 7 === 0 || i === 1199) {
      b.devilsNear(0, 0, 160, t, day, true);
      a.devilsNear(0, 0, 160, t, day, true);
      if (a.devilCount !== b.devilCount) same = false;
      for (let d = 0; d < a.devilCount * DEVIL_W; d++) if (!Object.is(a.devils[d], b.devils[d])) same = false;
      seen = Math.max(seen, a.devilCount);
    }
  }
  ok(same && seen > 0, `two players listing the devils with different histories hold the same devils at the same places to the bit (up to ${seen} at once)`);
  // By day only: a birth whose moment falls in the night is never listed.
  let nightOk = true;
  for (let i = 0; i < 500; i++) {
    const born = T0 + i * 3.7;
    const d: DevilDay = { now: 0.95, t: born, length: 720 };
    if (devilInDay(d, born)) nightOk = false;
    d.now = 0.5;
    if (!devilInDay(d, born)) nightOk = false;
  }
  ok(nightOk, "a devil is born by day alone: the client's day from 06:00, its first seventy per cent light");
  const night = mk();
  night.arm = true;
  day.now = 0.05;
  day.t = T0;
  night.devilsNear(0, 0, 160, T0 + 300, { now: 0.05, t: T0 + 300, length: 720 }, true);
  ok(night.devilCount === 0 && night.devilTests > 0, 'and at night none stands, though the cells were tested');
  // Off the arm's devils (a rate of nought) nothing is tested at all.
  const calm = make();
  const calmProfiles = JSON.parse(JSON.stringify(WIND_PROFILES)) as typeof WIND_PROFILES;
  for (const k of Object.keys(calmProfiles) as (keyof typeof calmProfiles)[]) calmProfiles[k].devils = 0;
  const none = new WindPattern(SEED, WEIGHTS, WORLD, calmProfiles, windWorldOf('tatooine'), TUNE, new Float32Array(PACK_FLOATS));
  none.devilsNear(0, 0, 160, T0, { now: 0.5, t: T0, length: 720 }, true);
  void calm;
  ok(none.devilCount === 0 && none.devilTests === 0, 'a world with no devils tests no cell');
}

// --- the processor's copy against a double-precision reading of the formula ---
{
  const p = make();
  const pr = newProfile();
  Object.assign(pr, WIND_PROFILES.dust);
  p.pack(ask(pr, T0 + 333));
  const U = p.packOut;
  const g = newGustAt();
  const ref = (x: number, z: number): { k: number; a: number; p: number } => {
    const N = U[24];
    let nb = 0;
    let n2b = 0;
    const noise = (qx: number, qz: number, n: number, s: number): number => {
      let ix = Math.floor(qx);
      let iz = Math.floor(qz);
      const fx = qx - ix;
      const fz = qz - iz;
      ix = ((ix % n) + n) % n;
      iz = ((iz % n) + n) % n;
      const ix1 = (ix + 1) % n;
      const iz1 = (iz + 1) % n;
      const ux = fx * fx * (3 - 2 * fx);
      const uz = fz * fz * (3 - 2 * fz);
      const a = windHash(ix, iz, s);
      const b = windHash(ix1, iz, s);
      const c = windHash(ix, iz1, s);
      const d = windHash(ix1, iz1, s);
      return a + (b - a) * ux + (c + (d - c) * ux - (a + (b - a) * ux)) * uz;
    };
    const mod = (a: number, n: number): number => a - n * Math.floor(a / n);
    for (let ph = 0; ph < 2; ph++) {
      const sh = U[4 + ph * 2];
      const ch = U[5 + ph * 2];
      const along = x * sh + z * ch;
      const across = x * ch - z * sh;
      const qa = mod(along * U[12 + ph * 2] - U[ph * 2], N);
      const qc = mod(across * U[13 + ph * 2] - U[ph * 2 + 1], N);
      const n1 = noise(qa, qc, N, ph + 1);
      const n2 = noise(mod(2 * qa + U[16 + ph * 2], 2 * N), mod(2 * qc + U[17 + ph * 2], 2 * N), 2 * N, ph + 3);
      const nv = (1 - U[23]) * n1 + U[23] * n2;
      nb += U[8 + ph] * (nv - 0.5);
      n2b += U[8 + ph] * (n2 - 0.5);
    }
    nb += 0.5;
    const t = Math.min(1, Math.max(0, (nb - (U[10] - U[11])) / (2 * U[11])));
    const pp = t * t * (3 - 2 * t);
    return { k: Math.max(0, 1 + U[20] * ((pp - U[21]) / (1 - U[21]))), a: U[22] * 2 * n2b, p: pp };
  };
  let worst = 0;
  let nan = 0;
  for (let i = 0; i < 4096; i++) {
    const r = 8000 * Math.sqrt(((i * 2654435761) >>> 0) / 4294967296);
    const th = (i * 0.618034) * Math.PI * 2;
    g.x = r * Math.sin(th);
    g.z = r * Math.cos(th);
    gustFlat(g, U);
    if (!Number.isFinite(g.k) || !Number.isFinite(g.a) || !Number.isFinite(g.p)) nan++;
    const d = ref(g.x, g.z);
    worst = Math.max(worst, Math.abs(g.k - d.k), Math.abs(g.a - d.a), Math.abs(g.p - d.p));
  }
  ok(nan === 0 && worst < 1e-3, `the processor's copy (single precision, as the shader runs it) is the double reading of the same formula within 1e-3 at 4,096 points out to 8 km (worst ${worst.toExponential(2)})`);
  // A wrap rounded a hair under nought (a quotient a step off) wraps back: no cell outside the lattice is read.
  const edge = Float32Array.from(U);
  edge[0] = 0;
  edge[1] = 0;
  g.x = -1e-7;
  g.z = 1e-7;
  gustFlat(g, edge);
  ok(Number.isFinite(g.k) && g.k >= 0, 'and a place a hair under the lattice\'s wrap is read on the wrapped cell, never off it');
}

// --- the GLSL ---
{
  const text = `${WIND7_GLSL}\nvoid main() { vec3 g = w7Gust(vec2(1.0)); vec2 t = w7Target(vec2(0.0), vec2(1.0)); float m = w7Mean(); bool o = w7On(); }`;
  ok(reservedWords(text).length === 0 && unbalanced(text) === '' && redeclared(text).length === 0, 'WIND7_GLSL uses no reserved word, balances its brackets and declares nothing twice in a scope');
  ok(undefinedCalls(text).length === 0, `and calls nothing it does not define (${undefinedCalls(text).join(', ') || 'none'})`);
  ok(uniformNames(text).length === 1 && uniformNames(text)[0] === 'uWind7', 'and its one uniform is uWind7, the pack every reader holds by reference');
  ok(!/\b64\b/.test(WIND7_GLSL), "and no lattice size is written in: the period is the pack's");
}

// --- the worlds' multipliers at their ones leave the kinds' own profiles to the bit, and a multiplier reaches its field ---
{
  const keys = ['floor', 'scale', 'gust', 'cover', 'size', 'stretch', 'veer', 'wander', 'devils', 'trees'] as const;
  const P = WIND_PROFILES as unknown as Record<string, Record<string, number>>;
  // The world's level profile with no multiplier at all: each kind's numbers by its share of the world's rows there.
  const alone = (L: number): Record<string, number> => {
    const lv = Math.min(WORLD.levels - 1, Math.max(0, L));
    const lo = Math.floor(lv);
    const hi = lo + 1 < WORLD.levels ? lo + 1 : lo;
    const f = lv - lo;
    const out: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
    for (let k = 0; k < WIND_KINDS.length; k++) {
      const share = (1 - f) * WORLD.shares[lo * WIND_KINDS.length + k] + f * WORLD.shares[hi * WIND_KINDS.length + k];
      if (!(share > 0)) continue;
      for (const key of keys) out[key] += share * P[WIND_KINDS[k]][key];
    }
    return out;
  };
  const p = make();
  let same = true;
  for (const L of [0, 0.37, 1, 1.5, 2.25, 3.9, 4]) {
    const got = p.worldProfileAt(L) as unknown as Record<string, number>;
    const want = alone(L);
    for (const key of keys) if (!Object.is(got[key], want[key])) same = false;
  }
  ok(same, "a world's multipliers at their ones leave its level profile the kinds' own to the bit by Object.is, at whole levels and between them");
  const e = windWorldOf('zz-test-world');
  e.gust = 2;
  e.byLevel[2].cover = 0.5;
  const q = new WindPattern(SEED, WEIGHTS, WORLD, WIND_PROFILES, e, TUNE, new Float32Array(PACK_FLOATS));
  const at2 = { ...q.worldProfileAt(2) };
  const at25 = { ...q.worldProfileAt(2.5) };
  const b2 = alone(2);
  const b25 = alone(2.5);
  ok(at2.gust === b2.gust * 2 && at2.cover === b2.cover * 0.5 && at2.floor === b2.floor && Math.abs(at25.cover - b25.cover * 0.75) < 1e-12 && at25.gust === b25.gust * 2, "and a multiplier reaches its own field and no other: a world's gust times two doubles every level's gust, a level's cover times a half halves that level's and is ramped toward the next");
  delete WIND_WORLDS['zz-test-world'];
}

// --- the mean factor is one for every kind of weather, through the table's interpolation ---
{
  const g = newGustAt();
  const lines: string[] = [];
  let all = true;
  for (const kind of WIND_KINDS) {
    const rows: WindRow[] = [];
    for (let l = 0; l < 5; l++) for (let r = 0; r < 3; r++) rows.push({ weatherIndex: l, windSpeedScale: 1 + l * 3 + r, cameraEffect: kind === 'clear' ? null : { kind } });
    const p = new WindPattern(SEED, WEIGHTS, worldWindOf(rows, 5), WIND_PROFILES, windWorldOf('tatooine'), TUNE, new Float32Array(PACK_FLOATS));
    const pr = newProfile();
    Object.assign(pr, WIND_PROFILES[kind]);
    let sum = 0;
    let n = 0;
    for (let m = 0; m < 12; m++) {
      p.pack(ask(pr, T0 + m * 97.1));
      for (let i = 0; i < 2500; i++) {
        g.x = (i % 50) * 31.7 - 800;
        g.z = Math.floor(i / 50) * 29.3 - 700;
        gustFlat(g, p.packOut);
        sum += g.k;
        n++;
      }
    }
    const mean = sum / n;
    lines.push(`${kind} ${mean.toFixed(3)} at cover ${p.covers[0].toFixed(2)}`);
    if (!(Math.abs(mean - 1) < 0.05)) all = false;
  }
  ok(all, `a gust's mean factor over the ground is one within 5% for every kind of weather, each a world of its own rows (${lines.join('; ')})`);
}

// --- the devils: the nearest kept whatever order the cells are walked in, born at their rate, the visible day with no server ---
{
  const D = WIND_TUNE.devils;
  const many = JSON.parse(JSON.stringify(WIND_PROFILES)) as typeof WIND_PROFILES;
  for (const k of Object.keys(many) as (keyof typeof many)[]) many[k].devils = 6000;
  const mk = (profiles: typeof WIND_PROFILES): WindPattern => {
    const p = new WindPattern(SEED, WEIGHTS, WORLD, profiles, windWorldOf('tatooine'), TUNE, new Float32Array(PACK_FLOATS));
    p.arm = true;
    return p;
  };
  // Every birth alive and by day whose path can still reach the query, where it stands now, by the formula written out
  // from the public pieces (the hash, the salts, the pure travel from the birth), nearest first.
  const brute = (travel: WindPattern, x: number, z: number, radius: number, t: number, day: DevilDay): { key: string; x: number; z: number; d2: number }[] => {
    travel.levelAtIn(t);
    const wp = { ...travel.worldProfileAt(travel.lv) };
    const pBirth = wp.devils * ((D.cell * D.cell) / 1e6) * (D.epoch / 3600);
    let vmax = Math.max(wp.floor, WIND_TUNE.gusts.travelFloor);
    for (let l = 0; l < WORLD.levels; l++) vmax = Math.max(vmax, WORLD.speeds[l] * Math.max(wp.scale, 1));
    const R = radius + D.reach * D.coreMax + vmax * D.lifeMax;
    const out: { key: string; x: number; z: number; d2: number }[] = [];
    for (let e = Math.floor((t - D.lifeMax) / D.epoch); e <= Math.floor(t / D.epoch); e++) {
      for (let i = Math.floor((x - R) / D.cell); i <= Math.floor((x + R) / D.cell); i++) {
        for (let j = Math.floor((z - R) / D.cell); j <= Math.floor((z + R) / D.cell); j++) {
          if (windHash(i, j, devilSalt(SEED, e, 0)) >= pBirth) continue;
          const born = (e + windHash(i, j, devilSalt(SEED, e, 1))) * D.epoch;
          const life = D.lifeMin + windHash(i, j, devilSalt(SEED, e, 2)) * (D.lifeMax - D.lifeMin);
          if (!(t >= born && t < born + life) || (D.byDay && !devilInDay(day, born))) continue;
          travel.between(3, born, t);
          const cx = (i + windHash(i, j, devilSalt(SEED, e, 3))) * D.cell + travel.to.x;
          const cz = (j + windHash(i, j, devilSalt(SEED, e, 4))) * D.cell + travel.to.z;
          const d2 = (cx - x) ** 2 + (cz - z) ** 2;
          const left = radius + D.reach * D.coreMax + vmax * (born + life - t);
          if (d2 <= left * left) out.push({ key: `${i},${j},${e}`, x: cx, z: cz, d2 });
        }
      }
    }
    return out.sort((a, b) => a.d2 - b.d2);
  };
  const day: DevilDay = { now: 0.5, t: 0, length: 720 };
  const lines: string[] = [];
  let nearest = true;
  for (const [x, z, t] of [[0, 0, T0 + 1000], [40, -25, T0 + 1000], [-300, 220, T0 + 2345.6]] as [number, number, number][]) {
    day.t = t;
    const p = mk(many);
    p.devilsNear(x, z, 160, t, day, true);
    const want = brute(mk(many), x, z, 160, t, day);
    const kept = Math.min(want.length, 16);
    let ok16 = p.devilCount === kept && want.length > 16;
    let worst = 0;
    for (let s = 0; s < p.devilCount && ok16; s++) {
      const o = s * DEVIL_W;
      const w = want[s];
      if (`${p.devils[o + 6]},${p.devils[o + 7]},${p.devils[o + 8]}` !== w.key) ok16 = false;
      worst = Math.max(worst, Math.abs(p.devils[o] - w.x), Math.abs(p.devils[o + 1] - w.z));
    }
    if (!ok16 || worst > 1e-6) nearest = false;
    lines.push(`${want.length} alive in reach of (${x}, ${z}), the 16 nearest kept, places within ${worst.toExponential(1)} m`);
  }
  ok(nearest, `with more devils alive in reach than the list keeps, it keeps the nearest by where each stands now, nearest first, whatever order the cells are walked in, so two players a little apart keep the devils near both (${lines.join('; ')})`);
  // Born at their rate: over two hours of listings whose epochs never overlap, the births among the cells tested.
  const forty = JSON.parse(JSON.stringify(WIND_PROFILES)) as typeof WIND_PROFILES;
  for (const k of Object.keys(forty) as (keyof typeof forty)[]) forty[k].devils = 40;
  const p40 = mk(forty);
  let tests = 0;
  let births = 0;
  let expected = 0;
  for (let t = T0; t < T0 + 7200; t += D.lifeMax + D.epoch) {
    day.t = t;
    p40.devilsNear(0, 0, 5000, t, day, true);
    tests += p40.devilTests;
    births += p40.devilBirths;
    expected += p40.devilTests * p40.devilRate * ((D.cell * D.cell) / 1e6) * (D.epoch / 3600);
  }
  ok(tests > 500000 && Math.abs(births / expected - 1) < 0.05, `over two hours devils are born at their rate: ${births} births where ${expected.toFixed(0)} were expected among ${tests} cells tested (${(((births / expected) - 1) * 100).toFixed(2)}%)`);
  // With no server the gate reads the visible day (a session's day stood at 0.36 at its start, or one held at night from
  // the console), whatever the shared clock's arithmetic would say; with one, the shared day.
  const t = T0 + 5000;
  const vis = mk(many);
  writeWindDay(0.36, 720, Number.NaN);
  WIND_DAY.t = t;
  vis.devilsNear(0, 0, 160, t, WIND_DAY, true);
  const morning = vis.devilCount;
  writeWindDay(0.2, 720, Number.NaN);
  WIND_DAY.t = t;
  vis.devilsNear(0, 0, 160, t, WIND_DAY, true);
  const night = vis.devilCount;
  const nightTests = vis.devilTests;
  const unshared = !WIND_DAY.shared;
  writeWindDay(0.2, 720, 812345.6);
  WIND_DAY.t = t;
  vis.devilsNear(0, 0, 160, t, WIND_DAY, true);
  const server = vis.devilCount;
  ok(unshared && morning > 0 && night === 0 && nightTests > 0 && WIND_DAY.shared && server > 0, `with no server the devils follow the visible day: ${morning} at a session's first morning (0.36), none in its night (0.2) though ${nightTests} cells were tested; with a server the shared day's (${server} at its afternoon while the screen shows night)`);
  writeWindDay(0.36, 720, Number.NaN);
}

// --- the shader's own text, run as script: its hash, its gust, its target's turn, its arm and its mean ---
{
  const H = glslW7Hash(WIND7_GLSL);
  let hashSame = true;
  for (let i = 0; i < 20000; i++) {
    const a = (i * 7919) % 256;
    const b = (i * 104729 + 13) % 256;
    const c = 1 + (i % 4);
    if (H.w7Hash(a, b, c) !== windHash(a, b, c)) hashSame = false;
  }
  ok(hashSame, "the program's own hash (w7Mix and w7Hash, read statement by statement out of WIND7_GLSL) is the processor's windHash to the bit over 20,000 corners");
  const p = make();
  const pr = newProfile();
  Object.assign(pr, WIND_PROFILES.dust);
  p.pack(ask(pr, T0 + 333));
  const U = p.packOut;
  const uW = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ x: U[i * 4], y: U[i * 4 + 1], z: U[i * 4 + 2], w: U[i * 4 + 3] }));
  const env: Record<string, unknown> = {
    uWind7: uW,
    w7Hash: H.w7Hash,
    mod: (a: number, n: number): number => a - n * Math.floor(a / n),
    vec2: (x: number, y: number) => ({ x, y }),
    vec3: (x: number, y: number, z: number) => ({ x, y, z }),
    cos: Math.cos,
    sin: Math.sin,
  };
  const names = ['w7Noise', 'w7Gust', 'w7On', 'w7Target', 'w7Mean'];
  const run = glslFunctions(names.map((n) => glslFunctionText(WIND7_GLSL, n)).join('\n'), names, env) as unknown as {
    w7Gust: (xz: { x: number; y: number }) => { x: number; y: number; z: number };
    w7Target: (xz: { x: number; y: number }, w: { x: number; y: number }) => { x: number; y: number };
    w7On: () => boolean;
    w7Mean: () => number;
  };
  const g = newGustAt();
  let worst = 0;
  let nan = 0;
  let edges = 0;
  let strong = 0;
  for (let i = 0; i < 4096; i++) {
    const r = 8000 * Math.sqrt(((i * 2654435761) >>> 0) / 4294967296);
    const th = i * 0.618034 * Math.PI * 2;
    g.x = r * Math.sin(th);
    g.z = r * Math.cos(th);
    gustFlat(g, U);
    const s = run.w7Gust({ x: g.x, y: g.z });
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.z)) nan++;
    worst = Math.max(worst, Math.abs(s.x - g.k), Math.abs(s.y - g.a), Math.abs(s.z - g.p));
    if (s.z > 0.05 && s.z < 0.95) edges++;
    if (s.x > 1.5) strong++;
  }
  ok(nan === 0 && worst < 1e-3 && edges > 20 && strong > 200, `w7Gust's own text, run as script, is the processor's gustFlat within 1e-3 at 4,096 points out to 8 km (worst ${worst.toExponential(2)}; ${edges} on a patch's edge, ${strong} in a strong gust)`);
  // The target turns the wind by the gust's veer the way the weather's own readers turn it (the heading plus the veer:
  // the water's wind, the rain's yaw), and scales it by k.
  let senseWorst = 0;
  for (let i = 0; i < 2000; i++) {
    const x = ((i * 37) % 400) * 9.1 - 1800;
    const z = Math.floor(i / 20) * 17.3 - 900;
    const h = i * 0.731;
    const S = 0.5 + (i % 13);
    const s = run.w7Gust({ x, y: z });
    const t = run.w7Target({ x, y: z }, { x: Math.sin(h) * S, y: Math.cos(h) * S });
    senseWorst = Math.max(senseWorst, Math.abs(t.x - Math.sin(h + s.y) * S * s.x), Math.abs(t.y - Math.cos(h + s.y) * S * s.x));
  }
  ok(senseWorst < 1e-9, `w7Target's own text turns a wind heading h to h + the veer and scales it by k, the weather's own sense (worst ${senseWorst.toExponential(2)})`);
  const onWas = run.w7On();
  uW[6].w = 0;
  const offNow = run.w7On();
  uW[6].w = 1;
  ok(onWas === true && offNow === false && run.w7Mean() === U[25], "and its arm reads the pack's on slot and its mean the pack's mean");
}

// --- the clouds' decks (the seventh wave's second half): one gust function at a deck's scale ---
{
  // `phasesNow` (what the decks read with the arm off, when nothing packs the ground's) freezes, restarts and travels the
  // phases exactly as `pack` does, at every moment across several restarts; and `packDeckNow` at a scale and share of one
  // is `pack`'s own pack to the bit, but its mean, trees' share and arm, which a deck reads none of.
  const pr = newProfile();
  Object.assign(pr, WIND_PROFILES.rain);
  const A = make();
  const B = make();
  const D = new Float32Array(PACK_FLOATS);
  const cyc = WIND_TUNE.gusts.cycle;
  const P = A as unknown as { phase: Float64Array; phaseTo: Float64Array; weight: Float64Array };
  const Q = B as unknown as { phase: Float64Array; phaseTo: Float64Array; weight: Float64Array };
  let phasesSame = true;
  let packSame = true;
  let moments = 0;
  let restarts = 0;
  let lastCycle = -1;
  for (let s = 0; s < 1200; s++) {
    const t = T0 + s * (cyc / 97);
    A.pack(ask(pr, t));
    B.arm = A.arm;
    B.now = t;
    B.phasesNow();
    const c = Math.floor(t / cyc);
    if (lastCycle >= 0 && c !== lastCycle) restarts++;
    lastCycle = c;
    for (let i = 0; i < 24; i++) if (!Object.is(P.phase[i], Q.phase[i])) phasesSame = false;
    for (let i = 0; i < 4; i++) if (!Object.is(P.phaseTo[i], Q.phaseTo[i])) phasesSame = false;
    for (let i = 0; i < 2; i++) if (!Object.is(P.weight[i], Q.weight[i])) phasesSame = false;
    A.deckScale = 1;
    A.deckShare = 1;
    A.deckGust = A.gustStrength;
    A.deckVeer = A.veer;
    A.packDeckNow(D);
    for (let i = 0; i < 25; i++) if (!Object.is(D[i], A.packOut[i])) packSame = false;
    if (D[25] !== 1 || D[26] !== 0 || D[27] !== 1) packSame = false;
    moments++;
  }
  ok(phasesSame && restarts >= 10, `phasesNow leaves the phases, their travel and their weights exactly where pack leaves them (Object.is) at ${moments} moments across ${restarts} restarts`);
  ok(packSame, "packDeckNow at a scale and a share of one is pack's own pack to the bit (its mean one, its trees' share nought and its arm on, which a deck reads none of)");
  // At a deck's own scale and share: each phase's lattice that many times larger, its travel that share of the pure travel,
  // every other number the phases' own.
  const G = 20;
  const F = 0.4;
  A.deckScale = G;
  A.deckShare = F;
  A.deckGust = 0.37;
  A.deckVeer = 0.11;
  A.packDeckNow(D);
  const L = WIND_TUNE.gusts.lattice;
  let scaled = true;
  for (let ph = 0; ph < 2; ph++) {
    const p = ph * 12;
    const sh = P.phase[p + 1];
    const ch = P.phase[p + 2];
    const la = P.phase[p + 3] / G;
    const lc = P.phase[p + 4] / G;
    const tx = P.phaseTo[ph * 2] * F;
    const tz = P.phaseTo[ph * 2 + 1] * F;
    const along = (tx * sh + tz * ch) * la + P.phase[p + 7];
    const across = (tx * ch - tz * sh) * lc + P.phase[p + 8];
    if (!Object.is(D[12 + ph * 2], Math.fround(la)) || !Object.is(D[13 + ph * 2], Math.fround(lc))) scaled = false;
    if (!Object.is(D[ph * 2], Math.fround(along - L * Math.floor(along / L))) || !Object.is(D[ph * 2 + 1], Math.fround(across - L * Math.floor(across / L)))) scaled = false;
    if (!Object.is(D[4 + ph * 2], A.packOut[4 + ph * 2]) || !Object.is(D[5 + ph * 2], A.packOut[5 + ph * 2]) || !Object.is(D[16 + ph * 2], A.packOut[16 + ph * 2])) scaled = false;
  }
  ok(scaled && D[20] === Math.fround(0.37) && D[22] === Math.fround(0.11) && Object.is(D[8], A.packOut[8]) && Object.is(D[21], A.packOut[21]), `at a deck's scale (${G}) and share (${F}) each phase's lattice is ${G} times the world's and its travel ${F} of the pure travel, its strength and veer the deck's own, every other number the phases'`);
}

// --- the frame makes nothing: `windAlloc.ts` in processes of their own, a dozen at once ---
{
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const script = fileURLToPath(new URL('./windAlloc.ts', import.meta.url));
  type M = { made: number; scavenges: number; frames: number };
  type R = { skipped?: string; still: M; moving: M; ramps: M; devils: number };
  const one = (): Promise<R> =>
    new Promise((resolve, reject) => {
      const c = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', script], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      c.stdout.on('data', (d: Buffer) => (out += d.toString()));
      c.on('close', (code) => (code === 0 ? resolve(JSON.parse(out.trim().split('\n').pop() ?? '{}') as R) : reject(new Error(`windAlloc exited ${code}`))));
    });
  const runs = await Promise.all(Array.from({ length: 12 }, one));
  if (runs[0].skipped) console.log(`note the allocation measure was skipped: ${runs[0].skipped}`);
  else {
    const per = (m: M): number => (m.scavenges > 0 ? Infinity : m.made / m.frames);
    const modes = ['still', 'moving', 'ramps'] as const;
    for (const mode of modes) {
      const each = runs.map((r) => per(r[mode]));
      const best = Math.min(...each);
      // Every one of the twelve under the line, never only the cleanest: the fault this measure exists for (W2b's) made
      // its numbers in five processes of twelve under load and none alone.
      const over = each.filter((v) => !(v < 0.05)).length;
      ok(over === 0 && runs.every((r) => r.devils > 0), `the unified wind's frame (${mode === 'still' ? 'standing still' : mode === 'moving' ? 'moving at 30 m/s' : 'through a 40 s level ramp and a 4 s area fade'}: the step, the pack, the player's wind and the devils listed and moved) makes ${best.toFixed(3)} bytes a frame at the cleanest of twelve processes run at once and under 0.05 in every one of them (${over} of 12 over the line; worst ${Math.max(...each).toFixed(3)})`);
    }
  }
}

console.log(`\n${checks} checks passed`);
