// The drifting specks under water, checked without a browser: the rules the vertex program does
// (where a speck's nearest copy is drawn, how it fades at the eye, at the edge of the tile and
// under the ceiling, how much light reaches it, the size it is drawn at and the energy that keeps),
// the three settings keys against the effects registry's own, the shader source against those same
// constants, the pass's row in the chain, and then `UnderwaterSpecksPass` itself driven frame by
// frame against a stub frame context: off while the camera is dry, on under water, its own
// attenuation and its ceiling written into the uniforms, and no `#define` moved by any of it.
//
// There was no under water in the game this recreates, so nothing here is checked against the
// archives: every number is ours and this test pins the shapes, not any authority.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MOTE_KERNEL, MOTE_MIN_PX } from '../../../src/world/roomAirMath.ts';
import { FX_DEFAULTS, FX_PASSES, fxPassDef, fxPassIndex } from '../../../src/core/fxRegistry.ts';
import { UNDERWATER_TUNE, deriveUnderwater, createUnderwaterLook } from '../../../src/core/fx/underwaterMath.ts';
import {
  MAX_SPECKS,
  SPECK_MAX_PX,
  SPECK_RULE,
  SPECK_SETTING_KEYS,
  SPECKS_FRAG,
  SPECKS_VERT,
  UNDERWATER_SPECK_TUNE,
  UnderwaterSpecksPass,
  speckAlpha,
  speckCeiling,
  speckDrawCount,
  speckFade,
  speckLightAtDepth,
  speckNearFade,
  speckSeeds,
  speckSprite,
  speckSurfaceFade,
  speckTileFade,
  speckWrap,
  tuneSpecks,
  wantSpecks,
  type SpeckSettings,
} from '../../../src/world/underwaterSpecks.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
/** A small deterministic generator, so a failure is the same failure twice. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

// ---- 1. How many are drawn ----
{
  const T = UNDERWATER_SPECK_TUNE;
  ok(speckDrawCount(T.count, 0) === 0, 'amount 0 draws no specks at all');
  ok(speckDrawCount(0, 1) === 0, 'count 0 draws none');
  ok(speckDrawCount(T.count, -1) === 0, 'a negative amount draws none rather than throwing');
  ok(speckDrawCount(T.count, 1) === T.count, `amount 1 draws the tune's own count (${T.count})`);
  ok(speckDrawCount(T.count, 0.5) === Math.round(T.count / 2), 'half the amount is half the specks');
  ok(speckDrawCount(T.count, 100) === MAX_SPECKS, `the pool is the ceiling (${MAX_SPECKS})`);
  ok(T.count <= MAX_SPECKS, 'the default count fits in the pool');
}

// ---- 2. Coming and going ----
{
  const secs = UNDERWATER_SPECK_TUNE.fadeSeconds;
  let f = 0;
  let frames = 0;
  while (f < 1 && frames < 1000) {
    f = speckFade(f, true, 1 / 60, secs);
    frames++;
  }
  ok(f === 1, 'the fade reaches exactly 1 and stops there');
  ok(near(frames / 60, secs, 1 / 60 + 1e-9), `it takes the tune's own ${secs} s to come in (${(frames / 60).toFixed(3)} s)`);
  ok(speckFade(1, true, 1 / 60, secs) === 1, 'once in, it stays in');
  ok(speckFade(1, false, 1 / 60, secs) === 0, 'coming up it is gone on that very frame, never eased');
  ok(speckFade(0.4, false, 0, secs) === 0, 'and gone even on a frame with no time in it');
  ok(speckFade(0, true, 1 / 60, 0) === 1, 'a fade time of 0 is simply on');
  ok(speckFade(0, true, -5, secs) === 0, 'a negative step moves nothing');
}

// ---- 3. The wrap: the copy nearest the camera ----
{
  const span = UNDERWATER_SPECK_TUNE.span;
  const rnd = rng(0x51ec);
  let worst = 0;
  let worstRemainder = 0;
  for (let i = 0; i < 20000; i++) {
    const p = (rnd() * 2 - 1) * 5000;
    const cam = (rnd() * 2 - 1) * 5000;
    const w = speckWrap(p, cam, span);
    worst = Math.max(worst, Math.abs(w - cam));
    // The drawn copy differs from the true place by a whole number of spans.
    const k = (w - p) / span;
    worstRemainder = Math.max(worstRemainder, Math.abs(k - Math.round(k)));
  }
  ok(worst <= span * 0.5 + 1e-6, `every speck is drawn within half a span of the camera (worst ${worst.toFixed(4)} m of ${(span / 2).toFixed(2)})`);
  ok(worstRemainder < 1e-6, 'and always a whole number of spans from where it really is');
  ok(near(speckWrap(3, 0, 10), 3, 1e-9) && near(speckWrap(7, 0, 10), -3, 1e-9), 'a speck past half a span is drawn on the near side instead');
}

// ---- 4. The three fades, and the alpha that is their product ----
{
  const T = UNDERWATER_SPECK_TUNE;
  const R = SPECK_RULE;
  ok(speckNearFade(0, T.near) === 0 && speckNearFade(T.near, T.near) === 0, 'nothing is drawn on the lens');
  ok(speckNearFade(T.near * R.nearSpan, T.near) === 1, `and a speck is whole by ${R.nearSpan} times that`);
  let up = true;
  let prev = -1;
  for (let d = 0; d <= 4; d += 0.01) {
    const v = speckNearFade(d, T.near);
    if (v < prev - 1e-9) up = false;
    prev = v;
  }
  ok(up, 'the near fade never goes backwards');

  // The tile's own edge: this is what keeps the wrap from popping, and it had no rule of its own
  // and no check at all until now.
  ok(speckTileFade(0, T.span) === 1 && speckTileFade(R.tileIn * T.span, T.span) === 1, 'a speck is whole in to the tile fade');
  ok(speckTileFade(R.tileOut * T.span, T.span) === 0, 'and gone by half the span, which is exactly where the wrap moves it');
  ok(speckTileFade(T.span, T.span) === 0, 'and stays gone past it');
  const mid = speckTileFade(0.5 * (R.tileIn + R.tileOut) * T.span, T.span);
  ok(near(mid, 0.5, 1e-9), 'with half of it half way across the band, so nothing steps');

  const ceiling = 10;
  ok(speckSurfaceFade(ceiling, ceiling, T.surfaceFade) === 0, 'a speck exactly at the ceiling is gone');
  ok(speckSurfaceFade(ceiling + 1, ceiling, T.surfaceFade) === 0, 'and one above it is gone');
  ok(speckSurfaceFade(ceiling - T.surfaceFade, ceiling, T.surfaceFade) === 1, `and is whole ${T.surfaceFade} m under it`);
  ok(speckSurfaceFade(-5, 0, T.surfaceFade) === 1, 'deep under, the ceiling takes nothing off it');
  ok(speckSurfaceFade(ceiling, ceiling, 0) === 0, 'a fade distance of 0 still never draws one above it');

  // The whole alpha is exactly those three times the cloud's fade, which is what the vertex
  // program's speckAlpha() computes from the same constants.
  const d = 2.1;
  const y = 9.5;
  const expect = speckNearFade(d, T.near) * speckTileFade(d, T.span) * speckSurfaceFade(y, ceiling, T.surfaceFade) * 0.5;
  ok(near(speckAlpha(d, y, T.span, T.near, ceiling, T.surfaceFade, 0.5), expect, 1e-12), 'the alpha is the three fades times the cloud fade, and nothing else');
  ok(speckAlpha(d, y, T.span, T.near, ceiling, T.surfaceFade, 0) === 0, 'and a cloud fade of 0 is no speck at all');
}

// ---- 5. The ceiling under a swell ----
{
  ok(speckCeiling(12, 0) === 12, 'with no reach the ceiling is the surface itself');
  ok(speckCeiling(12, 1.19) === 12 - 1.19, "and under a sea it is the lowest the drawn surface can be, not the table's flat height");
  ok(speckCeiling(12, -3) === 12 && speckCeiling(12, Number.NaN) === 12, 'a reach that is not a positive number is no reach');
  // The band that made this necessary: a swell of 1.19 m over a flat surface at 12 m means the real
  // surface is anywhere from 10.81 to 13.19, and the old ceiling (12) drew specks in the air over
  // every trough.
  const reach = 1.19;
  const c = speckCeiling(12, reach);
  ok(c <= 12 - reach + 1e-9, 'so no speck is ever drawn above the lowest the surface can stand');
  ok(speckSurfaceFade(12 - 0.5 * reach, c, UNDERWATER_SPECK_TUNE.surfaceFade) === 0, 'and one in the band a trough could leave as air is not drawn at all');
}

// ---- 6. Light at depth and at the hour ----
{
  const T = UNDERWATER_SPECK_TUNE;
  ok(speckLightAtDepth(0, T.lightDepth) === 1, 'at the surface in full day the specks take the whole of their brightness');
  ok(speckLightAtDepth(-3, T.lightDepth) === 1, 'a depth above the surface is read as none');
  const a = speckLightAtDepth(T.lightDepth, T.lightDepth);
  ok(near(a, Math.exp(-1), 1e-12), `at ${T.lightDepth} m they are down to 1/e (${a.toFixed(3)})`);
  ok(speckLightAtDepth(100, T.lightDepth) > 0, 'and never quite to nothing, so deep water is dark and not black');
  ok(speckLightAtDepth(50, 0) === 1, 'a light depth of 0 is taken as no falloff rather than a divide by nothing');
  ok(near(speckLightAtDepth(0, T.lightDepth, 0, T.nightFloor), T.nightFloor, 1e-12), `at midnight they keep the floor's ${T.nightFloor} of themselves`);
  ok(speckLightAtDepth(0, T.lightDepth, 0.5, T.nightFloor) > T.nightFloor, 'and more of it as the day comes up');
  ok(speckLightAtDepth(0, T.lightDepth, Number.NaN, T.nightFloor) === 1, 'a daylight that is not a number is taken as day');
}

// ---- 7. The sprite: never small enough to twinkle, never brighter for being spread ----
{
  // Each answer is checked against an expectation written out here, not against the function's own
  // algebra: the old check compared the function with itself and could not fail.
  const samples = [0.05, 1, 2, MOTE_MIN_PX - 1e-6, MOTE_MIN_PX, 4, 6, SPECK_MAX_PX, 12, 500];
  let worstDrawn = 0;
  let worstScale = 0;
  for (const px of samples) {
    const { drawn, scale } = speckSprite(px);
    const wantDrawn = px < MOTE_MIN_PX ? MOTE_MIN_PX : px > SPECK_MAX_PX ? SPECK_MAX_PX : px;
    const wantScale = px < MOTE_MIN_PX ? (px / MOTE_MIN_PX) ** 2 : 1;
    worstDrawn = Math.max(worstDrawn, Math.abs(drawn - wantDrawn));
    worstScale = Math.max(worstScale, Math.abs(scale - wantScale));
  }
  ok(worstDrawn < 1e-12, `the drawn size is the true one held between ${MOTE_MIN_PX} and ${SPECK_MAX_PX} px`);
  ok(worstScale < 1e-12, 'and the colour is dimmed by the square of how much it was spread, and by nothing else');
  // And the point of that square, as arithmetic on the rule rather than on the answer: a speck of
  // px true, drawn at the floor, covers (floor/px)^2 times the pixels, so the light it puts on the
  // screen is the light it had.
  const px = 1.2;
  ok(near(MOTE_MIN_PX * MOTE_MIN_PX * (px / MOTE_MIN_PX) ** 2, px * px, 1e-12), 'which is exactly the energy the real speck had');
  let everSmall = false;
  let everBrightened = false;
  for (let p = 0.05; p < 40; p += 0.01) {
    const { drawn, scale } = speckSprite(p);
    if (drawn < MOTE_MIN_PX - 1e-9) everSmall = true;
    if (scale > 1 + 1e-9) everBrightened = true;
  }
  ok(!everSmall, `no speck is ever drawn under ${MOTE_MIN_PX} px, which is where a point sprite starts to twinkle`);
  ok(!everBrightened, 'and the clamp only ever spreads a speck, never brightens one');
}

// ---- 8. The seeds ----
{
  const a = speckSeeds(16);
  const b = speckSeeds(16);
  ok(a.length === 64, 'four seeds a speck');
  ok(a.every((v, i) => v === b[i]), 'the same specks every session');
  ok(a.every((v) => v >= 0 && v < 1), 'every seed is in 0..1, which is what the tile expects');
  ok(speckSeeds(16, 1).some((v, i) => v !== a[i]), 'a different seed is a different cloud');
}

// ---- 9. The settings are the registry's own keys ----
{
  // The defect this replaces: the module read a key of its own spelling out of a settings object by
  // name, the registry's was called something else, and the switch silently never turned anything
  // off. Now the names are checked against the registry itself, and the pass reads them as typed
  // fields of the frame context rather than by name at all.
  ok(SPECK_SETTING_KEYS.length === 3, 'the specks read three settings');
  for (const key of SPECK_SETTING_KEYS) ok(key in FX_DEFAULTS, `"${key}" is a setting the game really has`);
  ok(SPECK_SETTING_KEYS.includes('underwaterShimmerStrength'), "and one of them is the shimmer's own strength, which is what ties the two together");
  const s: SpeckSettings = { effects: true, underwater: true, underwaterShimmerStrength: 1 };
  ok(wantSpecks(s), 'with the look on and the shimmer above 0 the specks are wanted');
  ok(!wantSpecks({ ...s, effects: false }), 'Effects off takes them with it');
  ok(!wantSpecks({ ...s, underwater: false }), 'the underwater look off takes them with it');
  ok(!wantSpecks({ ...s, underwaterShimmerStrength: 0 }), 'and the shimmer at 0 takes them with it, which is the tie the owner asked for');
  ok(wantSpecks({ ...s, underwaterShimmerStrength: 0.05 }), 'any strength above 0 keeps them');
  // The Graphics page's own words for that row promise exactly this.
  const hint = readFileSync(new URL('../../../src/core/fxRegistry.ts', import.meta.url), 'utf8');
  const row = hint.split('\n').find((l) => l.includes("key: 'underwaterShimmerStrength'")) ?? '';
  ok(/specks/i.test(row) && /0 turns both off/.test(row), "and the row's hint tells the player that 0 turns both off, which is now true");
}

// ---- 10. The shaders say what this file says ----
{
  const strip = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const v = strip(SPECKS_VERT);
  const f = strip(SPECKS_FRAG);
  const R = SPECK_RULE;
  ok(/clamp\(pxTrue,\s*MOTE_MIN_PX,\s*SPECK_MAX_PX\)/.test(v), 'the vertex program clamps the drawn size between the two defines');
  ok(!/[^\w.]3\.5[^\d]/.test(v) && !/[^\w.]8\.0[^\d]/.test(v), 'with no literal copy of either number in it');
  ok(/c \*= k \* k;/.test(v), 'and dims a spread sprite by the square of the spread, which is speckSprite()’s own law');
  ok(/exp\(-MOTE_KERNEL/.test(f) && !/[^\w.]16\.0[^\d]/.test(f), 'the fragment takes the sprite kernel from the define as well');
  ok(/mod\(p - uCam \+ 0\.5 \* uSpan, uSpan\) - 0\.5 \* uSpan/.test(v), 'the wrap in the shader is the wrap this test swept');
  // The alpha is one named function, built from SPECK_RULE's own numbers rather than typed twice.
  ok(/float speckAlpha\(/.test(v) && /float a = speckAlpha\(dist, pos\.y, uSpan, uNear, uCeiling, uSurfaceFade, uFade\);/.test(v), 'the alpha is one call to speckAlpha, as the rule here is one function');
  ok(v.includes(`smoothstep(near, near * ${R.nearSpan.toFixed(2)}, dist)`), `and its near fade carries SPECK_RULE's ${R.nearSpan}`);
  ok(v.includes(`smoothstep(${R.tileIn.toFixed(2)} * span, ${R.tileOut.toFixed(2)} * span, dist)`), `its tile fade carries ${R.tileIn} and ${R.tileOut}`);
  ok(/1\.0 - smoothstep\(ceiling - fade, ceiling, y\)/.test(v), 'and its ceiling is a ceiling, not a surface height');
  ok(v.includes(`a < ${R.cull.toFixed(3)}`), `and the cull threshold is SPECK_RULE's ${R.cull}`);
  ok(/a \*= uFade|, uFade\)/.test(v), 'the whole cloud is multiplied by the fade, so coming up takes every speck at once');
  ok(/isnan/.test(v) && /isinf/.test(v), 'a NaN never leaves the vertex program: one pixel of it becomes a screen-sized black box through the bloom');
  // The whole reason this is a pass: each speck carries its own attenuation, over its own distance.
  ok(/exp\(-uExtinction \* dist\)/.test(v), "each speck is eaten by the water over its own distance, not by the background's");
  ok(/uSurvive/.test(v), 'and the depth veil takes its share of what is left');
  // And the depth test that a chain buffer cannot do in hardware.
  ok(/texture2D\(tDepth, gl_FragCoord\.xy \* uTexel\)/.test(f), 'the fragment program tests the scene depth itself, since the chain buffers carry none');
  ok(/if \(vViewZ > sceneZ\) discard;/.test(f), 'and a speck behind what the scene drew is thrown away');
  ok((f.match(/discard/g) ?? []).length === 1, 'which is the only discard there is: the sprite itself has no hard edge to flicker on');
  // The module's own source: no light is added, and the tune reaches the shader as uniforms only.
  const src = readFileSync(new URL('../../../src/world/underwaterSpecks.ts', import.meta.url), 'utf8');
  ok(!/new THREE\.(Point|Directional|Spot|Hemisphere|Ambient)Light/.test(src), 'the specks add no light to the scene, so nothing recompiles when they come on');
  ok(/lights: false/.test(src) && /fog: false/.test(src), 'and their material asks for neither lights nor fog');
}

// ---- 11. The row in the chain ----
{
  const def = fxPassDef('underwaterSpecks');
  ok(def.stage === 'lens' && !def.required && !def.canBeLast && def.live, 'the specks are a live lens pass, never required and never last');
  ok(def.needs.length === 0, 'and ask for no product at all');
  ok(def.toggles.length === 1 && def.toggles[0] === 'underwater', "they are on the underwater look's own switch");
  ok(typeof FX_DEFAULTS[def.toggles[0]] === 'boolean', 'which is a switch and not a number');
  ok(!def.typical, 'and are not counted in a typical outdoor frame, where there is no water over the camera');
  ok(fxPassIndex('underwaterSpecks') > fxPassIndex('underwater'), "they are drawn after the water's own grading, which is the whole point of the pass");
  ok(fxPassIndex('underwaterSpecks') > fxPassIndex('motionBlur') && fxPassIndex('underwaterSpecks') > fxPassIndex('depthOfField'), 'and after the aperture and the shutter, so neither blurs them by the depth of what is behind them');
  ok(fxPassIndex('underwaterSpecks') < fxPassIndex('bloom') && fxPassIndex('underwaterSpecks') < fxPassIndex('colorGrade'), 'and before the bloom and the grade, so they spill and are graded with the picture');
  ok(FX_PASSES.filter((p) => p.id === 'underwaterSpecks').length === 1, 'and the pass is in the chain exactly once');
  // Why it may sample the scene's depth texture at all: the picture it draws into is never the
  // scene target, because the sanitize pass is required, runs first and swaps.
  const first = fxPassDef('sanitize');
  ok(first.required && fxPassIndex('sanitize') < fxPassIndex('underwaterSpecks'), 'the sanitize pass is required and comes first, so what the specks draw into is a chain buffer and never the scene target');
  ok(fxPassDef('output').required && fxPassIndex('output') > fxPassIndex('underwaterSpecks'), 'and the output pass is required and comes after, so the specks can never be handed the canvas');
}

// ---- 12. The pass, driven frame by frame ----
{
  const pass = new UnderwaterSpecksPass();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 9000);
  camera.position.set(12, 1.2, -30);
  camera.updateMatrixWorld(true);

  const settings = { ...FX_DEFAULTS };
  const depthTexture = new THREE.DepthTexture(4, 4);
  const drawnInto: (THREE.WebGLRenderTarget | null)[] = [];
  let clearedWhileDrawing = true;
  let renders = 0;
  const renderer = {
    autoClear: true,
    setRenderTarget(t: THREE.WebGLRenderTarget | null) {
      drawnInto.push(t);
    },
    render() {
      renders++;
      clearedWhileDrawing = this.autoClear;
    },
  };
  const ctx = {
    renderer: renderer as unknown as THREE.WebGLRenderer,
    settings,
    camera,
    dt: 1 / 60,
    time: 0,
    frame: 0,
    width: 2560,
    height: 1440,
    near: 0.05,
    far: 9000,
    cameraPos: new THREE.Vector3().copy(camera.position),
    tanHalfFov: new THREE.Vector2(Math.tan(Math.PI / 6) * (16 / 9), Math.tan(Math.PI / 6)),
    depth: depthTexture,
    daylight: 1,
    cameraUnderwater: false,
    cameraSubmerged: false,
    underwaterDepth: 0,
    underwaterColor: new THREE.Color(0.1, 0.35, 0.55),
    underwaterOpacity: 0.75,
    underwaterReach: 0,
  } as unknown as Parameters<UnderwaterSpecksPass['prepare']>[0];
  const c = ctx as unknown as Record<string, unknown>;
  /** One frame of the chain: decide, then prepare and draw if it said yes. */
  const frame = (input: THREE.WebGLRenderTarget) => {
    const on = pass.enabled(ctx);
    if (on) {
      pass.prepare(ctx);
      pass.render(ctx, input, null);
    }
    c.frame = (c.frame as number) + 1;
    return on;
  };
  const buffer = { isWebGLRenderTarget: true } as unknown as THREE.WebGLRenderTarget;

  ok(pass.id === 'underwaterSpecks' && pass.timerLabel === 'pass:underwaterSpecks', 'the pass knows its own name');
  ok(pass.points.parent !== null && pass.points.parent!.type === 'Scene', 'its points live in a scene of its own, not the world');
  ok(pass.points.frustumCulled === false && pass.points.castShadow === false, 'never culled and never a shadow: the cloud is always around the camera and nothing else ever walks it');
  ok(pass.materials().length === 1 && pass.materials()[0].where === 'target', 'one material, warmed for a target, which is the only place it ever draws');
  ok(pass.materials()[0].object === pass.points, 'and warmed with the points themselves, so the program is the one the draw uses');
  ok(pass.needs(ctx).length === 0, 'it asks for no product');

  ok(!frame(buffer), 'dry, the pass does not draw at all');
  ok(pass.reason(ctx) === 'the camera is not under water', 'and says exactly why');
  ok(renders === 0 && drawnInto.length === 0, 'and nothing was drawn or even bound');

  // The margin band: `cameraUnderwater` is true while the eye is plainly in the air.
  c.cameraUnderwater = true;
  ok(!frame(buffer), 'at the surface line, with water only maybe over the eye, it still does not draw');
  ok(pass.reason(ctx) === 'the camera is at the surface line rather than under it', 'and names that band rather than blaming a setting');

  c.cameraSubmerged = true;
  c.underwaterDepth = 1.8;
  c.underwaterReach = 1.19;
  ok(frame(buffer), 'really under, it draws');
  const first = pass.describe();
  ok(first.fade > 0 && first.fade < 1, `faded part of the way in on that first frame (${first.fade})`);
  ok(drawnInto.length === 1 && drawnInto[0] === buffer, 'into the picture where it stands, never into the write buffer');
  ok(renders === 1 && clearedWhileDrawing === false, 'with autoClear off, or the draw would have wiped the picture it is adding to');
  ok(renderer.autoClear === true, 'and autoClear put back afterwards');
  ok(pass.render(ctx, buffer, null) === false, 'and it answers false, so the runner keeps its buffers as they are');

  for (let i = 0; i < 120; i++) frame(buffer);
  const d = pass.describe();
  ok(d.fade === 1, 'wholly in after the fade');
  ok(d.drawn === UNDERWATER_SPECK_TUNE.count, `drawing the tune's own count (${d.drawn})`);
  ok(d.reason === null, 'with no reason not to');
  ok(d.color === new THREE.Color(0.1, 0.35, 0.55).getHexString(), "the specks take the water body's own colour");
  ok(near(d.surfaceY, camera.position.y + 1.8, 1e-6), 'the surface stands the depth above the eye');
  ok(near(d.ceiling, d.surfaceY - 1.19, 1e-6), 'and the ceiling a whole swell below that, so none is ever in the air over a trough');

  const u = (pass.points.material as THREE.ShaderMaterial).uniforms;
  ok(near(u.uCeiling.value as number, d.ceiling, 1e-6), 'which is the number the shader is given');
  ok(u.tDepth.value === depthTexture, "and the scene's own depth texture, for the test the chain buffers cannot make");
  ok(near((u.uTexel.value as THREE.Vector2).x, 1 / 2560, 1e-12), 'with the texel size of this frame');
  // A metre at a metre, in pixels: the drawing buffer's height over twice tan(fov/2).
  ok(near(u.uProjScale.value as number, 1440 / (2 * Math.tan(Math.PI / 6)), 1e-6), 'the projection scale is the buffer height over twice the tangent of half the field of view');
  ok(near(u.uBright.value as number, UNDERWATER_SPECK_TUNE.brightness * speckLightAtDepth(1.8, UNDERWATER_SPECK_TUNE.lightDepth, 1, UNDERWATER_SPECK_TUNE.nightFloor), 1e-9), 'and the brightness carries the light that reaches that depth at this hour');

  // The specks are eaten by the very water the look pass grades the picture with.
  const look = deriveUnderwater([0.1, 0.35, 0.55], 0.75, 1.8, 1, settings.underwaterStrength, settings.underwaterShimmerStrength, UNDERWATER_TUNE, createUnderwaterLook());
  const e = u.uExtinction.value as THREE.Vector3;
  ok(near(e.x, look.extinction[0], 1e-9) && near(e.y, look.extinction[1], 1e-9) && near(e.z, look.extinction[2], 1e-9), "the extinction is the look pass's own, channel for channel");
  ok(near(u.uSurvive.value as number, 1 - look.veil, 1e-9), 'and what the depth veil leaves of a speck is what it leaves of the picture');
  ok(d.channelMetres[2] > d.channelMetres[0], 'so red dies first in blue water, as it does for everything else');

  // Night.
  c.daylight = 0;
  frame(buffer);
  ok(near(u.uBright.value as number, UNDERWATER_SPECK_TUNE.brightness * speckLightAtDepth(1.8, UNDERWATER_SPECK_TUNE.lightDepth, 0, UNDERWATER_SPECK_TUNE.nightFloor), 1e-9), 'at midnight they are down to the floor, not glowing in the dark');
  c.daylight = 1;

  // Up again, and down again: the clock and the fade start afresh rather than popping in whole.
  const before = pass.describe().seconds;
  ok(before > 0, 'the clock runs while the camera is under');
  c.cameraSubmerged = false;
  c.cameraUnderwater = false;
  let drewWhileDry = false;
  for (let i = 0; i < 10; i++) if (frame(buffer)) drewWhileDry = true;
  ok(!drewWhileDry, 'the moment the camera comes up it stops, on that very frame, and stays stopped');
  const dry = pass.describe();
  ok(dry.drawn === 0 && dry.reason === 'the camera is not under water', 'and the listing says nothing is being drawn and why, rather than reporting the last frame that did');
  c.cameraSubmerged = true;
  c.cameraUnderwater = true;
  frame(buffer);
  const again = pass.describe();
  // One frame's worth of clock, rounded to the hundredth the listing prints, and not the two
  // seconds the last dive had reached.
  ok(again.seconds < before && again.seconds <= 0.02 + 1e-9, `a fresh dive starts the clock again (${again.seconds} s, after ${before} s), so nothing in the shader grows all session`);
  ok(again.fade > 0 && again.fade < 1, 'and eases in again rather than appearing whole');

  // The switches, each on its own, named in the order that says what is really the matter.
  settings.underwaterShimmerStrength = 0;
  ok(!pass.enabled(ctx) && pass.reason(ctx) === 'the shimmer strength is 0, which the specks share', 'the shimmer at 0 takes the specks, and says so');
  settings.underwaterShimmerStrength = 1;
  settings.underwater = false;
  ok(pass.reason(ctx) === 'the underwater look is switched off', 'the look switched off says so');
  settings.underwater = true;
  settings.effects = false;
  ok(!pass.enabled(ctx) && pass.reason(ctx) === 'the Effects setting is off', 'Effects off takes them, and says so');
  settings.effects = true;

  // Nothing is rebuilt by any of it.
  const mat = pass.points.material as THREE.ShaderMaterial;
  const defines = JSON.stringify(mat.defines);
  const uniformsObject = mat.uniforms;
  const camUniform = mat.uniforms.uCam.value;
  for (let i = 0; i < 30; i++) frame(buffer);
  pass.debug({ count: 250, size: 0.02, swirl: 0.2, span: 11 });
  for (let i = 0; i < 30; i++) frame(buffer);
  ok(JSON.stringify(mat.defines) === defines, 'no knob moves a #define, so nothing the console does can compile a program mid-play');
  ok(mat.uniforms === uniformsObject && mat.uniforms.uCam.value === camUniform, 'and the uniform objects are the ones made in the constructor, written to rather than replaced');
  ok(pass.points.geometry.drawRange.count === 250, 'the count knob is the draw range and nothing else');
  ok(pass.describe().tuning.span === 11, 'and the tune is the module-level one, so a chain rebuilt for an Effects switch keeps it');

  tuneSpecks({ amount: 0 });
  ok(!pass.enabled(ctx) && pass.reason(ctx) === 'the amount is 0', 'the amount at 0 costs not even a draw call');
  tuneSpecks({ amount: 1, count: 700, size: 0.007, swirl: 0.05, span: 7 });
  ok(pass.enabled(ctx), 'and putting it back brings them straight back');

  pass.dispose();
  ok(pass.points.parent === null, 'dispose takes the points out of its scene');
}

console.log(`\n${passed} checks passed`);
