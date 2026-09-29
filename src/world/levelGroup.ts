// One model's copies in one region's tier, drawn at the client's own detail levels (step 7).
//
// The streamer instances a model once for every copy of it a region's tier holds. For a model whose pack
// carries lower levels, its copies standing out in the open are handed to one of these instead: an instanced
// mesh per piece of every level, the pieces of one level sharing one instance store, and a sweep that puts
// each copy at the level its distance from the eye picks (`levelOf`) and packs the stores level by level.
// With the levels switched off every copy is at the finest, which is exactly the mesh the streamer made
// before. A copy standing in a building's rooms is never one of these: the rooms' furniture is drawn by
// its building's own pass, at its finest.
//
// Every level is made and compiled with the tier, hidden, so a switch never builds a program on a live frame;
// a level with nothing at it is hidden rather than drawn with no copies (three would still make the draw).
// A group all of whose copies lie past its lowest switch, or inside its first, is settled once and left
// alone until that stops being so. Nothing is allocated by a sweep.
import * as THREE from 'three';
import type { ModelLevel, Primitive } from './assetPack.ts';
import { keepUploadRange, type UploadRange } from './uploadRange.ts';
import { LOD_LEVEL_TUNE, levelCasts, levelOf, packLevels, type LodLevelTune } from './lodLevels.ts';

/** One level's draw: a mesh a piece, one instance store they all read, and the copies at it now. */
interface LevelDraw {
  near: number;
  meshes: THREE.InstancedMesh[];
  /** Whether each mesh would cast as the finest rule says, before the level's own shadow rule. */
  base: boolean[];
  attr: THREE.InstancedBufferAttribute;
  count: number;
  /** Which copies it holds now, in order: a repack that leaves them as they were uploads nothing. */
  members: Int32Array;
  range: UploadRange;
}

/** A copy, as the group reads it: where it stands and how it is turned. */
export interface LevelCopy {
  x: number;
  y: number;
  z: number;
  q: THREE.Quaternion;
}

const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

/**
 * The sphere round what an instanced mesh draws now, in its own frame, written into its own `boundingSphere`
 * in place (which is what the frustum, the shadow cascades and the exit narrowing hold on to): every copy's
 * piece -- the geometry's sphere where the copy's matrix puts it, grown by the matrix's largest scale -- lies
 * inside it. Three's `computeBoundingSphere` is the same idea through a vector method a copy, each handed a
 * number, and V8 boxes a number handed to a call it has not inlined: measured under node it made a few hundred
 * bytes a call over a few hundred copies. Here nothing is called and nothing is made, once the mesh and its
 * geometry have a sphere (both are made on the first call, which is where a mesh is built). With nothing
 * drawn the sphere is left empty, as three leaves it.
 */
export function fitInstanceSphere(mesh: THREE.InstancedMesh): void {
  const geo = mesh.geometry;
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  if (!mesh.boundingSphere) mesh.boundingSphere = new THREE.Sphere();
  const gs = geo.boundingSphere as THREE.Sphere;
  const out = mesh.boundingSphere;
  const c = out.center;
  const n = mesh.count;
  if (!(n > 0)) {
    c.x = 0;
    c.y = 0;
    c.z = 0;
    out.radius = -1;
    return;
  }
  const a = mesh.instanceMatrix.array as Float32Array;
  const gx = gs.center.x;
  const gy = gs.center.y;
  const gz = gs.center.z;
  const gr = gs.radius;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const e = i * 16;
    const x = a[e] * gx + a[e + 4] * gy + a[e + 8] * gz + a[e + 12];
    const y = a[e + 1] * gx + a[e + 5] * gy + a[e + 9] * gz + a[e + 13];
    const z = a[e + 2] * gx + a[e + 6] * gy + a[e + 10] * gz + a[e + 14];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const mz = (z0 + z1) / 2;
  let r = 0;
  for (let i = 0; i < n; i++) {
    const e = i * 16;
    const dx = a[e] * gx + a[e + 4] * gy + a[e + 8] * gz + a[e + 12] - mx;
    const dy = a[e + 1] * gx + a[e + 5] * gy + a[e + 9] * gz + a[e + 13] - my;
    const dz = a[e + 2] * gx + a[e + 6] * gy + a[e + 10] * gz + a[e + 14] - mz;
    const s0 = a[e] * a[e] + a[e + 1] * a[e + 1] + a[e + 2] * a[e + 2];
    const s1 = a[e + 4] * a[e + 4] + a[e + 5] * a[e + 5] + a[e + 6] * a[e + 6];
    const s2 = a[e + 8] * a[e + 8] + a[e + 9] * a[e + 9] + a[e + 10] * a[e + 10];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + gr * Math.sqrt(s0 > s1 ? (s0 > s2 ? s0 : s2) : s1 > s2 ? s1 : s2);
    if (d > r) r = d;
  }
  c.x = mx;
  c.y = my;
  c.z = mz;
  out.radius = r;
}

export class LevelGroup {
  readonly n: number;
  private readonly mats: Float32Array;
  private readonly cx: Float32Array;
  private readonly cy: Float32Array;
  private readonly cz: Float32Array;
  /** Per copy, its level now (the level count for "drawn at nothing"). */
  readonly level: Int8Array;
  private readonly nears: Float32Array;
  private readonly beyond: number;
  readonly draws: LevelDraw[];
  private readonly start: Int32Array;
  private readonly order: Int32Array;
  /** Every mesh of every level, flat. */
  readonly meshes: THREE.InstancedMesh[] = [];
  /** Whether its programs exist (the tier revealed it): never shown before. */
  ready: boolean;
  /** The level every copy was put at the last time the group was settled whole, or -1 while they differ. */
  private settled = -1;
  /** A sphere round every copy's middle, grown by the model's own radius. */
  private readonly sx: number;
  private readonly sy: number;
  private readonly sz: number;
  private readonly sr: number;
  /** The scale the last sweep used, for the shadow rule. */
  private scale = 1;
  private cascadeFar = Number.POSITIVE_INFINITY;
  private shadowReach = Number.NaN;
  /** Repacks since it was made, for the console. */
  repacks = 0;
  /** A mesh the portal renderer hid for failing to draw, which nothing shows again (`isQuarantined`). */
  broken: ((o: THREE.Object3D) => boolean) | null = null;

  /**
   * `levels` is the model's, finest first; `centre` the middle, in the model's frame, of the box of what the
   * levels draw (a portal building's shell cell, never its rooms, which can run hundreds of metres under a cave's
   * door) and `radius` half its diagonal, for the distance each copy is measured from and the group's sphere; `make` builds one
   * mesh for one piece with room for every copy (the streamer's own rules for shadow, order and layers),
   * adds it to the scene hidden, and answers it. The group then owns its instance store.
   */
  private readonly tune: LodLevelTune;

  constructor(copies: readonly LevelCopy[], levels: readonly ModelLevel[], centre: THREE.Vector3, radius: number, make: (prim: Primitive, n: number) => THREE.InstancedMesh, ready: boolean, tune: LodLevelTune = LOD_LEVEL_TUNE) {
    this.tune = tune;
    const n = copies.length;
    this.n = n;
    this.ready = ready;
    this.mats = new Float32Array(n * 16);
    this.cx = new Float32Array(n);
    this.cy = new Float32Array(n);
    this.cz = new Float32Array(n);
    this.level = new Int8Array(n).fill(-1);
    const L = levels.length;
    this.nears = new Float32Array(L);
    for (let k = 0; k < L; k++) this.nears[k] = levels[k].near;
    const far = levels[L - 1].far;
    this.beyond = far > 0 && far < 1e8 ? far : Number.POSITIVE_INFINITY;
    this.start = new Int32Array(L + 2);
    this.order = new Int32Array(n);
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const c = copies[i];
      tmpM.compose(tmpV.set(c.x, c.y, c.z), c.q, ONE);
      tmpM.toArray(this.mats, i * 16);
      tmpV.copy(centre).applyQuaternion(c.q);
      this.cx[i] = c.x + tmpV.x;
      this.cy[i] = c.y + tmpV.y;
      this.cz[i] = c.z + tmpV.z;
      x0 = Math.min(x0, this.cx[i]);
      y0 = Math.min(y0, this.cy[i]);
      z0 = Math.min(z0, this.cz[i]);
      x1 = Math.max(x1, this.cx[i]);
      y1 = Math.max(y1, this.cy[i]);
      z1 = Math.max(z1, this.cz[i]);
    }
    this.sx = (x0 + x1) / 2;
    this.sy = (y0 + y1) / 2;
    this.sz = (z0 + z1) / 2;
    this.sr = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + Math.max(0, radius);
    this.draws = [];
    for (let k = 0; k < L; k++) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
      attr.setUsage(THREE.DynamicDrawUsage);
      const draw: LevelDraw = { near: levels[k].near, meshes: [], base: [], attr, count: 0, members: new Int32Array(n).fill(-1), range: { start: 0, count: 0 } };
      for (const prim of levels[k].primitives) {
        const mesh = make(prim, n);
        mesh.instanceMatrix = attr;
        mesh.count = 0;
        draw.meshes.push(mesh);
        draw.base.push(mesh.castShadow);
        this.meshes.push(mesh);
      }
      this.draws.push(draw);
    }
    // Every copy at the finest to begin with: what the streamer drew before, until the first sweep.
    this.level.fill(0);
    this.repack(true);
  }

  /** How many levels it switches between. */
  get levelCount(): number {
    return this.draws.length;
  }

  /** Its programs exist: each level shown as its copies say. */
  setReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.applyVisible();
  }

  /** Each mesh shown when the group is ready and its level holds a copy, and never one `broken` names. */
  applyVisible(): void {
    const broken = this.broken;
    const draws = this.draws;
    for (let k = 0; k < draws.length; k++) {
      const d = draws[k];
      const meshes = d.meshes;
      for (let m = 0; m < meshes.length; m++) {
        const mesh = meshes[m];
        const v = this.ready && d.count > 0 && !(broken && broken(mesh));
        if (mesh.visible !== v) mesh.visible = v;
      }
    }
  }

  /**
   * Put every copy at the level the eye picks (`scale` multiplies the client's switch distances) and repack
   * what changed. `cascadeFar` is where the second shadow cascade ends. Answers whether anything was repacked.
   */
  sweep(ex: number, ey: number, ez: number, scale: number, cascadeFar: number): boolean {
    const tune = this.tune;
    const L = this.draws.length;
    const h = tune.hysteresis;
    const beyond = tune.hideBeyond ? this.beyond : Number.POSITIVE_INFINITY;
    // The shadow rule's inputs: the scale, where the second cascade ends, and the rule's own reach (a tune moved).
    const shadowMoved = scale !== this.scale || cascadeFar !== this.cascadeFar || tune.shadowLevelMax !== this.shadowReach;
    this.scale = scale;
    this.cascadeFar = cascadeFar;
    this.shadowReach = tune.shadowLevelMax;
    let whole = -1;
    if (!tune.on) whole = 0;
    else {
      const dx = this.sx - ex;
      const dy = this.sy - ey;
      const dz = this.sz - ez;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const least = Math.max(0, d - this.sr);
      const most = d + this.sr;
      if (!(beyond < Number.POSITIVE_INFINITY) && least >= this.nears[L - 1] * scale * (1 + h)) whole = L - 1;
      else if (beyond < Number.POSITIVE_INFINITY && least >= beyond * scale * (1 + h)) whole = L;
      else if (most < this.nears[1] * scale * (1 - h) && most < beyond * scale * (1 - h)) whole = 0;
    }
    let changed = false;
    if (whole >= 0) {
      if (this.settled !== whole) {
        this.level.fill(whole);
        this.settled = whole;
        changed = true;
      }
    } else {
      this.settled = -1;
      const lv = this.level;
      for (let i = 0; i < this.n; i++) {
        const dx = this.cx[i] - ex;
        const dy = this.cy[i] - ey;
        const dz = this.cz[i] - ez;
        const want = levelOf(Math.sqrt(dx * dx + dy * dy + dz * dz), this.nears, L, scale, h, lv[i], beyond);
        if (want !== lv[i]) {
          lv[i] = want;
          changed = true;
        }
      }
    }
    if (changed) this.repack(false);
    else if (shadowMoved) this.applyShadows();
    return changed;
  }

  /** Each level's store written with the copies at it (only a level whose copies changed is written and uploaded), its count, its sphere and its shadow. */
  private repack(first: boolean): void {
    const L = this.draws.length;
    const order = this.order;
    const mats = this.mats;
    packLevels(this.level, this.n, L + 1, this.start, order);
    for (let k = 0; k < L; k++) {
      const d = this.draws[k];
      const from = this.start[k];
      const c = this.start[k + 1] - from;
      let same = !first && c === d.count;
      if (same) {
        for (let j = 0; j < c; j++) {
          if (d.members[j] !== order[from + j]) {
            same = false;
            break;
          }
        }
      }
      if (same) continue;
      const out = d.attr.array as Float32Array;
      for (let j = 0; j < c; j++) {
        const i = order[from + j];
        d.members[j] = i;
        // Sixteen numbers by hand: a `subarray` to copy from is a new view object a copy.
        const s = i * 16;
        const o = j * 16;
        for (let e = 0; e < 16; e++) out[o + e] = mats[s + e];
      }
      d.count = c;
      if (c > 0) {
        keepUploadRange(d.attr.updateRanges as UploadRange[], d.range, 0, c * 16);
        d.attr.needsUpdate = true;
      }
      const meshes = d.meshes;
      for (let m = 0; m < meshes.length; m++) {
        const mesh = meshes[m];
        mesh.count = c;
        // The sphere the frustum, the shadow cascades and the exit narrowing test: only what it draws now.
        fitInstanceSphere(mesh);
      }
    }
    this.repacks++;
    this.applyShadows();
    this.applyVisible();
  }

  /** Each level's meshes cast as the finest rule says, less the lowest level once its switch is past the second cascade (`levelCasts`). */
  private applyShadows(): void {
    const L = this.draws.length;
    for (let k = 0; k < L; k++) {
      const d = this.draws[k];
      for (let m = 0; m < d.meshes.length; m++) {
        const cast = levelCasts(d.base[m], k, L, d.near * this.scale, this.cascadeFar, this.tune);
        if (d.meshes[m].castShadow !== cast) d.meshes[m].castShadow = cast;
      }
    }
  }

  /** How many copies stand at each level now (the last entry: drawn at nothing), into `out`. */
  countInto(out: number[]): void {
    const L = this.draws.length;
    for (let i = 0; i < this.n; i++) {
      const lv = this.level[i];
      const slot = lv >= L ? out.length - 1 : Math.min(lv, out.length - 2);
      out[slot]++;
    }
  }
}
