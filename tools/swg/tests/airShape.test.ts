// The dust's carried shape (the volumetrics design's §2.14 and §10 Tests; src/world/volumetrics/airMath.ts's
// `dustLawIn`, `dustShapeStep`, `shapeFloor`, `foldedProfile`, `stormWeight`, `w1StormDensity`, `liftPeakIn`): the six
// laws stepped in the field's float32 store at 30, 60, 144 and 240 frames a second from each source's own lift, alike
// with each other and with float64, where half floats drift by the rate (the control); two patches mixed by their moments;
// the folded profile a unit of column wherever its mass sits, so a unit of dust keeps the first wave's optical depth and
// a unit of storm dust at its weight keeps the first wave's storm column; a trace reading the rest shape and anything not
// a number reading nought; a falling patch falling alike at every rate through the floor the pass writes through, where
// held at nought it would not fall (the control); the closed-form peak against the stepped one; and the arcs a speeder's,
// a racing bike's and a racing pod's dust make, its throw held at the demo's speeder's top speed, read off the forces'
// own frame walk. Arithmetic only, never a look.
//
// Plain type stripping; synthetic numbers only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { dustLawIn, dustShapeStep, foldedProfile, HALF_NORMAL, liftPeakIn, newDustLaw, newLiftPeak, shapeFloor, stormDensity, stormHeightAt, stormSigma, stormWeight, w1StormDensity, type ShapeTexel } from '../../../src/world/volumetrics/airMath.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import { AirForces } from '../../../src/world/volumetrics/airForces.ts';
import { AirRaster, type GroundSample } from '../../../src/world/volumetrics/airRaster.ts';
import { newWindow, placeWindow } from '../../../src/world/volumetrics/fluidWindow.ts';
import { REPO } from './airTrees.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const D = AIR_TUNE.dust;
const H0 = D.height;

/** A half float as research2 §5.1 found this machine's store does it: truncated toward nought. */
const f32h = new Float32Array(1);
const u32h = new Uint32Array(f32h.buffer);
const half = (x: number): number => {
  f32h[0] = x;
  const b = u32h[0];
  const sign = b & 0x80000000 ? -1 : 1;
  const exp = ((b >>> 23) & 0xff) - 127 + 15;
  if (exp >= 31) return sign * 65504;
  if (exp <= 0) {
    if (exp < -10) return sign * 0;
    const m = ((b & 0x7fffff) | 0x800000) >>> (14 - exp);
    return sign * m * 2 ** -24;
  }
  return sign * (1 + ((b & 0x7fffff) >>> 13) / 1024) * 2 ** (exp - 15);
};

/** One patch's shape read back: its mean height, spread, rise and age. */
interface Shape {
  mu: number;
  sigma: number;
  w: number;
  age: number;
}
const read = (t: ShapeTexel): Shape => {
  const mu = t.r / t.d;
  return { mu, sigma: Math.sqrt(Math.max(t.g / t.d - mu * mu, 0)), w: t.b / t.d, age: t.a / t.d };
};
/**
 * A patch laid at (μ₀, σ₀, w₀) and stepped by the six laws at `fps`, the pass's floor applied (`shapeFloor`) and every
 * channel put through `store` after each frame, read back at `times` seconds. `holdB` holds D·w at nought each frame (the
 * control: the floor written over every channel).
 */
const run = (mu0: number, sigma0: number, w0: number, fps: number, times: number[], store: (x: number) => number, holdB = false): Shape[] => {
  const law = newDustLaw();
  law.dt = 1 / fps;
  dustLawIn(law);
  const t: ShapeTexel = { d: 1, r: mu0, g: sigma0 * sigma0 + mu0 * mu0, b: w0, a: 0 };
  const out: Shape[] = [];
  let frame = 0;
  for (const at of times) {
    const until = Math.round(at * fps);
    for (; frame < until; frame++) {
      dustShapeStep(t, law);
      shapeFloor(t);
      if (holdB && t.b < 0) t.b = 0;
      t.r = store(t.r);
      t.g = store(t.g);
      t.b = store(t.b);
      t.a = store(t.a);
    }
    out.push(read(t));
  }
  return out;
};

// --- the six laws, alike at every rate in float32 and float64 ---
{
  const sources: { name: string; mu: number; sigma: number; w: number }[] = [
    { name: "a speeder's spread at 18 m/s", mu: AIR_TUNE.engine.spreadAt, sigma: AIR_TUNE.engine.spreadSigma, w: AIR_TUNE.engine.spreadRise * (1.7 + 0.24 * 18) },
    { name: "a hovering ship's impact", mu: AIR_TUNE.engine.impactAt, sigma: AIR_TUNE.engine.impactSigma, w: AIR_TUNE.engine.impactRise * 25 },
    { name: "a thermal detonator's blast", mu: AIR_TUNE.blast.liftAt, sigma: AIR_TUNE.blast.liftSigma, w: AIR_TUNE.blast.liftRise },
    { name: "a push's band", mu: AIR_TUNE.force.dustLow, sigma: AIR_TUNE.force.dustSpread, w: AIR_TUNE.force.dustKick },
    { name: "a repulse's ring", mu: AIR_TUNE.force.dustLow, sigma: AIR_TUNE.force.repulseSpread, w: AIR_TUNE.force.repulseKick },
    { name: "the storm's shed", mu: 0, sigma: stormSigma(1), w: 0 },
  ];
  const times = [0.5, 1, 2, 10];
  for (const s of sources) {
    const exact = run(s.mu, s.sigma, s.w, 240, times, (x) => x);
    let alike = true;
    let worst = 0;
    for (const fps of [30, 60, 144, 240]) {
      for (const store of [(x: number) => x, Math.fround]) {
        const got = run(s.mu, s.sigma, s.w, fps, times, store);
        for (let i = 0; i < times.length; i++) {
          const a = got[i];
          const b = exact[i];
          // Rising and falling the mean is held to half a per cent; once it has landed it hovers a few millimetres over
          // the ground by a step's own fall, which is held in metres.
          const muOk = Math.abs(a.mu - b.mu) <= 0.005 * Math.abs(b.mu) + (b.mu < 0.05 ? 0.02 : 1e-6);
          const rel = (x: number, y: number) => Math.abs(x - y) / Math.max(Math.abs(y), 1e-3);
          worst = Math.max(worst, b.mu >= 0.05 ? rel(a.mu, b.mu) : 0, rel(a.sigma, b.sigma), rel(a.age, b.age));
          if (!muOk || rel(a.sigma, b.sigma) > 0.005 || rel(a.age, b.age) > 0.005 || Math.abs(a.w - b.w) > 0.005 * Math.abs(b.w) + 0.02) alike = false;
        }
      }
    }
    ok(alike, `${s.name}: μ, σ, w and age at 0.5, 1, 2 and 10 s are alike at 30, 60, 144 and 240 frames a second, in float64 and in the field's float32 (worst ${(worst * 100).toFixed(3)}%; μ ${exact.map((x) => x.mu.toFixed(2)).join(', ')} m)`);
  }
  // The control: the same patches stored as half floats drift by the frame rate.
  const s = sources[0];
  const at30 = run(s.mu, s.sigma, s.w, 30, [2], half)[0];
  const at240 = run(s.mu, s.sigma, s.w, 240, [2], half)[0];
  const f240 = run(s.mu, s.sigma, s.w, 240, [2], Math.fround)[0];
  ok(Math.abs(at30.mu - at240.mu) / f240.mu > 0.01, `stored as half floats a speeder's dust stands at ${at30.mu.toFixed(3)} m at 30 frames a second and ${at240.mu.toFixed(3)} m at 240 after 2 s, where float32 holds ${f240.mu.toFixed(3)} (the control: why the pair is float32)`);
}

// --- two patches mixed by their moments ---
{
  const a = { D: 0.6, mu: 0.5, sigma: 0.3 };
  const b = { D: 0.4, mu: 4, sigma: 1.2 };
  const t: ShapeTexel = { d: a.D + b.D, r: a.D * a.mu + b.D * b.mu, g: a.D * (a.sigma ** 2 + a.mu ** 2) + b.D * (b.sigma ** 2 + b.mu ** 2), b: 0, a: 0 };
  const got = read(t);
  // The mixture's own mean and spread, numerically, of the unfolded sum.
  let m0 = 0;
  let m1 = 0;
  let m2 = 0;
  for (let y = -10; y <= 15; y += 0.001) {
    const p = a.D * Math.exp(-((y - a.mu) ** 2) / (2 * a.sigma ** 2)) / (a.sigma * Math.sqrt(2 * Math.PI)) + b.D * Math.exp(-((y - b.mu) ** 2) / (2 * b.sigma ** 2)) / (b.sigma * Math.sqrt(2 * Math.PI));
    m0 += p * 0.001;
    m1 += p * y * 0.001;
    m2 += p * y * y * 0.001;
  }
  const mean = m1 / m0;
  const spread = Math.sqrt(m2 / m0 - mean * mean);
  ok(Math.abs(got.mu - mean) < 1e-4 && Math.abs(got.sigma - spread) < 1e-4, `two patches at 0.5 m and 4 m mixed premultiplied become one at ${got.mu.toFixed(3)} ± ${got.sigma.toFixed(3)} m: the mixture's own mean and spread (${mean.toFixed(3)} ± ${spread.toFixed(3)})`);
}

// --- the folded profile: a unit of column wherever its mass sits ---
{
  let unit = true;
  for (const sigma of [0.15, 0.5, 2.256, 6]) {
    for (const k of [0, 0.5, 1, 2, 5]) {
      const mu = k * sigma;
      let s = 0;
      const h = sigma / 400;
      for (let y = h / 2; y < mu + 12 * sigma; y += h) s += foldedProfile(y, mu, sigma) * h;
      if (Math.abs(s - 1) > 1e-4) unit = false;
    }
  }
  ok(unit, 'the folded profile integrates to one over the ground and above it, for μ from nought to five of its spreads');
  ok(foldedProfile(-0.01, 1, 0.5) === 0 && Number.isFinite(foldedProfile(0, 0, 0)), 'nought under the ground, finite at a spread of nought');
  const column = D.extinction * 1 * H0 * 1;
  ok(Math.abs(column - 0.55 * 1.8) < 1e-12, `so a unit of dust's column optical depth is the first wave's, 0.55 · 1.8 = ${column.toFixed(3)}, whatever its height`);
  // A unit of storm dust read back at its weight: the first wave's storm column, at a calm, a half and a full storm.
  let storm = true;
  const ratios: string[] = [];
  for (const level of [0, 0.5, 1]) {
    let now = 0;
    let w1 = 0;
    const h = 0.002;
    for (let y = h / 2; y < 200; y += h) {
      now += stormDensity(1, y, level) * h;
      w1 += w1StormDensity(1, y, level) * h;
    }
    // The first wave's column of a unit of its own (unweighted) storm dust: 0.55 · H(storm); read at its weight here.
    const want = (D.extinction * stormHeightAt(level) * H0) / stormHeightAt(level);
    if (Math.abs(now - w1) / w1 > 2e-3 || Math.abs(w1 - want) / want > 2e-3) storm = false;
    ratios.push(`${(stormDensity(1, 1.5, level) / w1StormDensity(1, 1.5, level)).toFixed(2)}`);
  }
  ok(storm, `a unit of storm dust read back at its weight (H(storm) / H₀: ${[0, 0.5, 1].map((l) => stormWeight(l).toFixed(2)).join(', ')}) keeps the first wave's storm column at a calm, a half and a full storm`);
  ok(Math.abs(Number(ratios[2]) - 0.72) < 0.02 && Math.abs(Number(ratios[1]) - 0.78) < 0.02 && Math.abs(Number(ratios[0]) - 1.17) < 0.02, `its density at eye height (1.5 m) is ${ratios.join(', ')} of the first wave's at a calm, a half and a full storm, by the shapes' own difference (the design's 1.17, 0.78 and 0.72)`);
  ok(Math.abs(stormSigma(0) - HALF_NORMAL * 1.8) < 1e-12 && Math.abs(stormSigma(1) - HALF_NORMAL * D.stormHeight) < 1e-12, "the storm's dust stands as the half-normal of its own mean height: 2.26 m calm, 15 m in a full storm");
  // And w1StormDensity is the first wave's own march line: read out of the volume at the second wave's commit.
  let w1Line = '';
  let w1Inflow = '';
  try {
    w1Line = execFileSync('git', ['show', '6f5b0ef:src/core/fx/airVolume.ts'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 });
    w1Inflow = execFileSync('git', ['show', '6f5b0ef:src/world/volumetrics/airField.ts'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch {
    /* said below */
  }
  ok(w1Line.includes('float dens = max(d.a, 0.0) * exp(-hy / max(uInflow.y, 1e-3)) * uExtinction * uAmount;') && w1Inflow.includes('this.inflow.value.set(nu.inflowDust, nu.dustHeight);'), "w1StormDensity is the first wave's own line (dust · exp(−h / H(storm)) · extinction, its H the storm's own height, read out of the volume and the field at the second wave's commit, 6f5b0ef)");
  const H = stormHeightAt(1);
  ok(Math.abs(w1StormDensity(2, 3, 1) - (2 / stormWeight(1)) * Math.exp(-3 / H) * D.extinction) < 1e-12, 'over the first wave\'s own density, which is this wave\'s read back less the weight');
}

// --- a trace reads the rest shape; anything not a number reads nought ---
{
  const law = newDustLaw();
  law.dt = 1 / 60;
  dustLawIn(law);
  const trace: ShapeTexel = { d: 5e-6, r: 3, g: 9, b: 2, a: 7 };
  const rest: ShapeTexel = { d: 5e-6, r: 0, g: 5e-6 * law.min2, b: 0, a: 0 };
  dustShapeStep(trace, law);
  dustShapeStep(rest, law);
  ok(trace.r === rest.r && trace.g === rest.g && trace.b === rest.b && trace.a === rest.a, 'a density under 1e-5 reads the rest shape (on the ground, at its least spread, still, new), whatever it carried');
  let finite = true;
  for (const bad of [Number.NaN, Infinity, -Infinity]) {
    const t: ShapeTexel = { d: 1, r: bad, g: 1, b: bad, a: bad };
    dustShapeStep(t, law);
    shapeFloor(t);
    if (![t.d, t.r, t.g, t.b, t.a].every(Number.isFinite)) finite = false;
  }
  ok(finite, 'NaN and infinite channels in give finite channels out through the pass\'s floor');
}

// --- a falling patch falls alike at every rate; held at nought it would not fall ---
{
  const times = [0.5, 1, 1.5];
  const ref = run(3, 0.5, -0.4, 240, times, Math.fround);
  let alike = true;
  for (const fps of [30, 60, 144]) {
    const got = run(3, 0.5, -0.4, fps, times, Math.fround);
    for (let i = 0; i < times.length; i++) if (Math.abs(got[i].mu - ref[i].mu) > 0.005 * ref[i].mu || Math.abs(got[i].w - ref[i].w) > 0.005 * Math.abs(ref[i].w) + 1e-4) alike = false;
  }
  ok(alike && ref[2].mu < 3 - 0.5 && ref[2].w < -0.2, `a patch at 3 m falling at 0.4 m/s, through the floor the pass writes through (every channel but D·w), falls alike at 30, 60, 144 and 240 frames a second (to ${ref[2].mu.toFixed(3)} m at 1.5 s, falling at ${(-ref[2].w).toFixed(3)} m/s)`);
  const held60 = run(3, 0.5, -0.4, 60, [1.5], Math.fround, true)[0];
  const held240 = run(3, 0.5, -0.4, 240, [1.5], Math.fround, true)[0];
  ok(held60.mu > ref[2].mu + 0.4 && held240.mu > held60.mu, `held at nought each frame it would hardly fall (${held60.mu.toFixed(3)} m at 60 frames, ${held240.mu.toFixed(3)} m at 240: by an amount that hangs on the rate) -- the control, and why the floor never touches D·w`);
}

// --- the closed-form peak against the stepped one, and the arcs a machine's dust makes ---
{
  const lp = newLiftPeak();
  let closed = true;
  for (const [mu0, sigma0, w0] of [
    [0.3, 0.25, 3.01],
    [0.3, 0.3, 3.75],
    [0.5, 0.5, 6],
    [0.2, 0.2, 1.5],
  ]) {
    lp.mu0 = mu0;
    lp.sigma0 = sigma0;
    lp.w0 = w0;
    liftPeakIn(lp);
    const fps = 2000;
    const law = newDustLaw();
    law.dt = 1 / fps;
    dustLawIn(law);
    const t: ShapeTexel = { d: 1, r: mu0, g: sigma0 * sigma0 + mu0 * mu0, b: w0, a: 0 };
    let best = mu0;
    let when = 0;
    let bestSigma = sigma0;
    for (let i = 1; i <= fps * 10; i++) {
      dustShapeStep(t, law);
      const s = read(t);
      if (s.mu > best) {
        best = s.mu;
        when = i / fps;
        bestSigma = s.sigma;
      }
    }
    if (Math.abs(best - lp.mu) > 2e-3 || Math.abs(when - lp.t) > 2e-3 || Math.abs(bestSigma - lp.sigma) > 2e-3 || Math.abs(lp.top - (lp.mu + AIR_TUNE.volume.bandSigmas * lp.sigma)) > 1e-12) closed = false;
  }
  ok(closed, "the closed-form peak (when, how high, how thick, and the band's top over it) is the stepped one's");

  // A skimming jet's throw read off the forces' own frame walk at a machine's speed, its peak worked out from it.
  const flat = { sample: (_x: number, _z: number, out: GroundSample) => ((out.h = 0), (out.family = 1), (out.medium = 1), true) };
  const throwAt = (speed: number): number => {
    const f = new AirForces();
    f.active = true;
    const w = newWindow();
    placeWindow(w, 0, 0, AIR_TUNE.window.size, 128, AIR_TUNE.window.jump);
    const r = new AirRaster();
    r.resize(128);
    r.familyResponse = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255]);
    r.familyColour = new Uint8Array([0, 0, 0, 0, 200, 170, 120, 255]);
    r.fillAll(flat, w.ox, w.oz, w.cell);
    f.window = w;
    f.raster = r;
    // A nozzle a third of a metre over sand, level, running at the machine's speed: its bite whole.
    f.engine(0, 0.3, 0, 0, 0, 1, 28, 0, speed);
    f.frameDt = 1 / 60;
    f.frameSources();
    return f.engineDust[6];
  };
  const peakOf = (w0: number): { mu: number; t: number } => {
    lp.mu0 = AIR_TUNE.engine.spreadAt;
    lp.sigma0 = AIR_TUNE.engine.spreadSigma;
    lp.w0 = w0;
    liftPeakIn(lp);
    return { mu: lp.mu, t: lp.t };
  };
  const speeder = peakOf(throwAt(18));
  const bike = peakOf(throwAt(97));
  const pod = peakOf(throwAt(167));
  ok(Math.abs(throwAt(18) - 0.5 * (1.7 + 0.24 * 18)) < 1e-9 && Math.abs(speeder.mu - 2.15) < 0.02 && Math.abs(speeder.t - 1.77) < 0.02, `a speeder at 18 m/s throws its dust up at ${throwAt(18).toFixed(2)} m/s: it peaks ${speeder.mu.toFixed(2)} m up ${speeder.t.toFixed(2)} s on (the design's 2.15 m at 1.77 s)`);
  ok(Math.abs(bike.mu - 3.3) < 0.05 && Math.abs(pod.mu - 3.3) < 0.05 && Math.abs(pod.t - 2.1) < 0.05 && throwAt(97) === throwAt(167), `a race-mode bike at 97 m/s and a pod at 167 throw it at the held 30 m/s's ${throwAt(167).toFixed(2)} m/s: ${bike.mu.toFixed(2)} and ${pod.mu.toFixed(2)} m at ${pod.t.toFixed(2)} s, a little over a metre taller than the speeder's arc`);
  const unheld = (speed: number) => peakOf(AIR_TUNE.engine.spreadRise * (1.7 + 0.24 * speed));
  ok(Math.abs(unheld(167).mu - 17.6) < 0.1 && Math.abs(unheld(97).mu - 10.2) < 0.1, `unheld they would peak at ${unheld(97).mu.toFixed(1)} m and ${unheld(167).mu.toFixed(1)} m, a wall along the racing line (as arithmetic, never a look)`);
}

console.log(`\n${checks} checks passed`);
void join;
