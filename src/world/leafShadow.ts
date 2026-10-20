// No tree shades its own leaves: the pure half of the leaf shadow (B's rule `self`), and the one text edit the
// card light and the leaf shadow make to the cascades' light chunk. Pure: no three at run time, so a node test
// reads the real `CSMShader.lights_fragment_begin` through it.
//
// **The owner's rule** (answer 3): shadows fall on the ground, the trunks, the shrubs and the buildings, and a
// leaf takes every shadow but its own tree's. Measured in dense stands rebuilt with the game's planting rule,
// a tree's own crown was 12 to 53% of the leaf shade on the forest worlds; the rest is neighbours and
// buildings, which a leaf keeps (a neighbour's crown on a leaf is ours: the client's leaves took no leaf's
// shadow at all, which needs a shadow map of everything but leaves).
//
// **How.** A shadow lookup counts an occluder only when it lies nearer the sun than the receiver by more than
// the bias. So a card's lookups are handed a bias lowered by how far the ray from the leaf toward the sun stays
// inside its own crown -- the box of its model's card vertices in the model's own frame -- converted to the
// light's depth: the light camera is orthographic, so metres convert by one division, by the range (far less near)
// of the cascade being looked up (`uSwgLeafRange`, one a cascade, picked by the lookup's own index): the cascades'
// ranges are not one number, the far map's reaching its whole band (`farDepth` 'whole'), and divided by the near
// cascade's range the far band's leaves skipped about twice the metres they should. An occluder inside the crown
// along that ray does not count; one beyond it (a neighbour, a wall) does. A more negative bias lightens (the depth is not
// reversed). The skip has a floor in texels of each cascade (`acne`, 4), since three's five-tap lookup with
// its one-texel normal bias made a sunlit card whose normals lie in its own plane lose 18 to 47% of its sun
// to its own surface.
//
// **The cascades' chunk has five places that light a surface** (read, three 0.185.1's `CSMShader.js`): the
// fade branch the game takes (its lookup at :156, its `RE_Direct` at :162), the no-fade branch (:188, :190),
// the one-light branch with Shadows off (:199-200: the Graphics setting flips only `shadowMap.enabled`), the
// lights that cast no shadow (:214, our fill) and the no-cascade branch (:240, :243), which no card ever
// takes and which is left byte for byte as three wrote it. The two lookups are edited for the skip and the
// share; the factor each returns is captured into `swgSunShadow` with the fade branch's own weights (the last
// cascade's fade, and the overlap blend, whose two ratios sum to one), so the card light knows how much sun the
// cascades let through; and three's own light is put out before the four `RE_Direct` calls that would light a
// card with the sun or the fill (the card light's own sum carries both). Every edit names its anchor and is
// counted, and a chunk missing any anchor is not edited at all (`cardLightsBegin` answers null) and is said.

/** A box, plain arrays (the `userData` lesson: never a typed array on a material). */
export interface LeafBox {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * How far a ray from `p` along the unit `dir` stays inside `box` before it leaves it, in the box's units, scaled
 * by `scale`: the slab exit, never under nought (a box behind the point skips nothing). A zero component of the
 * direction is taken as the smallest step either way, as the shader takes it, so no division is by nought.
 */
export function crownExit(box: LeafBox, p: readonly number[], dir: readonly number[], scale = 1): number {
  let exit = Number.POSITIVE_INFINITY;
  for (let k = 0; k < 3; k++) {
    const d = dir[k] >= 0 ? Math.max(dir[k], 1e-6) : Math.min(dir[k], -1e-6);
    const t1 = (box.min[k] - p[k]) / d;
    const t2 = (box.max[k] - p[k]) / d;
    exit = Math.min(exit, Math.max(t1, t2));
  }
  return Math.max(exit, 0) * scale;
}

/** How much the skip's floor adds to a cascade's own bias, in the light's depth: `2 × |bias| × acne` (the bias × (1 + 2 × acne) the shader passes). */
export function acneFloor(shadowBias: number, acne: number): number {
  return 2 * Math.abs(shadowBias) * acne;
}

/** The bias a card's lookup is handed: its cascade's own, lowered by the floor and by the skip converted to depth (`self` 1 under the rule, 0 under `all`). */
export function leafBias(shadowBias: number, skipMetres: number, range: number, acne: number, self: number): number {
  return shadowBias * (1 + 2 * acne * self) - (skipMetres / Math.max(range, 1e-3)) * self;
}

/**
 * Whether a point is shadowed by one occluder at `occluderDepth` along the light (metres from the light, as the
 * map stores it), as the lookup judges it with a card's bias: lit while the receiver's depth plus the bias in
 * metres is no further than the occluder. The JavaScript mirror the leaf shadow's test reasons with.
 */
export function shadowedBy(receiverDepth: number, occluderDepth: number, biasDepth: number, range: number): boolean {
  return receiverDepth + biasDepth * range > occluderDepth;
}

/** The box of a list of positions (three numbers a point, already in the model's frame), or null for none. */
export function boxOf(points: ArrayLike<number>, into: LeafBox | null = null): LeafBox | null {
  let box = into;
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];
    if (!box) {
      box = { min: [x, y, z], max: [x, y, z] };
      continue;
    }
    if (x < box.min[0]) box.min[0] = x;
    if (y < box.min[1]) box.min[1] = y;
    if (z < box.min[2]) box.min[2] = z;
    if (x > box.max[0]) box.max[0] = x;
    if (y > box.max[1]) box.max[1] = y;
    if (z > box.max[2]) box.max[2] = z;
  }
  return box;
}

/** A box grown by a margin every way (the sway's largest excursion): a new plain box. */
export function padBox(box: LeafBox, pad: number): LeafBox {
  return { min: [box.min[0] - pad, box.min[1] - pad, box.min[2] - pad], max: [box.max[0] + pad, box.max[1] + pad, box.max[2] + pad] };
}

// ---------------------------------------------------------------- the cascades' chunk, edited

/** The cascades' branch the edits are made inside, and the branch after it that is left as three wrote it. */
const CSM_BLOCK = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && defined( USE_CSM ) && defined( CSM_CASCADES )';
const PLAIN_BLOCK = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && !defined( USE_CSM ) && !defined( CSM_CASCADES )';
/** Every directional lookup's call: the fade branch's, the no-fade branch's and the plain branch's are this text. */
const LOOKUP = 'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )';
/**
 * The same call with the card's share and bias, the bias handed the cascade's index (the unrolled loop's own, a constant
 * in every copy) so the skip goes into that cascade's own depth range.
 */
const LOOKUP_CARD = 'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, swgLeafIntensity( directionalLightShadow.shadowIntensity ), swgLeafBias( directionalLightShadow.shadowBias, UNROLLED_LOOP_INDEX ), directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )';

/** The fade branch's lookup (:156). */
export const FADE_LOOKUP = `directLight.color *= ( directLight.visible && receiveShadow ) ? ${LOOKUP} : 1.0;`;
/** The fade branch's line just before its `RE_Direct` (:161). */
export const FADE_BEFORE_DIRECT = 'ReflectedLight prevLight = reflectedLight;';
/** The fade branch's overlap weight (:165), after which the captured factor is added. */
export const FADE_BLEND = 'float blendRatio = shouldBlend ? ratio : 1.0;';
/** The no-fade branch's lookup (:188). */
export const NOFADE_LOOKUP = `if(linearDepth >= CSM_cascades[UNROLLED_LOOP_INDEX].x && linearDepth < CSM_cascades[UNROLLED_LOOP_INDEX].y) directLight.color *= ( directLight.visible && receiveShadow ) ? ${LOOKUP} : 1.0;`;
/** The no-fade branch's `RE_Direct` (:190). */
export const NOFADE_DIRECT = 'if(linearDepth >= CSM_cascades[UNROLLED_LOOP_INDEX].x && (linearDepth < CSM_cascades[UNROLLED_LOOP_INDEX].y || UNROLLED_LOOP_INDEX == CSM_CASCADES - 1)) RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
/** The one-light branch's light (:199), with Shadows off. */
export const ONE_LIGHT = 'getDirectionalLightInfo( directionalLights[0], directLight );';
/** The loop over the lights that cast no shadow (:208), and its light (:212): the fill. */
export const UNSHADOWED_LOOP = 'for ( int i = NUM_DIR_LIGHT_SHADOWS; i < NUM_DIR_LIGHTS; i ++ ) {';
export const UNSHADOWED_LIGHT = 'getDirectionalLightInfo( directionalLight, directLight );';
/** Where the chunk declares the normal the light loops shade with (:17): our own lights' blend toward the leaf's face goes straight after. */
export const GEOMETRY_NORMAL = 'vec3 geometryNormal = normal;';

/** What the edit made of the chunk: the text, how many of each edit went in, and any anchor it could not find. */
export interface LightsBeginEdit {
  text: string;
  counts: Record<string, number>;
  missing: string[];
}

/**
 * The cascades' `lights_fragment_begin` with the card light's and the leaf shadow's edits, every one under its
 * own define so the same text serves a card with either or both: the skip worked out once before any light,
 * the two directional lookups taking the card's share and bias and capturing their factor, three's light put
 * out before the sun's three `RE_Direct` and the fill's, and our own lights' normal blended toward the face.
 * Null, with the anchors named, when any is missing: a half-edited chunk would light a card twice or not at all.
 */
export function cardLightsBegin(chunk: string): LightsBeginEdit {
  const counts: Record<string, number> = {};
  const missing: string[] = [];
  const block = chunk.indexOf(CSM_BLOCK);
  const plain = chunk.indexOf(PLAIN_BLOCK, block + 1);
  if (block < 0) missing.push('the cascades\' branch');
  if (plain < 0) missing.push('the no-cascade branch after it');
  const geo = chunk.indexOf(GEOMETRY_NORMAL);
  if (geo < 0) missing.push(GEOMETRY_NORMAL);
  if (missing.length) return { text: chunk, counts, missing };
  const head = chunk.slice(0, block);
  let mid = chunk.slice(block, plain);
  const tail = chunk.slice(plain);
  /** Replace the one occurrence of `anchor` inside the cascades' branch, or say it is missing. */
  const once = (anchor: string, by: string, name: string) => {
    const at = mid.indexOf(anchor);
    if (at < 0 || mid.indexOf(anchor, at + anchor.length) >= 0) {
      missing.push(name);
      return;
    }
    mid = mid.slice(0, at) + by + mid.slice(at + anchor.length);
    counts[name] = (counts[name] ?? 0) + 1;
  };
  // The no-fade lookup first: its line ends in the fade branch's very text, which is unique only once it is gone.
  once(NOFADE_LOOKUP, `swgShadowNow = 1.0;\n\t\t\t\tif(linearDepth >= CSM_cascades[UNROLLED_LOOP_INDEX].x && linearDepth < CSM_cascades[UNROLLED_LOOP_INDEX].y) swgShadowNow = ( directLight.visible && receiveShadow ) ? ${LOOKUP_CARD} : 1.0;\n\t\t\t\tdirectLight.color *= swgShadowNow;`, 'no-fade lookup');
  once(FADE_LOOKUP, `swgShadowNow = ( directLight.visible && receiveShadow ) ? ${LOOKUP_CARD} : 1.0;\n\t\t\t\t\tdirectLight.color *= swgShadowNow;`, 'fade lookup');
  once(FADE_BEFORE_DIRECT, `${FADE_BEFORE_DIRECT}\n\t\t\t\t\tswgCardSunOff( directLight );`, 'fade light out');
  once(FADE_BLEND, `${FADE_BLEND}\n\t\t\t\t\tswgSunShadow += blendRatio * mix( 1.0, swgShadowNow, shouldFadeLastCascade ? ratio : 1.0 );`, 'fade capture');
  once(NOFADE_DIRECT, `if(linearDepth >= CSM_cascades[UNROLLED_LOOP_INDEX].x && (linearDepth < CSM_cascades[UNROLLED_LOOP_INDEX].y || UNROLLED_LOOP_INDEX == CSM_CASCADES - 1)) { swgSunShadow += swgShadowNow; swgCardSunOff( directLight ); RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight ); }`, 'no-fade light out');
  once(ONE_LIGHT, `${ONE_LIGHT}\n\t\tswgSunShadow = 1.0;\n\t\tswgCardSunOff( directLight );`, 'one-light light out');
  // The fill's: the loop over the lights that cast no shadow, its one `getDirectionalLightInfo` after the loop's head.
  const loop = mid.indexOf(UNSHADOWED_LOOP);
  const light = loop < 0 ? -1 : mid.indexOf(UNSHADOWED_LIGHT, loop);
  if (light < 0) missing.push('the unshadowed lights\' loop');
  else {
    mid = `${mid.slice(0, light + UNSHADOWED_LIGHT.length)}\n\n\t\t\tswgCardSunOff( directLight );${mid.slice(light + UNSHADOWED_LIGHT.length)}`;
    counts['unshadowed light out'] = 1;
  }
  if (missing.length) return { text: chunk, counts, missing };
  // The blend of our own lights' normal toward the leaf's face, straight after the chunk declares the normal.
  const at = head.indexOf(GEOMETRY_NORMAL);
  const top = `${CARD_SKIP}${head.slice(0, at + GEOMETRY_NORMAL.length)}\n${POINT_FLAT}${head.slice(at + GEOMETRY_NORMAL.length)}`;
  counts['point flat'] = 1;
  counts.skip = 1;
  return { text: top + mid + tail, counts, missing };
}

/**
 * Before any light: how far this leaf's ray toward the sun stays inside its own crown, in metres (each lookup takes it
 * into its own cascade's depth, `swgLeafBias`). The direction's components are kept off nought so no division is by
 * it; a box behind the point skips nothing.
 */
const CARD_SKIP = /* glsl */ `
#ifdef SWG_LEAF_SHADOW
{
	vec3 swgLeafDir = vSwgLeafSun;
	swgLeafDir = vec3( swgLeafDir.x >= 0.0 ? max( swgLeafDir.x, 1e-6 ) : min( swgLeafDir.x, -1e-6 ), swgLeafDir.y >= 0.0 ? max( swgLeafDir.y, 1e-6 ) : min( swgLeafDir.y, -1e-6 ), swgLeafDir.z >= 0.0 ? max( swgLeafDir.z, 1e-6 ) : min( swgLeafDir.z, -1e-6 ) );
	vec3 swgLeafT1 = ( swgLeafBoxMin - vSwgLeafPos ) / swgLeafDir;
	vec3 swgLeafT2 = ( swgLeafBoxMax - vSwgLeafPos ) / swgLeafDir;
	vec3 swgLeafFar = max( swgLeafT1, swgLeafT2 );
	float swgLeafExit = min( min( swgLeafFar.x, swgLeafFar.y ), swgLeafFar.z );
	swgLeafSkip = max( swgLeafExit, 0.0 ) * vSwgLeafScale;
}
#endif
`;

/**
 * Our own lights (the torch, the flash pool, a room's lamps) see the leaf's normal blended toward its own face:
 * the face from the screen derivatives of the view position, three's own flat normal, which always faces the
 * viewer. Under the card light the sun and the fill go through three's loops with their colour put out and the
 * hemisphere is gone, so this reaches only the point and spot lights; the client's sum reads `normal`, never
 * `geometryNormal`, so the sun is never blended. The face itself where the blend comes to nothing.
 */
const POINT_FLAT = /* glsl */ `
#ifdef SWG_CARD_LIGHT
if ( uSwgCardOn > 0.5 && uSwgCardPointFlat > 0.0 ) {
	vec3 swgFaceC = cross( dFdx( vViewPosition ), dFdy( vViewPosition ) );
	float swgFaceL = length( swgFaceC );
	vec3 swgFace = swgFaceL > 1e-12 ? swgFaceC / swgFaceL : normal;
	vec3 swgFlat = mix( normal, swgFace, clamp( uSwgCardPointFlat, 0.0, 1.0 ) );
	float swgFlatL = length( swgFlat );
	geometryNormal = swgFlatL > 1e-4 ? swgFlat / swgFlatL : swgFace;
}
#endif
`;
