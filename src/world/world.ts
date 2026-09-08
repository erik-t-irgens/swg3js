import * as THREE from 'three';
import type { PlanetDef } from '../data/planets';
import type { Physics, RAPIER } from '../core/physics';
import { CreatureManager } from './creatures';
import { DayCycle } from './daycycle';
import { PropFactory, type Collider, type Exclusion, type ScatterItem } from './props';
import { AssetPack, type LoadedModel } from './assetPack';
import { OUTPOSTS } from '../data/outposts';
import { Group, groups, RAPIER as R } from '../core/physics';
import { CHUNK_RES, CHUNK_SIZE, Terrain } from './terrain';
import { SwgTerrain, type BuildingLayerSource } from './swgTerrain';
import { Speeder } from '../vehicles/speeder';

const VIEW_RADIUS = 6;
const STREAM_BUDGET = 3;
/** Coarse distant terrain: tile size, vertex resolution and radius in tiles. */
const FAR_TILE = 512;
const FAR_RES = 32;
const FAR_RADIUS = 6;
/** Fog is authored for a short view; scale it for the long one. */
const FOG_SCALE = 0.18;
/** Physics colliders only exist this many chunks out; nothing dynamic lives farther away. */
const PHYSICS_RADIUS = 3;

interface Chunk {
  key: string;
  cx: number;
  cz: number;
  group: THREE.Group;
  colliders: Collider[];
  heights: Float32Array;
  physics: RAPIER.Collider[] | null;
}

/** A placed portal building: its interior cell boxes decide when the player is inside it. */
interface Building {
  model: LoadedModel;
  x: number;
  z: number;
  radius: number;
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
  /** Instances of the exterior shell, collapsed while the player is inside. */
  exterior: { mesh: THREE.InstancedMesh; index: number }[];
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
  uniform vec3 uNightTop;
  uniform vec3 uNightHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSun1;
  uniform vec3 uSun2;
  uniform vec3 uMoon;
  uniform float uSuns;
  uniform float uDay;
  uniform float uSunset;
  varying vec3 vDir;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  vec3 sunDisc(vec3 d, vec3 s, float strength) {
    float c = dot(d, s);
    return uSunColor * strength * (smoothstep(0.9975, 0.9992, c) * 1.6 + pow(max(c, 0.0), 32.0) * 0.28 + pow(max(c, 0.0), 4.0) * 0.06);
  }
  void main() {
    vec3 d = normalize(vDir);
    float t = clamp(d.y, 0.0, 1.0);
    vec3 top = mix(uNightTop, uTop, uDay);
    vec3 horizon = mix(uNightHorizon, uHorizon, uDay);
    vec3 flatD = normalize(vec3(d.x, 0.0, d.z));
    vec3 flatS = normalize(vec3(uSun1.x, 0.0, uSun1.z));
    horizon += vec3(0.6, 0.22, 0.02) * uSunset * pow(max(dot(flatD, flatS), 0.0), 3.0);
    vec3 col = mix(horizon, top, pow(t, 0.5));
    float sunVis = smoothstep(-0.12, 0.0, uSun1.y);
    col += sunDisc(d, uSun1, sunVis);
    if (uSuns > 1.5) col += sunDisc(d, uSun2, sunVis);
    float moon = smoothstep(0.9988, 0.9996, dot(d, uMoon));
    col += vec3(0.85, 0.88, 0.95) * moon * (1.0 - uDay * 0.8);
    float star = smoothstep(0.988, 1.0, hash(floor(d * 140.0))) * (1.0 - uDay) * smoothstep(0.0, 0.15, d.y);
    col += vec3(star);
    col = mix(col, horizon * 0.85, clamp(-d.y * 3.0, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class World {
  planet!: PlanetDef;
  terrain!: Terrain;
  creatures!: CreatureManager;
  readonly day = new DayCycle(0, 1);
  readonly speeders: Speeder[] = [];
  private props!: PropFactory;
  private readonly chunks = new Map<string, Chunk>();
  private readonly farTiles = new Map<string, THREE.Mesh>();
  private readonly chunkRoot = new THREE.Group();
  private lastTx = Number.NaN;
  private lastTz = Number.NaN;
  private readonly terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private water: THREE.Mesh | null = null;
  private readonly dayFog = new THREE.Color();
  private readonly nightFog = new THREE.Color();
  private readonly sunColor = new THREE.Color();
  private readonly moonColor = new THREE.Color(0x8fa8d8);
  private lastCx = Number.NaN;
  private lastCz = Number.NaN;
  private exclusions: Exclusion[] = [];
  pack: AssetPack | null = null;
  packStatus = 'no pack';
  private readonly structures: THREE.Object3D[] = [];
  private structureColliders: RAPIER.Collider[] = [];
  private buildings: Building[] = [];
  /** The building the player is currently inside, if any. */
  insideBuilding: Building | null = null;
  private readonly hiddenGround: THREE.Object3D[] = [];
  private loadToken = 0;

  constructor(readonly scene: THREE.Scene, readonly physics: Physics) {
    scene.add(this.chunkRoot, this.sun, this.sun.target, this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140; sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(7000, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uTop: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uNightTop: { value: new THREE.Color(0x04060e) },
          uNightHorizon: { value: new THREE.Color(0x0e1424) },
          uSunColor: { value: new THREE.Color() },
          uSun1: { value: new THREE.Vector3() },
          uSun2: { value: new THREE.Vector3() },
          uMoon: { value: new THREE.Vector3() },
          uSuns: { value: 1 },
          uDay: { value: 1 },
          uSunset: { value: 0 },
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
    this.terrain?.detachSwg();
    this.terrain = new Terrain(planet);
    this.props = new PropFactory(planet);
    this.creatures = new CreatureManager(planet, this.terrain, this.physics);
    this.scene.add(this.creatures.group);
    this.physics.setGravity(planet.gravity);

    const s = planet.sky;
    this.day.configure(s.sunAzimuth, s.sunElevation);
    const u = this.sky.material.uniforms;
    u.uTop.value.set(s.top);
    u.uHorizon.value.set(s.horizon);
    u.uSunColor.value.set(s.sunColor);
    u.uSuns.value = s.suns;

    this.dayFog.set(planet.fog.color);
    this.nightFog.set(planet.fog.color).multiplyScalar(0.08).lerp(new THREE.Color(0x0a0f1c), 0.5);
    this.scene.fog = new THREE.FogExp2(planet.fog.color, planet.fog.density * FOG_SCALE);
    this.sunColor.set(s.sunColor);
    this.hemi.color.set(planet.light.ambientSky);
    this.hemi.groundColor.set(planet.light.ambientGround);

    if (planet.water) {
      const geo = new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2);
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
    this.lastTx = Number.NaN;
    this.lastTz = Number.NaN;
    this.exclusions = [];
    this.loadToken++;
    this.day.update(0, false);
    this.applyLighting();
  }

  /** Load converted SWG content for this planet, if the private pack exists. */
  async loadPack(spawn: THREE.Vector3): Promise<THREE.Vector3 | null> {
    const token = this.loadToken;
    const planet = this.planet;
    this.packStatus = 'loading';
    const pack = await AssetPack.load(planet.id);
    if (token !== this.loadToken) return null;
    if (!pack) {
      this.packStatus = 'no pack';
      return null;
    }
    this.pack = pack;

    const scatter: ScatterItem[] = [];
    const addScatter = async (category: string, density: number, minScale: number, maxScale: number) => {
      const models = await pack.models(pack.category(category).map((m) => m.id));
      for (const model of models) scatter.push({ model, density: density / Math.max(1, models.length), minScale, maxScale });
    };
    await addScatter('rocks', planet.props.rockDensity * 1.2, 0.8, 1.6);
    await addScatter('debris', 0.35, 0.9, 1.1);
    await addScatter('vaporators', 0.25, 1, 1);
    await addScatter('flora', 0.9, 0.8, 1.2);
    if (token !== this.loadToken) return null;

    const layout = pack.layout;
    const placements = layout ? [] : (OUTPOSTS[planet.id] ?? []);
    const structures: { model: LoadedModel; x: number; z: number; rot: number; flatten: number }[] = [];
    for (const p of placements) {
      try {
        const model = await pack.model(p.model);
        structures.push({ model, x: spawn.x + p.x, z: spawn.z + p.z, rot: p.rot, flatten: p.flatten ?? model.radius + 6 });
      } catch {
        console.warn(`outpost: ${p.model} not in pack, skipped`);
      }
    }
    if (token !== this.loadToken) return null;

    // Level the ground under each structure, keep procedural props off it, then rebuild.
    for (const st of structures) {
      this.terrain.flattenZones.push({ x: st.x, z: st.z, r: st.flatten, h: this.terrain.rawHeightAt(st.x, st.z) });
      this.exclusions.push({ x: st.x, z: st.z, r: st.model.radius + 4 });
    }

    // The planet's real terrain, with every building's ground modification applied where the snapshot puts it.
    if (layout?.terrain) {
      const trn = await pack.terrain();
      if (token !== this.loadToken) return null;
      if (trn) {
        const layers: BuildingLayerSource[] = [];
        for (const o of layout.objects) {
          if (!o.layer || o.contained) continue;
          const bytes = await pack.bytes(o.layer);
          if (!bytes) continue;
          layers.push({ bytes, x: o.x, z: o.z, yaw: yawOf(o.q) });
        }
        if (token !== this.loadToken) return null;
        try {
          const t0 = performance.now();
          const swg = await SwgTerrain.create(trn, layers, layout.center.x, layout.center.z, (file) => pack.bytes(file));
          if (token !== this.loadToken) return null;
          this.terrain.attachSwg(swg);
          console.info(`terrain: ${this.terrain.swg!.template.name} with ${layers.length} building layers loaded in ${(performance.now() - t0).toFixed(0)} ms`);
        } catch (err) {
          console.warn('terrain: failed to load the planet terrain, keeping procedural ground', err);
        }
      }
    }

    // Snapshot objects: the world is mirrored in X (left-handed source), centred on the layout centre.
    const placed: { model: LoadedModel; x: number; y: number; z: number; q: THREE.Quaternion; radius: number; contained: boolean }[] = [];
    if (layout) {
      const byModel = new Map<string, typeof layout.objects>();
      for (const o of layout.objects) (byModel.get(o.model) ?? byModel.set(o.model, []).get(o.model)!).push(o);
      for (const [id, list] of byModel) {
        let model: LoadedModel;
        try {
          model = await pack.model(id);
        } catch {
          console.warn(`layout: ${id} failed to load`);
          continue;
        }
        if (token !== this.loadToken) return null;
        for (const o of list) {
          const gx = -(o.x - layout.center.x);
          const gz = o.z - layout.center.z;
          placed.push({ model, x: gx, y: o.y, z: gz, q: new THREE.Quaternion(o.q[1], -o.q[2], -o.q[3], o.q[0]), radius: o.radius, contained: !!o.contained });
          if (o.radius >= 2 && !o.contained && !this.terrain.swg) this.terrain.addAnchor({ x: gx, z: gz, y: o.y, r: o.radius });
          if (o.radius >= 1 && !o.contained) this.exclusions.push({ x: gx, z: gz, r: o.radius + 2 });
        }
      }
    }
    this.props.dispose();
    this.props = new PropFactory(planet, scatter);
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    for (const [key, t] of this.farTiles) {
      this.chunkRoot.remove(t);
      t.geometry.dispose();
      const [tx, tz] = key.split(',').map(Number);
      this.terrain.releaseFarTile(tx, tz, FAR_TILE, FAR_RES);
    }
    this.farTiles.clear();
    this.lastCx = Number.NaN;
    this.lastCz = Number.NaN;
    this.lastTx = Number.NaN;
    this.lastTz = Number.NaN;
    this.stream(spawn, Infinity);
    this.streamFar(spawn, Infinity);

    for (const st of structures) this.placeStructure(st.model, st.x, st.z, st.rot);
    if (placed.length) this.placeLayout(placed, spawn);
    this.packStatus = `${scatter.length} scatter models, ${structures.length} structures, ${placed.length} snapshot objects${this.terrain.swg ? ', SWG terrain' : ''}`;
    if (!placed.length) return null;

    // Find open ground near the layout centre that no object's footprint covers.
    const blockers = placed.filter((p) => !p.contained && p.radius >= 1);
    const clear = (x: number, z: number) => blockers.every((p) => Math.hypot(p.x - x, p.z - z) > p.radius + 1.5);
    for (let r = 0; r < 120; r += 4) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = spawn.x + Math.sin(a) * r;
        const z = spawn.z + Math.cos(a) * r;
        if (clear(x, z)) return new THREE.Vector3(x, this.terrain.heightAt(x, z), z);
        if (r === 0) break;
      }
    }
    return null;
  }

  /** Instance every snapshot object and give the larger ones exact collision near the spawn. */
  private placeLayout(placed: { model: LoadedModel; x: number; y: number; z: number; q: THREE.Quaternion; radius: number; contained: boolean }[], spawn: THREE.Vector3): void {
    const byModel = new Map<LoadedModel, typeof placed>();
    for (const p of placed) (byModel.get(p.model) ?? byModel.set(p.model, []).get(p.model)!).push(p);
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    let colliders = 0;
    for (const [model, list] of byModel) {
      const isBuilding = model.interiorBoxes.length > 0;
      const built: Building[] = [];
      if (isBuilding) {
        for (const p of list) {
          if (p.contained) {
            built.push(null as unknown as Building);
            continue;
          }
          const matrix = new THREE.Matrix4().compose(pos.set(p.x, p.y, p.z), p.q, one);
          const b: Building = { model, x: p.x, z: p.z, radius: model.radius, matrix, inverse: matrix.clone().invert(), exterior: [] };
          built.push(b);
          this.buildings.push(b);
        }
      }
      for (const prim of model.primitives) {
        const mesh = new THREE.InstancedMesh(prim.geometry, prim.material, list.length);
        list.forEach((p, i) => {
          m.compose(pos.set(p.x, p.y, p.z), p.q, one);
          mesh.setMatrixAt(i, m);
          if (isBuilding && prim.cell === 0 && built[i]) built[i].exterior.push({ mesh, index: i });
        });
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        this.scene.add(mesh);
        this.structures.push(mesh);
      }
      for (const p of list) {
        if (p.contained || p.radius < 1.5 || Math.hypot(p.x - spawn.x, p.z - spawn.z) > 350) continue;
        for (const prim of model.primitives) {
          const posAttr = prim.geometry.getAttribute('position');
          const idx = prim.geometry.getIndex();
          if (!posAttr || !idx) continue;
          const desc = R.ColliderDesc.trimesh(new Float32Array(posAttr.array as ArrayLike<number>), new Uint32Array(idx.array as ArrayLike<number>))
            .setTranslation(p.x, p.y, p.z)
            .setRotation({ x: p.q.x, y: p.q.y, z: p.q.z, w: p.q.w })
            .setFriction(0.8);
          // Building shells and interiors get their own collision groups so someone inside ignores the shell.
          if (prim.cell === 0) desc.setCollisionGroups(groups(Group.exterior, Group.all));
          else if (prim.cell > 0) desc.setCollisionGroups(groups(Group.interior, Group.all));
          this.structureColliders.push(this.physics.world.createCollider(desc));
          colliders++;
        }
      }
    }
    console.info(`layout: ${placed.length} objects, ${byModel.size} models, ${colliders} colliders`);
  }

  private placeStructure(model: LoadedModel, x: number, z: number, rot: number): void {
    const y = this.terrain.heightAt(x, z);
    const obj = model.scene.clone();
    obj.position.set(x, y, z);
    obj.rotation.y = rot;
    obj.updateMatrixWorld(true);
    this.scene.add(obj);
    this.structures.push(obj);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0));
    for (const prim of model.primitives) {
      const pos = prim.geometry.getAttribute('position');
      const idx = prim.geometry.getIndex();
      if (!pos || !idx) continue;
      const vertices = new Float32Array(pos.array as ArrayLike<number>);
      const indices = new Uint32Array(idx.array as ArrayLike<number>);
      const desc = R.ColliderDesc.trimesh(vertices, indices).setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.8);
      this.structureColliders.push(this.physics.world.createCollider(desc));
    }
  }

  private unload(): void {
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    for (const t of this.farTiles.values()) {
      this.chunkRoot.remove(t);
      t.geometry.dispose();
    }
    this.farTiles.clear();
    this.lastTx = Number.NaN;
    this.lastTz = Number.NaN;
    for (const o of this.structures) this.scene.remove(o);
    this.structures.length = 0;
    this.buildings = [];
    this.insideBuilding = null;
    this.hiddenGround.length = 0;
    for (const c of this.structureColliders) this.physics.removeCollider(c);
    this.structureColliders = [];
    this.pack?.dispose();
    this.pack = null;
    this.packStatus = 'no pack';
    if (this.creatures) {
      this.scene.remove(this.creatures.group);
      this.creatures.dispose();
    }
    for (const sp of this.speeders) sp.dispose(this.physics, this.scene);
    this.speeders.length = 0;
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
    this.removeChunkPhysics(c);
  }

  private removeChunkPhysics(c: Chunk): void {
    if (!c.physics) return;
    for (const col of c.physics) this.physics.removeCollider(col);
    c.physics = null;
  }

  private addChunkPhysics(c: Chunk): void {
    if (c.physics) return;
    const cols: RAPIER.Collider[] = [];
    cols.push(this.physics.createHeightfield(c.cx * CHUNK_SIZE, c.cz * CHUNK_SIZE, CHUNK_SIZE, CHUNK_RES, c.heights));
    for (const p of c.colliders) {
      const ground = this.terrain.heightAt(p.x, p.z) - 0.5;
      const halfH = (p.top - ground) / 2;
      cols.push(this.physics.createStaticCylinder(p.x, ground + halfH, p.z, p.r, halfH));
    }
    c.physics = cols;
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
    this.exclusions = [{ x: center.x, z: center.z, r: 14 }];
    this.stream(center, Infinity);
    this.streamFar(center, Infinity);
    this.creatures.spawnAround(center);
    const sx = center.x + 5;
    const sz = center.z + 4;
    this.speeders.push(new Speeder(this.physics, this.scene, sx, this.terrain.heightAt(sx, sz) + 1.2, sz, Math.PI * 0.75));
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  get inside(): boolean {
    return this.insideBuilding !== null;
  }

  /**
   * SWG only draws and collides the cell you stand in: from inside a building its shell and
   * the ground under it are gone, which is what makes basements and doorways work. Find the
   * building whose interior cell boxes contain the player and hide its shell and nearby ground.
   */
  private updateInterior(playerPos: THREE.Vector3): void {
    const local = new THREE.Vector3();
    let found: Building | null = null;
    const probe = local.copy(playerPos).setY(playerPos.y + 0.9);
    for (const b of this.buildings) {
      if (Math.abs(b.x - playerPos.x) > b.radius + 4 || Math.abs(b.z - playerPos.z) > b.radius + 4) continue;
      local.copy(probe).applyMatrix4(b.inverse);
      for (const box of b.model.interiorBoxes) {
        if (local.x >= box.min.x - 0.3 && local.x <= box.max.x + 0.3 && local.z >= box.min.z - 0.3 && local.z <= box.max.z + 0.3 && local.y >= box.min.y - 1.5 && local.y <= box.max.y + 0.5) {
          found = b;
          break;
        }
      }
      if (found) break;
    }
    if (found === this.insideBuilding) return;
    // Restore the previous building and its ground.
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const prev = this.insideBuilding;
    if (prev) {
      for (const e of prev.exterior) {
        e.mesh.setMatrixAt(e.index, prev.matrix);
        e.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (const o of this.hiddenGround) o.visible = true;
    this.hiddenGround.length = 0;
    this.insideBuilding = found;
    if (!found) return;
    for (const e of found.exterior) {
      e.mesh.setMatrixAt(e.index, zero);
      e.mesh.instanceMatrix.needsUpdate = true;
    }
    this.hideGroundUnder(found);
  }

  private hideGroundUnder(b: Building): void {
    const r = b.radius + 2;
    const overlaps = (ox: number, oz: number, size: number) => b.x + r > ox && b.x - r < ox + size && b.z + r > oz && b.z - r < oz + size;
    for (const c of this.chunks.values()) {
      if (overlaps(c.cx * CHUNK_SIZE, c.cz * CHUNK_SIZE, CHUNK_SIZE)) {
        c.group.visible = false;
        this.hiddenGround.push(c.group);
      }
    }
    for (const [key, t] of this.farTiles) {
      const [tx, tz] = key.split(',').map(Number);
      if (overlaps(tx * FAR_TILE, tz * FAR_TILE, FAR_TILE)) {
        t.visible = false;
        this.hiddenGround.push(t);
      }
    }
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

  update(dt: number, playerPos: THREE.Vector3, camPos: THREE.Vector3, fastTime: boolean, onAttack: (damage: number) => void): void {
    this.stream(playerPos, STREAM_BUDGET);
    this.streamFar(playerPos, 1);
    this.updateInterior(playerPos);
    this.day.update(dt, fastTime);
    this.applyLighting();
    this.sky.position.copy(camPos);
    if (this.water) {
      this.water.position.x = playerPos.x;
      this.water.position.z = playerPos.z;
    }
    this.sun.target.position.copy(playerPos);
    const lightDir = this.day.sunDir.y > 0.02 ? this.day.sunDir : this.day.moonDir;
    this.sun.position.copy(playerPos).addScaledVector(lightDir, 220);
    this.creatures.update(dt, playerPos, onAttack);
  }

  private applyLighting(): void {
    const d = this.day.daylight;
    const u = this.sky.material.uniforms;
    u.uSun1.value.copy(this.day.sunDir);
    u.uSun2.value.copy(this.day.sunDir).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.12).setY(this.day.sunDir.y * 0.8).normalize();
    u.uMoon.value.copy(this.day.moonDir);
    u.uDay.value = d;
    u.uSunset.value = this.day.sunset;

    const night = this.day.sunDir.y <= 0.02;
    this.sun.color.copy(night ? this.moonColor : this.sunColor);
    if (!night) this.sun.color.lerp(new THREE.Color(0xff9a4a), Math.min(1, this.day.sunset * 0.8));
    this.sun.intensity = night ? 0.4 : this.planet.light.sunIntensity * (0.1 + 0.9 * d);
    this.hemi.intensity = this.planet.light.ambientIntensity * (0.2 + 0.8 * d);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(this.nightFog).lerp(this.dayFog, d);
    fog.color.lerp(new THREE.Color(0xd08a5a), this.day.sunset * 0.35 * d);
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
    const sync = budget === Infinity;
    for (const w of wanted) {
      if (made >= budget) break;
      // With SWG terrain the pole grids come from a worker; skip until they arrive.
      if (!this.terrain.prepareChunk(w.cx, w.cz, sync)) continue;
      this.createChunk(w.cx, w.cz);
      made++;
    }
    if (wanted.length <= made) {
      this.lastCx = pcx;
      this.lastCz = pcz;
    }
    this.terrain.evict(center, VIEW_RADIUS + 2);

    for (const [key, c] of this.chunks) {
      const far = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      if (far > VIEW_RADIUS + 1) {
        this.disposeChunk(c);
        this.chunks.delete(key);
      } else if (far <= PHYSICS_RADIUS) {
        this.addChunkPhysics(c);
      } else {
        this.removeChunkPhysics(c);
      }
    }
  }

  private streamFar(center: THREE.Vector3, budget: number): void {
    const ptx = Math.floor(center.x / FAR_TILE);
    const ptz = Math.floor(center.z / FAR_TILE);
    if (ptx === this.lastTx && ptz === this.lastTz && budget !== Infinity) return;
    const wanted: { tx: number; tz: number; d: number }[] = [];
    for (let dz = -FAR_RADIUS; dz <= FAR_RADIUS; dz++) {
      for (let dx = -FAR_RADIUS; dx <= FAR_RADIUS; dx++) {
        if (!this.farTiles.has(`${ptx + dx},${ptz + dz}`)) wanted.push({ tx: ptx + dx, tz: ptz + dz, d: dx * dx + dz * dz });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    let made = 0;
    for (const w of wanted) {
      if (made >= budget) break;
      const geometry = this.terrain.buildFarTile(w.tx, w.tz, FAR_TILE, FAR_RES, budget === Infinity);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, this.terrainMat);
      mesh.receiveShadow = true;
      this.chunkRoot.add(mesh);
      this.farTiles.set(`${w.tx},${w.tz}`, mesh);
      made++;
    }
    if (wanted.length <= made) {
      this.lastTx = ptx;
      this.lastTz = ptz;
    }
    for (const [key, t] of this.farTiles) {
      const [tx, tz] = key.split(',').map(Number);
      if (Math.max(Math.abs(tx - ptx), Math.abs(tz - ptz)) > FAR_RADIUS + 1) {
        this.chunkRoot.remove(t);
        t.geometry.dispose();
        this.farTiles.delete(key);
        this.terrain.releaseFarTile(tx, tz, FAR_TILE, FAR_RES);
      }
    }
  }

  private createChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const group = new THREE.Group();
    const { geometry, heights } = this.terrain.buildChunk(cx, cz);
    const mesh = new THREE.Mesh(geometry, this.terrainMat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
    const { group: propGroup, colliders } = this.props.buildForChunk(cx, cz, this.terrain, this.exclusions);
    propGroup.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.computeBoundingSphere();
    });
    group.add(propGroup);
    this.chunkRoot.add(group);
    this.chunks.set(key, { key, cx, cz, group, colliders, heights, physics: null });
    const b = this.insideBuilding;
    if (b) {
      const r = b.radius + 2;
      if (b.x + r > cx * CHUNK_SIZE && b.x - r < (cx + 1) * CHUNK_SIZE && b.z + r > cz * CHUNK_SIZE && b.z - r < (cz + 1) * CHUNK_SIZE) {
        group.visible = false;
        this.hiddenGround.push(group);
      }
    }
  }
}

/** Yaw of a w,x,y,z quaternion: the heading of its forward vector, as the client uses for terrain layers. */
function yawOf(q: number[]): number {
  const [w, x, y, z] = q;
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}
