import * as THREE from 'three';
import { registerReflective } from './envmap';

/**
 * Water: a physically based surface that reflects the sky's environment map, moved by a
 * wind-driven set of Gerstner waves on the deep-water dispersion relation (long waves travel
 * faster), with their phases warped by slow noise so the pattern never repeats, capillary
 * ripples bending the normal, foam on the steepest crests, and rings and wakes spreading from
 * whatever moves through it. Everything is evaluated in world space, so meshes tile without
 * seams and lakes share the same sea state as the ocean.
 */
export interface WaterMaterial extends THREE.MeshPhysicalMaterial {
  userData: { uniforms: { uTime: { value: number }; uWaveHeight: { value: number }; uRipple: { value: number } } };
}

const WAVE_COUNT = 8;
const RIPPLE_COUNT = 6;
/** Rings spreading from things that touch the water: shared by every water material. */
const MAX_RIPPLES = 32;
const RIPPLE_LIFE = 3.0;
/** Per ring: x, z, start time, strength; then direction x, z, speed, spare. */
const ringData = new Float32Array(MAX_RIPPLES * 4).fill(-1000);
const ringMotion = new Float32Array(MAX_RIPPLES * 4);
const RINGS = { value: ringData };
const RING_MOTION = { value: ringMotion };
let nextRing = 0;

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

/**
 * A sea state: waves spread around the wind direction, wavelengths spread from short chop to
 * long swell, amplitudes that grow with wavelength, and each wave's phase speed from the
 * dispersion relation c = sqrt(g * wavelength / 2 pi).
 */
function seaState(seed: number, windAngle: number): { waves: THREE.Vector4[]; omega: number[]; ripples: THREE.Vector4[]; rippleOmega: number[] } {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const waves: THREE.Vector4[] = [];
  const omega: number[] = [];
  for (let i = 0; i < WAVE_COUNT; i++) {
    // Wavelengths from 6 m to 70 m, roughly log-spaced with jitter; longer waves lean into the wind.
    const t = (i + rnd() * 0.8) / WAVE_COUNT;
    const wavelength = 6 * Math.pow(70 / 6, t);
    const spread = THREE.MathUtils.lerp(1.2, 0.35, t);
    const angle = windAngle + (rnd() - 0.5) * 2 * spread;
    const k = (2 * Math.PI) / wavelength;
    // Amplitude as a fraction of wavelength, smaller for the short chop; steepness stays below breaking.
    const amplitude = wavelength * THREE.MathUtils.lerp(0.004, 0.011, t) * (0.7 + rnd() * 0.6);
    waves.push(new THREE.Vector4(Math.cos(angle), Math.sin(angle), k, amplitude));
    omega.push(Math.sqrt(9.81 * k));
  }
  const ripples: THREE.Vector4[] = [];
  const rippleOmega: number[] = [];
  for (let i = 0; i < RIPPLE_COUNT; i++) {
    const wavelength = 0.5 + rnd() * 2.5;
    const angle = windAngle + (rnd() - 0.5) * Math.PI * 1.6;
    const k = (2 * Math.PI) / wavelength;
    ripples.push(new THREE.Vector4(Math.cos(angle), Math.sin(angle), k, 0.004 + rnd() * 0.01));
    rippleOmega.push(Math.sqrt(9.81 * k) * (0.8 + rnd() * 0.4));
  }
  return { waves, omega, ripples, rippleOmega };
}

const WAVES_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uRipple;
  uniform vec4 uWaves[${WAVE_COUNT}];
  uniform float uOmega[${WAVE_COUNT}];
  uniform vec4 uRippleWaves[${RIPPLE_COUNT}];
  uniform float uRippleOmega[${RIPPLE_COUNT}];
  uniform vec4 uRings[${MAX_RIPPLES}];
  uniform vec4 uRingMotion[${MAX_RIPPLES}];

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

  // Short wind ripples: slope only.
  vec2 rippleSlope(vec2 p) {
    vec2 g = vec2(0.0);
    float warp = phaseWarp(p * 3.0) * 0.5;
    for (int i = 0; i < ${RIPPLE_COUNT}; i++) {
      vec4 w = uRippleWaves[i];
      float k = w.z;
      float phase = k * dot(w.xy, p) - uRippleOmega[i] * uTime + warp;
      g += w.xy * (k * w.w * cos(phase));
    }
    return g * uRipple;
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
 * A water material. `waves` enables the vertex swell (only for finely divided meshes); lakes
 * with no interior vertices pass false and still ripple, foam and react.
 */
export function createWaterMaterial(color: THREE.ColorRepresentation, opacity: number, waves: boolean, windAngle = 0.9, seed = 7): WaterMaterial {
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
  const sea = seaState(seed, windAngle);
  const uniforms = {
    uTime: { value: 0 },
    uWaveHeight: { value: waves ? 1 : 0 },
    uRipple: { value: 1 },
    uWaves: { value: sea.waves },
    uOmega: { value: sea.omega },
    uRippleWaves: { value: sea.ripples },
    uRippleOmega: { value: sea.rippleOmega },
    uRings: RINGS,
    uRingMotion: RING_MOTION,
  };
  mat.userData = { uniforms };
  // Other systems (cascaded shadows, portals) assign their own compile hooks to every material
  // in the scene; ours must survive that, so later assignments are composed in front of it.
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
          // The swell fades out where the mesh is too coarse to carry it (the far ring is flat).
          float fade = uWaveHeight * (1.0 - smoothstep(900.0, 1400.0, dist));
          vec3 disp; vec3 n; float crest;
          gerstner(wp.xz, fade, disp, n, crest);
          transformed += disp;
          vWaterXZ = wp.xz + disp.xz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WAVES_GLSL}\nvarying vec2 vWaterXZ;\nvarying float vWaterDist;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // The same waves, this time per pixel: their normal, the wind ripples and the rings.
        // Evaluated here because three's colour and roughness stages run before its normal stage.
        vec3 waterNormalW;
        float waterFoam;
        {
          vec3 disp; vec3 wn; float crest;
          gerstner(vWaterXZ, 1.0, disp, wn, crest);
          float detail = 1.0 - smoothstep(80.0, 500.0, vWaterDist);
          vec2 slope = rippleSlope(vWaterXZ) * detail;
          float e = 0.06;
          slope += vec2(ringHeight(vWaterXZ + vec2(e, 0.0)) - ringHeight(vWaterXZ - vec2(e, 0.0)), ringHeight(vWaterXZ + vec2(0.0, e)) - ringHeight(vWaterXZ - vec2(0.0, e))) / (2.0 * e) * detail;
          waterNormalW = normalize(vec3(wn.x - slope.x, wn.y, wn.z - slope.y));
          // Foam where crests are steepest, and along fresh rings.
          waterFoam = smoothstep(0.62, 0.95, crest) * 0.55 + clamp(abs(ringHeight(vWaterXZ)) * 6.0, 0.0, 0.6) * detail;
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.97), waterFoam);
        diffuseColor.a = mix(diffuseColor.a, 1.0, waterFoam * 0.7);`,
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
  mat.customProgramCacheKey = () => `swg-water-${waves ? 'waves' : 'flat'}-${external ? 'hooked' : 'plain'}`;
  registerReflective(mat);
  return mat;
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
  private next = 0;
  private alive = 0;

  constructor(max = 600) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(99);
    this.life = new Float32Array(max).fill(1);
    this.alpha = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: Splashes.sprite() }, uSize: { value: 0.35 } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        uniform float uSize;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * 400.0 / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vec3(0.85, 0.92, 1.0) * t.rgb, t.a * vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
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
      this.life[k] = 0.5 + Math.random() * 0.5;
      this.alpha[k] = 1;
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
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.ShaderMaterial).dispose();
  }
}
