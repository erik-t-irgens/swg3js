// The far ground's ring program (the horizon pass's first wave, DESIGN.md §2.4, §2.5, §3): its text scanned for what a
// compiler would refuse (`glslScan.ts`); its morph, edge level, drop, reach and bake height run from their own GLSL text
// (`glslRun.ts`) against `horizonMath.ts`'s mirrors on 10,000 vertices; the vertex stage itself run as script over the
// real selections of 60 cameras, so a vertex two nodes share comes out the same from each, a finer node's edge lies on a
// coarser neighbour's, the hole's edge stays on the chunks' lattice from 2 km up, a skirt's top row is its leaf's edge and
// nothing stands past the reach; and the tile program's and the dome's texts held byte for byte to PRE_PASS (4c2ba23),
// rebuilt from today's with the exported snippets laid back, so their programs' keys cannot have moved.
//
// Run: node tools/swg/tests/horizonShaders.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { glslFunctions, GLSL_SCALARS } from './glslRun.ts';
import { redeclared, reservedWords, unbalanced, undefinedCalls } from './glslScan.ts';
import { HORIZON_RING_FUNCTIONS, HORIZON_RING_VERTEX, RING_NORMAL_GLSL, RING_SAMPLER_MOST, RING_SHELTER, RING_TEXT, TILE_MAP_SWAPS, injectRing, makeRingUniforms, ringTileMap } from '../../../src/world/horizon/horizonRings.ts';
import { heightsAtlas } from '../../../src/world/horizon/horizonField.ts';
import { normalsOf } from '../../../src/world/horizon/horizonDecode.ts';
import { GROUND_CLOUD_GLSL, GROUND_DECODE_GLSL, GROUND_MASK_GLSL, GROUND_TINT_GLSL, TILE_MAP, TILE_NORMAL, TILE_ROUGHNESS, injectGroundTiles, makeGroundTileUniforms } from '../../../src/world/terrainTextures.ts';
import { HORIZON_TUNE, HoleGrid, LEAF, RingSelector, bakeHeightAt, cameraFrustum, ringDistLevel, ringDrop, ringEdgeDistance, ringEdgeLevel, ringMorphAxis, ringReach, ringSnap, type BakeGrid } from '../../../src/world/horizon/horizonMath.ts';
import { newAsk, rolling, testAsk, testCamera, testHole, testPyramid } from './horizonFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---- the scan
const vertexText = `${RING_TEXT.VERTEX_PARS}\nvoid main() {\n${RING_TEXT.HORIZON_RING_VERTEX}\n}`;
// Three's own fragment prefix defines these two before the program's text (`WebGLProgram`'s `getToneMappingFunction` and
// `getTexelEncodingFunction`); the scan is handed stand-ins of the same shapes, so it still finds any call nothing defines.
const THREE_PREFIX = 'vec3 toneMapping( vec3 color ) { return color; }\nvec4 linearToOutputTexel( vec4 value ) { return value; }\n';
const fragmentText = `${THREE_PREFIX}${RING_TEXT.FRAGMENT_PARS}\nvoid main() {\n${RING_TEXT.FRAGMENT_TOP}\n${RING_TEXT.FRAGMENT_MAP}\n${RING_TEXT.FRAGMENT_NORMAL}\n${RING_TEXT.FRAGMENT_ROUGH}\n${RING_TEXT.FRAGMENT_CLOUDS}\n${RING_TEXT.FRAGMENT_FADE}\n${RING_TEXT.FRAGMENT_VIEW}\n}`;
for (const [name, text] of [['vertex', vertexText], ['fragment', fragmentText]] as const) {
  const calls = undefinedCalls(text);
  ok(calls.length === 0, `the ring's ${name} stage calls nothing it does not define (${calls.join(', ') || 'none'})`);
  ok(redeclared(text).length === 0, `and declares no name twice in one scope (${redeclared(text).join(', ') || 'none'})`);
  ok(reservedWords(text).length === 0 && !unbalanced(text), 'and uses no reserved word and balances its brackets');
}

// ---- the functions, run from their text against the mirrors
const grid = (x0: number, z0: number, step: number, n: number, f: (rx: number, rz: number) => number): BakeGrid => {
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = f(x0 + i * step, z0 + j * step);
  return { x0, z0, step, nx: n, nz: n, h };
};
const raw = (rx: number, rz: number) => rolling(-rx, rz);
const fineG = grid(-3070, -3068, 8, 769, raw);
const coarseG = grid(-3070 - 64 * 160, -3068 - 64 * 160, 64, 417, raw);
// The heights atlas as the field makes it (`heightsAtlas`: the fine lattice's rows from row nought, the coarse's after them),
// read by `texelFetch` exactly as the card does: a test of the atlas's addressing, not of a stand-in for each lattice.
const atlas = (f: BakeGrid, c: BakeGrid) => ({ w: Math.max(f.nx, c.nx), h: heightsAtlas(f.h, f.nx, f.nz, c.h, c.nx, c.nz) });
const env: Record<string, unknown> = {
  ...GLSL_SCALARS,
  ivec2: (x: number, y: number) => ({ x, y }),
  vec2: (x: number, y: number) => ({ x, y }),
  vec3: (x: number, y: number, z: number) => ({ x, y, z }),
  length: (v: { x: number; y: number }) => Math.hypot(v.x, v.y),
  log2: Math.log2,
  exp2: (x: number) => 2 ** x,
  texelFetch: (t: { w: number; h: Float32Array }, p: { x: number; y: number }) => ({ r: t.h[p.y * t.w + p.x] }),
  uHorizonFine: { x: fineG.x0, y: fineG.z0, z: fineG.step, w: 0 },
  uHorizonCoarse: { x: coarseG.x0, y: coarseG.z0, z: coarseG.step, w: 3 },
  uHorizonSizes: { x: fineG.nx, y: fineG.nz, z: coarseG.nx, w: coarseG.nz },
  uHorizonHeights: atlas(fineG, coarseG),
};
const G = glslFunctions(HORIZON_RING_FUNCTIONS, ['ringDistLevel', 'ringEdgeLevel', 'ringSnap', 'ringMorph', 'ringEdgeDistance', 'ringDrop', 'ringReach', 'bakeHeight', 'bakeCoarse', 'ringCoarseSpan', 'ringCoarseDx', 'ringCoarseDz'], env);
let seed = 99;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
let bad = 0;
for (let k = 0; k < 10000; k++) {
  const d = rnd() * 30000;
  const e = (rnd() * 2 - 0.2) * 3000;
  const v = 1 + 8 * Math.floor((rnd() * 2 - 1) * 4000);
  const w = rnd() * 6;
  const node = Math.floor(rnd() * 4);
  const rx = (rnd() * 2 - 1) * 12000;
  const rz = (rnd() * 2 - 1) * 12000;
  const pairs: [number, number][] = [
    [G.ringDistLevel(d, 1400, 0.3), ringDistLevel(d, 1400, 0.3)],
    [G.ringEdgeLevel(e, 64, 0.3), ringEdgeLevel(e, 64, 0.3)],
    [G.ringSnap(v, 1, 32), ringSnap(v, 1, 32)],
    [G.ringMorph(v, 1, w, node), ringMorphAxis(v, 1, w, node)],
    [G.ringEdgeDistance(rx, rz, -400, -380, 420, 440), ringEdgeDistance(rx, rz, -400, -380, 420, 440)],
    [G.ringDrop(e, 2.5, 256, k % 7 === 0 ? 1 : 0), ringDrop(e, 2.5, 256, k % 7 === 0 ? 1 : 0)],
    [G.ringReach(rx, rz, 8000), ringReach(rx, rz, 8000)],
    [G.bakeHeight(rx, rz), bakeHeightAt(fineG, coarseG, rx, rz)],
  ];
  for (const [a, b] of pairs) if (!(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)))) bad++;
}
ok(bad === 0, 'ringDistLevel, ringEdgeLevel, ringSnap, ringMorph, ringEdgeDistance, ringDrop, ringReach and bakeHeight run from their GLSL text agree with the mirrors on 10,000 vertices');
// On the lattice the bake's own sample, exactly.
let off = 0;
for (let k = 0; k < 2000; k++) {
  const i = 1 + Math.floor(rnd() * 760);
  const j = 1 + Math.floor(rnd() * 760);
  if (G.bakeHeight(fineG.x0 + i * 8, fineG.z0 + j * 8) !== fineG.h[j * fineG.nx + i]) off++;
}
ok(off === 0, "a vertex standing on the bake's lattice reads the bake's own sample, exactly");
// The coarse lattice's normals are worked out in the vertex stage (the third wave dropped their texture): at a level within
// the lattice's own spacing, `normalsOf`'s own texel at every coarse sample past the fine extent, its 8-bit rounding aside;
// and the step widens with the level past it.
const cnorm = normalsOf(coarseG.h, { x0: coarseG.x0, z0: coarseG.z0, step: coarseG.step, nx: coarseG.nx, nz: coarseG.nz } as never);
let nWorst = 0;
let nSeen = 0;
for (let k = 0; k < 4000; k++) {
  const i = 1 + Math.floor(rnd() * (coarseG.nx - 2));
  const j = 1 + Math.floor(rnd() * (coarseG.nz - 2));
  const rx = coarseG.x0 + i * coarseG.step;
  const rz = coarseG.z0 + j * coarseG.step;
  if (rx >= fineG.x0 && rz >= fineG.z0 && rx <= fineG.x0 + (fineG.nx - 1) * 8 && rz <= fineG.z0 + (fineG.nz - 1) * 8) continue;
  const s = G.ringCoarseSpan(rnd() * 3);
  const dx = G.ringCoarseDx(rx, rz, s);
  const dz = G.ringCoarseDz(rx, rz, s);
  const len = Math.hypot(dx, 1, dz);
  const o = (j * coarseG.nx + i) * 2;
  nWorst = Math.max(nWorst, Math.abs(dx / len - (cnorm[o] - 127.5) / 127.5), Math.abs(-dz / len - (cnorm[o + 1] - 127.5) / 127.5));
  nSeen++;
}
ok(nSeen > 1000 && nWorst <= 0.5 / 127.5 + 1e-9, `a coarse vertex's normal is normalsOf's own (its sign and its frame) within its 8-bit rounding, ${nSeen} samples (worst ${nWorst.toFixed(5)})`);
ok(G.ringCoarseSpan(2) === 64 && G.ringCoarseSpan(3) === 64 && G.ringCoarseSpan(5) === 256, "the coarse normal's step is the lattice's own up to its level, then the level's spacing");

// ---- the vertex stage, run as script over real selections
const shift = { x: 1, z: 0 };
const square = { x: 0, y: 0, z: 0, w: 0 };
const eye = { x: 0, y: 0, z: 0, w: 0 };
const morph = { x: 1400, y: 0.3, z: 64, w: 3 };
const drop = { x: 2.5, y: 256, z: 0, w: 16 };
const frame = { x: 1270, y: -3600, z: 1, w: 0 };
const vertexFn = `${HORIZON_RING_FUNCTIONS}
vec3 gRingPos;
vec2 vRingRaw; vec3 vRingWorld; float vRingEdge; float vRingDist; float vRingLevel; vec2 vGroundUV;
void ringVertexMain( float px, float py, float pz, float ax, float ay, float az, float aw ) {
${HORIZON_RING_VERTEX.replace(/^#.*$/gm, '').replace(/position\.([xyz])/g, 'p$1').replace(/aRing\.([xyzw])/g, (_m, c: string) => `a${c === 'w' ? 'w' : c === 'x' ? 'x' : c === 'y' ? 'y' : 'z'}`)}
}
float outX() { return gRingPos.x; }
float outY() { return gRingPos.y; }
float outZ() { return gRingPos.z; }
float outEdge() { return vRingEdge; }
`;
// The coarse grid stands in the raw frame about the frame's centre: the vertex reads raw = (centre.x - x, z + centre.z).
const fineV = grid(1270 - 12000, -3600 - 12000, 8, 3001, raw);
const coarseV = grid(1270 - 40000, -3600 - 40000, 64, 1251, raw);
const V = glslFunctions(vertexFn, ['ringVertexMain', 'outX', 'outY', 'outZ', 'outEdge'], {
  ...env,
  uHorizonFine: { x: fineV.x0, y: fineV.z0, z: 8, w: 0 },
  uHorizonCoarse: { x: coarseV.x0, y: coarseV.z0, z: 64, w: 3 },
  uHorizonSizes: { x: fineV.nx, y: fineV.nz, z: coarseV.nx, w: coarseV.nz },
  uHorizonHeights: atlas(fineV, coarseV),
  uHorizonEye: eye,
  uHorizonSquare: square,
  uHorizonMorph: morph,
  uHorizonDrop: drop,
  uHorizonGrid: { x: shift.x, y: shift.z, z: 0, w: 0 },
  uGroundFrame: frame,
  ringNormalAt: () => ({ x: 0, y: 1, z: 0 }),
});
const vert = (px: number, py: number, pz: number, a: number[]) => {
  V.ringVertexMain(px, py, pz, a[0], a[1], a[2], a[3]);
  return [V.outX(), V.outY(), V.outZ(), V.outEdge()];
};
const groundH = (gx: number, gz: number) => rolling(gx - 1270 + 1270, gz);
const pyr = testPyramid(20000, shift, (gx, gz) => raw(1270 - gx, gz - 3600));
const hole = new HoleGrid();
const sel = new RingSelector();
const cam = testCamera();
const fr = new THREE.Frustum();
const mm = new THREE.Matrix4();
const ask = newAsk();
let shared = 0;
let sharedBad = 0;
let tWorst = 0;
let tChecked = 0;
let edgeOff = 0;
let edgeSeen = 0;
let skirtBad = 0;
let pastReach = 0;
for (let c = 0; c < 60; c++) {
  const x = (rnd() * 2 - 1) * 5000;
  const z = (rnd() * 2 - 1) * 5000;
  const up = c % 4 === 0 ? 2000 : 2 + rnd() * 30;
  cam.position.set(x, raw(1270 - x, z - 3600) + up, z);
  // Every eighth looks nearly straight down from 2 km: only there do the edge's bands, not the range, decide the leaves by the
  // square (from near the ground the range rule always splits them first).
  cam.rotation.set(c % 8 === 0 ? -1.45 : up > 1000 ? -0.6 : -0.05, rnd() * 6.28, 0, 'YXZ');
  cam.updateMatrixWorld();
  HORIZON_TUNE.reach = [3300, 8000][c % 2];
  testHole(hole, Math.floor(x / LEAF), Math.floor(z / LEAF), 6);
  testAsk(ask, cam.position, 0, 6, shift);
  cameraFrustum(cam, mm, fr);
  sel.select(fr, ask, pyr, hole);
  eye.x = x;
  eye.y = cam.position.y;
  eye.z = z;
  eye.w = ask.reach;
  square.x = ask.cx0 * LEAF + shift.x;
  square.y = ask.cz0 * LEAF + shift.z;
  square.z = (ask.cx1 + 1) * LEAF + shift.x;
  square.w = (ask.cz1 + 1) * LEAF + shift.z;
  morph.x = ask.lod0;
  morph.w = ask.levels - 1;
  // Every node's border vertices, by their place: shared ones the same from each node; a finer node's edge vertices on its coarser neighbour's edge.
  const byPlace = new Map<string, number[]>();
  const nodes: { x0: number; z0: number; L: number }[] = [];
  for (let k = 0; k < sel.patchCount; k++) nodes.push({ x0: sel.patches[k * 4], z0: sel.patches[k * 4 + 1], L: sel.patches[k * 4 + 2] });
  for (const n of nodes) {
    const q = 8 * 2 ** n.L;
    for (let t = 0; t <= 8; t++) {
      for (const [i, j] of [[t, 0], [t, 8], [0, t], [8, t]]) {
        const out = vert(i, 0, j, [n.x0, n.z0, n.L, 0]);
        const key = `${n.x0 + i * q},${n.z0 + j * q}`;
        const had = byPlace.get(key);
        if (had) {
          shared++;
          if (Math.abs(had[0] - out[0]) > 1e-6 || Math.abs(had[1] - out[1]) > 1e-6 || Math.abs(had[2] - out[2]) > 1e-6) sharedBad++;
        } else byPlace.set(key, out);
        if (Math.hypot(out[0] - x, out[2] - z) > ask.reach + 1e-6) pastReach++;
        // The hole's edge, seen from anywhere: a vertex on it stands on the chunks' lattice, unmorphed.
        if (out[3] <= 0 && out[3] > -1e-6 && n.L === 0) {
          edgeSeen++;
          if (Math.abs(out[0] - (n.x0 + i * q)) > 1e-6 || Math.abs(out[2] - (n.z0 + j * q)) > 1e-6) edgeOff++;
        }
      }
    }
  }
  // T-junctions: a finer node's border vertex that lies on a coarser neighbour's edge, against that edge's line.
  for (const fine of nodes) {
    const q = 8 * 2 ** fine.L;
    for (const coarse of nodes) {
      if (coarse.L !== fine.L + 1) continue;
      const S = 64 * 2 ** coarse.L;
      const cq = 8 * 2 ** coarse.L;
      for (let t = 0; t <= 8; t++) {
        for (const [i, j] of [[t, 0], [t, 8], [0, t], [8, t]]) {
          const px = fine.x0 + i * q;
          const pz = fine.z0 + j * q;
          const onX = (px === coarse.x0 || px === coarse.x0 + S) && pz >= coarse.z0 && pz <= coarse.z0 + S;
          const onZ = (pz === coarse.z0 || pz === coarse.z0 + S) && px >= coarse.x0 && px <= coarse.x0 + S;
          if (!onX && !onZ) continue;
          const v = vert(i, 0, j, [fine.x0, fine.z0, fine.L, 0]);
          // The coarse edge's two vertices round it, and the line between them at the fine vertex's place.
          const along = onX ? (pz - coarse.z0) / cq : (px - coarse.x0) / cq;
          const a0 = Math.floor(along);
          const a1 = Math.min(8, a0 + 1);
          const ci = (a: number) => (onX ? [(px - coarse.x0) / cq, a] : [a, (pz - coarse.z0) / cq]);
          const [i0, j0] = ci(a0);
          const [i1, j1] = ci(a1);
          const p0 = vert(i0, 0, j0, [coarse.x0, coarse.z0, coarse.L, 0]);
          const p1 = vert(i1, 0, j1, [coarse.x0, coarse.z0, coarse.L, 0]);
          const dx = p1[0] - p0[0];
          const dz = p1[2] - p0[2];
          const len2 = dx * dx + dz * dz;
          const s = len2 > 0 ? Math.min(1, Math.max(0, ((v[0] - p0[0]) * dx + (v[2] - p0[2]) * dz) / len2)) : 0;
          const ex = p0[0] + dx * s - v[0];
          const ez = p0[2] + dz * s - v[2];
          const ey = p0[1] + (p1[1] - p0[1]) * s - v[1];
          tWorst = Math.max(tWorst, Math.hypot(ex, ey, ez));
          tChecked++;
        }
      }
    }
  }
  // A skirt's top row is its leaf's edge (the same place, the same morph).
  for (let k = 0; k < sel.skirtCount; k++) {
    const sx = sel.skirts[k * 4];
    const sz = sel.skirts[k * 4 + 1];
    const side = sel.skirts[k * 4 + 3];
    for (let t = 0; t <= 8; t++) {
      const top = vert(t, 1, 0, [sx, sz, 0, side]);
      const [i, j] = side === 1 ? [t, 0] : side === 2 ? [8, t] : side === 3 ? [t, 8] : [0, t];
      const leaf = vert(i, 0, j, [sx, sz, 0, 0]);
      const bottom = vert(t, 2, 0, [sx, sz, 0, side]);
      if (Math.abs(top[0] - leaf[0]) > 1e-9 || Math.abs(top[1] - leaf[1]) > 1e-9 || Math.abs(top[2] - leaf[2]) > 1e-9 || Math.abs(top[1] - bottom[1] - drop.w) > 1e-9) skirtBad++;
    }
  }
}
HORIZON_TUNE.reach = 8000;
ok(shared > 1000 && sharedBad === 0, `a vertex two nodes share comes out the same from each (${shared} shared)`);
ok(tChecked > 100 && tWorst < 0.01, `a finer node's edge lies on its coarser neighbour's edge (${tChecked} T-junctions, worst ${(tWorst * 100).toFixed(3)} cm off the coarse edge)`);
ok(edgeSeen > 100 && edgeOff === 0, `every vertex on the hole's edge stands on the chunks' lattice unmorphed, cameras from the ground to 2 km up (${edgeSeen} vertices)`);
ok(skirtBad === 0, "a skirt's top row is its leaf's edge and its bottom hangs the skirt's depth under it");
ok(pastReach === 0, 'no ring vertex stands past the reach in force');

// ---- the third wave: the near ground's own composition, by the tile program's own text
const ringTile = ringTileMap(TILE_MAP);
ok(ringTile !== null && TILE_MAP_SWAPS.every(([a, b]) => TILE_MAP.split(a).length === 2 && ringTile.includes(b) && !ringTile.includes(a)), "the ring's composition is TILE_MAP's own text with its four derivatives and its last multiply swapped, each found once");
ok(ringTile !== null && ringTile.split('\n').filter((l) => !TILE_MAP.includes(l)).length === TILE_MAP_SWAPS.length, 'and nothing else of it is touched');
ok(RING_TEXT.FRAGMENT_MAP.includes(ringTile ?? '\u0000'), "the ring's colour stage runs that very composition");
ok(ringTileMap(TILE_MAP.replace('vec2 gTx = dFdx( vGroundTile );', 'vec2 gTx = dFdx( vGroundTile * 1.0 );')) === null, "a TILE_MAP whose text has moved from what the ring swaps is refused, never half swapped");
// The derivatives the swaps hand it: the picture's off its own coordinate, the tile place's off the raw place a quarter (one tile 4 m).
ok(ringTile !== null && ringTile.includes('vec2 gDx = gUvDx;') && ringTile.includes('vec2 gTx = gTileDx;') && /gUvDx = dFdx\( vGroundUV \);/.test(RING_TEXT.FRAGMENT_TOP) && RING_TEXT.FRAGMENT_TOP.includes('gTileDx = gRingDx * 0.25;') && RING_TEXT.FRAGMENT_TOP.includes('gTileDy = gRingDy * 0.25;'), "the composition's derivatives are the picture coordinate's own and the raw place's quarter, as the tile place runs");
// The window's texel unpacked as `unpackWindow` (the decode's own packing) reads it, and the tile place as `tileLayers`' s and t.
ok(RING_TEXT.FRAGMENT_PARS.includes('vGroundLayers = vec4( float( w.x & 255u ), float( w.x >> 8u ), float( w.y & 255u ), float( w.y >> 8u ) );') && RING_TEXT.FRAGMENT_PARS.includes('vGroundBlend = vec4( float( w.z & 31u ), float( ( w.z >> 5u ) & 31u ), float( ( w.z >> 10u ) & 31u ), 0.0 );') && RING_TEXT.FRAGMENT_PARS.includes('vGroundTile = vec2( raw.x * 0.25 - tx, raw.y * 0.25 - tz );') && RING_TEXT.FRAGMENT_PARS.includes('if ( w.w == 0u ) return false;'), "the program unpacks the window's texel as the decode packs it (unpackWindow), and a tile holding nothing reads the far albedo");
// The coarse lean's frame: the slope along raw x as the normal's x, along raw z turned (normalsOf's own sign).
ok(RING_NORMAL_GLSL.includes('return normalize( vec3( ringCoarseDx( raw.x, raw.y, s ), 1.0, -ringCoarseDz( raw.x, raw.y, s ) ) );'), "the vertex's coarse normal takes the slopes in normalsOf's own frame");
for (const [name, text] of [['GROUND_MASK_GLSL', GROUND_MASK_GLSL], ['GROUND_TINT_GLSL', GROUND_TINT_GLSL], ['GROUND_DECODE_GLSL', GROUND_DECODE_GLSL], ['GROUND_CLOUD_GLSL', GROUND_CLOUD_GLSL]] as const) ok(RING_TEXT.FRAGMENT_PARS.includes(text), `the ring's fragment declares the tile program's own ${name}`);
ok(RING_TEXT.FRAGMENT_NORMAL.includes(TILE_NORMAL.trim()) && RING_TEXT.FRAGMENT_ROUGH === TILE_ROUGHNESS, "and runs the tile program's own TILE_NORMAL (where the near composition is drawn) and TILE_ROUGHNESS");
ok(/gl_FragColor = vec4\( fogColor, 1\.0 \);/.test(RING_TEXT.FRAGMENT_TOP), "the fog's cheap path writes the fog's own colour, exactly");
// The derivatives every taps reads are taken once at the top of main(), never inside a branch.
ok(!/dFd[xy]/.test(RING_TEXT.FRAGMENT_MAP + RING_TEXT.FRAGMENT_NORMAL + RING_TEXT.FRAGMENT_ROUGH + RING_TEXT.FRAGMENT_PARS) && (RING_TEXT.FRAGMENT_TOP.match(/dFd[xy]/g) ?? []).length === 4, 'every derivative the taps read is taken once at the top of main(), none in a branch');

// ---- the third wave: the program's samplers, counted over its text as three assembles it, under Direct3D 11's sixteen
/** `#include <x>` resolved through three's chunks, as `WebGLProgram` does. */
const resolve = (s: string): string => s.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, name: string) => {
  const chunk = (THREE.ShaderChunk as unknown as Record<string, string>)[name];
  if (chunk === undefined) throw new Error(`no chunk ${name}`);
  return resolve(chunk);
});
/** The text as the preprocessor leaves it under `defines`: #if, #ifdef, #ifndef, #elif, #else, #endif, #define, #undef. */
const preprocess = (src: string, defs: Record<string, number>): string => {
  const d: Record<string, number> = { ...defs };
  const out: string[] = [];
  const stack: { keep: boolean; taken: boolean; outer: boolean }[] = [];
  const live = () => stack.every((s) => s.keep);
  const evalIf = (expr: string): boolean => {
    const e = expr
      .replace(/defined\s*\(\s*(\w+)\s*\)/g, (_m, n: string) => (n in d ? '1' : '0'))
      .replace(/defined\s+(\w+)/g, (_m, n: string) => (n in d ? '1' : '0'))
      .replace(/\b[A-Za-z_]\w*\b/g, (n) => String(d[n] ?? 0));
    return !!new Function(`return (${e});`)();
  };
  for (const line of src.split('\n')) {
    const m = /^\s*#\s*(ifdef|ifndef|if|elif|else|endif|define|undef)\b\s*(.*)$/.exec(line);
    if (!m) {
      if (live()) out.push(line);
      continue;
    }
    const [, dir, rest] = m;
    if (dir === 'ifdef' || dir === 'ifndef' || dir === 'if') {
      const outer = live();
      const k = dir === 'ifdef' ? rest.trim() in d : dir === 'ifndef' ? !(rest.trim() in d) : outer && evalIf(rest);
      stack.push({ keep: k, taken: k, outer });
    } else if (dir === 'elif') {
      const t = stack[stack.length - 1];
      t.keep = !t.taken && t.outer && evalIf(rest);
      t.taken ||= t.keep;
    } else if (dir === 'else') {
      const t = stack[stack.length - 1];
      t.keep = !t.taken;
      t.taken = true;
    } else if (dir === 'endif') stack.pop();
    else if (live() && dir === 'define') {
      const dm = /^(\w+)(?:\s+(.*))?$/.exec(rest.trim());
      if (dm && !dm[1].includes('(')) d[dm[1]] = Number(dm[2] ?? 1) || 1;
      // A name defined as another (three's `#define RE_Direct RE_Direct_Physical`): the call reaches the function it names.
      if (dm && /^[A-Za-z_]\w*$/.test((dm[2] ?? '').trim())) aliases.set(dm[1], dm[2].trim());
    } else if (live() && dir === 'undef') delete d[rest.trim()];
  }
  let text = out.join('\n');
  for (const [a, b] of aliases) text = text.replace(new RegExp(`\\b${a}\\b`, 'g'), b);
  return text;
};
const aliases = new Map<string, string>();
/** The samplers a stage's text declares, and of them those its main() reaches (a function never called reads nothing: the compiler drops it). */
const activeSamplers = (text: string, defs: Record<string, number>): Map<string, number> => {
  const t = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const decl = new Map<string, number>();
  for (const m of t.matchAll(/uniform\s+(?:(?:highp|mediump|lowp)\s+)?[iu]?sampler\w+\s+(\w+)\s*(?:\[\s*(\w+)\s*\])?\s*;/g)) decl.set(m[1], m[2] ? Number(m[2]) || defs[m[2]] || 0 : 1);
  // Every function's body, by name; main's reach through the calls it and they make.
  const bodies = new Map<string, string>();
  const words = new Set(['if', 'for', 'while', 'switch', 'return', 'else']);
  for (const m of t.matchAll(/\b\w+\s+(\w+)\s*\([^;{)]*\)\s*\{/g)) {
    if (words.has(m[1])) continue;
    const open = m.index! + m[0].length - 1;
    let depth = 0;
    for (let j = open; j < t.length; j++) {
      if (t[j] === '{') depth++;
      else if (t[j] === '}' && --depth === 0) {
        bodies.set(m[1], (bodies.get(m[1]) ?? '') + t.slice(open, j + 1));
        break;
      }
    }
  }
  const reached = new Set<string>(['main']);
  const queue = ['main'];
  while (queue.length) {
    const b = bodies.get(queue.pop()!) ?? '';
    for (const c of b.matchAll(/\b(\w+)\s*\(/g)) if (bodies.has(c[1]) && !reached.has(c[1])) (reached.add(c[1]), queue.push(c[1]));
  }
  const reachedText = [...reached].map((n) => bodies.get(n) ?? '').join('\n');
  const active = new Map<string, number>();
  for (const [name, n] of decl) if (new RegExp(`\\b${name}\\b`).test(reachedText)) active.set(name, n);
  return active;
};
const ringProgram = () => {
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, unknown> };
  const went = injectRing(shader, makeRingUniforms(), makeGroundTileUniforms());
  return { went, vertex: resolve(shader.vertexShader), fragment: resolve(shader.fragmentShader) };
};
const prog = ringProgram();
ok(prog.went, 'the ring program goes into three\'s own standard shader, every anchor found');
ok(prog.fragment.includes(RING_SHELTER[1]) && !prog.fragment.includes(RING_SHELTER[0]), "the weather's shelter is the open sky's in the ring (the roof grid is never read)");
// The world pass's light sets the ring is drawn under (three's defines): the cascades' three suns casting, a fill, the sky,
// the torch and the flash pool lighting and none of them casting; with shadows off, none casting. A rooms pass never draws it.
const COMBOS: { name: string; defs: Record<string, number> }[] = [];
for (const shadows of [true, false]) {
  for (const fog of [true, false]) {
    for (const tone of [true, false]) {
      const defs: Record<string, number> = { STANDARD: 1, PHYSICAL: 0, NUM_DIR_LIGHTS: 4, NUM_POINT_LIGHTS: 4, NUM_SPOT_LIGHTS: 1, NUM_HEMI_LIGHTS: 1, NUM_RECT_AREA_LIGHTS: 0, NUM_DIR_LIGHT_SHADOWS: shadows ? 3 : 0, NUM_POINT_LIGHT_SHADOWS: 0, NUM_SPOT_LIGHT_SHADOWS: 0, NUM_SPOT_LIGHT_MAPS: 0, NUM_SPOT_LIGHT_COORDS: 0, NUM_CLIPPING_PLANES: 0, UNION_CLIPPING_PLANES: 0, USE_CSM: 1, CSM_CASCADES: 3, CSM_FADE: 1 };
      if (shadows) defs.USE_SHADOWMAP = 1;
      if (fog) (defs.USE_FOG = 1), (defs.FOG_EXP2 = 1);
      if (tone) defs.TONE_MAPPING = 1;
      delete defs.PHYSICAL;
      COMBOS.push({ name: `${shadows ? 'shadows' : 'no shadows'}, ${fog ? 'fog' : 'no fog'}, ${tone ? 'tone mapped' : 'linear'}`, defs });
    }
  }
}
let mostUnits = 0;
let mostNames = '';
for (const c of COMBOS) {
  const v = activeSamplers(preprocess(prog.vertex, c.defs), c.defs);
  const f = activeSamplers(preprocess(prog.fragment, c.defs), c.defs);
  const all = new Map([...v, ...f]);
  const units = [...all.values()].reduce((a, b) => a + b, 0);
  if (units > mostUnits) {
    mostUnits = units;
    mostNames = [...all].map(([n, k]) => (k > 1 ? `${n}x${k}` : n)).join(', ');
  }
  ok(units <= RING_SAMPLER_MOST, `the ring program under ${c.name} reads ${units} samplers, at most Direct3D 11's ${RING_SAMPLER_MOST}`);
}
console.log(`note the most the ring program reads: ${mostUnits} (${mostNames})`);
// The counter itself, held to the program before this wave's packing: the same assembly over W1's samplers counts past 16.
const before = prog.fragment.replace('uniform highp usampler2D uHorizonWindow;', 'uniform highp usampler2D uHorizonWindow;\nuniform sampler2D uHorizonCoarseN;\nuniform sampler2D uHorizonDetail;\nuniform sampler2D uHorizonMeans;\nuniform highp sampler2D uRoofMap2;').replace('void main() {', 'void main() {\n\tvec4 gOld = texture( uHorizonCoarseN, vec2( 0.0 ) ) + texture( uHorizonDetail, vec2( 0.0 ) ) + texture( uHorizonMeans, vec2( 0.0 ) ) + texture( uRoofMap2, vec2( 0.0 ) );');
const beforeUnits = [...new Map([...activeSamplers(preprocess(prog.vertex, COMBOS[0].defs), COMBOS[0].defs), ...activeSamplers(preprocess(before, COMBOS[0].defs), COMBOS[0].defs)]).values()].reduce((a, b) => a + b, 0);
ok(beforeUnits > RING_SAMPLER_MOST, `the count finds four samplers more past the sixteen (${beforeUnits}): it counts what main() reads`);
// The tile program's own count, for the record (it is untouched).
{
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, unknown> };
  injectGroundTiles(shader, makeGroundTileUniforms());
  const n = [...activeSamplers(preprocess(resolve(shader.fragmentShader), COMBOS[0].defs), COMBOS[0].defs).values()].reduce((a, b) => a + b, 0);
  console.log(`note the near ground's tile program reads ${n} samplers under the same light set`);
}

// ---- the tile program's and the dome's texts, byte for byte PRE_PASS's
const PRE_PASS = '4c2ba23';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const fold = (s: string) => s.replace(/\r\n/g, '\n');
const old = (path: string): string | null => {
  try {
    return fold(execFileSync('git', ['show', `${PRE_PASS}:${path}`], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1048576 }));
  } catch {
    return null;
  }
};
/** Today's source with an exported snippet's own definition taken out and its use laid back as the snippet's text. */
const laidBack = (src: string, name: string): string => {
  const start = src.indexOf(`export const ${name} = \``);
  const docStart = src.lastIndexOf('/**', start);
  const end = src.indexOf('`;', start) + 2;
  const body = src.slice(src.indexOf('`', start) + 1, end - 2);
  return (src.slice(0, docStart) + src.slice(end + 2)).replace(`\${${name}}`, body);
};
const tt = old('src/world/terrainTextures.ts');
const sk = old('src/world/sky.ts');
if (!tt || !sk) console.log(`note git cannot show ${PRE_PASS} here: the byte-for-byte checks are left out`);
else {
  const nowTt = fold(readFileSync(new URL('../../../src/world/terrainTextures.ts', import.meta.url), 'utf8'));
  // The third wave exported the masks' functions (laid back the same way) and the bump's and gloss's stages (an `export` alone).
  const backTt = laidBack(laidBack(nowTt, 'GROUND_CLOUD_GLSL'), 'GROUND_MASK_GLSL').replace('export const TILE_ROUGHNESS = ', 'const TILE_ROUGHNESS = ').replace('export const TILE_NORMAL = ', 'const TILE_NORMAL = ');
  ok(backTt === tt, `the tile program's text is ${PRE_PASS}'s to the byte with GROUND_CLOUD_GLSL and GROUND_MASK_GLSL laid back and TILE_ROUGHNESS and TILE_NORMAL unexported (its key unchanged)`);
  const nowSk = fold(readFileSync(new URL('../../../src/world/sky.ts', import.meta.url), 'utf8'));
  const dome = fold(readFileSync(new URL('../../../src/world/domeColour.ts', import.meta.url), 'utf8'));
  const body = dome.slice(dome.indexOf('= `') + 3, dome.lastIndexOf('`;'));
  const back = nowSk.replace("import { DOME_COLOUR_GLSL } from './domeColour.ts';\n", '').replace('${DOME_COLOUR_GLSL}', body).replace("'uClear' | 'uHorizonFog', THREE.IUniform>> {", "'uClear', THREE.IUniform>> {").replace("'uClear' | 'uHorizonFog', THREE.IUniform>;", "'uClear', THREE.IUniform>;");
  ok(back === sk, `the dome's text is ${PRE_PASS}'s to the byte with DOME_COLOUR_GLSL laid back (only domeUniforms' type gains uHorizonFog)`);
}
void groundH;

console.log(`\nhorizonShaders: ${checks} checks passed`);
