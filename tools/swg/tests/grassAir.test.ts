// The grass leaning in the moving air (the volumetrics' sixth wave, the design's §14; `airGrass.ts`): the twin is the
// grass's own text with exactly its lean made in (all of it or none, null where the base's text has moved), keyed by a
// define of its own, every uniform object shared with its base by reference and the session's grass record beside them,
// for the colour material and the depth material alike; the base's text and key never move, and the twin's replacements
// undone, last first, give the base's text back to the byte; the lean said in this test's own words (after the trees'
// sway, a near tuft only, never in place of the sway); its own edge, bend and reach, and `swgAirLean` whole (its window
// place, its atlas reads, the channels and the three components it answers), run as script against the CPU mirror, the
// gate at a share of nought, the window's edge and the wheat's law; the chooser keeping the plain grass while the
// grass casts and no screen has drawn the twin's depth program; and the twin's text passes the GLSL scans.
//
// The grass's module names some neighbours without an extension further down, so this suite registers the off-proof's
// loader over today's tree alone (`airLoader.mjs`).
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, showOld } from './airTrees.ts';
import { glslVariant, redeclared, reservedWords, unbalanced, undefinedCalls, uniformNames } from './glslScan.ts';
import { glslFunctionText, glslFunctions } from './glslRun.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const SRC = join(REPO, 'src');
register(pathToFileURL(join(REPO, 'tools', 'swg', 'tests', 'airLoader.mjs')).href, import.meta.url, { data: { roots: [SRC], packageBase: join(REPO, 'package.json') } });
const load = async (p: string): Promise<Record<string, unknown>> => (await import(pathToFileURL(join(SRC, p)).href)) as Record<string, unknown>;
const G = (await load('world/grass.ts')) as typeof import('../../../src/world/grass.ts');
const A = (await load('world/volumetrics/airGrass.ts')) as typeof import('../../../src/world/volumetrics/airGrass.ts');
const T = (await load('world/volumetrics/airTune.ts')) as typeof import('../../../src/world/volumetrics/airTune.ts');

// --- the plain grass, unchanged ---
{
  // The grass's own program texts, as source, against the commit before the pass: the twin is made beside them and they
  // are never edited (the off-proof holds the built materials too).
  const seg = (s: string, name: string): string => {
    const a = s.indexOf(`export const ${name} = /* glsl */ \``);
    const b = s.indexOf('\n`;\n', a);
    return a < 0 || b < 0 ? '' : s.slice(a, b);
  };
  const was = showOld('src/world/grass.ts');
  const now = (await import('node:fs')).readFileSync(join(SRC, 'world', 'grass.ts'), 'utf8').replace(/\r\n/g, '\n');
  for (const name of ['GRASS_VERTEX', 'GRASS_SHADOW_PARS', 'GRASS_FRAGMENT', 'GRASS_DEPTH_FRAGMENT']) {
    const a = seg(was, name);
    ok(a.length > 100 && a === seg(now, name), `the grass's own ${name} is the commit before the pass's, to the byte`);
  }
}

// --- the twin ---
{
  let all = true;
  const bases: [string, import('three').ShaderMaterial][] = [
    ['colour', G.grassMaterial()],
    ['depth', G.grassDepthMaterial()],
  ];
  for (const [what, base] of bases) {
    const before = `${base.customProgramCacheKey()}|${JSON.stringify(base.defines)}|${base.vertexShader}|${base.fragmentShader}`;
    const twin = A.grassAirTwin(base);
    if (!twin) {
      all = false;
      console.log(`     no twin of the ${what} material`);
      continue;
    }
    const after = `${base.customProgramCacheKey()}|${JSON.stringify(base.defines)}|${base.vertexShader}|${base.fragmentShader}`;
    if (before !== after) all = false;
    // The colour twin's fragment takes the seventh wave's sheen (its own two replacements, undone below); the depth's is its base's.
    const fragWant = what === 'depth' ? base.fragmentShader : A.grassAirFragText(base.fragmentShader);
    if (twin.vertexShader !== A.grassAirText(base.vertexShader) || fragWant === null || twin.fragmentShader !== fragWant) all = false;
    if (what === 'colour') {
      let f: string | null = twin.fragmentShader;
      for (const [from, to] of [...A.GRASS_AIR_FRAG_EDITS].reverse()) {
        if (f === null) break;
        const i = f.indexOf(to);
        if (i < 0 || f.indexOf(to, i + to.length) >= 0) f = null;
        else f = f.slice(0, i) + from + f.slice(i + to.length);
      }
      if (f !== base.fragmentShader) all = false;
      const fs = glslVariant(twin.fragmentShader, new Set(Object.keys(twin.defines as Record<string, unknown>)));
      if (reservedWords(fs).length || unbalanced(fs) !== '' || redeclared(fs).length) all = false;
      if (!uniformNames(fs).includes('uAirGrassSheen') || !('uAirGrassSheen' in twin.uniforms)) all = false;
    }
    if (twin.uniforms.uWind7 === undefined) all = false;
    // Exactly its lean made in: each replacement's text is in the twin once, and taken out again, last first, the base's
    // own text comes back to the byte.
    let undone: string | null = twin.vertexShader;
    for (const [from, to] of [...A.GRASS_AIR_EDITS].reverse()) {
      if (undone === null) break;
      const i = undone.indexOf(to);
      if (i < 0 || undone.indexOf(to, i + to.length) >= 0) undone = null;
      else undone = undone.slice(0, i) + from + undone.slice(i + to.length);
    }
    if (undone !== base.vertexShader) all = false;
    // What the lean must say, in this test's own words: laid on after the trees' sway, a near tuft only, from the tuft's
    // foot and height, the reads declared before main.
    const v = twin.vertexShader;
    const sway = v.indexOf('swgP += swgSwayOffset( vec3( 0.0, position.y * swgH, 0.0 ), swgModel ) * swgScale;');
    const lean = v.indexOf('if ( ! swgFar ) swgP += swgAirLean( swgBase, position.y, aSwgSize.y * swgScale );');
    if (!(sway > 0 && lean > sway && lean < v.indexOf('vec4 mvPosition = viewMatrix * vec4( swgP, 1.0 );'))) all = false;
    if (!(v.indexOf('vec3 swgAirLean( vec3 base, float lev, float h ) {') > 0 && v.indexOf('vec3 swgAirLean(') < v.indexOf('void main() {'))) all = false;
    if (!v.includes('// W7a: the unified wind')) all = false;
    // A define of its own (the key's), the base's kept.
    if ((twin.defines as Record<string, string>)[A.GRASS_AIR_DEFINE] !== '' || (base.defines as Record<string, string> | undefined)?.[A.GRASS_AIR_DEFINE] !== undefined) all = false;
    for (const [k, val] of Object.entries(base.defines ?? {})) if ((twin.defines as Record<string, unknown>)[k] !== val) all = false;
    if (twin.name !== `${base.name}+air`) all = false;
    // Every flag in three's key the base's own.
    if (twin.fog !== base.fog || twin.side !== base.side || twin.shadowSide !== base.shadowSide || twin.toneMapped !== base.toneMapped || twin.transparent !== base.transparent || twin.lights !== false) all = false;
    if (twin.userData.unlit !== true || twin.userData.dry !== true) all = false;
    // Every uniform object shared by reference, the session's record beside them.
    for (const k of Object.keys(base.uniforms)) if (twin.uniforms[k] !== base.uniforms[k]) all = false;
    for (const k of Object.keys(A.GRASS_AIR_U)) if (twin.uniforms[k] !== (A.GRASS_AIR_U as unknown as Record<string, unknown>)[k]) all = false;
    // Every uniform its text declares is on it.
    const defs = new Set(Object.keys(twin.defines as Record<string, unknown>));
    const vs = glslVariant(twin.vertexShader, defs);
    const declared = uniformNames(vs);
    // The depth material's own text declares the card light's uniforms its depth program never reads (unread, so never
    // bound): only what the twin adds is asked of it.
    const baseDeclared = new Set(uniformNames(glslVariant(base.vertexShader, new Set(Object.keys(base.defines ?? {})))));
    const builtIn = ['modelMatrix', 'viewMatrix', 'projectionMatrix', 'cameraPosition', 'isOrthographic', 'modelViewMatrix', 'normalMatrix'];
    const missing = declared.filter((nm) => !(nm in twin.uniforms) && !builtIn.includes(nm) && !baseDeclared.has(nm));
    if (!uniformNames(vs).includes('uAirGrassVel') || !uniformNames(vs).includes('uAirGrassP')) all = false;
    if (missing.length) {
      console.log(`     the ${what} twin declares uniforms it has not got: ${missing.join(', ')}`);
      all = false;
    }
    if (reservedWords(vs).length || unbalanced(vs) !== '' || redeclared(vs).length || vs.includes('`')) all = false;
    // The grass's text is a chunk spliced into three's own (`#include <common>`, the fog's), whose functions are three's.
    const calls = undefinedCalls(vs).filter((c) => !['texture2D'].includes(c));
    const ours = calls.filter((c) => c.startsWith('swgAir'));
    if (ours.length) {
      console.log(`     the ${what} twin calls ${ours.join(', ')} and does not define it`);
      all = false;
    }
    twin.dispose();
  }
  ok(all, "the grass's twin, colour and depth: the base's text and key untouched, the twin's text exactly its lean made in (after the trees' sway, a near tuft only, the unified wind's lean outside the window and the sheen beside it), the colour twin's fragment exactly the sheen made in, a define of its own, every flag in the key and every uniform object the base's, the session's grass record and the unified wind's uniform beside them; its text passes the scans");
  ok(A.grassAirText('void main() {}') === null && A.grassAirTwin(Object.assign(G.grassMaterial(), { vertexShader: 'void main() {}' })) === null, 'a base whose text has moved gets no twin at all (null), never a twin half made');
  ok(A.grassAirText(G.GRASS_VERTEX)!.split('swgAirLean(').length === 3, "and the lean is defined once and called once");
}

// --- the lean, run as script against its mirror ---
{
  const text = A.GRASS_AIR_PARS;
  const P = { x: 1, y: T.AIR_TUNE.grass.full, z: T.AIR_TUNE.grass.most, w: T.AIR_TUNE.grass.sink };
  const W = { x: 0, y: 0, z: 192, w: T.AIR_TUNE.window.edge };
  const fns = glslFunctions([glslFunctionText(text, 'swgAirGrassEdge'), glslFunctionText(text, 'swgAirGrassBend'), glslFunctionText(text, 'swgAirGrassReach')].join('\n'), ['swgAirGrassEdge', 'swgAirGrassBend', 'swgAirGrassReach'], { uAirGrassP: P, uAirGrassWin: W });
  let worst = 0;
  let n = 0;
  for (const share of [0, 0.25, 1]) {
    P.x = share;
    for (const lx of [0, 0.01, 0.04, 0.08, 0.3, 0.5, 0.97, 1]) {
      for (const ly of [0, 0.02, 0.5, 0.99]) {
        const e = fns.swgAirGrassEdge(lx, ly) as number;
        worst = Math.max(worst, Math.abs(e - A.grassEdgeMirror(lx, ly, W.w)));
        for (const sp of [0, 0.5, 4, 13, 30]) {
          const b = fns.swgAirGrassBend(sp, e) as number;
          worst = Math.max(worst, Math.abs(b - A.grassBendMirror(sp, e, share, P.y, P.z)));
          for (const lev of [0, 0.5, 1]) {
            const k = fns.swgAirGrassReach(lev, 0.6, b) as number;
            worst = Math.max(worst, Math.abs(k - lev * lev * 0.6 * A.grassBendMirror(sp, e, share, P.y, P.z)));
            n++;
          }
        }
      }
    }
  }
  ok(worst < 1e-12, `the twin's own edge, bend and reach, run as script, are the mirror's to the last bit over ${n} cases (worst ${worst})`);
  // The law, never the numbers it starts at (every one of them is the owner's dial): air at the full speed leans all the
  // way (or the most, where the most is less), half of it half, and no air ever leans past the most.
  const Gt = T.AIR_TUNE.grass;
  P.x = 1;
  ok((fns.swgAirGrassBend(Gt.full, 1) as number) === Math.min(1, Gt.most) && (fns.swgAirGrassBend(Gt.full / 2, 1) as number) === Math.min(0.5, Gt.most) && (fns.swgAirGrassBend(Gt.full * 3, 1) as number) === Gt.most, `the wheat's own law: air at the full speed (${Gt.full} m/s) leans all the way up to the most (${Gt.most}), half of it half, and no air ever leans past the most`);
  P.x = 0;
  ok((fns.swgAirGrassBend(Gt.full * 2, 1) as number) === 0, 'at a share of nought nothing leans, whatever the air');
}

// --- the twin's whole lean, `swgAirLean` itself, run as script against its mirror ---
// Its window place, its atlas reads (each axis clamped half a texel inside slab 0's own tile), the channels it reads, the
// edge's ease, the bend, the reach and the three components it answers: every line of the function the program runs, with
// a stand-in texture that records where it was read and answers a field that differs on every axis and in every channel.
{
  const text = A.GRASS_AIR_PARS;
  const names = ['swgAirGrassAtlas', 'swgAirGrassEdge', 'swgAirGrassBend', 'swgAirGrassReach', 'swgAirLean'];
  const Gt = T.AIR_TUNE.grass;
  const P = { x: 1, y: Gt.full, z: Gt.most, w: Gt.sink };
  // The window's corner off the diagonal (x and z apart), slab 0's tile off the atlas's corner, a texel not square.
  const W = { x: 37.5, y: -61.25, z: 192, w: T.AIR_TUNE.window.edge };
  const R = { x: 0.125, y: 0.5, z: 0.25, w: 0.375 };
  const H = { x: 0.5 / 512, y: 0.5 / 256 };
  // The air in the atlas, by where it is read: different on each axis, and its third and fourth channels nothing like it.
  let poison = false;
  const airAt = (u: number, v: number): [number, number] => (poison ? [Number.NaN, 1] : [3 + 40 * (u - 0.2), -2 + 25 * (v - 0.6)]);
  const reads: { x: number; y: number }[] = [];
  const env: Record<string, unknown> = {
    uAirGrassP: P,
    uAirGrassWin: W,
    uAirGrassRect: R,
    uAirGrassHalf: H,
    uAirGrassVel: 'the atlas',
    vec2: (x: number, y: number) => ({ x, y }),
    vec3: (x: number, y?: number, z?: number) => (y === undefined ? { x, y: x, z: x } : { x, y, z }),
    length: (v: { x: number; y: number }) => Math.sqrt(v.x * v.x + v.y * v.y),
    isnan: (v: { x: number; y: number }) => [Number.isNaN(v.x), Number.isNaN(v.y)],
    isinf: (v: { x: number; y: number }) => [Math.abs(v.x) === Infinity, Math.abs(v.y) === Infinity],
    any: (b: boolean[]) => b.some(Boolean),
    texture2D: (s: unknown, uv: { x: number; y: number }) => {
      if (s !== 'the atlas') throw new Error('read from another sampler');
      reads.push(uv);
      const [x, y] = airAt(uv.x, uv.y);
      return { x, y, z: 77, w: -55, xy: { x, y }, zw: { x: 77, y: -55 }, yx: { x: y, y: x } };
    },
  };
  const run = glslFunctions(names.map((nm) => glslFunctionText(text, nm)).join('\n'), ['swgAirLean'], env).swgAirLean as (b: { x: number; y: number; z: number }, lev: number, h: number) => { x: number; y: number; z: number };
  const r = A.newGrassLean();
  const clampTo = (x: number, a: number, b: number): number => Math.min(Math.max(x, a), b);
  let worst = 0;
  let worstUv = 0;
  let n = 0;
  let readsWrong = 0;
  let leaned = 0;
  for (const share of [0, 0.6, 1]) {
    P.x = share;
    for (const lx of [-0.01, 0, 0.0004, 0.02, 0.3, 0.71, 0.9996, 1, 1.01]) {
      for (const ly of [-0.02, 0, 0.0006, 0.2, 0.45, 0.8, 0.9993, 1, 1.03]) {
        for (const lev of [0, 0.5, 1]) {
          const base = { x: W.x + lx * W.z, y: 4, z: W.y + ly * W.z };
          reads.length = 0;
          const got = run(base, lev, 0.6);
          // The mirror, from the same place: where the program must read, what it reads there, the lean of it.
          const wlx = (base.x - W.x) / W.z;
          const wly = (base.z - W.y) / W.z;
          const inside = share > 0 && wlx >= 0 && wly >= 0 && wlx <= 1 && wly <= 1;
          const u = R.x + clampTo(wlx * R.z, H.x, R.z - H.x);
          const v = R.y + clampTo(wly * R.w, H.y, R.w - H.y);
          if (inside) {
            if (reads.length !== 1) readsWrong++;
            else worstUv = Math.max(worstUv, Math.abs(reads[0].x - u), Math.abs(reads[0].y - v));
          } else if (reads.length !== 0) readsWrong++;
          const [vx, vz] = airAt(u, v);
          r.lx = wlx;
          r.ly = wly;
          r.vx = vx;
          r.vz = vz;
          r.lev = lev;
          r.h = 0.6;
          r.share = share;
          r.full = P.y;
          r.most = P.z;
          r.sink = P.w;
          r.edgeBand = W.w;
          A.grassLeanIn(r);
          worst = Math.max(worst, Math.abs(got.x - r.x), Math.abs(got.y - r.y), Math.abs(got.z - r.z));
          if (Math.abs(r.x) > 1e-6 && Math.abs(r.z) > 1e-6 && r.y < -1e-6) leaned++;
          n++;
        }
      }
    }
  }
  ok(n > 500 && leaned > 20 && readsWrong === 0 && worstUv < 1e-15, `swgAirLean reads the atlas once, at slab 0's own tile each axis clamped half a texel inside it, wherever the tuft stands in the window and never outside it (${n} cases, ${leaned} of them leaning on all three axes; worst uv ${worstUv})`);
  ok(worst < 1e-12, `and answers the mirror's lean on every axis, over, down and along the air at its foot, to the last bit (worst ${worst})`);
  P.x = 1;
  poison = true;
  const bad = run({ x: W.x + 0.5 * W.z, y: 0, z: W.y + 0.5 * W.z }, 1, 0.6);
  poison = false;
  ok(bad.x === 0 && bad.y === 0 && bad.z === 0, 'where the air reads nothing finite it leans nothing');
}

// --- the gate, through the mirror of the whole lean ---
{
  const r = A.newGrassLean();
  const at = (share: number, lx: number, ly: number, vx: number, vz: number, lev = 1, h = 0.8): [number, number, number] => {
    r.share = share;
    r.lx = lx;
    r.ly = ly;
    r.vx = vx;
    r.vz = vz;
    r.lev = lev;
    r.h = h;
    A.grassLeanIn(r);
    return [r.x, r.y, r.z];
  };
  ok(at(0, 0.5, 0.5, 9, 0).every((v) => v === 0), "the lean's gate at a share of nought: nothing moves");
  ok(at(1, -0.01, 0.5, 9, 0).every((v) => v === 0) && at(1, 0.5, 1.01, 9, 0).every((v) => v === 0), 'nought outside the window');
  ok(at(1, 0, 0.5, 9, 0).every((v) => v === 0), "and nought on the window's very edge, eased in across the band");
  ok(at(1, 0.5, 0.5, 0, 0).every((v) => v === 0) && at(1, 0.5, 0.5, Number.NaN, 0).every((v) => v === 0), 'nought in still air, and where the air reads nothing finite');
  ok(at(1, 0.5, 0.5, 9, 0, 0).every((v) => v === 0), "the tuft's foot never moves (its height fraction squared)");
  // From the tune as it stands (every number a dial): the law, never its starting numbers.
  const Gt = T.AIR_TUNE.grass;
  const over = Math.min(1, Gt.most);
  const [x, y, z] = at(1, 0.5, 0.5, Gt.full, 0, 1, 0.8);
  ok(Math.abs(x - over * 0.8) < 1e-12 && Math.abs(y + Gt.sink * over * 0.8) < 1e-12 && z === 0, `the top of a 0.8 m tuft in air at the full speed goes over by ${over} of its height along the air and sinks by ${Gt.sink} of that (${x.toFixed(3)}, ${y.toFixed(3)})`);
  const [x2, , z2] = at(1, 0.5, 0.5, 3, 4, 1, 1);
  ok(Math.abs(x2 / z2 - 0.75) < 1e-12 && Math.abs(Math.hypot(x2, z2) - Math.min(5 / Gt.full, Gt.most)) < 1e-12, 'along the air at its foot, and by its speed');
}

// --- the chooser ---
{
  const c = A.newGrassChoice();
  const plain = { name: 'plain' };
  const twin = { name: 'twin' };
  const set = (o: Partial<typeof c>): typeof c => Object.assign(c, { on: true, grass: true, field: true, softOff: false, built: true, casting: false, depthDrawn: false }, o);
  ok(A.grassMaterialFor(set({}), plain, twin) === twin, 'the master, the switch, a field and the twin built: the twin is worn');
  ok(A.grassMaterialFor(set({ casting: true }), plain, twin) === plain && A.grassWaitsForScreen(set({ casting: true })), "while the grass casts and no screen has drawn the twin's depth program, the plain grass is kept, and it waits for the next arrival (what the page says)");
  ok(A.grassMaterialFor(set({ casting: true, depthDrawn: true }), plain, twin) === twin && !A.grassWaitsForScreen(set({ casting: true, depthDrawn: true })), 'once a screen has drawn it, the twin is worn while the grass casts too');
  ok(A.grassMaterialFor(set({ built: false }), plain, twin) === plain, 'a twin not yet built is never worn (made in play, it waits for its warm)');
  ok(A.grassMaterialFor(set({ grass: false }), plain, twin) === plain && A.grassMaterialFor(set({ softOff: true }), plain, twin) === plain && A.grassMaterialFor(set({ field: false }), plain, twin) === plain && A.grassMaterialFor(set({ on: false }), plain, twin) === plain, 'the switch off, the soft off, no field or the master off: the plain grass, by identity');
  ok(A.grassMaterialFor(set({}), plain, null) === plain, 'and with no twin made (a base whose text moved), the plain grass');
  ok(!A.grassWaitsForScreen(set({ on: false, casting: true })) && !A.grassWaitsForScreen(set({ grass: false, casting: true })), 'nothing waits while the grass is not wanted at all');
}

// --- the meshes swapped, both ways, and a chunk built after on the material in force ---
{
  const THREE = await import('three');
  const plain = G.grassMaterial();
  const depth = G.grassDepthMaterial();
  const twin = A.grassAirTwin(plain)!;
  const twinDepth = A.grassAirTwin(depth)!;
  const mesh = G.grassStandIn(plain);
  mesh.customDepthMaterial = depth;
  const bare = G.grassStandIn(plain);
  ok(G.wearMesh(mesh, twin, twinDepth) === 1 && mesh.material === twin && mesh.customDepthMaterial === twinDepth, 'a mesh is put on the twin and its depth twin');
  ok(G.wearMesh(mesh, twin, twinDepth) === 0, 'and on the same again moves nothing');
  ok(G.wearMesh(bare, twin, twinDepth) === 1 && bare.customDepthMaterial === undefined, 'a mesh that hangs no depth material is given none');
  ok(G.wearMesh(mesh, plain, depth) === 1 && mesh.material === plain && mesh.customDepthMaterial === depth, 'and back on the plain two');
  ok(G.wearMesh(null, twin, twinDepth) === 0, 'a chunk with no mesh moves nothing');
  const host = { circlesFor: () => undefined, adopt: () => undefined, chunkTrees: () => 0, cascadeOf: () => 0 };
  const field = new G.GrassField(plain, host, depth);
  ok(field.wear(twin, twinDepth) === 0 && field.material === twin && field.depth === twinDepth, 'a field with no chunks built takes the twin for every chunk it builds after');
  const cards = new G.FarCards(plain, host, new THREE.Group(), 64, 1, depth);
  ok(cards.wear(twin, twinDepth) === 0 && cards.material === twin && cards.depth === twinDepth, 'and so do the far cards');
}

console.log(`\n${checks} checks passed`);
