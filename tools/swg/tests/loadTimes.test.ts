// The GPU port's pass 1, wave 2, item 2 (`A:\swg3js\port\PASS1-W2.md`): where load time goes, `__debug.load()`
// (`src/core/loadTimes.ts`), over the game's own pieces where node can run them and stand-ins of the browser's where not.
//
//  1. a download's address filed under its kind (the dev server's modules and a build's bundles as the code, a pack's
//     models, textures, terrain folder, sounds and files), and the union of intervals clipped to a window;
//  2. the journeys: the page's own opened from the navigation's start at the install and ended at the character list, a
//     trip opened and ended by the travel's flag, the boot's and the screen's words as phases; a mark kept only inside one,
//     clipped to its start, folded into its stage's last interval where the two meet and kept apart where they do not;
//     closed, a mark's site never reads the clock;
//  3. the downloads folded from the browser's record (a stand-in of resource timing) and cleared, by kind and by journey,
//     with the bytes, what came from the cache, the wall time, and the ring that lets the oldest go;
//  4. the report: the stages, the shaders (WebGPU's pipelines off the real landing log, `landingReport({ exact })`, and
//     WebGL's link waits and sweep), each phase overlaid, what is left, the share that is shaders and that is not;
//  5. the game's sites: a real physics world's every collider timed as the colliders' stage, a real GLTFLoader's file
//     timed as the models' between the surfaces plugin's two hooks, and the text that hooks the rest (the travel's flag,
//     the boot, the screen, the character list, the chunk, the tier, the ground's pictures, `index.html`'s room);
//  6. what a closed mark costs: nothing allocated, in twelve fresh processes at once (`--alloc`).
//
// Run: node tools/swg/tests/loadTimes.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldResources, installLoadTimes, K_CODE, K_MODELS, K_OTHER, K_PACKS, K_SOUNDS, K_TERRAIN, K_TEXTURES, kindOfUrl, LOAD, LOAD_CAP, loadBegin, loadEnd, loadMark, loadPhase, loadReport, markEnd, markStart, pushResource, resetLoadTimes, ST_COLLIDERS, ST_FLORA, ST_MODELS, ST_SCENE, ST_TERRAIN, STAGES, unionMs, type PipeRow } from '../../../src/core/loadTimes.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8');

/** The clock the module reads, stood in for, and how often it was read. */
let clock = 0;
let reads = 0;
const realNow = performance.now.bind(performance);
const standClock = (): void => {
  Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => (reads++, clock) });
};
const realClock = (): void => {
  Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: realNow });
};

// ---------------------------------------------------------------- 6 (child). what a closed mark allocates, in a process of its own
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
  resetLoadTimes();
  // A play frame's marks, between journeys: a chunk's ground and plants, a collider, a tier.
  const out: Record<string, number> = {};
  out.closed = await window_(() => {
    const a = markStart();
    markEnd(ST_TERRAIN, a);
    const b = markStart();
    markEnd(ST_FLORA, b);
    const c = markStart();
    markEnd(ST_COLLIDERS, c);
  }, 20000);
  console.log(JSON.stringify(out));
  process.exit(0);
}

// ---------------------------------------------------------------- 1. kinds, and unions
{
  const k = (u: string): number => kindOfUrl(u);
  ok(k('http://127.0.0.1:5189/src/main.ts') === K_CODE && k('http://127.0.0.1:5189/node_modules/.vite/deps/three.js?v=1a2b') === K_CODE && k('http://127.0.0.1:5189/@vite/client') === K_CODE, "the dev server's modules, its prebundled deps and its client are the code");
  ok(k('https://x/assets/index-abc123.js') === K_CODE && k('https://x/assets/rapier_wasm3d_bg.wasm') === K_CODE && k('https://x/assets/index.css') === K_CODE, "a build's bundles, the physics engine's wasm and the styles are the code");
  ok(k('http://h/src/data/table.json?import') === K_CODE, 'a JSON the code imports is the code (the dev server serves it as a module)');
  ok(k('http://h/assets-private/tatooine/bantha.glb') === K_MODELS && k('http://h/assets-private/garage/x.gltf') === K_MODELS, 'a model is a model');
  ok(k('http://h/assets-private/tatooine/flora/leaf.png') === K_TEXTURES && k('http://h/assets-private/loading/naboo.png?x=1') === K_TEXTURES && k('http://h/assets-private/sky/sun.rgba') === K_TEXTURES, 'a picture is a texture, its query left off');
  ok(k('http://h/assets-private/tatooine/terrain/colour_0.png') === K_TERRAIN && k('http://h/assets-private/tatooine/tatooine.trn') === K_TERRAIN && k('http://h/assets-private/naboo/terrain/heights.bin') === K_TERRAIN, "a pack's terrain folder is the terrain's (its pictures with it), and a .trn");
  ok(k('http://h/assets-private/music/theme.mp3') === K_SOUNDS && k('http://h/jka/sound/weapons/saber/saberon.wav') === K_SOUNDS && k('http://h/assets-private/sounds/x.ogg') === K_SOUNDS, 'a sound is a sound');
  ok(k('http://h/assets-private/tatooine/manifest.json') === K_PACKS && k('http://h/assets-private/tatooine/objects.lay') === K_PACKS && k('http://h/placements/tatooine.json') === K_PACKS && k('http://h/assets-private/mobiles/catalogue.zip') === K_PACKS, "a pack's own files and the public placements are the packs'");
  ok(k('http://h/favicon.ico') === K_OTHER, 'the rest is other');
  ok(unionMs([0, 10, 5, 15, 20, 30], 0, 100) === 25, 'the union of overlapping and apart intervals');
  ok(unionMs([0, 100, 10, 20], 0, 1000) === 100 && unionMs([0, 100], 40, 60) === 20 && unionMs([0, 10], 20, 30) === 0, 'one inside another counts once; clipped to the window; outside it nothing');
  ok(unionMs([30, 40, 0, 10, 5, 12], 0, 100) === 22, 'unsorted intervals are sorted first');
}

// ---------------------------------------------------------------- 2. journeys, phases, marks
standClock();
{
  resetLoadTimes();
  clock = 50;
  installLoadTimes();
  ok(LOAD.open && LOAD.current?.kind === 'page' && LOAD.current.start === 0, "the install opens the page's own journey from the navigation's start");
  installLoadTimes();
  ok(LOAD.journeys.length === 1, 'a second install does nothing');
  loadPhase('what', 'the physics engine and the worlds file', 50);
  loadPhase('what', 'starting the renderer', 120);
  loadPhase('what', 'building the game and the character list', 400);
  loadMark(ST_SCENE, 450, 470);
  loadEnd(900);
  ok(!LOAD.open && LOAD.journeys[0].end === 900, 'the character list shown ends it');
  // Closed: a mark's site reads one flag and never the clock, and nothing is kept.
  reads = 0;
  const t = markStart();
  markEnd(ST_TERRAIN, t);
  ok(t === 0 && reads === 0, 'closed, markStart answers 0 and the clock is never read');
  const made = LOAD.ivMade;
  loadMark(ST_TERRAIN, 1000, 1010);
  ok(LOAD.ivMade === made, 'closed, nothing is kept');
  // A trip: the screen goes up before the flag (an arrival from the select screen says its words as it starts).
  loadPhase('on', 'Tatooine', 1990);
  loadPhase('what', 'loading the planet\'s pack', 1990);
  loadBegin(2000, 5);
  ok(LOAD.open && LOAD.current?.kind === 'trip' && LOAD.current.linkFrom === 5, 'the flag up opens a trip, the link waits so far kept with it');
  loadPhase('on', 'Tatooine', 2001);
  ok(LOAD.current!.title === 'Tatooine', "the screen's title names the trip");
  clock = 2100;
  const c0 = markStart();
  clock = 2110;
  markEnd(ST_COLLIDERS, c0);
  ok(LOAD.current!.count[ST_COLLIDERS] === 1 && LOAD.current!.busy[ST_COLLIDERS] === 10, 'open, a mark is timed from its start to now');
  // A loop of colliders, one after another: one interval, every mark counted.
  const iv0 = LOAD.ivMade;
  for (let i = 0; i < 50; i++) loadMark(ST_COLLIDERS, 2110 + i * 0.2, 2110.1 + i * 0.2);
  ok(LOAD.ivMade === iv0 && LOAD.current!.count[ST_COLLIDERS] === 51, 'marks meeting the last interval are folded into it');
  loadMark(ST_COLLIDERS, 2500, 2510);
  ok(LOAD.ivMade === iv0 + 1, 'one apart from it is an interval of its own');
  // Spans ending out of order (two models unpacking at once): folded only where they meet.
  loadMark(ST_MODELS, 2200, 2300);
  loadMark(ST_MODELS, 2150, 2250);
  const mi = (LOAD.ivMade - 1) % LOAD_CAP.intervals;
  ok(LOAD.ivStart![mi] === 2150 && LOAD.ivEnd![mi] === 2300, 'an overlapping span widens the interval on both sides');
  loadMark(ST_MODELS, 2000, 2050);
  ok(LOAD.ivStart![(LOAD.ivMade - 1) % LOAD_CAP.intervals] === 2000, 'one earlier and apart is not swallowed by the later one');
  loadMark(ST_TERRAIN, 1500, 2020);
  ok(LOAD.ivStart![(LOAD.ivMade - 1) % LOAD_CAP.intervals] === 2000, "a mark begun before the journey is clipped to its start");
  loadPhase('what', 'loading the terrain', 2400);
  loadPhase('what', 'building shaders, 3 new', 2600);
  loadPhase('what', 'building shaders, 9 new', 2700);
  loadPhase('off', '', 3000);
  ok(LOAD.phases.filter((p) => p.words === 'building shaders, # new').length === 1, 'the numbers in the words are folded, so one phase is one phase');
  loadEnd(3100, { link: 405, screens: [{ title: 'Tatooine', s: 1.01, programs: 40, sweep: { programs: 30, ms: 250 } }] });
  ok(LOAD.journeys[1].end === 3100 && LOAD.journeys[1].linkTo === 405 && LOAD.journeys[1].screens.length === 1, 'the flag down ends it, with its link waits and its screens');
  const iv1 = LOAD.ivMade;
  loadBegin(4000);
  loadMark(ST_COLLIDERS, 4001, 4002);
  ok(LOAD.ivMade === iv1 + 1, "a new journey's first mark never folds into the last journey's interval");
  loadBegin(4500);
  ok(LOAD.journeys[2].end === 4500 && LOAD.current?.start === 4500, 'a journey begun while one is open ends that one first');
  loadEnd(4600);
}

// ---------------------------------------------------------------- 3. the downloads
{
  const entries: Any[] = [];
  let cleared = 0;
  const perf = { getEntriesByType: (t: string) => (t === 'resource' ? entries.slice() : []), clearResourceTimings: () => ((entries.length = 0), cleared++) };
  resetLoadTimes();
  installLoadTimes();
  entries.push({ name: 'http://h/src/main.ts', startTime: 10, responseEnd: 40, duration: 30, transferSize: 3000, decodedBodySize: 9000 });
  entries.push({ name: 'http://h/node_modules/.vite/deps/three.js?v=1', startTime: 20, responseEnd: 80, duration: 60, transferSize: 0, decodedBodySize: 1_000_000 });
  ok(foldResources(perf) === 2 && cleared === 1 && entries.length === 0 && LOAD.resMade === 2, "the browser's record is folded into the ring and cleared");
  loadPhase('what', 'building the game and the character list', 90);
  loadEnd(100);
  loadBegin(1000);
  entries.push({ name: 'http://h/assets-private/tatooine/manifest.json', startTime: 1000, responseEnd: 1100, duration: 100, transferSize: 50_000, decodedBodySize: 400_000 });
  entries.push({ name: 'http://h/assets-private/tatooine/a.glb', startTime: 1050, responseEnd: 1300, duration: 250, transferSize: 2_000_000, decodedBodySize: 2_000_000 });
  entries.push({ name: 'http://h/assets-private/tatooine/b.glb', startTime: 1200, responseEnd: 1400, duration: 200, transferSize: 1_000_000, decodedBodySize: 1_000_000 });
  entries.push({ name: 'http://h/assets-private/tatooine/terrain/c.png', startTime: 1500, responseEnd: 1600, duration: 100, transferSize: 0, decodedBodySize: 300_000 });
  // One begun before the journey and still under way in it (the catalogue fetched behind the select screen).
  entries.push({ name: 'http://h/assets-private/mobiles/catalogue.json', startTime: 500, responseEnd: 1200, duration: 700, transferSize: 8_000_000, decodedBodySize: 8_000_000 });
  loadEnd(2000);
  const realPerf = globalThis.performance as Any;
  const getE = realPerf.getEntriesByType;
  const clr = realPerf.clearResourceTimings;
  realPerf.getEntriesByType = perf.getEntriesByType;
  realPerf.clearResourceTimings = perf.clearResourceTimings;
  let r: Any;
  try {
    r = loadReport({ now: 3000, renderer: 'WebGL', pipelines: null, navigation: { startTime: 0, responseEnd: 8, transferSize: 900, decodedBodySize: 700 } });
  } finally {
    realPerf.getEntriesByType = getE;
    realPerf.clearResourceTimings = clr;
  }
  const [page, trip] = r.journeys;
  ok(page.downloads.files === 3 && page.downloads.byKind.code.files === 3 && page.downloads.byKind.code.fromCache === 1, "the page's journey: its two modules and the page itself, the code, one from the cache");
  // The page [0, 8], the modules [10, 40] and [20, 80]: 78 ms, said to the hundredth of a second.
  ok(page.downloads.wallS === 0.08, `the page's downloads' wall time is their union (${page.downloads.wallS})`);
  ok(trip.downloads.files === 4 && trip.downloads.byKind.models.files === 2 && trip.downloads.byKind.packs.files === 1 && trip.downloads.byKind.terrain.files === 1, 'the trip: the files begun inside it, by kind');
  ok(trip.downloads.byKind.models.wireMB === 2.86 && trip.downloads.byKind.terrain.fromCache === 1, 'the bytes over the wire by kind, and the cached file (nothing over the wire, a file all the same)');
  ok(Math.abs(trip.downloads.wallS - 0.5) < 1e-9, `the wall time counts the catalogue still under way inside it, clipped, and the gaps not at all (${trip.downloads.wallS})`);
  ok(Math.abs(trip.downloads.byKind.packs.wallS - 0.2) < 1e-9, `the packs' wall time is their own union, the catalogue's part inside the journey with it (${trip.downloads.byKind.packs.wallS})`);
  // The ring: the oldest let go, and a journey that lost some says so.
  LOAD_CAP.resources = 4;
  resetLoadTimes();
  installLoadTimes();
  for (let i = 0; i < 6; i++) pushResource(`http://h/assets-private/x${i}.glb`, i * 10, i * 10 + 5, 1, 1);
  loadEnd(100);
  const r2: Any = loadReport({ now: 200, renderer: 'WebGL', pipelines: null });
  ok(r2.held.downloads === 4 && r2.held.downloadsEver === 6 && r2.journeys[0].downloads.files === 4 && typeof r2.journeys[0].downloads.partial === 'string', 'the ring holds its size, and a journey that lost some downloads says so');
  LOAD_CAP.resources = 16384;
}

// ---------------------------------------------------------------- 4. the report: stages, shaders, phases, what is left, the share
{
  resetLoadTimes();
  installLoadTimes();
  loadEnd(100);
  loadPhase('on', 'Naboo', 1000);
  loadPhase('what', 'loading the terrain', 1000);
  loadBegin(1000, 0);
  pushResource('http://h/assets-private/naboo/a.glb', 1000, 1400, 10, 10);
  loadMark(ST_MODELS, 1300, 1600);
  loadMark(ST_TERRAIN, 1100, 1200);
  loadPhase('what', 'compiling shaders', 2000);
  loadPhase('what', 'ready', 2600);
  loadPhase('off', '', 2800);
  loadEnd(3000, { link: 120, screens: [{ title: 'Naboo', s: 1.8, programs: 25, sweep: { programs: 20, ms: 400 } }] });
  const gl: Any = loadReport({ now: 4000, renderer: 'WebGL', pipelines: null });
  const j = gl.journeys[1];
  ok(j.journey === 'trip 1: Naboo' && j.totalS === 2, "a trip named by its screen's title, its total its own");
  ok(j.stages.models.wallS === 0.3 && j.stages.terrain.wallS === 0.1 && j.stages.models.marks === 1, 'each stage its marks and its union');
  ok(j.shaders.linkWaitS === 0.12 && j.shaders.programsBehindScreens === 25 && j.shaders.sweep.programs === 20 && j.shaders.sweep.s === 0.4, "WebGL's shaders: the link waits inside it, the screens' programs and the sweep's");
  // The downloads [1000, 1400], the models [1300, 1600], the terrain [1100, 1200]: 0.6 s named of 2 s.
  ok(Math.abs(j.leftS - 1.4) < 1e-9, `what is left is the time nothing named covers (${j.leftS})`);
  const words = j.phases.map((p: Any) => p.words);
  ok(words.join('|') === 'loading the terrain|compiling shaders|ready|(no screen up)', `the phases in order, the one under way as it began included (${words.join('|')})`);
  ok(j.phases[0].s === 1 && j.phases[0].downloadsS === 0.4 && j.phases[0].modelsS === 0.3 && j.phases[0].terrainS === 0.1 && Math.abs(j.phases[0].leftS - 0.4) < 1e-9, 'each phase overlaid with the downloads and the stages inside it, and its own left');
  ok(j.share.byPhase.shadersS === 0.6 && j.share.byPhase.notShadersS === 1.4 && j.share.byPhase.shaders === 0.3, "the share by phase: the screen's shader words are the shaders'");
  ok(j.share.byMeasure.shadersS === 0.12, 'the share by measure on WebGL: the link waits');
  // WebGPU: the pipelines off the real landing log, its times unrounded.
  const { LEDGER, recordPipeline, landingReport } = await import('../../../src/core/gpu/pipeLedger.ts');
  LEDGER.ring.fill(null);
  LEDGER.head = 0;
  LEDGER.made = 0;
  LEDGER.byKey.clear();
  let land!: () => void;
  const later = new Promise<void>((res) => (land = res));
  clock = 2100;
  recordPipeline({ pipeline: { cacheKey: '1,2,a' }, object: { type: 'Mesh' }, material: { type: 'MeshStandardNodeMaterial' } }, [later], 2050, true, true, false);
  clock = 2150;
  recordPipeline({ pipeline: { cacheKey: '1,3,b' }, object: { type: 'Mesh' }, material: { type: 'MeshStandardNodeMaterial' } }, null, 2140, true, true, false);
  recordPipeline({ pipeline: { cacheKey: '1,4,c' }, object: { type: 'Mesh' }, material: { type: 'MeshStandardNodeMaterial' } }, [new Promise(() => {})], 2900, true, true, false);
  clock = 2500;
  land();
  await later;
  await new Promise((r) => setImmediate(r));
  const rows = (landingReport({ all: true, exact: true }) as Any).pipelines as PipeRow[];
  ok(rows.length === 3 && rows[0].askedMs === 2050 && rows[0].landedMs === 2500 && rows[1].askedMs === 2140 && rows[1].landedMs === 2150 && rows[2].landedMs === -1, "the landing log's rows with their times unrounded (`exact`)");
  ok(rows[0].asked === 'loading screen' && rows[1].asked === 'a draw', 'and who asked');
  const gpu: Any = loadReport({ now: 4000, renderer: 'WebGPU', pipelines: rows });
  const g = gpu.journeys[1];
  ok(g.shaders.pipelinesAsked === 3 && g.shaders.landed === 2 && g.shaders.pendingAtEnd === 1 && g.shaders.askedBy['loading screen'] === 2 && g.shaders.askedBy['a draw'] === 1, "WebGPU's shaders: the pipelines asked inside it, landed, still pending as it ended, by who asked");
  // Pending [2050, 2500], [2140, 2150] inside it, and [2900, 3000] clipped at its end: 0.55 s.
  ok(Math.abs(g.shaders.pendingWallS - 0.55) < 1e-9 && Math.abs(g.share.byMeasure.shadersS - 0.55) < 1e-9, `the time a pipeline was pending is their union, clipped (${g.shaders.pendingWallS})`);
  ok(g.phases[1].words === 'compiling shaders' && Math.abs(g.phases[1].pipelinesPendingS - 0.45) < 1e-9, `each phase with the pipelines pending inside it (${g.phases[1].pipelinesPendingS})`);
  ok(g.leftS < j.leftS, 'and what WebGPU had pending is named, not left');
  ok(String(gpu.note).includes('leftS'), 'the report says what its figures are');
}

// ---------------------------------------------------------------- 5. the game's own sites
{
  realClock();
  resetLoadTimes();
  const { Physics } = await import('../../../src/core/physics.ts');
  const physics = await Physics.create();
  physics.createStaticCylinder(0, 1, 0, 0.5, 1);
  ok(LOAD.ivMade === 0, 'a collider made with no journey open is not timed');
  loadBegin(performance.now());
  const c = physics.createStaticCylinder(3, 1, 0, 0.5, 1);
  physics.createStaticPart({ kind: 'mesh', x: 0, y: 0, z: 0, verts: [0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1], idx: [0, 1, 2, 1, 3, 2] } as Any);
  ok(c !== null && LOAD.current!.count[ST_COLLIDERS] === 2, "a real physics world's every collider timed as the colliders' stage, made as before");
  ok(physics.world.colliders.len() >= 3, 'and every collider stands in the world');
  // A real GLTFLoader's file, through the surfaces plugin's two hooks.
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { surfaces } = await import('../../../src/world/surfaces.ts');
  const gltf = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'empty' }] });
  const parse = (): Promise<Any> => new Promise((res, rej) => surfaces.withPlugin(new GLTFLoader()).parse(gltf, '', res, rej));
  const g = await parse();
  ok(g.scene && LOAD.current!.count[ST_MODELS] === 1 && LOAD.current!.busy[ST_MODELS] >= 0, 'a file read by the loader is timed as the models between the plugin\'s first hook and its last');
  loadEnd(performance.now());
  await parse();
  ok(LOAD.journeys[LOAD.journeys.length - 1].count[ST_MODELS] === 1, 'with no journey open a file is read the same and nothing is timed');
  // The text that hooks the rest.
  const main = read('src/main.ts');
  ok(/private set traveling\(v: boolean\) \{\n\s+if \(v === this\.travelingNow\) return;\n\s+this\.travelingNow = v;\n\s+if \(v\) loadBegin\(performance\.now\(\), LINK_WAITS\.totalMs\);\n\s+else loadEnd\(/.test(main.replace(/\r\n/g, '\n')), "main.ts: the travel's flag, set anywhere, begins and ends a journey as it changes");
  ok((main.match(/this\.travelingNow = /g) ?? []).length === 1 && !/private traveling = /.test(main), 'main.ts: the flag is set through its setter alone');
  ok(/async function boot\(\): Promise<void> \{\s*\n\s*\/\/[^\n]*\n\s*installLoadTimes\(\);/.test(main.replace(/\r\n/g, '\n')), "main.ts: the boot's first act installs the page's journey");
  ok(/this\.select\.show\(loadCharacters\(\)\);\s*\n\s*\/\/[^\n]*\n\s*loadEnd\(performance\.now\(\)\);/.test(main.replace(/\r\n/g, '\n')), "main.ts: the character list shown ends the page's journey");
  ok(/this\.loadingScreen\.onChange = \(kind, text, now\) => \{\s*\n\s*\/\/[^\n]*\n\s*loadPhase\(kind, text, now\);/.test(main.replace(/\r\n/g, '\n')), "main.ts: every change of the loading screen is a phase");
  ok(main.includes("load: (o?: { last?: number }) => {") && main.includes("GPU.webgpu ? ((GPU.rt!.landing({ all: true, exact: true }).pipelines ?? []) as PipeRow[]) : null"), 'main.ts: `__debug.load()` reads the landing log only on WebGPU');
  const world = read('src/world/world.ts').replace(/\r\n/g, '\n');
  ok(/const tGround = markStart\(\);\n\s+const \{ geometry, heights, origin \} = this\.terrain\.buildChunk\(cx, cz\);\n\s+markEnd\(ST_TERRAIN, tGround\);/.test(world) && /const tFar = markStart\(\);\n\s+const geometry = this\.terrain\.buildFarTile\(/.test(world), "world.ts: a chunk's ground and a far tile are the terrain's");
  ok(/markEnd\(ST_FLORA, tPlants\);/.test(world) && /markEnd\(ST_FLORA, tGrass\);/.test(world), "world.ts: a chunk's plants and props and its grass are the flora's");
  const layout = read('src/world/layoutStream.ts');
  ok(layout.includes('const loaded = this.instance(bulk, models);') && layout.includes('markEnd(ST_SCENE, tScene);') && layout.includes('markEnd(ST_SCENE, tRooms);'), "layoutStream.ts: a tier put together and its rooms are the scene's");
  ok(read('src/world/terrainTextures.ts').includes('markEnd(ST_TEXTURES, tPictures);'), "terrainTextures.ts: the ground's pictures are the textures'");
  const html = read('index.html');
  const room = html.indexOf('performance.setResourceTimingBufferSize(4000);');
  ok(room > 0 && room < html.indexOf('<script type="module" src="/src/main.ts"></script>'), "index.html: the browser's record is given room before the game's module graph is fetched");
  const lt = read('src/core/loadTimes.ts');
  ok(!/from 'three/.test(lt) && !/core\/gpu\//.test(lt.replace(/\/\/[^\n]*/g, '')), 'loadTimes.ts imports nothing of three and nothing of the WebGPU side');
  ok(read('README.md').includes('| `load()`, `load({ last: 2 })` | Where load time goes'), "the README's Debugging table says the helper");
  ok(STAGES.length === 6, 'six stages');
}

// ---------------------------------------------------------------- 6. a closed mark allocates nothing, in twelve fresh processes at once
{
  const me = fileURLToPath(import.meta.url);
  const runs = await Promise.all(
    Array.from(
      { length: 12 },
      () =>
        new Promise<Record<string, number>>((res, rej) => {
          const ch = spawn(process.execPath, ['--expose-gc', me, '--alloc'], { stdio: ['ignore', 'pipe', 'pipe'] });
          let out = '';
          ch.stdout.on('data', (b) => (out += b));
          ch.on('exit', (code) => {
            try {
              if (code !== 0) throw new Error(`exit ${code}`);
              res(JSON.parse(out.trim().split('\n').pop()!));
            } catch (e) {
              rej(e);
            }
          });
        }),
    ),
  );
  const v = runs.map((r) => r.closed);
  console.log(`loadTimes: closed marks, B a frame in 12 processes: ${v.map((x) => x.toFixed(3)).join(' ')}`);
  ok(v.every((x) => Number.isFinite(x) && x < 0.5), `three closed marks a frame allocate nothing in 12 of 12 processes (${v.map((x) => x.toFixed(3)).join(' ')} B)`);
}

console.log(`loadTimes: ${checks} checks passed`);
