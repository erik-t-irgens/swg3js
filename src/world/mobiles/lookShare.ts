// What the dressed people the mobiles stand share between them. A look (look.ts) is a parts body
// dressed and coloured once for its catalogue entry, and before this every look loaded its own body,
// head and clothes and drew its own renders of them: the thirty-two looks the Mos Eisley cantina stood
// weighed three hundred megabytes, every human among them with its own copy of the same normal maps.
// Here a look's pieces are kept once and shared by every look that wears them: a part's own textures
// by their image's own bytes (a Zabrak's body carries the human body's normal maps, and a shoe is one
// picture in the men's and the women's wardrobe), a colour render by its recipe and every value it
// reads, a normal map by the files it is made from, every render once more by its pixels (two species
// folders hold copies of the same images), and a mesh's geometry by its file, its place in it, the
// skeleton it was fitted to and the triangles the outfit leaves showing. A texture is only ever the
// same as another when it is drawn the same way too, so nothing any look wears changes by a pixel.
//
// Everything shared is counted, once, by what holds it: a look holds what it wears through its hold
// (`LookHold`), and a piece is disposed the moment the last look holding it goes. What putting several
// people down together gives back is therefore a figure of the set and never a sum of each one's
// (`FreeTally`). A look's materials stay its own, since a material is where each look's own colours go
// and costs nothing to draw twice.
//
// Nothing here is drawn or compiled: a look's own copies are swapped for the shared ones before the look
// is prepared, and a shared piece taken by a later look is one already prepared, so standing another
// person of the same body compiles nothing and uploads only what is new about them.
import * as THREE from 'three';

/**
 * The switch and the one number that is ours, live through `__debug.mobileAssets({ share })`. Off, a
 * look built from then on is built alone, exactly as every look was before; looks already built keep
 * what they have. `unique` is the share of a look's bytes taken to be its own (not already held by
 * another look of the same body) before any look of that body has been measured. INVENTED.
 */
export const LOOK_SHARE = { on: true, unique: 0.45 };

/** What a shared piece is: a part's own texture, a colour render, a normal map made from a render's recipe, or a mesh's geometry. */
export type ShareKind = 'texture' | 'render' | 'normal' | 'geometry';

type Shared = THREE.Texture | THREE.BufferGeometry;

interface Entry {
  /**
   * Every key it is kept under: the one it was asked for by, and what its pixels are once they are known
   * (`contentKey`), and any other key whose piece came out the same, so one image is kept once whichever
   * way it was reached.
   */
  keys: string[];
  kind: ShareKind;
  value: Shared;
  bytes: number;
  holds: Set<LookHold>;
  /**
   * `FreeTally`'s scratch, so a tally keeps nothing of its own per piece: the set it was last counted
   * for, how many looks that are out hold it, and how many of those the set puts down.
   */
  mark: number;
  live: number;
  gone: number;
}

/**
 * Two 32-bit hashes of a run of numbers and its length, as one string: what tells two images or two
 * index buffers apart. Every number is read, so two runs that differ anywhere are two keys.
 */
function hashRun(a: ArrayLike<number>, n: number): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let i = 0; i < n; i++) {
    const v = a[i];
    h1 = Math.imul(h1 ^ v, 0x01000193);
    h2 = Math.imul(h2 ^ (v + i), 0x5bd1e995);
    h2 ^= h2 >>> 13;
  }
  return `${n}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

/** `hashRun` over bytes, four at a time where they are aligned for it. */
export function hashBytes(bytes: Uint8Array): string {
  if (bytes.byteOffset % 4 === 0 && bytes.byteLength % 4 === 0) return `w${hashRun(new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4), bytes.byteLength / 4)}`;
  return `b${hashRun(bytes, bytes.length)}`;
}

/**
 * Everything about a texture besides its pixels that changes how it is drawn: its colour space, which
 * way up it is, how it wraps and filters, how sharp it stays at a slant, which coordinate set it reads
 * and its format. Two textures of the same pixels are the same texture only when all of these agree
 * too: a part's normal map and a render of the same one differ in their anisotropy, and stay two.
 */
export function textureParams(t: THREE.Texture): string {
  return [t.colorSpace, t.flipY, t.wrapS, t.wrapT, t.minFilter, t.magFilter, t.anisotropy, t.channel, t.generateMipmaps, t.format, t.type, t.premultiplyAlpha, t.unpackAlignment].join(',');
}

/**
 * A texture made from pixels here (a render) as its pixels and its drawing: two renders that came out
 * the same are one texture, whatever they were asked for by (two species folders holding copies of one
 * normal map, two recipes baking one colour). Null for a texture whose pixels are not to hand.
 */
export function contentKey(t: THREE.Texture): string | null {
  const img = t.image as { data?: ArrayBufferView; width?: number; height?: number } | null;
  const d = img?.data;
  if (!d || !ArrayBuffer.isView(d)) return null;
  return `px|${img!.width}x${img!.height}|${hashBytes(new Uint8Array(d.buffer, d.byteOffset, d.byteLength))}|${textureParams(t)}`;
}

/** GPU bytes of a texture, with its mips: what the asset cache has always counted a texture at. */
export function textureBytes(t: THREE.Texture): number {
  const img = t.image as { width?: number; height?: number } | null;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  return w * h * 4 * 1.34;
}

/** Bytes of a geometry's buffers, the blend shapes' included. */
export function geometryBytes(g: THREE.BufferGeometry): number {
  let n = g.index ? g.index.array.byteLength : 0;
  for (const a of Object.values(g.attributes)) n += (a as THREE.BufferAttribute).array.byteLength;
  for (const list of Object.values(g.morphAttributes)) for (const a of list) n += (a as THREE.BufferAttribute).array.byteLength;
  return n;
}

/** Every texture a material holds. */
export function texturesOf(m: THREE.Material, out: Set<THREE.Texture>): void {
  for (const v of Object.values(m as unknown as Record<string, unknown>)) if (v && (v as THREE.Texture).isTexture) out.add(v as THREE.Texture);
}

/**
 * Which triangles a geometry draws, as a key: the index's length and two hashes of it. Two geometries
 * of the same mesh with the same key draw exactly the same triangles, which is what an outfit changes
 * (what it covers is culled off the body), so it is what tells two copies of a body apart.
 */
export function indexKey(g: THREE.BufferGeometry): string {
  const idx = g.index;
  if (!idx) return `v${g.attributes.position?.count ?? 0}`;
  return hashRun(idx.array as ArrayLike<number>, idx.count);
}

/**
 * What the GLTF parser keeps of a part file that says where each of its textures came from: the file's
 * own json, which texture index each texture object was made for, and the bytes of a buffer view (which
 * it has already read to decode the image, so asking again reads nothing new).
 */
export interface PartFile {
  json: { textures?: { source?: number }[]; images?: { bufferView?: number }[] };
  associations: Map<unknown, { textures?: number }>;
  getDependency(type: 'bufferView', index: number): Promise<unknown>;
}

/** Where each mesh and each part texture of a character built to share came from (`recordPartSources`). */
export interface PartSources {
  meshes: WeakMap<THREE.Mesh, { file: string; index: number }>;
  textures: WeakMap<THREE.Texture, string>;
}

/**
 * Record where one part file's meshes and textures came from: a mesh as the file and its place among
 * `meshes` (the file's own, in the order the file holds them), a texture as its image's own encoded
 * bytes where the file carries them (the same picture embedded in two files is one texture: a Zabrak's
 * body wears the human body's normal maps, and a shoe is the same image in the men's and the women's
 * wardrobe) and how it is drawn (`textureParams`). A texture whose image the file does not carry as bytes
 * (a picture named by address, or one the loader copied and never listed) is kept by the file and its
 * own place in it instead, which only that file can match. A texture recorded already keeps what it has.
 */
export async function recordPartSources(parser: PartFile, file: string, meshes: readonly THREE.Mesh[], into: PartSources): Promise<void> {
  meshes.forEach((s, index) => into.meshes.set(s, { file, index }));
  for (const s of meshes) {
    for (const mat of Array.isArray(s.material) ? s.material : [s.material]) {
      for (const [slot, v] of Object.entries(mat)) {
        const t = v as THREE.Texture | null;
        if (!t || !t.isTexture || into.textures.has(t)) continue;
        const at = parser.associations.get(t)?.textures;
        // Where the file carries no bytes of its own for it, its place in the file stands in.
        into.textures.set(t, `${file}#${at ?? `${mat.name}:${slot}`}|${textureParams(t)}`);
        const image = at === undefined ? undefined : parser.json.textures?.[at]?.source;
        const view = image === undefined ? undefined : parser.json.images?.[image]?.bufferView;
        if (view === undefined) continue;
        try {
          const bytes = (await parser.getDependency('bufferView', view)) as ArrayBuffer;
          into.textures.set(t, `png|${hashBytes(new Uint8Array(bytes))}|${textureParams(t)}`);
        } catch {
          // Its place in the file stands.
        }
      }
    }
  }
}

/** Where a look's own pieces came from, as the character built to share records it (`Character.lookSources`). */
export interface LookSources {
  /** Everything the look draws. */
  root: THREE.Object3D;
  /** The folder the skeleton came from: a piece fitted to another species' joints is another piece. */
  skeleton: string;
  /** A mesh's part file and its place among that file's meshes; null for one the character did not load. */
  meshSource(mesh: THREE.Mesh): { file: string; index: number } | null;
  /**
   * A part's texture as what its image is (its encoded bytes' hash where the file carries them, else its
   * file and its own place in it) and how it is drawn (`textureParams`); null for one no part file carried.
   */
  textureSource(t: THREE.Texture): string | null;
}

/** The pieces the looks share, one cache for all of them. */
export class LookShare {
  private readonly entries = new Map<string, Entry>();
  private readonly byValue = new Map<Shared, Entry>();
  private readonly pending = new Map<string, Promise<THREE.Texture | null>>();
  private readonly holds = new Set<LookHold>();

  /** A new hold, for a look about to be built from the body in `folder`. */
  hold(folder: string): LookHold {
    const h = new LookHold(this, folder);
    this.holds.add(h);
    return h;
  }

  /** Whether a texture or geometry is one of the shared pieces (and so none of any one look's to count or dispose). */
  owns(o: unknown): boolean {
    return this.byValue.has(o as Shared);
  }

  /** A key a shared piece is kept under, or null for one that is not shared. */
  keyOf(o: unknown): string | null {
    return this.byValue.get(o as Shared)?.keys[0] ?? null;
  }

  /** Whether some look of the body in `folder` is out or being built: a new one of it would then share that body. */
  folderHeld(folder: string): boolean {
    for (const h of this.holds) if (h.folder === folder && (h.referenced || h.building)) return true;
    return false;
  }

  /**
   * Whether a look of the body in `folder` other than `except` is out now: only then does what `except`
   * holds and no look that is out holds (`soleBytes`) say what a look of that body adds beside the others.
   */
  folderOut(folder: string, except: LookHold | null = null): boolean {
    for (const h of this.holds) if (h !== except && h.folder === folder && h.referenced) return true;
    return false;
  }

  /**
   * A render for `key`, held by `hold`: the one already made, the one another look is making now (waited
   * for, not made again), or `make`'s. Null when it came to nothing or the look it was for let go while
   * it waited.
   */
  async claim(hold: LookHold, key: string, kind: ShareKind, make: () => Promise<THREE.Texture | null>): Promise<THREE.Texture | null> {
    const have = this.entries.get(key);
    if (have) {
      if (hold.released) return null;
      this.join(hold, have);
      return have.value as THREE.Texture;
    }
    let p = this.pending.get(key);
    if (!p) {
      const made = make().catch((err) => {
        console.warn(`mobiles: a shared render (${kind}) failed`, err);
        return null;
      });
      p = made;
      this.pending.set(key, made);
      void made.then(() => {
        if (this.pending.get(key) === made) this.pending.delete(key);
      });
    }
    const v = await p;
    if (!v || hold.released) return null;
    // Kept by the first look still wanting it to come back to it, never before: a render every look
    // waiting for let go of meanwhile is simply dropped (it was never drawn), rather than kept for nobody.
    // And kept as its pixels too: a render that came out the same as one already kept (another folder's
    // copy of the same normal map) is that one, and the new copy, never drawn, is dropped.
    let e = this.entries.get(key);
    if (!e) {
      const content = contentKey(v);
      const same = content ? this.entries.get(content) : undefined;
      if (same) {
        this.alias(same, key);
        if (same.value !== v) v.dispose();
        e = same;
      } else e = this.add(content ? [key, content] : [key], kind, v, textureBytes(v));
    }
    this.join(hold, e);
    return e.value as THREE.Texture;
  }

  /**
   * `value` shared under `key` and held by `hold`: the piece already kept under that key when there is
   * one (the caller then wears that instead of its own), else `value` itself, kept from now on.
   */
  share<T extends Shared>(hold: LookHold, key: string, kind: ShareKind, value: T, bytes: number): T {
    if (hold.released) return value;
    const e = this.entries.get(key) ?? this.add([key], kind, value, bytes);
    this.join(hold, e);
    return e.value as T;
  }

  private add(keys: string[], kind: ShareKind, value: Shared, bytes: number): Entry {
    const e: Entry = { keys, kind, value, bytes, holds: new Set(), mark: 0, live: 0, gone: 0 };
    for (const k of keys) this.entries.set(k, e);
    this.byValue.set(value, e);
    return e;
  }

  /** One more key for a piece already kept. */
  private alias(e: Entry, key: string): void {
    e.keys.push(key);
    this.entries.set(key, e);
  }

  private join(hold: LookHold, e: Entry): void {
    e.holds.add(hold);
    hold.entries.add(e);
  }

  /** `hold` lets go of one piece; the last to let go disposes it. The bytes that freed. */
  leave(hold: LookHold, e: Entry): number {
    e.holds.delete(hold);
    hold.entries.delete(e);
    if (e.holds.size > 0) return 0;
    for (const k of e.keys) if (this.entries.get(k) === e) this.entries.delete(k);
    if (this.byValue.get(e.value) === e) this.byValue.delete(e.value);
    e.value.dispose();
    return e.bytes;
  }

  /** A hold has let go of everything. */
  forgetHold(hold: LookHold): void {
    this.holds.delete(hold);
  }

  /** Every shared piece's bytes, each once. */
  bytes(): number {
    let n = 0;
    for (const e of this.byValue.values()) n += e.bytes;
    return n;
  }

  /** The bytes of the pieces some look that is out holds: what a trim cannot free. Each once. */
  referencedBytes(): number {
    let n = 0;
    for (const e of this.byValue.values()) {
      for (const h of e.holds) {
        if (h.referenced) {
          n += e.bytes;
          break;
        }
      }
    }
    return n;
  }

  /** Everything `hold` wears, shared or not: what its look would weigh built alone. */
  holdBytes(hold: LookHold): number {
    let n = 0;
    for (const e of hold.entries) n += e.bytes;
    return n;
  }

  /**
   * The bytes of what `hold` wears that no other look that is out holds: what standing its look again
   * from the cache adds, and what taking its last body down gives back when nobody else goes with it.
   * Never add this up over several looks put down together: a piece only those looks share is in none
   * of their figures, and `FreeTally` is what counts a set.
   */
  soleBytes(hold: LookHold): number {
    let n = 0;
    outer: for (const e of hold.entries) {
      for (const h of e.holds) if (h !== hold && h.referenced) continue outer;
      n += e.bytes;
    }
    return n;
  }

  /** The bytes of what `hold` wears that nothing else holds at all: what its look really added. */
  onlyBytes(hold: LookHold): number {
    let n = 0;
    for (const e of hold.entries) if (e.holds.size === 1) n += e.bytes;
    return n;
  }

  /** The console's view: how many pieces of each kind, their bytes, and how many looks hold any. */
  stats(): { entries: number; bytes: number; referenced: number; kinds: Record<ShareKind, { n: number; bytes: number; worn: number }>; looks: { out: number; kept: number; building: number } } {
    const kinds: Record<ShareKind, { n: number; bytes: number; worn: number }> = {
      texture: { n: 0, bytes: 0, worn: 0 },
      render: { n: 0, bytes: 0, worn: 0 },
      normal: { n: 0, bytes: 0, worn: 0 },
      geometry: { n: 0, bytes: 0, worn: 0 },
    };
    for (const e of this.byValue.values()) {
      const k = kinds[e.kind];
      k.n++;
      k.bytes += e.bytes;
      k.worn += e.holds.size;
    }
    const looks = { out: 0, kept: 0, building: 0 };
    for (const h of this.holds) {
      if (h.building) looks.building++;
      else if (h.referenced) looks.out++;
      else looks.kept++;
    }
    return { entries: this.byValue.size, bytes: this.bytes(), referenced: this.referencedBytes(), kinds, looks };
  }

  /** Everything (the page going away). */
  dispose(): void {
    for (const h of [...this.holds]) h.release();
    for (const e of this.byValue.values()) e.value.dispose();
    this.entries.clear();
    this.byValue.clear();
    this.pending.clear();
  }
}

/**
 * What one look holds of the shared pieces, from the moment it starts being built until it is disposed.
 * It is the look's `RenderShare` while the look is coloured, then `shareLook` swaps the look's own copies
 * for the shared ones and lets go of whatever the finished look does not wear.
 */
export class LookHold {
  readonly store: LookShare;
  /** The body folder the look stands on (`lookFolder`). */
  readonly folder: string;
  /** The pieces held, each once. */
  readonly entries = new Set<Entry>();
  /** The look's asset once built: the look is out while that has references. Null while it is built. */
  owner: { refs: number } | null = null;
  released = false;

  constructor(store: LookShare, folder: string) {
    this.store = store;
    this.folder = folder;
  }

  /** Still being built (nothing owns it yet). */
  get building(): boolean {
    return !this.released && !this.owner;
  }

  /** Out: its look is worn by somebody standing. */
  get referenced(): boolean {
    return !this.released && !!this.owner && this.owner.refs > 0;
  }

  /** As `RenderShare.claim`: the customizer's way in. */
  claim(key: string, kind: 'render' | 'normal', make: () => Promise<THREE.Texture | null>): Promise<THREE.Texture | null> {
    return this.store.claim(this, key, kind, make);
  }

  /** Let go of every piece not in `worn`; the bytes that freed. */
  keep(worn: ReadonlySet<unknown>): number {
    let n = 0;
    for (const e of [...this.entries]) if (!worn.has(e.value)) n += this.store.leave(this, e);
    return n;
  }

  /** Let go of everything (the look disposed, or its build failed); the bytes that freed. */
  release(): number {
    if (this.released) return 0;
    this.released = true;
    let n = 0;
    for (const e of [...this.entries]) n += this.store.leave(this, e);
    this.store.forgetHold(this);
    return n;
  }
}

/**
 * What the asset cache counts of one of its assets (a model, a look or an animation pack): its own bytes,
 * how many bodies hold it, and for a look built to share what it holds of the shared pieces.
 */
export interface Counted {
  bytes: number;
  refs: number;
  hold?: LookHold;
}

/** The set each `FreeTally` counts, numbered across every tally so two never read each other's marks. */
let tallyMark = 0;

/**
 * What putting a set of bodies down together gives back to the budget, counted as the set grows: an
 * asset once every reference on it is in the set, and a shared piece once every look that is out and
 * holds it is an asset the set gives back. Counted together and never body by body added up, because a
 * piece several of the set share (one species' body, one render of the same colours) is in none of their
 * figures alone and goes only with the last of them, and so is a look or a pack two of them wear.
 *
 * `reset` starts a set and each `add` puts one body in it and answers the set's total so far. It keeps
 * its counts in lists it reuses and in the shared pieces themselves, so counting allocates nothing once
 * the lists have grown; one set at a time, since a second `reset` takes the pieces' marks for its own.
 */
export class FreeTally {
  /** What the set so far gives back. */
  total = 0;
  private mark = 0;
  private readonly assets: Counted[] = [];
  private readonly drops: number[] = [];

  /** Start a new, empty set. */
  reset(): void {
    this.mark = ++tallyMark;
    this.total = 0;
    this.assets.length = 0;
    this.drops.length = 0;
  }

  /** One body more in the set, holding one reference on each of these (null for none: a body still loading, or one with no pack). The set's total. */
  add(model: Counted | null, pack: Counted | null): number {
    if (model) this.drop(model);
    if (pack) this.drop(pack);
    return this.total;
  }

  private drop(a: Counted): void {
    if (a.refs <= 0) return;
    let i = this.assets.indexOf(a);
    if (i < 0) {
      i = this.assets.length;
      this.assets.push(a);
      this.drops.push(0);
    }
    // Only when the set holds every reference on it, and only once however many more it counts.
    if (++this.drops[i] !== a.refs) return;
    this.total += a.bytes;
    const hold = a.hold;
    if (!hold || !hold.referenced) return;
    for (const e of hold.entries) {
      if (e.mark !== this.mark) {
        e.mark = this.mark;
        e.gone = 0;
        e.live = 0;
        for (const h of e.holds) if (h.referenced) e.live++;
      }
      if (++e.gone === e.live) this.total += e.bytes;
    }
  }
}

/**
 * Put a finished look on the shared pieces: every mesh onto the geometry already kept for its file, its
 * place in it, its skeleton and the triangles it draws, and every texture its materials wear onto the one
 * kept for where it came from (a render the customizer took from the share is one already). The look's
 * own copies that were swapped out were never drawn and are simply dropped. Then `hold` lets go of
 * anything it took along the way that the finished look does not wear. A mesh or texture with no known
 * source is left as the look's own, and the look's own bytes count it.
 *
 * Must run before the look is prepared: its own copies are then never uploaded, and nothing is compiled
 * for them.
 */
export function shareLook(hold: LookHold, src: LookSources): void {
  const store = hold.store;
  const worn = new Set<unknown>();
  // Each of the look's own objects once, to the shared one it became: two meshes of one file can share a
  // geometry, and two materials of one file a texture.
  const became = new Map<unknown, Shared>();
  src.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    let geo = became.get(g) as THREE.BufferGeometry | undefined;
    if (!geo) {
      const from = src.meshSource(mesh);
      const key = store.keyOf(g) ?? (from ? `g|${src.skeleton}|${from.file}#${from.index}|${indexKey(g)}` : null);
      geo = key ? store.share(hold, key, 'geometry', g, geometryBytes(g)) : g;
      became.set(g, geo);
    }
    if (geo !== g) mesh.geometry = geo;
    worn.add(geo);
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const slots = mat as unknown as Record<string, unknown>;
      for (const k of Object.keys(slots)) {
        const t = slots[k] as THREE.Texture | null;
        if (!t || !t.isTexture) continue;
        let tex = became.get(t) as THREE.Texture | undefined;
        if (!tex) {
          const own = store.keyOf(t);
          const from = own ? null : src.textureSource(t);
          tex = own ? store.share(hold, own, 'render', t, textureBytes(t)) : from ? store.share(hold, `t|${from}`, 'texture', t, textureBytes(t)) : t;
          became.set(t, tex);
        }
        if (tex !== t) slots[k] = tex;
        worn.add(tex);
      }
    }
  });
  hold.keep(worn);
}
