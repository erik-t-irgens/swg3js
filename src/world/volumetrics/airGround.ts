// The tile ground's air variant (the design's §2.7 and §9, the second wave; the blowing sand the third's): the same
// program the ground is drawn with today (`terrainTextures.ts`'s tile program), with the moving air laid over it -- a
// blowing sand of ours streaking over the still ground where the air passes the sand's threshold, the dents' depth
// darkening pressed ground and bending its light, and the dust's shadow taken off the sun.
//
// **The ground's own picture never moves** (from wave 2b). The second wave slid each layer's picture by the
// carried offsets, which nothing restarted, so in a steady carry the picture sheared without bound ("wet paint"). Now
// `TILE_MAP` is the plain program's text to the byte, and what moves is a picture of ours (`airSand.ts`) laid over it as
// albedo, carried by two phases of the second wave's own carry (each restarted every cycle), its strength read off the
// offsets themselves, its coverage each drawn layer's own (`min(moves, dust)` through the tile's mask weights, exact to
// the pixel at a family border), its colour each layer's lighter tones times the colour map's tint at the pixel.
//
// **All or nothing, and never the plain ground's text.** The variant is a material of its own whose `onBeforeCompile`
// runs the plain injection (`injectGroundTiles`) and then rewrites the text that wrote (`injectGroundAir`): its
// declarations at `GROUND_DECLS_END`, a block after `#include <map_fragment>` (so it lands before the tile program's own
// colour stage: the sand's strength and grains, the dents, the shade), a block after `#include <color_fragment>` (where
// `TILE_MAP` has run and the masks' weights and the tint stand: the sand's coverage and colour laid, before the wet
// block, so the rain darkens the sand too), the dent's bent normal after `#include <normal_fragment_maps>` (before the
// tile program's own lean, which then adds the ground's lean and bump to it), and the shadow after `#include
// <lights_fragment_end>`. Every anchor exactly once, `TILE_MAP` found unchanged, its albedo line before the colour stage
// and the globals it reads declared, or nothing is written and the variant draws as the plain ground.
//
// **At every art dial nought the variant's pixels are today's by construction** (the design's §4.1 item 5, §4.2 item
// 1): each term that changes a value the art already has is a uniform branch round the whole term, and the sand's every
// write sits inside `if ( uAirArt.x != 0.0 )` and then inside a test that it lays anything at all, so at nought, where
// nothing blows or over ground that does not blow, `diffuseColor` and `gGroundBump` are not written. Every field read is
// made finite before it is used; a pixel outside the window takes nothing, the dents nothing outside their square. No
// vertex moves and no varying is added: the world position is worked back from `vGroundUV` and the frame.
//
// It adds five samplers to the tile program's (the offsets, the dents, the per-layer lookup, the light, the sand's
// picture): fourteen of sixteen on Direct3D 11, the design's ceiling.
import * as THREE from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';
import { GROUND_DECLS_END, GROUND_TILES_KEY, TILE_MAP, groundTilesMaterial, injectGroundTiles, makeGroundTileUniforms, type GroundTileUniforms } from '../terrainTextures.ts';
import { AIR_TUNE } from './airTune.ts';
import { dentDarken, dustShade, sandAlpha, sandBlend, sandOverlay, sandStrength, shadeTransmittance, smoothstep } from './airMath.ts';
// The footprint's fade is worked out over the picture's texels on the CPU, so no size is in the text.
import { SAND_SIZE as SAND_PICTURE } from './airSand.ts';
import { WEATHER_UNIFORMS } from '../wetness.ts';

/** The variant's key: the tile program's own and a word, so the two are two programs and the plain one's key never moves. */
export const GROUND_AIR_KEY = `${GROUND_TILES_KEY}-air`;

/** Every uniform the variant reads beside the tile program's: kept objects the field writes in place. */
export interface AirGroundUniforms {
  /**
   * The blowing sand's two phases (metres, phase A's offset in RG and B's in BA), the dents (metres), the per-layer
   * lookup (layers × 2, RGBA8: row 0 each layer's family's response, row 1 its lighter tones as sRGB), the light toward
   * the sun (an optical depth at four heights, the ground's in red), the sand's picture.
   */
  uAirOffsets: { value: THREE.Texture | null };
  /**
   * The sand carried in the air (the third wave): its colour premultiplied by its amount, and the amount, lifted where the
   * ground blows and carried over any ground, so a streak blown off sand runs on over rock and fades there.
   */
  uAirCarry: { value: THREE.Texture | null };
  uAirDents: { value: THREE.Texture | null };
  uAirLayers: { value: THREE.Texture | null };
  uAirLight: { value: THREE.Texture | null };
  uAirSand: { value: THREE.Texture | null };
  /** The window: x, z of its corner, its size, its cell. */
  uAirWindow: { value: THREE.Vector4 };
  /** x the sand's dial, y the prints', z the shade's (each nought while its effect is off), w 1 while the field's targets stand. */
  uAirArt: { value: THREE.Vector4 };
  /** The dent square: its corner's x and z, its size, and the metres at its edge a dent fades over. */
  uAirDentP: { value: THREE.Vector4 };
  /** x a dent texel in the square's uv, y a dent texel in metres. */
  uAirDentQ: { value: THREE.Vector4 };
  /** The offsets' pending scroll (xy) and the light's (zw), in window uv. */
  uAirShift: { value: THREE.Vector4 };
  /** x the window's edge band, y the depth's darkening scale, z the most darkening, w the shade's share of the sun. */
  uAirMisc: { value: THREE.Vector4 };
  /** The phases' seconds since their restarts (x A, y B), z 1 for the sand's view (`air({ view: 'sand' })`), w one over the cycle. */
  uAirPhase: { value: THREE.Vector4 };
  /** Where each phase's picture stands since its last restart, picture uv: A's in xy, B's in zw (`sandJitter`). */
  uAirJitter: { value: THREE.Vector4 };
  /** x the opacity (times the art dial's partner, the wet ground's share), y the brightness, z metres a repeat of the picture, w seconds of streak. */
  uAirSandP: { value: THREE.Vector4 };
  /** x and y the carry at which it begins and is full (m/s), z where the grains are cut on red and w how soft. */
  uAirSandQ: { value: THREE.Vector4 };
  /** x how much grains in flight flatten the relief, y and z the footprint (picture uv a pixel) at which it fades and is gone, w the patches' half width. */
  uAirSandR: { value: THREE.Vector4 };
}

/**
 * The session's own record of the variant's uniforms (the world keeps one, as it keeps `groundTileUniforms()`): the
 * variant is made once a session and its program reads the very objects it was compiled with, so a field made later --
 * the in-play warm's thrown away and another made at the next arrival -- must write into these and never into objects
 * of its own the variant does not read. Every value at rest: no textures, the art all nought (w nought: nothing stands).
 */
export function makeAirGroundUniforms(): AirGroundUniforms {
  const S = AIR_TUNE.sand;
  return {
    uAirOffsets: { value: null },
    uAirCarry: { value: null },
    uAirDents: { value: null },
    uAirLayers: { value: null },
    uAirLight: { value: null },
    uAirSand: { value: null },
    uAirWindow: { value: new THREE.Vector4(0, 0, 192, 1.5) },
    uAirArt: { value: new THREE.Vector4(0, 0, 0, 0) },
    uAirDentP: { value: new THREE.Vector4(0, 0, AIR_TUNE.prints.square, AIR_TUNE.prints.squareEdge) },
    uAirDentQ: { value: new THREE.Vector4(1 / 2048, AIR_TUNE.prints.square / 2048, 0, 0) },
    uAirShift: { value: new THREE.Vector4() },
    uAirMisc: { value: new THREE.Vector4(AIR_TUNE.window.edge, AIR_TUNE.ground.darkenScale, AIR_TUNE.ground.darkening, AIR_TUNE.ground.shade) },
    uAirPhase: { value: new THREE.Vector4(0.5, 0.5, 0, 1 / S.cycle) },
    uAirJitter: { value: new THREE.Vector4() },
    uAirSandP: { value: new THREE.Vector4(S.opacity, S.bright, S.scale, S.streak) },
    uAirSandQ: { value: new THREE.Vector4(S.from, S.full, S.grains, S.soft) },
    uAirSandR: { value: new THREE.Vector4(S.flatten, S.fadeFrom / SAND_PICTURE, S.fadeTo / SAND_PICTURE, S.patches) },
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
  to.uAirCarry.value = from.uAirCarry.value;
  to.uAirDents.value = from.uAirDents.value;
  to.uAirLayers.value = from.uAirLayers.value;
  to.uAirLight.value = from.uAirLight.value;
  to.uAirSand.value = from.uAirSand.value;
  copy4(from.uAirWindow.value, to.uAirWindow.value);
  copy4(from.uAirArt.value, to.uAirArt.value);
  copy4(from.uAirDentP.value, to.uAirDentP.value);
  copy4(from.uAirDentQ.value, to.uAirDentQ.value);
  copy4(from.uAirShift.value, to.uAirShift.value);
  copy4(from.uAirMisc.value, to.uAirMisc.value);
  copy4(from.uAirPhase.value, to.uAirPhase.value);
  copy4(from.uAirJitter.value, to.uAirJitter.value);
  copy4(from.uAirSandP.value, to.uAirSandP.value);
  copy4(from.uAirSandQ.value, to.uAirSandQ.value);
  copy4(from.uAirSandR.value, to.uAirSandR.value);
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

/** The anchors the variant writes at in the tile program's fragment text: each exactly once, all of them or nothing. */
export const AIR_GROUND_ANCHORS: readonly string[] = [GROUND_DECLS_END, '#include <map_fragment>', '#include <color_fragment>', '#include <normal_fragment_maps>', '#include <lights_fragment_end>'];

/** `TILE_MAP`'s closing line: it must stand once, before the colour stage, so the sand is laid over the pictures blended. */
export const TILE_ALBEDO_LINE = 'diffuseColor.rgb *= gGroundAlbedo;';

/** The tile program's globals the sand's colour stage reads: declared, or the rewrite writes nothing. */
export const TILE_GLOBALS_READ: readonly string[] = ['vec3 gGroundW =', 'vec4 gGroundBump ='];

const AIR_GROUND_PARS = /* glsl */ `
uniform sampler2D uAirOffsets;
uniform sampler2D uAirCarry;
uniform sampler2D uAirDents;
uniform sampler2D uAirLayers;
uniform sampler2D uAirLight;
uniform sampler2D uAirSand;
uniform vec4 uAirWindow;
uniform vec4 uAirArt;
uniform vec4 uAirDentP;
uniform vec4 uAirDentQ;
uniform vec4 uAirShift;
uniform vec4 uAirMisc;
uniform vec4 uAirPhase;
uniform vec4 uAirJitter;
uniform vec4 uAirSandP;
uniform vec4 uAirSandQ;
uniform vec4 uAirSandR;
// Worked out once in main() before the colour stage and read later: the blowing sand's strength and its alpha before
// its coverage, the dent's slope here, and how much of the sun the dust's shadow leaves.
float gAirSandStr = 0.0;
float gAirSand = 0.0;
vec4 gAirCarry = vec4( 0.0 );
vec2 gAirDentSlope = vec2( 0.0 );
float gAirShade = 1.0;
float airFinite( const in float v ) { return ( isnan( v ) || isinf( v ) ) ? 0.0 : v; }
vec4 airFinite4( const in vec4 v ) { return vec4( airFinite( v.x ), airFinite( v.y ), airFinite( v.z ), airFinite( v.w ) ); }
// A read the field cannot vouch for, as what it stands for when there is nothing: the light pass's depth is nought.
float airFiniteOr( const in float v, const in float d ) { return ( isnan( v ) || isinf( v ) ) ? d : v; }
// A layer's row of the lookup the world built of this world's layers: row 0 its family's response (moves, heals,
// gives, dust), row 1 its lighter tones as sRGB bytes.
vec4 airLayer( const in float layer, const in int row ) {
	int n = textureSize( uAirLayers, 0 ).x;
	int i = clamp( int( layer + 0.5 ), 0, n - 1 );
	return texelFetch( uAirLayers, ivec2( i, row ), 0 );
}
// How much of the blowing sand shows over a layer: min(moves, dust), so mud, wet sand, rock and paving never blow.
float airBlows( const in float layer ) {
	vec4 r = airLayer( layer, 0 );
	return min( r.r, r.a );
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
 * picture coordinate and the sand's picture derivatives (taken here in uniform control flow, since its taps sit in
 * branches on per-pixel values), then (inside the window, each behind its own dial) the blowing sand's strength from the
 * two phases' offsets and its grains from three taps along the carry of each phase's picture, blended so the contrast
 * holds; the dent's depth and slope with its darkening, read where it was pressed; and the dust's shadow.
 */
const AIR_GROUND_MAP = /* glsl */ `
if ( uAirArt.w > 0.5 ) {
	vec2 gAirW = vec2( uGroundFrame.x - vGroundUV.x * 4.0 * uGroundFrame.z, vGroundUV.y * 4.0 - uGroundFrame.y );
	vec2 gAirPDx = dFdx( gAirW ) / uAirSandP.z;
	vec2 gAirPDy = dFdy( gAirW ) / uAirSandP.z;
	vec2 gAirUv = ( gAirW - uAirWindow.xy ) / uAirWindow.z;
	float gAirIn = airEdge( gAirUv, uAirMisc.x );
	if ( gAirIn > 0.0 ) {
		if ( uAirArt.x != 0.0 ) {
			vec4 gAirO = airFinite4( texture( uAirOffsets, gAirUv + uAirShift.xy ) );
			// Each phase's carry over its own time, weighted by the cross-fade: bounded, and continuous over its restart.
			float gAirFA = uAirPhase.x * uAirPhase.w;
			float gAirFB = uAirPhase.y * uAirPhase.w;
			float gAirKA = gAirFA < 0.5 ? 2.0 * uAirPhase.w : 2.0 * ( 1.0 - gAirFA ) / max( uAirPhase.x, 1e-6 );
			float gAirKB = gAirFB < 0.5 ? 2.0 * uAirPhase.w : 2.0 * ( 1.0 - gAirFB ) / max( uAirPhase.y, 1e-6 );
			float gAirSpeed = length( gAirO.xy ) * gAirKA + length( gAirO.zw ) * gAirKB;
			float gAirFoot = max( length( gAirPDx ), length( gAirPDy ) );
			gAirSandStr = smoothstep( uAirSandQ.x, uAirSandQ.y, gAirSpeed ) * gAirIn * ( 1.0 - smoothstep( uAirSandR.y, uAirSandR.z, gAirFoot ) );
			if ( gAirSandStr > 0.0 ) {
				// The sand carried in the air (the third wave): what was lifted off ground that blows, carried here.
				gAirCarry = airFinite4( texture( uAirCarry, gAirUv + uAirShift.xy ) );
				vec2 gAirDir = -( gAirO.xy * gAirKA + gAirO.zw * gAirKB );
				float gAirDl = length( gAirDir );
				gAirDir = gAirDl > 1e-5 ? gAirDir / gAirDl : vec2( 0.0 );
				float gAirL = gAirSpeed * uAirSandP.w;
				vec2 gAirPa = vec2( 0.0 );
				vec2 gAirPb = vec2( 0.0 );
				for ( int k = 0; k < 3; k++ ) {
					vec2 gAirSt = gAirDir * ( gAirL * ( float( k ) * 0.5 - 0.5 ) );
					gAirPa += textureGrad( uAirSand, ( gAirW + gAirO.xy + gAirSt ) / uAirSandP.z + uAirJitter.xy, gAirPDx, gAirPDy ).rg;
					gAirPb += textureGrad( uAirSand, ( gAirW + gAirO.zw + gAirSt ) / uAirSandP.z + uAirJitter.zw, gAirPDx, gAirPDy ).rg;
				}
				gAirPa *= 1.0 / 3.0;
				gAirPb *= 1.0 / 3.0;
				float gAirWA = 1.0 - abs( 2.0 * gAirFA - 1.0 );
				float gAirWB = 1.0 - gAirWA;
				vec2 gAirP = 0.5 + ( gAirWA * ( gAirPa - 0.5 ) + gAirWB * ( gAirPb - 0.5 ) ) / sqrt( gAirWA * gAirWA + gAirWB * gAirWB );
				gAirSand = uAirArt.x * uAirSandP.x * gAirSandStr
					* smoothstep( uAirSandQ.z - uAirSandQ.w, uAirSandQ.z + uAirSandQ.w, gAirP.x )
					* smoothstep( 0.5 - uAirSandR.w, 0.5 + uAirSandR.w, gAirP.y );
			}
		}
		if ( uAirArt.y != 0.0 ) {
			// Read where it was pressed; nowhere outside the square.
			vec2 gAirD = gAirW;
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
			// The light toward the sun at the ground, exp(-τ(0)); a depth it cannot read shades nothing (one), as
			// shadeTransmittance has it.
			float gAirT = exp( -max( airFiniteOr( texture( uAirLight, gAirUv + uAirShift.zw ).r, 0.0 ), 0.0 ) );
			gAirShade = 1.0 - uAirArt.z * uAirMisc.w * ( 1.0 - gAirT ) * gAirIn;
		}
	}
}
`;

/**
 * After `#include <color_fragment>`, where `TILE_MAP` has run and its mask weights and the tint stand: the blowing sand's
 * coverage through the very mix chain the pictures are blended by (exact to the pixel at a family border, so sand blown
 * onto rock is not drawn), its colour each layer's lighter tones times the colour map's tint here times the brightness,
 * laid over the albedo, and the relief and gloss flattened where grains fly. Every write behind the dial and a test that
 * anything is laid; `air({ view: 'sand' })` shows the strength over the ground in place of the colour (`uAirPhase.z`).
 */
const AIR_GROUND_COLOUR = /* glsl */ `
if ( uAirArt.x != 0.0 && gAirSandStr > 0.0 ) {
	float gAirCov = airBlows( vGroundLayers.x );
	vec3 gAirCol = groundDecode( airLayer( vGroundLayers.x, 1 ).rgb );
	gAirCov = mix( gAirCov, airBlows( vGroundLayers.y ), gGroundW.x );
	gAirCol = mix( gAirCol, groundDecode( airLayer( vGroundLayers.y, 1 ).rgb ), gGroundW.x );
	gAirCov = mix( gAirCov, airBlows( vGroundLayers.z ), gGroundW.y );
	gAirCol = mix( gAirCol, groundDecode( airLayer( vGroundLayers.z, 1 ).rgb ), gGroundW.y );
	gAirCov = mix( gAirCov, airBlows( vGroundLayers.w ), gGroundW.z );
	gAirCol = mix( gAirCol, groundDecode( airLayer( vGroundLayers.w, 1 ).rgb ), gGroundW.z );
	// The sand carried in the air (the third wave, the owner's "it should continue over the rock but die off normally"):
	// over ground that does not blow it stands for the streaks blown onto it, in the colour of the ground they left, and
	// over ground that does the pixel's own coverage holds as it was.
	float gAirCover = max( gAirCov, gAirCarry.a );
	vec3 gAirCarried = gAirCarry.a > 1e-4 ? gAirCarry.rgb / gAirCarry.a : vec3( 0.0 );
	float gAirA = gAirSand * gAirCover;
	if ( uAirPhase.z > 0.5 ) {
		diffuseColor.rgb = vec3( gAirSandStr * gAirCover );
	} else if ( gAirA > 0.0 ) {
		vec3 gAirSandColour = ( gAirCarry.a > gAirCov ? gAirCarried : gAirCol * groundDecode( vGroundTint ) ) * uAirSandP.y;
		diffuseColor.rgb = mix( diffuseColor.rgb, gAirSandColour, gAirA );
		gGroundBump = mix( gGroundBump, vec4( 0.5, 0.5, 1.0, 0.0 ), gAirA * uAirSandR.x );
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

/** How many times `part` stands in `text`. */
const timesIn = (text: string, part: string): number => text.split(part).length - 1;

/**
 * The variant's rewrite of the tile program's fragment text (already written by `injectGroundTiles`), into `shader`.
 * Answers whether it went in: every anchor exactly once, `TILE_MAP` there unchanged, its albedo line once and before the
 * colour stage, and the globals the sand reads declared; or nothing is written. `TILE_MAP` is never touched.
 */
export function injectGroundAir(shader: { fragmentShader: string; uniforms: Record<string, unknown> }, air: AirGroundUniforms): boolean {
  const fs = shader.fragmentShader;
  for (const a of AIR_GROUND_ANCHORS) if (timesIn(fs, a) !== 1) return false;
  if (timesIn(fs, TILE_MAP) !== 1) return false;
  if (timesIn(fs, TILE_ALBEDO_LINE) !== 1 || fs.indexOf(TILE_ALBEDO_LINE) > fs.indexOf('#include <color_fragment>')) return false;
  for (const g of TILE_GLOBALS_READ) if (!fs.includes(g)) return false;
  let f = fs.replace(GROUND_DECLS_END, `${AIR_GROUND_PARS}${GROUND_DECLS_END}`);
  f = afterChunk(f, '#include <map_fragment>', AIR_GROUND_MAP);
  f = afterChunk(f, '#include <color_fragment>', AIR_GROUND_COLOUR);
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
 * own (a striped picture, a constant pair of phase offsets and phases, a constant picture of ours, a constant dent, a
 * light pass's depth), and hold the pixels to the plain ground and to the mirrors (`airMath.ts`): at every dial nought
 * the variant is the plain ground to the bit, lit and unlit; at the sand's dial one, under an ambient light alone, each
 * layer takes `sandOverlay` of the strength, grains and patches the mirrors work out from those inputs at its own
 * coverage (one, nought and a half: the middle layer, which does not blow, the plain ground to the bit); the dent darkens
 * by `dentDarken`'s factor; the dust's shadow takes `dustShade`'s share of a sun alone at `exp(−τ)`. Console only: it
 * builds the programs of its own scenes and allocates as it likes.
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
  // The air's inputs: a constant pair of phase offsets, scaled so the carry they stand for sits halfway between where
  // the streaks begin and where they are full (so the strength is on its slope, and a change to either phase's weighting
  // -- phase A in the first half of its cycle, phase B in its second -- moves the pixels; at a strength held full it could
  // not), a constant picture of ours, a constant dent, the layers' response (sand that blows, rock that does not, a half
  // that does) and colour, and a light pass's depth at the ground.
  const cycle = 1.6;
  const tA = 0.4;
  const tB = 1.2;
  const S0 = AIR_TUNE.sand;
  const baseA = [0.6, 0];
  const baseB = [0.3, 0.4];
  const scale = (0.5 * (S0.from + S0.full)) / sandStrength(baseA[0], baseA[1], baseB[0], baseB[1], tA, tB, cycle);
  const oA = baseA.map((v) => v * scale);
  const oB = baseB.map((v) => v * scale);
  const dentDepth = 0.02;
  const offsets = new THREE.DataTexture(new Float32Array([oA[0], oA[1], oB[0], oB[1]]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  const dents = new THREE.DataTexture(new Float32Array([dentDepth]), 1, 1, THREE.RedFormat, THREE.FloatType);
  // Row 0 (moves, heals, gives, dust), row 1 the layer's lighter tones as sRGB: a sand that blows whole, a rock that
  // does not, and a ground that blows at a half.
  const sandRow = [240, 200, 140];
  const layers = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255, 0, 255, 0, 0, 128, 255, 128, 255, ...sandRow, 255, 90, 90, 90, 255, ...sandRow, 255]), 3, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  const picture = [200, 220];
  const sand = new THREE.DataTexture(new Uint8Array([picture[0], picture[1], 128, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  const tau = 0.7;
  const light = new THREE.DataTexture(new Float32Array([tau, tau, tau, tau]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  // No sand in the air (the third wave's carried streak): the test's blowing comes from the offsets alone.
  const carry = new THREE.DataTexture(new Float32Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  for (const t of [offsets, dents, layers, light, sand, carry]) {
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
  }
  const S = AIR_TUNE.sand;
  const opacity = 0.6;
  const bright = 1.25;
  const air: AirGroundUniforms = {
    uAirOffsets: { value: offsets },
    uAirCarry: { value: carry },
    uAirDents: { value: dents },
    uAirLayers: { value: layers },
    uAirLight: { value: light },
    uAirSand: { value: sand },
    uAirWindow: { value: new THREE.Vector4(-1000, -1000, 2000, 1.5) },
    uAirArt: { value: new THREE.Vector4(0, 0, 0, 1) },
    uAirDentP: { value: new THREE.Vector4(-64, -64, 128, AIR_TUNE.prints.squareEdge) },
    uAirDentQ: { value: new THREE.Vector4(1, 128, 0, 0) },
    uAirShift: { value: new THREE.Vector4() },
    uAirMisc: { value: new THREE.Vector4(AIR_TUNE.window.edge, AIR_TUNE.ground.darkenScale, AIR_TUNE.ground.darkening, AIR_TUNE.ground.shade) },
    uAirPhase: { value: new THREE.Vector4(tA, tB, 0, 1 / cycle) },
    uAirJitter: { value: new THREE.Vector4(0.25, 0.5, 0.75, 0.125) },
    // A picture a kilometre a repeat, so the footprint's fade takes nothing in the test's small strip.
    uAirSandP: { value: new THREE.Vector4(opacity, bright, 1000, S.streak) },
    uAirSandQ: { value: new THREE.Vector4(S.from, S.full, S.grains, Math.max(S.soft, 1e-3)) },
    uAirSandR: { value: new THREE.Vector4(S.flatten, S.fadeFrom / SAND_PICTURE, S.fadeTo / SAND_PICTURE, Math.max(S.patches, 1e-3)) },
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
  const compare = (name: string, want: string, a: Uint16Array, b: Uint16Array, tile: number | null, f: (plain: number, ch: number) => number): void => {
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
        for (let ch = 0; ch < 3; ch++) here = Math.max(here, Math.abs(THREE.DataUtils.fromHalfFloat(a[at + ch]) - f(THREE.DataUtils.fromHalfFloat(b[at + ch]), ch)));
        if (here > 0) differing++;
        if (here > worst) worst = here;
        pixels++;
      }
    }
    runs.push({ name, pixels, differing, worst: Number(worst.toFixed(5)), want });
  };
  // The weather's wet look and snow are laid after the sand and change it by more than a multiply: held at a dry day
  // for the test's draws, and put back after.
  const WU = WEATHER_UNIFORMS;
  const weather = [WU.uWetness.value, WU.uPuddles.value, WU.uRain.value, WU.uSnowCover.value];
  WU.uWetness.value = 0;
  WU.uPuddles.value = 0;
  WU.uRain.value = 0;
  WU.uSnowCover.value = 0;
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
    // 2. The blowing sand at one, under an ambient light alone (which draws the albedo as it is): each layer the plain
    // ground laid over by the mirrors' sand at its coverage. The strength and the grains from the inputs, as the shader
    // works them out; the colour the layer's row decoded, times the tint (off here: one), times the brightness.
    u.uGroundLook.value.z = 0;
    const pa = draw('ambient', 'plain');
    air.uAirArt.value.set(1, 0, 0, 1);
    const qSand = draw('ambient', 'variant');
    const speed = sandStrength(oA[0], oA[1], oB[0], oB[1], tA, tB, cycle);
    const strength = smoothstep(S.from, S.full, speed);
    const p = picture.map((b) => sandBlend(b / 255, b / 255, tA / cycle));
    const alpha = sandAlpha(1, opacity, strength, p[0], p[1], S);
    const decode = (b: number): number => {
      const c = b / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const coverage = [1, 0, 128 / 255];
    for (let tile = 0; tile < 3; tile++) {
      const cov = coverage[tile];
      const colour = sandRow.map((b) => decode(b) * bright);
      compare(`the blowing sand at one, a layer that blows ${cov.toFixed(2)} (strength ${strength.toFixed(3)}, alpha ${alpha.toFixed(4)})`,"the plain ground laid over by sandOverlay at the mirrors' alpha and the layer's coverage", qSand, pa, tile, (x, ch) => sandOverlay(x, alpha, cov, colour[ch], 1));
    }
    air.uAirArt.value.set(0, 0, 0, 1);
    // 3. The prints at one: a constant dent darkens by the mirror's factor (no slope, so no bend), an ambient light alone.
    air.uAirArt.value.set(0, 1, 0, 1);
    const qa = draw('ambient', 'variant');
    compare('the prints at one, a constant dent', `the plain ground times dentDarken (${dentDarken(1, dentDepth, 1).toFixed(4)})`, qa, pa, null, (x) => dentDarken(x, dentDepth, 1));
    // 4. The shade at one: a sun alone, the light pass's depth at the ground read as exp(−τ).
    air.uAirArt.value.set(0, 0, 1, 1);
    const ps = draw('sun', 'plain');
    const qs = draw('sun', 'variant');
    const T = shadeTransmittance(tau);
    compare(`the shade at one, a depth of ${tau} toward the sun`, `the plain ground times dustShade (${dustShade(1, T, 1, 1).toFixed(4)})`, qs, ps, null, (x) => dustShade(x, T, 1, 1));
  } finally {
    WU.uWetness.value = weather[0];
    WU.uPuddles.value = weather[1];
    WU.uRain.value = weather[2];
    WU.uSnowCover.value = weather[3];
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clearColour, clearAlpha);
    plain.dispose();
    variant.dispose();
    geometry.dispose();
    for (const t of [colour, offsets, carry, dents, layers, light, sand, u.uGroundBump.value, u.uGroundMask.value, u.uGroundClouds.value]) t.dispose();
    ambient.dispose();
    sun.dispose();
    rt.dispose();
  }
  // Nought is to the bit; the rest within a few half-float steps of linear colour (the two programs reach the same uv
  // by different arithmetic, a last bit apart).
  // The layer that does not blow is the plain ground to the bit as well (nothing is written over it).
  const zeroOk = runs.slice(0, 3).every((r) => r.worst === 0 && r.pixels > 0) && runs[4].worst === 0;
  const restOk = runs.slice(3).every((r) => r.worst < 4e-3 && r.pixels > 0);
  return {
    ok: zeroOk && restOk && builtOnKnobs === 0,
    runs,
    builtOnKnobs,
    note: "every pixel a texel's breadth inside its tile, linear colour: at every dial nought the variant is the plain ground to the bit, lit and unlit, and so is a layer the sand does not blow over; at the sand's dial one each layer is airMath's sandOverlay of the strength, grains and patches the mirrors work out at its coverage; the dent's darkening and the dust's shadow the mirrors' factors (dentDarken, dustShade at exp(-τ)), each within 0.004; and no program built as the dials moved",
  };
}