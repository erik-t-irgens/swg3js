// Ground textures of a converted planet, and the programs that draw them.
//
// **Two programs, by what the pack carries.** A pack the terrain command wrote at terrain shaders version 4
// carries every alternate of every family, the client's three border masks and its cloud tile, and is drawn
// the client's way (materials and ground pass, wave 5): each 4 m tile its corners' families, the lowest drawn
// whole and the rest laid over it through the client's masks, each layer the alternate its pole chose, the
// colour map's tint over all of it, and optionally the client's cloud shadows. The chunk builder gives every
// triangle its tile's layers, mask codes and its own place in the tile (`groundTiles.ts` says what), so the
// program depends on nothing a world has more or less of, and one program serves every planet: the material
// is made once for the session and a world only hands it its own textures, which is why a travel builds no
// ground program. A pack from before, or `localStorage['swg.ground.tiles'] = '0'`, keeps the program the game
// has always drawn: one texture a family, three families blended across each triangle by its corners'
// weights (aFamily and aBary), not a line of its text changed (`groundShader.test.ts` holds it so).

import * as THREE from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';
import type { AssetPack } from './assetPack';
import { injectWetness } from './wetness.ts';
import { GGX_ANCHOR } from './specular.ts';
import { childIndexOf, type ShaderGroup } from '../swg/terrain/generator.ts';
import { COLOUR_MODES, cornerOrder, GROUND_DRAW_TUNE, maskCode, tilesFit, type GroundTiler } from './groundTiles.ts';
import { CLOUD_GREY, CLOUD_METRES, CLOUD_PERIOD, LUMA, bumpNormal, cloudShade, cloudUv, composeTile, flatShine, srgbDecode, tintGamma, type MaskSample, type TintReference } from './groundMath.ts';
import { lighterTone } from './volumetrics/airMath.ts';

/** `toneColour`'s scratch: the lighter tones' means and how many samples were taken. */
const TONE_SCRATCH = { r: 0.5, g: 0.5, b: 0.5, n: 0 };

/** One child of a family, as terrain shaders version 4 writes it. */
export interface ShaderChildDef {
  shader: string;
  weight: number;
  texture?: string;
  file: string | null;
  normal: string | null;
  specular: string | null;
  specularColor: [number, number, number] | null;
}

/** One entry of terrain/shaders.json written by the converter. */
export interface ShaderFamilyDef {
  id: number;
  name: string;
  /** Metres per texture repeat. */
  size: number;
  /** Pack-relative PNG. */
  file: string;
  /**
   * The family's own bump map, pack-relative, or null where the archives have none for it.
   *
   * Absent (rather than null) means a pack converted before these were read: the ground is then
   * lit exactly as it always was, and `status` asks for the world again.
   */
  normal?: string | null;
  /**
   * The family's own gloss map, pack-relative, or null. The client's AUX0 slot, whose files are all
   * named `*_spec` and whose effect is `dot3_terrain_specmap`: the ground's shine.
   *
   * A file of its own rather than the bump map's alpha, because a browser drawing an image into a
   * 2D canvas premultiplies and a pixel with no gloss would come back with its normal wiped out.
   * The two are read into one texture at load all the same.
   */
  specular?: string | null;
  /** The client's shader and its main texture, as the converter read them: what `emptyGround` asks. */
  shader?: string;
  texture?: string;
  /**
   * From terrain shaders version 4 (`tools/swg/terrainShaders.mjs`): the family's place in the terrain's
   * family list (the priority a border is ordered by), every child in that list's order with its weight
   * and its own three pictures, and which child the fields above carry (`primary`, the heaviest: what the
   * ground drew before alternates were written). Each child's gloss carries the bump map's height in
   * green. The MATL's specular colour is black on the families that take no shine.
   */
  priority?: number;
  primary?: number;
  specularColor?: [number, number, number] | null;
  children?: ShaderChildDef[];
}

/** The whole of terrain/shaders.json. */
interface ShadersFile {
  version?: number;
  families: ShaderFamilyDef[];
  blend?: { quarter?: string | null; half?: string | null; threequarter?: string | null } | null;
  clouds?: string | null;
}

/**
 * Whether a terrain's ground is one the client never drew: every shader family it paints with is a
 * punch-out of the client's empty texture (`null_a_punchout` over `texture/null.dds`). The instances
 * zone is the one that does it -- its copies hang in a sky over flat ground at nought that nothing was
 * meant to see, and drawn, that ground ran straight through the corvettes' main deck. The ground is then
 * kept (it is still a floor to the physics and a height to everything that asks for one) and not drawn.
 * A pack converted before the converter wrote the shader's name says nothing and draws as it always did.
 */
export function emptyGround(families: readonly Pick<ShaderFamilyDef, 'shader' | 'texture'>[]): boolean {
  if (!families.length) return false;
  return families.every((f) => typeof f.texture === 'string' && /(^|\/)null\.dds$/i.test(f.texture) && typeof f.shader === 'string' && /punchout/i.test(f.shader));
}

/**
 * The marker the ground's own declarations end with, and the one place anything may be injected
 * after them.
 *
 * Three separate injections write into this shader at `#include <common>` -- the ground's own
 * textures, the weather's, and the bumps below -- and each of them inserts at the **first** match,
 * so the last to run lands **first** in the file. That put `uniform sampler2DArray uGroundNormal;`
 * above `precision highp sampler2DArray;` and `groundSlope()` above every uniform and varying it
 * reads, which is not a subtle error: the program fails to compile and the ground is not drawn at
 * all. A marker of its own makes the order of the calls stop mattering.
 */
export const GROUND_DECLS_END = '// <ground-declarations-end>';

/**
 * The version-3 ground's own textures: every triangle's three families' pictures blended by its corners'
 * weights. Exactly the text the ground has always been drawn with; `groundShader.test.ts` holds it to a copy
 * taken before the tile program came, so a pack from before draws what it always drew.
 */
export function injectGroundFamilies(shader: { fragmentShader: string; vertexShader: string; uniforms: Record<string, unknown>; defines?: Record<string, unknown> }, count: number, texture: THREE.Texture | null, layerOf: Float32Array, sizeOf: Float32Array): void {
  shader.defines = { ...(shader.defines ?? {}), TERRAIN_FAMILIES: count };
  shader.uniforms.uGround = { value: texture };
  shader.uniforms.uGroundLayer = { value: layerOf };
  shader.uniforms.uGroundSize = { value: sizeOf };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aFamily;\nattribute vec3 aBary;\nvarying vec3 vFamily;\nvarying vec3 vBary;\nvarying vec2 vGroundXZ;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFamily = aFamily;\nvBary = aBary;\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uGround;\nuniform float uGroundLayer[TERRAIN_FAMILIES];\nuniform float uGroundSize[TERRAIN_FAMILIES];\nvarying vec3 vFamily;\nvarying vec3 vBary;\nvarying vec2 vGroundXZ;\nvec4 groundSample(float family) {\n  int id = clamp(int(family + 0.5), 0, TERRAIN_FAMILIES - 1);\n  return texture(uGround, vec3(vGroundXZ / uGroundSize[id], uGroundLayer[id]));\n}\n${GROUND_DECLS_END}`)
    .replace('#include <map_fragment>', '#include <map_fragment>\n{\n  vec3 w = vBary / max(vBary.x + vBary.y + vBary.z, 1e-4);\n  vec4 g = groundSample(vFamily.x) * w.x + groundSample(vFamily.y) * w.y + groundSample(vFamily.z) * w.z;\n  diffuseColor.rgb *= g.rgb;\n}');
}

/**
 * The ground's own bumps, folded into the normal the lighting uses.
 *
 * Its declarations go after `GROUND_DECLS_END`, so they always follow the ground's own; its work
 * goes at `#include <normal_fragment_maps>`, which `injectWetness` has already written to, so this
 * block lands **before** the wetness one and a puddle's surface is laid over the ground's relief
 * rather than wiped out by it.
 *
 * Three things about the arithmetic. The ground's texture coordinate is world XZ, so the tangent is
 * world +X and the bitangent world +Z by construction -- no tangent frame is built and none should
 * be, which is also why three's own normal-map path cannot be used here (the ground carries no `uv`
 * attribute at all). Slopes are **added** rather than normals blended, which is exact when every
 * frame is the same one and is what the water already does for its two layers. And the green channel
 * is read as it stands, the way this project settled the question for every other surface.
 */
export function injectGroundNormal(shader: { fragmentShader: string; uniforms: Record<string, { value: unknown }> }, normals: THREE.DataArrayTexture | null, scale: { value: number }, gloss: { value: number } = { value: GROUND_NORMAL.gloss }): boolean {
  // A stage that is not there is left alone rather than written to: a use with no declaration does
  // not draw the ground wrongly, it does not draw the ground.
  if (!shader.fragmentShader.includes(GROUND_DECLS_END) || !shader.fragmentShader.includes('#include <normal_fragment_maps>') || !shader.fragmentShader.includes('#include <roughnessmap_fragment>')) return false;
  if (normals) shader.uniforms.uGroundNormal = { value: normals };
  shader.uniforms.uGroundNormalScale = scale;
  shader.uniforms.uGroundGloss = gloss;
  shader.fragmentShader = shader.fragmentShader
    .replace(
      GROUND_DECLS_END,
      `uniform sampler2DArray uGroundNormal;
uniform float uGroundNormalScale;
uniform float uGroundGloss;
// A family's bump and gloss at this point: the direction in rgb, the client's own specular mask in
// alpha, which the loader read out of a file of its own and put here.
vec4 groundBump(float family) {
  int id = clamp(int(family + 0.5), 0, TERRAIN_FAMILIES - 1);
  return texture(uGroundNormal, vec3(vGroundXZ / uGroundSize[id], uGroundLayer[id]));
}
// The height gradient a family's bump map asks for: a tangent-space normal (x, y, z) with z up
// gives the gradient -xy/z, and the tangent frame here is world X and world Z.
vec2 groundSlope(float family) {
  vec3 n = groundBump(family).xyz * 2.0 - 1.0;
  return -n.xy / max(n.z, 0.2);
}
${GROUND_DECLS_END}`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
{
  vec3 gw = vBary / max(vBary.x + vBary.y + vBary.z, 1e-4);
  vec2 gs = (groundSlope(vFamily.x) * gw.x + groundSlope(vFamily.y) * gw.y + groundSlope(vFamily.z) * gw.z) * uGroundNormalScale;
  // The ground's own lean, as a gradient, so the two add rather than one replacing the other: the
  // view matrix is orthonormal, so its transpose is its inverse and nothing new is uploaded.
  vec3 gN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec2 gg = vec2(-gN.x, -gN.z) / max(gN.y, 0.2);
  normal = normalize((viewMatrix * vec4(normalize(vec3(-(gg.x + gs.x), 1.0, -(gg.y + gs.y))), 0.0)).xyz);
}`,
    )
    // Before the weather's own roughness, which is written at the same stage and must have the last
    // word: wet stone is smoother than dry stone however glossy the dry stone was.
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
{
  vec3 gw = vBary / max(vBary.x + vBary.y + vBary.z, 1e-4);
  float gloss = groundBump(vFamily.x).a * gw.x + groundBump(vFamily.y).a * gw.y + groundBump(vFamily.z).a * gw.z;
  roughnessFactor = clamp(roughnessFactor - gloss * uGroundGloss, 0.08, 1.0);
}`,
    );
  return true;
}

// ---------------------------------------------------------------- the tile program (terrain shaders version 4)

/** Every uniform the tile program reads: one set the session's ground material holds, another a self test makes. */
export interface GroundTileUniforms {
  /** The colour of every child, a layer each, and their bump maps layer for layer (rgb, the gloss in alpha). */
  uGround: THREE.IUniform<THREE.Texture>;
  uGroundBump: THREE.IUniform<THREE.Texture>;
  /** The client's three masks, quarter, half and three-quarter, one channel each. */
  uGroundMask: THREE.IUniform<THREE.Texture>;
  /** The client's cloud tile, its alpha as grey. */
  uGroundClouds: THREE.IUniform<THREE.Texture>;
  /** x, z: the layout centre (terrain = centre x less game x, game z plus centre z); z: the pictures' way round (+1 the client's). */
  uGroundFrame: THREE.IUniform<THREE.Vector4>;
  /** x: the colour mode (`COLOUR_MODES`), y: the gain cap. */
  uGroundTint: THREE.IUniform<THREE.Vector4>;
  /** The world's brightness reference: each channel's median and the luminance's. */
  uGroundTintRef: THREE.IUniform<THREE.Vector4>;
  /**
   * x: opposite corners added (1) or the stronger (0), y: the masks painted (1) or stepped (0), z: what is drawn (0 the
   * lit ground, 1 its colour, 2 its colour under the clouds, 3 the lean its bump gives as a colour and its gloss as the alpha).
   */
  uGroundLook: THREE.IUniform<THREE.Vector4>;
  /** x: how much the gloss lowers the roughness (the highlight), y: the flat shine's strength, z: the bumps' strength. */
  uGroundShine: THREE.IUniform<THREE.Vector4>;
  /** x: the cloud shadows on, y: their strength, z: their clock in seconds, wrapped to a period. */
  uGroundCloud: THREE.IUniform<THREE.Vector4>;
}

/** A small array of one colour, so a uniform the program reads always holds a real texture (an empty one binds nothing). */
function placeholderArray(rgba: [number, number, number, number], depth = 1, format: THREE.PixelFormat = THREE.RGBAFormat): THREE.DataArrayTexture {
  const channels = format === THREE.RedFormat ? 1 : 4;
  const data = new Uint8Array(channels * depth);
  for (let i = 0; i < depth; i++) for (let c = 0; c < channels; c++) data[i * channels + c] = rgba[c];
  const t = new THREE.DataArrayTexture(data, 1, 1, depth);
  t.format = format;
  t.needsUpdate = true;
  return t;
}

/** A fresh set of the tile program's uniforms, holding stand-ins until a world hands it its textures. */
export function makeGroundTileUniforms(): GroundTileUniforms {
  const clouds = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  clouds.needsUpdate = true;
  const u: GroundTileUniforms = {
    uGround: { value: placeholderArray([255, 255, 255, 255]) },
    uGroundBump: { value: placeholderArray([128, 128, 255, 0]) },
    uGroundMask: { value: placeholderArray([0, 0, 0, 0], 3, THREE.RedFormat) },
    uGroundClouds: { value: clouds },
    uGroundFrame: { value: new THREE.Vector4(0, 0, 1, 0) },
    uGroundTint: { value: new THREE.Vector4() },
    uGroundTintRef: { value: new THREE.Vector4(1, 1, 1, 1) },
    uGroundLook: { value: new THREE.Vector4() },
    uGroundShine: { value: new THREE.Vector4() },
    uGroundCloud: { value: new THREE.Vector4() },
  };
  writeGroundDraw(u);
  return u;
}

/** The stand-ins a set starts with, so a world that goes can hand them back rather than leave its freed textures bound. */
const standIns = new WeakMap<GroundTileUniforms, Pick<GroundTileUniforms, 'uGround' | 'uGroundBump' | 'uGroundMask' | 'uGroundClouds'>>();

/** The uniforms the session's one ground material reads; the knobs write here and nothing compiles. */
let sessionUniforms: GroundTileUniforms | null = null;
export function groundTileUniforms(): GroundTileUniforms {
  if (!sessionUniforms) {
    sessionUniforms = makeGroundTileUniforms();
    standIns.set(sessionUniforms, { uGround: { value: sessionUniforms.uGround.value }, uGroundBump: { value: sessionUniforms.uGroundBump.value }, uGroundMask: { value: sessionUniforms.uGroundMask.value }, uGroundClouds: { value: sessionUniforms.uGroundClouds.value } });
  }
  return sessionUniforms;
}

/** Write the knobs of `GROUND_DRAW_TUNE` (and the bumps' and gloss's strengths) into a set of uniforms. */
export function writeGroundDraw(u: GroundTileUniforms = groundTileUniforms()): void {
  const t = GROUND_DRAW_TUNE;
  u.uGroundFrame.value.z = t.mirror ? 1 : -1;
  u.uGroundTint.value.set(Math.max(0, COLOUR_MODES.indexOf(t.colour)), t.gainCap, 0, 0);
  u.uGroundLook.value.x = t.opposite === 'add' ? 1 : 0;
  u.uGroundLook.value.y = t.masks ? 1 : 0;
  u.uGroundShine.value.set(t.shine === 'highlight' ? GROUND_NORMAL.gloss : 0, t.shine === 'flat' ? t.flat : 0, GROUND_NORMAL.scale, 0);
  u.uGroundCloud.value.x = t.clouds.on ? 1 : 0;
  u.uGroundCloud.value.y = t.clouds.strength;
}

/** The cloud tile's clock, a period wrapped (`CLOUD_PERIOD`), written once a frame: nothing allocated. */
export function setGroundClock(seconds: number, u: GroundTileUniforms = groundTileUniforms()): void {
  u.uGroundCloud.value.z = ((seconds % CLOUD_PERIOD) + CLOUD_PERIOD) % CLOUD_PERIOD;
}

const glslFloat = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

/**
 * The colour map's tint in the client's gamma, the tile program's own function (`groundMath.tintGamma` is its mirror),
 * reading `uGroundTint` and `uGroundTintRef`, which whoever interpolates it declares. Exported (from the volumetrics'
 * wave 2b) so the dust pass takes its ground's tint by these very lines and never a copy; interpolated back into
 * `TILE_VERTEX_PARS` at the very place it stood, so the tile program's text and key are what they were to the byte.
 */
export const GROUND_TINT_GLSL = `vec3 groundTintOf( const in vec3 c ) {
	if ( uGroundTint.x < 0.5 ) return vec3( 1.0 );
	if ( uGroundTint.x < 1.5 ) return c;
	if ( uGroundTint.x < 2.5 ) {
		float lum = dot( c, vec3( ${glslFloat(LUMA[0])}, ${glslFloat(LUMA[1])}, ${glslFloat(LUMA[2])} ) );
		return c * min( 1.0 / max( uGroundTintRef.a, 1e-3 ), uGroundTint.y / max( lum, 1e-6 ) );
	}
	return min( c / max( uGroundTintRef.rgb, vec3( 1e-3 ) ), vec3( uGroundTint.y ) );
}`;

/**
 * sRGB's decode, the tile program's own function (`groundMath.srgbDecode` is its mirror), exported and interpolated back
 * into `TILE_FRAGMENT_PARS` at its place for the same reason as `GROUND_TINT_GLSL`.
 */
export const GROUND_DECODE_GLSL = `vec3 groundDecode( const in vec3 c ) {
	vec3 lo = c * ( 1.0 / 12.92 );
	vec3 hi = pow( ( max( c, vec3( 0.0 ) ) + 0.055 ) * ( 1.0 / 1.055 ), vec3( 2.4 ) );
	return mix( hi, lo, vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) );
}`;

/** Vertex: the tile attributes and what is worked out from them, after `#include <common>`. */
const TILE_VERTEX_PARS = /* glsl */ `
// The ground drawn the client's way (src/world/terrainTextures.ts, groundTiles.ts): each triangle's tile.
attribute vec4 aGroundLayers;
attribute vec4 aGroundBlend;
attribute vec3 aGroundTint;
uniform vec4 uGroundFrame;
uniform vec4 uGroundTint;
uniform vec4 uGroundTintRef;
flat varying vec4 vGroundLayers;
flat varying vec4 vGroundBlend;
varying vec2 vGroundTile;
varying vec2 vGroundUV;
varying vec3 vGroundTint;
// The colour map's tint in the client's gamma (groundMath.tintGamma): off, the client's, normalised, per channel.
${GROUND_TINT_GLSL}
`;

/** Vertex, after `#include <worldpos_vertex>`: the terrain-space picture coordinate (one repeat a 4 m tile) and the tile's data. */
const TILE_VERTEX = /* glsl */ `
{
	vec4 gWorld = modelMatrix * vec4( transformed, 1.0 );
	vec2 gTerrain = vec2( uGroundFrame.x - gWorld.x, gWorld.z + uGroundFrame.y );
	vGroundUV = vec2( uGroundFrame.z * gTerrain.x, gTerrain.y ) * 0.25;
	vGroundLayers = aGroundLayers;
	vGroundBlend = aGroundBlend;
	float gCode = floor( aGroundBlend.w + 0.5 );
	float gS = floor( ( gCode + 0.5 ) / 3.0 );
	vGroundTile = vec2( gS, gCode - 3.0 * gS ) * 0.5;
	vGroundTint = groundTintOf( aGroundTint );
}
`;

/** Fragment: the samplers, the knobs, the tile's data and the functions, after `#include <common>`. */
const TILE_FRAGMENT_PARS = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uGround;
uniform sampler2DArray uGroundBump;
uniform sampler2DArray uGroundMask;
uniform sampler2D uGroundClouds;
uniform vec4 uGroundFrame;
uniform vec4 uGroundLook;
uniform vec4 uGroundShine;
uniform vec4 uGroundCloud;
flat varying vec4 vGroundLayers;
flat varying vec4 vGroundBlend;
varying vec2 vGroundTile;
varying vec2 vGroundUV;
varying vec3 vGroundTint;
// Worked out in main() at the colour stage and read later: the overlays' weights, the blended bump and
// gloss, the colour before the light, the flat shine the lights add (RE_Direct_Physical cannot see main()),
// and the ground's lean in the world's frame before the rain's rings (for the self test's view of it).
vec3 gGroundW = vec3( 0.0 );
vec4 gGroundBump = vec4( 0.5, 0.5, 1.0, 0.0 );
vec3 gGroundAlbedo = vec3( 1.0 );
float gGroundFlat = 0.0;
vec3 gGroundNormalW = vec3( 0.0, 1.0, 0.0 );
// A tile place turned onto a mask's own frame a quarter turn at a time (groundTiles.turnTile), and a
// derivative turned with it.
vec2 groundTurn( const in vec2 st, const in int k ) {
	if ( k == 1 ) return vec2( st.y, 1.0 - st.x );
	if ( k == 2 ) return vec2( 1.0 - st.x, 1.0 - st.y );
	if ( k == 3 ) return vec2( 1.0 - st.y, st.x );
	return st;
}
vec2 groundTurnDir( const in vec2 d, const in int k ) {
	if ( k == 1 ) return vec2( d.y, -d.x );
	if ( k == 2 ) return -d;
	if ( k == 3 ) return vec2( -d.y, d.x );
	return d;
}
float groundMaskTap( const in float kind, const in int k, const in vec2 dx, const in vec2 dy ) {
	return textureGrad( uGroundMask, vec3( groundTurn( vGroundTile, k ), kind ), groundTurnDir( dx, k ), groundTurnDir( dy, k ) ).r;
}
// An overlay's weight from its code (groundMath.maskWeight): one plus four times the kind plus the turn.
float groundMask( const in float code, const in vec2 dx, const in vec2 dy ) {
	int c = int( code + 0.5 ) - 1;
	if ( c < 0 ) return 0.0;
	int kind = c / 4;
	int k = c - kind * 4;
	float m;
	if ( kind == 3 ) {
		float a = groundMaskTap( 0.0, k, dx, dy );
		float b = groundMaskTap( 0.0, k + 2, dx, dy );
		m = uGroundLook.x > 0.5 ? min( a + b, 1.0 ) : max( a, b );
	} else {
		m = groundMaskTap( float( kind ), k, dx, dy );
	}
	return uGroundLook.y > 0.5 ? m : step( 0.5, m );
}
// sRGB's own curve each way (groundMath.srgbDecode, srgbEncode); the decode runs on past one.
${GROUND_DECODE_GLSL}
vec3 groundEncode( const in vec3 c ) {
	vec3 lo = c * 12.92;
	vec3 hi = 1.055 * pow( max( c, vec3( 1e-6 ) ), vec3( 1.0 / 2.4 ) ) - 0.055;
	return mix( hi, lo, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
}
// The client's cloud layer over a lit colour (groundMath.cloudShade): grey ${glslFloat(CLOUD_GREY)} in its gamma at the tile's
// alpha squared, never brightening.
vec3 groundCloudShade( const in vec3 lit ) {
	vec2 uv = vGroundUV * ( 4.0 / ${glslFloat(CLOUD_METRES)} ) + uGroundCloud.z * ( 1.0 / ${glslFloat(CLOUD_PERIOD)} ) * vec2( 1.0, -1.0 );
	float a = texture( uGroundClouds, uv ).r;
	float k = clamp( a * a * uGroundCloud.y, 0.0, 1.0 );
	vec3 g = groundEncode( clamp( lit, 0.0, 1.0 ) );
	vec3 shaded = groundDecode( mix( g, vec3( ${glslFloat(CLOUD_GREY)} ), k ) );
	return min( vec3( 1.0 ), shaded / max( groundDecode( g ), vec3( 1e-5 ) ) );
}
`;

/**
 * Fragment, after `#include <map_fragment>`: the tile's colour and its bump, the bottom layer and each overlay
 * by its mask in turn. Derivatives are taken once at the top, where every pixel of the quad runs, and handed to
 * every sample, so the branches on how many layers a tile holds (most hold one) never ask a texture for a
 * derivative inside them. Exported (from the volumetrics' wave 2b) so the air's variant can hold itself to finding this
 * text in its program unchanged.
 */
export const TILE_MAP = /* glsl */ `
{
	vec2 gDx = dFdx( vGroundUV );
	vec2 gDy = dFdy( vGroundUV );
	vec2 gTx = dFdx( vGroundTile );
	vec2 gTy = dFdy( vGroundTile );
	vec4 gColour = textureGrad( uGround, vec3( vGroundUV, vGroundLayers.x ), gDx, gDy );
	gGroundBump = textureGrad( uGroundBump, vec3( vGroundUV, vGroundLayers.x ), gDx, gDy );
	if ( vGroundBlend.x > 0.5 ) {
		gGroundW.x = groundMask( vGroundBlend.x, gTx, gTy );
		gColour = mix( gColour, textureGrad( uGround, vec3( vGroundUV, vGroundLayers.y ), gDx, gDy ), gGroundW.x );
		gGroundBump = mix( gGroundBump, textureGrad( uGroundBump, vec3( vGroundUV, vGroundLayers.y ), gDx, gDy ), gGroundW.x );
		if ( vGroundBlend.y > 0.5 ) {
			gGroundW.y = groundMask( vGroundBlend.y, gTx, gTy );
			gColour = mix( gColour, textureGrad( uGround, vec3( vGroundUV, vGroundLayers.z ), gDx, gDy ), gGroundW.y );
			gGroundBump = mix( gGroundBump, textureGrad( uGroundBump, vec3( vGroundUV, vGroundLayers.z ), gDx, gDy ), gGroundW.y );
			if ( vGroundBlend.z > 0.5 ) {
				gGroundW.z = groundMask( vGroundBlend.z, gTx, gTy );
				gColour = mix( gColour, textureGrad( uGround, vec3( vGroundUV, vGroundLayers.w ), gDx, gDy ), gGroundW.z );
				gGroundBump = mix( gGroundBump, textureGrad( uGroundBump, vec3( vGroundUV, vGroundLayers.w ), gDx, gDy ), gGroundW.z );
			}
		}
	}
	gGroundAlbedo = gColour.rgb * groundDecode( vGroundTint );
	diffuseColor.rgb *= gGroundAlbedo;
}
`;

/** Fragment, after `#include <roughnessmap_fragment>` and before the weather's own: the gloss as a highlight, or kept for the flat shine. */
const TILE_ROUGHNESS = /* glsl */ `
roughnessFactor = clamp( roughnessFactor - gGroundBump.a * uGroundShine.x, 0.08, 1.0 );
gGroundFlat = gGroundBump.a * uGroundShine.y;
`;

/**
 * Fragment, after `#include <normal_fragment_maps>` and before the rain's rings: the blended bump's slope added
 * to the ground's own lean, as the version-3 ground adds it. A slope toward the picture's right runs toward the
 * world's -x when the pictures are the client's way round, so its sign follows the frame's.
 */
const TILE_NORMAL = /* glsl */ `
{
	vec3 gn = gGroundBump.xyz * 2.0 - 1.0;
	vec2 gs = -gn.xy / max( gn.z, 0.2 ) * uGroundShine.z;
	gs.x *= -uGroundFrame.z;
	vec3 gN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
	vec2 gg = vec2( -gN.x, -gN.z ) / max( gN.y, 0.2 );
	gGroundNormalW = normalize( vec3( -( gg.x + gs.x ), 1.0, -( gg.y + gs.y ) ) );
	normal = normalize( ( viewMatrix * vec4( gGroundNormalW, 0.0 ) ).xyz );
}
`;

/** Fragment, before `#include <opaque_fragment>`: the client's cloud shadows over the lit ground, when on (a uniform). */
const TILE_CLOUDS = /* glsl */ `
if ( uGroundCloud.x > 0.5 ) outgoingLight *= groundCloudShade( outgoingLight );
`;

/** Fragment, after `#include <dithering_fragment>`: the colour alone, or the bump's lean and gloss, for the self test and the console (a uniform). */
const TILE_VIEW = /* glsl */ `
if ( uGroundLook.z > 0.5 ) gl_FragColor = uGroundLook.z > 2.5 ? vec4( gGroundNormalW * 0.5 + 0.5, gGroundBump.a ) : vec4( uGroundLook.z > 1.5 ? gGroundAlbedo * groundCloudShade( gGroundAlbedo ) : gGroundAlbedo, 1.0 );
`;

/** The flat shine each direct light adds, after three's own highlight in `RE_Direct_Physical`. */
export const TILE_FLAT_LINE = 'reflectedLight.directSpecular += directLight.color * ( gGroundFlat * RECIPROCAL_PI );';

const after = (source: string, chunk: string, code: string): string => {
  const at = source.indexOf(chunk);
  if (at < 0) return source;
  const end = at + chunk.length;
  return `${source.slice(0, end)}\n${code}${source.slice(end)}`;
};
const before = (source: string, chunk: string, code: string): string => {
  const at = source.indexOf(chunk);
  if (at < 0) return source;
  return `${source.slice(0, at)}${code}\n${source.slice(at)}`;
};

/** Every anchor the tile program writes at, vertex and fragment: all of them or nothing. */
export const TILE_ANCHORS = {
  vertex: ['#include <common>', '#include <worldpos_vertex>'],
  fragment: ['#include <common>', '#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <normal_fragment_maps>', '#include <lights_physical_pars_fragment>', '#include <opaque_fragment>', '#include <dithering_fragment>', '#include <color_fragment>', '#include <lights_fragment_end>'],
};

/**
 * The tile program, into one shader with one set of uniforms: the tile's own stages, then the weather's ground
 * (wet look, puddles, rain rings, snow), then the bump and gloss, whose text then lands before the weather's at
 * the same stages so the weather has the last word. Answers whether it went in: every anchor must be there or
 * nothing is written, and the flat shine's line must find three's highlight line to follow (`GGX_ANCHOR`).
 */
export function injectGroundTiles(shader: { fragmentShader: string; vertexShader: string; uniforms: Record<string, unknown> }, u: GroundTileUniforms, chunk: string = THREE.ShaderChunk.lights_physical_pars_fragment): boolean {
  const vs = shader.vertexShader;
  const fs = shader.fragmentShader;
  if (TILE_ANCHORS.vertex.some((a) => !vs.includes(a)) || TILE_ANCHORS.fragment.some((a) => !fs.includes(a))) return false;
  const ggx = chunk.indexOf(GGX_ANCHOR);
  if (ggx < 0) return false;
  const pars = `${chunk.slice(0, ggx + GGX_ANCHOR.length)}\n\t${TILE_FLAT_LINE}${chunk.slice(ggx + GGX_ANCHOR.length)}`;
  shader.vertexShader = after(after(vs, '#include <common>', TILE_VERTEX_PARS), '#include <worldpos_vertex>', TILE_VERTEX);
  let f = after(fs, '#include <common>', `${TILE_FRAGMENT_PARS}${GROUND_DECLS_END}`);
  f = after(f, '#include <map_fragment>', TILE_MAP);
  f = f.replace('#include <lights_physical_pars_fragment>', pars);
  f = before(f, '#include <opaque_fragment>', TILE_CLOUDS);
  f = after(f, '#include <dithering_fragment>', TILE_VIEW);
  shader.fragmentShader = f;
  injectWetness(shader as never, 'ground');
  shader.fragmentShader = after(after(shader.fragmentShader, '#include <normal_fragment_maps>', TILE_NORMAL), '#include <roughnessmap_fragment>', TILE_ROUGHNESS);
  Object.assign(shader.uniforms, u);
  return true;
}

/** The tile program's key: one text for every planet, so every planet shares one program. */
export const GROUND_TILES_KEY = 'swg-ground-tiles-wet';

/**
 * A ground material drawn by the tile program from one set of uniforms. The world makes one for the session
 * (`World.groundTilesMaterial`) and never disposes it, so a travel builds no ground program; the cascades patch
 * it first, as every lit material, and the program follows.
 */
export function groundTilesMaterial(u: GroundTileUniforms, csm: CSM | null): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  csm?.setupMaterial(mat);
  const previous = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    previous.call(mat, shader, renderer);
    if (!injectGroundTiles(shader, u)) console.warn('the ground shader has no place for its tiles; the ground is drawn without its pictures');
  };
  // The ground carries its own wet injection; the material scan must not wrap it again.
  mat.userData.wetBuiltIn = true;
  mat.customProgramCacheKey = () => GROUND_TILES_KEY;
  return mat;
}

const LAYER_SIZE = 512;
/**
 * Metres per texture repeat. The client gives every ground tile texture coordinates of
 * 0.25 x tile width per tile, whatever the family's shader size says, which works out to one
 * repeat every 4 m at every detail level (ClientProceduralTerrainAppearance_ClientChunk).
 */
const GROUND_REPEAT = 4;
/** Largest family id the uniform lookup arrays cover; ids are dense per planet, well under this. */
const MAX_FAMILY_ID = 127;

/**
 * How strongly the ground's own bumps lean the light. Ours, and live through `__debug.normals`.
 *
 * The client shaded this terrain per pixel with these maps and this game did not, which is why the
 * ground has been the flattest thing in it: the geometry normal is a smoothed difference of the
 * heightfield, so below the terrain's own step there was no variation at all.
 */
export const GROUND_NORMAL = {
  scale: 1,
  /**
   * How much of the client's own gloss mask is taken off the ground's roughness. Ours.
   *
   * The masks are low -- 0 to about 90 of 255 on most families -- so at 1 the shiniest ground goes
   * from fully matt to roughness 0.65, which is damp stone rather than a mirror.
   */
  gloss: 1,
};

/** A switch in this browser's storage, read once where it is asked (a page that refuses storage reads none). */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Whether the owner has turned the ground's relief off by hand, which needs no build. */
function groundBumpOff(): boolean {
  return stored('swg.ground.bump') === '0';
}

/**
 * Whether the ground is drawn the client's way when the pack carries what that needs: `localStorage['swg.ground.tiles']
 * = '0'` keeps the program the ground was drawn with before (the way back if the tile program will not compile), and
 * `swg.ground.children = '1'` loads only each family's first child (the client's `shaderGroupUseFirstChildOnly`).
 */
export const GROUND_TILES_WANTED: boolean = stored('swg.ground.tiles') !== '0';
export const GROUND_FIRST_CHILD_ONLY: boolean = stored('swg.ground.children') === '1';

/** The tile set of a version-4 pack: what the tile program draws from, beside the arrays the class holds. */
interface TileSet {
  masks: THREE.DataArrayTexture;
  clouds: THREE.Texture | null;
  /** Every planet family's children, child index to array layer. */
  childLayers: Map<number, number[]>;
  /** Every planet family's place in the family list, by name out of the pack, else after them in the terrain's own order. */
  priority: Map<number, number>;
  /** How many children each pack family brought pictures for, by name. */
  childCounts: Map<string, number>;
  firstOnly: boolean;
  reference: TintReference | null;
  bytes: { colour: number; bump: number; masks: number; clouds: number };
  tiler: LiveTiler;
}

export class TerrainTextures {
  readonly texture: THREE.DataArrayTexture;
  /** The same families' bump maps, layer for layer, or null for a pack converted before they were read. */
  readonly normals: THREE.DataArrayTexture | null;
  /** The live strength, written by the Graphics setting; the ground has no `normalMap` for the usual path to find. */
  private normalScale: { value: number } = { value: GROUND_NORMAL.scale };
  /** The live gloss, the same way: a uniform the material already holds, so nothing recompiles. */
  private glossScale: { value: number } = { value: GROUND_NORMAL.gloss };
  /** Family id → layer index; families without a texture use layer 0. */
  private readonly layerOf: Float32Array;
  private readonly sizeOf: Float32Array;
  readonly families: ShaderFamilyDef[];
  /** The ground is the client's empty punch-out and is not drawn (`emptyGround`). */
  empty = false;
  private material: THREE.MeshStandardMaterial | null = null;
  /** The client's way (version 4): every child, the masks, the cloud tile and the tiler the chunks are built by; null on the version-3 path. */
  tiles: TileSet | null = null;

  private readonly layerIndex: Map<number, number>;
  private readonly averages = new Map<number, THREE.Color>();

  private constructor(texture: THREE.DataArrayTexture, families: ShaderFamilyDef[], layers: Map<number, number>, planet: Map<number, string>, normals: THREE.DataArrayTexture | null = null) {
    this.texture = texture;
    this.normals = normals;
    this.families = families;
    this.layerIndex = layers;
    // Ids on the ground are the planet's (plus any a building's layer file added); the pack lists
    // textures by family name, so match by name first and by id when the name is unknown.
    const byName = new Map<string, number>();
    for (const f of families) {
      const layer = layers.get(f.id);
      if (layer !== undefined) byName.set(f.name.toLowerCase(), layer);
    }
    // The lookup arrays are shader uniforms, and every element costs a uniform slot, so they
    // are sized by the planet's own (small, dense) ids. Families a pack lists under other ids
    // (those a building's layer file added) reach the ground by name only.
    const ids = planet.size ? [...planet.keys()] : families.map((f) => f.id);
    const maxId = Math.min(MAX_FAMILY_ID, Math.max(0, ...ids));
    this.layerOf = new Float32Array(maxId + 1);
    this.sizeOf = new Float32Array(maxId + 1).fill(GROUND_REPEAT);
    for (const f of families) {
      const layer = layers.get(f.id);
      if (layer !== undefined && f.id <= maxId) this.layerOf[f.id] = layer;
    }
    const untextured: string[] = [];
    for (const [id, name] of planet) {
      const layer = byName.get(name.toLowerCase());
      if (layer !== undefined && id <= maxId) this.layerOf[id] = layer;
      else if (id <= maxId) untextured.push(`${id} ${name}`);
    }
    console.info(`ground textures: ${layers.size} loaded for ${planet.size || families.length} families${untextured.length ? `; without a texture (drawn with the first): ${untextured.join(', ')}` : ''}`);
  }

  /**
   * Load the pack's ground textures, or null when it has none. A pack at terrain shaders version 4 with its
   * masks is loaded for the tile program (every child, unless `swg.ground.children` says the first only),
   * unless `swg.ground.tiles` keeps the program of before or the terrain's tiles are not the 4 m ones the
   * program is built for (`tilesFit`); anything else exactly as it always was.
   */
  static async load(pack: AssetPack, anisotropy: number, planet: Map<number, string>, ground?: { shaderGroup: ShaderGroup; reference: TintReference | null; tileWidth: number; renderer?: THREE.WebGLRenderer | null }): Promise<TerrainTextures | null> {
    const bytes = await pack.bytes('terrain/shaders.json');
    if (!bytes) return null;
    let file: ShadersFile;
    try {
      file = JSON.parse(new TextDecoder().decode(bytes)) as ShadersFile;
    } catch {
      return null;
    }
    const empty = emptyGround(file.families);
    const blend = file.blend;
    const tiled = (file.version ?? 0) >= 4 && !!blend?.quarter && !!blend.half && !!blend.threequarter && file.families.some((f) => f.children?.length);
    if (GROUND_TILES_WANTED && ground && tiled && !tilesFit(ground.tileWidth)) console.info(`terrain: this terrain's tiles are ${ground.tileWidth} m, not the 4 m the ground's tile program is built for; drawing it the way it was drawn before`);
    else if (GROUND_TILES_WANTED && ground && tiled) {
      const tiled = await TerrainTextures.loadTiles(pack, anisotropy, planet, file, ground);
      if (tiled) {
        tiled.empty = empty;
        return tiled;
      }
      console.warn('terrain: the ground\'s tiles could not be loaded; drawing it the way it was drawn before');
    }
    let families = file.families;
    families = families.filter((f) => f.file);
    if (!families.length) return null;
    const images = await Promise.all(families.map((f) => loadImage(pack.url(f.file))));
    const kept = families.filter((_, i) => images[i]);
    if (!kept.length) return null;
    const size = Math.min(LAYER_SIZE, Math.max(...images.filter(Boolean).map((im) => Math.max(im!.width, im!.height))));
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const data = new Uint8Array(size * size * 4 * kept.length);
    const layers = new Map<number, number>();
    kept.forEach((f, layer) => {
      const im = images[families.indexOf(f)]!;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(im, 0, 0, size, size);
      data.set(ctx.getImageData(0, 0, size, size).data, layer * size * size * 4);
      layers.set(f.id, layer);
    });
    const texture = new THREE.DataArrayTexture(data, size, size, kept.length);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = anisotropy;
    texture.needsUpdate = true;
    // The bump maps, as a second array of exactly the same shape, so the two share one layer
    // lookup: a family with no map of its own gets a flat layer rather than a missing one, which
    // keeps the indices identical and costs one layer of three bytes repeated.
    let normals: THREE.DataArrayTexture | null = null;
    // A way back to the flat, matt ground without a build, for the same reason the wetness wrap has
    // one: everything the relief and the gloss add is inside one shader program, and a program that
    // will not compile draws no ground at all. `localStorage['swg.ground.bump'] = '0'` and reload.
    if (kept.some((f) => f.normal || f.specular) && !groundBumpOff()) {
      const nImages = await Promise.all(kept.map((f) => (f.normal ? loadImage(pack.url(f.normal)) : Promise.resolve(null))));
      const sImages = await Promise.all(kept.map((f) => (f.specular ? loadImage(pack.url(f.specular)) : Promise.resolve(null))));
      const nData = new Uint8Array(size * size * 4 * kept.length);
      // Flat and matt everywhere first: (128, 128, 255) is straight up, and nought in the alpha is
      // no gloss at all, so a family with neither map is exactly the ground as it was.
      for (let i = 0; i < nData.length; i += 4) {
        nData[i] = 128;
        nData[i + 1] = 128;
        nData[i + 2] = 255;
        nData[i + 3] = 0;
      }
      kept.forEach((f, layer) => {
        const at = layer * size * size * 4;
        const im = nImages[layer];
        if (im) {
          ctx.clearRect(0, 0, size, size);
          ctx.drawImage(im, 0, 0, size, size);
          const px = ctx.getImageData(0, 0, size, size).data;
          // Only the direction: the alpha of that PNG is the converter's own opaque filler, and the
          // gloss is a file of its own because a 2D canvas cannot carry both.
          for (let i = 0; i < px.length; i += 4) {
            nData[at + i] = px[i];
            nData[at + i + 1] = px[i + 1];
            nData[at + i + 2] = px[i + 2];
          }
        }
        const sm = sImages[layer];
        if (sm) {
          ctx.clearRect(0, 0, size, size);
          ctx.drawImage(sm, 0, 0, size, size);
          const px = ctx.getImageData(0, 0, size, size).data;
          for (let i = 0; i < px.length; i += 4) nData[at + i + 3] = px[i];
        }
      });
      normals = new THREE.DataArrayTexture(nData, size, size, kept.length);
      // No colour space on a normal map: its bytes are a direction, not a colour.
      normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
      normals.minFilter = THREE.LinearMipmapLinearFilter;
      normals.magFilter = THREE.LinearFilter;
      normals.generateMipmaps = true;
      normals.anisotropy = anisotropy;
      normals.needsUpdate = true;
    }
    const out = new TerrainTextures(texture, kept, layers, planet, normals);
    out.empty = empty;
    return out;
  }

  /**
   * A version-4 pack for the tile program: every child's colour, bump and gloss into two arrays layer for
   * layer (`assembleTileArrays`), the three masks into a third and the cloud tile into a texture of its own,
   * every picture decoded off this thread (`createImageBitmap`) and all of them at once, behind the loading
   * screen. Each picture is read at its own size: the masks and the cloud tile are not the colours' size on
   * every pack (the copies' world has 4 px colours and 256 px masks).
   */
  private static async loadTiles(pack: AssetPack, anisotropy: number, planet: Map<number, string>, file: ShadersFile, ground: { shaderGroup: ShaderGroup; reference: TintReference | null; renderer?: THREE.WebGLRenderer | null }): Promise<TerrainTextures | null> {
    const firstOnly = GROUND_FIRST_CHILD_ONLY;
    const bumps = !groundBumpOff();
    const families = file.families.filter((f) => f.children?.length);
    const entries = tileEntries(families, firstOnly);
    if (!entries.length) return null;
    const blend = file.blend!;
    const [colours, normalImgs, glossImgs, maskImgs, cloudImg] = await Promise.all([
      Promise.all(entries.map((e) => decodeImage(pack.url(e.def.file!)))),
      Promise.all(entries.map((e) => (bumps && e.def.normal ? decodeImage(pack.url(e.def.normal)) : Promise.resolve(null)))),
      Promise.all(entries.map((e) => (bumps && e.def.specular ? decodeImage(pack.url(e.def.specular)) : Promise.resolve(null)))),
      Promise.all([blend.quarter!, blend.half!, blend.threequarter!].map((m) => decodeImage(pack.url(m)))),
      file.clouds ? decodeImage(pack.url(file.clouds)) : Promise.resolve(null),
    ]);
    const close = () => {
      for (const list of [colours, normalImgs, glossImgs, maskImgs]) for (const im of list) closeImage(im);
      closeImage(cloudImg);
    };
    try {
      if (maskImgs.some((m) => !m)) return null;
      const kept = colours.map((c) => !!c);
      if (!kept.some(Boolean)) return null;
      const size = Math.min(LAYER_SIZE, Math.max(...colours.filter(Boolean).map((im) => Math.max(im!.width, im!.height))));
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      // A picture drawn whole at `w` by `w`: the canvas is sized to it first, or a picture larger than the last
      // one read would be cut to the canvas and read back as nought past it.
      const read = (im: DecodedImage, w = size): Uint8ClampedArray => {
        if (canvas.width !== w || canvas.height !== w) {
          canvas.width = w;
          canvas.height = w;
        }
        ctx.clearRect(0, 0, w, w);
        ctx.drawImage(im, 0, 0, w, w);
        return ctx.getImageData(0, 0, w, w).data;
      };
      const arrays = assembleTileArrays(families, entries, kept, size, {
        colour: (i) => read(colours[i]!),
        normal: (i) => (normalImgs[i] ? read(normalImgs[i]!) : null),
        gloss: (i) => (glossImgs[i] ? read(glossImgs[i]!) : null),
      });
      if (!arrays) return null;
      const n = arrays.depth;
      const texture = arrayTexture(arrays.colour, size, n, anisotropy, true);
      const normals = arrayTexture(arrays.bump, size, n, anisotropy, false);
      // The masks: one channel each, clamped at the tile's edge, mipmapped for the far ground.
      const ms = maskImgs[0]!.width;
      const maskData = new Uint8Array(ms * ms * 3);
      maskImgs.forEach((im, k) => {
        const px = read(im!, ms);
        for (let p = 0, q = k * ms * ms; p < px.length; p += 4, q++) maskData[q] = px[p];
      });
      const masks = new THREE.DataArrayTexture(maskData, ms, ms, 3);
      masks.format = THREE.RedFormat;
      masks.wrapS = masks.wrapT = THREE.ClampToEdgeWrapping;
      masks.minFilter = THREE.LinearMipmapLinearFilter;
      masks.magFilter = THREE.LinearFilter;
      masks.generateMipmaps = true;
      masks.needsUpdate = true;
      let clouds: THREE.Texture | null = null;
      if (cloudImg) {
        const cs = cloudImg.width;
        const px = read(cloudImg, cs);
        const cd = new Uint8Array(cs * cs * 4);
        cd.set(px);
        const t = new THREE.DataTexture(cd, cs, cs, THREE.RGBAFormat);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = true;
        t.needsUpdate = true;
        clouds = t;
      }
      const out = new TerrainTextures(texture, families, arrays.firstLayer, planet, normals);
      const { childLayers, priority } = tileLookups(planet, families, arrays.childLayersByName);
      const mip = 4 / 3;
      const per = size * size * 4;
      const bytes = { colour: Math.round(per * n * mip), bump: Math.round(per * n * mip), masks: Math.round(ms * ms * 3 * mip), clouds: cloudImg ? Math.round(cloudImg.width * cloudImg.width * 4 * mip) : 0 };
      out.tiles = { masks, clouds, childLayers, priority, childCounts: arrays.childCounts, firstOnly, reference: ground.reference, bytes, tiler: makeTiler(childLayers, priority, ground.shaderGroup, firstOnly) };
      // Uploaded now, behind the loading screen, rather than on the first frame that draws a chunk.
      const r = ground.renderer;
      if (r) for (const t of [texture, normals, masks, clouds]) if (t) r.initTexture(t);
      return out;
    } finally {
      close();
    }
  }

  /**
   * The ground material: a standard lit material whose base colour comes from the blended family
   * textures. Cascaded shadows patch the same material, so their hook runs first and ours after. The tile
   * program's material is the session's (`groundTilesMaterial`), handed in by the world; this one is the
   * version-3 path's own.
   */
  groundMaterial(csm: CSM | null): THREE.MeshStandardMaterial {
    if (this.material) return this.material;
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    csm?.setupMaterial(mat);
    const previous = mat.onBeforeCompile;
    const count = this.layerOf.length;
    const texture = this.texture;
    const normals = this.normals;
    const layerOf = this.layerOf;
    const sizeOf = this.sizeOf;
    const normalScale = this.normalScale;
    const glossScale = this.glossScale;
    mat.onBeforeCompile = (shader, renderer) => {
      previous.call(mat, shader, renderer);
      injectGroundFamilies(shader, count, texture, layerOf, sizeOf);
      // Rain, puddles and snow: after the blend (map_fragment), so wetness darkens the blended
      // colour. Compiled in once and driven by the weather's shared uniforms.
      injectWetness(shader, 'ground');
      if (normals && !injectGroundNormal(shader, normals, normalScale, glossScale)) console.warn('the ground shader has no place for its bump and gloss maps; the ground is lit flat and matt');
    };
    // The ground carries its own wet injection; the material scan must not wrap it again.
    mat.userData.wetBuiltIn = true;
    mat.customProgramCacheKey = () => `swg-ground-wet-${count}-${normals ? 'bump' : 'flat'}`;
    this.material = mat;
    return mat;
  }

  /**
   * Hand the tile program this world's textures and frame: the session's uniforms then draw this world's
   * ground, and nothing is compiled. `centerX`, `centerZ` are the layout centre.
   */
  bindTiles(centerX: number, centerZ: number, u: GroundTileUniforms = groundTileUniforms()): void {
    const t = this.tiles;
    if (!t) return;
    u.uGround.value = this.texture;
    u.uGroundBump.value = this.normals ?? u.uGroundBump.value;
    u.uGroundMask.value = t.masks;
    const stand = standIns.get(u);
    u.uGroundClouds.value = t.clouds ?? stand?.uGroundClouds.value ?? u.uGroundClouds.value;
    u.uGroundFrame.value.x = centerX;
    u.uGroundFrame.value.y = centerZ;
    const ref = t.reference;
    u.uGroundTintRef.value.set(ref?.rgb[0] ?? 1, ref?.rgb[1] ?? 1, ref?.rgb[2] ?? 1, ref?.luminance ?? 1);
    writeGroundDraw(u);
  }

  /**
   * How strongly the ground's bumps lean the light, live. Answers whether there were any to move.
   *
   * It is a uniform the material already holds, so nothing is recompiled and nothing is rebuilt.
   */
  setNormalScale(x: number): boolean {
    this.normalScale.value = x;
    GROUND_NORMAL.scale = x;
    if (this.tiles) writeGroundDraw();
    return !!this.normals;
  }

  /** How much of the client's gloss mask the ground wears, live. Answers whether there was one. */
  setGloss(x: number): boolean {
    this.glossScale.value = x;
    GROUND_NORMAL.gloss = x;
    if (this.tiles) writeGroundDraw();
    return !!this.normals;
  }

  /** How many families brought a bump map and how many a gloss map, for the console. */
  get mapCounts(): { bumped: number; glossy: number; of: number } {
    return { bumped: this.families.filter((f) => f.normal).length, glossy: this.families.filter((f) => f.specular).length, of: this.families.length };
  }

  /** What the ground's pictures hold on the card, megabytes with their mip chains: the colour, the bumps, and (tiles) the masks and the cloud tile. */
  get gpuMegabytes(): { colour: number; bump: number; masks: number; clouds: number; total: number } {
    const mb = (b: number) => Number((b / (1024 * 1024)).toFixed(1));
    const img = this.texture.image as { width: number; height: number; depth: number };
    const per = Math.round(img.width * img.height * 4 * img.depth * (4 / 3));
    const b = this.tiles?.bytes ?? { colour: per, bump: this.normals ? per : 0, masks: 0, clouds: 0 };
    return { colour: mb(b.colour), bump: mb(b.bump), masks: mb(b.masks), clouds: mb(b.clouds), total: mb(b.colour + b.bump + b.masks + b.clouds) };
  }

  /** The mean colour of a family's texture (its layer's pixels, sampled sparsely), for dust and spray; null without one. */
  averageColor(familyId: number): THREE.Color | null {
    const layer = this.layerIndex.get(familyId);
    if (layer === undefined) return null;
    let c = this.averages.get(familyId);
    if (c) return c;
    const img = this.texture.image as { data: Uint8Array; width: number; height: number };
    const per = img.width * img.height * 4;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = layer * per; i < (layer + 1) * per; i += 4 * 37) {
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      n++;
    }
    c = new THREE.Color(r / n / 255, g / n / 255, b / n / 255).convertSRGBToLinear();
    this.averages.set(familyId, c);
    return c;
  }

  /**
   * The lighter tones of a family's texture (the volumetrics' wave 2b, the design's §2.14), linear, into `out`: the
   * same sparse walk as `averageColor`, a luminance histogram of it, and the mean of the samples above the cut that
   * leaves out the darkest `tone` of them (`lighterTone`, `airMath.ts`), so the dust takes the part of the ground the sun
   * lights rather than the gaps between its grains. At `tone` 0 it is `averageColor`'s colour to the bit. Null without a
   * picture. Kept nowhere: the world works it out when it builds its tables and again when the owner's dial moves.
   */
  toneColour(familyId: number, tone: number, out: THREE.Color): THREE.Color | null {
    const layer = this.layerIndex.get(familyId);
    if (layer === undefined) return null;
    const img = this.texture.image as { data: Uint8Array; width: number; height: number };
    const per = img.width * img.height * 4;
    const m = TONE_SCRATCH;
    lighterTone(img.data, layer * per, (layer + 1) * per, 4 * 37, tone, m);
    if (!(m.n > 0)) return null;
    return out.setRGB(m.r, m.g, m.b).convertSRGBToLinear();
  }

  dispose(): void {
    // The session's tile uniforms let go of this world's textures for the stand-ins, so nothing freed stays bound.
    const u = sessionUniforms;
    const stand = u ? standIns.get(u) : undefined;
    if (u && stand) {
      if (u.uGround.value === this.texture) u.uGround.value = stand.uGround.value;
      if (u.uGroundBump.value === this.normals) u.uGroundBump.value = stand.uGroundBump.value;
      if (this.tiles && u.uGroundMask.value === this.tiles.masks) u.uGroundMask.value = stand.uGroundMask.value;
      if (this.tiles?.clouds && u.uGroundClouds.value === this.tiles.clouds) u.uGroundClouds.value = stand.uGroundClouds.value;
    }
    this.texture.dispose();
    this.normals?.dispose();
    this.tiles?.masks.dispose();
    this.tiles?.clouds?.dispose();
    this.material?.dispose();
  }
}

// ---------------------------------------------------------------- what a version-4 pack's pictures become
//
// Pure, so `groundLayers.test.ts` runs the very code the loader does over a pack's own pictures in node: the
// loader only decodes and reads each picture through a canvas and hands the bytes in.

/** One picture a version-4 pack's ground loads: a child of a family, a layer of the arrays. */
export interface TileEntry {
  family: ShaderFamilyDef;
  child: number;
  def: ShaderChildDef;
}

/**
 * The pictures in order: every family's children that have one, a layer each, the first only when asked (and
 * a first child the archives gave no picture for has its family's heaviest stand in, as the version-3 fields do).
 */
export function tileEntries(families: readonly ShaderFamilyDef[], firstOnly: boolean): TileEntry[] {
  const entries: TileEntry[] = [];
  for (const f of families) {
    const kids = f.children;
    if (!kids?.length) continue;
    for (let k = 0; k < kids.length; k++) {
      if (firstOnly && k > 0) break;
      if (kids[k].file) entries.push({ family: f, child: k, def: kids[k] });
    }
    if (firstOnly && !kids[0]?.file && f.file) entries.push({ family: f, child: 0, def: { ...kids[0], file: f.file, normal: f.normal ?? null, specular: f.specular ?? null, specularColor: f.specularColor ?? null } });
  }
  return entries;
}

/**
 * Whether a child takes the client's shine at all: not when its shader's MATL specular colour (its own, else its
 * family's) is black, the client's own reading of "no shine", whatever its gloss picture holds.
 */
export function glossTaken(child: Pick<ShaderChildDef, 'specularColor'>, family: Pick<ShaderFamilyDef, 'specularColor'>): boolean {
  const c = child.specularColor ?? family.specularColor;
  return !(c && c.every((v) => v === 0));
}

/** Each entry's pictures as RGBA bytes at the arrays' size, asked for once each and in order; null where it has none. */
export interface TilePictures {
  colour(i: number): ArrayLike<number>;
  normal(i: number): ArrayLike<number> | null;
  gloss(i: number): ArrayLike<number> | null;
}

/** What the arrays hold. */
export interface TileArrays {
  /** Every kept picture's colour, a layer each, and its bump (rgb) with its gloss (alpha) layer for layer. */
  colour: Uint8Array;
  bump: Uint8Array;
  depth: number;
  /** Every pack family's children, child index to layer, by lower-case name: a child with no picture draws its family's heaviest, else its first that has one. */
  childLayersByName: Map<string, number[]>;
  /** How many children each pack family brought pictures for, by name. */
  childCounts: Map<string, number>;
  /** Each pack family's first child's layer, by its id: what the dust's average colour reads. */
  firstLayer: Map<number, number>;
}

/**
 * Every kept entry's colour into a layer of one array and its bump and gloss into the same layer of another: the
 * bump's direction in rgb (flat, 128 128 255, where a child has none), the gloss picture's red (the AUX0 mask) in
 * alpha, and nought there where the child takes no shine (`glossTaken`). `kept[i]` says whether entry i's colour
 * decoded; one that did not is no layer.
 */
export function assembleTileArrays(families: readonly ShaderFamilyDef[], entries: readonly TileEntry[], kept: readonly boolean[], size: number, pictures: TilePictures): TileArrays | null {
  const keptAt: number[] = [];
  entries.forEach((_, i) => {
    if (kept[i]) keptAt.push(i);
  });
  if (!keptAt.length) return null;
  const n = keptAt.length;
  const per = size * size * 4;
  const colour = new Uint8Array(per * n);
  const bump = new Uint8Array(per * n);
  // Flat and matt everywhere first: a child with neither map is the ground as it was without them.
  for (let i = 0; i < bump.length; i += 4) {
    bump[i] = 128;
    bump[i + 1] = 128;
    bump[i + 2] = 255;
  }
  const firstLayer = new Map<number, number>();
  const childLayersByName = new Map<string, number[]>();
  const childCounts = new Map<string, number>();
  keptAt.forEach((i, layer) => {
    const e = entries[i];
    const at = layer * per;
    colour.set(pictures.colour(i) as ArrayLike<number>, at);
    const nm = pictures.normal(i);
    if (nm) {
      for (let p = 0; p < per; p += 4) {
        bump[at + p] = nm[p];
        bump[at + p + 1] = nm[p + 1];
        bump[at + p + 2] = nm[p + 2];
      }
    }
    if (glossTaken(e.def, e.family)) {
      const sm = pictures.gloss(i);
      if (sm) for (let p = 0; p < per; p += 4) bump[at + p + 3] = sm[p];
    }
    const key = e.family.name.toLowerCase();
    let list = childLayersByName.get(key);
    if (!list) childLayersByName.set(key, (list = []));
    list[e.child] = layer;
    childCounts.set(key, (childCounts.get(key) ?? 0) + 1);
    if (e.child === 0 || !firstLayer.has(e.family.id)) firstLayer.set(e.family.id, layer);
  });
  for (const f of families) {
    const list = childLayersByName.get(f.name.toLowerCase());
    if (!list) continue;
    const fallback = list[f.primary ?? 0] ?? list.find((v) => v !== undefined) ?? 0;
    for (let k = 0; k < (f.children?.length ?? 1); k++) if (list[k] === undefined) list[k] = fallback;
    firstLayer.set(f.id, list[0]);
  }
  return { colour, bump, depth: n, childLayersByName, childCounts, firstLayer };
}

/**
 * The planet's own families, by their ids, matched to the pack's by name as the version-3 path matches them:
 * each one's children's layers, and its rank at a border, its place in the pack's family list (`priority`, else
 * where the pack lists it). A family the pack does not list (one a building's layer file added) goes above every
 * listed one, in the planet's own order.
 */
export function tileLookups(planet: ReadonlyMap<number, string>, families: readonly ShaderFamilyDef[], childLayersByName: ReadonlyMap<string, number[]>): { childLayers: Map<number, number[]>; priority: Map<number, number> } {
  const childLayers = new Map<number, number[]>();
  const priority = new Map<number, number>();
  const packPriority = new Map(families.map((f, i) => [f.name.toLowerCase(), f.priority ?? i] as const));
  let unlisted = 0;
  for (const [id, name] of planet) {
    const list = childLayersByName.get(name.toLowerCase());
    if (list) childLayers.set(id, list);
    const p = packPriority.get(name.toLowerCase());
    priority.set(id, p ?? 10000 + unlisted++);
  }
  return { childLayers, priority };
}

/** The tiler a version-4 world's chunks are built by, with what the console reads off it and what a rebuild asks of it. */
export type LiveTiler = GroundTiler & { refresh(): void; readonly census: Float64Array };

/**
 * The tiler a version-4 world's chunks are built by: a family's rank (its place in the list, the other end
 * first under `order: 'last'`), the layer its alternate draws (the child its choice byte picks, or the first
 * under `children: false`) and the corners asked for that choice. `refresh` reads the knobs again before a rebuild.
 */
export function makeTiler(childLayers: ReadonlyMap<number, number[]>, priority: ReadonlyMap<number, number>, group: ShaderGroup, firstOnly: boolean): LiveTiler {
  let sign = GROUND_DRAW_TUNE.order === 'last' ? -1 : 1;
  let children = GROUND_DRAW_TUNE.children && !firstOnly;
  const corners: number[] = cornerOrder(GROUND_DRAW_TUNE.childCorner);
  return {
    census: new Float64Array(5),
    get corners() {
      return corners;
    },
    rank: (family) => sign * (priority.get(family) ?? 20000 + family),
    layer: (family, choice) => {
      const list = childLayers.get(family);
      if (!list) return 0;
      const k = children ? childIndexOf(group.families.get(family), choice) : 0;
      return list[k] ?? list[0] ?? 0;
    },
    refresh() {
      sign = GROUND_DRAW_TUNE.order === 'last' ? -1 : 1;
      children = GROUND_DRAW_TUNE.children && !firstOnly;
      const next = cornerOrder(GROUND_DRAW_TUNE.childCorner);
      for (let i = 0; i < 4; i++) corners[i] = next[i];
      this.census.fill(0);
    },
  };
}

/** A colour or bump array as the tile program samples it. */
function arrayTexture(data: Uint8Array, size: number, depth: number, anisotropy: number, colour: boolean): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(data, size, size, depth);
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

type DecodedImage = ImageBitmap | HTMLImageElement;

/** A picture decoded off this thread where the browser can, else through an image element; null when it will not load. */
async function decodeImage(url: string): Promise<DecodedImage | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch {
      return null;
    }
  }
  return loadImage(url);
}

function closeImage(im: DecodedImage | null): void {
  if (im && 'close' in im) im.close();
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = url;
  });
}

// ---------------------------------------------------------------- the self test

export interface GroundSelfTest {
  ok: boolean;
  /** Every run drawn, with the worst pixel against `groundMath`, in linear colour (half floats). */
  runs: { name: string; pixels: number; maxError: number }[];
  /** Whether the bright tiles' tint really meets the gain cap, normalised and per channel: without it the cap goes untested. */
  capBinds: boolean;
  /** Programs built while the knobs moved between runs, after each scene's first draw: must be 0. */
  builtOnKnobs: number;
  note: string;
}

/**
 * Draw a strip of tiles off-screen with the tile program and hold every pixel to `groundMath.ts`, the way
 * `gradeSelfTest` holds the grade: every mask code (each corner, side and three corners, the two opposite
 * pairs), a three- and a four-layer tile and a lone family, with masks of two by two texels (so a pixel's
 * bilinear sample is worked out here exactly), colours of solid layers and one striped along the picture's
 * own x, and bumps a layer each leaning their own ways with their own gloss. Read back: the colour under the
 * four tint modes (every other tile so bright that the gain cap binds in both modes that have one), both ways
 * round, both opposite rules and the hard step; the colour under a cloud tile that varies in both directions,
 * at a clock several periods on, both ways round (its place and its drift); the lean the blended bump gives
 * and its gloss, both ways round; and the flat shine under one light, the difference between its strength at
 * one and at nought. The program's own views (`uGroundLook.z`) are what is read, except for the shine. It
 * builds two programs of its own (a scene with no lights and one with a light are two keys), which a console
 * call may; moving the knobs after each scene's first draw builds none.
 */
export function groundSelfTest(renderer: THREE.WebGLRenderer): GroundSelfTest {
  const u = makeGroundTileUniforms();
  // Layers: 0 striped along u (red at the left half of the picture, blue at the right), then solid colours.
  const solids: [number, number, number][] = [
    [200, 40, 30],
    [30, 180, 60],
    [40, 60, 210],
    [230, 220, 40],
    [150, 90, 200],
  ];
  const layerCount = solids.length + 1;
  const colourData = new Uint8Array(2 * 2 * 4 * layerCount);
  const put = (layer: number, x: number, y: number, c: [number, number, number]) => {
    const o = (layer * 4 + y * 2 + x) * 4;
    colourData[o] = c[0];
    colourData[o + 1] = c[1];
    colourData[o + 2] = c[2];
    colourData[o + 3] = 255;
  };
  for (let y = 0; y < 2; y++) {
    put(0, 0, y, [220, 30, 30]);
    put(0, 1, y, [30, 30, 220]);
  }
  solids.forEach((c, i) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) put(i + 1, x, y, c);
  });
  const colour = new THREE.DataArrayTexture(colourData, 2, 2, layerCount);
  colour.colorSpace = THREE.SRGBColorSpace;
  colour.wrapS = colour.wrapT = THREE.RepeatWrapping;
  colour.minFilter = colour.magFilter = THREE.LinearFilter;
  colour.generateMipmaps = false;
  colour.needsUpdate = true;
  // Bumps, a layer each, solid: every one leaning its own way (the picture's x and y both), with its own gloss.
  const bumps: [number, number, number, number][] = [
    [170, 128, 230, 40],
    [96, 150, 235, 200],
    [128, 84, 222, 120],
    [150, 176, 214, 0],
    [128, 128, 255, 255],
    [108, 112, 244, 80],
  ];
  const bumpData = new Uint8Array(2 * 2 * 4 * layerCount);
  bumps.forEach((b, layer) => {
    for (let t = 0; t < 4; t++) bumpData.set(b, (layer * 4 + t) * 4);
  });
  const bump = new THREE.DataArrayTexture(bumpData, 2, 2, layerCount);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.minFilter = bump.magFilter = THREE.LinearFilter;
  bump.generateMipmaps = false;
  bump.needsUpdate = true;
  // Masks of two by two, as the converter's are laid out: the quarter covers the top-left texel, the half the
  // left column, the three-quarter all but the bottom-right.
  const maskTexels = [
    [255, 0, 0, 0],
    [255, 0, 255, 0],
    [255, 255, 255, 0],
  ];
  const maskData = new Uint8Array(4 * 3);
  maskTexels.forEach((m, k) => maskData.set(m, k * 4));
  const masks = new THREE.DataArrayTexture(maskData, 2, 2, 3);
  masks.format = THREE.RedFormat;
  masks.wrapS = masks.wrapT = THREE.ClampToEdgeWrapping;
  masks.minFilter = masks.magFilter = THREE.LinearFilter;
  masks.generateMipmaps = false;
  masks.needsUpdate = true;
  // The cloud tile: sixteen by sixteen, a smooth wave along each way, so where it lies and which way it drifts
  // both show in the pixels. Its grey is in its red, as the converter writes it.
  const CS = 16;
  const cloudTexel = (x: number, y: number) => Math.round(128 + 100 * Math.sin((2 * Math.PI * (x + 0.5)) / CS) * Math.cos((4 * Math.PI * (y + 0.5)) / CS));
  const cloudData = new Uint8Array(CS * CS * 4);
  for (let y = 0; y < CS; y++) {
    for (let x = 0; x < CS; x++) {
      const a = cloudTexel(x, y);
      cloudData.set([a, a, a, 255], (y * CS + x) * 4);
    }
  }
  const clouds = new THREE.DataTexture(cloudData, CS, CS, THREE.RGBAFormat);
  clouds.wrapS = clouds.wrapT = THREE.RepeatWrapping;
  clouds.minFilter = clouds.magFilter = THREE.LinearFilter;
  clouds.generateMipmaps = false;
  clouds.needsUpdate = true;
  // The set's own stand-ins go as the test's textures take their places.
  for (const t of [u.uGround.value, u.uGroundBump.value, u.uGroundMask.value, u.uGroundClouds.value]) t.dispose();
  u.uGround.value = colour;
  u.uGroundBump.value = bump;
  u.uGroundMask.value = masks;
  u.uGroundClouds.value = clouds;
  // The frame: centre nought, so terrain x is minus game x and terrain z is game z.
  u.uGroundFrame.value.set(0, 0, 1, 0);
  const reference: TintReference = { rgb: [0.62, 0.55, 0.5], luminance: 0.56 };
  u.uGroundTintRef.value.set(reference.rgb[0], reference.rgb[1], reference.rgb[2], reference.luminance);
  // The clock several periods on, through the very writer the world uses, so its wrap is drawn too.
  const clock = 37.5 + 3 * CLOUD_PERIOD;
  setGroundClock(clock, u);
  const cap = 1.6;

  // The cases, a tile each: the layers bottom first and the overlays' codes.
  const cases: { layers: number[]; codes: number[] }[] = [];
  for (let bits = 1; bits < 15; bits++) cases.push({ layers: [0, 1 + (bits % 5), 0, 0], codes: [maskCode(bits), 0, 0] });
  cases.push({ layers: [1, 2, 3, 3], codes: [maskCode(2 | 8), maskCode(4), 0] });
  cases.push({ layers: [2, 3, 4, 5], codes: [maskCode(2), maskCode(4), maskCode(8)] });
  cases.push({ layers: [0, 0, 0, 0], codes: [0, 0, 0] });
  // The colour map's bytes, as a vertex carries them (the mirror reads the very bytes, not the numbers they round):
  // an ordinary pole on even tiles and one so bright on odd ones that the gain cap binds in both modes that have one.
  const tintBytes: [number, number, number][] = [
    [179, 140, 107],
    [250, 245, 235],
  ];
  const tints = tintBytes.map((c) => c.map((b) => b / 255) as [number, number, number]);
  const bright = tints[1];
  const capBinds = cap / (bright[0] * LUMA[0] + bright[1] * LUMA[1] + bright[2] * LUMA[2]) < 1 / reference.luminance && bright.some((c, i) => c / reference.rgb[i] > cap);
  const tiles = cases.length;
  const tileSize = 4;
  const pxPerTile = 16;
  const W = tiles * pxPerTile;
  const H = pxPerTile;
  // Two triangles a tile, its own data on every vertex, as the chunk builder writes it. Tile i spans game x
  // [4i, 4i + 4], so its terrain-space west edge is game x 4i + 4 (s = 0 there) and its south edge game z 0.
  const vcount = tiles * 6;
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const lay = new Uint8Array(vcount * 4);
  const bl = new Uint8Array(vcount * 4);
  const ti = new Uint8Array(vcount * 3);
  let v = 0;
  cases.forEach((c, i) => {
    const corner = (gx: number, gz: number, s2: number, t2: number) => {
      pos.set([gx, 0, gz], v * 3);
      nor.set([0, 1, 0], v * 3);
      lay.set(c.layers, v * 4);
      bl.set([c.codes[0], c.codes[1], c.codes[2], s2 * 3 + t2], v * 4);
      ti.set(tintBytes[i % 2], v * 3);
      v++;
    };
    const x0 = i * tileSize;
    // Game x0 + 4 is terrain s = 0, game x0 is s = 1 (two halves).
    corner(x0 + 4, 0, 0, 0);
    corner(x0, 0, 2, 0);
    corner(x0 + 4, 4, 0, 2);
    corner(x0, 0, 2, 0);
    corner(x0, 4, 2, 2);
    corner(x0 + 4, 4, 0, 2);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('aGroundLayers', new THREE.BufferAttribute(lay, 4));
  geometry.setAttribute('aGroundBlend', new THREE.BufferAttribute(bl, 4));
  geometry.setAttribute('aGroundTint', new THREE.BufferAttribute(ti, 3, true));
  const material = groundTilesMaterial(u, null);
  material.side = THREE.DoubleSide;
  // Two scenes of the one strip: one with no light for the program's own views, and one lit from straight above
  // by a light of strength pi, under which the flat shine of a gloss g is g exactly.
  const scene = new THREE.Scene();
  const unlitMesh = new THREE.Mesh(geometry, material);
  unlitMesh.frustumCulled = false;
  scene.add(unlitMesh);
  const litScene = new THREE.Scene();
  const litMesh = new THREE.Mesh(geometry, material);
  litMesh.frustumCulled = false;
  litScene.add(litMesh);
  const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
  sun.position.set(0, 10, 0);
  litScene.add(sun);
  // Straight down, screen right along game +x and screen up along game -z.
  const camera = new THREE.OrthographicCamera(0, tiles * tileSize, 0, -tileSize, 0.1, 20);
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, samples: 0 });
  const pixels = new Uint16Array(W * H * 4);
  const lit0 = new Uint16Array(W * H * 4);
  const previous = renderer.getRenderTarget();
  const clearColour = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  const programs = () => renderer.info.programs?.length ?? 0;
  const runs: GroundSelfTest['runs'] = [];
  let builtOnKnobs = 0;
  // The mirror's view of the masks: bilinear over the two by two texels, clamped at the edges, as the sampler is set.
  const texel = (k: number, x: number, y: number) => maskTexels[k][Math.min(1, Math.max(0, y)) * 2 + Math.min(1, Math.max(0, x))] / 255;
  const sample: MaskSample = (kind, uu, vv) => {
    const fx = uu * 2 - 0.5;
    const fy = vv * 2 - 0.5;
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const ax = fx - x;
    const ay = fy - y;
    return (texel(kind, x, y) * (1 - ax) + texel(kind, x + 1, y) * ax) * (1 - ay) + (texel(kind, x, y + 1) * (1 - ax) + texel(kind, x + 1, y + 1) * ax) * ay;
  };
  // And of the cloud tile: bilinear, repeating.
  const wrap = (i: number) => ((i % CS) + CS) % CS;
  const cloudAt = (uv: [number, number]) => {
    const fx = uv[0] * CS - 0.5;
    const fy = uv[1] * CS - 0.5;
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const ax = fx - x;
    const ay = fy - y;
    const c = (i: number, j: number) => cloudTexel(wrap(i), wrap(j)) / 255;
    return (c(x, y) * (1 - ax) + c(x + 1, y) * ax) * (1 - ay) + (c(x, y + 1) * (1 - ax) + c(x + 1, y + 1) * ax) * ay;
  };
  const decodeByte = (b: number) => srgbDecode(b / 255);
  const stripe = (uu: number, out: number[]) => {
    // Layer 0 along u: two texel columns, repeating; bilinear between their centres.
    const f = ((((uu * 2 - 0.5) % 2) + 2) % 2);
    const x = Math.floor(f);
    const a = f - x;
    const c0 = x === 0 ? [220, 30, 30] : [30, 30, 220];
    const c1 = x === 0 ? [30, 30, 220] : [220, 30, 30];
    for (let c = 0; c < 3; c++) out[c] = decodeByte(c0[c]) * (1 - a) + decodeByte(c1[c]) * a;
  };
  const tintOut: [number, number, number] = [0, 0, 0];
  const uv: [number, number] = [0, 0];
  const normalOut: [number, number, number] = [0, 0, 0];
  try {
    renderer.setClearColor(0x000000, 1);
    const drawn = new Set<THREE.Scene>();
    const draw = (sc: THREE.Scene, into: Uint16Array) => {
      const before = programs();
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(sc, camera);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, into);
      if (drawn.has(sc)) builtOnKnobs += programs() - before;
      drawn.add(sc);
    };
    // view: 1 the colour, 2 the colour under the clouds, 3 the bump's lean and gloss, 0 lit (the flat shine).
    type Run = { name: string; mode: number; mirror: number; add: boolean; painted: boolean; view: number };
    const list: Run[] = [
      { name: 'the client\'s masks, normalised tint', mode: 2, mirror: 1, add: false, painted: true, view: 1 },
      { name: 'the pictures the old way round', mode: 2, mirror: -1, add: false, painted: true, view: 1 },
      { name: 'the client\'s own tint', mode: 1, mirror: 1, add: false, painted: true, view: 1 },
      { name: 'the tint per channel', mode: 3, mirror: 1, add: false, painted: true, view: 1 },
      { name: 'no tint, opposite corners added', mode: 0, mirror: 1, add: true, painted: true, view: 1 },
      { name: 'the masks stepped at a half', mode: 0, mirror: 1, add: false, painted: false, view: 1 },
      { name: 'under the cloud layer', mode: 2, mirror: 1, add: false, painted: true, view: 2 },
      { name: 'under the cloud layer, the old way round', mode: 2, mirror: -1, add: false, painted: true, view: 2 },
      { name: 'the bump\'s lean and gloss', mode: 0, mirror: 1, add: false, painted: true, view: 3 },
      { name: 'the bump\'s lean and gloss, the old way round', mode: 0, mirror: -1, add: false, painted: true, view: 3 },
      { name: 'the flat shine under one light', mode: 0, mirror: 1, add: false, painted: true, view: 0 },
    ];
    for (const run of list) {
      u.uGroundTint.value.set(run.mode, cap, 0, 0);
      u.uGroundFrame.value.z = run.mirror;
      u.uGroundLook.value.set(run.add ? 1 : 0, run.painted ? 1 : 0, run.view, 0);
      // The clouds' own switch stays off: they are read through the view, not over the lit ground.
      u.uGroundCloud.value.x = 0;
      u.uGroundCloud.value.y = 1;
      if (run.view === 0) {
        // The flat shine alone: the same lit draw at strength nought and at one, and the difference read.
        u.uGroundShine.value.set(0, 0, 1, 0);
        draw(litScene, lit0);
        u.uGroundShine.value.set(0, 1, 1, 0);
        draw(litScene, pixels);
      } else {
        u.uGroundShine.value.set(0, 0, 1, 0);
        draw(scene, pixels);
      }
      let worst = 0;
      let counted = 0;
      for (let j = 0; j < H; j++) {
        // Row j counts up from the bottom of the picture, which is game z 4.
        const gz = tileSize - ((j + 0.5) / H) * tileSize;
        for (let i = 0; i < W; i++) {
          const gx = ((i + 0.5) / W) * tiles * tileSize;
          const tile = Math.floor(gx / tileSize);
          const inX = gx - tile * tileSize;
          // A pixel's own place, a texel's breadth away from the tile's edge (where a pixel is part of two tiles).
          if (inX < 0.3 || inX > tileSize - 0.3 || gz < 0.3 || gz > tileSize - 0.3) continue;
          const c = cases[tile];
          const s = 1 - inX / tileSize;
          const t = gz / tileSize;
          const terrainX = -gx;
          const uu = (run.mirror * terrainX) / tileSize;
          const at = (j * W + i) * 4;
          const got = (ch: number) => THREE.DataUtils.fromHalfFloat(pixels[at + ch]);
          if (run.view === 3 || run.view === 0) {
            const b = composeTile((k, out) => {
              const L = bumps[c.layers[k]];
              for (let ch = 0; ch < 4; ch++) out[ch] = L[ch] / 255;
            }, c.codes, s, t, sample, run.add, run.painted, [0, 0, 0, 0]);
            if (run.view === 3) {
              bumpNormal(b, run.mirror, 1, normalOut);
              for (let ch = 0; ch < 3; ch++) worst = Math.max(worst, Math.abs(got(ch) - (normalOut[ch] * 0.5 + 0.5)));
              worst = Math.max(worst, Math.abs(got(3) - b[3]));
            } else {
              const want = flatShine(Math.PI, b[3], 1);
              for (let ch = 0; ch < 3; ch++) worst = Math.max(worst, Math.abs(got(ch) - THREE.DataUtils.fromHalfFloat(lit0[at + ch]) - want));
            }
            counted++;
            continue;
          }
          tintGamma(tints[tile % 2], run.mode, reference, cap, tintOut);
          const layer = (k: number, out: number[]) => {
            const L = c.layers[k];
            if (L === 0) stripe(uu, out);
            else for (let ch = 0; ch < 3; ch++) out[ch] = decodeByte(solids[L - 1][ch]);
          };
          const albedo = composeTile(layer, c.codes, s, t, sample, run.add, run.painted, [0, 0, 0]);
          const alpha = run.view === 2 ? cloudAt(cloudUv(terrainX, gz, run.mirror, clock, uv)) : 0;
          for (let ch = 0; ch < 3; ch++) {
            let want = albedo[ch] * srgbDecode(tintOut[ch]);
            if (run.view === 2) want *= cloudShade(want, alpha, 1);
            worst = Math.max(worst, Math.abs(got(ch) - want));
          }
          counted++;
        }
      }
      runs.push({ name: run.name, pixels: counted, maxError: Number(worst.toFixed(4)) });
    }
  } finally {
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clearColour, clearAlpha);
    material.dispose();
    geometry.dispose();
    colour.dispose();
    bump.dispose();
    masks.dispose();
    clouds.dispose();
    sun.dispose();
    rt.dispose();
  }
  const worst = runs.reduce((a, r) => Math.max(a, r.maxError), 0);
  return {
    ok: worst < 0.01 && runs.every((r) => r.pixels > 0) && capBinds && builtOnKnobs === 0,
    runs,
    capBinds,
    builtOnKnobs,
    note: "every pixel a texel's breadth inside its tile, in linear colour: the tile program's own colour, clouds, lean and gloss against groundMath (composeTile, tintGamma, cloudUv and cloudShade, bumpNormal), and the flat shine against flatShine, worst under 0.01; the bright tiles' tint at the gain cap; and no program built as the knobs moved",
  };
}
