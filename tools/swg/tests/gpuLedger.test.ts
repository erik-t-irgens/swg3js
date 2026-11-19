// The GPU port's pass 1, wave 1 (`A:\swg3js\port\PASS1-W1.md`, items 1, 2, 4 and 5): the pipeline ledger, the key census,
// the landing log and the card's named sections, each over stand-ins of three's own pieces, and each costing nothing when
// it is not asked.
//
//  1. the ledger (`pipeLedger.ts`): its wrap of `createRenderPipeline` records a draw's pipeline landed as it is asked and
//     one asked ahead landed when three's promise answers; who asked (the warm-up, a loading screen, the world's queue, a
//     draw, a self-test, three's own compileAsync) and the pass (world, rooms, shadow, chain, another scene); the parts of
//     three's key read off real three objects (bones, morph targets, instancing, a texture's sampler); the ring bounded;
//  2. the arrivals and the landing log: an arrival begins when the travel's flag goes up, its screen goes when it comes
//     down, and at 30 s the warm-up's queue is read by name; what was pending then is said by name;
//  3. the census (`keyCensus.ts`): three's own draw-state key (`WebGPUBackend.getRenderCacheKey`, imported from the build
//     the game loads) taken apart by the census's groups, so a pair apart in its side, blending, polygon offset or sample count
//     is named so; programs apart in bones, a morph attribute, a sampler or the node graph named so; the projection
//     merging what the pool and the bake would; the held pipelines read off a stand-in renderer;
//  4. the card's clock (`gpuTimer.ts`, over three's `GPUTimer` from pass 1's wave 2, driven through the build's own backend
//     timers and WebGPU pool over a stand-in card) and the named sections (`framePerf.ts`):
//     nothing touched until asked, everything put back after, three's own `initTimestampQuery` writing nothing into a pass
//     with no timer active, each pass timed alone and answered by its uid; each pass named by
//     its cascade camera, a lamp's shadow, the chain's graph or the frame report's pass kind, and summed by whole frame;
//  5. what a frame costs with all of it installed and not asked: the ledger's frame call, between arrivals and inside one,
//     measured in twelve fresh processes at once (`--alloc`), nothing allocated.
//
// Run: node tools/swg/tests/gpuLedger.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
// Three's classes out of the build the game loads (`three/webgpu` is `build/three.webgpu.js`), never out of its src/: at
// three's development commit 577fb27 the two differ where this suite reaches (the build's `Backend.endTimer` answers a bare
// number of milliseconds, the src/'s a record), and a suite driven through the src/ passed while the game's clock answered
// nothing (pass 1, wave 2's fixer).
import * as WEBGPU from 'three/webgpu';
import { ARRIVALS_CAP, installLedger, keyFieldsOf, landingReport, LEDGER, LEDGER_CAP, LANDING_TUNE, ledgerFrame, ledgerRecords, passOf, recordPipeline, WHERE } from '../../../src/core/gpu/pipeLedger.ts';
import { censusOf, DRAW_STATE_GROUPS, heldPipes, nearestSiblings, parsePipelineKey, propsDiffer, separate, signature, type Pipe } from '../../../src/core/gpu/keyCensus.ts';
import { frameOfUid, passTimer, timerMs } from '../../../src/core/gpu/gpuTimer.ts';
import { sectionOfPass, sectionSums } from '../../../src/core/gpu/framePerf.ts';
import { PASS } from '../../../src/core/perf.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
/** The build's WebGPU backend (its draw-state key, its timestamp queries and its pool) and the backend base under it. */
const WebGPUBackend = (WEBGPU as Any).WebGPUBackend as Any;
const Backend = (WEBGPU as Any).Backend as Any;
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};

/** The clock the ledger reads, stood in for. */
let clock = 1000;
const realNow = performance.now.bind(performance);
const standClock = (): void => {
  Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => clock });
};
const realClock = (): void => {
  Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: realNow });
};

/** A fresh ledger, as at a page's start. */
const resetLedger = (): void => {
  LEDGER.ring.fill(null);
  LEDGER.head = 0;
  LEDGER.made = 0;
  LEDGER.byKey.clear();
  LEDGER.arrivals.fill(null);
  LEDGER.arrivalsMade = 0;
  LEDGER.current = null;
  LEDGER.traveling = false;
  LEDGER.loading = true;
  LEDGER.fieldErrors = 0;
  LEDGER.recordMs = 0;
};

// ---------------------------------------------------------------- 5 (child). what a frame allocates, in a process of its own
if (process.argv.includes('--alloc')) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as Any).gc as (o?: unknown) => void;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  const window_ = async (step: () => void, n: number): Promise<number> => {
    for (let tries = 0; tries < 6; tries++) {
      for (let i = 0; i < 4000; i++) step();
      gc({ type: 'minor' });
      await turn();
      await turn();
      const c0 = collections;
      const b = young();
      for (let i = 0; i < n; i++) step();
      const a = young();
      await turn();
      await turn();
      if (collections === c0) return (a - b) / n;
    }
    return NaN;
  };
  resetLedger();
  installLedger({ backend: { createRenderPipeline() {} } }, { queued: () => 3, inFlight: () => 1, queuedNames: () => 0 }, { native: () => false, world: () => null });
  const out: Record<string, number> = {};
  // Between arrivals: the steady frame of play.
  out.idle = await window_(() => ledgerFrame(false, false), 20000);
  // Behind a loading screen, its thirtieth second not reached (the clock read, nothing made).
  ledgerFrame(true, true);
  out.screenUp = await window_(() => ledgerFrame(true, true), 20000);
  // The screen gone, its thirtieth second not reached.
  out.screenGone = await window_(() => ledgerFrame(false, false), 20000);
  console.log(JSON.stringify(out));
  process.exit(0);
}

// ---------------------------------------------------------------- 1. the ledger
{
  resetLedger();
  standClock();
  // A stand-in backend whose pipelines three's way: a draw's made at once, one asked ahead pushed as a promise.
  let resolveAsync: (() => void) | null = null;
  const made: string[] = [];
  const be: Any = {
    createRenderPipeline(ro: Any, promises: Any) {
      made.push(ro.pipeline.cacheKey);
      if (promises) promises.push(new Promise<void>((r) => (resolveAsync = r)));
    },
  };
  const world = new THREE.Scene();
  let native = false;
  ok(installLedger({ backend: be }, { queued: () => 0, inFlight: () => 0, queuedNames: () => 0 }, { native: () => native, world: () => world }), 'the ledger installs on a backend that makes pipelines');
  ok(LEDGER.installed, 'and says it is installed');
  const mat = new THREE.MeshStandardMaterial({ name: 'body' });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'a body';
  const ro = (key: string, o: Any = {}): Any => ({ pipeline: { cacheKey: key }, object: o.object ?? mesh, material: o.material ?? mat, geometry: (o.object ?? mesh).geometry, scene: o.scene ?? world, context: {}, lightsNode: { getCacheKey: () => 7 }, getDynamicCacheKey: () => 11, clippingContextCacheKey: '', _nodes: { getCustomProgramCacheKey: () => 'graph-a' } });
  // A draw behind the select screen (no arrival): made at once, landed as it was asked.
  LEDGER.loading = true;
  LEDGER.traveling = false;
  clock = 1000;
  be.createRenderPipeline(ro('1,2,draw'), null);
  let r = LEDGER.byKey.get('1,2,draw')!;
  ok(r && r.where === WHERE.indexOf('a draw') && r.landedAt === 1000 && r.askedAt === 1000, `a draw's pipeline lands as it is asked (${JSON.stringify(r && { where: r.where, a: r.askedAt, l: r.landedAt })})`);
  ok(made.includes('1,2,draw'), "and three's own call still made it");
  ok(r.pass === 'world' && r.matName === 'body' && r.objName === 'a body' && r.matType === 'MeshStandardMaterial', `its pass is the world's, its material and first object named (${r.pass}, ${r.matName}, ${r.objName})`);
  // One asked ahead behind the select screen: the warm-up's; pending until three's promise answers.
  clock = 1100;
  const promises: Promise<unknown>[] = [];
  be.createRenderPipeline(ro('3,4,ahead'), promises);
  r = LEDGER.byKey.get('3,4,ahead')!;
  ok(r.where === WHERE.indexOf('warm-up') && r.landedAt === -1, "one asked ahead before any arrival is the warm-up's, pending");
  clock = 1350;
  resolveAsync!();
  await Promise.all(promises);
  await new Promise((q) => setImmediate(q));
  ok(r.landedAt === 1350, `and lands when three's promise answers (${r.landedAt})`);
  // Behind an arrival's screen: a loading screen's; in play: the world's queue; the warm patch off: three's compileAsync.
  LEDGER.traveling = true;
  be.createRenderPipeline(ro('5,6,screen'), []);
  ok(LEDGER.byKey.get('5,6,screen')!.where === WHERE.indexOf('loading screen'), "one asked ahead behind an arrival's screen is the loading screen's");
  LEDGER.traveling = false;
  LEDGER.loading = false;
  be.createRenderPipeline(ro('7,8,queue'), []);
  ok(LEDGER.byKey.get('7,8,queue')!.where === WHERE.indexOf("the world's queue"), "one asked ahead in play is the world's queue's");
  native = true;
  be.createRenderPipeline(ro('9,10,native'), []);
  ok(LEDGER.byKey.get('9,10,native')!.where === WHERE.indexOf("three's compileAsync"), "with the warm patch off it is three's own compileAsync's");
  native = false;
  const selfTest = new THREE.Mesh(geo, mat);
  selfTest.userData.swgSelfTest = true;
  be.createRenderPipeline(ro('11,12,self', { object: selfTest }), null);
  ok(LEDGER.byKey.get('11,12,self')!.where === WHERE.indexOf('self-test') && LEDGER.byKey.get('11,12,self')!.pass === 'self-test', "a console self-test's is its own");
  // The passes.
  const rooms = new THREE.Scene();
  rooms.name = 'the rooms passes';
  const shadowMat: Any = new THREE.MeshBasicMaterial();
  shadowMat.isShadowPassMaterial = true;
  const chainMesh = new THREE.Mesh(geo, mat);
  chainMesh.userData.gpuChain = true;
  const weather = new THREE.Scene();
  weather.name = 'weather';
  ok(passOf(ro('x', { scene: rooms }), world) === 'rooms', "a room's pass by the rooms' scene");
  ok(passOf(ro('x', { material: shadowMat }), world) === 'shadow', "a shadow by three's shadow material");
  ok(passOf(ro('x', { object: chainMesh }), world) === 'chain', "the effects chain's by its mark");
  ok(passOf(ro('x', { scene: weather }), world) === 'scene "weather"', 'another scene by its name');
  ok(/^scene #\d+$/.test(passOf(ro('x', { scene: new THREE.Scene() }), world)), 'and an unnamed one by its id');
  // The parts of three's key, off real three objects.
  const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  bones[0].add(bones[1]);
  bones[1].add(bones[2]);
  const skinGeo = new THREE.BoxGeometry(1, 1, 1);
  skinGeo.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(skinGeo.attributes.position.count * 3), 3), new THREE.Float32BufferAttribute(new Float32Array(skinGeo.attributes.position.count * 3), 3)];
  const skinned = new THREE.SkinnedMesh(skinGeo, mat);
  skinned.bind(new THREE.Skeleton(bones));
  skinned.receiveShadow = true;
  const f = keyFieldsOf(ro('x', { object: skinned }));
  ok(f.bones === 3 && f.morph.startsWith('2#') && f.recv === true, `a skinned body's bones, morph targets and shadows (${f.bones}, ${f.morph}, ${f.recv})`);
  ok(f.attrs.includes('position3') && f.attrs.includes('uv2') && f.lights === 7 && f.env === 11 && f.inst === '', `its attributes, light set and environment (${f.attrs})`);
  const other = skinGeo.clone();
  other.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(skinGeo.attributes.position.count * 3), 3), new THREE.Float32BufferAttribute(new Float32Array(skinGeo.attributes.position.count * 3), 3)];
  ok(keyFieldsOf(ro('x', { object: new THREE.SkinnedMesh(other, mat) })).morph !== f.morph, "another geometry's morph attributes key otherwise (three keys each attribute's id)");
  ok(keyFieldsOf(ro('x', { object: new THREE.InstancedMesh(geo, mat, 4) })).inst === 'I', 'an instanced mesh says so');
  const tex = new THREE.Texture();
  const mapped = new THREE.MeshStandardMaterial({ map: tex });
  const nearest = new THREE.MeshStandardMaterial({ map: tex.clone() });
  nearest.map!.magFilter = THREE.NearestFilter;
  const pa = keyFieldsOf(ro('x', { material: mapped })).props;
  const pb = keyFieldsOf(ro('x', { material: nearest })).props;
  ok(pa !== pb && propsDiffer(pa, pb).some((p) => p.startsWith('sampler state (map')), `a texture's sampler state is in the material's key on WebGPU (${propsDiffer(pa, pb).join(', ')})`);
  ok(!/side=|blending=|polygonOffset=/.test(pa), "the draw state's own properties are read from three's pipeline key, not the material's");
  const sm: Any = new THREE.ShaderMaterial({ vertexShader: 'void main() { a = b; c = d; }' });
  ok(!/void main/.test(keyFieldsOf(ro('x', { material: sm })).props), 'a shader text is kept as its hash (the key is read back split on ; and =)');
  // The ring is bounded: the oldest record goes, and its key with it.
  for (let i = 0; i < LEDGER_CAP; i++) recordPipeline(ro(`r${i}`), null, clock, false, false, false, world);
  ok(ledgerRecords().length === LEDGER_CAP && !LEDGER.byKey.has('1,2,draw') && LEDGER.byKey.has(`r${LEDGER_CAP - 1}`), `the ring holds ${LEDGER_CAP} records and lets the oldest go`);
  ok(LEDGER.byKey.size <= LEDGER_CAP, 'and the key index never outgrows it');
  realClock();
}

// ---------------------------------------------------------------- 2. the arrivals and the landing log
{
  resetLedger();
  standClock();
  LANDING_TUNE.pendingAtMs = 20;
  const names = ['person r0 front opaque', 'person r7 back cut', 'ground'];
  let queued = 3;
  let calls = 0;
  // Three's way: a pipeline asked ahead pushes its promise (this one never answers).
  const be: Any = {
    createRenderPipeline(_ro: Any, promises: Any) {
      if (promises) promises.push(new Promise(() => {}));
    },
  };
  installLedger({ backend: be }, { queued: () => queued, inFlight: () => 2, queuedNames: (out) => { calls++; let k = 0; for (const n of names) if (k < out.length) out[k++] = n; return k; } }, { native: () => false, world: () => null });
  const mat = new THREE.MeshBasicMaterial({ name: 'm' });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  mesh.name = 'o';
  const ro = (key: string): Any => ({ pipeline: { cacheKey: key }, object: mesh, material: mat, geometry: mesh.geometry, scene: null, context: {} });
  clock = 5000;
  ledgerFrame(true, false);
  ok(LEDGER.arrivalsMade === 0 && LEDGER.current === null, 'the select screen is no arrival');
  clock = 6000;
  ledgerFrame(true, true);
  ok(LEDGER.arrivalsMade === 1 && LEDGER.current?.at === 6000, 'an arrival begins when the travel flag goes up');
  // Behind the screen: one landed at once, one asked ahead and still out at 30 s.
  clock = 7000;
  be.createRenderPipeline(ro('a'), null);
  const p: Promise<unknown>[] = [];
  clock = 8000;
  be.createRenderPipeline(ro('b'), p);
  ok(LEDGER.byKey.get('b')!.arrival === 0 && LEDGER.byKey.get('b')!.where === WHERE.indexOf('loading screen'), 'what is asked behind its screen is that arrival\'s, the loading screen\'s');
  clock = 20000;
  ledgerFrame(false, false);
  ok(LEDGER.current?.goneAt === 20000, 'its screen goes when the flag comes down');
  for (let i = 0; i < 50; i++) ledgerFrame(false, false);
  ok(LEDGER.current!.queuedAt30 === -1 && calls === 0, 'no frame reads the queue');
  // Its thirtieth second, on the arrival's own timer (moved to a few milliseconds here).
  clock = 6000 + LANDING_TUNE.pendingAtMs;
  await new Promise((q) => setTimeout(q, LANDING_TUNE.pendingAtMs + 30));
  const a = LEDGER.arrivals[0]!;
  ok(a.queuedAt30 === 3 && a.inFlightAt30 === 2 && calls === 1 && a.queuedNames.join('|') === names.join('|') && a.lookedAt === clock, `at its thirtieth second the warm-up's queue is read, by name (${JSON.stringify(a)})`);
  clock = 50000;
  ledgerFrame(false, false);
  await new Promise((q) => setTimeout(q, LANDING_TUNE.pendingAtMs + 30));
  ok(calls === 1, 'the queue is read once an arrival');
  LANDING_TUNE.pendingAtMs = 30000;
  const rep = landingReport({ all: true }) as Any;
  const arr = rep.arrivals[0];
  ok(arr.screenSecs === 14 && arr.pipelines.asked === 2 && arr.pipelines.askedBehindScreen === 2 && arr.pipelines.landedBehindScreen === 1, `the log counts what was asked and landed behind the screen (${JSON.stringify(arr.pipelines)})`);
  ok(arr.at30s.pipelinesPending === 1 && /^m#\d+ on o#\d+ \[scene #\?, loading screen\] asked at 2 s, still pending$/.test(arr.at30s.pendingByName[0]), `and what was pending at 30 s by name (${arr.at30s.pendingByName[0]})`);
  ok(arr.at30s.warmUpItemsQueued === 3 && arr.at30s.queuedByName.length === 3, "with the warm-up's queue then");
  ok(rep.pendingNow === 1 && rep.byWhere['a draw'].asked === 1 && rep.byWhere['loading screen'].pending === 1 && rep.pipelines.length === 2, 'the log says what is pending now and who asked');
  ok(rep.pipelines[1].landedS === 'pending' && rep.pipelines[0].waitMs === 0, "each row says when it landed, or that it has not");
  // Arrivals are bounded too.
  for (let i = 0; i < ARRIVALS_CAP + 3; i++) {
    clock += 100;
    ledgerFrame(true, true);
    clock += 100;
    ledgerFrame(false, false);
  }
  ok(LEDGER.arrivals.filter(Boolean).length === ARRIVALS_CAP && (landingReport() as Any).arrivals.length === ARRIVALS_CAP, `the arrivals kept are ${ARRIVALS_CAP}`);
  realClock();
}

// ---------------------------------------------------------------- 3. the census
{
  // Three's own draw-state key, made by its own function over stand-in utilities.
  const be: Any = Object.create(WebGPUBackend.prototype);
  be.utils = {
    getSampleCountRenderContext: (c: Any) => c.samples ?? 4,
    getCurrentColorSpace: () => 'srgb',
    // Every output's format (three's development commit 577fb27, pass 1's wave 2; one before it).
    getCurrentColorFormats: (c: Any) => c.formats ?? ['rgba16float'],
    getCurrentDepthStencilFormat: () => 'depth24plus-stencil8',
    getPrimitiveTopology: () => 'triangle-list',
    getStripIndexFormat: () => undefined,
  };
  be.attributeUtils = { getVertexBufferLayoutCacheKey: (ro: Any) => ro.layout ?? '12,vertex,0,0,float32x3,' };
  const keyOf = (v: number, f: number, m: Any, ctx: Any = {}, layout?: string): string => `${v},${f},${be.getRenderCacheKey({ object: new THREE.Mesh(), material: m, geometry: new THREE.BufferGeometry(), context: ctx, clippingContextCacheKey: 'clip', layout })}`;
  const base = new THREE.MeshStandardMaterial();
  const p0 = parsePipelineKey(keyOf(1, 2, base));
  ok(p0.v === '1' && p0.f === '2' && p0.state.clipping === 'clip' && p0.state['vertex layout'] === '12,vertex,0,0,float32x3,', `three's key taken apart: programs, the vertex layout and the clipping (${JSON.stringify(p0.state)})`);
  ok(DRAW_STATE_GROUPS.length === 7 && p0.state.side === '0' && p0.state['sample count'] === '4' && p0.state['output formats'] === 'srgb,rgba16float,depth24plus-stencil8' && p0.state.topology === 'triangle-list,', "each group reads its own items of three's key");
  // Two outputs: their formats joined into the key shift every item after them, which the census finds from the topology.
  const p2 = parsePipelineKey(keyOf(1, 2, base, { formats: ['rgba16float', 'rgba8unorm'] }));
  ok(p2.state['output formats'] === 'srgb,rgba16float,rgba8unorm,depth24plus-stencil8' && p2.state.topology === 'triangle-list,' && p2.state['vertex layout'] === '12,vertex,0,0,float32x3,' && p2.state.clipping === 'clip' && p2.state.side === '0', `two outputs' formats read as one group, the items after them where they are (${JSON.stringify(p2.state)})`);
  const rec = (key: string, fields: Partial<Record<string, unknown>> = {}, matType = 'MeshStandardMaterial', pass = 'world'): Pipe => ({
    key,
    parsed: parsePipelineKey(key),
    rec: { key, seq: 1, askedAt: 0, landedAt: 0, where: 1, pass, matType, matName: '', matId: 1, objType: 'Mesh', objName: '', objId: 1, arrival: 0, fields: { bones: 0, morph: '', attrs: 'position3,', inst: '', recv: false, lights: 1, env: 1, outputs: '|', clip: '', custom: 5, props: 'map={300}1006100310011001;', scene: 1, ...fields } as Any },
  });
  const named = (a: Pipe, b: Pipe): string => separate(a, b).fields.join('+');
  const sideB = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  ok(named(rec(keyOf(1, 2, base)), rec(keyOf(1, 2, sideB))) === 'side', 'a pair apart in the side alone is named by it');
  const blend = new THREE.MeshStandardMaterial({ transparent: true, blending: THREE.AdditiveBlending });
  ok(named(rec(keyOf(1, 2, base)), rec(keyOf(1, 2, blend))) === 'blending', 'and in the blending');
  const offset = new THREE.MeshStandardMaterial({ polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  ok(named(rec(keyOf(1, 2, base)), rec(keyOf(1, 2, offset))) === 'polygon offset', 'and in the polygon offset');
  ok(named(rec(keyOf(1, 2, base)), rec(keyOf(1, 2, base, { samples: 1 }))) === 'sample count', 'and in the sample count');
  ok(named(rec(keyOf(1, 2, base)), rec(keyOf(1, 2, base, { formats: ['bgra8unorm'] }))) === 'output formats', 'and in the outputs\' formats');
  ok(named(rec(keyOf(1, 2, base)), rec(keyOf(1, 2, base, { formats: ['rgba16float', 'rgba8unorm'] }))) === 'output formats', 'and in the outputs\' count');
  ok(named(rec(keyOf(1, 2, base)), rec(keyOf(1, 2, base, {}, '16,vertex,0,0,float32x4,'))) === 'vertex layout', 'and in the vertex layout');
  const k1 = keyOf(1, 2, base);
  const k2 = keyOf(3, 4, base);
  ok(named(rec(k1, { bones: 53 }), rec(k2, { bones: 50 })) === 'bone count', 'programs apart in the bone count');
  ok(named(rec(k1, { morph: '7#a' }), rec(k2, { morph: '7#b' })) === 'morph attribute', 'in a morph attribute');
  ok(named(rec(k1, { custom: 5 }), rec(k2, { custom: 6 })) === 'node graph', "in the material's node graph");
  ok(named(rec(k1, { props: 'map={300}1006100310011001;' }), rec(k2, { props: 'map={300}1003100310011001;' })) === 'sampler state', 'in a sampler state');
  ok(named(rec(k1, { props: 'alphaTest=0;' }), rec(k2, { props: 'alphaTest=1;' })) === 'property alphaTest', 'in a property');
  ok(named(rec(k1), rec(k2)) === 'program text', "programs apart in nothing the key's parts show say so");
  ok(named(rec(keyOf(1, 2, base)), rec(keyOf(1, 3, sideB))) === 'side', "a two-sided pair's programs follow its side");
  ok(separate(rec(k1), { key: k2, parsed: parsePipelineKey(k2), rec: null }).fields.includes('program (unrecorded)'), 'an unrecorded pipeline says so');
  // Nearest siblings and the census over a set like an arrival's: bodies apart in bones and morphs, a two-sided pair.
  const pipes: Pipe[] = [
    rec(keyOf(10, 11, base), { bones: 53, morph: '7#a' }),
    rec(keyOf(12, 13, base), { bones: 53, morph: '7#b' }),
    rec(keyOf(14, 15, base), { bones: 53, morph: '7#c' }),
    rec(keyOf(16, 17, base), { bones: 50, morph: '7#a' }),
    rec(keyOf(18, 19, base), { bones: 50 }),
    rec(keyOf(20, 21, base), { bones: 53 }),
    rec(keyOf(1, 2, base)),
    rec(keyOf(1, 2, sideB)),
  ];
  const sib = nearestSiblings(pipes);
  ok(sib.length === pipes.length && sib[1].fields.join() === 'morph attribute' && sib[7].fields.join() === 'side', `each pipeline's nearest sibling and the field apart (${sib.map((s) => s.fields.join('+')).join('; ')})`);
  const c = censusOf(pipes, 1, { list: true }) as Any;
  ok(c.pipelines === 8 && c.computePipelines === 1 && c.recorded === 8 && c.list.length === 8, 'the census counts what it is handed');
  ok(c.separatedBy['morph attribute'] >= 3 && c.separatedBy.side >= 1 &&c.bodies.skinnedByBoneCount['53'] === 4 && c.bodies.morphed === 4 && c.bodies.morphKeys === 3, `and groups them by the field apart (${JSON.stringify(c.separatedBy)})`);
  ok(c.projection.signatures === 8, 'every pipeline its own signature');
  ok(signature(pipes[4], { bones: true }) === signature(pipes[5], { bones: true }) && signature(pipes[4], {}) !== signature(pipes[5], {}), 'the pool merges bodies apart in their bone count alone');
  // Pooled: 53/a and 50/a are one, 53/- and 50/- are one (two merge); baked: the 53s are one and the 50s one (four merge);
  // both: every body is one (five merge), the two plain meshes stay apart in their side.
  ok(c.projection.boneCountOut.merges === 2 && c.projection.morphsBaked.merges === 4 && c.projection.both.merges === 5 && c.projection.both.leaves === 3, `and the bake those apart in their morphs (${JSON.stringify(c.projection)})`);
  // The held pipelines off a stand-in renderer: render pipelines with their programs, compute ones counted apart.
  const caches = new Map<string, Any>([
    [keyOf(1, 2, base), { vertexProgram: {}, fragmentProgram: {} }],
    [keyOf(1, 2, sideB), { vertexProgram: {}, fragmentProgram: {} }],
    ['c,7', { computeProgram: {} }],
  ]);
  const held = heldPipes({ _pipelines: { caches } });
  ok(held.pipes.length === 2 && held.compute === 1, 'the census reads the pipelines three holds, compute ones apart');
  ok(heldPipes({}).pipes.length === 0, 'and a renderer with none reads none');
}

// ---------------------------------------------------------------- 4. the card's clock and the named sections
{
  // Pass 1, wave 2: the clock is three's own `GPUTimer` (three's development commit 577fb27), driven here through the build the
  // game loads: its backend timers (`Backend.beginTimer` / `endTimer`), its WebGPU pool (made by
  // `WebGPUBackend.createTimestampQueryPool`, given each pass's queries by `initTimestampQuery`, read back by
  // `resolveTimestamps` as three's animation loop does once a frame) and its `GPUTimer`, over a stand-in card: a device whose
  // query sets hold each pass's length and whose read-back answers when the test says. (Wave 2's fixer: the suite first drove
  // three's src/ classes, whose `endTimer` answers `{ start, end, delta }`; the build's answers a bare number, and the clock
  // read nothing from it while every check here passed.)
  const g = globalThis as Any;
  const hadUsage = 'GPUBufferUsage' in g;
  const hadMap = 'GPUMapMode' in g;
  // The browser's WebGPU flag tables, which three's pool reads as it makes its buffers; node has none.
  if (!hadUsage) g.GPUBufferUsage = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, QUERY_RESOLVE: 512 };
  if (!hadMap) g.GPUMapMode = { READ: 1, WRITE: 2 };
  /** Each pass's length in milliseconds, handed to the passes as they begin. */
  let lengths: number[] = [];
  /** The read-backs asked of the card and not yet answered. */
  let asked: (() => void)[] = [];
  const card: Any = {
    features: new Set(['timestamp-query']),
    queue: { submit: () => {} },
    createQuerySet: (q: Any) => ({ count: q.count, ms: new Map<number, number>() }),
    createBuffer: (b: Any) => {
      const data = new ArrayBuffer(b.size);
      const buffer: Any = {
        data,
        mapState: 'unmapped',
        mapAsync: () =>
          new Promise<void>((res) =>
            asked.push(() => {
              buffer.mapState = 'mapped';
              res();
            }),
          ),
        getMappedRange: (at = 0, size?: number) => data.slice(at, size === undefined ? undefined : at + size),
        unmap: () => {
          buffer.mapState = 'unmapped';
        },
      };
      return buffer;
    },
    createCommandEncoder: () => ({
      // The card ran the set's passes one after another, each as long as it was handed, a microsecond apart.
      resolveQuerySet(set: Any, first: number, count: number, into: Any, at: number) {
        const times = new BigUint64Array(into.data, at, count);
        let t = 1_000_000n;
        for (let i = first; i + 1 < first + count; i += 2) {
          const end = t + BigInt(Math.round((set.ms.get(i) ?? 0) * 1e6));
          times[i - first] = t;
          times[i - first + 1] = end;
          t = end + 1000n;
        }
      },
      copyBufferToBuffer(from: Any, fromAt: number, into: Any, intoAt: number, size: number) {
        new Uint8Array(into.data, intoAt, size).set(new Uint8Array(from.data, fromAt, size));
      },
      finish: () => ({}),
    }),
  };
  /** The card answers every read-back asked of it so far. */
  const answer = (): void => {
    const now = asked;
    asked = [];
    for (const f of now) f();
  };
  // Three's own: with no timer active a pass gets no timestamp writes, with or without a pool.
  const d: Any = {};
  WebGPUBackend.prototype.initTimestampQuery.call({ timestampQueryPool: null }, {}, d);
  ok(d.timestampWrites === undefined, 'three writes nothing into a pass while no pool has been made');
  const noTimers = WebGPUBackend.prototype.createTimestampQueryPool.call({ device: card });
  const d2: Any = {};
  WebGPUBackend.prototype.initTimestampQuery.call({ timestampQueryPool: noTimers }, {}, d2);
  ok(d2.timestampWrites === undefined && noTimers.currentQueryIndex === 0, 'nor while no timer is active');
  // The build's backend, its pass begun by a stand-in that does what three's `beginRender` does about timing alone.
  const proto: Any = Object.create(WebGPUBackend.prototype);
  proto.beginRender = function (this: Any, ctx: Any) {
    const descriptor: Any = {};
    this.initTimestampQuery(ctx, descriptor);
    const w = descriptor.timestampWrites;
    if (w !== undefined) w.querySet.ms.set(w.beginningOfPassWriteIndex, lengths.shift() ?? 0);
  };
  const be: Any = Object.create(proto);
  be.data = new WeakMap();
  be.device = card;
  be.timestampQueryPool = null;
  be.getTimestampUID = (c: Any) => `r:${c.call}:${c.id}:f${c.frame}`;
  const renderer: Any = { backend: be, _initialized: true };
  const t = passTimer(renderer, 'nvidia');
  ok(t.able && t.coarse === null && !t.on && be.timestampQueryPool === null && !Object.prototype.hasOwnProperty.call(be, 'beginRender'), 'made, the clock changes nothing: no pool, no wrap');
  const noFeature: Any = Object.create(WebGPUBackend.prototype);
  noFeature.device = { features: new Set<string>() };
  ok(passTimer(renderer, 'apple').coarse !== null && !passTimer({ backend: noFeature }, 'nvidia').able, "Apple's adapter is said coarse; a device without timestamp queries cannot time (three's own `hasTimestamp`)");
  t.start();
  ok(t.on && Object.prototype.hasOwnProperty.call(be, 'beginRender') && be.timestampQueryPool === null, 'started, each pass will be timed (the pool is made at the first timer, by three)');
  lengths = [0.25, 1.5, 0.75];
  be.beginRender({ call: 0, id: 1, frame: 9 });
  be.beginRender({ call: 1, id: 2, frame: 9 });
  be.beginRender({ call: 0, id: 1, frame: 10 });
  const pool = be.timestampQueryPool;
  ok(pool !== null && pool.currentQueryIndex === 6 && [...pool.queryTimers.values()].every((timers: Any[]) => timers.length === 1) && new Set([...pool.queryTimers.values()].map((timers: Any[]) => timers[0])).size === 3 && pool.timers.size === 0, "each pass is timed alone: three's pool gave it a pair of queries carrying its own timer, ended as soon as the pass had begun");
  const pending = t.resolve(1000);
  be.resolveTimestamps();
  answer();
  const ts = await pending;
  ok(ts instanceof Map && [...ts.keys()].join() === 'r:0:1:f9,r:1:2:f9,r:0:1:f10' && ts.get('r:0:1:f9') === 0.25 && ts.get('r:1:2:f9') === 1.5 && ts.get('r:0:1:f10') === 0.75, `a read-back answers each pass timed since the last, by its uid, in the order begun, out of the build's own answers (${JSON.stringify([...(ts ?? new Map())])})`);
  ok(timerMs(1.5) === 1.5 && timerMs(0) === 0 && timerMs({ delta: 0.5 }) === 0.5 && Number.isNaN(timerMs(null)), "and the clock reads either shape three answers: the build's bare milliseconds and the src/'s record (the release's, likely)");
  lengths = [2];
  be.beginRender({ call: 2, id: 3, frame: 11 });
  ok((await t.resolve(30)) === null, 'and one whose passes the card has not answered in time answers null');
  be.resolveTimestamps();
  answer();
  await pool.pendingResolve;
  t.stop();
  ok(!t.on && !Object.prototype.hasOwnProperty.call(be, 'beginRender') && be.beginRender === proto.beginRender, "stopped, three's own beginRender is back");
  be.beginRender({ call: 3, id: 3, frame: 12 });
  ok(pool.currentQueryIndex === 0 && pool.timers.size === 0, 'and a pass begun after it is given no queries');
  const seen: string[] = [];
  const unwatch = t.watchPasses((uid) => seen.push(uid));
  be.beginRender({ call: 3, id: 7, frame: 12 });
  ok(seen.join() === 'r:3:7:f12' && pool.currentQueryIndex === 0, 'watched, each pass is handed over with its uid as it begins, and not timed');
  unwatch();
  ok(!Object.prototype.hasOwnProperty.call(be, 'beginRender') && be.beginRender === proto.beginRender, "unwatched, three's own beginRender is back");
  if (!hadUsage) delete g.GPUBufferUsage;
  if (!hadMap) delete g.GPUMapMode;
  ok(frameOfUid('r:4:2:f117') === '117' && frameOfUid('c:1:3') === null, "a pass's frame read off its uid");
  // The sections.
  const cam0 = new THREE.OrthographicCamera();
  const cam1 = new THREE.OrthographicCamera();
  const cascades = new Map<unknown, string>([
    [cam0, 'cascade 0'],
    [cam1, 'cascade 1'],
  ]);
  const shadowScene: Any = { overrideMaterial: { isShadowPassMaterial: true }, name: '' };
  const chain = (name: string): Any => ({ name, userData: { gpuChain: true } });
  ok(sectionOfPass(cam1, shadowScene, cascades, PASS.world) === 'cascade 1', 'a sun cascade by its shadow camera');
  ok(sectionOfPass(new THREE.PerspectiveCamera(), shadowScene, cascades, PASS.interior) === 'lamp shadows', "any other shadow map as the lamps'");
  ok(sectionOfPass(null, chain('fx.gpu.ssao.gtao'), cascades, PASS.post) === 'chain: ssao' && sectionOfPass(null, chain('fx.gpu.bloom.blur0.h'), cascades, PASS.post) === 'chain: bloom' && sectionOfPass(null, chain('fx.gpu.colorGrade'), cascades, PASS.post) === 'chain: colour grade' && sectionOfPass(null, chain('fx.gpu.output'), cascades, PASS.post) === 'chain: output', "the chain's passes by their graph");
  ok(sectionOfPass(null, { name: '' }, cascades, PASS.world) === 'world pass' && sectionOfPass(null, { name: 'the rooms passes' }, cascades, PASS.interior) === 'rooms' && sectionOfPass(null, null, cascades, PASS.doorways) === 'doorways' && sectionOfPass(null, null, cascades, PASS.weather) === 'weather', 'the rest by the frame report\'s pass kind');
  const sums = sectionSums(
    new Map([
      ['r:0:1:f8', 1],
      ['r:1:1:f9', 0.25],
      ['r:2:2:f9', 0.5],
      ['r:3:3:f9', 0.125],
      ['r:4:4:f9', 2],
      ['r:5:1:f10', 9],
    ]),
    new Map([
      ['r:1:1:f9', 'world pass'],
      ['r:2:2:f9', 'cascade 0'],
      ['r:3:3:f9', 'world pass'],
    ]),
    new Set(['9']),
  );
  ok(sums.size === 1 && sums.get('9')!.get('world pass') === 0.375 && sums.get('9')!.get('cascade 0') === 0.5 && sums.get('9')!.get('unnamed') === 2, 'each whole frame summed by section, the unnamed apart');
}

// ---------------------------------------------------------------- 5. nothing allocated in a frame, in twelve fresh processes at once
{
  const me = fileURLToPath(import.meta.url);
  const runs = await Promise.all(
    Array.from({ length: 12 }, () =>
      new Promise<Record<string, number> | string>((res) => {
        const ch = spawn(process.execPath, ['--expose-gc', me, '--alloc'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        ch.stdout.on('data', (b) => (out += b));
        ch.stderr.on('data', (b) => (err += b));
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
  for (const k of ['idle', 'screenUp', 'screenGone']) {
    const v = got.map((r) => r[k]);
    ok(v.every((x) => Number.isFinite(x) && x < 0.5), `the ledger's frame call ${k} allocates nothing a frame in 12 of 12 processes (${v.map((x) => x.toFixed(3)).join(' ')} B)`);
  }
}

console.log(`gpuLedger: ${checks} checks passed`);
