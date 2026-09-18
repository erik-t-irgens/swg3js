import * as THREE from 'three';

/**
 * Materials that reflect their surroundings (metal, glass) share one environment map, swapped as
 * the sky changes. Only these get it: giving the whole scene an environment would also change the
 * diffuse lighting of every surface, which the sky's own lights already set.
 *
 * Each material keeps the reflection strength it was authored with: the environment's own scale
 * multiplies it rather than replacing it, so a surface meant to mirror faintly still does.
 * Water is not here; `WaterBodies` gives each body its environment and follows the sky through
 * `onEnvironment`.
 */
const reflective = new Map<THREE.MeshStandardMaterial, number>();
let current: THREE.Texture | null = null;
let scale = 1;
const listeners = new Set<(texture: THREE.Texture | null, scale: number) => void>();

export function registerReflective(material: THREE.MeshStandardMaterial): void {
  if (!reflective.has(material)) reflective.set(material, material.envMapIntensity);
  if (current) {
    material.envMap = current;
    material.envMapIntensity = reflective.get(material)! * scale;
    material.needsUpdate = true;
  }
}

export function unregisterReflective(material: THREE.MeshStandardMaterial): void {
  reflective.delete(material);
}

/** Set the environment every reflective material sees (a PMREM-filtered texture, or null for none); each keeps its own intensity times `envScale`. */
export function setEnvironment(texture: THREE.Texture | null, envScale = 1): void {
  const rebuild = (current === null) !== (texture === null);
  current = texture;
  scale = envScale;
  for (const [m, base] of reflective) {
    m.envMap = texture;
    m.envMapIntensity = base * envScale;
    if (rebuild) m.needsUpdate = true;
  }
  for (const l of listeners) l(texture, envScale);
}

/** The environment in force and its scale, for anything that assigns its own materials. */
export function currentEnvironment(): { texture: THREE.Texture | null; scale: number } {
  return { texture: current, scale };
}

/** Be told whenever the environment changes; returns the unsubscribe. */
export function onEnvironment(listener: (texture: THREE.Texture | null, scale: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether a loaded material was exported as shiny: a metalness map or factor from the shader's mask. */
export function isReflective(material: THREE.Material): material is THREE.MeshStandardMaterial {
  const m = material as THREE.MeshStandardMaterial;
  return !!m.isMeshStandardMaterial && (m.metalnessMap !== null || m.metalness > 0.05 || m.roughness < 0.5);
}
