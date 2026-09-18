// Heat haze: the client's 2d_heat_composite, over lava, behind running engines and in front of a held
// flame thrower.
//
// The heat product draws every source into a half-resolution RGBA16F buffer of its own, in a scene of
// its own on its own layer: red is intensity, green and blue the noise weighted by it, blended One,
// One so overlapping sources average (the composite reads the noise back as gb / r). Each source
// tests itself against the scene's depth texel for texel through `linearDepthHalf`, so heat behind a
// wall is not drawn and heat meeting a surface fades into it. Nothing here writes depth or touches the
// scene target, and the scene holds no light.
//
// The composite moves each pixel's uv by the noise, (n - 0.5) x r x 0.01 x strength (the client's
// offset at r = 1, centred so faint haze moves a little rather than a fixed amount), and keeps the
// move only where the pixel it lands on is also hot (the client's rule). A depth gate over the
// bilinear footprint keeps the shimmer off anything nearer than the heat it would borrow: a figure in
// front of lava does not take a hot neighbour's heat along its outline, and no hot pixel takes its
// colour from something nearer.
//
// Sources: the lava tables World hands to `HeatSources` (the table polygon floated two metres over
// the flow, faded from 71 to 84 m as the client did, drawn only within 84 m of the table's actual
// outline), and plumes pushed by providers once a frame from inside PostFX.end (analytic cones, one
// instanced draw). `gather` culls them and runs the providers; it is called only from inside the
// frame (the pass's `enabled`, the product's `render`), never from the console.
import * as THREE from 'three';
import { FX_LAYERS, type FxProductId, type FxSettings } from '../fxRegistry.ts';
import type { FxFrameContext } from './context';
import type { PostFX } from '../postfx';
import { ShaderFxPass, type FxProduct, type FxWarmItem } from './pass';
import { FX_FULLSCREEN_VERTEX, FX_LINEARIZE } from './glsl';
import { HEAT_NOISE_SIZE } from '../../world/heatNoiseData.ts';
import { heatNoiseTexture } from '../../world/heatNoise';
import { PlumeBuffer, polygonDistance2, type HeatSources, type LavaHeatTable } from '../../world/heatSources.ts';

/** The most plumes drawn in a frame: every engine of a dozen ships, and a flame. */
export const HEAT_PLUME_MAX = 48;

/** Console tuning (`__debug.heat`), kept across effect rebuilds. Defaults are the client's where it had one. */
export const heatTuning = {
  /** Tint hot pixels cyan (the client's showRectColorFactor). */
  show: false,
  /** The client's (n x r - 0.5) offset instead of the centred one. */
  clientOffset: false,
  /** The depth gate over the bilinear footprint. */
  gate: true,
  /** Metres: lava heat full to here (the square root of the client's 5000). */
  fadeStart: 70.7,
  /** And none past here (the square root of 7000). */
  fadeEnd: 83.7,
  /** Metres the lava heat floats over the lava. */
  lift: 2,
  /** Metres: plumes fade out from 0.6 of this, and are not drawn past it. */
  plumeRange: 200,
  /** Heat texels of radius below which a plume is skipped. */
  minPlumePixels: 2,
  /** The client's frac(time x 0.5). */
  lavaNoiseRate: 0.5,
  plumeNoiseRate: 1.5,
};

const BLACK = new THREE.Color(0, 0, 0);
const halfOf = (v: number) => Math.max(1, Math.ceil(v / 2));
const savedColor = new THREE.Color();
const HEAT_PRODUCT_NEEDS: readonly FxProductId[] = ['linearDepthHalf'];
const HEAT_NEEDS: readonly FxProductId[] = ['heat', 'linearDepthHalf'];
/** Metres over which a lava source fades into the surface it meets, and a plume into a hull or wall. */
const LAVA_SOFTNESS = 0.3;
const PLUME_SOFTNESS = 0.4;
/** The camera must be this far over a table's lava for its heat to be drawn (the surface stays under the eye). */
const LAVA_EYE_CLEARANCE = 0.25;

/** Additive, no depth: each source adds (r, g x r, b x r) and overlapping sources average in the composite. */
function heatBlend(side: THREE.Side): THREE.ShaderMaterialParameters {
  return {
    lights: false,
    fog: false,
    depthTest: false,
    depthWrite: false,
    side,
    transparent: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  };
}

const LAVA_HEAT_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying float vViewZ;
  void main() {
    // The mesh's position.y is the lift: the table's own polygon floated over the flow.
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mv = viewMatrix * world;
    vViewZ = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const LAVA_HEAT_FRAGMENT = /* glsl */ `
  uniform highp sampler3D tNoise;
  uniform highp sampler2D tLinearDepth;
  uniform vec3 uCameraPos;
  uniform float uTimePhase;
  uniform float uFadeStart2;
  uniform float uFadeRange2;
  uniform float uSoftness;
  uniform float uPixelAngle;
  uniform float uNoiseTexels;
  varying vec3 vWorld;
  varying float vViewZ;
  void main() {
    vec3 d = vWorld - uCameraPos;
    // The client's distance fade, per fragment: a seven-kilometre triangle cannot interpolate it.
    float atten = 1.0 - clamp((dot(d, d) - uFadeStart2) / uFadeRange2, 0.0, 1.0);
    if (atten < 0.01) discard;
    // The same texel of the half-resolution depth: both targets are ceil(w/2) x ceil(h/2).
    float sceneZ = texelFetch(tLinearDepth, ivec2(gl_FragCoord.xy), 0).r;
    atten *= clamp((sceneZ - vViewZ) / uSoftness, 0.0, 1.0);
    if (atten < 0.01) discard;
    // The client's noiseTc: the position's x and z at a quarter, time in the third. An explicit
    // level from the footprint, since derivatives are undefined after a discard.
    vec3 tc = vec3(vWorld.x * 0.25, vWorld.z * 0.25, uTimePhase);
    float lod = log2(max(1.0, 0.25 * uNoiseTexels * vViewZ * uPixelAngle));
    float g = textureLod(tNoise, tc, lod).r;
    float b = textureLod(tNoise, tc.yxz, lod).r;
    float r = atten * (0.5 + textureLod(tNoise, tc.zyx, lod).r);
    gl_FragColor = vec4(r, g * r, b * r, 0.0);
  }
`;

const PLUME_VERTEX = /* glsl */ `
  attribute vec4 aOrigin;
  attribute vec4 aDir;
  attribute vec4 aShape;
  uniform vec3 uCameraPos;
  uniform float uRange;
  varying vec3 vWorld;
  varying vec3 vOrigin;
  varying vec3 vDir;
  varying vec3 vSide;
  varying vec3 vUp;
  varying vec4 vShape;
  varying float vLength;
  varying float vIntensity;
  void main() {
    // aOrigin: the nozzle and the length; aDir: the unit direction and the intensity; aShape: the
    // radii at the nozzle and the far end, the noise frequency and the flow phase.
    vec3 dir = aDir.xyz;
    vec3 up = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 side = normalize(cross(up, dir));
    vec3 up2 = cross(dir, side);
    float t = position.y;
    // A little outside the soft core, which reaches zero at 1.0.
    float radius = max(mix(aShape.x, aShape.y, t), 1e-3) * 1.15;
    vec3 world = aOrigin.xyz + dir * (aOrigin.w * t) + (side * position.x + up2 * position.z) * radius;
    vWorld = world;
    vOrigin = aOrigin.xyz;
    vDir = dir;
    vSide = side;
    vUp = up2;
    vShape = aShape;
    vLength = aOrigin.w;
    float far = 1.0 - smoothstep(uRange * 0.6, uRange, distance(aOrigin.xyz + dir * aOrigin.w * 0.5, uCameraPos));
    // The camera inside the plume: the whole view would swim, so keep only a trace of it.
    vec3 wc = uCameraPos - aOrigin.xyz;
    float along = clamp(dot(wc, dir), 0.0, aOrigin.w);
    float inside = 1.0 - smoothstep(0.8, 1.5, length(wc - dir * along) / max(aShape.y, 1e-3));
    vIntensity = aDir.w * far * mix(1.0, 0.3, inside);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const PLUME_FRAGMENT = /* glsl */ `
  uniform highp sampler3D tNoise;
  uniform highp sampler2D tLinearDepth;
  uniform vec3 uCameraPos;
  uniform vec3 uCameraForward;
  uniform float uTimePhase;
  uniform float uSoftness;
  uniform float uPixelAngle;
  uniform float uNoiseTexels;
  varying vec3 vWorld;
  varying vec3 vOrigin;
  varying vec3 vDir;
  varying vec3 vSide;
  varying vec3 vUp;
  varying vec4 vShape;
  varying float vLength;
  varying float vIntensity;
  void main() {
    // The heat along the view ray, so a plume seen straight down its axis (a chase camera behind the
    // ship) is strongest in its middle rather than vanishing as a surface term would.
    vec3 ray = normalize(vWorld - uCameraPos);
    vec3 w = uCameraPos - vOrigin;
    float b = dot(ray, vDir);
    float den = 1.0 - b * b;
    // Along the axis, the point closest to the ray.
    float tRay = (dot(vDir, w) - b * dot(ray, w)) / max(den, 1e-4);
    // Looking down the axis that is ill-conditioned: take the hottest axial point the ray passes,
    // between the camera's own axial place (held to the plume) and the back face it leaves by.
    float tCam = clamp(dot(w, vDir), 0.0, vLength);
    float tFace = clamp(dot(vWorld - vOrigin, vDir), 0.0, vLength);
    float tHot = clamp(0.06 * vLength, min(tCam, tFace), max(tCam, tFace));
    float t = clamp(mix(tHot, tRay, smoothstep(0.005, 0.02, den)), 0.0, vLength);
    vec3 axisPt = vOrigin + vDir * t;
    float s = max(dot(axisPt - uCameraPos, ray), 0.0);
    // The ray's point nearest that axis point.
    vec3 q = uCameraPos + ray * s;
    float u = t / max(vLength, 1e-3);
    float radius = max(mix(vShape.x, vShape.y, u), 1e-3);
    float core = 1.0 - smoothstep(0.0, radius, length(q - axisPt));
    float atten = vIntensity * core * core * pow(1.0 - u, 1.3) * smoothstep(0.0, 0.06, u);
    if (!(atten >= 0.01)) discard;
    float viewZ = dot(q - uCameraPos, uCameraForward);
    float sceneZ = texelFetch(tLinearDepth, ivec2(gl_FragCoord.xy), 0).r;
    // Fades into the hull at the nozzle; hidden behind walls.
    atten *= clamp((sceneZ - viewZ) / uSoftness, 0.0, 1.0);
    if (!(atten >= 0.01)) discard;
    vec3 rel = q - axisPt;
    float f = vShape.z;
    // Across the plume in its own two axes, along it against the flow, and time in the third.
    vec3 tc = vec3(dot(rel, vSide) * f * 1.4, t * f - vShape.w, dot(rel, vUp) * f * 1.4 + uTimePhase);
    float lod = log2(max(1.0, f * uNoiseTexels * max(viewZ, 0.0) * uPixelAngle));
    float g = textureLod(tNoise, tc, lod).r;
    float bn = textureLod(tNoise, tc.yxz, lod).r;
    float r = atten * (0.5 + textureLod(tNoise, tc.zyx, lod).r);
    gl_FragColor = vec4(r, g * r, bn * r, 0.0);
  }
`;

/** What `gather` found and the product drew, for `__debug.heat`. */
export interface HeatStats {
  lavaNear: number;
  lavaDrawn: number;
  plumesPushed: number;
  plumesDrawn: number;
  plumesTooSmall: number;
  drewLastFrame: boolean;
}

/**
 * The heat in the air, at half resolution: red intensity, green and blue the noise times it. A depth
 * product: its own target, reading `linearDepthHalf`, drawing its own meshes on the heat layer.
 */
export class HeatProduct implements FxProduct {
  readonly id = 'heat' as const;
  readonly kind = 'depth' as const;
  readonly timerLabel = 'product:heat';
  readonly stats: HeatStats = { lavaNear: 0, lavaDrawn: 0, plumesPushed: 0, plumesDrawn: 0, plumesTooSmall: 0, drewLastFrame: false };
  /** The frame `gather` last ran for (-1 before the first), so the pass and the console can tell a stale answer. */
  gatheredFrame = -1;
  private gatheredAny = false;
  private readonly sources: HeatSources;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly lavaHeatMaterial: THREE.ShaderMaterial;
  private readonly plumeMaterial: THREE.ShaderMaterial;
  /** One mesh per lava table, parallel to `lavaTables`; the geometries are World's and never disposed here. */
  private readonly lavaMeshes: THREE.Mesh[] = [];
  private lavaTables: readonly LavaHeatTable[] = [];
  private builtVersion = -1;
  /** A mesh on a plane, never drawn, to compile the lava heat material with. */
  private readonly lavaDummy: THREE.Mesh;
  private readonly plumeGeometry: THREE.InstancedBufferGeometry;
  private readonly plumes: THREE.Mesh;
  private readonly buffer = new PlumeBuffer(HEAT_PLUME_MAX);
  private readonly aOrigin: THREE.InstancedBufferAttribute;
  private readonly aDir: THREE.InstancedBufferAttribute;
  private readonly aShape: THREE.InstancedBufferAttribute;
  private readonly frustum = new THREE.Frustum();
  private readonly box = new THREE.Box3();
  private readonly sphere = new THREE.Sphere();
  private readonly center = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  /** Uniforms both source materials read, shared by reference so one write reaches both. */
  private readonly shared: Record<string, THREE.IUniform>;
  private providerFailed = false;

  constructor(sources: HeatSources) {
    this.sources = sources;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.target.texture.name = 'fx.heat';
    this.scene.name = 'fx.heat';
    this.shared = {
      tNoise: { value: heatNoiseTexture() },
      tLinearDepth: { value: null },
      uCameraPos: { value: new THREE.Vector3() },
      uPixelAngle: { value: 0.001 },
      uNoiseTexels: { value: HEAT_NOISE_SIZE },
    };
    const s = this.shared;
    this.lavaHeatMaterial = new THREE.ShaderMaterial({
      ...heatBlend(THREE.FrontSide),
      uniforms: {
        tNoise: s.tNoise,
        tLinearDepth: s.tLinearDepth,
        uCameraPos: s.uCameraPos,
        uPixelAngle: s.uPixelAngle,
        uNoiseTexels: s.uNoiseTexels,
        uTimePhase: { value: 0 },
        uFadeStart2: { value: heatTuning.fadeStart * heatTuning.fadeStart },
        uFadeRange2: { value: heatTuning.fadeEnd * heatTuning.fadeEnd - heatTuning.fadeStart * heatTuning.fadeStart },
        uSoftness: { value: LAVA_SOFTNESS },
      },
      vertexShader: LAVA_HEAT_VERTEX,
      fragmentShader: LAVA_HEAT_FRAGMENT,
    });
    this.lavaHeatMaterial.name = 'fx.heat.lava';
    this.plumeMaterial = new THREE.ShaderMaterial({
      // A closed convex volume shows exactly one back face per covered pixel, whether the camera is outside or inside it.
      ...heatBlend(THREE.BackSide),
      uniforms: {
        tNoise: s.tNoise,
        tLinearDepth: s.tLinearDepth,
        uCameraPos: s.uCameraPos,
        uPixelAngle: s.uPixelAngle,
        uNoiseTexels: s.uNoiseTexels,
        uCameraForward: { value: new THREE.Vector3(0, 0, -1) },
        uTimePhase: { value: 0 },
        uSoftness: { value: PLUME_SOFTNESS },
        uRange: { value: heatTuning.plumeRange },
      },
      vertexShader: PLUME_VERTEX,
      fragmentShader: PLUME_FRAGMENT,
    });
    this.plumeMaterial.name = 'fx.heat.plume';

    this.lavaDummy = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.lavaHeatMaterial);
    this.lavaDummy.layers.set(FX_LAYERS.heat);

    // A closed unit cylinder along +Y from 0 to 1, drawn once per plume.
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false).translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(cylinder.getIndex());
    g.setAttribute('position', cylinder.getAttribute('position'));
    this.aOrigin = new THREE.InstancedBufferAttribute(this.buffer.origin, 4);
    this.aDir = new THREE.InstancedBufferAttribute(this.buffer.dir, 4);
    this.aShape = new THREE.InstancedBufferAttribute(this.buffer.shape, 4);
    for (const a of [this.aOrigin, this.aDir, this.aShape]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aOrigin', this.aOrigin);
    g.setAttribute('aDir', this.aDir);
    g.setAttribute('aShape', this.aShape);
    g.instanceCount = 0;
    this.plumeGeometry = g;
    this.plumes = new THREE.Mesh(g, this.plumeMaterial);
    this.plumes.name = 'fx.heat.plumes';
    this.plumes.frustumCulled = false;
    this.plumes.layers.set(FX_LAYERS.heat);
    this.plumes.visible = false;
    this.scene.add(this.plumes);

    // Made once: a sphere about the plume's middle against this frame's frustum.
    this.buffer.cull = (x, y, z, radius) => this.frustum.intersectsSphere(this.sphere.set(this.center.set(x, y, z), radius));
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return HEAT_PRODUCT_NEEDS;
  }

  /**
   * Cull the sources for this frame and run the plume providers; true when anything will draw. Cached
   * per ctx.frame. Called only from inside PostFX.end (HeatHazePass.enabled, this render); nothing on
   * the console path calls it, so a call between frames cannot fill the cache with the next frame's
   * number and last frame's matrices.
   */
  gather(ctx: FxFrameContext): boolean {
    if (this.gatheredFrame === ctx.frame) return this.gatheredAny;
    this.gatheredFrame = ctx.frame;
    const src = this.sources;
    // The one allocation on this path, and on purpose: a mesh per lava table, once per planet loaded.
    if (src.lavaVersion !== this.builtVersion) this.rebuildLava();
    this.frustum.setFromProjectionMatrix(ctx.viewProj);
    const c = ctx.cameraPos;
    const T = heatTuning;
    const lift = Math.max(0, T.lift);
    const R2 = T.fadeEnd * T.fadeEnd;
    let near = 0;
    let drawn = 0;
    const tables = this.lavaTables;
    for (let i = 0; i < tables.length; i++) {
      const t = tables[i];
      const mesh = this.lavaMeshes[i];
      mesh.visible = false;
      // Over the lava by more than the clearance, so the heat surface stays under the eye.
      const above = c.y - t.height;
      if (!(above > LAVA_EYE_CLEARANCE)) continue;
      const dy = Math.max(0, above - lift);
      const dy2 = dy * dy;
      const bx = Math.max(t.minX - c.x, 0, c.x - t.maxX);
      const bz = Math.max(t.minZ - c.z, 0, c.z - t.maxZ);
      if (bx * bx + bz * bz + dy2 >= R2) continue;
      if (polygonDistance2(c.x, c.z, t.points) + dy2 >= R2) continue;
      near++;
      this.box.min.set(t.minX, t.height, t.minZ);
      this.box.max.set(t.maxX, t.height + lift, t.maxZ);
      if (!this.frustum.intersectsBox(this.box)) continue;
      mesh.visible = true;
      mesh.position.y = Math.min(lift, above - LAVA_EYE_CLEARANCE);
      drawn++;
    }

    const buf = this.buffer;
    buf.reset(c.x, c.y, c.z);
    buf.range = T.plumeRange;
    buf.focalPixels = halfOf(ctx.height) / 2 / Math.max(ctx.tanHalfFov.y, 1e-6);
    buf.minPixels = T.minPlumePixels;
    try {
      src.runProviders(buf);
    } catch (err) {
      // A provider that throws must not take the frame with it: its plumes this frame are lost.
      if (!this.providerFailed) console.warn('heat haze: a plume provider failed', err);
      this.providerFailed = true;
    }
    const n = buf.count;
    this.plumeGeometry.instanceCount = n;
    if (n > 0) {
      this.aOrigin.clearUpdateRanges();
      this.aDir.clearUpdateRanges();
      this.aShape.clearUpdateRanges();
      this.aOrigin.addUpdateRange(0, n * 4);
      this.aDir.addUpdateRange(0, n * 4);
      this.aShape.addUpdateRange(0, n * 4);
      this.aOrigin.needsUpdate = true;
      this.aDir.needsUpdate = true;
      this.aShape.needsUpdate = true;
    }
    this.plumes.visible = n > 0;

    const st = this.stats;
    st.lavaNear = near;
    st.lavaDrawn = drawn;
    st.plumesPushed = buf.pushed;
    st.plumesDrawn = n;
    st.plumesTooSmall = buf.tooSmall;
    this.gatheredAny = drawn > 0 || n > 0;
    // What the product will draw this frame; `render` confirms it on the frames it runs.
    st.drewLastFrame = this.gatheredAny;
    return this.gatheredAny;
  }

  render(ctx: FxFrameContext): void {
    // Cached: the pass's `enabled` already gathered this frame; this also serves fxView('heat') with the pass off.
    const any = this.gather(ctx);
    const r = ctx.renderer;
    r.setRenderTarget(this.target);
    r.getClearColor(savedColor);
    const savedAlpha = r.getClearAlpha();
    r.setClearColor(BLACK, 0);
    r.clear(true, false, false);
    this.stats.drewLastFrame = any;
    // The clear colour stays black until the sources are drawn, and is given back after: were autoClear
    // ever on, the draw would clear to black rather than to the sky, which would be heat everywhere.
    try {
      if (any) this.drawSources(ctx);
    } finally {
      r.setClearColor(savedColor, savedAlpha);
    }
  }

  /** The lava tables and plumes into the heat target, which `render` has bound and cleared. */
  private drawSources(ctx: FxFrameContext): void {
    const r = ctx.renderer;
    const T = heatTuning;
    const s = this.shared;
    s.tLinearDepth.value = ctx.products.linearDepthHalf;
    (s.uCameraPos.value as THREE.Vector3).copy(ctx.cameraPos);
    s.uPixelAngle.value = (2 * ctx.tanHalfFov.y) / halfOf(ctx.height);
    ctx.camera.getWorldDirection(this.forward);
    const lu = this.lavaHeatMaterial.uniforms;
    // Time phases wrapped here, in double precision, so no shader ever carries a large, growing time.
    lu.uTimePhase.value = (ctx.time * T.lavaNoiseRate) % 1;
    const f0 = Math.max(0, T.fadeStart);
    const f1 = Math.max(f0 + 0.01, T.fadeEnd);
    lu.uFadeStart2.value = f0 * f0;
    lu.uFadeRange2.value = f1 * f1 - f0 * f0;
    const pu = this.plumeMaterial.uniforms;
    (pu.uCameraForward.value as THREE.Vector3).copy(this.forward);
    pu.uTimePhase.value = (ctx.time * T.plumeNoiseRate) % 1;
    pu.uRange.value = Math.max(1, T.plumeRange);
    const cam = ctx.camera;
    const mask = cam.layers.mask;
    cam.layers.mask = 1 << FX_LAYERS.heat;
    try {
      r.render(this.scene, cam);
    } finally {
      cam.layers.mask = mask;
    }
  }

  setSize(width: number, height: number, _settings: FxSettings): void {
    // The same texels as linearDepthHalf, which the sources fetch texel for texel.
    this.target.setSize(halfOf(width), halfOf(height));
  }

  materials(): FxWarmItem[] {
    // Explicitly into a target: a product never draws onto the canvas.
    return [
      { material: this.lavaHeatMaterial, object: this.lavaDummy, where: 'target' },
      { material: this.plumeMaterial, object: this.plumes, where: 'target' },
    ];
  }

  /** For `__debug.heat`: what drew last frame, the target's size and the noise. Reads stored values only. */
  describe(): object {
    return {
      ...this.stats,
      lavaTables: this.lavaTables.length,
      target: [this.target.width, this.target.height],
      noise: `runtime ${HEAT_NOISE_SIZE}^3, mipmapped`,
    };
  }

  dispose(): void {
    for (const m of this.lavaMeshes) this.scene.remove(m);
    this.lavaMeshes.length = 0;
    this.lavaTables = [];
    this.scene.remove(this.plumes);
    this.target.dispose();
    this.lavaHeatMaterial.dispose();
    this.plumeMaterial.dispose();
    this.plumeGeometry.dispose();
    this.lavaDummy.geometry.dispose();
    // The noise volume is shared by every heat source and the lava, and is never disposed.
  }

  /** New lava tables: one mesh each on the heat layer; the old meshes leave the scene, their geometries (World's) untouched. */
  private rebuildLava(): void {
    for (const m of this.lavaMeshes) this.scene.remove(m);
    this.lavaMeshes.length = 0;
    const tables = this.sources.lava;
    for (const t of tables) {
      const mesh = new THREE.Mesh(t.geometry, this.lavaHeatMaterial);
      mesh.name = `fx.heat.lava:${t.name}`;
      mesh.layers.set(FX_LAYERS.heat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.userData.table = t;
      this.scene.add(mesh);
      this.lavaMeshes.push(mesh);
    }
    this.lavaTables = tables;
    this.builtVersion = this.sources.lavaVersion;
  }
}

function heatHazeShader(): { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string } {
  return {
    uniforms: {
      tDiffuse: { value: null },
      tHeat: { value: null },
      tDepth: { value: null },
      tLinearHalf: { value: null },
      uFullSize: { value: new THREE.Vector2(1, 1) },
      uHalfSize: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.05 },
      uFar: { value: 9000 },
      uScale: { value: 0.01 },
      uGate: { value: 1 },
      uClientOffset: { value: 0 },
      uShow: { value: 0 },
    },
    vertexShader: FX_FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform sampler2D tHeat;
      uniform highp sampler2D tDepth;
      uniform highp sampler2D tLinearHalf;
      uniform vec2 uFullSize;
      uniform vec2 uHalfSize;
      uniform float uNear;
      uniform float uFar;
      uniform float uScale;
      uniform float uGate;
      uniform float uClientOffset;
      uniform float uShow;
      varying vec2 vUv;
      ${FX_LINEARIZE}

      // The farthest depth the heat test saw among the four half-resolution texels bilinear filtering mixes at uv.
      float footprintFar(vec2 uv) {
        ivec2 t = ivec2(floor(uv * uHalfSize - 0.5));
        ivec2 hi = ivec2(uHalfSize) - 1;
        float z = texelFetch(tLinearHalf, clamp(t, ivec2(0), hi), 0).r;
        z = max(z, texelFetch(tLinearHalf, clamp(t + ivec2(1, 0), ivec2(0), hi), 0).r);
        z = max(z, texelFetch(tLinearHalf, clamp(t + ivec2(0, 1), ivec2(0), hi), 0).r);
        return max(z, texelFetch(tLinearHalf, clamp(t + ivec2(1, 1), ivec2(0), hi), 0).r);
      }

      // A pixel clearly nearer than where any heat it would take was tested: an outline in front of the heat.
      // 10% and 30 cm: ground seen at a grazing angle passes, a figure in front of lava does not.
      bool nearer(vec2 uv) {
        ivec2 p = clamp(ivec2(uv * uFullSize), ivec2(0), ivec2(uFullSize) - 1);
        float z = fxViewZ(texelFetch(tDepth, p, 0).r, uNear, uFar);
        return z < footprintFar(uv) * 0.9 - 0.3;
      }

      void main() {
        vec4 heat = texture2D(tHeat, vUv);
        // !(x >= y) is also true for NaN, so a bad heat texel takes the copy path.
        if (!(heat.r >= 0.001) || (uGate > 0.5 && nearer(vUv))) {
          gl_FragColor = texture2D(tDiffuse, vUv);
          return;
        }
        float k = min(heat.r, 2.0);
        // The intensity-weighted noise, 0 to 1, mean 0.49.
        vec2 n = heat.gb / heat.r;
        vec2 off = uClientOffset > 0.5 ? (n * min(k, 1.0) - 0.5) * 0.01 : (n - 0.5) * k * uScale;
        vec2 uv = vUv + off;
        // NaN, or more than strength 2 can make (0.04): no move.
        if (!(abs(off.x) + abs(off.y) < 0.05)) uv = vUv;
        // The client's rule: take colour only from somewhere hot (scaled to the source's own heat, so a
        // soft edge is not cut), and never from anything nearer.
        else if (!(texture2D(tHeat, uv).r >= 0.5 * min(k, 1.0)) || (uGate > 0.5 && nearer(uv))) uv = vUv;
        vec4 c = texture2D(tDiffuse, uv);
        if (uShow > 0.5) c.gb += k * 0.25;
        gl_FragColor = c;
      }
    `,
  };
}

/**
 * The composite: every pixel moved by the heat's noise where the air is hot. Cold pixels are copied,
 * since the chain's buffer must be written everywhere; a frame with no heat in view does not draw at
 * all (the product's `gather` says so from `enabled`).
 */
export class HeatHazePass extends ShaderFxPass {
  readonly id = 'heatHaze' as const;
  private readonly product: HeatProduct;
  /** Whether half-float targets can be drawn into (checked once, on the first frame asked). */
  private halfFloat: boolean | null = null;

  constructor(product: HeatProduct) {
    super(heatHazeShader());
    this.product = product;
  }

  /** The last frame the chain asked this pass (it asks only with the setting on and no console override off). */
  private askedFrame = -1;

  /** Strength above 0, half-float targets drawable, and something hot in view this frame. */
  enabled(ctx: FxFrameContext): boolean {
    this.askedFrame = ctx.frame;
    if (!(ctx.settings.heatHazeStrength > 0)) return false;
    if (!this.halfFloatOk(ctx.renderer)) return false;
    return this.product.gather(ctx);
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return HEAT_NEEDS;
  }

  prepare(ctx: FxFrameContext): void {
    const u = this.material.uniforms;
    u.tHeat.value = ctx.products.heat;
    u.tDepth.value = ctx.depth;
    u.tLinearHalf.value = ctx.products.linearDepthHalf;
    (u.uFullSize.value as THREE.Vector2).set(ctx.width, ctx.height);
    (u.uHalfSize.value as THREE.Vector2).set(halfOf(ctx.width), halfOf(ctx.height));
    u.uNear.value = ctx.near;
    u.uFar.value = ctx.far;
    u.uScale.value = 0.01 * ctx.settings.heatHazeStrength;
    u.uGate.value = heatTuning.gate ? 1 : 0;
    u.uClientOffset.value = heatTuning.clientOffset ? 1 : 0;
    u.uShow.value = heatTuning.show ? 1 : 0;
  }

  /** From stored values only, never `gather`: why the pass did not draw last frame. */
  reason(ctx: FxFrameContext): string | null {
    // Not asked last frame at all: the setting or a console override kept it off, which the listing says
    // itself. Asked of the pass, not the product, since fxView('heat') gathers with the pass off.
    if (this.askedFrame !== ctx.frame - 1) return null;
    if (!(ctx.settings.heatHazeStrength > 0)) return 'strength 0';
    if (this.halfFloat === false) return 'half-float targets unsupported';
    if (this.product.gatheredFrame !== ctx.frame - 1) return null;
    return this.product.stats.drewLastFrame ? null : 'no heat source in view';
  }

  private halfFloatOk(renderer: THREE.WebGLRenderer): boolean {
    if (this.halfFloat === null) {
      const ext = renderer.extensions;
      this.halfFloat = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    }
    return this.halfFloat;
  }
}

/** Register the heat product and the composite on a chain. */
export function installHeatHaze(postfx: PostFX, sources: HeatSources): void {
  const product = new HeatProduct(sources);
  postfx.registerProduct(product);
  postfx.registerPass(new HeatHazePass(product));
}
