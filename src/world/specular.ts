// The client's own highlight, drawn in place of three's GGX on every material that says what the client
// drew (material format 6's `extras.swgSpec`, which GLTFLoader hands over as `userData.swgSpec`).
//
// Why: three's GGX, fed the roughness the converter worked out from each shader's mask, drew every shiny
// surface as a tight hot spot -- measured against each shader's own colour and power, a median 2.6 times too
// bright at a quarter of the client's width, 21 times on the two-tone cloth (which is why shirts glinted in
// stripes) and 7 times on hair, which the client drew as a broad band and not a dot at all. No roughness can
// put a lobe's peak off the mirror direction, so the band cannot be had from GGX at any setting; the client's
// own term, one line in three's lighting, is exact in peak, width and shape (`specMath.ts` says what it is).
//
// **One injection, one program text.** In `RE_Direct_Physical` three adds `irradiance * BRDF_GGX_Multiscatter`
// for every direct light; that one line is replaced with the client's term, mixed with three's GGX only by
// the weather's own amount (the rain's glint and the settled snow's matt both ride on roughness, which the
// client's term never reads, so a wet or snowed surface keeps three's by how wet or snowed it is). The mode,
// colour and power are per-material uniforms and the knobs are shared ones (`SPEC_UNIFORMS`), so every
// converted material shares one program text: the only new program cost is the key prefix `spec`, taken in
// `World.adoptMaterials` with the cascades, the wet look and the detail map, before anything compiles.
// Switching back to three's GGX (`__debug.spec({ use: 'three' })`) moves a uniform and compiles nothing.
//
// **The mask** is the metal-rough image's red, which the converter writes there and three never reads: it is
// read once in `main()` from the texel three's own roughness chunk already sampled, into a global the
// lighting function reads, since three's lights are worked out in functions that cannot see `main()`'s
// locals. A material with no metal-rough image has a mask of one, which is what its shader's program read.
//
// `localStorage['swg.spec'] = 'three'` skips the wrap at load: a program that fails to compile draws
// nothing at all, which is the wet wrap's lesson, and this is the way back without a build.
import * as THREE from 'three';
import { chainHas, wrapCompile, type Wrappable } from './compileHooks.ts';
import { BAND_POWER, BAND_TIGHTEN, SPEC_TUNE, clientSpecular, filmShare, specValues, weatherShare, type SpecTune, type Vec3 } from './specMath.ts';

export { SPEC_TUNE, type SpecTune } from './specMath.ts';

/** Marks our own compile hook, so a material is never wrapped twice. */
export const SPEC_HOOK = Symbol('spec');

/** False when localStorage 'swg.spec' is 'three' (read once, at load): no material is wrapped and every surface draws three's GGX, as before. */
export const SPEC_WRAP: boolean = (() => {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem('swg.spec') !== 'three';
  } catch {
    return true;
  }
})();

/** The knobs, shared by reference into every wrapped material's uniforms, so one write reaches all of them. */
export const SPEC_UNIFORMS: {
  uSwgSpecUse: THREE.IUniform<number>;
  uSwgSpecGain: THREE.IUniform<number>;
  uSwgSpecCap: THREE.IUniform<number>;
  uSwgSpecFilm: THREE.IUniform<number>;
  uSwgSpecGate: THREE.IUniform<number>;
} = {
  uSwgSpecUse: { value: SPEC_TUNE.use === 'three' ? 1 : 0 },
  uSwgSpecGain: { value: SPEC_TUNE.gain },
  uSwgSpecCap: { value: SPEC_TUNE.cap },
  uSwgSpecFilm: { value: SPEC_TUNE.film },
  uSwgSpecGate: { value: SPEC_TUNE.gate },
};

/** Write the shared uniforms from a tune (the one in force unless another is handed in). */
function writeUniforms(t: SpecTune): void {
  SPEC_UNIFORMS.uSwgSpecUse.value = t.use === 'three' ? 1 : 0;
  SPEC_UNIFORMS.uSwgSpecGain.value = t.gain;
  SPEC_UNIFORMS.uSwgSpecCap.value = t.cap;
  SPEC_UNIFORMS.uSwgSpecFilm.value = t.film;
  SPEC_UNIFORMS.uSwgSpecGate.value = t.gate;
}

/** Change the knobs live (`__debug.spec`): anything not a usable number is left as it was. Uniforms only; nothing compiles. */
export function setSpecTune(o: Partial<SpecTune>): SpecTune {
  if (o.use === 'client' || o.use === 'three') SPEC_TUNE.use = o.use;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (num(o.gain)) SPEC_TUNE.gain = o.gain;
  if (num(o.cap)) SPEC_TUNE.cap = o.cap;
  if (num(o.film)) SPEC_TUNE.film = Math.min(1, o.film);
  if (num(o.gate)) SPEC_TUNE.gate = Math.min(1, o.gate);
  writeUniforms(SPEC_TUNE);
  return { ...SPEC_TUNE };
}

/** One material's own uniforms: its mode, colour and power. Kept per material so a recompile reuses them and the self test can move them. */
interface MaterialSpec {
  swgSpecMode: THREE.IUniform<number>;
  swgSpecColor: THREE.IUniform<THREE.Vector3>;
  swgSpecPower: THREE.IUniform<number>;
}
const perMaterial = new WeakMap<THREE.Material, MaterialSpec>();

/** The uniforms a material's highlight is drawn with, made from its `userData.swgSpec` the first time they are asked for. */
export function specUniformsOf(mat: THREE.Material): MaterialSpec {
  let u = perMaterial.get(mat);
  if (!u) {
    const v = specValues(mat.userData.swgSpec);
    u = { swgSpecMode: { value: v.mode }, swgSpecColor: { value: new THREE.Vector3(v.color[0], v.color[1], v.color[2]) }, swgSpecPower: { value: v.power } };
    perMaterial.set(mat, u);
  }
  return u;
}

/** What the wrap has done this session, for the console. */
export const SPEC_STATS = { wrapped: 0, none: 0, phong: 0, aniso: 0, injected: 0, missingAnchor: 0 };
const counted = new WeakSet<THREE.Material>();

/** A GLSL float literal for one of the client's constants, so the shader is built from the very numbers `specMath.ts` uses. */
const glslFloat = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

/**
 * Declarations and the client's term, put into three's expanded lighting chunk just before
 * `RE_Direct_Physical`, which is after `BRDF_GGX_Multiscatter` (the wet film's glint) and every type the
 * functions name. Every name starts `swg` so nothing in three's chunks or a hook before ours is shadowed.
 */
export const SPEC_PARS = /* glsl */ `
// The client's own highlight (src/world/specular.ts): mode, colour and power per material, the knobs for all.
uniform float swgSpecMode;
uniform vec3 swgSpecColor;
uniform float swgSpecPower;
uniform float uSwgSpecUse;
uniform float uSwgSpecGain;
uniform float uSwgSpecCap;
uniform float uSwgSpecFilm;
uniform float uSwgSpecGate;
const float SWG_BAND_TIGHTEN = ${glslFloat(BAND_TIGHTEN)};
const float SWG_BAND_POWER = ${glslFloat(BAND_POWER)};
// Written in main() before the lights: the mask out of the metal-rough image's red, and how wet or snowed the surface is.
float swgSpecMask = 1.0;
float swgSpecFilm = 0.0;

// (N.H) to the power on the plain programs; the client's band of N.H times N.L on the others. Every base is
// held above nought before it is raised, so no pixel is ever pow of nothing (a NaN is a black box in the bloom).
float swgSpecShape( const in float nh, const in float nl ) {
	float swgH = clamp( nh, 0.0, 1.0 );
	if ( swgSpecMode > 1.5 ) {
		float swgB = max( 1.0 - abs( 1.0 - SWG_BAND_TIGHTEN * swgH ), 1e-6 );
		return max( pow( swgB, max( swgSpecPower, 0.0 ) * SWG_BAND_POWER ) - SWG_BAND_POWER, 0.0 ) * clamp( nl, 0.0, 1.0 );
	}
	return pow( max( swgH, 1e-6 ), max( swgSpecPower, 0.0 ) );
}

// The client's term from one light: its colour times the specular colour times the mask times the shape, over
// pi (the client's highlight was measured against a white surface facing the light, which is the light over
// pi here), times the gain and the gate, and never past a white surface facing that light times the cap.
vec3 swgClientSpecular( const in vec3 lightColor, const in vec3 lightDir, const in vec3 normal, const in vec3 viewDir ) {
	if ( swgSpecMode < 0.5 ) return vec3( 0.0 );
	vec3 swgHalf = lightDir + viewDir;
	float swgLen = length( swgHalf );
	if ( swgLen < 1e-6 ) return vec3( 0.0 );
	float swgNL = dot( normal, lightDir );
	float swgShape = swgSpecShape( dot( normal, swgHalf ) / swgLen, swgNL );
	float swgGate = mix( 1.0, step( 1e-4, swgNL ), clamp( uSwgSpecGate, 0.0, 1.0 ) );
	vec3 swgTerm = lightColor * swgSpecColor * ( swgSpecMask * swgShape * swgGate * max( uSwgSpecGain, 0.0 ) * RECIPROCAL_PI );
	return min( swgTerm, lightColor * ( max( uSwgSpecCap, 0.0 ) * RECIPROCAL_PI ) );
}

// What RE_Direct_Physical adds to the direct specular: three's GGX where the switch asks for it or by the
// weather's own amount (the rain's glint and the snow's matt ride on roughness), the client's term for the rest.
vec3 swgDirectSpecular( const in vec3 irradiance, const in IncidentLight directLight, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in PhysicalMaterial material ) {
	float swgFilm = uSwgSpecUse > 0.5 ? 1.0 : clamp( swgSpecFilm * uSwgSpecFilm, 0.0, 1.0 );
	vec3 swgOut = vec3( 0.0 );
	if ( swgFilm > 0.0 ) swgOut += swgFilm * irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );
	if ( swgFilm < 1.0 ) swgOut += ( 1.0 - swgFilm ) * swgClientSpecular( directLight.color, directLight.direction, geometryNormal, geometryViewDir );
	return swgOut;
}
`;

/** How the film is taken from the wet chunk, which the leaf cards' rule finds by its exact text to keep a wet card matt (`cardRule.ts`). */
export const SPEC_FILM_LINE = 'swgSpecFilm = max( max( wetSurface, wetPuddle ), wetSnow );';

/**
 * In `main()`, just before the lights: the mask from the texel three's roughness chunk already sampled, and
 * the weather's amount where the wet chunk is in this program (`SWG_WET`, which `wetness.ts` defines with
 * its declarations; its three amounts are declared at the top level of `main()` after the colour stage).
 * Snow is one of them (`specMath.weatherShare` says why): the wet look's snow is matt through roughness alone.
 */
export const SPEC_MAIN = /* glsl */ `
#ifdef USE_ROUGHNESSMAP
	swgSpecMask = texelRoughness.r;
#endif
#ifdef SWG_WET
	${SPEC_FILM_LINE}
#endif
`;

/** The line three 0.185 adds every direct light's highlight with: the one line replaced. */
export const GGX_ANCHOR = 'reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );';
/** What goes in its place. */
export const SPEC_LINE = 'reflectedLight.directSpecular += swgDirectSpecular( irradiance, directLight, geometryNormal, geometryViewDir, material );';

const PARS_INCLUDE = '#include <lights_physical_pars_fragment>';
const DIRECT_FN = 'void RE_Direct_Physical(';
const LIGHTS_BEGIN = '#include <lights_fragment_begin>';

/** Warned once per missing anchor, so a shader three changes under us says so without filling the console. */
const warned = new Set<string>();
function warnMissing(anchor: string): void {
  if (warned.has(anchor)) return;
  warned.add(anchor);
  console.warn(`specular: no ${anchor} in this shader, so its surface keeps three's own highlight`);
}

/** Three's lighting chunk with the client's term in place of the GGX line, or null where three no longer has the line. */
export function physicalParsWithSpec(chunk: string = THREE.ShaderChunk.lights_physical_pars_fragment): string | null {
  const fn = chunk.indexOf(DIRECT_FN);
  if (fn < 0) {
    warnMissing(DIRECT_FN);
    return null;
  }
  const line = chunk.indexOf(GGX_ANCHOR, fn);
  if (line < 0) {
    warnMissing('three\'s GGX line in RE_Direct_Physical');
    return null;
  }
  return `${chunk.slice(0, fn)}${SPEC_PARS}\n${chunk.slice(fn, line)}${SPEC_LINE}${chunk.slice(line + GGX_ANCHOR.length)}`;
}

/**
 * Put the client's highlight into one compiled shader, with this material's own uniforms. Answers whether
 * it went in. Every anchor must be there or nothing is written at all: a declaration with no use compiles, a
 * use with no declaration does not, and a program that fails to link draws nothing.
 */
export function injectSpec(shader: THREE.WebGLProgramParametersWithUniforms, mat: THREE.Material): boolean {
  const fs = shader.fragmentShader;
  const lacking = [PARS_INCLUDE, LIGHTS_BEGIN].find((a) => !fs.includes(a));
  if (lacking) {
    warnMissing(lacking);
    SPEC_STATS.missingAnchor++;
    return false;
  }
  const pars = physicalParsWithSpec();
  if (pars === null) {
    SPEC_STATS.missingAnchor++;
    return false;
  }
  const p = fs.indexOf(PARS_INCLUDE);
  let f = `${fs.slice(0, p)}${pars}${fs.slice(p + PARS_INCLUDE.length)}`;
  const b = f.indexOf(LIGHTS_BEGIN);
  f = `${f.slice(0, b)}${SPEC_MAIN}${f.slice(b)}`;
  shader.fragmentShader = f;
  Object.assign(shader.uniforms, SPEC_UNIFORMS, specUniformsOf(mat));
  SPEC_STATS.injected++;
  return true;
}

/**
 * Wrap a material's compile hook so the client's highlight follows whatever came before (the cascades', the
 * wet look's, the detail map's), and key its program apart under `spec`. Idempotent through `wrapCompile`,
 * which walks the whole hook chain for its mark (`compileHooks.ts` says why that matters), and wrapped again
 * after the cascades replace the hook, which is what a replaced hook needs.
 */
export function applySpec(mat: THREE.MeshStandardMaterial, count = true): void {
  // Asked before the injection's closure is made: the scan comes round every quarter second, and over the whole
  // scene every two, for thousands of materials already wrapped, and a closure made only to be refused is garbage.
  if (!chainHas(mat.onBeforeCompile, SPEC_HOOK)) wrapCompile(mat as unknown as Wrappable, SPEC_HOOK, 'spec', (shader) => injectSpec(shader as unknown as THREE.WebGLProgramParametersWithUniforms, mat));
  if (count && !counted.has(mat)) {
    counted.add(mat);
    SPEC_STATS.wrapped++;
    const mode = specUniformsOf(mat).swgSpecMode.value;
    if (mode > 1.5) SPEC_STATS.aniso++;
    else if (mode > 0.5) SPEC_STATS.phong++;
    else SPEC_STATS.none++;
  }
}

/**
 * The material scan's call (`World.adoptMaterials`), after the cascades, the wet look and the detail map and
 * in the same iteration, so the hook and the key are both in place before the program is ever asked for. A
 * material that says nothing of its highlight (every material of a pack converted before material format 6)
 * is left exactly as it was, and so is an unlit one, which has no lights to replace.
 */
export function specWrap(m: THREE.Material): void {
  if (!SPEC_WRAP) return;
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial || m.userData.unlit === true || !m.userData.swgSpec) return;
  applySpec(s);
}

/**
 * Wrap every material under a root that the world has not adopted and may never adopt: the figure the select
 * screen and the creator's dark stage stand in a preview's own context, and a hull the ship edit page shows
 * before it has ever been spawned. Left to the world's scan alone, such a preview drew three's GGX on a fresh
 * session and the client's highlight once the same rig or hull had been in play, so its look hung on history.
 * Nothing extra is built in the world: when play adopts the material the cascades replace its hook and the scan
 * wraps it again under the same `spec` key, which is what it would have had anyway.
 */
export function specWrapTree(root: THREE.Object3D): void {
  if (!SPEC_WRAP) return;
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material;
    if (!mat) return;
    if (Array.isArray(mat)) for (const m of mat) specWrap(m);
    else specWrap(mat);
  });
}

/** What the wrap is doing, for the console. */
export function specReport(): { wrap: string; tune: SpecTune; materials: { wrapped: number; none: number; phong: number; aniso: number }; injected: number; missingAnchor: number } {
  return {
    wrap: SPEC_WRAP ? "on: every material converted at format 6 draws the client's highlight" : "off for this load (localStorage['swg.spec'] = 'three'): every surface draws three's GGX",
    tune: { ...SPEC_TUNE },
    materials: { wrapped: SPEC_STATS.wrapped, none: SPEC_STATS.none, phong: SPEC_STATS.phong, aniso: SPEC_STATS.aniso },
    injected: SPEC_STATS.injected,
    missingAnchor: SPEC_STATS.missingAnchor,
  };
}

export interface SpecSelfTest {
  ok: boolean;
  /** Every case drawn, with the worst pixel against `clientSpecular`, in units of a white surface facing the light. */
  cases: { name: string; pixels: number; maxError: number; peak: { gpu: number; js: number } }[];
  /**
   * The live switch to three's GGX on the first case: it must draw what an unwrapped standard material of the
   * same roughness draws (`maxErrorAgainstGgx`, against a lobe bright enough to mean something, `ggxPeak`),
   * something other than the client's term somewhere on the sphere (`differs`, by more than 0.05 at the pixel
   * where they part most; `client` and `three` are only the two peaks), and build no program to do it (`built`).
   */
  threeSwitch: { client: number; three: number; apart: number; differs: boolean; ggxPeak: number; maxErrorAgainstGgx: number; built: number };
  /** The weather's film: three's GGX by the weather's share and the client's term for the rest, against the two drawn apart. */
  weather: { name: string; film: number; maxError: number }[];
  note: string;
}

/** The self test's roughness: a GGX lobe bright enough to compare against (about two thirds of a white wall at its peak). The client's term never reads it. */
const SELF_TEST_ROUGHNESS = 0.35;

/**
 * Draw a lit sphere off-screen with the injected program and compare every pixel with `clientSpecular`, the
 * way `gradeSelfTest` checks the grade: the plain highlight, the band, a colour past the cap, a mask from the
 * metal-rough image's red and no highlight at all; then the switch to three's GGX against an unwrapped
 * standard material drawn the same way, counting the programs it builds (none); then the weather's film, with
 * a stand-in for the wet chunk's three amounts, against that GGX and `clientSpecular` mixed by
 * `specMath.filmShare`. The sphere is black, so only the highlight is drawn; the light is white at pi, so a
 * pixel reads in units of a white surface facing it. It builds four programs of its own (the plain, the
 * masked, the unwrapped and the weathered), which a console call may.
 */
export function specSelfTest(renderer: THREE.WebGLRenderer): SpecSelfTest {
  const size = 64;
  const scene = new THREE.Scene();
  const l: Vec3 = [0.35, 0.45, 1];
  const ll = Math.hypot(l[0], l[1], l[2]);
  l[0] /= ll;
  l[1] /= ll;
  l[2] /= ll;
  const light = new THREE.DirectionalLight(0xffffff, Math.PI);
  light.position.set(l[0], l[1], l[2]);
  light.target.position.set(0, 0, 0);
  scene.add(light, light.target);
  // Looking down -z from +z with no turn, so view space is world space shifted and the eye is (0, 0, 1) everywhere.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 3);
  camera.updateMatrixWorld();
  const geometry = new THREE.SphereGeometry(1, 192, 96);
  const maskByte = 128;
  const maskTexture = new THREE.DataTexture(new Uint8Array([maskByte, 255, 0, 255]), 1, 1, THREE.RGBAFormat);
  maskTexture.needsUpdate = true;
  /** The wet chunk's three amounts as the weathered stand-in declares them: wet, puddle, snow. */
  const weatherAmounts: THREE.IUniform<THREE.Vector3> = { value: new THREE.Vector3() };
  const makeMaterial = (map: THREE.Texture | null, weathered = false) => {
    const m = new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 0, roughness: SELF_TEST_ROUGHNESS });
    if (map) {
      m.roughnessMap = map;
      m.metalnessMap = map;
    }
    if (weathered) {
      // A stand-in for the wet chunk, which needs the roof grid and the world's weather: its define, and its
      // three amounts at the top level of main() after the colour stage, where the real one declares them,
      // read from one uniform the test moves. Keyed apart, or three would hand it the plain program.
      m.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\n#define SWG_WET\nuniform vec3 swgSelfTestWeather;')
          .replace('#include <color_fragment>', '#include <color_fragment>\nfloat wetSurface = swgSelfTestWeather.x;\nfloat wetPuddle = swgSelfTestWeather.y;\nfloat wetSnow = swgSelfTestWeather.z;');
        shader.uniforms.swgSelfTestWeather = weatherAmounts;
      };
      m.customProgramCacheKey = () => 'swg-spec-self-test-weather';
    }
    m.userData.swgSpec = { mode: 'phong', color: [1, 1, 1], power: 20 };
    // Not counted among the world's materials: the console's numbers are the game's.
    applySpec(m, false);
    return m;
  };
  const plain = makeMaterial(null);
  const masked = makeMaterial(maskTexture);
  const weathered = makeMaterial(null, true);
  // Three's own highlight, unwrapped, at the same roughness: what the switch and the film must reproduce.
  const ggx = new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 0, roughness: SELF_TEST_ROUGHNESS });
  const mesh = new THREE.Mesh(geometry, plain);
  scene.add(mesh);
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, samples: 0 });
  const pixels = new Uint16Array(size * size * 4);
  const reference = new Float32Array(size * size * 3);
  const fixed: SpecTune = { use: 'client', gain: 1, cap: 1, film: 1, gate: 0 };
  const lightColor: Vec3 = [Math.PI, Math.PI, Math.PI];
  const n: Vec3 = [0, 0, 0];
  const v: Vec3 = [0, 0, 1];
  const js: Vec3 = [0, 0, 0];
  const previous = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  const cases: SpecSelfTest['cases'] = [];
  const weather: SpecSelfTest['weather'] = [];
  const draw = (mat: THREE.MeshStandardMaterial) => {
    mesh.material = mat;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
  };
  /** Every pixel inside the rim (at the silhouette a pixel is part sphere and part clear), with the sphere's normal there. */
  const eachInside = (visit: (k: number, n: Vec3) => void) => {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = ((i + 0.5) / size) * 2 - 1;
        const y = ((j + 0.5) / size) * 2 - 1;
        const r2 = x * x + y * y;
        if (r2 > 0.85) continue;
        n[0] = x;
        n[1] = y;
        n[2] = Math.sqrt(1 - r2);
        visit(j * size + i, n);
      }
    }
  };
  const gpuAt = (k: number, c: number) => THREE.DataUtils.fromHalfFloat(pixels[k * 4 + c]);
  /** The brightest pixel of the last draw, red channel. */
  const brightest = () => {
    let most = 0;
    for (let i = 0; i < size * size; i++) most = Math.max(most, gpuAt(i, 0));
    return most;
  };
  const programs = () => renderer.info.programs?.length ?? 0;
  const setSpec = (mat: THREE.MeshStandardMaterial, mode: number, color: number, power: number) => {
    const u = specUniformsOf(mat);
    u.swgSpecMode.value = mode;
    u.swgSpecColor.value.set(color, color, color);
    u.swgSpecPower.value = power;
  };
  let threeSwitch: SpecSelfTest['threeSwitch'] = { client: 0, three: 0, apart: 0, differs: false, ggxPeak: 0, maxErrorAgainstGgx: Infinity, built: -1 };
  try {
    writeUniforms(fixed);
    const runs: { name: string; mat: THREE.MeshStandardMaterial; mode: number; color: number; power: number; mask: number }[] = [
      { name: 'the plain highlight, colour 0.5, power 20', mat: plain, mode: 1, color: 0.5, power: 20, mask: 1 },
      { name: "the client's band, colour 1, power 20", mat: plain, mode: 2, color: 1, power: 20, mask: 1 },
      { name: 'colour 10 (glass), held at the cap', mat: plain, mode: 1, color: 10, power: 8, mask: 1 },
      { name: 'masked by the metal-rough red, colour 0.8, power 12', mat: masked, mode: 1, color: 0.8, power: 12, mask: maskByte / 255 },
      { name: 'no highlight', mat: plain, mode: 0, color: 1, power: 20, mask: 1 },
    ];
    for (const run of runs) {
      setSpec(run.mat, run.mode, run.color, run.power);
      draw(run.mat);
      let maxError = 0;
      let inside = 0;
      let peakGpu = 0;
      let peakJs = 0;
      eachInside((k, normal) => {
        clientSpecular(js, lightColor, [run.color, run.color, run.color], run.mask, run.mode, run.power, normal, l, v, fixed);
        for (let c = 0; c < 3; c++) {
          const gpu = gpuAt(k, c);
          maxError = Math.max(maxError, Math.abs(gpu - js[c]));
          if (c === 0) {
            peakGpu = Math.max(peakGpu, gpu);
            peakJs = Math.max(peakJs, js[c]);
          }
        }
        inside++;
      });
      cases.push({ name: run.name, pixels: inside, maxError: Number(maxError.toFixed(4)), peak: { gpu: Number(peakGpu.toFixed(4)), js: Number(peakJs.toFixed(4)) } });
    }
    // Three's own highlight, drawn by a material nothing has wrapped: the reference for the switch and the film.
    draw(ggx);
    for (let k = 0; k < size * size; k++) for (let c = 0; c < 3; c++) reference[k * 3 + c] = gpuAt(k, c);
    const ggxPeak = brightest();
    // The live switch: the first case again, through three's GGX, which must build no program.
    setSpec(plain, 1, 0.5, 20);
    draw(plain);
    const client = brightest();
    // Kept to tell the two apart pixel by pixel: their peaks can be near each other while their shapes are not.
    const clientPixels = new Float32Array(size * size);
    for (let k = 0; k < size * size; k++) clientPixels[k] = gpuAt(k, 0);
    const before = programs();
    writeUniforms({ ...fixed, use: 'three' });
    draw(plain);
    const built = programs() - before;
    const three = brightest();
    let againstGgx = 0;
    let apart = 0;
    eachInside((k) => {
      for (let c = 0; c < 3; c++) againstGgx = Math.max(againstGgx, Math.abs(gpuAt(k, c) - reference[k * 3 + c]));
      apart = Math.max(apart, Math.abs(gpuAt(k, 0) - clientPixels[k]));
    });
    threeSwitch = { client: Number(client.toFixed(4)), three: Number(three.toFixed(4)), apart: Number(apart.toFixed(4)), differs: apart > 0.05, ggxPeak: Number(ggxPeak.toFixed(4)), maxErrorAgainstGgx: Number(againstGgx.toFixed(4)), built };
    // The weather's film: three's GGX by the weather's share, the client's term for the rest.
    writeUniforms(fixed);
    setSpec(weathered, 1, 0.5, 20);
    const amounts: { name: string; wet: number; puddle: number; snow: number }[] = [
      { name: 'wet, 0.5', wet: 0.5, puddle: 0, snow: 0 },
      { name: 'a puddle, 0.7', wet: 0, puddle: 0.7, snow: 0 },
      { name: 'settled snow, 0.6', wet: 0, puddle: 0, snow: 0.6 },
      { name: 'snow over a little rain, 0.2 and 0.9', wet: 0.2, puddle: 0, snow: 0.9 },
      { name: 'dry', wet: 0, puddle: 0, snow: 0 },
    ];
    for (const a of amounts) {
      weatherAmounts.value.set(a.wet, a.puddle, a.snow);
      draw(weathered);
      const film = filmShare(weatherShare(a.wet, a.puddle, a.snow), fixed);
      let maxError = 0;
      eachInside((k, normal) => {
        clientSpecular(js, lightColor, [0.5, 0.5, 0.5], 1, 1, 20, normal, l, v, fixed);
        for (let c = 0; c < 3; c++) maxError = Math.max(maxError, Math.abs(gpuAt(k, c) - (film * reference[k * 3 + c] + (1 - film) * js[c])));
      });
      weather.push({ name: a.name, film, maxError: Number(maxError.toFixed(4)) });
    }
  } finally {
    writeUniforms(SPEC_TUNE);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clear, clearAlpha);
    plain.dispose();
    masked.dispose();
    weathered.dispose();
    ggx.dispose();
    maskTexture.dispose();
    geometry.dispose();
    rt.dispose();
  }
  const worst = cases.reduce((a, c) => Math.max(a, c.maxError), 0);
  const weatherWorst = weather.reduce((a, c) => Math.max(a, c.maxError), weather.length ? 0 : Infinity);
  return {
    ok: worst < 0.02 && threeSwitch.differs && threeSwitch.ggxPeak > 0.05 && threeSwitch.maxErrorAgainstGgx < 0.01 && threeSwitch.built === 0 && weatherWorst < 0.02,
    cases,
    threeSwitch,
    weather,
    note: "every pixel inside the rim, in units of a white surface facing the light: the client's cases against specMath.clientSpecular (worst under 0.02); the switch against an unwrapped standard material (under 0.01, building no program, and unlike the client's); the weather against that GGX and clientSpecular mixed by specMath.filmShare (under 0.02)",
  };
}
