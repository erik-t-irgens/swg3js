// Static flora of a converted planet, planted where the original game plants it. Collidable
// flora (trees, big rocks) goes one per 16 m tile at a position, heading and scale drawn from
// a random generator seeded by the tile, its family read from the terrain's baked flora map
// (or, for older terrain files, from the generated chunk); non-collidable flora (plants,
// small rocks) is read from the generated chunk on its own tiling. Every client and server
// runs the same code with the same seeds, which is why the trees matched across servers.

import * as THREE from 'three';
import { RandomGenerator } from '../swg/terrain/fractal';
import { FastRandomGenerator, hashFloat, hashTuple, type FloraChild } from '../swg/terrain/flora';
import type { LoadedModel } from './assetPack';
import type { Collider, Exclusion } from './props';
import type { SwgTerrain } from './swgTerrain';
import { CHUNK_SIZE } from './terrain';

/** Collidable flora tiles are 16 m in the engine regardless of the template's tile size. */
const COLLIDABLE_TILE = 16;

interface Placement {
  child: FloraChild;
  model: LoadedModel;
  /** Game coordinates. */
  x: number;
  z: number;
  yaw: number;
  scale: number;
  collidable: boolean;
}

const tmpM = new THREE.Matrix4();
const tmpP = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class FloraPlanter {
  private readonly swg: SwgTerrain;
  private readonly models: Map<string, LoadedModel>;
  /** Appearances the pack has no model for, counted once each for diagnostics. */
  readonly missing = new Set<string>();
  planted = 0;

  constructor(swg: SwgTerrain, models: Map<string, LoadedModel>) {
    this.swg = swg;
    this.models = models;
  }

  get modelCount(): number {
    return this.models.size;
  }

  /** ProceduralTerrainAppearance's flora tile index: floor, with exact negative multiples pushed down. */
  private static tileIndex(v: number, width: number): number {
    const q = v / width;
    const i = v >= 0 ? Math.floor(q) : Math.ceil(q);
    return v < 0 ? i - 1 : i;
  }

  private modelFor(child: FloraChild): LoadedModel | null {
    const key = child.appearance.replace(/\\/g, '/').toLowerCase();
    const m = this.models.get(key);
    if (!m) this.missing.add(key);
    return m ?? null;
  }

  /** Collidable flora of the game chunk: one candidate per 16 m tile (ProceduralTerrainAppearance::createFlora). */
  private collidable(cx: number, cz: number, out: Placement[]): void {
    const t = this.swg.template;
    const flora = t.flora;
    const border = flora.collidable.tileBorder;
    const mapWidthInTiles = Math.floor(t.mapWidthInMeters / COLLIDABLE_TILE);
    const centre = Math.floor(mapWidthInTiles / 2);
    const gx0 = cx * CHUNK_SIZE;
    const gz0 = cz * CHUNK_SIZE;
    // SWG x runs the other way: the chunk spans (toSwgX(gx0 + size), toSwgX(gx0)].
    const xa = this.swg.toSwgX(gx0 + CHUNK_SIZE);
    const xb = this.swg.toSwgX(gx0);
    const za = this.swg.toSwgZ(gz0);
    const zb = this.swg.toSwgZ(gz0 + CHUNK_SIZE);
    const baked = !flora.legacyMap && flora.collidableMap ? flora.collidableMap : null;
    const group = t.generator.floraGroup;
    for (let tz = FloraPlanter.tileIndex(za, COLLIDABLE_TILE); tz <= FloraPlanter.tileIndex(zb, COLLIDABLE_TILE); tz++) {
      for (let tx = FloraPlanter.tileIndex(xa, COLLIDABLE_TILE); tx <= FloraPlanter.tileIndex(xb, COLLIDABLE_TILE); tx++) {
        const keyX = tx + centre;
        const keyZ = tz + centre;
        if (keyX < 0 || keyZ < 0 || keyX >= mapWidthInTiles || keyZ >= mapWidthInTiles) continue;
        const key = (keyZ * mapWidthInTiles + keyX) >>> 0;
        const random = new RandomGenerator(key);
        const xOffset = random.randomReal();
        const zOffset = random.randomReal();
        const x = tx * COLLIDABLE_TILE + border + xOffset * (COLLIDABLE_TILE - 2 * border);
        const z = tz * COLLIDABLE_TILE + border + zOffset * (COLLIDABLE_TILE - 2 * border);
        // Only the chunk that holds the point plants it.
        const gx = this.swg.toGameX(x);
        const gz = this.swg.toGameZ(z);
        if (gx < gx0 || gx >= gx0 + CHUNK_SIZE || gz < gz0 || gz >= gz0 + CHUNK_SIZE) continue;
        if (this.swg.sampler.excludedAt(x, z)) continue;
        let family: number;
        let choice: number;
        if (baked) {
          family = baked.getValue(keyX, keyZ);
          choice = hashFloat(hashTuple(Math.floor(x), Math.floor(z)));
        } else {
          const f = this.swg.sampler.floraAt(x, z, true);
          family = f.family;
          choice = f.choice;
        }
        if (!family) continue;
        const child = group.createFlora(family, choice);
        if (!child) continue;
        const yaw = random.randomReal() * Math.PI * 2;
        const scale = child.shouldScale ? child.minScale + random.randomReal() * (child.maxScale - child.minScale) : 1;
        const model = this.modelFor(child);
        if (!model) continue;
        out.push({ child, model, x: gx, z: gz, yaw, scale, collidable: true });
      }
    }
  }

  /** Non-collidable flora on its own tiling, read from the generated chunk (the client's static radial flora). */
  private nonCollidable(cx: number, cz: number, out: Placement[]): void {
    const t = this.swg.template;
    const tiling = t.flora.nonCollidable;
    const tile = tiling.tileSize;
    if (!(tile >= 0.5)) return;
    const border = tile - 2 * tiling.tileBorder > 0 ? tiling.tileBorder : 0;
    const gx0 = cx * CHUNK_SIZE;
    const gz0 = cz * CHUNK_SIZE;
    const xa = this.swg.toSwgX(gx0 + CHUNK_SIZE);
    const xb = this.swg.toSwgX(gx0);
    const za = this.swg.toSwgZ(gz0);
    const zb = this.swg.toSwgZ(gz0 + CHUNK_SIZE);
    const group = t.generator.floraGroup;
    for (let tz = Math.floor(za / tile); tz <= Math.floor(zb / tile); tz++) {
      for (let tx = Math.floor(xa / tile); tx <= Math.floor(xb / tile); tx++) {
        const rng = new FastRandomGenerator(hashTuple(tx * tile, tz * tile));
        const x = tx * tile + border + rng.randomFloat() * (tile - 2 * border);
        const z = tz * tile + border + rng.randomFloat() * (tile - 2 * border);
        const gx = this.swg.toGameX(x);
        const gz = this.swg.toGameZ(z);
        if (gx < gx0 || gx >= gx0 + CHUNK_SIZE || gz < gz0 || gz >= gz0 + CHUNK_SIZE) continue;
        if (this.swg.sampler.excludedAt(x, z)) continue;
        const f = this.swg.sampler.floraAt(x, z, false);
        if (!f.family) continue;
        const child = group.createFlora(f.family, f.choice);
        if (!child) continue;
        const scale = child.shouldScale ? child.minScale + rng.randomFloat() * (child.maxScale - child.minScale) : 1;
        const model = this.modelFor(child);
        if (!model) continue;
        out.push({ child, model, x: gx, z: gz, yaw: x + z, scale, collidable: false });
      }
    }
  }

  /** Flora meshes and colliders for one game chunk. */
  buildForChunk(cx: number, cz: number, heightAt: (x: number, z: number) => number, exclusions: Exclusion[]): { group: THREE.Group; colliders: Collider[] } {
    const placements: Placement[] = [];
    this.collidable(cx, cz, placements);
    this.nonCollidable(cx, cz, placements);
    const group = new THREE.Group();
    const colliders: Collider[] = [];
    const kept = placements.filter((p) => exclusions.every((e) => Math.hypot(e.x - p.x, e.z - p.z) > e.r));
    const byModel = new Map<LoadedModel, Placement[]>();
    for (const p of kept) (byModel.get(p.model) ?? byModel.set(p.model, []).get(p.model)!).push(p);
    for (const [model, list] of byModel) {
      for (const prim of model.primitives) {
        const mesh = new THREE.InstancedMesh(prim.geometry, prim.material, list.length);
        list.forEach((p, i) => {
          const y = heightAt(p.x, p.z);
          // Mirrored world: a yaw about Y turns the other way.
          tmpQ.setFromAxisAngle(UP, -p.yaw);
          tmpM.compose(tmpP.set(p.x, y, p.z), tmpQ, tmpS.setScalar(p.scale));
          mesh.setMatrixAt(i, tmpM);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
      for (const p of list) {
        if (!p.collidable) continue;
        const y = heightAt(p.x, p.z);
        const r = model.radius * p.scale;
        const h = model.height * p.scale;
        // Trees block at the trunk, not the canopy; squat things (rocks) block at their width.
        const radius = h > 2.2 * r ? Math.min(Math.max(r * 0.3, 0.25), 1.2) : Math.max(r * 0.8, 0.3);
        colliders.push({ x: p.x, z: p.z, r: radius, top: y + h });
      }
    }
    this.planted += kept.length;
    return { group, colliders };
  }
}
