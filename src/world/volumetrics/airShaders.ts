// Every GLSL string of the moving air's own passes, in one file so the scanner (`tools/swg/tests/glslScan.ts`) reads
// them all. Ported from the handoff's land demo (`land.html:420-664`) to three 0.185 by the design's §6: every pass is
// a material on the shared triangle, `NoBlending`, `toneMapped: false`, no depth test or write; velocity is m/s;
// every radius, the vorticity and every height test are in metres; no grid, dust or light size is ever in the text
// (they are uniforms, rule 10), and the `MAX_*` numbers below are loop bounds and array sizes only; every output is
// made finite before it is written, since a NaN pixel becomes a black box once the bloom spreads it.
//
// **Out of the window is the inflow, never nought** (§2.2): a velocity sample outside reads the wind times the slab's
// share, a dust sample the storm's dust. **The atlas** (§2.3): every stage is one draw over the whole atlas, each tile a
// rectangle; every read is clamped half a texel inside its own tile before the inflow rule is asked, so a backtrace near
// a seam never blends in the neighbour. The first wave has one tile, slab 0.
//
// Pure strings and the constants they are built from, the tile program's own two colour functions among them (the dust
// takes its ground's tint by the very lines the ground is drawn with, never a copy).
import { MAX_TILES } from './airAtlas.ts';
import { DUST_BATCH, SMOKE_BATCH, SPLAT_BATCH } from './airForces.ts';
import { FOG_DIV_MOST } from './airFog.ts';
import { GROUND_DECODE_GLSL, GROUND_TINT_GLSL } from '../terrainTextures.ts';
import { LIQUID_TARGET_GLSL } from './airLiquid.ts';

/** The light pass's loop bound: no setting asks for more steps toward the sun. */
export const MAX_LIGHT_STEPS = 48;

export const AIR_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * What every solver stage shares: the atlas's tiles, the window, the obstacles, the inflow and the reads that clamp
 * inside a tile and fall back on the inflow outside the window.
 */
const ATLAS_COMMON = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uTiles[${MAX_TILES}];
uniform vec4 uTileSlab[${MAX_TILES}];
uniform int uTileCount;
uniform vec2 uAtlasSize;
uniform vec4 uWindow;
uniform sampler2D uObstacles;
uniform vec2 uWind;
uniform float uObstacleOver;
// The colour raster, whose alpha is each cell's medium byte (unknown 0, land 85, water 170, lava 255): the liquid tile's
// obstacle is every cell that is not a liquid (the fifth wave). And how many of the tiles are slabs (the liquid tile, where
// there is one, is the last), which the slabs' coupling counts over.
uniform sampler2D uMedium;
uniform int uSlabCount;

int tileOf(vec2 a) {
  for (int i = 0; i < ${MAX_TILES}; i++) {
    if (i >= uTileCount) break;
    vec4 r = uTiles[i];
    if (a.x >= r.x && a.y >= r.y && a.x <= r.x + r.z && a.y <= r.y + r.w) return i;
  }
  return 0;
}
vec2 localOf(vec2 a, int t) { vec4 r = uTiles[t]; return (a - r.xy) / r.zw; }
bool outsideOf(vec2 l) { return l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0; }
// A read inside tile t at tile-local l, clamped half a texel inside the tile before anything else.
vec2 atlasAt(vec2 l, int t) {
  vec4 r = uTiles[t];
  vec2 half_ = 0.5 / (r.zw * uAtlasSize);
  return r.xy + clamp(l, half_, 1.0 - half_) * r.zw;
}
// Whether tile t is the liquid's (its slab row's w is one).
bool liquidTile(int t) { return uTileSlab[t].w > 0.5; }
// The liquid at window place l: 0 none (land, or not known yet), 1 water, 2 lava, read off the medium byte by its middles.
int mediumAt(vec2 l) {
  float a = texture(uMedium, clamp(l, 0.0, 1.0)).a;
  return a > 0.83 ? 2 : (a > 0.5 ? 1 : 0);
}
// A solid stands over this slab's floor here: the obstacle map is in window uv, and is never solid outside it. In the
// liquid's tile the land is the solid, whatever stands on it.
float solidAt(vec2 l, int t) {
  if (outsideOf(l)) return 0.0;
  if (liquidTile(t)) return mediumAt(l) == 0 ? 1.0 : 0.0;
  return texture(uObstacles, l).r > uTileSlab[t].x + uObstacleOver ? 1.0 : 0.0;
}
vec2 inflowOf(int t) { return uWind * uTileSlab[t].z; }
vec2 velAt(sampler2D v, vec2 l, int t) {
  if (outsideOf(l)) return inflowOf(t);
  return texture(v, atlasAt(l, t)).xy;
}
vec4 finite4(vec4 v) { return (any(isnan(v)) || any(isinf(v))) ? vec4(0.0) : v; }
`;

/**
 * The liquid tile's numbers (the fifth wave, the design's §2.9), each a vector the frame writes in place: water's pull
 * toward its target and its own dissipation, lava's two (`uLiquidP`); each medium's share of the wind and of the swirl
 * (`uLiquidQ`); a push's share, a ribbon's own flow's share and the liquid's fastest (`uLiquidR`).
 */
const LIQUID_UNIFORMS = /* glsl */ `
uniform vec4 uLiquidP;
uniform vec4 uLiquidQ;
uniform vec4 uLiquidR;
// The liquid's own numbers by its medium (1 water, 2 lava; the land is the tile's solid and never asks): its pull toward
// its target, its dissipation, its share of the wind and its share of the swirl at the tile's own cell.
float liquidRelax(int medium) {
  return medium == 2 ? uLiquidP.z : uLiquidP.x;
}
float liquidDiss(int medium) {
  return medium == 2 ? uLiquidP.w : uLiquidP.y;
}
float liquidWindShare(int medium) {
  return medium == 2 ? uLiquidQ.y : uLiquidQ.x;
}
float liquidSwirl(int medium) {
  return (medium == 2 ? uLiquidQ.w : uLiquidQ.z) * uLiquidR.w;
}
// The liquid's fastest under the air's own.
float liquidCap(float cap) {
  return min(cap, uLiquidR.z);
}
// One component of the liquid's advect: the back-traced velocity v dissipated at diss, pulled toward its target at relax
// over the step dt, held to the liquid's fastest.
float liquidStep(float v, float target, float relax, float diss, float dt) {
  float lv = v / (1.0 + diss * dt);
  lv = mix(lv, target, clamp(relax * dt, 0.0, 1.0));
  return clamp(lv, -uLiquidR.z, uLiquidR.z);
}
`;

/**
 * The splat: the velocity read at the window's pending scroll (carried by this, the first pass after a move to read
 * it), plus every splat of the batch, each weighted by how far its height over the ground is from the slab's middle --
 * in the liquid's tile from its surface, times a push's share of the liquid (`uLiquidR.x`).
 */
export const SPLAT_FRAGMENT = /* glsl */ `
${ATLAS_COMMON}
${LIQUID_UNIFORMS}
uniform sampler2D uVel;
uniform vec2 uShift;
uniform vec4 uSplatA[${SPLAT_BATCH}];
uniform vec4 uSplatB[${SPLAT_BATCH}];
uniform int uSplatCount;
uniform float uReachScale;
void main() {
  int t = tileOf(vUv);
  vec2 l = localOf(vUv, t);
  vec2 v = velAt(uVel, l + uShift, t);
  bool liquid = liquidTile(t);
  float centre = liquid ? 0.0 : uTileSlab[t].y;
  float share = liquid ? uLiquidR.x : 1.0;
  for (int i = 0; i < ${SPLAT_BATCH}; i++) {
    if (i >= uSplatCount) break;
    vec4 a = uSplatA[i];
    vec4 b = uSplatB[i];
    vec2 d = l - a.xy;
    float e = dot(d, d) * a.z;
    if (e > 9.0) continue;
    float reach = max(b.z * uReachScale, 1e-3);
    float k = (centre - a.w) / reach;
    float w = exp(-k * k);
    if (w < 0.02) continue;
    v += b.xy * exp(-e) * w * share;
  }
  if (solidAt(l, t) > 0.5) v = vec2(0.0);
  gl_FragColor = finite4(vec4(v, 0.0, 1.0));
}
`;

/** The curl at a tile-local point, from the four neighbours: m/s across a texel. */
const CURL = /* glsl */ `
float curlAt(sampler2D vel, vec2 l, int t, vec2 tx) {
  float lf = velAt(vel, l - vec2(tx.x, 0.0), t).y;
  float rt = velAt(vel, l + vec2(tx.x, 0.0), t).y;
  float bt = velAt(vel, l - vec2(0.0, tx.y), t).x;
  float tp = velAt(vel, l + vec2(0.0, tx.y), t).x;
  return 0.5 * (rt - lf - tp + bt);
}
`;

/**
 * Vorticity confinement with the curl worked out inline (no curl target): the swirl is per metre (`swirlAt`), so the
 * look holds across grids; capped at the air's fastest.
 */
export const VORT_FRAGMENT = /* glsl */ `
${ATLAS_COMMON}
${LIQUID_UNIFORMS}
uniform sampler2D uVel;
// The swirl at this cell, the step and the cap, in one vector so a frame writes no number into a uniform object.
uniform vec4 uVortP;
#define uStrength uVortP.x
#define uDt uVortP.y
#define uCap uVortP.z
#define uEdge uVortP.w
${CURL}
void main() {
  int t = tileOf(vUv);
  vec2 l = localOf(vUv, t);
  vec2 tx = 1.0 / (uTiles[t].zw * uAtlasSize);
  if (solidAt(l, t) > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float c = curlAt(uVel, l, t, tx);
  float cl = curlAt(uVel, l - vec2(tx.x, 0.0), t, tx);
  float cr = curlAt(uVel, l + vec2(tx.x, 0.0), t, tx);
  float cb = curlAt(uVel, l - vec2(0.0, tx.y), t, tx);
  float ct = curlAt(uVel, l + vec2(0.0, tx.y), t, tx);
  vec2 f = 0.5 * vec2(abs(ct) - abs(cb), abs(cr) - abs(cl));
  f /= length(f) + 1e-5;
  // In the liquid's tile, each medium's own share of the swirl (lava none) at the tile's own cell, and the liquid's own fastest.
  bool liquid = liquidTile(t);
  float swirl = liquid ? liquidSwirl(mediumAt(l)) : 1.0;
  float cap = liquid ? liquidCap(uCap) : uCap;
  f *= uStrength * c * swirl;
  f.y *= -1.0;
  // None across the window's edge band: the curl there reads the held inflow outside against the air inside, and
  // confined it pumped jets along the edges that grew to the cap and filled the window (the second wave measured it).
  float edgeD = min(min(l.x, 1.0 - l.x), min(l.y, 1.0 - l.y));
  f *= smoothstep(0.0, uEdge, edgeD);
  vec2 v = velAt(uVel, l, t) + f * uDt;
  gl_FragColor = finite4(vec4(clamp(v, vec2(-cap), vec2(cap)), 0.0, 1.0));
}
`;

/** The divergence; a solid neighbour reflects what flows into it [demo `land.html:481-494`]. */
export const DIV_FRAGMENT = /* glsl */ `
${ATLAS_COMMON}
uniform sampler2D uVel;
vec2 vAt(vec2 q, int t) { return solidAt(q, t) > 0.5 ? vec2(0.0) : velAt(uVel, q, t); }
void main() {
  int t = tileOf(vUv);
  vec2 l = localOf(vUv, t);
  vec2 tx = 1.0 / (uTiles[t].zw * uAtlasSize);
  vec2 c = velAt(uVel, l, t);
  float lf = vAt(l - vec2(tx.x, 0.0), t).x;
  float rt = vAt(l + vec2(tx.x, 0.0), t).x;
  float bt = vAt(l - vec2(0.0, tx.y), t).y;
  float tp = vAt(l + vec2(0.0, tx.y), t).y;
  if (solidAt(l - vec2(tx.x, 0.0), t) > 0.5) lf = -c.x;
  if (solidAt(l + vec2(tx.x, 0.0), t) > 0.5) rt = -c.x;
  if (solidAt(l - vec2(0.0, tx.y), t) > 0.5) bt = -c.y;
  if (solidAt(l + vec2(0.0, tx.y), t) > 0.5) tp = -c.y;
  gl_FragColor = finite4(vec4(0.5 * (rt - lf + tp - bt), 0.0, 0.0, 1.0));
}
`;

/**
 * One Jacobi step of the pressure. The first of a step folds the keep in (the pressure kept between steps, times
 * `uKeep`) and carries the window's pending scroll; the rest read the last one as it stands (`uKeep` 1, no shift).
 * A solid neighbour takes this cell's own pressure; outside the window the pressure is open, nought.
 */
export const JACOBI_FRAGMENT = /* glsl */ `
${ATLAS_COMMON}
uniform sampler2D uPrs;
uniform sampler2D uDiv;
// The pressure's keep, in a vector (the frame writes its x).
uniform vec4 uJacobiP;
#define uKeep uJacobiP.x
uniform vec2 uShift;
float pAt(vec2 q, int t) {
  if (outsideOf(q)) return 0.0;
  return texture(uPrs, atlasAt(q, t)).x * uKeep;
}
float pOf(vec2 q, int t, float mine) { return solidAt(q - uShift, t) > 0.5 ? mine : pAt(q, t); }
void main() {
  int t = tileOf(vUv);
  vec2 l = localOf(vUv, t);
  vec2 tx = 1.0 / (uTiles[t].zw * uAtlasSize);
  vec2 s = l + uShift;
  float c = pAt(s, t);
  float lf = pOf(s - vec2(tx.x, 0.0), t, c);
  float rt = pOf(s + vec2(tx.x, 0.0), t, c);
  float bt = pOf(s - vec2(0.0, tx.y), t, c);
  float tp = pOf(s + vec2(0.0, tx.y), t, c);
  float div = texture(uDiv, atlasAt(l, t)).x;
  gl_FragColor = finite4(vec4((lf + rt + bt + tp - div) * 0.25, 0.0, 0.0, 1.0));
}
`;

/** The pressure's gradient taken off the velocity. */
export const GRAD_FRAGMENT = /* glsl */ `
${ATLAS_COMMON}
uniform sampler2D uPrs;
uniform sampler2D uVel;
float pOf(vec2 q, int t, float mine) {
  if (solidAt(q, t) > 0.5) return mine;
  if (outsideOf(q)) return 0.0;
  return texture(uPrs, atlasAt(q, t)).x;
}
void main() {
  int t = tileOf(vUv);
  vec2 l = localOf(vUv, t);
  vec2 tx = 1.0 / (uTiles[t].zw * uAtlasSize);
  if (solidAt(l, t) > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float c = texture(uPrs, atlasAt(l, t)).x;
  float lf = pOf(l - vec2(tx.x, 0.0), t, c);
  float rt = pOf(l + vec2(tx.x, 0.0), t, c);
  float bt = pOf(l - vec2(0.0, tx.y), t, c);
  float tp = pOf(l + vec2(0.0, tx.y), t, c);
  vec2 v = velAt(uVel, l, t) - vec2(rt - lf, tp - bt);
  gl_FragColor = finite4(vec4(v, 0.0, 1.0));
}
`;

/**
 * The gust noise: cells about 29 m carried downwind at the wind's own speed, and a finer second noise, read from a
 * noise texture rather than worked out in the loop [demo `land.html:432-442`, pitfall 18]. Needs `uNoise`, `uTime`,
 * `uGust` and `uWindow`.
 */
const GUST = /* glsl */ `
uniform sampler2D uNoise;
uniform float uNoiseTexel;
// The gusts' strength and the clock, in one vector so a frame writes no number into a uniform object.
uniform vec2 uGustTime;
#define uGust uGustTime.x
#define uTime uGustTime.y
// One lattice cell of the noise a texel of its texture: the texture repeats, so any place reads.
float noiseAt(vec2 p) { return texture(uNoise, p * uNoiseTexel).r; }
// The gust's own strength here, 0 to about 2: more under a gust cell, less in a lull.
float gustAt(vec2 w, vec2 wind) {
  float ws = length(wind);
  if (ws < 1e-4 || uGust <= 0.0) return 1.0;
  vec2 wd = wind / ws;
  float g1 = noiseAt(w * 0.035 - wd * uTime * ws * 0.035);
  float g2 = noiseAt(w * 0.09 + vec2(uTime * 0.21, -uTime * 0.13));
  return max(0.0, 1.0 + uGust * ((g1 - 0.5) * 1.9 + (g2 - 0.5) * 0.6));
}
vec2 windHere(vec2 w, vec2 wind) {
  float ws = length(wind);
  if (ws < 1e-4 || uGust <= 0.0) return wind;
  vec2 wd = wind / ws;
  float g2 = noiseAt(w * 0.09 + vec2(uTime * 0.21, -uTime * 0.13));
  float a = uGust * (g2 - 0.5) * 0.6;
  return vec2(cos(a) * wd.x - sin(a) * wd.y, sin(a) * wd.x + cos(a) * wd.y) * ws * gustAt(w, wind);
}
`;

/**
 * The air carried by itself: where did the air now here come from (a backtrace in metres), its own motion dying at
 * `uDiss` a second and pulled toward the wind -- gusts and all -- at `uRelax` a second [demo `land.html:443-453`]. From
 * the third wave the slabs share their momentum here too (the coupling, `uCouple` a second [demo `land.html:586-598`]):
 * each tile is mixed toward the mean of its neighbours' air at the same place, read from the state every tile began this
 * stage with, so the order the tiles are drawn in changes nothing.
 */
export const ADVECT_FRAGMENT = /* glsl */ `
${ATLAS_COMMON}
${GUST}
${LIQUID_UNIFORMS}
uniform sampler2D uVel;
// The liquid's own flow, m/s along x and z in window uv (a ribbon's, the fifth wave's flow raster).
uniform sampler2D uFlowR;
// The step, the dissipation, the pull toward the wind and the slabs' coupling, in one vector.
uniform vec4 uAdvectP;
#define uDt uAdvectP.x
#define uDiss uAdvectP.y
#define uRelax uAdvectP.z
#define uCouple uAdvectP.w
${LIQUID_TARGET_GLSL}
void main() {
  int t = tileOf(vUv);
  vec2 l = localOf(vUv, t);
  if (solidAt(l, t) > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 v0 = velAt(uVel, l, t);
  vec2 back = l - v0 * uDt / uWindow.z;
  vec2 w = uWindow.xy + l * uWindow.z;
  if (liquidTile(t)) {
    // The liquid's tile (the fifth wave): water pulled toward its share of the wind and lava toward stillness, either
    // toward its own flow besides (liquidTarget), each by its medium's own pull and dissipation, held to the liquid's
    // fastest; never coupled to the air's slabs.
    int m = mediumAt(l);
    float relax = liquidRelax(m);
    float diss = liquidDiss(m);
    vec2 lv = velAt(uVel, back, t);
    vec2 tg = liquidTarget(w, l, liquidWindShare(m));
    gl_FragColor = finite4(vec4(liquidStep(lv.x, tg.x, relax, diss, uDt), liquidStep(lv.y, tg.y, relax, diss, uDt), 0.0, 1.0));
    return;
  }
  vec2 v = velAt(uVel, back, t) / (1.0 + uDiss * uDt);
  v = mix(v, windHere(w, inflowOf(t)), clamp(uRelax * uDt, 0.0, 1.0));
  if (uSlabCount > 1 && uCouple > 0.0) {
    vec2 acc = vec2(0.0);
    float n = 0.0;
    if (t > 0) { acc += velAt(uVel, l, t - 1); n += 1.0; }
    if (t + 1 < uSlabCount) { acc += velAt(uVel, l, t + 1); n += 1.0; }
    if (n > 0.0) v = mix(v, acc / n, clamp(uCouple * uDt, 0.0, 1.0));
  }
  gl_FragColor = finite4(vec4(v, 0.0, 1.0));
}
`;

/**
 * The slabs' air read from the field's own passes, which are drawn in the window's uv (the dust, the smoke and fog, the
 * blowing sand, the wisps' bands): slab k's tile rectangle in the atlas, the read clamped half a texel inside it, times
 * the share that turns the highest slab solved into one not solved (`volAirLayers` under three: its wind times the ratio of
 * the shares), and outside the window the wind times the slab's own share. `slabVelAt(v, q, k, wind)`.
 */
const SLAB_VEL = /* glsl */ `
uniform vec4 uSlabTiles[3];
uniform vec4 uSlabScale;
uniform vec4 uSlabShare;
uniform vec2 uAtlasHalf;
vec2 slabVelAt(sampler2D vel, vec2 q, int k, vec2 wind) {
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return wind * uSlabShare[k];
  vec4 r = uSlabTiles[k];
  vec2 a = r.xy + clamp(q * r.zw, uAtlasHalf, r.zw - uAtlasHalf);
  return texture(vel, a).xy * uSlabScale[k];
}
`;

/**
 * The folded Gaussian's mass below `h` metres (its cumulative share, 0 to 1): `½ (erf((h − μ)/σ√2) + erf((h + μ)/σ√2))`.
 * What share of a patch stands in each slab (the dust's blended backtrace, a splat's share of each slab's dust), and the
 * share a solid's top leaves above it (the height-aware kill). `foldedBelow` (`airMath.ts`) is its mirror.
 */
export const AIR_FOLDED_CDF_GLSL = /* glsl */ `
float airFoldedBelow(float h, float mu, float sigma) {
  if (h <= 0.0) return 0.0;
  float k = 1.0 / (1.4142135623730951 * max(sigma, 1e-4));
  return clamp(0.5 * (airErf((h - mu) * k) + airErf((h + mu) * k)), 0.0, 1.0);
}
`;

/** sRGB bytes read as a texture into linear light. */
const SRGB = /* glsl */ `
vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}
`;

/**
 * Abramowitz and Stegun's erf (7.1.26), within 1.5e-7: the folded Gaussian's tail past the light's steps and past the
 * window along the view, and (from the third wave) its share in each slab. `erfApprox` (`airMath.ts`) is its mirror,
 * line for line.
 */
export const AIR_ERF_GLSL = /* glsl */ `
float airErf(float x) {
  float s = x < 0.0 ? -1.0 : 1.0;
  float a = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * a);
  float y = 1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}
`;

/**
 * The folded Gaussian a patch of dust is drawn as at `h` metres over the ground: N(h; μ, σ) + N(h; −μ, σ), nought under
 * the ground (`foldedProfile`, `airMath.ts`, is its mirror). 0.3989... is 1 / sqrt(2π).
 */
export const AIR_PROFILE_GLSL = /* glsl */ `
float airProfile(float h, float mu, float sigma) {
  if (h < 0.0) return 0.0;
  float s = max(sigma, 1e-4);
  float k = 0.5 / (s * s);
  float a = h - mu;
  float b = h + mu;
  return (exp(-a * a * k) + exp(-b * b * k)) * (0.3989422804014327 / s);
}
`;

/**
 * The smoke at a height (the third wave): interpolated linearly between the slabs' middles, so the three slabs join into
 * one smooth column with no step at a slab's edge to see; under slab 0's middle it fades in from the ground, and over slab
 * 2's it fades out by the band's top [demo `land.html:1077-1082`]. `uSlabMid` the three middles and the band's top.
 * `smokeAtHeight` (`airMath.ts`) is its mirror.
 */
export const AIR_SMOKE_AT_GLSL = /* glsl */ `
uniform vec4 uSlabMid;
float smokeAt(float hy, vec3 s) {
  if (hy < uSlabMid.x) return s.x * smoothstep(-0.3, uSlabMid.x * 0.6, hy);
  if (hy < uSlabMid.y) return mix(s.x, s.y, (hy - uSlabMid.x) / max(uSlabMid.y - uSlabMid.x, 1e-3));
  if (hy < uSlabMid.z) return mix(s.y, s.z, (hy - uSlabMid.y) / max(uSlabMid.z - uSlabMid.y, 1e-3));
  if (uSlabMid.w > uSlabMid.z) return s.z * (1.0 - smoothstep(uSlabMid.z, uSlabMid.w, hy));
  return 0.0;
}
`;

/** The fog's height profile under a top (`fogProfile`, `airFog.ts`, its mirror): full to 55% of the top, gone at it. */
export const AIR_FOG_PROFILE_GLSL = /* glsl */ `
float fogProfileAt(float h, float top) {
  if (h < 0.0 || top <= 0.0) return 0.0;
  return 1.0 - smoothstep(0.55 * top, top, h);
}
`;

/**
 * The dust, every frame: carried by slab 0's air (read at the air's own pending scroll), its own pending scroll
 * carried, settling as 1 / (1 + dt / settle), shed by dusty ground in a storm and laid by the frame's dust batch --
 * each times the ground's own dust and the slope's gate, in the ground's own colour (linear, premultiplied). Out of
 * the window it is the storm's dust; inside a solid, none.
 *
 * **From wave 2b it writes two outputs** (GLSL 3, a two-texture target, the design's §2.14): the colour and the
 * density as before, and the shape each patch carries premultiplied by its density -- D·μ (its mean height over the
 * ground), D·(σ² + μ²) (its second moment), D·w (its rise) and D·age -- read through the same backtrace, so whatever
 * flows into a texel mixes exactly as the colour does. After the settling, the six laws (`dustShapeStep` is their
 * mirror): the rise relaxes toward the fall, the mean moves by its exact integral, the ground reflects it and a patch
 * that landed stops falling, the spread grows linearly to its ceiling, the age grows to its cap. Each splat lays its own
 * shape (`uDustShapeBatch`, its μ₀, σ₀, w₀); the storm's shed and its inflow stand as the half-normal of the storm's own
 * mean height, laid at the storm's weight so a unit of it keeps the first wave's storm column. The colour is the colour
 * raster's lighter tones times the drawn ground's own tint of the pole's bytes (the tint raster, through the tile
 * program's own `groundTintOf` and `groundDecode`), blended toward one by `dust.tint`. The floor at nought is every
 * channel's but D·w, which is negative while the dust falls.
 */
export const DUST_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uWindow;
uniform vec2 uWind;
${GUST}
${SRGB}
${AIR_ERF_GLSL}
${AIR_FOLDED_CDF_GLSL}
${SLAB_VEL}
uniform vec4 uGroundTint;
uniform vec4 uGroundTintRef;
${GROUND_TINT_GLSL}
${GROUND_DECODE_GLSL}
uniform sampler2D uDust;
uniform sampler2D uShape;
uniform sampler2D uVel;
uniform sampler2D uObstacles;
uniform sampler2D uResponse;
uniform sampler2D uColour;
uniform sampler2D uTint;
uniform sampler2D uGround;
uniform vec2 uVelShift;
uniform vec2 uDustShift;
uniform vec2 uGroundTexel;
uniform float uObstacleOver;
// The frame's dt; its settling, (1 + h / settle)^(-dt / h) worked out on the CPU so the dust settles alike at any frame
// rate; the storm and its shedding; the storm's dust outside the window (at its weight), its spread squared, how much of
// the ground's tint the dust takes and the storm's weight; the laws' numbers for the frame: vectors, so a frame writes no
// number into a uniform object.
uniform vec4 uDustP;
uniform vec4 uDustQ;
uniform vec4 uDustLaw;
uniform vec4 uDustLawB;
// The third wave's: x the dust's tiles (1, or 3 with a field a layer), y half a dust texel in a tile's own uv, zw slab
// 0's and slab 1's tops (the share of a patch in each slab is its folded profile's mass between them); then the
// streamers' threshold, their crest and edge rates and the edge's reach in window uv; then the crest's sharpness at which
// it sheds in full and the shape a streamer is laid with (its height, spread and rise).
uniform vec4 uDustR;
uniform vec4 uStreamP;
uniform vec4 uStreamQ;
#define uDt uDustP.x
#define uDecay uDustP.y
#define uStorm uDustP.z
#define uStormShed uDustP.w
#define uInflow uDustQ.x
#define uStormSigma2 uDustQ.y
#define uTintShare uDustQ.z
#define uStormWeight uDustQ.w
#define uLawE uDustLaw.x
#define uLawI uDustLaw.y
#define uFall uDustLaw.z
#define uGrow uDustLaw.w
#define uMin2 uDustLawB.x
#define uMax2 uDustLawB.y
#define uAgeCap uDustLawB.z
uniform vec3 uStormColour;
uniform vec2 uSlopeGate;
uniform vec4 uDustBatch[${DUST_BATCH}];
uniform vec4 uDustShapeBatch[${DUST_BATCH}];
uniform int uDustCount;
layout(location = 0) out highp vec4 oDust;
layout(location = 1) out highp vec4 oShape;
vec4 finite4(vec4 v) { return (any(isnan(v)) || any(isinf(v))) ? vec4(0.0) : v; }
// The share of a patch (its folded profile at μ, σ) standing in slab k: slab 0 to its top, slab 1 between the two tops,
// slab 2 above.
float slabShare(int k, float mu, float sigma) {
  float a = airFoldedBelow(uDustR.z, mu, sigma);
  if (k == 0) return a;
  float b = airFoldedBelow(uDustR.w, mu, sigma);
  if (k == 1) return max(b - a, 0.0);
  return max(1.0 - b, 0.0);
}
// A read of tile k's dust at its own uv q, clamped half a texel inside the tile (never the neighbour's under the filter).
vec2 tileUv(int k, vec2 q) {
  float n = uDustR.x;
  float h = uDustR.y;
  return vec2((float(k) + clamp(q.x, h, 1.0 - h)) / n, clamp(q.y, h, 1.0 - h));
}
vec4 dustAt(int k, vec2 q) {
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) {
    // Out of the window the storm's dust; with a field a layer, each tile its own share of the storm's half-normal.
    float sh = uDustR.x > 1.5 ? slabShare(k, 0.0, sqrt(max(uStormSigma2, 1e-6))) : 1.0;
    return vec4(uStormColour * uInflow, uInflow) * sh;
  }
  return texture(uDust, tileUv(k, q));
}
// The storm's dust outside the window stands on the ground as the half-normal of its own mean height.
vec4 shapeAt(int k, vec2 q) {
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) {
    float sh = uDustR.x > 1.5 ? slabShare(k, 0.0, sqrt(max(uStormSigma2, 1e-6))) : 1.0;
    return vec4(0.0, uInflow * uStormSigma2, 0.0, 0.0) * sh;
  }
  return texture(uShape, tileUv(k, q));
}
// How steep the ground is here, degrees, from the height raster's neighbours a cell apart.
float slopeAt(vec2 l) {
  float hl = texture(uGround, l - vec2(uGroundTexel.x, 0.0)).r;
  float hr = texture(uGround, l + vec2(uGroundTexel.x, 0.0)).r;
  float hb = texture(uGround, l - vec2(0.0, uGroundTexel.y)).r;
  float ht = texture(uGround, l + vec2(0.0, uGroundTexel.y)).r;
  vec2 g = vec2(hr - hl, ht - hb) / (2.0 * uWindow.w);
  return degrees(atan(length(g)));
}
// Q(x) = ½ erfc(x / √2), the normal's upper tail, and its density.
float tailQ(float x) { return 0.5 - 0.5 * airErf(x * 0.7071067811865476); }
float normPhi(float x) { return 0.3989422804014327 * exp(-0.5 * x * x); }
void main() {
  // Which tile (a dust field a layer: three side by side), and where in it.
  float tiles = uDustR.x;
  int k = tiles > 1.5 ? int(clamp(floor(vUv.x * tiles), 0.0, tiles - 1.0)) : 0;
  vec2 l = tiles > 1.5 ? vec2(vUv.x * tiles - float(k), vUv.y) : vUv;
  // The air the dust here rides: with one field, each slab's weighted by how much of the patch here (read before the
  // backtrace) stands in it, so dust thrown high rides the faster upper wind and dust at the ground the slower one (the
  // design's §2.14); with a field a layer, the tile's own slab's. A texel with no dust takes the shape of the dust about to
  // flow into it, read where the slabs' mean air brings it from, and rides as that would (with nothing there either, slab
  // 0's): read off its own rest shape, a patch in slab 1 crossing into a low building's column, where slab 0 stands still,
  // was read in at nought and never crossed the roof. dustRideVelocity in airMath.ts is the mirror.
  vec2 v;
  vec2 lq = l + uVelShift;
  if (tiles > 1.5) v = slabVelAt(uVel, lq, k, uWind);
  else {
    vec2 va = slabVelAt(uVel, lq, 0, uWind);
    vec2 vb = slabVelAt(uVel, lq, 1, uWind);
    vec2 vc = slabVelAt(uVel, lq, 2, uWind);
    vec4 d0 = texture(uDust, tileUv(0, l));
    vec4 s0 = texture(uShape, tileUv(0, l));
    float D0 = d0.a;
    if (D0 < 1e-5) {
      vec2 pb = l - (va + vb + vc) * (uDt / (3.0 * uWindow.z)) + uDustShift;
      d0 = dustAt(0, pb);
      s0 = shapeAt(0, pb);
      D0 = d0.a;
    }
    float m0 = 0.0;
    float g0 = sqrt(uMin2);
    if (D0 >= 1e-5) {
      m0 = s0.r / D0;
      g0 = sqrt(max(s0.g / D0 - m0 * m0, uMin2));
    }
    float w0 = slabShare(0, m0, g0);
    float w1 = slabShare(1, m0, g0);
    float w2 = max(1.0 - w0 - w1, 0.0);
    float ws = w0 + w1 + w2;
    v = (va * w0 + vb * w1 + vc * w2) / max(ws, 1e-6);
  }
  vec2 back = l - v * uDt / uWindow.z + uDustShift;
  vec4 d = dustAt(k, back) * uDecay;
  vec4 s = shapeAt(k, back) * uDecay;
  // The laws, on the patch as it flowed in (a texel with almost no dust reads the rest shape).
  float D = d.a;
  float mu = 0.0;
  float q2 = uMin2;
  float w = 0.0;
  float age = 0.0;
  if (D >= 1e-5) {
    float inv = 1.0 / D;
    mu = s.r * inv;
    q2 = s.g * inv;
    w = s.b * inv;
    age = s.a * inv;
  }
  float wf = w + uFall;
  float w2 = -uFall + wf * uLawE;
  float m2 = mu + (-uFall * uDt + wf * uLawI);
  if (m2 < 0.0) {
    w2 = max(w2, 0.0);
    m2 = -m2;
  }
  float s2 = max(q2 - mu * mu, uMin2);
  if (s2 < uMax2) s2 = min(s2 + uGrow, uMax2);
  float a2 = min(age + uDt, uAgeCap);
  // Over a solid (the third wave, the design's §2.14): only the share of the patch standing above the solid's top is kept,
  // with its colour, its rise and its age, and with that share's own mean and spread, so dust thrown high passes over a
  // roof on the air not blocked there and what was below the roof is gone. The spread is the share's own and never the
  // patch's held: cut again at every step it stays over the roof, a held spread lifted it by about a spread a step without
  // end (aboveSolid in airMath.ts, the mirror, says how far). Never makes mass (the share is at most one); a solid no
  // taller than a slab's floor plus the "over" keeps the texel as it is.
  float top = texture(uObstacles, l).r;
  bool solid = top > uObstacleOver;
  if (solid) {
    float sg = sqrt(s2);
    float a = (top - m2) / sg;
    float b = (top + m2) / sg;
    float qa = tailQ(a);
    float qb = tailQ(b);
    float pa = normPhi(a);
    float pb = normPhi(b);
    float m = clamp(qa + qb, 0.0, 1.0);
    if (m < 1e-4) {
      oDust = vec4(0.0);
      oShape = vec4(0.0);
      return;
    }
    float lifted = (m2 * qa + sg * pa - m2 * qb + sg * pb) / m;
    float second = ((m2 * m2 + s2) * (qa + qb) + sg * (pa * (m2 + top) + pb * (top - m2))) / m;
    d *= m;
    D *= m;
    m2 = max(lifted, 0.0);
    s2 = max(second - lifted * lifted, uMin2);
  }
  s = D * vec4(m2, s2 + m2 * m2, w2, a2);
  // What the ground under this texel gives: its dust, on land and on ground not too steep, in its own colour, each
  // splat with the shape it is laid with (a share of it, with a field a layer, by how much of its profile stands in this
  // tile's slab). Nothing is laid inside a solid.
  vec4 col = texture(uColour, l);
  float land = abs(col.a - 0.3333) < 0.1 ? 1.0 : 0.0;
  float gate = 1.0 - smoothstep(uSlopeGate.x, uSlopeGate.y, slopeAt(l));
  float give = solid ? 0.0 : texture(uResponse, l).a * land * gate;
  float add = 0.0;
  vec4 shapeAdd = vec4(0.0);
  if (give > 0.0) {
    for (int i = 0; i < ${DUST_BATCH}; i++) {
      if (i >= uDustCount) break;
      vec4 sp = uDustBatch[i];
      vec2 q = l - sp.xy;
      float e = dot(q, q) * sp.z;
      if (e > 9.0) continue;
      vec4 sh = uDustShapeBatch[i];
      float a = sp.w * exp(-e);
      if (tiles > 1.5) a *= slabShare(k, sh.x, sh.y);
      add += a;
      shapeAdd += a * vec4(sh.x, sh.y * sh.y + sh.x * sh.x, sh.z, 0.0);
    }
    vec2 wp = uWindow.xy + l * uWindow.z;
    if (uStorm > 0.0) {
      float st = uStormShed * uStorm * gustAt(wp, uWind) * uDt * uStormWeight;
      if (tiles > 1.5) st *= slabShare(k, 0.0, sqrt(max(uStormSigma2, 1e-6)));
      add += st;
      shapeAdd.y += st * uStormSigma2;
    }
    // Streamers (the third wave, the design's §2.6): where the air near the ground runs past the threshold, loose ground
    // sheds off a crest (the height raster bending down along the wind) and beside a solid's edge, gusty rather than
    // constant [demo land.html:604-630]; laid low in slab 0's tile, by how much the ground moves (none off a rock crest:
    // streamerRate is the mirror).
    float moves = texture(uResponse, l).r;
    if (uStreamP.x > 0.0 && k == 0 && moves > 0.0) {
      vec2 va = slabVelAt(uVel, lq, 0, uWind);
      float sp0 = length(va);
      float gust = smoothstep(uStreamP.x, uStreamP.x + 6.0, sp0);
      if (gust > 0.0) {
        vec2 wd = va / max(sp0, 1e-4);
        vec2 ct = wd * uGroundTexel;
        float hc = texture(uGround, l).r;
        float curve = (texture(uGround, l + ct).r - 2.0 * hc + texture(uGround, l - ct).r) / (uWindow.w * uWindow.w);
        float crest = clamp(-curve / max(uStreamQ.x, 1e-4), 0.0, 1.0);
        float o = uStreamP.w;
        float edge = max(max(step(uObstacleOver, texture(uObstacles, l + vec2(o, 0.0)).r), step(uObstacleOver, texture(uObstacles, l - vec2(o, 0.0)).r)),
                         max(step(uObstacleOver, texture(uObstacles, l + vec2(0.0, o)).r), step(uObstacleOver, texture(uObstacles, l - vec2(0.0, o)).r)));
        float rate = gust * (crest * uStreamP.y + edge * uStreamP.z) * moves;
        rate *= smoothstep(0.35, 0.85, noiseAt(wp * 0.14 + vec2(uTime * 0.9, uTime * 0.37))) * 1.8;
        float sa = rate * uDt;
        add += sa;
        shapeAdd += sa * vec4(uStreamQ.y, uStreamQ.z * uStreamQ.z + uStreamQ.y * uStreamQ.y, uStreamQ.w, 0.0);
      }
    }
    add *= give;
    shapeAdd *= give;
  }
  vec4 tq = texture(uTint, l);
  vec3 tint = srgbToLinear(col.rgb) * mix(vec3(1.0), groundDecode(groundTintOf(tq.rgb)), uTintShare * tq.a);
  d += vec4(tint * add, add);
  s += shapeAdd;
  oDust = finite4(max(d, vec4(0.0)));
  oShape = finite4(vec4(max(s.r, 0.0), max(s.g, 0.0), s.b, max(s.a, 0.0)));
}
`;

/**
 * The light pass (from wave 2b, the design's §2.8): from each texel `uSteps` steps toward the sun across the
 * ground, `uStep` metres each, reading at each step's middle the dust, the shape it carries and the ground there, and
 * summing the optical depth the march itself would see along the slant for four heights over the texel's own ground --
 * `τ(h) = k · Σ D · f(h + (i − ½) · rise − (ground_i − ground_0)) · slant`, `k` the self-shadow times 0.55 · H₀ -- then
 * the storm's tall inflow past the steps' reach in closed form (its half-normal's tail along the slant). Out of the
 * window the storm's dust is on the way, standing on the texel's own ground. Written as optical depths, a height a
 * channel, so the march interpolates in height and takes `exp(−τ)` itself; `lightDepthAt` (`airLight.ts`) is its mirror.
 */
export const LIGHT_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uWindow;
uniform sampler2D uDust;
uniform sampler2D uShape;
uniform sampler2D uGround;
uniform sampler2D uSmoke;
uniform vec2 uSunDir;
uniform int uSteps;
// The step's metres across the ground, along the slant and up it, and the storm's dust outside; then the k, the storm's
// spread, the slant a metre of height is and the thinnest a patch is; then the four heights; then (the third wave's) the
// smoke's and the fog's own extinction times the self-shadow, the fog's top, and whether smoke or fog is in the air; and
// the dust's tiles and half a texel of one in its own uv: vectors, so a frame writes no number into a uniform object.
uniform vec4 uLightP;
uniform vec4 uLightQ;
uniform vec4 uLightH;
uniform vec4 uLightR;
uniform vec2 uDustTiles;
#define uStep uLightP.x
#define uSlant uLightP.y
#define uRise uLightP.z
#define uInflow uLightP.w
#define uK uLightQ.x
#define uStormSigma uLightQ.y
#define uInvSin uLightQ.z
#define uSpreadMin uLightQ.w
${AIR_ERF_GLSL}
${AIR_PROFILE_GLSL}
${AIR_SMOKE_AT_GLSL}
${AIR_FOG_PROFILE_GLSL}
vec4 finite4(vec4 v) { return (any(isnan(v)) || any(isinf(v))) ? vec4(0.0) : v; }
vec4 profile4(vec4 h, float mu, float sigma) {
  return vec4(airProfile(h.x, mu, sigma), airProfile(h.y, mu, sigma), airProfile(h.z, mu, sigma), airProfile(h.w, mu, sigma));
}
vec2 tileUv(int k, vec2 q) {
  float h = uDustTiles.y;
  return vec2((float(k) + clamp(q.x, h, 1.0 - h)) / uDustTiles.x, clamp(q.y, h, 1.0 - h));
}
// What the smoke and the fog take at the four heights, a metre (the march's own extinctions, the self-shadow in them).
vec4 smokeFog4(vec4 h, vec4 s) {
  vec4 o;
  for (int j = 0; j < 4; j++) {
    float y = h[j];
    o[j] = uLightR.x * smokeAt(y, s.xyz) + uLightR.y * s.w * fogProfileAt(y, uLightR.z);
  }
  return o;
}
void main() {
  float g0 = texture(uGround, vUv).r;
  vec2 stepUv = uSunDir * uStep / uWindow.z;
  vec4 sum = vec4(0.0);
  vec4 sumAir = vec4(0.0);
  int tiles = int(uDustTiles.x + 0.5);
  bool air = uLightR.w > 0.5;
  for (int k = 1; k <= ${MAX_LIGHT_STEPS}; k++) {
    if (k > uSteps) break;
    float x = float(k) - 0.5;
    vec2 q = vUv + stepUv * x;
    vec4 hk;
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) {
      sum += uInflow * profile4(uLightH + vec4(x * uRise), 0.0, uStormSigma);
    } else {
      float g = texture(uGround, q).r;
      hk = uLightH + vec4(x * uRise - (g - g0));
      // Each dust tile's patch (one, or a field a layer).
      for (int t = 0; t < 3; t++) {
        if (t >= tiles) break;
        vec2 a = tiles > 1 ? tileUv(t, q) : q;
        float d = texture(uDust, a).a;
        vec4 s = texture(uShape, a);
        float mu = 0.0;
        float sigma = uSpreadMin;
        if (d >= 1e-5) {
          mu = s.r / d;
          sigma = sqrt(max(s.g / d - mu * mu, uSpreadMin * uSpreadMin));
        }
        sum += d * profile4(hk, mu, sigma);
      }
      if (air) sumAir += smokeFog4(hk, texture(uSmoke, q));
    }
  }
  vec4 tau = uK * sum * uSlant + sumAir * uSlant;
  if (uInflow > 0.0) {
    vec4 hEnd = uLightH + vec4(float(uSteps) * uRise);
    float r = 1.0 / (1.4142135623730951 * max(uStormSigma, 1e-3));
    tau += uK * uInflow * uInvSin * (vec4(1.0) - vec4(airErf(hEnd.x * r), airErf(hEnd.y * r), airErf(hEnd.z * r), airErf(hEnd.w * r)));
  }
  gl_FragColor = finite4(max(tau, vec4(0.0)));
}
`;

/**
 * Smoke and fog (the third wave, the design's §2.6), every frame by the frame's own `dt`, one RGBA32F pair of two
 * outputs: a smoke channel for each slab and the fog, and the smoke's colour premultiplied by its sum (a gas cloud's own
 * green, a wreck's grey). Each slab's smoke is carried by its own slab's air (read through `slabVelAt`, so with fewer
 * layers solved the highest one's wind stands in), dies at `decay` a second and climbs a share of itself into the slab
 * above each second [demo `land.html:571-579`, `:1829-1845`], each of those an exact exponential of the frame's `dt`, so it
 * is the same at every frame rate. The fog is carried by slab 0's air **and a drainage of its own** down the ground's
 * fall line wherever the ground leans past `drainFrom`, so it slides off rises and pools in hollows; it dies at its decay
 * raised by the burn; the ground emits it patchily (a slow noise drifting on the wind, nothing under its `gaps`), half as
 * much again over water and never over lava; and out of the window it is the bank the hour brings in on the wind, patchy
 * too. **Nothing relaxes it toward a level** (the design's decision 31). A slab's smoke inside a solid taller than its
 * floor is none, and so is the fog inside one taller than slab 0's. Smoke and fog out of the window: the bank's fog, no
 * smoke.
 */
export const SMOKE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uWindow;
uniform vec2 uWind;
${GUST}
${SLAB_VEL}
uniform sampler2D uSmoke;
uniform sampler2D uSmokeTint;
uniform sampler2D uVel;
uniform sampler2D uObstacles;
uniform sampler2D uGround;
uniform sampler2D uColour;
uniform vec2 uVelShift;
uniform vec2 uSmokeShift;
uniform vec2 uGroundTexel;
uniform float uObstacleOver;
// The frame's dt, the smoke's decay over it, the share of slab 0's and slab 1's smoke that climbs over it; the fog's
// decay over it (its burn in it), its emission and its bank on the wind (each times the hour's level), its drainage
// speed; the drainage's least lean (its tangent), the share more over water, the patches' noise cells a metre and their
// gaps; the patches' drift (noise cells), and whether smoke and fog are carried at all; the slabs' floors: vectors, so a
// frame writes no number into a uniform object.
uniform vec4 uSmokeP;
uniform vec4 uFogP;
uniform vec4 uFogQ;
uniform vec4 uFogR;
// The densest the drainage piles fog to.
uniform vec4 uFogS;
uniform vec4 uSlabFloor;
uniform vec4 uSmokeBatch[${SMOKE_BATCH}];
uniform vec4 uSmokeShare[${SMOKE_BATCH}];
uniform vec4 uSmokeColour[${SMOKE_BATCH}];
uniform int uSmokeCount;
#define uDt uSmokeP.x
#define uSmokeDecay uSmokeP.y
#define uClimb0 uSmokeP.z
#define uClimb1 uSmokeP.w
#define uFogDecay uFogP.x
#define uFogEmit uFogP.y
#define uFogBank uFogP.z
#define uFogDrain uFogP.w
layout(location = 0) out highp vec4 oSmoke;
layout(location = 1) out highp vec4 oTint;
vec4 finite4(vec4 v) { return (any(isnan(v)) || any(isinf(v))) ? vec4(0.0) : v; }
bool outsideOf(vec2 q) { return q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0; }
// How patchily the fog comes: a slow noise over the world, drifting on the wind, nothing under its gaps.
float fogPatchAt(vec2 wp) {
  float n = noiseAt(wp * uFogQ.z - uFogR.xy);
  return max(n - uFogQ.w, 0.0) / max(1.0 - uFogQ.w, 1e-3);
}
void main() {
  vec2 l = vUv;
  vec2 lq = l + uVelShift;
  vec2 v0 = slabVelAt(uVel, lq, 0, uWind);
  vec2 v1 = slabVelAt(uVel, lq, 1, uWind);
  vec2 v2 = slabVelAt(uVel, lq, 2, uWind);
  float k = uDt / uWindow.z;
  // Each slab's smoke where its own air brought it from (nothing comes in from out of the window).
  vec2 b0 = l - v0 * k + uSmokeShift;
  vec2 b1 = l - v1 * k + uSmokeShift;
  vec2 b2 = l - v2 * k + uSmokeShift;
  float s0 = outsideOf(b0) ? 0.0 : texture(uSmoke, b0).x;
  float s1 = outsideOf(b1) ? 0.0 : texture(uSmoke, b1).y;
  float s2 = outsideOf(b2) ? 0.0 : texture(uSmoke, b2).z;
  // The smoke's colour, carried by the slabs' air weighted by their smoke here.
  vec4 here = texture(uSmoke, l);
  float wsum = here.x + here.y + here.z;
  vec2 vt = wsum > 1e-5 ? (v0 * here.x + v1 * here.y + v2 * here.z) / wsum : v0;
  vec2 bt = l - vt * k + uSmokeShift;
  vec4 tint = outsideOf(bt) ? vec4(0.0) : texture(uSmokeTint, bt);
  // The fog: slab 0's air and the drainage down the ground's fall line, in proportion to the lean under the least and at
  // its full speed past it (so it never jumps), and that drainage's divergence, which compresses the fog as it is carried
  // (the continuity equation along the backtrace): it piles up in a hollow and at a slope's foot, and thins on a rise.
  // fogDrainAt (airFog.ts) is the mirror.
  vec2 drain = vec2(0.0);
  float fogDiv = 0.0;
  if (uFogDrain > 0.0) {
    vec2 tx = vec2(uGroundTexel.x, 0.0);
    vec2 tz = vec2(0.0, uGroundTexel.y);
    float hc = texture(uGround, l).r;
    float hl = texture(uGround, l - tx).r;
    float hr = texture(uGround, l + tx).r;
    float hb = texture(uGround, l - tz).r;
    float ht = texture(uGround, l + tz).r;
    float c = uWindow.w;
    vec2 g = vec2(hr - hl, ht - hb) / (2.0 * c);
    float hxx = (hr - 2.0 * hc + hl) / (c * c);
    float hzz = (ht - 2.0 * hc + hb) / (c * c);
    float hxz = (texture(uGround, l + tx + tz).r - texture(uGround, l - tx + tz).r - texture(uGround, l + tx - tz).r + texture(uGround, l - tx - tz).r) / (4.0 * c * c);
    float s = length(g);
    float lean = max(uFogQ.x, 1e-4);
    if (s < lean) {
      drain = -g / lean * uFogDrain;
      fogDiv = -uFogDrain * (hxx + hzz) / lean;
    } else {
      drain = -g / s * uFogDrain;
      fogDiv = -uFogDrain * (hxx * g.y * g.y - 2.0 * hxz * g.x * g.y + hzz * g.x * g.x) / (s * s * s);
    }
    fogDiv = clamp(fogDiv, -${FOG_DIV_MOST.toFixed(1)}, ${FOG_DIV_MOST.toFixed(1)});
  }
  vec2 bf = l - (v0 + drain) * k + uSmokeShift;
  float fog;
  if (outsideOf(bf)) fog = uFogBank * fogPatchAt(uWindow.xy + bf * uWindow.z);
  else fog = texture(uSmoke, bf).w;
  // Dying away, the smoke's and the tint's alike, and climbing: each an exact exponential of the frame.
  s0 *= uSmokeDecay;
  s1 *= uSmokeDecay;
  s2 *= uSmokeDecay;
  tint *= uSmokeDecay;
  float up0 = s0 * uClimb0;
  float up1 = s1 * uClimb1;
  s0 -= up0;
  s1 += up0 - up1;
  s2 += up1;
  // Compressed where the drainage converges, never past the pool's most by that (a bank already denser keeps its own).
  float pressed = fog * exp(-fogDiv * uDt);
  fog = fogDiv < 0.0 ? min(pressed, max(fog, uFogS.x)) : pressed;
  fog *= uFogDecay;
  // Inside a solid a slab's smoke is none where the solid stands over its floor; the fog, over slab 0's.
  float top = texture(uObstacles, l).r;
  bool in0 = top > uSlabFloor.x + uObstacleOver;
  bool in1 = top > uSlabFloor.y + uObstacleOver;
  bool in2 = top > uSlabFloor.z + uObstacleOver;
  if (in0) { s0 = 0.0; fog = 0.0; }
  if (in1) s1 = 0.0;
  if (in2) s2 = 0.0;
  // The smoke batch: each source its share of each slab, in its own colour.
  if (uFogR.z > 0.5) {
    for (int i = 0; i < ${SMOKE_BATCH}; i++) {
      if (i >= uSmokeCount) break;
      vec4 sp = uSmokeBatch[i];
      vec2 q = l - sp.xy;
      float e = dot(q, q) * sp.z;
      if (e > 9.0) continue;
      float a = sp.w * exp(-e);
      vec4 sh = uSmokeShare[i];
      float a0 = in0 ? 0.0 : a * sh.x;
      float a1 = in1 ? 0.0 : a * sh.y;
      float a2 = in2 ? 0.0 : a * sh.z;
      s0 += a0;
      s1 += a1;
      s2 += a2;
      float added = a0 + a1 + a2;
      tint += vec4(uSmokeColour[i].rgb * added, added);
    }
  } else {
    s0 = 0.0;
    s1 = 0.0;
    s2 = 0.0;
    tint = vec4(0.0);
  }
  // The ground's own fog, patchy: over land and (more of it) over water, never over lava, never in a solid.
  if (uFogR.w > 0.5) {
    if (!in0 && uFogEmit > 0.0) {
      float medium = texture(uColour, l).a;
      bool land = abs(medium - 0.3333) < 0.1;
      bool water = abs(medium - 0.6667) < 0.1;
      if (land || water) fog += uFogEmit * fogPatchAt(uWindow.xy + l * uWindow.z) * (water ? uFogQ.y : 1.0) * uDt;
    }
  } else fog = 0.0;
  oSmoke = finite4(max(vec4(s0, s1, s2, fog), vec4(0.0)));
  oTint = finite4(max(tint, vec4(0.0)));
}
`;

/**
 * The wisps' bands (the third wave, the Medium preset's road, the design's §2.14): a pass a frame at the dust's size that
 * writes the flow noise at the light's four heights over the ground into an RGBA8, each height carried by the air of the
 * slab it stands in (and the dust's own rise), two phases cross-faded -- eight 3D taps a texel -- so the march reads one
 * 2D fetch and interpolates in its sample's height. The vertical detail is only as fine as the four bands.
 */
export const BANDS_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler3D;
varying vec2 vUv;
uniform vec4 uWindow;
uniform vec2 uWind;
${SLAB_VEL}
uniform sampler2D uVel;
uniform sampler2D uDust;
uniform sampler2D uShape;
uniform sampler3D uNoise3;
uniform vec2 uVelShift;
uniform vec4 uLightH;
// The noise's scale a metre, its stretch, the flow's period; then the two phases (shares of the period) and the
// cross-fade; then the dust's tiles and half a texel of one in its own uv.
uniform vec4 uWispA;
uniform vec4 uWispB;
uniform vec2 uDustTiles;
uniform vec2 uSlabTop;
void main() {
  vec2 l = vUv;
  vec2 lq = l + uVelShift;
  float h = uDustTiles.y;
  vec2 a = uDustTiles.x > 1.5 ? vec2(clamp(l.x, h, 1.0 - h) / uDustTiles.x, l.y) : l;
  float D = max(texture(uDust, a).a, 1e-5);
  float rise = texture(uShape, a).b / D;
  vec2 w = uWindow.xy + l * uWindow.z;
  vec4 o;
  for (int b = 0; b < 4; b++) {
    float hy = uLightH[b];
    int k = hy < uSlabTop.x ? 0 : (hy < uSlabTop.y ? 1 : 2);
    vec2 v = slabVelAt(uVel, lq, k, uWind);
    vec3 flow = vec3(v.x, rise, v.y) * uWispA.z;
    vec3 q = vec3(w.x, hy * uWispA.y, w.y) * uWispA.x;
    float n0 = textureLod(uNoise3, q - flow * uWispB.x * uWispA.x, 0.0).r;
    float n1 = textureLod(uNoise3, q - flow * uWispB.y * uWispA.x + 0.37, 0.0).r;
    o[b] = mix(n0, n1, uWispB.z);
  }
  gl_FragColor = clamp(o, vec4(0.0), vec4(1.0));
}
`;

/**
 * The obstacles' quads: each solid box turned on the ground, drawn into the window with its height, MAX-blended. A
 * wall (`aTurn.w` 1) writes its top into red, which the solver and the dust stop at, and green; a compound's room
 * (`aTurn.w` 0) into green alone, which only the volume reads, so its dust stays out of a hall seen through a door.
 */
export const OBSTACLE_VERTEX = /* glsl */ `
attribute vec4 aBox;
attribute vec4 aTurn;
uniform vec4 uWindow;
varying float vTop;
varying float vWall;
void main() {
  vec2 local = position.xy * aBox.zw;
  vec2 w = aBox.xy + vec2(local.x * aTurn.x - local.y * aTurn.y, local.x * aTurn.y + local.y * aTurn.x);
  vec2 q = (w - uWindow.xy) / uWindow.z;
  vTop = aTurn.z;
  vWall = aTurn.w;
  gl_Position = vec4(q * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const OBSTACLE_FRAGMENT = /* glsl */ `
precision highp float;
varying float vTop;
varying float vWall;
void main() {
  float top = (isnan(vTop) || isinf(vTop)) ? 0.0 : max(vTop, 0.0);
  gl_FragColor = vec4(vWall > 0.5 ? top : 0.0, top, 0.0, 1.0);
}
`;

/** Clears a field to its inflow (a jump, a new world): velocity to the wind's share, everything else to `uValue`. */
export const FILL_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uValue;
void main() { gl_FragColor = uValue; }
`;

/**
 * Clears the dust's pair, both of its outputs (from wave 2b): the colour and density to the storm's dust at its
 * weight (`uValue`), the shape to the storm's half-normal standing on the ground (`uShapeValue`: nought, D·σ², nought,
 * nought). GLSL 3, as the dust pass is.
 */
export const FILL_DUST_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec4 uValue;
uniform vec4 uShapeValue;
layout(location = 0) out highp vec4 oDust;
layout(location = 1) out highp vec4 oShape;
void main() {
  oDust = uValue;
  oShape = uShapeValue;
}
`;

/**
 * The blowing sand's two phases, every frame (from wave 2b, the design's §2.7): each texel holds how far phase
 * A's picture (RG) and phase B's (BA) have been carried since their own restarts, in metres. Each is the second wave's own
 * carry -- `o_new(x) = o(x − u·dt) − u·dt`, `u` the air near the ground times its lift over the threshold times `lift` of
 * its speed [demo `land.html:544-564`, restated for offsets] -- with no "moves" factor (how much shows over each layer is
 * the ground's own, to the pixel), restarted every cycle with its overshoot: where a phase started again this frame it
 * holds only what it was carried since. So neither phase grows past `u × cycle` and the ground's own picture never moves.
 * Still air copies a texel exactly. Out of the window a parcel carries the inflow's own phases; inside a solid, nothing
 * moves.
 */
export const OFFSETS_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uWindow;
uniform vec2 uWind;
${SRGB}
${SLAB_VEL}
uniform vec4 uGroundTint;
uniform vec4 uGroundTintRef;
${GROUND_TINT_GLSL}
${GROUND_DECODE_GLSL}
uniform sampler2D uOffsets;
uniform sampler2D uCarry;
uniform sampler2D uVel;
uniform sampler2D uColour;
uniform sampler2D uResponse;
uniform sampler2D uTint;
uniform sampler2D uObstacles;
uniform float uObstacleOver;
uniform vec2 uVelShift;
uniform vec2 uSandShift;
// The frame's dt, the lift threshold and its span, and the share of the air's speed the sand moves at; then whether
// each phase started again this frame and the seconds since (A, then B); then the inflow's own phases (A's xy, B's zw);
// then (the third wave's) what the sand in the air keeps over the frame: vectors, so a frame writes no number into a
// uniform object.
uniform vec4 uSandP;
uniform vec4 uSandQ;
uniform vec4 uSandR;
uniform vec4 uSandC;
#define uDt uSandP.x
#define uLift uSandP.y
#define uLiftSpan uSandP.z
#define uLiftShare uSandP.w
layout(location = 0) out highp vec4 oOffsets;
layout(location = 1) out highp vec4 oCarry;
vec4 finite4(vec4 v) { return (any(isnan(v)) || any(isinf(v))) ? vec4(0.0) : v; }
vec4 offsetsAt(vec2 q) {
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return uSandR;
  return texture(uOffsets, q);
}
void main() {
  vec2 l = vUv;
  if (texture(uObstacles, l).r > uObstacleOver) {
    oOffsets = vec4(0.0);
    oCarry = vec4(0.0);
    return;
  }
  vec2 v = slabVelAt(uVel, l + uVelShift, 0, uWind);
  vec4 col = texture(uColour, l);
  float land = abs(col.a - 0.3333) < 0.1 ? 1.0 : 0.0;
  float lift = smoothstep(uLift, uLift + uLiftSpan, length(v)) * land;
  vec2 u = v * (lift * uLiftShare);
  vec2 back = l - u * uDt / uWindow.z + uSandShift;
  vec4 o = offsetsAt(back) - vec4(u, u) * uDt;
  if (uSandQ.x > 0.5) o.xy = -u * uSandQ.y;
  if (uSandQ.z > 0.5) o.zw = -u * uSandQ.w;
  // The sand in the air (the third wave, the owner's "if it starts on sand, it should continue over the rock but die
  // off normally"): carried by the same carry from where it came, dying at its own rate, lifted only where the ground
  // under it blows (min(moves, dust)) and the air passes the threshold, in that ground's own colour (premultiplied). Over
  // rock, paving, mud or water nothing is lifted, and what was carried there fades; nothing comes in from outside.
  vec4 c = (back.x < 0.0 || back.y < 0.0 || back.x > 1.0 || back.y > 1.0) ? vec4(0.0) : texture(uCarry, back);
  c *= uSandC.x;
  vec4 resp = texture(uResponse, l);
  float lifted = min(resp.r, resp.a) * land * clamp(lift * uSandC.y, 0.0, 1.0);
  if (lifted > c.a) {
    vec4 tq = texture(uTint, l);
    vec3 colour = srgbToLinear(col.rgb) * mix(vec3(1.0), groundDecode(groundTintOf(tq.rgb)), tq.a);
    c = vec4(colour * lifted, lifted);
  }
  oOffsets = finite4(o);
  oCarry = finite4(max(c, vec4(0.0)));
}
`;

/**
 * A dent stamp: an instanced quad in the toroidal field's own uv (the CPU worked out each stamp's place and any copy
 * across a wrap line), turned along its way, reaching 1.4 of its half extents so a bowl's lip fits [demo
 * `land.html:677-684`]. Placed in clip space, never through a camera.
 */
export const DENT_STAMP_VERTEX = /* glsl */ `
attribute vec4 aStampA;
attribute vec4 aStampB;
varying vec2 vLocal;
varying vec2 vDepthKind;
void main() {
  vec2 lc = position.xy * 1.4;
  vec2 dir = aStampB.xy;
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 w = aStampA.xy + dir * lc.x * aStampA.z + nrm * lc.y * aStampA.w;
  vLocal = lc;
  vDepthKind = aStampB.zw;
  gl_Position = vec4(w * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * Its depth, added to what is there: a bowl with a raised lip (anything pushed into sand leaves one), or a footprint's
 * toe and heel along its way [demo `land.html:686-700`], times the depth (metres, the ground's give already in it).
 */
export const DENT_STAMP_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vLocal;
varying vec2 vDepthKind;
void main() {
  float d;
  if (vDepthKind.y < 0.5) {
    float r = length(vLocal);
    float bowl = 1.0 - smoothstep(0.0, 1.0, r);
    float lipR = (r - 1.08) / 0.16;
    float lip = exp(-lipR * lipR) * 0.30;
    d = bowl * bowl - lip;
  } else {
    vec2 q = vLocal;
    float toe = 1.0 - length(vec2((q.x - 0.42) / 0.58, q.y / 0.86));
    float heel = 1.0 - length(vec2((q.x + 0.55) / 0.42, q.y / 0.70));
    d = smoothstep(0.0, 0.55, clamp(max(toe, heel), 0.0, 1.0));
  }
  float v = d * vDepthKind.x;
  gl_FragColor = vec4((isnan(v) || isinf(v)) ? 0.0 : v, 0.0, 0.0, 0.0);
}
`;

/**
 * The dents' fade on a tick of the 10 Hz clock, blended as a multiply of what is there: each texel by
 * `exp(-k · max(heals, floor))`, its heals read off the air's response raster at the texel's own world place (the
 * field is toroidal: texel i stands for world texel `k0 + ((i - k0) mod n)`), a cell not known yet or a liquid healing
 * at one [demo `land.html:720-729`, moved to a fixed tick so it is frame-rate independent].
 */
export const DENT_FADE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uWindow;
uniform sampler2D uResponse;
uniform sampler2D uColour;
// The square's first texel (x, z), its texels across and its metres a texel; the rate this draw and the floor on heals.
uniform vec4 uDentSquare;
uniform vec2 uFadeP;
void main() {
  vec2 i = floor(vUv * uDentSquare.z);
  vec2 k = uDentSquare.xy + mod(i - uDentSquare.xy, uDentSquare.z);
  vec2 w = (k + 0.5) * uDentSquare.w;
  vec2 l = (w - uWindow.xy) / uWindow.z;
  float heals = 1.0;
  if (l.x >= 0.0 && l.y >= 0.0 && l.x <= 1.0 && l.y <= 1.0) {
    float land = abs(texture(uColour, l).a - 0.3333) < 0.1 ? 1.0 : 0.0;
    if (land > 0.5) heals = texture(uResponse, l).g;
  }
  float f = exp(-uFadeP.x * max(heals, uFadeP.y));
  gl_FragColor = vec4((isnan(f) || isinf(f)) ? 1.0 : f);
}
`;

/**
 * The slabs' air read in the window's uv (`slabVelAt`) and sRGB bytes into linear light (`srgbToLinear`), for the fourth
 * wave's particles and rain (`airParticleShaders.ts`): the very lines the field's own passes read with, never a copy.
 */
export const SLAB_VEL_GLSL = SLAB_VEL;
export const SRGB_GLSL = SRGB;

/** Every fragment shader of the air's own passes by name, for the scanner and the self test. */
export const AIR_FRAGMENTS: Readonly<Record<string, string>> = {
  splat: SPLAT_FRAGMENT,
  vort: VORT_FRAGMENT,
  div: DIV_FRAGMENT,
  jacobi: JACOBI_FRAGMENT,
  grad: GRAD_FRAGMENT,
  advect: ADVECT_FRAGMENT,
  dust: DUST_FRAGMENT,
  light: LIGHT_FRAGMENT,
  smoke: SMOKE_FRAGMENT,
  bands: BANDS_FRAGMENT,
  obstacle: OBSTACLE_FRAGMENT,
  fill: FILL_FRAGMENT,
  fillDust: FILL_DUST_FRAGMENT,
  offsets: OFFSETS_FRAGMENT,
  dentStamp: DENT_STAMP_FRAGMENT,
  dentFade: DENT_FADE_FRAGMENT,
};
