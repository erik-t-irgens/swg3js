// The far ground's rings (DESIGN.md §2.4, §2.5, §2.13): one 8 by 8 patch and one skirt strip drawn as instances, one
// for each node the selection keeps (`horizonMath.ts`), by one program of the session for both, a `MeshStandardMaterial`
// whose compile hook writes the ring's vertex stage -- the heights from the bake, the morph by each vertex's own place
// (its distance's level and its edge's level, the lesser), the drop at the hole's edge, the reach's clamp, the vertex
// normal -- and its shading: the albedo composed per 4 m tile, the near band's grain from the tile program's own
// picture arrays through the detail window, the client's cloud shadows (the tile program's own lines), the weather's wet
// look (`injectWetness`, 'object'), three's fog with a cheap path for what it has taken, and the horizon fade into the
// sky's own colour (the dome's own lines). Every part behind a uniform at its starting value: the gate measures the
// program at the cost it ships at.
//
// Light and shadow's step 5 multiplies the sun's direct light here where the leaf cards capture the cascades' shadow
// (`swgSunShadow`, the five sites `cardLightsBegin` rewrites): no sampler is reserved for it now. Its step 3 makes a depth
// twin from `HORIZON_RING_VERTEX`, which morphs by `uHorizonEye` and never `cameraPosition`.
import * as THREE from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';
import { DOME_COLOUR_GLSL } from '../domeColour.ts';
import { GROUND_CLOUD_GLSL, GROUND_DECODE_GLSL, type GroundTileUniforms } from '../terrainTextures.ts';
import { injectWetness } from '../wetness.ts';
import { ALBEDO_SCALE, DETAIL_SIZE, DETAIL_TILE } from './horizonDecode.ts';
import { PATCH } from './horizonMath.ts';

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
  uHorizonFineH: THREE.IUniform<THREE.Texture>;
  uHorizonCoarseH: THREE.IUniform<THREE.Texture>;
  uHorizonFineN: THREE.IUniform<THREE.Texture>;
  uHorizonCoarseN: THREE.IUniform<THREE.Texture>;
  uHorizonAlbedo: THREE.IUniform<THREE.Texture>;
  uHorizonCoarseAlbedo: THREE.IUniform<THREE.Texture>;
  uHorizonDetail: THREE.IUniform<THREE.Texture>;
  uHorizonMeans: THREE.IUniform<THREE.Texture>;
  /** x the fog's cheap path, y the detail's reach, z its fade, w the detail on. */
  uHorizonLook: THREE.IUniform<THREE.Vector4>;
  /** x the fade's share, y on, z its colour (0 the sky, 1 the fog, 2 none), w what is drawn (`HORIZON_VIEWS`' index). */
  uHorizonFade: THREE.IUniform<THREE.Vector4>;
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
  const d = tex1(THREE.RedFormat, THREE.UnsignedByteType, new Uint8Array([0]));
  const m = tex1(THREE.RGBAFormat, THREE.FloatType, new Float32Array([0.5, 0.5, 0.5, 1]));
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
    uHorizonFineH: { value: h },
    uHorizonCoarseH: { value: h },
    uHorizonFineN: { value: n },
    uHorizonCoarseN: { value: n },
    uHorizonAlbedo: { value: a },
    uHorizonCoarseAlbedo: { value: a },
    uHorizonDetail: { value: d },
    uHorizonMeans: { value: m },
    uHorizonLook: { value: new THREE.Vector4(0.996, 1200, 400, 1) },
    uHorizonFade: { value: new THREE.Vector4(0.15, 1, 0, 0) },
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
float bakeTap( sampler2D t, int i, int j ) {
	return texelFetch( t, ivec2( i, j ), 0 ).r;
}
float bakeLerp( sampler2D t, float fx, float fz, float nx, float nz ) {
	float cx = clamp( fx, 0.0, nx - 1.0 );
	float cz = clamp( fz, 0.0, nz - 1.0 );
	float ix = min( floor( cx ), nx - 2.0 );
	float iz = min( floor( cz ), nz - 2.0 );
	float ax = cx - ix;
	float az = cz - iz;
	int i = int( ix );
	int j = int( iz );
	float h0 = mix( bakeTap( t, i, j ), bakeTap( t, i + 1, j ), ax );
	float h1 = mix( bakeTap( t, i, j + 1 ), bakeTap( t, i + 1, j + 1 ), ax );
	return mix( h0, h1, az );
}
float bakeHeight( float rx, float rz ) {
	float fx = ( rx - uHorizonFine.x ) / uHorizonFine.z;
	float fz = ( rz - uHorizonFine.y ) / uHorizonFine.z;
	if ( fx >= 0.0 && fz >= 0.0 && fx <= uHorizonSizes.x - 1.0 && fz <= uHorizonSizes.y - 1.0 ) return bakeLerp( uHorizonFineH, fx, fz, uHorizonSizes.x, uHorizonSizes.y );
	return bakeLerp( uHorizonCoarseH, ( rx - uHorizonCoarse.x ) / uHorizonCoarse.z, ( rz - uHorizonCoarse.y ) / uHorizonCoarse.z, uHorizonSizes.z, uHorizonSizes.w );
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
uniform vec4 uGroundFrame;
uniform sampler2D uHorizonFineN;
uniform sampler2D uHorizonCoarseN;
varying vec2 vRingRaw;
varying vec3 vRingWorld;
varying float vRingEdge;
varying float vRingDist;
flat varying float vRingLevel;
varying vec2 vGroundUV;
// The baked normal at a raw place (RG8 biased by 128: the game-frame x and z, the up rebuilt), for a node of level lod:
// a level's vertices stand 8 m times two to the level apart, so each lattice is read at that level less its own step's
// share of 8 m in mips (uHorizonFine.w, uHorizonCoarse.w: log2 of the step over 8, so a 16 m bake reads one mip less).
vec3 ringNormalAt( vec2 raw, float lod ) {
	vec2 f = ( raw - uHorizonFine.xy ) / uHorizonFine.z;
	vec2 rg;
	if ( f.x >= 0.0 && f.y >= 0.0 && f.x <= uHorizonSizes.x - 1.0 && f.y <= uHorizonSizes.y - 1.0 ) rg = textureLod( uHorizonFineN, ( f + 0.5 ) / uHorizonSizes.xy, max( lod - uHorizonFine.w, 0.0 ) ).rg;
	else rg = textureLod( uHorizonCoarseN, ( ( raw - uHorizonCoarse.xy ) / uHorizonCoarse.z + 0.5 ) / uHorizonSizes.zw, max( lod - uHorizonCoarse.w, 0.0 ) ).rg;
	vec2 n = ( rg * 255.0 - 127.5 ) / 127.5;
	return normalize( vec3( n.x, sqrt( max( 1.0 - dot( n, n ), 0.0 ) ), n.y ) );
}
`;

const VERTEX_PARS = /* glsl */ `
attribute vec4 aRing;
uniform sampler2D uHorizonFineH;
uniform sampler2D uHorizonCoarseH;
${SHARED_PARS}
${HORIZON_RING_FUNCTIONS}
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
	float gD = ringDistLevel( sqrt( gDx * gDx + gDy * gDy + gDz * gDz ), uHorizonMorph.x, uHorizonMorph.y );
	float gE = ringEdgeLevel( ringEdgeDistance( gVx, gVz, uHorizonSquare.x, uHorizonSquare.y, uHorizonSquare.z, uHorizonSquare.w ), uHorizonMorph.z, uHorizonMorph.y );
	float gW = min( min( gD, gE ), uHorizonMorph.w );
	float gMx = ringMorph( gVx, uHorizonGrid.x, gW, gL );
	float gMz = ringMorph( gVz, uHorizonGrid.y, gW, gL );
	float gK = ringReach( gMx - uHorizonEye.x, gMz - uHorizonEye.z, uHorizonEye.w );
	gMx = uHorizonEye.x + ( gMx - uHorizonEye.x ) * gK;
	gMz = uHorizonEye.z + ( gMz - uHorizonEye.z ) * gK;
	float gEdge = ringEdgeDistance( gMx, gMz, uHorizonSquare.x, uHorizonSquare.y, uHorizonSquare.z, uHorizonSquare.w );
	vec2 gRaw = vec2( uGroundFrame.x - gMx, gMz + uGroundFrame.y );
	float gH = bakeHeight( gRaw.x, gRaw.y ) - ringDrop( gEdge, uHorizonDrop.x, uHorizonDrop.y, uHorizonDrop.z ) - gHang * uHorizonDrop.w;
	gRingPos = vec3( gMx, gH, gMz );
	vRingRaw = gRaw;
	vRingWorld = gRingPos;
	vRingEdge = gEdge;
	vRingDist = length( vec2( gMx - uHorizonEye.x, gMz - uHorizonEye.z ) );
	vRingLevel = gL;
	vGroundUV = vec2( uGroundFrame.z * gRaw.x, gRaw.y ) * 0.25;
	vec3 objectNormal = ringNormalAt( gRaw, gL );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( 1.0, 0.0, 0.0 );
#endif
`;

const FRAGMENT_PARS = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2D uHorizonAlbedo;
uniform sampler2D uHorizonCoarseAlbedo;
uniform sampler2D uHorizonDetail;
uniform sampler2D uHorizonMeans;
uniform sampler2DArray uGround;
uniform sampler2DArray uGroundBump;
uniform sampler2D uGroundClouds;
uniform vec4 uGroundCloud;
uniform vec4 uGroundShine;
uniform sampler2D uGradient;
uniform sampler2D uGradient2;
uniform vec4 uRingDome;
uniform vec3 uClear;
uniform vec3 uHorizonFog;
${SHARED_PARS}
${GROUND_DECODE_GLSL}
${GROUND_CLOUD_GLSL}
vec2 gRingDx = vec2( 0.0 );
vec2 gRingDy = vec2( 0.0 );
vec2 gUvDx = vec2( 0.0 );
vec2 gUvDy = vec2( 0.0 );
vec4 gRingBump = vec4( 0.5, 0.5, 1.0, 0.0 );
float gRingBumpW = 0.0;
vec3 gRingAlbedo = vec3( 1.0 );
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
// The baked normal at the fragment, by its derivatives (the fine's mips, so a far ridge is lit by its own relief).
vec3 ringNormalFrag( vec2 raw ) {
	vec2 f = ( raw - uHorizonFine.xy ) / uHorizonFine.z;
	vec2 rg;
	if ( f.x >= 0.0 && f.y >= 0.0 && f.x <= uHorizonSizes.x - 1.0 && f.y <= uHorizonSizes.y - 1.0 ) {
		vec2 k = 1.0 / ( uHorizonFine.z * uHorizonSizes.xy );
		rg = textureGrad( uHorizonFineN, ( f + 0.5 ) / uHorizonSizes.xy, gRingDx * k, gRingDy * k ).rg;
	} else {
		vec2 kc = 1.0 / ( uHorizonCoarse.z * uHorizonSizes.zw );
		rg = textureGrad( uHorizonCoarseN, ( ( raw - uHorizonCoarse.xy ) / uHorizonCoarse.z + 0.5 ) / uHorizonSizes.zw, gRingDx * kc, gRingDy * kc ).rg;
	}
	vec2 n = ( rg * 255.0 - 127.5 ) / 127.5;
	return normalize( vec3( n.x, sqrt( max( 1.0 - dot( n, n ), 0.0 ) ), n.y ) );
}
`;

/** Fragment, at the top of main: the derivatives once (every branch after hands them on), then the fog's cheap path. */
const FRAGMENT_TOP = /* glsl */ `
	gRingDx = dFdx( vRingRaw );
	gRingDy = dFdy( vRingRaw );
	gUvDx = dFdx( vGroundUV );
	gUvDy = dFdy( vGroundUV );
#ifdef FOG_EXP2
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

/** Fragment, after `#include <map_fragment>`: the albedo and, in the near band, the tile's own picture's grain and bump. */
const FRAGMENT_MAP = /* glsl */ `
{
	gRingAlbedo = ringAlbedoAt( vRingRaw );
	float gWd = uHorizonLook.w * ( 1.0 - smoothstep( uHorizonLook.y, uHorizonLook.y + uHorizonLook.z, vRingDist ) );
	if ( gWd > 0.0 ) {
		vec2 gT = mod( floor( vRingRaw / ${DETAIL_TILE.toFixed(1)} ), ${DETAIL_SIZE.toFixed(1)} );
		float gLayer = floor( texelFetch( uHorizonDetail, ivec2( gT ), 0 ).r * 255.0 + 0.5 );
		vec3 gMean = texelFetch( uHorizonMeans, ivec2( int( gLayer ), 0 ), 0 ).rgb;
		vec3 gTap = textureGrad( uGround, vec3( vGroundUV, gLayer ), gUvDx, gUvDy ).rgb;
		gRingAlbedo *= mix( vec3( 1.0 ), gTap / max( gMean, vec3( 1e-4 ) ), gWd );
		gRingBump = textureGrad( uGroundBump, vec3( vGroundUV, gLayer ), gUvDx, gUvDy );
		gRingBumpW = gWd;
	}
	diffuseColor.rgb *= gRingAlbedo;
}
`;

/** Fragment, after `#include <normal_fragment_maps>`: the baked normal, the near band's bump slope added by the tile program's arithmetic. */
const FRAGMENT_NORMAL = /* glsl */ `
{
	vec3 gN = ringNormalFrag( vRingRaw );
	if ( gRingBumpW > 0.0 ) {
		vec3 gn = gRingBump.xyz * 2.0 - 1.0;
		vec2 gs = -gn.xy / max( gn.z, 0.2 ) * uGroundShine.z * gRingBumpW;
		gs.x *= -uGroundFrame.z;
		vec2 gg = vec2( -gN.x, -gN.z ) / max( gN.y, 0.2 );
		gN = normalize( vec3( -( gg.x + gs.x ), 1.0, -( gg.y + gs.y ) ) );
	}
	normal = normalize( ( viewMatrix * vec4( gN, 0.0 ) ).xyz );
}
`;

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
	else if ( uHorizonFade.w < 3.5 ) gl_FragColor = vec4( ringNormalFrag( vRingRaw ) * 0.5 + 0.5, 1.0 );
	else gl_FragColor = vec4( clamp( vRingEdge / 512.0, 0.0, 1.0 ), clamp( -vRingEdge / 64.0, 0.0, 1.0 ), 0.2, 1.0 );
}
`;

/** The program's own pieces, for the scan (`horizonShaders.test.ts`). */
export const RING_TEXT = { VERTEX_PARS, HORIZON_RING_VERTEX, FRAGMENT_PARS, FRAGMENT_TOP, FRAGMENT_MAP, FRAGMENT_NORMAL, FRAGMENT_CLOUDS, FRAGMENT_FADE, FRAGMENT_VIEW };

/** Every anchor the ring program writes at: all of them or nothing. */
export const RING_ANCHORS = {
  vertex: ['#include <common>', '#include <beginnormal_vertex>', '#include <begin_vertex>'],
  fragment: ['#include <common>', '#include <clipping_planes_fragment>', '#include <map_fragment>', '#include <normal_fragment_maps>', '#include <opaque_fragment>', '#include <fog_fragment>', '#include <dithering_fragment>'],
};

const after = (s: string, chunk: string, code: string) => s.replace(chunk, `${chunk}\n${code}`);

/** The ring program into one shader; answers whether it went in (every anchor there, or nothing written). */
export function injectRing(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> }, u: RingUniforms, ground: GroundTileUniforms): boolean {
  const vs = shader.vertexShader;
  const fs = shader.fragmentShader;
  if (RING_ANCHORS.vertex.some((a) => !vs.includes(a)) || RING_ANCHORS.fragment.some((a) => !fs.includes(a))) return false;
  shader.vertexShader = after(vs, '#include <common>', VERTEX_PARS).replace('#include <beginnormal_vertex>', HORIZON_RING_VERTEX).replace('#include <begin_vertex>', 'vec3 transformed = gRingPos;');
  let f = after(fs, '#include <common>', FRAGMENT_PARS);
  f = after(f, '#include <clipping_planes_fragment>', FRAGMENT_TOP);
  f = after(f, '#include <map_fragment>', FRAGMENT_MAP);
  f = f.replace('#include <opaque_fragment>', `${FRAGMENT_CLOUDS}\n#include <opaque_fragment>`);
  f = after(f, '#include <fog_fragment>', FRAGMENT_FADE);
  f = after(f, '#include <dithering_fragment>', FRAGMENT_VIEW);
  shader.fragmentShader = f;
  injectWetness(shader as never, 'object');
  // The baked normal lands after the weather's stage at the same anchor, so the weather reads the ring's own lean.
  shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`);
  Object.assign(shader.uniforms, u);
  // The tile program's own uniform objects, by reference: the mirror, the cloud tile, its clock and the bumps' strength move both.
  shader.uniforms.uGroundFrame = ground.uGroundFrame;
  shader.uniforms.uGround = ground.uGround;
  shader.uniforms.uGroundBump = ground.uGroundBump;
  shader.uniforms.uGroundClouds = ground.uGroundClouds;
  shader.uniforms.uGroundCloud = ground.uGroundCloud;
  shader.uniforms.uGroundShine = ground.uGroundShine;
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
