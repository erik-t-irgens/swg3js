import * as THREE from 'three';
import type { PlanetDef } from '../data/planets';
import { FBM, hash2 } from './noise';
import type { FarGrid, SwgTerrain } from './swgTerrain';

export const CHUNK_SIZE = 64;

/** Level ground of height h within radius r, blended smoothly at the edge. */
export interface FlattenZone { x: number; z: number; r: number; h: number }

/** A known ground height from game data (an object's origin), pulling the terrain toward it nearby. */
export interface Anchor { x: number; z: number; y: number; r: number }

const ANCHOR_CELL = 256;
const reachOf = (a: Anchor) => a.r * 2.5 + 40;
export const CHUNK_RES = 32;

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

export class Terrain {
  private readonly fbm: FBM;
  private readonly detail: FBM;
  private readonly low: THREE.Color;
  private readonly mid: THREE.Color;
  private readonly high: THREE.Color;
  private readonly slope: THREE.Color;
  private readonly shore: THREE.Color;
  minH: number;
  /** Below this the world is considered left (falling through): players reset, creatures respawn. */
  floor: number;
  maxH: number;
  waterLevel: number;
  readonly flattenZones: FlattenZone[] = [];
  /** Real SWG terrain for this planet when a converted pack provides it; replaces the noise below. */
  swg: SwgTerrain | null = null;
  private readonly anchorCells = new Map<string, Anchor[]>();
  private anchorCount = 0;

  constructor(readonly planet: PlanetDef) {
    this.fbm = new FBM(planet.seed);
    this.detail = new FBM(planet.seed * 31 + 7);
    this.low = new THREE.Color(planet.palette.low);
    this.mid = new THREE.Color(planet.palette.mid);
    this.high = new THREE.Color(planet.palette.high);
    this.slope = new THREE.Color(planet.palette.slope);
    this.shore = new THREE.Color(planet.palette.shore);
    this.minH = planet.terrain.base - planet.terrain.amplitude;
    this.floor = this.minH - 30;
    this.maxH = planet.terrain.base + planet.terrain.amplitude;
    this.waterLevel = planet.water ? planet.water.level : -Infinity;
  }

  /** Switch to the planet's real terrain generator. Heights, water and colour bands follow it from now on. */
  attachSwg(swg: SwgTerrain): void {
    this.swg = swg;
    this.waterLevel = swg.waterLevel;
    // Colour bands span the heights SWG worlds actually use rather than the noise planet's range.
    this.minH = Math.max(this.waterLevel, -20);
    this.maxH = this.minH + 140;
    // Real planets go far below zero (Naboo's sea sits 200 m under the Theed plateau).
    this.floor = -700;
  }

  /** Water surface at a point: lakes and pools count as well as the global water level. */
  waterHeightAt(x: number, z: number): number {
    return this.swg ? this.swg.waterAt(x, z) : this.waterLevel;
  }

  detachSwg(): void {
    this.swg?.dispose();
    this.swg = null;
    this.waterLevel = this.planet.water ? this.planet.water.level : -Infinity;
    this.floor = this.planet.terrain.base - this.planet.terrain.amplitude - 30;
  }

  /**
   * Make sure the ground under a chunk can be sampled. With SWG terrain this means its pole
   * grids are cached; when they are not, they are queued on the worker (or generated at once
   * when `sync`) and false is returned so the caller retries next frame.
   */
  prepareChunk(cx: number, cz: number, sync: boolean): boolean {
    if (!this.swg) return true;
    const step = CHUNK_SIZE / CHUNK_RES;
    return this.swg.prepareArea(cx * CHUNK_SIZE - step, cz * CHUNK_SIZE - step, CHUNK_SIZE + 2 * step, sync);
  }

  /** Ground height from data already generated, or null when nothing covers the point yet. */
  heightIfCached(x: number, z: number, farSize: number, farRes: number): number | null {
    if (this.swg) return this.swg.heightIfCached(x, z, farSize, farRes);
    return this.heightAt(x, z);
  }

  heightAt(x: number, z: number): number {
    if (this.swg) return this.swg.heightAt(x, z);
    let h = this.rawHeightAt(x, z);
    for (const zone of this.flattenZones) {
      const d = Math.hypot(x - zone.x, z - zone.z);
      if (d >= zone.r) continue;
      let t = 1 - d / zone.r;
      t = t * t * (3 - 2 * t);
      h += (zone.h - h) * t;
    }
    if (this.anchorCount > 0) {
      const list = this.anchorCells.get(`${Math.floor(x / ANCHOR_CELL)},${Math.floor(z / ANCHOR_CELL)}`);
      if (list) {
        let sumW = 0;
        let sumY = 0;
        let maxT = 0;
        for (const a of list) {
          const reach = reachOf(a);
          const d = Math.hypot(x - a.x, z - a.z);
          if (d >= reach) continue;
          let t = 1 - d / reach;
          t = t * t * (3 - 2 * t);
          const w = t * (a.r + 4);
          sumW += w;
          sumY += w * a.y;
          if (t > maxT) maxT = t;
        }
        if (sumW > 0) h += (sumY / sumW - h) * maxT;
      }
    }
    return h;
  }

  /** Register a ground-height anchor; it influences terrain within reachOf(a). */
  addAnchor(a: Anchor): void {
    const reach = reachOf(a);
    const x0 = Math.floor((a.x - reach) / ANCHOR_CELL);
    const x1 = Math.floor((a.x + reach) / ANCHOR_CELL);
    const z0 = Math.floor((a.z - reach) / ANCHOR_CELL);
    const z1 = Math.floor((a.z + reach) / ANCHOR_CELL);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = `${cx},${cz}`;
        const list = this.anchorCells.get(key);
        if (list) list.push(a);
        else this.anchorCells.set(key, [a]);
      }
    }
    this.anchorCount++;
  }

  /** Terrain height before any flattening. */
  rawHeightAt(x: number, z: number): number {
    if (this.swg) return this.swg.heightAt(x, z);
    const t = this.planet.terrain;
    const f = t.frequency;
    let v = this.fbm.fbm(x * f, z * f, t.octaves);
    if (t.ridged > 0) {
      const r = this.fbm.ridged(x * f * 0.7 + 100, z * f * 0.7 + 100, 4);
      v = v * (1 - t.ridged) + (r * 2 - 1) * t.ridged;
    }
    if (t.flatten !== 1) v = Math.sign(v) * Math.pow(Math.abs(v), t.flatten);
    const d = t.detail > 0 ? this.detail.fbm(x * 0.09, z * 0.09, 2) * t.detail : 0;
    return t.base + v * t.amplitude + d;
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 0.5;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return out.set(-dx, 1, -dz).normalize();
  }

  /** Large-scale density field used for vegetation clumping, in [0, 1]. */
  densityAt(x: number, z: number): number {
    return this.detail.fbm(x * 0.012 + 50, z * 0.012 - 50, 2) * 0.5 + 0.5;
  }

  private colorAt(h: number, ny: number, x: number, z: number, out: THREE.Color): void {
    // Flat ground (no height range) takes the middle of the palette rather than dividing by nothing.
    const span = this.maxH - this.minH;
    const t = span > 1e-6 ? Math.min(1, Math.max(0, (h - this.minH) / span)) : 0.5;
    if (t < 0.5) tmpA.copy(this.low).lerp(this.mid, t * 2);
    else tmpA.copy(this.mid).lerp(this.high, (t - 0.5) * 2);

    if (this.planet.water) {
      const shoreT = Math.min(1, Math.max(0, 1 - (h - this.waterLevel) / 2.5));
      tmpA.lerp(this.shore, shoreT * shoreT);
    }

    const steep = Math.min(1, Math.max(0, (0.72 - ny) / 0.32));
    tmpA.lerp(this.slope, steep);

    const grain = 0.9 + 0.14 * hash2(Math.floor(x * 2), Math.floor(z * 2), this.planet.seed);
    out.copy(tmpA).multiplyScalar(grain);
  }

  buildChunk(cx: number, cz: number): { geometry: THREE.BufferGeometry; heights: Float32Array } {
    const r = this.buildGrid(cx * CHUNK_SIZE, cz * CHUNK_SIZE, CHUNK_SIZE, CHUNK_RES, { skirt: 8, wantHeights: true });
    return { geometry: r.geometry, heights: r.heights! };
  }

  /**
   * Coarse distant tile, dropped slightly so near chunks win where they overlap. With SWG
   * terrain the samples come from the worker; null means not generated yet (retry later).
   */
  buildFarTile(tx: number, tz: number, size: number, res: number, sync = true): THREE.BufferGeometry | null {
    let hs: FarGrid | undefined;
    if (this.swg) {
      const grid = this.swg.farGrid(tx * size, tz * size, size, res, sync);
      if (!grid) return null;
      hs = grid;
    }
    const geometry = this.buildGrid(tx * size, tz * size, size, res, { skirt: 0, yOffset: -2.5, wantHeights: false }, hs).geometry;
    if (geometry.userData.fullIndex) return geometry;
    // Remember the full index so quads under detailed chunks can be cut out (World.refreshFarTile).
    geometry.userData = { fullIndex: geometry.getIndex()!.array.slice(), n: res, ox: tx * size, oz: tz * size, step: size / res };
    return geometry;
  }

  releaseFarTile(tx: number, tz: number, size: number, res: number): void {
    this.swg?.releaseFarGrid(tx * size, tz * size, size, res);
  }

  /** Drop cached SWG grids far from a point (in game chunks). */
  evict(center: THREE.Vector3, chunkRadius: number): void {
    this.swg?.evict(center.x, center.z, Math.ceil((chunkRadius * CHUNK_SIZE) / this.swg.sampler.blockWidth) + 2);
  }

  private buildGrid(ox: number, oz: number, size: number, n: number, opts: { skirt: number; yOffset?: number; wantHeights: boolean }, samples?: FarGrid): { geometry: THREE.BufferGeometry; heights: Float32Array | null } {
    const step = size / n;
    const yOff = opts.yOffset ?? 0;
    const w = n + 3;
    let hs: Float32Array;
    // Shader family per sample when the planet has real terrain: the ground texture painted there.
    let fams: Int32Array | null = null;
    if (samples && samples.heights.length === w * w) {
      hs = samples.heights;
      fams = samples.shaders;
    } else {
      hs = new Float32Array(w * w);
      const swg = this.swg;
      if (swg) fams = new Int32Array(w * w);
      for (let j = 0; j < w; j++) {
        for (let i = 0; i < w; i++) {
          const x = ox + (i - 1) * step;
          const z = oz + (j - 1) * step;
          hs[j * w + i] = this.heightAt(x, z);
          if (fams && swg) fams[j * w + i] = swg.shaderAt(x, z);
        }
      }
    }

    let physHeights: Float32Array | null = null;
    if (opts.wantHeights) {
      // Physics copy: column-major, column = x index, row = z index.
      physHeights = new Float32Array((n + 1) * (n + 1));
      for (let xi = 0; xi <= n; xi++) {
        for (let zi = 0; zi <= n; zi++) physHeights[xi * (n + 1) + zi] = hs[(zi + 1) * w + (xi + 1)];
      }
    }

    const gridCount = (n + 1) * (n + 1);
    const skirtCount = opts.skirt > 0 ? 4 * (n + 1) : 0;
    const skirtSource = new Int32Array(skirtCount).fill(-1);
    const vcount = gridCount + skirtCount;
    const positions = new Float32Array(vcount * 3);
    const normals = new Float32Array(vcount * 3);
    const colors = new Float32Array(vcount * 3);
    let p = 0;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const hi = (j + 1) * w + (i + 1);
        const h = hs[hi];
        const dx = (hs[hi + 1] - hs[hi - 1]) / (2 * step);
        const dz = (hs[hi + w] - hs[hi - w]) / (2 * step);
        const len = Math.hypot(dx, 1, dz);
        const nx = -dx / len;
        const ny = 1 / len;
        const nz = -dz / len;
        const x = ox + i * step;
        const z = oz + j * step;
        positions[p] = x;
        positions[p + 1] = h + yOff;
        positions[p + 2] = z;
        normals[p] = nx;
        normals[p + 1] = ny;
        normals[p + 2] = nz;
        this.colorAt(h, ny, x, z, tmpB);
        colors[p] = tmpB.r;
        colors[p + 1] = tmpB.g;
        colors[p + 2] = tmpB.b;
        p += 3;
      }
    }

    // SWG ground is fans around each tile's centre pole: split every cell along the diagonal
    // that touches a centre pole so collision and rendering match the original game exactly.
    const swg = this.swg;
    const fanAligned = !!swg && Math.abs(step - swg.tileWidth * 0.5) < 1e-6;
    const indices: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        if (fanAligned && (swg!.isTileCentre(ox + i * step, oz + j * step) || swg!.isTileCentre(ox + (i + 1) * step, oz + (j + 1) * step))) indices.push(a, c, d, a, d, b);
        else indices.push(a, c, b, b, c, d);
      }
    }

    if (opts.skirt > 0) {
      // Skirts hang from each edge so coarse far tiles never show through gaps.
      const edges: number[][] = [[], [], [], []];
      for (let i = 0; i <= n; i++) {
        edges[0].push(i);
        edges[1].push(n * (n + 1) + i);
        edges[2].push(i * (n + 1));
        edges[3].push(i * (n + 1) + n);
      }
      let sv = gridCount;
      for (const edge of edges) {
        const start = sv;
        for (const src of edge) {
          skirtSource[sv - gridCount] = src;
          positions[sv * 3] = positions[src * 3];
          positions[sv * 3 + 1] = positions[src * 3 + 1] - opts.skirt;
          positions[sv * 3 + 2] = positions[src * 3 + 2];
          normals[sv * 3] = normals[src * 3];
          normals[sv * 3 + 1] = normals[src * 3 + 1];
          normals[sv * 3 + 2] = normals[src * 3 + 2];
          colors[sv * 3] = colors[src * 3] * 0.8;
          colors[sv * 3 + 1] = colors[src * 3 + 1] * 0.8;
          colors[sv * 3 + 2] = colors[src * 3 + 2] * 0.8;
          sv++;
        }
        for (let k = 0; k < n; k++) {
          const a = edge[k], b = edge[k + 1], c = start + k, d = start + k + 1;
          indices.push(a, b, c, b, d, c, a, c, b, b, c, d);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    if (fams) {
      // Textured ground: every triangle carries the families of its three corners and each vertex
      // its corner weight, so the fragment shader can blend three ground textures across it. That
      // needs one vertex per corner per triangle; the identity index keeps far-tile quad culling
      // (World.refreshFarTile) working on the same six entries per quad.
      const family = (v: number) => (v < gridCount ? fams![(Math.floor(v / (n + 1)) + 1) * w + (v % (n + 1)) + 1] : skirtSource[v - gridCount] >= 0 ? fams![(Math.floor(skirtSource[v - gridCount] / (n + 1)) + 1) * w + (skirtSource[v - gridCount] % (n + 1)) + 1] : 0);
      const tc = indices.length;
      const dp = new Float32Array(tc * 3);
      const dn = new Float32Array(tc * 3);
      const dc = new Float32Array(tc * 3);
      const df = new Float32Array(tc * 3);
      const db = new Float32Array(tc * 3);
      for (let t = 0; t < tc; t += 3) {
        const f0 = family(indices[t]), f1 = family(indices[t + 1]), f2 = family(indices[t + 2]);
        for (let k = 0; k < 3; k++) {
          const src = indices[t + k];
          const o = (t + k) * 3;
          dp[o] = positions[src * 3];
          dp[o + 1] = positions[src * 3 + 1];
          dp[o + 2] = positions[src * 3 + 2];
          dn[o] = normals[src * 3];
          dn[o + 1] = normals[src * 3 + 1];
          dn[o + 2] = normals[src * 3 + 2];
          dc[o] = colors[src * 3];
          dc[o + 1] = colors[src * 3 + 1];
          dc[o + 2] = colors[src * 3 + 2];
          df[o] = f0;
          df[o + 1] = f1;
          df[o + 2] = f2;
          db[o + k] = 1;
        }
      }
      geo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(dn, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(dc, 3));
      geo.setAttribute('aFamily', new THREE.BufferAttribute(df, 3));
      geo.setAttribute('aBary', new THREE.BufferAttribute(db, 3));
      const identity = new Uint32Array(tc);
      for (let i = 0; i < tc; i++) identity[i] = i;
      geo.setIndex(new THREE.BufferAttribute(identity, 1));
      geo.computeBoundingSphere();
      if (opts.skirt === 0) geo.userData = { fullIndex: identity.slice(), n, ox, oz, step };
      return { geometry: geo, heights: physHeights };
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return { geometry: geo, heights: physHeights };
  }
}
