// The underwater look's arithmetic, checked without a browser: how fast each channel of the
// picture is eaten, where the water stops overhead, how the whole look eases in at the surface
// line, the veil that rises with the camera's own depth, and the lens the whole frame wobbles
// behind, with its drift.
//
// The shader in `src/core/fx/underwater.ts` is the same formulas, and the last block here reads
// that file as text and checks it against this module rather than taking the claim on trust: the
// noise's period is written into the GLSL from `SHIMMER_PERIOD` itself, and every other formula is
// matched against the line it mirrors. Where a check could be satisfied by restating the
// implementation's own expression it is written as a property instead (an exponential's equal
// ratios over equal steps, an affine function's midpoint), so a sign or a term put in wrongly in
// both places would still fail.
//
// There was no under water in the game, so none of these numbers is the client's: every one is
// ours, and this file is where a change to one of them has to stay honest.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyUnderwaterPixel,
  clamp01,
  createUnderwaterLook,
  deriveUnderwater,
  easeIn,
  extinctionFor,
  lightOf,
  lightShareFor,
  murkFor,
  murkinessFor,
  shimmerCellsAcross,
  shimmerCellsMax,
  shimmerFadeStart,
  shimmerFor,
  shimmerPhase,
  SHIMMER_FADE_START,
  SHIMMER_FINE,
  SHIMMER_PERIOD,
  SHIMMER_WRAP,
  smoothstep,
  tuneUnderwater,
  unknownUnderwaterKeys,
  UNDERWATER_FALLBACK,
  UNDERWATER_TUNE,
  veilFor,
  waterPath,
  type UnderwaterTune,
  type Vec3,
} from '../../../src/core/fx/underwaterMath.ts';
import { FX_DEFAULTS, FX_KNOBS, FX_PASSES, fxPassDef, fxPassIndex } from '../../../src/core/fxRegistry.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** A copy of the live tuning, so nothing here depends on an earlier check having put it back. */
const T: UnderwaterTune = { ...UNDERWATER_TUNE };
/** The converter's own neutral water (#2e7fbb) in linear light: blue strongest, red almost gone. */
const BLUE: Vec3 = [UNDERWATER_FALLBACK.color[0], UNDERWATER_FALLBACK.color[1], UNDERWATER_FALLBACK.color[2]];
/** The opacity that counts as ordinary water, so the body's own murkiness is 1 and the reach is `sight`. */
const PLAIN = T.bodyMurkRef;
/** The scene light that counts as full daylight: a planet at noon comes to about this. */
const DAY = T.lightRef;
const scratch: Vec3 = [0, 0, 0];
const out: Vec3 = [0, 0, 0];

/** The shapes of window anybody plays on, widest last: every figure across the width carries one of these. */
const WINDOWS: ReadonlyArray<readonly [number, number, string]> = [
  [1280, 800, '1280x800'],
  [1920, 1080, '1920x1080'],
  [2560, 1080, '2560x1080'],
  [3440, 1440, '3440x1440'],
];

/** A lights record of the shape `FxLights` has, for `lightOf`: four luminances and nothing else. */
const lights = (sun: number, sky: number, fill: number, roomAmbient = 0, roomParallel = 0) => ({
  sky: { sun: { luminance: sun }, hemiSkyLuminance: sky, fill: { luminance: fill } },
  rooms: { ambientLuminance: roomAmbient, parallel: { luminance: roomParallel } },
});

// --- the helpers are GLSL's ---

ok(clamp01(-1) === 0 && clamp01(2) === 1 && clamp01(0.4) === 0.4, 'clamp01 holds a number to 0..1');
ok(smoothstep(2, 4, 1) === 0 && smoothstep(2, 4, 5) === 1 && near(smoothstep(2, 4, 3), 0.5, 1e-12), 'smoothstep is flat outside its edges and a half in the middle');

// --- how fast each channel is eaten ---

{
  extinctionFor(BLUE, 1, T, scratch);
  const metres = scratch.map((k) => 1 / k);
  ok(metres[2] > metres[1] && metres[1] > metres[0], `in blue water blue travels furthest and red least (${metres.map((m) => m.toFixed(1)).join(', ')} m)`);
  ok(near(metres[2], T.sight, 1e-6), `the strongest channel travels exactly the sight range, ${T.sight} m`);
  ok(metres[0] >= T.sight * T.minLength - 1e-9, `no channel is eaten faster than ${(T.sight * T.minLength).toFixed(2)} m, whatever the body's colour`);

  // A channel's reach against its share of the body's colour is an affine line from "absent" to
  // "the brightest channel". Checked as a line — the midpoint is the mean of the two ends — rather
  // than by writing the formula out again, which would pass however the formula were mangled.
  const reach = (share: number) => {
    extinctionFor([share, 0, 1], 1, T, scratch);
    return 1 / scratch[0];
  };
  const at0 = reach(0);
  const at1 = reach(1);
  ok(near(at1, T.sight, 1e-6), 'a channel as strong as the body itself travels the whole sight range');
  ok(near(reach(0.5), (at0 + at1) / 2, 1e-9) && near(reach(0.25), at0 + (at1 - at0) * 0.25, 1e-9), 'and a channel between the two is on the straight line between them');
  ok(at0 < at1 && at0 >= T.sight * T.minLength - 1e-9, `a body with no red at all still lets red ${at0.toFixed(2)} m rather than eating it in centimetres`);
  extinctionFor([0, 0, 1], 1, { ...T, tint: 1 }, scratch);
  ok(near(1 / scratch[0], T.sight * T.minLength, 1e-6), `and with the tint at its most the floor holds it at ${(T.sight * T.minLength).toFixed(2)} m`);

  extinctionFor(BLUE, 2, T, scratch);
  const doubled = scratch.map((k) => 1 / k);
  ok(near(doubled[2], T.sight / 2, 1e-6), 'strength 2 halves every distance');
  extinctionFor(BLUE, 0, T, scratch);
  ok(scratch[0] === 0 && scratch[1] === 0 && scratch[2] === 0, 'strength 0 eats nothing');

  const grey: UnderwaterTune = { ...T, tint: 0 };
  extinctionFor(BLUE, 1, grey, scratch);
  ok(near(scratch[0], scratch[1], 1e-12) && near(scratch[1], scratch[2], 1e-12), 'with the tint at 0 the murk is colourless: every channel goes at the same rate');
}

// --- how thick this body is: the one per-body signal there is ---

{
  ok(near(murkinessFor(PLAIN, T), 1, 1e-12), `water at the reference opacity (${PLAIN}) is seen exactly the sight range through`);
  ok(murkinessFor(0.95, T) > 1 && murkinessFor(0.4, T) < 1, 'a more opaque body eats the picture faster and a clearer one slower');
  ok(murkinessFor(1, T) <= 2.5 && murkinessFor(0.01, T) >= 0.35, 'and however strange the converted opacity, it is held inside bounds rather than blinding the player or clearing the water');
  ok(near(murkinessFor(0.95, { ...T, bodyMurk: 0 }), 1, 1e-12) && near(murkinessFor(0.2, { ...T, bodyMurk: 0 }), 1, 1e-12), 'with bodyMurk at 0 every body on every planet is seen exactly as far through');
  ok(near(murkinessFor(Number.NaN, T), 1, 1e-12) && near(murkinessFor(0, T), 1, 1e-12), 'an opacity that is not one leaves the reach where it was');
  let rising = true;
  let previous = -1;
  for (let o = 0.05; o <= 1.0001; o += 0.05) {
    const m = murkinessFor(o, T);
    if (!(m >= previous - 1e-12)) rising = false;
    previous = m;
  }
  ok(rising, 'and it never falls as the water gets thicker');

  // The whole point of it: two real bodies are not seen the same distance through.
  const look = createUnderwaterLook();
  deriveUnderwater(BLUE, 0.95, 6, DAY, 1, 1, T, look);
  const silty = 1 / look.extinction[2];
  deriveUnderwater(BLUE, 0.4, 6, DAY, 1, 1, T, look);
  const clear = 1 / look.extinction[2];
  ok(clear > silty * 1.2, `a clear body is seen ${(clear / silty).toFixed(2)}x as far through as a silty one, rather than exactly as far`);
}

// --- the light the scene really has, which is what the murk is a share of ---

{
  ok(near(lightOf(lights(1.9, 0.6, 0.3), T), 2.8, 1e-9), 'the light is the sun, the sky half of the hemisphere and the fill added: a planet at noon comes to about the reference day');
  // The brighter of the two sets, never both: indoors the sky set does not light the cell at all
  // (that is the portal renderer's layer split), so adding the lamps on top of a sun that is not
  // shining in would read a roofed pool as brighter than open sea at noon.
  ok(near(lightOf(lights(1.9, 0.6, 0.3, 0.4, 0.2), T), 2.8, 1e-9), 'a lit room does not add its lamps on top of a sky that is not lighting it: the brighter of the two sets is the light');
  ok(near(lightOf(lights(0, 0, 0, 1.2, 0.5), T), 1.7, 1e-9), 'and where the sky set is dark the room is the light, so a lamplit cellar pool is lit by its lamps');
  let larger = true;
  for (const sun of [0, 0.4, 1.9]) for (const hemi of [0, 0.6]) for (const fill of [0, 0.3]) for (const amb of [0, 0.4, 2.4]) for (const par of [0, 0.2]) {
    const want = Math.max(sun + hemi + fill, amb + par);
    const got = lightOf(lights(sun, hemi, fill, amb, par), T);
    if (want > 0 ? !near(got, want, 1e-9) : got !== T.lightRef) larger = false;
  }
  ok(larger, 'over every mix of the five it is exactly the larger of the two sets, never their sum');
  ok(lightOf(lights(0, 0, 0), T) === T.lightRef, 'a record no frame has filled is read as the reference day rather than as darkness: a frame the game did not fill must not paint the screen black');
  ok(lightOf(null, T) === T.lightRef && lightOf({ sky: undefined, rooms: undefined } as never, T) === T.lightRef, 'and a record that is not there at all goes the same way rather than throwing inside a draw');
  ok(near(lightOf(lights(Number.NaN, 0.6, 0.3), T), 0.9, 1e-9), 'a luminance that is not one counts as nothing rather than poisoning the sum');
  ok(near(lightOf(lights(-5, 0.6, 0.3), T), 0.9, 1e-9), 'and a negative one cannot take light away');

  ok(near(lightShareFor(T.lightRef, T), 1, 1e-12), 'the reference day is a share of exactly 1');
  ok(near(lightShareFor(T.lightRef / 2, T), 0.5, 1e-12), 'and half the light is half the share: below its ends it is a straight line');
  ok(lightShareFor(0, T) === T.nightFloor, `however dark the hour the murk keeps ${T.nightFloor} of the reference day's light, so a night dive is dark rather than black`);
  ok(lightShareFor(1e6, T) === T.lightCeil, `and however bright the sky it never passes ${T.lightCeil}, so it cannot hand the whole picture to the murk`);
  // The one property the owner's request really needs, and the one `lightRef`'s own uncertainty
  // cannot spoil: a ceiling of 1 means the light may only ever dim the murk, so whatever the planet
  // and whatever the hour the water is at or under the level it sat at before, never over it.
  ok(T.lightCeil <= 1, 'the ceiling is 1 or under, so the change can only ever make the water darker than the fixed level it replaced');
  ok(near(lightShareFor(Number.NaN, T), 1, 1e-12), 'a light that is not a number reads as the reference day, never as darkness');
  let rising = true;
  let previous = -1;
  for (let l = 0; l <= T.lightRef * 2; l += T.lightRef / 20) {
    const s = lightShareFor(l, T);
    if (!(s >= previous - 1e-12)) rising = false;
    previous = s;
  }
  ok(rising, 'and it never falls as the world gets brighter');
}

// --- the colour a far pixel becomes ---

{
  murkFor(BLUE, 0, DAY, T, scratch);
  const surface: Vec3 = [scratch[0], scratch[1], scratch[2]];
  ok(near(Math.max(...surface), T.murkLight, 1e-9), `at the surface under the reference daylight the murk's brightest channel is ${T.murkLight}`);
  ok(near(surface[0] / surface[2], BLUE[0] / BLUE[2], 1e-9), "the murk keeps the body's own hue exactly");

  // The whole of the owner's report: the murk was one fixed level on every planet at every hour, so
  // a body that should have been a dark pool reached the same grey-blue as open sea at noon. It is
  // now a share of the light the world really has.
  murkFor(BLUE, 0, DAY / 4, T, scratch);
  ok(near(Math.max(...scratch), T.murkLight / 4, 1e-9), 'a world lit a quarter as brightly makes a murk a quarter as bright, rather than the same one');

  murkFor(BLUE, 1000, DAY, T, scratch);
  const floorLevel = Math.max(...scratch);
  ok(near(floorLevel, T.murkLight * T.deepFloor, 1e-6), `however deep the camera goes the murk keeps ${T.deepFloor} of its surface brightness rather than going black`);
  ok(floorLevel > 0, 'and that floor is a real light: deep water is very dark and never pure black');

  // The fall toward that floor is an exponential, checked as one: equal steps of depth take equal
  // ratios off what is left above the floor, whatever the formula is written as.
  const above = (d: number) => {
    murkFor(BLUE, d, DAY, T, scratch);
    return Math.max(...scratch) - floorLevel;
  };
  const r1 = above(T.lightDepth) / above(0);
  const r2 = above(2 * T.lightDepth) / above(T.lightDepth);
  const r3 = above(3 * T.lightDepth) / above(2 * T.lightDepth);
  ok(near(r1, r2, 1e-9) && near(r2, r3, 1e-9), `the light falls away exponentially: every ${T.lightDepth} m takes the same share (${r1.toFixed(4)}) of what is left over the floor`);
  ok(r1 > 0 && r1 < 1, 'and that share is a real one: going deeper always dims it and never puts it out');

  // Deeper must be darker by a margin worth seeing, which is the owner's "it should become
  // shadowier": the fall is measured rather than merely asserted to exist.
  const at = (d: number) => {
    murkFor(BLUE, d, DAY, T, scratch);
    return Math.max(...scratch);
  };
  ok(at(10) < at(1) * 0.35, `ten metres down the murk is ${(at(10) / at(1)).toFixed(2)} of what it is at one metre: the water goes to shadow with depth rather than to fog`);
  ok(at(20) < at(10) * 0.5, `and twenty metres down ${(at(20) / at(10)).toFixed(2)} of that again`);

  murkFor(BLUE, 0, 0, T, scratch);
  ok(near(Math.max(...scratch), T.murkLight * T.nightFloor, 1e-9), `with no light at all the murk keeps ${T.nightFloor} of its daylight brightness`);

  // And the other end, which is what makes "the surface is where it was" a claim rather than a hope:
  // however bright the planet and the hour, the murk never stands over the level it used to sit at.
  let capped = true;
  for (const l of [DAY, DAY * 2, DAY * 10, 1e6]) {
    murkFor(BLUE, 0, l, T, scratch);
    if (Math.max(...scratch) > T.murkLight + 1e-9) capped = false;
  }
  ok(capped, `no light, however strong, lifts the murk over ${T.murkLight}: the reading of the world's light can dim the water and never brighten it`);

  let falling = true;
  let previous = Infinity;
  for (let d = 0; d <= 40; d += 2) {
    murkFor(BLUE, d, DAY, T, scratch);
    if (!(scratch[2] < previous)) falling = false;
    previous = scratch[2];
  }
  ok(falling, 'the murk dims strictly all the way down: no step where going deeper brightens the water');
}

// --- the way out through the surface overhead ---

{
  ok(waterPath(500, 1, 2, T) === 2, 'looking straight up from 2 m down, the water is 2 m thick however far off what is beyond it stands');
  ok(near(waterPath(500, 0.5, 2, T), 4, 1e-12), 'at 30 degrees up the way out is twice as long');
  ok(waterPath(1, 1, 2, T) === 1, 'something floating between the eye and the surface is the nearer of the two, so it takes only the water in front of it');
  ok(waterPath(500, 0, 2, T) === 500, 'looking level, the water runs all the way to what is seen');
  ok(waterPath(500, -0.8, 2, T) === 500, 'and looking down at the bed it does too');
  ok(waterPath(500, 1, 2, { ...T, ceiling: false }) === 500, 'with the ceiling off the murk runs to the far plane, which is what the picture looked like before it was put in');
  ok(waterPath(-5, 0, 2, T) === 0 && waterPath(Number.NaN, 0, 2, T) === 0, 'a distance that is not a distance is no water rather than a wrong one');

  // The horizon is not a seam: the divisor is held off zero rather than the test being made at some
  // angle, so a ray a hair above level and a ray a hair below it are seen through the same water.
  const deep = 1;
  const just = waterPath(40, 1e-7, deep, T);
  const below = waterPath(40, -1e-7, deep, T);
  ok(just === below && just === 40, 'a metre down, a ray a hair over level and a hair under it take the same water: there is no line across the middle of the screen');
  // Swept finely through level and on up, the water in front of a 40 m pixel moves by hundredths of
  // a metre a step: it is one continuous curve, never a step. (The old form tested `up > 1e-3` and
  // fed the depth in unclamped, which at depth 0 sent every upward ray to no water at all and every
  // other ray to the full distance — the razor line this pins shut.)
  const step = 1e-5;
  let worstJump = 0;
  let last = waterPath(40, -0.02, deep, T);
  for (let up = -0.02; up <= 0.5; up += step) {
    const v = waterPath(40, up, deep, T);
    worstJump = Math.max(worstJump, Math.abs(v - last));
    last = v;
  }
  ok(worstJump < 0.05, `and sweeping a ray up through level it never jumps: the worst step in 52,000 is ${worstJump.toFixed(4)} m`);
}

// --- the surface ease: what keeps the picture from splitting at the line ---

{
  ok(easeIn(0, T) === 0, 'at the surface line none of the look is in');
  ok(near(easeIn(T.surfaceEase, T), 1, 1e-12) && easeIn(50, T) === 1, `and by ${T.surfaceEase} m under, all of it is`);
  ok(easeIn(-3, T) === 0 && easeIn(Number.NaN, T) === 0, 'a depth that is not a depth brings none of it in');
  let rising = true;
  let previous = -1;
  for (let d = 0; d <= T.surfaceEase; d += T.surfaceEase / 40) {
    const e = easeIn(d, T);
    if (!(e >= previous - 1e-15)) rising = false;
    previous = e;
  }
  ok(rising, 'it comes in smoothly rather than in a step');

  // This is the one that matters. "Am I under water" is answered with a margin over the surface and
  // 20 cm of hysteresis, so for a whole band the answer is yes with the depth exactly 0 and the
  // camera still in the air. At depth 0 every upward ray leaves the water at once, so a look that
  // did not ease would grade the lower half of the screen and leave the upper half alone: a razor
  // line across the middle. Here depth 0 must leave every pixel exactly as it was.
  const look = createUnderwaterLook();
  const pixel: Vec3 = [0.6, 0.55, 0.5];
  deriveUnderwater(BLUE, PLAIN, 0, DAY, 1, 1, T, look);
  ok(look.extinction.every((k) => k === 0) && look.veil === 0 && look.shimmer === 0, 'at depth 0 the look is nothing at all: no extinction, no veil, no shimmer');
  let untouched = true;
  for (const d of [0, 0.5, 2, 12, 40, 500, 9000]) {
    applyUnderwaterPixel(pixel, waterPath(d, -0.02, 0, T), look, out);
    if (!(out[0] === pixel[0] && out[1] === pixel[1] && out[2] === pixel[2])) untouched = false;
    applyUnderwaterPixel(pixel, waterPath(d, 0.02, 0, T), look, out);
    if (!(out[0] === pixel[0] && out[1] === pixel[1] && out[2] === pixel[2])) untouched = false;
  }
  ok(untouched, 'so a pixel 40 m off just under the horizon and the same pixel just over it come back bit for bit the same, at every distance');

  // And it does not stay weak: a short way under, the look is whole.
  deriveUnderwater(BLUE, PLAIN, 3, DAY, 1, 1, T, look);
  ok(near(look.ease, 1, 1e-12) && near(1 / look.extinction[2], T.sight, 1e-6), 'three metres under, the full reach is back and the ease has taken nothing off it');

  // Nothing jumps on the way in either: the strongest channel's extinction climbs smoothly from 0.
  let jump = 0;
  let before = 0;
  for (let d = 0; d <= 1.2; d += 0.01) {
    deriveUnderwater(BLUE, PLAIN, d, DAY, 1, 1, T, look);
    jump = Math.max(jump, Math.abs(look.extinction[2] - before));
    before = look.extinction[2];
  }
  ok(jump < (1 / T.sight) * 0.12, `and it comes in without a step: the biggest jump over a centimetre of depth is ${(jump * T.sight).toFixed(4)} of the whole`);
}

// --- the veil ---

{
  ok(veilFor(0, 1, T) === 0, 'at the surface the veil takes nothing');

  // An exponential toward its ceiling, checked as one: equal steps of depth close the same share of
  // the gap between where it is and the most it may ever take.
  const gap = (d: number) => T.veilMax - veilFor(d, 1, T);
  const g1 = gap(T.veilDepth) / gap(0);
  const g2 = gap(2 * T.veilDepth) / gap(T.veilDepth);
  ok(near(g1, g2, 1e-9) && g1 > 0 && g1 < 1, `every ${T.veilDepth} m closes the same share (${(1 - g1).toFixed(4)}) of the way to its most`);

  // The ceiling is a ceiling and not a scale: the strength brings it on sooner, never past it.
  let held = true;
  for (const s of [0, 0.25, 0.5, 1, 1.5, 2, 10]) {
    for (const d of [0, 1, 9, 30, 1e6]) {
      if (veilFor(d, s, T) > T.veilMax + 1e-12) held = false;
      if (veilFor(d, s, T) < 0) held = false;
    }
  }
  ok(held, `it never passes ${T.veilMax} at any depth and any strength, the knob's top end included`);
  ok(near(veilFor(1e6, 2, T), T.veilMax, 1e-12), 'at twice strength and far down it sits exactly on its most rather than over it');
  ok(veilFor(20, 0, T) === 0, 'strength 0 takes the veil with it');
  ok(near(veilFor(20, 0.5, T), veilFor(20, 1, T) * 0.5, 1e-12), 'below its ceiling the strength scales it straight');
  let rising = true;
  let previous = -1;
  for (let d = 0; d <= 60; d += 3) {
    const v = veilFor(d, 1, T);
    if (!(v > previous)) rising = false;
    previous = v;
  }
  ok(rising, "it rises strictly with the camera's own depth");
}

// --- the shimmer: a lens over the whole frame ---

// The owner played the rule this replaced — the wobble faded out on the water in front of each
// pixel, so only what was close to the eye moved — and said it read as something sitting on the
// materials rather than as looking through water: "it should cover the whole frame, like the camera
// itself has a lens over it that wobbles slightly - but I want this to be a subtle shimmer". So the
// amplitude is the frame's and not the pixel's, and it is small.
{
  const amp = shimmerFor(0, 0, 1, T);
  ok(near(amp, T.shimmerUv, 1e-12), `at the surface the picture may move ${T.shimmerUv} of the screen's width`);
  ok(T.shimmerReach === 0, 'and the fade that used to narrow it to the near field is off: the default is the lens');

  let sameEverywhere = true;
  for (const path of [0, 0.5, 2, 12, 28, 120, 1000, 9000, 1e6]) {
    if (shimmerFor(path, 0, 1, T) !== amp) sameEverywhere = false;
  }
  ok(sameEverywhere, 'so the pixel against the eye, the bed, a far wall and the sky nine kilometres off all move by exactly the same amount');
  ok(shimmerFor(Number.NaN, 0, 1, T) === amp, 'and a path that is not a path cannot change it, because at the default it is not read at all');

  ok(shimmerFor(0, 0, 0, T) === 0, 'shimmer strength 0 is no shimmer');
  ok(near(shimmerFor(0, 0, 2, T), amp * 2, 1e-12), "and the Graphics slider's top end is twice it, which is how the owner takes it up without touching the console");

  // Subtle, in the one unit the owner can judge: the shader moves the picture by
  // (wobble - 0.5) x amp, and wobble is 0 to 1, so half the amplitude is the very worst it can do.
  const worstPx = amp * 0.5 * 1920;
  ok(worstPx > 0.5 && worstPx < 4, `at the default the very worst a 1920-wide window moves along one axis is ${worstPx.toFixed(1)} px, which is a lens rather than a heat haze`);

  // It still falls away with the camera's own depth. That is one number over the whole frame, not a
  // second rule about where a pixel stands: the light that bends comes through the ripples overhead
  // and deep down it is no longer arriving.
  const deep = shimmerFor(0, 1e6, 1, T);
  ok(near(deep, T.shimmerUv * T.shimmerDeep, 1e-9), `far under the surface it keeps ${T.shimmerDeep} of itself, where the ripples' own light no longer reaches`);
  let falling = true;
  let previous = Infinity;
  for (let d = 0; d <= 60; d += 2) {
    const s = shimmerFor(0, d, 1, T);
    if (s > previous + 1e-15) falling = false;
    previous = s;
  }
  ok(falling, 'and it never brightens as the camera goes down');
}

// --- which way the lattice is counted, which is the one thing about it that has been got wrong ---
//
// The shader lays the field out as `vUv * vec2(aspect, 1.0) * cells`, and `vUv.x` spans the WIDTH.
// So `shimmerCells` counts cells down the height and the width carries `aspect` times as many. A
// swell's width in pixels, and how near the finer octave is to repeating inside one view, both
// therefore carry the aspect — and both were once quoted without it, which put the swell figure
// 1.78x too broad at 16:9 and the documented safe ceiling nearly twice as high as it really is.
// These are written as the property (does the field repeat inside this window?) rather than as the
// formula again, so restating the wrong axis in both places could not satisfy them.
{
  ok(near(shimmerCellsAcross(3.5, 1), 3.5, 1e-12), 'on a square window the width carries exactly the tune\'s own count');
  ok(near(shimmerCellsAcross(3.5, 16 / 9), 6.22, 0.01), `and on 16:9 it carries ${shimmerCellsAcross(3.5, 16 / 9).toFixed(2)}, not 3.5: every figure across the width is the tune's number times the aspect`);
  ok(shimmerCellsAcross(3.5, 21 / 9) > shimmerCellsAcross(3.5, 16 / 9), 'a wider window carries more of them, which is why the count is the height\'s: widening adds swells rather than stretching them');
  ok(shimmerCellsAcross(Number.NaN, 16 / 9) === 0 && shimmerCellsAcross(3.5, Number.NaN) === 3.5, 'and a number that is not one cannot make it negative or NaN');

  // A cell is square in pixels, whatever the window: that is the whole reason for the aspect in the
  // layout, and it is checked rather than assumed.
  let square = true;
  let swells = '';
  for (const [w, h, label] of WINDOWS) {
    const acrossPx = w / shimmerCellsAcross(T.shimmerCells, w / h);
    const downPx = h / T.shimmerCells;
    if (!near(acrossPx, downPx, 1e-9)) square = false;
    swells += `${label} ${acrossPx.toFixed(0)} px; `;
  }
  ok(square, `a swell is as wide as it is tall on every window (${swells.trim()})`);
  ok(near(1920 / shimmerCellsAcross(T.shimmerCells, 16 / 9), 309, 1), `at the default a swell is ${(1920 / shimmerCellsAcross(T.shimmerCells, 16 / 9)).toFixed(0)} px across a 1920x1080 window — six or so across the view, which is a lens; dividing 1920 by ${T.shimmerCells} alone would say 549, which is the error this block exists to stop`);

  // The ceiling, as the property: the furthest the frame reaches along either of the noise's own
  // axes must stay inside one period, or the same swell is drawn twice in one frame.
  const periodsAcross = (cells: number, aspect: number) => (shimmerCellsAcross(cells, aspect) * SHIMMER_FINE) / SHIMMER_PERIOD;
  let safe = true;
  let spans = '';
  for (const [w, h, label] of WINDOWS) {
    const p = periodsAcross(T.shimmerCells, w / h);
    if (!(p < 1)) safe = false;
    spans += `${label} ${p.toFixed(2)}; `;
  }
  ok(safe, `at the default the finer octave stays inside one period of the lattice on every window (${spans.trim()}), so no swell is drawn twice in one frame`);

  for (const [w, h, label] of WINDOWS) {
    const aspect = w / h;
    const max = shimmerCellsMax(aspect);
    ok(near(periodsAcross(max, aspect), 1, 1e-9), `shimmerCellsMax is exactly where it tiles on ${label}: ${max.toFixed(2)} cells`);
    ok(periodsAcross(max * 1.01, aspect) > 1 && periodsAcross(max * 0.99, aspect) < 1, `and it is the edge on ${label}: a hair over repeats, a hair under does not`);
  }
  ok(near(shimmerCellsMax(16 / 9), 7.83, 0.01) && near(shimmerCellsMax(21 / 9), 5.96, 0.01) && near(shimmerCellsMax(3440 / 1440), 5.82, 0.01), `the safe ceiling is ${shimmerCellsMax(16 / 9).toFixed(1)} cells at 16:9, ${shimmerCellsMax(21 / 9).toFixed(1)} at 21:9 and ${shimmerCellsMax(3440 / 1440).toFixed(1)} on the widest monitor anybody plays on — not the 13 the doc comment once claimed, which was the width's figure read as the height's`);
  ok(shimmerCellsMax(21 / 9) < shimmerCellsMax(16 / 9), 'and the wider the window the lower it is, so a figure quoted without a window is worth nothing');
  ok(shimmerCellsMax(0.5) === shimmerCellsMax(1) && shimmerCellsMax(Number.NaN) === shimmerCellsMax(1), 'a window taller than it is wide is held at the square one, where the height is the long axis');
  ok(T.shimmerCells < shimmerCellsMax(21 / 9) * 0.65, `the default ${T.shimmerCells} is well inside the tightest of them, with room for the owner to take it up`);
  ok(5.5 < shimmerCellsMax(21 / 9), 'and 5.5, the figure the tune\'s own comment offers as safe anywhere, really is');
}

// The two ends it has to be pinned at: nothing at the surface line, whole a short way under, and no
// step on the way in. A lens over the *whole* frame is the one thing in this pass a jump would be
// unmissable in, because there is no corner of the picture left still to compare it against.
{
  const look = createUnderwaterLook();
  deriveUnderwater(BLUE, PLAIN, 0, DAY, 1, 1, T, look);
  ok(look.shimmer === 0, 'at the surface line the lens moves nothing at all: the head going under does not step the picture sideways');
  deriveUnderwater(BLUE, PLAIN, 3, DAY, 1, 1, T, look);
  ok(look.shimmer > 0 && near(look.shimmer, shimmerFor(0, 3, 1, T), 1e-15), 'three metres under it is whole, with the ease having taken nothing off it');
  let jump = 0;
  let before = 0;
  for (let d = 0; d <= 1.2; d += 0.005) {
    deriveUnderwater(BLUE, PLAIN, d, DAY, 1, 1, T, look);
    jump = Math.max(jump, Math.abs(look.shimmer - before));
    before = look.shimmer;
  }
  ok(jump < T.shimmerUv * 0.05, `and it comes in smoothly: the worst move over half a centimetre of depth is ${((jump / T.shimmerUv) * 100).toFixed(2)}% of the whole`);
}

// The rule it replaced, kept for one thing only: so the owner can look at both in one session. One
// number puts it back exactly as it shipped, and the default 0 turns the arithmetic off rather than
// leaving a second rule running underneath the first.
{
  const OLD: UnderwaterTune = { ...T, shimmerReach: 28 };
  ok(SHIMMER_FADE_START === 2 && shimmerFadeStart(28) === 2, 'with a reach of 28 the fade starts where it always did, two metres of water in');
  ok(shimmerFor(0, 0, 1, OLD) === shimmerFor(SHIMMER_FADE_START, 0, 1, OLD), 'so it is whole out to its near distance and only then starts to fade');
  ok(shimmerFor(28, 0, 1, OLD) === 0 && shimmerFor(1e6, 0, 1, OLD) === 0, 'and gone past its reach, which is what kept a far wall from swimming');
  let narrowing = true;
  let last = Infinity;
  for (let p = 0; p <= 28; p += 1) {
    const s = shimmerFor(p, 3, 1, OLD);
    if (s > last + 1e-15) narrowing = false;
    last = s;
  }
  ok(narrowing, 'it never rises with the water in front of the pixel');
  ok(shimmerFor(waterPath(9000, 0.9, 2, T), 2, 1, OLD) > 0 && shimmerFor(waterPath(9000, 0.02, 2, T), 2, 1, OLD) === 0, 'and the surface overhead wavers while the same sky at the horizon does not, which is the look the owner is comparing against');

  ok(shimmerFadeStart(1) === 0.5 && shimmerFor(1, 0, 1, { ...T, shimmerReach: 1 }) === 0, 'a reach shorter than twice the start is halved into it, so the fade never runs backwards whatever is typed');
  ok(shimmerFadeStart(0) === 0 && shimmerFadeStart(Number.NaN) === 0, 'and at the default there is no fade to start');
  ok(shimmerFor(50, 0, 1, { ...T, shimmerReach: Number.NaN }) === shimmerFor(50, 0, 1, T), 'a reach that is not a number is the lens, rather than a fade over no distance that would put the shimmer out');
}

// --- the drift, and its wrap ---

{
  ok(SHIMMER_WRAP === SHIMMER_PERIOD * 2, 'the drift wraps at twice the noise\'s own period');
  ok(Number.isInteger(SHIMMER_PERIOD) && SHIMMER_PERIOD > 0, 'and the period is a whole number of cells, which is what makes the lattice repeat');
  ok(SHIMMER_FINE > 1, `the finer octave samples ${SHIMMER_FINE} times as fast as the coarse one, which is the number shimmerCellsMax is worked out from`);
  ok(shimmerCellsAcross(T.shimmerCells, 21 / 9) * SHIMMER_FINE < SHIMMER_PERIOD, `the finer octave spans ${(shimmerCellsAcross(T.shimmerCells, 21 / 9) * SHIMMER_FINE).toFixed(1)} cells across the width of even a 21:9 window, inside the period of ${SHIMMER_PERIOD}, so the field does not tile across the view`);

  const phase = (t: number) => shimmerPhase(t, T);
  ok(phase(0) === 0 && phase(Number.NaN) === 0 && phase(Infinity) === 0, 'a time that is not a time stands the drift still rather than losing it');
  ok(phase(10) > 0 && phase(10) < SHIMMER_WRAP, 'it runs forward inside the wrap');
  const period = SHIMMER_WRAP / T.shimmerRate;
  ok(near(phase(period), 0, 1e-9) && near(phase(period * 3 + 7), phase(7), 1e-9), `it comes back to where it began every ${period.toFixed(0)} s`);

  // The wrap is only harmless if the noise field is the same on both sides of it. Value noise has
  // no period at all, so this is the property the whole scheme rests on: below is the shader's own
  // lattice arithmetic, and a grid of points must give the same answer at phase 0 and at the wrap.
  const wrapMod = (a: number, m: number) => ((a % m) + m) % m;
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const uwNoise = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let fx = x - ix;
    let fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const ax = wrapMod(ix, SHIMMER_PERIOD);
    const ay = wrapMod(iy, SHIMMER_PERIOD);
    const bx = wrapMod(ix + 1, SHIMMER_PERIOD);
    const by = wrapMod(iy + 1, SHIMMER_PERIOD);
    const lo = hash(ax, ay) + (hash(bx, ay) - hash(ax, ay)) * fx;
    const hi = hash(ax, by) + (hash(bx, by) - hash(ax, by)) * fx;
    return lo + (hi - lo) * fy;
  };
  // The two octaves' drifts, as the shader writes them: phase * (1, 0.5) and -phase * (0.5, 1).
  const wobble = (x: number, y: number, p: number) =>
    uwNoise(x + p * 1.0, y + p * 0.5) * 0.65 + uwNoise(x * SHIMMER_FINE - p * 0.5, y * SHIMMER_FINE - p * 1.0) * 0.35;

  ok(
    Number.isInteger(SHIMMER_WRAP * 1.0 / SHIMMER_PERIOD) && Number.isInteger(SHIMMER_WRAP * 0.5 / SHIMMER_PERIOD),
    'across one wrap each octave moves a whole number of periods, which is why the field lands back on itself',
  );

  let worst = 0;
  let lowest = 1;
  let highest = 0;
  for (let i = 0; i < 40; i++) {
    for (let j = 0; j < 40; j++) {
      const x = i * 0.37 - 4;
      const y = j * 0.29 - 3;
      const a = wobble(x, y, 0);
      const b = wobble(x, y, SHIMMER_WRAP);
      worst = Math.max(worst, Math.abs(a - b));
      lowest = Math.min(lowest, a);
      highest = Math.max(highest, a);
    }
  }
  ok(worst < 1e-9, `the field at the wrap is the field at the start (worst of 1600 points: ${worst.toExponential(1)}), so nothing snaps sideways once a wrap`);
  ok(lowest >= 0 && highest <= 1, 'and the wobble stays inside 0 to 1, so the offset it drives is bounded');

  // Two wraps on, too, and a whole wrap on from an arbitrary moment: the period is real, not a
  // coincidence of the origin.
  let worstMid = 0;
  for (let i = 0; i < 25; i++) {
    const x = i * 0.53 - 2;
    const y = i * -0.41 + 1;
    worstMid = Math.max(worstMid, Math.abs(wobble(x, y, 3.7) - wobble(x, y, 3.7 + SHIMMER_WRAP)));
    worstMid = Math.max(worstMid, Math.abs(wobble(x, y, 0) - wobble(x, y, SHIMMER_WRAP * 2)));
  }
  ok(worstMid < 1e-9, 'and it repeats from any moment, not only from the origin');
}

// --- one pixel, the shader line for line ---

{
  const look = createUnderwaterLook();
  const pixel: Vec3 = [0.6, 0.55, 0.5];
  // Six metres down: past the surface ease, so the whole look is in and the numbers are the real ones.
  deriveUnderwater(BLUE, PLAIN, 6, DAY, 1, 1, T, look);

  applyUnderwaterPixel(pixel, 5000, look, out);
  ok(near(out[0], look.murk[0], 1e-9) && near(out[1], look.murk[1], 1e-9) && near(out[2], look.murk[2], 1e-9), 'the far end settles onto the murk exactly: it is an exponential, so nothing ever overshoots it and has to be clipped');

  // Between the two it is monotone and stays inside the two ends, per channel.
  let inside = true;
  let toward = true;
  applyUnderwaterPixel(pixel, 0, look, out);
  const previous: Vec3 = [out[0], out[1], out[2]];
  for (let d = 0.5; d <= 120; d += 0.5) {
    applyUnderwaterPixel(pixel, d, look, out);
    for (let i = 0; i < 3; i++) {
      const lo = Math.min(previous[i], look.murk[i]);
      const hi = Math.max(previous[i], look.murk[i]);
      if (out[i] < lo - 1e-9 || out[i] > hi + 1e-9) inside = false;
      if (Math.abs(out[i] - look.murk[i]) > Math.abs(previous[i] - look.murk[i]) + 1e-12) toward = false;
      previous[i] = out[i];
    }
  }
  ok(inside, 'every distance between leaves each channel between the pixel and the murk');
  ok(toward, 'and each one only ever moves toward the murk, never away and back');

  applyUnderwaterPixel(pixel, 8, look, out);
  ok(out[0] / out[2] < pixel[0] / pixel[2], 'eight metres of blue water takes more red off a grey pixel than blue: it reads as blue, not as grey mist');

  deriveUnderwater(BLUE, PLAIN, 6, DAY, 0, 1, T, look);
  applyUnderwaterPixel(pixel, 300, look, out);
  ok(out[0] === pixel[0] && out[1] === pixel[1] && out[2] === pixel[2], 'at strength 0 the picture is untouched at any distance, and only the shimmer is left');
  ok(look.shimmer > 0, 'while the shimmer, which has a strength of its own, is still there');

  deriveUnderwater(BLUE, PLAIN, 6, DAY, 1, 0, T, look);
  ok(look.shimmer === 0 && look.extinction[2] > 0, 'and the shimmer goes to zero on its own without taking the colour with it');

  deriveUnderwater(BLUE, PLAIN, 25, DAY, 1, 1, T, look);
  applyUnderwaterPixel(pixel, 0, look, out);
  ok(out[0] !== pixel[0] && near(out[2], pixel[2] + (look.murk[2] - pixel[2]) * look.veil, 1e-12), "deep down even a pixel against the eye takes the veil, which is the part a pixel's own distance cannot give");
}

// --- the fallback the pass wears when a depth is not a number ---

{
  ok(UNDERWATER_FALLBACK.depth > 0 && UNDERWATER_FALLBACK.color.every((c) => c >= 0 && c <= 1), 'the fallback is a real depth and a real colour');
  ok(UNDERWATER_FALLBACK.color[2] > UNDERWATER_FALLBACK.color[1] && UNDERWATER_FALLBACK.color[1] > UNDERWATER_FALLBACK.color[0], "and it is the converter's own neutral water: blue over green over red");
  ok(UNDERWATER_FALLBACK.opacity > 0 && UNDERWATER_FALLBACK.opacity <= 1, 'and a real opacity, so a body never asked about is ordinary water');
}

// --- the shader is these formulas, checked rather than claimed ---

{
  const src = readFileSync(new URL('../../../src/core/fx/underwater.ts', import.meta.url), 'utf8');
  const has = (needle: string) => src.includes(needle);

  // The noise's period is written into the GLSL from this module's own constant, so the two cannot
  // drift: if SHIMMER_PERIOD moves, the shader moves with it.
  ok(has('mod(i, ${SHIMMER_PERIOD}.0)') && has('mod(i + 1.0, ${SHIMMER_PERIOD}.0)'), "the shader's noise takes its period straight from SHIMMER_PERIOD rather than writing a number of its own");
  ok(has('p * ${SHIMMER_FINE} - phase'), "and the finer octave's rate straight from SHIMMER_FINE, so the shader and shimmerCellsMax cannot pick two different ones — which is exactly how the tiling ceiling came to be wrong");
  ok(has('shimmerPhase(ctx.time, T)'), 'and its drift is wrapped by shimmerPhase, which this file has just pinned');
  ok(!has('FX_VNOISE') && !has('fxVnoise'), 'it does not use the chain\'s plain value noise, which has no period and so cannot be wrapped');

  // The way out overhead, line for line with waterPath.
  ok(has('path = min(path, uCeiling.x / max(up, 1e-4))'), 'the way out through the surface is min(distance, depth / up) with the divisor held off zero, as waterPath is');
  ok(has('up > 0.0'), 'and it is taken on the ray climbing at all rather than at some angle threshold, so there is no seam at the horizon');

  // The shimmer is the frame's one amplitude, with the old near-field rule behind a uniform that is
  // 0 at the default. Checked as text because this is the whole of what the owner asked for.
  ok(has('float amp = uShimmer.x;'), "the shader's amplitude is the frame's one number: nothing about where a pixel stands narrows it");
  ok(has('if (uShimmerFade.y > 0.0) amp *= 1.0 - smoothstep(uShimmerFade.x, uShimmerFade.y, path);'), 'and the rule it replaced is behind one uniform, which shimmerReach leaves at 0');
  ok(has('shimmerFadeStart(reach)'), "whose near edge the pass takes from shimmerFadeStart, so the shader and this module cannot pick two different ones");
  ok(has('* amp * vec2(1.0, aspect)'), 'the offset is scaled by the aspect in v, so the wobble is as wide as it is tall in pixels');
  ok(has('vec2 p = vUv * vec2(aspect, 1.0) * uShimmer.y;'), 'and the lattice is laid out with the aspect in u, which is what makes shimmerCells a count down the HEIGHT and the width carry aspect times as many');

  // The whole-frame property, in the draw rather than in the module. The two lines above say what
  // touches `amp`; this says that nothing else does — a third per-pixel factor added later would
  // leave both of them standing and reach here instead.
  const fragmentFrom = src.indexOf('fragmentShader:');
  const fragment = src.slice(fragmentFrom, src.indexOf('};', fragmentFrom));
  const ampWrites = fragment.match(/\bamp\b\s*(\*=|\+=|-=|\/=|=)/g) ?? [];
  ok(ampWrites.length === 2, `exactly two lines in the fragment program write the amplitude (found ${ampWrites.length}: ${ampWrites.join(', ')}) — the frame's own number and the comparison knob, and nothing per pixel besides`);
  const withoutFade = fragment.replace('if (uShimmerFade.y > 0.0) amp *= 1.0 - smoothstep(uShimmerFade.x, uShimmerFade.y, path);', '');
  ok(!/\bamp\b\s*\*=/.test(withoutFade), "and with the comparison knob's own line taken out nothing multiplies it at all, so at the default every pixel in the frame takes the same one");

  // The pixel itself, line for line with applyUnderwaterPixel.
  ok(has('vec3 t = exp(-uExtinction * path);'), 'a pixel keeps exp(-k x path) of itself, per channel');
  ok(has('c = c * t + uMurk * (1.0 - t);'), 'and takes the murk in place of the rest');
  ok(has('c = mix(c, uMurk, uVeil);'), 'and then the veil takes its share of whatever is left');

  // The two octaves' drifts must be the ones the wrap was proved for.
  ok(has('uwNoise(p + phase * vec2(1.0, 0.5))') && has('uwNoise(p * ${SHIMMER_FINE} - phase * vec2(0.5, 1.0))'), 'the two octaves drift by the very vectors the wrap was just checked with');

  // And the pass reads the frame's own facts rather than an optional shape of its own.
  ok(has('ctx.underwaterColor') && has('ctx.underwaterDepth') && has('ctx.underwaterOpacity'), 'the pass reads the three facts off the frame context by name, so a rename fails the build rather than falling back for ever');
  ok(!has('interface UnderwaterFrameFacts'), 'and it keeps no optional copy of the context\'s shape, which would have hidden such a rename');
  ok(has('lightOf(ctx.lights, T)'), "the murk is lit by the frame's own light record, which is what the owner's \"it should become shadowier\" needed: a level of its own could only ever be one level");
  ok(!/deriveUnderwater\([^)]*ctx\.daylight/.test(src), "and the day's own 0 to 1 is no longer what drives it, so a shaded cove at noon is not lit as a cove at noon");
  ok(has('return ctx.cameraSubmerged;'), 'it draws from cameraSubmerged, the strict fact, and not from cameraUnderwater, which is still true while the eye is plainly in the air');
  ok(has('if (!ctx.settings.underwater) return null;'), "and `reason` answers about its own switch first, so postfx's own \"its setting is off\" is not hidden behind \"the camera is not under water\" on every dry frame");
}

// --- the registry ---

{
  const def = fxPassDef('underwater');
  ok(def.stage === 'scene' && !def.required && !def.canBeLast && def.live, 'the underwater row is a live scene pass, never required and never last');
  ok(def.needs.length === 0, "it asks for no product at all: the scene's own depth is enough");
  ok(!def.typical, 'and it is not counted in a typical frame, since a typical frame is not under water');
  ok(def.toggles.length === 1 && def.toggles[0] === 'underwater', 'one switch turns it on');
  ok(fxPassIndex('underwater') === fxPassIndex('godRays') + 1, 'it comes straight after the god rays');
  ok(fxPassIndex('underwater') < fxPassIndex('depthOfField'), 'and before the lens, so the aperture softens what the water has already done');
  ok(FX_PASSES.filter((p) => p.id === 'underwater').length === 1, 'and it is in the chain exactly once');

  ok(FX_DEFAULTS.underwater === true && FX_DEFAULTS.underwaterStrength === 1 && FX_DEFAULTS.underwaterShimmerStrength === 1, 'on at strength 1 with the shimmer at 1 by default');
  for (const key of ['underwater', 'underwaterStrength', 'underwaterShimmerStrength'] as const) {
    const knob = FX_KNOBS.find((k) => k.key === key);
    ok(!!knob && knob.pass === 'underwater', `"${key}" has a knob of the underwater pass`);
    ok(!!knob && knob.requires.includes('effects'), `"${key}" is greyed with Effects off, since with Effects off nothing under water changes at all`);
  }
  const strength = FX_KNOBS.find((k) => k.key === 'underwaterStrength');
  const shimmer = FX_KNOBS.find((k) => k.key === 'underwaterShimmerStrength');
  ok(strength?.kind === 'range' && strength.min === 0 && strength.max === 2, 'the strength runs 0 to 2, and 0 turns the colour off without turning the pass off');
  ok(shimmer?.kind === 'range' && shimmer.min === 0 && shimmer.max === 2, 'the shimmer does too');
  ok(shimmer!.requires.includes('underwater') && strength!.requires.includes('underwater'), 'both wait on the look itself');
}

// --- the pass is really on the chain ---

{
  const install = readFileSync(new URL('../../../src/core/fx/install.ts', import.meta.url), 'utf8');
  ok(install.includes("import { UnderwaterPass } from './underwater'"), 'installEffects imports the pass');
  ok(install.includes('postfx.registerPass(new UnderwaterPass())'), 'and registers it on every chain it builds, or the whole look would be dead code that type-checks and tests and never draws');
}

// --- the console knob, last, because it writes the live tuning ---

{
  const before = { ...UNDERWATER_TUNE };
  tuneUnderwater({ sight: 30, ceiling: false });
  ok(UNDERWATER_TUNE.sight === 30 && UNDERWATER_TUNE.ceiling === false, 'a known key of the right kind is written');
  tuneUnderwater({ sight: Number.NaN });
  ok(UNDERWATER_TUNE.sight === 30, 'a number that is not a number is refused');
  tuneUnderwater({ sight: 'deep' as unknown as number });
  ok(UNDERWATER_TUNE.sight === 30, 'so is a word where a number goes');
  tuneUnderwater({ ceiling: 1 as unknown as boolean });
  ok(UNDERWATER_TUNE.ceiling === false, 'and a number where a yes or no goes');
  tuneUnderwater({ nonsense: 3 } as Partial<UnderwaterTune>);
  ok(!('nonsense' in UNDERWATER_TUNE), 'a key that is not one of its own is not added');
  tuneUnderwater(undefined);
  ok(UNDERWATER_TUNE.sight === 30, 'and asking with nothing changes nothing');

  // Every one of those refusals is silent, which inside a draw is right and at a console is not:
  // `shimmerNear` and `shimmerFar` outlived the tune by a whole wave in the doc comment the owner
  // types from, and typing one would have looked exactly like a shimmer that does not work.
  ok(unknownUnderwaterKeys({ sight: 30, ceiling: false }).length === 0, 'a patch of real keys of the right kind leaves nothing behind');
  ok(unknownUnderwaterKeys({ shimmerNear: 2, shimmerFar: 28 } as Partial<UnderwaterTune>).join(',') === 'shimmerNear,shimmerFar', 'the two names that outlived the tune are named back rather than dropped in silence');
  ok(unknownUnderwaterKeys({ sight: Number.NaN }).join(',') === 'sight', 'so is a real key given a number that is not one');
  ok(unknownUnderwaterKeys({ sight: 'deep' as unknown as number }).join(',') === 'sight' && unknownUnderwaterKeys({ ceiling: 1 as unknown as boolean }).join(',') === 'ceiling', 'and a real key given the wrong kind of value entirely');
  ok(unknownUnderwaterKeys(undefined).length === 0, 'asking with nothing names nothing');
  for (const key of Object.keys(UNDERWATER_TUNE)) {
    const value = (UNDERWATER_TUNE as unknown as Record<string, unknown>)[key];
    if (unknownUnderwaterKeys({ [key]: value } as Partial<UnderwaterTune>).length !== 0) {
      ok(false, `every key of the tune is writable by its own name (${key} was not)`);
    }
  }
  ok(true, `all ${Object.keys(UNDERWATER_TUNE).length} keys of the tune are writable by their own names, so the reply's "ignored" is a misspelling and never a false alarm`);

  Object.assign(UNDERWATER_TUNE, before);
  ok(UNDERWATER_TUNE.sight === before.sight && UNDERWATER_TUNE.ceiling === before.ceiling, 'the tuning is put back as it was');
}

// --- and the console's own doc comment names exactly those keys, which is the list a reader types from ---

{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  const from = main.indexOf('The look under water: what the pass was given');
  ok(from > 0, "main.ts still carries the __debug.underwater doc comment");
  const comment = main.slice(from, main.indexOf('*/', from));
  const named = new Set((comment.match(/`([A-Za-z]+)`/g) ?? []).map((s) => s.slice(1, -1)));
  const missing = Object.keys(UNDERWATER_TUNE).filter((k) => !named.has(k));
  ok(missing.length === 0, `it names every key of the tune (missing: ${missing.join(', ') || 'none'})`);
  const dead = [...named].filter((k) => /^(shimmer|light|murk|body|veil|surface)[A-Za-z]*$/.test(k) && !(k in UNDERWATER_TUNE) && k !== 'shimmerLattice');
  ok(dead.length === 0, `and names no key the tune no longer has (found: ${dead.join(', ') || 'none'}) — shimmerNear and shimmerFar sat there for a wave after they were deleted`);
}

console.log(`\n${passed} checks passed`);
