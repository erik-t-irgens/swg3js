// The water surface's own opacity against the depth under it, checked without a browser: where the
// body keeps the converted shader's number, where it reaches `most`, that it only ever raises, that
// an eye under the surface takes none of it, and that the whole rule vanishes at strength 0.
//
// The last block reads `src/world/water.ts` as text and checks the shader is these same lines rather
// than taking the claim on trust, the way the underwater pass's test reads its own pass. Where a
// check could be satisfied by restating the implementation's expression it is written as a property
// instead (monotone, bounded, the smoothstep's own midpoint), so a term put in wrongly in both
// places would still fail.
//
// There was no such rule in the game -- there was no going under, and the client's water pixel
// shader takes its alpha from the texture alone -- so every number here is ours.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clamp01,
  deepEdge,
  smoothstep,
  surfaceBandFor,
  surfaceHideFor,
  surfaceHideUniform,
  surfaceOpacityFor,
  tuneWaterSurface,
  WATER_SURFACE_TUNE,
  type WaterSurfaceTune,
} from '../../../src/world/waterSurfaceMath.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** A copy of the live tuning, so nothing here depends on an earlier check having put it back. */
const T: WaterSurfaceTune = { ...WATER_SURFACE_TUNE };
/** The converter's own neutral water opacity, which is what most bodies wear. */
const PLAIN = 0.75;
/** Well over the surface: the eye on a beach rather than in the water. */
const ABOVE = 5;

// --- the helpers are GLSL's ---

{
  ok(clamp01(-1) === 0 && clamp01(2) === 1 && clamp01(0.4) === 0.4, 'clamp01 holds a number to 0..1');
  ok(smoothstep(2, 4, 1) === 0 && smoothstep(2, 4, 5) === 1 && near(smoothstep(2, 4, 3), 0.5, 1e-12), 'smoothstep is flat outside its edges and a half in the middle');
  ok(deepEdge(T) === T.deep, 'the deep edge is the tuning\'s own when the two are the right way round');
  ok(deepEdge({ ...T, shallow: 9, deep: 1 }) > 9, 'and is pushed past the shallow one when they are typed the wrong way round, so the fade is never inverted');
}

// --- the shallows are untouched, the deep is a sheet ---

{
  ok(surfaceOpacityFor(PLAIN, 0, ABOVE, T) === PLAIN, 'a pixel over dry ground keeps the body\'s own opacity exactly');
  ok(surfaceOpacityFor(PLAIN, T.shallow, ABOVE, T) === PLAIN, `and so does one over ${T.shallow} m of water, where the rule starts`);
  ok(near(surfaceOpacityFor(PLAIN, T.deep, ABOVE, T), T.most, 1e-12), `over ${T.deep} m it has reached ${T.most}`);
  ok(near(surfaceOpacityFor(PLAIN, 100, ABOVE, T), T.most, 1e-12), 'and it stops there rather than climbing on toward 1 over a trench');

  // The three depths the owner will look at. Arithmetic, not eyesight: these are the shares of the
  // bed that still come through, 1 - alpha, before and after.
  const before = 1 - PLAIN;
  const after = (d: number) => 1 - surfaceOpacityFor(PLAIN, d, ABOVE, T);
  ok(near(after(1) / before, 0.966, 0.01), `at 1 m of water ${(100 * after(1)).toFixed(0)}% of the bed comes through against ${(100 * before).toFixed(0)}% before: a shallow bay is as clear as it ever was`);
  ok(after(3) < before * 0.6, `at 3 m only ${(100 * after(3)).toFixed(0)}% does`);
  ok(after(10) < before * 0.2, `and at 10 m ${(100 * after(10)).toFixed(0)}%, which is the surface hiding what is below it`);
}

// --- it only ever raises, and never past 1 ---

{
  let raises = true;
  let bounded = true;
  for (const base of [0.1, 0.4, PLAIN, 0.9, 0.98, 1]) {
    for (let d = 0; d <= 40; d += 0.25) {
      const a = surfaceOpacityFor(base, d, ABOVE, T);
      if (a < base - 1e-12) raises = false;
      if (a > 1 + 1e-12 || a < 0) bounded = false;
    }
  }
  ok(raises, 'over every depth and every converted opacity it only ever raises: no body is made clearer than the converter read it');
  ok(bounded, 'and it never passes 1 or falls under 0');

  ok(near(surfaceOpacityFor(0.98, 50, ABOVE, T), 0.98, 1e-12), `a body the converter read as thicker than ${T.most} keeps its own number at every depth`);

  let rising = true;
  let previous = -1;
  for (let d = 0; d <= 20; d += 0.5) {
    const a = surfaceOpacityFor(PLAIN, d, ABOVE, T);
    if (!(a >= previous - 1e-12)) rising = false;
    previous = a;
  }
  ok(rising, 'and it never falls as the water under the pixel gets deeper');

  // A smoothstep, checked as one rather than by writing the expression out again: halfway between
  // the two edges it is halfway between the two opacities.
  const mid = surfaceOpacityFor(PLAIN, (T.shallow + T.deep) / 2, ABOVE, T);
  ok(near(mid, PLAIN + (T.most - PLAIN) * 0.5, 1e-12), 'halfway between the shallow and the deep edge it stands halfway between the two opacities');
}

// --- an eye under the surface takes none of it ---

{
  ok(surfaceOpacityFor(PLAIN, 30, 0, T) === PLAIN, 'right at the surface line the rule takes nothing, so nothing steps as the head goes under');
  ok(surfaceOpacityFor(PLAIN, 30, -2, T) === PLAIN, 'and two metres under it takes nothing either: looking up is the way out and must stay it');
  ok(near(surfaceOpacityFor(PLAIN, 30, T.eyeBand, T), T.most, 1e-12), `${T.eyeBand} m over the surface the whole of it is in`);

  // Nothing jumps on the way up through the line either.
  let jump = 0;
  let before = surfaceOpacityFor(PLAIN, 30, -1, T);
  for (let e = -1; e <= 1.5; e += 0.005) {
    const a = surfaceOpacityFor(PLAIN, 30, e, T);
    jump = Math.max(jump, Math.abs(a - before));
    before = a;
  }
  ok(jump < (T.most - PLAIN) * 0.05, `it comes in without a step: the biggest jump over half a centimetre of height is ${jump.toFixed(5)}`);
}

// --- the switch, and numbers that are not numbers ---

{
  ok(surfaceHideFor(50, ABOVE, { ...T, hide: 0 }) === 0, 'at strength 0 the rule takes nothing at any depth');
  let same = true;
  for (const base of [0.4, PLAIN, 0.9]) for (const d of [0, 1, 3, 10, 400]) if (surfaceOpacityFor(base, d, ABOVE, { ...T, hide: 0 }) !== clamp01(base)) same = false;
  ok(same, 'so `hide: 0` is the water exactly as it was, on every body and at every depth, which is the switch');
  ok(near(surfaceHideFor(50, ABOVE, { ...T, hide: 0.5 }), 0.5, 1e-12), 'and between the two it scales straight');

  ok(surfaceOpacityFor(PLAIN, Number.NaN, ABOVE, T) === PLAIN, 'a depth that is not a depth takes none of the rule rather than painting a lake black');
  ok(surfaceOpacityFor(PLAIN, 30, Number.NaN, T) === PLAIN, 'and so does an eye height that is not one');
  ok(near(surfaceOpacityFor(Number.NaN, 30, ABOVE, T), T.most, 1e-12), 'a body with no opacity of its own is read as ordinary water and still hides its depths');
  ok(surfaceHideFor(30, ABOVE, { ...T, hide: Number.NaN }) > 0, 'a strength that is not a number leaves the rule whole rather than losing it');
}

// --- the depth grid's verdict, which is the input that is really out of range ---
//
// The shader answers a flat 100 m for a point outside the 2048 m window and for a cell the refresh
// has not reached: a real number, not a NaN, and exactly the number that would mean "a trench". Read
// as one it turns the whole rule on over every water pixel in the frame for the first seconds after
// a load and over all shallow water past about 900 m for ever. So the verdict is an argument of its
// own and 0 means no rule, whatever the depth beside it says.

{
  const SENTINEL = 100; // what the shader's waterDepth answers where it cannot speak.
  ok(surfaceOpacityFor(PLAIN, SENTINEL, ABOVE, T, 0) === PLAIN, 'the window\'s own "no verdict" leaves the body wearing the converted shader\'s opacity, however deep the number beside it reads');
  ok(surfaceHideFor(SENTINEL, ABOVE, T, 0) === 0, 'and none of the rule is taken there at all');
  let untouched = true;
  for (const base of [0.4, PLAIN, 0.9]) for (const d of [0, 0.5, 3, 10, SENTINEL, 1e4]) if (surfaceOpacityFor(base, d, ABOVE, T, 0) !== clamp01(base)) untouched = false;
  ok(untouched, 'so the seconds after a load, and every lake past the window, are the water exactly as it was rather than a sheet');

  ok(near(surfaceOpacityFor(PLAIN, SENTINEL, ABOVE, T, 1), T.most, 1e-12), 'a depth the window really measured at 100 m is a trench and is hidden: the verdict is what tells the two apart, never the number');
  ok(near(surfaceHideFor(30, ABOVE, T, 0.5), surfaceHideFor(30, ABOVE, T, 1) * 0.5, 1e-12), 'and between the two it scales straight, so a filtered edge of the window fades rather than steps');
  ok(near(surfaceHideFor(30, ABOVE, T, Number.NaN), surfaceHideFor(30, ABOVE, T, 1), 1e-12), 'a verdict that is not a number is read as a measurement, so a caller that cannot say leaves the rule whole');
  ok(near(surfaceHideFor(30, ABOVE, T), surfaceHideFor(30, ABOVE, T, 1), 1e-12), 'and a caller that passes none is read the same way');
}

// --- the four numbers the card is given, in the slots the shader reads them from ---
//
// A transposed .z and .w would invert the fade and every check above would still pass, because the
// rule and the shader are checked apart. This is the join: the order is one function's, `water.ts`
// writes the vec4 straight from it, and the fragment program's own uses are read as text below.

{
  const slots = surfaceHideUniform(T, [0, 0, 0, 0]);
  ok(slots.length === 4 && slots.every((n) => Number.isFinite(n)), 'four numbers, all of them numbers');
  ok(slots[0] === clamp01(T.hide), 'slot 0 (.x in the shader) is the strength, clamped as the rule clamps it');
  ok(slots[1] === clamp01(T.most), 'slot 1 (.y) is the opacity deep water reaches');
  ok(slots[2] === Math.max(0, T.shallow) && slots[3] === deepEdge(T), 'slots 2 and 3 (.z, .w) are the shallow and the deep edge, in that order and never the other way round');
  ok(slots[2] < slots[3], 'and the shallow one is the smaller, which is what makes the shader\'s smoothstep a fade rather than an inversion');

  const daft = surfaceHideUniform({ hide: 5, most: -2, shallow: -3, deep: -9, eyeBand: 0 }, [0, 0, 0, 0]);
  ok(daft[0] === 1 && daft[1] === 0 && daft[2] === 0 && daft[3] > 0, 'numbers typed outside their range are held to it here exactly as the rule holds them, so the card and the mirror cannot disagree');
  ok(surfaceBandFor({ ...T, eyeBand: 0 }) > 0 && surfaceBandFor(T) === T.eyeBand, 'and the eye band the card takes is the rule\'s own, never zero');

  // The clamps are the same clamps, checked rather than claimed: the rule reads the tuning as it is
  // and the card is given it clamped, so for any tuning the two must agree at every depth.
  let agree = true;
  for (const tune of [T, { ...T, hide: 5 }, { ...T, most: 2 }, { ...T, shallow: -1 }, { ...T, deep: 0.1 }]) {
    const v = surfaceHideUniform(tune, [0, 0, 0, 0]);
    for (const d of [0, 0.25, 1, 3, 7, 40]) {
      const card = smoothstep(v[2], v[3], Math.max(0, d)) * clamp01(v[0]);
      if (!near(card, surfaceHideFor(d, ABOVE, tune), 1e-12)) agree = false;
    }
  }
  ok(agree, 'so over every tuning and every depth the numbers on the card work out to what the rule says, which is the check a transposition fails');
}

// --- the shader is these formulas, checked rather than claimed ---

{
  const src = readFileSync(new URL('../../../src/world/water.ts', import.meta.url), 'utf8');
  const has = (needle: string) => src.includes(needle);

  ok(has('float hide = smoothstep(uSurfaceHide.z, uSurfaceHide.w, max(depth, 0.0)) * clamp(uSurfaceHide.x, 0.0, 1.0) * over * depthKnown;'), 'the shader takes the depth between the two edges times the strength times the eye term times the window\'s own verdict, as surfaceHideFor does');
  ok(has('float over = smoothstep(0.0, uSurfaceBand, cameraPosition.y - vWaterLevel);'), 'and the eye term is how far the camera stands over this pixel\'s own surface, over uSurfaceBand metres');
  ok(has('diffuseColor.a += (max(diffuseColor.a, uSurfaceHide.y) - diffuseColor.a) * hide;'), 'and it raises the alpha toward the deeper of the two, which is why a thick body keeps its own');
  ok(!has('diffuseColor.a = mix(diffuseColor.a, uSurfaceHide.y'), 'it does not mix straight to that number, which would make a thick body thinner over deep water');

  // The verdict, and that the depth beside it is the same one fetch: a second lookup would be a tap
  // a pixel on every water surface in the game, and two lookups could disagree at a window edge.
  ok(has('float waterDepthKnown(vec2 p, out float known)') && has('known = 1.0;'), 'the depth lookup hands back whether the window has a verdict at all, 0 outside it and in a cell the refresh has not reached');
  ok(has('float depth = waterDepthKnown(vWaterXZ, depthKnown);'), 'and the pixel takes both from the one fetch rather than looking the depth up twice');
  ok(/float waterDepth\(vec2 p\) \{\s*float known;\s*return waterDepthKnown\(p, known\);\s*\}/.test(src), 'while waterDepth itself is that same function with the verdict dropped, so the waves and the shore band keep their "deep where unknown" exactly');
  ok(!/float depth = waterDepth\(vWaterXZ\);/.test(src), 'nothing in the fragment reads a depth it cannot tell a shrug from');
  ok(has('export function resetWaterDepth()'), 'and the window can be emptied, so a travel does not slide one world\'s bed under another world\'s water');

  // It must be the one program every body already wears: no define, no second material.
  ok(!has('SURFACE_HIDE:') && !/defines[^\n]*uSurfaceHide/.test(src), 'the rule is behind no define, so no body compiles a program of its own for it');
  ok(has('uSurfaceHide: WATER_SURFACE_HIDE') && has('uSurfaceBand: WATER_SURFACE_BAND'), 'every material is given the same two shared uniform objects, so the console\'s knob is one write rather than a walk');
  ok(has('export function syncWaterSurface()') && has('syncWaterSurface();'), 'and the tuning is pushed into them once at load rather than read on a frame');
  ok(has('export function setWaterSurface('), 'with one setter for the console, which writes the tuning and hands it to the card');

  // The join between the rule's order and the shader's slots: water.ts writes the vec4 straight from
  // surfaceHideUniform and does no arithmetic of its own, so the block above pins both halves.
  ok(has('const v = surfaceHideUniform(WATER_SURFACE_TUNE, HIDE_SLOTS);') && has('WATER_SURFACE_HIDE.value.set(v[0], v[1], v[2], v[3]);'), 'the four numbers go to the card in the order surfaceHideUniform writes them, straight, with no second copy of the clamps to drift');
  ok(has('WATER_SURFACE_BAND.value = surfaceBandFor(WATER_SURFACE_TUNE);'), 'and the eye band likewise');
  ok(!/WATER_SURFACE_HIDE\.value\.set\([^)]*Math\./.test(src), 'water.ts clamps none of it itself, so there is one set of bounds rather than two that must be kept in step by reading');

  // The mask twin shares the lit material's uniform objects, so the reflections weight what the lit
  // water blends: that is what keeps a traced reflection and the surface's own alpha in step.
  ok(has("installWaterHook(mask, lit.userData.uniforms, 'mask', lit.userData.waves)"), 'the mask twin shares the lit material\'s uniforms, so the depth it hides by is the same number the reflections weight');
}

// --- the console knob, last, because it writes the live tuning ---

{
  const before = { ...WATER_SURFACE_TUNE };
  tuneWaterSurface({ most: 0.8, deep: 9 });
  ok(WATER_SURFACE_TUNE.most === 0.8 && WATER_SURFACE_TUNE.deep === 9, 'a known key of the right kind is written');
  tuneWaterSurface({ most: Number.NaN });
  ok(WATER_SURFACE_TUNE.most === 0.8, 'a number that is not a number is refused');
  tuneWaterSurface({ most: 'thick' as unknown as number });
  ok(WATER_SURFACE_TUNE.most === 0.8, 'so is a word where a number goes');
  tuneWaterSurface({ nonsense: 3 } as Partial<WaterSurfaceTune>);
  ok(!('nonsense' in WATER_SURFACE_TUNE), 'a key that is not one of its own is not added');
  tuneWaterSurface(undefined);
  ok(WATER_SURFACE_TUNE.most === 0.8, 'and asking with nothing changes nothing');
  Object.assign(WATER_SURFACE_TUNE, before);
  ok(WATER_SURFACE_TUNE.most === before.most && WATER_SURFACE_TUNE.deep === before.deep, 'the tuning is put back as it was');
}

console.log(`\n${passed} checks passed`);
