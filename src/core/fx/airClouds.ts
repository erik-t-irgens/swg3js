// The clouds (the volumetrics' seventh wave's second half, the design's §2.18): one cloud system under the master that
// stands in for the September pass while it is wanted (`yieldsTo` on that pass's row), fed by the sky's own mix per deck
// with each picture as a weather map, drifted at the world's wind aloft and smeared by the unified wind's own gust
// function at a cloud's scale, lit by the dome's own sky with octaves of scattering and a history, and a low deck near the
// ground in rain and overcast that every hull flying through it holes.
//
// Seven programs, every number a uniform and no `retune`: the weather pass (two outputs: each deck's cut and opacity, and
// the slab's local wind less its mean), the low deck's wind, the hole field's tick, the march (two outputs: in-scatter and
// transmittance, and the in-scatter-weighted distance a sky pixel is reprojected at) and the same march with the low deck
// compiled out, the resolve and the composite. The holes and their fine steps, the smear and the debug views are uniform
// branches of the march; the low deck is a march of its own, drawn only while it draws, because the wave's Start measured
// its branch carried while off at 28 to 48% over the march without it in a rain sky on both backends (`W7b-notes.md`).
//
// Built on the volume's skeleton (`airVolume.ts`) and none of the September's code, whose imports node cannot load: the
// four bugs that pass met are kept out here and tested (`airClouds.test.ts`): every full-screen material `NoBlending`; a
// far-plane depth texel is sky and never a surface; the upsample is worked out from the march's own size and never
// `fxHalfTaps`; and an amount of nought refuses rather than compositing a copy. What the two share (`cutForCover`, the
// calibration's sweep, the noise volumes) is imported from `cloudMath.ts` and the session's volumes, never copied.
import * as THREE from 'three';
import type { FxProductId, FxSettings } from '../fxRegistry.ts';
import type { FxFrameContext } from './context.ts';
import { createFxQuad, FX_CAMERA, type FxDebugTexture, type FxPass, type FxWarmItem } from './pass.ts';
import { FX_FULLSCREEN_VERTEX, FX_LINEARIZE, FX_PHASE_HG, FX_SLAB, FX_VIEW_POS } from './glsl.ts';
import { CUT_FOR_GLSL } from './cloudMath.ts';
import { WIND7_GLSL } from '../../world/windMath.ts';
import { AIR_TUNE } from '../../world/volumetrics/airTune.ts';
import { VOL_TUNE } from '../../world/volumetrics/volSettings.ts';
import type { AirCloudsFeed } from '../../world/volumetrics/airCloudsFeed.ts';

/** The march's loop bound for the high slab's samples (`volCloudsSteps` at most 96 on the page, 128 from the console). */
export const CLOUD_MAX_STEPS = 128;
/** The light steps' loop bound (`volCloudsLight` at most 6 on the page, 8 from the console). */
export const CLOUD_MAX_LIGHT = 8;
/** The octaves' loop bound. */
export const CLOUD_MAX_OCTAVES = 4;
/** The fine steps' loop bound through a live hole's box (`holes.fineMost`). */
export const CLOUD_MAX_FINE = 32;

const NEEDS: readonly FxProductId[] = ['linearDepthHalf'];

/**
 * The weather pass: one draw over a square round the camera writing, for each deck, the cut on the billow and the opacity
 * the march reads in one tap a sample, from the game's own pictures sampled at the sheets' own repeat, their scroll,
 * each smear phase's frozen streets and the unified wind's gusts at a cloud's scale; and the slab's local wind less its
 * mean, which the march's detail smear reads.
 */
const WEATHER_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
layout(location = 0) out highp vec4 oWeather;
layout(location = 1) out highp vec4 oWind;
uniform sampler2D uPicB0;
uniform sampler2D uPicB1;
uniform sampler2D uPicT0;
uniform sampler2D uPicT1;
// The square: its corner x, z, its size and the billow's top. Each image: its repeat, its weight (nought while it loads),
// its mean alpha and its kind; its scroll at each smear phase (folded on the processor). Each deck's streets a phase:
// (sin h, cos h, 1 / stretch). The decks' winds, the slab's mean and the smear's switch; the phases' ages times the share,
// the first phase's weight and the most a picture is moved; the look (gain, extent, thinness, the art's share); the
// overcast (its cover, its thickness, each deck's share of it).
uniform vec4 uWin;
uniform vec4 uImgB0;
uniform vec4 uImgB1;
uniform vec4 uImgT0;
uniform vec4 uImgT1;
uniform vec4 uScrB0;
uniform vec4 uScrB1;
uniform vec4 uScrT0;
uniform vec4 uScrT1;
uniform vec4 uStrBA;
uniform vec4 uStrBB;
uniform vec4 uStrTA;
uniform vec4 uStrTB;
uniform vec4 uDeckU;
uniform vec4 uSlabU;
uniform vec4 uSmearW;
uniform vec4 uLook;
uniform vec4 uOver;
uniform vec2 uCover[16];
uniform float uCoverN;
${WIND7_GLSL}
${CUT_FOR_GLSL}
// A metre vector along a frozen heading over the street's stretch, across it kept: the picture drawn longer downwind.
vec2 streetOf(vec2 x, vec4 st) {
  float a = (x.x * st.x + x.y * st.y) * st.z;
  float c = x.x * st.y - x.y * st.x;
  return vec2(st.x * a + st.y * c, st.y * a - st.x * c);
}
// A displacement held to its most (the design's risk 85: a storm's smear moved samples kilometres), by its components so
// the tests run it as script.
vec2 capped(vec2 d, float most) {
  float l = sqrt(d.x * d.x + d.y * d.y);
  float k = l > most && l > 0.0 ? most / l : 1.0;
  return vec2(d.x * k, d.y * k);
}
// The picture coordinate a world point x reads in one phase: the point less that phase's smear d, through its frozen
// street st, over the repeat r, plus that phase's scroll (sx, sy). By its components (the tests run it as script).
vec2 pictureUv(vec2 x, vec2 d, vec4 st, float r, float sx, float sy) {
  vec2 s = streetOf(vec2(x.x - d.x, x.y - d.y), st);
  return vec2(s.x / r + sx, s.y / r + sy);
}
// One image's alpha at a world point, both phases cross-faded, at the level of detail a texel of the square asks for.
float alphaOf(sampler2D pic, vec2 x, vec4 img, vec4 scr, vec4 stA, vec4 stB, vec2 dA, vec2 dB) {
  if (img.y <= 0.0) return 0.0;
  float r = max(img.x, 1e-3);
  // The level a texel of the square's footprint asks for: its metres (uSlabU.w) over the picture's metres a texel.
  float lod = max(log2(max(uSlabU.w * float(textureSize(pic, 0).x) / r, 1.0)), 0.0);
  float aA = textureLod(pic, pictureUv(x, dA, stA, r, scr.x, scr.y), lod).a;
  float aB = textureLod(pic, pictureUv(x, dB, stB, r, scr.z, scr.w), lod).a;
  return mix(aB, aA, uSmearW.z);
}
// One image's cut and opacity from its alpha: heaps cut the billow at the gained share, a layer covers its extent thinly;
// at the art's nought the even noise at the picture's mean.
vec2 cutOf(float a, vec4 img) {
  float al = mix(img.z, a, uLook.w);
  float c = clamp(uLook.x * al, 0.0, 1.0);
  float layered = img.w * uLook.w;
  float cut = mix(cutFor(c), cutFor(uLook.y), layered);
  float op = mix(1.0, clamp(c * uLook.z, 0.0, 1.0), layered);
  return vec2(cut, op);
}
// One deck: its two images by their weights, and the wet overcast where its rows hang none.
vec2 deckOf(vec2 cutOp0, float w0, vec2 cutOp1, float w1, float po) {
  float oc = uOver.x;
  float q = w0 + w1 + po;
  if (q <= 1e-4) return vec2(1.0, 0.0);
  float cutO = cutFor(oc * uLook.y);
  float cut = (w0 * cutOp0.x + w1 * cutOp1.x + po * cutO) / q;
  float op = w0 * cutOp0.y + w1 * cutOp1.y + po * uOver.y;
  return vec2(cut, clamp(op, 0.0, 1.0));
}
void main() {
  vec2 x = uWin.xy + vUv * uWin.z;
  // The gusts at a cloud's scale (the unified wind's own function over the decks' pack): the local wind less its mean, for
  // each deck by its own wind and for the slab by its one frame's.
  vec2 gB = vec2(0.0);
  vec2 gT = vec2(0.0);
  vec2 gS = vec2(0.0);
  if (uSlabU.z > 0.5) {
    vec3 g = w7Gust(x);
    float c = cos(g.y);
    float s = sin(g.y);
    gB = vec2((uDeckU.x * c + uDeckU.y * s) * g.x, (uDeckU.y * c - uDeckU.x * s) * g.x) - uDeckU.xy;
    gT = vec2((uDeckU.z * c + uDeckU.w * s) * g.x, (uDeckU.w * c - uDeckU.z * s) * g.x) - uDeckU.zw;
    gS = vec2((uSlabU.x * c + uSlabU.y * s) * g.x, (uSlabU.y * c - uSlabU.x * s) * g.x) - uSlabU.xy;
  }
  vec2 dBA = capped(gB * uSmearW.x, uSmearW.w);
  vec2 dBB = capped(gB * uSmearW.y, uSmearW.w);
  vec2 dTA = capped(gT * uSmearW.x, uSmearW.w);
  vec2 dTB = capped(gT * uSmearW.y, uSmearW.w);
  vec2 b0 = cutOf(alphaOf(uPicB0, x, uImgB0, uScrB0, uStrBA, uStrBB, dBA, dBB), uImgB0);
  vec2 b1 = cutOf(alphaOf(uPicB1, x, uImgB1, uScrB1, uStrBA, uStrBB, dBA, dBB), uImgB1);
  vec2 t0 = cutOf(alphaOf(uPicT0, x, uImgT0, uScrT0, uStrTA, uStrTB, dTA, dTB), uImgT0);
  vec2 t1 = cutOf(alphaOf(uPicT1, x, uImgT1, uScrT1, uStrTA, uStrTB, dTA, dTB), uImgT1);
  vec2 lo = deckOf(b0, uImgB0.y, b1, uImgB1.y, uOver.z);
  vec2 hi = deckOf(t0, uImgT0.y, t1, uImgT1.y, uOver.w);
  vec4 o = vec4(lo.x, hi.x, lo.y, hi.y);
  if (any(isnan(o)) || any(isinf(o))) o = vec4(1.0, 1.0, 0.0, 0.0);
  oWeather = o;
  vec4 w = vec4(gS, 0.0, 1.0);
  if (any(isnan(w)) || any(isinf(w))) w = vec4(0.0, 0.0, 0.0, 1.0);
  oWind = w;
}
`;

/** The low deck's wind: the unified wind's gusts at the low deck's own scale, its local wind less its mean. */
const LOW_WIND_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uLowW;
uniform vec4 uLowU;
${WIND7_GLSL}
void main() {
  vec2 x = uLowW.xy + vUv * uLowW.z;
  vec3 g = w7Gust(x);
  float c = cos(g.y);
  float s = sin(g.y);
  vec2 d = vec2((uLowU.x * c + uLowU.y * s) * g.x, (uLowU.y * c - uLowU.x * s) * g.x) - uLowU.xy;
  vec4 o = vec4(d, 0.0, 1.0);
  if (any(isnan(o)) || any(isinf(o))) o = vec4(0.0, 0.0, 0.0, 1.0);
  gl_FragColor = o;
}
`;

/**
 * The hole field's tick (on the dents' 10 Hz clock): the fill over every tick owed with a blur of the four neighbours, the
 * toroidal clear of what the square's move took out of it (each texel's place in this tick's square and the last, from the
 * centres folded on the processor and the move worked out in double), and the stamps, each a capsule relative to its
 * channel's centre now. R the low deck's, G the high slab's.
 */
const HOLE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform highp sampler2D uPrev;
uniform vec4 uH;
uniform vec4 uSqL;
uniform vec4 uSqH;
uniform vec4 uMove;
uniform vec4 uCap[64];
// Every rule of the tick a function of its own, by its components, so the tests run the program's own text as script
// (glslRun.ts) rather than a copy of it.
// A coordinate wrapped into the field's half-open square about nought.
float wrapC(float v, float n) { return v - n * floor(v / n + 0.5); }
// A point's distance to a segment.
float segDist(float px, float pz, float ax, float az, float bx, float bz) {
  float abx = bx - ax;
  float abz = bz - az;
  float t = clamp(((px - ax) * abx + (pz - az) * abz) / max(abx * abx + abz * abz, 1e-4), 0.0, 1.0);
  float dx = px - ax - abx * t;
  float dz = pz - az - abz * t;
  return sqrt(dx * dx + dz * dz);
}
// One channel's fill: the texel's own value blurred toward its four neighbours' mean and kept over every tick owed.
float holeFill(float h, float nSum, float blur, float keep) { return mix(h, nSum * 0.25, blur) * keep; }
// Whether a texel stands for the same place of its channel's square now and at the last tick (its two places there one
// move apart): anywhere else it stands for new ground and is cleared.
float holeKept(float r0x, float r0z, float r1x, float r1z, float mx, float mz) {
  return abs(r0x - r1x - mx) > 0.5 || abs(r0z - r1z - mz) > 0.5 ? 0.0 : 1.0;
}
// A capsule's stamp at a texel's place relative to its channel's centre now: whole within six tenths of its radius, none
// past it.
float holeStamp(float rx, float rz, float ax, float az, float bx, float bz, float radius, float strength) {
  return strength * (1.0 - smoothstep(radius * 0.6, radius, segDist(rx, rz, ax, az, bx, bz)));
}
// The tick at one texel (u, v its texture coordinate): the fill and the blur, the toroidal clear, the stamps; the low
// deck's value in x, the high slab's in y.
vec2 holeTexel(float u, float v) {
  float tx = 1.0 / float(textureSize(uPrev, 0).x);
  float ty = 1.0 / float(textureSize(uPrev, 0).y);
  vec4 c0 = texture(uPrev, vec2(u, v));
  vec4 cE = texture(uPrev, vec2(fract(u + tx), v));
  vec4 cW = texture(uPrev, vec2(fract(u - tx), v));
  vec4 cN = texture(uPrev, vec2(u, fract(v + ty)));
  vec4 cS = texture(uPrev, vec2(u, fract(v - ty)));
  float hr = holeFill(c0.r, cE.r + cW.r + cN.r + cS.r, uH.z, uH.y);
  float hg = holeFill(c0.g, cE.g + cW.g + cN.g + cS.g, uH.z, uH.y);
  float size = uH.x;
  float ux = u * size;
  float uz = v * size;
  float rL1x = wrapC(ux - uSqL.x, size);
  float rL1z = wrapC(uz - uSqL.y, size);
  float rL0x = wrapC(ux - uSqL.z, size);
  float rL0z = wrapC(uz - uSqL.w, size);
  float rH1x = wrapC(ux - uSqH.x, size);
  float rH1z = wrapC(uz - uSqH.y, size);
  float rH0x = wrapC(ux - uSqH.z, size);
  float rH0z = wrapC(uz - uSqH.w, size);
  // The same place in both squares is the last place less the move: anywhere else the texel stands for new ground.
  if (holeKept(rL0x, rL0z, rL1x, rL1z, uMove.x, uMove.y) < 0.5) hr = 0.0;
  if (holeKept(rH0x, rH0z, rH1x, rH1z, uMove.z, uMove.w) < 0.5) hg = 0.0;
  for (int i = 0; i < 32; i++) {
    if (float(i) >= uH.w) break;
    vec4 ends = uCap[i * 2];
    vec4 q = uCap[i * 2 + 1];
    bool low = q.z < 0.5;
    float st = holeStamp(low ? rL1x : rH1x, low ? rL1z : rH1z, ends.x, ends.y, ends.z, ends.w, q.x, q.y);
    if (low) hr = max(hr, st);
    else hg = max(hg, st);
  }
  return vec2(hr, hg);
}
void main() {
  vec2 h = holeTexel(vUv.x, vUv.y);
  vec4 o = vec4(h, 0.0, 1.0);
  if (any(isnan(o)) || any(isinf(o))) o = vec4(0.0, 0.0, 0.0, 1.0);
  gl_FragColor = o;
}
`;

/**
 * The march: the low deck and the high slab, nearer first, each with an adaptive step (longer after an empty sample),
 * fine steps through a live hole's box, the holes' keep, the near fade, the dome's own sky as the ambient, octaves of
 * multiple scattering toward the sun, the scene's fog as a share of haze; in-scatter and transmittance out, and the
 * in-scatter-weighted distance a sky pixel is reprojected at.
 */
const MARCH_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler3D;
varying vec2 vUv;
layout(location = 0) out highp vec4 oCloud;
layout(location = 1) out highp vec4 oDist;
uniform sampler2D uDepth;
uniform highp sampler3D uBase;
uniform highp sampler3D uDetail;
uniform sampler2D uWeather;
uniform sampler2D uWeatherWind;
uniform sampler2D uLowWind;
uniform highp sampler2D uHoles;
// The dome's own uniform objects, by reference: its two gradients, their flags, their mix, the hour and the clear colour.
uniform sampler2D uGradient;
uniform sampler2D uGradient2;
uniform float uTime;
uniform float uHasGradient;
uniform float uHasGradient2;
uniform float uGradientMix;
uniform vec3 uClear;
uniform vec2 uTanHalfFov;
uniform float uFar;
uniform mat3 uViewToWorld;
uniform vec3 uCamera;
uniform vec3 uCamFwd;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uBounce;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFrame;
// The high slab (floor, top, steps, light steps); the low deck (floor, top, steps or nought, reach), its cut, reach fade and
// smear's most, its wind's square; the weather's square and the billow's top; each frame's offsets folded (base, detail),
// the holes' (low, high), the hole field's size, edge, lift and softness and which channels are on; the live boxes in the
// world (min x, min z, max x, max z) and the fine steps (low, high, most, light every); each deck's kind and the decks; the
// bites, the densities, the phase and octaves, the scattering's falloffs and the sky's share of the ambient, the ambient's
// top and bottom, the haze and the brightness; the near fade, the amount and the view; the scales and the reach; the smear.
uniform vec4 uHigh;
uniform vec4 uLow;
uniform vec4 uLowP;
uniform vec4 uLowW;
uniform vec4 uWin;
uniform vec4 uDriftH;
uniform vec4 uDriftL;
uniform vec4 uHoleOff;
uniform vec4 uHoleP;
uniform vec4 uHoleOn;
uniform vec4 uFineL;
uniform vec4 uFineH;
uniform vec4 uFineP;
uniform vec4 uKind;
uniform vec4 uErode;
uniform vec4 uDens;
uniform vec4 uPhase;
uniform vec4 uMs;
uniform vec4 uAmb;
uniform vec4 uNear;
uniform vec4 uScale;
uniform vec4 uSmear;
uniform vec4 uSmear2;
uniform vec3 uAlbLo;
uniform vec3 uAlbHi;
uniform vec3 uAlbLow;
${FX_LINEARIZE}
${FX_VIEW_POS}
${FX_SLAB}
${FX_PHASE_HG}
float bayer4(vec2 c) {
  vec2 m = mod(floor(c), 4.0);
  float b = mod(m.x + m.y * 2.0, 4.0) * 4.0 + mod(m.x * 2.0 + m.y, 4.0);
  return (b + 0.5) / 16.0;
}
// The deck's profile: narrow at its floor where it forms, frayed at its top; two decks a thinner sheet above.
float profileOf(float h, float decks) {
  float f = uDens.w;
  float low = smoothstep(0.0, f, h) * smoothstep(1.0, 1.0 - f * 1.6, h);
  if (decks < 1.5) return low;
  float split = smoothstep(0.52, 0.62, h);
  return mix(low, low * 0.75 + smoothstep(0.6, 0.72, h) * smoothstep(1.0, 0.86, h) * 0.6, split);
}
float erodeOf(vec4 b) { return b.g * 0.625 + b.b * 0.25 + b.a * 0.125; }
float detailAt(vec3 q) {
  vec3 d = texture(uDetail, q).rgb;
  return d.r * 0.625 + d.g * 0.25 + d.b * 0.125;
}
// A displacement held to its most, by its components (the tests run it as script).
vec2 capLen(vec2 d, float most) {
  float l = sqrt(d.x * d.x + d.y * d.y);
  float k = l > most && l > 0.0 ? most / l : 1.0;
  return vec2(d.x * k, d.y * k);
}
float heightIn(float y, float lo, float hi) { return clamp((y - lo) / max(1.0, hi - lo), 0.0, 1.0); }
// Each deck's volume coordinates at a world point, by their components (the tests follow a feature through them): the
// frame's offset, folded at that volume's period, added, and the period divided out; the detail less the smear d (nought
// without one). The low deck's periods are the high slab's times its scale.
vec3 highBaseAt(vec3 p) { return vec3((p.x + uDriftH.x) / uScale.x, p.y / uScale.x, (p.z + uDriftH.y) / uScale.x); }
vec3 highDetailAt(vec3 p, vec2 d) { return vec3((p.x + uDriftH.z - d.x) / uScale.y, p.y / uScale.y, (p.z + uDriftH.w - d.y) / uScale.y); }
vec3 lowBaseAt(vec3 p) {
  float ls = uScale.x * uScale.z;
  return vec3((p.x + uDriftL.x) / ls, p.y / ls, (p.z + uDriftL.y) / ls);
}
vec3 lowDetailAt(vec3 p, vec2 d) {
  float lds = uScale.y * uScale.z;
  return vec3((p.x + uDriftL.z - d.x) / lds, p.y / lds, (p.z + uDriftL.w - d.y) / lds);
}
// The walk of a deck's march (the tests walk a ray with these very functions): where it starts, the step from t, whether
// the sample at t is a fine one, and the growth after a full sample. [fa, fb] is the stretch of the ray inside the live
// hole's box (fa past fb: none), and fine steps are taken while any are left.
// The start: a jitter of the full step from where the ray enters the deck, or of the fine step from where it enters the
// box when that comes first, so a ray that starts in a box, or meets one within its first step, never jitters past it.
float startAt(float ta, float stepLen, float jitter, float fa, float fb, float fineLen, float fineLeft) {
  float t = ta + stepLen * jitter;
  if (fineLen > 0.0 && fineLeft > 0.0 && fa <= fb) t = min(t, fa + fineLen * jitter);
  return t;
}
// The step from t: a fine one inside the box; otherwise the full step grown, cut short to land just inside the box where
// it lies ahead within that step, so a box narrower than a full step is never stepped over (the design's §2.18: the part
// of a ray inside a live hole's box is stepped at no more than half the smallest hole's radius).
float stepAt(float t, float fa, float fb, float fineLen, float fineLeft, float full) {
  if (fineLeft > 0.0 && fa <= fb) {
    if (t >= fa && t <= fb) return fineLen;
    if (t < fa) return min(full, fa - t + 0.01 * fineLen);
  }
  return full;
}
// Whether the sample at t is a fine one (inside the box while fine steps are left: not counted against the full steps).
float fineAt(float t, float fa, float fb, float fineLeft) { return t >= fa && t <= fb && fineLeft > 0.0 ? 1.0 : 0.0; }
// The growth after a sample: a fine one leaves it; back to one wherever the deck has cloud (shape, before the near and
// the reach fades: a sample only they emptied is still cloud), grown toward its most where it has none.
float growAfter(float grow, float shape, float fine) {
  if (fine > 0.5) return grow;
  return shape > 0.001 ? 1.0 : min(grow * uSmear2.z, uSmear2.w);
}
// The hole field's value at a world point (0 low deck, 1 the high slab): read only inside the square round the camera and
// faded over its last metres. By its components (the tests run it as script).
float holeAt(vec3 p, int ch) {
  float rx = p.x - uCamera.x;
  float rz = p.z - uCamera.z;
  float halfSq = 0.5 * uHoleP.x;
  float m = max(abs(rx), abs(rz));
  if (m >= halfSq) return 0.0;
  float ox = ch == 0 ? uHoleOff.x : uHoleOff.z;
  float oz = ch == 0 ? uHoleOff.y : uHoleOff.w;
  vec4 hv = textureLod(uHoles, vec2(fract((p.x + ox) / uHoleP.x), fract((p.z + oz) / uHoleP.x)), 0.0);
  float edge = 1.0 - smoothstep(halfSq - uHoleP.y, halfSq, m);
  return (ch == 0 ? hv.r : hv.g) * edge;
}
// How much of a sample a hole keeps: one exactly at h nought, closing raggedly from its edges by the detail n.
float holeKeep(float hv, float n) {
  return smoothstep(uHoleP.z * hv - uHoleP.w, uHoleP.z * hv, n);
}
// The high slab at p (h its height share): the weather's cut and opacity, the billow cut, eroded, the profile thinned to
// the middle for a layer, then eaten by the detail -- smeared by the gusts' two phases when the smear is on.
float highAt(vec3 p, float h, bool cheap, out float nOut) {
  nOut = 1.0;
  vec2 wuv = (p.xz - uWin.xy) / uWin.z;
  vec4 w = texture(uWeather, wuv);
  float upper = uKind.z > 1.5 ? smoothstep(0.5, 0.62, h) : 0.0;
  float cut = mix(w.r, w.g, upper);
  float op = mix(w.b, w.a, upper);
  if (op <= 0.0 || cut >= uWin.w) return 0.0;
  vec4 base = texture(uBase, highBaseAt(p));
  float shape = (base.r - cut) / max(1e-3, 1.0 - cut);
  if (shape <= 0.0) return 0.0;
  float layered = mix(uKind.x, uKind.y, upper);
  float mid = 0.5 * (1.0 - uErode.z);
  float hh = mix(h, clamp((h - mid) / max(uErode.z, 1e-3), 0.0, 1.0), layered);
  shape = clamp(shape - (1.0 - erodeOf(base)) * uErode.x * (1.0 - uErode.w * layered), 0.0, 1.0) * profileOf(hh, uKind.z);
  if (shape <= 0.0) return 0.0;
  if (cheap) return shape * op;
  float n;
  if (uSmear.x > 0.5) {
    vec2 v = texture(uWeatherWind, wuv).xy;
    vec2 dA = capLen(v * uSmear.y, uSmear2.x);
    vec2 dB = capLen(v * uSmear.z, uSmear2.x);
    n = mix(detailAt(highDetailAt(p, dB)), detailAt(highDetailAt(p, dA)), uSmear.w);
  } else n = detailAt(highDetailAt(p, vec2(0.0)));
  nOut = n;
  return clamp(shape - (1.0 - n) * uErode.y * mix(0.4, 1.0, h), 0.0, 1.0) * op;
}
// The low deck at p: its own cut, its volumes at its own scale and frame, the one-deck profile its calibration measures.
float lowAt(vec3 p, bool cheap, out float nOut) {
  nOut = 1.0;
  float h = (p.y - uLow.x) / max(1.0, uLow.y - uLow.x);
  if (h < 0.0 || h > 1.0) return 0.0;
  float cut = uLowP.x;
  if (cut >= uWin.w) return 0.0;
  vec4 base = texture(uBase, lowBaseAt(p));
  float shape = (base.r - cut) / max(1e-3, 1.0 - cut);
  if (shape <= 0.0) return 0.0;
  shape = clamp(shape - (1.0 - erodeOf(base)) * uErode.x, 0.0, 1.0) * profileOf(h, 1.0);
  if (shape <= 0.0) return 0.0;
  if (cheap) return shape;
  float n;
  if (uSmear.x > 0.5) {
    vec2 v = texture(uLowWind, (p.xz - uLowW.xy) / uLowW.z).xy;
    vec2 dA = capLen(v * uSmear.y, uLowP.z);
    vec2 dB = capLen(v * uSmear.z, uLowP.z);
    n = mix(detailAt(lowDetailAt(p, dB)), detailAt(lowDetailAt(p, dA)), uSmear.w);
  } else n = detailAt(lowDetailAt(p, vec2(0.0)));
  nOut = n;
  return clamp(shape - (1.0 - n) * uErode.y * mix(0.4, 1.0, h), 0.0, 1.0);
}
// The density a light step reads (no detail), in either deck.
float cheapAt(vec3 q, int slab) {
  float n;
  return slab == 0 ? lowAt(q, true, n) : highAt(q, heightIn(q.y, uHigh.x, uHigh.y), true, n);
}
// The light at a sample: octaves of the sun through the deck toward it, the powder at an edge, the ambient from the sky.
vec3 litAt(vec3 p, float h, float sigma, float stepLen, float cosT, int slab, vec3 ambTop, vec3 ambBot, vec3 alb) {
  float od = 0.0;
  float t = stepLen * 0.5;
  for (int i = 0; i < ${CLOUD_MAX_LIGHT}; i++) {
    if (float(i) >= uHigh.w) break;
    od += cheapAt(p + uSunDir * t, slab) * stepLen;
    t += stepLen * (1.0 + float(i) * 0.6);
  }
  od *= uDens.x * uDens.y * uNear.z;
  float powder = 1.0 - exp(-sigma * stepLen * 6.0);
  vec3 sun = vec3(0.0);
  float a = 1.0;
  float b = 1.0;
  float c = 1.0;
  for (int o = 0; o < ${CLOUD_MAX_OCTAVES}; o++) {
    if (float(o) >= uPhase.w) break;
    float ph = mix(fxPhaseHG(cosT, uPhase.x * b), fxPhaseHG(cosT, uPhase.y * b), uPhase.z);
    sun += uSunColor * (a * exp(-od * c) * ph);
    a *= uMs.x;
    b *= uMs.y;
    c *= uMs.z;
  }
  return (sun * mix(1.0, powder, uDens.z) + mix(ambBot, ambTop, h)) * alb * uAmb.w;
}
// One deck marched from ta to tb (slab 0 the low deck, 1 the high slab), into the running in-scatter and transmittance and
// the in-scatter-weighted distance's two sums.
void marchDeck(vec3 dir, float ta, float tb, float steps, int slab, float cosT, float jitter, vec3 ambTop, vec3 ambBot, inout vec3 S, inout float T, inout float wsum, inout float dsum) {
  if (tb <= ta || steps < 0.5) return;
  float stepLen = (tb - ta) / steps;
  vec4 box = slab == 0 ? uFineL : uFineH;
  float fineLen = slab == 0 ? uFineP.x : uFineP.y;
  float fa = 1e9;
  float fb = -1e9;
  if (fineLen > 0.0 && box.x <= box.z) {
    vec2 hb = fxSlab(uCamera, dir, vec3(box.x, -1e7, box.y), vec3(box.z, 1e7, box.w));
    fa = max(hb.x, ta);
    fb = min(hb.y, tb);
  }
  float fineLeft = uFineP.z;
  float t = startAt(ta, stepLen, jitter, fa, fb, fineLen, fineLeft);
  float grow = 1.0;
  float full = 0.0;
  float lightEvery = max(uFineP.w, 1.0);
  float fineSince = 0.0;
  vec3 lastLight = vec3(0.0);
  bool haveLight = false;
  bool holes = slab == 0 ? uHoleOn.x > 0.5 : uHoleOn.y > 0.5;
  for (int i = 0; i < ${CLOUD_MAX_STEPS + CLOUD_MAX_FINE}; i++) {
    if (t > tb || T < 0.01) break;
    float fineF = fineAt(t, fa, fb, fineLeft);
    bool fine = fineF > 0.5;
    float sl = stepAt(t, fa, fb, fineLen, fineLeft, stepLen * grow);
    if (!fine) {
      if (full >= steps) break;
      full += 1.0;
    }
    vec3 p = uCamera + dir * t;
    float n;
    float h;
    float d;
    if (slab == 0) {
      h = heightIn(p.y, uLow.x, uLow.y);
      d = lowAt(p, false, n);
    } else {
      h = heightIn(p.y, uHigh.x, uHigh.y);
      d = highAt(p, h, false, n);
    }
    if (holes && d > 0.0) {
      float hv = holeAt(p, slab);
      if (hv > 0.0) d *= holeKeep(hv, n);
    }
    // The deck's own density before the fades: what the step's growth reads (a sample only a fade emptied is cloud).
    float shape = d;
    // Faded into the haze over the last share of its reach: the sky deck carries the rest.
    if (slab == 0) d *= 1.0 - smoothstep(uLow.w * (1.0 - uLowP.y), uLow.w, t);
    // The clear round the lens: a uniform branch round the whole term.
    if (uNear.y > uNear.x) d *= smoothstep(uNear.x, uNear.y, t);
    if (d > 0.001) {
      float sigma = d * uDens.x * uNear.z;
      vec3 alb = slab == 0 ? uAlbLow : mix(uAlbLo, uAlbHi, uKind.z > 1.5 ? smoothstep(0.5, 0.62, h) : 0.0);
      vec3 light;
      // A fine step carries the last full step's light and works its own out every few steps.
      if (!fine || !haveLight || fineSince >= lightEvery) {
        light = litAt(p, h, sigma, slab == 0 ? stepLen : stepLen * 2.0, cosT, slab, ambTop, ambBot, alb);
        lastLight = light;
        haveLight = true;
        fineSince = 0.0;
      } else light = lastLight;
      float a = 1.0 - exp(-sigma * sl);
      vec3 add = light * a * T;
      S += add;
      float lw = add.r + add.g + add.b;
      wsum += lw;
      dsum += lw * t;
      T *= 1.0 - a;
    }
    grow = growAfter(grow, shape, fineF);
    if (fine) {
      fineLeft -= 1.0;
      fineSince += 1.0;
    }
    t += sl;
  }
}
void main() {
  vec3 dir = normalize(uViewToWorld * fxViewPos(vUv, 1.0, uTanHalfFov));
  // A far-plane depth texel is sky, never a surface nine kilometres off; the view-axis depth divided by the ray's cosine to
  // the view's forward, so a deck with hills in it stops at the hill and not short of it.
  float depth = texture(uDepth, vUv).r;
  float solid = (depth > 0.0 && depth < uFar * 0.999) ? depth / max(dot(dir, uCamFwd), 1e-3) : uScale.w;
  float cosT = dot(dir, uSunDir);
  float jitter = bayer4(gl_FragCoord.xy + vec2(mod(uFrame, 4.0), mod(floor(uFrame / 4.0), 4.0)));
  // The dome's sky at the zenith (its own ternary over its own flags: a row with no gradient is its clear colour, never
  // white) for a deck's top, the ground's bounce for its base; or the ramp's row the September read, by the sky's share.
  vec3 g1 = uHasGradient > 0.5 ? texture(uGradient, vec2(uTime, 0.999)).rgb : uClear;
  vec3 g2 = uHasGradient2 > 0.5 ? texture(uGradient2, vec2(uTime, 0.999)).rgb : uClear;
  vec3 zenith = mix(g1, g2, uGradientMix);
  vec3 ambTop = mix(uAmbient, zenith, uMs.w) * uAmb.x;
  vec3 ambBot = mix(uAmbient, uBounce, uMs.w) * uAmb.y;
  vec3 S = vec3(0.0);
  float T = 1.0;
  float wsum = 0.0;
  float dsum = 0.0;
  vec2 hHigh = fxSlab(uCamera, dir, vec3(-1e7, uHigh.x, -1e7), vec3(1e7, uHigh.y, 1e7));
  float nHigh = max(hHigh.x, 0.0);
  float fHigh = min(min(hHigh.y, solid), uScale.w);
  float nearest = nHigh;
  float steps = uHigh.z;
  // The debug views (uniform branches): the weather (cut, opacity), the holes, the kind, the distance.
  if (uNear.w > 0.5) {
    vec3 at = uCamera + dir * (fHigh > nHigh ? nHigh : 0.0);
    vec4 w = texture(uWeather, (at.xz - uWin.xy) / uWin.z);
    vec3 view = uNear.w < 1.5 ? vec3(1.0 - w.r, w.b, w.a) : uNear.w < 2.5 ? vec3(holeAt(uCamera + dir * max(nHigh, 0.0), 0), holeAt(at, 1), 0.0) : uNear.w < 3.5 ? vec3(uKind.x, uKind.y, uKind.z * 0.5) : vec3(nHigh / max(uScale.w, 1.0));
    oCloud = vec4(view, 0.0);
    oDist = vec4(nHigh, 0.0, 0.0, 1.0);
    return;
  }
  // The low deck and the high slab, nearer first, through one call site in a loop of two: the march's body is the
  // program's bulk, and three call sites built it in three times (the wave's Start check measured the cost of that).
  bool lowOn = uLow.z > 0.5;
  float nLow = 0.0;
  float fLow = 0.0;
  if (lowOn) {
    vec2 hLow = fxSlab(uCamera, dir, vec3(-1e7, uLow.x, -1e7), vec3(1e7, uLow.y, 1e7));
    nLow = max(hLow.x, 0.0);
    fLow = min(min(hLow.y, solid), uLow.w);
    if (fLow > nLow) nearest = min(nearest, nLow);
  }
  bool lowFirst = lowOn && nLow <= nHigh;
  for (int k = 0; k < 2; k++) {
    int slab = (k == 0) == lowFirst ? 0 : 1;
    if (slab == 0 && !lowOn) continue;
    marchDeck(dir, slab == 0 ? nLow : nHigh, slab == 0 ? fLow : fHigh, slab == 0 ? uLow.z : steps, slab, cosT, jitter, ambTop, ambBot, S, T, wsum, dsum);
  }
  // The scene's fog, a share of it, over the decks: they were sheets the fog never touched, and the whole of it drew a
  // rain's deck as fog-coloured silhouettes.
  float fd = uFogDensity * uAmb.z;
  float haze = clamp(1.0 - exp(-fd * fd * nearest * nearest), 0.0, 1.0);
  S = mix(S, uFogColor * (1.0 - T), haze);
  vec4 o = vec4(max(S, vec3(0.0)), clamp(T, 0.0, 1.0));
  if (any(isnan(o)) || any(isinf(o))) o = vec4(0.0, 0.0, 0.0, 1.0);
  oCloud = o;
  float dist = wsum > 1e-6 ? dsum / wsum : uScale.w;
  vec4 od = vec4(dist, 0.0, 0.0, 1.0);
  if (any(isnan(od)) || any(isinf(od))) od = vec4(uScale.w, 0.0, 0.0, 1.0);
  oDist = od;
}
`;

/**
 * The history: this frame's march blended into last frame's, reprojected through last frame's view at the in-scatter
 * weighted distance (a sky pixel has no scene depth to reproject by), held to the current 3×3 neighbourhood, reset on a
 * cut.
 */
const RESOLVE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uCurrent;
uniform sampler2D uDist;
uniform sampler2D uHistory;
uniform vec2 uTanHalfFov;
uniform mat3 uViewToWorld;
uniform vec3 uCamera;
uniform mat4 uPrevViewProj;
uniform float uBlend;
uniform float uCut;
${FX_VIEW_POS}
void main() {
  vec4 cur = texture(uCurrent, vUv);
  if (uCut > 0.5) { gl_FragColor = cur; return; }
  vec2 ts = 1.0 / vec2(textureSize(uCurrent, 0));
  vec4 mn = cur;
  vec4 mx = cur;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec4 s = texture(uCurrent, vUv + vec2(float(i), float(j)) * ts);
      mn = min(mn, s);
      mx = max(mx, s);
    }
  }
  vec3 dir = normalize(uViewToWorld * fxViewPos(vUv, 1.0, uTanHalfFov));
  float dist = texture(uDist, vUv).r;
  vec4 clip = uPrevViewProj * vec4(uCamera + dir * dist, 1.0);
  vec2 prev = clip.xy / max(clip.w, 1e-6) * 0.5 + 0.5;
  if (clip.w <= 0.0 || prev.x < 0.0 || prev.y < 0.0 || prev.x > 1.0 || prev.y > 1.0) { gl_FragColor = cur; return; }
  vec4 hist = clamp(texture(uHistory, prev), mn, mx);
  vec4 o = mix(hist, cur, uBlend);
  if (any(isnan(o)) || any(isinf(o))) o = cur;
  gl_FragColor = o;
}
`;

/**
 * The composite through an upsample of the march's own size (the clouds' lesson: never `fxHalfTaps`, which is for a
 * buffer at exactly half the screen), each of the four taps weighted by how near its own depth is to this pixel's, both
 * in metres: `scene · T + inscatter`.
 */
const COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uClouds;
uniform sampler2D uDepthHalf;
uniform sampler2D uDepthFull;
uniform vec2 uNearFar;
${FX_LINEARIZE}
void main() {
  vec4 scene = texture(uScene, vUv);
  vec2 cs = vec2(textureSize(uClouds, 0));
  vec2 f = vUv * cs - 0.5;
  ivec2 b = ivec2(floor(f));
  vec2 t = f - vec2(b);
  ivec2 hi = ivec2(cs) - 1;
  ivec2 t00 = clamp(b, ivec2(0), hi);
  ivec2 t10 = clamp(b + ivec2(1, 0), ivec2(0), hi);
  ivec2 t01 = clamp(b + ivec2(0, 1), ivec2(0), hi);
  ivec2 t11 = clamp(b + ivec2(1, 1), ivec2(0), hi);
  vec4 w = vec4((1.0 - t.x) * (1.0 - t.y), t.x * (1.0 - t.y), (1.0 - t.x) * t.y, t.x * t.y);
  float mine = fxViewZ(texture(uDepthFull, vUv).r, uNearFar.x, uNearFar.y);
  vec4 dz = vec4(
    texture(uDepthHalf, (vec2(t00) + 0.5) / cs).r,
    texture(uDepthHalf, (vec2(t10) + 0.5) / cs).r,
    texture(uDepthHalf, (vec2(t01) + 0.5) / cs).r,
    texture(uDepthHalf, (vec2(t11) + 0.5) / cs).r);
  vec4 ww = w / (abs(dz - vec4(mine)) * 0.05 + 1e-3);
  float sum = ww.x + ww.y + ww.z + ww.w;
  vec4 c = (texelFetch(uClouds, t00, 0) * ww.x + texelFetch(uClouds, t10, 0) * ww.y + texelFetch(uClouds, t01, 0) * ww.z + texelFetch(uClouds, t11, 0) * ww.w) / max(sum, 1e-5);
  vec4 o = vec4(scene.rgb * clamp(c.a, 0.0, 1.0) + max(c.rgb, vec3(0.0)), scene.a);
  if (any(isnan(o)) || any(isinf(o))) o = vec4(0.0, 0.0, 0.0, 1.0);
  gl_FragColor = o;
}
`;

/**
 * The march with the low deck compiled out (the wave's Start: carrying the low deck's branch while it is off measured 28
 * to 48% over this text in a rain sky on both backends, past the design's 15%), drawn on every frame the low deck does
 * not draw, its switch off or no wet overcast; built in the warm beside the one program and sharing its uniform objects.
 */
const MARCH_HIGH_FRAGMENT = MARCH_FRAGMENT.split('uLow.z > 0.5').join('false');

/** Every fragment shader of the clouds, for the scanner (`airShaders.test.ts`). */
export const AIR_CLOUD_FRAGMENTS: Readonly<Record<string, string>> = {
  weather: WEATHER_FRAGMENT,
  lowWind: LOW_WIND_FRAGMENT,
  holes: HOLE_FRAGMENT,
  march: MARCH_FRAGMENT,
  marchHigh: MARCH_HIGH_FRAGMENT,
  resolve: RESOLVE_FRAGMENT,
  composite: COMPOSITE_FRAGMENT,
};

/** The debug views a uniform branch of the march draws (`clouds({ view })`). */
export const CLOUD_VIEWS = ['weather', 'holes', 'kind', 'distance'] as const;

function target(name: string, type: THREE.TextureDataType, format: THREE.AnyPixelFormat, filter: THREE.MagnificationTextureFilter, count = 1, wrap: THREE.Wrapping = THREE.ClampToEdgeWrapping): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(1, 1, { type, format, depthBuffer: false, stencilBuffer: false, minFilter: filter, magFilter: filter, generateMipmaps: false, wrapS: wrap, wrapT: wrap, count } as THREE.RenderTargetOptions);
  for (let i = 0; i < t.textures.length; i++) {
    t.textures[i].name = count > 1 ? `${name}.${i}` : name;
    t.textures[i].wrapS = wrap;
    t.textures[i].wrapT = wrap;
  }
  return t;
}

/** A 1×1 transparent picture a weather slot binds where its image has none (never the sky's white stand-in). */
function clearPicture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
  t.name = 'fx.airClouds.nopicture';
  t.needsUpdate = true;
  return t;
}

/** A 1×1 3D stand-in a volume sampler binds before the noise arrives (never null: a null sampler drops the draw). */
function noVolume(): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, 1);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.name = 'fx.airClouds.novolume';
  t.needsUpdate = true;
  return t;
}

/** The pass's own numbers, taken from the settings in `setSize` (never read off the settings in a frame). */
interface CloudsQuality {
  resolution: number;
  amount: number;
  history: boolean;
  on: boolean;
}

export class AirCloudsPass implements FxPass {
  readonly id = 'airClouds' as const;
  readonly timerLabel = 'pass:airClouds';
  private readonly feed: AirCloudsFeed;
  private readonly weatherMat: THREE.ShaderMaterial;
  private readonly lowWindMat: THREE.ShaderMaterial;
  private readonly holeMat: THREE.ShaderMaterial;
  private readonly marchMat: THREE.ShaderMaterial;
  /** The march with the low deck compiled out, worn whenever the low deck does not draw (its uniforms the march's own). */
  private readonly marchHighMat: THREE.ShaderMaterial;
  private readonly resolveMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;
  private readonly weatherQuad: THREE.Mesh;
  private readonly lowWindQuad: THREE.Mesh;
  private readonly holeQuad: THREE.Mesh;
  private readonly marchQuad: THREE.Mesh;
  private readonly marchHighQuad: THREE.Mesh;
  private readonly resolveQuad: THREE.Mesh;
  private readonly compositeQuad: THREE.Mesh;
  private readonly weather: THREE.WebGLRenderTarget;
  private readonly lowWind: THREE.WebGLRenderTarget;
  private readonly holes: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly current: THREE.WebGLRenderTarget;
  private readonly histories: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly noPicture: THREE.DataTexture;
  private readonly noNoise: THREE.Data3DTexture;
  private readonly debug: readonly FxDebugTexture[];
  private readonly q: CloudsQuality = { resolution: 0.25, amount: 1, history: true, on: false };
  private width = 1;
  private height = 1;
  private frame = 0;
  private historyValid = false;
  /** Whether the hole field has been drawn since its targets were made (the first tick clears it whole). */
  private holesValid = false;
  /** The debug view the march draws (0 none, 1 the weather, 2 the holes, 3 the kind, 4 the distance). */
  view = 0;
  /** What the last frame did, for the console. */
  last = { drew: false, size: [0, 0] as [number, number], steps: 0, history: false, weather: 0, lowDeck: false, tick: false, ticks: 0 };

  constructor(feed: AirCloudsFeed) {
    this.feed = feed;
    this.noPicture = clearPicture();
    this.noNoise = noVolume();
    const plain = { vertexShader: FX_FULLSCREEN_VERTEX, blending: THREE.NoBlending, toneMapped: false, depthTest: false, depthWrite: false };
    const W = feed.weatherU;
    this.weatherMat = new THREE.ShaderMaterial({
      ...plain,
      name: 'fx.airClouds.weather',
      glslVersion: THREE.GLSL3,
      fragmentShader: WEATHER_FRAGMENT,
      uniforms: { ...W, uPicB0: { value: this.noPicture }, uPicB1: { value: this.noPicture }, uPicT0: { value: this.noPicture }, uPicT1: { value: this.noPicture } },
    });
    this.lowWindMat = new THREE.ShaderMaterial({ ...plain, name: 'fx.airClouds.lowWind', fragmentShader: LOW_WIND_FRAGMENT, uniforms: { ...feed.lowWindU } });
    const HU = feed.holeU;
    this.holeMat = new THREE.ShaderMaterial({ ...plain, name: 'fx.airClouds.holes', fragmentShader: HOLE_FRAGMENT, uniforms: { ...HU, uPrev: { value: null } } });
    const M = feed.marchU;
    this.marchMat = new THREE.ShaderMaterial({
      ...plain,
      name: 'fx.airClouds.march',
      glslVersion: THREE.GLSL3,
      fragmentShader: MARCH_FRAGMENT,
      uniforms: {
        ...M,
        uDepth: { value: null },
        uBase: { value: this.noNoise },
        uDetail: { value: this.noNoise },
        uWeather: { value: null },
        uWeatherWind: { value: null },
        uLowWind: { value: null },
        uHoles: { value: null },
        // The dome's own uniform objects are put in these places by reference whenever a sky is there (`bindDome`).
        uGradient: { value: this.noPicture },
        uGradient2: { value: this.noPicture },
        uTime: { value: 0.5 },
        uHasGradient: { value: 0 },
        uHasGradient2: { value: 0 },
        uGradientMix: { value: 0 },
        uClear: { value: new THREE.Color(0.5, 0.55, 0.6) },
        uTanHalfFov: { value: new THREE.Vector2(1, 1) },
        uFar: { value: 9000 },
        uViewToWorld: { value: new THREE.Matrix3() },
        uCamera: { value: new THREE.Vector3() },
        uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uFogColor: { value: new THREE.Color() },
        uFogDensity: { value: 0 },
        uFrame: { value: 0 },
      },
    });
    // The same uniform objects by reference (whatever the feed, the frame or `bindDome` writes into one, the other reads).
    this.marchHighMat = new THREE.ShaderMaterial({ ...plain, name: 'fx.airClouds.marchHigh', glslVersion: THREE.GLSL3, fragmentShader: MARCH_HIGH_FRAGMENT });
    this.marchHighMat.uniforms = this.marchMat.uniforms;
    this.resolveMat = new THREE.ShaderMaterial({
      ...plain,
      name: 'fx.airClouds.resolve',
      fragmentShader: RESOLVE_FRAGMENT,
      uniforms: {
        uCurrent: { value: null },
        uDist: { value: null },
        uHistory: { value: null },
        uTanHalfFov: this.marchMat.uniforms.uTanHalfFov,
        uViewToWorld: this.marchMat.uniforms.uViewToWorld,
        uCamera: this.marchMat.uniforms.uCamera,
        uPrevViewProj: { value: new THREE.Matrix4() },
        uBlend: { value: AIR_TUNE.clouds.history },
        uCut: { value: 1 },
      },
    });
    this.compositeMat = new THREE.ShaderMaterial({
      ...plain,
      name: 'fx.airClouds.composite',
      fragmentShader: COMPOSITE_FRAGMENT,
      uniforms: { uScene: { value: null }, uClouds: { value: null }, uDepthHalf: { value: null }, uDepthFull: { value: null }, uNearFar: { value: new THREE.Vector2(0.05, 9000) } },
    });
    this.weatherQuad = createFxQuad(this.weatherMat);
    this.lowWindQuad = createFxQuad(this.lowWindMat);
    this.holeQuad = createFxQuad(this.holeMat);
    this.marchQuad = createFxQuad(this.marchMat);
    this.marchHighQuad = createFxQuad(this.marchHighMat);
    this.resolveQuad = createFxQuad(this.resolveMat);
    this.compositeQuad = createFxQuad(this.compositeMat);
    this.weather = target('fx.airClouds.weather', THREE.HalfFloatType, THREE.RGBAFormat, THREE.LinearFilter, 2);
    this.lowWind = target('fx.airClouds.lowWind', THREE.HalfFloatType, THREE.RGBAFormat, THREE.LinearFilter);
    // The hole field is float32 (rule 9: a hole filling over 45 s on a 10 Hz tick moves a few half-float steps a tick) and
    // toroidal (repeat), its size fixed.
    this.holes = [target('fx.airClouds.holes.a', THREE.FloatType, THREE.RGFormat, THREE.LinearFilter, 1, THREE.RepeatWrapping), target('fx.airClouds.holes.b', THREE.FloatType, THREE.RGFormat, THREE.LinearFilter, 1, THREE.RepeatWrapping)];
    this.current = target('fx.airClouds.march', THREE.HalfFloatType, THREE.RGBAFormat, THREE.LinearFilter, 2);
    this.histories = [target('fx.airClouds.history.a', THREE.HalfFloatType, THREE.RGBAFormat, THREE.LinearFilter), target('fx.airClouds.history.b', THREE.HalfFloatType, THREE.RGBAFormat, THREE.LinearFilter)];
    this.lowWind.setSize(256, 256);
    const hs = 512;
    this.holes[0].setSize(hs, hs);
    this.holes[1].setSize(hs, hs);
    this.weather.setSize(512, 512);
    const holes = this.holes;
    this.debug = [
      { name: 'inscatter', texture: this.current.textures[0], channels: 'rgb' },
      { name: 'clear', texture: this.current.textures[0], channels: 'a' },
      { name: 'distance', texture: this.current.textures[1], channels: 'r', scale: 1 / 26000 },
      { name: 'weather', texture: this.weather.textures[0], channels: 'rgb' },
      { name: 'wind', texture: this.weather.textures[1], channels: 'rgb', scale: 1 / 20 },
      { name: 'lowWind', texture: this.lowWind.texture, channels: 'rgb', scale: 1 / 20 },
      {
        name: 'holes',
        channels: 'rgb',
        // The field swaps between its pair each tick, so it is read where it stands now.
        get texture(): THREE.Texture | null {
          return holes[0].texture;
        },
      },
    ];
  }

  debugTextures(): readonly FxDebugTexture[] {
    return this.debug;
  }

  /**
   * The noise volumes uploaded to the card (`initTexture`), inside the warm and never on a live frame: until this is
   * called the pass refuses ("no noise volumes"). Answers the milliseconds the upload took on the processor.
   */
  uploadNoise(renderer: THREE.WebGLRenderer): number {
    const f = this.feed;
    if (!f.base || !f.detail) return 0;
    const t0 = performance.now();
    renderer.initTexture(f.base);
    renderer.initTexture(f.detail);
    // The session's: the renderer is one for the session, so a chain the Effects switch builds later finds them up.
    f.noiseUploaded = true;
    return performance.now() - t0;
  }

  /** Whether the noise volumes are on the card (the feed's, for the session). */
  get noiseUploaded(): boolean {
    return this.feed.noiseUploaded;
  }

  /**
   * The dome's seven uniform objects put in the march's places by reference (the design's decision 102: its gradients,
   * their flags, their mix, the hour and the clear colour, so a row with no gradient lights the decks by the dome's own
   * clear colour, never white). A uniform object's place is read at every upload, so a sky that changes rebinds here.
   */
  bindDome(dome: Readonly<Record<'uGradient' | 'uGradient2' | 'uGradientMix' | 'uTime' | 'uHasGradient' | 'uHasGradient2' | 'uClear', THREE.IUniform>> | null): void {
    if (!dome) return;
    const u = this.marchMat.uniforms;
    if (u.uGradient === dome.uGradient) return;
    u.uGradient = dome.uGradient;
    u.uGradient2 = dome.uGradient2;
    u.uGradientMix = dome.uGradientMix;
    u.uTime = dome.uTime;
    u.uHasGradient = dome.uHasGradient;
    u.uHasGradient2 = dome.uHasGradient2;
    u.uClear = dome.uClear;
  }

  /** The dome's uniform objects the march reads now (the tests' and the console's). */
  domeBound(): Record<string, THREE.IUniform> {
    const u = this.marchMat.uniforms;
    return { uGradient: u.uGradient, uGradient2: u.uGradient2, uGradientMix: u.uGradientMix, uTime: u.uTime, uHasGradient: u.uHasGradient, uHasGradient2: u.uHasGradient2, uClear: u.uClear };
  }

  /** What the pass holds now, for the console. */
  report(): Record<string, unknown> {
    return { ...this.q, noise: this.noiseUploaded, size: [this.current.width, this.current.height], weather: this.weather.width, last: { ...this.last } };
  }

  /**
   * What `enabled` asks, without needing a frame: the game reads it to know whether to take the sky's sheets down, which
   * it must decide before the scene is drawn. False whenever the pass would refuse (`reason`'s every refusal, the camera
   * in a building's view and under water included, handed the same verdicts the frame's context is), so the sheets are
   * never down with nothing drawn for them.
   */
  wouldDraw(space: boolean, inside: boolean, portalView = false, submerged = false): boolean {
    return this.q.on && this.noiseUploaded && this.q.amount > 0 && !space && !portalView && !inside && !submerged && this.feed.why === null;
  }

  enabled(ctx: FxFrameContext): boolean {
    return this.reason(ctx) === null;
  }

  /** Why it does not draw, or null: the first reason that holds. Allocates nothing (its answers are literals or the feed's). */
  reason(ctx: FxFrameContext): string | null {
    if (!this.q.on) return 'the volumetrics master is off';
    if (!(this.q.amount > 0)) return 'the clouds over the picture are at 0';
    if (!this.noiseUploaded) return 'no noise volumes (npm run swg -- clouds assets-private), or not yet uploaded';
    if (ctx.space) return 'in space there is no sky to put cloud in';
    if (ctx.portalView) return 'the camera is in a building';
    if (ctx.inside) return 'the player is in a building';
    if (ctx.cameraSubmerged) return 'the camera is under water';
    return this.feed.why;
  }

  needs(): readonly FxProductId[] {
    return NEEDS;
  }

  prepare(): void {}

  setSize(width: number, height: number, settings: FxSettings): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const s = settings as Partial<FxSettings>;
    const r = s.volCloudsResolution;
    this.q.resolution = r === 0.5 || r === 1 ? r : 0.25;
    const amount = Number(s.volCloudsAmount);
    this.q.amount = Math.max(0, Math.min(4, Number.isFinite(amount) ? amount : 1));
    this.q.history = s.volCloudsHistory !== false;
    this.q.on = s.volumetrics === true;
    const w = Math.max(1, Math.round(this.width * this.q.resolution));
    const h = Math.max(1, Math.round(this.height * this.q.resolution));
    if (this.current.width !== w || this.current.height !== h) {
      this.current.setSize(w, h);
      for (const t of this.histories) t.setSize(w, h);
      this.historyValid = false;
    }
  }

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    const f = this.feed;
    const g = ctx.renderer;
    const cam = ctx.camera;
    // The weather map at the texels the setting asks (class T: the target resized, nothing compiled).
    const res = VOL_TUNE.cloudsWeather;
    if (this.weather.width !== res) this.weather.setSize(res, res);
    // The pictures for this frame, the stand-in where none is loaded; let go again after the draw.
    const wu = this.weatherMat.uniforms;
    const p = f.pictures;
    const np = this.noPicture;
    wu.uPicB0.value = p[0] ?? np;
    wu.uPicB1.value = p[1] ?? np;
    wu.uPicT0.value = p[2] ?? np;
    wu.uPicT1.value = p[3] ?? np;
    g.setRenderTarget(this.weather);
    g.render(this.weatherQuad, FX_CAMERA);
    wu.uPicB0.value = np;
    wu.uPicB1.value = np;
    wu.uPicT0.value = np;
    wu.uPicT1.value = np;
    // The low deck's wind, while the low deck draws and the smear runs (its switch on and the decks' packs written).
    const M = f.marchU;
    const low = M.uLow.value.z > 0.5;
    if (low && f.smearing) {
      g.setRenderTarget(this.lowWind);
      g.render(this.lowWindQuad, FX_CAMERA);
    }
    // The hole field's tick, when one is owed (the first one clears the whole field).
    this.last.tick = false;
    if (VOL_TUNE.cloudsHoles) {
      const HU = f.holeU;
      if (!this.holesValid) f.holes.reset();
      if (!this.holesValid) f.holes.ticksOwed = Math.max(1, f.holes.ticksOwed);
      if (f.holes.prepareTick(HU.uH.value, HU.uSqL.value, HU.uSqH.value, HU.uMove.value, HU.uCap.value)) {
        this.last.ticks = f.holes.ticksOwed;
        this.holeMat.uniforms.uPrev.value = this.holes[0].texture;
        g.setRenderTarget(this.holes[1]);
        g.render(this.holeQuad, FX_CAMERA);
        const a = this.holes[0];
        this.holes[0] = this.holes[1];
        this.holes[1] = a;
        f.holes.drawn();
        this.holesValid = true;
        this.last.tick = true;
      }
    }
    // The march.
    const u = this.marchMat.uniforms;
    (u.uTanHalfFov.value as THREE.Vector2).copy(ctx.tanHalfFov);
    u.uFar.value = ctx.far;
    (u.uViewToWorld.value as THREE.Matrix3).setFromMatrix4(cam.matrixWorld);
    (u.uCamera.value as THREE.Vector3).copy(ctx.cameraPos);
    const e = cam.matrixWorld.elements;
    (u.uCamFwd.value as THREE.Vector3).set(-e[8], -e[9], -e[10]).normalize();
    u.uDepth.value = ctx.products.linearDepthHalf ?? null;
    u.uBase.value = f.base ?? this.noNoise;
    u.uDetail.value = f.detail ?? this.noNoise;
    u.uWeather.value = this.weather.textures[0];
    u.uWeatherWind.value = this.weather.textures[1];
    u.uLowWind.value = this.lowWind.texture;
    u.uHoles.value = this.holes[0].texture;
    const sun = ctx.sun;
    if (sun) {
      (u.uSunDir.value as THREE.Vector3).copy(sun.dir).normalize();
      (u.uSunColor.value as THREE.Color).copy(sun.color).multiplyScalar(Math.max(0, sun.intensity));
    } else (u.uSunColor.value as THREE.Color).setRGB(0, 0, 0);
    (u.uFogColor.value as THREE.Color).copy(ctx.fogColor);
    u.uFogDensity.value = ctx.fogDensity;
    // The amount and the view ride the near-fade record (one kept vector), written after the feed's numbers.
    M.uNear.value.z = this.q.amount;
    M.uNear.value.w = this.view;
    // Holes off: the march takes none (a uniform branch), the field kept as it was.
    if (!VOL_TUNE.cloudsHoles) M.uHoleOn.value.set(0, 0, 0, 0);
    this.frame = (this.frame + 1) % 16;
    u.uFrame.value = this.frame;
    // The low deck's own program only while it draws (both built in the warm, each on a quad of its own).
    g.setRenderTarget(this.current);
    g.render(M.uLow.value.z > 0.5 ? this.marchQuad : this.marchHighQuad, FX_CAMERA);
    let shown: THREE.Texture = this.current.textures[0];
    if (this.q.history && this.view === 0) {
      const r = this.resolveMat.uniforms;
      const prev = this.histories[0];
      const next = this.histories[1];
      r.uCurrent.value = this.current.textures[0];
      r.uDist.value = this.current.textures[1];
      r.uHistory.value = prev.texture;
      (r.uPrevViewProj.value as THREE.Matrix4).copy(ctx.prevViewProj);
      r.uBlend.value = AIR_TUNE.clouds.history;
      r.uCut.value = ctx.cameraCut || !this.historyValid ? 1 : 0;
      g.setRenderTarget(next);
      g.render(this.resolveQuad, FX_CAMERA);
      this.histories[0] = next;
      this.histories[1] = prev;
      this.historyValid = true;
      shown = next.texture;
    } else this.historyValid = false;
    const c = this.compositeMat.uniforms;
    c.uScene.value = input.texture;
    c.uClouds.value = shown;
    c.uDepthHalf.value = ctx.products.linearDepthHalf ?? null;
    c.uDepthFull.value = ctx.depth;
    (c.uNearFar.value as THREE.Vector2).set(cam.near, cam.far);
    g.setRenderTarget(output);
    g.render(this.compositeQuad, FX_CAMERA);
    this.last.drew = true;
    this.last.size[0] = this.current.width;
    this.last.size[1] = this.current.height;
    this.last.steps = M.uHigh.value.z;
    this.last.history = this.q.history;
    this.last.weather = this.weather.width;
    this.last.lowDeck = low;
    return true;
  }

  /**
   * The march's own picture round a point of the screen (`u`, `v` from the bottom left, 0 to 1), read back (console only,
   * a GPU sync, never in a frame): the in-scatter's luminance and the transmittance, each the mean of a 3×3 block.
   */
  sampleAt(r: THREE.WebGLRenderer, u: number, v: number): { inscatter: number; clear: number } | null {
    if (!this.last.drew || !(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
    const t = this.current;
    const n = 3;
    const x = Math.max(0, Math.min(t.width - n, Math.round(u * t.width) - 1));
    const y = Math.max(0, Math.min(t.height - n, Math.round(v * t.height) - 1));
    const data = new Uint16Array(n * n * 4);
    try {
      r.readRenderTargetPixels(t, x, y, n, n, data, undefined, 0);
    } catch {
      return null;
    }
    let lum = 0;
    let clear = 0;
    for (let i = 0; i < n * n; i++) {
      lum += 0.2126 * THREE.DataUtils.fromHalfFloat(data[i * 4]) + 0.7152 * THREE.DataUtils.fromHalfFloat(data[i * 4 + 1]) + 0.0722 * THREE.DataUtils.fromHalfFloat(data[i * 4 + 2]);
      clear += THREE.DataUtils.fromHalfFloat(data[i * 4 + 3]);
    }
    return { inscatter: Math.round((lum / (n * n)) * 10000) / 10000, clear: Math.round((clear / (n * n)) * 10000) / 10000 };
  }

  /** The hole field's value at a world point's texel in each channel (console only, a read-back). */
  holeAt(r: THREE.WebGLRenderer, x: number, z: number): { low: number; high: number } | null {
    const f = this.feed;
    const size = AIR_TUNE.holes.size;
    const t = this.holes[0];
    const read = (ch: 0 | 1, dx: number, dz: number): number => {
      const u = (x + dx) / size;
      const w = (z + dz) / size;
      const tx = Math.floor((u - Math.floor(u)) * t.width);
      const tz = Math.floor((w - Math.floor(w)) * t.height);
      const b = new Float32Array(4);
      try {
        r.readRenderTargetPixels(t, Math.min(t.width - 1, tx), Math.min(t.height - 1, tz), 1, 1, b);
      } catch {
        return NaN;
      }
      return ch === 0 ? b[0] : b[1];
    };
    return { low: read(0, f.dlx, f.dlz), high: read(1, f.dhx, f.dhz) };
  }

  /**
   * The wave's Start check, the console's only (`clouds({ bench: true })`): the march as one program, its smear and low
   * deck uniform branches off, against the same text with both compiled out (what splitting them into materials a mode
   * would draw), each timed on the card over `n` draws into the march's own target with the frame's own uniforms, and each
   * one's cold compile and link timed on the processor. Builds two programs of its own (a console tool, never a frame's)
   * and disposes them; null where the browser gives no GPU timer query.
   */
  async benchShapes(r: THREE.WebGLRenderer, n = 120): Promise<Record<string, unknown>> {
    const gl = r.getContext() as WebGL2RenderingContext;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    const M = this.feed.marchU;
    const was = { smear: M.uSmear.value.x, low: M.uLow.value.z };
    const out = (text: string, name: string): THREE.ShaderMaterial => {
      const m = this.marchMat.clone();
      m.uniforms = this.marchMat.uniforms;
      m.fragmentShader = text;
      m.name = name;
      return m;
    };
    const noSmear = (t: string) => t.split('uSmear.x > 0.5').join('false');
    const noLow = (t: string) => t.split('uLow.z > 0.5').join('false');
    // The one program first; the last variant, both compiled out, is what the over is measured against.
    const variants: [string, THREE.ShaderMaterial][] = [
      ['one program, its branches off', out(MARCH_FRAGMENT + '\n// bench one', 'fx.airClouds.bench.one')],
      ['the low deck compiled out', out(noLow(MARCH_FRAGMENT) + '\n// bench low', 'fx.airClouds.bench.low')],
      ['the smear compiled out', out(noSmear(MARCH_FRAGMENT) + '\n// bench smear', 'fx.airClouds.bench.smear')],
      ['the smear and the low deck compiled out', out(noLow(noSmear(MARCH_FRAGMENT)) + '\n// bench split', 'fx.airClouds.bench.split')],
    ];
    const quad = createFxQuad(variants[0][1]);
    const colds: number[] = [];
    // Each variant's timings over the rounds, the order turned every round (the card's clock and the driver's caches favour
    // whichever runs second), and the median of each kept.
    const times: number[][] = variants.map(() => []);
    const rounds = 5;
    M.uSmear.value.x = 0;
    M.uLow.value.z = 0;
    const prev = r.getRenderTarget();
    try {
      for (let v = 0; v < variants.length; v++) {
        quad.material = variants[v][1];
        // Cold: compile and link, then one draw finished.
        const t0 = performance.now();
        r.setRenderTarget(this.current);
        r.compile(quad, FX_CAMERA);
        r.render(quad, FX_CAMERA);
        gl.finish();
        colds.push(performance.now() - t0);
      }
      if (ext) {
        for (let k = 0; k < rounds; k++) {
          for (let j = 0; j < variants.length; j++) {
            const v = k % 2 === 0 ? j : variants.length - 1 - j;
            quad.material = variants[v][1];
            r.setRenderTarget(this.current);
            const q = gl.createQuery();
            if (!q) continue;
            gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
            for (let i = 0; i < n; i++) r.render(quad, FX_CAMERA);
            gl.endQuery(ext.TIME_ELAPSED_EXT);
            for (let w = 0; w < 200; w++) {
              await new Promise((res) => setTimeout(res, 16));
              if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
            }
            if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT)) times[v].push((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6 / n);
            gl.deleteQuery(q);
          }
        }
      }
    } finally {
      r.setRenderTarget(prev);
      M.uSmear.value.x = was.smear;
      M.uLow.value.z = was.low;
      for (const [, m] of variants) m.dispose();
    }
    const median = (xs: number[]): number | null => {
      if (!xs.length) return null;
      const s = [...xs].sort((p, q) => p - q);
      return s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]);
    };
    const meds = times.map(median);
    const base = meds[meds.length - 1];
    const r5 = (x: number) => Math.round(x * 100000) / 100000;
    const pct = (x: number | null) => (x !== null && base !== null && base > 0 ? Math.round((x / base - 1) * 1000) / 10 : null);
    const rows = variants.map(([label], v) => ({ variant: label, coldMs: Math.round(colds[v] * 10) / 10, gpuMsADraw: meds[v] === null ? null : r5(meds[v] as number), over: pct(meds[v]), rounds: times[v].map(r5) }));
    return { size: [this.current.width, this.current.height], draws: n, rounds, rows, over: pct(meds[0]), note: ext ? "each over is that variant's share past both compiled out, per cent, each variant's median over the rounds with the order turned every round" : 'no GPU timer query in this browser: the cold links alone' };
  }

  /** Every material for the warm-up: the seven programs, each where it draws (`target`: every one draws into a target of its own). */
  materials(): FxWarmItem[] {
    return [
      { material: this.weatherMat, object: this.weatherQuad, where: 'target' },
      { material: this.lowWindMat, object: this.lowWindQuad, where: 'target' },
      { material: this.holeMat, object: this.holeQuad, where: 'target' },
      { material: this.marchMat, object: this.marchQuad, where: 'target' },
      { material: this.marchHighMat, object: this.marchHighQuad, where: 'target' },
      { material: this.resolveMat, object: this.resolveQuad, where: 'target' },
      { material: this.compositeMat, object: this.compositeQuad, where: 'target' },
    ];
  }

  dispose(): void {
    this.weather.dispose();
    this.lowWind.dispose();
    for (const t of this.holes) t.dispose();
    this.current.dispose();
    for (const t of this.histories) t.dispose();
    this.weatherMat.dispose();
    this.lowWindMat.dispose();
    this.holeMat.dispose();
    this.marchMat.dispose();
    this.marchHighMat.dispose();
    this.resolveMat.dispose();
    this.compositeMat.dispose();
    this.noPicture.dispose();
    this.noNoise.dispose();
  }
}
