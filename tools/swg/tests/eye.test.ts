// The GPU port's pass 2, wave 2, maker A: the eye and what it was built beside, held in node as far as node reaches (node builds
// no WGSL and draws nothing, so the pictures are a browser's). Every time the game's own code:
//  1. the eye's arithmetic (`src/sky/exposure/eyeMath.ts`): the count's bins, the percentiles' mean, the full make-up, the
//     dark-night rule, the ease (the same at 30, 60 and 144 frames a second), the glow factor, "off", the dials;
//  2. the main thread's frame (`eyeRun.ts`): its three modes, three's exposure with and without a chain, the buffer written
//     only when the answer moves, the loading screen's snap, the frame's time kept whole;
//  3. the card's side over a stand-in renderer (`eyeGpu.ts`, `eyeBuffer.ts`): the pass draws its copy and its two computes only
//     while the card adapts and its pipelines have landed, writes nothing into the chain, sizes its copy a quarter each way; the
//     glow part on a lit material's emissive term and an unlit one's colour, never a shader material; the main thread's write;
//  4. every reader of the exposure reads the buffer (the text of the chain's output, bright pass and grade, the programs, the
//     registry's place, the spine, the start), and WebGL keeps its own exposure line;
//  5. the eye's dials (`eyeDials.ts`) through `tuneEye`, held to their ranges;
//  6. the sky's match record (`src/sky/skyMatch.ts`): its shape, a save read back, a bad record refused, the list, the hold;
//  7. the ozone's limits as dials (`airParams.ts`, `airFit.ts`, `airRun.ts`): every world's and a world's own, the fit held
//     inside them, the run asking for a refit when they move;
//  8. the night light (`airRun.ts`): the brightest body up by its light at the ground, and the level light "off" follows.
//
// Run: node tools/swg/tests/eye.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { EYE_DEMO, EYE_DEMO_NIGHT, EYE_FIXED, EYE_FLOATS, EYE_FRAME, EYE_SLOT, EYE_TUNE, EYE_TUNE_RANGE, OFF_LEVEL_REF, OFF_MEAN, binCentreLog, binOf, compensationOf, easeStops, exposureOf, eyeFrame, fullStops, glowOf, offStops, percentileMean, targetStops, tuneEye, weightAt } from '../../../src/sky/exposure/eyeMath.ts';
import { EYE_IN, EYE_OUT, eyeFrameRun } from '../../../src/sky/exposure/eyeRun.ts';
import { eyeDialSet, eyeDialsFor } from '../../../src/sky/exposure/eyeDials.ts';
import { OUTPUT_DITHER } from '../../../src/sky/exposure/ditherDial.ts';
import { EYE_LIGHTS } from '../../../src/sky/eyeLights.ts';
import { sceneUnits } from '../../../src/sky/air/airTwin.ts';
import { EYE_ATTR, EYE_GLOW_STATS, eyeGlowPart, writeEyeCpu } from '../../../src/sky/exposure/eyeBuffer.ts';
import { GpuEyePass, PRE_ROLLS, eyeBegin, eyeFrameGpu, eyeReady } from '../../../src/sky/exposure/eyeGpu.ts';
import { PRE_ATTR, PRE_FIXED, PRE_SLOT, isSceneTarget, markSceneTarget, preExposedOut, takesPre } from '../../../src/sky/exposure/preExpose.ts';
import { toCanvasNode } from '../../../src/core/gpu/inlineOutput.ts';
import { SKY_AT_LOAD } from '../../../src/sky/skyMode.ts';
import * as TSL from 'three/tsl';
import { MATCH_HOLD, clockOf, forgetMatch, holdFrom, isMatch, matchList, readMatches, saveMatch, type MatchStore, type SkyMatch } from '../../../src/sky/skyMatch.ts';
import { AIR_DIAL_STATE, AIR_OZONE, airDialsOf, ozoneOf, tuneAirDials, worldRecord } from '../../../src/sky/air/airParams.ts';
import { OZONE_MAX, OZONE_MIN, fitOzone } from '../../../src/sky/air/airFit.ts';
import { AirRun } from '../../../src/sky/air/airRun.ts';
import { AIR } from '../../../src/sky/air/airApi.ts';
import { fxPassIndex } from '../../../src/core/fxRegistry.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let passed = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const text = (p: string): string => readFileSync(join(root, p), 'utf8');
/** Whether a node graph reaches `target` (a node, or the attribute a buffer node holds), walking nodes' own fields. */
const reaches = (graphRoot: Any, target: Any): boolean => {
  const seen = new Set<unknown>();
  const walk = (x: Any, depth: number): boolean => {
    if (x === target) return true;
    if (!x || typeof x !== 'object' || seen.has(x) || depth > 40) return false;
    seen.add(x);
    if (Array.isArray(x)) return x.some((y) => walk(y, depth + 1));
    if (!x.isNode && depth > 0) return false;
    for (const k of Object.keys(x)) if (k !== 'parents' && walk(x[k], depth + 1)) return true;
    return false;
  };
  return walk(graphRoot, 0);
};
const reachesAttr = reaches;

// ---------------------------------------------------------------- 1. the eye's arithmetic
{
  // The sky and light fix round: his demo's curve (its EXPOSURE_WGSL and HISTOGRAM_WGSL), its absolute numbers carried into our
  // units by the two suns at the top of the air.
  const T = { ...EYE_TUNE };
  const shift = Math.log2(sceneUnits() / 16);
  ok(near(EYE_DEMO.ours, sceneUnits(), 1e-5) && EYE_DEMO.demo === 16 && near(EYE_DEMO.shift, shift, 1e-5), `the conversion: his demo's sun 16 at the top of the air against ours ${sceneUnits().toFixed(4)} (the air's scene units at load), ${shift.toFixed(4)} stops`);
  ok(T.key === 0.18 && T.share === 0.85 && T.intoLight === 2.6 && T.intoDark === 1.1 && T.centre === 3 && T.glow === 1, "the dials start at the demo's own key (0.18), rates (2.6 and 1.1 a second) and centre weight (16 against 4), the glow at 1 (the design's), and the lead's night share (0.85)");
  ok(T.low === -20.5 && near(T.high, 4 + shift, 1e-4) && near(T.knee, -2 + shift, 1e-4), `the demo's top (4) and knee (-2) carried into our units, the lead's darkest scene (-20.5): ${T.low}, ${T.high}, ${T.knee}`);
  ok(near(EYE_DEMO_NIGHT.low, -14 + shift, 1e-4) && EYE_DEMO_NIGHT.share === 0.7, "and the demo's own night kept for a line that puts it back");
  ok(EYE_FIXED.bins === 256 && EYE_FIXED.bottom === 0.4 && EYE_LIGHTS.top === 0.96, "the count is 256 bins and the mean the 40th percentile's to maker L's top one, 0.96 (the demo's)");
  ok(binOf(EYE_FIXED.minLog - 5) === 0 && binOf(EYE_FIXED.maxLog + 5) === 255 && binOf(binCentreLog(100)) === 100, 'a luminance off the range falls in an end bin, and a bin\'s middle in its own bin');
  ok(Math.log2(1e-7) > EYE_FIXED.minLog && EYE_TUNE_RANGE.low[0] > EYE_FIXED.minLog && EYE_TUNE_RANGE.high[1] < EYE_FIXED.maxLog && EYE_TUNE_RANGE.knee[1] < EYE_FIXED.maxLog, "the count's range holds a moonlit sky's 1e-7 and every dial's range");
  // The demo's weight: round(mix(4, 16, exp(-1.5 d²))).
  let weightsDemo = true;
  for (let x = -1; x <= 1.0001; x += 0.125) for (let y = -1; y <= 1.0001; y += 0.125) if (weightAt(x, y) !== Math.floor(4 + 12 * Math.exp(-1.5 * (x * x + y * y)) + 0.5)) weightsDemo = false;
  ok(weightsDemo && weightAt(0, 0) === 16 && weightAt(1, 1) === 5, "the centre weight is the demo's own: 16 at the middle, 4 plus at the edges, exp(-1.5 d²) between");
  const h = new Float64Array(256);
  const pm = [0, 0];
  percentileMean(h, pm);
  ok(Number.isNaN(pm[0]) && pm[1] === 0, 'an empty count has no mean');
  h[120] = 500;
  percentileMean(h, pm);
  ok(near(pm[0], binCentreLog(120), 1e-12) && pm[1] === 500, 'a count in one bin has that bin\'s middle for its mean');
  h[120] = 50;
  h[160] = 50;
  percentileMean(h, pm);
  ok(near(pm[0], (10 * binCentreLog(120) + 46 * binCentreLog(160)) / 56, 1e-12), 'two halves: the 40th percentile cuts the dark half to 10 of its 50, the 96th the bright to 46 (the sun and the darkest corners never steer it)');
  EYE_LIGHTS.top = 1;
  percentileMean(h, pm);
  ok(near(pm[0], (10 * binCentreLog(120) + 50 * binCentreLog(160)) / 60, 1e-12), "maker L's top percentile moves it: at 1 the bright half is counted whole");
  EYE_LIGHTS.top = 0.96;
  ok(near(fullStops(Math.log2(EYE_TUNE.key)), 0, 1e-12), 'a scene at the key needs nothing made up');
  // The demo's curve written out from its text (in its own units), against ours at the same scene moved into ours.
  const demoStops = (meanDemo: number): number => {
    const clamped = Math.min(Math.max(meanDemo, -14), 4);
    const perceived = clamped < -2 ? -2 + (clamped - -2) * 0.7 : clamped;
    return Math.log2(0.18) - perceived;
  };
  // Our scene is 2^shift as bright as the demo's of the same look, so our exposure is 2^-shift the demo's and the exposed
  // picture (luminance times exposure) is the very same.
  // At the demo's own night (the lead started ours darker-adapting, `EYE_DEMO_NIGHT` keeps the demo's) the curve is the demo's.
  const started = { low: EYE_TUNE.low, share: EYE_TUNE.share };
  EYE_TUNE.low = EYE_DEMO_NIGHT.low;
  EYE_TUNE.share = EYE_DEMO_NIGHT.share;
  let worst = 0;
  for (let m = -24; m <= 8; m += 0.37) worst = Math.max(worst, Math.abs(m + EYE_DEMO.shift + targetStops(m + EYE_DEMO.shift) - (m + demoStops(m))));
  ok(worst < 1e-3, `at the demo's own night, every scene from -24 to 8 in the demo's log2 luminance, moved into ours, is exposed to the very brightness the demo's EXPOSURE_WGSL exposes it to (worst ${worst.toExponential(2)} stops: the dials' four places)`);
  ok(near(targetStops(EYE_TUNE.knee - 4), Math.log2(0.18) - (EYE_TUNE.knee - 0.7 * 4), 1e-12), 'four stops under the knee only 0.7 of each is made up (2.8 of 4)');
  EYE_TUNE.low = started.low;
  EYE_TUNE.share = started.share;
  ok(near(targetStops(-1), Math.log2(0.18) + 1, 1e-12) && near(targetStops(T.knee), Math.log2(0.18) - T.knee, 1e-12), 'between the knee and the top, every stop is made up, to the key');
  ok(near(targetStops(T.knee - 4), Math.log2(0.18) - (T.knee - T.share * 4), 1e-12), `at the starts four stops under the knee only ${T.share} of each is made up`);
  ok(near(targetStops(-40), targetStops(T.low), 1e-12) && near(targetStops(40), targetStops(T.high), 1e-12), 'darker than the darkest scene adapted to, and brighter than the brightest, is left as it is');
  // The investigator's night (Tatooine at night, saber off, the eye's mean -20.8): the base's eye made up 15.4 stops.
  const nightStops = targetStops(-20.8);
  ok(near(nightStops, Math.log2(0.18) - (T.knee + T.share * (T.low - T.knee)), 1e-12) && nightStops < 16.5 && nightStops > 14.5, `a moonlit Tatooine (mean -20.8) is made up ${nightStops.toFixed(2)} stops, near the base's 15.4: dark but readable`);
  // The ease: frame-rate independent, at the demo's rates.
  const settle = (from: number, to: number, hz: number, seconds: number): number => {
    let s = from;
    const n = Math.round(seconds * hz);
    for (let i = 0; i < n; i++) s = easeStops(s, to, 1 / hz);
    return s;
  };
  ok(near(settle(5, 0, 60, 1), settle(5, 0, 144, 1), 1e-9) && near(settle(5, 0, 30, 1), settle(5, 0, 60, 1), 1e-9), 'the ease is the same at 30, 60 and 144 frames a second');
  ok(near(easeStops(1, 0, 0.1), 1 - (1 - Math.exp(-0.26)), 1e-12) && near(easeStops(0, 1, 0.1), 1 - Math.exp(-0.11), 1e-12), "a frame's step is the demo's 1 - exp(-dt · rate): 2.6 a second into light, 1.1 into the dark");
  const glare = settle(5, 0, 60, 1);
  ok(glare < 5 * 0.08, `out of a room 5 stops darker into the street the glare has settled within 1 s (${glare.toFixed(3)} stops left, ${(100 * (1 - glare / 5)).toFixed(1)}%)`);
  const room = settle(0, 5, 60, 2);
  ok(room > 5 * 0.88, `into a room 5 stops darker it reads within 2 s (${room.toFixed(3)} of 5 stops made up, ${(100 * room / 5).toFixed(1)}%)`);
  ok(settle(0, 5, 60, 0.5) < 5 - settle(5, 0, 60, 0.5), 'faster into light than into the dark');
  ok(near(glowOf(4), 1 / 16, 1e-12) && near(exposureOf(4), 16, 1e-12), 'at +4 stops an emissive thing is drawn at a sixteenth, so it shows as it did at an exposure of 1');
  tuneEye({ tune: { glow: 0 } });
  ok(glowOf(4) === 1, 'and with the compensation at nought it glows sixteen times brighter on the screen');
  tuneEye({ tune: { glow: 1 } });
  ok(near(OFF_MEAN * OFF_LEVEL_REF, 0.39, 1e-12) && near(offStops(OFF_LEVEL_REF), Math.log2(0.18 / 0.39), 1e-12), "\"off\" takes today's clear noon on a level surface as the street's measured 0.39 (wave 2's anchor) and brings it to the key: an exposure of 0.18 / 0.39");
  ok(offStops(OFF_LEVEL_REF * 1.4) < offStops(OFF_LEVEL_REF) && offStops(OFF_LEVEL_REF * 1e-6) > 10, '"off" closes for more light and opens for less, by the same curve');
  ok(compensationOf(2) === 4 && compensationOf(-2) === 0.25 && compensationOf(3) === 4 && compensationOf(Number.NaN) === 1, "the player's Exposure is ±2 stops, held");
  // The whole frame as the card works it.
  const out = new Float64Array(EYE_FLOATS);
  h.fill(0);
  const b6 = binOf(Math.log2(EYE_TUNE.key) - 6);
  h[b6] = 1000;
  eyeFrame(h, 0, 1 / 60, true, out);
  ok(near(out[EYE_SLOT.full], Math.log2(EYE_TUNE.key) - binCentreLog(b6), 1e-12) && near(out[EYE_SLOT.target], targetStops(binCentreLog(b6)), 1e-12) && near(out[EYE_SLOT.stops], out[EYE_SLOT.target], 1e-12) && near(out[EYE_SLOT.exposure], 2 ** out[EYE_SLOT.stops], 1e-9), `a scene six stops under the key (${out[EYE_SLOT.full].toFixed(2)} asked, ${out[EYE_SLOT.target].toFixed(2)} made up by the curve) snapped stands at its target, its exposure two to its stops`);
  eyeFrame(h, 0, 1 / 60, false, out);
  ok(out[EYE_SLOT.stops] > 0 && out[EYE_SLOT.stops] < out[EYE_SLOT.target], 'an eased one moves a frame\'s share toward it');
  const said = tuneEye({ tune: { knee: 99, nope: 1, share: 'a' } });
  ok(EYE_TUNE.knee === EYE_TUNE_RANGE.knee[1] && said.length === 3, 'a dial is held to its range, and one not there or not a number is said');
  tuneEye({ tune: { knee: T.knee } });
}

// ---------------------------------------------------------------- 2. the main thread's frame
{
  const i = EYE_IN;
  i.dt = 1 / 144;
  i.air = false;
  i.chain = true;
  i.eye = true;
  i.adapt = 1;
  i.stops = 0;
  i.loading = false;
  i.level = OFF_LEVEL_REF;
  eyeFrameRun();
  ok(EYE_OUT.mode === 0 && EYE_OUT.exposure === 1 && EYE_OUT.glow === 1 && EYE_OUT.renderer === 1 && EYE_FRAME.adapting === 0, "WebGL, SWG's sky, space or a world with no air: today's exposure of 1 and no compensation");
  ok(EYE_FRAME.dtUs === 6944 && Number.isInteger(EYE_FRAME.dtUs), 'the frame\'s time is kept in whole microseconds');
  i.air = true;
  eyeFrameRun();
  ok(EYE_OUT.mode === 2 && EYE_FRAME.adapting === 1 && EYE_OUT.write === false && EYE_OUT.renderer === 1, 'our sky with a chain: the card adapts, the main thread writes nothing, three\'s exposure is the compensation alone');
  // The wave's fixer: a chain drawing on without its eye pass (an Effects switch being prepared: the setting already off, the
  // old chain still drawing; or the computes not landed) is no adapting card: the main thread answers into the buffer the
  // chain's output reads, and three's exposure stays the compensation (the review's frozen exposure).
  i.eye = false;
  i.level = OFF_LEVEL_REF / 2;
  eyeFrameRun();
  ok(EYE_OUT.mode === 1 && EYE_FRAME.adapting === 0 && EYE_OUT.write === true && near(EYE_OUT.stops, offStops(OFF_LEVEL_REF / 2), 1e-12) && EYE_OUT.renderer === 1, "a chain not drawing its eye pass: the sun's height written into the buffer, three's exposure the compensation alone");
  i.eye = true;
  i.level = OFF_LEVEL_REF;
  eyeFrameRun();
  ok(EYE_OUT.mode === 2 && EYE_FRAME.adapting === 1 && EYE_OUT.write === false, 'and with the eye pass back the card adapts again');
  i.stops = 1;
  eyeFrameRun();
  ok(EYE_OUT.renderer === 2, 'a stop of compensation doubles three\'s exposure');
  i.adapt = 0;
  i.level = OFF_LEVEL_REF / 8;
  eyeFrameRun();
  ok(EYE_OUT.mode === 1 && near(EYE_OUT.stops, offStops(OFF_LEVEL_REF / 8), 1e-12) && near(EYE_OUT.stops, offStops(OFF_LEVEL_REF) + 3, 1e-12) && EYE_OUT.write === true && EYE_OUT.renderer === 2, "the row off: the sun's height (an eighth of noon's light, 3 stops more made up), written into the buffer, three's exposure still the compensation where a chain multiplies by the buffer");
  eyeFrameRun();
  ok(EYE_OUT.write === false, 'and a frame whose answer did not move writes nothing');
  i.chain = false;
  eyeFrameRun();
  ok(near(EYE_OUT.renderer, 2 * exposureOf(offStops(OFF_LEVEL_REF / 8)), 1e-12), 'with no chain three\'s exposure carries the eye\'s answer too (every material tone-maps itself onto the canvas)');
  i.chain = true;
  i.adapt = 1;
  i.loading = true;
  eyeFrameRun();
  ok(EYE_FRAME.snap === 1, 'a loading screen takes the eye at once');
  i.loading = false;
  i.dt = 3;
  eyeFrameRun();
  ok(EYE_FRAME.dtUs === 250000 && EYE_FRAME.snap === 0, 'a long frame is held to a quarter second');
  i.stops = 0;
}

// ---------------------------------------------------------------- 3. the card's side over a stand-in renderer
{
  const calls: string[] = [];
  const r: Any = {
    toneMappingExposure: 1,
    setRenderTarget(t: Any) {
      calls.push(`target:${t?.texture?.name ?? 'none'}`);
    },
    render(m: Any) {
      calls.push(`render:${m.name}`);
    },
    compute(n: Any) {
      calls.push(`compute:${n.count}`);
    },
  };
  const pass = new GpuEyePass(r);
  ok(pass.id === 'exposure' && fxPassIndex('exposure') < fxPassIndex('bloom') && fxPassIndex('exposure') > fxPassIndex('taa'), "the eye is the registry's pass after the edge smoothing and before the bloom");
  pass.setSize(1600, 900, {} as Any);
  const input: Any = { width: 1600, height: 900, texture: new THREE.Texture() };
  const ctx: Any = { renderer: r };
  EYE_FRAME.adapting = 0;
  ok(pass.render(ctx, input, null) === false && calls.length === 0, 'while the card does not adapt the pass draws nothing');
  EYE_FRAME.adapting = 1;
  ok(pass.render(ctx, input, null) === false, 'and adapting it writes nothing into the chain (the picture goes on as it came)');
  ok(calls[0] === 'target:fx.gpu.eye.quarter' && calls[1] === 'render:fx.gpu.eye.copy' && calls[2] === `compute:${400 * 225}` && calls[3] === 'compute:1', `the quarter copy (400 by 225 for 1600 by 900), the count over its every texel and the eye of one invocation, in order (${calls.join(', ')})`);
  const m = pass.materials();
  ok(m.length === 1 && (m[0].into as Any)?.width === 400 && m[0].where === 'target', "the copy's pipeline is warmed against its own target (WebGPU keys a pipeline on its target's format)");
  pass.dispose();
  // The wave's fixer: the scene stored pre-exposed (`preExpose.ts`). The roll is the kit's third compute, one invocation,
  // dispatched once a drawn frame only once the computes have landed (the stand-in has no asynchronous compile: landed at once).
  calls.length = 0;
  const rolls = PRE_ROLLS.n;
  ok(eyeReady(), "the eye's computes have landed (the stand-in builds at once)");
  eyeBegin(r);
  ok(calls.length === 1 && calls[0] === 'compute:1' && PRE_ROLLS.n === rolls + 1, `a drawn frame's begin rolls the pre-exposure: one compute of one invocation (${calls.join(', ')})`);
  const pa = PRE_ATTR.array as Float32Array;
  ok(pa.length === 2 && pa[PRE_SLOT.now] === 1 && pa[PRE_SLOT.last] === 1, 'the buffer starts at [1, 1]: the scene stored as it always was until the card rolls it');
  ok(PRE_FIXED.cap === 30000 && PRE_FIXED.cap * 2 < 65504 && PRE_FIXED.least === 2 ** -12 && PRE_FIXED.most === 2 ** 24, "the store's cap leaves two draws added inside a half float, and pre is held to the eye's own range of stops");
  const st = new THREE.RenderTarget(4, 4);
  const other = new THREE.RenderTarget(4, 4);
  markSceneTarget(st);
  ok(isSceneTarget(st) && !isSceneTarget(other) && !isSceneTarget(null), "only a chain's marked scene target is stored pre-exposed (a capture, a product, a pass's own target and the canvas are not)");
  const chainMat = new THREE.MeshBasicMaterial();
  chainMat.userData.swgChain = true;
  const was = { ...SKY_AT_LOAD };
  SKY_AT_LOAD.read = false;
  ok(takesPre(new THREE.MeshBasicMaterial()) && !takesPre(chainMat), "a scene material takes the store before the sky is read; a chain pass's never");
  SKY_AT_LOAD.read = true;
  SKY_AT_LOAD.ours = true;
  ok(takesPre(new THREE.MeshStandardMaterial()), 'under our sky every scene material takes it');
  SKY_AT_LOAD.ours = false;
  ok(!takesPre(new THREE.MeshStandardMaterial()), "under SWG's sky none built once the sky is read (no roll ever moves it there)");
  Object.assign(SKY_AT_LOAD, was);
  const stored = preExposedOut((TSL as Any).vec4(1, 0.5, 0.25, 1));
  ok(stored?.isNode === true && reachesAttr(stored, PRE_ATTR), "the store is a node over the colour that reads the card's pre-exposure buffer");
  // The glow part.
  const std = new THREE.MeshStandardMaterial();
  const basic = new THREE.MeshBasicMaterial();
  const shader = new THREE.ShaderMaterial();
  ok(eyeGlowPart.applies(std) && eyeGlowPart.applies(basic) && eyeGlowPart.applies(new THREE.SpriteMaterial()) && !eyeGlowPart.applies(shader) && !eyeGlowPart.applies(new THREE.MeshDepthMaterial()), "the glow part takes three's lit and unlit classic materials, decided by their kind (in three's key), never a shader or depth material");
  const n1: Any = { emissiveNode: null, colorNode: null };
  const n2: Any = { emissiveNode: null, colorNode: null };
  const before = { ...EYE_GLOW_STATS };
  eyeGlowPart.apply(n1, std);
  eyeGlowPart.apply(n2, basic);
  ok(n1.emissiveNode !== null && n1.colorNode === null && n2.colorNode !== null && n2.emissiveNode === null && EYE_GLOW_STATS.lit === before.lit + 1 && EYE_GLOW_STATS.unlit === before.unlit + 1, "a lit material's emissive term and an unlit one's colour take the glow, nothing else");
  // The wave's fixer (the review's third finding): a material that skips tone mapping takes no exposure straight onto the
  // canvas (the inline output gives it the sRGB curve alone), so its glow there is 1: its graph reads the canvas's uniform, a
  // tone-mapped one's does not. Found by walking the graph for the very uniform `toCanvasNode()` hands out.
  const bolt = new THREE.MeshBasicMaterial();
  bolt.toneMapped = false;
  const lamp = new THREE.MeshStandardMaterial();
  lamp.toneMapped = false;
  const n3: Any = { emissiveNode: null, colorNode: null };
  const n4: Any = { emissiveNode: null, colorNode: null };
  const untoned = EYE_GLOW_STATS.untoned;
  eyeGlowPart.apply(n3, bolt);
  eyeGlowPart.apply(n4, lamp);
  const canvas = toCanvasNode();
  ok(reaches(n3.colorNode, canvas) && reaches(n4.emissiveNode, canvas) && !reaches(n2.colorNode, canvas) && !reaches(n1.emissiveNode, canvas) && EYE_GLOW_STATS.untoned === untoned + 2, 'an unlit or lit material that skips tone mapping takes no glow straight onto the canvas (its graph reads the canvas uniform); a tone-mapped one\'s graph never does');
  const v0 = EYE_ATTR.version;
  EYE_OUT.exposure = 2;
  EYE_OUT.glow = 0.5;
  EYE_OUT.stops = 1;
  writeEyeCpu();
  const a = EYE_ATTR.array as Float32Array;
  ok(a[EYE_SLOT.exposure] === 2 && a[EYE_SLOT.glow] === 0.5 && a[EYE_SLOT.stops] === 1 && EYE_ATTR.version > v0, "the main thread's answer goes into the buffer and is marked for upload");
  EYE_IN.air = true;
  EYE_IN.chain = false;
  EYE_IN.adapt = 1;
  EYE_IN.stops = 0;
  EYE_IN.level = OFF_LEVEL_REF / 4;
  eyeFrameGpu(r);
  ok(near(r.toneMappingExposure, exposureOf(offStops(OFF_LEVEL_REF / 4)), 1e-12), "with Effects off three's exposure is the eye's answer (the sun's height)");
  EYE_IN.chain = true;
  EYE_IN.air = false;
}

// ---------------------------------------------------------------- 4. every reader reads the buffer; WebGL keeps its line
{
  const chain = text('src/core/gpu/gpuChain.ts');
  // The wave's fixer moved these three: the picture is stored times `pre` (`preExpose.ts`), so each reads the eye's exposure
  // over the store's factor (`storedOf()`, the buffer's `pre` held off nought).
  ok(/return vec4\(c\.rgb\.mul\(eyeExposureNode\(\)\.div\(storedOf\(\)\)\), c\.a\);/.test(chain), "the chain's output multiplies the picture by the eye's exposure over the store's before three's tone mapping");
  ok(/dot\(texel\.xyz, vec3\(lum\[0\], lum\[1\], lum\[2\]\)\)\.mul\(eyeExposureNode\(\)\.div\(storedOf\(\)\)\)/.test(chain), "SWG's sky's bloom (three's): its threshold is held against the luminance as the eye exposes it, the store taken back off");
  // The sky and light fix round: under our sky the demo's bloom weighs its first level's Karis average by the exposed luminance.
  ok(/const ex = max\(eyeExposureNode\(\)\.div\(storedOf\(\)\), 1e-4\);/.test(text('src/core/gpu/gpuBloomMix.ts')), "our sky's bloom (the demo's): its Karis weights take the luminance as the eye exposes it, the store taken back off (the demo's max(exposure, 1e-4))");
  ok(/const pivot = pivot0\.mul\(storedOf\(\)\)\.div\(max\(eyeExposureNode\(\), 1e-8\)\);/.test(chain), "the grade turns about display grey at the eye's exposure, in the stored picture's units");
  ok(/return max\(preNode\(\), PRE_FIXED\.least\);/.test(chain) && /clamp\(c\.rgb, vec3\(0\), vec3\(storedOf\(\)\.mul\(CHAIN_NUMBERS\.sanitize\.ceiling\)\)\)/.test(chain) && /m\.userData\.swgChain = true;/.test(chain), "under SWG's sky the sanitize's ceiling is the scene's in the stored units, and a chain pass's own material takes no store");
  // The sky and light fix round: under our sky the ceiling is the stored picture's own, the bloom's six levels' sum inside a half float.
  ok(/if \(ours\) return vec4\(clamp\(c\.rgb, vec3\(0\), vec3\(CHAIN_NUMBERS\.sanitize\.stored\)\), 1\);/.test(chain) && /sanitizeGraph\(this\.material\.uniforms as never, skyOurs\(\)\)/.test(text('src/core/gpu/gpuChainPasses.ts')), "under our sky the sanitize holds the stored picture to its own ceiling, chosen by the sky read at load");
  ok(/const history = storedNow\(vec4\(p\.history\.sample\(r\.historyUv\)\.level\(0\)\)\)\.toVar\('swgTaaFH'\);/.test(text('src/core/gpu/taa/taaGraphs.ts')) && /const history = storedNow\(vec4\(p\.history\.sample\(r\.historyUv\)\.level\(0\)\)\)\.toVar\('swgTaaUH'\);/.test(text('src/core/gpu/taa/taaGraphs.ts')) && /return vec4\(h\.rgb\.mul\(preRatioNode\(\)\), h\.a\);/.test(text('src/core/gpu/taa/taaGraphs.ts')), "both edge smoothings bring last frame's history to this frame's store (pre over preLast)");
  const haze = text('src/sky/air/airHaze.ts');
  ok(/const ls = l\.mul\(storedOf\(\)\)\.toVar\('swgHazeLS'\);/.test(haze) && /out\.assign\(c\.rgb\.mul\(t\)\.add\(ls\.mul\(abs\(s\.a\)\)\)\.add\(s\.rgb\)\);/.test(haze) && /clamp\(out, vec3\(0\), vec3\(CHAIN_NUMBERS\.sanitize\.stored\)\)/.test(haze), "the haze pass adds the air's light in the stored units, its ceiling the sanitize's own under our sky (the sky and light fix round)");
  const ssao = text('src/core/gpu/gpuSsao.ts');
  ok(/\.mul\(stored\)\.toVar\(\);/.test(ssao) && /fogColor\.mul\(stored\)/.test(ssao) && /max\(ceiling, stored\.mul\(N\.ceilingFloor\)\)/.test(ssao), "the occlusion's lit ceiling, its floor and the fog's colour are stood in the stored units");
  ok(/\.div\(max\(preNode\(\), PRE_FIXED\.least\)\);\r?\n    return vec4\(log2\(max\(l, Math\.pow\(2, -30\)\)\), 0, 0, 1\);/.test(text('src/sky/exposure/eyeGpu.ts')), "the eye's copy counts the scene's own luminance, the store taken back off");
  ok(/markSceneTarget\(t\);\r?\n      return t;/.test(text('src/core/gpu/gpuChainPasses.ts')), "every chain's scene target is marked for the store's gate");
  ok(/installInline\(renderer, LOOKS_AT_LOAD\.inline\);\r?\n(  \/\/.*\r?\n)+  installPreExpose\(\);/.test(text('src/core/gpu/start.ts')), "the store is installed straight after the inline output's own, before any material is built");
  const progs = text('src/core/gpu/gpuPrograms.ts');
  ok(/const c = weather \? t\.mul\(vColour\) : withGlow\(t\.mul\(vColour\)\);/.test(progs) && /withGlow\(vec4\(colour\.mul\(across\.mul\(along\)\.mul\(vFade\)\.mul\(bright\)\), 1\), true\)/.test(progs), "the client's particles and the saber take the glow (the saber's straight onto the canvas none), the weather's rain the eye");
  ok(/if \(skyOurs\(\)\) fx\.registerPass\(new GpuEyePass\(renderer\)\);/.test(text('src/core/gpu/gpuChainPasses.ts')), "the spine registers the eye under our sky alone, so SWG's sky's chain is the one it was");
  ok(/colour\.mul\(k\.bloomCap\.div\(lum\)\), colour\)\.div\(max\(eyeExposureNode\(\), f\.exposure\)\);/.test(text('src/core/gpu/gpuCard.ts')), "a leaf card drawn as shown (the 'client' curve) is over the eye's exposure, so a dark night's eye does not blow it white");
  ok(/LOOK_PARTS\.push\(lightHoldPart, detailPart, specPart, cardPart, eyeGlowPart\);/.test(text('src/core/gpu/start.ts')), 'the glow part goes on last, after every look part');
  const main = text('src/main.ts');
  ok((main.match(/if \(!GPU\.webgpu\) this\.renderer\.toneMappingExposure = S\.exposure;/g) ?? []).length === 2, "WebGL's exposure is its own row's, at boot and when the row moves, as before");
  ok(/GPU\.rt!\.eye\.frame\(\);\r?\n      \}\r?\n      const screenHides = LOADING_TUNE\.screenDraws && this\.loadingScreen\.opaque;\r?\n      if \(!screenHides/.test(main), "the eye's frame runs on WebGPU just before the frame's draw");
  ok(/e\.eye = this\.postfx !== null && this\.postfx\.passWanted\('exposure'\) && GPU\.rt!\.eye\.ready\(\);/.test(main), "the main thread knows whether the chain draws its eye pass this frame (the review's frozen exposure during an Effects switch)");
  ok(/info\.triangles = 0;\r?\n(    \/\/.*\r?\n)+    if \(GPU\.webgpu && this\.postfx\) GPU\.rt!\.eye\.begin\(\);\r?\n(    \/\/.*\r?\n)+    this\.world\.beginWaterFrame\(/.test(main) && (main.match(/GPU\.rt!\.eye\.begin\(\)/g) ?? []).length === 1, "the pre-exposure is rolled once a drawn frame with a chain, before the scene is stored, a WebGPU guard with no WebGL line");
  ok(/if \('exposure' in changed && !\('exposureStops' in changed\)\) changed\.exposureStops = s\.exposureStops;/.test(text('src/core/settings.ts')), "an old brightness saved for WebGL takes WebGPU's stops beside it, so the migration runs once");
  ok(/exposureStops: 0,\r?\n  eyeAdapt: 1,/.test(text('src/core/settings.ts')), 'WebGPU\'s rows start at the eye\'s own exposure, adapting');
}

// ---------------------------------------------------------------- 5. the eye's dials
{
  const set = eyeDialSet();
  ok(set.helper === 'exposure' && eyeDialsFor('exposure') === set && eyeDialsFor('sky') === null, "the eye's dials are the `exposure` helper's");
  let n = 0;
  const keys: string[] = [];
  for (const g of set.groups) {
    for (const d of g.dials) {
      if (d.kind !== 'number') continue;
      keys.push(d.key);
      if (d.key.startsWith('tune.')) n++;
      const was = d.get();
      d.set(d.max + 100);
      const top = d.get();
      d.set(d.min - 100);
      const bottom = d.get();
      d.set(was);
      ok(near(top, d.max, 1e-12) && near(bottom, d.min, 1e-12) && near(d.get(), was, 1e-12) && /^(tune\.|lights\.|dither$)/.test(d.key), `the dial ${d.key} sets through its helper's own path (exposure's tune, lights or dither) and is held to ${d.min} to ${d.max}`);
    }
  }
  ok(n === Object.keys(EYE_TUNE).length, 'every one of the eye\'s numbers of feel is a dial');
  // The sky and light fix round: maker L's Carried lights and top percentile, and the output's dither, join the same set.
  ok(keys.includes('lights.carried') && keys.includes('lights.top') && keys.includes('dither') && OUTPUT_DITHER.steps === 1, "the `exposure` set holds maker L's Carried lights and the eye's top percentile, and the output's dither (1 step to start)");
}

// ---------------------------------------------------------------- 6. the sky's match record
{
  const mem = new Map<string, string>();
  const store: MatchStore = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
  const rec: SkyMatch = {
    name: 'tatooine-noon',
    saved: '2026-11-21T12:00:00.000Z',
    from: 'WebGPU, our sky',
    planet: 'tatooine',
    zone: null,
    pack: 'tatooine',
    stand: { x: 3528.4, y: 5.1, z: -4804.2, heading: 1.2 },
    camera: { x: 3531, y: 7.5, z: -4800, qx: 0.01, qy: 0.7, qz: -0.02, qw: 0.71, fov: 60 },
    time: 0.5,
    weather: { level: 0, kind: null, family: 'global' },
  };
  ok(isMatch(rec), 'a whole record is a match');
  ok(!isMatch({ ...rec, camera: { ...rec.camera, fov: 0 } }) && !isMatch({ ...rec, stand: { x: 1 } }) && !isMatch({ ...rec, time: Number.NaN }) && !isMatch(null), 'a record with a field missing or out of reason is refused, never half used');
  ok(saveMatch(store, rec) && readMatches(store)['tatooine-noon']?.camera.qw === 0.71, 'a match saved is read back whole (another tab of the address reads the same storage)');
  mem.set('swg.skyMatch', JSON.stringify({ ...JSON.parse(mem.get('swg.skyMatch')!), bad: { name: 'bad' } }));
  ok(Object.keys(readMatches(store)).join() === 'tatooine-noon', 'a broken entry beside it is left out');
  ok(matchList(store)[0].hour === '12:00' && clockOf(0.75) === '18:00' && clockOf(0) === '00:00', 'the list says each one\'s hour by the clock');
  holdFrom(rec);
  ok(MATCH_HOLD.on && MATCH_HOLD.name === 'tatooine-noon' && MATCH_HOLD.qy === 0.7 && MATCH_HOLD.fov === 60, 'held, the camera\'s place, turn and field of view are kept for the frame to put');
  MATCH_HOLD.on = false;
  ok(forgetMatch(store, 'tatooine-noon') && !forgetMatch(store, 'tatooine-noon') && Object.keys(readMatches(store)).length === 0, 'and one can be let go of');
  const throwing: MatchStore = { getItem: () => '{', setItem: () => { throw new Error('full'); } };
  ok(Object.keys(readMatches(throwing)).length === 0 && saveMatch(throwing, rec) === false && saveMatch(null, rec) === false, 'a storage refused or unreadable keeps nothing and says so');
  const main = text('src/main.ts');
  ok(/if \(MATCH_HOLD\.on\) \{[\s\S]{0,400}c\.quaternion\.w = h\.qw;[\s\S]{0,200}c\.updateProjectionMatrix\(\);/.test(main), 'the frame puts the camera exactly as held, the projection made again only when the field of view moved');
}

// ---------------------------------------------------------------- 7. the ozone's limits as dials
{
  ok(AIR_OZONE.min === OZONE_MIN && AIR_OZONE.max === OZONE_MAX && OZONE_MIN === 0.75 && OZONE_MAX === 4, "every world's limits start at wave 1's three quarters and four times Earth's (what the owner has seen)");
  const pair: [number, number] = [0, 0];
  ok(ozoneOf('naboo', pair)[0] === 0.75 && pair[1] === 4 && airDialsOf('naboo').ozoneMin === 0, "a world's own limits start at nought: the all-worlds ones");
  const v0 = AIR_DIAL_STATE.version;
  ok(tuneAirDials({ all: { ozoneMax: 2.5 } }).length === 0 && AIR_OZONE.max === 2.5 && AIR_DIAL_STATE.version > v0 && ozoneOf('naboo', pair)[1] === 2.5, 'the all-worlds top moved moves every world without its own');
  tuneAirDials({ naboo: { ozoneMax: 6, ozoneMin: 1 } });
  ok(ozoneOf('naboo', pair)[0] === 1 && pair[1] === 6 && ozoneOf('tatooine', pair)[1] === 2.5, "and a world's own wins for that world alone");
  tuneAirDials({ naboo: { ozoneMax: 0.5 } });
  ok(ozoneOf('naboo', pair)[1] === 1, 'the most is never under the least');
  ok(tuneAirDials({ all: { ozoneMax: 99 } })[0].includes('held') && AIR_OZONE.max === 12, 'held to the range');
  // The fit inside the limits, whatever its target asks.
  const rec = worldRecord('naboo');
  const red = new Float64Array([0.3, 0.05, 0.02]);
  const blue = new Float64Array([0.01, 0.03, 0.4]);
  const s1 = fitOzone(rec, red, 0.75, 4);
  const s2 = fitOzone(rec, blue, 0.75, 2);
  const s3 = fitOzone(rec, red, 1.5, 3);
  ok(s1 >= 0.75 - 1e-9 && s1 <= 4 + 1e-9 && s2 <= 2 + 1e-9 && s2 >= 0.75 && s3 >= 1.5 - 1e-9 && s3 <= 3 + 1e-9, `the fit stands inside the limits it is handed (${s1.toFixed(3)}, ${s2.toFixed(3)}, ${s3.toFixed(3)})`);
  ok(near(fitOzone(rec, red), fitOzone(rec, red, OZONE_MIN, OZONE_MAX), 1e-12), 'and with none handed it is wave 1\'s fit exactly');
  // The run asks for a refit when they move.
  tuneAirDials({ all: { ozoneMin: 0.75, ozoneMax: 4 }, naboo: { ozoneMin: 0, ozoneMax: 0 } });
  const run = new AirRun('tatooine', { sunElevationDegrees: 67.5, blocks: [] }, (f) => f);
  let asked = 0;
  (run as Any).ask = () => void asked++;
  const day: Any = { sunDir: new THREE.Vector3(0, 0.9, 0.43).normalize(), moonDir: new THREE.Vector3(0, -0.9, -0.43).normalize(), isDay: true };
  const mix: Any = { mixLength: 0, mixBlock: () => null, mixWeights: new Float64Array(4) };
  const L: Any = { main: new THREE.Color(), mainScale: 1, ambient: new THREE.Color(), ambientScale: 1, bounce: new THREE.Color(), bounceScale: 1, fill: new THREE.Color(), fillScale: 1, fog: new THREE.Color(), fogDensity: 0.01, clear: new THREE.Color() };
  run.frame(day, mix, L);
  ok(asked === 0, 'a frame with nothing moved asks for nothing');
  tuneAirDials({ all: { ozoneMax: 3 } });
  run.frame(day, mix, L);
  ok(asked === 1 && run.refits === 1, 'the all-worlds top moved: the world on is fitted again (in the worker, numbers only)');
  tuneAirDials({ tatooine: { steer: 0.1 } });
  run.frame(day, mix, L);
  ok(asked === 1, 'another dial moved asks for no refit');
  tuneAirDials({ all: { ozoneMax: 4 }, tatooine: { steer: 0 } });
  // 8. The night light and the level light.
  run.frame(day, mix, L);
  ok(AIR.frame.lightDir.equals(day.sunDir) && run.twin.out.night === false && AIR.frame.level > 1, `by day the main light shines from the sun, and the level light is the day's (${AIR.frame.level.toFixed(3)})`);
  const nightDay: Any = { sunDir: new THREE.Vector3(0, -0.9, 0.43).normalize(), moonDir: new THREE.Vector3(0, 0.9, -0.43).normalize(), isDay: false };
  // The twin sums its sky over a few frames (wave 1's spread): a jump to night is read once they are summed.
  for (let k = 0; k < 12; k++) run.frame(nightDay, mix, L);
  ok(AIR.frame.lightDir.equals(nightDay.moonDir) && run.twin.out.night === true && AIR.frame.level > 0 && AIR.frame.level < 1e-4, `by night it shines from the moon, SWG's nearly full one (the level light ${AIR.frame.level.toExponential(2)})`);
  const twilight: Any = { sunDir: new THREE.Vector3(0, 0.05, 1).normalize(), moonDir: new THREE.Vector3(0, -0.05, -1).normalize(), isDay: false };
  run.frame(twilight, mix, L);
  ok(AIR.frame.lightDir.equals(twilight.sunDir), "past the clock's split with the sun still up, the brightest body up is still the sun");
  run.dispose();
}

// ---------------------------------------------------------------- 9. the Exposure row's migration runs once (the wave's fixer)
{
  // The game's own load and save over a stand-in storage (the review's sixth finding): a file from before the wave holds the
  // old row's factor; the first start takes it into stops, the player moves the new row to nought, the game saves, and the
  // next start keeps the nought, where it took the old factor again at every start.
  const mem: Record<string, string> = {};
  const g = globalThis as Any;
  const had = g.localStorage;
  g.localStorage = { getItem: (k: string) => (k in mem ? mem[k] : null), setItem: (k: string, v: string) => void (mem[k] = String(v)), removeItem: (k: string) => void delete mem[k] };
  try {
    const S = await import('../../../src/core/settings.ts');
    mem['swg.settings'] = JSON.stringify({ exposure: 1.5 });
    const first = S.loadSettings();
    ok(first.exposure === 1.5 && first.exposureStops === 0.5, "a brightness saved on the old row starts WebGPU's Exposure at the same factor in stops (1.5 is half a stop)");
    first.exposureStops = 0;
    S.saveSettings(first);
    const saved = JSON.parse(mem['swg.settings']);
    ok(saved.exposure === 1.5 && saved.exposureStops === 0, 'saved, the old brightness keeps its row for WebGL and the stops stand beside it at their nought');
    const second = S.loadSettings();
    ok(second.exposure === 1.5 && second.exposureStops === 0, 'the next start keeps the nought the player chose (the old factor is taken once)');
    second.exposure = 1;
    S.saveSettings(second);
    ok(!('swg.settings' in mem), 'with every setting at its default again nothing is saved (the stops ride only beside an old brightness)');
  } finally {
    g.localStorage = had;
  }
}

console.log(`\neye: ${passed} checks passed`);
