// Live customization of a character: the parts pack's recipes (customize.json) rendered in the
// browser with the current colours and choices, the results put on the character's materials.
// A change re-renders only the recipes that read the variable, off the main thread's critical
// path in idle time, one after another, so a slider that moves fast lands on its last value.
import * as THREE from 'three';
import { type CustomizeFile, type Img, type Recipe, type Values, recipeVariables, renderRecipe } from './texrender';

export class Customizer {
  readonly values: Values = new Map();
  private readonly images = new Map<string, Img | null>();
  private readonly pending = new Map<string, Promise<Img | null>>();
  private readonly deps = new Map<Recipe, Set<string>>();
  private readonly textures = new Map<string, THREE.DataTexture>();
  private queued = new Set<Recipe>();
  private running = false;
  /** Materials by name across the character's meshes, refreshed by the character as parts come and go. */
  materialsFor: (name: string) => THREE.Material[] = () => [];
  /** Called when a render lands, so a preview can redraw. */
  onRendered: () => void = () => {};

  private constructor(readonly file: CustomizeFile, private readonly dir: string) {
    for (const r of file.recipes) this.deps.set(r, recipeVariables(r));
  }

  /** The pack's recipes, or null when the pack carries none (converted before live customization). */
  static async load(dir: string): Promise<Customizer | null> {
    try {
      const res = await fetch(`${dir}customize.json`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      const file = (await res.json()) as CustomizeFile;
      if (!file.recipes?.length) return null;
      return new Customizer(file, dir);
    } catch {
      return null;
    }
  }

  /** Every variable the recipes read, with its default: what the sliders and swatches show. */
  variables(): { name: string; default: number }[] {
    const out = new Map<string, number>();
    for (const r of this.file.recipes) {
      const add = (name: string, def: number) => {
        if (!out.has(name)) out.set(name, def);
      };
      for (const c of r.shader?.choices ?? []) add(c.variable, c.default);
      for (const p of r.shader?.palettes ?? []) add(p.variable, p.default);
      for (const slot of r.slots) {
        for (const s of slot.blueprint.shaders) {
          for (const c of s?.choices ?? []) add(c.variable, c.default);
          for (const p of s?.palettes ?? []) add(p.variable, p.default);
        }
        for (const v of slot.blueprint.variables) add(v.name, v.default);
      }
    }
    return [...out].map(([name, def]) => ({ name, default: def }));
  }

  /** Whether any recipe reads the variable. */
  affects(name: string): boolean {
    const short = name.replace(/^.*\//, '');
    for (const d of this.deps.values()) if (d.has(name) || d.has(short)) return true;
    return false;
  }

  /** Set a variable and re-render what reads it; returns how many recipes will re-render. */
  set(name: string, value: number): number {
    this.values.set(name, value);
    const short = name.replace(/^.*\//, '');
    let n = 0;
    for (const [r, d] of this.deps) {
      if (!d.has(name) && !d.has(short)) continue;
      this.queued.add(r);
      n++;
    }
    if (n) void this.run();
    return n;
  }

  /** Set several at once (a saved appearance) and render everything that reads any of them. */
  setAll(values: Record<string, number>): void {
    for (const [name, v] of Object.entries(values)) this.values.set(name, v);
    for (const [r, d] of this.deps) for (const name of Object.keys(values)) if (d.has(name) || d.has(name.replace(/^.*\//, ''))) this.queued.add(r);
    if (this.queued.size) void this.run();
  }

  /** Render every recipe (the pack was baked with its own defaults; ours may differ). */
  renderAll(): void {
    for (const r of this.file.recipes) this.queued.add(r);
    void this.run();
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
        const img = renderRecipe(r, this.values, this.file.palettes, (file) => (file ? this.images.get(file.toLowerCase()) ?? null : null));
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

  /** The materials a recipe feeds get its texture again after a part is reloaded. */
  reapply(): void {
    for (const r of this.file.recipes) {
      const tex = this.textures.get(r.material);
      if (!tex) continue;
      for (const m of this.materialsFor(r.material)) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.map !== tex) {
          std.map = tex;
          std.needsUpdate = true;
        }
      }
    }
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
    await Promise.all([...files].map((f) => this.image(f)));
  }

  private image(file: string): Promise<Img | null> {
    const key = file.toLowerCase();
    if (this.images.has(key)) return Promise.resolve(this.images.get(key)!);
    let p = this.pending.get(key);
    if (!p) {
      p = loadPng(`${this.dir}${this.file.images}${file}`).then((img) => {
        this.images.set(key, img);
        this.pending.delete(key);
        return img;
      });
      this.pending.set(key, p);
    }
    return p;
  }

  dispose(): void {
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
  }
}

/** A PNG's pixels, rows top to bottom, through an image element and a canvas. */
function loadPng(url: string): Promise<Img | null> {
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
