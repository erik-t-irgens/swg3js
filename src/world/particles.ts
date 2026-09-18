// Particle effects from the game's .prt descriptions (converted to particles/<id>.json by the
// converter), played where the world snapshot places them: campfires, smoke, sparks, steam,
// candle flames, waterfall mist, Mustafar's lava plumes. The rules follow the client's
// ParticleEmitter: every curve is a waveform over the emitter's age (spawn rate, speed, shape
// size, spread, life, weight) or the particle's age (size, rotation, colour, alpha, speed scale),
// each with a random band picked once per particle or every frame. Quads are camera-facing or
// aligned with their velocity, sized by half extents, coloured by a ramp, and blended as the
// texture's shader effect says (additive for fire and glows, alpha for smoke and dust).
//
// Every quad of one texture and blend mode shares a single mesh whose vertex buffers are
// rewritten each frame, so an area with dozens of effects costs a handful of draw calls. Effects
// beyond their level-of-detail range go dormant and drop their particles.
import * as THREE from 'three';
import { ACTOR_LAYER } from './portalRender';

export interface WaveForm {
  /** 0 linear, 1 spline (drawn as linear). */
  interp: number;
  /** 0: the random band is picked once per particle; 1: every frame. */
  sample: number;
  /** The editor's display range; the client does not clamp values to it. */
  min?: number;
  max?: number;
  /** [percent, value, randomMin, randomMax] rows in ascending percent. */
  points: number[][];
}

export interface ColorRamp {
  interp: number;
  /** 0: colour follows the particle's age; 1: one colour picked per particle. */
  sample: number;
  /** [percent, r, g, b] rows. */
  points: number[][];
}

export interface ParticleTextureDef {
  shader: string;
  frameCount: number;
  frameStart: number;
  frameEnd: number;
  frameUVSize: number;
  framesPerColumn: number;
  /** -1 plays the frames over the particle's life. */
  framesPerSecond: number;
  visible: boolean;
  /** Pack-relative PNG, when the converter found the texture. */
  file?: string;
  blend?: 'add' | 'alpha' | 'modulate' | 'opaque';
}

export interface ParticleTiming {
  startDelay: number[];
  loopDelay: number[];
  /** -1 loops forever. */
  loopCount: number[];
}

export interface EmitterDef {
  name: string;
  timing: ParticleTiming | null;
  translationX: WaveForm;
  translationY: WaveForm;
  translationZ: WaveForm;
  rotationX: WaveForm;
  rotationY: WaveForm;
  rotationZ: WaveForm;
  distance: WaveForm;
  shapeSize: WaveForm;
  spread: WaveForm;
  rate: WaveForm;
  speed: WaveForm;
  lifeTime: WaveForm;
  weight: WaveForm;
  direction: 'omni' | 'directional';
  generation: 'rate' | 'distance';
  shape: 'circle' | 'sphere' | 'rectangle' | 'cube' | 'line' | 'x';
  loopImmediately: boolean;
  emitterLife: number[];
  maxParticles: number;
  oneShot: boolean;
  oneShotCount: number[];
  randomInitialRotation: boolean;
  orientation: 'camera' | 'velocity' | 'velocityBank' | 'cameraMesh';
  visible: boolean;
  localSpace: boolean;
  groundCollision: boolean;
  killOnCollision: boolean;
  collisionHeight: number;
  forwardKeep: number[];
  upKeep: number[];
  windResistance: number;
  lod: number[];
  timeOfDayColor: number;
  snapToTerrain: boolean;
  alignToTerrain: boolean;
  snapHeight: number;
  firstImmediately: boolean;
  particle: {
    type: 'quad' | 'mesh';
    name: string;
    randomRotationDirection: boolean;
    color: ColorRamp;
    alpha: WaveForm;
    speedScale: WaveForm;
    relativeRotation: WaveForm[] | null;
    quad?: { rotation: WaveForm; length: WaveForm; width: WaveForm; texture: ParticleTextureDef; linked: boolean };
    mesh?: { path: string; scale: WaveForm; rotation: WaveForm[] };
  };
}

export interface EffectDef {
  version: number;
  timing: ParticleTiming | null;
  playbackRate: number;
  scale: number;
  groups: { timing: ParticleTiming | null; emitters: EmitterDef[] }[];
}

/** A placed effect: its file, its world transform (moved in place by `move`), and whether it is inside a building. */
export interface EffectHandle {
  readonly file: string;
  readonly matrix: THREE.Matrix4;
  readonly contained: boolean;
  /**
   * A passing effect (a bolt in flight, a hit): played from its start the moment it is placed
   * rather than run ahead, never put to sleep for distance, and dropped once it has played out.
   */
  readonly transient: boolean;
  /**
   * A frame the effect lives in (a hull's live matrixWorld, by reference), or null for the world. A
   * framed effect's matrix is in that frame; its particles move in it (gravity is the hull's down)
   * and are carried into the world when their quads are built, so an effect aboard stays in the room
   * while the ship flies.
   */
  readonly frame: THREE.Matrix4 | null;
  /** Multiplies every emitter's rate; 0 stops new particles (a one-shot does not fire). Mutable. */
  rateScale: number;
}

/**
 * What kills particles before their time (the weather's roofs and hulls); null for placed effects.
 * A framed effect is never given one: its particles live in a hull's frame, not the world's.
 */
export interface ParticleKill {
  /** Top surface at x, z (a roof, the ground, a lake's surface): a particle whose quad lies wholly below it, less `slack`, dies. */
  topAt(x: number, z: number): number;
  slack: number;
  /** Particles inside this box (in the hull's own frame, grown by each quad's size) die; null when off. */
  hull: { toLocal: THREE.Matrix4; min: THREE.Vector3; max: THREE.Vector3 } | null;
}

/** How far below its column's top a weather particle may reach before it dies (and its fragments are dropped). */
export const KILL_SLACK = 0.15;

/** A replacement for the stock particle shader (the weather's): same attributes, varyings and uniforms, plus its own. */
export interface ParticleShader {
  vertex: string;
  fragment: string;
  /** Joined by reference into every batch material's uniforms (shared objects, so one write reaches all). */
  uniforms: Record<string, THREE.IUniform>;
}

export interface ParticleEffectsOptions {
  /** Draw in every portal pass (true, as placed effects always have) or only where the owner draws the scene (false: the weather's own pass). */
  actorLayer?: boolean;
  /** Replace the stock vertex and fragment shaders for every batch. */
  shader?: ParticleShader;
}

type HeightAt = ((x: number, z: number) => number) | null;

const GLOBAL_LOD = [20, 200];
/** How far past its LOD range an effect keeps simulating before it goes dormant. */
const DORMANT_SLACK = 40;
const MAX_QUADS = 6000;
const MAX_STEP = 0.1;
const TWO_PI = Math.PI * 2;
const GRAVITY = 9.8;

const rand = Math.random;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A waveform's value at `t` in 0..1, with its random band applied (`r` is the particle's own draw). */
function wave(wf: WaveForm, t: number, r: number): number {
  const pts = wf.points;
  if (!pts.length) return 0;
  if (pts.length === 1) return pts[0][1];
  let i = 0;
  while (i < pts.length - 2 && t > pts[i + 1][0]) i++;
  const a = pts[i];
  const b = pts[i + 1];
  const span = b[0] - a[0];
  const f = span > 0 ? clamp01((t - a[0]) / span) : 0;
  let v = lerp(a[1], b[1], f);
  const rmin = lerp(a[2], b[2], f);
  const rmax = lerp(a[3], b[3], f);
  if (rmin !== 0 || rmax !== 0) v += -rmin + (wf.sample === 1 ? rand() : r) * (rmin + rmax);
  return v;
}

function isFlatZero(wf: WaveForm | undefined): boolean {
  return !wf || wf.points.every((p) => p[1] === 0 && p[2] === 0 && p[3] === 0);
}

function rampColor(ramp: ColorRamp, t: number, out: THREE.Color): THREE.Color {
  const pts = ramp.points;
  if (!pts.length) return out.setRGB(1, 1, 1);
  if (pts.length === 1) return out.setRGB(pts[0][1], pts[0][2], pts[0][3]);
  let i = 0;
  while (i < pts.length - 2 && t > pts[i + 1][0]) i++;
  const a = pts[i];
  const b = pts[i + 1];
  const span = b[0] - a[0];
  const f = span > 0 ? clamp01((t - a[0]) / span) : 0;
  return out.setRGB(lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f));
}

function waveMax(wf: WaveForm): number {
  let m = 0;
  for (const p of wf.points) m = Math.max(m, p[1] + p[3]);
  return m;
}

function randomIn(range: number[]): number {
  return lerp(range[0], range[1], rand());
}

function randomInt(range: number[]): number {
  const lo = Math.min(range[0], range[1]);
  const hi = Math.max(range[0], range[1]);
  return lo + Math.floor(rand() * (hi - lo + 1));
}

/** A point on the emitter shape, in emitter space (unit size), as ParticleEmitterShape samples it. */
function shapePoint(shape: EmitterDef['shape'], out: THREE.Vector3): THREE.Vector3 {
  switch (shape) {
    case 'sphere': {
      const a = rand() * TWO_PI - Math.PI;
      const b = rand() * TWO_PI - Math.PI;
      const x2 = Math.cos(a);
      const y2 = Math.sin(a);
      return out.set(x2, y2 * Math.cos(b), y2 * Math.sin(b));
    }
    case 'rectangle': {
      if (rand() < 0.5) return out.set(rand() < 0.5 ? 1 : -1, 0, rand() * 2 - 1);
      return out.set(rand() * 2 - 1, 0, rand() < 0.5 ? 1 : -1);
    }
    case 'cube': {
      const axis = Math.floor(rand() * 3);
      const s = rand() < 0.5 ? 1 : -1;
      const u = rand() * 2 - 1;
      const v = rand() * 2 - 1;
      if (axis === 0) return out.set(s, u, v);
      if (axis === 1) return out.set(u, s, v);
      return out.set(u, v, s);
    }
    case 'line':
      return out.set(0, 0, rand() < 0.5 ? 1 : -1);
    case 'x':
      return rand() < 0.5 ? out.set(1, 0, 0) : out.set(0, 0, 1);
    case 'circle':
    default: {
      const a = rand() * TWO_PI - Math.PI;
      return out.set(Math.cos(a), 0, Math.sin(a));
    }
  }
}

interface Particle {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  up: THREE.Vector3;
  side: THREE.Vector3;
  age: number;
  life: number;
  weight: number;
  /** Per-particle random draws for the curves' bands and the colour ramp. */
  r0: number;
  r1: number;
  r2: number;
  r3: number;
  initialRotation: number;
  alive: boolean;
  /** The quad's vertical half-extent as last drawn (|length·up.y| + |width·side.y|), for the kill test; 0 before it is first drawn. */
  reach: number;
  /** The quad's larger half-size as last drawn, for the kill test's hull box. */
  extent: number;
}

interface Batch {
  key: string;
  blend: NonNullable<ParticleTextureDef['blend']>;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  capacity: number;
  positions: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  /** Quads queued for this frame: particle, emitter. */
  queue: QueueEntry[];
  /** The queue's entry records, kept and refilled so a frame makes none (only ever grows). */
  entries: QueueEntry[];
}

interface QueueEntry {
  p: Particle;
  e: EmitterState;
  d: number;
}

/** Farthest first, so alpha quads blend back to front; one function, not a closure a frame. */
const byDistanceDesc = (x: QueueEntry, y: QueueEntry): number => y.d - x.d;

/** Particles dropped by their emitters, taken again by the next spawn instead of making new ones. */
const particlePool: Particle[] = [];
const PARTICLE_POOL_MAX = 8192;

function newParticle(): Particle {
  return { pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), side: new THREE.Vector3(1, 0, 0), age: 0, life: 1, weight: 0, r0: 0, r1: 0, r2: 0, r3: 0, initialRotation: 1, alive: true, reach: 0, extent: 0 };
}

function releaseParticle(p: Particle): void {
  if (particlePool.length < PARTICLE_POOL_MAX) particlePool.push(p);
}

const VERT = /* glsl */ `
  attribute vec4 aColor;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFog;
  uniform float uFogDensity;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vColor = aColor;
    float d = length(mv.xyz);
    vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 uFogColor;
  uniform float uAdditive;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFog;
  void main() {
    vec4 t = texture2D(map, vUv);
    vec4 c = t * vColor;
    // Fog dims glows and veils smoke: additive light fades out, alpha quads take the fog colour.
    c.rgb = mix(mix(c.rgb, uFogColor, vFog), c.rgb * (1.0 - vFog), uAdditive);
    if (c.a <= 0.002) discard;
    gl_FragColor = c;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const tmpSide = new THREE.Vector3();
const tmpColor = new THREE.Color();
const tmpM = new THREE.Matrix4();
const tmpM3 = new THREE.Matrix3();
const tmpM3Local = new THREE.Matrix3();
const tmpPos = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const tmpE = new THREE.Euler();
const camX = new THREE.Vector3();
const camY = new THREE.Vector3();
const camZ = new THREE.Vector3();
const camPos = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const tmpKill = new THREE.Vector3();
const tmpWhere = new THREE.Vector3();
const tmpRel = new THREE.Matrix4();

/** Mirror a 3x4 row-major transform for the game's X-flipped coordinates (S M S with S = diag(-1,1,1)). */
export function mirroredTransform(t: number[] | undefined, out: THREE.Matrix4): THREE.Matrix4 {
  if (!t) return out.identity();
  out.set(t[0], -t[1], -t[2], -t[3], -t[4], t[5], t[6], t[7], -t[8], t[9], t[10], t[11], 0, 0, 0, 1);
  return out;
}

class EmitterState {
  readonly particles: Particle[] = [];
  readonly world = new THREE.Matrix4();
  readonly worldPrev = new THREE.Matrix4();
  readonly position = new THREE.Vector3();
  readonly axisY = new THREE.Vector3(0, 1, 0);
  readonly axisZ = new THREE.Vector3(0, 0, 1);
  age = 0;
  lifeTime = 0;
  timeElapsed = 0;
  startDelay = 0;
  currentLoop = 0;
  loopCount = -1;
  newParticles = 0;
  accumulatedDistance = 0;
  frameFirst = true;
  finished = false;
  lodPercent = 1;
  forwardKeep = 1;
  upKeep = 1;
  readonly usesRelativeRotation: boolean;
  readonly maxLife: number;

  constructor(
    readonly def: EmitterDef,
    readonly effect: EffectDef,
    readonly handle: EffectHandle,
  ) {
    const rr = def.particle.relativeRotation;
    this.usesRelativeRotation = !!rr && !(isFlatZero(rr[0]) && isFlatZero(rr[1]) && isFlatZero(rr[2]));
    this.maxLife = waveMax(def.lifeTime);
    this.restart();
  }

  /** Where the effect is placed: the handle's matrix, in the world or in its frame. */
  get placement(): THREE.Matrix4 {
    return this.handle.matrix;
  }

  /** The hull frame the effect lives in, or null for the world. */
  get frame(): THREE.Matrix4 | null {
    return this.handle.frame;
  }

  restart(): void {
    for (const p of this.particles) releaseParticle(p);
    this.particles.length = 0;
    this.currentLoop = 0;
    this.loopCount = this.def.timing ? randomInt(this.def.timing.loopCount) : -1;
    this.frameFirst = true;
    this.finished = false;
    this.loop();
  }

  loop(): void {
    const d = this.def;
    this.lifeTime = Math.max(0, randomIn(d.emitterLife));
    this.forwardKeep = randomIn(d.forwardKeep);
    this.upKeep = randomIn(d.upKeep);
    this.age = 0;
    this.timeElapsed = 0;
    this.newParticles = 0;
    this.accumulatedDistance = 0;
    const t = d.timing;
    this.startDelay = t ? (this.currentLoop <= 0 ? randomIn(t.startDelay) : randomIn(t.loopDelay)) : 0;
    if (this.currentLoop <= 0 || d.oneShot || this.startDelay > 0.5) this.frameFirst = true;
  }

  get agePercent(): number {
    return this.age >= this.lifeTime ? 1 : this.age / this.lifeTime;
  }

  /** Whether this emitter is done for the current run of its group (no particles, no more loops). */
  get deletable(): boolean {
    return this.finished && this.particles.length === 0;
  }

  /** The emitter's world transform for this moment: placement, then the description's translation and rotation curves. */
  updateTransform(agePercent: number): void {
    const d = this.def;
    const s = this.effect.scale;
    // The client yaws, then pitches, then rolls (turns), then moves in parent space.
    tmpE.set(wave(d.rotationX, agePercent, 0) * TWO_PI, wave(d.rotationY, agePercent, 0) * TWO_PI, wave(d.rotationZ, agePercent, 0) * TWO_PI, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpV.set(wave(d.translationX, agePercent, 0) * s, wave(d.translationY, agePercent, 0) * s, wave(d.translationZ, agePercent, 0) * s);
    tmpM.compose(tmpV, tmpQ, ONE);
    // Mirror for the game's X-flipped coordinates: yaw and roll change sign, X offsets flip.
    const e = tmpM.elements;
    e[1] = -e[1];
    e[2] = -e[2];
    e[4] = -e[4];
    e[8] = -e[8];
    e[12] = -e[12];
    this.worldPrev.copy(this.world);
    this.world.multiplyMatrices(this.placement, tmpM);
    this.position.setFromMatrixPosition(this.world);
    tmpM3.setFromMatrix4(this.world);
    this.axisY.set(0, 1, 0).applyMatrix3(tmpM3).normalize();
    this.axisZ.set(0, 0, 1).applyMatrix3(tmpM3).normalize();
    if (this.frameFirst) this.worldPrev.copy(this.world);
  }

  spawn(count: number, dtSpread: number, heightAt: HeightAt, kill: ParticleKill | null): void {
    const d = this.def;
    const s = this.effect.scale;
    const agePercent = d.oneShot ? 0 : this.agePercent;
    const shapeSize = wave(d.shapeSize, agePercent, rand()) * s;
    const distance = wave(d.distance, agePercent, rand()) * s;
    tmpM3.setFromMatrix4(this.world);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= d.maxParticles) break;
      // From the pool when it has one, every field set again as a new particle has it.
      const p = particlePool.pop() ?? newParticle();
      p.pos.set(0, 0, 0);
      p.prev.set(0, 0, 0);
      p.vel.set(0, 0, 0);
      p.up.set(0, 1, 0);
      p.side.set(1, 0, 0);
      p.age = 0;
      p.life = 1;
      p.weight = 0;
      p.r0 = rand();
      p.r1 = rand();
      p.r2 = rand();
      p.r3 = rand();
      p.initialRotation = 1;
      p.alive = true;
      p.reach = 0;
      p.extent = 0;
      if (d.direction === 'directional') {
        const spread = (wave(d.spread, agePercent, rand()) * Math.PI) / 180;
        const r1 = rand() < 0.5 ? spread : -spread;
        const r2 = rand() * TWO_PI - Math.PI;
        const x2 = -Math.sin(r1);
        const y2 = Math.cos(r1);
        tmpDir.set(x2 * Math.cos(r2), y2, -x2 * Math.sin(r2));
        shapePoint(d.shape, tmpV).multiplyScalar(shapeSize).addScaledVector(tmpDir, distance);
      } else {
        shapePoint(d.shape, tmpDir);
        tmpV.copy(tmpDir).multiplyScalar(shapeSize + distance);
      }
      if (d.localSpace) {
        // Carried by the emitter: the particle lives in the emitter's own frame and is put into
        // the world only when drawn, so it rides along with whatever the effect is on (a bolt).
        p.pos.copy(tmpV);
        p.vel.copy(tmpDir);
      } else {
        // Emitter space to world: rotate by the emitter's frame, place along its movement this frame.
        tmpV.applyMatrix3(tmpM3);
        tmpV2.setFromMatrixPosition(this.worldPrev).lerp(this.position, rand());
        p.pos.copy(tmpV2).add(tmpV);
        p.vel.copy(tmpDir).applyMatrix3(tmpM3);
      }
      const speed = wave(d.speed, agePercent, rand()) * s;
      p.vel.multiplyScalar(speed);
      p.life = Math.max(0.01, wave(d.lifeTime, agePercent, rand()));
      p.weight = wave(d.weight, agePercent, rand()) * s;
      if (d.snapToTerrain && heightAt) {
        p.pos.y = heightAt(p.pos.x, p.pos.z) + d.snapHeight;
        if (d.alignToTerrain) p.vel.set(0, speed, 0);
      }
      p.prev.copy(p.pos);
      p.initialRotation = d.randomInitialRotation ? rand() : 1;
      if (d.particle.randomRotationDirection && rand() < 0.5) p.initialRotation = -p.initialRotation;
      if (p.vel.lengthSq() > 0) p.up.copy(p.vel).normalize();
      else p.up.copy(this.axisY);
      if (d.orientation === 'velocity') {
        // In the emitter's own frame its axes are the plain ones.
        const axisY = d.localSpace ? Y_AXIS : this.axisY;
        const axisZ = d.localSpace ? Z_AXIS : this.axisZ;
        if (Math.abs(p.up.dot(axisY)) > 0.99) p.side.crossVectors(p.up, axisZ);
        else p.side.crossVectors(p.up, axisY);
        if (p.side.lengthSq() < 1e-8) p.side.set(1, 0, 0);
        p.side.normalize();
      }
      this.particles.push(p);
      // New particles start part-way through the frame, so a stream stays even at low frame rates.
      if (dtSpread > 0) this.integrate(p, dtSpread * rand(), heightAt, kill);
    }
  }

  integrate(p: Particle, dt: number, heightAt: HeightAt, kill: ParticleKill | null): void {
    const d = this.def;
    p.age += dt;
    if (p.age > p.life) p.age = p.life;
    const t = p.age / p.life;
    const speedScale = wave(d.particle.speedScale, t, p.r0);
    p.prev.copy(p.pos);
    p.pos.addScaledVector(p.vel, dt * speedScale);
    const fall = -GRAVITY * p.weight * dt;
    if (d.groundCollision && heightAt) {
      const ground = heightAt(p.pos.x, p.pos.z) + d.collisionHeight;
      if (p.pos.y >= ground) p.vel.y += fall;
      if (p.pos.y <= ground) {
        if (p.prev.y >= ground) {
          p.pos.y = ground;
          p.vel.y = Math.abs(p.vel.y) * this.upKeep;
          p.vel.x *= this.forwardKeep;
          p.vel.z *= this.forwardKeep;
          if (d.killOnCollision) p.alive = false;
        }
      }
    } else p.vel.y += fall;
    if ((d.orientation === 'velocity' || d.orientation === 'velocityBank') && p.vel.lengthSq() > 1e-10) p.up.copy(p.vel).normalize();
    if (p.age >= p.life) p.alive = false;
    // Killed early: wholly under the surface above the ground there (a roof, the ground), or inside a hull's box.
    if (kill && !d.localSpace && !d.snapToTerrain) {
      if (p.pos.y + p.reach < kill.topAt(p.pos.x, p.pos.z) - kill.slack) p.alive = false;
      else if (kill.hull) {
        tmpKill.copy(p.pos).applyMatrix4(kill.hull.toLocal);
        const g = p.extent;
        const lo = kill.hull.min;
        const hi = kill.hull.max;
        if (tmpKill.x > lo.x - g && tmpKill.x < hi.x + g && tmpKill.y > lo.y - g && tmpKill.y < hi.y + g && tmpKill.z > lo.z - g && tmpKill.z < hi.z + g) p.alive = false;
      }
    }
  }

  /** Advance the emitter by `dt` seconds; returns false once it is finished and empty. */
  update(dt: number, heightAt: HeightAt, distanceToCamera: number, kill: ParticleKill | null): void {
    const d = this.def;
    this.timeElapsed += dt;
    let createParticles = false;
    let doLoop = false;
    if (this.timeElapsed >= this.startDelay && !this.finished) {
      this.age += dt;
      const agePercent = this.frameFirst && d.oneShot ? 0 : this.agePercent;
      this.updateTransform(agePercent);
      if (agePercent < 1 && (!d.oneShot || this.frameFirst)) {
        if (d.generation === 'distance') this.accumulatedDistance += this.position.distanceToSquared(tmpV.setFromMatrixPosition(this.worldPrev));
        createParticles = true;
      } else if (agePercent >= 1) {
        if (d.loopImmediately || this.particles.length === 0) doLoop = true;
      }
    } else if (this.frameFirst) this.updateTransform(0);
    this.updateLod(distanceToCamera);
    if (createParticles) this.createNewParticles(dt, heightAt, kill);
    this.frameFirst = createParticles ? false : this.frameFirst;
    for (const p of this.particles) if (p.alive) this.integrate(p, dt, heightAt, kill);
    let w = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.alive) this.particles[w++] = p;
      else releaseParticle(p);
    }
    this.particles.length = w;
    if (doLoop) {
      this.currentLoop++;
      if (this.loopCount === -1 || this.currentLoop <= this.loopCount) this.loop();
      else this.finished = true;
    }
  }

  private updateLod(distance: number): void {
    const [lo, hi] = this.def.lod;
    let min: number;
    let max: number;
    if ((lo >= -1 && lo < 0) || (hi >= -1 && hi < 0)) [min, max] = GLOBAL_LOD;
    else if (lo < 1 || hi < 1) {
      this.lodPercent = 1;
      return;
    } else [min, max] = [lo, hi];
    const span = max - min;
    this.lodPercent = span <= 0 ? (distance < max ? 1 : 0) : clamp01(1 - (distance - min) / span);
  }

  private createNewParticles(dt: number, heightAt: HeightAt, kill: ParticleKill | null): void {
    const d = this.def;
    const agePercent = this.agePercent;
    const scale = this.handle.rateScale;
    // Stopped: nothing new, a one-shot included; what is already flying lives out its life.
    if (!(scale > 0)) {
      this.newParticles = 0;
      this.accumulatedDistance = 0;
      return;
    }
    if (d.oneShot) {
      if (this.particles.length === 0 || d.loopImmediately) {
        const n = randomInt(d.oneShotCount);
        if (this.particles.length + n <= d.maxParticles) this.newParticles = n;
      }
    } else {
      const rate = wave(d.rate, agePercent, rand());
      if (d.generation === 'rate') this.newParticles += dt * this.lodPercent * rate * scale;
      else if (rate > 0) {
        this.newParticles += Math.sqrt(this.accumulatedDistance / (rate * rate * this.effect.scale)) * this.lodPercent * scale;
        this.accumulatedDistance = 0;
      }
    }
    if (d.firstImmediately && this.frameFirst && this.newParticles < 1) this.newParticles += 1;
    const count = Math.floor(this.newParticles);
    if (count > 0) {
      this.spawn(count, d.oneShot || (d.firstImmediately && this.frameFirst) ? 0 : dt, heightAt, kill);
      this.newParticles -= count;
    }
  }
}

class EffectInstance {
  readonly emitters: EmitterState[] = [];
  readonly position = new THREE.Vector3();
  /** Beyond this distance the effect sleeps and drops its particles. */
  readonly sleepDistance: number;
  readonly maxLife: number;
  active = false;
  loops = 0;
  /** Played out with no loops left (a one-shot hit): nothing more to draw. */
  finished = false;

  constructor(
    readonly handle: EffectHandle,
    readonly def: EffectDef,
  ) {
    this.position.setFromMatrixPosition(handle.matrix);
    let reach = 0;
    let life = 0;
    for (const g of def.groups) {
      for (const e of g.emitters) {
        if (!e.visible || e.particle.type !== 'quad' || !e.particle.quad?.texture.file || !e.particle.quad.texture.visible) continue;
        this.emitters.push(new EmitterState(e, def, handle));
        const [lo, hi] = e.lod;
        reach = Math.max(reach, (lo >= -1 && lo < 0) || (hi >= -1 && hi < 0) ? GLOBAL_LOD[1] : lo < 1 || hi < 1 ? GLOBAL_LOD[1] : hi);
        life = Math.max(life, waveMax(e.lifeTime));
      }
    }
    this.sleepDistance = reach + DORMANT_SLACK;
    this.maxLife = life;
  }

  restart(): void {
    for (const e of this.emitters) e.restart();
  }

  /** Seconds since placed, for a transient effect's own end. */
  age = 0;

  update(dt: number, heightAt: HeightAt, distance: number, kill: ParticleKill | null): void {
    this.age += dt;
    let allDone = this.emitters.length > 0;
    for (const e of this.emitters) {
      e.update(dt, heightAt, distance, kill);
      if (!e.deletable) allDone = false;
    }
    const transient = this.handle.transient;
    if (allDone) {
      // The whole effect ran out: play again unless its own timing limits the loops. A transient
      // effect (a hit, a flash) plays once: many of the client's hit effects loop for ever on their own.
      this.loops++;
      const limit = this.def.timing ? randomInt(this.def.timing.loopCount) : -1;
      if (!transient && (limit === -1 || this.loops < limit)) this.restart();
      else this.finished = true;
    } else if (transient && this.age > Math.max(this.maxLife, 0.5) * 2 + 1.5) {
      // An emitter that never runs out (a steady spray) still ends a transient effect after one life.
      this.finished = true;
    }
  }

  get particleCount(): number {
    let n = 0;
    for (const e of this.emitters) n += e.particles.length;
    return n;
  }

  /** Where the effect stands in the world: its position, carried out of its hull's frame when it has one. */
  worldPosition(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.position);
    const frame = this.handle.frame;
    if (frame) out.applyMatrix4(frame);
    return out;
  }
}

/** Plays converted particle effects at placed positions, batching their quads per texture. */
export class ParticleEffects {
  private readonly defs = new Map<string, Promise<EffectDef | null>>();
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly batches = new Map<string, Batch>();
  private readonly instances = new Map<EffectHandle, EffectInstance>();
  private readonly pending = new Set<EffectHandle>();
  private readonly loader = new THREE.TextureLoader();
  private readonly fogColor = new THREE.Color(0.6, 0.6, 0.6);
  private readonly textureErrors = new Set<string>();
  private lastCamera: THREE.Camera | null = null;
  private fogDensity = 0;
  private quadCount = 0;
  private activeCount = 0;
  private disposed = false;
  /** Terrain height lookup for particles that bounce or snap to the ground. */
  heightAt: ((x: number, z: number) => number) | null = null;
  /** What kills particles early (the weather's); null for placed effects, and never applied to a framed effect. */
  kill: ParticleKill | null = null;

  /** Whether batches draw in every portal pass (the actor layer) or only in the owner's own pass. */
  private readonly actorLayer: boolean;
  private readonly shader: ParticleShader | null;
  /** Every batch material made so far (the weather pass sets its stencil on them). A kept array. */
  readonly batchMaterials: THREE.ShaderMaterial[] = [];
  /** Textures still loading, resolved when each has loaded or failed (what `prepare` waits on). */
  private readonly textureReady = new Map<string, Promise<void>>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly baseUrl: string,
    options: ParticleEffectsOptions = {},
  ) {
    this.actorLayer = options.actorLayer ?? true;
    this.shader = options.shader ?? null;
  }

  /** Quads queued in the last update. */
  get quads(): number {
    return this.quadCount;
  }

  /**
   * Load an effect's description, make its batches now (hidden), and wait for their textures,
   * uploading them when a renderer is given; so neither a program nor a texture upload waits for
   * the first quad. Resolves false when the effect failed to load.
   */
  async prepare(file: string, renderer?: THREE.WebGLRenderer | null): Promise<boolean> {
    const def = await this.load(file);
    if (!def || this.disposed) return false;
    const waits: Promise<void>[] = [];
    for (const g of def.groups) {
      for (const e of g.emitters) {
        const tex = e.particle.quad?.texture;
        if (!e.visible || e.particle.type !== 'quad' || !tex?.file || !tex.visible) continue;
        this.batch(tex.file, tex.blend ?? 'alpha');
        const ready = this.textureReady.get(tex.file);
        if (ready) waits.push(ready);
      }
    }
    await Promise.all(waits);
    if (renderer && !this.disposed) {
      for (const g of def.groups) {
        for (const e of g.emitters) {
          const f = e.particle.quad?.texture.file;
          const t = f ? this.textures.get(f) : undefined;
          if (t && f && !this.textureErrors.has(f)) renderer.initTexture(t);
        }
      }
    }
    return true;
  }

  get status(): string {
    return `${this.instances.size} particle effects placed, ${this.activeCount} playing, ${this.quadCount} quads in ${this.batches.size} batches${this.textureErrors.size ? `, ${this.textureErrors.size} textures failed to load: ${[...this.textureErrors].join(', ')}` : ''}`;
  }

  /**
   * Place an effect; `matrix` is its world transform. Returns a handle for `remove` and `move`.
   * A `transient` effect (a bolt, a hit) plays from its start when placed, is never put to sleep
   * for distance, and is dropped by itself once it has played out. With a `frame` (a hull's live
   * matrixWorld, kept by reference) `matrix` is in that frame, and the effect simulates there and is
   * carried into the world as it is drawn: something played aboard stays in the room while the ship flies.
   */
  place(file: string, matrix: THREE.Matrix4, contained: boolean, transient = false, frame: THREE.Matrix4 | null = null): EffectHandle {
    const handle: EffectHandle = { file, matrix: matrix.clone(), contained, transient, frame, rateScale: 1 };
    this.pending.add(handle);
    void this.load(file).then((def) => {
      if (this.disposed || !this.pending.delete(handle) || !def) return;
      this.instances.set(handle, new EffectInstance(handle, def));
    });
    return handle;
  }

  /** Move a placed effect: its emitters follow (the handle's matrix is what they hang on). */
  move(handle: EffectHandle, matrix: THREE.Matrix4): void {
    handle.matrix.copy(matrix);
    this.instances.get(handle)?.position.setFromMatrixPosition(matrix);
  }

  remove(handle: EffectHandle): void {
    this.pending.delete(handle);
    this.instances.delete(handle);
  }

  /** Live particles of one placed effect (0 while it is loading or asleep), for the console. */
  particlesOf(handle: EffectHandle): number {
    return this.instances.get(handle)?.particleCount ?? 0;
  }

  /** Whether a placed effect is still to come or still playing. */
  playing(handle: EffectHandle): boolean {
    return this.pending.has(handle) || (this.instances.get(handle)?.finished === false);
  }

  /** The additive batches drawing this frame (fill sets visible by quad count), for the depth of field's glow depth. Fills `out` from `n`; returns the new count. */
  glowBatches(out: THREE.Object3D[], n: number): number {
    for (const b of this.batches.values()) if (b.blend === 'add' && b.mesh.visible) out[n++] = b.mesh;
    return n;
  }

  private load(file: string): Promise<EffectDef | null> {
    let p = this.defs.get(file);
    if (!p) {
      p = fetch(this.baseUrl + file)
        .then(async (r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          const def = (await r.json()) as EffectDef;
          for (const g of def.groups) for (const e of g.emitters) if (e.particle.quad?.texture.file) this.texture(e.particle.quad.texture.file);
          return def;
        })
        .catch((err) => {
          console.warn(`particle effect ${file} failed to load: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        });
      this.defs.set(file, p);
    }
    return p;
  }

  private texture(file: string): THREE.Texture {
    let t = this.textures.get(file);
    if (!t) {
      let settle: () => void = () => {};
      this.textureReady.set(file, new Promise<void>((resolve) => (settle = resolve)));
      t = this.loader.load(this.baseUrl + file, () => settle(), undefined, () => {
        this.textureErrors.add(file);
        console.warn(`particle texture ${file} failed to load`);
        settle();
      });
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      this.textures.set(file, t);
    }
    return t;
  }

  private batch(file: string, blend: NonNullable<ParticleTextureDef['blend']>): Batch {
    const key = `${file}|${blend}`;
    let b = this.batches.get(key);
    if (b) return b;
    const shader = this.shader;
    const uniforms: Record<string, THREE.IUniform> = { map: { value: this.texture(file) }, uFogColor: { value: this.fogColor }, uFogDensity: { value: this.fogDensity }, uAdditive: { value: blend === 'add' ? 1 : 0 } };
    // The replacement's own uniforms are shared objects: one write reaches every batch.
    if (shader) Object.assign(uniforms, shader.uniforms);
    const material = new THREE.ShaderMaterial({
      vertexShader: shader?.vertex ?? VERT,
      fragmentShader: shader?.fragment ?? FRAG,
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: blend === 'add' ? THREE.AdditiveBlending : blend === 'modulate' ? THREE.MultiplyBlending : THREE.NormalBlending,
    });
    const geometry = new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    // Smoke before glows, so fire shows through its own smoke the way the client sorts them.
    mesh.renderOrder = blend === 'add' ? 12 : 11;
    if (this.actorLayer) mesh.layers.enable(ACTOR_LAYER);
    // Hidden until it has quads (a batch made ahead by `prepare` draws nothing, but is compiled).
    mesh.visible = false;
    this.scene.add(mesh);
    this.batchMaterials.push(material);
    b = { key, blend, mesh, material, capacity: 0, positions: new Float32Array(0), colors: new Float32Array(0), uvs: new Float32Array(0), queue: [], entries: [] };
    this.grow(b, 256);
    this.batches.set(key, b);
    return b;
  }

  private grow(b: Batch, quads: number): void {
    b.capacity = quads;
    b.positions = new Float32Array(quads * 12);
    b.colors = new Float32Array(quads * 16);
    b.uvs = new Float32Array(quads * 8);
    const index = new Uint32Array(quads * 6);
    for (let i = 0; i < quads; i++) {
      const v = i * 4;
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    const g = b.mesh.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(b.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(b.colors, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(b.uvs, 2).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  }

  /** Advance every effect and rebuild the quad batches for this camera. */
  update(dt: number, camera: THREE.Camera, fog: THREE.FogExp2 | null): void {
    if (this.disposed) return;
    dt = Math.min(dt, MAX_STEP);
    if (fog) {
      this.fogColor.copy(fog.color);
      this.fogDensity = fog.density;
    } else this.fogDensity = 0;
    this.lastCamera = camera;
    camera.updateMatrixWorld();
    camPos.setFromMatrixPosition(camera.matrixWorld);
    camera.matrixWorld.extractBasis(camX, camY, camZ);
    for (const b of this.batches.values()) {
      b.queue.length = 0;
      b.material.uniforms.uFogDensity.value = this.fogDensity;
    }
    let active = 0;
    for (const [handle, inst] of this.instances) {
      const framed = handle.frame !== null;
      const distance = inst.worldPosition(tmpWhere).distanceTo(camPos);
      // A framed effect's particles are in a hull's frame: the planet's ground and the weather's kill mean nothing there.
      const heightAt = framed ? null : this.heightAt;
      const kill = framed ? null : this.kill;
      const transient = handle.transient;
      if (!transient && distance > inst.sleepDistance) {
        if (inst.active) {
          inst.active = false;
          for (const e of inst.emitters) e.particles.length = 0;
        }
        continue;
      }
      if (!inst.active) {
        inst.active = true;
        inst.restart();
        if (!transient) {
          // Woken: run the effect ahead so a smoke column is already standing when it comes into view.
          const warm = Math.min(10, inst.maxLife);
          const steps = Math.ceil(warm / MAX_STEP);
          for (let i = 0; i < steps; i++) inst.update(warm / steps, heightAt, distance, kill);
        }
      }
      active++;
      inst.update(dt * (inst.def.playbackRate || 1), heightAt, distance, kill);
      if (transient && inst.finished) {
        // A hit that has played out: gone, so a fight does not pile up spent effects.
        this.instances.delete(handle);
        continue;
      }
      for (const e of inst.emitters) {
        const tex = e.def.particle.quad!.texture;
        const b = this.batch(tex.file!, tex.blend ?? 'alpha');
        const local = e.def.localSpace;
        // A framed effect's points are hull-local: it sorts as one, by its own distance.
        for (let k = 0; k < e.particles.length; k++) {
          const p = e.particles[k];
          const d = framed ? distance * distance : (local ? e.position : p.pos).distanceToSquared(camPos);
          const n = b.queue.length;
          let q = b.entries[n];
          if (q) {
            q.p = p;
            q.e = e;
            q.d = d;
          } else {
            q = { p, e, d };
            b.entries[n] = q;
          }
          b.queue.push(q);
        }
      }
    }
    this.activeCount = active;
    let total = 0;
    for (const b of this.batches.values()) total += this.fill(b, total);
    this.quadCount = total;
  }

  private fill(b: Batch, drawnSoFar: number): number {
    const q = b.queue;
    if (b.blend !== 'add') q.sort(byDistanceDesc);
    let n = Math.min(q.length, MAX_QUADS - drawnSoFar);
    if (n < 0) n = 0;
    if (n > b.capacity) this.grow(b, Math.min(MAX_QUADS, Math.max(n, b.capacity * 2)));
    const pos = b.positions;
    const col = b.colors;
    const uv = b.uvs;
    for (let i = 0; i < n; i++) {
      const { p, e } = q[i];
      const d = e.def;
      const quad = d.particle.quad!;
      const t = p.age / p.life;
      const s = e.effect.scale;
      const length = wave(quad.length, t, p.r1) * s;
      const width = quad.linked ? length : wave(quad.width, t, p.r2) * s;
      let alpha = wave(d.particle.alpha, t, p.r0);
      rampColor(d.particle.color, d.particle.color.sample === 1 ? p.r3 : t, tmpColor);
      if (d.timeOfDayColor > 0) tmpColor.lerp(this.fogColor, d.timeOfDayColor);
      alpha = clamp01(alpha);
      let rotation = (p.initialRotation + wave(quad.rotation, t, p.r2)) * TWO_PI;
      if (p.initialRotation < 0) rotation = -rotation;
      // A particle carried by its emitter is put into the world here: its place through the
      // emitter's transform, and its heading through the emitter's turn.
      const local = d.localSpace;
      if (local) {
        tmpM3Local.setFromMatrix4(e.world);
        tmpPos.copy(p.pos).applyMatrix4(e.world);
      } else tmpPos.copy(p.pos);
      // An effect in a hull's frame is carried into the world here, as the quad is built.
      const hull = e.frame;
      if (hull) tmpPos.applyMatrix4(hull);
      switch (d.orientation) {
        case 'velocity': {
          tmpUp.subVectors(p.pos, p.prev);
          if (tmpUp.lengthSq() < 1e-12) tmpUp.copy(p.up);
          if (local) tmpUp.applyMatrix3(tmpM3Local);
          tmpUp.normalize();
          tmpSide.copy(p.side);
          if (local) tmpSide.applyMatrix3(tmpM3Local).normalize();
          if (hull) {
            tmpUp.transformDirection(hull);
            tmpSide.transformDirection(hull);
          }
          break;
        }
        case 'velocityBank': {
          tmpUp.copy(p.up);
          if (local) tmpUp.applyMatrix3(tmpM3Local).normalize();
          if (hull) tmpUp.transformDirection(hull);
          tmpSide.crossVectors(tmpUp, tmpV.subVectors(camPos, tmpPos));
          if (tmpSide.lengthSq() < 1e-12) tmpSide.copy(camX);
          tmpSide.normalize();
          break;
        }
        default: {
          const c = Math.cos(rotation);
          const sn = Math.sin(rotation);
          tmpUp.copy(camY).multiplyScalar(c).addScaledVector(camX, -sn);
          tmpSide.copy(camX).multiplyScalar(c).addScaledVector(camY, sn);
        }
      }
      if (e.usesRelativeRotation) {
        const rr = d.particle.relativeRotation!;
        tmpV2.crossVectors(tmpSide, tmpUp);
        tmpM.makeBasis(tmpSide, tmpV2, tmpUp);
        tmpE.set(wave(rr[0], t, p.r3) * TWO_PI, wave(rr[1], t, p.r3) * TWO_PI, wave(rr[2], t, p.r3) * TWO_PI, 'YXZ');
        tmpM.multiply(tmpRel.makeRotationFromEuler(tmpE));
        tmpM3.setFromMatrix4(tmpM);
        tmpUp.set(0, 0, 1).applyMatrix3(tmpM3);
        tmpSide.set(1, 0, 0).applyMatrix3(tmpM3);
      }
      // What the kill test reads next step: how far the quad reaches up and down, and its larger half-size.
      p.reach = Math.abs(length * tmpUp.y) + Math.abs(width * tmpSide.y);
      p.extent = Math.max(Math.abs(length), Math.abs(width));
      tmpUp.multiplyScalar(length);
      tmpSide.multiplyScalar(width);
      const o = i * 12;
      const px = tmpPos.x, py = tmpPos.y, pz = tmpPos.z;
      // a: -up +side, b: +up +side, c: +up -side, d: -up -side
      pos[o] = px - tmpUp.x + tmpSide.x; pos[o + 1] = py - tmpUp.y + tmpSide.y; pos[o + 2] = pz - tmpUp.z + tmpSide.z;
      pos[o + 3] = px + tmpUp.x + tmpSide.x; pos[o + 4] = py + tmpUp.y + tmpSide.y; pos[o + 5] = pz + tmpUp.z + tmpSide.z;
      pos[o + 6] = px + tmpUp.x - tmpSide.x; pos[o + 7] = py + tmpUp.y - tmpSide.y; pos[o + 8] = pz + tmpUp.z - tmpSide.z;
      pos[o + 9] = px - tmpUp.x - tmpSide.x; pos[o + 10] = py - tmpUp.y - tmpSide.y; pos[o + 11] = pz - tmpUp.z - tmpSide.z;
      const co = i * 16;
      for (let k = 0; k < 4; k++) {
        col[co + k * 4] = tmpColor.r;
        col[co + k * 4 + 1] = tmpColor.g;
        col[co + k * 4 + 2] = tmpColor.b;
        col[co + k * 4 + 3] = alpha;
      }
      // Texture frame: over the particle's life, or at a fixed rate.
      const tex = quad.texture;
      const used = Math.max(1, tex.frameEnd + 1 - tex.frameStart);
      let frame = tex.frameStart;
      if (tex.framesPerSecond === -1) {
        if (tex.frameStart !== tex.frameEnd) frame = tex.frameStart + Math.min(used - 1, Math.floor(used * t));
      } else if (p.age > 0 && tex.framesPerSecond > 0) frame += Math.floor(p.age * tex.framesPerSecond) % used;
      const perColumn = Math.max(1, tex.framesPerColumn);
      const size = tex.frameUVSize || 1;
      const cu = (frame % perColumn) * size;
      const cv = Math.floor(frame / perColumn) * size;
      const uo = i * 8;
      uv[uo] = cu + size; uv[uo + 1] = cv + size;
      uv[uo + 2] = cu + size; uv[uo + 3] = cv;
      uv[uo + 4] = cu; uv[uo + 5] = cv;
      uv[uo + 6] = cu; uv[uo + 7] = cv + size;
    }
    const g = b.mesh.geometry;
    g.setDrawRange(0, n * 6);
    b.mesh.visible = n > 0;
    if (n > 0) {
      (g.getAttribute('position') as THREE.BufferAttribute).addUpdateRange(0, n * 12);
      (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('aColor') as THREE.BufferAttribute).addUpdateRange(0, n * 16);
      (g.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('uv') as THREE.BufferAttribute).addUpdateRange(0, n * 8);
      (g.getAttribute('uv') as THREE.BufferAttribute).needsUpdate = true;
    }
    return n;
  }

  /**
   * Every emitter of the effects within `r` metres, with what it draws: texture, blend, whether
   * the texture loaded, live particles, and the first particle's size, alpha, colour and screen
   * position, for telling an invisible effect from a missing one.
   */
  describeEmitters(x: number, z: number, r: number): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    const cam = this.lastCamera;
    for (const inst of this.instances.values()) {
      const at = inst.worldPosition(tmpWhere);
      const d = Math.hypot(at.x - x, at.z - z);
      if (d > r) continue;
      for (const e of inst.emitters) {
        const tex = e.def.particle.quad!.texture;
        const img = this.textures.get(tex.file!)?.image as { width?: number; height?: number } | undefined;
        const p = e.particles[0];
        const row: Record<string, unknown> = { effect: inst.handle.file.replace(/^particles\/|\.json$/g, ''), emitter: e.def.name, d: Math.round(d), texture: tex.file, blend: tex.blend, textureLoaded: img?.width ? `${img.width}x${img.height}` : this.textureErrors.has(tex.file!) ? 'FAILED' : 'pending', playing: inst.active, lod: Math.round(e.lodPercent * 100) / 100, particles: e.particles.length, max: e.def.maxParticles, rate: Math.round(waveMax(e.def.rate) * 10) / 10, life: Math.round(e.maxLife * 10) / 10, scale: e.effect.scale, emitterLife: e.def.emitterLife.join('..'), orientation: e.def.orientation };
        if (p) {
          const t = p.age / p.life;
          const quad = e.def.particle.quad!;
          const length = wave(quad.length, t, p.r1) * e.effect.scale;
          rampColor(e.def.particle.color, e.def.particle.color.sample === 1 ? p.r3 : t, tmpColor);
          row.first = { x: Math.round(p.pos.x * 10) / 10, y: Math.round(p.pos.y * 10) / 10, z: Math.round(p.pos.z * 10) / 10, age: Math.round(t * 100) / 100, halfLength: Math.round(length * 100) / 100, halfWidth: Math.round((quad.linked ? length : wave(quad.width, t, p.r2) * e.effect.scale) * 100) / 100, alpha: Math.round(wave(e.def.particle.alpha, t, p.r0) * 100) / 100, color: tmpColor.getHexString() };
          if (cam) {
            tmpV.copy(p.pos);
            if (e.def.localSpace) tmpV.applyMatrix4(e.world);
            if (e.frame) tmpV.applyMatrix4(e.frame);
            tmpV.project(cam);
            (row.first as Record<string, unknown>).screen = tmpV.z < 1 ? `${Math.round((tmpV.x + 1) * 50)}%,${Math.round((1 - tmpV.y) * 50)}%` : 'behind camera';
          }
        }
        out.push(row);
      }
    }
    return out.sort((a, b) => (a.d as number) - (b.d as number));
  }

  /** Effects within `r` metres of a point, for the console. */
  describeNear(x: number, z: number, r: number): { file: string; d: number; x: number; y: number; z: number; playing: boolean; particles: number }[] {
    const out: { file: string; d: number; x: number; y: number; z: number; playing: boolean; particles: number }[] = [];
    for (const inst of this.instances.values()) {
      const p = inst.worldPosition(tmpWhere);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d <= r) out.push({ file: inst.handle.file, d: Math.round(d), x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round(p.z * 10) / 10, playing: inst.active, particles: inst.particleCount });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  dispose(): void {
    this.disposed = true;
    for (const b of this.batches.values()) {
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.material.dispose();
    }
    this.batches.clear();
    this.batchMaterials.length = 0;
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.instances.clear();
    this.pending.clear();
  }
}

