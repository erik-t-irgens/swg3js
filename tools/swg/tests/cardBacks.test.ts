// Each face of a leaf card takes the light on its own side: the mirror (`src/world/cardBacks.ts`), run on a card's
// geometry as its model loads, and the card rule's vertex line that reflects back to the client's own normal.
//
//   1. hand-built cards: a pair on the same three vertices wound both ways gets its back copied and mirrored, the
//      front untouched, every other attribute copied byte for byte and the index pointing at the copies; a pair on
//      vertices of its own is mirrored in place with nothing added; a pair whose normals face apart is untouched;
//      a lone sheet facing away from its winding is turned; a sheet whose corners straddle its plane is the exact
//      mirror of its twin at random points inside it (no crease); two triangles of one sheet bent 20 degrees share
//      one plane at their common vertex (no seam); reflecting through the written plane, normalised as the shader
//      normalises it, gives the stored normal back; a second run adds nothing; and a geometry another material
//      also draws, or one the mirror passes over, carries a plane of nought;
//   2. the packs (SWG3JS_PACKS, else assets-private): every flora card geometry and every placed one at every
//      level, mirrored as a model load mirrors it, keeps its positions, its triangles and every attribute but the
//      normal at each vertex's source, leaves no sheet facing away from its winding, no index past its width, and
//      adds no more than half a megabyte and fifty milliseconds a world;
//   3. the vertex line: its anchor in three's real physical program, put in once, normalising the plane and
//      keeping nought nought, reading the `normal` attribute and never `objectNormal` after the swap, and the swap
//      a choice and never a `mix`; a program without the anchor left as it was and said.
//
// Run: node tools/swg/tests/cardBacks.test.ts
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { CARD_PLANE, mirrorBacks, mirrorCardGeometry, sheetsOf } from '../../../src/world/cardBacks.ts';
import { storedNormal } from '../../../src/world/cardLightMath.ts';
import { CARD_STATS, CARD_STORED, CARD_TUNE, applyCard, injectCard, prepareCardModel, registerPackCards } from '../../../src/world/cardRule.ts';
import { classByName } from '../../../src/world/cardAlpha.ts';
import { STORED_LINE } from '../../../src/world/cardLight.ts';
import { floraPacks, glbJsonOf, glbScenes, isCardJson } from './glbThree.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

/** A quad in the XY plane, its four corners and two triangles wound toward +Z, every corner's normal `n`. */
function quadArrays(n: [number, number, number] = [0, 0, 1], z = 0) {
  const P = [-1, -1, z, 1, -1, z, 1, 1, z, -1, 1, z];
  const N = [...n, ...n, ...n, ...n];
  const UV = [0, 0, 1, 0, 1, 1, 0, 1];
  const I = [0, 1, 2, 0, 2, 3];
  return { P, N, UV, I };
}
const flip = (I: number[], off = 0) => {
  const out: number[] = [];
  for (let i = 0; i < I.length; i += 3) out.push(I[i] + off, I[i + 2] + off, I[i + 1] + off);
  return out;
};
const reflect = (n: number[], p: number[]): number[] => {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  const q = [p[0] / l, p[1] / l, p[2] / l];
  const d = 2 * (n[0] * q[0] + n[1] * q[1] + n[2] * q[2]);
  return [n[0] - d * q[0], n[1] - d * q[1], n[2] - d * q[2]];
};

// ---------------------------------------------------------------- 1. hand-built cards

{
  // A pair on the very same vertices, the back wound the other way, both carrying the front's normal (the client's commonest).
  const q = quadArrays();
  const I = [...q.I, ...flip(q.I)];
  const sh = sheetsOf(q.P, q.N, I);
  ok(sh.count === 2 && sh.mirrored.reduce((s, v) => s + v, 0) === 1, 'a pair on one set of vertices is two sheets, one of them facing against its winding');
  const r = mirrorBacks(q.P, q.N, I, [{ name: 'position', array: Float32Array.from(q.P), itemSize: 3 }, { name: 'normal', array: Float32Array.from(q.N), itemSize: 3 }, { name: 'uv', array: Float32Array.from(q.UV), itemSize: 2 }], sh);
  ok(r.added === 4 && r.total === 8, 'its back is given vertices of its own: four copies');
  const back = Array.from(r.index.slice(6));
  ok(back.every((v) => v >= 4) && Array.from(r.index.slice(0, 6)).every((v, i) => v === q.I[i]), "the back's triangles point at the copies, the front's at the originals");
  const pos = r.attrs.get('position')!;
  const uv = r.attrs.get('uv')!;
  const nrm = r.attrs.get('normal') as Float32Array;
  let same = true;
  for (let c = 4; c < 8; c++) {
    // A copy's source is the original at the same place.
    const src = [0, 1, 2, 3].find((s) => pos[s * 3] === pos[c * 3] && pos[s * 3 + 1] === pos[c * 3 + 1] && pos[s * 3 + 2] === pos[c * 3 + 2]);
    if (src === undefined || uv[c * 2] !== uv[src * 2] || uv[c * 2 + 1] !== uv[src * 2 + 1]) same = false;
  }
  ok(same, 'every other attribute of a copy is its source\'s, byte for byte');
  let front = true;
  for (let v = 0; v < 4; v++) if (nrm[v * 3 + 2] !== 1) front = false;
  let mirrored = true;
  for (let v = 4; v < 8; v++) if (Math.abs(nrm[v * 3 + 2] + 1) > 1e-6) mirrored = false;
  ok(front && mirrored, "the front keeps the client's normal and the back's copies face their own side");
  for (let v = 4; v < 8; v++) {
    const back = storedNormal([nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]], [r.plane[v * 4] / 127, r.plane[v * 4 + 1] / 127, r.plane[v * 4 + 2] / 127]);
    if (Math.abs(back[0]) > 1e-6 || Math.abs(back[1]) > 1e-6 || Math.abs(back[2] - 1) > 1e-6) mirrored = false;
  }
  ok(mirrored, 'and reflecting a copy\'s normal through its written plane, normalised, gives the stored normal back');
}

{
  // A pair on vertices of its own: mirrored in place, nothing added.
  const a = quadArrays([0, 0, 1], 0);
  const b = quadArrays([0, 0, 1], 0.002);
  const P = [...a.P, ...b.P];
  const N = [...a.N, ...b.N];
  const I = [...a.I, ...flip(b.I, 4)];
  const r = mirrorBacks(P, N, I, [{ name: 'normal', array: Float32Array.from(N), itemSize: 3 }]);
  const n = r.attrs.get('normal') as Float32Array;
  ok(r.added === 0 && n[4 * 3 + 2] === -1 && n[2] === 1, 'a pair on vertices of its own is mirrored in place, with nothing added');
  // A pair whose normals already face apart.
  const c = quadArrays([0, 0, -1], 0.002);
  const N2 = [...a.N, ...c.N];
  const r2 = mirrorBacks(P, N2, I, [{ name: 'normal', array: Float32Array.from(N2), itemSize: 3 }]);
  ok(r2.mirroredSheets === 0 && r2.added === 0 && Array.from(r2.attrs.get('normal')!).every((v, i) => v === N2[i]) && r2.plane.every((v) => v === 0), 'a pair whose normals already face apart is left exactly as written, with a plane of nought');
  // A lone sheet facing away from its winding.
  const lone = quadArrays([0, 0, -1]);
  const r3 = mirrorBacks(lone.P, lone.N, lone.I, [{ name: 'normal', array: Float32Array.from(lone.N), itemSize: 3 }]);
  ok(r3.mirroredSheets === 1 && (r3.attrs.get('normal') as Float32Array)[2] === 1, 'a lone sheet facing away from the only face drawn is turned to it');
}

{
  // A sheet whose corners straddle its plane (radial normals, the client's crown shading): the mirrored twin is the
  // exact mirror of its front at every point, the in-plane part kept and the across part negated, with no crease.
  const P = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
  const radial = [
    [-0.6, -0.5, 0.62],
    [0.7, -0.4, -0.59],
    [0.5, 0.7, 0.5],
    [-0.3, 0.8, -0.52],
  ].map((n) => {
    const l = Math.hypot(...n);
    return n.map((x) => x / l);
  });
  const N = radial.flat();
  const Pb = P.map((v, i) => (i % 3 === 2 ? v + 0.003 : v));
  const Pall = [...P, ...Pb];
  const Nall = [...N, ...N];
  // The front faces +Z by winding; its corners say +Z on average. The back, on vertices of its own, faces −Z.
  const I = [0, 1, 2, 0, 2, 3, ...flip([0, 1, 2, 0, 2, 3], 4)];
  const r = mirrorBacks(Pall, Nall, I, [{ name: 'normal', array: Float32Array.from(Nall), itemSize: 3 }]);
  const n = r.attrs.get('normal') as Float32Array;
  let worst = 0;
  for (let k = 0; k < 200; k++) {
    let u = Math.random();
    let v = Math.random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;
    const tri = Math.random() < 0.5 ? [0, 1, 2] : [0, 2, 3];
    const f = [0, 1, 2].map((c) => w * n[tri[0] * 3 + c] + u * n[tri[1] * 3 + c] + v * n[tri[2] * 3 + c]);
    const b = [0, 1, 2].map((c) => w * n[(tri[0] + 4) * 3 + c] + u * n[(tri[1] + 4) * 3 + c] + v * n[(tri[2] + 4) * 3 + c]);
    worst = Math.max(worst, Math.abs(f[0] - b[0]), Math.abs(f[1] - b[1]), Math.abs(f[2] + b[2]));
  }
  ok(worst < 1e-6, `a mirrored copy is its twin's exact mirror at every point: the in-plane part kept, the across part negated (worst ${worst.toExponential(1)})`);
  // Bent 20 degrees: two triangles of one sheet meeting at a crease share their vertices, so one plane each.
  const ang = (20 * Math.PI) / 180;
  const Pf = [0, -1, 0, 0, 1, 0, 1, 0, 0, -Math.cos(ang), 0, Math.sin(ang)];
  const Nf = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
  const If = [0, 2, 1, 0, 1, 3];
  const sh = sheetsOf(Pf, Nf, If);
  ok(sh.count === 1 && sh.mirrored[0] === 1, 'two triangles bent 20 degrees are one sheet, here facing against its winding');
  const rb = mirrorBacks(Pf, Nf, If, [{ name: 'normal', array: Float32Array.from(Nf), itemSize: 3 }], sh);
  ok(rb.added === 0 && Array.from(rb.index).every((v, i) => v === If[i]), 'and a vertex the bend\'s two triangles share stays one vertex with one plane: no seam');
}

{
  // The whole geometry path: a second run adds nothing and leaves the plane byte for byte.
  const q = quadArrays();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(q.P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(q.N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(q.UV, 2));
  g.setIndex([...q.I, ...flip(q.I)]);
  const r1 = mirrorCardGeometry(g);
  const plane = Array.from(g.getAttribute(CARD_PLANE).array as Int8Array);
  const count = g.getAttribute('position').count;
  const r2 = mirrorCardGeometry(g);
  ok(r1.mirrored && r1.added === 4 && !r2.mirrored && r2.added === 0 && g.getAttribute('position').count === count && Array.from(g.getAttribute(CARD_PLANE).array as Int8Array).every((v, i) => v === plane[i]), 'a second run over a mirrored geometry adds nothing and leaves its plane byte for byte');
  ok(g.getIndex()!.array instanceof Uint16Array, 'and its index stays sixteen bits while it fits');
}

{
  // Through the card rule as a model load runs it: a geometry an opaque material also draws is left alone with a
  // plane of nought, and with the mirror off every card geometry still carries one.
  const q = quadArrays();
  const shared = new THREE.BufferGeometry();
  shared.setAttribute('position', new THREE.Float32BufferAttribute(q.P, 3));
  shared.setAttribute('normal', new THREE.Float32BufferAttribute(q.N, 3));
  shared.setIndex([...q.I, ...flip(q.I)]);
  const card = new THREE.MeshStandardMaterial({ alphaTest: 0.5, side: THREE.DoubleSide });
  card.name = 'test card aa7';
  const bark = new THREE.MeshStandardMaterial();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(shared, card), new THREE.Mesh(shared, bark));
  const before = shared.getAttribute('normal').array.slice();
  prepareCardModel([group], { flora: true, count: false });
  ok(shared.getAttribute('position').count === 4 && Array.from(shared.getAttribute('normal').array).every((v, i) => v === before[i]) && (shared.getAttribute(CARD_PLANE)?.array as Int8Array).every((v) => v === 0), 'a geometry an opaque material also draws is left unmirrored, carrying a plane of nought');
  const own = new THREE.BufferGeometry();
  own.setAttribute('position', new THREE.Float32BufferAttribute(q.P, 3));
  own.setAttribute('normal', new THREE.Float32BufferAttribute(q.N, 3));
  own.setIndex([...q.I, ...flip(q.I)]);
  const card2 = new THREE.MeshStandardMaterial({ alphaTest: 0.5, side: THREE.DoubleSide });
  card2.name = 'test card two aa7';
  const keep = CARD_TUNE.mirror;
  CARD_TUNE.mirror = false;
  try {
    prepareCardModel([new THREE.Group().add(new THREE.Mesh(own, card2))], { flora: true, count: false });
  } finally {
    CARD_TUNE.mirror = keep;
  }
  ok(own.getAttribute('position').count === 4 && (own.getAttribute(CARD_PLANE)?.array as Int8Array)?.every((v) => v === 0), 'and with the mirror off, a card geometry still carries a plane of nought');
}

// ---------------------------------------------------------------- 2. the packs

const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));

/** The sheets of a geometry as the mirror reads them, positions to doubles. */
function sheetsOfGeometry(g: THREE.BufferGeometry) {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const P = new Float64Array(pos.count * 3);
  const N = new Float64Array(pos.count * 3);
  for (let v = 0; v < pos.count; v++) {
    P[v * 3] = pos.getX(v);
    P[v * 3 + 1] = pos.getY(v);
    P[v * 3 + 2] = pos.getZ(v);
    N[v * 3] = nrm.getX(v);
    N[v * 3 + 1] = nrm.getY(v);
    N[v * 3 + 2] = nrm.getZ(v);
  }
  const I = g.getIndex()?.array ?? Uint32Array.from({ length: pos.count }, (_, i) => i);
  return sheetsOf(P, N, I);
}

{
  const packs = floraPacks(PACKS);
  if (!packs.length) console.log(`skip the packs: no pack with flora under ${PACKS}`);
  else {
    // The card shaders: every flora GLB's cut-out and blended materials, over every pack (the names' stand-in).
    const cardNames = new Set<string>();
    for (const p of packs) for (const d of p.manifest.categories.flora) {
      const f = join(p.dir, d.file);
      if (!existsSync(f)) continue;
      for (const m of glbJsonOf(f).materials ?? []) if (isCardJson(m)) cardNames.add(m.name ?? '');
    }
    // Every world's card shaders at once, on purpose: this holds the mirror to every geometry the rule can reach
    // anywhere. That the game knows a world's whole set as that world loads (the table beside the packs) is
    // cardRule.test's check, world by world in a fresh session.
    registerPackCards(Object.fromEntries([...cardNames].map((n) => [n, { blend: classByName(n) === 'blend', emissive: [0, 0, 0] }])));
    let geometries = 0;
    let faults: string[] = [];
    let worstBytes = 0;
    let worstMs = 0;
    let worstPack = '';
    let wideIndex = 0;
    let stillAway = 0;
    for (const p of packs) {
      let bytes = 0;
      let ms = 0;
      const files: { file: string; flora: boolean }[] = p.manifest.categories.flora.map((d) => ({ file: join(p.dir, d.file), flora: true }));
      // The placed models that wear a card shader (their JSON alone is read to find them).
      for (const d of p.manifest.categories.layout ?? []) {
        if (d.cells?.length) continue;
        const f = join(p.dir, d.file);
        if (!existsSync(f)) continue;
        if ((glbJsonOf(f).materials ?? []).some((m) => isCardJson(m) && cardNames.has(m.name ?? ''))) files.push({ file: f, flora: false });
      }
      for (const { file, flora } of files) {
        if (!existsSync(file)) continue;
        const { scenes } = glbScenes(file);
        // What every geometry holds before: positions, triangles, every attribute but the normal.
        const before = new Map<THREE.BufferGeometry, { pos: Float32Array; tris: number; attrs: Map<string, number[]> }>();
        for (const s of scenes) {
          s.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh || before.has(m.geometry)) return;
            const g = m.geometry;
            const attrs = new Map<string, number[]>();
            for (const [name, a] of Object.entries(g.attributes)) if (name !== 'normal') attrs.set(name, Array.from(a.array as ArrayLike<number>));
            before.set(g, { pos: Float32Array.from(g.getAttribute('position').array as ArrayLike<number>), tris: (g.getIndex()?.count ?? g.getAttribute('position').count) / 3, attrs });
          });
        }
        const t0 = performance.now();
        const report = prepareCardModel(scenes, { flora, count: false });
        ms += performance.now() - t0;
        for (const s of scenes) {
          s.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const mat = m.material as THREE.MeshStandardMaterial;
            if (mat.userData.swgCardBlend === undefined) return;
            const g = m.geometry;
            const b = before.get(g);
            if (!b) return;
            geometries++;
            const pos = g.getAttribute('position');
            const tris = (g.getIndex()?.count ?? pos.count) / 3;
            if (tris !== b.tris) faults.push(`${file}: triangles ${b.tris} -> ${tris}`);
            const n0 = b.pos.length / 3;
            const added = pos.count - n0;
            const per = [...b.attrs.values()].reduce((s, a) => s + (a.length / n0) * 4, 0) + 12 + 4;
            bytes += added * per;
            // Every vertex keeps its place and attributes; every copy is a copy of a vertex at the same place.
            for (let v = 0; v < n0; v++) if (pos.getX(v) !== b.pos[v * 3] || pos.getY(v) !== b.pos[v * 3 + 1] || pos.getZ(v) !== b.pos[v * 3 + 2]) faults.push(`${file}: vertex ${v} moved`);
            for (const [name, arr] of b.attrs) {
              const now = g.getAttribute(name).array as ArrayLike<number>;
              for (let i = 0; i < arr.length; i++) if (now[i] !== arr[i]) {
                faults.push(`${file}: ${name} changed at ${i}`);
                break;
              }
            }
            const idx = g.getIndex();
            if (idx) {
              const width = idx.array instanceof Uint16Array ? 65535 : 4294967295;
              for (let i = 0; i < idx.count; i++) if (idx.getX(i) >= pos.count || idx.getX(i) > width) wideIndex++;
            }
            // A sheet whose normals lie in its own plane (nearly half of all card area) has an across part of nought
            // either way round, and the mirror leaves it as it is: facing away means clearly against its winding.
            if (mat.side === THREE.FrontSide) {
              const sh = sheetsOfGeometry(g);
              for (let s2 = 0; s2 < sh.count; s2++) if (sh.across[s2] < -0.01) stillAway++;
            }
            if (!g.getAttribute(CARD_PLANE)) faults.push(`${file}: a card geometry with no plane`);
          });
        }
        void report;
      }
      if (bytes > worstBytes) {
        worstBytes = bytes;
        worstPack = p.pack;
      }
      worstMs = Math.max(worstMs, ms);
    }
    faults = faults.slice(0, 6);
    ok(geometries > 100, `the packs' card geometries were mirrored as their models load (${geometries} over ${packs.length} packs)`);
    ok(faults.length === 0, `positions, triangles and every attribute but the normal kept at every vertex, and every card geometry carries its plane${faults.length ? `: ${faults.join('; ')}` : ''}`);
    ok(wideIndex === 0, 'no index points past its geometry or past its own width');
    ok(stillAway === 0, `no front-drawn card geometry is left with a sheet facing away from its winding (${stillAway})`);
    ok(worstBytes < 0.5 * 1048576, `the vertices added come to under half a megabyte a world (the most: ${(worstBytes / 1048576).toFixed(3)} MB, ${worstPack})`);
    ok(worstMs < 50, `and the rule and the mirror take under fifty milliseconds a world (the most here: ${worstMs.toFixed(0)} ms in node; the study measured 16 ms)`);
  }
}

// ---------------------------------------------------------------- 3. the vertex line

{
  const lib = THREE.ShaderLib.physical;
  ok(lib.vertexShader.includes('#include <beginnormal_vertex>') && THREE.ShaderChunk.beginnormal_vertex.includes('vec3 objectNormal = vec3( normal );'), "the anchor is in three 0.185's physical program, and it is where objectNormal is first made from the normal attribute");
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms) } as unknown as THREE.WebGLProgramParametersWithUniforms;
  const m = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
  m.userData.swgCardBlend = 'blend';
  const before = CARD_STATS.injected;
  ok(injectCard(shader, m) && CARD_STATS.injected === before + 1, 'the rule goes into a real physical program, and is counted');
  const v = shader.vertexShader;
  const count = (s: string) => v.split(s).length - 1;
  ok(count(STORED_LINE) === 1 && count('attribute vec4 cardPlane;') === 1, 'the stored normal and the plane go in once');
  const at = v.indexOf('#include <beginnormal_vertex>');
  ok(v.indexOf('vec3 swgStoredNormal') > at && v.indexOf('vec3 swgStoredNormal') < v.indexOf('#include <defaultnormal_vertex>'), 'straight after the anchor, before three transforms the normal');
  ok(/swgCardPlane = swgCardPlaneLen > 1e-4 \? swgCardPlane \/ swgCardPlaneLen : vec3\( 0\.0 \);/.test(CARD_STORED) && !/normalize\(\s*swgCardPlane/.test(CARD_STORED), 'the plane is normalised by hand, and a plane of nought kept nought (no normalize of nought)');
  ok(/vec3 swgStoredNormal = normal - 2\.0 \* dot\( normal, swgCardPlane \) \* swgCardPlane;/.test(CARD_STORED) && !/objectNormal - 2\.0/.test(CARD_STORED), 'it reads the geometry\'s own normal attribute, never objectNormal');
  ok(/if \( uSwgCardBacksStored > 0\.5 \) objectNormal = swgStoredNormal;/.test(CARD_STORED) && !/mix\(/.test(CARD_STORED), 'and the swap is a choice, never a mix (which carries a NaN from the side not chosen)');
  const bare = { vertexShader: lib.vertexShader.replace('#include <beginnormal_vertex>', ''), fragmentShader: lib.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
  const warn = console.warn;
  const said: string[] = [];
  console.warn = (...a: unknown[]) => void said.push(a.join(' '));
  try {
    const missing = CARD_STATS.missingAnchor;
    const v0 = bare.vertexShader;
    ok(!injectCard(bare, m) && bare.vertexShader === v0 && CARD_STATS.missingAnchor === missing + 1 && CARD_STATS.missing.includes('#include <beginnormal_vertex>'), 'a program without the anchor is left exactly as it was, counted and named');
  } finally {
    console.warn = warn;
  }
  ok(said.length <= 1, 'and said once at most');
  // Wrapping twice adds nothing.
  const w = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
  w.userData.swgCardBlend = 'punch';
  applyCard(w);
  const hook = w.onBeforeCompile;
  applyCard(w);
  ok(w.onBeforeCompile === hook, 'wrapping a card twice adds nothing');
}

console.log(`\ncardBacks: ${passed} checks passed`);
