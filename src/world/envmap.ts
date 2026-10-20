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
 *
 * The models the world did not load out of a planet's pack -- what is worn, held, flown and ridden,
 * and the creatures -- join as the world adopts them (`joinModelReflections`, from
 * `World.adoptMaterials`, which every load path runs before anything compiles), and only where the
 * shader has a cube: their programs are built with the environment in them behind whatever prepares
 * them, never on a live frame. The previews that draw the same materials in WebGL contexts of their
 * own swap a studio of their own onto them around their own draws (`EnvironmentSwap`).
 */
const reflective = new Map<THREE.MeshStandardMaterial, number>();
/** Which registered materials joined as a model's (`joinModelReflections`), the ones `REFLECTIONS.models` scales. */
const models = new WeakSet<THREE.Material>();
let current: THREE.Texture | null = null;
let scale = 1;
/**
 * What every registered material carries while the world has no environment of its own (between two
 * worlds, before the first capture of the sky): a black filtered cube of the one height every
 * environment here has (`WaterBodies`' own stand-in, handed over at boot). With it a registered
 * material's program never goes from an environment to none and back, which it did at every change of
 * world while it was null -- harmless for a planet's own materials, which go with their world, and a
 * program built on a live frame for anything carried across: the hull a jump carries to another system
 * is drawn all through the unload, inside its tunnel, with the player's armour on board. Black reflects
 * nothing and fills nothing, so it draws exactly what no environment drew.
 */
let standIn: THREE.Texture | null = null;
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
 *
 * `models` is whether the worn, held, flown and ridden models and the creatures reflect: off, every one
 * of them is written at nought, which takes the reflection and the fill away and leaves the program as it
 * is, so `__debug.reflections({ models: false })` compares live and compiles nothing. Not remembered;
 * `localStorage['swg.reflections.models'] = '0'` keeps them out of the registry altogether at the next
 * load (`MODEL_REFLECTIONS_AT_LOAD`), which is exactly how they were drawn before they had one.
 */
export type ReflectionSource = 'sky' | 'game';
export const REFLECTIONS: { source: ReflectionSource; plain: number; models: boolean } = { source: savedSource(), plain: 0, models: true };

/** Whether the models join the registry at all this session, read once at load (`swg.reflections.models`). */
export const MODEL_REFLECTIONS_AT_LOAD = modelsAtLoad();

function savedSource(): ReflectionSource {
  try {
    return globalThis.localStorage?.getItem('swg.reflections') === 'game' ? 'game' : 'sky';
  } catch {
    return 'sky';
  }
}

function modelsAtLoad(): boolean {
  try {
    return globalThis.localStorage?.getItem('swg.reflections.models') !== '0';
  } catch {
    return true;
  }
}

/**
 * The studio the previews swap onto what they draw (`EnvironmentSwap`): how much of it a material takes,
 * times its own strength. Ours: half, which is what the ship edit page's room had always been given.
 */
export const PREVIEW_REFLECTIONS = { strength: 0.5 };

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

/** The strength a registered material is given: its own, times the environment's scale, times `plain` where its shader has no cube, and nought for a model's while `models` is off. */
function strengthOf(material: THREE.MeshStandardMaterial, base: number): number {
  return base * scale * (isPlain(material) ? REFLECTIONS.plain : 1) * (REFLECTIONS.models || !models.has(material) ? 1 : 0);
}

/**
 * The strength a material was authored with: what it registered with, else what its original registered with
 * (`userData.swgEnvBase`, which a copy carries, since `clone()` copies the userData), else its own field.
 */
function baseOf(material: THREE.MeshStandardMaterial): number {
  const kept = reflective.get(material);
  if (kept !== undefined) return kept;
  const carried = material.userData.swgEnvBase;
  return typeof carried === 'number' && Number.isFinite(carried) ? carried : material.envMapIntensity;
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
 * `reflections({ plain: 1 })` asked for the old look, and every other copy took the scale twice. The strength
 * is also kept on the material's userData, which a copy made anywhere carries (a ship's paint, its clear
 * panes, a ghost), so a copy registered with no `like` still takes its original's.
 */
export function registerReflective(material: THREE.MeshStandardMaterial, like?: THREE.MeshStandardMaterial): void {
  if (!reflective.has(material)) {
    const kept = like !== undefined ? reflective.get(like) : undefined;
    const base = kept ?? baseOf(material);
    reflective.set(material, base);
    material.userData.swgEnvBase = base;
    material.addEventListener('dispose', forgetOnDispose);
  }
  if (current) {
    material.envMap = current;
    material.envMapIntensity = strengthOf(material, reflective.get(material)!);
    material.needsUpdate = true;
  }
}

/**
 * A model's material joins the registry, where its shader has a reflection cube (material format 6's
 * `swgCube: true`): what is worn, held, flown and ridden, and the creatures, which nothing registered before
 * and whose chrome drew dark. Called by `World.adoptMaterials` the first time it meets a material, which every
 * path that loads something in play runs before anything compiles it (`prepareActor`, `prepareVehicle`,
 * `prepareExtras`, `compileReady`, the warm-up's sweep), so the program is built with the environment in it,
 * once. A material a planet's pack registered already (`AssetPack`) is left as it is, a plain one and one from
 * a pack converted before format 6 are not registered (neither reflected before), and nothing joins while the
 * load-time hatch is set. Answers whether it joined now.
 */
export function joinModelReflections(material: THREE.Material): boolean {
  if (!MODEL_REFLECTIONS_AT_LOAD) return false;
  const m = material as THREE.MeshStandardMaterial;
  if (!m.isMeshStandardMaterial || m.userData.swgCube !== true || reflective.has(m)) return false;
  models.add(m);
  registerReflective(m);
  return true;
}

/**
 * Whether the models reflect (`__debug.reflections({ models })`): every model's material registered is written
 * at once, a uniform, so nothing compiles. Answers how many there are.
 */
export function setModelReflections(on: boolean): number {
  REFLECTIONS.models = on;
  let n = 0;
  for (const [m, base] of reflective) {
    if (!models.has(m)) continue;
    n++;
    if (current) m.envMapIntensity = strengthOf(m, base);
  }
  return n;
}

/** How many registered materials joined as a model's, for the console. */
export function modelReflectiveCount(): number {
  let n = 0;
  for (const m of reflective.keys()) if (models.has(m)) n++;
  return n;
}

/** Whether a material is in the registry, for the console. */
export function isRegisteredReflective(material: THREE.Material): boolean {
  return reflective.has(material as THREE.MeshStandardMaterial);
}

export function unregisterReflective(material: THREE.MeshStandardMaterial): void {
  reflective.delete(material);
  material.removeEventListener('dispose', forgetOnDispose);
}

/** How many materials are registered, for the console. */
export function reflectiveCount(): number {
  return reflective.size;
}

/**
 * Set the environment every reflective material sees (a PMREM-filtered texture, or null for none, which is the
 * stand-in once there is one); each keeps its own intensity times `envScale`.
 */
export function setEnvironment(texture: THREE.Texture | null, envScale = 1): void {
  const next = texture ?? standIn;
  const rebuild = (current === null) !== (next === null);
  current = next;
  scale = envScale;
  for (const [m, base] of reflective) {
    m.envMap = next;
    m.envMapIntensity = strengthOf(m, base);
    if (rebuild) m.needsUpdate = true;
  }
  for (const l of listeners) l(next, envScale);
}

/**
 * The black stand-in every registered material carries while the world has none (see `standIn` above), handed
 * over once at boot, before anything is registered; a world with no environment yet takes it at once.
 */
export function setEnvironmentStandIn(texture: THREE.Texture | null): void {
  standIn = texture;
  if (current === null && texture !== null) setEnvironment(null);
}

/** Whether the environment in force is the black stand-in, for the console. */
export function environmentIsStandIn(): boolean {
  return current !== null && current === standIn;
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

/**
 * Whether anything under `root` would take a preview's own environment (`EnvironmentSwap`): a shader with a cube, a
 * person's material the fourth wave gave the environment at nought (`swgPersonEnv`), or with `plain` one with none.
 */
export function takesEnvironment(root: THREE.Object3D, plain = false): boolean {
  let any = false;
  root.traverse((o) => {
    if (any) return;
    const mat = (o as THREE.Mesh).material;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (!(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
      if (m.userData.swgCube === true || m.userData.swgPersonEnv === true || (plain && m.userData.swgCube === false)) any = true;
    }
  });
  return any;
}

/**
 * A preview's own environment on the materials it draws, for the length of one draw or one compile, and the
 * world's put back after (the wardrobe's doll, the select screen and the creator: `CharacterPreview`; the ship
 * edit page: `ShipPreview`). Those draw the very materials the world draws, in WebGL contexts of their own, and
 * a texture the world's renderer filtered is nothing in another context; so each preview makes a studio of its
 * own, of the world's one height, and this hands it to what it draws around each of its own calls, exactly as
 * `World.keepShadowRecords` puts the cascades' records back around each of its compiles. Nothing it writes is in
 * a program's key beyond the environment's height, which is the world's, and it never asks for a program again
 * (`needsUpdate`), so the world's renderer meets every material as it left it.
 *
 * Use it as `on`, then the draw in a `try`, then `off` in its `finally`: a draw that throws still puts the
 * world's back. What it takes: a material whose shader has a cube (format 6's `swgCube: true`), at its own
 * strength times `PREVIEW_REFLECTIONS.strength`, nought while `REFLECTIONS.models` is off; and with `plain`, one
 * whose shader has none at `REFLECTIONS.plain` (the ship edit page, whose studio every material without a map
 * of its own takes as the scene's environment: so a plain hull there takes none, as it takes none in the world).
 * A material from a pack converted before format 6 says neither and is left to the preview's own rules, and with
 * the load-time hatch set nothing is swapped at all. Allocation-free: the lists are kept and written by index.
 */
export class EnvironmentSwap {
  private readonly held: (THREE.MeshStandardMaterial | null)[] = [];
  private readonly maps: (THREE.Texture | null)[] = [];
  private readonly strengths: number[] = [];
  private count = 0;
  private texture: THREE.Texture | null = null;
  private share = 1;
  private plainToo = false;

  /** How many materials the last `on` swapped (each once, however many meshes wear it), for the console. */
  last = 0;

  private readonly visit = (o: THREE.Object3D): void => {
    const mat = (o as THREE.Mesh).material;
    if (!mat) return;
    if (Array.isArray(mat)) for (let i = 0; i < mat.length; i++) this.take(mat[i]);
    else this.take(mat);
  };

  /** The preview's own environment onto every material under `root` that takes one, each one's own kept. */
  on(root: THREE.Object3D | null, texture: THREE.Texture | null, share = PREVIEW_REFLECTIONS.strength, plain = false): void {
    this.off();
    this.last = 0;
    if (!MODEL_REFLECTIONS_AT_LOAD || !root || !texture) return;
    this.texture = texture;
    this.share = share;
    this.plainToo = plain;
    root.traverse(this.visit);
    this.last = this.count;
  }

  /** Everything `on` swapped put back as it was, last first (a material is taken once a swap, so each comes back to exactly what it had). */
  off(): void {
    for (let i = this.count - 1; i >= 0; i--) {
      const m = this.held[i]!;
      m.envMap = this.maps[i];
      m.envMapIntensity = this.strengths[i];
      this.held[i] = null;
      this.maps[i] = null;
    }
    this.count = 0;
    this.texture = null;
  }

  /** `on`, the draw, and `off` in a `finally`: the shape every caller follows, for the tests and the console. */
  around<T>(root: THREE.Object3D | null, texture: THREE.Texture | null, draw: () => T, share = PREVIEW_REFLECTIONS.strength, plain = false): T {
    this.on(root, texture, share, plain);
    try {
      return draw();
    } finally {
      this.off();
    }
  }

  private take(material: THREE.Material): void {
    const m = material as THREE.MeshStandardMaterial;
    if (!m.isMeshStandardMaterial) return;
    // Met again in this swap (one material on several meshes: a hull's identical guns, two copies of one hilt,
    // a figure's body and its clothes sharing a skin): taken already, and taken once. A material the world never
    // registered has no strength but its own field, which the first meeting has just written, so taken again it
    // would be scaled by the share again at every meeting. Only `take` ever puts this studio on a material and
    // `off` takes it away again before anything else runs, so nothing else carries it.
    if (m.envMap === this.texture) return;
    const cube = m.userData.swgCube;
    let k: number;
    if (cube === true) k = REFLECTIONS.models ? 1 : 0;
    else if (cube === false && this.plainToo) k = REFLECTIONS.plain;
    // A person's material the fourth wave gave the world's environment at nought (`personKeys.ts`, `swgPersonEnv`, its
    // strength nought by `swgEnvBase`): the world's filtered texture is nothing in this context, so it takes the studio,
    // at a share of nought as before. One whose superset the pixel test has taken off carries none and is left alone.
    else if (m.userData.swgPersonEnv === true && m.envMap !== null) k = REFLECTIONS.plain;
    else return;
    const i = this.count++;
    this.held[i] = m;
    this.maps[i] = m.envMap;
    this.strengths[i] = m.envMapIntensity;
    m.envMap = this.texture;
    m.envMapIntensity = baseOf(m) * this.share * k;
  }
}
