// Stand-ins the horizon pass's tests share: a min/max pyramid over rolling ground (no bake needed), the hole's grid with
// the chunks a view radius stands round a camera, and the selection's ask filled as the world fills it.
import * as THREE from 'three';
import { HoleGrid, LEAF, LEVELS_MOST, newReachRules, reachRules, type MinMaxPyramid, type RingAsk } from '../../../src/world/horizon/horizonMath.ts';
import { HORIZON_TUNE } from '../../../src/world/horizon/horizonMath.ts';

/** Rolling ground in metres at a game place. */
export const rolling = (x: number, z: number): number => 40 * Math.sin(x * 0.0011) * Math.cos(z * 0.0009) + 12 * Math.sin(x * 0.007 + z * 0.005);

/** A pyramid over a square `half` metres round the origin on the leaves' lattice from `shift`, of `rolling` ground. */
export function testPyramid(half = 24000, shift = { x: 1, z: 0 }, h = rolling): MinMaxPyramid {
  const top = LEAF * (1 << LEVELS_MOST);
  const x0 = shift.x + top * Math.floor((-half - shift.x) / top);
  const z0 = shift.z + top * Math.floor((-half - shift.z) / top);
  const n = Math.ceil((2 * half + top) / top) * (1 << LEVELS_MOST);
  const lo0 = new Float32Array(n * n);
  const hi0 = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let a = Infinity;
      let b = -Infinity;
      for (let q = 0; q <= 8; q += 4) {
        for (let p = 0; p <= 8; p += 4) {
          const v = h(x0 + i * LEAF + p * 8, z0 + j * LEAF + q * 8);
          if (v < a) a = v;
          if (v > b) b = v;
        }
      }
      lo0[j * n + i] = a - 20;
      hi0[j * n + i] = b + 20;
    }
  }
  const lo = [lo0];
  const hi = [hi0];
  let m = n;
  for (let L = 1; L <= LEVELS_MOST; L++) {
    const p = m >> 1;
    const pl = new Float32Array(p * p);
    const ph = new Float32Array(p * p);
    for (let j = 0; j < p; j++) {
      for (let i = 0; i < p; i++) {
        let a = Infinity;
        let b = -Infinity;
        for (let q = 0; q < 4; q++) {
          const k = (2 * j + (q >> 1)) * m + 2 * i + (q & 1);
          a = Math.min(a, lo[L - 1][k]);
          b = Math.max(b, hi[L - 1][k]);
        }
        pl[j * p + i] = a;
        ph[j * p + i] = b;
      }
    }
    lo.push(pl);
    hi.push(ph);
    m = p;
  }
  return { x0, z0, n, levels: LEVELS_MOST + 1, lo, hi };
}

/** The chunks a view radius stands round the camera's chunk, every one or all but a few still streaming. */
export function testHole(hole: HoleGrid, pcx: number, pcz: number, radius: number, missing: (cx: number, cz: number) => boolean = () => false): void {
  hole.resize(radius);
  hole.clear();
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) if (!missing(pcx + dx, pcz + dz)) hole.set(pcx + dx, pcz + dz, true);
}

const rules = newReachRules();

/** The ask the world fills for a camera (`HorizonField.update`'s first lines). */
export function testAsk(a: RingAsk, eye: THREE.Vector3, fogDensity: number, radius: number, shift: { x: number; z: number }): RingAsk {
  rules.fogDensity = fogDensity;
  const r = reachRules(HORIZON_TUNE, radius, true, rules);
  const pcx = Math.floor(eye.x / LEAF);
  const pcz = Math.floor(eye.z / LEAF);
  a.ex = eye.x;
  a.ey = eye.y;
  a.ez = eye.z;
  a.reach = r.inForce;
  a.lod0 = r.lod0;
  a.levels = r.levels;
  a.morph = HORIZON_TUNE.morph;
  a.edgeBand = HORIZON_TUNE.edgeBand;
  a.drop = HORIZON_TUNE.drop;
  a.shiftX = shift.x;
  a.shiftZ = shift.z;
  a.cx0 = pcx - radius - 1;
  a.cx1 = pcx + radius + 1;
  a.cz0 = pcz - radius - 1;
  a.cz1 = pcz + radius + 1;
  return a;
}

export function newAsk(): RingAsk {
  return { ex: 0, ey: 0, ez: 0, reach: 0, lod0: 1400, levels: 1, morph: 0.3, edgeBand: 64, drop: 2.5, shiftX: 0, shiftZ: 0, cx0: 0, cz0: 0, cx1: 0, cz1: 0 };
}

/** A 60-degree camera at 16:9, placed and turned, its matrices made (reversed depth, as the game's). */
export function testCamera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 30000);
  Object.defineProperty(c, 'reversedDepth', { value: true });
  c.updateProjectionMatrix();
  return c;
}
