// The clouds' shape (the GPU port's pass 3, wave 1, maker V; the design's 2.2): the ONE function the march, wave 3's shadow
// map and wave 5's bakes call for a cloud's density at a point of a layer. A type is a vertical profile and an erosion of this
// function, never a height (`cloudLayers.ts`, the contract): a cumulus put at 8 km draws as a cumulus.
//
// What it does, from the published method (Schneider's "Nubis" talks, 2015 and 2017; Hillaire 2016), in our own words:
//   1. the point's height share in its own cloud: its share of the layer (0 at the base, 1 at the top) over the cell's own
//      top from the map (a cumulus cell of top 0.6 ends at six tenths of the layer), so neighbouring heaps stand at their own
//      heights;
//   2. the type's vertical profile there: a rise from the base over `rise`, a fall toward the top from `fallFrom` to
//      `fallTo` (the contract's form), each blended over the layer's types by the map's mix weights before the function runs,
//      so a deck part stratocumulus, part cumulus is one evaluation;
//   3. the cover at that height: the map's cover narrowed toward the top by `taper` (a heap's dome; a tower stands straighter)
//      and spread out near the top by `anvil` (the cumulonimbus's), taken as a power that lifts a low cover toward one;
//   4. the low-frequency shape: the shape volume's billows (its Perlin-Worley) for a billowy type, its Worley octaves for a
//      wispy one, by `billow`, times the profile;
//   5. the cover cut: where that shape stands over one less the cover, the cloud is, over a band whose width the layer's
//      `edge` sets (hard to soft), times the cover;
//   6. the erosion: the detail volume's octaves, wispy at the base and billowy above, eat the edge by `erosion`;
//   7. the density: times the types' own factor, the layer's, and the look's extinction per metre.
//
// Written over operations (`ShapeOps`): plain numbers for the node tests (`SHAPE_NUM`) and three's shading language for the
// card (`cloudMarch.ts` hands its own), so the card's graph is this function itself. Pure: no three here.
//
// Every number of look is a dial with its start and reason (`CLOUD_LOOK`, the owner's to move); none is SWG's.

import { CLOUD_TYPE_VEC4 } from './cloudLayers.ts';

/** The operations the shape is written over: numbers or nodes. */
export interface ShapeOps<N> {
  k(v: number): N;
  add(a: N, b: N): N;
  sub(a: N, b: N): N;
  mul(a: N, b: N): N;
  div(a: N, b: N): N;
  min(a: N, b: N): N;
  max(a: N, b: N): N;
  pow(a: N, b: N): N;
  clamp01(a: N): N;
  smoothstep(e0: N, e1: N, x: N): N;
  mix(a: N, b: N, t: N): N;
}

/** The operations over plain numbers (the node tests' and every pure twin's). */
export const SHAPE_NUM: ShapeOps<number> = {
  k: (v) => v,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  clamp01: (a) => (a < 0 ? 0 : a > 1 ? 1 : a),
  smoothstep: (e0, e1, x) => {
    const t0 = (x - e0) / (e1 - e0);
    const t = t0 < 0 ? 0 : t0 > 1 ? 1 : t0;
    return t * t * (3 - 2 * t);
  },
  mix: (a, b, t) => a + (b - a) * t,
};

/**
 * The look of every layer's shape: the owner's dials (each with its start and reason; `__debug.clouds({ tune: { look } })`
 * and the debug menu's `clouds` sliders move them, read by the card once a render).
 */
export const CLOUD_LOOK = {
  /**
   * Extinction per metre at a shape density of one, before the types' and the layers' own factors: 0.06 /m is a fair-weather
   * cumulus's (a visibility inside it of some 65 m), so a heap 1 km through is opaque and its thin edges show the sky.
   */
  sigma: 0.06,
  /** How hard the detail noise eats the edges, a factor on each type's own `erosion`: 1 as the types are set. */
  erosion: 1,
  /** How far the cover band reaches into the shape at the hardest `edge` (0) and the softest (1), a share of the cover: 0.35 and 1.6. */
  edgeHard: 0.35,
  edgeSoft: 1.6,
  /**
   * The shape volume's tile, metres, for a layer of 1,600 m cells (a cumulus's): 2048, its billows about 500 m, so a heap of a
   * kilometre is several. Each layer's own is this times its cell size over 1,600 m, taken to the nearest power of two (so the
   * drift's wrap never jumps it): an altocumulus of 700 m cells takes 1,024 m.
   */
  shapeTile: 2048,
  /** The detail volume's tile, metres (a power of two): 256, its finest cells some 30 m, so a heap's edge frays near to. */
  detailTile: 256,
  /**
   * The shape noise's vertical tile against its horizontal one: 2, its billows twice as tall as wide (a heap's towers stand up)
   * and a 9 km tower meeting its noise's repeat only twice. A whole number keeps a layer's base on the same noise as it drifts.
   */
  tallness: 2,
  /** How far the curl turns the detail's samples, metres at the base, falling to none at the top: 120, a ragged base. */
  curl: 120,
  /** The share of the layer's height over which the detail turns from wispy to billowy: 0.25 (Schneider's tenth was for one deck type). */
  wispyBand: 0.25,
  /**
   * How much of the cover a billowy type's shape noise always carves, even at a cell's heart where the map's cover is whole:
   * 0.4, so a heap is billows and gaps to its middle rather than a smooth lens with the map's outline (a sheet type, whose
   * `billow` is low, keeps its whole cover and its overcast stays whole).
   */
  carve: 0.4,
  /**
   * Where in a cloud's own column its type's `taper` begins to narrow it, a share of the column: 0.1, so the base keeps its
   * full width (a heap's flat bottom) and the narrowing is the dome's above it.
   */
  taperFrom: 0.1,
  /**
   * The anvil's window in a cloud's own column, and its power: from `anvilFrom` to `anvilTo` the cover is taken to a power
   * eased from one to `anvilPower` at a type's full `anvil`, which lifts a low cover toward one so the top spreads out past
   * the tower's own cell. The published method's (Schneider, "Real-Time Volumetric Cloudscapes", GPU Pro 7, 2016: the
   * coverage's power eased from one to a half between seven and eight tenths of the height at a full anvil bias): 0.7, 0.8
   * and 0.5. The owner's to move.
   */
  anvilFrom: 0.7,
  anvilTo: 0.8,
  anvilPower: 0.5,
  /**
   * The most of the cover cut the detail's erosion eats, a share: 0.35 (the published method's fifth, a little more since each
   * type's own `erosion` is under one), so the detail frays the edge without eating the cloud.
   */
  bite: 0.35,
  /** The bite at the softest `edge`, a share of itself: 0.4, so a soft edge stays a soft band rather than being eaten away. */
  softBite: 0.4,
  // ---- the light (`cloudLight.ts` reads these)
  /** The forward lobe's eccentricity (the silver lining round a cloud before the sun): 0.65, a water cloud's forward peak. */
  forward: 0.65,
  /** The back lobe's (the glow on a cloud's sunlit face seen with the sun behind you): −0.25. */
  back: -0.25,
  /** The forward lobe's share of the two: 0.6. */
  forwardShare: 0.6,
  /** The scattering albedo: 0.99, water droplets absorb almost nothing (a lower number greys every cloud). */
  albedo: 0.99,
  /** Multiple scattering's three octaves (Wrenninge 2013): each octave's extinction, light and eccentricity times these, its index'th power: 0.5, 0.55, 0.6. */
  octaveExtinction: 0.5,
  octaveLight: 0.55,
  octavePhase: 0.6,
  /** "Powder": how much the thin edges facing away from the light darken (0 none, 1 Schneider's whole): 0.5. */
  powder: 0.5,
  /** The depth (metres) of cloud over which a dark edge fills in: 60. */
  powderDepth: 60,
  /** The sky's light on the clouds, a factor on what the air's sky view gives: 1 as the air makes it. */
  ambient: 1,
  /** The ambient light at a layer's base against its top (a cloud's belly sees the ground, its top the sky): 0.45. */
  belly: 0.45,
  /** The light march's cone, its widest share of the distance stepped: 0.35 (the light reads a soft cone, not a line). */
  cone: 0.35,
  /**
   * Pass 3, wave 2 (maker B): the night's drama, the owner's option ("real nights, drama an option: a night-floor dial he
   * sets"): the share of the sky round's night floor (`SHADE_TUNE.floor`'s light from the whole sky, which lights the land) the
   * clouds take in their ambient, eased in as the sun goes 0 to 6 degrees down. 0 to start, a real night: the clouds are lit by
   * the moons and the sky they hide alone, so on a moonless night in the wild a cloud shows only as stars missing, and under a
   * moon its edges silver. 1: the clouds lit by the floor as the land is (a readable night, the two agreeing); above it, drama.
   * Where no star system is applied there is no floor, and the clouds keep SWG's moon.
   */
  nightDrama: 0,
  // ---- the look wave, round 1: light that knows its depth in the cloud (`cloudLight.ts`; the plan's ranks 2 and 4)
  /**
   * The sharp forward lobe's share of single scattering (the silver rim round a cloud before the sun): 0.15, a rim that reads
   * against the sky without whitening the whole lit face. 0 is the two lobes alone, as wave 2 drew.
   */
  rim: 0.15,
  /** The rim lobe's eccentricity: 0.9, near the forward peak droplets really have, so the rim is a thin line, not a halo. */
  rimSharp: 0.9,
  /**
   * The rim's extra share at a low sun (eased in from 15 degrees up to the horizon): 0.35, the brighter sunset rim of the
   * cinematic dials (Guerrilla's and Rockstar's both; openly not physical). 0: the same rim all day.
   */
  rimLow: 0.35,
  /**
   * The inner glow with the sun ahead: the deep heart's light raised by this share as the depth toward the light fills in
   * (Guerrilla's 2024 talk's "inner glow"): 0.4, a glow that shows inside a cloud before the sun without washing out its dark
   * heart. 0 none.
   */
  glow: 0.4,
  /**
   * What the dark rims read as the sample's depth into the cloud: 1 the light march's own optical depth over its first three
   * steps toward the light (about 180 m: by depth, so crevices are bright and rims dark with the sun behind), 0 the sample's
   * own density times `powderDepth` (wave 1's, which darkened every thin part alike). Between, a mix.
   */
  rimsByDepth: 1,
  /**
   * How strongly the cloud above a sample takes the sky's light away (the 2024 talk's sky light = (1 − profile) ×
   * e^(−density above), the profile being `belly`): 1, as the density above says, so storm bases and hearts go dark.
   * 0: the sky's light unoccluded, as wave 2 drew.
   */
  skyAbove: 1,
  /**
   * The share of a cell's column above a sample counted as cloud for the sky's light (the map's cover and cell top give the
   * column; the shape's carve and erosion leave gaps in it): 0.35, about what the carve leaves of a heap's middle.
   */
  skyFill: 0.35,
  /**
   * The least of the sky's light left under the thickest cloud above: 0.08, light from the sides and the ground a real storm
   * base keeps, so it is near black but still shows its folds.
   */
  skyLeast: 0.08,
  /**
   * How the light march's depth takes away the sky's light from the sun's side (Red Dead Redemption 2's borrowing): the
   * sunward third of the ambient is taken by `exp(−τ × this)`, so a cloud's shaded side takes the sky's blue-grey from the
   * zenith and the far side while its lit side keeps the sun's colour (two colours at dusk, §1 item 8): 0.5. 0: the whole
   * sky on every side, as wave 2 drew.
   */
  skyBorrow: 0.5,
};

/** The look's dials' ranges (the debug menu's sliders and the console's clamps). */
export const CLOUD_LOOK_RANGE: Readonly<Record<keyof typeof CLOUD_LOOK, readonly [number, number]>> = {
  sigma: [0.002, 0.4],
  erosion: [0, 3],
  edgeHard: [0.02, 2],
  edgeSoft: [0.1, 4],
  shapeTile: [1024, 16384],
  detailTile: [64, 2048],
  tallness: [1, 8],
  curl: [0, 600],
  wispyBand: [0.02, 1],
  carve: [0, 0.9],
  taperFrom: [0, 0.9],
  anvilFrom: [0, 0.99],
  anvilTo: [0.01, 1],
  anvilPower: [0.05, 1],
  bite: [0, 1],
  softBite: [0, 1],
  forward: [0, 0.95],
  back: [-0.9, 0],
  forwardShare: [0, 1],
  albedo: [0.5, 1],
  octaveExtinction: [0.05, 1],
  octaveLight: [0, 1],
  octavePhase: [0, 1],
  powder: [0, 1],
  powderDepth: [1, 1000],
  ambient: [0, 4],
  belly: [0, 1.5],
  cone: [0, 1.5],
  nightDrama: [0, 4],
  rim: [0, 0.9],
  rimSharp: [0, 0.98],
  rimLow: [0, 0.9],
  glow: [0, 4],
  rimsByDepth: [0, 1],
  skyAbove: [0, 4],
  skyFill: [0, 1],
  skyLeast: [0, 1],
  skyBorrow: [0, 4],
};

/** A type's profile blended over a layer's types by their weights at a point (the shape's inputs from the contract's slots). */
export interface ShapeProfile<N> {
  rise: N;
  fallFrom: N;
  fallTo: N;
  anvil: N;
  billow: N;
  erosion: N;
  taper: N;
  /** The types' density factor (blended). */
  density: N;
  /**
   * The cloud's column as a share of the layer's thickness: each type's thickness (`p2.w`) over the tallest of the layer's
   * types', blended by the weights (one for a layer of one type), so in a deck of fair cumulus and storm towers the heaps stand
   * their own height and the towers the whole deck's. The cell's own top (the map's) is a share of this column.
   */
  reach: N;
}

/** Everything the shape reads at one point of one layer. */
export interface ShapeIn<N> {
  /** The point's height share of the layer, 0 at its base to 1 at its top. */
  h: N;
  /** The map's cover (r) and the cell's top share (a), each 0 to 1. */
  cover: N;
  top: N;
  /** The layer's own `edge` (0 hard to 1 soft) and density factor. */
  edge: N;
  layerDensity: N;
  /** The shape volume's four channels (billows, then three Worley octaves) and the detail volume's three, each 0 to 1. */
  low0: N;
  low1: N;
  low2: N;
  low3: N;
  det0: N;
  det1: N;
  det2: N;
}

/** The look's numbers as the shape reads them, numbers or a graph's uniforms. */
export interface ShapeLook<N> {
  sigma: N;
  erosion: N;
  edgeHard: N;
  edgeSoft: N;
  wispyBand: N;
  carve: N;
  taperFrom: N;
  anvilFrom: N;
  anvilTo: N;
  anvilPower: N;
  bite: N;
  softBite: N;
}

/** The look's dials as numbers (the twin's). */
export function shapeLookNumbers(out?: ShapeLook<number>): ShapeLook<number> {
  const o = out ?? { sigma: 0, erosion: 0, edgeHard: 0, edgeSoft: 0, wispyBand: 0, carve: 0, taperFrom: 0, anvilFrom: 0, anvilTo: 0, anvilPower: 0, bite: 0, softBite: 0 };
  o.sigma = CLOUD_LOOK.sigma;
  o.erosion = CLOUD_LOOK.erosion;
  o.edgeHard = CLOUD_LOOK.edgeHard;
  o.edgeSoft = CLOUD_LOOK.edgeSoft;
  o.wispyBand = CLOUD_LOOK.wispyBand;
  o.carve = CLOUD_LOOK.carve;
  o.taperFrom = CLOUD_LOOK.taperFrom;
  o.anvilFrom = CLOUD_LOOK.anvilFrom;
  o.anvilTo = CLOUD_LOOK.anvilTo;
  o.anvilPower = CLOUD_LOOK.anvilPower;
  o.bite = CLOUD_LOOK.bite;
  o.softBite = CLOUD_LOOK.softBite;
  return o;
}

/** Schneider's remap: `v` carried from [l0, h0] to [l1, h1] (the low end held off a zero width). */
function remapOf<N>(o: ShapeOps<N>, v: N, l0: N, h0: N, l1: N, h1: N): N {
  return o.add(l1, o.mul(o.sub(v, l0), o.div(o.sub(h1, l1), o.max(o.sub(h0, l0), o.k(1e-5)))));
}

/** Counted at each call, so a node test can see both paths go through the one function. */
export const SHAPE_CALLS = { numbers: 0, graph: 0 };

/**
 * The vertical profile at a height share `hc` of the cloud's own column (the contract's form): risen over `rise`, fallen
 * from `fallFrom` to `fallTo`, nothing above the column's top.
 */
export function profileOf<N>(o: ShapeOps<N>, p: ShapeProfile<N>, hc: N): N {
  const up = o.smoothstep(o.k(0), o.max(p.rise, o.k(1e-3)), hc);
  const down = o.sub(o.k(1), o.smoothstep(p.fallFrom, o.max(p.fallTo, o.add(p.fallFrom, o.k(1e-3))), hc));
  return o.mul(up, down);
}

/**
 * The extinction (per metre) of a layer's cloud at a point: `s` the point's inputs, `p` the layer's types' profile blended at
 * the point's mix weights, `look` the look's dials. Nought outside the column and where the cover cut leaves no cloud.
 */
export function shapeOf<N>(o: ShapeOps<N>, s: ShapeIn<N>, p: ShapeProfile<N>, look: ShapeLook<N>): N {
  if (o === (SHAPE_NUM as unknown)) SHAPE_CALLS.numbers++;
  else SHAPE_CALLS.graph++;
  const one = o.k(1);
  // 1. The height share of the cloud's own column: the cell's top from the map (one where the layer is continuous) times the
  //    types' column in the layer (`reach`: a fair heap in a deck that also holds storm towers stands its own height).
  const column = o.max(o.mul(s.top, p.reach), o.k(0.02));
  const hc = o.clamp01(o.div(s.h, column));
  const inside = o.sub(one, o.smoothstep(o.k(0.999), o.k(1.0), o.div(s.h, column)));
  // 2. The profile.
  const env = o.mul(profileOf(o, p, hc), inside);
  // 3. The cover at this height: narrowed toward the top by the taper, spread near the top by the anvil (a power under one
  //    lifts a low cover toward one, so the anvil reaches out past the tower's own cell). Each window and power a dial.
  const narrowed = o.mul(s.cover, o.mix(one, o.sub(one, p.taper), o.smoothstep(look.taperFrom, one, hc)));
  const spread = o.mul(p.anvil, o.smoothstep(look.anvilFrom, o.max(look.anvilTo, o.add(look.anvilFrom, o.k(1e-3))), hc));
  const covH = o.pow(o.max(narrowed, o.k(1e-4)), o.mix(one, look.anvilPower, spread));
  // 4. The low-frequency shape: the billows dilated by the Worley octaves for a billowy type, the octaves alone for a wispy one.
  const wf = o.add(o.add(o.mul(s.low1, o.k(0.625)), o.mul(s.low2, o.k(0.25))), o.mul(s.low3, o.k(0.125)));
  const billows = o.clamp01(remapOf(o, s.low0, o.sub(wf, one), one, o.k(0), one));
  const base = o.mul(o.mix(wf, billows, p.billow), env);
  // 5. The cover cut over the edge's band, times the cover (a thin cover makes thin clouds); a billowy type's cut, and a
  //    fibrous one's (its erosion high: cirrus), never takes the whole cover, so its noise carves the heap to its heart and
  //    the streaks out of a wisp (`carve`); a sheet (both low) keeps its whole cover.
  const covC = o.mul(covH, o.sub(one, o.mul(look.carve, o.max(p.billow, p.erosion))));
  const width = o.max(o.mul(covC, o.mix(look.edgeHard, look.edgeSoft, s.edge)), o.k(1e-3));
  const cut = o.mul(o.clamp01(o.div(o.sub(base, o.sub(one, covC)), width)), covH);
  // 6. The erosion: the detail's octaves, wispy at the base and billowy above, eat the edge.
  const df = o.add(o.add(o.mul(s.det0, o.k(0.625)), o.mul(s.det1, o.k(0.25))), o.mul(s.det2, o.k(0.125)));
  const dmod = o.mix(df, o.sub(one, df), o.clamp01(o.div(hc, o.max(look.wispyBand, o.k(1e-3)))));
  const bite = o.clamp01(o.mul(o.mul(dmod, p.erosion), look.erosion));
  // At most `bite` of the cut is eaten (a third to start), less at a soft edge (to `softBite` of it at the softest), so a soft
  // edge stays a soft band rather than being eaten away.
  const eroded = o.clamp01(remapOf(o, cut, o.mul(o.mul(bite, look.bite), o.mix(one, look.softBite, s.edge)), one, o.k(0), one));
  // 7. The density, per metre.
  return o.mul(o.mul(o.mul(eroded, p.density), s.layerDensity), look.sigma);
}

/** A profile record of numbers (the twin's), filled from the contract's packed type slots blended by weights. */
export function blendProfile(types: Float32Array, t0: number, t1: number, t2: number, w0: number, w1: number, w2: number, out: ShapeProfile<number>): ShapeProfile<number> {
  const V = CLOUD_TYPE_VEC4 * 4;
  const a = t0 * V;
  const b = t1 * V;
  const c = t2 * V;
  const at = (k: number): number => types[a + k] * w0 + types[b + k] * w1 + types[c + k] * w2;
  out.rise = at(0);
  out.fallFrom = at(1);
  out.fallTo = at(2);
  out.anvil = at(3);
  out.billow = at(5);
  out.erosion = at(6);
  out.density = at(8);
  out.taper = at(10);
  // The column: the blended thickness over the tallest of the layer's three slots' (a layer of one type has all three alike).
  out.reach = at(11) / Math.max(Math.max(types[a + 11], types[b + 11]), Math.max(types[c + 11], 1));
  return out;
}

/** A fresh profile record (numbers). */
export function newProfile(): ShapeProfile<number> {
  return { rise: 0, fallFrom: 0, fallTo: 0, anvil: 0, billow: 0, erosion: 0, taper: 0, density: 0, reach: 1 };
}

/** Set the look's dials from the console (each held to its range): answers what was held or refused, in words. */
export function tuneLook(o: Record<string, unknown>): string[] {
  const said: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (!(k in CLOUD_LOOK)) {
      said.push(`${k} is not a look dial (${Object.keys(CLOUD_LOOK).join(', ')})`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      said.push(`${k} wants a number`);
      continue;
    }
    const [lo, hi] = CLOUD_LOOK_RANGE[k as keyof typeof CLOUD_LOOK];
    const c = v < lo ? lo : v > hi ? hi : v;
    if (c !== v) said.push(`${k} held to ${c} (its range ${lo} to ${hi})`);
    (CLOUD_LOOK as Record<string, number>)[k] = c;
  }
  return said;
}
