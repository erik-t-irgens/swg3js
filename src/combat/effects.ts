import * as THREE from 'three';
import { markActor } from '../world/portalRender';

type RingMesh = THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
type BurstMesh = THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
type TracerLine = THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
interface Ring { mesh: RingMesh; age: number; life: number; maxScale: number }
interface Tracer { line: TracerLine; age: number; life: number }
interface Flash { light: THREE.PointLight; age: number; life: number; intensity: number }

/** Point lights kept in the scene for the flashes, so the light count never changes (a change recompiles every material). */
const FLASH_POOL = 4;
interface Burst { mesh: BurstMesh; age: number; life: number; size: number }

/**
 * Short-lived visual effects: shock rings, blaster tracers, light flashes, impact bursts.
 *
 * The meshes and their materials are pooled and never disposed. A material made for each
 * spark and disposed after it would take its compiled shader program with it (three deletes a
 * program when the last material using it goes), and the next spark would compile it again:
 * a stall on every first shot after a quiet moment.
 */
export class Effects {
  private readonly rings: Ring[] = [];
  private readonly tracers: Tracer[] = [];
  private readonly flashes: Flash[] = [];
  private readonly bursts: Burst[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.6, 1, 32).rotateX(-Math.PI / 2);
  private readonly burstGeo = new THREE.SphereGeometry(1, 8, 6);
  private readonly ringPool: RingMesh[] = [];
  private readonly burstPool: BurstMesh[] = [];
  private readonly tracerPool: TracerLine[] = [];

  private readonly lights: THREE.PointLight[] = [];

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < FLASH_POOL; i++) {
      // Always in the scene and always visible: three.js counts the visible lights when it
      // compiles a material, so a light that comes and goes recompiles everything each time.
      const light = new THREE.PointLight(0xffffff, 0, 1);
      scene.add(light);
      markActor(light);
      this.lights.push(light);
    }
  }

  ring(pos: THREE.Vector3, color: number, maxScale: number, life: number): void {
    let mesh = this.ringPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      markActor(mesh);
    }
    mesh.material.color.set(color);
    mesh.material.opacity = 0.8;
    mesh.scale.set(0.3, 1, 0.3);
    mesh.position.copy(pos).y += 0.08;
    this.scene.add(mesh);
    this.rings.push({ mesh, age: 0, life, maxScale });
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, color: number, life = 0.07): void {
    let line = this.tracerPool.pop();
    if (!line) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, toneMapped: false }));
      line.frustumCulled = false;
      markActor(line);
    }
    const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.needsUpdate = true;
    line.material.color.set(color);
    line.material.opacity = 1;
    this.scene.add(line);
    this.tracers.push({ line, age: 0, life });
  }

  flash(pos: THREE.Vector3, color: number, intensity: number, distance: number, life: number): void {
    // A pooled light that is dark, else the one whose flash is oldest.
    let light = this.lights.find((l) => !this.flashes.some((f) => f.light === l));
    if (!light) {
      let oldest = 0;
      for (let i = 1; i < this.flashes.length; i++) if (this.flashes[i].age / this.flashes[i].life > this.flashes[oldest].age / this.flashes[oldest].life) oldest = i;
      light = this.flashes[oldest].light;
      this.flashes.splice(oldest, 1);
    }
    light.color.set(color);
    light.intensity = intensity;
    light.distance = distance;
    light.position.copy(pos);
    this.flashes.push({ light, age: 0, life, intensity });
  }

  burst(pos: THREE.Vector3, color: number, size: number, life: number): void {
    let mesh = this.burstPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(this.burstGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      markActor(mesh);
    }
    mesh.material.color.set(color);
    mesh.material.opacity = 0.9;
    mesh.scale.setScalar(size * 0.2);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.bursts.push({ mesh, age: 0, life, size });
  }

  /**
   * One of each effect far below the world for a moment: their shaders compile with the first
   * draw, which the loading screen hides, rather than with the first shot or the first hit.
   */
  warmUp(): void {
    const at = new THREE.Vector3(0, -900, 0);
    this.ring(at, 0xffa050, 1, 0.5);
    this.tracer(at, at.clone().setY(-899), 0xff6a3a, 0.5);
    this.burst(at, 0xffc080, 1, 0.5);
  }

  update(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        this.scene.remove(r.mesh);
        this.ringPool.push(r.mesh);
        this.rings.splice(i, 1);
        continue;
      }
      const s = 0.3 + r.maxScale * Math.sqrt(t);
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = 0.8 * (1 - t);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.age += dt;
      const t = tr.age / tr.life;
      if (t >= 1) {
        this.scene.remove(tr.line);
        this.tracerPool.push(tr.line);
        this.tracers.splice(i, 1);
        continue;
      }
      tr.line.material.opacity = 1 - t;
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        f.light.intensity = 0;
        this.flashes.splice(i, 1);
        continue;
      }
      f.light.intensity = f.intensity * (1 - t);
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const t = b.age / b.life;
      if (t >= 1) {
        this.scene.remove(b.mesh);
        this.burstPool.push(b.mesh);
        this.bursts.splice(i, 1);
        continue;
      }
      b.mesh.scale.setScalar(b.size * (0.2 + 0.8 * Math.sqrt(t)));
      b.mesh.material.opacity = 0.9 * (1 - t);
    }
  }
}
