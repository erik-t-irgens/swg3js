// What gives off heat for the heat haze: the planet's lava tables, and whatever pushes plumes (engines,
// a held flame thrower). three is imported for its types only and no class uses parameter properties,
// so a plain node test reads this file as the game does.
import type * as THREE from 'three';

/** One lava table for the heat haze: its triangulated polygon (owned by World) at its height, bounds and outline in game coordinates. */
export interface LavaHeatTable {
  readonly name: string;
  readonly geometry: THREE.BufferGeometry;
  readonly height: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** The outline as x, z pairs, for the exact distance. */
  readonly points: Float32Array;
}

/** Where a plume is told about: numbers only, so a provider allocates nothing. Returns false once the frame's plumes are full. */
export interface HeatPlumeSink {
  /** `phase` is the plume's noise flow phase, advanced by the source (0..1 wraps; any number is taken modulo 1). */
  push(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, length: number, r0: number, r1: number, intensity: number, phase: number): boolean;
}

/** Called once a frame from inside PostFX.end, after the scene has drawn (world matrices are this frame's), while the heat haze is on. */
export type HeatPlumeProvider = (sink: HeatPlumeSink) => void;

interface ProviderEntry {
  fn: HeatPlumeProvider;
  dead: boolean;
}

/** What gives off heat: the planet's lava tables and whoever pushes plumes. Lives as long as the App; the effects read it. */
export class HeatSources {
  lava: readonly LavaHeatTable[] = [];
  /** Bumped by setLava, so the heat product rebuilds its meshes. */
  lavaVersion = 0;
  private readonly entries: ProviderEntry[] = [];

  setLava(tables: readonly LavaHeatTable[]): void {
    this.lava = tables;
    this.lavaVersion++;
  }

  /** Returns the remover. Removing marks the provider dead; it is dropped after the loop that is running, so no other provider is skipped. */
  addProvider(p: HeatPlumeProvider): () => void {
    const entry: ProviderEntry = { fn: p, dead: false };
    this.entries.push(entry);
    return () => {
      entry.dead = true;
    };
  }

  /** Every live provider once, in order (one added during the loop runs this frame too); then the dead are compacted out. */
  runProviders(sink: HeatPlumeSink): void {
    const list = this.entries;
    let dead = false;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.dead) e.fn(sink);
      if (e.dead) dead = true;
    }
    if (!dead) return;
    let w = 0;
    for (let i = 0; i < list.length; i++) if (!list[i].dead) list[w++] = list[i];
    list.length = w;
  }

  get providerCount(): number {
    let n = 0;
    for (const e of this.entries) if (!e.dead) n++;
    return n;
  }
}

/** Radii below this are raised to it: a zero radius would make the plume shader's smoothstep undefined. */
export const PLUME_MIN_RADIUS = 0.02;
/** Radii above this are held to it: no engine or flame is wider, and a runaway number must not fill the screen. */
const PLUME_MAX_RADIUS = 6;
/** Intensity is held to this: overlapping sources average in the buffer, but one source must not swamp it. */
const PLUME_MAX_INTENSITY = 2;

/** Noise cycles per metre for a plume of end radius r1: small plumes get finer noise, so they do not shift as a block. 0.25 × clamp(0.6 / max(r1, 0.05), 1, 6). */
export function plumeNoiseFrequency(r1: number): number {
  const r = Math.max(Number.isFinite(r1) ? r1 : 0.05, 0.05);
  return 0.25 * Math.min(6, Math.max(1, 0.6 / r));
}

/** Squared distance from a point to a closed polygon given as x, z pairs: 0 inside (even-odd), else to the nearest edge. */
export function polygonDistance2(px: number, pz: number, points: ArrayLike<number>): number {
  const n = points.length >> 1;
  if (n === 0) return Infinity;
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = points[i * 2];
    const az = points[i * 2 + 1];
    const bx = points[j * 2];
    const bz = points[j * 2 + 1];
    if (az > pz !== bz > pz && px < ((bx - ax) * (pz - az)) / (bz - az) + ax) inside = !inside;
    const ex = bx - ax;
    const ez = bz - az;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * ex + (pz - az) * ez) / len2)) : 0;
    const dx = ax + ex * t - px;
    const dz = az + ez * t - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return inside ? 0 : best;
}

/** The frame's plumes as instance data. Drops plumes that are degenerate, too far, too small on screen, or outside `cull`. */
export class PlumeBuffer implements HeatPlumeSink {
  readonly max: number;
  /** 4 × max: x, y, z, length. */
  readonly origin: Float32Array;
  /** 4 × max: x, y, z (unit), intensity. */
  readonly dir: Float32Array;
  /** 4 × max: r0, r1, noise frequency, phase (0..1). */
  readonly shape: Float32Array;
  count = 0;
  /** Every push this frame, kept or not. */
  pushed = 0;
  /** Pushes dropped for being under `minPixels` on screen. */
  tooSmall = 0;
  /** Metres from the camera past which a plume is not drawn. */
  range = 200;
  /** Heat-target texels per radian at the view centre ((heatHeight / 2) / tan(fov / 2)); 0 disables the size cull. */
  focalPixels = 0;
  /** 2 heat texels of radius (4 screen pixels). */
  minPixels = 2;
  cull: ((x: number, y: number, z: number, radius: number) => boolean) | null = null;
  private cameraX = 0;
  private cameraY = 0;
  private cameraZ = 0;

  constructor(max: number) {
    this.max = Math.max(0, Math.floor(max));
    this.origin = new Float32Array(this.max * 4);
    this.dir = new Float32Array(this.max * 4);
    this.shape = new Float32Array(this.max * 4);
  }

  reset(cameraX: number, cameraY: number, cameraZ: number): void {
    this.count = 0;
    this.pushed = 0;
    this.tooSmall = 0;
    this.cameraX = cameraX;
    this.cameraY = cameraY;
    this.cameraZ = cameraZ;
  }

  push(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, length: number, r0: number, r1: number, intensity: number, phase: number): boolean {
    this.pushed++;
    if (this.count >= this.max) return false;
    // The negated tests catch NaN as well as the out-of-range.
    if (!(length >= 0.05) || !(intensity >= 0.01) || !(r0 >= 0) || !(r1 >= 0)) return true;
    if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(oz)) return true;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz) || !Number.isFinite(phase) || !Number.isFinite(length)) return true;
    const dl = Math.hypot(dx, dy, dz);
    if (!(dl >= 1e-6)) return true;
    dx /= dl;
    dy /= dl;
    dz /= dl;
    r0 = Math.min(PLUME_MAX_RADIUS, Math.max(r0, PLUME_MIN_RADIUS));
    r1 = Math.min(PLUME_MAX_RADIUS, Math.max(r1, PLUME_MIN_RADIUS));
    const half = length / 2;
    const rMax = Math.max(r0, r1);
    const cx = ox + dx * half;
    const cy = oy + dy * half;
    const cz = oz + dz * half;
    const radius = half + rMax;
    const dist = Math.hypot(cx - this.cameraX, cy - this.cameraY, cz - this.cameraZ);
    if (dist > this.range + radius) return true;
    if (this.focalPixels > 0 && (rMax * this.focalPixels) / Math.max(dist - half, 0.5) < this.minPixels) {
      this.tooSmall++;
      return true;
    }
    if (this.cull && !this.cull(cx, cy, cz, radius)) return true;
    const o = this.count * 4;
    this.origin[o] = ox;
    this.origin[o + 1] = oy;
    this.origin[o + 2] = oz;
    this.origin[o + 3] = length;
    this.dir[o] = dx;
    this.dir[o + 1] = dy;
    this.dir[o + 2] = dz;
    this.dir[o + 3] = Math.min(intensity, PLUME_MAX_INTENSITY);
    this.shape[o] = r0;
    this.shape[o + 1] = r1;
    this.shape[o + 2] = plumeNoiseFrequency(r1);
    this.shape[o + 3] = phase - Math.floor(phase);
    this.count++;
    return true;
  }
}
