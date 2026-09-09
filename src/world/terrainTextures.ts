// Ground textures of a converted planet: the terrain's shader families, one texture each, packed
// into a texture array and blended per triangle the way the game paints them. The chunk builder
// gives every triangle the families of its three corners (aFamily) and each vertex its corner
// weight (aBary); the fragment shader samples the three textures at world scale and mixes them.

import * as THREE from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';
import type { AssetPack } from './assetPack';

/** One entry of terrain/shaders.json written by the converter. */
export interface ShaderFamilyDef {
  id: number;
  name: string;
  /** Metres per texture repeat. */
  size: number;
  /** Pack-relative PNG. */
  file: string;
}

const LAYER_SIZE = 512;

export class TerrainTextures {
  readonly texture: THREE.DataArrayTexture;
  /** Family id → layer index; families without a texture use layer 0. */
  private readonly layerOf: Float32Array;
  private readonly sizeOf: Float32Array;
  readonly families: ShaderFamilyDef[];
  private material: THREE.MeshStandardMaterial | null = null;

  private constructor(texture: THREE.DataArrayTexture, families: ShaderFamilyDef[], layers: Map<number, number>) {
    this.texture = texture;
    this.families = families;
    const maxId = Math.max(0, ...families.map((f) => f.id));
    this.layerOf = new Float32Array(maxId + 1);
    this.sizeOf = new Float32Array(maxId + 1).fill(4);
    for (const f of families) {
      const layer = layers.get(f.id);
      if (layer === undefined) continue;
      this.layerOf[f.id] = layer;
      this.sizeOf[f.id] = f.size > 0 ? f.size : 4;
    }
  }

  /** Load the pack's ground textures, or null when it has none. */
  static async load(pack: AssetPack, anisotropy: number): Promise<TerrainTextures | null> {
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
    return new TerrainTextures(texture, kept, layers);
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
    const layerOf = this.layerOf;
    const sizeOf = this.sizeOf;
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
    };
    mat.customProgramCacheKey = () => `swg-ground-${count}`;
    this.material = mat;
    return mat;
  }

  dispose(): void {
    this.texture.dispose();
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
