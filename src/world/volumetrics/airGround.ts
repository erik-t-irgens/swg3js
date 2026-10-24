// The tile ground's air variant (the design's §2.7 and §9, the second wave): the same program the ground is drawn with
// today (`terrainTextures.ts`'s tile program), with the moving air laid over it -- each layer's picture sampled where
// the drifting sand has carried it (by that layer's own "moves", so a rock layer beside a sand one never slides), the
// dents' depth darkening pressed ground and bending its light, and the dust's shadow taken off the sun.
//
// **All or nothing, and never the plain ground's text.** The variant is a material of its own whose `onBeforeCompile`
// runs the plain injection (`injectGroundTiles`) and then rewrites the text that wrote (`injectGroundAir`): its
// declarations at `GROUND_DECLS_END`, a block after `#include <map_fragment>` (so it lands before the tile program's own
// colour stage), **the eight `textureGrad` coordinates of `TILE_MAP` rewritten** to add each layer's shift, the dent's
// bent normal after `#include <normal_fragment_maps>` (before the tile program's own lean, which then adds the ground's
// lean and bump to it), and the shadow after `#include <lights_fragment_end>`. Every anchor and every one of the eight
// calls must be found exactly, or nothing is written and the variant draws as the plain ground. `terrainTextures.ts`
// is not edited, so the plain material's text and key cannot move (`airOff.test.ts` holds them to the commit before).
//
// **At every art dial nought the variant's pixels are today's by construction** (the design's §4.1 item 5, §4.2 item
// 1): each term that changes a value the art already has is a uniform branch round the whole term, and the layers'
// coordinates are `vGroundUV + shift` with the shift exactly nought there, which the texture lookup reads as `vGroundUV`
// itself. The derivatives stay the undisplaced `vGroundUV`'s, so no mip level moves; the tile masks are never
// displaced; every field read is made finite before it is used; and a pixel outside the window takes nothing, the
// dents nothing outside their square. No vertex moves and no varying is added: the world position is worked back from
// `vGroundUV` and the frame.
//
// It adds four samplers to the tile program's (the offsets, the dents, the per-layer response lookup, the light):
// twelve of sixteen on Direct3D 11.
import * as THREE from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';
import { GROUND_DECLS_END, GROUND_TILES_KEY, groundTilesMaterial, injectGroundTiles, makeGroundTileUniforms, type GroundTileUniforms } from '../terrainTextures.ts';
import { AIR_TUNE } from './airTune.ts';
import { dentDarken, dustShade } from './airMath.ts';

/** The variant's key: the tile program's own and a word, so the two are two programs and the plain one's key never moves. */
export const GROUND_AIR_KEY = `${GROUND_TILES_KEY}-air`;

/** Every uniform the variant reads beside the tile program's: kept objects the field writes in place. */
export interface AirGroundUniforms {
  /** The carried offsets (metres, world x and z in RG), the dents (metres), the per-layer response lookup (layers × 1, RGBA8), the light toward the sun. */
  uAirOffsets: { value: THREE.Texture | null };
  uAirDents: { value: THREE.Texture | null };
  uAirLayers: { value: THREE.Texture | null };
  uAirLight: { value: THREE.Texture | null };
  /** The window: x, z of its corner, its size, its cell. */
  uAirWindow: { value: THREE.Vector4 };
  /** x the drift's dial, y the prints', z the shade's (each nought while its effect is off), w 1 while the field's targets stand. */
  uAirArt: { value: THREE.Vector4 };
  /** The dent square: its corner's x and z, its size, and the metres at its edge a dent fades over. */
  uAirDentP: { value: THREE.Vector4 };
  /** x a dent texel in the square's uv, y a dent texel in metres. */
  uAirDentQ: { value: THREE.Vector4 };
  /** The offsets' pending scroll (xy) and the light's (zw), in window uv. */
  uAirShift: { value: THREE.Vector4 };
  /** x the window's edge band, y the depth's darkening scale, z the most darkening, w the shade's share of the sun. */
  uAirMisc: { value: THREE.Vector4 };
}

/**
 * The session's own record of the variant's uniforms (the world keeps one, as it keeps `groundTileUniforms()`): the
 * variant is made once a session and its program reads the very objects it was compiled with, so a field made later --
 * the in-play warm's thrown away and another made at the next arrival -- must write into these and never into objects
 * of its own the variant does not read. Every value at rest: no textures, the art all nought (w nought: nothing stands).
 */
export function makeAirGroundUniforms(): AirGroundUniforms {
  return {
    uAirOffsets: { value: null },
    uAirDents: { value: null },
    uAirLayers: { value: null },
    uAirLight: { value: null },
    uAirWindow: { value: new THREE.Vector4(0, 0, 192, 1.5) },
    uAirArt: { value: new THREE.Vector4(0, 0, 0, 0) },
    uAirDentP: { value: new THREE.Vector4(0, 0, AIR_TUNE.prints.square, AIR_TUNE.prints.squareEdge) },
    uAirDentQ: { value: new THREE.Vector4(1 / 2048, AIR_TUNE.prints.square / 2048, 0, 0) },
    uAirShift: { value: new THREE.Vector4() },
    uAirMisc: { value: new THREE.Vector4(AIR_TUNE.window.edge, AIR_TUNE.ground.darkenScale, AIR_TUNE.ground.darkening, AIR_TUNE.ground.shade) },
  };
}

/** Four numbers of one vector into another, field by field (`copy` would hand its object across a call the frame need not make). */
function copy4(from: THREE.Vector4, to: THREE.Vector4): void {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.w = from.w;
}

/**
 * Every value of one record into another's objects (the field's own into the session's, `AirField.bindGround`): the
 * textures by reference and the vectors' numbers in place, so the objects the variant was compiled with are the ones
 * that move. Allocates nothing.
 */
export function copyAirGround(from: AirGroundUniforms, to: AirGroundUniforms): void {
  to.uAirOffsets.value = from.uAirOffsets.value;
  to.uAirDents.value = from.uAirDents.value;
  to.uAirLayers.value = from.uAirLayers.value;
  to.uAirLight.value = from.uAirLight.value;
  copy4(from.uAirWindow.value, to.uAirWindow.value);
  copy4(from.uAirArt.value, to.uAirArt.value);
  copy4(from.uAirDentP.value, to.uAirDentP.value);
  copy4(from.uAirDentQ.value, to.uAirDentQ.value);
  copy4(from.uAirShift.value, to.uAirShift.value);
  copy4(from.uAirMisc.value, to.uAirMisc.value);
}

/**
 * The ground's meshes handed from one material to the other (the chooser's answer moved, `World.syncGroundMaterial`):
 * every mesh under each chunk's group and every far tile wearing `from` takes `to`; anything else is left as it is.
 * Answers how many were handed over. Walks only when the answer moves, never on a steady frame (its closure is made
 * then and only then).
 */
export function swapGroundMaterial(chunks: Iterable<THREE.Object3D>, tiles: Iterable<THREE.Mesh>, from: THREE.Material, to: THREE.Material): number {
  let n = 0;
  for (const g of chunks) {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material === from) {
        m.material = to;
        n++;
      }
    });
  }
  for (const t of tiles) {
    if (t.material === from) {
      t.material = to;
      n++;
    }
  }
  return n;
}

/** The eight sample coordinates `TILE_MAP` writes, and what each becomes: the layer's own shift added. */
const LAYERS = ['x', 'y', 'z', 'w'] as const;
const SHIFT_OF: Readonly<Record<(typeof LAYERS)[number], string>> = { x: 'gAirShiftX', y: 'gAirShiftY', z: 'gAirShiftZ', w: 'gAirShiftW' };
/** Each of the eight calls exactly as `TILE_MAP` writes it: the colour's and the bump's of each layer. */
export const TILE_SAMPLE_CALLS: readonly string[] = LAYERS.flatMap((l) => [`textureGrad( uGround, vec3( vGroundUV, vGroundLayers.${l} ), gDx, gDy )`, `textureGrad( uGroundBump, vec3( vGroundUV, vGroundLayers.${l} ), gDx, gDy )`]);

/** The anchors the variant writes at in the tile program's fragment text: all of them or nothing. */
export const AIR_GROUND_ANCHORS: readonly string[] = [GROUND_DECLS_END, '#include <map_fragment>', '#include <normal_fragment_maps>', '#include <lights_fragment_end>'];

const AIR_GROUND_PARS = /* glsl */ `
uniform sampler2D uAirOffsets;
uniform sampler2D uAirDents;
uniform sampler2D uAirLayers;
uniform sampler2D uAirLight;
uniform vec4 uAirWindow;
uniform vec4 uAirArt;
uniform vec4 uAirDentP;
uniform vec4 uAirDentQ;
uniform vec4 uAirShift;
uniform vec4 uAirMisc;
// Worked out once in main() at the colour stage and read later: each layer's shift in the picture's own units, the
// dent's depth and slope here, and how much of the sun the dust's shadow leaves.
vec2 gAirShiftX = vec2( 0.0 );
vec2 gAirShiftY = vec2( 0.0 );
vec2 gAirShiftZ = vec2( 0.0 );
vec2 gAirShiftW = vec2( 0.0 );
vec2 gAirDentSlope = vec2( 0.0 );
float gAirShade = 1.0;
float airFinite( const in float v ) { return ( isnan( v ) || isinf( v ) ) ? 0.0 : v; }
vec2 airFinite2( const in vec2 v ) { return vec2( airFinite( v.x ), airFinite( v.y ) ); }
// A read the field cannot vouch for, as what it stands for when there is nothing: the light pass's transmittance is one.
float airFiniteOr( const in float v, const in float d ) { return ( isnan( v ) || isinf( v ) ) ? d : v; }
// A layer's "moves", from the lookup the world built of this world's layers (layer to its family's response).
float airMoves( const in float layer ) {
	int n = textureSize( uAirLayers, 0 ).x;
	int i = clamp( int( layer + 0.5 ), 0, n - 1 );
	return texelFetch( uAirLayers, ivec2( i, 0 ), 0 ).r;
}
// 0 at an edge of a square in its own uv, 1 a band's width in.
float airEdge( const in vec2 q, const in float band ) {
	float d = min( min( q.x, 1.0 - q.x ), min( q.y, 1.0 - q.y ) );
	if ( d <= 0.0 ) return 0.0;
	return smoothstep( 0.0, band, d );
}
`;

/**
 * After `#include <map_fragment>`, so before the tile program's colour stage: the world point worked back from the
 * picture coordinate, then (inside the window, each behind its own dial) the layers' shifts, the dent's depth and slope
 * with its darkening, and the dust's shadow.
 */
const AIR_GROUND_MAP = /* glsl */ `
if ( uAirArt.w > 0.5 ) {
	vec2 gAirW = vec2( uGroundFrame.x - vGroundUV.x * 4.0 * uGroundFrame.z, vGroundUV.y * 4.0 - uGroundFrame.y );
	vec2 gAirUv = ( gAirW - uAirWindow.xy ) / uAirWindow.z;
	float gAirIn = airEdge( gAirUv, uAirMisc.x );
	if ( gAirIn > 0.0 ) {
		vec2 gAirO = vec2( 0.0 );
		if ( uAirArt.x != 0.0 ) {
			gAirO = airFinite2( texture( uAirOffsets, gAirUv + uAirShift.xy ).xy ) * gAirIn;
			vec2 gAirPic = vec2( -uGroundFrame.z * gAirO.x, gAirO.y ) * ( 0.25 * uAirArt.x );
			gAirShiftX = gAirPic * airMoves( vGroundLayers.x );
			gAirShiftY = gAirPic * airMoves( vGroundLayers.y );
			gAirShiftZ = gAirPic * airMoves( vGroundLayers.z );
			gAirShiftW = gAirPic * airMoves( vGroundLayers.w );
		}
		if ( uAirArt.y != 0.0 ) {
			// Read where the sand has carried it, so a print is dragged with the sand; nowhere outside the square.
			vec2 gAirD = gAirW + gAirO * uAirArt.x;
			float gAirDIn = airEdge( ( gAirD - uAirDentP.xy ) / uAirDentP.z, uAirDentP.w / uAirDentP.z );
			if ( gAirDIn > 0.0 ) {
				vec2 gAirDuv = gAirD / uAirDentP.z;
				float gAirTx = uAirDentQ.x;
				float gAirDepth = airFinite( texture( uAirDents, gAirDuv ).r ) * uAirArt.y * gAirDIn;
				float gAirDx = airFinite( texture( uAirDents, gAirDuv + vec2( gAirTx, 0.0 ) ).r ) - airFinite( texture( uAirDents, gAirDuv - vec2( gAirTx, 0.0 ) ).r );
				float gAirDz = airFinite( texture( uAirDents, gAirDuv + vec2( 0.0, gAirTx ) ).r ) - airFinite( texture( uAirDents, gAirDuv - vec2( 0.0, gAirTx ) ).r );
				gAirDentSlope = vec2( gAirDx, gAirDz ) * ( uAirArt.y * gAirDIn / ( 2.0 * uAirDentQ.y ) );
				// Pressed ground sits a shade darker (the demo's 18% at most).
				if ( gAirDepth > 0.0 ) diffuseColor.rgb *= 1.0 - clamp( gAirDepth * uAirMisc.y, 0.0, uAirMisc.z );
			}
		}
		if ( uAirArt.z != 0.0 ) {
			// A transmittance it cannot read shades nothing (one), as dustShade has it.
		float gAirT = clamp( airFiniteOr( texture( uAirLight, gAirUv + uAirShift.zw ).r, 1.0 ), 0.0, 1.0 );
			gAirShade = 1.0 - uAirArt.z * uAirMisc.w * ( 1.0 - gAirT ) * gAirIn;
		}
	}
}
`;

/** After `#include <normal_fragment_maps>`, before the tile program's own lean: the dent's slope bent into the normal, only where there is one. */
const AIR_GROUND_NORMAL = /* glsl */ `
if ( gAirDentSlope.x != 0.0 || gAirDentSlope.y != 0.0 ) {
	vec3 gAirN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
	gAirN = normalize( gAirN + vec3( gAirDentSlope.x, 0.0, gAirDentSlope.y ) );
	normal = normalize( ( viewMatrix * vec4( gAirN, 0.0 ) ).xyz );
}
`;

/** After `#include <lights_fragment_end>`: the dust's shadow off the direct light (the sun's, and any lamp's), only where it takes any. */
const AIR_GROUND_SHADE = /* glsl */ `
if ( gAirShade < 1.0 ) {
	reflectedLight.directDiffuse *= gAirShade;
	reflectedLight.directSpecular *= gAirShade;
}
`;

const afterChunk = (source: string, chunk: string, code: string): string => {
  const at = source.indexOf(chunk);
  if (at < 0) return source;
  const end = at + chunk.length;
  return `${source.slice(0, end)}\n${code}${source.slice(end)}`;
};

/**
 * The variant's rewrite of the tile program's fragment text (already written by `injectGroundTiles`), into `shader`.
 * Answers whether it went in: every anchor and each of the eight sample calls found exactly once, or nothing is written.
 */
export function injectGroundAir(shader: { fragmentShader: string; uniforms: Record<string, unknown> }, air: AirGroundUniforms): boolean {
  const fs = shader.fragmentShader;
  for (const a of AIR_GROUND_ANCHORS) if (!fs.includes(a)) return false;
  for (const call of TILE_SAMPLE_CALLS) if (fs.split(call).length !== 2) return false;
  let f = fs;
  for (const l of LAYERS) {
    const from = `vec3( vGroundUV, vGroundLayers.${l} )`;
    const to = `vec3( vGroundUV + ${SHIFT_OF[l]}, vGroundLayers.${l} )`;
    for (const tex of ['uGround', 'uGroundBump']) f = f.replace(`textureGrad( ${tex}, ${from}, gDx, gDy )`, `textureGrad( ${tex}, ${to}, gDx, gDy )`);
  }
  f = f.replace(GROUND_DECLS_END, `${AIR_GROUND_PARS}${GROUND_DECLS_END}`);
  f = afterChunk(f, '#include <map_fragment>', AIR_GROUND_MAP);
  f = afterChunk(f, '#include <normal_fragment_maps>', AIR_GROUND_NORMAL);
  f = afterChunk(f, '#include <lights_fragment_end>', AIR_GROUND_SHADE);
  shader.fragmentShader = f;
  Object.assign(shader.uniforms, air);
  return true;
}

/**
 * The session's air variant of the ground (made once a session, never disposed, so a travel builds nothing): the tile
 * program's material over the same uniforms, the cascades set up first as on every lit material, then the tile
 * program, then the air's rewrite; its key is the tile program's and a word.
 */
export function groundAirMaterial(u: GroundTileUniforms, air: AirGroundUniforms, csm: CSM | null): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  csm?.setupMaterial(mat);
  const previous = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    previous.call(mat, shader, renderer);
    if (!injectGroundTiles(shader, u)) {
      console.warn('the ground shader has no place for its tiles; the ground is drawn without its pictures');
      return;
    }
    if (!injectGroundAir(shader, air)) console.warn('volumetrics: the ground\'s tile program has not the shape the air expects; the ground is drawn as it is, with nothing of the air over it');
  };
  // The ground carries its own wet injection; the material scan must not wrap it again.
  mat.userData.wetBuiltIn = true;
  mat.name = 'ground (air)';
  mat.customProgramCacheKey = () => GROUND_AIR_KEY;
  return mat;
}

/** What chooses the ground's material: the plain tile program's, or the air variant's (`groundMaterialFor`). */
export interface GroundChoice {
  /** The volumetrics master. */
  on: boolean;
  /** The ground is the tile program (a version-4 pack on a converted world). */
  tiles: boolean;
  /** Either ground effect asked for: the drifting sand or the prints (the prints only where this browser blends floats). */
  sand: boolean;
  prints: boolean;
  /** The moving air is built and holds targets the variant can read. */
  field: boolean;
  /** The frame report's soft off (`volGroundArt`'s `off`): the choosers back on their plain materials, nothing else moved. */
  softOff: boolean;
}

/** Whether the ground wears the air variant: the master, the tile program, the field and either ground switch, and no soft off. Pure. */
export function groundWearsAir(c: GroundChoice): boolean {
  return c.on && c.tiles && c.field && (c.sand || c.prints) && !c.softOff;
}

/**
 * The material the ground wears (the design's chooser): the variant while `groundWearsAir`, else the plain one --
 * which, with the master off, is always the plain one, today's material with today's key.
 */
export function groundMaterialFor<M>(c: GroundChoice, plain: M, air: M | null): M {
  return air !== null && groundWearsAir(c) ? air : plain;
}

// ---------------------------------------------------------------- the self test (`__debug.air({ groundSelfTest: true })`)

/** What `groundAirSelfTest` found: each run against the plain ground and the mirror, and the programs the knobs built. */
export interface GroundAirSelfTest {
  ok: boolean;
  /** Each run: the pixels compared, how many of them differ from what is wanted at all, the worst channel's difference (linear colour). */
  runs: { name: string; pixels: number; differing: number; worst: number; want: string }[];
  /** Programs built as the dials moved, after each scene's first draw: must be 0. */
  builtOnKnobs: number;
  note: string;
}

/**
 * Draw a strip of three tiles off-screen with the plain tile ground and with its air variant, over inputs of the test's
 * own (a striped picture, a constant offset, a constant dent, a light pass at a half), and hold the pixels to the plain
 * ground and to `groundGate`'s mirror (`airMath.ts`): at every dial nought the variant is the plain ground to the bit, lit
 * and unlit; at the drift's dial one each layer's picture moves by the offset times its own "moves" (one, nought and a
 * half), which is the plain ground drawn with its frame moved that far; the dent darkens by `dentDarken`'s factor under
 * an ambient light alone; the dust's shadow takes `dustShade`'s share of a sun alone. Console only: it builds the
 * programs of its own scenes and allocates as it likes.
 */
export function groundAirSelfTest(renderer: THREE.WebGLRenderer): GroundAirSelfTest {
  const u = makeGroundTileUniforms();
  // Layer 0 striped along the picture's x (red then blue), layers 1 and 2 solid; two by two texels each, linear.
  const colourData = new Uint8Array(2 * 2 * 4 * 3);
  const put = (layer: number, x: number, y: number, c: readonly number[]): void => colourData.set([c[0], c[1], c[2], 255], (layer * 4 + y * 2 + x) * 4);
  for (let y = 0; y < 2; y++) {
    put(0, 0, y, [220, 30, 30]);
    put(0, 1, y, [30, 30, 220]);
    put(1, 0, y, [30, 200, 60]);
    put(1, 1, y, [200, 30, 160]);
    put(2, 0, y, [230, 210, 40]);
    put(2, 1, y, [40, 90, 210]);
  }
  const colour = new THREE.DataArrayTexture(colourData, 2, 2, 3);
  colour.colorSpace = THREE.SRGBColorSpace;
  colour.wrapS = colour.wrapT = THREE.RepeatWrapping;
  colour.minFilter = colour.magFilter = THREE.LinearFilter;
  colour.generateMipmaps = false;
  colour.needsUpdate = true;
  u.uGround.value.dispose();
  u.uGround.value = colour;
  u.uGroundFrame.value.set(0, 0, 1, 0);
  u.uGroundTint.value.set(0, 1.6, 0, 0);
  u.uGroundCloud.value.x = 0;
  // The air's inputs: a constant offset, a constant dent, the layers' moves (one, nought, a half), a light pass at a half.
  const off = [0.6, -0.35];
  const dentDepth = 0.02;
  const offsets = new THREE.DataTexture(new Float32Array([off[0], off[1], 2000, 0]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  const dents = new THREE.DataTexture(new Float32Array([dentDepth]), 1, 1, THREE.RedFormat, THREE.FloatType);
  const layers = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255, 0, 255, 0, 0, 128, 255, 128, 255]), 3, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  const lightByte = 128;
  const light = new THREE.DataTexture(new Uint8Array([lightByte, lightByte, lightByte, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  for (const t of [offsets, dents, layers, light]) {
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
  }
  const air: AirGroundUniforms = {
    uAirOffsets: { value: offsets },
    uAirDents: { value: dents },
    uAirLayers: { value: layers },
    uAirLight: { value: light },
    uAirWindow: { value: new THREE.Vector4(-1000, -1000, 2000, 1.5) },
    uAirArt: { value: new THREE.Vector4(0, 0, 0, 1) },
    uAirDentP: { value: new THREE.Vector4(-64, -64, 128, AIR_TUNE.prints.squareEdge) },
    uAirDentQ: { value: new THREE.Vector4(1, 128, 0, 0) },
    uAirShift: { value: new THREE.Vector4() },
    uAirMisc: { value: new THREE.Vector4(AIR_TUNE.window.edge, AIR_TUNE.ground.darkenScale, AIR_TUNE.ground.darkening, AIR_TUNE.ground.shade) },
  };
  // Three tiles of one layer each (0, 1, 2), two triangles a tile, as the chunk builder writes them.
  const tiles = 3;
  const tileSize = 4;
  const vcount = tiles * 6;
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const lay = new Uint8Array(vcount * 4);
  const bl = new Uint8Array(vcount * 4);
  const ti = new Uint8Array(vcount * 3).fill(255);
  let v = 0;
  for (let i = 0; i < tiles; i++) {
    const corner = (gx: number, gz: number, s2: number, t2: number): void => {
      pos.set([gx, 0, gz], v * 3);
      nor.set([0, 1, 0], v * 3);
      lay.set([i, i, i, i], v * 4);
      bl.set([0, 0, 0, s2 * 3 + t2], v * 4);
      v++;
    };
    const x0 = i * tileSize;
    corner(x0 + 4, 0, 0, 0);
    corner(x0, 0, 2, 0);
    corner(x0 + 4, 4, 0, 2);
    corner(x0, 0, 2, 0);
    corner(x0, 4, 2, 2);
    corner(x0 + 4, 4, 0, 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('aGroundLayers', new THREE.BufferAttribute(lay, 4));
  geometry.setAttribute('aGroundBlend', new THREE.BufferAttribute(bl, 4));
  geometry.setAttribute('aGroundTint', new THREE.BufferAttribute(ti, 3, true));
  const plain = groundTilesMaterial(u, null);
  const variant = groundAirMaterial(u, air, null);
  plain.side = THREE.DoubleSide;
  variant.side = THREE.DoubleSide;
  // Three scenes: no light (the program's own colour view), an ambient light alone, a sun alone from straight above.
  const scenes = { view: new THREE.Scene(), ambient: new THREE.Scene(), sun: new THREE.Scene() };
  const meshes: Record<string, { plain: THREE.Mesh; variant: THREE.Mesh }> = {};
  for (const [name, scene] of Object.entries(scenes)) {
    const p = new THREE.Mesh(geometry, plain);
    const q = new THREE.Mesh(geometry, variant);
    p.frustumCulled = q.frustumCulled = false;
    scene.add(p, q);
    meshes[name] = { plain: p, variant: q };
  }
  const ambient = new THREE.AmbientLight(0xffffff, Math.PI);
  scenes.ambient.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
  sun.position.set(0, 10, 0);
  scenes.sun.add(sun);
  const camera = new THREE.OrthographicCamera(0, tiles * tileSize, 0, -tileSize, 0.1, 20);
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const W = tiles * 16;
  const H = 16;
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, samples: 0 });
  const previous = renderer.getRenderTarget();
  const clearColour = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  const programs = (): number => renderer.info.programs?.length ?? 0;
  const drawn = new Set<string>();
  let builtOnKnobs = 0;
  const runs: GroundAirSelfTest['runs'] = [];
  const draw = (scene: keyof typeof scenes, which: 'plain' | 'variant'): Uint16Array => {
    const key = `${scene}:${which}`;
    const before = programs();
    const m = meshes[scene];
    m.plain.visible = which === 'plain';
    m.variant.visible = which === 'variant';
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scenes[scene], camera);
    const px = new Uint16Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    if (drawn.has(key)) builtOnKnobs += programs() - before;
    drawn.add(key);
    return px;
  };
  // Each pixel a texel's breadth inside its tile; `f` answers the wanted colour channel from the plain picture's.
  const compare = (name: string, want: string, a: Uint16Array, b: Uint16Array, tile: number | null, f: (plain: number) => number): void => {
    let worst = 0;
    let pixels = 0;
    let differing = 0;
    for (let j = 0; j < H; j++) {
      const gz = tileSize - ((j + 0.5) / H) * tileSize;
      for (let i = 0; i < W; i++) {
        const gx = ((i + 0.5) / W) * tiles * tileSize;
        const t = Math.floor(gx / tileSize);
        const inX = gx - t * tileSize;
        if (inX < 0.3 || inX > tileSize - 0.3 || gz < 0.3 || gz > tileSize - 0.3) continue;
        if (tile !== null && t !== tile) continue;
        const at = (j * W + i) * 4;
        let here = 0;
        for (let ch = 0; ch < 3; ch++) here = Math.max(here, Math.abs(THREE.DataUtils.fromHalfFloat(a[at + ch]) - f(THREE.DataUtils.fromHalfFloat(b[at + ch]))));
        if (here > 0) differing++;
        if (here > worst) worst = here;
        pixels++;
      }
    }
    runs.push({ name, pixels, differing, worst: Number(worst.toFixed(5)), want });
  };
  try {
    renderer.setClearColor(0x000000, 1);
    // 1. Every dial nought: the variant is the plain ground, its colour, under an ambient light and under a sun.
    for (const scene of ['view', 'ambient', 'sun'] as const) {
      u.uGroundLook.value.z = scene === 'view' ? 1 : 0;
      air.uAirArt.value.set(0, 0, 0, 1);
      const p = draw(scene, 'plain');
      const q = draw(scene, 'variant');
      compare(`every dial nought, ${scene === 'view' ? 'its colour' : scene === 'ambient' ? 'under an ambient light' : 'under a sun'}`, 'the plain ground, to the bit', q, p, null, (x) => x);
    }
    // 2. The drift at one: each layer moved by the offset times its own moves, the plain ground with its frame moved.
    u.uGroundLook.value.z = 1;
    const moves = [1, 0, 128 / 255];
    air.uAirArt.value.set(1, 0, 0, 1);
    const q = draw('view', 'variant');
    for (let tile = 0; tile < 3; tile++) {
      const m = moves[tile];
      // The picture's x runs along the terrain's, the world's -x with the pictures the client's way round (frame z +1).
      u.uGroundFrame.value.set(-off[0] * m, off[1] * m, 1, 0);
      const p = draw('view', 'plain');
      u.uGroundFrame.value.set(0, 0, 1, 0);
      compare(`the drift at one, a layer that moves ${m.toFixed(2)}`, "the plain ground with its frame moved by the offset times the layer's moves", q, p, tile, (x) => x);
    }
    air.uAirArt.value.set(0, 0, 0, 1);
    // 3. The prints at one: a constant dent darkens by the mirror's factor (no slope, so no bend), an ambient light alone.
    u.uGroundLook.value.z = 0;
    const pa = draw('ambient', 'plain');
    air.uAirArt.value.set(0, 1, 0, 1);
    const qa = draw('ambient', 'variant');
    compare('the prints at one, a constant dent', `the plain ground times dentDarken (${dentDarken(1, dentDepth, 1).toFixed(4)})`, qa, pa, null, (x) => dentDarken(x, dentDepth, 1));
    // 4. The shade at one: a sun alone, the light pass at a half.
    air.uAirArt.value.set(0, 0, 1, 1);
    const ps = draw('sun', 'plain');
    const qs = draw('sun', 'variant');
    const T = lightByte / 255;
    compare('the shade at one, the light pass at a half', `the plain ground times dustShade (${dustShade(1, T, 1, 1).toFixed(4)})`, qs, ps, null, (x) => dustShade(x, T, 1, 1));
  } finally {
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clearColour, clearAlpha);
    plain.dispose();
    variant.dispose();
    geometry.dispose();
    for (const t of [colour, offsets, dents, layers, light, u.uGroundBump.value, u.uGroundMask.value, u.uGroundClouds.value]) t.dispose();
    ambient.dispose();
    sun.dispose();
    rt.dispose();
  }
  // Nought is to the bit; the rest within a few half-float steps of linear colour (the two programs reach the same uv
  // by different arithmetic, a last bit apart).
  const zeroOk = runs.slice(0, 3).every((r) => r.worst === 0 && r.pixels > 0);
  const restOk = runs.slice(3).every((r) => r.worst < 4e-3 && r.pixels > 0);
  return {
    ok: zeroOk && restOk && builtOnKnobs === 0,
    runs,
    builtOnKnobs,
    note: "every pixel a texel's breadth inside its tile, linear colour: at every dial nought the variant is the plain ground to the bit, lit and unlit; at one the drift is the plain ground's frame moved by the offset times each layer's moves, the dent's darkening and the dust's shadow the mirror's factors (airMath's dentDarken and dustShade), each within 0.004; and no program built as the dials moved",
  };
}