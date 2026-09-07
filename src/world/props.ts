import * as THREE from 'three';
import type { PlanetDef, TreeStyle } from '../data/planets';
import { hash2 } from './noise';
import { CHUNK_SIZE, type Terrain } from './terrain';
import type { LoadedModel } from './assetPack';

/** A converted SWG model to scatter, with a relative placement chance. */
export interface ScatterItem { model: LoadedModel; density: number; minScale: number; maxScale: number }

export interface Collider { x: number; z: number; r: number; top: number }
export interface Exclusion { x: number; z: number; r: number }

interface StyleParams {
  trunkH: number;
  trunkW: number;
  canopy: THREE.BufferGeometry;
  canopyOffset: number;
  canopyScale: number;
  canopyY: number;
}

const ATTEMPTS = 70;
const tmpMat = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpEuler = new THREE.Euler();
const tmpN = new THREE.Vector3();

function styleFor(style: TreeStyle): StyleParams | null {
  switch (style) {
    case 'pine':
      return { trunkH: 2.6, trunkW: 1, canopy: new THREE.ConeGeometry(1, 3.2, 7).translate(0, 1.6, 0), canopyOffset: 0.45, canopyScale: 1.5, canopyY: 1 };
    case 'round':
      return { trunkH: 2.6, trunkW: 1.7, canopy: new THREE.IcosahedronGeometry(1.7, 1), canopyOffset: 1.0, canopyScale: 1, canopyY: 0.85 };
    case 'palm':
      return { trunkH: 6.5, trunkW: 0.7, canopy: new THREE.IcosahedronGeometry(2.2, 1), canopyOffset: 1.0, canopyScale: 1, canopyY: 0.35 };
    case 'dead':
      return { trunkH: 4.5, trunkW: 0.8, canopy: new THREE.DodecahedronGeometry(0.9, 0), canopyOffset: 1.0, canopyScale: 1, canopyY: 0.6 };
    case 'giant':
      return { trunkH: 16, trunkW: 3.2, canopy: new THREE.ConeGeometry(1, 3.4, 7).translate(0, 1.7, 0), canopyOffset: 0.4, canopyScale: 4.2, canopyY: 1.2 };
    case 'swamp':
      return { trunkH: 4, trunkW: 0.6, canopy: new THREE.IcosahedronGeometry(1.5, 1), canopyOffset: 1.0, canopyScale: 1, canopyY: 0.55 };
    default:
      return null;
  }
}

export class PropFactory {
  private readonly trunkGeo = new THREE.CylinderGeometry(0.13, 0.24, 1, 6).translate(0, 0.5, 0);
  private readonly rockGeo = new THREE.DodecahedronGeometry(1, 0);
  private readonly trunkMat: THREE.MeshStandardMaterial;
  private readonly canopyMat: THREE.MeshStandardMaterial;
  private readonly rockMat: THREE.MeshStandardMaterial;
  private readonly style: StyleParams | null;

  constructor(private readonly planet: PlanetDef, private readonly scatter: ScatterItem[] = []) {
    this.trunkMat = new THREE.MeshStandardMaterial({ color: planet.props.trunk, flatShading: true, roughness: 0.95 });
    this.canopyMat = new THREE.MeshStandardMaterial({ color: planet.props.canopy, flatShading: true, roughness: 0.9 });
    this.rockMat = new THREE.MeshStandardMaterial({ color: planet.props.rock, flatShading: true, roughness: 1 });
    this.style = styleFor(planet.props.treeStyle);
  }

  buildForChunk(cx: number, cz: number, terrain: Terrain, exclude: Exclusion[] = []): { group: THREE.Group; colliders: Collider[] } {
    const group = new THREE.Group();
    const colliders: Collider[] = [];
    const seed = this.planet.seed;
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;
    const p = this.planet.props;

    const trees: { x: number; y: number; z: number; s: number; rot: number }[] = [];
    const placed = new Map<ScatterItem, { x: number; y: number; z: number; s: number; rot: number }[]>();
    const rocks: { x: number; y: number; z: number; sx: number; sy: number; sz: number; rx: number; ry: number }[] = [];

    for (let i = 0; i < ATTEMPTS; i++) {
      const kx = cx * 7919 + i * 13;
      const kz = cz * 104729 + i * 7;
      const x = ox + hash2(kx, kz, seed + 1) * CHUNK_SIZE;
      const z = oz + hash2(kx, kz, seed + 2) * CHUNK_SIZE;
      if (exclude.some((e) => Math.hypot(x - e.x, z - e.z) < e.r)) continue;
      const h = terrain.heightAt(x, z);
      if (h < terrain.waterLevel + 0.6) continue;
      const ny = terrain.normalAt(x, z, tmpN).y;
      const r = hash2(kx, kz, seed + 3);
      const r2 = hash2(kx, kz, seed + 4);
      const r3 = hash2(kx, kz, seed + 5);

      const treeP = this.style && ny > 0.78 ? p.treeDensity * (0.15 + 0.85 * terrain.densityAt(x, z)) * 0.55 : 0;
      if (r < treeP) {
        trees.push({ x, y: h - 0.15, z, s: (0.75 + r2 * 0.7) * p.treeScale, rot: r3 * Math.PI * 2 });
      } else if (this.scatter.length) {
        // Real meshes: pick by weighted density.
        let acc = treeP;
        for (const item of this.scatter) {
          const chance = item.density * 0.12;
          if (r < acc + chance) {
            const s = item.minScale + r2 * (item.maxScale - item.minScale);
            (placed.get(item) ?? placed.set(item, []).get(item)!).push({ x, y: h - 0.05, z, s, rot: r3 * Math.PI * 2 });
            break;
          }
          acc += chance;
        }
      } else if (r < treeP + p.rockDensity * 0.12) {
        const s = 0.4 + r2 * r2 * 2.4;
        rocks.push({ x, y: h - s * 0.3, z, sx: s * (0.7 + r3 * 0.6), sy: s * (0.5 + r * 0.6), sz: s, rx: r3 * 0.6, ry: r2 * Math.PI * 2 });
      }
    }

    if (trees.length && this.style) {
      const st = this.style;
      const trunks = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, trees.length);
      const canopies = new THREE.InstancedMesh(st.canopy, this.canopyMat, trees.length);
      trees.forEach((t, i) => {
        tmpQuat.setFromEuler(tmpEuler.set(0, t.rot, 0));
        tmpMat.compose(tmpPos.set(t.x, t.y, t.z), tmpQuat, tmpScale.set(t.s * st.trunkW, t.s * st.trunkH, t.s * st.trunkW));
        trunks.setMatrixAt(i, tmpMat);
        const cs = t.s * st.canopyScale;
        tmpMat.compose(tmpPos.set(t.x, t.y + t.s * st.trunkH * st.canopyOffset, t.z), tmpQuat, tmpScale.set(cs, cs * st.canopyY, cs));
        canopies.setMatrixAt(i, tmpMat);
        colliders.push({ x: t.x, z: t.z, r: 0.28 * st.trunkW * t.s + 0.25, top: t.y + t.s * st.trunkH + cs * 2.2 });
      });
      trunks.castShadow = true;
      canopies.castShadow = true;
      trunks.instanceMatrix.needsUpdate = true;
      canopies.instanceMatrix.needsUpdate = true;
      group.add(trunks, canopies);
    }

    for (const [item, list] of placed) {
      for (const prim of item.model.primitives) {
        const mesh = new THREE.InstancedMesh(prim.geometry, prim.material, list.length);
        list.forEach((t, i) => {
          tmpQuat.setFromEuler(tmpEuler.set(0, t.rot, 0));
          tmpMat.compose(tmpPos.set(t.x, t.y, t.z), tmpQuat, tmpScale.set(t.s, t.s, t.s));
          mesh.setMatrixAt(i, tmpMat);
        });
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
      }
      for (const t of list) {
        const r = item.model.radius * t.s;
        if (r > 0.45) colliders.push({ x: t.x, z: t.z, r: r * 0.8, top: t.y + item.model.height * t.s });
      }
    }

    if (rocks.length) {
      const mesh = new THREE.InstancedMesh(this.rockGeo, this.rockMat, rocks.length);
      rocks.forEach((r, i) => {
        tmpQuat.setFromEuler(tmpEuler.set(r.rx, r.ry, 0));
        tmpMat.compose(tmpPos.set(r.x, r.y, r.z), tmpQuat, tmpScale.set(r.sx, r.sy, r.sz));
        mesh.setMatrixAt(i, tmpMat);
        if (r.sz > 0.9) colliders.push({ x: r.x, z: r.z, r: Math.max(r.sx, r.sz) * 0.85, top: r.y + r.sy });
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }

    return { group, colliders };
  }

  dispose(): void {
    this.trunkGeo.dispose();
    this.rockGeo.dispose();
    this.style?.canopy.dispose();
    this.trunkMat.dispose();
    this.canopyMat.dispose();
    this.rockMat.dispose();
  }
}
