// The GPU port's step 5, items 3 to 6, in node: the node graphs the lava, the marks, the lightsaber blades, the client's
// particles (and the weather's variant of them) and the hyperspace tunnel build on WebGPU (`src/core/gpu/gpuPrograms.ts`),
// held to the WebGL programs they stand in for, since node draws nothing (the browser's picture pairs hold the pixels).
//
//  1. every uniform each graph reads is one of its WebGL program's own, by name, read at every draw off the material three
//     is drawing (`frame.material.uniforms[name].value`, the very object the WebGL program reads), and every one its WebGL
//     program declares is read (the lava's fog is three's own, as WebGL's `fog_fragment` is the scene's);
//  2. every number of each graph is its GLSL text's own: every literal of the WebGL program that is not 0, 1 or 2 is one
//     of the graph's constants, and every number the graph is built from (`PROGRAM_NUMBERS`) is a literal of that text;
//  3. the materials: unlit, the lava alone with three's fog, a drop (`discard`) where WebGL has one, and an object refresh at
//     every draw (three's observer told the graph has nodes of its own), since a value written in place moves nothing three
//     watches;
//  4. the parts are left out at load each by its own switch, and the not-ported list says the owner's remakes.
//
// Run: node tools/swg/tests/gpuPrograms.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { PROGRAM_NUMBERS, bladeNode, lavaNode, marksNode, particlesNode, tunnelNode } from '../../../src/core/gpu/gpuPrograms.ts';
import { LOOKS_AT_LOAD } from '../../../src/core/gpu/looks.ts';
import { NOT_PORTED } from '../../../src/core/gpu/carries.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};

/** Every node reachable from `root` through three's own children, each once. */
function graph(...roots: Any[]): Any[] {
  const seen = new Set<Any>();
  const walk = (n: Any): void => {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (typeof n.getChildren === 'function') for (const c of n.getChildren()) walk(c);
    // A texture's sample keeps its base by reference (one binding): the base's own name is the sample's.
    if (n.referenceNode) walk(n.referenceNode);
  };
  for (const r of roots) walk(r);
  return [...seen];
}
const constsOf = (nodes: Any[]): number[] =>
  nodes.filter((n) => n.isConstNode).flatMap((n) => (typeof n.value === 'number' ? [n.value] : n.value && typeof n.value === 'object' ? ['x', 'y', 'z', 'w'].map((k) => n.value[k]).filter((v) => typeof v === 'number') : []));
const f32 = (v: number): number => Math.fround(v);
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)) || f32(a) === f32(b);

/** The GLSL text of a template literal named `name` in a file (`const NAME = /* glsl *\/ \`...\``, or `key: /* glsl *\/ \`...\``). */
function glsl(file: string, name: string): string {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const re = new RegExp(`(?:const\\s+${name}\\s*=|${name}:)\\s*(?:/\\*\\s*glsl\\s*\\*/)?\\s*\``);
  const m = re.exec(text);
  assert.ok(m, `${file}: the GLSL ${name} is found`);
  const from = m.index + m[0].length;
  const to = text.indexOf('`', from);
  return text.slice(from, to);
}
/** The uniforms a GLSL text declares by name. */
const declared = (src: string): Set<string> => new Set([...src.matchAll(/^\s*uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+(\w+)\s*;/gm)].map((m) => m[1]));
/** The number literals a GLSL text writes (comments left out; an `#include` carries none). */
const literals = (src: string): number[] =>
  [...src.replace(/\/\/[^\n]*/g, '').matchAll(/(?<![\w.])-?\d+\.\d*(?:e-?\d+)?|(?<![\w.])-?\d+e-?\d+|(?<![\w.])\d+\.(?!\d)/g)].map((m) => Number(m[0]));
/** Every number of a record, deep. */
const numbersOf = (o: unknown): number[] => (typeof o === 'number' ? [o] : Array.isArray(o) ? o.flatMap(numbersOf) : o && typeof o === 'object' ? Object.values(o).flatMap(numbersOf) : []);

/** The uniform names a graph reads at every draw, found by drawing it once against a material whose every uniform answers its own name. */
function ownNames(m: Any): { names: Set<string>; byRef: boolean } {
  const parts = m.gpuParts;
  const nodes = graph(parts.out, parts.gone, ...parts.first);
  const sentinel = new Map<string, object>();
  const asked: string[] = [];
  const uniforms = new Proxy({}, {
    get(_t, name: string) {
      asked.push(name);
      if (!sentinel.has(name)) sentinel.set(name, name === 'tNoise' ? new THREE.Data3DTexture() : /^(t|map|uSheet|uRoofMap)/.test(name) ? new THREE.Texture() : { name });
      return { value: sentinel.get(name) };
    },
  });
  const frame = { material: { uniforms, defines: { USE_MIX: '' } } };
  let byRef = true;
  for (const n of nodes) {
    if (typeof n.update !== 'function' || n.updateType === undefined || n.updateType === 'none') continue;
    const before = asked.length;
    try {
      n.update(frame);
    } catch {
      continue;
    }
    // Whatever it asked for, it now holds by reference (a texture's sample through its base).
    for (const name of asked.slice(before)) {
      const v = n.isTextureNode ? (n.referenceNode ?? n).value : n.value;
      if (v !== sentinel.get(name)) byRef = false;
    }
  }
  return { names: new Set(asked), byRef };
}

// ---------------------------------------------------------------- the graphs, against their WebGL text
const programs: { kind: keyof typeof PROGRAM_NUMBERS | 'weather'; make: () => Any; file: string; vert: string; frag: string; fog: boolean; drops: boolean; extra?: string[] }[] = [
  { kind: 'lava', make: lavaNode, file: 'src/world/lava.ts', vert: 'LAVA_VERT', frag: 'LAVA_FRAG', fog: true, drops: false },
  { kind: 'marks', make: marksNode, file: 'src/world/marks.ts', vert: 'VERT', frag: 'FRAG', fog: false, drops: true },
  { kind: 'blade', make: bladeNode, file: 'src/combat/saberBlade.ts', vert: 'RIBBON_VERT', frag: 'RIBBON_FRAG', fog: false, drops: false },
  { kind: 'particles', make: () => particlesNode(false), file: 'src/world/particles.ts', vert: 'VERT', frag: 'FRAG', fog: false, drops: true },
  { kind: 'weather', make: () => particlesNode(true), file: 'src/world/weather.ts', vert: 'vertex', frag: 'fragment', fog: false, drops: true },
  { kind: 'tunnel', make: tunnelNode, file: 'src/space/hyperspaceTunnel.ts', vert: 'VERTEX', frag: 'FRAGMENT', fog: false, drops: true },
];
for (const p of programs) {
  const m = p.make();
  const src = glsl(p.file, p.vert) + '\n' + glsl(p.file, p.frag);
  // 3. the material.
  ok(m.isNodeMaterial === true && m.lights === false && m.fog === p.fog, `${p.kind}: an unlit node material${p.fog ? ' with three\'s fog' : ', no fog of three\'s'}`);
  ok(!!m.fragmentNode && !!m.gpuParts?.out, `${p.kind}: its fragment is the graph's`);
  ok(!!m.gpuParts.gone === p.drops && /\bdiscard\b/.test(src) === p.drops, `${p.kind}: it drops a fragment exactly where the WebGL text does`);
  ok(Object.prototype.hasOwnProperty.call(m, 'setupObserver') && typeof m.setupObserver === 'function', `${p.kind}: three's observer is its own, told to refresh the object at every draw`);
  // 1. the uniforms.
  const { names, byRef } = ownNames(m);
  const want = declared(src);
  const reads = [...names].filter((n) => n !== 'USE_MIX');
  ok(reads.length > 0 && reads.every((n) => want.has(n)), `${p.kind}: every uniform it reads is the WebGL program's own (${reads.sort().join(', ')})`);
  ok([...want].every((n) => names.has(n)), `${p.kind}: every uniform the WebGL program declares is read (${[...want].filter((n) => !names.has(n)).join(', ') || 'all'})`);
  ok(byRef, `${p.kind}: each is the drawn material's very object, read at the draw`);
  // Three writes a texture's code from the texture its node holds as the graph is built (nearest both ways: a fetch with no
  // sampler) and gives two nodes holding one texture one binding: each slot's fallback is its own and filtered linearly.
  const slots = graph(m.gpuParts.out, m.gpuParts.gone, ...m.gpuParts.first).filter((n) => typeof n.ownName === 'string' && n.ownName !== '' && n.fallback);
  const fallOf = new Map<string, Any>(slots.map((n) => [n.ownName, n.fallback]));
  const falls = [...fallOf.values()];
  ok(new Set(falls).size === falls.length, `${p.kind}: no two of its texture slots share a fallback (${[...fallOf.keys()].join(', ') || 'none'})`);
  ok(falls.every((t) => t.type === THREE.FloatType || !(t.minFilter === THREE.NearestFilter && t.magFilter === THREE.NearestFilter)), `${p.kind}: every sampled slot's fallback is filtered linearly, so three samples it and never fetches it`);
  // 2. the numbers.
  const consts = constsOf(graph(m.gpuParts.out, m.gpuParts.gone, ...m.gpuParts.first));
  const lits = literals(src).filter((v) => v !== 0 && Math.abs(v) !== 1 && v !== 2);
  const missing = lits.filter((v) => !consts.some((c) => near(c, v)));
  ok(missing.length === 0, `${p.kind}: every literal of the WebGL text is one of the graph's constants (${lits.length}; missing ${missing.join(', ') || 'none'})`);
  if (p.kind !== 'weather') {
    const record = numbersOf(PROGRAM_NUMBERS[p.kind as keyof typeof PROGRAM_NUMBERS]);
    const all = literals(src);
    const invented = record.filter((v) => !all.some((l) => near(l, v)) && v !== 0 && Math.abs(v) !== 1);
    ok(invented.length === 0, `${p.kind}: every number of PROGRAM_NUMBERS.${p.kind} is the WebGL text's own (${invented.join(', ') || 'none invented'})`);
  }
}

// The lava's samples are taken at the top of its fragment, before the crust's branch: three writes a `select` out as an
// `if`, and read first inside one they were taken where the quad's lanes part (every edge of the crust), at undefined mips.
{
  const m = lavaNode() as Any;
  const top = graph(...m.gpuParts.first);
  ok(['tNoise', 'tRamp', 'tMix'].every((name) => top.some((n) => n.isTextureNode && n.ownName === name)) && top.some((n) => n.isMathNode && n.method === 'fwidth'), "lava: the noise, the ramp, the crust and the veins' width are taken at the top of the fragment, as WebGL takes them");
  const under = graph(m.gpuParts.out);
  ok(!under.some((n) => n.isTextureNode && n.ownName) && !under.some((n) => n.isMathNode && /^(dFd[xy]|fwidth)$/.test(n.method)), 'lava: nothing under its branches samples a picture or takes a derivative of its own');
  // What it reads under its branches are the properties `first` fills, and `finish` fills them before anything else runs.
  const read = new Set(under.filter((n) => n.isPropertyNode).map((n) => n.name));
  ok(['gLavaFar', 'gLavaIndex', 'gLavaRamp', 'gLavaCrust'].every((p) => read.has(p)), "lava: its colour reads the far share, the index, the ramp and the crust off the properties its fragment's top fills");
  const fin = readFileSync(join(ROOT, 'src/core/gpu/gpuPrograms.ts'), 'utf8');
  const body = fin.slice(fin.indexOf('function finish('), fin.indexOf('// ---------------------------------------------------------------- 3. the lava'));
  ok(/Fn\(\(\) => \{[\s\S]*for \(const \[p, v\] of first\) p\.assign\(v\);[\s\S]*if \(gone\) Discard\(gone\);[\s\S]*return out;/.test(body), 'finish fills every property of `first` at the top of the fragment, before its drop and its colour');
}

// The tunnel's mean is the GLSL's own product of three, multiplied in the graph (never a number of ours).
{
  const g = glsl('src/space/hyperspaceTunnel.ts', 'FRAGMENT');
  ok(/float mean = 0\.38 \* 0\.07 \* 0\.45;/.test(g) && PROGRAM_NUMBERS.tunnel.mean.join(',') === '0.38,0.07,0.45', 'tunnel: the mean a cell fades to is the GLSL product of the same three factors');
}

// ---------------------------------------------------------------- 4. the switches and the not-ported list
for (const k of ['lava', 'marks', 'blades', 'particles', 'tunnel'] as const) ok(typeof LOOKS_AT_LOAD[k] === 'boolean', `the ${k} part is a switch taken at load (localStorage['swg.gpu.${k}'])`);
for (const k of ['sky', 'water', 'clouds', 'volumetrics', 'wetness', 'sway', 'grass', 'force', 'vehicleDust', 'roomAir', 'previewDof', 'effects']) ok(typeof NOT_PORTED[k] === 'string' && NOT_PORTED[k].length > 10, `gpu() says what is not ported: ${k}`);
ok(/Force lightning/.test(NOT_PORTED.force) && /remake/.test(NOT_PORTED.grass), "the not-ported list names the owner's overhaul of the Force and the plant sprites' remake");

console.log(`gpuPrograms: ${checks} checks passed`);
