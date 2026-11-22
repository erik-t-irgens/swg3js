// A space zone's nebulae on WebGPU (the GPU port's pass 2, wave 3; the design's 2.9): the sheets, the haze inside one and the
// lightning bolts of `src/space/nebulae.ts`, each a `ShaderMaterial` of ours that three's WebGPU renderer cannot copy, drawn
// here by a node graph registered as its stand-in (`userData.gpuStandIn`, `fallback.ts`), in the step's way
// (`gpuPrograms.ts`): one graph a kind, every uniform read at every draw off the material three is drawing, so the glow set,
// the mist set and every bolt each draw their own numbers through one build, and the pipeline's state (the glow's add, the
// mist's blend, the haze's depth test, no depth write) is the original's.
//
// **Read through the eye.** Each is unlit and painted for an exposure of 1, so its light is times the eye's glow factor
// (`withGlow`, `src/sky/exposure/eyeBuffer.ts`), as every particle's is; three's output then takes the eye's exposure and the
// scene is stored pre-exposed (`preExpose.ts`), as for every node material. In space the eye does not adapt (an exposure of
// 1, no compensation), so there the sheets are WebGL's numbers.
//
// **Placed from an anchor, never from the world's middle** (pass 1's design, section 11). WebGL's sheets read world places
// (their centres and their nebula's middle as instance attributes, the camera's place as `cameraPosition`); on WebGPU each
// nebula is a group kept relative to its anchor, its own middle: a sheet is stored as its centre less that middle with the
// nebula's row, and each frame every nebula's middle less the eye is worked in doubles on the main thread into a table of
// one texel a nebula (`uMiddles`), so the card works every sheet's place from the eye with numbers no bigger than a nebula;
// the bolts are handed their two ends less the eye the same way (`uFromEye`, `uToEye`); the haze is a sphere about the eye
// and three's own model-view (worked in doubles) places it. The view's turn alone (`cameraViewMatrix` times a direction)
// carries each into view space, so the reflections' capture, whose face cameras stand at the eye, draws the same sheets with
// the same graphs.
//
// Every number is the GLSL text's own (`NEBULA_GPU_NUMBERS`, held to it by `gpuNebulae.test.ts`). Nothing here is loaded on
// the WebGL path.

import * as THREE from 'three';
import type { NodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { fallbackTextures, finish, own, ownTexture, program } from './gpuPrograms.ts';
import { withGlow } from '../../sky/exposure/eyeBuffer.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { abs, attribute, cameraProjectionMatrix, cameraViewMatrix, cos, cross, dot, float, fract, int, ivec2, length, max, mix, normalize, positionLocal, select, sin, smoothstep, varying, vec2, vec3, vec4 } = TSL as Any;

/** Every number the graphs are built from, each the WebGL text's own (`nebulae.ts`'s GLSL), by program. */
export const NEBULA_GPU_NUMBERS = {
  // `corner`: the quad's corners stand at ±0.5 (`sheetQuad`), so its picture place is the corner plus it.
  sheet: { facingAbove: 0.5, nearest: 1.0, across: 2.0, shareFloor: 1.0, cut: 0.003, corner: 0.5 },
  haze: { sumFloor: 0.001, driftZy: 0.6, driftYx: 0.7, driftYy: 0.4, cut: 0.003 },
  bolt: { parallel: 1e-8, upBelow: 0.9, seedB: 2.7, seedC: 1.7, seedD: 3.1, half: 0.5, cut: 0.003 },
} as const;

/** Graphs built, by kind, for `__debug.gpu()` and the test (one build serves a kind). */
export const NEBULA_GPU_STATS = { sheets: 0, haze: 0, bolts: 0 };

/** A direction (a place less the eye) turned into view space by the view's turn alone: nothing measured from the world's middle. */
function turned(v: Any): Any {
  return cameraViewMatrix.mul(vec4(v, 0)).xyz;
}

/**
 * The sheets (`SHEET_VERTEX`, `SHEET_FRAGMENT`): a nebula past `uPullFrom` scaled toward the eye with everything in it, each
 * sheet turned to the camera or kept at its own turn, faded in as the eye comes into it, out before the far plane and out as
 * it fills the screen; the picture times the sheet's colour, the near-clear dropped.
 */
export function nebulaSheetNode(): NodeMaterial {
  const k = NEBULA_GPU_NUMBERS.sheet;
  const fb = fallbackTextures();
  const m = program('gpu: nebula sheets', false);
  NEBULA_GPU_STATS.sheets++;
  // On WebGPU a sheet's place attributes hold its centre less its nebula's middle and, in x, that nebula's row (`Nebulae.gpuRows`).
  const iCentre = attribute('iCentre', 'vec3');
  const iNebula = attribute('iNebula', 'vec3');
  const iSize = attribute('iSize', 'float');
  const iColour = attribute('iColour', 'vec4');
  const iFacing = attribute('iFacing', 'float');
  const iRight = attribute('iRight', 'vec3');
  const iUp = attribute('iUp', 'vec3');
  // Each nebula's middle less the eye, worked in doubles on the main thread each frame, one texel a row (`Nebulae.gpuSheetsFrame`).
  const middles = ownTexture('uMiddles', fb.float);
  const pullFrom = own('uPullFrom', 0);
  const alphaK = own('uAlpha', 1);
  const nearFade = own('uNearFade', new THREE.Vector2());
  const farFade = own('uFarFade', new THREE.Vector2());
  const screenFade = own('uScreenFade', new THREE.Vector2());
  const tanHalf = own('uTanHalfFov', 0.5);
  const map = ownTexture('uMap', fb.white);
  // The nebula's middle and the sheet's centre, each less the eye: the group's anchor less the eye, plus the offset from it.
  // The row is a whole number, which a float holds exactly.
  const middle = middles.load(ivec2(int(iNebula.x), int(0))).xyz;
  const nd = length(middle);
  const pull = select(pullFrom.greaterThan(0).and(nd.greaterThan(pullFrom)), pullFrom.div(nd), float(1));
  const centre = iCentre.add(middle).mul(pull);
  const size = iSize.mul(pull);
  const dist = max(k.nearest, length(centre));
  // Facing: the view's own right and up are view space's x and y, so the corner is laid after the turn; otherwise along the
  // sheet's own two axes before it. Both are WebGL's `centre + right * x * size + up * y * size` times the view.
  const cx = positionLocal.x.mul(size);
  const cy = positionLocal.y.mul(size);
  const facing = turned(centre).add(vec3(cx, cy, 0));
  const oriented = turned(centre.add(iRight.mul(cx)).add(iUp.mul(cy)));
  const mv = select(iFacing.greaterThan(k.facingAbove), facing, oriented);
  let a = iColour.a.mul(alphaK);
  a = a.mul(smoothstep(nearFade.x.mul(size), nearFade.y.mul(size), dist));
  a = a.mul(float(1).sub(smoothstep(farFade.x, farFade.y, mv.z.negate())));
  const share = size.div(max(k.shareFloor, dist.mul(k.across).mul(tanHalf)));
  a = a.mul(float(1).sub(smoothstep(screenFade.x, screenFade.y, share)));
  const vColour = varying(vec4(iColour.rgb, a), 'vNebulaColour');
  m.vertexNode = cameraProjectionMatrix.mul(vec4(mv, 1));
  // The quad's picture place is its corner plus a half (`sheetQuad`: corners at ±0.5, uv 0 to 1), taken from the place rather
  // than its own attribute: the quad's place and uv and the seven per-sheet attributes are nine vertex buffers, and WebGPU
  // gives a pipeline eight (the first build failed "Vertex buffer count (9) exceeds the maximum number of vertex buffers (8)").
  const vUv = varying(positionLocal.xy.add(k.corner), 'vNebulaUv');
  const t = map.sample(vUv);
  const alpha = t.a.mul(vColour.a);
  // Pass 2's eye: painted for an exposure of 1, times the glow factor.
  finish(m, withGlow(vec4(t.rgb.mul(vColour.rgb), alpha)), alpha.lessThanEqual(k.cut));
  return m as NodeMaterial;
}

/**
 * The haze inside a nebula (`SHELL_VERTEX`, `SHELL_FRAGMENT`): a sphere about the eye, its picture laid by two flat projections
 * of the view's direction weighted so neither one's pinch shows, drifting on the clock, with a floor under its alpha. The
 * direction is the sphere's own place (it stands at the eye, unturned), and three's model-view places it.
 */
export function nebulaHazeNode(): NodeMaterial {
  const k = NEBULA_GPU_NUMBERS.haze;
  const fb = fallbackTextures();
  const m = program('gpu: nebula haze', false);
  NEBULA_GPU_STATS.haze++;
  const map = ownTexture('uMap', fb.white);
  const colour = own('uColour', new THREE.Color());
  const alphaK = own('uAlpha', 0);
  const time = own('uTime', 0);
  const scale = own('uScale', 1);
  const floorK = own('uFloor', 0);
  const d = normalize(varying(positionLocal, 'vNebulaDir'));
  const w1 = float(1).sub(abs(d.y));
  const w2 = float(1).sub(abs(d.z));
  const sum = max(k.sumFloor, w1.add(w2));
  const a = map.sample(d.xz.mul(scale).add(vec2(time, time.mul(k.driftZy))));
  const b = map.sample(d.xy.mul(scale).add(vec2(time.negate().mul(k.driftYx), time.mul(k.driftYy))));
  const t = a.mul(w1).add(b.mul(w2)).div(sum);
  const alpha = alphaK.mul(floorK.add(float(1).sub(floorK).mul(t.a)));
  finish(m, withGlow(vec4(t.rgb.mul(colour), alpha)), alpha.lessThanEqual(k.cut));
  return m as NodeMaterial;
}

/**
 * A lightning bolt (`BEAM_VERTEX`, `BEAM_FRAGMENT`): a ribbon between the strike's two ends, wandering by two waves either side
 * and turned to face the eye (any axis across it where it points straight at the eye), one frame of the flip-book along it,
 * wrapped into the tile per pixel, coloured from the row's colour to its ramp along it.
 */
export function nebulaBoltNode(): NodeMaterial {
  const k = NEBULA_GPU_NUMBERS.bolt;
  const fb = fallbackTextures();
  const m = program('gpu: nebula lightning', false);
  NEBULA_GPU_STATS.bolts++;
  const aT = attribute('aT', 'float');
  const aSide = attribute('aSide', 'float');
  const aWidth = attribute('aWidth', 'float');
  const aWander = attribute('aWander', 'float');
  const aBright = attribute('aBright', 'float');
  // The bolt's ends less the eye, handed in on WebGPU (`Nebulae.gpuBolts`).
  const from = own('uFromEye', new THREE.Vector3());
  const to = own('uToEye', new THREE.Vector3(0, 1, 0));
  const widthK = own('uWidth', 1);
  const wanderK = own('uWander', 0);
  const rates = own('uWaveRates', new THREE.Vector4());
  const waveMix = own('uWaveMix', 0);
  const seed = own('uSeed', 0);
  const repeat = own('uRepeat', 1);
  const map = ownTexture('uMap', fb.white);
  const frameOffset = own('uFrameOffset', new THREE.Vector2());
  const frameSize = own('uFrameSize', new THREE.Vector2(1, 1));
  const colourA = own('uColourA', new THREE.Color());
  const colourB = own('uColourB', new THREE.Color());
  const alphaK = own('uAlpha', 0);
  const p0 = mix(from, to, aT);
  const dir = normalize(to.sub(from));
  // WebGL's `cameraPosition - p` is minus the place less the eye.
  const c = cross(dir, normalize(p0.negate()));
  const anyAcross = normalize(cross(dir, select(abs(dir.y).lessThan(k.upBelow), vec3(0, 1, 0), vec3(1, 0, 0))));
  const side = select(dot(c, c).lessThan(k.parallel), anyAcross, normalize(c));
  const up = normalize(cross(side, dir));
  const w1 = sin(aT.mul(rates.x).add(seed)).add(waveMix.mul(sin(aT.mul(rates.y).add(seed.mul(k.seedB)))));
  const w2 = cos(aT.mul(rates.z).add(seed.mul(k.seedC))).add(waveMix.mul(cos(aT.mul(rates.w).add(seed.mul(k.seedD)))));
  const p = p0.add(side.mul(w1).add(up.mul(w2)).mul(aWander.mul(wanderK))).add(side.mul(aSide.mul(aWidth).mul(widthK)));
  m.vertexNode = cameraProjectionMatrix.mul(vec4(turned(p), 1));
  const vUv = varying(vec2(aT.mul(repeat), aSide.mul(k.half).add(k.half)), 'vBoltUv');
  const vT = varying(aT, 'vBoltT');
  const vBright = varying(aBright, 'vBoltBright');
  // Only the length wraps; a length that lands exactly on a tile's end keeps that end.
  const f = fract(vUv.x);
  const u = select(f.equal(0).and(vUv.x.greaterThan(0)), float(1), f);
  const t = map.sample(frameOffset.add(vec2(u, vUv.y).mul(frameSize)));
  const alpha = t.a.mul(alphaK).mul(vBright);
  finish(m, withGlow(vec4(t.rgb.mul(mix(colourA, colourB, vT)), alpha)), alpha.lessThanEqual(k.cut));
  return m as NodeMaterial;
}
