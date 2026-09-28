// The frame report (`__debug.perf()`): where a frame's milliseconds go, what each pass drew, how
// many skeletons were worked out and uploaded, what streaming cost, and a registry of switches so
// any change can be put side by side with the behaviour before it in one session.
//
// Everything is on fixed ids and kept arrays. A section is a `performance.now()` pair on a number;
// a frame's sums are written into rings of `Float32Array` sized `PERF_TUNE.frames`; nothing is made
// on a frame, whether the timing is on or off. With the timing off every call returns at its first
// line, and only the frame's own time and the renderer's draw count go into the ring, which is what
// an A/B of the timing itself is measured with.
//
// Only frames of play are recorded. A frame the game did not simulate -- the Escape menu up, which is
// where anybody typing into the console is, a panel, the map, a loading screen, a death -- is drawn
// but not stepped, and measuring it would measure a paused game: it goes into nothing (not the ring,
// an A/B run, a flight's trace or the GPU sums) and is only counted, so every report can say how many
// it left out. A wait for a report counts frames of play recorded after it was asked for.
//
// The report is arithmetic in `perfMath.ts`; this file records.

import * as THREE from 'three';
import { abKeep, abLength, abSide, EMPTY_SPREAD, formatAb, formatReport, spreadOf, type AbReport, type AbSide, type PassRow, type PerfReport, type SectionRow, type Spread } from './perfMath.ts';

/** How many frames the report covers, the A/B block length, and whether each pass is timed on the GPU. */
export const PERF_TUNE = { frames: 120, block: 12, gpu: false };

/**
 * How long a wait for a report holds out, in ms, before it reports whatever it has: long enough for
 * somebody who has pasted a call into the console to go back to the game and click Resume.
 */
export const PERF_WAIT_MS = 120000;

// ---------------------------------------------------------------------------------------------
// Sections, in the order the report prints them, each under its parent.

const SECTION_DEFS = [
  { key: 'player', parent: '' },
  { key: 'vehicles', parent: '' },
  { key: 'net', parent: '' },
  { key: 'world', parent: '' },
  { key: 'stream', parent: 'world' },
  { key: 'farRefresh', parent: 'stream' },
  { key: 'streamFar', parent: 'world' },
  { key: 'layout', parent: 'world' },
  { key: 'particles', parent: 'world' },
  { key: 'sky', parent: 'world' },
  { key: 'living', parent: 'world' },
  { key: 'creatures', parent: 'living' },
  { key: 'mobiles', parent: 'living' },
  { key: 'people', parent: 'living' },
  { key: 'npcs', parent: 'living' },
  { key: 'ships', parent: 'living' },
  { key: 'ambience', parent: 'world' },
  { key: 'physics', parent: '' },
  { key: 'camera', parent: '' },
  { key: 'audio', parent: '' },
  { key: 'hud', parent: '' },
  { key: 'draw', parent: '' },
  { key: 'roomAir', parent: 'draw' },
  { key: 'portals', parent: 'draw' },
  { key: 'shadows', parent: 'portals' },
  { key: 'worldPass', parent: 'portals' },
  { key: 'interiors', parent: 'portals' },
  { key: 'doorways', parent: 'portals' },
  { key: 'weather', parent: 'draw' },
  { key: 'post', parent: 'draw' },
  { key: 'overlay', parent: '' },
] as const;

export type SectionKey = (typeof SECTION_DEFS)[number]['key'];
/** A section's fixed id, for `perf.begin(SEC.stream)`. */
export const SEC = Object.freeze(Object.fromEntries(SECTION_DEFS.map((d, i) => [d.key, i])) as Record<SectionKey, number>);
const NSEC = SECTION_DEFS.length;
const SECTION_DEPTH = SECTION_DEFS.map((d) => {
  let depth = 0;
  let p: string = d.parent;
  while (p) {
    depth++;
    p = SECTION_DEFS.find((x) => x.key === p)?.parent ?? '';
  }
  return depth;
});

// ---------------------------------------------------------------------------------------------
// Passes: what the renderer is drawing for, so every draw is counted against it.

/** A kind of pass, for `perf.passBegin(PASS.world)`. `other` is anything drawn outside those. */
export const PASS = Object.freeze({ shadows: 0, world: 1, interior: 2, doorways: 3, weather: 4, post: 5, other: 6 });
const PASS_NAMES = ['shadows', 'world', 'interior', 'doorways', 'weather', 'post', 'other'] as const;
const NPASS = PASS_NAMES.length;
const PASS_SECTION = [SEC.shadows, SEC.worldPass, SEC.interiors, SEC.doorways, SEC.weather, SEC.post, -1];
/** What is counted per pass kind. */
const PF = { draws: 0, skinned: 1, instanced: 2, instances: 3, triangles: 4, calls: 5 } as const;
const NPF = 6;

// ---------------------------------------------------------------------------------------------
// Counters. `mean` is reported as a mean per frame, `sum` as the total over the frames reported,
// `last` as the value of the last frame (a gauge). Later steps add their rows here.

const COUNTER_DEFS = [
  { key: 'skelLive', group: 'skeletons', label: 'live', kind: 'mean', scale: 1 },
  { key: 'skelUpdated', group: 'skeletons', label: 'updated', kind: 'mean', scale: 1 },
  { key: 'skelSkipped', group: 'skeletons', label: 'skipped', kind: 'mean', scale: 1 },
  { key: 'skelUploads', group: 'skeletons', label: 'uploads', kind: 'mean', scale: 1 },
  { key: 'skelBytes', group: 'skeletons', label: 'MB', kind: 'mean', scale: 1e-6 },
  { key: 'chunksMade', group: 'streaming', label: 'chunks made', kind: 'sum', scale: 1 },
  { key: 'chunksDropped', group: 'streaming', label: 'chunks dropped', kind: 'sum', scale: 1 },
  { key: 'farTiles', group: 'streaming', label: 'far tiles rebuilt', kind: 'sum', scale: 1 },
  { key: 'syncBlocks', group: 'streaming', label: 'sync blocks', kind: 'sum', scale: 1 },
  { key: 'programsPlay', group: 'streaming', label: 'programs in play', kind: 'sum', scale: 1 },
  { key: 'portalMaterials', group: 'scene', label: 'portal materials', kind: 'last', scale: 1 },
  { key: 'mobiles', group: 'scene', label: 'mobiles', kind: 'last', scale: 1 },
  // The portal renderer's visible set (step 1): the flood's room visits, the room meshes shown in the
  // views, the frames inside that drew no world at all, and the roots the exit narrowing left out.
  { key: 'cullVisits', group: 'cull', label: 'visits', kind: 'mean', scale: 1 },
  { key: 'cullRooms', group: 'cull', label: 'room meshes', kind: 'mean', scale: 1 },
  { key: 'cullSkips', group: 'cull', label: 'world skipped', kind: 'sum', scale: 1 },
  { key: 'cullNarrowed', group: 'cull', label: 'narrowed out', kind: 'mean', scale: 1 },
  // Step 2: what moves on its own routed by its room (the records, those hidden for the whole frame, those
  // no view pass drew), the furniture groups drawn with their rooms, and the creatures and people the
  // manager took off screen because their room was not seen last frame.
  { key: 'routeRecords', group: 'cull', label: 'bodies routed', kind: 'mean', scale: 1 },
  { key: 'routeHidden', group: 'cull', label: 'bodies hidden', kind: 'mean', scale: 1 },
  { key: 'routeUndrawn', group: 'cull', label: 'bodies in no pass', kind: 'mean', scale: 1 },
  { key: 'furnitureShown', group: 'cull', label: 'furniture groups shown', kind: 'mean', scale: 1 },
  { key: 'seenOff', group: 'cull', label: 'bodies off by room', kind: 'mean', scale: 1 },
  { key: 'strays', group: '', label: 'strays', kind: 'mean', scale: 1 },
  { key: 'caster0', group: '', label: 'caster0', kind: 'mean', scale: 1 },
  { key: 'caster1', group: '', label: 'caster1', kind: 'mean', scale: 1 },
  { key: 'caster2', group: '', label: 'caster2', kind: 'mean', scale: 1 },
  { key: 'caster3', group: '', label: 'caster3', kind: 'mean', scale: 1 },
] as const;

export type CounterKey = (typeof COUNTER_DEFS)[number]['key'];
/** A counter's fixed id, for `perf.count(CNT.chunksMade, n)`. */
export const CNT = Object.freeze(Object.fromEntries(COUNTER_DEFS.map((d, i) => [d.key, i])) as Record<CounterKey, number>);
const PASS_BASE = COUNTER_DEFS.length;
const NCOUNT = PASS_BASE + NPASS * NPF;
const CASTER_SLOTS = 4;

// ---------------------------------------------------------------------------------------------
// The record.

interface GpuState {
  gl: WebGL2RenderingContext | null;
  ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  free: WebGLQuery[];
  made: number;
  /** Queries waiting for an answer, oldest first, as a ring. */
  pendQ: (WebGLQuery | null)[];
  pendKind: Int8Array;
  pendLast: Uint8Array;
  pendHead: number;
  pendLen: number;
  active: WebGLQuery | null;
  activeKind: number;
  /** Queries this frame has put on the ring, so the frame's end can mark them kept or thrown away. */
  frameQ: number;
  /** GPU ms by pass kind, summed since the timer was turned on, and the frames whose queries have all answered. */
  sum: Float64Array;
  frames: number;
  dropped: number;
  /** Passes not timed because another timer query was open (the effects chain's own, `__debug.fxTiming`). */
  held: number;
}

interface Waiter {
  need: number;
  /** `PERF.recorded` when the wait was asked for: only frames after it count. */
  from: number;
  resolve: () => void;
}

/** One run in progress: an A/B comparison, or a trace (the flight). */
interface AbRun {
  kind: 'ab';
  key: string;
  sw: PerfSwitch;
  a: unknown;
  b: unknown;
  before: unknown;
  block: number;
  total: number;
  i: number;
  frame: [Float64Array, Float64Array];
  interval: [Float64Array, Float64Array];
  calls: [number, number];
  n: [number, number];
  draws: [Float64Array, Float64Array];
  timed: [number, number];
  /** Frames that went by paused while the run was going, in neither side. */
  paused: number;
  resolve: (r: AbReport) => void;
}

interface TraceRun {
  kind: 'trace';
  cap: number;
  n: number;
  paused: number;
  frame: Float64Array;
  interval: Float64Array;
  chunks: Float64Array;
  far: Float64Array;
  sync: Float64Array;
  programs: Float64Array;
  calls: Float64Array;
}

export const PERF = {
  /** Whether the sections, draws and counters are recorded. Off by default; `__debug.perf()` turns it on. */
  on: false,
  /** `on` as the frame now running saw it: latched at the frame's start so a frame is wholly timed or not at all. */
  timing: false,
  inFrame: false,
  cap: 0,
  head: 0,
  filled: 0,
  /** Timed frames in a row at the head of the ring. */
  timedStreak: 0,
  /** Every frame ever recorded into the ring: what a wait for a fresh window counts from. */
  recorded: 0,
  /** Whether the last frame to end was one of play. */
  played: true,
  /** Frames gone by paused since the last one recorded, written beside the next one recorded. */
  pausedSince: 0,
  frameStartAt: 0,
  lastStartAt: -1,
  interval: 0,
  pass: PASS.other as number,
  skelStamp: 1,
  // The frame now running.
  start: new Float64Array(NSEC),
  open: new Uint8Array(NSEC),
  t: new Float64Array(NSEC),
  c: new Float64Array(NCOUNT),
  casterCams: new Array<object | null>(CASTER_SLOTS).fill(null),
  // The rings, one slot per frame.
  ringT: new Float32Array(0),
  ringC: new Float32Array(0),
  ringFrame: new Float32Array(0),
  ringInterval: new Float32Array(0),
  ringCalls: new Float32Array(0),
  ringTimed: new Uint8Array(0),
  /** How many paused frames went by just before each slot's frame. */
  ringPaused: new Float32Array(0),
  scratch: new Float64Array(0),
  gpu: {
    gl: null,
    ext: null,
    free: [],
    made: 0,
    pendQ: new Array<WebGLQuery | null>(256).fill(null),
    pendKind: new Int8Array(256),
    pendLast: new Uint8Array(256),
    pendHead: 0,
    pendLen: 0,
    active: null,
    activeKind: -1,
    frameQ: 0,
    sum: new Float64Array(NPASS),
    frames: 0,
    dropped: 0,
    held: 0,
  } as GpuState,
  waiters: [] as Waiter[],
  run: null as AbRun | null,
  trace: null as TraceRun | null,
  /** Whether the skeleton hook is in; see `installPerfHooks`. */
  hooked: false,
};

function allocate(frames: number): void {
  const cap = Math.max(8, Math.floor(frames));
  PERF.cap = cap;
  PERF.ringT = new Float32Array(NSEC * cap);
  PERF.ringC = new Float32Array(NCOUNT * cap);
  PERF.ringFrame = new Float32Array(cap);
  PERF.ringInterval = new Float32Array(cap);
  PERF.ringCalls = new Float32Array(cap);
  PERF.ringTimed = new Uint8Array(cap);
  PERF.ringPaused = new Float32Array(cap);
  PERF.scratch = new Float64Array(cap);
  PERF.head = 0;
  PERF.filled = 0;
  PERF.timedStreak = 0;
}
allocate(PERF_TUNE.frames);

/**
 * Make the ring hold at least `frames` frames now, not at the next frame's start: a report asked for
 * over more frames than the ring holds would otherwise be answered from the old, shorter ring and
 * then have its history thrown away on the next frame. Asked from the console, between frames.
 */
function ensureFrames(frames: number): void {
  const n = Math.max(8, Math.floor(frames));
  if (n > PERF_TUNE.frames) PERF_TUNE.frames = n;
  if (PERF.cap !== Math.max(8, Math.floor(PERF_TUNE.frames))) allocate(PERF_TUNE.frames);
}

// ---------------------------------------------------------------------------------------------
// Switches: every change a later step makes is one of these, so `__debug.perf({ ab })` can put it
// beside the behaviour before it in the same session.

export interface PerfSwitch {
  get(): unknown;
  set(v: unknown): void;
  /** The values it takes, the old behaviour first. An A/B with no `a`/`b` compares the first two. */
  values: readonly unknown[];
  note?: string;
}

export const PERF_SWITCHES = new Map<string, PerfSwitch>();

export function registerPerfSwitch(name: string, sw: PerfSwitch): void {
  PERF_SWITCHES.set(name, sw);
}

registerPerfSwitch('perf', {
  get: () => PERF.on,
  set: (v) => {
    PERF.on = !!v;
    if (PERF.on) installSkeletonHook();
  },
  values: [false, true],
  note: 'the frame report itself: its sections, draw counts and skeleton hook',
});

// ---------------------------------------------------------------------------------------------
// The frame.

function sectionName(id: number): string {
  return SECTION_DEFS[id]?.key ?? String(id);
}

/** The frame begins: the running sums are emptied, the A/B run sets this frame's value, and the GPU's answers are read. */
function frameStart(now: number): void {
  if (PERF.cap !== Math.max(8, Math.floor(PERF_TUNE.frames))) allocate(PERF_TUNE.frames);
  PERF.interval = PERF.lastStartAt >= 0 ? now - PERF.lastStartAt : 0;
  PERF.lastStartAt = now;
  PERF.frameStartAt = now;
  const run = PERF.run;
  if (run) {
    const want = abSide(run.i, run.block) === 0 ? run.a : run.b;
    if (run.sw.get() !== want) run.sw.set(want);
  }
  PERF.timing = PERF.on;
  PERF.t.fill(0);
  PERF.c.fill(0);
  PERF.open.fill(0);
  PERF.casterCams.fill(null);
  PERF.pass = PASS.other;
  PERF.skelStamp++;
  PERF.inFrame = true;
  PERF.gpu.frameQ = 0;
  if (PERF.gpu.pendLen) pollGpu();
}

/**
 * The frame ends: its sums go into the ring. A section left open is a fault in the code that timed it,
 * and says so. `played` is whether the game was simulated this frame: a paused frame goes into nothing
 * and is only counted.
 */
function frameEnd(now: number, calls: number, played = true): void {
  if (!PERF.inFrame) return;
  PERF.inFrame = false;
  endGpuQuery();
  if (PERF.timing) {
    for (let i = 0; i < NSEC; i++) {
      if (PERF.open[i]) {
        PERF.open.fill(0);
        PERF.timedStreak = 0;
        closeGpuFrame(false);
        throw new Error(`perf: the section '${sectionName(i)}' was begun and never ended in this frame`);
      }
    }
  }
  closeGpuFrame(played);
  PERF.played = played;
  if (!played) {
    PERF.pausedSince++;
    if (PERF.run) PERF.run.paused++;
    if (PERF.trace) PERF.trace.paused++;
    return;
  }
  const frameMs = now - PERF.frameStartAt;
  const cap = PERF.cap;
  const slot = PERF.head;
  PERF.ringFrame[slot] = frameMs;
  PERF.ringInterval[slot] = PERF.interval;
  PERF.ringCalls[slot] = calls;
  PERF.ringTimed[slot] = PERF.timing ? 1 : 0;
  PERF.ringPaused[slot] = PERF.pausedSince;
  PERF.pausedSince = 0;
  if (PERF.timing) {
    const t = PERF.t;
    const rt = PERF.ringT;
    for (let i = 0; i < NSEC; i++) rt[i * cap + slot] = t[i];
    const c = PERF.c;
    const rc = PERF.ringC;
    for (let i = 0; i < NCOUNT; i++) rc[i * cap + slot] = c[i];
    PERF.timedStreak++;
  } else PERF.timedStreak = 0;
  PERF.head = (slot + 1) % cap;
  if (PERF.filled < cap) PERF.filled++;
  PERF.recorded++;
  const run = PERF.run;
  if (run) feedAb(run, frameMs, calls);
  const tr = PERF.trace;
  if (tr && tr.n < tr.cap) {
    const k = tr.n++;
    tr.frame[k] = frameMs;
    tr.interval[k] = PERF.interval;
    tr.calls[k] = calls;
    tr.chunks[k] = PERF.c[CNT.chunksMade] + PERF.c[CNT.chunksDropped];
    tr.far[k] = PERF.t[SEC.farRefresh];
    tr.sync[k] = PERF.c[CNT.syncBlocks];
    tr.programs[k] = PERF.c[CNT.programsPlay];
  }
  if (PERF.waiters.length) {
    for (let i = PERF.waiters.length - 1; i >= 0; i--) {
      const w = PERF.waiters[i];
      // The last `need` frames all timed, and all recorded after the wait was asked for.
      if (PERF.timedStreak >= w.need && PERF.recorded - w.from >= w.need) {
        PERF.waiters.splice(i, 1);
        w.resolve();
      }
    }
  }
}

/** A frame that threw: whatever it had begun is dropped, and nothing of it goes into the ring. */
function abandon(): void {
  PERF.inFrame = false;
  PERF.open.fill(0);
  PERF.pass = PASS.other;
  endGpuQuery();
  closeGpuFrame(false);
}

function begin(id: number): void {
  if (!PERF.timing) return;
  if (PERF.open[id]) throw new Error(`perf: the section '${sectionName(id)}' was begun twice`);
  PERF.open[id] = 1;
  PERF.start[id] = performance.now();
}

function end(id: number): void {
  if (!PERF.timing) return;
  if (!PERF.open[id]) throw new Error(`perf: the section '${sectionName(id)}' was ended without being begun`);
  PERF.open[id] = 0;
  PERF.t[id] += performance.now() - PERF.start[id];
}

function count(id: number, n: number): void {
  if (PERF.timing) PERF.c[id] += n;
}

function gauge(id: number, v: number): void {
  if (PERF.timing) PERF.c[id] = v;
}

/** What the renderer draws from here is counted against this kind of pass, and the pass's own section is timed. */
function passBegin(kind: number, gpu = true): void {
  if (!PERF.timing) return;
  PERF.pass = kind;
  PERF.c[PASS_BASE + kind * NPF + PF.calls]++;
  const s = PASS_SECTION[kind];
  if (s >= 0) begin(s);
  if (gpu && PERF_TUNE.gpu) beginGpuQuery(kind);
}

function passEnd(kind: number, triangles = 0): void {
  if (!PERF.timing) return;
  endGpuQuery();
  const s = PASS_SECTION[kind];
  if (s >= 0) end(s);
  PERF.c[PASS_BASE + kind * NPF + PF.triangles] += triangles;
  PERF.pass = PASS.other;
}

/**
 * One draw, from the renderer's own `renderBufferDirect` hook. `caster` is the light's camera when the
 * draw is a real shadow caster (three draws those with no scene), so each cascade is told apart by the
 * camera it is drawn through, in the order they are met.
 */
function draw(object: THREE.Object3D, caster: object | null): void {
  if (!PERF.timing) return;
  const c = PERF.c;
  const base = PASS_BASE + PERF.pass * NPF;
  c[base + PF.draws]++;
  if ((object as THREE.SkinnedMesh).isSkinnedMesh) c[base + PF.skinned]++;
  if ((object as THREE.InstancedMesh).isInstancedMesh) {
    c[base + PF.instanced]++;
    c[base + PF.instances] += (object as THREE.InstancedMesh).count | 0;
  }
  if (caster) {
    const cams = PERF.casterCams;
    let k = 0;
    while (k < CASTER_SLOTS - 1 && cams[k] !== null && cams[k] !== caster) k++;
    if (cams[k] === null) cams[k] = caster;
    c[CNT.caster0 + k]++;
  }
}

// ---------------------------------------------------------------------------------------------
// The skeletons: how many were worked out, how many were skipped (a later step), how many bone
// textures went up to the card and how many bytes that was.

function onBoneUpload(tex: THREE.Texture): void {
  if (!PERF.timing) return;
  PERF.c[CNT.skelUploads]++;
  const data = (tex.image as { data?: ArrayBufferView } | null)?.data;
  PERF.c[CNT.skelBytes] += data ? data.byteLength : 0;
}

type StampedSkeleton = THREE.Skeleton & { perfStamp?: number };

function skeletonUpdated(s: StampedSkeleton): void {
  const c = PERF.c;
  c[CNT.skelUpdated]++;
  if (s.perfStamp !== PERF.skelStamp) {
    s.perfStamp = PERF.skelStamp;
    c[CNT.skelLive]++;
  }
  const tex = s.boneTexture;
  if (tex && !tex.onUpdate) tex.onUpdate = onBoneUpload;
}

/**
 * Hook three's `Skeleton.update` once, to count. The hook checks the timing flag first, so with the
 * timing off it costs one test a call; it is put in only when the timing is first turned on.
 */
function installSkeletonHook(): void {
  if (PERF.hooked) return;
  PERF.hooked = true;
  const proto = THREE.Skeleton.prototype as THREE.Skeleton & { perfHooked?: boolean };
  if (proto.perfHooked) return;
  proto.perfHooked = true;
  const original = proto.update;
  proto.update = function update(this: THREE.Skeleton): void {
    original.call(this);
    if (PERF.timing) skeletonUpdated(this as StampedSkeleton);
  };
}

// ---------------------------------------------------------------------------------------------
// The GPU timer (`EXT_disjoint_timer_query_webgl2`), one query per pass and never two at once.

/** Give the report the renderer's context, which the GPU timer needs. */
function attach(gl: WebGL2RenderingContext | null): void {
  PERF.gpu.gl = gl;
  PERF.gpu.ext = null;
}

function gpuReady(): boolean {
  const g = PERF.gpu;
  if (!g.gl) return false;
  if (!g.ext) g.ext = g.gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuState['ext'];
  return !!g.ext;
}

function beginGpuQuery(kind: number): void {
  const g = PERF.gpu;
  if (g.active || !gpuReady() || g.pendLen >= g.pendQ.length) return;
  const gl = g.gl as WebGL2RenderingContext;
  const ext = g.ext as NonNullable<GpuState['ext']>;
  // Two timer queries can never be open at once, and another timer may hold one across this pass
  // (the effects chain's own, `__debug.fxTiming`, times the whole scene): a begin now would fail,
  // and the end after it would close that timer's query instead. So the pass goes untimed, counted.
  if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) !== null) {
    g.held++;
    return;
  }
  let q = g.free.pop() ?? null;
  if (!q) {
    if (g.made >= g.pendQ.length) return;
    q = gl.createQuery();
    if (!q) return;
    g.made++;
  }
  gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
  g.active = q;
  g.activeKind = kind;
}

function endGpuQuery(): void {
  const g = PERF.gpu;
  if (!g.active) return;
  const gl = g.gl as WebGL2RenderingContext;
  gl.endQuery((g.ext as NonNullable<GpuState['ext']>).TIME_ELAPSED_EXT);
  const at = (g.pendHead + g.pendLen) % g.pendQ.length;
  g.pendQ[at] = g.active;
  g.pendKind[at] = g.activeKind;
  g.pendLast[at] = 0;
  g.pendLen++;
  g.frameQ++;
  g.active = null;
  g.activeKind = -1;
}

/**
 * The frame's queries are all on the ring: kept, the last of them marks the frame's end (so the
 * frames whose times have all answered can be counted); not kept -- a paused frame, or one that
 * threw -- they are still read off in turn, but summed into nothing.
 */
function closeGpuFrame(keep: boolean): void {
  const g = PERF.gpu;
  const n = g.frameQ;
  g.frameQ = 0;
  if (!n) return;
  const len = g.pendQ.length;
  for (let k = 1; k <= n && k <= g.pendLen; k++) {
    const at = (g.pendHead + g.pendLen - k + len) % len;
    if (!keep) g.pendKind[at] = -1;
    g.pendLast[at] = 0;
  }
  if (keep) g.pendLast[(g.pendHead + g.pendLen - 1 + len) % len] = 1;
}

function pollGpu(): void {
  const g = PERF.gpu;
  const gl = g.gl;
  if (!gl || !g.ext) return;
  const disjoint = !!gl.getParameter(g.ext.GPU_DISJOINT_EXT);
  while (g.pendLen) {
    const q = g.pendQ[g.pendHead] as WebGLQuery;
    const available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) as boolean | null;
    // Not yet: the queries answer in order, so nothing after this one has either.
    if (available === false) break;
    const kind = g.pendKind[g.pendHead];
    // Anything but a yes is a query the driver does not know as begun: dropped, never waited on for ever.
    if (available !== true || disjoint) {
      if (kind >= 0) g.dropped++;
    } else if (kind >= 0) {
      g.sum[kind] += (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
      if (g.pendLast[g.pendHead]) g.frames++;
    }
    g.pendQ[g.pendHead] = null;
    g.free.push(q);
    g.pendHead = (g.pendHead + 1) % g.pendQ.length;
    g.pendLen--;
  }
}

/** Start the GPU sums afresh: whatever is still waiting for an answer belongs to frames before, and is read off into nothing. */
function resetGpu(): void {
  const g = PERF.gpu;
  g.sum.fill(0);
  g.frames = 0;
  g.dropped = 0;
  g.held = 0;
  const len = g.pendQ.length;
  for (let k = 0; k < g.pendLen; k++) {
    const at = (g.pendHead + k) % len;
    g.pendKind[at] = -1;
    g.pendLast[at] = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// The report.

/** The ring's slots of the last `n` frames, newest first, keeping only timed ones when `timed`. */
function lastSlots(n: number, timed: boolean): number[] {
  const out: number[] = [];
  const cap = PERF.cap;
  for (let k = 1; k <= PERF.filled && out.length < n; k++) {
    const slot = (PERF.head - k + cap) % cap;
    if (timed && !PERF.ringTimed[slot]) break;
    out.push(slot);
  }
  return out;
}

function spreadAt(ring: Float32Array, row: number, slots: number[]): Spread {
  const src = new Float64Array(slots.length);
  for (let i = 0; i < slots.length; i++) src[i] = ring[row * PERF.cap + slots[i]];
  return slots.length ? spreadOf(src, slots.length) : { ...EMPTY_SPREAD };
}

function meanAt(ring: Float32Array, row: number, slots: number[]): number {
  if (!slots.length) return 0;
  let s = 0;
  for (const slot of slots) s += ring[row * PERF.cap + slot];
  return s / slots.length;
}

function round(v: number, places = 2): number {
  const k = 10 ** places;
  return Math.round(v * k) / k;
}

/** The report over the last `frames` frames of play: timed ones when the timing is on, all of them when it is off. */
function report(frames = PERF_TUNE.frames): PerfReport {
  const timed = PERF.on && PERF.timedStreak > 0;
  const slots = lastSlots(frames, timed);
  const n = slots.length;
  const frameS = new Float64Array(n);
  const intervalS = new Float64Array(n);
  let calls = 0;
  // The paused frames between the ones reported (those before the oldest are not in its window).
  let paused = 0;
  for (let i = 0; i < n; i++) {
    frameS[i] = PERF.ringFrame[slots[i]];
    intervalS[i] = PERF.ringInterval[slots[i]];
    calls += PERF.ringCalls[slots[i]];
    if (i < n - 1) paused += PERF.ringPaused[slots[i]];
  }
  const frame = spreadOf(frameS, n);
  const interval = spreadOf(intervalS, n);
  const notes: string[] = [];
  const sections: SectionRow[] = [];
  const passes: PassRow[] = [];
  const groups: Record<string, Record<string, number>> = {};
  let casters: number[] = [];
  let strays = 0;
  if (timed) {
    for (let i = 0; i < NSEC; i++) {
      const s = spreadAt(PERF.ringT, i, slots);
      if (s.max <= 0) continue;
      sections.push({ name: SECTION_DEFS[i].key, depth: SECTION_DEPTH[i], mean: round(s.mean, 3), p50: round(s.p50, 3), p95: round(s.p95, 3), max: round(s.max, 3) });
    }
    const g = PERF.gpu;
    for (let k = 0; k < NPASS; k++) {
      const base = PASS_BASE + k * NPF;
      const row: PassRow = {
        name: PASS_NAMES[k],
        ms: PASS_SECTION[k] >= 0 ? round(meanAt(PERF.ringT, PASS_SECTION[k], slots), 3) : 0,
        gpuMs: PERF_TUNE.gpu && g.frames > 0 ? round(g.sum[k] / g.frames, 3) : null,
        calls: round(meanAt(PERF.ringC, base + PF.calls, slots)),
        draws: round(meanAt(PERF.ringC, base + PF.draws, slots), 1),
        skinned: round(meanAt(PERF.ringC, base + PF.skinned, slots), 1),
        instanced: round(meanAt(PERF.ringC, base + PF.instanced, slots), 1),
        instances: round(meanAt(PERF.ringC, base + PF.instances, slots), 1),
        triangles: Math.round(meanAt(PERF.ringC, base + PF.triangles, slots)),
      };
      if (row.draws > 0 || row.calls > 0) passes.push(row);
    }
    for (let k = 0; k < CASTER_SLOTS; k++) {
      const v = meanAt(PERF.ringC, CNT.caster0 + k, slots);
      if (v > 0) casters.push(round(v, 1));
    }
    strays = round(meanAt(PERF.ringC, CNT.strays, slots), 1);
    for (let i = 0; i < COUNTER_DEFS.length; i++) {
      const d = COUNTER_DEFS[i];
      if (!d.group) continue;
      let v = 0;
      if (d.kind === 'last') v = n ? PERF.ringC[i * PERF.cap + slots[0]] : 0;
      else if (d.kind === 'sum') v = meanAt(PERF.ringC, i, slots) * n;
      else v = meanAt(PERF.ringC, i, slots);
      (groups[d.group] ??= {})[d.label] = round(v * d.scale, d.scale < 1 ? 3 : 2);
    }
    // The frames that made or dropped a terrain chunk, and what they cost against the rest.
    const chunky: number[] = [];
    const plain: number[] = [];
    for (let i = 0; i < n; i++) {
      const slot = slots[i];
      const moved = PERF.ringC[CNT.chunksMade * PERF.cap + slot] + PERF.ringC[CNT.chunksDropped * PERF.cap + slot];
      (moved > 0 ? chunky : plain).push(i);
    }
    const st = (groups.streaming ??= {});
    st['chunk frames'] = chunky.length;
    if (chunky.length) {
      const cf = spreadOf(
        chunky.map((i) => frameS[i]),
        chunky.length,
      );
      st['chunk p95 ms'] = round(cf.p95, 1);
      st['chunk max ms'] = round(cf.max, 1);
      const far = spreadOf(
        chunky.map((i) => PERF.ringT[SEC.farRefresh * PERF.cap + slots[i]]),
        chunky.length,
      );
      st['far refresh max ms'] = round(far.max, 1);
    }
    if (PERF_TUNE.gpu && !g.frames) notes.push(g.gl ? (gpuReady() ? 'the GPU timer has not answered yet' : 'this browser has no GPU timer') : 'no renderer attached for the GPU timer');
    if (g.dropped) notes.push(`${g.dropped} GPU timings were thrown away (disjoint, or never begun)`);
    if (PERF_TUNE.gpu && g.held) notes.push(`${g.held} passes were not timed on the GPU because another timer was running (\`__debug.fxTiming(false)\` stops the effects chain's own)`);
  } else notes.push('timing is off: only the frame times and draw calls were recorded. `await __debug.perf()` turns it on');
  if (n < frames) notes.push(`only ${n} of ${frames} frames were there to report`);
  if (paused) notes.push(`${paused} frames in between went by paused (the Escape menu, a panel, the map, a loading screen or a death) and are left out`);
  const switches: Record<string, unknown> = {};
  for (const [k, sw] of PERF_SWITCHES) switches[k] = sw.get();
  return {
    frames: n,
    paused,
    timed,
    frame: roundSpread(frame),
    interval: roundSpread(interval),
    fps: interval.p50 > 0 ? round(1000 / interval.p50, 1) : 0,
    calls: n ? Math.round(calls / n) : 0,
    sections,
    passes,
    shadow: { casters, strays },
    groups,
    switches,
    notes,
  };
}

function roundSpread(s: Spread): Spread {
  return { n: s.n, p50: round(s.p50), p95: round(s.p95), max: round(s.max), mean: round(s.mean) };
}

/**
 * Resolve once `frames` timed frames of play have been recorded since this was asked (turning the
 * timing on first), or after `ms` with whatever there is: a driven tab with no frames, or a game left
 * paused, would otherwise wait for ever. Always a fresh window, never frames from before the call --
 * those may be from anywhere the player walked. Answers how many fresh timed frames there were,
 * `frames` when the wait was met; the ring must already hold `frames` (`ensureFrames`).
 */
function whenTimed(frames: number, ms = PERF_WAIT_MS): Promise<number> {
  if (!PERF.on) {
    PERF.on = true;
    installSkeletonHook();
  }
  const from = PERF.recorded;
  const fresh = () => Math.min(PERF.timedStreak, PERF.recorded - from);
  return new Promise<number>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const w: Waiter = {
      need: frames,
      from,
      resolve: () => {
        if (done) return;
        done = true;
        if (timer !== null) clearTimeout(timer);
        resolve(fresh());
      },
    };
    PERF.waiters.push(w);
    timer = setTimeout(() => {
      timer = null;
      const i = PERF.waiters.indexOf(w);
      if (i >= 0) PERF.waiters.splice(i, 1);
      w.resolve();
    }, ms);
  });
}

// ---------------------------------------------------------------------------------------------
// The A/B run.

function newSide(frames: number): Float64Array {
  return new Float64Array(Math.max(1, frames));
}

/**
 * Alternate a switch between two values in blocks of `block` frames, throwing away the first block
 * after each flip, and report each side. The switch is put back as it was at the end.
 */
function ab(key: string, a: unknown, b: unknown, frames: number, block = PERF_TUNE.block): Promise<AbReport> {
  const sw = PERF_SWITCHES.get(key);
  if (!sw) return Promise.reject(new Error(`perf: no switch named '${key}' (there are: ${[...PERF_SWITCHES.keys()].join(', ')})`));
  if (PERF.run) return Promise.reject(new Error(`perf: an A/B run of '${PERF.run.key}' is still going`));
  const bl = Math.max(1, Math.floor(block));
  const total = abLength(frames, bl);
  const perSide = total / 4;
  return new Promise<AbReport>((resolve) => {
    PERF.run = {
      kind: 'ab',
      key,
      sw,
      a,
      b,
      before: sw.get(),
      block: bl,
      total,
      i: 0,
      frame: [newSide(perSide), newSide(perSide)],
      interval: [newSide(perSide), newSide(perSide)],
      calls: [0, 0],
      n: [0, 0],
      draws: [new Float64Array(NPASS), new Float64Array(NPASS)],
      timed: [0, 0],
      paused: 0,
      resolve,
    };
  });
}

function feedAb(run: AbRun, frameMs: number, calls: number): void {
  const i = run.i++;
  if (abKeep(i, run.block)) {
    const side = abSide(i, run.block);
    const k = run.n[side];
    if (k < run.frame[side].length) {
      run.frame[side][k] = frameMs;
      run.interval[side][k] = PERF.interval;
      run.n[side] = k + 1;
      run.calls[side] += calls;
      if (PERF.timing) {
        run.timed[side]++;
        for (let p = 0; p < NPASS; p++) run.draws[side][p] += PERF.c[PASS_BASE + p * NPF + PF.draws];
      }
    }
  }
  if (run.i >= run.total) finishAb(run);
}

function sideOf(run: AbRun, side: 0 | 1): AbSide {
  const n = run.n[side];
  const draws: Record<string, number> = {};
  if (run.timed[side]) for (let p = 0; p < NPASS; p++) if (run.draws[side][p] > 0) draws[PASS_NAMES[p]] = round(run.draws[side][p] / run.timed[side], 1);
  return {
    value: side === 0 ? run.a : run.b,
    frames: n,
    frame: roundSpread(spreadOf(run.frame[side], n)),
    interval: roundSpread(spreadOf(run.interval[side], n)),
    calls: n ? Math.round(run.calls[side] / n) : 0,
    draws,
  };
}

function finishAb(run: AbRun, why = ''): AbReport {
  PERF.run = null;
  if (run.sw.get() !== run.before) run.sw.set(run.before);
  const a = sideOf(run, 0);
  const b = sideOf(run, 1);
  const notes: string[] = [];
  if (why) notes.push(why);
  if (!run.timed[0] && !run.timed[1]) notes.push('timing was off, so there are no draw counts by pass; `await __debug.perf()` first turns it on');
  if (run.paused) notes.push(`${run.paused} frames went by paused (the Escape menu, a panel, the map, a loading screen or a death) and are in neither side`);
  const r: AbReport = { key: run.key, block: run.block, ran: run.i, a, b, delta: { p50: round(b.frame.p50 - a.frame.p50), p95: round(b.frame.p95 - a.frame.p95), mean: round(b.frame.mean - a.frame.mean) }, notes };
  run.resolve(r);
  return r;
}

/** Stop an A/B run now, reporting what it had. */
function cancelAb(): AbReport | null {
  return PERF.run ? finishAb(PERF.run, 'stopped before the end') : null;
}

// ---------------------------------------------------------------------------------------------
// The trace: every frame of a flight, kept whole, for what the streaming costs as it happens.

function traceStart(maxFrames: number): void {
  const cap = Math.max(1, Math.floor(maxFrames));
  PERF.trace = { kind: 'trace', cap, n: 0, paused: 0, frame: new Float64Array(cap), interval: new Float64Array(cap), chunks: new Float64Array(cap), far: new Float64Array(cap), sync: new Float64Array(cap), programs: new Float64Array(cap), calls: new Float64Array(cap) };
}

export interface TraceReport {
  frames: number;
  /** Frames that went by paused while the trace ran, and are not in it. */
  paused: number;
  frame: Spread;
  interval: Spread;
  /** Frames that made or dropped a terrain chunk, and what they cost. */
  chunkFrames: number;
  chunkFrame: Spread;
  otherFrame: Spread;
  /** The far tiles' refresh on the chunk frames. */
  farRefresh: Spread;
  syncBlocks: number;
  syncBlocksPerFrame: number;
  programsBuilt: number;
  calls: number;
}

function traceEnd(): TraceReport | null {
  const t = PERF.trace;
  PERF.trace = null;
  if (!t) return null;
  const n = t.n;
  const chunky: number[] = [];
  const other: number[] = [];
  let sync = 0;
  let programs = 0;
  let calls = 0;
  for (let i = 0; i < n; i++) {
    (t.chunks[i] > 0 ? chunky : other).push(i);
    sync += t.sync[i];
    programs += t.programs[i];
    calls += t.calls[i];
  }
  const pick = (src: Float64Array, idx: number[]) => roundSpread(spreadOf(Float64Array.from(idx, (i) => src[i]), idx.length));
  return {
    frames: n,
    paused: t.paused,
    frame: roundSpread(spreadOf(t.frame, n)),
    interval: roundSpread(spreadOf(t.interval, n)),
    chunkFrames: chunky.length,
    chunkFrame: pick(t.frame, chunky),
    otherFrame: pick(t.frame, other),
    farRefresh: pick(t.far, chunky),
    syncBlocks: sync,
    syncBlocksPerFrame: n ? round(sync / n, 2) : 0,
    programsBuilt: programs,
    calls: n ? Math.round(calls / n) : 0,
  };
}

// ---------------------------------------------------------------------------------------------
// The census: the scene walked once.

export interface Census {
  nodes: number;
  visibleMeshes: number;
  instancedMeshes: number;
  instances: number;
  skinnedMeshes: number;
  skeletons: number;
  casters: number;
  lights: number;
  materials: number;
  /** Visible meshes on the actor layer (drawn in every pass) and on the rooms' layer. */
  onActorLayer: number;
  onInteriorLayer: number;
}

/** Walk the scene once: what is in it, and what of it can be drawn (every ancestor visible). */
export function censusOf(scene: THREE.Object3D, actorLayer = 31, interiorLayer = 1): Census {
  const out: Census = { nodes: 0, visibleMeshes: 0, instancedMeshes: 0, instances: 0, skinnedMeshes: 0, skeletons: 0, casters: 0, lights: 0, materials: 0, onActorLayer: 0, onInteriorLayer: 0 };
  const materials = new Set<THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>();
  const walk = (o: THREE.Object3D, shown: boolean): void => {
    out.nodes++;
    const on = shown && o.visible;
    if (on && (o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      out.visibleMeshes++;
      if ((m as THREE.InstancedMesh).isInstancedMesh) {
        out.instancedMeshes++;
        out.instances += (m as THREE.InstancedMesh).count;
      }
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
        out.skinnedMeshes++;
        skeletons.add((m as THREE.SkinnedMesh).skeleton);
      }
      if (m.castShadow) out.casters++;
      if (m.layers.isEnabled(actorLayer)) out.onActorLayer++;
      if (m.layers.isEnabled(interiorLayer)) out.onInteriorLayer++;
      const mat = m.material;
      if (Array.isArray(mat)) for (const x of mat) materials.add(x);
      else if (mat) materials.add(mat);
    }
    if (on && (o as THREE.Light).isLight) out.lights++;
    for (const c of o.children) walk(c, on);
  };
  walk(scene, true);
  out.materials = materials.size;
  out.skeletons = skeletons.size;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Marks: a place and a view saved by name, so the same spot can be measured after every commit.

export interface PerfMark {
  planet: string;
  zone: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Where the wheel had asked the camera to be: under the first-person distance it is first person. */
  zoom: number;
  /** The room stood in (0 outdoors), so a mark in a room whose box overhangs another's comes back to the same one. Absent on older marks. */
  cell?: number;
  saved: string;
}

const MARKS_KEY = 'swg.perfMarks';

export function readMarks(): Record<string, PerfMark> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(MARKS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, PerfMark> = Object.create(null);
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const m = v as Partial<PerfMark>;
      const whole = !!m && typeof m.planet === 'string' && [m.x, m.y, m.z, m.yaw, m.pitch, m.zoom].every((n) => typeof n === 'number' && Number.isFinite(n));
      if (whole && (m.cell === undefined || (typeof m.cell === 'number' && Number.isInteger(m.cell) && m.cell >= 0))) out[k] = m as PerfMark;
    }
    return out;
  } catch {
    return {};
  }
}

/** Save a mark; false when the browser keeps nothing (a private window, blocked storage). */
export function writeMark(name: string, mark: PerfMark): boolean {
  try {
    const all = readMarks();
    all[name] = mark;
    localStorage.setItem(MARKS_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------

/** The recording's calls, on the fixed ids above. */
export const perf = {
  begin,
  end,
  count,
  gauge,
  passBegin,
  passEnd,
  draw,
  frameStart,
  frameEnd,
  abandon,
  attach,
  report,
  ensureFrames,
  whenTimed,
  ab,
  cancelAb,
  traceStart,
  traceEnd,
  resetGpu,
  installSkeletonHook,
  format: formatReport,
  formatAb,
};
