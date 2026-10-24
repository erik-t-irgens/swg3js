// How the air's stages reach the card. Two ways, one switch (`AIR_DRAW.mode`), and the step's code is the same for
// both: a stage asks `draw(material, target)` and the drawer makes the draw.
//
// `calls`: one `renderer.render(quad, FX_CAMERA)` a stage, which is how every pass of the effects chain draws. Three
// does a little of its own work around every one (the render state, the lists, the lights' setup, the end-of-frame
// target work), and that work is what a stage costs the main thread.
//
// `direct`: the whole step runs inside one render call, from an empty proxy scene's `onAfterRender`, and every stage
// is a `setRenderTarget` and a `renderBufferDirect` on the shared triangle -- the velocity product's way
// (`src/core/fx/velocity.ts`). The traps come with it and each is kept here: nothing may throw out of the hook (three's
// render state would stay pushed), so the step runs inside a `try` and a throw stops the air for the session and says
// why; a direct draw skips three's own checks, so every material is compiled before its first direct draw; the same
// material drawn twice in a row is not uploaded again unless asked, so each draw asks (`uniformsNeedUpdate`); and the
// render call's own target is put back before the hook returns, so three's end-of-render work (mipmaps, a multisample
// resolve) acts on the target it began with.
//
// `probeAirDraws` times both ways on the game's own renderer (`__debug.air({ probe })`, the wave's first measurement,
// written into the notes).
import * as THREE from 'three';
import { createFxQuad, FX_CAMERA, FX_TRIANGLE } from '../../core/fx/pass.ts';
import { FX_FULLSCREEN_VERTEX } from '../../core/fx/glsl.ts';

/**
 * The way the step's stages are drawn, chosen by the wave's probe: in the game a plain stage cost the main thread about
 * 2.9 µs and a direct one about 1.4 µs, on both backends, against a ceiling of 9 µs (DESIGN §7.3), so the plain way is
 * the default and the direct way a switch (`__debug.air({ draw })`).
 */
export const AIR_DRAW = { mode: 'calls' as AirDrawMode };

export type AirDrawMode = 'calls' | 'direct';

const noopHook = (): void => {};

export class AirDrawer {
  /** The stages' way to the card; read at each `run`, so the console moves it between steps. */
  mode: AirDrawMode = AIR_DRAW.mode;
  /** Set when the step threw inside the render call: the air stops for the session and this says why. */
  broken: string | null = null;
  /** Draws made, since `count` was last read. */
  draws = 0;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly quad: THREE.Mesh;
  private readonly proxy: THREE.Scene;
  private work: (() => void) | null = null;
  private home: THREE.WebGLRenderTarget | null = null;
  private inside = false;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.quad = createFxQuad(new THREE.MeshBasicMaterial());
    this.proxy = new THREE.Scene();
    this.proxy.matrixAutoUpdate = false;
    this.proxy.matrixWorldAutoUpdate = false;
    this.proxy.onAfterRender = noopHook;
  }

  /**
   * Run `work`, every draw it makes going the drawer's way. `home` is the target the render call itself is begun on
   * when the draws are direct (any small target of the air's own: it is never drawn into by three, and is bound again
   * before the hook returns). Answers false when the work threw inside the render call.
   */
  run(work: () => void, home: THREE.WebGLRenderTarget): boolean {
    if (this.broken) return false;
    if (this.mode === 'calls') return this.runPlain(work);
    const r = this.renderer;
    this.work = work;
    this.home = home;
    const p = this.proxy;
    p.onAfterRender = this.hook;
    r.setRenderTarget(home);
    try {
      r.render(p, FX_CAMERA);
    } finally {
      p.onAfterRender = noopHook;
      this.work = null;
    }
    return this.broken === null;
  }

  /**
   * Run `work` the plain way whatever the mode: every draw it makes is a render call of its own. What a mesh of the
   * air's own needs (`drawMesh`), and what the plain mode runs. A throw stops the air for the session and says why, as
   * one inside the render call does: nothing of the air may throw out of a frame.
   */
  runPlain(work: () => void): boolean {
    if (this.broken) return false;
    try {
      work();
    } catch (err) {
      this.fail(err);
    }
    return this.broken === null;
  }

  private fail(err: unknown): void {
    this.broken = String((err as Error)?.message ?? err);
    console.error('air: the step failed; the moving air is off for this session', err);
  }

  private readonly hook = (): void => {
    const work = this.work;
    if (!work) return;
    this.inside = true;
    try {
      work();
    } catch (err) {
      this.fail(err);
    } finally {
      this.inside = false;
      this.renderer.setRenderTarget(this.home);
    }
  };

  /** One full-screen stage into `target` (null: the canvas, which the air never draws to). */
  draw(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    const r = this.renderer;
    r.setRenderTarget(target);
    this.draws++;
    const q = this.quad;
    q.material = material;
    if (this.inside) {
      // The same material drawn twice in a row is not uploaded again by three unless it is asked to be.
      material.uniformsNeedUpdate = true;
      r.renderBufferDirect(FX_CAMERA, this.proxy, FX_TRIANGLE, material, q, null as unknown as THREE.GeometryGroup);
    } else r.render(q, FX_CAMERA);
  }

  /**
   * A mesh of the air's own (the obstacles' instanced quads) into `target`, always a render call of its own and never
   * a direct draw, whatever the mode: three uploads a mesh's attributes (the boxes a gather wrote) only as it projects
   * the mesh in a render call, which a direct draw skips, so drawn directly the map would go on showing the boxes of
   * the last plain draw while the window moved into new streets -- and the very first direct draw, before any plain
   * one, would save a vertex state with no instance buffers for good (the velocity product's lesson). It is drawn only
   * when the window moved or the boxes were gathered again, so the plain call costs nothing a steady frame. The field
   * draws it through `runPlain`, outside the step's own render call.
   */
  drawMesh(mesh: THREE.Mesh, target: THREE.WebGLRenderTarget): void {
    if (this.inside) throw new Error('air: a mesh is drawn outside the step\'s render call (runPlain), never inside it');
    const r = this.renderer;
    r.setRenderTarget(target);
    this.draws++;
    r.render(mesh, FX_CAMERA);
  }

  /** Clear `target`'s colour to the renderer's clear colour (set by the caller). */
  clear(target: THREE.WebGLRenderTarget): void {
    this.renderer.setRenderTarget(target);
    this.renderer.clear(true, false, false);
  }

  /** How many draws since the last read, and starts the count again. */
  count(): number {
    const n = this.draws;
    this.draws = 0;
    return n;
  }

  dispose(): void {
    (this.quad.material as THREE.Material).dispose();
  }
}

/**
 * Compile a material of the air for drawing into a target, and record its version as three records it after its
 * own first draw, so the first direct draw neither works its program out again nor builds one (`compileVariant`'s
 * rule in the velocity product).
 */
export function compileAirMaterial(renderer: THREE.WebGLRenderer, material: THREE.Material, mesh: THREE.Object3D, target: THREE.WebGLRenderTarget): void {
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  try {
    renderer.compile(mesh, FX_CAMERA);
  } finally {
    renderer.setRenderTarget(prev);
  }
  const props = renderer.properties.get(material) as { currentProgram?: { getUniforms(): unknown } };
  props.currentProgram?.getUniforms();
}

/** What a probe found: the median and mean microseconds a draw cost the main thread, over its batches. */
export interface AirProbeResult {
  mode: AirDrawMode;
  draws: number;
  batches: number;
  medianUs: number;
  meanUs: number;
  /** The least and most a batch came to, a draw. */
  rangeUs: [number, number];
  /** Microseconds a draw at most for the main thread's 0.25 ms on a stepping frame of about 28 draws (DESIGN §7.3). */
  ceilingUs: number;
}

const PROBE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uK;
void main() {
  vec2 c = texture(uSrc, vUv).xy;
  vec2 l = texture(uSrc, vUv - vec2(uTexel.x, 0.0)).xy;
  vec2 r = texture(uSrc, vUv + vec2(uTexel.x, 0.0)).xy;
  vec2 b = texture(uSrc, vUv - vec2(0.0, uTexel.y)).xy;
  vec2 t = texture(uSrc, vUv + vec2(0.0, uTexel.y)).xy;
  gl_FragColor = vec4((l + r + b + t - 4.0 * c) * 0.25 * uK + c, 0.0, 1.0);
}`;

/**
 * Time `draws` full-screen draws into a 128² target a batch, `batches` times, the given way: the main thread's
 * cost a draw, for the decision §7.3 asks the wave to make before anything else. Console only: it allocates as it
 * likes and draws nothing anybody sees.
 */
export function probeAirDraws(renderer: THREE.WebGLRenderer, mode: AirDrawMode, draws = 200, batches = 31): AirProbeResult {
  const size = 128;
  const opts = { type: THREE.HalfFloatType, format: THREE.RGFormat, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter } as const;
  const a = new THREE.WebGLRenderTarget(size, size, opts);
  const b = new THREE.WebGLRenderTarget(size, size, opts);
  const home = new THREE.WebGLRenderTarget(1, 1, opts);
  const material = new THREE.ShaderMaterial({
    vertexShader: FX_FULLSCREEN_VERTEX,
    fragmentShader: PROBE_FRAGMENT,
    uniforms: { uSrc: { value: a.texture }, uTexel: { value: new THREE.Vector2(1 / size, 1 / size) }, uK: { value: 0.1 } },
    blending: THREE.NoBlending,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
  const drawer = new AirDrawer(renderer);
  drawer.mode = mode;
  const mesh = createFxQuad(material);
  const prevTarget = renderer.getRenderTarget();
  const prevAuto = renderer.autoClear;
  renderer.autoClear = false;
  const per: number[] = [];
  try {
    compileAirMaterial(renderer, material, mesh, a);
    let read = a;
    let write = b;
    const one = (): void => {
      for (let i = 0; i < draws; i++) {
        material.uniforms.uSrc.value = read.texture;
        drawer.draw(material, write);
        const s = read;
        read = write;
        write = s;
      }
    };
    // One batch untimed, so the first draws' own setup is not in the figure.
    drawer.run(one, home);
    for (let k = 0; k < batches; k++) {
      const t0 = performance.now();
      drawer.run(one, home);
      per.push(((performance.now() - t0) * 1000) / draws);
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    a.dispose();
    b.dispose();
    home.dispose();
    material.dispose();
    drawer.dispose();
  }
  const sorted = [...per].sort((x, y) => x - y);
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  return {
    mode,
    draws,
    batches,
    medianUs: r2(sorted[sorted.length >> 1] ?? 0),
    meanUs: r2(per.reduce((s, v) => s + v, 0) / Math.max(1, per.length)),
    rangeUs: [r2(sorted[0] ?? 0), r2(sorted[sorted.length - 1] ?? 0)],
    ceilingUs: 9,
  };
}
