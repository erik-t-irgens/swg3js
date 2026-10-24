// The moving air's CPU side over whole steady frames, in a node process of its own: `airAlloc.test.ts` runs this three
// times and reads the one line of JSON it prints. Not a test itself.
//
// A steady frame (the design's §8 Tests): the real `AirField.update`, master on and something reading it, its renderer a
// stand-in whose every method is a kept no-op (the draws are the card's; what is measured is what the field makes between
// them): ten engines and two downwashes read from stand-in hulls whose bodies throw if anybody asks them for a velocity,
// a Force push and a blast queued every so often, the rasters with the window standing still, the solver's fixed steps
// and every uniform written, the dust and the light; and the dust pool's grains, thrown and stepped onto the field's own
// height raster. A frame whose window moves -- every frame of a ride or a flight -- is measured apart and held to the
// same line: its ground here is a stand-in that makes nothing, so whatever such a frame makes is the air's own (in the
// game the terrain's cached readers ask the world, which is the world's cost and not measured here).
//
// Run: node --expose-gc --allow-natives-syntax tools/swg/tests/airAlloc.ts
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';
import { AirField, newAirFrameInput } from '../../../src/world/volumetrics/airField.ts';
import { makeAirGroundUniforms } from '../../../src/world/volumetrics/airGround.ts';
import type { AirHull } from '../../../src/world/volumetrics/airEngines.ts';
import type { GroundSample, GroundSampler } from '../../../src/world/volumetrics/airRaster.ts';
import { newVolTune } from '../../../src/world/volumetrics/volSettings.ts';
import { Dust, type GrainGround } from '../../../src/vehicles/dust.ts';
import type { FootStep } from '../../../src/audio/footsteps.ts';

const gc = (globalThis as { gc?: (o?: { type: 'minor' }) => void }).gc;
if (!gc) {
  console.log(JSON.stringify({ skipped: 'run with node --expose-gc' }));
  process.exit(0);
}

// The stand-in renderer: kept no-ops, so a call makes nothing of its own.
const noop = (): void => {};
const clearColour = new THREE.Color();
const ext = {};
const gl = { getExtension: (): object => ext, RED: 6403, RG: 33319, IMPLEMENTATION_COLOR_READ_FORMAT: 35739, getParameter: (): number => 6408 };
const renderer = {
  autoClear: true,
  getContext: () => gl,
  getRenderTarget: (): null => null,
  setRenderTarget: noop,
  getClearAlpha: (): number => 1,
  getClearColor: (c: THREE.Color): THREE.Color => c.copy(clearColour),
  setClearColor: noop,
  render: noop,
  clear: noop,
  renderBufferDirect: noop,
  compile: noop,
  info: { programs: [] as unknown[] },
  properties: { get: (): object => ({}) },
} as unknown as THREE.WebGLRenderer;

// The ground: rolling sand, whole metres (a number the engine hands back without making one), every cell known.
const ground: GroundSampler = {
  sample(x: number, z: number, out: GroundSample): boolean {
    out.h = ((x | 0) >> 4) & 3;
    out.family = 1;
    out.medium = 1;
    return true;
  },
};

// The hulls: three speeders of two engines, and two ships hovering with their two engines aft and a downwash each.
const hulls: AirHull[] = [];
function hull(x: number, z: number, ship: boolean, y: number): AirHull {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = x * 0.01;
  const engines = [-1, 1].map((s) => {
    const o = new THREE.Object3D();
    o.position.set(s, 0, -3);
    group.add(o);
    return { object: o, size: 1, seed: 0 };
  });
  group.updateMatrixWorld(true);
  return {
    engines,
    engineHeat: 1,
    group,
    // One ship flying, one stopped in the air on its springs (above its band's floor, never `airborne`).
    spec: { ship, kind: ship ? 'ship' : 'speeder', bounds: { min: [-2, -1, -4], max: [2, 1, 4] }, fly: ship ? { floor: 1, ceiling: 260, climb: 4 } : undefined },
    airborne: ship && x > 0,
    powered: true,
    landed: false,
    speed: ship ? 0 : 12,
    pos: group.position,
    altitude: ship ? y : 0,
    body: {
      linvel(): never {
        throw new Error('the air asked a body for its velocity');
      },
    },
  } as unknown as AirHull;
}
for (let i = 0; i < 3; i++) hulls.push(hull(-20 + i * 12, 10, false, 1.2));
hulls.push(hull(15, -10, true, 9));
hulls.push(hull(-15, -18, true, 7));

const tune = newVolTune();
tune.on = true;
const field = new AirField(renderer, tune, { ground, boxes: null, hulls });
field.forces.onGrains = null;
// Bound to a record of the ground variant's uniforms, as the world binds the field it takes: every frame then copies the
// field's own values into it (`copyAirGround`), which is measured with the rest.
field.bindGround(makeAirGroundUniforms());

// The dust pool, made with a stand-in page for its sprite, its grains falling onto the field's own raster.
const g = globalThis as unknown as { document?: unknown };
const ctx2d = { createRadialGradient: () => ({ addColorStop: noop }), fillRect: noop, fillStyle: '' };
g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
const dust = new Dust();
g.document = undefined;
const grainGround: GrainGround = { ox: 0, oz: 0, cell: 1.5, n: 0, height: new Float32Array(0), known: new Uint8Array(0), gravity: 9.8, rest: 0.4 };
const colour = new THREE.Color(0.8, 0.6, 0.4);

/** The frame's step: a constant, so the stand-in's own calls hand over no number made for them (the world's own call is today's). */
const DT = 1 / 144;
const inp = newAirFrameInput();
inp.dt = DT;
inp.reading = true;
// The ground wears the air's variant (the second wave): the carried offsets drawn every frame, the dents' square placed,
// the engines' pits and ruts gathered and laid on the 10 Hz tick, and a footstep pressed every so often.
inp.ground = true;
inp.windHeading = 0.6;
inp.windSpeed = 7;
inp.storm = 0.4;
inp.sunX = 0.4;
inp.sunY = 0.6;
inp.sunZ = 0.69;
const state = { frame: 0, camX: 0.25, camZ: -0.5, moved: 0, movingCalls: 0 };
// A foot landing, the feet's own kept record as `BodySounds` fills it: on the sand by the camera, its height the ground's.
const step: FootStep = { key: 7, kind: 'mobile', label: 'a walker', surface: 'sand', from: 'terrain', x: 2, y: 0, z: 1, heading: 0.3, scale: 1, inside: false, deck: null, ground: null };

function steady(): void {
  const f = state.frame++;
  inp.camX = state.camX;
  inp.camZ = state.camZ;
  inp.time += DT;
  // A blast and a push queued every frame (each a one-shot owed the next step), so their code runs as the frame's does.
  field.blast(5, 0, 5, 7, 14, 0);
  field.force(0, 0, 0, 1, 0, 1, 1, 16);
  // A footstep twice a second, walking: today's prints' rules, a dent pressed.
  if ((f & 63) === 0) {
    step.x = state.camX + ((f >> 6) & 7) * 0.5;
    step.z = state.camZ + 1;
    step.y = ((step.x | 0) >> 4) & 3;
    field.dentStep(step);
  }
  field.update(inp);
  // The world's half of the frame: the grains' ground handed over, grains thrown, the pool stepped.
  const w = field.win;
  grainGround.ox = w.ox;
  grainGround.oz = w.oz;
  grainGround.cell = w.cell;
  grainGround.n = field.raster.n;
  grainGround.height = field.raster.height;
  grainGround.known = field.raster.known;
  dust.ground = grainGround;
  dust.spawn(-10, 1, 0, 1, 12, 0, 2, colour, true);
  dust.update(DT);
}
function moving(): void {
  state.camX += 167 / 144;
  state.camZ += 0.3;
  steady();
  state.movingCalls++;
  if (field.win.moveX !== 0 || field.win.moveZ !== 0) state.moved++;
}

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
// The engine's own Math.random hands back a number made at every call (its builtin returns a boxed number), which the
// pool's spawns call a dozen times a mote, today's motes as much as the grains: that is the engine's cost and the pool's
// of today, not the pass's, so the measure stands a small generator in for it that the compiler builds into its caller,
// and what is measured is the pool's own arithmetic. (`part spawn` measures a spawn with the real one.)
if (process.argv[3] !== 'spawn') {
  let seed = 0x2545f491;
  Math.random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
}
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => {
  await tick();
  await tick();
};
function frames(step: () => void, n: number): void {
  for (let i = 0; i < n; i++) step();
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(frames);
} catch {
  // Without the flag the loop is left to the compiler.
}
async function measure(step: () => void, n: number): Promise<{ made: number; scavenges: number }> {
  frames(step, 50_000);
  let best = { made: Infinity, scavenges: Infinity };
  for (let attempt = 0; attempt < 3; attempt++) {
    gc!();
    await settle();
    frames(step, 20_000);
    gc!({ type: 'minor' });
    await settle();
    scavenges = 0;
    const before = young();
    frames(step, n);
    const made = young() - before;
    await settle();
    if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
    if (best.scavenges === 0 && best.made <= 0) break;
  }
  return best;
}

const FRAMES = 100_000;
if (process.argv[2] === 'part') {
  // One part of the frame alone, from the state real frames left: which part makes what.
  frames(steady, 20_000);
  const name = process.argv[3];
  const f = field as unknown as Record<string, () => void>;
  const call =
    name === 'steady'
      ? steady
      : name === 'moving'
      ? moving
      : name === 'update'
      ? () => field.update(inp)
      : name === 'dust'
        ? () => dust.update(DT)
        : name === 'engines'
          ? () => {
              field.forces.beginFrame();
              for (let i = 0; i < hulls.length; i++) hulls[i].group.updateWorldMatrix(true, false);
            }
          : name === 'batch'
            ? () => {
                field.forces.buildStepBatch(1 / 60);
                field.forces.buildDustBatch(1 / 144);
              }
            : name === 'run'
              ? () => f.runFrame()
              : () => undefined;
  if (process.argv[4] === 'profile') {
    // Where what it makes is made: the sampling heap profiler over the part, keeping what the minor collector took.
    const { Session } = await import('node:inspector/promises');
    const session = new Session();
    session.connect();
    await session.post('HeapProfiler.enable');
    await session.post('HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true });
    frames(call, 50_000);
    const { profile } = (await session.post('HeapProfiler.stopSampling')) as { profile: { head: ProfileNode } };
    type ProfileNode = { callFrame: { functionName: string; url: string; lineNumber: number }; selfSize: number; children: ProfileNode[] };
    const sites = new Map<string, number>();
    const walk = (n: ProfileNode, path: string): void => {
      const here = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
      if (n.selfSize > 0) sites.set(`${here} <- ${path}`, (sites.get(`${here} <- ${path}`) ?? 0) + n.selfSize);
      for (const c of n.children) walk(c, here);
    };
    walk(profile.head, '');
    for (const [k, v] of [...sites].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log((v / 50_000).toFixed(2), 'B a call', k);
    process.exit(0);
  }
  const p = await measure(call, 50_000);
  console.log(name, (p.made / 50_000).toFixed(2), 'B a call', p.scavenges, 'collections');
  process.exit(0);
}
if (process.argv[2] === 'off') {
  // The master off: the field holds no window, and every method of the force API answers before touching anything. A
  // million calls of each, from a field whose tune says off.
  const offTune = newVolTune();
  const off = new AirField(renderer, offTune, { ground, boxes: null, hulls });
  const offInp = newAirFrameInput();
  offInp.dt = DT;
  offInp.reading = true;
  off.update(offInp);
  const calls = {
    update: () => off.update(offInp),
    engine: () => off.forces.engine(1, 2, 3, 0, -1, 0, 40, 0, 0),
    force: () => off.force(1, 2, 3, 1, 0, 1, 1, 16),
    blast: () => off.blast(1, 2, 3, 7, 14, 0),
  };
  const out: Record<string, { made: number; scavenges: number }> = {};
  for (const [k, call] of Object.entries(calls)) out[k] = await measure(call, 1_000_000);
  console.log(JSON.stringify({ off: out, active: off.forces.active }));
  process.exit(0);
}
const s = await measure(steady, FRAMES);
const stepped = field.stepping;
const engines = field.forces.engineCount;
// The engines' pits and ruts held as continuous sources at the steady frame's end (the moving frames leave them behind).
const sources = field.dents?.slots ?? 0;
const MOVING = 50_000;
const resetsBefore = field.win.resets;
const m = await measure(moving, MOVING);
// The share of the moving frames whose window really moved a cell, and that none of them jumped.
const movedShare = state.moved / Math.max(1, state.movingCalls);
// The ground's marks really ran: what the dents counted (prints pressed, stamps laid, ticks faded) and the feet.
const dentCounts = { oneShots: 0, laid: 0, dropped: 0, slots: 0, noGive: 0, offSquare: 0, ticks: 0, cleared: 0 };
field.dents?.takeCounts(dentCounts);
console.log(JSON.stringify({ frames: FRAMES, made: s.made, scavenges: s.scavenges, stepping: stepped, engines, grains: dust.grainsFlying + dust.grainsLying, ground: { sources, dents: dentCounts, feet: { ...field.feetCounts } }, moving: { frames: MOVING, made: m.made, scavenges: m.scavenges, movedShare, resets: field.win.resets - resetsBefore } }));
