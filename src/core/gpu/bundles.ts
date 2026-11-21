// The region tiers' still meshes in three's render bundles on WebGPU (the GPU port's step 3, item 7).
//
// A tier of the placed-object streamer (`LayoutStreamer`) is a region's copies of its models made once and drawn the same
// way frame after frame: its bulk's instanced meshes and its level groups' copies. On WebGPU each shown tier's still
// meshes go under a `BundleGroup` of their own, so three records their draws into one GPU render bundle a pass and
// camera and replays it, walking none of them, until the tier's contents change. What is taken (`stillOf`): the tier's
// bulk instanced meshes standing out in the open (on layer 0 alone: an indoor copy carries the actor layer and is drawn
// with its rooms), opaque (a bundle runs at its pass's head, `patchStencilBundles.ts`), of one material with no flip-book
// or scroll (a picture swapped in play must reach the GPU, which a recorded bundle's bindings would not follow), no
// furniture (its own rules show it room by room), nothing hidden for good. Marked still before their programs are built
// (`stillMark.ts`, which the shadow and still patches read), and taken once the tier is shown.
//
// Recorded again only when the tier's contents change: a level group repacked or its shadows moved, a caster switch moved,
// a folded row hidden or shown in place (its slot's matrix rewritten), all found by a signature of what each mesh draws
// worked out only after one of those (the streamer pokes, `poke`/`dirty`), never every frame. Three's replay of a bundle
// uploads no attribute and binds the pictures it was recorded with, so the signature carries each mesh's copies' matrices'
// version and its material's pictures by identity: a matrix or a picture written in place on a bundled mesh reaches the
// GPU when the bundle is recorded again, at the streamer's next poke (a few times a second) or at once where it says so.
//
// Three replays a bundle in every pass whatever its layers say, so the bundles hang under one root shown only in passes
// that see the world's layer (`pass`: the world pass outdoors and through a building's exits; never the rooms' pass), and
// three culls nothing inside a bundle, so each tier's bundle is shown a frame only while its sphere meets the view or lies
// within the sun's shadow reach (`frame`). The root is one of the exit narrowing's parents: from inside a building a
// tier whose sphere misses the exits is left out of the world pass as its meshes were.
//
// Its switch (`BUNDLE_TUNE.on`, `gpu({ bundles: false })`, `localStorage['swg.gpu.bundles'] = '0'` at load) puts every
// taken mesh back in the scene as it was, live; on again takes them again. Held off while the stencil patch is off.

import * as THREE from 'three';
import { BundleGroup } from 'three/webgpu';
import type { GpuBundles } from '../gpuSwitch.ts';
import { markNarrowRoot } from '../../world/portalVis.ts';
import { isQuarantined } from '../../world/portalVis.ts';
import { markStill } from './stillMark.ts';
import { STENCIL_PATCH } from './patchStencilBundles.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const BUNDLE_TUNE = { on: true };

/** One tier's bundle. */
interface Rec {
  tier: object;
  group: BundleGroup;
  meshes: THREE.Object3D[];
  sphere: THREE.Sphere;
  /** What its meshes drew at its last recording (`sigOf`). */
  sig: number;
  /** Whether its meshes hang in the group now (false while the switch is off). */
  taken: boolean;
  /** How many times it was asked to record again. */
  again: number;
  /** Whether the view or the shadow reach saw it this frame. */
  seen: boolean;
}

/** The candidates a tier was marked with before its programs were built (`mark`), until it is shown (`take`). */
interface Marked {
  meshes: THREE.Object3D[];
}

const LAYER0 = 1;
/** A picture's identity for a bundle's signature (nought for none). */
const texId = (t: Any): number => (t ? (t.id | 0) + 1 : 0);
const tmpSphere = new THREE.Sphere();
const projView = new THREE.Matrix4();

export class TierBundles implements GpuBundles {
  readonly root = new THREE.Group();
  private readonly recs: Rec[] = [];
  private readonly byTier = new WeakMap<object, Rec>();
  private readonly marked = new WeakMap<object, Marked>();
  private scene: THREE.Scene | null = null;
  private poked = false;
  private readonly frustum = new THREE.Frustum();
  /** What the bundles have done, for the console. */
  readonly stats = { taken: 0, dropped: 0, recordedAgain: 0, shownLast: 0, meshesLast: 0, pokes: 0 };
  /** The sun's shadow reach, read a frame (the runtime's sun's own). */
  shadowReach: () => number = () => 0;

  constructor() {
    this.root.name = 'gpu bundles';
    // Its own matrices are never walked by anybody but the scene's one walk a frame: identity, at the origin.
    this.root.matrixAutoUpdate = false;
  }

  /** The scene the bundles hang in and the exit narrowing's parents (the world's, once its cascades and portals stand). */
  attach(scene: THREE.Scene, narrowParents: THREE.Object3D[]): void {
    this.scene = scene;
    if (this.root.parent !== scene) scene.add(this.root);
    if (!narrowParents.includes(this.root)) narrowParents.push(this.root);
  }

  /** Whether a mesh of a tier's bulk may be bundled (see the file's head). */
  private stillOf(m: Any, isFurniture: (m: THREE.Object3D) => boolean): boolean {
    if (!m.isInstancedMesh || m.layers.mask !== LAYER0 || isFurniture(m) || isQuarantined(m)) return false;
    if (m.renderOrder !== 0) return false;
    const mat = m.material;
    if (!mat || Array.isArray(mat) || mat.transparent === true || mat.isShaderMaterial === true) return false;
    if (mat.userData?.swgTrack || mat.userData?.gpuStandIn) return false;
    return true;
  }

  mark(tier: object, meshes: readonly THREE.Object3D[], bulk: number, isFurniture: (m: THREE.Object3D) => boolean): void {
    const n = Math.min(bulk, meshes.length);
    const list: THREE.Object3D[] = [];
    for (let i = 0; i < n; i++) {
      const m = meshes[i];
      if (!this.stillOf(m, isFurniture)) continue;
      markStill(m);
      list.push(m);
    }
    if (list.length) this.marked.set(tier, { meshes: list });
  }

  take(tier: object, scene: THREE.Scene): void {
    const mk = this.marked.get(tier);
    this.marked.delete(tier);
    if (!mk || this.byTier.has(tier)) return;
    // Only what is still where the streamer hung it: a mesh hidden for good or taken out meanwhile stays as it is.
    const meshes = mk.meshes.filter((m) => m.parent === scene && !isQuarantined(m));
    if (!meshes.length) return;
    if (this.root.parent !== scene) scene.add(this.root);
    this.scene = scene;
    const group = new BundleGroup();
    group.name = 'tier bundle';
    group.matrixAutoUpdate = false;
    const rec: Rec = { tier, group, meshes, sphere: new THREE.Sphere(), sig: 0, taken: false, again: 0, seen: true };
    markNarrowRoot(group, rec.sphere);
    this.recs.push(rec);
    this.byTier.set(tier, rec);
    this.stats.taken++;
    if (BUNDLE_TUNE.on && STENCIL_PATCH.on && STENCIL_PATCH.applied) this.hang(rec);
  }

  /** A tier's meshes into its bundle. */
  private hang(rec: Rec): void {
    if (rec.taken) return;
    for (const m of rec.meshes) {
      if (m.parent !== this.scene && m.parent !== rec.group) continue;
      rec.group.add(m);
    }
    this.root.add(rec.group);
    rec.taken = true;
    rec.sig = this.sigOf(rec);
    this.fitSphere(rec);
    rec.group.needsUpdate = true;
  }

  /** A tier's meshes back in the scene as the streamer hung them. */
  private unhang(rec: Rec): void {
    if (!rec.taken) return;
    const scene = this.scene;
    for (const m of rec.meshes) if (m.parent === rec.group) (scene ? scene.add(m) : rec.group.remove(m));
    this.root.remove(rec.group);
    rec.taken = false;
  }

  drop(tier: object): void {
    this.marked.delete(tier);
    const rec = this.byTier.get(tier);
    if (!rec) return;
    this.unhang(rec);
    for (const m of rec.meshes) markStill(m, false);
    this.byTier.delete(tier);
    const i = this.recs.indexOf(rec);
    if (i >= 0) this.recs.splice(i, 1);
    this.stats.dropped++;
  }

  dirty(tier: object): void {
    const rec = this.byTier.get(tier);
    if (!rec || !rec.taken) return;
    rec.group.needsUpdate = true;
    rec.again++;
    this.stats.recordedAgain++;
    this.poked = true;
  }

  poke(): void {
    this.poked = true;
    this.stats.pokes++;
  }

  /**
   * The sun's cascades made again at another size (pass 1, wave 6, `sun.ts`'s `resized`): a bundle replays the bind groups it was
   * recorded with, so every bundle taken is recorded again at its next draw, its objects refreshed by three with the new maps.
   */
  relight(): void {
    for (const rec of this.recs) {
      if (!rec.taken) continue;
      rec.group.needsUpdate = true;
      rec.again++;
      this.stats.recordedAgain++;
    }
  }

  setOn(on: boolean): void {
    BUNDLE_TUNE.on = on;
    const want = on && STENCIL_PATCH.on && STENCIL_PATCH.applied;
    for (const rec of this.recs) {
      if (want) this.hang(rec);
      else this.unhang(rec);
    }
  }

  /**
   * What each mesh draws, as one number: whether it is shown, whether it casts, how many copies, its copies' matrices'
   * version (a bundle's replay uploads no attribute, so copies rewritten in place, a level group's repack among them, reach
   * the GPU only when the bundle is recorded again), and its material and that material's pictures by identity (a picture
   * swapped in place is a bind group the recorded bundle cannot follow either).
   */
  private sigOf(rec: Rec): number {
    let h = 17;
    const ms = rec.meshes;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i] as Any;
      h = (Math.imul(h, 31) + (m.visible ? 1 : 0) + (m.castShadow ? 2 : 0) + (m.receiveShadow ? 4 : 0) + ((m.count | 0) << 3)) | 0;
      h = (Math.imul(h, 31) + (m.instanceMatrix ? m.instanceMatrix.version | 0 : 0)) | 0;
      const mat = m.material;
      if (mat && !Array.isArray(mat)) {
        h = (Math.imul(h, 31) + (mat.id | 0)) | 0;
        h = (Math.imul(h, 31) + texId(mat.map) + texId(mat.emissiveMap) * 3 + texId(mat.normalMap) * 5 + texId(mat.roughnessMap) * 7 + texId(mat.metalnessMap) * 11 + texId(mat.alphaMap) * 13 + texId(mat.aoMap) * 17 + texId(mat.envMap) * 19) | 0;
      }
    }
    return h;
  }

  /** The bundle's sphere: every shown mesh's own (an instanced mesh's covers its copies, in the world's frame). */
  private fitSphere(rec: Rec): void {
    const s = rec.sphere;
    s.makeEmpty();
    for (const m of rec.meshes as Any[]) {
      if (!m.visible) continue;
      const b = m.boundingSphere as THREE.Sphere | null;
      if (!b || b.isEmpty()) continue;
      if (s.isEmpty()) s.copy(b);
      else s.union(tmpSphere.copy(b));
    }
  }

  frame(camera: THREE.Camera): void {
    // A level swept, a caster switch, a row hidden in place: what each bundle draws looked at again, and a changed one
    // recorded again (its sphere fitted again with it).
    if (this.poked) {
      this.poked = false;
      for (const rec of this.recs) {
        if (!rec.taken) continue;
        const sig = this.sigOf(rec);
        if (sig !== rec.sig) {
          rec.sig = sig;
          rec.group.needsUpdate = true;
          rec.again++;
          this.stats.recordedAgain++;
          this.fitSphere(rec);
        }
      }
    }
    const cam = camera as THREE.PerspectiveCamera;
    projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(projView, cam.coordinateSystem, cam.reversedDepth);
    const reach = this.shadowReach();
    const px = cam.position.x;
    const pz = cam.position.z;
    let shown = 0;
    let meshes = 0;
    for (const rec of this.recs) {
      if (!rec.taken) continue;
      const s = rec.sphere;
      let seen = false;
      if (!s.isEmpty()) {
        if (this.frustum.intersectsSphere(s)) seen = true;
        else if (reach > 0) {
          const dx = s.center.x - px;
          const dz = s.center.z - pz;
          seen = Math.sqrt(dx * dx + dz * dz) - s.radius < reach;
        }
      }
      rec.seen = seen;
      if (rec.group.visible !== seen) rec.group.visible = seen;
      if (seen) {
        shown++;
        meshes += rec.meshes.length;
      }
    }
    this.stats.shownLast = shown;
    this.stats.meshesLast = meshes;
  }

  pass(seesWorld: boolean): void {
    if (this.root.visible !== seesWorld) this.root.visible = seesWorld;
  }

  report(): Record<string, unknown> {
    let taken = 0;
    let meshes = 0;
    let again = 0;
    for (const rec of this.recs) {
      if (!rec.taken) continue;
      taken++;
      meshes += rec.meshes.length;
      again += rec.again;
    }
    return {
      on: BUNDLE_TUNE.on,
      heldOff: BUNDLE_TUNE.on && !(STENCIL_PATCH.on && STENCIL_PATCH.applied) ? 'the stencil patch is off or did not apply: a stencil-tested material in a bundle would throw' : null,
      tiers: this.recs.length,
      bundles: taken,
      meshesBundled: meshes,
      shownLastFrame: this.stats.shownLast,
      meshesShownLastFrame: this.stats.meshesLast,
      recordedAgain: again,
      recordedAgainAll: this.stats.recordedAgain,
      taken: this.stats.taken,
      dropped: this.stats.dropped,
      pokes: this.stats.pokes,
      bundlesRecorded: STENCIL_PATCH.recorded,
      bundlesRun: STENCIL_PATCH.run,
      mixedReferences: STENCIL_PATCH.mixed,
    };
  }
}
