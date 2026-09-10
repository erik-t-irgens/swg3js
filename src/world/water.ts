import * as THREE from 'three';
import { registerReflective } from './envmap';

/**
 * Water: a physically based surface that reflects the sky's environment map, with a swell
 * displacing the vertices (where the mesh is fine enough) and ripples bending the normal.
 * Both are sums of sine waves evaluated in world space, so meshes tile without seams.
 */
export interface WaterMaterial extends THREE.MeshPhysicalMaterial {
  userData: { uniforms: { uTime: { value: number }; uWaveHeight: { value: number }; uRipple: { value: number } } };
}

/** Rings spreading from things that touch the water: x, z, start time, strength; shared by every water material. */
const MAX_RIPPLES = 24;
const RIPPLE_LIFE = 3.5;
const rippleData = new Float32Array(MAX_RIPPLES * 4).fill(-1000);
const RIPPLES = { value: rippleData };
let nextRipple = 0;

/** Start a ring at a world position; `strength` scales its height (1 for a person wading). */
export function emitRipple(x: number, z: number, strength: number, time: number): void {
  const o = nextRipple * 4;
  rippleData[o] = x;
  rippleData[o + 1] = z;
  rippleData[o + 2] = time;
  rippleData[o + 3] = strength;
  nextRipple = (nextRipple + 1) % MAX_RIPPLES;
}

const WAVES = /* glsl */ `
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uRipple;
  uniform vec4 uRipples[${MAX_RIPPLES}];
  // Height of the spreading rings at a point: a damped wave packet moving out from each source.
  float rippleHeight(vec2 p) {
    float h = 0.0;
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 rp = uRipples[i];
      float age = uTime - rp.z;
      if (age < 0.0 || age > ${RIPPLE_LIFE.toFixed(1)}) continue;
      float r = distance(p, rp.xy);
      float front = age * 1.6;
      float packet = exp(-pow((r - front) / 1.1, 2.0));
      float fade = exp(-age * 1.1) * (1.0 - age / ${RIPPLE_LIFE.toFixed(1)});
      h += rp.w * 0.35 * packet * fade * sin((r - front) * 7.0) / (1.0 + r * 0.35);
    }
    return h;
  }
  // Long swells: direction (x, z), wavelength in metres, speed in metres per second.
  const vec4 SWELL[3] = vec4[3](vec4(0.83, 0.55, 46.0, 5.0), vec4(-0.6, 0.8, 29.0, 4.2), vec4(0.2, -0.98, 71.0, 6.1));
  // Ripples for the normal only.
  const vec4 RIPPLE[4] = vec4[4](vec4(0.9, 0.44, 3.1, 1.3), vec4(-0.7, 0.71, 2.2, 1.0), vec4(0.3, -0.95, 5.3, 1.8), vec4(-0.95, -0.3, 1.4, 0.7));
  float swellHeight(vec2 p) {
    float h = 0.0;
    for (int i = 0; i < 3; i++) {
      vec4 w = SWELL[i];
      float k = 6.2831853 / w.z;
      h += sin(dot(w.xy, p) * k + uTime * w.w * k);
    }
    return h * uWaveHeight / 3.0;
  }
  vec3 waveNormal(vec2 p) {
    vec2 g = vec2(0.0);
    for (int i = 0; i < 3; i++) {
      vec4 w = SWELL[i];
      float k = 6.2831853 / w.z;
      g += w.xy * k * cos(dot(w.xy, p) * k + uTime * w.w * k) * (uWaveHeight / 3.0);
    }
    for (int i = 0; i < 4; i++) {
      vec4 w = RIPPLE[i];
      float k = 6.2831853 / w.z;
      g += w.xy * k * cos(dot(w.xy, p) * k + uTime * w.w * k) * (uRipple * 0.045);
    }
    // The rings' slope, by central differences.
    float e = 0.08;
    g += vec2(rippleHeight(p + vec2(e, 0.0)) - rippleHeight(p - vec2(e, 0.0)), rippleHeight(p + vec2(0.0, e)) - rippleHeight(p - vec2(0.0, e))) / (2.0 * e);
    return normalize(vec3(-g.x, 1.0, -g.y));
  }
`;

export function createWaterMaterial(color: THREE.ColorRepresentation, opacity: number, waves: boolean): WaterMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.08,
    metalness: 0,
    ior: 1.33,
    specularIntensity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 1,
  }) as WaterMaterial;
  const uniforms = { uTime: { value: 0 }, uWaveHeight: { value: waves ? 0.45 : 0 }, uRipple: { value: 1 } };
  mat.userData = { uniforms };
  // Other systems (cascaded shadows, portals) assign their own compile hooks to every material
  // in the scene; ours must survive that, so later assignments are composed in front of it.
  let external: ((shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void) | null = null;
  const ours = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => {
    external?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms, { uRipples: RIPPLES });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WAVES}\nvarying vec2 vWaterXZ;\nvarying float vWaterDist;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          vWaterXZ = wp.xz;
          float dist = distance(wp.xyz, cameraPosition);
          vWaterDist = dist;
          // The swell fades out where the mesh is too coarse (and the far ring is flat).
          float fade = 1.0 - smoothstep(900.0, 1400.0, dist);
          transformed.y += swellHeight(wp.xz) * fade;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WAVES}\nvarying vec2 vWaterXZ;\nvarying float vWaterDist;`)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // Ripples shrink with distance so the far water does not sparkle into noise.
          float rippleFade = 1.0 - smoothstep(60.0, 400.0, vWaterDist);
          vec3 wn = waveNormal(vWaterXZ);
          wn = normalize(mix(vec3(0.0, 1.0, 0.0), wn, rippleFade));
          vec3 vn = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          normal = normalize(mix(normal, vn, 0.9));
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
  mat.customProgramCacheKey = () => `swg-water-${waves ? 'waves' : 'flat'}-${external ? 'hooked' : 'plain'}`;
  registerReflective(mat);
  return mat;
}
