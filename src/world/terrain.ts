import * as THREE from 'three';
import type { PlanetDef } from '../data/planets';
import { FBM, hash2 } from './noise';

export const CHUNK_SIZE = 64;

/** Level ground of height h within radius r, blended smoothly at the edge. */
export interface FlattenZone { x: number; z: number; r: number; h: number }

/** A known ground height from game data (an object's origin), pulling the terrain toward it nearby. */
export interface Anchor { x: number; z: number; y: number; r: number }

const ANCHOR_CELL = 128;
const ANCHOR_REACH = 40;
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
  readonly minH: number;
  readonly maxH: number;
  readonly waterLevel: number;
  readonly flattenZones: FlattenZone[] = [];
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
    this.maxH = planet.terrain.base + planet.terrain.amplitude;
    this.waterLevel = planet.water ? planet.water.level : -Infinity;
  }

  heightAt(x: number, z: number): number {
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
          const reach = a.r + ANCHOR_REACH;
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

  /** Register a ground-height anchor; it influences terrain within r + 40 m. */
  addAnchor(a: Anchor): void {
    const reach = a.r + ANCHOR_REACH;
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
    const t = Math.min(1, Math.max(0, (h - this.minH) / (this.maxH - this.minH)));
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
    const n = CHUNK_RES;
    const step = CHUNK_SIZE / n;
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;
    const w = n + 3;
    const hs = new Float32Array(w * w);
    for (let j = 0; j < w; j++) {
      for (let i = 0; i < w; i++) {
        hs[j * w + i] = this.heightAt(ox + (i - 1) * step, oz + (j - 1) * step);
      }
    }

    // Physics copy: column-major, column = x index, row = z index.
    const physHeights = new Float32Array((n + 1) * (n + 1));
    for (let xi = 0; xi <= n; xi++) {
      for (let zi = 0; zi <= n; zi++) physHeights[xi * (n + 1) + zi] = hs[(zi + 1) * w + (xi + 1)];
    }

    const vcount = (n + 1) * (n + 1);
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
        positions[p + 1] = h;
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

    const indices = new Uint32Array(n * n * 6);
    let q = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        indices[q++] = a; indices[q++] = c; indices[q++] = b;
        indices[q++] = b; indices[q++] = c; indices[q++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();
    return { geometry: geo, heights: physHeights };
  }
}
