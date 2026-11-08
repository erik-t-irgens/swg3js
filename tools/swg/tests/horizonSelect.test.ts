// The far ground's selection (the horizon pass's first wave, DESIGN.md §2.4): the CDLOD quadtree from kept stacks held to
// a slow recursive brute force (every node, its reach, its box from the pyramid, the frustum, its range and the edge's
// level) on 500 random cameras from 2 m to 2 km up, and to what the hole means: no leaf on a standing chunk, a leaf on
// every chunk-less cell of the square the view reaches, nothing selected twice and every place of the reach in view under
// exactly one, every leaf edge with a standing chunk across it under a skirt; and the counts of §2.4's table.
//
// Run: node tools/swg/tests/horizonSelect.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HORIZON_TUNE, HoleGrid, LEAF, RingSelector, cameraFrustum, ringEdgeLevel, type MinMaxPyramid, type RingAsk } from '../../../src/world/horizon/horizonMath.ts';
import { newAsk, rolling, testAsk, testCamera, testHole, testPyramid } from './horizonFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const shift = { x: 1, z: 0 };
const pyr = testPyramid(24000, shift);
const hole = new HoleGrid();
const sel = new RingSelector();
const cam = testCamera();
const frustum = new THREE.Frustum();
const m = new THREE.Matrix4();
const ask = newAsk();

/** The slow way: every node by its definition, recursively, with boxes made fresh. */
function brute(f: THREE.Frustum, a: RingAsk, p: MinMaxPyramid, h: HoleGrid, out: Set<string>, skirts: Set<string>): void {
  const top = Math.min(a.levels - 1, p.levels - 1);
  const S = LEAF * 2 ** top;
  const sq = { x0: a.cx0 * LEAF + a.shiftX, x1: (a.cx1 + 1) * LEAF + a.shiftX, z0: a.cz0 * LEAF + a.shiftZ, z1: (a.cz1 + 1) * LEAF + a.shiftZ };
  const visit = (L: number, i: number, j: number): void => {
    const size = LEAF * 2 ** L;
    const x0 = a.shiftX + i * size;
    const z0 = a.shiftZ + j * size;
    const near = Math.hypot(Math.max(x0 - a.ex, 0, a.ex - x0 - size), Math.max(z0 - a.ez, 0, a.ez - z0 - size));
    if (near > a.reach) return;
    const n = p.n / 2 ** L;
    const pi = Math.round((x0 - p.x0) / size);
    const pj = Math.round((z0 - p.z0) / size);
    if (pi < 0 || pj < 0 || pi >= n || pj >= n) return;
    const lo = p.lo[L][pj * n + pi];
    const hi = p.hi[L][pj * n + pi];
    if (!(lo <= hi)) return;
    if (!f.intersectsBox(new THREE.Box3(new THREE.Vector3(x0, lo - a.drop, z0), new THREE.Vector3(x0 + size, hi, z0 + size)))) return;
    const meets = sq.x0 <= x0 + size && sq.x1 >= x0 && sq.z0 <= z0 + size && sq.z1 >= z0;
    if (L === 0) {
      if (i >= a.cx0 && i <= a.cx1 && j >= a.cz0 && j <= a.cz1 && h.standing(i, j)) return;
      out.add(`0,${i},${j}`);
      if (meets) {
        if (h.standing(i, j - 1)) skirts.add(`${i},${j},1`);
        if (h.standing(i + 1, j)) skirts.add(`${i},${j},2`);
        if (h.standing(i, j + 1)) skirts.add(`${i},${j},3`);
        if (h.standing(i - 1, j)) skirts.add(`${i},${j},4`);
      }
      return;
    }
    const dy = Math.max(lo - a.drop - a.ey, 0, a.ey - hi);
    const d = Math.hypot(Math.max(x0 - a.ex, 0, a.ex - x0 - size), dy, Math.max(z0 - a.ez, 0, a.ez - z0 - size));
    const gap = Math.max(sq.x0 - (x0 + size), x0 - sq.x1, sq.z0 - (z0 + size), z0 - sq.z1);
    if (meets || d < a.lod0 * 2 ** (L - 1) || L > Math.floor(ringEdgeLevel(gap, a.edgeBand, a.morph))) {
      for (let q = 0; q < 4; q++) visit(L - 1, i * 2 + (q & 1), j * 2 + (q >> 1));
    } else out.add(`${L},${i},${j}`);
  };
  for (let j = Math.floor((a.ez - a.reach - a.shiftZ) / S); j <= Math.floor((a.ez + a.reach - a.shiftZ) / S); j++) for (let i = Math.floor((a.ex - a.reach - a.shiftX) / S); i <= Math.floor((a.ex + a.reach - a.shiftX) / S); i++) visit(top, i, j);
}

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
let agree = 0;
let leafOnChunk = 0;
let overlaps = 0;
let uncovered = 0;
let covered = 0;
let skirtMiss = 0;
let rangeBad = 0;
let edgeBad = 0;
const radius = 6;
const CAMERAS = 500;
for (let c = 0; c < CAMERAS; c++) {
  const x = (rnd() * 2 - 1) * 6000;
  const z = (rnd() * 2 - 1) * 6000;
  // Every tenth from 3 to 5 km, where a node beside the square escapes the range rule and the edge's bands decide it.
  const up = c % 10 === 0 ? 3000 + 2000 * rnd() : c % 5 === 0 ? 2000 * rnd() : 2 + 40 * rnd();
  cam.position.set(x, rolling(x, z) + up, z);
  // Every tenth looks nearly straight down from up to 2 km: only there do the edge's bands, not the range, decide the nodes by
  // the square (from near the ground the range rule always splits them first).
  cam.rotation.set(c % 10 === 0 ? -1.4 - 0.15 * rnd() : -0.5 * rnd() + (up > 300 ? -0.4 : 0), rnd() * Math.PI * 2, 0, 'YXZ');
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  HORIZON_TUNE.reach = [3300, 8000, 16000][c % 3];
  const pcx = Math.floor(x / LEAF);
  const pcz = Math.floor(z / LEAF);
  // A few chunks of the radius still streaming, as an arrival leaves them.
  testHole(hole, pcx, pcz, radius, (cx, cz) => (cx * 7 + cz * 13 + c) % 23 === 0);
  testAsk(ask, cam.position, 0, radius, shift);
  cameraFrustum(cam, m, frustum);
  sel.select(frustum, ask, pyr, hole);
  const got = new Set<string>();
  for (let k = 0; k < sel.patchCount; k++) {
    const L = sel.patches[k * 4 + 2];
    const size = LEAF * 2 ** L;
    got.add(`${L},${Math.round((sel.patches[k * 4] - shift.x) / size)},${Math.round((sel.patches[k * 4 + 1] - shift.z) / size)}`);
  }
  const gotSkirts = new Set<string>();
  for (let k = 0; k < sel.skirtCount; k++) gotSkirts.add(`${Math.round((sel.skirts[k * 4] - shift.x) / LEAF)},${Math.round((sel.skirts[k * 4 + 1] - shift.z) / LEAF)},${sel.skirts[k * 4 + 3]}`);
  const want = new Set<string>();
  const wantSkirts = new Set<string>();
  brute(frustum, ask, pyr, hole, want, wantSkirts);
  if (got.size === want.size && [...want].every((k) => got.has(k)) && gotSkirts.size === wantSkirts.size && [...wantSkirts].every((k) => gotSkirts.has(k)) && got.size === sel.patchCount) agree++;
  // Leaves: every leaf cell under one node at most; none on a standing chunk.
  const cells = new Map<number, number>();
  const key = (i: number, j: number) => (i + 100000) * 200003 + (j + 100000);
  for (const k of got) {
    const [L, i, j] = k.split(',').map(Number);
    const s = 2 ** L;
    if (L === 0 && hole.standing(i, j)) leafOnChunk++;
    for (let b = 0; b < s; b++) for (let a = 0; a < s; a++) cells.set(key(i * s + a, j * s + b), (cells.get(key(i * s + a, j * s + b)) ?? 0) + 1);
    // The range rule: a node of level L stands past level L-1's range; the edge rule: never coarser than the edge asks.
    if (L > 0) {
      const size = LEAF * s;
      const x0 = shift.x + i * size;
      const z0 = shift.z + j * size;
      const n = pyr.n / s;
      const lo = pyr.lo[L][Math.round((z0 - pyr.z0) / size) * n + Math.round((x0 - pyr.x0) / size)];
      const hi = pyr.hi[L][Math.round((z0 - pyr.z0) / size) * n + Math.round((x0 - pyr.x0) / size)];
      const d = Math.hypot(Math.max(x0 - x, 0, x - x0 - size), Math.max(lo - ask.drop - cam.position.y, 0, cam.position.y - hi), Math.max(z0 - z, 0, z - z0 - size));
      if (d < ask.lod0 * 2 ** (L - 1)) rangeBad++;
      const gap = Math.max((ask.cx0 * LEAF + shift.x) - (x0 + size), x0 - ((ask.cx1 + 1) * LEAF + shift.x), (ask.cz0 * LEAF + shift.z) - (z0 + size), z0 - ((ask.cz1 + 1) * LEAF + shift.z));
      if (L > Math.floor(ringEdgeLevel(gap, ask.edgeBand, ask.morph))) edgeBad++;
    }
  }
  for (const v of cells.values()) if (v > 1) overlaps++;
  // Every place of the reach in view: under exactly one node, or a standing chunk.
  for (let s = 0; s < 40; s++) {
    const px = x + (rnd() * 2 - 1) * ask.reach;
    const pz = z + (rnd() * 2 - 1) * ask.reach;
    if (Math.hypot(px - x, pz - z) > ask.reach) continue;
    const pt = new THREE.Vector3(px, rolling(px, pz), pz);
    if (!frustum.containsPoint(pt)) continue;
    const ci = Math.floor((px - shift.x) / LEAF);
    const cj = Math.floor((pz - shift.z) / LEAF);
    if (hole.standing(ci, cj) && ci >= ask.cx0 && ci <= ask.cx1 && cj >= ask.cz0 && cj <= ask.cz1) continue;
    covered++;
    if ((cells.get(key(ci, cj)) ?? 0) !== 1) uncovered++;
  }
  // Every leaf edge with a standing chunk across: a skirt.
  for (const k of got) {
    const [L, i, j] = k.split(',').map(Number);
    if (L !== 0) continue;
    const sides: [number, number, number][] = [[i, j - 1, 1], [i + 1, j, 2], [i, j + 1, 3], [i - 1, j, 4]];
    for (const [ni, nj, side] of sides) {
      const inSquare = i >= ask.cx0 - 1 && i <= ask.cx1 + 1 && j >= ask.cz0 - 1 && j <= ask.cz1 + 1;
      if (inSquare && hole.standing(ni, nj) && !gotSkirts.has(`${i},${j},${side}`)) skirtMiss++;
    }
  }
}
HORIZON_TUNE.reach = 8000;
ok(agree === CAMERAS, `the kept stacks select what the slow brute force does on ${agree} of ${CAMERAS} cameras from 2 m to 5 km up`);
ok(leafOnChunk === 0, 'no leaf stands on a standing chunk');
ok(overlaps === 0, 'no two selected nodes overlap');
ok(uncovered === 0 && covered > 1000, `every place of the reach in view is under exactly one node or a standing chunk (${covered} places)`);
ok(skirtMiss === 0, 'every leaf edge with a standing chunk across it is under a skirt');
ok(rangeBad === 0, "every node coarser than a leaf stands past the finer level's range");
ok(edgeBad === 0, "no node is coarser than the edge's level at its nearest point to the square");

// §2.4's table, on this rolling ground (the design's own counts were measured with a wider wedge, so these run lower).
const table: string[] = [];
for (const [label, reach, up, pitch] of [['3.3 km, on foot', 3300, 2, -0.05], ['8 km, on foot', 8000, 2, -0.05], ['8 km, 500 m up', 8000, 500, -0.25], ['16 km, on foot', 16000, 2, -0.05], ['16 km, 2 km up', 16000, 2000, -0.4]] as const) {
  HORIZON_TUNE.reach = reach;
  cam.position.set(0, rolling(0, 0) + up, 0);
  cam.rotation.set(pitch, 0.7, 0, 'YXZ');
  cam.updateMatrixWorld();
  testHole(hole, 0, 0, radius);
  testAsk(ask, cam.position, 0, radius, shift);
  cameraFrustum(cam, m, frustum);
  const t0 = performance.now();
  for (let r = 0; r < 50; r++) sel.select(frustum, ask, pyr, hole);
  const us = ((performance.now() - t0) * 1000) / 50;
  table.push(`${label}: ${sel.patchCount} patches (${Array.from(sel.perLevel).filter((v, i) => v || i < 2).join('/')}), ${sel.skirtCount} skirts, ${sel.patchCount * 128 + sel.skirtCount * 32} triangles, ${us.toFixed(0)} us`);
}
HORIZON_TUNE.reach = 8000;
console.log(table.map((t) => `note ${t}`).join('\n'));
ok(table.length === 5, "§2.4's table worked out (the notes above)");

console.log(`\nhorizonSelect: ${checks} checks passed`);
