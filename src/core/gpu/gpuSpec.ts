// The client's own highlight on WebGPU (the GPU port's step 4, item 1). On WebGL it is one line of three's lighting chunk
// replaced (`src/world/specular.ts`); three's WebGPU renderer runs no `onBeforeCompile`, so here it is a lighting model
// of ours extending three's own physical one, given to the node copy of a classic material that carries the highlight's
// wrap. It replaces the direct specular: three's own `direct` runs whole (its diffuse included) into a specular of its own
// that is then mixed with the client's term exactly as the WebGL line mixes them. And where the client's term stands it
// gives back the shares of the diffuse three 0.187 cut for its own highlight, a direct light's (`diffuseBackNode`) and the
// ambient's (`indirectDiffuse`), since the client's line takes nothing from its diffuse for its highlight and the WebGL
// picture holds 0.185's uncut diffuse (`threeHolds.ts`): without them a Theed room's floor under its lamps drew 1.5 to 1.8
// levels darker than on WebGL with the look on (55.6 against 57.4), and matched only with three's GGX back on.
//
// One rule in one place: every number of the term is the mirror's (`specMath.ts`: the band's two constants, the floors,
// the gate's N.L, the mode codes' thresholds); the knobs are read from the very uniform objects the WebGL injection
// reads (`SPEC_UNIFORMS`), once a render; and each material's mode, colour and power from the very records the WebGL
// injection hands its program (`specUniformsOf`), once an object. So `__debug.spec(...)` moves both renderers, and
// `__debug.spec({ use: 'three' })` is three's own direct specular to the bit.
//
// Which node copy takes the model is decided only by what is in the original material's cache key (three hands render
// objects whose keys are equal one node builder state, so a choice the key cannot see would be shared wrongly): the
// highlight's wrap (`SPEC_HOOK` in the hook chain, which keys the program under `spec`) and whether a metal-rough picture
// is there (its red is the mask). Everything else is a uniform.
//
// Wetness is a remake of the owner's and not on WebGPU: the weather's share of three's GGX (the film) is nought there,
// and `CLIENT_SPEC_WEATHER.node` is where the remake hands its own share in.

import * as THREE from 'three';
import { MaterialNode, PhysicalLightingModel } from 'three/webgpu';
import { BRDF_Lambert, F_Schlick, abs, clamp, diffuseContribution, dot, float, length, max, min, mix, normalView, positionViewDirection, pow, renderGroup, select, specularColor, specularF90, step, uniform, vec3, PI } from 'three/tsl';
import { SPEC_HOOK, SPEC_UNIFORMS, SPEC_WRAP, specUniformsOf } from '../../world/specular.ts';
import { chainHas } from '../../world/compileHooks.ts';
import { BAND_POWER, BAND_TIGHTEN, GATE_NL, MODE_BAND_ABOVE, MODE_NONE_BELOW, SPEC_FLOOR } from '../../world/specMath.ts';
import { GPU_LOOKS, LOOKS_AT_LOAD, type LookPart } from './looks.ts';
import { HeldLightingModel } from './gpuLightHold.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The mirror's own numbers the graph is built from, kept in one record so the node test can hold the graph to them. */
export const SPEC_GRAPH_NUMBERS = { tighten: BAND_TIGHTEN, bandPower: BAND_POWER, floor: SPEC_FLOOR, gateNl: GATE_NL, noneBelow: MODE_NONE_BELOW, bandAbove: MODE_BAND_ABOVE } as const;

/**
 * Where the weather's share comes in (the wet look's and the snow's amount, `specMath.weatherShare`): null on WebGPU
 * until the wetness remake hands its node over, which reads as nought (a dry surface draws the client's term alone).
 */
export const CLIENT_SPEC_WEATHER: { node: Any } = { node: null };

/** A knob, read off the very uniform object the WebGL injection reads, once a render (a shared group: one write a render). */
const knob = (u: THREE.IUniform<number>): Any => uniform(u.value).setGroup(renderGroup).onRenderUpdate(() => u.value);

/** The shared knobs, made the first time a model asks (this module is only ever loaded on WebGPU). */
let knobs: { use: Any; gain: Any; cap: Any; film: Any; gate: Any; on: Any } | null = null;
export function specKnobs(): NonNullable<typeof knobs> {
  return (knobs ??= {
    use: knob(SPEC_UNIFORMS.uSwgSpecUse),
    gain: knob(SPEC_UNIFORMS.uSwgSpecGain),
    cap: knob(SPEC_UNIFORMS.uSwgSpecCap),
    film: knob(SPEC_UNIFORMS.uSwgSpecFilm),
    gate: knob(SPEC_UNIFORMS.uSwgSpecGate),
    // The console's look switch (`__debug.gpu({ look: { spec: false } })`): off, every direct specular is three's own.
    on: uniform(1).setGroup(renderGroup).onRenderUpdate(() => (GPU_LOOKS.spec ? 1 : 0)),
  });
}

/**
 * Each material's own mode, colour and power, read per object off the record the WebGL injection hands its program
 * (`specUniformsOf`, made from `userData.swgSpec` the first time it is asked). Three writes an object's own uniforms when
 * it first draws it and whenever its material or matrix moves, which is when these can change.
 */
let perMaterial: { mode: Any; color: Any; power: Any } | null = null;
export function specPerMaterial(): NonNullable<typeof perMaterial> {
  return (perMaterial ??= {
    mode: uniform(0).onObjectUpdate((frame: Any) => specUniformsOf(frame.material).swgSpecMode.value),
    color: uniform(new THREE.Vector3()).onObjectUpdate((frame: Any) => specUniformsOf(frame.material).swgSpecColor.value),
    power: uniform(0).onObjectUpdate((frame: Any) => specUniformsOf(frame.material).swgSpecPower.value),
  });
}

/**
 * The client's term from one light, as nodes: `swgClientSpecular` line for line (`specular.ts`), and `clientSpecular`
 * in `specMath.ts`. `n`, `l` and `v` are view-space unit vectors (the shading normal, toward the light, toward the eye);
 * `mask` the metal-rough picture's red, or one.
 */
export function clientSpecularNode(lightColor: Any, l: Any, n: Any, v: Any, mask: Any, m = specPerMaterial(), k = specKnobs(), num = SPEC_GRAPH_NUMBERS): Any {
  const half = l.add(v);
  const len = length(half);
  const nl = dot(n, l);
  const nh = dot(n, half).div(max(len, num.floor));
  const h = clamp(nh, 0, 1);
  const p = max(m.power, 0);
  const band = max(pow(max(float(1).sub(abs(float(1).sub(h.mul(num.tighten)))), num.floor), p.mul(num.bandPower)).sub(num.bandPower), 0).mul(clamp(nl, 0, 1));
  const blinn = pow(max(h, num.floor), p);
  const shape = select(m.mode.greaterThan(num.bandAbove), band, blinn);
  const gate = mix(float(1), step(num.gateNl, nl), clamp(k.gate, 0, 1));
  const term = lightColor.mul(m.color).mul(mask.mul(shape).mul(gate).mul(max(k.gain, 0)).div(PI));
  const capped = min(term, lightColor.mul(max(k.cap, 0).div(PI)));
  return select(m.mode.lessThan(num.noneBelow).or(len.lessThan(num.floor)), vec3(0), capped);
}

/**
 * How much of the direct specular is three's GGX: all of it where the switch asks for three's (`spec({ use: 'three' })`)
 * or the console's look switch is off, else the weather's share times the film (`specMath.filmShare`).
 */
export function filmNode(k = specKnobs()): Any {
  const weather = CLIENT_SPEC_WEATHER.node ?? float(0);
  return select(k.use.greaterThan(0.5).or(k.on.lessThan(0.5)), float(1), clamp(weather.mul(k.film), 0, 1));
}

/**
 * The share of a direct light's diffuse that three 0.187's physical model takes away for its own highlight (its `direct`:
 * the Lambert term times one less the Fresnel of the half vector), given back where the client's term stands: the client's
 * line adds its diffuse and its highlight and takes nothing from the one for the other, and the WebGL picture holds 0.185's
 * uncut diffuse (`threeHolds.ts`, `light-diffuse`). Times one less the film, so where three's GGX stands (`use: 'three'`,
 * the look switched off) nothing is given back and the diffuse is three's own to the bit. `n` is the normal the light is
 * met with (the shading normal, or a leaf card's blended one, `gpuCard.ts`).
 */
export function diffuseBackNode(lightDirection: Any, lightColor: Any, n: Any, film: Any): Any {
  const dotNL = n.dot(lightDirection).clamp();
  const halfDir = lightDirection.add(positionViewDirection).normalize();
  const dotVH = positionViewDirection.dot(halfDir).clamp();
  const F: Any = (F_Schlick as Any)({ f0: specularColor, f90: specularF90, dotVH });
  return dotNL.mul(lightColor).mul((BRDF_Lambert as Any)({ diffuseColor: diffuseContribution })).mul(F).mul(float(1).sub(film));
}

/** Counts for the console: models made, and how many read the metal-rough red. */
export const SPEC_GPU_STATS = { models: 0, masked: 0 };

/**
 * Why `__debug.specSelfTest()` cannot run on this load, or null (`gpuSpecSelfTest.ts`): its part left out at load, or the
 * highlight's wrap skipped, either of which leaves every highlight three's own and the test nothing of ours to draw.
 */
export function specSelfTestRefusal(atLoad = LOOKS_AT_LOAD.spec, wrap = SPEC_WRAP): string | null {
  if (!atLoad) return "the client's highlight's part is left out at load (localStorage['swg.gpu.spec'] = '0'): every highlight is three's own";
  if (!wrap) return "the highlight's wrap is skipped for this load (localStorage['swg.spec'] = 'three'): no material carries it";
  return null;
}

/**
 * Three's physical lighting with the client's highlight in place of its direct specular, on 0.187's indirect light
 * (`HeldLightingModel`, pass 1's wave 2). Built with whatever features three's own model for the material would have had
 * (`from`), so a physical material keeps its clearcoat and the rest.
 */
export class ClientLightingModel extends (HeldLightingModel as Any) {
  readonly mask: Any;
  constructor(from: Any, mask: Any) {
    super(from);
    this.mask = mask;
  }

  direct(input: Any, builder: Any): void {
    const { lightDirection, lightColor, reflectedLight } = input;
    // Three's own direct light, whole, its specular caught apart: what the WebGL line's `BRDF_GGX_Multiscatter` is here.
    const ggx = vec3(0).toVar();
    (PhysicalLightingModel.prototype as Any).direct.call(this, { ...input, reflectedLight: { directDiffuse: reflectedLight.directDiffuse, directSpecular: ggx } }, builder);
    const client = clientSpecularNode(lightColor, lightDirection, normalView, positionViewDirection, this.mask);
    const film = filmNode();
    // `swgDirectSpecular`'s two `if`s as two selects: with the film at one this is three's own specular to the bit.
    const out = select(film.greaterThan(0), ggx.mul(film), vec3(0)).add(select(film.lessThan(1), client.mul(float(1).sub(film)), vec3(0)));
    reflectedLight.directSpecular.addAssign(out);
    // The diffuse three cut for its highlight given back where the client's term stands (`diffuseBackNode`); a model with
    // a sheen, a rough diffuse or a retroreflection cuts it otherwise and keeps three's own.
    if (this.givesDiffuseBack) reflectedLight.directDiffuse.addAssign(diffuseBackNode(lightDirection, lightColor, normalView, film));
  }

  /**
   * Three's indirect diffuse (the ambient's and the sky's hemisphere's), and where the client's term stands the share of it
   * three 0.187 took for its highlight's whole energy given back, as the WebGL picture holds 0.185's uncut ambient
   * (`threeHolds.ts`, `ambient-diffuse`): the client's line adds its ambient to its diffuse light whole. Times one less the
   * film, so where three's GGX stands it is three's own to the bit.
   */
  indirectDiffuse(builder: Any): void {
    (HeldLightingModel.prototype as Any).indirectDiffuse.call(this, builder);
    if (!this.givesDiffuseBack) return;
    const self = this as Any;
    const { irradiance, reflectedLight } = builder.context;
    const energy = self.singleScatteringDielectric.add(self.multiScatteringDielectric);
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul((BRDF_Lambert as Any)({ diffuseColor: diffuseContribution })).mul(energy).mul(float(1).sub(filmNode())));
  }

  /** Whether three's `direct` cut this model's diffuse by the plain Fresnel alone (a standard material's: no sheen, rough diffuse or retroreflection). */
  get givesDiffuseBack(): boolean {
    const self = this as Any;
    return self.sheen !== true && !self.diffuseRoughness && self.retroreflection !== true;
  }
}

/** The mask: the metal-rough picture's red, sampled through the very node three's roughness reads its green from, or one. */
export function maskFor(material: Any): Any {
  if (material?.roughnessMap?.isTexture === true) return (new (MaterialNode as Any)(MaterialNode.ROUGHNESS).getTexture('roughness') as Any).r;
  return float(1);
}

/**
 * The look part (`looks.ts`): a standard material the highlight's wrap went on (unlit ones never are), with the hatch at
 * load open. Its node copy's lighting model becomes ours.
 */
export const specPart: LookPart = {
  name: 'spec',
  applies(m: Any): boolean {
    return LOOKS_AT_LOAD.spec && SPEC_WRAP && m.isMeshStandardMaterial === true && chainHas(m.onBeforeCompile, SPEC_HOOK);
  },
  apply(node: Any): void {
    const own = node.setupLightingModel;
    node.setupLightingModel = function (this: Any, builder: Any) {
      const base = own.call(this, builder);
      if (!base || !(base instanceof (PhysicalLightingModel as Any))) return base;
      const mask = maskFor(builder.material);
      SPEC_GPU_STATS.models++;
      if (builder.material?.roughnessMap?.isTexture === true) SPEC_GPU_STATS.masked++;
      return new ClientLightingModel(base, mask);
    };
  },
};
