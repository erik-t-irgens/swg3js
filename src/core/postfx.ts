// The picture after the frame: the portal renderer draws its passes into a high-range target
// instead of the screen, and the target goes out through bloom (the bright parts spilling over,
// for the engine glows, the bolts and the suns), a motion blur (what moves across the picture
// as the camera moves is smeared along its movement: the ground rushing by under a ship at
// speed, a wall sweeping past in a turn, while the ship itself and the far sky stay sharp), and
// the output pass, which does the tone mapping and colour space the renderer did on its own
// before. Three applies its tone mapping only when drawing to the screen, so the materials come
// out linear into the target and the output pass maps them once; turning this on or off changes
// every material's program, a recompile of them all.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

/**
 * A camera motion blur from the depth buffer: each pixel's point is found in the world from its
 * depth, projected with the last frame's camera to see where it was on the screen, and the
 * colour is averaged along that movement. Nothing is stored per object, so what moves with the
 * camera (the ship flown) stays sharp, and what the camera moves past smears in proportion.
 */
const MOTION_BLUR = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uInvViewProj: { value: new THREE.Matrix4() },
    uPrevViewProj: { value: new THREE.Matrix4() },
    /** How much of the movement is smeared (0 none, 1 the whole frame's). */
    uStrength: { value: 0.5 },
    /** The longest smear, as a share of the screen. */
    uMaxLength: { value: 0.04 },
    /** The camera's near and far planes, to turn depth into distance. */
    uNearFar: { value: new THREE.Vector2(0.05, 9000) },
    /** Nothing nearer than the first distance smears, everything past the second does: what moves with the camera (the ship flown, a cockpit) sits close and stays sharp. */
    uNearCut: { value: new THREE.Vector2(25, 60) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform mat4 uInvViewProj;
    uniform mat4 uPrevViewProj;
    uniform float uStrength;
    uniform float uMaxLength;
    uniform vec2 uNearFar;
    uniform vec2 uNearCut;
    varying vec2 vUv;
    void main() {
      float depth = texture2D(tDepth, vUv).x;
      float ndcZ = depth * 2.0 - 1.0;
      vec4 clip = vec4(vUv * 2.0 - 1.0, ndcZ, 1.0);
      vec4 world = uInvViewProj * clip;
      world /= world.w;
      vec4 prev = uPrevViewProj * world;
      vec2 prevUv = prev.xy / prev.w * 0.5 + 0.5;
      // How far away the point is: what is close moves with the camera (the hull, the cockpit) and is left sharp.
      float dist = (2.0 * uNearFar.x * uNearFar.y) / (uNearFar.y + uNearFar.x - ndcZ * (uNearFar.y - uNearFar.x));
      vec2 v = (vUv - prevUv) * uStrength * smoothstep(uNearCut.x, uNearCut.y, dist);
      float len = length(v);
      if (len > uMaxLength) v *= uMaxLength / len;
      // Nothing to do for a still pixel: the sharp picture as it is.
      if (len < 0.0005) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }
      vec4 c = vec4(0.0);
      const int N = 12;
      for (int i = 0; i < N; i++) {
        float t = float(i) / float(N - 1) - 0.5;
        c += texture2D(tDiffuse, vUv + v * t);
      }
      gl_FragColor = c / float(N);
    }
  `,
};

/**
 * A pixel that is not a number (a material that divided by zero: a degenerate tangent, a zero
 * roughness against a reflection) is black to the screen, and the bloom's blur spreads it into
 * a black box the size of its coarsest level. Such pixels are made black-and-opaque before the
 * effects see them, and the brightest are held to a ceiling.
 */
const SANITIZE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 256.0), 1.0);
    }
  `,
};

/** What a scan of the frame's own pixels found: how many were not numbers, and where the first was (from the top left, in pixels). */
export interface BadPixels {
  width: number;
  height: number;
  bad: number;
  first: [number, number] | null;
}

export interface PostFXOptions {
  bloom: boolean;
  /** How much the bright parts spill: 0.1 a touch, 0.5 a glow, 1 a haze. */
  bloomStrength: number;
  motionBlur: boolean;
  /** How much of a frame's movement is smeared: 0.2 a hint, 0.5 a film's, 1 the whole. */
  motionBlurStrength: number;
}

/** The blur is scaled as if every frame lasted this long, so a slow frame is not a longer smear. */
const SHUTTER = 1 / 60;
const viewProj = new THREE.Matrix4();

export class PostFX {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly blur: ShaderPass;
  private readonly output: OutputPass;
  private readonly size = new THREE.Vector2();
  private readonly prevViewProj = new THREE.Matrix4();
  private prevValid = false;
  /** The depth of the frame drawn since `begin`: the buffer drawn into changes from frame to frame. */
  private depth: THREE.Texture | null = null;
  readonly options: PostFXOptions;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    options: PostFXOptions,
  ) {
    this.options = { ...options };
    renderer.getDrawingBufferSize(this.size);
    // The frame's own target: a stencil for the portals, a depth buffer the blur can read as a
    // texture, and half floats for light brighter than white. It is not multisampled: the
    // renderer resolves a multisampled target after every render() call, and the portal
    // renderer makes a dozen of those a frame (the shadows, the world, each building's doors,
    // depth reset and rooms), so multisampling here cost a full-screen resolve per pass and
    // took the frame from 144 to 11 a second. The edges are smoothed by FXAA at the end instead.
    const depthTexture = new THREE.DepthTexture(this.size.x, this.size.y, THREE.UnsignedInt248Type);
    depthTexture.format = THREE.DepthStencilFormat;
    this.target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, stencilBuffer: true, depthBuffer: true, samples: 0, depthTexture });
    this.composer = new EffectComposer(renderer, this.target);
    this.composer.setPixelRatio(1);
    this.composer.setSize(this.size.x, this.size.y);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.size.x / 2, this.size.y / 2), options.bloomStrength, 0.5, 0.85);
    this.blur = new ShaderPass(MOTION_BLUR);
    this.output = new OutputPass();
    this.fxaa = new ShaderPass(FXAAShader);
    this.sanitize = new ShaderPass(SANITIZE);
    this.composer.addPass(this.sanitize);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.blur);
    this.composer.addPass(this.output);
    this.composer.addPass(this.fxaa);
    this.setFxaaSize();
    this.apply();
  }

  private readonly fxaa: ShaderPass;
  private readonly sanitize: ShaderPass;
  /** Set to scan the next frame's pixels before the effects; the result lands in `lastScan`. */
  wantScan = false;
  lastScan: BadPixels | null = null;

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

  private setFxaaSize(): void {
    (this.fxaa.uniforms.resolution as { value: THREE.Vector2 }).value.set(1 / Math.max(1, this.size.x), 1 / Math.max(1, this.size.y));
  }

  /** Take the options as they now are. */
  set(options: Partial<PostFXOptions>): void {
    Object.assign(this.options, options);
    this.apply();
  }

  private apply(): void {
    this.bloom.enabled = this.options.bloom && this.options.bloomStrength > 0;
    this.bloom.strength = this.options.bloomStrength;
    this.blur.enabled = false;
  }

  /** The screen changed size or scale: the target and the passes follow the drawing buffer. */
  setSize(): void {
    this.renderer.getDrawingBufferSize(this.size);
    this.composer.setSize(this.size.x, this.size.y);
    this.bloom.setSize(this.size.x / 2, this.size.y / 2);
    this.setFxaaSize();
    this.prevValid = false;
  }

  /**
   * Before the frame's passes: they draw into the composer's read buffer. The composer swaps
   * its two buffers after every pass that writes across, so which of them is the read buffer
   * changes from frame to frame; drawing into a fixed one showed every other frame black.
   */
  begin(): void {
    const rt = this.composer.readBuffer;
    this.depth = rt.depthTexture;
    this.renderer.setRenderTarget(rt);
  }

  /** After the frame's passes: the picture goes out through the effects, blurred by how the camera moved since the last frame (`dt` seconds ago). */
  end(camera: THREE.Camera, dt: number): void {
    if (this.wantScan) {
      this.wantScan = false;
      this.scan(this.composer.readBuffer);
    }
    this.renderer.setRenderTarget(null);
    const on = this.options.motionBlur && this.options.motionBlurStrength > 0 && !!this.depth;
    this.blur.enabled = on;
    if (on) {
      const u = this.blur.uniforms;
      camera.updateMatrixWorld();
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      if (!this.prevValid) {
        this.prevViewProj.copy(viewProj);
        this.prevValid = true;
      }
      (u.tDepth as { value: THREE.Texture | null }).value = this.depth;
      (u.uInvViewProj as { value: THREE.Matrix4 }).value.copy(viewProj).invert();
      (u.uPrevViewProj as { value: THREE.Matrix4 }).value.copy(this.prevViewProj);
      (u.uStrength as { value: number }).value = this.options.motionBlurStrength * THREE.MathUtils.clamp(SHUTTER / Math.max(dt, 1e-3), 0.25, 2);
      const persp = camera as THREE.PerspectiveCamera;
      if (persp.isPerspectiveCamera) (u.uNearFar as { value: THREE.Vector2 }).value.set(persp.near, persp.far);
      this.prevViewProj.copy(viewProj);
    }
    this.composer.render();
  }

  /** The camera was moved by a jump, not a motion (a teleport, a new world): the next frame blurs nothing. */
  reset(): void {
    this.prevValid = false;
  }

  dispose(): void {
    this.renderer.setRenderTarget(null);
    this.composer.dispose();
    this.target.dispose();
  }
}
