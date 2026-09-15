// The picture after the frame: the portal renderer draws its passes into a high-range target
// instead of the screen, and the target goes out through bloom (the bright parts spilling over,
// for the engine glows, the bolts and the suns), a speed blur (the edges of the picture streaked
// toward the centre at speed, a racer's), and the output pass, which does the tone mapping and
// colour space the renderer did on its own before. Three applies its tone mapping only when
// drawing to the screen, so the materials come out linear into the target and the output pass
// maps them once; turning this on or off changes every material's program, a recompile of them all.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const SPEED_BLUR = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** How far the edge of the picture streaks toward the centre, as a share of its distance (0 none). */
    uAmount: { value: 0 },
    uCentre: { value: new THREE.Vector2(0.5, 0.5) },
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
    uniform float uAmount;
    uniform vec2 uCentre;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - uCentre;
      // The middle stays sharp: the streak grows with the distance from the centre, squared.
      float w = uAmount * dot(d, d) * 2.0;
      vec4 c = vec4(0.0);
      const int N = 10;
      for (int i = 0; i < N; i++) {
        float t = float(i) / float(N - 1);
        c += texture2D(tDiffuse, vUv - d * w * t);
      }
      gl_FragColor = c / float(N);
    }
  `,
};

export interface PostFXOptions {
  bloom: boolean;
  /** How much the bright parts spill: 0.1 a touch, 0.5 a glow, 1 a haze. */
  bloomStrength: number;
  speedBlur: boolean;
}

export class PostFX {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly blur: ShaderPass;
  private readonly output: OutputPass;
  private readonly size = new THREE.Vector2();
  readonly options: PostFXOptions;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    options: PostFXOptions,
  ) {
    this.options = { ...options };
    renderer.getDrawingBufferSize(this.size);
    // The frame's own target: a stencil for the portals, a depth buffer, half floats for light
    // brighter than white, and the same multisampling the screen had.
    this.target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, stencilBuffer: true, depthBuffer: true, samples: 4 });
    this.composer = new EffectComposer(renderer, this.target);
    this.composer.setPixelRatio(1);
    this.composer.setSize(this.size.x, this.size.y);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.size.x / 2, this.size.y / 2), options.bloomStrength, 0.5, 0.85);
    this.blur = new ShaderPass(SPEED_BLUR);
    this.output = new OutputPass();
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.blur);
    this.composer.addPass(this.output);
    this.apply();
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
  }

  /**
   * Before the frame's passes: they draw into the composer's read buffer. The composer swaps
   * its two buffers after every pass that writes across, so which of them is the read buffer
   * changes from frame to frame; drawing into a fixed one showed every other frame black.
   */
  begin(): void {
    this.renderer.setRenderTarget(this.composer.readBuffer);
  }

  /**
   * After the frame's passes: the picture goes out through the effects. `speedBlur` is how hard
   * the edges streak (0 none, 1 hard), and `centre` where they streak toward on the screen (0 to 1).
   */
  end(speedBlur = 0, centre?: THREE.Vector2): void {
    this.renderer.setRenderTarget(null);
    const amount = this.options.speedBlur ? THREE.MathUtils.clamp(speedBlur, 0, 1) : 0;
    this.blur.enabled = amount > 0.002;
    (this.blur.uniforms.uAmount as { value: number }).value = amount * 0.9;
    if (centre) (this.blur.uniforms.uCentre as { value: THREE.Vector2 }).value.copy(centre);
    this.composer.render();
  }

  dispose(): void {
    this.renderer.setRenderTarget(null);
    this.composer.dispose();
    this.target.dispose();
  }
}
