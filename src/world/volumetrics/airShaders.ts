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
// Pure strings and the constants they are built from: no three.
import { MAX_TILES } from './airAtlas.ts';
import { DUST_BATCH, SPLAT_BATCH } from './airForces.ts';

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
 */
export const DUST_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uWindow;
uniform vec2 uWind;
${GUST}
${SRGB}
uniform sampler2D uDust;
uniform sampler2D uVel;
uniform sampler2D uObstacles;
uniform sampler2D uResponse;
uniform sampler2D uColour;
uniform sampler2D uGround;
uniform vec2 uVelShift;
uniform vec2 uDustShift;
uniform vec2 uGroundTexel;
uniform float uObstacleOver;
// The frame's dt; its settling, (1 + h / settle)^(-dt / h) worked out on the CPU so the dust settles alike at any frame
// rate; the storm and its shedding; and the storm's dust outside the window: vectors, so a frame writes no number into
// a uniform object.
uniform vec4 uDustP;
uniform vec4 uDustQ;
#define uDt uDustP.x
#define uDecay uDustP.y
#define uStorm uDustP.z
#define uStormShed uDustP.w
#define uInflow uDustQ.x
uniform vec3 uStormColour;
uniform vec2 uSlopeGate;
uniform vec4 uDustBatch[${DUST_BATCH}];
uniform int uDustCount;
uniform float uWindShare;
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
  if (texture(uObstacles, l).r > uObstacleOver) { gl_FragColor = vec4(0.0); return; }
  vec2 back = l - velAt(l) * uDt / uWindow.z;
  vec4 d = dustAt(back + uDustShift) * uDecay;
  // What the ground under this texel gives: its dust, on land and on ground not too steep, in its own colour.
  vec4 col = texture(uColour, l);
  float land = abs(col.a - 0.3333) < 0.1 ? 1.0 : 0.0;
  float gate = 1.0 - smoothstep(uSlopeGate.x, uSlopeGate.y, slopeAt(l));
  float give = texture(uResponse, l).a * land * gate;
  float add = 0.0;
  if (give > 0.0) {
    for (int i = 0; i < ${DUST_BATCH}; i++) {
      if (i >= uDustCount) break;
      vec4 s = uDustBatch[i];
      vec2 q = l - s.xy;
      float e = dot(q, q) * s.z;
      if (e > 9.0) continue;
      add += s.w * exp(-e);
    }
    if (uStorm > 0.0) {
      vec2 w = uWindow.xy + l * uWindow.z;
      add += uStormShed * uStorm * gustAt(w, uWind) * uDt;
    }
    add *= give;
  }
  vec3 tint = srgbToLinear(col.rgb);
  d += vec4(tint * add, add);
  gl_FragColor = finite4(max(d, vec4(0.0)));
}
`;

/**
 * The light pass: from each texel `uSteps` steps toward the sun in XZ, `uStep` metres each, summing the dust on the
 * way, written as exp(-k · sum) -- the air's transmittance toward the sun [demo `land.html:640-664`]. The building
 * channel is the cascades' (the volume's own tap); out of the window the storm's dust is on the way.
 */
export const LIGHT_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uWindow;
uniform sampler2D uDust;
uniform vec2 uSunDir;
uniform int uSteps;
// The step's metres, the dust's share, the k and the storm's dust outside, in one vector.
uniform vec4 uLightP;
#define uStep uLightP.x
#define uDustK uLightP.y
#define uK uLightP.z
#define uInflow uLightP.w
vec4 finite4(vec4 v) { return (any(isnan(v)) || any(isinf(v))) ? vec4(0.0) : v; }
void main() {
  float sum = 0.0;
  vec2 stepUv = uSunDir * uStep / uWindow.z;
  for (int k = 1; k <= ${MAX_LIGHT_STEPS}; k++) {
    if (k > uSteps) break;
    vec2 q = vUv + stepUv * float(k);
    float d = (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) ? uInflow : texture(uDust, q).a;
    sum += d * uDustK;
  }
  gl_FragColor = finite4(vec4(exp(-uK * sum), 0.0, 0.0, 1.0));
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
};
