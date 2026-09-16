// The burns a lightsaber leaves on what it touches, the way Jedi Academy's saber marks do: where a
// lit blade meets a wall or the ground a small mark is laid on the surface, glowing the blade's colour
// at first and cooling to a dark scorch that fades away. A blade dragged along a surface lays a trail
// of them. One mesh holds every mark (a ring of quads, the oldest overwritten), so the cost is one
// draw whatever the number.
import * as THREE from 'three';

/** How many marks the world keeps at once. */
const MAX_MARKS = 600;
/** Each mark's size across, in metres. */
const SIZE = 0.07;
/** Seconds a mark glows before it is only a scorch, and seconds until the scorch is gone. */
const GLOW_LIFE = 1.2;
const LIFE = 14;
/** A mark is not laid within this distance of the last one from the same blade, so a still blade does not pile them up. */
const SPACING = 0.035;

const VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aBorn;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vBorn;
  void main() {
    vUv = uv;
    vColor = aColor;
    vBorn = aBorn;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
/**
 * A round mark: the glow is the blade's colour fading over its first second into a dark scorch,
 * and the scorch fades out over its life. Marks not yet laid (born at -1) draw nothing.
 */
const FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uGlowLife;
  uniform float uLife;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vBorn;
  void main() {
    if (vBorn < 0.0) discard;
    float age = uTime - vBorn;
    if (age > uLife) discard;
    float r = length(vUv - 0.5) * 2.0;
    float disc = 1.0 - smoothstep(0.55, 1.0, r);
    float glow = 1.0 - smoothstep(0.0, uGlowLife, age);
    float fade = 1.0 - smoothstep(uLife * 0.6, uLife, age);
    // The scorch: a dark brown, the glow's colour laid over it while it is hot, hotter at the middle.
    vec3 scorch = vec3(0.07, 0.045, 0.03);
    vec3 hot = mix(vColor, vec3(1.0), 0.35 * (1.0 - r));
    vec3 col = mix(scorch, hot, glow);
    float alpha = disc * fade * mix(0.75, 1.0, glow);
    gl_FragColor = vec4(col, alpha);
  }
`;

const tangent = new THREE.Vector3();
const bitangent = new THREE.Vector3();
const n = new THREE.Vector3();
const p = new THREE.Vector3();

export class SaberMarks {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly position: THREE.BufferAttribute;
  private readonly color: THREE.BufferAttribute;
  private readonly born: THREE.BufferAttribute;
  private next = 0;
  private time = 0;
  /** Where each blade last laid a mark, so a trail is spaced and a resting blade lays one. */
  private readonly last = new Map<number, THREE.Vector3>();

  constructor() {
    const g = new THREE.BufferGeometry();
    const count = MAX_MARKS * 4;
    this.position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.color = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.born = new THREE.BufferAttribute(new Float32Array(count).fill(-1), 1);
    const uv = new Float32Array(count * 2);
    const index: number[] = [];
    for (let i = 0; i < MAX_MARKS; i++) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      const v = i * 4;
      index.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    g.setAttribute('position', this.position);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aColor', this.color);
    g.setAttribute('aBorn', this.born);
    g.setIndex(index);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.color.setUsage(THREE.DynamicDrawUsage);
    this.born.setUsage(THREE.DynamicDrawUsage);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uGlowLife: { value: GLOW_LIFE }, uLife: { value: LIFE } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'saber marks';
  }

  /** The clock the marks age by. */
  update(dt: number): void {
    this.time += dt;
    this.mesh.material.uniforms.uTime.value = this.time;
  }

  /**
   * Lay a mark from blade `blade` at `point` on a surface with `normal`, in the blade's colour, unless
   * one lies within the spacing already. Returns whether one was laid.
   */
  touch(blade: number, point: THREE.Vector3, normal: THREE.Vector3, color: THREE.Color): boolean {
    let last = this.last.get(blade);
    if (last && last.distanceToSquared(point) < SPACING * SPACING) return false;
    if (!last) {
      last = new THREE.Vector3();
      this.last.set(blade, last);
    }
    last.copy(point);
    n.copy(normal).normalize();
    // A frame on the surface: any direction across the normal, and the one across both.
    tangent.set(1, 0, 0);
    if (Math.abs(n.dot(tangent)) > 0.9) tangent.set(0, 0, 1);
    tangent.cross(n).normalize();
    bitangent.crossVectors(n, tangent);
    // A little off the surface, so the mark draws over it rather than in it.
    p.copy(point).addScaledVector(n, 0.006);
    const i = this.next;
    this.next = (this.next + 1) % MAX_MARKS;
    const h = SIZE / 2;
    const v = i * 4;
    const corners: [number, number][] = [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ];
    for (let k = 0; k < 4; k++) {
      const [a, b] = corners[k];
      this.position.setXYZ(v + k, p.x + tangent.x * a + bitangent.x * b, p.y + tangent.y * a + bitangent.y * b, p.z + tangent.z * a + bitangent.z * b);
      this.color.setXYZ(v + k, color.r, color.g, color.b);
      this.born.setX(v + k, this.time);
    }
    this.position.needsUpdate = true;
    this.color.needsUpdate = true;
    this.born.needsUpdate = true;
    return true;
  }

  /** How many marks are still showing. */
  count(): number {
    const arr = this.born.array as Float32Array;
    let n = 0;
    for (let i = 0; i < arr.length; i += 4) if (arr[i] >= 0 && this.time - arr[i] < LIFE) n++;
    return n;
  }

  /** Every mark gone (a new world). */
  clear(): void {
    (this.born.array as Float32Array).fill(-1);
    this.born.needsUpdate = true;
    this.last.clear();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
