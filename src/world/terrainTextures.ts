// Ground textures of a converted planet: the terrain's shader families, one texture each, packed
// into a texture array and blended per triangle the way the game paints them. The chunk builder
// gives every triangle the families of its three corners (aFamily) and each vertex its corner
// weight (aBary); the fragment shader samples the three textures at world scale and mixes them.

import * as THREE from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';
import type { AssetPack } from './assetPack';
import { injectWetness } from './wetness';

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
}

/**
 * The ground's own bumps, folded into the normal the lighting uses.
 *
 * Injected **after** `injectWetness` has run, which puts this block first at the same anchor: the
 * ground's own relief, and then a puddle's surface laid over it. The other order wipes the rain
 * rings out.
 *
 * Three things about the arithmetic. The ground's texture coordinate is world XZ, so the tangent is
 * world +X and the bitangent world +Z by construction -- no tangent frame is built and none should
 * be, which is also why three's own normal-map path cannot be used here (the ground carries no `uv`
 * attribute at all). Slopes are **added** rather than normals blended, which is exact when every
 * frame is the same one and is what the water already does for its two layers. And the green channel
 * is read as it stands, the way this project settled the question for every other surface.
 */
function injectGroundNormal(shader: { fragmentShader: string; uniforms: Record<string, { value: unknown }> }, normals: THREE.DataArrayTexture, scale: { value: number }): void {
  shader.uniforms.uGroundNormal = { value: normals };
  shader.uniforms.uGroundNormalScale = scale;
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform sampler2DArray uGroundNormal;
uniform float uGroundNormalScale;
// The height gradient a family's bump map asks for at this point: a tangent-space normal (x, y, z)
// with z up gives the gradient -xy/z, and the tangent frame here is world X and world Z.
vec2 groundSlope(float family) {
  int id = clamp(int(family + 0.5), 0, TERRAIN_FAMILIES - 1);
  vec3 n = texture(uGroundNormal, vec3(vGroundXZ / uGroundSize[id], uGroundLayer[id])).xyz * 2.0 - 1.0;
  return -n.xy / max(n.z, 0.2);
}`,
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
    );
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
export const GROUND_NORMAL = { scale: 1 };

export class TerrainTextures {
  readonly texture: THREE.DataArrayTexture;
  /** The same families' bump maps, layer for layer, or null for a pack converted before they were read. */
  readonly normals: THREE.DataArrayTexture | null;
  /** The live strength, written by the Graphics setting; the ground has no `normalMap` for the usual path to find. */
  private normalScale: { value: number } = { value: GROUND_NORMAL.scale };
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
    if (kept.some((f) => f.normal)) {
      const nImages = await Promise.all(kept.map((f) => (f.normal ? loadImage(pack.url(f.normal)) : Promise.resolve(null))));
      const nData = new Uint8Array(size * size * 4 * kept.length);
      // Flat everywhere first: (128, 128, 255) is straight up, so a family with no map leans nowhere.
      for (let i = 0; i < nData.length; i += 4) {
        nData[i] = 128;
        nData[i + 1] = 128;
        nData[i + 2] = 255;
        nData[i + 3] = 255;
      }
      kept.forEach((f, layer) => {
        const im = nImages[layer];
        if (!im) return;
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(im, 0, 0, size, size);
        nData.set(ctx.getImageData(0, 0, size, size).data, layer * size * size * 4);
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
        .replace('#include <common>', '#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uGround;\nuniform float uGroundLayer[TERRAIN_FAMILIES];\nuniform float uGroundSize[TERRAIN_FAMILIES];\nvarying vec3 vFamily;\nvarying vec3 vBary;\nvarying vec2 vGroundXZ;\nvec4 groundSample(float family) {\n  int id = clamp(int(family + 0.5), 0, TERRAIN_FAMILIES - 1);\n  return texture(uGround, vec3(vGroundXZ / uGroundSize[id], uGroundLayer[id]));\n}')
        .replace('#include <map_fragment>', '#include <map_fragment>\n{\n  vec3 w = vBary / max(vBary.x + vBary.y + vBary.z, 1e-4);\n  vec4 g = groundSample(vFamily.x) * w.x + groundSample(vFamily.y) * w.y + groundSample(vFamily.z) * w.z;\n  diffuseColor.rgb *= g.rgb;\n}');
      // Rain, puddles and snow: after the blend (map_fragment), so wetness darkens the blended
      // colour. Compiled in once and driven by the weather's shared uniforms.
      injectWetness(shader, 'ground');
      if (normals) injectGroundNormal(shader, normals, normalScale);
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
