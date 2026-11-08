// The horizon pass's second wave: the far tree cards stand on the drawn ring (DESIGN.md §2.9, §4 Tests). `ringSurfaceAt`
// against the ring's vertex stage run as script from its own text over level-0 patches, the triangle under a point taken
// from the patch geometry's own index (never the bilinear); the far cards a far tile places with the field's surface
// standing on it at every card of five far tiles of a baked world; and on every baked world, the cards' reach on the
// ground inside level 0's unmorphed band, so no card stands where the drawn ring has morphed under it.
//
// Run: node tools/swg/tests/horizonCards.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HORIZON_RING_FUNCTIONS, HORIZON_RING_VERTEX, patchGeometry } from '../../../src/world/horizon/horizonRings.ts';
import * as THREE from 'three';
import { HORIZON_TUNE, LEAF, PATCH, RingHole, newReachRules, newRingSurface, reachRules, ringCardSurface, ringHoleMoved, ringSurfaceAt, type BakeGrid } from '../../../src/world/horizon/horizonMath.ts';
import { HorizonField, heightsAtlas } from '../../../src/world/horizon/horizonField.ts';
import { CHUNK_TREES, FarCards, grassMaterial, type GrassHost } from '../../../src/world/grass.ts';
import { FAR_CARD_DEFAULTS, candidateCapacity, farReach, placeFarCards, placeStats, tuftBuffers, type GrassSource, type GrassWorld } from '../../../src/world/grassMath.ts';
import { readRadialFile } from '../../../src/swg/terrain/radialFile.ts';
import { shaderKey } from '../../../src/swg/terrain/shaderKey.ts';
import type { RadialChild } from '../../../src/swg/terrain/flora.ts';
import { groundChunkOrigin } from '../../../src/world/groundTiles.ts';
import { glslFunctions, GLSL_SCALARS } from './glslRun.ts';
import { rolling } from './horizonFixtures.ts';
import { bakedWorlds, loadBaked, packs } from './horizonWorld.ts';
import { parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

// ---- the surface against the vertex stage, run as script (as `horizonShaders.test.ts` runs it)
const grid = (x0: number, z0: number, step: number, n: number, f: (rx: number, rz: number) => number): BakeGrid => {
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = f(x0 + i * step, z0 + j * step);
  return { x0, z0, step, nx: n, nz: n, h };
};
const raw = (rx: number, rz: number) => rolling(-rx, rz);
const frame = { x: 1270, y: -3600, z: 1, w: 0 };
const fineV = grid(1270 - 12000, -3600 - 12000, 8, 3001, raw);
const coarseV = grid(1270 - 40000, -3600 - 40000, 64, 1251, raw);
const shift = { x: 1, z: 0 };
const square = { x: -380 * 1 + shift.x, y: -444 + shift.z, z: 420 + shift.x, w: 380 + shift.z };
const eye = { x: 0, y: 20, z: 0, w: 8000 };
const morph = { x: 1e6, y: 0.3, z: 1e6, w: 0 };
const drop = { x: 2.5, y: 256, z: 0, w: 16 };
const vertexFn = `${HORIZON_RING_FUNCTIONS}
vec3 gRingPos;
vec2 vRingRaw; vec3 vRingWorld; float vRingEdge; float vRingDist; float vRingLevel; vec2 vGroundUV;
void ringVertexMain( float px, float py, float pz, float ax, float ay, float az, float aw ) {
${HORIZON_RING_VERTEX.replace(/^#.*$/gm, '').replace(/position\.([xyz])/g, 'p$1').replace(/aRing\.([xyzw])/g, (_m, c: string) => `a${c}`)}
}
float outX() { return gRingPos.x; }
float outY() { return gRingPos.y; }
float outZ() { return gRingPos.z; }
`;
const V = glslFunctions(vertexFn, ['ringVertexMain', 'outX', 'outY', 'outZ'], {
  ...GLSL_SCALARS,
  ivec2: (x: number, y: number) => ({ x, y }),
  vec2: (x: number, y: number) => ({ x, y }),
  vec3: (x: number, y: number, z: number) => ({ x, y, z }),
  length: (v: { x: number; y: number }) => Math.hypot(v.x, v.y),
  log2: Math.log2,
  exp2: (x: number) => 2 ** x,
  // The heights atlas as the field makes it (the fine's rows, then the coarse's), read by texelFetch as the card does.
  texelFetch: (t: { w: number; h: Float32Array }, p: { x: number; y: number }) => ({ r: t.h[p.y * t.w + p.x] }),
  uHorizonFine: { x: fineV.x0, y: fineV.z0, z: 8, w: 0 },
  uHorizonCoarse: { x: coarseV.x0, y: coarseV.z0, z: 64, w: 3 },
  uHorizonSizes: { x: fineV.nx, y: fineV.nz, z: coarseV.nx, w: coarseV.nz },
  uHorizonHeights: { w: Math.max(fineV.nx, coarseV.nx), h: heightsAtlas(fineV.h, fineV.nx, fineV.nz, coarseV.h, coarseV.nx, coarseV.nz) },
  uHorizonEye: eye,
  uHorizonSquare: square,
  uHorizonMorph: morph,
  uHorizonDrop: drop,
  uHorizonGrid: { x: shift.x, y: shift.z, z: 0, w: 0 },
  uGroundFrame: frame,
  ringNormalAt: () => ({ x: 0, y: 1, z: 0 }),
});
const surf = newRingSurface();
Object.assign(surf, { fine: fineV, coarse: coarseV, cx: frame.x, cz: frame.y, sx: shift.x, sz: shift.z, sq0: square.x, sq1: square.y, sq2: square.z, sq3: square.w, drop: drop.x, fade: drop.y, everywhere: drop.z });
// The patch's own triangles, from its index (a quad's two in its own order).
const patch = patchGeometry(1).geometry;
const idx = patch.index!.array as ArrayLike<number>;
const P = PATCH + 1;
let seed = 31;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
let worst = 0;
let placeBad = 0;
let tested = 0;
for (let k = 0; k < 400; k++) {
  // A level-0 node just outside the hole's square, so the drop's fade band is in it.
  const nx = shift.x + LEAF * Math.floor((square.z + rnd() * 300) / LEAF);
  const nz = shift.z + LEAF * Math.floor((square.y + (rnd() * 2 - 1) * 400) / LEAF);
  const vert = (i: number, j: number): [number, number, number] => {
    V.ringVertexMain(i, 0, j, nx, nz, 0, 0);
    return [V.outX(), V.outY(), V.outZ()];
  };
  const q = LEAF / PATCH;
  const gx = nx + rnd() * LEAF * 0.999;
  const gz = nz + rnd() * LEAF * 0.999;
  // The triangle of the patch's own index holding the point, by barycentric weights.
  let h = Number.NaN;
  for (let t = 0; t < idx.length; t += 3) {
    const vs = [idx[t], idx[t + 1], idx[t + 2]].map((v) => vert(v % P, Math.floor(v / P)));
    const [a, b, c] = vs;
    const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    const l1 = ((b[2] - c[2]) * (gx - c[0]) + (c[0] - b[0]) * (gz - c[2])) / det;
    const l2 = ((c[2] - a[2]) * (gx - c[0]) + (a[0] - c[0]) * (gz - c[2])) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    for (const v of vs) if (Math.abs(v[0] - (nx + Math.round((v[0] - nx) / q) * q)) > 1e-6) placeBad++;
    h = l1 * a[1] + l2 * b[1] + l3 * c[1];
    break;
  }
  tested++;
  worst = Math.max(worst, Math.abs(h - ringSurfaceAt(surf, gx, gz)));
}
ok(placeBad === 0, 'the vertex stage stands every level-0 vertex unmorphed on its lattice (the surface reads them there)');
ok(worst < 1e-6, `ringSurfaceAt is the drawn ring: the vertex stage's own heights over the patch's own triangle, at ${tested} points by the hole's edge (worst ${worst.toExponential(2)} m)`);

// ---- W2's review: the hole the far cards read moves with each of its six numbers, and the card surface reads it at each call
{
  const T = { drop: HORIZON_TUNE.drop, dropFade: HORIZON_TUNE.dropFade, dropAt: 'edge' };
  const h = new RingHole();
  ringHoleMoved(h, 3, -2, 6, T);
  const each = [ringHoleMoved(h, 4, -2, 6, T), ringHoleMoved(h, 4, -1, 6, T), ringHoleMoved(h, 4, -1, 7, T), ringHoleMoved(h, 4, -1, 7, { ...T, drop: T.drop + 1 }), ringHoleMoved(h, 4, -1, 7, { ...T, drop: T.drop + 1, dropFade: T.dropFade + 8 }), ringHoleMoved(h, 4, -1, 7, { drop: T.drop + 1, dropFade: T.dropFade + 8, dropAt: 'everywhere' })];
  ok(each.every((m) => m) && !ringHoleMoved(h, 4, -1, 7, { drop: T.drop + 1, dropFade: T.dropFade + 8, dropAt: 'everywhere' }), 'ringHoleMoved: the chunk either way, the view radius, the drop, its fade and where it applies each move the hole, and nothing else does');
  const asked: number[] = [];
  const hole = new RingHole();
  const at = ringCardSurface({ surfaceAt: (_x, _z, px, pz, vr) => (asked.push(px, pz, vr), 0) }, hole, 130, -70, () => 9);
  at(0, 0);
  ringHoleMoved(hole, 5, 6, 7, T);
  at(0, 0);
  ok(asked.join() === '2,-2,9,5,6,7', `ringCardSurface: before the stream the tile's own chunk and the view radius, then the hole as it stands at each call (${asked.join()})`);
}

// ---- the far cards of a baked world stand on the surface
const worlds = bakedWorlds(['naboo', 'tatooine', 'mustafar']);
if (!worlds.length) note('no baked world on disk: the cards half is skipped');
else {
  const w = (await loadBaked(worlds[0]))!;
  const swg = w.swg;
  const radialJson = join(w.dir, 'terrain/radial.json');
  const file = existsSync(radialJson) ? readRadialFile(JSON.parse(readFileSync(radialJson, 'utf8'))) : null;
  const keys = new Map<RadialChild, string>();
  for (const f of swg.template.generator.radialGroup.families.values()) for (const ch of f.children) keys.set(ch, shaderKey(ch.shader));
  const shaders = file?.shaders ?? new Map([...keys.values()].map((k, i) => [k, { layer: i, near: true, far: true, alphaRef: 0, kind: 'plain' as const, width: 256, height: 256 }]));
  const gworld: GrassWorld = { group: swg.template.generator.radialGroup, shaders, keyOf: (ch) => keys.get(ch)! };
  const far = swg.template.flora.farRadial;
  const s = newRingSurface();
  const H = w.header;
  Object.assign(s, { fine: { x0: H.fine.x0, z0: H.fine.z0, step: H.fine.step, nx: H.fine.nx, nz: H.fine.nz, h: w.fine }, coarse: { x0: H.coarse.x0, z0: H.coarse.z0, step: H.coarse.step, nx: H.coarse.nx, nz: H.coarse.nz, h: w.coarse }, cx: w.centre.x, cz: w.centre.z, sx: swg.groundShift.x, sz: swg.groundShift.z, sq0: -448 + swg.groundShift.x, sq1: -448 + swg.groundShift.z, sq2: 512 + swg.groundShift.x, sq3: 512 + swg.groundShift.z, drop: HORIZON_TUNE.drop, fade: HORIZON_TUNE.dropFade, everywhere: 0 });
  let cards = 0;
  let off = 0;
  for (const [tx, tz] of [[1, 0], [-2, 1], [0, -2], [2, 2], [-1, -1]]) {
    const o = groundChunkOrigin(tx, tz, swg.groundShift, 512);
    const g = swg.farGrid(o.x, o.z, 512, 32, true)!;
    const b = tuftBuffers(candidateCapacity(far, 512));
    const n = placeFarCards(swg as unknown as GrassSource, gworld, far, o.x, o.z, 512, { heights: g.heights, colors: g.colors, radialFar: g.radialFar, n: 35, step: 16, gx0: o.x - 16, gz0: o.z - 16, surfaceAt: (x, z) => ringSurfaceAt(s, x, z) }, 2.5, () => [], FAR_CARD_DEFAULTS, b, placeStats());
    for (let c = 0; c < n; c++) {
      const x = b.tuft[c * 4];
      const y = b.tuft[c * 4 + 1];
      const z = b.tuft[c * 4 + 2];
      cards++;
      if (Math.abs(y - Math.fround(ringSurfaceAt(s, x, z))) > 1e-3) off++;
    }
  }
  if (cards) ok(off === 0, `${w.name}: all ${cards} far cards of five far tiles stand on the ring's own surface (its triangle less its drop)`);
  else note(`${w.name}: no far card stands on these five far tiles (its far families are bare there)`);

  // W2's review: a card stands on the ring round the hole as it stands when the card is placed (its tile built later than
  // its samples were taken) and is stood again when the hole moves, through the world's own pieces: the field's own
  // `surfaceAt`, `ringCardSurface` reading the world's hole record, `ringHoleMoved` and `FarCards.restand`.
  const field = new HorizonField(w.name, w.centre, swg.groundShift);
  Object.assign(field.surface, { fine: s.fine, coarse: s.coarse, cx: w.centre.x, cz: w.centre.z, sx: swg.groundShift.x, sz: swg.groundShift.z });
  const VR = 6;
  const host: GrassHost = { circlesFor: () => {}, adopt: () => {}, chunkTrees: () => CHUNK_TREES.none, cascadeOf: () => 0 };
  const file2 = file ?? readRadialFile({ radialFormat: 1, size: 256, layers: 4, shaders: Object.fromEntries(shaders) })!;
  let tried = 0;
  for (const [tx, tz] of [[1, 0], [-2, 1], [0, -2], [2, 2], [-1, -1]]) {
    const o = groundChunkOrigin(tx, tz, swg.groundShift, 512);
    const g = swg.farGrid(o.x, o.z, 512, 32, true)!;
    // The hole's east edge on the tile's west edge, its z span over the tile: every card in the drop's band.
    const pcx = Math.round((o.x - swg.groundShift.x) / LEAF) - VR - 2;
    const pcz = Math.floor((o.z + 256) / LEAF);
    const hole = new RingHole();
    ok(ringHoleMoved(hole, pcx, pcz, VR, HORIZON_TUNE) && !ringHoleMoved(hole, pcx, pcz, VR, HORIZON_TUNE), 'ringHoleMoved: the first write moves the hole and the same again does not');
    const samples = { heights: g.heights, colors: g.colors, radialFar: g.radialFar, n: 35, step: 16, gx0: o.x - 16, gz0: o.z - 16, surfaceAt: ringCardSurface(field, hole, o.x, o.z, () => VR) };
    const cards = new FarCards(grassMaterial(), host, new THREE.Group(), 512, 2.5);
    cards.setWorld({ src: swg as unknown as GrassSource, world: gworld, file: file2, near: swg.template.flora.radial, far, shift: swg.groundShift, reference: null });
    cards.tileMade(tx, tz, o.x, o.z, samples);
    // The hole moves two chunks east before the tile is built (its samples taken at the old hole).
    ok(ringHoleMoved(hole, pcx + 2, pcz, VR, HORIZON_TUNE), 'ringHoleMoved: a chunk step moves the hole');
    cards.update(new THREE.Vector3(o.x + 256, 0, o.z + 256), Infinity);
    const mesh = cards.meshes[0];
    if (!mesh) continue;
    tried++;
    const tuft = mesh.geometry.getAttribute('aSwgTuft') as THREE.InstancedBufferAttribute;
    const arr = tuft.array as Float32Array;
    const offBy = (px: number): { worst: number; n: number } => {
      let worst = 0;
      for (let c = 0; c < tuft.count; c++) worst = Math.max(worst, Math.abs(arr[c * 4 + 1] - Math.fround(field.surfaceAt(arr[c * 4], arr[c * 4 + 2], px, pcz, VR))));
      return { worst, n: tuft.count };
    };
    const built = offBy(pcx + 2);
    ok(built.worst < 1e-3, `${w.name}: ${built.n} cards of a tile built after the hole moved stand on the ring round the hole as it stands now (worst ${built.worst.toFixed(4)} m)`);
    // And the hole moves back: the cards stand round the old hole only once stood again.
    ringHoleMoved(hole, pcx, pcz, VR, HORIZON_TUNE);
    const stale = offBy(pcx);
    const was = tuft.version;
    const moved = cards.restand();
    const after = offBy(pcx);
    ok(stale.worst > 0.5 && moved > 0 && after.worst < 1e-3 && tuft.version > was, `${w.name}: the hole moved two chunks, the cards stood ${stale.worst.toFixed(2)} m off the ring until stood again (${moved} moved, worst after ${after.worst.toFixed(4)} m) and the attribute marked for upload`);
    const still = tuft.version;
    ok(cards.restand() === 0 && tuft.version === still, 'stood again with the hole still, nothing moves and nothing is uploaded');
    break;
  }
  if (!tried) note(`${w.name}: no far card stands on these five far tiles: the hole's move is not checked here`);
}
// The cards' reach on the ground is inside level 0's unmorphed band, on every baked world's own far tiling, at every view
// radius the page offers: a card stands where the drawn ring is level 0 unmorphed (its far grids reach no further).
const r = newReachRules();
const reachOut: string[] = [];
for (const name of worlds) {
  const t = parseTerrainTemplate(new Uint8Array(readFileSync(join(packs, name, 'terrain.trn'))));
  const reach = Math.min(farReach(t.flora.farRadial, FAR_CARD_DEFAULTS), (HORIZON_TUNE.farGridRadius + 1) * 512 * Math.SQRT2);
  for (const vr of [3, 6, 9]) {
    reachRules(HORIZON_TUNE, vr, true, r);
    if (reach > r.lod0 * (1 - HORIZON_TUNE.morph)) reachOut.push(`${name} at ${vr} chunks: ${Math.round(reach)} m past ${Math.round(r.lod0 * (1 - HORIZON_TUNE.morph))} m`);
  }
}
ok(reachOut.length === 0, `the far cards' reach on the ground is inside level 0's unmorphed band on every baked world (${worlds.join(', ') || 'none'})${reachOut.length ? `: ${reachOut.join('; ')}` : ''}`);

console.log(`\nhorizonCards: ${checks} checks passed`);
