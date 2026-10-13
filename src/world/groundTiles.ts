// The ground drawn the client's way (materials and ground pass, wave 5): where the mesh stands, and
// what each of its 4 m tiles is made of. Pure, no imports, so the node tests and the next wave's grass
// read the very rules the ground is built by (`groundTiles.test.ts`, `groundAlign.test.ts`).
//
// **The mesh on the client's height points.** The generator's poles stand every 2 m in the terrain's own
// space, and game x is the layout centre less the terrain's x. A near chunk put a vertex every 2 m from a
// multiple of 64 in game space, so on every world whose centre is odd in an axis (12 of the 19) every
// vertex stood a metre off a pole and the client's fans were never drawn: Naboo's ground was out by up
// to 3.8 m and Talus's by 24 m at the worst spot, and the physics heightfield with it. `groundChunkOrigin`
// moves a chunk's ground by the centre's remainder in each axis, and it is the one function the mesh, the
// heightfield, the far tiles and their cut all go through. The streaming buckets (which chunk a place is
// in, for the flora, the props and the layout) keep their own multiples of 64: a ground mesh that sits a
// metre over its bucket's edge is still that bucket's.
//
// **A tile's layers.** The client blends families tile by tile: every 4 m tile takes the families at its
// four corner poles (after the generator laid them on its 8 m pattern), draws the lowest of them whole
// and lays each of the others over it through one of three painted masks of its own -- one corner, one
// side, three corners -- turned to the corners that family holds (the masks and the chain of lerps are the
// client's, read from its tile shader templates; which corner pattern takes which mask and turn is the
// geometry of the masks themselves). Two opposite corners have no mask of their own; they take the
// stronger of two quarters, which keeps every edge matching (ours, `opposite`). Which family is at the
// bottom is ours too (`order`): the first one the terrain's family list names, which is the place the
// engine keeps as a family's priority; which end the client put on top is not in the copy. Each layer
// takes the child its family's choice byte picks at the first corner holding it (ours, `childCorner`).
//
// Every 2 m cell lies inside one tile, so every triangle carries its tile's data whole, on all three of its
// vertices (one vertex a corner a triangle, as the ground was already built), and each vertex carries its
// place in its tile. A far tile is the same with each of its 16 m quads taken as a tile of its own.

/** The pole lattice's spacing, metres (two poles a 4 m tile on every retail world). */
export const POLE_STEP = 2;

/**
 * Whether a terrain's tiles are the ones the tile program is built for: two poles a tile, a pole every near
 * chunk vertex (`CHUNK_SIZE / CHUNK_RES`, 2 m). True on every ground world but the copies' (`dungeon1`, whose
 * file says 16 m tiles and 8 m poles, and whose ground is never drawn): a world it is false for keeps the
 * program of before, since its cells would be laid on tiles of the wrong size with nothing to say so.
 */
export function tilesFit(tileWidth: number): boolean {
  return Math.abs(tileWidth - 2 * POLE_STEP) < 1e-6;
}

/**
 * How the ground is drawn, the parts that are ours (the masks' shapes, the 4 m repeat, the 8 m pattern and
 * the colour arithmetic are the client's). A sibling of the generator's `TERRAIN_GROUND_TUNE` (which says
 * how the generator chooses) under a name of its own, since `GROUND_TUNE` is the people's ground skill.
 *
 *  - `colour`: the colour map's tint. `'client'` the byte as it stands, decoded from the client's gamma, as
 *    the client multiplied all of the terrain's light by it once; `'normalised'` (ours, the default) the same
 *    scaled so the world's median brightness is today's, its hue kept, so the ground does not go dark;
 *    `'channels'` each channel scaled to its own median, the world's hue cast taken out too; `'off'` none.
 *  - `gainCap`: no pole's tint ever brightens the ground past this (ours), in the normalised and per-channel modes.
 *  - `order`: `'first'` puts the first-listed family at the bottom of a tile, `'last'` the other end (ours).
 *  - `childCorner`: the corners asked for a layer's choice, in order (ours).
 *  - `opposite`: two opposite corners' mask, the stronger of two quarters (`'max'`) or their sum held to one (`'add'`).
 *  - `masks`: the client's painted masks, or `false` for a hard step at a half (to compare).
 *  - `mirror`: the pictures the client's way round (along the terrain's own x), inferred from our code;
 *    `false` is the way they were drawn before, mirrored against the terrain.
 *  - `shine`: `'highlight'` (today's: the gloss mask lowers the roughness), `'flat'` (the client's reading of a
 *    specular power of nought: a flat add of the gloss under each light, inferred) or `'off'`.
 *  - `flat`: the flat add's strength, the client's at 1.
 *  - `children`: every alternate of a family, or only its first, the client's own `shaderGroupUseFirstChildOnly`.
 *  - `clouds`: the client's cloud shadows over the lit ground, built and off until looked at (`on` ours,
 *    `strength` 1 the client's).
 */
export const GROUND_DRAW_TUNE = {
  colour: 'normalised' as GroundColour,
  gainCap: 1.6,
  order: 'first' as 'first' | 'last',
  childCorner: ['sw', 'se', 'nw', 'ne'] as CornerName[],
  opposite: 'max' as 'max' | 'add',
  masks: true,
  mirror: true,
  shine: 'highlight' as GroundShine,
  flat: 1,
  children: true,
  clouds: { on: false, strength: 1 },
};
export type GroundColour = 'off' | 'client' | 'normalised' | 'channels';
export type GroundShine = 'highlight' | 'flat' | 'off';
export type CornerName = 'sw' | 'se' | 'nw' | 'ne';

/** The colour modes in the order the shader numbers them. */
export const COLOUR_MODES: readonly GroundColour[] = ['off', 'client', 'normalised', 'channels'];

/** Where a world's near ground stands against the 64 m buckets: a remainder each way, 0 or 1 on every retail world. */
export interface GroundShift {
  readonly x: number;
  readonly z: number;
}
export const NO_SHIFT: GroundShift = { x: 0, z: 0 };

const mod = (v: number, m: number) => ((v % m) + m) % m;

/**
 * The shift that puts every vertex 2 m apart from a chunk's origin on a pole: game x = centre x - terrain x,
 * and a pole's terrain x is a multiple of 2, so a vertex's game x must share the centre's remainder; game z =
 * terrain z - centre z, so a vertex's game z must share the negated centre's.
 */
export function groundShift(centerX: number, centerZ: number, step = POLE_STEP): GroundShift {
  return { x: mod(centerX, step), z: mod(-centerZ, step) };
}

/**
 * The game-space corner a chunk's ground (or a far tile, with its own size) starts at: its bucket's corner,
 * moved by the world's shift. The mesh, the physics heightfield, the far tiles and the far tiles' cut all ask
 * this one function.
 */
export function groundChunkOrigin(cx: number, cz: number, shift: GroundShift = NO_SHIFT, size = 64): { x: number; z: number } {
  return { x: cx * size + shift.x, z: cz * size + shift.z };
}

/** Which chunk's ground covers a game-space coordinate along one axis: the inverse of `groundChunkOrigin` there. */
export function groundChunkAt(v: number, shiftAxis: number, size = 64): number {
  return Math.floor((v - shiftAxis) / size);
}

// ---------------------------------------------------------------- corners and masks

/** A tile's corners as bits, in the terrain's own space (south is low z, west low x). */
export const SW = 1;
export const SE = 2;
export const NW = 4;
export const NE = 8;
/** The corners by index, in the order a tile's four families are handed over. */
export const CORNER_BITS = [SW, SE, NW, NE] as const;
export const CORNER_NAMES: readonly CornerName[] = ['sw', 'se', 'nw', 'ne'];

/** The client's three masks, in the order the mask array holds them, and the opposite pair made of quarters. */
export const MASK_QUARTER = 0;
export const MASK_HALF = 1;
export const MASK_THREEQUARTER = 2;
export const MASK_OPPOSITE = 3;

/**
 * Each mask as the converter wrote it (measured on the PNGs): the quarter covers the image's top-left corner,
 * the half its left side, the three-quarter every corner but the bottom-right. A tile's (s, t) -- s along the
 * terrain's x, t along its z, nought at the south-west corner -- is turned onto the image's (u, v) a quarter
 * turn at a time, so each mask reaches every corner or side:
 *   k = 0: (s, t)         the quarter on SW, the half on the west, the three-quarter leaving NE
 *   k = 1: (t, 1 - s)     SE, the south, leaving NW
 *   k = 2: (1 - s, 1 - t) NE, the east, leaving SW
 *   k = 3: (1 - t, s)     NW, the north, leaving SE
 */
export function turnTile(s: number, t: number, k: number, out: [number, number]): [number, number] {
  switch (k & 3) {
    case 0:
      out[0] = s;
      out[1] = t;
      break;
    case 1:
      out[0] = t;
      out[1] = 1 - s;
      break;
    case 2:
      out[0] = 1 - s;
      out[1] = 1 - t;
      break;
    default:
      out[0] = 1 - t;
      out[1] = s;
  }
  return out;
}

/** A mask's code, as the vertex carries it: nought for none, else one plus four times its kind plus its turn. */
const CODE_OF = (() => {
  const c = new Uint8Array(16);
  const code = (kind: number, k: number) => 1 + kind * 4 + k;
  c[SW] = code(MASK_QUARTER, 0);
  c[SE] = code(MASK_QUARTER, 1);
  c[NE] = code(MASK_QUARTER, 2);
  c[NW] = code(MASK_QUARTER, 3);
  c[SW | NW] = code(MASK_HALF, 0);
  c[SW | SE] = code(MASK_HALF, 1);
  c[SE | NE] = code(MASK_HALF, 2);
  c[NW | NE] = code(MASK_HALF, 3);
  c[SW | SE | NW] = code(MASK_THREEQUARTER, 0);
  c[SW | SE | NE] = code(MASK_THREEQUARTER, 1);
  c[SE | NW | NE] = code(MASK_THREEQUARTER, 2);
  c[SW | NW | NE] = code(MASK_THREEQUARTER, 3);
  // The opposite pairs: the quarter at k and the quarter at k + 2.
  c[SW | NE] = code(MASK_OPPOSITE, 0);
  c[SE | NW] = code(MASK_OPPOSITE, 1);
  return c;
})();

/** The mask code for the corners a family holds in a tile: nought for none, and for all four (which is no overlay). */
export function maskCode(corners: number): number {
  return CODE_OF[corners & 15];
}

/** A code's kind (`MASK_*`), or -1 for none. */
export function maskKind(code: number): number {
  return code > 0 ? (code - 1) >> 2 : -1;
}

/** A code's quarter turns. */
export function maskTurn(code: number): number {
  return code > 0 ? (code - 1) & 3 : 0;
}

/** The place of a vertex in its tile, as the vertex carries it: s and t each 0, 1 or 2 halves of the tile. */
export function tileCode(s2: number, t2: number): number {
  return s2 * 3 + t2;
}

/** The other way: the place in [0, 1] each way. */
export function tilePlace(code: number, out: [number, number]): [number, number] {
  const s2 = Math.floor(code / 3);
  out[0] = s2 * 0.5;
  out[1] = (code - 3 * s2) * 0.5;
  return out;
}

/**
 * What draws a tile: the rank a family is drawn at (lower first), the texture array's layer for a family and
 * a pole's choice byte, and the corners asked for that choice, in order (indices into SW, SE, NW, NE).
 */
export interface GroundTiler {
  rank(family: number): number;
  layer(family: number, choice: number): number;
  readonly corners: readonly number[];
}

const scratchFams = new Int32Array(4);
const scratchBits = new Int32Array(4);

/**
 * One tile's layers out of its four corners (`fams` and `choices` in SW, SE, NW, NE order): writes the array
 * layers bottom first into `layers[at..at + 4]` (the unused ones repeat the top layer) and the overlays' mask
 * codes into `codes[at..at + 3]` (nought past the last), and answers how many layers the tile holds.
 */
export function tileLayers(fams: ArrayLike<number>, choices: ArrayLike<number>, tiler: GroundTiler, layers: Uint8Array | number[], codes: Uint8Array | number[], at = 0, codeAt = at): number {
  let count = 0;
  for (let c = 0; c < 4; c++) {
    const f = fams[c];
    let k = 0;
    while (k < count && scratchFams[k] !== f) k++;
    if (k === count) {
      scratchFams[count] = f;
      scratchBits[count] = 0;
      count++;
    }
    scratchBits[k] |= CORNER_BITS[c];
  }
  // Bottom first, by rank; the corners' own order breaks a tie, so the result never hangs on a sort's whim.
  for (let i = 1; i < count; i++) {
    const f = scratchFams[i];
    const b = scratchBits[i];
    const r = tiler.rank(f);
    let j = i - 1;
    while (j >= 0 && tiler.rank(scratchFams[j]) > r) {
      scratchFams[j + 1] = scratchFams[j];
      scratchBits[j + 1] = scratchBits[j];
      j--;
    }
    scratchFams[j + 1] = f;
    scratchBits[j + 1] = b;
  }
  for (let i = 0; i < 4; i++) {
    const li = Math.min(i, count - 1);
    const f = scratchFams[li];
    let choice = choices[0];
    for (const c of tiler.corners) {
      if (fams[c] === f) {
        choice = choices[c];
        break;
      }
    }
    layers[at + i] = tiler.layer(f, choice);
  }
  for (let i = 1; i < 4; i++) codes[codeAt + i - 1] = i < count ? maskCode(scratchBits[i]) : 0;
  return count;
}

/** The corners' indices for `childCorner`'s names, any missing ones appended in the client's own order. */
export function cornerOrder(names: readonly string[]): number[] {
  const out: number[] = [];
  for (const n of names) {
    const i = CORNER_NAMES.indexOf(n as CornerName);
    if (i >= 0 && !out.includes(i)) out.push(i);
  }
  for (let i = 0; i < 4; i++) if (!out.includes(i)) out.push(i);
  return out;
}
