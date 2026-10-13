// Flora data of the terrain generator: the flora group (families of trees, rocks and plants
// with their appearances and weights), the radial group (families of grass and far tree cards,
// drawn as shaders rather than models), the coordinate hash and fast random generator the
// engine seeds flora with, and the packed maps newer terrain files bake collidable flora into.
// Everything here is a port of the engine's own code so placement matches the original game.

import { ChunkReader, chunkChild, formChild, isForm, type IffForm } from './iff.ts';

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

function floatBits(x: number): number {
  f32[0] = x;
  return u32[0];
}

function bitsFloat(b: number): number {
  u32[0] = b >>> 0;
  return f32[0];
}

function inthash(key: number): number {
  key = (key + (key << 12)) >>> 0;
  key = (key ^ (key >>> 22)) >>> 0;
  key = (key + (key << 4)) >>> 0;
  key = (key ^ (key >>> 9)) >>> 0;
  key = (key + (key << 10)) >>> 0;
  key = (key ^ (key >>> 2)) >>> 0;
  key = (key + (key << 7)) >>> 0;
  key = (key ^ (key >>> 12)) >>> 0;
  return key;
}

/** CoordinateHash: a terrain coordinate pair as a seed (the float bits of both, hashed). */
export function hashTuple(x: number, z: number): number {
  const ix = floatBits(Math.fround(x));
  const iz = (floatBits(Math.fround(z)) ^ 0xa5a5a5a5) >>> 0;
  const hx = inthash(ix);
  const hz = inthash(iz);
  return inthash((hx ^ hz) >>> 0);
}

/** CoordinateHash::makeFloat: a hash as a float in [0, 1). */
export function hashFloat(hash: number): number {
  const masked = ((hash + (hash >>> 9)) >>> 0) & 0x007fffff;
  return bitsFloat(0x3f800000 | masked) - 1;
}

/** FastRandomGenerator: Park-Miller minimal standard, floats from the high mantissa bits. */
export class FastRandomGenerator {
  private i = 123459876;

  constructor(seed = 0) {
    this.setSeed(seed);
  }

  setSeed(seed: number): void {
    const ps = (seed | 0) & 0x7fffffff;
    this.i = ps === 0 ? 123459876 : ps;
  }

  random(): number {
    const IA = 16807;
    const IM = 2147483647;
    const IQ = 127773;
    const IR = 2836;
    const k = Math.trunc(this.i / IQ);
    this.i = IA * (this.i - k * IQ) - IR * k;
    if (this.i < 0) this.i += IM;
    return this.i;
  }

  /** Uniform in [0, 1). */
  randomFloat(): number {
    return bitsFloat((this.random() >>> 8) | 0x3f800000) - 1;
  }
}

/** Families name bare files ("shrb_dsrt_brown.apt"); the engine loads them from appearance/. */
export function floraAppearancePath(name: string): string {
  const n = name.replace(/\\/g, '/').replace(/^\//, '');
  return n.includes('/') ? n : `appearance/${n}`;
}

export interface FloraChild {
  familyId: number;
  /** Appearance file with its directory, e.g. appearance/tree_tatooine_l.apt */
  appearance: string;
  weight: number;
  shouldSway: boolean;
  displacement: number;
  period: number;
  alignToTerrain: boolean;
  shouldScale: boolean;
  minScale: number;
  maxScale: number;
}

export class FloraFamily {
  readonly id: number;
  name = '';
  color = [0, 0, 0];
  density = 1;
  floats = false;
  readonly children: FloraChild[] = [];

  constructor(id: number) {
    this.id = id;
  }

  /** FloraGroup::Family::createFlora: weighted choice from a number in [0, 1]. */
  choose(r: number): FloraChild | null {
    if (!this.children.length) return null;
    let sum = 0;
    for (const c of this.children) sum += c.weight;
    let n = r * sum;
    for (const c of this.children) {
      if (n <= c.weight) return c;
      n -= c.weight;
    }
    return this.children[0];
  }
}

/** FORM FGRP > FORM 000N > FFAM chunks. */
export class FloraGroup {
  readonly families = new Map<number, FloraFamily>();
  version = 0;

  load(form: IffForm | null): void {
    if (!form) return;
    const v = form.children.find(isForm);
    if (!v) return;
    this.version = Number.parseInt(v.type, 10);
    const version = this.version;
    if (!(version === 1 || (version >= 6 && version <= 8))) throw new Error(`FGRP: unsupported version ${v.type}`);
    for (const c of v.children) {
      if (isForm(c) || c.tag !== 'FFAM') continue;
      const r = new ChunkReader(c.data);
      const family = new FloraFamily(r.int32());
      family.name = r.string();
      family.color = [r.uint8(), r.uint8(), r.uint8()];
      if (version >= 6) {
        family.density = r.float();
        family.floats = r.int32() !== 0;
      }
      const n = r.int32();
      for (let k = 0; k < n; k++) {
        const child: FloraChild = { familyId: family.id, appearance: floraAppearancePath(r.string()), weight: r.float(), shouldSway: false, displacement: 0, period: 0, alignToTerrain: false, shouldScale: false, minScale: 1, maxScale: 1 };
        if (version >= 6) {
          child.shouldSway = r.int32() !== 0;
          child.displacement = r.float();
          child.period = r.float();
        }
        if (version >= 7) child.alignToTerrain = r.int32() !== 0;
        if (version >= 8) {
          child.shouldScale = r.int32() !== 0;
          child.minScale = r.float();
          child.maxScale = r.float();
        }
        family.children.push(child);
      }
      this.families.set(family.id, family);
    }
  }

  /** FloraGroup::createFlora: the child a family id and a choice in [0, 1] name. */
  createFlora(familyId: number, choice: number): FloraChild | null {
    return this.families.get(familyId)?.choose(choice) ?? null;
  }
}

/**
 * One child of a radial family (RadialGroup::FamilyChildData): a shader drawn as a card, not a model, with its
 * size in metres. Every field is the engine's own and named as the engine names it; what the client did with
 * `distance` and `alignToTerrain` is client code and is not in the archives.
 */
export interface RadialChild {
  familyId: number;
  /** The shader as the family names it, bare (`radl_grass_short_green`). */
  shader: string;
  weight: number;
  /** 10, 15, 20 or 25 m on the retail worlds: a cut-off or a fade band, nothing says which. */
  distance: number;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  maintainAspect: boolean;
  shouldSway: boolean;
  displacement: number;
  period: number;
  alignToTerrain: boolean;
  /** Two quads crossed at right angles rather than one. */
  createPlus: boolean;
}

export class RadialFamily {
  readonly id: number;
  name = '';
  color = [0, 0, 0];
  density = 1;
  readonly children: RadialChild[] = [];

  constructor(id: number) {
    this.id = id;
  }

  /** RadialGroup::Family::createRadial: the child a number in [0, 1] picks by weight, the first when none covers it. */
  choose(r: number): RadialChild | null {
    if (!this.children.length) return null;
    let sum = 0;
    for (const c of this.children) sum += c.weight;
    let n = r * sum;
    for (const c of this.children) {
      if (n <= c.weight) return c;
      n -= c.weight;
    }
    return this.children[0];
  }
}

/**
 * The terrain's radial group: FORM RGRP > FORM 000N > RFAM chunks, the families of grass, flowers, reeds and
 * ferns the near affector (AFDN) paints and the flat tree cards on the far hills the far one (AFDF) paints. Read
 * in the engine's own field order for every version it knows (RadialGroup::load_0000 to load_0004); version 0004
 * is every retail world's, and every one of its chunks reads to the byte.
 */
export class RadialGroup {
  readonly families = new Map<number, RadialFamily>();
  version = -1;
  /** Bytes a chunk had left over after its last child, summed, which is nought for a chunk read rightly. */
  leftover = 0;

  load(form: IffForm | null): void {
    if (!form) return;
    const v = form.children.find(isForm);
    if (!v) return;
    const version = Number.parseInt(v.type, 10);
    if (!(version >= 0 && version <= 4)) throw new Error(`RGRP: unsupported version ${v.type}`);
    this.version = version;
    for (const c of v.children) {
      if (isForm(c) || c.tag !== 'RFAM') continue;
      const r = new ChunkReader(c.data);
      const family = new RadialFamily(r.int32());
      family.name = r.string();
      family.color = [r.uint8(), r.uint8(), r.uint8()];
      if (version >= 1) family.density = r.float();
      const n = r.int32();
      for (let k = 0; k < n; k++) {
        const shader = r.string();
        const weight = r.float();
        const distance = r.float();
        let minWidth: number;
        let maxWidth: number;
        let minHeight: number;
        let maxHeight: number;
        if (version >= 4) {
          minWidth = r.float();
          maxWidth = r.float();
          minHeight = r.float();
          maxHeight = r.float();
        } else {
          minWidth = maxWidth = r.float();
          minHeight = maxHeight = r.float();
        }
        const maintainAspect = version >= 4 ? r.int32() !== 0 : false;
        const shouldSway = version >= 2 ? r.int32() !== 0 : false;
        const displacement = version >= 2 ? r.float() : 0;
        const period = version >= 2 ? r.float() : 0;
        const alignToTerrain = version >= 3 ? r.int32() !== 0 : false;
        const createPlus = version >= 3 ? r.int32() !== 0 : false;
        family.children.push({ familyId: family.id, shader, weight, distance, minWidth, maxWidth, minHeight, maxHeight, maintainAspect, shouldSway, displacement, period, alignToTerrain, createPlus });
      }
      this.leftover += r.remaining;
      this.families.set(family.id, family);
    }
  }

  /** RadialGroup::createRadial: the child a family id and a choice in [0, 1] name. */
  createRadial(familyId: number, choice: number): RadialChild | null {
    return this.families.get(familyId)?.choose(choice) ?? null;
  }

  /** How many children every family holds together. */
  get childCount(): number {
    let n = 0;
    for (const f of this.families.values()) n += f.children.length;
    return n;
  }
}

/** PackedIntegerMap: FORM PIMP > FORM 0000 > CNTL (width, height, bits, minimum) + DATA (bits, LSB first). */
export class PackedIntegerMap {
  readonly width: number;
  readonly height: number;
  readonly bits: number;
  readonly minimum: number;
  private readonly data: Uint8Array;

  constructor(form: IffForm) {
    const v = formChild(form, '0000');
    if (!v) throw new Error('PIMP: missing version');
    const r = new ChunkReader(chunkChild(v, 'CNTL')!.data);
    this.width = r.int32();
    this.height = r.int32();
    this.bits = r.int32();
    this.minimum = r.int32();
    this.data = chunkChild(v, 'DATA')!.data;
  }

  getValue(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return this.minimum;
    const bitOffset = (y * this.width + x) * this.bits;
    let byte = bitOffset >>> 3;
    let srcMask = 1 << (bitOffset & 7);
    let bits = 0;
    let destMask = 1;
    for (let i = this.bits; i > 0; i--) {
      if (this.data[byte] & srcMask) bits |= destMask;
      destMask <<= 1;
      srcMask <<= 1;
      if (srcMask > 128) {
        srcMask = 1;
        byte++;
      }
    }
    return bits + this.minimum;
  }
}

/** PackedFixedPointMap: FORM PFPM > PIMP + FORM 0000 > CNTL (resolution). */
export class PackedFixedPointMap {
  readonly map: PackedIntegerMap;
  readonly resolution: number;

  constructor(form: IffForm) {
    const pimp = formChild(form, 'PIMP');
    const v = formChild(form, '0000');
    if (!pimp || !v) throw new Error('PFPM: malformed');
    this.map = new PackedIntegerMap(pimp);
    this.resolution = new ChunkReader(chunkChild(v, 'CNTL')!.data).float();
  }

  getValue(x: number, y: number): number {
    return this.map.getValue(x, y) * this.resolution;
  }
}
