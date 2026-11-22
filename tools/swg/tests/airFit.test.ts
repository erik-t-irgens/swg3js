// The air's record and its fit (the GPU port's pass 2, wave 1, `src/sky/air/airParams.ts`, `airFit.ts`), the game's own
// code under node:
//   - the record: its layout covers every number once, Hillaire's constants stand, a visibility set is a visibility read,
//     the sun is the star table's own (`src/sky/stars.ts`), records blend by numbers and say when they moved;
//   - the fit's fog: its density is the sky's own formula (held to `sky.ts`'s text), a row's share of the clear day is its
//     family's clear row's density over its own, never above one;
//   - the tint: turned in hue toward a target along the Rayleigh's power law alone, the noon sun's light held where it was,
//     within its exponent's range; a grey target leaves Earth's; the ozone stays in its range, never under its floor; a
//     fitted clear row's twilight zenith is blue over green (the review's green dusk); a gradient picture is read with the
//     dome's own orientation;
//   - the whole world: weather rows take their family's tint and ozone and differ by their haze alone, and the reply the
//     worker posts carries one transferable array a row.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { AIR_FIELD_COUNT, EARTH, F, KOSCHMIEDER, blendRecords, copyRecord, newAirRecord, recordMoved, setVisibility, visibilityOf, worldRecord } from '../../../src/sky/air/airParams.ts';
import { casterOf, kelvinToLinear } from '../../../src/sky/stars.ts';
import { FOG_FAR_T, TINT_EXPONENT, OZONE_MAX, OZONE_MIN, fitGradients, fitOzone, fitReply, fitSkyOf, fitTint, fitWorld, holdNoonSun, noonSunLuminance, pictureSampler, rowFogDensity, visibilityShares, type FitRow } from '../../../src/sky/air/airFit.ts';
import { AirLights, DEPTH_FLOATS, buildDepthTable, viewRadiance } from '../../../src/sky/air/airTwin.ts';
// @ts-ignore a plain module of the converter's
import { decodePng } from '../png.mjs';
import { hazeSliceDistanceM, hazeSliceW, HAZE_REACH_M, skyViewAngles, skyViewUv, transmittanceRMu, transmittanceUv, multiScatterRMu, multiScatterUv, AIR_SIZES } from '../../../src/sky/air/airApi.ts';

let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};

// ---------------------------------------------------------------- the record
{
  const idx = Object.values(F);
  ok(new Set(idx).size === idx.length && Math.max(...idx) === AIR_FIELD_COUNT - 1 && idx.length === AIR_FIELD_COUNT, `the record's ${AIR_FIELD_COUNT} numbers each have one place`);
  const r = newAirRecord();
  ok(r[F.bottom] === 6360 && r[F.top] === 6460 && r[F.rayG] === 13.558e-3 && r[F.mieH] === 1.2 && r[F.ozC] === 25 && r[F.ozW] === 15, "a fresh record is Hillaire's Earth");
  setVisibility(r, 40);
  ok(Math.abs(visibilityOf(r) - 40) < 1e-9 && Math.abs((r[F.mieS] + r[F.mieA]) * 40 + r[F.rayG] * 40 - KOSCHMIEDER) < 1e-9, `a visibility set is the visibility read (Koschmieder's 3.912 over the green's extinction): 40 km, the haze ${(r[F.mieS] + r[F.mieA]).toFixed(4)} per km`);
  ok(Math.abs(r[F.mieS] / (r[F.mieS] + r[F.mieA]) - r[F.mieAlbedo]) < 1e-12, "and it is split into scattering and absorption by the record's single-scattering albedo");
  setVisibility(r, 1000);
  ok(r[F.mieS] === 0 && r[F.mieA] === 0 && Math.abs(visibilityOf(r) - KOSCHMIEDER / EARTH.rayleigh[1]) < 1e-9, `air clearer than Rayleigh alone leaves no haze (${visibilityOf(r).toFixed(0)} km at most)`);
  const tat = worldRecord('tatooine');
  const star = casterOf('tatooine');
  const rgb = [0, 0, 0];
  kelvinToLinear(star.kelvin, rgb);
  ok(tat[F.sunR] === rgb[0] && tat[F.sunG] === rgb[1] && Math.abs(tat[F.sunRadius] - (star.radiusDeg * Math.PI) / 180) < 1e-15 && tat[F.sunStrength] === star.strength, `Tatooine's sun is the star table's own ${star.name} (${star.kelvin} K, ${star.radiusDeg} degrees): the disc and the light are one star`);
  const a = worldRecord('naboo');
  const b = worldRecord('naboo');
  setVisibility(a, 40);
  setVisibility(b, 4);
  const out = newAirRecord();
  blendRecords(out, [a, b], [0.25, 0.75], 2);
  ok(Math.abs(out[F.mieS] - (0.25 * a[F.mieS] + 0.75 * b[F.mieS])) < 1e-15 && Math.abs(out[F.rayB] - a[F.rayB]) < 1e-15, 'records blend by numbers, weight by weight');
  ok(!recordMoved(a, a, 1e-4) && recordMoved(a, b, 1e-4), 'a record the same has not moved; one with ten times the haze has');
  const c = newAirRecord();
  copyRecord(a, c);
  c[F.rayR] *= 1 + 5e-5;
  ok(!recordMoved(a, c, 1e-4), 'and a change under the share draws nothing again');
}

// ---------------------------------------------------------------- the fog
{
  const sky = readFileSync(new URL('../../../src/world/sky.ts', import.meta.url), 'utf8');
  ok(/const CLIENT_FAR_PLANE = 1024;/.test(sky) && /\(CLIENT_FAR_PLANE - 512\) \/ \(2048 - 512\)/.test(sky) && /THREE\.MathUtils\.lerp\(b\.fog\.min, b\.fog\.max, farT\)/.test(sky) && Math.abs(FOG_FAR_T - 1 / 3) < 1e-15, "a row's fog density is the sky's own formula (sky.ts: lerp(min, max, (1024 - 512) / (2048 - 512)))");
  const row = (name: string, w: number, min: number, max: number, on = true): FitRow => ({ name, weatherIndex: w, ramp: null, fog: { enabled: on, min, max } });
  const rows = [row('global', 0, 0.005, 0.002), row('global', 4, 0.043, 0.043), row('town', 0, 0.008, 0.008), row('town', 1, 0.004, 0.004), row('town', 3, 0.08, 0.08), row('far', 2, 0.04, 0.04), row('nofog', 0, 0, 0, false)];
  const s = visibilityShares(rows);
  const d0 = rowFogDensity(rows[0]);
  ok(s[0] === 1 && Math.abs(s[1] - d0 / 0.043) < 1e-12, `a storm row's share is its family's clear row's density over its own (${s[1].toFixed(3)} of the clear day)`);
  ok(s[2] === 1 && s[3] === 1 && Math.abs(s[4] - 0.1) < 1e-12, "each family by its own clear row, and a weather row clearer than its clear row is held at a clear day's");
  ok(Math.abs(s[5] - d0 / 0.04) < 1e-12 && s[6] === 1, "a family with no clear row takes the world's global one; a row with no fog sees the clear day's");
}

// ---------------------------------------------------------------- the tint and the ozone
{
  const rec = worldRecord('tatooine');
  setVisibility(rec, 40);
  const noonEl = (67.5 * Math.PI) / 180;
  const before = noonSunLuminance(rec, noonEl);
  const target = new Float64Array([0.1, 0.25, 0.6]);
  const tint: [number, number, number] = [1, 1, 1];
  fitTint(rec, target, noonEl, tint);
  holdNoonSun(rec, before, noonEl);
  const after = noonSunLuminance(rec, noonEl);
  ok(Math.abs(after - before) / before < 1e-6, `a fitted tint keeps the noon sun's light (${before.toFixed(5)} before, ${after.toFixed(5)} after): the hue moves, never the day's strength`);
  ok(rec[F.rayB] / rec[F.rayR] > EARTH.rayleigh[2] / EARTH.rayleigh[0], `a bluer target turns the Rayleigh bluer (blue over red ${(rec[F.rayB] / rec[F.rayR]).toFixed(2)}, Earth's ${(EARTH.rayleigh[2] / EARTH.rayleigh[0]).toFixed(2)})`);
  // The tint moves the Rayleigh along its power law of the wavelength alone (the review: channel by channel, Tatooine's noon
  // picture cut its red to a third and raised its green, and its dusk came out green): whatever the target, red is
  // scattered least and blue most, by one exponent within its range.
  const exponentOf = (r: Float64Array): [number, number] => [Math.log(r[F.rayR] / r[F.rayG]) / (Math.log(EARTH.rayleigh[0] / EARTH.rayleigh[1]) / 4), Math.log(r[F.rayB] / r[F.rayG]) / (Math.log(EARTH.rayleigh[2] / EARTH.rayleigh[1]) / 4)];
  for (const [name, t] of [['a purple no clear air makes', [0.6, 0.01, 0.6]], ['a green', [0.05, 0.6, 0.1]], ['a tan', [0.7, 0.6, 0.45]], ['a deep blue', [0.02, 0.1, 0.9]]] as [string, number[]][]) {
    const p = worldRecord('talus');
    setVisibility(p, 40);
    fitTint(p, new Float64Array(t), noonEl, tint);
    const [nr, nb] = exponentOf(p);
    ok(p[F.rayR] < p[F.rayG] && p[F.rayG] < p[F.rayB] && Math.abs(nr - nb) < 1e-9 && nr >= TINT_EXPONENT.least - 1e-9 && nr <= TINT_EXPONENT.most + 1e-9, `${name}: the Rayleigh stays one power law, λ^-${nr.toFixed(2)} within ${TINT_EXPONENT.least} to ${TINT_EXPONENT.most} (the steer dial is for the rest)`);
  }
  const grey = worldRecord('naboo');
  const g0 = grey[F.rayR];
  fitTint(grey, new Float64Array([0.4, 0.4, 0.4]), noonEl, tint);
  ok(grey[F.rayR] === g0 && tint[0] === 1, "a grey target says nothing of a hue: Earth's Rayleigh is left");
  const oz = worldRecord('naboo');
  setVisibility(oz, 40);
  const sOz = fitOzone(oz, new Float64Array([0.05, 0.08, 0.3]));
  ok(sOz >= OZONE_MIN && sOz <= OZONE_MAX && Math.abs(oz[F.ozG] - EARTH.ozone[1] * sOz) < 1e-15, `the ozone is scaled within ${OZONE_MIN} and ${OZONE_MAX} of Earth's (${sOz.toFixed(2)} for a deep blue dusk)`);
  const ozRed = worldRecord('naboo');
  setVisibility(ozRed, 40);
  const sRed = fitOzone(ozRed, new Float64Array([0.5, 0.1, 0.05]));
  ok(Math.abs(sRed - OZONE_MIN) < 0.01, `a red dusk asks for less ozone than any clear twilight keeps blue under, and is held at ${OZONE_MIN} of Earth's (${sRed.toFixed(3)})`);
}

// ---------------------------------------------------------------- a fitted clear row's twilight (the review's green dusk)
{
  // Tatooine's converted sky where this machine has it (read only, nothing of it kept), else a clear row of a tan picture.
  const root = new URL('../../../assets-private/tatooine/', import.meta.url);
  let blocks: FitRow[];
  let sampler = null as ReturnType<typeof pictureSampler> | null;
  let real = false;
  let elev = 67.5;
  if (existsSync(new URL('sky.json', root))) {
    const j = JSON.parse(readFileSync(new URL('sky.json', root), 'utf8'));
    elev = j.sunElevationDegrees;
    blocks = j.blocks;
    const pics = new Map<string, { width: number; height: number; data: Uint8Array }>();
    for (const f of fitGradients(fitSkyOf('tatooine', elev, blocks))) {
      const p = new URL(f, root);
      if (!existsSync(p)) continue;
      const d = decodePng(readFileSync(p));
      pics.set(f, { width: d.width, height: d.height, data: d.rgba });
    }
    sampler = pictureSampler(pics);
    real = true;
  } else {
    const px = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) px.set([150, 205, 210, 255], i * 4);
    sampler = pictureSampler(new Map([['g.png', { width: 4, height: 4, data: px }]]));
    blocks = [{ name: 'global', weatherIndex: 0, ramp: null, fog: { enabled: true, min: 0.005, max: 0.002 }, gradientSky: 'g.png' }];
  }
  const fit = fitWorld({ planet: 'tatooine', sunElevationDegrees: elev, blocks }, 40, sampler);
  const clear = fit.rows.findIndex((_, i) => blocks[i].weatherIndex === 0);
  const rec = fit.rows[clear].record;
  const depth = new Float64Array(DEPTH_FLOATS);
  buildDepthTable(rec, depth, 80);
  const L = new AirLights();
  L.count = 1;
  const e = (-3 * Math.PI) / 180;
  L.dir[0] = Math.cos(e);
  L.dir[1] = Math.sin(e);
  L.top[0] = rec[F.sunR];
  L.top[1] = rec[F.sunG];
  L.top[2] = rec[F.sunB];
  L.live[0] = 1;
  const z = new Float64Array(3);
  viewRadiance(rec, depth, fit.rows[clear].psi, rec[F.bottom] + 0.01, 0, 1, 0, L, 64, Infinity, z, 0, null);
  ok(z[2] > z[1] * 1.15 && z[1] > 0, `${real ? "Tatooine's own fitted clear row" : 'a fitted clear row'}: the zenith three degrees after sunset is blue over green (${(z[2] / z[1]).toFixed(2)} times; the review's first cut read 1.04, green as blue), its ozone ${fit.rows[clear].ozone.toFixed(2)} of Earth's`);
}

// ---------------------------------------------------------------- the dome's orientation of a gradient picture
{
  // Two rows: the top row red, the bottom row blue (sRGB 255): the dome's v of 0, the horizon, is the bottom row.
  const data = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
  const sample = pictureSampler(new Map([['g.png', { width: 2, height: 2, data }]]));
  const at = new Float64Array(3);
  sample('g.png', 0.5, 0, at);
  const low = [...at];
  sample('g.png', 0.5, 1, at);
  ok(low[2] === 1 && low[0] === 0 && at[0] === 1 && at[2] === 0 && !sample('missing.png', 0.5, 0.5, at), "a gradient picture is read as the dome reads it: its bottom row the horizon, its top the zenith; a missing one says so");
}

// ---------------------------------------------------------------- the whole world and the reply
{
  const blocks: FitRow[] = [
    { name: 'global', weatherIndex: 0, ramp: null, fog: { enabled: true, min: 0.005, max: 0.002 } },
    { name: 'global', weatherIndex: 3, ramp: null, fog: { enabled: true, min: 0.025, max: 0.025 } },
    { name: 'town', weatherIndex: 0, ramp: null, fog: { enabled: true, min: 0.005, max: 0.002 }, gradientSky: 'g.png' },
    { name: 'town', weatherIndex: 4, ramp: null, fog: { enabled: true, min: 0.043, max: 0.043 } },
  ];
  // A sky-blue picture for the town's clear row.
  const px = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) px.set([120, 170, 235, 255], i * 4);
  const sampler = pictureSampler(new Map([['g.png', { width: 4, height: 4, data: px }]]));
  const r = fitWorld({ planet: 'tatooine', sunElevationDegrees: 67.5, blocks }, 30, sampler);
  ok(r.rows.length === 4 && r.depth.length > 0, `every row answered, one table of column densities for the world (${r.rows.length} rows, ${r.distinct} distinct, ${r.ms.toFixed(0)} ms)`);
  const town = r.rows[2];
  const storm = r.rows[3];
  ok(town.tint.some((t) => t !== 1) && storm.tint.every((t, i) => t === town.tint[i]) && storm.ozone === town.ozone, "a weather row takes its family's clear row's tint and ozone");
  ok(Math.abs(visibilityOf(town.record) - 30) < 1e-9 && Math.abs(visibilityOf(storm.record) - 30 * storm.visShare) < 1e-9 && storm.record[F.rayB] === town.record[F.rayB], `and differs from it by its haze alone (the dial's 30 km, the storm ${visibilityOf(storm.record).toFixed(2)} km)`);
  const reply = fitReply({ id: 7, sky: { planet: 'tatooine', sunElevationDegrees: 67.5, blocks }, visibilityKm: 30, gradients: {} }, sampler);
  const bufs = [reply.depth.buffer, ...reply.records.map((a) => a.buffer), ...reply.psis.map((a) => a.buffer)];
  ok(reply.id === 7 && !reply.error && new Set(bufs).size === bufs.length, 'the reply the worker posts carries one array of its own a row, so each can be transferred');
}

// ---------------------------------------------------------------- the tables' mappings (airApi.ts), each the other's inverse
{
  let worst = 0;
  const uv = new Float64Array(2);
  const back = new Float64Array(2);
  for (const r of [6360, 6360.5, 6380, 6459]) {
    for (const mu of [1, 0.5, 0.1, 0.0, -0.05]) {
      transmittanceUv(r, mu, 6360, 6460, uv);
      transmittanceRMu(uv[0], uv[1], 6360, 6460, back);
      const horizon = -Math.sqrt(Math.max(0, 1 - (6360 / r) ** 2));
      if (mu >= horizon) worst = Math.max(worst, Math.abs(back[0] - r), Math.abs(back[1] - mu));
    }
  }
  ok(worst < 1e-6, `the transmittance's coordinates and their inverse are one mapping above the horizon (worst ${worst.toExponential(1)})`);
  multiScatterUv(6400, 0.3, 6360, 6460, uv);
  multiScatterRMu(uv[0], uv[1], 6360, 6460, back);
  ok(Math.abs(back[0] - 6400) < 1e-9 && Math.abs(back[1] - 0.3) < 1e-12, 'and the multiple scattering\'s');
  let sv = 0;
  for (const dip of [0, 0.01]) {
    for (const el of [1.5, 0.6, 0.05, 0, -dip, -0.3, -1.2]) {
      for (const az of [0, 0.5, 2, Math.PI]) {
        skyViewUv(el, az, dip, uv);
        skyViewAngles(uv[0], uv[1], dip, back);
        sv = Math.max(sv, Math.abs(back[0] - el), Math.abs(back[1] - az));
      }
    }
  }
  ok(sv < 1e-9 && AIR_SIZES.skyView.width === 192 && AIR_SIZES.skyView.height === 108, `and the sky view's, 192 by 108 (worst ${sv.toExponential(1)})`);
  ok(hazeSliceW(0) === 0 && hazeSliceW(HAZE_REACH_M) === 1 && Math.abs(hazeSliceDistanceM(hazeSliceW(1000)) - 1000) < 1e-9 && Math.abs(hazeSliceDistanceM(0.5 / 32) - 5.859375) < 1e-9, 'the haze volume\'s slices lie by the square of their depth to 24 km, slice 0\'s centre 5.9 m out');
}

console.log(`\nairFit: ${checks} checks passed`);
