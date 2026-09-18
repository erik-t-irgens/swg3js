import * as THREE from 'three';
import type { WaterLook } from './waterLook';
import { GLSL_OCT_ENCODE } from '../core/glslOct';

/**
 * Water: a physically based surface that reflects the sky's environment map, moved by a
 * wind-driven set of Gerstner waves on the deep-water dispersion relation (long waves travel
 * faster), with their phases warped by slow noise so the pattern never repeats, capillary
 * ripples bending the normal, foam on the steepest crests, and rings and wakes spreading from
 * whatever moves through it. Everything is evaluated in world space, so meshes tile without
 * seams and lakes share the same sea state as the ocean.
 *
 * Each body's colour, opacity and how hard and fast its ripples run come from the terrain's own
 * water shader (`WaterLook`), so a sulphur sea and a clear pool are the same material with
 * different numbers.
 */
export interface WaterUniforms {
  uTime: { value: number };
  uWaveHeight: { value: number };
  uRipple: { value: number };
  uDrift: { value: number };
  /** 0 while the reflections pass adds the environment term itself, 1 otherwise. Shared by every water material. */
  uWaterEnvSpecular: { value: number };
  /** The scene's FogExp2 density, so the mask weights what it writes as the lit water is fogged. Shared; the mask reads it. */
  uFxFogDensity: { value: number };
  /** The strength a traced reflection is given (the water's authored 0.55). Shared; the mask reads it. */
  uFxTraced: { value: number };
  [name: string]: { value: unknown };
}

export interface WaterMaterial extends THREE.MeshPhysicalMaterial {
  userData: { uniforms: WaterUniforms; look: WaterLook; variant: 'lit' | 'mask'; waves: boolean; water: true };
}

/** One value for every water material: the reflections pass takes the environment term over while it runs. */
const WATER_ENV_SPECULAR = { value: 1 };

/** 0 while the reflections pass adds the environment term itself, 1 otherwise. */
export function setWaterEnvSpecular(value: 0 | 1): void {
  WATER_ENV_SPECULAR.value = value;
}

/** The fog density the lit water is drawn under this frame; the mask fades what it writes the same way. */
export const WATER_FX_FOG = { value: 0 };
/** How strong a traced reflection is: the water's own reflection strength, so traced and fallback meet without a step. */
export const WATER_FX_TRACED = { value: 0.55 };

const WAVE_COUNT = 8;
/** The detail tile: a Phillips-spectrum height field of this many samples across this many metres. */
const TILE_N = 256;
const TILE_SIZE = 28;
/** Rings spreading from things that touch the water: shared by every water material. */
const MAX_RIPPLES = 32;
const RIPPLE_LIFE = 3.0;
/** Per ring: x, z, start time, strength; then direction x, z, speed, spare. */
const ringData = new Float32Array(MAX_RIPPLES * 4).fill(-1000);
const ringMotion = new Float32Array(MAX_RIPPLES * 4);
const RINGS = { value: ringData };
const RING_MOTION = { value: ringMotion };
let nextRing = 0;

/**
 * Depth under the water: a moving window of ground heights around the player, from terrain
 * already generated, sampled by the shaders to calm and flatten waves in the shallows and to
 * foam the shoreline. A full pass refreshes over a couple of seconds, so shores keep up.
 */
const DEPTH_CELLS = 128;
const DEPTH_CELL = 16;
const DEPTH_UNKNOWN = -10000;
const depthHeights = new Float32Array(DEPTH_CELLS * DEPTH_CELLS).fill(DEPTH_UNKNOWN);
const depthTexture = new THREE.DataTexture(depthHeights, DEPTH_CELLS, DEPTH_CELLS, THREE.RedFormat, THREE.FloatType);
depthTexture.magFilter = depthTexture.minFilter = THREE.LinearFilter;
depthTexture.wrapS = depthTexture.wrapT = THREE.ClampToEdgeWrapping;
depthTexture.needsUpdate = true;
const DEPTH = { tex: { value: depthTexture }, origin: { value: new THREE.Vector2(-1e9, -1e9) }, size: { value: DEPTH_CELLS * DEPTH_CELL } };
let depthCursor = 0;

/** Move the depth window to the player and refresh a slice of it from the ground heights available. */
export function updateWaterDepth(centerX: number, centerZ: number, heightAt: (x: number, z: number) => number | null): void {
  const half = (DEPTH_CELLS * DEPTH_CELL) / 2;
  const ox = Math.floor((centerX - half) / DEPTH_CELL) * DEPTH_CELL;
  const oz = Math.floor((centerZ - half) / DEPTH_CELL) * DEPTH_CELL;
  const origin = DEPTH.origin.value;
  const shiftX = Math.round((ox - origin.x) / DEPTH_CELL);
  const shiftZ = Math.round((oz - origin.y) / DEPTH_CELL);
  if (Math.abs(shiftX) >= 8 || Math.abs(shiftZ) >= 8 || origin.x < -1e8) {
    if (origin.x > -1e8 && Math.abs(shiftX) < DEPTH_CELLS && Math.abs(shiftZ) < DEPTH_CELLS) {
      // Slide what is known along with the window; the rest fills in over the next passes.
      const old = depthHeights.slice();
      depthHeights.fill(DEPTH_UNKNOWN);
      for (let j = 0; j < DEPTH_CELLS; j++) {
        const sj = j + shiftZ;
        if (sj < 0 || sj >= DEPTH_CELLS) continue;
        for (let i = 0; i < DEPTH_CELLS; i++) {
          const si = i + shiftX;
          if (si >= 0 && si < DEPTH_CELLS) depthHeights[j * DEPTH_CELLS + i] = old[sj * DEPTH_CELLS + si];
        }
      }
    } else depthHeights.fill(DEPTH_UNKNOWN);
    origin.set(ox, oz);
  }
  // Refresh the cells nearest the player most, the rest round-robin.
  const total = DEPTH_CELLS * DEPTH_CELLS;
  for (let n = 0; n < 700; n++) {
    const k = depthCursor;
    depthCursor = (depthCursor + 1) % total;
    const i = k % DEPTH_CELLS;
    const j = (k - i) / DEPTH_CELLS;
    const h = heightAt(origin.x + (i + 0.5) * DEPTH_CELL, origin.y + (j + 0.5) * DEPTH_CELL);
    if (h !== null) depthHeights[k] = h;
  }
  depthTexture.needsUpdate = true;
}

/** Start a ring at a world position moving with a velocity; `strength` scales its height (1 for a person wading). */
export function emitRipple(x: number, z: number, strength: number, time: number, vx = 0, vz = 0): void {
  const o = nextRing * 4;
  ringData[o] = x;
  ringData[o + 1] = z;
  ringData[o + 2] = time;
  ringData[o + 3] = strength;
  const speed = Math.hypot(vx, vz);
  ringMotion[o] = speed > 1e-3 ? vx / speed : 0;
  ringMotion[o + 1] = speed > 1e-3 ? vz / speed : 0;
  ringMotion[o + 2] = speed;
  ringMotion[o + 3] = 0;
  nextRing = (nextRing + 1) % MAX_RIPPLES;
}

/** In-place radix-2 complex FFT (inverse when `inverse`), lengths a power of two. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
}

/**
 * A tiling wave height field from the Phillips spectrum (Tessendorf's ocean statistics): every
 * wavelength the tile can hold gets a random amplitude and phase shaped by the wind, and an
 * inverse FFT turns them into heights. Returned as a normal map for the water's fine detail.
 */
function spectrumNormalTile(seed: number, windAngle: number, windSpeed: number): THREE.DataTexture {
  let st = seed >>> 0 || 1;
  const rnd = () => {
    st = (st * 1664525 + 1013904223) >>> 0;
    return st / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(1e-9, rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  const N = TILE_N;
  const L = TILE_SIZE;
  const g = 9.81;
  const Lw = (windSpeed * windSpeed) / g;
  const wx = Math.cos(windAngle);
  const wz = Math.sin(windAngle);
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const kx = ((2 * Math.PI) / L) * (i < N / 2 ? i : i - N);
      const kz = ((2 * Math.PI) / L) * (j < N / 2 ? j : j - N);
      const k2 = kx * kx + kz * kz;
      if (k2 < 1e-9) continue;
      const k = Math.sqrt(k2);
      const kw = (kx * wx + kz * wz) / k;
      // Phillips: exp(-1/(kL)^2) / k^4 times how well the wave lines up with the wind, damped for the shortest waves.
      let ph = (Math.exp(-1 / (k2 * Lw * Lw)) / (k2 * k2)) * kw * kw * Math.exp(-k2 * 0.01);
      if (kw < 0) ph *= 0.25;
      const amp = Math.sqrt(ph) * 0.7071;
      re[j * N + i] = gauss() * amp;
      im[j * N + i] = gauss() * amp;
    }
  }
  // Rows, then columns.
  const rowR = new Float64Array(N);
  const rowI = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) (rowR[i] = re[j * N + i]), (rowI[i] = im[j * N + i]);
    fft(rowR, rowI, true);
    for (let i = 0; i < N; i++) (re[j * N + i] = rowR[i]), (im[j * N + i] = rowI[i]);
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) (rowR[j] = re[j * N + i]), (rowI[j] = im[j * N + i]);
    fft(rowR, rowI, true);
    for (let j = 0; j < N; j++) (re[j * N + i] = rowR[j]), (im[j * N + i] = rowI[j]);
  }
  // Normalise the heights to a set range, then take slopes for the normal map.
  let max = 1e-9;
  for (let i = 0; i < N * N; i++) max = Math.max(max, Math.abs(re[i]));
  const height = 0.1;
  const cell = L / N;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const h = (a: number, b: number) => (re[((b + N) % N) * N + ((a + N) % N)] / max) * height;
      const dx = (h(i + 1, j) - h(i - 1, j)) / (2 * cell);
      const dz = (h(i, j + 1) - h(i, j - 1)) / (2 * cell);
      const len = Math.hypot(dx, dz, 1);
      const o = (j * N + i) * 4;
      data[o] = Math.round((-dx / len) * 127 + 128);
      data[o + 1] = Math.round((-dz / len) * 127 + 128);
      data[o + 2] = Math.round((1 / len) * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

let detailTile: THREE.DataTexture | null = null;

/**
 * A sea state: waves spread around the wind direction, wavelengths spread from short chop to
 * long swell, amplitudes that grow with wavelength, and each wave's phase speed from the
 * dispersion relation c = sqrt(g * wavelength / 2 pi).
 */
function seaState(seed: number, windAngle: number): { waves: THREE.Vector4[]; omega: number[] } {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const waves: THREE.Vector4[] = [];
  const omega: number[] = [];
  for (let i = 0; i < WAVE_COUNT; i++) {
    // Swells from 7.5 m to 38 m, roughly log-spaced with jitter; longer waves lean into the wind.
    const t = (i + rnd() * 0.8) / WAVE_COUNT;
    const wavelength = 7.5 * Math.pow(38 / 7.5, t);
    const spread = THREE.MathUtils.lerp(1.1, 0.3, t);
    const angle = windAngle + (rnd() - 0.5) * 2 * spread;
    const k = (2 * Math.PI) / wavelength;
    // Amplitude as a fraction of wavelength: a moderate sea, the longest swells about 40 cm high.
    const amplitude = wavelength * THREE.MathUtils.lerp(0.005, 0.0095, t) * (0.7 + rnd() * 0.6);
    waves.push(new THREE.Vector4(Math.cos(angle), Math.sin(angle), k, amplitude));
    omega.push(Math.sqrt(9.81 * k));
  }
  return { waves, omega };
}

const WAVES_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uRipple;
  uniform float uDrift;
  uniform vec4 uWaves[${WAVE_COUNT}];
  uniform float uOmega[${WAVE_COUNT}];
  uniform sampler2D uDetail;
  uniform float uDetailSize;
  uniform vec4 uRings[${MAX_RIPPLES}];
  uniform vec4 uRingMotion[${MAX_RIPPLES}];
  uniform sampler2D uDepthTex;
  uniform vec2 uDepthOrigin;
  uniform float uDepthSize;
  varying float vWaterLevel;

  // Water depth at a point: the surface's own level less the ground under it (deep where unknown).
  float waterDepth(vec2 p) {
    vec2 uv = (p - uDepthOrigin) / uDepthSize;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 100.0;
    float ground = texture2D(uDepthTex, uv).r;
    // Unknown cells hold a huge negative height; anything blended toward one counts as deep water.
    return ground < -500.0 ? 100.0 : min(vWaterLevel - ground, 100.0);
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  // Smooth value noise, for warping wave phases so the sea never repeats.
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float phaseWarp(vec2 p) {
    return (vnoise(p * 0.035 + uTime * 0.012) - 0.5) * 2.4 + (vnoise(p * 0.11 - uTime * 0.02) - 0.5) * 0.9;
  }

  // Gerstner displacement of a point (xz moves toward crests, y rises), plus the surface normal there.
  void gerstner(vec2 p, float scale, out vec3 disp, out vec3 normal, out float crest) {
    disp = vec3(0.0);
    vec3 n = vec3(0.0, 1.0, 0.0);
    float warp = phaseWarp(p);
    float sumAmp = 0.0;
    float height = 0.0;
    for (int i = 0; i < ${WAVE_COUNT}; i++) {
      vec4 w = uWaves[i];
      float k = w.z;
      float a = w.w * scale;
      float steep = min(0.55 / (k * a * float(${WAVE_COUNT}) + 1e-4), 1.0);
      float phase = k * dot(w.xy, p) - uOmega[i] * uTime + warp;
      float c = cos(phase);
      float s = sin(phase);
      disp.xz += w.xy * (steep * a * c);
      disp.y += a * s;
      n.x -= w.x * k * a * c;
      n.z -= w.y * k * a * c;
      n.y -= steep * k * a * s;
      sumAmp += a;
      height += a * s;
    }
    normal = normalize(n);
    crest = sumAmp > 1e-4 ? height / sumAmp : 0.0;
  }

  // Fine waves from the spectrum tile: two layers at different scales and headings, drifting
  // with the wind, their slopes added so neither tiling shows.
  vec2 detailSlope(vec2 p) {
    vec2 a = p / uDetailSize + uTime * uDrift * vec2(0.018, 0.007);
    vec2 pr = vec2(p.x * 0.83 - p.y * 0.56, p.x * 0.56 + p.y * 0.83);
    vec2 b = pr / (uDetailSize * 0.47) - uTime * uDrift * vec2(0.012, 0.02);
    vec3 na = texture2D(uDetail, a).xyz * vec3(2.0, 2.0, 1.0) - vec3(1.0, 1.0, 0.0);
    vec3 nb = texture2D(uDetail, b).xyz * vec3(2.0, 2.0, 1.0) - vec3(1.0, 1.0, 0.0);
    vec2 sa = na.xy / max(na.z, 0.2);
    vec2 sb = nb.xy / max(nb.z, 0.2);
    return (sa * 0.8 + sb * 0.55) * uRipple;
  }

  // Metres to the shore, from the depth and how fast it changes: a band of foam the same
  // width on a beach and on a steep bank.
  float shoreDistance(vec2 p, float depth) {
    float e = 4.0;
    float dxp = waterDepth(p + vec2(e, 0.0));
    float dxm = waterDepth(p - vec2(e, 0.0));
    float dzp = waterDepth(p + vec2(0.0, e));
    float dzm = waterDepth(p - vec2(0.0, e));
    // No verdict next to cells the window has not filled yet.
    if (depth >= 99.0 || max(max(dxp, dxm), max(dzp, dzm)) >= 99.0) return 100.0;
    vec2 grad = vec2(dxp - dxm, dzp - dzm) / (2.0 * e);
    return depth / max(length(grad), 0.02);
  }

  // Rings and wakes: a damped packet spreading from each source, stronger ahead of a moving one.
  float ringHeight(vec2 p) {
    float h = 0.0;
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 r = uRings[i];
      float age = uTime - r.z;
      if (age < 0.0 || age > ${RIPPLE_LIFE.toFixed(1)}) continue;
      vec4 m = uRingMotion[i];
      vec2 d = p - r.xy;
      float dist = length(d);
      float front = 0.35 + age * 1.25;
      float packet = exp(-pow((dist - front) / 0.55, 2.0));
      float fade = exp(-age * 1.4) * (1.0 - age / ${RIPPLE_LIFE.toFixed(1)});
      float bow = m.z > 0.3 ? 0.45 + 0.55 * max(0.0, dot(d / max(dist, 1e-3), m.xy)) : 1.0;
      float amp = r.w * (0.12 + 0.05 * min(m.z, 6.0));
      h += amp * bow * packet * fade * sin((dist - front) * 11.0) / (1.0 + dist * 0.6);
    }
    return h;
  }
`;

/**
 * Declarations after the fragment's `#include <common>`. The mask writes a second target, so its
 * extra output needs an explicit location (three declares location 0 itself); the lit water only
 * needs the switch that hands its environment term to the reflections pass.
 */
const MASK_PARS_GLSL = /* glsl */ `
  #ifdef WATER_FX_MASK
    layout(location = 1) out highp vec4 fxEnvOut;
    layout(location = 2) out highp vec4 fxTracedOut;
    uniform float uFxFogDensity;
    uniform float uFxTraced;
    ${GLSL_OCT_ENCODE}
  #else
    uniform float uWaterEnvSpecular;
  #endif
`;

/**
 * In place of `#include <opaque_fragment>`. The lit water is unchanged. The mask writes, in target 0,
 * the view normal, the view depth and 1 for coverage (and, with an alpha of 1, replaces what is
 * there, so where layers stack it holds the last one drawn, not necessarily the nearest). In target 1 it writes exactly the light the lit water leaves out while the reflections
 * pass runs: the lit water blends `dst (1 - a) + a [(1 - f)(diffuse + direct + multiscatter + R s)
 * + f fog]`, so with its environment term R s taken out it is short by `a (1 - f) R s`, which goes
 * into target 1's colour, with `a` as its alpha so the mask's own blend attenuates what lies behind
 * exactly as the lit water's does. Target 2's red is the weight a traced colour gets in the same
 * place, `a (1 - f) s` times the water's own reflection strength, blended the same way, so a traced
 * reflection and the fallback carry the same Fresnel and meet without a step.
 */
const MASK_OUTPUT_GLSL = /* glsl */ `
  #ifdef WATER_FX_MASK
  {
    vec3 fxSingle = vec3(0.0);
    vec3 fxMulti = vec3(0.0);
    // The split-sum term three's RE_IndirectSpecular_Physical weighs the environment by; with
    // metalness 0 the dielectric half is the whole of it.
    computeMultiscattering(geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, fxSingle, fxMulti);
    // The FogExp2 the lit pass applies over the view depth, so the added reflection fades as the water does.
    float fxFog = 1.0 - exp(-uFxFogDensity * uFxFogDensity * vViewPosition.z * vViewPosition.z);
    float fxA = clamp(diffuseColor.a, 0.0, 1.0);
    float fxW = fxA * (1.0 - fxFog);
    gl_FragColor = vec4(fxOctEncode(normalize(normal)), vViewPosition.z, 1.0);
    fxEnvOut = vec4(fxEnvRadiance * fxSingle * fxW, fxA);
    fxTracedOut = vec4(max3(fxSingle) * fxW * uFxTraced, 0.0, 0.0, fxA);
  }
  #else
  #include <opaque_fragment>
  #endif
`;

/**
 * A water material drawn with one body's look. `waves` enables the vertex swell (only for finely
 * divided meshes); lakes with no interior vertices pass false and still ripple, foam and react.
 * `reflective: false` leaves the environment out altogether (the lava tables, until the heat
 * design draws them itself).
 */
export function createWaterMaterial(look: WaterLook, waves: boolean, opts: { windAngle?: number; seed?: number; reflective?: boolean } = {}): WaterMaterial {
  const { windAngle = 0.9, seed = 7, reflective = true } = opts;
  const mat = new THREE.MeshPhysicalMaterial({
    color: look.color,
    transparent: true,
    opacity: look.opacity,
    roughness: 0.16,
    metalness: 0,
    ior: 1.33,
    specularIntensity: 0.8,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: reflective ? 0.55 : 0,
  }) as WaterMaterial;
  const sea = seaState(seed, windAngle);
  detailTile ??= spectrumNormalTile(seed * 7919 + 13, windAngle, 6.5);
  const uniforms: WaterUniforms = {
    uDepthTex: DEPTH.tex,
    uDepthOrigin: DEPTH.origin,
    uDepthSize: DEPTH.size,
    uDetail: { value: detailTile },
    uDetailSize: { value: TILE_SIZE },
    uTime: { value: 0 },
    uWaveHeight: { value: waves ? 1 : 0 },
    uRipple: { value: look.ripple },
    uDrift: { value: look.drift },
    uWaterEnvSpecular: WATER_ENV_SPECULAR,
    uFxFogDensity: WATER_FX_FOG,
    uFxTraced: WATER_FX_TRACED,
    uWaves: { value: sea.waves },
    uOmega: { value: sea.omega },
    uRings: RINGS,
    uRingMotion: RING_MOTION,
  };
  mat.userData = { uniforms, look, variant: 'lit', waves, water: true };
  installWaterHook(mat, uniforms, 'lit', waves);
  return mat;
}

/**
 * The mask twin of a lit water material, for the effects' water mask: the same waves, ripples,
 * rings, foam, colour, opacity and environment, writing what the surface is instead of its light.
 * Target 0 gets the view normal (octahedral), the view depth and coverage; target 1 the environment
 * term the lit water leaves out while the reflections pass runs, weighted by the blend and the fog;
 * target 2 the weight a traced colour gets there. It shares the lit material's uniform objects
 * but has a hook of its own, and it is never put in the world's scene, so nothing else hooks it.
 *
 * One side only: a body has two twins, a `BackSide` one drawn just before a `FrontSide` one, which
 * is the order three draws a double-sided transparent material in (back faces, then front faces).
 * A single double-sided twin would draw the same, but three flips such a material's side and marks
 * it for a program lookup twice every draw, which is most of the mask's CPU time.
 */
export function createWaterMaskMaterial(lit: WaterMaterial, side: typeof THREE.FrontSide | typeof THREE.BackSide): WaterMaterial {
  const mask = new THREE.MeshPhysicalMaterial({
    color: lit.color,
    opacity: lit.opacity,
    roughness: lit.roughness,
    metalness: lit.metalness,
    ior: lit.ior,
    specularIntensity: lit.specularIntensity,
    envMap: lit.envMap,
    envMapIntensity: lit.envMapIntensity,
    side,
    // Blended exactly as the lit water blends, `src + dst (1 - a)`, and drawn in the same order
    // (each body's back faces, then its front faces, bodies in the lit water's order), so where one
    // view ray crosses the swell several times (the front of a crest, its back, the next crest)
    // targets 1 and 2 sum every layer as the lit sea does. Target 0 writes an alpha of 1, so it is
    // simply replaced: the last surface drawn is the one it keeps.
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    fog: true,
  }) as WaterMaterial;
  // Added to STANDARD and PHYSICAL, which the physical material's constructor sets and needs.
  mask.defines = { ...mask.defines, WATER_FX_MASK: '' };
  mask.userData = { ...lit.userData, variant: 'mask' };
  installWaterHook(mask, lit.userData.uniforms, 'mask', lit.userData.waves);
  return mask;
}

/**
 * Give `mat` the water injections for its variant: an `onBeforeCompile` accessor that first runs
 * whatever another system assigns to the material (cascaded shadows and the portal renderer assign
 * their own hook to everything in the scene) and then ours, plus the program key. Each call makes
 * its own closure and its own `external`, so one variant never runs another's hook; only the
 * uniform objects are shared.
 */
function installWaterHook(mat: WaterMaterial, uniforms: WaterUniforms, variant: 'lit' | 'mask', waves: boolean): void {
  let external: ((shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void) | null = null;
  const ours = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => {
    external?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WAVES_GLSL}\nvarying vec2 vWaterXZ;\nvarying float vWaterDist;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          float dist = distance(wp.xyz, cameraPosition);
          vWaterDist = dist;
          vWaterLevel = wp.y;
          // The swell fades out where the mesh is too coarse to carry it (the far ring is flat),
          // and dies away in the shallows so the shoreline holds still.
          float fade = uWaveHeight * (1.0 - smoothstep(900.0, 1400.0, dist)) * smoothstep(0.3, 5.0, waterDepth(wp.xz));
          vec3 disp; vec3 n; float crest;
          gerstner(wp.xz, fade, disp, n, crest);
          transformed += disp;
          vWaterXZ = wp.xz + disp.xz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WAVES_GLSL}\nvarying vec2 vWaterXZ;\nvarying float vWaterDist;\n${MASK_PARS_GLSL}`)
      .replace(
        // Only the specular environment term: the irradiance and the multiscatter stay, so the
        // water looks the same while the reflections pass adds this term back itself. The mask
        // keeps the term as it is, since the term is what it writes.
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
        #ifdef WATER_FX_MASK
          vec3 fxEnvRadiance = radiance;
        #else
          radiance *= uWaterEnvSpecular;
        #endif`,
      )
      .replace('#include <opaque_fragment>', MASK_OUTPUT_GLSL)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // The same waves, this time per pixel: their normal, the wind ripples and the rings.
        // Evaluated here because three's colour and roughness stages run before its normal stage.
        vec3 waterNormalW;
        float waterFoam;
        {
          vec3 disp; vec3 wn; float crest;
          float depth = waterDepth(vWaterXZ);
          float calm = smoothstep(0.15, 3.0, depth);
          gerstner(vWaterXZ, calm, disp, wn, crest);
          float detail = 1.0 - smoothstep(120.0, 700.0, vWaterDist);
          vec2 slope = detailSlope(vWaterXZ) * (0.35 + 0.65 * detail) * (0.5 + 0.5 * calm);
          float e = 0.06;
          slope += vec2(ringHeight(vWaterXZ + vec2(e, 0.0)) - ringHeight(vWaterXZ - vec2(e, 0.0)), ringHeight(vWaterXZ + vec2(0.0, e)) - ringHeight(vWaterXZ - vec2(0.0, e))) / (2.0 * e) * detail;
          waterNormalW = normalize(vec3(wn.x - slope.x, wn.y, wn.z - slope.y));
          // Foam on the steepest crests, faintly along fresh rings, and in a narrow lapping band at the shore.
          // The band runs right up to the water's edge: by distance where the slope is known, and
          // by depth alone in the last hand's breadth, where the coarse depth grid can misjudge it.
          float toShore = min(shoreDistance(vWaterXZ, depth), depth * 6.0);
          float lap = vnoise(vWaterXZ * 1.7 + vec2(uTime * 0.35, -uTime * 0.22)) * 0.6 + vnoise(vWaterXZ * 6.0 - vec2(uTime * 0.5, uTime * 0.4)) * 0.4;
          float band = 1.0 - smoothstep(0.35, 1.5, toShore);
          float shore = band * mix(1.0, smoothstep(0.35, 0.8, lap), smoothstep(0.0, 1.0, toShore));
          waterFoam = smoothstep(0.7, 0.98, crest) * 0.35 * calm + clamp(abs(ringHeight(vWaterXZ)) * 2.0, 0.0, 0.15) * detail + shore * 0.3;
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.86, 0.9), waterFoam);
        diffuseColor.a = mix(diffuseColor.a, 1.0, waterFoam * 0.5);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.6, waterFoam);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 vn = normalize((viewMatrix * vec4(waterNormalW, 0.0)).xyz);
          normal = normalize(mix(normal, vn, 0.92));
        }`,
      );
  };
  Object.defineProperty(mat, 'onBeforeCompile', {
    configurable: true,
    get: () => ours,
    set: (fn: typeof external) => {
      external = fn;
    },
  });
  mat.customProgramCacheKey = () => `swg-water-2-${variant}-${waves ? 'waves' : 'flat'}-${external ? 'hooked' : 'plain'}`;
}

/**
 * How far the swell can lift the surface above its mean: the summed wave amplitudes times
 * uWaveHeight (about 1.19 m for the sea's own seed and wind; 0 for a flat material). The camera
 * is inside a crest within this much of the surface.
 */
export function waveReach(material: WaterMaterial): number {
  const waves = material.userData.uniforms.uWaves?.value as THREE.Vector4[] | undefined;
  const height = (material.userData.uniforms.uWaveHeight?.value as number | undefined) ?? 0;
  if (!waves || !height) return 0;
  let sum = 0;
  for (const w of waves) sum += w.w;
  return sum * height;
}

/**
 * Splashes: short-lived droplets thrown up where something moves fast through the surface.
 * A single point cloud, updated on the CPU, drawn additively with a soft round sprite.
 */
export class Splashes {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private next = 0;
  private alive = 0;

  constructor(max = 600) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(99);
    this.life = new Float32Array(max).fill(1);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max).fill(0.1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: Splashes.sprite() } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aSize;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * 400.0 / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vec3(0.72, 0.8, 0.88), t.a * vAlpha * 0.42);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      fog: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    geo.setDrawRange(0, 0);
  }

  private static sprite(): THREE.Texture {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Throw `count` droplets from a point, mostly sideways from the mover's direction and upwards. */
  spawn(x: number, y: number, z: number, count: number, vx: number, vz: number): void {
    const speed = Math.hypot(vx, vz);
    const dx = speed > 1e-3 ? vx / speed : 0;
    const dz = speed > 1e-3 ? vz / speed : 0;
    for (let i = 0; i < count; i++) {
      const k = this.next;
      this.next = (this.next + 1) % this.max;
      const spread = (Math.random() - 0.5) * 1.6;
      const side = Math.random() < 0.5 ? -1 : 1;
      const out = 0.6 + Math.random() * 1.2 + speed * 0.15;
      this.pos[k * 3] = x + (Math.random() - 0.5) * 0.5;
      this.pos[k * 3 + 1] = y + 0.05;
      this.pos[k * 3 + 2] = z + (Math.random() - 0.5) * 0.5;
      this.vel[k * 3] = (dx * 0.4 - dz * side * 0.8) * out + spread * 0.3;
      this.vel[k * 3 + 1] = 1.2 + Math.random() * 1.6 + speed * 0.12;
      this.vel[k * 3 + 2] = (dz * 0.4 + dx * side * 0.8) * out + spread * 0.3;
      this.age[k] = 0;
      this.life[k] = 0.4 + Math.random() * 0.45;
      this.alpha[k] = 1;
      // Droplet size grows with speed up to a brisk run, then stays put.
      this.size[k] = (0.06 + 0.022 * Math.min(speed, 7)) * (0.7 + Math.random() * 0.6);
    }
    this.alive = this.max;
  }

  update(dt: number, waterHeightAt: (x: number, z: number) => number): void {
    if (!this.alive) return;
    let live = 0;
    for (let k = 0; k < this.max; k++) {
      if (this.age[k] >= this.life[k]) {
        this.alpha[k] = 0;
        continue;
      }
      this.age[k] += dt;
      this.vel[k * 3 + 1] -= 9.81 * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      this.alpha[k] = (1 - this.age[k] / this.life[k]) * 0.9;
      // Droplets that fall back below the surface are done.
      if (this.vel[k * 3 + 1] < 0 && this.pos[k * 3 + 1] < waterHeightAt(this.pos[k * 3], this.pos[k * 3 + 2]) - 0.05) this.age[k] = this.life[k];
      live++;
    }
    this.alive = live;
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.max);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.ShaderMaterial).dispose();
  }
}
