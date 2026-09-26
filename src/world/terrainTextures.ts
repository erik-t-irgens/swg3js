// Ground textures of a converted planet: the terrain's shader families, one texture each, packed
// into a texture array and blended per triangle the way the game paints them. The chunk builder
// gives every triangle the families of its three corners (aFamily) and each vertex its corner
// weight (aBary); the fragment shader samples the three textures at world scale and mixes them.

import * as THREE from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';
import type { AssetPack } from './assetPack';
import { injectWetness } from './wetness.ts';

/** One entry of terrain/shaders.json written by the converter. */
export interface ShaderFamilyDef {
  id: number;
  name: string;
  /** Metres per texture repeat. */
  size: number;
  /** Pack-relative PNG. */
  file: string;
  /**
   * The family's own bump map, pack-relative, or null where the archives have none for it.
   *
   * Absent (rather than null) means a pack converted before these were read: the ground is then
   * lit exactly as it always was, and `status` asks for the world again.
   */
  normal?: string | null;
  /**
   * The family's own gloss map, pack-relative, or null. The client's AUX0 slot, whose files are all
   * named `*_spec` and whose effect is `dot3_terrain_specmap`: the ground's shine.
   *
   * A file of its own rather than the bump map's alpha, because a browser drawing an image into a
   * 2D canvas premultiplies and a pixel with no gloss would come back with its normal wiped out.
   * The two are read into one texture at load all the same.
   */
  specular?: string | null;
}

/**
 * The marker the ground's own declarations end with, and the one place anything may be injected
 * after them.
 *
 * Three separate injections write into this shader at `#include <common>` -- the ground's own
 * textures, the weather's, and the bumps below -- and each of them inserts at the **first** match,
 * so the last to run lands **first** in the file. That put `uniform sampler2DArray uGroundNormal;`
 * above `precision highp sampler2DArray;` and `groundSlope()` above every uniform and varying it
 * reads, which is not a subtle error: the program fails to compile and the ground is not drawn at
 * all. A marker of its own makes the order of the calls stop mattering.
 */
const GROUND_DECLS_END = '// <ground-declarations-end>';

/**
 * The ground's own bumps, folded into the normal the lighting uses.
 *
 * Its declarations go after `GROUND_DECLS_END`, so they always follow the ground's own; its work
 * goes at `#include <normal_fragment_maps>`, which `injectWetness` has already written to, so this
 * block lands **before** the wetness one and a puddle's surface is laid over the ground's relief
 * rather than wiped out by it.
 *
 * Three things about the arithmetic. The ground's texture coordinate is world XZ, so the tangent is
 * world +X and the bitangent world +Z by construction -- no tangent frame is built and none should
 * be, which is also why three's own normal-map path cannot be used here (the ground carries no `uv`
 * attribute at all). Slopes are **added** rather than normals blended, which is exact when every
 * frame is the same one and is what the water already does for its two layers. And the green channel
 * is read as it stands, the way this project settled the question for every other surface.
 */
export function injectGroundNormal(shader: { fragmentShader: string; uniforms: Record<string, { value: unknown }> }, normals: THREE.DataArrayTexture | null, scale: { value: number }, gloss: { value: number } = { value: GROUND_NORMAL.gloss }): boolean {
  // A stage that is not there is left alone rather than written to: a use with no declaration does
  // not draw the ground wrongly, it does not draw the ground.
  if (!shader.fragmentShader.includes(GROUND_DECLS_END) || !shader.fragmentShader.includes('#include <normal_fragment_maps>') || !shader.fragmentShader.includes('#include <roughnessmap_fragment>')) return false;
  if (normals) shader.uniforms.uGroundNormal = { value: normals };
  shader.uniforms.uGroundNormalScale = scale;
  shader.uniforms.uGroundGloss = gloss;
  shader.fragmentShader = shader.fragmentShader
    .replace(
      GROUND_DECLS_END,
      `uniform sampler2DArray uGroundNormal;
uniform float uGroundNormalScale;
uniform float uGroundGloss;
// A family's bump and gloss at this point: the direction in rgb, the client's own specular mask in
// alpha, which the loader read out of a file of its own and put here.
vec4 groundBump(float family) {
  int id = clamp(int(family + 0.5), 0, TERRAIN_FAMILIES - 1);
  return texture(uGroundNormal, vec3(vGroundXZ / uGroundSize[id], uGroundLayer[id]));
}
// The height gradient a family's bump map asks for: a tangent-space normal (x, y, z) with z up
// gives the gradient -xy/z, and the tangent frame here is world X and world Z.
vec2 groundSlope(float family) {
  vec3 n = groundBump(family).xyz * 2.0 - 1.0;
  return -n.xy / max(n.z, 0.2);
}
${GROUND_DECLS_END}`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
{
  vec3 gw = vBary / max(vBary.x + vBary.y + vBary.z, 1e-4);
  vec2 gs = (groundSlope(vFamily.x) * gw.x + groundSlope(vFamily.y) * gw.y + groundSlope(vFamily.z) * gw.z) * uGroundNormalScale;
  // The ground's own lean, as a gradient, so the two add rather than one replacing the other: the
  // view matrix is orthonormal, so its transpose is its inverse and nothing new is uploaded.
  vec3 gN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec2 gg = vec2(-gN.x, -gN.z) / max(gN.y, 0.2);
  normal = normalize((viewMatrix * vec4(normalize(vec3(-(gg.x + gs.x), 1.0, -(gg.y + gs.y))), 0.0)).xyz);
}`,
    )
    // Before the weather's own roughness, which is written at the same stage and must have the last
    // word: wet stone is smoother than dry stone however glossy the dry stone was.
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
{
  vec3 gw = vBary / max(vBary.x + vBary.y + vBary.z, 1e-4);
  float gloss = groundBump(vFamily.x).a * gw.x + groundBump(vFamily.y).a * gw.y + groundBump(vFamily.z).a * gw.z;
  roughnessFactor = clamp(roughnessFactor - gloss * uGroundGloss, 0.08, 1.0);
}`,
    );
  return true;
}

const LAYER_SIZE = 512;
/**
 * Metres per texture repeat. The client gives every ground tile texture coordinates of
 * 0.25 x tile width per tile, whatever the family's shader size says, which works out to one
 * repeat every 4 m at every detail level (ClientProceduralTerrainAppearance_ClientChunk).
 */
const GROUND_REPEAT = 4;
/** Largest family id the uniform lookup arrays cover; ids are dense per planet, well under this. */
const MAX_FAMILY_ID = 127;

/**
 * How strongly the ground's own bumps lean the light. Ours, and live through `__debug.normals`.
 *
 * The client shaded this terrain per pixel with these maps and this game did not, which is why the
 * ground has been the flattest thing in it: the geometry normal is a smoothed difference of the
 * heightfield, so below the terrain's own step there was no variation at all.
 */
export const GROUND_NORMAL = {
  scale: 1,
  /**
   * How much of the client's own gloss mask is taken off the ground's roughness. Ours.
   *
   * The masks are low -- 0 to about 90 of 255 on most families -- so at 1 the shiniest ground goes
   * from fully matt to roughness 0.65, which is damp stone rather than a mirror.
   */
  gloss: 1,
};

/** Whether the owner has turned the ground's relief off by hand, which needs no build. */
function groundBumpOff(): boolean {
  try {
    return localStorage.getItem('swg.ground.bump') === '0';
  } catch {
    return false;
  }
}

export class TerrainTextures {
  readonly texture: THREE.DataArrayTexture;
  /** The same families' bump maps, layer for layer, or null for a pack converted before they were read. */
  readonly normals: THREE.DataArrayTexture | null;
  /** The live strength, written by the Graphics setting; the ground has no `normalMap` for the usual path to find. */
  private normalScale: { value: number } = { value: GROUND_NORMAL.scale };
  /** The live gloss, the same way: a uniform the material already holds, so nothing recompiles. */
  private glossScale: { value: number } = { value: GROUND_NORMAL.gloss };
  /** Family id → layer index; families without a texture use layer 0. */
  private readonly layerOf: Float32Array;
  private readonly sizeOf: Float32Array;
  readonly families: ShaderFamilyDef[];
  private material: THREE.MeshStandardMaterial | null = null;

  private readonly layerIndex: Map<number, number>;
  private readonly averages = new Map<number, THREE.Color>();

  private constructor(texture: THREE.DataArrayTexture, families: ShaderFamilyDef[], layers: Map<number, number>, planet: Map<number, string>, normals: THREE.DataArrayTexture | null = null) {
    this.texture = texture;
    this.normals = normals;
    this.families = families;
    this.layerIndex = layers;
    // Ids on the ground are the planet's (plus any a building's layer file added); the pack lists
    // textures by family name, so match by name first and by id when the name is unknown.
    const byName = new Map<string, number>();
    for (const f of families) {
      const layer = layers.get(f.id);
      if (layer !== undefined) byName.set(f.name.toLowerCase(), layer);
    }
    // The lookup arrays are shader uniforms, and every element costs a uniform slot, so they
    // are sized by the planet's own (small, dense) ids. Families a pack lists under other ids
    // (those a building's layer file added) reach the ground by name only.
    const ids = planet.size ? [...planet.keys()] : families.map((f) => f.id);
    const maxId = Math.min(MAX_FAMILY_ID, Math.max(0, ...ids));
    this.layerOf = new Float32Array(maxId + 1);
    this.sizeOf = new Float32Array(maxId + 1).fill(GROUND_REPEAT);
    for (const f of families) {
      const layer = layers.get(f.id);
      if (layer !== undefined && f.id <= maxId) this.layerOf[f.id] = layer;
    }
    const untextured: string[] = [];
    for (const [id, name] of planet) {
      const layer = byName.get(name.toLowerCase());
      if (layer !== undefined && id <= maxId) this.layerOf[id] = layer;
      else if (id <= maxId) untextured.push(`${id} ${name}`);
    }
    console.info(`ground textures: ${layers.size} loaded for ${planet.size || families.length} families${untextured.length ? `; without a texture (drawn with the first): ${untextured.join(', ')}` : ''}`);
  }

  /** Load the pack's ground textures, or null when it has none. */
  static async load(pack: AssetPack, anisotropy: number, planet: Map<number, string>): Promise<TerrainTextures | null> {
    const bytes = await pack.bytes('terrain/shaders.json');
    if (!bytes) return null;
    let families: ShaderFamilyDef[];
    try {
      families = (JSON.parse(new TextDecoder().decode(bytes)) as { families: ShaderFamilyDef[] }).families;
    } catch {
      return null;
    }
    families = families.filter((f) => f.file);
    if (!families.length) return null;
    const images = await Promise.all(families.map((f) => loadImage(pack.url(f.file))));
    const kept = families.filter((_, i) => images[i]);
    if (!kept.length) return null;
    const size = Math.min(LAYER_SIZE, Math.max(...images.filter(Boolean).map((im) => Math.max(im!.width, im!.height))));
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const data = new Uint8Array(size * size * 4 * kept.length);
    const layers = new Map<number, number>();
    kept.forEach((f, layer) => {
      const im = images[families.indexOf(f)]!;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(im, 0, 0, size, size);
      data.set(ctx.getImageData(0, 0, size, size).data, layer * size * size * 4);
      layers.set(f.id, layer);
    });
    const texture = new THREE.DataArrayTexture(data, size, size, kept.length);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = anisotropy;
    texture.needsUpdate = true;
    // The bump maps, as a second array of exactly the same shape, so the two share one layer
    // lookup: a family with no map of its own gets a flat layer rather than a missing one, which
    // keeps the indices identical and costs one layer of three bytes repeated.
    let normals: THREE.DataArrayTexture | null = null;
    // A way back to the flat, matt ground without a build, for the same reason the wetness wrap has
    // one: everything the relief and the gloss add is inside one shader program, and a program that
    // will not compile draws no ground at all. `localStorage['swg.ground.bump'] = '0'` and reload.
    if (kept.some((f) => f.normal || f.specular) && !groundBumpOff()) {
      const nImages = await Promise.all(kept.map((f) => (f.normal ? loadImage(pack.url(f.normal)) : Promise.resolve(null))));
      const sImages = await Promise.all(kept.map((f) => (f.specular ? loadImage(pack.url(f.specular)) : Promise.resolve(null))));
      const nData = new Uint8Array(size * size * 4 * kept.length);
      // Flat and matt everywhere first: (128, 128, 255) is straight up, and nought in the alpha is
      // no gloss at all, so a family with neither map is exactly the ground as it was.
      for (let i = 0; i < nData.length; i += 4) {
        nData[i] = 128;
        nData[i + 1] = 128;
        nData[i + 2] = 255;
        nData[i + 3] = 0;
      }
      kept.forEach((f, layer) => {
        const at = layer * size * size * 4;
        const im = nImages[layer];
        if (im) {
          ctx.clearRect(0, 0, size, size);
          ctx.drawImage(im, 0, 0, size, size);
          const px = ctx.getImageData(0, 0, size, size).data;
          // Only the direction: the alpha of that PNG is the converter's own opaque filler, and the
          // gloss is a file of its own because a 2D canvas cannot carry both.
          for (let i = 0; i < px.length; i += 4) {
            nData[at + i] = px[i];
            nData[at + i + 1] = px[i + 1];
            nData[at + i + 2] = px[i + 2];
          }
        }
        const sm = sImages[layer];
        if (sm) {
          ctx.clearRect(0, 0, size, size);
          ctx.drawImage(sm, 0, 0, size, size);
          const px = ctx.getImageData(0, 0, size, size).data;
          for (let i = 0; i < px.length; i += 4) nData[at + i + 3] = px[i];
        }
      });
      normals = new THREE.DataArrayTexture(nData, size, size, kept.length);
      // No colour space on a normal map: its bytes are a direction, not a colour.
      normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
      normals.minFilter = THREE.LinearMipmapLinearFilter;
      normals.magFilter = THREE.LinearFilter;
      normals.generateMipmaps = true;
      normals.anisotropy = anisotropy;
      normals.needsUpdate = true;
    }
    return new TerrainTextures(texture, kept, layers, planet, normals);
  }

  /**
   * The ground material: a standard lit material whose base colour comes from the blended family
   * textures. Cascaded shadows patch the same material, so their hook runs first and ours after.
   */
  groundMaterial(csm: CSM | null): THREE.MeshStandardMaterial {
    if (this.material) return this.material;
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    csm?.setupMaterial(mat);
    const previous = mat.onBeforeCompile;
    const count = this.layerOf.length;
    const texture = this.texture;
    const normals = this.normals;
    const layerOf = this.layerOf;
    const sizeOf = this.sizeOf;
    const normalScale = this.normalScale;
    const glossScale = this.glossScale;
    mat.onBeforeCompile = (shader, renderer) => {
      previous.call(mat, shader, renderer);
      shader.defines = { ...(shader.defines ?? {}), TERRAIN_FAMILIES: count };
      shader.uniforms.uGround = { value: texture };
      shader.uniforms.uGroundLayer = { value: layerOf };
      shader.uniforms.uGroundSize = { value: sizeOf };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aFamily;\nattribute vec3 aBary;\nvarying vec3 vFamily;\nvarying vec3 vBary;\nvarying vec2 vGroundXZ;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFamily = aFamily;\nvBary = aBary;\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uGround;\nuniform float uGroundLayer[TERRAIN_FAMILIES];\nuniform float uGroundSize[TERRAIN_FAMILIES];\nvarying vec3 vFamily;\nvarying vec3 vBary;\nvarying vec2 vGroundXZ;\nvec4 groundSample(float family) {\n  int id = clamp(int(family + 0.5), 0, TERRAIN_FAMILIES - 1);\n  return texture(uGround, vec3(vGroundXZ / uGroundSize[id], uGroundLayer[id]));\n}\n${GROUND_DECLS_END}`)
        .replace('#include <map_fragment>', '#include <map_fragment>\n{\n  vec3 w = vBary / max(vBary.x + vBary.y + vBary.z, 1e-4);\n  vec4 g = groundSample(vFamily.x) * w.x + groundSample(vFamily.y) * w.y + groundSample(vFamily.z) * w.z;\n  diffuseColor.rgb *= g.rgb;\n}');
      // Rain, puddles and snow: after the blend (map_fragment), so wetness darkens the blended
      // colour. Compiled in once and driven by the weather's shared uniforms.
      injectWetness(shader, 'ground');
      if (normals && !injectGroundNormal(shader, normals, normalScale, glossScale)) console.warn('the ground shader has no place for its bump and gloss maps; the ground is lit flat and matt');
    };
    // The ground carries its own wet injection; the material scan must not wrap it again.
    mat.userData.wetBuiltIn = true;
    mat.customProgramCacheKey = () => `swg-ground-wet-${count}-${normals ? 'bump' : 'flat'}`;
    this.material = mat;
    return mat;
  }

  /**
   * How strongly the ground's bumps lean the light, live. Answers whether there were any to move.
   *
   * It is a uniform the material already holds, so nothing is recompiled and nothing is rebuilt.
   */
  setNormalScale(x: number): boolean {
    this.normalScale.value = x;
    GROUND_NORMAL.scale = x;
    return !!this.normals;
  }

  /** How much of the client's gloss mask the ground wears, live. Answers whether there was one. */
  setGloss(x: number): boolean {
    this.glossScale.value = x;
    GROUND_NORMAL.gloss = x;
    return !!this.normals;
  }

  /** How many families brought a bump map and how many a gloss map, for the console. */
  get mapCounts(): { bumped: number; glossy: number; of: number } {
    return { bumped: this.families.filter((f) => f.normal).length, glossy: this.families.filter((f) => f.specular).length, of: this.families.length };
  }

  /** The mean colour of a family's texture (its layer's pixels, sampled sparsely), for dust and spray; null without one. */
  averageColor(familyId: number): THREE.Color | null {
    const layer = this.layerIndex.get(familyId);
    if (layer === undefined) return null;
    let c = this.averages.get(familyId);
    if (c) return c;
    const img = this.texture.image as { data: Uint8Array; width: number; height: number };
    const per = img.width * img.height * 4;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = layer * per; i < (layer + 1) * per; i += 4 * 37) {
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      n++;
    }
    c = new THREE.Color(r / n / 255, g / n / 255, b / n / 255).convertSRGBToLinear();
    this.averages.set(familyId, c);
    return c;
  }

  dispose(): void {
    this.texture.dispose();
    this.normals?.dispose();
    this.material?.dispose();
  }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = url;
  });
}
