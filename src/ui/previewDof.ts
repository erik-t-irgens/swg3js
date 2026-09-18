// The wardrobe doll's lens: the smallest depth of field worth having on the character preview.
//
// At the doll's default head-to-toe framing a real lens shows nothing (the figure is half a metre
// deep at four metres), and a faked blur would hide the clothes the panel exists to show, so the doll
// draws exactly as it always has, straight onto its multisampled canvas, until the largest blur a lens
// could show on it passes a pixel: in practice, wheeled in on the face. Past that point the doll is
// drawn into a 4-sample half-float target of its own (one render call, so one resolve, which is what
// the canvas's own multisampling costs too), and one full-screen pass blurs it by depth onto the
// canvas: a 16-tap gather in premultiplied colour (the canvas is see-through over the panel's
// gradient, and the hair's coverage must blur with its colour), NaN and Inf held off, then the tone
// curve and sRGB that the doll's materials would have applied themselves, since with a target bound
// three draws them linear.
//
// This is the preview's own renderer and context: nothing of the game's effects chain is reachable
// from here, and nothing here touches it.
import * as THREE from 'three';
import { createFxQuad, FX_CAMERA } from '../core/fx/pass';
import { PREVIEW_DOF, type PreviewSpan, glslVec2Array, vogelTaps } from '../core/fx/dofMath.ts';

/** What the settings ask of every doll: App keeps it in step with Effects and Depth of field. `view` 1 forces the lens and shows the CoC. */
export interface PreviewEffects {
  on: boolean;
  strength: number;
  view: 0 | 1;
}

export interface PreviewReport {
  running: boolean;
  path: 'lens' | 'direct';
  /** Drawing-buffer px of the largest blur the doll can show from here (previewGate), 0 when the effect is off. */
  gate: number;
  maxRadiusPx: number;
  span: PreviewSpan;
  /** The lens target's drawing-buffer size, null before the lens path first drew. */
  size: [number, number] | null;
  /** Both program variants compiled for the doll as it is now. */
  warmed: boolean;
}

const VERT = /* glsl */ `
  precision highp float;
  in vec3 position;
  in vec2 uv;
  out vec2 vUv;
  void main() {
    vUv = uv;
    // The shared triangle's positions are already in clip space.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  precision highp int;
  precision highp sampler2D;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform float uNear, uFar, uFallbackFocus, uCocScale, uMaxRadius, uHaloRadius;
  uniform int uView;
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  in vec2 vUv;
  out vec4 fragColor;
  ${glslVec2Array('PREVIEW_TAPS', vogelTaps(16))}
  float viewZ(float d) { float n = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - n * (uFar - uNear)); }
  // A doll material that made NaN or Inf (the Tatooine plant's class of fault) would spread over the
  // gather and pass through the un-premultiply to the canvas: such a texel is transparent black, and
  // colour is held to 256 as the main chain holds it.
  vec4 colorAt(ivec2 q) {
    vec4 c = texelFetch(tColor, q, 0);
    if (any(isnan(c)) || any(isinf(c))) return vec4(0.0);
    return vec4(clamp(c.rgb, 0.0, 256.0), clamp(c.a, 0.0, 1.0));
  }
  void main() {
    ivec2 size = textureSize(tColor, 0);
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec4 c = colorAt(p);
    float d0 = texelFetch(tDepth, p, 0).r;
    bool empty0 = d0 >= 1.0;
    // The focus: the surface at the view's centre, or the doll's middle where the centre is empty.
    float dc = texelFetch(tDepth, size / 2, 0).r;
    float fd = 1.0 / (dc < 1.0 ? viewZ(dc) : uFallbackFocus);
    float z0 = viewZ(d0);
    float r0 = empty0 ? 0.0 : clamp(uCocScale * (fd - 1.0 / z0), -uMaxRadius, uMaxRadius);
    if (uView == 1) {
      fragColor = vec4(abs(r0) < 0.5 ? vec3(0.1, 0.6, 0.1) : r0 < 0.0 ? vec3(0.8, 0.1, 0.1) : vec3(0.1, 0.1, 0.8), 1.0) * c.a;
      return;
    }
    // Blur size here: its own; an empty pixel looks as far as the doll's largest blur, so a soft edge can spill onto it.
    float R = empty0 ? uHaloRadius : abs(r0);
    if (R >= 0.5) {
      vec4 acc = c;
      float tot = 1.0;
      for (int i = 0; i < 16; i++) {
        vec2 o = PREVIEW_TAPS[i] * R;
        float dist = length(o);
        ivec2 q = clamp(p + ivec2(round(o)), ivec2(0), size - 1);
        float dq = texelFetch(tDepth, q, 0).r;
        float rq;
        if (dq >= 1.0) rq = abs(r0);                                       // the void mixes into a blurred edge from within, never over a sharp one
        else {
          float zq = viewZ(dq);
          rq = abs(clamp(uCocScale * (fd - 1.0 / zq), -uMaxRadius, uMaxRadius));
          if (!empty0 && zq > z0) rq = min(rq, 2.0 * abs(r0));             // farther than this pixel: may not cover it when it is sharper
        }
        float m = smoothstep(dist - 0.5, dist + 0.5, rq);
        acc += colorAt(q) * m + c * (1.0 - m);
        tot += 1.0;
      }
      c = acc / tot;
    }
    // Premultiplied in, premultiplied out: the curve applies to the colour, not to its coverage.
    vec3 rgb = c.a > 1e-4 ? min(c.rgb / c.a, vec3(256.0)) : vec3(0.0);
    #if defined( LINEAR_TONE_MAPPING )
      rgb = LinearToneMapping(rgb);
    #elif defined( REINHARD_TONE_MAPPING )
      rgb = ReinhardToneMapping(rgb);
    #elif defined( CINEON_TONE_MAPPING )
      rgb = CineonToneMapping(rgb);
    #elif defined( ACES_FILMIC_TONE_MAPPING )
      rgb = ACESFilmicToneMapping(rgb);
    #elif defined( AGX_TONE_MAPPING )
      rgb = AgXToneMapping(rgb);
    #elif defined( NEUTRAL_TONE_MAPPING )
      rgb = NeutralToneMapping(rgb);
    #endif
    vec4 outc = vec4(rgb, 1.0);
    #ifdef SRGB_TRANSFER
      outc = sRGBTransferOETF(outc);
    #endif
    fragColor = vec4(outc.rgb * c.a, c.a);
  }
`;

/** The tone curve's define, as three's own output pass names it. */
const TONE_DEFINES: Partial<Record<THREE.ToneMapping, string>> = {
  [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING',
  [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
  [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING',
  [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
  [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING',
  [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
};

export class PreviewDof {
  /** The context can multisample a half-float target (EXT_color_buffer_float); without it the doll stays on the direct path. */
  static supported(renderer: THREE.WebGLRenderer): boolean {
    return renderer.extensions.has('EXT_color_buffer_float');
  }

  /** Last lens frame. `calls` and `triangles` are the whole frame's (the scene into the target, then the lens quad): three resets its counts on every render(). */
  readonly last: { maxRadiusPx: number; size: [number, number] | null; calls: number; triangles: number } = { maxRadiusPx: 0, size: null, calls: 0, triangles: 0 };
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.RawShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly lastSize: [number, number] = [0, 0];
  private wantW = 1;
  private wantH = 1;
  private toneMapping: THREE.ToneMapping | null = null;
  private colorSpace: string | null = null;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    // DepthFormat with 32-bit unsigned storage is DEPTH_COMPONENT24, which is what three gives the
    // multisampled depth renderbuffer, so the resolve can blit depth into it.
    const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    depth.format = THREE.DepthFormat;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthBuffer: true,
      // No stencil: the doll's materials are the world's, registered with the portal stencil, and
      // with no stencil buffer the test passes, as it does on the preview's own canvas.
      stencilBuffer: false,
      depthTexture: depth,
      generateMipmaps: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.target.texture.name = 'preview.dof';
    this.material = new THREE.RawShaderMaterial({
      name: 'PreviewDof',
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uNear: { value: 0.05 },
        uFar: { value: 40 },
        uFallbackFocus: { value: 3 },
        uCocScale: { value: 0 },
        uMaxRadius: { value: 1 },
        uHaloRadius: { value: 0 },
        uView: { value: 0 },
        toneMappingExposure: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.quad = createFxQuad(this.material);
    this.syncDefines();
  }

  /** The tone curve and the colour space the canvas wants, as defines (a change recompiles, as three's own output pass does). */
  private syncDefines(): void {
    const r = this.renderer;
    if (this.toneMapping === r.toneMapping && this.colorSpace === r.outputColorSpace) return;
    this.toneMapping = r.toneMapping;
    this.colorSpace = r.outputColorSpace;
    const defines: Record<string, string> = {};
    const tone = TONE_DEFINES[r.toneMapping];
    if (tone) defines[tone] = '';
    if (THREE.ColorManagement.getTransfer(r.outputColorSpace) === THREE.SRGBTransfer) defines.SRGB_TRANSFER = '';
    this.material.defines = defines;
    this.material.needsUpdate = true;
  }

  /** The scene into the 4-sample target (one render call, one resolve), then the lens pass onto the canvas. */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, span: PreviewSpan, gate: number, strength: number, view: 0 | 1): void {
    const r = this.renderer;
    this.syncDefines();
    if (this.target.width !== this.wantW || this.target.height !== this.wantH) this.target.setSize(this.wantW, this.wantH);
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.target);
    // autoClear: the target starts transparent black (the renderer was made with alpha).
    r.render(scene, camera);
    r.setRenderTarget(prev);
    const sceneCalls = r.info.render.calls;
    const sceneTriangles = r.info.render.triangles;
    const h = this.target.height;
    const u = this.material.uniforms;
    u.tColor.value = this.target.texture;
    u.tDepth.value = this.target.depthTexture;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uFallbackFocus.value = Math.max(camera.near, span.focus);
    u.uCocScale.value = PREVIEW_DOF.cocPerDioptre * h * strength;
    u.uMaxRadius.value = Math.max(1, PREVIEW_DOF.maxRadius * h * strength);
    u.uHaloRadius.value = Math.min(u.uMaxRadius.value, gate);
    u.toneMappingExposure.value = r.toneMappingExposure;
    u.uView.value = view;
    // Clears the canvas, then the triangle covers every pixel with no blending.
    r.render(this.quad, FX_CAMERA);
    this.last.calls = sceneCalls + r.info.render.calls;
    this.last.triangles = sceneTriangles + r.info.render.triangles;
    this.last.maxRadiusPx = u.uMaxRadius.value;
    this.lastSize[0] = this.target.width;
    this.lastSize[1] = this.target.height;
    this.last.size = this.lastSize;
  }

  /** Drawing-buffer pixels (renderer.getDrawingBufferSize); remembered, applied to the target on the next lens frame. */
  setSize(width: number, height: number): void {
    this.wantW = Math.max(1, Math.round(width));
    this.wantH = Math.max(1, Math.round(height));
  }

  /**
   * Compile, without drawing: the scene's materials for the lens target (linear, not tone-mapped) and
   * for the canvas (the direct path), and the lens material. Building a program is synchronous inside
   * compileAsync, so the target can be put back straight after; an already-built one is a lookup.
   */
  async warm(scene: THREE.Scene, camera: THREE.PerspectiveCamera): Promise<void> {
    const r = this.renderer;
    this.syncDefines();
    const prev = r.getRenderTarget();
    const jobs: Promise<unknown>[] = [];
    r.setRenderTarget(this.target);
    try {
      jobs.push(r.compileAsync(scene, camera));
    } finally {
      r.setRenderTarget(prev);
    }
    jobs.push(r.compileAsync(scene, camera));
    jobs.push(r.compileAsync(this.quad, FX_CAMERA));
    await Promise.all(jobs.map((j) => j.catch(() => {})));
  }

  /** Free the target's GPU memory (the panel closed): it shrinks to 1x1; the next lens frame sizes it again. */
  release(): void {
    this.target.setSize(1, 1);
    this.last.size = null;
  }

  dispose(): void {
    // Disposing the target disposes its depth texture with it.
    this.target.dispose();
    this.material.dispose();
    // The quad's triangle is the effects' shared geometry: never disposed.
  }
}
