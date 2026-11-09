// What follows the far ground's reach (the horizon pass's fifth wave, A:\swg3js\horizon\DESIGN.md §2.6, §2.7): the
// record every reader of the reach holds this frame (the camera's far plane, the sky's radius, the god rays' and the
// flare's sky, the far sea's edge), today's numbers by `Object.is` whenever the rings are not drawn; and the far sea's
// outer row moved in place to the reach in force, from a copy of the row as `RingGeometry` made it, so today's 9,000 m
// is written back to the bit.
//
// Pure: three's buffers alone, so node runs it.
import type * as THREE from 'three';
import { FAR_BASE, HORIZON_TUNE, RAYS_GROUND_SKY, SEA_BASE, SKY_BASE, type ReachRules } from './horizonMath.ts';

/**
 * What the readers of the reach hold (§2.6): written by `World.updateHorizon` a frame, read by the game's far plane writer,
 * the sky, the effects' frame input and the far sea. A class whose fields begin as fractions, so a fraction written later
 * is written in place (a field begun as a whole number boxes every fraction after it).
 */
export class HorizonFollow {
  far = 0.5;
  sky = 0.5;
  groundSky = 0.5;
  flareSky = 0.5;
  /** The reach in force the far sea's edge last followed (today's 9,000 m while the rings are not drawn). */
  sea = 0.5;
  /** Whether the rings drew this frame (their numbers in force) or every reader holds today's. */
  on = false;
  constructor() {
    this.base();
  }

  /** Today's numbers, each `Object.is` the constant every reader held before the pass. */
  base(): void {
    this.far = FAR_BASE;
    this.sky = SKY_BASE;
    this.groundSky = RAYS_GROUND_SKY;
    this.flareSky = SKY_BASE;
    this.sea = SEA_BASE;
    this.on = false;
  }

  /**
   * The rules' answers in force (a frame the rings drew): the far plane and the sky's radius as they stand, the god rays'
   * and the flare's sky, and the far sea's edge moved only once the reach in force has gone `seaStep` from where it last
   * followed (on the first frame of the rings, at once).
   */
  follow(r: ReachRules, seaStep: number = HORIZON_TUNE.seaStep): void {
    this.far = r.far;
    this.sky = r.skyRadius;
    this.groundSky = r.groundSky;
    this.flareSky = r.flareSky;
    if (!this.on || Math.abs(r.inForce - this.sea) >= Math.max(0, seaStep)) this.sea = r.inForce;
    this.on = true;
  }
}

/** What the sky holds that follows the reach (`SwgSky`'s bodies' group and the flare's sky), as `applyFollow` writes it. */
export interface FollowSky {
  group: { scale: { x: number; setScalar(k: number): unknown } };
  flareSkyDistance: number;
}

/**
 * The follow record applied (§2.6, §2.7: `World.applyHorizonFollow`, every frame): the sky's bodies, stars and skybox
 * scaled to its radius over today's 3,500 m, the flare's sky, and the far sea's outer row; each written only where it
 * moved, so with the record at `base` nothing is written at all and every one holds today's. Read off the record in
 * place (a number handed across a call the compiler leaves out is a number made).
 */
export function applyFollow(f: HorizonFollow, sky: FollowSky | null, sea: FarSea | null): void {
  if (sky) {
    const k = f.sky / SKY_BASE;
    if (sky.group.scale.x !== k) sky.group.scale.setScalar(k);
    if (sky.flareSkyDistance !== f.flareSky) sky.flareSkyDistance = f.flareSky;
  }
  if (sea) sea.follow(f);
}

/**
 * The sea's flat far ring (`createGlobalWater`'s `RingGeometry(WATER_NEAR * 0.48, 9000, 96, 1)`): its outer row found by
 * its radius and kept as made, and moved to an edge in place (§2.7: the position attribute written, never a geometry
 * made, so the mask twins sharing the geometry share it too). An edge of `SEA_BASE` writes the row back to the bit; an
 * edge is never brought inside the inner row (a twentieth past it, so no triangle turns over).
 */
export class FarSea {
  readonly rows: Int32Array;
  readonly kept: Float32Array;
  readonly inner: number;
  edge = 0.5;
  private readonly pos: THREE.BufferAttribute;
  private readonly geometry: THREE.BufferGeometry;

  constructor(geometry: THREE.BufferGeometry) {
    this.geometry = geometry;
    this.pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = this.pos.array as Float32Array;
    const n = this.pos.count;
    let most = 0;
    let least = Infinity;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(a[i * 3], a[i * 3 + 2]);
      if (r > most) most = r;
      if (r < least) least = r;
    }
    const outer: number[] = [];
    for (let i = 0; i < n; i++) if (Math.hypot(a[i * 3], a[i * 3 + 2]) > most * 0.999) outer.push(i);
    this.rows = Int32Array.from(outer);
    this.kept = new Float32Array(outer.length * 3);
    for (let k = 0; k < outer.length; k++) for (let c = 0; c < 3; c++) this.kept[k * 3 + c] = a[outer[k] * 3 + c];
    this.inner = least;
    this.edge = SEA_BASE;
  }

  /** The follow record's edge (a frame's: read off the record, nothing handed across the call). */
  follow(f: HorizonFollow): void {
    if (f.sea !== this.edge) this.set(f.sea);
  }

  /** The outer row at `edge` metres (`SEA_BASE` puts it back as made); nothing is written when it is already there. */
  set(edge: number): void {
    const e = edge === SEA_BASE ? SEA_BASE : Math.max(edge, this.inner * 1.05);
    if (e === this.edge) return;
    this.edge = e;
    const a = this.pos.array as Float32Array;
    const k = this.kept;
    const rows = this.rows;
    if (e === SEA_BASE) {
      for (let i = 0; i < rows.length; i++) {
        const o = rows[i] * 3;
        a[o] = k[i * 3];
        a[o + 1] = k[i * 3 + 1];
        a[o + 2] = k[i * 3 + 2];
      }
    } else {
      const s = e / SEA_BASE;
      for (let i = 0; i < rows.length; i++) {
        const o = rows[i] * 3;
        a[o] = k[i * 3] * s;
        a[o + 1] = k[i * 3 + 1];
        a[o + 2] = k[i * 3 + 2] * s;
      }
    }
    this.pos.needsUpdate = true;
    // Grown or shrunk with it where three made one (the ring is never culled, `frustumCulled` false, so it is not made here).
    const bs = this.geometry.boundingSphere;
    if (bs) {
      if (this.keptRadius !== this.keptRadius) this.keptRadius = bs.radius;
      bs.radius = e === SEA_BASE ? this.keptRadius : e;
    }
  }
  /** The sphere's radius as three made it, kept the first time the row moves under one (NaN until then). */
  private keptRadius = Number.NaN;
}
