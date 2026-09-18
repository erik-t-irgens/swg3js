// What is overhead around the camera: a grid of rays cast straight down, 1.5 m apart over a 72 m
// square that follows the camera, giving the top surface of every column (a roof, an eave, the
// ground, a lake's surface). Falling weather dies below that top, on the CPU and per fragment, so
// rain stops at the eave instead of falling through a cantina's roof, and the same heights are a
// texture the shaders read.
//
// A few dozen rays a frame: the cells the camera has just brought into the square first, nearest
// first, then round and round the whole grid, so a building that streams in is found within a
// third of a second. No ray is cast until the physics world has stepped since the last reset,
// because a scene query sees nothing that was added since the last step.
import * as THREE from 'three';
import type { Physics, RAPIER } from '../core/physics';

export const ROOF_CELLS = 48;
/** Metres: a 72 m square around the camera. */
export const ROOF_CELL = 1.5;
/** Rays start this far above the higher of the camera and the ground. */
export const ROOF_TOP = 120;
export const ROOF_REACH = 400;
/** Stands for "no surface known here". */
export const ROOF_OPEN = -1e9;
/**
 * Not a building's rooms: cells can reach outside the shell they are drawn in. Rapier interaction
 * groups, `groups(Group.all, Group.all & ~Group.interior)` from core/physics written out (membership
 * 0xffff in the high half, every group but interior's 0x0004 in the low), so this module loads in
 * node without the physics engine; weather.test.ts checks the number against those constants.
 */
export const ROOF_GROUPS = ((0xffff << 16) | (0xffff & ~0x0004)) >>> 0;

export interface RoofSources {
  /** The terrain's height from cached tiles, or null. */
  groundAt(x: number, z: number): number | null;
  /** A lake's or the sea's surface, or -Infinity. */
  waterAt(x: number, z: number): number;
  /** Which colliders count. */
  include(c: RAPIER.Collider): boolean;
}

const N = ROOF_CELLS;
const CELLS = N * N;

export class RoofGrid {
  /** Top surface height per cell, row = z index, column = x index: max(ray hit or terrain guess, water surface). */
  readonly heights = new Float32Array(CELLS);
  /** R32F, NearestFilter, flipY false: the same heights for the shaders (texel (x, z)). */
  readonly texture: THREE.DataTexture;
  /** uRoofGrid: origin x, origin z (the corner of cell 0,0), cell size, cells per side (0 until the grid has a place). */
  readonly grid = new THREE.Vector4(0, 0, ROOF_CELL, 0);
  /** Cells whose heights are a guess, not a trusted ray's. */
  private readonly stale = new Uint8Array(CELLS);
  /** Cells not cast since they came into the square (or since a reset): cast before the round robin. */
  private readonly pending = new Uint8Array(CELLS);
  /** The ground under each cell as last cast (ROOF_OPEN when unknown), for counting covered cells. */
  private readonly ground = new Float32Array(CELLS);
  /** Scratch for shifting the grid in place. */
  private readonly shiftHeights = new Float32Array(CELLS);
  private readonly shiftStale = new Uint8Array(CELLS);
  private readonly shiftPending = new Uint8Array(CELLS);
  private readonly shiftGround = new Float32Array(CELLS);
  /** Cell indices to cast first, nearest first; `queueHead` is the next to take. */
  private readonly queue = new Int32Array(CELLS);
  private queueLength = 0;
  private queueHead = 0;
  /** Cell offsets from the centre cell (dx, dz packed), nearest first, for the queue and the round robin. */
  private readonly spiral = new Int32Array(CELLS * 2);
  private robin = 0;
  /** The world cell (in cells) of the grid's corner, or NaN before it has a place. */
  private originCx = Number.NaN;
  private originCz = Number.NaN;
  /** physics.steps when the grid was last reset: casts are trusted only after a later step. */
  private resetSteps = -1;
  /** Rays cast last update, for the console. */
  rays = 0;

  /** A plain field, not a parameter property: node's type stripping (the tests) cannot read those. */
  private readonly physics: Physics;

  constructor(physics: Physics) {
    this.physics = physics;
    this.heights.fill(ROOF_OPEN);
    this.ground.fill(ROOF_OPEN);
    this.texture = new THREE.DataTexture(this.heights, N, N, THREE.RedFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;
    // Offsets from the centre cell, nearest first: the order new cells are cast in.
    const order: [number, number, number][] = [];
    const half = N / 2;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) order.push([x - half, z - half, (x - half + 0.5) ** 2 + (z - half + 0.5) ** 2]);
    order.sort((a, b) => a[2] - b[2]);
    order.forEach(([dx, dz], i) => {
      this.spiral[i * 2] = dx;
      this.spiral[i * 2 + 1] = dz;
    });
    this.reset();
  }

  /** Forget everything: refill from nothing, queue every cell, and wait for a physics step before casting. */
  reset(): void {
    this.originCx = Number.NaN;
    this.originCz = Number.NaN;
    this.heights.fill(ROOF_OPEN);
    this.ground.fill(ROOF_OPEN);
    this.stale.fill(1);
    this.pending.fill(1);
    this.queueLength = 0;
    this.queueHead = 0;
    this.robin = 0;
    this.grid.w = 0;
    this.resetSteps = this.physics.steps;
    this.texture.needsUpdate = true;
  }

  /** The top surface at x, z (ROOF_OPEN outside the grid). Nearest cell: floor((x - origin) / cell). */
  topAt(x: number, z: number): number {
    if (this.grid.w === 0) return ROOF_OPEN;
    const ix = Math.floor((x - this.grid.x) / ROOF_CELL);
    const iz = Math.floor((z - this.grid.y) / ROOF_CELL);
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) return ROOF_OPEN;
    return this.heights[iz * N + ix];
  }

  /** Cast one cell's ray and write what it found. */
  private cast(i: number, centerY: number, src: RoofSources): void {
    const ix = i % N;
    const iz = (i - ix) / N;
    const cx = this.grid.x + (ix + 0.5) * ROOF_CELL;
    const cz = this.grid.y + (iz + 0.5) * ROOF_CELL;
    const g = src.groundAt(cx, cz);
    const fromY = Math.max(centerY, g ?? centerY) + ROOF_TOP;
    const hit = this.physics.topSurface(cx, cz, fromY, ROOF_REACH, ROOF_GROUPS, src.include);
    const water = src.waterAt(cx, cz);
    this.ground[i] = g ?? ROOF_OPEN;
    this.pending[i] = 0;
    if (hit !== null) {
      this.heights[i] = Math.max(hit, water);
      this.stale[i] = 0;
    } else {
      // Nothing in reach, or a collider the query structure has not seen yet: the terrain's word
      // for now, and the round robin comes back to it.
      this.heights[i] = Math.max(g ?? ROOF_OPEN, water);
      this.stale[i] = 1;
    }
  }

  /** Queue every pending cell, nearest the centre first. */
  private requeue(): void {
    this.queueLength = 0;
    this.queueHead = 0;
    const half = N / 2;
    for (let k = 0; k < CELLS; k++) {
      const ix = this.spiral[k * 2] + half;
      const iz = this.spiral[k * 2 + 1] + half;
      const i = iz * N + ix;
      if (this.pending[i]) this.queue[this.queueLength++] = i;
    }
  }

  /**
   * Follow a point. When its cell moves by less than half the grid, shift the kept heights and mark
   * the new cells stale with the terrain's guess (or ROOF_OPEN) and queue them nearest first; a move
   * of half the grid or more is a reset. Then, only if physics has stepped since the last reset,
   * cast up to `budget` rays: queued cells first, then the round robin. Uploads the texture when
   * anything changed.
   */
  update(center: THREE.Vector3, budget: number, src: RoofSources): void {
    this.rays = 0;
    const ccx = Math.floor(center.x / ROOF_CELL) - N / 2;
    const ccz = Math.floor(center.z / ROOF_CELL) - N / 2;
    let changed = false;
    if (Number.isNaN(this.originCx) || Math.abs(ccx - this.originCx) >= N / 2 || Math.abs(ccz - this.originCz) >= N / 2) {
      if (!Number.isNaN(this.originCx)) this.reset();
      this.originCx = ccx;
      this.originCz = ccz;
      this.grid.set(ccx * ROOF_CELL, ccz * ROOF_CELL, ROOF_CELL, N);
      // Everything a guess until its ray: the terrain where it is known.
      for (let i = 0; i < CELLS; i++) {
        const ix = i % N;
        const iz = (i - ix) / N;
        const g = src.groundAt(this.grid.x + (ix + 0.5) * ROOF_CELL, this.grid.y + (iz + 0.5) * ROOF_CELL);
        this.heights[i] = g ?? ROOF_OPEN;
        this.ground[i] = g ?? ROOF_OPEN;
        this.stale[i] = 1;
        this.pending[i] = 1;
      }
      this.requeue();
      changed = true;
    } else if (ccx !== this.originCx || ccz !== this.originCz) {
      this.shift(ccx - this.originCx, ccz - this.originCz, src);
      this.originCx = ccx;
      this.originCz = ccz;
      this.requeue();
      changed = true;
    }
    if (this.physics.steps > this.resetSteps) {
      let left = budget;
      while (left > 0 && this.queueHead < this.queueLength) {
        const i = this.queue[this.queueHead++];
        if (!this.pending[i]) continue;
        this.cast(i, center.y, src);
        left--;
        this.rays++;
      }
      const half = N / 2;
      while (left > 0) {
        const k = this.robin;
        this.robin = (this.robin + 1) % CELLS;
        const i = (this.spiral[k * 2 + 1] + half) * N + this.spiral[k * 2] + half;
        this.cast(i, center.y, src);
        left--;
        this.rays++;
      }
      if (this.rays) changed = true;
    }
    if (changed) this.texture.needsUpdate = true;
  }

  /** Move the kept cells by whole cells (the grid's corner moved by dx, dz), guessing the new ones from the terrain. */
  private shift(dx: number, dz: number, src: RoofSources): void {
    this.grid.x = (this.originCx + dx) * ROOF_CELL;
    this.grid.y = (this.originCz + dz) * ROOF_CELL;
    this.grid.z = ROOF_CELL;
    this.grid.w = N;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const i = iz * N + ix;
        const ox = ix + dx;
        const oz = iz + dz;
        if (ox >= 0 && oz >= 0 && ox < N && oz < N) {
          const o = oz * N + ox;
          this.shiftHeights[i] = this.heights[o];
          this.shiftStale[i] = this.stale[o];
          this.shiftPending[i] = this.pending[o];
          this.shiftGround[i] = this.ground[o];
        } else {
          const g = src.groundAt(this.grid.x + (ix + 0.5) * ROOF_CELL, this.grid.y + (iz + 0.5) * ROOF_CELL);
          this.shiftHeights[i] = g ?? ROOF_OPEN;
          this.shiftGround[i] = g ?? ROOF_OPEN;
          this.shiftStale[i] = 1;
          this.shiftPending[i] = 1;
        }
      }
    }
    this.heights.set(this.shiftHeights);
    this.stale.set(this.shiftStale);
    this.pending.set(this.shiftPending);
    this.ground.set(this.shiftGround);
  }

  describe(): { origin: [number, number]; rays: number; stale: number; covered: number; waitingForStep: boolean } {
    let stale = 0;
    let covered = 0;
    for (let i = 0; i < CELLS; i++) {
      if (this.stale[i]) stale++;
      else if (this.ground[i] > ROOF_OPEN && this.heights[i] > this.ground[i] + 1) covered++;
    }
    const placed = this.grid.w > 0;
    return {
      origin: [placed ? Math.round(this.grid.x * 10) / 10 : NaN, placed ? Math.round(this.grid.y * 10) / 10 : NaN],
      rays: this.rays,
      stale,
      covered,
      waitingForStep: this.physics.steps <= this.resetSteps,
    };
  }

  dispose(): void {
    this.texture.dispose();
  }
}
