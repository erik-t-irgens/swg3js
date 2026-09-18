// The weather's shared uniforms and the wet look they drive: one set of objects joined by
// reference into every material that reads the weather (the falling effects' own shader, the
// ground, the water and every world material wrapped in the material scan), so one write per
// frame reaches all of them and nothing ever changes a material's program. Rain starting, rain
// stopping, wet ground switched off in the menu: all of it moves uniforms; the wet code is
// compiled into each program once, when the material first joins, and skipped by a branch
// while everything is dry.
import * as THREE from 'three';

/** Stands for "no surface known here" in the roof map (the same value as the roof grid's ROOF_OPEN). */
const OPEN = -1e9;

/** A 1×1 R32F DataTexture holding "open": the roof map with no grid. uRoofMap starts as it, and uRoofGrid as (0, 0, 1, 1). */
export const OPEN_ROOF_MAP: THREE.DataTexture = (() => {
  const t = new THREE.DataTexture(new Float32Array([OPEN]), 1, 1, THREE.RedFormat, THREE.FloatType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
})();

/** The grid uniform while there is no roof grid: one cell at the origin, which the open map says is open. */
export const OPEN_ROOF_GRID = new THREE.Vector4(0, 0, 1, 1);

/** Shared by reference into every hooked material's uniforms. */
export const WEATHER_UNIFORMS: {
  uWetness: THREE.IUniform<number>;
  uPuddles: THREE.IUniform<number>;
  uRain: THREE.IUniform<number>;
  uSnowCover: THREE.IUniform<number>;
  uWeatherTime: THREE.IUniform<number>;
  uWetSky: THREE.IUniform<THREE.Color>;
  uRoofMap: THREE.IUniform<THREE.Texture>;
  uRoofGrid: THREE.IUniform<THREE.Vector4>;
} = {
  uWetness: { value: 0 },
  uPuddles: { value: 0 },
  uRain: { value: 0 },
  uSnowCover: { value: 0 },
  uWeatherTime: { value: 0 },
  uWetSky: { value: new THREE.Color(0.5, 0.55, 0.6) },
  uRoofMap: { value: OPEN_ROOF_MAP },
  uRoofGrid: { value: OPEN_ROOF_GRID },
};

/** False when localStorage 'swg.weather.wrap' is '0' (read once): world materials are not wrapped, for a cost baseline. */
export const WET_WRAP: boolean = (() => {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem('swg.weather.wrap') !== '0';
  } catch {
    return true;
  }
})();

/**
 * Declarations and functions every hooked fragment shader includes (after `#include <common>`):
 * the uniforms, the world position and geometric normal from the vertex stage, a small value
 * noise, and the shelter test against the roof grid.
 */
export const WEATHER_PARS_GLSL = /* glsl */ `
uniform float uWetness;
uniform float uPuddles;
uniform float uRain;
uniform float uSnowCover;
uniform float uWeatherTime;
uniform vec3 uWetSky;
uniform highp sampler2D uRoofMap;
uniform vec4 uRoofGrid;
varying vec3 vWetPos;
varying vec3 vWetUp;

float wetHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float wetNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wetHash(i), wetHash(i + vec2(1.0, 0.0)), f.x), mix(wetHash(i + vec2(0.0, 1.0)), wetHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// x: 0 open to the sky .. 1 under something, bilinear over the four nearest cells of the roof grid.
// y: coverage, 0 within a cell of the grid's edge or beyond it, 1 two cells in.
// n is the surface's world normal (unit or zero).
vec2 weatherShelter(vec3 wp, vec3 n) {
  float cell = max(uRoofGrid.z, 1e-3);
  float cells = uRoofGrid.w;
  // A wall or a slope looks at the column beside it, out along its normal, not at its own roof.
  float side = length(n.xz);
  vec2 xz = wp.xz + (side > 1e-3 ? n.xz / side : vec2(0.0)) * min(side, 1.0) * 0.75 * cell;
  vec2 g = (xz - uRoofGrid.xy) / cell - 0.5;
  float edge = min(min(g.x, g.y), min(cells - 1.0 - g.x, cells - 1.0 - g.y));
  if (!(edge > 0.0)) return vec2(0.0);
  ivec2 i = ivec2(floor(g));
  vec2 f = fract(g);
  // A sloped roof's own surface sits below the top its bilinear neighbours report: allow a cell's
  // rise on a slope, and nothing extra for walls (their offset already moved them off their roof).
  float up = max(n.y, 0.0);
  float slope = sqrt(max(1.0 - up * up, 0.0)) / max(up, 0.25);
  float tol = 0.35 + cell * min(slope, 1.5) * smoothstep(0.2, 0.4, up);
  float y = wp.y + tol;
  float s00 = step(y, texelFetch(uRoofMap, i, 0).r);
  float s10 = step(y, texelFetch(uRoofMap, i + ivec2(1, 0), 0).r);
  float s01 = step(y, texelFetch(uRoofMap, i + ivec2(0, 1), 0).r);
  float s11 = step(y, texelFetch(uRoofMap, i + ivec2(1, 1), 0).r);
  // Toward the grid's edge the shelter fades to open over four cells, so nothing pops where the grid ends.
  float shelter = mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y) * smoothstep(0.0, 4.0, edge);
  return vec2(shelter, smoothstep(1.0, 2.0, edge));
}
`;

/** The rain ring slope function (water and ground); needs WEATHER_PARS_GLSL's hash before it. */
export const RAIN_RINGS_GLSL = /* glsl */ `
// Slope of rain rings at p: one drop per 0.55 m cell at a random place and phase, fewer when density is low.
vec2 rainRingSlope(vec2 p, float time, float density) {
  vec2 cell = floor(p / 0.55);
  vec2 slope = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int k = -1; k <= 1; k++) {
      vec2 c = cell + vec2(float(k), float(j));
      float h1 = wetHash(c * 1.37 + 0.11);
      if (h1 > density) continue;
      vec2 centre = (c + vec2(wetHash(c * 2.91 + 5.3), wetHash(c * 0.73 + 9.7))) * 0.55;
      float t = fract(time * 0.85 + h1 * 13.7);
      vec2 d = p - centre;
      float r = length(d);
      float x = r - t * 0.5;
      float env = exp(-x * x * 700.0) * (1.0 - t) * (1.0 - t);
      slope += (d / max(r, 1e-3)) * sin(x * 55.0) * env;
    }
  }
  return slope * 0.35;
}
`;

/** Vertex: the varyings, after `#include <common>`. */
const WET_VERTEX_PARS = /* glsl */ `
varying vec3 vWetPos;
varying vec3 vWetUp;
`;

/**
 * Vertex, after `#include <project_vertex>` (skinning and morphs have already changed `transformed`
 * and `objectNormal`): the world position and the geometric world normal, in project_vertex's own
 * order (batching, then instancing, then the model).
 */
const WET_VERTEX = /* glsl */ `
{
  vec4 wetWorld = vec4(transformed, 1.0);
  mat3 wetBasis = mat3(modelMatrix);
  #ifdef USE_INSTANCING
    wetBasis = wetBasis * mat3(instanceMatrix);
  #endif
  #ifdef USE_BATCHING
    wetWorld = batchingMatrix * wetWorld;
    wetBasis = wetBasis * mat3(batchingMatrix);
  #endif
  #ifdef USE_INSTANCING
    wetWorld = instanceMatrix * wetWorld;
  #endif
  vWetPos = (modelMatrix * wetWorld).xyz;
  vWetUp = wetBasis * objectNormal;
}
`;

/**
 * Fragment, after `#include <color_fragment>`: how wet, how much puddle and how much snow this
 * pixel is, and the darkening and whitening that follow. Every name starts `wet` so nothing in
 * three's chunks or a hook before ours is shadowed. The ground adds puddles; objects only darken,
 * gloss, whiten and reflect.
 */
function wetColourGlsl(ground: boolean): string {
  const facing = ground
    ? 'smoothstep(0.2, 0.8, wetUpY)'
    : '0.45 * smoothstep(-0.3, 0.2, wetUpY) + 0.55 * smoothstep(0.3, 0.9, wetUpY)';
  const puddles = ground
    ? `
    // Puddles: flat ground near the camera, only where the roof grid is known.
    float wetNear = 1.0 - smoothstep(24.0, 33.0, distance(vWetPos.xz, cameraPosition.xz));
    float wetField = wetNoise(vWetPos.xz * 0.23) * 0.65 + wetNoise(vWetPos.xz * 0.61 + 17.0) * 0.35;
    wetPuddle = uPuddles > 0.001 ? smoothstep(1.02 - 0.55 * uPuddles, 1.1 - 0.55 * uPuddles, wetField) * smoothstep(0.93, 0.99, wetUpY) * wetOpen * wetShelter.y * wetNear : 0.0;`
    : '';
  return /* glsl */ `
float wetSurface = 0.0;
float wetPuddle = 0.0;
float wetSnow = 0.0;
if (uWetness + uSnowCover > 0.0005) {
  // Unit normal, or zero for a degenerate one (no NaN).
  vec3 wetN = vWetUp / max(length(vWetUp), 1e-4);
  // The side being drawn: a double-sided leaf's or awning's underside faces down.
  #ifdef DOUBLE_SIDED
    wetN *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
  #ifdef FLIP_SIDED
    wetN = -wetN;
  #endif
  float wetUpY = wetN.y;
  vec2 wetShelter = weatherShelter(vWetPos, wetN);
  float wetOpen = 1.0 - wetShelter.x;
  float wetFacing = ${facing};
  wetSurface = clamp(uWetness * wetFacing * wetOpen, 0.0, 1.0);${puddles}
  wetSnow = clamp(uSnowCover * smoothstep(0.5, 0.9, wetUpY) * wetOpen, 0.0, 1.0);
  // Porous-looking surfaces (rough ones) darken more; the material's own factor, not its map.
  float wetPorous = smoothstep(0.35, 0.9, roughness);
  diffuseColor.rgb *= 1.0 - wetSurface * (0.15 + 0.3 * wetPorous) - wetPuddle * 0.2;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.83, 0.88), wetSnow);
}
`;
}

/** Fragment, after `#include <roughnessmap_fragment>`: wet is glossy, a puddle a mirror, snow matte. */
const WET_ROUGHNESS = /* glsl */ `
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.28), wetSurface);
roughnessFactor = mix(roughnessFactor, 0.04, wetPuddle);
roughnessFactor = mix(roughnessFactor, 0.85, wetSnow);
`;

/** Fragment, after `#include <normal_fragment_maps>` (ground only): rings where rain falls in a puddle. */
const WET_NORMAL = /* glsl */ `
if (wetPuddle > 0.001 && uRain > 0.001) {
  vec2 wetRing = rainRingSlope(vWetPos.xz, uWeatherTime, uRain) * wetPuddle;
  vec3 wetRingN = normalize(vec3(-wetRing.x, 1.0, -wetRing.y));
  vec3 wetMixed = mix(normal, normalize((viewMatrix * vec4(wetRingN, 0.0)).xyz), wetPuddle);
  float wetLen = length(wetMixed);
  if (wetLen > 1e-4) normal = wetMixed / wetLen;
}
`;

/**
 * Fragment, after `#include <lights_fragment_end>`. Ground and buildings have no environment map,
 * so a wet sheen needs a reflection of its own: the sky's colour at grazing angles.
 */
const WET_SHEEN = /* glsl */ `
if (wetSurface + wetPuddle > 0.001) {
  float wetFres = 0.02 + 0.98 * pow(1.0 - saturate(dot(normal, geometryViewDir)), 5.0);
  reflectedLight.indirectSpecular += uWetSky * wetFres * (wetSurface * 0.3 + wetPuddle * 0.85) * (1.0 - wetSnow);
}
`;

/** Say once per mode and chunk that a shader lacks a stage the wet look needs. */
function warnMissing(where: string, chunk: string): void {
  const key = `${where}:${chunk}`;
  if (missingChunks.has(key)) return;
  missingChunks.add(key);
  console.warn(`wetness: a ${where} shader has no ${chunk}; the wet look is left out of it`);
}
const missingChunks = new Set<string>();

/** Insert `code` after the first `chunk` in `source` (checked present by the caller). */
function after(source: string, chunk: string, code: string): string {
  const end = source.indexOf(chunk) + chunk.length;
  return `${source.slice(0, end)}\n${code}${source.slice(end)}`;
}

/**
 * Inject wetness into a MeshStandardMaterial's (or MeshPhysicalMaterial's) shader. 'ground' adds
 * puddles and rain rings in them; 'object' only darkens, glosses, snows and reflects. The chunk
 * set must be the whole of it or none: a declaration without its use compiles, a use without its
 * declaration does not, so the fragment's declarations go in first and everything after reads
 * variables the colour stage declared at the top level of main().
 */
export function injectWetness(shader: THREE.WebGLProgramParametersWithUniforms, mode: 'ground' | 'object'): void {
  const ground = mode === 'ground';
  const fs = shader.fragmentShader;
  // Every stage we write into must be there, or the shader is left as it was (a use without a
  // declaration would fail to compile, and a failed program is a black box in the frame).
  const needs = ['#include <common>', '#include <color_fragment>', '#include <roughnessmap_fragment>', '#include <lights_fragment_end>'];
  if (ground) needs.push('#include <normal_fragment_maps>');
  const vs = shader.vertexShader;
  const lacking = needs.find((c) => !fs.includes(c)) ?? ['#include <common>', '#include <project_vertex>'].find((c) => !vs.includes(c));
  if (lacking) {
    warnMissing(mode, lacking);
    return;
  }
  shader.vertexShader = after(after(vs, '#include <common>', WET_VERTEX_PARS), '#include <project_vertex>', WET_VERTEX);
  let f = after(fs, '#include <common>', WEATHER_PARS_GLSL + (ground ? RAIN_RINGS_GLSL : ''));
  f = after(f, '#include <color_fragment>', wetColourGlsl(ground));
  f = after(f, '#include <roughnessmap_fragment>', WET_ROUGHNESS);
  if (ground) f = after(f, '#include <normal_fragment_maps>', WET_NORMAL);
  f = after(f, '#include <lights_fragment_end>', WET_SHEEN);
  shader.fragmentShader = f;
  Object.assign(shader.uniforms, WEATHER_UNIFORMS);
}

/**
 * Whether a scene material should weather: opaque standard materials of plain and instanced
 * meshes in the open world. Left out: anything skinned (characters, creatures), anything held
 * under a bone, anything under a group marked `userData.weatherDry` (the player's figure, another
 * player's ship), materials marked `dry` (every ship's own, its rooms), rooms, glass, water, the
 * ground (it carries its own), unlit and invisible materials.
 */
export function isWettable(m: THREE.Material, owner: THREE.Object3D): boolean {
  if (!(owner as THREE.Mesh).isMesh || (owner as THREE.SkinnedMesh).isSkinnedMesh) return false;
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial || s.transparent) return false;
  const u = m.userData;
  if (u.interior || u.dry || u.glass || u.water || u.wetBuiltIn || u.invisible || u.unlit) return false;
  if (owner.userData.weatherDry) return false;
  // Held in a hand (a bone), part of a skinned figure, or under something marked dry.
  for (let o = owner.parent; o; o = o.parent) {
    if ((o as THREE.Bone).isBone || (o as THREE.SkinnedMesh).isSkinnedMesh || o.userData.weatherDry) return false;
  }
  return true;
}

/** Marks our own compile hook, so a material is never wrapped twice. */
const WET_HOOK = Symbol('wetObject');
type Hook = THREE.Material['onBeforeCompile'] & { [WET_HOOK]?: true };
/** The program key each wrapped material had before it was wrapped. */
const baseKeys = new WeakMap<THREE.Material, () => string>();

/**
 * Wrap a material's compile hook so the wet chunk follows whatever came before (the cascades'),
 * and key its program apart. Idempotent: a material already wrapped is left alone, and one whose
 * hook something replaced since (the cascades set up again) is wrapped again around the new hook,
 * with the key it had before the first wrap.
 */
export function applyWetness(mat: THREE.MeshStandardMaterial): void {
  const previous = mat.onBeforeCompile as Hook;
  if (previous[WET_HOOK]) return;
  const hook: Hook = function wetObject(this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) {
    previous.call(this, shader, renderer);
    injectWetness(shader, 'object');
  };
  hook[WET_HOOK] = true;
  mat.onBeforeCompile = hook;
  let base = baseKeys.get(mat);
  if (!base) {
    // Three's default key is the hook's source, which is now ours: the same for every wrapped material.
    base = mat.customProgramCacheKey;
    baseKeys.set(mat, base);
  }
  const key = base;
  mat.customProgramCacheKey = () => `wet-object|${key.call(mat)}`;
}

/** What the scan decided for each material, by the first mesh it was met on. */
const judged = new WeakMap<THREE.Material, boolean>();

/**
 * The material scan's call (World.adoptMaterials), made right after the cascades' setup and in the
 * same pass, so the wrap is in place before the material's program is ever asked for. A material
 * is judged once, by the first mesh the scan meets it on; a wettable one is (re)wrapped if its hook
 * is not ours, which is a no-op after the first time.
 */
export function wetWrap(m: THREE.Material, owner: THREE.Object3D): void {
  let wet = judged.get(m);
  if (wet === undefined) {
    wet = isWettable(m, owner);
    judged.set(m, wet);
  }
  if (wet) applyWetness(m as THREE.MeshStandardMaterial);
}
