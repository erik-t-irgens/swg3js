// The still placed casters of each loaded region tier, drawn into the sun's shadow maps as one draw (the performance
// pass's sixth wave): a three `BatchedMesh` per tier, a mirror of its sources that owns none of their rules.
//
// Today a region's placed objects reach each cascade as one draw per model piece per level per tier, and three walks,
// tests, binds and draws each of them three times a frame. Here each tier's meshes that three would draw through its one
// shared depth material from the back with nothing that changes a depth (one material, front-sided, no shadow side, no
// cut, not transparent, no displacement, no clipping, no custom depth material, on the world's layer alone) are copied,
// position and index only, into one batch, every copy an instance at its own matrix; three culls each instance against
// each cascade in the batch's own `onBeforeShadow` (`BatchedMesh.js`) and issues one multi-draw. A picture on such a
// material is in the depth program's key but changes no depth, so the batch, which has none, writes the same map.
//
// **The batches follow their sources and never take their casting over.** Each shadow pass (`around`, from the portal
// renderer's hooks) reads each source's `castShadow && visible` as the source's own rules left it this frame (the tier's
// reveal, the page's smallest caster and the flora switches through `applyCasters`, a level's own shadow rule and its
// count of nought), mirrors it into its instances, and turns the source's `castShadow` off for the pass alone, putting
// it back in `restore` (the portal renderer's `finally`). So the source's `castShadow` is its own rule's at every moment
// but inside the shadow pass, no writer is audited and no rule is moved; and a source the batch takes is drawn into the
// maps by the batch alone, never both and never neither while it wants to cast.
//
// A batch is made over frames (`build`, at most `buildSliceMs` a frame), its sources casting as they always did until it
// is whole, on a layer of its own (`FX_LAYERS.shadowCast`, 28: the shadow pass's probe sees every layer, no view pass
// does, and the world's warm-up warms no pass for it), with the session's one material, which nothing disposes. Its one
// depth program (`USE_BATCHING`, cast from the back) is warmed behind the first screen (`batchedDepthCombo`).
// `localStorage['swg.shadowBatches'] = '0'` makes no batch all session; `SHADOW_PASS_TUNE.batches` false stops drawing the
// ones made. Node loads it (`shadowBatches.test.ts`).
import * as THREE from 'three';
import { FX_LAYERS } from '../core/fxRegistry.ts';
import { SHADOW_PASS_TUNE } from './shadowCadence.ts';
import { isQuarantined } from './portalVis.ts';
import type { LevelGroup } from './levelGroup.ts';

/** Why a source is left to cast as it always did. */
export type LeftOut = 'material' | 'side' | 'cut' | 'transparent' | 'depth' | 'sway' | 'layer' | 'moved' | 'geometry';
export const LEFT_OUT: readonly LeftOut[] = ['material', 'side', 'cut', 'transparent', 'depth', 'sway', 'layer', 'moved', 'geometry'];

/**
 * Whether three would draw this mesh into the shadow maps through its one shared depth material from the back with
 * nothing that changes a depth, so the batch writes the same map: '' when it would, else why not.
 */
export function batchable(mesh: THREE.Mesh): LeftOut | '' {
  const m = mesh.material as THREE.Material | THREE.Material[];
  if (Array.isArray(m)) return 'material';
  // A swaying model's piece, whether or not its sway's depth material is hung now (`SWAY_TUNE.shadow` moves it).
  if (mesh.customDepthMaterial || m.userData.swgSway !== undefined) return 'sway';
  if (m.side !== THREE.FrontSide || m.shadowSide !== null) return 'side';
  if (m.alphaTest > 0 || m.alphaToCoverage) return 'cut';
  if (m.transparent) return 'transparent';
  const d = m as THREE.MeshStandardMaterial;
  if ((d.displacementMap && d.displacementScale !== 0) || (m.clippingPlanes && m.clippingPlanes.length > 0)) return 'depth';
  if (mesh.layers.mask !== 1) return 'layer';
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  if (!pos || pos.itemSize !== 3 || (g.morphAttributes.position?.length ?? 0) > 0 || (mesh as THREE.InstancedMesh).morphTexture) return 'geometry';
  if (g.drawRange.start !== 0 || g.drawRange.count !== Number.POSITIVE_INFINITY) return 'geometry';
  mesh.updateWorldMatrix(true, false);
  const e = mesh.matrixWorld.elements;
  for (let i = 0; i < 16; i++) if (e[i] !== (i % 5 === 0 ? 1 : 0)) return 'moved';
  return '';
}

/**
 * Whether a source casts this frame by its own rules (and its material draws at all), and is still drawn the batch's way:
 * a console knob that turns a material two-sided or cuts it in play (the leaf cards' rule moved) leaves that source
 * casting on its own from that pass on, never drawn both ways and never neither.
 */
function wants(mesh: THREE.Mesh): number {
  const m = mesh.material as THREE.Material;
  if (!mesh.castShadow || !mesh.visible || !m.visible) return 0;
  return m.side === THREE.FrontSide && m.shadowSide === null && m.alphaTest === 0 && !m.transparent ? 1 : 0;
}

/** A tier's own instanced mesh, its copies the batch's instances from `first`. */
interface PlainSource {
  mesh: THREE.InstancedMesh;
  geo: number;
  first: number;
  /** Instances reserved: its count when taken. */
  n: number;
  want: number;
  version: number;
  count: number;
}

/** A level group's copies, one instance per piece slot each; the geometry of a slot the piece at the copy's level now. */
interface LevelSource {
  group: LevelGroup;
  levels: number;
  slots: number;
  /** Each (copy, slot)'s instance, or -1 where no level's piece in that slot is taken. */
  ids: Int32Array;
  /** Each (level, slot)'s geometry in the batch, -1 where that level has no piece there or it is left out. */
  geo: Int32Array;
  /** Each (level, slot)'s mesh, null where that level has fewer pieces. */
  meshes: (THREE.InstancedMesh | null)[];
  want: Int8Array;
  repacks: number;
}

/** One tier's batch: its sources, the batch once begun, and how far its building has got. */
export class TierBatch {
  readonly plain: PlainSource[] = [];
  readonly levels: LevelSource[] = [];
  /** Every unique source geometry, in order, and its id once added. */
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly geoIds = new Map<THREE.BufferGeometry, number>();
  mesh: THREE.BatchedMesh | null = null;
  /** Whether every source is in and the batch stands in the scene. */
  whole = false;
  /** Whether its instances mirror the sources (false until the first pass after it is whole, and after the batches were off). */
  synced = false;
  /** Building progress: geometries added, then sources filled. */
  step = 0;
  dropped = false;
  instances = 0;
  vertices = 0;
  indices = 0;
  /** Bytes held: positions, indices, the matrices' and the indirect texture's. */
  bytes = 0;
  /** The indirect texture's bytes, uploaded at each of its draws. */
  indirectBytes = 0;
  /** Sources left out, by reason. */
  readonly leftOut: Record<LeftOut, number> = { material: 0, side: 0, cut: 0, transparent: 0, depth: 0, sway: 0, layer: 0, moved: 0, geometry: 0 };
  /** Sources taken: plain meshes and level pieces. */
  taken = 0;
}

/** The session's one material for every batch: never drawn in a view, never wrapped by the scan, never disposed. */
let sessionMaterial: THREE.MeshBasicMaterial | null = null;
export function shadowBatchMaterial(): THREE.MeshBasicMaterial {
  if (sessionMaterial) return sessionMaterial;
  const m = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
  m.name = 'shadow batch';
  m.userData.unlit = true;
  m.userData.dry = true;
  sessionMaterial = m;
  return m;
}

/** Whether this session makes batches at all: `localStorage['swg.shadowBatches'] = '0'` makes none (read once, at load). */
function hatchOn(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem('swg.shadowBatches') !== '0';
  } catch {
    return true;
  }
}
export const SHADOW_BATCH_HATCH = { on: hatchOn() };

const tmpM = new THREE.Matrix4();
const tmpS = new THREE.Sphere();
const tmpV = new THREE.Vector3();

/** A geometry's position (as floats) and index (made where it has none): what a batch keeps of it. */
function stripped(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const n = pos.count;
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    p[i * 3] = pos.getX(i);
    p[i * 3 + 1] = pos.getY(i);
    p[i * 3 + 2] = pos.getZ(i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const idx = g.getIndex();
  const k = idx ? idx.count : n;
  const a = new Uint32Array(k);
  for (let i = 0; i < k; i++) a[i] = idx ? idx.getX(i) : i;
  out.setIndex(new THREE.BufferAttribute(a, 1));
  return out;
}

export class ShadowBatches {
  readonly scene: THREE.Object3D;
  /** Every tier's batch standing or being made, in a kept list each pass walks by index. */
  readonly tiers: TierBatch[] = [];
  /** The sources whose `castShadow` this pass turned off, put back by `restore`; written by index. */
  private readonly swapped: THREE.Mesh[] = [];
  private swappedN = 0;
  /** The worst frame's build, ms, and the indirect bytes uploaded on the last shadow pass. */
  worstBuildMs = 0;
  uploadsLast = 0;
  private uploads = 0;
  /** The batches standing whole, and the sources they take between them (the frame report's gauges). */
  standing = 0;
  casters = 0;

  constructor(scene: THREE.Object3D) {
    this.scene = scene;
  }

  /**
   * Take a tier's casters: its own instanced meshes (`plain`, which the streamer has already kept to those that are not
   * furniture, a level's, a placement made in play, or of a material that never casts) and its level groups. Each that
   * three would draw the batch's way is taken, the rest counted by their reason. Sized now; filled over frames by
   * `build`. Null when the session makes no batches or nothing is taken.
   */
  take(plain: readonly THREE.InstancedMesh[], levels: readonly LevelGroup[]): TierBatch | null {
    if (!SHADOW_BATCH_HATCH.on) return null;
    const b = new TierBatch();
    const geoOf = (g: THREE.BufferGeometry): void => {
      if (b.geoIds.has(g)) return;
      b.geoIds.set(g, -1);
      b.geometries.push(g);
    };
    for (const mesh of plain) {
      const why = batchable(mesh);
      if (why) {
        b.leftOut[why]++;
        continue;
      }
      geoOf(mesh.geometry);
      b.plain.push({ mesh, geo: -1, first: b.instances, n: mesh.count, want: -1, version: -1, count: -1 });
      b.instances += mesh.count;
      b.taken++;
    }
    for (const group of levels) {
      const L = group.draws.length;
      let slots = 0;
      for (let k = 0; k < L; k++) if (group.draws[k].meshes.length > slots) slots = group.draws[k].meshes.length;
      const meshes: (THREE.InstancedMesh | null)[] = new Array<THREE.InstancedMesh | null>(L * slots).fill(null);
      const geo = new Int32Array(L * slots).fill(-1);
      const slotTaken = new Uint8Array(slots);
      let any = false;
      for (let k = 0; k < L; k++) {
        const pieces = group.draws[k].meshes;
        for (let s = 0; s < pieces.length; s++) {
          meshes[k * slots + s] = pieces[s];
          const why = batchable(pieces[s]);
          if (why) {
            b.leftOut[why]++;
            continue;
          }
          geoOf(pieces[s].geometry);
          // Marked taken for now; the geometry's id is written as it is added.
          geo[k * slots + s] = -2;
          slotTaken[s] = 1;
          any = true;
          b.taken++;
        }
      }
      if (!any) continue;
      const ids = new Int32Array(group.n * slots).fill(-1);
      for (let c = 0; c < group.n; c++) for (let s = 0; s < slots; s++) if (slotTaken[s]) ids[c * slots + s] = b.instances++;
      b.levels.push({ group, levels: L, slots, ids, geo, meshes, want: new Int8Array(L * slots).fill(-1), repacks: -1 });
    }
    if (!b.taken || !b.instances) return null;
    for (const g of b.geometries) {
      b.vertices += g.getAttribute('position').count;
      b.indices += g.getIndex() ? g.getIndex()!.count : g.getAttribute('position').count;
    }
    const mesh = new THREE.BatchedMesh(b.instances, b.vertices, b.indices, shadowBatchMaterial());
    mesh.name = 'shadow batch';
    mesh.layers.set(FX_LAYERS.shadowCast);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.sortObjects = false;
    mesh.perObjectFrustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    b.mesh = mesh;
    const side = Math.ceil(Math.sqrt(b.instances));
    b.indirectBytes = side * side * 4;
    const matSide = Math.max(4, Math.ceil(Math.sqrt(b.instances * 4) / 4) * 4);
    b.bytes = b.vertices * 12 + b.indices * (b.vertices > 65535 ? 4 : 2) + matSide * matSide * 16 + b.indirectBytes;
    // The indirect texture is uploaded at every draw (three's `onBeforeRender` asks for it each call): counted here.
    const own = THREE.BatchedMesh.prototype.onBeforeShadow;
    const host = this;
    mesh.onBeforeShadow = function (r, o, c, sc, g, d, grp) {
      host.uploads += b.indirectBytes;
      own.call(mesh, r, o, c, sc, g, d, grp);
    };
    this.tiers.push(b);
    return b;
  }

  /** A tier gone: its batch out of the scene and its geometry and textures freed (the material is the session's). */
  drop(b: TierBatch | null | undefined): void {
    if (!b || b.dropped) return;
    b.dropped = true;
    const i = this.tiers.indexOf(b);
    if (i >= 0) this.tiers.splice(i, 1);
    if (b.whole) {
      this.standing--;
      this.casters -= b.taken;
    }
    if (b.mesh) {
      b.mesh.removeFromParent();
      b.mesh.dispose();
      b.mesh = null;
    }
    b.whole = false;
  }

  /**
   * Fill the batches being made, for at most `buildSliceMs` of this frame: a geometry or a source's instances at a time.
   * Not a steady frame's work: a frame with nothing being made only walks the list.
   */
  build(): void {
    const tiers = this.tiers;
    let started = -1;
    for (let i = 0; i < tiers.length; i++) {
      const b = tiers[i];
      if (b.whole) continue;
      if (started < 0) started = performance.now();
      while (!b.whole) {
        this.buildStep(b);
        if (performance.now() - started >= SHADOW_PASS_TUNE.buildSliceMs) break;
      }
      if (performance.now() - started >= SHADOW_PASS_TUNE.buildSliceMs) break;
    }
    if (started >= 0) {
      const ms = performance.now() - started;
      if (ms > this.worstBuildMs) this.worstBuildMs = ms;
    }
  }

  /** Make every batch whole now (a test, the console). */
  buildAll(): void {
    for (const b of this.tiers) while (!b.whole) this.buildStep(b);
  }

  /** One step of a batch: the next geometry, else the next source's instances, else the sphere and the scene. */
  private buildStep(b: TierBatch): void {
    const mesh = b.mesh!;
    const G = b.geometries.length;
    if (b.step < G) {
      const g = b.geometries[b.step++];
      const s = stripped(g);
      const id = mesh.addGeometry(s);
      s.dispose();
      // Worked out now: three makes it, a new sphere, on the first draw that asks.
      mesh.getBoundingSphereAt(id, tmpS);
      b.geoIds.set(g, id);
      return;
    }
    const k = b.step - G;
    if (k < b.plain.length) {
      const s = b.plain[k];
      s.geo = b.geoIds.get(s.mesh.geometry)!;
      const a = s.mesh.instanceMatrix.array as Float32Array;
      for (let i = 0; i < s.n; i++) {
        const id = mesh.addInstance(s.geo);
        mesh.setMatrixAt(id, tmpM.fromArray(a, i * 16));
        mesh.setVisibleAt(id, false);
      }
      s.version = s.mesh.instanceMatrix.version;
      s.count = s.mesh.count;
      b.step++;
      return;
    }
    const j = k - b.plain.length;
    if (j < b.levels.length) {
      const s = b.levels[j];
      for (let i = 0; i < s.geo.length; i++) if (s.geo[i] === -2) s.geo[i] = b.geoIds.get(s.meshes[i]!.geometry)!;
      for (let c = 0; c < s.group.n; c++) {
        s.group.matrixOf(c, tmpM);
        for (let slot = 0; slot < s.slots; slot++) {
          if (s.ids[c * s.slots + slot] < 0) continue;
          // Any geometry this slot can take, until the first pass sets the copy's own.
          let g = -1;
          for (let lv = 0; lv < s.levels && g < 0; lv++) g = s.geo[lv * s.slots + slot];
          const id = mesh.addInstance(g);
          mesh.setMatrixAt(id, tmpM);
          mesh.setVisibleAt(id, false);
        }
      }
      b.step++;
      return;
    }
    // Every source in: the batch's sphere over every instance and every geometry each can take, then the scene.
    mesh.boundingSphere = this.sphereOf(b);
    mesh.updateMatrix();
    mesh.matrixWorld.identity();
    this.scene.add(mesh);
    mesh.updateMatrixWorld(true);
    b.whole = true;
    b.synced = false;
    this.standing++;
    this.casters += b.taken;
  }

  /** The sphere round everything a batch can draw: each instance at its matrix with every geometry its slot can take. */
  private sphereOf(b: TierBatch): THREE.Sphere {
    const mesh = b.mesh!;
    const box = new THREE.Box3();
    const spheres: THREE.Sphere[] = [];
    const add = (geo: number, m: THREE.Matrix4): void => {
      if (geo < 0) return;
      const s = mesh.getBoundingSphereAt(geo, new THREE.Sphere())!.applyMatrix4(m);
      spheres.push(s);
      box.expandByPoint(tmpV.copy(s.center).addScalar(s.radius));
      box.expandByPoint(tmpV.copy(s.center).addScalar(-s.radius));
    };
    for (const s of b.plain) {
      const a = s.mesh.instanceMatrix.array as Float32Array;
      for (let i = 0; i < s.n; i++) add(s.geo, tmpM.fromArray(a, i * 16));
    }
    for (const s of b.levels) {
      for (let c = 0; c < s.group.n; c++) {
        s.group.matrixOf(c, tmpM);
        for (let lv = 0; lv < s.levels; lv++) for (let slot = 0; slot < s.slots; slot++) if (s.ids[c * s.slots + slot] >= 0) add(s.geo[lv * s.slots + slot], tmpM);
      }
    }
    const out = new THREE.Sphere();
    box.getCenter(out.center);
    let r = 0;
    for (const s of spheres) {
      const d = s.center.distanceTo(out.center) + s.radius;
      if (d > r) r = d;
    }
    out.radius = r;
    return out;
  }

  /**
   * Before a shadow pass: each whole batch shown and casting while `batches` is on, its instances following their
   * sources as their own rules left them this frame, and every taken source that wants to cast turned off for the pass
   * (`restore` puts each back). With `batches` off nothing is swapped and every batch casts nothing. A batch the portal
   * renderer hid for good because its draw threw (`isQuarantined`) is never shown again and swaps nothing, so its sources
   * cast on their own: shown again it would throw again, cut every shadow pass short and leave its sources casting
   * nothing in any pass. Allocates nothing.
   */
  around(): void {
    this.swappedN = 0;
    this.uploads = 0;
    const on = SHADOW_PASS_TUNE.batches;
    const tiers = this.tiers;
    for (let i = 0; i < tiers.length; i++) {
      const b = tiers[i];
      const mesh = b.mesh;
      if (!b.whole || !mesh) continue;
      if (isQuarantined(mesh)) {
        if (mesh.castShadow) mesh.castShadow = false;
        if (mesh.visible) mesh.visible = false;
        b.synced = false;
        continue;
      }
      if (mesh.castShadow !== on) mesh.castShadow = on;
      if (mesh.visible !== on) mesh.visible = on;
      if (!on) {
        b.synced = false;
        continue;
      }
      this.follow(b, mesh);
      this.swap(b);
    }
  }

  /** After the pass, whatever it threw: every source turned off for it put back. */
  restore(): void {
    const n = this.swappedN;
    for (let i = 0; i < n; i++) this.swapped[i].castShadow = true;
    this.swappedN = 0;
    this.uploadsLast = this.uploads;
  }

  /** The batch's instances made to say what their sources would draw now. */
  private follow(b: TierBatch, mesh: THREE.BatchedMesh): void {
    const force = !b.synced;
    for (let k = 0; k < b.plain.length; k++) {
      const s = b.plain[k];
      const src = s.mesh;
      const ver = src.instanceMatrix.version;
      const cnt = src.count;
      let rewrite = force;
      if (ver !== s.version || cnt !== s.count) {
        const a = src.instanceMatrix.array as Float32Array;
        // The batch's own sphere grows to hold a copy moved past it: three culls the whole batch against each cascade by
        // that sphere before any instance, so a copy outside it would cast nothing while its source casts nothing either.
        const whole = mesh.boundingSphere;
        for (let i = 0; i < s.n; i++) {
          mesh.setMatrixAt(s.first + i, tmpM.fromArray(a, i * 16));
          if (whole && mesh.getBoundingSphereAt(s.geo, tmpS)) whole.union(tmpS.applyMatrix4(tmpM));
        }
        s.version = ver;
        s.count = cnt;
        rewrite = true;
      }
      const w = wants(src);
      if (w !== s.want || rewrite) {
        s.want = w;
        const shown = cnt < s.n ? cnt : s.n;
        for (let i = 0; i < s.n; i++) mesh.setVisibleAt(s.first + i, w === 1 && i < shown);
      }
    }
    for (let k = 0; k < b.levels.length; k++) {
      const s = b.levels[k];
      let changed = force || s.group.repacks !== s.repacks;
      for (let j = 0; j < s.meshes.length; j++) {
        const piece = s.meshes[j];
        if (!piece) continue;
        const w = wants(piece);
        if (w !== s.want[j]) {
          s.want[j] = w;
          changed = true;
        }
      }
      if (!changed) continue;
      s.repacks = s.group.repacks;
      const level = s.group.level;
      const L = s.levels;
      const S = s.slots;
      for (let c = 0; c < s.group.n; c++) {
        const lv = level[c];
        for (let slot = 0; slot < S; slot++) {
          const id = s.ids[c * S + slot];
          if (id < 0) continue;
          if (lv >= 0 && lv < L) {
            const j = lv * S + slot;
            const g = s.geo[j];
            if (g >= 0 && s.want[j] === 1) {
              if (mesh.getGeometryIdAt(id) !== g) mesh.setGeometryIdAt(id, g);
              mesh.setVisibleAt(id, true);
              continue;
            }
          }
          mesh.setVisibleAt(id, false);
        }
      }
    }
    b.synced = true;
  }

  /** Every taken source that wants to cast, off for this pass. */
  private swap(b: TierBatch): void {
    const out = this.swapped;
    for (let k = 0; k < b.plain.length; k++) {
      const s = b.plain[k];
      if (s.want !== 1 || !s.mesh.castShadow) continue;
      s.mesh.castShadow = false;
      if (this.swappedN < out.length) out[this.swappedN] = s.mesh;
      else out.push(s.mesh);
      this.swappedN++;
    }
    for (let k = 0; k < b.levels.length; k++) {
      const s = b.levels[k];
      for (let j = 0; j < s.meshes.length; j++) {
        const piece = s.meshes[j];
        if (!piece || s.geo[j] < 0 || s.want[j] !== 1 || !piece.castShadow) continue;
        piece.castShadow = false;
        if (this.swappedN < out.length) out[this.swappedN] = piece;
        else out.push(piece);
        this.swappedN++;
      }
    }
  }

  /** For the console: tiers batched and being made, sources taken and left out by reason, instances, megabytes, the worst build, the uploads, and batches hidden for good because their draw threw (`broken`, their sources casting on their own). */
  report(): { batched: number; building: number; broken: number; taken: number; leftOut: Record<string, number>; instances: number; megabytes: number; worstBuildMs: number; indirectKbLastPass: number; hatch: boolean; drawing: boolean } {
    const leftOut: Record<string, number> = {};
    for (const r of LEFT_OUT) leftOut[r] = 0;
    let batched = 0;
    let building = 0;
    let broken = 0;
    let taken = 0;
    let instances = 0;
    let bytes = 0;
    for (const b of this.tiers) {
      if (b.whole) batched++;
      else building++;
      if (b.mesh && isQuarantined(b.mesh)) broken++;
      taken += b.taken;
      instances += b.instances;
      bytes += b.bytes;
      for (const r of LEFT_OUT) leftOut[r] += b.leftOut[r];
    }
    return { batched, building, broken, taken, leftOut, instances, megabytes: Number((bytes / 1e6).toFixed(2)), worstBuildMs: Number(this.worstBuildMs.toFixed(2)), indirectKbLastPass: Number((this.uploadsLast / 1024).toFixed(1)), hatch: SHADOW_BATCH_HATCH.on, drawing: SHADOW_PASS_TUNE.batches };
  }
}
