// Animated surfaces: the flip-book screens and the scrolling waterfalls the converter writes into a
// model's materials (`extras.swg`, tools/swg/glb.mjs). A flip-book swaps `map` (and `emissiveMap`)
// between textures of one kind and a scroll moves `texture.offset`; neither is in three's program
// key, so nothing compiles while they play. Everything that is in the key (additive blending, the
// alpha map, the alpha test, fog) is set by the GLTF plugin in `afterRoot`, before the model ever
// reaches the scene, so the loading screen and the compile queue build the program that is drawn.
//
// One record per shader per loaded GLB, shared by every material that draws it (the placed copies'
// shared material, an interior cell's clone, GLTFLoader's vertex-colour clone). The plugin only
// registers records; a material joins its record in `World.adoptMaterials`, when it is in the
// scene, and leaves on its 'dispose' (or `forget`). `sweep` drops the records no material joined.
import * as THREE from 'three';
import type { GLTF, GLTFLoader, GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { frac, makeClock, stepClock, type FlipClock, type FlipMode } from './surfaceClock.ts';

/** The converter's `extras.swg` on a material (tools/swg/glb.mjs). */
export interface SwgSurface {
  anim?: { mode: FlipMode; seconds: [number, number]; map: number[]; emissive?: number[] };
  scroll?: { map?: [number, number]; alpha?: [number, number] | null };
  alphaMap?: number;
  alphaTest?: number;
  blend?: 'add';
  /** The detail map's glTF texture index: multiplied into the base colour at the second UV set. */
  detail?: number;
}

/** What the loader plugin needs to resolve a material's indices. */
export interface SurfaceContext {
  getTexture(i: number): Promise<THREE.Texture>;
  /** Texture indices a material's standard slot names: those follow the pack, never a track. */
  referenced: Set<number>;
  /** One load's flip-books by their frames, glows, mode and seconds, so two materials of one shader share one track. */
  trackByKey: Map<string, string>;
}

/** Frame textures uploaded per step while a flip-book first shows, so its first swap uploads nothing. */
const UPLOADS_PER_STEP = 4;
/** The longest step the clock takes: a stall or a hidden tab resumes, it does not race. */
const MAX_STEP = 0.5;
const FLIP_MODES: readonly FlipMode[] = ['time', 'random', 'pingpong', 'frame', 'randomFrame'];

/** One flip-book, shared by every material (and clone) of one shader in one loaded GLB. */
class Track {
  readonly id: string;
  readonly name: string;
  readonly key: string;
  readonly frames: THREE.Texture[];
  /** Empty, or one glow texture per frame. */
  readonly emissive: THREE.Texture[];
  /** The frame textures no material slot names: this track's to dispose. */
  readonly owned: THREE.Texture[];
  /**
   * Every texture a swap can bind except frame 0 (the material's own map), owned or not: a frame that is another
   * material's base colour may not have been drawn yet, and uploading it here keeps its first swap free of an upload.
   * `initTexture` on a texture already uploaded only binds it.
   */
  readonly warm: THREE.Texture[];
  readonly clock: FlipClock;
  readonly materials: THREE.Material[] = [];
  readonly pending: THREE.Texture[] = [];
  active = false;

  constructor(id: string, name: string, key: string, frames: THREE.Texture[], emissive: THREE.Texture[], owned: THREE.Texture[], clock: FlipClock) {
    this.id = id;
    this.name = name;
    this.key = key;
    this.frames = frames;
    this.emissive = emissive;
    this.owned = owned;
    const warm = new Set<THREE.Texture>();
    for (let i = 1; i < frames.length; i++) warm.add(frames[i]);
    for (const g of emissive) warm.add(g);
    warm.delete(frames[0]);
    this.warm = [...warm];
    this.clock = clock;
  }
}

/** One scrolling Texture object (the converter gave it its own sampler, so it has its own offset). */
class ScrollRec {
  readonly id: string;
  readonly name: string;
  readonly texture: THREE.Texture;
  readonly u: number;
  readonly v: number;
  readonly materials: THREE.Material[] = [];
  active = false;

  constructor(id: string, name: string, texture: THREE.Texture, u: number, v: number) {
    this.id = id;
    this.name = name;
    this.texture = texture;
    this.u = u;
    this.v = v;
  }
}

/**
 * One detail map, shared by every material that names it.
 *
 * It animates nothing -- the texture is bound once and never moves -- so this is a register rather
 * than a clock. It exists at all because the link has to survive `material.clone()`, which the
 * interior cells, the ship paint and GLTFLoader's own vertex-colour copies all do: `Material.copy`
 * runs `userData` through JSON and copies no field the material class does not declare, so a string
 * id in `userData` is the only thing a clone still has. That is exactly why the flip-books are
 * keyed the same way.
 */
class DetailRec {
  readonly id: string;
  readonly name: string;
  readonly texture: THREE.Texture;
  readonly materials: THREE.Material[] = [];

  constructor(id: string, name: string, texture: THREE.Texture) {
    this.id = id;
    this.name = name;
    this.texture = texture;
  }
}

type Mapped = THREE.Material & { map?: THREE.Texture | null; emissiveMap?: THREE.Texture | null; alphaMap?: THREE.Texture | null; fog?: boolean };

/** A 1x1 black glow, standing in for a frame whose glow the converter left empty: the emissive slot never empties, so the program never changes. */
let blackGlow: THREE.DataTexture | null = null;
function noGlow(): THREE.DataTexture {
  if (!blackGlow) {
    blackGlow = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    blackGlow.colorSpace = THREE.SRGBColorSpace;
    blackGlow.name = 'swg:no-glow';
    blackGlow.needsUpdate = true;
  }
  return blackGlow;
}

function swapRemove<T>(list: T[], item: T): boolean {
  const i = list.indexOf(item);
  if (i < 0) return false;
  const last = list.length - 1;
  if (i !== last) list[i] = list[last];
  list.length = last;
  return true;
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

export class AnimatedSurfaces {
  speed = 1;
  frozen = false;

  private readonly tracks = new Map<string, Track>();
  private readonly scrolls = new Map<string, ScrollRec>();
  private readonly details = new Map<string, DetailRec>();
  private readonly activeTracks: Track[] = [];
  private readonly activeScrolls: ScrollRec[] = [];
  private readonly ownedRefs = new Map<THREE.Texture, number>();
  private readonly scrollByTexture = new Map<THREE.Texture, string>();
  private readonly detailByTexture = new Map<THREE.Texture, string>();
  private readonly adopted = new WeakSet<THREE.Material>();
  private adoptedCount = 0;
  private nextId = 0;
  /** The module's own clock (seconds): monotonic, frozen or sped up at will. */
  private time = 0;
  private lastT = Number.NaN;
  /** One bound listener for every material, so adopting makes no closure. */
  private readonly onDispose = (e: { target: unknown }): void => this.forget(e.target as THREE.Material);

  /** Register the loader plugin; returns the loader so a field can be `surfaces.withPlugin(new GLTFLoader())`. */
  withPlugin(loader: GLTFLoader): GLTFLoader {
    loader.register((parser) => new SwgSurfacesPlugin(parser, this));
    return loader;
  }

  /** Called by the plugin (and tests): make a flip-book's record. Adopts nothing. */
  registerTrack(key: string, name: string, frames: THREE.Texture[], emissive: (THREE.Texture | null)[], owned: THREE.Texture[], mode: FlipMode, seconds: [number, number]): string {
    const id = `track${++this.nextId}`;
    const glows = emissive.some((t) => t) ? emissive.map((t) => t ?? noGlow()) : [];
    const own = [...new Set(owned)];
    for (const tex of own) this.ownedRefs.set(tex, (this.ownedRefs.get(tex) ?? 0) + 1);
    this.tracks.set(id, new Track(id, name, key, frames, glows, own, makeClock(frames.length, mode, seconds)));
    return id;
  }

  /** Called by the plugin (and tests): a scrolling texture's record, or the one it already has. */
  registerScroll(name: string, texture: THREE.Texture, u: number, v: number): string {
    const known = this.scrollByTexture.get(texture);
    if (known && this.scrolls.has(known)) return known;
    const id = `scroll${++this.nextId}`;
    this.scrolls.set(id, new ScrollRec(id, name, texture, u, v));
    this.scrollByTexture.set(texture, id);
    return id;
  }

  /** Called by the plugin (and tests): a detail map's record, or the one that texture already has. */
  registerDetail(name: string, texture: THREE.Texture): string {
    const known = this.detailByTexture.get(texture);
    if (known && this.details.has(known)) return known;
    const id = `detail${++this.nextId}`;
    this.details.set(id, new DetailRec(id, name, texture));
    this.detailByTexture.set(texture, id);
    return id;
  }

  /** The texture a material's `userData.swgDetail` names, or null. What the shader injection reads. */
  detailTexture(id: string | undefined): THREE.Texture | null {
    return (id ? this.details.get(id)?.texture : null) ?? null;
  }

  /** A material in the scene (original or clone) joins its track and scrolls. Idempotent. Adds one 'dispose' listener. */
  adopt(m: THREE.Material): void {
    if (this.adopted.has(m)) return;
    const trackId = m.userData.swgTrack as string | undefined;
    const scrollIds = m.userData.swgScroll as string[] | undefined;
    const detailId = m.userData.swgDetail as string | undefined;
    if (!trackId && !detailId && !(Array.isArray(scrollIds) && scrollIds.length)) return;
    const detail = detailId ? this.details.get(detailId) : undefined;
    if (detail) detail.materials.push(m);
    this.adopted.add(m);
    this.adoptedCount++;
    m.addEventListener('dispose', this.onDispose);
    const track = trackId ? this.tracks.get(trackId) : undefined;
    if (track) {
      track.materials.push(m);
      if (!track.active) {
        track.active = true;
        this.activeTracks.push(track);
        track.pending.push(...track.warm);
      }
      this.show(track, m);
    }
    if (Array.isArray(scrollIds)) {
      for (const id of scrollIds) {
        const rec = this.scrolls.get(id);
        if (!rec) continue;
        rec.materials.push(m);
        if (!rec.active) {
          rec.active = true;
          this.activeScrolls.push(rec);
        }
      }
    }
  }

  /** Leave everything. Idempotent: a second call (or a second 'dispose') does nothing. */
  forget(m: THREE.Material): void {
    if (!this.adopted.has(m)) return;
    this.adopted.delete(m);
    this.adoptedCount--;
    m.removeEventListener('dispose', this.onDispose);
    const trackId = m.userData.swgTrack as string | undefined;
    const track = trackId ? this.tracks.get(trackId) : undefined;
    if (track && swapRemove(track.materials, m)) {
      // Back to the frame its own slot names, so a material that outlives this never binds a texture the track disposes.
      const mm = m as Mapped;
      mm.map = track.frames[0];
      // A slot that is null (its own glow failed to load) stays null: filling it would change the program.
      if (track.emissive.length && mm.emissiveMap) mm.emissiveMap = track.emissive[0];
      if (!track.materials.length) this.retireTrack(track);
    }
    const scrollIds = m.userData.swgScroll as string[] | undefined;
    if (Array.isArray(scrollIds)) {
      for (const id of scrollIds) {
        const rec = this.scrolls.get(id);
        if (rec && swapRemove(rec.materials, m) && !rec.materials.length) this.retireScroll(rec);
      }
    }
    const detailId = m.userData.swgDetail as string | undefined;
    const detail = detailId ? this.details.get(detailId) : undefined;
    if (detail && swapRemove(detail.materials, m) && !detail.materials.length) this.retireDetail(detail);
  }

  /** forget() every material under a root: for owners that drop models without disposing materials. */
  forgetUnder(root: THREE.Object3D): void {
    root.traverse((o) => {
      const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      if (Array.isArray(material)) for (const m of material) this.forget(m);
      else this.forget(material);
    });
  }

  /** Drop every track, scroll and detail no material has joined (World.unload calls it after the pack is disposed). */
  sweep(): void {
    for (const track of [...this.tracks.values()]) if (!track.materials.length) this.retireTrack(track);
    for (const rec of [...this.scrolls.values()]) if (!rec.materials.length) this.retireScroll(rec);
    for (const rec of [...this.details.values()]) if (!rec.materials.length) this.retireDetail(rec);
  }

  /** Once per step: uploads a few frames, advances every active track, moves every active scroll. No allocation. */
  update(t: number, renderer: THREE.WebGLRenderer | null): void {
    const dt = Number.isNaN(this.lastT) || t < this.lastT ? 0 : t - this.lastT;
    this.lastT = t;
    if (!this.frozen) this.time += Math.min(dt, MAX_STEP) * this.speed;
    const time = this.time;
    let budget = UPLOADS_PER_STEP;
    const tracks = this.activeTracks;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const pending = track.pending;
      if (pending.length) {
        while (budget > 0 && pending.length) {
          const tex = pending.pop() as THREE.Texture;
          if (renderer) renderer.initTexture(tex);
          budget--;
        }
        if (pending.length) continue;
      }
      if (!stepClock(track.clock, time, Math.random)) continue;
      const f = track.clock.frame;
      const map = track.frames[f];
      const glow = track.emissive.length ? track.emissive[f] : null;
      const mats = track.materials;
      for (let k = 0; k < mats.length; k++) {
        const m = mats[k] as Mapped;
        m.map = map;
        if (glow && m.emissiveMap) m.emissiveMap = glow;
      }
    }
    const scrolls = this.activeScrolls;
    for (let i = 0; i < scrolls.length; i++) {
      const s = scrolls[i];
      s.texture.offset.set(frac(s.u * time), frac(s.v * time));
    }
  }

  /** For __debug.animTex: the counts, and the tracks and scrolls whose name (or a material's) holds `filter`. */
  describe(filter?: string): {
    time: number;
    speed: number;
    frozen: boolean;
    tracks: number;
    active: number;
    materials: number;
    scrolls: number;
    activeScrolls: number;
    uploadsPending: number;
    list: { name: string; frames: number; frame: number; mode: FlipMode; seconds: [number, number]; materials: number; pending: number; glows: boolean }[];
    scrolling: { name: string; rate: [number, number]; offset: [number, number]; materials: number }[];
  } {
    const want = (filter ?? '').toLowerCase();
    const named = (name: string, mats: THREE.Material[]) => !want || name.toLowerCase().includes(want) || mats.some((m) => (m.name ?? '').toLowerCase().includes(want));
    let uploadsPending = 0;
    for (const t of this.activeTracks) uploadsPending += t.pending.length;
    const list = [...this.tracks.values()]
      .filter((t) => named(t.name, t.materials))
      .map((t) => ({ name: t.name, frames: t.frames.length, frame: t.clock.frame, mode: t.clock.mode, seconds: [round4(t.clock.min), round4(t.clock.max)] as [number, number], materials: t.materials.length, pending: t.pending.length, glows: t.emissive.length > 0 }));
    const scrolling = [...this.scrolls.values()]
      .filter((s) => named(s.name, s.materials))
      .map((s) => ({ name: s.name, rate: [s.u, s.v] as [number, number], offset: [round4(s.texture.offset.x), round4(s.texture.offset.y)] as [number, number], materials: s.materials.length }));
    return {
      time: round4(this.time),
      speed: this.speed,
      frozen: this.frozen,
      tracks: this.tracks.size,
      active: this.activeTracks.length,
      materials: this.adoptedCount,
      scrolls: this.scrolls.size,
      activeScrolls: this.activeScrolls.length,
      uploadsPending,
      list,
      scrolling,
    };
  }

  /** Put a track's current frame on a material that has just joined it. */
  private show(track: Track, m: THREE.Material): void {
    const mm = m as Mapped;
    const f = track.clock.frame;
    mm.map = track.frames[f];
    if (track.emissive.length && mm.emissiveMap) mm.emissiveMap = track.emissive[f];
  }

  private retireTrack(track: Track): void {
    if (track.active) swapRemove(this.activeTracks, track);
    track.active = false;
    track.pending.length = 0;
    this.tracks.delete(track.id);
    for (const tex of track.owned) {
      const n = (this.ownedRefs.get(tex) ?? 1) - 1;
      if (n > 0) this.ownedRefs.set(tex, n);
      else {
        this.ownedRefs.delete(tex);
        tex.dispose();
      }
    }
  }

  private retireScroll(rec: ScrollRec): void {
    if (rec.active) swapRemove(this.activeScrolls, rec);
    rec.active = false;
    this.scrolls.delete(rec.id);
    if (this.scrollByTexture.get(rec.texture) === rec.id) this.scrollByTexture.delete(rec.texture);
  }

  /**
   * The last material naming a detail map has gone: forget it, and free the texture.
   *
   * Freeing it here is right because no standard material slot names a detail map -- three would
   * hold its GL texture for the life of the renderer otherwise, and a world's worth of them is
   * megabytes a travel.
   */
  private retireDetail(rec: DetailRec): void {
    this.details.delete(rec.id);
    if (this.detailByTexture.get(rec.texture) === rec.id) this.detailByTexture.delete(rec.texture);
    rec.texture.dispose();
  }
}

export const surfaces = new AnimatedSurfaces();

const isIndex = (i: unknown): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0;
const isPair = (p: unknown): p is [number, number] => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Program-key flags and track/scroll registration for one material; the plugin's per-material work, factored for tests. */
export async function applySurface(target: AnimatedSurfaces, m: THREE.Material, s: SwgSurface, ctx: SurfaceContext): Promise<void> {
  const mm = m as Mapped;
  if (s.blend === 'add') {
    m.blending = THREE.AdditiveBlending;
    m.transparent = true;
    m.depthWrite = false;
    if (mm.fog !== undefined) mm.fog = false;
  }
  if (typeof s.alphaTest === 'number' && s.alphaTest > 0) m.alphaTest = s.alphaTest;
  if (isIndex(s.alphaMap) && mm.alphaMap !== undefined) {
    // Data, with no colour space: the converter wrote the alpha as grey and three's alphaMap reads green.
    const tex = await ctx.getTexture(s.alphaMap);
    if (tex) mm.alphaMap = tex;
  }
  // The detail map. Registered here rather than bound to a slot, because there is no slot for it:
  // it is multiplied into the base colour at the second coordinate set by an injection of our own
  // (`detailMap.ts`), which reads it back through the id.
  if (isIndex(s.detail)) {
    const tex = await ctx.getTexture(s.detail);
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
      m.userData.swgDetail = target.registerDetail(m.name, tex);
    }
  }
  const scroll = s.scroll;
  if (scroll) {
    const ids: string[] = [];
    if (isPair(scroll.map) && mm.map) ids.push(target.registerScroll(m.name, mm.map, scroll.map[0], scroll.map[1]));
    if (isPair(scroll.alpha) && mm.alphaMap) ids.push(target.registerScroll(`${m.name} (alpha)`, mm.alphaMap, scroll.alpha[0], scroll.alpha[1]));
    if (ids.length) m.userData.swgScroll = ids;
  }
  const anim = s.anim;
  if (anim && Array.isArray(anim.map) && anim.map.length > 1 && anim.map.every(isIndex) && mm.map) {
    // A glow swaps only into a slot that holds a glow already: a null slot (its texture failed to load) was compiled without one.
    const glowIdx = mm.emissiveMap && Array.isArray(anim.emissive) && anim.emissive.length === anim.map.length ? anim.emissive : null;
    const mode = FLIP_MODES.includes(anim.mode) ? anim.mode : 'time';
    const seconds: [number, number] = isPair(anim.seconds) ? [anim.seconds[0], anim.seconds[1]] : [0.1, 0.1];
    // The timing is in the key: two shaders on the same frames (a loop and a ping-pong) each keep their own clock.
    const key = `${anim.map.join(',')}|${(glowIdx ?? []).join(',')}|${mode}|${seconds[0]},${seconds[1]}`;
    let id = ctx.trackByKey.get(key);
    if (!id) {
      const frames = await Promise.all(anim.map.map((i) => ctx.getTexture(i)));
      const glows = glowIdx ? await Promise.all(glowIdx.map((i) => (isIndex(i) ? ctx.getTexture(i) : Promise.resolve(null)))) : [];
      // A frame that failed to load would empty the slot mid-play (and change the program): no animation, the material keeps its own texture.
      if (frames.every((f) => f)) {
        const owned: THREE.Texture[] = [];
        anim.map.forEach((i, k) => {
          frames[k].colorSpace = THREE.SRGBColorSpace;
          if (!ctx.referenced.has(i)) owned.push(frames[k]);
        });
        if (glowIdx) {
          glowIdx.forEach((i, k) => {
            const g = glows[k];
            if (!g) return;
            g.colorSpace = THREE.SRGBColorSpace;
            if (!ctx.referenced.has(i)) owned.push(g);
          });
        }
        id = target.registerTrack(key, m.name, frames, glows, owned, mode, seconds);
        ctx.trackByKey.set(key, id);
      }
    }
    // A string, not a texture: material.clone() copies userData through JSON.
    if (id) m.userData.swgTrack = id;
  }
}

/** Whether a mesh with these materials should cast: false when any carries `userData.noShadow`. */
export function castsShadow(material: THREE.Material | THREE.Material[]): boolean {
  if (Array.isArray(material)) {
    for (const m of material) if (m.userData.noShadow) return false;
    return true;
  }
  return !material.userData.noShadow;
}

/** Whether a placed mesh with this material is a translucent converted surface that must draw after the water. */
export function drawsAfterWater(material: THREE.Material | THREE.Material[]): boolean {
  const one = (m: THREE.Material) => m.transparent && !!(m.userData.swg || m.userData.noShadow);
  return Array.isArray(material) ? material.some(one) : one(material);
}

// ---- What a surface keeps of a foot ----

/**
 * INVENTED: which of the surfaces a foot can land on takes a footprint, and how deeply -- 0 is
 * ground that keeps nothing of a step and 1 is ground that keeps all of it.
 *
 * The words are the ones the feet already resolve (`resolveSurface` in `src/audio/footsteps.ts`):
 * the nine the terrain paints (sand, rock, grass, mud, snow, surf, stone, harddirt, softdirt), the
 * four the interior table gives a room (metal, stone, wood, carpet), and the two the water answers
 * with (water, surf). Which of them is soft enough to keep a mark is ours -- the archives hold no
 * such list, and nothing in the client ever left a print -- so it is one table, here, beside the
 * rest of what a surface is, rather than a rule spread over the code that lays the marks.
 *
 * Everything absent keeps nothing, which is deliberate for the ones worth naming: rock, stone,
 * harddirt and grass out of doors, metal, wood and carpet in a room, and water and surf, where a
 * print would wash out as it was made.
 */
export const PRINT_SURFACES: Record<string, number> = {
  sand: 1,
  snow: 1,
  mud: 0.85,
  softdirt: 0.6,
};

/**
 * How deeply a surface takes a print, 0 for ground that keeps none of it and for no surface at all
 * (which is what a body swimming answers with). Pure, so the node test reads the table itself.
 */
export function printDepth(surface: string | null | undefined): number {
  if (!surface) return 0;
  const depth = PRINT_SURFACES[surface];
  return typeof depth === 'number' && depth > 0 ? depth : 0;
}

/** The texture indices any material's standard slot names. */
function referencedTextures(json: { materials?: unknown[] }): Set<number> {
  const out = new Set<number>();
  const add = (ref: unknown) => {
    const i = (ref as { index?: unknown } | undefined)?.index;
    if (isIndex(i)) out.add(i);
  };
  for (const def of (json.materials ?? []) as Record<string, unknown>[]) {
    if (!def) continue;
    const pbr = def.pbrMetallicRoughness as Record<string, unknown> | undefined;
    add(pbr?.baseColorTexture);
    add(pbr?.metallicRoughnessTexture);
    add(def.emissiveTexture);
    add(def.normalTexture);
    add(def.occlusionTexture);
  }
  return out;
}

/**
 * The GLTF plugin: in `afterRoot`, which GLTFLoader awaits before the load resolves, it sets the
 * program-key flags and registers the tracks and scrolls of every material that carries
 * `extras.swg`. It walks the scenes rather than asking for materials by index, because GLTFLoader
 * gives a primitive with vertex colours a clone of its material (the clone keeps the userData).
 */
class SwgSurfacesPlugin implements GLTFLoaderPlugin {
  readonly name = 'SWG_surfaces';
  private readonly parser: GLTFParser;
  private readonly target: AnimatedSurfaces;

  constructor(parser: GLTFParser, target: AnimatedSurfaces) {
    this.parser = parser;
    this.target = target;
  }

  afterRoot(result: GLTF): Promise<void> | null {
    const json = this.parser.json as { materials?: { extras?: { swg?: unknown } }[] };
    if (!json.materials?.some((d) => d?.extras?.swg)) return null;
    return this.apply(result, json);
  }

  private async apply(result: GLTF, json: { materials?: unknown[] }): Promise<void> {
    const parser = this.parser;
    const ctx: SurfaceContext = {
      getTexture: (i) => parser.getDependency('texture', i) as Promise<THREE.Texture>,
      referenced: referencedTextures(json),
      trackByKey: new Map(),
    };
    const seen = new Set<THREE.Material>();
    const list: THREE.Material[] = [];
    const roots = result.scenes?.length ? result.scenes : [result.scene];
    for (const root of roots) {
      root.traverse((o) => {
        const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!material) return;
        for (const m of Array.isArray(material) ? material : [material]) {
          if (!m.userData.swg || seen.has(m)) continue;
          seen.add(m);
          list.push(m);
        }
      });
    }
    for (const m of list) {
      try {
        await applySurface(this.target, m, m.userData.swg as SwgSurface, ctx);
      } catch (err) {
        console.warn(`surfaces: ${m.name || 'a material'} kept its plain look`, err);
      }
    }
  }
}
