// The two things nearly every effect wants and none of them should work out for itself: how far
// away each pixel is, in metres, and which way its surface faces. Both are computed at half the
// screen's edge, which is a quarter of the work, and both are computed only when a pass that is
// drawing this frame asks for them.
//
// They sample the scene's depth texture while drawing into a target of their own, which is the
// only way a depth texture may be read: with the target it belongs to bound, the draw is thrown
// away and nothing says so.
import * as THREE from 'three';
import type { FxProductId, FxSettings } from '../fxRegistry.ts';
import type { FxFrameContext } from './context';
import { createFxQuad, FX_CAMERA, NO_PRODUCTS, type FxProduct, type FxWarmItem } from './pass';
import { FX_FULLSCREEN_VERTEX, FX_LINEARIZE, FX_VIEW_POS } from './glsl';

const halfOf = (v: number) => Math.max(1, Math.ceil(v / 2));

/**
 * Distance along the view axis, in metres, at half the screen's edge. Anything that wrote no depth
 * (the sky, particles, water, glows) reads as the far plane.
 *
 * Full floats rather than halves: at a near plane of five centimetres the depth buffer resolves
 * about a millimetre at ten metres, and half floats would throw that away right in front of the
 * eye. The target is under four megabytes at 1440p.
 */
export class LinearDepthHalf implements FxProduct {
  readonly id: FxProductId = 'linearDepthHalf';
  readonly kind = 'depth' as const;
  readonly timerLabel = 'product:linearDepthHalf';
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.FloatType,
      format: THREE.RedFormat,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.target.texture.name = 'fx.linearDepthHalf';
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: null },
        uNearFar: { value: new THREE.Vector2(0.05, 9000) },
        uFullTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: FX_FULLSCREEN_VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDepth;
        uniform vec2 uNearFar;
        uniform vec2 uFullTexel;
        varying vec2 vUv;
        ${FX_LINEARIZE}
        void main() {
          // A half-size pixel's centre falls exactly on the seam between two full-size pixels, and
          // which side of a seam a card rounds to is its own business; half a full pixel over puts
          // the sample inside one corner of the two-by-two block and keeps it there, which is what
          // anything upsampling this back to full size has to be able to count on.
          float d = texture2D(tDepth, vUv + uFullTexel * 0.5).x;
          gl_FragColor = vec4(d >= 1.0 ? uNearFar.y : fxViewZ(d, uNearFar.x, uNearFar.y), 0.0, 0.0, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.quad = createFxQuad(this.material);
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return NO_PRODUCTS;
  }

  render(ctx: FxFrameContext): void {
    this.material.uniforms.tDepth.value = ctx.depth;
    (this.material.uniforms.uNearFar.value as THREE.Vector2).set(ctx.near, ctx.far);
    ctx.renderer.setRenderTarget(this.target);
    ctx.renderer.render(this.quad, FX_CAMERA);
  }

  setSize(width: number, height: number, _settings: FxSettings): void {
    this.target.setSize(halfOf(width), halfOf(height));
    (this.material.uniforms.uFullTexel.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }

  materials(): FxWarmItem[] {
    return [{ material: this.material }];
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}

/**
 * Which way each surface faces, in the camera's own space, from the distances around it. Each axis
 * takes its difference from whichever neighbour is nearer, so the silhouette of a near object does
 * not bend the normal of the far one behind it. Alpha is 1 where there is geometry and 0 for sky.
 */
export class NormalsHalf implements FxProduct {
  readonly id: FxProductId = 'normalsHalf';
  readonly kind = 'depth' as const;
  readonly timerLabel = 'product:normalsHalf';
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly wants: readonly FxProductId[] = ['linearDepthHalf'];

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.target.texture.name = 'fx.normalsHalf';
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tLinear: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uTanHalfFov: { value: new THREE.Vector2(1, 1) },
        uFar: { value: 9000 },
      },
      vertexShader: FX_FULLSCREEN_VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tLinear;
        uniform vec2 uTexel;
        uniform vec2 uTanHalfFov;
        uniform float uFar;
        varying vec2 vUv;
        ${FX_VIEW_POS}
        void main() {
          float z = texture2D(tLinear, vUv).r;
          if (z >= uFar * 0.999) { gl_FragColor = vec4(0.5, 0.5, 1.0, 0.0); return; }
          vec3 p = fxViewPos(vUv, z, uTanHalfFov);
          float zl = texture2D(tLinear, vUv - vec2(uTexel.x, 0.0)).r;
          float zr = texture2D(tLinear, vUv + vec2(uTexel.x, 0.0)).r;
          float zd = texture2D(tLinear, vUv - vec2(0.0, uTexel.y)).r;
          float zu = texture2D(tLinear, vUv + vec2(0.0, uTexel.y)).r;
          vec3 dx = abs(zr - z) < abs(z - zl)
            ? fxViewPos(vUv + vec2(uTexel.x, 0.0), zr, uTanHalfFov) - p
            : p - fxViewPos(vUv - vec2(uTexel.x, 0.0), zl, uTanHalfFov);
          vec3 dy = abs(zu - z) < abs(z - zd)
            ? fxViewPos(vUv + vec2(0.0, uTexel.y), zu, uTanHalfFov) - p
            : p - fxViewPos(vUv - vec2(0.0, uTexel.y), zd, uTanHalfFov);
          // Two samples at the same depth give a zero cross product; normalising it would be a
          // pixel that is not a number, and the bloom would spread that into a black box.
          vec3 c = cross(dx, dy);
          float l = length(c);
          vec3 n = l > 1e-8 ? c / l : vec3(0.0, 0.0, 1.0);
          gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.quad = createFxQuad(this.material);
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return this.wants;
  }

  render(ctx: FxFrameContext): void {
    const u = this.material.uniforms;
    u.tLinear.value = ctx.products.linearDepthHalf;
    (u.uTexel.value as THREE.Vector2).set(1 / this.target.width, 1 / this.target.height);
    (u.uTanHalfFov.value as THREE.Vector2).copy(ctx.tanHalfFov);
    u.uFar.value = ctx.far;
    ctx.renderer.setRenderTarget(this.target);
    ctx.renderer.render(this.quad, FX_CAMERA);
  }

  setSize(width: number, height: number, _settings: FxSettings): void {
    this.target.setSize(halfOf(width), halfOf(height));
  }

  materials(): FxWarmItem[] {
    return [{ material: this.material }];
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
