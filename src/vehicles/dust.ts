// Dust kicked up by a vehicle: a cloud of point sprites thrown from behind it, coloured by the
// ground it runs over (the terrain's texture family or palette), rising and thinning as it goes.
// One mesh for every cloud, its buffers rewritten each frame, like the water's splashes.
//
// With the volumetrics' dust and kick-up on, a mote may be a grain instead (`spawn`'s `grain`, chosen per spawn): sand
// thrown up and back that falls under gravity onto the moving air's own height raster -- one array read, no terrain
// call -- and lies there a moment before it fades (the handoff's kick-up, the owner's "sand that falls back"). Same pool,
// same buffers, same material: a rule on the CPU and no new program. A mote spawned as today's is stepped by today's
// lines exactly, so with the volumetrics off the pool is today's to the bit.
import * as THREE from 'three';

/** The ground a grain lands on: the moving air's height raster and where its window stands (`AirRaster`, `FluidWindow`). */
export interface GrainGround {
  ox: number;
  oz: number;
  cell: number;
  n: number;
  height: Float32Array;
  known: Uint8Array;
  /** The pull on a grain, m/s², and how long it lies once landed, seconds. */
  gravity: number;
  rest: number;
}

export class Dust {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private readonly color: Float32Array;
  /** 1 for a grain (the volumetrics' kick-up), 0 for today's rising mote. */
  private readonly grain: Uint8Array;
  /** Seconds a grain has lain on the ground, or -1 while it flies. */
  private readonly landed: Float32Array;
  private next = 0;
  private alive = 0;
  /** What a grain lands on; null while the volumetrics' dust is not running (no grain is ever spawned then). */
  ground: GrainGround | null = null;
  /** Grains in the air and lying, as the last update counted them, for the console. */
  grainsFlying = 0;
  grainsLying = 0;

  constructor(max = 900) {
    this.max = max;
    this.grain = new Uint8Array(max);
    this.landed = new Float32Array(max).fill(-1);
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(99);
    this.life = new Float32Array(max).fill(1);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max).fill(0.1);
    this.color = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: Dust.sprite() } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aSize;
        attribute vec3 aColor;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vAlpha = aAlpha;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * 400.0 / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      fog: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    geo.setDrawRange(0, 0);
  }

  private static sprite(): THREE.Texture {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Throw `count` motes from a point on the ground behind a mover going (vx, vz), in the ground's
   * colour; `width` spreads them across the vehicle's footprint and `speed` sets how far they fly.
   */
  spawn(x: number, y: number, z: number, count: number, vx: number, vz: number, width: number, color: THREE.Color, grain = false): void {
    if (grain && this.ground) {
      this.spawnGrains(x, y, z, count, vx, vz, width, color);
      return;
    }
    const speed = Math.hypot(vx, vz);
    const dx = speed > 1e-3 ? vx / speed : 0;
    const dz = speed > 1e-3 ? vz / speed : 0;
    for (let i = 0; i < count; i++) {
      const k = this.next;
      this.next = (this.next + 1) % this.max;
      this.grain[k] = 0;
      const side = (Math.random() - 0.5) * width;
      // Behind and beside the mover, trailing back at a share of its speed, drifting out and up.
      this.pos[k * 3] = x - dz * side + (Math.random() - 0.5) * 0.4;
      this.pos[k * 3 + 1] = y + 0.1 + Math.random() * 0.2;
      this.pos[k * 3 + 2] = z + dx * side + (Math.random() - 0.5) * 0.4;
      const back = -(0.15 + Math.random() * 0.25) * speed;
      const out = (Math.random() - 0.5) * (1.5 + speed * 0.08) * Math.sign(side || 1);
      this.vel[k * 3] = dx * back - dz * out;
      this.vel[k * 3 + 1] = 0.8 + Math.random() * 1.4 + speed * 0.05;
      this.vel[k * 3 + 2] = dz * back + dx * out;
      this.age[k] = 0;
      this.life[k] = 0.7 + Math.random() * 0.9;
      this.alpha[k] = 1;
      this.size[k] = (0.35 + Math.random() * 0.45) * (0.7 + Math.min(speed, 40) / 40);
      const shade = 0.85 + Math.random() * 0.3;
      this.color[k * 3] = color.r * shade;
      this.color[k * 3 + 1] = color.g * shade;
      this.color[k * 3 + 2] = color.b * shade;
    }
    this.alive = this.max;
  }

  /**
   * Grains thrown from a point behind a machine going (vx, vz), or out of a blast (`radial`): up and back at the
   * machine's speed, to fall under gravity onto the ground and lie there [demo `land.html:1731-1742`].
   */
  private spawnGrains(x: number, y: number, z: number, count: number, vx: number, vz: number, width: number, color: THREE.Color, radial = 0): void {
    const speed = Math.sqrt(vx * vx + vz * vz);
    const dx = speed > 1e-3 ? vx / speed : 0;
    const dz = speed > 1e-3 ? vz / speed : 0;
    for (let i = 0; i < count; i++) {
      const k = this.next;
      this.next = (this.next + 1) % this.max;
      this.grain[k] = 1;
      this.landed[k] = -1;
      if (radial > 0) {
        // Out of a blast: every way round, up at a steep angle [demo `land.html:1605-1609`].
        const a = Math.random() * Math.PI * 2;
        const el = 0.25 + Math.random() * 1.05;
        const sp = radial * (0.5 + Math.random());
        this.pos[k * 3] = x + Math.cos(a) * 0.8;
        this.pos[k * 3 + 1] = y + 0.4;
        this.pos[k * 3 + 2] = z + Math.sin(a) * 0.8;
        this.vel[k * 3] = Math.cos(a) * Math.cos(el) * sp;
        this.vel[k * 3 + 1] = Math.sin(el) * sp * 0.95 + 2;
        this.vel[k * 3 + 2] = Math.sin(a) * Math.cos(el) * sp;
        this.life[k] = 2.4 + Math.random() * 1.6;
      } else {
        const side = (Math.random() - 0.5) * width;
        const a = Math.random() * Math.PI * 2;
        const out = (2.6 + speed * 0.36) * 0.35 * (0.4 + Math.random());
        this.pos[k * 3] = x - dz * side + (Math.random() - 0.5) * 0.4;
        this.pos[k * 3 + 1] = y + 0.05;
        this.pos[k * 3 + 2] = z + dx * side + (Math.random() - 0.5) * 0.4;
        const back = -(0.15 + Math.random() * 0.25) * speed;
        this.vel[k * 3] = dx * back + Math.cos(a) * out;
        this.vel[k * 3 + 1] = (1.7 + speed * 0.24) * 0.6 * (0.5 + Math.random());
        this.vel[k * 3 + 2] = dz * back + Math.sin(a) * out;
        this.life[k] = 3.2;
      }
      this.age[k] = 0;
      this.alpha[k] = 0;
      this.size[k] = 0.16 + Math.random() * 0.26;
      const shade = 0.8 + Math.random() * 0.3;
      this.color[k * 3] = color.r * shade;
      this.color[k * 3 + 1] = color.g * shade;
      this.color[k * 3 + 2] = color.b * shade;
    }
    this.alive = this.max;
  }

  /** A blast's shower of grains (the volumetrics' kick-up): `count` of them out of (x, y, z) at about `speed` m/s. */
  throwGrains(x: number, y: number, z: number, count: number, speed: number, color: THREE.Color): void {
    if (!this.ground || !(count > 0)) return;
    this.spawnGrains(x, y, z, Math.min(count, this.max), 0, 0, 0, color, speed);
  }

  /** A grain's step: falling, landing on the raster, lying, fading. Answers whether it is still shown. */
  private stepGrain(k: number, dt: number, g: GrainGround): boolean {
    const p = k * 3;
    let lay = this.landed[k];
    if (lay < 0) {
      // Drag on the way, as the demo's debris has it, then gravity.
      const drag = Math.exp(-1.1 * dt);
      this.vel[p] *= drag;
      this.vel[p + 1] = (this.vel[p + 1] - g.gravity * dt) * drag;
      this.vel[p + 2] *= drag;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;
      const i = Math.floor((this.pos[p] - g.ox) / g.cell);
      const j = Math.floor((this.pos[p + 2] - g.oz) / g.cell);
      // Outside the window, or over ground not known yet, a grain falls to where it began and lies there.
      const inside = i >= 0 && j >= 0 && i < g.n && j < g.n && g.known[j * g.n + i] === 1;
      const ground = inside ? g.height[j * g.n + i] : -Infinity;
      if (this.pos[p + 1] <= ground + 0.04 || (!inside && this.vel[p + 1] < 0 && this.age[k] > 0.6)) {
        if (inside) this.pos[p + 1] = ground + 0.04;
        this.vel[p] = 0;
        this.vel[p + 1] = 0;
        this.vel[p + 2] = 0;
        lay = 0;
      }
    } else lay += dt;
    this.landed[k] = lay;
    const fadeIn = Math.min(1, this.age[k] * 12);
    const lying = lay >= 0 ? Math.max(0, 1 - lay / Math.max(g.rest, 1e-3)) : 1;
    this.alpha[k] = fadeIn * lying * 0.75;
    return lay < 0 ? true : lay < g.rest;
  }

  update(dt: number): void {
    if (!this.alive) return;
    let live = 0;
    let flying = 0;
    let lying = 0;
    const ground = this.ground;
    for (let k = 0; k < this.max; k++) {
      if (this.age[k] >= this.life[k]) {
        this.alpha[k] = 0;
        continue;
      }
      if (this.grain[k] === 1) {
        this.age[k] += dt;
        if (!ground || !this.stepGrain(k, dt, ground)) {
          this.age[k] = this.life[k];
          this.alpha[k] = 0;
          continue;
        }
        if (this.landed[k] < 0) flying++;
        else lying++;
        live++;
        continue;
      }
      this.age[k] += dt;
      const t = this.age[k] / this.life[k];
      // Motes slow as they spread, keep rising a little, and grow as they thin.
      const drag = Math.max(0, 1 - 2.5 * dt);
      this.vel[k * 3] *= drag;
      this.vel[k * 3 + 2] *= drag;
      this.vel[k * 3 + 1] = Math.max(0.2, this.vel[k * 3 + 1] - 1.2 * dt);
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      this.size[k] += 0.9 * dt;
      this.alpha[k] = (1 - t) * (1 - t) * 0.55;
      live++;
    }
    this.alive = live;
    this.grainsFlying = flying;
    this.grainsLying = lying;
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.max);
    for (const name of ['position', 'aAlpha', 'aSize', 'aColor']) (geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
