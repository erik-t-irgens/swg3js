// The far tree cards out to the far ground's reach (the horizon pass's fifth wave, A:\swg3js\horizon\DESIGN.md §1b Q11):
// past where a far tile's cards stand (the far tiling's own end, at most the far grids kept for the rings), the same
// cards are drawn on the card from what the bake's own cards file carries (`terrain/horizon-cards.bin`: the colour map's
// bytes and the radial flora's far family every 16 m on the far grids' lattice), with no instance buffer at all: one
// instanced quad drawn levels x cells x cells times, each instance a cell of a square round the eye whose cell doubles a
// level, its card the far tiling's own candidate of the cell's first tile (the very hash, rolls, child, size and yaw a far
// tile's `placeFarCards` gives it, so at the hand-over nothing changes but who draws it), standing on the bake's laid
// heights less the rings' drop, a coarser level's card grown so a forest keeps its cover as its cells widen.
//
// The program is the grass's own text with its five instance attributes made globals the field fills from
// `gl_InstanceID` (`cardFieldVertex`, all or none), its fragment the grass's, its uniforms the grass's and the ring's by
// reference. Off (the Graphics page's Far tree cards to the horizon, `CARD_FIELD_TUNE.on`), nothing of it is fetched,
// made or built. Pure: three's types alone and the grass's and ring's texts, so node runs and scans it.
import * as THREE from 'three';
import { GRASS_VERTEX, grassMaterial, tuftQuads } from '../grass.ts';
import { MEANT_FOR_WATER, TUFT_FADE, TUFT_FAR, TUFT_GLOW, type GrassWorld } from '../grassMath.ts';
import { HORIZON_RING_FUNCTIONS, type RingUniforms } from './horizonRings.ts';
import { LEAF, PATCH } from './horizonMath.ts';
import type { GroundTileUniforms } from '../terrainTextures.ts';
import type { Lattice } from './horizonFile.ts';

/** The field's knobs [ours], live through `__debug.horizon({ cardField })`; `on` is the Graphics page's switch. */
export const CARD_FIELD_TUNE = {
  /** The far tree cards drawn to the far ground's reach (off until its cost is known, §1b Q11). */
  on: false,
  /** Cells a side of each level's square, a multiple of four (level nought's cell is the far tiling's own tile). */
  cells: 128,
  /** A level's card grows by 2^(level x grow): 1 keeps a forest's cover as its cells widen four times a level. */
  grow: 1,
  /** The most levels drawn, each twice the last's cell. */
  levelsMost: 6,
};

/** The field's numbers moved (the console's `horizon({ cardField: { ... } })` and the dials alike), each held to its range. A frame reads them. */
export function tuneCardField(o: { cells?: unknown; grow?: unknown; levelsMost?: unknown }): string {
  const t = CARD_FIELD_TUNE;
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  if (num(o.cells)) t.cells = Math.min(512, Math.max(8, Math.round(o.cells / 4) * 4));
  if (num(o.grow)) t.grow = Math.min(2, Math.max(0, o.grow));
  if (num(o.levelsMost)) t.levelsMost = Math.min(8, Math.max(1, Math.round(o.levelsMost)));
  return `card field: ${t.cells} cells a side, growth ${t.grow} a level, at most ${t.levelsMost} levels`;
}

/** The most children a family's row of the table holds (a family with more draws its first sixteen). */
export const CARD_CHILDREN_MOST = 16;
/** The table's texels a row: two a child (its share, layer, reference and flags; its sizes). */
export const CARD_TABLE_WIDTH = CARD_CHILDREN_MOST * 2;
/** A family is a byte (the far map's `radialFar`), so the table has a row for every one. */
export const CARD_TABLE_ROWS = 256;
/** A child's flags past a byte's seven: it keeps its aspect (one roll for both of its sizes). */
export const CARD_ASPECT = 128;

/** Where the field takes over: the far cards' own reach, never past what the hand-over keeps for the far tiles (`cardFieldKeep`). */
export function cardFieldFrom(farReach: number, keep: number): number {
  return Math.min(farReach, keep);
}

/**
 * How far the far tiles' cards are kept before the field takes over (h5's review round): out to where the far grids the
 * rings keep stop (`farGridRadius` tiles), and never inside the near ground's square (`uHorizonSquare`: the chunks' square
 * and one chunk more, its farthest corner within `(viewRadius + 2)` chunks and the ground's 2 m shift of the eye each way),
 * since the field draws nothing in that square and its cards there are the far tiles' (hidden over trees shown, lifted
 * over trees hidden). A whole number, so a frame that compares it makes nothing.
 */
export function cardFieldKeep(farGridRadius: number, farTile: number, viewRadius: number, chunk: number): number {
  return Math.max(Math.max(1, farGridRadius) * farTile, Math.ceil(((viewRadius + 2) * chunk + 2) * Math.SQRT2)) | 0;
}

/** How many levels reach `to` metres: level b's square reaches cells / 2 x tile x 2^b each way. */
export function cardFieldLevels(to: number, cells: number, tile: number, most: number): number {
  const a = LEVELS_ASK;
  a.to = to;
  a.cells = cells;
  a.tile = tile;
  a.levelsMost = most;
  return cardFieldLevelsOf(a);
}
/** The same off a frame's kept record (a number handed across a call is a number made; a whole number handed back is not). */
export function cardFieldLevelsOf(a: CardFieldAsk): number {
  const half0 = (a.cells / 2) * a.tile;
  if (!(a.to > half0) || !(half0 > 0)) return 1;
  return Math.max(1, Math.min(Math.max(1, a.levelsMost), Math.ceil(Math.log2(a.to / half0)) + 1)) | 0;
}

/**
 * The families' table (a row a family id, two texels a child, RGBA float): the child's share of its family's weights so
 * far (the very order `RadialFamily.choose` walks), its layer in the grass's pictures (-1 where the child has no picture:
 * no card, never another child, as a far tile's), its alpha reference over 255, its flags (`TUFT_FAR`, its kind's, and
 * `CARD_ASPECT`); then its sizes' least and most. A row with no child holds -1 in its first texel.
 */
export function cardFamilyTable(world: GrassWorld, wetRows: ReadonlyMap<number, number> | null = null): { data: Float32Array; children: number; families: number; cut: number } {
  const data = new Float32Array(CARD_TABLE_WIDTH * CARD_TABLE_ROWS * 4);
  for (let r = 0; r < CARD_TABLE_ROWS; r++) for (let c = 0; c < CARD_CHILDREN_MOST; c++) data[(r * CARD_TABLE_WIDTH + c * 2) * 4] = -1;
  let children = 0;
  let families = 0;
  let cut = 0;
  // A family's own rows, then each wet row a sample under water was given (`markExcluded`): the very family, its children
  // not meant for water standing no card there (the far tiles' own rule: `placeFarCards` drops them under the drawn water).
  const rows: [number, number, boolean][] = [];
  for (const id of world.group.families.keys()) rows.push([id, id, false]);
  if (wetRows) for (const [row, id] of wetRows) rows.push([row, id, true]);
  for (const [id, famId, wet] of rows) {
    const fam = world.group.families.get(famId);
    if (!fam || !(id >= 1 && id < CARD_TABLE_ROWS) || !fam.children.length) continue;
    families++;
    let sum = 0;
    for (const c of fam.children) sum += c.weight;
    const n = Math.min(fam.children.length, CARD_CHILDREN_MOST);
    if (fam.children.length > n) cut++;
    children = Math.max(children, n);
    let run = 0;
    for (let k = 0; k < n; k++) {
      const c = fam.children[k];
      run += c.weight;
      const key = world.keyOf(c);
      const entry = wet && !MEANT_FOR_WATER.test(key) ? undefined : world.shaders.get(key);
      const o = (id * CARD_TABLE_WIDTH + k * 2) * 4;
      data[o] = sum > 0 ? run / sum : 1;
      data[o + 1] = entry ? entry.layer : -1;
      data[o + 2] = entry ? entry.alphaRef / 255 : 0;
      data[o + 3] = TUFT_FAR | (entry?.kind === 'glow' ? TUFT_GLOW : 0) | (entry?.kind === 'fade' ? TUFT_FADE : 0) | (c.maintainAspect ? CARD_ASPECT : 0);
      data[o + 4] = c.minWidth;
      data[o + 5] = c.maxWidth;
      data[o + 6] = c.minHeight;
      data[o + 7] = c.maxHeight;
    }
  }
  return { data, children, families, cut };
}

/** What a sample's place is to the far cards (`markExcluded`'s test): kept, inside a placed object's no-flora circle, or under the drawn water (asked only while the far cards drop what stands there: `FAR_CARD_TUNE.water`). */
export const CARD_KEPT = 0;
export const CARD_CIRCLE = 1;
export const CARD_WET = 2;

/**
 * Every sample of the cards' lattice whose card the far tiles would not stand, at the field's making (`excluded`, the
 * world's own tests at the sample's raw place). Inside a no-flora circle its family is taken out (its alpha byte nought).
 * Under the drawn water it keeps only the children meant for water (the far tiles' own rule, `MEANT_FOR_WATER`): its byte
 * moved to a wet row of the table (`cardFamilyTable`'s `wetRows`), one a family, taken from the bytes no dry sample uses;
 * a family with no such child, or one past the free rows, is taken out. Samples with no family are not asked.
 */
export function markExcluded(rgba: Uint8Array, L: Lattice, excluded: (rx: number, rz: number) => number, world: GrassWorld | null): { dropped: number; wet: number; wetRows: Map<number, number> } {
  let dropped = 0;
  const wetAt: number[] = [];
  for (let j = 0; j < L.nz; j++) {
    const rz = L.z0 + j * L.step;
    for (let i = 0; i < L.nx; i++) {
      const o = (j * L.nx + i) * 4 + 3;
      if (!rgba[o]) continue;
      const code = excluded(L.x0 + i * L.step, rz);
      if (code === CARD_CIRCLE) {
        rgba[o] = 0;
        dropped++;
      } else if (code === CARD_WET) wetAt.push(o);
    }
  }
  const wetRows = new Map<number, number>();
  if (!wetAt.length) return { dropped, wet: 0, wetRows };
  // The bytes a dry sample still uses (each wet sample's family held aside and its byte cleared first), and each wet
  // family's row taken from the others.
  const wetFam = new Uint8Array(wetAt.length);
  for (let k = 0; k < wetAt.length; k++) {
    wetFam[k] = rgba[wetAt[k]];
    rgba[wetAt[k]] = 0;
  }
  const used = new Uint8Array(CARD_TABLE_ROWS);
  for (let o = 3; o < rgba.length; o += 4) used[rgba[o]] = 1;
  const rowOf = new Map<number, number>();
  let free = 1;
  const meant = (id: number): boolean => {
    const fam = world?.group.families.get(id);
    return !!fam && fam.children.some((c) => MEANT_FOR_WATER.test(world!.keyOf(c)));
  };
  let wet = 0;
  for (let k = 0; k < wetAt.length; k++) {
    const o = wetAt[k];
    const id = wetFam[k];
    let row = rowOf.get(id);
    if (row === undefined) {
      row = 0;
      if (meant(id)) {
        while (free < CARD_TABLE_ROWS && used[free]) free++;
        if (free < CARD_TABLE_ROWS) {
          row = free;
          used[free] = 1;
          wetRows.set(row, id);
        }
      }
      rowOf.set(id, row);
    }
    rgba[o] = row;
    if (row) wet++;
    else dropped++;
  }
  return { dropped, wet, wetRows };
}

/** One GLSL function's text out of a source, header to its closing brace (the ring's own, never a copy of it). */
export function glslPick(src: string, names: readonly string[]): string {
  const out: string[] = [];
  for (const name of names) {
    const head = new RegExp(`\\b(?:float|vec2|vec3|vec4|bool|int|void)\\s+${name}\\s*\\(`).exec(src);
    if (!head) throw new Error(`card field: the ring has no ${name}`);
    const open = src.indexOf('{', head.index);
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    if (end < 0) throw new Error(`card field: the ring's ${name} has no closing brace`);
    out.push(src.slice(head.index, end));
  }
  return out.join('\n');
}

/** The ring's own functions the field stands its cards with: the levels it draws, the bake's laid heights and the drop at the hole's edge. */
const RING_PICKED = glslPick(HORIZON_RING_FUNCTIONS, ['ringDistLevel', 'ringLevelOf', 'ringEdgeLevel', 'bakeTap', 'bakeLerp', 'bakeCoarse', 'bakeHeight', 'ringEdgeDistance', 'ringDrop']);

/**
 * The field's own text: its uniforms, the ring's picked functions, the five globals that stand in for the grass's instance
 * attributes, the far tiling's hash and rolls (flora.ts's `hashTuple` and `FastRandomGenerator`, read statement by
 * statement by the test), the level's square and its card. `fieldCard` writes the globals and answers whether the
 * instance stands a card.
 */
export const CARD_FIELD_GLSL = /* glsl */ `
uniform sampler2D uHorizonHeights;
uniform vec4 uHorizonFine;
uniform vec4 uHorizonCoarse;
uniform vec4 uHorizonSizes;
uniform vec4 uHorizonSquare;
uniform vec4 uHorizonDrop;
uniform vec4 uHorizonEye;
uniform vec4 uHorizonMorph;
uniform vec4 uHorizonGrid;
uniform vec4 uHorizonShape;
uniform vec4 uHorizonShapeAt;
uniform vec4 uGroundFrame;
uniform highp sampler2D uFieldCards;
uniform highp sampler2D uFieldTable;
// x, z0 the cards' lattice's first sample (raw), z its step, w the children a row holds.
uniform vec4 uFieldLattice;
// x, y the lattice's samples a side, z the far tiling's tile, w its jitter.
uniform vec4 uFieldSize;
// x the cells a side, y the levels drawn, z a level's growth, w unused.
uniform vec4 uFieldPlace;
// x, y the eye's raw place, z where the field takes over from the far tiles' cards, w where it ends (the reach in force).
uniform vec4 uFieldEye;
// x the band it shrinks over at its end (the horizon fade's share of the reach), y, z, w unused.
uniform vec4 uFieldFade;
${RING_PICKED}
vec4 aSwgTuft;
vec4 aSwgSize;
vec4 aSwgTint;
vec4 aSwgSway;
vec3 aSwgNormal;
uint fieldMix( uint k ) {
	k += k << 12u;
	k ^= k >> 22u;
	k += k << 4u;
	k ^= k >> 9u;
	k += k << 10u;
	k ^= k >> 2u;
	k += k << 7u;
	k ^= k >> 12u;
	return k;
}
uint fieldSeedOf( float x, float z ) {
	return fieldMix( fieldMix( floatBitsToUint( x ) ) ^ fieldMix( floatBitsToUint( z ) ^ 0xa5a5a5a5u ) );
}
int gFieldI = 123459876;
void fieldSeed( uint h ) {
	int ps = int( h & 0x7fffffffu );
	gFieldI = ps == 0 ? 123459876 : ps;
}
float fieldRandom() {
	int k = gFieldI / 127773;
	gFieldI = 16807 * ( gFieldI - k * 127773 ) - 2836 * k;
	if ( gFieldI < 0 ) gFieldI += 2147483647;
	return uintBitsToFloat( ( uint( gFieldI ) >> 8u ) | 0x3f800000u ) - 1.0;
}
// A level's square's first cell, in its own cells: snapped to two of them, so the next level's cells meet its edge.
float fieldBase( float e, float cell, float n ) {
	return floor( e / ( 2.0 * cell ) ) * 2.0 - n * 0.5;
}
// Whether a level's cell lies inside the finer level's square (whole cells, never across one: the cells a side are a multiple of four).
bool fieldInFiner( float ix, float iz, float cell, float ex, float ez, float n ) {
	float f = cell * 0.5;
	float fx0 = fieldBase( ex, f, n ) * f;
	float fz0 = fieldBase( ez, f, n ) * f;
	float x0 = ix * cell;
	float z0 = iz * cell;
	return x0 >= fx0 && x0 + cell <= fx0 + n * f && z0 >= fz0 && z0 + cell <= fz0 + n * f;
}
// A candidate's place along one axis: its cell's middle moved by the roll within the jitter (placeFarCards' own at level nought).
float fieldPlaceAxis( float i, float cell, float jitter, float roll ) {
	return ( i + 0.5 ) * cell + ( roll * 2.0 - 1.0 ) * jitter;
}
// How big a card stands where it is: none before the hand-over, whole to the end's band, shrinking across it.
float fieldScale( float d, float from, float to, float band ) {
	return ( d < from ? 0.0 : 1.0 ) * ( 1.0 - smoothstep( to - max( band, 1e-3 ), to, d ) );
}
// One ring vertex as the vertex stage stands it unmorphed (horizonMath's ringVertexHeight, past the shape window): the
// bake there less the drop at its edge distance.
float fieldVertex( float vx, float vz ) {
	return bakeHeight( uGroundFrame.x - vx, vz + uGroundFrame.y ) - ringDrop( ringEdgeDistance( vx, vz, uHorizonSquare.x, uHorizonSquare.y, uHorizonSquare.z, uHorizonSquare.w ), uHorizonDrop.x, uHorizonDrop.y, uHorizonDrop.z );
}
// The drawn ring's surface at a game place on a lattice of q metres (horizonMath's ringSurfaceAt): the triangle under it,
// split as the patch is (the quad's (x + q, z) to (x, z + q)), never the bilinear.
float fieldSurface( float gx, float gz, float q ) {
	float i = floor( ( gx - uHorizonGrid.x ) / q );
	float j = floor( ( gz - uHorizonGrid.y ) / q );
	float x0 = uHorizonGrid.x + i * q;
	float z0 = uHorizonGrid.y + j * q;
	float u = ( gx - x0 ) / q;
	float v = ( gz - z0 ) / q;
	float h10 = fieldVertex( x0 + q, z0 );
	float h01 = fieldVertex( x0, z0 + q );
	if ( u + v <= 1.0 ) {
		float h00 = fieldVertex( x0, z0 );
		return h00 + u * ( h10 - h00 ) + v * ( h01 - h00 );
	}
	float h11 = fieldVertex( x0 + q, z0 + q );
	return h11 + ( 1.0 - u ) * ( h01 - h11 ) + ( 1.0 - v ) * ( h10 - h11 );
}
// The level the ring draws at a game place (its vertex stage's own: the distance's level and the edge's, the lesser, held
// to the most it takes), floored, never finer than level nought (the field stands past the finer levels' ranges).
float fieldLevel( float gx, float gz, float h ) {
	float dx = gx - uHorizonEye.x;
	float dy = h - uHorizonEye.y;
	float dz = gz - uHorizonEye.z;
	float d = ringLevelOf( sqrt( dx * dx + dy * dy + dz * dz ), uHorizonMorph.x, uHorizonMorph.y, uHorizonShape, uHorizonShapeAt.w );
	float e = ringEdgeLevel( ringEdgeDistance( gx, gz, uHorizonSquare.x, uHorizonSquare.y, uHorizonSquare.z, uHorizonSquare.w ), uHorizonMorph.z, uHorizonMorph.y );
	return floor( clamp( min( min( d, e ), uHorizonMorph.w ), 0.0, 24.0 ) );
}
bool fieldCard() {
	if ( position.z > 0.5 ) return false;
	int n = int( uFieldPlace.x );
	int nn = n * n;
	int levelI = gl_InstanceID / nn;
	if ( float( levelI ) >= uFieldPlace.y ) return false;
	int kI = gl_InstanceID - levelI * nn;
	int czI = kI / n;
	int cxI = kI - czI * n;
	float level = float( levelI );
	float nf = float( n );
	float tile = uFieldSize.z;
	// A whole power of two exactly (exp2 need not be), so the hash's tile is the far tile's own to the bit.
	float scale = float( 1 << levelI );
	float cell = tile * scale;
	float ix = fieldBase( uFieldEye.x, cell, nf ) + float( cxI );
	float iz = fieldBase( uFieldEye.y, cell, nf ) + float( czI );
	if ( levelI > 0 && fieldInFiner( ix, iz, cell, uFieldEye.x, uFieldEye.y, nf ) ) return false;
	fieldSeed( fieldSeedOf( ix * scale * tile, iz * scale * tile ) );
	float jitter = uFieldSize.w * scale;
	float rx = fieldPlaceAxis( ix, cell, jitter, fieldRandom() );
	float rz = fieldPlaceAxis( iz, cell, jitter, fieldRandom() );
	float rChild = fieldRandom();
	float rYaw = fieldRandom();
	float rW = fieldRandom();
	float rH = fieldRandom();
	float fi = floor( ( rx - uFieldLattice.x ) / uFieldLattice.z + 0.5 );
	float fk = floor( ( rz - uFieldLattice.y ) / uFieldLattice.z + 0.5 );
	if ( fi < 0.0 || fk < 0.0 || fi > uFieldSize.x - 1.0 || fk > uFieldSize.y - 1.0 ) return false;
	vec4 s = texelFetch( uFieldCards, ivec2( int( fi ), int( fk ) ), 0 );
	int fam = int( s.a * 255.0 + 0.5 );
	if ( fam == 0 ) return false;
	vec4 ta = texelFetch( uFieldTable, ivec2( 0, fam ), 0 );
	if ( ta.x < 0.0 ) return false;
	int pick = 0;
	int kids = int( uFieldLattice.w );
	for ( int c = 0; c < ${CARD_CHILDREN_MOST}; c++ ) {
		if ( c >= kids ) break;
		vec4 tc = texelFetch( uFieldTable, ivec2( c * 2, fam ), 0 );
		if ( tc.x < 0.0 ) break;
		if ( rChild <= tc.x ) {
			pick = c;
			ta = tc;
			break;
		}
	}
	if ( ta.y < -0.5 ) return false;
	vec4 tb = texelFetch( uFieldTable, ivec2( pick * 2 + 1, fam ), 0 );
	int fl = int( ta.w + 0.5 );
	bool aspect = fl >= ${CARD_ASPECT};
	if ( aspect ) fl -= ${CARD_ASPECT};
	float grow = exp2( level * uFieldPlace.z );
	float w = ( tb.x + rW * ( tb.y - tb.x ) ) * grow;
	float h = ( tb.z + ( aspect ? rW : rH ) * ( tb.w - tb.z ) ) * grow;
	float gx = uGroundFrame.x - rx;
	float gz = rz - uGroundFrame.y;
	// The near ground's square is the far tiles' cards' and the near trees' (their hide and their lift), never the field's.
	if ( ringEdgeDistance( gx, gz, uHorizonSquare.x, uHorizonSquare.y, uHorizonSquare.z, uHorizonSquare.w ) < 0.0 ) return false;
	// Standing on the ring drawn there: its level's triangle, a whole power of two of the leaf's step.
	int ringL = int( fieldLevel( gx, gz, bakeHeight( rx, rz ) ) );
	float ground = fieldSurface( gx, gz, ${(LEAF / PATCH).toFixed(1)} * float( 1 << ringL ) );
	aSwgTuft = vec4( gx, ground, gz, rYaw * 6.283185307179586 );
	aSwgSize = vec4( w, h, ta.y, float( fl ) );
	aSwgTint = vec4( s.rgb, ta.z );
	aSwgSway = vec4( -2.0, 0.0, 0.0, 0.0 );
	aSwgNormal = vec3( 0.0, 1.0, 0.0 );
	return true;
}
`;

/** The grass's lines the field's text replaces, each found exactly once or nothing is made (`cardFieldVertex`). */
export const CARD_FIELD_ANCHORS = {
  attributes: 'attribute vec4 aSwgTuft;\nattribute vec4 aSwgSize;\nattribute vec4 aSwgTint;\nattribute vec4 aSwgSway;\nattribute vec3 aSwgNormal;\n',
  main: 'void main() {\n\tint swgFlags = int( aSwgSize.w + 0.5 );',
  scale: 'swgScale = 1.0 - smoothstep( swgReach - swgBand, swgReach, swgDist );',
} as const;

const once = (text: string, anchor: string): boolean => {
  const at = text.indexOf(anchor);
  return at >= 0 && text.indexOf(anchor, at + 1) < 0;
};

/**
 * The grass's vertex text made the field's: its instance attributes taken out for the field's globals and functions, a
 * card made from `gl_InstanceID` at the top of `main` (an instance with none collapsed outside the view, as the grass's
 * own out-of-reach tufts are), and the far cards' reach replaced by the field's (none before the hand-over, shrinking
 * across the end's band). All or none: a grass text whose anchors have moved throws, and nothing of the field is made.
 */
export function cardFieldVertex(grass: string): string {
  const A = CARD_FIELD_ANCHORS;
  for (const [k, a] of Object.entries(A)) if (!once(grass, a)) throw new Error(`card field: the grass's ${k} line has moved`);
  return grass
    .replace(A.attributes, `${CARD_FIELD_GLSL}\n`)
    .replace(A.main, `void main() {\n\tif ( !fieldCard() ) {\n\t\tgl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );\n\t\t#ifdef USE_FOG\n\t\t\tvFogDepth = 0.0;\n\t\t#endif\n\t\treturn;\n\t}\n\tint swgFlags = int( aSwgSize.w + 0.5 );`)
    .replace(A.scale, 'swgScale = fieldScale( swgDist, uFieldEye.z, uFieldEye.w, uFieldFade.x );');
}

/** The field's own uniforms (the grass's and the ring's are shared by reference beside them). */
export interface CardFieldUniforms {
  uFieldCards: THREE.IUniform<THREE.Texture>;
  uFieldTable: THREE.IUniform<THREE.Texture>;
  uFieldLattice: THREE.IUniform<THREE.Vector4>;
  uFieldSize: THREE.IUniform<THREE.Vector4>;
  uFieldPlace: THREE.IUniform<THREE.Vector4>;
  uFieldEye: THREE.IUniform<THREE.Vector4>;
  uFieldFade: THREE.IUniform<THREE.Vector4>;
}

function blank(format: THREE.PixelFormat, type: THREE.TextureDataType, data: ArrayBufferView): THREE.DataTexture {
  const t = new THREE.DataTexture(data as never, 1, 1, format, type);
  t.needsUpdate = true;
  return t;
}

/** A fresh set: a stand-in of one sample with no family and a table row with no child (a real texture each), the place empty. */
export function makeCardFieldUniforms(): CardFieldUniforms {
  return {
    uFieldCards: { value: blank(THREE.RGBAFormat, THREE.UnsignedByteType, new Uint8Array(4)) },
    uFieldTable: { value: blank(THREE.RGBAFormat, THREE.FloatType, new Float32Array([-1, -1, 0, 0])) },
    uFieldLattice: { value: new THREE.Vector4(0, 0, 16, 0) },
    uFieldSize: { value: new THREE.Vector4(1, 1, 32, 0) },
    uFieldPlace: { value: new THREE.Vector4(CARD_FIELD_TUNE.cells, 0, CARD_FIELD_TUNE.grow, 0) },
    uFieldEye: { value: new THREE.Vector4(0, 0, 1e9, 0) },
    uFieldFade: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
}

/**
 * The session's field: its material (the grass's uniforms, the field's and the ring's by reference) and its one mesh (the
 * grass's two quads, no instance attribute, never culled or picked), kept for the session as the ring's are; each world
 * hands it its textures (`CardField.bind`). Its program is built only by a screen's sweep with the mesh hung.
 */
export class CardFieldSession {
  readonly uniforms: CardFieldUniforms = makeCardFieldUniforms();
  readonly material: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  constructor(ring: RingUniforms, ground: GroundTileUniforms) {
    const base = grassMaterial();
    const u = this.uniforms;
    this.material = new THREE.ShaderMaterial({
      name: 'far card field',
      uniforms: {
        ...base.uniforms,
        ...u,
        uHorizonHeights: ring.uHorizonHeights,
        uHorizonFine: ring.uHorizonFine,
        uHorizonCoarse: ring.uHorizonCoarse,
        uHorizonSizes: ring.uHorizonSizes,
        uHorizonSquare: ring.uHorizonSquare,
        uHorizonDrop: ring.uHorizonDrop,
        uHorizonEye: ring.uHorizonEye,
        uHorizonMorph: ring.uHorizonMorph,
        uHorizonGrid: ring.uHorizonGrid,
        uHorizonShape: ring.uHorizonShape,
        uHorizonShapeAt: ring.uHorizonShapeAt,
        uGroundFrame: ground.uGroundFrame,
      } as unknown as Record<string, THREE.IUniform>,
      vertexShader: cardFieldVertex(base.vertexShader),
      fragmentShader: base.fragmentShader,
      fog: true,
    });
    // As the grass's: unlit and dry (out of the cascades, never wrapped by the weather).
    this.material.userData.unlit = true;
    this.material.userData.dry = true;
    base.dispose();
    const g = new THREE.InstancedBufferGeometry();
    tuftQuads(g);
    g.instanceCount = 0;
    const mesh = new THREE.Mesh(g, this.material);
    mesh.name = 'far card field';
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.raycast = () => {};
    this.mesh = mesh;
  }

  /**
   * A frame: the eye's raw place, the hand-over and the end, the end's band, the cells and levels and the instances drawn,
   * each vector's field written in place (a number handed across a call is a number made: the caller writes `ask`).
   */
  step(ask: CardFieldAsk): void {
    const u = this.uniforms;
    const e = u.uFieldEye.value;
    e.x = ask.eyeX;
    e.y = ask.eyeZ;
    e.z = ask.from;
    e.w = ask.to;
    u.uFieldFade.value.x = ask.band;
    const p = u.uFieldPlace.value;
    const cells = ask.cells;
    p.x = cells;
    p.y = ask.levels;
    p.z = ask.grow;
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = ask.levels * cells * cells;
  }
}

/** What a frame hands the field (a kept record: every field a fraction from the start, so a fraction is written in place). */
export class CardFieldAsk {
  eyeX = 0.5;
  eyeZ = 0.5;
  from = 0.5;
  to = 0.5;
  band = 0.5;
  cells = 128;
  levels = 1;
  grow = 0.5;
  tile = 0.5;
  levelsMost = 6;
}
const LEVELS_ASK = new CardFieldAsk();

/** A world's field: its cards' texture (RGBA8: the colour map's bytes and the far family), its families' table and their lattice. */
export class CardField {
  readonly cards: THREE.DataTexture;
  readonly table: THREE.DataTexture;
  readonly lattice: Lattice;
  readonly children: number;
  readonly families: number;
  readonly withFamily: number;
  readonly dropped: number;
  /** Samples under the drawn water kept for their children meant for water. */
  readonly wet: number;
  readonly cut: number;
  constructor(rgba: Uint8Array, lattice: Lattice, world: GrassWorld, excluded: ((rx: number, rz: number) => number) | null) {
    this.lattice = lattice;
    const m = excluded ? markExcluded(rgba, lattice, excluded, world) : null;
    this.dropped = m ? m.dropped : 0;
    this.wet = m ? m.wet : 0;
    let w = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) w++;
    this.withFamily = w;
    const t = new THREE.DataTexture(rgba as never, lattice.nx, lattice.nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    this.cards = t;
    const tab = cardFamilyTable(world, m ? m.wetRows : null);
    const tt = new THREE.DataTexture(tab.data as never, CARD_TABLE_WIDTH, CARD_TABLE_ROWS, THREE.RGBAFormat, THREE.FloatType);
    tt.minFilter = tt.magFilter = THREE.NearestFilter;
    tt.generateMipmaps = false;
    tt.needsUpdate = true;
    this.table = tt;
    this.children = tab.children;
    this.families = tab.families;
    this.cut = tab.cut;
  }

  /** This world's textures and lattice into the session's uniforms, with the far tiling's tile and jitter. */
  bind(u: CardFieldUniforms, tile: number, jitter: number): void {
    u.uFieldCards.value = this.cards;
    u.uFieldTable.value = this.table;
    u.uFieldLattice.value.set(this.lattice.x0, this.lattice.z0, this.lattice.step, Math.max(1, this.children));
    u.uFieldSize.value.set(this.lattice.nx, this.lattice.nz, tile, jitter);
  }

  /** On the card: the cards' texture and the table, megabytes (the formats' arithmetic). */
  megabytes(): number {
    return (this.lattice.nx * this.lattice.nz * 4 + CARD_TABLE_WIDTH * CARD_TABLE_ROWS * 16) / 1048576;
  }

  dispose(): void {
    this.cards.dispose();
    this.table.dispose();
  }
}

/** A deflated section inflated in the browser (and in node), as the bake's own reader does. */
export async function inflateCards(bytes: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
