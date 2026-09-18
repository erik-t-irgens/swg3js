// The glows' own depth, for the depth of field. A pixel's blur is decided by its depth, and the
// things that matter most at the moment of firing write none: the bolt and the muzzle flash, a
// ship's bolt, a hit burst, a blade's core. Without their own depth each takes the blur of whatever
// lies behind it, and a bolt landing on a target at 15 m in front of a town at 80 m comes out as a
// soft dotted disc. This product draws a short list of them (the game's, `DofGlowCollector`) into a
// full-resolution half-float target that shares the scene's depth, each writing 1/z of its own
// fragment and overlaps keeping the nearest (MAX blending), so the lens can take the nearer of the
// scene's depth and a glow's wherever one is drawn.
//
// The listed meshes are drawn with their materials swapped for masks for the one call, and put back
// in a `finally`: nothing else ever sees a mask on a scene mesh. A particle batch's mask samples the
// batch's own texture and colour and discards texels dimmer than `level`, so a soft quad's dim
// fringe keeps the background's depth and no square of sharp background shows around a flash.
import * as THREE from 'three';
import { FX_ALL_LAYERS, GeometryProduct, geometryMaterialDefaults } from './geometry';
import type { PostFX } from '../postfx';
import type { FxFrameContext } from './context';
import type { FxProductId } from '../fxRegistry.ts';
import type { FxWarmItem } from './pass';

/** The product's id in the registry. */
export const DOF_GLOW_ID: FxProductId = 'dofGlow';

/** Fills `out` from index `n` with meshes that add light and write no depth; returns the new count. The game's side, called once a frame while the lens draws. */
export type DofGlowCollector = (out: THREE.Object3D[], n: number) => number;

const SOLID_VERT = /* glsl */ `
  varying float vViewZ;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vViewZ = -mv.z;
  }
`;

const SOLID_FRAG = /* glsl */ `
  varying float vViewZ;
  void main() { gl_FragColor = vec4(1.0 / max(vViewZ, 0.05), 0.0, 0.0, 1.0); }
`;

/** The particle batch's own attributes: world-space position, uv and the per-vertex colour, and its fog (particles.ts). */
const PARTICLE_VERT = /* glsl */ `
  attribute vec4 aColor;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vViewZ;
  varying float vFog;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vColor = aColor;
    vViewZ = -mv.z;
    float d = length(mv.xyz);
    vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float uLevel;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vViewZ;
  varying float vFog;
  void main() {
    vec4 c = texture2D(map, vUv) * vColor;
    // The dim fringe keeps the background's depth: only where the glow is bright is it the glow.
    // Fog dims additive light as the batch draws it (particles.ts), so a bolt faint in the fog is no glow.
    if (max(c.r, max(c.g, c.b)) * (1.0 - vFog) * c.a < uLevel) discard;
    gl_FragColor = vec4(1.0 / max(vViewZ, 0.05), 0.0, 0.0, 1.0);
  }
`;

/** Depth tested against the frame, never written, no stencil (the glows are actors), MAX-blended. */
function maskSettings(m: THREE.ShaderMaterial): THREE.ShaderMaterial {
  geometryMaterialDefaults(m, false);
  m.stencilWrite = false;
  m.blending = THREE.CustomBlending;
  // gl.MAX: the factors are ignored, and overlapping glows keep the nearest (the largest 1/z).
  m.blendEquation = THREE.MaxEquation;
  m.side = THREE.DoubleSide;
  m.toneMapped = false;
  return m;
}

function warmMesh(material: THREE.Material, particle: boolean): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  if (particle) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(new Array(12).fill(0), 4));
  }
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  return mesh;
}

export class DofGlowProduct extends GeometryProduct {
  /** A particle texel counts as the glow when max(rgb) x alpha (linear) reaches this: the dim fringe keeps the background's depth. */
  readonly level: THREE.IUniform<number> = { value: 0.2 };
  /** Last frame, for __debug.dof. */
  readonly last = { objects: 0, textured: 0 };
  private readonly solid: THREE.ShaderMaterial;
  /** Every particle mask shares this source, so they share one program: a batch first seen mid-play compiles nothing. */
  private readonly particleProto: THREE.ShaderMaterial;
  private readonly masks = new WeakMap<THREE.Material, THREE.ShaderMaterial>();
  private readonly made: THREE.ShaderMaterial[] = [];
  private readonly list: THREE.Object3D[] = [];
  /** The listed meshes and their own materials during the one draw; emptied after, so no scene material is held past it. */
  private readonly saved: (THREE.Material | null)[] = [];
  /** A fog of 0 for a listed batch whose shader has none. */
  private readonly noFog: THREE.IUniform<number> = { value: 0 };
  private readonly dummySolid: THREE.Mesh;
  private readonly dummyParticle: THREE.Mesh;

  constructor(postfx: PostFX, private readonly collect: DofGlowCollector) {
    super(DOF_GLOW_ID, postfx, { format: THREE.RedFormat, type: THREE.HalfFloatType, clear: new THREE.Color(0, 0, 0), clearAlpha: 0 });
    this.solid = maskSettings(new THREE.ShaderMaterial({ vertexShader: SOLID_VERT, fragmentShader: SOLID_FRAG }));
    this.particleProto = maskSettings(
      new THREE.ShaderMaterial({ vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG, uniforms: { map: { value: null }, uLevel: this.level, uFogDensity: this.noFog } }),
    );
    this.dummySolid = warmMesh(this.solid, false);
    this.dummyParticle = warmMesh(this.particleProto, true);
  }

  /** The mask for one particle batch material: made on first sight, sharing its texture and fog uniforms by reference. */
  private particleMask(source: THREE.ShaderMaterial): THREE.ShaderMaterial {
    let m = this.masks.get(source);
    if (!m) {
      const uniforms = { map: source.uniforms.map, uLevel: this.level, uFogDensity: (source.uniforms.uFogDensity as THREE.IUniform<number> | undefined) ?? this.noFog };
      m = maskSettings(new THREE.ShaderMaterial({ vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG, uniforms }));
      this.masks.set(source, m);
      this.made.push(m);
    }
    return m;
  }

  protected draw(ctx: FxFrameContext): void {
    const list = this.list;
    const n = this.collect(list, 0);
    list.length = n;
    this.last.objects = n;
    this.last.textured = 0;
    // The clear alone: no glow anywhere.
    if (n === 0) return;
    const saved = this.saved;
    for (let i = 0; i < n; i++) {
      const mesh = list[i] as THREE.Mesh;
      const m = mesh.material as THREE.Material;
      saved[i] = m;
      const shader = m as THREE.ShaderMaterial;
      const textured = shader.isShaderMaterial === true && shader.uniforms.map !== undefined;
      if (textured) this.last.textured++;
      mesh.material = textured ? this.particleMask(shader) : this.solid;
    }
    try {
      // The proxy scene draws them where they stand, this frame's matrices, every layer.
      this.drawer.drawObjects(ctx, list, null, FX_ALL_LAYERS);
    } finally {
      // Put each material back and let go of it and its mesh: the slots are refilled next frame.
      for (let i = 0; i < n; i++) {
        (list[i] as THREE.Mesh).material = saved[i] as THREE.Material;
        saved[i] = null;
      }
      list.fill(null as unknown as THREE.Object3D, 0, n);
    }
  }

  materials(): FxWarmItem[] {
    return [
      { material: this.solid, object: this.dummySolid, where: 'target' },
      { material: this.particleProto, object: this.dummyParticle, where: 'target' },
    ];
  }

  dispose(): void {
    for (const m of this.made) m.dispose();
    this.made.length = 0;
    this.solid.dispose();
    this.particleProto.dispose();
    this.dummySolid.geometry.dispose();
    this.dummyParticle.geometry.dispose();
    this.list.length = 0;
    // Detaches the shared depth before disposing the target (R8).
    super.dispose();
  }
}
