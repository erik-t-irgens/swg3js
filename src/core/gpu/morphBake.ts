// The morph bake (the GPU port's pass 1, wave 4, item 1): in play on WebGPU, each look's shape sliders are worked into one
// copy of its positions and normals when it settles, shared by its clones, so the drawn mesh carries no morph targets.
//
// Why: three keys a WebGPU program on each morph attribute's id (`RenderObject.getGeometryCacheKey`) and writes the morph
// texture's width into its text, and every body in a crowd stands on a geometry of its own, so a morph attribute alone
// separated 380 of the 651 pipelines of Tatooine's arrival (`A:\swg3js\port\PASS1-census.md`). No clip the game plays keys
// a morph weight (the census's section 4): a look's weights are set by its look and stand still, so they can be worked out
// once. The bake is about a twelfth of the morph textures it spares (24 bytes a vertex, one copy a look).
//
// How:
//  - **A bake** is a geometry of its own (`baked`) holding the positions and normals as three's own morphing would make
//    them for the mesh's influences, and sharing every other attribute, the index, the groups, the draw range and the
//    `userData` of its source by reference; it has no morph attributes. The arithmetic is three's own CPU morph
//    (`Mesh.getVertexPosition`): each target's share summed in doubles, in the targets' order, a target at nought skipped,
//    then the base added, so a baked value is three's to the float. Normals the same way over the normal targets (three
//    morphs them on the card alone, by the same sum).
//  - **Who is baked**: every mesh with morph targets the world adopts in play (`World.adoptMaterials`, which every actor's
//    preparation, the arrival's sweep and the scan pass through), before anything compiles it: a look's prototype, the
//    player, a peer, a fighter's rig, a worn piece. A clone made from a baked prototype (`cloneShared`) shares the bake by
//    sharing the geometry, so a crowd of one look holds one copy. Nothing is baked out of play (`play`): the creator's
//    figure, the select screen and the previews keep live morphs.
//  - **A slider moved in play** is caught by `frame` (once a frame, before the passes): every mesh baked directly is held
//    weakly, and one whose influences no longer match its bake is baked again in place, that frame, its arrays written
//    and marked for upload (nothing allocated, no pipeline: the layout is the same).
//  - **The previews** (the doll, the creator's dark stage, the select screen, the appearance page) draw a clone of the
//    character on a WebGL context of their own: `unbake` hands the clone the source geometry, its index, groups and range
//    brought up to the drawn ones first, so the preview morphs live as it always did.
//  - **The switch** `GPU_KEYS.morphBake`, read at load and moved live by `setMorphBake` (the console's `{ bake }`): off, every
//    baked mesh is handed its source back (the clones in the scene with it); on, each is baked again.
//
// Never on WebGL (reached only through `start.ts`). Imports nothing of three's WebGPU build, so node runs it as it stands.

import * as THREE from 'three';
import { GPU_KEYS } from './gpuKeys.ts';

type Influences = ArrayLike<number>;

/** One look's baked copy of a source geometry. */
export interface Bake {
  /** The geometry with morph targets, kept for the previews and the switch. */
  readonly source: THREE.BufferGeometry;
  /** What is drawn: positions and normals baked, everything else the source's by reference, no morph attributes. */
  readonly baked: THREE.BufferGeometry;
  /** The influences the arrays hold now. */
  readonly weights: Float64Array;
  /** The baked attributes (null where the source has no targets of that kind and the source's own is shared). */
  readonly position: THREE.BufferAttribute | null;
  readonly normal: THREE.BufferAttribute | null;
  /** Bytes the baked arrays hold. */
  readonly bytes: number;
  /** Bytes the bake puts on the card whole: its baked arrays and its own buffers of the source's other attributes and index. */
  readonly cardBytes: number;
  /** The baked geometry was disposed (its look let go). */
  gone: boolean;
}

/** What the bake has done this session, for `__debug.gpu()`. */
export const MORPH_BAKE_STATS = {
  /** Bakes made, and of them still held (their geometry not disposed). */
  made: 0,
  live: 0,
  /** Bytes the live bakes hold. */
  bytes: 0,
  /** What the live bakes put on the card whole (their own buffers of the source's other attributes and index too). */
  cardBytes: 0,
  /** Vertices baked at the making, all told. */
  vertices: 0,
  /** Bakes worked again in place because their mesh's influences moved (a slider in play). */
  rebakes: 0,
  /** Meshes handed their source back for a preview's clone. */
  unbakedForPreviews: 0,
  /** Meshes handed their source back by leaving play or the switch, and baked again by coming back. */
  unbaked: 0,
  rebaked: 0,
  /** Meshes with targets left live, by why. */
  refused: {} as Record<string, number>,
  /** The longest single bake's making, in milliseconds (the main thread: a look's preparation pays it once). */
  longestMs: 0,
  /** The last frame's re-bakes' milliseconds, and the frame they happened on (0 for none yet). */
  lastRebakeMs: 0,
};

/** The bake's state: on (the switch) and in play (the game's word). */
const STATE = { inPlay: false };

/** A baked geometry's bake. */
const bakeOf = new WeakMap<THREE.BufferGeometry, Bake>();
/** Each source's bakes (a source shared by several looks of different weights has one a look). */
const bakesOf = new WeakMap<THREE.BufferGeometry, Bake[]>();
/** Sources that cannot be baked (left live), so the scan asks once. */
const refusedGeometry = new WeakSet<THREE.BufferGeometry>();
/** Meshes that cannot be baked for something of their own (their influences shorter than the targets). */
const refusedMesh = new WeakSet<THREE.Object3D>();

/**
 * A mesh baked directly (not a clone sharing a prototype's bake) and standing in a scene: read once a frame for a slider
 * moved. Held strongly only while it stands in a scene: the frame lets go of one it finds out of every scene (a look's
 * prototype, never drawn, on its first frame; a character put away), and the world's adoption takes it up again if it is
 * hung back (`adoptMorphs`). Never a `WeakRef`: reading one adds its target to the engine's kept objects, which allocates.
 */
interface Hot {
  mesh: THREE.Mesh;
  bake: Bake;
}
const hot: Hot[] = [];
const hotSet = new WeakSet<THREE.Mesh>();
/** A mesh's own bake, kept while it is handed its source (out of play, the switch off), so coming back finds it. */
const ownBake = new WeakMap<THREE.Object3D, Bake>();

/** Doubles for the sums (three's CPU morph sums in doubles before it adds the base): grown, never shrunk. */
let sums = new Float64Array(0);

/** Why a mesh's geometry and influences cannot be baked, or '' when they can. */
export function refuseWhy(g: THREE.BufferGeometry, inf: Influences | undefined): string {
  const ma = g.morphAttributes;
  const mp = ma.position;
  const mn = ma.normal;
  const count = (mp ?? mn)?.length ?? 0;
  if (!count) return 'no targets';
  if (!inf || inf.length < count) return 'fewer influences than targets';
  // Three morphs a vertex colour only where the material asks for vertex colours: left to it, whatever the material.
  if (ma.color && ma.color.length) return 'colour targets';
  if (mp && mn && mn.length !== mp.length) return 'normal targets of another count';
  const pos = g.attributes.position as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  if (!pos || pos.itemSize !== 3) return 'no three-number positions';
  // The drawn layout must be the source's: a baked attribute is a plain float array, so the source's must be too.
  if (mp && ((pos as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute || !(pos.array instanceof Float32Array) || pos.normalized)) return 'positions not plain floats';
  const nor = g.attributes.normal as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  if (mn && nor && ((nor as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute || !(nor.array instanceof Float32Array) || nor.normalized || nor.itemSize !== 3)) return 'normals not plain floats';
  // The bake's other attributes are its own over the source's arrays (`own`): an interleaved one would share its buffer.
  for (const name of Object.keys(g.attributes)) if ((g.attributes[name] as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return 'an interleaved attribute';
  return '';
}

/** One component of an attribute, as three's `fromBufferAttribute` reads it (plain arrays read straight). */
function plain(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): ArrayLike<number> | null {
  if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute || a.normalized || a.itemSize !== 3) return null;
  return (a as THREE.BufferAttribute).array as ArrayLike<number>;
}

/**
 * Three's CPU morph of one attribute over every vertex (`Mesh.getVertexPosition`): for each vertex the targets' shares
 * summed in doubles from nought, in order, a target at an influence of nought skipped, a relative target added as it stands
 * and an absolute one as its difference from the base, then the base added; written into `out` as floats. Nothing allocated
 * once `sums` is long enough.
 */
export function morphInto(base: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, targets: readonly (THREE.BufferAttribute | THREE.InterleavedBufferAttribute)[], relative: boolean, inf: Influences, out: Float32Array): void {
  const n = base.count;
  const len = n * 3;
  if (sums.length < len) sums = new Float64Array(len);
  const s = sums;
  for (let k = 0; k < len; k++) s[k] = 0;
  const b = plain(base);
  for (let i = 0; i < targets.length; i++) {
    const w = inf[i];
    if (w === 0) continue;
    const t = targets[i];
    const ta = plain(t);
    if (ta && b) {
      if (relative) for (let k = 0; k < len; k++) s[k] += ta[k] * w;
      else for (let k = 0; k < len; k++) s[k] += (ta[k] - b[k]) * w;
      continue;
    }
    for (let v = 0; v < n; v++) {
      const k = v * 3;
      const tx = t.getX(v);
      const ty = t.getY(v);
      const tz = t.getZ(v);
      if (relative) {
        s[k] += tx * w;
        s[k + 1] += ty * w;
        s[k + 2] += tz * w;
      } else {
        s[k] += (tx - base.getX(v)) * w;
        s[k + 1] += (ty - base.getY(v)) * w;
        s[k + 2] += (tz - base.getZ(v)) * w;
      }
    }
  }
  if (b) for (let k = 0; k < len; k++) out[k] = b[k] + s[k];
  else
    for (let v = 0; v < n; v++) {
      const k = v * 3;
      out[k] = base.getX(v) + s[k];
      out[k + 1] = base.getY(v) + s[k + 1];
      out[k + 2] = base.getZ(v) + s[k + 2];
    }
}

/** Whether three morphs the normals of this geometry (`morphReference`: a normal attribute and normal targets). */
function morphsNormals(g: THREE.BufferGeometry): boolean {
  return !!g.attributes.normal && !!g.morphAttributes.normal && g.morphAttributes.normal.length > 0;
}

/** Work a bake's arrays out for these influences (its making, and a slider moved in play), and mark them for upload. */
function fill(bake: Bake, inf: Influences): void {
  const g = bake.source;
  const rel = g.morphTargetsRelative;
  for (let i = 0; i < bake.weights.length; i++) bake.weights[i] = inf[i];
  if (bake.position) {
    morphInto(g.attributes.position, g.morphAttributes.position!, rel, inf, bake.position.array as Float32Array);
    bake.position.needsUpdate = true;
  }
  if (bake.normal) {
    morphInto(g.attributes.normal, g.morphAttributes.normal!, rel, inf, bake.normal.array as Float32Array);
    bake.normal.needsUpdate = true;
  }
  // Bounds worked out from the baked places when next asked (three's own, lazily).
  bake.baked.boundingBox = null;
  bake.baked.boundingSphere = null;
}

/** An attribute of the bake's own over a source attribute's very array, read as three reads the source's. */
function own(a: THREE.BufferAttribute): THREE.BufferAttribute {
  const c = new THREE.BufferAttribute(a.array, a.itemSize, a.normalized);
  c.name = a.name;
  c.usage = a.usage;
  c.gpuType = a.gpuType;
  return c;
}

/** The baked geometry let go of (its look disposed): the bake is gone, its bytes with it. */
function onBakedGone(this: THREE.BufferGeometry): void {
  const b = bakeOf.get(this);
  this.removeEventListener('dispose', onBakedGone);
  if (!b || b.gone) return;
  b.gone = true;
  MORPH_BAKE_STATS.live--;
  MORPH_BAKE_STATS.bytes -= b.bytes;
  MORPH_BAKE_STATS.cardBytes -= b.cardBytes;
  const list = bakesOf.get(b.source);
  if (list) {
    const i = list.indexOf(b);
    if (i >= 0) list.splice(i, 1);
  }
}

/** A bake of `source` for these influences: its own geometry, its arrays worked out. */
export function makeBake(source: THREE.BufferGeometry, inf: Influences): Bake {
  const t0 = typeof performance === 'undefined' ? 0 : performance.now();
  const n = source.attributes.position.count;
  const mp = source.morphAttributes.position;
  const count = (mp ?? source.morphAttributes.normal)!.length;
  const baked = new THREE.BufferGeometry();
  baked.name = source.name;
  // Every other attribute and the index are attributes of the bake's own over the source's very arrays: three ties an
  // attribute's buffer on the card to the geometry disposed (`Geometries`' dispose deletes every attribute of it), so a
  // look let go of would take the buffers of every other look whose bake shared one (a body shared by the looks, its
  // weights their own) with it. The arrays are shared; the source itself is never drawn on WebGPU.
  for (const name of Object.keys(source.attributes)) baked.setAttribute(name, own(source.attributes[name] as THREE.BufferAttribute));
  const position = mp && mp.length ? new THREE.BufferAttribute(new Float32Array(n * 3), 3) : null;
  const normal = morphsNormals(source) ? new THREE.BufferAttribute(new Float32Array(n * 3), 3) : null;
  if (position) baked.setAttribute('position', position);
  if (normal) baked.setAttribute('normal', normal);
  if (source.index) baked.setIndex(own(source.index));
  // What the body's own code changes in place on whatever geometry it draws (the head's split draw range, the zones in
  // `userData`, the groups) is the source's by reference: one change reaches both. An index or attribute swapped for a new
  // one on the bake is put on the source before the source is handed back (`syncSource`).
  baked.groups = source.groups;
  baked.drawRange = source.drawRange;
  baked.userData = source.userData;
  const bytes = ((position ? 1 : 0) + (normal ? 1 : 0)) * n * 12;
  let cardBytes = baked.index ? baked.index.array.byteLength : 0;
  for (const name of Object.keys(baked.attributes)) cardBytes += (baked.attributes[name] as THREE.BufferAttribute).array.byteLength;
  const bake: Bake = { source, baked, weights: new Float64Array(count), position, normal, bytes, cardBytes, gone: false };
  fill(bake, inf);
  bakeOf.set(baked, bake);
  const list = bakesOf.get(source);
  if (list) list.push(bake);
  else bakesOf.set(source, [bake]);
  baked.addEventListener('dispose', onBakedGone);
  MORPH_BAKE_STATS.made++;
  MORPH_BAKE_STATS.live++;
  MORPH_BAKE_STATS.bytes += bytes;
  MORPH_BAKE_STATS.cardBytes += cardBytes;
  MORPH_BAKE_STATS.vertices += n;
  if (t0) {
    const ms = performance.now() - t0;
    if (ms > MORPH_BAKE_STATS.longestMs) MORPH_BAKE_STATS.longestMs = ms;
  }
  return bake;
}

/** The bake a geometry is, or null for a geometry the bake did not make. */
export function bakeFor(g: THREE.BufferGeometry | undefined | null): Bake | null {
  return g ? (bakeOf.get(g) ?? null) : null;
}

/** Whether a mesh's influences are the ones its bake holds. */
function sameWeights(inf: Influences | undefined, b: Bake): boolean {
  if (!inf) return false;
  const w = b.weights;
  for (let i = 0; i < w.length; i++) if (inf[i] !== w[i]) return false;
  return true;
}

/** Count a refusal by its reason. */
function refuse(why: string): void {
  MORPH_BAKE_STATS.refused[why] = (MORPH_BAKE_STATS.refused[why] ?? 0) + 1;
}

/** Bake one mesh directly (a look's prototype, the player, a peer): its own bake, read once a frame while it stands in a scene. */
function bakeMesh(mesh: THREE.Mesh): Bake | null {
  const source = mesh.geometry;
  const inf = mesh.morphTargetInfluences;
  const why = refuseWhy(source, inf);
  if (why) {
    if (why === 'fewer influences than targets') refusedMesh.add(mesh);
    else refusedGeometry.add(source);
    refuse(why);
    return null;
  }
  const bake = makeBake(source, inf!);
  mesh.geometry = bake.baked;
  ownBake.set(mesh, bake);
  heat(mesh, bake);
  return bake;
}

/** A mesh baked directly, read once a frame from now on (until the frame finds it out of every scene). */
function heat(mesh: THREE.Mesh, bake: Bake): void {
  if (hotSet.has(mesh)) {
    for (const h of hot) if (h.mesh === mesh) h.bake = bake;
    return;
  }
  hotSet.add(mesh);
  hot.push({ mesh, bake });
}

/** Whether an object hangs in a scene (its parents reach one). Nothing allocated. */
function inScene(o: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o.parent;
  while (p) {
    if ((p as THREE.Scene).isScene) return true;
    p = p.parent;
  }
  return false;
}

/**
 * The source brought up to what its bake draws now, before it is handed back: the body's own code changes the drawn
 * geometry in place (the occlusion's index, a head split's index), so whatever was swapped on the bake is put on the source.
 */
function syncSource(b: Bake): void {
  const s = b.source;
  const d = b.baked;
  // The bake's index and attributes are its own over the source's arrays: one whose array is not the source's was put
  // there since (the occlusion's `setIndex`, a head split's), and is the one now drawn.
  if ((d.index?.array ?? null) !== (s.index?.array ?? null)) s.index = d.index;
  if (s.groups !== d.groups) s.groups = d.groups;
  if (s.drawRange !== d.drawRange) s.drawRange = d.drawRange;
  if (s.userData !== d.userData) s.userData = d.userData;
  for (const name of Object.keys(d.attributes)) {
    if ((name === 'position' && b.position) || (name === 'normal' && b.normal)) continue;
    const da = d.attributes[name] as THREE.BufferAttribute;
    if ((s.attributes[name] as THREE.BufferAttribute | undefined)?.array !== da.array) s.attributes[name] = da;
  }
}

/** A baked mesh handed its source (a preview's clone, leaving play, the switch off). Answers whether it was baked. */
function handBack(mesh: THREE.Mesh): boolean {
  const b = bakeOf.get(mesh.geometry);
  if (!b) return false;
  syncSource(b);
  mesh.geometry = b.source;
  return true;
}

/**
 * The bake brought up to its source before it is drawn again: what the body's code changed on the source while it was handed
 * back (out of play the creator dresses the figure, and the occlusion swaps the index of whatever geometry the mesh draws) is
 * put on the bake, as attributes of its own over the source's arrays.
 */
function syncBake(b: Bake): void {
  const s = b.source;
  const d = b.baked;
  if ((s.index?.array ?? null) !== (d.index?.array ?? null)) d.setIndex(s.index ? own(s.index) : null);
  if (d.groups !== s.groups) d.groups = s.groups;
  if (d.drawRange !== s.drawRange) d.drawRange = s.drawRange;
  if (d.userData !== s.userData) d.userData = s.userData;
  for (const name of Object.keys(s.attributes)) {
    if ((name === 'position' && b.position) || (name === 'normal' && b.normal)) continue;
    const sa = s.attributes[name] as THREE.BufferAttribute;
    if ((d.attributes[name] as THREE.BufferAttribute | undefined)?.array !== sa.array) d.setAttribute(name, own(sa));
  }
}

/** A mesh handed its own bake again, baked again first where its influences moved meanwhile. Answers whether it was. */
function handOn(mesh: THREE.Mesh): boolean {
  const b = ownBake.get(mesh);
  if (!b || b.gone || mesh.geometry !== b.source) return false;
  syncBake(b);
  if (!sameWeights(mesh.morphTargetInfluences, b)) {
    if (!mesh.morphTargetInfluences || mesh.morphTargetInfluences.length < b.weights.length) return false;
    fill(b, mesh.morphTargetInfluences);
    MORPH_BAKE_STATS.rebakes++;
  }
  mesh.geometry = b.baked;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// What the game calls (through the runtime's `morphBake`, on WebGPU alone).

/**
 * A drawable the world adopts (`World.adoptMaterials`): in play with the switch on, baked where it carries morph targets
 * (its own bake taken back where it had one), and a mesh baked directly hung back in a scene read once a frame again; with
 * the switch off, a clone of a baked prototype handed the live source. Allocates nothing for anything it leaves (every
 * drawable of a scan passes through).
 */
export function adoptMorphs(o: THREE.Object3D): void {
  if (!STATE.inPlay) return;
  const mesh = o as THREE.Mesh;
  const g = mesh.geometry;
  if (!g || !mesh.morphTargetInfluences) return;
  const ma = g.morphAttributes;
  if (!ma.position && !ma.normal) {
    // A baked geometry (it has no targets): a clone of a baked prototype stood while the switch is off draws the live
    // source; a mesh baked directly and hung back in a scene is read once a frame again.
    const b = bakeOf.get(g);
    if (!b) return;
    if (!GPU_KEYS.morphBake) {
      handBack(mesh);
      return;
    }
    if (!hotSet.has(mesh) && ownBake.get(mesh) === b) heat(mesh, b);
    return;
  }
  if (!GPU_KEYS.morphBake || refusedGeometry.has(g) || refusedMesh.has(mesh)) return;
  // A mesh baked before (out of play and back in it, the switch off and on again) takes its own bake back.
  if (handOn(mesh)) {
    MORPH_BAKE_STATS.rebaked++;
    if (!hotSet.has(mesh)) heat(mesh, ownBake.get(mesh)!);
    return;
  }
  bakeMesh(mesh);
}

/**
 * Once a frame, before the passes: every mesh baked directly and standing in a scene whose influences moved (a slider moved
 * in play) baked again in place, so the frame drawn shows it; one out of every scene, gone, or swapped onto another
 * geometry is let go of. Nothing allocated.
 */
export function morphBakeFrame(): void {
  if (!GPU_KEYS.morphBake || !STATE.inPlay) return;
  let t0 = 0;
  for (let i = 0; i < hot.length; ) {
    const h = hot[i];
    const mesh = h.mesh;
    const b = h.bake;
    if (b.gone || (mesh.geometry !== b.baked && mesh.geometry !== b.source) || !inScene(mesh)) {
      hotSet.delete(mesh);
      hot[i] = hot[hot.length - 1];
      hot.length--;
      continue;
    }
    if (mesh.geometry === b.baked && !sameWeights(mesh.morphTargetInfluences, b)) {
      const inf = mesh.morphTargetInfluences;
      if (inf && inf.length >= b.weights.length) {
        if (t0 === 0) t0 = performance.now();
        fill(b, inf);
        MORPH_BAKE_STATS.rebakes++;
      }
    }
    i++;
  }
  if (t0 !== 0) MORPH_BAKE_STATS.lastRebakeMs = performance.now() - t0;
}

/**
 * A preview's clone (`CharacterPreview`: the doll, the creator's dark stage, the select screen, the appearance page): every
 * baked mesh under it handed its source, so the preview's own context morphs it live. The clone's influences are the
 * character's (a clone copies them), and the preview copies them on every frame.
 */
export function unbakeClone(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && handBack(o as THREE.Mesh)) n++;
  });
  MORPH_BAKE_STATS.unbakedForPreviews += n;
  return n;
}

/**
 * Play begins (`true`, before the arrival's sweep adopts the scene) or ends (`false`, back to the select screen or the
 * creator). Out of play nothing is baked and every mesh baked directly that stood in play (the player's figure, a peer) is
 * handed its source, so the creator's figure and the select screen morph live; back in play the arrival's adoption hands
 * each its own bake again (baked again where a slider moved meanwhile), as this does now for those it holds.
 */
export function setMorphPlay(on: boolean): void {
  if (STATE.inPlay === on) return;
  STATE.inPlay = on;
  if (!GPU_KEYS.morphBake) return;
  for (const h of hot) {
    if (h.bake.gone) continue;
    if (on) {
      if (handOn(h.mesh)) MORPH_BAKE_STATS.rebaked++;
    } else if (h.mesh.geometry === h.bake.baked && handBack(h.mesh)) MORPH_BAKE_STATS.unbaked++;
  }
}

/** Clones in the scene handed their source by the switch, with the bake each drew, so the switch back finds it. */
const cloneWas = new WeakMap<THREE.Object3D, Bake>();

/**
 * The switch moved live (`__debug.gpu({ bake })`): off, every baked mesh in `scene` is handed its source (a clone stood later
 * is handed its source as it is adopted), and three builds each body's morphed pipelines again at its next draw (the
 * measure's); on, each takes its bake again (a clone stood while it was off is baked as its own). Answers the meshes moved.
 */
export function setMorphBake(on: boolean, scene: THREE.Object3D | null): number {
  if (GPU_KEYS.morphBake === on) return 0;
  let n = 0;
  if (!on) {
    for (const h of hot) if (!h.bake.gone && h.mesh.geometry === h.bake.baked && handBack(h.mesh)) n++;
    scene?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const b = mesh.isMesh ? bakeOf.get(mesh.geometry) : undefined;
      if (b && handBack(mesh)) {
        cloneWas.set(mesh, b);
        n++;
      }
    });
    GPU_KEYS.morphBake = false;
    return n;
  }
  GPU_KEYS.morphBake = true;
  if (!STATE.inPlay) return 0;
  for (const h of hot) if (handOn(h.mesh)) n++;
  scene?.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || bakeOf.has(mesh.geometry)) return;
    const b = cloneWas.get(mesh);
    if (b && !b.gone && mesh.geometry === b.source && sameWeights(mesh.morphTargetInfluences, b)) {
      mesh.geometry = b.baked;
      n++;
      return;
    }
    const before = mesh.geometry;
    adoptMorphs(mesh);
    if (mesh.geometry !== before) n++;
  });
  return n;
}

/** What `__debug.gpu()` says of the bake. */
export function morphBakeReport(): Record<string, unknown> {
  return {
    on: GPU_KEYS.morphBake,
    inPlay: STATE.inPlay,
    does: "in play, each look's shape sliders worked into one copy of its positions and normals (three's own CPU morph), shared by its clones; the drawn mesh carries no morph targets, so three keys no pipeline on a morph attribute. Out of play and in the previews the source morphs live.",
    switch: "__debug.gpu({ bake: false }) live, or localStorage['swg.gpu.keys.morphBake'] = '0' and a reload",
    bakes: { made: MORPH_BAKE_STATS.made, held: MORPH_BAKE_STATS.live, bytes: MORPH_BAKE_STATS.bytes, megabytes: Number((MORPH_BAKE_STATS.bytes / 1e6).toFixed(3)), cardMegabytes: Number((MORPH_BAKE_STATS.cardBytes / 1e6).toFixed(3)), verticesMade: MORPH_BAKE_STATS.vertices, longestMs: Number(MORPH_BAKE_STATS.longestMs.toFixed(2)) },
    readEachFrame: hot.length,
    rebakes: MORPH_BAKE_STATS.rebakes,
    lastRebakeMs: Number(MORPH_BAKE_STATS.lastRebakeMs.toFixed(3)),
    unbakedForPreviews: MORPH_BAKE_STATS.unbakedForPreviews,
    leftPlay: { handedBack: MORPH_BAKE_STATS.unbaked, takenAgain: MORPH_BAKE_STATS.rebaked },
    keptLive: { ...MORPH_BAKE_STATS.refused },
  };
}

/** The runtime's face of it (`GpuRuntime.morphBake`). */
export const MORPH_BAKE = {
  adopt: adoptMorphs,
  frame: morphBakeFrame,
  unbake: (root: THREE.Object3D): void => {
    unbakeClone(root);
  },
  play: setMorphPlay,
};

/** For the node tests: the state put back as a fresh session has it (nothing watched, out of play, the switch on). */
export function resetMorphBakeForTests(): void {
  hot.length = 0;
  STATE.inPlay = false;
  GPU_KEYS.morphBake = true;
  for (const k of Object.keys(MORPH_BAKE_STATS.refused)) delete MORPH_BAKE_STATS.refused[k];
  MORPH_BAKE_STATS.made = 0;
  MORPH_BAKE_STATS.live = 0;
  MORPH_BAKE_STATS.bytes = 0;
  MORPH_BAKE_STATS.cardBytes = 0;
  MORPH_BAKE_STATS.vertices = 0;
  MORPH_BAKE_STATS.rebakes = 0;
  MORPH_BAKE_STATS.unbakedForPreviews = 0;
  MORPH_BAKE_STATS.unbaked = 0;
  MORPH_BAKE_STATS.rebaked = 0;
}
