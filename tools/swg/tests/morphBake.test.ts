// The GPU port's pass 1, wave 4, item 1 (`A:\swg3js\port\PASS1-W4.md`): the morph bake (`src/core/gpu/morphBake.ts`).
//
//  1. the maths: a baked position is three's own CPU morph (`Mesh.getVertexPosition`) of the same vertex to the float, for
//     relative and absolute targets, padded zero targets, influences at nought and targets three reads through `getX`
//     (normalised integers); a baked normal is the same function run over the normals (three morphs normals on the card
//     alone, by the same sum); and the card's own order of operations (`morphReference`, float by float) lands within a
//     hundredth of a millimetre of it;
//  2. the bake's geometry: no morph attributes; every other attribute and the index its own objects over the source's very
//     arrays; the groups, the draw range and `userData` the source's by reference; and three's own geometry key (the
//     build's `RenderObject.getGeometryCacheKey`, run as text) the same for two looks of different weights where the
//     sources' keys differ by their morph attributes;
//  3. shared by clones: a prototype baked once in play, and a clone (`cloneShared`, the mobiles' own) drawing that very
//     geometry, adopted again without a second bake;
//  4. the previews untouched: a preview's clone (three's `SkeletonUtils.clone`, the doll's) handed the live source, its
//     index brought up to the occlusion's, its influences the character's; the character in the world still baked;
//  5. out of play nothing baked, a baked body handed its source on leaving play and its own bake again on coming back;
//  6. a slider moved in play baked again on the next frame, in place (the same geometry and arrays, their versions moved),
//     three's morph to the float; a frame with nothing moved moves nothing;
//  7. the switch (`setMorphBake`) off and on over a scene of clones;
//  8. a look let go of (its bake disposed): its bytes gone, its slot let go, another look's bake of the same source untouched;
//  9. nothing allocated in a frame (`morphBakeFrame` over three hundred watched meshes, `adoptMorphs` over meshes it leaves),
//     in twelve fresh processes at once (`--alloc`).
//
// Run: node tools/swg/tests/morphBake.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { adoptMorphs, bakeFor, makeBake, MORPH_BAKE_STATS, morphBakeFrame, morphBakeReport, refuseWhy, resetMorphBakeForTests, setMorphBake, setMorphPlay, unbakeClone } from '../../../src/core/gpu/morphBake.ts';
import { GPU_KEYS } from '../../../src/core/gpu/gpuKeys.ts';
import { cloneShared } from '../../../src/world/mobiles/cloneShared.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};

/** A seeded random, so every run bakes the same bodies. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A body part as the converter and the loader make one: positions, normals, uvs, float joints and weights, an index, and
 * `targets` morph targets of positions and normals of which the last `pad` are the ladder's zero padding (one zero array).
 */
function part(seed: number, vertices: number, targets: number, pad: number, opts: { relative?: boolean; normalisedTargets?: boolean } = {}): THREE.BufferGeometry {
  const r = rng(seed);
  const g = new THREE.BufferGeometry();
  const f = (n: number, s = 1) => Float32Array.from({ length: n }, () => (r() * 2 - 1) * s);
  g.setAttribute('position', new THREE.BufferAttribute(f(vertices * 3, 0.9), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(f(vertices * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from({ length: vertices * 2 }, () => r()), 2));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(Float32Array.from({ length: vertices * 4 }, () => Math.floor(r() * 53)), 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(Float32Array.from({ length: vertices * 4 }, () => r()), 4));
  const tris = Math.floor(vertices / 3) * 3;
  g.setIndex(new THREE.BufferAttribute(Uint16Array.from({ length: tris }, (_, i) => i), 1));
  g.morphAttributes.position = [];
  g.morphAttributes.normal = [];
  const zeros = new Float32Array(vertices * 3);
  for (let i = 0; i < targets; i++) {
    if (i >= targets - pad) {
      g.morphAttributes.position.push(new THREE.BufferAttribute(zeros, 3));
      g.morphAttributes.normal.push(new THREE.BufferAttribute(zeros, 3));
      continue;
    }
    if (opts.normalisedTargets) {
      // Three reads a normalised integer target through `getX`, denormalised.
      g.morphAttributes.position.push(new THREE.BufferAttribute(Int16Array.from({ length: vertices * 3 }, () => Math.round((r() * 2 - 1) * 32767)), 3, true));
    } else g.morphAttributes.position.push(new THREE.BufferAttribute(f(vertices * 3, 0.05), 3));
    g.morphAttributes.normal.push(new THREE.BufferAttribute(f(vertices * 3, 0.3), 3));
  }
  g.morphTargetsRelative = opts.relative ?? true;
  return g;
}

/** Influences as a look sets them: some at nought, the padding at nought. */
function weights(seed: number, targets: number, pad: number): number[] {
  const r = rng(seed);
  return Array.from({ length: targets }, (_, i) => (i >= targets - pad ? 0 : r() < 0.3 ? 0 : r()));
}

/** Three's own CPU morph of every vertex of `attr` (its `getVertexPosition` on a plain mesh), as floats. */
function threeMorph(g: THREE.BufferGeometry, inf: number[], which: 'position' | 'normal'): Float32Array {
  const stand = new THREE.BufferGeometry();
  stand.setAttribute('position', g.attributes[which]);
  stand.morphAttributes.position = g.morphAttributes[which];
  stand.morphTargetsRelative = g.morphTargetsRelative;
  const mesh = new THREE.Mesh(stand);
  mesh.morphTargetInfluences = inf.slice();
  const out = new Float32Array(g.attributes[which].count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < g.attributes[which].count; i++) {
    mesh.getVertexPosition(i, v);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

/** Whether two float arrays are the same bits. */
function sameFloats(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/** The card's own order (`morphReference`): the base times the base influence, then each target at a nonzero influence added, float by float. */
function cardMorph(g: THREE.BufferGeometry, inf: number[], which: 'position' | 'normal'): Float32Array {
  const fr = Math.fround;
  const base = g.attributes[which];
  const targets = g.morphAttributes[which];
  const k = g.morphTargetsRelative ? 1 : fr(1 - inf.reduce((a, b) => a + b, 0));
  const out = new Float32Array(base.count * 3);
  for (let v = 0; v < base.count; v++) {
    for (let c = 0; c < 3; c++) {
      let x = fr(base.getComponent(v, c) * k);
      for (let i = 0; i < targets.length; i++) {
        const w = fr(inf[i]);
        if (w === 0) continue;
        x = fr(x + fr(targets[i].getComponent(v, c) * w));
      }
      out[v * 3 + c] = x;
    }
  }
  return out;
}

/** A skinned body of some parts on one skeleton of 53 bones, its influences set, as a look's prototype stands. */
function body(seed: number, parts: { vertices: number; targets: number; pad: number }[]): THREE.Group {
  const group = new THREE.Group();
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < 53; i++) {
    const b = new THREE.Bone();
    b.name = `bone${i}`;
    if (i) bones[i - 1].add(b);
    bones.push(b);
  }
  group.add(bones[0]);
  const skeleton = new THREE.Skeleton(bones);
  parts.forEach((p, i) => {
    const g = part(seed + i * 17, p.vertices, p.targets, p.pad);
    const m = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
    m.name = `part${i}`;
    m.morphTargetInfluences = weights(seed + i * 31, p.targets, p.pad);
    m.morphTargetDictionary = Object.fromEntries(Array.from({ length: p.targets }, (_, k) => [`blend_${k}`, k]));
    group.add(m);
    m.bind(skeleton);
  });
  group.updateMatrixWorld(true);
  return group;
}

function meshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh);
  });
  return out;
}

const adoptAll = (root: THREE.Object3D): void => root.traverse((o) => adoptMorphs(o));

// ---------------------------------------------------------------- 9 (child). what a frame allocates, in a process of its own
if (process.argv.includes('--alloc')) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as Any).gc as (o?: unknown) => void;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  /** The least of three clean windows (`testing.md`): a window a collection fell in is taken again. */
  const least = async (step: () => void, n: number): Promise<number> => {
    let best = Number.POSITIVE_INFINITY;
    for (let w = 0; w < 3; w++) {
      for (let tries = 0; tries < 6; tries++) {
        for (let i = 0; i < 2000; i++) step();
        gc({ type: 'minor' });
        await turn();
        await turn();
        const c0 = collections;
        const b = young();
        for (let i = 0; i < n; i++) step();
        const a = young();
        await turn();
        await turn();
        if (collections === c0) {
          best = Math.min(best, (a - b) / n);
          break;
        }
      }
    }
    return best;
  };
  resetMorphBakeForTests();
  setMorphPlay(true);
  // A crowd's worth of looks baked directly: 60 prototypes of 5 parts (300 watched meshes), and 200 clones in a scene.
  const scene = new THREE.Scene();
  const protos: THREE.Group[] = [];
  for (let i = 0; i < 60; i++) {
    const g = body(100 + i, [
      { vertices: 120, targets: 7, pad: 4 },
      { vertices: 90, targets: 33, pad: 5 },
      { vertices: 60, targets: 7, pad: 3 },
      { vertices: 45, targets: 7, pad: 4 },
      { vertices: 30, targets: 7, pad: 4 },
    ]);
    // Stood in the scene, as the player and the peers are: read once a frame.
    scene.add(g);
    adoptAll(g);
    protos.push(g);
  }
  for (let i = 0; i < 200; i++) scene.add(cloneShared(protos[i % protos.length]));
  const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const sceneMeshes: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) sceneMeshes.push(o);
  });
  sceneMeshes.push(plain);
  let k = 0;
  const out: Record<string, number> = {};
  // Windows of 20,000: the heap reading itself makes about 2.3 KB (	esting.md), 1.2 B a call over 2,000.
  out.frame = await least(() => morphBakeFrame(), 20000);
  out.adopt = await least(() => {
    adoptMorphs(sceneMeshes[k]);
    k = k + 1 === sceneMeshes.length ? 0 : k + 1;
  }, 20000);
  setMorphPlay(false);
  out.frameOutOfPlay = await least(() => morphBakeFrame(), 20000);
  console.log(JSON.stringify(out));
  process.exit(0);
}

// ---------------------------------------------------------------- 1. the maths
{
  resetMorphBakeForTests();
  const cases: [string, THREE.BufferGeometry, number[]][] = [
    ['a relative body part, 7 targets of which 4 the padding', part(1, 300, 7, 4), weights(2, 7, 4)],
    ['a relative head, 33 targets', part(3, 433, 33, 6), weights(4, 33, 6)],
    ['absolute targets', part(5, 200, 7, 2, { relative: false }), weights(6, 7, 2)],
    ['normalised integer targets (read through getX)', part(7, 150, 4, 1, { normalisedTargets: true }), weights(8, 4, 1)],
    ['every influence at nought', part(9, 120, 7, 4), new Array(7).fill(0)],
    ['every influence at one', part(11, 120, 7, 0), new Array(7).fill(1)],
  ];
  for (const [name, g, inf] of cases) {
    const b = makeBake(g, inf);
    const wantP = threeMorph(g, inf, 'position');
    const wantN = threeMorph(g, inf, 'normal');
    ok(sameFloats(b.position!.array as Float32Array, wantP), `${name}: every baked position is three's own CPU morph of it, to the float`);
    ok(sameFloats(b.normal!.array as Float32Array, wantN), `${name}: every baked normal is three's morph run over the normals, to the float`);
    const card = cardMorph(g, inf, 'position');
    let worst = 0;
    for (let i = 0; i < card.length; i++) worst = Math.max(worst, Math.abs(card[i] - wantP[i]));
    ok(worst < 1e-5, `${name}: the card's own order of operations lands within a hundredth of a millimetre of the bake (${worst.toExponential(2)} m)`);
  }
  // What cannot be baked is left live, by why.
  const colours = part(13, 30, 3, 0);
  colours.morphAttributes.color = [new THREE.BufferAttribute(new Float32Array(90), 3)];
  ok(refuseWhy(colours, [0, 0, 0]) === 'colour targets', 'a geometry with colour targets is left live');
  ok(refuseWhy(part(14, 30, 7, 0), [0, 0]) === 'fewer influences than targets', 'influences shorter than the targets are left live');
  const inter = part(15, 30, 3, 0);
  inter.setAttribute('uv', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Float32Array(30 * 4), 4), 2, 0));
  ok(refuseWhy(inter, [0, 0, 0]) === 'an interleaved attribute', 'an interleaved attribute is left live (its buffer would be shared)');
  ok(refuseWhy(part(16, 30, 3, 0), [0.5, 0, 1]) === '', 'a body part is baked');
}

// ---------------------------------------------------------------- 2. the bake's geometry, and three's own geometry key
{
  resetMorphBakeForTests();
  const g = part(21, 120, 7, 4);
  g.addGroup(0, 60, 0);
  g.userData.zones = [1, 2, 3];
  const b = makeBake(g, weights(22, 7, 4));
  const d = b.baked;
  ok(Object.keys(d.morphAttributes).length === 0, 'the bake carries no morph attributes');
  ok(bakeFor(d) === b && bakeFor(g) === null, 'a baked geometry is known as its bake, the source as none');
  for (const name of ['uv', 'skinIndex', 'skinWeight']) {
    const a = d.attributes[name] as THREE.BufferAttribute;
    const s = g.attributes[name] as THREE.BufferAttribute;
    ok(a !== s && a.array === s.array && a.itemSize === s.itemSize && a.normalized === s.normalized && a.gpuType === s.gpuType, `${name}: an attribute of the bake's own over the source's very array`);
  }
  ok(d.index !== g.index && d.index!.array === g.index!.array, "the index: the bake's own over the source's array");
  ok(d.groups === g.groups && d.drawRange === g.drawRange && d.userData === g.userData, "the groups, the draw range and userData are the source's by reference");
  ok(d.attributes.position !== g.attributes.position && d.attributes.normal !== g.attributes.normal, 'the positions and normals are its own');
  ok(b.bytes === 120 * 24 && b.cardBytes === 120 * (12 + 12 + 8 + 16 + 16) + d.index!.array.byteLength, 'its bytes: 24 a vertex baked, and its whole copy on the card counted');
  // Three's own geometry key, its text out of the build the game loads.
  const req = createRequire(import.meta.url);
  const build = readFileSync(join(dirname(req.resolve('three')), '..', 'build', 'three.webgpu.js'), 'utf8');
  const at = build.indexOf('\tgetGeometryCacheKey() {');
  ok(at > 0, "the build's RenderObject.getGeometryCacheKey is found");
  const end = build.indexOf('\n\t}\n', at);
  const body = build.slice(build.indexOf('{', at) + 1, end);
  const geometryKey = new Function(`return function () {${body}\n};`)() as (this: { geometry: THREE.BufferGeometry }) => string;
  const g2 = part(23, 120, 7, 4);
  const b1 = makeBake(g, weights(24, 7, 4));
  const b2 = makeBake(g2, weights(25, 7, 4));
  const kSrc1 = geometryKey.call({ geometry: g });
  const kSrc2 = geometryKey.call({ geometry: g2 });
  ok(kSrc1 !== kSrc2 && kSrc1.includes('morph-position'), "two sources of one layout are keyed apart by three on their morph attributes' ids");
  ok(geometryKey.call({ geometry: b1.baked }) === geometryKey.call({ geometry: b2.baked }), 'their bakes, of other weights, are one key to three');
  ok(!geometryKey.call({ geometry: b1.baked }).includes('morph'), 'and a bake keys no morph attribute');
}

// ---------------------------------------------------------------- 3. shared by clones
{
  resetMorphBakeForTests();
  setMorphPlay(true);
  const proto = body(31, [
    { vertices: 120, targets: 7, pad: 4 },
    { vertices: 90, targets: 33, pad: 5 },
  ]);
  const sources = meshes(proto).map((m) => m.geometry);
  adoptAll(proto);
  const baked = meshes(proto).map((m) => m.geometry);
  ok(baked.every((g, i) => bakeFor(g)?.source === sources[i]), "the prototype's parts are baked, each from its own source");
  ok(MORPH_BAKE_STATS.made === 2, 'two bakes made');
  const clones = [cloneShared(proto), cloneShared(proto), cloneShared(proto)];
  ok(clones.every((c) => meshes(c).every((m, i) => m.geometry === baked[i])), "every clone draws the prototype's very bake");
  for (const c of clones) adoptAll(c);
  ok(MORPH_BAKE_STATS.made === 2 && clones.every((c) => meshes(c).every((m, i) => m.geometry === baked[i])), 'adopted again, the clones make no bake of their own');
  // The influences three would still read on the card are the drawn ones: the bake holds them.
  ok(meshes(proto).every((m) => sameFloats(bakeFor(m.geometry)!.position!.array as Float32Array, threeMorph(bakeFor(m.geometry)!.source, m.morphTargetInfluences!, 'position'))), "the prototype's bake is three's morph of its own influences");
}

// ---------------------------------------------------------------- 4. the previews untouched
{
  resetMorphBakeForTests();
  setMorphPlay(true);
  const character = body(41, [
    { vertices: 120, targets: 7, pad: 4 },
    { vertices: 90, targets: 33, pad: 5 },
  ]);
  const sources = meshes(character).map((m) => m.geometry);
  adoptAll(character);
  const world = meshes(character);
  // The occlusion swaps the drawn geometry's index for a culled one, as `Character.cull` does with `setIndex`.
  const culled = new THREE.BufferAttribute(Uint16Array.from([0, 1, 2, 3, 4, 5]), 1);
  world[0].geometry.setIndex(culled);
  const copy = cloneSkinned(character);
  unbakeClone(copy);
  const dolls = meshes(copy);
  ok(dolls.every((m, i) => m.geometry === sources[i]), "the preview's clone draws the live sources");
  ok(dolls.every((m) => (m.geometry.morphAttributes.position?.length ?? 0) > 0), 'with their morph targets');
  ok(dolls.every((m, i) => m.morphTargetInfluences!.every((v, k) => v === world[i].morphTargetInfluences![k])), "and the character's influences");
  ok(sources[0].index === culled, "the source's index brought up to the occlusion's before it was handed over");
  ok(world.every((m, i) => bakeFor(m.geometry)?.source === sources[i]), 'the character in the world is still drawn baked');
  // The doll follows a slider live: its own influences, its own context's morph; the world's bake follows on the next frame.
  dolls[1].morphTargetInfluences![0] = 0.75;
  ok(dolls[1].geometry === sources[1], 'a slider moved on the doll moves the live source, nothing baked');
}

// ---------------------------------------------------------------- 5. out of play
{
  resetMorphBakeForTests();
  const figure = body(51, [{ vertices: 120, targets: 7, pad: 4 }]);
  const stage = new THREE.Scene();
  stage.add(figure);
  const [m] = meshes(figure);
  const source = m.geometry;
  adoptAll(figure);
  ok(m.geometry === source && MORPH_BAKE_STATS.made === 0, 'out of play (the creator, the select screen) nothing is baked');
  setMorphPlay(true);
  adoptAll(figure);
  const baked = m.geometry;
  ok(bakeFor(baked)?.source === source, 'in play it is baked as it is adopted');
  setMorphPlay(false);
  ok(m.geometry === source, 'leaving play hands it its live source');
  m.morphTargetInfluences![1] = 0.25;
  // Out of play the creator dresses the figure, and the occlusion swaps the index of the geometry the mesh draws.
  const dressed = new THREE.BufferAttribute(Uint16Array.from([2, 1, 0, 5, 4, 3]), 1);
  m.geometry.setIndex(dressed);
  setMorphPlay(true);
  ok(m.geometry === baked && MORPH_BAKE_STATS.made === 1, 'coming back it takes its own bake again, none made');
  ok(baked.index !== dressed && baked.index!.array === dressed.array, "the bake brought up to the index the source took out of play, an attribute of its own over the source's array");
  ok(sameFloats(bakeFor(baked)!.position!.array as Float32Array, threeMorph(source, m.morphTargetInfluences!, 'position')), 'baked again for the slider moved meanwhile');
  // A look's prototype stands in no scene: the first frame lets it go, and no frame reads it after.
  const proto = body(52, [{ vertices: 60, targets: 7, pad: 4 }]);
  adoptAll(proto);
  const [pm] = meshes(proto);
  const pb = bakeFor(pm.geometry)!;
  ok((morphBakeReport().readEachFrame as number) === 2, 'the figure and the prototype are read once a frame as they are baked');
  morphBakeFrame();
  ok((morphBakeReport().readEachFrame as number) === 1, 'the frame lets go of the prototype, out of every scene');
  const was = pb.weights[0];
  pm.morphTargetInfluences![0] = was === 0.5 ? 0.25 : 0.5;
  morphBakeFrame();
  ok(pb.weights[0] === was, 'and no frame reads it after');
  stage.add(proto);
  adoptAll(proto);
  morphBakeFrame();
  ok((morphBakeReport().readEachFrame as number) === 2 && sameFloats(pb.position!.array as Float32Array, threeMorph(pb.source, pm.morphTargetInfluences!, 'position')), 'hung in a scene and adopted again, it is read again, and baked for its weights');
}

// ---------------------------------------------------------------- 6. a slider moved in play
{
  resetMorphBakeForTests();
  setMorphPlay(true);
  const player = body(61, [
    { vertices: 300, targets: 7, pad: 4 },
    { vertices: 433, targets: 33, pad: 6 },
  ]);
  const world = new THREE.Scene();
  world.add(player);
  adoptAll(player);
  const parts = meshes(player);
  const before = parts.map((m) => ({ g: m.geometry, p: m.geometry.attributes.position, pv: (m.geometry.attributes.position as THREE.BufferAttribute).version, nv: (m.geometry.attributes.normal as THREE.BufferAttribute).version }));
  morphBakeFrame();
  ok(parts.every((m, i) => (m.geometry.attributes.position as THREE.BufferAttribute).version === before[i].pv), 'a frame with nothing moved writes nothing');
  // A slider: the body's waist and the head's matching target, as `setMorph` writes them.
  parts[0].morphTargetInfluences![1] = 0.9;
  parts[1].morphTargetInfluences![1] = 0.9;
  morphBakeFrame();
  ok(parts.every((m, i) => m.geometry === before[i].g && m.geometry.attributes.position === before[i].p), 'the next frame bakes it again in place: the same geometry, the same arrays');
  ok(parts.every((m, i) => (m.geometry.attributes.position as THREE.BufferAttribute).version > before[i].pv && (m.geometry.attributes.normal as THREE.BufferAttribute).version > before[i].nv), 'its positions and normals marked for upload');
  ok(parts.every((m) => sameFloats(m.geometry.attributes.position.array as Float32Array, threeMorph(bakeFor(m.geometry)!.source, m.morphTargetInfluences!, 'position'))), "three's morph of the new weights, to the float");
  ok(MORPH_BAKE_STATS.made === 2 && MORPH_BAKE_STATS.rebakes === 2, 'nothing made, two bakes worked again');
}

// ---------------------------------------------------------------- 7. the switch
{
  resetMorphBakeForTests();
  setMorphPlay(true);
  const proto = body(71, [{ vertices: 120, targets: 7, pad: 4 }]);
  const source = meshes(proto)[0].geometry;
  adoptAll(proto);
  const baked = meshes(proto)[0].geometry;
  const scene = new THREE.Scene();
  for (let i = 0; i < 4; i++) scene.add(cloneShared(proto));
  const drawn = (): THREE.BufferGeometry[] => meshes(scene).map((m) => m.geometry);
  const moved = setMorphBake(false, scene);
  ok(!GPU_KEYS.morphBake && moved === 5 && meshes(proto)[0].geometry === source && drawn().every((g) => g === source), 'off: the prototype and every clone handed the live source');
  adoptAll(scene);
  ok(drawn().every((g) => g === source), 'and nothing is baked while it is off');
  const back = setMorphBake(true, scene);
  ok(GPU_KEYS.morphBake && back === 5 && meshes(proto)[0].geometry === baked && drawn().every((g) => g === baked), 'on: each takes the bake it drew, none made');
  ok(MORPH_BAKE_STATS.made === 1, 'one bake for the look throughout');
}

// ---------------------------------------------------------------- 8. a look let go of
{
  resetMorphBakeForTests();
  setMorphPlay(true);
  // Two looks on one shared body geometry (the looks' share), of their own weights.
  const shared = part(81, 120, 7, 4);
  const mk = (seed: number): THREE.SkinnedMesh => {
    const m = new THREE.SkinnedMesh(shared, new THREE.MeshStandardMaterial());
    m.morphTargetInfluences = weights(seed, 7, 4);
    return m;
  };
  const a = mk(82);
  const b = mk(83);
  const town = new THREE.Scene();
  town.add(a, b);
  adoptMorphs(a);
  adoptMorphs(b);
  const ba = bakeFor(a.geometry)!;
  const bb = bakeFor(b.geometry)!;
  ok(ba !== bb && ba.source === shared && bb.source === shared, 'two looks of one shared body: a bake each');
  ok(ba.baked.attributes.uv !== bb.baked.attributes.uv && ba.baked.index !== bb.baked.index, "neither shares an attribute object with the other: one let go takes none of the other's buffers");
  const live = MORPH_BAKE_STATS.live;
  const bytes = MORPH_BAKE_STATS.bytes;
  a.geometry.dispose();
  ok(ba.gone && MORPH_BAKE_STATS.live === live - 1 && MORPH_BAKE_STATS.bytes === bytes - ba.bytes, 'its bake gone with its bytes');
  morphBakeFrame();
  b.morphTargetInfluences![0] = 0.5;
  morphBakeFrame();
  ok(!bb.gone && sameFloats(bb.position!.array as Float32Array, threeMorph(shared, b.morphTargetInfluences!, 'position')), "the other look's bake untouched, and still followed");
}

// ---------------------------------------------------------------- 9. nothing allocated in a frame, in twelve fresh processes at once
{
  const me = fileURLToPath(import.meta.url);
  const runs = await Promise.all(
    Array.from({ length: 12 }, () =>
      new Promise<Record<string, number> | string>((res) => {
        const ch = spawn(process.execPath, ['--expose-gc', me, '--alloc'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        ch.stdout.on('data', (x) => (out += x));
        ch.stderr.on('data', (x) => (err += x));
        ch.on('close', () => {
          try {
            res(JSON.parse(out.trim().split('\n').pop() ?? ''));
          } catch {
            res(`no answer: ${err.slice(0, 300)}`);
          }
        });
      }),
    ),
  );
  const bad = runs.filter((r) => typeof r === 'string');
  ok(bad.length === 0, `every process answered (${bad.join('; ')})`);
  const got = runs as Record<string, number>[];
  for (const k of ['frame', 'adopt', 'frameOutOfPlay']) {
    const v = got.map((r) => r[k]);
    const said = v.map((x) => (Number.isFinite(x) ? x.toFixed(3) : 'no clean window')).join(' ');
    ok(v.every((x) => Number.isFinite(x) && x < 0.5), `the bake's ${k} allocates nothing in 12 of 12 processes (${said} B a call)`);
  }
}

console.log(`morphBake: ${checks} checks passed`);
