// Every render pipeline three makes on WebGPU, as it is asked for and as it lands (the GPU port's pass 1, wave 1, items 1, 2
// and 4): the ledger the key census (`__debug.gpu({ keys: true })`, `keyCensus.ts`) and the landing log
// (`__debug.gpu({ landing: true })`) read. On WebGPU alone: `start.ts` installs it, and nothing of it is loaded on the WebGL
// path.
//
// One wrap of three's private `WebGPUBackend.createRenderPipeline` (the warm patch wraps it too, for its own counts; this one
// stands whether or not that patch applied). Each pipeline made is one record: three's own cache key for it (the string three
// keeps the pipeline under), when it was asked for and when it landed (a draw's is made while the main thread waits, so it
// lands as it is asked; one asked ahead lands when three's promise for it answers), its material and the first object that
// asked for it, its pass, who asked (the warm-up behind the select screen, a loading screen, the world's queue in play, a
// draw, a console self-test), the arrival it was asked in, and the parts of three's key read off the render object as it was
// made (`KeyFields`), which the census compares.
//
// Bounded: a ring of `LEDGER_CAP` records, the oldest let go, and sixteen arrivals. Nothing is made at a frame that makes no
// pipeline: the frame's one call (`ledgerFrame`) compares the travel's flag and stores two values, reading the clock only as
// an arrival begins or its screen goes; the warm-up's queue is read thirty seconds into each arrival on a timer of its own.

import { isPooledRO } from './bonePool.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Records kept: about seven arrivals' worth at Mos Eisley (about 650 each). */
export const LEDGER_CAP = 4096;
/** Arrivals kept. */
export const ARRIVALS_CAP = 16;
/**
 * When after an arrival begins the landing log says what is still pending: the brief's 30 s. A diagnostic's moment, not a
 * number of feel; a node test moves it.
 */
export const LANDING_TUNE = { pendingAtMs: 30000 };
/** Names of the warm-up's queued items kept at that moment. */
export const PENDING_NAMES = 24;

/** Who asked for a pipeline. */
export const WHERE = ['warm-up', 'loading screen', "the world's queue", 'a draw', 'self-test', "three's compileAsync"] as const;
export type Where = (typeof WHERE)[number];

/**
 * The parts of three 0.187's key for a render object, read as its pipeline was made. A pipeline is three's
 * `vertexProgram.id,fragmentProgram.id,` + `WebGPUBackend.getRenderCacheKey` (the draw state), and a program is the text
 * three's node builder wrote for the render object's key (`RenderObject.getCacheKey`: the material's own key, its
 * properties, the clipping, the geometry's attributes and morph targets, the bone count, the instancing, the render
 * context's state, whether it receives shadows, and the environment's key: lights, shadows, environment and fog).
 */
export interface KeyFields {
  /** The bone count three writes into a skinned body's program (its bone matrix array's length); 0 for none; -1 for a body skinned from the bone pool (pass 1, wave 4), keyed "pooled". */
  bones: number;
  /** The morph targets: count and a hash of the morph attributes' ids (three keys a program on each morph attribute's id, and writes the morph texture's width into it). '' for none. */
  morph: string;
  /** The vertex attributes as three keys them (name, size, normalised, interleaved, array kind). */
  attrs: string;
  /** Instanced (`I`), batched (`B`) or a counted mesh (`C`); '' for none. */
  inst: string;
  /** Whether it receives shadows. */
  recv: boolean;
  /** The lights' key (`lightsNode.getCacheKey(true)`), 0 in a shadow pass. */
  lights: number;
  /** The environment key three checks every draw (`getDynamicCacheKey`: lights, shadows, environment, fog, the context node). */
  env: number;
  /** The render context's outputs: its MRT's names and its state key. */
  outputs: string;
  /** The clipping context's key. */
  clip: string;
  /** The material's own program key (`customProgramCacheKey`: a node material's graph), hashed. */
  custom: number;
  /** Every material property three keys a program on, as three reduces it (`name=value;`), the draw state's left out. */
  props: string;
  /** The scene the pass draws through (its id). */
  scene: number;
}

export interface PipeRecord {
  /** Three's cache key for the pipeline: `vertexProgramId,fragmentProgramId,` then the draw state. */
  key: string;
  /** Order made, from 1. */
  seq: number;
  /** When it was asked for, ms from the page's start. */
  askedAt: number;
  /** When it landed (ready to draw), ms from the page's start; -1 while pending. */
  landedAt: number;
  /** Who asked (`WHERE`). */
  where: number;
  /** The pass it was asked for: world, rooms, shadow, chain, weather, a stage or other (the scene's own name). */
  pass: string;
  matType: string;
  matName: string;
  matId: number;
  objType: string;
  objName: string;
  objId: number;
  /** The arrival it was asked in (an index into the arrivals made, -1 before the first). */
  arrival: number;
  fields: KeyFields | null;
}

export interface ArrivalMark {
  /** The arrival's number, from 0. */
  n: number;
  /** When it began (the travel's flag went up), ms from the page's start. */
  at: number;
  /** When the loading screen went (the flag went down), -1 while it is up. */
  goneAt: number;
  /** The warm-up's items listed and not yet built at `LANDING_TUNE.pendingAtMs`, -1 before. */
  queuedAt30: number;
  /** Pipeline batches in flight then. */
  inFlightAt30: number;
  /** The first of those items' material names. */
  queuedNames: string[];
  /** When the queue was looked at (its timer can run late in a hidden tab), -1 before. */
  lookedAt: number;
}

/** The ledger's state. One per page (one renderer). */
export const LEDGER = {
  installed: false,
  /** Every pipeline record, a ring. */
  ring: new Array<PipeRecord | null>(LEDGER_CAP).fill(null),
  head: 0,
  made: 0,
  /** The newest record for each key three holds a pipeline under. */
  byKey: new Map<string, PipeRecord>(),
  arrivals: new Array<ArrivalMark | null>(ARRIVALS_CAP).fill(null),
  arrivalsMade: 0,
  /** The arrival under way (its mark), or null between arrivals. */
  current: null as ArrivalMark | null,
  /** The flags as the last frame ended. */
  traveling: false,
  loading: true,
  /** Pipelines made while three's own compileAsync was the warm-up (the warm patch off). */
  nativeAsked: 0,
  /** Field captures that threw (a render object three had not finished): the record stands without its fields. */
  fieldErrors: 0,
  /** The main thread's milliseconds spent recording, all told (what the ledger costs an arrival). */
  recordMs: 0,
};

/** Kept slots for the warm-up's queued names at an arrival's thirtieth second, filled by reference. */
const QUEUED_SLOTS: string[] = new Array<string>(PENDING_NAMES).fill('');

/** The warm-up's queue, read once an arrival (`patchWarm.ts`'s `peekQueue`). */
export interface LedgerDeps {
  /** Items listed and not yet built. */
  queued(): number;
  /** Pipeline batches asked for and not landed. */
  inFlight(): number;
  /** Writes up to `out.length` names of the queued items into `out` (existing strings), answers how many. */
  queuedNames(out: string[]): number;
}

let deps: LedgerDeps | null = null;

const hashStr = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Three's reduction of a material property to its key (`RenderObject.getMaterialCacheKey`). */
const ENUM_PROPS = new Set(['side', 'blending', 'combine', 'normalMapType']);
/** What three leaves out of the material's key. */
const SKIP_PROP = /^(is[A-Z]|_)|^(visible|version|uuid|name|opacity|userData|iridescenceThicknessRange)$/;
/** The draw state's own properties: the census reads them from three's pipeline key, not from here. */
const DRAW_STATE = new Set(['transparent', 'blending', 'premultipliedAlpha', 'blendSrc', 'blendDst', 'blendEquation', 'blendSrcAlpha', 'blendDstAlpha', 'blendEquationAlpha', 'colorWrite', 'depthWrite', 'depthTest', 'depthFunc', 'stencilWrite', 'stencilFunc', 'stencilFail', 'stencilZFail', 'stencilZPass', 'stencilFuncMask', 'stencilWriteMask', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'side', 'alphaToCoverage']);
const protoKeys = new Map<unknown, string[]>();

/** The material's properties as three walks them: its own, then its prototypes' accessors. */
function materialKeys(m: Any): string[] {
  const own = Object.keys(m);
  let pk = protoKeys.get(m.constructor);
  if (!pk) {
    pk = [];
    let proto = Object.getPrototypeOf(m);
    while (proto) {
      const d = Object.getOwnPropertyDescriptors(proto);
      for (const k in d) if (d[k].get !== undefined) pk.push(k);
      proto = Object.getPrototypeOf(proto);
    }
    protoKeys.set(m.constructor, pk);
  }
  return pk.length ? own.concat(pk) : own;
}

function propsKey(m: Any, webgpu: boolean): string {
  let out = '';
  for (const k of materialKeys(m)) {
    if (SKIP_PROP.test(k) || DRAW_STATE.has(k)) continue;
    const v = m[k];
    let key: string;
    if (v === null || v === undefined) key = String(v);
    else if (typeof v === 'number') key = ENUM_PROPS.has(k) ? String(v) : v !== 0 ? '1' : '0';
    else if (typeof v === 'object') key = v.isTexture ? `{${v.mapping}${v.channel}${webgpu ? `${v.magFilter}${v.minFilter}${v.wrapS}${v.wrapT}${v.wrapR}` : ''}}` : '{}';
    else if (typeof v === 'function') continue;
    else key = String(v);
    // A shader's text or any long word kept as its hash: the key is read back split on ';' and '='.
    if (key.length > 32 || /[;=]/.test(key)) key = `#${hashStr(key).toString(36)}`;
    out += `${k}=${key};`;
  }
  return out;
}

/** The parts of three's key read off a render object as its pipeline is made. */
export function keyFieldsOf(ro: Any): KeyFields {
  const object = ro.object ?? {};
  const material = ro.material ?? {};
  const g = ro.geometry ?? object.geometry;
  let morph = '';
  if (g?.morphAttributes) {
    let n = 0;
    let h = 2166136261;
    for (const name of Object.keys(g.morphAttributes).sort()) {
      const targets = g.morphAttributes[name] ?? [];
      n += targets.length;
      h = Math.imul(h ^ hashStr(name), 16777619);
      for (const a of targets) h = Math.imul(h ^ (a?.id ?? 0), 16777619);
    }
    if (n) morph = `${n}#${(h >>> 0).toString(36)}`;
  }
  let attrs = '';
  if (g?.attributes) {
    for (const name of Object.keys(g.attributes).sort()) {
      const a = g.attributes[name];
      attrs += `${name}${a.itemSize ?? ''}${a.normalized ? 'n' : ''}${a.isInterleavedBufferAttribute ? 'i' : ''},`;
    }
  }
  const inst = object.isInstancedMesh ? 'I' : object.isBatchedMesh ? 'B' : object.count > 1 ? 'C' : '';
  let lights = 0;
  try {
    if (material.isShadowPassMaterial !== true) lights = Number(ro.lightsNode?.getCacheKey?.(true) ?? 0) || 0;
  } catch {
    lights = -1;
  }
  let env = 0;
  try {
    env = Number(ro.getDynamicCacheKey?.() ?? 0) || 0;
  } catch {
    env = -1;
  }
  const ctx = ro.context ?? {};
  const mrt = ctx.mrt?.outputNodes ? Object.keys(ctx.mrt.outputNodes).join('+') : '';
  let custom = 0;
  try {
    // Three's own copy, kept by the material's version (`NodeManager.getCustomProgramCacheKey`), where it can be read: the
    // node graph's key worked out again would walk the whole graph once more for every pipeline.
    const nodes = ro._nodes;
    const k = nodes && typeof nodes.getCustomProgramCacheKey === 'function' && ro.scene ? nodes.getCustomProgramCacheKey(material, ro.scene) : material.customProgramCacheKey?.();
    custom = hashStr(String(k ?? ''));
  } catch {
    custom = -1;
  }
  return {
    // A body skinned from the bone pool (pass 1, wave 4) is keyed "pooled" where three keys its bone count: -1.
    bones: isPooledRO(ro) ? -1 : (object.skeleton?.bones?.length ?? 0),
    morph,
    attrs,
    inst,
    recv: object.receiveShadow === true,
    lights,
    env,
    // The context's part of three's program key: `buildKey` from three's development commit 577fb27 on (the outputs, their
    // multiple targets and the camera, without the sample count), `stateKey` before it.
    outputs: `${mrt}|${ctx.buildKey ?? ctx.stateKey ?? ''}`,
    clip: String(ro.clippingContextCacheKey ?? ''),
    custom,
    props: propsKey(material, true),
    scene: ro.scene?.id ?? -1,
  };
}

/**
 * The pass a render object is drawn in, by its material, object and scene: a self-test's, a shadow (three's shadow material),
 * the effects chain's (its meshes are marked), the rooms' (`passScenes.ts` names that scene), the world's (the scene the sun
 * was made for), or another scene by its name or id (the weather's, a preview's, a warm-up stage's).
 */
export function passOf(ro: Any, world: object | null): string {
  const object = ro.object ?? {};
  const material = ro.material ?? {};
  if (object.userData?.swgSelfTest === true) return 'self-test';
  if (material.isShadowPassMaterial === true) return 'shadow';
  if (object.userData?.gpuChain === true) return 'chain';
  const scene = ro.scene ?? null;
  const name = String(scene?.name ?? '');
  if (name === 'the rooms passes') return 'rooms';
  if (name === 'the shadow pass') return 'shadow';
  if (scene !== null && scene === world) return 'world';
  return name ? `scene "${name}"` : `scene #${scene?.id ?? '?'}`;
}

/** Ms from the page's start (`performance.now()`'s origin). */
const now = (): number => performance.now();

/** One pipeline made: its record, landed now (a draw's) or when three's promise for it answers. */
export function recordPipeline(ro: Any, promises: Any[] | null, before: number, loading: boolean, traveling: boolean, native: boolean, world: object | null = null): PipeRecord | null {
  const key = ro?.pipeline?.cacheKey;
  if (typeof key !== 'string') return null;
  const object = ro.object ?? {};
  const material = ro.material ?? {};
  const selfTest = object.userData?.swgSelfTest === true;
  const sync = promises === null || promises === undefined;
  const where = selfTest ? 4 : sync ? 3 : native ? 5 : !loading ? 2 : traveling ? 1 : 0;
  let fields: KeyFields | null = null;
  try {
    fields = keyFieldsOf(ro);
  } catch {
    LEDGER.fieldErrors++;
  }
  const rec: PipeRecord = {
    key,
    seq: ++LEDGER.made,
    askedAt: before,
    landedAt: -1,
    where,
    pass: passOf(ro, world),
    matType: String(material.type ?? '?'),
    matName: String(material.name ?? ''),
    matId: Number(material.id ?? -1),
    objType: String(object.type ?? '?'),
    objName: String(object.name ?? ''),
    objId: Number(object.id ?? -1),
    arrival: LEDGER.current ? LEDGER.current.n : LEDGER.arrivalsMade - 1,
    fields,
  };
  const old = LEDGER.ring[LEDGER.head];
  if (old && LEDGER.byKey.get(old.key) === old) LEDGER.byKey.delete(old.key);
  LEDGER.ring[LEDGER.head] = rec;
  LEDGER.head = (LEDGER.head + 1) % LEDGER_CAP;
  LEDGER.byKey.set(key, rec);
  if (sync) rec.landedAt = now();
  else if (promises && promises.length) {
    const p = promises[promises.length - 1] as Promise<unknown>;
    void p.then(
      () => {
        rec.landedAt = now();
      },
      () => {
        rec.landedAt = now();
      },
    );
  } else rec.landedAt = now();
  return rec;
}

/**
 * The ledger's wrap of three's `createRenderPipeline` (outside the warm patch's own, whichever was put on first), and its
 * frame call. `loading()` and `traveling()` are the runtime's flags as the last frame ended; `native()` whether three's own
 * compileAsync is the warm-up now (the warm patch off or not applied).
 */
export function installLedger(renderer: Any, d: LedgerDeps, flags: { native(): boolean; world(): object | null }): boolean {
  const be = renderer?.backend;
  if (!be || typeof be.createRenderPipeline !== 'function') return false;
  deps = d;
  const create = be.createRenderPipeline.bind(be);
  be.createRenderPipeline = (ro: Any, promises: Any) => {
    const before = now();
    const out = create(ro, promises);
    const t = now();
    try {
      recordPipeline(ro, promises ?? null, before, LEDGER.loading, LEDGER.traveling, flags.native(), flags.world());
    } catch {
      LEDGER.fieldErrors++;
    }
    LEDGER.recordMs += now() - t;
    return out;
  };
  LEDGER.installed = true;
  return true;
}

/**
 * The frame's call (`GpuRuntime.endFrame`): an arrival begins when the travel's flag goes up and its screen is gone when it
 * comes down. Every other frame compares a flag and stores two; the queue's look at `LANDING_TUNE.pendingAtMs` is a timer's.
 */
export function ledgerFrame(loading: boolean, traveling: boolean): void {
  LEDGER.loading = loading;
  // A frame where the travel's flag stands as it stood: two stores and a comparison, the clock never read.
  if (traveling === LEDGER.traveling) return;
  LEDGER.traveling = traveling;
  if (traveling) beginArrival();
  else if (LEDGER.current) LEDGER.current.goneAt = now();
}

/** An arrival begins: its mark, and its thirtieth second's look at the queue on a timer of its own (never a frame's). */
function beginArrival(): void {
  const n = LEDGER.arrivalsMade++;
  const mark: ArrivalMark = { n, at: now(), goneAt: -1, queuedAt30: -1, inFlightAt30: -1, queuedNames: [], lookedAt: -1 };
  LEDGER.arrivals[n % ARRIVALS_CAP] = mark;
  LEDGER.current = mark;
  setTimeout(() => lookAtQueue(mark), LANDING_TUNE.pendingAtMs);
}

/** The warm-up's queue as it stands, by number and by name, for an arrival's mark. */
function lookAtQueue(mark: ArrivalMark): void {
  mark.lookedAt = now();
  mark.queuedAt30 = deps ? deps.queued() : 0;
  mark.inFlightAt30 = deps ? deps.inFlight() : 0;
  const k = deps && mark.queuedAt30 > 0 ? deps.queuedNames(QUEUED_SLOTS) : 0;
  mark.queuedNames = QUEUED_SLOTS.slice(0, k);
}

/** Every record held, oldest first. */
export function ledgerRecords(): PipeRecord[] {
  const out: PipeRecord[] = [];
  for (let i = 0; i < LEDGER_CAP; i++) {
    const r = LEDGER.ring[(LEDGER.head + i) % LEDGER_CAP];
    if (r) out.push(r);
  }
  return out;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
const nameOf = (r: PipeRecord): string => `${r.matName || r.matType}#${r.matId} on ${r.objName || r.objType}#${r.objId}`;
const rowOf = (r: PipeRecord): Record<string, unknown> => ({
  seq: r.seq,
  askedS: r1(r.askedAt / 1000),
  landedS: r.landedAt < 0 ? 'pending' : r1(r.landedAt / 1000),
  waitMs: r.landedAt < 0 ? null : Math.round(r.landedAt - r.askedAt),
  material: `${r.matType}${r.matName ? ` "${r.matName}"` : ''}#${r.matId}`,
  object: `${r.objType}${r.objName ? ` "${r.objName}"` : ''}#${r.objId}`,
  pass: r.pass,
  asked: WHERE[r.where],
  arrival: r.arrival,
});

/**
 * A row with its times in milliseconds from the page's start, unrounded, and who asked: what `__debug.load()` (pass 1,
 * wave 2, `loadTimes.ts`) lays over its journeys.
 */
const rowExact = (r: PipeRecord): { askedMs: number; landedMs: number; asked: string } => ({ askedMs: r.askedAt, landedMs: r.landedAt, asked: WHERE[r.where] });

/**
 * The landing log (`__debug.gpu({ landing })`). `all` lists every record held, else the last `last` (60); `exact` gives the
 * rows as `rowExact` does.
 */
export function landingReport(o: { all?: boolean; last?: number; exact?: boolean } = {}): Record<string, unknown> {
  const recs = ledgerRecords();
  const t = now();
  const byWhere: Record<string, { asked: number; landed: number; pending: number; meanWaitMs: number; maxWaitMs: number }> = {};
  for (const w of WHERE) byWhere[w] = { asked: 0, landed: 0, pending: 0, meanWaitMs: 0, maxWaitMs: 0 };
  for (const r of recs) {
    const b = byWhere[WHERE[r.where]];
    b.asked++;
    if (r.landedAt < 0) b.pending++;
    else {
      b.landed++;
      const w = r.landedAt - r.askedAt;
      b.meanWaitMs += w;
      if (w > b.maxWaitMs) b.maxWaitMs = Math.round(w);
    }
  }
  for (const w of WHERE) {
    const b = byWhere[w];
    b.meanWaitMs = b.landed ? Math.round(b.meanWaitMs / b.landed) : 0;
    if (!b.asked) delete byWhere[w];
  }
  const arrivals: Record<string, unknown>[] = [];
  for (let i = 0; i < ARRIVALS_CAP; i++) {
    const a = LEDGER.arrivals[(LEDGER.arrivalsMade + i) % ARRIVALS_CAP];
    if (!a) continue;
    const at30 = a.at + LANDING_TUNE.pendingAtMs;
    const mine = recs.filter((r) => r.arrival === a.n);
    const askedBy = (lim: number) => mine.filter((r) => r.askedAt <= lim).length;
    const landedBy = (lim: number) => mine.filter((r) => r.landedAt >= 0 && r.landedAt <= lim).length;
    const pendingAt30 = t >= at30 ? recs.filter((r) => r.askedAt <= at30 && (r.landedAt < 0 || r.landedAt > at30)) : null;
    arrivals.push({
      arrival: a.n,
      beganS: r1(a.at / 1000),
      screenGoneS: a.goneAt < 0 ? 'screen up' : r1(a.goneAt / 1000),
      screenSecs: a.goneAt < 0 ? null : r1((a.goneAt - a.at) / 1000),
      pipelines: { asked: mine.length, askedBehindScreen: a.goneAt < 0 ? null : askedBy(a.goneAt), landedBehindScreen: a.goneAt < 0 ? null : landedBy(a.goneAt), askedBy30s: askedBy(at30), landedBy30s: landedBy(at30), askedAfter30s: mine.filter((r) => r.askedAt > at30).length },
      at30s:
        pendingAt30 === null
          ? `not yet (${r1((at30 - t) / 1000)} s to go)`
          : {
              pipelinesPending: pendingAt30.length,
              pendingByName: pendingAt30.slice(0, 40).map((r) => `${nameOf(r)} [${r.pass}, ${WHERE[r.where]}] asked at ${r1((r.askedAt - a.at) / 1000)} s, ${r.landedAt < 0 ? 'still pending' : `landed at ${r1((r.landedAt - a.at) / 1000)} s`}`),
              warmUpItemsQueued: a.queuedAt30,
              warmUpBatchesInFlight: a.inFlightAt30,
              queuedByName: a.queuedNames,
              queueLookedAtS: a.lookedAt < 0 ? null : r1((a.lookedAt - a.at) / 1000),
            },
      slowest: [...mine].sort((p, q) => (q.landedAt < 0 ? 1e12 : q.landedAt - q.askedAt) - (p.landedAt < 0 ? 1e12 : p.landedAt - p.askedAt)).slice(0, 8).map((r) => `${nameOf(r)} [${r.pass}, ${WHERE[r.where]}] ${r.landedAt < 0 ? 'pending' : `${Math.round(r.landedAt - r.askedAt)} ms`}`),
    });
  }
  const last = Math.max(1, Math.floor(o.last ?? 60));
  return {
    renderer: 'WebGPU',
    installed: LEDGER.installed,
    since: "the page's start (times are seconds from it, performance.now())",
    held: recs.length,
    made: LEDGER.made,
    cap: LEDGER_CAP,
    recordingMs: Math.round(LEDGER.recordMs),
    pendingNow: recs.filter((r) => r.landedAt < 0).length,
    byWhere,
    arrivals,
    pipelines: (o.all ? recs : recs.slice(-last)).map(o.exact ? rowExact : rowOf),
    note: `a draw's pipeline is made while the main thread waits (it lands as it is asked); one asked ahead lands when three's promise for it answers. Pending at ${LANDING_TUNE.pendingAtMs / 1000} s is every pipeline asked by then and not landed by then, with the warm-up's items listed and not yet built. { landing: { all: true } } lists every record held.`,
  };
}
