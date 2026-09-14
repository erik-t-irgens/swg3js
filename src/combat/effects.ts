import * as THREE from 'three';
import { markActor } from '../world/portalRender';

interface Ring { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; age: number; life: number; maxScale: number }
interface Tracer { line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>; age: number; life: number }
interface Flash { light: THREE.PointLight; age: number; life: number; intensity: number }

/** Point lights kept in the scene for the flashes, so the light count never changes (a change recompiles every material). */
const FLASH_POOL = 4;
interface Burst { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; age: number; life: number; size: number }

/** Short-lived visual effects: shock rings, blaster tracers, light flashes, impact bursts. */
export class Effects {
  private readonly rings: Ring[] = [];
  private readonly tracers: Tracer[] = [];
  private readonly flashes: Flash[] = [];
  private readonly bursts: Burst[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.6, 1, 32).rotateX(-Math.PI / 2);
  private readonly burstGeo = new THREE.SphereGeometry(1, 8, 6);

  private readonly lights: THREE.PointLight[] = [];
  private nextLight = 0;

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
    const mesh = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.position.copy(pos).y += 0.08;
    this.scene.add(mesh);
    markActor(mesh);
    this.rings.push({ mesh, age: 0, life, maxScale });
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, color: number, life = 0.07): void {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, toneMapped: false }));
    line.frustumCulled = false;
    this.scene.add(line);
    markActor(line);
    this.tracers.push({ line, age: 0, life });
  }

  flash(pos: THREE.Vector3, color: number, intensity: number, distance: number, life: number): void {
    // The next pooled light, taking over from the oldest flash when all are lit.
    const light = this.lights[this.nextLight];
    this.nextLight = (this.nextLight + 1) % this.lights.length;
    const i = this.flashes.findIndex((f) => f.light === light);
    if (i >= 0) this.flashes.splice(i, 1);
    light.color.set(color);
    light.intensity = intensity;
    light.distance = distance;
    light.position.copy(pos);
    this.flashes.push({ light, age: 0, life, intensity });
  }

  burst(pos: THREE.Vector3, color: number, size: number, life: number): void {
    const mesh = new THREE.Mesh(
      this.burstGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    markActor(mesh);
    this.bursts.push({ mesh, age: 0, life, size });
  }

  /**
   * One of each effect far below the world for a moment: their shaders compile with the first
   * draw, which the loading screen hides, rather than with the first shot or the first hit.
   */
  warmUp(): void {
    const at = new THREE.Vector3(0, -900, 0);
    this.ring(at, 0xffa050, 1, 0.05);
    this.tracer(at, at.clone().setY(-899), 0xff6a3a, 0.05);
    this.burst(at, 0xffc080, 1, 0.05);
  }

  update(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
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
        tr.line.geometry.dispose();
        tr.line.material.dispose();
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
        b.mesh.material.dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      b.mesh.scale.setScalar(b.size * (0.2 + 0.8 * Math.sqrt(t)));
      b.mesh.material.opacity = 0.9 * (1 - t);
    }
  }
}
