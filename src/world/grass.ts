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
// only where no near chunk stands (where our own trees are drawn) and out to the far tiling's end. Layer 0 only,
// never a room's; no shadow cast or taken (the client's grass program samples none); dry; only uniforms change
// per frame, and a frame that crosses no chunk does nothing.
//
// `localStorage['swg.grass'] = '0'` turns the grass off at load, `swg.farCards = '0'` the far cards.
import * as THREE from 'three';
import type { FloraTiling } from '../swg/terrain/trn.ts';
import { RADIAL_JSON, RADIAL_RGBA, readRadialFile, type RadialFile } from '../swg/terrain/radialFile.ts';
import { CARD_CURVE_PARS, CARD_LIGHT_UNIFORMS } from './cardLight.ts';
import { SWAY_TUNE, SWAY_UNIFORMS } from './floraSway.ts';
import {
  FAR_CARD_DEFAULTS, GRASS_DEFAULTS, GRASS_SWAY_DEFAULTS, TUFT_HIDDEN, candidateCapacity, farReach, grassReach, placeFarCards, placeGrass, placeStats, trimBuffers, tuftBuffers,
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

/** The vertex stage: placing, facing, fading, swaying and lighting a tuft. */
export const GRASS_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${SWAY_SHARED_PARS}
// A model's own two, written per tuft (swayMath.ts): one call of the trees' own function a vertex.
vec4 uSwayShape;
vec4 uSwayAxis;
${SWAY_FUNCTIONS}
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
	float swgDist = distance( swgBase, cameraPosition );
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
	vSwgUv = vec3( position.x + 0.5, 1.0 - position.y, aSwgSize.z );
	vSwgTint = aSwgTint.rgb;
	vSwgRef = aSwgTint.a;
	vSwgFade = swgFade;
	vSwgGlow = ( swgFlags & 16 ) != 0 ? 1.0 : 0.0;
	vSwgLight = vec3( 1.0 );
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
		swgRight = cross( swgUp, cameraPosition - swgBase );
		float swgLen = length( swgRight );
		swgRight = swgLen > 1e-4 ? swgRight / swgLen : vec3( cos( aSwgTuft.w ), 0.0, - sin( aSwgTuft.w ) );
	}
	swgRight = swgRight - swgUp * dot( swgRight, swgUp );
	float swgAcross = length( swgRight );
	swgRight = swgAcross > 1e-5 ? swgRight / swgAcross : vec3( 1.0, 0.0, 0.0 );
	// A quad of a fixed turn (a crossed child's two, every tuft under the 'fixed' knob) shows its front to the eye:
	// the material draws one side, so seen from behind its right is flipped, which also keeps the picture the right
	// way round. A quad turned to the eye already faces it and is never flipped.
	if ( dot( cross( swgRight, swgUp ), cameraPosition - swgBase ) < 0.0 ) swgRight = - swgRight;
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
	// The client's sum at the tuft, by the ground's normal: the ramp about the sun's axis, the ambient, the two fills.
	float swgD = clamp( dot( swgN, uSwgLeafSun ), -1.0, 1.0 );
	vec3 swgMain = swgD >= 0.0 ? mix( uSwgCardTangent, uSwgCardFront, swgD ) : mix( uSwgCardTangent, uSwgCardBack, - swgD );
	vec3 swgSum = uSwgCardAmbient + swgMain;
	if ( uSwgCardFills > 0.5 ) swgSum += uSwgCardFill * max( dot( swgN, normalize( uSwgCardFillDir ) ), 0.0 );
	if ( uSwgCardFills > 1.5 ) swgSum += uSwgCardBounce * max( dot( swgN, normalize( uSwgCardBounceDir ) ), 0.0 );
	vSwgLight = vSwgGlow > 0.5 ? vec3( 1.0 ) : clamp( swgSum * uSwgCardGain, 0.0, 1.0 );
	vec4 mvPosition = viewMatrix * vec4( swgP, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}
`;

/** The fragment stage: the picture cut at its reference, its mip scale, the tint and the light in the client's bytes, carried back through the curve. */
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
${CARD_CURVE_PARS}
varying vec3 vSwgUv;
varying vec3 vSwgLight;
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
	vec3 swgTint = vSwgGlow > 0.5 ? vec3( 1.0 ) : swgGrassTint( vSwgTint );
	vec3 swgDisplay = clamp( swgTexel.rgb * swgTint * vSwgLight, 0.0, 1.0 );
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

/** A one-layer stand-in for the pictures until a world's arrive: a program's sampler must always hold a real texture. */
function blankArray(): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(new Uint8Array([255, 255, 255, 0]), 1, 1, 1);
  t.needsUpdate = true;
  return t;
}

const BLANK = blankArray();

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
      ...GRASS_UNIFORMS,
    },
    vertexShader: GRASS_VERTEX,
    fragmentShader: GRASS_FRAGMENT,
    fog: true,
  });
  // Unlit and dry: out of the shadow cascades (which never take a ShaderMaterial anyway) and never wrapped by the weather.
  m.userData.unlit = true;
  m.userData.dry = true;
  return m;
}

/** The quads a tuft is drawn with: two, the second crossed, each a metre wide about x nought and a metre tall from its foot. */
function tuftQuads(g: THREE.InstancedBufferGeometry): void {
  // position.z says which quad: nought the first, one the crossed second.
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0, -0.5, 0, 1, 0.5, 0, 1, 0.5, 1, 1, -0.5, 1, 1]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
}

/** One mesh of tufts from filled buffers: a geometry of its own (never sharing an attribute, which a dispose would free under another), its sphere over every tuft. */
export function tuftMesh(b: TuftBuffers, material: THREE.Material): THREE.Mesh {
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
  mesh.castShadow = false;
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
  /** Whether the near chunk at a 64 m bucket stands: where it does, our own trees are drawn and no far card is. */
  chunkLoaded(cx: number, cz: number): boolean;
}

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

/** What `__debug.grass` takes: any setting of the tune, the sway's (its stiff names as a pattern's text), and `rebuild`. */
export type GrassKnob = Partial<GrassTune> & { sway?: Partial<Omit<GrassSway, 'stiff'>> & { stiff?: string }; rebuild?: boolean };

/** Move the grass's knobs: anything not a usable value is left as it was. Answers whether a knob that places moved (the caller builds the grass again). */
export function setGrassTune(o: GrassKnob): boolean {
  const t = GRASS_TUNE;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  let rebuild = o.rebuild === true;
  if (typeof o.on === 'boolean') t.on = o.on;
  if (o.reach === null || (num(o.reach) && o.reach > 0)) t.reach = o.reach;
  if (o.fade === 'shrink' || o.fade === 'dither' || o.fade === 'child') t.fade = o.fade;
  if (num(o.fadeBand)) t.fadeBand = Math.min(1, Math.max(0, o.fadeBand));
  if (num(o.window) && o.window >= 1 && Math.round(o.window) !== t.window) {
    t.window = Math.min(9, Math.round(o.window));
    rebuild = true;
  }
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

  constructor(material: THREE.ShaderMaterial, host: GrassHost) {
    this.material = material;
    this.host = host;
  }

  /** This world's radial flora, or none. Every chunk built for the last is taken down. */
  setWorld(setup: GrassSetup | null): void {
    for (const c of this.chunks) this.drop(c);
    this.setup = setup;
    this.scratch = setup ? tuftBuffers(candidateCapacity(setup.near, GRASS_CHUNK)) : null;
    this.eyeCx = Number.NaN;
    writeGrassUniforms(setup);
  }

  get world(): GrassSetup | null {
    return this.setup;
  }

  /** A near chunk made: its grass is built when it is in the window. */
  chunkMade(cx: number, cz: number, group: THREE.Object3D): void {
    this.chunks.push({ cx, cz, group, mesh: null, built: false, stale: false, count: 0, buffers: null });
    this.pending = true;
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
    const s = this.setup?.shift;
    if (!s) return;
    for (const c of this.chunks) {
      if (!c.built) continue;
      const o = groundChunkOrigin(c.cx, c.cz, s, GRASS_CHUNK);
      if (x + r < o.x || x - r > o.x + GRASS_CHUNK || z + r < o.z || z - r > o.z + GRASS_CHUNK) continue;
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
    const o = groundChunkOrigin(c.cx, c.cz, setup.shift, GRASS_CHUNK);
    // The circles of every bucket the chunk's ground reaches into (it stands up to a metre over its own).
    this.circles.length = 0;
    this.host.circlesFor(c.cx, c.cz, this.circles);
    if (setup.shift.x) this.host.circlesFor(c.cx + 1, c.cz, this.circles);
    if (setup.shift.z) this.host.circlesFor(c.cx, c.cz + 1, this.circles);
    if (setup.shift.x && setup.shift.z) this.host.circlesFor(c.cx + 1, c.cz + 1, this.circles);
    const b = this.scratch!;
    b.count = 0;
    placeGrass(setup.src, setup.world, setup.near, o.x, o.z, GRASS_CHUNK, this.circles, GRASS_TUNE, GRASS_SWAY, SWAY_TUNE, b, GRASS_STATS.place);
    c.built = true;
    c.stale = false;
    c.count = b.count;
    if (b.count) {
      const trimmed = trimBuffers(b);
      const mesh = tuftMesh(trimmed, this.material);
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
  report(camera: THREE.PerspectiveCamera): { chunks: number; built: number; draws: number; tufts: number; inReach: number; inView: number; fillScreens: number; reach: number } {
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
    return { chunks: this.chunks.length, built, draws, tufts, inReach, inView, fillScreens: Number(fill.toFixed(2)), reach };
  }
}

// ---------------------------------------------------------------- the far cards

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
 * frame. A card is shown only where no near chunk stands -- there our own trees are -- which is written into its
 * flags when a chunk comes or goes, never worked out per frame.
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

  constructor(material: THREE.ShaderMaterial, host: GrassHost, root: THREE.Object3D, tileSize: number, drop: number) {
    this.material = material;
    this.host = host;
    this.root = root;
    this.tileSize = tileSize;
    this.drop = drop;
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
   * The near chunks that came (`ins[k]` 1) and went (0) in one stream call, `n` of them: each card standing in one
   * is hidden or shown again. Written into the cards' flags and the attribute marked for upload; allocates nothing.
   */
  chunksChanged(cxs: ArrayLike<number>, czs: ArrayLike<number>, ins: ArrayLike<number>, n: number): void {
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
          const hidden = (flags & TUFT_HIDDEN) !== 0;
          const want = ins[k] === 1;
          if (hidden !== want) {
            b.size[i * 4 + 3] = want ? flags + TUFT_HIDDEN : flags - TUFT_HIDDEN;
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
        if (this.host.chunkLoaded(bx, bz)) trimmed.size[i * 4 + 3] += TUFT_HIDDEN;
      }
      const mesh = tuftMesh(trimmed, this.material);
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
  report(eye: THREE.Vector3): { tiles: number; built: number; draws: number; cards: number; hidden: number; inReach: number; reach: number } {
    const setup = this.setup;
    const reach = setup ? farReach(setup.far, FAR_CARD_TUNE) : 0;
    let built = 0;
    let draws = 0;
    let cards = 0;
    let hidden = 0;
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
        if (Math.hypot(b.tuft[i * 4] - eye.x, b.tuft[i * 4 + 2] - eye.z) < reach) inReach++;
      }
    }
    return { tiles: this.tiles.length, built, draws, cards, hidden, inReach, reach };
  }

  /** Every mesh's attribute world places, for the node test (no frame needs this). */
  get meshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const t of this.tiles) if (t.mesh) out.push(t.mesh);
    return out;
  }
}
