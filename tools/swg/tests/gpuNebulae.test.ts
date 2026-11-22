// A space zone's nebulae on WebGPU (the GPU port's pass 2, wave 3, maker B: `src/core/gpu/gpuNebulae.ts`), in node:
//  1. each graph (the sheets, the haze, a bolt) against the WebGL program it stands in for (`src/space/nebulae.ts`'s GLSL):
//     every uniform it reads is one of that program's own or one WebGPU hands it for its places (the anchor less the eye,
//     a bolt's ends less the eye), read at every draw off the drawn material by reference, every one the program declares
//     read but the two world places those stand for; every literal of the text that is not 0, 1 or 2 one of its constants and
//     every number of `NEBULA_GPU_NUMBERS` the text's own; unlit, no fog of three's, a drop where WebGL drops, an object
//     refresh at every draw; read through the eye (the glow factor's storage read); and nothing placed from the world's
//     middle (no `cameraPosition`, no world matrix, so no `positionWorld`);
//  2. the real `Nebulae` class built on both paths from one zone far from the world's middle: on WebGL its materials and
//     buffers as before (no stand-in, no uniform of WebGPU's, world places in the buffers); on WebGPU each nebula a group kept
//     relative to its own middle -- every sheet stored as its offset from it with its row, the table of every middle less the
//     eye worked in doubles each frame -- so what reaches the card is no bigger than a nebula and the card's sheet less the
//     eye is at least as near the exact one as WebGL's, the sort WebGL's own on both, a bolt handed its ends less the eye,
//     and every material given its stand-in;
//  3. the wiring as text: every WebGPU line in `nebulae.ts` a guard, the WebGL line beside it the one it had.
//
// Run: node tools/swg/tests/gpuNebulae.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { NEBULA_GPU_NUMBERS, nebulaBoltNode, nebulaHazeNode, nebulaSheetNode } from '../../../src/core/gpu/gpuNebulae.ts';
import { GPU } from '../../../src/core/gpuSwitch.ts';
import { Nebulae, type NebulaShip } from '../../../src/space/nebulae.ts';
import type { Nebula, NebulaColour } from '../../../src/space/spaceData.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};

/** Every node reachable from the roots through three's own children, each once. */
function graph(...roots: Any[]): Any[] {
  const seen = new Set<Any>();
  const walk = (n: Any): void => {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (typeof n.getChildren === 'function') for (const c of n.getChildren()) walk(c);
    if (n.referenceNode) walk(n.referenceNode);
  };
  for (const r of roots) walk(r);
  return [...seen];
}
const constsOf = (nodes: Any[]): number[] =>
  nodes.filter((n) => n.isConstNode).flatMap((n) => (typeof n.value === 'number' ? [n.value] : n.value && typeof n.value === 'object' ? ['x', 'y', 'z', 'w'].map((k) => n.value[k]).filter((v) => typeof v === 'number') : []));
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)) || Math.fround(a) === Math.fround(b);
function glsl(file: string, name: string): string {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const m = new RegExp(`const\\s+${name}\\s*=\\s*(?:/\\*\\s*glsl\\s*\\*/)?\\s*\``).exec(text);
  assert.ok(m, `${file}: the GLSL ${name} is found`);
  const from = m.index + m[0].length;
  return text.slice(from, text.indexOf('`', from));
}
const declared = (src: string): Set<string> => new Set([...src.matchAll(/^\s*uniform\s+\w+\s+(\w+)\s*;/gm)].map((m) => m[1]));
const literals = (src: string): number[] => [...src.replace(/\/\/[^\n]*/g, '').matchAll(/(?<![\w.])-?\d+\.\d*(?:e-?\d+)?|(?<![\w.])-?\d+e-?\d+|(?<![\w.])\d+\.(?!\d)/g)].map((m) => Number(m[0]));
const numbersOf = (o: unknown): number[] => (typeof o === 'number' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(numbersOf) : []);

/** The uniform names a graph reads at every draw, found by updating its nodes against a material whose every uniform answers its own name. */
function ownNames(nodes: Any[]): { names: Set<string>; byRef: boolean } {
  const sentinel = new Map<string, object>();
  const asked: string[] = [];
  const uniforms = new Proxy({}, {
    get(_t, name: string) {
      asked.push(name);
      if (!sentinel.has(name)) sentinel.set(name, name === 'uMap' || name === 'uMiddles' ? new THREE.Texture() : { name });
      return { value: sentinel.get(name) };
    },
  });
  const frame = { material: { uniforms } };
  let byRef = true;
  for (const n of nodes) {
    if (typeof n.update !== 'function' || n.updateType === undefined || n.updateType === 'none') continue;
    const before = asked.length;
    try {
      n.update(frame);
    } catch {
      continue;
    }
    for (const name of asked.slice(before)) {
      const v = n.isTextureNode ? (n.referenceNode ?? n).value : n.value;
      if (v !== sentinel.get(name)) byRef = false;
    }
  }
  return { names: new Set(asked), byRef };
}

// ---------------------------------------------------------------- 1. the graphs against their WebGL text
const programs = [
  { kind: 'sheet', make: nebulaSheetNode, vert: 'SHEET_VERTEX', frag: 'SHEET_FRAGMENT', gpuOwn: ['uMiddles'], worldOnly: [] as string[] },
  { kind: 'haze', make: nebulaHazeNode, vert: 'SHELL_VERTEX', frag: 'SHELL_FRAGMENT', gpuOwn: [] as string[], worldOnly: [] as string[] },
  { kind: 'bolt', make: nebulaBoltNode, vert: 'BEAM_VERTEX', frag: 'BEAM_FRAGMENT', gpuOwn: ['uFromEye', 'uToEye'], worldOnly: ['uFrom', 'uTo'] },
] as const;
for (const p of programs) {
  const m = p.make() as Any;
  const src = glsl('src/space/nebulae.ts', p.vert) + '\n' + glsl('src/space/nebulae.ts', p.frag);
  const nodes = graph(m.gpuParts.out, m.gpuParts.gone, ...m.gpuParts.first, m.vertexNode);
  ok(m.isNodeMaterial === true && m.lights === false && m.fog === false && !!m.fragmentNode, `${p.kind}: an unlit node material, no fog of three's, its fragment the graph's`);
  ok(!!m.gpuParts.gone === /\bdiscard\b/.test(src), `${p.kind}: it drops a fragment where the WebGL text does`);
  ok(Object.prototype.hasOwnProperty.call(m, 'setupObserver'), `${p.kind}: three's observer told to refresh the object at every draw`);
  ok((p.kind === 'haze') === !m.vertexNode, `${p.kind}: ${p.kind === 'haze' ? "placed by three's own model-view (a sphere at the eye)" : 'its clip place its own, from the eye'}`);
  const { names, byRef } = ownNames(nodes);
  const want = declared(src);
  const reads = [...names];
  ok(reads.length > 0 && reads.every((n) => want.has(n) || (p.gpuOwn as readonly string[]).includes(n)), `${p.kind}: every uniform it reads is the WebGL program's own or WebGPU's place of one (${reads.sort().join(', ')})`);
  const unread = [...want].filter((n) => !names.has(n));
  ok(unread.join() === (p.worldOnly as readonly string[]).join(), `${p.kind}: every uniform the WebGL program declares is read but the world places WebGPU is handed less the eye (${unread.join(', ') || 'none left'})`);
  ok(byRef, `${p.kind}: each is the drawn material's very object, read at the draw`);
  const consts = constsOf(nodes);
  const lits = literals(src).filter((v) => v !== 0 && Math.abs(v) !== 1 && v !== 2);
  const missing = lits.filter((v) => !consts.some((c) => near(c, v)));
  ok(missing.length === 0, `${p.kind}: every literal of the WebGL text is one of the graph's constants (${lits.length}; missing ${missing.join(', ') || 'none'})`);
  const all = literals(src);
  const invented = numbersOf(NEBULA_GPU_NUMBERS[p.kind]).filter((v) => !all.some((l) => near(l, v)) && v !== 0 && Math.abs(v) !== 1);
  ok(invented.length === 0, `${p.kind}: every number of NEBULA_GPU_NUMBERS.${p.kind} is the WebGL text's own (${invented.join(', ') || 'none invented'})`);
  // Read through the eye: the glow factor is a read of the eye's storage buffer.
  ok(nodes.some((n) => n.isStorageBufferNode === true || n.isStorageArrayElementNode === true || n.node?.isStorageBufferNode === true), `${p.kind}: its light is times the eye's glow factor (the eye's buffer is read)`);
  // WebGPU gives a pipeline eight vertex buffers: every attribute the graph reads is one (the sheets' first build read nine,
  // the quad's uv beside its place, and failed in the browser).
  const attrs = new Set(nodes.filter((n) => n.isAttributeNode === true || n.type === 'AttributeNode').map((n) => n._attributeName ?? n.attributeName ?? n.name).filter(Boolean));
  if (nodes.some((n) => n.isPositionNode === true || n.scope === 'position' || n.name === 'positionLocal' || n.name === 'positionGeometry')) attrs.add('position');
  ok(attrs.size <= 8 && !attrs.has('uv'), `${p.kind}: it reads ${attrs.size} vertex attributes, within WebGPU's eight a pipeline (${[...attrs].sort().join(', ')})`);
  // Nothing placed from the world's middle: no camera place, no world matrix (`positionWorld` is three's world matrix times the place).
  const world = nodes.filter((n) => n.name === 'cameraPosition' || n.scope === 'worldMatrix' || n.scope === 'position' || n.name === 'v_positionWorld');
  ok(world.length === 0, `${p.kind}: no place measured from the world's middle reaches its graph (${world.map((n) => n.name || n.scope).join(', ') || 'none'})`);
}

// ---------------------------------------------------------------- 2. the real class on both paths
const row = (name: string, at: [number, number, number], radius: number, extra: Partial<Nebula> = {}): Nebula => ({
  name,
  at,
  radius,
  density: 1,
  facingShare: 0.5,
  facing: { colour: [0.6, 1, 0.8, 0.8] as NebulaColour, ramp: [0.2, 0.4, 0.6, 1] as NebulaColour },
  oriented: { colour: [0.5, 1, 1, 1] as NebulaColour, ramp: [0.5, 1, 1, 1] as NebulaColour },
  jitter: 0,
  shader: 'mist',
  shaderIndex: 1,
  sound: { ambient: null, volume: 0 },
  lightning: null,
  unused: {},
  ...extra,
});
const stormy = { appearance: 'x', every: 2, maxSeconds: 1.5, damage: [40, 120] as [number, number], colour: [0.5, 1, 0.6, 0.2] as NebulaColour, ramp: [0.5, 1, 0.9, 0.3] as NebulaColour, sounds: { strike: null, loop: null }, hit: { client: null, server: null } };
// A zone far from the world's middle, as Tatooine's station is: its places are the ones a 32-bit float rounds.
const rows: Nebula[] = [
  row('near and thick', [-5871.25, 210.5, 6030.75], 1800, { shader: 'mist', lightning: stormy }),
  row('a second mist', [-7420.5, -300.25, 8110.5], 2200, { shader: 'mist' }),
  row('far and glowing', [-1200.75, 800.5, 9300.25], 2600, { shader: 'glow' }),
];
const look = { shader: '', effect: null, blend: 'alpha' as const, texture: 'nebula/mist.png', shell: { shader: '', effect: null, texture: 'nebula/mist.png' } };
const pack: Any = {
  version: 3, zone: 'z', planet: null, title: 'z', stations: [], scenery: [], planets: [], arrival: null, hyperspace: null,
  nebulae: rows,
  nebulaLook: { glow: { ...look, blend: 'add' as const, texture: 'nebula/glow.png' }, mist: look },
  lightning: { source: '', flipbook: { shader: '', frames: 4, frameStart: 0, frameEnd: 3, uvSize: 0.5, perColumn: 2, fps: 10, visible: true }, texture: 'nebula/lightning.png', waveforms: [], value: 0, start: null, end: null, trailingBytes: 0 },
  fields: [], lanes: {}, dockEffects: {},
};
const deps = (): Any => ({ place: () => null, remove: () => {}, flash: () => {}, ships: () => [] as NebulaShip[], strike: () => true, playerShip: () => null, damageEnabled: () => true, now: () => 1_700_000_000_000, texture: async () => new THREE.Texture() });
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 9000);
// An eye no float holds exactly, as a flown ship's never is.
camera.position.set(-6400.37311, 120.61773, 7000.88131);
camera.lookAt(-6400, 120, 8000);
camera.updateMatrixWorld(true);
const build = async (webgpu: boolean): Promise<Any> => {
  GPU.webgpu = webgpu;
  const n = (await Nebulae.build(deps(), pack, (f) => f, async () => true, () => true)) as Any;
  GPU.webgpu = false;
  return n;
};
const gl = await build(false);
const gpu = await build(true);
ok(!!gl && !!gpu, 'the zone is built on both paths');
const setsOf = (n: Any): Any[] => n.sets;
const glSets = setsOf(gl);
const gpuSets = setsOf(gpu);
ok(glSets.every((s: Any) => s.material.uniforms.uMiddles === undefined && s.material.userData.gpuStandIn === undefined), 'WebGL: the sheet materials are as they were (no uniform of WebGPU\'s, no stand-in)');
ok(gl.gpuMiddles === null && gl.gpuRowOf.size === 0, 'WebGL: no table of middles is made and no row is looked for');
ok(gpuSets.every((s: Any) => s.material.uniforms.uMiddles?.value?.isDataTexture && typeof s.material.userData.gpuStandIn === 'function'), 'WebGPU: every sheet set is handed the table of middles and its graph');
const table = gpuSets[0].material.uniforms.uMiddles.value as THREE.DataTexture;
ok(table.image.width === rows.length && table.minFilter === THREE.NearestFilter && table.magFilter === THREE.NearestFilter && table.type === THREE.FloatType, `WebGPU: the table is a texel a nebula (${table.image.width}), nearest both ways so read with no sampler, in floats`);
const gpuMats: Any[] = [];
gpu.group.traverse((o: Any) => o.isMesh && gpuMats.push(o.material));
ok(gpuMats.every((m) => typeof m.userData.gpuStandIn === 'function') && gpuMats.filter((m) => m.name === 'nebula:lightning').every((m) => m.uniforms.uFromEye && m.uniforms.uToEye), `WebGPU: every material of the zone has its stand-in (${gpuMats.length}), each bolt its two ends less the eye`);
const glMats: Any[] = [];
gl.group.traverse((o: Any) => o.isMesh && glMats.push(o.material));
ok(glMats.every((m) => m.userData.gpuStandIn === undefined && m.uniforms.uFromEye === undefined), 'WebGL: none has a stand-in or a uniform of WebGPU\'s');
// A frame on both, each under its own switch (read once at boot in the game, and never moved): the sort is WebGL's own on
// both paths, so the sheets stand in the same order in both sets of buffers.
const step = (n: Any, webgpu: boolean): void => {
  GPU.webgpu = webgpu;
  n.update(1 / 60, camera);
  GPU.webgpu = false;
};
step(gl, false);
step(gpu, true);
const eyeD = [camera.position.x, camera.position.y, camera.position.z];
const mids = (gpu.gpuMiddles as Float32Array).slice();
let tableWorst = 0;
for (let r = 0; r < rows.length; r++) for (let k = 0; k < 3; k++) tableWorst = Math.max(tableWorst, Math.abs(mids[r * 4 + k] - Math.fround(rows[r].at[k] - eyeD[k])));
ok(tableWorst === 0, "WebGPU: each frame the table holds every nebula's middle less the eye, worked in doubles before it is a float");
let worstRel = 0;
let worstWebGl = 0;
let nearRel = 0;
let nearWebGl = 0;
let nearCount = 0;
let biggest = 0;
let rowsRight = true;
for (let s = 0; s < glSets.length; s++) {
  const a = glSets[s];
  const b = gpuSets[s];
  ok(a.count === b.count && a.count > 0, `set ${a.look}: the same ${a.count} sheets on both paths`);
  const ca = a.data[0].array as Float32Array;
  const ma = a.data[1].array as Float32Array;
  const cb = b.data[0].array as Float32Array;
  const mb = b.data[1].array as Float32Array;
  for (let i = 0; i < a.count; i++) {
    const row = mb[i * 3];
    if (!Number.isInteger(row) || rows[row].shader !== a.look || rows[row].at.some((v, k) => Math.fround(v) !== ma[i * 3 + k])) rowsRight = false;
    const away = Math.hypot(ca[i * 3] - eyeD[0], ca[i * 3 + 1] - eyeD[1], ca[i * 3 + 2] - eyeD[2]);
    if (away < 400) nearCount++;
    for (let k = 0; k < 3; k++) {
      biggest = Math.max(biggest, Math.abs(cb[i * 3 + k]));
      // What the card adds (two floats) against the exact place less the eye (WebGL's stored centre, in doubles).
      const card = Math.fround(cb[i * 3 + k] + mids[row * 4 + k]);
      const exact = ca[i * 3 + k] - eyeD[k];
      worstRel = Math.max(worstRel, Math.abs(card - exact));
      // And what WebGL's program works on the card: its stored world centre less the camera's place as a float.
      const webgl = Math.abs(Math.fround(ca[i * 3 + k] - Math.fround(eyeD[k])) - exact);
      worstWebGl = Math.max(worstWebGl, webgl);
      if (away < 400) {
        nearRel = Math.max(nearRel, Math.abs(card - exact));
        nearWebGl = Math.max(nearWebGl, webgl);
      }
    }
  }
}
// Near the eye the two terms the card adds are each no bigger than a nebula, so its error is bounded by the nebula's size
// (two roundings of the largest offset) and not by the distance from the world's middle.
const bound = 2 * biggest * 2 ** -24;
ok(nearCount > 0 && nearRel <= bound && nearRel < nearWebGl, `WebGPU: near the eye (${nearCount} sheets within 400 m) the card's error is ${(nearRel * 1000).toFixed(4)} mm, under the nebula's own bound (${(bound * 1000).toFixed(4)} mm), against WebGL's ${(nearWebGl * 1000).toFixed(4)} mm from places 11 km from the middle`);
ok(rowsRight, "WebGPU: each sheet carries its own nebula's row, of its own look, whose middle WebGL's buffer holds for it");
const reach = Math.max(...rows.map((r) => r.radius));
ok(biggest <= reach * 1.5, `WebGPU: what reaches the card is a sheet's offset from its own nebula's middle (largest ${Math.round(biggest)} m, the biggest nebula ${reach} m round; the world's places reach ${Math.round(Math.max(...rows.map((r) => Math.hypot(...r.at))))} m)`);
ok(worstRel <= worstWebGl + 1e-9, `WebGPU: the card's sheet less the eye is the exact one within ${(worstRel * 1000).toFixed(3)} mm, where WebGL's world places give ${(worstWebGl * 1000).toFixed(3)} mm`);
// A bolt through the nearest striking nebula: handed its ends less the eye.
gpu.forceStrike(camera.position);
step(gpu, true);
const live = gpu.beams.find((b: Any) => b.mesh.visible);
ok(!!live, 'a strike is drawn');
const u = live.material.uniforms;
ok(u.uFromEye.value.x === u.uFrom.value.x - camera.position.x && u.uToEye.value.z === u.uTo.value.z - camera.position.z, "WebGPU: the bolt drawn holds its two ends less the eye, in doubles, its world ends WebGL's as ever");
gl.dispose(() => {});
gpu.dispose(() => {});

// ---------------------------------------------------------------- 3. the wiring as text
const neb = readFileSync(join(ROOT, 'src/space/nebulae.ts'), 'utf8').split(/\r?\n/).map((l) => l.trim());
const gpuLines = neb.filter((l) => /GPU\.(webgpu|rt)/.test(l) && !/^(\/\/|\*|\/\*\*)/.test(l));
const guards = gpuLines.filter((l) => l.startsWith('if (GPU.webgpu)'));
ok(guards.length === 7, `nebulae.ts: seven WebGPU guards (${guards.length})`);
ok(gpuLines.every((l) => l.startsWith('if (GPU.webgpu)') || /^material\.userData\.gpuStandIn = \(\) => GPU\.rt!\.standIns\.nebula\('(sheets|bolt)'\);$/.test(l)), 'nebulae.ts: every other line that reaches the WebGPU side is inside a method only those guards call');
for (const [gpuLine, before] of [
  ['if (GPU.webgpu) this.gpuSheets(material);', 'material.userData.dry = true;'],
  ['if (GPU.webgpu) this.gpuRows();', "this.sortedAt.set(Infinity, Infinity, Infinity);"],
  ['if (GPU.webgpu) this.gpuBolt(material);', 'material.userData.dry = true;'],
  ["if (GPU.webgpu) material.userData.gpuStandIn = () => GPU.rt!.standIns.nebula('haze');", 'material.userData.dry = true;'],
  ['if (GPU.webgpu) this.gpuSheetsFrame(eye);', 'this.sortMist(eye);'],
  ['if (GPU.webgpu) this.gpuBolts(eye);', 'this.updateStrikes(dt, eye);'],
  ['if (GPU.webgpu) this.gpuMiddlesMade(rows.length);', 'for (let i = 0; i < records; i++) this.live.push({ row: -1, a: new THREE.Vector3(), b: new THREE.Vector3(), until: 0, roll: 0 });'],
] as const) {
  const at = neb.indexOf(gpuLine);
  const prev = neb.slice(0, at).filter((l) => l && !/^(\/\/|\*|\/\*\*)/.test(l)).pop();
  ok(at > 0 && neb.lastIndexOf(gpuLine) === at && prev === before, `nebulae.ts: ${gpuLine} stands once, after the line that was there`);
}
ok(neb.includes("import { GPU } from '../core/gpuSwitch.ts';") && !neb.some((l) => /from '\.\.\/core\/gpu\//.test(l) || /three\/(webgpu|tsl)/.test(l)), 'nebulae.ts takes the switch alone, nothing of the WebGPU side');

console.log(`gpuNebulae: ${checks} checks passed`);
