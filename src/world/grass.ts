// The terrain's radial flora drawn (materials and ground pass, waves 5b and 5c): the grass, flowers, reeds and
// ferns round the eye, and the flat tree cards on the far hills beyond the trees we draw (`grassMath.ts` places
// them; the `radial` pass converted their pictures, `radialFile.ts`).
//
// **One material for every tuft and every far card** of every world: a `ShaderMaterial` taking no light of
// three's, made once a session and handed each world's pictures as a uniform, so a travel builds no program. It
// is lit **per vertex by the client's own sum** -- the card light's front, tangent and back colours about the
// sun's axis, its ambient and its two plain parallel lights, the very uniform objects `updateCardLight` writes --
// by the ground's normal at the tuft's foot (ours: the client's is not known), times the colour map's tint, and
// carried back through three's tone curve as a leaf card is (`'client'`), so a tuft shows the client's bytes. The
// client's grass program read the same sum with its per-pixel flag off (read). Our torch and the flash pool do
// not light grass: a material that takes no scene lights cannot see them, which is the price of keeping its key
// still. Three keys every program on the light counts all the same (`WebGLPrograms`, whatever `lights` says),
// and the grass is drawn only in the world's own pass, whose light set never changes, so the one program the
// loading screen builds from a stand-in is the one every frame draws.
//
// **Facing and fading**: a plain tuft turns about its up (the vertical, or the ground's normal where its child is
// aligned) to face the eye (answer 8, the client's); a crossed child is two fixed quads, each flipped to show its
// front to the eye, since the material draws one side and a fixed quad seen from behind would be culled. Across the reach's outer
// band a tuft shrinks to nothing about its foot (answer 9: it fades; a dither would be a stipple with nothing to
// steady it); past the reach it is collapsed to a point outside the view, costing vertices and never fragments.
//
// **Sway**: the trees' own function and their shared uniforms (`swayMath.ts`), the wind, the clock and the eye,
// with a model's two uniforms declared here as plain globals written per tuft: a flagged child's displacement
// times `GRASS_SWAY.amp` as the amplitude, else the trees' law by height; the weight the tuft's height fraction
// squared; added in the world after the facing. A far card is past the sway's fade and does not move.
//
// **Where it hangs**: a near chunk's grass is one mesh under that chunk's own group (so it is hidden with its
// ground, `groundHiddenFor`, and goes with it), built when the chunk is in the window round the eye and taken down
// when it leaves; a far tile's cards are one mesh under the ground's root, offered to the exit narrowing, shown
// only where our own trees are not (no near chunk stands there, or one stands with its trees hidden by a short
// Tree distance, where the card is lifted back onto the coarse height) and out to the far tiling's end. Layer 0
// only, never a room's; dry; only uniforms change per frame, and a frame that crosses no chunk does nothing.
//
// **Shadows** (wave 8, all ours: the client's grass cast none and sampled none). It *takes* the sun's shadow by
// reading the cascades itself by the ambient occlusion's own arithmetic (`grassShadowMath.ts`): the vertex stage
// hands over the point lifted toward the sun, so a tuft never shades itself, and its depth along the view, and the
// fragment stage makes the one lookup and lowers the card sum's front term toward the tangent as a shaded leaf's
// is, since a shadow compare made in the vertex stage lost the WebGL context under ANGLE on the owner's card;
// `lights` stays false and the program keeps its one key. It *casts* (off by default)
// through one depth material of the session made from this very vertex text (`SWG_GRASS_DEPTH`), measuring from
// the sway's eye, since in a shadow pass `cameraPosition` is the cascade's camera; a near mesh casts only while its
// chunk is within the reach and only into the cascades whose near edge the reach reaches, which is its instance
// count set to nought for one draw (the cascade is the shadow hooks' fourth argument; the third is the probe).
//
// `localStorage['swg.grass'] = '0'` turns the grass off at load, `swg.farCards = '0'` the far cards.
import * as THREE from 'three';
import type { FloraTiling } from '../swg/terrain/trn.ts';
import { RADIAL_JSON, RADIAL_RGBA, readRadialFile, type RadialFile } from '../swg/terrain/radialFile.ts';
import { CARD_CURVE_PARS, CARD_LIGHT_UNIFORMS } from './cardLight.ts';
import { SWAY_TUNE, SWAY_UNIFORMS } from './floraSway.ts';
import { SSAO_CSM_FADE_MARGIN } from '../core/fx/ssaoMath.ts';
import {
  FAR_CARD_DEFAULTS, GRASS_DEFAULTS, GRASS_SHADOW_TUNE, GRASS_SWAY_DEFAULTS, TUFT_HIDDEN, TUFT_LIFT, candidateCapacity, farReach, grassReach, grassWindowFor, placeFarCards, placeGrass, placeStats, trimBuffers, tuftBuffers,
  type FarCardTune, type FarSamples, type FloraCircle, type GrassSource, type GrassSway, type GrassTune, type GrassWorld, type PlaceStats, type TuftBuffers,
} from './grassMath.ts';
import { COLOUR_MODES, GROUND_DRAW_TUNE, groundChunkAt, groundChunkOrigin, type GroundShift } from './groundTiles.ts';
import { SWAY_FUNCTIONS, SWAY_SHARED_PARS } from './swayMath.ts';

export type { FarCardTune, GrassSway, GrassTune } from './grassMath.ts';

function stored(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** False when localStorage 'swg.grass' is '0' (read once, at load): no grass is placed or drawn this session. */
export const GRASS_ON: boolean = stored('swg.grass') !== '0';
/** False when localStorage 'swg.farCards' is '0' (read once, at load). */
export const FAR_CARDS_ON: boolean = stored('swg.farCards') !== '0';

/** The knobs (`__debug.grass`, `__debug.farCards`). */
export const GRASS_TUNE: GrassTune = { ...GRASS_DEFAULTS };
export const GRASS_SWAY: GrassSway = { ...GRASS_SWAY_DEFAULTS };
export const FAR_CARD_TUNE: FarCardTune = { ...FAR_CARD_DEFAULTS };

/** The game place of a 64 m chunk's grass and the far tiles' size: the world's own, handed over so this file needs nothing of `world.ts`. */
export const GRASS_CHUNK = 64;

// ---------------------------------------------------------------- the program

/** A number as GLSL writes a float. */
const glslFloat = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

/**
 * The vertex stage: placing, facing, fading, swaying and lighting a tuft, and where the fragment stage looks its
 * shadow up. With `SWG_GRASS_DEPTH` defined it
 * is the casting program's (`grassDepthMaterial`): it measures from the sway's eye, may face across the sun,
 * collapses what does not cast, and leaves out the light and the shadow it would otherwise read.
 */
export const GRASS_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${SWAY_SHARED_PARS}
// A model's own two, written per tuft (swayMath.ts): one call of the trees' own function a vertex.
vec4 uSwayShape;
vec4 uSwayAxis;
${SWAY_FUNCTIONS}
// The eye a tuft is faced to, faded by and flipped toward: the view camera. In a shadow pass the camera three hands a
// program is the cascade's own, far off toward the sun, so the casting program measures from the sway's eye, which the
// world writes once a frame from the view camera.
#ifdef SWG_GRASS_DEPTH
	#define SWG_GRASS_EYE uSwayEye
#else
	#define SWG_GRASS_EYE cameraPosition
#endif
uniform vec3 uSwgCardFront;
uniform vec3 uSwgCardTangent;
uniform vec3 uSwgCardBack;
uniform vec3 uSwgCardAmbient;
uniform vec3 uSwgCardFill;
uniform vec3 uSwgCardBounce;
uniform vec3 uSwgCardFillDir;
uniform vec3 uSwgCardBounceDir;
uniform float uSwgCardFills;
uniform float uSwgCardGain;
uniform vec3 uSwgLeafSun;
// x the near reach, y its band (a share), z the far reach, w its band.
uniform vec4 uSwgGrassReach;
// x the facing (0 the eye, 1 fixed), y the fade (0 shrink, 1 dither, 2 the child's distance), z metres a flagged displacement, w the child's own sway (1) or the law (0).
uniform vec4 uSwgGrassMode;
// x the grass shown, y the far cards shown.
uniform vec2 uSwgGrassShow;
// Metres a far card shown over a near chunk is lifted by: back onto the coarse height the far tile it was dropped for stood on.
uniform float uSwgGrassFarLift;
#ifdef SWG_GRASS_DEPTH
// x near grass casts, y the far cards cast, z a casting tuft faces across the sun (1) rather than the eye (0).
uniform vec3 uSwgGrassCast;
#else
// What the fragment stage needs to read the sun's shadow (GRASS_SHADOW_PARS): where each corner looks it up, lifted
// toward the sun, and its linear depth, interpolated across the quad; and the light in two parts, the front term's
// share apart, so the shade can lower it there.
uniform float uSwgGrassShadowRange;
// x the cascades readable, y the lift (a share of the tuft's larger side), z the shadow's intensity.
uniform vec3 uSwgGrassShadowOn;
// x near grass takes the shadow, y the far cards do.
uniform vec2 uSwgGrassReceive;
varying vec3 vSwgLightSun;
varying vec3 vSwgShadowPos;
varying float vSwgShadowLd;
varying float vSwgReceive;
#endif
attribute vec4 aSwgTuft;
attribute vec4 aSwgSize;
attribute vec4 aSwgTint;
attribute vec4 aSwgSway;
attribute vec3 aSwgNormal;
varying vec3 vSwgUv;
varying vec3 vSwgLight;
varying vec3 vSwgTint;
varying float vSwgRef;
varying float vSwgFade;
varying float vSwgGlow;
void main() {
	int swgFlags = int( aSwgSize.w + 0.5 );
	bool swgFar = ( swgFlags & 4 ) != 0;
	bool swgPlus = ( swgFlags & 1 ) != 0;
	bool swgSecond = position.z > 0.5;
	vec3 swgBase = aSwgTuft.xyz;
	if ( swgFar && ( swgFlags & 64 ) != 0 ) swgBase.y += uSwgGrassFarLift;
	float swgDist = distance( swgBase, SWG_GRASS_EYE );
	float swgScale = 1.0;
	float swgFade = 1.0;
	if ( swgFar ) {
		float swgReach = uSwgGrassReach.z;
		float swgBand = max( swgReach * uSwgGrassReach.w, 1e-3 );
		swgScale = 1.0 - smoothstep( swgReach - swgBand, swgReach, swgDist );
		if ( ( swgFlags & 8 ) != 0 || uSwgGrassShow.y < 0.5 ) swgScale = 0.0;
	} else {
		float swgReach = uSwgGrassReach.x;
		if ( uSwgGrassMode.y > 1.5 ) swgReach = min( swgReach, aSwgSway.z );
		float swgBand = max( swgReach * uSwgGrassReach.y, 1e-3 );
		float swgEdge = 1.0 - smoothstep( swgReach - swgBand, swgReach, swgDist );
		if ( uSwgGrassMode.y > 0.5 && uSwgGrassMode.y < 1.5 ) {
			swgFade = swgEdge;
			swgScale = swgDist < swgReach ? 1.0 : 0.0;
		} else swgScale = swgEdge;
		if ( uSwgGrassShow.x < 0.5 ) swgScale = 0.0;
	}
	#ifdef SWG_GRASS_DEPTH
		// What does not cast is collapsed as what is out of reach is: no fragment in the shadow map.
		if ( swgFar ? uSwgGrassCast.y < 0.5 : uSwgGrassCast.x < 0.5 ) swgScale = 0.0;
	#endif
	vSwgUv = vec3( position.x + 0.5, 1.0 - position.y, aSwgSize.z );
	vSwgTint = aSwgTint.rgb;
	vSwgRef = aSwgTint.a;
	vSwgFade = swgFade;
	vSwgGlow = ( swgFlags & 16 ) != 0 ? 1.0 : 0.0;
	vSwgLight = vec3( 1.0 );
	#ifndef SWG_GRASS_DEPTH
		vSwgLightSun = vec3( 0.0 );
		vSwgShadowPos = vec3( 0.0 );
		vSwgShadowLd = 0.0;
		vSwgReceive = 0.0;
	#endif
	if ( swgScale <= 0.0 || ( swgSecond && ! swgPlus ) ) {
		// Out of reach, hidden, or the second quad of a tuft that has none: collapsed outside the view, no fragments.
		gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
		#ifdef USE_FOG
			vFogDepth = 0.0;
		#endif
		return;
	}
	vec3 swgN = normalize( aSwgNormal );
	vec3 swgUp = ( swgFlags & 2 ) != 0 ? swgN : vec3( 0.0, 1.0, 0.0 );
	vec3 swgRight;
	if ( swgPlus || uSwgGrassMode.x > 0.5 ) {
		float swgYaw = aSwgTuft.w + ( swgSecond ? 1.5707963 : 0.0 );
		swgRight = vec3( cos( swgYaw ), 0.0, - sin( swgYaw ) );
	} else {
		vec3 swgToward = SWG_GRASS_EYE - swgBase;
		#ifdef SWG_GRASS_DEPTH
			// Across the sun, to compare: the shadow then stays still as the eye goes round, but is no longer the quad drawn.
			if ( uSwgGrassCast.z > 0.5 ) swgToward = uSwgLeafSun;
		#endif
		swgRight = cross( swgUp, swgToward );
		float swgLen = length( swgRight );
		swgRight = swgLen > 1e-4 ? swgRight / swgLen : vec3( cos( aSwgTuft.w ), 0.0, - sin( aSwgTuft.w ) );
	}
	swgRight = swgRight - swgUp * dot( swgRight, swgUp );
	float swgAcross = length( swgRight );
	swgRight = swgAcross > 1e-5 ? swgRight / swgAcross : vec3( 1.0, 0.0, 0.0 );
	// A quad of a fixed turn (a crossed child's two, every tuft under the 'fixed' knob) shows its front to the eye:
	// the material draws one side, so seen from behind its right is flipped, which also keeps the picture the right
	// way round. A quad turned to the eye already faces it and is never flipped.
	if ( dot( cross( swgRight, swgUp ), SWG_GRASS_EYE - swgBase ) < 0.0 ) swgRight = - swgRight;
	vec3 swgP = swgBase + swgRight * ( position.x * aSwgSize.x * swgScale ) + swgUp * ( position.y * aSwgSize.y * swgScale );
	// Sway: the trees' function, this tuft as its model (a height giving its amplitude, no canopy base, no flutter).
	float swgDisp = aSwgSway.x;
	bool swgChild = swgDisp >= 0.0 && uSwgGrassMode.w > 0.5;
	float swgH = max( aSwgSize.y, 1e-3 );
	if ( swgChild ) {
		float swgAmp = swgDisp * uSwgGrassMode.z / max( uSwayTune.x, 1e-6 );
		swgH = max( swgAmp * swgAmp, 1e-6 );
	}
	uSwayShape = vec4( swgH, 0.0, 1e6, swgDisp < -1.5 ? 0.0 : 1.0 );
	uSwayAxis = vec4( 0.0, 0.0, swgChild ? aSwgSway.y : aSwgSway.w, 0.0 );
	mat4 swgModel = mat4( 1.0 );
	swgModel[ 3 ] = vec4( swgBase, 1.0 );
	swgP += swgSwayOffset( vec3( 0.0, position.y * swgH, 0.0 ), swgModel ) * swgScale;
	vec4 mvPosition = viewMatrix * vec4( swgP, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	#ifndef SWG_GRASS_DEPTH
		// Where the corner looks the sun's shadow up, lifted toward the sun by a share of the tuft's larger side (the
		// texel a trunk's shadow falls on stays, and the tuft's own quads never shade it), and its linear depth. The
		// lookup itself is the fragment stage's: a shadow compare in a vertex stage lost the WebGL context under ANGLE.
		if ( uSwgGrassShadowOn.x > 0.5 && ( swgFar ? uSwgGrassReceive.y : uSwgGrassReceive.x ) > 0.5 ) {
			vSwgShadowPos = swgP + uSwgLeafSun * ( uSwgGrassShadowOn.y * max( aSwgSize.x, aSwgSize.y ) * swgScale );
			vSwgShadowLd = - mvPosition.z / max( uSwgGrassShadowRange, 1e-3 );
			vSwgReceive = 1.0;
		}
		// The client's sum at the tuft, by the ground's normal: the ramp about the sun's axis, the ambient, the two
		// fills. Handed on in two parts: everything with the front term at the tangent, and the front term's share
		// apart (vSwgLightSun), which the shade lowers toward the tangent as a shaded leaf's (cardLight.ts), or which
		// under the 'row7' look stays whole while the fragment lays the shadow row over it.
		float swgD = clamp( dot( swgN, uSwgLeafSun ), -1.0, 1.0 );
		vec3 swgMain = swgD >= 0.0 ? uSwgCardTangent : mix( uSwgCardTangent, uSwgCardBack, - swgD );
		vSwgLightSun = swgD >= 0.0 ? ( uSwgCardFront - uSwgCardTangent ) * swgD : vec3( 0.0 );
		vec3 swgSum = uSwgCardAmbient + swgMain;
		if ( uSwgCardFills > 0.5 ) swgSum += uSwgCardFill * max( dot( swgN, normalize( uSwgCardFillDir ) ), 0.0 );
		if ( uSwgCardFills > 1.5 ) swgSum += uSwgCardBounce * max( dot( swgN, normalize( uSwgCardBounceDir ) ), 0.0 );
		vSwgLight = swgSum;
	#endif
	#include <fog_vertex>
}
`;

/**
 * The sun's shadow on a tuft, read in the fragment stage by the ambient occlusion's own arithmetic (`grassShadowMath.ts`
 * is its mirror): how much of the shadow a fragment at linear depth `ld` takes (the AO's `cascadeKeep`, three's CSM
 * margin over the last cascade's far end), the cascade it falls in, one hardware compare at the point the vertex stage
 * lifted toward the sun, a texel off the map or past its far plane lit.
 */
export const GRASS_SHADOW_PARS = /* glsl */ `
uniform sampler2DShadow uSwgGrassShadow0;
uniform sampler2DShadow uSwgGrassShadow1;
uniform sampler2DShadow uSwgGrassShadow2;
uniform mat4 uSwgGrassShadowMatrix[ 3 ];
// Each cascade's start and end as shares of the range.
uniform vec2 uSwgGrassCascade[ 3 ];
uniform float uSwgGrassCascadeFade;
uniform vec3 uSwgGrassShadowBias;
// x the cascades readable, y the lift, z the shadow's intensity.
uniform vec3 uSwgGrassShadowOn;
varying vec3 vSwgShadowPos;
varying float vSwgShadowLd;
varying float vSwgReceive;
float swgGrassShadow( const in vec3 swgL, const in float swgLd ) {
	float swgX = uSwgGrassCascade[ 2 ].x;
	float swgY = uSwgGrassCascade[ 2 ].y;
	float swgKeep = 1.0;
	if ( uSwgGrassCascadeFade < 0.5 ) swgKeep = swgLd < swgY ? 1.0 : 0.0;
	else if ( swgLd > 0.5 * ( swgX + swgY ) ) {
		float swgM = max( ${glslFloat(SSAO_CSM_FADE_MARGIN)} * swgY * swgY, 1e-6 );
		swgKeep = clamp( min( swgLd - ( swgX - 0.5 * swgM ), swgY + 0.5 * swgM - swgLd ) / swgM, 0.0, 1.0 );
	}
	if ( swgKeep <= 0.0 ) return 1.0;
	int swgI = swgLd < uSwgGrassCascade[ 0 ].y ? 0 : ( swgLd < uSwgGrassCascade[ 1 ].y ? 1 : 2 );
	vec4 swgS = uSwgGrassShadowMatrix[ swgI ] * vec4( swgL, 1.0 );
	swgS.xyz /= swgS.w;
	swgS.z += uSwgGrassShadowBias[ swgI ];
	if ( swgS.x < 0.0 || swgS.x > 1.0 || swgS.y < 0.0 || swgS.y > 1.0 || swgS.z > 1.0 ) return 1.0;
	float swgLit = swgI == 0 ? textureLod( uSwgGrassShadow0, swgS.xyz, 0.0 ) : ( swgI == 1 ? textureLod( uSwgGrassShadow1, swgS.xyz, 0.0 ) : textureLod( uSwgGrassShadow2, swgS.xyz, 0.0 ) );
	return mix( 1.0, swgLit, uSwgGrassShadowOn.z * swgKeep );
}
`;

/**
 * The fragment stage: the picture cut at its reference, its mip scale, the sun's shadow (after the cut, so a fragment
 * thrown away reads none), the tint and the light in the client's bytes, carried back through the curve.
 * `SWG_GRASS_PROBE` writes the shade alone, ahead of the picture (the self-test's probe, `grassSelfTest.ts`).
 */
export const GRASS_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2DArray uSwgGrassMap;
uniform float uSwgGrassSize;
// x the cut, y the mip scale, z the dither's switch.
uniform vec3 uSwgGrassCut;
// x the tint mode as the ground numbers them (0 off, 1 the client's, 2 normalised, 3 per channel), y the world's luminance, z the gain cap.
uniform vec3 uSwgGrassTint;
uniform vec3 uSwgGrassTintRef;
uniform float uSwgCardCurve;
uniform float uSwgCardExposureRef;
uniform float uSwgCardBloomCap;
uniform float uSwgCardShadowLook;
uniform vec3 uSwgCardRow7;
uniform float uSwgCardRow7Alpha;
uniform float uSwgCardGain;
${CARD_CURVE_PARS}${GRASS_SHADOW_PARS}
varying vec3 vSwgUv;
varying vec3 vSwgLight;
varying vec3 vSwgLightSun;
varying vec3 vSwgTint;
varying float vSwgRef;
varying float vSwgFade;
varying float vSwgGlow;
vec3 swgGrassTint( const in vec3 swgC ) {
	if ( uSwgGrassTint.x < 0.5 ) return vec3( 1.0 );
	if ( uSwgGrassTint.x < 1.5 ) return swgC;
	if ( uSwgGrassTint.x < 2.5 ) {
		float swgLum = dot( swgC, vec3( 0.2126, 0.7152, 0.0722 ) );
		float swgGain = min( 1.0 / max( uSwgGrassTint.y, 1e-3 ), uSwgGrassTint.z / max( swgLum, 1e-6 ) );
		return swgC * swgGain;
	}
	return min( swgC / max( uSwgGrassTintRef, vec3( 1e-3 ) ), vec3( uSwgGrassTint.z ) );
}
void main() {
	#ifdef SWG_GRASS_PROBE
		float swgProbe = vSwgReceive > 0.5 ? swgGrassShadow( vSwgShadowPos, vSwgShadowLd ) : 1.0;
		gl_FragColor = vec4( swgProbe, swgProbe, swgProbe, 1.0 );
		return;
	#endif
	vec4 swgTexel = texture( uSwgGrassMap, vSwgUv );
	vec2 swgDx = dFdx( vSwgUv.xy ) * uSwgGrassSize;
	vec2 swgDy = dFdy( vSwgUv.xy ) * uSwgGrassSize;
	float swgLod = 0.5 * log2( max( max( dot( swgDx, swgDx ), dot( swgDy, swgDy ) ), 1e-12 ) );
	float swgAlpha = min( 1.0, swgTexel.a * ( 1.0 + uSwgGrassCut.y * max( 0.0, swgLod ) ) );
	if ( swgAlpha < max( vSwgRef, uSwgGrassCut.x ) ) discard;
	if ( uSwgGrassCut.z > 0.5 && vSwgFade < 1.0 ) {
		float swgNoise = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
		if ( swgNoise > vSwgFade ) discard;
	}
	// The sun's shadow here, and the front term's share lowered toward the tangent by it (or, under the 'row7' look,
	// kept whole and the shadow row laid over the display value below), as a shaded leaf's is.
	float swgShade = vSwgReceive > 0.5 ? swgGrassShadow( vSwgShadowPos, vSwgShadowLd ) : 1.0;
	float swgRise = uSwgCardShadowLook > 0.5 ? 1.0 : swgShade;
	vec3 swgLight = vSwgGlow > 0.5 ? vec3( 1.0 ) : clamp( ( vSwgLight + vSwgLightSun * swgRise ) * uSwgCardGain, 0.0, 1.0 );
	vec3 swgTint = vSwgGlow > 0.5 ? vec3( 1.0 ) : swgGrassTint( vSwgTint );
	vec3 swgDisplay = clamp( swgTexel.rgb * swgTint * swgLight, 0.0, 1.0 );
	// The 'row7' look: a shaded tuft blended toward the ramp's shadow row in the client's bytes, as a leaf card is.
	if ( uSwgCardShadowLook > 0.5 && vSwgGlow < 0.5 ) swgDisplay = mix( swgDisplay, uSwgCardRow7, uSwgCardRow7Alpha * ( 1.0 - clamp( swgShade, 0.0, 1.0 ) ) );
	vec3 swgColour;
	if ( uSwgCardCurve < 0.5 ) {
		swgColour = swgAcesInverse( swgCardToLinear( swgDisplay ) ) / max( uSwgCardExposureRef, 1e-3 );
		float swgCardLum = dot( swgColour, vec3( 0.2126, 0.7152, 0.0722 ) );
		if ( swgCardLum > uSwgCardBloomCap ) swgColour *= uSwgCardBloomCap / swgCardLum;
	} else swgColour = swgCardToLinear( swgDisplay );
	gl_FragColor = vec4( swgColour, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}
`;

/**
 * The casting program's fragment stage: the colour stage's picture, mip raise and cut (at the shadow's own cut), and
 * nothing else. A PCF map stores depth alone, so the colour written is never read; it never names a shadow sampler,
 * since it draws into one.
 */
export const GRASS_DEPTH_FRAGMENT = /* glsl */ `
uniform sampler2DArray uSwgGrassMap;
uniform float uSwgGrassSize;
// x the cut (the colour's), y the mip scale, z the dither's switch.
uniform vec3 uSwgGrassCut;
uniform float uSwgGrassCastCut;
varying vec3 vSwgUv;
varying float vSwgRef;
void main() {
	vec4 swgTexel = texture( uSwgGrassMap, vSwgUv );
	vec2 swgDx = dFdx( vSwgUv.xy ) * uSwgGrassSize;
	vec2 swgDy = dFdy( vSwgUv.xy ) * uSwgGrassSize;
	float swgLod = 0.5 * log2( max( max( dot( swgDx, swgDx ), dot( swgDy, swgDy ) ), 1e-12 ) );
	float swgAlpha = min( 1.0, swgTexel.a * ( 1.0 + uSwgGrassCut.y * max( 0.0, swgLod ) ) );
	if ( swgAlpha < max( vSwgRef, uSwgGrassCastCut ) ) discard;
	gl_FragColor = vec4( 1.0 );
}
`;

/** A one-layer stand-in for the pictures until a world's arrive: a program's sampler must always hold a real texture. */
function blankArray(): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(new Uint8Array([255, 255, 255, 0]), 1, 1, 1);
  t.needsUpdate = true;
  return t;
}

const BLANK = blankArray();

/**
 * What a cascade's shadow sampler holds while the cascades cannot be read (shadows off, a map not drawn yet): a real
 * 1x1 compare texture, never null, because a null shadow sampler binds nothing and the whole draw is dropped (the
 * ambient occlusion's `noShadow`). It is never sampled for an answer: the shadow's switch is off whenever it stands in.
 */
export const GRASS_NO_SHADOW: THREE.DepthTexture = (() => {
  const t = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  t.name = 'grass.noShadow';
  t.compareFunction = THREE.LessEqualCompare;
  t.needsUpdate = true;
  return t;
})();

/** The uniforms of this file's own, kept for the session so every write reaches the one material. */
export const GRASS_UNIFORMS = {
  uSwgGrassMap: { value: BLANK as THREE.DataArrayTexture },
  uSwgGrassSize: { value: 256 },
  uSwgGrassReach: { value: new THREE.Vector4(30, 0.25, 500, 0.1) },
  uSwgGrassMode: { value: new THREE.Vector4(0, 0, 0.5, 1) },
  uSwgGrassShow: { value: new THREE.Vector2(1, 1) },
  uSwgGrassCut: { value: new THREE.Vector3(0.5, 0.1, 0) },
  uSwgGrassTint: { value: new THREE.Vector3(1, 1, 1.6) },
  uSwgGrassTintRef: { value: new THREE.Vector3(1, 1, 1) },
  uSwgGrassFarLift: { value: 0 },
  // The shadow they take (`World.syncGrassShadows` writes them once a frame, the maps and matrices by identity).
  uSwgGrassShadow0: { value: GRASS_NO_SHADOW as THREE.Texture },
  uSwgGrassShadow1: { value: GRASS_NO_SHADOW as THREE.Texture },
  uSwgGrassShadow2: { value: GRASS_NO_SHADOW as THREE.Texture },
  /** The cascades' own `shadow.matrix` objects, by reference: the shadow pass refreshes them inside the very render call whose world pass reads them. */
  uSwgGrassShadowMatrix: { value: [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()] as THREE.Matrix4[] },
  uSwgGrassCascade: { value: new Float32Array(6) },
  uSwgGrassShadowRange: { value: 1 },
  uSwgGrassCascadeFade: { value: 0 },
  uSwgGrassShadowBias: { value: new THREE.Vector3() },
  uSwgGrassShadowOn: { value: new THREE.Vector3(0, 1, 1) },
  uSwgGrassReceive: { value: new THREE.Vector2(1, 1) },
  // What casts, and how.
  uSwgGrassCast: { value: new THREE.Vector3(0, 0, 0) },
  uSwgGrassCastCut: { value: 0.5 },
};

/** A world's pictures into the material, or the blank one back; the pictures before are disposed by whoever loaded them. */
export function setGrassPictures(t: THREE.DataArrayTexture | null): void {
  GRASS_UNIFORMS.uSwgGrassMap.value = t ?? BLANK;
}

/** The material every tuft and far card is drawn with: made once a session (`World` keeps it), never cloned (its uniforms are shared by reference). */
export function grassMaterial(): THREE.ShaderMaterial {
  const c = CARD_LIGHT_UNIFORMS;
  const s = SWAY_UNIFORMS;
  const m = new THREE.ShaderMaterial({
    name: 'grass',
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uSwayWind: s.uSwayWind,
      uSwayTune: s.uSwayTune,
      uSwayTime: s.uSwayTime,
      uSwayEye: s.uSwayEye,
      uSwayFade: s.uSwayFade,
      uSwgCardFront: c.uSwgCardFront,
      uSwgCardTangent: c.uSwgCardTangent,
      uSwgCardBack: c.uSwgCardBack,
      uSwgCardAmbient: c.uSwgCardAmbient,
      uSwgCardFill: c.uSwgCardFill,
      uSwgCardBounce: c.uSwgCardBounce,
      uSwgCardFillDir: c.uSwgCardFillDir,
      uSwgCardBounceDir: c.uSwgCardBounceDir,
      uSwgCardFills: c.uSwgCardFills,
      uSwgCardGain: c.uSwgCardGain,
      uSwgLeafSun: c.uSwgLeafSun,
      uSwgCardCurve: c.uSwgCardCurve,
      uSwgCardExposureRef: c.uSwgCardExposureRef,
      uSwgCardBloomCap: c.uSwgCardBloomCap,
      uSwgCardShadowLook: c.uSwgCardShadowLook,
      uSwgCardRow7: c.uSwgCardRow7,
      uSwgCardRow7Alpha: c.uSwgCardRow7Alpha,
      ...GRASS_UNIFORMS,
    },
    vertexShader: GRASS_VERTEX,
    fragmentShader: GRASS_FRAGMENT,
    fog: true,
  });
  // Unlit and dry: out of the shadow cascades (which never take a ShaderMaterial anyway) and never wrapped by the weather.
  m.userData.unlit = true;
  m.userData.dry = true;
  // A casting tuft's shadow from both of its sides: three hands a depth material its source's `shadowSide`, else the
  // source's side turned over, so a front-only quad would cast from its back alone. Set once, here, since the side
  // is in the depth program's key.
  m.shadowSide = THREE.DoubleSide;
  return m;
}

/**
 * The depth material every casting tuft and far card is drawn into the sun's shadow with (`customDepthMaterial`):
 * made once a session beside `grassMaterial`, from the same vertex text under `SWG_GRASS_DEPTH`, with the same uniform
 * objects by reference, unlit, fogless and dry. Three gives an unlit material its program at its first draw and
 * never changes it with the lights, so one draw behind the first loading screen (`World.compileShadowDepth`) is its
 * program for the session.
 */
export function grassDepthMaterial(): THREE.ShaderMaterial {
  const s = SWAY_UNIFORMS;
  const u = GRASS_UNIFORMS;
  const m = new THREE.ShaderMaterial({
    name: 'grass depth',
    defines: { SWG_GRASS_DEPTH: '' },
    uniforms: {
      uSwayWind: s.uSwayWind,
      uSwayTune: s.uSwayTune,
      uSwayTime: s.uSwayTime,
      uSwayEye: s.uSwayEye,
      uSwayFade: s.uSwayFade,
      uSwgLeafSun: CARD_LIGHT_UNIFORMS.uSwgLeafSun,
      uSwgGrassMap: u.uSwgGrassMap,
      uSwgGrassSize: u.uSwgGrassSize,
      uSwgGrassReach: u.uSwgGrassReach,
      uSwgGrassMode: u.uSwgGrassMode,
      uSwgGrassShow: u.uSwgGrassShow,
      uSwgGrassCut: u.uSwgGrassCut,
      uSwgGrassFarLift: u.uSwgGrassFarLift,
      uSwgGrassCast: u.uSwgGrassCast,
      uSwgGrassCastCut: u.uSwgGrassCastCut,
    },
    vertexShader: GRASS_VERTEX,
    fragmentShader: GRASS_DEPTH_FRAGMENT,
    fog: false,
    lights: false,
  });
  m.toneMapped = false;
  m.userData.unlit = true;
  m.userData.dry = true;
  return m;
}

/** What casts and how, and the shadow's own cut, into the uniforms (`GRASS_SHADOW_TUNE`). Uniforms only. */
export function writeGrassShadowUniforms(): void {
  const t = GRASS_SHADOW_TUNE;
  const u = GRASS_UNIFORMS;
  u.uSwgGrassCast.value.set(GRASS_ON && GRASS_TUNE.on && t.cast ? 1 : 0, FAR_CARDS_ON && FAR_CARD_TUNE.on && t.farCast ? 1 : 0, t.castFacing === 'sun' ? 1 : 0);
  u.uSwgGrassCastCut.value = t.castCut;
  u.uSwgGrassReceive.value.set(t.receive ? 1 : 0, t.farReceive ? 1 : 0);
  u.uSwgGrassShadowOn.value.y = t.lift;
}

/** The quads a tuft is drawn with: two, the second crossed, each a metre wide about x nought and a metre tall from its foot. */
function tuftQuads(g: THREE.InstancedBufferGeometry): void {
  // position.z says which quad: nought the first, one the crossed second.
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0, -0.5, 0, 1, 0.5, 0, 1, 0.5, 1, 1, -0.5, 1, 1]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
}

/**
 * One mesh of tufts from filled buffers: a geometry of its own (never sharing an attribute, which a dispose would
 * free under another), its sphere over every tuft. It hangs the casting depth material whether or not it casts
 * (free while it does not), and casts from the moment it is made as the tune says: a far tile's cards by
 * `farCast`, a near chunk's not until its field's `applyCast` finds it in reach, since every mesh a chunk or tile
 * builds is made here and a switch applied only on a toggle would be lost at the next build.
 */
export function tuftMesh(b: TuftBuffers, material: THREE.Material, depth: THREE.Material | null = null, far = false): THREE.Mesh {
  const g = new THREE.InstancedBufferGeometry();
  tuftQuads(g);
  g.setAttribute('aSwgTuft', new THREE.InstancedBufferAttribute(b.tuft, 4));
  g.setAttribute('aSwgSize', new THREE.InstancedBufferAttribute(b.size, 4));
  g.setAttribute('aSwgTint', new THREE.InstancedBufferAttribute(b.tint, 4));
  g.setAttribute('aSwgSway', new THREE.InstancedBufferAttribute(b.sway, 4));
  g.setAttribute('aSwgNormal', new THREE.InstancedBufferAttribute(b.normal, 3));
  g.instanceCount = b.count;
  // The sphere three culls the mesh by: every tuft's foot, grown by the tallest and the widest, and the sway.
  const box = new THREE.Box3();
  let tall = 0;
  const p = new THREE.Vector3();
  for (let i = 0; i < b.count; i++) {
    box.expandByPoint(p.set(b.tuft[i * 4], b.tuft[i * 4 + 1], b.tuft[i * 4 + 2]));
    tall = Math.max(tall, b.size[i * 4 + 1], b.size[i * 4] * 0.5);
  }
  box.max.y += tall;
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  g.boundingSphere.radius += tall * 0.5 + 0.5;
  g.boundingBox = box;
  const mesh = new THREE.Mesh(g, material);
  if (depth) mesh.customDepthMaterial = depth;
  mesh.castShadow = !!depth && far && FAR_CARDS_ON && FAR_CARD_TUNE.on && GRASS_SHADOW_TUNE.farCast;
  // Three's own receiving is never asked for: the grass reads the cascades itself, with no light of three's.
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/** A stand-in of one tuft, compiled behind the loading screen so the program every tuft and far card draws with exists before any is drawn. Let go of after (its geometry is its own). */
export function grassStandIn(material: THREE.Material): THREE.Mesh {
  const b = tuftBuffers(1);
  b.count = 1;
  b.size[0] = 1;
  b.size[1] = 1;
  b.normal[1] = 1;
  const mesh = tuftMesh(b, material);
  mesh.name = 'grass stand-in';
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- the pack's pictures

/**
 * A world's radial pictures out of its pack (`radialFile.ts`): the list and the layers as one array of textures,
 * mipmapped, raw bytes (no colour space: the client's grass multiplied the texel as it stood). Null where the pack
 * has none, or its files disagree; the world then has no grass and no far cards, as before the pass.
 */
export async function loadRadialPack(fetchBytes: (file: string) => Promise<ArrayBuffer | null>, anisotropy = 4): Promise<{ file: RadialFile; texture: THREE.DataArrayTexture } | null> {
  const json = await fetchBytes(RADIAL_JSON);
  if (!json) return null;
  let file: RadialFile | null = null;
  try {
    file = readRadialFile(JSON.parse(new TextDecoder().decode(json)));
  } catch {
    file = null;
  }
  if (!file || !file.layers) return null;
  const rgba = await fetchBytes(RADIAL_RGBA);
  if (!rgba || rgba.byteLength !== file.layers * file.size * file.size * 4) {
    console.warn(`grass: ${RADIAL_RGBA} is ${rgba ? `${rgba.byteLength} bytes where its list says ${file.layers * file.size * file.size * 4}` : 'missing'}; no grass on this world`);
    return null;
  }
  const t = new THREE.DataArrayTexture(new Uint8Array(rgba), file.size, file.size, file.layers);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return { file, texture: t };
}

// ---------------------------------------------------------------- the knobs into the uniforms

/** What the world hands the grass of itself. */
export interface GrassHost {
  /** The circles kept off a 64 m bucket's ground (the streamer's, live), into `out`. */
  circlesFor(cx: number, cz: number, out: FloraCircle[]): void;
  /** Called with each mesh made, before it is drawn: the world joins its material to the stencil's set. */
  adopt(mesh: THREE.Object3D): void;
  /**
   * What stands at a 64 m bucket, as the far cards read it (`CHUNK_TREES`): no near chunk; one whose trees are shown,
   * where our own trees are drawn and no far card is; or one whose trees a short Tree distance hides, where the far
   * cards stand in for them, lifted onto the coarse height. A chunk with no trees of its own reads as shown.
   */
  chunkTrees(cx: number, cz: number): number;
  /** Which cascade a shadow camera is (0 for any other), for a casting chunk's own hooks. */
  cascadeOf(shadowCamera: THREE.Camera): number;
}

/** What `GrassHost.chunkTrees` answers: no chunk, a chunk with its trees shown, a chunk with its trees hidden. */
export const CHUNK_TREES = { none: 0, shown: 1, hidden: 2 } as const;

/** How many cascades near grass casts into this frame (`grassCastCascades`), written by the world once a frame after the cascades move. */
export const GRASS_CAST = { cascades: 1 };

/** One world's radial flora, as the grass reads it. */
export interface GrassSetup {
  src: GrassSource;
  world: GrassWorld;
  file: RadialFile;
  near: FloraTiling;
  far: FloraTiling;
  shift: GroundShift;
  reference: { luminance: number; rgb: [number, number, number] } | null;
}

/** The tune and the world into the uniforms (and the dither's and the tint's modes). Uniforms only; nothing compiles. */
export function writeGrassUniforms(setup: GrassSetup | null): void {
  const u = GRASS_UNIFORMS;
  const t = GRASS_TUNE;
  u.uSwgGrassReach.value.set(setup ? grassReach(setup.near, t) : (t.reach ?? 30), t.fadeBand, setup ? farReach(setup.far, FAR_CARD_TUNE) : (FAR_CARD_TUNE.reach ?? 500), FAR_CARD_TUNE.fadeBand);
  u.uSwgGrassMode.value.set(t.facing === 'fixed' ? 1 : 0, t.fade === 'dither' ? 1 : t.fade === 'child' ? 2 : 0, GRASS_SWAY.amp, GRASS_SWAY.useChild ? 1 : 0);
  u.uSwgGrassShow.value.set(GRASS_ON && t.on ? 1 : 0, FAR_CARDS_ON && FAR_CARD_TUNE.on ? 1 : 0);
  u.uSwgGrassCut.value.set(t.cutoff, t.mipScale, t.fade === 'dither' ? 1 : 0);
  writeTintMode(setup);
  writeGrassShadowUniforms();
  if (setup) u.uSwgGrassSize.value = setup.file.size;
}

/** The ground's colour mode the tint was last written with (-1 while the tint is the colour map's own). */
let followedTint = -1;

/** The tint's mode: the client's own colour map, or the ground's own mode with the world's reference (followed live). */
function writeTintMode(setup: GrassSetup | null): void {
  const u = GRASS_UNIFORMS;
  followedTint = GRASS_TUNE.tint === 'ground' ? COLOUR_MODES.indexOf(GROUND_DRAW_TUNE.colour) : -1;
  const mode = GRASS_TUNE.tint === 'ground' ? Math.max(0, followedTint) : 1;
  const ref = setup?.reference;
  u.uSwgGrassTint.value.set(mode, ref ? ref.luminance : 1, GROUND_DRAW_TUNE.gainCap);
  if (ref) u.uSwgGrassTintRef.value.set(ref.rgb[0], ref.rgb[1], ref.rgb[2]);
  else u.uSwgGrassTintRef.value.set(1, 1, 1);
}

/** The ground's colour mode followed live while the tint takes it: a number compared a frame, the uniforms written only when it moved. The grass and the far cards both ask, so either alone follows it. */
function followGroundTint(setup: GrassSetup): void {
  if (GRASS_TUNE.tint !== 'ground') return;
  if (COLOUR_MODES.indexOf(GROUND_DRAW_TUNE.colour) !== followedTint) writeTintMode(setup);
}

// ---------------------------------------------------------------- the knobs

/**
 * What `__debug.grass` takes: any setting of the tune, the sway's (its stiff names as a pattern's text), and
 * `rebuild`. `window` is a number to hold the window at, or null to give it back to the reach (`windowHold`).
 */
export type GrassKnob = Partial<Omit<GrassTune, 'window' | 'windowHold'>> & { window?: number | null; sway?: Partial<Omit<GrassSway, 'stiff'>> & { stiff?: string }; rebuild?: boolean };

/** The window in force: the console's held one, else the one the reach in force needs (`grassWindowFor`). */
export function grassWindowNow(setup: GrassSetup | null): number {
  const t = GRASS_TUNE;
  if (t.windowHold !== null) return t.windowHold;
  return grassWindowFor(setup ? grassReach(setup.near, t) : (t.reach ?? 30 * t.reachScale));
}

/** Move the grass's knobs: anything not a usable value is left as it was. Answers whether a knob that places moved (the caller builds the grass again). */
export function setGrassTune(o: GrassKnob): boolean {
  const t = GRASS_TUNE;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  let rebuild = o.rebuild === true;
  if (typeof o.on === 'boolean') t.on = o.on;
  if (o.reach === null || (num(o.reach) && o.reach > 0)) t.reach = o.reach;
  if (num(o.reachScale) && o.reachScale > 0) t.reachScale = o.reachScale;
  if (o.fade === 'shrink' || o.fade === 'dither' || o.fade === 'child') t.fade = o.fade;
  if (num(o.fadeBand)) t.fadeBand = Math.min(1, Math.max(0, o.fadeBand));
  // The window follows the reach by itself (the field asks `grassWindowNow` each frame); a number holds it until null.
  if (o.window === null) t.windowHold = null;
  else if (num(o.window) && o.window >= 1) t.windowHold = Math.min(9, Math.round(o.window));
  if (num(o.cutoff)) t.cutoff = Math.min(1, Math.max(0, o.cutoff));
  if (num(o.mipScale) && o.mipScale >= 0) t.mipScale = o.mipScale;
  if (o.facing === 'eye' || o.facing === 'fixed') t.facing = o.facing;
  if (typeof o.perTile === 'boolean' && o.perTile !== t.perTile) {
    t.perTile = o.perTile;
    rebuild = true;
  }
  if ((o.jitter === null || (num(o.jitter) && o.jitter >= 0)) && o.jitter !== t.jitter) {
    t.jitter = o.jitter;
    rebuild = true;
  }
  if (num(o.jitterMin) && o.jitterMin >= 0 && o.jitterMin !== t.jitterMin) {
    t.jitterMin = Math.min(0.5, o.jitterMin);
    rebuild = true;
  }
  if (o.tint === 'colourMap' || o.tint === 'ground') t.tint = o.tint;
  if ((o.water === 'drop' || o.water === 'keep') && o.water !== t.water) {
    t.water = o.water;
    rebuild = true;
  }
  if (num(o.density) && o.density !== t.density) {
    t.density = Math.min(1, Math.max(0, o.density));
    rebuild = true;
  }
  const s = o.sway;
  if (s) {
    if (num(s.amp) && s.amp >= 0) GRASS_SWAY.amp = s.amp;
    if (typeof s.useChild === 'boolean') GRASS_SWAY.useChild = s.useChild;
    if (num(s.periodScale) && s.periodScale > 0) {
      GRASS_SWAY.periodScale = s.periodScale;
      rebuild = true;
    }
    if (num(s.periodMin) && s.periodMin > 0) {
      GRASS_SWAY.periodMin = s.periodMin;
      rebuild = true;
    }
    if (typeof s.stiff === 'string') {
      try {
        GRASS_SWAY.stiff = new RegExp(s.stiff, 'i');
        rebuild = true;
      } catch {
        // Not a pattern: left as it was.
      }
    }
  }
  return rebuild;
}

/** What `__debug.farCards` takes. */
export type FarCardKnob = Partial<FarCardTune> & { rebuild?: boolean };

/** Move the far cards' knobs. Answers whether a knob that places moved. */
export function setFarCardTune(o: FarCardKnob): boolean {
  const t = FAR_CARD_TUNE;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  let rebuild = o.rebuild === true;
  if (typeof o.on === 'boolean') t.on = o.on;
  if (o.reach === null || (num(o.reach) && o.reach > 0)) t.reach = o.reach;
  if (num(o.reachScale) && o.reachScale > 0) t.reachScale = o.reachScale;
  if (num(o.fadeBand)) t.fadeBand = Math.min(1, Math.max(0, o.fadeBand));
  if (num(o.jitterMin) && o.jitterMin >= 0 && o.jitterMin !== t.jitterMin) {
    t.jitterMin = Math.min(0.5, o.jitterMin);
    rebuild = true;
  }
  if ((o.water === 'drop' || o.water === 'keep') && o.water !== t.water) {
    t.water = o.water;
    rebuild = true;
  }
  if (num(o.perFrame) && o.perFrame >= 1) t.perFrame = Math.round(o.perFrame);
  return rebuild;
}

/**
 * What study 2 measured of each world (the research's tufts in the file's own near ring, mean and 90th percentile
 * over 150 random blocks, and far cards in the file's own far ring), to set the console's counts beside. The far
 * ring there started at the tiling's own minimum; ours starts where our own trees stop, so ours is fewer.
 */
export const GRASS_STUDY: Record<string, { tufts: [number, number]; far: [number, number] }> = {
  tatooine: { tufts: [611, 1222], far: [0, 0] },
  naboo: { tufts: [1821, 2827], far: [241, 664] },
  corellia: { tufts: [1363, 1810], far: [451, 1891] },
  dantooine: { tufts: [1991, 2728], far: [127, 331] },
  lok: { tufts: [239, 426], far: [131, 466] },
  endor: { tufts: [1267, 2504], far: [39, 92] },
  dathomir: { tufts: [669, 1361], far: [136, 378] },
  yavin4: { tufts: [2438, 3217], far: [178, 327] },
  talus: { tufts: [929, 1257], far: [123, 582] },
  rori: { tufts: [1121, 2049], far: [75, 247] },
};

// ---------------------------------------------------------------- the near window

interface GrassChunk {
  cx: number;
  cz: number;
  /** Its ground's corner in the game's frame (`groundChunkOrigin`), worked out once as it is made. */
  x0: number;
  z0: number;
  group: THREE.Object3D;
  mesh: THREE.Mesh | null;
  built: boolean;
  stale: boolean;
  count: number;
  /** The buffers the mesh was made from (kept for the console's count in reach). */
  buffers: TuftBuffers | null;
}

/** What the grass has done, for the console. */
export const GRASS_STATS = { builds: 0, buildMs: 0, lastBuildMs: 0, place: placeStats() as PlaceStats, farBuilds: 0, farBuildMs: 0, farPlace: placeStats() as PlaceStats };

/**
 * The grass of the chunks in a window round the eye: built a chunk a frame, nearest first, when the eye's chunk
 * changes or a circle moves; taken down when a chunk leaves the window or goes. A frame that changes nothing does
 * nothing and allocates nothing.
 */
export class GrassField {
  private readonly chunks: GrassChunk[] = [];
  private setup: GrassSetup | null = null;
  private eyeCx = Number.NaN;
  private eyeCz = Number.NaN;
  private pending = false;
  private readonly circles: FloraCircle[] = [];
  private scratch: TuftBuffers | null = null;
  readonly material: THREE.ShaderMaterial;
  readonly host: GrassHost;
  /** The casting depth material every chunk's mesh hangs (`grassDepthMaterial`), or none. */
  readonly depth: THREE.Material | null;

  constructor(material: THREE.ShaderMaterial, host: GrassHost, depth: THREE.Material | null = null) {
    this.material = material;
    this.host = host;
    this.depth = depth;
  }

  /**
   * A casting chunk's shadow hooks, one pair for the field and hung on every near mesh: a cascade past the count in
   * force draws none of its tufts. The instance count is the geometry's and read at every draw, where a uniform would
   * not be: three uploads a material's uniforms only when the material or the program changes from the last draw, so
   * one depth material drawn into cascade after cascade would carry the first one's value into the rest. The cascade
   * is the hooks' fourth argument; the third is the camera the shadow render was asked for, the portal renderer's probe.
   */
  private zeroed: THREE.InstancedBufferGeometry | null = null;
  private zeroedCount = 0;
  private readonly beforeShadow = (_r: THREE.WebGLRenderer, _s: THREE.Scene, _c: THREE.Camera, shadowCamera: THREE.Camera, geometry: THREE.BufferGeometry): void => {
    if (this.host.cascadeOf(shadowCamera) < GRASS_CAST.cascades) return;
    const g = geometry as THREE.InstancedBufferGeometry;
    this.zeroed = g;
    this.zeroedCount = g.instanceCount;
    g.instanceCount = 0;
  };
  private readonly afterShadow = (_r: THREE.WebGLRenderer, _s: THREE.Scene, _c: THREE.Camera, _shadowCamera: THREE.Camera, geometry: THREE.BufferGeometry): void => {
    if (this.zeroed !== geometry) return;
    this.zeroed.instanceCount = this.zeroedCount;
    this.zeroed = null;
  };

  /** This world's radial flora, or none. Every chunk built for the last is taken down. */
  setWorld(setup: GrassSetup | null): void {
    for (const c of this.chunks) this.drop(c);
    this.setup = setup;
    this.scratch = setup ? tuftBuffers(candidateCapacity(setup.near, GRASS_CHUNK)) : null;
    this.eyeCx = Number.NaN;
    if (setup) {
      // A chunk's corner moves with the world's shift: worked out again for any made before the world came.
      for (const c of this.chunks) {
        const o = groundChunkOrigin(c.cx, c.cz, setup.shift, GRASS_CHUNK);
        c.x0 = o.x;
        c.z0 = o.z;
      }
    }
    writeGrassUniforms(setup);
  }

  get world(): GrassSetup | null {
    return this.setup;
  }

  /** A near chunk made: its grass is built when it is in the window. */
  chunkMade(cx: number, cz: number, group: THREE.Object3D): void {
    const o = groundChunkOrigin(cx, cz, this.setup?.shift, GRASS_CHUNK);
    this.chunks.push({ cx, cz, x0: o.x, z0: o.z, group, mesh: null, built: false, stale: false, count: 0, buffers: null });
    this.pending = true;
  }

  /**
   * Every built chunk casts while near grass casts and its square lies within the reach of the eye, flat: written
   * only on a change, once a frame after `update`. Nothing allocated.
   */
  applyCast(eye: THREE.Vector3): void {
    const setup = this.setup;
    const on = !!setup && !!this.depth && GRASS_ON && GRASS_TUNE.on && GRASS_SHADOW_TUNE.cast;
    const reach = setup ? grassReach(setup.near, GRASS_TUNE) : 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      const m = c.mesh;
      if (!m) continue;
      let want = on;
      if (want) {
        const nx = Math.max(c.x0, Math.min(eye.x, c.x0 + GRASS_CHUNK));
        const nz = Math.max(c.z0, Math.min(eye.z, c.z0 + GRASS_CHUNK));
        const dx = nx - eye.x;
        const dz = nz - eye.z;
        want = dx * dx + dz * dz < reach * reach;
      }
      if (m.castShadow !== want) m.castShadow = want;
    }
  }

  /** The meshes casting now, for the console. */
  get casting(): number {
    let n = 0;
    for (const c of this.chunks) if (c.mesh?.castShadow) n++;
    return n;
  }

  /** A near chunk gone: its grass with it. */
  chunkGone(cx: number, cz: number): void {
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (c.cx !== cx || c.cz !== cz) continue;
      this.drop(c);
      this.chunks[i] = this.chunks[this.chunks.length - 1];
      this.chunks.pop();
      return;
    }
  }

  /** Every chunk gone (the world unloads). */
  clear(): void {
    for (const c of this.chunks) this.drop(c);
    this.chunks.length = 0;
    this.eyeCx = Number.NaN;
  }

  /** A circle kept off the ground added or let go of: every built chunk it touches is built again. */
  circleChanged(x: number, z: number, r: number): void {
    if (!this.setup) return;
    for (const c of this.chunks) {
      if (!c.built) continue;
      if (x + r < c.x0 || x - r > c.x0 + GRASS_CHUNK || z + r < c.z0 || z - r > c.z0 + GRASS_CHUNK) continue;
      c.stale = true;
      this.pending = true;
    }
  }

  /** Every chunk built again (a knob that places moved). */
  rebuildAll(): void {
    for (const c of this.chunks) if (c.built) c.stale = true;
    this.pending = true;
    if (this.setup) this.scratch = tuftBuffers(candidateCapacity(this.setup.near, GRASS_CHUNK));
  }

  /**
   * One frame: the window moved to the eye's chunk, at most `budget` chunks built, nearest first, and any chunk
   * left behind taken down. A frame whose eye stays in its chunk with nothing pending writes one number at most.
   */
  update(eye: THREE.Vector3, budget = 1): void {
    const setup = this.setup;
    if (!setup) return;
    followGroundTint(setup);
    if (!GRASS_ON || !GRASS_TUNE.on) {
      // Switched off: every chunk's grass taken down, so it costs nothing at all; switched on, the window is built again.
      if (!Number.isNaN(this.eyeCx)) {
        for (const c of this.chunks) this.drop(c);
        this.eyeCx = Number.NaN;
      }
      return;
    }
    // The window follows the reach in force (a number compared a frame): a wider reach builds more chunks round the
    // eye, a narrower one lets the outer ones go, and nothing already built is built again.
    const across = grassWindowNow(setup);
    if (across !== GRASS_TUNE.window) {
      GRASS_TUNE.window = across;
      this.pending = true;
    }
    const ecx = groundChunkAt(eye.x, setup.shift.x, GRASS_CHUNK);
    const ecz = groundChunkAt(eye.z, setup.shift.z, GRASS_CHUNK);
    if (ecx === this.eyeCx && ecz === this.eyeCz && !this.pending) return;
    this.eyeCx = ecx;
    this.eyeCz = ecz;
    const r = Math.max(0, Math.floor((GRASS_TUNE.window - 1) / 2));
    for (const c of this.chunks) if ((Math.abs(c.cx - ecx) > r || Math.abs(c.cz - ecz) > r) && (c.mesh || c.built)) this.drop(c);
    let built = 0;
    for (;;) {
      let best: GrassChunk | null = null;
      let bestD = Infinity;
      for (const c of this.chunks) {
        if (c.built && !c.stale) continue;
        const dx = Math.abs(c.cx - ecx);
        const dz = Math.abs(c.cz - ecz);
        if (dx > r || dz > r) continue;
        if (dx + dz < bestD) {
          bestD = dx + dz;
          best = c;
        }
      }
      if (!best) {
        this.pending = false;
        return;
      }
      if (built >= budget) {
        this.pending = true;
        return;
      }
      this.build(best);
      built++;
    }
  }

  private build(c: GrassChunk): void {
    const setup = this.setup!;
    const t0 = performance.now();
    this.drop(c);
    // The circles of every bucket the chunk's ground reaches into (it stands up to a metre over its own).
    this.circles.length = 0;
    this.host.circlesFor(c.cx, c.cz, this.circles);
    if (setup.shift.x) this.host.circlesFor(c.cx + 1, c.cz, this.circles);
    if (setup.shift.z) this.host.circlesFor(c.cx, c.cz + 1, this.circles);
    if (setup.shift.x && setup.shift.z) this.host.circlesFor(c.cx + 1, c.cz + 1, this.circles);
    const b = this.scratch!;
    b.count = 0;
    placeGrass(setup.src, setup.world, setup.near, c.x0, c.z0, GRASS_CHUNK, this.circles, GRASS_TUNE, GRASS_SWAY, SWAY_TUNE, b, GRASS_STATS.place);
    c.built = true;
    c.stale = false;
    c.count = b.count;
    if (b.count) {
      const trimmed = trimBuffers(b);
      const mesh = tuftMesh(trimmed, this.material, this.depth, false);
      mesh.onBeforeShadow = this.beforeShadow as THREE.Object3D['onBeforeShadow'];
      mesh.onAfterShadow = this.afterShadow as THREE.Object3D['onAfterShadow'];
      mesh.name = 'grass';
      c.group.add(mesh);
      this.host.adopt(mesh);
      c.mesh = mesh;
      c.buffers = trimmed;
    }
    const ms = performance.now() - t0;
    GRASS_STATS.builds++;
    GRASS_STATS.buildMs += ms;
    GRASS_STATS.lastBuildMs = ms;
  }

  private drop(c: GrassChunk): void {
    if (c.mesh) {
      c.mesh.parent?.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh = null;
    }
    c.buffers = null;
    c.built = false;
    c.count = 0;
  }

  /**
   * The grass now, for the console: chunks, tufts, those in reach of the eye, and the screens of fragments the
   * ones in view cover (each quad's area over its distance squared against the view's own, a quad seen square on:
   * the cost the research sized the grass by, before the cut throws most of them away).
   */
  report(camera: THREE.PerspectiveCamera): { chunks: number; built: number; draws: number; tufts: number; inReach: number; inView: number; fillScreens: number; reach: number; window: number; casting: number } {
    const setup = this.setup;
    const reach = setup ? grassReach(setup.near, GRASS_TUNE) : 0;
    const eye = camera.position;
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const p = new THREE.Vector3();
    let built = 0;
    let draws = 0;
    let tufts = 0;
    let inReach = 0;
    let inView = 0;
    let fill = 0;
    const k = 1 / (4 * Math.tan((camera.fov * Math.PI) / 360) ** 2 * Math.max(camera.aspect, 1e-3));
    for (const c of this.chunks) {
      if (c.built) built++;
      if (c.mesh) draws++;
      tufts += c.count;
      const b = c.buffers;
      if (!b) continue;
      for (let i = 0; i < b.count; i++) {
        const d = Math.hypot(b.tuft[i * 4] - eye.x, b.tuft[i * 4 + 1] - eye.y, b.tuft[i * 4 + 2] - eye.z);
        if (d >= reach) continue;
        inReach++;
        if (!frustum.containsPoint(p.set(b.tuft[i * 4], b.tuft[i * 4 + 1] + b.size[i * 4 + 1] * 0.5, b.tuft[i * 4 + 2]))) continue;
        inView++;
        const area = b.size[i * 4] * b.size[i * 4 + 1] * ((Number(b.size[i * 4 + 3]) & 1) ? 2 : 1);
        fill += (area / Math.max(d * d, 1)) * k;
      }
    }
    return { chunks: this.chunks.length, built, draws, tufts, inReach, inView, fillScreens: Number(fill.toFixed(2)), reach, window: GRASS_TUNE.window, casting: this.casting };
  }
}

// ---------------------------------------------------------------- the far cards

/**
 * Which rule hides a far card (the frame report's `farCardsByTrees`): by the trees (true, wave 8), so a card stands in
 * for the trees a short Tree distance hides, or by the chunk alone (false, as before), which leaves a ring with
 * neither between a short Tree distance and the window's edge. The same answer at the default Tree distance.
 */
export const FAR_CARD_RULE = { byTrees: true };

/**
 * A far card's flags for what stands in its 64 m bucket (`CHUNK_TREES`): hidden where a chunk stands with its trees
 * shown, shown where none stands, and shown lifted onto the coarse height where one stands with its trees hidden.
 */
export function cardFlags(flags: number, state: number): number {
  let f = flags;
  const s = state === CHUNK_TREES.hidden && !FAR_CARD_RULE.byTrees ? CHUNK_TREES.shown : state;
  const hide = s === CHUNK_TREES.shown;
  const lift = s === CHUNK_TREES.hidden;
  if (((f & TUFT_HIDDEN) !== 0) !== hide) f += hide ? TUFT_HIDDEN : -TUFT_HIDDEN;
  if (((f & TUFT_LIFT) !== 0) !== lift) f += lift ? TUFT_LIFT : -TUFT_LIFT;
  return f;
}

interface FarTile {
  tx: number;
  tz: number;
  /** The tile's ground origin and its coarse samples (the far ground's own, kept by the terrain while the tile stands). */
  ox: number;
  oz: number;
  samples: FarSamples | null;
  mesh: THREE.Mesh | null;
  built: boolean;
  buffers: TuftBuffers | null;
  /** Each card's 64 m bucket, so a chunk coming or going finds its cards without a key. */
  bucketX: Int32Array | null;
  bucketZ: Int32Array | null;
}

/**
 * The far hills' tree cards, one mesh a far ground tile, built within the far tiling's reach of the eye, a tile a
 * frame. A card is shown only where our own trees are not -- no near chunk stands there, or one does with its trees
 * hidden by a short Tree distance, where the card is lifted back onto the coarse height (the far tile it was dropped
 * for is cut away there) -- which is written into its flags when a chunk comes or goes or a sweep flips a chunk's
 * trees, never worked out per frame.
 */
export class FarCards {
  private readonly tiles: FarTile[] = [];
  private setup: GrassSetup | null = null;
  private pending = false;
  private eyeTx = Number.NaN;
  private eyeTz = Number.NaN;
  private scratch: TuftBuffers | null = null;
  readonly material: THREE.ShaderMaterial;
  readonly host: GrassHost;
  readonly root: THREE.Object3D;
  /** The far tiles' size, their samples' spacing and how far under its true height the far ground is drawn (the world's). */
  readonly tileSize: number;
  readonly drop: number;
  private readonly circles: FloraCircle[] = [];
  private readonly circlesAt = (gx: number, gz: number): readonly FloraCircle[] => {
    this.circles.length = 0;
    this.host.circlesFor(Math.floor(gx / GRASS_CHUNK), Math.floor(gz / GRASS_CHUNK), this.circles);
    return this.circles;
  };

  /** The casting depth material every tile's mesh hangs (`grassDepthMaterial`), or none. */
  readonly depth: THREE.Material | null;

  constructor(material: THREE.ShaderMaterial, host: GrassHost, root: THREE.Object3D, tileSize: number, drop: number, depth: THREE.Material | null = null) {
    this.material = material;
    this.host = host;
    this.root = root;
    this.tileSize = tileSize;
    this.drop = drop;
    this.depth = depth;
    GRASS_UNIFORMS.uSwgGrassFarLift.value = drop;
  }

  /** Every far mesh casts while the far cards cast (on a toggle; a tile built casts as it is made). */
  applyCast(): void {
    const want = !!this.depth && FAR_CARDS_ON && FAR_CARD_TUNE.on && GRASS_SHADOW_TUNE.farCast;
    for (const t of this.tiles) if (t.mesh && t.mesh.castShadow !== want) t.mesh.castShadow = want;
  }

  /** The meshes casting now, for the console. */
  get casting(): number {
    let n = 0;
    for (const t of this.tiles) if (t.mesh?.castShadow) n++;
    return n;
  }

  setWorld(setup: GrassSetup | null): void {
    this.clear();
    this.setup = setup;
    this.scratch = setup ? tuftBuffers(candidateCapacity(setup.far, this.tileSize)) : null;
  }

  get world(): GrassSetup | null {
    return this.setup;
  }

  /** A far ground tile made, with its samples (`gx0`/`gz0` the place of sample nought). */
  tileMade(tx: number, tz: number, ox: number, oz: number, samples: FarSamples | null): void {
    if (!samples) return;
    this.tiles.push({ tx, tz, ox, oz, samples, mesh: null, built: false, buffers: null, bucketX: null, bucketZ: null });
    this.pending = true;
  }

  tileGone(tx: number, tz: number): void {
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t.tx !== tx || t.tz !== tz) continue;
      this.dropTile(t);
      this.tiles[i] = this.tiles[this.tiles.length - 1];
      this.tiles.pop();
      return;
    }
  }

  clear(): void {
    for (const t of this.tiles) this.dropTile(t);
    this.tiles.length = 0;
    this.eyeTx = Number.NaN;
  }

  /** Every tile built again (a knob that places moved). */
  rebuildAll(): void {
    for (const t of this.tiles) this.dropTile(t);
    this.pending = true;
  }

  /**
   * The near chunks whose state changed in one stream call or one sweep, `n` of them, each as `CHUNK_TREES` says
   * (`states[k]`: 0 gone, 1 standing with its trees shown, 2 standing with them hidden): each card standing in one is
   * hidden where our trees are shown, and shown -- lifted where a chunk stands -- where they are not. Written into the
   * cards' flags and the attribute marked for upload; allocates nothing.
   */
  chunksChanged(cxs: ArrayLike<number>, czs: ArrayLike<number>, states: ArrayLike<number>, n: number): void {
    if (!n) return;
    for (const t of this.tiles) {
      const b = t.buffers;
      if (!b || !t.mesh || !t.bucketX || !t.bucketZ) continue;
      let moved = false;
      for (let i = 0; i < b.count; i++) {
        const bx = t.bucketX[i];
        const bz = t.bucketZ[i];
        for (let k = 0; k < n; k++) {
          if (cxs[k] !== bx || czs[k] !== bz) continue;
          const flags = b.size[i * 4 + 3];
          const want = cardFlags(flags, states[k]);
          if (want !== flags) {
            b.size[i * 4 + 3] = want;
            moved = true;
          }
        }
      }
      if (moved) (t.mesh.geometry.getAttribute('aSwgSize') as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }

  update(eye: THREE.Vector3, budget = FAR_CARD_TUNE.perFrame): void {
    const setup = this.setup;
    if (!setup) return;
    followGroundTint(setup);
    if (!FAR_CARDS_ON || !FAR_CARD_TUNE.on) {
      // Switched off: every tile's cards taken down; switched on, built again round the eye.
      if (!Number.isNaN(this.eyeTx)) {
        for (const t of this.tiles) this.dropTile(t);
        this.eyeTx = Number.NaN;
      }
      return;
    }
    const etx = Math.floor(eye.x / this.tileSize);
    const etz = Math.floor(eye.z / this.tileSize);
    if (etx === this.eyeTx && etz === this.eyeTz && !this.pending) return;
    this.eyeTx = etx;
    this.eyeTz = etz;
    const reach = farReach(setup.far, FAR_CARD_TUNE) + this.tileSize;
    let built = 0;
    let left = false;
    for (const t of this.tiles) {
      // How far the tile's nearest point stands from the eye, flat.
      const nx = Math.max(t.ox, Math.min(eye.x, t.ox + this.tileSize));
      const nz = Math.max(t.oz, Math.min(eye.z, t.oz + this.tileSize));
      const near = Math.hypot(nx - eye.x, nz - eye.z) <= reach;
      if (!near) {
        if (t.built) this.dropTile(t);
        continue;
      }
      if (t.built) continue;
      if (built >= budget) {
        left = true;
        continue;
      }
      this.buildTile(t);
      built++;
    }
    this.pending = left;
  }

  private buildTile(t: FarTile): void {
    const setup = this.setup!;
    const t0 = performance.now();
    const b = this.scratch!;
    b.count = 0;
    placeFarCards(setup.src, setup.world, setup.far, t.ox, t.oz, this.tileSize, t.samples!, this.drop, this.circlesAt, FAR_CARD_TUNE, b, GRASS_STATS.farPlace);
    t.built = true;
    if (b.count) {
      const trimmed = trimBuffers(b);
      t.bucketX = new Int32Array(trimmed.count);
      t.bucketZ = new Int32Array(trimmed.count);
      for (let i = 0; i < trimmed.count; i++) {
        const bx = Math.floor(trimmed.tuft[i * 4] / GRASS_CHUNK);
        const bz = Math.floor(trimmed.tuft[i * 4 + 2] / GRASS_CHUNK);
        t.bucketX[i] = bx;
        t.bucketZ[i] = bz;
        trimmed.size[i * 4 + 3] = cardFlags(trimmed.size[i * 4 + 3], this.host.chunkTrees(bx, bz));
      }
      const mesh = tuftMesh(trimmed, this.material, this.depth, true);
      mesh.name = 'far cards';
      (mesh.geometry.getAttribute('aSwgSize') as THREE.InstancedBufferAttribute).setUsage(THREE.DynamicDrawUsage);
      this.root.add(mesh);
      this.host.adopt(mesh);
      t.mesh = mesh;
      t.buffers = trimmed;
    }
    GRASS_STATS.farBuilds++;
    GRASS_STATS.farBuildMs += performance.now() - t0;
  }

  private dropTile(t: FarTile): void {
    if (t.mesh) {
      t.mesh.parent?.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh = null;
    }
    t.buffers = null;
    t.bucketX = null;
    t.bucketZ = null;
    t.built = false;
  }

  /** The far cards now, for the console: tiles, cards, those shown in reach. */
  report(eye: THREE.Vector3): { tiles: number; built: number; draws: number; cards: number; hidden: number; overChunks: number; inReach: number; reach: number; casting: number } {
    const setup = this.setup;
    const reach = setup ? farReach(setup.far, FAR_CARD_TUNE) : 0;
    let built = 0;
    let draws = 0;
    let cards = 0;
    let hidden = 0;
    let overChunks = 0;
    let inReach = 0;
    for (const t of this.tiles) {
      if (t.built) built++;
      if (t.mesh) draws++;
      const b = t.buffers;
      if (!b) continue;
      cards += b.count;
      for (let i = 0; i < b.count; i++) {
        if (b.size[i * 4 + 3] & TUFT_HIDDEN) {
          hidden++;
          continue;
        }
        // Shown over a near chunk whose trees a short Tree distance hides: inside the detailed ground.
        if (b.size[i * 4 + 3] & TUFT_LIFT) overChunks++;
        if (Math.hypot(b.tuft[i * 4] - eye.x, b.tuft[i * 4 + 2] - eye.z) < reach) inReach++;
      }
    }
    return { tiles: this.tiles.length, built, draws, cards, hidden, overChunks, inReach, reach, casting: this.casting };
  }

  /** Every mesh's attribute world places, for the node test (no frame needs this). */
  get meshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const t of this.tiles) if (t.mesh) out.push(t.mesh);
    return out;
  }
}
