// Dust kicked up by a vehicle: a cloud of point sprites thrown from behind it, coloured by the
// ground it runs over (the terrain's texture family or palette), rising and thinning as it goes.
// One mesh for every cloud, its buffers rewritten each frame, like the water's splashes.
import * as THREE from 'three';

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
  private next = 0;
  private alive = 0;

  constructor(max = 900) {
    this.max = max;
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
  spawn(x: number, y: number, z: number, count: number, vx: number, vz: number, width: number, color: THREE.Color): void {
    const speed = Math.hypot(vx, vz);
    const dx = speed > 1e-3 ? vx / speed : 0;
    const dz = speed > 1e-3 ? vz / speed : 0;
    for (let i = 0; i < count; i++) {
      const k = this.next;
      this.next = (this.next + 1) % this.max;
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

  update(dt: number): void {
    if (!this.alive) return;
    let live = 0;
    for (let k = 0; k < this.max; k++) {
      if (this.age[k] >= this.life[k]) {
        this.alpha[k] = 0;
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
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.max);
    for (const name of ['position', 'aAlpha', 'aSize', 'aColor']) (geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
