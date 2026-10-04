// Live customization of a character: the parts pack's recipes (customize.json) rendered in the
// browser with the current colours and choices, the results put on the character's materials.
// A change re-renders only the recipes that read the variable, one after another, so a slider that
// moves fast lands on its last value: a character's in a worker of its own (src/player/recipeWorker.ts),
// a ship's paint in another, the dressed people the mobiles stand here, between frames, through their
// shared renders.
//
// A recipe that reads a variable private to its mesh keeps its textures under its material and its mesh,
// not its material alone: a left and a right glove, or an Ithorian chest plate and its leggings, are drawn
// with one shader name, and keyed by the material alone, colouring one coloured the other.
import * as THREE from 'three';
// The imports carry their extensions so the node tests can load this module (a ship's paint uses it).
import { type CustomizeFile, type Img, type Recipe, type Values, recipeNormal, recipeNormalFiles, recipeValueKey, recipeVariableDefs, recipeVariables, renderRecipe, variableKey } from './texrender.ts';
import { decodePng } from './png.ts';
import { type JobImg, type PaintImg, type PaintRecipe, runPaintJob } from '../vehicles/paintJob.ts';

/**
 * A renderer that makes a recipe's texture somewhere else (a worker: recipeWorker.ts): the recipe, a copy
 * of the values in force, the palettes its shader names, and the folder its images are in. The answer is
 * the colour, with its glow when the recipe was sent with one and the normal map the values pick when the
 * renderer makes those (a character's does). Null when the render was dropped (a newer paint won), and
 * nothing is put then.
 */
export type RecipeRender = (r: Recipe, values: Values, palettes: Record<string, number[][]>, imageDir: string) => Promise<JobImg | null>;

/**
 * Whether a recipe's textures are its mesh's own: it reads a variable private to its mesh, so the same
 * shader on another mesh may be another colour. A recipe reading only shared variables (a ship's paint, a
 * body's skin) looks the same on every mesh that wears its shader and keeps one texture for them all.
 * Worked out once per parsed recipe and kept beside it, never on it (a parsed recipe is shared).
 */
const perMeshOf = new WeakMap<Recipe, boolean>();
export function perMesh(r: Recipe): boolean {
  let p = perMeshOf.get(r);
  if (p === undefined) {
    p = recipeVariableDefs(r).some((d) => d.private);
    perMeshOf.set(r, p);
  }
  return p;
}

/**
 * The converter's mesh a loaded mesh is: its own name, less the `_<n>` the loader adds to a mesh with several
 * materials (each material loads as a mesh of its own, `body_m_l0_1`, `body_m_l0_2`). The recipes name the
 * converter's mesh, and none ends in a `_<digits>` of its own (the node test reads every converted pack for it).
 */
export function recipeMeshOf(loaded: string): string {
  return loaded.replace(/_\d+$/, '');
}

/** Whether a loaded mesh is the recipe mesh `mesh`: by its name, or by its name less the loader's suffix. */
export function isRecipeMesh(loaded: string, mesh: string): boolean {
  return loaded === mesh || recipeMeshOf(loaded) === mesh;
}

/**
 * Where one character's renders are shared with every other of the same colours (the dressed people
 * the mobiles stand, src/world/mobiles/lookShare.ts): asked for a render by its key, it hands back the
 * one already made, or has `make` make it once however many ask at the same moment. Null when there is
 * nothing to put (the render came to nothing, or the look it was for has gone). Everything it hands out
 * is somebody else's as well, so a customizer given one never writes into, re-renders or disposes a
 * texture it was handed.
 */
export interface RenderShare {
  claim(key: string, kind: 'render' | 'normal', make: () => Promise<THREE.Texture | null>): Promise<THREE.Texture | null>;
}

/**
 * Each parsed recipe's number, for the keys its renders are shared under: a recipe is one object for
 * the session however many characters read it (`loadCustomizeFile` parses a folder once), so the
 * object is the recipe, and two recipes of one file are never taken for each other by content.
 */
const recipeIds = new WeakMap<Recipe, number>();
let nextRecipeId = 1;
function recipeId(r: Recipe): number {
  let id = recipeIds.get(r);
  if (id === undefined) {
    id = nextRecipeId++;
    recipeIds.set(r, id);
  }
  return id;
}

/**
 * The key a recipe's colour render is shared under for these values, and its normal map's (null when
 * its shader has none): the recipe and every value it reads for the first, the files the second is made
 * from for the second, since that reads nothing else. Two recipes that name one normal map (a body's and
 * a head's neck) share it.
 */
export function renderKeys(r: Recipe, values: Values, imageDir: string): { render: string; normal: string | null } {
  const [cnrm, nrml] = recipeNormalFiles(r, values);
  return {
    render: `${recipeId(r)}|${recipeValueKey(r, values)}`,
    normal: cnrm || nrml ? `${imageDir}|${cnrm ?? ''}|${nrml ?? ''}`.toLowerCase() : null,
  };
}

/** The material slots a recipe's renders go on: its colour, its lighting detail, and a glowing shader's glow. */
type TextureSlot = 'map' | 'normalMap' | 'emissiveMap';

/**
 * Where a recipe's render for a slot is kept: the colour under the material's own name, or its name and its
 * mesh's for a recipe whose colour is its mesh's own (`perMesh`); the normal map and the glow beside it.
 */
function slotKey(r: Recipe, slot: TextureSlot): string {
  const base = perMesh(r) ? `${r.material}|${r.mesh}` : r.material;
  return slot === 'map' ? base : slot === 'normalMap' ? `${base}#normal` : `${base}#emis`;
}

/** A texture for a render's pixels, as every render is put on a material: a colour (or a glow) in sRGB, a normal map as it stands, mipmapped and repeating. */
function renderTexture(img: Img, normal: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(img.rgba), img.width, img.height, THREE.RGBAFormat);
  tex.colorSpace = normal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Each pack folder's recipes, fetched and parsed once however many characters read them: a
 * wardrobe's customize.json is 5 MB, and every dressed NPC's look builds a customizer of its own.
 * Nothing writes to a parsed recipe or palette (the customizer keys its own maps by them, and
 * renderRecipe writes only its own registers), so sharing one parse is safe. A failed fetch is
 * not kept, so a later character tries again.
 */
const customizeFiles = new Map<string, Promise<CustomizeFile | null>>();
export function loadCustomizeFile(dir: string): Promise<CustomizeFile | null> {
  let p = customizeFiles.get(dir);
  if (!p) {
    p = fetch(`${dir}customize.json`)
      .then(async (res) => (!res.ok || !(res.headers.get('content-type') ?? '').includes('json') ? null : ((await res.json()) as CustomizeFile)))
      .catch(() => null);
    customizeFiles.set(dir, p);
    void p.then((file) => {
      if (!file) customizeFiles.delete(dir);
    });
  }
  return p;
}

export class Customizer {
  readonly values: Values = new Map();
  private readonly images = new Map<string, Img | null>();
  private readonly pending = new Map<string, Promise<Img | null>>();
  private readonly deps = new Map<Recipe, Set<string>>();
  private readonly textures = new Map<string, THREE.DataTexture>();
  /** Every recipe from every source (the parts pack, the wardrobe), with the folder its images live in. */
  private readonly recipes: Recipe[] = [];
  private readonly dirOf = new Map<Recipe, string>();
  private readonly palettes: Record<string, number[][]> = {};
  private readonly loaded = new Set<string>();
  private queued = new Set<Recipe>();
  private running = false;
  private disposed = false;
  /** Renders that came back after their recipe was queued again, and so were not put (the newer one is). */
  private staleDropped = 0;
  /** The last render's time from asking to putting, in milliseconds. */
  private lastMs: number | null = null;
  /**
   * Materials by name across the character's meshes, refreshed by the character as parts come and go; with
   * a mesh, only that mesh's (a mesh with several materials loads as several meshes, the second onwards
   * suffixed `_1`, `_2`, which the recipes name without). A recipe whose colour is its mesh's own asks with
   * its mesh (`perMesh`); one that may stand on any mesh asks without.
   */
  materialsFor: (name: string, mesh?: string) => THREE.Material[] = () => [];
  /** Called when a render lands, so a preview can redraw. */
  onRendered: () => void = () => {};
  /** Asked just before a render's texture goes on: false drops it (a ship's paint that changed while it rendered). */
  accept: (r: Recipe, img: Img) => boolean = () => true;
  /** Called in the same step a render's texture went on the materials (a ship's paint puts its glow beside it). */
  onPut: (r: Recipe, img: Img) => void = () => {};
  /** Where recipes render when not here (a worker); null renders them on this thread, between frames. */
  private readonly renderOff: RecipeRender | null;
  /**
   * Whether a render made elsewhere hands its glow back for this customizer to put on: a character's, whose
   * worker splits a glowing piece's render exactly as this thread would (`splits`). A ship's paint puts its
   * own glow in `onPut`, and its renders are sent as the paint decides, so its customizer leaves them be.
   */
  private readonly putsGlow: boolean;
  /**
   * Where this character's renders are shared with others of the same colours (`RenderShare`), set only
   * for a look the mobiles build once and never colour again; null renders every recipe for this
   * character alone, which is what the player, another player and the wardrobe's doll always do.
   */
  share: RenderShare | null = null;

  constructor(renderOff: RecipeRender | null = null, opts: { putsGlow?: boolean } = {}) {
    this.renderOff = renderOff;
    this.putsGlow = !!opts.putsGlow;
  }

  /** The materials a recipe's renders go on: its mesh's own for a recipe whose colour is its mesh's (`perMesh`), every one of its name otherwise. */
  private targets(r: Recipe): THREE.Material[] {
    return perMesh(r) ? this.materialsFor(r.material, r.mesh) : this.materialsFor(r.material);
  }

  /** The recipes of a pack folder, added to what is already here; false when the folder has none. */
  async addSource(dir: string): Promise<boolean> {
    if (this.loaded.has(dir)) return true;
    try {
      const file = await loadCustomizeFile(dir);
      if (!file?.recipes?.length) return false;
      this.loaded.add(dir);
      Object.assign(this.palettes, file.palettes);
      // The same piece may sit in two packs (the default shirt is in the parts pack and in the
      // wardrobe): one recipe per material and mesh, the first pack's.
      const have = new Set(this.recipes.map((r) => `${r.material}|${r.mesh}`));
      for (const r of file.recipes) {
        const key = `${r.material}|${r.mesh}`;
        if (have.has(key)) continue;
        have.add(key);
        this.recipes.push(r);
        this.dirOf.set(r, `${dir}${file.images}`);
        this.deps.set(r, recipeVariables(r));
      }
      this.invalidate();
      return true;
    } catch {
      return false;
    }
  }

  /** Whether any recipes are here at all. */
  get any(): boolean {
    return this.recipes.length > 0;
  }

  /**
   * Whether a recipe feeds a material the character has. The wardrobe brings a recipe for every
   * item it holds, over a thousand, and only the ones on the character are worth a variable, a
   * link or a render; the rest wait until their item is put on.
   */
  private active(r: Recipe): boolean {
    return this.targets(r).length > 0;
  }

  private variableCache: ReturnType<Customizer['variables']> | null = null;

  /** Forget what was worked out about the character's materials: a part came or went. */
  invalidate(): void {
    this.variableCache = null;
  }

  /**
   * Every variable the character's recipes read: its key (a private one is scoped to its mesh),
   * its default, its kind, and the palette or the number of choices; what the sliders and
   * swatches show.
   */
  variables(): { key: string; name: string; private: boolean; mesh: string; default: number; kind: 'palette' | 'index'; palette?: string; tag?: string; count?: number; colors?: number[][] }[] {
    if (this.variableCache) return this.variableCache;
    const out = new Map<string, { key: string; name: string; private: boolean; mesh: string; default: number; kind: 'palette' | 'index'; palette?: string; tag?: string; count?: number; colors?: number[][] }>();
    for (const r of this.recipes) {
      if (!this.active(r)) continue;
      for (const d of recipeVariableDefs(r)) {
        const key = variableKey(d.name, d.private, r.mesh);
        const prev = out.get(key);
        if (prev) {
          if (d.count && (!prev.count || d.count > prev.count)) prev.count = d.count;
          continue;
        }
        out.set(key, { key, name: d.name, private: d.private, mesh: r.mesh, default: d.default, kind: d.kind, ...(d.palette ? { palette: d.palette, colors: this.palettes[d.palette] } : {}), ...(d.tag ? { tag: d.tag } : {}), ...(d.count ? { count: d.count } : {}) });
      }
    }
    this.variableCache = [...out.values()];
    return this.variableCache;
  }

  /** The keys a change to `key` also sets: a shared variable reaches the private copies of the same name on every mesh (the head's own skin colour follows the owner's). */
  private linked(key: string): string[] {
    if (key.includes('|')) return [];
    const short = key.replace(/^.*\//, '');
    const out = new Set<string>();
    for (const v of this.variables()) if (v.private && v.name.replace(/^.*\//, '') === short) out.add(v.key);
    return [...out];
  }

  /** Whether a private variable is a copy of a shared one (and so follows it rather than showing on its own). */
  isLinked(key: string): boolean {
    if (!key.includes('|')) return false;
    const short = key.replace(/^.*\|/, '').replace(/^.*\//, '');
    return this.variables().some((v) => !v.private && v.name.replace(/^.*\//, '') === short);
  }

  /** The two spellings a key may be read under: as given, and with the variable's path dropped (the mesh scope kept). */
  private static spellings(key: string): [string, string] {
    const bar = key.indexOf('|');
    const scope = bar >= 0 ? key.slice(0, bar + 1) : '';
    const name = bar >= 0 ? key.slice(bar + 1) : key;
    return [key, `${scope}${name.replace(/^.*\//, '')}`];
  }

  /** Whether any recipe reads the variable. */
  affects(name: string): boolean {
    const [a, b] = Customizer.spellings(name);
    for (const d of this.deps.values()) if (d.has(a) || d.has(b)) return true;
    return false;
  }

  private queueReaders(key: string): number {
    const [a, b] = Customizer.spellings(key);
    let n = 0;
    for (const [r, d] of this.deps) {
      if (!d.has(a) && !d.has(b)) continue;
      // An item not on the character renders when it is put on (see reapply), not now.
      if (!this.active(r)) continue;
      this.queued.add(r);
      n++;
    }
    return n;
  }

  /** Set a variable (and the private copies that follow it) and re-render what reads them; returns how many recipes will re-render. */
  set(name: string, value: number): number {
    this.values.set(name, value);
    let n = this.queueReaders(name);
    for (const k of this.linked(name)) {
      this.values.set(k, value);
      n += this.queueReaders(k);
    }
    if (n) void this.run();
    return n;
  }

  /** Set several at once (a saved appearance) and render everything that reads any of them. */
  setAll(values: Record<string, number>): void {
    for (const [name, v] of Object.entries(values)) {
      this.values.set(name, v);
      this.queueReaders(name);
      for (const k of this.linked(name)) {
        this.values.set(k, v);
        this.queueReaders(k);
      }
    }
    if (this.queued.size) void this.run();
  }

  /** Render every recipe on the character (the pack was baked with its own defaults; ours may differ). */
  renderAll(): void {
    for (const r of this.recipes) if (this.active(r)) this.queued.add(r);
    void this.run();
  }

  /** Whether a value has been set that the recipe reads, under either spelling of the key. */
  private readsSetValue(r: Recipe): boolean {
    const d = this.deps.get(r);
    if (!d) return false;
    for (const key of this.values.keys()) {
      const [a, b] = Customizer.spellings(key);
      if (d.has(a) || d.has(b)) return true;
    }
    return false;
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queued.size) {
        const r = this.queued.values().next().value!;
        this.queued.delete(r);
        if (this.renderOff) {
          // Rendered elsewhere: this thread only posts and puts. A character's renderer hands back the normal
          // map the values pick, put on exactly as one made here is; a ship's paint asks for none (no ship
          // recipe chooses one, and a normal map arriving on a material that had none would change its program).
          const t0 = performance.now();
          const img = await this.renderOff(this.offRecipe(r), new Map(this.values), this.palettesOf(r), this.dirOf.get(r) ?? '');
          if (!img || this.disposed) continue;
          // A value moved while it rendered: the recipe is queued again, and the newer render is the one put.
          if (this.queued.has(r)) {
            this.staleDropped++;
            continue;
          }
          if (this.put(r, img) && img.emis && this.putsGlow && this.splits(r)) this.putOwn(r, img.emis, 'emissiveMap');
          if (img.normal) this.putNormal(r, img.normal);
          this.lastMs = performance.now() - t0;
          continue;
        }
        if (this.share) {
          await this.runShared(r, this.share);
          continue;
        }
        await this.loadImagesFor(r);
        // Between recipes the frame gets a turn, so a whole re-render does not freeze the game.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (this.disposed) continue;
        const t0 = performance.now();
        const dir = this.dirOf.get(r) ?? '';
        const lookup = (file: string | null) => (file ? this.images.get(`${dir}${file}`.toLowerCase()) ?? null : null);
        const img = this.colourRender(r, this.values, lookup);
        if (!img) continue;
        if (this.put(r, img) && img.emis) this.putOwn(r, img.emis, 'emissiveMap');
        // The lighting detail the shader picks with the values too (the age's wrinkles).
        const normal = recipeNormal(r, this.values, this.palettes, lookup);
        if (normal) this.putNormal(r, normal);
        const ms = performance.now() - t0;
        this.lastMs = ms;
        if (ms > 250) console.info(`customize: ${r.material} rendered in ${ms.toFixed(0)} ms (${img.width}x${img.height})`);
      }
    } finally {
      // In the `finally`, not after it: a texture that will not load throws straight out of the
      // loop, and a waiter left unwoken would hang for the life of the page (every caller is a
      // bare `void this.run()`, so the throw itself is never seen).
      this.running = false;
      const waiting = this.waiting;
      this.waiting = [];
      for (const resolve of waiting) resolve();
      this.onRendered();
    }
  }

  /** Whoever is waiting on `settled`, woken when the queue empties. */
  private waiting: (() => void)[] = [];

  /**
   * Resolves when nothing is queued and nothing is rendering: the look is finished. A dressed
   * body must not be cloned as a prototype before its skin textures have been drawn, or every
   * copy of it wears the pack's defaults.
   */
  settled(): Promise<void> {
    if (!this.running && !this.queued.size) return Promise.resolve();
    const done = new Promise<void>((resolve) => this.waiting.push(resolve));
    // Queued but idle cannot normally happen (every add kicks the loop); kicking it again is
    // free, and without it a waiter would hang for ever if it ever did.
    if (!this.running) void this.run();
    return done;
  }

  /** Only the palettes a recipe's shaders name (what a render elsewhere needs sent). */
  private palettesOf(r: Recipe): Record<string, number[][]> {
    const out: Record<string, number[][]> = {};
    const fromShader = (s: Recipe['shader']) => {
      for (const p of s?.palettes ?? []) if (this.palettes[p.palette]) out[p.palette] = this.palettes[p.palette];
    };
    fromShader(r.shader);
    for (const slot of r.slots) {
      for (const s of slot.blueprint.shaders) fromShader(s);
      for (const v of slot.blueprint.variables) if (v.palette && this.palettes[v.palette]) out[v.palette] = this.palettes[v.palette];
      for (const op of slot.blueprint.prepare) if (op.kind === 'palette' && this.palettes[op.palette]) out[op.palette] = this.palettes[op.palette];
    }
    return out;
  }

  /**
   * One recipe through the share: its colour render and its normal map each taken from the one already
   * made for the same key, or made here once and handed to the share. The values are copied before the
   * key is taken, so what is made is always what the key says even when a value moves while it renders
   * (the recipe is queued again for the new value, and that is another key).
   */
  private async runShared(r: Recipe, share: RenderShare): Promise<void> {
    const dir = this.dirOf.get(r) ?? '';
    const values: Values = new Map(this.values);
    const keys = renderKeys(r, values, dir);
    const lookup = (file: string | null) => (file ? this.images.get(`${dir}${file}`.toLowerCase()) ?? null : null);
    // A render split into its lit colour and its glow (`splits`) is shared under keys of its own, so a look
    // that splits and one that does not can never hand each other the wrong half.
    const split = this.splits(r);
    let glow: Img | null = null;
    const colour = await share.claim(split ? `${keys.render}|lit` : keys.render, 'render', async () => {
      await this.loadImagesFor(r);
      // Between recipes the frame gets a turn, as it does unshared.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const t0 = performance.now();
      const img = this.colourRender(r, values, lookup);
      const ms = performance.now() - t0;
      if (img && ms > 250) console.info(`customize: ${r.material} rendered in ${ms.toFixed(0)} ms (${img.width}x${img.height})`);
      glow = img?.emis ?? null;
      return img ? renderTexture(img, false) : null;
    });
    // A render that came to nothing puts nothing, and no normal map either, as unshared.
    if (!colour) return;
    this.putShared(r, colour as THREE.DataTexture, 'map');
    if (split) {
      const emis = await share.claim(`${keys.render}|glow`, 'render', async () => {
        // Made here only when another look made the lit half: the glow is split from a render of its own.
        if (!glow) {
          await this.loadImagesFor(r);
          glow = this.colourRender(r, values, lookup)?.emis ?? null;
        }
        return glow ? renderTexture(glow, false) : null;
      });
      if (emis) this.putShared(r, emis as THREE.DataTexture, 'emissiveMap');
    }
    if (!keys.normal) return;
    const normal = await share.claim(keys.normal, 'normal', async () => {
      await this.loadImagesFor(r);
      const img = recipeNormal(r, values, this.palettes, lookup);
      return img ? renderTexture(img, true) : null;
    });
    if (normal) this.putShared(r, normal as THREE.DataTexture, 'normalMap');
  }

  /**
   * Whether a recipe's render is split into a lit colour and a glow: its shader glows through a mask (the
   * converter wrote `glow`: a worn piece the wardrobe bakes for a palette laid on after its first pass, whose
   * GLB carries the lit half as its base and the glow as its emissive) and a material it feeds has a glow map
   * to take the glow. None is ever added, since that would be a new program; a material without one takes the
   * whole colour, as it always did. A renderer elsewhere splits for itself (a ship's paint worker, whose owner
   * puts the glow on in `onPut` and keeps it), so nothing here splits for it.
   */
  private splits(r: Recipe): boolean {
    if (!(r as PaintRecipe).glow || (this.renderOff && !this.putsGlow)) return false;
    return this.targets(r).some((m) => !!(m as THREE.MeshStandardMaterial).emissiveMap);
  }

  /**
   * A recipe as it is sent to a renderer elsewhere: a glowing one whose materials have no glow map to take
   * the glow goes without its glow, so it comes back whole, as `colourRender` would make it here. A ship's
   * paint sends its own way (`ShipPaint.recipeFor`), and its recipes go as they are.
   */
  private offRecipe(r: Recipe): Recipe {
    if (!this.putsGlow || !(r as PaintRecipe).glow || this.splits(r)) return r;
    const plain: PaintRecipe = { ...(r as PaintRecipe) };
    delete plain.glow;
    return plain;
  }

  /**
   * A recipe's colour for these values on this thread: the render, or for a recipe that `splits`, its lit half
   * with the glow beside it as `emis`, split exactly as the converter split the GLB's (paintJob.ts, the same job
   * a ship's paint runs in its worker, through glowSplit.ts), so a recolour glows where and as the piece did.
   * Without the split the whole render would go on `map` while the GLB's glow stayed on `emissiveMap`, and the
   * glowing part would be lit twice over, the old colour's glow on the new colour.
   */
  private colourRender(r: Recipe, values: Values, lookup: (file: string | null) => Img | null): PaintImg | null {
    return this.splits(r) ? runPaintJob(r as PaintRecipe, values, this.palettes, lookup) : renderRecipe(r, values, this.palettes, lookup);
  }

  /** A shared texture on every material a recipe feeds: as `put`/`putNormal`/`putOwn`, but never written into. */
  private putShared(r: Recipe, tex: THREE.DataTexture, slot: TextureSlot): void {
    this.textures.set(slotKey(r, slot), tex);
    for (const m of this.targets(r)) this.onSlot(m as THREE.MeshStandardMaterial, slot, tex);
  }

  /** Whether the colour went on (a ship's paint can refuse one that changed while it rendered). */
  private put(r: Recipe, img: Img): boolean {
    if (!this.accept(r, img)) return false;
    this.putOwn(r, img, 'map');
    this.onPut(r, img);
    return true;
  }

  /**
   * A render of this customizer's own on every material a recipe feeds, written into the texture it already has
   * for that slot when the size is the same. A glow goes only where a glow map already is (`onSlot`).
   */
  private putOwn(r: Recipe, img: Img, slot: TextureSlot): void {
    const key = slotKey(r, slot);
    let tex = this.textures.get(key);
    if (!tex || tex.image.width !== img.width || tex.image.height !== img.height) {
      tex?.dispose();
      tex = renderTexture(img, slot === 'normalMap');
      this.textures.set(key, tex);
    } else (tex.image.data as Uint8Array).set(img.rgba);
    tex.needsUpdate = true;
    for (const m of this.targets(r)) this.onSlot(m as THREE.MeshStandardMaterial, slot, tex);
  }

  /** One texture on one material's slot: a normal map at the customizer's strength, a glow only onto a glow map already there. */
  private onSlot(std: THREE.MeshStandardMaterial, slot: TextureSlot, tex: THREE.Texture): void {
    if (slot === 'emissiveMap' && !std.emissiveMap) return;
    if (std[slot] === tex) return;
    std[slot] = tex;
    if (slot === 'normalMap') std.normalScale.copy(this.normalScale);
    std.needsUpdate = true;
  }

  /**
   * The texture a recipe of this material last rendered to, or undefined before its first render; with a
   * mesh, that mesh's recipe's. Found through the recipes rather than by the material's name alone, since a
   * recipe whose colour is its mesh's own keeps its texture under both (two of a ship's, the YT-2400's
   * patterns, read their texture choice as the hull's own, which changes nothing for a ship: it is one mesh).
   */
  textureOf(material: string, mesh?: string): THREE.DataTexture | undefined {
    for (const r of this.recipes) {
      if (r.material !== material || (mesh !== undefined && r.mesh !== mesh)) continue;
      const tex = this.textures.get(slotKey(r, 'map'));
      if (tex) return tex;
    }
    return undefined;
  }

  /** What the console's `__debug.dye()` reads: the textures held and how many are a mesh's own, the queue, and the last render. */
  stats(): { textures: number; perMesh: number; queued: number; running: boolean; lastMs: number | null; staleDropped: number } {
    let own = 0;
    let maps = 0;
    for (const k of this.textures.keys()) {
      if (/#(normal|emis)$/.test(k)) continue;
      maps++;
      if (k.includes('|')) own++;
    }
    return { textures: maps, perMesh: own, queued: this.queued.size, running: this.running, lastMs: this.lastMs === null ? null : Number(this.lastMs.toFixed(1)), staleDropped: this.staleDropped };
  }

  /** How the normal maps are read: their strength, with the green taken as it stands, the same way up as the rest of the world's. */
  normalScale = new THREE.Vector2(1, 1);

  /** Change the strength or flip the normal maps on every material that has one, live. */
  setNormalScale(x: number, y: number): number {
    this.normalScale.set(x, y);
    let n = 0;
    for (const r of this.recipes) {
      const normal = this.textures.get(slotKey(r, 'normalMap'));
      if (!normal) continue;
      for (const m of this.targets(r)) {
        (m as THREE.MeshStandardMaterial).normalScale.copy(this.normalScale);
        n++;
      }
    }
    return n;
  }

  private putNormal(r: Recipe, img: Img): void {
    this.putOwn(r, img, 'normalMap');
  }

  /**
   * A part came or went: the materials a recipe feeds get its texture again after a reload, and
   * a piece just put on whose look a chosen value changes (a hairstyle in the hair colour picked,
   * a shirt in a colour set before it was worn) is rendered for the first time.
   */
  reapply(): void {
    this.invalidate();
    for (const r of this.recipes) {
      const tex = this.textures.get(slotKey(r, 'map'));
      if (!tex) {
        if (this.active(r) && this.readsSetValue(r)) this.queued.add(r);
        continue;
      }
      const normal = this.textures.get(slotKey(r, 'normalMap'));
      const emis = this.textures.get(slotKey(r, 'emissiveMap'));
      // A lit half with no glow beside it would leave the glowing part dark: rendered whole for materials
      // that had no glow map, it is rendered again, split, for the ones that came and have one.
      if (!emis && this.splits(r)) this.queued.add(r);
      for (const m of this.targets(r)) {
        const std = m as THREE.MeshStandardMaterial;
        this.onSlot(std, 'map', tex);
        if (normal) this.onSlot(std, 'normalMap', normal);
        if (emis) this.onSlot(std, 'emissiveMap', emis);
      }
    }
    if (this.queued.size) void this.run();
  }

  private async loadImagesFor(r: Recipe): Promise<void> {
    const files = new Set<string>();
    const fromShader = (s: Recipe['shader']) => {
      for (const f of Object.values(s?.textures ?? {})) files.add(f);
      for (const c of s?.choices ?? []) for (const f of c.files) if (f) files.add(f);
    };
    fromShader(r.shader);
    for (const slot of r.slots) {
      for (const s of slot.blueprint.shaders) fromShader(s);
      for (const f of slot.blueprint.textures) if (f) files.add(f);
    }
    const dir = this.dirOf.get(r) ?? '';
    await Promise.all([...files].map((f) => this.image(dir, f)));
  }

  private image(dir: string, file: string): Promise<Img | null> {
    const key = `${dir}${file}`.toLowerCase();
    if (this.images.has(key)) return Promise.resolve(this.images.get(key)!);
    let p = this.pending.get(key);
    if (!p) {
      p = loadPng(`${dir}${file}`).then((img) => {
        this.images.set(key, img);
        this.pending.delete(key);
        return img;
      });
      this.pending.set(key, p);
    }
    return p;
  }

  /** What goes into a mesh's textures, for the console: each recipe's shader stages, choices, factors and blueprint operations. */
  describe(mesh: string): unknown[] {
    const shader = (s: Recipe['shader']) =>
      s && {
        effect: s.effect,
        textures: s.textures,
        stages: (s.passes?.[0]?.stages ?? []).map((st) => `${st.textureTag}: color op ${st.colorOp} of ${st.colorArgs.map((a) => a[0]).join(',')}; alpha op ${st.alphaOp} of ${st.alphaArgs.map((a) => a[0]).join(',')}`),
        choices: s.choices.map((c) => `${c.tag} <- ${c.variable}${c.private ? ' (private)' : ''} default ${c.default}: ${c.files.length} textures`),
        palettes: s.palettes.map((p) => `${p.tag} <- ${p.variable}${p.private ? ' (private)' : ''} from ${p.palette}`),
        tfactors: s.tfactors,
      };
    return this.recipes
      .filter((r) => r.mesh.includes(mesh) || r.material.includes(mesh))
      .map((r) => ({
        mesh: r.mesh,
        material: r.material,
        kind: r.kind,
        baseTag: r.baseTag,
        active: this.active(r),
        rendered: this.textures.has(slotKey(r, 'map')),
        perMesh: perMesh(r),
        shader: shader(r.shader),
        slots: r.slots.map((slot) => ({
          tag: slot.tag,
          file: slot.file,
          size: `${slot.blueprint.width}x${slot.blueprint.height}`,
          variables: slot.blueprint.variables.map((v) => `${v.name}${v.private ? ' (private)' : ''}: ${v.kind} default ${v.default}${v.max !== undefined ? ` of ${v.max}` : ''}`),
          prepare: slot.blueprint.prepare.map((op) => `${op.kind} ${op.tag} on shader ${op.shader}${'variable' in op ? ` <- variable ${op.variable}` : ''}`),
          shaders: slot.blueprint.shaders.map(shader),
        })),
        values: [...this.values].filter(([k]) => k.startsWith(`${r.mesh}|`) || !k.includes('|')).map(([k, v]) => `${k}=${v}`),
      }));
  }

  dispose(): void {
    // Nothing more is rendered for a dropped customizer: a loop mid-queue ends after the render in hand, and
    // a render still out in a worker when it comes back puts nothing.
    this.disposed = true;
    this.queued.clear();
    // A shared render is the share's to let go of, never this customizer's.
    if (!this.share) for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
  }
}

/** A PNG's pixels, rows top to bottom, read as they are (a canvas would premultiply the alpha and black out the transparent texels). */
async function loadPng(url: string): Promise<Img | null> {
  try {
    if (typeof DecompressionStream !== 'undefined') {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await decodePng(new Uint8Array(await res.arrayBuffer()));
    }
  } catch (err) {
    console.warn('customize: could not decode', url, err);
  }
  return loadPngByCanvas(url);
}

function loadPngByCanvas(url: string): Promise<Img | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = im.width;
      canvas.height = im.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return resolve(null);
      ctx.drawImage(im, 0, 0);
      const data = ctx.getImageData(0, 0, im.width, im.height).data;
      resolve({ width: im.width, height: im.height, rgba: data });
    };
    im.onerror = () => resolve(null);
    im.src = url;
  });
}
