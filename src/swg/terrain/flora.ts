// Flora data of the terrain generator: the flora group (families of trees, rocks and plants
// with their appearances and weights), the coordinate hash and fast random generator the
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

export interface FloraChild {
  familyId: number;
  /** Appearance file, e.g. appearance/tree_tatooine_l.apt */
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
        const child: FloraChild = { familyId: family.id, appearance: r.string(), weight: r.float(), shouldSway: false, displacement: 0, period: 0, alignToTerrain: false, shouldScale: false, minScale: 1, maxScale: 1 };
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
