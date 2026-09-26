// The detail map: the second texture the game multiplies a surface's colour by.
//
// It is the single largest thing the converter was reading and throwing away. 1,369 of the retail
// shaders name one over 281 distinct images, and they are the concrete, marble, metal, rock and
// plaster a town is built from -- a wall's whole close-up grain lives in it, and without it those
// surfaces are a flat wash of one colour at any distance.
//
// **What the client does is one line**, and every one of its twenty-six detail pixel programs says
// the same thing:
//
//     result.rgb = diffuseColor * detailColor * light;                         (a_detail)
//     result.rgb = diffuseColor * allDiffuseLight * detailColor + allSpecular; (a_detail_specmap)
//
// So it multiplies the **diffuse** term and never the specular, which is exactly what multiplying
// the base colour does in three. There is no blend, no lerp and no 2x modulate: a plain multiply.
//
// **It reads a texture coordinate set of its own.** Every detail vertex program writes
// `#define textureCoordinateSetDETA textureCoordinateSet1`, and the effect file agrees in its own
// bytes: the first byte of each pass's PTXM chunk is the coordinate set index, 0 on MAIN, 1 on DETA
// and 2 on SPEC. That set is **not** the main one scaled -- measured over the 12,632 retail vertex
// arrays belonging to a detail shader, only 60.7% fit `u1 = a*u0 + b` at all and the rest miss by up
// to 137 texture units -- so it is carried through the GLB as `TEXCOORD_1` and arrives as `uv1`.
//
// Getting `uv1` into a three material is the one awkward part. Three declares `attribute vec2 uv1`
// only when one of **its own** maps is set to channel 1, and it decides that in `getParameters`,
// before `onBeforeCompile` runs, so an injection cannot ask for it. What it does read first is the
// material's own `defines`: `customDefines` is emitted at the top of the vertex prefix and the
// `#ifdef USE_UV1 / attribute vec2 uv1;` block is two hundred lines below it. So `USE_UV1` is set
// as a plain define, which is honest about what it means and needs no decoy ao map.
//
// Nothing here is invented: the multiply, the coordinate set and which texture are all the client's.
import * as THREE from 'three';
import { surfaces } from './surfaces.ts';

/** Marks our own compile hook, so a material is never wrapped twice. */
const DETAIL_HOOK = Symbol('detailMap');
type Hook = THREE.Material['onBeforeCompile'] & { [DETAIL_HOOK]?: true };
/** The program key each wrapped material had before it was wrapped. */
const baseKeys = new WeakMap<THREE.Material, () => string>();
/** Warned once per missing anchor, so a shader three changes under us says so without filling the console. */
const warned = new Set<string>();

const DETAIL_PARS_VERTEX = `
varying vec2 vSwgDetailUv;
`;

const DETAIL_VERTEX = `
	vSwgDetailUv = uv1;
`;

const DETAIL_PARS_FRAGMENT = `
uniform sampler2D swgDetailMap;
varying vec2 vSwgDetailUv;
`;

// After the colour texture and before anything lights it, which is where the client's own programs
// put it. `.rgb` only: the detail maps' alpha is not read by any of them.
const DETAIL_FRAGMENT = `
	diffuseColor.rgb *= texture2D( swgDetailMap, vSwgDetailUv ).rgb;
`;

function after(src: string, anchor: string, add: string): string {
  return src.replace(anchor, `${anchor}\n${add}`);
}

function warnMissing(anchor: string): void {
  if (warned.has(anchor)) return;
  warned.add(anchor);
  console.warn(`detail map: no ${anchor} in this shader, so the surface is drawn without its detail`);
}

/**
 * Put the detail sampling into one compiled shader.
 *
 * Answers whether it went in. Every chunk it writes into must be there or nothing is written at
 * all: a declaration with no use compiles harmlessly, a use with no declaration does not, and a
 * program that fails to link is a black box in the frame.
 */
export function injectDetail(shader: THREE.WebGLProgramParametersWithUniforms, texture: THREE.Texture): boolean {
  const vs = shader.vertexShader;
  const fs = shader.fragmentShader;
  const lacking =
    ['#include <common>', '#include <uv_vertex>'].find((c) => !vs.includes(c)) ?? ['#include <common>', '#include <map_fragment>'].find((c) => !fs.includes(c));
  if (lacking) {
    warnMissing(lacking);
    return false;
  }
  shader.vertexShader = after(after(vs, '#include <common>', DETAIL_PARS_VERTEX), '#include <uv_vertex>', DETAIL_VERTEX);
  shader.fragmentShader = after(after(fs, '#include <common>', DETAIL_PARS_FRAGMENT), '#include <map_fragment>', DETAIL_FRAGMENT);
  shader.uniforms.swgDetailMap = { value: texture };
  return true;
}

/**
 * Wrap a material's compile hook so the detail follows whatever came before (the cascades', the
 * wetness's), and key its program apart.
 *
 * Idempotent, and written the way `applyWetness` is for the same reason: a material whose hook
 * something replaced since (the cascades set up again) is wrapped again around the new hook, with
 * the key it had before the first wrap.
 */
export function applyDetail(mat: THREE.Material, texture: THREE.Texture): void {
  // The define has to be on the material before its program is ever asked for, which it is: this is
  // called from the material scan, in the same pass as the cascades' setup and the wetness wrap.
  //
  // Written once and then left alone. The scan comes round every quarter second and three only
  // works a cache key out again when the material's own version has moved, so rewriting the defines
  // here would allocate an object a scan for nothing and would be a change three never notices.
  const defines = (mat.defines ?? {}) as Record<string, string>;
  if (defines.USE_UV1 === undefined) mat.defines = { ...defines, USE_UV1: '' };
  const previous = mat.onBeforeCompile as Hook;
  if (previous[DETAIL_HOOK]) return;
  const hook: Hook = function swgDetail(this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) {
    previous.call(this, shader, renderer);
    injectDetail(shader, texture);
  };
  hook[DETAIL_HOOK] = true;
  mat.onBeforeCompile = hook;
  let base = baseKeys.get(mat);
  if (!base) {
    base = mat.customProgramCacheKey;
    baseKeys.set(mat, base);
  }
  const key = base;
  mat.customProgramCacheKey = () => `detail|${key.call(mat)}`;
}

/**
 * The material scan's call (`World.adoptMaterials`), made in the same pass as the cascades' setup
 * and the wetness wrap and for the same reason: the wrap and the define must both be in place
 * before the material's program is ever asked for, because both are in its key.
 *
 * A material with no detail map is left exactly as it was, which is every material in the game
 * until a pack is converted again.
 */
export function detailWrap(m: THREE.Material): void {
  const tex = surfaces.detailTexture(m.userData.swgDetail as string | undefined);
  if (tex) applyDetail(m, tex);
}
