// How a pass gets at the scene's own geometry without drawing the whole world again.
//
// A geometry product draws a short list of objects into a colour target of its own that has the
// scene's depth and stencil texture attached, read only: the depth test then says exactly what the
// picture says, the stencil says which region of a portal building each pixel belongs to, and
// nothing is written back. The draw goes through a proxy scene that lists the objects where they
// already stand, so no matrices are recomputed and the portal renderer never sees it.
//
// Three rules that are not obvious and cost a frame each to relearn:
//   - a target sharing the scene's depth texture must be exactly the scene target's size, or the
//     framebuffer comes out incomplete;
//   - disposing a target disposes its depth texture, so a shared one is detached first;
//   - a product never samples that depth texture: reading it while a target it is attached to is
//     bound throws the draw away.
import * as THREE from 'three';
import type { FxProductId, FxSettings } from '../fxRegistry.ts';
import type { FxFrameContext } from './context';
import { NO_PRODUCTS, type FxProduct, type FxWarmItem } from './pass';
import type { PostFX } from '../postfx';

/** Every layer at once, as three's own `enableAll` writes it. */
export const FX_ALL_LAYERS = 0xffffffff | 0;

export function createSharedDepthTarget(postfx: PostFX, opts: { format: THREE.PixelFormat; type: THREE.TextureDataType; name: string; count?: number }): THREE.WebGLRenderTarget {
  const size = postfx.size;
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
    format: opts.format,
    type: opts.type,
    depthBuffer: true,
    stencilBuffer: true,
    samples: 0,
    count: opts.count ?? 1,
    depthTexture: postfx.sceneDepth,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  rt.texture.name = opts.name;
  return rt;
}

/** Free a target without taking the scene's depth texture with it. */
export function disposeSharedDepthTarget(rt: THREE.WebGLRenderTarget): void {
  rt.depthTexture = null;
  rt.dispose();
}

/**
 * Make a product's material test the stencil the way the picture was drawn, without writing it;
 * or not test it at all when the camera is not inside a building, where everything is region 1.
 */
export function applyFxStencil(material: THREE.Material, ctx: FxFrameContext, source: 'world' | 'interior' | 'actor'): void {
  const test = ctx.portalView && source !== 'actor';
  // Three turns the stencil test on with stencilWrite; the write mask below keeps it read only.
  material.stencilWrite = test;
  if (!test) return;
  material.stencilFunc = THREE.EqualStencilFunc;
  // Inside a building the world shows only through the exits, at 2; the rooms themselves are 1.
  material.stencilRef = source === 'world' ? 2 : 1;
  material.stencilFuncMask = 0xff;
  material.stencilWriteMask = 0x00;
  material.stencilFail = THREE.KeepStencilOp;
  material.stencilZFail = THREE.KeepStencilOp;
  material.stencilZPass = THREE.KeepStencilOp;
}

/**
 * Test the frame's depth, never write it. `sameSurfaceAsScene` nudges the draw a shade forward, for
 * a product redrawing surfaces the scene already drew: a different program can round its depth a
 * hair differently, and the test would then fail on the very surface it is meant to cover.
 */
export function geometryMaterialDefaults(material: THREE.Material, sameSurfaceAsScene: boolean): void {
  material.depthTest = true;
  material.depthWrite = false;
  material.depthFunc = THREE.LessEqualDepth;
  material.polygonOffset = sameSurfaceAsScene;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  material.blending = THREE.NoBlending;
}

export interface FxGeometryDrawer {
  /**
   * Draw these objects into the bound target with their own materials, or with `override`. They
   * stay where they are in the world: a proxy scene lists them without re-parenting them, their
   * matrices are this frame's and are not recomputed, and the camera sees `layersMask` for the call.
   */
  drawObjects(ctx: FxFrameContext, objects: readonly THREE.Object3D[], override: THREE.Material | null, layersMask: number): void;
  /** Draw a scene the product owns: its own meshes, placed at their sources each frame, and no lights. */
  drawScene(ctx: FxFrameContext, scene: THREE.Scene): void;
  /**
   * Render the empty proxy scene with `run` as its onAfterRender, so `run` may call renderer.renderBufferDirect
   * with a valid render state and no scene walk. Every mesh passed there must have been projected by the scene's
   * passes on this frame and an earlier one (buffers uploaded, skeleton updated). `run` must not throw: an exception
   * inside onAfterRender skips three's render-state pops.
   */
  drawDirect(ctx: FxFrameContext, run: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void): void;
}

/**
 * One proxy scene for every product: no fog, no lights, no matrix updating. Its children are
 * swapped for the list being drawn and put back straight after, so nothing is ever re-parented and
 * the objects go on being drawn normally by the portal renderer.
 */
class ProxyDrawer implements FxGeometryDrawer {
  private readonly proxy = new THREE.Scene();

  constructor() {
    this.proxy.matrixAutoUpdate = false;
    this.proxy.matrixWorldAutoUpdate = false;
  }

  drawObjects(ctx: FxFrameContext, objects: readonly THREE.Object3D[], override: THREE.Material | null, layersMask: number): void {
    if (!objects.length) return;
    const cam = ctx.camera;
    const mask = cam.layers.mask;
    const kept = this.proxy.children;
    this.proxy.children = objects as THREE.Object3D[];
    this.proxy.overrideMaterial = override;
    cam.layers.mask = layersMask;
    try {
      ctx.renderer.render(this.proxy, cam);
    } finally {
      this.proxy.children = kept;
      this.proxy.overrideMaterial = null;
      cam.layers.mask = mask;
    }
  }

  drawScene(ctx: FxFrameContext, scene: THREE.Scene): void {
    ctx.renderer.render(scene, ctx.camera);
  }

  private readonly none: THREE.Object3D[] = [];

  drawDirect(ctx: FxFrameContext, run: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void): void {
    const kept = this.proxy.children;
    this.proxy.children = this.none;
    this.proxy.onAfterRender = run;
    try {
      ctx.renderer.render(this.proxy, ctx.camera);
    } finally {
      this.proxy.onAfterRender = NOOP;
      this.proxy.children = kept;
    }
  }
}

/** Put back on the proxy after a direct draw; kept so the frame allocates nothing. */
const NOOP = (): void => {};

let drawer: ProxyDrawer | null = null;
function sharedDrawer(): FxGeometryDrawer {
  return (drawer ??= new ProxyDrawer());
}

const savedColor = new THREE.Color();

export abstract class GeometryProduct implements FxProduct {
  readonly kind = 'geometry' as const;
  readonly timerLabel: string;
  protected target: THREE.WebGLRenderTarget;
  protected readonly drawer: FxGeometryDrawer = sharedDrawer();

  protected constructor(
    readonly id: FxProductId,
    protected readonly postfx: PostFX,
    private readonly look: { format: THREE.PixelFormat; type: THREE.TextureDataType; clear: THREE.Color; clearAlpha: number; count?: number },
  ) {
    this.timerLabel = `product:${id}`;
    this.target = createSharedDepthTarget(postfx, { format: look.format, type: look.type, name: `fx.${id}`, count: look.count });
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  /** Every colour target this product writes; one, unless it asked for more. */
  get textures(): THREE.Texture[] {
    return this.target.textures;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return NO_PRODUCTS;
  }

  render(ctx: FxFrameContext): void {
    this.bindAndClear(ctx);
    this.draw(ctx);
  }

  /** Bind the target and clear its colour only: the frame's depth and stencil are what makes this worth doing. */
  protected bindAndClear(ctx: FxFrameContext): void {
    const r = ctx.renderer;
    r.setRenderTarget(this.target);
    r.getClearColor(savedColor);
    const savedAlpha = r.getClearAlpha();
    r.setClearColor(this.look.clear, this.look.clearAlpha);
    r.clear(true, false, false);
    r.setClearColor(savedColor, savedAlpha);
  }

  protected abstract draw(ctx: FxFrameContext): void;

  setSize(width: number, height: number, _settings: FxSettings): void {
    this.target.setSize(width, height);
  }

  abstract materials(): FxWarmItem[];

  dispose(): void {
    disposeSharedDepthTarget(this.target);
  }
}

/** A stand-in mesh to compile an override material with, so the program key matches the real draw. */
function dummyMesh(material: THREE.Material): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  return new THREE.Mesh(g, material);
}

/** The same for a skinned draw: three puts skinning in the program key, so it needs its own. */
function dummySkinnedMesh(material: THREE.Material): THREE.SkinnedMesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const bone = new THREE.Bone();
  const mesh = new THREE.SkinnedMesh(g, material);
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  return mesh;
}

/**
 * The player, and whatever they ride or are aboard, drawn flat white. Nothing in the game uses it:
 * it is here so that the shared depth, the proxy scene, the stencil helper and the resize path are
 * all proved in the real portal renderer before any effect depends on them. Turn it on with
 * `__debug.fxView('debugMask')`: the figure should be white, and cut off wherever a wall, a doorway
 * or a rise of ground stands in front of it.
 */
export class DebugMaskProduct extends GeometryProduct {
  private readonly white = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private readonly warmMesh: THREE.Mesh;
  private readonly warmSkinned: THREE.SkinnedMesh;

  constructor(postfx: PostFX) {
    super('debugMask', postfx, { format: THREE.RedFormat, type: THREE.UnsignedByteType, clear: new THREE.Color(0, 0, 0), clearAlpha: 1 });
    geometryMaterialDefaults(this.white, true);
    this.warmMesh = dummyMesh(this.white);
    this.warmSkinned = dummySkinnedMesh(this.white);
  }

  protected draw(ctx: FxFrameContext): void {
    applyFxStencil(this.white, ctx, 'actor');
    this.drawer.drawObjects(ctx, this.postfx.debugMaskObjects(), this.white, FX_ALL_LAYERS);
  }

  materials(): FxWarmItem[] {
    return [
      { material: this.white, object: this.warmMesh },
      { material: this.white, object: this.warmSkinned },
    ];
  }

  dispose(): void {
    super.dispose();
    this.white.dispose();
    this.warmMesh.geometry.dispose();
    this.warmSkinned.geometry.dispose();
  }
}
