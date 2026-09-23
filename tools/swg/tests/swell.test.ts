// The CPU's swell against the shader's own: `src/world/swellMath.ts` claims to be the water's
// vertex arithmetic, and this is where that claim has to survive.
//
// Two kinds of check, deliberately kept apart.
//
//   **Pinned against the GLSL's own text.** Every constant the mirror carries -- the dispersion's
//   gravity, the two fades' edges, the steepness, the shaded scale, the near sea's quad -- is read
//   out of `src/world/water.ts` and `src/world/world.ts` as text and compared with the module's.
//   A number moved in the shader fails this file rather than quietly leaving a hull bobbing on a sea
//   that is no longer drawn. The generator's own numbers are pinned too, because the figures this
//   file reports (the reach, the periods, what the mesh carries) are worked out from them and would
//   otherwise go stale in silence.
//
//   **Properties, not restatements.** The arithmetic is checked by things that would still fail if
//   the formula were written out wrongly in both places: a wave repeats after exactly its own
//   wavelength and after exactly its own period, it travels at omega/k, the rate is the height's own
//   derivative by central difference, the solve's answer really is a fixed point of the displacement,
//   and the closed form for what a 15 m quad carries is checked against a sine actually sampled and
//   interpolated rather than against itself.
//
// Nothing here is the game's: there was no swell on the CPU before this, and the sea state itself is
// ours. What is not ours to choose is that the two sides agree, which is all this file is for.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  SWELL_FADE,
  SWELL_GRAVITY,
  SWELL_SEA_QUAD,
  SWELL_SHADED_CALM,
  SWELL_STEEP,
  SWELL_STEEP_EPS,
  swellDisplacement,
  swellFade,
  swellHeight,
  swellHeightSolved,
  swellPeriod,
  swellQuadError,
  swellQuadGain,
  swellRate,
  swellReach,
  swellResolves,
  swellSmoothstep,
  swellWavelength,
  type SwellDisplacement,
  type SwellWave,
} from '../../../src/world/swellMath.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const srcDir = fileURLToPath(new URL('../../../src/', import.meta.url));
const waterSrc = readFileSync(join(srcDir, 'world/water.ts'), 'utf8');
const worldSrc = readFileSync(join(srcDir, 'world/world.ts'), 'utf8');
const bodiesSrc = readFileSync(join(srcDir, 'world/waterBodies.ts'), 'utf8');
const mathSrc = readFileSync(join(srcDir, 'world/swellMath.ts'), 'utf8');
const probeSrc = readFileSync(join(srcDir, 'world/swellProbe.ts'), 'utf8');
const inWater = (needle: string) => waterSrc.includes(needle);
const inWorld = (needle: string) => worldSrc.includes(needle);

// --- 1. the height the mirror answers is the one the shader displaces a vertex by ---

{
  ok(inWater('float a = w.w * scale;'), "the shader scales each wave's amplitude, which is what makes the height linear in the scale");
  ok(inWater('float phase = k * dot(w.xy, p) - uOmega[i] * uTime + warp;'), 'the phase is k (d . p) - omega t, with the warp added on top of it');
  // `disp.y += a * s;` is only half the claim: which of sine and cosine `s` is, is the other half,
  // and swapping the two lines below would leave the height riding the cosine with every property
  // check in this file still green (a cosine repeats after a wavelength and a period too).
  ok(inWater('float s = sin(phase);'), "the sine of that phase is what the shader calls `s`");
  ok(inWater('float c = cos(phase);'), 'and its cosine is what it calls `c`');
  ok(inWater('disp.y += a * s;'), 'so the height is the plain sum of amplitude times the SINE of the phase');
  ok(inWater('disp.xz += w.xy * (steep * a * c);'), 'and the sideways carry rides the COSINE, with the steepness belonging to it and to nothing else');
  ok(inWater('float steep = min(0.55 / (k * a * float(${WAVE_COUNT}) + 1e-4), 1.0);'), 'the steepness is 0.55 over k a n, held at 1, with the set\'s own size as n');
  ok(SWELL_STEEP === 0.55 && SWELL_STEEP_EPS === 1e-4, 'and the mirror carries those two numbers, not numbers of its own');
  ok(inWater('const WAVE_COUNT = 8;'), 'the set is eight waves');
  ok(inWater('for (int i = 0; i < ${WAVE_COUNT}; i++) {'), "and the loop's count is that same number, which is why the mirror may use the array's own length for both");

  // The warp is one value for the whole set at a point, not one per wave. That is what makes
  // leaving it out a shift of the sea's phase rather than eight unrelated errors.
  const loop = waterSrc.indexOf('for (int i = 0; i < ${WAVE_COUNT}; i++) {');
  const warp = waterSrc.indexOf('float warp = phaseWarp(p);');
  ok(warp > 0 && loop > warp, 'the phase warp is drawn once for the point, outside the loop, so every wave takes the same shift');
  ok(mathSrc.includes('phaseWarp') && !mathSrc.includes('function swellPhaseWarp'), 'the mirror names the warp in its own comments and does not implement one');
}

// --- 1b. WHERE the vertex program asks, which is the point the mirror is asked about ---
//
// Everything above is inside `gerstner`. What the mirror rests on just as heavily is the vertex
// program's own call: the argument it passes for `p` and the argument it passes for `scale`. The
// mirror answers "the height at a world xz", and that is only the shader's surface because the
// vertex stage evaluates the waves at the vertex's UNDISPLACED world xz. The fragment stage does
// not -- it evaluates at `vWaterXZ`, the point AFTER the sideways carry -- so the two stages already
// ask at different places, and anybody reconciling them would edit exactly this line. If they did,
// the mirror would silently answer a different surface with every property check in this file green.

{
  const vertexCall = waterSrc.indexOf('gerstner(wp.xz, fade, disp, n, crest);');
  ok(vertexCall > 0, 'the vertex program evaluates the waves at the vertex\'s own undisplaced world xz, at the fade scale -- which is the height the mirror claims to answer');
  ok(inWater('vec4 wp = modelMatrix * vec4(transformed, 1.0);'), 'and `wp` is that vertex in world space, so `wp.xz` really is a world xz and not a local or a uv one');
  const fadeLine = waterSrc.indexOf('float fade = uWaveHeight * (1.0 - smoothstep(900.0, 1400.0, dist)) * smoothstep(0.3, 5.0, waterDepth(wp.xz));');
  ok(fadeLine > 0 && fadeLine < vertexCall, 'the `fade` it is handed is the two-fade line just above it, so `swellFade` mirrors the scale the drawn sea is really asked for');
  ok(inWater('transformed += disp;'), 'the whole displacement moves the vertex, sideways term and all, which is why the height at an xz is an inverse problem');
  ok(inWater('vWaterXZ = wp.xz + disp.xz;'), 'and the varying the fragment stage reads is the DISPLACED point, not the one the vertex asked at');
  const fragmentCall = waterSrc.indexOf('gerstner(vWaterXZ, calm, disp, wn, crest);');
  ok(fragmentCall > vertexCall, 'so the fragment stage asks at a different point and at a different scale from the vertex stage');
  ok(!waterSrc.includes('gerstner(vWaterXZ, fade,') && !waterSrc.includes('gerstner(wp.xz, calm,'), 'and neither has been reconciled onto the other, which would move the surface out from under this mirror');
}

// --- 2. the dispersion, and with it every period this file quotes ---

{
  ok(inWater('omega.push(Math.sqrt(9.81 * k));'), 'the sea state gives each wave omega = sqrt(9.81 k)');
  ok(SWELL_GRAVITY === 9.81, 'and the mirror uses that same 9.81 rather than standard gravity, or its rhythms would not be the shader\'s');
  for (const k of [0.1, 0.25, 0.5, 0.9]) {
    const omega = (2 * Math.PI) / swellPeriod(k);
    ok(near(omega * omega, SWELL_GRAVITY * k, 1e-9), `a period at k ${k} really is the one omega^2 = g k gives (omega ${omega.toFixed(4)})`);
  }
  ok(near(swellWavelength((2 * Math.PI) / 25), 25, 1e-9), 'a wavelength and its wavenumber are each other\'s inverse through 2 pi');
  ok(swellPeriod(0) === Infinity && swellWavelength(0) === Infinity, 'and a wave of no wavenumber at all is not a division by zero');
}

// --- 3. the two fades, and the third scale that is not a height ---

{
  ok(inWater('float fade = uWaveHeight * (1.0 - smoothstep(900.0, 1400.0, dist)) * smoothstep(0.3, 5.0, waterDepth(wp.xz));'), 'the vertex program fades the swell by camera distance and by depth, in one line');
  ok(SWELL_FADE.farNear === 900 && SWELL_FADE.farFar === 1400, 'and the mirror carries that distance pair');
  ok(SWELL_FADE.shallowNear === 0.3 && SWELL_FADE.shallowFar === 5, 'and that depth pair');
  ok(inWater('float calm = smoothstep(0.15, 3.0, depth);') && inWater('gerstner(vWaterXZ, calm, disp, wn, crest);'), 'the fragment evaluates the same waves again at a scale of its own, for the normal');
  ok(SWELL_SHADED_CALM.near === 0.15 && SWELL_SHADED_CALM.far === 3, 'the mirror names that scale too');
  ok(SWELL_SHADED_CALM.near !== SWELL_FADE.shallowNear || SWELL_SHADED_CALM.far !== SWELL_FADE.shallowFar, 'and they are different numbers, which is the whole reason the shaded surface and the geometry have never agreed');
  ok(!waterSrc.includes('gerstner(vWaterXZ, calm * uWaveHeight'), 'the shaded scale takes no uWaveHeight at all, so it is not a height and nothing may float on it');

  // GLSL's smoothstep, checked as a curve rather than as its own expression.
  ok(swellSmoothstep(2, 4, 1) === 0 && swellSmoothstep(2, 4, 5) === 1, 'the smoothstep is flat outside its edges');
  ok(near(swellSmoothstep(2, 4, 3), 0.5, 1e-12), 'and exactly a half in the middle');
  ok(near(swellSmoothstep(2, 4, 2.5) + swellSmoothstep(2, 4, 3.5), 1, 1e-12), 'and symmetric about that middle');

  ok(swellFade(1, 0, 100) === 1, 'under the camera in deep water the swell is whole');
  ok(swellFade(1, 2000, 100) === 0, 'past 1400 m it is gone');
  ok(near(swellFade(1, 1150, 100), 0.5, 1e-12), 'and half way out it is half');
  ok(swellFade(1, 0, 0) === 0 && swellFade(1, 0, 0.3) === 0, 'in no water and in a hand\'s breadth of it the sea is flat, which is what holds the shoreline still');
  ok(near(swellFade(1, 0, 2.65), 0.5, 1e-12), 'and half the swell stands in 2.65 m of water');
  ok(swellFade(0, 0, 100) === 0, 'a flat material -- every lake -- fades to nothing whatever the depth');
  ok(swellFade(Number.NaN, 0, 100) === 0, 'and a wave height that is not a number answers 0 rather than passing a NaN on');
  let rising = true;
  for (let d = 0; d < 8; d += 0.1) if (swellFade(1, 0, d + 0.1) < swellFade(1, 0, d) - 1e-12) rising = false;
  ok(rising, 'the swell never falls as the water gets deeper');
}

// --- 4. the sum itself, by properties ---

{
  const one: SwellWave[] = [{ x: 1, y: 0, z: 1, w: 2 }];
  const om = [3];
  ok(swellHeight(one, om, 0, 0, 0, 1) === 0, 'one wave, at the origin, at the start of the clock, is at its mean');
  ok(near(swellHeight(one, om, Math.PI / 2, 0, 0, 1), 2, 1e-12), 'a quarter of a wavelength along its heading it is at its crest, the full amplitude');
  ok(near(swellHeight(one, om, 0, 0, Math.PI / 6, 1), -2, 1e-12), 'and a quarter of its period later, standing still, it is in its trough');
  ok(swellHeight(one, om, 0, 12345, 0, 1) === 0, 'a wave heading along X does not move at all as you walk along Z');

  const k = 0.37;
  const wave: SwellWave[] = [{ x: Math.cos(0.8), y: Math.sin(0.8), z: k, w: 0.4 }];
  const w = [Math.sqrt(SWELL_GRAVITY * k)];
  const lambda = swellWavelength(k);
  const period = swellPeriod(k);
  const base = swellHeight(wave, w, 3, -7, 1.25, 1);
  ok(near(swellHeight(wave, w, 3 + wave[0].x * lambda, -7 + wave[0].y * lambda, 1.25, 1), base, 1e-9), 'the same wave one wavelength along its heading is the same height');
  ok(near(swellHeight(wave, w, 3, -7, 1.25 + period, 1), base, 1e-9), 'and one period later, standing still, it is the same height');
  const speed = w[0] / k;
  ok(near(swellHeight(wave, w, 3 + wave[0].x * speed * 0.5, -7 + wave[0].y * speed * 0.5, 1.75, 1), base, 1e-9), `and it travels at omega/k (${speed.toFixed(2)} m/s), which is what a crest passing a hull means`);

  // The rate is the height's derivative, checked by a difference the module does not compute.
  const h = 1e-4;
  for (const t of [0, 0.37, 1.9, 5.5]) {
    const slope = (swellHeight(wave, w, 3, -7, t + h, 1) - swellHeight(wave, w, 3, -7, t - h, 1)) / (2 * h);
    ok(near(swellRate(wave, w, 3, -7, t, 1), slope, 1e-6), `how fast the surface is rising at t ${t} is the height's own slope (${slope.toFixed(4)} m/s)`);
  }
}

// --- 5. linearity in the scale, and the reach that bounds it ---

{
  const set: SwellWave[] = [
    { x: 1, y: 0, z: 0.8, w: 0.05 },
    { x: 0.6, y: 0.8, z: 0.4, w: 0.12 },
    { x: -0.5, y: 0.866, z: 0.19, w: 0.35 },
  ];
  const om = set.map((s) => Math.sqrt(SWELL_GRAVITY * s.z));
  ok(near(swellHeight(set, om, 11, -4, 2.5, 0.37), swellHeight(set, om, 11, -4, 2.5, 1) * 0.37, 1e-12), 'the height is exactly linear in the scale, which is what lets one card reading answer every scale');
  ok(swellHeight(set, om, 11, -4, 2.5, 0) === 0, 'a scale of 0 is flat water and costs nothing');
  ok(near(swellReach(set, 1), 0.52, 1e-12), 'the reach is the summed amplitudes');
  ok(near(swellReach(set, 0.5), 0.26, 1e-12), 'and it takes the scale with it');
  let worst = 0;
  for (let t = 0; t < 200; t += 0.05) for (let s = 0; s < 7; s++) worst = Math.max(worst, Math.abs(swellHeight(set, om, s * 13.7, s * -4.1, t, 1)));
  ok(worst <= swellReach(set, 1) + 1e-12, `and no height anywhere ever reaches past it (worst seen ${worst.toFixed(4)} of ${swellReach(set, 1)})`);
  ok(worst > swellReach(set, 1) * 0.8, 'though it comes close, so the reach is a real bound and not a loose one');

  ok(swellHeight(set, om, Number.NaN, 0, 0, 1) === 0 && swellHeight(set, om, 0, 0, Number.NaN, 1) === 0 && swellHeight(set, om, 0, 0, 0, Number.NaN) === 0, 'a question asked with a NaN in it answers 0 rather than handing a NaN to a spring');
  ok(swellRate(set, om, Number.NaN, 0, 0, 1) === 0, 'and so does the rate');
  ok(swellHeight(set, [0.9], 0, 0, 0, 1) === swellHeight([set[0]], [0.9], 0, 0, 0, 1), 'a set with fewer omegas than waves is read as far as both arrays go, never past the end of one');
}

// --- 6. the sideways term, and the inverse it makes of a simple question ---

{
  const set: SwellWave[] = [
    { x: 1, y: 0, z: 0.8, w: 0.05 },
    { x: 0.6, y: 0.8, z: 0.4, w: 0.12 },
    { x: -0.5, y: 0.866, z: 0.19, w: 0.35 },
  ];
  const om = set.map((s) => Math.sqrt(SWELL_GRAVITY * s.z));
  const out: SwellDisplacement = { x: 0, y: 0, z: 0 };
  swellDisplacement(set, om, 5, 9, 1.5, 1, out);
  ok(near(out.y, swellHeight(set, om, 5, 9, 1.5, 1), 1e-12), 'the displacement\'s rise is the very height the plain sum answers');
  ok(Math.abs(out.x) > 1e-3 || Math.abs(out.z) > 1e-3, 'and it really does carry the point sideways as well, which is what makes the question an inverse one');
  swellDisplacement(set, om, 5, 9, 1.5, 0, out);
  ok(out.x === 0 && out.y === 0 && out.z === 0, 'flat water carries nothing anywhere');

  // The solve is a fixed point: displace what it found and you land on what was asked.
  const px = 5;
  const pz = 9;
  const solved = swellHeightSolved(set, om, px, pz, 1.5, 1, 8);
  let qx = px;
  let qz = pz;
  for (let i = 0; i < 8; i++) {
    swellDisplacement(set, om, qx, qz, 1.5, 1, out);
    qx = px - out.x;
    qz = pz - out.z;
  }
  swellDisplacement(set, om, qx, qz, 1.5, 1, out);
  ok(near(qx + out.x, px, 1e-6) && near(qz + out.z, pz, 1e-6), 'the authored point the solve finds really is the one the swell carries onto the point asked about');
  ok(near(out.y, solved, 1e-12), 'and the height it answers is that point\'s own rise');

  let sq = 0;
  let mx = 0;
  let n = 0;
  for (let t = 0; t < 30; t += 0.5) {
    for (let s = 0; s < 120; s++) {
      const x = ((s * 17.31) % 400) - 200;
      const z = ((s * 53.9) % 400) - 200;
      const d = swellHeight(set, om, x, z, t, 1) - swellHeightSolved(set, om, x, z, t, 1, 8);
      sq += d * d;
      mx = Math.max(mx, Math.abs(d));
      n++;
    }
  }
  ok(mx > 1e-3, `ignoring the sideways term is a real difference and not a rounding one (worst ${mx.toFixed(4)} m, rms ${Math.sqrt(sq / n).toFixed(4)} m on this set)`);
  ok(mx < swellReach(set, 1), 'but never bigger than the swell itself');
  for (const steps of [1, 2, 4]) {
    let d2 = 0;
    let c = 0;
    for (let t = 0; t < 10; t += 0.5) for (let s = 0; s < 60; s++) {
      const x = ((s * 17.31) % 400) - 200;
      const z = ((s * 53.9) % 400) - 200;
      const d = swellHeightSolved(set, om, x, z, t, 1, steps) - swellHeightSolved(set, om, x, z, t, 1, 12);
      d2 += d * d;
      c++;
    }
    ok(Math.sqrt(d2 / c) < 0.02 / steps, `${steps} step(s) of the solve is within ${Math.sqrt(d2 / c).toExponential(1)} m rms of converged`);
  }
  ok(swellHeightSolved(set, om, 5, 9, 1.5, 1, 0) === swellHeight(set, om, 5, 9, 1.5, 1), 'no steps at all is the forward sum, which is the honest default');
  ok(Number.isFinite(swellHeightSolved(set, om, 5, 9, 1.5, 1, 1e9)), 'and a silly number of steps is capped rather than hanging the physics step');
}

// --- 7. what a 15 m quad can carry, checked against a sine actually sampled ---

{
  ok(inWorld('const WATER_NEAR = 3000;') && inWorld('const WATER_SEGMENTS = 200;'), 'the near sea is a 3000 m plane at 200 segments');
  ok(SWELL_SEA_QUAD === 3000 / 200, `so 15 m a quad, which is the number the mirror carries (${SWELL_SEA_QUAD})`);
  ok(inWorld('new THREE.PlaneGeometry(WATER_NEAR, WATER_NEAR, WATER_SEGMENTS, WATER_SEGMENTS)'), 'and it really is that plane the swell is drawn on');

  ok(swellResolves((2 * Math.PI) / 31, SWELL_SEA_QUAD) && !swellResolves((2 * Math.PI) / 29, SWELL_SEA_QUAD), 'a 15 m quad resolves a 31 m wave and not a 29 m one: two samples a wavelength, and no more forgiving than that');
  ok(near(swellQuadGain(1e-6, SWELL_SEA_QUAD), 1, 1e-6), 'a wave far longer than a quad is carried whole');
  ok(near(swellQuadGain(Math.PI / SWELL_SEA_QUAD, SWELL_SEA_QUAD), Math.sqrt(1 / 3), 1e-12), 'and one exactly at Nyquist keeps 0.577 of itself, so even a resolved wave loses nearly half its size');
  ok(near(swellQuadError(1e-6, SWELL_SEA_QUAD), 0, 1e-6) && near(swellQuadError(Math.PI / SWELL_SEA_QUAD, SWELL_SEA_QUAD), 0.723, 1e-3), 'the error runs from nothing for a long wave to 0.72 at Nyquist');

  // The closed forms, against a sine really sampled on a 15 m grid and really interpolated.
  for (const lambda of [200, 60, 40, 31, 24, 12]) {
    const kk = (2 * Math.PI) / lambda;
    let sqTrue = 0;
    let sqDrawn = 0;
    let sqDiff = 0;
    let n = 0;
    for (let phase = 0; phase < 2 * Math.PI; phase += 0.017) {
      for (let u = 0; u < 1; u += 0.01) {
        const x = u * SWELL_SEA_QUAD;
        const trueH = Math.sin(kk * x + phase);
        const drawn = Math.sin(phase) * (1 - u) + Math.sin(kk * SWELL_SEA_QUAD + phase) * u;
        sqTrue += trueH * trueH;
        sqDrawn += drawn * drawn;
        sqDiff += (drawn - trueH) ** 2;
        n++;
      }
    }
    const gain = Math.sqrt(sqDrawn / sqTrue);
    const err = Math.sqrt(sqDiff / sqTrue);
    ok(near(gain, swellQuadGain(kk, SWELL_SEA_QUAD), 5e-3), `a ${lambda} m wave on a 15 m grid keeps ${gain.toFixed(3)} of its r.m.s., as the closed form says`);
    ok(near(err, swellQuadError(kk, SWELL_SEA_QUAD), 5e-3), `and is ${err.toFixed(3)} r.m.s. wrong, as the closed form says`);
  }
}

// --- 8. the game's own sea state, so the numbers reported stay true ---

{
  // The generator's own lines, pinned: every figure below is worked out from them, and the moment
  // one of them moves this file fails rather than letting the report go stale.
  ok(inWater('const t = (i + rnd() * 0.8) / WAVE_COUNT;'), 'the sea state spaces its members with a jitter of 0.8');
  ok(inWater('const wavelength = 7.5 * Math.pow(38 / 7.5, t);'), 'over wavelengths 7.5 m to 38 m, log-spaced');
  ok(inWater('const spread = THREE.MathUtils.lerp(1.1, 0.3, t);'), 'with the longer swells leaning harder into the wind');
  ok(inWater('const amplitude = wavelength * THREE.MathUtils.lerp(0.005, 0.0095, t) * (0.7 + rnd() * 0.6);'), 'and amplitudes from half a per cent of the wavelength to just under one');
  ok(inWater('s = (s * 1664525 + 1013904223) >>> 0;') && inWater('return s / 4294967296;'), 'drawn from that one linear congruential generator');
  ok(inWater('const { windAngle = 0.9, seed = 7, reflective = true } = opts;'), 'seeded 7 at a wind of 0.9 rad');
  ok(bodiesSrc.includes('createWaterMaterial(look, waves)'), 'and every body in the world takes those defaults, so there is one sea state to report on');
  ok(inWater('uWaveHeight: { value: waves ? 1 : 0 },'), "a body's wave height is 1 or 0, so a lake is flat and the mirror's early out is the lake's whole cost");
  ok(inWater('for (const w of waves) sum += w.w;') && inWater('return sum * height;'), "`waveReach` sums the amplitudes times the wave height, which is `swellReach`'s twin");

  // A replica of the generator, used only to report. Its inputs are the lines just pinned.
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const waves: SwellWave[] = [];
  const omega: number[] = [];
  let s = 7 >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 8; i++) {
    const t = (i + rnd() * 0.8) / 8;
    const wavelength = 7.5 * Math.pow(38 / 7.5, t);
    const spread = lerp(1.1, 0.3, t);
    const angle = 0.9 + (rnd() - 0.5) * 2 * spread;
    const k = (2 * Math.PI) / wavelength;
    const amplitude = wavelength * lerp(0.005, 0.0095, t) * (0.7 + rnd() * 0.6);
    waves.push({ x: Math.cos(angle), y: Math.sin(angle), z: k, w: amplitude });
    omega.push(Math.sqrt(SWELL_GRAVITY * k));
  }

  const reach = swellReach(waves, 1);
  ok(near(reach, 1.1876, 1e-3), `the whole sea can lift the surface ${reach.toFixed(4)} m over its mean, and no further`);
  const periods = waves.map((wv) => swellPeriod(wv.z));
  ok(near(Math.min(...periods), 2.235, 1e-2) && near(Math.max(...periods), 4.635, 1e-2), `its members run ${Math.min(...periods).toFixed(2)} s to ${Math.max(...periods).toFixed(2)} s`);

  let up = 0;
  let sq = 0;
  let hi = -9;
  let lo = 9;
  let n = 0;
  let prev = swellHeight(waves, omega, 0, 0, 0, 1);
  for (let t = 0.01; t < 600; t += 0.01) {
    const h = swellHeight(waves, omega, 0, 0, t, 1);
    if (prev < 0 && h >= 0) up++;
    prev = h;
    sq += h * h;
    hi = Math.max(hi, h);
    lo = Math.min(lo, h);
    n++;
  }
  const rms = Math.sqrt(sq / n);
  ok(hi < reach && lo > -reach, `over ten minutes at one point it reaches ${hi.toFixed(3)} m and ${lo.toFixed(3)} m, inside the reach but close to it`);
  ok(near(600 / up, 4.05, 0.2), `a hull at a point rises every ${(600 / up).toFixed(2)} s on average -- the sum of eight incommensurate rhythms has no period of its own`);
  ok(near(rms, 0.353, 5e-3), `the sea's own r.m.s. is ${rms.toFixed(4)} m (a significant wave height of ${(4 * rms).toFixed(2)} m)`);

  let vmax = 0;
  for (let t = 0; t < 120; t += 0.005) vmax = Math.max(vmax, Math.abs(swellRate(waves, omega, 0, 0, t, 1)));
  ok(vmax > 1.5 && vmax < 2.5, `and the surface rises and falls at up to ${vmax.toFixed(2)} m/s, which is what a spring has to keep up with`);

  // What the 15 m mesh really draws of it: the bilinear surface over the real grid.
  let sqT = 0;
  let sqD = 0;
  let sqE = 0;
  let m = 0;
  for (let t = 0; t < 60; t += 0.25) {
    for (let i = 0; i < 400; i++) {
      const x = ((i * 37.13) % 900) - 450;
      const z = ((i * 91.7) % 900) - 450;
      const i0 = Math.floor(x / SWELL_SEA_QUAD) * SWELL_SEA_QUAD;
      const j0 = Math.floor(z / SWELL_SEA_QUAD) * SWELL_SEA_QUAD;
      const u = (x - i0) / SWELL_SEA_QUAD;
      const v = (z - j0) / SWELL_SEA_QUAD;
      const h00 = swellHeight(waves, omega, i0, j0, t, 1);
      const h10 = swellHeight(waves, omega, i0 + SWELL_SEA_QUAD, j0, t, 1);
      const h01 = swellHeight(waves, omega, i0, j0 + SWELL_SEA_QUAD, t, 1);
      const h11 = swellHeight(waves, omega, i0 + SWELL_SEA_QUAD, j0 + SWELL_SEA_QUAD, t, 1);
      const drawn = lerp(lerp(h00, h10, u), lerp(h01, h11, u), v);
      const trueH = swellHeight(waves, omega, x, z, t, 1);
      sqT += trueH * trueH;
      sqD += drawn * drawn;
      sqE += (drawn - trueH) ** 2;
      m++;
    }
  }
  const carried = Math.sqrt(sqD / sqT);
  const apart = Math.sqrt(sqE / m);
  const resolved = waves.filter((wv) => swellResolves(wv.z, SWELL_SEA_QUAD)).length;
  ok(resolved === 1, `only ${resolved} of the eight waves is longer than the 30 m a 15 m quad can resolve at all`);
  ok(carried > 0.5 && carried < 0.65, `so the surface the mesh really draws carries ${(carried * 100).toFixed(1)} per cent of the authored r.m.s.`);
  ok(apart > 0.25 && apart < 0.32, `and stands ${apart.toFixed(3)} m r.m.s. away from it -- as far from the authored sea as the drawn sea is tall, which is why a hull floating on this will not trace the crests the picture shows`);
}

// --- 9. nothing is made while the springs are asking ---

{
  const waves: SwellWave[] = [];
  const omega: number[] = [];
  for (let i = 0; i < 8; i++) {
    const k = 0.15 + i * 0.09;
    waves.push({ x: Math.cos(i), y: Math.sin(i), z: k, w: 0.1 });
    omega.push(Math.sqrt(SWELL_GRAVITY * k));
  }
  const out: SwellDisplacement = { x: 0, y: 0, z: 0 };
  // A warm-up, so the timing below is of optimised code rather than of the engine tiering up.
  let sink = 0;
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 200000; i++) sink += swellHeight(waves, omega, i * 0.7, i * 0.3, i * 0.01, 1);
    for (let i = 0; i < 50000; i++) sink += swellDisplacement(waves, omega, i * 0.7, i * 0.3, i * 0.01, 1, out).y;
    for (let i = 0; i < 20000; i++) sink += swellHeightSolved(waves, omega, i * 0.7, i * 0.3, i * 0.01, 1, 2);
  }
  ok(Number.isFinite(sink), 'a quarter of a million readings of all three entry points answered numbers throughout');
  ok(out.x !== 0 || out.z !== 0, 'and the record handed in is the one written into, which is what "nothing allocates" rests on for the displacement');

  // What this loop is NOT: a test that nothing allocates. `process.memoryUsage().heapUsed` around
  // it cannot fail -- the scavenger collects short-lived garbage before the second reading, and a
  // deliberately-allocating control measured here came out NEGATIVE against its own baseline. The
  // check that really bites is the textual one in section 10, which reads the module's own code.
  // This is printed and not asserted, so nobody reads it as evidence it is not.
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 200000; i++) sink += swellHeight(waves, omega, i * 0.7, i * 0.3, i * 0.01, 1);
  for (let i = 0; i < 50000; i++) sink += swellDisplacement(waves, omega, i * 0.7, i * 0.3, i * 0.01, 1, out).y;
  for (let i = 0; i < 20000; i++) sink += swellHeightSolved(waves, omega, i * 0.7, i * 0.3, i * 0.01, 1, 2);
  const grew = process.memoryUsage().heapUsed - before;
  console.log(`note the heap moved ${(grew / 1024).toFixed(0)} KB over 270k readings -- not evidence of anything, since a scavenger hides short-lived garbage; section 10 is the real guard`);

  const started = process.hrtime.bigint();
  for (let i = 0; i < 100000; i++) sink += swellHeight(waves, omega, i * 0.7, i * 0.3, i * 0.01, 1);
  const each = Number(process.hrtime.bigint() - started) / 100000;
  const solveStarted = process.hrtime.bigint();
  for (let i = 0; i < 100000; i++) sink += swellHeightSolved(waves, omega, i * 0.7, i * 0.3, i * 0.01, 1, 1);
  const eachSolve = Number(process.hrtime.bigint() - solveStarted) / 100000;
  ok(Number.isFinite(sink), 'and the timed loops answered numbers too');
  console.log(`note a plain reading took about ${each.toFixed(0)} ns here and a one-step solve about ${eachSolve.toFixed(0)} ns (two passes over the set, which is what the springs' default really buys); counts on this machine, not claims about the owner's`);
}

// --- 10. the module imports nothing, and the probe is offered rather than wired ---

{
  const imports = mathSrc.match(/^\s*import\s/gm);
  ok(imports === null, 'the mirror imports nothing at all, so a node test runs exactly what the game runs');

  // "Nothing allocates per call", checked where it can really fail: in the module's own code, with
  // its comments stripped and read from its first function on, so the frozen tune records above
  // (made once at load) are not mistaken for a per-call allocation. A heap count around a hot loop
  // cannot do this job at all -- the scavenger hides short-lived garbage, and section 9 says so.
  // This is deliberately a whole-file scan from that point, so a module-level const added BELOW the
  // first function fails here rather than sneaking a literal past: move it up with the others.
  const stripped = mathSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const bodies = stripped.slice(stripped.indexOf('export function'));
  const makers: Array<[RegExp, string]> = [
    [/\bnew\b/, 'constructor call'],
    [/=>/, 'arrow function, which would be a closure made per call'],
    [/function\s*\(/, 'anonymous function expression'],
    [/\.\.\./, 'spread, which copies'],
    [/=\s*\{/, 'object literal assigned'],
    [/=\s*\[/, 'array literal assigned'],
    [/return\s*\{/, 'object literal returned'],
    [/return\s*\[/, 'array literal returned'],
    [/\(\s*\{/, 'object literal passed'],
    [/\(\s*\[/, 'array literal passed'],
    [/,\s*\{/, 'object literal in an argument list'],
    [/,\s*\[/, 'array literal in an argument list'],
    [/\.(map|filter|slice|concat|split|join|flat|reduce|sort|from)\s*\(/, 'allocating array or string method'],
    [/`/, 'template literal'],
    [/\bArray\b|\bObject\s*\.|\bJSON\s*\./, 'builtin that makes something'],
  ];
  // Each pattern is tried on a line that really does the thing first, so a pattern that has quietly
  // stopped matching anything fails here rather than passing the module by default.
  const bait = ['new Foo()', 'const f = () => 1;', 'const f = function () {};', 'g(...xs)', 'const o = {a: 1};', 'const o = [1];', 'return {a: 1};', 'return [1];', 'g({a: 1})', 'g([1])', 'g(0, {a: 1})', 'g(0, [1])', 'xs.map(f)', 'const s = `a`;', 'Object.keys(o)'];
  for (let i = 0; i < makers.length; i++) {
    const [pattern, what] = makers[i];
    ok(pattern.test(bait[i]), `the scan can still see ${what} where there is one (${JSON.stringify(bait[i])})`);
    const hit = bodies.match(pattern);
    ok(hit === null, `and the mirror's functions contain no ${what}${hit ? ` (found ${JSON.stringify(hit[0])})` : ''}`);
  }

  ok(probeSrc.includes("import { WAVES_GLSL, type WaterMaterial } from './water.ts';"), "the probe takes the water's own shader text rather than a copy of it");
  ok(probeSrc.includes('gerstner(uProbePoint, 1.0, disp, n, crest);'), 'and calls that text\'s own gerstner, at scale 1, since the height is linear in the scale');
  ok(!/\bfor\s*\([^)]*;/.test(probeSrc), 'the probe writes no loop of its own anywhere in the file');
  ok(!probeSrc.includes('uWaves[') && !probeSrc.includes('uOmega['), 'and indexes neither uniform array itself, so there is no second copy of the sum to drift from the shader');
  ok(waterSrc.includes('export const WAVES_GLSL'), 'which is why that text is exported');

  // Named in a comment is fine; imported or called is not. This is the check that keeps "offered,
  // not wired" true as the rest of the pass lands around it.
  //
  // It is an allow-list and not a ban, because the probe is *meant* to be wired one day: the rule is
  // "the probe is reached only from somewhere the owner chose", not "never". The list is empty today
  // because the brief asked for the probe to be offered and left alone. Applying the wiring snippet
  // in `notes.md` means adding `'main.ts'` here IN THE SAME CHANGE -- and the same goes for calling
  // `disposeSwellProbe` from `World.unload`, which wants `'world.ts'` here.
  const WIRED_ON_PURPOSE = new Set<string>([]);
  const wired: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') && entry !== 'swellProbe.ts' && !WIRED_ON_PURPOSE.has(entry)) {
        const text = readFileSync(full, 'utf8');
        if (/from '[^']*swellProbe(\.ts)?'/.test(text) || /import\('[^']*swellProbe/.test(text) || text.includes('probeSwell(') || text.includes('disposeSwellProbe(')) wired.push(full);
      }
    }
  };
  walk(srcDir);
  ok(wired.length === 0, `nothing in the game imports or calls the probe except what the allow-list names (${wired.join(', ') || 'none'}): it compiles a program and syncs the card, and it is the owner's to reach for`);
}

console.log(`\n${passed} checks passed`);
