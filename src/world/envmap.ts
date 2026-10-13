import * as THREE from 'three';

/**
 * Materials that reflect their surroundings (metal, glass) share one environment map, swapped as
 * the sky changes. Only these get it: giving the whole scene an environment would also change the
 * diffuse lighting of every surface, which the sky's own lights already set.
 *
 * That is true of each registered material as well, and it is the reason plain surfaces are turned
 * down here: in three 0.185 an environment map adds its irradiance to the diffuse light of the very
 * material that carries it (the indirect light reads the map too), so a registered surface takes a
 * sky-coloured fill its matt neighbours lack, on top of whatever it mirrors. A material converted at
 * format 6 says whether its shader has a reflection cube at all (`userData.swgCube`); the 2,774 shaders
 * with none got neither the reflection nor the fill in the client, so their strength is scaled by
 * `REFLECTIONS.plain`, nought by default, which takes both away. It stays registered and its program
 * keeps its environment, so `plain` is a uniform and comparing the old look compiles nothing.
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
 *
 * `plain` is how much of the environment a surface whose shader has no reflection cube takes: nought
 * (ours, the default the owner took) leaves it as the client drew it, with neither a reflection nor a
 * sky-coloured fill; `__debug.reflections({ plain: 1 })` puts back what it had before. Not remembered.
 */
export type ReflectionSource = 'sky' | 'game';
export const REFLECTIONS: { source: ReflectionSource; plain: number } = { source: savedSource(), plain: 0 };

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

/** Whether a material's shader has no reflection cube, which only a pack converted at format 6 can say. */
function isPlain(material: THREE.Material): boolean {
  return material.userData.swgCube === false;
}

/** The strength a registered material is given: its own, times the environment's scale, times `plain` where its shader has no cube. */
function strengthOf(material: THREE.MeshStandardMaterial, base: number): number {
  return base * scale * (isPlain(material) ? REFLECTIONS.plain : 1);
}

/**
 * How much of the environment the surfaces with no reflection cube take (`__debug.reflections({ plain })`):
 * every one registered is written at once, as a uniform, so nothing compiles. Answers how many there are.
 */
export function setPlainReflections(share: number): number {
  if (Number.isFinite(share) && share >= 0) REFLECTIONS.plain = share;
  let plain = 0;
  for (const [m, base] of reflective) {
    if (!isPlain(m)) continue;
    plain++;
    if (current) m.envMapIntensity = strengthOf(m, base);
  }
  return plain;
}

/** How many registered materials have no reflection cube, for the console. */
export function plainReflectiveCount(): number {
  let plain = 0;
  for (const m of reflective.keys()) if (isPlain(m)) plain++;
  return plain;
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

/**
 * Join the registry with the strength the material was authored with. A copy of a registered material
 * (`like`: the interior cells' own copies) is registered with its original's: its own field holds whatever
 * the registry last wrote into the original, which is nought on a plain surface while `plain` is nought and
 * the scale times its own elsewhere, so read as authored a plain room wall stayed at nought when
 * `reflections({ plain: 1 })` asked for the old look, and every other copy took the scale twice.
 */
export function registerReflective(material: THREE.MeshStandardMaterial, like?: THREE.MeshStandardMaterial): void {
  if (!reflective.has(material)) {
    const base = like !== undefined ? reflective.get(like) : undefined;
    reflective.set(material, base ?? material.envMapIntensity);
    material.addEventListener('dispose', forgetOnDispose);
  }
  if (current) {
    material.envMap = current;
    material.envMapIntensity = strengthOf(material, reflective.get(material)!);
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
    m.envMapIntensity = strengthOf(m, base);
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
