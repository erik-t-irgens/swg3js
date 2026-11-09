// The far ground's rings (DESIGN.md §2.4, §2.5, §2.13): one 8 by 8 patch and one skirt strip drawn as instances, one
// for each node the selection keeps (`horizonMath.ts`), by one program of the session for both, a `MeshStandardMaterial`
// whose compile hook writes the ring's vertex stage -- the heights from the bake, the morph by each vertex's own place
// (its distance's level and its edge's level, the lesser), the drop at the hole's edge, the reach's clamp, the vertex
// normal -- and its shading: inside the ground detail distance the near ground's own composition (the tile program's
// own text: `TILE_MAP`, `GROUND_MASK_GLSL`, `GROUND_TINT_GLSL`, `TILE_NORMAL`, `TILE_ROUGHNESS` and its flat shine, fed
// from the composition window's tiles and the colour cells' tint, the third wave), fading over a long stretch into the
// bake's albedo composed per 4 m tile at every picture's mean past it; the client's cloud shadows (the tile program's own
// lines), the weather's wet look (`injectWetness`, 'ground', as the near ground's, its shelter open: no ring stands under
// the roof grid), three's fog with a cheap path for what it has taken, and the horizon fade into the sky's own colour
// (the dome's own lines). Every part behind a uniform at its starting value.
//
// SAMPLERS (the third wave): ANGLE on Direct3D 11 gives a program 16 texture units and three hands every active sampler
// one, so the program holds 12 of its own beside three's own two kinds (its multiscatter highlight's `dfgLUT`, the
// cascades' three shadow maps): sixteen, every one of them, with none to spare (`RING_SAMPLER_MOST`, counted over the
// program's text by `horizonShaders.test.ts` and by the driver in `horizon({ selfTest })`): the heights are one atlas read by
// `texelFetch`, the coarse normals are worked out from the coarse heights in the vertex stage, the near band's grain and
// layer means gave way to the composition, and the weather's roof grid is never read (its shelter is open past it).
//
// Light and shadow's step 5 multiplies the sun's direct light here where the leaf cards capture the cascades' shadow
// (`swgSunShadow`, the five sites `cardLightsBegin` rewrites): no sampler is reserved for it now. Its step 3 makes a depth
// twin from `HORIZON_RING_VERTEX`, which morphs by `uHorizonEye` and never `cameraPosition`.
import * as THREE from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';
import { DOME_COLOUR_GLSL } from '../domeColour.ts';
import { GGX_ANCHOR } from '../specular.ts';
import { GROUND_CLOUD_GLSL, GROUND_DECODE_GLSL, GROUND_MASK_GLSL, GROUND_TINT_GLSL, GROUND_TRI_GLSL, GROUND_TRI_WANTED, TILE_FLAT_LINE, TILE_MAP, TILE_MAP_Y_LINE, TILE_NORMAL, TILE_ROUGHNESS, type GroundTileUniforms } from '../terrainTextures.ts';
import { injectWetness } from '../wetness.ts';
import { ALBEDO_SCALE } from './horizonDecode.ts';
import { PATCH } from './horizonMath.ts';

/**
 * The most texture units the ring program may take, the cascades' shadow maps included: Direct3D 11's sixteen under ANGLE
 * (`MAX_TEXTURE_IMAGE_UNITS`), which three hands out one an active sampler over the whole program.
 */
export const RING_SAMPLER_MOST = 16;

/** The ring program's key: one text for every world. */
export const HORIZON_RING_KEY = 'swg-horizon-ring';

/** Every uniform the ring program reads of its own. */
export interface RingUniforms {
  /** x, y, z the eye (the morph's, never `cameraPosition`), w the reach in force. */
  uHorizonEye: THREE.IUniform<THREE.Vector4>;
  /** The hole's square in the game's frame: x0, z0, x1, z1. */
  uHorizonSquare: THREE.IUniform<THREE.Vector4>;
  /** x lod0 in force, y the morph's share, z the edge's first band, w the most level a vertex takes. */
  uHorizonMorph: THREE.IUniform<THREE.Vector4>;
  /** x the drop, y its fade, z 1 for the drop everywhere, w the skirt's hang. */
  uHorizonDrop: THREE.IUniform<THREE.Vector4>;
  /** x, y the leaves' lattice origin (the ground's shift). */
  uHorizonGrid: THREE.IUniform<THREE.Vector4>;
  /** The raw-frame lattices: x0, z0, step; and for the heights' two, w the step's mips past 8 m (`ringMipOffset`). */
  uHorizonFine: THREE.IUniform<THREE.Vector4>;
  uHorizonCoarse: THREE.IUniform<THREE.Vector4>;
  uHorizonColour: THREE.IUniform<THREE.Vector4>;
  /** x, y the fine's samples a side, z, w the coarse's. */
  uHorizonSizes: THREE.IUniform<THREE.Vector4>;
  /** x, y the colour's texels a side. */
  uHorizonColourN: THREE.IUniform<THREE.Vector4>;
  /** The heights, one R32F atlas read by `texelFetch`: the fine lattice's rows from row nought, the coarse lattice's after them. */
  uHorizonHeights: THREE.IUniform<THREE.Texture>;
  uHorizonFineN: THREE.IUniform<THREE.Texture>;
  uHorizonAlbedo: THREE.IUniform<THREE.Texture>;
  uHorizonCoarseAlbedo: THREE.IUniform<THREE.Texture>;
  /** The composition window (RGBA16UI, toroidal, a texel a 4 m tile: layers, mask codes, count) and the colour cells' tint (RGBA8, toroidal). */
  uHorizonWindow: THREE.IUniform<THREE.Texture>;
  uHorizonTint: THREE.IUniform<THREE.Texture>;
  /** x, y the window's first tile, z its side in tiles, w the tint window's side in cells. */
  uHorizonWin: THREE.IUniform<THREE.Vector4>;
  /** x, y the tint window's first colour cell. */
  uHorizonWinC: THREE.IUniform<THREE.Vector4>;
  /** x the fog's cheap path, y where the near composition is gone (the ground detail distance), z the fade's length, w the composition on. */
  uHorizonLook: THREE.IUniform<THREE.Vector4>;
  /** x the fade's share, y on, z its colour (0 the sky, 1 the fog, 2 none), w what is drawn (`HORIZON_VIEWS`' index). */
  uHorizonFade: THREE.IUniform<THREE.Vector4>;
  /**
   * The rings' shape up close (wave 3b): x the 2 m level's range, y the 4 m level's, z the finest level (nought, minus one or
   * minus two), w the shape window's heights read (1) or not (0).
   */
  uHorizonShape: THREE.IUniform<THREE.Vector4>;
  /** The shape window: x, y its first sample's global index (raw over the step), z, w its column and row in the heights atlas. */
  uHorizonShapeWin: THREE.IUniform<THREE.Vector4>;
  /** x the window's step (the near ground's poles, 2 m), y its side in samples, z the samples its share fades over at its edge, w the finer levels' morph share. */
  uHorizonShapeAt: THREE.IUniform<THREE.Vector4>;
  /** The dome's own uniforms, their values copied from the sky each frame (the snippet reads these names). */
  uGradient: THREE.IUniform<THREE.Texture | null>;
  uGradient2: THREE.IUniform<THREE.Texture | null>;
  /**
   * The dome's four numbers, `uTime`, `uHasGradient`, `uHasGradient2` and `uGradientMix`, in one vector the snippet reads
   * under those names (`#define`s round `ringSky`): a double written into a three uniform's `{ value }` every frame is a
   * number made every frame, where a vector's fields hold theirs in place.
   */
  uRingDome: THREE.IUniform<THREE.Vector4>;
  uClear: THREE.IUniform<THREE.Color>;
  uHorizonFog: THREE.IUniform<THREE.Color>;
}

function tex1(format: THREE.PixelFormat, type: THREE.TextureDataType, data: ArrayBufferView): THREE.DataTexture {
  const t = new THREE.DataTexture(data as never, 1, 1, format, type);
  t.needsUpdate = true;
  return t;
}

/** A fresh set, holding stand-ins (a real texture each: an empty sampler binds nothing) until a world hands it its own. */
export function makeRingUniforms(): RingUniforms {
  const h = tex1(THREE.RedFormat, THREE.FloatType, new Float32Array([0]));
  const n = tex1(THREE.RGFormat, THREE.UnsignedByteType, new Uint8Array([128, 128]));
  const a = tex1(THREE.RGBAFormat, THREE.UnsignedByteType, new Uint8Array([128, 128, 128, 0]));
  a.colorSpace = THREE.SRGBColorSpace;
  // A window of one tile holding nothing (count nought): every fragment reads the far albedo.
  const w = tex1(THREE.RGBAIntegerFormat, THREE.UnsignedShortType, new Uint16Array(4));
  w.internalFormat = 'RGBA16UI';
  const tn = tex1(THREE.RGBAFormat, THREE.UnsignedByteType, new Uint8Array([255, 255, 255, 255]));
  return {
    uHorizonEye: { value: new THREE.Vector4(0, 0, 0, 1) },
    uHorizonSquare: { value: new THREE.Vector4() },
    uHorizonMorph: { value: new THREE.Vector4(1400, 0.3, 64, 7) },
    uHorizonDrop: { value: new THREE.Vector4(2.5, 256, 0, 16) },
    uHorizonGrid: { value: new THREE.Vector4() },
    uHorizonFine: { value: new THREE.Vector4(0, 0, 8, 0) },
    uHorizonCoarse: { value: new THREE.Vector4(0, 0, 64, 3) },
    uHorizonColour: { value: new THREE.Vector4(0, 0, 8, 0) },
    uHorizonSizes: { value: new THREE.Vector4(1, 1, 1, 1) },
    uHorizonColourN: { value: new THREE.Vector4(1, 1, 0, 0) },
    uHorizonHeights: { value: h },
    uHorizonFineN: { value: n },
    uHorizonAlbedo: { value: a },
    uHorizonCoarseAlbedo: { value: a },
    uHorizonWindow: { value: w },
    uHorizonTint: { value: tn },
    uHorizonWin: { value: new THREE.Vector4(0, 0, 1, 1) },
    uHorizonWinC: { value: new THREE.Vector4() },
    uHorizonLook: { value: new THREE.Vector4(0.996, 2500, 1250, 1) },
    uHorizonFade: { value: new THREE.Vector4(0.15, 1, 0, 0) },
    uHorizonShape: { value: new THREE.Vector4(1, 1, 0, 0) },
    uHorizonShapeWin: { value: new THREE.Vector4() },
    uHorizonShapeAt: { value: new THREE.Vector4(2, 1, 16, 0.15) },
    uGradient: { value: null },
    uGradient2: { value: null },
    uRingDome: { value: new THREE.Vector4(0, 0, 0, 0) },
    uClear: { value: new THREE.Color(0.5, 0.6, 0.8) },
    uHorizonFog: { value: new THREE.Color(0.5, 0.5, 0.5) },
  };
}

/**
 * How many mips a heights lattice's normals sit past a level's own spacing: a level-L node's vertices stand 8 · 2^L m
 * apart, so a lattice of `step` metres is read at mip L - log2(step / 8) (nought on an 8 m bake's fine, one on a 16 m
 * one's, three on the 64 m coarse).
 */
export function ringMipOffset(step: number): number {
  return Math.log2(step / 8);
}

/** The bake's lattices and the morph's functions, in both stages: scalars, so `glslRun.ts` runs them against `horizonMath.ts`. */
export const HORIZON_RING_FUNCTIONS = /* glsl */ `
float ringDistLevel( float d, float lod0, float morph ) {
	float k = d < lod0 ? 0.0 : floor( log2( d / lod0 ) ) + 1.0;
	float r = lod0 * pow( 2.0, k );
	float f = clamp( ( d - r * ( 1.0 - morph ) ) / ( r * morph ), 0.0, 1.0 );
	return k + f;
}
// The level a distance asks with the rings' finer levels (wave 3b): the 2 m level's range in shape.x, the 4 m level's in
// shape.y and the finest level in shape.z (nought, minus one or minus two), each finer one morphing over its outer share mf
// onto the next, the ranges set (shapeRanges) so that every one meets the next with its morph not yet begun.
float ringLevelOf( float d, float lod0, float morph, vec4 shape, float mf ) {
	if ( shape.z > -0.5 || d >= shape.y ) return ringDistLevel( d, lod0, morph );
	if ( shape.z > -1.5 || d >= shape.x ) return -1.0 + clamp( ( d - shape.y * ( 1.0 - mf ) ) / ( shape.y * mf ), 0.0, 1.0 );
	return -2.0 + clamp( ( d - shape.x * ( 1.0 - mf ) ) / ( shape.x * mf ), 0.0, 1.0 );
}
float ringEdgeLevel( float e, float band, float morph ) {
	float x = max( e, 0.0 );
	float k = floor( log2( x / band + 1.0 ) );
	float w = band * pow( 2.0, k );
	float start = band * ( pow( 2.0, k ) - 1.0 );
	float f = clamp( ( x - start - w * ( 1.0 - morph ) ) / ( w * morph ), 0.0, 1.0 );
	return k + f;
}
float ringSnap( float v, float origin, float spacing ) {
	return origin + floor( ( v - origin ) / spacing ) * spacing;
}
float ringMorph( float v, float origin, float w, float node ) {
	float lw = max( w, node );
	float k = floor( lw );
	float f = lw - k;
	float s = ${(64 / PATCH).toFixed(1)} * pow( 2.0, k );
	float a = ringSnap( v, origin, s );
	float b = ringSnap( v, origin, s * 2.0 );
	return a + ( b - a ) * f;
}
float ringEdgeDistance( float x, float z, float sx0, float sz0, float sx1, float sz1 ) {
	return max( max( sx0 - x, x - sx1 ), max( sz0 - z, z - sz1 ) );
}
float ringDrop( float e, float drop, float fade, float everywhere ) {
	if ( everywhere > 0.5 ) return drop;
	return drop * clamp( 1.0 - e / fade, 0.0, 1.0 );
}
float ringReach( float dx, float dz, float reach ) {
	float r = sqrt( dx * dx + dz * dz );
	return r > reach ? reach / r : 1.0;
}
float bakeTap( int i, int j ) {
	return texelFetch( uHorizonHeights, ivec2( i, j ), 0 ).r;
}
// A lattice's bilinear in the heights atlas: its rows from row0 (nought the fine's, the fine's count the coarse's).
float bakeLerp( float fx, float fz, float nx, float nz, float row0 ) {
	float cx = clamp( fx, 0.0, nx - 1.0 );
	float cz = clamp( fz, 0.0, nz - 1.0 );
	float ix = min( floor( cx ), nx - 2.0 );
	float iz = min( floor( cz ), nz - 2.0 );
	float ax = cx - ix;
	float az = cz - iz;
	int i = int( ix );
	int j = int( iz + row0 );
	float h0 = mix( bakeTap( i, j ), bakeTap( i + 1, j ), ax );
	float h1 = mix( bakeTap( i, j + 1 ), bakeTap( i + 1, j + 1 ), ax );
	return mix( h0, h1, az );
}
float bakeCoarse( float rx, float rz ) {
	return bakeLerp( ( rx - uHorizonCoarse.x ) / uHorizonCoarse.z, ( rz - uHorizonCoarse.y ) / uHorizonCoarse.z, uHorizonSizes.z, uHorizonSizes.w, uHorizonSizes.y );
}
float bakeHeight( float rx, float rz ) {
	float fx = ( rx - uHorizonFine.x ) / uHorizonFine.z;
	float fz = ( rz - uHorizonFine.y ) / uHorizonFine.z;
	if ( fx >= 0.0 && fz >= 0.0 && fx <= uHorizonSizes.x - 1.0 && fz <= uHorizonSizes.y - 1.0 ) return bakeLerp( fx, fz, uHorizonSizes.x, uHorizonSizes.y, 0.0 );
	return bakeCoarse( rx, rz );
}
// The coarse lattice's slopes for a level-lod vertex (the third wave: its normals are worked out here, not read): central
// differences one step either side, normalsOf's own arithmetic, the step widened to the level's spacing past the
// lattice's own, so a far node's lean is smoothed as the normals' mips once smoothed it.
float ringCoarseSpan( float lod ) {
	return uHorizonCoarse.z * exp2( max( lod - uHorizonCoarse.w, 0.0 ) );
}
float ringCoarseDx( float rx, float rz, float s ) {
	return ( bakeCoarse( rx + s, rz ) - bakeCoarse( rx - s, rz ) ) / ( 2.0 * s );
}
float ringCoarseDz( float rx, float rz, float s ) {
	return ( bakeCoarse( rx, rz + s ) - bakeCoarse( rx, rz - s ) ) / ( 2.0 * s );
}
// The shape window (wave 3b): the live generator's own 2 m heights round the eye, laid as the near ground lays them, in a
// block of the heights atlas from column uHorizonShapeWin.z and row .w, toroidal by the global sample index (raw over the
// step), its first sample (.x, .y) and its side (uHorizonShapeAt.y); a sample not made yet holds a sentinel. Its share at a
// place (gShapeShare): one inside, fading to nought over its last uHorizonShapeAt.z samples, nought where one is not made.
float gShapeShare = 0.0;
float shapeTap( float gi, float gj ) {
	float n = uHorizonShapeAt.y;
	return texelFetch( uHorizonHeights, ivec2( int( uHorizonShapeWin.z + mod( gi, n ) ), int( uHorizonShapeWin.w + mod( gj, n ) ) ), 0 ).r;
}
float shapeHeight( float rx, float rz ) {
	gShapeShare = 0.0;
	float fx = rx / uHorizonShapeAt.x;
	float fz = rz / uHorizonShapeAt.x;
	float ix = floor( fx );
	float iz = floor( fz );
	float lx = ix - uHorizonShapeWin.x;
	float lz = iz - uHorizonShapeWin.y;
	float inner = min( min( lx, lz ), min( uHorizonShapeAt.y - 2.0 - lx, uHorizonShapeAt.y - 2.0 - lz ) );
	float share = clamp( inner / uHorizonShapeAt.z, 0.0, 1.0 );
	if ( share <= 0.0 ) return 0.0;
	float h00 = shapeTap( ix, iz );
	float h10 = shapeTap( ix + 1.0, iz );
	float h01 = shapeTap( ix, iz + 1.0 );
	float h11 = shapeTap( ix + 1.0, iz + 1.0 );
	if ( min( min( h00, h10 ), min( h01, h11 ) ) < -1e29 ) return 0.0;
	gShapeShare = share;
	float ax = fx - ix;
	float az = fz - iz;
	return mix( mix( h00, h10, ax ), mix( h01, h11, ax ), az );
}
// The ring's height at a raw place: the bake's, and with the shape window read, the window's wherever it holds the place
// (its share in gShapeShare), the bake's past it.
float ringHeightAt( float rx, float rz ) {
	float h = bakeHeight( rx, rz );
	gShapeShare = 0.0;
	if ( uHorizonShape.w < 0.5 ) return h;
	float w = shapeHeight( rx, rz );
	return gShapeShare > 0.0 ? mix( h, w, gShapeShare ) : h;
}
`;

const SHARED_PARS = /* glsl */ `
uniform vec4 uHorizonEye;
uniform vec4 uHorizonSquare;
uniform vec4 uHorizonMorph;
uniform vec4 uHorizonDrop;
uniform vec4 uHorizonGrid;
uniform vec4 uHorizonFine;
uniform vec4 uHorizonCoarse;
uniform vec4 uHorizonColour;
uniform vec4 uHorizonSizes;
uniform vec4 uHorizonColourN;
uniform vec4 uHorizonLook;
uniform vec4 uHorizonFade;
uniform vec4 uHorizonShape;
uniform vec4 uHorizonShapeWin;
uniform vec4 uHorizonShapeAt;
uniform vec4 uGroundFrame;
uniform sampler2D uHorizonFineN;
varying float vRingShape;
varying vec3 vRingShapeN;
varying float vGroundY;
varying vec2 vRingRaw;
varying vec3 vRingWorld;
varying float vRingEdge;
varying float vRingDist;
flat varying float vRingLevel;
varying vec2 vGroundUV;
`;

/**
 * The vertex's normal at a raw place for a node of level lod. Inside the fine extent the baked normal (RG8 biased by 128:
 * the game-frame x and z, the up rebuilt), read at the level less the lattice's own step's share of 8 m in mips (a level's
 * vertices stand 8 m times two to the level apart; `uHorizonFine.w` is log2 of the step over 8). Past it the coarse
 * heights' own central differences, `normalsOf`'s arithmetic, one step either side at the node's spacing (the step times
 * two to the level less `uHorizonCoarse.w`), which smooth as the coarse normals' mips did; the fragment takes the vertex's.
 */
export const RING_NORMAL_GLSL = /* glsl */ `
vec3 ringNormalAt( vec2 raw, float lod ) {
	vec2 f = ( raw - uHorizonFine.xy ) / uHorizonFine.z;
	if ( f.x >= 0.0 && f.y >= 0.0 && f.x <= uHorizonSizes.x - 1.0 && f.y <= uHorizonSizes.y - 1.0 ) {
		vec2 rg = textureLod( uHorizonFineN, ( f + 0.5 ) / uHorizonSizes.xy, max( lod - uHorizonFine.w, 0.0 ) ).rg;
		vec2 n = ( rg * 255.0 - 127.5 ) / 127.5;
		return normalize( vec3( n.x, sqrt( max( 1.0 - dot( n, n ), 0.0 ) ), n.y ) );
	}
	float s = ringCoarseSpan( lod );
	// The game's frame: raw x runs the other way, so the slope along it is the normal's x as it stands, z's turned (normalsOf).
	return normalize( vec3( ringCoarseDx( raw.x, raw.y, s ), 1.0, -ringCoarseDz( raw.x, raw.y, s ) ) );
}
// The vertex's normal where the shape window holds it (wave 3b): the window's own central differences s either side
// (normalsOf's arithmetic and frame, at the vertex's own spacing, as the near ground's vertices take theirs), mixed with the
// bake's by the least share of the five places; the bake's alone where the window holds none.
vec3 ringShapeNormal( vec2 raw, float s, vec3 base, float share ) {
	if ( share <= 0.0 ) return base;
	float hx1 = shapeHeight( raw.x + s, raw.y );
	float k = min( share, gShapeShare );
	float hx0 = shapeHeight( raw.x - s, raw.y );
	k = min( k, gShapeShare );
	float hz1 = shapeHeight( raw.x, raw.y + s );
	k = min( k, gShapeShare );
	float hz0 = shapeHeight( raw.x, raw.y - s );
	k = min( k, gShapeShare );
	if ( k <= 0.0 ) return base;
	vec3 n = normalize( vec3( ( hx1 - hx0 ) / ( 2.0 * s ), 1.0, -( hz1 - hz0 ) / ( 2.0 * s ) ) );
	return normalize( mix( base, n, k ) );
}
`;

const VERTEX_PARS = /* glsl */ `
attribute vec4 aRing;
uniform sampler2D uHorizonHeights;
${SHARED_PARS}
${HORIZON_RING_FUNCTIONS}
${RING_NORMAL_GLSL}
vec3 gRingPos;
`;

/**
 * The ring's vertex (at `#include <beginnormal_vertex>`, which comes before `begin_vertex`): an instance is a node's corner,
 * its level and, for a skirt strip, its side; the vertex morphs by its own place, is held inside the reach, and stands at
 * the bake's height less the drop, its normal the baked one at the node's own level.
 */
export const HORIZON_RING_VERTEX = /* glsl */ `
	float gL = aRing.z;
	float gQ = ${(64 / PATCH).toFixed(1)} * pow( 2.0, gL );
	float gSide = aRing.w;
	float gI = position.x;
	float gJ = position.z;
	float gHang = 0.0;
	if ( gSide > 0.5 ) {
		if ( gSide < 1.5 ) { gI = position.x; gJ = 0.0; }
		else if ( gSide < 2.5 ) { gI = ${PATCH.toFixed(1)}; gJ = position.x; }
		else if ( gSide < 3.5 ) { gI = position.x; gJ = ${PATCH.toFixed(1)}; }
		else { gI = 0.0; gJ = position.x; }
		gHang = position.y > 1.5 ? 1.0 : 0.0;
	}
	float gVx = aRing.x + gI * gQ;
	float gVz = aRing.y + gJ * gQ;
	float gH0 = bakeHeight( uGroundFrame.x - gVx, gVz + uGroundFrame.y );
	float gDx = gVx - uHorizonEye.x;
	float gDz = gVz - uHorizonEye.z;
	float gDy = gH0 - uHorizonEye.y;
	float gD = ringLevelOf( sqrt( gDx * gDx + gDy * gDy + gDz * gDz ), uHorizonMorph.x, uHorizonMorph.y, uHorizonShape, uHorizonShapeAt.w );
	float gE = ringEdgeLevel( ringEdgeDistance( gVx, gVz, uHorizonSquare.x, uHorizonSquare.y, uHorizonSquare.z, uHorizonSquare.w ), uHorizonMorph.z, uHorizonMorph.y );
	float gW = min( min( gD, gE ), uHorizonMorph.w );
	float gMx = ringMorph( gVx, uHorizonGrid.x, gW, gL );
	float gMz = ringMorph( gVz, uHorizonGrid.y, gW, gL );
	float gK = ringReach( gMx - uHorizonEye.x, gMz - uHorizonEye.z, uHorizonEye.w );
	gMx = uHorizonEye.x + ( gMx - uHorizonEye.x ) * gK;
	gMz = uHorizonEye.z + ( gMz - uHorizonEye.z ) * gK;
	float gEdge = ringEdgeDistance( gMx, gMz, uHorizonSquare.x, uHorizonSquare.y, uHorizonSquare.z, uHorizonSquare.w );
	vec2 gRaw = vec2( uGroundFrame.x - gMx, gMz + uGroundFrame.y );
	float gH = ringHeightAt( gRaw.x, gRaw.y ) - ringDrop( gEdge, uHorizonDrop.x, uHorizonDrop.y, uHorizonDrop.z ) - gHang * uHorizonDrop.w;
	float gShapeW = gShapeShare;
	gRingPos = vec3( gMx, gH, gMz );
	vRingRaw = gRaw;
	vRingWorld = gRingPos;
	vRingEdge = gEdge;
	vRingDist = length( vec2( gMx - uHorizonEye.x, gMz - uHorizonEye.z ) );
	vRingLevel = gL;
	vRingShape = gShapeW;
	vGroundY = gH;
	vGroundUV = vec2( uGroundFrame.z * gRaw.x, gRaw.y ) * 0.25;
	vec3 objectNormal = ringShapeNormal( gRaw, max( uHorizonShapeAt.x, ${(64 / PATCH).toFixed(1)} * exp2( floor( max( gW, gL ) ) ) ), ringNormalAt( gRaw, gL ), gShapeW );
	// The window's smooth lean to the fragment (wave 3b's review): the ring is flat shaded, so three hands it no vertex normal.
	vRingShapeN = objectNormal;
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( 1.0, 0.0, 0.0 );
#endif
`;

/**
 * The steep faces' normal in the ring (wave 3b): the ring's geometry carries no normal, so three draws it flat shaded and
 * declares no `vNormal` (a program naming it does not compile, and the rings draw nothing); the side pictures take the
 * ground's own lean instead, as the ring's lighting does (`FRAGMENT_NORMAL`'s first two lines): the baked normal, mixed
 * toward the window's own smooth lean (`vRingShapeN`) by the shape window's share, in the view's frame as `groundTriSetup`
 * takes it. The face, taken at the top of `main()` (`gRingFaceN`), is the base's past the fine extent alone.
 */
const RING_TRI_NORMAL_GLSL = /* glsl */ `
vec3 gRingFaceN = vec3( 0.0, 0.0, 1.0 );
vec3 ringTriViewNormal() {
	vec3 w = ringBaseNormal( vRingRaw, gRingFaceN );
	if ( vRingShape > 0.0 ) w = normalize( mix( w, normalize( vRingShapeN ), vRingShape ) );
	return ( viewMatrix * vec4( w, 0.0 ) ).xyz;
}
`;
/** The tile program's steep-face line as the ring runs it: its normal the ground's own lean, not three's `vNormal`. */
export const RING_TRI_SWAP = ['gYd, vNormal );', 'gYd, ringTriViewNormal() );'] as const;

const FRAGMENT_PARS = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2D uHorizonAlbedo;
uniform sampler2D uHorizonCoarseAlbedo;
uniform highp usampler2D uHorizonWindow;
uniform sampler2D uHorizonTint;
uniform vec4 uHorizonWin;
uniform vec4 uHorizonWinC;
uniform sampler2DArray uGround;
uniform sampler2DArray uGroundBump;
uniform sampler2DArray uGroundMask;
uniform sampler2D uGroundClouds;
uniform vec4 uGroundCloud;
uniform vec4 uGroundShine;
uniform vec4 uGroundLook;
uniform vec4 uGroundTint;
uniform vec4 uGroundTintRef;
uniform sampler2D uGradient;
uniform sampler2D uGradient2;
uniform vec4 uRingDome;
uniform vec3 uClear;
uniform vec3 uHorizonFog;
${SHARED_PARS}
// What the tile program's own lines read, as the near ground's varyings and globals are named: a tile's layers, codes,
// place and tint, filled from the composition window a fragment (ringWindowAt), and what its stages hand on.
vec4 vGroundLayers = vec4( 0.0 );
vec4 vGroundBlend = vec4( 0.0 );
vec2 vGroundTile = vec2( 0.0 );
vec3 vGroundTint = vec3( 1.0 );
vec3 gGroundW = vec3( 0.0 );
vec4 gGroundBump = vec4( 0.5, 0.5, 1.0, 0.0 );
vec3 gGroundAlbedo = vec3( 1.0 );
float gGroundFlat = 0.0;
vec3 gGroundNormalW = vec3( 0.0, 1.0, 0.0 );
// The near ground's relief moves its picture; the rings' never does (wave 3b: the relief is the tile program's alone).
vec2 gGroundOff = vec2( 0.0 );
uniform vec4 uGroundTri;
${GROUND_TINT_GLSL}
${GROUND_MASK_GLSL}
${GROUND_TRI_WANTED ? GROUND_TRI_GLSL : ''}
${GROUND_DECODE_GLSL}
${GROUND_CLOUD_GLSL}
vec2 gRingYd = vec2( 0.0 );
vec2 gRingDx = vec2( 0.0 );
vec2 gRingDy = vec2( 0.0 );
vec2 gUvDx = vec2( 0.0 );
vec2 gUvDy = vec2( 0.0 );
vec2 gTileDx = vec2( 0.0 );
vec2 gTileDy = vec2( 0.0 );
vec3 gRingAlbedo = vec3( 1.0 );
// The near composition's share at this fragment (nought past the ground detail distance or outside the window), and the window's tile count there.
float gRingNear = 0.0;
float gRingCount = 0.0;
// The composition window at a raw place: false outside it (or where it holds nothing yet); else the tile's layers and
// codes unpacked as the near ground's vertex carries them, its place in the tile (s along raw x, t along raw z), and the
// colour cells' bilinear between their centres, through the tile program's own tint, as the near ground's vertex takes it.
// Written by its components, so the node tests run its own text (horizonWindow.test.ts).
bool ringWindowAt( vec2 raw ) {
	float tx = floor( raw.x * 0.25 );
	float tz = floor( raw.y * 0.25 );
	float rx = tx - uHorizonWin.x;
	float rz = tz - uHorizonWin.y;
	if ( rx < 0.0 || rz < 0.0 || rx >= uHorizonWin.z || rz >= uHorizonWin.z ) return false;
	float cx = ( raw.x - uHorizonColour.x ) / uHorizonColour.z;
	float cz = ( raw.y - uHorizonColour.y ) / uHorizonColour.z;
	float rcx = floor( cx ) - uHorizonWinC.x;
	float rcz = floor( cz ) - uHorizonWinC.y;
	if ( rcx < 0.0 || rcz < 0.0 || rcx + 1.0 >= uHorizonWin.w || rcz + 1.0 >= uHorizonWin.w ) return false;
	uvec4 w = texelFetch( uHorizonWindow, ivec2( int( mod( tx, uHorizonWin.z ) ), int( mod( tz, uHorizonWin.z ) ) ), 0 );
	if ( w.w == 0u ) return false;
	vGroundLayers = vec4( float( w.x & 255u ), float( w.x >> 8u ), float( w.y & 255u ), float( w.y >> 8u ) );
	vGroundBlend = vec4( float( w.z & 31u ), float( ( w.z >> 5u ) & 31u ), float( ( w.z >> 10u ) & 31u ), 0.0 );
	vGroundTile = vec2( raw.x * 0.25 - tx, raw.y * 0.25 - tz );
	vec3 tint = textureLod( uHorizonTint, vec2( ( mod( cx, uHorizonWin.w ) + 0.5 ) / uHorizonWin.w, ( mod( cz, uHorizonWin.w ) + 0.5 ) / uHorizonWin.w ), 0.0 ).rgb;
	vGroundTint = groundTintOf( tint );
	gRingCount = float( w.w );
	return true;
}
// The ground's own lean at the fragment in the world's frame: the baked normal by its derivatives inside the fine extent
// (the fine's mips, so a far ridge is lit by its own relief), the vertex's past it (the coarse heights' own differences).
vec3 ringBaseNormal( vec2 raw, vec3 viewNormal ) {
	vec2 f = ( raw - uHorizonFine.xy ) / uHorizonFine.z;
	if ( f.x >= 0.0 && f.y >= 0.0 && f.x <= uHorizonSizes.x - 1.0 && f.y <= uHorizonSizes.y - 1.0 ) {
		vec2 k = 1.0 / ( uHorizonFine.z * uHorizonSizes.xy );
		vec2 rg = textureGrad( uHorizonFineN, ( f + 0.5 ) / uHorizonSizes.xy, gRingDx * k, gRingDy * k ).rg;
		vec2 n = ( rg * 255.0 - 127.5 ) / 127.5;
		return normalize( vec3( n.x, sqrt( max( 1.0 - dot( n, n ), 0.0 ) ), n.y ) );
	}
	return normalize( ( vec4( viewNormal, 0.0 ) * viewMatrix ).xyz );
}
// The sky's own colour in a direction (the dome's lines, its four numbers out of one vector), for the horizon fade.
vec3 ringSky( vec3 d ) {
	float up = clamp( d.y, 0.0, 0.999 );
#define uTime uRingDome.x
#define uHasGradient uRingDome.y
#define uHasGradient2 uRingDome.z
#define uGradientMix uRingDome.w
	${DOME_COLOUR_GLSL}
#undef uTime
#undef uHasGradient
#undef uHasGradient2
#undef uGradientMix
	return col;
}
// A linear colour into the space this program's pixels are in after three's tone-mapping and colour-space chunks, as the
// dome's own pixels are (its program ends in both): the fade mixes after them, so its sky must be carried there first.
// Drawing into the effects' target three defines no tone mapping and a linear output, and this is the colour itself.
vec3 ringOut( vec3 c ) {
#ifdef TONE_MAPPING
	c = toneMapping( c );
#endif
	return linearToOutputTexel( vec4( c, 1.0 ) ).rgb;
}
// The albedo at a raw place: the fine cells inside their extent, the coarse past it, each with its mips by the place's own derivatives.
vec3 ringAlbedoAt( vec2 raw ) {
	vec2 f = ( raw - uHorizonColour.xy ) / uHorizonColour.z;
	if ( f.x >= -0.5 && f.y >= -0.5 && f.x <= uHorizonColourN.x - 0.5 && f.y <= uHorizonColourN.y - 0.5 ) {
		vec2 k = 1.0 / ( uHorizonColour.z * uHorizonColourN.xy );
		return textureGrad( uHorizonAlbedo, ( f + 0.5 ) / uHorizonColourN.xy, gRingDx * k, gRingDy * k ).rgb * ${ALBEDO_SCALE.toFixed(1)};
	}
	vec2 c = ( raw - uHorizonCoarse.xy ) / uHorizonCoarse.z;
	vec2 kc = 1.0 / ( uHorizonCoarse.z * uHorizonSizes.zw );
	return textureGrad( uHorizonCoarseAlbedo, ( c + 0.5 ) / uHorizonSizes.zw, gRingDx * kc, gRingDy * kc ).rgb * ${ALBEDO_SCALE.toFixed(1)};
}
${GROUND_TRI_WANTED ? RING_TRI_NORMAL_GLSL : ''}`;

/**
 * The tile program's own composition (`TILE_MAP`) as the ring runs it, or null when its text has moved from what this
 * reads: its four derivatives are the ring's, taken once at the top of `main()` (the tile's place is worked out per
 * fragment, so its own derivative would jump at every tile's edge; the ring's comes off the raw place, which never
 * does), and its last line, the multiply into the surface's colour, is the ring's to make after the fade. Every swap
 * found exactly once, or none made.
 */
export const TILE_MAP_SWAPS: readonly (readonly [string, string])[] = [
  ['vec2 gDx = dFdx( vGroundUV );', 'vec2 gDx = gUvDx;'],
  ['vec2 gDy = dFdy( vGroundUV );', 'vec2 gDy = gUvDy;'],
  ['vec2 gTx = dFdx( vGroundTile );', 'vec2 gTx = gTileDx;'],
  ['vec2 gTy = dFdy( vGroundTile );', 'vec2 gTy = gTileDy;'],
  // The steep faces' height derivatives (wave 3b), the ring's own taken at the top of main() as its others are.
  ...(TILE_MAP.includes(TILE_MAP_Y_LINE) ? [[TILE_MAP_Y_LINE, 'vec2 gYd = gRingYd;'] as const, RING_TRI_SWAP] : []),
  ['diffuseColor.rgb *= gGroundAlbedo;', '// (the ring multiplies the surface after the fade)'],
];
export function ringTileMap(src: string): string | null {
  let s = src;
  for (const [a, b] of TILE_MAP_SWAPS) {
    if (s.split(a).length !== 2) return null;
    s = s.replace(a, b);
  }
  return s;
}
const RING_TILE_MAP = ringTileMap(TILE_MAP);

/** Fragment, at the top of main: the derivatives once (every branch after hands them on), then the fog's cheap path. */
const FRAGMENT_TOP = /* glsl */ `
	gRingDx = dFdx( vRingRaw );
	gRingDy = dFdy( vRingRaw );
	gUvDx = dFdx( vGroundUV );
	gUvDy = dFdy( vGroundUV );
	gTileDx = gRingDx * 0.25;
	gTileDy = gRingDy * 0.25;
	gRingYd = vec2( dFdx( vGroundY ), dFdy( vGroundY ) );
${GROUND_TRI_WANTED ? '\tgRingFaceN = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );\n' : ''}#ifdef FOG_EXP2
	{
		float gFog = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
		if ( gFog > uHorizonLook.x && uHorizonFade.w < 0.5 ) {
			gl_FragColor = vec4( fogColor, 1.0 );
			if ( uHorizonFade.y > 0.5 && uHorizonFade.z < 0.5 ) gl_FragColor.rgb = mix( gl_FragColor.rgb, ringOut( ringSky( normalize( vRingWorld - cameraPosition ) ) ), smoothstep( uHorizonEye.w * ( 1.0 - uHorizonFade.x ), uHorizonEye.w, vRingDist ) );
			return;
		}
	}
#endif
`;

/**
 * Fragment, after `#include <map_fragment>`: the colour. Inside the ground detail distance and the window the near
 * ground's own composition (the tile program's `TILE_MAP`, every family's picture in the alternate its corner chose, the
 * client's masks between them, the colour map's tint), fading over the distance's last `uHorizonLook.z` into the bake's
 * albedo, the per-tile mean the composition's own mips come to; its bump and gloss fade toward flat and matt with it.
 * Past the distance the albedo alone, and no tap of the composition's.
 */
const FRAGMENT_MAP = /* glsl */ `
{
	float gWd = uHorizonLook.w * ( 1.0 - smoothstep( uHorizonLook.y - uHorizonLook.z, uHorizonLook.y, vRingDist ) );
	bool gIn = gWd > 0.0 && ringWindowAt( vRingRaw );
	if ( !gIn ) gWd = 0.0;
	if ( gWd < 1.0 ) gRingAlbedo = ringAlbedoAt( vRingRaw );
	if ( gIn ) {
${RING_TILE_MAP ?? ''}
		gRingAlbedo = gWd < 1.0 ? mix( gRingAlbedo, gGroundAlbedo, gWd ) : gGroundAlbedo;
		gGroundBump = vec4( mix( vec3( 0.5, 0.5, 1.0 ), gGroundBump.xyz, gWd ), gGroundBump.a * gWd );
	}
	gRingNear = gWd;
	diffuseColor.rgb *= gRingAlbedo;
}
`;

/**
 * Fragment, after `#include <normal_fragment_maps>` and before the weather's: the ground's own lean (the baked normal, or
 * the vertex's past the fine extent), then, where the near composition is drawn, the tile program's own `TILE_NORMAL`,
 * which adds its blended bump's slope as the near ground's does.
 */
const FRAGMENT_NORMAL = /* glsl */ `
gGroundNormalW = ringBaseNormal( vRingRaw, normal );
// Where the shape window holds the ground (wave 3b) its own vertices' lean (the window's central differences at each vertex's
// spacing, smooth across the triangle as the near ground's vertex normals are), by the window's share; never the flat
// face's, which would facet every level-0 patch the window holds and part from the near ground at the hole's edge.
if ( vRingShape > 0.0 ) gGroundNormalW = normalize( mix( gGroundNormalW, normalize( vRingShapeN ), vRingShape ) );
normal = normalize( ( viewMatrix * vec4( gGroundNormalW, 0.0 ) ).xyz );
if ( gRingNear > 0.0 ) ${TILE_NORMAL.trim()}
`;

/** Fragment, after `#include <roughnessmap_fragment>` and before the weather's: the tile program's own gloss (nought past the distance). */
const FRAGMENT_ROUGH = TILE_ROUGHNESS;

const FRAGMENT_CLOUDS = /* glsl */ `
if ( uGroundCloud.x > 0.5 ) outgoingLight *= groundCloudShade( outgoingLight );
`;

/**
 * Fragment, after `#include <fog_fragment>`: the horizon fade (a switch of three, §1b Q4). It mixes after three's tone
 * mapping and colour space, so the sky's colour (and the dome's own fog colour) are carried there first (`ringOut`), as
 * the dome's own pixels are; three's `fogColor` is mixed as three's fog mixes it, as it stands.
 */
const FRAGMENT_FADE = /* glsl */ `
if ( uHorizonFade.y > 0.5 && uHorizonFade.z < 1.5 ) {
	float gF = smoothstep( uHorizonEye.w * ( 1.0 - uHorizonFade.x ), uHorizonEye.w, vRingDist );
	vec3 gTo = ringOut( uHorizonFog );
#ifdef USE_FOG
	gTo = fogColor;
#endif
	if ( uHorizonFade.z < 0.5 ) gTo = ringOut( ringSky( normalize( vRingWorld - cameraPosition ) ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, gTo, gF );
}
`;

/** Fragment, after `#include <dithering_fragment>`: one of the program's parts for the console (a uniform). */
const FRAGMENT_VIEW = /* glsl */ `
if ( uHorizonFade.w > 0.5 ) {
	if ( uHorizonFade.w < 1.5 ) gl_FragColor = vec4( fract( vRingLevel * 0.37 + 0.1 ), fract( vRingLevel * 0.61 + 0.5 ), fract( vRingLevel * 0.13 + 0.8 ), 1.0 );
	else if ( uHorizonFade.w < 2.5 ) gl_FragColor = vec4( gRingAlbedo, 1.0 );
	else if ( uHorizonFade.w < 3.5 ) gl_FragColor = vec4( gGroundNormalW * 0.5 + 0.5, 1.0 );
	else if ( uHorizonFade.w < 4.5 ) gl_FragColor = vec4( clamp( vRingEdge / 512.0, 0.0, 1.0 ), clamp( -vRingEdge / 64.0, 0.0, 1.0 ), 0.2, 1.0 );
	else if ( uHorizonFade.w < 5.5 ) gl_FragColor = vec4( gRingNear > 0.0 ? gGroundAlbedo : gRingAlbedo * 0.35, 1.0 );
	else gl_FragColor = vec4( gRingNear, gRingCount > 0.0 ? 1.0 : 0.0, gRingCount * 0.25, 1.0 );
}
`;

/**
 * The weather's shelter, which reads the roof grid round the camera: the call the ring program leaves out. No ring stands
 * within the grid (the hole round the camera is a chunk at the least each way, the grid 36 m), where the shelter answers
 * open and uncovered, which is what stands in its place: so the roof grid's sampler is never read and takes no unit.
 */
export const RING_SHELTER = ['vec2 wetShelter = weatherShelter(vWetPos, wetN);', 'vec2 wetShelter = vec2(0.0);'] as const;

/** The program's own pieces, for the scan (`horizonShaders.test.ts`). */
export const RING_TEXT = { VERTEX_PARS, HORIZON_RING_VERTEX, FRAGMENT_PARS, FRAGMENT_TOP, FRAGMENT_MAP, FRAGMENT_NORMAL, FRAGMENT_ROUGH, FRAGMENT_CLOUDS, FRAGMENT_FADE, FRAGMENT_VIEW };

/** Every anchor the ring program writes at: all of them or nothing. */
export const RING_ANCHORS = {
  vertex: ['#include <common>', '#include <beginnormal_vertex>', '#include <begin_vertex>'],
  fragment: ['#include <common>', '#include <clipping_planes_fragment>', '#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <normal_fragment_maps>', '#include <lights_physical_pars_fragment>', '#include <opaque_fragment>', '#include <fog_fragment>', '#include <dithering_fragment>'],
};

const after = (s: string, chunk: string, code: string) => s.replace(chunk, `${chunk}\n${code}`);

/**
 * The ring program into one shader; answers whether it went in: every anchor there, the tile program's composition read
 * (`ringTileMap`) and three's highlight line found for the flat shine to follow (`GGX_ANCHOR`), or nothing written.
 */
export function injectRing(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> }, u: RingUniforms, ground: GroundTileUniforms, chunk: string = THREE.ShaderChunk.lights_physical_pars_fragment): boolean {
  const vs = shader.vertexShader;
  const fs = shader.fragmentShader;
  if (RING_ANCHORS.vertex.some((a) => !vs.includes(a)) || RING_ANCHORS.fragment.some((a) => !fs.includes(a))) return false;
  const ggx = chunk.indexOf(GGX_ANCHOR);
  if (ggx < 0 || !RING_TILE_MAP) return false;
  // The near ground's flat shine, the tile program's own line after three's highlight (`injectGroundTiles`'s).
  const pars = `${chunk.slice(0, ggx + GGX_ANCHOR.length)}\n\t${TILE_FLAT_LINE}${chunk.slice(ggx + GGX_ANCHOR.length)}`;
  shader.vertexShader = after(vs, '#include <common>', VERTEX_PARS).replace('#include <beginnormal_vertex>', HORIZON_RING_VERTEX).replace('#include <begin_vertex>', 'vec3 transformed = gRingPos;');
  let f = after(fs, '#include <common>', FRAGMENT_PARS);
  f = after(f, '#include <clipping_planes_fragment>', FRAGMENT_TOP);
  f = after(f, '#include <map_fragment>', FRAGMENT_MAP);
  f = f.replace('#include <lights_physical_pars_fragment>', pars);
  f = f.replace('#include <opaque_fragment>', `${FRAGMENT_CLOUDS}\n#include <opaque_fragment>`);
  f = after(f, '#include <fog_fragment>', FRAGMENT_FADE);
  f = after(f, '#include <dithering_fragment>', FRAGMENT_VIEW);
  shader.fragmentShader = f;
  // The near ground's own weather (its darkening by the ground's facing, its gloss and snow; its puddles and their rings
  // lie within 33 m of the camera, which no ring does), its shelter open (`RING_SHELTER`).
  injectWetness(shader as never, 'ground');
  shader.fragmentShader = shader.fragmentShader.replace(RING_SHELTER[0], RING_SHELTER[1]);
  // The lean and the gloss land before the weather's at the same anchors (the tile program's order), so the weather has the last word.
  shader.fragmentShader = after(after(shader.fragmentShader, '#include <normal_fragment_maps>', FRAGMENT_NORMAL), '#include <roughnessmap_fragment>', FRAGMENT_ROUGH);
  Object.assign(shader.uniforms, u);
  // The tile program's own uniform objects, by reference: the pictures, masks, tint, mirror, cloud tile, its clock, the
  // bumps' and gloss's strengths and the masks' two switches move both.
  shader.uniforms.uGroundFrame = ground.uGroundFrame;
  shader.uniforms.uGround = ground.uGround;
  shader.uniforms.uGroundBump = ground.uGroundBump;
  shader.uniforms.uGroundMask = ground.uGroundMask;
  shader.uniforms.uGroundClouds = ground.uGroundClouds;
  shader.uniforms.uGroundCloud = ground.uGroundCloud;
  shader.uniforms.uGroundShine = ground.uGroundShine;
  shader.uniforms.uGroundLook = ground.uGroundLook;
  shader.uniforms.uGroundTint = ground.uGroundTint;
  shader.uniforms.uGroundTintRef = ground.uGroundTintRef;
  shader.uniforms.uGroundTri = ground.uGroundTri;
  return true;
}

/**
 * The session's ring material, made once and never disposed (`groundTilesMaterial`'s pattern): the cascades first, then
 * the ring program, under a key of its own. The world hands its uniforms a world's textures; nothing compiles again.
 */
export function ringMaterial(u: RingUniforms, ground: GroundTileUniforms, csm: CSM | null): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  csm?.setupMaterial(mat);
  const previous = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    previous.call(mat, shader, renderer);
    if (!injectRing(shader, u, ground)) console.warn('horizon: the ring shader has no place for its stages; the rings draw nothing of the bake');
  };
  mat.userData.wetBuiltIn = true;
  mat.customProgramCacheKey = () => HORIZON_RING_KEY;
  return mat;
}

/** The patch: 9 by 9 vertices (x, 0, z in quads), 128 triangles, each quad split from its raw south-west corner to its north-east. */
export function patchGeometry(cap: number): { geometry: THREE.InstancedBufferGeometry; attribute: THREE.InstancedBufferAttribute } {
  const g = new THREE.InstancedBufferGeometry();
  const n = PATCH + 1;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.set([i, 0, j], (j * n + i) * 3);
  const idx: number[] = [];
  for (let j = 0; j < PATCH; j++) {
    for (let i = 0; i < PATCH; i++) {
      const p00 = j * n + i;
      const p10 = p00 + 1;
      const p01 = p00 + n;
      const p11 = p01 + 1;
      // The game's +x is the raw frame's -x: the raw south-west to north-east diagonal is (i + 1, j) to (i, j + 1) here.
      idx.push(p00, p01, p10, p10, p01, p11);
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aRing', a);
  g.instanceCount = 0;
  return { geometry: g, attribute: a };
}

/** The skirt strip: 9 vertices along an edge at the top (y 1) and 9 hung (y 2), wound both ways (any side faces the hole). */
export function skirtGeometry(cap: number): { geometry: THREE.InstancedBufferGeometry; attribute: THREE.InstancedBufferAttribute } {
  const g = new THREE.InstancedBufferGeometry();
  const n = PATCH + 1;
  const pos = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    pos.set([i, 1, 0], i * 3);
    pos.set([i, 2, 0], (n + i) * 3);
  }
  const idx: number[] = [];
  for (let i = 0; i < PATCH; i++) {
    const t0 = i;
    const t1 = i + 1;
    const b0 = n + i;
    const b1 = n + i + 1;
    idx.push(t0, b0, t1, t1, b0, b1);
    idx.push(t0, t1, b0, t1, b1, b0);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aRing', a);
  g.instanceCount = 0;
  return { geometry: g, attribute: a };
}

/** A ring mesh: under the chunks' root, receiving and casting nothing, culled by its instances and answering no ray. */
export function ringMesh(geometry: THREE.InstancedBufferGeometry, material: THREE.Material, name: string, order: number): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.frustumCulled = false;
  m.receiveShadow = true;
  m.castShadow = false;
  m.renderOrder = order;
  m.raycast = () => {};
  m.userData.horizonRing = true;
  return m;
}
