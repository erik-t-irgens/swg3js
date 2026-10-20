// Leaf cards lit by the client's own light, fills and all, and no shadow on a leaf from its own tree: the
// second half of the card rule's one wrap (`cardRule.ts` calls `injectCardLight` after its own edits, so there
// is no hook of its own and no program of its own beyond the define).
//
// **Three's light is never added to a card.** Under `SWG_CARD_LIGHT` the cascades' chunk puts three's own
// light out before every `RE_Direct` that would light a card with the sun or the fill (`leafShadow.ts` says
// which four), so neither three's Lambert term nor its highlight enters the card's light and nothing has to be
// taken out afterwards. The point lights (the flash pool, the torch, a room's lamps) are kept as three draws
// them, against a normal blended toward the leaf's own face (`pointFlat`). The hemisphere is gone too: the
// card's indirect light is three's ambient alone, since the ramp rows the hemisphere was made of are inside the
// client's sum now.
//
// **The client's sum** (`cardLightMath.ts` is its mirror) goes in right after `#include <lights_fragment_end>`:
// the ambient, the emissive, the two plain parallel lights by Lambert and the main light by the ramp about the
// sun's axis, saturated, times the texel, then carried back through three's tone curve so a card shows the
// client's own displayed value (`curve: 'client'`), held under the bloom threshold. It reads `normal` for `d`
// and the fills, the one the mirror turned toward the viewer (`sunSide: 'face'`), or the client's stored normal
// carried in a varying of its own (`'stored'`), worked out in the vertex stage from the very line the card
// rule's mirror comparison writes, never from `objectNormal` once `backs` may have swapped it.
//
// **Every difference between materials is a define or a uniform**, since a wrapped material's program key is
// only its wrappers' names and the cascades' hook: two materials whose injected text differed would share
// whichever program was built first. The colours, the knobs and the sun are shared uniform objects; a card's
// emissive and its crown's box are its own uniforms; whether a card takes the light at all is the define
// `SWG_CARD_LIGHT` and whether it skips its own crown's shadow `SWG_LEAF_SHADOW`, both set when the card rule
// marks the material, before anything compiles.
//
// `localStorage['swg.cardLight'] = '0'` leaves the light's define out at load; `localStorage['swg.leafShadow']
// = 'all'` leaves the skip out. Both are escape hatches: a program that fails to compile draws nothing.
import * as THREE from 'three';
import { ACES_IN_INV, ACES_OUT_INV, CARD_ROWS_DEFAULT, glslMat3, type CardLightTune, type CardRows } from './cardLightMath.ts';
import { cardLightsBegin, padBox, type LeafBox } from './leafShadow.ts';

export type { CardLightTune } from './cardLightMath.ts';

/** The rows the sky reads the card's colours from: live, shared by reference with the tune. */
export const CARD_ROWS: CardRows = { ...CARD_ROWS_DEFAULT };

/** The knobs (`__debug.cardLight`). Every one ours unless `cardLightMath.ts` says otherwise of it. */
export const CARD_LIGHT_TUNE: CardLightTune = {
  on: true,
  curve: 'client',
  rows: CARD_ROWS,
  rampScale: 'bytes',
  fills: 'both',
  emissive: true,
  gain: 1,
  exposureRef: 1,
  bloomCap: 0.84,
  shadow: 'self',
  shadowLook: 'rise',
  share: 1,
  acne: 4,
  box: 'cards',
  bark: false,
  sunSide: 'face',
  pointFlat: 0.5,
};

function stored(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** False when localStorage 'swg.cardLight' is '0' (read once, at load): no card is given the light's define. */
export const CARD_LIGHT_ON: boolean = stored('swg.cardLight') !== '0';
/** False when localStorage 'swg.leafShadow' is 'all' (read once, at load): no card is given the skip's define. */
export const LEAF_SHADOW_ON: boolean = stored('swg.leafShadow') !== 'all';

/** The colours, the sun and the knobs, shared by reference into every card's uniforms, so one write reaches all of them. */
export const CARD_LIGHT_UNIFORMS = {
  uSwgCardOn: { value: 0 },
  uSwgCardCurve: { value: 0 },
  uSwgCardFront: { value: new THREE.Vector3(1, 1, 1) },
  uSwgCardTangent: { value: new THREE.Vector3(0.6, 0.6, 0.6) },
  uSwgCardBack: { value: new THREE.Vector3(0.1, 0.1, 0.1) },
  uSwgCardAmbient: { value: new THREE.Vector3() },
  uSwgCardFill: { value: new THREE.Vector3() },
  uSwgCardBounce: { value: new THREE.Vector3() },
  uSwgCardRow7: { value: new THREE.Vector3() },
  uSwgCardRow7Alpha: { value: 0 },
  uSwgCardFillDir: { value: new THREE.Vector3(0, 1, 0) },
  uSwgCardBounceDir: { value: new THREE.Vector3(0, -1, 0) },
  uSwgCardFills: { value: 2 },
  uSwgCardEmissiveOn: { value: 1 },
  uSwgCardGain: { value: 1 },
  uSwgCardExposureRef: { value: 1 },
  uSwgCardBloomCap: { value: 0.84 },
  uSwgCardShadowLook: { value: 0 },
  uSwgCardSunSide: { value: 0 },
  uSwgCardPointFlat: { value: 0.5 },
  uSwgLeafSun: { value: new THREE.Vector3(0, 1, 0) },
  /** Each cascade's depth range (its shadow camera's far less near), by cascade: the skip's metres into that cascade's own depth. */
  uSwgLeafRange: { value: new THREE.Vector4(470, 470, 470, 470) },
  uSwgLeafSelf: { value: 1 },
  uSwgLeafShare: { value: 1 },
  uSwgLeafAcne: { value: 4 },
};

/** Whether the world has handed over the ramp's colours yet: until it has, the card light is off and three lights a card. */
let ready = false;
/** Whether a building's rooms are being drawn now (`setCardRoomPass`). */
let roomPass = false;

/** Write the shared knobs from the tune. Uniforms only; nothing compiles. */
export function writeCardLightUniforms(t: CardLightTune = CARD_LIGHT_TUNE): void {
  const u = CARD_LIGHT_UNIFORMS;
  u.uSwgCardOn.value = t.on && ready && !roomPass ? 1 : 0;
  u.uSwgCardCurve.value = t.curve === 'scene' ? 1 : 0;
  u.uSwgCardFills.value = t.fills === 'both' ? 2 : t.fills === 'fill' ? 1 : 0;
  u.uSwgCardEmissiveOn.value = t.emissive ? 1 : 0;
  u.uSwgCardGain.value = t.gain;
  u.uSwgCardExposureRef.value = t.exposureRef;
  u.uSwgCardBloomCap.value = t.bloomCap;
  u.uSwgCardShadowLook.value = t.shadowLook === 'row7' ? 1 : 0;
  u.uSwgCardSunSide.value = t.sunSide === 'stored' ? 1 : 0;
  u.uSwgCardPointFlat.value = t.pointFlat;
  // `all` is every shadow as today: no skip, no floor; `none` makes no lookup at all (receiveShadow off), so the skip's value there does not matter.
  u.uSwgLeafSelf.value = t.shadow === 'all' ? 0 : 1;
  u.uSwgLeafShare.value = t.share;
  u.uSwgLeafAcne.value = t.acne;
}
writeCardLightUniforms();

/**
 * A building's rooms pass begun or ended (the portal renderer's `roomPass`, round each rooms pass alone). A card
 * standing in a room -- a potted plant, a planter, a cantina's fern, which wear their model's own materials and so
 * carry the light's define wherever the model stands -- is lit by the rooms' own lamps, which the client's sum
 * knows nothing of: in a rooms pass the light is off and three lights it, as the cards of a building's own cells
 * always were, while the same model outdoors in the world's pass takes the sum. A shared uniform read at each
 * pass's first draw of a material (three uploads a material's uniforms anew in every `render` call), so nothing
 * compiles and nothing is per object.
 */
export function setCardRoomPass(on: boolean): void {
  if (roomPass === on) return;
  roomPass = on;
  CARD_LIGHT_UNIFORMS.uSwgCardOn.value = CARD_LIGHT_TUNE.on && ready && !roomPass ? 1 : 0;
}

/** One card's own uniforms: its emissive and its crown's box. Kept per material so a recompile reuses them. */
interface MaterialLight {
  swgCardEmissive: THREE.IUniform<THREE.Vector3>;
  swgLeafBoxMin: THREE.IUniform<THREE.Vector3>;
  swgLeafBoxMax: THREE.IUniform<THREE.Vector3>;
}
const perMaterial = new WeakMap<THREE.Material, MaterialLight>();

/** A card's own uniforms, made from its `userData.swgCardEmissive` and `userData.swgLeaf` the first time they are asked for. */
export function cardLightUniformsOf(mat: THREE.Material): MaterialLight {
  let u = perMaterial.get(mat);
  if (!u) {
    const e = mat.userData.swgCardEmissive as number[] | undefined;
    const box = mat.userData.swgLeaf as LeafBox | undefined;
    u = {
      swgCardEmissive: { value: new THREE.Vector3(e?.[0] ?? 0, e?.[1] ?? 0, e?.[2] ?? 0) },
      swgLeafBoxMin: { value: new THREE.Vector3(box?.min[0] ?? 0, box?.min[1] ?? 0, box?.min[2] ?? 0) },
      swgLeafBoxMax: { value: new THREE.Vector3(box?.max[0] ?? 0, box?.max[1] ?? 0, box?.max[2] ?? 0) },
    };
    perMaterial.set(mat, u);
  }
  return u;
}

/** A crown's box changed after its uniforms were made (the sway's pad, measured after the card rule): written into them in place. */
export function setLeafBox(mat: THREE.Material, box: LeafBox): void {
  mat.userData.swgLeaf = { min: [...box.min], max: [...box.max] };
  const u = perMaterial.get(mat);
  if (u) {
    u.swgLeafBoxMin.value.set(box.min[0], box.min[1], box.min[2]);
    u.swgLeafBoxMax.value.set(box.max[0], box.max[1], box.max[2]);
  }
}

/** Grow a material's crown box by a margin (the sway's largest excursion, so a swayed leaf stays inside its own crown). */
export function padLeafBox(mat: THREE.Material, pad: number): void {
  const box = mat.userData.swgLeaf as LeafBox | undefined;
  if (box && pad > 0) setLeafBox(mat, padBox(box, pad));
}

/** What the light has done this session, for the console. */
export const CARD_LIGHT_STATS = { marked: 0, injected: 0, missingAnchor: 0, missing: [] as string[], replaced: {} as Record<string, number>, notReceiving: 0 };

/**
 * Give a card the light's and the skip's defines, before anything compiles: a define is in the program key, so
 * every card shares one program per variant and moving any knob afterwards compiles nothing. A card of a
 * building's own cells keeps three's light (its rooms are lit by their own lamps, which the sum knows nothing of),
 * and so does a card when its escape hatch is set; a card that merely stands in a room is put on three's light by
 * the rooms pass itself (`setCardRoomPass`), since its material is the one its model wears outdoors too.
 */
export function markCardLight(mat: THREE.Material): void {
  if (mat.userData.interior) return;
  const defines = (mat.defines ??= {}) as Record<string, string>;
  let did = false;
  if (CARD_LIGHT_ON && defines.SWG_CARD_LIGHT === undefined) {
    defines.SWG_CARD_LIGHT = '';
    did = true;
  }
  if (LEAF_SHADOW_ON && mat.userData.swgLeaf && defines.SWG_LEAF_SHADOW === undefined) {
    defines.SWG_LEAF_SHADOW = '';
    did = true;
  }
  if (did) CARD_LIGHT_STATS.marked++;
}

// ---------------------------------------------------------------- the text

/** Vertex declarations: the stored normal's varying and the leaf capture's. */
export const CARD_LIGHT_VERTEX_PARS = /* glsl */ `
#ifdef SWG_CARD_LIGHT
varying vec3 vSwgStoredNormal;
#endif
#ifdef SWG_LEAF_SHADOW
uniform vec3 uSwgLeafSun;
varying vec3 vSwgLeafPos;
varying vec3 vSwgLeafSun;
varying float vSwgLeafScale;
#endif
// On a card the shadow lookup is offset toward each directional light, never along a normal that may face
// away from it: minus the third row of the light's own shadow matrix, normalised (cardLight.ts).
vec3 swgCardShadowDir( const in mat4 swgShadowMatrix, const in vec3 swgNormal ) {
	#ifdef SWG_CARD_LIGHT
		vec3 swgRow = vec3( swgShadowMatrix[ 0 ][ 2 ], swgShadowMatrix[ 1 ][ 2 ], swgShadowMatrix[ 2 ][ 2 ] );
		float swgRowLen = length( swgRow );
		return swgRowLen > 1e-8 ? - swgRow / swgRowLen : swgNormal;
	#else
		return swgNormal;
	#endif
}
`;

/** Vertex, after the card rule's stored normal: carried to the pixel stage transformed as three transforms its own normal. */
export const CARD_LIGHT_STORED = /* glsl */ `
#ifdef SWG_CARD_LIGHT
{
	vec3 swgStoredView = swgStoredNormal;
	#ifdef USE_INSTANCING
		mat3 swgIm = mat3( instanceMatrix );
		swgStoredView /= vec3( dot( swgIm[ 0 ], swgIm[ 0 ] ), dot( swgIm[ 1 ], swgIm[ 1 ] ), dot( swgIm[ 2 ], swgIm[ 2 ] ) );
		swgStoredView = swgIm * swgStoredView;
	#endif
	vSwgStoredNormal = normalMatrix * swgStoredView;
}
#endif
`;

/**
 * Vertex, after `#include <begin_vertex>`: the leaf's place in its model's frame, the sun turned into that frame
 * and the planting's scale, for the skip. The sway wrap goes on later at the same anchor, so its text lands
 * before this one and this reads the swayed place, which is the one the shadow lookup uses.
 */
export const LEAF_CAPTURE = /* glsl */ `
#ifdef SWG_LEAF_SHADOW
{
	mat4 swgLeafModel = modelMatrix;
	#ifdef USE_INSTANCING
		swgLeafModel = modelMatrix * instanceMatrix;
	#endif
	mat3 swgLeafBasis = mat3( swgLeafModel );
	vSwgLeafPos = transformed;
	vSwgLeafSun = normalize( transpose( swgLeafBasis ) * uSwgLeafSun );
	vSwgLeafScale = length( swgLeafBasis[ 0 ] );
}
#endif
`;

/** Three's directional shadow offset, and the card's in its place. */
export const SHADOW_OFFSET = 'shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );';
export const SHADOW_OFFSET_CARD = 'shadowWorldPosition = worldPosition + vec4( swgCardShadowDir( directionalShadowMatrix[ i ], shadowWorldNormal ) * directionalLightShadows[ i ].shadowNormalBias, 0 );';

/**
 * The `'client'` curve's functions: a display value carried back through three's ACES fit to the scene value that
 * shows it, and sRGB's two ways. Its own text so the grass (`grass.ts`), which takes no light of three's and so
 * cannot carry the card's whole declarations, runs these very lines.
 */
export const CARD_CURVE_PARS = /* glsl */ `// Three's ACES fit carried back (cardLightMath.ts): its two matrices inverted, its quadratic solved per channel.
const mat3 SWG_ACES_IN_INV = ${glslMat3(ACES_IN_INV)};
const mat3 SWG_ACES_OUT_INV = ${glslMat3(ACES_OUT_INV)};
vec3 swgCardToSrgb( const in vec3 c ) {
	return mix( pow( max( c, vec3( 0.0 ) ), vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), c * 12.92, vec3( lessThan( c, vec3( 0.0031308 ) ) ) );
}
vec3 swgCardToLinear( const in vec3 c ) {
	return mix( pow( max( c, vec3( 0.0 ) ) * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), c * 0.0773993808, vec3( lessThan( c, vec3( 0.04045 ) ) ) );
}
vec3 swgAcesInverse( const in vec3 display ) {
	vec3 swgV = clamp( SWG_ACES_OUT_INV * clamp( display, 0.0, 1.0 ), 0.0, 1.0 );
	vec3 swgA = 1.0 - 0.983729 * swgV;
	vec3 swgB = 0.0245786 - 0.432951 * swgV;
	vec3 swgC = - ( 0.000090537 + 0.238081 * swgV );
	vec3 swgF = ( - swgB + sqrt( max( swgB * swgB - 4.0 * swgA * swgC, 0.0 ) ) ) / ( 2.0 * swgA );
	return max( SWG_ACES_IN_INV * swgF * 0.6, 0.0 );
}
`;

/** Fragment declarations: the knobs, the colours, a card's own, the captured factors and the curve's functions. */
export const CARD_LIGHT_PARS = /* glsl */ `
float swgShadowNow = 1.0;
float swgSunShadow = 0.0;
#ifdef SWG_CARD_LIGHT
uniform float uSwgCardOn;
uniform float uSwgCardCurve;
uniform vec3 uSwgCardFront;
uniform vec3 uSwgCardTangent;
uniform vec3 uSwgCardBack;
uniform vec3 uSwgCardAmbient;
uniform vec3 uSwgCardFill;
uniform vec3 uSwgCardBounce;
uniform vec3 uSwgCardRow7;
uniform float uSwgCardRow7Alpha;
uniform vec3 uSwgCardFillDir;
uniform vec3 uSwgCardBounceDir;
uniform float uSwgCardFills;
uniform float uSwgCardEmissiveOn;
uniform float uSwgCardGain;
uniform float uSwgCardExposureRef;
uniform float uSwgCardBloomCap;
uniform float uSwgCardShadowLook;
uniform float uSwgCardSunSide;
uniform float uSwgCardPointFlat;
uniform vec3 swgCardEmissive;
varying vec3 vSwgStoredNormal;
${CARD_CURVE_PARS}#endif
#ifdef SWG_LEAF_SHADOW
uniform vec3 swgLeafBoxMin;
uniform vec3 swgLeafBoxMax;
uniform vec4 uSwgLeafRange;
uniform float uSwgLeafSelf;
uniform float uSwgLeafShare;
uniform float uSwgLeafAcne;
varying vec3 vSwgLeafPos;
varying vec3 vSwgLeafSun;
varying float vSwgLeafScale;
float swgLeafSkip = 0.0;
#endif
// The bias and the share a card's directional lookup is handed (leafShadow.ts): its cascade's own, lowered by
// the floor and by how far its ray toward the sun stays inside its own crown, that skip's metres taken into this
// cascade's own depth by its own range (the cascades' ranges differ: the far one reaches its whole band).
float swgLeafBias( const in float swgBias, const in int swgCascade ) {
	#ifdef SWG_LEAF_SHADOW
		float swgRange = swgCascade == 0 ? uSwgLeafRange.x : ( swgCascade == 1 ? uSwgLeafRange.y : ( swgCascade == 2 ? uSwgLeafRange.z : uSwgLeafRange.w ) );
		return swgBias * ( 1.0 + 2.0 * uSwgLeafAcne * uSwgLeafSelf ) - swgLeafSkip / max( swgRange, 1e-3 ) * uSwgLeafSelf;
	#else
		return swgBias;
	#endif
}
float swgLeafIntensity( const in float swgIntensity ) {
	#ifdef SWG_LEAF_SHADOW
		return swgIntensity * uSwgLeafShare;
	#else
		return swgIntensity;
	#endif
}
// Three's own light put out before an RE_Direct that would light a card with the sun or the fill: the sum carries both.
void swgCardSunOff( inout IncidentLight swgLight ) {
	#ifdef SWG_CARD_LIGHT
		if ( uSwgCardOn > 0.5 ) swgLight.color = vec3( 0.0 );
	#endif
}
`;

/**
 * After `#include <lights_fragment_end>`: the client's sum, the curve, and the card's indirect light without the
 * hemisphere. Guarded by `NUM_DIR_LIGHTS > 0` (the sun is the first directional light: the cascades are sorted
 * first and share one direction) and live through `uSwgCardOn`.
 */
export const CARD_LIGHT_SUM = /* glsl */ `
#ifdef SWG_CARD_LIGHT
#if NUM_DIR_LIGHTS > 0
if ( uSwgCardOn > 0.5 ) {
	vec3 swgCardN = normal;
	if ( uSwgCardSunSide > 0.5 ) {
		float swgStoredLen = length( vSwgStoredNormal );
		swgCardN = swgStoredLen > 1e-6 ? vSwgStoredNormal / swgStoredLen : normal;
	}
	vec3 swgSunDir = directionalLights[ 0 ].direction;
	float swgD = clamp( dot( swgCardN, swgSunDir ), -1.0, 1.0 );
	vec3 swgFillDir = normalize( ( viewMatrix * vec4( uSwgCardFillDir, 0.0 ) ).xyz );
	vec3 swgBounceDir = normalize( ( viewMatrix * vec4( uSwgCardBounceDir, 0.0 ) ).xyz );
	float swgRise = uSwgCardShadowLook > 0.5 ? 1.0 : clamp( swgSunShadow, 0.0, 1.0 );
	vec3 swgMain = swgD >= 0.0 ? mix( uSwgCardTangent, uSwgCardFront, swgD * swgRise ) : mix( uSwgCardTangent, uSwgCardBack, - swgD );
	vec3 swgSum = uSwgCardAmbient + uSwgCardEmissiveOn * swgCardEmissive + swgMain;
	if ( uSwgCardFills > 0.5 ) swgSum += uSwgCardFill * max( dot( swgCardN, swgFillDir ), 0.0 );
	if ( uSwgCardFills > 1.5 ) swgSum += uSwgCardBounce * max( dot( swgCardN, swgBounceDir ), 0.0 );
	vec3 swgG = clamp( swgSum * uSwgCardGain, 0.0, 1.0 );
	vec3 swgCardColour;
	if ( uSwgCardCurve < 0.5 ) {
		vec3 swgDisplay = clamp( swgCardToSrgb( diffuseColor.rgb ) * swgG, 0.0, 1.0 );
		if ( uSwgCardShadowLook > 0.5 ) swgDisplay = mix( swgDisplay, uSwgCardRow7, uSwgCardRow7Alpha * ( 1.0 - clamp( swgSunShadow, 0.0, 1.0 ) ) );
		swgCardColour = swgAcesInverse( swgCardToLinear( swgDisplay ) ) / max( uSwgCardExposureRef, 1e-3 );
		float swgCardLum = dot( swgCardColour, vec3( 0.2126, 0.7152, 0.0722 ) );
		if ( swgCardLum > uSwgCardBloomCap ) swgCardColour *= uSwgCardBloomCap / swgCardLum;
	} else {
		vec3 swgFull = directionalLights[ 0 ].color;
		#if NUM_HEMI_LIGHTS > 0
			swgFull += getHemisphereLightIrradiance( hemisphereLights[ 0 ], swgSunDir );
		#endif
		swgCardColour = BRDF_Lambert( diffuseColor.rgb ) * swgFull * swgCardToLinear( swgG ) / max( swgCardToLinear( uSwgCardFront ), vec3( 1e-4 ) );
	}
	reflectedLight.directDiffuse += swgCardColour;
	reflectedLight.indirectDiffuse = BRDF_Lambert( material.diffuseColor ) * ambientLightColor;
}
#endif
#endif
`;

const COMMON = '#include <common>';
const BEGIN_VERTEX = '#include <begin_vertex>';
const SHADOWMAP_VERTEX = '#include <shadowmap_vertex>';
const LIGHTS_BEGIN = '#include <lights_fragment_begin>';
const LIGHTS_END = '#include <lights_fragment_end>';

/** The card rule's stored-normal line, which the stored normal's varying is written straight after. */
export const STORED_LINE = 'if ( uSwgCardBacksStored > 0.5 ) objectNormal = swgStoredNormal;';

/** Warned once per missing anchor, so a shader three changes under us says so without filling the console. */
const warned = new Set<string>();
function warnMissing(anchor: string): void {
  CARD_LIGHT_STATS.missingAnchor++;
  if (!CARD_LIGHT_STATS.missing.includes(anchor)) CARD_LIGHT_STATS.missing.push(anchor);
  if (warned.has(anchor)) return;
  warned.add(anchor);
  console.warn(`cardLight: no ${anchor} in this shader, so its leaves keep three's own light`);
}

/** Insert after the first `anchor`. */
function after(source: string, anchor: string, code: string): string {
  const end = source.indexOf(anchor) + anchor.length;
  return `${source.slice(0, end)}\n${code}${source.slice(end)}`;
}

/**
 * The card light and the leaf skip, into one compiled shader the card rule has already written (its stored
 * normal line must be there), with this material's own uniforms. Every anchor must be there or nothing of the
 * light is written at all, which is said: a declaration with no use compiles, a use with no declaration does
 * not, and a program that fails to link draws nothing. Answers whether it went in.
 */
export function injectCardLight(shader: THREE.WebGLProgramParametersWithUniforms, mat: THREE.Material, chunk: string = THREE.ShaderChunk.lights_fragment_begin): boolean {
  const vs = shader.vertexShader;
  const fs = shader.fragmentShader;
  const lackV = [COMMON, BEGIN_VERTEX, SHADOWMAP_VERTEX, STORED_LINE].find((a) => !vs.includes(a));
  const lackF = [COMMON, LIGHTS_BEGIN, LIGHTS_END].find((a) => !fs.includes(a));
  if (lackV || lackF) {
    warnMissing((lackV ?? lackF)!);
    return false;
  }
  const shadowmap = THREE.ShaderChunk.shadowmap_vertex;
  if (!shadowmap.includes(SHADOW_OFFSET)) {
    warnMissing("three's directional shadow offset");
    return false;
  }
  const edit = cardLightsBegin(chunk);
  if (edit.missing.length) {
    warnMissing(`the cascades' ${edit.missing[0]}`);
    return false;
  }
  let v = after(vs, COMMON, CARD_LIGHT_VERTEX_PARS);
  v = after(v, STORED_LINE, CARD_LIGHT_STORED);
  v = after(v, BEGIN_VERTEX, LEAF_CAPTURE);
  // Replaced through functions, so nothing in a chunk's text is ever read as a replacement pattern.
  const offset = shadowmap.replace(SHADOW_OFFSET, () => SHADOW_OFFSET_CARD);
  v = v.replace(SHADOWMAP_VERTEX, () => offset);
  let f = after(fs, COMMON, CARD_LIGHT_PARS);
  f = f.replace(LIGHTS_BEGIN, () => edit.text);
  f = after(f, LIGHTS_END, CARD_LIGHT_SUM);
  shader.vertexShader = v;
  shader.fragmentShader = f;
  Object.assign(shader.uniforms, CARD_LIGHT_UNIFORMS, cardLightUniformsOf(mat));
  CARD_LIGHT_STATS.injected++;
  for (const [k, n] of Object.entries(edit.counts)) CARD_LIGHT_STATS.replaced[k] = (CARD_LIGHT_STATS.replaced[k] ?? 0) + n;
  CARD_LIGHT_STATS.replaced['shadow offset'] = (CARD_LIGHT_STATS.replaced['shadow offset'] ?? 0) + 1;
  return true;
}

// ---------------------------------------------------------------- the frame's colours and sun

/** The ramp rows the sky hands over for the card light, in linear light, with their alpha scales and the shadow row's alpha. */
export interface CardSkyRows {
  front: THREE.Color;
  tangent: THREE.Color;
  back: THREE.Color;
  ambient: THREE.Color;
  fill: THREE.Color;
  bounce: THREE.Color;
  shadow: THREE.Color;
  frontScale: number;
  tangentScale: number;
  backScale: number;
  ambientScale: number;
  fillScale: number;
  bounceScale: number;
  /** The shadow row's alpha, over 255. */
  shadowAlpha: number;
}

/** How the sky reads its ramp at a row and the frame's column, blended over its mix (`SwgSky`'s own readers). */
export interface RampRead {
  /** The colour in linear light, or the fallback grey where a block has no such row. */
  color(row: number, index: number, out: THREE.Color, fallback: number): THREE.Color;
  /** The light scale the row's alpha stores (four times its distance over half way, over half way). */
  scale(row: number, index: number): number;
  /** The row's alpha over 255. */
  alpha(row: number, index: number, fallback: number): number;
}

/**
 * The card light's rows out of the sky's ramp at the frame's column, at the rows `rows` names (`CARD_ROWS`, live):
 * what `SwgSky.update` hands `updateCardLight` through `World.applySwgLighting`. Writes into `out`; allocates
 * nothing. A function of its own so the node test reads the rows the game reads, with a ramp of its own.
 */
export function readCardRows(out: CardSkyRows, ramp: RampRead, index: number, rows: CardRows = CARD_ROWS): CardSkyRows {
  ramp.color(rows.front, index, out.front, 1);
  out.frontScale = ramp.scale(rows.front, index);
  ramp.color(rows.tangent, index, out.tangent, 0.5);
  out.tangentScale = ramp.scale(rows.tangent, index);
  ramp.color(rows.back, index, out.back, 0.1);
  out.backScale = ramp.scale(rows.back, index);
  ramp.color(rows.ambient, index, out.ambient, 0);
  out.ambientScale = ramp.scale(rows.ambient, index);
  ramp.color(rows.fill, index, out.fill, 0);
  out.fillScale = ramp.scale(rows.fill, index);
  ramp.color(rows.bounce, index, out.bounce, 0);
  out.bounceScale = ramp.scale(rows.bounce, index);
  ramp.color(rows.shadow, index, out.shadow, 0);
  out.shadowAlpha = ramp.alpha(rows.shadow, index, 0);
  return out;
}

const tmpColour = new THREE.Color();

/** One row into its uniform as the ramp's bytes over 255 (three's own conversion back), times its alpha scale where the tune reads the alpha as one. */
function bytesInto(out: THREE.Vector3, linear: THREE.Color, scale: number, t: CardLightTune): void {
  tmpColour.copy(linear).convertLinearToSRGB();
  const s = t.rampScale === 'alpha' ? scale : 1;
  out.set(tmpColour.r * s, tmpColour.g * s, tmpColour.b * s);
}

/**
 * The frame's colours and sun into the shared uniforms, from `World.applySwgLighting`: the rows the sky blended in
 * linear light turned back into bytes (blending them in linear light first is ours; the client's own blend is
 * client code), the sun's direction (toward it), the fill's (our runtime's own, 45 degrees up on the far side
 * from the sun) and each cascade's depth range (`range`: one number for every cascade, or each cascade's own in order, a
 * cascade past the list taking the last; a range of nought or less leaves the one there). Writes into the existing
 * vectors and allocates nothing.
 */
export function updateCardLight(rows: CardSkyRows, sun: THREE.Vector3, range: number | ArrayLike<number>): void {
  const t = CARD_LIGHT_TUNE;
  const u = CARD_LIGHT_UNIFORMS;
  bytesInto(u.uSwgCardFront.value, rows.front, rows.frontScale, t);
  bytesInto(u.uSwgCardTangent.value, rows.tangent, rows.tangentScale, t);
  bytesInto(u.uSwgCardBack.value, rows.back, rows.backScale, t);
  bytesInto(u.uSwgCardAmbient.value, rows.ambient, rows.ambientScale, t);
  bytesInto(u.uSwgCardFill.value, rows.fill, rows.fillScale, t);
  bytesInto(u.uSwgCardBounce.value, rows.bounce, rows.bounceScale, t);
  bytesInto(u.uSwgCardRow7.value, rows.shadow, 1, t);
  u.uSwgCardRow7Alpha.value = rows.shadowAlpha;
  const l = sun.length();
  if (l > 1e-6) {
    u.uSwgLeafSun.value.copy(sun).multiplyScalar(1 / l);
    const h = Math.hypot(sun.x, sun.z);
    // The fill hangs where our runtime hangs its own: up 45 degrees on the far side from the sun.
    if (h > 1e-6) u.uSwgCardFillDir.value.set(-sun.x / h, 1, -sun.z / h).normalize();
    else u.uSwgCardFillDir.value.set(0, 1, 0);
  }
  const ranges = u.uSwgLeafRange.value;
  if (typeof range === 'number') {
    if (range > 0) ranges.setScalar(range);
  } else {
    let last = 0;
    for (let i = 0; i < 4; i++) {
      const v = i < range.length ? range[i] : last;
      if (v > 0) {
        ranges.setComponent(i, v);
        last = v;
      }
    }
  }
  if (!ready) {
    ready = true;
    writeCardLightUniforms();
  }
}

/** Change the knobs live (`__debug.cardLight`): anything not a usable value is left as it was. Uniforms, and for `shadow: 'none'` a walk the caller makes; nothing compiles. */
export function setCardLightTune(o: Partial<Omit<CardLightTune, 'rows'>> & { rows?: Partial<CardRows> }): CardLightTune {
  const t = CARD_LIGHT_TUNE;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (typeof o.on === 'boolean') t.on = o.on;
  if (o.curve === 'client' || o.curve === 'scene') t.curve = o.curve;
  if (o.rampScale === 'bytes' || o.rampScale === 'alpha') t.rampScale = o.rampScale;
  if (o.fills === 'both' || o.fills === 'fill' || o.fills === 'none') t.fills = o.fills;
  if (typeof o.emissive === 'boolean') t.emissive = o.emissive;
  if (num(o.gain) && o.gain >= 0) t.gain = o.gain;
  if (num(o.exposureRef) && o.exposureRef > 0) t.exposureRef = o.exposureRef;
  if (num(o.bloomCap) && o.bloomCap > 0) t.bloomCap = o.bloomCap;
  if (o.shadow === 'self' || o.shadow === 'all' || o.shadow === 'none') t.shadow = o.shadow;
  if (o.shadowLook === 'rise' || o.shadowLook === 'row7') t.shadowLook = o.shadowLook;
  if (num(o.share)) t.share = Math.min(1, Math.max(0, o.share));
  if (num(o.acne) && o.acne >= 0) t.acne = o.acne;
  if (o.sunSide === 'face' || o.sunSide === 'stored') t.sunSide = o.sunSide;
  if (num(o.pointFlat)) t.pointFlat = Math.min(1, Math.max(0, o.pointFlat));
  if (o.rows) for (const k of Object.keys(CARD_ROWS) as (keyof CardRows)[]) if (num(o.rows[k]) && o.rows[k]! >= 0 && o.rows[k]! <= 9) CARD_ROWS[k] = Math.round(o.rows[k]!);
  writeCardLightUniforms(t);
  return { ...t, rows: { ...CARD_ROWS } };
}

/**
 * Whether a card mesh receives shadows under the rule in force: every one does under `self` and `all` (the skip is
 * in its program); under `none` a card mesh of a tree that casts receives nothing, decided by the cast rule at
 * its finest level (a flora batch's `base`), never the live `castShadow`, or a tree would start receiving when
 * its lowest level stops casting. A trunk or any material that is not a card always receives.
 */
export function cardReceives(material: THREE.Material | THREE.Material[], castsAtFinest: boolean): boolean {
  if (CARD_LIGHT_TUNE.shadow !== 'none' || !castsAtFinest) return true;
  const m = Array.isArray(material) ? material[0] : material;
  return !(m && m.userData.swgCardBlend !== undefined);
}
