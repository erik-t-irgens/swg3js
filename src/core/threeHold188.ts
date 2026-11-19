// Three's indirect light, held where its development branch toward r188 changed what a surface looks like (the GPU port's
// pass 1, wave 2; three's commit 577fb27, REVISION 188dev).
//
// Between 0.187.0 and that commit three reworked a standard material's indirect light in its WebGL chunks (and in its node
// lighting, held on WebGPU by `gpu/gpuLightHold.ts`):
//  - an ambient and a hemisphere light now stand for a distant sky and are reflected: every lit standard surface takes a
//    highlight of them (`getIndirectLightRadiance` seeds the indirect radiance with them, brightest at grazing angles), where
//    0.187 seeded it with nothing and reflected only an environment map;
//  - an environment's diffuse fill joins the ambient's irradiance (`irradiance += getIBLIrradiance`) and is lit by the
//    indirect diffuse there, where 0.187 kept it apart (`iblIrradiance`) and lit it inside `RE_IndirectSpecular_Physical`, cut
//    by the share the dielectric highlight takes; 0.185's uncut ambient diffuse, held by `ambient-diffuse`, would then light
//    the environment's fill uncut too;
//  - the multiple-scattering share of an environment's highlight scales its radiance, where 0.187 scaled its irradiance.
// So, as `threeHolds.ts` holds 0.185's lines over 0.187's, these pieces put 0.187's indirect light back over the commit's,
// first, and the 0.185 holds are laid over what they leave. Each piece is the commit's exact text and its 0.187 meaning, put
// as few lines as carry it (three's text, MIT licence, `LICENSES/three-MIT.txt`). The cascades' own light loop
// (`CSMShader.lights_fragment_begin`, which stands in for three's in every world material the cascades set up) is held the
// same way, as a chunk of its own name (`csm:`).
//
// What is not held, because it changes nothing the game draws (named in `docs/lessons/webgpu.md` and proved by the WebGL
// picture pairs of pass 1's wave 2): the light probes three took out of the chunks (the game has none), a clear coat's
// reflection of the ambient and a sheen's fill (none drawn), the ambient occlusion map's multiple bounce (no material of the
// game's has an occlusion map), and `texture2D` read as `textureLod( ..., 0.0 )` in the tables and the shadow maps, which carry
// one level.

/** One piece of the commit's text and what stands in its place (`threeHolds.ts`'s `ChunkHold`). */
export interface Hold188 {
  id: string;
  /** Three's chunk by name, or the cascades' own (`csm:lights_fragment_begin`). */
  chunk: string;
  find: string;
  put: string;
  why: string;
}

// Three's built chunks carry no empty lines (its build strips them), the cascades' own text keeps them.
const IBL_DECLARED_FIND = '#if defined( RE_IndirectDiffuse )\n\tvec3 irradiance = getAmbientLightIrradiance( ambientLightColor );';
const IBL_DECLARED_PUT = '#if defined( RE_IndirectDiffuse )\n\tvec3 iblIrradiance = vec3( 0.0 );\n\tvec3 irradiance = getAmbientLightIrradiance( ambientLightColor );';
const CSM_IBL_DECLARED_FIND = '#if defined( RE_IndirectDiffuse )\n\n\tvec3 irradiance = getAmbientLightIrradiance( ambientLightColor );';
const CSM_IBL_DECLARED_PUT = '#if defined( RE_IndirectDiffuse )\n\n\tvec3 iblIrradiance = vec3( 0.0 );\n\n\tvec3 irradiance = getAmbientLightIrradiance( ambientLightColor );';
const AMBIENT_REFLECTION_FIND = 'vec3 radiance = getIndirectLightRadiance( geometryViewDir, geometryNormal, material.roughness );';
const AMBIENT_REFLECTION_PUT = 'vec3 radiance = vec3( 0.0 );';

/** 0.187's split: the environment's fill lit here, cut by the dielectric highlight's share, and its multiple scattering by the fill. */
const IBL_SPECULAR_PUT = [
  '\tvec3 diffuse = material.diffuseContribution * ( 1.0 - ( singleScatteringDielectric + multiScatteringDielectric ) );',
  '\tvec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;',
  '\tvec3 indirectSpecular = radiance * singleScattering;',
  '\tindirectSpecular += multiScattering * cosineWeightedIrradiance;',
  '\tvec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;',
].join('\n');

/** Every piece, in the order they are laid (before the 0.185 holds). */
export const THREE_HOLDS_188: readonly Hold188[] = [
  {
    id: 'r188-ibl-declared',
    chunk: 'lights_fragment_begin',
    find: IBL_DECLARED_FIND,
    put: IBL_DECLARED_PUT,
    why: "the environment's fill is kept apart from the ambient's again",
  },
  {
    id: 'r188-ambient-reflection',
    chunk: 'lights_fragment_begin',
    find: AMBIENT_REFLECTION_FIND,
    put: AMBIENT_REFLECTION_PUT,
    why: 'the ambient and the hemisphere lights are reflected by every lit surface',
  },
  {
    id: 'r188-csm-ibl-declared',
    chunk: 'csm:lights_fragment_begin',
    find: CSM_IBL_DECLARED_FIND,
    put: CSM_IBL_DECLARED_PUT,
    why: "the same in the cascades' own light loop",
  },
  {
    id: 'r188-csm-ambient-reflection',
    chunk: 'csm:lights_fragment_begin',
    find: AMBIENT_REFLECTION_FIND,
    put: AMBIENT_REFLECTION_PUT,
    why: "the same in the cascades' own light loop",
  },
  {
    id: 'r188-ibl-fill',
    chunk: 'lights_fragment_maps',
    find: '\t\t\tirradiance += getIBLIrradiance( geometryNormal );',
    put: '\t\t\tiblIrradiance += getIBLIrradiance( geometryNormal );',
    why: "the environment's fill joins the ambient's irradiance",
  },
  {
    id: 'r188-ibl-lambert',
    chunk: 'lights_fragment_end',
    find: '#if defined( RE_IndirectDiffuse )\n\tRE_IndirectDiffuse(',
    put: '#if defined( RE_IndirectDiffuse )\n\t#if defined( LAMBERT ) || defined( PHONG )\n\t\tirradiance += iblIrradiance;\n\t#endif\n\tRE_IndirectDiffuse(',
    why: "a Lambert or Phong material's fill joins its irradiance where 0.187 added it, with the fill kept apart",
  },
  {
    id: 'r188-ibl-specular-call',
    chunk: 'lights_fragment_end',
    find: 'RE_IndirectSpecular( radiance, clearcoatRadiance,',
    put: 'RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance,',
    why: 'the indirect highlight is no longer handed the fill',
  },
  {
    id: 'r188-ibl-specular-signature',
    chunk: 'lights_physical_pars_fragment',
    find: 'void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 clearcoatRadiance,',
    put: 'void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance,',
    why: 'the indirect highlight is no longer handed the fill',
  },
  {
    id: 'r188-ibl-specular',
    chunk: 'lights_physical_pars_fragment',
    find: '\tvec3 indirectSpecular = radiance * ( singleScattering + multiScattering );',
    put: IBL_SPECULAR_PUT,
    why: "the multiple scattering scales the environment's radiance, and its fill is lit elsewhere uncut",
  },
  {
    id: 'r188-ibl-diffuse',
    chunk: 'lights_physical_pars_fragment',
    find: '\treflectedLight.indirectSpecular += indirectSpecular;\n}',
    put: '\treflectedLight.indirectSpecular += indirectSpecular;\n\treflectedLight.indirectDiffuse += indirectDiffuse;\n}',
    why: "the environment's fill, cut by the highlight's share, is no longer added here",
  },
];
