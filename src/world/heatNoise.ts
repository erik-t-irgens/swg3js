import * as THREE from 'three';
import { HEAT_NOISE_SIZE, heatNoiseData } from './heatNoiseData';

let shared: THREE.Data3DTexture | null = null;

/**
 * The shared noise every heat source samples (and the lava without its converted volume): made on first
 * use, never disposed. RedFormat, UnsignedByteType, unpackAlignment 1, mipmapped (LinearMipmapLinearFilter),
 * RepeatWrapping on S, T and R. Its bytes are `image.data`, which the lava's far values read.
 */
export function heatNoiseTexture(): THREE.Data3DTexture {
  if (shared) return shared;
  const tex = new THREE.Data3DTexture(heatNoiseData(HEAT_NOISE_SIZE), HEAT_NOISE_SIZE, HEAT_NOISE_SIZE, HEAT_NOISE_SIZE);
  setupNoiseVolume(tex);
  tex.name = 'heat-noise';
  shared = tex;
  return tex;
}

/** The settings every noise volume is drawn with, the runtime one and a converted one alike. */
export function setupNoiseVolume(tex: THREE.Data3DTexture): void {
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.unpackAlignment = 1;
  // R8 is filterable and renderable in WebGL2, so three builds the chain on the GPU: a surface kilometres
  // wide, sampled with no mips, is a hundred texels to a pixel.
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.wrapR = THREE.RepeatWrapping;
  tex.needsUpdate = true;
}
