// The air of a world in play (the GPU port's pass 2, wave 1, `src/sky/air/airRun.ts`), the game's own code under node:
//   - the fit's answer (`fitReply`, the very function the worker runs) taken through the run's own path, every row of the
//     sky given its record, the world's column densities taken in;
//   - a clear Tatooine noon through the whole run lights the world at today's key light there (the converted sky where this machine
//     has it, with the fit's tint and ozone; a sky of one clear row otherwise), and its frame record says what it drew;
//   - SWG's lighting of the hour kept in `AIR.swg` before the twin writes over it, and the fog-equivalent the rain reads;
//   - the visibility dial: moved, the rows' haze follows on the next frame, and the storm rows from wherever it stands;
//   - the mix: a weather row blended in moves the record by numbers, and a frame whose mix stands blends nothing;
//   - nothing allocated by a frame of the run, steady or with the sun and the weather moving, in twelve fresh processes.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { AIR, AIR_UNITS } from '../../../src/sky/air/airApi.ts';
import { AirRun, pairInto } from '../../../src/sky/air/airRun.ts';
import { PAIR_TUNE, pairDirectionIn } from '../../../src/sky/stars.ts';
import { AIR_DIALS, F, LUMA_B, LUMA_G, LUMA_R, tuneAirDials, visibilityOf } from '../../../src/sky/air/airParams.ts';
import { fitReply, fitGradients, fitSkyOf, pictureSampler, type FitRow } from '../../../src/sky/air/airFit.ts';
import { AIR_LIGHT, TATOOINE_NOON_ELEVATION, TODAY_NOON_KEY } from '../../../src/sky/air/airTwin.ts';
// @ts-ignore a plain module of the converter's
import { decodePng } from '../png.mjs';

const ALLOC = process.argv.includes('--alloc');
let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  if (!ALLOC) console.log(`ok   ${msg}`);
};
const lum = (c: { r: number; g: number; b: number }): number => LUMA_R * c.r + LUMA_G * c.g + LUMA_B * c.b;

/** A sky of one clear row and its storm, for a machine without the converted packs. */
const PLAIN: FitRow[] = [
  { name: 'global', weatherIndex: 0, ramp: null, fog: { enabled: true, min: 0.005, max: 0.002 }, gradientSky: null },
  { name: 'global', weatherIndex: 4, ramp: null, fog: { enabled: true, min: 0.043, max: 0.043 }, gradientSky: null },
];

/** Tatooine's converted sky where this machine has it (read only, nothing of it kept), else the plain one. */
function tatooineSky(): { sunElevationDegrees: number; blocks: FitRow[]; real: boolean; pictures: Map<string, { width: number; height: number; data: Uint8Array }> } {
  const root = new URL('../../../assets-private/tatooine/', import.meta.url);
  const pictures = new Map<string, { width: number; height: number; data: Uint8Array }>();
  if (!existsSync(new URL('sky.json', root))) return { sunElevationDegrees: 67.5, blocks: PLAIN, real: false, pictures };
  const j = JSON.parse(readFileSync(new URL('sky.json', root), 'utf8'));
  const sky = fitSkyOf('tatooine', j.sunElevationDegrees, j.blocks);
  for (const f of fitGradients(sky)) {
    const p = new URL(f, root);
    if (!existsSync(p)) continue;
    const d = decodePng(readFileSync(p));
    pictures.set(f, { width: d.width, height: d.height, data: d.rgba });
  }
  return { sunElevationDegrees: j.sunElevationDegrees, blocks: j.blocks, real: true, pictures };
}

/** The sky's lighting record as `SwgSky.lighting` holds it (the fields the run reads and writes). */
function lighting() {
  return { ambient: new THREE.Color(0.3, 0.3, 0.3), ambientScale: 1, shadow: new THREE.Color(), main: new THREE.Color(1, 0.9, 0.8), mainScale: 1.2, fill: new THREE.Color(0.2, 0.2, 0.2), fillScale: 0.5, bounce: new THREE.Color(0.1, 0.1, 0.1), bounceScale: 0.7, fog: new THREE.Color(0.7, 0.6, 0.5), fogDensity: 0.004, clear: new THREE.Color(0.5, 0.5, 0.6) };
}

/** A day and a mix as the world hands them. */
function dayAt(elevationDeg: number) {
  const e = (elevationDeg * Math.PI) / 180;
  const sunDir = new THREE.Vector3(Math.cos(e) * 0.6, Math.sin(e), Math.cos(e) * 0.8);
  return { sunDir, moonDir: sunDir.clone().negate(), isDay: elevationDeg > 0 };
}
function mixOf(blocks: readonly object[], idx: number[], w: number[]) {
  const weights = new Float64Array(4);
  w.forEach((v, i) => (weights[i] = v));
  return { mixLength: idx.length, mixBlock: (i: number) => (i < idx.length ? blocks[idx[i]] : null), mixWeights: weights };
}

const T = tatooineSky();
const run = new AirRun('tatooine', { sunElevationDegrees: T.sunElevationDegrees, blocks: T.blocks }, (f) => f);
// The worker's own answer, worked here by the function the worker runs, taken through the run's own path.
const ask = { id: 1, sky: fitSkyOf('tatooine', T.sunElevationDegrees, T.blocks), visibilityKm: 40, gradients: {} };
(run as unknown as { fitAsked: number }).fitAsked = 1;
const reply = fitReply(ask, pictureSampler(T.pictures));
(run as unknown as { take(r: unknown): void }).take(reply);

if (!ALLOC) {
  ok(!reply.error && reply.records.length === T.blocks.length && reply.depth.length > 0, `the fit answered every row of ${T.real ? "Tatooine's converted sky" : 'the plain sky'} (${reply.records.length} rows, ${reply.distinct} distinct, ${reply.ms.toFixed(0)} ms, ${T.pictures.size} gradient pictures read)`);
  const clearIdx = T.blocks.findIndex((b) => b.weatherIndex === 0);
  const L = lighting();
  const swgMain = L.main.clone();
  const day = dayAt((TATOOINE_NOON_ELEVATION * 180) / Math.PI);
  const mix = mixOf(T.blocks, [clearIdx], [1]);
  run.heightM = 10; run.overcast = 0; run.frame(day, mix, L);
  const lit = AIR_LIGHT.main * L.mainScale * lum(L.main);
  ok(Math.abs(lit - TODAY_NOON_KEY) / TODAY_NOON_KEY < 0.01, `a clear Tatooine noon through the whole run lights the world at today's key light ${TODAY_NOON_KEY} (${lit.toFixed(4)}${T.real ? ", Tatooine's own fitted clear row" : ''}: the units ${AIR_UNITS.scene.toFixed(4)} are set from its unfitted record, so the fit's tint moves it by ${(((lit - TODAY_NOON_KEY) / TODAY_NOON_KEY) * 100).toFixed(2)}%)`);
  ok(AIR.swg.main.equals(swgMain) && AIR.swg.mainScale === 1.2, "SWG's own lighting of the hour was kept in AIR.swg before the twin wrote over it");
  const f = AIR.frame;
  ok(f.on && f.sun2 && f.sun2Dir.y < f.sunDir.y && Math.abs(f.sunDir.angleTo(f.sun2Dir) - (1.5 * Math.PI) / 180) < 1e-6, `the frame record is on, with Tatooine's second sun 1.5 degrees under the caster (stars.ts's pair rule)`);
  ok(f.sun2Here.r > 0 && L.fillScale > 0 && lum(f.sun2Here) < lum(f.sunHere), `and its light, weaker than the caster's, is the fill (${lum(f.sun2Here).toFixed(3)} against ${lum(f.sunHere).toFixed(3)})`);
  ok(Math.abs(f.visibilityKm - 40) < 1e-6 && Math.abs(f.fogDensity - 1.9778 / 40000) < 1e-12 && L.fogDensity === f.fogDensity, `the clear row's visibility is the dial's 40 km, and the rain's fog-equivalent is the exponential-squared density reaching 98% there (${f.fogDensity.toExponential(3)} per metre)`);
  ok(f.fogColour.r === L.fog.r && L.fog.r < 1 && L.fog.r > 0, "the fog colour the wet surfaces take is the air's horizon");
  // The storm row: its share of the dial's visibility.
  const stormIdx = T.blocks.findIndex((b) => b.weatherIndex === 4 && b.name === T.blocks[clearIdx].name);
  run.heightM = 10; run.overcast = 0.8; run.frame(day, mixOf(T.blocks, [stormIdx], [1]), lighting());
  const share = reply.records[stormIdx][F.visShare];
  ok(stormIdx > 0 && Math.abs(f.visibilityKm - 40 * share) < 1e-6 && share < 0.3, `a storm row sees ${f.visibilityKm.toFixed(2)} km, its share ${share.toFixed(3)} of the dial's (its fog over its clear row's)`);
  // Half and half: the record blended by numbers (its haze's extinction the mean of the two rows').
  run.heightM = 10; run.overcast = 0.4; run.frame(day, mixOf(T.blocks, [clearIdx, stormIdx], [0.5, 0.5]), lighting());
  const ext = (r: Float64Array) => r[F.mieS] + r[F.mieA];
  ok(Math.abs(ext(run.twin.record) - 0.5 * (ext(reply.records[clearIdx]) + ext(reply.records[stormIdx]))) < 1e-12, 'a mix of the two blends their numbers: the haze in force is the mean of the two rows\' extinctions, never a mix of colours');
  const v0 = run.twin.version;
  run.heightM = 10; run.overcast = 0.4; run.frame(day, mixOf(T.blocks, [clearIdx, stormIdx], [0.5, 0.5]), lighting());
  ok(run.twin.version === v0, 'and a frame whose mix stands blends nothing');
  // The dial: moved, the rows follow on the next frame.
  tuneAirDials({ tatooine: { visibilityKm: 20 } });
  run.heightM = 10; run.overcast = 0; run.frame(day, mixOf(T.blocks, [clearIdx], [1]), lighting());
  ok(Math.abs(f.visibilityKm - 20) < 1e-6 && Math.abs(visibilityOf(reply.records[stormIdx]) - 20 * share) < 1e-6, `the visibility dial at 20 km: the clear row sees 20 km on the next frame, the storm ${(20 * share).toFixed(2)} km (weather scales from wherever it stands)`);
  const said = tuneAirDials({ tatooine: { visibilityKm: 1000, steer: -1, haze: 3 } });
  ok(said.some((s) => s.includes('held to 300')) && said.some((s) => s.includes('held to 0')) && said.some((s) => s.includes('no such dial')) && AIR_DIALS.tatooine.visibilityKm === 300, `the dials are held to their ranges and say so (${said.join('; ')})`);
  tuneAirDials({ tatooine: { visibilityKm: 40, steer: 0 } });
  // The steer: at one the main light is SWG's own of the hour.
  tuneAirDials({ tatooine: { steer: 1 } });
  const Ls = lighting();
  run.heightM = 10; run.overcast = 0; run.frame(day, mixOf(T.blocks, [clearIdx], [1]), Ls);
  ok(Math.abs(Ls.mainScale - 1.2) < 1e-12 && Math.abs(Ls.main.r - 1) < 1e-12 && f.steer === 1, 'the steer at one hands the lights SWG\'s own of the hour');
  tuneAirDials({ tatooine: { steer: 0 } });
  // The run's own pair rule against stars.ts's (it works it from the vectors' fields, the frame's numbers kept off a call).
  {
    let worst = 0;
    const out = new THREE.Vector3();
    const want = { x: 0, y: 0, z: 0 };
    // Pass 2, wave 6 (maker K): at every angle round the caster too (0 today's lines, 90 beside, 180 above, and between).
    for (const angle of [0, 90, 180, -90, 37, -150]) {
      PAIR_TUNE.angleDeg = angle;
      for (const below of [0, 1.5, 6]) {
        PAIR_TUNE.belowDeg = below;
        for (const s of [new THREE.Vector3(0.3, 0.9, 0.31).normalize(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-0.99, 0.02, 0.1).normalize(), new THREE.Vector3(0.5, -0.2, -0.84).normalize()]) {
          pairInto(s, out);
          pairDirectionIn(s.x, s.y, s.z, want);
          worst = Math.max(worst, Math.abs(out.x - want.x), Math.abs(out.y - want.y), Math.abs(out.z - want.z));
        }
      }
    }
    PAIR_TUNE.belowDeg = 1.5;
    PAIR_TUNE.angleDeg = 0;
    ok(worst === 0, "the run's pair rule is stars.ts's own to the bit, at six angles round the caster, three distances and four casters");
  }
  const rep = run.report() as { fit: { rows: number }; record: unknown };
  ok(rep.fit.rows === T.blocks.length && !!rep.record, "the run's report (for __debug.sky) names the fit and the record in force");
  run.dispose();
  ok(!AIR.frame.on, 'disposed, the frame record is off');
}

// ---------------------------------------------------------------- nothing made by a frame of the run
if (ALLOC) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as unknown as { gc: (o?: unknown) => void }).gc;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  const moving = process.argv.includes('--moving');
  // (pass 2, wave 6, maker K) the pair turned beside the caster, set before any frame as the console would set it
  if (process.argv.includes('--beside')) PAIR_TUNE.angleDeg = 90;
  const L = lighting();
  const day = dayAt(40);
  const clearIdx = T.blocks.findIndex((b) => b.weatherIndex === 0);
  const stormIdx = T.blocks.findIndex((b) => b.weatherIndex === 4 && b.name === T.blocks[clearIdx].name);
  const mix = mixOf(T.blocks, [clearIdx, stormIdx], [1, 0]);
  const walk = { k: 0, e: 0.5 };
  const step = (): void => {
    if (moving) {
      walk.k = (walk.k + 1) % 2000;
      // The sun climbs a little each frame and the storm comes in: every frame sums the sky and blends the rows again.
      walk.e = 0.2 + walk.k * 0.0005;
      day.sunDir.y = Math.sin(walk.e);
      day.sunDir.x = Math.cos(walk.e) * 0.6;
      day.sunDir.z = Math.cos(walk.e) * 0.8;
      mix.mixWeights[1] = walk.k / 2000;
      mix.mixWeights[0] = 1 - mix.mixWeights[1];
    }
    run.heightM = 10; run.overcast = 0.2; run.frame(day, mix, L);
  };
  const n = moving ? 8000 : 20000;
  for (let k = 0; k < 10; k++) {
    for (let i = 0; i < (moving ? 400 : 6000); i++) step();
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
  // (pass 2, wave 6, maker K) a third kind, the moving frame with Tatooine's pair turned beside the caster (its other branch);
  // and the twelve processes in two waves of six, the machine's cap on node processes at once
  for (const kind of ['steady', 'moving', 'beside'] as const) {
    const one = () =>
        new Promise<number | string>((res) => {
          const ch = spawn(process.execPath, ['--expose-gc', me, '--alloc', ...(kind === 'steady' ? [] : ['--moving']), ...(kind === 'beside' ? ['--beside'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
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
        });
    const runs: (number | string)[] = [];
    for (let wave = 0; wave < 2; wave++) runs.push(...(await Promise.all(Array.from({ length: 6 }, one))));
    const said = runs.map((x) => (typeof x === 'number' ? `${x.toFixed(3)} B` : x));
    ok(runs.every((x) => typeof x === 'number' && x < 0.5), `a ${kind} frame of the run (the mix, the twin, the frame record, SWG's lighting kept, the lighting written) makes nothing in 12 of 12 fresh processes (${said.join(', ')})`);
  }
  console.log(`\nairRun: ${checks} checks passed`);
}
