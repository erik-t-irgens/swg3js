// Port of the engine's TerrainGenerator (sharedTerrain): layers of boundaries, filters and
// affectors that build a chunk's height, shader and exclude maps from a .trn's TGEN block.
// Only height-relevant behaviour is reproduced in full; colour, flora and environment
// affectors are parsed and kept as inert layer items so layer bookkeeping stays identical.

import { MultiFractal } from './fractal.ts';
import { FastRandomGenerator, FloraGroup, hashTuple } from './flora.ts';
import { ChunkReader, chunkChild, formChild, isForm, nameOf, type IffChunk, type IffForm, type IffNode } from './iff.ts';

// ---------------------------------------------------------------------------
// Small math helpers (Rectangle2d, Feather, Transform2d)
// ---------------------------------------------------------------------------

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const emptyRect = (): Rect => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

export function rectExpand(r: Rect, x: number, y: number): void {
  if (x < r.x0) r.x0 = x;
  if (y < r.y0) r.y0 = y;
  if (x > r.x1) r.x1 = x;
  if (y > r.y1) r.y1 = y;
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  return !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
}

export function rectIsWithin(r: Rect, x: number, y: number): boolean {
  const xlo = Math.min(r.x0, r.x1);
  const xhi = Math.max(r.x0, r.x1);
  const ylo = Math.min(r.y0, r.y1);
  const yhi = Math.max(r.y0, r.y1);
  return x >= xlo && x <= xhi && y >= ylo && y <= yhi;
}

export const FeatherFunction = { linear: 0, easeIn: 1, easeOut: 2, easeInOut: 3 } as const;

export function feather(fn: number, t: number): number {
  switch (fn) {
    case 0:
      return t;
    case 1:
      return t * t;
    case 2:
      return Math.sqrt(t);
    case 3:
      return (3 - 2 * t) * t * t;
    default:
      return 0;
  }
}

const clamp = (lo: number, v: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sqr = (v: number) => v * v;
const fuzzyAnd = (a: number, b: number) => Math.min(a, b);

/** Feathered "value between minimum and maximum" test shared by the filters (computeFeatheredInterpolant). */
function featheredInterpolant(minimum: number, value: number, maximum: number, featherIn: number): number {
  if (!(value > minimum && value < maximum)) return 0;
  const f = featherIn * (maximum - minimum) * 0.5;
  if (value < minimum + f) return (value - minimum) / f;
  if (value > maximum - f) return (maximum - value) / f;
  return 1;
}

/** 2D rigid transform as used by rotated rectangle boundaries (Transform2d). */
class Transform2d {
  m00 = 1;
  m01 = 0;
  m10 = 0;
  m11 = 1;
  tx = 0;
  ty = 0;

  resetRotate(): void {
    this.m00 = 1;
    this.m01 = 0;
    this.m10 = 0;
    this.m11 = 1;
  }

  yaw(radians: number): void {
    const s = Math.sin(radians);
    const c = Math.cos(radians);
    const { m00: a, m01: b, m10: cc, m11: d } = this;
    this.m00 = a * c + b * -s;
    this.m01 = a * s + b * c;
    this.m10 = cc * c + d * -s;
    this.m11 = cc * s + d * c;
  }

  /** Parent (world) to local. */
  p2lX(x: number, y: number): number {
    return this.m00 * (x - this.tx) + this.m10 * (y - this.ty);
  }

  p2lY(x: number, y: number): number {
    return this.m01 * (x - this.tx) + this.m11 * (y - this.ty);
  }

  /** Bounding box in local space of a parent-space rectangle. */
  p2lRect(r: Rect): Rect {
    const out = emptyRect();
    for (const [x, y] of [
      [r.x0, r.y0],
      [r.x1, r.y0],
      [r.x0, r.y1],
      [r.x1, r.y1],
    ]) {
      rectExpand(out, this.p2lX(x, y), this.p2lY(x, y));
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export class FractalGroup {
  readonly families = new Map<number, { name: string; fractal: MultiFractal }>();

  get(familyId: number): MultiFractal | undefined {
    return this.families.get(familyId)?.fractal;
  }

  add(familyId: number, name: string, fractal: MultiFractal): void {
    this.families.set(familyId, { name, fractal });
  }

  /** Reuse an identical family or create one with a fresh id (FractalGroup::createFamily). */
  createFamily(fractal: MultiFractal, baseName: string): number {
    for (const [id, f] of this.families) if (f.fractal.equals(fractal)) return id;
    let familyId = 1;
    while (this.families.has(familyId)) ++familyId;
    let i = 0;
    let name: string;
    do {
      ++i;
      name = `${baseName}_${i}`;
    } while ([...this.families.values()].some((f) => f.name.toLowerCase() === name.toLowerCase()));
    const copy = new MultiFractal();
    copy.copyFrom(fractal);
    this.add(familyId, name, copy);
    return familyId;
  }

  load(form: IffForm | undefined): void {
    if (!form) return;
    const v = formChild(form, '0000');
    if (!v) return;
    for (const fam of v.children) {
      if (!isForm(fam) || fam.type !== 'MFAM') continue;
      const data = chunkChild(fam, 'DATA');
      if (!data) continue;
      const r = new ChunkReader(data.data);
      const id = r.int32();
      const name = r.string();
      const mf = new MultiFractal();
      loadMultiFractal(formChild(fam, 'MFRC'), mf);
      this.add(id, name, mf);
    }
  }
}

/** MFRC record (MultiFractalReaderWriter). */
export function loadMultiFractal(form: IffForm | undefined, mf: MultiFractal): void {
  if (!form) return;
  const v = form.children[0];
  if (!v || !isForm(v)) return;
  const data = chunkChild(v, 'DATA');
  if (!data) return;
  const r = new ChunkReader(data.data);
  mf.setSeed(r.uint32());
  const useBias = r.int32() !== 0;
  const bias = r.float();
  mf.setBias(useBias, bias);
  const useGain = r.int32() !== 0;
  const gain = r.float();
  mf.setGain(useGain, gain);
  mf.setNumberOfOctaves(r.int32());
  mf.setFrequency(r.float());
  mf.setAmplitude(r.float());
  const sx = r.float();
  const sy = r.float();
  mf.setScale(sx, sy);
  if (v.type === '0001') {
    const ox = r.float();
    const oy = r.float();
    mf.setOffset(ox, oy);
  }
  mf.setCombinationRule(r.int32());
}

export interface ShaderFamily {
  id: number;
  name: string;
  featherClamp: number;
  shaderSize: number;
  children: { name: string; weight: number }[];
}

export class ShaderGroup {
  readonly families = new Map<number, ShaderFamily>();

  featherClamp(familyId: number): number {
    return this.families.get(familyId)?.featherClamp ?? 1;
  }

  /** The family with this name (case-insensitive), or undefined. */
  byName(name: string): ShaderFamily | undefined {
    const key = name.toLowerCase();
    for (const f of this.families.values()) if (f.name.toLowerCase() === key) return f;
    return undefined;
  }

  /** The id of the family with this name, adding a copy of `like` under a fresh id when it is new. */
  ensure(like: ShaderFamily): number {
    const existing = this.byName(like.name);
    if (existing) return existing.id;
    let id = 1;
    for (const k of this.families.keys()) id = Math.max(id, k + 1);
    this.families.set(id, { ...like, id, children: like.children.map((c) => ({ ...c })) });
    return id;
  }

  load(form: IffForm | undefined): void {
    if (!form) return;
    const v = form.children[0];
    if (!v || !isForm(v)) return;
    const version = Number.parseInt(v.type, 10);
    for (const c of v.children) {
      if (isForm(c) || c.tag !== 'SFAM') continue;
      const r = new ChunkReader(c.data);
      const id = r.int32();
      const fam: ShaderFamily = { id, name: 'null', featherClamp: 1, shaderSize: 2, children: [] };
      if (version >= 1) {
        fam.name = r.string();
        if (version >= 6) r.string();
        r.uint8();
        r.uint8();
        r.uint8();
      }
      if (version >= 2) fam.shaderSize = r.float();
      if (version === 3) r.float();
      if (version >= 4) fam.featherClamp = r.float();
      if (version === 5) r.int32();
      const n = r.int32();
      for (let k = 0; k < n; k++) {
        const name = r.string();
        const weight = version >= 1 ? r.float() : 1 / n;
        fam.children.push({ name, weight });
      }
      this.families.set(id, fam);
    }
  }
}

export interface EnvironmentFamily {
  id: number;
  name: string;
  /** The editor's colour for the family (0..255 each). */
  color: [number, number, number];
  /** How much of a boundary's feather must cover a pole before the family takes it. */
  featherClamp: number;
  /** An event's area: written to the seasonal map, so the family under it is still known out of season. */
  seasonal: boolean;
}

/** Families whose name matches this belong to a seasonal event rather than the place itself. */
export const SEASONAL_FAMILY = /lifeday/i;

/** EGRP: the environment families an area can belong to, the environment table's rows keyed by name. */
export class EnvironmentGroup {
  readonly families = new Map<number, EnvironmentFamily>();

  featherClamp(familyId: number): number {
    return this.families.get(familyId)?.featherClamp ?? 1;
  }

  isSeasonal(familyId: number): boolean {
    return this.families.get(familyId)?.seasonal ?? false;
  }

  /** Case-insensitive: one planet's terrain capitalises names its environment table spells in lower case. */
  byName(name: string): EnvironmentFamily | undefined {
    const key = name.toLowerCase();
    for (const f of this.families.values()) if (f.name.toLowerCase() === key) return f;
    return undefined;
  }

  /** Any version form; each child FORM EFAM > DATA: int32 id, name, three colour bytes, float feather clamp. */
  load(form: IffForm | undefined): void {
    if (!form) return;
    const v = form.children[0];
    if (!v || !isForm(v)) return;
    for (const c of v.children) {
      const data = isForm(c) ? chunkChild(c, 'DATA') : c;
      if (!data) continue;
      const r = new ChunkReader(data.data);
      if (r.remaining < 5) continue;
      const id = r.int32();
      const name = r.string();
      // A truncated family would read undefined past the end, so each read is asked for first.
      const color: [number, number, number] = r.remaining >= 3 ? [r.uint8(), r.uint8(), r.uint8()] : [255, 255, 255];
      const featherClamp = r.remaining >= 4 ? r.float() : 1;
      this.families.set(id, { id, name, color, featherClamp, seasonal: SEASONAL_FAMILY.test(name) });
    }
  }
}

/** An 8-bit greyscale image, rows top-down, as the engine's Image holds terrain bitmaps. */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Terrain bitmap families: the second MGRP block, one image per family (BitmapGroup). */
export class BitmapGroup {
  readonly families = new Map<number, { name: string; bitmapName: string; image: Bitmap | null }>();

  load(form: IffForm | undefined): void {
    if (!form) return;
    const v = formChild(form, '0000');
    if (!v) return;
    for (const fam of v.children) {
      if (!isForm(fam) || fam.type !== 'MFAM') continue;
      const data = chunkChild(fam, 'DATA');
      if (!data) continue;
      const r = new ChunkReader(data.data);
      const id = r.int32();
      const name = r.string();
      const bitmapName = r.string();
      this.families.set(id, { name, bitmapName, image: null });
    }
  }

  setImage(familyId: number, image: Bitmap): void {
    const f = this.families.get(familyId);
    if (f) f.image = image;
  }

  image(familyId: number): Bitmap | null {
    return this.families.get(familyId)?.image ?? null;
  }
}

/** Parse the "HMAP" file the converter writes for a terrain bitmap. */
export function parseHeightmapFile(bytes: Uint8Array): Bitmap | null {
  if (bytes.length < 12 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'HMAP') return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = v.getUint32(4, true);
  const height = v.getUint32(8, true);
  if (bytes.length < 12 + width * height) return null;
  return { width, height, data: bytes.subarray(12, 12 + width * height) };
}

// ---------------------------------------------------------------------------
// Chunk data
// ---------------------------------------------------------------------------

export interface ChunkData {
  startX: number;
  startZ: number;
  numberOfPoles: number;
  /** Diagnostics: called after each layer (top level and nested, with its depth) with the height at pole `probeIndex`. */
  trace?: (layer: Layer, height: number, depth: number) => void;
  probeIndex?: number;
  traceDepth?: number;
  distanceBetweenPoles: number;
  extent: Rect;
  heightMap: Float32Array;
  shaderMap: Int32Array;
  excludeMap: Uint8Array;
  /** Static flora per pole: family id and child choice (0..255) pairs; collidable (trees, rocks) and not (plants). */
  floraCollidable: Uint8Array;
  floraNonCollidable: Uint8Array;
  normalMap: Float32Array;
  normalsDirty: boolean;
  /** Environment family id per pole (0 = none): which area's environment rows apply there. */
  environmentMap: Uint8Array;
  /** The same for seasonal areas, kept apart so the place underneath is still known out of season. */
  seasonalMap: Uint8Array;
  fractalGroup: FractalGroup;
  shaderGroup: ShaderGroup;
  bitmapGroup: BitmapGroup;
  floraGroup: FloraGroup;
  environmentGroup: EnvironmentGroup;
}

export function createChunkData(startX: number, startZ: number, numberOfPoles: number, distanceBetweenPoles: number, fractalGroup: FractalGroup, shaderGroup: ShaderGroup, bitmapGroup: BitmapGroup = new BitmapGroup(), floraGroup: FloraGroup = new FloraGroup(), environmentGroup: EnvironmentGroup = new EnvironmentGroup()): ChunkData {
  const n = numberOfPoles * numberOfPoles;
  const size = (numberOfPoles - 1) * distanceBetweenPoles;
  return {
    startX,
    startZ,
    numberOfPoles,
    distanceBetweenPoles,
    extent: { x0: startX, y0: startZ, x1: startX + size, y1: startZ + size },
    heightMap: new Float32Array(n),
    shaderMap: new Int32Array(n),
    excludeMap: new Uint8Array(n),
    floraCollidable: new Uint8Array(n * 2),
    floraNonCollidable: new Uint8Array(n * 2),
    normalMap: new Float32Array(n * 3),
    normalsDirty: true,
    environmentMap: new Uint8Array(n),
    seasonalMap: new Uint8Array(n),
    fractalGroup,
    shaderGroup,
    bitmapGroup,
    floraGroup,
    environmentGroup,
  };
}

/** TerrainGenerator::generatePlaneAndVertexNormals: face normals accumulated onto poles. */
export function generateNormals(d: ChunkData): void {
  const n = d.numberOfPoles;
  const s = d.distanceBetweenPoles;
  const h = d.heightMap;
  const nm = d.normalMap;
  nm.fill(0);
  const add = (i: number, x: number, y: number, z: number) => {
    nm[i * 3] += x;
    nm[i * 3 + 1] += y;
    nm[i * 3 + 2] += z;
  };
  for (let z = 0; z < n - 1; z++) {
    const r0 = z * n;
    const r1 = (z + 1) * n;
    for (let x = 0; x < n - 1; x++) {
      // v20 = (-s, h1[x] - h0[x+1], s); v01 = (s, h1[x+1] - h1[x], 0); v32 = (s, h0[x+1] - h0[x], 0)
      const ax = -s;
      const ay = h[r1 + x] - h[r0 + x + 1];
      const az = s;
      const by = h[r1 + x + 1] - h[r1 + x];
      const cy = h[r0 + x + 1] - h[r0 + x];
      // cross(v20, v01) with v01 = (s, by, 0)
      const urx = ay * 0 - az * by;
      const ury = az * s - ax * 0;
      const urz = ax * by - ay * s;
      // cross(v20, v32) with v32 = (s, cy, 0)
      const llx = ay * 0 - az * cy;
      const lly = az * s - ax * 0;
      const llz = ax * cy - ay * s;
      add(r1 + x, urx, ury, urz);
      add(r1 + x + 1, urx, ury, urz);
      add(r0 + x + 1, urx, ury, urz);
      add(r0 + x + 1, llx, lly, llz);
      add(r0 + x, llx, lly, llz);
      add(r1 + x, llx, lly, llz);
    }
  }
  for (let i = 0; i < n * n; i++) {
    const x = nm[i * 3];
    const y = nm[i * 3 + 1];
    const z = nm[i * 3 + 2];
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 0) {
      nm[i * 3] = x / len;
      nm[i * 3 + 1] = y / len;
      nm[i * 3 + 2] = z / len;
    } else {
      nm[i * 3 + 1] = 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Layer items
// ---------------------------------------------------------------------------

export abstract class LayerItem {
  active = true;
  name = '';
  pruned = false;
  readonly tag: string;

  constructor(tag: string) {
    this.tag = tag;
  }

  /** IHDR block: active flag and name. */
  loadHeader(form: IffForm): void {
    const ihdr = formChild(form, 'IHDR');
    if (!ihdr) return;
    const v = ihdr.children[0];
    if (!v || !isForm(v)) return;
    const data = chunkChild(v, 'DATA');
    if (!data) return;
    const r = new ChunkReader(data.data);
    this.active = r.int32() !== 0;
    this.name = r.string();
  }
}

export abstract class Boundary extends LayerItem {
  featherFunction = 0;
  featherDistance = 0;

  abstract isWithin(worldX: number, worldZ: number): number;
  abstract intersects(r: Rect): boolean;
  abstract expand(r: Rect): void;

  setCenter(_x: number, _z: number): void {}
  setRotation(_angle: number): void {}
  prepare(): void {}

  /** Default rasteriser: sample isWithin at every pole (Boundary::scanConvertGT). */
  scanConvert(map: Float32Array, scanArea: Rect, numberOfPoles: number): void {
    if (!this.intersects(scanArea)) return;
    const sampleWidth = numberOfPoles - 1;
    if (sampleWidth === 0) {
      map[0] = Math.max(map[0], feather(this.featherFunction, this.isWithin(scanArea.x0, scanArea.y0)));
      return;
    }
    const scale = (scanArea.x1 - scanArea.x0) / sampleWidth;
    for (let z = 0; z < numberOfPoles; z++) {
      const row = z * numberOfPoles;
      const worldZ = scanArea.y0 + z * scale;
      for (let x = 0; x < numberOfPoles; x++) {
        const worldX = scanArea.x0 + x * scale;
        const amount = feather(this.featherFunction, this.isWithin(worldX, worldZ));
        if (amount > map[row + x]) map[row + x] = amount;
      }
    }
  }

  protected readFeather(r: ChunkReader): void {
    this.featherFunction = r.int32();
    this.featherDistance = clamp(0, r.float(), 1);
  }
}

export class BoundaryCircle extends Boundary {
  centerX = 0;
  centerZ = 0;
  radius = 0;
  radiusSquared = 0;

  constructor() {
    super('BCIR');
  }

  setCircle(x: number, z: number, radius: number): void {
    this.centerX = x;
    this.centerZ = z;
    this.radius = Math.abs(radius);
    this.radiusSquared = this.radius * this.radius;
  }

  override setCenter(x: number, z: number): void {
    this.centerX = x;
    this.centerZ = z;
  }

  isWithin(worldX: number, worldZ: number): number {
    const d2 = sqr(this.centerX - worldX) + sqr(this.centerZ - worldZ);
    if (d2 > this.radiusSquared) return 0;
    const inner2 = sqr(this.radius * (1 - this.featherDistance));
    if (d2 <= inner2) return 1;
    return 1 - (d2 - inner2) / (this.radiusSquared - inner2);
  }

  intersects(o: Rect): boolean {
    return rectIntersects({ x0: this.centerX - this.radius, y0: this.centerZ - this.radius, x1: this.centerX + this.radius, y1: this.centerZ + this.radius }, o);
  }

  expand(r: Rect): void {
    rectExpand(r, this.centerX - this.radius, this.centerZ - this.radius);
    rectExpand(r, this.centerX + this.radius, this.centerZ + this.radius);
  }

  override scanConvert(map: Float32Array, scanArea: Rect, numberOfPoles: number): void {
    if (!this.intersects(scanArea)) return;
    const real2Sample = (numberOfPoles - 1) / (scanArea.y1 - scanArea.y0);
    const cx = (this.centerX - scanArea.x0) * real2Sample;
    const cz = (this.centerZ - scanArea.y0) * real2Sample;
    const r = this.radius * real2Sample;
    const zmin = Math.max(0, Math.ceil(cz - r));
    const zmax = Math.min(numberOfPoles - 1, Math.floor(cz + r));
    if (zmax < zmin) return;
    const r2 = r * r;
    const inner2 = sqr(r * (1 - this.featherDistance));
    for (let z = zmin; z <= zmax; z++) {
      const zd2 = sqr(z - cz);
      const xrad = Math.sqrt(r * r - zd2);
      const xmin = Math.max(0, Math.ceil(cx - xrad));
      const xmax = Math.min(numberOfPoles - 1, Math.floor(cx + xrad));
      const row = z * numberOfPoles;
      for (let x = xmin; x <= xmax; x++) {
        const d2 = sqr(x - cx) + zd2;
        if (d2 <= inner2) map[row + x] = 1;
        else {
          const amount = feather(this.featherFunction, 1 - (d2 - inner2) / (r2 - inner2));
          if (amount > map[row + x]) map[row + x] = amount;
        }
      }
    }
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const r = new ChunkReader(chunkChild(v, 'DATA')!.data);
    if (v.type === '0001') r.float();
    const cx = r.float();
    const cz = r.float();
    const radius = r.float();
    this.setCircle(cx, cz, radius);
    if (v.type === '0002') this.readFeather(r);
  }
}

export class BoundaryRectangle extends Boundary {
  rect: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  inner: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  useTransform = false;
  readonly transform = new Transform2d();
  localWaterTable = false;
  localGlobalWaterTable = false;
  localWaterTableHeight = 0;
  localWaterTableShaderSize = 2;
  localWaterTableShaderTemplateName = '';
  waterType = 0;

  constructor() {
    super('BREC');
  }

  recalculate(): void {
    const r = this.rect;
    if (r.x0 > r.x1) [r.x0, r.x1] = [r.x1, r.x0];
    if (r.y0 > r.y1) [r.y0, r.y1] = [r.y1, r.y0];
    const f = 0.5 * Math.min(r.x1 - r.x0, r.y1 - r.y0) * this.featherDistance;
    this.inner = { x0: r.x0 + f, y0: r.y0 + f, x1: r.x1 - f, y1: r.y1 - f };
  }

  override setCenter(x: number, z: number): void {
    this.useTransform = true;
    this.transform.tx = x;
    this.transform.ty = z;
  }

  override setRotation(angle: number): void {
    this.useTransform = true;
    this.transform.resetRotate();
    this.transform.yaw(angle);
  }

  isWithin(worldX: number, worldZ: number): number {
    if (this.useTransform) {
      const lx = this.transform.p2lX(worldX, worldZ);
      const lz = this.transform.p2lY(worldX, worldZ);
      worldX = lx;
      worldZ = lz;
    }
    const r = this.rect;
    if (!rectIsWithin(r, worldX, worldZ)) return 0;
    if (this.featherDistance === 0) return 1;
    if (rectIsWithin(this.inner, worldX, worldZ)) return 1;
    const f = 0.5 * Math.min(r.x1 - r.x0, r.y1 - r.y0) * this.featherDistance;
    let distance = f;
    const left = worldX - r.x0;
    const right = r.x1 - worldX;
    const top = worldZ - r.y0;
    const bottom = r.y1 - worldZ;
    if (left < distance) distance = left;
    if (right < distance) distance = right;
    if (top < distance) distance = top;
    if (bottom < distance) distance = bottom;
    return distance / f;
  }

  intersects(o: Rect): boolean {
    if (this.useTransform) return rectIntersects(this.transform.p2lRect(o), this.rect);
    return rectIntersects(o, this.rect);
  }

  expand(r: Rect): void {
    if (this.useTransform) {
      const cx = (this.rect.x0 + this.rect.x1) * 0.5;
      const cz = (this.rect.y0 + this.rect.y1) * 0.5;
      const m = Math.max(Math.hypot(this.rect.x0 - cx, this.rect.y0 - cz), Math.hypot(this.rect.x1 - cx, this.rect.y1 - cz));
      rectExpand(r, this.transform.tx - m, this.transform.ty - m);
      rectExpand(r, this.transform.tx + m, this.transform.ty + m);
    } else {
      rectExpand(r, this.rect.x0, this.rect.y0);
      rectExpand(r, this.rect.x1, this.rect.y1);
    }
  }

  override scanConvert(map: Float32Array, scanArea: Rect, numberOfPoles: number): void {
    if (this.useTransform) {
      super.scanConvert(map, scanArea, numberOfPoles);
      return;
    }
    if (!rectIntersects(this.rect, scanArea)) return;
    const real2Sample = (numberOfPoles - 1) / (scanArea.y1 - scanArea.y0);
    const rx0 = (this.rect.x0 - scanArea.x0) * real2Sample;
    const ry0 = (this.rect.y0 - scanArea.y0) * real2Sample;
    const rx1 = (this.rect.x1 - scanArea.x0) * real2Sample;
    const ry1 = (this.rect.y1 - scanArea.y0) * real2Sample;
    const zmin = Math.max(0, Math.ceil(ry0));
    const zmax = Math.min(numberOfPoles - 1, Math.floor(ry1));
    if (zmax < zmin) return;
    const xmin = Math.max(0, Math.ceil(rx0));
    const xmax = Math.min(numberOfPoles - 1, Math.floor(rx1));
    if (xmax < xmin) return;
    const fd = this.featherDistance;
    let z = zmin;
    if (fd === 0) {
      for (; z <= zmax; z++) {
        const row = z * numberOfPoles;
        for (let x = xmin; x <= xmax; x++) map[row + x] = 1;
      }
      return;
    }
    const maxFeather = 0.5 * Math.min(rx1 - rx0, ry1 - ry0) * fd;
    const put = (row: number, x: number, f: number) => {
      const amount = feather(this.featherFunction, f / maxFeather);
      if (amount > map[row + x]) map[row + x] = amount;
    };
    let zchange = Math.floor(ry0 + maxFeather);
    if (zchange >= zmin) {
      if (zchange > zmax) zchange = zmax;
      for (; z <= zchange; z++) {
        const zf = z - ry0;
        const row = z * numberOfPoles;
        for (let x = xmin; x <= xmax; x++) put(row, x, Math.min(Math.min(x - rx0, rx1 - x), zf));
      }
    }
    zchange = Math.floor(ry1 - maxFeather);
    if (zchange > zmax) zchange = zmax;
    for (; z <= zchange; z++) {
      const row = z * numberOfPoles;
      for (let x = xmin; x <= xmax; x++) {
        const xf = Math.min(x - rx0, rx1 - x);
        if (xf / maxFeather > 1) map[row + x] = 1;
        else put(row, x, xf);
      }
    }
    for (; z <= zmax; z++) {
      const zf = ry1 - z;
      const row = z * numberOfPoles;
      for (let x = xmin; x <= xmax; x++) put(row, x, Math.min(Math.min(x - rx0, rx1 - x), zf));
    }
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const r = new ChunkReader(chunkChild(v, 'DATA')!.data);
    const version = Number.parseInt(v.type, 10);
    if (version === 1) r.float();
    this.rect = { x0: r.float(), y0: r.float(), x1: r.float(), y1: r.float() };
    if (version >= 2) this.readFeather(r);
    if (version >= 3) {
      this.localWaterTable = r.int32() !== 0;
      this.localGlobalWaterTable = r.int32() !== 0;
      this.localWaterTableHeight = r.float();
      this.localWaterTableShaderSize = r.float();
      this.localWaterTableShaderTemplateName = r.string();
    }
    if (version >= 4) this.waterType = r.int32();
    this.recalculate();
  }
}

abstract class BoundaryPoly extends Boundary {
  points: { x: number; y: number }[] = [];
  extent: Rect = emptyRect();

  recalculate(): void {
    this.extent = emptyRect();
    for (const p of this.points) rectExpand(this.extent, p.x, p.y);
  }

  intersects(o: Rect): boolean {
    return rectIntersects(o, this.extent);
  }

  expand(r: Rect): void {
    rectExpand(r, this.extent.x0, this.extent.y0);
    rectExpand(r, this.extent.x1, this.extent.y1);
  }

  protected readPoints(r: ChunkReader, counted: boolean): void {
    const n = counted ? r.int32() : Math.floor(r.remaining / 8);
    for (let i = 0; i < n; i++) this.points.push({ x: r.float(), y: r.float() });
  }
}

export class BoundaryPolygon extends BoundaryPoly {
  localWaterTable = false;
  localWaterTableHeight = 0;
  localWaterTableShaderSize = 2;
  localWaterTableShaderTemplateName = '';
  waterType = 0;

  constructor() {
    super('BPOL');
  }

  isWithin(worldX: number, worldZ: number): number {
    if (!rectIsWithin(this.extent, worldX, worldZ)) return 0;
    const pts = this.points;
    const n = pts.length;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const pi = pts[i];
      const pj = pts[j];
      if (((pi.y <= worldZ && worldZ < pj.y) || (pj.y <= worldZ && worldZ < pi.y)) && worldX < ((pj.x - pi.x) * (worldZ - pi.y)) / (pj.y - pi.y) + pi.x) inside = !inside;
    }
    if (!inside) return 0;
    if (this.featherDistance === 0) return 1;
    const fd2 = sqr(this.featherDistance);
    let d2 = fd2;
    for (const p of pts) {
      const t = sqr(worldX - p.x) + sqr(worldZ - p.y);
      if (t < d2) d2 = t;
    }
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x1 = pts[j].x;
      const y1 = pts[j].y;
      const x2 = pts[i].x;
      const y2 = pts[i].y;
      const u = ((worldX - x1) * (x2 - x1) + (worldZ - y1) * (y2 - y1)) / (sqr(x1 - x2) + sqr(y1 - y2));
      if (u >= 0 && u <= 1) {
        const x = x1 + u * (x2 - x1);
        const y = y1 + u * (y2 - y1);
        const t = sqr(worldX - x) + sqr(worldZ - y);
        if (t < d2) d2 = t;
      }
    }
    if (Math.abs(fd2 - d2) > 0.0001) return Math.sqrt(d2) / this.featherDistance;
    return 1;
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const r = new ChunkReader(chunkChild(v, 'DATA')!.data);
    const version = Number.parseInt(v.type, 10);
    switch (version) {
      case 0:
        this.readPoints(r, false);
        break;
      case 1:
        r.float();
        this.readPoints(r, false);
        break;
      case 2:
        this.readFeather(r);
        this.readPoints(r, false);
        break;
      case 3:
      case 4:
        this.readFeather(r);
        this.localWaterTable = r.int32() !== 0;
        this.localWaterTableHeight = r.float();
        if (version === 4) this.localWaterTableShaderSize = r.float();
        this.localWaterTableShaderTemplateName = r.string();
        this.readPoints(r, false);
        break;
      default:
        this.readPoints(r, true);
        this.readFeather(r);
        this.localWaterTable = r.int32() !== 0;
        this.localWaterTableHeight = r.float();
        this.localWaterTableShaderSize = r.float();
        if (version === 6) r.int32();
        if (version >= 7) this.waterType = r.int32();
        this.localWaterTableShaderTemplateName = r.string();
        break;
    }
    this.recalculate();
  }
}

export class BoundaryPolyline extends BoundaryPoly {
  width = 2;

  constructor() {
    super('BPLN');
  }

  override recalculate(): void {
    super.recalculate();
    this.extent.x0 -= this.width;
    this.extent.x1 += this.width;
    this.extent.y0 -= this.width;
    this.extent.y1 += this.width;
  }

  isWithin(worldX: number, worldZ: number): number {
    if (!rectIsWithin(this.extent, worldX, worldZ)) return 0;
    const w2 = sqr(this.width);
    let d2 = w2;
    const pts = this.points;
    for (const p of pts) {
      const t = sqr(worldX - p.x) + sqr(worldZ - p.y);
      if (t < d2) d2 = t;
    }
    for (let i = 0; i < pts.length - 1; ++i) {
      const x1 = pts[i].x;
      const y1 = pts[i].y;
      const x2 = pts[i + 1].x;
      const y2 = pts[i + 1].y;
      const u = ((worldX - x1) * (x2 - x1) + (worldZ - y1) * (y2 - y1)) / (sqr(x2 - x1) + sqr(y2 - y1));
      if (u >= 0 && u <= 1) {
        const x = x1 + u * (x2 - x1);
        const y = y1 + u * (y2 - y1);
        const t = sqr(worldX - x) + sqr(worldZ - y);
        if (t < d2) d2 = t;
      }
    }
    if (d2 < w2) {
      const nf = this.width * (1 - this.featherDistance);
      if (d2 < sqr(nf)) return 1;
      return 1 - (Math.sqrt(d2) - nf) / (this.width - nf);
    }
    return 0;
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const r = new ChunkReader(chunkChild(v, 'DATA')!.data);
    const version = Number.parseInt(v.type, 10);
    if (version === 0) {
      this.readFeather(r);
      this.width = r.float();
      this.readPoints(r, false);
    } else {
      this.readPoints(r, true);
      if (version === 2) {
        const n = r.int32();
        for (let i = 0; i < n; i++) r.float();
      }
      this.readFeather(r);
      this.width = r.float();
      if (version === 2) r.int32();
    }
    this.recalculate();
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export abstract class Filter extends LayerItem {
  featherFunction = 0;
  featherDistance = 0;

  abstract isWithin(worldX: number, worldZ: number, x: number, z: number, d: ChunkData): number;

  needsNormals(): boolean {
    return false;
  }

  needsShaders(): boolean {
    return false;
  }

  prepare(): void {}

  protected readFeather(r: ChunkReader): void {
    this.featherFunction = r.int32();
    this.featherDistance = clamp(0, r.float(), 1);
  }
}

export class FilterHeight extends Filter {
  low = 0;
  high = 0;

  constructor() {
    super('FHGT');
  }

  isWithin(_wx: number, _wz: number, x: number, z: number, d: ChunkData): number {
    return featheredInterpolant(this.low, d.heightMap[z * d.numberOfPoles + x], this.high, this.featherDistance);
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const r = new ChunkReader(chunkChild(v, 'DATA')!.data);
    if (v.type === '0001') r.float();
    this.low = r.float();
    this.high = r.float();
    if (v.type === '0002') this.readFeather(r);
  }
}

export class FilterFractal extends Filter {
  familyId = 0;
  scaleY = 1;
  low = 0;
  high = 0;
  private fractal: MultiFractal | null = null;
  private cachedFamilyId = -1;

  constructor() {
    super('FFRA');
  }

  isWithin(wx: number, wz: number, _x: number, _z: number, d: ChunkData): number {
    if (this.cachedFamilyId !== this.familyId) {
      this.cachedFamilyId = this.familyId;
      this.fractal = d.fractalGroup.get(this.familyId) ?? null;
    }
    const v = this.scaleY * (this.fractal ? this.fractal.value2(wx, wz) : 0);
    return featheredInterpolant(this.low, v, this.high, this.featherDistance);
  }

  load(form: IffForm, group: FractalGroup): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const version = Number.parseInt(v.type, 10);
    if (version <= 3) {
      const r = new ChunkReader(chunkChild(v, 'DATA')!.data);
      const mf = new MultiFractal();
      if (version === 0) {
        mf.setCombinationRule(r.int32());
        mf.setSeed(r.uint32());
        const s = r.vector();
        mf.setScale(s.x, s.z);
        this.scaleY = s.y;
        this.low = r.float();
        this.high = r.float();
      } else {
        if (version === 2) r.float();
        if (version === 3) this.readFeather(r);
        this.low = r.float();
        this.high = r.float();
        readLegacyFractal(r, mf, (sy) => (this.scaleY = sy));
      }
      this.familyId = group.createFamily(mf, this.name);
      return;
    }
    const data = formChild(v, 'DATA')!;
    const r = new ChunkReader(chunkChild(data, 'PARM')!.data);
    if (version === 4) {
      const mf = new MultiFractal();
      loadMultiFractal(formChild(data, 'MFRC'), mf);
      this.familyId = group.createFamily(mf, this.name);
    } else {
      this.familyId = r.int32();
    }
    this.readFeather(r);
    this.low = r.float();
    this.high = r.float();
    this.scaleY = r.float();
  }
}

/** Old inline fractal record shared by fractal filters/affectors version 1-3. */
function readLegacyFractal(r: ChunkReader, mf: MultiFractal, setScaleY: (v: number) => void): void {
  mf.setCombinationRule(r.int32());
  mf.setNumberOfOctaves(r.int32());
  mf.setFrequency(r.float());
  let sx = 0;
  let sz = 0;
  const n = r.int32();
  for (let i = 0; i < n; i++) {
    r.int32();
    sx = r.float();
    sz = r.float();
  }
  mf.setSeed(r.uint32());
  for (let i = 0; i < mf.numberOfOctaves; i++) {
    r.int32();
    r.int32();
  }
  setScaleY(r.float());
  mf.setScale(sx, sz);
}

export class FilterSlope extends Filter {
  minimumAngle = 0;
  maximumAngle = 0;
  sinMin = 1;
  sinMax = 1;

  constructor() {
    super('FSLP');
  }

  setMinimumAngle(a: number): void {
    this.minimumAngle = clamp(0, a, Math.PI / 2);
    this.sinMin = Math.sin(Math.PI / 2 - this.minimumAngle);
  }

  setMaximumAngle(a: number): void {
    this.maximumAngle = clamp(0, a, Math.PI / 2);
    this.sinMax = Math.sin(Math.PI / 2 - this.maximumAngle);
  }

  override needsNormals(): boolean {
    return true;
  }

  isWithin(_wx: number, _wz: number, x: number, z: number, d: ChunkData): number {
    return featheredInterpolant(this.sinMax, d.normalMap[(z * d.numberOfPoles + x) * 3 + 1], this.sinMin, this.featherDistance);
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const r = new ChunkReader(chunkChild(v, 'DATA')!.data);
    if (v.type === '0001') r.float();
    this.setMinimumAngle((r.float() * Math.PI) / 180);
    this.setMaximumAngle((r.float() * Math.PI) / 180);
    if (v.type === '0002') this.readFeather(r);
  }
}

export class FilterDirection extends Filter {
  minimumFeatherAngle = 0;
  maximumFeatherAngle = 0;

  constructor() {
    super('FDIR');
  }

  override needsNormals(): boolean {
    return true;
  }

  isWithin(_wx: number, _wz: number, x: number, z: number, d: ChunkData): number {
    const i = (z * d.numberOfPoles + x) * 3;
    const theta = Math.atan2(d.normalMap[i], d.normalMap[i + 2]) / (Math.PI * 2) + 0.5;
    if (theta < this.minimumFeatherAngle || theta > this.maximumFeatherAngle) return 0;
    const fa = (this.maximumFeatherAngle - this.minimumFeatherAngle) * this.featherDistance * 0.5;
    if (theta >= this.minimumFeatherAngle + fa && theta <= this.maximumFeatherAngle - fa) return 1;
    let angle = fa;
    const maxA = this.maximumFeatherAngle - theta;
    const minA = theta - this.minimumFeatherAngle;
    if (maxA < angle) angle = maxA;
    if (minA < angle) angle = minA;
    return angle / fa;
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const r = new ChunkReader(chunkChild(v, 'DATA')!.data);
    this.minimumFeatherAngle = Math.max(-Math.PI, (r.float() * Math.PI) / 180) / (Math.PI * 2);
    this.maximumFeatherAngle = Math.min(Math.PI, (r.float() * Math.PI) / 180) / (Math.PI * 2);
    this.readFeather(r);
  }
}

export class FilterShader extends Filter {
  familyId = 0;

  constructor() {
    super('FSHD');
  }

  override needsShaders(): boolean {
    return true;
  }

  isWithin(_wx: number, _wz: number, x: number, z: number, d: ChunkData): number {
    return d.shaderMap[z * d.numberOfPoles + x] === this.familyId ? 1 : 0;
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    this.familyId = new ChunkReader(chunkChild(v, 'DATA')!.data).int32();
  }
}

/**
 * Bitmap filter: samples a greyscale image stretched over the layer's boundary extent
 * (bilinear, rows bottom-up in world Z) and scales the feathered range test by the value.
 * Without the image the engine treats the filter as fully within, and so do we.
 */
export class FilterBitmap extends Filter {
  familyId = 0;
  low = 0;
  high = 0;
  gain = 0;
  /** The owning layer's extent, set by Layer.affect before sampling (FilterBitmap::setExtent). */
  extent: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };

  constructor() {
    super('FBIT');
  }

  isWithin(wx: number, wz: number, _x: number, _z: number, d: ChunkData): number {
    const image = d.bitmapGroup.image(this.familyId);
    if (!image) return 1;
    const W = image.width;
    const H = image.height;
    const ex = this.extent.x1 - this.extent.x0;
    const ez = this.extent.y1 - this.extent.y0;
    const sx = Math.min(((wx - this.extent.x0) * W) / ex, W - 1);
    const sz = Math.min(((wz - this.extent.y0) * H) / ez, H - 1);
    const x0 = Math.max(0, Math.trunc(sx));
    const y0 = Math.max(0, Math.trunc(sz));
    const x1 = Math.min(x0 + 1, W - 1);
    const y1 = Math.min(y0 + 1, H - 1);
    const data = image.data;
    const v00 = data[(H - 1 - y0) * W + x0] / 255;
    const v10 = data[(H - 1 - y0) * W + x1] / 255;
    const v01 = data[(H - 1 - y1) * W + x0] / 255;
    const v11 = data[(H - 1 - y1) * W + x1] / 255;
    const dx1 = sx - Math.trunc(sx);
    const dx2 = 1 - dx1;
    const dy1 = sz - Math.trunc(sz);
    const dy2 = 1 - dy1;
    let h = v00 * (dx2 * dy2) + v10 * (dx1 * dy2) + v01 * (dx2 * dy1) + v11 * (dx1 * dy1);
    h += this.gain;
    if (h < 0) h = 0;
    else if (h >= 1) h = 0.99999;
    return featheredInterpolant(this.low, h, this.high, this.featherDistance) * h;
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const r = new ChunkReader(chunkChild(formChild(v, 'DATA')!, 'PARM')!.data);
    this.familyId = r.int32();
    this.readFeather(r);
    this.low = r.float();
    this.high = r.float();
    if (v.type === '0001') this.gain = r.float();
  }
}

// ---------------------------------------------------------------------------
// Affectors
// ---------------------------------------------------------------------------

export const Operation = { replace: 0, add: 1, subtract: 2, multiply: 3 } as const;

export abstract class Affector extends LayerItem {
  abstract affect(worldX: number, worldZ: number, x: number, z: number, amount: number, d: ChunkData): void;

  affectsHeight(): boolean {
    return false;
  }

  affectsShader(): boolean {
    return false;
  }

  prepare(): void {}
}

/** Parsed but inert: colour, flora and passable affectors do not change the ground. */
export class AffectorInert extends Affector {
  affect(): void {}

  load(form: IffForm): void {
    const v = form.children[0];
    if (v && isForm(v)) this.loadHeader(v);
  }
}

/**
 * AffectorFloraStatic (AFSC collidable, AFSN non-collidable): marks poles with a flora family.
 * Whether a pole gets flora is decided by a random number seeded from the pole's world position,
 * so every client and server plants the same trees.
 */
export class AffectorFloraStatic extends Affector {
  familyId = 0;
  operation = Operation.add as number;
  removeAll = false;
  densityOverride = false;
  densityOverrideDensity = 1;

  constructor(tag: 'AFSC' | 'AFSN') {
    super(tag);
  }

  affect(wx: number, wz: number, x: number, z: number, amount: number, d: ChunkData): void {
    if (amount <= 0) return;
    const map = this.tag === 'AFSC' ? d.floraCollidable : d.floraNonCollidable;
    const i = (z * d.numberOfPoles + x) * 2;
    if (this.removeAll) {
      map[i] = 0;
      map[i + 1] = 0;
      return;
    }
    const family = d.floraGroup.families.get(this.familyId);
    if (!family || this.familyId === 0) return;
    const density = this.densityOverride ? this.densityOverrideDensity : family.density;
    const rng = new FastRandomGenerator(hashTuple(wx, wz));
    const rf = rng.randomFloat();
    if (rf > amount * density) return;
    if (this.operation === Operation.add) {
      map[i] = this.familyId;
      map[i + 1] = Math.floor(rng.randomFloat() * 255);
    } else if (this.operation === Operation.replace) {
      // Replace is a removal of one family.
      if (map[i] === this.familyId) {
        map[i] = 0;
        map[i + 1] = 0;
      }
    }
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const version = Number.parseInt(v.type, 10);
    const r = new ChunkReader(chunkChild(v, 'DATA')!.data);
    this.familyId = r.int32();
    if (version >= 2) this.operation = r.int32();
    if (version >= 3) this.removeAll = r.int32() !== 0;
    if (version >= 4) {
      this.densityOverride = r.int32() !== 0;
      this.densityOverrideDensity = r.float();
    }
  }
}

export class AffectorExclude extends Affector {
  constructor() {
    super('AEXC');
  }

  affect(_wx: number, _wz: number, x: number, z: number, amount: number, d: ChunkData): void {
    if (amount > 0) d.excludeMap[z * d.numberOfPoles + x] = 1;
  }

  load(form: IffForm): void {
    this.loadHeader(form.children[0] as IffForm);
  }
}

function applyOperation(op: number, old: number, value: number, amount: number): number {
  switch (op) {
    case Operation.add:
      return old + amount * value;
    case Operation.subtract:
      return old - amount * value;
    case Operation.multiply:
      return lerp(old, old * value, amount);
    default:
      // amount * new + (1 - amount) * old, kept in this form so amount 1 lands exactly on the value
      return amount * value + (1 - amount) * old;
  }
}

export class AffectorHeightConstant extends Affector {
  operation = Operation.replace as number;
  height = 0;

  constructor() {
    super('AHCN');
  }

  override affectsHeight(): boolean {
    return true;
  }

  affect(_wx: number, _wz: number, x: number, z: number, amount: number, d: ChunkData): void {
    if (amount > 0) {
      const i = z * d.numberOfPoles + x;
      d.heightMap[i] = applyOperation(this.operation, d.heightMap[i], this.height, amount);
    }
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const r = new ChunkReader(chunkChild(v, 'DATA')!.data);
    this.operation = r.int32();
    this.height = r.float();
  }
}

export class AffectorHeightFractal extends Affector {
  operation = Operation.replace as number;
  familyId = 0;
  scaleY = 1;
  private fractal: MultiFractal | null = null;
  private cachedFamilyId = -1;

  constructor() {
    super('AHFR');
  }

  override affectsHeight(): boolean {
    return true;
  }

  affect(wx: number, wz: number, x: number, z: number, amount: number, d: ChunkData): void {
    if (amount > 0) {
      if (this.cachedFamilyId !== this.familyId) {
        this.cachedFamilyId = this.familyId;
        this.fractal = d.fractalGroup.get(this.familyId) ?? null;
      }
      const value = this.scaleY * (this.fractal ? this.fractal.value2(wx, wz) : 0);
      const i = z * d.numberOfPoles + x;
      d.heightMap[i] = applyOperation(this.operation, d.heightMap[i], value, amount);
    }
  }

  load(form: IffForm, group: FractalGroup): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const version = Number.parseInt(v.type, 10);
    if (version <= 1) {
      const r = new ChunkReader(chunkChild(v, 'DATA')!.data);
      const mf = new MultiFractal();
      this.operation = r.int32();
      if (version === 0) {
        mf.setCombinationRule(r.int32());
        mf.setSeed(r.uint32());
        const s = r.vector();
        mf.setScale(s.x, s.z);
        this.scaleY = s.y;
      } else {
        readLegacyFractal(r, mf, (sy) => (this.scaleY = sy));
      }
      this.familyId = group.createFamily(mf, this.name);
      return;
    }
    const data = formChild(v, 'DATA')!;
    const r = new ChunkReader(chunkChild(data, 'PARM')!.data);
    if (version === 2) {
      const mf = new MultiFractal();
      loadMultiFractal(formChild(data, 'MFRC'), mf);
      this.familyId = group.createFamily(mf, this.name);
    } else {
      this.familyId = r.int32();
    }
    this.operation = r.int32();
    this.scaleY = r.float();
  }
}

export class AffectorHeightTerrace extends Affector {
  height = 20;
  fraction = 0.25;

  constructor() {
    super('AHTR');
  }

  override affectsHeight(): boolean {
    return true;
  }

  affect(_wx: number, _wz: number, x: number, z: number, amount: number, d: ChunkData): void {
    if (amount > 0 && this.height > 0) {
      const th = this.height;
      const i = z * d.numberOfPoles + x;
      const original = d.heightMap[i];
      const low = original - (original < 0 ? th + (original % th) : original % th);
      const mid = low + th * this.fraction;
      const high = low + th;
      let h = low;
      if (original > mid) h = lerp(low, high, (original - mid) / (high - mid));
      d.heightMap[i] = lerp(original, h, amount);
    }
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    if (v.type === '0003') {
      const r = new ChunkReader(chunkChild(formChild(v, 'DATA')!, 'PARM')!.data);
      this.fraction = r.float();
      this.height = r.float();
    } else {
      const r = new ChunkReader(chunkChild(v, 'DATA')!.data);
      this.fraction = r.float();
      this.height = r.float();
    }
  }
}

export class AffectorShaderConstant extends Affector {
  familyId = 0;
  useFeatherClampOverride = false;
  featherClampOverride = 1;

  constructor() {
    super('ASCN');
  }

  override affectsShader(): boolean {
    return true;
  }

  affect(_wx: number, _wz: number, x: number, z: number, amount: number, d: ChunkData): void {
    if (amount > 0) {
      const fc = this.useFeatherClampOverride ? this.featherClampOverride : d.shaderGroup.featherClamp(this.familyId);
      if (amount >= fc) d.shaderMap[z * d.numberOfPoles + x] = this.familyId;
    }
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const r = new ChunkReader(chunkChild(v, 'DATA')!.data);
    this.familyId = r.int32();
    if (v.type === '0001') {
      this.useFeatherClampOverride = r.int32() !== 0;
      this.featherClampOverride = r.float();
    }
  }
}

export class AffectorShaderReplace extends Affector {
  sourceFamilyId = 0;
  destinationFamilyId = 0;
  useFeatherClampOverride = false;
  featherClampOverride = 1;

  constructor() {
    super('ASRP');
  }

  override affectsShader(): boolean {
    return true;
  }

  affect(_wx: number, _wz: number, x: number, z: number, amount: number, d: ChunkData): void {
    if (amount > 0) {
      const i = z * d.numberOfPoles + x;
      if (d.shaderMap[i] === this.sourceFamilyId) {
        const fc = this.useFeatherClampOverride ? this.featherClampOverride : d.shaderGroup.featherClamp(this.destinationFamilyId);
        if (amount >= fc) d.shaderMap[i] = this.destinationFamilyId;
      }
    }
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const r = new ChunkReader(chunkChild(v, 'DATA')!.data);
    this.sourceFamilyId = r.int32();
    this.destinationFamilyId = r.int32();
    if (v.type === '0001') {
      this.useFeatherClampOverride = r.int32() !== 0;
      this.featherClampOverride = r.float();
    }
  }
}

/** AENV: marks poles with an environment family, exactly as ASCN marks them with a shader family. */
export class AffectorEnvironment extends Affector {
  familyId = 0;
  useFeatherClampOverride = false;
  featherClampOverride = 1;
  /** What was wrong with the affector when it loaded, for the generator's diagnostics. */
  loadNote: string | null = null;

  constructor() {
    super('AENV');
  }

  affect(_wx: number, _wz: number, x: number, z: number, amount: number, d: ChunkData): void {
    if (amount <= 0 || this.familyId === 0) return;
    const g = d.environmentGroup;
    const fc = this.useFeatherClampOverride ? this.featherClampOverride : g.featherClamp(this.familyId);
    if (amount < fc) return;
    const i = z * d.numberOfPoles + x;
    // A seasonal area goes to its own map; an ordinary area painted over it takes the pole back in
    // both, so the last write wins as it does in the client.
    if (g.isSeasonal(this.familyId)) d.seasonalMap[i] = this.familyId;
    else {
      d.environmentMap[i] = this.familyId;
      d.seasonalMap[i] = 0;
    }
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const data = chunkChild(v, 'DATA');
    if (!data) return;
    const r = new ChunkReader(data.data);
    const family = r.int32();
    if (family < 0 || family > 255) {
      // The map holds a byte per pole, so a family outside that range would wrap onto another area.
      this.loadNote = `AENV: family id ${family} out of range (area left unpainted)`;
      return;
    }
    this.familyId = family;
    if (r.remaining >= 8) {
      this.useFeatherClampOverride = r.int32() !== 0;
      this.featherClampOverride = r.float();
    }
  }
}

/** Baked road/river centre-line heights (HeightData): one list of points per polyline segment. */
class HeightData {
  segments: { x: number; y: number; z: number }[][] = [];

  load(form: IffForm | undefined): void {
    this.segments = [];
    if (!form) return;
    const v = form.children[0];
    if (!v) return;
    if (!isForm(v)) {
      const r = new ChunkReader(v.data);
      const seg: { x: number; y: number; z: number }[] = [];
      while (r.remaining >= 12) seg.push(r.vector());
      this.segments.push(seg);
      return;
    }
    for (const c of v.children) {
      if (isForm(c) || c.tag !== 'SGMT') continue;
      const r = new ChunkReader(c.data);
      const seg: { x: number; y: number; z: number }[] = [];
      while (r.remaining >= 12) seg.push(r.vector());
      this.segments.push(seg);
    }
  }

  point(segment: number, index: number): { x: number; y: number; z: number } {
    return this.segments[segment]?.[index] ?? { x: 0, y: 0, z: 0 };
  }

  numberOfPoints(segment: number): number {
    return this.segments[segment]?.length ?? 0;
  }

  /** Height along a segment at the given position (HeightData::Segment::find). */
  find(segment: number, px: number, pz: number): number | null {
    const pts = this.segments[segment];
    if (!pts || pts.length === 0) return null;
    const first = pts[0];
    const last = pts[pts.length - 1];
    px = clamp(Math.min(first.x, last.x), px, Math.max(first.x, last.x));
    pz = clamp(Math.min(first.z, last.z), pz, Math.max(first.z, last.z));
    const width = last.x - first.x;
    const height = last.z - first.z;
    const alongX = Math.abs(width) >= Math.abs(height);
    const forward = alongX ? width >= 0 : height >= 0;
    const n = pts.length;
    const at = (k: number) => (forward ? pts[k] : pts[n - 1 - k]);
    const key = (p: { x: number; z: number }) => (alongX ? p.x : p.z);
    const target = alongX ? px : pz;
    let cur = 0;
    let prev = 0;
    while (cur < n && key(at(cur)) < target) {
      prev = cur;
      cur++;
    }
    if (cur >= n) cur = n - 1;
    const a = at(prev);
    const b = at(cur);
    const den = key(b) - key(a);
    if (den === 0) return a.y;
    return lerp(a.y, b.y, (target - key(a)) / den);
  }
}

interface FindData {
  height: number;
  distanceToCenter: number;
  t: number;
  length: number;
}

/** Shared polyline-with-width logic of roads and rivers (AffectorBoundaryPoly). */
abstract class AffectorBoundaryPoly extends Affector {
  featherFunction = 0;
  featherDistance = 0.5;
  points: { x: number; y: number }[] = [];
  lengths: number[] = [];
  lengthTotals: number[] = [];
  width = 4;
  extent: Rect = emptyRect();
  readonly heightData = new HeightData();

  recalculate(): void {
    this.extent = emptyRect();
    for (const p of this.points) rectExpand(this.extent, p.x, p.y);
    this.extent.x0 -= this.width;
    this.extent.y0 -= this.width;
    this.extent.x1 += this.width;
    this.extent.y1 += this.width;
    this.lengths = [0];
    this.lengthTotals = [0];
    for (let i = 1; i < this.points.length; i++) {
      const l = Math.hypot(this.points[i].x - this.points[i - 1].x, this.points[i].y - this.points[i - 1].y);
      this.lengths.push(l);
      this.lengthTotals.push(l + this.lengthTotals[i - 1]);
    }
  }

  find(px: number, pz: number, width: number, result: FindData, ignoreHeight = false): boolean {
    const pts = this.points;
    if (pts.length === 0) return false;
    const w2 = width * width;
    let d2 = w2;
    for (let i = 0; i < pts.length; ++i) {
      const t = sqr(px - pts[i].x) + sqr(pz - pts[i].y);
      if (t < d2) {
        d2 = t;
        result.t = this.lengthTotals[i];
        result.height = i !== pts.length - 1 ? this.heightData.point(i, 0).y : this.heightData.point(i - 1, this.heightData.numberOfPoints(i - 1) - 1).y;
      }
    }
    let segmentIndex = 0;
    let rx = 0;
    let rz = 0;
    let searchHeightData = false;
    for (let i = 0; i < pts.length - 1; ++i) {
      const s = pts[i];
      const e = pts[i + 1];
      const t = ((px - s.x) * (e.x - s.x) + (pz - s.y) * (e.y - s.y)) / (sqr(e.x - s.x) + sqr(e.y - s.y));
      if (t >= 0 && t <= 1) {
        const lx = s.x + (e.x - s.x) * t;
        const lz = s.y + (e.y - s.y) * t;
        const td2 = sqr(px - lx) + sqr(pz - lz);
        if (td2 < d2) {
          d2 = td2;
          segmentIndex = i;
          rx = lx;
          rz = lz;
          if (!ignoreHeight) searchHeightData = true;
          result.t = this.lengthTotals[i] + t * this.lengths[i + 1];
        }
      }
    }
    if (d2 < w2) {
      result.distanceToCenter = Math.sqrt(d2);
      result.length = this.lengthTotals[this.lengthTotals.length - 1];
      if (searchHeightData) {
        const h = this.heightData.find(segmentIndex, rx, rz);
        result.height = h ?? 0;
      }
      return true;
    }
    return false;
  }

  protected readPoints(r: ChunkReader, n: number): void {
    for (let i = 0; i < n; i++) this.points.push({ x: r.float(), y: r.float() });
  }
}

export class AffectorRoad extends AffectorBoundaryPoly {
  familyId = 0;
  featherFunctionShader = 0;
  featherDistanceShader = 0.5;
  hasFixedHeights = false;
  heightList: number[] = [];
  private readonly scratch: FindData = { height: 0, distanceToCenter: 0, t: 0, length: 0 };

  constructor() {
    super('AROA');
  }

  override affectsHeight(): boolean {
    return true;
  }

  override affectsShader(): boolean {
    return true;
  }

  affect(wx: number, wz: number, x: number, z: number, amount: number, d: ChunkData): void {
    if (amount <= 0 || !rectIsWithin(this.extent, wx, wz)) return;
    const width2 = this.width * 0.5;
    const i = z * d.numberOfPoles + x;
    const original = d.heightMap[i];
    const result = this.scratch;
    if (!this.find(wx, wz, width2, result)) return;
    const dist = Math.abs(result.distanceToCenter);
    const desired = result.height;
    if (dist >= 0 && dist <= width2 * (1 - this.featherDistance)) {
      d.heightMap[i] = this.hasFixedHeights ? this.rampedHeight(wx, wz, original) : desired;
    } else {
      const t = dist / width2;
      d.heightMap[i] = this.hasFixedHeights ? this.rampedHeight(wx, wz, original) : lerp(desired, original, t);
    }
    if (dist >= 0 && dist <= width2 * (1 - this.featherDistanceShader)) d.shaderMap[i] = this.familyId;
  }

  private rampedHeight(wx: number, wz: number, terrainHeight: number): number {
    if (!rectIsWithin(this.extent, wx, wz)) return -100;
    const pts = this.points;
    const half = this.width / 2;
    const w2 = half * half;
    let d2 = w2;
    let found = -1;
    for (let i = 0; i < pts.length; ++i) {
      const t = sqr(wx - pts[i].x) + sqr(wz - pts[i].y);
      if (t < d2) {
        d2 = t;
        found = i;
      }
    }
    for (let i = 0; i < pts.length - 1; ++i) {
      const x1 = pts[i].x;
      const y1 = pts[i].y;
      const x2 = pts[i + 1].x;
      const y2 = pts[i + 1].y;
      const u = ((wx - x1) * (x2 - x1) + (wz - y1) * (y2 - y1)) / (sqr(x2 - x1) + sqr(y2 - y1));
      if (u >= 0 && u <= 1) {
        const t = sqr(wx - (x1 + u * (x2 - x1))) + sqr(wz - (y1 + u * (y2 - y1)));
        if (t < d2) {
          d2 = t;
          found = i;
        }
      }
    }
    if (d2 < w2 && found >= 0) {
      let featherMultiplier = 1;
      const nf = half * (1 - this.featherDistance);
      if (d2 >= nf * nf) featherMultiplier = feather(this.featherFunction, 1 - (Math.sqrt(d2) - nf) / (half - nf));
      const startHeight = this.heightList[found] ?? 0;
      let height = startHeight;
      if (found !== pts.length - 1) {
        const endHeight = this.heightList[found + 1] ?? 0;
        const p1 = pts[found];
        const p2 = pts[found + 1];
        const total = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const distToLine = Math.abs(dx * (wz - p1.y) - dy * (wx - p1.x)) / (total || 1);
        const d1 = Math.hypot(wx - p1.x, wz - p1.y);
        const d2p = Math.hypot(wx - p2.x, wz - p2.y);
        const proj1 = Math.sqrt(Math.max(0, d1 * d1 - distToLine * distToLine));
        const proj2 = Math.sqrt(Math.max(0, d2p * d2p - distToLine * distToLine));
        if (total !== 0 && proj1 <= total && proj2 <= total) height = startHeight + (proj1 / total) * (endHeight - startHeight);
      }
      return terrainHeight + (height - terrainHeight) * featherMultiplier;
    }
    return -100;
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const version = Number.parseInt(v.type, 10);
    if (version === 0) {
      this.recalculate();
      return;
    }
    let r: ChunkReader;
    if (version === 1) {
      r = new ChunkReader(chunkChild(v, 'DATA')!.data);
    } else {
      const data = formChild(v, 'DATA')!;
      this.heightData.load(formChild(data, 'ROAD') ?? formChild(data, 'HDTA'));
      r = new ChunkReader(chunkChild(data, 'DATA')!.data);
    }
    if (version <= 3) this.readPoints(r, 2);
    else {
      this.readPoints(r, r.int32());
      if (version === 6) {
        const n = r.int32();
        for (let i = 0; i < n; i++) this.heightList.push(r.float());
      }
    }
    this.width = r.float();
    if (version >= 3) {
      this.familyId = r.int32();
      this.featherFunction = r.int32();
      this.featherDistance = clamp(0, r.float(), 1);
      this.featherFunctionShader = this.featherFunction;
      this.featherDistanceShader = this.featherDistance;
    }
    if (version >= 5) {
      this.featherFunctionShader = r.int32();
      this.featherDistanceShader = clamp(0, r.float(), 1);
    }
    if (version === 6) this.hasFixedHeights = r.int32() !== 0;
    this.recalculate();
  }
}

export class AffectorRiver extends AffectorBoundaryPoly {
  bankFamilyId = 0;
  bottomFamilyId = 0;
  trenchDepth = 0;
  velocity = 0;
  hasLocalWaterTable = false;
  localWaterTableDepth = 2;
  localWaterTableWidth = 4;
  localWaterTableShaderSize = 2;
  localWaterTableShaderTemplateName = '';
  waterType = 0;
  readonly fractal = new MultiFractal();
  private readonly scratch: FindData = { height: 0, distanceToCenter: 0, t: 0, length: 0 };

  constructor() {
    super('ARIV');
    this.fractal.setScale(0.01);
    this.fractal.setGain(true, 0.9);
    this.fractal.setNumberOfOctaves(3);
  }

  override affectsHeight(): boolean {
    return true;
  }

  override affectsShader(): boolean {
    return true;
  }

  affect(wx: number, wz: number, x: number, z: number, amount: number, d: ChunkData): void {
    if (amount <= 0 || !rectIsWithin(this.extent, wx, wz)) return;
    const width2 = this.width * 0.5;
    const i = z * d.numberOfPoles + x;
    const original = d.heightMap[i];
    const result = this.scratch;
    if (!this.find(wx, wz, width2, result)) return;
    const dist = Math.abs(result.distanceToCenter);
    const desired = result.height - this.trenchDepth;
    const subWidth = width2 * this.fractal.value1(result.t);
    const f = subWidth * (1 - this.featherDistance);
    if (dist <= f) {
      d.heightMap[i] = desired;
      d.shaderMap[i] = this.bottomFamilyId;
    } else if (dist <= subWidth) {
      const t = dist / subWidth;
      d.heightMap[i] = lerp(desired, original, t * t);
      d.shaderMap[i] = this.bankFamilyId;
    }
  }

  load(form: IffForm): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const version = Number.parseInt(v.type, 10);
    const data = formChild(v, 'DATA')!;
    this.heightData.load(formChild(data, 'ROAD') ?? formChild(data, 'HDTA'));
    const r = new ChunkReader(chunkChild(data, 'DATA')!.data);
    if (version <= 3) this.readPoints(r, 2);
    else this.readPoints(r, r.int32());
    this.width = r.float();
    this.bankFamilyId = r.int32();
    this.bottomFamilyId = version >= 3 ? r.int32() : this.bankFamilyId;
    this.featherFunction = r.int32();
    this.featherDistance = clamp(0, r.float(), 1);
    if (version >= 1) {
      this.trenchDepth = r.float();
      this.velocity = r.float();
    }
    if (version >= 2) {
      this.hasLocalWaterTable = r.int32() !== 0;
      this.localWaterTableDepth = r.float();
    }
    if (version >= 5) this.localWaterTableWidth = r.float();
    else this.localWaterTableWidth = this.width;
    if (version >= 1) this.localWaterTableShaderSize = r.float();
    if (version >= 1) this.localWaterTableShaderTemplateName = r.string();
    if (version >= 6) this.waterType = r.int32();
    this.recalculate();
  }
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export class Layer extends LayerItem {
  invertBoundaries = false;
  invertFilters = false;
  boundaries: Boundary[] = [];
  filters: Filter[] = [];
  affectors: Affector[] = [];
  layers: Layer[] = [];
  extent: Rect = emptyRect();
  useExtent = false;
  modificationHeight = 0;
  private hasActiveBoundaries = false;
  private hasActiveFilters = false;
  private hasActiveAffectors = false;
  private hasActiveLayers = false;
  private hasUnprunedAffectors = false;
  private hasUnprunedLayers = false;

  constructor() {
    super('LAYR');
  }

  prepare(): void {
    this.hasActiveBoundaries = false;
    for (const b of this.boundaries) if (b.active) (this.hasActiveBoundaries = true), b.prepare();
    this.hasActiveFilters = false;
    for (const f of this.filters) if (f.active) (this.hasActiveFilters = true), f.prepare();
    this.hasActiveAffectors = false;
    for (const a of this.affectors) if (a.active) (this.hasActiveAffectors = true), a.prepare();
    this.hasActiveLayers = false;
    for (const l of this.layers) if (l.active) (this.hasActiveLayers = true), l.prepare();
  }

  calculateExtent(): void {
    this.useExtent = false;
    if (this.invertBoundaries) return;
    this.extent = emptyRect();
    for (const b of this.boundaries) {
      if (b.active) {
        this.useExtent = true;
        b.expand(this.extent);
      }
    }
    for (const l of this.layers) if (l.active) l.calculateExtent();
  }

  /** Mark what cannot touch this chunk (Layer::prune with every map requested). */
  prune(chunkExtent: Rect): boolean {
    this.hasUnprunedLayers = false;
    this.hasUnprunedAffectors = false;
    if (!this.hasActiveAffectors && !this.hasActiveLayers) {
      this.pruned = true;
      return true;
    }
    if (this.useExtent && !rectIntersects(this.extent, chunkExtent)) {
      this.pruned = true;
      return true;
    }
    if (this.hasActiveLayers) {
      for (let i = this.layers.length - 1; i >= 0; i--) if (!this.layers[i].prune(chunkExtent)) this.hasUnprunedLayers = true;
    }
    if (this.hasActiveAffectors) {
      for (let i = this.affectors.length - 1; i >= 0; i--) {
        const a = this.affectors[i];
        a.pruned = !a.active;
        if (!a.pruned) this.hasUnprunedAffectors = true;
      }
    }
    this.pruned = !this.hasUnprunedAffectors && !this.hasUnprunedLayers;
    return this.pruned;
  }

  /** How much this layer's boundaries admit a world point (1 inside, 0 outside, feathered between). */
  boundaryAmountAt(worldX: number, worldZ: number): number {
    let amount = 0;
    let any = false;
    for (const b of this.boundaries) {
      if (!b.active) continue;
      any = true;
      amount = Math.max(amount, b.isWithin(worldX, worldZ));
    }
    if (!any) amount = 1;
    return this.invertBoundaries ? 1 - amount : amount;
  }

  /** How much this layer's filters admit the probe pole (1 when it has none), for diagnostics. */
  filterAmountAt(worldX: number, worldZ: number, x: number, z: number, d: ChunkData): number {
    let amount = 1;
    for (const f of this.filters) {
      if (!f.active) continue;
      if (f instanceof FilterBitmap) f.extent = this.extent;
      amount = fuzzyAnd(amount, feather(f.featherFunction, f.isWithin(worldX, worldZ, x, z, d)));
    }
    return this.invertFilters ? 1 - amount : amount;
  }

  /** This layer's active rules with their key parameters, for diagnostics. */
  describeRules(): string {
    const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3));
    const fe = (it: { featherFunction: number; featherDistance: number }) => `f${it.featherFunction}/${num(it.featherDistance)}`;
    const b = this.boundaries.filter((i) => i.active).map((i) => {
      if (i instanceof BoundaryCircle) return `BCIR(${num(i.centerX)},${num(i.centerZ)} r${num(i.radius)} ${fe(i)})`;
      if (i instanceof BoundaryRectangle) return `BREC(${num(i.rect.x0)},${num(i.rect.y0)}..${num(i.rect.x1)},${num(i.rect.y1)} ${fe(i)})`;
      if (i instanceof BoundaryPolygon) return `BPOL(${i.points.length}pts ${fe(i)})`;
      if (i instanceof BoundaryPolyline) return `BPLN(${i.points.length}pts w${num(i.width)} ${fe(i)})`;
      return i.tag;
    });
    const f = this.filters.filter((i) => i.active).map((i) => {
      if (i instanceof FilterHeight) return `FHGT(${num(i.low)}..${num(i.high)} ${fe(i)})`;
      if (i instanceof FilterFractal) return `FFRA(fam ${i.familyId} x${num(i.scaleY)} ${num(i.low)}..${num(i.high)} ${fe(i)})`;
      if (i instanceof FilterSlope) return `FSLP(${num((i.minimumAngle * 180) / Math.PI)}..${num((i.maximumAngle * 180) / Math.PI)}deg ${fe(i)})`;
      if (i instanceof FilterBitmap) return `FBIT(fam ${i.familyId} ${num(i.low)}..${num(i.high)} ${fe(i)})`;
      return i.tag;
    });
    const a = this.affectors.filter((i) => i.active).map((i) => (i instanceof AffectorHeightConstant ? `AHCN(op ${i.operation} h ${num(i.height)})` : i instanceof AffectorHeightFractal ? `AHFR(op ${i.operation} fam ${i.familyId} x${num(i.scaleY)})` : i.tag));
    return [b.length ? `${this.invertBoundaries ? 'inverted ' : ''}bounds ${b.join(' ')}` : '', f.length ? `${this.invertFilters ? 'inverted ' : ''}filters ${f.join(' ')}` : '', a.length ? `affects ${a.join(' ')}` : ''].filter(Boolean).join('; ');
  }

  affect(previousAmountMap: Float32Array, d: ChunkData): void {
    if (this.hasActiveFilters) {
      for (const f of this.filters) {
        if (f.active && f.needsNormals()) {
          if (d.normalsDirty) {
            generateNormals(d);
            d.normalsDirty = false;
          }
          break;
        }
      }
    }
    const onlyHasSubLayers = !this.hasActiveBoundaries && !this.hasActiveFilters && !this.hasActiveAffectors;
    const n = d.numberOfPoles;
    let amountMap: Float32Array | null = null;
    if (this.hasActiveLayers && !onlyHasSubLayers) amountMap = new Float32Array(n * n);

    let shouldAffectSubLayers = onlyHasSubLayers;
    if (!onlyHasSubLayers) {
      let boundaryMap: Float32Array | null = null;
      if (this.hasActiveBoundaries) {
        for (const b of this.boundaries) {
          if (!b.active) continue;
          if (!boundaryMap) boundaryMap = new Float32Array(n * n);
          b.scanConvert(boundaryMap, d.extent, n);
        }
      }
      const invertBoundaries = this.invertBoundaries;
      const step = d.distanceBetweenPoles;
      for (let z = 0; z < n; z++) {
        const row = z * n;
        const worldZ = d.startZ + z * step;
        for (let x = 0; x < n; x++) {
          const worldX = d.startX + x * step;
          const previousAmount = previousAmountMap[row + x];
          let fuzzyTest = boundaryMap ? boundaryMap[row + x] : 1;
          if (invertBoundaries) fuzzyTest = 1 - fuzzyTest;
          if (fuzzyTest > 0) {
            if (this.hasActiveFilters) {
              for (const f of this.filters) {
                if (!f.active) continue;
                if (f instanceof FilterBitmap) f.extent = this.extent;
                const amount = f.isWithin(worldX, worldZ, x, z, d);
                fuzzyTest = fuzzyAnd(fuzzyTest, feather(f.featherFunction, amount));
                if (fuzzyTest === 0) break;
              }
            }
            if (this.invertFilters) fuzzyTest = 1 - fuzzyTest;
            if (fuzzyTest > 0) {
              shouldAffectSubLayers = true;
              if (this.hasUnprunedAffectors) {
                for (const a of this.affectors) {
                  if (a.pruned) continue;
                  a.affect(worldX, worldZ, x, z, fuzzyTest * previousAmount, d);
                  if (a.affectsHeight()) d.normalsDirty = true;
                }
              }
            }
          }
          if (amountMap) amountMap[row + x] = fuzzyTest * previousAmount;
        }
      }
    }
    if (d.trace && d.probeIndex !== undefined) d.trace(this, d.heightMap[d.probeIndex], d.traceDepth ?? 0);
    if (shouldAffectSubLayers && this.hasActiveLayers) {
      for (const l of this.layers) {
        if (l.pruned) continue;
        d.traceDepth = (d.traceDepth ?? 0) + 1;
        l.affect(onlyHasSubLayers ? previousAmountMap : amountMap!, d);
        d.traceDepth -= 1;
      }
    }
  }

  /** Every height-constant affector in the tree (used by building terrain modifications). */
  setModificationHeight(height: number): void {
    this.modificationHeight = height;
    for (const a of this.affectors) if (a.active && a instanceof AffectorHeightConstant) a.height = height;
    for (const l of this.layers) if (l.active) l.setModificationHeight(height);
  }

  setPosition(x: number, z: number): void {
    for (const b of this.boundaries) if (b.active) b.setCenter(x, z);
    for (const l of this.layers) if (l.active) l.setPosition(x, z);
  }

  setRotation(angle: number): void {
    for (const b of this.boundaries) if (b.active) b.setRotation(angle);
    for (const l of this.layers) if (l.active) l.setRotation(angle);
  }

  load(form: IffForm, group: FractalGroup): void {
    const v = form.children[0] as IffForm;
    if (!v) return;
    this.loadHeader(v);
    const version = Number.parseInt(v.type, 10);
    if (version === 0) {
      for (const c of v.children) {
        if (!isForm(c) || c.type !== 'ACTN') continue;
        const sub = new Layer();
        sub.loadAction(c, group);
        this.layers.push(sub);
      }
      return;
    }
    const adta = chunkChild(v, 'ADTA');
    if (adta) {
      const r = new ChunkReader(adta.data);
      this.invertBoundaries = r.int32() !== 0;
      this.invertFilters = r.int32() !== 0;
    }
    this.loadItems(v, group);
  }

  /** Old ACTN sub-layer blocks. */
  private loadAction(form: IffForm, group: FractalGroup): void {
    const v = form.children[0] as IffForm;
    this.loadHeader(v);
    const adta = chunkChild(v, 'ADTA');
    if (adta) {
      const r = new ChunkReader(adta.data);
      this.invertBoundaries = r.int32() !== 0;
      if (v.type === '0002') this.invertFilters = r.int32() !== 0;
    }
    this.loadItems(v, group);
  }

  private loadItems(v: IffForm, group: FractalGroup): void {
    for (const c of v.children) {
      if (!isForm(c)) continue;
      const name = nameOf(c);
      if (name === 'IHDR') continue;
      const item = loadLayerItem(c, group);
      if (item instanceof Boundary) this.boundaries.push(item);
      else if (item instanceof Filter) this.filters.push(item);
      else if (item instanceof Affector) this.affectors.push(item);
      else if (item instanceof Layer) this.layers.push(item);
    }
  }
}

const INERT_AFFECTORS = new Set(['ACCN', 'ACRH', 'ACRF', 'AFCN', 'ARCN', 'AFDN', 'AFDF', 'ARIB', 'APAS']);
const SKIPPED = new Set(['BALL', 'BSPL', 'AHSM', 'AHBM', 'ACBM', 'ASBM', 'AFBM']);

/** TerrainGeneratorLoader::loadLayerItem */
export function loadLayerItem(form: IffForm, group: FractalGroup): LayerItem | null {
  const t = form.type;
  if (SKIPPED.has(t)) return null;
  let item: LayerItem | null = null;
  switch (t) {
    case 'BCIR':
      item = new BoundaryCircle();
      (item as BoundaryCircle).load(form);
      break;
    case 'BREC':
      item = new BoundaryRectangle();
      (item as BoundaryRectangle).load(form);
      break;
    case 'BPOL':
      item = new BoundaryPolygon();
      (item as BoundaryPolygon).load(form);
      break;
    case 'BPLN':
      item = new BoundaryPolyline();
      (item as BoundaryPolyline).load(form);
      break;
    case 'FHGT':
      item = new FilterHeight();
      (item as FilterHeight).load(form);
      break;
    case 'FFRA':
      item = new FilterFractal();
      (item as FilterFractal).load(form, group);
      break;
    case 'FBIT':
      item = new FilterBitmap();
      (item as FilterBitmap).load(form);
      break;
    case 'FSLP':
      item = new FilterSlope();
      (item as FilterSlope).load(form);
      break;
    case 'FDIR':
      item = new FilterDirection();
      (item as FilterDirection).load(form);
      break;
    case 'FSHD':
      item = new FilterShader();
      (item as FilterShader).load(form);
      break;
    case 'AHCN':
      item = new AffectorHeightConstant();
      (item as AffectorHeightConstant).load(form);
      break;
    case 'AHFR':
      item = new AffectorHeightFractal();
      (item as AffectorHeightFractal).load(form, group);
      break;
    case 'AHTR':
      item = new AffectorHeightTerrace();
      (item as AffectorHeightTerrace).load(form);
      break;
    case 'ASCN':
      item = new AffectorShaderConstant();
      (item as AffectorShaderConstant).load(form);
      break;
    case 'ASRP':
      item = new AffectorShaderReplace();
      (item as AffectorShaderReplace).load(form);
      break;
    case 'AENV':
      item = new AffectorEnvironment();
      (item as AffectorEnvironment).load(form);
      break;
    case 'AEXC':
      item = new AffectorExclude();
      (item as AffectorExclude).load(form);
      break;
    case 'AFSC':
    case 'AFSN':
      item = new AffectorFloraStatic(t);
      (item as AffectorFloraStatic).load(form);
      break;
    case 'AROA':
      item = new AffectorRoad();
      (item as AffectorRoad).load(form);
      break;
    case 'ARIV':
      item = new AffectorRiver();
      (item as AffectorRiver).load(form);
      break;
    case 'LAYR': {
      const layer = new Layer();
      layer.load(form, group);
      item = layer;
      break;
    }
    default:
      if (INERT_AFFECTORS.has(t)) {
        item = new AffectorInert(t);
        (item as AffectorInert).load(form);
      }
      break;
  }
  return item;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export class TerrainGenerator {
  readonly shaderGroup = new ShaderGroup();
  readonly fractalGroup = new FractalGroup();
  readonly bitmapGroup = new BitmapGroup();
  readonly floraGroup = new FloraGroup();
  readonly environmentGroup = new EnvironmentGroup();
  layers: Layer[] = [];
  /** Names of layer item tags that were not understood, for diagnostics. */
  readonly unknownTags = new Map<string, number>();

  /** FORM TGEN > FORM 0000 > groups + LYRS */
  load(tgen: IffForm): void {
    const v = formChild(tgen, '0000');
    if (!v) throw new Error('TGEN: unsupported version');
    this.shaderGroup.load(formChild(v, 'SGRP'));
    // Both the fractal group and the bitmap group are tagged MGRP; the bitmap group comes second.
    const mgrps = v.children.filter((c): c is IffForm => isForm(c) && c.type === 'MGRP');
    this.fractalGroup.load(mgrps[0]);
    this.bitmapGroup.load(mgrps[1]);
    try {
      this.floraGroup.load(formChild(v, 'FGRP') ?? null);
    } catch (err) {
      this.unknownTags.set(`FGRP: ${(err as Error).message}`, 1);
    }
    try {
      this.environmentGroup.load(formChild(v, 'EGRP'));
    } catch (err) {
      this.unknownTags.set(`EGRP: ${(err as Error).message}`, 1);
    }
    const lyrs = formChild(v, 'LYRS');
    if (lyrs) {
      for (const c of lyrs.children) {
        if (!isForm(c) || c.type !== 'LAYR') continue;
        const layer = new Layer();
        layer.load(c, this.fractalGroup);
        this.layers.push(layer);
      }
    }
    this.noteEnvironment(this.layers);
    this.prepare();
  }

  /**
   * Take up what the environment affectors in a tree of layers reported while loading. A layer
   * file carries its own family list, which is not remapped onto the planet's, so its areas are
   * counted and then cleared: a family id from the file would otherwise be painted into the
   * planet's map with the planet's meaning.
   */
  noteEnvironment(layers: readonly Layer[], fromLayerFile = false): void {
    const note = (key: string) => this.unknownTags.set(key, (this.unknownTags.get(key) ?? 0) + 1);
    const walk = (l: Layer) => {
      for (const a of l.affectors) {
        if (!(a instanceof AffectorEnvironment)) continue;
        if (fromLayerFile) {
          note('AENV in a layer file (families not remapped)');
          a.familyId = 0;
        } else if (a.loadNote) note(a.loadNote);
      }
      for (const s of l.layers) walk(s);
    };
    for (const l of layers) walk(l);
  }

  prepare(): void {
    for (const l of this.layers) {
      l.prepare();
      l.calculateExtent();
    }
  }

  addLayer(layer: Layer): void {
    this.layers.push(layer);
  }

  removeLayer(layer: Layer): void {
    const i = this.layers.indexOf(layer);
    if (i >= 0) this.layers.splice(i, 1);
  }

  /** TerrainGenerator::generateChunk + affect: fills the chunk's maps. */
  generateChunk(d: ChunkData): void {
    d.heightMap.fill(0);
    d.shaderMap.fill(0);
    d.floraCollidable.fill(0);
    d.floraNonCollidable.fill(0);
    d.excludeMap.fill(0);
    d.environmentMap.fill(0);
    d.seasonalMap.fill(0);
    d.normalsDirty = true;
    const n = d.numberOfPoles;
    const amountMap = new Float32Array(n * n).fill(1);
    for (let i = this.layers.length - 1; i >= 0; i--) this.layers[i].prune(d.extent);
    d.traceDepth = 0;
    for (const l of this.layers) if (!l.pruned) l.affect(amountMap, d);
  }

  /** One line per layer item with its key parameters, for diagnostics. */
  describe(): string[] {
    const lines: string[] = [];
    const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3));
    const item = (it: LayerItem): string => {
      const on = it.active ? '' : ' [inactive]';
      if (it instanceof BoundaryCircle) return `BCIR ${it.name}${on} centre ${num(it.centerX)},${num(it.centerZ)} r ${num(it.radius)} feather ${it.featherFunction}/${num(it.featherDistance)}`;
      if (it instanceof BoundaryRectangle) return `BREC ${it.name}${on} ${num(it.rect.x0)},${num(it.rect.y0)} to ${num(it.rect.x1)},${num(it.rect.y1)} feather ${it.featherFunction}/${num(it.featherDistance)}${it.localWaterTable ? ` water ${num(it.localWaterTableHeight)}` : ''}`;
      if (it instanceof BoundaryPolygon) return `BPOL ${it.name}${on} ${it.points.length} pts extent ${num(it.extent.x0)},${num(it.extent.y0)} to ${num(it.extent.x1)},${num(it.extent.y1)} feather ${it.featherFunction}/${num(it.featherDistance)}${it.localWaterTable ? ` water ${num(it.localWaterTableHeight)}` : ''}`;
      if (it instanceof BoundaryPolyline) return `BPLN ${it.name}${on} ${it.points.length} pts width ${num(it.width)} extent ${num(it.extent.x0)},${num(it.extent.y0)} to ${num(it.extent.x1)},${num(it.extent.y1)} feather ${it.featherFunction}/${num(it.featherDistance)}`;
      if (it instanceof FilterHeight) return `FHGT ${it.name}${on} ${num(it.low)}..${num(it.high)} feather ${it.featherFunction}/${num(it.featherDistance)}`;
      if (it instanceof FilterFractal) return `FFRA ${it.name}${on} family ${it.familyId} x${num(it.scaleY)} ${num(it.low)}..${num(it.high)} feather ${it.featherFunction}/${num(it.featherDistance)}`;
      if (it instanceof FilterSlope) return `FSLP ${it.name}${on} ${num((it.minimumAngle * 180) / Math.PI)}..${num((it.maximumAngle * 180) / Math.PI)} deg feather ${it.featherFunction}/${num(it.featherDistance)}`;
      if (it instanceof FilterDirection) return `FDIR ${it.name}${on} ${num(it.minimumFeatherAngle)}..${num(it.maximumFeatherAngle)}`;
      if (it instanceof FilterShader) return `FSHD ${it.name}${on} family ${it.familyId}`;
      if (it instanceof FilterBitmap) return `FBIT ${it.name}${on} family ${it.familyId} ${num(it.low)}..${num(it.high)} gain ${num(it.gain)} image ${this.bitmapGroup.families.get(it.familyId)?.bitmapName ?? '?'}${this.bitmapGroup.image(it.familyId) ? '' : ' (missing: passes)'}`;
      if (it instanceof AffectorHeightConstant) return `AHCN ${it.name}${on} op ${it.operation} height ${num(it.height)}`;
      if (it instanceof AffectorHeightFractal) return `AHFR ${it.name}${on} op ${it.operation} family ${it.familyId} x${num(it.scaleY)}`;
      if (it instanceof AffectorHeightTerrace) return `AHTR ${it.name}${on} height ${num(it.height)} fraction ${num(it.fraction)}`;
      if (it instanceof AffectorRoad) return `AROA ${it.name}${on} ${it.points.length} pts width ${num(it.width)} heights ${it.heightData.segments.length} segs fixed ${it.hasFixedHeights} feather ${it.featherFunction}/${num(it.featherDistance)}`;
      if (it instanceof AffectorRiver) return `ARIV ${it.name}${on} ${it.points.length} pts width ${num(it.width)} trench ${num(it.trenchDepth)} heights ${it.heightData.segments.length} segs`;
      if (it instanceof AffectorEnvironment) {
        const fam = this.environmentGroup.families.get(it.familyId);
        return `AENV ${it.name}${on} family ${it.familyId}=${fam?.name ?? '?'}${fam?.seasonal ? ' seasonal' : ''} override ${it.useFeatherClampOverride ? 1 : 0}/${num(it.useFeatherClampOverride ? it.featherClampOverride : this.environmentGroup.featherClamp(it.familyId))}`;
      }
      if (it instanceof AffectorShaderConstant) return `ASCN ${it.name}${on} family ${it.familyId}`;
      if (it instanceof AffectorShaderReplace) return `ASRP ${it.name}${on} ${it.sourceFamilyId} -> ${it.destinationFamilyId}`;
      return `${it.tag} ${it.name}${on}`;
    };
    const walk = (l: Layer, depth: number) => {
      const pad = '  '.repeat(depth);
      const flags = `${l.active ? '' : ' [inactive]'}${l.invertBoundaries ? ' invertBoundaries' : ''}${l.invertFilters ? ' invertFilters' : ''}`;
      lines.push(`${pad}LAYR ${l.name}${flags}`);
      for (const it of [...l.boundaries, ...l.filters, ...l.affectors]) lines.push(`${pad}  ${item(it)}`);
      for (const s of l.layers) walk(s, depth + 1);
    };
    for (const l of this.layers) walk(l, 0);
    return lines;
  }

  /**
   * Where each environment affector sits: its family, whether that family is seasonal, whether the
   * affector and every layer enclosing it is active, the layer path holding it, and the extent of
   * its nearest enclosing layer with boundaries (null when it covers the whole map). For the console.
   */
  environmentAreas(): { familyId: number; name: string; seasonal: boolean; active: boolean; layer: string; extent: Rect | null }[] {
    const out: { familyId: number; name: string; seasonal: boolean; active: boolean; layer: string; extent: Rect | null }[] = [];
    const walk = (l: Layer, path: string[], enclosing: Rect | null, active: boolean) => {
      const here = [...path, l.name];
      const on = active && l.active;
      const extent = l.useExtent ? l.extent : enclosing;
      for (const a of l.affectors) {
        if (!(a instanceof AffectorEnvironment)) continue;
        const fam = this.environmentGroup.families.get(a.familyId);
        out.push({ familyId: a.familyId, name: fam?.name ?? '', seasonal: fam?.seasonal ?? false, active: on && a.active, layer: here.join(' > '), extent });
      }
      for (const s of l.layers) walk(s, here, extent, on);
    };
    for (const l of this.layers) walk(l, [], null, true);
    return out;
  }

  /** Counts of every layer item by tag, for diagnostics. */
  summary(): Record<string, number> {
    const counts: Record<string, number> = {};
    const walk = (l: Layer) => {
      counts.LAYR = (counts.LAYR ?? 0) + 1;
      for (const it of [...l.boundaries, ...l.filters, ...l.affectors]) counts[it.tag] = (counts[it.tag] ?? 0) + 1;
      for (const s of l.layers) walk(s);
    };
    for (const l of this.layers) walk(l);
    return counts;
  }
}

export type { IffChunk, IffNode };

/**
 * Renumber the shader families a layer's rules name (constant and replace affectors, roads,
 * rivers, shader filters) through `map` (old id → new id), recursively through its sublayers.
 * Layer files carry their own family list, so their ids only mean something in that list.
 */
export function remapShaderFamilies(layer: Layer, map: Map<number, number>): void {
  const m = (id: number) => map.get(id) ?? id;
  for (const a of layer.affectors) {
    if (a instanceof AffectorShaderConstant) a.familyId = m(a.familyId);
    else if (a instanceof AffectorShaderReplace) {
      a.sourceFamilyId = m(a.sourceFamilyId);
      a.destinationFamilyId = m(a.destinationFamilyId);
    } else if (a instanceof AffectorRoad) a.familyId = m(a.familyId);
    else if (a instanceof AffectorRiver) {
      a.bankFamilyId = m(a.bankFamilyId);
      a.bottomFamilyId = m(a.bottomFamilyId);
    }
  }
  for (const f of layer.filters) if (f instanceof FilterShader) f.familyId = m(f.familyId);
  for (const l of layer.layers) remapShaderFamilies(l, map);
}
