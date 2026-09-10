import * as THREE from 'three';

/**
 * Materials that reflect their surroundings (metal, glass, water) share one environment map,
 * swapped as the sky changes. Only these get it: giving the whole scene an environment would
 * also change the diffuse lighting of every surface, which the sky's own lights already set.
 */
const reflective = new Set<THREE.MeshStandardMaterial>();
let current: THREE.Texture | null = null;
let intensity = 1;

export function registerReflective(material: THREE.MeshStandardMaterial): void {
  reflective.add(material);
  if (current) {
    material.envMap = current;
    material.envMapIntensity = intensity;
    material.needsUpdate = true;
  }
}

export function unregisterReflective(material: THREE.MeshStandardMaterial): void {
  reflective.delete(material);
}

/** Set the environment every reflective material sees (a PMREM-filtered texture, or null for none). */
export function setEnvironment(texture: THREE.Texture | null, envIntensity = 1): void {
  const rebuild = (current === null) !== (texture === null);
  current = texture;
  intensity = envIntensity;
  for (const m of reflective) {
    m.envMap = texture;
    m.envMapIntensity = envIntensity;
    if (rebuild) m.needsUpdate = true;
  }
}

/** Whether a loaded material was exported as shiny: a metalness map or factor from the shader's mask. */
export function isReflective(material: THREE.Material): material is THREE.MeshStandardMaterial {
  const m = material as THREE.MeshStandardMaterial;
  return !!m.isMeshStandardMaterial && (m.metalnessMap !== null || m.metalness > 0.05 || m.roughness < 0.5);
}
