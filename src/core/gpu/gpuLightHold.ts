// Three's indirect light on WebGPU, held where its development branch toward r188 changed it (the GPU port's pass 1, wave 2;
// three's commit 577fb27). The WebGL chunks are held the same way by `../threeHold188.ts`.
//
// Three's commit changed its node lighting in three ways the game draws:
//  - an ambient and a hemisphere light are reflected (`LightingModel.indirectRadiance`, called by both lights' nodes as they
//    are set up): every lit surface takes a highlight of the sky's hemisphere, brightest at grazing angles;
//  - an environment's fill joins the ambient's irradiance (`EnvironmentNode` adds it to `irradiance`, where 0.187 kept it in
//    `iblIrradiance`), so the client's highlight and the ground, which give back the share of the ambient's diffuse three
//    takes for its highlight, would give back the environment's share too;
//  - an environment's multiple scattering scales its radiance, where 0.187 scaled the fill, and the ambient occlusion moved
//    from `ambientOcclusion` into the indirect diffuse with a multiple bounce.
// So every lit standard material's model is `HeldLightingModel`: three's physical model with no reflection of the ambient
// lights and 0.187's indirect light, its fill read apart (the hold part below keeps it apart as the environment is set up).
// The client's highlight's model, the ground's and the leaf cards' build on it. What is not held, because no material of
// the game's asks for it, is three's own: a sheen, a clear coat, a rough diffuse, a probe grid's light.
//
// On WebGPU alone: reached through `looks.ts` (the part), `gpuSpec.ts` and `gpuGround.ts`, all loaded by `start.ts`.

import { PhysicalLightingModel } from 'three/webgpu';
import { BRDF_Lambert, diffuseColor, diffuseContribution, float, metalness, mix, normalView, positionViewDirection, roughness, specularF90, vec3 } from 'three/tsl';
import type { LookPart } from './looks.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Where the environment's fill is kept on the lighting context, apart from the ambient's (0.187's `iblIrradiance`). */
const IBL = 'swgIblIrradiance';

/** Counts for the console: models made held, and environments kept apart. */
export const LIGHT_HOLD_STATS = { models: 0, environments: 0 };

/**
 * Three's physical lighting with 0.187's indirect light: the ambient and hemisphere lights are not reflected, the ambient's
 * diffuse is cut by the dielectric highlight's share, the environment's fill is lit beside its reflection (its diffuse cut the
 * same way, its multiple scattering by the fill), and the occlusion darkens the indirect light after both.
 */
export class HeldLightingModel extends (PhysicalLightingModel as Any) {
  constructor(from?: Any) {
    super(from?.clearcoat, from?.sheen, from?.iridescence, from?.anisotropy, from?.transmission, from?.dispersion, from?.retroreflection, from?.diffuseRoughness);
  }

  /** Whether this model is one 0.187's plain indirect light holds (no sheen, clear coat or rough diffuse: three's own then). */
  get heldIndirect(): boolean {
    const self = this as Any;
    return self.sheen !== true && self.clearcoat !== true && !self.diffuseRoughness;
  }

  /** No reflection of an ambient or a hemisphere light (0.187 reflected an environment map alone). */
  indirectRadiance(): void {}

  indirectDiffuse(builder: Any): void {
    if (!this.heldIndirect) return (PhysicalLightingModel.prototype as Any).indirectDiffuse.call(this, builder);
    const self = this as Any;
    const { irradiance, reflectedLight } = builder.context;
    const share = self.singleScatteringDielectric.add(self.multiScatteringDielectric);
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul((BRDF_Lambert as Any)({ diffuseColor: diffuseContribution })).mul(float(1).sub(share)));
  }

  indirectSpecular(builder: Any): void {
    if (!this.heldIndirect) return (PhysicalLightingModel.prototype as Any).indirectSpecular.call(this, builder);
    const self = this as Any;
    const { radiance, reflectedLight } = builder.context;
    const fill = builder.context[IBL] ?? vec3(0);
    const singleD = self.singleScatteringDielectric;
    const multiD = self.multiScatteringDielectric;
    const singleM = vec3().toVar('singleScatteringMetallic');
    const multiM = vec3().toVar('multiScatteringMetallic');
    self.computeMultiscattering(singleM, multiM, specularF90, diffuseColor.rgb, self.iridescenceF0Metallic);
    const single = mix(singleD, singleM, metalness);
    const multi = mix(multiD, multiM, metalness);
    const cosineFill = fill.mul(1 / Math.PI);
    reflectedLight.indirectSpecular.addAssign(radiance.mul(single).add(multi.mul(cosineFill)));
    reflectedLight.indirectDiffuse.addAssign(diffuseContribution.mul(float(1).sub(singleD.add(multiD))).mul(cosineFill));
  }

  ambientOcclusion(builder: Any): void {
    if (!this.heldIndirect) return (PhysicalLightingModel.prototype as Any).ambientOcclusion.call(this, builder);
    const { ambientOcclusion, reflectedLight } = builder.context;
    const dotNV = normalView.dot(positionViewDirection).clamp();
    const lobe = roughness.mul(-16).oneMinus().negate().exp2();
    const specularOcclusion = ambientOcclusion.sub(dotNV.add(ambientOcclusion).pow(lobe).oneMinus()).clamp();
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
    reflectedLight.indirectSpecular.mulAssign(specularOcclusion);
  }
}

/**
 * The look part (`looks.ts`), first of all: every lit standard material's copy. Its model becomes `HeldLightingModel` where
 * three's would have been its plain physical model (the parts after it build on that), and its environment's fill is kept
 * apart on the lighting context as the environment is set up.
 */
export const lightHoldPart: LookPart = {
  name: 'lightHold',
  applies(m: Any): boolean {
    return m.isMeshStandardMaterial === true;
  },
  apply(node: Any): void {
    const ownModel = node.setupLightingModel;
    node.setupLightingModel = function (this: Any, builder: Any) {
      const base = ownModel.call(this, builder);
      if (!base || base.constructor !== PhysicalLightingModel) return base;
      LIGHT_HOLD_STATS.models++;
      return new HeldLightingModel(base);
    };
    const ownEnv = node.setupEnvironment;
    node.setupEnvironment = function (this: Any, builder: Any) {
      const env = ownEnv.call(this, builder);
      if (env && env.isLightingNode === true) keepFillApart(env);
      return env;
    };
  },
};

/** An environment node whose fill goes to the context's own record of it while it is set up, never to the ambient's. */
export function keepFillApart(env: Any): void {
  const setup = env.setup;
  env.setup = function (this: Any, builder: Any) {
    const ctx = builder.context;
    const ambient = ctx.irradiance;
    const fill = ctx[IBL] ?? (ctx[IBL] = vec3().toVar(IBL));
    ctx.irradiance = fill;
    LIGHT_HOLD_STATS.environments++;
    try {
      return setup.call(this, builder);
    } finally {
      ctx.irradiance = ambient;
    }
  };
}
