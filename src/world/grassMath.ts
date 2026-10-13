// The terrain's radial flora placed, as arithmetic (materials and ground pass, waves 5b and 5c): where the grass
// and the far hills' tree cards stand, which child, how big and how they sway, and the knobs. Pure: no three and
// no DOM, so a node test runs the very placement the game runs (`grassPlace.test.ts`); `grass.ts` draws it.
//
// **Where a tuft stands.** One candidate a tile of the terrain's own near tiling (1 to 2 m), at the tile's middle
// moved by up to the tiling's border each way, drawn from a generator seeded with the tile's corner (the static
// flora's own seed). The border read as a jitter is ours: read as the static tiling's border it would leave a
// window of 4 cm on Tatooine's and Corellia's 1 m tiles, a lattice of tufts in rows; where it is nought (Dantooine,
// Endor, Rori, Yavin 4 and Kashyyyk's two dungeon zones, six of the sixteen worlds that plant) a floor of ours
// (`jitterMin`) stands in. The family is the pole's own near family, the
// generator's; the child, the yaw and the size are rolled per tile from the tile's own generator (ours: read off the
// pole's choice byte every 2 x 2 m cell would be four copies of one child).
//
// **What drops a tuft.** No family, the generator's exclusion (AEXC), a circle something stood keeps flora off,
// a shader the pack has no picture for, and the drawn water over its foot unless its shader is meant for water
// (ours: 21.9% of Naboo's near poles are under water). The base height is the client's own ground at the foot,
// read from a cached block only; nothing here ever generates a block.
//
// **How it sways** (ours, the client's own values where it flagged them): the amplitude is the child's
// displacement times `GRASS_SWAY.amp` where the child is flagged, else the trees' law by height; the period is
// the child's own times `periodScale`, floored at `periodMin`, else the trees' law; a stiff child (a mushroom, a
// spike, a post) does not move. The frequencies are whole cycles in the sway's wrap, as the trees' are.

import { FastRandomGenerator, hashTuple, type RadialChild, type RadialGroup } from '../swg/terrain/flora.ts';
import type { RadialShaderEntry } from '../swg/terrain/radialFile.ts';
import type { FloraTiling, RadialPole } from '../swg/terrain/trn.ts';
import { cyclesPerWrap, omegaOf, swayPeriod, type SwayTune } from './swayMath.ts';

/** The grass's knobs (`__debug.grass`). Each says whose it is; `live` ones are uniforms, `rebuild` ones build the grass again. */
export interface GrassTune {
  /** Grass at all (ours; live). */
  on: boolean;
  /** How far it reaches, metres: null is the world's own near tiling (20 to 32 m; the client's file) times `reachScale`, a number holds it (uniform). */
  reach: number | null;
  /** The world's own reach is taken times this (the Graphics page's "Grass distance", ours; uniform, and the window follows). */
  reachScale: number;
  /** How it fades at its edge (answer 9: it fades): `shrink` each tuft scales to nothing about its foot across the band; `dither` a stipple, to compare; `child` reads the child's own distance as its cut-off (uniform). */
  fade: 'shrink' | 'dither' | 'child';
  /** The band at the edge, a share of the reach (ours; uniform). */
  fadeBand: number;
  /** Chunks across the window built round the eye now: worked out from the reach in force (`grassWindowFor`) unless `windowHold` holds one (ours). */
  window: number;
  /** A window the console typed, held over the worked-out one until `window: null` (ours). */
  windowHold: number | null;
  /** The alpha cut, the larger of this and the shader's own reference (ours; uniform). */
  cutoff: number;
  /** How much a tuft's alpha is raised a mip level (ours, the trees' fit, unmeasured on grass; uniform). */
  mipScale: number;
  /** `eye`: a plain tuft turns about its up to face the eye (answer 8, the client's); `fixed` its own yaw, to compare (uniform). */
  facing: 'eye' | 'fixed';
  /** The child rolled per tile (ours) or read off the pole's choice byte (rebuild). */
  perTile: boolean;
  /** The jitter, metres: null is the tiling's own border (the client's), a number holds it (rebuild). */
  jitter: number | null;
  /** The jitter where the border is nought, a share of the tile (ours; rebuild). */
  jitterMin: number;
  /** `colourMap`: the colour map's tint as the client wrote it (answer 10); `ground`: the ground's own colour mode (`GROUND_DRAW_TUNE.colour`) (uniform). */
  tint: 'colourMap' | 'ground';
  /** `drop`: no tuft under the drawn water but one meant for water (ours); `keep`: the data's own (rebuild). */
  water: 'drop' | 'keep';
  /** A share of the candidates kept (ours; rebuild). */
  density: number;
}

export const GRASS_DEFAULTS: Readonly<GrassTune> = {
  on: true,
  reach: null,
  reachScale: 1,
  fade: 'shrink',
  fadeBand: 0.25,
  window: 3,
  windowHold: null,
  cutoff: 0.5,
  mipScale: 0.1,
  facing: 'eye',
  perTile: true,
  jitter: null,
  jitterMin: 0.3,
  // The owner's, having looked (2026-10-13): the ground's own colour rule reads better on the grass than the client's raw colour map.
  tint: 'ground',
  water: 'drop',
  density: 1,
};

/**
 * The chunks across the window round the eye a reach needs: odd, so the eye's own chunk is the middle, wide enough
 * that a tuft at the reach's end has its chunk built from anywhere in the eye's chunk, and never past nine. Three
 * at the worlds' own reaches of 20 to 32 m, as the window always was.
 */
export function grassWindowFor(reach: number): number {
  if (!(reach > 0)) return 1;
  return Math.min(9, 2 * Math.ceil(reach / 64) + 1);
}

/** How grass sways (ours, `__debug.grass({ sway })`): its own numbers beside the trees' (`SWAY_TUNE`, whose wind, clock and calm it shares). */
export interface GrassSway {
  /** Metres of amplitude per unit of a flagged child's displacement (uniform). */
  amp: number;
  /** Seconds per unit of a flagged child's period, and the shortest period (rebuild: the frequencies are quantised as a chunk is built). */
  periodScale: number;
  periodMin: number;
  /** The client's own values where it flagged a child (our scaling), or the trees' law for every tuft (uniform). */
  useChild: boolean;
  /** What a child's shader is named for when it is stiff (rebuild). */
  stiff: RegExp;
}

export const GRASS_SWAY_DEFAULTS: Readonly<GrassSway> = {
  amp: 0.5,
  periodScale: 3,
  periodMin: 0.6,
  useChild: true,
  stiff: /shroom|mushroom|fngi|fungus|toadstool|spike|post|stake|pole|rock|stone|pebble|bone|skull|debris|crystal|crystl|coral|shell|urchin|cactus|wires|sign/i,
};

/** The far hills' tree cards' knobs (`__debug.farCards`), all ours. */
export interface FarCardTune {
  /** The far cards at all (live). */
  on: boolean;
  /** How far they reach, metres: null is the world's far tiling's own end (500 to 1000 m) times `reachScale`, a number holds it (uniform). */
  reach: number | null;
  /** The far tiling's own end is taken times this (the Graphics page's "Far tree card distance"; uniform). */
  reachScale: number;
  /** The band they shrink across at that end, a share of the reach (uniform). */
  fadeBand: number;
  /** The jitter where the far tiling's border is nought, a share of its tile (rebuild). */
  jitterMin: number;
  /** As the grass's (rebuild). */
  water: 'drop' | 'keep';
  /** Far tiles' cards built a frame (ours). */
  perFrame: number;
}

export const FAR_CARD_DEFAULTS: Readonly<FarCardTune> = { on: true, reach: null, reachScale: 1, fadeBand: 0.1, jitterMin: 0.3, water: 'drop', perFrame: 1 };

/**
 * Whether the grass and the far cards cast the sun's shadow and take it (wave 8), all ours. The client's grass cast
 * nothing (its program samples no shadow and its stencil volumes came only from opaque effects), so casting starts
 * off; taking the shadow starts on, since sunlit grass on shaded ground is the worst look there is, and the client's
 * volumes darkened whatever was drawn inside them.
 */
export interface GrassShadowTune {
  /** Near grass casts (the page's "Grass casts shadows"). */
  cast: boolean;
  /** The far cards cast (the page's "Far tree cards cast shadows"). */
  farCast: boolean;
  /** Near grass takes the sun's shadow (the page's "Shadows fall on grass"). */
  receive: boolean;
  /** The far cards take it (with the same switch on the page). */
  farReceive: boolean;
  /** The most cascades a near tuft is drawn into; each only while its near edge is inside the grass's reach. */
  castCascades: number;
  /** Which way a casting tuft faces: `eye` as the drawn quad does, `sun` across the sun (still, but no longer the quad you see). */
  castFacing: 'eye' | 'sun';
  /** The alpha cut in the shadow's raster. */
  castCut: number;
  /** A receiving lookup is moved toward the sun by this share of the tuft's larger side, so a tuft never shades itself. */
  lift: number;
}

export const GRASS_SHADOW_DEFAULTS: Readonly<GrassShadowTune> = Object.freeze({ cast: false, farCast: false, receive: true, farReceive: true, castCascades: 3, castFacing: 'eye', castCut: 0.5, lift: 1 });

export const GRASS_SHADOW_TUNE: GrassShadowTune = { ...GRASS_SHADOW_DEFAULTS };

/** Move the grass's shadow knobs: anything not a usable value is left as it was. Answers whether a caster's switch moved (the caller walks the meshes). */
export function setGrassShadowTune(o: Partial<GrassShadowTune>, t: GrassShadowTune = GRASS_SHADOW_TUNE): boolean {
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  let moved = false;
  if (typeof o.cast === 'boolean' && o.cast !== t.cast) {
    t.cast = o.cast;
    moved = true;
  }
  if (typeof o.farCast === 'boolean' && o.farCast !== t.farCast) {
    t.farCast = o.farCast;
    moved = true;
  }
  if (typeof o.receive === 'boolean') t.receive = o.receive;
  if (typeof o.farReceive === 'boolean') t.farReceive = o.farReceive;
  if (num(o.castCascades)) t.castCascades = Math.min(3, Math.max(0, Math.round(o.castCascades)));
  if (o.castFacing === 'eye' || o.castFacing === 'sun') t.castFacing = o.castFacing;
  if (num(o.castCut)) t.castCut = Math.min(1, Math.max(0, o.castCut));
  if (num(o.lift) && o.lift >= 0) t.lift = o.lift;
  return moved;
}

/**
 * How many cascades near grass casts into: the first, and each further one whose near edge (the cascade before it's
 * end, metres from the eye, `ends[i - 1]`) is under the grass's reach, at most `most`. Nothing at all past what the
 * reach can see: at the defaults (a 320 m Shadow distance, its first cascade ending about 54 m out, a reach of 20 to
 * 32 m) the first alone.
 */
export function grassCastCascades(reach: number, ends: ArrayLike<number>, most: number): number {
  const cap = Math.min(Math.max(0, Math.floor(most)), ends.length);
  if (cap <= 0 || !(reach > 0)) return 0;
  let n = 1;
  while (n < cap && ends[n - 1] < reach) n++;
  return n;
}

/**
 * A child's shader named for water, kept under the drawn water (ours, a name test over the 209 retail radial
 * shaders): the underwater seagrass, sea plant and urchins, the swamp's cattails and reeds, the shore's tails,
 * the lilies and the wavy weeds.
 */
export const MEANT_FOR_WATER = /uwtr|swmp_cattails|swmp_reeds|shor_tails|lilly|lily|waveyweeds/i;

/** Bits of a tuft's flags. */
export const TUFT_PLUS = 1;
export const TUFT_ALIGN = 2;
export const TUFT_FAR = 4;
export const TUFT_HIDDEN = 8;
export const TUFT_GLOW = 16;
export const TUFT_FADE = 32;
/** A far card shown over a near chunk standing with its trees hidden (a short Tree distance): lifted onto the coarse height, since the far tile it was dropped for is cut away there. */
export const TUFT_LIFT = 64;

/** What a tuft's sway field says when it is not a flagged child's displacement. */
export const SWAY_LAW = -1;
export const SWAY_STIFF = -2;

/** The instance data of one chunk's or one far tile's tufts, four floats a field (three for the normal), `count` of them filled. */
export interface TuftBuffers {
  count: number;
  /** x, the base's height, z, yaw. */
  tuft: Float32Array;
  /** width, height, layer, flags. */
  size: Float32Array;
  /** the colour map's bytes over 255, and the shader's alpha reference over 255. */
  tint: Float32Array;
  /** the flagged displacement (or `SWAY_LAW`, `SWAY_STIFF`), the child's frequency, the child's own distance, the law's frequency. */
  sway: Float32Array;
  /** the ground's normal at the foot, the game's frame. */
  normal: Float32Array;
}

export function tuftBuffers(capacity: number): TuftBuffers {
  return { count: 0, tuft: new Float32Array(capacity * 4), size: new Float32Array(capacity * 4), tint: new Float32Array(capacity * 4), sway: new Float32Array(capacity * 4), normal: new Float32Array(capacity * 3) };
}

/** The same buffers cut to what was filled, each its own array (what goes to the card). */
export function trimBuffers(b: TuftBuffers): TuftBuffers {
  const n = b.count;
  return { count: n, tuft: b.tuft.slice(0, n * 4), size: b.size.slice(0, n * 4), tint: b.tint.slice(0, n * 4), sway: b.sway.slice(0, n * 4), normal: b.normal.slice(0, n * 3) };
}

/** The reach the grass runs to: the tune's metres, else the world's own near tiling's end (the client's file) times the page's scale. */
export function grassReach(tiling: FloraTiling, tune: Pick<GrassTune, 'reach'> & Partial<Pick<GrassTune, 'reachScale'>>): number {
  return tune.reach ?? (tiling.maximumDistance > 0 ? tiling.maximumDistance : 30) * (tune.reachScale ?? 1);
}

/** The far cards' reach: the tune's metres, else the far tiling's own end times the page's scale. */
export function farReach(tiling: FloraTiling, tune: Pick<FarCardTune, 'reach'> & Partial<Pick<FarCardTune, 'reachScale'>>): number {
  return tune.reach ?? (tiling.maximumDistance > 0 ? tiling.maximumDistance : 500) * (tune.reachScale ?? 1);
}

/** How far a candidate moves from its tile's middle each way: the tiling's border, the tune's where it holds one, the floor where the border is nought; never past half a tile. */
export function jitterOf(tiling: FloraTiling, jitter: number | null, jitterMin: number): number {
  const tile = tiling.tileSize;
  const j = jitter ?? (tiling.tileBorder > 0 ? tiling.tileBorder : jitterMin * tile);
  return Math.min(Math.max(0, j), tile / 2);
}

/** A tuft's sway field and its two frequencies: the flagged displacement (or the law, or stiff), the child's, the law's. */
export function tuftSway(child: RadialChild, height: number, sway: GrassSway, trees: Pick<SwayTune, 'periodBase' | 'periodPow' | 'wrap'>, out: { disp: number; omegaChild: number; omegaLaw: number }): void {
  const lawOmega = omegaOf(cyclesPerWrap(swayPeriod(height, trees), trees.wrap), trees.wrap);
  out.omegaLaw = lawOmega;
  if (sway.stiff.test(child.shader)) {
    out.disp = SWAY_STIFF;
    out.omegaChild = 0;
    return;
  }
  if (child.shouldSway && child.displacement > 0) {
    out.disp = child.displacement;
    const period = Math.max(sway.periodMin, child.period * sway.periodScale);
    out.omegaChild = omegaOf(cyclesPerWrap(period, trees.wrap), trees.wrap);
  } else {
    out.disp = SWAY_LAW;
    out.omegaChild = lawOmega;
  }
}

/** What placing reads of the world, in the game's frame, cached blocks only. `SwgTerrain` answers it. */
export interface GrassSource {
  radialPoleIfCached(gx: number, gz: number, far: boolean, out: RadialPole): boolean;
  waterAt(gx: number, gz: number): number;
  toSwgX(gx: number): number;
  toSwgZ(gz: number): number;
  toGameX(x: number): number;
  toGameZ(z: number): number;
}

/** A circle flora is kept off, the game's frame. */
export interface FloraCircle {
  x: number;
  z: number;
  r: number;
}

/** What a placement run counted, for the console. */
export interface PlaceStats {
  candidates: number;
  placed: number;
  noFamily: number;
  excluded: number;
  circles: number;
  water: number;
  noPicture: number;
  notCached: number;
}

export function placeStats(): PlaceStats {
  return { candidates: 0, placed: 0, noFamily: 0, excluded: 0, circles: 0, water: 0, noPicture: 0, notCached: 0 };
}

/** One candidate's rolls, from its tile's own generator, in one fixed order whatever the knobs. */
interface Rolls {
  jx: number;
  jz: number;
  child: number;
  yaw: number;
  width: number;
  height: number;
  keep: number;
}
const rolls: Rolls = { jx: 0, jz: 0, child: 0, yaw: 0, width: 0, height: 0, keep: 0 };
const rng = new FastRandomGenerator();
function roll(tx: number, tz: number, tile: number): Rolls {
  rng.setSeed(hashTuple(tx * tile, tz * tile));
  rolls.jx = rng.randomFloat();
  rolls.jz = rng.randomFloat();
  rolls.child = rng.randomFloat();
  rolls.yaw = rng.randomFloat();
  rolls.width = rng.randomFloat();
  rolls.height = rng.randomFloat();
  rolls.keep = rng.randomFloat();
  return rolls;
}

const pole: RadialPole = { family: 0, choice: 0, excluded: false, color: 0xffffff, height: 0, nx: 0, ny: 1, nz: 0 };
const swayOut = { disp: 0, omegaChild: 0, omegaLaw: 0 };

/** Write one tuft into the buffers at `out.count`. */
function writeTuft(out: TuftBuffers, gx: number, base: number, gz: number, yaw: number, w: number, h: number, entry: RadialShaderEntry, flags: number, color: number, child: RadialChild, nx: number, ny: number, nz: number): void {
  const i = out.count++;
  const a = i * 4;
  out.tuft[a] = gx;
  out.tuft[a + 1] = base;
  out.tuft[a + 2] = gz;
  out.tuft[a + 3] = yaw;
  out.size[a] = w;
  out.size[a + 1] = h;
  out.size[a + 2] = entry.layer;
  out.size[a + 3] = flags;
  out.tint[a] = ((color >> 16) & 255) / 255;
  out.tint[a + 1] = ((color >> 8) & 255) / 255;
  out.tint[a + 2] = (color & 255) / 255;
  out.tint[a + 3] = entry.alphaRef / 255;
  out.sway[a] = swayOut.disp;
  out.sway[a + 1] = swayOut.omegaChild;
  out.sway[a + 2] = child.distance;
  out.sway[a + 3] = swayOut.omegaLaw;
  const b = i * 3;
  out.normal[b] = nx;
  out.normal[b + 1] = ny;
  out.normal[b + 2] = nz;
}

/** A child's size from its ranges and two rolls: one roll for both where it keeps its aspect. */
function sizeOf(child: RadialChild, r: Rolls, into: { w: number; h: number }): void {
  const tw = r.width;
  const th = child.maintainAspect ? r.width : r.height;
  into.w = child.minWidth + tw * (child.maxWidth - child.minWidth);
  into.h = child.minHeight + th * (child.maxHeight - child.minHeight);
}
const size = { w: 0, h: 0 };

/** A shader's flags beyond the child's own. */
function kindFlags(entry: RadialShaderEntry): number {
  return (entry.kind === 'glow' ? TUFT_GLOW : 0) | (entry.kind === 'fade' ? TUFT_FADE : 0);
}

/** Whether a game-space point lies in any circle. */
function inCircle(circles: readonly FloraCircle[], gx: number, gz: number): boolean {
  for (let k = 0; k < circles.length; k++) {
    const e = circles[k];
    const dx = gx - e.x;
    const dz = gz - e.z;
    if (dx * dx + dz * dz <= e.r * e.r) return true;
  }
  return false;
}

/** The candidates a square of the game's frame holds on a tiling: the tiles whose jittered point can fall inside it. */
function tileRange(src: GrassSource, x0: number, z0: number, sizeM: number, tile: number, j: number): [number, number, number, number] {
  // The game's x runs the other way: the square spans (toSwgX(x0 + size), toSwgX(x0)].
  const xa = src.toSwgX(x0 + sizeM) - j;
  const xb = src.toSwgX(x0) + j;
  const za = src.toSwgZ(z0) - j;
  const zb = src.toSwgZ(z0 + sizeM) + j;
  return [Math.floor(xa / tile), Math.floor(xb / tile), Math.floor(za / tile), Math.floor(zb / tile)];
}

/** Everything a placement needs of the world it places in. */
export interface GrassWorld {
  group: RadialGroup;
  shaders: ReadonlyMap<string, RadialShaderEntry>;
  /** The shader key each child is drawn with (`shaderKey` of its name), worked out once a world. */
  keyOf: (child: RadialChild) => string;
}

/**
 * One chunk's grass: every near-tiling candidate whose point falls in the game-space square [x0, x0 + size) by
 * [z0, z0 + size), written into `out` from `out.count` on. Reads cached blocks only; a candidate whose block is
 * not cached is counted and dropped (the chunk is built only when its ground is, so none should be). Allocates
 * nothing. Answers how many it wrote.
 */
export function placeGrass(src: GrassSource, world: GrassWorld, tiling: FloraTiling, x0: number, z0: number, sizeM: number, circles: readonly FloraCircle[], tune: GrassTune, sway: GrassSway, trees: Pick<SwayTune, 'periodBase' | 'periodPow' | 'wrap'>, out: TuftBuffers, stats: PlaceStats): number {
  const tile = tiling.tileSize;
  if (!(tile >= 0.25)) return 0;
  const j = jitterOf(tiling, tune.jitter, tune.jitterMin);
  const [tx0, tx1, tz0, tz1] = tileRange(src, x0, z0, sizeM, tile, j);
  const start = out.count;
  const cap = out.tuft.length / 4;
  for (let tz = tz0; tz <= tz1; tz++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const r = roll(tx, tz, tile);
      const x = (tx + 0.5) * tile + (r.jx * 2 - 1) * j;
      const z = (tz + 0.5) * tile + (r.jz * 2 - 1) * j;
      const gx = src.toGameX(x);
      const gz = src.toGameZ(z);
      if (gx < x0 || gx >= x0 + sizeM || gz < z0 || gz >= z0 + sizeM) continue;
      stats.candidates++;
      if (tune.density < 1 && r.keep > tune.density) continue;
      if (!src.radialPoleIfCached(gx, gz, false, pole)) {
        stats.notCached++;
        continue;
      }
      if (!pole.family) {
        stats.noFamily++;
        continue;
      }
      if (pole.excluded) {
        stats.excluded++;
        continue;
      }
      const family = world.group.families.get(pole.family);
      const child = family ? family.choose(tune.perTile ? r.child : pole.choice / 255) : null;
      if (!child) {
        stats.noFamily++;
        continue;
      }
      const key = world.keyOf(child);
      const entry = world.shaders.get(key);
      if (!entry) {
        stats.noPicture++;
        continue;
      }
      if (inCircle(circles, gx, gz)) {
        stats.circles++;
        continue;
      }
      if (tune.water === 'drop' && src.waterAt(gx, gz) > pole.height && !MEANT_FOR_WATER.test(key)) {
        stats.water++;
        continue;
      }
      if (out.count >= cap) return out.count - start;
      sizeOf(child, r, size);
      tuftSway(child, size.h, sway, trees, swayOut);
      const flags = (child.createPlus ? TUFT_PLUS : 0) | (child.alignToTerrain ? TUFT_ALIGN : 0) | kindFlags(entry);
      writeTuft(out, gx, pole.height, gz, r.yaw * Math.PI * 2, size.w, size.h, entry, flags, pole.color, child, pole.nx, pole.ny, pole.nz);
      stats.placed++;
    }
  }
  return out.count - start;
}

/** How many candidates a square can hold on a tiling, at most: what a chunk's buffers are made for. */
export function candidateCapacity(tiling: FloraTiling, sizeM: number): number {
  const tile = Math.max(tiling.tileSize, 0.25);
  const across = Math.ceil(sizeM / tile) + 2;
  return across * across;
}

/** A far tile's coarse samples as far cards read them (`FarGrid` in `swgTerrain.ts`, with where its first column stands). */
export interface FarSamples {
  heights: Float32Array;
  colors: Uint8Array;
  radialFar: Uint8Array;
  /** Samples a side, metres between them, and the game place of sample (0, 0). */
  n: number;
  step: number;
  gx0: number;
  gz0: number;
}

/**
 * One far tile's tree cards: every far-tiling candidate whose point falls in the tile's square, its family the far
 * map's at the nearest of the tile's own 16 m samples (the far tile lesson: a coarse grid's own answer, not the near
 * ground's), its height the samples' bilinear one less the far ground's own drop (`drop`, so it stands on the
 * ground drawn there), its tint the nearest sample's colour, its normal straight up. Allocates nothing.
 */
export function placeFarCards(src: GrassSource, world: GrassWorld, tiling: FloraTiling, x0: number, z0: number, sizeM: number, grid: FarSamples, drop: number, circlesAt: (gx: number, gz: number) => readonly FloraCircle[], tune: FarCardTune, out: TuftBuffers, stats: PlaceStats): number {
  const tile = tiling.tileSize;
  if (!(tile >= 1)) return 0;
  const j = jitterOf(tiling, null, tune.jitterMin);
  const [tx0, tx1, tz0, tz1] = tileRange(src, x0, z0, sizeM, tile, j);
  const start = out.count;
  const cap = out.tuft.length / 4;
  const n = grid.n;
  for (let tz = tz0; tz <= tz1; tz++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const r = roll(tx, tz, tile);
      const x = (tx + 0.5) * tile + (r.jx * 2 - 1) * j;
      const z = (tz + 0.5) * tile + (r.jz * 2 - 1) * j;
      const gx = src.toGameX(x);
      const gz = src.toGameZ(z);
      if (gx < x0 || gx >= x0 + sizeM || gz < z0 || gz >= z0 + sizeM) continue;
      stats.candidates++;
      const fx = (gx - grid.gx0) / grid.step;
      const fz = (gz - grid.gz0) / grid.step;
      const i = Math.min(n - 1, Math.max(0, Math.round(fx)));
      const k = Math.min(n - 1, Math.max(0, Math.round(fz)));
      const s = k * n + i;
      const familyId = grid.radialFar[s * 2];
      if (!familyId) {
        stats.noFamily++;
        continue;
      }
      const family = world.group.families.get(familyId);
      const child = family ? family.choose(r.child) : null;
      if (!child) {
        stats.noFamily++;
        continue;
      }
      const key = world.keyOf(child);
      const entry = world.shaders.get(key);
      if (!entry) {
        stats.noPicture++;
        continue;
      }
      if (inCircle(circlesAt(gx, gz), gx, gz)) {
        stats.circles++;
        continue;
      }
      // The samples' own bilinear height, as `SwgTerrain.heightIfCached` reads a far tile.
      const cx = Math.min(n - 1.001, Math.max(0, fx));
      const cz = Math.min(n - 1.001, Math.max(0, fz));
      const ia = Math.floor(cx);
      const ka = Math.floor(cz);
      const u = cx - ia;
      const v = cz - ka;
      const h = grid.heights;
      const ground = (h[ka * n + ia] * (1 - u) + h[ka * n + ia + 1] * u) * (1 - v) + (h[(ka + 1) * n + ia] * (1 - u) + h[(ka + 1) * n + ia + 1] * u) * v;
      if (tune.water === 'drop' && src.waterAt(gx, gz) > ground && !MEANT_FOR_WATER.test(key)) {
        stats.water++;
        continue;
      }
      if (out.count >= cap) return out.count - start;
      sizeOf(child, r, size);
      swayOut.disp = SWAY_STIFF;
      swayOut.omegaChild = 0;
      swayOut.omegaLaw = 0;
      const c = grid.colors;
      const color = (c[s * 3] << 16) | (c[s * 3 + 1] << 8) | c[s * 3 + 2];
      writeTuft(out, gx, ground - drop, gz, r.yaw * Math.PI * 2, size.w, size.h, entry, TUFT_FAR | kindFlags(entry), color, child, 0, 1, 0);
      stats.placed++;
    }
  }
  return out.count - start;
}
