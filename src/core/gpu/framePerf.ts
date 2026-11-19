// The frame report on WebGPU (the GPU port's performance step, item 1): `__debug.gpu({ perf })`, the WebGPU side's own
// beside WebGL's `__debug.perf()`, which it reads for the main thread's time. On WebGPU alone: `start.ts` reaches it, and
// nothing of it is loaded on the WebGL path.
//
// Three windows over the frames of play that follow the call, one after another, each measuring what the others would
// disturb:
//   - **the main thread**: the frame report's own sections (`perf.ts`, the very rings `__debug.perf()` reads), and the
//     sun's cascades timed apart round each cascade's own `updateShadow` (on WebGPU three draws them inside the world pass,
//     so `worldPass` holds them; `worldLessShadows` is the rest);
//   - **the counts**: every WebGPU call that issues or switches anything (`setPipeline`, `setBindGroup`, the buffers, the
//     draws, the bundles, the writes with their bytes, the passes, the submits) counted on the API's own prototypes, and
//     three's own steps a render object takes (its lookup and its refresh, by kind), each wrapper put in for the window
//     alone and taken out after: a count is a count, so what a wrapper costs never reaches the timing window;
//   - **the card** (`gpu: true`): three's own timestamp queries over the render passes, each whole frame's passes summed
//     from the pool's per-pass timestamps (`completeCardFrames`: three's own answer is a set's last frame, often cut short),
//     the passes begun and timed counted beside them, each answer raced against a timeout (a headless tab answers about
//     one a second, and two measures at once lose one's answer for good); since pass 1's first wave each pass is named as
//     it begins (each sun cascade, the world pass, the rooms, the chain's passes: `sectionOfPass`) and summed by name, and
//     every read of three's timestamps goes through one adapter (`gpuTimer.ts`), which since pass 1's second wave times each
//     pass alone with three's `GPUTimer` and answers the passes timed since its last read-back (a set's ends are still
//     dropped, as a set begins and ends wherever the window's read-back falls).
// What switches the step has, and where each stands, is said beside the numbers (`switches`).

import { perf, PASS, PERF, PERF_TUNE } from '../perf.ts';
import { frameOfUid, type GpuPassTimer } from './gpuTimer.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface FramePerfOptions {
  /** Frames of play a window covers (120). */
  frames?: number;
  /** Time the card too, through three's timestamp queries (off: a headless tab answers about one a second). */
  gpu?: boolean;
  /** How many frames the card is timed over (20). */
  gpuFrames?: number;
  /** Leave out the counting window. */
  noCount?: boolean;
}

export interface FramePerfDeps {
  /** Frames the runtime has ended so far (`endFrame` calls). */
  ended(): number;
  /** The sun's cascades' own shadow nodes, or none (no world, or no cascades). */
  cascadeNodes(): Any[];
  /** The step's switches and where each stands. */
  switches(): Record<string, unknown>;
  /** The card's clock (`gpuTimer.ts`, pass 1's adapter over three's timestamp queries). */
  timer: GpuPassTimer;
}

/**
 * The name of the section a render pass belongs to (pass 1, wave 1, item 5), from what is being drawn as it begins: a sun
 * cascade by its shadow camera, any other shadow map as a lamp's, the effects chain's passes by their graph's name, and the
 * rest by the frame report's own pass kind (`perf.passBegin`, set while the report times).
 */
export function sectionOfPass(camera: unknown, scene: Any, cascades: Map<unknown, string>, pass: number): string {
  const c = camera ? cascades.get(camera) : undefined;
  if (c) return c;
  if (scene?.overrideMaterial?.isShadowPassMaterial === true) return 'lamp shadows';
  const name = String(scene?.name ?? '');
  if (scene?.userData?.gpuChain === true || name.startsWith('fx.gpu.')) {
    if (/ssao|gtao|normals|linearDepth|depthHalf/i.test(name)) return 'chain: ssao';
    if (/bloom/.test(name)) return 'chain: bloom';
    if (/grade/i.test(name)) return 'chain: colour grade';
    if (/output/.test(name)) return 'chain: output';
    if (/sanitize/.test(name)) return 'chain: sanitize';
    return `chain: ${name.replace(/^fx\.gpu\./, '') || '?'}`;
  }
  switch (pass) {
    case PASS.world:
      return 'world pass';
    case PASS.interior:
      return 'rooms';
    case PASS.doorways:
      return 'doorways';
    case PASS.weather:
      return 'weather';
    case PASS.post:
      return 'chain: other';
    case PASS.air:
      return 'air';
    default:
      return name ? `other: ${name}` : 'other';
  }
}

/**
 * Each whole frame's milliseconds by section: the passes of `timestamps` (uid to ms) summed by the name each was given as it
 * began (`names`), over the frames `whole` holds (`completeCardFrames`'s); passes never named are 'unnamed'.
 */
export function sectionSums(timestamps: Map<string, number>, names: Map<string, string>, whole: Set<string>): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const [uid, ms] of timestamps) {
    const f = frameOfUid(uid);
    if (f === null || !whole.has(f)) continue;
    let m = out.get(f);
    if (!m) out.set(f, (m = new Map()));
    const n = names.get(uid) ?? 'unnamed';
    m.set(n, (m.get(n) ?? 0) + ms);
  }
  return out;
}

/** The API calls counted, by name. */
const API = [
  ['GPURenderPassEncoder', ['setPipeline', 'setBindGroup', 'setVertexBuffer', 'setIndexBuffer', 'draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect', 'executeBundles', 'setStencilReference', 'setViewport', 'setScissorRect', 'end']],
  ['GPURenderBundleEncoder', ['setPipeline', 'setBindGroup', 'setVertexBuffer', 'setIndexBuffer', 'draw', 'drawIndexed', 'finish']],
  ['GPUQueue', ['writeBuffer', 'writeTexture', 'submit', 'copyExternalImageToTexture']],
  ['GPUCommandEncoder', ['beginRenderPass', 'beginComputePass', 'copyTextureToTexture', 'copyBufferToBuffer', 'finish']],
  ['GPUDevice', ['createBindGroup', 'createBuffer', 'createTexture', 'createRenderPipeline', 'createRenderPipelineAsync', 'createCommandEncoder', 'createRenderBundleEncoder']],
] as const;

/** The bytes a `writeBuffer` call carries: `size` is in the data's elements for a typed array and in bytes otherwise. */
export function writeBufferBytes(data: Any, dataOffset: Any, size: Any): number {
  if (!data) return 0;
  const per = typeof data.BYTES_PER_ELEMENT === 'number' ? data.BYTES_PER_ELEMENT : 1;
  if (typeof size === 'number') return size * per;
  const off = typeof dataOffset === 'number' ? dataOffset * per : 0;
  return Math.max(0, (data.byteLength ?? 0) - off);
}

/** The bytes a `writeTexture` call carries (the whole source past its offset). */
function writeTextureBytes(data: Any, layout: Any): number {
  if (!data) return 0;
  const off = layout && typeof layout.offset === 'number' ? layout.offset : 0;
  return Math.max(0, (data.byteLength ?? 0) - off);
}

interface Counts {
  calls: Map<string, number>;
  bufferBytes: number;
  bundleBufferBytes: number;
  textureBytes: number;
  bundlesExecuted: number;
  objects: number;
  refresh: [number, number, number];
  bundleReplays: number;
  renderScenes: number;
}

/** Each wrapper put on the API's prototypes and on three's instance for the counting window, and how to take it out. */
export function installCounters(renderer: Any): { counts: Counts; remove(): void } {
  const counts: Counts = { calls: new Map(), bufferBytes: 0, bundleBufferBytes: 0, textureBytes: 0, bundlesExecuted: 0, objects: 0, refresh: [0, 0, 0], bundleReplays: 0, renderScenes: 0 };
  const undo: (() => void)[] = [];
  const g = globalThis as Any;
  for (const [cls, names] of API) {
    const proto = g[cls]?.prototype;
    if (!proto) continue;
    for (const name of names) {
      const orig = proto[name];
      if (typeof orig !== 'function') continue;
      const key = `${cls}.${name}`;
      const wrapped = function (this: Any) {
        counts.calls.set(key, (counts.calls.get(key) ?? 0) + 1);
        // eslint-disable-next-line prefer-rest-params
        const a = arguments;
        if (key === 'GPUQueue.writeBuffer') counts.bufferBytes += writeBufferBytes(a[2], a[3], a[4]);
        else if (key === 'GPUQueue.writeTexture') counts.textureBytes += writeTextureBytes(a[1], a[2]);
        else if (key === 'GPURenderPassEncoder.executeBundles') counts.bundlesExecuted += a[0]?.length ?? 0;
        // eslint-disable-next-line prefer-rest-params
        return orig.apply(this, arguments as unknown as unknown[]);
      };
      proto[name] = wrapped;
      undo.push(() => {
        if (proto[name] === wrapped) proto[name] = orig;
      });
    }
  }
  // Three's own: every object handed to a pass (its lookup, refresh and draw), each refresh by kind, each bundle replayed
  // or recorded, and every render call. The renderer reads `_renderObjectDirect` off itself at each render call.
  const own = (obj: Any, name: string, make: (orig: Any) => Any): void => {
    if (!obj || typeof obj[name] !== 'function') return;
    const had = Object.prototype.hasOwnProperty.call(obj, name);
    const orig = obj[name];
    const w = make(orig);
    obj[name] = w;
    undo.push(() => {
      if (obj[name] !== w) return;
      if (had) obj[name] = orig;
      else delete obj[name];
    });
  };
  own(renderer, '_renderObjectDirect', (orig) =>
    function (this: Any) {
      counts.objects++;
      // eslint-disable-next-line prefer-rest-params
      return orig.apply(this, arguments as unknown as unknown[]);
    },
  );
  own(renderer._nodes, 'needsRefresh', (orig) =>
    function (this: Any, ro: Any) {
      const r = orig.call(this, ro);
      if (r === 0 || r === 1 || r === 2) counts.refresh[r]++;
      return r;
    },
  );
  own(renderer, '_renderBundle', (orig) =>
    function (this: Any) {
      counts.bundleReplays++;
      // eslint-disable-next-line prefer-rest-params
      return orig.apply(this, arguments as unknown as unknown[]);
    },
  );
  own(renderer, '_renderScene', (orig) =>
    function (this: Any) {
      counts.renderScenes++;
      // eslint-disable-next-line prefer-rest-params
      return orig.apply(this, arguments as unknown as unknown[]);
    },
  );
  return {
    counts,
    remove() {
      for (let i = undo.length - 1; i >= 0; i--) undo[i]();
    },
  };
}

const r2 = (v: number, p = 2): number => Number(v.toFixed(p));

/** Frames of play over which a window ran, waited for by the frame report's own counter (a fresh window). */
async function playFrames(frames: number): Promise<number> {
  perf.ensureFrames(frames);
  return perf.whenTimed(frames);
}

/** One frame's render passes as three's timestamp pool resolved them: its label, how many passes, and their sum (ms). */
export interface CardFrame {
  frame: string;
  passes: number;
  ms: number;
}

/**
 * The whole frames in one set of timestamps three's pool resolved (`WebGPUTimestampQueryPool.timestamps`, a pass's uid
 * `r:<call>:<context>:f<frame>` to its milliseconds, in the order the passes were begun). Three's own answer
 * (`resolveTimestampsAsync`) is the sum of the set's last frame, and a set begins and ends wherever the pool last started
 * over: at a resolve, or at its own overflow (2,048 queries, about thirty frames of the game's 34 passes), which falls in the
 * middle of a frame. So its last frame is often a frame's first few passes (about 0.9 ms of a 4.4 ms frame at Mos Eisley's
 * street), and only the frames strictly between a set's first and last are whole.
 */
export function completeCardFrames(timestamps: Map<string, number>): CardFrame[] {
  const order: string[] = [];
  const by = new Map<string, CardFrame>();
  for (const [uid, ms] of timestamps) {
    const m = /:f(\d+)$/.exec(uid);
    if (!m) continue;
    let f = by.get(m[1]);
    if (!f) {
      f = { frame: m[1], passes: 0, ms: 0 };
      by.set(m[1], f);
      order.push(m[1]);
    }
    f.passes++;
    f.ms += ms;
  }
  return order.slice(1, -1).map((k) => by.get(k)!);
}

/** Frames drawn between two of the card window's answers: a set then holds whole frames between its ends. */
const CARD_FRAMES_A_SET = 6;

/** A promise raced against a timeout: `null` when it does not answer in time. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export async function gpuFramePerf(renderer: Any, deps: FramePerfDeps, o: FramePerfOptions = {}): Promise<Record<string, unknown>> {
  const frames = Math.max(8, Math.floor(o.frames ?? 120));
  const wasOn = PERF.on;
  const wasFrames = PERF_TUNE.frames;
  const out: Record<string, unknown> = { renderer: 'WebGPU', frames };
  try {
    PERF_TUNE.frames = frames;
    // 1. The main thread: the frame report's sections, and the sun's cascades timed apart.
    const nodes = deps.cascadeNodes();
    let shadowMs = 0;
    let shadowDraws = 0;
    const kept: { n: Any; had: boolean; f: Any }[] = [];
    for (const n of nodes) {
      if (!n || typeof n.updateShadow !== 'function') continue;
      const f = n.updateShadow;
      const had = Object.prototype.hasOwnProperty.call(n, 'updateShadow');
      n.updateShadow = function (this: Any, frame: Any) {
        const t0 = performance.now();
        try {
          return f.call(this, frame);
        } finally {
          shadowMs += performance.now() - t0;
          shadowDraws++;
        }
      };
      kept.push({ n, had, f });
    }
    const timedFrom = deps.ended();
    let got = 0;
    try {
      got = await playFrames(frames);
    } finally {
      for (const k of kept) {
        if (k.had) k.n.updateShadow = k.f;
        else delete k.n.updateShadow;
      }
    }
    const endedTimed = Math.max(1, deps.ended() - timedFrom);
    const rep = perf.report(frames);
    const sec = (name: string) => rep.sections.find((s) => s.name === name) ?? null;
    const m = (name: string) => sec(name)?.mean ?? 0;
    const p95 = (name: string) => sec(name)?.p95 ?? 0;
    const sunMs = shadowMs / endedTimed;
    out.mainThread = {
      framesTimed: got,
      frame: rep.frame,
      fps: rep.fps,
      draw: { mean: m('draw'), p95: p95('draw') },
      portals: { mean: m('portals'), p95: p95('portals') },
      sceneWalk: m('sceneWalk'),
      worldPass: m('worldPass'),
      sunShadows: r2(sunMs, 3),
      worldLessShadows: r2(Math.max(0, m('worldPass') - sunMs), 3),
      interiors: m('interiors'),
      doorways: m('doorways'),
      post: m('post'),
      notDrawing: r2(Math.max(0, rep.frame.mean - m('draw')), 3),
      cascadesDrawn: r2(shadowDraws / endedTimed, 2),
      sections: rep.sections.filter((s) => s.mean >= 0.05).map((s) => `${'  '.repeat(s.depth)}${s.name} ${s.mean}/${s.p95}`),
    };
    // 2. The counts.
    if (!o.noCount) {
      const c = installCounters(renderer);
      const before = { draws: renderer.info.render.drawCalls, calls: renderer.info.render.calls, ended: deps.ended() };
      try {
        await playFrames(frames);
      } finally {
        c.remove();
      }
      const n = Math.max(1, deps.ended() - before.ended);
      const k = c.counts;
      const call = (key: string) => r2((k.calls.get(key) ?? 0) / n, 1);
      out.perFrame = {
        frames: n,
        renderCalls: r2((renderer.info.render.calls - before.calls) / n, 1),
        renderPasses: call('GPUCommandEncoder.beginRenderPass'),
        objectsHandled: r2(k.objects / n, 1),
        draws: r2((renderer.info.render.drawCalls - before.draws) / n, 1),
        refresh: { none: r2(k.refresh[0] / n, 1), shared: r2(k.refresh[1] / n, 1), full: r2(k.refresh[2] / n, 1) },
        pipelineSwitches: call('GPURenderPassEncoder.setPipeline'),
        bindGroupSwitches: call('GPURenderPassEncoder.setBindGroup'),
        vertexBufferSets: call('GPURenderPassEncoder.setVertexBuffer'),
        indexBufferSets: call('GPURenderPassEncoder.setIndexBuffer'),
        drawCommands: r2(((k.calls.get('GPURenderPassEncoder.draw') ?? 0) + (k.calls.get('GPURenderPassEncoder.drawIndexed') ?? 0)) / n, 1),
        bundles: {
          replayed: r2(k.bundleReplays / n, 1),
          executed: r2(k.bundlesExecuted / n, 1),
          recorded: call('GPURenderBundleEncoder.finish'),
          recordedDraws: r2(((k.calls.get('GPURenderBundleEncoder.draw') ?? 0) + (k.calls.get('GPURenderBundleEncoder.drawIndexed') ?? 0)) / n, 1),
        },
        bufferWrites: call('GPUQueue.writeBuffer'),
        bufferBytes: Math.round(k.bufferBytes / n),
        textureWrites: call('GPUQueue.writeTexture'),
        textureBytes: Math.round(k.textureBytes / n),
        textureCopies: call('GPUCommandEncoder.copyTextureToTexture'),
        submits: call('GPUQueue.submit'),
        commandEncoders: call('GPUDevice.createCommandEncoder'),
        made: { bindGroups: call('GPUDevice.createBindGroup'), buffers: call('GPUDevice.createBuffer'), textures: call('GPUDevice.createTexture'), pipelines: r2(((k.calls.get('GPUDevice.createRenderPipeline') ?? 0) + (k.calls.get('GPUDevice.createRenderPipelineAsync') ?? 0)) / n, 2) },
        stencilReferences: call('GPURenderPassEncoder.setStencilReference'),
      };
    }
    // 3. The card: every render pass of a whole frame summed from three's own per-pass timestamps (`completeCardFrames`),
    // never three's answer, which is the last frame of a set and often a frame's first few passes; and the passes begun a
    // frame against those given timestamp writes, so what is left untimed is said.
    if (o.gpu) {
      // Pass 1, wave 1, item 5: the card's clock behind its adapter (`gpuTimer.ts`), and each pass named as it begins.
      const timer = deps.timer;
      timer.start();
      PERF.on = true;
      const cascades = new Map<unknown, string>();
      deps.cascadeNodes().forEach((n, i) => {
        const cam = n?.shadow?.camera;
        if (cam) cascades.set(cam, `cascade ${i}`);
      });
      const names = new Map<string, string>();
      const sceneStack: Any[] = [];
      const ownScene = Object.prototype.hasOwnProperty.call(renderer, '_renderScene');
      const renderScene = renderer._renderScene;
      const sceneWrap = function (this: Any, scene: Any, ...rest: Any[]) {
        sceneStack.push(scene);
        try {
          return renderScene.call(this, scene, ...rest);
        } finally {
          sceneStack.pop();
        }
      };
      if (typeof renderScene === 'function') renderer._renderScene = sceneWrap;
      const unwatch = timer.watchPasses((uid, ctx) => {
        names.set(uid, sectionOfPass(ctx?.camera, sceneStack[sceneStack.length - 1], cascades, PERF.pass));
      });
      const sectionFrames: Map<string, number>[] = [];
      const want = Math.max(4, Math.floor(o.gpuFrames ?? 20));
      const frames: CardFrame[] = [];
      const seen = new Set<string>();
      let lost = 0;
      const enc = (globalThis as Any).GPUCommandEncoder?.prototype;
      const begin = enc?.beginRenderPass;
      let begun = 0;
      let timed = 0;
      const untimed = new Map<string, number>();
      const counting = typeof begin === 'function';
      if (counting) {
        enc.beginRenderPass = function (this: Any, d: Any) {
          begun++;
          if (d && d.timestampWrites) timed++;
          else {
            const k = String(d?.label ?? 'unlabelled');
            untimed.set(k, (untimed.get(k) ?? 0) + 1);
          }
          return begin.call(this, d);
        };
      }
      const countFrom = deps.ended();
      let countTo = countFrom;
      try {
        // The first answers carry the queries made before the timing was on, and the frames before the counting began.
        await new Promise((r) => requestAnimationFrame(r));
        await timer.resolve(4000);
        for (let i = 0; i < want * 4 && frames.length < want; i++) {
          // A few frames between answers, so a set holds frames between its ends (well under the pool's 2,048 queries).
          for (let k = 0; k < CARD_FRAMES_A_SET; k++) await new Promise((r) => requestAnimationFrame(r));
          const ts = await timer.resolve(4000);
          if (ts === null) {
            lost++;
            continue;
          }
          const fresh = new Set<string>();
          for (const f of completeCardFrames(ts)) {
            if (seen.has(f.frame) || !(f.ms > 0) || !Number.isFinite(f.ms)) continue;
            seen.add(f.frame);
            fresh.add(f.frame);
            frames.push(f);
          }
          for (const m of sectionSums(ts, names, fresh).values()) sectionFrames.push(m);
        }
      } finally {
        countTo = deps.ended();
        unwatch();
        timer.stop();
        if (renderer._renderScene === sceneWrap) {
          if (ownScene) renderer._renderScene = renderScene;
          else delete renderer._renderScene;
        }
        if (counting && enc.beginRenderPass !== begin) enc.beginRenderPass = begin;
      }
      // Each section's milliseconds a whole frame, the median over the frames timed (a frame without a section counts it 0).
      const sectionNames = new Set<string>();
      for (const m of sectionFrames) for (const k of m.keys()) sectionNames.add(k);
      const sections: Record<string, number> = {};
      for (const k of [...sectionNames].sort()) {
        const v = sectionFrames.map((m) => m.get(k) ?? 0).sort((a, b) => a - b);
        sections[k] = r2(v[v.length >> 1], 3);
      }
      const n = Math.max(1, countTo - countFrom);
      const ms = frames.map((f) => f.ms).sort((a, b) => a - b);
      const passes = frames.map((f) => f.passes).sort((a, b) => a - b);
      out.gpu = ms.length
        ? {
            renderMs: { n: ms.length, p50: r2(ms[ms.length >> 1], 3), p90: r2(ms[Math.floor(ms.length * 0.9)], 3) },
            sections,
            passesTimed: passes[passes.length >> 1],
            passesAFrame: counting ? { begun: r2(begun / n, 1), timed: r2(timed / n, 1), untimed: [...untimed].map(([k, v]) => `${k} ${r2(v / n, 1)}`) } : null,
            covers: 'every render pass three gives timestamp writes, summed over whole frames; WebGL\'s timer queries on ANGLE run from when a pass\'s first commands reach the card to when its last do, the main thread\'s issuing included, so the two are not one measure',
            sectionsAre: "each section's median milliseconds a whole frame: each sun cascade by its shadow camera, other shadow maps as the lamps', the world pass, the rooms, the doorways, the weather, and the effects chain's passes by their graph",
            ...(timer.coarse ? { coarse: timer.coarse } : {}),
            lost,
          }
        : { renderMs: null, lost, ...(timer.able ? {} : { why: 'this device was not granted timestamp queries' }), ...(timer.coarse ? { coarse: timer.coarse } : {}) };
    }
    out.switches = deps.switches();
    return out;
  } finally {
    PERF_TUNE.frames = wasFrames;
    PERF.on = wasOn;
  }
}
