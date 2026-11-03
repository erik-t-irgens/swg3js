// How a light of the owner's flickers (Map-maker II's wave of the rooms' lights): a pure function of the shared clock and the
// light's own key, so every browser in a room sees the same candle gutter at the same instant with nothing sent between
// them, as the weather is shared (`weatherSchedule.ts`). A light's key is hashed once, when the pool plans it (`flickerSeed`);
// a frame asks `flickerIn` through a kept record, so no number crosses a call the compiler may leave out (the aim's lesson)
// and nothing is made.
//
// The shapes (every number of them ours, the owner's to move live through `__debug.roomLights({ tune: { flicker } })` and the
// debug menu's sliders): **candle** a smooth wander of value noise at the rate, two octaves; **pulse** a cosine breathing
// once a cycle; **strobe** full and dark for a share of each cycle each; **broken** a tube that holds, then on a share of
// its cycles drops out for part of one and stutters back. Each answers a multiplier from `1 - depth` to 1.
//
// Pure, no imports. Rule for this file (node runs it with type stripping): no enum, no namespace, no constructor parameter
// properties.

/** A shape's number, as a planned light keeps it (a string compared in a frame is a compare of its own). */
export const FLICKER_CODE: Readonly<Record<string, number>> = { none: 0, candle: 1, pulse: 2, strobe: 3, broken: 4 };

/**
 * The shapes' own numbers (ours, feel): the candle's second octave's share and how much faster it runs, the strobe's share of
 * a cycle lit, and the broken tube's share of cycles that drop out, how long a drop lasts as a share of its cycle and how
 * many times it stutters back.
 */
export const FLICKER_TUNE = {
  /** The candle's second octave: half again as fast and a third as strong, a guttering over the wander. */
  candleFine: 0.35,
  candleFineRate: 2.7,
  /** A strobe is lit half of each cycle. */
  strobeLit: 0.5,
  /** A broken tube: one cycle in four drops out, for a third of the cycle, stuttering three times on the way back. */
  brokenShare: 0.25,
  brokenDrop: 0.35,
  brokenStutter: 3,
};

/** A light's key hashed (FNV-1a over its characters, 32 bits): its own seed, the same in every browser. */
export function flickerSeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A whole number and a seed to a fraction from 0 to 1 (a hash of the two, 32 bits): lickerIn writes these lines out; the tests hold it to them. */
export function hash01(n: number, seed: number): number {
  let h = (Math.imul(n | 0, 0x9e3779b1) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Smooth value noise at `x` (cells of one), 0 to 1 (written out in `flickerIn`; the tests hold it to this). */
export function valueNoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash01(i, seed);
  const b = hash01(i + 1, seed);
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

/** What a frame asks of a flicker, one kept record: the shape's code, its rate, its depth, the light's seed, the clock in seconds; `out` its answer. */
export interface FlickerAsk {
  code: number;
  rate: number;
  depth: number;
  seed: number;
  t: number;
  out: number;
}

/** A record with nothing in it, its numbers fractions from the start (a field that starts whole boxes every fraction written into it). */
export function flickerAsk(): FlickerAsk {
  return { code: 0, rate: 0.5, depth: 0.5, seed: 0, t: 0.5, out: 1.5 };
}

/**
 * The flicker's multiplier at the ask's moment, into `ask.out`: 1 for none, from `1 - depth` to 1 for a shape. Nothing is
 * made; every number stays in here or in the record.
 */
export function flickerIn(ask: FlickerAsk): void {
  const code = ask.code;
  const depth = ask.depth;
  if (code === 0 || !(depth > 0)) {
    ask.out = 1;
    return;
  }
  const T = FLICKER_TUNE;
  const x = ask.t * ask.rate;
  const seed = ask.seed;
  let v = 1;
  if (code === 1) {
    // A candle: a slow wander and a quicker guttering over it, both at the light's own seed. Value noise written out here
    // (`valueNoise`, `hash01` below are the same lines): a helper's answer handed back across a call the compiler leaves out
    // is boxed, a frame, a light.
    let slow = 0;
    let fine = 0;
    for (let o = 0; o < 2; o++) {
      const xx = o === 0 ? x : x * T.candleFineRate;
      const sd = o === 0 ? seed : (seed ^ 0x5bd1e995) >>> 0;
      const i = Math.floor(xx);
      const f = xx - i;
      let h = (Math.imul(i | 0, 0x9e3779b1) ^ sd) >>> 0;
      h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
      const a = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      let g = (Math.imul((i + 1) | 0, 0x9e3779b1) ^ sd) >>> 0;
      g = Math.imul(g ^ (g >>> 16), 0x85ebca6b) >>> 0;
      g = Math.imul(g ^ (g >>> 13), 0xc2b2ae35) >>> 0;
      const b = ((g ^ (g >>> 16)) >>> 0) / 4294967296;
      const s = f * f * (3 - 2 * f);
      if (o === 0) slow = a + (b - a) * s;
      else fine = a + (b - a) * s;
    }
    v = (1 - T.candleFine) * slow + T.candleFine * fine;
  } else if (code === 2) {
    // A pulse: a cosine once a cycle, its phase the light's own.
    const ph = (seed & 0xffff) / 65536;
    v = 0.5 + 0.5 * Math.cos((x + ph) * Math.PI * 2);
  } else if (code === 3) {
    // A strobe: lit for a share of each cycle, its phase the light's own.
    const ph = (seed & 0xffff) / 65536;
    const f = x + ph - Math.floor(x + ph);
    v = f < T.strobeLit ? 1 : 0;
  } else {
    // A broken tube: whole cycles, a share of them dropping out for part of the cycle and stuttering back.
    const n = Math.floor(x);
    const f = x - n;
    let h = (Math.imul(n | 0, 0x9e3779b1) ^ seed) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    if (((h ^ (h >>> 16)) >>> 0) / 4294967296 < T.brokenShare && f < T.brokenDrop) {
      const k = Math.floor((f / T.brokenDrop) * (T.brokenStutter * 2 + 1));
      v = k % 2 === 0 ? 0 : 1;
    } else v = 1;
  }
  ask.out = 1 - depth * (1 - v);
}

/** The multiplier as a plain answer (the tests' and the console's): `flickerIn` through a record of its own. */
const PLAIN = flickerAsk();
export function flickerAt(code: number, rate: number, depth: number, seed: number, t: number): number {
  PLAIN.code = code;
  PLAIN.rate = rate;
  PLAIN.depth = depth;
  PLAIN.seed = seed;
  PLAIN.t = t;
  flickerIn(PLAIN);
  return PLAIN.out;
}
