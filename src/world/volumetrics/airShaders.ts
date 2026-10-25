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
import { DUST_BATCH, SPLAT_BATCH } from './airForces.ts';
import { GROUND_DECODE_GLSL, GROUND_TINT_GLSL } from '../terrainTextures.ts';

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
// A solid stands over this slab's floor here: the obstacle map is in window uv, and is never solid outside it.
float solidAt(vec2 l, int t) {
  if (outsideOf(l)) return 0.0;
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
 * The splat: the velocity read at the window's pending scroll (carried by this, the first pass after a move to read
 * it), plus every splat of the batch, each weighted by how far its height over the ground is from the slab's middle.
 */
export const SPLAT_FRAGMENT = /* glsl */ `
${ATLAS_COMMON}
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
  float centre = uTileSlab[t].y;
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
    v += b.xy * exp(-e) * w;
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
  f *= uStrength * c;
  f.y *= -1.0;
  // None across the window's edge band: the curl there reads the held inflow outside against the air inside, and
  // confined it pumped jets along the edges that grew to the cap and filled the window (the second wave measured it).
  float edgeD = min(min(l.x, 1.0 - l.x), min(l.y, 1.0 - l.y));
  f *= smoothstep(0.0, uEdge, edgeD);
  vec2 v = velAt(uVel, l, t) + f * uDt;
  gl_FragColor = finite4(vec4(clamp(v, vec2(-uCap), vec2(uCap)), 0.0, 1.0));
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
 * `uDiss` a second and pulled toward the wind -- gusts and all -- at `uRelax` a second [demo `land.html:443-453`].
 */
export const ADVECT_FRAGMENT = /* glsl */ `
${ATLAS_COMMON}
${GUST}
uniform sampler2D uVel;
// The step, the dissipation and the pull toward the wind, in one vector.
uniform vec4 uAdvectP;
#define uDt uAdvectP.x
#define uDiss uAdvectP.y
#define uRelax uAdvectP.z
void main() {
  int t = tileOf(vUv);
  vec2 l = localOf(vUv, t);
  if (solidAt(l, t) > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 v0 = velAt(uVel, l, t);
  vec2 back = l - v0 * uDt / uWindow.z;
  vec2 v = velAt(uVel, back, t) / (1.0 + uDiss * uDt);
  vec2 w = uWindow.xy + l * uWindow.z;
  v = mix(v, windHere(w, inflowOf(t)), clamp(uRelax * uDt, 0.0, 1.0));
  gl_FragColor = finite4(vec4(v, 0.0, 1.0));
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
uniform float uWindShare;
layout(location = 0) out highp vec4 oDust;
layout(location = 1) out highp vec4 oShape;
vec4 finite4(vec4 v) { return (any(isnan(v)) || any(isinf(v))) ? vec4(0.0) : v; }
vec2 velAt(vec2 l) {
  vec2 q = l + uVelShift;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return uWind * uWindShare;
  return texture(uVel, q).xy;
}
vec4 dustAt(vec2 q) {
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(uStormColour * uInflow, uInflow);
  return texture(uDust, q);
}
// The storm's dust outside the window stands on the ground as the half-normal of its own mean height.
vec4 shapeAt(vec2 q) {
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(0.0, uInflow * uStormSigma2, 0.0, 0.0);
  return texture(uShape, q);
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
void main() {
  vec2 l = vUv;
  if (texture(uObstacles, l).r > uObstacleOver) {
    oDust = vec4(0.0);
    oShape = vec4(0.0);
    return;
  }
  vec2 back = l - velAt(l) * uDt / uWindow.z + uDustShift;
  vec4 d = dustAt(back) * uDecay;
  vec4 s = shapeAt(back) * uDecay;
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
  s = D * vec4(m2, s2 + m2 * m2, w2, a2);
  // What the ground under this texel gives: its dust, on land and on ground not too steep, in its own colour, each
  // splat with the shape it is laid with.
  vec4 col = texture(uColour, l);
  float land = abs(col.a - 0.3333) < 0.1 ? 1.0 : 0.0;
  float gate = 1.0 - smoothstep(uSlopeGate.x, uSlopeGate.y, slopeAt(l));
  float give = texture(uResponse, l).a * land * gate;
  float add = 0.0;
  vec4 shapeAdd = vec4(0.0);
  if (give > 0.0) {
    for (int i = 0; i < ${DUST_BATCH}; i++) {
      if (i >= uDustCount) break;
      vec4 sp = uDustBatch[i];
      vec2 q = l - sp.xy;
      float e = dot(q, q) * sp.z;
      if (e > 9.0) continue;
      float a = sp.w * exp(-e);
      vec4 sh = uDustShapeBatch[i];
      add += a;
      shapeAdd += a * vec4(sh.x, sh.y * sh.y + sh.x * sh.x, sh.z, 0.0);
    }
    if (uStorm > 0.0) {
      vec2 wp = uWindow.xy + l * uWindow.z;
      float st = uStormShed * uStorm * gustAt(wp, uWind) * uDt * uStormWeight;
      add += st;
      shapeAdd.y += st * uStormSigma2;
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
 * Abramowitz and Stegun's erf (7.1.26), within 1.5e-7: the folded Gaussian's tail past the light's steps and past the
 * window along the view. `erfApprox` (`airMath.ts`) is its mirror, line for line.
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
uniform vec2 uSunDir;
uniform int uSteps;
// The step's metres across the ground, along the slant and up it, and the storm's dust outside; then the k, the storm's
// spread, the slant a metre of height is and the thinnest a patch is; then the four heights: vectors, so a frame writes no
// number into a uniform object.
uniform vec4 uLightP;
uniform vec4 uLightQ;
uniform vec4 uLightH;
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
vec4 finite4(vec4 v) { return (any(isnan(v)) || any(isinf(v))) ? vec4(0.0) : v; }
vec4 profile4(vec4 h, float mu, float sigma) {
  return vec4(airProfile(h.x, mu, sigma), airProfile(h.y, mu, sigma), airProfile(h.z, mu, sigma), airProfile(h.w, mu, sigma));
}
void main() {
  float g0 = texture(uGround, vUv).r;
  vec2 stepUv = uSunDir * uStep / uWindow.z;
  vec4 sum = vec4(0.0);
  for (int k = 1; k <= ${MAX_LIGHT_STEPS}; k++) {
    if (k > uSteps) break;
    float x = float(k) - 0.5;
    vec2 q = vUv + stepUv * x;
    float d;
    float mu;
    float sigma;
    float g;
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) {
      d = uInflow;
      mu = 0.0;
      sigma = uStormSigma;
      g = g0;
    } else {
      d = texture(uDust, q).a;
      vec4 s = texture(uShape, q);
      g = texture(uGround, q).r;
      if (d >= 1e-5) {
        mu = s.r / d;
        sigma = sqrt(max(s.g / d - mu * mu, uSpreadMin * uSpreadMin));
      } else {
        mu = 0.0;
        sigma = uSpreadMin;
      }
    }
    sum += d * profile4(uLightH + vec4(x * uRise - (g - g0)), mu, sigma);
  }
  vec4 tau = uK * sum * uSlant;
  if (uInflow > 0.0) {
    vec4 hEnd = uLightH + vec4(float(uSteps) * uRise);
    float r = 1.0 / (1.4142135623730951 * max(uStormSigma, 1e-3));
    tau += uK * uInflow * uInvSin * (vec4(1.0) - vec4(airErf(hEnd.x * r), airErf(hEnd.y * r), airErf(hEnd.z * r), airErf(hEnd.w * r)));
  }
  gl_FragColor = finite4(max(tau, vec4(0.0)));
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
uniform float uWindShare;
uniform sampler2D uOffsets;
uniform sampler2D uVel;
uniform sampler2D uColour;
uniform sampler2D uObstacles;
uniform float uObstacleOver;
uniform vec2 uVelShift;
uniform vec2 uSandShift;
// The frame's dt, the lift threshold and its span, and the share of the air's speed the sand moves at; then whether
// each phase started again this frame and the seconds since (A, then B); then the inflow's own phases (A's xy, B's zw):
// vectors, so a frame writes no number into a uniform object.
uniform vec4 uSandP;
uniform vec4 uSandQ;
uniform vec4 uSandR;
#define uDt uSandP.x
#define uLift uSandP.y
#define uLiftSpan uSandP.z
#define uLiftShare uSandP.w
vec4 finite4(vec4 v) { return (any(isnan(v)) || any(isinf(v))) ? vec4(0.0) : v; }
vec2 velAt(vec2 l) {
  vec2 q = l + uVelShift;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return uWind * uWindShare;
  return texture(uVel, q).xy;
}
vec4 offsetsAt(vec2 q) {
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return uSandR;
  return texture(uOffsets, q);
}
void main() {
  vec2 l = vUv;
  if (texture(uObstacles, l).r > uObstacleOver) { gl_FragColor = vec4(0.0); return; }
  vec2 v = velAt(l);
  float land = abs(texture(uColour, l).a - 0.3333) < 0.1 ? 1.0 : 0.0;
  float lift = smoothstep(uLift, uLift + uLiftSpan, length(v)) * land;
  vec2 u = v * (lift * uLiftShare);
  vec4 o = offsetsAt(l - u * uDt / uWindow.z + uSandShift) - vec4(u, u) * uDt;
  if (uSandQ.x > 0.5) o.xy = -u * uSandQ.y;
  if (uSandQ.z > 0.5) o.zw = -u * uSandQ.w;
  gl_FragColor = finite4(o);
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
  obstacle: OBSTACLE_FRAGMENT,
  fill: FILL_FRAGMENT,
  fillDust: FILL_DUST_FRAGMENT,
  offsets: OFFSETS_FRAGMENT,
  dentStamp: DENT_STAMP_FRAGMENT,
  dentFade: DENT_FADE_FRAGMENT,
};
