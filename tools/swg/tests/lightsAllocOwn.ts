// The rooms' lights' frames, measured for what they make (Map-maker II's wave of the rooms' lights, DESIGN.md §2.0 rule 7):
// one frame path a process, named on the command line, each in a node process of its own with nothing else of the harness
// warmed before it (which call sites the compiler builds in turns on what it met first, so a path measured after another
// is not the path the game runs first: the R hold measured after the pool and F held read clean while measured alone it
// boxed two numbers a frame in one process of two), the young generation read with no collection in the window, the
// cleanest of three kept.
//
// The paths: `pool` (the world's frame of the lit room's lights: its clock taken from the frame's one read of the shared
// clock, four flickers, a light following a matrix, the hand's light), and the lights tool's frame --
// `tool` (its markers, a light picked and its gizmo), `lift` (F held raising it), `turn` (R held turning it), `tip` (Shift+R
// held tipping it), `drag` (the gizmo's ground square dragged) and `spotLive` (F held on a spot, the pool carrying a spot
// live, its target moved a frame).
//
// Run: node --expose-gc --allow-natives-syntax tools/swg/tests/lightsAllocOwn.ts <path>
// Prints one JSON line: { path, frames, made, scavenges, markers, picked, gizmo, live, held }.
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';
import { LightClock, RoomLightPool, roomPoolShape } from '../../../src/world/roomLightPool.ts';
import { planRoomLights, type PoolShape, type RoomLightsPlanned } from '../../../src/world/roomLights.ts';
import { RoomLightEdits } from '../../../src/world/roomLightEdits.ts';
import { readLightRow, type LightRow } from '../../../src/world/editFiles/lightsFile.ts';
import { EditorLights, type LightsBuilding, type LightsHost } from '../../../src/editor/editorLights.ts';
import { toolFrame, type ToolDraw } from '../../../src/editor/tools.ts';
import { screenView } from '../../../src/editor/gizmo.ts';
import { drawEditorMarks, marksView } from '../../../src/ui/editorMarks.ts';

export const LIGHTS_ALLOC_PATHS = ['pool', 'tool', 'lift', 'turn', 'tip', 'drag', 'spotLive'] as const;

const gc = (globalThis as { gc?: (o?: { type: 'minor' }) => void }).gc;
if (!gc) {
  console.log(JSON.stringify({ skipped: 'run with node --expose-gc' }));
  process.exit(0);
}
const path = process.argv[2] ?? 'pool';
if (!(LIGHTS_ALLOC_PATHS as readonly string[]).includes(path) && path !== 'profile') {
  console.log(JSON.stringify({ skipped: `no path ${path}: ${LIGHTS_ALLOC_PATHS.join(', ')}` }));
  process.exit(1);
}
let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => {
  await tick();
  await tick();
};
// Long enough that the window's own few bytes (its settle's promises) are nothing beside it.
const FRAMES = 100_000;

// ---- A building of three rooms, with lights of every kind and flicker added to it. ----

const lamp = (x: number, y: number, z: number) => ({ type: 2, color: [1, 0.9, 0.7], position: [x, y, z], direction: [0, 0, 1], attenuation: [1, 0.2, 0.01] });
const CELLS = [
  { index: 0, name: 'r0', lights: [] },
  { index: 1, name: 'hall', portals: [{ target: 2 }], lights: [{ type: 0, color: [0.1, 0.1, 0.1], position: [0, 0, 0], direction: [0, 0, 1], attenuation: [1, 0, 0] }, { type: 1, color: [1, 1, 1], position: [0, 6, 0], direction: [0, -1, 0], attenuation: [1, 0, 0] }, lamp(1, 2.5, 1), lamp(-2, 2.5, 3)] },
  { index: 2, name: 'back', portals: [{ target: 1 }], lights: [lamp(0, 2, -6), lamp(3, 2, -6)] },
];
const MATRIX = new THREE.Matrix4().compose(new THREE.Vector3(100, 0, -50), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6), new THREE.Vector3(1, 1, 1));
const B: LightsBuilding = { ref: CELLS, model: 'ours_house', copy: 'place/house-1', template: 'place/house-1', cell: 1, matrix: MATRIX, inverse: MATRIX.clone().invert(), cells: CELLS };
const row = (o: Record<string, unknown>): LightRow => {
  const r = readLightRow({ scope: 'copy', copy: 'place/house-1', model: 'ours_house', cell: 1, room: 'hall', ...o }, false);
  if (typeof r === 'string') throw new Error(r);
  return r;
};
const ROWS = {
  world: [
    row({ id: 'candle-1', kind: 'light', type: 'point', color: [1, 0.6, 0.3], brightness: 0.25, reach: 5, pos: [0.5, 1, 0.5], flicker: { shape: 'candle', rate: 5, depth: 0.35 } }),
    row({ id: 'tube-1', kind: 'light', type: 'point', color: [0.7, 0.9, 1], brightness: 0.8, reach: 10, pos: [-1, 3, -1], flicker: { shape: 'broken', rate: 1.5, depth: 0.9 } }),
    row({ id: 'spot-1', kind: 'light', type: 'spot', color: [1, 1, 1], brightness: 1, reach: 8, pos: [2, 3, 2], cone: [20, 30], flicker: { shape: 'pulse', rate: 0.5, depth: 0.4 }, shadow: true }),
    row({ id: 'strobe-1', kind: 'light', type: 'point', color: [1, 0, 0], brightness: 1, reach: 6, pos: [0, 3, 0], flicker: { shape: 'strobe', rate: 4, depth: 1 } }),
  ] as LightRow[],
  all: [] as LightRow[],
};
const SHAPE: PoolShape = roomPoolShape(2, 1);

// ---- The pool, lit by that plan in a scene of its own. ----

const scene = new THREE.Scene();
const points = Array.from({ length: 8 }, () => new THREE.PointLight(0xffffff, 0, 1, 2));
const pool = new RoomLightPool(points, new THREE.DirectionalLight(0xffffff, 0), new THREE.AmbientLight(0xffffff, 0));
pool.setShape(SHAPE, scene, 1);
const edits = new RoomLightEdits(ROWS.world, ROWS.all).forRoom(B.copy, B.model, CELLS);
const plan = planRoomLights(CELLS, 1, 0.18, pool.shape, edits) as RoomLightsPlanned;
const cells = new Array(8).fill(-1);
pool.apply(plan, MATRIX, cells);
// A light following a matrix (a lamp hung on a row the hand moves).
const followM = new THREE.Matrix4().makeTranslation(101, 2, -49);
pool.follow('tube-1', followM);
// The harness's own clocks in a typed array: a module let written with a number allocates on every write.
const T = new Float64Array([1.5, 0.5]);
// The world's one read of the walked shared clock a frame (`World.readWalk`, shared with the cloud shadows' drift): a clock
// read makes a number whatever is done with it (V8's `Date.now` and `performance.now` hand back a fresh one, 16 bytes a
// call, measured), so it is made once a frame for everything that reads it and stood in here by a write of the harness's
// own clock into the same kind of record. Then the world's own step of the lit room's lights (`World.stepRoomLights`).
const frameWalk = new LightClock();
const worldStep = (): void => {
  frameWalk.t = T[0] + T[1];
  pool.clock.t = frameWalk.t;
  pool.step();
};
const poolFrame = (): void => {
  T[0] += 1 / 144;
  followM.elements[12] = 101 + Math.sin(T[0]) * 0.5;
  pool.livePos.x = 0.5 + Math.cos(T[0]) * 0.25;
  worldStep();
};

// ---- The tool, over a host that makes nothing a frame. ----

const NONE: never[] = [];
const host: LightsHost = {
  edits: { putRows: async () => 'not in a measure' } as unknown as LightsHost['edits'],
  worldKind: () => 'ground',
  rows: () => ROWS,
  cameraBuilding: () => B,
  roomAt: () => ({ building: B, cell: 1 }),
  toRaw: (x, z, out) => {
    out.x = -x;
    out.z = z;
  },
  toGame: (x, z, out) => {
    out.x = -x;
    out.z = z;
  },
  shape: () => SHAPE,
  plan: () => plan,
  planVersion: () => 7,
  // The world's own hand-over (`World.roomLightLive`), the record handed whole.
  live: (l) => pool.takeLive(l),
  attached: () => NONE,
  rowUnderAim: () => null,
  // As the game's host writes them: fractions.
  look: (out) => {
    out.x = 0.6;
    out.z = -0.8;
  },
  eye: (out) => {
    out.x = 100;
    out.y = 8;
    out.z = -38;
  },
  grid: () => 0.5,
  say: () => {},
  refresh: () => {},
};
const tool = new EditorLights(host);
await tool.arm();
const view = screenView();
{
  const cam = new THREE.PerspectiveCamera(60, 1600 / 900, 0.1, 5000);
  cam.position.set(100, 8, -38);
  cam.lookAt(100, 2, -50);
  cam.updateMatrixWorld();
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  view.vp.set(vp.elements);
  view.inv.set(vp.clone().invert().elements);
  view.w = 1600;
  view.h = 900;
  view.ex = 100;
  view.ey = 8;
  view.ez = -38;
  const f = new THREE.Vector3();
  cam.getWorldDirection(f);
  view.fx = f.x;
  view.fy = f.y;
  view.fz = f.z;
  view.focal = 450 / Math.tan(Math.PI / 6);
}
const marks = marksView();
const draw: ToolDraw = { marks, radius: 0.5, ring() {} };
const overlay = {
  line(_a: number, _b: number, _c: number, _d: number, _w: number, _col: number, _al: number): void {},
  ring(_a: number, _b: number, _r: number, _w: number, _col: number, _al: number): void {},
  poly(_p: ArrayLike<number>, _n: number, _w: number, _c: number, _a: number, _close?: boolean, _fill?: boolean): void {},
};
const f = toolFrame();
f.dt = 1 / 144;
// The mouse's way through a hold, kept: 0 still, 1 F held, 2 R held, 3 Shift+R held, 4 a drag (the button down, the cursor
// moved across from where it grabbed), 5 F held on the spot.
const MODE = new Int32Array(1);
const SQ = new Float64Array(2);
const toolFrameOnce = (): void => {
  T[1] += 0.013;
  const phase = T[1];
  const mode = MODE[0];
  if (mode === 4) {
    f.apply = true;
    f.sx = SQ[0] + Math.sin(phase) * 60;
    f.sy = SQ[1];
  } else {
    f.sx = 800 + Math.sin(phase) * 40;
    f.sy = 450 + Math.cos(phase) * 30;
  }
  f.lift = mode === 1 || mode === 5;
  f.turn = mode === 2 || mode === 3;
  f.shift = mode === 3;
  f.dy = mode === 0 || mode === 4 ? 0 : Math.sin(phase * 3) * 4;
  f.dx = mode === 2 || mode === 3 ? Math.cos(phase * 3) * 4 : 0;
  tool.step(f);
  marks.gizmo = null;
  tool.overlay(draw, view);
  drawEditorMarks(overlay, marks);
  worldStep();
};
const loop = (fn: () => void) => (n: number): void => {
  for (let i = 0; i < n; i++) fn();
};
const poolFrames = loop(poolFrame);
const toolFrames = loop(toolFrameOnce);
try {
  new Function('f', '%NeverOptimizeFunction(f)')(poolFrames);
  new Function('f', '%NeverOptimizeFunction(f)')(toolFrames);
} catch {
  // Without the flag the loops are left to the compiler.
}
const measure = async (frames: (n: number) => void): Promise<{ made: number; scavenges: number }> => {
  let best = { made: Infinity, scavenges: Infinity };
  for (let attempt = 0; attempt < 3; attempt++) {
    frames(10_000);
    gc({ type: 'minor' });
    await settle();
    scavenges = 0;
    const before = young();
    frames(FRAMES);
    const made = young() - before;
    await settle();
    if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
    if (best.scavenges === 0 && best.made <= 0) break;
  }
  return best;
};

/** The tool readied for a path: the light picked (the spot for `spotLive`), the gizmo's ground square grabbed for a drag. */
const ready = (mode: number): boolean => {
  tool.pickKey(mode === 5 ? 'spot-1' : 'candle-1');
  MODE[0] = 0;
  f.apply = false;
  toolFrames(3);
  if (mode !== 4) {
    MODE[0] = mode;
    return true;
  }
  const L = marks.gizmo as unknown as { square: Float64Array } | null;
  if (!L) return false;
  SQ[0] = (L.square[0] + L.square[2] + L.square[4] + L.square[6]) / 4;
  SQ[1] = (L.square[1] + L.square[3] + L.square[5] + L.square[7]) / 4;
  f.sx = SQ[0];
  f.sy = SQ[1];
  f.apply = false;
  tool.step(f);
  tool.overlay(draw, view);
  f.apply = true;
  tool.step(f);
  tool.overlay(draw, view);
  MODE[0] = 4;
  return (tool as unknown as { dragging: boolean }).dragging === true;
};

const MODE_OF: Record<string, number> = { tool: 0, lift: 1, turn: 2, tip: 3, drag: 4, spotLive: 5 };

if (path === 'profile') {
  // Where it is made, by the sampling heap profiler: `node --expose-gc tools/swg/tests/lightsAllocOwn.ts profile <path>`.
  const what = process.argv[3] ?? 'turn';
  const frames = what === 'pool' ? poolFrames : toolFrames;
  if (what !== 'pool') ready(MODE_OF[what] ?? 2);
  frames(40_000);
  const { Session } = await import('node:inspector/promises');
  const session = new Session();
  session.connect();
  await session.post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  frames(50_000);
  const { profile } = (await session.post('HeapProfiler.stopSampling')) as unknown as { profile: { head: Node } };
  interface Node { callFrame: { functionName: string; url: string; lineNumber: number }; selfSize: number; children: Node[] }
  const rows: { at: string; size: number }[] = [];
  const walk = (n: Node, p: string[]) => {
    const here = `${n.callFrame.functionName || '(anon)'}:${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
    const p2 = [...p, here];
    if (n.selfSize) rows.push({ at: p2.slice(-4).join(' < '), size: n.selfSize });
    for (const c of n.children) walk(c, p2);
  };
  walk(profile.head, []);
  rows.sort((a, b) => b.size - a.size);
  for (const r of rows.slice(0, 12)) console.log(r.size, r.at);
  process.exit(0);
}

let held = true;
let got: { made: number; scavenges: number };
if (path === 'pool') {
  pool.liveKey = 'candle-1';
  poolFrames(20_000);
  got = await measure(poolFrames);
} else {
  held = ready(MODE_OF[path]);
  toolFrames(20_000);
  got = await measure(toolFrames);
}
console.log(JSON.stringify({ path, frames: FRAMES, made: got.made, scavenges: got.scavenges, markers: marks.lightCount, picked: tool.pickedKey, gizmo: marks.gizmo !== null, live: pool.liveKey, held, clock: pool.clock.t }));
process.exit(0);
