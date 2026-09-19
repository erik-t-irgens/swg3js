// An engine's trail: a ribbon of where the exhaust has been over the last moment, fading along
// its length, faced to the camera as it is drawn (a fixed-normal ribbon vanishes edge-on). The
// faster the ship goes the longer the ribbon reaches, since it keeps a fixed span of time.
import * as THREE from 'three';
import { markActor } from '../world/portalRender';

const SAMPLES = 40;
/** Seconds of exhaust kept. */
const SPAN = 0.9;
/** Metres moved before a new sample is taken (a hovering ship leaves nothing). */
const MIN_STEP = 0.35;

const tmpDir = new THREE.Vector3();
const tmpToCam = new THREE.Vector3();
const tmpSide = new THREE.Vector3();
const tmpWorld = new THREE.Vector3();

export class EngineTrail {
  readonly mesh: THREE.Mesh;
  private readonly points: { p: THREE.Vector3; t: number }[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly color = new THREE.Color();
  private width = 0.5;
  private time = 0;

  constructor(color: number, private readonly source: THREE.Object3D) {
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(SAMPLES * 2 * 3);
    this.colors = new Float32Array(SAMPLES * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < SAMPLES - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(index);
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.color.set(color);
    markActor(this.mesh);
    // Its vertices are laid out in the world's own frame, not under the vehicle, and its layers are
    // set here: the world's vehicle preparation compiles it without marking it again.
    this.mesh.userData.worldPass = true;
    // The ribbon is laid out toward whichever camera draws it.
    this.mesh.onBeforeRender = (_r, _s, camera) => this.lay(camera);
  }

  /** Once a frame: a new sample where the exhaust is now, the old ones ageing out. `strength` 0 hides the trail. */
  update(dt: number, strength: number, width: number): void {
    this.time += dt;
    this.width = width;
    const cutoff = this.time - SPAN;
    while (this.points.length && this.points[0].t < cutoff) this.points.shift();
    if (strength > 0) {
      this.source.getWorldPosition(tmpWorld);
      const last = this.points[this.points.length - 1];
      if (!last || last.p.distanceToSquared(tmpWorld) > MIN_STEP * MIN_STEP) {
        this.points.push({ p: tmpWorld.clone(), t: this.time });
        if (this.points.length > SAMPLES) this.points.shift();
      }
    }
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, strength);
    this.mesh.visible = this.points.length > 1 && strength > 0;
  }

  private lay(camera: THREE.Camera): void {
    const n = this.points.length;
    const geo = this.mesh.geometry;
    if (n < 2) {
      geo.setDrawRange(0, 0);
      return;
    }
    const pos = this.positions;
    const col = this.colors;
    for (let i = 0; i < n; i++) {
      const { p, t } = this.points[i];
      const next = this.points[Math.min(n - 1, i + 1)].p;
      const prev = this.points[Math.max(0, i - 1)].p;
      tmpDir.subVectors(next, prev);
      if (tmpDir.lengthSq() < 1e-8) tmpDir.set(0, 0, 1);
      tmpDir.normalize();
      tmpToCam.subVectors(camera.position, p);
      tmpSide.crossVectors(tmpDir, tmpToCam).normalize();
      // Newest samples are the freshest and widest; the tail thins and dims away.
      const age = THREE.MathUtils.clamp((this.time - t) / SPAN, 0, 1);
      const fade = (1 - age) * (1 - age);
      const w = this.width * (0.35 + 0.65 * (1 - age));
      const a = i * 6;
      pos[a] = p.x + tmpSide.x * w;
      pos[a + 1] = p.y + tmpSide.y * w;
      pos[a + 2] = p.z + tmpSide.z * w;
      pos[a + 3] = p.x - tmpSide.x * w;
      pos[a + 4] = p.y - tmpSide.y * w;
      pos[a + 5] = p.z - tmpSide.z * w;
      col[a] = col[a + 3] = this.color.r * fade;
      col[a + 1] = col[a + 4] = this.color.g * fade;
      col[a + 2] = col[a + 5] = this.color.b * fade;
    }
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
  }

  dispose(scene: THREE.Object3D): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
