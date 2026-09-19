// First person on foot: what of the player is "on the head" (the head, hair, hats, helmets, goggles,
// a hood), worked out once per worn thing from the client's own data, and how it is kept out of the
// eye's view while it still draws into the shadow maps.
//
// Pure: imports only three and the effects registry, so the node test loads it as it is.
//
// Hiding by `visible` would take the head out of the shadow too (three skips an invisible object
// before the shadow pass looks at it). Instead a whole thing goes onto a layer that only the shadow
// pass's camera sees, and a garment that is only partly on the head (a hooded robe) has its head
// triangles moved to the end of its index, so the eye's passes can draw everything ahead of them
// while the shadow pass draws it all.

import * as THREE from 'three';
import { FX_LAYERS } from '../core/fxRegistry.ts';

/** The zones of the head, as the meshes' occlusion data names them. */
export const HEAD_ZONES: ReadonlySet<string> = new Set(['skull', 'face', 'sideburn_l', 'sideburn_r', 'neck']);
/** Object templates the client files as worn on the head (its own taxonomy, not mesh names). */
export const HEAD_WEAR_TEMPLATE = /^object\/tangible\/(hair\/|wearables\/(hat|helmet|goggles)\/)/;
/** A vertex weighted at least this much to the head joint and below is on the head; a triangle with one such vertex is. */
export const HEAD_WEIGHT = 0.5;
/** An item with at least this share of its triangles on the head goes whole. */
export const HEAD_WHOLE_SHARE = 0.5;
/** Drawn into the shadow maps only: the shadow pass's camera sees every layer, no view pass sees this one. */
export const SHADOW_ONLY_MASK = 1 << FX_LAYERS.shadowOnly;

export type HeadRule = 'whole' | 'split' | 'none';

/** What the rule is decided from, for one worn thing (every mesh of it together). */
export interface HeadFacts {
  /** 'hair' for hair. */
  kind?: string;
  /** The item's object template. */
  template?: string;
  /** One of the species' own parts. */
  body: boolean;
  defs: { occludes?: string[]; zoneCombinations?: string[][] }[];
  triangles: number;
  headTriangles: number;
}

/**
 * Whole, split (only its head triangles) or none, and why. In this order: hair and the head-wear
 * template folders go whole; an item whose triangles all lie in head zones goes whole; a garment (it
 * hides a zone that is not the head) only ever loses its head triangles; an item that hides only head
 * zones goes whole; otherwise the skin decides. A species' own parts skip the `occludes` steps.
 */
export function headRule(f: HeadFacts): { rule: HeadRule; why: string } {
  if (f.kind === 'hair') return { rule: 'whole', why: 'hair' };
  if (f.template && HEAD_WEAR_TEMPLATE.test(f.template)) return { rule: 'whole', why: 'template' };
  const combos = f.defs.flatMap((d) => d.zoneCombinations ?? []);
  if (combos.length > 0 && combos.every((c) => c.length > 0 && c.every((z) => HEAD_ZONES.has(z)))) return { rule: 'whole', why: 'zones' };
  if (!f.body) {
    const occ = f.defs.flatMap((d) => d.occludes ?? []);
    if (occ.some((z) => !HEAD_ZONES.has(z))) return { rule: f.headTriangles > 0 ? 'split' : 'none', why: 'garment' };
    if (occ.length > 0) return { rule: 'whole', why: 'covers' };
  }
  if (f.triangles > 0 && f.headTriangles / f.triangles >= HEAD_WHOLE_SHARE) return { rule: 'whole', why: 'skin' };
  return { rule: f.headTriangles > 0 ? 'split' : 'none', why: 'skin' };
}

/** 1 for each bone that is `head` or below it, in the skeleton's order. */
export function headBoneFlags(bones: readonly THREE.Object3D[], head: THREE.Object3D | null): Uint8Array {
  const out = new Uint8Array(bones.length);
  if (!head) return out;
  bones.forEach((b, i) => {
    for (let p: THREE.Object3D | null = b; p; p = p.parent) {
      if (p === head) {
        out[i] = 1;
        break;
      }
    }
  });
  return out;
}

type SkinAttr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/** 1 for each triangle with a vertex weighted at least `threshold` to the head bones (`index` null: consecutive triples). */
export function headTriangleFlags(index: ArrayLike<number> | null, triangles: number, skinIndex: SkinAttr, skinWeight: SkinAttr, inHead: Uint8Array, threshold = HEAD_WEIGHT): Uint8Array {
  const n = skinIndex.count;
  const size = skinIndex.itemSize;
  const onHead = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    let w = 0;
    // getComponent denormalises, so a normalized Uint8 weight of 128 reads as 0.502.
    for (let k = 0; k < size; k++) if (inHead[skinIndex.getComponent(v, k)]) w += skinWeight.getComponent(v, k);
    onHead[v] = w >= threshold ? 1 : 0;
  }
  const out = new Uint8Array(triangles);
  for (let t = 0; t < triangles; t++) {
    const a = index ? index[3 * t] : 3 * t;
    const b = index ? index[3 * t + 1] : 3 * t + 1;
    const c = index ? index[3 * t + 2] : 3 * t + 2;
    out[t] = onHead[a] | onHead[b] | onHead[c];
  }
  return out;
}

export function countSet(flags: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < flags.length; i++) n += flags[i];
  return n;
}

/**
 * The index with the head's triangles moved to the end (each side keeps its order), the per-triangle
 * zones moved with them, and the triangle the head starts at. Drawing only the first `headFrom * 3`
 * indices draws everything but the head.
 */
export function partitionHead(index: ArrayLike<number>, flags: Uint8Array, zones: readonly number[] | null): { index: Uint32Array; zones: number[] | null; headFrom: number } {
  const tris = flags.length;
  const head = countSet(flags);
  const out = new Uint32Array(tris * 3);
  const z = zones ? new Array<number>(tris) : null;
  let body = 0;
  let tail = tris - head;
  for (let t = 0; t < tris; t++) {
    const to = flags[t] ? tail++ : body++;
    out[3 * to] = index[3 * t];
    out[3 * to + 1] = index[3 * t + 1];
    out[3 * to + 2] = index[3 * t + 2];
    if (z) z[to] = zones![t];
  }
  return { index: out, zones: z, headFrom: tris - head };
}

/**
 * Whether one mesh of an item is split: the item's rule is split, the mesh has head triangles of its
 * own, and it has no groups (three intersects each group's range with the draw range, so a mesh with
 * groups cannot be drawn short of its head).
 */
export function splitsMesh(rule: HeadRule, meshHeadTriangles: number, groups: number): boolean {
  return rule === 'split' && meshHeadTriangles > 0 && groups === 0;
}

/**
 * The index with the covered triangles dropped (`zones[t]` is triangle t's zone combination, and
 * `covered[c]` whether combination c is hidden), each kept one in its order, and how many kept
 * triangles lie before `headFrom`. On a split mesh the head's kept triangles are therefore still
 * last, and the eye draws the first `body * 3` indices.
 */
export function cullIndex(full: ArrayLike<number>, zones: readonly number[], covered: readonly boolean[], headFrom: number): { index: Uint32Array; body: number } {
  const tris = Math.floor(full.length / 3);
  let kept = 0;
  for (let t = 0; t < tris; t++) {
    const c = zones[t];
    if (!(c !== undefined && c >= 0 && covered[c])) kept++;
  }
  const index = new Uint32Array(kept * 3);
  let at = 0;
  let body = 0;
  for (let t = 0; t < tris; t++) {
    const c = zones[t];
    if (c !== undefined && c >= 0 && covered[c]) continue;
    index[at++] = full[t * 3];
    index[at++] = full[t * 3 + 1];
    index[at++] = full[t * 3 + 2];
    if (t < headFrom) body++;
  }
  return { index, body };
}

/**
 * First person's cut on one mesh whose head is only part of it (a hooded robe): the eye's passes draw
 * the indices ahead of the head's, the shadow pass (which calls onBeforeShadow, never onBeforeRender)
 * draws them all. The count lives on the geometry only for the length of one draw, so a clone sharing
 * the geometry (the wardrobe doll) and every raycast see the whole mesh.
 */
export class HeadSplitView {
  /** Indices the eye draws; kept by whoever culls the mesh (Character.cull). */
  count = Infinity;

  constructor(mesh: THREE.Mesh, state: { readonly hidden: boolean }) {
    mesh.onBeforeRender = (_r, _s, _c, geometry) => {
      if (state.hidden) geometry.drawRange.count = this.count;
    };
    mesh.onAfterRender = (_r, _s, _c, geometry) => {
      geometry.drawRange.count = Infinity;
    };
  }
}

/** One row of `__debug.fpHead()`: what first person does with a worn thing, and why. */
export interface HeadStatusRow {
  name: string;
  rule: HeadRule;
  why: string;
  triangles: number;
  headTriangles: number;
  hiddenNow: boolean;
}

/** The same for a model that is not assembled from parts (the player's single converted model, the placeholder rig). */
export class HeadHider {
  private readonly state = { hidden: false };
  private readonly whole: { mesh: THREE.Object3D; mask: number }[] = [];
  readonly rows: HeadStatusRow[] = [];

  /**
   * Each skinned mesh by the skin rule (body: true, no zones); a plain mesh hung under the head bone
   * goes whole; with no head bone every skinned mesh goes whole (body and all to the shadow only,
   * which still beats losing the shadow).
   */
  static forModel(root: THREE.Object3D, head: THREE.Object3D | null): HeadHider {
    const h = new HeadHider();
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      if (!m.isSkinnedMesh) {
        let under = false;
        for (let p = m.parent; p && !under; p = p.parent) under = p === head;
        if (under) h.addWhole(m, 'under the head bone', 0, 0);
        return;
      }
      const g = m.geometry;
      const si = g.getAttribute('skinIndex');
      const sw = g.getAttribute('skinWeight');
      if (!head || !si || !sw || !m.skeleton) {
        h.addWhole(m, 'no head bone', 0, 0);
        return;
      }
      const idx = g.getIndex();
      const tris = Math.floor(idx ? idx.count / 3 : g.getAttribute('position').count / 3);
      const flags = headTriangleFlags(idx ? (idx.array as ArrayLike<number>) : null, tris, si, sw, headBoneFlags(m.skeleton.bones, head));
      const headTris = countSet(flags);
      const { rule, why } = headRule({ body: true, defs: [], triangles: tris, headTriangles: headTris });
      // A mesh that cannot be split (it has groups) and would be goes whole here: one model has no
      // body part to keep apart from the head, so the shadow is what is kept.
      if (rule === 'whole' || (rule === 'split' && !splitsMesh(rule, headTris, g.groups.length))) h.addWhole(m, why, tris, headTris);
      else if (rule === 'split') {
        const full = idx ? (idx.array as ArrayLike<number>) : Uint32Array.from({ length: tris * 3 }, (_, i) => i);
        const p = partitionHead(full, flags, null);
        g.setIndex(new THREE.BufferAttribute(p.index, 1));
        new HeadSplitView(m, h.state).count = p.headFrom * 3;
        h.rows.push({ name: m.name, rule, why, triangles: tris, headTriangles: headTris, hiddenNow: false });
      }
    });
    return h;
  }

  private addWhole(mesh: THREE.Object3D, why: string, triangles: number, headTriangles: number): void {
    this.whole.push({ mesh, mask: mesh.layers.mask });
    this.rows.push({ name: mesh.name, rule: 'whole', why, triangles, headTriangles, hiddenNow: false });
  }

  /** Out of the eyes or not: the whole meshes' layers, and the split meshes' draw hooks read the state. */
  set(hidden: boolean): void {
    if (this.state.hidden === hidden) return;
    this.state.hidden = hidden;
    for (const w of this.whole) w.mesh.layers.mask = hidden ? SHADOW_ONLY_MASK : w.mask;
    for (const r of this.rows) r.hiddenNow = hidden;
  }
}
