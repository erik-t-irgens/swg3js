// The depth of field's arithmetic, checked without a browser: the gather's taps, the thin-lens circle
// of confusion and its aperture stop, the shooter's fade, the worked radii the design promises, the
// focus's median and easing, the per-frame numbers (the lens grid's stride, the radius cap, the tile
// reach, the tap count), and the wardrobe doll's gate. The shaders in `src/core/fx/dof.ts` and
// `src/ui/previewDof.ts` do the same arithmetic as `dofMath.ts`, so what is pinned here is what the
// GPU draws.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clampTuning,
  createDofFrame,
  DOF_DEFAULTS,
  DOF_MAX_GRID_RADIUS,
  dofEase,
  dofFrame,
  dofKs,
  dofRadius,
  dofRaw,
  dofStride,
  focusBlend,
  focusMedian,
  focusStep,
  glslVec2Array,
  PREVIEW_DOF,
  previewGate,
  previewLensOn,
  previewSpan,
  vogelTaps,
  type DofFrameInput,
  type DofTuning,
  type FocusState,
  type PreviewSpan,
} from '../../../src/core/fx/dofMath.ts';
import { FX_DEFAULTS, FX_KNOBS, fxPassDef, fxProductDef } from '../../../src/core/fxRegistry.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const T: DofTuning = { ...DOF_DEFAULTS };

/** Drawing-buffer pixels at 1440p, strength 1, the shooter at 3.85 m (fade 4.35 to 6.85), focus s metres. */
const px = (z: number, s: number, t: DofTuning = T) => 2 * dofRadius(dofRaw(z, 1 / s, t), 1 / s, 4.32, 4.35, 6.85, t);
/** The same with no fade at all. */
const pxUnfaded = (z: number, s: number) => 2 * dofRadius(dofRaw(z, 1 / s, T), 1 / s, 4.32, -2e4, -1e4, T);

// ---- 1. Taps ----
{
  const taps = vogelTaps(24);
  ok(taps.length === 24, 'the gather carries 24 taps');
  ok(taps.every(([x, y]) => Math.hypot(x, y) <= 1 + 1e-12), 'every tap lies inside the unit disc');
  const mx = taps.reduce((a, [x]) => a + x, 0) / taps.length;
  const my = taps.reduce((a, [, y]) => a + y, 0) / taps.length;
  ok(Math.hypot(mx, my) <= 0.05, `the taps are centred on the pixel (mean ${Math.hypot(mx, my).toFixed(4)} from it)`);
  let closest = Infinity;
  for (let i = 0; i < taps.length; i++) for (let j = i + 1; j < taps.length; j++) closest = Math.min(closest, Math.hypot(taps[i][0] - taps[j][0], taps[i][1] - taps[j][1]));
  ok(closest >= 0.1, `no two taps are closer than 0.1 (closest ${closest.toFixed(3)})`);
  const t16 = vogelTaps(16);
  const k = Math.sqrt(24 / 16);
  ok(t16.every(([x, y], i) => near(taps[i][0] * k, x, 1e-9) && near(taps[i][1] * k, y, 1e-9)), 'the first 16 of 24 taps, spread by sqrt(24/16), are exactly the 16-tap spiral');
  const src = glslVec2Array('DOF_TAPS', taps);
  ok(src.startsWith('const vec2 DOF_TAPS[24] = vec2[24](') && src.endsWith(');'), 'the GLSL array is a sized constant');
  const parsed = [...src.matchAll(/vec2\((-?[\d.]+), (-?[\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  ok(parsed.length === 24, 'the GLSL array has 24 vec2 entries');
  ok(parsed.every(([x, y], i) => near(x, taps[i][0], 1e-6) && near(y, taps[i][1], 1e-6)), 'the GLSL array reads back to the same taps within 1e-6');
}

// ---- 2. Raw CoC ----
{
  for (const s of [0.5, 15, 40, 2000]) {
    let prev = -Infinity;
    let rising = true;
    let finite = true;
    let bounded = true;
    for (let z = 0.05; z <= 9000; z *= 1.01) {
      const r = dofRaw(z, 1 / s, T);
      if (!(r > prev)) rising = false;
      if (!Number.isFinite(r)) finite = false;
      if (Math.abs(r) >= 400) bounded = false;
      prev = r;
    }
    ok(rising, `the raw CoC rises strictly with depth from 5 cm to 9 km at a ${s} m focus`);
    ok(finite, `the raw CoC is finite at both ends at a ${s} m focus`);
    ok(bounded, `the raw CoC stays inside half-float range (|raw| < 400) at a ${s} m focus`);
  }
  ok(near(dofKs(1 / 40, T), dofKs(1 / 2000, T), 1e-12), 'the aperture stops at 40 m: a 2 km focus has the 40 m aperture');
  ok(near(dofKs(1 / 15, T), 2.8 * Math.sqrt(15), 1e-9), 'the aperture at 15 m is 2.8 sqrt(15)');
}

// ---- 3. Radius ----
{
  const fd = 1 / 15;
  ok(dofRadius(dofRaw(15, fd, T), fd, 4.32, 4.35, 6.85, T) === 0, 'the focus itself is sharp');
  ok(dofRadius(0.06, fd, 4.32, 4.35, 6.85, T) === 0 && dofRadius(-0.06, fd, 4.32, 4.35, 6.85, T) === 0, 'inside the dead zone is sharp');
  ok(px(80, 15) > 0 && px(8, 15) < 0, 'beyond the focus is positive, before it negative');
  let bounded = true;
  let zeroEverywhere = true;
  for (let z = 0.05; z <= 9000; z *= 1.05) {
    const r = dofRadius(dofRaw(z, fd, T), fd, 4.32, 4.35, 6.85, T);
    if (Math.abs(r) > 4.32 + 1e-12) bounded = false;
    if (dofRadius(dofRaw(z, fd, T), fd, 0, 4.35, 6.85, T) !== 0) zeroEverywhere = false;
  }
  ok(bounded, 'the radius never passes the largest');
  ok(zeroEverywhere, 'with no lens yet (largest radius 0) nothing blurs');
}

// ---- 4. The shooter's fade ----
{
  const fd = 1 / 15;
  const at = (z: number) => dofRadius(dofRaw(z, fd, T), fd, 4.32, 4.35, 6.85, T);
  const unfaded = (z: number) => dofRadius(dofRaw(z, fd, T), fd, 4.32, -2e4, -1e4, T);
  ok(at(3.85) === 0, 'the shooter at 3.85 m is sharp');
  ok(at(5) < 0 && at(5) > unfaded(5), `5 m, 1.15 m past the shooter, is partly faded (${at(5).toFixed(2)} against ${unfaded(5).toFixed(2)} half px)`);
  ok(near(at(6.85), unfaded(6.85), 1e-9), 'past the ramp the near radius is the unfaded one');
  ok(near(unfaded(6.85), -3.68, 0.01) && near(dofRaw(6.85, fd, T), -0.86, 0.001), `which at 6.85 m is -3.68 half px, raw -0.860 (${unfaded(6.85).toFixed(3)}, ${dofRaw(6.85, fd, T).toFixed(3)})`);
  const physical: DofTuning = { ...T, keepShooterSharp: false };
  const f = dofFrame({ height: 1440, strength: 1, aimAmount: 1, firstPerson: false, orbitDistance: 3.85, tuning: physical }, createDofFrame());
  ok(f.fadeFrom === -2e4 && f.fadeTo === -1e4, 'with keepShooterSharp off the fade runs from -2e4 to -1e4 (none)');
  ok(near(dofRadius(dofRaw(3.85, fd, T), fd, 4.32, f.fadeFrom, f.fadeTo, T), unfaded(3.85), 1e-12), 'and the shooter then blurs as a lens would');
}

// ---- 5. The worked table ----
{
  const rows: [string, number, number][] = [
    ['sky behind a 15 m target', px(9000, 15), 6.08],
    ['buildings at 80 m behind a 15 m target', px(80, 15), 4.85],
    ['a crate at 8 m before a 15 m target', px(8, 15), -5.26],
    ['a hill at 300 m behind a 30 m target', px(300, 30), 3.68],
    ['sky behind a 150 m target', px(9000, 150), 0.52],
    ['ground at 40 m before a 150 m target', px(40, 150), -2.43],
    ['ground at 40 m before a 1000 m hill', px(40, 1000), -3.35],
  ];
  for (const [what, got, want] of rows) ok(near(got, want, 0.05), `${what}: ${got.toFixed(2)} px (design ${want})`);
}

// ---- 6. A far focus does not blur the whole foreground ----
{
  const full = 8.64;
  ok(Math.abs(px(40, 2000)) <= 0.42 * full, `ground at 40 m under a 2 km focus: ${(Math.abs(px(40, 2000)) / full).toFixed(3)} of full`);
  ok(Math.abs(px(100, 2000)) <= 0.13 * full, `ground at 100 m under a 2 km focus: ${(Math.abs(px(100, 2000)) / full).toFixed(3)} of full`);
  ok(near(Math.abs(px(10, 2000)), full, 1e-9), 'something 10 m off under a 2 km focus still blurs fully');
  let worst150 = 0;
  let worst80 = 0;
  for (let z = 5; z <= 3000; z *= 1.02) {
    worst150 = Math.max(worst150, Math.abs(px(z, 150) - px(z, 2000)));
    worst80 = Math.max(worst80, Math.abs(px(z, 80) - px(z, 2000)));
  }
  ok(worst150 <= 0.13 * full, `a sweep from 150 m to 2 km moves no pixel's blur more than ${(worst150 / full).toFixed(3)} of full`);
  ok(worst80 <= 0.25 * full, `a sweep from 80 m to 2 km moves no pixel's blur more than ${(worst80 / full).toFixed(3)} of full`);
}

// ---- 7. The focus median ----
{
  const sky = 0.99 * 9000;
  ok(focusMedian([15, 15, 15, 200, 200], 0.3, 2000, sky) === 15, 'the median of an edge picks what covers most of the plus');
  ok(focusMedian([3.8, 15, 200], 4.25, 2000, sky) === 15, 'the shooter does not count, and an even count takes the nearer');
  ok(focusMedian([9000, 9000, 9000, 15, 15], 0.3, 2000, sky) === 15, 'the sky does not count');
  ok(focusMedian([9000, 9000, 9000, 9000, 9000], 0.3, 2000, sky) === null, 'all sky: no focus');
  ok(focusMedian([3000, 3000, 3000], 0.3, 2000, sky) === 2000, 'a range beyond 2 km that is not sky counts as 2 km');
  ok(focusMedian([1, 2, 3], 4.25, 2000, sky) === null, 'only the shooter under the crosshair: no focus');
}

// ---- 8. The focus step ----
{
  const sky = 0.99 * 9000;
  const dt = 1 / 144;
  const bn = focusBlend(dt, T.tauNearer, false);
  const bf = focusBlend(dt, T.tauFarther, false);
  const five = (z: number) => [z, z, z, z, z];
  const zero: FocusState = { now: 0, target: 0, samples: 0, amount: 0 };
  let s = focusStep(zero, five(9000), 0.3, 2000, sky, bn, bf, false, { now: 9, target: 9, samples: 9, amount: 9 });
  ok(s.now === 0 && s.target === 0 && s.samples === 0 && s.amount === 0, 'a first aim at the sky: no lens');
  s = focusStep(zero, five(15), 0.3, 2000, sky, focusBlend(dt, T.tauNearer, true), focusBlend(dt, T.tauFarther, true), true, { ...zero });
  ok(near(s.now, 1 / 15, 1e-12) && near(s.target, 1 / 15, 1e-12) && s.amount === 1 && s.samples === 5, 'a snap onto a surface: focused there, lens fully in');
  s = focusStep(zero, five(15), 0.3, 2000, sky, bn, bf, false, { ...zero });
  ok(near(s.now, 1 / 15, 1e-12) && near(s.amount, 1 - Math.exp(-dt / 0.08), 1e-12), 'the first surface this aim: focused there, the lens easing in');
  const held: FocusState = { now: 1 / 15, target: 1 / 15, samples: 5, amount: 1 };
  s = focusStep(held, five(9000), 0.3, 2000, sky, bn, bf, false, { ...zero });
  ok(s.now === held.now && s.target === held.target && s.samples === 0 && s.amount === 1, 'sky after a surface: the last surface is held');
  s = focusStep(held, five(5), 0.3, 2000, sky, bn, bf, false, { ...zero });
  ok(near(s.now - held.now, (1 / 5 - 1 / 15) * bn, 1e-12), 'a nearer target: the focus moves by the nearer blend of the gap');
  let st: FocusState = { ...held };
  let overshoot = false;
  for (let i = 0; i < 288; i++) {
    st = focusStep(st, five(5), 0.3, 2000, sky, bn, bf, false, { ...zero });
    if (st.now > 1 / 5 + 1e-15) overshoot = true;
  }
  ok(near(st.now, 1 / 5, 1e-3) && !overshoot, 'after 2 s it has arrived, never overshooting');
  st = { ...held };
  for (let i = 0; i < 288; i++) st = focusStep(st, five(200), 0.3, 2000, sky, bn, bf, false, { ...zero });
  ok(near(st.now, 1 / 200, 1e-3), 'a farther target is reached too, more slowly');
  const oneFrame = focusStep(held, five(200), 0.3, 2000, sky, bn, bf, false, { ...zero });
  ok(Math.abs(oneFrame.now - held.now) < Math.abs(focusStep(held, five(5), 0.3, 2000, sky, bn, bf, false, { ...zero }).now - held.now) * ((1 / 15 - 1 / 200) / (1 / 5 - 1 / 15)), 'letting go is slower than pulling in');
  st = { now: 1 / 15, target: 1 / 15, samples: 5, amount: 1 - Math.exp(-dt / 0.08) };
  for (let i = 0; i < 72; i++) st = focusStep(st, five(15), 0.3, 2000, sky, bn, bf, false, { ...zero });
  ok(st.amount >= 0.99, `the lens is in within half a second (${st.amount.toFixed(4)})`);
  ok(focusBlend(dt, 0.08, true) === 1 && near(focusBlend(dt, 0.08, false), 1 - Math.exp(-dt / 0.08), 1e-15), 'the blend is 1 on a snap, else 1 - exp(-dt/tau)');
}

// ---- 9. The frame ----
{
  const out = createDofFrame();
  const frame = (height: number, strength: number, extra: Partial<DofFrameInput> = {}) => ({ ...dofFrame({ height, strength, aimAmount: 1, firstPerson: false, orbitDistance: 3.85, tuning: T, ...extra }, out) });
  ok(dofEase(0.02) === 0 && dofEase(0.9) === 1, 'the lens eases in between an aim blend of 0.02 and 0.9');
  let f = frame(1440, 1);
  ok(f.stride === 1 && near(f.maxRadiusGrid, 4.32, 1e-9) && f.reach === 2 && f.fill && f.tapCount === 16 && near(f.tapScale, Math.sqrt(1.5), 1e-12), '1440p strength 1: stride 1, 4.32 grid px, reach 2, fill, 16 taps');
  f = frame(1440, 2);
  ok(near(f.maxRadiusGrid, 8.64, 1e-9) && f.reach === 3 && f.tapCount === 24 && f.tapScale === 1, '1440p strength 2: 8.64 grid px, reach 3, 24 taps');
  f = frame(1080, 1);
  ok(near(f.maxRadiusGrid, 3.24, 1e-9) && f.fill, '1080p strength 1: 3.24 grid px, fill');
  f = frame(2880, 2);
  ok(f.stride === 2 && near(f.maxRadiusGrid, 8.64, 1e-9) && f.reach === 3, 'a 2880 px buffer strength 2: stride 2, 8.64 grid px, reach 3');
  f = frame(2160, 1);
  ok(f.stride === 2 && near(f.maxRadiusGrid, 3.24, 1e-9), '4K strength 1: stride 2, 3.24 grid px');
  f = frame(4320, 2);
  ok(f.stride === 3 && near(f.maxRadiusGrid, 8.64, 1e-9), 'a 4320 px buffer strength 2: stride 3, 8.64 grid px');
  let capped = true;
  let covered = true;
  for (let h = 100; h <= 8640; h += 20) {
    for (let s = 0; s <= 2.0001; s += 0.05) {
      const g = dofFrame({ height: h, strength: s, aimAmount: 1, firstPerson: false, orbitDistance: 3.85, tuning: T }, out);
      if (g.maxRadiusGrid > DOF_MAX_GRID_RADIUS + 1e-9) capped = false;
      if (g.reach * 4 < g.maxRadiusGrid - 1e-9) covered = false;
    }
  }
  ok(capped, 'no height or strength asks for more than 12 grid px');
  ok(covered, 'the tile dilation always reaches as far as the largest radius');
  ok(dofStride(2000) === 1 && dofStride(2001) === 2 && dofStride(4000) === 2 && dofStride(4001) === 3, 'the stride steps every 2000 px of height');
  f = frame(1440, 1, { firstPerson: true, orbitDistance: 0 });
  ok(f.minFocus === 0.6 && f.selfDepth === 1.7 && f.fadeFrom === 1.7 && near(f.fadeTo, 3.2, 1e-12), 'first person: focus from 0.6 m, fade 1.7 m to 3.2 m (below the eyes)');
  const foot = 2 * dofRadius(dofRaw(1.6, 1 / 2000, T), 1 / 2000, 4.32, f.fadeFrom, f.fadeTo, T);
  const ground = 2 * dofRadius(dofRaw(2.5, 1 / 2000, T), 1 / 2000, 4.32, f.fadeFrom, f.fadeTo, T);
  ok(foot === 0, 'first person, looking down past a far focus: the feet at 1.6 m are sharp');
  ok(near(ground, -4.75, 0.05), `and the ground at 2.5 m is ${ground.toFixed(2)} px`);
  f = frame(1440, 1);
  ok(near(f.minFocus, 4.25, 1e-12) && near(f.fadeFrom, 4.35, 1e-12) && near(f.fadeTo, 6.85, 1e-12) && f.selfDepth === 3.85, 'third person with the shooter at 3.85 m: focus from 4.25 m, fade 4.35 m to 6.85 m');
  f = frame(1440, 1, { aimAmount: 0 });
  ok(f.maxRadiusGrid === 0 && f.reach === 0 && !f.fill, 'not aimed: no radius at all');
}

// ---- 10. The wardrobe doll ----
{
  const span: PreviewSpan = { focus: 0, nearest: 0, farthest: 0 };
  previewSpan(4.19, 4.185, 0.35, 0.05, span);
  const g2000 = previewGate(2000, 1, span);
  const g700 = previewGate(700, 1, span);
  ok(g2000 < PREVIEW_DOF.enterPx && near(g2000, 0.72, 0.01), `full body on a 2000 px canvas: ${g2000.toFixed(3)} px, under the 1 px entry`);
  ok(g700 < PREVIEW_DOF.exitPx, `full body on a 700 px canvas: ${g700.toFixed(3)} px, under the 0.7 px exit`);
  ok(near(previewGate(700, 1, { focus: 0.4, nearest: 0.4, farthest: 0.8 }), 4.2, 1e-9), 'a close-up on the face is capped at 0.006 x 700 = 4.2 px');
  ok(previewGate(700, 0, { focus: 0.4, nearest: 0.4, farthest: 0.8 }) === 0, 'strength 0: no blur');
  ok(!previewLensOn(false, 0.9) && previewLensOn(false, 1.1) && previewLensOn(true, 0.8) && !previewLensOn(true, 0.6), 'the lens path comes on past 1 px and goes off under 0.7 px');
  let floor = true;
  for (const d of [0, 0.01, 0.1, 0.3, 1, 4]) {
    for (const a of [0, 0.01, 0.2, 1, 4]) {
      previewSpan(d, a, 0.3, 0.05, span);
      if (span.focus < 0.05 || span.nearest < 0.05 || span.farthest < span.nearest) floor = false;
    }
  }
  ok(floor, 'the span never puts the focus or the nearest point inside the near plane');
  previewSpan(4, 4, 5, 0.05, span);
  ok(near(span.farthest - span.nearest, 2 * PREVIEW_DOF.halfDepthMax, 1e-12), 'half the depth is clamped to 0.35 m');
  previewSpan(4, 4, 0, 0.05, span);
  ok(near(span.farthest - span.nearest, 2 * PREVIEW_DOF.halfDepthMin, 1e-12), 'and to at least 0.15 m');
}

// ---- 11. The shaders take their numbers from here, and the registry has the lens ----
{
  const dof = readFileSync(new URL('../../../src/core/fx/dof.ts', import.meta.url), 'utf8');
  ok(dof.includes("glslVec2Array('DOF_TAPS', vogelTaps(DOF_TAP_MAX))") && !/vec2\[24\]\(vec2\(/.test(dof), 'the gather\'s taps are generated from vogelTaps, not written out');
  ok(dof.includes('inversesqrt(max(fd, 1.0 / uApertureStop))'), 'the shader\'s aperture stops where dofKs does');
  ok(dof.includes('(abs(c) - uDeadZone) / (1.0 - uDeadZone)'), 'the shader\'s dead zone is dofRadius\'s');
  const preview = readFileSync(new URL('../../../src/ui/previewDof.ts', import.meta.url), 'utf8');
  ok(preview.includes("glslVec2Array('PREVIEW_TAPS', vogelTaps(16))"), 'the doll\'s taps are generated from vogelTaps');
  ok(preview.includes('glslVersion: THREE.GLSL3'), 'the doll\'s raw material asks for GLSL 3.00');
  const def = fxPassDef('depthOfField');
  ok(def.stage === 'lens' && def.budgetMs === 0.35 && !def.typical && !def.canBeLast, 'the depthOfField row: a lens pass, 0.35 ms, not typical, never last');
  ok(def.needs.includes('linearDepthHalf'), 'the row names the half-resolution depth');
  ok(FX_DEFAULTS.depthOfField === true && FX_DEFAULTS.depthOfFieldStrength === 1, 'on at strength 1 by default');
  const k = FX_KNOBS.find((x) => x.key === 'depthOfFieldStrength');
  ok(!!k && k.min === 0 && k.max === 2, 'the strength knob runs 0 to 2');
  ok(def.live && def.needs.length === 2 && def.needs.includes('dofGlow'), 'the row is live and names the glow depth');
  const glow = fxProductDef('dofGlow');
  ok(glow.kind === 'geometry' && glow.scale === 1 && glow.format === 'R16F' && glow.needs.length === 0, 'the glow depth is a full-size R16F geometry product built from nothing');
  ok(glow.owner === 'depthOfField' && glow.budgetMs === 0.05 && !glow.typical && glow.live, 'it belongs to the lens, 0.05 ms at most, not in the typical frame');
}

// ---- 12. Console tuning cannot make the shaders divide by zero ----
{
  const kept = clampTuning({ ...DOF_DEFAULTS });
  ok((Object.keys(DOF_DEFAULTS) as (keyof DofTuning)[]).every((key) => kept[key] === DOF_DEFAULTS[key]), 'the defaults pass through untouched');
  const bad = clampTuning({ ...DOF_DEFAULTS, aperture: -1, apertureStop: 0, deadZone: 1, maxCoc: -0.01, selfNear: 2, selfFar: 2, fpRamp: 0, fpMinFocus: 0, focusMin: 0, focusMax: 0, skyFraction: 0, bokehGain: -3, bokehLo: 4, bokehHi: 4, firefly: -1 });
  ok(bad.deadZone <= 0.9 && bad.selfFar > bad.selfNear && bad.fpRamp > 0 && bad.bokehHi > bad.bokehLo, 'the dead zone stays under 1 and the fade and bokeh edges apart');
  ok(bad.aperture >= 0 && bad.apertureStop >= 0.1 && bad.focusMin > 0 && bad.fpMinFocus > 0 && bad.focusMax > bad.focusMin && bad.skyFraction > 0, 'the aperture, its stop and the focus range stay positive');
  ok(bad.bokehGain >= 0 && bad.firefly >= 0 && bad.maxCoc >= 0, 'no weight goes negative (the gather and the prefilter divide by their sums)');
  // The same edges with a working aperture, so the dead zone and the near fade are exercised.
  const edge: DofTuning = { ...bad, aperture: 2.8 };
  let finite = true;
  let blurs = false;
  for (const firstPerson of [false, true]) {
    const f = dofFrame({ height: 1440, strength: 1, aimAmount: 1, firstPerson, orbitDistance: firstPerson ? 0 : 3.85, tuning: edge }, createDofFrame());
    for (const s of [edge.focusMin, 15, 2000]) {
      for (let z = 0.05; z <= 9000; z *= 1.05) {
        const r = dofRadius(dofRaw(z, 1 / s, edge), 1 / s, 4.32, f.fadeFrom, f.fadeTo, edge);
        if (!Number.isFinite(r)) finite = false;
        if (r !== 0) blurs = true;
      }
      // Exactly on the fade's edges, where equal edges divided 0 by 0.
      for (const z of [f.fadeFrom, f.fadeTo]) if (!Number.isFinite(dofRadius(dofRaw(z, 1 / s, edge), 1 / s, 4.32, f.fadeFrom, f.fadeTo, edge))) finite = false;
    }
  }
  ok(blurs, 'the clamped lens still blurs');
  ok(finite, 'with the worst console values clamped, every radius is finite in both views');
  const glow = readFileSync(new URL('../../../src/core/fx/dofGlow.ts', import.meta.url), 'utf8');
  ok(glow.includes('vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);') && glow.includes('* (1.0 - vFog) * c.a < uLevel'), 'the particle glow mask dims with the fog as the batch does');
}

console.log(`\n${passed} checks passed`);
