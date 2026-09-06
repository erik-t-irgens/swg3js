import * as THREE from 'three';
import type { PlanetDef } from '../data/planets';
import { CreatureManager } from './creatures';
import { PropFactory, type Collider, type Exclusion } from './props';
import { CHUNK_SIZE, Terrain } from './terrain';

const VIEW_RADIUS = 5;
const STREAM_BUDGET = 3;

interface Chunk {
  key: string;
  cx: number;
  cz: number;
  group: THREE.Group;
  colliders: Collider[];
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSun1;
  uniform vec3 uSun2;
  uniform float uSuns;
  varying vec3 vDir;
  vec3 sunDisc(vec3 d, vec3 s) {
    float c = dot(d, s);
    return uSunColor * (smoothstep(0.9975, 0.9992, c) * 1.6 + pow(max(c, 0.0), 32.0) * 0.28 + pow(max(c, 0.0), 4.0) * 0.06);
  }
  void main() {
    vec3 d = normalize(vDir);
    float t = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(t, 0.5));
    col += sunDisc(d, uSun1);
    if (uSuns > 1.5) col += sunDisc(d, uSun2);
    col = mix(col, uHorizon * 0.85, clamp(-d.y * 3.0, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class World {
  planet!: PlanetDef;
  terrain!: Terrain;
  creatures!: CreatureManager;
  private props!: PropFactory;
  private readonly chunks = new Map<string, Chunk>();
  private readonly chunkRoot = new THREE.Group();
  private readonly terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  private readonly sunAnchor = new THREE.Object3D();
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private water: THREE.Mesh | null = null;
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private lastCx = Number.NaN;
  private lastCz = Number.NaN;
  private landingZone: Exclusion | undefined;

  constructor(readonly scene: THREE.Scene) {
    scene.add(this.chunkRoot, this.sunAnchor, this.sun, this.sun.target, this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 500;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1200, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uTop: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uSunColor: { value: new THREE.Color() },
          uSun1: { value: new THREE.Vector3() },
          uSun2: { value: new THREE.Vector3() },
          uSuns: { value: 1 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);
  }

  load(planet: PlanetDef): void {
    this.unload();
    this.planet = planet;
    this.terrain = new Terrain(planet);
    this.props = new PropFactory(planet);
    this.creatures = new CreatureManager(planet, this.terrain);
    this.scene.add(this.creatures.group);

    const s = planet.sky;
    const el = s.sunElevation;
    this.sunDir.set(Math.cos(el) * Math.sin(s.sunAzimuth), Math.sin(el), Math.cos(el) * Math.cos(s.sunAzimuth)).normalize();
    const u = this.sky.material.uniforms;
    u.uTop.value.set(s.top);
    u.uHorizon.value.set(s.horizon);
    u.uSunColor.value.set(s.sunColor);
    u.uSun1.value.copy(this.sunDir);
    u.uSun2.value.copy(this.sunDir).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.12).setY(this.sunDir.y * 0.8).normalize();
    u.uSuns.value = s.suns;

    this.scene.fog = new THREE.FogExp2(planet.fog.color, planet.fog.density);
    this.sun.color.set(s.sunColor);
    this.sun.intensity = planet.light.sunIntensity;
    this.hemi.color.set(planet.light.ambientSky);
    this.hemi.groundColor.set(planet.light.ambientGround);
    this.hemi.intensity = planet.light.ambientIntensity;

    if (planet.water) {
      const geo = new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: planet.water.color,
        transparent: true,
        opacity: planet.water.opacity,
        roughness: 0.25,
        metalness: 0.15,
        depthWrite: false,
      });
      this.water = new THREE.Mesh(geo, mat);
      this.water.position.y = planet.water.level;
      this.water.receiveShadow = true;
      this.scene.add(this.water);
    }

    this.lastCx = Number.NaN;
    this.lastCz = Number.NaN;
  }

  private unload(): void {
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    if (this.creatures) {
      this.scene.remove(this.creatures.group);
      this.creatures.dispose();
    }
    this.props?.dispose();
    if (this.water) {
      this.scene.remove(this.water);
      this.water.geometry.dispose();
      (this.water.material as THREE.Material).dispose();
      this.water = null;
    }
  }

  private disposeChunk(c: Chunk): void {
    this.chunkRoot.remove(c.group);
    c.group.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
  }

  /** Find a comfortable spot near the origin: dry, gentle slope. */
  spawnPoint(): THREE.Vector3 {
    const n = new THREE.Vector3();
    let best = new THREE.Vector3(0, this.terrain.heightAt(0, 0), 0);
    let bestScore = -Infinity;
    for (let r = 0; r < 200; r += 8) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        const h = this.terrain.heightAt(x, z);
        if (h < this.terrain.waterLevel + 1.5) continue;
        const ny = this.terrain.normalAt(x, z, n).y;
        const score = ny * 10 - r * 0.02;
        if (score > bestScore) {
          bestScore = score;
          best = new THREE.Vector3(x, h, z);
        }
        if (ny > 0.97) return best;
      }
    }
    return best;
  }

  /** Generate every chunk in view immediately (used when arriving on a planet). */
  warmUp(center: THREE.Vector3): void {
    this.landingZone = { x: center.x, z: center.z, r: 14 };
    this.stream(center, Infinity);
    this.creatures.spawnAround(center);
  }

  collidersNear(x: number, z: number, radius: number): Collider[] {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const out: Collider[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(`${cx + dx},${cz + dz}`);
        if (!c) continue;
        for (const col of c.colliders) {
          if (Math.abs(col.x - x) < radius + col.r && Math.abs(col.z - z) < radius + col.r) out.push(col);
        }
      }
    }
    return out;
  }

  update(dt: number, playerPos: THREE.Vector3, camPos: THREE.Vector3): void {
    this.stream(playerPos, STREAM_BUDGET);
    this.sky.position.copy(camPos);
    if (this.water) {
      this.water.position.x = playerPos.x;
      this.water.position.z = playerPos.z;
    }
    this.sunAnchor.position.copy(playerPos);
    this.sun.target.position.copy(playerPos);
    this.sun.position.copy(playerPos).addScaledVector(this.sunDir, 220);
    this.creatures.update(dt, playerPos);
  }

  private stream(center: THREE.Vector3, budget: number): void {
    const pcx = Math.floor(center.x / CHUNK_SIZE);
    const pcz = Math.floor(center.z / CHUNK_SIZE);
    if (pcx === this.lastCx && pcz === this.lastCz && budget !== Infinity) return;

    const wanted: { cx: number; cz: number; d: number }[] = [];
    for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        const key = `${pcx + dx},${pcz + dz}`;
        if (!this.chunks.has(key)) wanted.push({ cx: pcx + dx, cz: pcz + dz, d: dx * dx + dz * dz });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    let made = 0;
    for (const w of wanted) {
      if (made >= budget) break;
      this.createChunk(w.cx, w.cz);
      made++;
    }
    if (wanted.length <= made) {
      this.lastCx = pcx;
      this.lastCz = pcz;
    }

    for (const [key, c] of this.chunks) {
      if (Math.abs(c.cx - pcx) > VIEW_RADIUS + 1 || Math.abs(c.cz - pcz) > VIEW_RADIUS + 1) {
        this.disposeChunk(c);
        this.chunks.delete(key);
      }
    }
  }

  private createChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(this.terrain.buildChunkGeometry(cx, cz), this.terrainMat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
    const { group: propGroup, colliders } = this.props.buildForChunk(cx, cz, this.terrain, this.landingZone);
    propGroup.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.computeBoundingSphere();
    });
    group.add(propGroup);
    this.chunkRoot.add(group);
    this.chunks.set(key, { key, cx, cz, group, colliders });
  }
}
