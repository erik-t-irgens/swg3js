// Port of the engine's MultiFractal / NoiseGenerator / RandomGenerator (sharedFractal, sharedRandom).
// Every constant and quirk is kept so heights come out where the game put them.

const IM = 2147483647;
const NTAB = 322;
const IA = 16807;
const IQ = 127773;
const IR = 2836;
// The engine computes NDIV in single precision; mirror that so the shuffle table index matches.
const NDIV = Math.fround(1 + Math.fround(Math.fround(IM - 1) / Math.fround(NTAB)));

/** Numerical Recipes ran1 with the engine's seeding rules. */
export class RandomGenerator {
  private idnum = 1;
  private iy = 0;
  private readonly iv = new Int32Array(NTAB);

  constructor(seed = 1) {
    this.setSeed(seed);
  }

  setSeed(seed: number): void {
    this.iy = 0;
    this.idnum = -(seed | 0) | 0;
  }

  random(): number {
    let j: number;
    let k: number;
    if (this.idnum <= 0 || this.iy === 0) {
      if (-this.idnum < 1) this.idnum = 1;
      else this.idnum = -this.idnum;
      for (j = NTAB + 7; j >= 0; --j) {
        k = Math.trunc(this.idnum / IQ);
        this.idnum = IA * (this.idnum - k * IQ) - IR * k;
        if (this.idnum < 0) this.idnum += IM;
        if (j < NTAB) this.iv[j] = this.idnum;
      }
      this.iy = this.iv[0];
    }
    k = Math.trunc(this.idnum / IQ);
    this.idnum = IA * (this.idnum - k * IQ) - IR * k;
    if (this.idnum < 0) this.idnum += IM;
    j = Math.trunc(Math.fround(Math.fround(this.iy) / NDIV));
    this.iy = this.iv[j];
    this.iv[j] = this.idnum;
    return this.iy;
  }

  /** Uniform in [0, 1] (randomReal). */
  randomReal(): number {
    return this.random() / IM;
  }
}

const f32 = Math.fround;
const B = 256;
const BM = 255;
const N = 4096;

/** Ken Perlin's reference noise with the engine's seeded gradient tables. */
export class NoiseGenerator {
  private readonly p = new Int32Array(B + B + 2);
  private readonly g1 = new Float32Array(B + B + 2);
  private readonly g2 = new Float32Array((B + B + 2) * 2);
  private readonly random = new RandomGenerator();

  constructor(seed = 0) {
    this.init(seed);
  }

  init(seed: number): void {
    const { p, g1, g2, random } = this;
    random.setSeed(seed);
    let i: number;
    let j: number;
    let k: number;
    for (i = 0; i < B; i++) {
      p[i] = i;
      g1[i] = ((random.random() % (B + B)) - B) / B;
      for (j = 0; j < 2; j++) g2[i * 2 + j] = ((random.random() % (B + B)) - B) / B;
      const s = Math.sqrt(g2[i * 2] * g2[i * 2] + g2[i * 2 + 1] * g2[i * 2 + 1]);
      g2[i * 2] /= s;
      g2[i * 2 + 1] /= s;
    }
    while (--i) {
      k = p[i];
      j = random.random() % B;
      p[i] = p[j];
      p[j] = k;
    }
    for (i = 0; i < B + 2; i++) {
      p[B + i] = p[i];
      g1[B + i] = g1[i];
      g2[(B + i) * 2] = g2[i * 2];
      g2[(B + i) * 2 + 1] = g2[i * 2 + 1];
    }
  }

  value1(x: number): number {
    const t = f32(x + N);
    const it = Math.trunc(t);
    const ft = it - (t < 0 && t !== it ? 1 : 0);
    const bx0 = ft & BM;
    const bx1 = (bx0 + 1) & BM;
    const rx0 = t - ft;
    const rx1 = rx0 - 1;
    const sx = (3 - 2 * rx0) * rx0 * rx0;
    const u = rx0 * this.g1[this.p[bx0]];
    const v = rx1 * this.g1[this.p[bx1]];
    return u + sx * (v - u);
  }

  value2(x: number, y: number): number {
    const { p, g2 } = this;
    let t = f32(x + N);
    let it = Math.trunc(t);
    let ft = it - (t < 0 && t !== it ? 1 : 0);
    const bx0 = ft & BM;
    const bx1 = (bx0 + 1) & BM;
    const rx0 = t - ft;
    const rx1 = rx0 - 1;

    t = f32(y + N);
    it = Math.trunc(t);
    ft = it - (t < 0 && t !== it ? 1 : 0);
    const by0 = ft & BM;
    const by1 = (by0 + 1) & BM;
    const ry0 = t - ft;
    const ry1 = ry0 - 1;

    const sx = (3 - 2 * rx0) * rx0 * rx0;
    const sy = (3 - 2 * ry0) * ry0 * ry0;

    const i = p[bx0];
    const j = p[bx1];
    const b00 = p[i + by0] * 2;
    const b10 = p[j + by0] * 2;
    const b01 = p[i + by1] * 2;
    const b11 = p[j + by1] * 2;

    let u = rx0 * g2[b00] + ry0 * g2[b00 + 1];
    let v = rx1 * g2[b10] + ry0 * g2[b10 + 1];
    const a = u + sx * (v - u);
    u = rx0 * g2[b01] + ry1 * g2[b01 + 1];
    v = rx1 * g2[b11] + ry1 * g2[b11 + 1];
    const b = u + sx * (v - u);
    return a + sy * (b - a);
  }
}

export const CombinationRule = {
  add: 0,
  multiply: 1,
  crest: 2,
  turbulence: 3,
  crestClamp: 4,
  turbulenceClamp: 5,
} as const;
export type CombinationRuleValue = (typeof CombinationRule)[keyof typeof CombinationRule];

const LOG_HALF = Math.log(0.5);

function bias(a: number, b: number): number {
  return Math.pow(a, Math.log(b) / LOG_HALF);
}

function gain(a: number, b: number): number {
  if (a < 0.001) return 0;
  if (a > 0.999) return 1;
  const p = Math.log(1 - b) / LOG_HALF;
  if (a < 0.5) return Math.pow(2 * a, p) * 0.5;
  return 1 - Math.pow(2 * (1 - a), p) * 0.5;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class MultiFractal {
  seed = 0;
  scaleX = 0.01;
  scaleY = 0.01;
  offsetX = 0;
  offsetY = 0;
  numberOfOctaves = 2;
  frequency = 4;
  amplitude = 0.5;
  ooTotalAmplitude = 1;
  useBias = false;
  bias = 0.5;
  useGain = false;
  gain = 0.7;
  useSin = false;
  combinationRule: CombinationRuleValue = CombinationRule.add;
  readonly noise = new NoiseGenerator(0);

  constructor() {
    this.initTotalAmplitude();
  }

  setSeed(seed: number): void {
    if (this.seed !== seed) {
      this.seed = seed;
      this.noise.init(seed);
    }
  }

  setScale(x: number, y: number = x): void {
    this.scaleX = x;
    this.scaleY = y;
  }

  setOffset(x: number, y: number): void {
    this.offsetX = x;
    this.offsetY = y;
  }

  /** Like the engine, changing the octave count alone does not renormalise the amplitude. */
  setNumberOfOctaves(n: number): void {
    this.numberOfOctaves = n;
  }

  setFrequency(f: number): void {
    this.frequency = f;
  }

  setAmplitude(a: number): void {
    this.amplitude = a;
    this.initTotalAmplitude();
  }

  setBias(use: boolean, b: number): void {
    this.useBias = use;
    this.bias = b;
  }

  setGain(use: boolean, g: number): void {
    this.useGain = use;
    this.gain = g;
  }

  setCombinationRule(rule: number): void {
    this.combinationRule = rule as CombinationRuleValue;
  }

  private initTotalAmplitude(): void {
    let total = 0;
    let amplitude = 1;
    for (let i = 0; i < this.numberOfOctaves; ++i, amplitude *= this.amplitude) total += amplitude;
    this.ooTotalAmplitude = 1 / total;
  }

  private finish(result: number): number {
    if (this.useBias) result = bias(result, this.bias);
    if (this.useGain) result = gain(result, this.gain);
    return result;
  }

  /** 2D value in [0, 1]; the offset is scaled by each octave's frequency, as in MultiFractal::getValue(x, y). */
  value2(x: number, y: number): number {
    x = f32(x * this.scaleX);
    y = f32(y * this.scaleY);
    const { noise, offsetX, offsetY, numberOfOctaves } = this;
    let frequency = 1;
    let amplitude = 1;
    let sum = 0;
    switch (this.combinationRule) {
      case CombinationRule.add:
      case CombinationRule.multiply:
        for (let i = 0; i < numberOfOctaves; ++i, frequency *= this.frequency, amplitude *= this.amplitude)
          sum += amplitude * noise.value2(f32(f32(x * frequency) + f32(offsetX * frequency)), f32(f32(y * frequency) + f32(offsetY * frequency)));
        if (this.useSin) sum = Math.sin(x + sum);
        return this.finish((sum * this.ooTotalAmplitude + 1) * 0.5);
      case CombinationRule.crest:
        for (let i = 0; i < numberOfOctaves; ++i, frequency *= this.frequency, amplitude *= this.amplitude)
          sum += amplitude * (1 - Math.abs(noise.value2(f32(f32(x * frequency) + f32(offsetX * frequency)), f32(f32(y * frequency) + f32(offsetY * frequency)))));
        break;
      case CombinationRule.turbulence:
        for (let i = 0; i < numberOfOctaves; ++i, frequency *= this.frequency, amplitude *= this.amplitude)
          sum += amplitude * Math.abs(noise.value2(f32(f32(x * frequency) + f32(offsetX * frequency)), f32(f32(y * frequency) + f32(offsetY * frequency))));
        break;
      case CombinationRule.crestClamp:
        for (let i = 0; i < numberOfOctaves; ++i, frequency *= this.frequency, amplitude *= this.amplitude)
          sum += amplitude * (1 - clamp01(noise.value2(f32(f32(x * frequency) + f32(offsetX * frequency)), f32(f32(y * frequency) + f32(offsetY * frequency)))));
        break;
      case CombinationRule.turbulenceClamp:
        for (let i = 0; i < numberOfOctaves; ++i, frequency *= this.frequency, amplitude *= this.amplitude)
          sum += amplitude * clamp01(noise.value2(f32(f32(x * frequency) + f32(offsetX * frequency)), f32(f32(y * frequency) + f32(offsetY * frequency))));
        break;
      default:
        return 0;
    }
    if (this.useSin) sum = Math.sin(x + sum);
    return this.finish(sum * this.ooTotalAmplitude);
  }

  /** 1D value in [0, 1], as in MultiFractal::getValue(x) (offset added once, not per octave). */
  value1(x: number): number {
    x = f32(f32(x * this.scaleX) + this.offsetX);
    const { noise, numberOfOctaves } = this;
    let frequency = 1;
    let amplitude = 1;
    let sum = 0;
    switch (this.combinationRule) {
      case CombinationRule.add:
      case CombinationRule.multiply:
        for (let i = 0; i < numberOfOctaves; ++i, frequency *= this.frequency, amplitude *= this.amplitude) sum += amplitude * noise.value1(f32(x * frequency));
        if (this.useSin) sum = Math.sin(x + sum);
        return this.finish((sum * this.ooTotalAmplitude + 1) * 0.5);
      case CombinationRule.crest:
        for (let i = 0; i < numberOfOctaves; ++i, frequency *= this.frequency, amplitude *= this.amplitude) sum += amplitude * (1 - Math.abs(noise.value1(f32(x * frequency))));
        break;
      case CombinationRule.turbulence:
        for (let i = 0; i < numberOfOctaves; ++i, frequency *= this.frequency, amplitude *= this.amplitude) sum += amplitude * Math.abs(noise.value1(f32(x * frequency)));
        break;
      case CombinationRule.crestClamp:
        for (let i = 0; i < numberOfOctaves; ++i, frequency *= this.frequency, amplitude *= this.amplitude) sum += amplitude * (1 - clamp01(noise.value1(f32(x * frequency))));
        break;
      case CombinationRule.turbulenceClamp:
        for (let i = 0; i < numberOfOctaves; ++i, frequency *= this.frequency, amplitude *= this.amplitude) sum += amplitude * clamp01(noise.value1(f32(x * frequency)));
        break;
      default:
        return 0;
    }
    if (this.useSin) sum = Math.sin(x + sum);
    return this.finish(sum * this.ooTotalAmplitude);
  }

  equals(o: MultiFractal): boolean {
    const eq = (a: number, b: number) => Math.abs(a - b) <= 0.00001;
    if (this.seed !== o.seed) return false;
    if (!eq(this.scaleX, o.scaleX) || !eq(this.scaleY, o.scaleY)) return false;
    if (!eq(this.offsetX, o.offsetX) || !eq(this.offsetY, o.offsetY)) return false;
    if (this.numberOfOctaves !== o.numberOfOctaves) return false;
    if (this.numberOfOctaves !== 1 && !eq(this.frequency, o.frequency)) return false;
    if (this.numberOfOctaves !== 1 && !eq(this.amplitude, o.amplitude)) return false;
    if (this.useBias !== o.useBias || (this.useBias && !eq(this.bias, o.bias))) return false;
    if (this.useGain !== o.useGain || (this.useGain && !eq(this.gain, o.gain))) return false;
    if (this.combinationRule !== o.combinationRule) return false;
    return this.useSin === o.useSin;
  }

  copyFrom(o: MultiFractal): void {
    this.setSeed(o.seed);
    this.scaleX = o.scaleX;
    this.scaleY = o.scaleY;
    this.offsetX = o.offsetX;
    this.offsetY = o.offsetY;
    this.numberOfOctaves = o.numberOfOctaves;
    this.frequency = o.frequency;
    this.amplitude = o.amplitude;
    this.ooTotalAmplitude = o.ooTotalAmplitude;
    this.useBias = o.useBias;
    this.bias = o.bias;
    this.useGain = o.useGain;
    this.gain = o.gain;
    this.useSin = o.useSin;
    this.combinationRule = o.combinationRule;
  }
}
