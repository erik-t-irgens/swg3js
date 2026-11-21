// The meshlet trial's step A (the GPU port's pass 1, wave 7: `src/core/gpu/meshletTrial.ts`), driven over three's own
// `MeshletDrawingPipeline` (the addon the game loads under `?meshlet`, imported here as the game imports it) on a stand-in
// renderer carrying three's own node library:
//
//  1. what it is offered: a placed object (the streamer's stamp, or a building's room) and nothing else;
//  2. the census: three's own verdict (`_isMeshlet`) over fixtures made to fall foul of each of its rules and ours, every
//     reason named as three orders them, no line disagreeing with three, our parts' refusals on top of three's;
//  3. the warm-up's walk: three's pipeline kept off inside a precompile, and its `prepareAsync` never run by `compileAsync`;
//  4. the live switch puts the standard pipeline back as it was, and the trial's own shadow cull rides on the trial's;
//  5. our look parts on three's draw material: the parts that carry go on, the refused ones never, and the batch's maker
//     is wrapped once a module;
//  6. the default path: three's addon is imported in one place, dynamically, only where `?meshlet` asked;
//  7. the anchors: every method and function of the addon the trial overrides, calls or copies a rule of, held to a hash of
//     its text at 188dev, and the two stamps `placedOf` reads, held to where the streamer and the rooms write them.
//
// Run: node tools/swg/tests/meshletTrial.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as W from 'three/webgpu';
import { MESHLET, MESHLET_STATS, PARTS_REFUSED, dress, makeTrial, ourRefusal, placedOf, refusalOf } from '../../../src/core/gpu/meshletTrial.ts';
import { LOOK_PARTS } from '../../../src/core/gpu/looks.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string): string => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');

const mod: Any = await import('three/examples/jsm/pipelines/MeshletDrawingPipeline.js');
const library = new (W as Any).StandardNodeLibrary();
const standard = new (W as Any).StandardDrawingPipeline();
const renderer: Any = { library, backend: { isWebGPUBackend: true }, reversedDepthBuffer: false, _precompilationState: null, drawingPipeline: null };
standard.renderer = renderer;
renderer.drawingPipeline = standard;

// Our look parts as the game lists them (start.ts pushes them at start): stand-ins of each name, each applying where a
// material carries its name in `userData.parts`, recording what it was put on.
const putOn: string[] = [];
const parts = ['lightHold', 'detail', 'spec', 'card'].map((name) => ({
  name,
  applies: (m: Any) => Array.isArray(m.userData?.parts) && m.userData.parts.includes(name),
  apply: (n: Any) => {
    putOn.push(name);
    n.userData = { ...(n.userData ?? {}), dressed: [...(n.userData?.dressed ?? []), name] };
  },
}));
LOOK_PARTS.length = 0;
LOOK_PARTS.push(...parts);

const trial = makeTrial(mod, renderer);
const p: Any = trial.pipeline;

// ---------------------------------------------------------------- 1. placed objects alone
const box = new W.BoxGeometry(1, 1, 1);
const placed = (m: Any, copies = 3): Any => {
  const mesh: Any = new W.InstancedMesh(box, m, copies);
  mesh.userData.casterRadius = 2;
  mesh.updateMatrixWorld();
  return mesh;
};
const std = (o: Record<string, unknown> = {}): Any => Object.assign(new W.MeshStandardMaterial(), o);
{
  const a = placed(std());
  ok(placedOf(a), 'a mesh the streamer stamped is placed');
  const loose: Any = new W.InstancedMesh(box, std(), 3);
  ok(!placedOf(loose), 'an instanced mesh with no stamp is not');
  const room: Any = new W.Mesh(box, std());
  room.layers.set(1);
  room.matrixAutoUpdate = false;
  ok(placedOf(room), "a building's room (the rooms' layer alone, its matrix written by hand) is placed");
  const roomAuto: Any = new W.Mesh(box, std());
  roomAuto.layers.set(1);
  ok(!placedOf(roomAuto), 'a mesh on the rooms layer whose matrix three works out is not');
  const actor: Any = new W.Mesh(box, std());
  actor.layers.set(31);
  actor.matrixAutoUpdate = false;
  ok(!placedOf(actor), 'a mesh on the actor layer is not');
  p._meshletsEnabled = true;
  p._depth = 1;
  p._shadowPass = false;
  p._capture = null;
  ok(p._isMeshlet(a, a.geometry, a.material, null) === true, 'three takes a placed opaque front-sided standard material');
  ok(p._isMeshlet(loose, loose.geometry, loose.material, null) === false, 'the trial offers three nothing that is not placed');
  ok(mod.MeshletDrawingPipeline.prototype._isMeshlet.call(p, loose, loose.geometry, loose.material, null) === true, '... which three alone would have taken');
}

// ---------------------------------------------------------------- 2. the census over three's own verdict
{
  const tex = (channel: number): Any => {
    const t: Any = new W.Texture();
    t.channel = channel;
    return t;
  };
  const mirrored = placed(std());
  mirrored.scale.set(-1, 1, 1);
  mirrored.updateMatrixWorld();
  const hooked = placed(std());
  hooked.onBeforeRender = () => {};
  const noNormals = new W.BufferGeometry();
  noNormals.setAttribute('position', new W.Float32BufferAttribute(new Float32Array(9), 3));
  const bare: Any = new W.InstancedMesh(noNormals, std(), 2);
  bare.userData.casterRadius = 1;
  bare.updateMatrixWorld();
  const empty = placed(std(), 0);
  const shader: Any = placed(new W.ShaderMaterial());
  const node: Any = placed(Object.assign(new W.MeshStandardNodeMaterial(), { fragmentNode: (W as Any).TSL?.vec4?.(1) ?? {} }));
  const cases: [string, Any, string | null][] = [
    ['taken', placed(std()), null],
    ['two-sided', placed(std({ side: W.DoubleSide })), 'two-sided'],
    ['back', placed(std({ side: W.BackSide })), 'back-sided'],
    ['see-through', placed(std({ transparent: true })), 'see-through'],
    ['polygon offset', placed(std({ polygonOffset: true })), 'polygon offset'],
    ['uv1 picture', placed(std({ aoMap: tex(1) })), 'a picture on a second uv set (aoMap)'],
    ['uv0 picture', placed(std({ map: tex(0) })), null],
    ['alpha cut', placed(std({ alphaTest: 0.5 })), null],
    ['no depth write', placed(std({ depthWrite: false })), 'no depth write'],
    ['vertex colours', placed(std({ vertexColors: true })), 'vertex colours'],
    ['shader material', shader, 'no node class (a shader material)'],
    ['a node of its own', node, 'a node of its own (fragmentNode)'],
    ['mirrored', mirrored, 'mirrored (its matrix turns the winding over)'],
    ['draw hook', hooked, 'a draw hook of its own'],
    ['no normals', bare, 'no normals'],
    ['no copies', empty, 'no copies'],
    ['our detail', placed(std({ userData: { parts: ['lightHold', 'detail'] } })), PARTS_REFUSED.detail],
    ['our card', placed(std({ userData: { parts: ['lightHold', 'spec', 'card'] } })), PARTS_REFUSED.card],
    ['our carried parts', placed(std({ userData: { parts: ['lightHold', 'spec'] } })), null],
  ];
  const scene = new W.Scene();
  for (const [, mesh] of cases) scene.add(mesh);
  const loose: Any = new W.InstancedMesh(box, std(), 4);
  scene.add(loose);
  scene.updateMatrixWorld();
  for (const [name, mesh, want] of cases) {
    const three = p._isMeshlet(mesh, mesh.geometry, mesh.material, null) === true;
    const said = refusalOf(mesh, mesh.geometry, mesh.material, null, library) ?? ourRefusal(mesh.material);
    ok(three === (want === null), `${name}: three ${three ? 'takes' : 'refuses'} it`);
    ok(said === want, `${name}: the census names "${said}", wanted "${want}"`);
  }
  const { census } = await import('../../../src/core/gpu/meshletTrial.ts').then((m) => ({ census: m.meshletCensus }));
  // The census reads the trial made by `startMeshletTrial`; here none is, so it says so in words.
  const none = census(scene, renderer) as Any;
  ok(typeof none.census === 'string' && /not made/.test(none.census), 'the census with no trial made says so');
}

// ---------------------------------------------------------------- 3. the warm-up's walk
{
  const cam = new W.PerspectiveCamera();
  cam.updateMatrixWorld();
  const ctx: Any = { clippingContext: null };
  const before = MESHLET_STATS.precompilesKept;
  p._ready = true;
  renderer.getRenderTarget = () => null;
  renderer.getRenderObjectFunction = () => null;
  renderer.logarithmicDepthBuffer = false;
  renderer.localClippingEnabled = false;
  renderer.contextNode = { getFlowContextData: () => ({}) };
  renderer._callDepth = 0;
  p.begin(cam, ctx);
  ok(p._meshletsEnabled === true, "outside a precompile three's pipeline is on for a perspective render");
  renderer._precompilationState = {};
  p.begin(cam, ctx);
  ok(p._meshletsEnabled === false && p._meshletsSupported === false, "inside a precompile three's pipeline is kept off");
  ok(MESHLET_STATS.precompilesKept === before + 1, 'and the render counted');
  // A precompile's render list is finished as the standard pipeline finishes one: three's batches of that list untouched.
  const list: Any = { begun: 0, finished: 0, begin() { this.begun++; }, finish() { this.finished++; } };
  let drew = 0;
  p._renderListBatches.set(list, { entries: [], staticGroups: new Map() });
  const ownDraw = p._drawBatches;
  p._drawBatches = () => { drew++; };
  const depth0 = p._depth;
  p.beginRenderList(list);
  p.finishRenderList(list);
  ok(drew === 0 && list.finished === 1 && p._depth === depth0, "a precompile's render list is finished without three's _drawBatches, its depth put back");
  renderer._precompilationState = null;
  p.begin(cam, ctx);
  p.beginRenderList(list);
  p.finishRenderList(list);
  ok(drew === 1 && list.finished === 2 && p._depth === depth0, "a real render's list runs three's _drawBatches as three does");
  // A shadow map's render nested in a real one, and a precompile's nested the same way, each finish as they began.
  p.begin(cam, ctx);
  p.beginRenderList(list);
  renderer._precompilationState = {};
  p.begin(cam, ctx);
  p.beginRenderList(list);
  p.finishRenderList(list);
  renderer._precompilationState = null;
  p.finishRenderList(list);
  ok(drew === 2 && p._depth === depth0, 'nested lists finish each by its own begin');
  p._drawBatches = ownDraw;
  p._renderListBatches.delete(list);
  renderer.reversedDepthBuffer = true;
  p.begin(cam, ctx);
  ok(p._meshletsEnabled === false, 'under reversed depth three keeps itself off (both arms run ?norevz)');
  renderer.reversedDepthBuffer = false;
  ok(p.prepareAsync(new W.Scene(), cam) === undefined, "prepareAsync answers nothing, so compileAsync's listing stays synchronous");
  ok(mod.MeshletDrawingPipeline.prototype.prepareAsync.constructor.name === 'AsyncFunction', "... where three's own is async (always a promise)");
}

// ---------------------------------------------------------------- 4. the live switch
{
  ok(renderer.drawingPipeline === standard, 'made, the trial leaves the standard pipeline on');
  ok(trial.setOn(true) === true && renderer.drawingPipeline === p && MESHLET.on === true, 'on: the trial is the drawing pipeline');
  ok(trial.setOn(false) === false && renderer.drawingPipeline === standard && MESHLET.on === false, 'off: the very standard pipeline back');
  ok(trial.setOcclusion(false) === false && p.occlusionCulling === false, "three's occlusion culling off");
  trial.setOcclusion(true);
  // The shadow cull rides on the trial's pipeline as `startMeshletTrial` installs it (the performance step's own install).
  const { installShadowCull } = await import('../../../src/core/gpu/shadowCull.ts');
  const r2: Any = { ...renderer };
  const t2 = makeTrial(mod, r2);
  r2.drawingPipeline = t2.pipeline;
  installShadowCull(r2);
  r2.drawingPipeline = t2.standard;
  ok(Object.prototype.hasOwnProperty.call(t2.pipeline, 'isCulled') && Object.prototype.hasOwnProperty.call(t2.pipeline, 'begin'), "the shadow cull wraps the trial's pipeline's own isCulled and begin");
  ok(!Object.prototype.hasOwnProperty.call(standard, 'isCulled'), '... and nothing of the standard one here');
}

// ---------------------------------------------------------------- 5. our parts on three's draw material
{
  putOn.length = 0;
  const src = std({ userData: { parts: ['lightHold', 'spec', 'detail', 'card'] } });
  const drawn: Any = mod.createDrawMaterial(src, renderer);
  ok(drawn.isNodeMaterial === true && drawn !== src, "three's draw material is a node material of its own");
  ok(drawn.roughness === src.roughness && (src.roughness = 0.31, drawn.roughness === 0.31), "... reading the source's fields live");
  const n = dress(drawn, src);
  ok(n === 2 && putOn.join() === 'lightHold,spec', `the carried parts go on in order, the refused never (${putOn.join()})`);
  const own = mod.MeshletBatch.prototype.createPulledMesh;
  makeTrial(mod, { ...renderer });
  ok(mod.MeshletBatch.prototype.createPulledMesh === own, "the batch's mesh maker is wrapped once a module, however many trials are made");
  ok(/dress\(mesh\.material, shared\.material\)/.test(read('src/core/gpu/meshletTrial.ts')) && /MESHLET\.dress && shared && shared\.shadow !== true && shared\.debug !== true/.test(read('src/core/gpu/meshletTrial.ts')), 'the wrap dresses only a lit draw (never a shadow or debug one), while the attribution switch says so');
  ok(MESHLET.dress === true, 'the parts go on by default');
}

// ---------------------------------------------------------------- 6. the default path
{
  const trialText = read('src/core/gpu/meshletTrial.ts');
  const startText = read('src/core/gpu/start.ts');
  const imports = [...trialText.matchAll(/import\(\s*'three\/examples\/jsm\/pipelines\/MeshletDrawingPipeline\.js'\s*\)/g)];
  ok(imports.length === 1, "three's addon is imported in one place");
  ok(!/^import [^\n]*MeshletDrawingPipeline/m.test(trialText) && !/MeshletDrawingPipeline/.test(startText.replace(/\/\/[^\n]*/g, '')), '... and never statically, here or in start.ts');
  const fn = trialText.slice(trialText.indexOf('export async function startMeshletTrial'));
  ok(fn.indexOf("import('three/examples") > 0 && fn.indexOf("import('three/examples") < fn.indexOf('\n}\n'), '... inside startMeshletTrial');
  // Parked: the import behind `import.meta.env.DEV`, which a build reads as false, so the built game carries none of it.
  const gate = fn.indexOf('if (!import.meta.env.DEV) {');
  ok(gate > 0 && gate < fn.indexOf("import('three/examples") && /MESHLET\.state = 'parked';[\s\S]*?return;\n  \}/.test(fn.slice(gate, fn.indexOf("import('three/examples"))), '... behind the dev server alone: a build makes no chunk of it');
  ok(/\n  if \(MESHLET\.asked\) void startMeshletTrial\(renderer, /.test(startText), 'start.ts makes the trial only where ?meshlet asked');
  ok((startText.match(/startMeshletTrial\(/g) ?? []).length === 1, '... and nowhere else');
  const bundlesText = read('src/core/gpu/bundles.ts');
  ok(!/meshlet/i.test(bundlesText), 'the tier bundles are untouched by the trial');
  ok(/has\('meshlet'\)/.test(trialText), 'the switch is the address\'s ?meshlet');
}

// ---------------------------------------------------------------- 7. the anchors
{
  const addon = readFileSync(fileURLToPath(new URL('../../../node_modules/three/examples/jsm/pipelines/MeshletDrawingPipeline.js', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  const cutMethod = (name: string, from = 0): string => {
    const at = addon.indexOf(`\n\t${name}(`, from);
    assert.ok(at >= 0, `no method ${name}`);
    const end = addon.indexOf('\n\t}\n', at);
    return addon.slice(at, end + 3);
  };
  const cutFunction = (name: string): string => {
    const at = addon.indexOf(`\nfunction ${name}(`);
    assert.ok(at >= 0, `no function ${name}`);
    const end = addon.indexOf('\n}\n', at);
    return addon.slice(at, end + 2);
  };
  const h = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
  const pipelineAt = addon.indexOf('\nclass MeshletDrawingPipeline extends StandardDrawingPipeline');
  const batchAt = addon.indexOf('\nclass MeshletBatch');
  const held: Record<string, string> = {
    // Overridden by the trial's pipeline.
    begin: h(cutMethod('begin', pipelineAt)),
    _isMeshlet: h(cutMethod('_isMeshlet', pipelineAt)),
    _isSupportedMaterial: h(cutMethod('_isSupportedMaterial', pipelineAt)),
    prepareAsync: h(cutMethod('async prepareAsync', pipelineAt).replace('async prepareAsync', 'prepareAsync')),
    // Called by the trial's prepare and census, with the state they force round each call.
    _getClusters: h(cutMethod('_getClusters', pipelineAt)),
    _hasClusters: h(cutMethod('_hasClusters', pipelineAt)),
    // Wrapped once a module.
    createPulledMesh: h(cutMethod('createPulledMesh', batchAt)),
    // The rules the census names in three's order.
    isSupportedObject: h(cutFunction('isSupportedObject')),
    isSupportedMaterial: h(cutFunction('isSupportedMaterial')),
    // The draw material our parts go on.
    createDrawMaterial: h(cutFunction('createDrawMaterial')),
  };
  const PINNED: Record<string, string> = {
    begin: '9fa61dedbaabcc7d',
    _isMeshlet: 'befd050a17d1dd19',
    _isSupportedMaterial: '56c5c529b96d5a0e',
    prepareAsync: 'abe896355b2896a4',
    _getClusters: '208ca98ebd5876aa',
    _hasClusters: 'b0fee5b35302d719',
    createPulledMesh: '9346fb9b1710576a',
    isSupportedObject: 'ee8f595603b2d6ab',
    isSupportedMaterial: '4d194dfff2fd61a8',
    createDrawMaterial: 'a01471358e064c7f',
  };
  if (process.argv.includes('--print')) console.log(JSON.stringify(held));
  for (const k of Object.keys(held)) ok(held[k] === PINNED[k], `three's ${k} is the text the trial was written against at 188dev (${held[k]})`);
  ok(/const UNSUPPORTED_NODES = \[\n\t'vertexNode', 'geometryNode', 'depthNode', 'fragmentNode', 'outputNode',\n\t'contextNode', 'backdropNode', 'backdropAlphaNode', 'alphaTestNode', 'castShadowNode', 'maskShadowNode'\n\];/.test(addon), "three's list of a node material's own nodes is the census's");
  // Three's compileAsync awaits the drawing pipeline's prepare only when it answers something (so `undefined` keeps the
  // listing synchronous), and a precompile is marked by `_precompilationState` (null between them).
  const build = readFileSync(fileURLToPath(new URL('../../../node_modules/three/build/three.webgpu.js', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  ok(/const prepare = this\.drawingPipeline\.prepareAsync\( scene, camera \);\n\n\t\tif \( prepare !== undefined \) await prepare;/.test(build), "three's compileAsync awaits a prepare only when there is one");
  ok(/this\._precompilationState = null;/.test(build) && /this\._precompilationState = precompilationState;/.test(build), "three marks a precompile by _precompilationState");
  ok(/\t\tthis\.static = true;/.test(build.slice(build.indexOf('class BundleGroup'), build.indexOf('class BundleGroup') + 2000)), "a BundleGroup is static by default (the tiers' bundles are captured whole)");
  // The two stamps `placedOf` reads.
  const stream = read('src/world/layoutStream.ts');
  ok(/function stampCaster\(mesh: THREE\.Object3D, radius: number, flora: boolean, level: number\): void \{\n  mesh\.userData\.casterRadius = radius;/.test(stream), 'the streamer stamps casterRadius on what it places');
  ok((stream.match(/stampCaster\(mesh, /g) ?? []).length >= 4, "... on a tier's copies, its level groups, a row and the editor's ghost");
  ok(/export const INTERIOR_LAYER = 1;/.test(read('src/world/portalRender.ts')), "the rooms' layer is 1");
  const interior = stream.slice(stream.indexOf('private buildInterior('), stream.indexOf('private releaseInterior('));
  ok(/mesh\.matrixAutoUpdate = false;/.test(interior) && /mesh\.layers\.set\(INTERIOR_LAYER\);/.test(interior), "a building's room is a plain mesh on the rooms' layer alone, its matrix written by hand");
}

console.log(`meshletTrial: ${checks} checks passed`);
