// The meshlet trial's step A (the GPU port's pass 1, wave 7; the design's section 5): three's own `MeshletDrawingPipeline`
// (`three/examples/jsm/pipelines/`, at the pinned 188dev) draws the placed objects it accepts, and everything it refuses
// stays on today's path. A measure with a written verdict, not a feature.
//
// **Parked** (the wave's verdict, `docs/STATUS.md`, `docs/lessons/webgpu.md`): at Mos Eisley's street it cost the main thread
// about 8 to 9 ms a frame where the owner's line for going on was 0.5 ms saved, so it runs on the dev server alone (its
// import behind `import.meta.env.DEV`, as the world editor's is) and a built game carries none of three's addon.
//
// Its switch is its own: `?meshlet` on the address, read once at start, WebGPU alone, off by default. Without it nothing
// here is reached but the report's one line: three's addon is never imported (one dynamic import, made only when asked),
// no pipeline is made, the drawing pipeline is three's standard one with the performance step's shadow cull on it. With it,
// the addon is loaded and the trial's pipeline becomes the renderer's drawing pipeline; `__debug.meshlet({ on: false })` puts
// the standard one back live, and the frame report's A/B switch `gpu.meshlet` flips the two in alternating blocks.
//
// What the trial's pipeline changes of three's (`makeTrial`), each the least that keeps the picture and the warm-up as they are:
//   - **placed objects alone** (`placedOf`): a mesh the placed-object streamer made (it stamps `casterRadius` on every tier's
//     copy, level group and row) or a building's room (a plain mesh on the rooms' layer alone, its matrix written by hand).
//     The people, the ground, the sky, the flora's batches, the weather and the effects are never offered to it.
//   - **our node copies' rules** (`ourRefusal`): our look parts that three's draw material would lose are refused, never
//     dropped: the detail map (its part reads the geometry's second uv set, which a pulled geometry does not show the part)
//     and the leaf cards (their part moves the vertices). The parts that carry (0.187's indirect light, the client's
//     highlight) are put on three's draw material as `looks.ts` puts them on a node copy (`dress`), since three makes that
//     material itself (`createDrawMaterial`: a fresh node material reading the source's fields) and never asks the node
//     library for it, where our parts are handed every copy.
//   - **the warm-up walks today's path**: three's pipeline is off for any render made inside a precompile (`begin`), so the
//     warm-up lists exactly what it lists today, and its `prepareAsync` is not run inside `compileAsync` (it would make three's
//     synchronous listing asynchronous, which the warm-up's walk relies on). Clusters are made three's way, one geometry a
//     render, or all at once by `__debug.meshlet({ prepare: true })` (three's own `_getClusters`, a yield between each).
//
// Three's own rules decide everything else: it refuses reversed depth outright (both arms of the trial run `?norevz`), a
// picture on a second uv set, polygon offset, a two-sided or see-through material, a node of its own, a mirrored matrix, a
// draw hook, a draw range, morphs and more (`refusalOf` names the first, in three's order, for the census; three's verdict
// is the truth and a census line that disagrees with it is counted apart). Its static bundle groups (three's default, the
// tiers' bundles are such) keep what it accepts on the GPU with their transforms uploaded once, and record what it refuses
// into the render bundle as before.

import { LOOK_PARTS } from './looks.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Three's `FrontSide` and `DoubleSide` (the census's words; the decision is three's). */
const FRONT = 0;
const DOUBLE = 2;
/** The rooms' layer (`portalRender.ts`'s `INTERIOR_LAYER`, 1) as a mask: a building's room is drawn on it alone. */
const ROOMS_MASK = 1 << 1;

/** The look parts three's draw material would lose, each with the reason the census gives. */
export const PARTS_REFUSED: Record<string, string> = {
  detail: "our detail map: its part reads the geometry's second uv set, which three's pulled geometry does not show it",
  card: 'our leaf card: its part moves the vertices, which three culls by their unmoved bounds',
};

function readAsked(): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('meshlet');
  } catch {
    return false;
  }
}

/** The trial's state. `asked` is read once, at load; the rest moves. */
export const MESHLET = {
  asked: readAsked(),
  /** 'not asked' | 'loading' | 'ready' | 'failed'. */
  state: 'not asked' as string,
  /** Whether the trial's pipeline is the renderer's drawing pipeline now. */
  on: false,
  why: '',
  loadMs: 0,
  /** Whether our carried parts go on three's draw materials (an attribution switch: read when a batch is made). */
  dress: true,
};

/** What the trial's own code did, for the console. */
export const MESHLET_STATS = {
  /** Renders three's pipeline was kept off in because they were made inside a precompile (the warm-up's walk). */
  precompilesKept: 0,
  /** Draw materials three made that our parts went on, and how many parts each time. */
  dressed: 0,
  partsOn: new Map<string, number>(),
  /** Geometries `prepare` made clusters for, and its time. */
  prepared: 0,
  prepareMs: 0,
  /** Live switches made. */
  switched: 0,
};

/** Whether an object is a placed object (see the head). */
export function placedOf(object: Any): boolean {
  if (object.userData?.casterRadius !== undefined) return true;
  return object.isMesh === true && object.isInstancedMesh !== true && object.layers?.mask === ROOMS_MASK && object.matrixAutoUpdate === false;
}

/** The reason our node copies' rules refuse a material, or null (see `PARTS_REFUSED`). */
export function ourRefusal(material: Any, parts: readonly { name: string; applies(m: Any): boolean }[] = LOOK_PARTS): string | null {
  for (const p of parts) {
    const why = PARTS_REFUSED[p.name];
    if (why && p.applies(material)) return why;
  }
  return null;
}

/**
 * The first rule of three's that refuses this object and material, named in three's own order (`isSupportedObject`, then
 * `isSupportedMaterial`), or null where none does. The census's words only: what decides is three's own `_isMeshlet`.
 */
export function refusalOf(object: Any, geometry: Any, material: Any, group: Any, library: Any): string | null {
  if (object.isMesh !== true) return 'not a mesh';
  if (object.isSkinnedMesh === true) return 'skinned';
  if (object.isBatchedMesh === true) return 'a batched mesh';
  if (object.occlusionTest === true) return 'an occlusion test of its own';
  if (Array.isArray(object.material) && group === null) return 'several materials';
  if (group !== null) {
    const count = geometry.index !== null ? geometry.index.count : (geometry.attributes.position?.count ?? 0);
    if (!Number.isInteger(group.start) || group.start < 0 || count - group.start < 3 || group.count < 3 || (!Number.isFinite(group.count) && group.count !== Infinity)) return 'a geometry group three cannot draw';
  }
  if (object.isInstancedMesh === true) {
    if (object.instanceMatrix.isStorageInstancedBufferAttribute === true || object.instanceColor?.isStorageInstancedBufferAttribute === true) return 'copies written on the GPU';
    if (object.morphTexture !== null) return 'copies with morphs';
    if (object.count === 0) return 'no copies';
  } else if (object.count > 1) {
    return 'drawn several times';
  }
  if (object.morphTargetInfluences !== undefined && object.morphTargetInfluences.length > 0) return 'morph targets';
  const proto = Object.getPrototypeOf(object);
  const meshProto = findMeshProto(proto);
  if (meshProto && (object.onBeforeRender !== meshProto.onBeforeRender || object.onAfterRender !== meshProto.onAfterRender)) return 'a draw hook of its own';
  if (object.matrixWorld.determinant() <= 0) return 'mirrored (its matrix turns the winding over)';
  const { position, normal } = geometry.attributes;
  if (position === undefined || normal === undefined || position.itemSize !== 3) return 'no normals';
  if (geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) return 'a draw range';
  if (Object.keys(geometry.morphAttributes).length > 0) return 'morph attributes';
  if (material.isNodeMaterial !== true && library.getMaterialNodeClass(material.type) === null) return 'no node class (a shader material)';
  if (material.transparent === true) return 'see-through';
  if (material.transmission > 0) return 'transmission';
  if (material.alphaHash === true) return 'alpha hash';
  if (material.alphaToCoverage === true) return 'alpha to coverage';
  if (material.side !== FRONT) return material.side === DOUBLE ? 'two-sided' : 'back-sided';
  if (material.vertexColors === true) return 'vertex colours';
  if (material.flatShading === true) return 'flat shading';
  if (material.wireframe === true) return 'wireframe';
  if (material.displacementMap) return 'a displacement map';
  if (material.clippingPlanes !== null && material.clippingPlanes?.length > 0) return 'clipping planes';
  if (material.depthTest === false) return 'no depth test';
  if (material.depthWrite === false) return 'no depth write';
  if (material.colorWrite === false) return 'no colour write';
  if (material.polygonOffset === true) return 'polygon offset';
  for (const key in material) {
    const v = material[key];
    if (v !== null && typeof v === 'object' && v.isTexture === true && v.channel !== 0) return `a picture on a second uv set (${key})`;
  }
  if (material.isNodeMaterial === true) {
    for (const key of ['vertexNode', 'geometryNode', 'depthNode', 'fragmentNode', 'outputNode', 'contextNode', 'backdropNode', 'backdropAlphaNode', 'alphaTestNode', 'castShadowNode', 'maskShadowNode']) {
      if (material[key] !== null && material[key] !== undefined) return `a node of its own (${key})`;
    }
  }
  return null;
}

/** Three's `Mesh.prototype` (the object's own class may extend it), for the draw-hook rule. */
function findMeshProto(p: Any): Any {
  let q = p;
  while (q && q !== Object.prototype) {
    if (q.constructor?.name === 'Mesh') return q;
    q = Object.getPrototypeOf(q);
  }
  return null;
}

/** Our look parts that carry onto three's draw material, put on it as `looks.ts` puts them on a node copy. */
export function dress(node: Any, source: Any, parts: readonly { name: string; applies(m: Any): boolean; apply(n: Any, m: Any): void }[] = LOOK_PARTS): number {
  let n = 0;
  for (const p of parts) {
    if (PARTS_REFUSED[p.name] || !p.applies(source)) continue;
    p.apply(node, source);
    n++;
    MESHLET_STATS.partsOn.set(p.name, (MESHLET_STATS.partsOn.get(p.name) ?? 0) + 1);
  }
  MESHLET_STATS.dressed++;
  return n;
}

/** The made trial: its pipeline, the standard one it stands in for, and the live switch. */
export interface Trial {
  readonly pipeline: Any;
  readonly standard: Any;
  setOn(on: boolean): boolean;
  setOcclusion(on: boolean): boolean;
}

/** `MeshletBatch.prototype.createPulledMesh` wrapped once a module (our parts on each draw material three makes). */
const DRESSED_CLASSES = new WeakSet<object>();

/**
 * The trial's pipeline over three's addon module `mod` (the real one, in the game and in the node test), for `renderer`,
 * whose present drawing pipeline is kept as the standard one to switch back to.
 */
export function makeTrial(mod: Any, renderer: Any): Trial {
  const Base = mod.MeshletDrawingPipeline;
  const Batch = mod.MeshletBatch;
  if (!DRESSED_CLASSES.has(Batch)) {
    DRESSED_CLASSES.add(Batch);
    const own = Batch.prototype.createPulledMesh;
    Batch.prototype.createPulledMesh = function (this: Any, drawAttribute: Any, source: Any, shared: Any, drawOffset?: number, lodTransition?: Any): Any {
      const mesh = own.call(this, drawAttribute, source, shared, drawOffset, lodTransition);
      if (MESHLET.dress && shared && shared.shadow !== true && shared.debug !== true && mesh?.material?.isNodeMaterial === true && shared.material) dress(mesh.material, shared.material);
      return mesh;
    };
  }
  const ours = new WeakMap<object, { version: number; ok: boolean }>();
  // Three's standard pipeline's own `finishRenderList`, for a precompile's render list (see `finishRenderList` below).
  const standardFinish = Object.getPrototypeOf(Base.prototype).finishRenderList;
  /** Whether each render list now open was opened inside a precompile (a render nests a shadow map's inside it). */
  const pre: boolean[] = [];
  let preDepth = 0;
  let preNow = false;
  class TrialPipeline extends Base {
    begin(camera: Any, renderContext: Any): void {
      super.begin(camera, renderContext);
      // A render made inside a precompile (the warm-up's walk) lists today's path: three's pipeline off for it.
      const r = (this as Any).renderer;
      preNow = !!r && r._precompilationState !== null && r._precompilationState !== undefined;
      if (preNow) {
        (this as Any)._meshletsSupported = false;
        (this as Any)._meshletsEnabled = false;
        MESHLET_STATS.precompilesKept++;
      }
    }
    beginRenderList(renderList: Any): void {
      pre[preDepth++] = preNow;
      super.beginRenderList(renderList);
    }
    finishRenderList(renderList: Any): void {
      // A precompile's render list is the very list a real render of that scene and camera fills, and three's batches
      // for it are kept by it: run there, three's `_drawBatches` counted every one of its batches unused in that walk and
      // let them go after sixty (the warm-up walks thousands of times an arrival), so they were made again and again in
      // play. So a precompile's list is finished as the standard pipeline finishes one, and three's batches are not touched.
      const wasPre = preDepth > 0 ? pre[--preDepth] : false;
      if (wasPre) {
        (this as Any)._depth--;
        standardFinish.call(this, renderList);
        return;
      }
      super.finishRenderList(renderList);
    }
    prepareAsync(): undefined {
      // Never inside `compileAsync`: it would make three's synchronous listing asynchronous (see the head).
      return undefined;
    }
    _isMeshlet(object: Any, geometry: Any, material: Any, group: Any): boolean {
      return placedOf(object) && super._isMeshlet(object, geometry, material, group);
    }
    _isSupportedMaterial(material: Any): boolean {
      if (!super._isSupportedMaterial(material)) return false;
      let c = ours.get(material);
      if (c === undefined || c.version !== material.version) {
        c = { version: material.version, ok: ourRefusal(material) === null };
        ours.set(material, c);
      }
      return c.ok;
    }
  }
  const standard = renderer.drawingPipeline;
  const pipeline = new TrialPipeline();
  pipeline.renderer = renderer;
  return {
    pipeline,
    standard,
    setOn(on: boolean): boolean {
      const want = on ? pipeline : standard;
      if (renderer.drawingPipeline !== want) {
        renderer.drawingPipeline = want;
        MESHLET_STATS.switched++;
      }
      MESHLET.on = renderer.drawingPipeline === pipeline;
      return MESHLET.on;
    },
    setOcclusion(on: boolean): boolean {
      pipeline.occlusionCulling = on;
      return pipeline.occlusionCulling;
    },
  };
}

/** The trial once made (null until `startMeshletTrial` has loaded three's addon). */
let TRIAL: Trial | null = null;

/** The trial made at start where `?meshlet` asked for it: three's addon loaded, the pipeline made and put on. */
export async function startMeshletTrial(renderer: Any, deps: { shadowCull(renderer: Any): void; register(name: string, sw: { get(): unknown; set(v: unknown): void; values: readonly unknown[]; note?: string }): void }): Promise<void> {
  // Parked (the wave's verdict, docs/STATUS.md): the trial runs on the dev server alone, its one import behind
  // `import.meta.env.DEV` as the world editor's is, so a built game carries none of three's addon.
  if (!import.meta.env.DEV) {
    MESHLET.state = 'parked';
    MESHLET.why = "the meshlet trial is parked (pass 1, wave 7): it runs on the dev server alone, and a built game carries none of it";
    return;
  }
  MESHLET.state = 'loading';
  const t0 = performance.now();
  try {
    const mod = await import('three/examples/jsm/pipelines/MeshletDrawingPipeline.js');
    const trial = makeTrial(mod, renderer);
    // The performance step's shadow cull on the trial's pipeline too (it wraps the renderer's drawing pipeline).
    renderer.drawingPipeline = trial.pipeline;
    try {
      deps.shadowCull(renderer);
    } finally {
      renderer.drawingPipeline = trial.standard;
    }
    TRIAL = trial;
    deps.register('gpu.meshlet', {
      get: () => MESHLET.on,
      set: (v: unknown) => {
        trial.setOn(v === true);
      },
      values: [false, true],
      note: "the meshlet trial (pass 1, wave 7, step A): three's own MeshletDrawingPipeline drawing the placed objects it accepts (off is today's drawing)",
    });
    MESHLET.loadMs = Math.round(performance.now() - t0);
    MESHLET.state = 'ready';
    if (renderer.reversedDepthBuffer === true) MESHLET.why = "reversed depth is on, and three's pipeline draws nothing under it: add ?norevz to the address";
    trial.setOn(true);
  } catch (err) {
    MESHLET.state = 'failed';
    MESHLET.why = String((err as Error)?.message ?? err).slice(0, 300);
    console.warn(`meshlet trial: three's pipeline could not be made (${MESHLET.why}); today's drawing stands`);
  }
}

/** Three's own cluster making over every placed geometry it accepts, a yield between each (as its `prepareAsync`). */
async function prepare(scene: Any): Promise<Record<string, unknown>> {
  const p = TRIAL!.pipeline;
  const t0 = performance.now();
  for (let i = 0; i < 400 && p._ready !== true; i++) await new Promise((r) => setTimeout(r, 25));
  if (p._ready !== true) return { prepared: 0, why: "three's cluster maker (meshoptimizer's clusterizer) never said it was ready" };
  const seen = new Map<object, Set<string>>();
  const todo: { g: Any; group: Any }[] = [];
  const was = { e: p._meshletsEnabled, d: p._depth, s: p._shadowPass, c: p._capture };
  p._meshletsEnabled = true;
  p._depth = 1;
  p._shadowPass = false;
  p._capture = null;
  try {
    scene.traverse((o: Any) => {
      if (!o.isMesh || !o.geometry) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const groups = Array.isArray(o.material) ? o.geometry.groups : [null];
      for (const group of groups) {
        const m = group ? mats[group.materialIndex] : mats[0];
        if (!m || !p._isMeshlet(o, o.geometry, m, group)) continue;
        const key = group ? `${group.start}:${group.count}` : '';
        let s = seen.get(o.geometry);
        if (!s) seen.set(o.geometry, (s = new Set()));
        if (s.has(key)) continue;
        s.add(key);
        if (!p._hasClusters(o.geometry, group)) todo.push({ g: o.geometry, group });
      }
    });
  } finally {
    p._meshletsEnabled = was.e;
    p._depth = was.d;
    p._shadowPass = was.s;
    p._capture = was.c;
  }
  let made = 0;
  for (const t of todo) {
    if (!p._hasClusters(t.g, t.group)) {
      p._getClusters(t.g, t.group, true);
      made++;
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  const ms = performance.now() - t0;
  MESHLET_STATS.prepared += made;
  MESHLET_STATS.prepareMs += ms;
  return { prepared: made, geometries: seen.size, ms: Math.round(ms) };
}

/** Triangles a mesh draws (its geometry's, or its group's), times its copies. */
function trianglesOf(o: Any, group: Any): number {
  const g = o.geometry;
  const n = group ? Math.min(group.count, (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) - group.start) : g.index ? g.index.count : (g.attributes.position?.count ?? 0);
  return Math.floor(n / 3) * (o.isInstancedMesh ? o.count : 1);
}

/**
 * The census: every placed object the scene holds (each material of a mesh of several apart), taken or refused by three's
 * own `_isMeshlet` with our rules on it (as a world pass would ask), and the refused ones by their reason, in objects,
 * copies and triangles. Made on demand, never in a frame.
 */
export function meshletCensus(scene: Any, renderer: Any): Record<string, unknown> {
  if (!TRIAL) return { census: 'the trial is not made (no ?meshlet, or still loading, or failed)', state: MESHLET.state, why: MESHLET.why };
  const p = TRIAL.pipeline;
  const lib = renderer.library;
  type Row = { objects: number; copies: number; triangles: number };
  const row = (): Row => ({ objects: 0, copies: 0, triangles: 0 });
  const add = (r: Row, o: Any, group: Any): void => {
    r.objects++;
    r.copies += o.isInstancedMesh ? o.count : 1;
    r.triangles += trianglesOf(o, group);
  };
  const taken = row();
  const refused = row();
  const byReason = new Map<string, Row>();
  const disagree: string[] = [];
  let notPlaced = 0;
  const was = { e: p._meshletsEnabled, d: p._depth, s: p._shadowPass, c: p._capture };
  p._meshletsEnabled = true;
  p._depth = 1;
  p._shadowPass = false;
  p._capture = null;
  try {
    scene.traverse((o: Any) => {
      if (!o.isMesh || !o.geometry || !o.material) return;
      if (!placedOf(o)) {
        notPlaced++;
        return;
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const groups = Array.isArray(o.material) ? o.geometry.groups : [null];
      for (const group of groups) {
        const m = group ? mats[group.materialIndex] : mats[0];
        if (!m) continue;
        const three = p._isMeshlet(o, o.geometry, m, group) === true;
        let why = refusalOf(o, o.geometry, m, group, lib) ?? ourRefusal(m);
        if (three && why !== null) {
          disagree.push(`taken by three, named "${why}" here: ${o.name || o.type} / ${m.name || m.type}`);
          why = null;
        } else if (!three && why === null) {
          why = 'refused by three (no rule named here)';
        }
        if (why === null) add(taken, o, group);
        else {
          add(refused, o, group);
          let r = byReason.get(why);
          if (!r) byReason.set(why, (r = row()));
          add(r, o, group);
        }
      }
    });
  } finally {
    p._meshletsEnabled = was.e;
    p._depth = was.d;
    p._shadowPass = was.s;
    p._capture = was.c;
  }
  const share = (a: number, b: number): number => (a + b ? Math.round((1000 * a) / (a + b)) / 10 : 0);
  return {
    reversedDepth: renderer.reversedDepthBuffer === true ? "on: three's pipeline takes nothing in any render (every row below is what it would take under ?norevz)" : 'off',
    taken,
    refused,
    takenShare: { objects: share(taken.objects, refused.objects), copies: share(taken.copies, refused.copies), triangles: share(taken.triangles, refused.triangles) },
    byReason: Object.fromEntries([...byReason.entries()].sort((a, b) => b[1].objects - a[1].objects)),
    notPlaced: { meshes: notPlaced, why: "the people, the ground, the sky, the flora's batches, the weather and the effects: never offered to the trial" },
    disagreements: disagree.slice(0, 12),
    disagreementCount: disagree.length,
  };
}

/** What three's pipeline drew in its last projection of each render list it holds, read off its own records. */
function drawnNow(p: Any): Record<string, unknown> {
  let lists = 0;
  let entries = 0;
  let batches = 0;
  let objects = 0;
  let copies = 0;
  let staticGroups = 0;
  let staticObjects = 0;
  let staticCopies = 0;
  for (const ref of p._records ?? []) {
    const rec = ref.deref?.();
    if (!rec) continue;
    lists++;
    for (const e of rec.entries ?? []) {
      if (e.projectionId !== rec.projectionId) continue;
      entries++;
      if (e.batch) batches++;
      objects += e.objects.length;
      copies += e.count;
    }
    for (const data of rec.staticGroups?.values?.() ?? []) {
      if (data.projectionId !== rec.projectionId) continue;
      staticGroups++;
      for (const e of data.entries ?? []) {
        if (e.batch) batches++;
        staticObjects += e.objects.length;
        staticCopies += e.count;
      }
    }
  }
  return { renderLists: lists, entries, batches, objects, copies, staticGroups, staticObjects, staticCopies, info: { ...(p.info ?? {}) } };
}

/** What `__debug.gpu()` says of the trial (one line when it was not asked). */
export function meshletReport(): Record<string, unknown> {
  if (!MESHLET.asked) return { asked: false, switch: "?meshlet on the address (with ?norevz: three's pipeline draws nothing under reversed depth) loads three's MeshletDrawingPipeline for the placed objects it accepts, on the dev server alone (the trial is parked); __debug.meshlet() says what it does" };
  const p = TRIAL?.pipeline;
  return {
    asked: true,
    state: MESHLET.state,
    on: MESHLET.on,
    ...(MESHLET.why ? { why: MESHLET.why } : {}),
    loadMs: MESHLET.loadMs,
    occlusionCulling: p ? p.occlusionCulling : null,
    clustersReady: p ? p._ready === true : null,
    stats: { ...MESHLET_STATS, partsOn: Object.fromEntries(MESHLET_STATS.partsOn), prepareMs: Math.round(MESHLET_STATS.prepareMs) },
    drawn: p ? drawnNow(p) : null,
  };
}

/**
 * `__debug.meshlet(o)`: the report; `{ on }` the trial's pipeline on or off live; `{ occlusion }` three's occlusion culling;
 * `{ census: true }` the placed objects taken and refused by reason; `{ prepare: true }` a promise of every placed geometry's
 * clusters made at once.
 */
export function meshletConsole(o: Any, scene: Any, renderer: Any): unknown {
  if (!MESHLET.asked || !TRIAL) return meshletReport();
  const out: Record<string, unknown> = {};
  if (o && typeof o.on === 'boolean') out.on = TRIAL.setOn(o.on);
  if (o && typeof o.occlusion === 'boolean') out.occlusion = TRIAL.setOcclusion(o.occlusion);
  // An attribution switch: our parts on the draw materials three makes from now on (a batch made again takes it).
  if (o && typeof o.dress === 'boolean') out.dress = MESHLET.dress = o.dress;
  if (o?.census === true) return scene ? meshletCensus(scene, renderer) : { census: 'no world scene yet' };
  if (o?.prepare === true) return scene ? prepare(scene) : Promise.resolve({ prepared: 0, why: 'no world scene yet' });
  return { ...meshletReport(), ...out };
}
