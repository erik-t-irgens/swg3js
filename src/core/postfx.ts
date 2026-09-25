// The picture after the frame: the portal renderer draws into a target of the effects' own, and
// that target goes out through an ordered chain of passes to the canvas.
//
// Rules every pass and product in `src/core/fx/` keeps. They are not style; each one was a frame
// that came out wrong.
//
// Targets and depth
//   R1. The scene is drawn only into `sceneTarget`. No pass or product writes its colour, depth or
//       stencil. A product's probe may bind it to draw with colour, depth and stencil writes all off
//       (an occlusion query), and for nothing else.
//   R2. The two chain buffers are half-float colour with no depth and no stencil. Any pass may
//       sample the scene's depth texture while drawing into them.
//   R3. A geometry product draws into a colour target of its own that has the scene's depth
//       attached. It never samples that depth, never writes depth, never changes stencil, and
//       clears colour only.
//   R4. Sanitize is always first, and is the only pass that reads the scene target's colour.
//   R5. Tone mapping happens exactly once, in the output pass: before it everything is linear and
//       may be brighter than white; after it everything is sRGB in 0 to 1.
//   R6. Every material a pass or product draws with is listed by `materials()`, so the warm-up can
//       compile it for the target it draws into, and for the canvas when it can be last.
//   R7. A target sharing the scene's depth texture is exactly the scene target's size, and is
//       resized in the same call.
//   R8. Disposing a target disposes its depth texture, so a shared one is detached first.
//   R9. Nothing allocates inside enabled, needs, prepare, render or the context update.
//   R10. No pass or product scene holds a light: the light count is in every program's key.
//   R11. A pass with nothing to do this frame says so and costs nothing.
//   R12. Nothing is multisampled: the renderer resolves a multisampled target at the end of every
//        render call, and the portal renderer makes a dozen a frame.
import * as THREE from 'three';
import { FX_PASSES, FX_PRODUCTS, FX_TYPICAL_CPU_MS, fxPassDef, fxPassIndex, fxProductDef, type FxPassDef, type FxPassId, type FxProductDef, type FxProductId, type FxSettings } from './fxRegistry.ts';
import { createContext, updateContext, type FxFrameContext, type FxFrameInput } from './fx/context';
import type { FxPass, FxProduct, FxWarmItem } from './fx/pass';
import { createFxQuad, FX_CAMERA } from './fx/pass';
import { LinearDepthHalf, NormalsHalf } from './fx/products';
import { DebugMaskProduct } from './fx/geometry';
import { BloomPass, DebugViewPass, FxaaPass, GodRaysPass, MotionBlurPass, OutputFxPass, SanitizePass } from './fx/passes';
import { FxTimer, type FxTimingReport } from './fx/timer';

export type { SunInfo, FxFrameInput, FxFrameContext, FxSun } from './fx/context';

/** What a scan of the frame's own pixels found: how many were not numbers, and where the first was (from the top left, in pixels). */
export interface BadPixels {
  width: number;
  height: number;
  bad: number;
  first: [number, number] | null;
}

export interface FxPassReport {
  id: FxPassId;
  stage: string;
  setting: boolean;
  override: boolean | null;
  drewLastFrame: boolean;
  needs: FxProductId[];
  missing: FxProductId | null;
  budgetMs: number;
  gpuMs: number | null;
  why?: string;
}

export interface FxProductReport {
  id: FxProductId;
  kind: 'depth' | 'geometry';
  computedLastFrame: boolean;
  size: [number, number];
  format: string;
  /** Colour targets written at once, each of `format`. */
  targets: number;
  /** False while a product that gives its storage back when unused holds none. */
  allocated: boolean;
  /** The product's own one-line account of its last frame. */
  detail?: string;
}

export interface FxDescription {
  effects: boolean;
  size: [number, number];
  passes: FxPassReport[];
  products: FxProductReport[];
  lastPassToScreen: FxPassId | null;
  memoryMB: number;
}

const TL_SCENE = 'scene';
const EMPTY_OBJECTS: readonly THREE.Object3D[] = [];
/** Bytes a pixel of each product format takes, for the memory listing. */
const FORMAT_BYTES: Record<string, number> = { R32F: 4, RGBA8: 4, R8: 1, RG8: 2, R16F: 2, RG16F: 4, RGBA16F: 8 };
/** The meshes made to compile a pass's materials with; kept only so they can be let go. */
const warmMeshes: THREE.Mesh[] = [];

function fullscreenMesh(material: THREE.Material): THREE.Mesh {
  const mesh = createFxQuad(material);
  warmMeshes.push(mesh);
  return mesh;
}

function disposeFullscreenMeshes(): void {
  // The geometry is shared with every live pass, so it is never disposed; only the meshes go.
  warmMeshes.length = 0;
}

function anyOn(settings: FxSettings, keys: readonly (keyof FxSettings)[]): boolean {
  for (let i = 0; i < keys.length; i++) if (settings[keys[i]]) return true;
  return false;
}

function drainErrors(r: THREE.WebGLRenderer): void {
  const gl = r.getContext();
  for (let i = 0; i < 16; i++) if (gl.getError() === gl.NO_ERROR) break;
}

function recordError(r: THREE.WebGLRenderer, into: { at: string; code: number }[], at: string): void {
  const code = r.getContext().getError();
  if (code !== 0) into.push({ at, code });
}

export class PostFX {
  /** Where the portal renderer draws: half floats, with a depth texture that carries the stencil, never multisampled. */
  readonly sceneTarget: THREE.WebGLRenderTarget;
  readonly ctx: FxFrameContext;
  readonly timer: FxTimer;
  /** Forced from the console: true treats a pass's setting as on, false keeps it off, absent follows the settings. Never saved. */
  readonly override: Partial<Record<FxPassId, boolean>> = {};
  /** Scan the next frame's pixels for values that are not numbers; the result lands in `lastScan`. */
  wantScan = false;
  lastScan: BadPixels | null = null;
  /** What the debug mask draws: the game sets this, reusing one array. */
  debugMaskObjects: () => readonly THREE.Object3D[] = () => EMPTY_OBJECTS;
  /** Ask the next frame to call for the GL error after every step; the answers land in `lastCheck`. */
  checkErrors = false;
  lastCheck: { at: string; code: number }[] | null = null;

  private readonly settings: FxSettings;
  private readonly sizeV = new THREE.Vector2();
  private readonly bufferA: THREE.WebGLRenderTarget;
  private readonly bufferB: THREE.WebGLRenderTarget;
  private readonly passes: FxPass[] = [];
  private readonly defs: FxPassDef[] = [];
  private readonly byPassId = new Map<FxPassId, FxPass>();
  private readonly productList: FxProduct[] = [];
  private readonly productDefs: FxProductDef[] = [];
  private readonly byProductId = new Map<FxProductId, FxProduct>();
  private readonly on: boolean[] = [];
  private readonly missing: (FxProductId | null)[] = [];
  private readonly wanted = new Set<FxProductId>();
  private readonly computed = new Set<FxProductId>();
  private lastToScreen: FxPassId | null = null;
  private disposed = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    settings: FxSettings,
  ) {
    this.settings = { ...settings };
    renderer.getDrawingBufferSize(this.sizeV);
    // Never below one pixel, and clamped in the one place everything else reads, so a canvas with
    // no size cannot leave the scene target a pixel wide and a target sharing its depth empty.
    this.sizeV.set(Math.max(1, this.sizeV.x), Math.max(1, this.sizeV.y));
    const w = this.sizeV.x;
    const h = this.sizeV.y;
    // The frame's own target: a stencil for the portals, a depth buffer the passes can read as a
    // texture, and half floats for light brighter than white. Not multisampled (R12); the edges
    // are smoothed at the end instead.
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedInt248Type);
    depth.format = THREE.DepthStencilFormat;
    this.sceneTarget = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, samples: 0, depthTexture: depth });
    this.sceneTarget.texture.name = 'fx.scene';
    this.bufferA = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0 });
    this.bufferA.texture.name = 'fx.a';
    this.bufferB = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0 });
    this.bufferB.texture.name = 'fx.b';
    this.ctx = createContext(renderer, this.settings, this.sceneTarget);
    this.timer = new FxTimer(renderer);
    this.registerProduct(new LinearDepthHalf());
    this.registerProduct(new NormalsHalf());
    this.registerProduct(new DebugMaskProduct(this));
    this.registerPass(new SanitizePass());
    this.registerPass(new GodRaysPass());
    this.registerPass(new MotionBlurPass());
    this.registerPass(new BloomPass(w, h, this.settings.bloomStrength));
    this.registerPass(new OutputFxPass());
    this.registerPass(new FxaaPass());
    this.registerPass(new DebugViewPass());
    this.setSizeAll(w, h);
  }

  /** The target frames are drawn into: what the world's shader warm-up must compile for. */
  get compileTarget(): THREE.WebGLRenderTarget {
    return this.sceneTarget;
  }

  get sceneDepth(): THREE.DepthTexture {
    return this.sceneTarget.depthTexture as THREE.DepthTexture;
  }

  get size(): Readonly<THREE.Vector2> {
    return this.sizeV;
  }

  /** Put a pass in its place in the registry's order. */
  registerPass(pass: FxPass): void {
    const def = fxPassDef(pass.id);
    if (this.byPassId.has(pass.id)) throw new Error(`fx: the pass "${pass.id}" is registered twice`);
    const index = fxPassIndex(pass.id);
    let at = this.passes.length;
    for (let i = 0; i < this.passes.length; i++) {
      if (fxPassIndex(this.passes[i].id) > index) {
        at = i;
        break;
      }
    }
    this.passes.splice(at, 0, pass);
    this.defs.splice(at, 0, def);
    this.on.length = this.passes.length;
    this.missing.length = this.passes.length;
    this.byPassId.set(pass.id, pass);
    pass.setSize(this.sizeV.x, this.sizeV.y, this.settings);
  }

  registerProduct(product: FxProduct): void {
    const def = fxProductDef(product.id);
    if (this.byProductId.has(product.id)) throw new Error(`fx: the product "${product.id}" is registered twice`);
    if (def.kind !== product.kind) throw new Error(`fx: the product "${product.id}" is a ${product.kind} but the registry calls it a ${def.kind}`);
    const index = FX_PRODUCTS.indexOf(def);
    let at = this.productList.length;
    for (let i = 0; i < this.productList.length; i++) {
      if (FX_PRODUCTS.indexOf(this.productDefs[i]) > index) {
        at = i;
        break;
      }
    }
    this.productList.splice(at, 0, product);
    this.productDefs.splice(at, 0, def);
    this.byProductId.set(product.id, product);
    product.setSize(this.sizeV.x, this.sizeV.y, this.settings);
    this.checkNoDepthSampling(product);
  }

  pass<T extends FxPass = FxPass>(id: FxPassId): T | undefined {
    return this.byPassId.get(id) as T | undefined;
  }

  product<T extends FxProduct = FxProduct>(id: FxProductId): T | undefined {
    return this.byProductId.get(id) as T | undefined;
  }

  /**
   * Whether a pass's setting (or console override) asks for it, before the frame: the question a
   * scene material must answer before it is drawn. False when the pass is not registered at all, so
   * an effect can skip the work it would only do for that pass. It never asks the pass's own
   * `enabled`: a pass whose `enabled` answers from a decision this question feeds (the water's) would
   * otherwise be shut out for good the first frame it said no.
   */
  passWanted(id: FxPassId): boolean {
    if (!this.byPassId.has(id)) return false;
    const def = fxPassDef(id);
    if (def.required) return true;
    const setting = def.toggles.length > 0 && anyOn(this.settings, def.toggles);
    return this.override[id] ?? setting;
  }

  /** Take the settings as they now are: flags and strengths, and a resize for a pass whose size is one of them. */
  configure(settings: FxSettings): void {
    const ssao = this.settings.ssaoResolution;
    const water = this.settings.waterReflectionResolution;
    // The clouds take their strength from `setSize` as well as their resolution, so the resize is
    // on either of the two and not on the resolution alone.
    const cloudQuality = this.settings.volumetricCloudQuality;
    const cloudAmount = this.settings.volumetricCloudAmount;
    Object.assign(this.settings, settings);
    if (this.settings.ssaoResolution !== ssao) this.byPassId.get('ssao')?.setSize(this.sizeV.x, this.sizeV.y, this.settings);
    if (this.settings.waterReflectionResolution !== water) this.byPassId.get('waterReflections')?.setSize(this.sizeV.x, this.sizeV.y, this.settings);
    if (this.settings.volumetricCloudQuality !== cloudQuality || this.settings.volumetricCloudAmount !== cloudAmount) {
      this.byPassId.get('volumetricClouds')?.setSize(this.sizeV.x, this.sizeV.y, this.settings);
    }
  }

  begin(): void {
    this.timer.begin(TL_SCENE);
    this.renderer.setRenderTarget(this.sceneTarget);
  }

  end(input: FxFrameInput): void {
    const r = this.renderer;
    const ctx = this.ctx;
    this.timer.end(TL_SCENE);
    if (this.wantScan) {
      this.wantScan = false;
      this.scan(this.sceneTarget);
    }
    updateContext(ctx, input, this.sizeV);
    const check = this.checkErrors;
    if (check) {
      this.lastCheck = [];
      drainErrors(r);
    }
    this.fillDebugView();

    // 0. Probes: a product may ask a question of the finished frame before anyone decides (the
    //    water's occlusion query). A probe binds the scene target only with every write off (R1).
    for (let i = 0; i < this.productList.length; i++) {
      const p = this.productList[i];
      if (!p.probe) continue;
      p.probe(ctx);
      if (check) recordError(r, this.lastCheck!, `probe:${p.id}`);
    }

    // 1. Who draws this frame, and what they need computed first.
    this.wanted.clear();
    let last = -1;
    for (let i = 0; i < this.passes.length; i++) {
      const def = this.defs[i];
      const pass = this.passes[i];
      this.missing[i] = null;
      let on: boolean;
      if (def.required) on = true;
      else {
        const setting = def.toggles.length > 0 && anyOn(this.settings, def.toggles);
        on = (this.override[def.id] ?? setting) && pass.enabled(ctx);
      }
      if (on) {
        const needs = pass.needs(ctx);
        for (let k = 0; k < needs.length; k++) {
          if (!this.byProductId.has(needs[k])) {
            on = false;
            this.missing[i] = needs[k];
            break;
          }
        }
        if (on) for (let k = 0; k < needs.length; k++) this.want(needs[k]);
      }
      this.on[i] = on;
      if (on) last = i;
    }

    // 2. The products, in registry order: everything derived from depth, then the geometry ones.
    this.computed.clear();
    for (let i = 0; i < this.productList.length; i++) {
      const p = this.productList[i];
      if (!this.wanted.has(p.id)) {
        ctx.products[p.id] = null;
        p.idle?.(ctx);
        continue;
      }
      this.timer.begin(p.timerLabel);
      p.render(ctx);
      this.timer.end(p.timerLabel);
      ctx.products[p.id] = p.empty ? null : p.texture;
      this.computed.add(p.id);
      if (check) recordError(r, this.lastCheck!, p.timerLabel);
    }

    // 3. The chain. Only the first pass ever sees the scene target, and nothing ever writes it.
    let read: THREE.WebGLRenderTarget = this.sceneTarget;
    let write = this.bufferA;
    this.lastToScreen = last >= 0 ? this.defs[last].id : null;
    for (let i = 0; i <= last; i++) {
      if (!this.on[i]) continue;
      const pass = this.passes[i];
      const toScreen = i === last;
      pass.prepare(ctx);
      this.timer.begin(pass.timerLabel);
      const wrote = pass.render(ctx, read, toScreen ? null : write);
      this.timer.end(pass.timerLabel);
      if (check) recordError(r, this.lastCheck!, pass.timerLabel);
      if (wrote && !toScreen) {
        read = write;
        write = read === this.bufferA ? this.bufferB : this.bufferA;
      }
    }
    r.setRenderTarget(null);
    ctx.prevViewProj.copy(ctx.viewProj);
    ctx.prevView.copy(ctx.view);
    ctx.cameraCut = false;
    ctx.frame++;
    if (check) this.checkErrors = false;
    this.timer.poll();
  }

  /** The drawing buffer changed: every target and pass follows, and the next frame has no history. */
  setSize(): void {
    this.renderer.getDrawingBufferSize(this.sizeV);
    this.sizeV.set(Math.max(1, this.sizeV.x), Math.max(1, this.sizeV.y));
    this.setSizeAll(this.sizeV.x, this.sizeV.y);
    this.ctx.cameraCut = true;
  }

  /** The camera jumped (a teleport, a new world, the effects switched in): the next frame has no history. */
  reset(): void {
    this.ctx.cameraCut = true;
    for (const p of this.productList) p.reset?.();
  }

  /**
   * Compile every pass's and product's material for where it draws, and wait for the programs to be
   * linked. Every registered pass is warmed whether it is on or not, so turning one on later, or
   * the sun coming on screen for the first time, never compiles on a live frame.
   */
  async warmUp(): Promise<number> {
    const r = this.renderer;
    const before = r.info.programs?.length ?? 0;
    const jobs: Promise<unknown>[] = [];
    const compileOn = (target: THREE.WebGLRenderTarget | null, object: THREE.Object3D) => {
      const prev = r.getRenderTarget();
      r.setRenderTarget(target);
      try {
        jobs.push(r.compileAsync(object, FX_CAMERA).catch(() => {}));
      } finally {
        r.setRenderTarget(prev);
      }
    };
    // The output pass has to be told what it is drawing for before it is compiled, or the program
    // built here is one with no tone curve, which no frame ever uses. Its throw-away draw reads the
    // second chain buffer, so that buffer is made first: nothing has been drawn into either yet.
    const output = this.byPassId.get('output') as OutputFxPass | undefined;
    if (output) {
      const entry = r.getRenderTarget();
      r.setRenderTarget(this.bufferB);
      r.setRenderTarget(entry);
      output.settleDefines(r, this.bufferA, this.bufferB);
    }
    const items: FxWarmItem[] = [];
    // A product always draws into a target of its own, never onto the canvas.
    for (const p of this.productList) for (const m of p.materials()) items.push({ ...m, where: m.where ?? 'target' });
    for (let i = 0; i < this.passes.length; i++) {
      for (const m of this.passes[i].materials()) items.push({ ...m, where: m.where ?? (this.defs[i].canBeLast ? 'both' : 'target') });
    }
    for (const it of items) {
      const object = it.object ?? fullscreenMesh(it.material);
      // Any target at all gives the program key a real draw into the scene target would have; the
      // canvas gives the other one, because it is the only place tone mapping is applied.
      if (it.where !== 'screen') compileOn(this.bufferA, object);
      if (it.where !== 'target') compileOn(null, object);
    }
    await Promise.all(jobs);
    return (r.info.programs?.length ?? 0) - before;
  }

  /**
   * Show a product, the scene's raw colour, the depth, or a pass's own working texture
   * ('ssao.ao'). Null puts the picture back. Returns what is being shown.
   */
  fxView(name: string | null): string | null {
    const view = this.byPassId.get('debugView') as DebugViewPass | undefined;
    if (!view) return null;
    // The water mask's environment term is the reflections pass's own working texture.
    if (name === 'waterMaskEnv') name = 'waterReflections.env';
    if (this.showingPass) delete this.override[this.showingPass];
    this.showingPass = null;
    view.show = name;
    view.external = null;
    this.ctx.debugViewPass = null;
    if (name === null) {
      delete this.override.debugView;
      return null;
    }
    this.override.debugView = true;
    const dot = name.indexOf('.');
    if (dot > 0) {
      const id = name.slice(0, dot) as FxPassId;
      if (this.byPassId.has(id)) {
        this.ctx.debugViewPass = id;
        // The pass has to run for its own texture to exist this frame.
        this.override[id] = true;
        this.showingPass = id;
      }
    }
    return name;
  }

  private showingPass: FxPassId | null = null;

  /** A listing of the chain for the console. */
  describe(): FxDescription {
    const timing = this.timer.report();
    const passes: FxPassReport[] = [];
    for (let i = 0; i < this.passes.length; i++) {
      const def = this.defs[i];
      const pass = this.passes[i];
      const setting = def.required || (def.toggles.length > 0 && anyOn(this.settings, def.toggles));
      const row: FxPassReport = {
        id: def.id,
        stage: def.stage,
        setting,
        override: this.override[def.id] ?? null,
        drewLastFrame: !!this.on[i],
        needs: [...pass.needs(this.ctx)],
        missing: this.missing[i] ?? null,
        budgetMs: def.budgetMs,
        gpuMs: timing.rows[pass.timerLabel]?.gpuMs ?? null,
      };
      if (!row.drewLastFrame) {
        const why = pass.reason?.(this.ctx) ?? (row.override === false ? 'forced off' : setting ? null : 'its setting is off');
        if (why) row.why = why;
        if (row.missing) row.why = `the ${row.missing} product is not written yet`;
      }
      passes.push(row);
    }
    const products: FxProductReport[] = this.productList.map((p, i) => {
      const def = this.productDefs[i];
      const image = p.texture.image as { width?: number; height?: number } | undefined;
      return {
        id: p.id,
        kind: p.kind,
        computedLastFrame: this.computed.has(p.id),
        size: [image?.width ?? 0, image?.height ?? 0],
        format: def.format,
        targets: def.targets ?? 1,
        allocated: p.allocated ?? true,
        ...(p.summary ? { detail: p.summary() } : {}),
      };
    });
    return {
      effects: true,
      size: [this.sizeV.x, this.sizeV.y],
      passes,
      products,
      lastPassToScreen: this.lastToScreen,
      memoryMB: this.memoryMB(),
    };
  }

  timing(budgets = true): FxTimingReport {
    if (!budgets) return this.timer.report();
    const by: Record<string, number> = {};
    for (const def of FX_PASSES) by[`pass:${def.id}`] = def.budgetMs;
    for (const def of FX_PRODUCTS) by[`product:${def.id}`] = def.budgetMs;
    const report = this.timer.report(by);
    const cpu = (label: string, budget: number | undefined) => {
      const row = report.rows[label];
      if (!row || budget === undefined) return;
      row.cpuBudgetMs = budget;
      row.cpuOver = row.cpuMs > budget;
    };
    for (const def of FX_PASSES) cpu(`pass:${def.id}`, def.cpuBudgetMs);
    for (const def of FX_PRODUCTS) cpu(`product:${def.id}`, def.cpuBudgetMs);
    report.postCpuOver = report.postCpuMs > FX_TYPICAL_CPU_MS;
    return report;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const r = this.renderer;
    if (r.getRenderTarget() !== null) r.setRenderTarget(null);
    for (const p of this.productList) p.dispose();
    for (const p of this.passes) p.dispose();
    this.bufferA.dispose();
    this.bufferB.dispose();
    // This frees the depth texture with it, which is why a shared target detaches it first.
    this.sceneTarget.dispose();
    disposeFullscreenMeshes();
    this.timer.dispose();
    this.passes.length = 0;
    this.defs.length = 0;
    this.productList.length = 0;
    this.productDefs.length = 0;
    this.byPassId.clear();
    this.byProductId.clear();
  }

  /** Ask for a product and for everything it is built from; a kept set, so nothing is allocated. */
  private want(id: FxProductId): void {
    if (this.wanted.has(id)) return;
    const p = this.byProductId.get(id);
    if (!p) return;
    this.wanted.add(id);
    const needs = p.needs(this.ctx);
    for (let i = 0; i < needs.length; i++) this.want(needs[i]);
  }

  /** The debug view's texture, when it is showing a pass's own working one. */
  private fillDebugView(): void {
    const id = this.ctx.debugViewPass;
    const view = this.byPassId.get('debugView') as DebugViewPass | undefined;
    if (!view || !id || !view.show) return;
    const pass = this.byPassId.get(id);
    const want = view.show.slice(view.show.indexOf('.') + 1);
    view.external = pass?.debugTextures?.().find((t) => t.name === want) ?? null;
  }

  private setSizeAll(w: number, h: number): void {
    this.sceneTarget.setSize(w, h);
    this.bufferA.setSize(w, h);
    this.bufferB.setSize(w, h);
    for (const p of this.productList) p.setSize(w, h, this.settings);
    for (const p of this.passes) p.setSize(w, h, this.settings);
    this.ctx.width = w;
    this.ctx.height = h;
  }

  /**
   * A geometry product must never sample the scene's depth: with a target that depth is attached to
   * bound, the browser throws the draw away and says nothing. Catch it at registration rather than
   * wondering why an effect is missing.
   */
  private checkNoDepthSampling(product: FxProduct): void {
    if (product.kind !== 'geometry') return;
    const depth = this.sceneTarget.depthTexture;
    for (const item of product.materials()) {
      const uniforms = (item.material as THREE.ShaderMaterial).uniforms;
      if (!uniforms) continue;
      for (const name of Object.keys(uniforms)) {
        if (uniforms[name].value === depth) throw new Error(`fx: the geometry product "${product.id}" samples the scene depth through "${name}"`);
      }
    }
  }

  /** Roughly what the chain holds on the card, in megabytes. */
  private memoryMB(): number {
    const px = this.sizeV.x * this.sizeV.y;
    // Scene colour, its depth and stencil, and the two chain buffers.
    let bytes = px * 8 + px * 4 + px * 8 * 2;
    for (let i = 0; i < this.productList.length; i++) {
      const def = this.productDefs[i];
      const scale = def.scale * def.scale;
      // A product that has given its storage back holds nothing; one with several targets holds each.
      if (this.productList[i].allocated === false) continue;
      bytes += px * scale * (FORMAT_BYTES[def.format] ?? 4) * (def.targets ?? 1);
    }
    // The bloom's bright target and its ten blur levels, each half of the one before.
    if (this.byPassId.has('bloom')) bytes += px * 8 * 0.5;
    // The lens flare's half-size element target (its two 2x1 visibility targets are too small to count).
    if (this.byPassId.has('lensFlare')) bytes += px * 8 * 0.25;
    return Math.round(bytes / (1024 * 1024));
  }

  /** Read the frame just drawn and count the pixels that are not numbers (half floats with every exponent bit set and a mantissa). */
  private scan(rt: THREE.WebGLRenderTarget): void {
    const w = rt.width;
    const h = rt.height;
    const buf = new Uint16Array(w * h * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    let bad = 0;
    let first: [number, number] | null = null;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i];
      if ((v & 0x7c00) === 0x7c00 && (v & 0x03ff) !== 0) {
        bad++;
        if (!first) {
          const px = (i >> 2) % w;
          const py = Math.floor((i >> 2) / w);
          // Read-back rows run from the bottom; the screen counts from the top.
          first = [px, h - 1 - py];
        }
      }
    }
    this.lastScan = { width: w, height: h, bad, first };
  }
}
