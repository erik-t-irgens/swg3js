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

/**
 * Where reflections come from. `sky` (the default since 2026-09-26, the owner's call) is our own sky
 * dome, captured again every few seconds, so a shiny surface shows the sky it is really under at that
 * hour and in that weather; `game` is what it was before, the planet's own day and night cube maps out
 * of the client's files where an area has one, and the dome only where it has none. The owner asked
 * for this to be easy to undo: `localStorage['swg.reflections'] = 'game'` (or `__debug.reflections({
 * source: 'game' })`, which also remembers it) puts the old one back.
 */
export type ReflectionSource = 'sky' | 'game';
export const REFLECTIONS: { source: ReflectionSource } = { source: savedSource() };

function savedSource(): ReflectionSource {
  try {
    return globalThis.localStorage?.getItem('swg.reflections') === 'game' ? 'game' : 'sky';
  } catch {
    return 'sky';
  }
}

/** Choose where reflections come from, and remember it in this browser. The world picks it up on its next refresh. */
export function setReflectionSource(source: ReflectionSource): void {
  REFLECTIONS.source = source;
  try {
    if (source === 'game') globalThis.localStorage?.setItem('swg.reflections', 'game');
    else globalThis.localStorage?.removeItem('swg.reflections');
  } catch {
    /* a browser that keeps nothing still switches for this session */
  }
}

/**
 * A material that is disposed leaves the registry by itself. Nothing ever took one out before, so every
 * reflective material of every world visited stayed here for the session, with its textures, and every
 * refresh of the sky wrote to all the dead ones as well as the live.
 */
function forgetOnDispose(this: THREE.Material): void {
  reflective.delete(this as THREE.MeshStandardMaterial);
  this.removeEventListener('dispose', forgetOnDispose);
}

export function registerReflective(material: THREE.MeshStandardMaterial): void {
  if (!reflective.has(material)) {
    reflective.set(material, material.envMapIntensity);
    material.addEventListener('dispose', forgetOnDispose);
  }
  if (current) {
    material.envMap = current;
    material.envMapIntensity = reflective.get(material)! * scale;
    material.needsUpdate = true;
  }
}

export function unregisterReflective(material: THREE.MeshStandardMaterial): void {
  reflective.delete(material);
  material.removeEventListener('dispose', forgetOnDispose);
}

/** How many materials are registered, for the console. */
export function reflectiveCount(): number {
  return reflective.size;
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
