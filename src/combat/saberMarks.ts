// The burns a lightsaber leaves on what it touches, the way Jedi Academy's saber marks do: where a
// lit blade meets a wall or the ground it scorches a line along its path, red hot at first and
// cooling to a dark char that fades away. Each frame's contact is joined to the last one from the
// same blade, so a blade dragged along a surface draws one continuous stroke. One mesh holds every
// stroke's pieces (a ring of quads, the oldest overwritten), so the cost is one draw whatever the number.
import * as THREE from 'three';

/** How many pieces of stroke the world keeps at once. */
const MAX_PIECES = 900;
/** The stroke's width, in metres. */
const WIDTH = 0.035;
/** Seconds a piece glows red before it is only char, and seconds until the char is gone. */
const GLOW_LIFE = 1.4;
const LIFE = 16;
/** Two contacts closer than this lay nothing new; farther apart than the break, they are two strokes. */
const STEP = 0.012;
const BREAK = 0.6;

const VERT = /* glsl */ `
  attribute float aBorn;
  varying vec2 vUv;
  varying float vBorn;
  void main() {
    vUv = uv;
    vBorn = aBorn;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
/**
 * Across the stroke (u) the burn is hottest in the middle; along it (v) it is even. The colour goes
 * from a red-orange glow to a dark char over the glow life, and the char fades out over the life.
 * Pieces not yet laid (born at -1) draw nothing.
 */
const FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uGlowLife;
  uniform float uLife;
  varying vec2 vUv;
  varying float vBorn;
  void main() {
    if (vBorn < 0.0) discard;
    float age = uTime - vBorn;
    if (age > uLife) discard;
    float x = abs(vUv.x * 2.0 - 1.0);
    float across = 1.0 - smoothstep(0.35, 1.0, x);
    float glow = 1.0 - smoothstep(0.0, uGlowLife, age);
    float fade = 1.0 - smoothstep(uLife * 0.55, uLife, age);
    vec3 char = vec3(0.06, 0.035, 0.025);
    // Hot: white-yellow at the very middle, red-orange out to the edge.
    vec3 hot = mix(vec3(1.0, 0.25, 0.05), vec3(1.0, 0.85, 0.5), 1.0 - smoothstep(0.0, 0.5, x));
    vec3 col = mix(char, hot, glow);
    float alpha = across * fade * mix(0.8, 1.0, glow);
    gl_FragColor = vec4(col, alpha);
  }
`;

const n = new THREE.Vector3();
const along = new THREE.Vector3();
const side = new THREE.Vector3();
const p0 = new THREE.Vector3();
const p1 = new THREE.Vector3();

export class SaberMarks {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly position: THREE.BufferAttribute;
  private readonly born: THREE.BufferAttribute;
  private next = 0;
  private time = 0;
  /** Where each blade's stroke last reached, so the next contact joins it. */
  private readonly last = new Map<number, THREE.Vector3>();

  constructor() {
    const g = new THREE.BufferGeometry();
    const count = MAX_PIECES * 4;
    this.position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.born = new THREE.BufferAttribute(new Float32Array(count).fill(-1), 1);
    const uv = new Float32Array(count * 2);
    const index: number[] = [];
    for (let i = 0; i < MAX_PIECES; i++) {
      // The two corners at the stroke's start, then the two at its end: u across, v along.
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      const v = i * 4;
      index.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    g.setAttribute('position', this.position);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aBorn', this.born);
    g.setIndex(index);
    this.position.setUsage(THREE.DynamicDrawUsage);
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
   * Blade `blade` touches a surface at `point` with `normal`: the stroke goes on from where it last
   * was (a short stub when it starts, or starts again after a break). Returns whether anything was laid.
   */
  touch(blade: number, point: THREE.Vector3, normal: THREE.Vector3): boolean {
    let last = this.last.get(blade);
    n.copy(normal).normalize();
    if (!last) {
      last = new THREE.Vector3();
      this.last.set(blade, last);
      last.copy(point);
      return this.stub(point);
    }
    const d = last.distanceTo(point);
    if (d < STEP) return false;
    if (d > BREAK) {
      last.copy(point);
      return this.stub(point);
    }
    this.piece(last, point);
    last.copy(point);
    return true;
  }

  /** A dot's worth of stroke where a stroke begins. */
  private stub(point: THREE.Vector3): boolean {
    side.set(1, 0, 0);
    if (Math.abs(n.dot(side)) > 0.9) side.set(0, 0, 1);
    side.cross(n).normalize().multiplyScalar(WIDTH / 2);
    p0.copy(point).sub(side);
    p1.copy(point).add(side);
    this.piece(p0, p1);
    return true;
  }

  /** A quad of the stroke from `a` to `b`, `WIDTH` across in the surface, a little off it. */
  private piece(a: THREE.Vector3, b: THREE.Vector3): void {
    along.copy(b).sub(a);
    side.crossVectors(along, n);
    if (side.lengthSq() < 1e-10) side.set(1, 0, 0).cross(n);
    side.normalize().multiplyScalar(WIDTH / 2);
    const i = this.next;
    this.next = (this.next + 1) % MAX_PIECES;
    const v = i * 4;
    const lift = 0.006;
    const put = (k: number, at: THREE.Vector3, s: number) => this.position.setXYZ(v + k, at.x + side.x * s + n.x * lift, at.y + side.y * s + n.y * lift, at.z + side.z * s + n.z * lift);
    put(0, a, -1);
    put(1, a, 1);
    put(2, b, 1);
    put(3, b, -1);
    for (let k = 0; k < 4; k++) this.born.setX(v + k, this.time);
    this.position.needsUpdate = true;
    this.born.needsUpdate = true;
  }

  /** How many pieces of stroke are still showing. */
  count(): number {
    const arr = this.born.array as Float32Array;
    let c = 0;
    for (let i = 0; i < arr.length; i += 4) if (arr[i] >= 0 && this.time - arr[i] < LIFE) c++;
    return c;
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
