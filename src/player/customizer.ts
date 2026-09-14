// Live customization of a character: the parts pack's recipes (customize.json) rendered in the
// browser with the current colours and choices, the results put on the character's materials.
// A change re-renders only the recipes that read the variable, off the main thread's critical
// path in idle time, one after another, so a slider that moves fast lands on its last value.
import * as THREE from 'three';
import { type CustomizeFile, type Img, type Recipe, type Values, recipeVariableDefs, recipeVariables, renderRecipe, variableKey } from './texrender';
import { decodePng } from './png';

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
  /** Materials by name across the character's meshes, refreshed by the character as parts come and go. */
  materialsFor: (name: string) => THREE.Material[] = () => [];
  /** Called when a render lands, so a preview can redraw. */
  onRendered: () => void = () => {};

  /** The recipes of a pack folder, added to what is already here; false when the folder has none. */
  async addSource(dir: string): Promise<boolean> {
    if (this.loaded.has(dir)) return true;
    try {
      const res = await fetch(`${dir}customize.json`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return false;
      const file = (await res.json()) as CustomizeFile;
      if (!file.recipes?.length) return false;
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
    return this.materialsFor(r.material).length > 0;
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
  variables(): { key: string; name: string; private: boolean; mesh: string; default: number; kind: 'palette' | 'index'; palette?: string; count?: number; colors?: number[][] }[] {
    if (this.variableCache) return this.variableCache;
    const out = new Map<string, { key: string; name: string; private: boolean; mesh: string; default: number; kind: 'palette' | 'index'; palette?: string; count?: number; colors?: number[][] }>();
    for (const r of this.recipes) {
      if (!this.active(r)) continue;
      for (const d of recipeVariableDefs(r)) {
        const key = variableKey(d.name, d.private, r.mesh);
        const prev = out.get(key);
        if (prev) {
          if (d.count && (!prev.count || d.count > prev.count)) prev.count = d.count;
          continue;
        }
        out.set(key, { key, name: d.name, private: d.private, mesh: r.mesh, default: d.default, kind: d.kind, ...(d.palette ? { palette: d.palette, colors: this.palettes[d.palette] } : {}), ...(d.count ? { count: d.count } : {}) });
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
        await this.loadImagesFor(r);
        // Between recipes the frame gets a turn, so a whole re-render does not freeze the game.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const t0 = performance.now();
        const dir = this.dirOf.get(r) ?? '';
        const img = renderRecipe(r, this.values, this.palettes, (file) => (file ? this.images.get(`${dir}${file}`.toLowerCase()) ?? null : null));
        if (!img) continue;
        this.put(r, img);
        const ms = performance.now() - t0;
        if (ms > 250) console.info(`customize: ${r.material} rendered in ${ms.toFixed(0)} ms (${img.width}x${img.height})`);
      }
    } finally {
      this.running = false;
    }
    this.onRendered();
  }

  private put(r: Recipe, img: Img): void {
    let tex = this.textures.get(r.material);
    if (!tex || tex.image.width !== img.width || tex.image.height !== img.height) {
      tex?.dispose();
      tex = new THREE.DataTexture(new Uint8Array(img.rgba), img.width, img.height, THREE.RGBAFormat);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 4;
      this.textures.set(r.material, tex);
    } else (tex.image.data as Uint8Array).set(img.rgba);
    tex.needsUpdate = true;
    for (const m of this.materialsFor(r.material)) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.map !== tex) {
        std.map = tex;
        std.needsUpdate = true;
      }
    }
  }

  /**
   * A part came or went: the materials a recipe feeds get its texture again after a reload, and
   * a piece just put on whose look a chosen value changes (a hairstyle in the hair colour picked,
   * a shirt in a colour set before it was worn) is rendered for the first time.
   */
  reapply(): void {
    this.invalidate();
    for (const r of this.recipes) {
      const tex = this.textures.get(r.material);
      if (!tex) {
        if (this.active(r) && this.readsSetValue(r)) this.queued.add(r);
        continue;
      }
      for (const m of this.materialsFor(r.material)) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.map !== tex) {
          std.map = tex;
          std.needsUpdate = true;
        }
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
        rendered: this.textures.has(r.material),
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
    for (const t of this.textures.values()) t.dispose();
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
