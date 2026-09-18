// Lava drawn as the client drew it (effect/water_lava_textured.eft, a_lava_textured_ps14.psh): a
// mipmapped 3D noise picks a colour from the shader's ramp over a crust, the flow moves the noise, and
// the ramp's alpha times the shader's bloom factor decides which veins glow. Emissive, unlit and opaque.
//
// Coordinates. The noise is sampled at the world position with y up (`LAVA_LOOK.axes`), which is an
// inference: the client's vertex program takes a float3 `tc0` whose contents the shader does not say.
// The crust is sampled at the noise's .xz, which is only a sensible planar mapping with y up, and every
// retail flow then runs mostly through y, so "still" lava boils in place. `__debug.lava({ axes: 'xzy' })`
// swaps it live. The game's X is the client's mirrored, so the pattern is the client's seen in a mirror;
// every retail flow has no X component, so nothing moves the other way.
import * as THREE from 'three';
import type { AssetPack } from './assetPack';
import type { SwgWaterTable } from './swgTerrain';
import type { LavaHeatTable } from './heatSources';
import { heatNoiseTexture, setupNoiseVolume } from './heatNoise';
import { HEAT_NOISE_SIZE } from './heatNoiseData';
import { decodeRamp, lavaFarValues, noiseFits, standInRamp, type LavaStyle } from './lavaStyle';

/** The reconversion that writes each lava shader's look, for the warnings. */
const RECONVERT = 'npm run swg -- water @SWG all assets-private --retail-only';

/** One set of look uniforms shared by every lava material, so __debug.lava tunes them all at once. */
export const LAVA_LOOK: {
  intensity: THREE.IUniform<number>;
  glow: THREE.IUniform<number>;
  glowFrom: THREE.IUniform<number>;
  glowTo: THREE.IUniform<number>;
  axes: THREE.IUniform<THREE.Matrix3>;
} = {
  /** Overall brightness of the ramp's colour. */
  intensity: { value: 1.6 },
  /** How far above the base a full vein is pushed: past bloom's threshold. */
  glow: { value: 2.5 },
  /** The glow's step on ramp alpha × texture factor: about the top tenth of the client's noise glows. */
  glowFrom: { value: 0.203 },
  glowTo: { value: 0.213 },
  /** Identity: the client's tc0 read as world (x, y, z), y up. */
  axes: { value: new THREE.Matrix3() },
};

export interface LavaTextures {
  noise: THREE.Data3DTexture;
  noiseData: Uint8Array;
  noiseTexels: number;
  ramp: THREE.DataTexture;
  rampData: Uint8Array;
  rampWidth: number;
  mix: THREE.Texture | null;
  /** 'client' when every piece the style names loaded, 'partial' when some fell back, 'stand-in' for the stand-in style. */
  source: 'client' | 'partial' | 'stand-in';
}

function rampTexture(bytes: Uint8Array, width: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(bytes, width, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

let standInRampTex: THREE.DataTexture | null = null;
/** The stand-in ramp, one module singleton, never disposed. */
function standInRampTexture(): THREE.DataTexture {
  if (!standInRampTex) {
    standInRampTex = rampTexture(standInRamp(), 256);
    standInRampTex.name = 'lava-ramp-stand-in';
  }
  return standInRampTex;
}

function textureBytes(tex: THREE.DataTexture | THREE.Data3DTexture): Uint8Array {
  return (tex.image as { data: Uint8Array }).data;
}

/** Pack files that already failed for a cache (one planet's load): tried and warned about once, not per look. */
const failedFor = new WeakMap<Map<string, THREE.Texture>, Set<string>>();
function failedSet(cache: Map<string, THREE.Texture>): Set<string> {
  let s = failedFor.get(cache);
  if (!s) {
    s = new Set();
    failedFor.set(cache, s);
  }
  return s;
}

/**
 * The style's textures. Every piece falls back on its own and nothing throws: a ramp that does not decode
 * is the stand-in ramp; a crust that fails to load is dropped (no USE_MIX); a noise file that is missing or
 * not exactly its size is the runtime noise. Each fallback logs one warning naming the file and the
 * reconversion command. New textures are pushed to `owned`; `cache` (by pack path) shares a texture between looks.
 */
export async function loadLavaTextures(pack: AssetPack, style: LavaStyle, anisotropy: number, cache: Map<string, THREE.Texture>, owned: THREE.Texture[]): Promise<LavaTextures> {
  if (style.key.startsWith('stand-in')) return standInLavaTextures();
  let fellBack = false;

  // The ramp: inline in water.json, so its "path" in the cache is its own bytes.
  let ramp: THREE.DataTexture;
  let rampData: Uint8Array;
  let rampWidth: number;
  const decoded = decodeRamp(style.ramp);
  if (decoded && style.ramp) {
    const key = `ramp:${style.ramp.width}:${style.ramp.rgba}`;
    const cached = cache.get(key) as THREE.DataTexture | undefined;
    if (cached) ramp = cached;
    else {
      ramp = rampTexture(decoded, style.ramp.width);
      ramp.name = `lava-ramp:${style.key}`;
      cache.set(key, ramp);
      owned.push(ramp);
    }
    rampData = textureBytes(ramp);
    rampWidth = style.ramp.width;
  } else {
    console.warn(`lava: ${style.key} has no colour ramp that decodes, drawn with the stand-in ramp (${RECONVERT})`);
    fellBack = true;
    ramp = standInRampTexture();
    rampData = textureBytes(ramp);
    rampWidth = 256;
  }

  const failed = failedSet(cache);

  // The crust: a PNG in the pack; a missing file is a 404, which the loader rejects.
  let mix: THREE.Texture | null = null;
  if (style.mix) {
    const cached = cache.get(style.mix);
    if (cached) mix = cached;
    else if (failed.has(style.mix)) fellBack = true;
    else {
      try {
        const tex = await new THREE.TextureLoader().loadAsync(pack.url(style.mix));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = anisotropy;
        tex.name = `lava-mix:${style.mix}`;
        tex.needsUpdate = true;
        cache.set(style.mix, tex);
        owned.push(tex);
        mix = tex;
      } catch {
        console.warn(`lava: ${style.mix} did not load, ${style.key} is drawn without its crust (${RECONVERT})`);
        failed.add(style.mix);
        fellBack = true;
      }
    }
  }

  // The noise volume: its bytes as they are, used only when they are exactly its size.
  let noise: THREE.Data3DTexture | null = null;
  let noiseTexels = HEAT_NOISE_SIZE;
  const want = style.noise;
  if (want && !failed.has(want.file)) {
    const cachedNoise = cache.get(want.file) as THREE.Data3DTexture | undefined;
    if (cachedNoise) noise = cachedNoise;
    else {
      const bytes = await pack.bytes(want.file);
      if (bytes && noiseFits(bytes.byteLength, want.size)) {
        noise = new THREE.Data3DTexture(new Uint8Array(bytes), want.size[0], want.size[1], want.size[2]);
        setupNoiseVolume(noise);
        noise.name = `lava-noise:${want.file}`;
        cache.set(want.file, noise);
        owned.push(noise);
      } else {
        console.warn(`lava: ${want.file} is ${bytes ? `${bytes.byteLength} bytes, not ${want.size.join('x')}` : 'missing'}, ${style.key} is drawn on the runtime noise (${RECONVERT})`);
        failed.add(want.file);
      }
    }
    if (noise) noiseTexels = Math.max(want.size[0], want.size[1], want.size[2]);
  } else if (!want) console.warn(`lava: ${style.key} names no noise volume, drawn on the runtime noise (${RECONVERT})`);
  if (!noise) {
    fellBack = true;
    noise = heatNoiseTexture();
  }

  return { noise, noiseData: textureBytes(noise), noiseTexels, ramp, rampData, rampWidth, mix, source: fellBack ? 'partial' : 'client' };
}

/** The stand-in's textures: the shared runtime noise and the shared stand-in ramp (module singletons, never disposed). */
export function standInLavaTextures(): LavaTextures {
  const noise = heatNoiseTexture();
  const ramp = standInRampTexture();
  return { noise, noiseData: textureBytes(noise), noiseTexels: HEAT_NOISE_SIZE, ramp, rampData: textureBytes(ramp), rampWidth: 256, mix: null, source: 'stand-in' };
}

export type LavaMaterial = THREE.ShaderMaterial & {
  /** unlit keeps it out of the shadow cascades, whose hook is part of a program's key (World.adoptMaterials). */
  userData: { loopTime: number; style: string; source: LavaTextures['source']; unlit: true; far: { noise: Uint8Array; ramp: Uint8Array; rampWidth: number; style: LavaStyle } };
};

const LAVA_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform mat3 uTcAxes;       // LAVA_LOOK.axes: identity reads the client's tc0 as (x, y, z), y up (an inference)
uniform float uNoiseScale;  // tcScale / shaderSize
uniform vec3 uFlow;
uniform float uFlowTime;    // seconds modulo loopTime, from the CPU
varying vec3 vNoiseTc;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNoiseTc = (uTcAxes * world.xyz) * uNoiseScale - uFlow * uFlowTime;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const LAVA_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform highp sampler3D tNoise;
uniform sampler2D tRamp;
uniform sampler2D tMix;
uniform float uColorScale;
uniform float uColorBias;
uniform float uTextureFactor;
uniform float uIntensity;
uniform float uGlow;
uniform float uGlowFrom;
uniform float uGlowTo;
uniform float uIndexMean;
uniform float uGlowMean;
uniform float uNoiseTexels;
varying vec3 vNoiseTc;
void main() {
  // Noise texels per pixel, taken before anything branches: past a few the veins are smaller than a pixel.
  vec3 w = fwidth(vNoiseTc) * uNoiseTexels;
  float far = smoothstep(2.0, 8.0, max(w.x, max(w.y, w.z)));
  float index = texture(tNoise, vNoiseTc).r * uColorScale + uColorBias;   // mipmapped
  index = mix(index, uIndexMean, far);                                     // no sparkle, and a steady crust offset
  vec4 lava = texture2D(tRamp, vec2(clamp(index, 0.0, 1.0), 0.5));        // rgb decoded to linear by the sRGB texture; alpha as stored
  vec3 rgb = lava.rgb;
  #ifdef USE_MIX
  vec3 crust = texture2D(tMix, vNoiseTc.xz + index * 0.1).rgb;            // sampled outside the branch, so its derivatives are defined
  rgb = index < 0.5 ? mix(crust, lava.rgb, clamp(index, 0.0, 1.0) * 2.0) : lava.rgb;
  #endif
  // The client's bloom strength (texture factor x ramp alpha) decides how far a vein is pushed past
  // bloom's threshold; where the veins are sub-pixel, their mean glow keeps far lava as bright on
  // average as near lava.
  float glow = mix(smoothstep(uGlowFrom, uGlowTo, lava.a * uTextureFactor), uGlowMean, far);
  rgb *= uIntensity * (1.0 + uGlow * glow);
  gl_FragColor = vec4(rgb, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Emissive, unlit, opaque lava: the client's noise-indexed colour ramp over a crust, flowing. No lights, no environment map, no shadows. */
export function createLavaMaterial(style: LavaStyle, shaderSize: number, textures: LavaTextures): LavaMaterial {
  const size = shaderSize > 0 && Number.isFinite(shaderSize) ? shaderSize : 2;
  const far = lavaFarValues(textures.noiseData, textures.rampData, textures.rampWidth, style, LAVA_LOOK.glowFrom.value, LAVA_LOOK.glowTo.value);
  const material = new THREE.ShaderMaterial({
    name: `lava:${style.key}`,
    vertexShader: LAVA_VERT,
    fragmentShader: LAVA_FRAG,
    uniforms: {
      tNoise: { value: textures.noise },
      tRamp: { value: textures.ramp },
      tMix: { value: textures.mix ?? textures.ramp },
      uNoiseScale: { value: style.tcScale / size },
      uNoiseTexels: { value: textures.noiseTexels },
      uFlow: { value: new THREE.Vector3(style.flow[0], style.flow[1], style.flow[2]) },
      uFlowTime: { value: 0 },
      uColorScale: { value: style.colorScale },
      uColorBias: { value: style.colorBias },
      uTextureFactor: { value: style.textureFactor },
      uIndexMean: { value: far.indexMean },
      uGlowMean: { value: far.glowMean },
      uIntensity: LAVA_LOOK.intensity,
      uGlow: LAVA_LOOK.glow,
      uGlowFrom: LAVA_LOOK.glowFrom,
      uGlowTo: LAVA_LOOK.glowTo,
      uTcAxes: LAVA_LOOK.axes,
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    },
    defines: textures.mix ? { USE_MIX: '' } : {},
    fog: true,
    lights: false,
    transparent: false,
    depthWrite: true,
    // As the water is: a player who dives in sees a ceiling.
    side: THREE.DoubleSide,
    // The lava's depth is pushed back by about one pixel's depth slope, so where the ground meets it at
    // a shallow angle the ground wins ties instead of flickering. Render state, not the program key.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  }) as LavaMaterial;
  material.userData = {
    loopTime: style.loopTime,
    style: style.key,
    source: textures.source,
    unlit: true,
    far: { noise: textures.noiseData, ramp: textures.rampData, rampWidth: textures.rampWidth, style },
  };
  return material;
}

/** Recompute a material's uIndexMean and uGlowMean from LAVA_LOOK's thresholds (after __debug.lava changed them). */
export function refreshLavaFar(material: LavaMaterial): void {
  const f = material.userData.far;
  const v = lavaFarValues(f.noise, f.ramp, f.rampWidth, f.style, LAVA_LOOK.glowFrom.value, LAVA_LOOK.glowTo.value);
  material.uniforms.uIndexMean.value = v.indexMean;
  material.uniforms.uGlowMean.value = v.glowMean;
}

/** A table's polygon triangulated at its height, every triangle turned to face up (+Y), positions and index only. */
export function lavaGeometry(table: SwgWaterTable): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pts = table.points.map((p) => new THREE.Vector2(p.x, p.z));
  const pos = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => {
    pos[i * 3] = p.x;
    pos[i * 3 + 1] = table.height;
    pos[i * 3 + 2] = p.y;
  });
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const tris = pts.length >= 3 ? THREE.ShapeUtils.triangulateShape(pts, []) : [];
  if (!tris.length) return g;
  const index: number[] = [];
  for (const [a, b, c] of tris) {
    // The game's X is mirrored, so windings arrive either way: a triangle facing down is turned over.
    const ny = (pts[b].y - pts[a].y) * (pts[c].x - pts[a].x) - (pts[b].x - pts[a].x) * (pts[c].y - pts[a].y);
    if (ny < 0) index.push(a, c, b);
    else index.push(a, b, c);
  }
  g.setIndex(index);
  return g;
}

/** The heat haze's view of one table: its geometry, height, bounds and outline as x, z pairs. */
export function lavaHeatTable(table: SwgWaterTable, geometry: THREE.BufferGeometry): LavaHeatTable {
  const points = new Float32Array(table.points.length * 2);
  table.points.forEach((p, i) => {
    points[i * 2] = p.x;
    points[i * 2 + 1] = p.z;
  });
  return { name: table.name, geometry, height: table.height, minX: table.minX, maxX: table.maxX, minZ: table.minZ, maxZ: table.maxZ, points };
}
