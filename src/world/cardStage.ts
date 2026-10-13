// A small off-screen stage the leaf cards' self-tests draw on (`cardsSelfTest`, `cardLightSelfTest`,
// `leafShadowSelfTest`): a scene of its own, an orthographic camera, a half-float target read back pixel by
// pixel, and a stand-in for the cascades' hook so a card's program takes the very branch of the cascades' light
// chunk the game's does. Nothing here is the world's: what a test makes it hands the stage (`own`), which lets
// all of it go with itself, and the renderer's own state (its target, its clear colour, its shadow switch) is put
// back whatever the test does.
import * as THREE from 'three';
import type { Wrappable } from './compileHooks.ts';

/** One pixel as the target holds it: scene-linear, before any tone mapping. */
export type Pixel = [number, number, number, number];

export class CardStage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly target: THREE.WebGLRenderTarget;
  readonly size: number;
  private readonly pixels: Uint16Array;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly prevTarget: THREE.WebGLRenderTarget | null;
  private readonly prevClear = new THREE.Color();
  private readonly prevAlpha: number;
  private readonly prevShadows: boolean;
  private readonly prevShadowType: THREE.ShadowMapType;
  /** What a test made on this stage, let go of with it whether or not it is still in the scene. */
  private readonly owned = new Set<{ dispose(): void }>();

  /** `half`: the half-width of the camera's view, metres. */
  constructor(renderer: THREE.WebGLRenderer, size = 32, half = 1.2) {
    this.renderer = renderer;
    this.size = size;
    this.camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 40);
    this.target = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, samples: 0 });
    this.pixels = new Uint16Array(size * size * 4);
    this.prevTarget = renderer.getRenderTarget();
    renderer.getClearColor(this.prevClear);
    this.prevAlpha = renderer.getClearAlpha();
    this.prevShadows = renderer.shadowMap.enabled;
    this.prevShadowType = renderer.shadowMap.type;
  }

  /**
   * A material, texture or geometry a test made, to be let go of with the stage: a test takes its things out of
   * the scene as it goes, and a material left alive keeps its program held for the session.
   */
  own<T extends { dispose(): void }>(thing: T): T {
    this.owned.add(thing);
    return thing;
  }

  /** The camera at `from`, looking at `to`. */
  view(from: THREE.Vector3, to: THREE.Vector3): void {
    this.camera.position.copy(from);
    this.camera.up.set(0, 1, 0);
    if (Math.abs(from.x - to.x) < 1e-6 && Math.abs(from.z - to.z) < 1e-6) this.camera.up.set(0, 0, -1);
    this.camera.lookAt(to);
    this.camera.updateMatrixWorld();
  }

  /** Draw the stage into its target (with the shadow maps drawn first when `shadows`) and keep its pixels. */
  render(shadows: boolean): void {
    const r = this.renderer;
    r.shadowMap.enabled = shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.camera);
    r.readRenderTargetPixels(this.target, 0, 0, this.size, this.size, this.pixels);
  }

  /** The pixel at a share of the target's width and height (0 to 1 from the bottom left). */
  at(u: number, v: number): Pixel {
    const i = Math.min(this.size - 1, Math.max(0, Math.floor(u * this.size)));
    const j = Math.min(this.size - 1, Math.max(0, Math.floor(v * this.size)));
    const k = (j * this.size + i) * 4;
    const f = THREE.DataUtils.fromHalfFloat;
    return [f(this.pixels[k]), f(this.pixels[k + 1]), f(this.pixels[k + 2]), f(this.pixels[k + 3])];
  }

  /** Everything the stage made let go of, and the renderer's own state put back. */
  dispose(): void {
    const r = this.renderer;
    r.setRenderTarget(this.prevTarget);
    r.setClearColor(this.prevClear, this.prevAlpha);
    r.shadowMap.enabled = this.prevShadows;
    r.shadowMap.type = this.prevShadowType;
    r.shadowMap.needsUpdate = true;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) this.owned.add(m.geometry);
      const l = o as THREE.DirectionalLight;
      if (l.isLight && l.shadow?.map) l.shadow.map.dispose();
    });
    for (const thing of this.owned) thing.dispose();
    this.owned.clear();
    this.target.dispose();
  }
}

/** A texture of one known texel, in sRGB as a converted picture is. */
export function texelTexture(rgba: [number, number, number, number]): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * The cascades' hook stood in for, on a material made for a self-test: the defines `CSM.setupMaterial` sets and
 * one cascade covering every depth, so the program takes the cascades' fade branch exactly as a card in the
 * world does (and its one-light branch with the shadow map off). It replaces the hook, as the cascades do, so
 * the wraps after it chain on it.
 */
export function standInCascades(mat: THREE.Material, camera: THREE.Camera & { near: number; far: number }): void {
  const defines = ((mat.defines ??= {}) as Record<string, string | number>);
  defines.USE_CSM = 1;
  defines.CSM_CASCADES = 1;
  defines.CSM_FADE = '';
  (mat as unknown as Wrappable).onBeforeCompile = function cascades(shader: { uniforms: Record<string, { value: unknown }> }) {
    shader.uniforms.CSM_cascades = { value: [new THREE.Vector2(0, 1)] };
    shader.uniforms.cameraNear = { value: camera.near };
    shader.uniforms.shadowFar = { value: camera.far };
  } as unknown as Wrappable['onBeforeCompile'];
}

/** A sun for the stage: a shadow-casting directional light toward `toward` from the stage's middle, its shadow camera boxing `half` metres. */
export function stageSun(stage: CardStage, toward: THREE.Vector3, intensity = Math.PI, half = 3): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xffffff, intensity);
  sun.position.copy(toward).normalize().multiplyScalar(10);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(256, 256);
  const c = sun.shadow.camera;
  c.left = -half;
  c.right = half;
  c.top = half;
  c.bottom = -half;
  c.near = 0.5;
  c.far = 20;
  c.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.01;
  stage.scene.add(sun, sun.target);
  return sun;
}
