// The air's twin (the GPU port's pass 2, wave 1, `src/sky/air/airTwin.ts`), the game's own code under node:
//   - the optical depth against its closed form (an exponential air and ozone's tent, summed to the top straight up);
//   - the twin's small tables against the reference sums (the same equations summed far finer, with no table at all for
//     the light's transmittance) at set sun heights: the transmittance to the sun, the sky's radiance in four directions
//     and the hemisphere's light, each within the tolerance stated beside it;
//   - a clear Tatooine noon lights the world at today's key light there (2.4 times the row's scale on its colour, 1.903),
//     through the lighting fields as the world turns them into lights;
//   - the sun reddens and dims as it sets, until the planet's own horizon hides it;
//   - the lighting fields' arithmetic (the bounce the world mixes toward the sky comes out the ground's own; the steer at
//     nought leaves the air's alone and at one hands SWG's back), and its units held to `world.ts`'s own numbers;
//   - nothing allocated by a frame of the twin, steady or summing, in twelve fresh processes (`--alloc`).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { F, LUMA_B, LUMA_G, LUMA_R, setVisibility, worldRecord, newAirRecord, EARTH } from '../../../src/sky/air/airParams.ts';
import {
  AIR_LIGHT,
  AirLights,
  AirTwin,
  AirTwinOut,
  IN,
  DEPTH_FLOATS,
  HEMI_DIRS,
  HEMI_RAYS,
  HEMI_WEIGHTS,
  MOON_SHARE,
  PSI_FLOATS,
  TATOOINE_NOON_ELEVATION,
  buildDepthTable,
  buildPsiTable,
  hitsGround,
  lightTransmittance,
  miePhase,
  opticalDepth,
  psiOf,
  rayLength,
  rayleighPhase,
  sceneUnits,
  TODAY_NOON_KEY,
  sphereDirections,
  steerGain,
  writeTwinLighting,
} from '../../../src/sky/air/airTwin.ts';
import { horizonDip } from '../../../src/sky/air/airApi.ts';

const ALLOC = process.argv.includes('--alloc');
let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  if (!ALLOC) console.log(`ok   ${msg}`);
};
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);
const lum = (r: number, g: number, b: number): number => LUMA_R * r + LUMA_G * g + LUMA_B * b;
const DEG = Math.PI / 180;

/** Tatooine's clear record at the dials' start, its world's column densities and multiple scattering (the twin's own build). */
function tatooine(vis = 40): { rec: Float64Array; depth: Float64Array; psi: Float64Array } {
  const rec = worldRecord('tatooine');
  setVisibility(rec, vis);
  const depth = new Float64Array(DEPTH_FLOATS);
  buildDepthTable(rec, depth);
  const psi = new Float64Array(PSI_FLOATS);
  buildPsiTable(rec, depth, psi);
  return { rec, depth, psi };
}

if (!ALLOC) {
  // ---------------------------------------------------------------- the closed form
  {
    const rec = newAirRecord();
    setVisibility(rec, 40);
    const out = new Float64Array(3);
    opticalDepth(rec, rec[F.bottom], 1, 4000, out, 0);
    const span = rec[F.top] - rec[F.bottom];
    const ray = rec[F.rayH] * (1 - Math.exp(-span / rec[F.rayH]));
    const mie = rec[F.mieH] * (1 - Math.exp(-span / rec[F.mieH]));
    // Ozone's tent, 15 km either side of 25 km, lies wholly inside the air: its area is its half width.
    const oz = rec[F.ozW];
    const want = [rec[F.rayR] * ray + (rec[F.mieS] + rec[F.mieA]) * mie + rec[F.ozR] * oz, rec[F.rayG] * ray + (rec[F.mieS] + rec[F.mieA]) * mie + rec[F.ozG] * oz, rec[F.rayB] * ray + (rec[F.mieS] + rec[F.mieA]) * mie + rec[F.ozB] * oz];
    // The midpoint rule's own error at 4,000 steps over the Mie's 1.2 km height is (dt / H)² / 24, about 2e-5.
    ok(out.every((v, i) => rel(v, want[i]) < 1e-4), `the optical depth straight up is its closed form to 1e-4 (${[...out].map((v) => v.toFixed(5))} against ${want.map((v) => v.toFixed(5))})`);
    ok(Math.abs(want[1] - (EARTH.rayleigh[1] * 8 + (3.912 / 40 - EARTH.rayleigh[1]) * 1.2 + EARTH.ozone[1] * 15)) < 1e-4, "and that form is Hillaire's Earth with 40 km of visibility's haze (0.2376 in the green)");
  }

  // ---------------------------------------------------------------- the reference sums
  const T = tatooine();
  const REF_STEPS = 2000;
  // The twin's transmittance (its table) against the direct sum, at set heights of the sun.
  {
    const r = T.rec[F.bottom] + 0.01;
    const got = new Float64Array(3);
    const ref = new Float64Array(3);
    let worst = 0;
    const rows: string[] = [];
    for (const el of [90, 67.5, 45, 20, 10, 5, 2, 0.5]) {
      const mu = Math.sin(el * DEG);
      lightTransmittance(T.rec, T.depth, r, mu, got, 0);
      opticalDepth(T.rec, r, mu, REF_STEPS, ref, 0);
      const e = Math.max(...[0, 1, 2].map((k) => rel(got[k], Math.exp(-ref[k]))));
      worst = Math.max(worst, e);
      rows.push(`${el}°:${(e * 100).toFixed(2)}%`);
    }
    // The card's own size and step count (256 by 64, 40 squared steps): the error grows toward the horizon, where the depth
    // turns fastest with the angle.
    ok(worst < 0.03, `the transmittance to the sun from the twin's 256 by 64 table is the reference sum's within 3% from the zenith to half a degree up (${rows.join(' ')})`);
  }

  /**
   * The reference sky: the same single and multiple scattering summed far finer -- the light's transmittance marched
   * straight at every sample (no table), the multiple scattering from a dense table (64 by 32, 128 directions of 48 steps,
   * its own transmittances marched straight), 600 steps along the view.
   */
  const refPsiW = 64;
  const refPsiH = 32;
  const refPsi = new Float64Array(refPsiW * refPsiH * 3);
  {
    // A dense column-density table stands in for the marched transmittance inside the dense multiple scattering alone.
    const dense = new Float64Array(DEPTH_FLOATS);
    buildDepthTable(T.rec, dense, 400);
    const dirs = new Float64Array(128 * 3);
    sphereDirections(128, dirs);
    const tmp = new Float64Array(3);
    for (let j = 0; j < refPsiH; j++)
      for (let i = 0; i < refPsiW; i++) {
        const muS = (i / (refPsiW - 1)) * 2 - 1;
        const rr = Math.min(T.rec[F.bottom] + (j / (refPsiH - 1)) * (T.rec[F.top] - T.rec[F.bottom]) + 0.001, T.rec[F.top] - 0.001);
        psiOf(T.rec, dense, rr, muS, dirs, 128, 48, tmp, 0);
        refPsi.set(tmp, (j * refPsiW + i) * 3);
      }
  }
  const refPsiAt = (r: number, muS: number, out: Float64Array): void => {
    const x = Math.min(refPsiW - 1, Math.max(0, (0.5 + 0.5 * muS) * (refPsiW - 1)));
    const y = Math.min(refPsiH - 1, Math.max(0, ((r - T.rec[F.bottom]) / (T.rec[F.top] - T.rec[F.bottom])) * (refPsiH - 1)));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(refPsiW - 1, x0 + 1);
    const y1 = Math.min(refPsiH - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    for (let k = 0; k < 3; k++) {
      const a = refPsi[(y0 * refPsiW + x0) * 3 + k] * (1 - fx) + refPsi[(y0 * refPsiW + x1) * 3 + k] * fx;
      const b = refPsi[(y1 * refPsiW + x0) * 3 + k] * (1 - fx) + refPsi[(y1 * refPsiW + x1) * 3 + k] * fx;
      out[k] = a * (1 - fy) + b * fy;
    }
  };
  /** The reference radiance from the surface toward (dx, dy, dz) with one light of unit illuminance from (sx, sy, 0). */
  const refRadiance = (dx: number, dy: number, dz: number, sx: number, sy: number, out: Float64Array): void => {
    const rec = T.rec;
    const r = rec[F.bottom] + 0.01;
    const len = rayLength(r, dy, rec[F.bottom], rec[F.top]);
    const N = 600;
    const c = dx * sx + dy * sy;
    const pR = rayleighPhase(c);
    const pM = miePhase(c, rec[F.mieG]);
    const tr = new Float64Array(3);
    const ps = new Float64Array(3);
    let L = [0, 0, 0];
    let Tv = [1, 1, 1];
    let prev = 0;
    for (let i = 0; i < N; i++) {
      const u = (i + 1) / N;
      const e = len * u * u;
      const dt = e - prev;
      const t = prev + dt / 2;
      prev = e;
      const px = t * dx;
      const py = r + t * dy;
      const pz = t * dz;
      const rr = Math.sqrt(px * px + py * py + pz * pz);
      const h = Math.max(0, rr - rec[F.bottom]);
      const dR = Math.exp(-h / rec[F.rayH]);
      const dM = Math.exp(-h / rec[F.mieH]);
      const dO = Math.max(0, 1 - Math.abs(h - rec[F.ozC]) / rec[F.ozW]);
      const muL = (px * sx + py * sy) / rr;
      let lt = [0, 0, 0];
      if (!hitsGround(rr, muL, rec[F.bottom])) {
        opticalDepth(rec, rr, muL, 200, tr, 0);
        lt = [Math.exp(-tr[0]), Math.exp(-tr[1]), Math.exp(-tr[2])];
      }
      refPsiAt(rr, muL, ps);
      const sR = [rec[F.rayR] * dR, rec[F.rayG] * dR, rec[F.rayB] * dR];
      const sM = rec[F.mieS] * dM;
      const ext = [sR[0] + (rec[F.mieS] + rec[F.mieA]) * dM + rec[F.ozR] * dO, sR[1] + (rec[F.mieS] + rec[F.mieA]) * dM + rec[F.ozG] * dO, sR[2] + (rec[F.mieS] + rec[F.mieA]) * dM + rec[F.ozB] * dO];
      L = L.map((v, k) => v + Tv[k] * (lt[k] * (sR[k] * pR + sM * pM) + ps[k] * (sR[k] + sM)) * ((1 - Math.exp(-ext[k] * dt)) / ext[k]));
      Tv = Tv.map((v, k) => v * Math.exp(-ext[k] * dt));
    }
    out[0] = L[0];
    out[1] = L[1];
    out[2] = L[2];
  };

  const twin = new AirTwin();
  twin.useDepth(T.depth);
  twin.useRecord(T.rec, T.psi);
  twin.sunTop.fill(1);
  const got = new Float64Array(3);
  const ref = new Float64Array(3);
  {
    const rows: string[] = [];
    let worst = 0;
    for (const el of [60, 20, 5, -2]) {
      const sx = Math.cos(el * DEG);
      const sy = Math.sin(el * DEG);
      inputs(twin, sx, sy, 0, 0, -1, 0, 0, -1, 0, false, 0.01);
      twin.lightsIn();
      for (const [name, d] of [
        ['zenith', [0, 1, 0]],
        ['45° up, a quarter turn', [0, Math.SQRT1_2, Math.SQRT1_2]],
        ['5° up toward the sun', [Math.cos(5 * DEG), Math.sin(5 * DEG), 0]],
        ['5° up away from it', [-Math.cos(5 * DEG), Math.sin(5 * DEG), 0]],
      ] as [string, number[]][]) {
        twin.radianceIn(d[0], d[1], d[2], 0.01, 24, got);
        refRadiance(d[0], d[1], d[2], sx, sy, ref);
        const e = Math.abs(lum(got[0], got[1], got[2]) - lum(ref[0], ref[1], ref[2])) / lum(ref[0], ref[1], ref[2]);
        worst = Math.max(worst, e);
        rows.push(`${el}° ${name}: ${(e * 100).toFixed(1)}%`);
      }
    }
    console.log(`     ${rows.join('; ')}`);
    ok(worst < 0.06, `the twin's sky radiance (24 steps, its two small tables) is the reference sum's within 6% in luminance in four directions at the sun 60, 20, 5 and -2 degrees up (worst ${(worst * 100).toFixed(1)}%)`);
  }
  {
    // The hemisphere's light: the twin's quadrature (28 rays of 12 steps) against the reference radiance summed over
    // 16 rings by 33 azimuths.
    const rows: string[] = [];
    let worst = 0;
    for (const el of [60, 20, 5]) {
      const sx = Math.cos(el * DEG);
      const sy = Math.sin(el * DEG);
      inputs(twin, sx, sy, 0, -sx, -sy, 0, 0, -1, 0, false, 0.01);
      twin.frame();
      // A frame sums a slice; the proof asks the sums whole.
      twin.sumNow();
      const e = twin.out.skyUp;
      let er = 0;
      const R = 16;
      const A = 33;
      for (let i = 0; i < R; i++) {
        const mu = (i + 0.5) / R;
        const s = Math.sqrt(1 - mu * mu);
        for (let j = 0; j < A; j++) {
          const phi = (j / (A - 1)) * Math.PI;
          const w = (j === 0 || j === A - 1 ? 0.5 : 1) * (Math.PI / (A - 1)) * 2 * (mu / R);
          refRadiance(Math.cos(phi) * s, mu, Math.sin(phi) * s, sx, sy, ref);
          er += lum(ref[0], ref[1], ref[2]) * w;
        }
      }
      const d = Math.abs(lum(e[0], e[1], e[2]) - er) / er;
      worst = Math.max(worst, d);
      rows.push(`${el}°: ${(d * 100).toFixed(1)}%`);
    }
    ok(worst < 0.06, `the hemisphere's light from the twin's 28 rays is the reference's 528 rays' within 6% (${rows.join(' ')})`);
  }
  {
    // Every hemisphere ray's weights sum to the cosine-weighted hemisphere's π.
    let w = 0;
    for (let k = 0; k < HEMI_RAYS; k++) w += HEMI_WEIGHTS[k];
    ok(Math.abs(w - Math.PI) < 1e-9 && HEMI_DIRS.length === HEMI_RAYS * 3, `the hemisphere's ${HEMI_RAYS} rays weigh π in all, a sky of one radiance giving π times it`);
  }

  // ---------------------------------------------------------------- Tatooine's noon at today's key light
  {
    // Today's key light there, as the world makes it from SWG's ramps (the review's and the measurer's read of the running
    // base: an intensity of 2.775, SWG_MAIN_LIGHT 2.4 times the clear noon row's scale, on a colour of luminance 0.686).
    ok(TODAY_NOON_KEY === 1.903 && Math.abs(2.4 * 1.15625 * 0.686 - TODAY_NOON_KEY) < 2e-3, `today's clear Tatooine noon key light is 2.4 × the row's scale on its colour (${TODAY_NOON_KEY}), never the bare 2.4 the first cut matched (a quarter over it)`);
    const K = sceneUnits();
    const tw = new AirTwin();
    tw.useDepth(T.depth);
    tw.useRecord(T.rec, T.psi);
    for (let k = 0; k < 3; k++) {
      tw.sunTop[k] = T.rec[F.sunR + k] * T.rec[F.sunStrength] * K;
      tw.moonTop[k] = tw.sunTop[k] * MOON_SHARE;
    }
    const e = TATOOINE_NOON_ELEVATION;
    inputs(tw, Math.cos(e), Math.sin(e), 0, -Math.cos(e), -Math.sin(e), 0, 0, -1, 0, false, 0.01);
    tw.frame();
    const L = lighting();
    writeTwinLighting(tw.out, lighting(), L);
    const intensity = AIR_LIGHT.main * L.mainScale;
    const lit = intensity * lum(L.main.r, L.main.g, L.main.b);
    ok(Math.abs(lit - TODAY_NOON_KEY) < TODAY_NOON_KEY * 0.01, `a clear Tatooine noon (67.5 degrees up, 40 km of visibility) lights the world at today's key light ${TODAY_NOON_KEY} (${lit.toFixed(4)}: the sun's intensity ${intensity.toFixed(4)} on a colour of luminance ${lum(L.main.r, L.main.g, L.main.b).toFixed(4)})`);
    const amb = AIR_LIGHT.ambient * L.ambientScale;
    ok(amb > 0.1 && amb < 1.2, `and the hemisphere above lights it at ${amb.toFixed(3)} (${((amb / lit) * 100).toFixed(0)}% of the sun: a clear sky's share), no light added`);
  }

  // ---------------------------------------------------------------- a sunset reddens until the land hides the sun
  {
    const r = T.rec[F.bottom] + 0.01;
    const dip = horizonDip(r, T.rec[F.bottom]);
    const t = new Float64Array(3);
    let lastL = Infinity;
    let lastRB = 0;
    let fine = true;
    const rows: string[] = [];
    for (let el = 20; el > -dip / DEG; el -= 0.5) {
      lightTransmittance(T.rec, T.depth, r, Math.sin(el * DEG), t, 0);
      const l = lum(t[0], t[1], t[2]);
      const rb = t[0] / Math.max(t[2], 1e-30);
      if (!(l < lastL) || !(rb > lastRB)) fine = false;
      if (Math.abs(el - Math.round(el / 5) * 5) < 0.01) rows.push(`${el}°: lum ${l.toExponential(2)} red/blue ${rb.toFixed(1)}`);
      lastL = l;
      lastRB = rb;
    }
    ok(fine, `as the sun sets from 20 degrees to the planet's own horizon (${(dip / DEG).toFixed(2)} below the eye's level at 10 m) its light only dims and only reddens (${rows.join('; ')})`);
    lightTransmittance(T.rec, T.depth, r, Math.sin(-dip - 0.002), t, 0);
    ok(t[0] === 0 && t[1] === 0 && t[2] === 0, 'and past the horizon the planet hides it: no light at all');
  }

  // ---------------------------------------------------------------- the lighting fields
  {
    const out = new AirTwinOut();
    out.sunHere.set([2, 1.8, 1.5]);
    out.skyUp.set([0.3, 0.35, 0.45]);
    out.groundDown.set([0.5, 0.45, 0.35]);
    out.horizon.set([0.2, 0.22, 0.25]);
    out.sun2Here.set([0.4, 0.3, 0.2]);
    out.fogDensity = 1.9778 / 40000;
    const swg = lighting();
    swg.main.r = 9;
    swg.mainScale = 9;
    const L = lighting();
    writeTwinLighting(out, swg, L);
    const main = [L.main.r * L.mainScale * AIR_LIGHT.main, L.main.g * L.mainScale * AIR_LIGHT.main, L.main.b * L.mainScale * AIR_LIGHT.main];
    ok(main.every((v, i) => Math.abs(v - out.sunHere[i]) < 1e-12), "the main light the world makes (2.4 × mainScale × main) is the sun's light through the air exactly, SWG's ignored at steer 0");
    // The world's hemisphere: color = ambient × ambientScale, groundColor = (bounce × bounceScale) mixed 0.35 toward it.
    const sky = [L.ambient.r * L.ambientScale, L.ambient.g * L.ambientScale, L.ambient.b * L.ambientScale];
    const ground = [0, 1, 2].map((k) => [L.bounce.r, L.bounce.g, L.bounce.b][k] * L.bounceScale * (1 - AIR_LIGHT.bounceToSky) + sky[k] * AIR_LIGHT.bounceToSky);
    ok(sky.every((v, i) => Math.abs(v * AIR_LIGHT.ambient - out.skyUp[i]) < 1e-12) && ground.every((v, i) => Math.abs(v * AIR_LIGHT.ambient - out.groundDown[i]) < 1e-12), "the hemisphere the world makes is the sky's light above and the ground's bounce below exactly, its mix toward the sky's colour answered");
    ok(Math.abs(L.fill.r * L.fillScale - 0.4) < 1e-12 && L.fogDensity === out.fogDensity && L.fog.b === 0.25, "the fill is the second sun's light, the fog the horizon's colour at the visibility's density");
    const L1 = lighting();
    out.steer = 1;
    writeTwinLighting(out, swg, L1);
    out.steer = 0;
    ok(L1.mainScale === 9 && L1.main.r === 9, "and the steer at one hands SWG's own back");
    const g = { x: 0, y: 0, z: 0 };
    steerGain(out, swg.fog, g);
    ok(g.x === 1 && g.y === 1 && g.z === 1, "the steer's gain on the sky is one at nought");
  }

  // ---------------------------------------------------------------- the units are the world's own
  {
    const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
    const num = (name: string): number => Number(new RegExp(`const ${name} = ([0-9.]+);`).exec(world)?.[1]);
    ok(num('SWG_MAIN_LIGHT') === AIR_LIGHT.main && num('SWG_AMBIENT') * num('AMBIENT_SCALE') === AIR_LIGHT.ambient && num('SWG_FILL') === AIR_LIGHT.fill, `the twin's light units are world.ts's own (SWG_MAIN_LIGHT ${num('SWG_MAIN_LIGHT')}, SWG_AMBIENT × AMBIENT_SCALE ${num('SWG_AMBIENT') * num('AMBIENT_SCALE')}, SWG_FILL ${num('SWG_FILL')})`);
    ok(/this\.hemi\.groundColor\.copy\(L\.bounce\)\.multiplyScalar\(L\.bounceScale\)\.lerp\(this\.hemi\.color, 0\.35\)/.test(world), "and the world still mixes the bounce 0.35 toward the sky's colour, as the twin answers it");
  }
}

/** The twin's inputs written as the run writes them (the tests' own helper; the frame's measure writes them in place). */
function inputs(tw: AirTwin, sx: number, sy: number, sz: number, mx: number, my: number, mz: number, s2x: number, s2y: number, s2z: number, sun2: boolean, h: number): void {
  tw.inp.set([sx, sy, sz, mx, my, mz, s2x, s2y, s2z, h]);
  tw.sun2 = sun2;
}

/** A lighting record of the fields the twin writes. */
function lighting() {
  const c = (r = 0, g = 0, b = 0) => ({ r, g, b });
  return { main: c(), mainScale: 0, ambient: c(), ambientScale: 0, bounce: c(), bounceScale: 0, fill: c(), fillScale: 0, fog: c(), fogDensity: 0 };
}

// ---------------------------------------------------------------- nothing made by a frame
if (ALLOC) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as unknown as { gc: (o?: unknown) => void }).gc;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  const T = tatooine();
  const tw = new AirTwin();
  tw.useDepth(T.depth);
  tw.useRecord(T.rec, T.psi);
  tw.sunTop.fill(2.5);
  tw.moonTop.fill(1e-5);
  const swg = lighting();
  const L = lighting();
  const g = { x: 0.5, y: 0.5, z: 0.5 };
  const recs = [T.rec, T.rec];
  const psis = [T.psi, T.psi];
  const w = new Float64Array([0.5, 0.5]);
  const walk = { k: 0, e: 0.5 };
  const summing = process.argv.includes('--summing');
  const step = (): void => {
    walk.k = (walk.k + 1) % 1000;
    // A summing frame: the sun moved enough to sum the hemisphere again, and the weather moved the blend.
    walk.e = summing ? 0.3 + walk.k * 0.002 : 0.6;
    if (summing) {
      w[0] = walk.k / 1000;
      w[1] = 1 - w[0];
      tw.blendRows(recs, psis, w, 2);
    }
    const c = Math.cos(walk.e);
    const s = Math.sin(walk.e);
    const inp = tw.inp;
    inp[IN.sx] = c;
    inp[IN.sy] = s;
    inp[IN.sz] = 0.1;
    inp[IN.mx] = -c;
    inp[IN.my] = -s;
    inp[IN.mz] = -0.1;
    inp[IN.s2x] = c;
    inp[IN.s2y] = s - 0.02;
    inp[IN.s2z] = 0.1;
    inp[IN.heightKm] = 0.01;
    tw.sun2 = true;
    tw.frame();
    writeTwinLighting(tw.out, swg, L);
    steerGain(tw.out, swg.fog, g);
  };
  // The heap's own read makes about 2.3 KB (testing.md), so a window's floor is that over its frames: a summing frame (some
  // 20 µs) is measured over 8,000 of them, a floor of 0.29 B.
  const n = summing ? 8000 : 20000;
  for (let k = 0; k < 10; k++) {
    for (let i = 0; i < (summing ? 300 : 6000); i++) step();
    await turn();
  }
  let best = Number.NaN;
  let clean = 0;
  for (let tries = 0; tries < 12 && clean < 3; tries++) {
    for (let i = 0; i < n / 5; i++) step();
    gc({ type: 'minor' });
    await turn();
    await turn();
    const c0 = collections;
    const b = young();
    for (let i = 0; i < n; i++) step();
    const a = young();
    await turn();
    await turn();
    if (collections === c0) {
      const per = (a - b) / n;
      best = clean === 0 ? per : Math.min(best, per);
      clean++;
    }
  }
  console.log(JSON.stringify({ frame: clean === 0 ? 'no clean window' : best }));
  process.exit(0);
} else {
  const me = fileURLToPath(import.meta.url);
  for (const kind of ['steady', 'summing'] as const) {
    const runs = await Promise.all(
      Array.from({ length: 12 }, () =>
        new Promise<number | string>((res) => {
          const args = ['--expose-gc', me, '--alloc', ...(kind === 'summing' ? ['--summing'] : [])];
          const ch = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
          let out = '';
          let err = '';
          ch.stdout.on('data', (b) => (out += b));
          ch.stderr.on('data', (b) => (err += b));
          ch.on('close', () => {
            try {
              res(JSON.parse(out.trim().split('\n').pop() ?? '').frame as number | string);
            } catch {
              res(`no answer: ${err.slice(0, 300)}`);
            }
          });
        }),
      ),
    );
    const said = runs.map((x) => (typeof x === 'number' ? `${x.toFixed(3)} B` : x));
    ok(runs.every((x) => typeof x === 'number' && x < 0.5), `a ${kind} frame of the twin (the blend, the sums, the lighting fields, the steer's gain) makes nothing in 12 of 12 fresh processes (${said.join(', ')})`);
  }
  console.log(`\nairTwin: ${checks} checks passed`);
}
