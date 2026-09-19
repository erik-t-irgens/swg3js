// The hyperspace tunnel: what the ship flies through between two places, ours (the client drew its own for a camera
// fixed behind the ship). One mesh for the whole session, made with the App and put in the scene hidden, so every
// loading screen's compile builds its program and no jump ever does. Around a jumping hull it is an ellipsoid seen
// from inside: a funnel of streaking light converging on a white core ahead, turning about its axis, the streaks
// running back past the ship. It writes depth and is drawn right after the sky, so the world behind it fails the
// depth test; while it is closed the game also brings the camera's far plane in to its tip, so the world is not drawn.
//
// It closes from the tip back over the ship and the camera, and opens from the tip first, by one uniform: the part not
// yet formed (or already gone) is discarded, and the world shows through it.
import * as THREE from 'three';
import { TUNNEL_LOOK, type TunnelLook } from './hyperspaceMath.ts';

/** Drawn after every sky layer (the dome -10, the skybox -9, the stars -6, the space bodies -4, the world's sky -1) and before every ordinary opaque (0). */
export const TUNNEL_RENDER_ORDER = -0.5;

const VERTEX = /* glsl */ `
varying vec3 vP;
void main() {
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Every number in this shader is invented (the look is ours, not the client's): the streaks' thresholds, cells, widths
// and gains, the colours, the cut and its rag, the twist and the bands. Spin, speed and glow are live through
// `__debug.jumpFx`; the rest is changed here.
const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uCover;
uniform float uOpening;
uniform float uSpin;
uniform float uSpeed;
uniform float uGlow;
varying vec3 vP;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// One layer of streaks: cells round the axis (cols) and along it (rows), each on or off by its hash, a thin line
// across with a bright head at its back end and a tail toward the tip, running back past the ship. wu and wv are how
// much of a cell one pixel covers each way: a cell under a pixel fades to its mean, so the far end never sparkles.
float streaks(float turn, float z, float cols, float rows, float seed, float speed, float wa, float wz) {
  float u = turn * cols;
  float v = z * rows + uTime * speed;
  vec2 cell = vec2(mod(floor(u), cols), floor(v));
  float r = hash12(cell + seed);
  float on = step(0.62, r);
  float wu = wa * cols;
  float wv = wz * rows;
  float width = 0.07 + wu;
  float line = (1.0 - smoothstep(0.0, width, abs(fract(u) - 0.5))) * (0.07 / width);
  float fv = fract(v);
  float tail = smoothstep(0.0, 0.08, fv) * (1.0 - smoothstep(0.1, 1.0, fv));
  float sharp = clamp(1.0 - max(wu, wv) * 1.5, 0.0, 1.0);
  float mean = 0.38 * 0.07 * 0.45;
  return mix(mean, on * line * tail * (0.6 + r), sharp);
}

void main() {
  float radial = length(vP.xy);
  // Turns about the axis (0..1); at the very tip the angle has no meaning and the core covers it.
  float turn = radial > 1e-5 ? atan(vP.y, vP.x) * 0.15915494 + 0.5 : 0.0;
  float z = vP.z;
  // A pixel's footprint in turns and along the axis, from the position (not the wrapped angle: no seam).
  float wa = length(fwidth(vP.xy)) / max(radial, 1e-4) * 0.15915494;
  float wz = fwidth(z);
  // What stands: closing, ahead of the cut (the tip first); opening, behind it (the tip goes first). A ragged edge.
  float rag = hash12(vec2(floor(turn * 40.0), 7.0)) * 0.14;
  float keep = uOpening > 0.5 ? (mix(-1.15, 1.15, uCover) - (z + rag)) : ((z - rag) - mix(1.15, -1.15, uCover));
  if (keep < 0.0) discard;
  float rim = 1.0 - smoothstep(0.0, 0.06, keep);
  // The spin, and a slow spiral twist toward the tip.
  float a = fract(turn + uTime * uSpin + z * 0.3);
  float s = streaks(a, z, 64.0, 6.0, 0.0, uSpeed, wa, wz)
          + 0.7 * streaks(fract(a + 0.37), z, 96.0, 10.0, 17.0, uSpeed * 1.45, wa, wz)
          + 0.5 * streaks(fract(a + 0.71), z, 150.0, 15.0, 41.0, uSpeed * 2.1, wa, wz);
  float ahead = smoothstep(-0.3, 1.0, z);
  vec3 col = mix(vec3(0.004, 0.012, 0.05), vec3(0.03, 0.08, 0.28), ahead);
  // Soft bands winding down the funnel.
  float band = 0.5 + 0.5 * sin(a * 18.849556 + z * 9.0 - uTime * 2.2);
  col += vec3(0.015, 0.04, 0.12) * band * ahead;
  col += vec3(0.55, 0.75, 1.0) * s * 2.6 * uGlow;
  // The white the tunnel runs toward, and the glowing edge where it is forming or breaking up.
  col += vec3(0.85, 0.93, 1.0) * smoothstep(0.8, 1.0, z) * 3.0 * uGlow;
  col += vec3(0.6, 0.8, 1.0) * rim * 1.8 * uGlow;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class HyperspaceTunnel {
  readonly mesh: THREE.Mesh;
  /** Its size round the hull followed now (metres): radius across, half-length along the nose. */
  readonly size = { radius: 1, length: 1 };
  /** The look, shared with `__debug.jumpFx` (live: read every frame it shows). */
  readonly look: TunnelLook = TUNNEL_LOOK;
  private readonly material: THREE.ShaderMaterial;
  private readonly uniforms: { uTime: { value: number }; uCover: { value: number }; uOpening: { value: number }; uSpin: { value: number }; uSpeed: { value: number }; uGlow: { value: number } };
  /** The hull followed while it shows. */
  private frame: THREE.Object3D | null = null;
  private readonly scale = new THREE.Matrix4();
  private time = 0;

  constructor() {
    this.uniforms = { uTime: { value: 0 }, uCover: { value: 0 }, uOpening: { value: 0 }, uSpin: { value: TUNNEL_LOOK.spin }, uSpeed: { value: TUNNEL_LOOK.speed }, uGlow: { value: TUNNEL_LOOK.glow } };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: true, depthTest: true, fog: false, lights: false });
    this.material.name = 'hyperspace tunnel';
    // No cascades (it has no lights), no wet wrap, nothing that would change its program once it is built.
    this.material.userData.unlit = true;
    this.material.userData.dry = true;
    // A unit sphere with its poles on Z (the nose), scaled to the ellipsoid per jump.
    const geometry = new THREE.SphereGeometry(1, 96, 64).rotateX(Math.PI / 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'hyperspace:tunnel';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = TUNNEL_RENDER_ORDER;
    this.mesh.userData.weatherDry = true;
    // Placed by hand from the hull's matrix each frame (a scene root: its matrix is its world matrix).
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  /** Whether it is drawn this frame. */
  get shown(): boolean {
    return this.mesh.visible;
  }

  /** Round a hull, sized; hidden until `set` gives it a cover. */
  attach(frame: THREE.Object3D, size: { radius: number; length: number }): void {
    this.frame = frame;
    this.size.radius = size.radius;
    this.size.length = size.length;
    this.scale.makeScale(size.radius, size.radius, size.length);
  }

  /** How much of it stands (0 none, 1 closed) and whether it is opening; the look is read afresh. */
  set(cover: number, opening: boolean): void {
    const u = this.uniforms;
    u.uCover.value = cover;
    u.uOpening.value = opening ? 1 : 0;
    u.uSpin.value = this.look.spin;
    u.uSpeed.value = this.look.speed;
    u.uGlow.value = this.look.glow;
    this.mesh.visible = cover > 0 && this.frame !== null;
  }

  /** Its own clock (the streaks and the spin), wrapped so the floats never lose precision on a long session. */
  step(dt: number): void {
    this.time = (this.time + dt) % 3600;
    this.uniforms.uTime.value = this.time;
  }

  /** On the hull, after it has moved this frame and before the draw. Nothing allocated. */
  follow(): void {
    const f = this.frame;
    if (!f || !this.mesh.visible) return;
    f.updateWorldMatrix(true, false);
    this.mesh.matrix.multiplyMatrices(f.matrixWorld, this.scale);
    this.mesh.matrixWorld.copy(this.mesh.matrix);
  }

  /** Gone (the jump over or aborted): hidden and following nothing. */
  detach(): void {
    this.frame = null;
    this.mesh.visible = false;
    this.uniforms.uCover.value = 0;
  }

  /** The view depth of its far side from a camera, for the motion blur's follow cut (the unit sphere's radius, scaled by its matrix). */
  farDepth(view: THREE.Matrix4): number {
    const e = this.mesh.matrixWorld.elements;
    // The centre in view space, then out by its largest axis.
    const z = view.elements[2] * e[12] + view.elements[6] * e[13] + view.elements[10] * e[14] + view.elements[14];
    return -z + this.mesh.matrixWorld.getMaxScaleOnAxis();
  }
}
