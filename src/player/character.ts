// A character assembled at run time from parts: one skeleton, a body, a head, and whatever is
// worn over them, each converted as its own GLB against the same joints.
//
// The original client works this way and so does the converter's `parts` mode: nothing is merged
// and nothing is culled ahead of time, so a shirt can come off, a body can grow a slider's worth
// of muscle, and the skin underneath is hidden only while something actually covers it.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Customizer } from './customizer';
import { markActor } from '../world/portalRender';
import { HeadSplitView, SHADOW_ONLY_MASK, countSet, cullIndex, headBoneFlags, headRule, headTriangleFlags, partitionHead, splitsMesh, type HeadRule, type HeadStatusRow } from './headHide.ts';

/** A mesh's occlusion data, as the converter carried it out of the mesh generator. */
interface PartDef {
  name: string;
  file: string;
  /** Where `file` is relative to; the parts pack's own folder unless it came from the wardrobe. */
  dir?: string;
  triangles: number;
  occlusionLayer: number;
  occludes?: string[];
  zoneNames?: string[];
  zoneCombinations?: string[][];
  fullyOccludedBy?: string[];
  body?: boolean;
  /** The shape sliders this mesh carries (blend targets), by name. */
  morphs?: string[];
}

/** A customization variable the species' skin, hair or eyes take: a palette of colours, or a choice among N textures. */
export interface CustomVariable {
  name: string;
  private: boolean;
  kind: 'palette' | 'index';
  default: number;
  /** A palette's colours, 0..255 each, in the order the variable indexes them. */
  colors?: number[][];
  palette?: string;
  /** An index variable's number of choices. */
  count?: number;
  /** Which files (shaders, texture renderers) read it. */
  sources: string[];
  /** The meshes it was met on (a private variable belongs to each of these separately). */
  meshes?: string[];
}

/** One playable species and gender, as characters/index.json lists it. */
export interface SpeciesEntry {
  id: string;
  species: string;
  gender: string;
  template: string;
  skeleton: string;
  parts: number;
  morphs: string[];
  variables: CustomVariable[];
  jkaClips: number;
  wardrobe: string | null;
}

const speciesIndex = new Map<string, Promise<SpeciesEntry[]>>();

/** The species index, or an empty list when the pack has none (only the one character converted by hand); fetched once. */
export function loadSpeciesIndex(baseUrl: string): Promise<SpeciesEntry[]> {
  let p = speciesIndex.get(baseUrl);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`${baseUrl}assets-private/characters/index.json`);
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return [];
        return ((await res.json()) as { species: SpeciesEntry[] }).species ?? [];
      } catch {
        return [];
      }
    })();
    speciesIndex.set(baseUrl, p);
  }
  return p;
}

/**
 * A species' rig file is its animations alone, and hundreds of megabytes of them (twelve
 * hundred clips); parsed once per file and shared, since clips are read-only data any number
 * of mixers can play. Without this every fighter spawned parsed the whole file again.
 */
const rigClips = new Map<string, Promise<THREE.AnimationClip[]>>();
/** The same clips once parsed, by rig URL: what a caller that must not wait (a spawn) may borrow. */
const rigClipsParsed = new Map<string, THREE.AnimationClip[]>();
/** The wardrobes' catalogues, one fetch per folder however many characters dress from it. */
const wardrobes = new Map<string, Promise<(Wardrobe & { skeleton?: string }) | null>>();

/** How a character is loaded when it is not a player species as the game ships it. */
export interface CharacterOptions {
  /**
   * The folder parts.json and its meshes live in, under assets-private/ (`mobiles/models/<app>/`,
   * a creature or NPC's own parts); the species folder `characters/<id>/` when left out.
   */
  dir?: string;
  /** Play these clips instead of fetching the manifest's rig (an animation pack's, renamed). */
  clips?: THREE.AnimationClip[] | null;
  /**
   * Do not fetch the rig at all: the skeleton comes from the first part, as it always did, and the
   * clips are `clips` or none. A species rig is two hundred megabytes of Jedi Academy and SWG
   * clips; an NPC that plays its own animation pack must never pay for it.
   */
  skipRig?: boolean;
}

/** Re-point a skinned mesh's joint indices from its own skeleton's order to `target`'s, by joint name; a joint the target lacks goes to its root. */
function remapSkin(s: THREE.SkinnedMesh, target: THREE.Skeleton): void {
  const own = s.skeleton?.bones ?? [];
  if (!own.length) return;
  const index = new Map(target.bones.map((b, i) => [b.name, i]));
  const map = own.map((b) => index.get(b.name) ?? -1);
  if (map.every((v, i) => v === i)) return;
  const missing = own.filter((_, i) => map[i] < 0).map((b) => b.name);
  if (missing.length) console.info(`wearable ${s.name}: ${missing.length} joints this skeleton lacks (${missing.slice(0, 4).join(', ')}) ride its root`);
  const attr = s.geometry.getAttribute('skinIndex');
  if (!attr) return;
  const out = new Uint16Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count * attr.itemSize; i++) {
    const v = map[(attr.array as ArrayLike<number>)[i]] ?? -1;
    out[i] = v < 0 ? 0 : v;
  }
  s.geometry.setAttribute('skinIndex', new THREE.BufferAttribute(out, attr.itemSize));
}

/** The blade's axis in a hand bone's own frame, for each hand. */
export interface GripAxes {
  right?: { bone: string; axis: number[] };
  left?: { bone: string; axis: number[] };
  /** The axes read from the game's own tag geometry, when the importer could, as an alternative to the solved ones. */
  tags?: { right?: { bone: string; axis: number[] }; left?: { bone: string; axis: number[] } };
}

export interface PartsManifest {
  id: string;
  species?: string;
  gender?: string;
  template?: string;
  skeleton: string;
  rig: { file: string; joints: number; clips: number };
  joints: number;
  parts: PartDef[];
  /** What the conversion dressed this character in; worn on load unless told otherwise. */
  defaultWear?: string[];
  /** Animation metadata the GLB cannot hold: which clips hold their last frame, and clip speeds. */
  jkaClips?: Record<string, { loop: boolean }>;
  /** Where the blade points in each hand, solved from Jedi Academy's swings (see the importer). */
  jkaGrip?: GripAxes;
  /** Clips that move only part of the skeleton, with the joints they drive. */
  partialClips?: Record<string, string[]>;
  /** Selector branches by clip: the variable and every value that picks the clip. */
  variants?: Record<string, { variable: string; values: string[] }>;
  clipSpeeds?: Record<string, number>;
  scale?: number;
  customization?: string[];
  /** The customization variables, structured, and the values the pack was baked with. */
  variables?: CustomVariable[];
  values?: Record<string, number>;
}

/** The converted catalogue of everything a species can wear. */
export interface Wardrobe {
  species: string;
  gender: string;
  items: { id: string; kind: string; gender: string; template: string; parts: PartDef[] }[];
}

/** What first person does with one part, worked out once (Character.prepareHead) from its data and its skin. */
interface PartHead {
  rule: HeadRule;
  why: string;
  triangles: number;
  headTriangles: number;
  /** Each mesh's layers outside first person (the actor layer included). */
  masks: number[];
  /** Per mesh, the triangle in `fullIndices` its head starts at; the triangle count when it has none. */
  headFrom: number[];
  /** The split meshes' draw hooks; null for a mesh that is not split. */
  views: (HeadSplitView | null)[];
}

/** One loaded part: its meshes, bound to the shared skeleton, and what it hides. */
interface Part {
  /**
   * What this is called when putting it on or taking it off: a catalogue item's id, or the mesh
   * name for the body and the pieces the character was converted wearing.
   *
   * It cannot be the mesh name for catalogue items. Hundreds of distinct things in the game share
   * one mesh -- ten necklaces are all `necklace_s02_m_l0`, and a belt is reachable as both a belt
   * and a bandolier -- so keying by mesh made them the same object, and asking for one of them
   * gave back whichever had claimed the mesh last.
   */
  key: string;
  defs: PartDef[];
  meshes: THREE.SkinnedMesh[];
  /** Full index buffer per mesh, to rebuild from when what covers it changes. */
  fullIndices: Uint32Array[];
  worn: boolean;
  /** Layer and zones of the outermost def, which is what decides occlusion for the whole item. */
  layer: number;
  occludes: string[];
  body: boolean;
  /** A catalogue item's kind and template (none for the pack's own parts), for what first person does with it. */
  meta: { kind?: string; template?: string };
  /** What first person does with it, once the character has been prepared (prepareHead); null before. */
  head: PartHead | null;
}

export class Character {
  readonly group = new THREE.Group();
  readonly clips: THREE.AnimationClip[];
  private readonly parts = new Map<string, Part>();
  private readonly morphs = new Map<string, THREE.Mesh[]>();
  /** Shared by every part; taken from the first one loaded, which brings its bones with it. */
  private skeleton: THREE.Skeleton | null = null;
  private dir = '';
  private wardrobe: Wardrobe | null = null;
  /** Live colours and choices, when a pack carries the recipes (customize.json): the parts pack's, and the wardrobe's once an item is worn. */
  customizer: Customizer | null = null;
  private pendingCustomizer: Customizer | null = null;

  /** The normal maps' scale for the live recipes' maps, set from the settings before a character loads. */
  static readonly normalScale = new THREE.Vector2(1, -1);

  private constructor(readonly manifest: PartsManifest, clips: THREE.AnimationClip[]) {
    this.clips = clips;
  }

  /**
   * Load a character's rig and its body and head. Worn items come later through `wear`, so a
   * naked character is cheap and dressing is a small download rather than another whole model.
   */
  static async load(baseUrl: string, id = 'human_male', wear?: string[], opts: CharacterOptions = {}): Promise<Character> {
    const dir = opts.dir ? `${baseUrl}assets-private/${opts.dir.replace(/\/?$/, '/')}` : `${baseUrl}assets-private/characters/${id}/`;
    const res = await fetch(`${dir}parts.json`);
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error(`no parts for ${id}`);
    const manifest = (await res.json()) as PartsManifest;
    const loader = new GLTFLoader();
    // The rig file is animations only -- it has no mesh, so nothing in it builds a skeleton. The
    // skeleton comes from the first part instead, where the loader makes a real one out of that
    // file's own inverse bind matrices. Every part carries the same matrices for the same joints
    // in the same order (the converter writes them from one skeleton), so one of them is the one.
    let clipList: THREE.AnimationClip[];
    if (opts.clips) clipList = opts.clips;
    else if (opts.skipRig) clipList = [];
    else {
      const rigUrl = dir + manifest.rig.file;
      let clips = rigClips.get(rigUrl);
      if (!clips) {
        clips = loader.loadAsync(rigUrl).then((rig) => {
          rigClipsParsed.set(rigUrl, rig.animations);
          return rig.animations;
        });
        rigClips.set(rigUrl, clips);
        clips.catch(() => rigClips.delete(rigUrl));
      }
      clipList = await clips;
    }
    const character = new Character(manifest, clipList);
    character.dir = dir;
    const dress = new Set(wear ?? manifest.defaultWear ?? []);
    const wanted = manifest.parts.filter((def) => def.occlusionLayer === 0 || dress.has(def.name));
    if (!wanted.length) throw new Error(`${id}: the parts pack has nothing to show`);
    for (const def of wanted) await character.addPart(def.name, [def], true);
    if (!character.skeleton) throw new Error(`${id}: no part carried a skeleton`);
    character.applyOcclusion();
    const customizer = new Customizer();
    customizer.normalScale.copy(Character.normalScale);
    customizer.materialsFor = (name) => character.materialsNamed(name);
    // The pack's values are the manifest's; ours start there, and the recipes render only when a value moves.
    for (const [k, v] of Object.entries(manifest.values ?? {})) customizer.values.set(k, v);
    if (await customizer.addSource(dir)) character.customizer = customizer;
    else character.pendingCustomizer = customizer;
    return character;
  }

  /**
   * A species rig's clips that have already been parsed, without waiting and without starting a
   * fetch: the one whose URL holds `prefer` (a species id) when there is one, else any. The
   * humanoid species share one skeleton, so any of them drives any other. Null when none is in.
   */
  static parsedRigClips(prefer?: string): THREE.AnimationClip[] | null {
    let any: THREE.AnimationClip[] | null = null;
    for (const [url, clips] of rigClipsParsed) {
      if (prefer && url.includes(`/characters/${prefer}/`)) return clips;
      any ??= clips;
    }
    return any;
  }

  /**
   * The catalogue of a wardrobe folder (a full URL ending in `/`: a species' `wardrobe/<w>/`, or
   * `mobiles/wearables/<folder>/`), fetched once per folder however many characters dress from
   * it; null when the folder has none. Each item's meshes are marked as living beside it.
   */
  static wardrobeAt(dir: string): Promise<(Wardrobe & { skeleton?: string }) | null> {
    let p = wardrobes.get(dir);
    if (!p) {
      p = fetch(`${dir}wardrobe.json`)
        .then(async (res) => {
          if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
          const w = (await res.json()) as Wardrobe & { skeleton?: string };
          // Each item's meshes live beside the catalogue, not in the character's own folder.
          for (const item of w.items ?? []) for (const part of item.parts ?? []) part.dir ??= dir;
          return w;
        })
        .catch(() => null);
      wardrobes.set(dir, p);
    }
    return p;
  }

  /**
   * Put on one item from a named wardrobe folder (a full URL ending in `/`): another species'
   * wardrobe, or the wearables only NPCs wear. Found by its id, else by the part name it is worn
   * under. The folder's colour recipes join the character's first, so a value set for the item
   * after it is on renders it. False when the folder or the item is not there.
   */
  async wearItemFrom(dir: string, id: string, partName?: string): Promise<boolean> {
    const w = await Character.wardrobeAt(dir);
    if (!w) return false;
    const item = w.items.find((i) => i.id === id) ?? (partName ? w.items.find((i) => i.parts.some((p) => p.name === partName)) : undefined);
    if (!item || !item.parts.length) return false;
    const cz = this.customizer ?? this.pendingCustomizer;
    if (cz && (await cz.addSource(dir)) && !this.customizer) this.customizer = cz;
    const key = item.id;
    const existing = this.parts.get(key);
    if (existing) existing.worn = true;
    else await this.addPart(key, item.parts, true, { kind: item.kind, template: item.template });
    this.applyOcclusion();
    return true;
  }

  /** Put on a worn item by part name, loading it the first time. */
  async wear(name: string): Promise<boolean> {
    const existing = this.parts.get(name);
    if (existing) {
      existing.worn = true;
      this.applyOcclusion();
      return true;
    }
    const def = this.manifest.parts.find((p) => p.name === name);
    if (!def) return false;
    await this.addPart(name, [def], true);
    this.applyOcclusion();
    return true;
  }

  /** Take a worn item off. Its meshes stay loaded, so putting it back on costs nothing. */
  remove(key: string): boolean {
    const part = this.parts.get(key);
    // Only the character's own body and head are fixed. Occlusion layer says nothing about
    // whether a thing can come off -- 69 catalogue items sit at layer 0 because they cover
    // nothing, and refusing those made them impossible to take off once worn.
    if (!part || part.body) return false;
    part.worn = false;
    this.applyOcclusion();
    return true;
  }

  /**
   * Load every mesh of one thing -- an item or a base part -- and register it under `key`. `meta` is a
   * catalogue item's kind and template (the pack's own parts have none; hair is known by its key).
   */
  private async addPart(key: string, defs: PartDef[], worn: boolean, meta: { kind?: string; template?: string } = {}): Promise<void> {
    const meshes: THREE.SkinnedMesh[] = [];
    const fullIndices: Uint32Array[] = [];
    const scenes: THREE.Object3D[] = [];
    for (const def of defs) {
      const gltf = await new GLTFLoader().loadAsync((def.dir ?? this.dir) + def.file);
      scenes.push(gltf.scene);
      gltf.scene.traverse((o) => {
        const s = o as THREE.SkinnedMesh;
        if (s.isSkinnedMesh) meshes.push(s);
      });
    }
    const first = !this.skeleton;
    if (first) {
      const owner = meshes.find((m) => m.skeleton);
      if (owner) this.skeleton = owner.skeleton;
    }
    // Where the shape sliders sit now: a piece put on later takes the same shape, or it would
    // fit the body the pack was converted with rather than the one it is worn on.
    const shape = this.morphValues();
    for (const s of meshes) {
      // Later parts drop their own copy of the bones and drive the shared ones. Their bind matrix
      // is their own: it says where the mesh sits relative to the skeleton, which the shared
      // inverse bind matrices (identical across parts) then undo. A piece made for another
      // species' skeleton (a human's shirt on a Rodian) lists its joints in another order, or
      // has some this skeleton lacks: its skin indices are re-pointed by joint name first, a
      // missing joint going to the root, or the renderer meets an undefined bone and stops.
      if (!first && this.skeleton) {
        remapSkin(s, this.skeleton);
        s.bind(this.skeleton, s.bindMatrix);
      }
      s.castShadow = true;
      s.receiveShadow = true;
      s.frustumCulled = false;
      const idx = s.geometry.getIndex();
      fullIndices.push(idx ? Uint32Array.from(idx.array as ArrayLike<number>) : new Uint32Array(0));
      if (s.morphTargetDictionary) {
        for (const [morph, index] of Object.entries(s.morphTargetDictionary)) {
          (this.morphs.get(morph) ?? this.morphs.set(morph, []).get(morph)!).push(s);
          if (morph in shape && s.morphTargetInfluences) s.morphTargetInfluences[index] = shape[morph];
        }
      }
    }
    // The first part brings the bone hierarchy the animations drive, so its whole scene goes in.
    // The rest contribute meshes only; their bones would be a second, unanimated skeleton.
    if (first) for (const sc of scenes) this.group.add(sc);
    else for (const m of meshes) this.group.add(m);
    // Actors draw in every pass, inside a building as well as out: a piece put on after the rig
    // was marked would otherwise be left on the world layer, and vanish indoors (leaving the
    // head and hands, which the body's own mesh carries).
    for (const sc of scenes) markActor(sc);
    for (const m of meshes) markActor(m);
    // The outermost def decides how the whole item occludes.
    const outer = defs.reduce((a, b) => (b.occlusionLayer > a.occlusionLayer ? b : a));
    this.parts.set(key, {
      key,
      defs,
      meshes,
      fullIndices,
      worn,
      layer: outer.occlusionLayer,
      occludes: outer.occludes ?? [],
      body: !!outer.body,
      meta: { kind: meta.kind ?? (/^hair_/.test(key) ? 'hair' : undefined), template: meta.template },
      head: null,
    });
    // Put on after the character was prepared for first person: worked out now (after markActor
    // above, so the masks it saves carry the actor layer).
    if (this.headPrepared) this.prepareHeadOf(this.parts.get(key)!);
    // A part loaded after a colour changed takes the rendered texture too (once it is registered,
    // so its materials are found), and one that reads a chosen colour is rendered in it.
    this.customizer?.reapply();
  }

  /** First person: read by the split meshes' draw hooks, so it is an object they hold, not a field of this. */
  private readonly fp = { hidden: false };
  /** 1 for each bone of the shared skeleton that is the head or below it; set by prepareHead. */
  private headFlags: Uint8Array | null = null;
  private headPrepared = false;

  /**
   * Work out once which triangles are the head (the local player only: Player.attachRig, through the
   * rig). Everything put on afterwards is worked out as it goes on. `head` is the rig's head bone; the
   * skeleton's `Head` when null.
   */
  prepareHead(head: THREE.Bone | null): void {
    if (this.headPrepared || !this.skeleton) return;
    this.headPrepared = true;
    const bone = head ?? this.skeleton.bones.find((b) => /^head$/i.test(b.name)) ?? null;
    this.headFlags = headBoneFlags(this.skeleton.bones, bone);
    for (const part of this.parts.values()) this.prepareHeadOf(part);
    this.applyOcclusion();
  }

  /** What first person does with one part: the rule, and for a split one its index reordered with the head last. */
  private prepareHeadOf(part: Part): void {
    // A worn-unseen item (an empty part) draws nothing, so first person has nothing to hide of it.
    if (part.meshes.length === 0) {
      part.head = { rule: 'none', why: 'no meshes', triangles: 0, headTriangles: 0, masks: [], headFrom: [], views: [] };
      return;
    }
    const inHead = this.headFlags!;
    const perMesh: Uint8Array[] = [];
    let triangles = 0;
    let headTriangles = 0;
    part.meshes.forEach((mesh, i) => {
      const full = part.fullIndices[i];
      const tris = full.length / 3;
      const g = mesh.geometry;
      const si = g.getAttribute('skinIndex');
      const sw = g.getAttribute('skinWeight');
      const flags = tris && si && sw ? headTriangleFlags(full, tris, si, sw, inHead) : new Uint8Array(tris);
      perMesh.push(flags);
      triangles += tris;
      headTriangles += countSet(flags);
    });
    const { rule, why } = headRule({ kind: part.meta.kind, template: part.meta.template, body: part.body, defs: part.defs, triangles, headTriangles });
    const head: PartHead = { rule, why, triangles, headTriangles, masks: part.meshes.map((m) => m.layers.mask), headFrom: [], views: [] };
    part.meshes.forEach((mesh, i) => {
      const full = part.fullIndices[i];
      const flags = perMesh[i];
      if (!splitsMesh(rule, countSet(flags), mesh.geometry.groups.length)) {
        head.headFrom.push(full.length / 3);
        head.views.push(null);
        return;
      }
      const p = partitionHead(full, flags, readZones(mesh));
      part.fullIndices[i] = p.index;
      if (p.zones) mesh.geometry.userData.zones = p.zones;
      mesh.geometry.setIndex(new THREE.BufferAttribute(p.index, 1));
      head.headFrom.push(p.headFrom);
      head.views.push(new HeadSplitView(mesh, this.fp));
    });
    part.head = head;
  }

  /** The whole-hidden parts' layers for the view out of the eyes or not; nothing else changes on a toggle. */
  private applyHeadLayers(): void {
    for (const part of this.parts.values()) {
      const h = part.head;
      if (h?.rule !== 'whole') continue;
      part.meshes.forEach((m, i) => (m.layers.mask = this.fp.hidden ? SHADOW_ONLY_MASK : h.masks[i]));
    }
  }

  /** What first person does with each worn part, for `__debug.fpHead()`. */
  headStatus(): HeadStatusRow[] {
    return [...this.parts.values()]
      .filter((p) => p.worn)
      .map((p) => ({
        name: p.key,
        rule: p.head?.rule ?? 'none',
        why: p.head ? p.head.why : 'not prepared',
        triangles: p.head?.triangles ?? 0,
        headTriangles: p.head?.headTriangles ?? 0,
        // A split part hides something only where a mesh of it was split.
        hiddenNow: this.fp.hidden && !!p.head && (p.head.rule === 'whole' || p.head.views.some((v) => v !== null)),
      }));
  }

  /**
   * Out of the eyes: the head, the hair and anything worn on the head draw into the shadows only
   * (headHide.ts). A toggle writes a few layer masks and nothing else: no re-cull, no allocation.
   */
  setHeadHidden(hidden: boolean): void {
    if (this.fp.hidden === hidden) return;
    this.fp.hidden = hidden;
    if (hidden && !this.headPrepared) this.prepareHead(null);
    this.applyHeadLayers();
  }

  /**
   * Hide the skin under whatever is worn. Zones are named across meshes, so a shirt saying it
   * hides "chest" removes exactly the body triangles the mesh marked as chest -- the original
   * client's own scheme, applied per frame's worth of dressing rather than at conversion time.
   */
  private applyOcclusion(): void {
    this.customizer?.invalidate();
    // What is on is visible to start with; culling below may then hide a whole mesh. Visibility is
    // the wardrobe's alone: first person uses layers, so the shadow keeps the head.
    for (const part of this.parts.values()) for (const m of part.meshes) m.visible = part.worn;
    // Outermost layers hide the zones of everything under them, and a layer's hiding only takes
    // effect below it -- two garments on the same layer do not cut holes in each other.
    const byLayer = [...this.parts.values()].filter((p) => p.worn).sort((a, b) => b.layer - a.layer);
    const hidden = new Set<string>();
    const pending = new Set<string>();
    let layer = Number.POSITIVE_INFINITY;
    for (const part of byLayer) {
      if (part.layer < layer) {
        for (const z of pending) hidden.add(z);
        pending.clear();
        layer = part.layer;
      }
      this.cull(part, hidden);
      for (const z of part.occludes) pending.add(z);
    }
    // Last, over every part: what first person keeps on the shadow layer at the moment.
    this.applyHeadLayers();
  }

  /** Drop the triangles of `part` whose zone combination is entirely covered. */
  private cull(part: Part, hidden: Set<string>): void {
    // Each def owns its own zones; a mesh is culled against the def it came from.
    const defFor = (i: number) => part.defs[Math.min(i, part.defs.length - 1)];
    part.meshes.forEach((mesh, i) => {
      const def = defFor(i);
      const combos = def.zoneCombinations ?? [];
      const covered = combos.map((zones) => zones.length > 0 && zones.every((z) => hidden.has(z)));
      const whole = (def.fullyOccludedBy ?? []).length > 0 && def.fullyOccludedBy!.every((z) => hidden.has(z));
      const full = part.fullIndices[i];
      // A mesh first person splits: its head triangles are last in `full`, from `headFrom` on.
      const view = part.head?.views[i] ?? null;
      const headFrom = part.head?.headFrom[i] ?? full.length / 3;
      if (whole) {
        mesh.visible = false;
        return;
      }
      const zones = (mesh.geometry.userData.zones ?? (mesh.geometry.userData.zones = readZones(mesh))) as number[] | null;
      if (!zones || !covered.some(Boolean)) {
        // A split mesh's partitioned index has the loader's count in another order, so only identity
        // says it is in place. Every other mesh keeps the count test: `fullIndices` is always a copy,
        // and an identity test would swap every loader index for the copy on first use.
        const idx = mesh.geometry.getIndex();
        if (view ? idx?.array !== full : idx?.count !== full.length) mesh.geometry.setIndex(new THREE.BufferAttribute(full, 1));
        if (view) view.count = headFrom * 3;
        return;
      }
      // cullIndex keeps the order, so the head triangles still kept are still last.
      const c = cullIndex(full, zones, covered, headFrom);
      mesh.geometry.setIndex(new THREE.BufferAttribute(c.index, 1));
      if (view) view.count = c.body * 3;
    });
  }

  /**
   * The converted catalogue for this species: every wearable and hairstyle, with what each hides.
   * Loaded once and kept, because it is a large file and the whole list is what a wardrobe is for.
   */
  async catalogue(baseUrl: string): Promise<Wardrobe> {
    if (this.wardrobe) return this.wardrobe;
    // The species' own wardrobe, else the human one of the same gender: the humanoid species
    // share a skeleton, and every wearable is weighted to it, so the same meshes fit them all.
    const gender = this.manifest.gender ?? (/female/.test(this.manifest.id) ? 'female' : 'male');
    let dir = '';
    let w: Wardrobe | null = null;
    // The species index says which wardrobe folder each species dresses from (its own, or the
    // human one of its gender), so no folder that is not there is asked for; without an index
    // the folders are tried in that order.
    const listed = (await loadSpeciesIndex(baseUrl)).find((s) => s.id === this.manifest.id)?.wardrobe;
    for (const cand of listed ? [listed] : [this.manifest.id, `human_${gender}`]) {
      const d = `${baseUrl}assets-private/wardrobe/${cand}/`;
      const found = await Character.wardrobeAt(d);
      if (!found) continue;
      if (cand !== this.manifest.id && found.skeleton && found.skeleton.toLowerCase() !== this.manifest.skeleton.toLowerCase()) continue;
      dir = d;
      w = found;
      break;
    }
    if (!w) throw new Error(`no wardrobe for ${this.manifest.id}`);
    // The wardrobe's own colour recipes join the character's.
    const cz = this.customizer ?? this.pendingCustomizer;
    if (cz && (await cz.addSource(dir)) && !this.customizer) this.customizer = cz;
    // Each item's meshes live beside the catalogue, not in the character's own folder.
    for (const item of w.items) for (const part of item.parts) part.dir = dir;
    this.wardrobe = w;
    return w;
  }

  /** Put on a catalogue item by its template id, loading its meshes the first time. */
  async wearItem(id: string, baseUrl: string): Promise<boolean> {
    const w = await this.catalogue(baseUrl);
    const item = w.items.find((i) => i.id === id);
    if (!item || !item.parts.length) return false;
    const existing = this.parts.get(id);
    // One entry per catalogue item, holding every mesh it contributes. Two items that happen to
    // share a mesh stay two items, each with its own copy, and neither can be mistaken for the other.
    if (existing) existing.worn = true;
    else await this.addPart(id, item.parts, true, { kind: item.kind, template: item.template });
    this.applyOcclusion();
    return true;
  }

  /** The meshes on show: the body's and every worn piece's, so colours are offered only for what is worn. */
  wornMeshes(): Set<string> {
    const out = new Set<string>();
    for (const p of this.parts.values()) {
      if (!p.worn) continue;
      for (const m of p.meshes) {
        out.add(m.name);
        // A mesh with several materials loads as several meshes, the second onwards suffixed
        // (body_m_l0, body_m_l0_1): the recipes name the converter's mesh, without the suffix.
        out.add(m.name.replace(/_\d+$/, ''));
      }
    }
    return out;
  }

  /** The hairstyles this species may wear, from the wardrobe: a species' hair suits both its genders. */
  async hairOptions(baseUrl: string): Promise<{ id: string; label: string }[]> {
    let w: Wardrobe;
    try {
      w = await this.catalogue(baseUrl);
    } catch {
      return [];
    }
    const species = (this.manifest.species ?? this.manifest.id.replace(/_(male|female)$/, '')).toLowerCase();
    return w.items
      .filter((i) => i.kind === 'hair' && (i.template.toLowerCase().includes(`/hair/${species}/`) || i.id.toLowerCase().includes(`hair_${species}_`)))
      .map((i) => ({ id: i.id, label: i.id.replace(/^hair_[a-z]+_(male|female)_?/, '').replace(/_/g, ' ') || i.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /** The hair worn now, by catalogue id, or null. */
  hairWorn(): string | null {
    for (const p of this.parts.values()) if (p.worn && !p.body && /^hair_/.test(p.key)) return p.key;
    return null;
  }

  /** Put a hairstyle on (taking any other off), or none. */
  async wearHair(id: string | null, baseUrl: string): Promise<boolean> {
    for (const p of [...this.parts.values()]) if (p.worn && !p.body && /^hair_/.test(p.key) && p.key !== id) this.remove(p.key);
    if (!id) {
      this.applyOcclusion();
      return true;
    }
    return (await this.wear(id)) || this.wearItem(id, baseUrl);
  }

  /** Every material of the given name across the parts (the recipes name materials by the converter's shader key). */
  materialsNamed(name: string): THREE.Material[] {
    const out: THREE.Material[] = [];
    for (const part of this.parts.values()) {
      for (const m of part.meshes) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) if (mat.name === name && !out.includes(mat)) out.push(mat);
      }
    }
    return out;
  }

  /** Whether a customization variable can change live (the pack carries a recipe that reads it). */
  canCustomize(name: string): boolean {
    return !!this.customizer?.affects(name);
  }

  /** Set a colour or choice live: the skin, hair or eye textures that read it are rendered again. Returns how many. */
  setVariable(name: string, value: number): number {
    if (!this.customizer) {
      this.plainValues.set(name, value);
      return 0;
    }
    return this.customizer.set(name, value);
  }

  /** The customization values in force (the pack's, with whatever has been changed). */
  variableValues(): Record<string, number> {
    return Object.fromEntries([...this.plainValues, ...(this.customizer?.values ?? [])]);
  }

  private readonly plainValues = new Map<string, number>();
  private baseScale: number | null = null;
  /** The height slider's setting, 0 to 1; the whole character is scaled by it. */
  height = 0.5;

  /** Scale the character for a height setting from 0 (shortest) to 1 (tallest) within its species' range, over the size the rig gave it. */
  setHeight(t: number): void {
    this.height = Math.min(1, Math.max(0, t));
    if (this.baseScale === null) this.baseScale = this.group.scale.x || 1;
    const [lo, hi] = heightRange(this.manifest.species ?? this.manifest.id);
    this.group.scale.setScalar(this.baseScale * (lo + (hi - lo) * this.height));
  }

  /** Every shape slider, and where each sits. */
  morphValues(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, meshes] of this.morphs) {
      const m = meshes[0];
      out[name] = m.morphTargetInfluences![m.morphTargetDictionary![name]];
    }
    return out;
  }

  /** Move one slider, on every mesh that carries it: the body's waist and the shirt over it. */
  setMorph(name: string, value: number): boolean {
    const meshes = this.morphs.get(name);
    if (!meshes) return false;
    const v = Math.min(Math.max(value, 0), 1);
    for (const m of meshes) m.morphTargetInfluences![m.morphTargetDictionary![name]] = v;
    return true;
  }

  /** What is on, what is off, and what each part costs. */
  status(): { name: string; meshNames: string[]; worn: boolean; body: boolean; layer: number; triangles: number; drawn: number; fp: HeadRule | null }[] {
    return [...this.parts.values()].map((p) => ({
      name: p.key,
      meshNames: p.meshes.map((m) => m.name),
      worn: p.worn,
      body: p.body,
      layer: p.layer,
      triangles: p.defs.reduce((a, d) => a + (d.triangles ?? 0), 0),
      drawn: p.meshes.reduce((a, m) => a + (m.visible ? (m.geometry.getIndex()?.count ?? 0) / 3 : 0), 0),
      fp: p.head?.rule ?? null,
    }));
  }
}

/**
 * How far a species' height slider reaches, as a scale over its model: the game's creation ranges,
 * near enough (a Wookiee's model already stands tall, so its band is narrow and above one; a
 * Sullustan's or Bothan's is short and below).
 */
const HEIGHT_RANGES: Record<string, [number, number]> = {
  human: [0.88, 1.1],
  twilek: [0.88, 1.1],
  zabrak: [0.88, 1.1],
  wookiee: [0.96, 1.12],
  trandoshan: [0.94, 1.12],
  rodian: [0.86, 1.04],
  moncal: [0.9, 1.08],
  mon_calamari: [0.9, 1.08],
  bothan: [0.84, 1.0],
  sullustan: [0.8, 0.96],
  ithorian: [0.96, 1.12],
};

export function heightRange(species: string): [number, number] {
  const key = species.toLowerCase().replace(/_(male|female)$/, '');
  return HEIGHT_RANGES[key] ?? [0.88, 1.1];
}

/** The per-triangle zone combination the converter left on the primitive. */
function readZones(mesh: THREE.SkinnedMesh): number[] | null {
  const z = (mesh.geometry.userData as { zones?: number[] }).zones ?? (mesh.userData as { zones?: number[] }).zones;
  return Array.isArray(z) ? z : null;
}
