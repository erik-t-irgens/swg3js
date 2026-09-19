// A ship's paint at run time. A ship wears its GLB's own materials, whose map is the converter's stock
// bake, until it is first given custom paint; only then does it get copies of its paint materials (the
// meshes whose material is one of the hull's paint shaders), rendered through the game's own shader
// recipes (customize.json) by a Customizer whose renders run off the main thread (the renderer the garage
// gives it: paintRender.ts). Stock ships add nothing to the world's per-frame material sets.
//
// Nothing compiles on a live frame: the copies are prepared (joined to the world's material schemes and
// compiled, on stand-in meshes, through the `prepare` hook) before they go on, their program key is their
// source's, a repaint swaps `map` (and on a glowing shader `emissiveMap`) between textures on the same
// channel, and going back to stock swaps the sources back. A render still in flight when the paint goes
// back to stock (or when a newer paint is asked for before the copies are on) comes back empty and puts
// nothing. Loadable by the node tests (three, the customizer and pure modules only).
import * as THREE from 'three';
import { Customizer, loadCustomizeFile, type RecipeRender } from '../player/customizer.ts';
import type { Img, Recipe } from '../player/texrender.ts';
import { decodePng } from '../player/png.ts';
import { paintIsDefault, type FitPaint, type PaintVariable } from './shipFit.ts';
import type { PaintImg, PaintRecipe } from './paintJob.ts';

export interface PaintHooks {
  /** Join the world's material schemes and compile a mesh at a time (World.vehiclePrepare; the preview's own compile). */
  prepare: (roots: THREE.Object3D[]) => Promise<void>;
  /** Take materials out of the portal renderer's set and the cascades' map (World.forgetMaterials). */
  forget: (materials: THREE.Material[]) => void;
  /** Where the recipes render (the garage gives paintRender's `renderPaint`, a worker). */
  render: RecipeRender;
}

/** A render tagged with the paint generation it was asked for under. */
type Tagged = PaintImg & { paintGen?: number };

const lower = (s: string): string => s.toLowerCase();

/** A texture made exactly as the customizer makes a map: nothing here is in the program key, and three's DataTexture defaults would draw it blocky and clamped. */
function paintTexture(img: Img): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(img.rgba), img.width, img.height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.channel = 0;
  tex.needsUpdate = true;
  return tex;
}

/** Refill a texture made by paintTexture, or make a new one when the size changed (the old one disposed). */
function refill(tex: THREE.DataTexture | undefined, img: Img): THREE.DataTexture {
  if (tex && tex.image.width === img.width && tex.image.height === img.height) {
    (tex.image.data as Uint8Array).set(img.rgba);
    tex.needsUpdate = true;
    return tex;
  }
  tex?.dispose();
  return paintTexture(img);
}

export class ShipPaint {
  private readonly paint: FitPaint;
  private readonly packDir: string;
  private readonly hooks: PaintHooks;
  /** The paint shaders, by lower-case material name. */
  private readonly shaders: Set<string>;
  /** Every tracked mesh with its own materials as they were when tracked (the sources, per material slot). */
  private readonly tracked = new Map<THREE.Mesh, THREE.Material[]>();
  /** A mesh wearing each source, for the stand-ins a copy is compiled on. */
  private readonly wearer = new Map<THREE.Material, THREE.Mesh>();
  /** This ship's copy of each paint source, made once, and the copies by lower-case material name. */
  private readonly copies = new Map<THREE.Material, THREE.Material>();
  private readonly copiesByName = new Map<string, THREE.Material[]>();
  private customizer: Customizer | null = null;
  /** Bumped by every change of course (stock, a first custom paint, the static view, dispose): a render asked for under an older one puts nothing. */
  private gen = 0;
  private isCustom = false;
  private staticOn = false;
  private disposed = false;
  /** The values in force, every variable. */
  private current: Record<string, number>;
  /** The glow maps this paint rendered, by lower-case material name, and the static view's maps. */
  private readonly emisTex = new Map<string, THREE.DataTexture>();
  private readonly staticTex = new Map<string, THREE.DataTexture>();
  /** A warning once when the pack has no paint recipes. */
  private warnedNoRecipes = false;

  constructor(paint: FitPaint, packDir: string, hooks: PaintHooks) {
    this.paint = paint;
    this.packDir = packDir;
    this.hooks = hooks;
    this.shaders = new Set(paint.shaders.map(lower));
    this.current = this.normalise({});
  }

  /** Whether the ship wears its own painted copies now. */
  get custom(): boolean {
    return this.isCustom;
  }

  /** The live copies (empty while the paint is stock). */
  get materials(): readonly THREE.Material[] {
    return [...this.copies.values()];
  }

  /** The values in force, every variable. */
  get values(): Readonly<Record<string, number>> {
    return this.current;
  }

  /** Every variable's value from `values`, clamped, the default where it is not given. */
  private normalise(values: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const v of this.paint.variables) out[v.name] = ShipPaint.clamp(v, values[v.name]);
    return out;
  }

  private static clamp(v: PaintVariable, x: number | undefined): number {
    if (typeof x !== 'number' || !Number.isFinite(x)) return v.default;
    const top = v.kind === 'index' ? Math.max(1, v.count ?? 1) - 1 : Math.max(1, v.size ?? 256) - 1;
    return Math.min(top, Math.max(0, Math.round(x)));
  }

  private isPaint(m: THREE.Material): boolean {
    return this.shaders.has(lower(m.name ?? ''));
  }

  /**
   * Note the meshes under root that wear a paint shader (their materials now are their sources). While
   * the ship wears copies (custom, or the static view), each new source gets its copy, made once, and the
   * meshes wear it at once, before the part is prepared, so the staging prepare compiles it with the part;
   * a copy whose recipe has rendered gets its texture (and glow) at once, and one whose has not is queued.
   */
  track(root: THREE.Object3D): void {
    if (this.disposed) return;
    const fresh: THREE.Mesh[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || this.tracked.has(mesh)) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!mats.some((m) => m && this.isPaint(m))) return;
      this.tracked.set(mesh, [...mats]);
      for (const m of mats) if (m && this.isPaint(m) && !this.wearer.has(m)) this.wearer.set(m, mesh);
      fresh.push(mesh);
    });
    if (!fresh.length) return;
    // Copies are made while the ship wears them (custom, or the static view: even when every paint mesh so far
    // was on parts not yet hung, so none existed) or while a first custom paint is being prepared (it has copies).
    if (!this.isCustom && !this.staticOn && !this.copies.size) return;
    this.ensureCopies();
    if (this.isCustom || this.staticOn) {
      for (const mesh of fresh) this.wear(mesh, true);
      for (const [name, tex] of this.emisTex) this.putEmissive(name, tex);
      if (this.staticOn) for (const [name, tex] of this.staticTex) this.putMap(name, tex);
    }
    if (this.customizer) {
      this.customizer.invalidate();
      if (!this.staticOn) this.customizer.reapply();
    }
  }

  /** Forget the meshes under root (a part taken down); a copy no tracked mesh wears any more is forgotten and disposed. */
  untrack(root: THREE.Object3D): void {
    let any = false;
    root.traverse((o) => {
      if (this.tracked.delete(o as THREE.Mesh)) any = true;
    });
    if (!any) return;
    const inUse = new Set<THREE.Material>();
    for (const mats of this.tracked.values()) for (const m of mats) inUse.add(m);
    const gone: THREE.Material[] = [];
    for (const [src, copy] of this.copies) {
      if (inUse.has(src)) continue;
      this.copies.delete(src);
      this.wearer.delete(src);
      const name = lower(copy.name ?? '');
      const list = this.copiesByName.get(name)?.filter((c) => c !== copy) ?? [];
      if (list.length) this.copiesByName.set(name, list);
      else this.copiesByName.delete(name);
      gone.push(copy);
    }
    for (const src of [...this.wearer.keys()]) if (!inUse.has(src)) this.wearer.delete(src);
    if (gone.length) {
      this.hooks.forget(gone);
      for (const c of gone) c.dispose();
    }
    this.customizer?.invalidate();
  }

  /** A copy for every tracked source that has none (made once per source: `clone()`, with the source's userData, the dry flag among it). */
  private ensureCopies(): THREE.Material[] {
    const made: THREE.Material[] = [];
    for (const mats of this.tracked.values()) {
      for (const src of mats) {
        if (!src || !this.isPaint(src) || this.copies.has(src)) continue;
        const copy = src.clone();
        copy.userData = { ...src.userData };
        this.copies.set(src, copy);
        const name = lower(copy.name ?? '');
        (this.copiesByName.get(name) ?? this.copiesByName.set(name, []).get(name)!).push(copy);
        made.push(copy);
      }
    }
    return made;
  }

  /** A mesh wearing its copies (true) or its sources (false), in its own material layout. */
  private wear(mesh: THREE.Mesh, copies: boolean): void {
    const sources = this.tracked.get(mesh);
    if (!sources) return;
    const mats = sources.map((s) => (copies ? (this.copies.get(s) ?? s) : s));
    mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
  }

  private wearAll(copies: boolean): void {
    for (const mesh of this.tracked.keys()) this.wear(mesh, copies);
  }

  /** Stand-in meshes wearing the copies, in a detached group, for the `prepare` hook (they share geometry and are dropped undisposed). */
  private standIns(copies: Iterable<[THREE.Material, THREE.Material]>): THREE.Group {
    const group = new THREE.Group();
    for (const [src, copy] of copies) {
      const mesh = this.wearer.get(src);
      if (!mesh) continue;
      const sk = mesh as THREE.SkinnedMesh;
      let p: THREE.Mesh;
      if (sk.isSkinnedMesh) {
        const s = new THREE.SkinnedMesh(sk.geometry, copy);
        s.bind(sk.skeleton, sk.bindMatrix);
        p = s;
      } else p = new THREE.Mesh(mesh.geometry, copy);
      p.castShadow = mesh.castShadow;
      p.receiveShadow = mesh.receiveShadow;
      p.frustumCulled = mesh.frustumCulled;
      p.layers.mask = mesh.layers.mask;
      group.add(p);
    }
    return group;
  }

  /** The copies that have been through `prepare` (a copy made after, for a part tracked meanwhile, is prepared before it is worn). */
  private readonly prepared = new WeakSet<THREE.Material>();

  /** Make the copies still missing and compile every copy not yet compiled. */
  private async prepareCopies(): Promise<void> {
    this.ensureCopies();
    const fresh = [...this.copies].filter(([, c]) => !this.prepared.has(c));
    if (!fresh.length) return;
    await this.hooks.prepare([this.standIns(fresh)]);
    for (const [, c] of fresh) this.prepared.add(c);
  }

  /** Leave the static view: each copy's own map back (its source's, until a render lands), the static textures disposed. */
  private leaveStatic(): void {
    if (!this.staticOn && !this.staticTex.size) return;
    this.staticOn = false;
    for (const [src, copy] of this.copies) {
      const std = copy as THREE.MeshStandardMaterial;
      const own = (this.customizer?.textureOf(copy.name ?? '') ?? (src as THREE.MeshStandardMaterial).map) as THREE.Texture | null;
      // Never a map taken away or added: that would be a new program.
      if (own && std.map && std.map !== own) {
        std.map = own;
        std.needsUpdate = true;
      }
    }
    for (const t of this.staticTex.values()) t.dispose();
    this.staticTex.clear();
  }

  private makeCustomizer(): Customizer {
    const c = new Customizer((r, values, palettes, dir) => {
      const g = this.gen;
      return this.hooks.render(this.recipeFor(r), values, palettes, dir).then((img): Tagged | null => {
        if (!img || g !== this.gen || this.disposed) return null;
        const t = img as Tagged;
        t.paintGen = g;
        return t;
      });
    });
    c.materialsFor = (name) => this.copiesByName.get(lower(name)) ?? [];
    // Checked in the same step the texture goes on: a render from before a change of course, or while the static view is up, puts nothing.
    c.accept = (_r, img) => (img as Tagged).paintGen === this.gen && !this.disposed && !this.staticOn;
    c.onPut = (r, img) => {
      const emis = (img as PaintImg).emis;
      if (!emis) return;
      const name = lower(r.material);
      const tex = refill(this.emisTex.get(name), emis);
      this.emisTex.set(name, tex);
      this.putEmissive(name, tex);
    };
    return c;
  }

  /** The recipe as rendered: a glowing shader's split is asked for only when its copies have a glow map to take it (none is ever added). */
  private recipeFor(r: Recipe): Recipe {
    const p = r as PaintRecipe;
    if (!p.glow) return r;
    const withGlow = (this.copiesByName.get(lower(r.material)) ?? []).some((m) => !!(m as THREE.MeshStandardMaterial).emissiveMap);
    if (withGlow) return r;
    const plain: PaintRecipe = { ...p };
    delete plain.glow;
    return plain;
  }

  /** A glow map on every copy of a material that has one (never on one that has none: that would be a new program). */
  private putEmissive(name: string, tex: THREE.DataTexture): void {
    for (const m of this.copiesByName.get(name) ?? []) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.emissiveMap || std.emissiveMap === tex) continue;
      std.emissiveMap = tex;
      std.needsUpdate = true;
    }
  }

  private putMap(name: string, tex: THREE.Texture): void {
    for (const m of this.copiesByName.get(name) ?? []) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.map || std.map === tex) continue;
      std.map = tex;
      std.needsUpdate = true;
    }
  }

  private async waitSettled(wait: number): Promise<void> {
    const c = this.customizer;
    if (!c) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<void>((resolve) => (timer = setTimeout(resolve, wait)));
    try {
      await Promise.race([c.settled(), late]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Resolves when every queued render has landed, or after `wait` ms, whichever is first. */
  settled(wait = 3000): Promise<void> {
    return this.waitSettled(wait);
  }

  /**
   * Paint these values (every variable; one not given takes its default). Stock values take the copies off
   * (a swap between compiled materials), forget and dispose them. The first custom values make the copies,
   * prepare them, render them, and put them on in one step once the renders have landed or `wait` ms have
   * passed. Later custom values render only the variables that changed, landing as they come.
   */
  async apply(values: Record<string, number>, wait = 3000): Promise<void> {
    if (this.disposed) return;
    const next = this.normalise(values);
    if (paintIsDefault(this.paint, next)) {
      this.current = next;
      if (!this.copies.size && !this.customizer) return;
      this.gen++;
      this.dropCopies();
      return;
    }
    if (this.isCustom && this.customizer && !this.staticOn) {
      const changed: Record<string, number> = {};
      for (const [k, v] of Object.entries(next)) if (this.current[k] !== v) changed[k] = v;
      this.current = next;
      if (!Object.keys(changed).length) return;
      this.customizer.setAll(changed);
      await this.waitSettled(wait);
      return;
    }
    const g = ++this.gen;
    this.current = next;
    this.leaveStatic();
    await this.prepareCopies();
    if (g !== this.gen || this.disposed) return;
    this.customizer ??= this.makeCustomizer();
    const has = await this.customizer.addSource(this.packDir);
    if (g !== this.gen || this.disposed) return;
    if (!has && !this.warnedNoRecipes) {
      this.warnedNoRecipes = true;
      console.warn(`paint: no paint recipes at ${this.packDir}customize.json; the ship keeps its stock paint (the ships were converted before ship customization)`);
    }
    // A fresh customizer, or one whose renders a change of course dropped: every value, so every recipe renders.
    this.customizer.setAll(next);
    await this.waitSettled(wait);
    if (g !== this.gen || this.disposed) return;
    // A part tracked meanwhile brought a copy the first prepare did not see.
    await this.prepareCopies();
    if (g !== this.gen || this.disposed) return;
    this.wearAll(true);
    for (const [name, tex] of this.emisTex) this.putEmissive(name, tex);
    this.isCustom = true;
  }

  /** Every tracked mesh back on its sources; the copies forgotten and disposed, and the customizer and the maps with them. */
  private dropCopies(): void {
    this.wearAll(false);
    const gone = [...this.copies.values()];
    if (gone.length) this.hooks.forget(gone);
    for (const c of gone) c.dispose();
    this.copies.clear();
    this.copiesByName.clear();
    this.customizer?.dispose();
    this.customizer = null;
    for (const t of this.emisTex.values()) t.dispose();
    this.emisTex.clear();
    for (const t of this.staticTex.values()) t.dispose();
    this.staticTex.clear();
    this.isCustom = false;
    this.staticOn = false;
  }

  /**
   * For the console: put each paint shader's pre-customization MAIN (the SSHT's own texture, the look before
   * ship paint was converted) on this ship's copies (making and preparing them when the paint is stock), or
   * take it off again (stock values go back to the sources; custom ones render again).
   */
  async showStatic(on: boolean): Promise<void> {
    if (this.disposed) return;
    if (on) {
      const g = ++this.gen;
      this.staticOn = true;
      await this.prepareCopies();
      if (g !== this.gen || this.disposed) return;
      const file = await loadCustomizeFile(this.packDir);
      if (g !== this.gen || this.disposed) return;
      const dir = `${this.packDir}${file?.images ?? 'customize/'}`;
      for (const name of this.copiesByName.keys()) {
        const r = (file?.recipes ?? []).find((x) => lower(x.material) === name) as PaintRecipe | undefined;
        if (!r?.staticMain) continue;
        let tex = this.staticTex.get(name);
        if (!tex) {
          try {
            const res = await fetch(`${dir}${r.staticMain}`);
            if (!res.ok) continue;
            tex = paintTexture(await decodePng(new Uint8Array(await res.arrayBuffer())));
            this.staticTex.set(name, tex);
          } catch (err) {
            console.warn(`paint: ${name}'s own texture did not load`, err);
            continue;
          }
        }
        if (g !== this.gen || this.disposed) return;
        this.putMap(name, tex);
      }
      this.wearAll(true);
      return;
    }
    if (!this.staticOn) return;
    this.gen++;
    this.leaveStatic();
    if (paintIsDefault(this.paint, this.current)) {
      this.dropCopies();
      return;
    }
    if (!this.isCustom || !this.customizer) {
      await this.apply(this.current);
      return;
    }
    // Custom: the rendered maps back on, and every recipe again (any render the static view dropped).
    this.customizer.reapply();
    this.customizer.setAll(this.current);
  }

  dispose(): void {
    if (this.disposed) return;
    this.gen++;
    this.dropCopies();
    this.disposed = true;
    this.tracked.clear();
    this.wearer.clear();
  }
}
