// The dents (the design's §2.7, the second wave): footprints, a speeder's rut, the pit a jet scours under a hovering
// ship, a crater -- each a depth in metres pressed into one float32 field the tile ground reads.
//
// **World-anchored and toroidal.** A blended field cannot be scrolled in place, so the field does not follow the window:
// texel `floor(x / t) mod N` over a square of `prints.square` (128 m) round the camera, `N` the print detail and `t =
// square / N` (6.25 cm at High), read with repeat wrapping. The square snaps to whole texels as the camera moves, and
// the rows and columns that leave it are cleared as strips (a scissored clear: no program), since the same texels then
// stand for the ground coming in on the far side. Nothing is read outside the square (the period is the square, so a
// point outside would read another place's prints), and a dent fades across its last `squareEdge` metres.
//
// **Stamps** are instanced quads blended additively, up to `forces.dents` a draw, a stamp whose quad crosses a wrap line
// drawn again offset by the field's size (up to four copies). A **one-shot** (a footprint, a crater, the console's) is
// drawn by the frame it is asked in; a **continuous** source (a scour pit, a rut) is gathered on the CPU per source and
// laid once on each tick of the 10 Hz clock with the depth it gathered since the last, along the path it moved -- spaced
// at `prints.spacing` of its radius, each stamp its share -- so the field sees the same writes at every frame rate and a
// rut is a trough, not a row of pits. The whole field is multiplied down on the same tick by `exp(-0.1 · max(heals,
// 0.02) / fade)` a texel, each texel's heals read off the air's response raster at its own world place.
//
// **Float32 because half floats fail here** (research2 §5.1, the design's rule 9): a print fading at the slowest heal
// changes by under one half-float step a tick, and half-float stores truncate toward nought, so a fading print stops dead
// and a slow pit deepens at a rate that hangs on the frame. Blending into float32 needs `EXT_float_blend`, checked when
// the field is made: without it there is no dent field, the prints switch greys and every footprint is today's decal.
//
// Every stamp's depth is already multiplied by the ground's "gives" where it lands (the response raster's), so the
// ground shader reads a depth and nothing else. No vertex moves: the ground is a vertex every 2 m and its physics
// heightfield would disagree with anything that moved it.
import * as THREE from 'three';
import { createFxQuad, FX_CAMERA } from '../../core/fx/pass.ts';
import { AIR_TUNE } from './airTune.ts';
import { DENT_FADE_FRAGMENT, DENT_STAMP_FRAGMENT, DENT_STAMP_VERTEX, AIR_VERTEX } from './airShaders.ts';
import { MEDIUM_BYTE, type AirRaster } from './airRaster.ts';
import type { FluidWindow } from './fluidWindow.ts';
import { DENT_KIND } from './airMath.ts';

/** Stamps a draw: the instanced quads' buffers, made once [ours]. A loop bound and buffer size, never moved live. */
export const DENT_BATCH = 256;
/** One-shot stamps a frame can be owed: x, z, along, across (half extents, metres), cos, sin, depth, kind. */
const ONE_MAX = 128;
const ONE_W = 8;
/** Continuous sources held at once (engines, by their source key) [ours]. */
const SLOT_MAX = 64;
/** The most stamps one source's path is laid with on one tick [ours]. */
const PATH_MOST = 32;
/** A source that moved further than this between two ticks jumped (a teleport): it is laid where it is, not along a line [ours]. */
const PATH_JUMP = 40;

/** The stamps' kinds (kept in `airMath.ts`, so the force API reads them without a cycle through the shaders). */
export { DENT_KIND };

/** Where the square stands and what the last placing left to clear: kept, refilled, nothing made. */
export interface DentSquare {
  /** The square's first texel, world texel units (`floor(x / t)` of its corner). */
  k0x: number;
  k0z: number;
  /** Texels across and metres a texel. */
  n: number;
  t: number;
  /** Metres across. */
  size: number;
  placed: boolean;
  /** This placing cleared everything (the first, a jump past the square, a new size). */
  all: boolean;
  /** Toroidal columns and rows to clear: up to two runs each, [start, count]. */
  cols: Int32Array;
  rows: Int32Array;
  colRuns: number;
  rowRuns: number;
  /** What `placeDentSquareIn` places it by, written by the caller (no number crosses the call): the camera, metres across, texels across. */
  atX: number;
  atZ: number;
  wantSize: number;
  wantN: number;
}

export function newDentSquare(): DentSquare {
  return { k0x: 0, k0z: 0, n: 0, t: 0.5, size: 128, placed: false, all: false, cols: new Int32Array(4), rows: new Int32Array(4), colRuns: 0, rowRuns: 0, atX: 0.5, atZ: 0.5, wantSize: 128, wantN: 2048 };
}

/** A texel index into the toroidal field along one axis: `floor(x / t) mod n`, always 0..n-1. */
export function toroidalTexel(x: number, t: number, n: number): number {
  const k = Math.floor(x / t);
  return ((k % n) + n) % n;
}

/** A toroidal run [start, count) of a world run beginning at texel `from`, into `out` at `at` (one or two runs): answers how many runs. */
function runsOf(from: number, count: number, n: number, out: Int32Array, at: number): number {
  if (count <= 0) return 0;
  const s = ((from % n) + n) % n;
  if (s + count <= n) {
    out[at] = s;
    out[at + 1] = count;
    return 1;
  }
  out[at] = s;
  out[at + 1] = n - s;
  out[at + 2] = 0;
  out[at + 3] = count - (n - s);
  return 2;
}

/**
 * Put the square round the camera (`n` texels over `size` metres), snapped to whole texels, and say what left it: the
 * toroidal columns and rows to clear (the texels that left stand for the ground coming in on the far side), or `all`
 * on the first placing, a new size, or a move past the square. Pure; writes into `sq`.
 */
export function placeDentSquare(sq: DentSquare, camX: number, camZ: number, size: number, n: number): void {
  sq.atX = camX;
  sq.atZ = camZ;
  sq.wantSize = size;
  sq.wantN = n;
  placeDentSquareIn(sq);
}

/** `placeDentSquare` from the square's own `atX`, `atZ`, `wantSize` and `wantN`: the frame's way. */
export function placeDentSquareIn(sq: DentSquare): void {
  const camX = sq.atX;
  const camZ = sq.atZ;
  const size = sq.wantSize;
  const n = sq.wantN;
  const t = size / n;
  const nx = Math.round((camX - size / 2) / t);
  const nz = Math.round((camZ - size / 2) / t);
  sq.colRuns = 0;
  sq.rowRuns = 0;
  sq.all = false;
  if (!sq.placed || sq.n !== n || sq.size !== size) {
    sq.n = n;
    sq.size = size;
    sq.t = t;
    sq.k0x = nx;
    sq.k0z = nz;
    sq.placed = true;
    sq.all = true;
    return;
  }
  const dx = nx - sq.k0x;
  const dz = nz - sq.k0z;
  if (Math.abs(dx) >= n || Math.abs(dz) >= n) {
    sq.k0x = nx;
    sq.k0z = nz;
    sq.all = true;
    return;
  }
  // The columns that left are the ones the new ground comes in on: the old first `dx` when moving +x, the new first
  // `-dx` when moving -x; the same toroidal texels either way.
  if (dx !== 0) sq.colRuns = runsOf(dx > 0 ? sq.k0x : nx, Math.abs(dx), n, sq.cols, 0);
  if (dz !== 0) sq.rowRuns = runsOf(dz > 0 ? sq.k0z : nz, Math.abs(dz), n, sq.rows, 0);
  sq.k0x = nx;
  sq.k0z = nz;
}

/** Whether a world point is inside the square at least `margin` metres from its edge. */
export function insideDentSquare(sq: DentSquare, x: number, z: number, margin: number): boolean {
  if (!sq.placed) return false;
  const x0 = sq.k0x * sq.t;
  const z0 = sq.k0z * sq.t;
  return x >= x0 + margin && z >= z0 + margin && x <= x0 + sq.size - margin && z <= z0 + sq.size - margin;
}

/**
 * The copies a stamp at toroidal uv (`u`, `v`) reaching `e` in uv needs so that it lands whole across a wrap line: each
 * offset (-1, 0 or +1 a side), written as pairs into `out`; answers how many (one to four).
 */
export function stampCopies(u: number, v: number, e: number, out: Int8Array): number {
  let n = 0;
  const xs0 = 0;
  const xs1 = u - e < 0 ? 1 : u + e > 1 ? -1 : 0;
  const ys0 = 0;
  const ys1 = v - e < 0 ? 1 : v + e > 1 ? -1 : 0;
  out[n * 2] = xs0;
  out[n * 2 + 1] = ys0;
  n++;
  if (xs1 !== 0) {
    out[n * 2] = xs1;
    out[n * 2 + 1] = ys0;
    n++;
  }
  if (ys1 !== 0) {
    out[n * 2] = xs0;
    out[n * 2 + 1] = ys1;
    n++;
  }
  if (xs1 !== 0 && ys1 !== 0) {
    out[n * 2] = xs1;
    out[n * 2 + 1] = ys1;
    n++;
  }
  return n;
}

/**
 * The stamp's profile at a local point (the quad's own frame, the stamp's half extents 1): the shader's, for the tests.
 * A bowl `bowl² − 0.30 · exp(−((r − 1.08) / 0.16)²)`, or a footprint's toe and heel [demo `land.html:686-700`].
 */
export function stampProfile(kind: number, lx: number, ly: number): number {
  if (kind < 0.5) {
    const r = Math.sqrt(lx * lx + ly * ly);
    const t = Math.min(1, Math.max(0, r));
    const bowl = 1 - t * t * (3 - 2 * t);
    const lip = Math.exp(-(((r - 1.08) / 0.16) ** 2)) * 0.3;
    return bowl * bowl - lip;
  }
  const toe = 1 - Math.sqrt(((lx - 0.42) / 0.58) ** 2 + (ly / 0.86) ** 2);
  const heel = 1 - Math.sqrt(((lx + 0.55) / 0.42) ** 2 + (ly / 0.7) ** 2);
  const m = Math.min(1, Math.max(0, Math.max(toe, heel)));
  const s = Math.min(1, Math.max(0, m / 0.55));
  return s * s * (3 - 2 * s);
}

/** What the dents counted since they were last read. */
export interface DentCounts {
  oneShots: number;
  laid: number;
  dropped: number;
  slots: number;
  noGive: number;
  /** Stamps not laid because their quad does not lie wholly inside the square (it would wrap onto the far side). */
  offSquare: number;
  ticks: number;
  cleared: number;
}

const freshCounts = (): DentCounts => ({ oneShots: 0, laid: 0, dropped: 0, slots: 0, noGive: 0, offSquare: 0, ticks: 0, cleared: 0 });

/**
 * The dent field: its target, its stamp and fade materials, the square round the camera, the one-shot queue and the
 * continuous sources' slots. The CPU half (`placeDentSquare`, `oneShot`, `gatherArgs`, `buildBatch`) is pure arithmetic
 * over kept arrays, which the node test drives; the GL half is three calls the field makes through its drawer's plain
 * way (a stamp batch is a mesh whose instances three uploads only in a render call of its own).
 */
export class AirDents {
  readonly square = newDentSquare();
  readonly counts: DentCounts = freshCounts();
  /** Where the window stands and the ground under it, to read "gives" and "heals" (set by the field). */
  window: FluidWindow | null = null;
  raster: AirRaster | null = null;

  /** The owed one-shots: x, z, along, across, cos, sin, depth (gives already in), kind. */
  readonly ones = new Float64Array(ONE_MAX * ONE_W);
  oneCount = 0;
  /** A continuous source's gathering this frame, handed in a kept array (no number crosses the call): key, x, z, radius, depth, kind. */
  readonly gq = new Float64Array(6);
  /** The slots: key, the place at the last tick, the place now, radius, depth gathered, kind, and whether gathered since the tick. */
  private readonly slotKey = new Float64Array(SLOT_MAX);
  private readonly slotLast = new Float64Array(SLOT_MAX * 2);
  private readonly slotNow = new Float64Array(SLOT_MAX * 2);
  private readonly slotRadius = new Float64Array(SLOT_MAX);
  private readonly slotDepth = new Float64Array(SLOT_MAX);
  private readonly slotKind = new Uint8Array(SLOT_MAX);
  private readonly slotSeen = new Uint8Array(SLOT_MAX);
  private slotCount = 0;

  /** The batch drawn: (u, v, along / size, across / size) and (cos, sin, depth, kind) an instance. */
  readonly stampA = new Float32Array(DENT_BATCH * 4);
  readonly stampB = new Float32Array(DENT_BATCH * 4);
  batchCount = 0;

  /** The GL half: null in a test that drives the arithmetic alone. */
  target: THREE.WebGLRenderTarget | null = null;
  readonly stampMaterial: THREE.ShaderMaterial;
  readonly fadeMaterial: THREE.ShaderMaterial;
  readonly stampMesh: THREE.Mesh;
  readonly fadeQuad: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly attrA: THREE.InstancedBufferAttribute;
  private readonly attrB: THREE.InstancedBufferAttribute;
  /** The fade's numbers: the square's first texel (x, z), texels across, metres a texel. */
  private readonly fadeSquare = new THREE.Vector4(0, 0, 1, 0.5);
  /** The fade's rate this draw (`0.1 · ticks / fade`) and the floor on heals. */
  private readonly fadeP = new THREE.Vector2(0.004, 0.02);

  constructor(responseUniform: { value: THREE.Texture | null }, colourUniform: { value: THREE.Texture | null }, windowUniform: { value: THREE.Vector4 }) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.attrA = new THREE.InstancedBufferAttribute(this.stampA, 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.attrB = new THREE.InstancedBufferAttribute(this.stampB, 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    g.setAttribute('aStampA', this.attrA);
    g.setAttribute('aStampB', this.attrB);
    g.instanceCount = 0;
    this.geometry = g;
    this.stampMaterial = new THREE.ShaderMaterial({
      name: 'air.dentStamp',
      vertexShader: DENT_STAMP_VERTEX,
      fragmentShader: DENT_STAMP_FRAGMENT,
      uniforms: {},
      // Every stamp adds its depth to what is there.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    });
    this.stampMesh = new THREE.Mesh(g, this.stampMaterial);
    this.stampMesh.frustumCulled = false;
    this.fadeMaterial = new THREE.ShaderMaterial({
      name: 'air.dentFade',
      vertexShader: AIR_VERTEX,
      fragmentShader: DENT_FADE_FRAGMENT,
      uniforms: {
        uResponse: responseUniform,
        uColour: colourUniform,
        uWindow: windowUniform,
        uDentSquare: { value: this.fadeSquare },
        uFadeP: { value: this.fadeP },
      },
      // The field multiplied down by each texel's own rate, blended into itself: one quad, no second target.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    });
    this.fadeQuad = createFxQuad(this.fadeMaterial);
  }

  /** The field's target at `n` texels a side (made the first time; a new size is a new field, every dent gone). Answers whether it was made or resized. */
  ensure(n: number): boolean {
    const t = this.target;
    if (t && t.width === n) return false;
    if (!t) {
      this.target = new THREE.WebGLRenderTarget(n, n, {
        format: THREE.RedFormat,
        type: THREE.FloatType,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        generateMipmaps: false,
      });
      this.target.texture.name = 'air.dents';
    } else t.setSize(n, n);
    this.square.placed = false;
    return true;
  }

  /** The dents' texture as it stands, or null. */
  get texture(): THREE.Texture | null {
    return this.target ? this.target.texture : null;
  }

  /** The ground's "gives" (0 to 3) under a point, by the window's raster: nought outside it, where unknown, or on a liquid. The console's and the tests' way in. */
  givesAt(x: number, z: number): number {
    this.pq[0] = x;
    this.pq[1] = z;
    this.giveHere();
    return this.give;
  }

  /** The give under the point in `pq[0]`, `pq[1]` into `give` (no number crosses the call: the batch's own way). */
  private giveHere(): void {
    this.give = 0;
    const w = this.window;
    const r = this.raster;
    if (!w || !r || !w.placed) return;
    const i = Math.floor((this.pq[0] - w.ox) / w.cell);
    const j = Math.floor((this.pq[1] - w.oz) / w.cell);
    const n = r.n;
    if (i < 0 || j < 0 || i >= n || j >= n) return;
    const k = j * n + i;
    if (!r.known[k] || r.colour[k * 4 + 3] !== MEDIUM_BYTE.land) return;
    this.give = (r.response[k * 4 + 2] / 255) * 3;
  }

  /** A stamp handed to `putQ` (x, z, along, across, cos, sin, depth, kind), whose first two are also `giveHere`'s point. */
  private readonly pq = new Float64Array(8);
  /** What `giveHere` found: the ground's "gives" under the last point asked (0 to 3). Read straight after the call. */
  give = 0.5;
  /**
   * A one-shot stamp handed to `oneShotArgs` in a kept array, so no number crosses the call (a crater from a blast and
   * a footprint are both on a frame's path): x, z, along, across (half extents, metres), cos, sin (the way "along"
   * points in world x and z), depth (metres before the ground's give), kind.
   */
  readonly oq = new Float64Array(8);

  /** The give under (x, z) into `give`, read straight after (the field's own way to ask it on a footstep). */
  giveAt(): void {
    this.pq[0] = this.oq[0];
    this.pq[1] = this.oq[1];
    this.giveHere();
  }

  /** `oneShotArgs` with its numbers handed as arguments: the console's and the tests' way in. */
  oneShot(x: number, z: number, along: number, across: number, cosA: number, sinA: number, depth: number, kind: number): boolean {
    const q = this.oq;
    q[0] = x;
    q[1] = z;
    q[2] = along;
    q[3] = across;
    q[4] = cosA;
    q[5] = sinA;
    q[6] = depth;
    q[7] = kind;
    return this.oneShotArgs();
  }

  /**
   * A one-shot stamp owed to this frame's draw, read from `oq`: its middle, its half extents along and across (metres),
   * the way "along" points (cos, sin in world x and z), its depth in metres before the ground's give, its kind. Its depth
   * is taken by the ground's "gives" where it lands now; nothing at all where that is nought. Answers whether it is owed.
   */
  oneShotArgs(): boolean {
    const q = this.oq;
    for (let i = 0; i < 7; i++) if (!Number.isFinite(q[i])) return false;
    if (!(q[6] > 0) || !(q[2] > 0) || !(q[3] > 0)) return false;
    if (!this.wholeInside(q)) {
      this.counts.offSquare++;
      return false;
    }
    this.pq[0] = q[0];
    this.pq[1] = q[1];
    this.giveHere();
    const give = this.give;
    if (!(give > 0)) {
      this.counts.noGive++;
      return false;
    }
    if (this.oneCount >= ONE_MAX) {
      this.counts.dropped++;
      return false;
    }
    const k = this.oneCount * ONE_W;
    const o = this.ones;
    o[k] = q[0];
    o[k + 1] = q[1];
    o[k + 2] = q[2];
    o[k + 3] = q[3];
    o[k + 4] = q[4];
    o[k + 5] = q[5];
    o[k + 6] = q[6] * give;
    o[k + 7] = q[7] > 0.5 ? DENT_KIND.foot : DENT_KIND.bowl;
    this.oneCount++;
    this.counts.oneShots++;
    return true;
  }

  /**
   * A continuous source's frame, handed in `gq` (key, x, z, radius, depth this frame, kind): summed into its slot, whose
   * place now is this frame's; laid on the next tick along the path from where it was at the last one.
   */
  gatherArgs(): void {
    const q = this.gq;
    const key = q[0];
    for (let i = 0; i < 6; i++) if (!Number.isFinite(q[i])) return;
    if (!(q[4] > 0) || !(q[3] > 0)) return;
    let s = -1;
    for (let i = 0; i < this.slotCount; i++) {
      if (this.slotKey[i] === key) {
        s = i;
        break;
      }
    }
    if (s < 0) {
      if (this.slotCount >= SLOT_MAX) {
        this.counts.dropped++;
        return;
      }
      s = this.slotCount++;
      this.slotKey[s] = key;
      this.slotLast[s * 2] = q[1];
      this.slotLast[s * 2 + 1] = q[2];
      this.slotDepth[s] = 0;
    }
    this.slotNow[s * 2] = q[1];
    this.slotNow[s * 2 + 1] = q[2];
    this.slotRadius[s] = q[3];
    this.slotDepth[s] += q[4];
    this.slotKind[s] = q[5] > 0.5 ? 1 : 0;
    this.slotSeen[s] = 1;
  }

  /**
   * Whether a stamp's whole quad (x, z, along, across in `q`: its half extents times the quad's 1.4, in any turn) lies inside the placed square.
   * The field is toroidal: a stamp reaching past the square's edge would be written onto the texels that stand for the
   * ground at its far side, a ghost there until the square moved over it, so it is not laid at all (a crater or a pit
   * more than 60 m off; a footprint is asked for only 4 m inside, `dentStep`).
   */
  private wholeInside(q: Float64Array): boolean {
    const sq = this.square;
    if (!sq.placed) return false;
    const x = q[0];
    const z = q[1];
    const reach = 1.42 * Math.sqrt(q[2] * q[2] + q[3] * q[3]);
    const x0 = sq.k0x * sq.t;
    const z0 = sq.k0z * sq.t;
    return x - reach >= x0 && z - reach >= z0 && x + reach <= x0 + sq.size && z + reach <= z0 + sq.size;
  }

  /** The stamp in `pq` into the batch, with the copies a wrap line asks for; dropped and counted when the batch is full or it does not lie wholly inside the square. */
  private putQ(): void {
    const q = this.pq;
    if (!this.wholeInside(q)) {
      this.counts.offSquare++;
      return;
    }
    const size = this.square.size;
    const fx = q[0] / size;
    const fz = q[1] / size;
    const u = fx - Math.floor(fx);
    const v = fz - Math.floor(fz);
    const along = q[2];
    const across = q[3];
    // The quad reaches 1.4 of its half extents from its middle, in any turn.
    const reach = (1.42 * Math.sqrt(along * along + across * across)) / size;
    const cu = u - reach < 0 ? 1 : u + reach > 1 ? -1 : 0;
    const cv = v - reach < 0 ? 1 : v + reach > 1 ? -1 : 0;
    const n = cu !== 0 && cv !== 0 ? 4 : cu !== 0 || cv !== 0 ? 2 : 1;
    if (this.batchCount + n > DENT_BATCH) {
      this.counts.dropped++;
      return;
    }
    // The copies `stampCopies` names, in its order: the stamp itself, then across x, across z, across both.
    for (let c = 0; c < 4; c++) {
      const ox = c === 1 || c === 3 ? cu : 0;
      const oz = c === 2 || c === 3 ? cv : 0;
      if ((c === 1 && cu === 0) || (c === 2 && cv === 0) || (c === 3 && (cu === 0 || cv === 0))) continue;
      const k = this.batchCount * 4;
      this.stampA[k] = u + ox;
      this.stampA[k + 1] = v + oz;
      this.stampA[k + 2] = along / size;
      this.stampA[k + 3] = across / size;
      this.stampB[k] = q[4];
      this.stampB[k + 1] = q[5];
      this.stampB[k + 2] = q[6];
      this.stampB[k + 3] = q[7];
      this.batchCount++;
    }
    this.counts.laid++;
  }

  /**
   * This frame's batch: the one-shots owed, then -- on a frame that crossed a tick of the 10 Hz clock -- every source's
   * path since the last tick, spaced at `prints.spacing` of its radius, each stamp its share of the depth gathered and
   * taken by the ground's give where it lands. A source not gathered since the last tick is let go. Answers how many
   * instances the batch holds; the one-shots are spent.
   */
  buildBatch(ticks: number): number {
    this.batchCount = 0;
    if (!this.square.placed) {
      this.oneCount = 0;
      return 0;
    }
    const o = this.ones;
    const q = this.pq;
    for (let i = 0; i < this.oneCount; i++) {
      const k = i * ONE_W;
      for (let c = 0; c < ONE_W; c++) q[c] = o[k + c];
      this.putQ();
    }
    this.oneCount = 0;
    if (ticks <= 0) return this.batchCount;
    const P = AIR_TUNE.prints;
    let keep = 0;
    for (let s = 0; s < this.slotCount; s++) {
      const depth = this.slotDepth[s];
      const r = this.slotRadius[s];
      const lx = this.slotLast[s * 2];
      const lz = this.slotLast[s * 2 + 1];
      const nx = this.slotNow[s * 2];
      const nz = this.slotNow[s * 2 + 1];
      if (depth > 0 && r > 0) {
        const dx = nx - lx;
        const dz = nz - lz;
        const d = Math.sqrt(dx * dx + dz * dz);
        const spacing = r * (P.spacing > 0.05 ? P.spacing : 0.05);
        let steps = d > PATH_JUMP ? 1 : Math.ceil(d / spacing);
        if (steps < 1) steps = 1;
        if (steps > PATH_MOST) steps = PATH_MOST;
        const share = depth / steps;
        for (let i = 0; i < steps; i++) {
          const f = d > PATH_JUMP ? 1 : (i + 1) / steps;
          q[0] = lx + dx * f;
          q[1] = lz + dz * f;
          this.giveHere();
          if (!(this.give > 0)) {
            this.counts.noGive++;
            continue;
          }
          q[2] = r;
          q[3] = r;
          q[4] = 1;
          q[5] = 0;
          q[6] = share * this.give;
          q[7] = this.slotKind[s];
          this.putQ();
        }
      }
      // A source not gathered since the last tick is let go; the rest keep their place for the next tick's path.
      if (!this.slotSeen[s]) continue;
      this.slotKey[keep] = this.slotKey[s];
      this.slotLast[keep * 2] = nx;
      this.slotLast[keep * 2 + 1] = nz;
      this.slotNow[keep * 2] = nx;
      this.slotNow[keep * 2 + 1] = nz;
      this.slotRadius[keep] = r;
      this.slotDepth[keep] = 0;
      this.slotKind[keep] = this.slotKind[s];
      this.slotSeen[keep] = 0;
      keep++;
    }
    this.slotCount = keep;
    this.counts.slots = keep;
    return this.batchCount;
  }

  /**
   * Drop what is owed on a frame that keeps no marks (nothing reads the air, the prints are off, the field does nothing
   * here): the one-shots, and the sources' gathering, so a pit gathered before a door is never laid long after.
   */
  dropOwed(): void {
    this.oneCount = 0;
    this.slotCount = 0;
  }

  /** Drop everything owed (a new world, a jump, the prints turned off): the field itself is cleared at its next placing. */
  clear(): void {
    this.oneCount = 0;
    this.slotCount = 0;
    this.batchCount = 0;
    this.square.placed = false;
  }

  /**
   * The frame's draws into the field, each a render call of its own (the caller runs this its drawer's plain way): the
   * strips that left the square cleared (or all of it), the batch, and on a tick the fade. `renderer`'s clear colour is
   * set to nought here; the caller puts it back.
   */
  draw(renderer: THREE.WebGLRenderer, ticks: number): number {
    const t = this.target;
    if (!t) return 0;
    let draws = 0;
    const sq = this.square;
    renderer.setClearColor(0x000000, 0);
    if (sq.all) {
      t.scissorTest = false;
      renderer.setRenderTarget(t);
      renderer.clear(true, false, false);
      this.counts.cleared++;
      draws++;
      sq.all = false;
    } else if (sq.colRuns || sq.rowRuns) {
      const n = sq.n;
      for (let i = 0; i < sq.colRuns; i++) draws += this.clearRect(renderer, t, sq.cols[i * 2], 0, sq.cols[i * 2 + 1], n);
      for (let i = 0; i < sq.rowRuns; i++) draws += this.clearRect(renderer, t, 0, sq.rows[i * 2], n, sq.rows[i * 2 + 1]);
      sq.colRuns = 0;
      sq.rowRuns = 0;
    }
    const count = this.buildBatch(ticks);
    if (count > 0) {
      this.geometry.instanceCount = count;
      this.attrA.needsUpdate = true;
      this.attrB.needsUpdate = true;
      renderer.setRenderTarget(t);
      renderer.render(this.stampMesh, FX_CAMERA);
      draws++;
    }
    if (ticks > 0) {
      // Written field by field: `set` hands its four numbers across a call, and the texel's metres are a fraction.
      const fs = this.fadeSquare;
      fs.x = sq.k0x;
      fs.y = sq.k0z;
      fs.z = sq.n;
      fs.w = sq.t;
      const fade = AIR_TUNE.prints.fade;
      this.fadeP.x = (0.1 * ticks) / (fade > 0.1 ? fade : 0.1);
      renderer.setRenderTarget(t);
      renderer.render(this.fadeQuad, FX_CAMERA);
      this.counts.ticks += ticks;
      draws++;
    }
    return draws;
  }

  /** A scissored clear of one rectangle of texels (no program: the renderer's own clear). */
  private clearRect(renderer: THREE.WebGLRenderer, t: THREE.WebGLRenderTarget, x: number, y: number, w: number, h: number): number {
    t.scissor.set(x, y, w, h);
    t.scissorTest = true;
    try {
      renderer.setRenderTarget(t);
      renderer.clear(true, false, false);
    } finally {
      t.scissorTest = false;
    }
    this.counts.cleared++;
    return 1;
  }

  /** The counts as they stand, and starts them again. */
  takeCounts(out: DentCounts): DentCounts {
    Object.assign(out, this.counts);
    Object.assign(this.counts, freshCounts());
    this.counts.slots = this.slotCount;
    return out;
  }

  /** The continuous sources held now (the console's). */
  get slots(): number {
    return this.slotCount;
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.geometry.dispose();
    this.stampMaterial.dispose();
    this.fadeMaterial.dispose();
  }
}
