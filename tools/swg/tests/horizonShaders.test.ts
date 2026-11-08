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
import { HORIZON_RING_FUNCTIONS, HORIZON_RING_VERTEX, RING_TEXT } from '../../../src/world/horizon/horizonRings.ts';
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
const fragmentText = `${THREE_PREFIX}${RING_TEXT.FRAGMENT_PARS}\nvoid main() {\n${RING_TEXT.FRAGMENT_TOP}\n${RING_TEXT.FRAGMENT_MAP}\n${RING_TEXT.FRAGMENT_NORMAL}\n${RING_TEXT.FRAGMENT_CLOUDS}\n${RING_TEXT.FRAGMENT_FADE}\n${RING_TEXT.FRAGMENT_VIEW}\n}`;
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
const tex = (g: BakeGrid) => ({ g });
const env: Record<string, unknown> = {
  ...GLSL_SCALARS,
  ivec2: (x: number, y: number) => ({ x, y }),
  vec2: (x: number, y: number) => ({ x, y }),
  vec3: (x: number, y: number, z: number) => ({ x, y, z }),
  length: (v: { x: number; y: number }) => Math.hypot(v.x, v.y),
  log2: Math.log2,
  texelFetch: (t: { g: BakeGrid }, p: { x: number; y: number }) => ({ r: t.g.h[p.y * t.g.nx + p.x] }),
  uHorizonFine: { x: fineG.x0, y: fineG.z0, z: fineG.step, w: 0 },
  uHorizonCoarse: { x: coarseG.x0, y: coarseG.z0, z: coarseG.step, w: 0 },
  uHorizonSizes: { x: fineG.nx, y: fineG.nz, z: coarseG.nx, w: coarseG.nz },
  uHorizonFineH: tex(fineG),
  uHorizonCoarseH: tex(coarseG),
};
const G = glslFunctions(HORIZON_RING_FUNCTIONS, ['ringDistLevel', 'ringEdgeLevel', 'ringSnap', 'ringMorph', 'ringEdgeDistance', 'ringDrop', 'ringReach', 'bakeHeight'], env);
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
  uHorizonCoarse: { x: coarseV.x0, y: coarseV.z0, z: 64, w: 0 },
  uHorizonSizes: { x: fineV.nx, y: fineV.nz, z: coarseV.nx, w: coarseV.nz },
  uHorizonFineH: tex(fineV),
  uHorizonCoarseH: tex(coarseV),
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
  ok(laidBack(nowTt, 'GROUND_CLOUD_GLSL') === tt, `the tile program's text is ${PRE_PASS}'s to the byte with GROUND_CLOUD_GLSL laid back (its key unchanged)`);
  const nowSk = fold(readFileSync(new URL('../../../src/world/sky.ts', import.meta.url), 'utf8'));
  const dome = fold(readFileSync(new URL('../../../src/world/domeColour.ts', import.meta.url), 'utf8'));
  const body = dome.slice(dome.indexOf('= `') + 3, dome.lastIndexOf('`;'));
  const back = nowSk.replace("import { DOME_COLOUR_GLSL } from './domeColour.ts';\n", '').replace('${DOME_COLOUR_GLSL}', body).replace("'uClear' | 'uHorizonFog', THREE.IUniform>> {", "'uClear', THREE.IUniform>> {").replace("'uClear' | 'uHorizonFog', THREE.IUniform>;", "'uClear', THREE.IUniform>;");
  ok(back === sk, `the dome's text is ${PRE_PASS}'s to the byte with DOME_COLOUR_GLSL laid back (only domeUniforms' type gains uHorizonFog)`);
}
void groundH;

console.log(`\nhorizonShaders: ${checks} checks passed`);
