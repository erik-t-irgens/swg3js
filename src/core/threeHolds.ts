// Three's own lighting, held where three 0.187 changed what a surface looks like.
//
// The game moved from three 0.185.1 to 0.187.0 to follow the library, not to change its picture, and between the two
// three rewrote how a standard material is lit: a direct light's highlight lost its own energy term for a scale worked
// out once a pixel, every light's diffuse was cut by the Fresnel share its highlight takes (direct lights) and by the
// highlight's whole energy (the ambient and the sky's hemisphere), the smoothest a surface can be went from 0.0525 to
// 0.045, the sun's shadow bias turned round under reversed depth, a lamp's shadow compares each of its five taps at a
// depth of its own, and a filtered environment became a cube with mip levels where it was one flat picture of every
// level (so the blur each roughness reads, and the sky's fill, are other numbers). Each is small; together they are
// every lit pixel of the game a little different, which is not what an upgrade of the library may do.
//
// So the lines three 0.185.1 drew with are put back into three's own chunks (`THREE.ShaderChunk`), once, as this module
// loads, before any program can have been built: three reads a chunk when it builds a program, so every material of
// every renderer the page makes is built from the held text, and every injection of the game's own that was written
// against 0.185's lines (the client's highlight replaces the very line the first hold puts back) finds them.
//
// Each hold is one exact piece of 0.187's text and what stands in its place. **All of them or none**: a chunk half
// held would not compile, and a program that does not compile draws nothing, so when any piece is no longer where it
// was (three moved on again) nothing is written, the console says which, and the game draws three's own new look.
// `tools/swg/tests/threeAnchors.test.ts` holds every piece to the installed three, so an upgrade says what moved.
//
// What is held here that 0.185 arguably had wrong: the sun's shadow bias is added under reversed depth, where it should
// be taken off (`sun-shadow-bias`). It is the look the game has had; taking that one hold out is the mend.
// What is not held, because nothing the game draws asks for it: sheen, iridescence, anisotropy, transmission, light
// probes and area lights, whose lines 0.187 also changed.
import { ShaderChunk } from 'three';
import { CUBE_UV_REFLECTION_185, ENV_FILL_185, ENV_FILL_187, ENV_REFLECTION_185, ENV_REFLECTION_187, GGX_MULTISCATTER_185, POINT_SHADOW_185, POINT_SHADOW_187, SUN_BIAS_185, SUN_BIAS_187 } from './threeHoldText.ts';

/** One piece of three's shader text held to what three 0.185.1 had there. */
export interface ChunkHold {
  /** A name for the console and the test. */
  id: string;
  /** Which of three's chunks it is in. */
  chunk: string;
  /** Where the search begins: the first place this text stands (a chunk that says the same line in several functions). */
  after?: string;
  /** The exact text of three 0.187.0, found once (once from `after` on, and no further than `within` characters past it). */
  find: string;
  /** How far past `after` the text may stand. */
  within?: number;
  /** What stands in its place. */
  put: string;
  /** What 0.187 changed there. */
  why: string;
}

/** The mapping number three 0.185 gave a filtered environment in its flat layout (`CubeUVReflectionMapping`, which 0.187 removed). */
export const CUBE_UV_MAPPING = 306;

/** The chunk 0.187 deleted, put back under its own name: `pmrem185.ts`'s filter programs include it, and so does the held environment chunk. */
export const CUBE_UV_CHUNK = 'cube_uv_reflection_fragment';

/**
 * 0.185 wrote the flat layout's three sizes into each program as it was built (they were in its key). Three no longer
 * does, so where a program has not been given them (the filter's own programs are) they are read off the picture
 * itself: its width and height in texels, and the level of its sharpest face, which is the height's power of two less
 * two, rounded so it is a whole number whatever the card makes of the logarithm.
 */
export const CUBE_UV_SIZES = /* glsl */ `#if defined( ENVMAP_TYPE_CUBE_UV ) && ! defined( CUBEUV_MAX_MIP )

	#define CUBEUV_TEXEL_WIDTH ( 1.0 / float( textureSize( envMap, 0 ).x ) )
	#define CUBEUV_TEXEL_HEIGHT ( 1.0 / float( textureSize( envMap, 0 ).y ) )
	#define CUBEUV_MAX_MIP ( floor( log2( float( textureSize( envMap, 0 ).y ) ) + 0.5 ) - 2.0 )

#endif
`;

const LIGHT_SPECULAR_185 = 'reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );';
const LIGHT_DIFFUSE_185 = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );';
const AREA_LIGHTS = '#if NUM_RECT_AREA_LIGHTS > 0\n\tvoid RE_Direct_RectArea_Physical(';
const FILTERED_CUBE = '\t\t#ifdef ENVMAP_TYPE_PMREM\n';
const FLAT_LAYOUT = '\t\t#ifdef ENVMAP_TYPE_CUBE_UV\n';
const ELSE_FILTERED_CUBE = '\t\t#elif defined( ENVMAP_TYPE_PMREM )\n';

/** Every hold, in the order they are written. */
export const THREE_HOLDS: readonly ChunkHold[] = [
  {
    id: 'roughness-floor',
    chunk: 'lights_physical_fragment',
    find: 'material.roughness = max( roughnessFactor, 0.045 );',
    put: 'material.roughness = max( roughnessFactor, 0.0525 );',
    why: 'the smoothest a surface is drawn went from 0.0525 to 0.045',
  },
  {
    id: 'clearcoat-roughness-floor',
    chunk: 'lights_physical_fragment',
    find: 'material.clearcoatRoughness = max( material.clearcoatRoughness, 0.045 );',
    put: 'material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );',
    why: 'the same floor on a clear coat',
  },
  {
    id: 'light-highlight-function',
    chunk: 'lights_physical_pars_fragment',
    find: AREA_LIGHTS,
    put: `${GGX_MULTISCATTER_185}${AREA_LIGHTS}`,
    why: "0.185's highlight with its own energy term was taken out of three",
  },
  {
    id: 'light-highlight',
    chunk: 'lights_physical_pars_fragment',
    find: 'reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;',
    put: LIGHT_SPECULAR_185,
    why: "a direct light's highlight is scaled by one compensation worked out a pixel, where it had an energy term of its own",
  },
  {
    id: 'light-diffuse',
    chunk: 'lights_physical_pars_fragment',
    find: 'reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );',
    put: LIGHT_DIFFUSE_185,
    why: "a direct light's diffuse is cut by the Fresnel share its highlight takes",
  },
  {
    id: 'ambient-diffuse',
    chunk: 'lights_physical_pars_fragment',
    find: 'vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - singleScattering - multiScattering );',
    put: 'vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution );',
    why: "the ambient's and the hemisphere's diffuse is cut by the highlight's energy",
  },
  {
    id: 'sun-shadow-bias',
    chunk: 'shadowmap_pars_fragment',
    after: 'float getShadow( sampler2DShadow shadowMap',
    within: 400,
    find: SUN_BIAS_187,
    put: SUN_BIAS_185,
    why: 'the filtered shadow lookup takes its bias off under reversed depth, where 0.185 added it either way',
  },
  {
    id: 'point-shadow',
    chunk: 'shadowmap_pars_fragment',
    after: 'float getPointShadow( samplerCubeShadow shadowMap',
    within: 900,
    find: POINT_SHADOW_187,
    put: POINT_SHADOW_185,
    why: "a lamp's shadow compares each of its five taps at a depth of its own, where 0.185 compared all five at the fragment's",
  },
  {
    id: 'environment-sampler',
    chunk: 'envmap_common_pars_fragment',
    find: '\tuniform samplerCube envMap;\n',
    put: `	#if defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE )

		// A standard material's environment that is not one of three's own filtered cubes is the flat layout three
		// 0.185 filtered into (src/core/pmrem185.ts makes it), read the way 0.185 read it (src/core/threeHolds.ts).
		#define ENVMAP_TYPE_CUBE_UV
		uniform sampler2D envMap;
		#include <${CUBE_UV_CHUNK}>

	#else

		uniform samplerCube envMap;

	#endif
`,
    why: 'a filtered environment is a cube with mip levels, where it was one flat picture',
  },
  {
    id: 'environment-fill',
    chunk: 'envmap_physical_pars_fragment',
    find: `${FILTERED_CUBE}${ENV_FILL_187}`,
    put: `${FLAT_LAYOUT}${ENV_FILL_185}${ELSE_FILTERED_CUBE}${ENV_FILL_187}`,
    why: "the environment's diffuse fill reads the cube's last level",
  },
  {
    id: 'environment-reflection',
    chunk: 'envmap_physical_pars_fragment',
    find: `${FILTERED_CUBE}${ENV_REFLECTION_187}`,
    put: `${FLAT_LAYOUT}${ENV_REFLECTION_185}${ELSE_FILTERED_CUBE}${ENV_REFLECTION_187}`,
    why: 'a reflection reads the cube at a level worked out from its roughness another way',
  },
  {
    id: 'environment-fill-asked',
    chunk: 'lights_fragment_maps',
    find: '#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )',
    put: '#if defined( USE_ENVMAP ) && ( defined( ENVMAP_TYPE_PMREM ) || defined( ENVMAP_TYPE_CUBE_UV ) )',
    why: 'the fill is asked for only of a filtered cube',
  },
];

/** What laying the holds over a set of chunks came to. */
export interface HoldPlan {
  /** Every chunk a hold touches, held; empty when any piece was not found. */
  chunks: Record<string, string>;
  /** The holds whose piece of 0.187's text is not where it was (not there, or there twice). */
  missing: string[];
}

function countOf(text: string, piece: string, from: number): number {
  let n = 0;
  for (let i = text.indexOf(piece, from); i >= 0; i = text.indexOf(piece, i + piece.length)) n++;
  return n;
}

/** Where a hold's piece stands in a chunk's text: its index, or -1 when it is not there exactly as the hold says. */
export function holdAt(text: string | undefined, h: ChunkHold): number {
  if (typeof text !== 'string') return -1;
  if (h.after === undefined) return countOf(text, h.find, 0) === 1 ? text.indexOf(h.find) : -1;
  const from = text.indexOf(h.after);
  if (from < 0) return -1;
  const at = text.indexOf(h.find, from);
  return at >= 0 && at - from <= (h.within ?? Infinity) ? at : -1;
}

/**
 * Lay the holds over a set of chunks as three ships them: pure, so the test runs it over the installed three's text.
 * Holds on one chunk are laid one after another, each on what the last left.
 */
export function planThreeHolds(shipped: Readonly<Record<string, string>>, holds: readonly ChunkHold[] = THREE_HOLDS): HoldPlan {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const h of holds) {
    const text = out[h.chunk] ?? shipped[h.chunk];
    const at = holdAt(text, h);
    if (at < 0) {
      missing.push(h.id);
      continue;
    }
    out[h.chunk] = `${text.slice(0, at)}${h.put}${text.slice(at + h.find.length)}`;
  }
  if (missing.length) return { chunks: {}, missing };
  out[CUBE_UV_CHUNK] = `${CUBE_UV_SIZES}${CUBE_UV_REFLECTION_185}`;
  return { chunks: out, missing };
}

/** What became of the holds on this page. */
export interface HoldReport {
  /** True when every hold was written. */
  held: boolean;
  /** How many holds there are. */
  holds: number;
  /** Which were not found, when none was written. */
  missing: string[];
}

/** Each chunk the holds wrote over, as three shipped it, or nothing where three ships none of that name (the test and the console compare against it). */
const shipped = new Map<string, string | undefined>();

/** A chunk as three shipped it, whether or not a hold has since been written over it. */
export function threeChunkAsShipped(name: string): string | undefined {
  return shipped.has(name) ? shipped.get(name) : (ShaderChunk as unknown as Record<string, string>)[name];
}

let report: HoldReport | null = null;

/** Write the holds into three's chunks, once a page (a second call answers what the first did). */
export function applyThreeHolds(): HoldReport {
  if (report) return report;
  const chunks = ShaderChunk as unknown as Record<string, string>;
  const plan = planThreeHolds(chunks);
  if (plan.missing.length) {
    console.warn(`three: its shader text has moved (${plan.missing.join(', ')}), so nothing of its lighting is held and surfaces take three's own new look`);
    report = { held: false, holds: THREE_HOLDS.length, missing: plan.missing };
    return report;
  }
  for (const name of Object.keys(plan.chunks)) {
    shipped.set(name, typeof chunks[name] === 'string' ? chunks[name] : undefined);
    chunks[name] = plan.chunks[name];
  }
  report = { held: true, holds: THREE_HOLDS.length, missing: [] };
  return report;
}

/** Written as the module loads: anything that reads three's chunks imports this first. */
export const THREE_HOLD_REPORT: HoldReport = applyThreeHolds();
